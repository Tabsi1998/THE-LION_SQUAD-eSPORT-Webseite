"""Die Vereinsschriften für die Website bauen (#1228).

Holt die lateinischen WOFF2-Dateien aus den Fontsource-Paketen (dieselben Dateien wie bei Google Fonts),
macht die Ziffern von Rajdhani gleich breit und legt alles unter frontend/public/fonts ab - mit einer
Prüfsumme im Dateinamen, weil nginx Schriften ein Jahr lang unverändert zwischenspeichern lässt: eine
geänderte Datei braucht einen neuen Namen. Daneben liegen die Lizenzen (SIL Open Font License).

Danach die neuen Namen in frontend/src/fonts.css und frontend/index.html eintragen; der Test
frontend/src/fonts.test.js sagt, wo etwas nicht passt.

Aufruf aus dem Repo-Stamm (braucht npm und Python mit fonttools und brotli):
    python -m pip install fonttools brotli
    python scripts/build_web_fonts.py

Welche Schnitte (Fabians Auswahl vom 07.10.2026): Unbounded 700 und 800 für Bühne und Seitentitel, Outfit
400 bis 800 für alles andere (eine variable Datei ist kleiner als fünf einzelne), Rajdhani 600 und 700 für
Zahlen. Rajdhani hat keine gleich breiten Ziffern - die Ableitung hier setzt jede Ziffer mittig in die
Breite der breitesten (die Lizenz erlaubt das, Rajdhani hat keinen reservierten Namen).
"""
from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "frontend" / "public" / "fonts"
VERSION = "5.3.0"

# (npm-Paket, Datei im Paket, Name ohne Prüfsumme, Ziffern gleich breit machen)
FILES = [
    ("@fontsource-variable/outfit", "files/outfit-latin-wght-normal.woff2", "outfit-latin-wght", False),
    ("@fontsource/unbounded", "files/unbounded-latin-700-normal.woff2", "unbounded-latin-700", False),
    ("@fontsource/unbounded", "files/unbounded-latin-800-normal.woff2", "unbounded-latin-800", False),
    ("@fontsource/rajdhani", "files/rajdhani-latin-600-normal.woff2", "rajdhani-latin-600", True),
    ("@fontsource/rajdhani", "files/rajdhani-latin-700-normal.woff2", "rajdhani-latin-700", True),
]
LICENSES = {
    "@fontsource-variable/outfit": "OFL-Outfit.txt",
    "@fontsource/unbounded": "OFL-Unbounded.txt",
    "@fontsource/rajdhani": "OFL-Rajdhani.txt",
}
DIGITS = "0123456789"


def fetch(package: str, workdir: Path) -> Path:
    """Das Paket mit npm holen und entpacken; zurück kommt der Ordner „package“."""
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        sys.exit("npm nicht gefunden - Node.js installieren oder in den PATH nehmen.")
    target = workdir / package.replace("/", "_").replace("@", "")
    target.mkdir(parents=True, exist_ok=True)
    result = subprocess.run([npm, "pack", f"{package}@{VERSION}", "--pack-destination", str(target)],
                            check=True, capture_output=True, text=True)
    archive = target / result.stdout.strip().splitlines()[-1]
    with tarfile.open(archive) as tar:
        tar.extractall(target, filter="data")
    return target / "package"


def tabular_digits(source: Path, target: Path) -> None:
    """Jede Ziffer bekommt die Breite der breitesten und steht mittig darin."""
    from fontTools.ttLib import TTFont

    font = TTFont(source, recalcTimestamp=False)
    cmap = font.getBestCmap()
    names = [cmap[ord(char)] for char in DIGITS]
    metrics = font["hmtx"].metrics
    glyf = font["glyf"]
    width = max(metrics[name][0] for name in names)
    shifts = {}
    for name in names:
        glyph = glyf[name]
        shift = round((width - metrics[name][0]) / 2)
        shifts[name] = shift
        if shift and glyph.isComposite():
            for component in glyph.components:
                component.x += shift
        elif shift and glyph.numberOfContours > 0:
            glyph.coordinates.translate((shift, 0))
        glyph.recalcBounds(glyf)
        metrics[name] = (width, getattr(glyph, "xMin", 0))
    # Zeichen, die aus Ziffern zusammengesetzt sind (etwa ½), bleiben, wo sie waren.
    for name in font.getGlyphOrder():
        glyph = glyf[name]
        if name in shifts or not glyph.isComposite():
            continue
        moved = False
        for component in glyph.components:
            if shifts.get(component.glyphName):
                component.x -= shifts[component.glyphName]
                moved = True
        if moved:
            glyph.recalcBounds(glyf)
    font["OS/2"].recalcAvgCharWidth(font)
    for record in font["name"].names:
        if record.nameID == 5:
            record.string = f"{record.toUnicode()}; LION: gleich breite Ziffern"
    font.flavor = "woff2"
    font.save(target)


def with_checksum(path: Path, stem: str) -> Path:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:8]
    final = TARGET / f"{stem}-{digest}.woff2"
    path.replace(final)
    return final


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    for old in TARGET.glob("*.woff2"):
        old.unlink()
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        packages = {package: fetch(package, workdir) for package in dict.fromkeys(item[0] for item in FILES)}
        for package, inner, stem, tabular in FILES:
            source = packages[package] / inner
            staging = workdir / f"{stem}.woff2"
            if tabular:
                tabular_digits(source, staging)
            else:
                shutil.copyfile(source, staging)
            final = with_checksum(staging, stem)
            print(f"{final.relative_to(ROOT).as_posix()}  {final.stat().st_size} Bytes")
        for package, name in LICENSES.items():
            text = (packages[package] / "LICENSE").read_text(encoding="utf-8")
            (TARGET / name).write_text(text, encoding="utf-8", newline="\n")
            print(f"{(TARGET / name).relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    main()
