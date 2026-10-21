"""Eine Rangfolge überall (#1584): Tabelle, Gesamtwertung, Gewinne, Saisonpunkte (auch die Ersatzrechnung der
Saisonseite), Gewinn-Erinnerung, Widget, Event-Rückblick, Profil (Pole, Bestzeiten, Platzierungen) und Erfolge rechnen
mit derselben Regel: Strafe eingerechnet, ungültige und Vereins-Referenzzeiten nicht gewertet, bei gleicher Zeit liegt
die früher gefahrene vorn.

Die Bühne: Anna und Bert fahren beide 1:20.000, Anna um 10 Uhr, Bert um 11 Uhr - Bert ist in der Datenbank zuerst
gespeichert, damit keine Stelle zufällig über die Reihenfolge der Abfrage richtig liegt. Carl ist schneller, aber
ungültig; Dora ist schneller, aber Vereins-Referenz; Emil hat eine alte Zeit ohne Strafsekunden-Wert (``None``)."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id, now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


async def stage(flow, **challenge_extra):
    staff = await flow.add_staff()
    flow.act_as(staff)
    people = {}
    for name in ("anna", "bert", "carl", "dora", "emil"):
        user = await flow.add_user(name=name)
        await flow.db.users.update_one({"id": user["id"]}, {"$set": {"privacy_public_profile": True}})
        people[name] = user
    cid, tid = new_id(), new_id()
    await flow.db.f1_challenges.insert_one({
        "id": cid, "slug": f"fl-{cid[:8]}", "title": "Hallen-Hotlap", "status": "live", "visibility": "public",
        "prize_places": [{"place": 1, "value": "Pokal"}, {"place": 2, "value": "Kappe"}],
        "points_per_position": [25, 18, 15, 12, 10], **challenge_extra,
    })
    await flow.db.f1_tracks.insert_one({"id": tid, "challenge_id": cid, "name": "Spielberg", "order_index": 0})

    async def lap(name, ms, hour, **extra):
        await flow.db.f1_lap_times.insert_one({
            "id": new_id(), "challenge_id": cid, "track_id": tid, "user_id": people[name]["id"], "time_ms": ms,
            "penalty_seconds": 0, "is_invalid": False, "score_scope": "official",
            "created_at": f"2026-10-31T{hour}:00:00+00:00", **extra,
        })

    await lap("bert", 80000, "11")
    await lap("anna", 80000, "10")
    await lap("carl", 70000, "09", is_invalid=True, admin_note="Abkürzung genommen")
    await lap("dora", 60000, "09", score_scope="club_reference")
    await lap("emil", 90000, "12", penalty_seconds=None)
    ids = {person["id"]: name for name, person in people.items()}
    return cid, tid, people, ids


EXPECTED = ["anna", "bert", "emil"]


@pytest.mark.asyncio
async def test_leaderboard(flow):
    cid, tid, _people, ids = await stage(flow)
    board = await flow.get(f"/api/f1/challenges/{cid}/leaderboard?track_id={tid}")
    assert board.status_code == 200, board.text
    entries = board.json()["entries"]
    assert [ids[e["user_id"]] for e in entries] == EXPECTED
    assert [e["rank"] for e in entries] == [1, 2, 3]
    assert entries[1]["gap_str"] == "+0.000s"
    assert entries[2]["time_ms"] == 90000


@pytest.mark.asyncio
async def test_leaderboard_counts_invalid_laps_as_attempts(flow):
    cid, tid, people, _ids = await stage(flow)
    await flow.db.f1_lap_times.insert_one({"id": new_id(), "challenge_id": cid, "track_id": tid, "user_id": people["anna"]["id"],
                                           "time_ms": 79000, "is_invalid": True, "admin_note": "Track Limits",
                                           "created_at": "2026-10-31T13:00:00+00:00"})
    entries = (await flow.get(f"/api/f1/challenges/{cid}/leaderboard?track_id={tid}")).json()["entries"]
    assert entries[0]["attempts"] == 2 and entries[0]["time_ms"] == 80000


@pytest.mark.asyncio
async def test_championship(flow):
    cid, tid, _people, ids = await stage(flow)
    data = (await flow.get(f"/api/f1/challenges/{cid}/championship")).json()
    assert [ids[s["user_id"]] for s in data["standings"]] == EXPECTED
    assert [ids[r["user_id"]] for r in data["per_track"][tid]["results"]] == EXPECTED


@pytest.mark.asyncio
async def test_prizes(flow):
    cid, _tid, _people, ids = await stage(flow)
    response = await flow.patch(f"/api/f1/challenges/{cid}", json={"status": "completed"})
    assert response.status_code == 200
    pickups = await flow.db.prize_pickups.find({"fastlap_challenge_id": cid}, {"_id": 0}).to_list(10)
    assert {p["place"]: ids[p["user_id"]] for p in pickups} == {1: "anna", 2: "bert"}


@pytest.mark.asyncio
async def test_championship_prizes(flow):
    cid, _tid, _people, ids = await stage(flow, is_championship=True)
    response = await flow.patch(f"/api/f1/challenges/{cid}", json={"status": "completed"})
    assert response.status_code == 200
    pickups = await flow.db.prize_pickups.find({"fastlap_challenge_id": cid}, {"_id": 0}).to_list(10)
    assert {p["place"]: ids[p["user_id"]] for p in pickups} == {1: "anna", 2: "bert"}


@pytest.mark.asyncio
async def test_season_points(flow):
    cid, tid, _people, ids = await stage(flow)
    await flow.db.seasons.insert_one({"id": new_id(), "slug": "saison", "name": "Saison", "status": "active"})
    response = await flow.patch(f"/api/f1/challenges/{cid}", json={"status": "results_published"})
    assert response.status_code == 200
    rows = await flow.db.season_points.find({"source_id": f"{cid}:{tid}"}, {"_id": 0}).to_list(10)
    assert sorted((r["rank"], ids[r["user_id"]]) for r in rows) == [(1, "anna"), (2, "bert"), (3, "emil")]


@pytest.mark.asyncio
async def test_season_page_fallback(flow):
    cid, _tid, _people, ids = await stage(flow, status="results_published")
    await flow.db.seasons.insert_one({"id": new_id(), "slug": "saison-alt", "name": "Saison", "status": "active",
                                      "f1_challenge_ids": [cid], "points_per_position": [25, 18, 15]})
    data = (await flow.get("/api/seasons/saison-alt/standings")).json()
    points = {ids[row["user_id"]]: row["points"] for row in data["standings"]}
    assert points == {"anna": 25, "bert": 18, "emil": 15}


@pytest.mark.asyncio
async def test_prize_reminder(flow):
    end = (now_utc() + timedelta(minutes=30)).isoformat()
    cid, _tid, people, _ids = await stage(flow, end_date=end)
    from services.f1_prize_reminder import schedule_f1_prize_reminders
    await schedule_f1_prize_reminders()
    rows = await flow.db.notifications.find({"kind": "f1_prize_reminder"}, {"_id": 0}).to_list(10)
    assert {row["user_id"]: row["meta"]["rank"] for row in rows} == {people["anna"]["id"]: 1, people["bert"]["id"]: 2}


@pytest.mark.asyncio
async def test_widget(flow):
    cid, tid, _people, _ids = await stage(flow)
    data = (await flow.get(f"/api/widgets/f1/{cid}/leaderboard?track_id={tid}")).json()
    assert [e["display_name"] for e in data["entries"]] == EXPECTED
    assert [e["rank"] for e in data["entries"]] == [1, 2, 3]


@pytest.mark.asyncio
async def test_event_recap_podium(flow):
    cid, _tid, _people, _ids = await stage(flow)
    from routes.event_routes import _fastlap_recap_podium
    challenge = await flow.db.f1_challenges.find_one({"id": cid}, {"_id": 0})
    podium = await _fastlap_recap_podium(flow.db, challenge)
    assert [row["name"] for row in podium] == EXPECTED
    assert [row["rank"] for row in podium] == [1, 2, 3]


@pytest.mark.asyncio
async def test_profile_pole_and_best_times(flow):
    _cid, _tid, _people, _ids = await stage(flow)
    anna = (await flow.get("/api/users/public/anna")).json()
    bert = (await flow.get("/api/users/public/bert")).json()
    dora = (await flow.get("/api/users/public/dora")).json()
    assert anna["stats"]["pole_positions"] == 1 and anna["f1_bests"][0]["is_leader"] is True
    assert bert["stats"]["pole_positions"] == 0 and bert["f1_bests"][0]["is_leader"] is False
    assert dora["f1_bests"] == [] and dora["stats"]["pole_positions"] == 0, "Referenzzeiten zählen nicht als Bestzeit"


@pytest.mark.asyncio
async def test_profile_references_rank(flow):
    cid, tid, people, _ids = await stage(flow)
    from services.profile_references import _ranked_fastlap_entries
    assert (await _ranked_fastlap_entries(cid, tid, people["anna"]["id"], False))["rank"] == 1
    assert (await _ranked_fastlap_entries(cid, tid, people["bert"]["id"], False))["rank"] == 2


@pytest.mark.asyncio
async def test_achievement_track_record_and_pole_count(flow):
    _cid, tid, people, _ids = await stage(flow)
    from services.achievement_counters import Context
    from services.achievement_progress import compute_user_progress
    bests = await Context(flow.db, people["bert"]["id"]).track_bests()
    assert bests[tid][0] == people["anna"]["id"]
    assert (await compute_user_progress(people["anna"]["id"]))["pole_count"] == 1
    assert (await compute_user_progress(people["bert"]["id"]))["pole_count"] == 0


@pytest.mark.asyncio
async def test_new_best_message_only_for_a_really_faster_lap(flow, monkeypatch):
    cid, tid, people, _ids = await stage(flow)
    sent = []

    async def fake_send(*args, **kwargs):
        sent.append(args)

    import discord_service
    monkeypatch.setattr(discord_service, "send_public_discord", fake_send)
    same = await flow.post(f"/api/f1/challenges/{cid}/times", json={"user_id": people["emil"]["id"], "track_id": tid, "time_ms": 80000})
    assert same.status_code == 200, same.text
    assert sent == [], "gleich schnell ist keine neue Bestzeit - die frühere Zeit bleibt vorn"
    faster = await flow.post(f"/api/f1/challenges/{cid}/times", json={"user_id": people["emil"]["id"], "track_id": tid, "time_ms": 79999})
    assert faster.status_code == 200, faster.text
    assert len(sent) == 1


@pytest.mark.asyncio
async def test_profile_podium_counts_fastlap_places(flow):
    """Profile ohne Nullen (#1268): „Podium“ zählt Fast-Lap-Plätze 1 bis 3 je Strecke mit, Referenzzeiten nicht."""
    _cid, _tid, _people, _ids = await stage(flow)
    stats = {name: (await flow.get(f"/api/users/public/{name}")).json()["stats"] for name in ("anna", "emil", "dora")}
    assert stats["anna"]["top3"] == 1
    assert stats["emil"]["top3"] == 1, "Platz 3 in einer Fast Lap ist ein Podium"
    assert stats["dora"]["top3"] == 0, "Vereins-Referenzzeiten zählen nicht"
