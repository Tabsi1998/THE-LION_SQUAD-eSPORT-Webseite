#!/usr/bin/env python3
"""Shop-Datenmodell (#1703): Trockenlauf, Anlegen und Rückweg der Indizes - Migration 13.

Ohne Schalter liest das Werkzeug nur und nennt, welche Shop-Indizes fehlen und wie viele Zeilen die Shop-Sammlungen
haben. ``--anwenden`` legt fehlende Indizes an (dasselbe macht der Start). ``--abbauen`` zeigt den Rückweg,
``--abbauen --anwenden`` führt ihn aus: Shop-Indizes entfernen und Migration 13 austragen - nur, solange keine
Shop-Sammlung Daten hat. Danach die ältere Version einspielen; sonst legt der nächste Start die Indizes wieder an.

Am Server, im Backend-Container (vorher eine Sicherung ziehen, BACKUP_RESTORE.md):
    docker compose exec backend python scripts/shop_schema.py
    docker compose exec backend python scripts/shop_schema.py --abbauen
    docker compose exec backend python scripts/shop_schema.py --abbauen --anwenden

Umgebung: dieselben MONGO_URL und DB_NAME wie das Backend.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from services import shop_schema  # noqa: E402


def parse(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Shop-Datenmodell: Trockenlauf, Anlegen oder Rückweg der Indizes.")
    parser.add_argument("--anwenden", action="store_true", help="wirklich ausführen (sonst nur Bericht)")
    parser.add_argument("--abbauen", action="store_true", help="Rückweg: Shop-Indizes entfernen, Migration austragen")
    return parser.parse_args(argv)


def _connect():
    import os

    from dotenv import load_dotenv
    from motor.motor_asyncio import AsyncIOMotorClient

    load_dotenv(BACKEND / ".env")
    return AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


async def main(argv: list[str] | None = None, *, db=None, out=None) -> int:
    args = parse(sys.argv[1:] if argv is None else argv)
    out = out or sys.stdout
    db = db if db is not None else _connect()
    if args.abbauen:
        way_back = await shop_schema.rollback(db, apply=args.anwenden)
        out.write(shop_schema.render_text(await shop_schema.plan(db), way_back=way_back))
        return 1 if args.anwenden and not way_back["applied"] else 0
    if args.anwenden:
        out.write(await shop_schema.apply(db) + "\n")
    out.write(shop_schema.render_text(await shop_schema.plan(db)))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
