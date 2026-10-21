"""Testhilfe (#1756): synthetische Ergebnis-Screenshots einer Rennliga im Stil der Vorlage „Rennliga-Ergebnis (dunkel)“.

Dunkler Hintergrund, Kopf mit Strecke, „Schnellste Rennrunde“ und „Fahrer des Tages“, darunter die Tabelle mit Pos,
farbiger Startnummer, Name, kursivem farbigem Team, Grid, Time und Gap, Zeilen durch Linien getrennt, eine Zeile mit
„DNF“ statt Platz, Platz 1 im farbigen Kasten mit Platzhalter statt Abstand, Zeiten mit Komma (#1981). Nur erfundene
Namen - das Repository ist öffentlich.

Die Schrift ist die, die Pillow selbst mitbringt (``ImageFont.load_default(size)``) - so entsteht auf jedem Rechner
dasselbe Bild. Fett heißt Kontur, kursiv eine Scherung. Umlaute kennt diese Schrift nicht, darum stehen keine in den
Namen.

    python backend/tests/result_image_fixture.py ZIEL.png [--blurry]
"""
from __future__ import annotations

import io
import sys
from dataclasses import dataclass, field

from PIL import Image, ImageDraw, ImageFilter, ImageFont

BACKGROUND = (21, 21, 30)
PANEL = (28, 28, 40)
LINE = (52, 52, 66)
LABEL = (150, 150, 165)
TEXT = (240, 240, 245)
TIME = (200, 200, 210)
PURPLE = (190, 120, 255)

# Erfundene Teams mit Farben wie in einer Rennliga.
TEAMS = {
    "Falke Motorsport": (0, 210, 190),
    "Rotor Racing": (230, 40, 50),
    "Blaupfeil GP": (60, 110, 255),
    "Kometen Team": (255, 135, 0),
    "Nordlicht F1": (100, 220, 90),
}


@dataclass
class Row:
    place: int | None  # ``None`` = DNF
    number: str
    name: str
    team: str
    grid: int
    time: str = ""
    gap: str = ""


@dataclass
class Sheet:
    track: str
    fastest_name: str
    fastest_time: str
    driver_of_the_day: str
    rows: list[Row] = field(default_factory=list)


def sample_sheet() -> Sheet:
    """Zwölf Fahrer, ein Überrundeter, ein Ausfall - alles erfunden. Die Zeiten stehen wie gespeichert (Punkt vor den
    Tausendsteln); im Bild schreibt die Liga sie mit Komma (``league_time``, #1981). Der Sieger hat keinen Abstand - im
    Bild steht dort ein Platzhalter."""
    rows = [
        Row(1, "44", "Lena Lenkrad", "Falke Motorsport", 2, "1:32:15.123"),
        Row(2, "7", "Otto Ostwind", "Rotor Racing", 1, "1:32:17.456", "+2.333"),
        Row(3, "16", "Mia Motorhaube", "Blaupfeil GP", 4, "1:32:21.900", "+6.777"),
        Row(4, "3", "Karl Kupplung", "Kometen Team", 3, "1:32:30.004", "+14.881"),
        Row(5, "88", "Pia Pitstop", "Nordlicht F1", 6, "1:32:41.250", "+26.127"),
        Row(6, "21", "Jonas Jagdmann", "Falke Motorsport", 5, "1:32:55.718", "+40.595"),
        Row(7, "5", "Ida Innenspur", "Rotor Racing", 8, "1:33:02.031", "+46.908"),
        Row(8, "11", "Felix Fahrwerk", "Blaupfeil GP", 7, "1:33:10.642", "+55.519"),
        Row(9, "27", "Rosa Rennlinie", "Kometen Team", 10, "1:33:18.300", "+1:03.177"),
        Row(10, "63", "Ben Bremspunkt", "Nordlicht F1", 9, "1:33:25.987", "+1:10.864"),
        Row(11, "9", "Uwe Untersteuern", "Falke Motorsport", 12, "1:33:20.004", "+1 Runde"),
        Row(None, "31", "Tara Traktion", "Rotor Racing", 11, "DNF"),
    ]
    return Sheet(track="Probering Nord", fastest_name="Mia Motorhaube", fastest_time="1:31.207",
                 driver_of_the_day="Otto Ostwind", rows=rows)


def quali_sheet() -> Sheet:
    """Ein Qualifying wie im echten Fehlerfall (#1981): Pos | Nr. + Name | Team | Time | Gap, Rundenzeiten „m:ss,mmm“,
    ohne Startplatz und ohne Punkte. Erfundene Namen."""
    times = ["1:31.770", "1:32.134", "1:32.754", "1:32.856", "1:34.358", "1:34.423", "1:34.491", "1:34.639",
             "1:37.421", "1:45.232"]
    names = ["Lena Lenkrad", "Otto Ostwind", "Mia Motorhaube", "Karl Kupplung", "Pia Pitstop", "Jonas Jagdmann",
             "Ida Innenspur", "Felix Fahrwerk", "Rosa Rennlinie", "Ben Bremspunkt"]
    numbers = ["8", "7", "98", "50", "26", "18", "24", "73", "67", "9"]
    teams = list(TEAMS)
    leader = 91.770
    rows = []
    for index, (time, name, number) in enumerate(zip(times, names, numbers)):
        minutes, seconds = time.split(":")
        gap = f"+{int(minutes) * 60 + float(seconds) - leader:.3f}" if index else ""
        rows.append(Row(index + 1, number, name, teams[index % len(teams)], 0, time, gap))
    return Sheet(track="Probering Nord", fastest_name="", fastest_time="", driver_of_the_day="", rows=rows)


def league_time(text: str) -> str:
    """So schreibt die Liga Zeiten: Komma vor den Tausendsteln („1:32:15,123“, „+2,333“)."""
    head, dot, tail = text.rpartition(".")
    return f"{head},{tail}" if dot and tail.isdigit() else text


def _font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.load_default(size=size)


def _text(draw: ImageDraw.ImageDraw, xy, text: str, *, size: int, fill, bold: bool = False, anchor: str = "lm"):
    draw.text(xy, text, font=_font(size), fill=fill, anchor=anchor, stroke_width=1 if bold else 0,
              stroke_fill=fill if bold else None)


def _italic(canvas: Image.Image, xy, text: str, *, size: int, fill) -> None:
    """Kursiv: Text auf eigener Ebene zeichnen und nach rechts scheren."""
    font = _font(size)
    left, top, right, bottom = font.getbbox(text)
    pad = size
    layer = Image.new("RGBA", (right - left + 2 * pad, bottom - top + 2 * pad), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((pad - left, pad - top), text, font=font, fill=fill)
    shear = 0.21
    sheared = layer.transform(layer.size, Image.Transform.AFFINE, (1, shear, -shear * layer.height / 2, 0, 1, 0),
                              resample=Image.Resampling.BICUBIC)
    x, y = xy
    canvas.alpha_composite(sheared, (int(x - pad), int(y - (bottom - top) / 2 - pad)))


# Spalten: Mitte bzw. linker Rand in Pixeln bei 1280 px Breite.
COLUMNS = {"pos": 70, "number": 140, "name": 200, "team": 520, "grid": 830, "time": 1010, "gap": 1210}
WINNER_BOX = (255, 230, 0)  # Platz 1 steht im farbigen Kasten, die Ziffer dunkel (#1981)
WINNER_DIGIT = (20, 20, 20)
NO_GAP = "+--:--,---"  # Platzhalter beim Sieger


def render(sheet: Sheet | None = None, *, width: int = 1280, winner_box: bool = True,
           border: bool = True, grid: bool = True) -> Image.Image:
    """Das Bild der Liste. ``winner_box``: Platz 1 im farbigen Kasten (wie in der Liga); ``border``: senkrechte Linien
    am Rand der Tabelle - die Erkennung liest sie gern als „|“; ``grid``: Spalte Startplatz (im Qualifying ohne)."""
    sheet = sheet or sample_sheet()
    head, row_h, top = 190, 46, 245
    height = top + row_h * len(sheet.rows) + 40
    img = Image.new("RGBA", (width, height), BACKGROUND + (255,))
    draw = ImageDraw.Draw(img)
    draw.rectangle((30, 20, width - 30, head - 10), fill=PANEL + (255,))
    _text(draw, (60, 60), sheet.track, size=34, fill=TEXT, bold=True)
    if sheet.fastest_name:
        _text(draw, (60, 112), "Schnellste Rennrunde:", size=20, fill=LABEL)
        _text(draw, (290, 112), sheet.fastest_name, size=20, fill=TEXT, bold=True)
        _text(draw, (520, 112), league_time(sheet.fastest_time), size=20, fill=PURPLE, bold=True)
    if sheet.driver_of_the_day:
        _text(draw, (60, 148), "Fahrer des Tages:", size=20, fill=LABEL)
        _text(draw, (290, 148), sheet.driver_of_the_day, size=20, fill=TEXT, bold=True)

    header_y = head + 30
    for key, label in (("pos", "Pos"), ("number", "Nr."), ("name", "Name"), ("team", "Team"), ("grid", "Grid"),
                       ("time", "Time"), ("gap", "Gap")):
        if key == "grid" and not grid:
            continue
        anchor = "mm" if key in ("pos", "number", "grid") else "rm" if key in ("time", "gap") else "lm"
        _text(draw, (COLUMNS[key], header_y), label.upper(), size=16, fill=LABEL, anchor=anchor)
    draw.line((30, top - 4, width - 30, top - 4), fill=LINE, width=2)

    if border:
        bottom = top + row_h * len(sheet.rows)
        for x in (30, width - 30):
            draw.line((x, top - 4, x, bottom), fill=LINE, width=2)
    for index, row in enumerate(sheet.rows):
        y = top + index * row_h + row_h // 2
        color = TEAMS.get(row.team, TEXT)
        if winner_box and row.place == 1:
            draw.rectangle((COLUMNS["pos"] - 18, y - 18, COLUMNS["pos"] + 18, y + 18), fill=WINNER_BOX)
            _text(draw, (COLUMNS["pos"], y), "1", size=22, fill=WINNER_DIGIT, bold=True, anchor="mm")
        else:
            _text(draw, (COLUMNS["pos"], y), str(row.place) if row.place else "DNF", size=22, fill=TEXT, bold=True,
                  anchor="mm")
        _text(draw, (COLUMNS["number"], y), row.number, size=22, fill=color, bold=True, anchor="mm")
        _text(draw, (COLUMNS["name"], y), row.name, size=22, fill=TEXT)
        _italic(img, (COLUMNS["team"], y), row.team, size=21, fill=color + (255,))
        if grid:
            _text(draw, (COLUMNS["grid"], y), str(row.grid), size=22, fill=TEXT, anchor="mm")
        if row.time:
            _text(draw, (COLUMNS["time"], y), league_time(row.time), size=22, fill=TIME, anchor="rm")
        gap = league_time(row.gap) if row.gap else NO_GAP if row.place == 1 else ""
        if gap:
            _text(draw, (COLUMNS["gap"], y), gap, size=22, fill=TIME, anchor="rm")
        line_y = top + (index + 1) * row_h
        draw.line((30, line_y, width - 30, line_y), fill=LINE, width=1)
    return img.convert("RGB")


def blurry(img: Image.Image, *, factor: float = 0.55, radius: float = 0.9, quality: int = 45) -> Image.Image:
    """Leicht unscharf: kleiner gerechnet, wieder vergrößert, weichgezeichnet und als JPEG gespeichert."""
    small = img.resize((int(img.width * factor), int(img.height * factor)), Image.Resampling.BILINEAR)
    soft = small.resize(img.size, Image.Resampling.BILINEAR).filter(ImageFilter.GaussianBlur(radius))
    out = io.BytesIO()
    soft.save(out, format="JPEG", quality=quality)
    return Image.open(io.BytesIO(out.getvalue())).convert("RGB")


def png_bytes(img: Image.Image) -> bytes:
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def jpeg_bytes(img: Image.Image, quality: int = 85) -> bytes:
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=quality)
    return out.getvalue()


def sheet_json(sheet: Sheet | None = None) -> str:
    """Das Blatt als JSON - für die Abnahme im Browser, die dieselben Teilnehmer anlegt."""
    import json
    from dataclasses import asdict

    return json.dumps(asdict(sheet or sample_sheet()), ensure_ascii=False)


if __name__ == "__main__":  # pragma: no cover - Hilfe zum Erzeugen von Beispielbildern (auch für die Abnahme)
    # python result_image_fixture.py ZIEL.png [--blurry] [--json BLATT.json]
    picture = render()
    if "--blurry" in sys.argv:
        picture = blurry(picture)
    picture.save(sys.argv[1])
    if "--json" in sys.argv:
        with open(sys.argv[sys.argv.index("--json") + 1], "w", encoding="utf-8") as target:
            target.write(sheet_json())
