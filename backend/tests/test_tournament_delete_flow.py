"""Turnier löschen nur als Entwurf ohne Ergebnisse (#2111, TA18).

Vorher war Löschen in jedem Status endgültig - zurück blieben Pokale mit Link ins Leere, Jahrespunkte, Gewinne,
Stationen, Gruppen, Map-Pool und Chat. Jetzt: nur ein Entwurf ohne Ergebnisse, alles Zugehörige geht mit, und das
Protokoll hält fest, wer welches Turnier gelöscht hat. Sonst sagt der Server, was stattdessen geht (absagen,
archivieren).
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from services import chat_attachments  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def lead(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    return staff


@pytest.mark.asyncio
async def test_a_draft_goes_with_everything_that_belongs_to_it(flow):
    staff = await lead(flow)
    tournament = await flow.create_tournament(status="draft", title="Probe-Cup")
    tid = tournament["id"]
    await flow.register(tournament, await flow.add_user(name="Paula"))
    await flow.db.tournament_stages.insert_one({"id": "st-1", "tournament_id": tid, "stage_type": "single_elimination"})
    await flow.db.matches_v2.insert_one({"id": "m-1", "tournament_id": tid, "stage_id": "st-1", "is_preview": True,
                                         "status": "pending", "slots": []})
    await flow.db.tournament_groups.insert_one({"id": "g-1", "tournament_id": tid, "name": "Gruppe A"})
    await flow.db.map_pools.insert_many([{"id": "p-1", "scope": "tournament", "scope_id": tid},
                                         {"id": "p-2", "scope": "stage", "scope_id": "st-1"},
                                         {"id": "p-3", "scope": "tournament", "scope_id": "anderes"}])
    await flow.db.tournament_chat_messages.insert_one({"id": new_id(), "tournament_id": tid, "message": "Hallo"})
    await flow.db.stations.insert_one({"id": "station-1", "name": "1", "tournament_id": tid})

    deleted = await flow.delete(f"/api/tournaments/{tid}")
    assert deleted.status_code == 200, deleted.text

    for collection in ("tournaments", "tournament_registrations", "tournament_stages", "matches_v2",
                       "tournament_groups", "tournament_chat_messages"):
        query = {"id": tid} if collection == "tournaments" else {"tournament_id": tid}
        assert await getattr(flow.db, collection).count_documents(query) == 0, collection
    assert {row["id"] for row in await flow.db.map_pools.find({}, {"_id": 0}).to_list(10)} == {"p-3"}
    station = await flow.db.stations.find_one({"id": "station-1"}, {"_id": 0})
    assert station is not None and station.get("tournament_id") is None, "die Station bleibt, nur ohne Turnier"
    entry = await flow.db.audit_logs.find_one({"action": "tournament.delete", "target_id": tid}, {"_id": 0})
    assert entry and entry["actor_id"] == staff["id"] and entry["data"]["title"] == "Probe-Cup"


@pytest.mark.asyncio
async def test_chat_messages_and_their_files_go_with_the_draft(flow, tmp_path, monkeypatch):
    monkeypatch.setattr(chat_attachments, "PRIVATE_CHAT_DIR", tmp_path)
    await lead(flow)
    tournament = await flow.create_tournament(status="draft")
    tid = tournament["id"]
    await flow.db.matches_v2.insert_one({"id": "m-chat", "tournament_id": tid, "is_preview": True, "status": "pending", "slots": []})

    async def attachment(name, context):
        (tmp_path / f"{name}.webp").write_bytes(b"bild")
        await flow.db.chat_attachments.insert_one({"id": name, "owner_id": "u-1", "status": "attached",
                                                   "storage_key": f"{name}.webp", "context": context})

    await attachment("im-turnier", {"type": "tournament", "tournament_id": tid, "message_id": "t-1"})
    await attachment("im-spiel", {"type": "match", "match_id": "m-chat", "message_id": "m-1"})
    await attachment("anderes-turnier", {"type": "tournament", "tournament_id": "anderes", "message_id": "t-2"})
    await attachment("anderes-spiel", {"type": "match", "match_id": "m-anderes", "message_id": "m-2"})
    await flow.db.match_chat_messages.insert_many([{"id": "m-1", "match_id": "m-chat", "tournament_id": tid, "message": "Hallo"},
                                                   {"id": "m-2", "match_id": "m-anderes", "tournament_id": "anderes", "message": "Bleibt"}])

    deleted = await flow.delete(f"/api/tournaments/{tid}")
    assert deleted.status_code == 200, deleted.text

    left = {row["id"] for row in await flow.db.chat_attachments.find({}, {"_id": 0, "id": 1}).to_list(10)}
    assert left == {"anderes-turnier", "anderes-spiel"}
    assert sorted(path.name for path in tmp_path.iterdir()) == ["anderes-spiel.webp", "anderes-turnier.webp"]
    assert [row["id"] for row in await flow.db.match_chat_messages.find({}, {"_id": 0, "id": 1}).to_list(10)] == ["m-2"]


@pytest.mark.asyncio
async def test_only_drafts_are_deleted(flow):
    await lead(flow)
    for status in ("scheduled", "registration_open", "live", "completed", "results_published", "cancelled"):
        tournament = await flow.create_tournament(status=status)
        refused = await flow.delete(f"/api/tournaments/{tournament['id']}")
        assert refused.status_code == 409, status
        assert "nur bei Entwürfen" in refused.json()["detail"], status
        assert await flow.db.tournaments.find_one({"id": tournament["id"]}) is not None, status


@pytest.mark.asyncio
async def test_a_draft_with_results_stays(flow):
    await lead(flow)
    played = await flow.create_tournament(status="draft")
    await flow.db.matches_v2.insert_one({"id": new_id(), "tournament_id": played["id"], "status": "completed",
                                         "results": [{"registration_id": "r-1", "rank": 1}], "slots": []})
    refused = await flow.delete(f"/api/tournaments/{played['id']}")
    assert refused.status_code == 409
    assert "schon Ergebnisse" in refused.json()["detail"] and "absagen oder archivieren" in refused.json()["detail"]

    awarded = await flow.create_tournament(status="draft")
    await flow.db.tournament_awards.insert_one({"id": new_id(), "tournament_id": awarded["id"], "rank": 1})
    refused = await flow.delete(f"/api/tournaments/{awarded['id']}")
    assert refused.status_code == 409 and "Pokale" in refused.json()["detail"]

    pointed = await flow.create_tournament(status="draft")
    await flow.db.season_points.insert_one({"id": new_id(), "source_id": pointed["id"], "points": 10})
    refused = await flow.delete(f"/api/tournaments/{pointed['id']}")
    assert refused.status_code == 409 and "Jahrespunkte" in refused.json()["detail"]
