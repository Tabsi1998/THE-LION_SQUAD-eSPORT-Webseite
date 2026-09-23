"""„Über den Verein“ mit echten Daten (#406): Vereinsdaten aus Dolibarr über den Schalter der
Vereinsdaten (sonst Handfelder), gezählte Zahlen, Spiele mit Turnieren je Spiel (Editionen zählen
zum Hauptspiel), die letzten Vereinsevents mit Bild, Texte aus der Redaktion mit Standardwerten."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from routes import home_routes  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def seed(flow):
    now = datetime.now(timezone.utc)
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"id": "branding", "club_name": "THE LION SQUAD", "legal_name": "THE LION SQUAD - eSPORTS", "zvr_number": "123456789", "city": "Innsbruck"}}, upsert=True)
    await flow.db.memberships.insert_many([{"id": "m1", "user_id": "u1", "member_status": "active"}, {"id": "m2", "user_id": "u2", "member_status": "former"}])
    await flow.db.games.insert_many([
        {"id": "cod", "name": "Call of Duty", "slug": "cod", "kind": "series", "logo_url": "/uploads/cod.png"},
        {"id": "bo7", "name": "Black Ops 7", "slug": "bo7", "kind": "edition", "parent_game_id": "cod"},
        {"id": "rl", "name": "Rocket League", "slug": "rl", "kind": "standalone"},
        {"id": "f1", "name": "F1 25", "slug": "f1", "kind": "standalone"},
    ])
    await flow.db.tournaments.insert_many([
        {"id": "t1", "slug": "cup", "title": "Cup", "status": "completed", "is_public": True, "game_id": "bo7"},
        {"id": "t2", "slug": "cup2", "title": "Cup 2", "status": "scheduled", "is_public": True, "game_id": "cod"},
        {"id": "t3", "slug": "geheim", "title": "Geheim", "status": "scheduled", "is_public": False, "game_id": "rl"},
        {"id": "t4", "slug": "entwurf", "title": "Entwurf", "status": "draft", "game_id": "rl"},
    ])
    await flow.db.references.insert_many([{"id": "r1", "title": "Liga", "game_id": "rl", "is_active": True}, {"id": "r2", "title": "Alt", "game_id": "rl", "is_active": False}])
    await flow.db.user_achievements.insert_many([{"user_id": "u1", "tier_code": "a"}, {"user_id": "u2", "tier_code": "b"}])
    await flow.db.events.insert_many([
        {"id": "e1", "slug": "grillen", "name": "Grillabend", "status": "completed", "visibility": "public", "event_type": "grill_evening", "banner_url": "/uploads/grill.jpg", "start_date": now - timedelta(days=30)},
        {"id": "e2", "slug": "lan", "name": "LAN", "status": "completed", "visibility": "public", "event_type": "lan_party", "banner_url": "/uploads/lan.jpg", "start_date": now - timedelta(days=90)},
        {"id": "e3", "slug": "online", "name": "Online", "status": "completed", "visibility": "public", "event_type": "online_event", "banner_url": "/uploads/o.jpg", "start_date": now - timedelta(days=10)},
        {"id": "e4", "slug": "intern", "name": "Intern", "status": "completed", "visibility": "members", "event_type": "club_evening", "banner_url": "/uploads/i.jpg", "start_date": now - timedelta(days=5)},
        {"id": "e5", "slug": "ohne-bild", "name": "Ohne Bild", "status": "completed", "visibility": "public", "event_type": "club_evening", "start_date": now - timedelta(days=3)},
        {"id": "e6", "slug": "bald", "name": "Bald", "status": "scheduled", "visibility": "public", "event_type": "club_evening", "banner_url": "/uploads/b.jpg", "start_date": now + timedelta(days=3)},
    ])


@pytest.mark.asyncio
async def test_about_counts_games_events_and_uses_hand_fields_without_dolibarr(flow):
    await seed(flow)
    page = (await flow.get("/api/home/about")).json()
    assert page["numbers"] == {"members": 1, "tournaments": 2, "events": 5, "participations": 2, "achievements": 2}
    assert [(g["id"], g["tournaments"], g["references"]) for g in page["games"]] == [("cod", 2, 0), ("rl", 0, 1), ("f1", 0, 0)], "Edition zählt zum Hauptspiel, keine Entwürfe, keine nicht-öffentlichen"
    assert page["games"][0]["logo_url"] == "/uploads/cod.png"
    assert [e["id"] for e in page["offline_events"]] == ["e1", "e2"], "nur vergangene, öffentliche Treffen mit Bild"
    assert page["organization"]["source"] == "manual" and page["organization"]["zvr_number"] == "123456789" and page["organization"]["registered_seat"] == "Innsbruck"
    assert page["organization"]["founded_year"] is None and page["texts"]["hero_title"] == home_routes.ABOUT_DEFAULTS["hero_title"]
    assert page["texts"]["pillars"] == ["Fairplay", "Gemeinschaft", "Erfolg", "Leidenschaft"] and "purpose" not in page["texts"]


@pytest.mark.asyncio
async def test_texts_are_editable_by_content_and_dolibarr_wins_for_founding_and_purpose(flow):
    await seed(flow)
    editor = await flow.add_user(role="club_admin")
    flow.act_as(editor)
    saved = await flow.put("/api/home/about/admin", json={
        "hero_title": "Ein Rudel.", "values_text": "Wir **halten** zusammen.\n\nUnd feiern.", "pillars": ["Fairplay", " Spaß ", "", "Fairplay"],
        "offline_items": ["Grillen"], "founded_year": 2019, "purpose": "Förderung des eSports", "nonprofit": True,
    })
    assert saved.status_code == 200, saved.text
    texts = saved.json()["texts"]
    assert texts["hero_title"] == "Ein Rudel." and texts["pillars"] == ["Fairplay", "Spaß"] and texts["offline_items"] == ["Grillen"]
    assert texts["games_title"] == home_routes.ABOUT_DEFAULTS["games_title"], "nicht gesetzte Texte behalten den Standard"

    flow.act_as(None)
    page = (await flow.get("/api/home/about")).json()
    assert page["organization"]["founded_year"] == 2019 and page["organization"]["purpose"] == "Förderung des eSports" and page["organization"]["nonprofit"] is True
    assert page["texts"]["values_text"] == "Wir **halten** zusammen.\n\nUnd feiern."

    # Vereinsdaten aus Dolibarr (Schalter der Rechtlichen Angaben): Gründung, Zweck, gemeinnützig gewinnen.
    fake = FakeDolibarr()
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"legal_from_dolibarr": True}})
    await flow.db.dolibarr_public.insert_one({"id": "state", "organization": {**fake.organization, "founded": "2021-05-01", "purpose": "Zweck aus Dolibarr", "nonprofit": False}, "board": fake.board, "fetched_at": datetime.now(timezone.utc).isoformat()})
    page = (await flow.get("/api/home/about")).json()
    assert page["organization"]["source"] == "dolibarr" and page["organization"]["founded_year"] == 2021
    assert page["organization"]["purpose"] == "Zweck aus Dolibarr" and page["organization"]["nonprofit"] is False
    assert page["organization"]["legal_name"] == "Testverein Löwen" and page["organization"]["zvr_number"] == "123456789"

    flow.act_as(editor)
    admin = (await flow.get("/api/home/about/admin")).json()
    assert admin["organization"]["source"] == "dolibarr" and admin["games"] == 3 and admin["offline_events"] == 2 and admin["texts"]["founded_year"] == 2019

    # Nur die Redaktion (Bereich Content) darf schreiben.
    flow.act_as(await flow.add_user(role="player"))
    assert (await flow.put("/api/home/about/admin", json={"hero_title": "x"})).status_code == 403
    assert (await flow.get("/api/home/about/admin")).status_code == 403
