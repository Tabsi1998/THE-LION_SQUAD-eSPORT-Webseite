"""Migration 11 (#2015): Double Up rechnet neu wie PineApps (Team-Platz k → Einzelplatz 2k−1). Bestehende Saisons mit
einem Double-Up-Blatt behalten ausdrücklich die bisherige Rechnung nach Team-Platz, damit sich ihre Tabelle nicht still
ändert; Saisons ohne Double Up und neue Saisons bekommen die Vorgabe. Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import migrations, reference_series  # noqa: E402
from services.scoring_rules import normalize_rules  # noqa: E402

SCHEME = [35, 30, 26, 23, 20]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _season(db, sid: str, sheet: dict | None, rules: dict | None = None) -> dict:
    series = {"id": sid, "lineage_id": "spur-1", "season": "2026", "status": "active",
              "rules": normalize_rules(rules or {"points_by_place": SCHEME})}
    series["rules"].pop("double_up_points")  # so gespeichert vor #2015
    if rules and "double_up_points" in rules:
        series["rules"]["double_up_points"] = rules["double_up_points"]
    await db.reference_series.insert_one(dict(series))
    await db.reference_rounds.insert_one({"id": f"{sid}-r1", "series_id": sid, "order": 1, "status": "scored",
                                          "counts": True, "kind": "regular", "archived_at": None})
    await db.reference_participants.insert_many([{"id": f"{sid}-{pid}", "series_id": sid, "name": f"Probe {pid}"}
                                                 for pid in ("a", "b", "c", "d")])
    if sheet is not None:
        await db.reference_round_results.insert_one({"id": f"{sid}-blatt", "series_id": sid, "round_id": f"{sid}-r1",
                                                     "status": "published", "version": 1, **sheet})
    await reference_series.recompute_standings(db, series)
    return series


DOUBLE = {"double_up": True, "rows": [
    {"participant_id": "{sid}-a", "place": 1, "partner_id": "{sid}-b", "marks": []},
    {"participant_id": "{sid}-b", "place": 1, "partner_id": "{sid}-a", "marks": []},
    {"participant_id": "{sid}-c", "place": 2, "partner_id": "{sid}-d", "marks": []},
    {"participant_id": "{sid}-d", "place": 2, "partner_id": "{sid}-c", "marks": []}]}


def _sheet(sid: str, template: dict) -> dict:
    return {**template, "rows": [{key: value.format(sid=sid) if isinstance(value, str) else value
                                  for key, value in row.items()} for row in template["rows"]]}


async def _points(db, sid: str) -> dict:
    stored = await db.reference_standings.find_one({"series_id": sid, "scope": "drivers"}, {"_id": 0})
    return {row["participant_id"][len(sid) + 1:]: row["points"] for row in stored["rows"]}


@pytest.mark.asyncio
async def test_old_double_up_seasons_keep_team_place_and_their_table(flow):
    db = flow.db
    old = await _season(db, "alt", _sheet("alt", DOUBLE))
    await _season(db, "einzel", {"rows": [{"participant_id": "einzel-a", "place": 1, "marks": []}]})
    await _season(db, "leer", None)
    chosen = {"points_by_place": SCHEME, "double_up_points": "best_player_place"}
    await _season(db, "gewaehlt", _sheet("gewaehlt", DOUBLE), chosen)
    draft = _sheet("entwurf", DOUBLE)
    await _season(db, "entwurf", {"rows": [], "pending_draft": {**draft, "double_up": True}})

    assert await migrations.migrate_double_up_points(db) == "2 series keep double up points by team place"
    stored = {item["id"]: item["rules"] async for item in db.reference_series.find({}, {"_id": 0})}
    assert stored["alt"]["double_up_points"] == "team_place"
    assert stored["entwurf"]["double_up_points"] == "team_place"
    assert "double_up_points" not in stored["einzel"] and "double_up_points" not in stored["leer"]
    assert stored["gewaehlt"]["double_up_points"] == "best_player_place"
    # Die übrigen Regeln bleiben. Der Stand war schon mit der neuen Vorgabe gerechnet (26) - die Migration rechnet die
    # Saison neu, danach steht wieder die alte Tabelle (35/35/30/30), ohne neue Regel-Version, mit Protokoll.
    assert {key: value for key, value in stored["alt"].items() if key != "double_up_points"} == {
        key: value for key, value in old["rules"].items()}
    assert await _points(db, "alt") == {"a": 35, "b": 35, "c": 30, "d": 30}
    logs = [log["target_id"] async for log in db.audit_logs.find({"action": "reference_series.double_up_points"})]
    assert sorted(logs) == ["alt", "entwurf"]
    # Eine Saison mit der Vorgabe rechnet wie PineApps: Team 2 → Einzelplatz 3 (26).
    assert await _points(db, "gewaehlt") == {"a": 35, "b": 35, "c": 26, "d": 26}
    # Ein zweiter Lauf ändert nichts.
    assert await migrations.migrate_double_up_points(db) == "0 series keep double up points by team place"


@pytest.mark.asyncio
async def test_a_failing_season_does_not_stop_the_others_and_the_next_run_finishes_it(flow, monkeypatch):
    db = flow.db
    await _season(db, "kaputt", _sheet("kaputt", DOUBLE))
    await _season(db, "gut", _sheet("gut", DOUBLE))
    assert await _points(db, "kaputt") == {"a": 35, "b": 35, "c": 26, "d": 26}  # schon mit der Vorgabe gerechnet
    original = reference_series.recompute_standings

    async def failing(db_, series):
        if series["id"] == "kaputt":
            raise RuntimeError("Neurechnen gescheitert")
        return await original(db_, series)

    monkeypatch.setattr(reference_series, "recompute_standings", failing)
    with pytest.raises(migrations.MigrationIncomplete):
        await migrations.migrate_double_up_points(db)
    stored = {item["id"]: item["rules"] async for item in db.reference_series.find({}, {"_id": 0})}
    # Die gute Saison ist fertig; die kaputte hat weder Regel noch neuen Stand - kein halber Zustand.
    assert stored["gut"]["double_up_points"] == "team_place" and await _points(db, "gut") == {
        "a": 35, "b": 35, "c": 30, "d": 30}
    assert "double_up_points" not in stored["kaputt"]
    assert await _points(db, "kaputt") == {"a": 35, "b": 35, "c": 26, "d": 26}
    monkeypatch.setattr(reference_series, "recompute_standings", original)
    assert await migrations.migrate_double_up_points(db) == "1 series keep double up points by team place"
    assert await _points(db, "kaputt") == {"a": 35, "b": 35, "c": 30, "d": 30}


def test_the_double_up_points_rule_is_migration_eleven():
    assert (11, "reference_double_up_points", migrations.migrate_double_up_points) in migrations.MIGRATIONS
