"""Die Spieldauer eines Spiels - eine Funktion für das ganze Backend (#1552, #1554).

Reihenfolge: Spiel → Spiel.settings → Phase → Turnier → Game (Dauer je Modus) → 30 Minuten.

Die Ebene „Game“ (#1554) gilt nur, wenn Spiel, Phase und Turnier nichts sagen:
- Modus: der der Phase (``settings.game_mode``), sonst der des Turniers (``game_mode``), sonst der erste Modus des Games.
- Ist die Dauer des Modus pro Einzelspiel angegeben (``per_game``), zählt Best-of als Erwartungswert:
  Mitte aus kürzestem und längstem Verlauf, ``(N + N//2 + 1) / 2`` - Bo1 = 1, Bo3 = 2,5, Bo5 = 4, Bo7 = 5,5 Spiele.
  Minuten = aufgerundet(Erwartung × Minuten je Spiel). Best-of kommt vom Spiel, der Phase oder dem Turnier
  (wie bei der Ergebnisprüfung), sonst 1. Die Best-of-Vorgabe des Games füllt nur das Turnierformular vor.
- Dazu kommt die Aufbau-/Wechselzeit des Games (``setup_minutes``), einmal je Spiel.
Ein Wert an Turnier, Phase oder Spiel ist immer die ganze Dauer - ohne Multiplikation und ohne Aufbauzeit.

Bewusst ohne Importe aus dem Rest des Backends: Generatoren, Planer, Routen und Anzeigen rufen diese Funktion,
und ein Wächtertest (``test_match_duration_unit``) hält neue Kopien der Kette fern. Erzeugte Spiele und Phasen
bekommen keine Dauer mehr hineinkopiert, damit eine Änderung am Turnier oder Game sofort wirkt.
Dieselbe Regel steht für die Website in ``frontend/src/lib/matchDuration.js``.
"""
from __future__ import annotations

import math

DEFAULT_MATCH_DURATION_MINUTES = 30
# Was die Kette vom Game braucht - für Abfragen mit Projektion.
GAME_DURATION_FIELDS = ("id", "match_modes", "setup_minutes")


def _minutes(value) -> int | None:
    """Eine brauchbare Minutenzahl, sonst None - damit die nächste Ebene drankommt."""
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        return None
    return minutes if minutes >= 1 else None


def _settings(doc: dict | None) -> dict:
    settings = (doc or {}).get("settings")
    return settings if isinstance(settings, dict) else {}


def expected_games(best_of) -> float:
    """Wie viele Einzelspiele ein Best-of im Mittel dauert: Mitte aus kürzestem (N//2+1) und längstem Verlauf (N)."""
    count = _minutes(best_of) or 1
    return (count + count // 2 + 1) / 2


def _best_of(match: dict | None, stage: dict | None, tournament: dict | None) -> int:
    for value in ((match or {}).get("best_of"), _settings(match).get("best_of"), _settings(stage).get("best_of"),
                  (tournament or {}).get("best_of")):
        if _minutes(value) is not None:
            return _minutes(value)
    return 1


def game_modes(game: dict | None) -> list[dict]:
    """Die Modi eines Games - Kaputtes fällt still heraus."""
    modes = (game or {}).get("match_modes")
    if not isinstance(modes, list):
        return []
    return [mode for mode in modes if isinstance(mode, dict)]


def game_mode(game: dict | None, *, stage: dict | None = None, tournament: dict | None = None) -> dict | None:
    """Der Modus, der gilt: der der Phase, sonst der des Turniers, sonst der erste. Unbekannte Kennung → erster."""
    modes = game_modes(game)
    if not modes:
        return None
    wanted = _settings(stage).get("game_mode") or (tournament or {}).get("game_mode")
    if wanted:
        for mode in modes:
            if mode.get("mode") == wanted:
                return mode
    return modes[0]


def game_duration(game: dict | None, *, match: dict | None = None, stage: dict | None = None,
                  tournament: dict | None = None) -> int | None:
    """Die Dauer, die das Game für dieses Spiel vorgibt - None, wenn es keine brauchbare kennt."""
    mode = game_mode(game, stage=stage, tournament=tournament)
    minutes = _minutes((mode or {}).get("minutes"))
    if minutes is None:
        return None
    if mode.get("per_game"):
        minutes = math.ceil(expected_games(_best_of(match, stage, tournament)) * minutes)
    setup = (game or {}).get("setup_minutes")
    if not isinstance(setup, bool) and isinstance(setup, (int, float)) and setup > 0:
        minutes += int(setup)
    return minutes


def effective_match_duration(match: dict | None = None, *, stage: dict | None = None, tournament: dict | None = None,
                             game: dict | None = None, updates: dict | None = None,
                             default: int = DEFAULT_MATCH_DURATION_MINUTES) -> int:
    """Wie lange dieses Spiel geplant wird, in Minuten.

    ``updates`` sind Änderungen, die gerade gespeichert werden: steht dort ``duration_minutes``, zählt das -
    auch leer (dann gilt wieder die Kette darunter, nicht der alte Wert am Spiel). ``game`` ist das Game des
    Turniers (mindestens ``GAME_DURATION_FIELDS``), siehe ``load_duration_game``.
    """
    match = match or {}
    if updates is not None and "duration_minutes" in updates:
        own = _minutes(updates.get("duration_minutes"))
    else:
        own = _minutes(match.get("duration_minutes"))
    for candidate in (
        own,
        _minutes(_settings(match).get("duration_minutes")),
        _minutes(_settings(stage).get("duration_minutes")),
        _minutes((tournament or {}).get("match_duration_minutes")),
        game_duration(game, match=match, stage=stage, tournament=tournament),
    ):
        if candidate is not None:
            return candidate
    return max(1, int(default))


def with_effective_durations(matches, *, stages=(), tournament: dict | None = None, game: dict | None = None) -> list:
    """Schreibt je Spiel ``effective_duration_minutes`` in eine Antwort (nie in die Datenbank) - für App und TV, die die
    Kette nicht selbst rechnen. Die Website rechnet mit ``lib/matchDuration.js`` und ``duration_game``."""
    stage_by_id = {(stage or {}).get("id"): stage for stage in stages or [] if isinstance(stage, dict)}
    for match in matches or []:
        if isinstance(match, dict):
            match["effective_duration_minutes"] = effective_match_duration(
                match, stage=stage_by_id.get(match.get("stage_id")), tournament=tournament, game=game)
    return matches


async def load_duration_games(db, tournaments, extra: tuple[str, ...] = ()) -> dict[str, dict]:
    """Die Games mehrerer Turniere in einer Abfrage, nach Kennung - für Aufrufer, die viele Turniere planen.
    ``extra``: weitere Felder des Games, die der Aufrufer braucht (der Planer etwa ``station_devices``)."""
    ids = sorted({(tournament or {}).get("game_id") for tournament in tournaments or [] if (tournament or {}).get("game_id")})
    if not ids:
        return {}
    projection = {"_id": 0, **{field: 1 for field in (*GAME_DURATION_FIELDS, *extra)}}
    rows = await db.games.find({"id": {"$in": ids}}, projection).to_list(len(ids) + 5)
    return {row["id"]: row for row in rows if row.get("id")}


async def load_duration_game(db, tournament: dict | None, extra: tuple[str, ...] = ()) -> dict | None:
    """Das Game eines Turniers mit den Feldern, die die Kette braucht - None ohne Game."""
    return (await load_duration_games(db, [tournament], extra)).get((tournament or {}).get("game_id") or "")
