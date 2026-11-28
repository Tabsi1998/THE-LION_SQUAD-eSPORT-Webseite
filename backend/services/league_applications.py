"""Selbstanmeldung mit Co-Team (docs/LIGA.md, Abschnitt 12, B.4, #2205).

Der Antrag gilt der Season, die Staffel steht erst nach der Genehmigung fest - darum eine eigene Sammlung. Erst beim Zuteilen entsteht wie immer die
``tournament_registrations``-Zeile (``squad_registration.build_registration``). Ohne Anmeldefenster an der Season gibt es das alles nicht.

Gleichzeitigkeit: Einreichen, Rückzug und Entscheidungen halten die Season-Sperre (dieselbe wie beim Zuteilen), beim Zuteilen zuerst die Turnier-Sperre. Der Status wechselt
nur mit Bedingung auf den alten Stand, ``active_key`` hält „ein offener Antrag je Season und Co-Team“ auch ohne Sperre.

Automatisch annehmen (#2348, ``application_auto_accept``): Die Season entscheidet beim Einreichen unter derselben Sperre - der letzte Platz geht so nur einmal weg.
Mit nur einer Staffel sperrt das Einreichen sie vorher und teilt zu.

Datenschutz: Andere Teams und Gäste sehen keinen Antrag. Kein Geburtsdatum: Die Prüfung liefert nur den Stand aus ``league_eligibility``.
"""

from __future__ import annotations

import contextlib
import logging
from datetime import datetime

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services import checkin_rules, league_eligibility, league_late, league_platform, league_roster, league_rules, league_service, squad_registration
from services import league_participants, league_start_right_rules
from services.discord_roles import load_games, top_game
from services.league_mail import send_league_mail
from services.league_permissions import CAPABILITIES, belongs_to_side, record_override, require_no_side_conflict, side_of, staff_user_ids
from services.league_scope import ONLY_LEAGUE
from services.league_service import LeagueProblem
from services.log_safe import log_safe
from services.match_audience import responsible_ids, teams_by_id
from services.mutation_lock import MutationLockBusy, league_season_resource, mutation_lock, tournament_write_resource
from services.permissions import is_superadmin
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
# In der Solo-Liga (#1629, P2) meldet sich die Person selbst an und stimmt selbst zu (F4 A) - derselbe Platzhalter, für sie formuliert.
PRIVACY_PLACEHOLDER_PERSON = "Für die Anmeldung speichert der Verein deine Angaben als Spieler. Mehr dazu steht in der Datenschutzerklärung."
# Freigabe für Gäste (#1665, Nr. 1): der Wortlaut, den der Superadmin nach der rechtlichen Prüfung freigegeben hat - ``{text, at, by}``.
PRIVACY_RELEASE = "application_privacy_release"


def privacy_text_for(season: dict, user: dict | None, *, solo: bool = False) -> str:
    """Der Hinweis zum Datenschutz, den die Person sieht und dem sie zustimmt. Gäste (Konten ohne Mitgliedschaft, #1665) sehen den Text der
    Season erst, wenn genau dieser Wortlaut für Gäste freigegeben ist (Nr. 1) - bis dahin den Platzhalter. Ändert die Leitung den Text,
    gilt die Freigabe nicht mehr. ``solo``: Anmeldung als Spieler (#1629, P2) - nur der Platzhalter spricht dann von dir statt vom Co-Team."""
    placeholder = PRIVACY_PLACEHOLDER_PERSON if solo else PRIVACY_PLACEHOLDER
    text = season.get("application_privacy_text") or ""
    if not text:
        return placeholder
    if (user or {}).get("is_club_member"):
        return text
    return text if (season.get(PRIVACY_RELEASE) or {}).get("text") == text else placeholder


NO_WINDOW = "Für diese Season gibt es keine Selbstanmeldung."
NO_RULES = "Für diese Season ist noch kein gültiges Regelwerk veröffentlicht. Ohne Regelwerk geht keine Anmeldung, die Liga-Leitung veröffentlicht es zuerst."
RULES_CHANGED = "Das Regelwerk hat sich geändert. Bitte die Seite neu laden und der neuen Fassung zustimmen."
ACCEPT_BOTH = "Bitte stimme den Regeln und dem Hinweis zum Datenschutz ausdrücklich zu."
NOT_RESPONSIBLE = "Anmelden und zurückziehen dürfen nur Captain und Vertreter des Co-Teams."
ALREADY_OPEN = "Für dieses Co-Team läuft schon eine Anmeldung."
FINISHED = "Diese Season ist beendet."
CANCELLED_SEASON = "Diese Season ist abgesagt."
NO_SEATS = "Alle Startplätze sind vergeben."
NO_SEATS_NO_WAITLIST = "Alle Startplätze sind vergeben, und die Warteliste ist voll oder gibt es nicht."
SEATS_TAKEN = "Alle Startplätze sind vergeben. Setz das Co-Team auf die Warteliste oder gib erst einen Platz frei."
NO_WAITLIST = "Diese Season hat keine Warteliste."
WAITLIST_FULL = "Die Warteliste ist voll."
DECIDED = "Dieser Antrag hat sich schon geändert. Bitte neu laden."
ASSIGNED_ALREADY = "Dieses Co-Team ist schon zugeteilt. Das Herausnehmen geht über die Teilnehmerliste der Staffel."
WITHDRAW_ASSIGNED = "Das Co-Team ist schon einer Staffel zugeteilt. Den Austritt trägt die Liga-Leitung ein."
# Zurückziehen einer automatischen Zuteilung (#2348) wie die Turnier-Abmeldung: nach Check-in oder sobald Check-in bzw. Staffel laufen nur über die Leitung.
WITHDRAW_STARTED = "Nach dem Check-in oder sobald Check-in oder Staffel laufen, geht der Austritt nur über die Liga-Leitung."
TEAM_LEAVE_STATUSES = frozenset({"draft", "scheduled", "registration_open", "registration_closed"})
GONE = "Diesen Antrag gibt es nicht."
BUSY = "An dieser Season wird gerade etwas geändert. Bitte gleich noch einmal versuchen."
STAFFEL_GONE = "Diese Staffel gehört nicht zu dieser Season."
SQUAD_GONE = "Das Co-Team gibt es nicht mehr."
# Der Dialog „Co-Team zuteilen“ fragt nach keinem Grund: Die Notausnahme geht über den Eingang, dort steht das Feld (#2245).
ADMIN_WAY_OVERRIDE = ("Über dein eigenes Team entscheidet eine andere Person. Das Co-Team hat einen offenen Antrag: Als Superadmin geht es nur "
                      "als Notausnahme mit Grund, im Eingang der Season unter „Anmeldungen“.")
# Anmeldungen automatisch annehmen (#2348): Die Season entscheidet, keine Person - darum ohne Befangenheit (Nr. 73) und ohne Kennung im Verlauf.
AUTO_ACCEPT = "application_auto_accept"
AUTO_ACTOR: dict = {"id": None}
AUTO_NAME = "automatisch"
AUTO_PLAN_FIXED = "Der Spielplan der Staffel steht schon. Das Co-Team bitte über „Austritt eintragen“ in der Teilnehmerliste herausnehmen."
# Warum die Season nicht (ganz) entscheiden konnte (Review #2348) - steht im Antrag (``auto_problem``), im Eingang und im Hinweis an die Leitung.
AUTO_STAFFEL_STARTED = "Die einzige Staffel hat schon begonnen."
AUTO_STAFFEL_PLAN = "Der Spielplan der einzigen Staffel steht schon."
AUTO_SIBLING = ("{team} hat schon ein Co-Team in der einzigen Staffel, und zwei Co-Teams eines Hauptteams spielen in dieser Season nicht in derselben "
                "Staffel.")
AUTO_FAILED = "Es gab einen technischen Fehler, bitte selbst prüfen."
# Übernommen aus der Vorgänger-Season (F.2, #1627, Nr. 160): Abmelden geht bis zum Start der Season.
CARRY_DEADLINE = "Abmelden ging bis zum Start der Season ({day}). Jetzt trägt die Liga-Leitung einen Austritt ein."
CARRY_OTHER_DIVISION = ("Das Co-Team ist aus der Vorgänger-Season in {label} übernommen. Eine Staffel einer anderen Liga geht nur mit Grund "
                        "(mindestens fünf Zeichen).")
# Zurückstufen einer angenommenen Anmeldung (#2348): wie beim Ablehnen nur mit Grund, egal ob automatisch oder von Hand angenommen.
# Neue Co-Teams starten in der untersten Liga N (#1623, Entscheidung 15.10.): je Season einstellbar, fehlt das Feld, gilt es nicht.
NEW_LOWEST = "new_squads_lowest_division"
NEW_OTHER_DIVISION = ("Neue Co-Teams starten in der untersten Liga ({label}). Eine Staffel einer höheren Liga geht nur mit Grund "
                      f"(mindestens {REASON_MIN} Zeichen).")
DEMOTE_REASON = f"Bitte einen Grund angeben (mindestens {REASON_MIN} Zeichen). Die Anmeldung war angenommen, das Team liest ihn."
REJECT_REASON = f"Bitte einen Grund angeben (mindestens {REASON_MIN} Zeichen). Das Team liest ihn."
# Dieselben Sätze für Anträge von Spielern (Solo-Liga, #1629, P2).
NEW_OTHER_DIVISION_PERSON = ("Neue Spieler starten in der untersten Liga ({label}). Eine Staffel einer höheren Liga geht nur mit Grund "
                             f"(mindestens {REASON_MIN} Zeichen).")
DEMOTE_REASON_PERSON = f"Bitte einen Grund angeben (mindestens {REASON_MIN} Zeichen). Die Anmeldung war angenommen, der Spieler liest ihn."
REJECT_REASON_PERSON = f"Bitte einen Grund angeben (mindestens {REASON_MIN} Zeichen). Der Spieler liest ihn."
# Anmeldung als Person (Solo-Liga, #1629, P2, S7): derselbe Antrag, dieselben Zustände - die Sätze sprechen von „Spieler“ bzw. „du“.
SQUAD_NEEDED = "Bitte ein Co-Team wählen."
PERSON_NO_SQUAD = "In dieser Liga meldest du dich selbst als Spieler an – ohne Co-Team."
ALREADY_OPEN_PERSON = "Für dich läuft in dieser Season schon eine Anmeldung."
ALREADY_OPEN_PERSON_LEAD = "{name} hat in dieser Season schon eine Anmeldung."
SEATED_PERSON = "Du spielst in dieser Season schon in einer Staffel."
SEATED_PERSON_LEAD = "{name} spielt in dieser Season schon in einer Staffel."
BLOCKED_PERSON = "Dein Konto ist gesperrt – ein gesperrtes Konto spielt nicht in der Liga."
BLOCKED_PERSON_LEAD = "{name} ist gesperrt – ein gesperrtes Konto spielt nicht in der Liga."
MEMBERS_ONLY_PERSON = "Diese Season ist nur für Mitglieder. Du bist kein Vereinsmitglied."
MEMBERS_ONLY_PERSON_LEAD = "{name}: Diese Season ist nur für Mitglieder. {name} ist kein Vereinsmitglied."
NOT_THE_PERSON = "Zurückziehen darf nur die Person, die sich angemeldet hat."
WITHDRAW_ASSIGNED_PERSON = "Du bist schon einer Staffel zugeteilt. Den Austritt trägt die Liga-Leitung ein."
ASSIGNED_ALREADY_PERSON = "Dieser Spieler ist schon zugeteilt. Das Herausnehmen geht über die Teilnehmerliste der Staffel."
SEATS_TAKEN_PERSON = "Alle Startplätze sind vergeben. Setz den Spieler auf die Warteliste oder gib erst einen Platz frei."
PERSON_GONE = "Dieses Konto gibt es nicht mehr."
PERSON_CONFLICT_DETAIL = "Über deine eigene Anmeldung entscheidet eine andere Person."
PERSON_CONFLICT_SUPERADMIN = ("Über deine eigene Anmeldung entscheidet eine andere Person. Als Superadmin geht es nur als Notausnahme, mit einem Grund "
                              "von mindestens fünf Zeichen.")
PERSON_ADMIN_WAY_OVERRIDE = ("Über deine eigene Anmeldung entscheidet eine andere Person. Es gibt einen offenen Antrag: Als Superadmin geht es nur "
                             "als Notausnahme mit Grund, im Eingang der Season unter „Anmeldungen“.")
# Kontolöschung (#1629, P2): Der Antrag einer Person bleibt als Nachweis, ohne Kennung und Namen.
GONE_PERSON = "Gelöschter User"
# Für App-Fassungen ohne Solo-Anmeldung (A9 folgt): Sie zeigen den Satz statt „Anmelden dürfen Captain und Vertreter …“.
PERSON_APP_HINT = "Als Spieler meldest du dich bis zum App-Ausbau auf der Website an."
ERASED_REASON = "Konto gelöscht"
PERSON_FIELDS = {"_id": 0, "id": 1, "username": 1, "display_name": 1, "role": 1, "areas": 1, "is_club_member": 1, "is_banned": 1, "is_active": 1}


# ---------------------------------------------------------------- Fenster und Plätze

def _moment(value) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def self_seat(assignment: dict | None) -> bool:
    """Eine Zuteilung, die das Team selbst wieder zurückgeben darf (solange kein fester Spielplan steht): automatisch (#2348) oder aus der
    Vorgänger-Season übernommen (F.2)."""
    return bool((assignment or {}).get("auto") or (assignment or {}).get("carried"))


def carry_deadline(application: dict | None, season: dict | None) -> datetime | None:
    """Bis wann sich ein übernommenes Co-Team abmelden kann: der Start der Season (Nr. 160). ``None``: kein übernommener Antrag."""
    if not (application or {}).get("carry_over") or not season:
        return None
    # Der gemerkte Start gilt (#2404, Nr. 253): Rückt das Startdatum nach dem Start in die Zukunft, geht die Frist nicht wieder auf.
    from services import league_calendar

    return league_calendar.start_moment(season)


def carry_open(application: dict | None, season: dict | None, now: datetime | None = None) -> bool:
    """Darf ein übernommenes Co-Team sich noch abmelden? Andere Anträge kennen keine Frist."""
    until = carry_deadline(application, season)
    return until is None or (now or now_utc()) < until


def window_state(season: dict, now: datetime | None = None) -> str | None:
    """``None``: Die Season hat kein Fenster, also keine Selbstanmeldung."""
    # Nachmeldefrist (#2422, Nr. 184): Das wirksame Ende ist min(Fenster, Start + Frist), außer die Leitung hat mit Grund verlängert.
    opens, closes = _moment(season.get("application_opens_at")), league_late.effective_closes(season)
    if not opens or not closes:
        return None
    if season.get("status") == league_service.CANCELLED:
        # Abgesagt (#2607): Die Anmeldung ist zu - das Fenster bleibt gespeichert, als Nachweis.
        return CLOSED
    moment = now or now_utc()
    if moment < opens:
        return UPCOMING
    return OPEN if moment < closes else CLOSED


async def _staffeln(db, season_id: str) -> list[dict]:
    # Nur reguläre Staffeln (#2404, F.6): Zugeteilt wird nie in die Playoffs oder die Relegation.
    return await db.tournaments.find({"league_context.season_id": season_id, "league_context.kind": None, **ONLY_LEAGUE},
                                     {"_id": 0, "id": 1, "team_mode": 1, "league_context": 1}).to_list(200)


def _seated_query(staffeln: list[dict]) -> dict:
    """Welche Anmeldungen einen Startplatz belegen: aktive Co-Team-Anmeldungen - und nur in Solo-Staffeln (#1629, P2) die Einzel-Anmeldungen
    der Personen. In Team-Staffeln bleibt die Abfrage genau die von vorher; eine Einzel-Anmeldung aus dem Altbestand zählt dort nicht."""
    query: dict = {"tournament_id": {"$in": [row["id"] for row in staffeln]}, "status": {"$in": list(SEAT_STATUSES)}}
    solo_ids = [row["id"] for row in staffeln if league_participants.is_solo_staffel(row)]
    if not solo_ids:
        return {**query, "squad_id": {"$exists": True}}
    return {**query, "$or": [{"squad_id": {"$exists": True}},
                             {"tournament_id": {"$in": solo_ids}, "registration_type": "solo", "user_id": {"$type": "string"}}]}


async def seat_stats(db, season: dict) -> dict:
    """Belegt sind aktive Co-Team-Anmeldungen der Staffeln und angenommene Anträge ohne Zuteilung. Die Warteliste belegt nichts. In
    Solo-Staffeln (#1629, P2) belegen die Einzel-Anmeldungen der Personen (``_seated_query``)."""
    staffeln = await _staffeln(db, season["id"])
    seated = await db.tournament_registrations.count_documents(_seated_query(staffeln)) if staffeln else 0
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


def _free_for_newcomers(season: dict, stats: dict) -> int | None:
    """Freie Plätze für die Ligaseite. Mit „automatisch annehmen“ (#2348) das, was eine neue Anmeldung wirklich bekommt: Offene Anträge halten ihren Platz,
    und wartet schon jemand, geht ein freier Platz durch die Leitung an die Warteliste (wie ``_auto_decide``). Ohne die Einstellung wie bisher."""
    if not season.get(AUTO_ACCEPT) or not stats["slots"]:
        return stats["free"]
    if stats["waiting"]:
        return 0
    return max(0, stats["slots"] - stats["taken"] - stats["open"])


async def public_block(db, season: dict, league: dict | None = None) -> dict | None:
    """Für alle: Fenster-Stand, freie Plätze, Warteliste. Keine Personen, keine Anträge. ``None``: keine Selbstanmeldung. ``league``: In der
    Solo-Liga (#1629, P2) steht ``participant_kind: "solo"`` dabei, damit die Seite „Als Spieler anmelden“ sagt - Team-Ligen ohne das Feld."""
    state = window_state(season)
    if not state:
        return None
    stats = await seat_stats(db, season)
    closes_at = league_late.effective_closes_iso(season)
    cancelled = season.get("status") == league_service.CANCELLED
    if cancelled and season.get("cancelled_at") and (not closes_at or _moment(season["cancelled_at"]) < _moment(closes_at)):
        # Abgesagt (#2607): Die Anmeldung endete mit der Absage - nie „vorbei seit“ einem Zeitpunkt in der Zukunft.
        closes_at = season["cancelled_at"]
    return {**({"participant_kind": league_participants.SOLO} if league_participants.is_solo(league) else {}),
            **({"cancelled": True, "cancelled_at": season.get("cancelled_at")} if cancelled else {}),
            "state": state, "opens_at": season.get("application_opens_at"), "closes_at": closes_at,
            "slots": stats["slots"], "slots_free": _free_for_newcomers(season, stats), "waitlist": bool(season.get("application_waitlist")),
            "waitlist_full": bool(season.get("application_waitlist")) and not _waitlist_has_room(season, stats),
            "waitlist_note": season.get("application_waitlist_note"), "entry_policy": season.get("entry_policy") or "all",
            "auto_accept": bool(season.get(AUTO_ACCEPT)),
            # Nachmeldung (Entscheidung Nr. 180): Beginn der Season, damit die Seite „läuft nach Season-Start weiter“ sagen kann.
            "season_starts_at": season.get("start_date")}


# ---------------------------------------------------------------- Prüfung

def _day(value: str | None) -> str:
    from services.matchday_schedule import LOCAL_TZ

    from services.date_text import format_moment

    moment = league_service._aware(value)
    return format_moment(moment.astimezone(LOCAL_TZ)) if moment else ""


def _when(value: str | None) -> str:
    from services.matchday_schedule import LOCAL_TZ

    from services.date_text import format_moment

    return format_moment(_moment(value).astimezone(LOCAL_TZ)) if value else ""


async def season_problems(db, league: dict, season: dict, stats: dict | None = None) -> list[str]:
    """Was gegen jede Anmeldung spricht, egal welches Co-Team bzw. welche Person (Solo-Liga, #1629 P2: dieselben Gründe)."""
    state = window_state(season)
    if not state:
        return [NO_WINDOW]
    problems: list[str] = []
    if season.get("status") == league_service.CANCELLED:
        # Abgesagt (#2607): der Grund vor allem anderen - „Die Anmeldung ist vorbei“ allein sagte nicht, warum.
        return [CANCELLED_SEASON]
    if (season.get("status") or "draft") in ("completed", "archived"):
        problems.append(FINISHED)
    if state == UPCOMING:
        problems.append(f"Die Anmeldung öffnet am {_when(season.get('application_opens_at'))}.")
    if state == CLOSED:
        problems.append(f"Die Anmeldung ist vorbei: Sie lief bis {_when(league_late.effective_closes_iso(season))}.")
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


async def _ready_minimum(db, season: dict) -> int:
    """Wie viele Spielberechtigte ein Team zum Einchecken braucht (#2322): die Mindestzahl Anwesender aus den Check-in-Regeln der
    Season (bei 4 gegen 4 also 3), nicht der Mindestkader. Ohne Check-in-Regeln gilt wie bisher der Mindestkader."""
    raw = season.get("checkin_rules")
    if isinstance(raw, dict):
        with contextlib.suppress(checkin_rules.FlowProblem):
            return int(checkin_rules.normalize({key: value for key, value in raw.items() if key in checkin_rules.DEFAULTS})["min_present"])
    return await _min_size(db, season)


async def _non_members(db, squad: dict) -> list[str]:
    members = [uid for uid in squad.get("member_ids") or [] if uid]
    rows = await db.users.find({"id": {"$in": members}}, {"_id": 0, "id": 1, "role": 1, "areas": 1, "is_club_member": 1, "display_name": 1, "username": 1}).to_list(len(members) + 1)
    return [league_roster.person_name(row) for row in rows if not await user_can_see(row, "members", for_request=False)]


async def check_squad(db, league: dict, season: dict, team: dict, squad: dict, *, application: dict | None = None, seated: bool = False) -> dict:
    """Die Prüfung im Klartext: ``problems`` (Statuscode, Satz) halten die Anmeldung auf, ``warnings`` stehen nur da.
    ``application``: Der eigene Antrag zählt nicht als „läuft schon“. ``seated``: Seine eigene Anmeldung zählt nicht als „spielt schon“ (``_left_over``)."""
    problems: list[tuple[int, str]] = []
    other_open = await db.league_applications.find_one({"season_id": season["id"], "squad_id": squad["id"], "active_key": {"$exists": True},
                                                        "id": {"$ne": (application or {}).get("id")}}, {"_id": 1})
    if other_open:
        problems.append((409, ALREADY_OPEN))
    minimum = await _min_size(db, season)
    problems += await squad_registration.season_problems(db, season, league.get("game_id"), team, squad, min_size=minimum, seated=seated)
    members = [uid for uid in squad.get("member_ids") or [] if uid]
    ctx = await league_eligibility.context_for_season(db, season, members)
    problems += league_eligibility.registration_problems(ctx, squad)
    if (season.get("entry_policy") or "all") == "members":
        outsiders = await _non_members(db, squad)
        if outsiders:
            problems.append((400, f"{squad.get('name')}: Diese Season ist nur für Mitglieder. Keine Mitglieder: {', '.join(sorted(outsiders))}."))
    # Fehlende Angaben und zu wenige Spielberechtigte halten die Anmeldung nicht auf (#2313, ersetzt Nr. 74): nur Hinweis, gesperrt wird
    # erst beim Check-in und bei der Aufstellung. Andere Co-Teams stehen schon oben als Grund.
    rows = league_eligibility.statuses(ctx, members, squad["id"])
    warnings = [f"{row['name']}: {row['reason']}" for row in rows.values() if not row["ok"] and row["state"] != league_eligibility.OTHER_TEAM]
    shortfall = league_eligibility.open_points(ctx, squad, minimum=await _ready_minimum(db, season))["shortfall"]
    return {"problems": problems, "warnings": sorted(warnings), "shortfall": shortfall}


def _person_key(season: dict, user_id: str) -> str:
    """Der Schlüssel einer Person in der Season (#1629): ``<season>:user:<id>`` - für den offenen Antrag (``active_key``) und für die
    Anmeldung in einer Staffel (``league_squad_key``) derselbe."""
    return f"{season['id']}:{league_participants.person_entry(user_id)}"


async def check_person(db, league: dict, season: dict, person: dict, *, application: dict | None = None, seated: bool = False,
                       you: bool = False) -> dict:
    """Die Prüfung einer Person in der Solo-Liga (#1629, P2, S8) - dasselbe Muster wie ``check_squad``: ``problems`` halten die Anmeldung
    auf, ``warnings`` stehen nur da (#2313). Gründe: offener Antrag, schon in einer Staffel der Season (auch über das Zuteilen der Leitung),
    gesperrtes Konto, Sperre der Liga-Leitung (E.3), ``entry_policy``. Keine Transfers, keine Kaderregeln: Der Kader ist die Person.
    ``you``: Die Sätze sprechen die Person an (Ligaseite), sonst nennen sie den Namen (Eingang der Leitung)."""
    user_id = person["id"]
    name = league_roster.person_name(person)
    problems: list[tuple[int, str]] = []
    other_open = await db.league_applications.find_one({"active_key": _person_key(season, user_id), "id": {"$ne": (application or {}).get("id")}},
                                                       {"_id": 1})
    if other_open:
        problems.append((409, ALREADY_OPEN_PERSON if you else ALREADY_OPEN_PERSON_LEAD.format(name=name)))
    if not seated and await db.tournament_registrations.find_one({"league_squad_key": _person_key(season, user_id)}, {"_id": 1}):
        problems.append((409, SEATED_PERSON if you else SEATED_PERSON_LEAD.format(name=name)))
    if person.get("is_banned") or person.get("is_active") is False:
        problems.append((403, BLOCKED_PERSON if you else BLOCKED_PERSON_LEAD.format(name=name)))
    ctx = await league_eligibility.context_for_season(db, season, [user_id])
    problems += league_eligibility.person_problems(ctx, user_id, None if you else name)
    if (season.get("entry_policy") or "all") == "members" and not await user_can_see(person, "members", for_request=False):
        problems.append((400, MEMBERS_ONLY_PERSON if you else MEMBERS_ONLY_PERSON_LEAD.format(name=name)))
    # Fehlende Angaben halten nichts auf (#2313): Alter, Spiel-ID, Plattform stehen als Hinweis da. Eine Person ist ihr eigener Kader - der
    # Satz „Nur 2 von 5 …“ (``shortfall``) gibt es hier nicht, der Hinweis selbst sagt, was fehlt.
    warnings = league_eligibility.person_warnings(ctx, user_id, None if you else name)
    return {"problems": problems, "warnings": warnings, "shortfall": None}


async def _load_person(db, user_id: str | None) -> dict | None:
    return await db.users.find_one({"id": user_id}, PERSON_FIELDS) if user_id else None


async def check_entry(db, league: dict, season: dict, application: dict, *, seated: bool = False) -> dict:
    """Die Prüfung des Teilnehmers eines Antrags vor einer Entscheidung: Co-Team (``check_squad``) oder Person (``check_person``).
    Wirft ``LeagueProblem`` (409), wenn es das Co-Team oder das Konto nicht mehr gibt."""
    if league_participants.is_person_application(application):
        person = await _load_person(db, application.get("user_id"))
        if not person:
            raise LeagueProblem(PERSON_GONE, 409)
        return await check_person(db, league, season, person, application=application, seated=seated)
    team, squad = await _load_side(db, application["squad_id"])
    if not squad:
        raise LeagueProblem(SQUAD_GONE, 409)
    return await check_squad(db, league, season, team, squad, application=application, seated=seated)


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
        "data": {"application_id": application.get("id"), "squad_id": application.get("squad_id"), "team_id": application.get("team_id"),
                 # Anmeldung als Person (#1629, P2): wer sich angemeldet hat - Team-Anträge bleiben ohne das Feld.
                 **({"user_id": application.get("user_id")} if league_participants.is_person_application(application) else {}), **data},
        "created_at": now_utc().isoformat(),
    })


async def _audit_decision(db, action: str, application: dict, actor: dict, override: str | None, **data) -> None:
    """Das Protokoll einer Entscheidung. Eine Notausnahme (#2245) steht mit Grund dabei und wie im Spiel unter ``league.conflict.override``."""
    await _audit(db, action, application, actor.get("id"), **data, **({"conflict_override": override} if override else {}))
    if override:
        await record_override(db, actor, action=f"application_{action}", target_id=application.get("season_id"), reason=override,
                              application_id=application.get("id"))


async def _no_conflict(db, season: dict, application_id: str, actor: dict, conflict_reason: str | None) -> str | None:
    """Über die Anmeldung des eigenen Teams entscheidet eine zweite Person (B.4, Entscheidung Nr. 73) - geprüft vor allem anderen, damit
    die befangene Person schnell 403 bekommt und nicht mehr erfährt als „nicht du“. Unter der Sperre prüft ``_recheck`` noch einmal. Gibt den Grund einer
    Notausnahme zurück."""
    return await _recheck(db, await _load(db, season["id"], application_id), actor, conflict_reason)


async def _recheck(db, application: dict, actor: dict, conflict_reason: str | None) -> str | None:
    """Dieselbe Prüfung mit dem unter der Season-Sperre frisch geladenen Antrag, direkt vor dem Schreiben: Wer seit der Vorabprüfung in den Kader kam,
    wird hier aufgehalten. Kaderänderungen selbst laufen nicht unter dieser Sperre (bekannte Grenze, #2245)."""
    if league_participants.is_person_application(application):
        # Die eigene Anmeldung als Spieler (#1629, P2): dieselbe Regel, der Satz spricht von der Anmeldung statt vom Team.
        return await require_no_side_conflict(db, actor, side_of(application), conflict_reason=conflict_reason,
                                              detail=PERSON_CONFLICT_DETAIL, superadmin_detail=PERSON_CONFLICT_SUPERADMIN)
    return await require_no_side_conflict(db, actor, side_of(application), conflict_reason=conflict_reason)


async def submit(db, league: dict, season: dict, body: dict, user: dict, *, refresh_previews=None) -> dict:
    """Einreichen: unter der Sperre der Season noch einmal alles prüfen, dann Antrag und Zustimmung schreiben. Wirft ``LeagueProblem``.
    Mit „automatisch annehmen“ (#2348) entscheidet die Season gleich unter derselben Sperre (``_auto_decide``); gibt es nur eine Staffel,
    sperrt das Einreichen sie vorher (Turnier-Sperre vor Season-Sperre) und teilt zu. ``refresh_previews`` reicht die Route herein."""
    if not body.get("accept_rules") or not body.get("accept_privacy"):
        raise LeagueProblem(ACCEPT_BOTH)
    # Solo-Liga (#1629, P2, F4 A): Die Person meldet sich selbst an - ohne Co-Team, sie hat die Rechte des Captains selbst.
    solo = league_participants.is_solo(league)
    team = squad = person = None
    if solo:
        if body.get("squad_id"):
            raise LeagueProblem(PERSON_NO_SQUAD)
        person = await _load_person(db, user["id"])
        if not person:
            raise LeagueProblem(PERSON_GONE, 403)
    else:
        if not body.get("squad_id"):
            raise LeagueProblem(SQUAD_NEEDED)
        team, squad = await _load_side(db, body["squad_id"])
        if not squad or not await may_apply(db, user, squad):
            raise LeagueProblem(NOT_RESPONSIBLE, 403)
    locked_id = (await _auto_staffel(db, season))[0] if season.get(AUTO_ACCEPT) else None
    decided = None
    async with _staffel_lock(db, locked_id, wait_seconds=LOCK_WAIT_SECONDS):
        async with _season_lock(db, season["id"]):
            fresh = await league_service.get_season(db, season["id"])
            blocked = await season_problems(db, league, fresh)
            if blocked:
                raise LeagueProblem(blocked[0], 409)
            version = await league_rules.current_version(db, league, fresh)
            if version["id"] != body.get("rule_version_id"):
                raise LeagueProblem(RULES_CHANGED, 409)
            check = (await check_person(db, league, fresh, person, you=True) if solo else await check_squad(db, league, fresh, team, squad))
            problems = check["problems"]
            if problems:
                raise LeagueProblem(problems[0][1], problems[0][0])
            application = (await _write_person(db, league, fresh, version, person) if solo
                           else await _write(db, league, fresh, version, team, squad, user))
            if fresh.get(AUTO_ACCEPT):
                decided, application = await _auto_decide_safely(db, fresh, application, locked_id)
        if decided and decided[2]:
            await _after_auto_assign(db, decided[1], decided[2], refresh_previews)
    await _audit(db, "submit", application, user["id"], version=version.get("version"))
    if decided and application["status"] != SUBMITTED:
        await _audit(db, f"auto_{'accept' if application['status'] == ACCEPTED else 'waitlist'}", application, None,
                     **({"tournament_id": decided[1]["id"]} if decided[1] else {}), **({"problem": decided[3]} if decided[3] else {}))
        await _tell_status(db, league, season, application, application["status"], squad=squad, auto=True)
    else:
        # Auch wenn die Season nicht entscheiden konnte (Geschwister-Co-Team, Fehler): eingereicht wie ohne Einstellung, die Leitung hört den Grund.
        await _tell_status(db, league, season, application, SUBMITTED, squad=squad)
    # Fehlende Angaben (#2313): Die Anmeldung ging durch, die Betroffenen und Captain und Vertreter hören, was bis zum ersten Spiel fehlt.
    from services import league_open_points

    try:
        # Solo-Liga (#1629, P2): Die Person ist ihr eigener Kader - sie hört nur, was ihr selbst fehlt, eine Kader-Übersicht gibt es nicht.
        side = squad or {"id": None, "member_ids": [person["id"]], "name": application.get("display_name")}
        await league_open_points.after_submit(db, league, fresh, application, side, minimum=await _ready_minimum(db, fresh),
                                              responsible=set() if solo else await _responsible(db, squad))
    except Exception:  # noqa: BLE001 - der Antrag ist schon gespeichert, eine Erinnerung hält ihn nie auf
        logger.warning("[liga] Erinnerung an fehlende Angaben nicht verschickt: %s", log_safe(application.get("id")), exc_info=True)
    return application


async def _write_person(db, league: dict, season: dict, version: dict, person: dict) -> dict:
    """Der Antrag einer Person (#1629, P2): dieselbe Sammlung, dieselben Felder wie beim Co-Team - ``user_id`` statt Co-Team, der Schlüssel
    ``<season>:user:<id>``. Die Person stimmt selbst zu (F4 A); den Platzhalter zum Datenschutz liest sie in ihrer Ansprache."""
    now = now_utc().isoformat()
    application_id = new_id()
    user_id = person["id"]
    doc = {
        "id": application_id, "league_id": league["id"], "season_id": season["id"], "user_id": user_id, "team_id": None, "squad_id": None,
        "team_name": None, "squad_name": None, "display_name": league_roster.person_name(person),
        "status": SUBMITTED, "active_key": _person_key(season, user_id), "applied_by": user_id, "submitted_at": now,
        "privacy_consent": {"text": privacy_text_for(season, person, solo=True), "user_id": user_id, "at": now},
        "history": [{"status": SUBMITTED, "by": user_id, "at": now}], "created_at": now, "updated_at": now,
    }
    try:
        await db.league_applications.insert_one(dict(doc))
    except DuplicateKeyError:
        raise LeagueProblem(ALREADY_OPEN_PERSON, 409) from None
    try:
        consent = await league_rules.record_consent(db, league["id"], version, season["id"], None, None, user_id)
    except Exception:
        await db.league_applications.delete_one({"id": application_id})
        raise
    rule_consent = {"consent_id": consent["id"], "rule_version_id": version["id"], "version": version.get("version"), "user_id": user_id,
                    "at": consent["created_at"]}
    await db.league_applications.update_one({"id": application_id}, {"$set": {"rule_consent": rule_consent}})
    return {**doc, "rule_consent": rule_consent}


async def _write(db, league: dict, season: dict, version: dict, team: dict, squad: dict, user: dict) -> dict:
    now = now_utc().isoformat()
    application_id = new_id()
    doc = {
        "id": application_id, "league_id": league["id"], "season_id": season["id"], "team_id": team["id"], "squad_id": squad["id"],
        "team_name": team.get("name"), "squad_name": squad.get("name"), "display_name": squad_registration.display_name(team, squad),
        "status": SUBMITTED, "active_key": f"{season['id']}:{squad['id']}", "applied_by": user["id"], "submitted_at": now,
        "privacy_consent": {"text": privacy_text_for(season, user), "user_id": user["id"], "at": now},
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


def _assigned_already(application: dict) -> str:
    return ASSIGNED_ALREADY_PERSON if league_participants.is_person_application(application) else ASSIGNED_ALREADY


async def _load(db, season_id: str, application_id: str) -> dict:
    application = await db.league_applications.find_one({"id": application_id, "season_id": season_id}, {"_id": 0})
    if not application:
        raise LeagueProblem(GONE, 404)
    return application


async def _left_over(db, application: dict) -> dict | None:
    """Brach ein früherer Versuch nach dem Schreiben der Anmeldung ab, steht sie ohne Zuteilung am Antrag. Sie gilt: Annehmen und Zuteilen schließen ab, statt an ihr zu scheitern."""
    entry = league_participants.application_entry(application)
    if application.get("assignment") or not entry:
        return None
    return await db.tournament_registrations.find_one(
        {"league_squad_key": f"{application['season_id']}:{entry}", "application_id": application["id"], "status": {"$in": list(SEAT_STATUSES)}}, {"_id": 0})


async def _move(db, application: dict, status: str, actor_id: str | None, *, fields: dict | None = None, reason: str | None = None, keep_active: bool = True,
                override: str | None = None, auto: bool = False, drop_assignment: bool = False) -> dict:
    """Der Statuswechsel mit Bedingung auf den alten Stand. Antwortet mit 409, wenn inzwischen etwas anderes geschah. ``override``: der Grund einer Notausnahme
    des Superadmins (#2245), er steht im Verlauf. ``auto``: Die Season hat entschieden (#2348), der Schritt trägt ``auto``. Jede Entscheidung einer Person
    nimmt ``auto_accepted`` und den Grund ``auto_problem`` wieder weg. ``drop_assignment``: Die automatische Zuteilung fällt weg (Ablehnen, Warteliste)."""
    now = now_utc().isoformat()
    step = {"status": status, "by": actor_id, "at": now, **({"reason": reason} if reason else {}), **({"conflict_reason": override} if override else {}),
            **({"auto": True} if auto else {})}
    update: dict = {"$set": {"status": status, "updated_at": now, **(fields or {})}, "$push": {"history": step}}
    unset = {key: "" for key, wanted in (("active_key", not keep_active), ("assignment", drop_assignment),
                                         ("auto_accepted", not auto and application.get("auto_accepted")),
                                         ("auto_problem", not auto and application.get("auto_problem"))) if wanted}
    if unset:
        update["$unset"] = unset
    query = {"id": application["id"], "status": application["status"], "assignment": {"$exists": bool(application.get("assignment"))}}
    written = await db.league_applications.update_one(query, update)
    if not written.modified_count:
        raise LeagueProblem(DECIDED, 409)
    out = {**application, **update["$set"], "history": [*(application.get("history") or []), step]}
    for key in unset:
        out.pop(key, None)
    return out


async def withdraw(db, league: dict, season: dict, application_id: str, user: dict, *, refresh_previews=None, on_released=None) -> dict:
    """Zurückziehen. Eine automatische Zuteilung (#2348) nimmt es mit aus der Staffel, solange kein fester Spielplan steht (``_auto_seat`` unter der
    Staffel-Sperre). Die Warteliste bleibt unberührt: Über den frei gewordenen Platz entscheidet die Leitung.

    ``on_released`` (#1627, F.2a): ``league_start_rights.released`` - die Route gibt es mit (kein Import von hier nach dort). Führt
    die Season Startrechte, rückt damit unter derselben Sperre nach ihrer Regel jemand nach."""
    application = await _load(db, season["id"], application_id)
    person = league_participants.is_person_application(application)
    squad = None
    if person:
        # Anmeldung als Person (#1629, P2): Zurückziehen darf nur sie selbst - sie hat die Rechte des Captains.
        if not application.get("user_id") or application.get("user_id") != user.get("id"):
            raise LeagueProblem(NOT_THE_PERSON, 403)
    else:
        _team, squad = await _load_side(db, application["squad_id"])
        if not squad or not await may_apply(db, user, squad):
            raise LeagueProblem(NOT_RESPONSIBLE, 403)
    assigned_detail = WITHDRAW_ASSIGNED_PERSON if person else WITHDRAW_ASSIGNED
    locked_id = await _auto_seat_to_lock(db, season["id"], application_id)
    async with _staffel_lock(db, locked_id):
        async with _season_lock(db, season["id"]):
            application = await _load(db, season["id"], application_id)
            if application["status"] not in OPEN_STATUSES:
                raise LeagueProblem(DECIDED, 409)
            fresh = await league_service.get_season(db, season["id"])
            if not carry_open(application, fresh):
                raise LeagueProblem(CARRY_DEADLINE.format(day=_day(fresh.get("started_at") or fresh.get("start_date"))), 409)
            seat = await _auto_seat(db, season, application, locked_id, fixed_detail=assigned_detail)
            if not seat and (application.get("assignment") or await _left_over(db, application)):
                raise LeagueProblem(assigned_detail, 409)
            if seat and not _team_may_leave(*seat):
                raise LeagueProblem(WITHDRAW_STARTED, 409)
            now = now_utc().isoformat()
            # Startrechte (#1627, F.2a): Das Abmelden ist die Absage - im selben Schreibvorgang wie der Statuswechsel.
            done = await _move(db, application, WITHDRAWN, user["id"],
                               fields={"withdrawn_by": user["id"], "withdrawn_at": now, **league_start_right_rules.decline_fields(application, now)},
                               keep_active=False, drop_assignment=bool(seat))
            await _unseat(db, seat)
            # Führt die Season Startrechte, rückt nach ihrer Regel jemand nach (unter derselben Sperre). Sonst geschieht hier nichts.
            moved_up = await _released(db, fresh, done, on_released)
        await _after_unseat(db, seat, user, refresh_previews)
    await _audit(db, "withdraw", done, user["id"], **_unseat_data(seat))
    await _tell_status(db, league, season, done, WITHDRAWN, squad=squad,
                       follow=f"{moved_up.get('display_name')} rückt nach." if moved_up else None)
    return done


async def _released(db, season: dict, application: dict, on_released) -> dict | None:
    """Nach dem Abmelden eines übernommenen Antrags (``league_start_rights.released``). Ein Fehler beim Nachrücken nimmt das Abmelden
    nicht zurück - der Platz bleibt dann frei, die Leitung sieht ihn bei den Startrechten."""
    if not on_released or not application.get("carry_over"):
        return None
    try:
        return await on_released(db, season, await db.league_applications.find_one({"id": application["id"]}, {"_id": 0}) or application)
    except Exception:  # noqa: BLE001 - siehe oben
        logger.warning("[liga] Nachrücken nach dem Abmelden nicht ausgeführt: %s", log_safe(application.get("id")), exc_info=True)
        return None


async def withdraw_own(db, application_id: str, user: dict, *, refresh_previews=None, on_released=None) -> dict:
    """Zurückziehen bzw. abmelden von der Team-Seite (F.2): ohne Umweg über die Ligaseite - eine übernommene Season ist oft noch nicht
    veröffentlicht. Dieselben Regeln wie ``withdraw``: nur Captain und Vertreter, Frist bis zum Start."""
    application = await db.league_applications.find_one({"id": application_id}, {"_id": 0, "season_id": 1, "squad_id": 1, "carry_over": 1})
    # Nur übernommene Anträge: Alles andere zieht das Team wie bisher auf der Ligaseite zurück.
    if not application or not application.get("carry_over"):
        raise LeagueProblem(GONE, 404)
    _team, squad = await _load_side(db, application["squad_id"])
    if not squad or not await may_apply(db, user, squad):
        raise LeagueProblem(NOT_RESPONSIBLE, 403)
    season = await league_service.get_season(db, application["season_id"])
    league = await league_service.get_league(db, season["league_id"])
    return await withdraw(db, league, season, application_id, user, refresh_previews=refresh_previews, on_released=on_released)


async def review(db, league: dict, season: dict, application_id: str, actor: dict, *, conflict_reason: str | None = None) -> dict:
    override = await _no_conflict(db, season, application_id, actor, conflict_reason)
    async with _season_lock(db, season["id"]):
        application = await _load(db, season["id"], application_id)
        override = await _recheck(db, application, actor, conflict_reason)
        if application["status"] != SUBMITTED:
            raise LeagueProblem(DECIDED, 409)
        done = await _move(db, application, IN_REVIEW, actor["id"], override=override)
    await _audit_decision(db, "review", done, actor, override)
    return done


async def reject(db, league: dict, season: dict, application_id: str, reason: str | None, actor: dict, *, conflict_reason: str | None = None,
                 refresh_previews=None) -> dict:
    """Ablehnen. Eine automatische Zuteilung (#2348) nimmt es mit aus der Staffel (``_auto_seat``), jede andere Zuteilung bleibt der Teilnehmerliste."""
    override = await _no_conflict(db, season, application_id, actor, conflict_reason)
    text = (reason or "").strip()
    if len(text) < REASON_MIN:
        person = league_participants.is_person_application(await _load(db, season["id"], application_id))
        raise LeagueProblem(REJECT_REASON_PERSON if person else REJECT_REASON)
    locked_id = await _auto_seat_to_lock(db, season["id"], application_id)
    async with _staffel_lock(db, locked_id):
        async with _season_lock(db, season["id"]):
            application = await _load(db, season["id"], application_id)
            override = await _recheck(db, application, actor, conflict_reason)
            if application["status"] not in OPEN_STATUSES:
                raise LeagueProblem(DECIDED, 409)
            seat = await _auto_seat(db, season, application, locked_id)
            if not seat and (application.get("assignment") or await _left_over(db, application)):
                raise LeagueProblem(_assigned_already(application), 409)
            now = now_utc().isoformat()
            done = await _move(db, application, REJECTED, actor["id"], reason=text, keep_active=False, override=override, drop_assignment=bool(seat),
                               fields={"decided_by": actor["id"], "decided_at": now, "decision_reason": text})
            await _unseat(db, seat)
        await _after_unseat(db, seat, actor, refresh_previews)
    await _audit_decision(db, "reject", done, actor, override, reason=text, **_unseat_data(seat))
    await _tell_status(db, league, season, done, REJECTED)
    return done


async def waitlist(db, league: dict, season: dict, application_id: str, reason: str | None, actor: dict, *, conflict_reason: str | None = None,
                   refresh_previews=None) -> dict:
    """Auf die Warteliste. Eine angenommene Anmeldung zurückstufen geht nur mit Grund (#2348), automatisch oder von Hand angenommen - das Team liest ihn.
    Eine automatische Zuteilung fällt dabei weg."""
    override = await _no_conflict(db, season, application_id, actor, conflict_reason)
    text = (reason or "").strip() or None
    locked_id = await _auto_seat_to_lock(db, season["id"], application_id)
    async with _staffel_lock(db, locked_id):
        async with _season_lock(db, season["id"]):
            fresh = await league_service.get_season(db, season["id"])
            application = await _load(db, season["id"], application_id)
            override = await _recheck(db, application, actor, conflict_reason)
            if application["status"] not in (SUBMITTED, IN_REVIEW, ACCEPTED):
                raise LeagueProblem(DECIDED, 409)
            seat = await _auto_seat(db, fresh, application, locked_id)
            if not seat and (application.get("assignment") or await _left_over(db, application)):
                raise LeagueProblem(_assigned_already(application), 409)
            if not fresh.get("application_waitlist"):
                raise LeagueProblem(NO_WAITLIST, 409)
            if not _waitlist_has_room(fresh, await seat_stats(db, fresh)):
                raise LeagueProblem(WAITLIST_FULL, 409)
            if application["status"] == ACCEPTED and len(text or "") < REASON_MIN:
                raise LeagueProblem(DEMOTE_REASON_PERSON if league_participants.is_person_application(application) else DEMOTE_REASON)
            now = now_utc().isoformat()
            done = await _move(db, application, WAITLIST, actor["id"], reason=text, override=override, drop_assignment=bool(seat),
                               fields={"decided_by": actor["id"], "decided_at": now, "decision_reason": text})
            await _unseat(db, seat)
        await _after_unseat(db, seat, actor, refresh_previews)
    await _audit_decision(db, "waitlist", done, actor, override, **({"reason": text} if text else {}), **_unseat_data(seat))
    await _tell_status(db, league, season, done, WAITLIST)
    return done


async def _load_staffel(db, season: dict, tournament_id: str) -> dict:
    tournament = await db.tournaments.find_one({"id": tournament_id, "league_context.season_id": season["id"], "league_context.kind": None, **ONLY_LEAGUE},
                                               {"_id": 0})
    if not tournament:
        raise LeagueProblem(STAFFEL_GONE, 404)
    return tournament


@contextlib.asynccontextmanager
async def _staffel_lock(db, tournament_id: str | None, *, wait_seconds: float = 2.0):
    """Die Turnier-Sperre, immer vor der Season-Sperre. Das Einreichen mit automatischer Zuteilung (#2348) wartet so lange wie auf die Season."""
    if not tournament_id:
        yield
        return
    try:
        async with mutation_lock(db, tournament_write_resource(tournament_id), wait_seconds=wait_seconds):
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
    person = league_participants.is_person_application(application)
    try:
        if person:
            # Anmeldung als Person (#1629, P2): dieselbe Einzel-Anmeldung wie beim Zuteilen durch die Leitung, nur aus dem Antrag.
            if not application.get("user_id"):
                raise LeagueProblem(PERSON_GONE, 409)
            registration = await squad_registration.build_person_registration(
                db, tournament, application["user_id"], actor, consent=consent, via=VIA, source=VIA, application_id=application["id"],
                registered_by=application.get("applied_by"))
        else:
            registration = await squad_registration.build_registration(
                db, tournament, application["team_id"], application["squad_id"], actor, consent=consent, via=VIA, source=VIA,
                application_id=application["id"], registered_by=application.get("applied_by"))
    except squad_registration.SquadAssignError as refusal:
        raise LeagueProblem(refusal.detail, refusal.status_code) from None
    try:
        await db.tournament_registrations.insert_one(dict(registration))
    except DuplicateKeyError:
        raise LeagueProblem(squad_registration.PERSON_SEASON_TAKEN if person else squad_registration.SEASON_TAKEN, 409) from None
    return registration


async def _assignment(db, tournament: dict, registration: dict, actor_id: str | None) -> dict:
    context = tournament["league_context"]
    division = await db.league_divisions.find_one({"id": context.get("division_id")}, {"_id": 0}) or {}
    return {"division_id": context.get("division_id"), "tournament_id": tournament["id"], "staffel": context.get("staffel"),
            "label": " · ".join(part for part in (league_service.division_label(division) if division else None, f"Staffel {context.get('staffel')}") if part),
            "registration_id": registration["id"], "assigned_by": actor_id, "assigned_at": now_utc().isoformat()}


async def _after_assign(db, tournament: dict, registration: dict, actor: dict, refresh_previews) -> list[str]:
    """Wie beim Zuteilen: Vorschau auffrischen (``refresh_previews`` reicht die Route herein, ein Service importiert keine Route), Spiel-IDs
    festhalten. Sagt, wem die ID noch fehlt."""
    await refresh_previews(db, tournament, actor.get("id"))
    if registration.get("squad_id"):
        squad = await db.team_squads.find_one({"id": registration["squad_id"]}, {"_id": 0, "id": 1, "member_ids": 1}) or {}
    else:
        # Solo-Liga (#1629): Die Person ist ihr eigener Kader - wie beim Zuteilen durch die Leitung.
        squad = {"id": None, "member_ids": [registration.get("user_id")]}
    ids = await league_roster.after_assign(db, tournament, registration, squad, actor.get("id"))
    return sorted(row["name"] for row in league_roster.waiting_for_id(ids.values()))


async def _staffel_to_lock(db, season_id: str, application_id: str, tournament_id: str | None) -> str | None:
    """Die Staffel eines abgebrochenen Versuchs geht vor: Dort steht die Anmeldung schon."""
    application = await db.league_applications.find_one({"id": application_id, "season_id": season_id}, {"_id": 0})
    left_over = await _left_over(db, application) if application else None
    return left_over["tournament_id"] if left_over else tournament_id


async def _left_over_under_lock(db, application: dict, tournament_id: str | None, locked_id: str | None) -> dict | None:
    """Noch einmal unter den Sperren: Passt die gehaltene Staffel-Sperre nicht mehr, kommt die Antwort „gleich noch einmal“, und der nächste Versuch sperrt die richtige."""
    left_over = await _left_over(db, application)
    if (left_over["tournament_id"] if left_over else tournament_id) != locked_id:
        raise LeagueProblem(BUSY, 409)
    return left_over


async def _place(db, season: dict, application: dict, tournament_id: str | None, actor: dict, fields: dict, left_over: dict | None,
                 override: str | None = None, *, auto: bool = False) -> tuple[dict, dict | None, dict | None]:
    """Anmeldung und Antrag gehören zusammen, eine Transaktion gibt es nicht: Scheitert der Antrag, fällt die neue Anmeldung wieder weg. Bleibt sie trotzdem stehen, hilft ``_left_over``.
    ``auto``: Die Season nimmt an (#2348), die Zuteilung trägt ``auto`` - nur sie nehmen Ablehnen und Warteliste wieder aus der Staffel."""
    tournament = registration = None
    if left_over:
        tournament, registration = await _staffel_for_write(db, season, left_over["tournament_id"]), left_over
    elif tournament_id:
        tournament = await _staffel_for_write(db, season, tournament_id)
        registration = await _insert_registration(db, tournament, application, actor)
    try:
        if registration:
            assignment = await _assignment(db, tournament, registration, actor["id"])
            if application.get("carry_over"):
                assignment = {**assignment, "carried": True}  # übernommen (F.2): Abmelden bis zum Start nimmt sie mit heraus
            fields = {**fields, "assignment": {**assignment, "auto": True} if auto else assignment}
        done = await _move(db, application, ACCEPTED, actor["id"], fields=fields, override=override, auto=auto)
    except Exception:
        if registration and not left_over:
            await db.tournament_registrations.delete_one({"id": registration["id"]})
        raise
    return done, tournament, registration


async def accept(db, league: dict, season: dict, application_id: str, tournament_id: str | None, actor: dict, *, refresh_previews,
                 conflict_reason: str | None = None, deviation_reason: str | None = None) -> dict:
    """Annehmen, mit ``tournament_id`` gleich zuteilen. Der letzte Platz geht unter der Season-Sperre nur einmal weg."""
    override = await _no_conflict(db, season, application_id, actor, conflict_reason)
    locked_id = await _staffel_to_lock(db, season["id"], application_id, tournament_id)
    async with _staffel_lock(db, locked_id):
        async with _season_lock(db, season["id"]):
            fresh = await league_service.get_season(db, season["id"])
            application = await _load(db, season["id"], application_id)
            override = await _recheck(db, application, actor, conflict_reason)
            if application["status"] not in (SUBMITTED, IN_REVIEW, WAITLIST):
                raise LeagueProblem(DECIDED, 409)
            # Startrechte (#1627, F.2a): Die Warteliste ist kein Weg an der Zusage vorbei - gleich mit Staffel annehmen geht erst,
            # wenn das Co-Team zugesagt hat. Ohne Staffel wird das Startrecht neu vergeben (``reoffer_fields``): Die Frist beginnt neu.
            waits = league_start_right_rules.waitlist_problem(application, fresh) if tournament_id else None
            if waits:
                raise LeagueProblem(waits, 422)
            left_over = await _left_over_under_lock(db, application, tournament_id, locked_id)
            if not left_over and (await seat_stats(db, fresh))["full"]:
                raise LeagueProblem(SEATS_TAKEN_PERSON if league_participants.is_person_application(application) else SEATS_TAKEN, 409)
            # Neue Co-Teams in die unterste Liga N (#1623): Wer beim Annehmen gleich eine höhere Staffel wählt, braucht den Grund. In der
            # Solo-Liga gilt dasselbe für neue Spieler (Nr. 226 sinngemäß).
            deviation = (await division_deviation(db, fresh, application, await _load_staffel(db, fresh, tournament_id), deviation_reason)
                         if tournament_id and not left_over else None)
            problems = (await check_entry(db, league, fresh, application, seated=bool(left_over)))["problems"]
            if problems:
                raise LeagueProblem(problems[0][1], problems[0][0])
            now = now_utc().isoformat()
            fields = {"decided_by": actor["id"], "decided_at": now, "decision_reason": None,
                      **league_start_right_rules.reoffer_fields(application, now, fresh)}
            done, tournament, registration = await _place(db, fresh, application, tournament_id, actor, fields, left_over, override)
            if deviation:
                await db.league_applications.update_one({"id": done["id"]}, {"$set": {"assignment.deviation_reason": deviation}})
        ids_missing = await _after_assign(db, tournament, registration, actor, refresh_previews) if registration else []
    await _audit_decision(db, "accept", done, actor, override, **({"tournament_id": tournament_id} if tournament_id else {}),
                          **({"deviation_reason": deviation} if deviation else {}))
    await _tell_status(db, league, season, done, ACCEPTED)
    return {**done, "ids_missing": ids_missing}


def carry_deviation(application: dict, tournament: dict, reason: str | None) -> str | None:
    """Ein übernommener Antrag (F.2) gehört in eine Staffel seiner neuen Liga N. Eine andere nur mit Grund (wird zurückgegeben, steht im Verlauf)."""
    carry = application.get("carry_over") or {}
    if not carry.get("division_id") or (tournament.get("league_context") or {}).get("division_id") == carry["division_id"]:
        return None
    text = " ".join(str(reason or "").split())
    if len(text) < REASON_MIN:
        raise LeagueProblem(CARRY_OTHER_DIVISION.format(label=carry.get("division_label") or "ihrer Liga"), 422)
    return text[:500]


def target_division_id(application: dict, divisions: list[dict]) -> str | None:
    """Die Liga N, in die ein angenommenes Co-Team gehört (#1623): bei Übernommenen (F.2) die neue Liga N, sonst die unterste aktive.
    ``divisions``: die aktiven Liga N der Season, nach Stufe aufsteigend."""
    carried = (application.get("carry_over") or {}).get("division_id")
    if carried and any(row.get("id") == carried for row in divisions):
        return carried
    return divisions[-1]["id"] if divisions else None


async def _active_divisions(db, season_id: str) -> list[dict]:
    return await db.league_divisions.find({"season_id": season_id, "status": "active"},
                                          {"_id": 0, "id": 1, "level": 1, "nickname": 1}).sort("level", 1).to_list(50)


async def division_deviation(db, season: dict, application: dict, tournament: dict, reason: str | None) -> str | None:
    """Darf dieses Co-Team in diese Staffel? Übernommene (F.2) in ihre neue Liga N; neue Co-Teams in die unterste aktive Liga N, wenn die
    Season das so einstellt (``new_squads_lowest_division``, #1623). Eine andere Liga N nur mit Grund - er wird zurückgegeben und steht an
    der Zuteilung und im Protokoll. Ohne die Einstellung gilt für neue Co-Teams nichts."""
    carried = carry_deviation(application, tournament, reason)
    if carried or (application.get("carry_over") or {}).get("division_id") or not season.get(NEW_LOWEST):
        return carried
    divisions = await _active_divisions(db, season["id"])
    if not divisions or (tournament.get("league_context") or {}).get("division_id") == divisions[-1]["id"]:
        return None
    text = " ".join(str(reason or "").split())
    if len(text) < REASON_MIN:
        sentence = NEW_OTHER_DIVISION_PERSON if league_participants.is_person_application(application) else NEW_OTHER_DIVISION
        raise LeagueProblem(sentence.format(label=league_service.division_label(divisions[-1])), 422)
    return text[:500]


async def assign(db, league: dict, season: dict, application_id: str, tournament_id: str | None, actor: dict, *, refresh_previews,
                 conflict_reason: str | None = None, deviation_reason: str | None = None) -> dict:
    """Einen angenommenen Antrag einer Staffel zuteilen - erst hier entsteht die Anmeldung."""
    override = await _no_conflict(db, season, application_id, actor, conflict_reason)
    if not tournament_id:
        raise LeagueProblem("Bitte eine Staffel wählen.")
    locked_id = await _staffel_to_lock(db, season["id"], application_id, tournament_id)
    async with _staffel_lock(db, locked_id):
        async with _season_lock(db, season["id"]):
            fresh = await league_service.get_season(db, season["id"])
            application = await _load(db, season["id"], application_id)
            override = await _recheck(db, application, actor, conflict_reason)
            if application["status"] != ACCEPTED:
                raise LeagueProblem(DECIDED, 409)
            if application.get("assignment"):
                raise LeagueProblem(_assigned_already(application), 409)
            # Startrechte (#1627, F.2a): Zugeteilt wird erst nach der Zusage - ein Startrecht ist keine Teilnahme.
            waits = league_start_right_rules.assign_problem(application, fresh)
            if waits:
                raise LeagueProblem(waits, 422)
            deviation = await division_deviation(db, fresh, application, await _load_staffel(db, fresh, tournament_id), deviation_reason)
            # Der Kader kann sich seit dem Annehmen geändert haben: dieselbe Prüfung wie beim Einreichen, dazu die der Staffel. Bei einer
            # Person (#1629, P2): Konto, Sperre, Mitgliedschaft und „schon in einer Staffel“ wie beim Einreichen.
            left_over = await _left_over_under_lock(db, application, tournament_id, locked_id)
            problems = (await check_entry(db, league, fresh, application, seated=bool(left_over)))["problems"]
            if problems:
                raise LeagueProblem(problems[0][1], problems[0][0])
            done, tournament, registration = await _place(db, fresh, application, tournament_id, actor, {}, left_over, override)
            if deviation:
                await db.league_applications.update_one({"id": done["id"]}, {"$set": {"assignment.deviation_reason": deviation}})
        ids_missing = await _after_assign(db, tournament, registration, actor, refresh_previews)
    await _audit_decision(db, "assign", done, actor, override, tournament_id=tournament_id, **({"deviation_reason": deviation} if deviation else {}))
    await _tell_status(db, league, season, done, "assigned")
    return {**done, "ids_missing": ids_missing}


# ---------------------------------------------------------------- Automatisch annehmen (#2348)

async def _auto_staffel(db, season: dict) -> tuple[str | None, str | None]:
    """Die einzige Staffel der Season - nur dorthin teilt „automatisch annehmen“ gleich zu, und nur vor ihrem Start ohne feste Spiele.
    Nur bei genau einer aktiven Liga N mit genau einer Staffel: Hat eine zweite Liga N (noch) keine Staffel, wählt die Leitung trotzdem die Liga N.
    Gibt ``(Staffel, None)`` zurück; ``(None, Grund)``, wenn es die eine Staffel gibt, sie aber nicht mehr geht; ``(None, None)`` sonst."""
    divisions = [row["id"] for row in await db.league_divisions.find({"season_id": season["id"], "status": "active"}, {"_id": 0, "id": 1}).to_list(50)]
    if len(divisions) != 1:
        return None, None
    rows = [row for row in await db.tournaments.find({"league_context.season_id": season["id"], "league_context.division_id": divisions[0], "league_context.kind": None, **ONLY_LEAGUE},
                                                     {"_id": 0, "id": 1, "status": 1}).to_list(200)
            if row.get("status") not in squad_registration.FINISHED_TOURNAMENT_STATUSES]
    if len(rows) != 1:
        return None, None
    if rows[0].get("status") not in league_service.PRE_START_STATUSES:
        return None, AUTO_STAFFEL_STARTED
    if await db.matches_v2.count_documents({"tournament_id": rows[0]["id"], "is_preview": {"$ne": True}}):
        return None, AUTO_STAFFEL_PLAN
    return rows[0]["id"], None


async def _sibling_problem(db, tournament_id: str, application: dict) -> str | None:
    """Steht schon ein anderes Co-Team desselben Hauptteams in der einzigen Staffel und erlaubt die Season das nicht, nimmt die Season die Anmeldung
    nicht an: Sie belegte einen Platz, den das Co-Team nie bekommen kann. Die Leitung entscheidet (Review #2348). Eine Person hat kein Hauptteam."""
    if league_participants.is_person_application(application):
        return None
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "id": 1, "league_context": 1})
    if not tournament or await squad_registration.siblings_allowed(db, tournament):
        return None
    other = await db.tournament_registrations.find_one({"tournament_id": tournament_id, "team_id": application.get("team_id"),
                                                        "squad_id": {"$ne": application.get("squad_id")}}, {"_id": 1})
    return AUTO_SIBLING.format(team=application.get("team_name") or "Das Hauptteam") if other else None


async def _keep_submitted(db, application: dict, problem: str) -> dict:
    """Die Season entscheidet nicht: Der Antrag bleibt eingereicht und trägt den Grund für die Leitung (``auto_problem``)."""
    await db.league_applications.update_one({"id": application["id"], "status": SUBMITTED}, {"$set": {"auto_problem": problem}})
    return {**application, "auto_problem": problem}


async def _auto_decide(db, season: dict, application: dict, locked_id: str | None) -> tuple[dict, dict | None, dict | None, str | None] | None:
    """Die Season entscheidet über eine frisch eingereichte Anmeldung: Mit freiem Platz und leerer Warteliste ist sie angenommen, sonst steht sie auf
    der Warteliste - ein frei gewordener Platz geht nach den Regeln der Warteliste, also durch die Leitung. Wer zuerst kommt, wird zuerst bedient:
    Offene Anmeldungen (eingereicht, in Prüfung) halten ihren Platz und zählen hier wie belegte. Keine Entscheidung einer Person, darum ohne
    Befangenheit (Nr. 73). Lehnt die einzige Staffel ab (voll, gesperrt …), ist die Anmeldung ohne Zuteilung angenommen und trägt den Grund
    (``auto_problem``); steht dort schon ein Geschwister-Co-Team, bleibt sie eingereicht. Was gar nicht geht, bleibt eingereicht.
    Gibt ``(Antrag, Staffel, Anmeldung, Grund)`` zurück oder ``None``. Aufrufer halten die Sperren."""
    stats = await seat_stats(db, season)
    now = now_utc().isoformat()
    decided = {"decided_by": None, "decided_at": now, "decision_reason": None}
    # Die eben geschriebene Anmeldung steht selbst unter ``open``.
    held = stats["taken"] + max(0, stats["open"] - 1)
    seat_free = not stats["slots"] or held < stats["slots"]
    try:
        if seat_free and not stats["waiting"]:
            target, problem = await _auto_staffel(db, season)
            if target and target != locked_id:
                target, problem = None, None  # Die gehaltene Sperre passt nicht mehr (sehr selten): Die Leitung teilt zu.
            if target:
                sibling = await _sibling_problem(db, target, application)
                if sibling:
                    return await _keep_submitted(db, application, sibling), None, None, sibling
                try:
                    done, tournament, registration = await _place(db, season, application, target, AUTO_ACTOR, {**decided, "auto_accepted": True}, None,
                                                                  auto=True)
                    return done, tournament, registration, None
                except LeagueProblem as refusal:
                    problem = refusal.message
                    logger.info("[liga] Automatisch angenommen, die Staffel teilt die Leitung zu: %s", log_safe(application.get("id")))
            fields = {**decided, "auto_accepted": True, **({"auto_problem": problem} if problem else {})}
            done, _tournament, _registration = await _place(db, season, application, None, AUTO_ACTOR, fields, None, auto=True)
            return done, None, None, problem
        if _waitlist_has_room(season, stats):
            return await _move(db, application, WAITLIST, None, fields=decided, auto=True), None, None, None
    except LeagueProblem:
        logger.warning("[liga] Automatische Annahme nicht möglich, der Antrag bleibt eingereicht: %s", log_safe(application.get("id")))
    return None


async def _auto_decide_safely(db, season: dict, application: dict, locked_id: str | None) -> tuple[tuple | None, dict]:
    """``_auto_decide``, ohne dass ein unerwarteter Fehler das Einreichen kippt: Antrag und Zustimmung sind schon gespeichert. Der Antrag bleibt dann
    eingereicht und stimmig (``_place`` nimmt eine neue Anmeldung wieder weg, ``_move`` ist der letzte Schritt), der Fehler steht im Log statt einer 500,
    die Leitung hört den Grund. Gibt die Entscheidung und den Antrag, wie er jetzt gilt, zurück."""
    try:
        decided = await _auto_decide(db, season, application, locked_id)
    except Exception:  # noqa: BLE001 - Antrag und Zustimmung sind gespeichert; ohne Entscheidung der Season bleibt er eingereicht (Review #2348)
        logger.error("[liga] Automatisch annehmen fehlgeschlagen, der Antrag bleibt eingereicht: %s", log_safe(application.get("id")), exc_info=True)
        stored = await db.league_applications.find_one({"id": application["id"]}, {"_id": 0}) or application
        if stored.get("status") != SUBMITTED:
            return (stored, None, None, None), stored
        return None, {**stored, "auto_problem": AUTO_FAILED}
    return decided, decided[0] if decided else application


async def _no_refresh(_db, _tournament, _actor_id):
    return None


async def _after_auto_assign(db, tournament: dict, registration: dict, refresh_previews) -> None:
    """Wie nach dem Zuteilen durch die Leitung: Vorschau auffrischen, Kader der Season festhalten. Annahme und Zuteilung stehen dann schon - ein Fehler
    hier kippt das Einreichen nicht, er steht im Log."""
    try:
        await _after_assign(db, tournament, registration, AUTO_ACTOR, refresh_previews or _no_refresh)
    except Exception:  # noqa: BLE001 - Antrag und Anmeldung sind geschrieben; Vorschau und Kader holt die nächste Änderung der Staffel nach (Review #2348)
        logger.error("[liga] Nach der automatischen Zuteilung nicht alles erledigt: %s", log_safe(registration.get("id")), exc_info=True)


async def _auto_seat_to_lock(db, season_id: str, application_id: str) -> str | None:
    """Die Staffel einer automatischen Zuteilung: Ablehnen und Warteliste sperren sie vor der Season."""
    application = await db.league_applications.find_one({"id": application_id, "season_id": season_id}, {"_id": 0, "assignment": 1})
    assignment = (application or {}).get("assignment") or {}
    return assignment.get("tournament_id") if self_seat(assignment) else None


async def _auto_seat(db, season: dict, application: dict, locked_id: str | None, *, fixed_detail: str = AUTO_PLAN_FIXED) -> tuple[dict, dict] | None:
    """Staffel und Anmeldung einer automatischen Zuteilung, die Ablehnen, Warteliste und Zurückziehen wieder herausnehmen - solange sie einen Platz hält,
    die Staffel nicht gesperrt ist und sie in keinem festen Spiel steht. ``None``: keine solche Zuteilung, dann gilt wie bisher ``ASSIGNED_ALREADY``.
    ``fixed_detail``: der Satz bei festem Spielplan - das Team liest einen anderen als die Leitung."""
    assignment = application.get("assignment") or {}
    if not self_seat(assignment):
        return None
    if assignment.get("tournament_id") != locked_id:
        raise LeagueProblem(BUSY, 409)
    registration = await db.tournament_registrations.find_one(
        {"id": assignment.get("registration_id"), "tournament_id": locked_id, "status": {"$in": list(SEAT_STATUSES)}}, {"_id": 0})
    if not registration:
        return None
    tournament = await _staffel_for_write(db, season, locked_id)
    from services.tournament_guard import fixed_match_count

    if await fixed_match_count(db, locked_id, registration["id"]):
        raise LeagueProblem(fixed_detail, 409)
    return tournament, registration


def _team_may_leave(tournament: dict, registration: dict) -> bool:
    """Dieselbe Regel wie bei der Turnier-Abmeldung durch das Team (``tournament_registration_routes.unregister``): nicht eingecheckt, und die Staffel steht
    noch vor Check-in und Start. Danach trägt die Liga-Leitung den Austritt ein."""
    return registration.get("status") != "checked_in" and (tournament.get("status") or "draft") in TEAM_LEAVE_STATUSES


async def _auto_withdrawable(db, application: dict | None) -> bool:
    """Darf das Team eine automatische Zuteilung noch selbst zurückziehen? Ja, solange sie einen Platz hält, nicht eingecheckt ist, die Staffel vor Check-in
    und Start steht und kein fester Spielplan steht - für den Knopf. Geprüft wird beim Zurückziehen unter der Sperre noch einmal."""
    assignment = (application or {}).get("assignment") or {}
    if not self_seat(assignment) or application.get("status") != ACCEPTED:
        return False
    registration_id = assignment.get("registration_id")
    registration = await db.tournament_registrations.find_one({"id": registration_id, "status": {"$in": list(SEAT_STATUSES)}}, {"_id": 0, "status": 1})
    tournament = await db.tournaments.find_one({"id": assignment.get("tournament_id")}, {"_id": 0, "status": 1})
    if not registration or not tournament or not _team_may_leave(tournament, registration):
        return False
    from services.tournament_guard import fixed_match_count

    return not await fixed_match_count(db, assignment.get("tournament_id"), registration_id)


async def _unseat(db, seat: tuple[dict, dict] | None) -> None:
    """Wie „Zuteilung zurücknehmen“ in der Turnierverwaltung: Die Anmeldung fällt weg, der Platz ist frei. Erst nach dem Statuswechsel des Antrags."""
    if seat:
        await db.tournament_registrations.delete_one({"id": seat[1]["id"], "tournament_id": seat[0]["id"]})


async def _after_unseat(db, seat: tuple[dict, dict] | None, actor: dict, refresh_previews) -> None:
    if seat and refresh_previews:
        await refresh_previews(db, seat[0], actor.get("id"))


def _unseat_data(seat: tuple[dict, dict] | None) -> dict:
    return {"registration_removed": seat[1]["id"], "tournament_id": seat[0]["id"]} if seat else {}


# ---------------------------------------------------------------- Sonderweg: Zuteilen ohne Antrag

async def _open_for_admin_way(db, tournament: dict, entry: str | None) -> dict | None:
    """Der offene Antrag ohne Zuteilung, den das Zuteilen per Sonderweg annehmen würde. ``entry``: das Co-Team oder in der Solo-Liga
    (#1629, P2) die Person als ``user:<id>`` - der Schlüssel des Antrags."""
    season_id = (tournament.get("league_context") or {}).get("season_id")
    if not season_id or not entry:
        return None
    application = await db.league_applications.find_one({"active_key": f"{season_id}:{entry}"}, {"_id": 0})
    return None if not application or application.get("assignment") else application


def _admin_way_details(application: dict) -> dict:
    if league_participants.is_person_application(application):
        return {"detail": PERSON_CONFLICT_DETAIL, "superadmin_detail": PERSON_ADMIN_WAY_OVERRIDE}
    return {"superadmin_detail": ADMIN_WAY_OVERRIDE}


async def admin_assignment_conflict(db, tournament: dict, squad_id: str | None, actor: dict, conflict_reason: str | None = None, *,
                                    user_id: str | None = None) -> str | None:
    """Sonderweg: Zuteilen kennt keine Befangenheit (B.1) - nimmt es aber einen offenen Antrag an, entscheidet es über die Anmeldung, und dann
    gilt dieselbe Regel wie im Eingang (#2245). 403 vor dem Schreiben; gibt den Grund einer Notausnahme zurück. Aufrufer halten die Sperre.
    ``user_id``: die Person in einer Solo-Staffel (#1629, P2) statt des Co-Teams."""
    application = await _open_for_admin_way(db, tournament, squad_id or league_participants.person_entry(user_id))
    if not application:
        return None
    return await require_no_side_conflict(db, actor, side_of(application), conflict_reason=conflict_reason, **_admin_way_details(application))


async def link_admin_assignment(db, tournament: dict, registration: dict, actor: dict, override: str | None = None) -> None:
    """Teilt die Leitung ein Co-Team (in der Solo-Liga die Person) mit offenem Antrag direkt zu, gilt der Antrag als angenommen. Ohne Antrag passiert
    nichts. Aufrufer halten die Sperre und haben ``admin_assignment_conflict`` gefragt."""
    application = await _open_for_admin_way(db, tournament, squad_registration.season_entry(registration, tournament))
    if not application:
        return
    try:
        # Noch einmal direkt vor dem Schreiben (wie ``_recheck``); ``override`` ist der schon geprüfte Grund. Bei 403 fällt die neue Anmeldung wieder weg.
        override = await require_no_side_conflict(db, actor, side_of(application), conflict_reason=override, **_admin_way_details(application))
    except Exception:
        await db.tournament_registrations.delete_one({"id": registration["id"]})
        raise
    actor_id = actor.get("id")
    now = now_utc().isoformat()
    # Ein offenes Startrecht (#1627, F.2a) gilt mit dem Zuteilen als von der Leitung zugesagt.
    fields = {"assignment": await _assignment(db, tournament, registration, actor_id), "decided_by": actor_id, "decided_at": now,
              **league_start_right_rules.link_fields(application, actor_id, now)}
    try:
        done = await _move(db, application, ACCEPTED, actor_id, fields=fields, override=override)
    except LeagueProblem:
        return
    await _audit_decision(db, "accept", done, actor, override, tournament_id=tournament.get("id"), via="squad_assign")


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


def _person_texts(application: dict, title: str, status: str) -> tuple[str, str]:
    """Dieselben Ereignisse wie beim Co-Team, an die Person selbst (Solo-Liga, #1629, P2) - per Du, ohne Co-Team und Captain."""
    label = (application.get("assignment") or {}).get("label")
    if status == SUBMITTED:
        return "Anmeldung eingereicht", f"Du bist für {title} eingereicht. Die Liga-Leitung prüft deine Anmeldung und meldet sich."
    if status == ACCEPTED:
        if label:
            return "Anmeldung angenommen", f"Du spielst in {title}: {label}."
        return "Anmeldung angenommen", f"Du hast einen Startplatz in {title}. Liga und Staffel teilt die Liga-Leitung noch zu."
    if status == "assigned":
        return "Liga und Staffel stehen", f"Du spielst in {title}: {label}."
    if status == REJECTED:
        return "Anmeldung abgelehnt", f"Die Liga-Leitung hat deine Anmeldung für {title} abgelehnt: {application.get('decision_reason')}"
    if status == WAITLIST:
        reason = f" Grund: {application.get('decision_reason')}" if application.get("decision_reason") else ""
        return "Auf der Warteliste", f"Du stehst für {title} auf der Warteliste. Wird ein Platz frei, entscheidet die Liga-Leitung.{reason}"
    return "Anmeldung zurückgezogen", f"Deine Anmeldung für {title} ist zurückgezogen."


def _texts(application: dict, title: str, status: str) -> tuple[str, str]:
    if league_participants.is_person_application(application):
        return _person_texts(application, title, status)
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
        # Der Grund steht dabei, wenn die Leitung einen angibt - beim Zurückstufen einer automatisch angenommenen Anmeldung ist er Pflicht (#2348).
        reason = f" Grund: {application.get('decision_reason')}" if application.get("decision_reason") else ""
        return "Auf der Warteliste", f"{name} steht für {title} auf der Warteliste. Wird ein Platz frei, entscheidet die Liga-Leitung.{reason}"
    if application.get("carry_over"):
        return "Abgemeldet", f"{name} ist von {title} abgemeldet. Der Startplatz ist frei."
    return "Anmeldung zurückgezogen", f"Die Anmeldung von {name} für {title} ist zurückgezogen."


def _lead_texts(application: dict, title: str, status: str, auto: bool, follow: str | None = None) -> tuple[str, str] | None:
    """Was die Leitung hört: neue und zurückgezogene Anmeldungen, und was die Season automatisch entschieden hat (#2348)."""
    name = application.get("display_name")
    # Der Grund, warum die Season nicht (ganz) entscheiden konnte (Review #2348): Staffel voll, gesperrt, Geschwister-Co-Team, Fehler.
    problem = application.get("auto_problem")
    if auto and status == ACCEPTED:
        label = (application.get("assignment") or {}).get("label")
        where = f", {label}" if label else ", Liga und Staffel teilst du noch zu"
        why = f" Automatisch zuteilen ging nicht: {problem}" if problem else ""
        return "Neue Anmeldung", f"{name} ist für {title} automatisch angenommen{where}.{why} Passt etwas nicht, kannst du nachträglich mit Grund ablehnen."
    if auto and status == WAITLIST:
        return "Neue Anmeldung", f"{name} steht für {title} automatisch auf der Warteliste. Wird ein Platz frei, entscheidest du, wer nachrückt."
    if status == SUBMITTED:
        why = f" Automatisch annehmen ging nicht: {problem}" if problem else ""
        return "Neue Anmeldung", f"{name} möchte in {title} mitspielen.{why} Bitte prüfen."
    if status == WITHDRAWN and application.get("carry_over"):
        # ``follow`` (#1627, F.2a): Nach der Regel der Season ist schon jemand nachgerückt - dann sagt die Nachricht, wer.
        return "Abmeldung aus der neuen Season", (f"{name} hat sich von {title} abgemeldet ({(application.get('carry_over') or {}).get('division_label')}). "
                                                  + (follow or "Der Platz ist frei - wer nachrückt, entscheidest du."))
    if status == WITHDRAWN:
        return "Anmeldung zurückgezogen", f"{name} hat die Anmeldung für {title} zurückgezogen. Rückt jemand nach, entscheidest du das."
    return None


async def _audience(db, application: dict, squad: dict | None = None) -> set[str]:
    """Wer zum Antrag die Nachricht bekommt: Captain und Vertreter (ohne beide die Hauptteam-Leitung) - in der Solo-Liga (#1629, P2) die
    Person selbst, solange ihr Konto aktiv ist."""
    if league_participants.is_person_application(application):
        person = await _load_person(db, application.get("user_id"))
        return {person["id"]} if person and not person.get("is_banned") and person.get("is_active") is not False else set()
    squad = squad or await db.team_squads.find_one({"id": application["squad_id"]}, {"_id": 0}) or _side({"id": application["squad_id"], "team_id": application["team_id"]})
    return await _responsible(db, squad)


async def _tell_status(db, league: dict, season: dict, application: dict, status: str, *, squad: dict | None = None, auto: bool = False,
                       follow: str | None = None) -> None:
    """Eine Nachricht hält nie etwas auf: Der Antrag ist dann schon gespeichert. ``auto``: Die Season hat entschieden (#2348) - die Leitung hört es auch."""
    from services.user_notifications import create_user_notification

    try:
        team_ids = await _audience(db, application, squad)
        title = _season_title(league, season)
        step = len(application.get("history") or [])
        headline, text = _texts(application, title, status)
        page = f"/liga/{league.get('slug')}/{season.get('slug')}"
        meta = {"reason": f"league_application_{status}", "application_id": application["id"]}
        for user_id in sorted(team_ids):
            key = f"league-application:{application['id']}:{status}:{step}:{user_id}"
            await create_user_notification(user_id, headline, text, url=page, kind="tournament_registration", meta={**meta, "dedupe_key": key})
            await send_league_mail(db, user_id, headline, text, page, f"{key}:mail")
        lead = _lead_texts(application, title, status, auto, follow)
        if not lead:
            return
        lead_title, lead_text = lead
        if (status == SUBMITTED or auto) and application.get("team_id"):
            # Gastteam (#1665): Die Leitung hört, ob das Team als Gast bestätigt ist oder eine Angabe dazu auf sie wartet.
            from services import league_guests

            lead_text += league_guests.lead_hint(await db.teams.find_one({"id": application.get("team_id")}, league_guests.PROJECTION))
        inbox = f"/admin/leagues/seasons/{season['id']}#anmeldungen"
        for user_id in sorted(await staff_user_ids(db, league["id"], ("applications",)) - team_ids):
            key = f"league-application:{application['id']}:{status}:{step}:{user_id}"
            await create_user_notification(user_id, lead_title, lead_text, url=inbox, kind="tournament_registration", meta={**meta, "dedupe_key": key})
            await send_league_mail(db, user_id, lead_title, lead_text, inbox, f"{key}:mail")
    except Exception:  # noqa: BLE001 - siehe oben
        logger.warning("[liga] Nachricht zum Antrag nicht verschickt: %s", log_safe(application.get("id")), exc_info=True)


# ---------------------------------------------------------------- Lesen: Captain und Team

async def _left_staffel(db, rows: list[dict]) -> set[str]:
    """Welche zugeteilten Anträge nicht mehr in der Staffel stehen (Austritt, Disqualifikation): Der Antrag bleibt, sein Platz ist frei."""
    ids = [row["assignment"]["registration_id"] for row in rows if (row.get("assignment") or {}).get("registration_id")]
    if not ids:
        return set()
    active = {row["id"] for row in await db.tournament_registrations.find({"id": {"$in": ids}, "status": {"$in": list(SEAT_STATUSES)}}, {"_id": 0, "id": 1}).to_list(len(ids) + 1)}
    return {row["id"] for row in rows if (row.get("assignment") or {}).get("registration_id") and row["assignment"]["registration_id"] not in active}


async def team_answer(db, application: dict) -> dict:
    """Die Antwort an Captain und Vertreter nach dem Einreichen oder Zurückziehen: ohne Kennungen der Leitung. Ob eine eben gemachte automatische
    Zuteilung noch zurückgeht, sagt dieselbe Regel wie auf der Ligaseite (``_auto_withdrawable``) - etwa nicht, wenn der Check-in der Staffel läuft."""
    withdrawable = await _auto_withdrawable(db, application)
    season = await db.league_seasons.find_one({"id": application.get("season_id")}, {"_id": 0}) if application.get("carry_over") else None
    return {**own_view(application, responsible=True, can_act=True, withdrawable=withdrawable, season=season), "rule_consent": application.get("rule_consent")}


def carry_view(application: dict | None, season: dict | None, *, can_act: bool = False) -> dict | None:
    """Woher ein übernommenes Co-Team kommt und bis wann es sich abmelden kann (F.2) - ohne Kennungen. Führt die Season Startrechte
    (#1627, F.2a), dazu ``start_right`` mit Zustand und Frist; ``can_act``: Captain oder Vertreter darf zusagen bzw. ablehnen."""
    carry = (application or {}).get("carry_over")
    if not carry:
        return None
    until = carry_deadline(application, season)
    right = league_start_right_rules.view(application, season, can_act=can_act)
    return {"from_season_name": carry.get("from_season_name"), "from_label": carry.get("from_label"), "rank": carry.get("rank"),
            "movement": carry.get("movement"), "division_label": carry.get("division_label"),
            "withdraw_until": until.isoformat() if until else None, **({"start_right": right} if right else {})}


def own_view(application: dict | None, *, responsible: bool, can_act: bool = False, left: bool = False, withdrawable: bool = False,
             season: dict | None = None) -> dict | None:
    """Ein Antrag für das eigene Team. Der Kader sieht den Stand, ``responsible`` (Captain, Vertreter, Hauptteam-Leitung) auch den Grund, zurückziehen darf nur ``can_act`` (``may_apply``).
    Zugeteilt nur bei ``withdrawable``: eine automatische oder übernommene Zuteilung ohne festen Spielplan (#2348, F.2, ``_auto_withdrawable``).
    Übernommen aus der Vorgänger-Season (F.2): ``carry_over`` mit der Frist zum Abmelden - danach kein Zurückziehen mehr (``season``)."""
    if not application:
        return None
    out = {"id": application["id"], "status": application["status"], "submitted_at": application.get("submitted_at"),
           "staffel": (application.get("assignment") or {}).get("label"), "staffel_left": left,
           "carry_over": carry_view(application, season, can_act=can_act)}
    if responsible:
        out.update(decided_at=application.get("decided_at"), decision_reason=application.get("decision_reason"),
                   rules_label=f"Version {(application.get('rule_consent') or {}).get('version')}" if application.get("rule_consent") else None,
                   can_withdraw=can_act and application["status"] in OPEN_STATUSES and (not application.get("assignment") or withdrawable)
                   and carry_open(application, season))
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


async def _my_person_view(db, league: dict, season: dict, user: dict) -> dict:
    """Die Seite der Anmeldung in der Solo-Liga (#1629, P2): die Person selbst statt ihrer Co-Teams - Stand, Prüfung im Klartext (per Du),
    was geht. Dieselben Teile wie beim Co-Team (Fenster, Plattform, Regelwerk, Datenschutz), ``squads`` bleibt leer."""
    application = await db.league_applications.find_one({"season_id": season["id"], "user_id": user["id"], "squad_id": None}, {"_id": 0},
                                                        sort=[("created_at", -1)])
    gone = await _left_staffel(db, [application] if application else [])
    state = window_state(season)
    stats = await seat_stats(db, season) if state else None
    blocked = await season_problems(db, league, season, stats)
    version = await league_rules.current_version(db, league, season)
    person = await _load_person(db, user["id"]) or {**user}
    active = bool(application and application["status"] in OPEN_STATUSES)
    check = {"problems": [], "warnings": []}
    if state == OPEN and not active:
        check = await check_person(db, league, season, person, you=True)
    elif active:
        # Stand der Anmeldung (#2313): Was noch fehlt, bleibt nach dem Einreichen sichtbar - nur als offene Punkte.
        check = {"problems": [], "warnings": (await check_person(db, league, season, person, application=application, seated=True, you=True))["warnings"]}
    player = {
        "user_id": user["id"], "display_name": league_roster.person_name(person), "can_apply": True,
        "state": application["status"] if application else OPEN_TO_APPLY if state == OPEN else NOT_APPLIED,
        "application": own_view(application, responsible=True, can_act=True, left=bool(application and application["id"] in gone),
                                withdrawable=await _auto_withdrawable(db, application), season=season),
        "problems": [text for _code, text in check["problems"]], "warnings": check["warnings"], "shortfall": None,
        "can_submit": not active and not blocked and not check["problems"],
    }
    return {
        "kind": league_participants.SOLO,
        "application": await public_block(db, season, league),
        "platform": await league_platform.season_block(db, season),
        "rules": league_rules.version_view(league, season, version) if version else None,
        "privacy": {"text": privacy_text_for(season, user, solo=True), "url": PRIVACY_URL},
        "season_problems": blocked if state else [],
        "squads": [],
        "player": player,
        # Ältere App-Fassungen lesen nur ``squads`` und ``hint`` - ohne Satz zeigten sie den für Captains.
        "hint": PERSON_APP_HINT,
    }


async def my_view(db, league: dict, season: dict, user: dict) -> dict:
    """Die Seite der Anmeldung für die angemeldete Person: was gilt, ihre Co-Teams und was jeweils geht. In der Solo-Liga die Person selbst."""
    if league_participants.is_solo(league):
        return await _my_person_view(db, league, season, user)
    squads, teams = await _own_squads(db, user)
    games, parents = await load_games(db)
    squads = sorted((row for row in squads if _fits_game(row, league, games, parents)), key=lambda row: str(row.get("name") or "").casefold())
    latest = await _latest(db, season["id"], [row["id"] for row in squads])
    gone = await _left_staffel(db, list(latest.values()))
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
               "application": own_view(application, responsible=can_apply or user["id"] in _leads(team), can_act=can_apply, left=bool(application and application["id"] in gone),
                                       withdrawable=can_apply and await _auto_withdrawable(db, application), season=season)}
        if can_apply:
            check = {"problems": [], "warnings": [], "shortfall": None}
            if state == OPEN and not active:
                check = await check_squad(db, league, season, team, squad)
            elif active:
                # Stand der Anmeldung (#2313): Was noch fehlt, bleibt nach dem Einreichen sichtbar - nur als offene Punkte.
                found = await check_squad(db, league, season, team, squad, application=application)
                check = {**check, "warnings": found["warnings"], "shortfall": found["shortfall"]}
            row.update(problems=[text for _code, text in check["problems"]], warnings=check["warnings"], shortfall=check.get("shortfall"),
                       can_submit=not active and not blocked and not check["problems"])
        elif user["id"] in _leads(team) and not (squad.get("captain_id") or squad.get("vice_captain_id")) and not hint:
            hint = f"Anmelden dürfen Captain und Vertreter. {squad.get('name')} hat noch keinen: Trag ihn unter Teams beim Co-Team ein."
        rows.append(row)
    return {
        "application": await public_block(db, season),
        # Plattform je Season (#2270): was gilt, bevor die Liga N feststeht - je Liga N, wenn sie abweicht.
        "platform": await league_platform.season_block(db, season),
        "rules": league_rules.version_view(league, season, version) if version else None,
        "privacy": {"text": privacy_text_for(season, user), "url": PRIVACY_URL},
        "season_problems": blocked if state else [],
        "squads": rows,
        "hint": hint,
    }


async def my_applications(db, user: dict) -> list[dict]:
    """Für die Team-Seite: je eigenem Co-Team und Season der jüngste Antrag. Nur Seasons, die die Person sehen darf und die noch laufen."""
    squads, teams = await _own_squads(db, user)
    by_id = {row["id"]: row for row in squads}
    latest = await _latest(db, None, sorted(by_id))
    gone = await _left_staffel(db, list(latest.values()))
    seasons: dict[str, dict] = {}
    items = []
    for (season_id, squad_id), application in sorted(latest.items(), key=lambda pair: str(pair[1].get("created_at") or ""), reverse=True):
        if season_id not in seasons:
            seasons[season_id] = await db.league_seasons.find_one({"id": season_id}, {"_id": 0}) or {}
        season = seasons[season_id]
        if not season or season.get("status") in ("completed", "archived"):
            continue
        visible = await league_service.can_see_season(user, season)
        # Übernommen aus der Vorgänger-Season (F.2): Das eigene Co-Team erfährt es per Nachricht und meldet sich hier ab - auch solange die
        # neue Season noch nicht veröffentlicht ist. Ein Link zur Ligaseite erst, wenn sie sichtbar ist.
        if not visible and not application.get("carry_over"):
            continue
        league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "name": 1, "slug": 1}) or {}
        squad = by_id[squad_id]
        can_act = await may_apply(db, user, squad)
        responsible = can_act or user["id"] in _leads(teams[squad["team_id"]])
        withdrawable = can_act and await _auto_withdrawable(db, application)
        items.append({**own_view(application, responsible=responsible, can_act=can_act, left=application["id"] in gone, withdrawable=withdrawable,
                                 season=season),
                      "squad_id": squad_id, "season_id": season_id, "title": _season_title(league, season),
                      "url": f"/liga/{league.get('slug')}/{season.get('slug')}" if visible else None})
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
    from services import league_guests

    rows = await db.league_applications.find({"season_id": season["id"]}, {"_id": 0}).sort("created_at", 1).to_list(500)
    squad_ids = sorted({row["squad_id"] for row in rows if row.get("squad_id")})
    squads = {row["id"]: row for row in await db.team_squads.find({"id": {"$in": squad_ids}}, {"_id": 0}).to_list(len(squad_ids) + 1)} if squad_ids else {}
    team_ids = sorted({row["team_id"] for row in rows if row.get("team_id")})
    teams = {row["id"]: row for row in await db.teams.find({"id": {"$in": team_ids}}, {"_id": 0}).to_list(len(team_ids) + 1)} if team_ids else {}
    people: set[str] = set()
    for row in rows:
        squad = squads.get(row["squad_id"]) or {}
        people |= {row.get("applied_by"), row.get("decided_by"), row.get("withdrawn_by"), squad.get("captain_id"), squad.get("vice_captain_id")}
        people |= {step.get("by") for step in row.get("history") or []}
    # Anmeldung als Person (#1629, P2): Prüfung je Person, das Konto steht dafür am Antrag.
    persons = {row["user_id"] for row in rows if league_participants.is_person_application(row) and row.get("user_id")}
    accounts = {row["id"]: row for row in await db.users.find({"id": {"$in": sorted(persons)}}, PERSON_FIELDS).to_list(len(persons) + 1)} if persons else {}
    names = await _names(db, people)
    gone = await _left_staffel(db, rows)
    divisions = await db.league_divisions.find({"season_id": season["id"], "status": "active"}, {"_id": 0}).sort("level", 1).to_list(50)
    # Befangenheit (#2245): dieselbe Regel wie beim Entscheiden, mit den Teams samt Co-Teams aus ``teams_by_id``.
    sides = {row["id"]: side_of(row) for row in rows}
    side_teams = await teams_by_id(db, sides.values())
    # Automatisch angenommen beim Team einer Person der Liga-Leitung (#2348): Niemand hat entschieden - die anderen Zuständigen sehen es markiert.
    leads = [{"id": uid} for uid in sorted(await staff_user_ids(db, league["id"], CAPABILITIES))] if any(row.get("auto_accepted") for row in rows) else []
    open_rows = [(row, squads[row["squad_id"]]) for row in rows if row["status"] in OPEN_STATUSES and row["squad_id"] in squads]
    items = []
    for row in rows:
        squad = squads.get(row["squad_id"])
        team = teams.get(row["team_id"])
        check = {"problems": [], "warnings": []}
        waiting = row["status"] in OPEN_STATUSES and not row.get("assignment")
        person = league_participants.is_person_application(row)
        if waiting and person:
            account = accounts.get(row.get("user_id"))
            check = await check_person(db, league, season, account, application=row) if account else {"problems": [(409, PERSON_GONE)], "warnings": []}
        elif waiting:
            check = await check_squad(db, league, season, team, squad, application=row) if squad and team else {"problems": [(409, SQUAD_GONE)], "warnings": []}
        shared = _shared_players(row, squad, open_rows) if waiting and not person else []
        items.append({
            "id": row["id"], "status": row["status"], "squad_id": row["squad_id"], "team_id": row["team_id"], "display_name": row.get("display_name"),
            "squad_name": row.get("squad_name"), "team_name": row.get("team_name"), "submitted_at": row.get("submitted_at"),
            "applied_by_name": (f"Übernommen aus {(row.get('carry_over') or {}).get('from_season_name') or 'der Vorgänger-Season'}"
                                if row.get("carry_over") and not row.get("applied_by") else names.get(row.get("applied_by")) or "Gelöschter User"),
            # Aus der Vorgänger-Season (F.2): woher, welche Liga N jetzt, bis wann Abmelden geht.
            "carry_over": ({**(row.get("carry_over") or {}), **(carry_view(row, season) or {})} if row.get("carry_over") else None),
            # Die Liga N, deren Staffeln der Eingang zuerst anbietet (#1623): bei Übernommenen die neue, sonst - wenn die Season es so
            # einstellt - die unterste aktive. ``None``: keine Vorgabe, alle Staffeln gleich.
            "target_division_id": (target_division_id(row, divisions) if (row.get("carry_over") or {}).get("division_id") or season.get(NEW_LOWEST)
                                   else None),
            "rules_version": (row.get("rule_consent") or {}).get("version"), "rules_at": (row.get("rule_consent") or {}).get("at"),
            "privacy_at": (row.get("privacy_consent") or {}).get("at"),
            "decided_at": row.get("decided_at"), "decided_by_name": names.get(row.get("decided_by")), "decision_reason": row.get("decision_reason"),
            "assignment": {**row["assignment"], "left": row["id"] in gone} if row.get("assignment") else None,
            # Automatisch angenommen (#2348): Zurückstufen nur mit Grund; eine automatische Zuteilung (``assignment.auto``) nehmen Ablehnen und Warteliste mit heraus.
            "auto_accepted": bool(row.get("auto_accepted")),
            "lead_team_auto": bool(row.get("auto_accepted")) and any(belongs_to_side(lead, sides[row["id"]], side_teams.get(row["team_id"])) for lead in leads),
            # Warum die Season nicht annehmen bzw. zuteilen konnte (Review #2348) - bis eine Person entscheidet.
            "auto_problem": row.get("auto_problem"),
            "member_count": 1 if person else len([uid for uid in (squad or {}).get("member_ids") or [] if uid]),
            "captain_name": names.get((squad or {}).get("captain_id")), "vice_name": names.get((squad or {}).get("vice_captain_id")),
            "problems": [text for _code, text in check["problems"]], "warnings": check["warnings"], "shortfall": check.get("shortfall"),
            "shared_with": shared,
            "own_team": belongs_to_side(user, sides[row["id"]], side_teams.get(row["team_id"])),
            # Gastteam (#1665): Kennzeichen und Angabe der Teamleitung - die Leitung bestätigt hier (``PUT …/teams/{id}/guest-team``).
            **({"guest_team": league_guests.details(team), "guest_badge": league_guests.badge(team)}
               if team and league_guests.state_of(team) else {}),
            # Anmeldung als Person (#1629, P2): Art und Konto - Team-Anträge bleiben ohne die Felder.
            **({"kind": league_participants.SOLO, "user_id": row.get("user_id")} if person else {}),
            "history": [{"status": step.get("status"), "at": step.get("at"), "by_name": AUTO_NAME if step.get("auto") else names.get(step.get("by")) or "Gelöschter User",
                         "reason": step.get("reason"), "conflict_reason": step.get("conflict_reason"), "auto": bool(step.get("auto"))}
                        for step in row.get("history") or []],
        })
    # Zuteilen geht nur in reguläre Staffeln (#2404, F.6).
    staffeln = [row for row in await league_service.staffeln_of(db, season["id"]) if not row["league_context"].get("kind")]
    return {
        **({"kind": league_participants.SOLO} if league_participants.is_solo(league) else {}),
        "items": items,
        # Beim eigenen Team (``own_team``) darf nur der Superadmin, als Notausnahme mit Grund.
        "superadmin": is_superadmin(user),
        "stats": await seat_stats(db, season),
        "configured": bool(window_state(season)),
        "window": window_state(season),
        # Neue Co-Teams starten in der untersten Liga N (#1623): Der Eingang bietet sie zuerst an, höher nur mit Grund.
        "new_lowest": bool(season.get(NEW_LOWEST)),
        "divisions": [{"id": division["id"], "label": league_service.division_label(division), "lowest": division["id"] == divisions[-1]["id"],
                       "staffeln": [league_service.staffel_summary(row) for row in staffeln if row["league_context"].get("division_id") == division["id"]]}
                      for division in divisions],
    }


# ---------------------------------------------------------------- Konto löschen und Auskunft

async def scrub_person(db, user_id: str) -> int:
    """Der Antrag gehört dem Co-Team und bleibt. Die Kennung der Person fällt überall heraus.

    Anmeldung als Person (Solo-Liga, #1629, P2): Der Antrag bleibt als Nachweis, ohne Kennung und Namen. Läuft er noch ohne Zuteilung,
    gilt er als zurückgezogen - der Startplatz bzw. der Platz auf der Warteliste wird frei. Eine Anmeldung in einer Staffel bleibt wie
    jede Einzel-Anmeldung als Zählung stehen (``account_erasure._registrations``)."""
    await _withdraw_erased_person(db, user_id)
    query = {"$or": [{"applied_by": user_id}, {"decided_by": user_id}, {"withdrawn_by": user_id}, {"rule_consent.user_id": user_id},
                     {"privacy_consent.user_id": user_id}, {"assignment.assigned_by": user_id}, {"history.by": user_id},
                     # Startrechte (#1627, F.2a): wer zugesagt bzw. das Nachrücken ausgelöst hat.
                     {"carry_over.start_right.accepted_by": user_id}, {"carry_over.fills.by": user_id},
                     {"carry_over.fills.back.start_right.accepted_by": user_id},
                     # „Übernahme neu berechnen“ (F.2, Nr. 162): wer ein Startrecht zurückgenommen hat.
                     {"carry_over.revoked_by": user_id}]}
    done = 0
    async for row in db.league_applications.find(query, {"_id": 0}):
        update = {key: None for key in ("applied_by", "decided_by", "withdrawn_by") if row.get(key) == user_id}
        for key, field in (("rule_consent", "user_id"), ("privacy_consent", "user_id"), ("assignment", "assigned_by")):
            if (row.get(key) or {}).get(field) == user_id:
                update[f"{key}.{field}"] = None
        carry = row.get("carry_over") or {}
        for path in (("start_right", "accepted_by"), ("fills", "by"), ("fills", "back", "start_right", "accepted_by"), ("revoked_by",)):
            value = carry
            for part in path:
                value = value.get(part) if isinstance(value, dict) else None
            if value == user_id:
                update["carry_over." + ".".join(path)] = None
        update["history"] = [{**step, "by": None if step.get("by") == user_id else step.get("by")} for step in row.get("history") or []]
        await db.league_applications.update_one({"id": row["id"]}, {"$set": update})
        done += 1
    return done


async def _withdraw_erased_person(db, user_id: str) -> None:
    """Die eigenen Anträge einer gelöschten Person (#1629, P2): ohne Kennung und Namen; offene ohne Zuteilung gelten als zurückgezogen.
    Ein zugeteilter Antrag bleibt angenommen, sein ``active_key`` wird ``<season>:user:erased:<antrag>`` - eindeutig, ohne Kennung."""
    now = now_utc().isoformat()
    async for row in db.league_applications.find({"user_id": user_id, "squad_id": None}, {"_id": 0}):
        update: dict = {"$set": {"user_id": None, "display_name": GONE_PERSON, "updated_at": now}}
        if row.get("status") in OPEN_STATUSES and not row.get("assignment"):
            update["$set"].update(status=WITHDRAWN, withdrawn_at=now)
            update["$unset"] = {"active_key": ""}
            update["$push"] = {"history": {"status": WITHDRAWN, "by": None, "at": now, "reason": ERASED_REASON}}
        elif row.get("active_key"):
            # Zugeteilt: Der Antrag bleibt angenommen und hält seinen Schlüssel, aber ohne die Kennung der Person.
            update["$set"]["active_key"] = f"{row['season_id']}:user:erased:{row['id']}"
        await db.league_applications.update_one({"id": row["id"]}, update)


EXPORT_FIELDS = ("id", "season_id", "league_id", "team_id", "squad_id", "squad_name", "status", "submitted_at", "decided_at", "decision_reason", "withdrawn_at")


def export_query(user_id: str) -> dict:
    """Alle Anträge, in denen die Person steht: eingereicht, zugestimmt, zurückgezogen oder als Leitung entschieden und zugeteilt - und in der
    Solo-Liga (#1629, P2) die eigene Anmeldung als Spieler."""
    return {"$or": [{"applied_by": user_id}, {"withdrawn_by": user_id}, {"rule_consent.user_id": user_id}, {"privacy_consent.user_id": user_id},
                    {"decided_by": user_id}, {"assignment.assigned_by": user_id}, {"history.by": user_id}, {"user_id": user_id}]}


def export_row(user_id: str):
    """Ohne Kennungen anderer: nur die eigenen Zustimmungen und die eigenen Schritte im Verlauf. Wer nur als Leitung handelte, bekommt wie im Adminprotokoll den Vorgang
    ohne Inhalt: Team und Grund betreffen andere."""
    def shape(row: dict) -> dict:
        steps = [step for step in row.get("history") or [] if step.get("by") == user_id]
        consents = {key: row[key] for key in ("rule_consent", "privacy_consent") if (row.get(key) or {}).get("user_id") == user_id}
        if not consents and user_id not in (row.get("applied_by"), row.get("withdrawn_by")):
            return {"id": row.get("id"), "season_id": row.get("season_id"), "league_id": row.get("league_id"),
                    "my_steps": [{key: step.get(key) for key in ("status", "at")} for step in steps]}
        return {**{key: row.get(key) for key in EXPORT_FIELDS}, "rule_consent": consents.get("rule_consent"), "privacy_consent": consents.get("privacy_consent"),
                "my_steps": [{key: step[key] for key in ("status", "at", "reason") if key in step} for step in steps]}
    return shape
