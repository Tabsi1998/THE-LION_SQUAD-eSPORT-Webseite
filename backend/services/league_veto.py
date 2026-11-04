"""Veto am Spiel (docs/LIGA.md, Abschnitt „D.3 Veto“, #1618; Regelwerk § 6 und Anlage B).

Der Zustandsautomat steht auf dem Server, in ``matches_v2.flow.veto`` (intern wie ``flow.checkin``):

- **Start** genau einmal je Termin, sobald beide Seiten eingecheckt sind (``ensure_started`` - im Check-in, beim Lesen der Matchseite,
  beim ersten Zug, beim Start und im Job; Bedingung „kein Veto für diesen Termin“). Team A nach der Vorlage (Heim oder einmal gelost).
- **Zug** mit Versionsnummer (optimistische Sperre) und Bedingung auf ``version`` und ``status`` - doppelt, gleichzeitig, zwei Geräte:
  einer schreibt, der andere bekommt „bitte neu laden“ oder die Wiederholung. Der Decider folgt sofort als automatischer Schritt.
- **Zeit:** nach Ablauf wählt das System zufällig und gleichverteilt aus den Maps, die die Serie vervollständigbar lassen
  (``settle_due``, idempotent; Job ``league_veto_sweep``).
- **Leitung:** Pause, Fortsetzen, Schritt zurück, Neustart - mit Grund und Protokoll, Befangenheit prüft die Route.
- **Abschluss:** ``planned_games[]`` am Spiel (Schlüssel wie ``games[]``), ``map_pool_id`` festgehalten, Stand ``ready``.

Die Regeln ohne Datenbank stehen in ``services/league_veto_rules.py``.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta

from models import new_id, now_utc
from services import league_veto_rules as rules_mod, map_pools
from services.checkin_rules import (
    OPEN_MATCH_STATUSES,
    FlowProblem,
    filled,
    has_report,
    is_finished,
    is_running,
    iso,
    missing_sides,
    moment,
    schedule_rev,
)
from services.league_veto_rules import DECIDER, DONE, DRAW, HOME, PAUSED, ROLE_OF, RUNNING, SKIPPED, VetoProblem, veto_of

logger = logging.getLogger("tls.league_veto")

SIDE, AUTO = "side", "auto"
REASON_MIN, REASON_MAX = 5, 500
LEAD_ACTIONS = ("pause", "resume", "undo", "restart")

NO_VETO_DETAIL = "In dieser Staffel gibt es kein Veto."
NOT_STARTED_DETAIL = "Das Veto beginnt erst, wenn beide Seiten eingecheckt sind."
NOT_A_SIDE_DETAIL = "Ziehen können Captain oder Vertreter der Seite, die am Zug ist."
CHANGED_DETAIL = "Gerade hat sich am Veto etwas geändert – bitte die Seite neu laden."
DONE_DETAIL = "Das Veto ist abgeschlossen."
STARTED_DETAIL = "Das Spiel läuft schon – am Veto ändert sich nichts mehr."
REPORT_VETO_DETAIL = "Erst das Veto abschließen – dann melden."


# ---------------------------------------------------------------- Hilfen

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


async def _tell(db, match: dict, targets: list[str], title: str, text: str, reason: str, dedupe: str, *, kind: str = "match_call") -> int:
    """Nachricht an die Verantwortlichen der genannten Seiten - eine Nachricht hält die Aktion nie auf."""
    from services.match_audience import registrations_for_match, responsible_user_ids
    from services.match_notifications import match_title
    from services.user_notifications import create_user_notification

    try:
        registrations = await registrations_for_match(db, match)
        regs_by_id = {reg["id"]: reg for reg in registrations if reg.get("id")}
        tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "title": 1}) or {}
        body = f"{tournament.get('title') or 'Liga'} · {match_title(match, regs_by_id)}: {text}"
        sent = 0
        for user_id in sorted(await responsible_user_ids(db, [reg for reg in registrations if reg.get("id") in targets])):
            if await create_user_notification(
                user_id, title, body, url=f"/matches/{match.get('id')}", kind=kind,
                meta={"category": "match_reminders", "match_id": match.get("id"), "tournament_id": match.get("tournament_id"),
                      "reason": reason, "dedupe_key": dedupe}):
                sent += 1
        return sent
    except Exception:  # noqa: BLE001 - der Schritt ist schon gespeichert
        logger.warning("[league_veto] Nachricht zu %s nicht verschickt", match.get("id"), exc_info=True)
        return 0


async def _reload(db, match: dict) -> dict:
    fresh = await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0})
    return fresh or match


def _names_of(setup) -> dict[str, str]:
    return dict(getattr(setup, "names", None) or {})


async def _side_names(db, match: dict) -> dict[str, str]:
    from services.match_audience import registrations_for_match

    return {reg["id"]: reg.get("display_name") or reg.get("team_name") or "Team"
            for reg in await registrations_for_match(db, match) if reg.get("id")}


def _registration_for(veto: dict, step: dict) -> str | None:
    if step.get("kind") == DECIDER:
        return None
    return veto.get("team_a") if step.get("team") == "A" else veto.get("team_b")


def _snapshot(pool: dict | None, mode: str, map_id: str) -> dict:
    for item in rules_mod.pool_maps(pool).get(mode) or []:
        if item.get("map_id") == map_id:
            return item
    return {}


def _mode_head(pool: dict | None, mode: str) -> dict:
    for group in (pool or {}).get("modes") or []:
        if group.get("mode") == mode:
            return {"mode_label": group.get("label") or mode, **({"mode_icon_url": group["icon_url"]} if group.get("icon_url") else {})}
    return {"mode_label": mode}


def planned_games_of(veto: dict, pool: dict | None) -> list[dict]:
    """Die Spielreihenfolge aus den Wahlen und dem Decider - Schlüssel wie ``games[]``, nach Position; ``role`` wie #1931."""
    rows = []
    for step in veto.get("steps") or []:
        if step.get("kind") == rules_mod.BAN or not step.get("position"):
            continue
        rows.append({
            "position": int(step["position"]), "mode": step.get("mode"), **_mode_head(pool, step.get("mode")),
            "map_id": step.get("map_id"), "map_name": step.get("map_name"), "map_image_url": step.get("map_image_url"),
            "role": step.get("role") or ROLE_OF.get(step.get("kind"), "picked"), "by_registration_id": step.get("registration_id"),
        })
    return sorted(rows, key=lambda row: row["position"])


# ---------------------------------------------------------------- Start

async def _match_setup(db, match: dict, tournament: dict):
    """Pool, Best of, Modusfolge und Wiederholungsregel dieses Spiels - wie beim Melden (``league_games``)."""
    from services import league_games
    from services.match_v2_results import result_best_of

    stage = await db.tournament_stages.find_one({"id": match["stage_id"]}, {"_id": 0}) if match.get("stage_id") else None
    pool = await map_pools.effective_pool(db, tournament, stage=stage, match=match)
    return pool, await result_best_of(db, match), league_games.effective_mode_order(tournament, pool), league_games.map_repeat_of(tournament)


def _can_run(match: dict) -> bool:
    return (len(filled(match)) == 2 and not missing_sides(match) and not is_running(match) and not is_finished(match)
            and not has_report(match) and str(match.get("status") or "") in OPEN_MATCH_STATUSES and not match.get("is_preview"))


async def ensure_started(db, match: dict, tournament: dict | None, *, now: datetime | None = None) -> dict:
    """Das Veto beginnen, sobald beide Seiten eingecheckt sind - genau einmal je Termin (Bedingung: kein Veto für diesen Termin).
    Gibt das Spiel zurück, bei einem Start den frischen Stand. Ohne Vorlage, mit Veto oder ohne „beide da“ passiert nichts."""
    rules = rules_mod.rules_of(tournament)
    # Gesperrte Staffel (Codex zu D.3): nur lesen - kein Start aus einem Seitenaufruf, der Scheduler lässt sie ohnehin aus.
    if not rules or tournament.get("locked_at") or veto_of(match) is not None or not _can_run(match):
        return match
    now = now or now_utc()
    now_iso = now.isoformat()
    for_at = iso(match.get("scheduled_at"))
    # Termin-Revision (Codex zu D.3): das Veto gehört zu Termin und Revision - A → B → A zählt nicht als derselbe Termin.
    rev = schedule_rev(match)
    home, away = filled(match)[:2]
    pool, best_of, order, repeat = await _match_setup(db, match, tournament)
    problem = rules_mod.fits_problem(rules, pool=pool, best_of=best_of, order=order, repeat=repeat)
    doc = {
        "version": 1, "for_at": for_at, "rev": rev, "started_at": now_iso, "finished_at": None,
        "template": {"team_a": rules["team_a"], "step_seconds": int(rules["step_seconds"]), "steps": [dict(step) for step in rules["steps"]]},
        "map_pool_id": (pool or {}).get("id"), "best_of": best_of, "map_repeat": repeat,
        "team_a": None, "team_b": None, "team_a_via": rules["team_a"], "draw": None,
        "step": 0, "deadline_at": None, "steps": [], "paused": None, "lead_log": [],
    }
    if problem:
        doc.update({"status": SKIPPED, "skipped_reason": problem})
    else:
        team_a = home if rules["team_a"] == HOME else secrets.choice([home, away])
        doc.update({"status": RUNNING, "team_a": team_a, "team_b": away if team_a == home else home,
                    "draw": {"at": now_iso} if rules["team_a"] == DRAW else None,
                    "deadline_at": (now + timedelta(seconds=int(rules["step_seconds"]))).isoformat()})
    written = await db.matches_v2.update_one(
        {"id": match["id"], "started_at": None, "status": {"$in": sorted(OPEN_MATCH_STATUSES)}, "scheduled_at": match.get("scheduled_at"),
         "flow.schedule_rev": rev if rev else {"$in": [None, 0]},
         "$or": [{"flow.veto": {"$exists": False}}, {"flow.veto.for_at": {"$ne": for_at}}, {"flow.veto.rev": {"$ne": rev}}]},
        {"$set": {"flow.veto": doc, "updated_at": now_iso}, "$unset": {"planned_games": ""}})
    fresh = await _reload(db, match)
    if not written.matched_count:
        return fresh
    await _audit(db, "match.veto.start", match, None, {
        "status": doc["status"], "team_a": doc["team_a"], "team_a_via": doc["team_a_via"], "map_pool_id": doc["map_pool_id"],
        **({"skipped_reason": problem} if problem else {})})
    if problem:
        return fresh
    names = await _side_names(db, match)
    await _tell(db, match, [doc["team_a"]], "Veto läuft – ihr seid am Zug",
                f"Das Map-Veto hat begonnen, ihr beginnt. Je Schritt {doc['template']['step_seconds']} Sekunden – danach wählt das System.",
                "veto_start", f"veto-start:{match['id']}:{now_iso}")
    await _tell(db, match, [doc["team_b"]], "Veto läuft",
                f"Das Map-Veto hat begonnen – {names.get(doc['team_a'], 'die Gegenseite')} beginnt. Je Schritt "
                f"{doc['template']['step_seconds']} Sekunden.", "veto_start", f"veto-start:{match['id']}:{now_iso}")
    return await settle_due(db, fresh, tournament, now=now)


# ---------------------------------------------------------------- Schritte schreiben

class _Run:
    """Der Stand eines laufenden Vetos mit Pool - für Züge, Fristen und die Matchseite einmal gerechnet."""

    def __init__(self, match: dict, veto: dict, pool: dict | None):
        self.match, self.veto, self.pool = match, veto, pool
        self.template = veto.get("template") or {}
        self.steps = self.template.get("steps") or []
        self.repeat = veto.get("map_repeat") or "other_mode"
        self.remaining = rules_mod.remaining_after(veto.get("steps") or [], pool, self.repeat)

    @property
    def index(self) -> int:
        return int(self.veto.get("step") or 0)

    @property
    def current(self) -> dict | None:
        return self.steps[self.index] if self.index < len(self.steps) else None

    @property
    def open_steps(self) -> list[dict]:
        return self.steps[self.index:]

    def options(self) -> list[str]:
        return rules_mod.allowed_options(self.remaining, self.open_steps, self.repeat)


async def _run_of(db, match: dict, veto: dict) -> _Run:
    pool = await map_pools.version_by_id(db, veto.get("map_pool_id"))
    return _Run(match, veto, pool)


async def _apply(db, run: _Run, *, map_id: str, via: str, user_id: str | None, now: datetime) -> dict | None:
    """Einen Schritt schreiben - mit Bedingung auf Version und Stand. ``None``: der Stand war inzwischen ein anderer."""
    veto, step = run.veto, run.current
    if step is None:
        return None
    snapshot = _snapshot(run.pool, step["mode"], map_id)
    now_iso = now.isoformat()
    entry = {
        "index": run.index, "kind": step["kind"], "mode": step["mode"], "mode_label": _mode_head(run.pool, step["mode"])["mode_label"],
        "team": step.get("team"), "registration_id": _registration_for(veto, step), "position": step.get("position"),
        "map_id": map_id, "map_name": snapshot.get("name"), "map_image_url": snapshot.get("image_url"),
        "role": ROLE_OF[step["kind"]], "via": via, "by": user_id if via == SIDE else None, "at": now_iso,
    }
    finished = run.index + 1 >= len(run.steps)
    seconds = int(run.template.get("step_seconds") or 60)
    update = {"$set": {"flow.veto.version": int(veto["version"]) + 1, "flow.veto.step": run.index + 1,
                       "flow.veto.deadline_at": None if finished else (now + timedelta(seconds=seconds)).isoformat(), "updated_at": now_iso},
              "$push": {"flow.veto.steps": entry}}
    if finished:
        done_steps = [*(veto.get("steps") or []), entry]
        update["$set"].update({"flow.veto.status": DONE, "flow.veto.finished_at": now_iso,
                               "planned_games": planned_games_of({"steps": done_steps}, run.pool)})
    if user_id:
        update["$addToSet"] = {"flow.user_ids": user_id}
    written = await db.matches_v2.update_one(
        {"id": run.match["id"], "flow.veto.version": veto["version"], "flow.veto.status": RUNNING, "started_at": None}, update)
    if not written.matched_count:
        return None
    await _audit(db, "match.veto.step", run.match, user_id, {
        "index": run.index, "kind": step["kind"], "mode": step["mode"], "map_id": map_id, "registration_id": entry["registration_id"],
        "position": step.get("position"), "via": via})
    if finished:
        if veto.get("map_pool_id"):
            await db.matches_v2.update_one({"id": run.match["id"], "map_pool_id": None}, {"$set": {"map_pool_id": veto["map_pool_id"]}})
        await _audit(db, "match.veto.done", run.match, None, {"steps": len(run.steps), "map_pool_id": veto.get("map_pool_id")})
        await _tell(db, run.match, [veto["team_a"], veto["team_b"]], "Veto abgeschlossen",
                    "Die Spielreihenfolge steht – ihr könnt starten. Map 1 beginnt, sobald eine Seite auf „Spiel starten“ tippt.",
                    "veto_done", f"veto-done:{run.match['id']}:{now_iso}")
    return await _reload(db, run.match)


async def settle_due(db, match: dict, tournament: dict | None, *, now: datetime | None = None, rng=None) -> dict:
    """Fällige Decider setzen und abgelaufene Fristen auflösen (Zufall, gleichverteilt) - so oft, bis nichts mehr fällig ist. Idempotent:
    jedes Schreiben trägt die Bedingung auf die Version; verliert dieser Aufruf, liest er neu und prüft wieder."""
    now = now or now_utc()
    # Gesperrte Staffel (Codex zu D.3): nur lesen - Job und Seitenaufruf lassen die Frist stehen.
    if (tournament or {}).get("locked_at"):
        return match
    for _ in range(rules_mod.STEPS_MAX + 1):
        veto = veto_of(match)
        if not veto or veto.get("status") != RUNNING or match.get("started_at"):
            return match
        run = await _run_of(db, match, veto)
        step = run.current
        if step is None:
            return match
        deadline = moment(veto.get("deadline_at"))
        if step["kind"] != DECIDER and (not deadline or deadline > now):
            return match
        options = run.options()
        if not options:
            # Darf nach der Prüfung der Vorlage nicht passieren - lieber stehen lassen als still etwas wählen.
            logger.warning("[league_veto] Spiel %s: Schritt %s ohne wählbare Map", match.get("id"), run.index)
            return match
        chosen = options[0] if step["kind"] == DECIDER else rules_mod.auto_choice(options, rng)
        written = await _apply(db, run, map_id=chosen, via=AUTO, user_id=None, now=now)
        match = written if written is not None else await _reload(db, match)
    return match


# ---------------------------------------------------------------- Zug einer Seite

def _replay(veto: dict, *, registration_id: str | None, map_id: str | None, version: int) -> bool:
    """Derselbe Zug noch einmal (Doppelklick, zweites Gerät): die Version ist um eins älter und der letzte Schritt ist genau dieser."""
    last = (veto.get("steps") or [None])[-1]
    return bool(last and int(version) == int(veto.get("version") or 0) - 1 and last.get("via") == SIDE
                and last.get("registration_id") == registration_id and last.get("map_id") == map_id)


def _refusal(veto: dict) -> str | None:
    if veto.get("status") == SKIPPED:
        return f"In diesem Spiel läuft kein Veto: {veto.get('skipped_reason') or 'die Vorlage passt nicht.'}"
    if veto.get("status") == PAUSED:
        reason = (veto.get("paused") or {}).get("reason") or "ohne Grund"
        return f"Das Veto ist pausiert – {reason}. Die Liga-Leitung setzt es fort."
    return None


def _option_hint(run: _Run, map_id: str) -> str:
    step = run.current or {}
    pool_ids = rules_mod.pool_ids(run.pool).get(step.get("mode"), [])
    name = _snapshot(run.pool, step.get("mode"), map_id).get("name") or "Diese Map"
    if map_id not in pool_ids:
        return f"{name} ist im Pool für {_mode_head(run.pool, step.get('mode'))['mode_label']} nicht freigegeben."
    if map_id not in run.remaining.get(step.get("mode"), []):
        return f"{name} ist in diesem Modus schon gesperrt oder gewählt."
    return f"{name} ließe sich nicht mehr zu Ende spielen – die restlichen Schritte gingen nicht auf."


async def pick(db, match: dict, tournament: dict | None, *, registration_id: str, map_id: str, version: int, user: dict,
               now: datetime | None = None) -> dict:
    """Die Seite am Zug sperrt oder wählt eine Map. Gleichzeitig, doppelt, zwei Geräte: einer schreibt, die anderen bekommen die
    Wiederholung oder „bitte neu laden“."""
    if not rules_mod.rules_of(tournament):
        raise FlowProblem(NO_VETO_DETAIL)
    now = now or now_utc()
    match = await ensure_started(db, match, tournament, now=now)
    match = await settle_due(db, match, tournament, now=now)
    veto = veto_of(match)
    if veto is None:
        raise FlowProblem(STARTED_DETAIL if is_running(match) else NOT_STARTED_DETAIL)
    refusal = _refusal(veto)
    if refusal:
        raise FlowProblem(refusal)
    if _replay(veto, registration_id=registration_id, map_id=map_id, version=version):
        return {"version": veto["version"], "step": veto["step"], "status": veto["status"], "idempotent_replay": True}
    if veto.get("status") == DONE:
        raise FlowProblem(DONE_DETAIL)
    if int(version) != int(veto.get("version") or 0):
        raise FlowProblem(CHANGED_DETAIL)
    run = await _run_of(db, match, veto)
    step = run.current
    if step is None:
        raise FlowProblem(DONE_DETAIL)
    expected = _registration_for(veto, step)
    if expected != registration_id:
        names = await _side_names(db, match)
        raise FlowProblem(f"Jetzt ist {names.get(expected, 'die Gegenseite')} am Zug.")
    options = run.options()
    if map_id not in options:
        raise FlowProblem(_option_hint(run, map_id), 422)
    fresh = await _apply(db, run, map_id=map_id, via=SIDE, user_id=user.get("id"), now=now)
    if fresh is None:
        raise FlowProblem(CHANGED_DETAIL)
    fresh = await settle_due(db, fresh, tournament, now=now)
    after = veto_of(fresh) or {}
    return {"version": after.get("version"), "step": after.get("step"), "status": after.get("status"), "idempotent_replay": False}


# ---------------------------------------------------------------- Leitung

async def lead_action(db, match: dict, tournament: dict | None, *, action: str, reason: str | None, version: int, user: dict,
                      now: datetime | None = None) -> dict:
    """Pause, Fortsetzen, Schritt zurück, Neustart - mit Grund, nur solange nichts begonnen und nichts gemeldet ist."""
    if action not in LEAD_ACTIONS:
        raise FlowProblem("Unbekannter Eingriff – möglich sind Pause, Fortsetzen, Schritt zurück und Neustart.", 422)
    if not rules_mod.rules_of(tournament):
        raise FlowProblem(NO_VETO_DETAIL)
    now = now or now_utc()
    now_iso = now.isoformat()
    match = await ensure_started(db, match, tournament, now=now)
    if action != "pause":
        match = await settle_due(db, match, tournament, now=now)
    if is_running(match) or is_finished(match) or has_report(match):
        raise FlowProblem(STARTED_DETAIL)
    veto = veto_of(match)
    if veto is None:
        raise FlowProblem(NOT_STARTED_DETAIL)
    if veto.get("status") == SKIPPED:
        raise FlowProblem(_refusal(veto))
    text = _clean_reason(reason)
    last = (veto.get("lead_log") or [None])[-1]
    if last and int(version) == int(veto.get("version") or 0) - 1 and last.get("action") == action and last.get("reason") == text:
        return {"version": veto["version"], "status": veto["status"], "idempotent_replay": True}
    if int(version) != int(veto.get("version") or 0):
        raise FlowProblem(CHANGED_DETAIL)
    seconds = int((veto.get("template") or {}).get("step_seconds") or 60)
    log = {"action": action, "at": now_iso, "by": user.get("id"), "reason": text}
    update: dict = {"$set": {"flow.veto.version": int(veto["version"]) + 1, "updated_at": now_iso}, "$push": {"flow.veto.lead_log": log},
                    "$addToSet": {"flow.user_ids": user.get("id")}}
    status = veto.get("status")
    if action == "pause":
        if status != RUNNING:
            raise FlowProblem("Pausieren geht nur, solange das Veto läuft.")
        deadline = moment(veto.get("deadline_at"))
        remaining = max(0, int((deadline - now).total_seconds())) if deadline else seconds
        update["$set"].update({"flow.veto.status": PAUSED, "flow.veto.deadline_at": None,
                               "flow.veto.paused": {"at": now_iso, "by": user.get("id"), "reason": text, "remaining_seconds": remaining}})
    elif action == "resume":
        if status != PAUSED:
            raise FlowProblem("Fortsetzen geht nur aus einer Pause.")
        remaining = int((veto.get("paused") or {}).get("remaining_seconds") or seconds)
        update["$set"].update({"flow.veto.status": RUNNING, "flow.veto.paused": None,
                               "flow.veto.deadline_at": (now + timedelta(seconds=max(1, remaining))).isoformat()})
    elif action == "undo":
        steps = list(veto.get("steps") or [])
        if not steps:
            raise FlowProblem("Es gibt noch keinen Schritt, der sich zurücknehmen ließe.")
        # Ein automatischer Decider ist die Folge des Zugs davor - er geht mit.
        while steps and steps[-1].get("kind") == DECIDER and len(steps) > 1:
            steps.pop()
        steps.pop()
        update["$set"].update({"flow.veto.status": RUNNING, "flow.veto.steps": steps, "flow.veto.step": len(steps), "flow.veto.paused": None,
                               "flow.veto.finished_at": None, "flow.veto.deadline_at": (now + timedelta(seconds=seconds)).isoformat()})
        update["$unset"] = {"planned_games": ""}
    else:
        update["$set"].update({"flow.veto.status": RUNNING, "flow.veto.steps": [], "flow.veto.step": 0, "flow.veto.paused": None,
                               "flow.veto.finished_at": None, "flow.veto.deadline_at": (now + timedelta(seconds=seconds)).isoformat()})
        update["$unset"] = {"planned_games": ""}
    written = await db.matches_v2.update_one(
        {"id": match["id"], "flow.veto.version": veto["version"], "flow.veto.status": status, "started_at": None}, update)
    if not written.matched_count:
        raise FlowProblem(CHANGED_DETAIL)
    await _audit(db, "match.veto.lead", match, user.get("id"), {"action": action, "reason": text, "step": veto.get("step")})
    fresh = await _reload(db, match)
    if action != "pause":
        fresh = await settle_due(db, fresh, tournament, now=now)
    after = veto_of(fresh) or {}
    return {"version": after.get("version"), "status": after.get("status"), "step": after.get("step"), "idempotent_replay": False}


# ---------------------------------------------------------------- Matchseite

async def page_block(db, match: dict, tournament: dict | None, *, names: dict[str, str], own_id: str | None, lead: bool,
                     can_lead_act: bool, conflict: dict | None, now: datetime | None = None) -> dict | None:
    """Der Block ``checkin.veto`` - nur Staffeln mit Vorlage. Das Spiel muss vorher durch ``ensure_started`` und ``settle_due`` gelaufen
    sein (``match_flow.page_block`` macht das)."""
    if not rules_mod.rules_of(tournament):
        return None
    now = now or now_utc()
    veto = veto_of(match)
    if veto is None:
        return {"status": "waiting", "skipped_reason": None, "version": 0, "step_seconds": None, "team_a": None, "team_b": None,
                "current": None, "own_turn": False, "can_pick": False, "pick_hint": NOT_STARTED_DETAIL, "options": [], "remaining": [],
                "history": [], "planned_games": [], "paused": None, "lead": None}
    run = await _run_of(db, match, veto)
    step = run.current if veto.get("status") in (RUNNING, PAUSED) else None
    deadline = moment(veto.get("deadline_at"))
    turn_id = _registration_for(veto, step) if step else None
    own_turn = bool(own_id and step and turn_id == own_id)
    pick_hint = None
    if veto.get("status") == SKIPPED:
        pick_hint = _refusal(veto)
    elif veto.get("status") == DONE:
        pick_hint = DONE_DETAIL
    elif veto.get("status") == PAUSED:
        pick_hint = _refusal(veto)
    elif step and own_id and not own_turn:
        pick_hint = f"Jetzt ist {names.get(turn_id, 'die Gegenseite')} am Zug."
    elif step and step["kind"] == DECIDER:
        pick_hint = "Die übrige Map setzt das System."
    allowed = set(run.options()) if step and veto.get("status") == RUNNING else set()
    options = []
    if step:
        for item in rules_mod.pool_maps(run.pool).get(step["mode"]) or []:
            ok = item["map_id"] in allowed
            options.append({"map_id": item["map_id"], "name": item.get("name"), "image_url": item.get("image_url"), "allowed": ok,
                            "hint": None if ok else _option_hint(run, item["map_id"])})
    taken = {(row.get("mode"), row.get("map_id")): row for row in veto.get("steps") or []}
    remaining = []
    for group in (run.pool or {}).get("modes") or []:
        if not group.get("mode"):
            continue
        maps = []
        for item in group.get("maps") or []:
            row = taken.get((group["mode"], item.get("map_id")))
            maps.append({"map_id": item.get("map_id"), "name": item.get("name"), "image_url": item.get("image_url"),
                         "status": (row or {}).get("role") or "open", "by_name": names.get((row or {}).get("registration_id")) if row else None,
                         "position": (row or {}).get("position")})
        remaining.append({"mode": group["mode"], "label": group.get("label") or group["mode"],
                          **({"icon_url": group["icon_url"]} if group.get("icon_url") else {}), "maps": maps})
    history = [{"index": row.get("index"), "kind": row.get("kind"), "mode_label": row.get("mode_label"),
                "name": names.get(row.get("registration_id")) if row.get("registration_id") else None, "map_name": row.get("map_name"),
                "position": row.get("position"), "via": row.get("via"), "at": row.get("at")} for row in veto.get("steps") or []]
    paused = veto.get("paused") if veto.get("status") == PAUSED else None
    return {
        "status": veto.get("status"), "skipped_reason": veto.get("skipped_reason"), "version": veto.get("version"),
        "step_seconds": (veto.get("template") or {}).get("step_seconds"),
        "team_a": {"registration_id": veto.get("team_a"), "name": names.get(veto.get("team_a")), "via": veto.get("team_a_via")} if veto.get("team_a") else None,
        "team_b": {"registration_id": veto.get("team_b"), "name": names.get(veto.get("team_b"))} if veto.get("team_b") else None,
        "current": {
            "index": run.index, "number": run.index + 1, "total": len(run.steps), "kind": step["kind"], "mode": step["mode"],
            **_mode_head(run.pool, step["mode"]), "registration_id": turn_id, "name": names.get(turn_id) if turn_id else None,
            "position": step.get("position"), "deadline_at": veto.get("deadline_at"),
            "remaining_seconds": max(0, int((deadline - now).total_seconds())) if deadline else (paused or {}).get("remaining_seconds"),
        } if step else None,
        "own_turn": own_turn, "can_pick": own_turn and veto.get("status") == RUNNING and step["kind"] != DECIDER, "pick_hint": pick_hint,
        "options": options, "remaining": remaining, "history": history,
        "planned_games": list(match.get("planned_games") or []) if veto.get("status") == DONE else [],
        "paused": {"at": paused.get("at"), "reason": paused.get("reason"), "remaining_seconds": paused.get("remaining_seconds")} if paused else None,
        "lead": {"can_act": bool(can_lead_act and veto.get("status") in (RUNNING, PAUSED, DONE) and not match.get("started_at")),
                 "conflict": conflict} if lead else None,
    }


# ---------------------------------------------------------------- Datenschutz

def export_steps(match: dict, user_id: str) -> list[dict]:
    """Für die Auskunft: die eigenen Züge und Eingriffe als Leitung - je Spiel, ohne die Züge anderer."""
    veto = ((match.get("flow") or {}).get("veto") or {})
    out = []
    for row in veto.get("steps") or []:
        if row.get("by") == user_id:
            out.append({"role": "veto_step", "kind": row.get("kind"), "side": row.get("registration_id"), "at": row.get("at")})
    for row in veto.get("lead_log") or []:
        if row.get("by") == user_id:
            out.append({"role": "veto_lead", "action": row.get("action"), "at": row.get("at")})
    return out


def scrub(veto: dict | None, user_id: str) -> tuple[dict | None, bool]:
    """Kontolöschung: die Kennung der Person fällt aus Zügen, Pause und Eingriffen - die Züge bleiben."""
    if not isinstance(veto, dict):
        return veto, False
    changed = False
    out = dict(veto)
    steps = []
    for row in veto.get("steps") or []:
        if isinstance(row, dict) and row.get("by") == user_id:
            row = {**row, "by": None}
            changed = True
        steps.append(row)
    out["steps"] = steps
    if isinstance(veto.get("paused"), dict) and veto["paused"].get("by") == user_id:
        out["paused"] = {**veto["paused"], "by": None}
        changed = True
    log = []
    for row in veto.get("lead_log") or []:
        if isinstance(row, dict) and row.get("by") == user_id:
            row = {**row, "by": None}
            changed = True
        log.append(row)
    out["lead_log"] = log
    return out, changed


__all__ = ["AUTO", "CHANGED_DETAIL", "DONE_DETAIL", "LEAD_ACTIONS", "NO_VETO_DETAIL", "NOT_A_SIDE_DETAIL", "NOT_STARTED_DETAIL",
           "REPORT_VETO_DETAIL", "SIDE", "VetoProblem", "ensure_started", "export_steps", "lead_action", "page_block", "pick",
           "planned_games_of", "scrub", "settle_due"]
