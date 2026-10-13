"""Zweiter Faktor beim Anmelden (#1032): jeder Code zählt genau einmal, auch bei gleichzeitigen Anmeldungen.

Wiederherstellungscodes werden nur als Hash gespeichert und beim Verbrauch atomar entfernt, ein Code aus der
Authenticator-App gilt in seinem Zeitfenster nur einmal, und Fehlversuche sind je Anmeldung und je Konto begrenzt.
Geprüft über die echten Routen gegen die Datenbank im Speicher. Erfundene Konten, keine echten Personen."""
import asyncio
import pathlib
import secrets
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import InterleavedReads, make_flow, new_id  # noqa: E402

from auth import hash_token  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402
from services.totp import current_totp, generate_totp_secret  # noqa: E402

BROWSER = {"user-agent": "Testbrowser/1.0"}
RECOVERY_CODES = ["ABCDEFGH23", "JKLMNPQR45"]
WRONG_CODE = "000000"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    # Hier wird wirklich angemeldet - dafür braucht es den Schlüssel auch nach dem Import.
    monkeypatch.setenv("JWT_SECRET", "mfa-tests-secret-that-is-long-enough-here")
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
            return datetime(2026, 10, 13, 12, 0, 5, tzinfo=timezone.utc)

    monkeypatch.setattr(rate_limit, "datetime", FrozenClock)


async def mfa_account(flow, codes=RECOVERY_CODES) -> tuple[dict, str]:
    user = await flow.add_user(name=f"loewe-{new_id()[:6]}")
    secret = generate_totp_secret()
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {
        "email_verified": True,
        "mfa_secret": encrypt_secret(secret),
        "mfa_recovery_code_hashes": [hash_token(code) for code in codes],
    }})
    flow.act_as(None)
    return user, secret


async def login_ticket(flow, user: dict) -> str:
    """Wie nach richtigem Passwort: eine offene Anmeldung, die noch den zweiten Faktor braucht."""
    ticket = secrets.token_urlsafe(24)
    now = datetime.now(timezone.utc)
    await flow.db.mfa_login_challenges.insert_one({
        "id": new_id(), "ticket_hash": hash_token(ticket), "user_id": user["id"], "client": "web",
        "user_agent": BROWSER["user-agent"], "ip": "127.0.0.1", "used": False, "attempts": 0, "remember": True,
        "created_at": now, "expires_at": now + timedelta(minutes=5),
    })
    return ticket


async def complete(flow, ticket: str, code: str):
    response = await flow.post("/api/auth/mfa/complete", json={"ticket": ticket, "code": code}, headers=BROWSER)
    flow.client.cookies.clear()
    return response


@pytest.mark.asyncio
async def test_recovery_code_works_once_and_is_kept_only_as_a_hash(flow):
    user, _ = await mfa_account(flow)

    first = await complete(flow, await login_ticket(flow, user), RECOVERY_CODES[0])
    again = await complete(flow, await login_ticket(flow, user), RECOVERY_CODES[0])

    assert first.status_code == 200
    assert again.status_code == 401
    stored = (await flow.db.users.find_one({"id": user["id"]}))["mfa_recovery_code_hashes"]
    assert stored == [hash_token(RECOVERY_CODES[1])]


@pytest.mark.asyncio
async def test_two_simultaneous_logins_with_one_recovery_code_only_one_wins(flow, monkeypatch):
    import routes.auth_routes as auth_routes

    user, _ = await mfa_account(flow)
    first_ticket, second_ticket = await login_ticket(flow, user), await login_ticket(flow, user)
    gate = InterleavedReads(flow.db, "users")
    monkeypatch.setattr(auth_routes, "get_db", lambda: gate)

    responses = await asyncio.gather(
        flow.post("/api/auth/mfa/complete", json={"ticket": first_ticket, "code": RECOVERY_CODES[0]}, headers=BROWSER),
        flow.post("/api/auth/mfa/complete", json={"ticket": second_ticket, "code": RECOVERY_CODES[0]}, headers=BROWSER),
    )

    assert sorted(response.status_code for response in responses) == [200, 401]


@pytest.mark.asyncio
async def test_an_authenticator_code_counts_only_once(flow):
    user, secret = await mfa_account(flow)
    code = current_totp(secret)

    first = await complete(flow, await login_ticket(flow, user), code)
    again = await complete(flow, await login_ticket(flow, user), code)

    assert first.status_code == 200
    assert again.status_code == 401


@pytest.mark.asyncio
async def test_two_simultaneous_logins_with_one_authenticator_code_only_one_wins(flow, monkeypatch):
    import routes.auth_routes as auth_routes

    user, secret = await mfa_account(flow)
    code = current_totp(secret)
    first_ticket, second_ticket = await login_ticket(flow, user), await login_ticket(flow, user)
    gate = InterleavedReads(flow.db, "users")
    monkeypatch.setattr(auth_routes, "get_db", lambda: gate)

    responses = await asyncio.gather(
        flow.post("/api/auth/mfa/complete", json={"ticket": first_ticket, "code": code}, headers=BROWSER),
        flow.post("/api/auth/mfa/complete", json={"ticket": second_ticket, "code": code}, headers=BROWSER),
    )

    assert sorted(response.status_code for response in responses) == [200, 401]


@pytest.mark.asyncio
async def test_the_code_that_switched_two_factor_on_does_not_also_log_in(flow):
    user = await flow.add_user(name=f"loewe-{new_id()[:6]}")
    secret = generate_totp_secret()
    await flow.db.users.update_one({"id": user["id"]}, {
        "$set": {"email_verified": True, "mfa_enabled": False, "mfa_pending_secret": encrypt_secret(secret),
                 "mfa_pending_created_at": datetime.now(timezone.utc)},
        "$unset": {"mfa_secret": "", "mfa_recovery_code_hashes": ""},
    })
    flow.act_as(user)
    code = current_totp(secret)

    enabled = await flow.post("/api/auth/mfa/enable", json={"code": code})
    assert enabled.status_code == 200
    stored = (await flow.db.users.find_one({"id": user["id"]}))["mfa_recovery_code_hashes"]
    assert stored == [hash_token(shown) for shown in enabled.json()["recovery_codes"]], "nur Hashes gespeichert"

    flow.act_as(None)
    assert (await complete(flow, await login_ticket(flow, user), code)).status_code == 401


@pytest.mark.asyncio
async def test_simultaneous_wrong_codes_still_count_against_the_five_attempts(flow, monkeypatch):
    import routes.auth_routes as auth_routes

    user, secret = await mfa_account(flow)
    ticket = await login_ticket(flow, user)
    gate = InterleavedReads(flow.db, "mfa_login_challenges", parties=8)
    monkeypatch.setattr(auth_routes, "get_db", lambda: gate)

    await asyncio.gather(*[
        flow.post("/api/auth/mfa/complete", json={"ticket": ticket, "code": WRONG_CODE}, headers=BROWSER)
        for _ in range(8)
    ])

    failed = await flow.db.audit_logs.count_documents({"actor_id": user["id"], "action": "auth.mfa.failed"})
    assert failed == 5, "mehr als fünf Versuche wurden geprüft"
    challenge = await flow.db.mfa_login_challenges.find_one({"ticket_hash": hash_token(ticket)})
    assert challenge["attempts"] == 5
    assert (await complete(flow, ticket, current_totp(secret))).status_code == 401


@pytest.mark.asyncio
async def test_wrong_codes_are_limited_per_account_across_new_logins(flow, frozen_rate_limit_clock):
    user, _ = await mfa_account(flow)
    other, _ = await mfa_account(flow)

    statuses = []
    for _ in range(3):
        ticket = await login_ticket(flow, user)
        for _ in range(5):
            statuses.append((await complete(flow, ticket, WRONG_CODE)).status_code)

    assert 429 in statuses, "das Konto bekommt nicht beliebig viele Versuche über neue Anmeldungen"
    assert (await complete(flow, await login_ticket(flow, other), WRONG_CODE)).status_code == 401


@pytest.mark.asyncio
async def test_successful_logins_do_not_use_up_the_account_limit(flow, frozen_rate_limit_clock):
    codes = [f"ABCDEFGH{index:02d}" for index in range(12)]
    user, _ = await mfa_account(flow, codes)

    statuses = [(await complete(flow, await login_ticket(flow, user), code)).status_code for code in codes]

    assert statuses == [200] * 12


@pytest.mark.asyncio
async def test_simultaneous_wrong_codes_across_logins_stay_within_the_account_limit(flow, frozen_rate_limit_clock,
                                                                                    monkeypatch):
    import routes.auth_routes as auth_routes

    user, _ = await mfa_account(flow)
    tickets = [await login_ticket(flow, user) for _ in range(3)]
    gate = InterleavedReads(flow.db, "mfa_login_challenges", parties=12)
    monkeypatch.setattr(auth_routes, "get_db", lambda: gate)

    await asyncio.gather(*[
        flow.post("/api/auth/mfa/complete", json={"ticket": ticket, "code": WRONG_CODE}, headers=BROWSER)
        for ticket in tickets[0:1] * 5 + tickets[1:2] * 5 + tickets[2:3] * 2
    ])

    failed = await flow.db.audit_logs.count_documents({"actor_id": user["id"], "action": "auth.mfa.failed"})
    assert failed == auth_routes.MFA_ATTEMPTS_PER_ACCOUNT


@pytest.mark.asyncio
async def test_the_account_limit_is_stored_without_the_account_id(flow, frozen_rate_limit_clock):
    user, _ = await mfa_account(flow)

    assert (await complete(flow, await login_ticket(flow, user), WRONG_CODE)).status_code == 401

    rows = await flow.db.rate_limits.find({}).to_list(50)
    assert any(row.get("bucket") == "auth:mfa:user" for row in rows)
    assert all(user["id"] not in str(row) for row in rows)


@pytest.mark.asyncio
async def test_two_simultaneous_enables_only_one_wins(flow, monkeypatch):
    import routes.auth_routes as auth_routes

    user = await flow.add_user(name=f"loewe-{new_id()[:6]}")
    secret = generate_totp_secret()
    await flow.db.users.update_one({"id": user["id"]}, {
        "$set": {"email_verified": True, "mfa_enabled": False, "mfa_pending_secret": encrypt_secret(secret),
                 "mfa_pending_created_at": datetime.now(timezone.utc)},
        "$unset": {"mfa_secret": "", "mfa_recovery_code_hashes": ""},
    })
    flow.act_as(user)
    code = current_totp(secret)
    gate = InterleavedReads(flow.db, "users")
    monkeypatch.setattr(auth_routes, "get_db", lambda: gate)

    responses = await asyncio.gather(
        flow.post("/api/auth/mfa/enable", json={"code": code}),
        flow.post("/api/auth/mfa/enable", json={"code": code}),
    )

    assert sorted(response.status_code for response in responses) == [200, 400]
    shown = next(response for response in responses if response.status_code == 200).json()["recovery_codes"]
    stored = (await flow.db.users.find_one({"id": user["id"]}))["mfa_recovery_code_hashes"]
    assert stored == [hash_token(code) for code in shown], "die gezeigten Codes sind die gespeicherten"


@pytest.mark.asyncio
async def test_the_code_counter_is_not_part_of_the_account_view(flow):
    user, _ = await mfa_account(flow)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"mfa_totp_last_counter": 12345}})
    flow.act_as(user)

    response = await flow.get(f"/api/users/{user['id']}")

    assert response.status_code == 200
    assert "mfa_totp_last_counter" not in response.json()

