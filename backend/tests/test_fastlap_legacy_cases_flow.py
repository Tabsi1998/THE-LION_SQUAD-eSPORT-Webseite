"""Fast Lap: die noch gültigen Fälle der alten Live-Tests, jetzt durch die echten Routen (#932).

Die Tabelle nimmt ohne Strecke die erste nach Reihenfolge und schreibt Zeiten als m:ss.SSS; eine nachgetragene schnellere
Zeit sortiert neu; eine Korrektur setzt „ungültig“ samt Nachweis; eine Strafe zeigt ihre Begründung in der Tabelle;
das Widget verrät weder Nachweis noch Notiz; das Meisterschafts-PDF gibt es für jede Challenge (Leitung sofort, Gäste erst
nach dem Ende); Gewinne und Twitch werden beim Anlegen gespeichert; die Strafen-Listen verlangen eine Anmeldung.

Ersetzt:
- test_tls_arena_api.py::TestF1::test_leaderboard_auto_picks_track_sorted
- test_tls_arena_api.py::TestF1::test_admin_add_lap_time_resorts
- test_phase2_3.py::TestF1TimePatch::test_patch_time_sets_invalid_and_proof
- test_phase2_3.py::TestWidgets::test_f1_leaderboard_widget
- test_phase_penalty_iter19.py::test_lap_with_penalty_and_note_allowed
- test_phase_penalty_iter19.py::test_my_penalties_requires_auth
- test_phase_penalty_iter19.py::test_admin_penalties_anonymous_blocked
- test_phase4_features.py::test_f1_championship_pdf_for_any_challenge
- test_phase4_features.py::TestF1CreateNewFields::test_create_f1_with_prize_and_twitch
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402

NOTE = "Track Limits in Kurve 4"
PROOF = "https://clips.example.test/runde-1"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    # Wie database.py beim Start: eine Sperre je Ressource.
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


async def challenge(flow, **extra) -> str:
    cid = new_id()
    await flow.db.f1_challenges.insert_one({"id": cid, "slug": f"fl-{cid[:8]}", "title": "Hallen-Hotlap", "status": "live",
                                            "visibility": "public", **extra})
    return cid


async def track(flow, cid: str, name: str, order_index: int) -> str:
    tid = new_id()
    await flow.db.f1_tracks.insert_one({"id": tid, "challenge_id": cid, "name": name, "order_index": order_index})
    return tid


async def lap(flow, cid: str, tid: str, user: dict, ms: int, **extra) -> str:
    lap_id = new_id()
    await flow.db.f1_lap_times.insert_one({"id": lap_id, "challenge_id": cid, "track_id": tid, "user_id": user["id"],
                                           "time_ms": ms, "penalty_seconds": 0, "is_invalid": False,
                                           "score_scope": "official", "created_at": "2026-10-31T10:00:00+00:00", **extra})
    return lap_id


async def enter(flow, cid: str, tid: str, user: dict, ms: int, **fields):
    return await flow.post(f"/api/f1/challenges/{cid}/times",
                           json={"user_id": user["id"], "track_id": tid, "time_ms": ms, **fields})


@pytest.mark.asyncio
async def test_leaderboard_without_track_takes_the_first_by_order_and_writes_times_as_text(flow):
    cid = await challenge(flow)
    # Die zweite Strecke liegt zuerst in der Datenbank - gewählt wird nach Reihenfolge, nicht nach Speicherstand.
    second = await track(flow, cid, "Monza", 1)
    first = await track(flow, cid, "Spielberg", 0)
    anna, bert = await flow.add_user(name="anna"), await flow.add_user(name="bert")
    await lap(flow, cid, second, anna, 70000)
    await lap(flow, cid, first, anna, 81234)
    await lap(flow, cid, first, bert, 83005)

    board = await flow.get(f"/api/f1/challenges/{cid}/leaderboard")
    assert board.status_code == 200, board.text
    data = board.json()
    assert data["track"]["id"] == first
    entries = data["entries"]
    assert [e["user_id"] for e in entries] == [anna["id"], bert["id"]]
    assert entries[0]["gap_ms"] == 0
    assert [e["time_str"] for e in entries] == ["1:21.234", "1:23.005"]


@pytest.mark.asyncio
async def test_a_faster_time_entered_by_the_lead_moves_the_last_driver_to_first(flow):
    cid = await challenge(flow)
    tid = await track(flow, cid, "Spielberg", 0)
    anna, bert, cleo = (await flow.add_user(name="anna"), await flow.add_user(name="bert"),
                        await flow.add_user(name="cleo"))
    await lap(flow, cid, tid, anna, 80000)
    await lap(flow, cid, tid, bert, 81000)
    await lap(flow, cid, tid, cleo, 82000)
    flow.act_as(await flow.add_staff())

    before = (await flow.get(f"/api/f1/challenges/{cid}/leaderboard?track_id={tid}")).json()["entries"]
    assert before[-1]["user_id"] == cleo["id"]

    entered = await enter(flow, cid, tid, cleo, 79500)
    assert entered.status_code == 200, entered.text

    after = (await flow.get(f"/api/f1/challenges/{cid}/leaderboard?track_id={tid}")).json()["entries"]
    assert [e["user_id"] for e in after] == [cleo["id"], anna["id"], bert["id"]]
    assert after[0]["rank"] == 1 and after[0]["time_ms"] == 79500 and after[0]["time_str"] == "1:19.500"


@pytest.mark.asyncio
async def test_a_correction_marks_the_lap_invalid_with_proof(flow):
    cid = await challenge(flow)
    tid = await track(flow, cid, "Spielberg", 0)
    anna = await flow.add_user(name="anna")
    lap_id = await lap(flow, cid, tid, anna, 81234)
    flow.act_as(await flow.add_staff())

    corrected = await flow.patch(f"/api/f1/times/{lap_id}", json={"is_invalid": True, "proof_url": PROOF, "admin_note": NOTE})
    assert corrected.status_code == 200, corrected.text

    times = await flow.get(f"/api/f1/challenges/{cid}/times")
    assert times.status_code == 200, times.text
    row = next(t for t in times.json() if t["id"] == lap_id)
    assert row["is_invalid"] is True
    assert row["proof_url"] == PROOF
    assert row["admin_note"] == NOTE


@pytest.mark.asyncio
async def test_a_penalty_with_a_reason_is_accepted_and_shown_in_the_leaderboard(flow):
    cid = await challenge(flow)
    tid = await track(flow, cid, "Spielberg", 0)
    anna = await flow.add_user(name="anna")
    flow.act_as(await flow.add_staff())

    entered = await enter(flow, cid, tid, anna, 81234, penalty_seconds=5, admin_note=NOTE)
    assert entered.status_code == 200, entered.text

    entry = (await flow.get(f"/api/f1/challenges/{cid}/leaderboard?track_id={tid}")).json()["entries"][0]
    assert entry["penalty_note"] == NOTE
    assert entry["penalty_seconds"] == 5
    assert entry["raw_time_ms"] == 81234 and entry["time_ms"] == 86234


@pytest.mark.asyncio
async def test_widget_leaderboard_hides_proof_and_internal_note(flow):
    cid = await challenge(flow)
    tid = await track(flow, cid, "Spielberg", 0)
    anna, bert = await flow.add_user(name="anna"), await flow.add_user(name="bert")
    await lap(flow, cid, tid, anna, 81234, proof_url=PROOF, admin_note=NOTE, penalty_seconds=2)
    await lap(flow, cid, tid, bert, 84000, proof_url=PROOF, admin_note="Interne Notiz der Leitung")
    slug = (await flow.db.f1_challenges.find_one({"id": cid}))["slug"]

    widget = await flow.get(f"/api/widgets/f1/{slug}/leaderboard")
    assert widget.status_code == 200, widget.text
    entries = widget.json()["entries"]
    assert [e["display_name"] for e in entries] == ["anna", "bert"]
    for entry in entries:
        assert "proof_url" not in entry and "admin_note" not in entry and "penalty_note" not in entry
    assert PROOF not in widget.text and NOTE not in widget.text and "Interne Notiz" not in widget.text


@pytest.mark.asyncio
async def test_championship_pdf_for_a_challenge_without_championship_flag(flow):
    cid = await challenge(flow, is_championship=False)
    tid = await track(flow, cid, "Spielberg", 0)
    await lap(flow, cid, tid, await flow.add_user(name="anna"), 81234)

    flow.act_as(await flow.add_staff())
    pdf = await flow.get(f"/api/exports/f1/{cid}/championship.pdf")
    assert pdf.status_code == 200, pdf.text
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")

    # Gäste bekommen das Ergebnis-PDF erst nach dem Ende.
    flow.act_as(None)
    refused = await flow.get(f"/api/exports/f1/{cid}/championship.pdf")
    assert refused.status_code == 403, refused.text


@pytest.mark.asyncio
async def test_creating_a_challenge_stores_prizes_and_twitch(flow):
    flow.act_as(await flow.add_staff())
    prizes = [{"place": 1, "value": "Pokal"}, {"place": 2, "value": "Kappe"}]
    created = await flow.post("/api/f1/challenges", json={"title": "Sommer-Hotlap", "prize_places": prizes,
                                                         "twitch_channel": "vereinskanal", "twitch_enabled": True})
    assert created.status_code == 200, created.text
    assert created.json()["status"] == "draft"

    stored = await flow.get(f"/api/f1/challenges/{created.json()['id']}")
    assert stored.status_code == 200, stored.text
    data = stored.json()
    assert data["prize_places"] == prizes
    assert data["twitch_channel"] == "vereinskanal" and data["twitch_enabled"] is True


@pytest.mark.asyncio
async def test_penalty_lists_need_a_login(flow):
    flow.act_as(None)
    mine = await flow.get("/api/penalties/me")
    assert mine.status_code == 401, mine.text
    everyone = await flow.get("/api/admin/penalties")
    assert everyone.status_code == 401, everyone.text
