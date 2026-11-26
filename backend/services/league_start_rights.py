"""Startrechte für die nächste Season (#1627, docs/LIGA.md „F.2a Startrechte für die nächste Season“): alles, was schreibt.

**Kein zweites System:** Ein Startrecht ist der übernommene Antrag der Folge-Season (``league_applications`` mit ``carry_over``, F.2).
Hier stehen Zusage, Verfall, Nachrücken, die Nachricht zum bestätigten Auf- und Abstieg und die Übersicht der Verwaltung. Die Regeln
selbst (Einstellung, Frist, Zustände, Nachrückerregel) stehen im Blatt-Modul ``services/league_start_right_rules.py``. **Ohne die
Einstellung ``start_rights`` an der Season geschieht hier nichts**: Dann gilt F.2 unverändert (Nr. 160).

Gleichzeitigkeit: Alles Schreiben hält die Season-Sperre der Folge-Season (dieselbe wie Anmelden, Abmelden und Zuteilen) und schreibt
mit Bedingung auf den alten Stand. Dieses Modul importiert ``league_applications`` und ``league_successor`` - nie umgekehrt: Das
Abmelden bekommt ``released`` von der Route mitgegeben, die Nachricht nach dem Abschluss stößt die Route an.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from models import new_id, now_utc
from services.league_start_right_rules import (
    ACCEPT, ACCEPTED, AUTO, CONFIRMED, DECLINED, DEFAULTS, EXPIRED, FIELD, FORECAST, NEXT, NOTICES, NOTICES_OPEN, OFFERED, REASON_MIN,
    StartRightProblem, accept_until, candidates, day_text, defaults, may_pass, needs_accept, normalize, offer, overdue, right_of, state,
    stored,
)
from services.log_safe import log_safe

logger = logging.getLogger("tls.league_start_rights")

__all__ = ["StartRightProblem", "accept", "accept_for", "announce", "decline", "defaults", "fill", "outlook", "overview", "released",
           "row_of", "save_settings", "sweep"]


# ---------------------------------------------------------------- Texte

BUSY = "An dieser Season wird gerade etwas geändert. Bitte gleich noch einmal versuchen."
GONE = "Dieses Startrecht gibt es nicht."
NO_RIGHT = "Für dieses Co-Team gibt es kein Startrecht, das eine Zusage braucht."
NOT_OPEN = "Dieses Startrecht ist nicht mehr offen. Bitte neu laden."
LATE = "Die Frist für die Zusage ist am {day} abgelaufen. Jetzt hilft nur eine neue Anmeldung oder die Liga-Leitung."
NOT_RESPONSIBLE = "Zusagen und ablehnen dürfen nur Captain und Vertreter des Co-Teams."
NOTHING_TO_PASS = "Hier gibt es nichts abzulehnen. Wer nicht mitspielen will, meldet sich ab."
REASON_SHORT = f"Bitte einen Grund angeben (mindestens {REASON_MIN} Zeichen)."
EXPIRED_REASON = "Startrecht verfallen: bis {day} keine Zusage."
NO_PLACE = "Für diesen Antrag ist kein Platz frei geworden."
PLACE_TAKEN = "Dieser Platz ist schon vergeben. Bitte neu laden."
NOT_A_CANDIDATE = "Dieses Co-Team ist kein Kandidat für den Platz. Wählbar sind nur die vorgeschlagenen Co-Teams."
FILL_STARTED = "Die Season hat schon begonnen. Nachrücken geht jetzt nur noch von Hand im Eingang."
FILL_PAUSED = "Der Endstand der Vorgänger-Season wird gerade geprüft (wieder geöffnet). Nachrücken geht erst nach dem neuen Abschluss."
WHY_TEXT = {DECLINED: "abgemeldet", EXPIRED: "Frist verfallen", "rejected": "von der Leitung abgelehnt"}
REASONS = {"announce": "league_start_right", "reminder": "league_start_right_reminder", "expired": "league_start_right_expired",
           "fill": "league_start_right_fill", "back": "league_start_right_back", "accepted": "league_start_right_accepted",
           "lead": "league_start_right_lead"}
KIND = "tournament_registration"
ZERO = {"expired": 0, "restored": 0, "filled": 0, "reminded": 0, "announced": 0, "paused": 0}






# ---------------------------------------------------------------- Sperre, Protokoll, Nachrichten

class _Lock:
    """Die Season-Sperre der Folge-Season - dieselbe wie Anmelden, Abmelden und Zuteilen (``league_applications._season_lock``)."""

    def __init__(self, db, season_id: str, wait_seconds: float = 10.0):
        from services.mutation_lock import league_season_resource, mutation_lock

        self._lease = mutation_lock(db, league_season_resource(season_id), wait_seconds=wait_seconds)

    async def __aenter__(self):
        from services.mutation_lock import MutationLockBusy

        try:
            return await self._lease.__aenter__()
        except MutationLockBusy:
            raise StartRightProblem(BUSY, 409) from None

    async def __aexit__(self, *exc):
        return await self._lease.__aexit__(*exc)


async def _audit(db, action: str, season_id: str | None, actor_id: str | None, **data) -> None:
    await db.audit_logs.insert_one({"id": new_id(), "action": f"league.start_right.{action}", "target_id": season_id, "actor_id": actor_id,
                                    "data": data, "created_at": now_utc().isoformat()})


async def _tell(db, application: dict, headline: str, text: str, reason: str, key: str, *, url: str = "/teams") -> int:
    """An Captain und Vertreter des Co-Teams: Glocke, Push und Mail - je Person und Schlüssel einmal (``unique_dedupe``). Eine
    Nachricht hält nie etwas auf."""
    from services.league_applications import _responsible
    from services.league_mail import send_league_mail
    from services.user_notifications import create_user_notification

    sent = 0
    try:
        squad = await db.team_squads.find_one({"id": application.get("squad_id")}, {"_id": 0}) or {
            "id": application.get("squad_id"), "team_id": application.get("team_id")}
        for user_id in sorted(await _responsible(db, squad)):
            own = f"{key}:{user_id}"
            if await create_user_notification(user_id, headline, text, url=url, kind=KIND, meta={
                    "reason": reason, "application_id": application.get("id"), "dedupe_key": own, "unique_dedupe": True}):
                sent += 1
            await send_league_mail(db, user_id, headline, text, url, f"{own}:mail")
    except Exception:  # noqa: BLE001 - der Schritt steht, die Nachricht hält ihn nicht auf
        logger.warning("[liga] Nachricht zum Startrecht nicht verschickt: %s", log_safe(application.get("id")), exc_info=True)
    return sent


async def _tell_lead(db, season: dict, application: dict, headline: str, text: str, key: str) -> None:
    from services.league_applications import _responsible
    from services.league_permissions import staff_user_ids
    from services.user_notifications import create_user_notification

    try:
        squad = await db.team_squads.find_one({"id": application.get("squad_id")}, {"_id": 0}) or {}
        own = await _responsible(db, squad) if squad else set()
        url = f"/admin/leagues/seasons/{season['id']}#anmeldung"
        for user_id in sorted(await staff_user_ids(db, season.get("league_id"), ("applications",)) - own):
            await create_user_notification(user_id, headline, text, url=url, kind=KIND, meta={
                "reason": REASONS["lead"], "application_id": application.get("id"), "dedupe_key": f"{key}:{user_id}", "unique_dedupe": True})
    except Exception:  # noqa: BLE001 - siehe ``_tell``
        logger.warning("[liga] Nachricht an die Leitung zum Startrecht nicht verschickt: %s", log_safe(application.get("id")), exc_info=True)


async def _title(db, season: dict) -> str:
    league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "name": 1}) or {}
    return " ".join(part for part in (league.get("name"), season.get("name")) if part)


async def _season_of(db, season_id: str | None) -> dict:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0}) if season_id else None
    if not season:
        raise StartRightProblem(GONE, 404)
    return season


async def _application(db, application_id: str, season_id: str | None = None) -> dict:
    query = {"id": application_id, "carry_over": {"$exists": True}, **({"season_id": season_id} if season_id else {})}
    application = await db.league_applications.find_one(query, {"_id": 0})
    if not application:
        raise StartRightProblem(GONE, 404)
    return application


# ---------------------------------------------------------------- Zusage

async def _accept(db, application_id: str, actor_id: str | None, via: str, *, reason: str | None = None, late_ok: bool = False) -> dict:
    """Die Zusage unter der Season-Sperre, mit Bedingung auf den offenen Stand. Ein zweiter Aufruf antwortet mit ``replay``."""
    application = await _application(db, application_id)
    right = right_of(application)
    if not right:
        raise StartRightProblem(NO_RIGHT, 409)
    if right.get("status") == ACCEPTED and application.get("status") == "accepted":
        return {**application, "replay": True}
    season = await _season_of(db, application.get("season_id"))
    if application.get("status") != "accepted" or right.get("status") != OFFERED:
        raise StartRightProblem(NOT_OPEN, 409)
    if not late_ok and overdue(application, season):
        raise StartRightProblem(LATE.format(day=day_text(accept_until(application, season))), 409)
    now = now_utc().isoformat()
    step = {"status": "accepted", "by": actor_id, "at": now, "start_right": ACCEPTED, "via": via, **({"reason": reason} if reason else {})}
    written = await db.league_applications.update_one(
        {"id": application_id, "status": "accepted", "carry_over.start_right.status": OFFERED},
        {"$set": {"carry_over.start_right.status": ACCEPTED, "carry_over.start_right.accepted_at": now,
                  "carry_over.start_right.accepted_by": actor_id, "carry_over.start_right.accepted_via": via,
                  **({"carry_over.start_right.accept_reason": reason} if reason else {}), "updated_at": now},
         "$push": {"history": step}})
    fresh = await _application(db, application_id)
    if not written.modified_count:
        if (right_of(fresh) or {}).get("status") == ACCEPTED:
            return {**fresh, "replay": True}
        raise StartRightProblem(NOT_OPEN, 409)
    await _audit(db, "accept", fresh.get("season_id"), actor_id, application_id=application_id, squad_id=fresh.get("squad_id"), via=via,
                 **({"reason": reason} if reason else {}))
    return {**fresh, "replay": False}


async def _own(db, application_id: str, user: dict) -> dict:
    """Der Antrag, wenn die Person für das Co-Team handeln darf (Captain oder Vertreter, wie Anmelden und Abmelden)."""
    from services.league_applications import _load_side, may_apply

    application = await _application(db, application_id)
    _team, squad = await _load_side(db, application["squad_id"])
    if not squad or not await may_apply(db, user, squad):
        raise StartRightProblem(NOT_RESPONSIBLE, 403)
    return application


async def accept(db, application_id: str, user: dict) -> dict:
    """Captain oder Vertreter sagt zu. Gleichzeitige Zusagen stellen sich an der Season-Sperre an - geschrieben wird einmal."""
    application = await _own(db, application_id, user)
    async with _Lock(db, application["season_id"]):
        return await _accept(db, application_id, user["id"], "team")


async def accept_for(db, season: dict, application_id: str, actor: dict, reason: str | None, conflict_reason: str | None = None) -> dict:
    """Die Leitung trägt eine Zusage ein (mit Grund) - nie für das eigene Team."""
    from services.league_permissions import record_override, require_no_side_conflict, side_of

    reason = " ".join(str(reason or "").split())
    if len(reason) < REASON_MIN:
        raise StartRightProblem(REASON_SHORT)
    application = await _application(db, application_id, season["id"])
    await require_no_side_conflict(db, actor, side_of(application), conflict_reason=conflict_reason)
    async with _Lock(db, season["id"]):
        override = await require_no_side_conflict(db, actor, side_of(await _application(db, application_id, season["id"])),
                                                  conflict_reason=conflict_reason)
        done = await _accept(db, application_id, actor.get("id"), "lead", reason=reason, late_ok=True)
    if not done.get("replay"):
        if override:
            await record_override(db, actor, action="start_right_accept", target_id=season["id"], reason=override, application_id=application_id)
        carry = done["carry_over"]
        await _tell(db, done, "Startrecht: Zusage eingetragen",
                    f"Die Liga-Leitung hat für {done.get('display_name') or 'euer Co-Team'} die Zusage für {carry.get('division_label')} in "
                    f"{await _title(db, season)} eingetragen. Wer doch nicht mitspielen will, meldet sich unter Teams ab.",
                    REASONS["accepted"], f"league-start-right:accepted:{application_id}:{(right_of(done) or {}).get('offered_at')}")
    return done



# ---------------------------------------------------------------- Nachrücken

async def _context(db, season: dict) -> dict:
    """Was die Nachrückerregel braucht: der Endstand des Vorgängers (``league_successor.plan``) und die aktiven Liga N der Season.
    ``paused``: Der Vorgänger ist nicht (mehr) abgeschlossen - dann verfällt nichts und rückt niemand nach."""
    from services import league_successor

    predecessor = await db.league_seasons.find_one({"id": season.get("predecessor_id")}, {"_id": 0}) if season.get("predecessor_id") else None
    if not predecessor:
        return {"predecessor": None, "paused": False, "levels": [], "table": {}}
    checked = await league_successor.plan(db, predecessor)
    divisions = await db.league_divisions.find({"season_id": season["id"], "status": {"$ne": "archived"}}, {"_id": 0, "level": 1}).to_list(50)
    return {"predecessor": predecessor, "paused": bool(checked["problems"]),
            "levels": sorted(row["level"] for row in divisions if isinstance(row.get("level"), int)),
            "table": {team["squad_id"]: team for division in checked["divisions"] for team in division["teams"]}}


def _why(freed: dict) -> str:
    if (right_of(freed) or {}).get("status") == EXPIRED:
        return EXPIRED
    return DECLINED if freed.get("status") == "withdrawn" else "rejected"


def _is_free(application: dict) -> bool:
    """Ein frei gewordener Platz: abgemeldet, verfallen oder abgelehnt - nicht zurückgenommen (Nr. 162) - und noch nicht vergeben."""
    carry = application.get("carry_over") or {}
    return (application.get("status") in ("withdrawn", "rejected") and not carry.get("revoked_at") and not carry.get("filled_by")
            and isinstance(carry.get("division_level"), int))


async def _suggest(db, season: dict, freed: dict, ctx: dict) -> dict:
    """Die Kandidaten für den frei gewordenen Platz: ``candidates`` mit den Anträgen dazu (``rows``)."""
    rows = await db.league_applications.find({"season_id": season["id"], "status": "accepted", "carry_over": {"$exists": True},
                                              "assignment": {"$exists": False}}, {"_id": 0}).to_list(1000)
    rights = []
    for row in rows:
        carry = row["carry_over"]
        table = ctx["table"].get(row["squad_id"]) or {}
        rights.append({"application_id": row["id"], "squad_id": row["squad_id"], "from_level": carry.get("from_level"),
                       "from_staffel": carry.get("from_staffel"), "division_level": carry.get("division_level"),
                       "rank": table.get("rank") or carry.get("rank"), "points": table.get("points"), "played": table.get("played"),
                       "score_diff": table.get("score_diff"), "passed": carry.get("passed") or [], "fills": bool(carry.get("fills"))})
    carry = freed["carry_over"]
    place = {"application_id": freed["id"], "division_level": carry.get("division_level"), "from_level": carry.get("from_level")}
    found = candidates(place, rights, ctx["levels"])
    return {**found, "rows": {row["id"]: row for row in rows}}


def _movement(from_level, level) -> str:
    if not isinstance(from_level, int) or not isinstance(level, int) or from_level == level:
        return "stay"
    return "up" if level < from_level else "down"


async def _fill(db, season: dict, freed: dict, candidate: dict, *, group: str | None, actor_id: str | None, reason: str | None) -> dict | None:
    """Der Kandidat rückt auf den frei gewordenen Platz. Unter der Season-Sperre; den Platz gewinnt, wer ihn zuerst markiert
    (``filled_by``) - ``None``, wenn er schon vergeben ist oder der Kandidat sich inzwischen geändert hat."""
    now = now_utc().isoformat()
    claim = {"application_id": candidate["id"], "display_name": candidate.get("display_name"), "at": now}
    claimed = await db.league_applications.update_one({"id": freed["id"], "carry_over.filled_by": {"$exists": False}},
                                                      {"$set": {"carry_over.filled_by": claim, "updated_at": now}})
    if not claimed.modified_count:
        return None
    target, own = freed["carry_over"], candidate["carry_over"]
    why = _why(freed)
    fills = {"for_application_id": freed["id"], "for_name": freed.get("display_name"), "why": why, "by": actor_id, "at": now, "group": group,
             **({"reason": reason} if reason else {}),
             "back": {"division_id": own.get("division_id"), "division_level": own.get("division_level"),
                      "division_label": own.get("division_label"), "movement": own.get("movement"),
                      **({"start_right": own["start_right"]} if isinstance(own.get("start_right"), dict) else {})}}
    fields = {"carry_over.division_id": target.get("division_id"), "carry_over.division_level": target.get("division_level"),
              "carry_over.division_label": target.get("division_label"),
              "carry_over.movement": _movement(own.get("from_level"), target.get("division_level")), "carry_over.fills": fills,
              # Andere Liga N: Im Zusage-Modus beginnt eine neue Frist.
              **({"carry_over.start_right": offer()} if needs_accept(season) else {}), "updated_at": now}
    step = {"status": "accepted", "by": actor_id, "at": now, "start_right": "fills", **({"reason": reason} if reason else {})}
    written = await db.league_applications.update_one(
        {"id": candidate["id"], "status": "accepted", "assignment": {"$exists": False}, "carry_over.fills": {"$exists": False},
         "carry_over.division_level": own.get("division_level")},
        {"$set": fields, "$push": {"history": step}})
    if not written.modified_count:
        await db.league_applications.update_one({"id": freed["id"], "carry_over.filled_by.application_id": candidate["id"]},
                                                {"$unset": {"carry_over.filled_by": ""}})
        return None
    moved = await _application(db, candidate["id"])
    await _audit(db, "fill", season["id"], actor_id, application_id=candidate["id"], squad_id=candidate.get("squad_id"),
                 for_application_id=freed["id"], why=why, group=group, rule="lead" if actor_id else "next",
                 division_level=target.get("division_level"), **({"reason": reason} if reason else {}))
    until = accept_until(moved, season)
    how = (f"Bitte bis {day_text(until)} zusagen oder ablehnen: unter Teams beim Co-Team. Ohne Antwort bleibt ihr in "
           f"{own.get('division_label')}." if right_of(moved) else
           f"Ihr seid automatisch dabei. Wer lieber in {own.get('division_label')} bleibt, lehnt bis zum Start unter Teams ab.")
    await _tell(db, moved, "Nachgerückt: ein Platz ist frei geworden",
                f"In {target.get('division_label')} von {await _title(db, season)} ist ein Platz frei geworden. "
                f"{moved.get('display_name') or 'Euer Co-Team'} rückt nach. {how}",
                REASONS["fill"], f"league-start-right:fill:{candidate['id']}:{freed['id']}:{now}")
    return moved


async def _fill_by_rule(db, season: dict, freed: dict | None, ctx: dict | None = None) -> dict | None:
    """Nachrücken nach der Regel der Season (``successor: "next"``) - nur vor dem Start und bei abgeschlossenem Vorgänger."""
    from services import league_successor

    settings = stored(season)
    if not settings or settings["successor"] != NEXT or not freed or not _is_free(freed) or league_successor.started(season):
        return None
    ctx = ctx or await _context(db, season)
    if ctx["paused"] or not ctx["predecessor"]:
        return None
    found = await _suggest(db, season, freed, ctx)
    if not found["pick"]:
        return None
    return await _fill(db, season, freed, found["rows"][found["pick"]], group=found["group"], actor_id=None, reason=None)


async def released(db, season: dict, application: dict) -> dict | None:
    """Nach dem Abmelden eines übernommenen Antrags, unter der Season-Sperre: ``league_applications.withdraw`` ruft das auf
    (``on_released``, von der Route mitgegeben) - nach der Regel der Season rückt jemand nach. Die Absage selbst
    (``start_right.status: "declined"``) schreibt das Abmelden. Ohne die Einstellung der Season geschieht nichts."""
    if not (application or {}).get("carry_over") or not stored(season):
        return None
    return await _fill_by_rule(db, season, await _application(db, application["id"]))


async def _restore(db, season: dict, application: dict, why: str, actor_id: str | None) -> dict | None:
    """Der Nachrücker fällt auf sein früheres Startrecht zurück (``fills.back``) und wird für diesen Platz nicht noch einmal gefragt.
    Gibt den wieder frei gewordenen Antrag zurück - ``None``, wenn sich inzwischen etwas geändert hat."""
    fills = application["carry_over"]["fills"]
    back = fills.get("back") or {}
    kept = isinstance(back.get("start_right"), dict)
    now = now_utc().isoformat()
    update: dict = {
        "$set": {"carry_over.division_id": back.get("division_id"), "carry_over.division_level": back.get("division_level"),
                 "carry_over.division_label": back.get("division_label"), "carry_over.movement": back.get("movement"), "updated_at": now,
                 **({"carry_over.start_right": back["start_right"]} if kept else {})},
        "$unset": {"carry_over.fills": "", **({} if kept else {"carry_over.start_right": ""})},
        "$addToSet": {"carry_over.passed": fills.get("for_application_id")},
        "$push": {"history": {"status": "accepted", "by": actor_id, "at": now, "start_right": "passed", "reason": WHY_TEXT.get(why, why)}}}
    written = await db.league_applications.update_one(
        {"id": application["id"], "status": "accepted", "assignment": {"$exists": False},
         "carry_over.fills.for_application_id": fills.get("for_application_id")}, update)
    if not written.modified_count:
        return None
    await db.league_applications.update_one({"id": fills.get("for_application_id"), "carry_over.filled_by.application_id": application["id"]},
                                            {"$unset": {"carry_over.filled_by": ""}})
    await _audit(db, "pass", season["id"], actor_id, application_id=application["id"], squad_id=application.get("squad_id"),
                 for_application_id=fills.get("for_application_id"), why=why)
    return await db.league_applications.find_one({"id": fills.get("for_application_id")}, {"_id": 0})


async def decline(db, application_id: str, user: dict) -> dict:
    """Captain oder Vertreter lehnt das Nachrücken ab: zurück auf das frühere Startrecht, der Platz geht an den Nächsten."""
    application = await _own(db, application_id, user)
    async with _Lock(db, application["season_id"]):
        fresh = await _application(db, application_id)
        season = await _season_of(db, fresh["season_id"])
        if not may_pass(fresh, season):
            raise StartRightProblem(NOTHING_TO_PASS, 409)
        freed = await _restore(db, season, fresh, DECLINED, user["id"])
        if freed is None:
            raise StartRightProblem(NOT_OPEN, 409)
        await _fill_by_rule(db, season, freed)
        return await _application(db, application_id)


async def fill(db, season: dict, application_id: str, candidate_id: str | None, actor: dict, reason: str | None,
               conflict_reason: str | None = None) -> dict:
    """Die Leitung löst das Nachrücken aus (Regel ``lead``, Gleichstand, Ablehnung durch die Leitung): mit Grund, nur ein
    vorgeschlagener Kandidat, nie für das eigene Team."""
    from services import league_successor
    from services.league_permissions import record_override, require_no_side_conflict, side_of

    reason = " ".join(str(reason or "").split())
    if len(reason) < REASON_MIN:
        raise StartRightProblem(REASON_SHORT)
    await _application(db, application_id, season["id"])
    candidate = await _application(db, str(candidate_id or ""), season["id"])
    await require_no_side_conflict(db, actor, side_of(candidate), conflict_reason=conflict_reason)
    async with _Lock(db, season["id"]):
        fresh = await _season_of(db, season["id"])
        freed = await _application(db, application_id, season["id"])
        if freed["carry_over"].get("filled_by"):
            raise StartRightProblem(PLACE_TAKEN, 409)
        if not _is_free(freed):
            raise StartRightProblem(NO_PLACE, 409)
        if league_successor.started(fresh):
            raise StartRightProblem(FILL_STARTED, 409)
        ctx = await _context(db, fresh)
        if ctx["paused"]:
            raise StartRightProblem(FILL_PAUSED, 409)
        found = await _suggest(db, fresh, freed, ctx)
        if candidate["id"] not in found["candidates"]:
            raise StartRightProblem(NOT_A_CANDIDATE)
        override = await require_no_side_conflict(db, actor, side_of(found["rows"][candidate["id"]]), conflict_reason=conflict_reason)
        moved = await _fill(db, fresh, freed, found["rows"][candidate["id"]], group=found["group"], actor_id=actor.get("id"), reason=reason)
        if moved is None:
            raise StartRightProblem(PLACE_TAKEN, 409)
    if override:
        await record_override(db, actor, action="start_right_fill", target_id=season["id"], reason=override, application_id=candidate["id"])
    return moved


# ---------------------------------------------------------------- Fristen-Job

async def _expire(db, season: dict, application: dict) -> dict | None:
    until = accept_until(application, season)
    now = now_utc().isoformat()
    reason = EXPIRED_REASON.format(day=day_text(until))
    written = await db.league_applications.update_one(
        {"id": application["id"], "status": "accepted", "assignment": {"$exists": False}, "carry_over.start_right.status": OFFERED},
        {"$set": {"status": "rejected", "decision_reason": reason, "decided_by": None, "decided_at": now, "updated_at": now,
                  "carry_over.start_right.status": EXPIRED, "carry_over.start_right.closed_at": now},
         "$unset": {"active_key": ""},
         "$push": {"history": {"status": "rejected", "by": None, "at": now, "reason": reason, "start_right": EXPIRED, "auto": True}}})
    if not written.modified_count:
        return None
    done = await _application(db, application["id"])
    await _audit(db, "expire", season["id"], None, application_id=done["id"], squad_id=done.get("squad_id"),
                 division_level=done["carry_over"].get("division_level"))
    await _tell(db, done, "Startrecht verfallen",
                f"Für {done.get('display_name') or 'euer Co-Team'} kam bis {day_text(until)} keine Zusage für {done['carry_over'].get('division_label')} "
                f"in {await _title(db, season)}. Das Startrecht ist verfallen, der Platz ist frei. Mitspielen geht nur noch über eine neue "
                "Anmeldung, solange das Anmeldefenster offen ist.",
                REASONS["expired"], f"league-start-right:expired:{done['id']}:{(right_of(done) or {}).get('offered_at')}")
    return done


def _reminder_due(application: dict, season: dict, settings: dict, now: datetime) -> bool:
    right = right_of(application) or {}
    until = accept_until(application, season)
    hours = int(settings.get("remind_hours") or 0)
    return bool(hours and until and right.get("status") == OFFERED and not right.get("reminded_at")
                and until - timedelta(hours=hours) <= now < until)


async def _remind(db, season: dict, application: dict, now: datetime) -> int:
    written = await db.league_applications.update_one(
        {"id": application["id"], "carry_over.start_right.status": OFFERED, "carry_over.start_right.reminded_at": {"$exists": False}},
        {"$set": {"carry_over.start_right.reminded_at": now.isoformat()}})
    if not written.modified_count:
        return 0
    until = accept_until(application, season)
    await _tell(db, application, "Startrecht: Zusage noch offen",
                f"{application.get('display_name') or 'Euer Co-Team'} hat für {application['carry_over'].get('division_label')} in "
                f"{await _title(db, season)} noch nicht zugesagt. Die Frist endet am {day_text(until)} - danach verfällt das Startrecht. "
                "Zusagen oder abmelden: unter Teams beim Co-Team.",
                REASONS["reminder"], f"league-start-right:remind:{application['id']}:{(right_of(application) or {}).get('offered_at')}")
    return 1


async def _sweep_season(db, season_id: str, now: datetime, out: dict) -> None:
    """Eine Folge-Season unter ihrer Sperre: verfallene Startrechte schließen, Nachrücker zurückfallen lassen, nachrücken, erinnern."""
    season = await _season_of(db, season_id)
    settings = stored(season)
    if not settings:
        return
    rows = await db.league_applications.find({"season_id": season_id, "status": "accepted", "carry_over.start_right.status": OFFERED},
                                             {"_id": 0}).sort("created_at", 1).to_list(1000)
    due = [row for row in rows if overdue(row, season, now) or _reminder_due(row, season, settings, now)]
    if not due:
        return
    ctx = await _context(db, season)
    if ctx["paused"]:
        # Der Vorgänger ist wieder geöffnet: Der Endstand wird geprüft - nichts verfällt, niemand rückt nach, niemand wird erinnert.
        out["paused"] += 1
        return
    for row in due:
        fresh = await db.league_applications.find_one({"id": row["id"]}, {"_id": 0})
        if not fresh or fresh.get("status") != "accepted" or (right_of(fresh) or {}).get("status") != OFFERED:
            continue
        if not overdue(fresh, season, now):
            out["reminded"] += await _remind(db, season, fresh, now) if _reminder_due(fresh, season, settings, now) else 0
            continue
        successor = isinstance(fresh["carry_over"].get("fills"), dict)
        if successor:
            freed = await _restore(db, season, fresh, EXPIRED, None)
            if freed is None:
                continue
            out["restored"] += 1
            back = (fresh["carry_over"]["fills"].get("back") or {}).get("division_label")
            await _tell(db, fresh, "Nachrücken abgelaufen",
                        f"Für den frei gewordenen Platz in {fresh['carry_over'].get('division_label')} kam keine Zusage. "
                        f"{fresh.get('display_name') or 'Euer Co-Team'} bleibt in {back}.",
                        REASONS["back"], f"league-start-right:back:{fresh['id']}:{fresh['carry_over']['fills'].get('for_application_id')}")
        else:
            freed = await _expire(db, season, fresh)
            if freed is None:
                continue
            out["expired"] += 1
        moved = await _fill_by_rule(db, season, freed, ctx)
        out["filled"] += 1 if moved else 0
        if not successor:
            follow = f"{moved.get('display_name')} rückt nach." if moved else "Der Platz ist frei."
            await _tell_lead(db, season, freed, "Startrecht verfallen",
                             f"{freed.get('display_name')} hat für {freed['carry_over'].get('division_label')} nicht zugesagt. {follow}",
                             f"league-start-right:lead:{freed['id']}:{(right_of(freed) or {}).get('offered_at')}")


async def sweep(db, *, now: datetime | None = None) -> dict:
    """Der Job (alle 15 Minuten): Fristen der Startrechte und liegen gebliebene Nachrichten. Fasst nur Seasons mit der Einstellung
    ``start_rights`` an; jede Season unter ihrer eigenen Sperre, ein Fehler in einer hält die anderen nicht auf."""
    now = now or now_utc()
    out = dict(ZERO)
    async for season in db.league_seasons.find({NOTICES_OPEN: True}, {"_id": 0, "id": 1}):
        try:
            out["announced"] += (await announce(db, season["id"]))["sent"]
        except Exception:  # noqa: BLE001 - die nächste Season kommt trotzdem dran
            logger.warning("[liga] Startrechte: Nachricht der Season %s nicht verschickt", log_safe(season.get("id")), exc_info=True)
    seasons = await db.league_seasons.find({FIELD: {"$type": "object"}, "predecessor_id": {"$nin": [None, ""]},
                                            "status": {"$nin": ["completed", "archived"]}}, {"_id": 0, "id": 1}).to_list(500)
    for season in seasons:
        try:
            async with _Lock(db, season["id"], wait_seconds=2.0):
                await _sweep_season(db, season["id"], now, out)
        except StartRightProblem:
            continue  # gerade gesperrt: Der nächste Lauf holt es nach
        except Exception:  # noqa: BLE001 - siehe oben
            logger.warning("[liga] Startrechte der Season %s nicht geprüft", log_safe(season.get("id")), exc_info=True)
    return out


# ---------------------------------------------------------------- Nachricht „Aufstieg bestätigt“

NO_REGISTRATION = {
    ACCEPT: "Das Startrecht ist noch keine Anmeldung: Sobald die neue Season angelegt ist, bekommt ihr eine Nachricht und sagt dort zu.",
    AUTO: ("Das Startrecht ist noch keine Anmeldung: Sobald die neue Season angelegt ist, bekommt ihr eine Nachricht - wer nicht "
           "mitspielen will, meldet sich dann ab."),
}
NO_FACT = "none"


def _fact_text(fact: str, name: str, label: str | None, how: str, corrected: bool, title: str, note: str) -> tuple[str, str]:
    """Titel und Text zu einem bestätigten Stand (``up:1``, ``down:2``, ``stay:2``, ``none``)."""
    move = fact.split(":")[0]
    phrase = {"up": f"steigt auf{how}: Startrecht für {label} in der nächsten Season",
              "down": f"steigt ab{how}: Startrecht für {label} in der nächsten Season",
              "stay": f"bleibt in {label}"}.get(move, "hat kein Startrecht für die nächste Season")
    if corrected:
        return "Endstand korrigiert", f"Die Liga-Leitung hat den Endstand von {title} korrigiert. {name} {phrase}."
    headline = "Aufstieg bestätigt" if move == "up" else "Abstieg bestätigt"
    return headline, f"Der Endstand von {title} steht fest. {name} {phrase}. {note}"


async def announce(db, season_id: str | None) -> dict:
    """Meldet den bestätigten Auf- und Abstieg - nur aus dem gespeicherten Endstand der ganzen Season (samt Playoffs und Relegation),
    je Co-Team und Stand einmal. Die Season merkt sich den zuletzt gemeldeten Stand (``start_right_notices``): Ein Wiederöffnen mit
    gleichem Ergebnis meldet nichts, ein geändertes einmal „Endstand korrigiert“. Aufgerufen nach jedem Abschluss und vom Job."""
    from services import league_successor
    from services.league_applications import _responsible
    from services.league_mail import send_league_mail
    from services.user_notifications import create_user_notification

    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0}) if season_id else None
    settings = stored(season)
    if not settings or not settings["announce"]:
        return {"sent": 0}
    checked = await league_successor.plan(db, season)
    if checked["problems"]:
        return {"sent": 0}
    facts = {team["squad_id"]: (f"{team['movement']}:{division['level']}", team, division["label"])
             for division in checked["divisions"] for team in division["teams"]}
    ledger = season.get(NOTICES) if isinstance(season.get(NOTICES), dict) else {}
    # Wer vorher eine Nachricht bekam und jetzt gar nicht mehr dabei ist (etwa disqualifiziert), erfährt auch das.
    facts.update({squad_id: (NO_FACT, {"squad_id": squad_id, "display_name": last.get("name")}, None)
                  for squad_id, last in ledger.items() if squad_id not in facts and last.get("fact") != NO_FACT})
    now = now_utc().isoformat()
    todo = []
    for squad_id, (fact, team, label) in facts.items():
        last = ledger.get(squad_id)
        if last and last.get("fact") == fact:
            if not last.get("sent_at"):
                todo.append((squad_id, fact, team, label, last, bool(last.get("corrected"))))
            continue
        if not last and not fact.startswith(("up:", "down:")):
            continue  # wer bleibt, bekommt keine Nachricht
        entry = {"fact": fact, "seq": int((last or {}).get("seq") or 0) + 1, "at": now, "name": team.get("display_name"),
                 **({"corrected": True} if last else {})}
        # Den Stand gewinnt, wer ihn zuerst einträgt - zwei gleichzeitige Läufe melden nicht doppelt.
        claimed = await db.league_seasons.update_one({"id": season_id, f"{NOTICES}.{squad_id}.fact": {"$ne": fact}},
                                                     {"$set": {f"{NOTICES}.{squad_id}": entry, NOTICES_OPEN: True}})
        if claimed.modified_count:
            todo.append((squad_id, fact, team, label, entry, bool(last)))
    league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "name": 1, "slug": 1}) or {}
    title = " ".join(part for part in (league.get("name"), season.get("name")) if part)
    url = f"/liga/{league.get('slug')}/{season.get('slug')}" if league.get("slug") and season.get("slug") else "/teams"
    sent = 0
    for squad_id, fact, team, label, entry, corrected in todo:
        how = " über die Relegation" if team.get("via") == "relegation" else ""
        headline, text = _fact_text(fact, team.get("display_name") or "Euer Co-Team", label, how, corrected, title, NO_REGISTRATION[settings["mode"]])
        try:
            squad = await db.team_squads.find_one({"id": squad_id}, {"_id": 0})
            for user_id in sorted(await _responsible(db, squad)) if squad else []:
                key = f"league-start-right:{season_id}:{squad_id}:{entry['seq']}:{user_id}"
                if await create_user_notification(user_id, headline, text, url=url, kind=KIND, meta={
                        "reason": REASONS["announce"], "season_id": season_id, "dedupe_key": key, "unique_dedupe": True}):
                    sent += 1
                await send_league_mail(db, user_id, headline, text, url, f"{key}:mail")
            await db.league_seasons.update_one({"id": season_id, f"{NOTICES}.{squad_id}.seq": entry["seq"]},
                                               {"$set": {f"{NOTICES}.{squad_id}.sent_at": now_utc().isoformat()}})
        except Exception:  # noqa: BLE001 - der Job holt es nach (``start_right_notices_open``)
            logger.warning("[liga] Nachricht zum bestätigten Startrecht nicht verschickt: %s", log_safe(squad_id), exc_info=True)
    fresh = await db.league_seasons.find_one({"id": season_id}, {"_id": 0, NOTICES: 1, NOTICES_OPEN: 1}) or {}
    waiting = [key for key, row in (fresh.get(NOTICES) or {}).items() if not row.get("sent_at")]
    if fresh.get(NOTICES_OPEN) and not waiting:
        await db.league_seasons.update_one({"id": season_id}, {"$set": {NOTICES_OPEN: False}})
    if sent:
        await _audit(db, "announce", season_id, None, sent=sent, teams=len(todo), stamp=checked.get("stamp"))
    return {"sent": sent}


# ---------------------------------------------------------------- Einstellung speichern

async def save_settings(db, season: dict, body: dict, actor: dict) -> dict | None:
    """Speichert die Einstellung (``active: false`` nimmt sie weg). Braucht nach dem Speichern niemand mehr eine Zusage (Modus
    ``auto`` oder ausgeschaltet), gelten offene Startrechte als zugesagt - niemand verliert seinen Platz durch das Umschalten."""
    before = stored(season)
    fields = {key: value for key, value in body.items() if key in DEFAULTS and value is not None}
    rules = normalize({**(before or {}), **fields}) if body.get("active", True) else None
    async with _Lock(db, season["id"]):
        now = now_utc().isoformat()
        if rules is None:
            await db.league_seasons.update_one({"id": season["id"]}, {"$unset": {FIELD: ""}, "$set": {"updated_at": now}})
        elif rules != before or not isinstance(season.get(FIELD), dict):
            await db.league_seasons.update_one({"id": season["id"]}, {"$set": {FIELD: rules, "updated_at": now}})
        accepted = 0
        if (rules or {}).get("mode") != ACCEPT:
            done = await db.league_applications.update_many(
                {"season_id": season["id"], "status": "accepted", "carry_over.start_right.status": OFFERED},
                {"$set": {"carry_over.start_right.status": ACCEPTED, "carry_over.start_right.accepted_at": now,
                          "carry_over.start_right.accepted_by": actor.get("id"), "carry_over.start_right.accepted_via": "mode", "updated_at": now},
                 "$push": {"history": {"status": "accepted", "by": actor.get("id"), "at": now, "start_right": ACCEPTED, "via": "mode"}}})
            accepted = done.modified_count
    if rules != before:
        await db.audit_logs.insert_one({"id": new_id(), "action": "league.season.start_rights", "target_id": season["id"],
                                        "actor_id": actor.get("id"), "data": {"from": before, "to": rules, "accepted": accepted},
                                        "created_at": now_utc().isoformat()})
    return rules


# ---------------------------------------------------------------- Lesen: Verwaltung

def _row(application: dict, season: dict, names: dict[str, str], own_team: bool, now: datetime) -> dict:
    carry = application["carry_over"]
    right = right_of(application) or {}
    until = accept_until(application, season)
    fills = carry.get("fills") if isinstance(carry.get("fills"), dict) else None
    return {
        "application_id": application["id"], "squad_id": application.get("squad_id"), "display_name": application.get("display_name"),
        "division_level": carry.get("division_level"), "division_label": carry.get("division_label"), "movement": carry.get("movement"),
        "from_label": carry.get("from_label"), "from_staffel": carry.get("from_staffel"), "rank": carry.get("rank"), "via": carry.get("via"),
        "state": state(application, season, now),
        "accept_until": until.isoformat() if until and right.get("status") == OFFERED else None,
        "accepted_at": right.get("accepted_at"), "accepted_via": right.get("accepted_via"), "accept_reason": right.get("accept_reason"),
        "accepted_by_name": names.get(right.get("accepted_by") or ""),
        "staffel": (application.get("assignment") or {}).get("label"),
        "fills": ({"for_name": fills.get("for_name"), "why": fills.get("why"), "reason": fills.get("reason"), "at": fills.get("at"),
                   "by": fills.get("by"), "by_name": names.get(fills.get("by") or ""), "group": fills.get("group"),
                   "back_label": (fills.get("back") or {}).get("division_label")} if fills else None),
        "filled_by": ({"application_id": carry["filled_by"].get("application_id"), "display_name": carry["filled_by"].get("display_name"),
                       "at": carry["filled_by"].get("at")} if isinstance(carry.get("filled_by"), dict) else None),
        "own_team": own_team,
    }


async def overview(db, season: dict, user: dict, *, now: datetime | None = None) -> dict:
    """Die Übersicht der Verwaltung: Einstellung, je übernommenem Co-Team der Stand mit Frist, frei gewordene Plätze mit Vorschlag."""
    from services import league_successor
    from services.league_applications import _names
    from services.league_permissions import belongs_to_side, is_superadmin, side_of
    from services.match_audience import teams_by_id

    now = now or now_utc()
    settings = stored(season)
    out: dict = {"active": settings is not None, "settings": settings, "defaults": defaults(), "predecessor": None, "paused": False,
                 "started": league_successor.started(season), "superadmin": is_superadmin(user), "counts": {}, "rows": [], "open_places": []}
    if not season.get("predecessor_id"):
        return out
    rows = await db.league_applications.find({"season_id": season["id"], "carry_over": {"$exists": True}}, {"_id": 0}).to_list(1000)
    ctx = await _context(db, season)
    if ctx["predecessor"]:
        out["predecessor"] = {"id": ctx["predecessor"]["id"], "name": ctx["predecessor"].get("name")}
    out["paused"] = ctx["paused"]
    people = {(right_of(row) or {}).get("accepted_by") for row in rows} | {(row["carry_over"].get("fills") or {}).get("by") for row in rows}
    names = await _names(db, {uid for uid in people if uid})
    sides = {row["id"]: side_of(row) for row in rows}
    side_teams = await teams_by_id(db, sides.values())
    rows.sort(key=lambda row: (row["carry_over"].get("division_level") or 99, row["carry_over"].get("from_level") or 99,
                               str(row["carry_over"].get("from_staffel") or ""), int(row["carry_over"].get("rank") or 0)))
    for row in rows:
        entry = _row(row, season, names, belongs_to_side(user, sides[row["id"]], side_teams.get(row["team_id"])), now)
        out["rows"].append(entry)
        out["counts"][entry["state"]] = out["counts"].get(entry["state"], 0) + 1
    if settings is None:
        return out
    by_id = {row["id"]: row for row in rows}
    for row in rows:
        if not _is_free(row):
            continue
        found = await _suggest(db, season, row, ctx) if not ctx["paused"] else {"group": None, "candidates": [], "pick": None, "tied": []}
        out["open_places"].append({
            "application_id": row["id"], "display_name": row.get("display_name"), "division_label": row["carry_over"].get("division_label"),
            "division_level": row["carry_over"].get("division_level"), "why": _why(row), "group": found["group"], "pick": found["pick"],
            "tied": found["tied"],
            "candidates": [{"application_id": key, "display_name": by_id[key].get("display_name"),
                            "from_label": by_id[key]["carry_over"].get("division_label"), "from_staffel": by_id[key]["carry_over"].get("from_staffel"),
                            "rank": by_id[key]["carry_over"].get("rank"),
                            "own_team": belongs_to_side(user, sides[key], side_teams.get(by_id[key]["team_id"]))}
                           for key in found["candidates"] if key in by_id]})
    return out


async def row_of(db, season: dict, application_id: str, user: dict) -> dict:
    """Eine Zeile der Übersicht - die Antwort nach „Zusage eintragen“ und „Nachrücken“."""
    found = await overview(db, season, user)
    row = next((item for item in found["rows"] if item["application_id"] == application_id), None)
    if row is None:
        raise StartRightProblem(GONE, 404)
    return row


# ---------------------------------------------------------------- Lesen: das eigene Team vor der Folge-Season

MOVE_OF_ZONE = {"promotion": "up", "relegation": "down"}


async def outlook(db, user: dict) -> list[dict]:
    """Für die Team-Seite: Prognose (``forecast``, aus der laufenden Tabelle) bzw. bestätigtes Startrecht (``confirmed``, aus dem
    gespeicherten Endstand) der eigenen Co-Teams - nur für Seasons mit der Einstellung ``start_rights``, die die Person sehen darf und
    aus denen es noch keine Folge-Season gibt (danach steht das Startrecht am Antrag)."""
    from services import league_current, league_service, league_successor, league_zones
    from services.league_applications import _own_squads
    from services.league_scope import ONLY_LEAGUE, REGULAR_ONLY

    squads, _teams = await _own_squads(db, user)
    squad_ids = sorted(row["id"] for row in squads)
    if not squad_ids:
        return []
    registrations = await db.tournament_registrations.find(
        {"squad_id": {"$in": squad_ids}, "status": {"$in": ["approved", "checked_in"]}},
        {"_id": 0, "id": 1, "tournament_id": 1, "squad_id": 1}).to_list(500)
    if not registrations:
        return []
    tournaments = await db.tournaments.find({"id": {"$in": sorted({row["tournament_id"] for row in registrations})}, **ONLY_LEAGUE, **REGULAR_ONLY},
                                            {"_id": 0}).to_list(200)
    by_season: dict[str, list[dict]] = {}
    for row in tournaments:
        by_season.setdefault((row.get("league_context") or {}).get("season_id"), []).append(row)
    seasons = await db.league_seasons.find({"id": {"$in": sorted(key for key in by_season if key)}, FIELD: {"$type": "object"},
                                            "status": {"$ne": "archived"}}, {"_id": 0}).to_list(50)
    out = []
    for season in seasons:
        if not stored(season) or not await league_service.can_see_season(user, season):
            continue
        if await db.league_seasons.find_one({"predecessor_id": season["id"]}, {"_id": 1}):
            continue
        league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "name": 1, "slug": 1}) or {}
        base = {"season_id": season["id"], "title": " ".join(part for part in (league.get("name"), season.get("name")) if part),
                "url": f"/liga/{league.get('slug')}/{season.get('slug')}" if league.get("slug") and season.get("slug") else None}
        checked = await league_successor.plan(db, season)
        planned = {team["squad_id"]: (team, division["label"]) for division in checked["divisions"] for team in division["teams"]}
        mine = [row for row in registrations if row["tournament_id"] in {item["id"] for item in by_season[season["id"]]}]
        if not checked["problems"]:
            for squad_id in sorted({row["squad_id"] for row in mine} & set(planned)):
                team, label = planned[squad_id]
                out.append({**base, "squad_id": squad_id, "state": CONFIRMED, "movement": team["movement"], "division_label": label,
                            "zone_label": team.get("zone_label"), "rank": team.get("rank")})
            continue
        # Noch nicht bestätigt: die Zone der laufenden bzw. der schon abgeschlossenen eigenen Staffel - nur Anzeige.
        places = await league_current.live_places(db, [row for row in by_season[season["id"]] if not row.get("final_table")],
                                                  [row["id"] for row in mine])
        for row in mine:
            if row["id"] in places:
                place = places[row["id"]]
                out.append({**base, "squad_id": row["squad_id"], "state": FORECAST, "movement": MOVE_OF_ZONE.get(place.get("zone") or "", "stay"),
                            "division_label": None, "zone_label": place.get("zone_label"), "rank": place.get("rank")})
            elif row["squad_id"] in planned:
                team = planned[row["squad_id"]][0]
                out.append({**base, "squad_id": row["squad_id"], "state": FORECAST, "movement": MOVE_OF_ZONE.get(team.get("zone") or "", "stay"),
                            "division_label": None, "zone_label": league_zones.LABELS.get(team.get("zone") or ""), "rank": team.get("rank")})
    return out
