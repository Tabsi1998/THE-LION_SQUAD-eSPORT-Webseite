#!/usr/bin/env python3
"""Motive mit Fassungen für dunkle und helle Shirts (#2069): Trockenlauf, Anwenden und Rückweg von Migration 14.

Ohne Schalter liest das Werkzeug nur und nennt, was Migration 14 ändert: Fassungen ohne Variante (werden „für dunkle
Shirts“), Designs ohne Einstellung „Hell-Variante“ (werden „automatisch“) und die festen Farben aus #1708/#1707, die als
Ausnahme „Hauptdatei“ erhalten bleiben. ``--anwenden`` führt das aus (dasselbe macht der Start). ``--abbauen`` zeigt
den Rückweg, ``--abbauen --anwenden`` führt ihn aus: Varianten, Einstellungen und Ausnahmen entfernen und Migration 14
austragen - nur, solange es keine Fassungen für helle Shirts gibt. Danach die ältere Version einspielen; sonst wendet der
nächste Start die Migration wieder an.

Am Server, im Backend-Container (vorher eine Sicherung ziehen, BACKUP_RESTORE.md):
    docker compose exec backend python scripts/shop_motifs.py
    docker compose exec backend python scripts/shop_motifs.py --abbauen
    docker compose exec backend python scripts/shop_motifs.py --abbauen --anwenden

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

from services import shop_motifs  # noqa: E402


def parse(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Motive (#2069): Trockenlauf, Anwenden oder Rückweg von Migration 14.")
    parser.add_argument("--anwenden", action="store_true", help="wirklich ausführen (sonst nur Bericht)")
    parser.add_argument("--abbauen", action="store_true", help="Rückweg: Varianten und Ausnahmen entfernen")
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
        way_back = await shop_motifs.rollback(db, apply=args.anwenden)
        out.write(shop_motifs.render_text(await shop_motifs.plan(db), way_back=way_back))
        return 1 if args.anwenden and not way_back["applied"] else 0
    if args.anwenden:
        out.write(await shop_motifs.apply(db) + "\n")
    out.write(shop_motifs.render_text(await shop_motifs.plan(db)))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
