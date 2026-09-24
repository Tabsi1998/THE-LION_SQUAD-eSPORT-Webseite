"""Read-only survey of the stored tournaments before they are migrated.

Run this on the server that holds the data. It reads, measures and reports. It
cannot write: the database handle is wrapped so that any write method raises
instead of executing, which makes "nothing was changed" a property of the code
rather than a promise in a comment.

    # Bestandsaufnahme und Vergleichsbasis erzeugen
    python scripts/tournament-migration-dryrun.py --out vorher.json

    # ... nach der Migration ...
    python scripts/tournament-migration-dryrun.py --out nachher.json \
        --compare vorher.json

The report contains tournament titles, slugs and opaque registration ids - no
member names, no e-mail addresses. It is meant to be shareable.

Environment: the same MONGO_URL and DB_NAME the backend uses.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

def _backend_root() -> Path:
    """Find the backend package, in the repo as well as inside the container.

    In a checkout it sits next to this script's parent. In the deployed image the
    backend *is* the working directory, because the image is built from the
    backend folder alone. Detecting both means one command works in both places.
    """
    here = Path(__file__).resolve()
    candidates = [here.parents[1] / "backend", here.parents[1], Path("/app")]
    for candidate in candidates:
        if (candidate / "database.py").is_file():
            return candidate
    return candidates[0]


sys.path.insert(0, str(_backend_root()))

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("JWT_SECRET", "dryrun-secret-with-at-least-32-characters")
os.environ.setdefault("FRONTEND_URL", "http://localhost:3000")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")

from services.competition_read import load_competition_read_model  # noqa: E402
from services.competition_snapshot import build_structure_snapshot  # noqa: E402
from services.migration_dryrun import (  # noqa: E402
    census_verdict,
    compare_reports,
    summarize,
    tournament_report,
)


WRITE_METHODS = {
    "insert_one", "insert_many", "update_one", "update_many", "replace_one",
    "delete_one", "delete_many", "find_one_and_update", "find_one_and_replace",
    "find_one_and_delete", "bulk_write", "drop", "rename", "create_index",
    "drop_index", "drop_indexes", "aggregate_raw_batches",
}


class ReadOnlyViolation(RuntimeError):
    pass


class ReadOnlyCollection:
    """A collection that can be read and cannot be written."""

    def __init__(self, collection):
        self._collection = collection

    def __getattr__(self, name):
        if name in WRITE_METHODS:
            raise ReadOnlyViolation(
                f"Der Trockenlauf darf nicht schreiben (versucht: {name}). "
                "Das ist ein Fehler im Skript, nicht in deinen Daten."
            )
        return getattr(self._collection, name)


class ReadOnlyDb:
    def __init__(self, db):
        self._db = db

    def __getattr__(self, name):
        return ReadOnlyCollection(getattr(self._db, name))

    def __getitem__(self, name):
        return ReadOnlyCollection(self._db[name])


async def collect(db, *, limit: int | None, only: str | None) -> list[dict]:
    query: dict = {}
    if only:
        query = {"$or": [{"id": only}, {"slug": only}]}
    cursor = db.tournaments.find(query, {"_id": 0}).sort("created_at", 1)
    tournaments = await cursor.to_list(limit or 5000)

    rows: list[dict] = []
    for index, tournament in enumerate(tournaments, start=1):
        tid = tournament.get("id")
        if not tid:
            continue
        # Die Anwendung liest den alten Speicher nicht mehr (#231); der Trockenlauf tut es absichtlich weiter,
        # denn er ist das Werkzeug, das nachweist, dass dort nichts mehr liegt.
        legacy = await db.matches.find({"tournament_id": tid}, {"_id": 0}).sort([("round", 1), ("match_index", 1)]).to_list(3000)
        read_model = await load_competition_read_model(db, tid)
        snapshot = build_structure_snapshot(tid, legacy_matches=legacy, stage_matches=read_model.stage_matches, stages=read_model.stages)
        registrations = await db.tournament_registrations.find(
            {"tournament_id": tid}, {"_id": 0}).to_list(1000)
        groups = []
        if tournament.get("format") == "groups":
            groups = await db.tournament_groups.find(
                {"tournament_id": tid}, {"_id": 0}).to_list(50)
        rows.append(tournament_report(tournament, snapshot, registrations, groups=groups))
        print(f"  [{index}/{len(tournaments)}] {tournament.get('title') or tid}", file=sys.stderr)
    return rows


# Der lesbare Bericht geht nach stdout - ausser bei --json, dann macht er dort
# Platz für die maschinenlesbare Ausgabe und wandert nach stderr.
REPORT_STREAM = sys.stdout


def say(text: str = "") -> None:
    print(text, file=REPORT_STREAM)


async def store_census(db) -> dict:
    """Count what each store holds at all - drafts and orphans included.

    The per-tournament survey answers "does anything have to move". This answers
    the other question, the one that decides whether the old store can be shut
    off: is there anything left in it that nobody is looking at any more.
    """
    tournament_ids = set(await db.tournaments.distinct("id"))
    referenced = set(await db.matches.distinct("tournament_id"))
    orphaned_ids = [item for item in referenced - tournament_ids if item]

    orphaned = 0
    if orphaned_ids:
        orphaned = await db.matches.count_documents({"tournament_id": {"$in": orphaned_ids}})

    return {
        "matches": await db.matches.count_documents({}),
        "preview_matches": await db.matches.count_documents({"is_preview": True}),
        "matches_v2": await db.matches_v2.count_documents({}),
        "stages": await db.tournament_stages.count_documents({}),
        "orphaned_matches": orphaned,
        "orphaned_tournament_ids": sorted(orphaned_ids)[:20],
    }


def print_census(verdict: dict) -> None:
    say("\n=== Speicher insgesamt ===")
    say(f"Klassisch (matches):    {verdict['classic_total']} "
        f"({verdict['classic_real']} echt, {verdict['classic_drafts']} Entwürfe)")
    say(f"Graph (matches_v2):     {verdict['graph_total']}")
    if verdict["orphaned_matches"]:
        say(f"Verwaist:               {verdict['orphaned_matches']} "
            "(gehören zu keinem Turnier mehr)")
    say(f"\n{verdict['summary']}")
    if verdict["retirable"]:
        say("→ Der klassische Speicher hält nichts mehr. Er kann stillgelegt werden, "
            "sobald keine neuen Turniere mehr dort starten.")


def print_report(rows: list[dict]) -> None:
    summary = summarize(rows)
    say("\n=== Bestand ===")
    say(f"Turniere gesamt:        {summary['tournaments']}")
    for engine, count in summary["by_engine"].items():
        say(f"  im Speicher {engine:<8} {count}")
    say(f"Migration nötig:        {summary['needs_migration']}")
    say(f"Davon bereit:           {summary['ready']}")
    say(f"Mit Mangel:             {summary['blocked']}")

    blocked = [row for row in rows if row.get("blockers")]
    if blocked:
        say("\n=== Mängel: das muss vorher jemand anfassen ===")
        for code, count in summary["blockers"].items():
            say(f"  {code:<34} {count}x")
        for row in blocked:
            say(f"\n  {row.get('title') or row['id']}  [{row.get('format')} · {row.get('status')}]")
            say(f"    Speicher: {row.get('engine')} · {row['match_count']} Spiele, "
                f"{row['decided_count']} entschieden")
            for blocker in row["blockers"]:
              say(f"    - {blocker['detail']}")
              say(f"      → {blocker['action']}")
    else:
        say("\nKeine Mängel gefunden.")

    if summary.get("notices"):
        # Bewusst getrennt: das betrifft fast jedes klassische Turnier und
        # braucht eine Entscheidung, keine fünfzig Einzelkorrekturen.
        say("\n=== Hinweise: eine Entscheidung, nicht fünfzig Korrekturen ===")
        seen: dict[str, dict] = {}
        for row in rows:
            for notice in row.get("notices") or []:
              seen.setdefault(notice["code"], notice)
        for code, count in summary["notices"].items():
            notice = seen[code]
            say(f"\n  {count} Turnier(e): {notice['detail']}")
            say(f"    → {notice['action']}")


def print_comparison(result: dict) -> None:
    say("\n=== Vergleich mit der Vorher-Aufnahme ===")
    say(f"Verglichen:   {result['compared']}")
    say(f"Unverändert:  {result['unchanged']}")
    if result["new"]:
        say(f"Neu dazu:     {len(result['new'])} (nicht Teil des Vergleichs)")

    if result["equivalent"]:
        say("\nErgebnis: deckungsgleich. Kein Turnier hat Ergebnisse, Tabelle "
            "oder Platzierungen verändert.")
        return

    say(f"\nErgebnis: {len(result['changed'])} Turnier(e) weichen ab.")
    for row in result["changed"]:
        say(f"\n  {row.get('title') or row['id']}: {row['problem']}")
        for difference in row["differences"][:12]:
            say(f"    - {difference}")
        if len(row["differences"]) > 12:
            say(f"    ... und {len(row['differences']) - 12} weitere")


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", help="Bericht als JSON hierhin schreiben")
    parser.add_argument("--json", action="store_true",
                        help="JSON nach stdout, Bericht nach stderr - zum Umleiten in eine Datei")
    parser.add_argument("--compare", help="Gegen eine frühere Aufnahme vergleichen")
    parser.add_argument("--limit", type=int, help="Nur die ersten N Turniere")
    parser.add_argument("--tournament", help="Nur dieses Turnier (ID oder Slug)")
    args = parser.parse_args()

    if args.json:
        # Im Container gibt es kein beschreibbares Verzeichnis. Über stdout kommt
        # der Bericht auch ohne eingehängtes Volume heraus.
        globals()["REPORT_STREAM"] = sys.stderr

    for name in ("MONGO_URL", "DB_NAME"):
        if not os.environ.get(name):
            print(f"{name} ist nicht gesetzt.\n"
                  "Das Backend läuft in Docker; MongoDB ist absichtlich nur im Docker-Netz "
                  "erreichbar. Nutze bitte scripts/tournament-dryrun.sh - das startet den "
                  "Lauf im Backend-Container mit den richtigen Werten.",
                  file=sys.stderr)
            return 2

    from database import get_db

    db = ReadOnlyDb(get_db())
    print("Lese Turniere (nur lesend) ...", file=sys.stderr)
    rows = await collect(db, limit=args.limit, only=args.tournament)
    if not rows:
        print("Keine Turniere gefunden.", file=sys.stderr)
        return 1

    census = census_verdict(await store_census(db))
    report = {"version": 2, "summary": summarize(rows), "census": census, "tournaments": rows}
    print_report(rows)
    print_census(census)

    exit_code = 0
    if args.compare:
        previous = json.loads(Path(args.compare).read_text(encoding="utf-8"))
        result = compare_reports(previous, report)
        report["comparison"] = result
        print_comparison(result)
        exit_code = 0 if result["equivalent"] else 1

    if args.out:
        Path(args.out).write_text(
            json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        say(f"\nBericht geschrieben: {args.out}")
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
