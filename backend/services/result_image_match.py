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

from dataclasses import dataclass, field
from difflib import SequenceMatcher

from services import series_identity
from services.result_image_ocr import Read, Reading

MARKS = ("dnf", "dns", "dsq")
LAP_WORDS = {"runde": "Runde", "runden": "Runden", "lap": "Lap", "laps": "Laps"}
# Leicht verwechselte Zeichen - nur für den Vergleich von Namen, nie für den angezeigten Wert.
_LOOKALIKE = str.maketrans({"0": "o", "1": "l", "i": "l", "5": "s", "8": "b", "6": "b", "2": "z"})
# In Zahlenspalten der Seitenlesung (ohne Whitelist): Buchstaben, die eigentlich Ziffern sind.
_DIGIT_FIX = str.maketrans({"O": "0", "o": "0", "D": "0", "Q": "0", "I": "1", "l": "1", "|": "1", "i": "1",
                            "S": "5", "s": "5", "B": "8", "Z": "2", "z": "2", ",": "."})
TIME_TOLERANCE = 0.0015
AGREEMENT_BONUS = 20


# ---------------------------------------------------------------- Lesen und Werte
def _compact(text: str) -> str:
    return "".join(str(text or "").split())


def _mark(text: str) -> str | None:
    """„DNF“, „DNS“ oder „DSQ“ - auch leicht verlesen („ONF“, „DNE“)."""
    key = _compact(text).upper()
    if len(key) != 3 or key.isdigit():
        return None
    for mark in MARKS:
        if key == mark.upper():
            return mark
    best = max(MARKS, key=lambda mark: SequenceMatcher(None, key, mark.upper()).ratio())
    return best if SequenceMatcher(None, key, best.upper()).ratio() >= 0.66 and key[1:2] in ("N", "S") else None


def _digits(text: str, *, fix: bool) -> str | None:
    key = _compact(text)
    if fix:
        key = key.translate(_DIGIT_FIX)
    return key if key.isdigit() and len(key) <= 3 else None


def parse_time(text: str, *, fix: bool = False) -> tuple[float, str] | None:
    """„1:32:15.123“, „32:15.123“ oder „1:31.207“ - Sekunden und die Schreibweise mit Punkt vor den Tausendsteln."""
    key = _compact(text)
    if fix:
        key = key.translate(_DIGIT_FIX)
    key = key.replace(",", ".")
    if key.count(".") != 1:
        return None
    clock, fraction = key.split(".")
    if not fraction.isdigit() or not 1 <= len(fraction) <= 3:
        return None
    parts = clock.split(":")
    if not 1 <= len(parts) <= 3 or not all(part.isdigit() for part in parts):
        return None
    if any(len(part) != 2 for part in parts[1:]) or len(parts[0]) > 2 or (len(parts) > 1 and int(parts[-1]) > 59):
        return None
    if len(parts) == 3 and int(parts[1]) > 59:
        return None
    seconds = 0.0
    for part in parts:
        seconds = seconds * 60 + int(part)
    return seconds + int(fraction) / (10 ** len(fraction)), f"{clock}.{fraction}"


def parse_gap(text: str, *, fix: bool = False) -> tuple[str, float | None] | None:
    """„+2.333“, „+1:03.177“ (Sekunden) oder „+1 Runde“ (ohne Sekunden). Das Plus darf fehlen."""
    key = _compact(text)
    if not key:
        return None
    body = key[1:] if key[0] in "+-#" else key
    digits = ""
    while digits.__len__() < len(body) and body[len(digits)].isdigit():
        digits += body[len(digits)]
    word = body[len(digits):].casefold()
    if digits and word in LAP_WORDS:
        return f"+{int(digits)} {LAP_WORDS[word]}", None
    parsed = parse_time(body, fix=fix)
    if parsed is None:
        return None
    return f"+{parsed[1]}", parsed[0]


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
        mark = _mark(read.text)
        if mark:
            return ("mark", mark)
        digits = _digits(read.text, fix=page)
        return ("place", int(digits)) if digits and 0 < int(digits) <= 999 else None
    if kind == "number":
        digits = _digits(read.text, fix=page)
        return ("number", digits.lstrip("0") or "0") if digits else None
    if kind == "time":
        mark = _mark(read.text)
        if mark:
            return ("mark", mark)
        parsed = parse_time(read.text, fix=page)
        return ("time", parsed) if parsed else None
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
    return str(value)


def _same(left, right) -> bool:
    if left is None or right is None:
        return False
    if left[0] != right[0]:
        return False
    if left[0] == "text":
        return series_identity.normalize_name(left[1]) == series_identity.normalize_name(right[1])
    return _display(left) == _display(right)


def decide(kind: str, page: Read | None, strip: Read | None, min_conf: float) -> Decision:
    """Ein Wert aus Seiten- und Streifenlesung (siehe Modultext)."""
    reads = [(read, _parse(kind, read, page=is_page)) for read, is_page in ((page, True), (strip, False)) if read]
    reads = [(read, parsed) for read, parsed in reads if read.text.strip()]
    if not reads:
        return Decision()
    parsed_reads = [(read, parsed) for read, parsed in reads if parsed is not None]
    if not parsed_reads:
        best = max(reads, key=lambda item: item[0].conf)[0]
        return Decision(value=None, text=clean_text(best.text), sure=False, raw=best.text, conf=best.conf)
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
FIELDS = ("place", "start_number", "name", "team", "grid", "time", "gap")


def _row_decisions(row, columns: dict[str, dict], min_conf: float) -> dict[str, Decision]:
    return {name: decide(columns[name]["kind"], row.cells.get(name), row.strips.get(name), min_conf)
            for name in FIELDS if name in columns}


def _check_places(rows: list[dict[str, Decision]]) -> None:
    """Plätze ohne Lücke: der erste gelesene Platz gibt den Anfang, danach je Zeile eins mehr. Ausfälle (DNF, DNS,
    DSQ) haben keinen Platz und zählen nicht mit."""
    expected = None
    for row in rows:
        place = row.get("place")
        if place is None or _row_marks(row):
            continue
        value = place.value if isinstance(place.value, int) else None
        if expected is None:
            expected = value if value is not None else 1
        place.sure = value == expected
        expected += 1


def _check_times(rows: list[dict[str, Decision]]) -> None:
    """Zeit = Zeit des Ersten + Abstand; ohne Abstand müssen Zeiten wenigstens steigen."""
    leader = None
    previous = None
    for row in rows:
        time, gap = row.get("time"), row.get("gap")
        seconds = time.value[0] if time and isinstance(time.value, tuple) else None
        if seconds is None:
            continue
        if leader is None:
            leader = seconds
            previous = seconds
            continue
        gap_seconds = gap.value[1] if gap and isinstance(gap.value, tuple) else None
        if gap_seconds is not None:
            consistent = abs(leader + gap_seconds - seconds) <= TIME_TOLERANCE
            time.sure = gap.sure = consistent
        if gap_seconds is not None and previous is not None and seconds + TIME_TOLERANCE < previous:
            time.sure = False
        previous = seconds


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
    _check_places(rows)
    _check_times(rows)
    _check_grid(rows)

    pool = candidates(participants, aliases)
    teams = sorted({str(row.get("default_team")) for row in participants if row.get("default_team")})
    chosen = _match_people(reading, rows, pool, name_match, name_sure)

    out_rows = []
    for index, (row, match) in enumerate(zip(rows, chosen)):
        out_rows.append(_row_out(index, row, match, teams, name_match, name_sure, team_match))
    header = _header_out(reading, pool, min_conf, name_match, name_sure)
    uncertain_rows = sum(1 for row in out_rows if row["uncertain"])
    return {"rows": out_rows, **header, "uncertain_rows": uncertain_rows}


def _match_people(reading: Reading, rows: list[dict[str, Decision]], pool: list[Candidate], name_match: float,
                  name_sure: float) -> list[dict | None]:
    """Je Zeile der Teilnehmer (oder ``None``) mit Ähnlichkeit und ob die Startnummer passt. Jeder höchstens einmal:
    die besser passende Zeile gewinnt."""
    proposals = []
    for index, (row, raw) in enumerate(zip(rows, reading.rows)):
        texts = [read.text for read in (raw.cells.get("name"), raw.strips.get("name")) if read]
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
        proposals.append(best)
    taken: dict[str, dict] = {}
    for proposal in sorted((item for item in proposals if item), key=lambda item: -item["combined"]):
        pid = proposal["candidate"].participant["id"]
        if pid in taken:
            proposals[proposal["index"]] = None
        else:
            taken[pid] = proposal
    return proposals


def _team_out(decision: Decision | None, match: dict | None, teams: list[str], team_match: float,
              name_sure: float) -> tuple[str | None, bool]:
    """Das Team: ein bekanntes (zuerst das des Teilnehmers) ab ``team_match`` - gelb unter ``name_sure`` -, sonst wie
    gelesen. Teams sind wenige und bekannt, darum reicht weniger Ähnlichkeit als bei Namen."""
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
            return team, True
        if score >= team_match:
            return team, False
    return read, decision.sure


def _row_out(index: int, row: dict[str, Decision], match: dict | None, teams: list[str], name_match: float,
             name_sure: float, team_match: float) -> dict:
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
           "participant_id": None, "team": None, "grid": None, "time": None, "gap": None}
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
        if name and not name_ok:
            uncertain.append("name")
        if name and name.raw and clean_text(name.raw) != out["name"]:
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
        else:
            uncertain.append("name")
        if number:
            out["start_number"] = number.text or None
            flag("start_number", number, out["start_number"])

    team, team_sure = _team_out(row.get("team"), match, teams, team_match, name_sure)
    out["team"] = team
    if row.get("team"):
        if not team_sure:
            uncertain.append("team")
        raw_team = clean_text(row["team"].raw)
        if raw_team and raw_team != team:
            read["team"] = raw_team

    for key in ("grid", "time", "gap"):
        decision = row.get(key)
        if decision is None:
            continue
        if key == "grid":
            out["grid"] = decision.value if isinstance(decision.value, str) and decision.value.isdigit() else None
            out["grid"] = int(out["grid"]) if out["grid"] else None
        elif decision.mark:
            out[key] = None
        else:
            out[key] = decision.text or None
        flag(key, decision, decision.text)
    out["uncertain"] = [name for name in FIELDS if name in uncertain]
    out["read"] = read
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
    out: dict = {"track": None, "fastest_lap": None, "driver_of_the_day": None}
    track = reading.header.get("track")
    if track and clean_text(track.text):
        out["track"] = {"name": clean_text(track.text), "uncertain": [] if track.conf >= min_conf else ["name"]}
    lap = reading.header.get("fastest_lap")
    if lap and lap.text.strip():
        name_words, time_text, exact = _split_lap(lap.text.split())
        name, pid, sure = _person(" ".join(name_words), pool, name_match, name_sure)
        uncertain = [] if sure or (not pid and lap.conf >= min_conf) else ["name"]
        if not exact or not _time_word_sure(lap, min_conf):
            uncertain.append("time")
        out["fastest_lap"] = {"name": name, "participant_id": pid, "time": time_text, "uncertain": uncertain,
                              "read": clean_text(lap.text)}
    dotd = reading.header.get("driver_of_the_day")
    if dotd and dotd.text.strip():
        name, pid, sure = _person(dotd.text, pool, name_match, name_sure)
        uncertain = [] if sure or (not pid and dotd.conf >= min_conf) else ["name"]
        out["driver_of_the_day"] = {"name": name, "participant_id": pid, "uncertain": uncertain,
                                    "read": clean_text(dotd.text)}
    return out


def _split_lap(words: list[str]) -> tuple[list[str], str | None, bool]:
    """Name und Zeit aus „Name 1:31.207“: die Zeit sind die letzten Wörter, die als Zeit taugen. Ein letztes Wort aus
    Ziffern gehört nie zum Namen - ist es verlesen („131.207“), wird die Zeit geraten (``exact`` falsch)."""
    for cut in range(len(words) - 1, max(-1, len(words) - 4), -1):
        parsed = parse_time("".join(words[cut:]), fix=True)
        if parsed:
            return words[:cut], parsed[1], True
    if words and sum(char.isdigit() for char in words[-1]) >= max(2, len(words[-1]) * 0.6):
        tail = _compact(words[-1]).translate(_DIGIT_FIX)
        clock, _, fraction = tail.partition(".")
        guess = parse_time(f"{clock[:-2]}:{clock[-2:]}.{fraction}") if len(clock) >= 3 and clock.isdigit() else None
        return words[:-1], guess[1] if guess else None, False
    return words, None, False


def _time_word_sure(read: Read, min_conf: float) -> bool:
    return any(conf >= min_conf and parse_time(text, fix=True) for text, conf in read.parts)
