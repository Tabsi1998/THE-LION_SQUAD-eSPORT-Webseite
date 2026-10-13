"""Private Kontofelder erscheinen in keiner Antwort (#1492) - geprüft an den echten Routen.

Ein Konto mit allen privaten Feldern (Passwort-Hash, Google-Kennung, Zwei-Faktor-Geheimnisse, Recovery-Code-Hashes,
Zähler) wird über die wichtigsten Wege gelesen: eigenes Konto (/auth/me mit echter Anmeldung, /users/{id}),
öffentliches Profil, Teams und Squads, Suche (Verwaltung, Mitgliederliste, Nachrichten) und die Mitgliedschaft in der
Vereinsverwaltung. Keine Antwort enthält ein privates Feld, die öffentlichen Felder sind unverändert da.

Gegenprobe: ein neues Feld nur in ``PRIVATE_USER_FIELDS`` verschwindet aus allen Antworten - und ohne den Eintrag
zeigen die Antworten mit dem ganzen Konto es, die Probe sieht also wirklich hin.
Erfundene Konten, keine echten Personen."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import load_application, make_flow, new_id  # noqa: E402

from services import private_fields  # noqa: E402
from services.private_fields import PRIVATE_USER_FIELDS  # noqa: E402

CANARY = "kanarienvogel"
SECRETS = {
    "password_hash": "$2b$12$erfundenerhashwert",
    "google_id": "google-1234567890",
    "mfa_secret": "verschluesseltes-geheimnis",
    "mfa_pending_secret": "geheimnis-in-einrichtung",
    "mfa_pending_created_at": "2026-10-13T10:00:00+00:00",
    "mfa_recovery_code_hashes": ["hash-a", "hash-b"],
    "mfa_totp_last_counter": 12345,
}

# Je Antwort: welche öffentlichen Felder des Kontos dort stehen müssen (unverändert gegenüber vorher).
PUBLIC = {
    "auth_me": {"username", "display_name", "email", "bio", "avatar_url", "country"},
    "user_self": {"username", "display_name", "email", "bio", "avatar_url", "country"},
    "public_profile": {"username", "display_name", "avatar_url"},
    "public_list": {"username", "display_name", "avatar_url", "country"},
    "team": {"username", "display_name", "avatar_url"},
    "teams_my": {"username", "display_name", "avatar_url"},
    "squads": {"username", "display_name", "avatar_url"},
    "admin_user_search": {"username", "display_name", "email", "bio"},
    "membership_user": {"username", "display_name", "email", "bio"},
    "membership_list": {"username", "display_name", "email", "bio"},
    "message_search": {"username", "display_name", "avatar_url"},
}
# Diese Antworten geben das ganze Konto (ohne private Felder) - daran zeigt die Gegenprobe, dass sie hinsieht.
FULL_ACCOUNT = {"auth_me", "user_self", "admin_user_search", "membership_user", "membership_list"}


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "private-fields-secret-with-at-least-32-chars")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _world(flow, extra: dict | None = None) -> dict:
    name = f"loewe-{new_id()[:6]}"
    loewe = await flow.add_user(name=name)
    public = {
        "display_name": "Leo Löwe", "bio": "Spielt gern im Rudel.", "avatar_url": "/uploads/leo.png", "country": "AT",
        "privacy_public_profile": True, "created_at": "2026-10-01T10:00:00+00:00",
    }
    await flow.db.users.update_one({"id": loewe["id"]}, {"$set": {**public, **SECRETS, **(extra or {})}})
    loewe.update(public)
    admin = await flow.add_staff(name=f"vorstand-{new_id()[:6]}")
    team_id = new_id()
    await flow.db.teams.insert_one({
        "id": team_id, "name": "Rudel", "tag": "RDL", "member_ids": [loewe["id"]], "leader_id": loewe["id"],
        "co_leader_ids": [], "is_public": True, "created_at": "2026-10-01T10:00:00+00:00",
    })
    await flow.db.team_squads.insert_one({
        "id": new_id(), "team_id": team_id, "name": "Erste", "member_ids": [loewe["id"]],
        "created_at": "2026-10-01T10:00:00+00:00",
    })
    await flow.db.memberships.insert_one({
        "id": new_id(), "user_id": loewe["id"], "member_status": "active", "membership_type": "regular",
        "created_at": "2026-10-01T10:00:00+00:00",
    })
    return {"loewe": loewe, "admin": admin, "team_id": team_id}


async def _auth_me(flow, user: dict) -> dict:
    """/auth/me mit echter Anmeldung - das Konto kommt aus auth.get_current_user, nicht aus dem Testgerüst."""
    from auth import create_access_token

    _database, server, _current, optional = load_application()
    family = new_id()
    await flow.db.auth_sessions.insert_one({
        "family_id": family, "user_id": user["id"], "revoked": False,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
    })
    token = create_access_token(user["id"], user["email"], user["role"], new_id(), family)
    override = server.app.dependency_overrides.pop(optional)
    try:
        response = await flow.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    finally:
        server.app.dependency_overrides[optional] = override
    assert response.status_code == 200, response.text
    return response.json()


async def _responses(flow, world: dict) -> dict:
    loewe, admin = world["loewe"], world["admin"]
    out = {"auth_me": await _auth_me(flow, loewe)}

    async def get(key, url, who):
        flow.act_as(who)
        response = await flow.get(url)
        assert response.status_code == 200, (key, response.status_code, response.text)
        out[key] = response.json()

    await get("user_self", f"/api/users/{loewe['id']}", loewe)
    await get("public_profile", f"/api/users/public/{loewe['username']}", None)
    await get("public_list", f"/api/users/public-list?q={loewe['username']}", None)
    await get("team", f"/api/teams/{world['team_id']}", None)
    await get("teams_my", "/api/teams/my", loewe)
    await get("squads", f"/api/teams/{world['team_id']}/squads", loewe)
    await get("admin_user_search", f"/api/users?q={loewe['username']}", admin)
    await get("membership_user", f"/api/membership/user/{loewe['id']}", admin)
    await get("membership_list", f"/api/membership?q={loewe['username']}", admin)
    await get("message_search", f"/api/messages/users?q={loewe['username']}", admin)
    return out


def _keys(payload) -> set[str]:
    if isinstance(payload, dict):
        return set(payload) | {key for value in payload.values() for key in _keys(value)}
    if isinstance(payload, list):
        return {key for value in payload for key in _keys(value)}
    return set()


def _accounts(payload, username: str) -> list[dict]:
    """Jede Stelle der Antwort, die das Konto zeigt."""
    found = []
    if isinstance(payload, dict):
        if payload.get("username") == username:
            found.append(payload)
        for value in payload.values():
            found.extend(_accounts(value, username))
    elif isinstance(payload, list):
        for value in payload:
            found.extend(_accounts(value, username))
    return found


@pytest.mark.asyncio
async def test_no_answer_shows_a_private_field_and_public_fields_stay(flow):
    world = await _world(flow)
    loewe = world["loewe"]

    responses = await _responses(flow, world)

    assert set(responses) == set(PUBLIC)
    for key, payload in responses.items():
        leaked = _keys(payload) & (PRIVATE_USER_FIELDS | {"_id"})
        assert not leaked, f"{key}: {sorted(leaked)}"
        accounts = _accounts(payload, loewe["username"])
        assert accounts, f"{key}: das Konto fehlt in der Antwort"
        for account in accounts:
            for field in PUBLIC[key]:
                assert account.get(field) == loewe[field], (key, field, account.get(field))


@pytest.mark.asyncio
async def test_a_new_field_only_in_the_central_list_leaves_every_answer(flow, monkeypatch):
    monkeypatch.setattr(private_fields, "PRIVATE_USER_FIELDS", PRIVATE_USER_FIELDS | {CANARY})
    world = await _world(flow, {CANARY: "piep"})

    responses = await _responses(flow, world)

    showing = sorted(key for key, payload in responses.items() if CANARY in _keys(payload))
    assert not showing, showing


@pytest.mark.asyncio
async def test_without_the_entry_the_full_account_answers_show_the_field(flow):
    """Die Gegenprobe greift nur, wenn diese Antworten ein unbekanntes Feld sonst zeigen würden."""
    world = await _world(flow, {CANARY: "piep"})

    responses = await _responses(flow, world)

    showing = {key for key, payload in responses.items() if CANARY in _keys(payload)}
    assert showing == FULL_ACCOUNT
