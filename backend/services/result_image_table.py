"""Saison- und Teamtabelle per Bild (#1999) - die Gesamttabelle des Veranstalters (etwa die PRL: Pos · Team bzw.
Fahrer · eine Spalte je Rennen mit Flagge · Punkte · Dif.) mit derselben Texterkennung wie Ergebnis-Bilder (#1756)
lesen, ohne Datenbank. Laden, Grenzen und Abgleich mit der Saison machen die Routen
(``routes/reference_result_image_routes.py``).

Anders als ein Ergebnis hat eine Tabelle keine Zeiten - darum gilt hier ``NOT_A_RESULT`` nicht. Die Zahl der
Rundenspalten ist offen; ihre Köpfe sind oft Flaggen (Bilder, keine Schrift), deshalb heißen sie nach der Reihenfolge
(„Runde 1“ …) - die Vorschau ordnet sie den Terminen zu und lässt korrigieren.

- **Spalten** (``_classify``): aus den Daten (``result_image_ocr.column_groups``: x-Bereiche, die in vielen Zeilen
  bedeckt sind); die Überschriften (``Pos.``, ``Team``/``Fahrer``, ``Punkte``, ``Dif.``) geben die Art. Ohne
  Überschrift: Text ist der Name, die erste Zahlenspalte davor der Platz, eine Spalte mit negativen Zahlen der
  Abstand, die letzte übrige Zahlenspalte „Gesamt“, dazwischen die Runden.
- **Zellen** (``_cell``): je Zelle die Seitenlesung, ein Streifen mit Ziffern-Whitelist und eine dritte, anders
  vorbereitete Lesung. Zahl oder „--“ (nicht angetreten). Gelb, wenn sich die Lesungen widersprechen, die Sicherheit
  zu niedrig ist oder nichts gelesen wurde - nie still falsch.
- **Gegenproben:** „Dif.“ = Punkte - Punkte des Ersten bestätigt beide oder macht beide gelb; die Summe der Runden =
  Punkte bestätigt die ganze Zeile. Passt sie nicht (Strafe, Teamwertung mit eigener Rechnung - oder eine verlesene
  Zelle), steht das als Hinweis an der Zeile; die Vorschau der Saisontabelle gleicht jede Summe mit „Gesamt“ ab, eine
  verlesene Zelle fällt dort als Abweichung auf. Plätze laufen mit den Punkten.
- **Namen** (``_names``): wie bei Ergebnis-Bildern unscharf gegen die bekannten Namen (Teilnehmer der Saison bzw. ihre
  Teams); unter ``name_sure`` gelb.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field

from services import result_image_ocr as ocr
from services.result_image_match import clean_text, similarity
from services.result_image_values import DIGIT_FIX, compact, is_noise

TEMPLATE: dict = {
    "id": "saisontabelle",
    "name": "Saison- bzw. Teamtabelle",
    "background": "auto",
    "labels": {
        "rank": ["Pos", "Pos.", "Platz", "Pl", "Pl.", "Rang", "#"],
        "name": ["Fahrer", "Name", "Driver", "Spieler", "Player"],
        "team": ["Team", "Teams", "Rennstall", "Constructor"],
        "total": ["Punkte", "Punkte:", "Gesamt", "Pkt", "Pkt.", "Points", "Pts", "Total", "Summe"],
        "gap": ["Dif", "Dif.", "Diff", "Diff.", "Differenz", "Abstand", "Gap", "Rückstand"],
    },
    "min_confidence": 80,
    "name_match": 0.72,
    "name_sure": 0.9,
}
NUMBER_KINDS = ("rank", "round", "total", "gap")
AGREEMENT_BONUS = 20
MAX_VALUE = 99999
# „--“ in der Tabelle - die Erkennung liest zwei kurze Striche oft als „=“ oder „~“.
ABSENT_CHARS = frozenset("-–—‒−_=~")


@dataclass
class TableCell:
    text: str = ""  # angezeigter Wert: Zahl, „--“ oder Text
    value: int | None = None
    absent: bool = False  # „--“ bzw. nicht angetreten
    sure: bool = True
    read: str = ""  # gelesen, wenn es vom Wert abweicht
    options: list = field(default_factory=list)


@dataclass
class TableReading:
    kinds: list[str] = field(default_factory=list)  # je Spalte: rank, name, team, round, total, gap
    labels: list[str] = field(default_factory=list)
    rows: list[list[TableCell]] = field(default_factory=list)
    notes: list[list[str]] = field(default_factory=list)  # je Zeile Hinweise (etwa „Summe passt nicht“)
    header_found: bool = False
    detected: str | None = None  # „teams“ (Namensspalte heißt „Team“), „drivers“ („Fahrer“, „Name“) oder unbekannt
    out_of_time: bool = False
    too_many_rows: bool = False
    text_height: float = 0.0
    mean_conf: float = 0.0


# ---------------------------------------------------------------- Werte
def number_of(text: str, *, fix: bool) -> tuple[str, int | None] | None:
    """„35“, „-141“ → Zahl; „--“, „-“, „—“ → nicht angetreten; sonst ``None``."""
    key = compact(text).strip(".,:;'`´\"")
    if not key:
        return None
    if set(key) <= ABSENT_CHARS:
        return ("absent", None)
    sign = -1 if key[0] in ABSENT_CHARS and len(key) > 1 else 1
    body = key[1:] if sign < 0 else key
    if fix:
        if not any(char.isdigit() for char in body):
            return None
        body = body.translate(DIGIT_FIX)
    if not body.isdigit() or len(body) > 5 or int(body) > MAX_VALUE:
        return None
    return ("number", sign * int(body))


def _display(parsed) -> str:
    return "--" if parsed[0] == "absent" else str(parsed[1])


def _cell(reads: list[tuple[ocr.Read | None, bool]], min_conf: float) -> TableCell:
    """Ein Wert aus Seitenlesung, Streifen und dritter Lesung (je ``(Lesung, ist_Seite)``) - wie ``decide`` bei
    Ergebnis-Bildern: einig und sicher genug heißt grün, sonst gelb."""
    parsed = []
    seen_text = []
    for read, is_page in reads:
        if read is None or not read.text.strip() or is_noise(read.text) and not set(compact(read.text)) <= ABSENT_CHARS:
            continue
        seen_text.append(read.text)
        value = number_of(read.text, fix=is_page)
        if value is not None:
            parsed.append((read, value))
    if not parsed:
        # Nichts Brauchbares gelesen: leer heißt in einer Saisontabelle nicht angetreten - aber ungeprüft gelb.
        return TableCell(text="--" if not seen_text else "", absent=not seen_text, sure=False,
                         read=" / ".join(clean_text(text) for text in seen_text)[:40])
    values = {_display(item) for _, item in parsed}
    best_read, best = max(parsed, key=lambda item: item[0].conf)
    if len(values) == 1:
        agreed = len(parsed) > 1
        # „--“ entsteht nie aus einer Ziffer: liest keine Lesung eine Zahl, ist die Zelle sicher leer.
        sure = best[0] == "absent" or best_read.conf >= (min_conf - AGREEMENT_BONUS if agreed else min_conf)
        cell = TableCell(text=_display(best), value=best[1], absent=best[0] == "absent", sure=sure)
    else:
        # Widerspruch: der Streifen mit Whitelist gilt, außer er ist deutlich unsicherer - gelb.
        strips = [item for item in parsed if item[0] is not reads[0][0]]
        chosen = max(strips, key=lambda item: item[0].conf) if strips else (best_read, best)
        if chosen[0].conf < best_read.conf - 10:
            chosen = (best_read, best)
        cell = TableCell(text=_display(chosen[1]), value=chosen[1][1], absent=chosen[1][0] == "absent", sure=False,
                         read=" / ".join(sorted(values - {_display(chosen[1])})))
    cell.options = [item for _, item in parsed]
    return cell


# ---------------------------------------------------------------- Kopf und Spalten
def _norm(text: str) -> str:
    return ocr._norm(text)


def _header(lines: list[ocr.Line], template: dict) -> tuple[int, dict[str, ocr.Cell]] | None:
    """Die Kopfzeile: die Zeile mit den meisten Überschriften der Vorlage (mindestens zwei)."""
    wanted = {kind: {_norm(label) for label in labels} for kind, labels in template["labels"].items()}
    best = None
    for index, line in enumerate(lines):
        found: dict[str, ocr.Cell] = {}
        for word in sorted(line.words, key=lambda item: item.left):
            key = _norm(word.text)
            for kind, keys in wanted.items():
                if key and key in keys and kind not in found:
                    found[kind] = ocr.Cell([word])
                    break
        if len(found) >= 2 and (best is None or len(found) > len(best[1])):
            best = (index, found)
    return best


def _is_row(line: ocr.Line) -> bool:
    return len(ocr.cells_of(line)) >= 3 and any(char.isdigit() for char in line.text)


def _share(items: list[ocr.Cell], test) -> float:
    return sum(1 for cell in items if test(" ".join(word.text for word in cell.words))) / max(1, len(items))


def _is_text(text: str) -> bool:
    key = "".join(text.split())
    return sum(char.isalpha() for char in key) >= 2


def _is_number(text: str) -> bool:
    return number_of(text, fix=True) is not None


def _negative(text: str) -> bool:
    found = number_of(text, fix=True)
    return bool(found) and found[0] == "number" and found[1] < 0


def _near(label: ocr.Cell | None, group: tuple[int, int], height: float) -> bool:
    return label is not None and label.left <= group[1] + height and label.right >= group[0] - height


def _classify(groups: list[tuple[int, int]], members: list[list[ocr.Cell]], labels: dict[str, ocr.Cell],
              height: float) -> list[str | None]:
    """Art je Spalte des Bilds (siehe Modultext)."""
    kinds: list[str | None] = [None] * len(groups)

    def labelled(kind: str) -> int | None:
        label = labels.get(kind)
        if label is None:
            return None
        near = [index for index, group in enumerate(groups) if _near(label, group, height)]
        if not near:
            return None
        center = (label.left + label.right) / 2
        return min(near, key=lambda index: abs((groups[index][0] + groups[index][1]) / 2 - center))

    texts = [index for index, items in enumerate(members) if _share(items, _is_text) >= 0.5]
    numbers = [index for index, items in enumerate(members) if _share(items, _is_number) >= 0.6]
    name = labelled("name")
    team = labelled("team")
    if name is None and team is not None and team in texts and len(texts) == 1:
        name, team = team, None  # Teamtabelle: „Team“ ist die Namensspalte
    if name is None:
        name = next((index for index in texts if index != team), texts[0] if texts else None)
    if name is None:
        return kinds
    kinds[name] = "name"
    if team is not None and team != name and team in texts:
        kinds[team] = "team"
    rank = labelled("rank")
    if rank is None or rank >= name:
        rank = next((index for index in numbers if index < name), None)
    if rank is not None and rank < name:
        kinds[rank] = "rank"
    gap = labelled("gap")
    after = [index for index in numbers if index > name and kinds[index] is None]
    if gap is None and after and _share(members[after[-1]], _negative) >= 0.4:
        gap = after[-1]
    if gap is not None and gap > name:
        kinds[gap] = "gap"
    total = labelled("total")
    rest = [index for index in after if kinds[index] is None]
    if (total is None or total <= name or kinds[total]) and rest:
        total = rest[-1]
    if total is not None and total > name and kinds[total] is None:
        kinds[total] = "total"
    for index in rest:
        if kinds[index] is None and (total is None or index < total):
            kinds[index] = "round"
    return kinds


# ---------------------------------------------------------------- Lesen
def read_table(img, template: dict | None = None, *, max_rows: int | None = None,
               budget_seconds: float | None = None) -> TableReading:
    """Die Tabelle im Bild lesen - ohne Abgleich mit Namen (``match_names``). Wirft ``result_image_ocr.OutOfTime``,
    wenn das Zeitbudget nicht einmal für die Seite reicht, und ``OcrUnavailable`` ohne Tesseract."""
    template = template or TEMPLATE
    token = ocr._DEADLINE.set(ocr._clock() + (budget_seconds or ocr.BUDGET_SECONDS))
    try:
        return _read(img, template, max_rows)
    finally:
        ocr._DEADLINE.reset(token)


def _read(img, template: dict, max_rows: int | None) -> TableReading:
    prepared = ocr.prepare(img, template)
    lines, timed_out = ocr._page_lines(prepared)
    reading = TableReading(out_of_time=timed_out, text_height=prepared.text_height)
    found = _header(lines, template)
    labels: dict[str, ocr.Cell] = {}
    if found:
        index, labels = found
        reading.header_found = True
        lines = lines[index + 1:]
    data = [line for line in lines if _is_row(line)]
    if max_rows is not None and len(data) > max_rows:
        reading.too_many_rows = True
        return reading
    if not data:
        return reading
    height = statistics.median(line.height for line in data)
    rows = [ocr.cells_of(line) for line in data]
    groups = ocr.column_groups(rows, tolerance=height * 0.5)
    members: list[list[tuple[int, ocr.Cell]]] = [[] for _ in groups]
    for row_index, cells in enumerate(rows):
        for cell in cells:
            overlaps = [min(cell.right, right) - max(cell.left, left) for left, right in groups]
            best = max(range(len(groups)), key=lambda index: overlaps[index])
            members[best].append((row_index, cell))
    kinds = _classify(groups, [[cell for _, cell in items] for items in members], labels, height)
    if "name" in labels:
        reading.detected = "drivers"
    elif "team" in labels and "team" not in kinds:
        reading.detected = "teams"
    keep = [index for index, kind in enumerate(kinds) if kind]
    reading.kinds = [kinds[index] for index in keep]
    number = 0
    for index in keep:
        if kinds[index] == "round":
            number += 1
            reading.labels.append(f"Runde {number}")
        else:
            label = labels.get(kinds[index]) or (labels.get("team") if kinds[index] == "name" else None)
            reading.labels.append(clean_text(label.words[0].text) if label else {
                "rank": "Pos.", "name": "Name", "team": "Team", "total": "Punkte", "gap": "Dif."}[kinds[index]])
    by_cell: dict[tuple[int, int], ocr.Cell] = {}
    for column, index in enumerate(keep):
        for row_index, cell in members[index]:
            found_cell = by_cell.get((row_index, column))
            by_cell[(row_index, column)] = ocr.Cell(found_cell.words + cell.words) if found_cell else cell
    confidences = [word.conf for cell in by_cell.values() for word in cell.words]
    reading.mean_conf = statistics.fmean(confidences) if confidences else 0.0
    strips = _strips(prepared, reading, keep, groups, by_cell, data)
    min_conf = template["min_confidence"]
    for row_index in range(len(data)):
        row, notes = [], []
        for column, kind in enumerate(reading.kinds):
            cell = by_cell.get((row_index, column))
            page = ocr._read(cell.words, joiner="" if kind in NUMBER_KINDS else " ") if cell else None
            strip, alt = strips.get((row_index, column), (None, None))
            if kind in NUMBER_KINDS:
                row.append(_cell([(page, True), (strip, False), (alt, False)], min_conf))
            else:
                row.append(_text_cell(page, strip, min_conf))
        reading.rows.append(row)
        reading.notes.append(notes)
    _check(reading)
    return reading


def _strips(prepared, reading: TableReading, keep: list[int], groups, by_cell, data) -> dict:
    """Zweite und dritte Lesung je Spalte als Streifen - im Zeitbudget; was nicht mehr passt, bleibt gelb."""
    out: dict[tuple[int, int], tuple] = {}
    for column, kind in enumerate(reading.kinds):
        if reading.out_of_time:
            break
        spec = {"kind": "points" if kind in NUMBER_KINDS else "text"}
        cells = [by_cell.get((row_index, column)) for row_index in range(len(data))]
        index = keep[column]
        low = groups[index - 1][1] if index > 0 else None
        high = groups[index + 1][0] if index + 1 < len(groups) else None
        try:
            first = ocr._strip_reads(prepared, spec, cells, data, (low, high))
            second = (ocr._strip_reads(prepared, spec, cells, data, (low, high), alternate=True)
                      if kind in NUMBER_KINDS else {})
        except ocr.OutOfTime:
            reading.out_of_time = True
            break
        for row_index in range(len(data)):
            out[(row_index, column)] = (first.get(row_index), second.get(row_index))
    return out


def _text_cell(page: ocr.Read | None, strip: ocr.Read | None, min_conf: float) -> TableCell:
    reads = [read for read in (page, strip) if read and clean_text(read.text)]
    if not reads:
        return TableCell(sure=False)
    best = max(reads, key=lambda read: read.conf)
    texts = {" ".join(clean_text(read.text).split()) for read in reads}
    sure = len(reads) == 2 and len(texts) == 1 and all(read.conf >= min_conf for read in reads)
    other = " / ".join(sorted(texts - {" ".join(clean_text(best.text).split())}))
    return TableCell(text=" ".join(clean_text(best.text).split())[:120], sure=sure, read=other[:120])


# ---------------------------------------------------------------- Gegenproben
def _column(reading: TableReading, kind: str) -> int | None:
    return reading.kinds.index(kind) if kind in reading.kinds else None


def _check(reading: TableReading) -> None:
    """Gegenproben über die ganze Tabelle (siehe Modultext) - an Ort und Stelle."""
    total_at, gap_at, rank_at = _column(reading, "total"), _column(reading, "gap"), _column(reading, "rank")
    rounds = [index for index, kind in enumerate(reading.kinds) if kind == "round"]
    if total_at is not None and gap_at is not None and reading.rows:
        leader = next((row for row in reading.rows if row[gap_at].absent and row[total_at].value is not None), None)
        if leader is not None:
            top = leader[total_at].value
            for row in reading.rows:
                # Hinter dem Ersten ist jeder Abstand negativ - fehlt beim Lesen nur das Minus, gilt es mit Minus.
                gap = row[gap_at]
                if row is not leader and gap.value and gap.value > 0 and row[total_at].value is not None \
                        and row[total_at].value - top == -gap.value:
                    gap.read, gap.value, gap.text = gap.text, -gap.value, str(-gap.value)
            fits = [row for row in reading.rows if row is not leader and row[total_at].value is not None
                    and row[gap_at].value is not None and row[total_at].value - top == row[gap_at].value]
            for row in reading.rows:
                total, gap = row[total_at], row[gap_at]
                if row is leader:
                    # Die Punkte des Ersten stimmen, wenn mindestens die Hälfte der übrigen Zeilen dazu passt.
                    total.sure = len(fits) * 2 >= len(reading.rows) - 1
                    continue
                if row in fits:
                    total.sure = gap.sure = True
                elif total.value is not None or gap.value is not None:
                    total.sure = gap.sure = False
    if total_at is not None and rounds:
        for row, notes in zip(reading.rows, reading.notes):
            values = [row[index] for index in rounds]
            if any(cell.text == "" for cell in values) or row[total_at].value is None:
                continue
            summed = sum(cell.value or 0 for cell in values)
            if summed == row[total_at].value:
                for cell in values:
                    cell.sure = True
                row[total_at].sure = True
            else:
                # Strafe, eigene Teamrechnung - oder eine verlesene Zelle: welche, lässt sich nicht sagen, darum wird
                # jede Zelle mit Zahl gelb („--“ entsteht nie aus einer Ziffer). Nie still falsch.
                notes.append(f"Summe der Runden {summed} ≠ Punkte {row[total_at].value}")
                for cell in values:
                    if not cell.absent:
                        cell.sure = False
    if rank_at is not None:
        previous = None
        for position, row in enumerate(reading.rows, start=1):
            cell = row[rank_at]
            total = row[total_at].value if total_at is not None else None
            tied = previous is not None and total is not None and previous[1] == total
            expected = {position} | ({previous[0]} if tied and previous[0] else set())
            if cell.value in expected:
                cell.sure = True
            elif cell.value is None or not cell.sure:
                cell.text, cell.value, cell.sure = str(position), position, False
            previous = (cell.value, total)
        # Platz 1 im farbigen Kasten (wie #1981): laufen alle übrigen Plätze sicher 2 … n, ist die erste Zeile Platz 1.
        rest = reading.rows[1:]
        first = reading.rows[0][rank_at] if reading.rows else None
        if first is not None and rest and all(row[rank_at].sure and row[rank_at].value == position
                                              for position, row in enumerate(rest, start=2)):
            first.text, first.value, first.sure = "1", 1, True


# ---------------------------------------------------------------- Namen
def match_names(reading: TableReading, known: dict[str, str], template: dict | None = None) -> None:
    """Namen unscharf gegen ``known`` (Schreibweise → Name: Teilnehmer samt Aliase bzw. Teams der Saison): ab
    ``name_sure`` grün mit dem bekannten Namen, ab ``name_match`` der bekannte Name gelb, sonst wie gelesen. Jeder
    bekannte Name höchstens einmal."""
    template = template or TEMPLATE
    at = _column(reading, "name")
    if at is None or not known:
        return
    taken: set[str] = set()
    for row in reading.rows:
        cell = row[at]
        texts = [text for text in [cell.text, *cell.read.split(" / ")] if text]
        best: dict[str, float] = {}
        for spelling, name in known.items():
            if name in taken:
                continue
            score = max((similarity(text, spelling) for text in texts), default=0.0)
            best[name] = max(best.get(name, 0.0), score)
        scored = sorted(((score, name) for name, score in best.items()),
                        key=lambda item: (-item[0], item[1].casefold()))
        if not scored or scored[0][0] < template["name_match"]:
            continue
        score, name = scored[0]
        taken.add(name)
        if name != cell.text:
            cell.read = cell.text if not cell.read else f"{cell.text} / {cell.read}"
        cell.text = name
        cell.sure = score >= template["name_sure"] and (cell.sure or score >= 0.99)


def to_payload(reading: TableReading, *, kind: str) -> dict:
    """Die Antwort: Spalten (Überschrift, Art), Zeilen mit Zellen als Text, gelbe Zellen (Index) und was gelesen war."""
    rows = []
    for cells, notes in zip(reading.rows, reading.notes):
        rows.append({"cells": [cell.text for cell in cells],
                     "uncertain": [index for index, cell in enumerate(cells) if not cell.sure],
                     "read": {str(index): cell.read for index, cell in enumerate(cells) if cell.read},
                     "notes": notes})
    columns = [{"label": label, "kind": item} for label, item in zip(reading.labels, reading.kinds)]
    return {"kind": kind, "detected": reading.detected, "columns": columns, "rows": rows,
            "uncertain_cells": sum(len(row["uncertain"]) for row in rows)}
