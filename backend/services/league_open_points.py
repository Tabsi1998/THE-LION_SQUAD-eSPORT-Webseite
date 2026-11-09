"""Erinnerungen an fehlende Angaben in der Liga (docs/LIGA.md B.3, #2313).

Fehlende Angaben (Geburtsdatum, Alter, Spiel-ID, Plattform, zu wenige Spielberechtigte) halten die Anmeldung nicht auf, sie sperren erst
Check-in und Aufstellung. Damit das niemanden am Spieltag überrascht, gehen zwei Erinnerungen:

- **beim Einreichen** der Selbstanmeldung (``after_submit``, aus ``league_applications.submit``),
- **vor dem ersten Spiel** der Staffel (``remind_before_first_match``, im Job ``match_reminders``): so viele Stunden vorher, wie
  ``checkin_rules.open_points_remind_hours`` sagt (ohne Regeln 48, 0 = aus).

Jeweils an jede betroffene Person mit selbst behebbarem Stand (Link ins eigene Profil) und an Captain und Vertreter (ohne beide die
Hauptteam-Leitung) eine Übersicht. Beides über ``create_user_notification`` mit ``dedupe_key`` - ein zweiter Lauf schickt nichts.
Nie ein Datum oder Alter: Die Texte kommen aus ``league_eligibility`` (nur Stände und deren Sätze).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from models import now_utc
from services import checkin_rules, league_eligibility, league_roster
from services.log_safe import log_safe

logger = logging.getLogger("tls.league_open_points")

KIND = "tournament_registration"
REASON = "league_open_points"
DEFAULT_HOURS = checkin_rules.DEFAULTS["open_points_remind_hours"]
LONGEST_HOURS = checkin_rules.NUMBERS["open_points_remind_hours"][1]
PLAYED_STATUSES = sorted(checkin_rules.RUNNING_STATUSES | checkin_rules.FINISHED_STATUSES)
SHORT = {
    league_eligibility.AGE_MISSING: "Geburtsdatum fehlt",
    league_eligibility.AGE_NOT_MET_STATE: "Altersvorgabe nicht erfüllt",
    "platform_not_allowed": "Plattform nicht erlaubt",
    "platform_missing": "Plattform fehlt",
    league_roster.MISSING: "Spiel-ID fehlt",
    league_roster.FORMAT: "Format der Spiel-ID passt nicht",
    league_roster.TAKEN: "Spiel-ID schon vergeben",
    league_roster.LATE: "Spiel-ID wartet auf Freigabe",
}
LOCKED_OUT = "Ohne die Angabe kannst du nicht einchecken und nicht aufgestellt werden."


def season_title(league: dict | None, season: dict | None) -> str:
    return " ".join(part for part in ((league or {}).get("name"), (season or {}).get("name")) if part) or "die Liga"


def person_text(title: str, row: dict) -> str:
    reasons = [league_eligibility.self_reason(row["state"], text) if text == row["reason"] else text for text in row["reasons"]]
    return f"Für {title} fehlt bei dir noch: {' '.join(reasons)} {LOCKED_OUT}"


def team_text(title: str, name: str, points: dict) -> str:
    """Die Übersicht für Captain und Vertreter: wer was offen hat, dazu ``shortfall``."""
    parts = [f"{row['name']} ({SHORT.get(row['state'], 'nicht spielberechtigt')})" for row in points["players"]]
    text = f"{name} für {title}: Offen sind noch {', '.join(parts)}." if parts else f"{name} für {title}:"
    if points["shortfall"]:
        text = f"{text} {points['shortfall']}"
    return f"{text} Wer etwas offen hat, kann nicht einchecken und nicht aufgestellt werden."


async def tell(db, points: dict, *, title: str, name: str, responsible: set[str], team_url: str, key: str) -> int:
    """Die Nachrichten zu ``open_points`` - ``key`` + ``:<user>`` ist der Schlüssel. Hält nie etwas auf."""
    from services.user_notifications import create_user_notification

    if not points["players"] and not points["shortfall"]:
        return 0
    sent = 0
    meta = {"reason": REASON}
    for row in points["players"]:
        if not row["fixable"]:
            continue
        if await create_user_notification(row["id"], "Angabe für die Liga fehlt", person_text(title, row), url=row["fix_url"], kind=KIND,
                                          meta={**meta, "dedupe_key": f"{key}:{row['id']}"}):
            sent += 1
    text = team_text(title, name, points)
    for user_id in sorted(responsible):
        if await create_user_notification(user_id, "Offene Punkte im Kader", text, url=team_url, kind=KIND,
                                          meta={**meta, "dedupe_key": f"{key}:{user_id}"}):
            sent += 1
    return sent


async def after_submit(db, league: dict, season: dict, application: dict, squad: dict, *, minimum: int) -> int:
    """Erinnerung beim Einreichen der Selbstanmeldung (Schlüssel ``league-open-points:<antrag>:submit:<user>``)."""
    from services.league_applications import responsible_of

    try:
        members = [uid for uid in squad.get("member_ids") or [] if uid]
        ctx = await league_eligibility.context_for_season(db, season, members)
        points = league_eligibility.open_points(ctx, squad, minimum=minimum)
        return await tell(db, points, title=season_title(league, season), name=application.get("display_name") or squad.get("name") or "Euer Co-Team",
                          responsible=await responsible_of(db, squad), team_url=f"/liga/{league.get('slug')}/{season.get('slug')}",
                          key=f"league-open-points:{application['id']}:submit")
    except Exception:  # noqa: BLE001 - die Anmeldung ist schon gespeichert
        logger.warning("[league_open_points] Erinnerung zum Antrag %s nicht verschickt", log_safe(application.get("id")), exc_info=True)
        return 0


def remind_hours(tournament: dict) -> int:
    rules = checkin_rules.rules_of(tournament)
    return int(rules["open_points_remind_hours"]) if rules else DEFAULT_HOURS


def _minimum(tournament: dict) -> int:
    rules = checkin_rules.rules_of(tournament)
    return int(rules["min_present"]) if rules else league_roster.min_squad_size(tournament)


async def _played(db, tournament_id: str, registration_id: str) -> bool:
    """Hat diese Anmeldung schon ein begonnenes oder entschiedenes Spiel? Dann war das erste Spiel schon."""
    return bool(await db.matches_v2.find_one(
        {"tournament_id": tournament_id, "is_preview": {"$ne": True},
         "$and": [{"$or": [{"participant_a_id": registration_id}, {"participant_b_id": registration_id},
                           {"slots.registration_id": registration_id}]},
                  {"$or": [{"started_at": {"$ne": None}}, {"status": {"$in": PLAYED_STATUSES}}]}]},
        {"_id": 1}))


async def _remind_side(db, tournament: dict, match: dict, registration: dict, title: str) -> int:
    from services.match_audience import responsible_ids, teams_by_id

    squad = await db.team_squads.find_one({"id": registration.get("squad_id")}, {"_id": 0}) if registration.get("squad_id") else None
    if not squad or await _played(db, tournament["id"], registration["id"]):
        return 0
    members = [uid for uid in squad.get("member_ids") or [] if uid]
    ctx = await league_eligibility.context_for_tournament(db, tournament, members)
    points = league_eligibility.open_points(ctx, squad, minimum=_minimum(tournament))
    if not points["players"] and not points["shortfall"]:
        return 0
    responsible = responsible_ids(registration, (await teams_by_id(db, [registration])).get(registration.get("team_id") or ""))
    return await tell(db, points, title=title, name=registration.get("display_name") or squad.get("name") or "Euer Co-Team",
                      responsible=responsible, team_url=f"/matches/{match['id']}",
                      key=f"league-open-points:{registration['id']}:first-match")


async def remind_before_first_match(db, *, now: datetime | None = None) -> int:
    """Ein Lauf: Staffeln mit einem offenen Spiel innerhalb ihrer Vorlaufzeit, je Seite einmal vor dem ersten Spiel."""
    from services.league_scope import is_league_staffel
    from services.match_audience import registrations_for_match

    now = now or now_utc()
    matches = await db.matches_v2.find(
        {"status": {"$in": sorted(checkin_rules.OPEN_MATCH_STATUSES)}, "started_at": None, "is_preview": {"$ne": True},
         "scheduled_at": {"$gt": now.isoformat(), "$lte": (now + timedelta(hours=LONGEST_HOURS)).isoformat()}},
        {"_id": 0}).sort("scheduled_at", 1).to_list(2000)
    tournaments: dict[str, dict | None] = {}
    titles: dict[str, str] = {}
    sent = 0
    for match in matches:
        tid = match.get("tournament_id")
        if tid not in tournaments:
            tournaments[tid] = await db.tournaments.find_one({"id": tid}, {"_id": 0})
        tournament = tournaments[tid]
        if not tournament or not is_league_staffel(tournament):
            continue
        hours = remind_hours(tournament)
        scheduled = checkin_rules.moment(match.get("scheduled_at"))
        if not hours or not scheduled or scheduled > now + timedelta(hours=hours):
            continue
        if tid not in titles:
            context = tournament.get("league_context") or {}
            season = await db.league_seasons.find_one({"id": context.get("season_id")}, {"_id": 0, "name": 1, "league_id": 1}) or {}
            league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "name": 1}) or {}
            titles[tid] = season_title(league, season)
        for registration in await registrations_for_match(db, match):
            try:
                sent += await _remind_side(db, tournament, match, registration, titles[tid])
            except Exception:  # noqa: BLE001 - eine Seite hält die anderen nicht auf
                logger.warning("[league_open_points] Seite %s nicht erinnert", log_safe(registration.get("id")), exc_info=True)
    return sent
