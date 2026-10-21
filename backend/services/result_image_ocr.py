"""Ergebnis-Bilder auslesen (#1756) - Texterkennung mit Tesseract auf dem eigenen Server, ohne externen Dienst.

Ablauf (``read``):

1. **Prüfen** (``open_image``): erst nur der Kopf der Datei - Format PNG, JPG oder WebP, Pixelzahl -, dann dekodieren.
   Meldungen sind feste Texte (``Opened.message``), nie aus einer Ausnahme gebaut.
   Die Grenzen kommen aus ``services/image_upload.py`` (``MAX_BYTES``, ``MAX_IMAGE_PIXELS``); größere Bilder werden
   für die Erkennung auf ``MAX_IMAGE_DIMENSION`` verkleinert. Das Bild bleibt im Speicher - gespeichert wird nichts.
2. **Vorbereiten** (``prepare``): je Pixel der hellste Farbkanal (farbige Schrift bleibt kräftig), bei dunklem
   Hintergrund umgekehrt, und so vergrößert, dass die Schrift etwa ``TARGET_TEXT_HEIGHT`` Pixel hoch ist. Tesseract
   bekommt nur dieses neu kodierte Graustufenbild, nie die hochgeladene Datei.
3. **Lesen**: einmal die ganze Seite (Zeilen und Wörter mit Lage und Sicherheit), dann jede Spalte als eigener
   Streifen - Zahlenspalten mit Zeichen-Whitelist (Ziffern für Platz, Startnummer und Grid; dazu Doppelpunkt und Punkt
   für Zeiten). Jede Zelle hat so zwei Lesungen; was sie daraus macht, entscheidet ``result_image_match``.
4. **Zuordnen**: die Kopfzeile der Tabelle (Überschriften der Vorlage) gibt die Lage der Spalten, die Zeilen darüber
   den Kopf (Strecke, schnellste Rennrunde, Fahrer des Tages), die darunter die Ergebniszeilen. Fehlt die Kopfzeile,
   gelten die Anteile ``at`` der Vorlage über der Breite der Tabelle.

**Ohne Netz:** Tesseract läuft als eigener Prozess ohne Shell, mit festen Argumenten, leerer Umgebung (kein Proxy),
einem Thread und Zeitlimit. Das Bild kommt über stdin, das Ergebnis über stdout - es entsteht keine Datei, und die
einzige Eingabe ist ``stdin`` (nie eine Adresse).
"""
from __future__ import annotations

import io
import logging
import os
import shutil
import statistics
import subprocess
import time
import unicodedata
import warnings
from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import lru_cache

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

from services import result_image_values as image_values
from services.image_upload import (
    MAX_BYTES, MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS, MAX_IMAGE_UPLOAD_MB, PIL_IMAGE_FORMATS,
)

logger = logging.getLogger("tls-arena.result-image")


def _env_number(name: str, default: float, minimum: float) -> float:
    try:
        value = float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return value if value >= minimum else default


# Einstellbar über die Umgebung (Standard in Klammern): Zeitlimit je Aufruf von Tesseract, Zeitbudget je Bild
# (alle Aufrufe zusammen - danach bleibt der Rest ungeprüft und gelb), Sprachen.
TIMEOUT_SECONDS = _env_number("RESULT_IMAGE_OCR_TIMEOUT_SECONDS", 20, 1)
BUDGET_SECONDS = _env_number("RESULT_IMAGE_OCR_BUDGET_SECONDS", 60, 5)
LANGUAGES = os.environ.get("RESULT_IMAGE_OCR_LANGUAGES", "eng+deu")
TARGET_TEXT_HEIGHT = 40  # Pixel - so liest Tesseract Bildschirmschrift am sichersten
MAX_SCALE = 4.0
MAX_WORK_SIDE = 6000
PROBE_WIDTH = 1600  # Breite der schnellen Lesung, aus der die Schrifthöhe kommt
# Seitenlesungen (Tesseract „psm“): ein Block (6) und eine Spalte mit Zeilen verschiedener Größe (4) - es gilt die mit
# mehr Ergebniszeilen (``_page_lines``).
PAGE_PSMS = (6, 4)
MIN_SIDE = 40

# Dritte Lesung der Ziffern-Spalten (#1981): größer und mit eigener Schwelle (Otsu) - 3 und 5 kippen dann anders.
ALT_SCALE = 1.5
ALT_KINDS = ("place", "number", "time", "gap")
BOX_HEIGHT = 64  # Pixel: so hoch wird eine einzelne Platz-Zelle (etwa Platz 1 im farbigen Kasten) gelesen

WHITELISTS = {
    "place": "0123456789DNFSQOUT",
    "number": "0123456789",
    "time": "0123456789:.,DNFSQ",
    "gap": "0123456789:.,+-RundeLapsDNFSQ",
}


class OcrUnavailable(Exception):
    """Tesseract fehlt oder antwortet nicht - die Meldung an die Oberfläche ist fest."""


class OutOfTime(Exception):
    """Das Zeitbudget für dieses Bild ist aufgebraucht, bevor die Seite gelesen war."""


# Ende des Zeitbudgets des Bilds, das gerade gelesen wird (``read`` setzt es; je Thread bzw. Aufruf getrennt).
_DEADLINE: ContextVar[float | None] = ContextVar("result_image_deadline", default=None)
MIN_CALL_SECONDS = 0.5  # weniger Restzeit lohnt keinen Aufruf mehr


def _clock() -> float:
    return time.monotonic()


TOO_LARGE = f"Das Bild ist zu groß (höchstens {MAX_IMAGE_UPLOAD_MB} MB)."
EMPTY = "Die Datei ist leer."
NOT_AN_IMAGE = "Das ist kein lesbares Bild. Bitte PNG, JPG oder WebP."
WRONG_FORMAT = "Nur PNG, JPG oder WebP."
TOO_MANY_PIXELS = "Das Bild hat zu viele Pixel."
TOO_SMALL = "Das Bild ist zu klein zum Lesen."
BROKEN = "Das Bild lässt sich nicht öffnen. Bitte als PNG oder JPG neu speichern."


@dataclass
class Opened:
    """Ergebnis von ``open_image``: das Bild (gedreht nach EXIF, RGB) und sein Format - oder ``status`` (400/413) mit
    einer festen Meldung."""
    image: Image.Image | None = None
    status: int = 200
    message: str = ""
    format: str = ""  # PNG, JPEG oder WEBP


# ---------------------------------------------------------------- Bild prüfen
def open_image(data: bytes) -> Opened:
    """Erst den Kopf prüfen (Format, Pixelzahl), dann dekodieren. Liefert ein RGB-Bild, höchstens
    ``MAX_IMAGE_DIMENSION`` Pixel lang - oder warum nicht."""
    if not data:
        return Opened(status=400, message=EMPTY)
    if len(data) > MAX_BYTES:
        return Opened(status=413, message=TOO_LARGE)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)  # die Grenze prüft die Zeile darunter
            img = Image.open(io.BytesIO(data))  # liest nur den Kopf
    except Image.DecompressionBombError:
        return Opened(status=413, message=TOO_MANY_PIXELS)
    except Exception as exc:  # noqa: BLE001 - jeder Fehler am Kopf (Pillow wirft auch SyntaxError) ist „kein Bild“
        logger.info("[result-image] header not readable: %s", type(exc).__name__)
        return Opened(status=400, message=NOT_AN_IMAGE)
    detected = (img.format or "").upper()
    if detected not in PIL_IMAGE_FORMATS:
        return Opened(status=400, message=WRONG_FORMAT)
    width, height = img.size
    if width * height > MAX_IMAGE_PIXELS:
        return Opened(status=413, message=TOO_MANY_PIXELS)
    if min(width, height) < MIN_SIDE:
        return Opened(status=400, message=TOO_SMALL)
    try:
        img.load()
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")
    except Exception as exc:  # noqa: BLE001 - wie image_upload: jeder Dekodierfehler (auch SyntaxError) ist 400
        logger.info("[result-image] image not decodable: %s", type(exc).__name__)
        return Opened(status=400, message=BROKEN)
    if max(img.size) > MAX_IMAGE_DIMENSION:
        img.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)
    return Opened(image=img, format=detected)


def encode_original(opened: Opened) -> tuple[bytes, str]:
    """Das geöffnete Bild neu kodiert - gedreht nach EXIF, ohne EXIF und andere Metadaten, im Format der Vorlage (JPEG
    bleibt JPEG, sonst PNG bzw. WebP), höchstens ``MAX_IMAGE_DIMENSION`` lang. Liefert ``(Bytes, Medientyp)``, ohne Bild
    ``(b"", "")``. Gespeichert wird hier nichts - das Original am Termin kommt mit #1933."""
    if opened.image is None:
        return b"", ""
    fmt = opened.format if opened.format in ("JPEG", "WEBP") else "PNG"
    options = {"JPEG": {"quality": 88, "optimize": True}, "WEBP": {"quality": 88, "method": 6},
               "PNG": {"optimize": True}}[fmt]
    buffer = io.BytesIO()
    opened.image.save(buffer, format=fmt, **options)
    return buffer.getvalue(), PIL_IMAGE_FORMATS[fmt][0]


# ---------------------------------------------------------------- Vorbereiten
def _otsu(histogram: list[int]) -> int:
    total = sum(histogram)
    if not total:
        return 128
    weighted_total = sum(index * count for index, count in enumerate(histogram))
    background = weighted = 0
    best, threshold = -1.0, 128
    for index, count in enumerate(histogram):
        background += count
        if not background:
            continue
        foreground = total - background
        if not foreground:
            break
        weighted += index * count
        mean_b = weighted / background
        mean_f = (weighted_total - weighted) / foreground
        between = background * foreground * (mean_b - mean_f) ** 2
        if between > best:
            best, threshold = between, index
    return threshold


def _median_level(gray: Image.Image) -> int:
    histogram = gray.histogram()
    half, seen = sum(histogram) / 2, 0
    for level, count in enumerate(histogram):
        seen += count
        if seen >= half:
            return level
    return 255


def text_bands(gray: Image.Image) -> list[tuple[int, int]]:
    """Zeilen mit Schrift (oben, unten) in einem Bild mit dunkler Schrift auf hellem Grund. Durchgehende Linien
    (Trennlinien der Tabelle) zählen nicht als Schrift."""
    threshold = _otsu(gray.histogram())
    ink = gray.point(lambda level: 255 if level <= threshold else 0)
    profile = ink.resize((1, ink.height), Image.Resampling.BOX).tobytes()
    bands, start = [], None
    for y, level in enumerate(profile):
        inked = 1 < level < 150  # mehr als etwa 60 % Tinte: eine Linie, keine Schrift
        if inked and start is None:
            start = y
        elif not inked and start is not None:
            bands.append((start, y))
            start = None
    if start is not None:
        bands.append((start, len(profile)))
    return [band for band in bands if band[1] - band[0] >= 4]


@dataclass
class Prepared:
    image: Image.Image  # Graustufen, dunkle Schrift auf hellem Grund, vergrößert
    scale: float
    text_height: float  # Höhe der Schrift im Original (Pixel)
    dark: bool


def remove_lines(gray: Image.Image) -> Image.Image:
    """Lange waagrechte und senkrechte Linien (Rahmen, Trennlinien der Zeilen) übermalen - an ihnen scheitert die
    Zeilensuche von Tesseract. Linie ist, was mehr als 60 % der Breite bzw. Höhe deckt."""
    threshold = _otsu(gray.histogram())
    ink = gray.point(lambda level: 255 if level <= threshold else 0)
    rows = ink.resize((1, ink.height), Image.Resampling.BOX).tobytes()
    cols = ink.resize((ink.width, 1), Image.Resampling.BOX).tobytes()
    out = gray.copy()
    draw = ImageDraw.Draw(out)
    for y, level in enumerate(rows):
        if level > 153:
            draw.line((0, y, out.width, y), fill=255)
    for x, level in enumerate(cols):
        if level > 153:
            draw.line((x, 0, x, out.height), fill=255)
    return out


def invert_boxes(gray: Image.Image, text_height: float) -> Image.Image:
    """Gefüllte dunkle Flächen (etwa das Feld des Siegers mit dunkler Ziffer auf hellem Grund) umkehren, damit auch dort
    dunkle Schrift auf hellem Grund steht. Fläche ist, was über gut eine Schrifthöhe fast nur dunkel ist - fette Schrift
    nicht."""
    radius = max(2, int(text_height * 1.2))
    local = gray.filter(ImageFilter.BoxBlur(radius))
    mask = local.point(lambda level: 255 if level < 70 else 0)
    if not mask.getbbox():
        return gray
    return Image.composite(ImageOps.invert(gray), gray, mask)


def _probe_height(value: Image.Image) -> float | None:
    """Schrifthöhe im Original aus einer schnellen Lesung: der Median der Wörter mit hoher Sicherheit. Gefüllte Felder
    und Zeilen-Hintergründe täuschen die reine Pixelzählung (``text_bands``), Wörter nicht."""
    probe_scale = max(1.0, min(3.0, PROBE_WIDTH / max(value.width, 1)))
    probe = value
    if probe_scale > 1.05:
        probe = value.resize((round(value.width * probe_scale), round(value.height * probe_scale)),
                             Image.Resampling.LANCZOS)
    words = _ocr(remove_lines(probe), psm=11)
    heights = sorted(word.height for word in words
                     if word.conf >= 70 and sum(char.isalnum() for char in word.text) >= 2)
    if len(heights) < 5:
        return None
    return float(statistics.median(heights)) / probe_scale


def prepare(img: Image.Image, template: dict) -> Prepared:
    red, green, blue = img.convert("RGB").split()
    value = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    background = template.get("background") or "auto"
    dark = background == "dark" or (background == "auto" and _median_level(value) < 128)
    if dark:
        value = ImageOps.invert(value)
    text_height = _probe_height(value)
    if text_height is None:
        heights = sorted(bottom - top for top, bottom in text_bands(value))
        text_height = float(statistics.median(heights)) if heights else 20.0
    scale = max(1.0, min(MAX_SCALE, TARGET_TEXT_HEIGHT / max(text_height, 1.0)))
    scale = min(scale, MAX_WORK_SIDE / max(value.size))
    if abs(scale - 1.0) > 0.05:
        value = value.resize((round(value.width * scale), round(value.height * scale)), Image.Resampling.LANCZOS)
    else:
        scale = 1.0
    value = ImageOps.autocontrast(value, cutoff=0.5)
    value = remove_lines(invert_boxes(value, text_height * scale))
    return Prepared(image=value, scale=scale, text_height=text_height, dark=dark)


# ---------------------------------------------------------------- Tesseract
@dataclass
class Word:
    text: str
    conf: float
    left: int
    top: int
    width: int
    height: int
    line: tuple = ()

    @property
    def right(self) -> int:
        return self.left + self.width

    @property
    def bottom(self) -> int:
        return self.top + self.height

    @property
    def cy(self) -> float:
        return self.top + self.height / 2


def command() -> str | None:
    return shutil.which("tesseract")


def _environment() -> dict:
    env = {"OMP_THREAD_LIMIT": "1", "LC_ALL": "C", "PATH": os.defpath}
    if os.environ.get("TESSDATA_PREFIX"):
        env["TESSDATA_PREFIX"] = os.environ["TESSDATA_PREFIX"]
    return env


@lru_cache(maxsize=1)
def languages() -> str:
    """Die gewünschten Sprachen, soweit installiert (``RESULT_IMAGE_OCR_LANGUAGES``, sonst Englisch)."""
    cmd = command()
    if not cmd:
        return "eng"
    try:
        listed = subprocess.run([cmd, "--list-langs"], capture_output=True, timeout=TIMEOUT_SECONDS,
                                env=_environment(), check=False)
    except (OSError, subprocess.SubprocessError):
        return "eng"
    have = {line.strip() for line in listed.stdout.decode("utf-8", "replace").splitlines()[1:]}
    wanted = [lang for lang in LANGUAGES.split("+") if lang in have]
    return "+".join(wanted) or ("eng" if "eng" in have else "")


def available() -> bool:
    return bool(command()) and bool(languages())


def tesseract(img: Image.Image, *, psm: int, whitelist: str | None = None,
              timeout: float | None = None) -> list[Word]:
    """Ein Aufruf: Bild über stdin, Wörter (TSV) über stdout. ``timeout`` (Sekunden) höchstens ``TIMEOUT_SECONDS``."""
    limit = min(TIMEOUT_SECONDS, timeout) if timeout else TIMEOUT_SECONDS
    cmd = command()
    if not cmd:
        raise OcrUnavailable()
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    args = [cmd, "stdin", "stdout", "-l", languages(), "--oem", "1", "--psm", str(psm), "-c", "user_defined_dpi=300"]
    if whitelist:
        args += ["-c", f"tessedit_char_whitelist={whitelist}"]
    args.append("tsv")
    try:
        done = subprocess.run(args, input=buffer.getvalue(), capture_output=True, timeout=limit,
                              env=_environment(), check=False)
    except subprocess.TimeoutExpired:
        logger.warning("[result-image] tesseract timed out after %ss", round(limit, 1))
        raise OcrUnavailable() from None
    except OSError:
        logger.warning("[result-image] tesseract could not be started")
        raise OcrUnavailable() from None
    if done.returncode != 0:
        logger.warning("[result-image] tesseract exited with %s", done.returncode)
        raise OcrUnavailable()
    words = []
    for line in done.stdout.decode("utf-8", "replace").splitlines()[1:]:
        parts = line.split("\t")
        if len(parts) != 12 or parts[0] != "5":
            continue
        text = parts[11].strip()
        try:
            conf = float(parts[10])
            left, top, width, height = (int(parts[index]) for index in (6, 7, 8, 9))
        except ValueError:
            continue
        if text and conf >= 0:
            words.append(Word(text, conf, left, top, width, height, (parts[2], parts[3], parts[4])))
    return words


def _ocr(img: Image.Image, *, psm: int, whitelist: str | None = None) -> list[Word]:
    """Tesseract im Zeitbudget des Bilds: ein Aufruf darf höchstens die Restzeit dauern; ist sie aufgebraucht, kommt
    ``OutOfTime`` statt eines Aufrufs."""
    deadline = _DEADLINE.get()
    if deadline is None:
        return tesseract(img, psm=psm, whitelist=whitelist)
    left = deadline - _clock()
    if left < MIN_CALL_SECONDS:
        raise OutOfTime()
    try:
        return tesseract(img, psm=psm, whitelist=whitelist, timeout=left)
    except OcrUnavailable:
        if deadline - _clock() < MIN_CALL_SECONDS:
            raise OutOfTime() from None  # nicht Tesseract fehlt - das Budget war zu Ende
        raise


# ---------------------------------------------------------------- Zeilen, Zellen, Spalten
@dataclass
class Line:
    words: list[Word]

    @property
    def top(self) -> int:
        return min(word.top for word in self.words)

    @property
    def bottom(self) -> int:
        return max(word.bottom for word in self.words)

    @property
    def height(self) -> float:
        return float(statistics.median(word.height for word in self.words))

    @property
    def text(self) -> str:
        return " ".join(word.text for word in sorted(self.words, key=lambda word: word.left))


def lines_of(words: list[Word]) -> list[Line]:
    """Wörter zu Zeilen: Tesseracts Zeilen, dazu zusammengelegt, was sich in der Höhe überwiegend überschneidet."""
    grouped: dict[tuple, list[Word]] = {}
    for word in words:
        grouped.setdefault(word.line, []).append(word)
    lines = sorted((Line(items) for items in grouped.values()), key=lambda line: line.top)
    merged: list[Line] = []
    for line in lines:
        if merged:
            last = merged[-1]
            overlap = min(last.bottom, line.bottom) - max(last.top, line.top)
            if overlap > 0.5 * min(last.bottom - last.top, line.bottom - line.top):
                last.words.extend(line.words)
                continue
        merged.append(line)
    return merged


@dataclass
class Cell:
    words: list[Word]

    @property
    def left(self) -> int:
        return min(word.left for word in self.words)

    @property
    def right(self) -> int:
        return max(word.right for word in self.words)

    @property
    def center(self) -> float:
        return (self.left + self.right) / 2

    def anchor(self, align: str) -> float:
        return self.left if align == "left" else self.right if align == "right" else self.center


def cells_of(line: Line) -> list[Cell]:
    """Wörter einer Zeile zu Zellen: eine Lücke von mehr als einer Schrifthöhe trennt."""
    words = sorted(line.words, key=lambda word: word.left)
    cells: list[Cell] = []
    for word in words:
        if cells and word.left - cells[-1].right <= line.height:
            cells[-1].words.append(word)
        else:
            cells.append(Cell([word]))
    return cells


def _norm(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text).casefold()
    return "".join(char for char in folded if char.isalnum() or char == "#")


def header_line(lines: list[Line], columns: list[dict]) -> tuple[int, dict[int, Cell]] | None:
    """Die Kopfzeile der Tabelle: die Zeile, in der die meisten Überschriften der Vorlage stehen (mindestens zwei).
    Liefert ihren Index und je erkannter Spalte (Index in ``columns``) die Zelle der Überschrift."""
    best = None
    for index, line in enumerate(lines):
        found: dict[int, Cell] = {}
        for cell in cells_of(line):
            for word in cell.words:
                key = _norm(word.text)
                for col_index, column in enumerate(columns):
                    if col_index in found:
                        continue
                    if key and key in {_norm(label) for label in column.get("labels") or []}:
                        found[col_index] = Cell([word])
                        break
        if len(found) >= 2 and (best is None or len(found) > len(best[1])):
            best = (index, found)
    return best


def _fit(points: list[tuple[float, float]]) -> tuple[float, float] | None:
    """Gerade px = a + b * at durch die Punkte (at, px) - mindestens zwei verschiedene ``at``."""
    if len(points) < 2:
        return None
    mean_at = statistics.fmean(at for at, _ in points)
    mean_px = statistics.fmean(px for _, px in points)
    spread = sum((at - mean_at) ** 2 for at, _ in points)
    if spread <= 1e-9:
        return None
    slope = sum((at - mean_at) * (px - mean_px) for at, px in points) / spread
    return mean_px - slope * mean_at, slope


def column_anchors(columns: list[dict], labels: dict[int, Cell] | None, data_lines: list[Line]) -> list[float]:
    """Anker je Spalte in Pixeln: aus den gelesenen Überschriften; was fehlt, über die Anteile ``at`` der Vorlage -
    entlang der Überschriften oder, ohne sie, über der Breite der Datenzeilen."""
    known = {index: cell.anchor(columns[index]["align"]) for index, cell in (labels or {}).items()}
    fit = _fit([(columns[index]["at"], px) for index, px in known.items()])
    if fit is None and data_lines:
        cells = [cells_of(line) for line in data_lines]
        first = statistics.median(row[0].anchor(columns[0]["align"]) for row in cells if row)
        last = statistics.median(row[-1].anchor(columns[-1]["align"]) for row in cells if row)
        fit = _fit([(columns[0]["at"], first), (columns[-1]["at"], last)])
    if fit is None:
        return [float(known.get(index, 0)) for index in range(len(columns))]
    base, slope = fit
    return [float(known[index]) if index in known else base + slope * column["at"]
            for index, column in enumerate(columns)]


def _fits(kind: str, text: str) -> bool:
    """Passt der Inhalt einer Zelle zur Art der Spalte? Nur grob - entschieden wird in ``result_image_match``."""
    key = "".join(text.split())
    if not key:
        return False
    if kind in ("place", "number"):
        digits = image_values.digits_of(key)
        return bool(digits) or (kind == "place" and bool(image_values.mark_of(key)))
    if kind == "text":
        return sum(char.isalpha() for char in key) >= 2 and not image_values.is_placeholder(key)
    if kind == "time":
        lapped = image_values.parse_gap(key)
        return bool(image_values.parse_time(key, fix=True) or image_values.mark_of(key)
                    or image_values.is_placeholder(key) or (lapped and lapped[1] is None))
    if kind == "gap":
        return bool(image_values.parse_gap(key, fix=True) or image_values.is_placeholder(key))
    return False


def column_groups(rows: list[list[Cell]], tolerance: float, min_share: float = 0.2) -> list[tuple[int, int]]:
    """Spalten aus den Daten: x-Bereiche, die in mindestens ``min_share`` der Zeilen von einer Zelle bedeckt sind.
    Lücken bis ``tolerance`` werden überbrückt."""
    if not rows:
        return []
    width = max(cell.right for row in rows for cell in row) + 1
    coverage = [0] * (width + 1)
    for row in rows:
        for cell in row:
            for x in range(max(0, cell.left), min(width, cell.right)):
                coverage[x] += 1
    need = max(1, round(len(rows) * min_share))
    groups: list[list[int]] = []
    for x, count in enumerate(coverage):
        if count < need:
            continue
        if groups and x - groups[-1][1] <= tolerance:
            groups[-1][1] = x + 1
        else:
            groups.append([x, x + 1])
    return [(left, right) for left, right in groups]


def plan_columns(data_lines: list[Line], columns: list[dict], labels: dict[int, Cell] | None,
                 height: float) -> list[dict[int, Cell]] | None:
    """Zellen den Spalten zuordnen - aus den Daten statt aus festen Lagen: erst die Spalten des Bilds suchen (wo in
    vielen Zeilen Zellen stehen), dann sie in ihrer Reihenfolge den Spalten der Vorlage zuordnen, je nachdem, was in
    ihnen steht (Platz, Zahlen, Text, Zeiten, Abstände). Eine Überschrift darüber zählt mit. Fehlt eine Spalte im Bild
    (etwa Grid im Qualifying), bleibt sie leer. ``None``, wenn das nicht aufgeht (dann gelten die Anker der Vorlage)."""
    rows = [cells_of(line) for line in data_lines]
    groups = column_groups(rows, tolerance=height * 0.5)
    if len(groups) < 3:
        return None
    members: list[list[tuple[int, Cell]]] = [[] for _ in groups]
    for row_index, cells in enumerate(rows):
        for cell in cells:
            overlaps = [min(cell.right, right) - max(cell.left, left) for left, right in groups]
            best = max(range(len(groups)), key=lambda index: overlaps[index])
            if overlaps[best] <= 0:
                best = min(range(len(groups)), key=lambda index: abs((groups[index][0] + groups[index][1]) / 2
                                                                     - cell.center))
            members[best].append((row_index, cell))
    score = [[0.0] * len(columns) for _ in groups]
    for group_index, items in enumerate(members):
        left, right = groups[group_index]
        for col_index, column in enumerate(columns):
            share = (sum(1 for _, cell in items if _fits(column["kind"], " ".join(w.text for w in cell.words)))
                     / max(1, len(items)))
            label = (labels or {}).get(col_index)
            near = label is not None and label.left <= right + height and label.right >= left - height
            score[group_index][col_index] = share + (0.25 if near else 0.0)
    # Reihenfolge bleibt: Gruppe i vor Gruppe j heißt Spalte von i vor Spalte von j. Jede Gruppe höchstens einer Spalte.
    groups_n, columns_n = len(groups), len(columns)
    best = [[0.0] * (columns_n + 1) for _ in range(groups_n + 1)]
    choice: dict[tuple[int, int], tuple[int, int, int | None]] = {}
    for g in range(1, groups_n + 1):
        for c in range(0, columns_n + 1):
            options = [(best[g - 1][c], (g - 1, c, None))]
            if c > 0:
                options.append((best[g][c - 1], (g, c - 1, None)))
                value = score[g - 1][c - 1]
                if value >= 0.5:
                    options.append((best[g - 1][c - 1] + value, (g - 1, c - 1, c - 1)))
            best[g][c], choice[(g, c)] = max(options, key=lambda item: item[0])
    mapping: dict[int, int] = {}
    g, c = groups_n, columns_n
    while g > 0 and (g, c) in choice:
        prev_g, prev_c, assigned = choice[(g, c)]
        if assigned is not None:
            mapping[g - 1] = assigned
        g, c = prev_g, prev_c
    fields = {columns[index]["field"] for index in mapping.values()}
    if "name" not in fields or len(mapping) < 3:
        return None
    out: list[dict[int, Cell]] = [{} for _ in rows]
    for group_index, items in enumerate(members):
        col_index = mapping.get(group_index)
        if col_index is None:
            continue
        for row_index, cell in items:
            found = out[row_index].get(col_index)
            out[row_index][col_index] = Cell(found.words + cell.words) if found else cell
    return out


def assign(cells: list[Cell], columns: list[dict], anchors: list[float]) -> dict[int, Cell]:
    """Zellen einer Zeile den Spalten zuordnen: je Zelle die Spalte mit dem nächsten Anker (in deren Ausrichtung),
    in der Reihenfolge von links nach rechts. Landen zwei Zellen in derselben Spalte, werden sie verbunden."""
    out: dict[int, Cell] = {}
    floor = 0
    for cell in cells:
        choices = range(floor, len(columns))
        if not choices:
            choices = range(len(columns) - 1, len(columns))
        best = min(choices, key=lambda index: abs(cell.anchor(columns[index]["align"]) - anchors[index]))
        floor = best
        if best in out:
            out[best] = Cell(out[best].words + cell.words)
        else:
            out[best] = cell
    return out


# ---------------------------------------------------------------- Lesen
@dataclass
class Read:
    """Eine Lesung einer Zelle: Text, Sicherheit (0-100, das unsicherste Wort) und die Wörter mit ihrer Sicherheit."""
    text: str
    conf: float
    parts: list[tuple[str, float]] = field(default_factory=list)


@dataclass
class RowReading:
    cells: dict[str, Read] = field(default_factory=dict)  # Seite
    strips: dict[str, Read] = field(default_factory=dict)  # Streifen (Zahlen mit Whitelist)
    alts: dict[str, Read] = field(default_factory=dict)  # dritte Lesung der Ziffern, anders vorbereitet (#1981)
    color: str | None = None  # Schriftfarbe von Startnummer bzw. Team als „#rrggbb“ (Vorschlag für die Teamfarbe)


@dataclass
class Reading:
    template_id: str
    header: dict[str, Read] = field(default_factory=dict)  # track, fastest_lap, driver_of_the_day
    rows: list[RowReading] = field(default_factory=list)
    header_found: bool = False
    text_height: float = 0.0
    scale: float = 1.0
    mean_conf: float = 0.0
    too_many_rows: bool = False  # mehr Ergebniszeilen als ``max_rows`` - dann ohne Zeilen und ohne Kopf
    out_of_time: bool = False  # Zeitbudget aufgebraucht - nicht alles zweimal gelesen
    unchecked: set[str] = field(default_factory=set)  # Felder ohne zweite Lesung (Streifen) - sie werden gelb
    labelled: set[str] | None = None  # Spalten, deren Überschrift im Bild steht (``None``: nicht bekannt)


def _read(words: list[Word], *, joiner: str = " ") -> Read:
    ordered = sorted(words, key=lambda word: word.left)
    return Read(joiner.join(word.text for word in ordered).strip(), min((word.conf for word in ordered), default=0.0),
                [(word.text, word.conf) for word in ordered])


def _label_spans(words: list[Word], spec: dict) -> list[tuple[str, int, int]]:
    """Beschriftungen der Vorlage in einer Zeile (Wörter nach x): (Schlüssel, erstes Wort, Wort nach der Beschriftung).
    Längere Beschriftungen zuerst; leicht verlesen geht (Ähnlichkeit ab 0,75)."""
    labels = sorted(((key, label) for key, item in spec.items() for label in item.get("labels") or []),
                    key=lambda item: -len(item[1].split()))
    found, index = [], 0
    while index < len(words):
        hit = None
        for key, label in labels:
            count = len(label.split())
            if index + count > len(words):
                continue
            head = _norm(" ".join(word.text for word in words[index:index + count]))
            if head and _similar(head, _norm(label)) >= 0.75:
                hit = (key, index, index + count)
                break
        if hit:
            found.append(hit)
            index = hit[2]
        else:
            index += 1
    return found


def _read_lines(groups: list[list[Word]]) -> Read:
    """Eine Lesung aus mehreren Zeilen (etwa Name, darunter die Zeit) - Zeile für Zeile, je Zeile von links."""
    words = [word for group in groups for word in sorted(group, key=lambda item: item.left)]
    return Read(" ".join(word.text for word in words).strip(), min((word.conf for word in words), default=0.0),
                [(word.text, word.conf) for word in words])


def _header_fields(lines: list[Line], template: dict) -> dict[str, Read]:
    """Kopf über der Tabelle. Eine Beschriftung der Vorlage („Schnellste Rennrunde:“, „Pole:“, „Fahrer des Tages:“)
    hat ihren Wert dahinter in derselben Zeile - oder, wenn dort nichts steht, darunter in bis zu zwei Zeilen im selben
    Bereich (Name, darunter die Zeit; mehrere Beschriftungen nebeneinander). Die Art der Sitzung („Qualifying“,
    „Rennen“, ``session``) ist ein Wort für sich; die Strecke ist die oberste Zeile ohne Beschriftung, ohne die Art."""
    spec = {key: item for key, item in (template.get("header") or {}).items() if key not in ("track", "session")}
    out: dict[str, Read] = {}
    used: set[int] = set()
    rows = [sorted(line.words, key=lambda word: word.left) for line in lines]
    spans = [_label_spans(words, spec) for words in rows]
    for line_index, words in enumerate(rows):
        if not spans[line_index]:
            continue
        used.add(line_index)
        height = lines[line_index].height
        for number, (key, start, end) in enumerate(spans[line_index]):
            following = spans[line_index][number + 1] if number + 1 < len(spans[line_index]) else None
            same = words[end:following[1] if following else len(words)]
            groups = [same] if same else []
            if not same:
                left = words[start].left - height
                right = words[following[1]].left - height * 0.5 if following else float("inf")
                for below in (line_index + 1, line_index + 2):
                    if below >= len(rows) or spans[below]:
                        break
                    picked = [word for word in rows[below] if left <= word.left < right
                              and any(char.isalnum() for char in word.text)]  # keine Reste von Linien
                    if picked:
                        groups.append(picked)
                        used.add(below)
            if groups and key not in out:
                out[key] = _read_lines(groups)
    sessions = {_norm(word) for word in ((template.get("header") or {}).get("session") or {}).get("labels") or []}
    for line_index, words in enumerate(rows):
        hit = next((word for word in words if line_index not in used and _norm(word.text) in sessions), None)
        if hit and "session" not in out:
            out["session"] = _read([hit])
    if "track" in (template.get("header") or {}) and "track" not in out:
        for line_index, words in enumerate(rows):
            if line_index in used:
                continue
            clean = [word for word in words if word.conf >= 50 and sum(char.isalpha() for char in word.text) >= 3
                     and _norm(word.text) not in sessions]
            if clean:
                out["track"] = _read(clean)
                break
    return out


def _similar(left: str, right: str) -> float:
    from difflib import SequenceMatcher

    return SequenceMatcher(None, left, right).ratio() if left and right else 0.0


def _strip_reads(prepared: Prepared, column: dict, cells: list[Cell | None], data_lines: list[Line],
                 neighbours: tuple[float | None, float | None], *, alternate: bool = False) -> dict[int, Read]:
    """Eine Spalte als Streifen lesen - Zahlenspalten mit Whitelist. Liefert je Datenzeile (Index) die Lesung.
    ``alternate``: der Streifen größer (``ALT_SCALE``) und schwarz-weiß nach eigener Schwelle - eine unabhängigere
    dritte Lesung für Ziffern."""
    present = [cell for cell in cells if cell is not None]
    if not present or not data_lines:
        return {}
    height = statistics.median(line.height for line in data_lines)
    left = min(cell.left for cell in present) - height * 0.6
    right = max(cell.right for cell in present) + height * 0.6
    low, high = neighbours
    if low is not None:
        left = max(left, low)
    if high is not None:
        right = min(right, high)
    top = max(0, int(data_lines[0].top - height * 0.6))
    bottom = min(prepared.image.height, int(data_lines[-1].bottom + height * 0.6))
    box = (max(0, int(left)), top, min(prepared.image.width, int(right)), bottom)
    if box[2] - box[0] < 4 or box[3] - box[1] < 4:
        return {}
    strip = prepared.image.crop(box)
    factor = 1.0
    if alternate:
        factor = ALT_SCALE
        strip = strip.resize((round(strip.width * factor), round(strip.height * factor)), Image.Resampling.LANCZOS)
        level = _otsu(strip.histogram())
        strip = strip.point(lambda value: 255 if value > level else 0)
    words = _ocr(strip, psm=6, whitelist=WHITELISTS.get(column["kind"]))
    by_line: dict[int, list[Word]] = {}
    for word in words:
        center = word.cy / factor + box[1]
        best = min(range(len(data_lines)), key=lambda index: abs(
            (data_lines[index].top + data_lines[index].bottom) / 2 - center))
        line = data_lines[best]
        if line.top - height * 0.6 <= center <= line.bottom + height * 0.6:
            by_line.setdefault(best, []).append(word)
    joiner = " " if column["kind"] in ("text", "gap") else ""
    return {index: _read(items, joiner=joiner) for index, items in by_line.items()}


def _is_result_line(line: Line, min_cells: int) -> bool:
    """Eine Ergebniszeile hat mehrere Zellen und mindestens eine Ziffer (Platz, Startnummer, Grid oder Zeit) - eine
    Fußzeile oder unlesbare Überschriften haben keine."""
    return len(cells_of(line)) >= min_cells and any(char.isdigit() for char in line.text)


def read(img: Image.Image, template: dict, *, max_rows: int | None = None,
         budget_seconds: float | None = None) -> Reading:
    """Das Bild nach der Vorlage lesen - ohne Abgleich mit Teilnehmern (``result_image_match``). Stehen mehr als
    ``max_rows`` Ergebniszeilen im Bild, bricht es vor dem Lesen der Spalten ab (``too_many_rows``).

    Alle Aufrufe von Tesseract zusammen haben ein Zeitbudget (``BUDGET_SECONDS``). Reicht es nicht für die Seite, kommt
    ``OutOfTime``; reicht es nur nicht für die zweiten Lesungen, stehen die Spalten ohne in ``unchecked`` (gelb)."""
    token = _DEADLINE.set(_clock() + (budget_seconds or BUDGET_SECONDS))
    try:
        return _read_in_budget(img, template, max_rows)
    finally:
        _DEADLINE.reset(token)


def _read_in_budget(img: Image.Image, template: dict, max_rows: int | None) -> Reading:
    prepared = prepare(img, template)
    columns = template["columns"]
    lines, timed_out = _page_lines(prepared)
    reading = Reading(template_id=template["id"], text_height=prepared.text_height, scale=prepared.scale,
                      out_of_time=timed_out)
    found = header_line(lines, columns)
    if found:
        header_index, labels = found
        reading.header_found = True
        above, below = lines[:header_index], lines[header_index + 1:]
    else:
        labels = None
        # Ohne Kopfzeile: die Tabelle beginnt bei der ersten Ergebniszeile (mindestens drei Zellen, eine Ziffer).
        start = next((index for index, line in enumerate(lines) if _is_result_line(line, 3)), len(lines))
        above, below = lines[:start], lines[start:]
    data_lines = [line for line in below if _is_result_line(line, 2)]
    if max_rows is not None and len(data_lines) > max_rows:
        reading.too_many_rows = True
        return reading
    reading.header = _header_fields(above, template)
    reading.labelled = {columns[index]["field"] for index in (labels or {})}
    height = statistics.median(line.height for line in data_lines) if data_lines else TARGET_TEXT_HEIGHT
    assigned = plan_columns(data_lines, columns, labels, height)
    if assigned is None:
        anchors = column_anchors(columns, labels, data_lines)
        assigned = [assign(cells_of(line), columns, anchors) for line in data_lines]
    confidences = []
    for row in assigned:
        reading.rows.append(RowReading(cells={
            columns[index]["field"]: _read(cell.words, joiner="" if columns[index]["kind"] in (
                "number", "time", "place") else " ")
            for index, cell in row.items()}))
        confidences.extend(word.conf for cell in row.values() for word in cell.words)
    reading.mean_conf = statistics.fmean(confidences) if confidences else 0.0

    # Zweite Lesung je Spalte als Streifen; die Grenzen zu den Nachbarspalten sind deren gelesene Zellen.
    for index, column in enumerate(columns):
        if reading.out_of_time:
            reading.unchecked.add(column["field"])
            continue
        cells = [row.get(index) for row in assigned]
        before = [row[index - 1].right for row in assigned if index > 0 and row.get(index - 1)]
        after = [row[index + 1].left for row in assigned if index + 1 < len(columns) and row.get(index + 1)]
        try:
            reads = _strip_reads(prepared, column, cells, data_lines,
                                 (max(before) if before else None, min(after) if after else None))
        except OutOfTime:
            reading.out_of_time = True
            reading.unchecked.add(column["field"])
            continue
        for row_index, value in reads.items():
            reading.rows[row_index].strips[column["field"]] = value
        if column["kind"] not in ALT_KINDS:
            continue
        try:
            alternates = _strip_reads(prepared, column, cells, data_lines,
                                      (max(before) if before else None, min(after) if after else None),
                                      alternate=True)
        except OutOfTime:
            # Ohne dritte Lesung ist diese Ziffern-Spalte nicht vollständig gegengelesen - gelb wie die übrigen.
            reading.out_of_time = True
            reading.unchecked.add(column["field"])
            continue
        for row_index, value in alternates.items():
            reading.rows[row_index].alts[column["field"]] = value
    if not reading.out_of_time:
        try:
            _retry_places(prepared, columns, assigned, data_lines, reading, img)
        except OutOfTime:
            reading.out_of_time = True  # nicht gelesene Plätze bleiben gelb
    fields = [column["field"] for column in columns]
    for row, cells in zip(reading.rows, assigned):
        for wanted in ("start_number", "team"):
            if wanted in fields and cells.get(fields.index(wanted)):
                row.color = text_color(img, cells[fields.index(wanted)], prepared.scale)
                if row.color:
                    break
    return reading


def text_color(img: Image.Image, cell: Cell, scale: float) -> str | None:
    """Schriftfarbe einer Zelle im Originalbild als „#rrggbb“: der Median der Pixel, die sich deutlich vom Grund
    abheben. Grund ist der Rand um die Zelle (zwei Pixel Abstand). Für Teamfarben: Startnummer und Team stehen in der
    Farbe des Teams."""
    pad = 2
    box = (max(0, int(cell.left / scale) - pad), max(0, int(min(word.top for word in cell.words) / scale) - pad),
           min(img.width, int(cell.right / scale) + 1 + pad),
           min(img.height, int(max(word.bottom for word in cell.words) / scale) + 1 + pad))
    if box[2] - box[0] < 2 + 2 * pad or box[3] - box[1] < 2 + 2 * pad:
        return None
    region = img.convert("RGB").crop(box)
    width, height = region.size
    raw = region.tobytes()
    pixels = [tuple(raw[index:index + 3]) for index in range(0, len(raw), 3)]
    values = [max(pixel) for pixel in pixels]
    border = [values[y * width + x] for y in range(height) for x in range(width)
              if x in (0, width - 1) or y in (0, height - 1)]
    background = sorted(border)[len(border) // 2]
    ink = sorted(((abs(value - background), pixel) for pixel, value in zip(pixels, values)
                  if abs(value - background) > 60), key=lambda item: -item[0])
    if len(ink) < 4:
        return None
    core = [pixel for _, pixel in ink[: max(4, len(ink) // 2)]]  # Kern der Schrift, ohne geglättete Ränder
    channels = [sorted(pixel[index] for pixel in core)[len(core) // 2] for index in range(3)]
    return "#{:02x}{:02x}{:02x}".format(*channels)


def _page_lines(prepared: Prepared) -> tuple[list[Line], bool]:
    """Die ganze Seite lesen - als ein Block (6) und als Spalte mit Zeilen verschiedener Größe (4). Es gilt die Lesung
    mit den meisten Ergebniszeilen: „ein Block“ ist bei schlichten Tabellen genauer, verliert aber bei Bildern mit
    großem Kopf, Flaggen und Feldern ganze Zeilen. Bei Gleichstand gilt der Block. Liefert dazu, ob das Zeitbudget
    nur noch für die erste Lesung reichte."""
    best: tuple[int, list[Line]] | None = None
    for psm in PAGE_PSMS:
        try:
            lines = lines_of(_ocr(prepared.image, psm=psm))
        except OutOfTime:
            if best is None:
                raise
            return best[1], True  # die zweite Lesung der Seite passte nicht mehr ins Budget
        count = sum(1 for line in lines if _is_result_line(line, 2))
        if best is None or count > best[0]:
            best = (count, lines)
    return (best[1] if best else []), False


def _place_parses(text: str) -> bool:
    if image_values.mark_of(text):
        return True
    digits = image_values.read_digits(text, fix=True)
    return bool(digits) and 0 < int(digits) <= 999


def _box_read(img: Image.Image, center: tuple[float, float], height: float, scale: float,
              binary: bool) -> list[Word]:
    """Eine Platz-Zelle allein aus dem Originalbild - für Platz 1 im farbigen Kasten (#1981): nur das Innere um die
    Mitte (ohne Rand des Kastens), hellster Farbkanal, Kontrast gestreckt bzw. schwarz-weiß, groß und mit Rand, als
    ein einzelnes Zeichen gelesen."""
    center_x, center_y = center
    half_width, half_height = height * 0.45, height * 0.55
    box = (max(0, int((center_x - half_width) / scale)), max(0, int((center_y - half_height) / scale)),
           min(img.width, int((center_x + half_width) / scale)), min(img.height, int((center_y + half_height) / scale)))
    if box[2] - box[0] < 4 or box[3] - box[1] < 4:
        return []
    red, green, blue = img.convert("RGB").crop(box).split()
    cell = ImageOps.autocontrast(ImageChops.lighter(ImageChops.lighter(red, green), blue), cutoff=1)
    if binary:
        level = _otsu(cell.histogram())
        cell = cell.point(lambda value: 255 if value > level else 0)
    pixels = cell.tobytes()
    if sum(1 for value in pixels if value > 127) * 2 < len(pixels):
        cell = ImageOps.invert(cell)  # die Schrift soll dunkel auf hellem Grund stehen
    factor = BOX_HEIGHT / max(cell.height, 1)
    cell = cell.resize((max(1, round(cell.width * factor)), BOX_HEIGHT), Image.Resampling.LANCZOS)
    canvas = Image.new("L", (cell.width + 40, cell.height + 40), 255)
    canvas.paste(cell, (20, 20))
    return _ocr(canvas, psm=10, whitelist=WHITELISTS["place"])


def _retry_places(prepared: Prepared, columns: list[dict], assigned: list[dict[int, Cell]], data_lines: list[Line],
                  reading: Reading, img: Image.Image | None = None) -> None:
    """Zweiter Versuch für Plätze ohne brauchbare Lesung. Erst die Zelle allein im Originalbild (``_box_read``: Platz 1
    im farbigen Kasten, #1981), dann die Zelle im vorbereiteten Bild als Zeile mit Whitelist (etwa ein blasses „DNF“
    auf dunklem Feld). Es gilt der erste Versuch, der einen Platz oder Ausfall ergibt."""
    index = next((i for i, column in enumerate(columns) if column["field"] == "place"), None)
    if index is None or not data_lines:
        return
    found = [row[index] for row in assigned if row.get(index)]
    if not found:
        return
    height = statistics.median(line.height for line in data_lines)
    left = max(0, int(min(cell.left for cell in found) - height * 0.8))
    right = min(prepared.image.width, int(max(cell.right for cell in found) + height * 0.8))
    center_x = statistics.median((cell.left + cell.right) / 2 for cell in found)
    for row_index, row in enumerate(reading.rows):
        if any(read and _place_parses(read.text) for read in (row.cells.get("place"), row.strips.get("place"))):
            continue
        line = data_lines[row_index]
        top = max(0, int(line.top - height * 0.4))
        bottom = min(prepared.image.height, int(line.bottom + height * 0.4))
        if right - left < 4 or bottom - top < 4:
            continue
        attempts = []
        if img is not None:
            center = (assigned[row_index][index].center if assigned[row_index].get(index) else center_x,
                      (line.top + line.bottom) / 2)
            attempts += [lambda binary=binary: _box_read(img, center, height, prepared.scale, binary)
                         for binary in (False, True)]
        attempts.append(lambda: _ocr(ImageOps.autocontrast(prepared.image.crop((left, top, right, bottom)), cutoff=1),
                                     psm=7, whitelist=WHITELISTS["place"]))
        for attempt in attempts:
            words = attempt()
            if words and _place_parses("".join(word.text for word in words)):
                row.strips["place"] = _read(words, joiner="")
                break
