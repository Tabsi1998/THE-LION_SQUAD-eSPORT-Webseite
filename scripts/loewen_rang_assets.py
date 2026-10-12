"""Die 12 Rahmen des Löwen-Rangs für Web und App aufbereiten (#1453).

    python scripts/loewen_rang_assets.py --src <Ordner mit rang-01.png … rang-12.png>

Quelle: 12 gezeichnete Rahmen (je 1024 × 1024 PNG mit Transparenz), vom Verein für THE LION SQUAD erzeugt. Die
PNG-Originale liegen beim Betreiber und nicht im Repository - hier landen nur die verkleinerten WebP-Fassungen.

Je Rahmen entstehen:
- WebP in 160, 320 und 640 px (``rang-NN-160.webp`` …) unter ``frontend/public/assets/loewen-rang/`` und
  ``mobile/assets/loewen-rang/``;
- die Ring-Geometrie: Die Grafiken sind nicht genau mittig gezeichnet (bis 5 % Versatz, der Löwenkopf ragt oben
  ins Loch). Ein Kreis-Fit am Alphakanal misst Mitte (``cx``, ``cy``) und Radius ``r`` des Lochs als Anteil der
  Kantenlänge, dazu ``box``: wie weit die Grafik reicht (links, oben, rechts, unten). Außerdem rund 400 Punkte der
  Außenkante (``edge``) für die Effekte und ``v``, eine kurze Prüfsumme der Bilder - das Web hängt sie an die
  Adresse, damit nginx (30 Tage Cache) eine neue Fassung lädt.

``geometry.json`` (mit Außenkante) liegt neben den Bildern, ``frontend/src/lib/loewenRangRing.json`` (Mitte,
Radius, Ausdehnung und Prüfsumme) liest der Profilrahmen ohne Netzabruf. Braucht Pillow mit WebP.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import random
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WEB_OUT = ROOT / "frontend" / "public" / "assets" / "loewen-rang"
APP_OUT = ROOT / "mobile" / "assets" / "loewen-rang"
RING_JSON = ROOT / "frontend" / "src" / "lib" / "loewenRangRing.json"
KEYS = [f"{n:02d}" for n in range(1, 13)]
WIDTHS = (160, 320, 640)
QUALITY = {160: 82, 320: 84, 640: 86}
MEASURE = 512  # Messauflösung für Loch und Außenkante
EDGE_POINTS = 420


def circle_fit(points: list[tuple[int, int]]) -> tuple[float, float, float]:
    """Kreis durch Punkte nach der Methode der kleinsten Quadrate: Mitte und mittlerer Radius."""
    n = len(points)
    mx = sum(x for x, _ in points) / n
    my = sum(y for _, y in points) / n
    u = [x - mx for x, _ in points]
    v = [y - my for _, y in points]
    suu = sum(i * i for i in u)
    svv = sum(i * i for i in v)
    suv = sum(i * j for i, j in zip(u, v))
    b1 = (sum(i**3 for i in u) + sum(i * j * j for i, j in zip(u, v))) / 2
    b2 = (sum(i**3 for i in v) + sum(j * i * i for i, j in zip(u, v))) / 2
    det = suu * svv - suv * suv
    uc = (b1 * svv - b2 * suv) / det
    vc = (suu * b2 - suv * b1) / det
    cx, cy = uc + mx, vc + my
    return cx, cy, sum(math.hypot(x - cx, y - cy) for x, y in points) / n


def art_box(image: Image.Image) -> list[float]:
    """Wie weit die Grafik reicht (Alpha > 24): links, oben, rechts, unten als Anteil der Kantenlänge, nach außen
    gerundet. Daraus rechnet das Web den Platz, den der Rahmen um das Foto braucht."""
    w, h = image.size
    left, top, right, bottom = image.getchannel("A").point(lambda a: 255 if a > 24 else 0).getbbox()
    return [math.floor(left / w * 1000) / 1000, math.floor(top / h * 1000) / 1000, math.ceil(right / w * 1000) / 1000, math.ceil(bottom / h * 1000) / 1000]


def measure(image: Image.Image) -> dict:
    """Loch per Flutfüllung von der Mitte (Alpha < 40), dann Kreis-Fit an dessen Rand; Ausreißer nach innen (der
    Löwenkopf) fliegen in sechs Runden heraus. Außenkante: deckende Pixel neben Transparenz außerhalb des Lochs."""
    im = image.resize((MEASURE, MEASURE), Image.LANCZOS)
    w, h = im.size
    alpha = im.split()[3].load()
    hole = bytearray(w * h)
    queue = deque([(w // 2, h // 2)])
    hole[(h // 2) * w + w // 2] = 1
    while queue:
        x, y = queue.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not hole[ny * w + nx] and alpha[nx, ny] < 40:
                hole[ny * w + nx] = 1
                queue.append((nx, ny))
    rim = [
        (x, y)
        for y in range(1, h - 1)
        for x in range(1, w - 1)
        if hole[y * w + x] and (not hole[y * w + x + 1] or not hole[y * w + x - 1] or not hole[(y + 1) * w + x] or not hole[(y - 1) * w + x])
    ]
    cx, cy, r = circle_fit(rim)
    for _ in range(6):
        cx, cy, r = circle_fit([(x, y) for x, y in rim if math.hypot(x - cx, y - cy) > r - 4])
    edge = [
        (x, y)
        for y in range(1, h - 1)
        for x in range(1, w - 1)
        if alpha[x, y] > 128 and any(alpha[x + dx, y + dy] < 40 and not hole[(y + dy) * w + x + dx] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
    ]
    random.Random(1).shuffle(edge)
    return {
        "cx": round(cx / w, 4),
        "cy": round(cy / h, 4),
        "r": round(r / w, 4),
        "box": art_box(image),
        "edge": [[round(x / w, 3), round(y / h, 3)] for x, y in edge[:EDGE_POINTS]],
    }


def webp(image: Image.Image, width: int) -> bytes:
    out = io.BytesIO()
    image.resize((width, width), Image.LANCZOS).save(out, "WEBP", quality=QUALITY[width], method=6)
    return out.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--src", required=True, type=Path, help="Ordner mit rang-01.png … rang-12.png (1024², transparent)")
    parser.add_argument("--web-out", type=Path, default=WEB_OUT)
    parser.add_argument("--app-out", type=Path, default=APP_OUT)
    parser.add_argument("--ring-json", type=Path, default=RING_JSON)
    args = parser.parse_args()

    for folder in (args.web_out, args.app_out):
        folder.mkdir(parents=True, exist_ok=True)
    geometry: dict[str, dict] = {}
    for key in KEYS:
        source = Image.open(args.src / f"rang-{key}.png").convert("RGBA")
        digest = hashlib.sha256()
        sizes = []
        for width in WIDTHS:
            data = webp(source, width)
            digest.update(data)
            sizes.append(f"{width}: {len(data) / 1024:.1f} KB")
            for folder in (args.web_out, args.app_out):
                (folder / f"rang-{key}-{width}.webp").write_bytes(data)
        geometry[key] = {**measure(source), "v": digest.hexdigest()[:8]}
        g = geometry[key]
        print(f"rang-{key}: Mitte {g['cx']:.3f}/{g['cy']:.3f}, Radius {g['r']:.3f} - " + ", ".join(sizes))

    text = json.dumps(geometry, separators=(",", ":")) + "\n"
    for folder in (args.web_out, args.app_out):
        (folder / "geometry.json").write_text(text, encoding="utf-8", newline="\n")
    ring = {key: {k: g[k] for k in ("cx", "cy", "r", "box", "v")} for key, g in geometry.items()}
    args.ring_json.write_text(json.dumps(ring, indent=2) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
