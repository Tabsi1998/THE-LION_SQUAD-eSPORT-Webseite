"""Event-Seite als Startpunkt (#1183), Kopfbild (#1273) und Fakten-Kasten (#1346): „Mitbringen“ und Highlights mit
festen Grenzen, der eigene Stand je Turnier (auch mit dem Team) nur für die Person selbst, und das Kopfbild als Foto
oder Logo."""
import pathlib
import random
import sys

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402
from services import event_facts  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_bring_along_and_highlights_are_saved_with_limits(flow):
    admin = await flow.add_user(role="tournament_admin", name="leitung")
    flow.act_as(admin)
    created = await flow.post("/api/events", json={
        "name": "Herbst-LAN", "status": "scheduled",
        "bring_along": ["  eigener Controller ", "", "Kopfhörer"],
        "highlights": [{"icon": "monitor", "text": "Switch-Stationen"}, {"icon": "vr", "text": "VR-Ecke"}, {"icon": "star", "text": "  "}],
    })
    assert created.status_code == 200, created.text
    event = created.json()
    assert event["bring_along"] == ["eigener Controller", "Kopfhörer"]
    assert event["highlights"] == [{"icon": "monitor", "text": "Switch-Stationen"}, {"icon": "vr", "text": "VR-Ecke"}], "leere Kacheln fallen weg"
    assert event["banner_style"] == "auto"

    too_many = await flow.patch(f"/api/events/{event['id']}", json={"bring_along": [f"Punkt {n}" for n in range(9)]})
    assert too_many.status_code == 400 and "höchstens 8" in too_many.json()["detail"]
    too_long = await flow.patch(f"/api/events/{event['id']}", json={"bring_along": ["x" * 81]})
    assert too_long.status_code == 400
    unknown = await flow.patch(f"/api/events/{event['id']}", json={"highlights": [{"icon": "rocket", "text": "Neu"}]})
    assert unknown.status_code == 400 and "Symbol" in unknown.json()["detail"]
    seven = await flow.patch(f"/api/events/{event['id']}", json={"highlights": [{"icon": "gamepad", "text": f"Punkt {n}"} for n in range(7)]})
    assert seven.status_code == 400

    assert (await flow.patch(f"/api/events/{event['id']}", json={"banner_focus_x": 130})).status_code == 422, "Fokuspunkt in Prozent"
    cleared = await flow.patch(f"/api/events/{event['id']}", json={"bring_along": None, "banner_focus_x": 100, "banner_focus_y": 20})
    assert cleared.status_code == 200, cleared.text
    stored = await flow.db.events.find_one({"id": event["id"]}, {"_id": 0})
    assert stored["bring_along"] == [] and stored["highlights"] == [{"icon": "monitor", "text": "Switch-Stationen"}, {"icon": "vr", "text": "VR-Ecke"}]
    assert stored["banner_focus_x"] == 100 and stored["banner_focus_y"] == 20

    meta = (await flow.get("/api/events/meta")).json()
    assert {"k": "public_event", "l": "Öffentliches Event"} in meta["types"], "Schilder auf Deutsch (#1273)"


async def seed_event_with_tournaments(flow):
    await flow.db.events.insert_one({"id": "e-lan", "slug": "herbst-lan", "name": "Herbst-LAN", "status": "scheduled", "visibility": "public",
                                     "start_date": "2026-11-13T16:00:00+00:00", "end_date": "2026-11-15T20:00:00+00:00"})
    await flow.db.tournaments.insert_many([
        {"id": "t-solo", "slug": "mk", "title": "Mario Kart Grand Prix", "event_id": "e-lan", "status": "registration_open", "visibility": "public", "is_public": True,
         "team_mode": "solo", "start_date": "2026-11-13T18:00:00+00:00"},
        {"id": "t-team", "slug": "rl", "title": "Rocket League 2v2", "event_id": "e-lan", "status": "registration_open", "visibility": "public", "is_public": True,
         "team_mode": "team", "start_date": "2026-11-14T15:00:00+00:00"},
        {"id": "t-voll", "slug": "fc", "title": "FC 26 Cup", "event_id": "e-lan", "status": "registration_open", "visibility": "public", "is_public": True,
         "team_mode": "solo", "start_date": "2026-11-14T12:00:00+00:00"},
    ])
    await flow.db.f1_challenges.insert_one({"id": "f-spa", "slug": "spa", "title": "Fast Lap Spa", "event_id": "e-lan", "status": "live", "visibility": "public"})


@pytest.mark.asyncio
async def test_own_state_per_tournament_only_for_the_person(flow):
    await seed_event_with_tournaments(flow)
    lena = await flow.add_user(role="player", name="lena")
    noah = await flow.add_user(role="player", name="noah")
    await flow.db.teams.insert_one({"id": "team-rocket", "name": "Lions Rocket", "member_ids": [noah["id"], lena["id"]], "leader_id": noah["id"]})
    await flow.db.tournament_registrations.insert_many([
        {"id": new_id(), "tournament_id": "t-solo", "user_id": lena["id"], "status": "approved", "display_name": "Lena"},
        {"id": new_id(), "tournament_id": "t-team", "user_id": noah["id"], "team_id": "team-rocket", "status": "approved", "display_name": "Lions Rocket"},
        {"id": new_id(), "tournament_id": "t-voll", "user_id": lena["id"], "status": "waitlist", "display_name": "Lena"},
        {"id": new_id(), "tournament_id": "t-voll", "user_id": noah["id"], "status": "cancelled", "display_name": "Noah"},
    ])
    await flow.db.f1_lap_times.insert_one({"id": new_id(), "challenge_id": "f-spa", "user_id": lena["id"], "time_ms": 91000})

    flow.act_as(lena)
    event = (await flow.get("/api/events/herbst-lan")).json()
    states = {item["id"]: item["my_status"] for item in [*event["tournaments"], *event["f1_challenges"]]}
    assert states["t-solo"] == {"state": "approved", "label": "Du bist dabei", "team_name": None}
    assert states["t-team"] == {"state": "approved", "label": "Du bist dabei", "team_name": "Lions Rocket"}, "das eigene Team zählt"
    assert states["t-voll"]["label"] == "Warteliste"
    assert states["f-spa"]["label"] == "Du bist gefahren"

    flow.act_as(noah)
    event = (await flow.get("/api/events/herbst-lan")).json()
    states = {item["id"]: item["my_status"] for item in [*event["tournaments"], *event["f1_challenges"]]}
    assert states["t-solo"] is None and states["t-voll"] is None, "storniert und fremd: kein Schild"
    assert states["t-team"]["team_name"] == "Lions Rocket" and states["f-spa"] is None

    flow.act_as(None)
    event = (await flow.get("/api/events/herbst-lan")).json()
    assert all(item["my_status"] is None for item in [*event["tournaments"], *event["f1_challenges"]]), "Gäste sehen keine Schilder"


@pytest.mark.asyncio
async def test_banner_is_judged_photo_or_logo(flow, tmp_path, monkeypatch):
    monkeypatch.setattr(event_facts, "PUBLIC_UPLOAD_DIR", tmp_path)
    logo = Image.new("RGBA", (300, 120), (0, 0, 0, 0))
    for x in range(100, 200):
        for y in range(40, 80):
            logo.putpixel((x, y), (255, 255, 255, 255))
    logo.save(tmp_path / "logo.png")
    rng = random.Random(7)
    photo = Image.new("RGB", (160, 90))
    photo.putdata([(rng.randrange(256), rng.randrange(256), rng.randrange(256)) for _ in range(160 * 90)])
    photo.save(tmp_path / "foto.jpg", quality=90)

    admin = await flow.add_user(role="tournament_admin", name="leitung")
    flow.act_as(admin)
    with_logo = (await flow.post("/api/events", json={"name": "Logo-Event", "status": "scheduled", "banner_url": "/api/static/uploads/logo.png"})).json()
    photo_body = {"name": "Foto-Event", "status": "scheduled", "banner_url": "/api/static/uploads/foto.jpg", "banner_focus_x": 30, "banner_focus_y": 70}
    with_photo = (await flow.post("/api/events", json=photo_body)).json()
    assert with_logo["banner_kind"] == "logo" and with_photo["banner_kind"] == "photo"

    flow.act_as(None)
    page = (await flow.get(f"/api/events/{with_photo['slug']}")).json()
    assert page["banner"] == {"url": "/api/static/uploads/foto.jpg", "kind": "photo", "focus_x": 30, "focus_y": 70}
    assert (await flow.get(f"/api/events/{with_logo['slug']}")).json()["banner"]["kind"] == "logo"

    flow.act_as(admin)
    assert (await flow.patch(f"/api/events/{with_logo['id']}", json={"banner_style": "photo"})).status_code == 200
    flow.act_as(None)
    assert (await flow.get(f"/api/events/{with_logo['slug']}")).json()["banner"]["kind"] == "photo", "die Wahl der Verwaltung zählt"

    # Ältere Events ohne Einschätzung: einmal beim ersten Abruf; fremde Bilder gelten als Foto.
    await flow.db.events.insert_one({"id": "e-alt", "slug": "alt", "name": "Alt", "status": "scheduled", "visibility": "public", "banner_url": "/api/static/uploads/logo.png"})
    assert (await flow.get("/api/events/alt")).json()["banner"]["kind"] == "logo"
    assert (await flow.db.events.find_one({"id": "e-alt"}))["banner_kind"] == "logo"
    assert event_facts.banner_view({"banner_url": "https://example.test/x.png"})["kind"] == "photo"
    assert await event_facts.banner_kind("/api/static/uploads/../geheim.png") is None
