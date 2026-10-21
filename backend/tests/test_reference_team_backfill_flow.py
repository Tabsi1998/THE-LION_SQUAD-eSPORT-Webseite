"""Migration 10 (#1960): ein leeres Team heißt jetzt kein Team. Damit bestehende Saisons keine Punkte verlieren, bekommen
alte Ergebniszeilen ohne Team einmal das Standard-Team ihres Teilnehmers als echten Wert - in allen Saisons mit
Teilnehmern, im Blatt und im Entwurf daneben; „Ersatzfahrer“ bleibt, ein zweiter Lauf ändert nichts. Gehärtet für die
Live-Datenbank: je Saison unter ihrer Sperre und mit Versionsfilter, eine Saison mit Fehler hält die anderen nicht auf
und wird beim nächsten Start fertig gemacht. Nur erfundene Namen."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import migrations, reference_series  # noqa: E402

SCHEME = [10, 6, 4, 3]
PEOPLE = {"anna": "Probe Löwen", "bert": "Probe Löwen", "cora": "Fremd Rot", "dino": None}
FILLED = ["Probe Löwen", "Ersatzfahrer", "Fremd Rot", None, None]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    # Wie in der echten Datenbank: je Sperre nur ein Datensatz - sonst gäbe es keine besetzte Saison.
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


async def _season(db, sid: str, team_scoring: bool = True) -> dict:
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


async def _teams_in_rows(db, sid: str) -> list:
    return [row.get("team") for row in (await _sheet(db, sid))["rows"]]


async def _logs(db) -> list:
    logs = await db.audit_logs.find({"action": "reference_series.team_backfill"}, {"_id": 0}).to_list(None)
    return sorted((log["target_id"], log["data"]["rows"]) for log in logs)


async def _series(db, sid: str) -> dict:
    return await db.reference_series.find_one({"id": sid}, {"_id": 0})


@pytest.mark.asyncio
async def test_old_rows_without_a_team_get_the_default_team_exactly_once(flow):
    db = flow.db
    await _season(db, "mit", team_scoring=True)
    await _season(db, "ohne", team_scoring=False)
    await db.reference_series.insert_one({"id": "leer", "lineage_id": "spur-1", "season": "2025", "rules": {}})
    # Vor der Migration: leer heißt kein Team - die Löwen und Rot hätten still ihre Punkte verloren.
    assert await _teams(db, "mit") == {}

    assert await migrations.migrate_result_row_teams(db) == (
        "6 result rows filled, 2 series recomputed, 3 series checked")
    sheet = await _sheet(db, "mit")
    assert [row.get("team") for row in sheet["rows"]] == FILLED
    assert sheet["pending_draft"]["rows"][0]["team"] == "Probe Löwen"
    # Neu gerechnet: anna zählt wieder für die Löwen, bert als Ersatzfahrer für keines, cora für Rot.
    assert await _teams(db, "mit") == {"Probe Löwen": 10, "Fremd Rot": 4}
    # Auch ohne Teamwertung gefüllt - wird sie später eingeschaltet, stimmen die Teams schon.
    assert await _teams_in_rows(db, "ohne") == FILLED
    assert await _logs(db) == [("mit", 3), ("ohne", 3)]
    for sid in ("mit", "ohne", "leer"):
        stored = await _series(db, sid)
        assert stored["team_backfill_at"] and "team_backfill_pending" not in stored, sid

    # Ein zweiter Lauf findet nichts mehr und schreibt nichts.
    assert await migrations.migrate_result_row_teams(db) == (
        "0 result rows filled, 0 series recomputed, 0 series checked")
    assert (await _sheet(db, "mit"))["rows"] == sheet["rows"]
    assert len(await _logs(db)) == 2


@pytest.mark.asyncio
async def test_a_failing_season_does_not_stop_the_others_and_is_finished_next_time(flow, monkeypatch):
    db = flow.db
    await _season(db, "gut")
    await _season(db, "kaputt")
    real = reference_series.recompute_standings

    async def broken(database, series):
        if series["id"] == "kaputt":
            raise RuntimeError("Neurechnen gescheitert")
        return await real(database, series)

    monkeypatch.setattr(reference_series, "recompute_standings", broken)
    with pytest.raises(migrations.MigrationIncomplete, match="1 series not finished: kaputt"):
        await migrations.migrate_result_row_teams(db)
    # Die andere Saison ist fertig: gefüllt, neu gerechnet, protokolliert.
    assert (await _series(db, "gut"))["team_backfill_at"]
    assert await _teams(db, "gut") == {"Probe Löwen": 10, "Fremd Rot": 4}
    # Die kaputte ist gefüllt, aber nicht fertig - sie merkt sich, was schon geschah.
    broken_series = await _series(db, "kaputt")
    assert "team_backfill_at" not in broken_series
    assert (broken_series["team_backfill_pending"]["rows"], broken_series["team_backfill_pending"]["round_ids"]) == (
        3, ["kaputt-r1"])
    assert await _logs(db) == [("gut", 3)]

    # Nächster Start: nichts mehr zu füllen - trotzdem neu gerechnet und mit der Zahl von damals protokolliert.
    monkeypatch.setattr(reference_series, "recompute_standings", real)
    assert await migrations.migrate_result_row_teams(db) == "0 result rows filled, 1 series recomputed, 1 series checked"
    assert await _teams(db, "kaputt") == {"Probe Löwen": 10, "Fremd Rot": 4}
    assert await _logs(db) == [("gut", 3), ("kaputt", 3)]
    assert "team_backfill_pending" not in await _series(db, "kaputt")


@pytest.mark.asyncio
async def test_a_busy_season_is_left_alone_and_filled_on_the_next_start(flow):
    db = flow.db
    await _season(db, "besetzt")
    await db.mutation_locks.insert_one({"resource": "series:besetzt", "owner": "jemand-anderes",
                                        "expires_at": datetime.now(timezone.utc) + timedelta(hours=1)})
    with pytest.raises(migrations.MigrationIncomplete):
        await migrations.migrate_result_row_teams(db)
    # Unter fremder Sperre schreibt die Migration nichts.
    assert await _teams_in_rows(db, "besetzt") == [None, "Ersatzfahrer", " ", None, None]
    assert "team_backfill_pending" not in await _series(db, "besetzt")

    await db.mutation_locks.delete_many({"resource": "series:besetzt"})
    assert await migrations.migrate_result_row_teams(db) == "3 result rows filled, 1 series recomputed, 1 series checked"
    assert await _teams_in_rows(db, "besetzt") == FILLED


@pytest.mark.asyncio
async def test_a_sheet_changed_since_reading_is_never_overwritten(flow, monkeypatch):
    db = flow.db
    await _season(db, "blatt")
    plan = migrations._sheet_updates
    # Gelesen wird mit Versionsfilter.
    sheet = await _sheet(db, "blatt")
    assert [selector for selector, *_ in plan([sheet], {"blatt-anna": "Probe Löwen"}, {"team_scoring": {
        "no_team_names": []}})] == [{"id": "blatt-blatt", "version": 3}]

    # Hat sich das Blatt seit dem Lesen geändert (andere Version), schreibt die Migration nichts und versucht es später.
    def stale(sheets, defaults, rules):
        return [({**selector, "version": 2}, change, count, round_id)
                for selector, change, count, round_id in plan(sheets, defaults, rules)]

    monkeypatch.setattr(migrations, "_sheet_updates", stale)
    with pytest.raises(migrations.MigrationIncomplete):
        await migrations.migrate_result_row_teams(db)
    assert await _teams_in_rows(db, "blatt") == [None, "Ersatzfahrer", " ", None, None]
    assert (await _series(db, "blatt"))["team_backfill_pending"]["started_at"]

    monkeypatch.setattr(migrations, "_sheet_updates", plan)
    assert await migrations.migrate_result_row_teams(db) == "3 result rows filled, 1 series recomputed, 1 series checked"
    assert await _teams_in_rows(db, "blatt") == FILLED


@pytest.mark.asyncio
async def test_an_incomplete_migration_stays_open_without_stopping_the_start(flow, monkeypatch):
    db = flow.db
    calls = []

    async def unfinished(database):
        calls.append("offen")
        assert await migrations.extend_migration_lease(database) is True
        raise migrations.MigrationIncomplete("eine Saison fehlt noch")

    async def fine(database):
        calls.append("fertig")
        return "ok"

    monkeypatch.setattr(migrations, "MIGRATIONS", ((1, "offen", unfinished), (2, "fertig", fine)))
    applied = await migrations.run_pending_migrations(db)
    assert [item["version"] for item in applied] == [2] and calls == ["offen", "fertig"]
    assert await db.schema_migrations.distinct("version") == [2]
    # Nächster Start (die Sperre des ersten Laufs ist längst abgelaufen): die offene läuft erneut, die fertige nicht.
    await db.schema_migration_lock.delete_many({})
    await migrations.run_pending_migrations(db)
    assert calls == ["offen", "fertig", "offen"]


@pytest.mark.asyncio
async def test_the_lease_is_extended_only_for_its_own_run(flow, monkeypatch):
    db = flow.db
    seen = []

    async def long_running(database):
        before = (await database.schema_migration_lock.find_one({"_id": "global"}))["locked_until"]
        seen.append(await migrations.extend_migration_lease(database))
        after = (await database.schema_migration_lock.find_one({"_id": "global"}))["locked_until"]
        seen.append(after >= before)
        await database.schema_migration_lock.update_one({"_id": "global"}, {"$set": {"owner": "anderer-lauf"}})
        seen.append(await migrations.extend_migration_lease(database))
        return "ok"

    monkeypatch.setattr(migrations, "MIGRATIONS", ((1, "lang", long_running),))
    await migrations.run_pending_migrations(db)
    assert seen == [True, True, False]
    # Außerhalb eines Laufs (von Hand, Tests) gibt es nichts zu verlängern.
    assert await migrations.extend_migration_lease(db) is True


def test_the_backfill_is_migration_ten():
    assert (10, "reference_result_row_teams", migrations.migrate_result_row_teams) in migrations.MIGRATIONS
    assert [version for version, _, _ in migrations.MIGRATIONS] == list(range(1, 11))
