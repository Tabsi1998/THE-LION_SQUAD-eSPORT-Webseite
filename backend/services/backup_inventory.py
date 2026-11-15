"""Fachlicher Bestand für Backup und Restore (#1009, #1010).

Das Backup hält im Manifest fest, was in Datenbank und Upload-Ordner stand; der Restore vergleicht danach dasselbe am
Ziel. Gezählt wird nur, nichts geschrieben:

- jede Sammlung mit ihrer Anzahl,
- fachliche Summen: Anmeldungen zu Turnieren und Events je Stand, Rechnungen und Shop-Bestellungen je Stand mit Betrag,
  Mitgliedschaften je Stand (``FIGURES``),
- die Upload-Dateien: Anzahl, Bytes und ein Fingerabdruck über Pfad und Größe (``files_digest``) - derselbe, den
  ``scripts/backup-manifest.py`` aus dem Upload-Archiv rechnet,
- auf Wunsch die Datei-Verweise: wie viele Dateien die Datenbank nennt und wie viele davon fehlen
  (``services/uploads_inventory.py``).

Im Backend-Container::

    docker compose exec -T backend python -m services.backup_inventory snapshot --references
    docker compose exec -T backend python -m services.backup_inventory code-info
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import pathlib
import sys
from typing import Iterable

# Sammlung, Feld für den Stand, Feld für den Betrag (Punkt für verschachtelte Felder) - None: nur zählen.
FIGURES = (
    ("tournament_registrations", "status", None),
    ("event_registrations", "status", None),
    ("billing_orders", "status", "total_cents"),
    ("shop_orders", "status", "frozen.total_cents"),
    ("memberships", "member_status", None),
)
NO_VALUE = "(ohne)"


def normalize_path(name: str) -> str:
    """Pfad einer Upload-Datei relativ zum Upload-Ordner, mit ``/`` und ohne führendes ``./`` oder ``/``."""
    text = str(name).replace("\\", "/")
    while text.startswith("./"):
        text = text[2:]
    return text.lstrip("/")


def digest_entries(entries: Iterable[tuple[str, int]]) -> dict:
    """Anzahl, Bytes und SHA-256 über die sortierten Zeilen ``<pfad>\\t<größe>`` - gleich für Ordner und Archiv."""
    rows = sorted((normalize_path(path), int(size)) for path, size in entries)
    digest = hashlib.sha256()
    for path, size in rows:
        digest.update(f"{path}\t{size}\n".encode("utf-8"))
    return {"count": len(rows), "bytes": sum(size for _path, size in rows), "digest": digest.hexdigest()}


def files_digest(upload_dir: pathlib.Path) -> dict:
    entries = []
    for path in upload_dir.rglob("*"):
        if path.is_file() and not path.is_symlink():
            entries.append((path.relative_to(upload_dir).as_posix(), path.stat().st_size))
    return digest_entries(entries)


def _field(document: dict, dotted: str):
    value = document
    for part in dotted.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


async def collection_counts(db) -> dict[str, int]:
    counts = {}
    for name in sorted(await db.list_collection_names()):
        if name.startswith("system."):
            continue
        counts[name] = int(await db[name].count_documents({}))
    return counts


async def ttl_collections(db, names) -> list[str]:
    """Sammlungen mit TTL-Index: MongoDB löscht dort abgelaufene Einträge von selbst - auch gleich nach einem Restore.
    Der Vergleich nach dem Restore erlaubt dort weniger Dokumente, nie mehr."""
    found = []
    for name in names:
        try:
            async for index in db[name].list_indexes():
                if index.get("expireAfterSeconds") is not None:
                    found.append(name)
                    break
        except Exception:  # Testdatenbank ohne Indexliste: dann eben keine
            continue
    return sorted(found)


async def figures(db) -> dict[str, dict]:
    """Je Sammlung aus ``FIGURES``: Anzahl (und Betrag) je Stand."""
    result: dict[str, dict] = {}
    for collection, key, amount in FIGURES:
        projection = {"_id": 0, key: 1, **({amount: 1} if amount else {})}
        groups: dict[str, dict] = {}
        async for document in db[collection].find({}, projection):
            state = _field(document, key)
            label = str(state) if state not in (None, "") else NO_VALUE
            group = groups.setdefault(label, {"count": 0, **({"amount": 0} if amount else {})})
            group["count"] += 1
            if amount:
                value = _field(document, amount)
                group["amount"] += int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0
        result[collection] = dict(sorted(groups.items()))
    return result


async def schema_version(db) -> int:
    """Höchste erledigte Migration der Datenbank (``schema_migrations``), 0 ohne."""
    versions = [int(v) for v in await db.schema_migrations.distinct("version") if isinstance(v, int)]
    return max(versions, default=0)


def code_schema_version() -> int:
    """Höchste Migration, die dieser Code kennt."""
    from services.migrations import MIGRATIONS

    return max(version for version, _name, _run in MIGRATIONS)


async def mongo_version(db) -> str:
    try:
        return str((await db.command("buildInfo")).get("version") or "")
    except Exception:  # mongomock kennt buildInfo nicht überall
        return ""


async def references(db, upload_dir: pathlib.Path) -> dict:
    """Wie viele Dateien die Datenbank nennt und wie viele davon im Upload-Ordner fehlen."""
    from services.uploads_inventory import collect_references, list_files

    names = {row["name"] for row in list_files(upload_dir)}
    refs, _partial = await collect_references(db, names, complete=True)
    missing = sorted(name for name in refs if name not in names)
    return {"referenced_files": len(refs), "missing": len(missing), "missing_sample": missing[:20]}


async def snapshot(db, upload_dir: pathlib.Path, *, with_references: bool = False) -> dict:
    counts = await collection_counts(db)
    data = {
        "mongo_version": await mongo_version(db),
        "schema_version": await schema_version(db),
        "code_schema_version": code_schema_version(),
        "collections": counts,
        "ttl_collections": await ttl_collections(db, counts),
        "figures": await figures(db),
        "uploads": files_digest(upload_dir) if upload_dir.is_dir() else {"count": 0, "bytes": 0, "digest": digest_entries([])["digest"]},
    }
    if with_references:
        data["references"] = await references(db, upload_dir) if upload_dir.is_dir() else {"referenced_files": 0, "missing": 0, "missing_sample": []}
    return data


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m services.backup_inventory", description="Bestand für Backup und Restore")
    sub = parser.add_subparsers(dest="command", required=True)
    snap = sub.add_parser("snapshot", help="Sammlungen, Summen und Uploads zählen (liest nur)")
    snap.add_argument("--references", action="store_true", help="auch die Datei-Verweise prüfen (dauert länger)")
    snap.add_argument("--dir", default=os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
    sub.add_parser("code-info", help="Stand des Codes (höchste Migration)")
    return parser


async def _main(argv: list[str]) -> int:
    args = _parser().parse_args(argv)
    if args.command == "code-info":
        print(json.dumps({"code_schema_version": code_schema_version()}))
        return 0
    from motor.motor_asyncio import AsyncIOMotorClient

    client = AsyncIOMotorClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=10000)
    try:
        data = await snapshot(client[os.environ["DB_NAME"]], pathlib.Path(args.dir), with_references=args.references)
    finally:
        client.close()
    data["db_name"] = os.environ["DB_NAME"]
    print(json.dumps(data, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":  # pragma: no cover - Betriebsbefehl
    raise SystemExit(asyncio.run(_main(sys.argv[1:])))
