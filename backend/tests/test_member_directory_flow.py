"""Mitgliederverzeichnis per Opt-in (#410): aktive Mitglieder tragen sich selbst ein und pflegen
Gamertag, Spiele, Plattformen und Bio; das Alter ist nicht mehr öffentlich; die Verwaltung kann
sperren; endet die Mitgliedschaft (Vorstand oder Dolibarr), geht der Eintrag offline; der
Vorstandstitel kommt weiter aus den Vorstandsposten."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import dolibarr_sync  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def member(flow, name, status="active", **fields):
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"display_name": name.capitalize(), "avatar_url": f"/uploads/{name}.png", "favorite_games": ["Rocket League"], "main_platforms": ["PC"], **fields}})
    await flow.db.memberships.insert_one({"id": f"m-{name}", "user_id": user["id"], "member_status": status, "membership_type": "ordinary"})
    return user


@pytest.mark.asyncio
async def test_active_member_lists_and_edits_own_entry_and_the_public_card_has_no_age(flow):
    paula = await member(flow, "paula")
    gast = await flow.add_user(role="player", name="gast")
    # Ein redaktionelles Profil mit Geburtsdatum: öffentlich ohne Alter, in der Verwaltung mit.
    await flow.db.club_member_profiles.insert_one({"id": "p-red", "slug": "redaktion", "display_name": "Redaktion", "birth_date": "2000-01-01", "is_active": True})

    flow.act_as(gast)
    assert (await flow.put("/api/membership/me/directory", json={"listed": True})).status_code == 403
    assert (await flow.get("/api/membership/me/directory")).json()["eligible"] is False

    flow.act_as(paula)
    own = (await flow.get("/api/membership/me/directory")).json()
    assert own == {"eligible": True, "listed": False, "blocked": False, "editorial": False, "slug": None,
                   "entry": {"display_name": "Paula", "gamertag": "paula", "photo_url": "/uploads/paula.png", "bio": "", "games": ["Rocket League"], "platforms": ["PC"]}}
    assert (await flow.put("/api/membership/me/directory", json={"gamertag": "Pau"})).status_code == 400, "ohne Eintrag gibt es nichts zu ändern"

    listed = await flow.put("/api/membership/me/directory", json={"listed": True, "games": ["F1 25", " ", "F1 25"], "bio": "Hallo"})
    assert listed.status_code == 200, listed.text
    assert listed.json()["listed"] is True and listed.json()["slug"] == "paula" and listed.json()["entry"]["games"] == ["F1 25"]

    flow.act_as(None)
    cards = (await flow.get("/api/membership/profiles")).json()
    mine = next(c for c in cards if c["slug"] == "paula")
    assert mine["gamertag"] == "paula" and mine["photo_url"] == "/uploads/paula.png" and mine["source"] == "member" and mine["role_title"] == "Mitglied"
    # Kein Alter, kein „Level“; als Realname steht höchstens der selbst gewählte Anzeigename des Kontos.
    assert "age" not in mine and "level" not in mine and mine["real_name"] == "Paula"
    editorial = next(c for c in cards if c["slug"] == "redaktion")
    assert "age" not in editorial and "level" not in editorial
    detail = (await flow.get("/api/membership/profiles/paula")).json()
    assert detail["bio"] == "Hallo" and "age" not in detail
    assert (await flow.get("/api/membership/count")).json() == {"members": 1, "listed": 2}

    # Gamertag ändern, dann austragen: Profilseite weg, Eintrag bleibt für ein späteres Wiedereintragen.
    flow.act_as(paula)
    assert (await flow.put("/api/membership/me/directory", json={"gamertag": "PaulaGG"})).json()["entry"]["gamertag"] == "PaulaGG"
    assert (await flow.put("/api/membership/me/directory", json={"listed": False})).json()["listed"] is False
    flow.act_as(None)
    assert (await flow.get("/api/membership/profiles/paula")).status_code == 404
    assert [c["slug"] for c in (await flow.get("/api/membership/profiles")).json()] == ["redaktion"]
    flow.act_as(paula)
    assert (await flow.put("/api/membership/me/directory", json={"listed": True})).json()["listed"] is True


@pytest.mark.asyncio
async def test_admin_block_wins_and_an_ended_membership_takes_the_entry_offline(flow):
    paula = await member(flow, "paula")
    flow.act_as(paula)
    await flow.put("/api/membership/me/directory", json={"listed": True})
    profile_id = (await flow.db.club_member_profiles.find_one({"user_id": paula["id"]}))["id"]

    # Verwaltung: Eintrag erscheint mit Herkunft, Alter nur hier; Sperre nimmt ihn offline.
    admin = await flow.add_user(role="club_admin")
    flow.act_as(admin)
    rows = (await flow.get("/api/membership/profiles/admin/all")).json()
    row = next(r for r in rows if r["id"] == profile_id)
    assert row["source"] == "member" and row["directory_blocked"] is False and "age" in row
    blocked = await flow.patch(f"/api/membership/profiles/admin/{profile_id}", json={"directory_blocked": True})
    assert blocked.status_code == 200 and blocked.json()["is_active"] is False and blocked.json()["directory_blocked"] is True
    flow.act_as(paula)
    assert (await flow.put("/api/membership/me/directory", json={"listed": True})).status_code == 403
    assert (await flow.get("/api/membership/me/directory")).json()["blocked"] is True
    flow.act_as(admin)
    assert (await flow.patch(f"/api/membership/profiles/admin/{profile_id}", json={"directory_blocked": False, "is_active": True})).json()["is_active"] is True

    # Der Vorstand beendet die Mitgliedschaft: der Eintrag geht offline, ein redaktionelles Profil nicht.
    await flow.db.club_member_profiles.insert_one({"id": "p-red", "slug": "redaktion", "display_name": "Redaktion", "user_id": paula["id"] + "-x", "is_active": True})
    ended = await flow.put(f"/api/membership/user/{paula['id']}", json={"member_status": "former"})
    assert ended.status_code == 200, ended.text
    assert (await flow.db.club_member_profiles.find_one({"id": profile_id}))["is_active"] is False
    assert (await flow.db.club_member_profiles.find_one({"id": "p-red"}))["is_active"] is True
    flow.act_as(paula)
    assert (await flow.put("/api/membership/me/directory", json={"listed": True})).status_code == 403

    # Dasselbe, wenn Dolibarr das Mitglied als ausgetreten meldet.
    otto = await member(flow, "otto")
    flow.act_as(otto)
    await flow.put("/api/membership/me/directory", json={"listed": True})
    await dolibarr_sync.end_membership_of_gone_member(flow.db, {"id": "link-otto", "user_id": otto["id"], "member_key": "verein:1:7", "instance": "verein:1", "status": "verified"})
    assert (await flow.db.club_member_profiles.find_one({"user_id": otto["id"]}))["is_active"] is False
