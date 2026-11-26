"""Bestand für den Backup-Probelauf der Liga (#1632, BACKUP_RESTORE.md „Probelauf“) - nur lesen.

Zwei Teile:

* ``snapshot`` läuft **im Backend-Container** des Probe-Stands (``docker compose exec -T backend python - snapshot <
  scripts/liga_backup_probe.py``): Er liest Datenbank, Upload-Ordner und die öffentlichen Tabellen der Liga-Staffeln und schreibt
  JSON nach stdout. Gezählt und gehasht wird, nichts geschrieben.
* ``compare vorher.json nachher.json`` läuft auf dem Rechner (nur Python, keine Pakete) und zeigt vorher und nachher je Prüfung.
  Rückgabewert 0 nur, wenn alles Fachliche gleich ist.

Fachlich verglichen (muss gleich sein): jede Sammlung mit Anzahl (bis auf Betriebsdaten, ``VOLATILE``), Endstände
(``league_final_tables``), Tabellen jeder Liga-Staffel (wie die Website sie liest), Startrechte, Saisonende-Momente, Belohnungen
und Meister-Einträge, Strafen, Vorfälle und Ergebnisse der Liga-Spiele, Indizes jeder Sammlung und die Upload-Dateien mit Inhalt
(SHA-256 je Datei - der Restore selbst vergleicht nur Pfad und Größe). Nur Testdaten des Probe-Stands, nie Produktion.
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

# Betriebsdaten: ändern sich durch Start, Anmeldung oder die Sicherung selbst - nur als Hinweis.
VOLATILE = {"ops_maintenance", "rate_limits", "user_sessions", "refresh_tokens", "login_attempts", "ops_heartbeats", "ops_reach",
            "job_leases", "scheduler_leases", "client_errors", "ops_errors", "audit_logs", "migration_leases", "app_metrics"}
LEAGUE = ("league_final_tables", "league_moments", "league_applications", "league_seasons", "league_divisions", "leagues",
          "tournament_awards", "competition_sanctions", "league_rules", "league_overall_finals", "league_staff")


def _digest(rows) -> str:
    text = json.dumps(rows, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _clean(doc: dict) -> dict:
    return {key: value for key, value in doc.items() if key != "_id"}


def snapshot() -> dict:
    from pymongo import MongoClient

    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    names = sorted(db.list_collection_names())
    counts = {name: db[name].count_documents({}) for name in names}
    indexes = {}
    for name in names:
        rows = []
        for spec in db[name].list_indexes():
            rows.append({key: spec.get(key) for key in ("name", "key", "unique", "sparse", "partialFilterExpression", "expireAfterSeconds")
                         if spec.get(key) is not None})
        indexes[name] = sorted(rows, key=lambda row: row["name"])
    league = {}
    for name in LEAGUE:
        rows = sorted((_clean(doc) for doc in db[name].find({})), key=lambda doc: str(doc.get("id") or doc.get("key") or ""))
        league[name] = {"count": len(rows), "digest": _digest(rows)}
    staffeln = sorted(db.tournaments.find({"league_context": {"$type": "object"}}, {"_id": 0, "id": 1}), key=lambda row: row["id"])
    ids = [row["id"] for row in staffeln]
    matches = sorted((_clean(doc) for doc in db.matches_v2.find({"tournament_id": {"$in": ids}})), key=lambda doc: str(doc.get("id")))
    registrations = sorted((_clean(doc) for doc in db.tournament_registrations.find({"tournament_id": {"$in": ids}})), key=lambda doc: str(doc.get("id")))
    league["matches_v2 (Liga)"] = {"count": len(matches), "digest": _digest(matches)}
    league["incidents (Liga)"] = {"count": sum(len(doc.get("incidents") or []) for doc in matches),
                                  "digest": _digest([doc.get("incidents") or [] for doc in matches])}
    league["tournament_registrations (Liga)"] = {"count": len(registrations), "digest": _digest(registrations)}
    # Tabellen wie die Website sie liest (öffentliche Route im Container).
    tables = {}
    for tid in ids:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:8001/api/tournaments/{tid}/standings", timeout=20) as answer:
                tables[tid] = json.loads(answer.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            tables[tid] = {"status": error.code}
    readable = sum(1 for value in tables.values() if isinstance(value, list))
    summary = {
        "staffeln": len(ids),
        "tabellen_lesbar": readable,
        "endstaende": db.league_final_tables.count_documents({"active": True}),
        "startrechte": {state: db.league_applications.count_documents({"carry_over.start_right.status": state})
                        for state in ("offered", "accepted", "declined", "expired")},
        "momente": {outcome: db.league_moments.count_documents({"outcome": outcome, "active": {"$ne": False}})
                    for outcome in ("champion", "up", "down")},
        "meister": db.tournament_awards.count_documents({"league.title": "Meister", "reward_key": None, "suspended": {"$ne": True}}),
        "vorfaelle": league["incidents (Liga)"]["count"],
        "indizes": sum(len(rows) for rows in indexes.values()),
    }
    upload_dir = pathlib.Path(os.environ.get("UPLOAD_DIR") or "/app/backend/uploads")
    files = []
    for path in sorted(upload_dir.rglob("*")):
        if path.is_file():
            files.append((path.relative_to(upload_dir).as_posix(), path.stat().st_size, hashlib.sha256(path.read_bytes()).hexdigest()))
    summary["uploads"] = {"dateien": len(files), "bytes": sum(row[1] for row in files)}
    return {
        "db": os.environ["DB_NAME"], "summary": summary, "counts": counts, "league": league,
        "tables": {"count": len(tables), "digest": _digest(tables)},
        "indexes": {"count": summary["indizes"], "digest": _digest(indexes), "per_collection": {name: len(rows) for name, rows in indexes.items()}},
        "index_specs": indexes,
        "uploads": {"count": len(files), "bytes": sum(row[1] for row in files), "digest": _digest(files)},
    }


def compare(before_path: str, after_path: str) -> int:
    before = json.load(open(before_path, encoding="utf-8"))
    after = json.load(open(after_path, encoding="utf-8"))
    problems: list[str] = []
    notes: list[str] = []

    def row(label, old, new, *, strict=True):
        same = old == new
        mark = "gleich" if same else ("ABWEICHUNG" if strict else "Hinweis")
        print(f"  {label:<40} vorher {str(old):<24} nachher {str(new):<24} {mark}")
        if not same:
            (problems if strict else notes).append(label)

    print("Übersicht")
    for key in before["summary"]:
        row(key, before["summary"][key], after["summary"].get(key))
    print("Sammlungen (Anzahl)")
    for name in sorted(set(before["counts"]) | set(after["counts"])):
        old, new = before["counts"].get(name), after["counts"].get(name)
        if old != new or name in VOLATILE:
            row(name, old, new, strict=name not in VOLATILE)
    same_counts = sum(1 for name in before["counts"] if before["counts"][name] == after["counts"].get(name))
    print(f"  {same_counts} von {len(before['counts'])} Sammlungen mit gleicher Anzahl")
    print("Liga (Inhalt, SHA-256)")
    for name in before["league"]:
        old, new = before["league"][name], after["league"].get(name) or {}
        row(f"{name} ({old['count']})", old["digest"][:16], (new.get("digest") or "")[:16])
    row("Tabellen der Liga-Staffeln", before["tables"]["digest"][:16], after["tables"]["digest"][:16])
    row("Indizes (alle Sammlungen)", before["indexes"]["digest"][:16], after["indexes"]["digest"][:16])
    if before["indexes"]["digest"] != after["indexes"]["digest"]:
        for name, rows in before["index_specs"].items():
            if rows != after["index_specs"].get(name):
                print(f"    Index-Abweichung in {name}: vorher {[r['name'] for r in rows]} nachher {[r['name'] for r in after['index_specs'].get(name) or []]}")
    row("Uploads (Pfad, Größe, SHA-256)", before["uploads"]["digest"][:16], after["uploads"]["digest"][:16])
    print()
    if problems:
        print("ERGEBNIS: Abweichungen - " + ", ".join(problems))
        return 1
    print("ERGEBNIS: alles Fachliche gleich" + (f" (Hinweise: {', '.join(notes)})" if notes else ""))
    return 0


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "snapshot":
        json.dump(snapshot(), sys.stdout, ensure_ascii=False, default=str)
        sys.exit(0)
    if len(sys.argv) == 4 and sys.argv[1] == "compare":
        sys.exit(compare(sys.argv[2], sys.argv[3]))
    print(__doc__)
    sys.exit(2)
