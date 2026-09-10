#!/usr/bin/env python3
"""Was die Bilder dieser Installation wiegen, und was Vorschaubilder sparen.

Liest nur. Schreibt nichts, loescht nichts, veraendert nichts.

Die Zahlen zu Bildgroessen haengen stark vom Inhalt ab - ein Gruppenfoto
komprimiert anders als ein Bildschirmfoto. Deshalb misst dieses Skript die
echten Dateien dieser Installation, statt mit erfundenen Beispielen zu rechnen.

    python3 scripts/media-report.py
    python3 scripts/media-report.py --dir /pfad/zu/uploads --limit 200
"""
from __future__ import annotations

import argparse
import io
import os
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - nur ausserhalb des Containers
    print("Pillow fehlt. Im Backend-Container ausfuehren:")
    print("  docker compose exec backend python3 scripts/media-report.py")
    raise SystemExit(1)

VARIANT_WIDTHS = (400, 800, 1600)
QUALITY = {400: 78, 800: 80, 1600: 82}
IMAGE_SUFFIXES = {".webp", ".jpg", ".jpeg", ".png"}


def human(num_bytes: float) -> str:
    for unit in ("B", "kB", "MB", "GB"):
        if abs(num_bytes) < 1024 or unit == "GB":
            return f"{num_bytes:,.1f} {unit}".replace(",", ".")
        num_bytes /= 1024
    return f"{num_bytes:.1f} GB"


def encoded_size(image: Image.Image, width: int) -> int:
    copy = image.convert("RGB").copy()
    copy.thumbnail((width, width * 4), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    copy.save(buffer, format="WEBP", quality=QUALITY[width], method=6)
    return buffer.tell()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dir", default=os.environ.get("UPLOAD_DIR", "/app/backend/uploads"),
                        help="Uploadordner (Vorgabe: UPLOAD_DIR)")
    parser.add_argument("--limit", type=int, default=120, help="Wie viele Bilder gemessen werden")
    args = parser.parse_args()

    base = Path(args.dir)
    if not base.is_dir():
        print(f"Ordner nicht gefunden: {base}")
        print("Im Container liegt er unter /app/backend/uploads.")
        return 1

    files = [p for p in sorted(base.rglob("*"))
             if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES and "variants" not in p.parts]
    if not files:
        print(f"Keine Bilder in {base}.")
        return 0

    gemessen = files[:args.limit]
    gesamt_original = 0
    gesamt = {width: 0 for width in VARIANT_WIDTHS}
    breiten: list[int] = []
    fehler = 0

    for path in gemessen:
        try:
            with Image.open(path) as image:
                breiten.append(image.width)
                gesamt_original += path.stat().st_size
                for width in VARIANT_WIDTHS:
                    gesamt[width] += encoded_size(image, width) if image.width > width else path.stat().st_size
        except Exception:
            fehler += 1

    zahl = len(gemessen) - fehler
    if zahl <= 0:
        print("Kein Bild liess sich lesen.")
        return 1

    print(f"Ordner:            {base}")
    print(f"Bilder gefunden:   {len(files)}   davon gemessen: {zahl}"
          + (f"   nicht lesbar: {fehler}" if fehler else ""))
    print(f"Breite im Mittel:  {sum(breiten)//len(breiten)} px"
          f"   groesstes: {max(breiten)} px")
    print()
    print(f"{'Fassung':>16} {'gesamt':>12} {'je Bild':>10} {'Ersparnis':>11}")
    print(f"{'wie heute':>16} {human(gesamt_original):>12} {human(gesamt_original/zahl):>10} {'-':>11}")
    for width in VARIANT_WIDTHS:
        anteil = 1 - gesamt[width] / gesamt_original if gesamt_original else 0
        print(f"{f'Breite {width}':>16} {human(gesamt[width]):>12}"
              f" {human(gesamt[width]/zahl):>10} {anteil*100:>10.0f}%")
    print()
    kacheln = 24
    print(f"Ein Galerieraster mit {kacheln} Kacheln laedt heute"
          f" {human(gesamt_original/zahl*kacheln)},")
    print(f"mit Vorschaubildern in Breite 400 noch {human(gesamt[400]/zahl*kacheln)}.")
    print()
    print("Die Vorschaubilder entstehen beim ersten Abruf von selbst;")
    print("es ist nichts zu migrieren und nichts einzustellen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
