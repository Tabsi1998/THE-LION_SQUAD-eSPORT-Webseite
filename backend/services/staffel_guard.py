"""Liga-Staffel in der Turnierverwaltung (#2109): was dort geändert werden darf und was nicht.

Eine Staffel ist ein Turnier mit ``league_context`` (docs/LIGA.md). Viele ihrer Werte kommen aus der Season (und der
Liga N) und werden beim „Übertragen“ überschrieben (``league_service.SYNC_GROUPS``); andere stehen beim Anlegen fest,
weil es sie in der Liga nicht gibt (Anmeldung, Check-in, Discord, Jahreswertung …). Das Formular zeigt sie nur
lesend oder gar nicht - der Server lehnt Änderungen daran trotzdem ab, damit nichts still beim nächsten Übertragen
verschwindet.

Das Übertragen selbst (``league_service.sync_staffel``, ``apply_visibility``) schreibt direkt in die Datenbank und
läuft nicht über ``update_tournament`` - es bleibt davon unberührt.
"""
from __future__ import annotations

from datetime import datetime, timezone

from services.league_scope import is_league_staffel

FROM_SEASON = "Kommt aus der Season – dort ändern und übertragen."
NOT_IN_LEAGUE = "Gibt es in einer Liga-Staffel nicht."
FIXED_IN_LEAGUE = "Steht bei einer Liga-Staffel fest."

# Feld → (Bezeichnung im Formular, Grund). Was die Season vorgibt (``league_service.staffel_fields``), was beim Anlegen
# fest ist (``league_service.create_staffel``) und was es in der Liga nicht gibt.
STAFFEL_LOCKED_FIELDS: dict[str, tuple[str, str]] = {
    "game_id": ("Spiel", FROM_SEASON),
    "team_size": ("Spieler pro Team", FROM_SEASON),
    "best_of": ("Best of", FROM_SEASON),
    "max_participants": ("Max Teams", FROM_SEASON),
    "start_date": ("Start", FROM_SEASON),
    "end_date": ("Ende", FROM_SEASON),
    "matchday_days": ("Spieltag dauert (Tage)", FROM_SEASON),
    "default_match_weekday": ("Standardtag", FROM_SEASON),
    "default_match_time": ("Standarduhrzeit", FROM_SEASON),
    "result_confirm_hours_league": ("Ergebnis gilt in der Liga nach", FROM_SEASON),
    "rules": ("Regeln", FROM_SEASON),
    "visibility": ("Sichtbarkeit", FROM_SEASON),
    "is_public": ("Auf Public-Seiten sichtbar", FROM_SEASON),
    "format": ("Turnierstruktur", FIXED_IN_LEAGUE),
    "team_mode": ("Teilnahme", FIXED_IN_LEAGUE),
    "min_participants": ("Min Teams", FIXED_IN_LEAGUE),
    "event_mode": ("Austragung", FIXED_IN_LEAGUE),
    "result_entry_mode": ("Ergebniserfassung", FIXED_IN_LEAGUE),
    "schedule_mode": ("Terminplanung", FIXED_IN_LEAGUE),
    "registration_enabled": ("Öffentliche Anmeldung", NOT_IN_LEAGUE),
    "registration_open_from": ("Anmeldung öffnet", NOT_IN_LEAGUE),
    "registration_open_until": ("Anmeldung endet", NOT_IN_LEAGUE),
    "check_in_from": ("Check-in öffnet", NOT_IN_LEAGUE),
    "check_in_until": ("Check-in endet", NOT_IN_LEAGUE),
    "discord_registration": ("Anmeldung über Discord", NOT_IN_LEAGUE),
    "discord_skip": ("Ohne Discord", FIXED_IN_LEAGUE),
    "discord_link": ("Discord-Verweis", NOT_IN_LEAGUE),
    "season_weight": ("Jahreswertung", NOT_IN_LEAGUE),
    # Im Staffel-Formular ausgeblendet (Review #2109) - die Spieltage lost der Start, Podest und Preise gibt es nicht.
    "seeding_mode": ("Seeding", NOT_IN_LEAGUE),
    "advancement_mode": ("Weiterkommen", NOT_IN_LEAGUE),
    "randomize_advancement_rounds": ("Weiterkommen", NOT_IN_LEAGUE),
    "draw_show_minutes": ("Show-Auslosung", NOT_IN_LEAGUE),
    "bronze_match": ("Spiel um Platz 3", NOT_IN_LEAGUE),
    "substitutes_allowed": ("Ersatzspieler", NOT_IN_LEAGUE),
    "prize_pool": ("Preise", NOT_IN_LEAGUE),
    "prize_places": ("Preise", NOT_IN_LEAGUE),
    "award_images": ("Gewinnerbanner", NOT_IN_LEAGUE),
    "no_show_minutes_on_site": ("Nicht erschienen vor Ort", NOT_IN_LEAGUE),
    "no_show_minutes_online": ("Nicht erschienen online", NOT_IN_LEAGUE),
    "result_confirm_minutes_online": ("Ergebnis gilt online nach", NOT_IN_LEAGUE),
    "is_invite_only": ("Nur Einladung", NOT_IN_LEAGUE),
    "requires_event_registration": ("Anmeldung nur mit Event-Anmeldung", NOT_IN_LEAGUE),
    "site_banner_enabled": ("Turnier-Hinweisbanner", NOT_IN_LEAGUE),
    "auto_start_enabled": ("Automatisch live/beendet", NOT_IN_LEAGUE),
}
DATE_FIELDS = frozenset({"start_date", "end_date", "registration_open_from", "registration_open_until",
                         "check_in_from", "check_in_until"})
# Schalter, die fehlend „aus“ heißen: ``False`` und fehlend sind derselbe Wert.
OFF_BY_DEFAULT = frozenset({"bronze_match", "substitutes_allowed", "is_invite_only", "requires_event_registration",
                            "site_banner_enabled", "auto_start_enabled", "randomize_advancement_rounds"})
EMPTY_VALUES = (None, "", {}, [])

# Status einer Staffel (S1): keine Anmeldung, kein Check-in - „Liga starten“ macht den Spielplan fest.
STAFFEL_STATUSES = frozenset({"draft", "live", "paused", "completed", "results_published", "archived", "cancelled"})
STAFFEL_STATUS_REFUSED = ("Eine Liga-Staffel hat keine Anmeldung und keinen Check-in – die Co-Teams werden zugeteilt, "
                          "dann „Liga starten“.")

# Status nur über den Ablauf (S2, alle Turniere): ``POST /status`` prüft und protokolliert, das Formular nicht.
STATUS_ONLY_THROUGH_FLOW = ("Den Status änderst du oben in der Turnierverwaltung – dort laufen die Prüfungen des "
                            "Ablaufs (Spielplan, Check-in, Protokoll).")

STAFFEL_DELETE_REFUSED = ("Diese Staffel hat schon begonnen oder Spiele – Löschen geht nur vor dem Start. Bitte auf "
                          "„Abgesagt“ oder „Archiviert“ setzen.")
STAFFEL_REBUILD_REFUSED = ("Der Spielplan dieser Staffel steht – zurücksetzen oder neu aufbauen geht nur vor dem "
                           "Start. Einzelne Spiele korrigierst du im Reiter „Spiele“.")
STAFFEL_REGISTRATION_REFUSED = ("In einer Liga-Staffel spielen nur Co-Teams – bitte über „Co-Team zuteilen“ "
                                "eintragen.")
SQUAD_UNREGISTER_REFUSED = ("Ein zugeteiltes Co-Team nimmt nur die Turnierleitung wieder aus der Staffel – bitte "
                            "bei der Turnierleitung melden.")

# Vor dem Start einer Staffel (wie ``league_service.PRE_START_STATUSES``).
PRE_START_STATUSES = frozenset({"draft", "scheduled", "registration_open", "registration_closed", "check_in"})


def _instant(value):
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        moment = value
    else:
        try:
            moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return str(value)
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def same_value(key: str, new, old) -> bool:
    """Ändert ``new`` den gespeicherten Wert? Zeiten zählen als Zeitpunkt, leer und fehlend sind gleich."""
    if key in DATE_FIELDS:
        return _instant(new) == _instant(old)
    if key in OFF_BY_DEFAULT and new in (None, False) and old in (None, False):
        return True
    if new in EMPTY_VALUES and old in EMPTY_VALUES:
        return True
    return new == old


def status_problem(updates: dict, existing: dict) -> str | None:
    """Ein anderer Status über das Formular (PATCH) - für alle Turniere abgelehnt. Derselbe Status stört nicht."""
    if "status" not in updates or updates["status"] is None:
        return None
    return None if updates["status"] == existing.get("status") else STATUS_ONLY_THROUGH_FLOW


def staffel_update_problem(updates: dict, existing: dict) -> str | None:
    """Die erste gesperrte Änderung an einer Staffel als deutsche Meldung - oder ``None``."""
    if not is_league_staffel(existing):
        return None
    for key, (label, reason) in STAFFEL_LOCKED_FIELDS.items():
        if key in updates and not same_value(key, updates[key], existing.get(key)):
            return f"{label}: {reason}"
    return None


def staffel_status_problem(tournament: dict, status: str | None) -> str | None:
    """Status, die es für eine Staffel nicht gibt (Anmeldung, Check-in, Angekündigt)."""
    if not is_league_staffel(tournament) or status in STAFFEL_STATUSES:
        return None
    return STAFFEL_STATUS_REFUSED


async def _staffel_started(db, tournament: dict) -> bool:
    """Hat die Staffel begonnen - Status nach dem Start oder schon ein fester (nicht Vorschau-)Spielplan?"""
    if tournament.get("status") not in PRE_START_STATUSES:
        return True
    return bool(await db.matches_v2.count_documents({"tournament_id": tournament["id"], "is_preview": {"$ne": True}}))


async def staffel_delete_problem(db, tournament: dict) -> str | None:
    """Löschen einer Staffel nur vor dem Start und ohne festen Spielplan (S26, L-D3)."""
    if not is_league_staffel(tournament):
        return None
    return STAFFEL_DELETE_REFUSED if await _staffel_started(db, tournament) else None


async def staffel_rebuild_problem(db, tournament: dict) -> str | None:
    """Spielplan zurücksetzen oder neu aufbauen (auch mit ``force``) nur vor dem Start - sonst gingen Spiele samt
    Ergebnissen verloren, und eine zurückgesetzte Staffel ließe sich danach sogar löschen (Review #2109)."""
    if not is_league_staffel(tournament):
        return None
    return STAFFEL_REBUILD_REFUSED if await _staffel_started(db, tournament) else None


async def staffel_links(db, tournament: dict, *, with_admin_path: bool = True) -> dict | None:
    """Für den Kopf der Staffel-Verwaltung (S24, L-C1): „Liga 1 · Staffel A – Season öffnen · Ligaseite“."""
    if not is_league_staffel(tournament):
        return None
    context = tournament["league_context"]
    league = await db.leagues.find_one({"id": context.get("league_id")}, {"_id": 0, "name": 1, "slug": 1}) or {}
    season = await db.league_seasons.find_one({"id": context.get("season_id")},
                                              {"_id": 0, "name": 1, "slug": 1}) or {}
    division = await db.league_divisions.find_one({"id": context.get("division_id")},
                                                  {"_id": 0, "level": 1, "nickname": 1}) or {}
    division_label = None
    if division.get("level") is not None:
        nickname = str(division.get("nickname") or "").strip()
        division_label = f"Liga {division['level']}" + (f" · {nickname}" if nickname else "")
    public_path = f"/liga/{league['slug']}/{season['slug']}" if league.get("slug") and season.get("slug") else None
    links = {
        "league_name": league.get("name"),
        "season_name": season.get("name"),
        "division_label": division_label,
        "staffel": context.get("staffel"),
        "public_path": public_path,
    }
    # Der Weg in die Verwaltung der Season nur für die, die verwalten (Review #2109); Namen und Ligaseite sind
    # öffentlich.
    if with_admin_path and context.get("season_id"):
        links["season_admin_path"] = f"/admin/leagues/seasons/{context['season_id']}"
    return links
