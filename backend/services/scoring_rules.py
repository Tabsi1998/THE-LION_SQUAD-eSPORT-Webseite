"""Rechenregeln für Wertungen (#1741) - ohne Datenbank, gemeinsam für externe Serien und das spätere Ligasystem (#1625).

Eine Serie trägt ihre Regeln als Daten (kopiert aus einer Punkteschema-Vorlage, je Serie änderbar). ``normalize_rules``
füllt fehlende Werte mit Standards und weist Unsinn ab; alle anderen Funktionen rechnen nur mit normalisierten Regeln.

- **Punkte je Platz** (``points_by_place``, Platz 1 zuerst; dahinter 0) oder ``points_mode="organizer"``: die Punkte
  stehen wie beim Veranstalter in der Zeile. Eine Zeile mit ``points_source="manual"`` behält ihre Punkte immer.
- **Marken:** ``dns`` (Nichtstart: ``dns_points``, gilt nicht als Teilnahme), ``dsq`` (``dsq_points``), ``dnf``
  (``dnf_points``; ``None`` heißt Punkte nach Platz), ``fastest_lap`` und ``pole`` als Bonus bis ``max_place``.
  Strafpunkte (``penalty_points``) werden abgezogen - außer bei Punkten laut Veranstalter oder von Hand, die gelten
  wie eingetragen. Strafpunkte sind nie negativ: ``validate_sheet`` lehnt solche Blätter ab, ``result_points`` zählt
  einen negativen Wert als keine Strafe.
- **Was zählt:** alle Runden, die besten N (``best_n``) oder alle bis auf N Streichergebnisse (``drop_n``). ``drop_n``
  heißt: von allen Runden des Kalenders (ohne abgesagte) zählen die besten ``Runden - N`` - wer weniger Ergebnisse
  hat, dem zählt alles. So fällt nie mitten in der Saison plötzlich etwas weg, und am Ende sind es genau N.
- **Vorrang bei Gleichstand** (``tiebreakers``): ``wins``, ``podiums``, ``countback`` (mehr Siege, dann mehr zweite
  Plätze …), ``best_place`` und ``latest_result`` (besseres Ergebnis in der letzten gemeinsamen Runde, dann davor).
  Entscheidet keines, teilen sich beide den Platz (``rank_with_ties``: 1, 2, 2, 4).
- **Team-Liga:** Punkte für Sieg, Unentschieden und Niederlage (``match_points``) statt fest 3/1/0, Tabelle mit
  ``table_tiebreakers`` (``score_diff``, ``score_for``, ``wins``).
- **Turniertage (#1961):** ``day_rounds`` - Runden innerhalb eines Termins (``count`` Spalten R1…Rn als Vorgabe,
  0 = aus, und ihr Punkteschema, Vorgabe 8…1), ``custom_bonuses`` - eigene Sonderboni je Saison (Name und Punkte, etwa
  „Bingo 3P“), ``tiebreak_top_n`` - das N der Gleichstand-Regel ``top_n`` („mehr Plätze unter den besten N“).
  Gerechnet wird damit in ``services/tournament_days.py``.
- **Teamwertung einer Rennliga** (#1960): ``team_scoring.mode`` - ``per_race`` (je Rennen für das gefahrene Team) oder
  ``current_lineup`` (aktuelle Besetzung: alle Saisonpunkte der Fahrer, die jetzt im Team sind); ``no_team_names``
  (Vorgabe „Ersatzfahrer“): Teamnamen, die für kein Team zählen; ``adjustments_count_for_team`` (#2000, Vorgabe aus):
  Vorgabe des Hakens „zählt auch für die Teamwertung“ an neuen Fahrer-Anpassungen. ``min_participants``:
  Mindestzahl am Start je Termin - darunter warnt das Eintragen.
"""
from __future__ import annotations

import math
from typing import Callable

from services.fastlap_standings import DEFAULT_POINTS
from services.series_identity import normalize_name

POINTS_MODES = ("scheme", "organizer")
COUNT_MODES = ("all", "best_n", "drop_n")
TIEBREAKERS = ("wins", "top_n", "podiums", "countback", "best_place", "latest_result")
TABLE_TIEBREAKERS = ("score_diff", "score_for", "wins")
MARKS = ("dnf", "dns", "dsq", "fastest_lap", "pole", "left")
BONUS_MARKS = ("fastest_lap", "pole")
POINT_SOURCES = ("scheme", "organizer", "manual")
MAX_DAY_ROUNDS = 20
MAX_DAY_ROUND_PLACES = 100
MAX_CUSTOM_BONUSES = 10
MAX_BONUS_LABEL = 40
MAX_BONUS_KEY = 30
MAX_TOP_N = 64  # N der Gleichstand-Regel „Top N“ (#1961): 1 bis 64
# Teamwertung (#1960): je Rennen für das gefahrene Team (Vorgabe) oder die aktuelle Besetzung mit allen Saisonpunkten.
TEAM_MODES = ("per_race", "current_lineup")

DEFAULT_RULES: dict = {
    "points_mode": "scheme",
    "points_by_place": list(DEFAULT_POINTS),
    "bonuses": {"fastest_lap": {"points": 0, "max_place": None}, "pole": {"points": 0, "max_place": None}},
    "dnf_points": 0,
    "dns_points": 0,
    "dsq_points": 0,
    "count_mode": "all",
    "count_n": 0,
    "activity_points": {"points": 0, "from_round": 1},
    "final_top_n": None,
    "tiebreakers": ["countback", "latest_result"],
    # #1960: ``no_team_names`` - Team-Bezeichnungen, die „kein Team bzw. Ersatz“ heißen: so eine Fahrt zählt für kein
    # Team (auch nicht fürs Stammteam) und steht nicht als eigene Zeile in der Teamwertung.
    # #2000: ``adjustments_count_for_team`` - Vorgabe des Hakens „zählt auch für die Teamwertung“ an neuen
    # Fahrer-Anpassungen.
    "team_scoring": {"enabled": False, "counting_drivers": None, "guests_count": True, "mode": "per_race",
                     "no_team_names": ["Ersatzfahrer"], "adjustments_count_for_team": False},
    # Mindestzahl Teilnehmer je Termin (#1960): darunter warnt das Eintragen - der Termin bleibt dann ohne Wertung.
    "min_participants": None,
    "match_points": {"win": 3, "draw": 1, "loss": 0},
    "table_tiebreakers": ["score_diff", "score_for"],
    # Turniertage (#1961): aus, bis eine Saison Runden je Termin führt; Rundenpunkte Vorgabe 8…1.
    "day_rounds": {"count": 0, "points_by_place": [8, 7, 6, 5, 4, 3, 2, 1]},
    "custom_bonuses": [],
    "tiebreak_top_n": 4,
}


# ---------------------------------------------------------------- Regeln
def _number(value, field: str, *, allow_none: bool = False, minimum: float | None = None) -> float | None:
    if value is None or value == "":
        if allow_none:
            return None
        raise ValueError(f"{field}: Zahl fehlt.")
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError(f"{field}: keine Zahl.")
    try:
        number = float(value)
    except ValueError as exc:
        raise ValueError(f"{field}: keine Zahl.") from exc
    if not math.isfinite(number):
        raise ValueError(f"{field}: keine endliche Zahl.")
    if minimum is not None and number < minimum:
        raise ValueError(f"{field}: mindestens {minimum:g}.")
    return int(number) if number.is_integer() else number


def _whole(value, field: str, *, allow_none: bool = False, minimum: int = 0) -> int | None:
    number = _number(value, field, allow_none=allow_none, minimum=minimum)
    if number is None:
        return None
    if not float(number).is_integer():
        raise ValueError(f"{field}: ganze Zahl erwartet.")
    return int(number)


def _choice(value, field: str, allowed: tuple[str, ...]) -> str:
    if value not in allowed:
        raise ValueError(f"{field}: unbekannter Wert.")
    return value


def _criteria(value, field: str, allowed: tuple[str, ...]) -> list[str]:
    if not isinstance(value, (list, tuple)):
        raise ValueError(f"{field}: Liste erwartet.")
    out: list[str] = []
    for item in value:
        _choice(item, field, allowed)
        if item not in out:
            out.append(item)
    return out


MAX_NO_TEAM_NAMES = 20


def _team_names(value, field: str) -> list[str]:
    """Liste von Teamnamen: getrimmt, jeder einmal (Groß/klein egal), höchstens ``MAX_NO_TEAM_NAMES`` mit je 120
    Zeichen. ``None`` heißt die Vorgabe, eine leere Liste keine."""
    if value is None:
        return list(DEFAULT_RULES["team_scoring"]["no_team_names"])
    if not isinstance(value, (list, tuple)):
        raise ValueError(f"{field}: Liste erwartet.")
    out: list[str] = []
    for item in value:
        name = " ".join(str(item or "").split())
        if not name or name.casefold() in {seen.casefold() for seen in out}:
            continue
        if len(name) > 120:
            raise ValueError(f"{field}: höchstens 120 Zeichen je Name.")
        out.append(name)
    if len(out) > MAX_NO_TEAM_NAMES:
        raise ValueError(f"{field}: höchstens {MAX_NO_TEAM_NAMES} Namen.")
    return out


def is_no_team(name, rules: dict) -> bool:
    """Heißt dieses Team „kein Team bzw. Ersatz“ (``team_scoring.no_team_names``, Groß/klein und Leerraum egal)?"""
    key = " ".join(str(name or "").split()).casefold()
    return bool(key) and key in {" ".join(item.split()).casefold() for item in rules["team_scoring"]["no_team_names"]}


def normalize_rules(raw: dict | None) -> dict:
    """Vollständige Regeln mit Standards. Wirft ``ValueError`` mit einer Meldung je Feld."""
    raw = dict(raw or {})
    rules = {key: raw.get(key, DEFAULT_RULES[key]) for key in DEFAULT_RULES}
    rules["points_mode"] = _choice(rules["points_mode"], "points_mode", POINTS_MODES)
    scheme = rules["points_by_place"]
    if not isinstance(scheme, (list, tuple)):
        raise ValueError("points_by_place: Liste erwartet.")
    rules["points_by_place"] = [_number(value, "points_by_place", minimum=0) for value in scheme]

    bonuses = {**DEFAULT_RULES["bonuses"], **(raw.get("bonuses") or {})}
    rules["bonuses"] = {}
    for mark in BONUS_MARKS:
        bonus = {**DEFAULT_RULES["bonuses"][mark], **(bonuses.get(mark) or {})}
        rules["bonuses"][mark] = {
            "points": _number(bonus.get("points"), f"bonuses.{mark}.points", minimum=0),
            "max_place": _whole(bonus.get("max_place"), f"bonuses.{mark}.max_place", allow_none=True, minimum=1),
        }
    rules["dnf_points"] = _number(rules["dnf_points"], "dnf_points", allow_none=True)
    rules["dns_points"] = _number(rules["dns_points"], "dns_points")
    rules["dsq_points"] = _number(rules["dsq_points"], "dsq_points")

    rules["count_mode"] = _choice(rules["count_mode"], "count_mode", COUNT_MODES)
    rules["count_n"] = _whole(rules["count_n"], "count_n", minimum=0)
    if rules["count_mode"] == "best_n" and rules["count_n"] < 1:
        raise ValueError("count_n: für „beste N“ mindestens 1.")

    activity = {**DEFAULT_RULES["activity_points"], **(raw.get("activity_points") or {})}
    rules["activity_points"] = {
        "points": _number(activity.get("points"), "activity_points.points", minimum=0),
        "from_round": _whole(activity.get("from_round"), "activity_points.from_round", minimum=1),
    }
    rules["final_top_n"] = _whole(rules["final_top_n"], "final_top_n", allow_none=True, minimum=1)
    rules["tiebreakers"] = _criteria(rules["tiebreakers"], "tiebreakers", TIEBREAKERS)

    team = {**DEFAULT_RULES["team_scoring"], **(raw.get("team_scoring") or {})}
    rules["team_scoring"] = {
        "enabled": bool(team.get("enabled")),
        "counting_drivers": _whole(team.get("counting_drivers"), "team_scoring.counting_drivers",
                                   allow_none=True, minimum=1),
        "guests_count": bool(team.get("guests_count")),
        "mode": _choice(team.get("mode") or "per_race", "team_scoring.mode", TEAM_MODES),
        "no_team_names": _team_names(team.get("no_team_names"), "team_scoring.no_team_names"),
        "adjustments_count_for_team": bool(team.get("adjustments_count_for_team")),
    }
    rules["min_participants"] = _whole(rules["min_participants"], "min_participants", allow_none=True, minimum=1)
    points = {**DEFAULT_RULES["match_points"], **(raw.get("match_points") or {})}
    rules["match_points"] = {key: _number(points.get(key), f"match_points.{key}") for key in ("win", "draw", "loss")}
    rules["table_tiebreakers"] = _criteria(rules["table_tiebreakers"], "table_tiebreakers", TABLE_TIEBREAKERS)
    rules["day_rounds"] = _day_rounds(raw.get("day_rounds"))
    rules["custom_bonuses"] = _custom_bonuses(raw.get("custom_bonuses"))
    rules["tiebreak_top_n"] = _whole(rules["tiebreak_top_n"], "tiebreak_top_n", minimum=1)
    if rules["tiebreak_top_n"] > MAX_TOP_N:
        raise ValueError(f"tiebreak_top_n: höchstens {MAX_TOP_N}.")
    return rules


def _day_rounds(value) -> dict:
    """Runden je Termin (#1961): Zahl der Spalten (0 = aus) und Punkte je Platz in der Runde (Platz 1 zuerst)."""
    if value is not None and not isinstance(value, dict):
        raise ValueError("day_rounds: Angaben fehlen.")
    raw = {**DEFAULT_RULES["day_rounds"], **(value or {})}
    count = _whole(raw.get("count"), "day_rounds.count", allow_none=True, minimum=0) or 0
    if count > MAX_DAY_ROUNDS:
        raise ValueError(f"day_rounds.count: höchstens {MAX_DAY_ROUNDS} Runden.")
    scheme = raw.get("points_by_place")
    if not isinstance(scheme, (list, tuple)):
        raise ValueError("day_rounds.points_by_place: Liste erwartet.")
    if len(scheme) > MAX_DAY_ROUND_PLACES:
        raise ValueError(f"day_rounds.points_by_place: höchstens {MAX_DAY_ROUND_PLACES} Plätze.")
    return {"count": count,
            "points_by_place": [_number(item, "day_rounds.points_by_place", minimum=0) for item in scheme]}


def bonus_key(value) -> str:
    """Kennung eines Sonderbonus aus seinem Namen: nur Buchstaben und Ziffern, klein („Bingo!“ → „bingo“)."""
    return normalize_name(value)[:MAX_BONUS_KEY]


def _custom_bonuses(value) -> list[dict]:
    """Eigene Sonderboni je Saison (#1961): ``[{key, label, points}]`` - Name frei, Punkte ab 0, jeder nur einmal. Die
    Kennung bleibt, wenn der Name sich ändert; ohne Kennung kommt sie aus dem Namen."""
    if value in (None, ""):
        return []
    if not isinstance(value, (list, tuple)):
        raise ValueError("custom_bonuses: Liste erwartet.")
    if len(value) > MAX_CUSTOM_BONUSES:
        raise ValueError(f"custom_bonuses: höchstens {MAX_CUSTOM_BONUSES} Boni.")
    out: list[dict] = []
    for index, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"custom_bonuses: Bonus {index} ohne Angaben.")
        label = " ".join(str(item.get("label") or "").split())
        if len(label) > MAX_BONUS_LABEL:
            raise ValueError(f"custom_bonuses: Name von Bonus {index} höchstens {MAX_BONUS_LABEL} Zeichen.")
        key = bonus_key(item.get("key") or label)
        if not label or not key:
            raise ValueError(f"custom_bonuses: Bonus {index} braucht einen Namen mit Buchstaben oder Ziffern.")
        if any(entry["key"] == key for entry in out):
            raise ValueError(f"custom_bonuses: „{label}“ steht doppelt.")
        out.append({"key": key, "label": label,
                    "points": _number(item.get("points"), f"custom_bonuses.{index}.points", minimum=0)})
    return out


# ---------------------------------------------------------------- Rang
def rank_with_ties(rows: list[dict], key: Callable[[dict], object]) -> None:
    """Wettbewerbsrang (#1593): wer in jedem Kriterium gleich steht, teilt den Platz - 1, 2, 2, 4.

    Sortiert ``rows`` an Ort und Stelle (größerer Schlüssel zuerst, bei Gleichstand stabil) und setzt ``rank``.
    Sonst hinge der Platz an der Reihenfolge der Anmeldungen, und Podest und Pfeile wären zufällig.
    """
    rows.sort(key=key, reverse=True)
    previous = None
    rank = 0
    for index, row in enumerate(rows, start=1):
        value = key(row)
        if value != previous:
            rank = index
            previous = value
        row["rank"] = rank


# ---------------------------------------------------------------- Punkte einer Zeile
def place_points(place, points_by_place: list) -> float:
    """Punkte für einen Platz; ohne Platz oder hinter dem Schema 0."""
    try:
        position = int(place)
    except (TypeError, ValueError):
        return 0
    if position < 1 or position > len(points_by_place):
        return 0
    return points_by_place[position - 1]


def _place(row: dict) -> int | None:
    try:
        value = int(row.get("place"))
    except (TypeError, ValueError):
        return None
    return value if value >= 1 else None


def _given_points(row: dict) -> float:
    try:
        value = float(row.get("points") or 0)
    except (TypeError, ValueError):
        return 0
    if not math.isfinite(value):
        return 0
    return int(value) if value.is_integer() else value


def validate_sheet(sheet: dict, round_id: str) -> None:
    """Prüft ein Ergebnisblatt vor dem Rechnen; wirft ``ValueError`` mit der Runde und dem Grund. Strafpunkte sind nie
    negativ, und jeder Teilnehmer steht höchstens einmal im Blatt - sonst hinge an der Reihenfolge, welche Zeile
    zählt."""
    seen: set[str] = set()
    for row in sheet.get("rows") or []:
        pid = row.get("participant_id")
        if pid in seen:
            raise ValueError(f"Runde {round_id}: Teilnehmer {pid} steht mehrfach im Ergebnisblatt.")
        if pid:
            seen.add(pid)
        penalty = row.get("penalty_points")
        if penalty is not None and (_number(penalty, "penalty_points") or 0) < 0:
            raise ValueError(f"Runde {round_id}: Strafpunkte dürfen nicht negativ sein ({row.get('participant_id')}).")


def result_points(row: dict, rules: dict) -> dict:
    """Punkte einer Zeile mit Herkunft: ``points`` = ``base`` + ``bonus`` - ``penalty``.

    ``participated`` ist falsch nur beim Nichtstart - für Aktivitätspunkte und die Zahl der gefahrenen Runden."""
    marks = set(row.get("marks") or [])
    place = _place(row)
    participated = "dns" not in marks
    if not participated:
        return _scored(rules["dns_points"], 0, 0, "scheme", participated)
    if rules["points_mode"] == "organizer":
        return _scored(_given_points(row), 0, 0, "organizer", participated)
    if row.get("points_source") == "manual" and row.get("points") is not None:
        return _scored(_given_points(row), 0, 0, "manual", participated)
    # Strafpunkte ziehen nur ab: ein negativer Wert (Tippfehler, alter Stand) zählt als keine Strafe.
    penalty = max(_number(row.get("penalty_points") or 0, "penalty_points") or 0, 0)
    if "dsq" in marks:
        return _scored(rules["dsq_points"], 0, penalty, "scheme", participated)
    if "dnf" in marks and rules["dnf_points"] is not None:
        base = rules["dnf_points"]
    else:
        base = place_points(place, rules["points_by_place"])
    bonus = 0
    for mark in BONUS_MARKS:
        config = rules["bonuses"][mark]
        in_range = config["max_place"] is None or (place and place <= config["max_place"])
        if mark in marks and config["points"] and in_range:
            bonus += config["points"]
    return _scored(base, bonus, penalty, "scheme", participated)


def _scored(base, bonus, penalty, source: str, participated: bool) -> dict:
    total = base + bonus - penalty
    if isinstance(total, float) and total.is_integer():
        total = int(total)
    return {"points": total, "base": base, "bonus": bonus, "penalty": penalty, "source": source,
            "participated": participated}


# ---------------------------------------------------------------- Was zählt
def counted_results(results: list[dict], rules: dict, total_rounds: int) -> tuple[list[str], list[str]]:
    """Welche Runden zählen und welche gestrichen sind - je als Kennungen in Kalender-Reihenfolge.

    ``results``: ``{"round_id", "seq", "points"}`` je Runde mit Ergebnis. ``total_rounds``: Runden des Kalenders ohne
    abgesagte (für ``drop_n``). Bei gleichen Punkten bleibt die frühere Runde."""
    mode, n = rules["count_mode"], rules["count_n"]
    if mode == "best_n":
        keep = n
    elif mode == "drop_n":
        keep = max(total_rounds - n, 1)
    else:
        keep = len(results)
    ordered = sorted(results, key=lambda item: (-item["points"], item["seq"]))

    def by_seq(items: list[dict]) -> list[str]:
        return [item["round_id"] for item in sorted(items, key=lambda item: item["seq"])]

    return by_seq(ordered[:keep]), by_seq(ordered[keep:])


# ---------------------------------------------------------------- Team-Liga
def match_points(score_for, score_against, rules: dict) -> tuple[str, float]:
    """Ausgang und Punkte eines Spiels aus eigener Sicht: ``("win" | "draw" | "loss", Punkte)``."""
    outcome = "win" if score_for > score_against else "loss" if score_for < score_against else "draw"
    return outcome, rules["match_points"][outcome]


def _score(value) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    return int(number) if number.is_integer() else number


def league_table(matches: list[dict], rules: dict) -> list[dict]:
    """Tabelle aus Spielen ``{"home", "away", "home_score", "away_score"}`` - Punkte nach ``match_points``, Vorrang nach
    ``table_tiebreakers``, sonst geteilter Platz. Reihenfolge gleichrangiger Teams: nach Namen."""
    stats: dict[str, dict] = {}

    def row(team: str) -> dict:
        return stats.setdefault(team, {"team": team, "played": 0, "won": 0, "drawn": 0, "lost": 0,
                                       "score_for": 0, "score_against": 0, "points": 0})

    for match in matches:
        home, away = str(match.get("home") or "").strip(), str(match.get("away") or "").strip()
        if not home or not away:
            continue
        home_score, away_score = _score(match.get("home_score")), _score(match.get("away_score"))
        for team, own, other in ((home, home_score, away_score), (away, away_score, home_score)):
            outcome, points = match_points(own, other, rules)
            entry = row(team)
            entry["played"] += 1
            entry[{"win": "won", "draw": "drawn", "loss": "lost"}[outcome]] += 1
            entry["score_for"] += own
            entry["score_against"] += other
            entry["points"] += points
    rows = sorted(stats.values(), key=lambda item: item["team"].casefold())
    for entry in rows:
        entry["score_diff"] = entry["score_for"] - entry["score_against"]
    criteria = rules["table_tiebreakers"]
    field = {"score_diff": "score_diff", "score_for": "score_for", "wins": "won"}
    rank_with_ties(rows, lambda item: (item["points"], *(item[field[name]] for name in criteria)))
    return rows
