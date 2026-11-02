"""Selbstanmeldung mit Co-Team (docs/LIGA.md, Abschnitt 12, B.4, #2205).

Der Antrag gilt der Season, die Staffel steht erst nach der Genehmigung fest - darum eine eigene Sammlung. Erst beim Zuteilen entsteht wie immer die
``tournament_registrations``-Zeile (``squad_registration.build_registration``). Ohne Anmeldefenster an der Season gibt es das alles nicht.

Gleichzeitigkeit: Einreichen, Rückzug und Entscheidungen halten die Season-Sperre (dieselbe wie beim Zuteilen), beim Zuteilen zuerst die Turnier-Sperre. Der Status wechselt
nur mit Bedingung auf den alten Stand, ``active_key`` hält „ein offener Antrag je Season und Co-Team“ auch ohne Sperre.

Datenschutz: Andere Teams und Gäste sehen keinen Antrag. Kein Geburtsdatum: Die Prüfung liefert nur den Stand aus ``league_eligibility``.
"""

from __future__ import annotations

import contextlib
import logging
from datetime import datetime

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services import league_eligibility, league_roster, league_rules, league_service, squad_registration
from services.discord_roles import load_games, top_game
from services.league_mail import send_league_mail
from services.league_permissions import staff_user_ids
from services.league_scope import ONLY_LEAGUE
from services.league_service import LeagueProblem
from services.log_safe import log_safe
from services.match_audience import responsible_ids, teams_by_id
from services.mutation_lock import MutationLockBusy, league_season_resource, mutation_lock, tournament_write_resource
from services.visibility import user_can_see

logger = logging.getLogger("tls.league_applications")

SUBMITTED, IN_REVIEW, ACCEPTED, REJECTED, WAITLIST, WITHDRAWN = "submitted", "in_review", "accepted", "rejected", "waitlist", "withdrawn"
# Zwei Zustände stehen nur in der Antwort, weil es keinen Antrag gibt.
NOT_APPLIED, OPEN_TO_APPLY = "none", "open"
OPEN_STATUSES = (SUBMITTED, IN_REVIEW, WAITLIST, ACCEPTED)
UPCOMING, OPEN, CLOSED = "upcoming", "open", "closed"
SEAT_STATUSES = squad_registration.SEAT_STATUSES
REASON_MIN = league_roster.REASON_MIN_LENGTH
VIA = "league_application"
LOCK_WAIT_SECONDS = 10.0
PRIVACY_URL = "/privacy"
# Platzhalter, bis der Wortlaut freigegeben ist (Entscheidung Nr. 1): Die Leitung ersetzt ihn je Season, er ist kein Rechtstext.
PRIVACY_PLACEHOLDER = "Für die Anmeldung speichert der Verein die Angaben deines Co-Teams. Mehr dazu steht in der Datenschutzerklärung."

NO_WINDOW = "Für diese Season gibt es keine Selbstanmeldung."
NO_RULES = "Für diese Season ist noch kein gültiges Regelwerk veröffentlicht. Ohne Regelwerk geht keine Anmeldung, die Liga-Leitung veröffentlicht es zuerst."
RULES_CHANGED = "Das Regelwerk hat sich geändert. Bitte die Seite neu laden und der neuen Fassung zustimmen."
ACCEPT_BOTH = "Bitte stimme den Regeln und dem Hinweis zum Datenschutz ausdrücklich zu."
NOT_RESPONSIBLE = "Anmelden und zurückziehen dürfen nur Captain und Vertreter des Co-Teams."
ALREADY_OPEN = "Für dieses Co-Team läuft schon eine Anmeldung."
FINISHED = "Diese Season ist beendet."
NO_SEATS = "Alle Startplätze sind vergeben."
NO_SEATS_NO_WAITLIST = "Alle Startplätze sind vergeben, und die Warteliste ist voll oder gibt es nicht."
SEATS_TAKEN = "Alle Startplätze sind vergeben. Setz das Co-Team auf die Warteliste oder gib erst einen Platz frei."
NO_WAITLIST = "Diese Season hat keine Warteliste."
WAITLIST_FULL = "Die Warteliste ist voll."
DECIDED = "Dieser Antrag hat sich schon geändert. Bitte neu laden."
ASSIGNED_ALREADY = "Dieses Co-Team ist schon zugeteilt. Das Herausnehmen geht über die Teilnehmerliste der Staffel."
WITHDRAW_ASSIGNED = "Das Co-Team ist schon einer Staffel zugeteilt. Den Austritt trägt die Liga-Leitung ein."
GONE = "Diesen Antrag gibt es nicht."
BUSY = "An dieser Season wird gerade etwas geändert. Bitte gleich noch einmal versuchen."
STAFFEL_GONE = "Diese Staffel gehört nicht zu dieser Season."
SQUAD_GONE = "Das Co-Team gibt es nicht mehr."


# ---------------------------------------------------------------- Fenster und Plätze

def _moment(value) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def window_state(season: dict, now: datetime | None = None) -> str | None:
    """``None``: Die Season hat kein Fenster, also keine Selbstanmeldung."""
    opens, closes = _moment(season.get("application_opens_at")), _moment(season.get("application_closes_at"))
    if not opens or not closes:
        return None
    moment = now or now_utc()
    if moment < opens:
        return UPCOMING
    return OPEN if moment < closes else CLOSED


async def _staffel_ids(db, season_id: str) -> list[str]:
    return [row["id"] for row in await db.tournaments.find({"league_context.season_id": season_id, **ONLY_LEAGUE}, {"_id": 0, "id": 1}).to_list(200)]


async def seat_stats(db, season: dict) -> dict:
    """Belegt sind aktive Co-Team-Anmeldungen der Staffeln und angenommene Anträge ohne Zuteilung. Die Warteliste belegt nichts."""
    ids = await _staffel_ids(db, season["id"])
    seated = await db.tournament_registrations.count_documents(
        {"tournament_id": {"$in": ids}, "squad_id": {"$exists": True}, "status": {"$in": list(SEAT_STATUSES)}}) if ids else 0
    counts = dict.fromkeys(OPEN_STATUSES, 0)
    unassigned = 0
    async for row in db.league_applications.find({"season_id": season["id"], "status": {"$in": list(OPEN_STATUSES)}}, {"_id": 0, "status": 1, "assignment": 1}):
        counts[row["status"]] += 1
        if row["status"] == ACCEPTED and not row.get("assignment"):
            unassigned += 1
    slots = season.get("application_slots")
    taken = seated + unassigned
    return {"slots": slots, "taken": taken, "free": max(0, slots - taken) if slots else None, "full": bool(slots and taken >= slots),
            "waiting": counts[WAITLIST], "open": counts[SUBMITTED] + counts[IN_REVIEW], "unassigned": unassigned}


def _waitlist_has_room(season: dict, stats: dict) -> bool:
    limit = season.get("application_waitlist_limit")
    return bool(season.get("application_waitlist")) and (not limit or stats["waiting"] < limit)


async def public_block(db, season: dict) -> dict | None:
    """Für alle: Fenster-Stand, freie Plätze, Warteliste. Keine Personen, keine Anträge. ``None``: keine Selbstanmeldung."""
    state = window_state(season)
    if not state:
        return None
    stats = await seat_stats(db, season)
    return {"state": state, "opens_at": season.get("application_opens_at"), "closes_at": season.get("application_closes_at"),
            "slots": stats["slots"], "slots_free": stats["free"], "waitlist": bool(season.get("application_waitlist")),
            "waitlist_full": bool(season.get("application_waitlist")) and not _waitlist_has_room(season, stats),
            "waitlist_note": season.get("application_waitlist_note"), "entry_policy": season.get("entry_policy") or "all"}


# ---------------------------------------------------------------- Prüfung

def _when(value: str | None) -> str:
    from services.matchday_schedule import LOCAL_TZ

    return _moment(value).astimezone(LOCAL_TZ).strftime("%d.%m.%Y, %H:%M") if value else ""


async def season_problems(db, league: dict, season: dict, stats: dict | None = None) -> list[str]:
    """Was gegen jede Anmeldung spricht, egal welches Co-Team."""
    state = window_state(season)
    if not state:
        return [NO_WINDOW]
    problems: list[str] = []
    if (season.get("status") or "draft") in ("completed", "archived"):
        problems.append(FINISHED)
    if state == UPCOMING:
        problems.append(f"Die Anmeldung öffnet am {_when(season.get('application_opens_at'))} Uhr.")
    if state == CLOSED:
        problems.append(f"Die Anmeldung ist vorbei: Sie lief bis {_when(season.get('application_closes_at'))} Uhr.")
    if not await league_rules.current_version(db, league, season):
        problems.append(NO_RULES)
    stats = stats or await seat_stats(db, season)
    if stats["full"] and not _waitlist_has_room(season, stats):
        problems.append(NO_SEATS_NO_WAITLIST)
    return problems


async def _min_size(db, season: dict) -> int:
    """Der kleinste Mindestkader aller aktiven Liga N: Die Liga steht noch nicht fest. Beim Zuteilen zählt der genaue Wert der Staffel."""
    divisions = await db.league_divisions.find({"season_id": season["id"], "status": "active"}, {"_id": 0}).to_list(50)
    rows = [league_service.effective_settings(season, division) for division in divisions] or [season]
    return min(league_roster.min_squad_size(row) for row in rows)


async def _non_members(db, squad: dict) -> list[str]:
    members = [uid for uid in squad.get("member_ids") or [] if uid]
    rows = await db.users.find({"id": {"$in": members}}, {"_id": 0, "id": 1, "role": 1, "areas": 1, "is_club_member": 1, "display_name": 1, "username": 1}).to_list(len(members) + 1)
    return [league_roster.person_name(row) for row in rows if not await user_can_see(row, "members", for_request=False)]


async def check_squad(db, league: dict, season: dict, team: dict, squad: dict, *, application: dict | None = None) -> dict:
    """Die Prüfung im Klartext: ``problems`` (Statuscode, Satz) halten die Anmeldung auf, ``warnings`` stehen nur da.
    ``application``: Der eigene Antrag zählt nicht als „läuft schon“."""
    problems: list[tuple[int, str]] = []
    other_open = await db.league_applications.find_one({"season_id": season["id"], "squad_id": squad["id"], "active_key": {"$exists": True},
                                                        "id": {"$ne": (application or {}).get("id")}}, {"_id": 1})
    if other_open:
        problems.append((409, ALREADY_OPEN))
    minimum = await _min_size(db, season)
    problems += await squad_registration.season_problems(db, season, league.get("game_id"), team, squad, min_size=minimum)
    members = [uid for uid in squad.get("member_ids") or [] if uid]
    ctx = await league_eligibility.context_for_season(db, season, members)
    problems += league_eligibility.registration_problems(ctx, squad)
    if (season.get("entry_policy") or "all") == "members":
        outsiders = await _non_members(db, squad)
        if outsiders:
            problems.append((400, f"{squad.get('name')}: Diese Season ist nur für Mitglieder. Keine Mitglieder: {', '.join(sorted(outsiders))}."))
    rows = league_eligibility.statuses(ctx, members, squad["id"])
    ready = [row for row in rows.values() if row["ok"]]
    if len(members) >= minimum and len(ready) < minimum:
        problems.append((400, f"{squad.get('name')}: Nur {len(ready)} Spieler sind spielberechtigt, die Season verlangt mindestens {minimum}. "
                              "Fehlende Spiel-IDs tragen die Spieler im eigenen Profil ein."))
    # Alter und andere Co-Teams stehen schon oben als Grund.
    named = (league_eligibility.AGE_MISSING, league_eligibility.AGE_NOT_MET_STATE, league_eligibility.OTHER_TEAM)
    warnings = [f"{row['name']}: {row['reason']}" for row in rows.values() if not row["ok"] and row["state"] not in named]
    return {"problems": problems, "warnings": sorted(warnings)}


# ---------------------------------------------------------------- Wer darf

def _side(squad: dict) -> dict:
    return {"team_id": squad.get("team_id"), "squad_id": squad.get("id")}


async def _responsible(db, squad: dict) -> set[str]:
    """Captain und Vertreter, ohne beide die Hauptteam-Leitung - wer eine Nachricht bekommt."""
    side = _side(squad)
    return responsible_ids(side, (await teams_by_id(db, [side])).get(squad.get("team_id") or ""))


async def may_apply(db, user: dict, squad: dict) -> bool:
    """Nur Captain und Vertreter, soweit sie noch im Hauptteam und nicht gesperrt sind. Die Hauptteam-Leitung ersetzt sie hier nicht."""
    if user.get("id") not in {squad.get("captain_id"), squad.get("vice_captain_id")}:
        return False
    return user["id"] in await _responsible(db, squad)


def _leads(team: dict) -> set[str]:
    return {team.get("leader_id"), *(team.get("co_leader_ids") or [])}


async def _load_side(db, squad_id: str) -> tuple[dict | None, dict | None]:
    squad = await db.team_squads.find_one({"id": squad_id}, {"_id": 0})
    team = await db.teams.find_one({"id": squad["team_id"]}, {"_id": 0}) if squad else None
    return (team, squad) if team else (None, None)


# ---------------------------------------------------------------- Schreiben

@contextlib.asynccontextmanager
async def _season_lock(db, season_id: str):
    """Öffnet das Fenster, melden sich viele im selben Moment: Sie stellen sich an, statt nach zwei Sekunden abzubrechen."""
    try:
        async with mutation_lock(db, league_season_resource(season_id), wait_seconds=LOCK_WAIT_SECONDS):
            yield
    except MutationLockBusy:
        raise LeagueProblem(BUSY, 409) from None


async def _audit(db, action: str, application: dict, actor_id: str | None, **data) -> None:
    await db.audit_logs.insert_one({
        "id": new_id(), "action": f"league.application.{action}", "target_id": application.get("season_id"), "actor_id": actor_id,
        "data": {"application_id": application.get("id"), "squad_id": application.get("squad_id"), "team_id": application.get("team_id"), **data},
        "created_at": now_utc().isoformat(),
    })


async def submit(db, league: dict, season: dict, body: dict, user: dict) -> dict:
    """Einreichen: unter der Sperre der Season noch einmal alles prüfen, dann Antrag und Zustimmung schreiben. Wirft ``LeagueProblem``."""
    if not body.get("accept_rules") or not body.get("accept_privacy"):
        raise LeagueProblem(ACCEPT_BOTH)
    team, squad = await _load_side(db, body["squad_id"])
    if not squad or not await may_apply(db, user, squad):
        raise LeagueProblem(NOT_RESPONSIBLE, 403)
    async with _season_lock(db, season["id"]):
        fresh = await league_service.get_season(db, season["id"])
        blocked = await season_problems(db, league, fresh)
        if blocked:
            raise LeagueProblem(blocked[0], 409)
        version = await league_rules.current_version(db, league, fresh)
        if version["id"] != body.get("rule_version_id"):
            raise LeagueProblem(RULES_CHANGED, 409)
        problems = (await check_squad(db, league, fresh, team, squad))["problems"]
        if problems:
            raise LeagueProblem(problems[0][1], problems[0][0])
        application = await _write(db, league, fresh, version, team, squad, user)
    await _audit(db, "submit", application, user["id"], version=version.get("version"))
    await _tell_status(db, league, season, application, SUBMITTED, squad=squad)
    return application


async def _write(db, league: dict, season: dict, version: dict, team: dict, squad: dict, user: dict) -> dict:
    now = now_utc().isoformat()
    application_id = new_id()
    doc = {
        "id": application_id, "league_id": league["id"], "season_id": season["id"], "team_id": team["id"], "squad_id": squad["id"],
        "team_name": team.get("name"), "squad_name": squad.get("name"), "display_name": squad_registration.display_name(team, squad),
        "status": SUBMITTED, "active_key": f"{season['id']}:{squad['id']}", "applied_by": user["id"], "submitted_at": now,
        "privacy_consent": {"text": season.get("application_privacy_text") or PRIVACY_PLACEHOLDER, "user_id": user["id"], "at": now},
        "history": [{"status": SUBMITTED, "by": user["id"], "at": now}], "created_at": now, "updated_at": now,
    }
    try:
        await db.league_applications.insert_one(dict(doc))
    except DuplicateKeyError:
        raise LeagueProblem(ALREADY_OPEN, 409) from None
    try:
        consent = await league_rules.record_consent(db, league["id"], version, season["id"], squad["id"], team["id"], user["id"])
    except Exception:
        # Ohne Zustimmung gibt es keinen Antrag.
        await db.league_applications.delete_one({"id": application_id})
        raise
    rule_consent = {"consent_id": consent["id"], "rule_version_id": version["id"], "version": version.get("version"), "user_id": user["id"], "at": consent["created_at"]}
    await db.league_applications.update_one({"id": application_id}, {"$set": {"rule_consent": rule_consent}})
    return {**doc, "rule_consent": rule_consent}


async def _load(db, season_id: str, application_id: str) -> dict:
    application = await db.league_applications.find_one({"id": application_id, "season_id": season_id}, {"_id": 0})
    if not application:
        raise LeagueProblem(GONE, 404)
    return application


async def _move(db, application: dict, status: str, actor_id: str | None, *, fields: dict | None = None, reason: str | None = None, keep_active: bool = True) -> dict:
    """Der Statuswechsel mit Bedingung auf den alten Stand. Antwortet mit 409, wenn inzwischen etwas anderes geschah."""
    now = now_utc().isoformat()
    step = {"status": status, "by": actor_id, "at": now, **({"reason": reason} if reason else {})}
    update: dict = {"$set": {"status": status, "updated_at": now, **(fields or {})}, "$push": {"history": step}}
    if not keep_active:
        update["$unset"] = {"active_key": ""}
    query = {"id": application["id"], "status": application["status"], "assignment": {"$exists": bool(application.get("assignment"))}}
    written = await db.league_applications.update_one(query, update)
    if not written.modified_count:
        raise LeagueProblem(DECIDED, 409)
    out = {**application, **update["$set"], "history": [*(application.get("history") or []), step]}
    if not keep_active:
        out.pop("active_key", None)
    return out


async def withdraw(db, league: dict, season: dict, application_id: str, user: dict) -> dict:
    application = await _load(db, season["id"], application_id)
    _team, squad = await _load_side(db, application["squad_id"])
    if not squad or not await may_apply(db, user, squad):
        raise LeagueProblem(NOT_RESPONSIBLE, 403)
    async with _season_lock(db, season["id"]):
        application = await _load(db, season["id"], application_id)
        if application["status"] not in OPEN_STATUSES:
            raise LeagueProblem(DECIDED, 409)
        if application.get("assignment"):
            raise LeagueProblem(WITHDRAW_ASSIGNED, 409)
        now = now_utc().isoformat()
        done = await _move(db, application, WITHDRAWN, user["id"], fields={"withdrawn_by": user["id"], "withdrawn_at": now}, keep_active=False)
    await _audit(db, "withdraw", done, user["id"])
    await _tell_status(db, league, season, done, WITHDRAWN, squad=squad)
    return done


async def review(db, league: dict, season: dict, application_id: str, actor: dict) -> dict:
    async with _season_lock(db, season["id"]):
        application = await _load(db, season["id"], application_id)
        if application["status"] != SUBMITTED:
            raise LeagueProblem(DECIDED, 409)
        done = await _move(db, application, IN_REVIEW, actor["id"])
    await _audit(db, "review", done, actor["id"])
    return done


async def reject(db, league: dict, season: dict, application_id: str, reason: str | None, actor: dict) -> dict:
    text = (reason or "").strip()
    if len(text) < REASON_MIN:
        raise LeagueProblem(f"Bitte einen Grund angeben (mindestens {REASON_MIN} Zeichen). Das Team liest ihn.")
    async with _season_lock(db, season["id"]):
        application = await _load(db, season["id"], application_id)
        if application["status"] not in OPEN_STATUSES:
            raise LeagueProblem(DECIDED, 409)
        if application.get("assignment"):
            raise LeagueProblem(ASSIGNED_ALREADY, 409)
        now = now_utc().isoformat()
        done = await _move(db, application, REJECTED, actor["id"], reason=text, keep_active=False,
                           fields={"decided_by": actor["id"], "decided_at": now, "decision_reason": text})
    await _audit(db, "reject", done, actor["id"], reason=text)
    await _tell_status(db, league, season, done, REJECTED)
    return done


async def waitlist(db, league: dict, season: dict, application_id: str, reason: str | None, actor: dict) -> dict:
    text = (reason or "").strip() or None
    async with _season_lock(db, season["id"]):
        fresh = await league_service.get_season(db, season["id"])
        application = await _load(db, season["id"], application_id)
        if application["status"] not in (SUBMITTED, IN_REVIEW, ACCEPTED):
            raise LeagueProblem(DECIDED, 409)
        if application.get("assignment"):
            raise LeagueProblem(ASSIGNED_ALREADY, 409)
        if not fresh.get("application_waitlist"):
            raise LeagueProblem(NO_WAITLIST, 409)
        if not _waitlist_has_room(fresh, await seat_stats(db, fresh)):
            raise LeagueProblem(WAITLIST_FULL, 409)
        now = now_utc().isoformat()
        done = await _move(db, application, WAITLIST, actor["id"], reason=text, fields={"decided_by": actor["id"], "decided_at": now, "decision_reason": text})
    await _audit(db, "waitlist", done, actor["id"], **({"reason": text} if text else {}))
    await _tell_status(db, league, season, done, WAITLIST)
    return done


async def _load_staffel(db, season: dict, tournament_id: str) -> dict:
    tournament = await db.tournaments.find_one({"id": tournament_id, "league_context.season_id": season["id"], **ONLY_LEAGUE}, {"_id": 0})
    if not tournament:
        raise LeagueProblem(STAFFEL_GONE, 404)
    return tournament


@contextlib.asynccontextmanager
async def _staffel_lock(db, tournament_id: str | None):
    """Die Turnier-Sperre, immer vor der Season-Sperre."""
    if not tournament_id:
        yield
        return
    try:
        async with mutation_lock(db, tournament_write_resource(tournament_id)):
            yield
    except MutationLockBusy:
        raise LeagueProblem(BUSY, 409) from None


async def _staffel_for_write(db, season: dict, tournament_id: str) -> dict:
    from routes.tournament_common import TOURNAMENT_MUTATION_LOCKED_DETAIL, _is_tournament_locked

    tournament = await _load_staffel(db, season, tournament_id)
    if _is_tournament_locked(tournament):
        raise LeagueProblem(TOURNAMENT_MUTATION_LOCKED_DETAIL, 423)
    return tournament


async def _insert_registration(db, tournament: dict, application: dict, actor: dict) -> dict:
    """Prüft die Staffel noch einmal (der Kader kann sich seit dem Einreichen geändert haben) und schreibt die Anmeldung."""
    consent = bool(application.get("rule_consent") and application.get("privacy_consent"))
    try:
        registration = await squad_registration.build_registration(
            db, tournament, application["team_id"], application["squad_id"], actor, consent=consent, via=VIA, source=VIA,
            application_id=application["id"], registered_by=application.get("applied_by"))
    except squad_registration.SquadAssignError as refusal:
        raise LeagueProblem(refusal.detail, refusal.status_code) from None
    try:
        await db.tournament_registrations.insert_one(dict(registration))
    except DuplicateKeyError:
        raise LeagueProblem(squad_registration.SEASON_TAKEN, 409) from None
    return registration


async def _assignment(db, tournament: dict, registration: dict, actor_id: str | None) -> dict:
    context = tournament["league_context"]
    division = await db.league_divisions.find_one({"id": context.get("division_id")}, {"_id": 0}) or {}
    return {"division_id": context.get("division_id"), "tournament_id": tournament["id"], "staffel": context.get("staffel"),
            "label": " · ".join(part for part in (league_service.division_label(division) if division else None, f"Staffel {context.get('staffel')}") if part),
            "registration_id": registration["id"], "assigned_by": actor_id, "assigned_at": now_utc().isoformat()}


async def _after_assign(db, tournament: dict, registration: dict, actor: dict) -> list[str]:
    """Wie beim Zuteilen: Vorschau auffrischen, Spiel-IDs festhalten. Sagt, wem die ID noch fehlt."""
    from routes.tournament_registration_routes import _refresh_tournament_previews_after_registration

    await _refresh_tournament_previews_after_registration(db, tournament, actor.get("id"))
    squad = await db.team_squads.find_one({"id": registration["squad_id"]}, {"_id": 0, "id": 1, "member_ids": 1}) or {}
    ids = await league_roster.after_assign(db, tournament, registration, squad, actor.get("id"))
    return sorted(row["name"] for row in league_roster.waiting_for_id(ids.values()))


async def accept(db, league: dict, season: dict, application_id: str, tournament_id: str | None, actor: dict) -> dict:
    """Annehmen, mit ``tournament_id`` gleich zuteilen. Der letzte Platz geht unter der Season-Sperre nur einmal weg."""
    registration = None
    tournament = None
    async with _staffel_lock(db, tournament_id):
        async with _season_lock(db, season["id"]):
            fresh = await league_service.get_season(db, season["id"])
            application = await _load(db, season["id"], application_id)
            if application["status"] not in (SUBMITTED, IN_REVIEW, WAITLIST):
                raise LeagueProblem(DECIDED, 409)
            if (await seat_stats(db, fresh))["full"]:
                raise LeagueProblem(SEATS_TAKEN, 409)
            team, squad = await _load_side(db, application["squad_id"])
            if not squad:
                raise LeagueProblem(SQUAD_GONE, 409)
            problems = (await check_squad(db, league, fresh, team, squad, application=application))["problems"]
            if problems:
                raise LeagueProblem(problems[0][1], problems[0][0])
            now = now_utc().isoformat()
            fields = {"decided_by": actor["id"], "decided_at": now, "decision_reason": None}
            if tournament_id:
                tournament = await _staffel_for_write(db, fresh, tournament_id)
                registration = await _insert_registration(db, tournament, application, actor)
                fields["assignment"] = await _assignment(db, tournament, registration, actor["id"])
            try:
                done = await _move(db, application, ACCEPTED, actor["id"], fields=fields)
            except LeagueProblem:
                if registration:
                    await db.tournament_registrations.delete_one({"id": registration["id"]})
                raise
        ids_missing = await _after_assign(db, tournament, registration, actor) if registration else []
    await _audit(db, "accept", done, actor["id"], **({"tournament_id": tournament_id} if tournament_id else {}))
    await _tell_status(db, league, season, done, ACCEPTED, squad=squad)
    return {**done, "ids_missing": ids_missing}


async def assign(db, league: dict, season: dict, application_id: str, tournament_id: str | None, actor: dict) -> dict:
    """Einen angenommenen Antrag einer Staffel zuteilen - erst hier entsteht die Anmeldung."""
    if not tournament_id:
        raise LeagueProblem("Bitte eine Staffel wählen.")
    async with _staffel_lock(db, tournament_id):
        async with _season_lock(db, season["id"]):
            fresh = await league_service.get_season(db, season["id"])
            application = await _load(db, season["id"], application_id)
            if application["status"] != ACCEPTED:
                raise LeagueProblem(DECIDED, 409)
            if application.get("assignment"):
                raise LeagueProblem(ASSIGNED_ALREADY, 409)
            tournament = await _staffel_for_write(db, fresh, tournament_id)
            registration = await _insert_registration(db, tournament, application, actor)
            fields = {"assignment": await _assignment(db, tournament, registration, actor["id"])}
            try:
                done = await _move(db, application, ACCEPTED, actor["id"], fields=fields)
            except LeagueProblem:
                await db.tournament_registrations.delete_one({"id": registration["id"]})
                raise
        ids_missing = await _after_assign(db, tournament, registration, actor)
    await _audit(db, "assign", done, actor["id"], tournament_id=tournament_id)
    await _tell_status(db, league, season, done, "assigned")
    return {**done, "ids_missing": ids_missing}


# ---------------------------------------------------------------- Sonderweg: Zuteilen ohne Antrag

async def link_admin_assignment(db, tournament: dict, registration: dict, actor_id: str | None) -> None:
    """Teilt die Leitung ein Co-Team mit offenem Antrag direkt zu, gilt der Antrag als angenommen. Ohne Antrag passiert nichts. Aufrufer halten die Sperre."""
    season_id = (tournament.get("league_context") or {}).get("season_id")
    if not season_id or not registration.get("squad_id"):
        return
    application = await db.league_applications.find_one({"active_key": f"{season_id}:{registration['squad_id']}"}, {"_id": 0})
    if not application or application.get("assignment"):
        return
    now = now_utc().isoformat()
    fields = {"assignment": await _assignment(db, tournament, registration, actor_id), "decided_by": actor_id, "decided_at": now}
    with contextlib.suppress(LeagueProblem):
        await _move(db, application, ACCEPTED, actor_id, fields=fields)


async def clear_assignment(db, registration_id: str, actor_id: str | None) -> None:
    """Nimmt die Leitung die Zuteilung zurück, bleibt der Antrag angenommen und belegt einen Platz, bis sie neu entscheidet."""
    now = now_utc().isoformat()
    await db.league_applications.update_one(
        {"assignment.registration_id": registration_id},
        {"$unset": {"assignment": ""}, "$set": {"updated_at": now}, "$push": {"history": {"status": ACCEPTED, "by": actor_id, "at": now, "reason": "Zuteilung zurückgenommen"}}})


async def open_application_of(db, squad_id: str) -> dict | None:
    """Ein offener Antrag ohne Zuteilung: Solange er läuft, bleibt das Co-Team, wie es ist."""
    return await db.league_applications.find_one({"squad_id": squad_id, "active_key": {"$exists": True}, "assignment": {"$exists": False}}, {"_id": 0})


# ---------------------------------------------------------------- Nachrichten

def _season_title(league: dict, season: dict) -> str:
    return " ".join(part for part in (league.get("name"), season.get("name")) if part)


def _texts(application: dict, title: str, status: str) -> tuple[str, str]:
    name = application.get("display_name") or "Dein Co-Team"
    label = (application.get("assignment") or {}).get("label")
    if status == SUBMITTED:
        return "Anmeldung eingereicht", f"{name} ist für {title} eingereicht. Die Liga-Leitung prüft die Anmeldung und meldet sich."
    if status == ACCEPTED:
        if label:
            return "Anmeldung angenommen", f"{name} spielt in {title}: {label}."
        return "Anmeldung angenommen", f"{name} hat einen Startplatz in {title}. Liga und Staffel teilt die Liga-Leitung noch zu."
    if status == "assigned":
        return "Liga und Staffel stehen", f"{name} spielt in {title}: {label}."
    if status == REJECTED:
        return "Anmeldung abgelehnt", f"Die Liga-Leitung hat die Anmeldung von {name} für {title} abgelehnt: {application.get('decision_reason')}"
    if status == WAITLIST:
        return "Auf der Warteliste", f"{name} steht für {title} auf der Warteliste. Wird ein Platz frei, entscheidet die Liga-Leitung."
    return "Anmeldung zurückgezogen", f"Die Anmeldung von {name} für {title} ist zurückgezogen."


async def _tell_status(db, league: dict, season: dict, application: dict, status: str, *, squad: dict | None = None) -> None:
    """Eine Nachricht hält nie etwas auf: Der Antrag ist dann schon gespeichert."""
    from services.user_notifications import create_user_notification

    try:
        squad = squad or await db.team_squads.find_one({"id": application["squad_id"]}, {"_id": 0}) or _side({"id": application["squad_id"], "team_id": application["team_id"]})
        team_ids = await _responsible(db, squad)
        title = _season_title(league, season)
        step = len(application.get("history") or [])
        headline, text = _texts(application, title, status)
        page = f"/liga/{league.get('slug')}/{season.get('slug')}"
        meta = {"reason": f"league_application_{status}", "application_id": application["id"]}
        for user_id in sorted(team_ids):
            key = f"league-application:{application['id']}:{status}:{step}:{user_id}"
            await create_user_notification(user_id, headline, text, url=page, kind="tournament_registration", meta={**meta, "dedupe_key": key})
            await send_league_mail(db, user_id, headline, text, page, f"{key}:mail")
        if status not in (SUBMITTED, WITHDRAWN):
            return
        lead_title = "Neue Anmeldung" if status == SUBMITTED else "Anmeldung zurückgezogen"
        lead_text = (f"{application.get('display_name')} möchte in {title} mitspielen. Bitte prüfen." if status == SUBMITTED
                     else f"{application.get('display_name')} hat die Anmeldung für {title} zurückgezogen. Rückt jemand nach, entscheidest du das.")
        inbox = f"/admin/leagues/seasons/{season['id']}#anmeldungen"
        for user_id in sorted(await staff_user_ids(db, league["id"], ("applications",)) - team_ids):
            key = f"league-application:{application['id']}:{status}:{step}:{user_id}"
            await create_user_notification(user_id, lead_title, lead_text, url=inbox, kind="tournament_registration", meta={**meta, "dedupe_key": key})
            await send_league_mail(db, user_id, lead_title, lead_text, inbox, f"{key}:mail")
    except Exception:  # noqa: BLE001 - siehe oben
        logger.warning("[liga] Nachricht zum Antrag nicht verschickt: %s", log_safe(application.get("id")), exc_info=True)


# ---------------------------------------------------------------- Lesen: Captain und Team

def own_view(application: dict | None, *, responsible: bool) -> dict | None:
    """Ein Antrag für das eigene Team. Grund und Rückzug nur für die Verantwortlichen, der Kader sieht den Stand."""
    if not application:
        return None
    out = {"id": application["id"], "status": application["status"], "submitted_at": application.get("submitted_at"),
           "staffel": (application.get("assignment") or {}).get("label")}
    if responsible:
        out.update(decided_at=application.get("decided_at"), decision_reason=application.get("decision_reason"),
                   rules_label=f"Version {(application.get('rule_consent') or {}).get('version')}" if application.get("rule_consent") else None,
                   can_withdraw=application["status"] in OPEN_STATUSES and not application.get("assignment"))
    return out


async def _own_squads(db, user: dict) -> tuple[list[dict], dict[str, dict]]:
    """Die Co-Teams der Person: als Captain, Vertreter, im Kader oder über die Leitung des Hauptteams. Dazu die Hauptteams."""
    user_id = user["id"]
    led = [row["id"] for row in await db.teams.find({"$or": [{"leader_id": user_id}, {"co_leader_ids": user_id}]}, {"_id": 0, "id": 1}).to_list(100)]
    squads = await db.team_squads.find(
        {"status": {"$ne": "archived"}, "$or": [{"captain_id": user_id}, {"vice_captain_id": user_id}, {"member_ids": user_id}, {"team_id": {"$in": led}}]},
        {"_id": 0}).to_list(200)
    team_ids = sorted({row.get("team_id") for row in squads if row.get("team_id")})
    teams = {row["id"]: row for row in await db.teams.find({"id": {"$in": team_ids}}, {"_id": 0}).to_list(len(team_ids) + 1)} if team_ids else {}
    return [row for row in squads if row.get("team_id") in teams], teams


async def _latest(db, season_id: str | None, squad_ids: list[str]) -> dict:
    """Je Co-Team (und Season) der jüngste Antrag."""
    query = {"squad_id": {"$in": squad_ids}, **({"season_id": season_id} if season_id else {})}
    out: dict = {}
    async for row in db.league_applications.find(query, {"_id": 0}).sort("created_at", 1):
        out[(row["season_id"], row["squad_id"])] = row
    return out


def _fits_game(squad: dict, league: dict, games: dict, parents: dict) -> bool:
    """Ein Co-Team eines anderen Spiels gehört nicht in die Auswahl. Alter Freitext und kein Spiel bleiben stehen: Die Prüfung sagt, was zu tun ist."""
    game_id = squad.get("game_id")
    if not game_id or game_id not in games or not league.get("game_id"):
        return True
    return top_game(game_id, parents) == top_game(league["game_id"], parents)


async def my_view(db, league: dict, season: dict, user: dict) -> dict:
    """Die Seite der Anmeldung für die angemeldete Person: was gilt, ihre Co-Teams und was jeweils geht."""
    squads, teams = await _own_squads(db, user)
    games, parents = await load_games(db)
    squads = sorted((row for row in squads if _fits_game(row, league, games, parents)), key=lambda row: str(row.get("name") or "").casefold())
    latest = await _latest(db, season["id"], [row["id"] for row in squads])
    state = window_state(season)
    stats = await seat_stats(db, season) if state else None
    blocked = await season_problems(db, league, season, stats)
    version = await league_rules.current_version(db, league, season)
    rows = []
    hint = None
    for squad in squads:
        team = teams[squad["team_id"]]
        application = latest.get((season["id"], squad["id"]))
        can_apply = await may_apply(db, user, squad)
        active = bool(application and application["status"] in OPEN_STATUSES)
        row = {"squad_id": squad["id"], "squad_name": squad.get("name"), "team_id": team["id"], "team_name": team.get("name"),
               "display_name": squad_registration.display_name(team, squad), "member_count": len([uid for uid in squad.get("member_ids") or [] if uid]),
               "can_apply": can_apply, "state": application["status"] if application else OPEN_TO_APPLY if state == OPEN else NOT_APPLIED,
               "application": own_view(application, responsible=can_apply or user["id"] in _leads(team))}
        if can_apply:
            check = await check_squad(db, league, season, team, squad) if state == OPEN and not active else {"problems": [], "warnings": []}
            row.update(problems=[text for _code, text in check["problems"]], warnings=check["warnings"],
                       can_submit=not active and not blocked and not check["problems"])
        elif user["id"] in _leads(team) and not (squad.get("captain_id") or squad.get("vice_captain_id")) and not hint:
            hint = f"Anmelden dürfen Captain und Vertreter. {squad.get('name')} hat noch keinen: Trag ihn unter Teams beim Co-Team ein."
        rows.append(row)
    return {
        "application": await public_block(db, season),
        "rules": league_rules.version_view(league, season, version) if version else None,
        "privacy": {"text": season.get("application_privacy_text") or PRIVACY_PLACEHOLDER, "url": PRIVACY_URL},
        "season_problems": blocked if state else [],
        "squads": rows,
        "hint": hint,
    }


async def my_applications(db, user: dict) -> list[dict]:
    """Für die Team-Seite: je eigenem Co-Team und Season der jüngste Antrag. Nur Seasons, die die Person sehen darf und die noch laufen."""
    squads, teams = await _own_squads(db, user)
    by_id = {row["id"]: row for row in squads}
    latest = await _latest(db, None, sorted(by_id))
    seasons: dict[str, dict] = {}
    items = []
    for (season_id, squad_id), application in sorted(latest.items(), key=lambda pair: str(pair[1].get("created_at") or ""), reverse=True):
        if season_id not in seasons:
            seasons[season_id] = await db.league_seasons.find_one({"id": season_id}, {"_id": 0}) or {}
        season = seasons[season_id]
        if not season or season.get("status") in ("completed", "archived") or not await league_service.can_see_season(user, season):
            continue
        league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "name": 1, "slug": 1}) or {}
        squad = by_id[squad_id]
        responsible = user["id"] in {squad.get("captain_id"), squad.get("vice_captain_id")} or user["id"] in _leads(teams[squad["team_id"]])
        items.append({**own_view(application, responsible=responsible), "squad_id": squad_id, "season_id": season_id, "title": _season_title(league, season),
                      "url": f"/liga/{league.get('slug')}/{season.get('slug')}"})
    return items


# ---------------------------------------------------------------- Lesen: Leitung

async def _names(db, user_ids: set[str]) -> dict[str, str]:
    ids = sorted(uid for uid in user_ids if uid)
    rows = await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(len(ids) + 1) if ids else []
    return {row["id"]: league_roster.person_name(row) for row in rows}


def _shared_players(application: dict, squad: dict | None, others: list[tuple[dict, dict]]) -> list[str]:
    """Nur für die Leitung: wer auch im Kader eines anderen offenen Antrags steht. Das Team erfährt nichts von fremden Anträgen."""
    mine = set((squad or {}).get("member_ids") or [])
    return [other.get("display_name") or "ein anderes Co-Team" for other, other_squad in others
            if other["id"] != application["id"] and mine & set(other_squad.get("member_ids") or [])]


async def inbox(db, league: dict, season: dict, user: dict) -> dict:
    """Der Eingang: alle Anträge der Season mit Prüfung, Plätzen und den Staffeln zum Zuteilen."""
    rows = await db.league_applications.find({"season_id": season["id"]}, {"_id": 0}).sort("created_at", 1).to_list(500)
    squad_ids = sorted({row["squad_id"] for row in rows})
    squads = {row["id"]: row for row in await db.team_squads.find({"id": {"$in": squad_ids}}, {"_id": 0}).to_list(len(squad_ids) + 1)} if squad_ids else {}
    team_ids = sorted({row["team_id"] for row in rows})
    teams = {row["id"]: row for row in await db.teams.find({"id": {"$in": team_ids}}, {"_id": 0}).to_list(len(team_ids) + 1)} if team_ids else {}
    people: set[str] = set()
    for row in rows:
        squad = squads.get(row["squad_id"]) or {}
        people |= {row.get("applied_by"), row.get("decided_by"), row.get("withdrawn_by"), squad.get("captain_id"), squad.get("vice_captain_id")}
        people |= {step.get("by") for step in row.get("history") or []}
    names = await _names(db, people)
    open_rows = [(row, squads[row["squad_id"]]) for row in rows if row["status"] in OPEN_STATUSES and row["squad_id"] in squads]
    items = []
    for row in rows:
        squad = squads.get(row["squad_id"])
        team = teams.get(row["team_id"])
        check = {"problems": [], "warnings": []}
        waiting = row["status"] in OPEN_STATUSES and not row.get("assignment")
        if waiting:
            check = await check_squad(db, league, season, team, squad, application=row) if squad and team else {"problems": [(409, SQUAD_GONE)], "warnings": []}
        shared = _shared_players(row, squad, open_rows) if waiting else []
        items.append({
            "id": row["id"], "status": row["status"], "squad_id": row["squad_id"], "team_id": row["team_id"], "display_name": row.get("display_name"),
            "squad_name": row.get("squad_name"), "team_name": row.get("team_name"), "submitted_at": row.get("submitted_at"),
            "applied_by_name": names.get(row.get("applied_by")) or "Gelöschter User",
            "rules_version": (row.get("rule_consent") or {}).get("version"), "rules_at": (row.get("rule_consent") or {}).get("at"),
            "privacy_at": (row.get("privacy_consent") or {}).get("at"),
            "decided_at": row.get("decided_at"), "decided_by_name": names.get(row.get("decided_by")), "decision_reason": row.get("decision_reason"),
            "assignment": row.get("assignment"),
            "member_count": len([uid for uid in (squad or {}).get("member_ids") or [] if uid]),
            "captain_name": names.get((squad or {}).get("captain_id")), "vice_name": names.get((squad or {}).get("vice_captain_id")),
            "problems": [text for _code, text in check["problems"]], "warnings": check["warnings"],
            "shared_with": shared,
            "own_team": user["id"] in {*((squad or {}).get("member_ids") or []), (team or {}).get("leader_id"), *((team or {}).get("co_leader_ids") or [])},
            "history": [{"status": step.get("status"), "at": step.get("at"), "by_name": names.get(step.get("by")) or "Gelöschter User", "reason": step.get("reason")}
                        for step in row.get("history") or []],
        })
    divisions = await db.league_divisions.find({"season_id": season["id"], "status": "active"}, {"_id": 0}).sort("level", 1).to_list(50)
    staffeln = await league_service.staffeln_of(db, season["id"])
    return {
        "items": items,
        "stats": await seat_stats(db, season),
        "configured": bool(window_state(season)),
        "window": window_state(season),
        "divisions": [{"id": division["id"], "label": league_service.division_label(division),
                       "staffeln": [league_service.staffel_summary(row) for row in staffeln if row["league_context"].get("division_id") == division["id"]]}
                      for division in divisions],
    }


# ---------------------------------------------------------------- Konto löschen und Auskunft

async def scrub_person(db, user_id: str) -> int:
    """Der Antrag gehört dem Co-Team und bleibt. Die Kennung der Person fällt überall heraus."""
    query = {"$or": [{"applied_by": user_id}, {"decided_by": user_id}, {"withdrawn_by": user_id}, {"rule_consent.user_id": user_id},
                     {"privacy_consent.user_id": user_id}, {"assignment.assigned_by": user_id}, {"history.by": user_id}]}
    done = 0
    async for row in db.league_applications.find(query, {"_id": 0}):
        update = {key: None for key in ("applied_by", "decided_by", "withdrawn_by") if row.get(key) == user_id}
        for key, field in (("rule_consent", "user_id"), ("privacy_consent", "user_id"), ("assignment", "assigned_by")):
            if (row.get(key) or {}).get(field) == user_id:
                update[f"{key}.{field}"] = None
        update["history"] = [{**step, "by": None if step.get("by") == user_id else step.get("by")} for step in row.get("history") or []]
        await db.league_applications.update_one({"id": row["id"]}, {"$set": update})
        done += 1
    return done


EXPORT_FIELDS = ("id", "season_id", "league_id", "team_id", "squad_id", "squad_name", "status", "submitted_at", "rule_consent", "privacy_consent", "decided_at", "decision_reason", "withdrawn_at")


def export_query(user_id: str) -> dict:
    return {"$or": [{"applied_by": user_id}, {"withdrawn_by": user_id}, {"rule_consent.user_id": user_id}, {"privacy_consent.user_id": user_id}]}
