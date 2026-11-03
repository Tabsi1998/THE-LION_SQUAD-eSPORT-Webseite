"""Check-in und Start in der Liga (docs/LIGA.md, Abschnitt „D.2 Check-in und Start“, #1652; Regelwerk § 8).

- ``checkin_rules`` an Season und Staffel: Fenster um den Termin (Nr. 19), Mindestzahl Anwesender (Nr. 46), Erinnerung. Ohne das
  Feld verhält sich eine Staffel wie vorher - kein Teil hier greift dann.
- **Stand abgeleitet:** ``state`` rechnet aus ``matches_v2.flow``, ``scheduled_at``, ``started_at`` und ``status`` - es gibt keinen
  neuen globalen ``status``. Der Start schreibt wie der Stationsstart ``started_at`` und ``in_progress``.
- **Check-in** je Seite mit Anwesenden (nur Kader, nur spielberechtigt, mindestens ``min_present``), ergänzbar bis Fensterende.
  **Regelwerks-Sperre:** ohne Zustimmung zur geforderten Fassung kein Check-in und kein Start (Obmann 03.11.).
- **Kein automatischer Nichtantritt** (§ 8.4, 8.5): nach Fensterende entsteht nur ein Vorschlag an die Leitung
  (``match_deadlines.no_show_deadline``, Regel ``check_in``); gewertet wird von Hand über den bestehenden Weg.

Geschrieben wird immer mit Bedingung auf den gelesenen Stand; die Routen halten dazu die Schreibsperre des Turniers.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from models import new_id, now_utc
# Die Regeln ohne Datenbank stehen im Blatt-Modul (kein Import-Kreis über league_service, match_deadlines, league_rules) - hier
# bleiben sie unter denselben Namen erreichbar.
from services.checkin_rules import (  # noqa: F401 - weiterhin über match_flow erreichbar
    CLOSED,
    DEFAULTS,
    FINISHED,
    FINISHED_STATUSES,
    NO_TIME,
    NONE,
    NUMBERS,
    OPEN,
    OPEN_MATCH_STATUSES,
    READY,
    RUNNING,
    RUNNING_STATUSES,
    VETO,
    WAITING,
    FlowProblem,
    checkins,
    clock_text,
    defaults_for_season,
    filled as _filled,
    has_report,
    is_finished,
    is_running,
    iso as _iso,
    missing_sides,
    moment as _moment,
    no_show_info,
    normalize,
    rules_of,
    state,
    veto_pending,
    when_text,
    window_of,
)

logger = logging.getLogger("tls.match_flow")

SIDE, LEAD = "side", "lead"
REASON_MIN = 5
REASON_MAX = 500

NO_RULES_DETAIL = "In dieser Staffel gibt es keinen Check-in."
NOT_A_SIDE_DETAIL = "Einchecken können Captain oder Vertreter einer Seite - oder die Liga-Leitung für eine Seite."
CHANGED_DETAIL = "Gerade hat sich am Check-in etwas geändert – bitte die Seite neu laden."
STARTED_DETAIL = "Das Spiel läuft schon oder ist entschieden – ein Check-in geht nicht mehr."
REPORTED_DETAIL = "Für dieses Spiel ist schon ein Ergebnis gemeldet – ein Check-in geht nicht mehr."
NO_TIME_DETAIL = "Das Spiel hat noch keinen Termin – der Check-in öffnet erst mit dem Termin."
RULES_CHANGED_DETAIL = "Das Regelwerk hat sich geändert – bitte erst zustimmen."
LEAD_HINT = "Bitte im Matchchat @leitung schreiben."


# ---------------------------------------------------------------- Seiten: Kader, Eignung, Zustimmung

@dataclass
class Sides:
    registrations: list[dict]
    rosters: dict[str, set[str]] = field(default_factory=dict)
    names: dict[str, str] = field(default_factory=dict)
    rows: dict[str, dict[str, dict]] = field(default_factory=dict)
    consent: dict[str, dict | None] = field(default_factory=dict)

    @property
    def by_id(self) -> dict[str, dict]:
        return {reg["id"]: reg for reg in self.registrations if reg.get("id")}


async def sides(db, match: dict, tournament: dict) -> Sides:
    """Beide Seiten mit Kader, Stand je Spieler (B.3) und Stand der Zustimmung zum Regelwerk (B.2) - in Platzreihenfolge."""
    from services import league_eligibility, league_rules
    from services.match_audience import registrations_for_match, roster_ids, teams_by_id

    found = {reg["id"]: reg for reg in await registrations_for_match(db, match) if reg.get("id")}
    registrations = [found[reg_id] for reg_id in _filled(match) if reg_id in found]
    teams = await teams_by_id(db, registrations)
    rosters = {reg["id"]: roster_ids(reg, teams.get(reg.get("team_id") or "")) for reg in registrations}
    everyone = set().union(*rosters.values()) if rosters else set()
    eligibility = await league_eligibility.context_for_tournament(db, tournament, everyone)
    return Sides(
        registrations=registrations,
        rosters=rosters,
        names={reg["id"]: reg.get("display_name") or reg.get("team_name") or "Team" for reg in registrations},
        rows={reg["id"]: league_eligibility.statuses(eligibility, rosters.get(reg["id"]) or set(), reg.get("squad_id"))
              for reg in registrations},
        consent=await league_rules.sides_consent(db, tournament, registrations),
    )


def consent_block(setup: Sides, registration_id: str) -> dict | None:
    return (setup.consent or {}).get(registration_id)


def rules_changed_detail(consent: dict | None, side_name: str | None = None) -> str:
    who = f"{side_name}: " if side_name else ""
    where = f" Die neue Fassung: {consent['rules_url']}" if (consent or {}).get("rules_url") else ""
    return f"{who}{RULES_CHANGED_DETAIL}{where}"


def _clean_reason(reason: str | None) -> str:
    text = " ".join(str(reason or "").split())
    if len(text) < REASON_MIN:
        raise FlowProblem("Bitte einen Grund angeben (mindestens fünf Zeichen).", 422)
    if len(text) > REASON_MAX:
        raise FlowProblem("Der Grund ist zu lang (höchstens 500 Zeichen).", 422)
    return text


async def _audit(db, action: str, match: dict, actor_id: str | None, data: dict) -> None:
    await db.audit_logs.insert_one({
        "id": new_id(), "action": action, "target_id": match.get("tournament_id"), "actor_id": actor_id,
        "data": {"match_id": match.get("id"), "stage_id": match.get("stage_id"), "match_key": match.get("match_key"), **data},
        "created_at": now_utc().isoformat(),
    })


async def _tell(db, match: dict, setup: Sides, targets: list[str], title: str, text: str, reason: str, dedupe: str,
                *, kind: str = "match_schedule", skip: str | None = None) -> int:
    """Nachricht an die Verantwortlichen der genannten Seiten - eine Nachricht hält die Aktion nie auf."""
    from services.match_audience import responsible_user_ids
    from services.match_notifications import match_title
    from services.user_notifications import create_user_notification

    try:
        regs = [reg for reg in setup.registrations if reg.get("id") in targets]
        recipients = await responsible_user_ids(db, regs) - {skip}
        tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "title": 1}) or {}
        body = f"{tournament.get('title') or 'Liga'} · {match_title(match, setup.by_id)}: {text}"
        sent = 0
        for user_id in sorted(recipients):
            if await create_user_notification(
                user_id, title, body, url=f"/matches/{match.get('id')}", kind=kind,
                meta={"category": "match_reminders", "match_id": match.get("id"), "tournament_id": match.get("tournament_id"),
                      "reason": reason, "dedupe_key": dedupe},
            ):
                sent += 1
        return sent
    except Exception:  # noqa: BLE001 - der Schritt ist schon gespeichert
        logger.warning("[match_flow] Nachricht zu %s nicht verschickt", match.get("id"), exc_info=True)
        return 0


# ---------------------------------------------------------------- Check-in

def side_refusal(match: dict, tournament: dict, rules: dict, now: datetime) -> str | None:
    """Warum eine Seite gerade nicht einchecken kann - ``None``: es geht. Nur die Fensterregel; Eignung und Regelwerk prüft ``check_in``."""
    if is_running(match) or is_finished(match):
        return STARTED_DETAIL
    if has_report(match):
        return REPORTED_DETAIL
    window = window_of(match, rules)
    if not window:
        return NO_TIME_DETAIL
    if now < window[0]:
        return (f"Der Check-in öffnet erst um {when_text(window[0])} ({int(rules['opens_minutes_before'])} Minuten vor dem "
                f"Termin).")
    if now >= window[1]:
        return f"Der Check-in ist seit {when_text(window[1])} geschlossen – das entscheidet die Liga-Leitung. {LEAD_HINT}"
    return None


def _present_list(setup: Sides, registration_id: str, rules: dict, raw) -> list[str]:
    from services import league_eligibility

    try:
        return league_eligibility.check_participants(
            setup.rows.get(registration_id) or {}, raw, minimum=int(rules["min_present"]),
            roster=setup.rosters.get(registration_id) or set(), side=setup.names.get(registration_id, "Team"),
            action="anwesend sind")
    except league_eligibility.EligibilityError as problem:
        raise FlowProblem(problem.detail, problem.status_code) from None


async def check_in(db, match: dict, tournament: dict | None, setup: Sides, *, registration_id: str, present, user: dict,
                   via: str = SIDE, reason: str | None = None, now: datetime | None = None) -> dict:
    """Eine Seite checkt ein (``via`` ``side``) oder die Leitung trägt sie ein (``lead``, mit Grund, auch nach Fensterende)."""
    rules = rules_of(tournament)
    if not rules:
        raise FlowProblem(NO_RULES_DETAIL)
    filled = _filled(match)
    if len(filled) < 2:
        raise FlowProblem("Das Spiel hat noch keine zwei Seiten.")
    if registration_id not in filled:
        raise FlowProblem("Diese Seite spielt in diesem Spiel nicht.", 404)
    now = now or now_utc()
    if via == SIDE:
        refusal = side_refusal(match, tournament, rules, now)
        if refusal:
            raise FlowProblem(refusal)
        reason_text = None
    else:
        if is_running(match) or is_finished(match):
            raise FlowProblem(STARTED_DETAIL)
        if has_report(match):
            raise FlowProblem(REPORTED_DETAIL)
        if not window_of(match, rules):
            raise FlowProblem(NO_TIME_DETAIL)
        reason_text = _clean_reason(reason)
    consent = consent_block(setup, registration_id)
    if consent and consent.get("open"):
        raise FlowProblem(rules_changed_detail(consent))
    ids = _present_list(setup, registration_id, rules, present)
    previous = checkins(match).get(registration_id)
    if previous and sorted(previous.get("present") or []) == sorted(ids) and previous.get("via") == via \
            and (via == SIDE or previous.get("reason") == reason_text):
        return {"side": previous, "ready": not missing_sides(match), "idempotent_replay": True}
    now_iso = now.isoformat()
    for_at = _iso(match.get("scheduled_at"))
    entry = {
        "at": (previous or {}).get("at") or now_iso, "updated_at": now_iso, "user_id": user.get("id"), "present": ids, "via": via,
        "by": user.get("id") if via == LEAD else None, "reason": reason_text,
        "rule_version_id": (consent or {}).get("version_id"), "for_at": for_at,
    }
    # Ein Eintrag zu einem früheren Termin zählt nicht mehr (``checkins``) - überschrieben wird er mit Bedingung auf seinen Stand.
    stored = ((match.get("flow") or {}).get("checkin") or {}).get(registration_id) or {}
    written = await db.matches_v2.update_one(
        {"id": match["id"], "started_at": None, "status": {"$in": sorted(OPEN_MATCH_STATUSES)}, "reports.0": {"$exists": False},
         "scheduled_at": match.get("scheduled_at"),
         f"flow.checkin.{registration_id}.updated_at": (stored if isinstance(stored, dict) else {}).get("updated_at")},
        {"$set": {f"flow.checkin.{registration_id}": entry, "updated_at": now_iso},
         "$addToSet": {"flow.user_ids": {"$each": sorted({user.get("id"), *ids} - {None})}}})
    if not written.matched_count:
        raise FlowProblem(CHANGED_DETAIL)
    fresh = await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0, "flow": 1, "slots": 1, "scheduled_at": 1}) or {}
    ready = not missing_sides({**match, **fresh})
    became_ready = False
    if ready:
        # „Beide da“ genau einmal je Termin: Bedingung auf den Termin, für den es zuletzt galt.
        marked = await db.matches_v2.update_one({"id": match["id"], "flow.ready_for": {"$ne": for_at}},
                                                {"$set": {"flow.ready_at": now_iso, "flow.ready_for": for_at}})
        became_ready = bool(getattr(marked, "modified_count", 0))
    await _audit(db, "match.checkin.lead" if via == LEAD else "match.checkin", match, user.get("id"),
                 {"registration_id": registration_id, "count": len(ids), "via": via, "rule_version_id": entry["rule_version_id"],
                  **({"reason": reason_text} if reason_text else {}), **({"amended": True} if previous else {})})
    name = setup.names.get(registration_id, "Die Gegenseite")
    others = [reg_id for reg_id in filled if reg_id != registration_id]
    await _tell(db, match, setup, others, "Gegenseite eingecheckt",
                f"{name} ist eingecheckt ({len(ids)} Spieler){' – eingetragen von der Liga-Leitung' if via == LEAD else ''}.",
                "checkin_side", f"checkin-side:{match['id']}:{registration_id}:{now_iso}", skip=user.get("id"))
    if became_ready:
        await _tell(db, match, setup, filled, "Beide Seiten eingecheckt",
                    "Beide Seiten sind eingecheckt – ihr könnt starten. Map 1 beginnt, sobald eine Seite auf „Spiel starten“ tippt.",
                    "checkin_ready", f"checkin-ready:{match['id']}:{now_iso}")
    return {"side": entry, "ready": ready, "idempotent_replay": False}


# ---------------------------------------------------------------- Start

def start_refusal(current: str) -> str:
    if current in (RUNNING, FINISHED):
        return "Das Spiel läuft schon oder ist entschieden."
    if current == VETO:
        return "Erst das Veto abschließen, dann starten."
    if current == NO_TIME:
        return NO_TIME_DETAIL
    return "Starten geht erst, wenn beide Seiten eingecheckt sind."


async def start(db, match: dict, tournament: dict | None, setup: Sides, *, user: dict, registration_id: str | None,
                via: str = SIDE, now: datetime | None = None) -> dict:
    """Map 1 beginnt: ``started_at`` und ``in_progress`` am Spiel - einmal, der zweite Klick ist folgenlos."""
    if not rules_of(tournament):
        raise FlowProblem(NO_RULES_DETAIL)
    if is_running(match):
        return {"started_at": match.get("started_at"), "idempotent_replay": True}
    now = now or now_utc()
    current = state(match, tournament, now)
    if current != READY:
        raise FlowProblem(start_refusal(current))
    for reg in setup.registrations:
        consent = consent_block(setup, reg["id"])
        if consent and consent.get("open"):
            raise FlowProblem(rules_changed_detail(consent, setup.names.get(reg["id"])))
    now_iso = now.isoformat()
    entry = {"at": now_iso, "by": user.get("id"), "registration_id": registration_id, "via": via}
    written = await db.matches_v2.update_one(
        {"id": match["id"], "started_at": None, "status": {"$in": sorted(OPEN_MATCH_STATUSES)}},
        {"$set": {"started_at": now_iso, "status": "in_progress", "flow.start": entry, "updated_at": now_iso},
         "$addToSet": {"flow.user_ids": user.get("id")}})
    if not written.matched_count:
        fresh = await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0, "started_at": 1}) or {}
        if fresh.get("started_at"):
            return {"started_at": fresh["started_at"], "idempotent_replay": True}
        raise FlowProblem(CHANGED_DETAIL)
    await _audit(db, "match.checkin.start", match, user.get("id"), {"registration_id": registration_id, "via": via})
    await _tell(db, match, setup, _filled(match), "Match startet jetzt",
                "Beide Seiten sind bereit – Map 1 läuft. Viel Erfolg!", "checkin_started", f"checkin-start:{match['id']}:{now_iso}")
    return {"started_at": now_iso, "idempotent_replay": False}


# ---------------------------------------------------------------- Meldung der Captains (Codex zu D.2)

REPORT = "report"
REPORT_NEEDS_CHECKIN = "Melden geht erst, wenn beide Seiten für diesen Termin eingecheckt sind"


def report_refusal(match: dict, tournament: dict | None, *, own_id: str | None, names: dict[str, str],
                   consent: dict[str, dict | None] | None = None) -> str | None:
    """Warum die Captains gerade nicht melden können - ``None``: es geht. Nur Staffeln mit Check-in. Ein begonnenes Spiel (Start
    gesetzt oder Stand „läuft“) und eins mit Meldung (die Bestätigung der Gegenseite) bleiben frei; die Leitung (``/result``) immer.
    Zwischen Check-in und Meldung gilt die Regelwerks-Sperre wie beim Start."""
    rules = rules_of(tournament)
    if not rules or is_running(match) or is_finished(match) or has_report(match):
        return None
    missing = missing_sides(match)
    if missing:
        if not window_of(match, rules):
            return f"{REPORT_NEEDS_CHECKIN} – das Spiel hat noch keinen Termin, der Check-in öffnet erst mit dem Termin."
        others = ", ".join(names.get(reg_id) or "die Gegenseite" for reg_id in missing if reg_id != own_id)
        if own_id in missing:
            who = f"eure Seite und {others} haben" if others else "eure Seite hat"
            return f"{REPORT_NEEDS_CHECKIN} – {who} noch nicht eingecheckt. Bitte zuerst auf der Matchseite einchecken."
        return f"{REPORT_NEEDS_CHECKIN} – {others} hat noch nicht eingecheckt."
    for reg_id in _filled(match):
        block = (consent or {}).get(reg_id)
        if block and block.get("open"):
            return rules_changed_detail(block, None if reg_id == own_id else names.get(reg_id))
    return None


async def start_by_report(db, match: dict, tournament: dict | None, *, user: dict, registration_id: str,
                          now: datetime | None = None) -> bool:
    """Beide sind eingecheckt, aber niemand hat „Spiel starten“ getippt: Die erste gültige Meldung setzt den Start nach - einmal,
    ``via: "report"``, ohne Nachricht (gespielt ist schon). Ohne Regeln, mit Start oder mit fehlender Seite passiert nichts."""
    if not rules_of(tournament) or is_running(match) or missing_sides(match):
        return False
    now_iso = (now or now_utc()).isoformat()
    entry = {"at": now_iso, "by": user.get("id"), "registration_id": registration_id, "via": REPORT}
    written = await db.matches_v2.update_one(
        {"id": match["id"], "started_at": None, "status": {"$in": sorted(OPEN_MATCH_STATUSES)}},
        {"$set": {"started_at": now_iso, "status": "in_progress", "flow.start": entry, "updated_at": now_iso},
         "$addToSet": {"flow.user_ids": user.get("id")}})
    if not written.matched_count:
        return False
    await _audit(db, "match.checkin.start", match, user.get("id"), {"registration_id": registration_id, "via": REPORT})
    return True


# ---------------------------------------------------------------- Matchseite

async def _names(db, user_ids) -> dict[str, dict]:
    wanted = sorted({value for value in user_ids if value})
    if not wanted:
        return {}
    rows = await db.users.find({"id": {"$in": wanted}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(len(wanted) + 1)
    return {row["id"]: {"id": row["id"], "name": row.get("display_name") or row.get("username") or "Spieler"} for row in rows}


def _pick(user_id: str, people: dict[str, dict], rows: dict[str, dict], *, with_reason: bool) -> dict:
    row = rows.get(user_id) or {}
    blocked = None if row.get("ok", True) else (row.get("reason") if with_reason else "nicht spielberechtigt")
    return {**(people.get(user_id) or {"id": user_id, "name": row.get("name") or "Spieler"}), "blocked": blocked}


async def page_block(db, match: dict, tournament: dict | None, *, acting_reg: dict | None, involved: bool, lead: bool,
                     can_lead_enter: bool, conflict: dict | None, now: datetime | None = None) -> dict | None:
    """Der Block ``checkin`` der Matchseite - nur Staffeln mit Regeln, nur Beteiligte und Leitung."""
    rules = rules_of(tournament)
    if not rules or not (involved or lead):
        return None
    now = now or now_utc()
    setup = await sides(db, match, tournament)
    current = state(match, tournament, now)
    done = checkins(match)
    own_id = (acting_reg or {}).get("id")
    wanted = set()
    for entry in done.values():
        wanted.update(entry.get("present") or [])
    if own_id:
        wanted.update(setup.rosters.get(own_id) or set())
    if lead:
        for members in setup.rosters.values():
            wanted.update(members)
    people = await _names(db, wanted)
    window = window_of(match, rules)
    refusal = side_refusal(match, tournament, rules, now) if own_id else None
    own_consent = consent_block(setup, own_id) if own_id else None
    hint = refusal
    if own_id and not refusal and own_consent and own_consent.get("open"):
        hint = rules_changed_detail(own_consent)
    can_checkin = bool(own_id) and hint is None
    start_hint = None
    if current != READY:
        start_hint = start_refusal(current) if current not in (OPEN, WAITING, CLOSED, NO_TIME) else "Starten geht erst, wenn beide Seiten eingecheckt sind."
    else:
        for reg in setup.registrations:
            consent = consent_block(setup, reg["id"])
            if consent and consent.get("open"):
                start_hint = rules_changed_detail(consent, setup.names.get(reg["id"]))
                break
    can_start = bool(own_id or (lead and can_lead_enter)) and current == READY and start_hint is None
    proposal = match.get("no_show_proposal") if isinstance(match.get("no_show_proposal"), dict) else None
    if proposal and (proposal.get("decision") or proposal.get("rule") != "check_in"):
        proposal = None
    if proposal:
        # Nur, solange das Fenster wirklich zu ist (nach einem neuen Termin räumt der Fristen-Job den alten Vorschlag ab).
        due = no_show_info(match, tournament)
        if not due or due["due_at"] > now:
            proposal = None
    missing_ids = missing_sides(match)

    def side_view(reg: dict) -> dict:
        entry = done.get(reg["id"]) or {}
        consent = consent_block(setup, reg["id"]) or {}
        return {
            "registration_id": reg["id"], "name": setup.names.get(reg["id"]), "own": reg["id"] == own_id,
            "checked_in": bool(entry), "at": entry.get("at"), "updated_at": entry.get("updated_at"), "via": entry.get("via"),
            "present": [people.get(user_id) or {"id": user_id, "name": "Spieler"} for user_id in entry.get("present") or []],
            "present_count": len(entry.get("present") or []),
            "consent_open": bool(consent.get("open")), "rules_url": consent.get("rules_url"),
            "lead_reason": entry.get("reason") if lead or reg["id"] == own_id else None,
        }

    return {
        "rules": rules,
        "state": current,
        "scheduled_at": match.get("scheduled_at"),
        "window": {"opens_at": window[0].isoformat(), "closes_at": window[1].isoformat()} if window else None,
        "ready_at": ((match.get("flow") or {}).get("ready_at")),
        "started_at": match.get("started_at"),
        "sides": [side_view(reg) for reg in setup.registrations],
        "own_registration_id": own_id,
        "can_checkin": can_checkin,
        "checkin_hint": hint if own_id else None,
        "roster": sorted((_pick(user_id, people, setup.rows.get(own_id) or {}, with_reason=True) for user_id in setup.rosters.get(own_id) or set()),
                         key=lambda row: row["name"].casefold()) if own_id else [],
        "min_present": int(rules["min_present"]),
        "can_start": can_start,
        "start_hint": start_hint,
        "proposal": {"due_at": proposal.get("due_at"),
                     "missing": [setup.names.get(reg_id, "Seite") for reg_id in proposal.get("missing_registration_ids") or missing_ids]}
        if proposal else None,
        "lead": {
            "can_enter": bool(lead and can_lead_enter and current not in (RUNNING, FINISHED) and not has_report(match)),
            "conflict": conflict,
            "rosters": {reg["id"]: sorted((_pick(user_id, people, setup.rows.get(reg["id"]) or {}, with_reason=True)
                                           for user_id in setup.rosters.get(reg["id"]) or set()), key=lambda row: row["name"].casefold())
                        for reg in setup.registrations},
        } if lead else None,
    }


# ---------------------------------------------------------------- Aufgaben und Mein Dienst

def _open_query(sides_query: dict, now: datetime, reach_minutes: int = NUMBERS["opens_minutes_before"][1]) -> dict:
    reach = timedelta(minutes=reach_minutes)
    return {**sides_query, "status": {"$in": sorted(OPEN_MATCH_STATUSES)}, "started_at": None, "is_preview": {"$ne": True},
            "scheduled_at": {"$gte": (now - reach).isoformat(), "$lte": (now + reach).isoformat()}}


async def open_checkin_tasks(db, acting: set[str], sides_query: dict, *, now: datetime | None = None) -> list[tuple[dict, str]]:
    """Spiele, in denen eine eigene Seite jetzt einchecken kann und es noch nicht getan hat - für die Aufgabe „Jetzt einchecken“.
    Liefert (Spiel, Ende des Fensters)."""
    now = now or now_utc()
    matches = await db.matches_v2.find(_open_query(sides_query, now), {"_id": 0}).to_list(100)
    if not matches:
        return []
    tournament_ids = sorted({match.get("tournament_id") for match in matches if match.get("tournament_id")})
    tournaments = {row["id"]: row for row in await db.tournaments.find(
        {"id": {"$in": tournament_ids}, "checkin_rules": {"$type": "object"}},
        {"_id": 0, "id": 1, "league_context": 1, "checkin_rules": 1, "status": 1}).to_list(len(tournament_ids) + 5)}
    out = []
    for match in matches:
        tournament = tournaments.get(match.get("tournament_id") or "")
        if not tournament or tournament.get("status") != "live" or state(match, tournament, now) != OPEN:
            continue
        if acting & set(missing_sides(match)):
            out.append((match, window_of(match, rules_of(tournament))[1].isoformat()))
    return out


def proposal_query(tournament_ids: list[str]) -> dict:
    """Offene Vorschläge aus dem Check-in: niemand hat entschieden, nichts begonnen, nichts gemeldet."""
    return {"tournament_id": {"$in": tournament_ids}, "no_show_proposal.rule": "check_in", "no_show_proposal.decision": None,
            "status": {"$in": sorted(OPEN_MATCH_STATUSES)}, "started_at": None, "reports.0": {"$exists": False},
            "is_preview": {"$ne": True}}


async def proposal_rows(db, user: dict, limit: int = 50) -> list[dict]:
    """Mein Dienst: die offenen Vorschläge „nicht erschienen“ aus dem Check-in für die Liga-Leitung mit ``matches`` oder ``results``."""
    from services.league_permissions import can, staffel_access

    query = (await staffel_access(db, user)).query()
    if query is None:
        return []
    staffeln = await db.tournaments.find({**query, "status": "live", "checkin_rules": {"$type": "object"}},
                                         {"_id": 0, "id": 1, "title": 1, "slug": 1, "league_context": 1}).to_list(500)
    allowed = {}
    for row in staffeln:
        if await can(user, ("matches", "results"), row["league_context"].get("league_id"), db=db):
            allowed[row["id"]] = row
    if not allowed:
        return []
    matches = await db.matches_v2.find(proposal_query(sorted(allowed)), {
        "_id": 0, "id": 1, "tournament_id": 1, "scheduled_at": 1, "no_show_proposal": 1, "round_name": 1, "matchday_label": 1,
        "matchday_number": 1, "round": 1, "slots": 1}).sort("scheduled_at", 1).to_list(limit)
    reg_ids = sorted({slot.get("registration_id") for match in matches for slot in match.get("slots") or [] if slot.get("registration_id")})
    names = {row["id"]: row.get("display_name") or row.get("team_name") or "Seite" for row in await db.tournament_registrations.find(
        {"id": {"$in": reg_ids}}, {"_id": 0, "id": 1, "display_name": 1, "team_name": 1}).to_list(len(reg_ids) + 5)} if reg_ids else {}
    rows = []
    for match in matches:
        proposal = match.get("no_show_proposal") or {}
        staffel = allowed[match["tournament_id"]]
        key = staffel.get("slug") or staffel["id"]
        rows.append({
            "match_id": match["id"], "tournament_id": match["tournament_id"], "title": staffel.get("title"),
            "label": match.get("matchday_label") or match.get("round_name") or (
                f"Spieltag {match.get('matchday_number') or match.get('round')}" if match.get("matchday_number") or match.get("round") else "Spiel"),
            "scheduled_at": match.get("scheduled_at"), "due_at": proposal.get("due_at"),
            "missing": [names.get(reg_id, "Seite") for reg_id in proposal.get("missing_registration_ids") or missing_sides(match)],
            "url": f"/matches/{match['id']}", "lead_url": f"/tournaments/{key}/leitung?fall=ns-{match['id']}",
        })
    return rows


# ---------------------------------------------------------------- Datenschutz (Auskunft, Kontolöschung)

def privacy_query(user_id: str) -> dict:
    """Spiele, in deren Check-in die Person vorkommt (eingecheckt, eingetragen, anwesend, gestartet)."""
    return {"flow.user_ids": user_id}


async def export_snapshot(db, user_id: str) -> list[dict]:
    """Für die Auskunft (``league_checkin``): je Spiel die eigenen Schritte - als Leitung nur der Vorgang."""
    out = []
    for match in await db.matches_v2.find(privacy_query(user_id), {"_id": 0, "id": 1, "tournament_id": 1, "flow": 1}).to_list(None):
        steps = []
        # Alle Einträge, auch zu früheren Terminen und ausgeschiedenen Seiten - die Auskunft nennt jeden Schritt der Person.
        raw = ((match.get("flow") or {}).get("checkin") or {}).items()
        for registration_id, entry in ((key, value) for key, value in raw if isinstance(value, dict)):
            if entry.get("via") == SIDE and entry.get("user_id") == user_id:
                steps.append({"role": "checked_in", "side": registration_id, "at": entry.get("at"), "updated_at": entry.get("updated_at"),
                              "present_count": len(entry.get("present") or [])})
            elif entry.get("by") == user_id or (entry.get("via") == LEAD and entry.get("user_id") == user_id):
                steps.append({"role": "lead", "at": entry.get("at")})
            if user_id in (entry.get("present") or []):
                steps.append({"role": "present", "side": registration_id, "at": entry.get("at")})
        start_entry = (match.get("flow") or {}).get("start") or {}
        if start_entry.get("by") == user_id:
            steps.append({"role": "started", "at": start_entry.get("at"), "via": start_entry.get("via")})
        if steps:
            out.append({"match_id": match.get("id"), "tournament_id": match.get("tournament_id"), "steps": steps})
    return out


async def scrub_person(db, user_id: str) -> int:
    """Kontolöschung: Check-ins und Start bleiben (sportlicher Ablauf), die Kennung der Person als Handelnde fällt heraus; die
    Anwesenheitslisten bleiben wie Aufstellungen."""
    done = 0
    for match in await db.matches_v2.find(privacy_query(user_id), {"_id": 0, "id": 1, "flow": 1}).to_list(None):
        flow = dict(match.get("flow") or {})
        changed = False
        checkin = {}
        for registration_id, entry in (flow.get("checkin") or {}).items():
            if not isinstance(entry, dict):
                continue
            entry = dict(entry)
            for key in ("user_id", "by"):
                if entry.get(key) == user_id:
                    entry[key] = None
                    changed = True
            checkin[registration_id] = entry
        if (flow.get("start") or {}).get("by") == user_id:
            flow["start"] = {**flow["start"], "by": None}
            changed = True
        if changed:
            flow["checkin"] = checkin
            await db.matches_v2.update_one({"id": match["id"]}, {"$set": {"flow": flow}})
            done += 1
    return done


__all__ = ["DEFAULTS", "FlowProblem", "check_in", "defaults_for_season", "export_snapshot", "missing_sides", "no_show_info",
           "normalize", "open_checkin_tasks", "page_block", "proposal_rows", "rules_of", "scrub_person", "sides", "start",
           "state", "veto_pending", "window_of", "_iso"]
