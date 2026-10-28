#!/usr/bin/env python3
"""Doppelte Jahrespunkte je Turnier (#2123): Trockenlauf und Anwenden von Migration 18.

Ohne Schalter liest das Werkzeug nur und nennt, wie viele Einträge Migration 18 entfernt: je Turnier, Person und Team
bleibt ein Eintrag (der mit dem Typ des aktuellen Turniergewichts, sonst der jüngste). ``--anwenden`` führt das aus -
dasselbe macht der nächste Start. Entfernte Einträge stehen je Turnier im Protokoll
(``season_points.duplicates_removed``).

Am Server, im Backend-Container (vorher eine Sicherung ziehen, BACKUP_RESTORE.md):
    docker compose exec backend python scripts/season_points_duplicates.py
    docker compose exec backend python scripts/season_points_duplicates.py --anwenden

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

from services import season_points_cleanup  # noqa: E402


def parse(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Doppelte Jahrespunkte (#2123): Trockenlauf oder Anwenden von Migration 18.")
    parser.add_argument("--anwenden", action="store_true", help="wirklich entfernen (sonst nur zählen)")
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
    out.write(season_points_cleanup.render_text(await season_points_cleanup.plan(db)))
    if args.anwenden:
        out.write(await season_points_cleanup.apply(db) + "\n")
        out.write(season_points_cleanup.render_text(await season_points_cleanup.plan(db)))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
