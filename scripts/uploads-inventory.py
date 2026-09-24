#!/usr/bin/env python3
"""Upload-Inventar (#537): welche Dateien liegen unter UPLOAD_DIR, wer verweist darauf, was ist verwaist.
Liest nur - schreibt nichts, löscht nichts. Das Ergebnis ist ein Markdown-Bericht (oder JSON).

Am Server, im Backend-Container:
    docker compose exec backend python3 scripts/uploads-inventory.py > /tmp/upload-inventar.md
    docker compose exec backend python3 scripts/uploads-inventory.py --json > /tmp/upload-inventar.json

Umgebung: dieselben MONGO_URL, DB_NAME und UPLOAD_DIR wie das Backend.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from services.uploads_inventory import inventory, render_markdown  # noqa: E402

WRITE_METHODS = {
    "insert_one", "insert_many", "update_one", "update_many", "replace_one", "delete_one", "delete_many",
    "find_one_and_update", "find_one_and_replace", "find_one_and_delete", "bulk_write", "drop", "rename",
    "create_index", "drop_index", "drop_indexes",
}


class ReadOnlyCollection:
    def __init__(self, collection):
        self._collection = collection

    def __getattr__(self, name):
        if name in WRITE_METHODS:
            raise RuntimeError(f"Das Inventar darf nicht schreiben (versucht: {name}).")
        return getattr(self._collection, name)


class ReadOnlyDb:
    def __init__(self, db):
        self._db = db

    def __getattr__(self, name):
        if name == "list_collection_names":
            return self._db.list_collection_names
        return ReadOnlyCollection(getattr(self._db, name))

    def __getitem__(self, name):
        return ReadOnlyCollection(self._db[name])


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dir", default=os.environ.get("UPLOAD_DIR", "/app/backend/uploads"), help="Upload-Ordner (Standard: UPLOAD_DIR)")
    parser.add_argument("--sample", type=int, default=60, help="Wie viele Dateien je Liste im Bericht stehen")
    parser.add_argument("--json", action="store_true", help="Vollständiges Ergebnis als JSON statt Markdown")
    args = parser.parse_args()
    upload_dir = Path(args.dir)
    if not upload_dir.is_dir():
        print(f"Upload-Ordner nicht gefunden: {upload_dir}", file=sys.stderr)
        return 2
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "tls_arena")
    client = AsyncIOMotorClient(mongo_url)
    try:
        report = await inventory(ReadOnlyDb(client[db_name]), upload_dir, sample=args.sample)
    finally:
        client.close()
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(render_markdown(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
