"""Los auf mehrere Staffeln einer Liga N (#1623, docs/LIGA.md „B.4 Los auf mehrere Staffeln“).

Hat eine Liga N mehrere Staffeln, verteilt ein Los die angenommenen Co-Teams ohne Staffel. Die Rechnung steht im Blatt-Modul
``league_staffel_plan``; hier stehen Daten, Sperren, Befangenheit und Protokoll.

- **Wer gelost wird:** angenommene Anträge ohne Zuteilung, deren Liga N diese ist - bei Übernommenen (F.2) die neue Liga N
  (``carry_over.division_id``), sonst die unterste aktive (``league_applications.target_division_id``). Wer schon in einer Staffel
  steht, bleibt dort; das Los füllt darum herum auf.
- **Vorschau zuerst:** „Auslosen“ speichert Seed, Eingabe und Ergebnis als Entwurf an der Liga N (``league_divisions.draw``) - es entsteht
  keine Anmeldung und keine Nachricht. Neu laden und ein zweites „Auslosen“ bei gleicher Eingabe würfeln nicht neu. Ändert sich die
  Eingabe (Antrag, Staffel, Teilnehmer), ist der Entwurf veraltet (``stale``) und lässt sich nicht übernehmen.
- **Neu auslosen und Tausch** sind eigene, protokollierte Schritte mit Grund (neu auslosen ohne Grund nur, wenn der Entwurf veraltet ist).
- **Übernehmen** teilt jedes Co-Team über denselben Weg zu wie der Eingang (``league_applications._place``): erst alle prüfen, dann
  schreiben. Bricht es dazwischen ab, bleibt der Entwurf gültig, und der nächste Versuch setzt nur noch die übrigen.
- **Sperren:** Auslosen, neu auslosen, Tausch und Verwerfen halten die Season-Sperre; Übernehmen zuerst die Turnier-Sperren aller
  Staffeln der Liga N (nach Kennung sortiert), dann die Season-Sperre - dieselbe Reihenfolge wie das Zuteilen.
- **Befangenheit** (Nr. 73): Wer zu einem Team im Los gehört, lost nicht, tauscht nicht und übernimmt nicht; der Superadmin nur als
  Notausnahme mit Grund (``league.conflict.override``).
"""
from __future__ import annotations

import contextlib
import hashlib
import logging
import secrets

from models import REGISTRATION_LIMIT, new_id, now_utc
from services import league_applications as applications
from services import league_roster, league_service, squad_registration
from services import league_staffel_plan as plan
from services.league_permissions import belongs_to_side, override_reason, record_override, side_of
from services.league_scope import ONLY_LEAGUE
from services.league_service import LeagueProblem
from services.match_audience import teams_by_id
from services.permissions import is_superadmin

logger = logging.getLogger("tls.league_draw")

CAPABILITY = "applications"
DRAFT, APPLIED = "draft", "applied"
REASON_MIN = applications.REASON_MIN
LOG_LIMIT = 50

NO_DIVISION = "Diese Liga gehört nicht zu dieser Season."
NO_STAFFEL = "{label} hat noch keine Staffel."
ONE_STAFFEL = "{label} hat nur eine Staffel – dort teilst du im Eingang direkt zu."
STAFFEL_STARTED = "In {label} hat Staffel {staffel} schon begonnen. Neue Co-Teams teilst du von Hand zu."
STAFFEL_PLAN = "In {label} steht der Spielplan von Staffel {staffel} schon. Neue Co-Teams teilst du von Hand zu (Nachmeldung)."
STAFFEL_LOCKED = "Staffel {staffel} in {label} ist gesperrt. Erst entsperren, dann auslosen."
NOTHING_WAITING = "In {label} wartet kein angenommenes Co-Team auf eine Staffel."
NO_DRAFT = "Für diese Liga gibt es kein offenes Los."
APPLIED_ALREADY = "Dieses Los ist schon übernommen."
STALE = "Seit dem Los hat sich etwas geändert (Anmeldungen, Staffeln oder Teilnehmer). Bitte neu auslosen."
CHANGED = "Das Los hat sich inzwischen geändert. Bitte die Vorschau neu laden."
CONFIRM = "Bitte das Übernehmen bestätigen."
REASON_NEEDED = f"Bitte einen Grund angeben (mindestens {REASON_MIN} Zeichen) – er steht im Protokoll."
OWN_TEAM = "Im Los steht dein eigenes Team. Auslosen, tauschen und übernehmen macht eine andere Person."
OWN_TEAM_SUPERADMIN = ("Im Los steht dein eigenes Team. Als Superadmin geht es nur als Notausnahme, mit einem Grund von mindestens "
                       "fünf Zeichen.")
NOT_READY = "Übernehmen geht noch nicht: {problems}"
OTHER_STAFFEL = "hat schon eine angefangene Zuteilung in einer anderen Staffel – bitte im Eingang einzeln zuteilen"
SIBLINGS_NAMED = " Betroffen: {names}."


def _reason(raw) -> str:
    return " ".join(str(raw or "").split())[:500]


def _now() -> str:
    return now_utc().isoformat()


# ---------------------------------------------------------------- Stand lesen

async def _load(db, season: dict) -> dict:
    """Alles, was Übersicht und Los brauchen, mit einer Abfrage je Sammlung: aktive Liga N, Staffeln, ihre Anmeldungen, feste Spielpläne
    und die angenommenen Anträge der Season."""
    divisions = await db.league_divisions.find({"season_id": season["id"], "status": "active"}, {"_id": 0}).sort("level", 1).to_list(50)
    # Playoff- und Relegations-Staffeln (#2404) tragen ``league_context.kind`` - ins Los kommen nur reguläre Staffeln.
    tournaments = [row for row in await db.tournaments.find(
        {"league_context.season_id": season["id"], **ONLY_LEAGUE},
        {"_id": 0, "id": 1, "title": 1, "status": 1, "locked_at": 1, "max_participants": 1, "league_context": 1}).to_list(500)
        if not (row.get("league_context") or {}).get("kind") and row.get("status") not in squad_registration.FINISHED_TOURNAMENT_STATUSES]
    ids = [row["id"] for row in tournaments]
    registrations = await db.tournament_registrations.find(
        {"tournament_id": {"$in": ids}},
        {"_id": 0, "id": 1, "tournament_id": 1, "team_id": 1, "squad_id": 1, "status": 1, "application_id": 1, "display_name": 1},
    ).to_list(REGISTRATION_LIMIT * max(len(ids), 1)) if ids else []
    planned = set(await db.matches_v2.distinct("tournament_id", {"tournament_id": {"$in": ids}, "is_preview": {"$ne": True}})) if ids else set()
    accepted = await db.league_applications.find({"season_id": season["id"], "status": applications.ACCEPTED}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return {"season": season, "divisions": divisions, "tournaments": tournaments, "registrations": registrations, "planned": planned,
            "accepted": accepted, "siblings": bool(season.get("sibling_squads_in_staffel"))}


def _division(ctx: dict, division_id: str) -> dict:
    found = next((row for row in ctx["divisions"] if row["id"] == division_id), None)
    if not found:
        raise LeagueProblem(NO_DIVISION, 404)
    return found


def _state(ctx: dict, division: dict, draft: dict | None = None) -> dict:
    """Die Eingabe des Loses für eine Liga N. ``draft``: Was dieses Los schon zugeteilt hat (abgebrochenes Übernehmen), zählt wieder als
    wartend und nicht als Teilnehmer - so bleibt der Entwurf gültig, bis alle stehen."""
    label = league_service.division_label(division)
    done = {row["id"] for row in ctx["accepted"] if draft and (row.get("assignment") or {}).get("draw_id") == draft.get("id")}
    waiting = [row for row in ctx["accepted"]
               if (not row.get("assignment") or row["id"] in done) and applications.target_division_id(row, ctx["divisions"]) == division["id"]]
    staffeln, problem = [], None
    rows = sorted((row for row in ctx["tournaments"] if row["league_context"].get("division_id") == division["id"]),
                  key=lambda row: str(row["league_context"].get("staffel") or ""))
    for row in rows:
        regs = [reg for reg in ctx["registrations"] if reg["tournament_id"] == row["id"] and reg.get("application_id") not in done]
        seated = [reg for reg in regs if reg.get("status") in squad_registration.SEAT_STATUSES]
        letter = row["league_context"].get("staffel")
        open_ = row.get("status") in league_service.PRE_START_STATUSES and row["id"] not in ctx["planned"] and not row.get("locked_at")
        if not open_ and not problem:
            text = (STAFFEL_LOCKED if row.get("locked_at") else STAFFEL_PLAN if row["id"] in ctx["planned"] else STAFFEL_STARTED)
            problem = text.format(label=label, staffel=letter)
        staffeln.append({
            "id": row["id"], "staffel": letter, "title": row.get("title"), "status": row.get("status"), "open": open_,
            "capacity": int(row.get("max_participants") or 0), "seats": len(seated),
            # Jede Anmeldung eines Hauptteams belegt die Staffel, auch eine ausgetretene (``identity_key``); mit erlaubten Geschwistern je Co-Team.
            "team_ids": sorted({str(reg.get("squad_id") if ctx["siblings"] else reg.get("team_id")) for reg in regs
                                if (reg.get("squad_id") if ctx["siblings"] else reg.get("team_id"))}),
            "seated_names": sorted(reg.get("display_name") or "Team" for reg in seated),
        })
    if not staffeln:
        problem = NO_STAFFEL.format(label=label)
    elif len(staffeln) == 1:
        problem = ONE_STAFFEL.format(label=label)
    entries = [{"key": row["squad_id"], "team_id": row["team_id"]} for row in waiting]
    return {"label": label, "waiting": waiting, "done": done, "staffeln": staffeln, "problem": problem, "entries": entries,
            "input_hash": plan.input_hash(entries, staffeln, siblings_allowed=ctx["siblings"])}


def _placements(draft: dict) -> dict[str, str]:
    """Das Ergebnis aus dem Seed mit den Tauschen der Leitung darüber - in der Reihenfolge, in der sie geschahen."""
    out = dict(draft.get("result") or {})
    for step in draft.get("swaps") or []:
        left, right = step.get("a"), step.get("b")
        if left in out and right in out:
            out[left], out[right] = out[right], out[left]
    return out


def fingerprint(draft: dict) -> str:
    """Was die Vorschau zeigt: Los, Seed, Zählung und wer wo steht. Übernehmen verlangt genau diese Fassung."""
    parts = [str(draft.get("id")), str(draft.get("seed")), str(draft.get("number")),
             *(f"{squad}>{target}" for squad, target in sorted(_placements(draft).items()))]
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:16]


async def _own_team(db, user: dict, rows: list[dict]) -> bool:
    sides = [side_of(row) for row in rows]
    teams = await teams_by_id(db, sides)
    return any(belongs_to_side(user, side, teams.get(side.get("team_id") or "")) for side in sides)


async def _no_conflict(db, actor: dict, rows: list[dict], conflict_reason: str | None) -> str | None:
    """Befangenheit (Nr. 73) für das ganze Los: 403, wenn die Person zu einem der Teams gehört. Gibt den Grund einer Notausnahme zurück."""
    conflict = {"kind": "involved", "override": is_superadmin(actor)} if await _own_team(db, actor, rows) else None
    return override_reason(conflict, conflict_reason, detail=OWN_TEAM, superadmin_detail=OWN_TEAM_SUPERADMIN)


async def _audit(db, action: str, season: dict, division: dict, actor: dict, override: str | None, **data) -> None:
    await db.audit_logs.insert_one({
        "id": new_id(), "action": f"league.draw.{action}", "target_id": season["id"], "actor_id": actor.get("id"),
        "data": {"division_id": division["id"], "level": division.get("level"), **data, **({"conflict_override": override} if override else {})},
        "created_at": _now(),
    })
    if override:
        await record_override(db, actor, action=f"draw_{action}", target_id=season["id"], reason=override, division_id=division["id"])


def _step(action: str, actor: dict, **data) -> dict:
    return {"action": action, "by": actor.get("id"), "at": _now(), **{key: value for key, value in data.items() if value is not None}}


async def _save(db, division: dict, draft: dict | None) -> None:
    if draft is None:
        await db.league_divisions.update_one({"id": division["id"]}, {"$unset": {"draw": ""}})
    else:
        await db.league_divisions.update_one({"id": division["id"]}, {"$set": {"draw": {**draft, "log": (draft.get("log") or [])[-LOG_LIMIT:], "updated_at": _now()}}})


# ---------------------------------------------------------------- Ansicht

def _suggestion(ctx: dict, division: dict, state: dict) -> dict:
    settings = league_service.effective_settings(ctx["season"], division)
    calendar = league_service.calendar_summary(ctx["season"], settings)
    # Alle Co-Teams dieser Liga N: wer wartet (samt dem, was ein abgebrochenes Übernehmen schon setzte) und wer schon in einer Staffel steht.
    seated = sum(row["seats"] for row in state["staffeln"])
    return plan.suggest(len(state["waiting"]) + seated, max_size=settings.get("max_staffel_size"),
                        active_weeks=calendar["active_weeks"], legs=ctx["season"].get("round_robin_legs") or 1, have=len(state["staffeln"]))


def _draft_view(draft: dict, state: dict, names: dict[str, str]) -> dict:
    placements = _placements(draft)
    swapped = {key for step in draft.get("swaps") or [] for key in (step.get("a"), step.get("b"))}
    entry_of = {row["squad_id"]: row for row in draft.get("entries") or []}
    done = {row["squad_id"] for row in state["waiting"] if row["id"] in state["done"]}
    staffeln = []
    for row in draft.get("staffeln") or []:
        teams = [{"squad_id": squad, "application_id": entry_of[squad].get("application_id"), "display_name": entry_of[squad].get("display_name"),
                  "swapped": squad in swapped, "done": draft.get("status") == APPLIED or squad in done}
                 for squad, target in placements.items() if target == row["id"] and squad in entry_of]
        staffeln.append({"tournament_id": row["id"], "staffel": row.get("staffel"), "title": row.get("title"), "capacity": row.get("capacity"),
                         "seated": list(row.get("seated_names") or []), "teams": teams, "size": int(row.get("seats") or 0) + len(teams)})
    name = {row["squad_id"]: row.get("display_name") for row in draft.get("entries") or []}
    return {
        "id": draft["id"], "seed": draft.get("seed"), "number": draft.get("number"), "status": draft.get("status"), "policy": draft.get("policy"),
        "stale": draft.get("status") == DRAFT and draft.get("input_hash") != state["input_hash"],
        "fingerprint": fingerprint(draft), "created_at": draft.get("created_at"), "applied_at": draft.get("applied_at"),
        "staffeln": staffeln,
        "swaps": [{"a": step.get("a"), "b": step.get("b"), "a_name": name.get(step.get("a")), "b_name": name.get(step.get("b")),
                   "reason": step.get("reason"), "at": step.get("at"), "by_name": names.get(step.get("by")) or "Gelöschter User"}
                  for step in draft.get("swaps") or []],
        "log": [{"action": step.get("action"), "at": step.get("at"), "by_name": names.get(step.get("by")) or "Gelöschter User",
                 "reason": step.get("reason"), "number": step.get("number"), "stale": bool(step.get("stale")),
                 "conflict_reason": step.get("conflict_reason")} for step in draft.get("log") or []],
    }


async def _division_view(db, ctx: dict, division: dict, user: dict, names: dict[str, str] | None = None) -> dict:
    draft = division.get("draw") if isinstance(division.get("draw"), dict) else None
    state = _state(ctx, division, draft if draft and draft.get("status") == DRAFT else None)
    if names is None:
        names = await applications._names(db, {step.get("by") for step in (draft or {}).get("log") or []}
                                          | {step.get("by") for step in (draft or {}).get("swaps") or []})
    still = [row for row in state["waiting"] if row["id"] not in state["done"]]
    return {
        "id": division["id"], "level": division.get("level"), "label": state["label"],
        "lowest": bool(ctx["divisions"]) and ctx["divisions"][-1]["id"] == division["id"],
        "staffeln": [{"tournament_id": row["id"], "staffel": row["staffel"], "status": row["status"], "open": row["open"],
                      "max_participants": row["capacity"], "seats": row["seats"]} for row in state["staffeln"]],
        "waiting": [{"application_id": row["id"], "squad_id": row["squad_id"], "display_name": row.get("display_name"),
                     "carry_over": bool(row.get("carry_over"))} for row in still],
        "suggestion": _suggestion(ctx, division, state),
        "problem": state["problem"],
        "can_draw": not state["problem"] and bool(still),
        "own_team": await _own_team(db, user, state["waiting"] or [{"team_id": row.get("team_id"), "squad_id": row.get("squad_id"), "applied_by": None}
                                                                    for row in (draft or {}).get("entries") or []]),
        "draw": _draft_view(draft, state, names) if draft else None,
    }


async def overview(db, season: dict, user: dict) -> dict:
    """Je aktiver Liga N: wer auf eine Staffel wartet, welche Staffeln es gibt, ob sie reichen (Vorschlag der Staffelzahl) und das Los."""
    ctx = await _load(db, season)
    people = {step.get("by") for division in ctx["divisions"] for key in ("log", "swaps") for step in (division.get("draw") or {}).get(key) or []}
    names = await applications._names(db, people)
    return {"superadmin": is_superadmin(user), "siblings_allowed": ctx["siblings"],
            "divisions": [await _division_view(db, ctx, division, user, names) for division in ctx["divisions"]]}


async def _answer(db, season: dict, division_id: str, user: dict, **extra) -> dict:
    ctx = await _load(db, await league_service.get_season(db, season["id"]))
    return {**extra, "draw": (await _division_view(db, ctx, _division(ctx, division_id), user))["draw"]}


# ---------------------------------------------------------------- Auslosen, neu auslosen, Tausch, Verwerfen

async def _team_names(db, team_ids: list[str]) -> str:
    rows = await db.teams.find({"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(team_ids) + 1) if team_ids else []
    return ", ".join(sorted(row.get("name") or "Team" for row in rows))


async def _run(db, ctx: dict, division: dict, state: dict, seed: str) -> dict:
    """Rechnet das Los und baut den Entwurf - schreibt nichts."""
    if state["problem"]:
        raise LeagueProblem(state["problem"], 409)
    if not state["entries"]:
        raise LeagueProblem(NOTHING_WAITING.format(label=state["label"]), 409)
    try:
        found = plan.draw(state["entries"], state["staffeln"], seed, siblings_allowed=ctx["siblings"])
    except plan.DrawProblem as problem:
        named = await _team_names(db, problem.team_ids)
        raise LeagueProblem(problem.message + (SIBLINGS_NAMED.format(names=named) if named else ""), problem.status) from None
    return {
        "policy": plan.POLICY, "seed": seed, "status": DRAFT, "input_hash": state["input_hash"], "siblings_allowed": ctx["siblings"],
        "entries": [{"application_id": row["id"], "squad_id": row["squad_id"], "team_id": row["team_id"], "display_name": row.get("display_name")}
                    for row in state["waiting"]],
        "staffeln": [{key: row[key] for key in ("id", "staffel", "title", "capacity", "seats", "team_ids", "seated_names")} for row in state["staffeln"]],
        "result": found["placements"], "swaps": [],
    }


async def create(db, league: dict, season: dict, division_id: str, body: dict, actor: dict) -> dict:
    """„Auslosen“: legt den Entwurf an. Gibt es schon einen zur selben Eingabe, kommt der zurück (``replay``) - es wird nicht neu gewürfelt.
    Ein veralteter Entwurf wird ersetzt; das zählt als neues Los, ohne Grund."""
    async with applications._season_lock(db, season["id"]):
        ctx = await _load(db, await league_service.get_season(db, season["id"]))
        division = _division(ctx, division_id)
        old = division.get("draw") if isinstance(division.get("draw"), dict) else None
        state = _state(ctx, division, old if old and old.get("status") == DRAFT else None)
        override = await _no_conflict(db, actor, state["waiting"], body.get("conflict_reason"))
        if old and old.get("status") == DRAFT and old.get("input_hash") == state["input_hash"]:
            return await _answer(db, season, division_id, actor, replay=True)
        # Nach einem abgebrochenen Übernehmen gilt der alte Entwurf nicht mehr: Was er schon zuteilte, steht jetzt fest.
        state = _state(ctx, division)
        draft = await _run(db, ctx, division, state, secrets.token_hex(8))
        replaces = bool(old and old.get("status") == DRAFT)
        number = int((old or {}).get("number") or 0) + 1 if old else 1
        action = "redraw" if replaces else "create"
        draft.update({"id": new_id(), "number": number, "created_by": actor.get("id"), "created_at": _now(),
                      "log": [*((old or {}).get("log") or [] if replaces else []),
                              _step(action, actor, number=number, stale=True if replaces else None, conflict_reason=override)]})
        await _save(db, division, draft)
        await _audit(db, action, season, division, actor, override, draw_id=draft["id"], seed=draft["seed"], number=number,
                     teams=len(draft["entries"]), **({"stale": True} if replaces else {}))
    return await _answer(db, season, division_id, actor, replay=False)


async def _open_draft(db, season: dict, division_id: str, actor: dict, conflict_reason: str | None) -> tuple[dict, dict, dict, dict, str | None]:
    """Unter der Season-Sperre: Stand, Liga N, Entwurf und der Grund einer Notausnahme. Ohne offenen Entwurf 409."""
    ctx = await _load(db, await league_service.get_season(db, season["id"]))
    division = _division(ctx, division_id)
    draft = division.get("draw") if isinstance(division.get("draw"), dict) else None
    if not draft:
        raise LeagueProblem(NO_DRAFT, 409)
    if draft.get("status") != DRAFT:
        raise LeagueProblem(APPLIED_ALREADY, 409)
    state = _state(ctx, division, draft)
    override = await _no_conflict(db, actor, state["waiting"], conflict_reason)
    return ctx, division, draft, state, override


async def redraw(db, league: dict, season: dict, division_id: str, body: dict, actor: dict) -> dict:
    """Neu auslosen mit neuem Seed: ein eigener Schritt im Protokoll, mit Grund - außer der Entwurf ist veraltet."""
    async with applications._season_lock(db, season["id"]):
        ctx, division, old, state, override = await _open_draft(db, season, division_id, actor, body.get("conflict_reason"))
        stale = old.get("input_hash") != state["input_hash"]
        reason = _reason(body.get("reason"))
        if not stale and len(reason) < REASON_MIN:
            raise LeagueProblem(REASON_NEEDED, 422)
        seed = secrets.token_hex(8)
        draft = await _run(db, ctx, division, _state(ctx, division) if stale else state, seed)
        number = int(old.get("number") or 0) + 1
        draft.update({"id": new_id(), "number": number, "created_by": actor.get("id"), "created_at": _now(),
                      "log": [*(old.get("log") or []), _step("redraw", actor, number=number, reason=reason or None, stale=True if stale else None,
                                                             conflict_reason=override)]})
        await _save(db, division, draft)
        await _audit(db, "redraw", season, division, actor, override, draw_id=draft["id"], seed=seed, number=number, reason=reason or None,
                     previous_seed=old.get("seed"), **({"stale": True} if stale else {}))
    return await _answer(db, season, division_id, actor, replay=False)


async def swap(db, league: dict, season: dict, division_id: str, body: dict, actor: dict) -> dict:
    """Zwei geloste Co-Teams tauschen die Staffel - nur mit Grund, die Geschwister-Regel wird neu geprüft, die Größen bleiben."""
    async with applications._season_lock(db, season["id"]):
        ctx, division, draft, state, override = await _open_draft(db, season, division_id, actor, body.get("conflict_reason"))
        if draft.get("input_hash") != state["input_hash"]:
            raise LeagueProblem(STALE, 409)
        reason = _reason(body.get("reason"))
        if len(reason) < REASON_MIN:
            raise LeagueProblem(REASON_NEEDED, 422)
        left, right = str(body.get("squad_id") or ""), str(body.get("other_squad_id") or "")
        entries = [{"key": row["squad_id"], "team_id": row["team_id"]} for row in draft.get("entries") or []]
        try:
            plan.swap(entries, draft.get("staffeln") or [], _placements(draft), left, right, siblings_allowed=ctx["siblings"])
        except plan.DrawProblem as problem:
            raise LeagueProblem(problem.message, problem.status) from None
        draft = {**draft, "swaps": [*(draft.get("swaps") or []), {"a": left, "b": right, "reason": reason, "by": actor.get("id"), "at": _now()}],
                 "log": [*(draft.get("log") or []), _step("swap", actor, reason=reason, conflict_reason=override)]}
        await _save(db, division, draft)
        await _audit(db, "swap", season, division, actor, override, draw_id=draft["id"], squad_ids=[left, right], reason=reason)
    return await _answer(db, season, division_id, actor)


async def discard(db, league: dict, season: dict, division_id: str, body: dict, actor: dict) -> dict:
    """Den Entwurf verwerfen - mit Grund, außer er ist veraltet. Zugeteilt wird dann von Hand oder mit einem neuen Los."""
    async with applications._season_lock(db, season["id"]):
        ctx, division, draft, state, override = await _open_draft(db, season, division_id, actor, body.get("conflict_reason"))
        stale = draft.get("input_hash") != state["input_hash"]
        reason = _reason(body.get("reason"))
        if not stale and len(reason) < REASON_MIN:
            raise LeagueProblem(REASON_NEEDED, 422)
        await _save(db, division, None)
        await _audit(db, "discard", season, division, actor, override, draw_id=draft["id"], seed=draft.get("seed"), number=draft.get("number"),
                     reason=reason or None, **({"stale": True} if stale else {}))
    return await _answer(db, season, division_id, actor)


# ---------------------------------------------------------------- Übernehmen

@contextlib.asynccontextmanager
async def _staffel_locks(db, tournament_ids: list[str]):
    """Die Turnier-Sperren aller Staffeln der Liga N, immer in derselben Reihenfolge und vor der Season-Sperre."""
    async with contextlib.AsyncExitStack() as stack:
        for tournament_id in sorted(set(tournament_ids)):
            await stack.enter_async_context(applications._staffel_lock(db, tournament_id, wait_seconds=applications.LOCK_WAIT_SECONDS))
        yield


async def _check(db, league: dict, season: dict, application: dict, tournament_id: str, actor: dict) -> tuple[dict | None, str | None]:
    """Dieselbe Prüfung wie beim Zuteilen im Eingang, ohne zu schreiben. Antwort: die Anmeldung eines abgebrochenen Versuchs (oder ``None``)
    und der Grund, warum es nicht geht."""
    try:
        tournament = await applications._staffel_for_write(db, season, tournament_id)
        team, squad = await applications._load_side(db, application["squad_id"])
        if not squad:
            return None, applications.SQUAD_GONE
        left_over = await applications._left_over(db, application)
        if left_over and left_over["tournament_id"] != tournament_id:
            return None, OTHER_STAFFEL
        problems = (await applications.check_squad(db, league, season, team, squad, application=application, seated=bool(left_over)))["problems"]
        if problems:
            return None, problems[0][1]
        if not left_over:
            await squad_registration.build_registration(db, tournament, application["team_id"], application["squad_id"], actor,
                                                        via=applications.VIA, source=applications.VIA, application_id=application["id"])
        return left_over, None
    except squad_registration.SquadAssignError as refusal:
        return None, refusal.detail
    except LeagueProblem as problem:
        return None, problem.message


async def apply(db, league: dict, season: dict, division_id: str, body: dict, actor: dict, *, refresh_previews) -> dict:
    """Übernimmt das Los: Jedes Co-Team kommt in seine geloste Staffel. Erst alle prüfen, dann schreiben; was schon steht, bleibt."""
    if not body.get("confirm"):
        raise LeagueProblem(CONFIRM, 422)
    seen = await db.league_divisions.find_one({"id": division_id, "season_id": season["id"]}, {"_id": 0, "draw": 1})
    if not seen:
        raise LeagueProblem(NO_DIVISION, 404)
    locked = sorted(row["id"] for row in ((seen.get("draw") or {}).get("staffeln") or []))
    placed: list[tuple[dict, dict, dict]] = []
    override = None
    finished = False
    async with _staffel_locks(db, locked):
        try:
            async with applications._season_lock(db, season["id"]):
                ctx, division, draft, state, override = await _open_draft(db, season, division_id, actor, body.get("conflict_reason"))
                fresh = ctx["season"]
                if sorted(row["id"] for row in draft.get("staffeln") or []) != locked:
                    raise LeagueProblem(applications.BUSY, 409)
                if str(body.get("fingerprint") or "") != fingerprint(draft):
                    raise LeagueProblem(CHANGED, 409)
                if draft.get("input_hash") != state["input_hash"]:
                    raise LeagueProblem(STALE, 409)
                placements = _placements(draft)
                todo, problems = [], []
                for application in state["waiting"]:
                    if application["id"] in state["done"]:
                        continue
                    target = placements.get(application["squad_id"])
                    left_over, problem = await _check(db, league, fresh, application, target, actor) if target else (None, STALE)
                    if problem:
                        problems.append(f"{application.get('display_name') or 'Co-Team'}: {problem}")
                    todo.append((application, target, left_over))
                if problems:
                    more = f" (und {len(problems) - 3} weitere)" if len(problems) > 3 else ""
                    raise LeagueProblem(NOT_READY.format(problems=" · ".join(problems[:3]) + more), 409)
                for application, target, left_over in todo:
                    done, tournament, registration = await applications._place(db, fresh, application, target, actor, {}, left_over, override)
                    await db.league_applications.update_one({"id": done["id"]}, {"$set": {"assignment.draw_id": draft["id"]}})
                    placed.append(({**done, "assignment": {**done["assignment"], "draw_id": draft["id"]}}, tournament, registration))
                now = _now()
                await db.league_divisions.update_one({"id": division["id"]}, {
                    "$set": {"draw.status": APPLIED, "draw.applied_by": actor.get("id"), "draw.applied_at": now, "draw.updated_at": now},
                    "$push": {"draw.log": _step("apply", actor, conflict_reason=override)}})
                await _audit(db, "apply", season, division, actor, override, draw_id=draft["id"], seed=draft.get("seed"), number=draft.get("number"),
                             policy=draft.get("policy"), input_hash=draft.get("input_hash"), placements=placements, swaps=len(draft.get("swaps") or []))
                finished = True
        finally:
            # Auch nach einem Abbruch: Wer schon in seiner Staffel steht, bekommt Kader, Protokoll und Nachricht - einmal.
            if placed:
                try:
                    await _after(db, league, season, placed, actor, override, refresh_previews)
                except Exception:
                    if finished:
                        raise
                    logger.exception("league draw: follow-up after an aborted apply failed")
    return await _answer(db, season, division_id, actor, assigned=len(placed))


async def _after(db, league: dict, season: dict, placed: list[tuple[dict, dict, dict]], actor: dict, override: str | None, refresh_previews) -> None:
    """Wie nach dem Zuteilen im Eingang: Vorschau je Staffel einmal auffrischen, Spiel-IDs festhalten, Protokoll und Nachricht je Co-Team."""
    for tournament in {row[1]["id"]: row[1] for row in placed}.values():
        await refresh_previews(db, tournament, actor.get("id"))
    squads = {row["id"]: row for row in await db.team_squads.find(
        {"id": {"$in": sorted({row[2]["squad_id"] for row in placed})}}, {"_id": 0, "id": 1, "member_ids": 1}).to_list(len(placed) + 1)}
    for done, tournament, registration in placed:
        await league_roster.after_assign(db, tournament, registration, squads.get(registration["squad_id"]) or {}, actor.get("id"))
        await applications._audit_decision(db, "assign", done, actor, override, tournament_id=tournament["id"], draw_id=done["assignment"]["draw_id"])
        await applications._tell_status(db, league, season, done, "assigned")
