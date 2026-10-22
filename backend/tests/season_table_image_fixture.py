"""Testhilfe (#1999): synthetische Saison- bzw. Teamtabelle im Layout der PRL - dunkler Hintergrund, Titel, Kopf mit
„Pos.“, „Team“, einer Flagge je Rennen (farbige Rechtecke, keine Schrift), „Punkte:“ und „Dif.“, Platz 1 im gelben
Kasten, farbige Teamnamen, „--“ für nicht angetreten und gelbe Linien zwischen den Zeilen. Zwölf erfundene Teams und
17 Runden; eine Zeile hat eine Strafe (Punkte = Summe - 5), wie es in echten Tabellen vorkommt. Nur erfundene Namen -
das Repository ist öffentlich.

Die Schrift ist die, die Pillow selbst mitbringt (``ImageFont.load_default(size)``) - so entsteht auf jedem Rechner
dasselbe Bild. Umlaute kennt diese Schrift nicht, darum stehen keine in den Namen.

    python backend/tests/season_table_image_fixture.py ZIEL.png [--drivers]
"""
from __future__ import annotations

import io
import random
import sys
from dataclasses import dataclass, field

from PIL import Image, ImageDraw, ImageFont

BACKGROUND = (22, 22, 28)
TITLE = (255, 236, 0)
LINE = (255, 236, 0)
WHITE = (240, 240, 245)
RANK_BOX = (12, 12, 18)
WINNER_BOX = (255, 236, 0)
WINNER_DIGIT = (20, 20, 20)
FLAGS = [((0, 120, 200), (230, 40, 50)), ((230, 40, 50), (250, 250, 250)), ((230, 40, 50), (250, 250, 250)),
         ((20, 20, 20), (250, 210, 0)), ((0, 140, 70), (230, 40, 50)), ((230, 40, 50), (250, 250, 250)),
         ((250, 250, 250), (200, 20, 40)), ((0, 150, 60), (250, 210, 0)), ((230, 40, 50), (250, 250, 250)),
         ((30, 50, 140), (230, 40, 50)), ((20, 40, 120), (230, 40, 50)), ((200, 30, 40), (30, 70, 160)),
         ((130, 20, 50), (250, 250, 250)), ((220, 30, 30), (250, 200, 0)), ((0, 110, 60), (250, 250, 250)),
         ((0, 140, 70), (230, 40, 50)), ((20, 40, 120), (230, 40, 50))]
TEAMS = [("Probe Falken Racing", (150, 90, 255)), ("Rotor Probe", (230, 40, 50)), ("Die Testwaffel", (60, 150, 255)),
         ("Musterloewen", (230, 60, 230)), ("Turbo Beispiel", (90, 230, 60)), ("OG_Probe", (240, 240, 245)),
         ("Blau Testfahrer", (60, 90, 255)), ("Probe_Eisblock", (250, 230, 40)), ("Rueckwaerts Pole", (255, 160, 30)),
         ("Team Testgau", (170, 160, 255)), ("GG2PROBE", (40, 170, 70)), ("Z&Z Probe Team", (0, 220, 240))]
ROUNDS = 17
PENALTY_ROW = 3  # „Musterloewen“: 5 Punkte Strafe - Punkte sind nicht die Summe der Runden


@dataclass
class TableRow:
    name: str
    color: tuple
    cells: list[str] = field(default_factory=list)  # je Runde „35“ oder „--“
    total: int = 0
    gap: str = ""


def sample_rows(*, drivers: bool = False, seed: int = 1999) -> list[TableRow]:
    """Zwölf erfundene Teams (bzw. Fahrer) mit 17 Runden - „--“ heißt nicht angetreten. Sortiert nach Punkten, die
    Abstände zum Ersten in „Dif.“."""
    rng = random.Random(seed)
    rows = []
    for index, (name, color) in enumerate(TEAMS):
        if drivers:
            name = ["Ada Ausgedacht", "Bruno Beispiel", "Cleo Muster", "Dario Demo", "Ella Erfunden", "Finn Fiktiv",
                    "Gina Gedacht", "Hugo Probe", "Ida Imaginaer", "Jonas Jux", "Kira Keinname", "Leo Laut"][index]
        start = 0 if index % 4 else rng.randint(0, 6)
        stop = ROUNDS - (rng.randint(0, 7) if index % 3 == 1 else 0)
        cells = []
        for number in range(ROUNDS):
            if number < start or number >= stop or rng.random() < 0.12:
                cells.append("--")
            else:
                cells.append(str(rng.choice([0, 6, 7, 8, 10, 13, 15, 17, 20, 23, 26, 30, 35, 42, 47, 50, 55, 61, 65])))
        total = sum(int(value) for value in cells if value != "--") - (5 if index == PENALTY_ROW else 0)
        rows.append(TableRow(name, color, cells, total))
    rows.sort(key=lambda row: -row.total)
    for row in rows:
        row.gap = "--" if row is rows[0] else str(row.total - rows[0].total)
    return rows


def _font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.load_default(size=size)


def _text(draw, xy, text: str, *, size: int, fill, bold: bool = False, anchor: str = "mm"):
    draw.text(xy, text, font=_font(size), fill=fill, anchor=anchor, stroke_width=1 if bold else 0,
              stroke_fill=fill if bold else None)


def render(rows: list[TableRow] | None = None, *, width: int = 1450, label: str = "Team") -> Image.Image:
    """Das Bild der Tabelle (wie die PRL-Teamtabelle). ``label``: Überschrift der Namensspalte („Team“, „Fahrer“)."""
    rows = rows or sample_rows()
    row_h, top = 48, 106
    height = top + row_h * len(rows) + 24
    img = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(img)
    _text(draw, (40, 30), "Probe eSports Racing - PRL99", size=28, fill=TITLE, bold=True, anchor="lm")
    draw.line((14, 50, width - 14, 50), fill=WHITE, width=2)
    header_y = 78
    _text(draw, (42, header_y), "Pos.", size=15, fill=WHITE, bold=True)
    _text(draw, (100, header_y), label, size=15, fill=WHITE, bold=True, anchor="lm")
    xs = [324 + index * 59.2 for index in range(ROUNDS)]
    for x, (first, second) in zip(xs, FLAGS):
        draw.rounded_rectangle((x - 19, header_y - 11, x + 19, header_y + 11), radius=3, fill=first,
                               outline=(250, 250, 250), width=2)
        draw.rectangle((x - 17, header_y - 2, x + 17, header_y + 4), fill=second)
    _text(draw, (1340, header_y), "Punkte:", size=15, fill=WHITE, bold=True)
    _text(draw, (1400, header_y), "Dif.", size=15, fill=WHITE, bold=True)
    draw.line((14, top - 2, width - 14, top - 2), fill=LINE, width=1)
    for index, row in enumerate(rows):
        y = top + index * row_h + row_h // 2
        box = WINNER_BOX if index == 0 else RANK_BOX
        draw.rectangle((26, y - 19, 61, y + 19), fill=box)
        _text(draw, (44, y), str(index + 1), size=17, fill=WINNER_DIGIT if index == 0 else WHITE, bold=True)
        _text(draw, (120, y), row.name, size=16, fill=row.color, anchor="lm")
        for x, value in zip(xs, row.cells):
            _text(draw, (x, y), value, size=16, fill=WHITE)
        _text(draw, (1340, y), str(row.total), size=16, fill=WHITE)
        _text(draw, (1400, y), row.gap, size=16, fill=WHITE)
        draw.line((14, top + (index + 1) * row_h, width - 14, top + (index + 1) * row_h), fill=LINE, width=1)
    return img


def png_bytes(img: Image.Image) -> bytes:
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


if __name__ == "__main__":  # pragma: no cover - Beispielbild für die Abnahme
    drivers = "--drivers" in sys.argv
    render(sample_rows(drivers=drivers), label="Fahrer" if drivers else "Team").save(sys.argv[1])
