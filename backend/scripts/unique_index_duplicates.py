#!/usr/bin/env python3
"""Altdubletten vor eindeutigen Indizes (#1043): erst Trockenlauf, dann bewusst bereinigen.

Ohne Schalter liest das Werkzeug nur und schreibt einen Bericht (welche eindeutigen Indizes fehlen, wie viele Gruppen
und überzählige Zeilen, welche Regel gilt). Erst ``--anwenden`` entfernt die überzähligen Zeilen - nur dort, wo die
Regel feststeht - und legt den eindeutigen Index gleich an. Das Protokoll mit jeder entfernten Zeile geht als JSON auf
stdout, die Zusammenfassung auf stderr. Ins Adminprotokoll kommen nur die Zahlen.

Am Server, im Backend-Container (vorher eine Sicherung ziehen, BACKUP_RESTORE.md):
    docker compose exec backend python scripts/unique_index_duplicates.py
    docker compose exec -T backend python scripts/unique_index_duplicates.py --anwenden > dubletten-protokoll.json
    docker compose exec -T backend python scripts/unique_index_duplicates.py --anwenden --nur user_xp.user > ...

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

from services import unique_duplicates  # noqa: E402


def parse(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Altdubletten vor eindeutigen Indizes: Trockenlauf oder Bereinigung.")
    parser.add_argument("--anwenden", action="store_true",
                        help="überzählige Zeilen wirklich entfernen und den eindeutigen Index anlegen (sonst nur Bericht)")
    parser.add_argument("--nur", action="append", default=[], metavar="SAMMLUNG.INDEX",
                        help="nur diesen Index (mehrfach möglich), etwa user_xp.user")
    parser.add_argument("--wer", default="", help="wer den Lauf ausführt - steht im Protokoll")
    return parser.parse_args(argv)


def _connect():
    import os

    from dotenv import load_dotenv
    from motor.motor_asyncio import AsyncIOMotorClient

    load_dotenv(BACKEND / ".env")
    return AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


async def main(argv: list[str] | None = None, *, db=None, out=None, err=None) -> int:
    args = parse(sys.argv[1:] if argv is None else argv)
    out, err = out or sys.stdout, err or sys.stderr
    only = set(args.nur) or None
    unknown = sorted((only or set()) - set(unique_duplicates.known_indexes()))
    if unknown:
        err.write(f"Unbekannter Index: {', '.join(unknown)}. Bekannt: {', '.join(unique_duplicates.known_indexes())}\n")
        return 2
    db = db if db is not None else _connect()
    if not args.anwenden:
        out.write(unique_duplicates.render_text(await unique_duplicates.plan(db, only)))
        return 0
    protocol = await unique_duplicates.apply(db, actor=args.wer or "scripts/unique_index_duplicates.py", only=only)
    out.write(unique_duplicates.protocol_json(protocol) + "\n")
    report = await unique_duplicates.plan(db, only)
    removed = sum(row["removed"] for row in protocol["indexes"])
    err.write(f"{removed} Zeilen entfernt.\n" + unique_duplicates.render_text(report, applied=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
