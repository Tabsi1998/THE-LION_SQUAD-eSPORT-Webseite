"""MFA-Abfrage abbrechen und ablösen (#996): bricht man die Abfrage nach dem zweiten Faktor ab, gilt sie am Server
nicht mehr; eine neue Anmeldung auf demselben Gerät löst die offene ab. Eine Abfrage, die nicht mehr gilt, trägt das
Kennzeichen ``X-Auth-Error: mfa_challenge_invalid`` - ein falscher Code nicht.
Geprüft über die echten Routen gegen die Datenbank im Speicher. Erfundene Konten, keine echten Personen."""
import pathlib
import secrets
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402

from auth import hash_password, hash_token  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402
from services.totp import current_totp, generate_totp_secret  # noqa: E402

PASSWORD = "Ein-langes-Testpasswort-42"
BROWSER = {"user-agent": "Testbrowser/1.0"}
OTHER_BROWSER = {"user-agent": "Anderer-Browser/2.0"}
INVALID = "mfa_challenge_invalid"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    # Hier wird wirklich angemeldet - dafür braucht es den Schlüssel auch nach dem Import.
    monkeypatch.setenv("JWT_SECRET", "mfa-cancel-tests-secret-long-enough-here")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def frozen_rate_limit_clock(monkeypatch):
    """Alle Zählfenster der Rate-Limits bleiben während des Tests dieselben."""
    import services.rate_limit as rate_limit

    class FrozenClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 14, 12, 0, 5, tzinfo=timezone.utc)

    monkeypatch.setattr(rate_limit, "datetime", FrozenClock)


async def mfa_account(flow) -> tuple[dict, str]:
    name = f"loewe-{new_id()[:6]}"
    user = await flow.add_user(name=name)
    secret = generate_totp_secret()
    update = {"email": f"{name}@lionsquad-test.at", "email_verified": True, "password_hash": hash_password(PASSWORD),
              "mfa_enabled": True, "mfa_secret": encrypt_secret(secret)}
    await flow.db.users.update_one({"id": user["id"]}, {"$set": update})
    user.update(update)
    flow.act_as(None)
    return user, secret


async def login(flow, user: dict, headers=BROWSER) -> str:
    flow.client.cookies.clear()
    response = await flow.post("/api/auth/login", json={"email": user["email"], "password": PASSWORD}, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["mfa_required"] is True
    return response.json()["mfa_ticket"]


async def complete(flow, ticket: str, code: str, headers=BROWSER):
    response = await flow.post("/api/auth/mfa/complete", json={"ticket": ticket, "code": code}, headers=headers)
    flow.client.cookies.clear()
    return response


async def cancel(flow, ticket: str):
    return await flow.post("/api/auth/mfa/cancel", json={"ticket": ticket}, headers=BROWSER)


@pytest.mark.asyncio
async def test_a_cancelled_challenge_no_longer_logs_in(flow):
    user, secret = await mfa_account(flow)
    ticket = await login(flow, user)

    cancelled = await cancel(flow, ticket)
    after = await complete(flow, ticket, current_totp(secret))

    assert cancelled.status_code == 200 and cancelled.json() == {"ok": True}
    assert after.status_code == 401
    assert after.headers.get("x-auth-error") == INVALID
    stored = await flow.db.mfa_login_challenges.find_one({"ticket_hash": hash_token(ticket)})
    assert stored["used"] is True and stored["invalidated_reason"] == "cancelled"


@pytest.mark.asyncio
async def test_cancel_answers_the_same_whether_the_challenge_existed(flow):
    user, _ = await mfa_account(flow)
    ticket = await login(flow, user)

    responses = [await cancel(flow, ticket), await cancel(flow, ticket), await cancel(flow, "gibt-es-nicht"), await cancel(flow, "")]

    assert [response.status_code for response in responses] == [200, 200, 200, 200]
    assert len({response.text for response in responses}) == 1, "keine Auskunft, ob es die Abfrage gab"


@pytest.mark.asyncio
async def test_cancel_is_rate_limited(flow, frozen_rate_limit_clock):
    statuses = [(await cancel(flow, secrets.token_urlsafe(16))).status_code for _ in range(31)]

    assert statuses[:30] == [200] * 30
    assert statuses[30] == 429


@pytest.mark.asyncio
async def test_a_new_login_on_the_same_device_replaces_the_open_challenge(flow):
    user, secret = await mfa_account(flow)
    first = await login(flow, user)
    elsewhere = await login(flow, user, headers=OTHER_BROWSER)
    second = await login(flow, user)

    old = await complete(flow, first, current_totp(secret))
    new = await complete(flow, second, current_totp(secret))

    assert old.status_code == 401 and old.headers.get("x-auth-error") == INVALID
    assert new.status_code == 200, new.text
    stored = await flow.db.mfa_login_challenges.find_one({"ticket_hash": hash_token(elsewhere)})
    assert stored["used"] is False, "eine Anmeldung auf einem anderen Gerät bleibt offen"


@pytest.mark.asyncio
async def test_a_wrong_code_keeps_the_challenge_and_has_no_marker(flow):
    user, secret = await mfa_account(flow)
    ticket = await login(flow, user)

    wrong = await complete(flow, ticket, "000000")

    assert wrong.status_code == 401
    assert wrong.headers.get("x-auth-error") is None
    assert (await complete(flow, ticket, current_totp(secret))).status_code == 200


@pytest.mark.asyncio
async def test_expired_used_and_foreign_device_challenges_carry_the_marker(flow):
    user, secret = await mfa_account(flow)
    expired = await login(flow, user)
    await flow.db.mfa_login_challenges.update_one(
        {"ticket_hash": hash_token(expired)}, {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)}},
    )
    foreign = await login(flow, user, headers=OTHER_BROWSER)

    late = await complete(flow, expired, current_totp(secret))
    other_device = await complete(flow, foreign, current_totp(secret), headers=BROWSER)

    for response in (late, other_device):
        assert response.status_code == 401
        assert response.headers.get("x-auth-error") == INVALID
