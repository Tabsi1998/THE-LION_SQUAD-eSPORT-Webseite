"""Liga-Rahmen (docs/LIGA.md, P1): Liga (je Spiel) → Season → Liga N → Staffel A/B.

Die Liga-Schicht ist dünn: ``leagues``, ``league_seasons`` und ``league_divisions`` tragen Namen, Vorgaben und
Sichtbarkeit. Gespielt wird in einer **Staffel**, und die ist ein gewöhnliches Turnier (``format="league"``) mit
``league_context``. Beim Anlegen kopiert dieser Service die geltenden Vorgaben der Season (und die Abweichungen der
Liga N, ``overrides``) in das Turnier - der Turnierkern liest danach nur das Turnier, nie die Season.

Spätere Änderungen an der Season wirken erst über „Vorgaben auf Staffeln übertragen“ (``sync_staffel``), mit den Grenzen
aus Abschnitt 3: Termine und Kalender nur vor dem Start, Best of/Teamgröße/Punkte nur vor dem ersten Ergebnis,
Sichtbarkeit und Regeltext immer.

Fehler sind ``LeagueProblem`` mit deutscher Meldung und HTTP-Status; die Routen in ``routes/league_routes.py`` machen
daraus die Antwort.
"""
from __future__ import annotations

import copy
from contextlib import AsyncExitStack
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from pymongo.errors import DuplicateKeyError

from models import TournamentCreate, new_id, now_utc
from services import (game_maps, game_modes, game_usage, league_games, league_look, league_platform, league_pool_check,
                      league_result_rules, loadout_bans, map_pools, pricing, staffel_guard)
from services.league_rules_store import delete_drafts, deletion_blockers, staffel_rules
from services.advancement_draw import sync_advancement_fields
from services.bracket_fill_in import has_started, is_auto_bye
from services.competition_versions import new_competition_version_fields
from services.league_presets import INCIDENT_FIELDS
from services.league_scope import ONLY_LEAGUE
from services import checkin_rules, league_protest_settings, league_reminder_rules, league_veto_rules
from services.league_schedule import DEFAULTS as SCHEDULE_RULE_DEFAULTS
from services.league_schedule import public_rules as schedule_public_rules
from services.log_safe import log_safe
from services.mutation_lock import (MutationLockBusy, league_resource, league_season_pool_resource, league_season_resource,
                                    mutation_lock, tournament_write_resource)
from services.tournament_purge import purge_tournament
# Runden ≤ aktive Wochen steht im Blatt-Modul (auch für Spielplan und Turnierstart) und wird hier weitergereicht.
from services.league_rounds import max_teams_for, rounds_needed, rounds_problem  # noqa: F401
from services.scoring_rules import LEAGUE_TABLE_DEFAULTS, division_rules, league_default_rules, maps_mode, normalize_rules
from services.slug_utils import slugify, unique_slug

# Spielwochen und Zeitzone stehen im Blatt-Modul (auch für Aufbewahrung und Sperren, E.3) und werden hier weitergereicht.
from services.league_calendar import VIENNA, aware as _aware, local_day as _local_day, week_days  # noqa: E402, F401

# Vorgaben einer neuen Season (docs/LIGA.md, Abschnitt 2 und 3).
SEASON_DEFAULTS: dict = {
    "weeks_total": 10,
    "blocked_periods": [],
    "matchday_days": 7,
    "default_match_weekday": 6,
    "default_match_time": "20:00",
    "round_robin_legs": 1,
    "max_staffel_size": 8,
    "best_of": 3,
    "team_size": 4,
    "min_squad_size": None,  # = team_size
    "game_mode_order": [],
    # Map-Wiederholung in einer Serie (#2096): "never" jede Map einmal, "other_mode" dieselbe Map nur in anderem
    # Modus, "always" frei.
    "map_repeat": "other_mode",
    "scoring_rules": None,  # = normalize_rules({})
    "result_confirm_hours": 48,
    "lineup_amend_hours": 48,
    # Antwortfrist auf Terminvorschläge (#2106, F3) - vorher je Staffel, Vorgabe wie bei jedem Turnier 72 h.
    "match_schedule_response_hours": 72,
    "rules_text": None,
    "registration_deadline": None,
    "visibility": "off",
    "status": "draft",
    # Startseite (#2324): in „Nächste Termine“ und als Hinweis bei offener Anmeldung - Vorgabe an, je Season abschaltbar.
    "promote_on_home": True,
}
# Spielberechtigung (#2204, docs/LIGA.md Abschnitt 12): Vorgaben nur für **neue** Seasons. Seasons von vorher tragen die Felder nicht
# und prüfen nichts Neues - darum stehen sie nicht in SEASON_DEFAULTS, die jeder Lesevorgang darüberlegt.
SEASON_RULE_DEFAULTS: dict = {
    "max_squad_size": 50,
    "one_team_per_season": True,
    "new_player_wait_days": 7,
    "transfer_windows": [],
    "min_age": 18,
    "unique_game_ids": True,
    "lineup_mode": "series",
    "lineup_min_players": 3,
    # Selbstanmeldung (#2205): Vorgaben der Regeln. Ohne Fenster gibt es sie gar nicht.
    "entry_policy": "all",
    "sibling_squads_in_staffel": False,
    "application_waitlist": True,
    # Anmeldungen automatisch annehmen (#2348): aus = die Leitung prüft jede Anmeldung. Fehlt das Feld (ältere Seasons), gilt dasselbe.
    "application_auto_accept": False,
}
# Selbstanmeldung (#2205): Leer heißt: gibt es nicht - darum dürfen die Felder auch wieder leer werden.
APPLICATION_TIMES = ("application_opens_at", "application_closes_at")
APPLICATION_TEXTS = ("application_waitlist_note", "application_privacy_text")
APPLICATION_OPTIONAL = (*APPLICATION_TIMES, *APPLICATION_TEXTS, "application_slots", "application_waitlist_limit")
NEW_SEASON_MIN_SQUAD = 3
SERIES = "series"
# Mindestgröße je Modus (#2207, C.2): nur an der Season, fehlt = abgeleitet (``league_pool_check``).
POOL_MIN_MAPS = "pool_min_maps"
POOL_MIN_MAPS_MAX = 50
# Vorfälle im Spiel (D.5, #1619): fünf einfache Werte an der Season, ohne Feld gilt die Vorgabe (``league_presets``).
SEASON_FIELDS = (tuple(SEASON_DEFAULTS) + tuple(SEASON_RULE_DEFAULTS) + APPLICATION_OPTIONAL
                 + ("name", "slug", "number", "start_date", POOL_MIN_MAPS) + INCIDENT_FIELDS)
OVERRIDE_FIELDS = ("best_of", "team_size", "min_squad_size", "max_staffel_size", "scoring_rules",
                   "match_schedule_response_hours")
# Seasons von vor #2106 tragen keine Antwortfrist: dann behält jede Staffel ihre eigene (``staffel_fields``).
RESPONSE_HOURS = "match_schedule_response_hours"
# Ergebnisregeln (C.3, #1617): gepflegt über …/result-rules, nicht über das Season-Formular; gelten nur für neue Eingaben.
RESULT_RULE_FIELDS = ("result_rules", "scores_required",
                      # Einstellungen und Regeltext je Modus (#2271): dieselbe Kopie, dieselbe Gruppe.
                      "mode_settings")
# Ab hier hat eine Staffel begonnen: Termine und Kalender bleiben dann, wie sie sind.
PRE_START_STATUSES = frozenset({"draft", "scheduled", "registration_open", "registration_closed", "check_in"})
# Sichtbarkeit der Season → Sichtbarkeit der Staffel-Turniere (docs/LIGA.md, Abschnitt 10).
STAFFEL_VISIBILITY = {
    "off": ("internal", False),
    "admins": ("internal", False),
    "members": ("members", True),
    "public": ("public", True),
}
RESERVED_SLUGS = frozenset({"admin", "neu", "new", "regeln"})
STAFFEL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


class LeagueProblem(ValueError):
    """Eine Eingabe, die nicht passt - mit deutscher Meldung und HTTP-Status (Vorgabe 422)."""

    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


def _now() -> str:
    return now_utc().isoformat()


def _text(value) -> str | None:
    text = " ".join(str(value or "").split())
    return text or None


async def _look(db, body: dict, fields: tuple[str, ...]) -> dict:
    """Die Gestaltung (#2107) aus ``body`` geprüft - Bilder nur aus der eigenen Mediathek."""
    try:
        out = league_look.clean(body, fields)
        await league_look.check_uploaded(db, out)
    except league_look.LookProblem as problem:
        raise LeagueProblem(problem.message) from None
    return out


# ---------------------------------------------------------------- Kalender

def blocked_weeks(season: dict) -> list[int]:
    """Die gesperrten Spielwochen (1-basiert): eine Woche ist gesperrt, wenn mehr als die Hälfte ihrer Tage in einer
    Sperrzeit liegt. Die Weihnachtspause 21.12.–3.1. sperrt in Season 1 so die Wochen 22.–28.12. und 29.12.–4.1.;
    der Montag 21.12. allein sperrt die Woche 15.–21.12. nicht (Terminvorschläge an dem Tag lehnt die Sperrzeit selbst
    ab)."""
    periods = []
    for period in season.get("blocked_periods") or []:
        try:
            periods.append((date.fromisoformat(period["start_date"]), date.fromisoformat(period["end_date"])))
        except (KeyError, TypeError, ValueError):
            continue
    out: list[int] = []
    for number, (first, last) in enumerate(week_days(season), start=1):
        total = (last - first).days + 1
        blocked = sum(1 for offset in range(total)
                      if any(start <= first + timedelta(days=offset) <= end for start, end in periods))
        if blocked * 2 > total:
            out.append(number)
    return out


def season_end(season: dict) -> str | None:
    """Ende der letzten Spielwoche: deren letzter Tag 23:59:59 Wien, als UTC."""
    weeks = week_days(season)
    if not weeks:
        return None
    last = weeks[-1][1]
    local = datetime(last.year, last.month, last.day, 23, 59, 59, tzinfo=VIENNA)
    return local.astimezone(timezone.utc).isoformat()


def calendar_summary(season: dict, settings: dict | None = None) -> dict:
    """Was die Verwaltung zum Kalender sieht: Wochen, Sperrwochen, aktive Wochen, größte Staffel."""
    settings = settings or season
    blocked = blocked_weeks(season)
    active = int(season.get("weeks_total") or 0) - len(blocked)
    legs = int(season.get("round_robin_legs") or 1)
    weeks = [{"number": number, "start_day": first.isoformat(), "end_day": last.isoformat(),
              "blocked": number in blocked}
             for number, (first, last) in enumerate(week_days(season), start=1)]
    return {"weeks": weeks, "blocked_weeks": blocked, "active_weeks": active,
            "max_teams_per_staffel": max_teams_for(active, legs), "end_date": season_end(season),
            "rounds_needed": rounds_needed(int(settings.get("max_staffel_size") or 0), legs)}


# ---------------------------------------------------------------- Prüfen und Vorgaben

def _scoring(raw) -> dict:
    try:
        return normalize_rules(raw or {})
    except ValueError as exc:
        raise LeagueProblem(f"Punkte und Gleichstand: {exc}") from None


def _mode_order(game: dict | None, order, saved=None) -> list[str]:
    """Die Reihenfolge der Modi. ``saved``: was die Season schon hat - ein Modus, der dem Spiel inzwischen entfernt wurde
    (#2129), hält kein anderes Speichern auf; neu wählen lässt er sich nicht mehr."""
    order = [str(item).strip() for item in order or [] if str(item or "").strip()]
    if not order:
        return []
    known = {mode["mode"] for mode in game_maps.game_modes(game)} | {str(item) for item in saved or []}
    if not known:
        raise LeagueProblem("Das Spiel hat keine Modi - die Reihenfolge der Modi bleibt leer.")
    unknown = [mode for mode in order if mode not in known]
    if unknown:
        raise LeagueProblem("Unbekannter Modus in der Reihenfolge der Modi.")
    # Inaktiv oder archiviert (#2206): neu wählen geht nicht, was die Season schon hat, bleibt.
    problem = game_modes.choice_problem(game, order, saved or ())
    if problem:
        raise LeagueProblem(f"Modus je Map: {problem}")
    return order


def _pool_min_maps(game: dict | None, rows, saved=None) -> list[dict] | None:
    """Die überschriebene Mindestgröße je Modus (#2207): je Modus höchstens einmal, nur Modi des Spiels (oder schon gesetzte),
    ``mode: null`` nur bei Spielen ohne Modi. Leer = abgeleitet."""
    if rows is None:
        return None
    known = {mode["mode"] for mode in game_maps.game_modes(game)}
    before = {row.get("mode") for row in saved or [] if isinstance(row, dict)}
    out: list[dict] = []
    seen: set = set()
    for row in rows:
        item = row.model_dump() if hasattr(row, "model_dump") else dict(row)
        mode = str(item.get("mode") or "").strip() or None
        if mode is None and known:
            raise LeagueProblem("Mindestgröße im Pool: Bitte je Modus angeben.")
        if mode is not None and mode not in known and mode not in before:
            raise LeagueProblem("Mindestgröße im Pool: Unbekannter Modus.")
        if mode in seen:
            raise LeagueProblem("Mindestgröße im Pool: Jeder Modus nur einmal.")
        try:
            count = int(item.get("min_maps"))
        except (TypeError, ValueError):
            raise LeagueProblem("Mindestgröße im Pool: Bitte eine Zahl angeben.") from None
        if not 1 <= count <= POOL_MIN_MAPS_MAX:
            raise LeagueProblem(f"Mindestgröße im Pool: zwischen 1 und {POOL_MIN_MAPS_MAX} Maps.")
        seen.add(mode)
        out.append({"mode": mode, "min_maps": count})
    return out


def _blocked_periods(periods) -> list[dict]:
    out = []
    for period in periods or []:
        item = period.model_dump() if hasattr(period, "model_dump") else dict(period)
        out.append({"start_date": item["start_date"], "end_date": item["end_date"],
                    "label": _text(item.get("label")) or "Sperrzeit"})
    return sorted(out, key=lambda item: (item["start_date"], item["end_date"]))


def _check_squad(settings: dict, where: str) -> None:
    """Je Map braucht es mindestens die Teamgröße im Kader; mit Teilnehmerliste die Mindestzahl der Liste (#2204)."""
    min_squad, team_size = settings.get("min_squad_size"), int(settings.get("team_size") or 1)
    if min_squad is None:
        return
    if settings.get("lineup_mode") == SERIES:
        players = int(settings.get("lineup_min_players") or 1)
        if int(min_squad) < players:
            raise LeagueProblem(f"{where}: Der Mindestkader ({min_squad}) ist kleiner als die Mindestzahl der Teilnehmerliste ({players}).")
    elif int(min_squad) < team_size:
        raise LeagueProblem(f"{where}: Der Mindestkader ({min_squad}) ist kleiner als die Teamgröße ({team_size}).")
    most = settings.get("max_squad_size")
    if most is not None and int(most) < int(min_squad):
        raise LeagueProblem(f"{where}: Der Höchstkader ({most}) ist kleiner als der Mindestkader ({min_squad}).")


def _transfer_windows(windows) -> list[dict]:
    out = []
    for window in windows or []:
        item = window.model_dump() if hasattr(window, "model_dump") else dict(window)
        if str(item["end_date"]) < str(item["start_date"]):
            raise LeagueProblem("Transferfenster: Das Ende liegt vor dem Beginn.")
        label = _text(item.get("label"))
        out.append({"start_date": item["start_date"], "end_date": item["end_date"], **({"label": label} if label else {})})
    return sorted(out, key=lambda item: (item["start_date"], item["end_date"]))


def new_season_settings(fields: dict) -> dict:
    """Vorgaben einer neuen Season: die Regeln plus der Mindestkader, der zu ihrem Modus passt."""
    settings = {**SEASON_DEFAULTS, **SEASON_RULE_DEFAULTS, **fields}
    if settings.get("min_squad_size") is None:
        settings["min_squad_size"] = (max(NEW_SEASON_MIN_SQUAD, int(settings["lineup_min_players"]))
                                      if settings["lineup_mode"] == SERIES else int(settings["team_size"]))
    return settings


def clean_season(raw: dict, existing: dict | None, game: dict | None) -> dict:
    """Die gesetzten Felder einer Season-Eingabe geprüft und vereinheitlicht (nur Felder aus ``raw``). Wirft
    ``LeagueProblem``."""
    out: dict = {}
    for key, value in raw.items():
        if key not in SEASON_FIELDS:
            continue
        if key in ("name", "rules_text", *APPLICATION_TEXTS):
            value = (str(value).strip() or None) if value is not None else None
        elif key in APPLICATION_TIMES:
            moment = _aware(value)
            value = moment.isoformat() if moment else None
        elif key == "slug":
            value = slugify(value, fallback="season", max_length=80) if value else None
        elif key == "start_date":
            moment = _aware(value)
            if moment is None:
                raise LeagueProblem("Bitte den Beginn der ersten Spielwoche angeben.")
            value = moment.isoformat()
        elif key == "blocked_periods":
            value = _blocked_periods(value)
        elif key == "game_mode_order":
            value = _mode_order(game, value, (existing or {}).get("game_mode_order"))
        elif key == "scoring_rules":
            value = _scoring(value)
        elif key == "transfer_windows":
            value = _transfer_windows(value)
        elif key == POOL_MIN_MAPS:
            value = _pool_min_maps(game, value, (existing or {}).get(POOL_MIN_MAPS))
        out[key] = value
    mode = out.get("lineup_mode") or (existing or {}).get("lineup_mode")
    if mode != SERIES and out.get("team_size") and out.get("min_squad_size") is None and existing and \
            int(existing.get("min_squad_size") or 0) < int(out["team_size"]):
        out["min_squad_size"] = int(out["team_size"])  # der Mindestkader wächst mit der Teamgröße mit
    merged = {**SEASON_DEFAULTS, **existing, **out} if existing else new_season_settings(out)
    _check_squad(merged, "Season")
    opens, closes = merged.get("application_opens_at"), merged.get("application_closes_at")
    if bool(opens) != bool(closes):
        raise LeagueProblem("Das Anmeldefenster braucht Beginn und Ende.")
    if opens and _aware(closes) <= _aware(opens):
        raise LeagueProblem("Das Anmeldefenster endet vor seinem Beginn.")
    if merged.get("slug") in RESERVED_SLUGS:
        raise LeagueProblem("Diese Kurzadresse ist reserviert - bitte eine andere wählen.")
    return out


def clean_overrides(raw: dict | None, season: dict) -> dict:
    """Die Abweichungen einer Liga N - nur die erlaubten Felder, ohne leere. Die Plattform (#2270) prüft danach
    ``league_platform.check_division_overrides``."""
    allowed = (*OVERRIDE_FIELDS, *league_platform.DIVISION_KEYS)
    out = {key: value for key, value in (raw or {}).items() if key in allowed and value is not None}
    if "scoring_rules" in out:
        points = _division_points(out.pop("scoring_rules"), season)
        if points:
            out["scoring_rules"] = points
    merged = effective_settings(season, {"overrides": out})
    _check_squad(merged, "Liga N")
    return out


def _division_points(raw, season: dict) -> dict | None:
    """Die eigenen Punkte einer Liga N (#2312, #2318): nur ``match_points``, alles andere an der Tabelle kommt von der Season.
    In einer Season mit Punkten nach gewonnenen Maps gibt es keine eigenen Punkte."""
    points = raw.get("match_points") if isinstance(raw, dict) else None
    if not points:
        return None
    if maps_mode(season.get("scoring_rules")):
        raise LeagueProblem("Diese Season vergibt Punkte nach gewonnenen Maps - eine Liga N legt dann keine eigenen Punkte fest.")
    return {"match_points": _scoring({"match_points": points})["match_points"]}


def effective_settings(season: dict, division: dict | None) -> dict:
    """Die geltenden Vorgaben einer Liga N: Season plus ihre Abweichungen (``overrides``). Bei der Tabelle legen sich nur die
    eigenen Punkte über die Regeln der Season (``scoring_rules.division_rules``, #2318)."""
    merged = {**SEASON_DEFAULTS, **{key: value for key, value in season.items() if value is not None}}
    for key, value in ((division or {}).get("overrides") or {}).items():
        if key in OVERRIDE_FIELDS and value is not None:
            merged[key] = division_rules(season.get("scoring_rules"), value) if key == "scoring_rules" else value
    merged["team_size"] = int(merged.get("team_size") or 1)
    own_min = ((division or {}).get("overrides") or {}).get("min_squad_size")
    if merged.get("min_squad_size") is None or (
            own_min is None and merged.get("lineup_mode") != SERIES and merged["min_squad_size"] < merged["team_size"]):
        # Der Mindestkader der Season wächst mit einer größeren Teamgröße der Liga N mit - nicht mit Teilnehmerliste (#2204).
        merged["min_squad_size"] = merged["team_size"]
    if not merged.get("scoring_rules"):
        merged["scoring_rules"] = normalize_rules({})
    if season.get(RESPONSE_HOURS) is None and ((division or {}).get("overrides") or {}).get(RESPONSE_HOURS) is None:
        # Seasons von vor #2106 tragen keine Antwortfrist: nicht die Vorgabe vortäuschen - „je Staffel wie bisher“.
        merged[RESPONSE_HOURS] = None
    return merged


def staffel_visibility(season_visibility: str | None) -> tuple[str, bool]:
    return STAFFEL_VISIBILITY.get(season_visibility or "off", STAFFEL_VISIBILITY["off"])


def division_label(division: dict) -> str:
    """„Liga 1“ bzw. „Liga 1 · Elite“."""
    base = f"Liga {division.get('level')}"
    nickname = _text(division.get("nickname"))
    return f"{base} · {nickname}" if nickname else base


def staffel_title(league: dict, season: dict, division: dict, staffel: str) -> str:
    return f"{league.get('name')} {season.get('name')} · Liga {division.get('level')} · Staffel {staffel}"


def staffel_fields(league: dict, season: dict, division: dict) -> dict:
    """Die Felder, die eine Staffel aus Season und Liga N trägt (docs/LIGA.md, Abschnitt 2) - beim Anlegen alle, beim
    Übertragen nach Gruppen (``SYNC_GROUPS``)."""
    settings = effective_settings(season, division)
    visibility, is_public = staffel_visibility(season.get("visibility"))
    fields = {
        "game_id": league.get("game_id"),
        "team_size": settings["team_size"],
        # Mindestkader: das Zuteilen eines Co-Teams (B, P3) liest ihn am Turnier; fehlt er, gilt team_size.
        "min_squad_size": settings["min_squad_size"],
        "best_of": settings["best_of"],
        "max_participants": settings["max_staffel_size"],
        "start_date": season.get("start_date"),
        "end_date": season_end(season),
        "matchday_days": settings["matchday_days"],
        "default_match_weekday": settings["default_match_weekday"],
        "default_match_time": settings["default_match_time"],
        "result_confirm_hours_league": settings["result_confirm_hours"],
        "rules": season.get("rules_text"),
        "visibility": visibility,
        "is_public": is_public,
        "round_robin_legs": settings["round_robin_legs"],
        "matchday_blocked_weeks": blocked_weeks(season),
        # Die Sperrzeiten selbst (Wiener Kalendertage) - für matchday_schedule.blocked_period_at (Terminvorschläge, Fristen).
        "blocked_periods": [dict(period) for period in season.get("blocked_periods") or []],
        "matchday_weeks_total": settings["weeks_total"],
        "scoring_rules": settings["scoring_rules"],
        "game_mode_order": list(settings.get("game_mode_order") or []),
        "map_repeat": settings.get("map_repeat") or "other_mode",
        "lineup_amend_hours": settings["lineup_amend_hours"],
    }
    # Teilnehmerliste (#2204): nur, wenn die Season die Regel trägt - ohne Feld bleibt die Staffel bei der Aufstellung je Map.
    if settings.get("lineup_mode"):
        fields["lineup_mode"] = settings["lineup_mode"]
        if settings["lineup_mode"] == SERIES:
            fields["lineup_min_players"] = int(settings.get("lineup_min_players") or SEASON_RULE_DEFAULTS["lineup_min_players"])
    # Antwortfrist (#2106, F3): nur, wenn Season oder Liga N sie wirklich tragen - eine ältere Season ohne den Wert
    # überschreibt die Frist ihrer Staffeln nicht mit der Vorgabe.
    if settings.get(RESPONSE_HOURS) is not None:
        fields[RESPONSE_HOURS] = int(settings[RESPONSE_HOURS])
    # Ergebnisregeln (C.3, #1617): nur, wenn die Season sie trägt - ältere Seasons prüfen nichts Neues.
    fields.update({key: season[key] for key in RESULT_RULE_FIELDS if key in season})
    # Terminregeln (#2194): nur, wenn die Season sie trägt - ohne sie bleibt die Staffel beim Heimrecht wie vorher.
    if isinstance(season.get("schedule_rules"), dict):
        fields["schedule_rules"] = dict(season["schedule_rules"])
    # Check-in (#1652, D.2): ebenso - ohne Feld gibt es in der Staffel keinen Check-in.
    if isinstance(season.get("checkin_rules"), dict):
        fields["checkin_rules"] = dict(season["checkin_rules"])
    # Veto (#1618, D.3): ebenso - ohne Feld (oder aus) gibt es in der Staffel kein Veto.
    if isinstance(season.get("veto_rules"), dict):
        fields["veto_rules"] = copy.deepcopy(season["veto_rules"])
    # Proteste (#1619, E.2): ebenso - ohne Feld gilt in der Staffel die Vorgabe (league_presets).
    fields.update({key: copy.deepcopy(season[key]) for key in league_protest_settings.FIELDS if key in season})
    # Vorfälle (#1619, D.5): nur, was die Season trägt - ohne Feld gilt in der Staffel die Vorgabe.
    fields.update({key: season[key] for key in INCIDENT_FIELDS if season.get(key) is not None})
    # Erinnerungen (#1647, E.5): ebenso - ohne Feld erinnert die Staffel mit der Vorgabe (league_presets).
    if isinstance(season.get(league_reminder_rules.FIELD), dict):
        fields[league_reminder_rules.FIELD] = dict(season[league_reminder_rules.FIELD])
    return fields


# Was „Vorgaben auf Staffeln übertragen“ wann darf (docs/LIGA.md, Abschnitt 3).
SYNC_GROUPS: dict[str, tuple[str, ...]] = {
    "always": ("visibility", "is_public", "rules"),
    # Die Antwortfrist gilt nur für neue Terminvorschläge - sie darf auch während der Season wechseln, nur nicht in
    # einer gesperrten Staffel.
    "running": (RESPONSE_HOURS,),
    # Ergebnisregeln (C.3): wie „laufend“ - sie prüfen nur neue Eingaben, gespeicherte Ergebnisse bleiben.
    "result_rules": RESULT_RULE_FIELDS,
    # Terminregeln (#2194): wie die Antwortfrist auch während der Season, eigene Gruppe - ältere Seasons ohne Regeln lassen sie aus.
    "schedule": ("schedule_rules",),
    # Check-in (#1652, D.2): ebenso eine eigene Gruppe, gilt für die nächsten Spiele.
    "checkin": ("checkin_rules",),
    # Veto (#1618, D.3): ebenso - ein laufendes Veto behält seinen Schnappschuss der Vorlage.
    "veto": ("veto_rules",),
    # Proteste (#1619, E.2): ebenso - jedes Verfahren behält seine gespeicherten Fristen, neue Werte gelten für neue Fälle.
    "protests": league_protest_settings.FIELDS,
    # Vorfälle (#1619, D.5): ebenso - jeder Vorfall hält seine Frist fest, neue Werte gelten nur für neue Fälle.
    "incidents": INCIDENT_FIELDS,
    # Erinnerungen (#1647, E.5): ebenso - gelten für die nächsten Erinnerungen, schon verschickte bleiben.
    "reminders": (league_reminder_rules.FIELD,),
    "before_start": ("start_date", "end_date", "matchday_days", "default_match_weekday", "default_match_time",
                     "round_robin_legs", "matchday_blocked_weeks", "blocked_periods", "matchday_weeks_total",
                     "max_participants"),
    # Teamgröße und Mindestkader gehen immer gemeinsam - so bleibt min_squad_size ≥ team_size am Turnier.
    "before_result": ("best_of", "team_size", "min_squad_size", "scoring_rules", "game_mode_order", "map_repeat",
                      "result_confirm_hours_league", "lineup_amend_hours", "lineup_mode", "lineup_min_players"),
}
SYNC_GROUP_LABELS = {
    "always": "Sichtbarkeit und Regeltext",
    "running": "Antwortfrist auf Terminvorschläge",
    "result_rules": "Ergebnisregeln, Einstellungen und Punktepflicht",
    "schedule": "Terminregeln",
    "checkin": "Check-in",
    "veto": "Veto",
    "protests": "Proteste, Einspruch und MOSS",
    "incidents": "Vorfälle und Pausen",
    "reminders": "Erinnerungen",
    "before_start": "Termine und Kalender",
    "before_result": "Best of, Teamgröße, Mindestkader, Punkte und Fristen",
    "map_pool": "Map-Pool",
    "loadout_bans": loadout_bans.SYNC_LABEL,
    "table_points": "Punkteart der Tabelle",
}
# Punkteart (#2312, docs/LIGA.md E.1): wechselt sie, geht sie mit ihrer Reihenfolge bei Punktgleichheit und der Wertung
# kampflos auch in eine laufende Staffel - nicht in gesperrte oder beendete (deren Endstand bleibt).
TABLE_POINTS_KEYS = ("match_points_mode", "table_tiebreakers", "forfeit_score")
FINISHED_STAFFEL_STATUSES = frozenset({"completed", "results_published", "archived", "cancelled"})
# Eine abgeschlossene oder archivierte Season bekommt keine neue Punkteart mehr - ihr Endstand bleibt.
CLOSED_SEASON_STATUSES = frozenset({"completed", "archived"})


def table_points_update(tournament: dict, wanted: dict) -> dict | None:
    """Die ``scoring_rules`` einer Staffel mit der Punkteart der Season (#2312) - ``None``, wenn die Punkteart gleich ist."""
    own, target = tournament.get("scoring_rules"), wanted.get("scoring_rules")
    if not isinstance(own, dict) or not isinstance(target, dict):
        return None
    if (own.get("match_points_mode") or "result") == (target.get("match_points_mode") or "result"):
        return None
    return {**own, **{key: copy.deepcopy(target[key]) for key in TABLE_POINTS_KEYS if key in target}}


# ---------------------------------------------------------------- Lesen

async def get_league(db, league_id: str) -> dict:
    league = await db.leagues.find_one({"id": league_id}, {"_id": 0})
    if not league:
        raise LeagueProblem("Liga nicht gefunden.", 404)
    return league


async def get_season(db, season_id: str) -> dict:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        raise LeagueProblem("Season nicht gefunden.", 404)
    return season


async def get_division(db, division_id: str) -> dict:
    division = await db.league_divisions.find_one({"id": division_id}, {"_id": 0})
    if not division:
        raise LeagueProblem("Liga N nicht gefunden.", 404)
    return division


async def _game(db, game_id: str | None) -> dict | None:
    return await db.games.find_one({"id": game_id}, {"_id": 0}) if game_id else None


STAFFEL_PROJECTION = {"_id": 0, "id": 1, "slug": 1, "title": 1, "status": 1, "visibility": 1, "is_public": 1,
                      "league_context": 1, "max_participants": 1, "start_date": 1}


async def staffeln_of(db, season_id: str) -> list[dict]:
    """Alle Staffel-Turniere einer Season, nach Liga N und Buchstabe."""
    rows = await db.tournaments.find({"league_context.season_id": season_id, **ONLY_LEAGUE},
                                     STAFFEL_PROJECTION).to_list(None)
    for row in rows:
        row["participant_count"] = await db.tournament_registrations.count_documents(
            {"tournament_id": row["id"], "status": {"$in": ["approved", "checked_in"]}})
    return sorted(rows, key=lambda row: (row["league_context"].get("division_id") or "",
                                         row["league_context"].get("staffel") or ""))


def staffel_summary(row: dict) -> dict:
    return {"tournament_id": row["id"], "slug": row.get("slug"), "title": row.get("title"),
            "staffel": row["league_context"].get("staffel"), "status": row.get("status"),
            "max_participants": row.get("max_participants"), "participant_count": row.get("participant_count", 0)}


# ---------------------------------------------------------------- Liga

async def create_league(db, body: dict, user: dict) -> dict:
    game = await _game(db, body.get("game_id"))
    if not game:
        raise LeagueProblem("Spiel nicht gefunden.")
    if game_usage.is_archived(game):
        raise LeagueProblem(game_usage.ARCHIVED_DETAIL)
    name = _text(body.get("name"))
    if not name:
        raise LeagueProblem("Bitte einen Namen angeben.")
    slug_source = body.get("slug") or game.get("slug") or name
    if slugify(slug_source, fallback="liga") in RESERVED_SLUGS:
        raise LeagueProblem("Diese Kurzadresse ist reserviert - bitte eine andere wählen.")
    look = await _look(db, {key: value for key, value in body.items() if value is not None}, league_look.LEAGUE_FIELDS)
    doc = {
        **look,
        "id": new_id(), "name": name,
        "slug": await unique_slug(db.leagues, slug_source, fallback="liga", max_length=80),
        "game_id": game["id"], "participant_kind": "team", "description": _text(body.get("description")),
        "status": body.get("status") or "active",
        "created_at": _now(), "created_by": user["id"], "updated_at": _now(),
    }
    try:
        await db.leagues.insert_one(dict(doc))
    except DuplicateKeyError:
        raise LeagueProblem("Diese Kurzadresse ist schon vergeben.", 409) from None
    return doc


async def update_league(db, league: dict, body: dict) -> tuple[dict, list[str]]:
    updates: dict = {}
    if "name" in body and body["name"] is not None:
        name = _text(body["name"])
        if not name:
            raise LeagueProblem("Bitte einen Namen angeben.")
        updates["name"] = name
    if "description" in body:
        updates["description"] = _text(body.get("description"))
    if body.get("status"):
        updates["status"] = body["status"]
    clear_mode_order = False
    if body.get("game_id") and body["game_id"] != league.get("game_id"):
        # #2106: das Spiel ist änderbar, solange keine Season eine Staffel hat - eine Staffel spielt es schon.
        if await db.tournaments.count_documents({"league_context.league_id": league["id"], **ONLY_LEAGUE}):
            raise LeagueProblem(GAME_LOCKED, 409)
        chosen = await _game(db, body["game_id"])
        if not chosen:
            raise LeagueProblem("Spiel nicht gefunden.")
        if game_usage.is_archived(chosen):
            raise LeagueProblem(game_usage.ARCHIVED_DETAIL)
        updates["game_id"] = body["game_id"]
        clear_mode_order = True
    if body.get("slug"):
        slug = slugify(body["slug"], fallback="liga", max_length=80)
        if slug in RESERVED_SLUGS:
            raise LeagueProblem("Diese Kurzadresse ist reserviert - bitte eine andere wählen.")
        if slug != league.get("slug"):
            if await slug_locked(db, league):
                raise LeagueProblem(SLUG_LOCKED, 409)
            updates["slug"] = await unique_slug(db.leagues, slug, current_id=league["id"], fallback="liga",
                                                max_length=80)
    updates.update(await _look(db, body, league_look.LEAGUE_FIELDS))
    changed = sorted(key for key, value in updates.items() if league.get(key) != value)
    if changed:
        updates["updated_at"] = _now()
        try:
            await db.leagues.update_one({"id": league["id"]}, {"$set": updates})
        except DuplicateKeyError:
            raise LeagueProblem("Diese Kurzadresse ist schon vergeben.", 409) from None
    if clear_mode_order:
        # Die Modi gehören zum alten Spiel; den Map-Pool zeigt die Season danach als „anderes Spiel“ (``stale``).
        await db.league_seasons.update_many({"league_id": league["id"], "game_mode_order.0": {"$exists": True}},
                                            {"$set": {"game_mode_order": [], "updated_at": _now()}})
    doc = {**league, **updates}
    if league_look.BANNER in changed:
        for season in await db.league_seasons.find({"league_id": league["id"]}, {"_id": 0}).to_list(None):
            await apply_banner(db, doc, season)
    return doc, changed


GAME_LOCKED = "Das Spiel bleibt, sobald eine Season eine Staffel hat – bitte eine neue Liga anlegen."
SLUG_LOCKED = ("Die Adresse bleibt, seit eine Season der Liga sichtbar war – Links darauf sollen weiter "
               "funktionieren.")


async def slug_locked(db, league: dict) -> bool:
    """Die Adresse ``/liga/<slug>`` ändert sich nur vor der ersten Veröffentlichung (#2106): solange keine Season je
    sichtbar war (``published_at``, gesetzt beim Speichern einer Sichtbarkeit) und keine es gerade ist."""
    if league.get("published_at"):
        return True
    return bool(await db.league_seasons.count_documents({"league_id": league["id"], **PUBLISHED_SEASON}))


# Eine Season, die sichtbar ist oder schon lief, hat die Adresse ihrer Liga veröffentlicht.
PUBLISHED_SEASON = {"$or": [{"visibility": {"$nin": ["off", None]}}, {"status": {"$nin": ["draft", None]}}]}


async def backfill_published_at(db) -> int:
    """Migration (Review #2106): Ligen von vor ``published_at`` bekommen es, wenn eine ihrer Seasons sichtbar ist oder
    nicht mehr Entwurf - sonst ließe sich ihre Adresse ändern, sobald alle Seasons wieder „aus“ sind."""
    league_ids = await db.league_seasons.distinct("league_id", PUBLISHED_SEASON)
    if not league_ids:
        return 0
    result = await db.leagues.update_many({"id": {"$in": league_ids}, "published_at": None},
                                          {"$set": {"published_at": _now()}})
    return int(getattr(result, "modified_count", 0) or 0)


async def mark_published(db, league_id: str, visibility: str | None) -> None:
    """Merkt sich die erste Veröffentlichung einer Liga - ab dann bleibt ihre Adresse."""
    if visibility and visibility != "off":
        await db.leagues.update_one({"id": league_id, "published_at": None}, {"$set": {"published_at": _now()}})


async def season_follows_first_staffel(db, tournament: dict, previous_status: str | None, actor_id: str | None) -> bool:
    """Der Start der ersten Staffel stellt die Season von Entwurf auf „Läuft“ (#2201) - mit Protokoll. Einen von Hand
    gesetzten Stand fasst das nicht an: nur aus dem Entwurf, und nur wenn noch keine andere Staffel gestartet ist (sonst
    hat jemand die Season bewusst zurückgestellt)."""
    season_id = ((tournament or {}).get("league_context") or {}).get("season_id")
    if not season_id or previous_status not in PRE_START_STATUSES:
        return False
    started = await db.tournaments.count_documents({
        "id": {"$ne": tournament["id"]}, "league_context.season_id": season_id, "status": {"$nin": sorted(PRE_START_STATUSES)}})
    if started:
        return False
    changed = await db.league_seasons.update_one({"id": season_id, "status": {"$in": ["draft", None]}},
                                                 {"$set": {"status": "active", "updated_at": _now()}})
    if not changed.modified_count:
        return False
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0, "league_id": 1}) or {}
    # Wie beim Speichern einer Sichtbarkeit: Eine Season, die lief, hat die Adresse ihrer Liga veröffentlicht.
    await db.leagues.update_one({"id": season.get("league_id"), "published_at": None}, {"$set": {"published_at": _now()}})
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "league.season.status", "target_id": season_id, "actor_id": actor_id,
        "data": {"from": "draft", "to": "active", "trigger": "staffel_start", "tournament_id": tournament["id"]},
        "created_at": _now()})
    return True


async def league_admin_flags(db, league: dict) -> dict:
    """Was die Verwaltung beim Bearbeiten wissen muss: Spiel und Adresse noch änderbar?"""
    has_staffel = bool(await db.tournaments.count_documents({"league_context.league_id": league["id"],
                                                             **ONLY_LEAGUE}))
    return {"game_locked": has_staffel, "slug_locked": await slug_locked(db, league)}


# ---------------------------------------------------------------- Season

async def _season_unique(db, league_id: str, season_id: str | None, number: int | None, slug: str | None) -> None:
    others = {"league_id": league_id, **({"id": {"$ne": season_id}} if season_id else {})}
    if number is not None and await db.league_seasons.find_one({**others, "number": number}, {"_id": 1}):
        raise LeagueProblem(f"Season {number} gibt es in dieser Liga schon.", 409)
    if slug and await db.league_seasons.find_one({**others, "slug": slug}, {"_id": 1}):
        raise LeagueProblem("Diese Kurzadresse der Season ist schon vergeben.", 409)


def order_length_check(season: dict, divisions: list[dict], warnings: list | None) -> None:
    """Länge von „Modus je Map“ gegen die längste Serie (#2207): im Entwurf 422, in einer laufenden Season nur Warnung."""
    problem = league_pool_check.order_length_problem(season.get("game_mode_order"),
                                                     league_pool_check.max_maps(season, divisions))
    if not problem:
        return
    if not league_pool_check.season_running(season):
        raise LeagueProblem(problem)
    if warnings is not None:
        warnings.append(f"{problem} {league_pool_check.ORDER_RUNNING_HINT}")


async def _platform_season(db, season: dict, body: dict) -> dict:
    """Plattform je Season (#2270): nur wenn die Anfrage eines der Felder trägt - dann alle vier geprüft (``league_platform``).
    Fehlende Felder bleiben, wie sie gespeichert sind."""
    before = league_platform.settings_of(season)
    wanted = {**before, **{key: body[key] for key in league_platform.SEASON_KEYS if key in body}}
    if wanted[league_platform.ALLOWED] is None:
        wanted[league_platform.ALLOWED] = []
    if wanted == before:
        return {}  # unverändert: auch ein Feld, das es am Spiel nicht mehr gibt, hält das Speichern des Reiters nicht auf
    divisions = await league_platform.divisions_of(db, season["id"]) if season.get("id") else []
    try:
        after = league_platform.clean_season(wanted, season, await league_platform.league_game(db, season), divisions)
    except league_platform.PlatformProblem as problem:
        raise LeagueProblem(problem.message, problem.status) from None
    return {key: value for key, value in after.items() if value != before[key] or key not in season}


async def create_season(db, league: dict, body: dict, user: dict, *, before_write=None) -> dict:
    game = await _game(db, league.get("game_id"))
    if isinstance(body.get("scoring_rules"), dict):
        # Tabelle (E.1, #1625): was eine neue Season nicht selbst setzt, kommt aus den Vorgaben neuer Liga-Seasons.
        body = {**body, "scoring_rules": {**copy.deepcopy(LEAGUE_TABLE_DEFAULTS), **body["scoring_rules"]}}
    fields = clean_season({key: value for key, value in body.items() if value is not None}, None, game)
    fields.update(await _platform_season(db, {"league_id": league["id"]}, {key: value for key, value in body.items() if value is not None}))
    order_length_check({**SEASON_DEFAULTS, **fields}, [], None)
    number = fields.pop("number", None)
    if number is None:
        newest = await db.league_seasons.find_one({"league_id": league["id"]}, {"_id": 0, "number": 1},
                                                  sort=[("number", -1)])
        number = int((newest or {}).get("number") or 0) + 1
    name = fields.pop("name", None) or f"Season {number}"
    slug = fields.pop("slug", None) or slugify(name, fallback=f"season-{number}", max_length=80)
    if slug in RESERVED_SLUGS:  # aus dem Namen abgeleitet - „Regeln“ darf die Regelseite nicht verdecken (#1646)
        slug = f"season-{number}"
    await _season_unique(db, league["id"], None, number, slug)
    look = await _look(db, {key: value for key, value in body.items() if value is not None}, league_look.SEASON_FIELDS)
    doc = {**new_season_settings(fields), **look}
    if doc.get("scoring_rules") is None:
        doc["scoring_rules"] = league_default_rules()
    # Ergebnisregeln (C.3, #1617): die neue Season hält die Regeln der Modi fest, Punkte je Map sind Pflicht.
    doc.update(league_result_rules.new_season_fields(game))
    # Terminregeln (#2194, docs/LIGA.md D.1): Vorgabe nur für neue Seasons, gepflegt über …/schedule-rules.
    doc.setdefault("schedule_rules", dict(SCHEDULE_RULE_DEFAULTS))
    # Check-in (#1652, docs/LIGA.md D.2): ebenso, die Mindestzahl aus Teilnehmerliste oder Teamgröße; gepflegt über …/checkin-rules.
    doc.setdefault("checkin_rules", checkin_rules.defaults_for_season(doc))
    # Erinnerungen (#1647, docs/LIGA.md E.5): ebenso mit Vorgabe, gepflegt über …/reminder-rules.
    doc.setdefault(league_reminder_rules.FIELD, league_reminder_rules.defaults())
    # Veto (#1618, docs/LIGA.md D.3; Fabian Nr. 105): neue Seasons mit Veto an, die Vorlage aus Modusfolge und Best of vorbelegt - der
    # Pool kommt erst später; bis zum ersten Speichern von Hand (Merker ``auto``, Nr. 108) zieht sie mit dem Pool nach. Je Season
    # abschaltbar, gepflegt über …/veto-rules.
    doc.setdefault("veto_rules", {**league_veto_rules.defaults(), "enabled": True, league_veto_rules.AUTO: True,
                                  "steps": league_veto_rules.propose(order=doc.get("game_mode_order"), pool=None, best_of=doc.get("best_of"))})
    doc.update({"id": new_id(), "league_id": league["id"], "number": number, "name": name, "slug": slug,
                "created_at": _now(), "created_by": user["id"], "updated_at": _now()})
    if before_write:
        # Prüfung vor der Veröffentlichung (#2207): eine neue Season mit Sichtbarkeit wird damit veröffentlicht.
        await before_write(doc)
    try:
        await db.league_seasons.insert_one(dict(doc))
    except DuplicateKeyError:
        raise LeagueProblem("Diese Season gibt es schon.", 409) from None
    return doc


async def update_season(db, season: dict, body: dict, *, before_write=None,
                        warnings: list | None = None) -> tuple[dict, list[str]]:
    """Eine Season ändern. ``before_write(neuer Stand)`` läuft nach allen Prüfungen und vor dem Schreiben (Prüfung vor der
    Veröffentlichung, #2207); ``warnings`` sammelt Hinweise, die das Speichern nicht aufhalten."""
    league = await get_league(db, season["league_id"])
    game = await _game(db, league.get("game_id"))
    fields = clean_season(body, season, game)
    fields.update(await _platform_season(db, season, body))
    merged = {**SEASON_DEFAULTS, **season, **{key: value for key, value in fields.items() if value is not None}}
    if ("game_mode_order" in fields and list(fields["game_mode_order"] or []) != list(season.get("game_mode_order") or [])) or \
            ("best_of" in fields and fields["best_of"] is not None and fields["best_of"] != season.get("best_of")):
        order_length_check(merged, await league_pool_check.divisions_of(db, season["id"]), warnings)
    for key in ("name", "slug", "number", "start_date", "weeks_total", "matchday_days", "default_match_weekday",
                "default_match_time", "round_robin_legs", "max_staffel_size", "best_of", "team_size",
                "min_squad_size", "result_confirm_hours", "lineup_amend_hours", "visibility", "status", "map_repeat",
                RESPONSE_HOURS, "promote_on_home", *SEASON_RULE_DEFAULTS, *INCIDENT_FIELDS):
        if key in fields and fields[key] is None:
            fields.pop(key)  # Pflichtfelder bleiben, wie sie sind
    if "scoring_rules" in fields and fields["scoring_rules"] is None:
        fields["scoring_rules"] = normalize_rules({})
    await _season_unique(db, season["league_id"], season["id"], fields.get("number"), fields.get("slug"))
    # Gestaltung (#2107): wirkt sofort, braucht kein Übertragen - das Banner geht gleich auf die Staffeln (App).
    fields.update(await _look(db, body, league_look.SEASON_FIELDS))
    changed = sorted(key for key, value in fields.items() if season.get(key) != value)
    if before_write:
        await before_write({**season, **fields})
    if changed:
        fields["updated_at"] = _now()
        try:
            await db.league_seasons.update_one({"id": season["id"]}, {"$set": fields})
        except DuplicateKeyError:
            raise LeagueProblem("Diese Season gibt es schon.", 409) from None
    doc = {**season, **fields}
    if league_look.BANNER in changed:
        await apply_banner(db, league, doc)
    return doc, changed


# ---------------------------------------------------------------- Liga N

async def _division_order_check(db, season: dict, division: dict, before: dict | None, warnings: list | None) -> None:
    """Ein eigenes Best of der Liga N kann die längste Serie ändern - dann muss „Modus je Map“ noch passen (#2207)."""
    old = ((before or {}).get("overrides") or {}).get("best_of")
    new = (division.get("overrides") or {}).get("best_of")
    reactivated = (division.get("status") or "active") == "active" and ((before or {}).get("status") or "active") != "active"
    if before is not None and old == new and not reactivated:
        return  # Archivieren hält nichts auf - es macht die längste Serie höchstens kürzer
    others = [row for row in await league_pool_check.divisions_of(db, season["id"]) if row.get("id") != division.get("id")]
    order_length_check({**SEASON_DEFAULTS, **season}, [*others, division], warnings)


async def _platform_overrides(db, season: dict, overrides: dict, before: dict | None) -> dict:
    """Die Plattform-Abweichung einer Liga N (#2270) geprüft - mit deutscher Meldung."""
    try:
        return await league_platform.check_division_overrides(db, season, overrides, before)
    except league_platform.PlatformProblem as problem:
        raise LeagueProblem(problem.message, problem.status) from None


async def create_division(db, season: dict, body: dict, user: dict, *, warnings: list | None = None) -> dict:
    level = body.get("level")
    if level is None:
        newest = await db.league_divisions.find_one({"season_id": season["id"]}, {"_id": 0, "level": 1},
                                                    sort=[("level", -1)])
        level = int((newest or {}).get("level") or 0) + 1
    if await db.league_divisions.find_one({"season_id": season["id"], "level": level}, {"_id": 1}):
        raise LeagueProblem(f"Liga {level} gibt es in dieser Season schon.", 409)
    doc = {
        "id": new_id(), "league_id": season["league_id"], "season_id": season["id"], "level": int(level),
        "nickname": _text(body.get("nickname")),
        "overrides": await _platform_overrides(db, season, clean_overrides(body.get("overrides"), season), None),
        "status": body.get("status") or "active",
        **await _look(db, {key: value for key, value in body.items() if value is not None}, (league_look.PRIZES,)),
        "created_at": _now(), "created_by": user["id"], "updated_at": _now(),
    }
    if (doc["overrides"] or {}).get("best_of"):
        await _division_order_check(db, season, doc, None, warnings)
    try:
        await db.league_divisions.insert_one(dict(doc))
    except DuplicateKeyError:
        raise LeagueProblem(f"Liga {level} gibt es in dieser Season schon.", 409) from None
    return doc


async def update_division(db, division: dict, body: dict, *, warnings: list | None = None) -> tuple[dict, list[str]]:
    season = await get_season(db, division["season_id"])
    updates: dict = {}
    if "nickname" in body:
        updates["nickname"] = _text(body.get("nickname"))
    if "overrides" in body:
        updates["overrides"] = await _platform_overrides(db, season, clean_overrides(body.get("overrides"), season),
                                                         division.get("overrides"))
    if body.get("status"):
        updates["status"] = body["status"]
    updates.update(await _look(db, body, (league_look.PRIZES,)))
    if "overrides" in updates or "status" in updates:
        await _division_order_check(db, season, {**division, **updates}, division, warnings)
    changed = sorted(key for key, value in updates.items() if division.get(key) != value)
    if changed:
        updates["updated_at"] = _now()
        await db.league_divisions.update_one({"id": division["id"]}, {"$set": updates})
    return {**division, **updates}, changed


# ---------------------------------------------------------------- Löschen (#2106)

DELETE_REASON_MISSING = "Bitte einen Grund angeben (mindestens 5 Zeichen) – er steht im Protokoll."
STAFFEL_BUSY = "Eine Staffel wird gerade bearbeitet – bitte gleich noch einmal."
SEASON_STATUS_TEXT = {"draft": "Entwurf", "active": "läuft", "completed": "beendet", "archived": "archiviert"}
DELETE_KINDS = ("league", "season", "division")


def delete_reason(raw) -> str:
    """Der Grund fürs Protokoll: Pflicht, mindestens 5 Zeichen, eine Zeile."""
    text = _text(log_safe(raw, 500))
    if not text or len(text) < 5:
        raise LeagueProblem(DELETE_REASON_MISSING)
    return text


async def _delete_scope(db, kind: str, target: dict) -> tuple[list[dict], list[dict], dict]:
    """Seasons, Liga N und der Filter der Staffeln, die mit ``target`` gingen."""
    division_fields = {"_id": 0, "id": 1, "season_id": 1, "level": 1, "nickname": 1}
    if kind == "league":
        seasons = await db.league_seasons.find({"league_id": target["id"]},
                                               {"_id": 0, "id": 1, "name": 1, "status": 1, "number": 1}
                                               ).sort("number", 1).to_list(None)
        divisions = await db.league_divisions.find({"league_id": target["id"]}, division_fields).to_list(None)
        return seasons, divisions, {"league_context.league_id": target["id"]}
    if kind == "season":
        divisions = await db.league_divisions.find({"season_id": target["id"]}, division_fields).to_list(None)
        return [target], divisions, {"league_context.season_id": target["id"]}
    return [], [target], {"league_context.division_id": target["id"]}


async def deletion_plan(db, kind: str, target: dict) -> dict:
    """Was mit Liga, Season oder Liga N ginge - und ob es geht (#2106). Löschen geht nur, wenn darunter keine Staffel
    Co-Teams, Spiele oder Ergebnisse hat (``staffel_guard.staffel_cascade_problem``; leere Entwurfs-Staffeln gehen mit)
    und jede betroffene Season noch ein Entwurf ist. Sonst nennt ``blockers`` die Gründe: archivieren statt löschen."""
    seasons, divisions, staffel_filter = await _delete_scope(db, kind, target)
    blockers: list[str] = []
    for season in seasons:
        status = season.get("status") or "draft"
        if status != "draft":
            blockers.append(f"{season.get('name')} ist kein Entwurf mehr ({SEASON_STATUS_TEXT.get(status, status)})")
    # Regelwerk (#1646): Veröffentlichte Fassungen und Zustimmungen sind Nachweise - nur Entwürfe gehen mit.
    blockers += await deletion_blockers(db, kind, target, seasons)
    staffeln = await db.tournaments.find({**staffel_filter, **ONLY_LEAGUE},
                                         {"_id": 0, "id": 1, "title": 1, "status": 1, "league_context": 1}
                                         ).to_list(None)
    staffeln.sort(key=lambda row: str(row.get("title") or ""))
    for row in staffeln:
        problem = await staffel_guard.staffel_cascade_problem(db, row)
        if problem:
            blockers.append(f"{row.get('title')} {problem}")
    season_names = {season["id"]: season.get("name") for season in seasons}
    if kind == "division":
        season_names = {target["season_id"]: None}
    divisions.sort(key=lambda row: (str(season_names.get(row.get("season_id")) or ""), int(row.get("level") or 0)))
    name = division_label(target) if kind == "division" else target.get("name")
    return {
        "kind": kind, "id": target["id"], "name": name,
        "deletable": not blockers, "blockers": blockers,
        "archived": target.get("status") == "archived",
        "seasons": [{"id": season["id"], "name": season.get("name")} for season in seasons] if kind == "league" else [],
        "divisions": [{"id": row["id"], "label": " · ".join(filter(None, [
            season_names.get(row.get("season_id")) if kind == "league" else None, division_label(row)]))}
            for row in divisions] if kind != "division" else [],
        "staffeln": [{"tournament_id": row["id"], "title": row.get("title"),
                      "staffel": (row.get("league_context") or {}).get("staffel"), "status": row.get("status")}
                     for row in staffeln],
    }


def blocked_message(plan: dict) -> str:
    return f"Löschen geht nicht: {plan['blockers'][0]}. Archivieren statt löschen – dann bleibt alles erhalten."


async def _purge_staffel(db, tournament_id: str) -> None:
    await purge_tournament(db, tournament_id)
    await db.map_pools.delete_many({"$or": [{"tournament_id": tournament_id},
                                            {"scope": "tournament", "scope_id": tournament_id}]})
    await db.loadout_bans.delete_many({"scope": loadout_bans.TOURNAMENT, "scope_id": tournament_id})


CHANGED_MEANWHILE = "Inzwischen ist etwas dazugekommen – bitte die Seite neu laden und noch einmal prüfen."


def _plan_ids(plan: dict, kind: str, target: dict) -> tuple[set, set, set]:
    """Staffeln, Liga N und Seasons, die ein Plan löscht - samt ``target`` selbst."""
    staffeln = {row["tournament_id"] for row in plan["staffeln"]}
    divisions = {row["id"] for row in plan["divisions"]} | ({target["id"]} if kind == "division" else set())
    seasons = {row["id"] for row in plan["seasons"]} | ({target["id"]} if kind == "season" else set())
    return staffeln, divisions, seasons


async def _added_meanwhile(db, kind: str, target: dict, staffel_filter: dict, divisions: set, seasons: set) -> bool:
    """Kam unter dem Ziel etwas dazu, das der Plan nicht kennt - eine Staffel, eine Liga N oder eine Season?"""
    if await db.tournaments.count_documents({**staffel_filter, **ONLY_LEAGUE}):
        return True
    if kind != "division":
        scope = {"league_id": target["id"]} if kind == "league" else {"season_id": target["id"]}
        if await db.league_divisions.count_documents({**scope, "id": {"$nin": sorted(divisions)}}):
            return True
    if kind == "league":
        others = {"league_id": target["id"], "id": {"$nin": sorted(seasons)}}
        return bool(await db.league_seasons.count_documents(others))
    return False


async def delete_tree(db, kind: str, target: dict, *, on_staffel_deleted=None) -> dict:
    """Löscht Liga, Season oder Liga N samt leerer Entwurfs-Staffeln - alles oder nichts (Review #2106): erst die
    Schreibsperren aller Staffeln, dazu die von Liga und Season (Regelwerk #1646: Veröffentlichen und Zustimmen warten, bis das Löschen
    durch ist), dann unter allen Sperren neu prüfen, dann löschen. Ist eine Staffel oder Season gerade in
    Arbeit, wird nichts gelöscht. ``on_staffel_deleted(row)`` protokolliert jede gelöschte Staffel einzeln. Kam beim
    Löschen der Staffeln gleichzeitig eine neue Staffel, Liga N oder Season dazu, bricht es danach ab (409) - die leeren
    Staffeln sind dann schon weg und protokolliert, alles darüber bleibt. Gibt den ausgeführten Plan zurück."""
    plan = await deletion_plan(db, kind, target)
    if not plan["deletable"]:
        raise LeagueProblem(blocked_message(plan), 409)
    staffel_ids, division_ids, season_ids = _plan_ids(plan, kind, target)
    _seasons, _divisions, staffel_filter = await _delete_scope(db, kind, target)
    try:
        async with AsyncExitStack() as locks:
            # Feste Reihenfolge: zwei Löschungen sperren sich nicht gegenseitig.
            for tournament_id in sorted(staffel_ids):
                await locks.enter_async_context(mutation_lock(db, tournament_write_resource(tournament_id)))
            # Regelwerk (#1646): Die Sperren halten bis zum letzten Löschen. Reihenfolge: Turnier, Liga, Season.
            if kind == "league":
                await locks.enter_async_context(mutation_lock(db, league_resource(target["id"])))
            for season_id in sorted(season_ids):
                await locks.enter_async_context(mutation_lock(db, league_season_resource(season_id)))
            fresh = await deletion_plan(db, kind, target)
            if not fresh["deletable"]:
                raise LeagueProblem(blocked_message(fresh), 409)
            if _plan_ids(fresh, kind, target) != (staffel_ids, division_ids, season_ids):
                raise LeagueProblem(CHANGED_MEANWHILE, 409)
            for row in fresh["staffeln"]:
                await _purge_staffel(db, row["tournament_id"])
                if on_staffel_deleted:
                    await on_staffel_deleted(row)
            if await _added_meanwhile(db, kind, target, staffel_filter, division_ids, season_ids):
                raise LeagueProblem(CHANGED_MEANWHILE, 409)
            if division_ids:
                await db.league_divisions.delete_many({"id": {"$in": sorted(division_ids)}})
            if season_ids:
                await db.map_pools.delete_many({"scope": "league_season", "scope_id": {"$in": sorted(season_ids)}})
                await db.loadout_bans.delete_many({"scope": loadout_bans.SEASON, "scope_id": {"$in": sorted(season_ids)}})
                # Liga-Kader (#2108): die festgehaltenen Spiel-IDs gehören zur Season und gehen mit ihr.
                await db.league_rosters.delete_many({"season_id": {"$in": sorted(season_ids)}})
                await db.league_seasons.delete_many({"id": {"$in": sorted(season_ids)}})
            await delete_drafts(db, league_id=target["id"] if kind == "league" else None, season_ids=sorted(season_ids))
            if kind == "league":
                await db.leagues.delete_one({"id": target["id"]})
    except MutationLockBusy:
        raise LeagueProblem(STAFFEL_BUSY, 409) from None
    return fresh


async def delete_staffel(db, tournament: dict) -> None:
    """Eine Staffel auf der Season-Seite löschen (#2106): dieselbe Löschsperre wie in der Turnierverwaltung (#2109,
    ``staffel_guard.staffel_delete_problem``) - vor dem Start ohne festen Spielplan, danach „Abgesagt“/„Archiviert“."""
    try:
        async with mutation_lock(db, tournament_write_resource(tournament["id"])):
            row = await db.tournaments.find_one({"id": tournament["id"], **ONLY_LEAGUE}, {"_id": 0})
            if not row:
                raise LeagueProblem("Staffel nicht gefunden.", 404)
            problem = await staffel_guard.staffel_delete_problem(db, row)
            if problem:
                raise LeagueProblem(problem, 409)
            await _purge_staffel(db, row["id"])
    except MutationLockBusy:
        raise LeagueProblem(STAFFEL_BUSY, 409) from None


# ---------------------------------------------------------------- Staffel anlegen

async def _next_letter(db, division_id: str) -> str:
    taken = set(await db.tournaments.distinct("league_context.staffel",
                                              {"league_context.division_id": division_id, **ONLY_LEAGUE}))
    for letter in STAFFEL_LETTERS:
        if letter not in taken:
            return letter
    raise LeagueProblem("Alle Buchstaben sind vergeben.", 409)


STAFFEL_POOL_BUSY = "Der Map-Pool der Season wird gerade geändert – bitte die Staffel gleich noch einmal anlegen."


async def create_staffel(db, division: dict, staffel: str | None, user: dict) -> dict:
    """Legt das Staffel-Turnier an (Status ``draft``) mit allen Vorgaben aus Season und Liga N, dem Map-Pool der Season
    als eigener Version im Scope ``tournament`` und der Prüfung „Runden ≤ aktive Wochen“.

    Unter der Pool-Sperre der Season (#2207): So liest eine neue Staffel nie einen Pool, den „Map aus dem Pool nehmen“ gerade ersetzt.
    Die Staffel ist neu und hat noch keine Turnier-Sperre - die Reihenfolge „erst Turniere, dann Pool“ bleibt gewahrt."""
    try:
        async with mutation_lock(db, league_season_pool_resource(division["season_id"])):
            return await _create_staffel(db, division, staffel, user)
    except MutationLockBusy:
        raise LeagueProblem(STAFFEL_POOL_BUSY, 409) from None


async def _create_staffel(db, division: dict, staffel: str | None, user: dict) -> dict:
    season = await get_season(db, division["season_id"])
    league = await get_league(db, division["league_id"])
    game = await _game(db, league.get("game_id"))
    if not game:
        raise LeagueProblem("Das Spiel der Liga gibt es nicht mehr.")
    if not season.get("start_date"):
        raise LeagueProblem("Die Season braucht zuerst den Beginn der ersten Spielwoche.")
    fields = staffel_fields(league, season, division)
    # Regelwerk (#1646): statt des Regeltexts der Hinweis auf die Regelseite, sobald es eines gibt.
    fields["rules"] = await staffel_rules(db, league, season)
    problem = rounds_problem(fields["max_participants"], fields["round_robin_legs"], fields["matchday_weeks_total"],
                             fields["matchday_blocked_weeks"])
    if problem:
        raise LeagueProblem(problem)
    letter = (staffel or "").strip().upper() or await _next_letter(db, division["id"])
    if await db.tournaments.find_one({"league_context.division_id": division["id"],
                                      "league_context.staffel": letter, **ONLY_LEAGUE}, {"_id": 1}):
        raise LeagueProblem(f"Staffel {letter} gibt es in dieser Liga schon.", 409)

    title = staffel_title(league, season, division, letter)
    base = TournamentCreate(title=title, game_id=game["id"], format="league", team_mode="team").model_dump()
    doc = {
        **base,
        **fields,
        "id": new_id(),
        "title": title,
        "slug": await unique_slug(db.tournaments, f"{league.get('slug')}-{season.get('slug')}-liga-"
                                  f"{division.get('level')}-{letter}", fallback="liga"),
        "format": "league",
        "team_mode": "team",
        "min_participants": 2,
        "result_entry_mode": "player_confirmed",
        "registration_enabled": False,
        "discord_registration": False,
        "discord_skip": True,
        "season_weight": 0,
        "status": "draft",
        "league_context": {"league_id": league["id"], "season_id": season["id"], "division_id": division["id"],
                           "staffel": letter},
        "billing": pricing.normalize_offer(None),
        "partner_ids": [],
        "created_at": _now(), "updated_at": _now(), "created_by": user["id"],
    }
    banner = league_look.effective_banner_url(league, season)
    if banner:
        # Die App zeigt Turnierbanner (#2107): die Staffel trägt das Banner der Season bzw. Liga.
        doc.update({"banner_url": banner, STAFFEL_BANNER_MARK: banner})
    sync_advancement_fields(doc)
    doc.update(new_competition_version_fields("league"))
    try:
        await db.tournaments.insert_one(dict(doc))
    except DuplicateKeyError:
        raise LeagueProblem(f"Staffel {letter} gibt es in dieser Liga schon.", 409) from None
    # Wurde das Banner von Liga oder Season geändert, während die Staffel entstand, gilt das neue (Review #2107).
    await apply_banner(db, await get_league(db, league["id"]), await get_season(db, season["id"]))
    pool = await map_pools.current(db, "league_season", season["id"])
    if pool and pool.get("game_id") == game["id"]:
        await map_pools.copy_version(db, pool, scope="tournament", scope_id=doc["id"], user=user,
                                     tournament_id=doc["id"], note=f"Aus {season.get('name')} übernommen")
    # Sperrliste der Season (#2218): dieselbe Sperre, die Staffel bekommt eine eigene Version.
    await loadout_bans.copy_to_staffel(db, season, doc, user)
    return doc


# ---------------------------------------------------------------- Vorgaben übertragen

async def _has_result(db, tournament_id: str) -> bool:
    rows = await db.matches_v2.find({"tournament_id": tournament_id},
                                    {"_id": 0, "status": 1, "started_at": 1, "reports": 1, "pending_result": 1,
                                     "result_meta": 1}).to_list(None)
    return any(has_started(row) and not is_auto_bye(row) for row in rows)


def _pool_maps(pool: dict | None) -> list:
    """Was beim Übertragen als „gleicher Pool“ zählt: je Modus die Maps und das Symbol des Schnappschusses (#2266, Prüfung Codex) - eine
    Season, die ihren Pool nur wegen eines neuen Symbols neu speichert, gibt die neue Version an die Staffeln weiter."""
    return [(group.get("mode"), group.get("icon_url") or None, [item.get("map_id") for item in group.get("maps") or []])
            for group in (pool or {}).get("modes") or []]


@dataclass
class SyncResult:
    tournament_id: str
    title: str
    applied: list[str]
    skipped: list[dict]
    changed: list[str]

    def as_dict(self) -> dict:
        return {"tournament_id": self.tournament_id, "title": self.title, "applied": self.applied,
                "skipped": self.skipped, "changed": self.changed}


LOCKED_REASON = "Die Staffel ist gesperrt."


async def sync_staffel(db, tournament: dict, league: dict, season: dict, division: dict, user: dict, *,
                       locked: bool = False) -> SyncResult:
    """Überträgt die Vorgaben auf eine Staffel - je Gruppe nur, wenn sie noch darf (docs/LIGA.md, Abschnitt 3).
    Eine gesperrte Staffel (``locked_at``) bekommt nur noch, was immer gilt (Sichtbarkeit, Regeltext, Map-Pool)."""
    wanted = staffel_fields(league, season, division)
    # Regelwerk (#1646): Übertragen schreibt nicht den alten Regeltext zurück.
    wanted["rules"] = await staffel_rules(db, league, season)
    applied: list[str] = []
    skipped: list[dict] = []
    updates: dict = {}
    started = tournament.get("status") not in PRE_START_STATUSES
    has_result = await _has_result(db, tournament["id"])
    for group, keys in SYNC_GROUPS.items():
        if not any(key in wanted for key in keys):
            continue  # eine ältere Season ohne Antwortfrist: die Staffel behält ihre
        if group != "always" and locked:
            skipped.append({"group": group, "label": SYNC_GROUP_LABELS[group], "reason": LOCKED_REASON})
            continue
        if group == "before_start" and started:
            skipped.append({"group": group, "label": SYNC_GROUP_LABELS[group],
                            "reason": "Die Staffel hat schon begonnen."})
            continue
        if group == "before_result" and has_result:
            skipped.append({"group": group, "label": SYNC_GROUP_LABELS[group],
                            "reason": "Es gibt schon ein Ergebnis."})
            continue
        if group == "before_start":
            count = await db.tournament_registrations.count_documents(
                {"tournament_id": tournament["id"], "status": {"$in": ["approved", "checked_in", "pending"]}})
            if count > int(wanted["max_participants"]):
                skipped.append({"group": group, "label": SYNC_GROUP_LABELS[group],
                                "reason": f"Die Staffel hat schon {count} Teams - mehr als die neue Staffelgröße."})
                continue
            problem = rounds_problem(wanted["max_participants"], wanted["round_robin_legs"],
                                     wanted["matchday_weeks_total"], wanted["matchday_blocked_weeks"])
            if problem:
                skipped.append({"group": group, "label": SYNC_GROUP_LABELS[group], "reason": problem})
                continue
        updates.update({key: wanted[key] for key in keys if key in wanted})
        applied.append(group)
    if (has_result and not locked and tournament.get("status") not in FINISHED_STAFFEL_STATUSES
            and season.get("status") not in CLOSED_SEASON_STATUSES):
        # Punkteart (#2312): auch nach dem ersten Ergebnis, aber nur, wenn sie wechselt.
        switched = table_points_update(tournament, wanted)
        if switched is not None:
            updates["scoring_rules"] = switched
            applied.append("table_points")
    changed = sorted(key for key, value in updates.items() if tournament.get(key) != value)
    if changed:
        await db.tournaments.update_one({"id": tournament["id"]}, {"$set": {**{key: updates[key] for key in changed},
                                                                            "updated_at": _now()}})
    try:
        await _sync_pool(db, tournament, season, user, locked=locked, has_result=has_result,
                         applied=applied, skipped=skipped, changed=changed)
    except map_pools.MapProblem as problem:
        # Die Felder oben sind schon geschrieben - das Ergebnis sagt ehrlich, dass nur der Pool fehlt.
        skipped.append({"group": "map_pool", "label": SYNC_GROUP_LABELS["map_pool"], "reason": problem.message})
    # Sperrliste (#2218): wie der Map-Pool - eine neue Liste geht immer, Spiele mit festgehaltener Version behalten ihre.
    await loadout_bans.sync_staffel(db, tournament, season, user, locked=locked, has_result=has_result, applied=applied,
                                    skipped=skipped, changed=changed)
    await _note_mode_order(db, tournament, updates, skipped)
    return SyncResult(tournament["id"], tournament.get("title") or "", applied, skipped, changed)


async def transfer_pool(db, tournament: dict, season: dict, user: dict, *, pool: dict, locked: bool, applied: list,
                        skipped: list, changed: list) -> None:
    """Genau die Version ``pool`` der Season auf eine Staffel übertragen (#2207, „Map aus dem Pool nehmen“) - derselbe Weg wie beim
    Übertragen: Spiele mit festgehaltenem Pool behalten ihren. Hat die Staffel schon dieselben Maps, entsteht keine neue Version."""
    has_result = await _has_result(db, tournament["id"])
    await _sync_pool(db, tournament, season, user, locked=locked, has_result=has_result, applied=applied, skipped=skipped,
                     changed=changed, pool=pool)
    await _note_mode_order(db, tournament, {}, skipped)


async def _note_mode_order(db, tournament: dict, updates: dict, skipped: list) -> None:
    """Sagt ehrlich, wenn „Modus je Map“ der Staffel nach dem Übertragen nicht mehr gilt (#2129): Der Pool geht immer über,
    die Reihenfolge nur vor dem ersten Ergebnis."""
    order = updates.get("game_mode_order", tournament.get("game_mode_order"))
    pool = await map_pools.current(db, "tournament", tournament["id"])
    if order and pool and not league_games.effective_mode_order({"game_mode_order": order}, pool):
        skipped.append({"group": "game_mode_order", "label": "Modus je Map",
                        "reason": "Der Map-Pool der Staffel hat nicht mehr alle Modi ihrer Reihenfolge. Die Teams wählen den "
                                  "Modus je Map deshalb frei; Spiele mit festgehaltenem Pool behalten ihre Reihenfolge."})


async def _sync_pool(db, tournament: dict, season: dict, user: dict, *, locked: bool, has_result: bool,
                     applied: list, skipped: list, changed: list, pool: dict | None = None) -> None:
    """Map-Pool der Season → Staffel. Ein neuer Pool geht immer (Spiele mit festgehaltenem Pool behalten ihren). Hat die
    Season keinen Pool mehr, wird die Kopie der Staffel entfernt - nur vor dem ersten Ergebnis und nicht gesperrt, sonst
    steht der Grund im Ergebnis. ``pool``: genau diese Version übertragen statt der gerade geltenden (#2207, „Map sperren“)."""
    pool = pool if pool is not None else await map_pools.current(db, "league_season", season["id"])
    own = await map_pools.current(db, "tournament", tournament["id"])
    if pool and pool.get("game_id") == tournament.get("game_id"):
        if _pool_maps(pool) != _pool_maps(own):
            await map_pools.copy_version(db, pool, scope="tournament", scope_id=tournament["id"], user=user,
                                         tournament_id=tournament["id"], note=f"Aus {season.get('name')} übernommen")
            changed.append("map_pool")
        applied.append("map_pool")
        return
    if pool:
        # Die Staffel spielt ein anderes Spiel als die Season (jemand hat es am Turnier umgestellt): nichts löschen.
        skipped.append({"group": "map_pool", "label": SYNC_GROUP_LABELS["map_pool"],
                        "reason": "Die Staffel hat ein anderes Spiel als der Map-Pool der Season - ihr Pool bleibt."})
        return
    if not own:
        applied.append("map_pool")
        return
    if locked or has_result:
        reason = LOCKED_REASON if locked else "Es gibt schon ein Ergebnis."
        skipped.append({"group": "map_pool", "label": SYNC_GROUP_LABELS["map_pool"],
                        "reason": f"Die Season hat keinen Map-Pool mehr, die Staffel behält ihren: {reason}"})
        return
    await map_pools.clear(db, scope="tournament", scope_id=tournament["id"], user=user, tournament_id=tournament["id"])
    changed.append("map_pool")
    applied.append("map_pool")


# Season-Felder, die eine Staffel übernimmt (``staffel_fields``) - ändert sich eines, braucht es „Übertragen“. Die
# Sichtbarkeit wirkt sofort (``apply_visibility``); Name, Stand und Meldeschluss liest niemand vom Turnier.
STAFFEL_SOURCE_FIELDS = frozenset({
    "start_date", "weeks_total", "blocked_periods", "matchday_days", "default_match_weekday", "default_match_time",
    "round_robin_legs", "max_staffel_size", "best_of", "team_size", "min_squad_size", "game_mode_order",
    "map_repeat", "scoring_rules", "result_confirm_hours", "lineup_amend_hours", "rules_text", RESPONSE_HOURS,
    *INCIDENT_FIELDS,
})


async def apply_visibility(db, season: dict) -> int:
    """Die Sichtbarkeit der Season sofort auf alle ihre Staffeln - auch gesperrte, auch nach dem Start: „aus“ heißt
    sofort aus (docs/LIGA.md, Abschnitt 10). Gibt die Zahl der geänderten Staffeln zurück."""
    visibility, is_public = staffel_visibility(season.get("visibility"))
    result = await db.tournaments.update_many(
        {"league_context.season_id": season["id"], **ONLY_LEAGUE,
         "$or": [{"visibility": {"$ne": visibility}}, {"is_public": {"$ne": is_public}}]},
        {"$set": {"visibility": visibility, "is_public": is_public, "updated_at": _now()}})
    return int(getattr(result, "modified_count", 0) or 0)


# Woher das Banner einer Staffel kommt (#2107): steht hier dieselbe Adresse wie in ``banner_url``, hat die Liga es
# gesetzt. Ein eigenes Turnierbanner (anders als die Marke) bleibt beim Wechsel der Gestaltung stehen.
STAFFEL_BANNER_MARK = "league_banner_url"


async def apply_banner(db, league: dict, season: dict) -> int:
    """Das geltende Banner (Season → Liga) sofort auf die Staffeln der Season - die App zeigt eine Staffel als Turnier
    mit ihrem Banner. Gibt die Zahl der geänderten Staffeln zurück."""
    banner = league_look.effective_banner_url(league, season)
    rows = await db.tournaments.find({"league_context.season_id": season["id"], **ONLY_LEAGUE},
                                     {"_id": 0, "id": 1, "banner_url": 1, STAFFEL_BANNER_MARK: 1}).to_list(None)
    changed = 0
    for row in rows:
        own = row.get("banner_url")
        ours = not own or own == row.get(STAFFEL_BANNER_MARK)
        if not ours or (own or None) == banner:
            continue
        update = ({"$set": {"banner_url": banner, STAFFEL_BANNER_MARK: banner, "updated_at": _now()}} if banner
                  else {"$set": {"banner_url": None, "updated_at": _now()}, "$unset": {STAFFEL_BANNER_MARK: ""}})
        # Nur, wenn das Banner noch das gelesene ist (Review #2107): setzt jemand gleichzeitig in der Turnierverwaltung
        # ein eigenes Staffelbanner, bleibt es stehen.
        still = {"banner_url": own} if own else {"banner_url": {"$in": [None, ""]}}
        result = await db.tournaments.update_one({"id": row["id"], **still}, update)
        changed += int(getattr(result, "modified_count", 0) or 0)
    return changed


# ---------------------------------------------------------------- Sichtbarkeit (öffentliche Lese-API)

async def can_see_season(user: dict | None, season: dict) -> bool:
    """Ligaseite lesen nach der Sichtbarkeit der Season (docs/LIGA.md, Abschnitt 10): ``off`` niemand (404),
    ``admins`` nur wer in dieser Liga Rechte hat, ``members`` dazu Mitglieder, ``public`` alle. Der Bereich Turnierleitung
    zählt hier nicht (#2203)."""
    visibility = season.get("visibility") or "off"
    if visibility == "public":
        return True
    if visibility not in ("members", "admins"):
        return False
    from services.league_permissions import ANY, can
    from services.visibility import user_can_see

    if await can(user, ANY, season.get("league_id")):
        return True
    return visibility == "members" and await user_can_see(user, "members")


PUBLIC_SEASON_FIELDS = ("id", "number", "name", "slug", "status", "start_date", "weeks_total", "blocked_periods",
                        "matchday_days", "default_match_weekday", "default_match_time", "round_robin_legs",
                        "max_staffel_size", "best_of", "team_size", "min_squad_size", "game_mode_order",
                        "map_repeat", "result_confirm_hours", "lineup_amend_hours", RESPONSE_HOURS, "rules_text",
                        "registration_deadline")


PUBLIC_SEASON_HEAD = ("id", "number", "name", "slug", "status", "start_date")


def public_season(season: dict) -> dict:
    out = {key: season.get(key) for key in PUBLIC_SEASON_FIELDS}
    rules = season.get("scoring_rules") or normalize_rules({})
    out["match_points"] = rules.get("match_points")
    out["match_points_mode"] = rules.get("match_points_mode") or "result"
    out["table_tiebreakers"] = rules.get("table_tiebreakers")
    out["blocked_weeks"] = blocked_weeks(season)
    out["end_date"] = season_end(season)
    # Was gespielt wird und wie Termine laufen (#2268): die Regel je Modus und die Terminregeln aus dem Regelwerk - ohne
    # Arbeitswerte der Leitung (Erinnerung, „überfällig“).
    out["result_rules"] = league_result_rules.public_rules(season)
    out["schedule_rules"] = schedule_public_rules(season)
    return out


def public_league(league: dict) -> dict:
    return {key: league.get(key) for key in ("id", "slug", "name", "game_id", "participant_kind", "description",
                                             league_look.EMBLEM, league_look.ACCENT)}


def public_season_head(league: dict, season: dict) -> dict:
    """Eine Season in der Liste: Kopfdaten, dazu Emblem und Banner, wie sie gezeigt werden (Season → Liga)."""
    look = league_look.effective(league, season)
    return {**{key: season.get(key) for key in PUBLIC_SEASON_HEAD}, "emblem_url": look["emblem_url"],
            "banner": look["banner"]}


async def visible_leagues(db, user: dict | None) -> list[dict]:
    """Ligen mit mindestens einer für die Person sichtbaren Season - die Navigation zeigt „Liga“ nur dann."""
    out = []
    leagues = await db.leagues.find({"status": "active"}, {"_id": 0}).sort("name", 1).to_list(200)
    for league in leagues:
        seasons = await db.league_seasons.find({"league_id": league["id"], "visibility": {"$ne": "off"},
                                                "status": {"$ne": "archived"}},
                                               {"_id": 0}).sort("number", -1).to_list(200)
        visible = [season for season in seasons if await can_see_season(user, season)]
        if visible:
            game = await _game(db, league.get("game_id"))
            out.append({**public_league(league), "game": map_pools.game_summary(game),
                        "seasons": [public_season_head(league, season) for season in visible]})
    return out


async def visible_season(db, league_slug: str, season_slug: str, user: dict | None) -> tuple[dict, dict]:
    """Liga und Season aus der Adresse - nur, wenn die Person die Season sehen darf; sonst 404 wie „gibt es nicht“."""
    league = await db.leagues.find_one({"slug": league_slug, "status": "active"}, {"_id": 0})
    season = await db.league_seasons.find_one({"league_id": league["id"], "slug": season_slug},
                                              {"_id": 0}) if league else None
    if not season or season.get("status") == "archived" or not await can_see_season(user, season):
        raise LeagueProblem("Season nicht gefunden.", 404)
    return league, season


async def public_season_view(db, league_slug: str, season_slug: str, user: dict | None, *,
                             staffel_hidden=None) -> dict:
    """Liga → Season → Liga N → Staffeln mit Turnier-Kennungen. Unsichtbar heißt 404 - wie „gibt es nicht“.
    ``staffel_hidden(db, tournament, user)``: die Sichtbarkeitsregel der Turnierseite (die Route reicht
    ``tournament_hidden_reason`` herein - ein Service importiert keine Route)."""
    league, season = await visible_season(db, league_slug, season_slug, user)
    divisions = await db.league_divisions.find({"season_id": season["id"], "status": "active"},
                                               {"_id": 0}).sort("level", 1).to_list(50)
    # Nur Staffeln, die die Person auch als Turnier sähe - Entwurf und „intern“ bleiben bei der Leitung und den
    # Teilnehmenden (dieselbe Regel wie die Turnierseite).
    staffeln = [row for row in await staffeln_of(db, season["id"])
                if staffel_hidden is None or not await staffel_hidden(db, row, user)]
    game = await _game(db, league.get("game_id"))
    pool = map_pools.view(map_pools.valid_for(await map_pools.current(db, "league_season", season["id"]),
                                              league.get("game_id")), "league_season")
    bans_doc = loadout_bans.valid_for(await loadout_bans.current(db, loadout_bans.SEASON, season["id"]), league.get("game_id"))
    return {
        "league": {**public_league(league), "game": map_pools.game_summary(game)},
        "season": public_season(season),
        # Gestaltung (#2107): Emblem und Banner Season → Liga → nichts; Farbe der Liga (leer = Vereinsfarbe).
        "look": league_look.effective(league, season),
        # „Um was gespielt wird“ - die Gewinne der Season; eine Liga N mit eigenen trägt sie unter ``prizes``.
        "prizes": list(season.get(league_look.PRIZES) or []),
        "map_pool": pool,
        # Sperrliste (#2218): nur der Schnappschuss der Season, ohne Notiz und Autor; eine ganze Klasse mit ihren Einträgen von
        # heute (#2287).
        "loadout_bans": await loadout_bans.live_view(db, bans_doc, loadout_bans.SEASON),
        # Erlaubte Ausrüstung (#2287, Nr. 99): dieselbe Sicht wie der Baustein im Regelwerk; ``None`` ohne Bibliothek.
        "allowed_equipment": await loadout_bans.public_allowed(db, league.get("game_id"), bans_doc, season),
        "divisions": [{
            "id": division["id"], "level": division["level"], "nickname": division.get("nickname"),
            "label": division_label(division),
            "prizes": league_look.division_prizes(division),
            "settings": {key: effective_settings(season, division)[key]
                         for key in ("best_of", "team_size", "min_squad_size", "max_staffel_size")},
            "staffeln": [staffel_summary(row) for row in staffeln
                         if row["league_context"].get("division_id") == division["id"]],
        } for division in divisions],
    }


async def staffel_settings(db, tournament: dict) -> dict | None:
    """Die geltenden Vorgaben (Season + Liga N) einer Staffel - z. B. ``min_squad_size`` beim Zuteilen (B).
    ``None`` für Turniere ohne ``league_context``."""
    context = (tournament or {}).get("league_context")
    if not isinstance(context, dict):
        return None
    season = await db.league_seasons.find_one({"id": context.get("season_id")}, {"_id": 0})
    division = await db.league_divisions.find_one({"id": context.get("division_id")}, {"_id": 0})
    return effective_settings(season, division) if season else None
