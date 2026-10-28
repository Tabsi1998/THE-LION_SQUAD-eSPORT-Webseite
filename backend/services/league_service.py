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

from contextlib import AsyncExitStack
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from pymongo.errors import DuplicateKeyError

from models import TournamentCreate, new_id, now_utc
from services import game_maps, league_look, map_pools, pricing, staffel_guard
from services.advancement_draw import sync_advancement_fields
from services.bracket_fill_in import has_started, is_auto_bye
from services.competition_versions import new_competition_version_fields
from services.league_scope import ONLY_LEAGUE
from services.log_safe import log_safe
from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource
from services.tournament_purge import purge_tournament
# Runden ≤ aktive Wochen steht im Blatt-Modul (auch für Spielplan und Turnierstart) und wird hier weitergereicht.
from services.league_rounds import max_teams_for, rounds_needed, rounds_problem  # noqa: F401
from services.scoring_rules import normalize_rules
from services.slug_utils import slugify, unique_slug

VIENNA = ZoneInfo("Europe/Vienna")

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
}
SEASON_FIELDS = tuple(SEASON_DEFAULTS) + ("name", "slug", "number", "start_date")
OVERRIDE_FIELDS = ("best_of", "team_size", "min_squad_size", "max_staffel_size", "scoring_rules",
                   "match_schedule_response_hours")
# Seasons von vor #2106 tragen keine Antwortfrist: dann behält jede Staffel ihre eigene (``staffel_fields``).
RESPONSE_HOURS = "match_schedule_response_hours"
# Ab hier hat eine Staffel begonnen: Termine und Kalender bleiben dann, wie sie sind.
PRE_START_STATUSES = frozenset({"draft", "scheduled", "registration_open", "registration_closed", "check_in"})
# Sichtbarkeit der Season → Sichtbarkeit der Staffel-Turniere (docs/LIGA.md, Abschnitt 10).
STAFFEL_VISIBILITY = {
    "off": ("internal", False),
    "admins": ("internal", False),
    "members": ("members", True),
    "public": ("public", True),
}
RESERVED_SLUGS = frozenset({"admin", "neu", "new"})
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

def _aware(value) -> datetime | None:
    """Ein Zeitpunkt als UTC. Ohne Zeitzone ist er Wiener Wanduhrzeit - so gibt die Verwaltung den Beginn ein."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        moment = value
    else:
        try:
            moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=VIENNA)
    return moment.astimezone(timezone.utc)


def _local_day(value) -> date | None:
    moment = _aware(value)
    return moment.astimezone(VIENNA).date() if moment else None


def week_days(season: dict) -> list[tuple[date, date]]:
    """Je Spielwoche (1-basiert) der erste und letzte Wiener Kalendertag."""
    first = _local_day(season.get("start_date"))
    if first is None:
        return []
    days = int(season.get("matchday_days") or 7)
    return [(first + timedelta(days=days * index), first + timedelta(days=days * index + days - 1))
            for index in range(int(season.get("weeks_total") or 0))]


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


def _mode_order(game: dict | None, order) -> list[str]:
    order = [str(item).strip() for item in order or [] if str(item or "").strip()]
    if not order:
        return []
    known = {mode["mode"] for mode in game_maps.game_modes(game)}
    if not known:
        raise LeagueProblem("Das Spiel hat keine Modi - die Reihenfolge der Modi bleibt leer.")
    unknown = [mode for mode in order if mode not in known]
    if unknown:
        raise LeagueProblem("Unbekannter Modus in der Reihenfolge der Modi.")
    return order


def _blocked_periods(periods) -> list[dict]:
    out = []
    for period in periods or []:
        item = period.model_dump() if hasattr(period, "model_dump") else dict(period)
        out.append({"start_date": item["start_date"], "end_date": item["end_date"],
                    "label": _text(item.get("label")) or "Sperrzeit"})
    return sorted(out, key=lambda item: (item["start_date"], item["end_date"]))


def _check_squad(team_size: int, min_squad: int | None, where: str) -> None:
    if min_squad is not None and int(min_squad) < int(team_size):
        raise LeagueProblem(f"{where}: Der Mindestkader ({min_squad}) ist kleiner als die Teamgröße ({team_size}).")


def clean_season(raw: dict, existing: dict | None, game: dict | None) -> dict:
    """Die gesetzten Felder einer Season-Eingabe geprüft und vereinheitlicht (nur Felder aus ``raw``). Wirft
    ``LeagueProblem``."""
    out: dict = {}
    for key, value in raw.items():
        if key not in SEASON_FIELDS:
            continue
        if key in ("name", "rules_text"):
            value = (str(value).strip() or None) if value is not None else None
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
            value = _mode_order(game, value)
        elif key == "scoring_rules":
            value = _scoring(value)
        out[key] = value
    if out.get("team_size") and out.get("min_squad_size") is None and existing and \
            int(existing.get("min_squad_size") or 0) < int(out["team_size"]):
        out["min_squad_size"] = int(out["team_size"])  # der Mindestkader wächst mit der Teamgröße mit
    merged = {**SEASON_DEFAULTS, **(existing or {}), **out}
    team_size = int(merged.get("team_size") or 1)
    _check_squad(team_size, merged.get("min_squad_size"), "Season")
    if merged.get("slug") in RESERVED_SLUGS:
        raise LeagueProblem("Diese Kurzadresse ist reserviert - bitte eine andere wählen.")
    return out


def clean_overrides(raw: dict | None, season: dict) -> dict:
    """Die Abweichungen einer Liga N - nur die erlaubten Felder, ohne leere."""
    out = {key: value for key, value in (raw or {}).items() if key in OVERRIDE_FIELDS and value is not None}
    if "scoring_rules" in out:
        out["scoring_rules"] = _scoring(out["scoring_rules"])
    merged = effective_settings(season, {"overrides": out})
    _check_squad(merged["team_size"], merged["min_squad_size"], "Liga N")
    return out


def effective_settings(season: dict, division: dict | None) -> dict:
    """Die geltenden Vorgaben einer Liga N: Season plus ihre Abweichungen (``overrides``)."""
    merged = {**SEASON_DEFAULTS, **{key: value for key, value in season.items() if value is not None}}
    for key, value in ((division or {}).get("overrides") or {}).items():
        if key in OVERRIDE_FIELDS and value is not None:
            merged[key] = value
    merged["team_size"] = int(merged.get("team_size") or 1)
    own_min = ((division or {}).get("overrides") or {}).get("min_squad_size")
    if merged.get("min_squad_size") is None or (own_min is None and merged["min_squad_size"] < merged["team_size"]):
        # Der Mindestkader der Season wächst mit einer größeren Teamgröße der Liga N mit.
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
    # Antwortfrist (#2106, F3): nur, wenn Season oder Liga N sie wirklich tragen - eine ältere Season ohne den Wert
    # überschreibt die Frist ihrer Staffeln nicht mit der Vorgabe.
    if settings.get(RESPONSE_HOURS) is not None:
        fields[RESPONSE_HOURS] = int(settings[RESPONSE_HOURS])
    return fields


# Was „Vorgaben auf Staffeln übertragen“ wann darf (docs/LIGA.md, Abschnitt 3).
SYNC_GROUPS: dict[str, tuple[str, ...]] = {
    "always": ("visibility", "is_public", "rules"),
    # Die Antwortfrist gilt nur für neue Terminvorschläge - sie darf auch während der Season wechseln, nur nicht in
    # einer gesperrten Staffel.
    "running": (RESPONSE_HOURS,),
    "before_start": ("start_date", "end_date", "matchday_days", "default_match_weekday", "default_match_time",
                     "round_robin_legs", "matchday_blocked_weeks", "blocked_periods", "matchday_weeks_total",
                     "max_participants"),
    # Teamgröße und Mindestkader gehen immer gemeinsam - so bleibt min_squad_size ≥ team_size am Turnier.
    "before_result": ("best_of", "team_size", "min_squad_size", "scoring_rules", "game_mode_order", "map_repeat",
                      "result_confirm_hours_league", "lineup_amend_hours"),
}
SYNC_GROUP_LABELS = {
    "always": "Sichtbarkeit und Regeltext",
    "running": "Antwortfrist auf Terminvorschläge",
    "before_start": "Termine und Kalender",
    "before_result": "Best of, Teamgröße, Mindestkader, Punkte und Fristen",
    "map_pool": "Map-Pool",
}


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
        if not await _game(db, body["game_id"]):
            raise LeagueProblem("Spiel nicht gefunden.")
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


async def create_season(db, league: dict, body: dict, user: dict) -> dict:
    game = await _game(db, league.get("game_id"))
    fields = clean_season({key: value for key, value in body.items() if value is not None}, None, game)
    number = fields.pop("number", None)
    if number is None:
        newest = await db.league_seasons.find_one({"league_id": league["id"]}, {"_id": 0, "number": 1},
                                                  sort=[("number", -1)])
        number = int((newest or {}).get("number") or 0) + 1
    name = fields.pop("name", None) or f"Season {number}"
    slug = fields.pop("slug", None) or slugify(name, fallback=f"season-{number}", max_length=80)
    await _season_unique(db, league["id"], None, number, slug)
    look = await _look(db, {key: value for key, value in body.items() if value is not None}, league_look.SEASON_FIELDS)
    doc = {**SEASON_DEFAULTS, **fields, **look}
    if doc.get("scoring_rules") is None:
        doc["scoring_rules"] = normalize_rules({})
    if doc.get("min_squad_size") is None:
        doc["min_squad_size"] = int(doc["team_size"])
    doc.update({"id": new_id(), "league_id": league["id"], "number": number, "name": name, "slug": slug,
                "created_at": _now(), "created_by": user["id"], "updated_at": _now()})
    try:
        await db.league_seasons.insert_one(dict(doc))
    except DuplicateKeyError:
        raise LeagueProblem("Diese Season gibt es schon.", 409) from None
    return doc


async def update_season(db, season: dict, body: dict) -> tuple[dict, list[str]]:
    league = await get_league(db, season["league_id"])
    game = await _game(db, league.get("game_id"))
    fields = clean_season(body, season, game)
    for key in ("name", "slug", "number", "start_date", "weeks_total", "matchday_days", "default_match_weekday",
                "default_match_time", "round_robin_legs", "max_staffel_size", "best_of", "team_size",
                "min_squad_size", "result_confirm_hours", "lineup_amend_hours", "visibility", "status", "map_repeat",
                RESPONSE_HOURS):
        if key in fields and fields[key] is None:
            fields.pop(key)  # Pflichtfelder bleiben, wie sie sind
    if "scoring_rules" in fields and fields["scoring_rules"] is None:
        fields["scoring_rules"] = normalize_rules({})
    await _season_unique(db, season["league_id"], season["id"], fields.get("number"), fields.get("slug"))
    # Gestaltung (#2107): wirkt sofort, braucht kein Übertragen - das Banner geht gleich auf die Staffeln (App).
    fields.update(await _look(db, body, league_look.SEASON_FIELDS))
    changed = sorted(key for key, value in fields.items() if season.get(key) != value)
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

async def create_division(db, season: dict, body: dict, user: dict) -> dict:
    level = body.get("level")
    if level is None:
        newest = await db.league_divisions.find_one({"season_id": season["id"]}, {"_id": 0, "level": 1},
                                                    sort=[("level", -1)])
        level = int((newest or {}).get("level") or 0) + 1
    if await db.league_divisions.find_one({"season_id": season["id"], "level": level}, {"_id": 1}):
        raise LeagueProblem(f"Liga {level} gibt es in dieser Season schon.", 409)
    doc = {
        "id": new_id(), "league_id": season["league_id"], "season_id": season["id"], "level": int(level),
        "nickname": _text(body.get("nickname")), "overrides": clean_overrides(body.get("overrides"), season),
        "status": body.get("status") or "active",
        **await _look(db, {key: value for key, value in body.items() if value is not None}, (league_look.PRIZES,)),
        "created_at": _now(), "created_by": user["id"], "updated_at": _now(),
    }
    try:
        await db.league_divisions.insert_one(dict(doc))
    except DuplicateKeyError:
        raise LeagueProblem(f"Liga {level} gibt es in dieser Season schon.", 409) from None
    return doc


async def update_division(db, division: dict, body: dict) -> tuple[dict, list[str]]:
    season = await get_season(db, division["season_id"])
    updates: dict = {}
    if "nickname" in body:
        updates["nickname"] = _text(body.get("nickname"))
    if "overrides" in body:
        updates["overrides"] = clean_overrides(body.get("overrides"), season)
    if body.get("status"):
        updates["status"] = body["status"]
    updates.update(await _look(db, body, (league_look.PRIZES,)))
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
    Schreibsperren aller Staffeln, dann unter allen Sperren neu prüfen, dann löschen. Ist eine Staffel gerade in
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
            fresh = await deletion_plan(db, kind, target)
            if not fresh["deletable"]:
                raise LeagueProblem(blocked_message(fresh), 409)
            if _plan_ids(fresh, kind, target) != (staffel_ids, division_ids, season_ids):
                raise LeagueProblem(CHANGED_MEANWHILE, 409)
            for row in fresh["staffeln"]:
                await _purge_staffel(db, row["tournament_id"])
                if on_staffel_deleted:
                    await on_staffel_deleted(row)
    except MutationLockBusy:
        raise LeagueProblem(STAFFEL_BUSY, 409) from None
    if await _added_meanwhile(db, kind, target, staffel_filter, division_ids, season_ids):
        raise LeagueProblem(CHANGED_MEANWHILE, 409)
    if division_ids:
        await db.league_divisions.delete_many({"id": {"$in": sorted(division_ids)}})
    if season_ids:
        await db.map_pools.delete_many({"scope": "league_season", "scope_id": {"$in": sorted(season_ids)}})
        # Liga-Kader (#2108): die festgehaltenen Spiel-IDs gehören zur Season und gehen mit ihr.
        await db.league_rosters.delete_many({"season_id": {"$in": sorted(season_ids)}})
        await db.league_seasons.delete_many({"id": {"$in": sorted(season_ids)}})
    if kind == "league":
        await db.leagues.delete_one({"id": target["id"]})
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


async def create_staffel(db, division: dict, staffel: str | None, user: dict) -> dict:
    """Legt das Staffel-Turnier an (Status ``draft``) mit allen Vorgaben aus Season und Liga N, dem Map-Pool der Season
    als eigener Version im Scope ``tournament`` und der Prüfung „Runden ≤ aktive Wochen“."""
    season = await get_season(db, division["season_id"])
    league = await get_league(db, division["league_id"])
    game = await _game(db, league.get("game_id"))
    if not game:
        raise LeagueProblem("Das Spiel der Liga gibt es nicht mehr.")
    if not season.get("start_date"):
        raise LeagueProblem("Die Season braucht zuerst den Beginn der ersten Spielwoche.")
    fields = staffel_fields(league, season, division)
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
    pool = await map_pools.current(db, "league_season", season["id"])
    if pool and pool.get("game_id") == game["id"]:
        await map_pools.copy_version(db, pool, scope="tournament", scope_id=doc["id"], user=user,
                                     tournament_id=doc["id"], note=f"Aus {season.get('name')} übernommen")
    return doc


# ---------------------------------------------------------------- Vorgaben übertragen

async def _has_result(db, tournament_id: str) -> bool:
    rows = await db.matches_v2.find({"tournament_id": tournament_id},
                                    {"_id": 0, "status": 1, "started_at": 1, "reports": 1, "pending_result": 1,
                                     "result_meta": 1}).to_list(None)
    return any(has_started(row) and not is_auto_bye(row) for row in rows)


def _pool_maps(pool: dict | None) -> list:
    return [(group.get("mode"), [item.get("map_id") for item in group.get("maps") or []])
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
    return SyncResult(tournament["id"], tournament.get("title") or "", applied, skipped, changed)


async def _sync_pool(db, tournament: dict, season: dict, user: dict, *, locked: bool, has_result: bool,
                     applied: list, skipped: list, changed: list) -> None:
    """Map-Pool der Season → Staffel. Ein neuer Pool geht immer (Spiele mit festgehaltenem Pool behalten ihren). Hat die
    Season keinen Pool mehr, wird die Kopie der Staffel entfernt - nur vor dem ersten Ergebnis und nicht gesperrt, sonst
    steht der Grund im Ergebnis."""
    pool = await map_pools.current(db, "league_season", season["id"])
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
        await db.tournaments.update_one({"id": row["id"]}, update)
        changed += 1
    return changed


# ---------------------------------------------------------------- Sichtbarkeit (öffentliche Lese-API)

async def can_see_season(user: dict | None, season: dict) -> bool:
    """Ligaseite lesen nach der Sichtbarkeit der Season (docs/LIGA.md, Abschnitt 10): ``off`` niemand (404),
    ``admins`` nur die Turnierleitung, ``members`` wie die Turnier-Sichtbarkeit „Nur Mitglieder“, ``public`` alle."""
    visibility = season.get("visibility") or "off"
    if visibility == "public":
        return True
    if visibility == "members":
        from services.visibility import lead_can_see
        return await lead_can_see(user, "members")
    if visibility == "admins":
        from services.permissions import can_use_area
        return await can_use_area(user, "tournaments")
    return False


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
    out["table_tiebreakers"] = rules.get("table_tiebreakers")
    out["blocked_weeks"] = blocked_weeks(season)
    out["end_date"] = season_end(season)
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
    return {
        "league": {**public_league(league), "game": map_pools.game_summary(game)},
        "season": public_season(season),
        # Gestaltung (#2107): Emblem und Banner Season → Liga → nichts; Farbe der Liga (leer = Vereinsfarbe).
        "look": league_look.effective(league, season),
        # „Um was gespielt wird“ - die Gewinne der Season; eine Liga N mit eigenen trägt sie unter ``prizes``.
        "prizes": list(season.get(league_look.PRIZES) or []),
        "map_pool": pool,
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
