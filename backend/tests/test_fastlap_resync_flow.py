"""Nach „Ergebnisse veröffentlicht“ (#1584, Nachprüfung): eine Korrektur der Turnierleitung gleicht Gewinne und
Saisonpunkte an die neue Rangfolge an.

- Gewinne: der neue Platz bekommt seinen Gewinn; ein Gewinn, der nicht mehr zur Rangfolge passt, wird nie entzogen -
  er steht im Admin als „nach Korrektur prüfen“ (``needs_review``), auch wenn er schon ausgegeben ist.
- Saisonpunkte: Rang, Teilnehmerzahl und Punkte folgen der neuen Rangfolge, in der Saison, in der sie vergeben wurden.
- Der Abgleich steht im Protokoll.
- Die Regel „Vereinsmitglieder ausschließen“ verschiebt Zeiten - nach der Veröffentlichung nur mit Begründung.
- Eine veröffentlichte Challenge mit Zeiten lässt sich nicht löschen; Strecken brauchen beim Anlegen sinnvolle Grenzen.
- Die Rangfunktion lädt alle Zeiten (seitenweise) und die Gesamtwertung mit einer Abfrage."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402

REASON = "Zeitnahme-Fehler laut Video korrigiert"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


async def published(flow, **extra):
    """Anna 1:20, Bert 1:21 - veröffentlicht von der Leitung, mit aktiver Saison und Preisen für Platz 1 und 2."""
    lead = await flow.add_staff()
    flow.act_as(lead)
    await flow.db.seasons.insert_one({"id": "s-1", "slug": "saison", "name": "Saison", "status": "active"})
    cid, tid = new_id(), new_id()
    await flow.db.f1_challenges.insert_one({"id": cid, "slug": f"fl-{cid[:8]}", "title": "Hotlap", "status": "live", "visibility": "public",
                                            "prize_places": [{"place": 1, "value": "Pokal"}, {"place": 2, "value": "Kappe"}], **extra})
    await flow.db.f1_tracks.insert_one({"id": tid, "challenge_id": cid, "name": "Spielberg", "order_index": 0})
    anna, bert = await flow.add_user(name="anna"), await flow.add_user(name="bert")
    laps = {}
    for person, ms in ((anna, 80000), (bert, 81000)):
        response = await flow.post(f"/api/f1/challenges/{cid}/times", json={"user_id": person["id"], "track_id": tid, "time_ms": ms})
        assert response.status_code == 200, response.text
        laps[person["username"]] = response.json()["id"]
    response = await flow.patch(f"/api/f1/challenges/{cid}", json={"status": "results_published"})
    assert response.status_code == 200, response.text
    return cid, tid, anna, bert, laps


async def pickups(flow, cid):
    rows = await flow.db.prize_pickups.find({"fastlap_challenge_id": cid}, {"_id": 0}).to_list(20)
    return sorted((row["place"], row["user_id"], bool(row.get("needs_review"))) for row in rows)


async def points(flow, source_id):
    rows = await flow.db.season_points.find({"source_id": source_id}, {"_id": 0}).to_list(20)
    return {row["user_id"]: (row["rank"], row["num_participants"], row["season_id"]) for row in rows}


@pytest.mark.asyncio
async def test_a_correction_after_publishing_resyncs_prizes_and_season_points(flow):
    cid, tid, anna, bert, laps = await published(flow)
    assert await pickups(flow, cid) == sorted([(1, anna["id"], False), (2, bert["id"], False)])
    first_points = await flow.db.season_points.find_one({"user_id": anna["id"]}, {"_id": 0})
    # Ein Gewinn ist schon ausgegeben - er wird nicht entzogen.
    await flow.db.prize_pickups.update_one({"user_id": anna["id"], "place": 1}, {"$set": {"status": "picked_up"}})
    # Neue Saison seit der Veröffentlichung: die Punkte bleiben in ihrer Saison.
    await flow.db.seasons.update_one({"id": "s-1"}, {"$set": {"status": "completed"}})
    await flow.db.seasons.insert_one({"id": "s-2", "slug": "neu", "name": "Neu", "status": "active"})

    response = await flow.patch(f"/api/f1/times/{laps['bert']}", json={"time_ms": 79000, "change_reason": REASON})
    assert response.status_code == 200, response.text

    assert await pickups(flow, cid) == sorted([
        (1, anna["id"], True), (2, bert["id"], True),     # passen nicht mehr - prüfen, nicht entziehen
        (1, bert["id"], False), (2, anna["id"], False),   # die neue Rangfolge
    ])
    kept = await flow.db.prize_pickups.find_one({"user_id": anna["id"], "place": 1}, {"_id": 0})
    assert kept["status"] == "picked_up"
    assert await points(flow, f"{cid}:{tid}") == {bert["id"]: (1, 2, "s-1"), anna["id"]: (2, 2, "s-1")}
    second_points = await flow.db.season_points.find_one({"user_id": anna["id"]}, {"_id": 0})
    assert second_points["total_points"] < first_points["total_points"]
    rows = await flow.db.audit_logs.find({"action": "fastlap.results.resync"}, {"_id": 0}).to_list(5)
    assert len(rows) == 1 and rows[0]["target_id"] == cid and rows[0]["data"]["reason"] == REASON
    assert rows[0]["data"]["prizes_to_review"] == 2 and rows[0]["data"]["prizes_created"] == 2


@pytest.mark.asyncio
async def test_correcting_back_clears_the_review_mark(flow):
    cid, _tid, anna, bert, laps = await published(flow)
    response = await flow.patch(f"/api/f1/times/{laps['bert']}", json={"time_ms": 79000, "change_reason": REASON})
    assert response.status_code == 200, response.text
    response = await flow.patch(f"/api/f1/times/{laps['bert']}", json={"time_ms": 81000, "change_reason": REASON})
    assert response.status_code == 200, response.text
    assert await pickups(flow, cid) == sorted([
        (1, anna["id"], False), (2, bert["id"], False), (1, bert["id"], True), (2, anna["id"], True),
    ])


@pytest.mark.asyncio
async def test_deleting_a_lap_after_publishing_removes_its_season_points_and_marks_its_prize(flow):
    cid, tid, anna, bert, laps = await published(flow)
    response = await flow.client.request("DELETE", f"/api/f1/times/{laps['anna']}", json={"change_reason": REASON})
    assert response.status_code == 200, response.text
    assert await points(flow, f"{cid}:{tid}") == {bert["id"]: (1, 1, "s-1")}
    assert (1, anna["id"], True) in await pickups(flow, cid)
    assert (1, bert["id"], False) in await pickups(flow, cid)


@pytest.mark.asyncio
async def test_adding_a_lap_after_publishing_resyncs_too(flow):
    cid, tid, anna, bert, _laps = await published(flow)
    carl = await flow.add_user(name="carl")
    response = await flow.post(f"/api/f1/challenges/{cid}/times", json={"user_id": carl["id"], "track_id": tid, "time_ms": 70000, "change_reason": REASON})
    assert response.status_code == 200, response.text
    assert (await points(flow, f"{cid}:{tid}"))[carl["id"]] == (1, 3, "s-1")
    assert (1, carl["id"], False) in await pickups(flow, cid)


@pytest.mark.asyncio
async def test_the_member_rule_after_publishing_needs_a_reason_and_resyncs(flow):
    cid, tid, anna, bert, _laps = await published(flow)
    await flow.db.memberships.insert_one({"id": new_id(), "user_id": anna["id"], "member_status": "active"})
    refused = await flow.patch(f"/api/f1/challenges/{cid}", json={"block_club_member_results": True})
    assert refused.status_code == 409, refused.text
    assert await flow.db.f1_lap_times.count_documents({"user_id": anna["id"], "score_scope": "club_reference"}) == 0
    response = await flow.patch(f"/api/f1/challenges/{cid}", json={"block_club_member_results": True, "change_reason": REASON})
    assert response.status_code == 200, response.text
    assert await flow.db.f1_lap_times.count_documents({"user_id": anna["id"], "score_scope": "club_reference"}) == 1
    rule = await flow.db.audit_logs.find({"action": "fastlap.challenge.member_rule"}, {"_id": 0}).to_list(5)
    assert len(rule) == 1 and rule[0]["data"]["reason"] == REASON and rule[0]["data"]["moved"] == 1
    assert await points(flow, f"{cid}:{tid}") == {bert["id"]: (1, 1, "s-1")}
    assert (1, anna["id"], True) in await pickups(flow, cid)


@pytest.mark.asyncio
async def test_a_published_challenge_with_times_cannot_be_deleted(flow):
    cid, _tid, _anna, _bert, _laps = await published(flow)
    refused = await flow.delete(f"/api/f1/challenges/{cid}")
    assert refused.status_code == 409, refused.text
    assert await flow.db.f1_challenges.count_documents({"id": cid}) == 1
    assert await flow.db.f1_lap_times.count_documents({"challenge_id": cid}) == 2
    draft = new_id()
    await flow.db.f1_challenges.insert_one({"id": draft, "slug": "entwurf", "title": "Entwurf", "status": "draft"})
    response = await flow.delete(f"/api/f1/challenges/{draft}")
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_a_new_track_needs_fitting_limits(flow):
    lead = await flow.add_staff()
    flow.act_as(lead)
    cid = new_id()
    await flow.db.f1_challenges.insert_one({"id": cid, "slug": "neu", "title": "Neu", "status": "draft"})
    refused = await flow.post(f"/api/f1/challenges/{cid}/tracks", json={"name": "Monza", "min_plausible_ms": 90000, "max_plausible_ms": 60000})
    assert refused.status_code == 400, refused.text
    refused = await flow.post(f"/api/f1/challenges/{cid}/tracks", json={"name": "Monza", "min_plausible_ms": 700000})
    assert refused.status_code == 400, refused.text
    assert await flow.db.f1_tracks.count_documents({"challenge_id": cid}) == 0
    response = await flow.post(f"/api/f1/challenges/{cid}/tracks", json={"name": "Monza", "min_plausible_ms": 60000, "max_plausible_ms": 90000})
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_the_ranking_loads_every_lap_page_by_page(flow, monkeypatch):
    from services import fastlap_standings
    monkeypatch.setattr(fastlap_standings, "LAP_PAGE_SIZE", 2)
    lead = await flow.add_staff()
    flow.act_as(lead)
    cid, tid = new_id(), new_id()
    await flow.db.f1_challenges.insert_one({"id": cid, "slug": "seiten", "title": "Seiten", "status": "live", "visibility": "public"})
    await flow.db.f1_tracks.insert_one({"id": tid, "challenge_id": cid, "name": "Spa", "order_index": 0})
    people = [await flow.add_user(name=f"fahrer{i}") for i in range(5)]
    for index, person in enumerate(people):
        await flow.db.f1_lap_times.insert_one({"id": new_id(), "challenge_id": cid, "track_id": tid, "user_id": person["id"],
                                               "time_ms": 90000 - index * 1000, "created_at": f"2026-10-31T10:0{index}:00+00:00"})
    laps = await fastlap_standings.official_times(flow.db, cid, tid)
    assert len(laps) == 5
    entries = (await flow.get(f"/api/f1/challenges/{cid}/leaderboard?track_id={tid}")).json()["entries"]
    assert len(entries) == 5 and entries[0]["user_id"] == people[-1]["id"]


@pytest.mark.asyncio
async def test_the_championship_reads_all_tracks_with_one_query(flow, monkeypatch):
    from services import fastlap_standings
    lead = await flow.add_staff()
    flow.act_as(lead)
    cid = new_id()
    await flow.db.f1_challenges.insert_one({"id": cid, "slug": "meister", "title": "Meister", "status": "live", "visibility": "public", "is_championship": True})
    driver = await flow.add_user(name="fahrerin")
    for order in range(3):
        tid = new_id()
        await flow.db.f1_tracks.insert_one({"id": tid, "challenge_id": cid, "name": f"Strecke {order}", "order_index": order})
        await flow.db.f1_lap_times.insert_one({"id": new_id(), "challenge_id": cid, "track_id": tid, "user_id": driver["id"],
                                               "time_ms": 80000, "created_at": "2026-10-31T10:00:00+00:00"})
    calls = []
    original = fastlap_standings.load_laps

    async def counted(db, query):
        calls.append(query)
        return await original(db, query)

    monkeypatch.setattr(fastlap_standings, "load_laps", counted)
    challenge = await flow.db.f1_challenges.find_one({"id": cid}, {"_id": 0})
    standings, per_track, tracks = await fastlap_standings.challenge_standings(flow.db, challenge)
    assert len(calls) == 1
    assert standings[0]["points"] == 75 and len(per_track) == 3
