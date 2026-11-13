"""Gesamtwertung über Seasons (F.5, #2215, docs/LIGA.md „F.5 Gesamtwertung über Seasons“): die reinen Regeln.

Blatt-Modul ohne Datenbank: Einstellungen prüfen, Punkte je Platz einer Staffel (Nr. 171), welche Seasons zählen (Nr. 173) und die
Reihenfolge mit Entscheid der Leitung. ``league_overall`` holt die Endstände und ruft diese Rechnung - Verwaltung, Ligaseite, Profil und
Teamseite lesen damit dieselbe Zahl.
"""
from __future__ import annotations

from models import new_id

POINTS_MODES = {"teams": "Nach Teamzahl: Platz 1 bekommt so viele Punkte, wie die Staffel Teams hat, der Letzte 1",
                "table": "Eigene Punkte je Platz"}
COUNTING = {"all": "Alle Seasons des Zeitraums", "best": "Nur die besten Seasons"}
TIEBREAKERS = {"wins": "Mehr Staffelsiege", "best_place": "Bessere beste Platzierung", "latest": "Mehr Punkte in der jüngsten Season"}
DEFAULT_TIEBREAKERS = ["wins", "best_place", "latest"]
DEFAULTS = {"points_mode": "teams", "points_table": [], "champion_bonus": 2, "counting": "all", "best_count": None,
            "tiebreakers": DEFAULT_TIEBREAKERS, "reward_players": "fielded", "rewards": [], "periods": []}
METHODS = {"playoff": "Entscheidungsspiel", "lot": "Los", "lead": "Entscheid der Leitung"}

TABLE_MAX, POINTS_MAX, BONUS_MAX = 32, 999, 99
BEST_MAX, PERIOD_LIMIT, PERIOD_NAME_MAX = 50, 20, 60


class OverallProblem(ValueError):
    """Eine Anfrage, die nicht passt - mit deutscher Meldung und HTTP-Status."""

    def __init__(self, message: str, status: int = 422, *, blockers: list[dict] | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.blockers = blockers or []


# ---------------------------------------------------------------- Einstellungen

def settings_of(league: dict | None) -> dict:
    """Was an der Liga gilt - fehlende Felder mit Vorgabe. ``None`` heißt hier nie „keine Gesamtwertung“, das sagt ``enabled``."""
    raw = (league or {}).get("overall") if isinstance((league or {}).get("overall"), dict) else {}
    out = {**DEFAULTS, **{key: value for key, value in raw.items() if key in DEFAULTS and value is not None}}
    if out["points_mode"] not in POINTS_MODES:
        out["points_mode"] = DEFAULTS["points_mode"]
    if out["counting"] not in COUNTING:
        out["counting"] = DEFAULTS["counting"]
    out["tiebreakers"] = [key for key in out.get("tiebreakers") or [] if key in TIEBREAKERS]
    out["periods"] = [row for row in out.get("periods") or [] if isinstance(row, dict) and row.get("id")]
    return out


def enabled(league: dict | None) -> bool:
    """Gibt es an dieser Liga eine Gesamtwertung? Nur mit mindestens einem Zeitraum (Altdaten: nein)."""
    return bool(settings_of(league)["periods"])


def period_of(league: dict | None, season_id: str | None) -> dict | None:
    """Der Zeitraum, zu dem diese Season gehört - höchstens einer je Liga."""
    if not season_id:
        return None
    return next((row for row in settings_of(league)["periods"] if season_id in (row.get("season_ids") or [])), None)


def _whole(value, what: str, low: int, high: int) -> int:
    if isinstance(value, str) and value.strip().isdigit():
        value = int(value.strip())
    if isinstance(value, bool) or not isinstance(value, int):
        raise OverallProblem(f"{what}: bitte eine ganze Zahl angeben.")
    number = value
    if number < low or number > high:
        raise OverallProblem(f"{what}: bitte eine Zahl von {low} bis {high} angeben.")
    return number


def clean_points(body: dict, current: dict) -> dict:
    """Punkte, Zählen und Reihenfolge geprüft (fehlt ein Feld, bleibt es, wie es ist)."""
    out: dict = {}
    mode = body.get("points_mode", current["points_mode"])
    if mode not in POINTS_MODES:
        raise OverallProblem("Punkte: nach Teamzahl oder eigene Punkte je Platz.")
    out["points_mode"] = mode
    table = body.get("points_table", current["points_table"]) or []
    if not isinstance(table, list) or len(table) > TABLE_MAX:
        raise OverallProblem(f"Eigene Punkte: höchstens {TABLE_MAX} Plätze.")
    out["points_table"] = [_whole(value, f"Punkte für Platz {index}", 0, POINTS_MAX) for index, value in enumerate(table, start=1)]
    if mode == "table" and not out["points_table"]:
        raise OverallProblem("Eigene Punkte je Platz: bitte mindestens Platz 1 angeben.")
    out["champion_bonus"] = _whole(body.get("champion_bonus", current["champion_bonus"]), "Zusatzpunkte für Platz 1", 0, BONUS_MAX)
    counting = body.get("counting", current["counting"])
    if counting not in COUNTING:
        raise OverallProblem("Welche Seasons zählen: alle oder nur die besten.")
    out["counting"] = counting
    best = body.get("best_count", current["best_count"])
    out["best_count"] = _whole(best, "Wie viele Seasons zählen", 1, BEST_MAX) if counting == "best" else None
    tiebreakers = body.get("tiebreakers", current["tiebreakers"])
    if not isinstance(tiebreakers, list) or any(key not in TIEBREAKERS for key in tiebreakers):
        raise OverallProblem("Reihenfolge bei Gleichstand: nur Staffelsiege, beste Platzierung und jüngste Season.")
    if len(set(tiebreakers)) != len(tiebreakers):
        raise OverallProblem("Reihenfolge bei Gleichstand: jedes Kriterium nur einmal.")
    out["tiebreakers"] = list(tiebreakers)
    basis = body.get("reward_players", current["reward_players"]) or "fielded"
    if basis not in ("fielded", "roster"):
        raise OverallProblem("Spieler-Belohnungen gehen an Spieler mit Einsatz oder an den ganzen Kader.")
    out["reward_players"] = basis
    return out


def clean_periods(rows, current: list[dict], season_ids: set[str], season_names: dict[str, str], locked: set[str]) -> list[dict]:
    """Die Zeiträume geprüft. ``season_ids``: die Seasons der Liga; ``locked``: Zeiträume mit abgeschlossener Liga N - deren Seasons
    bleiben, und sie lassen sich nicht löschen."""
    rows = list(rows or [])
    if len(rows) > PERIOD_LIMIT:
        raise OverallProblem(f"Höchstens {PERIOD_LIMIT} Zeiträume.")
    known = {row["id"]: row for row in current}
    out: list[dict] = []
    owner: dict[str, str] = {}
    for raw in rows:
        raw = raw if isinstance(raw, dict) else {}
        name = " ".join(str(raw.get("name") or "").split())[:PERIOD_NAME_MAX]
        if not name:
            raise OverallProblem("Jeder Zeitraum braucht einen Namen, z. B. „2027“ oder „Seasons 1–4“.")
        period_id = str(raw.get("id") or "")
        period_id = period_id if period_id in known else new_id()
        wanted = []
        for season_id in raw.get("season_ids") or []:
            season_id = str(season_id)
            if season_id not in season_ids:
                raise OverallProblem(f"„{name}“: Diese Season gehört nicht zur Liga.")
            if season_id in owner:
                raise OverallProblem(f"„{season_names.get(season_id) or 'Eine Season'}“ steht schon im Zeitraum „{owner[season_id]}“ - "
                                     "eine Season gehört zu höchstens einem Zeitraum.")
            if season_id not in wanted:
                wanted.append(season_id)
                owner[season_id] = name
        if period_id in locked and sorted(wanted) != sorted(known[period_id].get("season_ids") or []):
            raise OverallProblem(f"„{name}“ ist abgeschlossen: Die Seasons ändern sich erst nach „Wieder öffnen“ im Reiter „Abschluss“.", 409)
        out.append({"id": period_id, "name": name, "season_ids": wanted})
    missing = sorted(set(locked) - {row["id"] for row in out})
    if missing:
        raise OverallProblem(f"„{known[missing[0]].get('name') or 'Der Zeitraum'}“ ist abgeschlossen und lässt sich nicht löschen. Erst im Reiter "
                             "„Abschluss“ wieder öffnen.", 409)
    return out


# ---------------------------------------------------------------- Punkte je Staffel (Nr. 171)

def _rank(row: dict) -> int | None:
    value = row.get("rank")
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def staffel_points(rows: list[dict], settings: dict) -> dict[str, dict]:
    """Je Anmeldung des Endstands die Punkte für die Gesamtwertung. Gezählt werden die Teams in der Wertung (ohne ``exit``); ihr Platz
    ist 1 + die Zahl der Teams in der Wertung mit besserem Platz (Ausgeschiedene schieben niemanden nach hinten). N = diese Zahl - je
    Staffel. Geteilter Platz: dieselben Punkte. Ausgeschiedene und Disqualifizierte: 0."""
    active = [row for row in rows if row.get("registration_id") and not row.get("exit") and _rank(row)]
    size = len(active)
    out: dict[str, dict] = {}
    for row in rows:
        registration_id = row.get("registration_id")
        if not registration_id:
            continue
        if row.get("exit") or not _rank(row):
            out[registration_id] = {"points": 0, "place": None, "of": size, "champion": False,
                                    "exit": (row.get("exit") or {}).get("kind") if isinstance(row.get("exit"), dict) else ("exit" if row.get("exit") else None)}
            continue
        place = 1 + sum(1 for other in active if _rank(other) < _rank(row))
        if settings["points_mode"] == "table":
            table = settings.get("points_table") or []
            base = table[place - 1] if place <= len(table) else 0
        else:
            base = size - place + 1
        champion = place == 1
        out[registration_id] = {"points": int(base) + (int(settings.get("champion_bonus") or 0) if champion else 0), "place": place, "of": size,
                                "champion": champion, "exit": None}
    return out


# ---------------------------------------------------------------- Zählen und Reihenfolge (Nr. 173)

def mark_counted(seasons: dict[str, dict], order: list[str], settings: dict) -> int:
    """Setzt ``counted`` je Season-Eintrag und gibt die Summe zurück. ``best``: die besten X, bei gleichen Punkten die frühere Season."""
    position = {season_id: index for index, season_id in enumerate(order)}
    keys = sorted(seasons, key=lambda key: (-int(seasons[key].get("points") or 0), position.get(key, 999)))
    limit = settings.get("best_count") if settings.get("counting") == "best" else None
    for index, key in enumerate(keys):
        seasons[key]["counted"] = limit is None or index < limit
    return sum(int(entry.get("points") or 0) for entry in seasons.values() if entry.get("counted"))


def _criteria(row: dict, tiebreakers: list[str], order: list[str]) -> tuple:
    seasons = row["seasons"]
    newest = order[-1] if order else None
    values = []
    for key in tiebreakers:
        if key == "wins":
            values.append(-sum(1 for entry in seasons.values() if entry.get("place") == 1))
        elif key == "best_place":
            places = [entry["place"] for entry in seasons.values() if isinstance(entry.get("place"), int)]
            values.append(min(places) if places else 999)
        elif key == "latest":
            # Wer in der jüngsten Season des Zeitraums nicht gespielt hat, hat dort 0.
            values.append(-int((seasons.get(newest) or {}).get("points") or 0) if newest else 0)
    return tuple(values)


def rank(entries: dict[str, dict], settings: dict, order: list[str], decisions: list[dict] | None = None) -> list[dict]:
    """Die Reihenfolge der Gesamtwertung. ``entries``: je Schlüssel ``{name, …, seasons: {season_id: {points, place, …}}}``; ``order``:
    die Seasons des Zeitraums von alt nach neu. Summe, dann die Kriterien der Liga, dann ein Entscheid der Leitung (nur wenn genau diese
    Gruppe gleich steht), sonst ein geteilter Platz. Gibt die Zeilen mit ``place``, ``total`` und ``tie`` zurück."""
    rows = []
    for key, entry in entries.items():
        seasons = {season_id: dict(value) for season_id, value in (entry.get("seasons") or {}).items()}
        total = mark_counted(seasons, order, settings)
        rows.append({**entry, "key": key, "seasons": seasons, "total": total,
                     "wins": sum(1 for value in seasons.values() if value.get("place") == 1),
                     "best_place": min((value["place"] for value in seasons.values() if isinstance(value.get("place"), int)), default=None)})
    tiebreakers = settings.get("tiebreakers") or []

    def sort_key(row: dict) -> tuple:
        return (-row["total"], *_criteria(row, tiebreakers, order))

    rows.sort(key=lambda row: (sort_key(row), str(row.get("name") or "").casefold(), row["key"]))
    out: list[dict] = []
    index = 0
    while index < len(rows):
        group = [rows[index]]
        while index + len(group) < len(rows) and sort_key(rows[index + len(group)]) == sort_key(group[0]):
            group.append(rows[index + len(group)])
        place = index + 1
        decision = None
        if len(group) > 1:
            wanted = {row["key"] for row in group}
            decision = next((item for item in decisions or [] if set(item.get("keys") or []) == wanted), None)
        if decision:
            position = {key: at for at, key in enumerate(decision["keys"])}
            for at, row in enumerate(sorted(group, key=lambda row: position[row["key"]])):
                out.append({**row, "place": place + at, "tie": False,
                            "lead_decision": {"id": decision.get("id"), "reason": decision.get("reason"), "method": decision.get("method"),
                                              "method_label": METHODS.get(decision.get("method") or "")}})
        else:
            for row in group:
                out.append({**row, "place": place, "tie": len(group) > 1, "lead_decision": None})
        index += len(group)
    return out


def ties(rows: list[dict]) -> list[dict]:
    """Gleichstände, die die Leitung entscheiden kann - je Platz die Co-Teams."""
    groups: dict[int, list[dict]] = {}
    for row in rows:
        if row.get("tie"):
            groups.setdefault(row["place"], []).append(row)
    return [{"place": place, "keys": [row["key"] for row in group], "names": [row.get("name") or "Team" for row in group],
             "total": group[0]["total"]} for place, group in sorted(groups.items())]


def public_settings(settings: dict) -> dict:
    """Was die Ligaseite über die Rechnung sagt - für die Zeile unter der Tabelle."""
    return {"points_mode": settings["points_mode"], "points_mode_label": POINTS_MODES[settings["points_mode"]],
            "points_table": list(settings.get("points_table") or []), "champion_bonus": settings.get("champion_bonus") or 0,
            "counting": settings["counting"], "best_count": settings.get("best_count"),
            "tiebreakers": [{"key": key, "label": TIEBREAKERS[key]} for key in settings.get("tiebreakers") or []]}
