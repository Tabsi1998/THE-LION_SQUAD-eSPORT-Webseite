"""Ergebnis-Bilder (#1756): aus den Lesungen (``result_image_ocr.Reading``) Werte machen, sie gegeneinander prüfen und
mit den Teilnehmern der Saison abgleichen - ohne Datenbank.

**Wert je Zelle** (``decide``): Jede Zelle hat bis zu zwei Lesungen (ganze Seite und Spalten-Streifen, Zahlen mit
Whitelist). Sicher ist eine Zelle, wenn beide dasselbe ergeben oder die einzige Lesung über ``min_confidence`` liegt.
Widersprechen sie sich, ist sie unsicher - außer eine Gegenprobe bestätigt den Wert:

- **Platz:** Die Plätze laufen ohne Lücke hoch; „DNF“, „DNS“, „DSQ“ stehen statt eines Platzes (``dnf``, ``marks``).
- **Zeit und Abstand:** Zeit = Zeit des Ersten + Abstand (auf eine Tausendstel); Zeiten steigen mit dem Platz.
- **Grid:** jede Startposition nur einmal.
- **Startnummer als Anker:** Gehören gelesene Startnummer und gelesener Name zum selben Teilnehmer, sind beide sicher.
  Zeigen sie auf verschiedene Teilnehmer, wird der Name genommen und die Startnummer gelb.
- **Namen unscharf:** Ähnlichkeit (``difflib``) über den Schlüssel aus ``series_identity`` und eine Fassung, in der
  leicht verwechselte Zeichen gleich sind (0/O, 1/l/I, 5/S, 8/B). Ab ``name_match`` wird der Teilnehmer
  vorgeschlagen, ab ``name_sure`` ohne Markierung. Aliase der Mitglieder (nur für den Vorstand, wie in #1743) zählen
  wie Namen. Jeder Teilnehmer höchstens einmal.
- **Team:** gegen die Standard-Teams der Teilnehmer, zuerst das des erkannten Teilnehmers.

Unsichere Felder stehen je Zeile in ``uncertain`` (die Oberfläche färbt sie gelb), das Gelesene in ``read``, wenn es
vom Wert abweicht. Gespeichert wird hier nichts - erst, wenn jemand das Blatt prüft und übernimmt.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from services import series_identity
from services.result_image_ocr import Read, Reading, RowReading
from services.result_image_values import DIGIT_FIX, compact, is_placeholder, mark_of, parse_gap, parse_time, read_digits

# Leicht verwechselte Zeichen - nur für den Vergleich von Namen, nie für den angezeigten Wert.
_LOOKALIKE = str.maketrans({"0": "o", "1": "l", "i": "l", "5": "s", "8": "b", "6": "b", "2": "z"})
TIME_TOLERANCE = 0.0015
AGREEMENT_BONUS = 20
# Ein Platz (oder „DNF“) steht in jeder Zeile - ist er nicht gelesen, ist die Zelle unsicher. Leer sein darf etwa der
# Abstand des Siegers.
REQUIRED_KINDS = {"place"}
# Längen wie im Ergebnis-Blatt (``reference_result_routes.ResultEntryRow``) - so bleibt die Antwort klein.
TEXT_LIMIT = 120
FIELD_LIMITS = {"name": TEXT_LIMIT, "team": TEXT_LIMIT, "start_number": 10, "time": 20, "gap": 20}


# ---------------------------------------------------------------- Lesen und Werte
@dataclass
class Decision:
    value: object = None  # int, str oder (Sekunden, Text) - je nach Art
    text: str = ""  # angezeigter Wert
    sure: bool = True
    raw: str = ""  # gelesen (die gewählte Lesung)
    conf: float = 0.0
    mark: str | None = None
    disagree: bool = False


def _parse(kind: str, read: Read, *, page: bool):
    """Wert einer Lesung oder ``None``. ``page``: Seitenlesung ohne Whitelist - Ziffern dürfen verlesen sein."""
    if kind == "place":
        mark = mark_of(read.text)
        if mark:
            return ("mark", mark)
        digits = read_digits(read.text, fix=page)
        return ("place", int(digits)) if digits and 0 < int(digits) <= 999 else None
    if kind == "number":
        digits = read_digits(read.text, fix=page)
        return ("number", digits.lstrip("0") or "0") if digits else None
    if kind in ("time", "gap") and is_placeholder(read.text):
        return ("empty", None)
    if kind == "time":
        mark = mark_of(read.text)
        if mark:
            return ("mark", mark)
        parsed = parse_time(read.text, fix=page)
        if parsed:
            return ("time", parsed)
        lapped = parse_gap(read.text)  # Überrundete: „+1 Runden“ statt einer Zeit
        return ("lap", lapped[0]) if lapped and lapped[1] is None else None
    if kind == "gap":
        parsed = parse_gap(read.text, fix=page)
        return ("gap", parsed) if parsed else None
    text = clean_text(read.text)
    return ("text", text) if text else None


def clean_text(text: str) -> str:
    """Leerraum zusammengefasst, Satzzeichen-Reste am Rand weg (Linien, Striche, Punkte aus der Erkennung)."""
    words = str(text or "").split()
    while words and not any(char.isalnum() for char in words[0]):
        words.pop(0)
    while words and not any(char.isalnum() for char in words[-1]):
        words.pop()
    return " ".join(words)


def _display(parsed) -> str:
    kind, value = parsed
    if kind in ("time",):
        return value[1]
    if kind == "gap":
        return value[0]
    if kind == "mark":
        return value.upper()
    if kind == "empty":
        return ""
    return str(value)


def _same(left, right) -> bool:
    if left is None or right is None:
        return False
    if left[0] != right[0]:
        return False
    if left[0] == "text":
        return series_identity.normalize_name(left[1]) == series_identity.normalize_name(right[1])
    return _display(left) == _display(right)


def _exact(text: str) -> str:
    return " ".join(clean_text(text).split())


def decide(kind: str, page: Read | None, strip: Read | None, min_conf: float) -> Decision:
    """Ein Wert aus Seiten- und Streifenlesung (siehe Modultext)."""
    reads = [(read, _parse(kind, read, page=is_page)) for read, is_page in ((page, True), (strip, False)) if read]
    reads = [(read, parsed) for read, parsed in reads if read.text.strip()]
    if not reads:
        return Decision(sure=kind not in REQUIRED_KINDS)
    parsed_reads = [(read, parsed) for read, parsed in reads if parsed is not None]
    if not parsed_reads:
        best = max(reads, key=lambda item: item[0].conf)[0]
        text = clean_text(best.text)
        if kind in ("time", "gap") and not any(char.isdigit() for char in text):
            text = ""  # Zeiten haben Ziffern - verlesene Platzhalter („+--:--,---“) nicht ins Feld, nur gelb
        return Decision(value=None, text=text, sure=False, raw=best.text, conf=best.conf)
    if kind == "text" and len(parsed_reads) == 2 and _same(parsed_reads[0][1], parsed_reads[1][1]):
        # Namen und Teams sind frei - Tesseract verliest sie oft zweimal fast gleich (ein Leerzeichen mehr, l statt I).
        # Sicher nur, wenn beide Lesungen Zeichen für Zeichen gleich sind und jede für sich über der Schwelle liegt.
        read, parsed = max(parsed_reads, key=lambda item: item[0].conf)
        exact = _exact(parsed_reads[0][0].text) == _exact(parsed_reads[1][0].text)
        return _decision(parsed, read, sure=exact and all(item[0].conf >= min_conf for item in parsed_reads))
    if len(parsed_reads) == 2 and _same(parsed_reads[0][1], parsed_reads[1][1]):
        # Zwei unabhängige Lesungen sagen dasselbe - dafür reicht weniger Sicherheit je Wort.
        read, parsed = max(parsed_reads, key=lambda item: item[0].conf)
        return _decision(parsed, read, sure=read.conf >= min_conf - AGREEMENT_BONUS)
    if len(parsed_reads) == 2:
        (page_read, page_parsed), (strip_read, strip_parsed) = parsed_reads
        if kind == "text":
            chosen = max(parsed_reads, key=lambda item: item[0].conf)
        else:
            # Zahlen: der Streifen mit Whitelist gilt, außer er ist deutlich unsicherer.
            chosen = (strip_read, strip_parsed) if strip_read.conf >= page_read.conf - 10 else (page_read, page_parsed)
        decision = _decision(chosen[1], chosen[0], sure=False)
        decision.disagree = True
        return decision
    read, parsed = parsed_reads[0]
    other_unparsed = len(reads) > 1
    return _decision(parsed, read, sure=read.conf >= min_conf and not other_unparsed)


def _decision(parsed, read: Read, *, sure: bool) -> Decision:
    kind, value = parsed
    out = Decision(value=value, text=_display(parsed), sure=sure, raw=read.text, conf=read.conf)
    if kind == "mark":
        out.mark, out.value, out.text = value, None, value.upper()
    return out


# ---------------------------------------------------------------- Namen
def _name_forms(name: str) -> set[str]:
    keys = set(series_identity.name_keys(name))
    return keys | {key.translate(_LOOKALIKE) for key in keys}


def similarity(read: str, known: str) -> float:
    """Ähnlichkeit 0-1 zweier Namen, unempfindlich gegen Groß/klein, Leerzeichen, Clan-Tags und Verwechsler."""
    best = 0.0
    for left in _name_forms(read):
        for right in _name_forms(known):
            if left == right:
                return 1.0
            best = max(best, SequenceMatcher(None, left, right).ratio())
    return best


@dataclass
class Candidate:
    participant: dict
    names: list[str] = field(default_factory=list)  # eigener Name und Aliase


def candidates(participants: list[dict], aliases: list[dict] | None = None) -> list[Candidate]:
    """Teilnehmer der Saison mit ihren Namen; ``aliases`` (nur Vorstand) als ``{"name", "participant_id"}``."""
    out = {row["id"]: Candidate(row, [row.get("name") or ""]) for row in participants if row.get("id")}
    for alias in aliases or []:
        target = out.get(alias.get("participant_id"))
        if target and alias.get("name"):
            target.names.append(alias["name"])
    return list(out.values())


def best_name(texts: list[str], pool: list[Candidate]) -> list[tuple[float, Candidate]]:
    """Alle Teilnehmer mit ihrer besten Ähnlichkeit zu einer der Lesungen, die ähnlichsten zuerst."""
    scored = []
    for candidate in pool:
        score = max((similarity(text, name) for text in texts if text for name in candidate.names if name),
                    default=0.0)
        scored.append((score, candidate))
    scored.sort(key=lambda item: (-item[0], str(item[1].participant.get("name") or "").casefold()))
    return scored


# ---------------------------------------------------------------- Ganzes Blatt
FIELDS = ("place", "start_number", "name", "team", "grid", "time", "gap", "points")


def _row_decisions(row, columns: dict[str, dict], min_conf: float) -> dict[str, Decision]:
    return {name: decide(columns[name]["kind"], row.cells.get(name), row.strips.get(name), min_conf)
            for name in FIELDS if name in columns}


def _check_places(rows: list[dict[str, Decision]]) -> None:
    """Plätze ohne Lücke, je Zeile eins mehr. Wo die Reihe beginnt, sagt die Mehrheit der gelesenen Plätze - ein
    verlesener erster Platz macht so nicht alle anderen gelb. Ausfälle (DNF, DNS, DSQ) haben keinen Platz und zählen
    nicht mit."""
    ranked = [row["place"] for row in rows if row.get("place") is not None and not _row_marks(row)]
    offsets = Counter(place.value - index for index, place in enumerate(ranked) if isinstance(place.value, int))
    start = max(offsets.items(), key=lambda item: (item[1], -abs(item[0] - 1)))[0] if offsets else 1
    for index, place in enumerate(ranked):
        place.sure = isinstance(place.value, int) and place.value == start + index


def _lapped(decision: Decision | None) -> str | None:
    """„+1 Runde(n)“ in Zeit oder Abstand - sonst ``None``."""
    if decision is None:
        return None
    value = decision.value
    if isinstance(value, tuple) and len(value) == 2 and value[1] is None and isinstance(value[0], str):
        return value[0]
    return value if isinstance(value, str) and value.startswith("+") else None


def _leader_time(rows: list[dict[str, Decision]]) -> tuple[float | None, bool]:
    """Zeit des Siegers: was die meisten Zeilen als Zeit minus Abstand ergeben (auf die Tausendstel) - so macht eine
    verlesene Siegerzeit nicht alle Abstände gelb. Ohne Mehrheit (mindestens zwei Zeilen) die erste gelesene Zeit.
    Liefert die Zeit und ob eine Mehrheit sie bestätigt."""
    first = None
    votes: Counter = Counter()
    for row in rows:
        time, gap = row.get("time"), row.get("gap")
        if not (time and isinstance(time.value, tuple)):
            continue
        if first is None:
            first = time.value[0]
        if gap and isinstance(gap.value, tuple) and gap.value[1] is not None:
            votes[round(time.value[0] - gap.value[1], 3)] += 1
    if votes:
        value, count = votes.most_common(1)[0]
        if count >= 2:
            return value, True
    return first, False


def _check_times(rows: list[dict[str, Decision]]) -> None:
    """Zeit = Zeit des Siegers + Abstand; ohne Abstand müssen Zeiten wenigstens steigen. Überrundete: steht „+1 Runde“
    in Zeit und Abstand gleich, oder ist die Zeit kleiner als die des Vordermanns, passt der Abstand „+N Runden“."""
    winner, voted = _leader_time(rows)
    leader = None
    previous = None
    for row in rows:
        time, gap = row.get("time"), row.get("gap")
        laps = _lapped(gap)
        if laps and _lapped(time) == laps:
            time.sure = gap.sure = True
            continue
        seconds = time.value[0] if time and isinstance(time.value, tuple) else None
        if seconds is None:
            continue
        if laps and previous is not None and seconds + TIME_TOLERANCE < previous:
            gap.sure = True
        if leader is None:
            leader = winner if winner is not None else seconds
            previous = seconds
            # Der Sieger: bestätigt, wenn seine Zeit zur Mehrheit passt; passt sie nicht, ist sie verlesen - gelb.
            if abs(seconds - leader) > TIME_TOLERANCE:
                time.sure = False
            elif voted:
                time.sure = True
            continue
        gap_seconds = gap.value[1] if gap and isinstance(gap.value, tuple) else None
        if gap_seconds is not None:
            consistent = abs(leader + gap_seconds - seconds) <= TIME_TOLERANCE
            time.sure = gap.sure = consistent
        if gap_seconds is not None and previous is not None and seconds + TIME_TOLERANCE < previous:
            time.sure = False
        previous = seconds


def _check_gaps_in_columns(rows: list[dict[str, Decision]]) -> None:
    """Startnummer, Team und Startplatz stehen in jeder Zeile: hat die Spalte in mindestens der Hälfte der Zeilen einen
    Wert, ist eine leere Zelle verdächtig (etwa dunkelgraue Schrift auf dunklem Grund) - gelb."""
    for name in ("start_number", "team", "grid"):
        cells = [row.get(name) for row in rows if row.get(name) is not None]
        filled = [cell for cell in cells if cell.raw]
        if not cells or len(filled) * 2 < len(rows):
            continue
        for cell in cells:
            if not cell.raw:
                cell.sure = False


def _check_grid(rows: list[dict[str, Decision]]) -> None:
    seen: dict[object, list[Decision]] = {}
    for row in rows:
        grid = row.get("grid")
        if grid and grid.value is not None:
            seen.setdefault(grid.value, []).append(grid)
    for items in seen.values():
        if len(items) > 1:
            for item in items:
                item.sure = False


def _row_marks(row: dict[str, Decision]) -> list[str]:
    marks = []
    for name in ("place", "time"):
        item = row.get(name)
        if item and item.mark and item.mark not in marks:
            marks.append(item.mark)
    return marks


def build(reading: Reading, template: dict, participants: list[dict], *, aliases: list[dict] | None = None) -> dict:
    """Die Antwort für die Oberfläche (siehe ``routes/reference_result_image_routes.py``)."""
    columns = {column["field"]: column for column in template["columns"]}
    min_conf = float(template.get("min_confidence", 80))
    name_match = float(template.get("name_match", 0.72))
    name_sure = float(template.get("name_sure", 0.9))
    team_match = float(template.get("team_match", 0.6))
    rows = [_row_decisions(row, columns, min_conf) for row in reading.rows]
    # Ein Ausfall in „Pos“ bestätigt „DNF“ in „Zeit“ und umgekehrt.
    for row in rows:
        place, time = row.get("place"), row.get("time")
        if place and time and place.mark and place.mark == time.mark:
            place.sure = time.sure = True
        # Ausfall: statt Zeit und Abstand stehen Platzhalter - auch verlesen (ohne Ziffern) sind sie leer, nicht gelb.
        if _row_marks(row):
            for key in ("time", "gap"):
                cell = row.get(key)
                if cell is not None and cell.value is None and not cell.mark and not any(
                        char.isdigit() for char in cell.raw):
                    cell.text, cell.sure = "", True
    _check_places(rows)
    _check_times(rows)
    _check_grid(rows)
    _check_gaps_in_columns(rows)

    pool = candidates(participants, aliases)
    teams = sorted({str(row.get("default_team")) for row in participants if row.get("default_team")})
    chosen, lost = _match_people(reading, rows, pool, name_match, name_sure)

    out_rows = []
    for index, (row, match, raw) in enumerate(zip(rows, chosen, reading.rows)):
        out_rows.append(_row_out(index, row, match, teams, name_match, name_sure, team_match, raw=raw,
                                 lost=index in lost))
        out_rows[-1]["color"] = raw.color
    # Reichte das Zeitbudget nicht für die zweite Lesung einer Spalte, ist dort jede gelesene Zelle ungeprüft - gelb.
    for out, raw in zip(out_rows, reading.rows):
        unchecked = {name for name in reading.unchecked if name in FIELDS and name in raw.cells}
        if unchecked - set(out["uncertain"]):
            out["uncertain"] = [name for name in FIELDS if name in out["uncertain"] or name in unchecked]
    header = _header_out(reading, pool, min_conf, name_match, name_sure)
    uncertain_rows = sum(1 for row in out_rows if row["uncertain"])
    return {"rows": out_rows, **header, "uncertain_rows": uncertain_rows, "team_colors": team_colors(out_rows),
            "is_result": _looks_like_result(rows, template)}


def team_colors(rows: list[dict]) -> dict[str, str]:
    """Vorschlag für die Teamfarben (#1950): je Team die häufigste Schriftfarbe seiner Zeilen. Nur ein Vorschlag -
    gespeichert wird nichts."""
    seen: dict[str, Counter] = {}
    for row in rows:
        if row.get("team") and row.get("color"):
            seen.setdefault(row["team"], Counter())[row["color"]] += 1
    return {team: counts.most_common(1)[0][0] for team, counts in sorted(seen.items())}


def _looks_like_result(rows: list[dict[str, Decision]], template: dict) -> bool:
    """Ein Ergebnis hat in den Feldern ``template["needs"]`` (Rennliga: Zeit) in mindestens der Hälfte der Zeilen einen
    Wert - eine Zeit, „+1 Runde“ oder „DNF“. Saisontabellen und Kalender haben das nicht."""
    for field_name in template.get("needs") or []:
        filled = sum(1 for row in rows if row.get(field_name) is not None
                     and (row[field_name].mark or row[field_name].value not in (None, "")))
        if filled * 2 < len(rows):
            return False
    return True


def _match_people(reading: Reading, rows: list[dict[str, Decision]], pool: list[Candidate], name_match: float,
                  name_sure: float) -> tuple[list[dict | None], set[int]]:
    """Je Zeile der Teilnehmer (oder ``None``) mit Ähnlichkeit, ob die Startnummer passt und ob jede Lesung des Namens
    zu ihm passt (``agree``). Jeder höchstens einmal: die besser passende Zeile gewinnt - die Zeilen, die ihren
    Teilnehmer so verlieren, kommen als zweiter Wert zurück."""
    proposals = []
    for index, (row, raw) in enumerate(zip(rows, reading.rows)):
        texts = [read.text for read in (raw.cells.get("name"), raw.strips.get("name")) if read and read.text.strip()]
        numbers = set()
        for read, page in ((raw.cells.get("start_number"), True), (raw.strips.get("start_number"), False)):
            parsed = _parse("number", read, page=page) if read else None
            if parsed:
                numbers.add(parsed[1])
        best = None
        for score, candidate in best_name(texts, pool)[:8]:
            own = str(candidate.participant.get("start_number") or "").strip()
            number_hit = bool(own) and own in numbers
            if score < name_match and not (number_hit and score >= 0.4):
                continue
            combined = score + (0.3 if number_hit else 0.0)
            if best is None or combined > best["combined"]:
                best = {"candidate": candidate, "score": score, "number_hit": number_hit, "combined": combined,
                        "index": index}
        if best:
            # Seite und Streifen müssen beide auf diesen Teilnehmer zeigen - liest eine „Max Muster“ und die andere
            # „Tim Kunz“, ist der Name nicht sicher, auch wenn eine Lesung genau passt.
            names = [name for name in best["candidate"].names if name]
            best["agree"] = all(max((similarity(text, name) for name in names), default=0.0) >= name_match
                                for text in texts)
            best["texts"] = texts
        proposals.append(best)
    taken: dict[str, dict] = {}
    lost: set[int] = set()
    for proposal in sorted((item for item in proposals if item), key=lambda item: -item["combined"]):
        pid = proposal["candidate"].participant["id"]
        if pid in taken:
            proposals[proposal["index"]] = None
            lost.add(proposal["index"])
        else:
            taken[pid] = proposal
    return proposals, lost


def _reads_text(texts: list[str]) -> str:
    """Was im Bild stand - bei zwei verschiedenen Lesungen beide („Max Muster / Tim Kunz“)."""
    seen: list[str] = []
    for text in texts:
        cleaned = clean_text(text)
        if cleaned and cleaned not in seen:
            seen.append(cleaned)
    return " / ".join(seen)


def _all_reads_say(texts: list[str], known: list[str], team: str, threshold: float) -> bool:
    """Zeigt jede Lesung (Seite, Streifen) auf dasselbe bekannte Team, jeweils ab ``threshold``?"""
    for text in texts:
        score, best = max(((similarity(text, item), item) for item in known), key=lambda pair: pair[0])
        if best != team or score < threshold:
            return False
    return True


def _team_out(decision: Decision | None, match: dict | None, teams: list[str], team_match: float,
              name_sure: float, texts: list[str] | None = None) -> tuple[str | None, bool]:
    """Das Team: ein bekanntes (zuerst das des Teilnehmers) ab ``team_match`` - gelb unter ``name_sure`` oder wenn die
    Lesungen (``texts``: Seite, Streifen) auf verschiedene Teams zeigen -, sonst wie gelesen. Teams sind wenige und
    bekannt, darum reicht weniger Ähnlichkeit als bei Namen."""
    if decision is None or not decision.text:
        return None, True
    read = decision.text
    preferred = []
    own = match["candidate"].participant.get("default_team") if match else None
    if own:
        preferred.append(own)
    preferred.extend(team for team in teams if team != own)
    scored = [(similarity(read, team), team) for team in preferred]
    if scored:
        score, team = max(scored, key=lambda item: item[0])
        if score >= name_sure:
            return team, _all_reads_say(texts or [read], preferred, team, name_sure)
        if score >= team_match:
            return team, False
    return read, decision.sure


def _row_out(index: int, row: dict[str, Decision], match: dict | None, teams: list[str], name_match: float,
             name_sure: float, team_match: float, *, raw: RowReading | None = None, lost: bool = False) -> dict:
    uncertain: list[str] = []
    read: dict[str, str] = {}

    def flag(name: str, decision: Decision | None, value_text: str | None) -> None:
        if decision is None:
            return
        if not decision.sure:
            uncertain.append(name)
        if decision.raw and clean_text(decision.raw) != (value_text or ""):
            read[name] = clean_text(decision.raw)

    place = row.get("place")
    marks = _row_marks(row)
    out = {"index": index, "place": None, "dnf": "dnf" in marks, "marks": marks, "start_number": None, "name": "",
           "participant_id": None, "team": None, "grid": None, "time": None, "gap": None, "points": None}
    if place:
        out["place"] = place.value if isinstance(place.value, int) and not place.mark else None
        flag("place", place, place.text)

    number = row.get("start_number")
    name = row.get("name")
    if match:
        person = match["candidate"].participant
        out["participant_id"] = person["id"]
        out["name"] = person.get("name") or ""
        own_number = str(person.get("start_number") or "").strip()
        name_ok = match["score"] >= name_sure or (match["score"] >= name_match and match["number_hit"])
        if name and not (name_ok and match.get("agree", True)):
            uncertain.append("name")
        if name and not match.get("agree", True):
            read["name"] = _reads_text(match.get("texts") or [name.raw])
        elif name and name.raw and clean_text(name.raw) != out["name"]:
            read["name"] = clean_text(name.raw)
        if own_number:
            # Die Startnummer des Teilnehmers gilt. Gelb nur, wenn im Bild eine andere stand - ohne gelesene Nummer
            # kommt sie aus der Saison, nicht aus dem Bild.
            out["start_number"] = own_number
            if number and number.raw and not match["number_hit"]:
                uncertain.append("start_number")
            if number and number.raw and clean_text(number.raw) != own_number:
                read["start_number"] = clean_text(number.raw)
        elif number:
            out["start_number"] = number.text or None
            flag("start_number", number, out["start_number"])
    else:
        if name:
            out["name"] = name.text
            flag("name", name, out["name"])
            if lost and "name" not in uncertain:
                # Der Name passte zu einem Teilnehmer, den eine andere Zeile besser trifft - doppelt oder verlesen.
                uncertain.append("name")
                read.setdefault("name", clean_text(name.raw))
        else:
            uncertain.append("name")
        if number:
            out["start_number"] = number.text or None
            flag("start_number", number, out["start_number"])

    team_texts = [read_.text for read_ in ((raw.cells.get("team"), raw.strips.get("team")) if raw else ())
                  if read_ and read_.text.strip()]
    team, team_sure = _team_out(row.get("team"), match, teams, team_match, name_sure, team_texts)
    team_cell = row.get("team")
    if team_cell is not None and not team_cell.raw and not team_cell.sure:
        # Leere Zelle in einer Spalte, die sonst Teams hat: das Team des Teilnehmers vorschlagen - gelb.
        team = (match["candidate"].participant.get("default_team") if match else None) or None
        team_sure = False
    out["team"] = team
    if team_cell is not None:
        if not team_sure:
            uncertain.append("team")
        raw_team = _reads_text(team_texts) if len(team_texts) > 1 and not team_sure else clean_text(row["team"].raw)
        if raw_team and raw_team != team:
            read["team"] = raw_team

    for key in ("grid", "time", "gap", "points"):
        decision = row.get(key)
        if decision is None:
            continue
        if key in ("grid", "points"):
            value = decision.value if isinstance(decision.value, str) and decision.value.isdigit() else None
            out[key] = int(value) if value else None
        elif decision.mark:
            out[key] = None
        else:
            out[key] = decision.text or None
        flag(key, decision, decision.text)
    out["uncertain"] = [name for name in FIELDS if name in uncertain]
    # Die Antwort bleibt klein und passt ins Blatt (Name und Team höchstens 120 Zeichen, Startnummer 10).
    for key, limit in FIELD_LIMITS.items():
        if isinstance(out[key], str):
            out[key] = out[key][:limit].strip() or ("" if key == "name" else None)
    out["read"] = {key: value[:TEXT_LIMIT] for key, value in read.items()}
    return out


def _person(text: str, pool: list[Candidate], name_match: float, name_sure: float) -> tuple[str, str | None, bool]:
    """Ein Name aus dem Kopf: Teilnehmer (Name, Kennung, sicher?) oder der gelesene Text."""
    scored = best_name([text], pool)
    if scored and scored[0][0] >= name_match:
        score, candidate = scored[0]
        return candidate.participant.get("name") or "", candidate.participant["id"], score >= name_sure
    return clean_text(text), None, False


def _header_out(reading: Reading, pool: list[Candidate], min_conf: float, name_match: float,
                name_sure: float) -> dict:
    out: dict = {"track": None, "session": None, "fastest_lap": None, "pole": None, "driver_of_the_day": None}
    track = reading.header.get("track")
    if track and clean_text(track.text):
        out["track"] = {"name": clean_text(track.text)[:TEXT_LIMIT],
                        "uncertain": [] if track.conf >= min_conf else ["name"]}
    session = reading.header.get("session")
    if session and clean_text(session.text):
        # Nur ein Hinweis, bis es Läufe je Termin gibt (#1930): Rennen, Sprint oder Qualifying.
        name = clean_text(session.text)[:40]
        key = series_identity.normalize_name(name)
        kind = "qualifying" if key.startswith("quali") else "sprint" if key.startswith("sprint") else "race"
        out["session"] = {"name": name, "kind": kind}
    for key in ("fastest_lap", "pole"):
        lap = reading.header.get(key)
        if not lap or not lap.text.strip():
            continue
        name_words, time_text, exact = _split_lap(clean_text(lap.text).split())
        name, pid, sure = _person(" ".join(name_words), pool, name_match, name_sure)
        uncertain = [] if sure or (not pid and lap.conf >= min_conf) else ["name"]
        if not exact or not _time_word_sure(lap, min_conf):
            uncertain.append("time")
        out[key] = {"name": name[:TEXT_LIMIT], "participant_id": pid, "time": time_text, "uncertain": uncertain,
                    "read": clean_text(lap.text)[:TEXT_LIMIT]}
    dotd = reading.header.get("driver_of_the_day")
    if dotd and dotd.text.strip():
        name, pid, sure = _person(dotd.text, pool, name_match, name_sure)
        uncertain = [] if sure or (not pid and dotd.conf >= min_conf) else ["name"]
        out["driver_of_the_day"] = {"name": name[:TEXT_LIMIT], "participant_id": pid, "uncertain": uncertain,
                                    "read": clean_text(dotd.text)[:TEXT_LIMIT]}
    return out


def _split_lap(words: list[str]) -> tuple[list[str], str | None, bool]:
    """Name und Zeit aus „Name 1:31.207“: die Zeit sind die letzten Wörter, die als Zeit taugen. Ein letztes Wort aus
    Ziffern gehört nie zum Namen - ist es verlesen („131.207“), wird die Zeit geraten (``exact`` falsch)."""
    for cut in range(len(words) - 1, max(-1, len(words) - 4), -1):
        parsed = parse_time("".join(words[cut:]), fix=True)
        if parsed:
            return words[:cut], parsed[1], True
    if words and sum(char.isdigit() for char in words[-1]) >= max(2, len(words[-1]) * 0.6):
        tail = compact(words[-1]).translate(DIGIT_FIX)
        clock, _, fraction = tail.partition(".")
        guess = parse_time(f"{clock[:-2]}:{clock[-2:]}.{fraction}") if len(clock) >= 3 and clock.isdigit() else None
        return words[:-1], guess[1] if guess else None, False
    return words, None, False


def _time_word_sure(read: Read, min_conf: float) -> bool:
    return any(conf >= min_conf and parse_time(text, fix=True) for text, conf in read.parts)
