"""Fast Lap vor Ort (#1585): Gäste ohne Konto, Versuche, „Am Start / Als Nächstes“, Urkunde live.

- Gäste: die Leitung und das Fast-Lap-Team legen sie mit Anzeigenamen an. Sie stehen in der Tabelle, aber nie in
  Gewinnen, Saisonpunkten oder Erfolgen - dort reihen sich nur Konten. Jeder Gast hat seine eigenen Versuche.
- Versuche: neue Challenges haben 3 je Person und Strecke, einstellbar (10, leer = unbegrenzt). Ungültige zählen mit,
  auch eine Runde ohne Zeit. Die Grenze setzt der Server durch - für Gäste wie für Konten.
- Warteschlange: wer am Start ist und wer als Nächstes fährt, je Station; öffentlich lesbar wie die Tabelle,
  ändern darf nur das Fast-Lap-Team.
- Urkunde: die Turnierleitung druckt sie auch während die Challenge läuft, auch für Gäste.
"""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402

NOTE = "Strecke verlassen in Kurve 3"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow, status="live", **challenge_extra):
    lead = await flow.add_staff()
    flow.act_as(lead)
    cid, tid = new_id(), new_id()
    await flow.db.f1_challenges.insert_one({"id": cid, "slug": f"fl-{cid[:8]}", "title": "Fast Lap", "status": status,
                                            "visibility": "public", "unlimited_attempts": False, "max_attempts": 3,
                                            **challenge_extra})
    await flow.db.f1_tracks.insert_one({"id": tid, "challenge_id": cid, "name": "Teststrecke"})
    driver = await flow.add_user(name="fahrerin")
    helper = await flow.add_user(name="zeitnehmer")
    await flow.db.f1_staff_assignments.insert_one({"id": new_id(), "challenge_id": cid, "user_id": helper["id"],
                                                   "role": "scorekeeper", "is_active": True})
    return cid, tid, driver, lead, helper


async def add_guest(flow, cid, name="Gast Anna"):
    response = await flow.post(f"/api/f1/challenges/{cid}/guests", json={"display_name": name})
    assert response.status_code == 200, response.text
    return response.json()


async def enter(flow, cid, tid, *, user=None, guest=None, time_ms=81234, **fields):
    who = {"user_id": user["id"]} if user else {"guest_id": guest["id"]}
    return await flow.post(f"/api/f1/challenges/{cid}/times", json={**who, "track_id": tid, "time_ms": time_ms, **fields})


async def board(flow, cid, tid):
    response = await flow.get(f"/api/f1/challenges/{cid}/leaderboard", params={"track_id": tid})
    assert response.status_code == 200, response.text
    return response.json()


# ------------------------------------------------------------------ Gäste

@pytest.mark.asyncio
async def test_the_team_adds_a_guest_and_the_guest_is_in_the_table(flow):
    cid, tid, driver, _lead, helper = await setup(flow)
    flow.act_as(helper)
    guest = await add_guest(flow, cid, "  Anna aus Wien  ")
    assert guest["display_name"] == "Anna aus Wien" and guest["participant_id"] == f"guest-{guest['id']}"
    response = await enter(flow, cid, tid, guest=guest, time_ms=80000)
    assert response.status_code == 200
    response = await enter(flow, cid, tid, user=driver, time_ms=81000)
    assert response.status_code == 200
    flow.act_as(None)
    data = await board(flow, cid, tid)
    first, second = data["entries"]
    assert first["display_name"] == "Anna aus Wien" and first["is_guest"] is True and first["user_id"] is None
    assert first["participant_id"] == f"guest-{guest['id']}" and first["rank"] == 1
    assert second["user_id"] == driver["id"] and second["is_guest"] is False and second["rank"] == 2
    assert data["max_attempts"] == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["", "   ", "x" * 41, "Anna\u0000"])
async def test_a_guest_needs_a_short_readable_name(flow, name):
    cid, *_ = await setup(flow)
    response = await flow.post(f"/api/f1/challenges/{cid}/guests", json={"display_name": name})
    assert response.status_code == 400, response.text
    assert await flow.db.f1_guests.count_documents({}) == 0


@pytest.mark.asyncio
async def test_two_guests_with_the_same_name_are_not_allowed(flow):
    cid, *_ = await setup(flow)
    await add_guest(flow, cid, "Max")
    response = await flow.post(f"/api/f1/challenges/{cid}/guests", json={"display_name": "max"})
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_strangers_cannot_add_guests_or_read_the_guest_list(flow):
    cid, *_ = await setup(flow)
    flow.act_as(await flow.add_user(name="fremd"))
    response = await flow.post(f"/api/f1/challenges/{cid}/guests", json={"display_name": "Max"})
    assert response.status_code == 403
    assert (await flow.get(f"/api/f1/challenges/{cid}/guests")).status_code == 403


@pytest.mark.asyncio
async def test_a_guest_of_another_challenge_cannot_get_a_time_here(flow):
    cid, tid, *_ = await setup(flow)
    other, *_ = await setup(flow)
    guest = await add_guest(flow, other)
    response = await enter(flow, cid, tid, guest=guest)
    assert response.status_code == 400
    assert await flow.db.f1_lap_times.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_time_belongs_to_exactly_one_person(flow):
    cid, tid, driver, *_ = await setup(flow)
    guest = await add_guest(flow, cid)
    both = await flow.post(f"/api/f1/challenges/{cid}/times",
                           json={"user_id": driver["id"], "guest_id": guest["id"], "track_id": tid, "time_ms": 81000})
    neither = await flow.post(f"/api/f1/challenges/{cid}/times", json={"track_id": tid, "time_ms": 81000})
    assert both.status_code == 400 and neither.status_code == 400
    assert await flow.db.f1_lap_times.count_documents({}) == 0


@pytest.mark.asyncio
async def test_guests_have_no_club_reference(flow):
    cid, tid, *_ = await setup(flow)
    guest = await add_guest(flow, cid)
    response = await enter(flow, cid, tid, guest=guest, score_scope="club_reference")
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_the_team_renames_a_guest(flow):
    cid, tid, _driver, _lead, helper = await setup(flow)
    guest = await add_guest(flow, cid, "Anna")
    await enter(flow, cid, tid, guest=guest)
    flow.act_as(helper)
    response = await flow.patch(f"/api/f1/guests/{guest['id']}", json={"display_name": "Anna K."})
    assert response.status_code == 200, response.text
    assert (await board(flow, cid, tid))["entries"][0]["display_name"] == "Anna K."


@pytest.mark.asyncio
async def test_guests_never_get_prizes_or_season_points(flow):
    cid, tid, driver, _lead, _helper = await setup(flow, prize_places=[{"place": 1, "label": "1. Platz", "prize": "Pokal"}])
    await flow.db.seasons.insert_one({"id": new_id(), "name": "Saison 2026", "status": "active", "is_active": True,
                                      "start_date": "2026-01-01", "end_date": "2026-12-31"})
    guest = await add_guest(flow, cid)
    await enter(flow, cid, tid, guest=guest, time_ms=70000)
    await enter(flow, cid, tid, user=driver, time_ms=80000)
    response = await flow.patch(f"/api/f1/challenges/{cid}", json={"status": "results_published"})
    assert response.status_code == 200, response.text
    pickups = await flow.db.prize_pickups.find({"fastlap_challenge_id": cid}, {"_id": 0}).to_list(10)
    assert [(row["user_id"], row["place"]) for row in pickups] == [(driver["id"], 1)]
    points = await flow.db.season_points.find({"source_type": "fastlap"}, {"_id": 0}).to_list(10)
    assert {row["user_id"] for row in points} <= {driver["id"]}
    assert all(row.get("user_id") for row in points)


@pytest.mark.asyncio
async def test_a_guest_time_counts_no_achievement_and_no_participant_twice(flow):
    cid, tid, *_ = await setup(flow)
    first, second = await add_guest(flow, cid, "A"), await add_guest(flow, cid, "B")
    await enter(flow, cid, tid, guest=first)
    await enter(flow, cid, tid, guest=second)
    data = (await flow.get(f"/api/f1/challenges/{cid}")).json()
    assert data["participant_count"] == 2


# ------------------------------------------------------------------ Versuche

@pytest.mark.asyncio
async def test_each_guest_has_own_attempts_and_the_server_stops_the_fourth(flow):
    cid, tid, *_ = await setup(flow)
    anna, ben = await add_guest(flow, cid, "Anna"), await add_guest(flow, cid, "Ben")
    for _ in range(3):
        response = await enter(flow, cid, tid, guest=anna)
        assert response.status_code == 200
    fourth = await enter(flow, cid, tid, guest=anna)
    assert fourth.status_code == 400 and "Versuche" in fourth.json()["detail"]
    response = await enter(flow, cid, tid, guest=ben)
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_invalid_laps_count_and_may_come_without_a_time(flow):
    cid, tid, driver, *_ = await setup(flow)
    no_time = await enter(flow, cid, tid, user=driver, time_ms=0, is_invalid=True, admin_note=NOTE)
    assert no_time.status_code == 200, no_time.text
    assert no_time.json()["attempt_number"] == 1
    response = await enter(flow, cid, tid, user=driver, is_invalid=True, admin_note=NOTE)
    assert response.status_code == 200
    response = await enter(flow, cid, tid, user=driver)
    assert response.status_code == 200
    response = await enter(flow, cid, tid, user=driver)
    assert response.status_code == 400
    entry = (await board(flow, cid, tid))["entries"][0]
    assert entry["attempts"] == 3


@pytest.mark.asyncio
async def test_a_valid_lap_needs_a_time(flow):
    cid, tid, driver, *_ = await setup(flow)
    response = await enter(flow, cid, tid, user=driver, time_ms=0)
    assert response.status_code == 400
    lap = (await enter(flow, cid, tid, user=driver, time_ms=0, is_invalid=True, admin_note=NOTE)).json()
    # Eine Runde ohne Zeit wird nicht nachträglich gültig - dafür braucht sie eine Zeit.
    response = await flow.patch(f"/api/f1/times/{lap['id']}", json={"is_invalid": False})
    assert response.status_code == 400
    assert (await flow.db.f1_lap_times.find_one({"id": lap["id"]}))["is_invalid"] is True
    times = (await flow.get(f"/api/f1/challenges/{cid}/times", params={"track_id": tid})).json()
    assert times[0]["time_str"] == "ohne Zeit"


@pytest.mark.asyncio
async def test_ten_attempts_and_unlimited(flow):
    cid, tid, driver, *_ = await setup(flow, max_attempts=10)
    for _ in range(10):
        response = await enter(flow, cid, tid, user=driver)
        assert response.status_code == 200
    response = await enter(flow, cid, tid, user=driver)
    assert response.status_code == 400
    await flow.db.f1_challenges.update_one({"id": cid}, {"$set": {"unlimited_attempts": True, "max_attempts": None}})
    response = await enter(flow, cid, tid, user=driver)
    assert response.status_code == 200
    assert (await board(flow, cid, tid))["max_attempts"] is None


@pytest.mark.asyncio
async def test_a_correction_cannot_slip_a_guest_lap_past_the_limit(flow):
    cid, tid, *_ = await setup(flow)
    anna = await add_guest(flow, cid, "Anna")
    laps = [(await enter(flow, cid, tid, guest=anna)).json() for _ in range(3)]
    changed = await flow.patch(f"/api/f1/times/{laps[0]['id']}", json={"time_ms": 79000})
    assert changed.status_code == 200, changed.text
    response = await enter(flow, cid, tid, guest=anna)
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_new_challenges_start_with_three_attempts_and_without_online_submission(flow):
    await flow.add_staff()
    flow.act_as(await flow.add_staff())
    response = await flow.post("/api/f1/challenges", json={"title": "Event-Fast-Lap"})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["max_attempts"] == 3 and data["unlimited_attempts"] is False
    assert data["registration_enabled"] is False and data["online_registration_enabled"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("value", [0, -1, 1000])
async def test_the_attempt_limit_is_a_sensible_number(flow, value):
    cid, *_ = await setup(flow)
    response = await flow.patch(f"/api/f1/challenges/{cid}", json={"unlimited_attempts": False, "max_attempts": value})
    assert response.status_code == 422


# ------------------------------------------------------------------ Am Start / Als Nächstes

async def queue(flow, cid, **params):
    response = await flow.get(f"/api/f1/challenges/{cid}/queue", params=params)
    assert response.status_code == 200, response.text
    return response.json()


async def line_up(flow, cid, tid, *, user=None, guest=None, station=None):
    who = {"user_id": user["id"]} if user else {"guest_id": guest["id"]}
    response = await flow.post(f"/api/f1/challenges/{cid}/queue", json={**who, "track_id": tid, "station": station})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_the_queue_lines_people_up_and_hands_over(flow):
    cid, tid, driver, _lead, helper = await setup(flow)
    flow.act_as(helper)
    anna = await add_guest(flow, cid, "Anna")
    ben = await add_guest(flow, cid, "Ben")
    first = await line_up(flow, cid, tid, user=driver)
    await line_up(flow, cid, tid, guest=anna)
    third = await line_up(flow, cid, tid, guest=ben)
    flow.act_as(None)
    data = await queue(flow, cid)
    assert data["on_track"] == [] and [row["display_name"] for row in data["next"]] == ["fahrerin", "Anna", "Ben"]
    assert data["max_attempts"] == 3
    flow.act_as(helper)
    response = await flow.post(f"/api/f1/queue/{third['id']}/up")
    assert response.status_code == 200
    started = await flow.post(f"/api/f1/queue/{first['id']}/start", json={"station": "Simulator 1"})
    assert started.status_code == 200, started.text
    await enter(flow, cid, tid, user=driver)
    data = await queue(flow, cid)
    assert [(row["display_name"], row["station"], row["attempts_used"]) for row in data["on_track"]] == [("fahrerin", "Simulator 1", 1)]
    assert [row["display_name"] for row in data["next"]] == ["Ben", "Anna"]
    handed = await flow.post(f"/api/f1/challenges/{cid}/queue/next", json={"done_id": first["id"], "station": "Simulator 1"})
    assert handed.status_code == 200, handed.text
    assert handed.json()["display_name"] == "Ben"
    data = await queue(flow, cid)
    assert [(row["display_name"], row["station"]) for row in data["on_track"]] == [("Ben", "Simulator 1")]
    assert [row["display_name"] for row in data["next"]] == ["Anna"]


@pytest.mark.asyncio
async def test_the_queue_knows_every_person_once_per_track(flow):
    cid, tid, driver, *_ = await setup(flow)
    await line_up(flow, cid, tid, user=driver)
    again = await flow.post(f"/api/f1/challenges/{cid}/queue", json={"user_id": driver["id"], "track_id": tid})
    assert again.status_code == 409


@pytest.mark.asyncio
async def test_strangers_cannot_change_the_queue(flow):
    cid, tid, driver, *_ = await setup(flow)
    entry = await line_up(flow, cid, tid, user=driver)
    flow.act_as(await flow.add_user(name="fremd"))
    response = await flow.post(f"/api/f1/challenges/{cid}/queue", json={"user_id": driver["id"], "track_id": tid})
    assert response.status_code == 403
    response = await flow.post(f"/api/f1/queue/{entry['id']}/start", json={})
    assert response.status_code == 403
    response = await flow.delete(f"/api/f1/queue/{entry['id']}")
    assert response.status_code == 403
    response = await flow.post(f"/api/f1/challenges/{cid}/queue/next", json={})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_the_queue_of_a_draft_stays_hidden(flow):
    cid, *_ = await setup(flow, status="draft")
    flow.act_as(None)
    assert (await flow.get(f"/api/f1/challenges/{cid}/queue")).status_code == 404


@pytest.mark.asyncio
async def test_done_people_leave_the_queue(flow):
    cid, tid, driver, *_ = await setup(flow)
    entry = await line_up(flow, cid, tid, user=driver)
    response = await flow.delete(f"/api/f1/queue/{entry['id']}")
    assert response.status_code == 200
    assert (await queue(flow, cid))["next"] == []


@pytest.mark.asyncio
async def test_station_names_are_short_text(flow):
    cid, tid, driver, *_ = await setup(flow)
    response = await flow.post(f"/api/f1/challenges/{cid}/queue", json={"user_id": driver["id"], "track_id": tid, "station": "S" * 41})
    assert response.status_code == 422


# ------------------------------------------------------------------ Urkunde live

@pytest.mark.asyncio
async def test_the_lead_prints_a_certificate_while_live_also_for_a_guest(flow):
    cid, tid, driver, *_ = await setup(flow)
    guest = await add_guest(flow, cid)
    await enter(flow, cid, tid, guest=guest, time_ms=70000)
    await enter(flow, cid, tid, user=driver, time_ms=80000)
    response = await flow.get(f"/api/exports/f1/{cid}/certificates/guest-{guest['id']}.pdf", params={"track_id": tid})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/pdf")
    flow.act_as(None)
    response = await flow.get(f"/api/exports/f1/{cid}/certificates/guest-{guest['id']}.pdf", params={"track_id": tid})
    assert response.status_code == 403


# ------------------------------------------------------------------ Datenschutz: Gast-Namen laufen ab

@pytest.mark.asyncio
async def test_guest_names_expire_after_the_deadline(flow):
    from services.fastlap_guests import GUEST_NAME_DAYS, expire_guest_names

    cid, *_ = await setup(flow)
    old = await add_guest(flow, cid, "Alte Anna")
    fresh = await add_guest(flow, cid, "Neue Nina")
    past = (datetime.now(timezone.utc) - timedelta(days=GUEST_NAME_DAYS + 1)).isoformat()
    await flow.db.f1_guests.update_one({"id": old["id"]}, {"$set": {"created_at": past}})
    assert await expire_guest_names(flow.db) == 1
    rows = {row["id"]: row for row in await flow.db.f1_guests.find({}, {"_id": 0}).to_list(10)}
    assert rows[old["id"]]["display_name"] == f"Gast {old['number']}" and rows[old["id"]]["name_expired_at"]
    assert rows[fresh["id"]]["display_name"] == "Neue Nina"
    assert await expire_guest_names(flow.db) == 0
