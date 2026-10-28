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
}
DATE_FIELDS = frozenset({"start_date", "end_date", "registration_open_from", "registration_open_until",
                         "check_in_from", "check_in_until"})

# Status einer Staffel (S1): keine Anmeldung, kein Check-in - „Liga starten“ macht den Spielplan fest.
STAFFEL_STATUSES = frozenset({"draft", "live", "paused", "completed", "results_published", "archived", "cancelled"})
STAFFEL_STATUS_REFUSED = ("Eine Liga-Staffel hat keine Anmeldung und keinen Check-in – die Co-Teams werden zugeteilt, "
                          "dann „Liga starten“.")

# Status nur über den Ablauf (S2, alle Turniere): ``POST /status`` prüft und protokolliert, das Formular nicht.
STATUS_ONLY_THROUGH_FLOW = ("Den Status änderst du oben in der Turnierverwaltung – dort laufen die Prüfungen des "
                            "Ablaufs (Spielplan, Check-in, Protokoll).")

STAFFEL_DELETE_REFUSED = ("Diese Staffel hat schon begonnen oder Spiele – Löschen geht nur vor dem Start. Bitte auf "
                          "„Abgesagt“ oder „Archiviert“ setzen.")
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
    if new in (None, "") and old in (None, ""):
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


async def staffel_delete_problem(db, tournament: dict) -> str | None:
    """Löschen einer Staffel nur vor dem Start und ohne festen Spielplan (S26, L-D3)."""
    if not is_league_staffel(tournament):
        return None
    if tournament.get("status") not in PRE_START_STATUSES:
        return STAFFEL_DELETE_REFUSED
    fixed = await db.matches_v2.count_documents({"tournament_id": tournament["id"], "is_preview": {"$ne": True}})
    return STAFFEL_DELETE_REFUSED if fixed else None


async def staffel_links(db, tournament: dict) -> dict | None:
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
    return {
        "league_name": league.get("name"),
        "season_name": season.get("name"),
        "division_label": division_label,
        "staffel": context.get("staffel"),
        "season_admin_path": f"/admin/leagues/seasons/{context['season_id']}" if context.get("season_id") else None,
        "public_path": public_path,
    }
