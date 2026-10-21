"""Migration 10 (#1960): ein leeres Team heißt jetzt kein Team. Damit bestehende Saisons keine Punkte verlieren, bekommen
alte Ergebniszeilen ohne Team einmal das Standard-Team ihres Teilnehmers als echten Wert - nur mit Teamwertung, im Blatt
und im Entwurf daneben; „Ersatzfahrer“ bleibt, ein zweiter Lauf ändert nichts. Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import migrations, reference_series  # noqa: E402

SCHEME = [10, 6, 4, 3]
PEOPLE = {"anna": "Probe Löwen", "bert": "Probe Löwen", "cora": "Fremd Rot", "dino": None}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _season(db, sid: str, team_scoring: bool) -> dict:
    series = {"id": sid, "lineage_id": "spur-1", "season": "2026", "status": "active",
              "rules": {"points_by_place": SCHEME, "team_scoring": {"enabled": team_scoring}}}
    await db.reference_series.insert_one(dict(series))
    await db.reference_rounds.insert_one({"id": f"{sid}-r1", "series_id": sid, "order": 1, "status": "scored",
                                          "counts": True, "kind": "regular", "archived_at": None})
    await db.reference_participants.insert_many([
        {"id": f"{sid}-{pid}", "series_id": sid, "name": pid.title(), "default_team": team}
        for pid, team in PEOPLE.items()])
    rows = [{"participant_id": f"{sid}-anna", "place": 1, "marks": []},
            {"participant_id": f"{sid}-bert", "place": 2, "marks": [], "team": "Ersatzfahrer"},
            {"participant_id": f"{sid}-cora", "place": 3, "marks": [], "team": " "},
            {"participant_id": f"{sid}-dino", "place": 4, "marks": []},
            {"participant_id": None, "name": "Ganz Neu", "place": 5, "marks": []}]
    await db.reference_round_results.insert_one({
        "id": f"{sid}-blatt", "series_id": sid, "round_id": f"{sid}-r1", "status": "published", "version": 3,
        "rows": rows, "pending_draft": {"rows": [{"participant_id": f"{sid}-anna", "place": 2, "marks": []}]}})
    await reference_series.recompute_standings(db, series)
    return series


async def _teams(db, sid: str) -> dict:
    stored = await db.reference_standings.find_one({"series_id": sid, "scope": "teams"}, {"_id": 0})
    return {row["team"]: row["computed_points"] for row in (stored or {}).get("rows") or []}


async def _sheet(db, sid: str) -> dict:
    return await db.reference_round_results.find_one({"id": f"{sid}-blatt"}, {"_id": 0})


@pytest.mark.asyncio
async def test_old_rows_without_a_team_get_the_default_team_exactly_once(flow):
    db = flow.db
    await _season(db, "mit", team_scoring=True)
    await _season(db, "ohne", team_scoring=False)
    # Vor der Migration: leer heißt kein Team - die Löwen und Rot hätten still ihre Punkte verloren.
    assert await _teams(db, "mit") == {}

    assert await migrations.migrate_result_row_teams(db) == "3 result rows in 1 series got their default team"
    sheet = await _sheet(db, "mit")
    assert [row.get("team") for row in sheet["rows"]] == ["Probe Löwen", "Ersatzfahrer", "Fremd Rot", None, None]
    assert sheet["pending_draft"]["rows"][0]["team"] == "Probe Löwen"
    # Neu gerechnet: anna zählt wieder für die Löwen, bert als Ersatzfahrer für keines, cora für Rot.
    assert await _teams(db, "mit") == {"Probe Löwen": 10, "Fremd Rot": 4}
    logs = await db.audit_logs.find({"action": "reference_series.team_backfill"}, {"_id": 0}).to_list(None)
    assert [(log["target_id"], log["actor_id"], log["data"]["rows"], log["data"]["round_ids"]) for log in logs] == [
        ("mit", "migration", 3, ["mit-r1"])]

    # Eine Saison ohne Teamwertung bleibt unberührt.
    assert [row.get("team") for row in (await _sheet(db, "ohne"))["rows"]] == [None, "Ersatzfahrer", " ", None, None]

    # Ein zweiter Lauf findet nichts mehr und schreibt nichts.
    assert await migrations.migrate_result_row_teams(db) == "0 result rows in 0 series got their default team"
    assert (await _sheet(db, "mit"))["rows"] == sheet["rows"]
    assert await db.audit_logs.count_documents({"action": "reference_series.team_backfill"}) == 1


def test_the_backfill_is_migration_ten():
    assert (10, "reference_result_row_teams", migrations.migrate_result_row_teams) in migrations.MIGRATIONS
    assert [version for version, _, _ in migrations.MIGRATIONS] == list(range(1, 11))
