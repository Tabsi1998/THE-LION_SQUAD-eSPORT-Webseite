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
  Fahrerwertung vor der Runde). Ein Qualifying zählt nicht - außer es hat eine eigene Liste (etwa P1 = 2 Punkte)
  oder ``counts`` sagt es ausdrücklich.
- **Einfügen:** „R1S“, „R1 S“, „R1-Sprint“, „R1 Sprint“ → Kürzel R1, Lauf Sprint (``take_code``); eine Zeile ohne Lauf
  legt alle Läufe der Vorgabe an (``race_weekend_paste.expand_paste``), eine Zeile mit Lauf nur diesen.
- **Rechnen** (``standings``): je Lauf das eigene Punkteschema; ein leerer Startplatz kommt aus dem Qualifying bzw. der
  umgekehrten Wertung (eingetragene Werte, etwa nach Strafen, bleiben); die Pole des Qualifyings (Platz 1, im Blatt als
  Marke ``pole`` gesetzt - ``mark_pole``) zählt am ersten Rennen der Runde, das seinen Startplatz aus diesem
  Qualifying nimmt - so zählt ein Pole-Bonus wie bisher am Rennen. Zählt das Qualifying selbst, bleibt die Pole dort.
"""
from __future__ import annotations

import math

from services.round_phases import normalize_phases, phase_for
from services.scoring_rules import normalize_rules
from services.series_standings import compute_standings, ordered_rounds

MAX_SESSION = 30
MAX_SESSIONS = 6
MAX_POINTS = 100
OFFSET_RANGE = (-24 * 60, 7 * 24 * 60)
SESSION_CHOICES = ("Qualifying", "Shootout", "Sprint", "Rennen", "Hauptrennen", "Lauf 1", "Lauf 2")
# Allgemeine Namen eines Laufs: beim Einfügen gilt der Lauf derselben Art aus der Vorgabe („R1 Feature“ → Hauptrennen).
GENERIC_LABELS = ("Qualifying", "Sprint", "Rennen")
KINDS = ("qualifying", "sprint", "race")
GRID_SOURCES = ("manual", "qualifying", "reverse_standings")
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
def _boundary(raw: str, pos: int) -> bool:
    return pos >= len(raw) or raw[pos].isspace() or raw[pos] in _SEPARATORS


def _session_word(raw: str, pos: int) -> tuple[str | None, int]:
    """Ein Lauf-Wort ab ``pos`` (ganzes Wort): Lauf und Ende - sonst ``(None, pos)``."""
    end = pos
    while end < len(raw) and raw[end] in _LETTERS:
        end += 1
    word = raw[pos:end].casefold()
    if not word:
        return None, pos
    if word in HEAT_WORDS:
        digit = end + 1 if end < len(raw) and raw[end].isspace() else end
        if digit < len(raw) and raw[digit] in _DIGITS and _boundary(raw, digit + 1):
            return f"Lauf {raw[digit]}", digit + 1
    if word in SESSION_WORDS and _boundary(raw, end):
        return SESSION_WORDS[word], end
    return None, pos


def take_code(text: str) -> tuple[str | None, str | None, str]:
    """Kürzel und Lauf am Anfang einer Zeile: ``(Kürzel, Lauf, Rest)`` - ohne Kürzel ``(None, None, text)``.

    Kürzel wie bisher: bis sechs Buchstaben, optional ein Leerzeichen, bis drei Ziffern („R1“, „ST 5“) oder nur Ziffern,
    optional mit Punkt. Neu dahinter ein Lauf, angehängt („R1S“, „R1Q“, „R1-Sprint“) oder als eigenes Wort („R1 S“,
    „R1 Quali“, „R1 Lauf 2“). Hängt etwas anderes am Kürzel („R1x“), ist es wie bisher kein Kürzel. Zeichen für Zeichen,
    ohne regulären Ausdruck auf der Eingabe."""
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
        while after < len(raw) and raw[after].isspace():
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


def weekend_groups(rounds: list[dict]) -> list[dict]:
    """Die Runden der Saison in Kalender-Reihenfolge (ohne archivierte Termine): ``{"key", "number", "rounds"}``."""
    groups: list[dict] = []
    by_key: dict[str, dict] = {}
    for rnd in ordered_rounds(rounds):
        if rnd.get("archived_at"):
            continue
        key = weekend_key(rnd)
        group = by_key.get(key) if key else None
        if group is None:
            group = {"key": key, "number": len(groups) + 1, "rounds": []}
            groups.append(group)
            if key:
                by_key[key] = group
        group["rounds"].append(rnd)
    return groups


def annotate(rounds: list[dict]) -> list[dict]:
    """Kalender-Termine mit Runde (``weekend``) und Art des Laufs (``session_kind``) - an Ort und Stelle."""
    numbers = {rnd["id"]: group["number"] for group in weekend_groups(rounds) for rnd in group["rounds"]}
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
    return {
        "label": label,
        "offset": _whole(raw.get("offset"), f"{field}: Versatz in Minuten", *OFFSET_RANGE, 0),
        "counts": default_counts if counts is None else bool(counts),
        "points": points,
        "dnf": dnf,
        "fastest_lap": lap,
        "grid": grid,
    }


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
    return {"sessions": out}


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
    groups = weekend_groups(rounds)
    number = next((group["number"] for group in groups if key and group["key"] == key), len(groups) + 1)
    return session_config(weekend, number, label)


def round_plan(rounds: list[dict], weekend: dict | None) -> dict[str, dict]:
    """Je Termin (ohne archivierte) die Runde und die Vorgabe seines Laufs."""
    plan = {}
    for group in weekend_groups(rounds):
        for rnd in group["rounds"]:
            plan[rnd["id"]] = {"number": group["number"],
                               "config": session_config(weekend, group["number"], rnd.get("session"))}
    return plan


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
def mark_pole(rows: list[dict]) -> None:
    """Qualifying: Platz 1 bekommt die Marke ``pole`` - außer eine Zeile trägt sie schon. ``rows`` wie aus
    ``series_results.resolve`` (an Ort und Stelle)."""
    named = [row for row in rows if row.get("participant_id")]
    if any("pole" in (row.get("marks") or []) for row in named):
        return
    first = next((row for row in named if row.get("place") == 1
                  and not {"dns", "dsq"} & set(row.get("marks") or [])), None)
    if first:
        first["marks"] = sorted({*(first.get("marks") or []), "pole"})


def _pole_of(sheet: dict) -> str | None:
    rows = [row for row in sheet.get("rows") or [] if row.get("participant_id")]
    marked = next((row["participant_id"] for row in rows if "pole" in (row.get("marks") or [])), None)
    return marked or next((row["participant_id"] for row in rows if row.get("place") == 1), None)


def _quali_for(sessions: list[dict], index: int, plan: dict, sheets: dict) -> dict | None:
    qualis = [(position, rnd) for position, rnd in enumerate(sessions)
              if plan[rnd["id"]]["config"]["kind"] == "qualifying" and rnd["id"] in sheets
              and rnd.get("status") != "cancelled"]
    before = [rnd for position, rnd in qualis if position < index]
    if before:
        return before[-1]
    return qualis[0][1] if qualis else None


def with_qualifying(rounds: list[dict], sheets: dict, plan: dict) -> dict:
    """Blätter mit Startplatz und Pole aus dem Qualifying derselben Runde - nur, wo der Startplatz leer ist und
    der Lauf ihn aus dem Qualifying nimmt. Ändert nichts an ``sheets``."""
    out = dict(sheets)
    poled: set[str] = set()
    for group in weekend_groups(rounds):
        sessions = group["rounds"]
        for index, rnd in enumerate(sessions):
            config = plan[rnd["id"]]["config"]
            if config["kind"] == "qualifying" or config["grid"] != "qualifying" or rnd["id"] not in out:
                continue
            source = _quali_for(sessions, index, plan, out)
            if not source:
                continue
            places = {row["participant_id"]: row["place"] for row in out[source["id"]].get("rows") or []
                      if row.get("participant_id") and row.get("place")}
            sheet = out[rnd["id"]]
            rows = sheet.get("rows") or []
            pole = None
            # Die Pole kommt nur aus dem Qualifying fürs Rennen (nicht aus dem Shootout) und wandert nur, wenn das
            # Qualifying selbst nicht zählt - sonst steht sie schon dort.
            main = is_main_qualifying(source.get("session"))
            if main and source.get("counts") is False and source["id"] not in poled:
                poled.add(source["id"])
                if not any("pole" in (row.get("marks") or []) for row in rows):
                    pole = _pole_of(out[source["id"]])
            out[rnd["id"]] = {**sheet, "rows": [_derived(row, places, pole) for row in rows]}
    return out


def _derived(row: dict, places: dict, pole: str | None) -> dict:
    pid = row.get("participant_id")
    out = row
    if not row.get("grid") and pid in places:
        out = {**out, "grid": places[pid]}
    if pole and pid == pole:
        out = {**out, "marks": sorted({*(row.get("marks") or []), "pole"})}
    return out


def with_reverse_grid(rounds: list[dict], sheets: dict, plan: dict, snapshots: list[dict]) -> dict:
    """Blätter mit Startplatz in umgekehrter Reihenfolge der Fahrerwertung nach der letzten gewerteten Runde davor -
    wer hinten liegt, startet vorn. Wer dort nicht steht, bekommt keinen Startplatz; ein eingetragener
    bleibt. Ohne Änderung kommt ``sheets`` selbst zurück."""
    groups = weekend_groups(rounds)
    active = [rnd for rnd in ordered_rounds(rounds) if not rnd.get("archived_at")]
    position = {rnd["id"]: index for index, rnd in enumerate(active)}
    drivers = [snap for snap in snapshots if snap["scope"] == "drivers" and snap["round_id"] in position]
    out = None
    for group in groups:
        targets = [rnd for rnd in group["rounds"] if rnd["id"] in sheets
                   and plan[rnd["id"]]["config"]["kind"] != "qualifying"
                   and plan[rnd["id"]]["config"]["grid"] == "reverse_standings"]
        if not targets:
            continue
        first = min(position[rnd["id"]] for rnd in group["rounds"])
        before = [snap for snap in drivers if position[snap["round_id"]] < first]
        if not before:
            continue
        order = [row["participant_id"] for row in before[-1]["rows"]][::-1]
        for rnd in targets:
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


def standings(*, rules: dict, rounds: list[dict], sheets: dict, participants: list[dict], own_teams=(),
              weekend: dict | None = None) -> list[dict]:
    """Die Stände wie ``compute_standings``, mit Punkten je Lauf, Startplatz und Pole aus dem Qualifying und der
    umgekehrten Wertung als Startplatz. Der Startplatz ändert keine Punkte - die umgekehrte Wertung kommt darum aus dem
    ersten Durchgang."""
    plan = round_plan(rounds, weekend)
    base = normalize_rules(rules)
    per_round = {rid: own for rid, entry in plan.items()
                 if (own := round_rules(base, entry["config"])) is not base}
    enriched = with_qualifying(rounds, sheets, plan)
    common = {"rules": rules, "rounds": rounds, "participants": participants, "own_teams": own_teams,
              "round_rules": per_round}
    snapshots = compute_standings(sheets=enriched, **common)
    reversed_grid = with_reverse_grid(rounds, enriched, plan, snapshots)
    if reversed_grid is not enriched:
        snapshots = compute_standings(sheets=reversed_grid, **common)
    return snapshots
