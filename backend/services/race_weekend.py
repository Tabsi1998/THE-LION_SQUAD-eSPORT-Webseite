"""Runde mit Läufen (#1930) - ohne Datenbank: Lauf je Termin, „Ablauf je Runde“ als Vorgabe der Saison (auch
ab Runde X wechselnd), Kürzel-Varianten beim Einfügen, Punkte je Lauf, Pole und Startplatz aus dem Qualifying.

- **Lauf** (``session``): ein Termin ist weiter ein eigener Termin mit eigenem Ergebnisblatt, trägt aber einen Lauf
  („Qualifying“, „Sprint“, „Rennen“, „Hauptrennen“, „Lauf 1“ … - freier Text bis 30 Zeichen). Leer heißt Rennen, so
  bleiben bestehende Termine unverändert. Die Art (``session_kind``: ``qualifying``, ``sprint``, ``race``) kommt aus dem
  Namen: „Blitz-Qualifying“ ist ein Qualifying, „Sprint“ ein Sprint, alles andere ein Rennen.
- **Runde mit Läufen:** Termine mit demselben Kürzel (ohne Leerraum, Groß/klein egal) bilden eine Runde; ein Termin ohne
  Kürzel ist seine eigene Runde. Gezählt werden die Runden in Kalender-Reihenfolge (``weekend_groups``), abgesagte
  zählen mit, archivierte nicht - das ist die „Runde X“ der Vorgaben.
- **Ablauf je Runde** (Serie ``weekend``): ``{"formats": [{"from_round": 1, "sessions": [...]}, …]}`` - je Abschnitt
  (``round_phases``, „ab Runde X“) die Läufe mit Name, Uhrzeit-Versatz in Minuten (``offset``), Wertung (``counts``),
  Punkten (``points``: ``series`` = Schema der Saison wie das Rennen, ``none`` oder eine eigene Liste je Platz), Punkte
  trotz DNF (``dnf``: ``series``, ``place`` = nach Platz, ``none`` = 0), Bonus für die schnellste Runde
  (``fastest_lap``: ``None`` = wie die Saison, sonst die Punkte) und der Quelle des Startplatzes (``grid``: ``manual`` =
  Eingabe, ``qualifying`` = Qualifying derselben Runde, ``reverse_standings`` = umgekehrte Reihenfolge der
  Fahrerwertung vor der Runde, #1960: ``reverse_qualifying`` = umgekehrtes Haupt-Qualifying derselben Runde,
  ``reverse_previous_session`` = umgekehrtes Ergebnis des Laufs davor, beide optional nur die ersten N
  ``reverse_top``). Ein Qualifying zählt nicht - außer es hat eine eigene Liste (etwa P1 = 2 Punkte)
  oder ``counts`` sagt es ausdrücklich.
- **Umgekehrte Aufstellung aus einem Lauf** (#1960, ``with_session_reverse``): ohne gültigen Platz (DNS, DSQ) hinten,
  ein Startplatz von Hand bleibt; ein solcher Lauf hat keine Pole. Übernimmt kein Lauf der Runde seinen Startplatz
  aus dem Qualifying, zählt der Pole-Bonus der Saison am Qualifying (``pole_at_qualifying``) - nur der Bonus.
- **Einfügen:** „R1S“, „R1 S“, „R1-Sprint“, „R1 Sprint“ → Kürzel R1, Lauf Sprint (``take_code``); eine Zeile ohne Lauf
  legt alle Läufe der Vorgabe an (``race_weekend_paste.expand_paste``), eine Zeile mit Lauf nur diesen.
- **Rechnen** (``standings``): je Lauf das eigene Punkteschema; ein leerer Startplatz kommt aus dem Qualifying bzw. der
  umgekehrten Wertung (eingetragene Werte, etwa nach Strafen, bleiben); die Pole des Haupt-Qualifyings (sein erster
  gültiger Platz, im Blatt als Marke ``pole`` gesetzt - ``mark_pole``; eine Marke von Hand auf einer anderen Zeile
  fällt weg) zählt am ersten Rennen der Runde, das seinen Startplatz aus diesem Qualifying nimmt - so zählt ein
  Pole-Bonus wie bisher am Rennen. Zählt das Qualifying selbst, bleibt die Pole dort. Ein Rennen ohne Qualifying
  behält seine Pole-Marke von Hand (Bestand #1927).
"""
from __future__ import annotations

import math

from services.round_phases import normalize_phases, phase_for
from services.scoring_rules import normalize_rules
from services.series_standings import compute_standings, ordered_rounds

MAX_SESSION = 30
MAX_SESSIONS = 6
MAX_NOTE = 200  # Hinweis zur Regeländerung je Abschnitt (#1960)
MAX_POINTS = 100
OFFSET_RANGE = (-24 * 60, 7 * 24 * 60)
SESSION_CHOICES = ("Qualifying", "Shootout", "Sprint", "Rennen", "Hauptrennen", "Lauf 1", "Lauf 2")
# Allgemeine Namen eines Laufs: beim Einfügen gilt der Lauf derselben Art aus der Vorgabe („R1 Feature“ → Hauptrennen).
GENERIC_LABELS = ("Qualifying", "Sprint", "Rennen")
KINDS = ("qualifying", "sprint", "race")
# Startplatz: Eingabe, aus dem Qualifying derselben Runde, umgekehrte Fahrerwertung vor der Runde oder nach dem Lauf
# davor (etwa das Hauptrennen nach dem Sprint). ``reverse_standings`` ist der frühere Name für „vor der Runde“.
REVERSE_BEFORE_ROUND = "reverse_standings_before_round"
REVERSE_AFTER_PREVIOUS = "reverse_standings_after_previous_session"
# Umgekehrte Startaufstellung aus einem Lauf derselben Runde (#1960): aus dem Haupt-Qualifying bzw. dem Ergebnis des
# Laufs davor - optional nur die ersten N (``reverse_top``), dahinter wie im Lauf.
REVERSE_QUALIFYING = "reverse_qualifying"
REVERSE_PREVIOUS_SESSION = "reverse_previous_session"
SESSION_REVERSES = (REVERSE_QUALIFYING, REVERSE_PREVIOUS_SESSION)
REVERSE_TOP_MAX = 100
GRID_SOURCES = ("manual", "qualifying", REVERSE_BEFORE_ROUND, REVERSE_AFTER_PREVIOUS, *SESSION_REVERSES)
GRID_ALIASES = {"reverse_standings": REVERSE_BEFORE_ROUND}
DEFAULT_GRID = {"qualifying": "manual", "sprint": "manual", "race": "qualifying"}
POINT_CHOICES = ("series", "none")
DNF_CHOICES = ("series", "place", "none")  # Punkte trotz DNF: wie die Saison, ja (nach Platz), nein (0)

# Kürzel-Varianten beim Einfügen (#1930): Wort nach dem Kürzel → Lauf.
SESSION_WORDS = {
    "q": "Qualifying", "quali": "Qualifying", "qualy": "Qualifying", "qualifying": "Qualifying",
    "qualifikation": "Qualifying", "shootout": "Shootout",
    "s": "Sprint", "sprint": "Sprint", "sprintrennen": "Sprint",
    "rennen": "Rennen", "race": "Rennen", "feature": "Rennen", "hauptrennen": "Rennen",
}
HEAT_WORDS = ("lauf", "heat")
_LETTERS = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÄÖÜäöü")
_DIGITS = frozenset("0123456789")
_SEPARATORS = frozenset("·|;")


# ---------------------------------------------------------------- Lauf
def clean_session(value) -> str | None:
    """Name des Laufs: Leerraum zusammengefasst, leer heißt ``None`` (Rennen). Länge prüft das Modell."""
    text = " ".join(str(value or "").split())
    return text or None


def label_key(value) -> str:
    return " ".join(str(value or "").split()).casefold()


def session_kind(label) -> str:
    """Art eines Laufs aus seinem Namen: ``qualifying``, ``sprint`` oder ``race`` (auch ohne Namen)."""
    key = "".join(str(label or "").split()).casefold().replace("-", "")
    if "quali" in key or "shootout" in key or key in ("q", "zeittraining"):
        return "qualifying"
    if "sprint" in key or key == "s":
        return "sprint"
    return "race"


def is_main_qualifying(label) -> bool:
    """Das Qualifying fürs Rennen - nicht das Sprint-Qualifying (Shootout): nur hier gibt es die Pole."""
    key = "".join(str(label or "").split()).casefold()
    return session_kind(label) == "qualifying" and "shootout" not in key and "sprint" not in key


# ---------------------------------------------------------------- Kürzel beim Einfügen
# Wo die Terminliste Datum oder Uhrzeit herausgenommen hat, steht dieses Zeichen (``str.isspace`` zählt es als Leerraum,
# der Ort verliert es also von selbst). Für ein Lauf-Wort gilt es als Trenner: „R1 Sprint 07.03. Spa“.
GAP = "\x1f"


def _boundary(raw: str, pos: int) -> bool:
    return pos >= len(raw) or raw[pos].isspace() or raw[pos] in _SEPARATORS


def _word_ends(raw: str, pos: int) -> bool:
    """Hinter einem Lauf-Wort: nur Leerzeichen bis zu einem Trenner (``·``, ``|``, ``;``, Tabulator, herausgenommenes
    Datum) oder dem Zeilenende - „R1 Race of Champions“ ist darum kein Lauf."""
    while pos < len(raw) and raw[pos] == " ":
        pos += 1
    return pos >= len(raw) or raw[pos] in _SEPARATORS or raw[pos] in ("\t", GAP)


def _session_word(raw: str, pos: int) -> tuple[str | None, int]:
    """Ein Lauf-Wort ab ``pos`` (ganzes Wort, danach ein Trenner): Lauf und Ende - sonst ``(None, pos)``."""
    end = pos
    while end < len(raw) and raw[end] in _LETTERS:
        end += 1
    word = raw[pos:end].casefold()
    if not word:
        return None, pos
    if word in HEAT_WORDS:
        digit = end + 1 if end < len(raw) and raw[end] == " " else end
        if digit < len(raw) and raw[digit] in _DIGITS and _word_ends(raw, digit + 1):
            return f"Lauf {raw[digit]}", digit + 1
    if word in SESSION_WORDS and _word_ends(raw, end):
        return SESSION_WORDS[word], end
    return None, pos


def take_code(text: str) -> tuple[str | None, str | None, str]:
    """Kürzel und Lauf am Anfang einer Zeile: ``(Kürzel, Lauf, Rest)`` - ohne Kürzel ``(None, None, text)``.

    Kürzel wie bisher: bis sechs Buchstaben, optional ein Leerzeichen, bis drei Ziffern („R1“, „ST 5“) oder nur Ziffern,
    optional mit Punkt. Neu dahinter ein Lauf, angehängt („R1S“, „R1Q“, „R1-Sprint“) oder als eigenes Wort („R1 S“,
    „R1 Quali“, „R1 Lauf 2“) - aber nur, wenn danach ein Trenner kommt oder die Zeile endet. Hängt etwas anderes am
    Kürzel („R1x“), ist es wie bisher kein Kürzel. Zeichen für Zeichen, ohne regulären Ausdruck auf der Eingabe."""
    raw = str(text or "")
    start = 0
    while start < len(raw) and raw[start].isspace():
        start += 1
    pos = start
    while pos < len(raw) and raw[pos] in _LETTERS:
        pos += 1
    letters = pos - start
    if letters > 6:
        return None, None, raw
    if letters and pos < len(raw) and raw[pos].isspace():
        pos += 1
    digits_from = pos
    while pos < len(raw) and raw[pos] in _DIGITS:
        pos += 1
    if not 1 <= pos - digits_from <= 3:
        return None, None, raw
    code = " ".join(raw[start:pos].split())
    if pos < len(raw) and raw[pos] == ".":
        pos += 1
    if _boundary(raw, pos):
        after = pos
        while after < len(raw) and raw[after] == " ":
            after += 1
        if after > pos:
            session, end = _session_word(raw, after)
            if session:
                return code, session, raw[end:]
        return code, None, raw[pos:]
    session, end = _session_word(raw, pos + 1 if raw[pos] == "-" else pos)
    if session:
        return code, session, raw[end:]
    return None, None, raw


# ---------------------------------------------------------------- Runde mit Läufen
def weekend_key(rnd: dict) -> str | None:
    """Schlüssel der Runde: das Kürzel ohne Leerraum, Groß/klein egal - ohne Kürzel ``None`` (eigene Runde)."""
    key = "".join(str(rnd.get("code") or "").split()).casefold()
    return key or None


def by_code(rounds: list[dict], weekend: dict | None = None) -> bool:
    """Fasst die Saison Termine mit gleichem Kürzel zu einer Runde zusammen? Nur mit Läufen: Ein Termin hat einen Lauf
    oder die Saison einen Ablauf je Runde. Eine alte Saison mit zweimal „R1“ bleibt, wie sie war."""
    return bool((weekend or {}).get("formats")) or any(
        clean_session(rnd.get("session")) for rnd in rounds if not rnd.get("archived_at"))


def weekend_groups(rounds: list[dict], weekend: dict | None = None, *, merge: bool | None = None) -> list[dict]:
    """Die Runden der Saison in Kalender-Reihenfolge (ohne archivierte Termine): ``{"key", "number", "rounds"}``.
    Gleiches Kürzel heißt gleiche Runde nur mit Läufen (``by_code``) - sonst ist jeder Termin seine eigene Runde."""
    merge = by_code(rounds, weekend) if merge is None else merge
    groups: list[dict] = []
    by_key: dict[str, dict] = {}
    for rnd in ordered_rounds(rounds):
        if rnd.get("archived_at"):
            continue
        key = weekend_key(rnd) if merge else None
        group = by_key.get(key) if key else None
        if group is None:
            group = {"key": key, "number": len(groups) + 1, "rounds": []}
            groups.append(group)
            if key:
                by_key[key] = group
        group["rounds"].append(rnd)
    return groups


def annotate(rounds: list[dict], weekend: dict | None = None) -> list[dict]:
    """Kalender-Termine mit Runde (``weekend``) und Art des Laufs (``session_kind``) - an Ort und Stelle."""
    numbers = {rnd["id"]: group["number"] for group in weekend_groups(rounds, weekend) for rnd in group["rounds"]}
    for rnd in rounds:
        rnd["weekend"] = numbers.get(rnd.get("id"))
        rnd["session_kind"] = session_kind(rnd.get("session"))
    return rounds


# ---------------------------------------------------------------- Ablauf je Runde
def _whole(value, field: str, low: int, high: int, default: int) -> int:
    if value is None or value == "":
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError(f"{field}: ganze Zahl erwartet.")
    try:
        number = float(value)
    except ValueError as exc:
        raise ValueError(f"{field}: ganze Zahl erwartet.") from exc
    if not number.is_integer() or not low <= number <= high:
        raise ValueError(f"{field}: zwischen {low} und {high}.")
    return int(number)


def _points(value, kind: str, field: str):
    if value is None or value == "":
        return "none" if kind == "qualifying" else "series"
    if value in POINT_CHOICES:
        return value
    if not isinstance(value, (list, tuple)):
        raise ValueError(f"{field}: „series“, „none“ oder eine Liste je Platz.")
    if len(value) > MAX_POINTS:
        raise ValueError(f"{field}: höchstens {MAX_POINTS} Plätze.")
    out = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item) or item < 0:
            raise ValueError(f"{field}: Punkte als Zahlen ab 0.")
        out.append(int(item) if float(item).is_integer() else item)
    return out or "none"


def _session(raw, field: str) -> dict:
    if not isinstance(raw, dict):
        raise ValueError(f"{field}: Angaben zum Lauf fehlen.")
    label = clean_session(raw.get("label"))
    if not label:
        raise ValueError(f"{field}: Name des Laufs fehlt.")
    if len(label) > MAX_SESSION:
        raise ValueError(f"{field}: Name des Laufs höchstens {MAX_SESSION} Zeichen.")
    kind = session_kind(label)
    counts = raw.get("counts")
    grid = raw.get("grid") or DEFAULT_GRID[kind]
    grid = GRID_ALIASES.get(grid, grid)
    if grid not in GRID_SOURCES:
        raise ValueError(f"{field}: unbekannte Quelle des Startplatzes.")
    points = _points(raw.get("points"), kind, f"{field}: Punkte")
    dnf = raw.get("dnf") or "series"
    if dnf not in DNF_CHOICES:
        raise ValueError(f"{field}: Punkte trotz DNF unbekannt.")
    lap = raw.get("fastest_lap")
    if lap is not None and lap != "":
        if isinstance(lap, bool) or not isinstance(lap, (int, float)) or not math.isfinite(lap) or not 0 <= lap <= 1000:
            raise ValueError(f"{field}: Bonus für die schnellste Runde als Zahl ab 0.")
        lap = int(lap) if float(lap).is_integer() else lap
    else:
        lap = None
    # Ein Qualifying mit eigener Liste (etwa P1 = 2) zählt - sonst nicht, außer es steht ausdrücklich da.
    default_counts = kind != "qualifying" or isinstance(points, list)
    out = {
        "label": label,
        "offset": _whole(raw.get("offset"), f"{field}: Versatz in Minuten", *OFFSET_RANGE, 0),
        "counts": default_counts if counts is None else bool(counts),
        "points": points,
        "dnf": dnf,
        "fastest_lap": lap,
        "grid": grid,
    }
    # „Nur die ersten N umdrehen“ (#1960) - nur bei umgekehrter Aufstellung aus einem Lauf; ohne Angabe fehlt das Feld,
    # damit ältere Vorgaben genau so bleiben, wie sie sind.
    top = raw.get("reverse_top")
    if top is not None and top != "":
        if grid not in SESSION_REVERSES:
            raise ValueError(f"{field}: „nur die ersten … umdrehen“ gibt es nur bei umgekehrter Aufstellung.")
        out["reverse_top"] = _whole(top, f"{field}: nur die ersten … umdrehen", 1, REVERSE_TOP_MAX, 0)
    return out


def _format(raw: dict, where: str) -> dict:
    sessions = raw.get("sessions")
    if not isinstance(sessions, (list, tuple)) or not sessions:
        raise ValueError(f"{where}: mindestens ein Lauf.")
    if len(sessions) > MAX_SESSIONS:
        raise ValueError(f"{where}: höchstens {MAX_SESSIONS} Läufe.")
    out = [_session(item, f"{where}, Lauf {index}") for index, item in enumerate(sessions, start=1)]
    keys = [label_key(item["label"]) for item in out]
    if len(set(keys)) != len(keys):
        raise ValueError(f"{where}: Jeder Lauf nur einmal.")
    # Hinweis zur Regeländerung (#1960): steht ab dieser Runde auf der Serienseite („Ab R5 kein Qualifying …“).
    note = " ".join(str(raw.get("note") or "").split())
    if len(note) > MAX_NOTE:
        raise ValueError(f"{where}: Hinweis höchstens {MAX_NOTE} Zeichen.")
    return {"sessions": out, **({"note": note} if note else {})}


def normalize_weekend(raw) -> dict | None:
    """„Ablauf je Runde“ geprüft und vervollständigt - ohne Abschnitte ``None`` (dann gibt es keine Vorgabe)."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError("Ablauf je Runde: Angaben fehlen.")
    formats = normalize_phases(raw.get("formats"), _format, label="Format")
    return {"formats": formats} if formats else None


def default_session(label) -> dict:
    kind = session_kind(label)
    return {"label": clean_session(label), "offset": 0, "counts": kind != "qualifying",
            "points": "none" if kind == "qualifying" else "series", "dnf": "series", "fastest_lap": None,
            "grid": DEFAULT_GRID[kind]}


def session_config(weekend: dict | None, number: int | None, label) -> dict:
    """Die Vorgabe für den Lauf ``label`` in Runde ``number``: zuerst gleicher Name, dann gleiche Art - sonst der
    Standard der Art (Qualifying ohne Punkte, Rennen mit Startplatz aus dem Qualifying). Dazu ``kind``."""
    kind = session_kind(label)
    phase = phase_for((weekend or {}).get("formats"), number)
    sessions = (phase or {}).get("sessions") or []
    key = label_key(label)
    hit = next((item for item in sessions if key and label_key(item["label"]) == key), None)
    hit = hit or next((item for item in sessions if session_kind(item["label"]) == kind), None)
    return {**(hit or default_session(label)), "kind": kind}


def planned_config(weekend: dict | None, rounds: list[dict], code, label) -> dict:
    """Die Vorgabe für einen neuen Termin mit Kürzel ``code`` und Lauf ``label``: in der Runde dieses Kürzels, sonst in
    der nächsten neuen Runde."""
    key = "".join(str(code or "").split()).casefold() or None
    groups = weekend_groups(rounds, weekend, merge=bool(clean_session(label)) or by_code(rounds, weekend))
    number = next((group["number"] for group in groups if key and group["key"] == key), len(groups) + 1)
    return session_config(weekend, number, label)


def round_plan(rounds: list[dict], weekend: dict | None) -> dict[str, dict]:
    """Je Termin (ohne archivierte) die Runde (Nummer und Schlüssel der Gruppe) und die Vorgabe seines Laufs."""
    plan = {}
    for group in weekend_groups(rounds, weekend):
        for rnd in group["rounds"]:
            plan[rnd["id"]] = {"number": group["number"], "unit": str(group["number"]),
                               "config": session_config(weekend, group["number"], rnd.get("session"))}
    return plan


def counts_updates(rounds: list[dict], weekend: dict | None) -> dict[str, bool]:
    """Termine, deren Wertung der Vorgabe folgt (``counts_manual`` ist ``False`` - von Hand Gesetztes und ältere Termine
    ohne diese Angabe bleiben) und von ihr abweicht: Kennung → neue Wertung."""
    plan = round_plan(rounds, weekend)
    out = {}
    for rnd in rounds:
        entry = plan.get(rnd.get("id"))
        if entry and rnd.get("counts_manual") is False and bool(rnd.get("counts", True)) != entry["config"]["counts"]:
            out[rnd["id"]] = entry["config"]["counts"]
    return out


def round_rules(rules: dict, config: dict) -> dict:
    """Regeln eines Laufs: Punkteschema, Punkte trotz DNF und Bonus für die schnellste Runde der Vorgabe statt der Saison
    (``rules`` normalisiert). Ohne Abweichung kommt ``rules`` selbst zurück."""
    changes: dict = {}
    points = config.get("points", "series")
    if points != "series":
        changes["points_by_place"] = [] if points == "none" else list(points)
    dnf = config.get("dnf", "series")
    if dnf == "place":
        changes["dnf_points"] = None
    elif dnf == "none":
        changes["dnf_points"] = 0
    lap = config.get("fastest_lap")
    if lap is not None:
        bonuses = rules["bonuses"]
        changes["bonuses"] = {**bonuses, "fastest_lap": {**bonuses["fastest_lap"], "points": lap}}
    return {**rules, **changes} if changes else rules


def rules_for_round(series: dict, rounds: list[dict], round_doc: dict) -> dict:
    """Normalisierte Regeln für das Blatt eines Termins (Punkte je Lauf). Wirft ``ValueError`` wie
    ``normalize_rules``."""
    rules = normalize_rules(series.get("rules") or {})
    plan = round_plan([*[item for item in rounds if item.get("id") != round_doc.get("id")], round_doc],
                      series.get("weekend"))
    entry = plan.get(round_doc.get("id"))
    return round_rules(rules, entry["config"]) if entry else rules


# ---------------------------------------------------------------- Pole und Startplatz
def _valid_place(row: dict) -> int | None:
    try:
        place = int(row.get("place"))
    except (TypeError, ValueError):
        return None
    if place < 1 or not row.get("participant_id") or {"dns", "dsq"} & set(row.get("marks") or []):
        return None
    return place


def _pole(rows: list[dict]) -> tuple[str, int] | None:
    valid = [(place, row) for row in rows or [] if (place := _valid_place(row)) is not None]
    if not valid:
        return None
    place, row = min(valid, key=lambda item: item[0])
    return row["participant_id"], place


def pole_holder(rows: list[dict]) -> str | None:
    """Wer im Qualifying die Pole hat - überall dieselbe Regel: der erste gültige Platz (ohne Nichtstart und
    Disqualifikation; liegt Platz 1 disqualifiziert, ist es Platz 2). Eine Marke ``pole`` auf einer anderen Zeile zählt
    nicht."""
    pole = _pole(rows)
    return pole[0] if pole else None


def _clear_pole(rows: list[dict], holder: str | None) -> list[int]:
    """Die Marke ``pole`` fällt auf jeder Zeile außer der des Pole-Inhabers weg (an Ort und Stelle). Liefert die
    Zeilen (``index``), an denen sie wegfiel."""
    moved = []
    for row in rows:
        marks = row.get("marks") or []
        if "pole" in marks and not (holder and row.get("participant_id") == holder):
            row["marks"] = [mark for mark in marks if mark != "pole"]
            moved.append(row.get("index"))
    return sorted(index for index in moved if index is not None)


# Ein Qualifying, in dem kein Platz gültig ist (alle DNS/DSQ), hat keine Pole - eine Marke fällt trotzdem
# nicht still weg.
NO_POLE = "Kein gültiger Platz im Qualifying – Pole-Marke entfernt"


def _pole_moved(message: str, indexes: list[int]) -> list[dict]:
    return [{"code": "pole_moved", "message": message, "rows": indexes}] if indexes else []


def mark_pole(rows: list[dict]) -> list[dict]:
    """Haupt-Qualifying: die Pole (``pole_holder``) bekommt die Marke ``pole``; eine Marke auf einer anderen Zeile fällt
    weg, ohne gültigen Platz jede. ``rows`` wie aus ``series_results.resolve`` (an Ort und Stelle). Liefert den
    Prüfhinweis dazu (leer ohne)."""
    pole = _pole(rows)
    if not pole:
        return _pole_moved(NO_POLE, _clear_pole(rows, None))
    for row in rows:
        if row.get("participant_id") == pole[0] and "pole" not in (row.get("marks") or []):
            row["marks"] = sorted({*(row.get("marks") or []), "pole"})
    return _pole_moved(f"Pole hat Platz {pole[1]} – Marke entfernt", _clear_pole(rows, pole[0]))


def quali_pole(series: dict, rounds: list[dict], round_doc: dict,
               sheets: dict) -> tuple[str | None, int | None] | None:
    """Rennen oder Sprint einer Runde mit Läufen: Pole-Inhaber und sein Platz aus dem Haupt-Qualifying derselben Runde,
    aus dem der Lauf seinen Startplatz nimmt (``sheets``: veröffentlichte Blätter je Termin) - ``(None, None)``, wenn
    darin kein Platz gültig ist (dann hat niemand die Pole), ``None`` ohne ein solches Qualifying (etwa ein Rennen aus
    F1-Altdaten, ein Sprint aus dem Shootout oder ein Startplatz von Hand)."""
    weekend = series.get("weekend")
    rounds = [*[item for item in rounds if item.get("id") != round_doc.get("id")], round_doc]
    plan = round_plan(rounds, weekend)
    entry = plan.get(round_doc.get("id"))
    if not entry or entry["config"]["kind"] == "qualifying" or entry["config"]["grid"] != "qualifying":
        return None
    group = next(group for group in weekend_groups(rounds, weekend)
                 if any(rnd["id"] == round_doc["id"] for rnd in group["rounds"]))
    source = _quali_for(group["rounds"], round_doc, plan, sheets)
    if not source or not is_main_qualifying(source.get("session")):
        return None
    return _pole(sheets[source["id"]].get("rows") or []) or (None, None)


def clear_race_pole(rows: list[dict], pole: tuple[str | None, int | None] | None) -> list[dict]:
    """Blatt eines Rennens mit Haupt-Qualifying (``quali_pole``): eine Pole-Marke auf einer anderen Zeile als der des
    Pole-Inhabers fällt weg, ohne gültigen Platz im Qualifying jede - mit Prüfhinweis. Nur ohne Qualifying bleibt die
    Marke von Hand (Bestand #1927)."""
    if pole is None:
        return []
    holder, place = pole
    message = f"Pole hat Platz {place} im Qualifying – Marke entfernt" if holder else NO_POLE
    return _pole_moved(message, _clear_pole(rows, holder))


def _quali_for(sessions: list[dict], target: dict, plan: dict, sheets: dict) -> dict | None:
    """Woher ein Lauf seinen Startplatz nimmt: ein Sprint aus dem Shootout (Sprint-Qualifying) derselben Runde, wenn es
    einen gibt, sonst - wie das Rennen - aus dem Qualifying fürs Rennen."""
    usable = [rnd for rnd in sessions if plan[rnd["id"]]["config"]["kind"] == "qualifying" and rnd["id"] in sheets
              and rnd.get("status") != "cancelled"]
    main = [rnd for rnd in usable if is_main_qualifying(rnd.get("session"))]
    shootout = [rnd for rnd in usable if not is_main_qualifying(rnd.get("session"))]
    if plan[target["id"]]["config"]["kind"] == "sprint" and shootout:
        return shootout[0]
    return main[0] if main else None


def with_qualifying(rounds: list[dict], sheets: dict, plan: dict, weekend: dict | None = None) -> dict:
    """Blätter mit Startplatz und Pole aus dem Qualifying derselben Runde - nur, wo der Startplatz leer ist und der Lauf
    ihn aus dem Qualifying nimmt. Die Pole (nur aus dem Qualifying fürs Rennen, und nur wenn es selbst nicht zählt)
    zählt am ersten Rennen, das seinen Startplatz daraus nimmt, sonst am ersten Lauf; eine Pole-Marke von Hand auf
    einer anderen Zeile eines solchen Laufs fällt weg. Ändert nichts an ``sheets``."""
    out = dict(sheets)
    for group in weekend_groups(rounds, weekend):
        sessions = group["rounds"]
        targets = [rnd for rnd in sessions if rnd["id"] in out
                   and plan[rnd["id"]]["config"]["kind"] != "qualifying"
                   and plan[rnd["id"]]["config"]["grid"] == "qualifying"]
        sources = {rnd["id"]: _quali_for(sessions, rnd, plan, out) for rnd in targets}
        poled: dict[str, str] = {}
        for kind in ("race", "sprint"):
            for rnd in targets:
                source = sources[rnd["id"]]
                if (source and plan[rnd["id"]]["config"]["kind"] == kind and source["id"] not in poled.values()
                        and is_main_qualifying(source.get("session")) and source.get("counts") is False):
                    poled[rnd["id"]] = source["id"]
        for rnd in targets:
            source = sources[rnd["id"]]
            if not source:
                continue
            places = {row["participant_id"]: row["place"] for row in out[source["id"]].get("rows") or []
                      if row.get("participant_id") and row.get("place")}
            rows = out[rnd["id"]].get("rows") or []
            # Aus dem Haupt-Qualifying hat die Pole sein erster gültiger Platz - eine Marke von Hand auf einer anderen
            # Zeile des Laufs zählt nicht (Codex Runde 2). Der Shootout setzt keine Pole.
            # Ohne gültigen Platz im Qualifying hat niemand die Pole - auch keine Marke von Hand im Lauf.
            main = is_main_qualifying(source.get("session"))
            holder = pole_holder(out[source["id"]].get("rows") or []) if main else None
            pole = holder if rnd["id"] in poled else None
            out[rnd["id"]] = {**out[rnd["id"]], "rows": [_derived(row, places, pole, main, holder) for row in rows]}
    return out


def _derived(row: dict, places: dict, pole: str | None, main: bool = False, holder: str | None = None) -> dict:
    """Zeile eines Laufs mit Startplatz aus ``places`` (nur wo er leer ist) und der Pole ``pole``. Kommt der Startplatz
    aus dem Haupt-Qualifying (``main``), zählt eine Pole-Marke nur beim Pole-Inhaber ``holder``."""
    pid = row.get("participant_id")
    out = row
    if not row.get("grid") and pid in places:
        out = {**out, "grid": places[pid]}
    marks = row.get("marks") or []
    if main and "pole" in marks and not (holder and pid == holder):
        out = {**out, "marks": [mark for mark in marks if mark != "pole"]}
    if pole and pid == pole:
        out = {**out, "marks": sorted({*marks, "pole"})}
    return out


def with_reverse_grid(rounds: list[dict], sheets: dict, plan: dict, snapshots: list[dict],
                      weekend: dict | None = None) -> dict:
    """Blätter mit Startplatz in umgekehrter Reihenfolge der Fahrerwertung - wer hinten liegt, startet vorn. Je nach
    Vorgabe nach der letzten gewerteten Runde vor dieser Runde (``reverse_standings_before_round``) oder nach dem
    letzten gewerteten Lauf vor diesem (``reverse_standings_after_previous_session``, etwa nach dem Sprint). Wer dort
    nicht steht, bekommt keinen Startplatz; ein eingetragener bleibt. Ohne Änderung kommt ``sheets`` selbst zurück."""
    active = [rnd for rnd in ordered_rounds(rounds) if not rnd.get("archived_at")]
    position = {rnd["id"]: index for index, rnd in enumerate(active)}
    drivers = [snap for snap in snapshots if snap["scope"] == "drivers" and snap["round_id"] in position]
    out = None
    for group in weekend_groups(rounds, weekend):
        first = min(position[rnd["id"]] for rnd in group["rounds"])
        for rnd in group["rounds"]:
            config = plan[rnd["id"]]["config"]
            if rnd["id"] not in sheets or config["kind"] == "qualifying" or not config["grid"].startswith("reverse_"):
                continue
            limit = first if config["grid"] == REVERSE_BEFORE_ROUND else position[rnd["id"]]
            before = [snap for snap in drivers if position[snap["round_id"]] < limit]
            if not before:
                continue
            order = [row["participant_id"] for row in before[-1]["rows"]][::-1]
            sheet = (out or sheets)[rnd["id"]]
            rows = sheet.get("rows") or []
            present = {row.get("participant_id") for row in rows}
            grid: dict[str, int] = {}
            for pid in order:
                if pid in present:
                    grid[pid] = len(grid) + 1
            out = out if out is not None else dict(sheets)
            out[rnd["id"]] = {**sheet, "rows": [_derived(row, grid, None) for row in rows]}
    return sheets if out is None else out


def reverse_order(rows: list[dict], top: int | None = None) -> dict[str, int]:
    """Startplätze in umgekehrter Reihenfolge eines Laufs (#1960): die gültigen Plätze (ohne DNS/DSQ) umgedreht - mit
    ``top`` nur die ersten N, dahinter wie im Lauf; wer keinen gültigen Platz hat, startet dahinter (nach Platz, sonst
    nach Kennung). Kennung → Startplatz."""
    valid = sorted((place, row["participant_id"]) for row in rows or []
                   if (place := _valid_place(row)) is not None)
    order = [pid for _place, pid in valid]
    count = min(top, len(order)) if top else len(order)
    ranked = order[:count][::-1] + order[count:]
    seen = set(ranked)
    rest = sorted((row for row in rows or [] if row.get("participant_id") and row["participant_id"] not in seen),
                  key=lambda row: (_place_number(row), str(row["participant_id"])))
    ranked += [row["participant_id"] for row in rest]
    return {pid: index for index, pid in enumerate(ranked, start=1)}


def _place_number(row: dict) -> float:
    try:
        place = int(row.get("place"))
    except (TypeError, ValueError):
        return math.inf
    return place if place >= 1 else math.inf


def _session_source(sessions: list[dict], target: dict, plan: dict, sheets: dict) -> dict | None:
    """Woher ein umgekehrter Lauf seine Aufstellung nimmt: aus dem Haupt-Qualifying derselben Runde bzw. aus dem
    letzten Lauf davor mit Ergebnis (nicht abgesagt)."""
    usable = [rnd for rnd in sessions if rnd["id"] in sheets and rnd.get("status") != "cancelled"
              and rnd["id"] != target["id"]]
    if plan[target["id"]]["config"]["grid"] == REVERSE_QUALIFYING:
        return next((rnd for rnd in usable if plan[rnd["id"]]["config"]["kind"] == "qualifying"
                     and is_main_qualifying(rnd.get("session"))), None)
    before = [rnd for rnd in usable if sessions.index(rnd) < sessions.index(target)]
    return before[-1] if before else None


def _without_pole(row: dict) -> dict:
    marks = row.get("marks") or []
    return {**row, "marks": [mark for mark in marks if mark != "pole"]} if "pole" in marks else row


def with_session_reverse(rounds: list[dict], sheets: dict, plan: dict, weekend: dict | None = None) -> dict:
    """Blätter mit umgekehrter Startaufstellung aus einem Lauf derselben Runde (#1960, ``reverse_qualifying``,
    ``reverse_previous_session``): ein leerer Startplatz kommt aus ``reverse_order`` des Quell-Laufs, ein eingetragener
    bleibt. Ein solcher Lauf hat keine Pole - eine Marke von Hand fällt weg (die Pole bleibt beim Qualifying). Ohne
    Änderung kommt ``sheets`` selbst zurück."""
    out = None
    for group in weekend_groups(rounds, weekend):
        sessions = group["rounds"]
        for rnd in sessions:
            config = plan[rnd["id"]]["config"]
            if rnd["id"] not in sheets or config["grid"] not in SESSION_REVERSES:
                continue
            source = _session_source(sessions, rnd, plan, sheets)
            grid = reverse_order(sheets[source["id"]].get("rows") or [], config.get("reverse_top")) if source else {}
            out = out if out is not None else dict(sheets)
            out[rnd["id"]] = {**sheets[rnd["id"]], "rows": [_without_pole(_derived(row, grid, None))
                                                          for row in sheets[rnd["id"]].get("rows") or []]}
    return sheets if out is None else out


def reversed_grid(series: dict, rounds: list[dict], round_doc: dict) -> bool:
    """Nimmt der Lauf dieses Termins seine Aufstellung umgekehrt aus einem Lauf derselben Runde (#1960)?"""
    plan = round_plan([*[item for item in rounds if item.get("id") != round_doc.get("id")], round_doc],
                      series.get("weekend"))
    entry = plan.get(round_doc.get("id"))
    return bool(entry) and entry["config"]["grid"] in SESSION_REVERSES


REVERSED_NO_POLE = "Umgekehrte Startaufstellung – in diesem Lauf gibt es keine Pole, Marke entfernt"


def clear_reverse_pole(rows: list[dict]) -> list[dict]:
    """Blatt eines Laufs mit umgekehrter Aufstellung (#1960): jede Pole-Marke fällt weg - mit Prüfhinweis. Wer vorn
    startet, hat Startplatz 1, nicht die Pole."""
    return _pole_moved(REVERSED_NO_POLE, _clear_pole(rows, None))


def _pole_takers(rounds: list[dict], sheets: dict, plan: dict, weekend: dict | None) -> set[str]:
    """Die Haupt-Qualifyings, deren Pole ein Lauf mit Startplatz aus dem Qualifying übernimmt (wie in
    ``with_qualifying``)."""
    taken: set[str] = set()
    for group in weekend_groups(rounds, weekend):
        sessions = group["rounds"]
        for rnd in sessions:
            config = plan[rnd["id"]]["config"]
            if rnd["id"] in sheets and config["kind"] != "qualifying" and config["grid"] == "qualifying":
                source = _quali_for(sessions, rnd, plan, sheets)
                if source and is_main_qualifying(source.get("session")):
                    taken.add(source["id"])
    return taken


def pole_at_qualifying(rounds: list[dict], sheets: dict, plan: dict, rules: dict,
                       weekend: dict | None = None) -> dict[str, str]:
    """Pole-Bonus am Qualifying (#1960): übernimmt kein Lauf der Runde seinen Startplatz aus dem Haupt-Qualifying (etwa
    nur umgekehrte Aufstellungen), bleibt der Bonus der Saison beim Qualifying - auch wenn es sonst nicht zählt.
    Haupt-Qualifying → Pole-Inhaber; leer ohne Pole-Bonus der Saison."""
    if not (rules["bonuses"]["pole"]["points"] or 0):
        return {}
    taken = _pole_takers(rounds, sheets, plan, weekend)
    out = {}
    for rnd in rounds:
        config = (plan.get(rnd.get("id")) or {}).get("config") or {}
        if (rnd["id"] in sheets and rnd["id"] not in taken and config.get("kind") == "qualifying"
                and is_main_qualifying(rnd.get("session")) and rnd.get("counts") is False
                and rnd.get("status") != "cancelled"):
            holder = pole_holder(sheets[rnd["id"]].get("rows") or [])
            if holder:
                out[rnd["id"]] = holder
    return out


def standings(*, rules: dict, rounds: list[dict], sheets: dict, participants: list[dict], own_teams=(),
              weekend: dict | None = None, adjustments=None) -> list[dict]:
    """Die Stände wie ``compute_standings``, mit Punkten je Lauf, Startplatz und Pole aus dem Qualifying und der
    umgekehrten Wertung als Startplatz. Mit Läufen zählt eine Runde als Einheit (``units``): Aktivitätspunkte, gefahrene
    Runden und Streichergebnisse je Runde, nicht je Lauf. Der Startplatz ändert keine Punkte - die umgekehrte Wertung
    kommt darum aus dem ersten Durchgang."""
    plan = round_plan(rounds, weekend)
    base = normalize_rules(rules)
    per_round = {rid: own for rid, entry in plan.items()
                 if (own := round_rules(base, entry["config"])) is not base}
    units = {rid: entry["unit"] for rid, entry in plan.items()} if by_code(rounds, weekend) else None
    enriched = with_session_reverse(rounds, with_qualifying(rounds, sheets, plan, weekend), plan, weekend)
    # Pole-Bonus am Qualifying (#1960): das Qualifying zählt dann nur mit diesem Bonus - ohne Plätze, die bei Siegen oder
    # Gleichstand mitzählen würden. Gespeichert wird davon nichts im Blatt.
    poles = pole_at_qualifying(rounds, sheets, plan, base, weekend)
    if poles:
        rounds = [{**rnd, "counts": True} if rnd.get("id") in poles else rnd for rnd in rounds]
        bonus = {**base["bonuses"], "fastest_lap": {"points": 0, "max_place": None},
                 "pole": {**base["bonuses"]["pole"], "max_place": None}}
        for quali_id, holder in poles.items():
            enriched = {**enriched, quali_id: {"rows": [{"participant_id": holder, "place": None, "marks": ["pole"]}]}}
            per_round[quali_id] = {**base, "points_by_place": [], "bonuses": bonus}
    common = {"rules": rules, "rounds": rounds, "participants": participants, "own_teams": own_teams,
              "round_rules": per_round, "units": units, "adjustments": adjustments}
    snapshots = compute_standings(sheets=enriched, **common)
    reversed_grid = with_reverse_grid(rounds, enriched, plan, snapshots, weekend)
    if reversed_grid is not enriched:
        snapshots = compute_standings(sheets=reversed_grid, **common)
    return snapshots
