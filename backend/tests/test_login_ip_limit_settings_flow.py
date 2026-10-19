"""Anmelde-Grenze je Adresse einstellbar (#1802), über die echten Routen gegen die Datenbank im Speicher.

Vertrag:
- Ohne Einstellung gilt die bisherige Grenze (30 Anmeldungen je Minute je Adresse, 5 Registrierungen je Stunde).
- Ein höherer Wert aus der Verwaltung greift für Web und App; im Event-Zeitraum gilt der Event-Wert, danach wieder
  der normale - von selbst.
- Werte außerhalb der Schranken und zu lange Event-Zeiträume lehnt die Verwaltung ab; was trotzdem in der Datenbank
  steht, wird beim Lesen in die Schranken gezogen.
- Der Schutz je Konto (Fehlversuche je E-Mail) bleibt unverändert, auch bei hoher Grenze je Adresse.
- Betroffene lesen, dass das Netz gebremst ist, nicht „falsches Passwort“; die öffentliche Seite nennt keine Grenzen.
Erfundene Konten und Testpasswörter."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import bcrypt
import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402

from services import auth_settings  # noqa: E402
from services.auth_settings import (  # noqa: E402
    AUTH_LIMIT_FIELDS, effective_ip_limits, event_window_active, validate_event_window, validate_limit_updates,
)

LOGIN_PATHS = ("/api/auth/login", "/api/auth/mobile/login")
WRONG = "Falsches-Testpasswort-2"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "login-limit-tests-secret-with-at-least-32-characters")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fast_and_frozen(monkeypatch):
    """Jede Prüfung scheitert sofort (kein bcrypt), und die Uhr der Bremse steht mitten in einem Fenster."""
    from services import rate_limit

    class Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 14, 12, 0, 30, tzinfo=timezone.utc)

    monkeypatch.setattr(rate_limit, "datetime", Frozen)
    monkeypatch.setattr(bcrypt, "checkpw", lambda _candidate, _stored: False)


async def store(flow, **fields):
    await flow.db.settings.update_one({"id": "auth"}, {"$set": fields, "$setOnInsert": {"id": "auth"}}, upsert=True)


async def sign_ins_until_blocked(flow, path, attempts: int) -> list[int]:
    codes = []
    for number in range(attempts):
        response = await flow.post(path, json={"email": f"niemand-{number}-{new_id()[:4]}@example.com", "password": WRONG})
        codes.append(response.status_code)
    return codes


# ---------------------------------------------------------------- Einheiten


def test_defaults_are_the_previous_limits():
    assert AUTH_LIMIT_FIELDS["login_ip_limit_per_minute"][0] == 30
    assert AUTH_LIMIT_FIELDS["register_ip_limit_per_hour"][0] == 5


def test_stored_values_outside_the_bounds_are_pulled_back_in():
    for key, (_default, low, high, _label) in AUTH_LIMIT_FIELDS.items():
        assert auth_settings.clamp_limit(key, 0) == low
        assert auth_settings.clamp_limit(key, -5) == low
        assert auth_settings.clamp_limit(key, 10**9) == high
        assert auth_settings.clamp_limit(key, True) == AUTH_LIMIT_FIELDS[key][0]
        assert auth_settings.clamp_limit(key, "999") == AUTH_LIMIT_FIELDS[key][0]


def test_admin_values_must_stay_inside_the_bounds():
    assert validate_limit_updates({"login_ip_limit_per_minute": 120}) == ({"login_ip_limit_per_minute": 120}, None)
    for value in (9, 301, 0, -1, True, 30.5):
        updates, problem = validate_limit_updates({"login_ip_limit_per_minute": value})
        assert updates == {} and problem and "10 bis 300" in problem, value
    assert validate_limit_updates({"register_ip_limit_per_hour": 2})[1]
    assert validate_limit_updates({"event_limits_from": "kein Datum"})[1]


def test_event_window_needs_both_ends_and_ends_by_itself():
    start = datetime(2026, 10, 31, 16, 0, tzinfo=timezone.utc)
    assert validate_event_window(None, None) is None
    assert validate_event_window(start, None)
    assert validate_event_window(start, start)
    assert validate_event_window(start, start - timedelta(hours=1))
    assert validate_event_window(start, start + timedelta(days=3, minutes=1))
    assert validate_event_window(start, start + timedelta(hours=10)) is None

    settings = {
        "login_ip_limit_per_minute": 30, "register_ip_limit_per_hour": 5,
        "event_login_ip_limit_per_minute": 200, "event_register_ip_limit_per_hour": 60,
        "event_limits_from": start.isoformat(), "event_limits_until": (start + timedelta(hours=10)).isoformat(),
    }
    assert effective_ip_limits(settings, start - timedelta(seconds=1)) == {
        "event_active": False, "login_per_minute": 30, "register_per_hour": 5,
    }
    assert effective_ip_limits(settings, start + timedelta(hours=2)) == {
        "event_active": True, "login_per_minute": 200, "register_per_hour": 60,
    }
    assert effective_ip_limits(settings, start + timedelta(hours=10))["login_per_minute"] == 30, "danach von selbst zurück"
    too_long = {**settings, "event_limits_until": (start + timedelta(days=5)).isoformat()}
    assert not event_window_active(too_long, start + timedelta(hours=1)), "ein zu langer Zeitraum aus der Datenbank gilt nicht"


# ---------------------------------------------------------------- über die Routen


@pytest.mark.asyncio
@pytest.mark.parametrize("path", LOGIN_PATHS)
async def test_default_limit_blocks_after_thirty_with_a_clear_message(flow, fast_and_frozen, path):
    codes = await sign_ins_until_blocked(flow, path, 30)
    assert codes == [401] * 30
    response = await flow.post(path, json={"email": "noch-einer@example.com", "password": WRONG})
    assert response.status_code == 429
    assert response.json()["detail"].startswith("Zu viele Anmeldungen aus diesem Netz. Bitte versuche es in ")
    assert response.headers.get("Retry-After")


@pytest.mark.asyncio
@pytest.mark.parametrize("path", LOGIN_PATHS)
async def test_a_raised_limit_lets_more_devices_through(flow, fast_and_frozen, path):
    await store(flow, login_ip_limit_per_minute=45)
    codes = await sign_ins_until_blocked(flow, path, 46)
    assert codes[:45] == [401] * 45
    assert codes[45] == 429


@pytest.mark.asyncio
async def test_event_window_raises_the_limit_only_while_it_runs(flow, fast_and_frozen):
    now = datetime.now(timezone.utc)
    await store(
        flow, login_ip_limit_per_minute=10, event_login_ip_limit_per_minute=40,
        event_limits_from=(now - timedelta(hours=1)).isoformat(), event_limits_until=(now + timedelta(hours=1)).isoformat(),
    )
    codes = await sign_ins_until_blocked(flow, "/api/auth/login", 41)
    assert codes[:40] == [401] * 40 and codes[40] == 429

    await flow.db.rate_limits.delete_many({})
    await store(
        flow, event_limits_from=(now - timedelta(hours=3)).isoformat(), event_limits_until=(now - timedelta(hours=1)).isoformat(),
    )
    codes = await sign_ins_until_blocked(flow, "/api/auth/login", 11)
    assert codes[:10] == [401] * 10 and codes[10] == 429, "nach dem Event gilt wieder der normale Wert"


@pytest.mark.asyncio
@pytest.mark.parametrize("path", LOGIN_PATHS)
async def test_account_protection_is_unchanged_by_a_high_address_limit(flow, fast_and_frozen, path):
    await store(flow, login_ip_limit_per_minute=300)
    email = f"ziel-{new_id()[:6]}@example.com"
    codes = []
    for _ in range(8):
        response = await flow.post(path, json={"email": email, "password": WRONG})
        codes.append(response.status_code)
    assert codes == [401] * 7 + [429]
    assert response.json()["detail"] == "Zu viele Loginversuche. Bitte in 15 Minuten erneut versuchen."


@pytest.mark.asyncio
async def test_registration_limit_follows_the_setting(flow, fast_and_frozen):
    await store(flow, register_ip_limit_per_hour=3)
    codes = []
    for number in range(4):
        # Ohne Zustimmung endet die Registrierung gleich hinter der Bremse - es entsteht kein Konto.
        response = await flow.post("/api/auth/register", json={
            "username": f"neu{number}x", "email": f"neu-{number}@example.com", "password": "Loewen-Testpasswort-1",
            "accept_privacy": True, "accept_terms": False,
        })
        codes.append(response.status_code)
    assert codes == [400, 400, 400, 429]
    assert response.json()["detail"].startswith("Zu viele Registrierungen aus diesem Netz.")


@pytest.mark.asyncio
async def test_admin_saves_limits_inside_bounds_and_rejects_the_rest(flow):
    flow.act_as(await flow.add_user(role="superadmin", name="root"))
    response = await flow.put("/api/settings/auth", json={"login_ip_limit_per_minute": 120})
    assert response.status_code == 200, response.text
    assert response.json()["login_ip_limit_per_minute"] == 120

    for body in ({"login_ip_limit_per_minute": 5}, {"login_ip_limit_per_minute": 5000},
                 {"event_limits_from": "2026-10-31T16:00:00+00:00"},
                 {"event_limits_from": "2026-10-31T16:00:00+00:00", "event_limits_until": "2026-11-05T16:00:00+00:00"}):
        response = await flow.put("/api/settings/auth", json=body)
        assert response.status_code == 400, body
    assert (await flow.get("/api/settings/auth")).json()["login_ip_limit_per_minute"] == 120

    response = await flow.put("/api/settings/auth", json={
        "event_limits_from": "2026-10-31T16:00:00+00:00", "event_limits_until": "2026-11-01T02:00:00+00:00",
        "event_login_ip_limit_per_minute": 250,
    })
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["event_limits_from"].startswith("2026-10-31T16:00") and data["event_login_ip_limit_per_minute"] == 250

    response = await flow.put("/api/settings/auth", json={"event_limits_from": "", "event_limits_until": ""})
    assert response.status_code == 200 and response.json()["event_limits_from"] == ""


@pytest.mark.asyncio
async def test_public_settings_do_not_name_the_limits(flow):
    await store(flow, login_ip_limit_per_minute=200)
    data = (await flow.get("/api/settings/public")).json()
    assert "password_login_enabled" in data
    assert not [key for key in data if "limit" in key]
