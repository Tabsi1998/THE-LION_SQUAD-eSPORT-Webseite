#!/usr/bin/env python3
"""Druckflächen umstellen (#2069): feste Zoll-Positionen (#1707) → Motiv, Vorgabe-Position und Größe in cm.

Ohne Schalter liest das Werkzeug nur (Trockenlauf) und nennt je Produkt, was aus den alten Platzierungen würde: welche
Vorgabe, welche Breite, was zu prüfen ist. Die Position bleibt erhalten (nächste Vorgabe plus Feinjustierung).
``--anwenden`` speichert die neuen Ebenen und bewahrt die alten Platzierungen als ``placements_legacy`` auf - der Stand
eines Produkts bleibt, seine Druckdateien entstehen danach mit „Druckdateien erzeugen“. ``--abbauen`` zeigt den Rückweg,
``--abbauen --anwenden`` setzt die aufbewahrten Platzierungen wieder ein.

Ein Produkt ohne gespeicherte Druckvorlage wird übersprungen - erst „Mit Printful abgleichen“ (oder der tägliche
Abgleich), dann noch einmal. Bis zur Umstellung rechnet die Website alte Produkte beim Lesen um; geschrieben wird nur
hier oder beim nächsten Speichern in Schritt 3.

Am Server, im Backend-Container (vorher eine Sicherung ziehen, BACKUP_RESTORE.md):
    docker compose exec backend python scripts/shop_print_layout.py
    docker compose exec backend python scripts/shop_print_layout.py --anwenden
    docker compose exec backend python scripts/shop_print_layout.py --abbauen --anwenden

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

from services import shop_print_files  # noqa: E402


def parse(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Druckflächen umstellen: Trockenlauf, Anwenden oder Rückweg.")
    parser.add_argument("--anwenden", action="store_true", help="wirklich ausführen (sonst nur Bericht)")
    parser.add_argument("--abbauen", action="store_true", help="Rückweg: alte Platzierungen wieder einsetzen")
    return parser.parse_args(argv)


def _connect():
    import os

    from dotenv import load_dotenv
    from motor.motor_asyncio import AsyncIOMotorClient

    load_dotenv(BACKEND / ".env")
    return AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def render(report: list[dict], *, way_back: bool, applied: bool) -> str:
    lines = ["Druckflächen (#2069, docs/SHOP.md)"]
    if not report:
        lines.append("  ok      nichts umzustellen" if not way_back else "  ok      nichts zurückzunehmen")
    for item in report:
        name = f"{item.get('title') or item['id']} ({item.get('slug') or '-'})"
        if way_back:
            lines.append(f"  {'zurück ' if item.get('applied') else 'würde  '} {name}: {item['placements']} alte "
                         "Platzierungen")
            continue
        state = "neu    " if item.get("applied") else ("würde  " if item["ready"] else "fehlt  ")
        lines.append(f"  {state} {name}")
        lines += [f"            {note}" for note in item["notes"]]
    if not applied and report:
        lines.append("Trockenlauf - mit --anwenden ausführen.")
    return "\n".join(lines) + "\n"


async def main(argv: list[str] | None = None, *, db=None, out=None) -> int:
    args = parse(sys.argv[1:] if argv is None else argv)
    out = out or sys.stdout
    db = db if db is not None else _connect()
    if args.abbauen:
        report = await shop_print_files.rollback_migration(db, apply=args.anwenden)
    else:
        report = await shop_print_files.migrate(db, apply=args.anwenden)
    out.write(render(report, way_back=args.abbauen, applied=args.anwenden))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
