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
import unicodedata
import warnings
from dataclasses import dataclass, field
from functools import lru_cache

from PIL import Image, ImageChops, ImageOps, UnidentifiedImageError

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


# Einstellbar über die Umgebung (Standard in Klammern): Zeitlimit je Aufruf von Tesseract, Sprachen.
TIMEOUT_SECONDS = _env_number("RESULT_IMAGE_OCR_TIMEOUT_SECONDS", 20, 1)
LANGUAGES = os.environ.get("RESULT_IMAGE_OCR_LANGUAGES", "eng+deu")
TARGET_TEXT_HEIGHT = 40  # Pixel - so liest Tesseract Bildschirmschrift am sichersten
MAX_SCALE = 4.0
MAX_WORK_SIDE = 6000
MIN_SIDE = 40

WHITELISTS = {
    "place": "0123456789DNFSQ",
    "number": "0123456789",
    "time": "0123456789:.,DNFSQ",
    "gap": "0123456789:.,+-RundeLapsDNFSQ",
}


class OcrUnavailable(Exception):
    """Tesseract fehlt oder antwortet nicht - die Meldung an die Oberfläche ist fest."""


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
    except (UnidentifiedImageError, OSError, ValueError):
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
    except (OSError, ValueError, Image.DecompressionBombError):
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


def prepare(img: Image.Image, template: dict) -> Prepared:
    red, green, blue = img.convert("RGB").split()
    value = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    background = template.get("background") or "auto"
    dark = background == "dark" or (background == "auto" and _median_level(value) < 128)
    if dark:
        value = ImageOps.invert(value)
    heights = sorted(bottom - top for top, bottom in text_bands(value))
    text_height = float(statistics.median(heights)) if heights else 20.0
    scale = max(1.0, min(MAX_SCALE, TARGET_TEXT_HEIGHT / max(text_height, 1.0)))
    scale = min(scale, MAX_WORK_SIDE / max(value.size))
    if abs(scale - 1.0) > 0.05:
        value = value.resize((round(value.width * scale), round(value.height * scale)), Image.Resampling.LANCZOS)
    else:
        scale = 1.0
    return Prepared(image=ImageOps.autocontrast(value, cutoff=0.5), scale=scale, text_height=text_height, dark=dark)


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


def tesseract(img: Image.Image, *, psm: int, whitelist: str | None = None) -> list[Word]:
    """Ein Aufruf: Bild über stdin, Wörter (TSV) über stdout."""
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
        done = subprocess.run(args, input=buffer.getvalue(), capture_output=True, timeout=TIMEOUT_SECONDS,
                              env=_environment(), check=False)
    except subprocess.TimeoutExpired:
        logger.warning("[result-image] tesseract timed out after %ss", TIMEOUT_SECONDS)
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


@dataclass
class Reading:
    template_id: str
    header: dict[str, Read] = field(default_factory=dict)  # track, fastest_lap, driver_of_the_day
    rows: list[RowReading] = field(default_factory=list)
    header_found: bool = False
    text_height: float = 0.0
    scale: float = 1.0
    mean_conf: float = 0.0


def _read(words: list[Word], *, joiner: str = " ") -> Read:
    ordered = sorted(words, key=lambda word: word.left)
    return Read(joiner.join(word.text for word in ordered).strip(), min((word.conf for word in ordered), default=0.0),
                [(word.text, word.conf) for word in ordered])


def _header_fields(lines: list[Line], template: dict) -> dict[str, Read]:
    """Kopf über der Tabelle: Zeilen, die mit einer Beschriftung der Vorlage beginnen, und die Strecke."""
    spec = template.get("header") or {}
    out: dict[str, Read] = {}
    unlabeled: list[Line] = []
    for line in lines:
        words = sorted(line.words, key=lambda word: word.left)
        matched = None
        for key, item in spec.items():
            for label in item.get("labels") or []:
                count = len(label.split())
                if len(words) < count:
                    continue
                head = _norm(" ".join(word.text for word in words[:count]))
                if head and _similar(head, _norm(label)) >= 0.75:
                    matched = (key, words[count:])
                    break
            if matched:
                break
        if matched and matched[1] and matched[0] not in out:
            out[matched[0]] = _read(matched[1])
        elif not matched:
            unlabeled.append(line)
    if "track" in spec and "track" not in out and unlabeled:
        out["track"] = _read(unlabeled[0].words)
    return out


def _similar(left: str, right: str) -> float:
    from difflib import SequenceMatcher

    return SequenceMatcher(None, left, right).ratio() if left and right else 0.0


def _strip_reads(prepared: Prepared, column: dict, cells: list[Cell | None], data_lines: list[Line],
                 neighbours: tuple[float | None, float | None]) -> dict[int, Read]:
    """Eine Spalte als Streifen lesen - Zahlenspalten mit Whitelist. Liefert je Datenzeile (Index) die Lesung."""
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
    words = tesseract(strip, psm=6, whitelist=WHITELISTS.get(column["kind"]))
    by_line: dict[int, list[Word]] = {}
    for word in words:
        center = word.cy + box[1]
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


def read(img: Image.Image, template: dict) -> Reading:
    """Das Bild nach der Vorlage lesen - ohne Abgleich mit Teilnehmern (``result_image_match``)."""
    prepared = prepare(img, template)
    columns = template["columns"]
    lines = lines_of(tesseract(prepared.image, psm=6))
    reading = Reading(template_id=template["id"], text_height=prepared.text_height, scale=prepared.scale)
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
    anchors = column_anchors(columns, labels, data_lines)
    reading.header = _header_fields(above, template)

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
        cells = [row.get(index) for row in assigned]
        before = [row[index - 1].right for row in assigned if index > 0 and row.get(index - 1)]
        after = [row[index + 1].left for row in assigned if index + 1 < len(columns) and row.get(index + 1)]
        reads = _strip_reads(prepared, column, cells, data_lines,
                             (max(before) if before else None, min(after) if after else None))
        for row_index, value in reads.items():
            reading.rows[row_index].strips[column["field"]] = value
    return reading
