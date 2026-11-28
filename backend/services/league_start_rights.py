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
from datetime import datetime

from models import new_id, now_utc
from services.league_start_right_rules import (
    ACCEPT, ACCEPTED, AUTO, CONFIRMED, DECLINED, DEFAULTS, EXPIRED, FIELD, FORECAST, NEXT, NOTICES, NOTICES_OPEN, OFFERED, PAUSE_LIMIT,
    PAUSES, REASON_MIN, StartRightProblem, accept_until, candidates, day_text, defaults, may_pass, needs_accept, normalize, offer,
    open_pause, overdue, pauses, remind_at, resting, restored_right, right_of, start_reached, state, stored, waits_for_lead,
)
from services import league_calendar, league_participants
from services.log_safe import log_safe

logger = logging.getLogger("tls.league_start_rights")

__all__ = ["StartRightProblem", "accept", "accept_for", "after_final_change", "announce", "decline", "defaults", "fill", "fill_places",
           "outlook", "overview", "released", "row_of", "save_settings", "sweep"]


# ---------------------------------------------------------------- Texte

BUSY = "An dieser Season wird gerade etwas geändert. Bitte gleich noch einmal versuchen."
GONE = "Dieses Startrecht gibt es nicht."
NO_RIGHT = "Für dieses Co-Team gibt es kein Startrecht, das eine Zusage braucht."
NOT_OPEN = "Dieses Startrecht ist nicht mehr offen. Bitte neu laden."
LATE = "Die Frist für die Zusage ist am {day} abgelaufen. Jetzt hilft nur eine neue Anmeldung oder die Liga-Leitung."
LATE_STARTED = "Die Frist für die Zusage ist vorbei, und die Season hat ihr Startdatum erreicht. Jetzt entscheidet die Liga-Leitung."
CONFIRM_OPEN_ONE = "1 offenes Startrecht gilt dann als zugesagt und braucht keine Zusage mehr. Bitte bestätigen."
CONFIRM_OPEN_MANY = "{count} offene Startrechte gelten dann als zugesagt und brauchen keine Zusage mehr. Bitte bestätigen."
NOT_RESPONSIBLE = "Zusagen und ablehnen dürfen nur Captain und Vertreter des Co-Teams."
NOTHING_TO_PASS = "Hier gibt es nichts abzulehnen. Wer nicht mitspielen will, meldet sich ab."
REASON_SHORT = f"Bitte einen Grund angeben (mindestens {REASON_MIN} Zeichen)."
EXPIRED_REASON = "Startrecht verfallen: bis {day} keine Zusage."
NO_PLACE = "Für diesen Antrag ist kein Platz frei geworden."
NO_PLACE_NOW = "Nach dem korrigierten Endstand gibt es diesen Platz nicht mehr. Bitte zuerst „Übernahme neu berechnen“."
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
        url = f"/admin/leagues/seasons/{season['id']}#startrechte"
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

async def _accept(db, application_id: str, actor_id: str | None, via: str, *, reason: str | None = None) -> dict:
    """Die Zusage unter der Season-Sperre, mit Bedingung auf den offenen Stand. Ein zweiter Aufruf antwortet mit ``replay``.
    Die Frist gilt für Team und Leitung. Ist das Startdatum der Season erreicht, verfällt nichts mehr von selbst: Dann - und nur
    dann - trägt die Leitung die Zusage auch nach Fristende ein (Entscheidung 26.11.)."""
    application = await _application(db, application_id)
    right = right_of(application)
    if not right:
        raise StartRightProblem(NO_RIGHT, 409)
    if right.get("status") == ACCEPTED and application.get("status") == "accepted":
        return {**application, "replay": True}
    season = await _season_of(db, application.get("season_id"))
    if application.get("status") != "accepted" or right.get("status") != OFFERED:
        raise StartRightProblem(NOT_OPEN, 409)
    if overdue(application, season) and not (via == "lead" and start_reached(season)):
        raise StartRightProblem(LATE_STARTED if start_reached(season) else LATE.format(day=day_text(accept_until(application, season))), 409)
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
        done = await _accept(db, application_id, actor.get("id"), "lead", reason=reason)
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
        return {"predecessor": None, "paused": False, "levels": [], "table": {}, "placed": {}}
    checked = await league_successor.plan(db, predecessor)
    divisions = await db.league_divisions.find({"season_id": season["id"], "status": {"$ne": "archived"}}, {"_id": 0, "level": 1}).to_list(50)
    return {"predecessor": predecessor, "paused": bool(checked["problems"]),
            "levels": sorted(row["level"] for row in divisions if isinstance(row.get("level"), int)),
            "table": {team["squad_id"]: team for division in checked["divisions"] for team in division["teams"]},
            # Wo der Endstand jedes Co-Team sieht - auch eines, das es nicht mehr gibt: Daran hängt, ob ein Platz besteht.
            "placed": league_successor.placed_levels(checked)}


def _why(freed: dict) -> str:
    if (right_of(freed) or {}).get("status") == EXPIRED:
        return EXPIRED
    return DECLINED if freed.get("status") == "withdrawn" else "rejected"


def _gave_up(application: dict) -> bool:
    """Der Antrag hat seinen Platz aufgegeben: abgemeldet, verfallen oder abgelehnt - nicht zurückgenommen (Nr. 162)."""
    carry = application.get("carry_over") or {}
    return (application.get("status") in ("withdrawn", "rejected") and not carry.get("revoked_at")
            and isinstance(carry.get("division_level"), int))


def _still_exists(application: dict, ctx: dict) -> bool:
    """Den Platz gibt es nur, solange der bestätigte Endstand des Vorgängers dieses Co-Team in genau dieser Liga N sieht (Nr. 162,
    Entscheidung 26.11.). Sagt der korrigierte Endstand etwas anderes - das Co-Team steigt doch nicht auf, ist ausgeschieden -,
    entfällt der Platz ganz: Sonst stiege für ihn jemand zusätzlich auf. Das gilt auch für einen abgemeldeten Nachrücker: Sein
    Antrag steht in der Liga des Platzes, auf den er nachgerückt war - frei wird dann jener Platz, nicht ein zweiter. Es zählt die
    Platzierung im Endstand (``placed``), nicht ob es das Co-Team noch gibt: Löscht ein Abgemeldeter sein Co-Team, bleibt der Platz."""
    level = (application.get("carry_over") or {}).get("division_level")
    return isinstance(level, int) and ctx["placed"].get(application.get("squad_id")) == level


def _corrected_away(application: dict, ctx: dict) -> bool:
    """Gibt es den Platz nicht, **weil der Endstand korrigiert wurde**? Nur dann, wenn der Endstand das Co-Team jetzt in einer
    anderen Liga N sieht als der Antrag - und der Antrag seine Liga aus dem Endstand hat, nicht vom Nachrücken (``fills``)."""
    carry = application.get("carry_over") or {}
    return application.get("squad_id") in ctx["placed"] and not _still_exists(application, ctx) and not isinstance(carry.get("fills"), dict)


def _holds(holder: dict | None, application: dict) -> bool:
    """Hält ``holder`` den frei gewordenen Platz noch? Nur solange er angenommen ist und als Nachrücker auf genau diesem Platz steht.
    Ein Nachrücker, der sich abgemeldet hat, abgelehnt oder zurückgenommen wurde oder inzwischen aus eigenem Recht woanders steht,
    hält nichts mehr - der Platz ist wieder frei."""
    fills = ((holder or {}).get("carry_over") or {}).get("fills")
    return bool(holder) and holder.get("status") == "accepted" and isinstance(fills, dict) and fills.get("for_application_id") == application["id"]


def _is_free(application: dict, ctx: dict, holder: dict | None) -> bool:
    """Ein frei gewordener Platz: aufgegeben, nach dem Endstand noch vorhanden und von niemandem gehalten. Solange der Vorgänger
    wieder geöffnet ist (``paused``), steht der Endstand nicht fest - dann bleibt der Platz stehen, bis neu abgeschlossen ist."""
    return _gave_up(application) and (ctx["paused"] or _still_exists(application, ctx)) and not _holds(holder, application)


async def _open_place(db, freed: dict, ctx: dict) -> dict | None:
    """Der Antrag, wenn sein Platz frei ist (``_is_free``) - sonst ``None``. Unter der Season-Sperre: Eine Vergabe, die niemand mehr
    hält (``filled_by`` zeigt auf einen früheren Nachrücker), wird dabei weggeräumt, damit der Platz neu vergeben werden kann."""
    claim = freed["carry_over"].get("filled_by")
    claim_id = claim.get("application_id") if isinstance(claim, dict) else None
    holder = await db.league_applications.find_one({"id": claim_id}, {"_id": 0, "id": 1, "status": 1, "carry_over.fills": 1}) if claim_id else None
    if not _is_free(freed, ctx, holder):
        return None
    if "filled_by" not in freed["carry_over"]:
        return freed
    await db.league_applications.update_one({"id": freed["id"], "carry_over.filled_by.application_id": claim_id},
                                            {"$unset": {"carry_over.filled_by": ""}})
    return await db.league_applications.find_one({"id": freed["id"]}, {"_id": 0})


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
                       "score_diff": table.get("score_diff"), "passed": carry.get("passed") or [], "fills": bool(carry.get("fills")),
                       # Nachrücken kann nur, wer zugesagt hat oder dessen eigene Frist noch läuft (Entscheidung 26.11.).
                       "overdue": overdue(row, season)})
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
    home = own.get("division_label")
    if not right_of(moved):
        how = f"Ihr seid automatisch dabei. Wer lieber in {home} bleibt, lehnt bis zum Start unter Teams ab."
    elif (own.get("start_right") or {}).get("status") == OFFERED:
        # Die eigene Zusage ist noch offen (Entscheidung 26.11.): Ihre Frist ruht, solange dieses Angebot offen ist.
        rest = int((stored(season) or DEFAULTS)["rest_days"])
        how = (f"Bitte bis {day_text(until)} zusagen oder ablehnen: unter Teams beim Co-Team. Eure Frist für {home} ruht so lange. "
               f"Lehnt ihr ab, gilt das als Zusage für {home}. Ohne Antwort bleibt ihr in {home} und habt dort noch die restliche Frist "
               f"für die Zusage, mindestens {rest} {'Tag' if rest == 1 else 'Tage'}.")
    else:
        how = (f"Bitte bis {day_text(until)} zusagen oder ablehnen: unter Teams beim Co-Team. Ohne Antwort bleibt ihr in {home} - "
               "eure Zusage dort gilt weiter.")
    await _tell(db, moved, "Nachgerückt: ein Platz ist frei geworden",
                f"In {target.get('division_label')} von {await _title(db, season)} ist ein Platz frei geworden. "
                f"{moved.get('display_name') or 'Euer Co-Team'} rückt nach. {how}",
                REASONS["fill"], f"league-start-right:fill:{candidate['id']}:{freed['id']}:{now}")
    return moved


async def _fill_by_rule(db, season: dict, freed: dict | None, ctx: dict | None = None) -> dict | None:
    """Nachrücken nach der Regel der Season (``successor: "next"``) - nur solange das Startdatum nicht erreicht ist (auch im Entwurf,
    Entscheidung 26.11.: Sonst bekäme der Nachrücker eine Frist, die schon vorbei ist) und bei abgeschlossenem Vorgänger."""
    settings = stored(season)
    if not settings or settings["successor"] != NEXT or not freed or not _gave_up(freed) or start_reached(season):
        return None
    ctx = ctx or await _context(db, season)
    if ctx["paused"] or not ctx["predecessor"]:
        return None
    freed = await _open_place(db, freed, ctx)
    if not freed:
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
    fresh = await _application(db, application["id"])
    fills = fresh["carry_over"].get("fills")
    if isinstance(fills, dict):
        # Ein Nachrücker meldet sich ab: Frei wird der Platz, auf den er nachgerückt war - nicht ein zweiter (``_still_exists``).
        await db.league_applications.update_one({"id": fills.get("for_application_id"), "carry_over.filled_by.application_id": fresh["id"]},
                                                {"$unset": {"carry_over.filled_by": ""}})
        fresh = await db.league_applications.find_one({"id": fills.get("for_application_id"), "season_id": season["id"]}, {"_id": 0})
    return await _fill_by_rule(db, season, fresh)


async def _restore(db, season: dict, application: dict, why: str, actor_id: str | None) -> dict | None:
    """Der Nachrücker fällt auf sein früheres Startrecht zurück (``fills.back``) und wird für diesen Platz nicht noch einmal gefragt.
    Solange das Angebot offen war, ruhte seine eigene Frist (``restored_right``, Entscheidung 26.11.): Lehnt er ausdrücklich ab
    (``why: declined``), gilt das als Zusage für die eigene Liga; schweigt er, hat er dort die restliche Frist, mindestens
    ``rest_days``. Gibt den wieder frei gewordenen Antrag zurück - ``None``, wenn sich inzwischen etwas geändert hat."""
    fills = application["carry_over"]["fills"]
    back = fills.get("back") or {}
    moment = now_utc()
    now = moment.isoformat()
    own = restored_right(fills, season, moment, actor_id, declined=why == DECLINED)
    kept = own is not None
    said_yes = kept and why == DECLINED and (back.get("start_right") or {}).get("status") == OFFERED and own.get("status") == ACCEPTED
    update: dict = {
        "$set": {"carry_over.division_id": back.get("division_id"), "carry_over.division_level": back.get("division_level"),
                 "carry_over.division_label": back.get("division_label"), "carry_over.movement": back.get("movement"), "updated_at": now,
                 **({"carry_over.start_right": own} if kept else {})},
        "$unset": {"carry_over.fills": "", **({} if kept else {"carry_over.start_right": ""})},
        "$addToSet": {"carry_over.passed": fills.get("for_application_id")},
        "$push": {"history": {"status": "accepted", "by": actor_id, "at": now, "start_right": "passed", "reason": WHY_TEXT.get(why, why),
                              # Ausdrücklich abgelehnt: zugleich die Zusage für die eigene Liga.
                              **({"accepted": True} if said_yes else {})}}}
    written = await db.league_applications.update_one(
        {"id": application["id"], "status": "accepted", "assignment": {"$exists": False},
         "carry_over.fills.for_application_id": fills.get("for_application_id")}, update)
    if not written.modified_count:
        return None
    await db.league_applications.update_one({"id": fills.get("for_application_id"), "carry_over.filled_by.application_id": application["id"]},
                                            {"$unset": {"carry_over.filled_by": ""}})
    await _audit(db, "pass", season["id"], actor_id, application_id=application["id"], squad_id=application.get("squad_id"),
                 for_application_id=fills.get("for_application_id"), why=why, **({"accepted": True} if said_yes else {}))
    return await db.league_applications.find_one({"id": fills.get("for_application_id")}, {"_id": 0})


async def fill_places(db, season_id: str, application_ids: list[str]) -> int:
    """Plätze, die „Übernahme neu berechnen“ wieder frei gemacht hat, weil es einen Nachrücker zurücknahm oder in eine andere
    Liga N schickte (Entscheidung 26.11.): Für jeden gilt die Nachrückerregel der Season - ``next`` rückt sofort nach, sonst steht
    der Platz wieder unter ``open_places``. Nur Plätze, die es nach dem korrigierten Endstand noch gibt (``_still_exists``).
    Die Route ruft das nach dem Neuberechnen auf (kein Import von ``league_successor`` hierher)."""
    moved = 0
    async with _Lock(db, season_id):
        season = await _season_of(db, season_id)
        for application_id in application_ids:
            freed = await db.league_applications.find_one({"id": application_id, "season_id": season_id}, {"_id": 0})
            moved += 1 if await _fill_by_rule(db, season, freed) else 0
    return moved


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
        if not _gave_up(freed):
            raise StartRightProblem(NO_PLACE, 409)
        if start_reached(fresh):
            raise StartRightProblem(FILL_STARTED, 409)
        ctx = await _context(db, fresh)
        if ctx["paused"]:
            raise StartRightProblem(FILL_PAUSED, 409)
        if not _still_exists(freed, ctx):
            raise StartRightProblem(NO_PLACE_NOW if _corrected_away(freed, ctx) else NO_PLACE, 409)
        freed = await _open_place(db, freed, ctx)
        if not freed:
            raise StartRightProblem(PLACE_TAKEN, 409)
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
    """Ist die Erinnerung fällig? ``remind_at`` kappt sie auf die Frist: nie in ihrer ersten Hälfte."""
    until = accept_until(application, season)
    when = remind_at(application, season, settings)
    return bool(when and until and not (right_of(application) or {}).get("reminded_at") and when <= now < until)


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


async def _paused_since(db, season: dict, now: datetime) -> datetime:
    """Seit wann der Endstand des Vorgängers nicht mehr steht, wenn der Schritt in der Route fehlte (etwa durch einen Absturz) und
    erst der Job die Pause bemerkt: das jüngste Wiederöffnen einer noch offenen Staffel des Vorgängers - soweit bekannt und nicht
    vor dem Ende der letzten Pause. Sonst jetzt."""
    open_ids = [row["id"] async for row in db.tournaments.find({"league_context.season_id": season.get("predecessor_id"), "final_table": None},
                                                               {"_id": 0, "id": 1})]
    rows = await db.league_final_tables.find({"tournament_id": {"$in": open_ids}, "reopened_at": {"$nin": [None, ""]}},
                                             {"_id": 0, "reopened_at": 1}).sort("reopened_at", -1).to_list(1) if open_ids else []
    found = league_calendar.aware(rows[0].get("reopened_at")) if rows else None
    last_end = max((end for _begin, end in pauses(season) if end), default=None)
    if found and found <= now and (last_end is None or found >= last_end):
        return found
    return now


async def _sync_pause(db, season: dict, paused: bool, now: datetime) -> dict:
    """Hält an der Folge-Season fest, seit wann die Fristen ruhen bzw. dass sie wieder laufen (``start_right_pauses``,
    Entscheidung 26.11.): Solange der Vorgänger wieder geöffnet ist, steht jede laufende Frist still und ist danach um die Dauer
    der Pause länger. Schreibt nur bei einem Wechsel, mit Bedingung auf den gelesenen Stand - zwei gleichzeitige Aufrufe öffnen nie
    zwei Pausen. Gibt die Season mit dem geltenden Stand zurück."""
    current = season.get(PAUSES) if isinstance(season.get(PAUSES), list) else []
    if paused == open_pause(season):
        return season
    stamp = now.isoformat()
    if paused:
        fresh = [*current, {"from": stamp, "to": None}][-PAUSE_LIMIT:]
    else:
        fresh = [{**row, "to": stamp} if isinstance(row, dict) and not row.get("to") else row for row in current]
    query = {"id": season["id"], PAUSES: current} if current else {"id": season["id"], "$or": [{PAUSES: {"$exists": False}}, {PAUSES: []}]}
    await db.league_seasons.update_one(query, {"$set": {PAUSES: fresh}})
    return await _season_of(db, season["id"])


async def after_final_change(db, season_id: str | None) -> None:
    """Nach jedem Schritt, der den Endstand einer Season ändert - Abschluss, Wiederöffnen, Entscheid über Staffeln hinweg (gesetzt
    oder zurückgenommen): die Nachricht zum bestätigten Auf- und Abstieg (``announce``: neuer Stand einmal, geänderter Stand einmal
    „Endstand korrigiert“) und, wenn es schon eine Folge-Season mit Startrechten gibt, Beginn bzw. Ende der Pause ihrer Fristen.
    Die Routen rufen das auf; nichts davon hält den Schritt selbst auf."""
    if not season_id:
        return
    # Erst der Pausenabgleich, dann die Nachricht: Ein Fehler beim Melden lässt keine Frist weiterlaufen.
    successor = await db.league_seasons.find_one({"predecessor_id": season_id, FIELD: {"$type": "object"}}, {"_id": 0})
    if successor:
        ctx = await _context(db, successor)
        await _sync_pause(db, successor, ctx["paused"], now_utc())
    await announce(db, season_id)


OFFERED_QUERY = {"status": "accepted", "carry_over.start_right.status": OFFERED}


async def _sweep_season(db, season_id: str, now: datetime, out: dict) -> None:
    """Eine Folge-Season unter ihrer Sperre. Reihenfolge (Entscheidung 26.11.): erst **alle** Verfälle dieses Laufs - Nachrücker, die
    schweigen, fallen zurück, überfällige Startrechte verfallen -, **dann** das Nachrücken auf die frei gewordenen Plätze, zuletzt
    die Erinnerungen. So hängt das Ergebnis nicht davon ab, in welcher Reihenfolge der Lauf die Anträge anfasst, und ein
    Überfälliger rückt nie nach. In der Pause (Vorgänger wieder geöffnet) und ab dem Startdatum der Season geschieht nichts davon."""
    season = await _season_of(db, season_id)
    settings = stored(season)
    if not settings:
        return
    if start_reached(season, now):
        # Ab dem Startdatum - auch im Entwurf - verfällt nichts mehr von selbst und rückt niemand mehr nach: Die Leitung entscheidet.
        # Früh heraus, bevor der Endstand des Vorgängers gelesen wird - außer es steht noch eine Pause offen (der Schritt in der
        # Route fehlte): Die wird vorher geschlossen, sonst stünde dort für immer „Frist ruht“.
        if open_pause(season) and not (await _context(db, season))["paused"]:
            await _sync_pause(db, season, False, now)
        return
    query = {"season_id": season_id, **OFFERED_QUERY}
    if not await db.league_applications.count_documents(query):
        return
    ctx = await _context(db, season)
    # Fehlte der Schritt in der Route, beginnt die Pause dort, wo sie wirklich begann (Wiederöffnen), nicht erst mit diesem Lauf.
    since = await _paused_since(db, season, now) if ctx["paused"] and not open_pause(season) else now
    season = await _sync_pause(db, season, ctx["paused"], since)
    if ctx["paused"]:
        # Der Vorgänger ist wieder geöffnet: Der Endstand wird geprüft - die Fristen ruhen, nichts verfällt, niemand rückt nach.
        out["paused"] += 1
        return
    freed: dict[str, dict] = {}
    expired: set[str] = set()
    fallen_back: set[str] = set()
    for _round in range(2):
        rows = await db.league_applications.find(query, {"_id": 0}).sort("created_at", 1).to_list(1000)
        late = [row for row in rows if overdue(row, season, now)]
        if not late:
            break
        for row in late:
            if not isinstance(row["carry_over"].get("fills"), dict):
                continue
            place = await _restore(db, season, row, EXPIRED, None)
            if place is None:
                continue
            out["restored"] += 1
            fallen_back.add(row["id"])
            freed[place["id"]] = place
            back = (row["carry_over"]["fills"].get("back") or {}).get("division_label")
            # Was in der eigenen Liga gilt: die frühere Zusage - oder die restliche Frist, mindestens ``rest_days``.
            fallen = await db.league_applications.find_one({"id": row["id"]}, {"_id": 0}) or {}
            own = right_of(fallen) or {}
            rest = accept_until(fallen, season)
            follow = (f" Eure Zusage dort ist noch offen: bitte bis {day_text(rest)} zusagen, sonst verfällt das Startrecht."
                      if own.get("status") == OFFERED and rest else " Eure Zusage dort gilt weiter." if own.get("status") == ACCEPTED else "")
            await _tell(db, row, "Nachrücken abgelaufen",
                        f"Für den frei gewordenen Platz in {row['carry_over'].get('division_label')} kam keine Zusage. "
                        f"{row.get('display_name') or 'Euer Co-Team'} bleibt in {back}.{follow}",
                        REASONS["back"], f"league-start-right:back:{row['id']}:{row['carry_over']['fills'].get('for_application_id')}")
        # Wer eben zurückgefallen ist, kann mit seinem früheren Startrecht selbst überfällig sein - darum neu lesen.
        for row in await db.league_applications.find(query, {"_id": 0}).sort("created_at", 1).to_list(1000):
            if isinstance(row["carry_over"].get("fills"), dict) or not overdue(row, season, now):
                continue
            place = await _expire(db, season, row)
            if place is None:
                continue
            out["expired"] += 1
            freed[place["id"]] = place
            expired.add(place["id"])
    # Erst jetzt nachrücken - auf jeden frei gewordenen Platz, in fester Reihenfolge (Liga N, Herkunft, Platz).
    order = sorted(freed.values(), key=lambda row: (row["carry_over"].get("division_level") or 99, row["carry_over"].get("from_level") or 99,
                                                    str(row["carry_over"].get("from_staffel") or ""), int(row["carry_over"].get("rank") or 0),
                                                    row["id"]))
    for place in order:
        fresh = await db.league_applications.find_one({"id": place["id"]}, {"_id": 0})
        moved = await _fill_by_rule(db, season, fresh, ctx)
        out["filled"] += 1 if moved else 0
        if place["id"] in expired:
            follow = f"{moved.get('display_name')} rückt nach." if moved else "Der Platz ist frei."
            await _tell_lead(db, season, place, "Startrecht verfallen",
                             f"{place.get('display_name')} hat für {place['carry_over'].get('division_label')} nicht zugesagt. {follow}",
                             f"league-start-right:lead:{place['id']}:{(right_of(place) or {}).get('offered_at')}")
    for row in await db.league_applications.find(query, {"_id": 0}).sort("created_at", 1).to_list(1000):
        # Wer in diesem Lauf zurückgefallen ist, hat die Frist eben in „Nachrücken abgelaufen“ gelesen - keine Erinnerung obendrauf.
        if row["id"] not in fallen_back and _reminder_due(row, season, settings, now):
            out["reminded"] += await _remind(db, season, row, now)


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
                                            # Abgesagt (#2607): Dort verfällt nichts und rückt niemand nach.
                                            "status": {"$nin": ["completed", "archived", "cancelled"]}}, {"_id": 0, "id": 1}).to_list(500)
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


def _fact_text(fact: str, name: str, label: str | None, how: str, corrected: bool, title: str, note: str, *,
               gave_up: bool = False) -> tuple[str, str]:
    """Titel und Text zu einem bestätigten Stand (``up:1``, ``down:2``, ``stay:2``, ``none``). ``gave_up``: Das Co-Team hat seinen
    Platz in der schon angelegten Folge-Season aufgegeben (Nr. 271) - dann nur der Endstand, ohne Startrecht und ohne Aufforderung."""
    move = fact.split(":")[0]
    right = "" if gave_up else f": Startrecht für {label} in der nächsten Season"
    phrase = {"up": f"steigt auf{how}{right}", "down": f"steigt ab{how}{right}",
              "stay": f"bleibt in {label}"}.get(move, "hat kein Startrecht für die nächste Season")
    if corrected:
        return "Endstand korrigiert", f"Die Liga-Leitung hat den Endstand von {title} korrigiert. {name} {phrase}."
    headline = "Aufstieg bestätigt" if move == "up" else "Abstieg bestätigt"
    return headline, " ".join(part for part in (f"Der Endstand von {title} steht fest. {name} {phrase}.", "" if gave_up else note) if part)


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
    # Gibt es die Folge-Season schon und hat das Co-Team seinen Platz dort aufgegeben (abgemeldet, verfallen, abgelehnt - nicht
    # zurückgenommen), bekommt es kein Angebot mehr (Nr. 271): Die Nachricht nennt nur den Endstand.
    follow_ids = [row["id"] async for row in db.league_seasons.find({"predecessor_id": season_id}, {"_id": 0, "id": 1})] if todo else []
    gave_up = {row["squad_id"] async for row in db.league_applications.find(
        {"season_id": {"$in": follow_ids}, "carry_over": {"$exists": True}, "status": {"$in": ["withdrawn", "rejected"]},
         "carry_over.revoked_at": {"$exists": False}}, {"_id": 0, "squad_id": 1})} if follow_ids else set()
    for squad_id, fact, team, label, entry, corrected in todo:
        how = " über die Relegation" if team.get("via") == "relegation" else ""
        headline, text = _fact_text(fact, team.get("display_name") or "Euer Co-Team", label, how, corrected, title,
                                    NO_REGISTRATION[settings["mode"]], gave_up=squad_id in gave_up)
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
    league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "participant_kind": 1})
    if league_participants.is_solo(league):
        # Solo-Liga (#1629): Startrechte je Person (``user:<id>``) kommen mit der Folge-Season (P4).
        raise StartRightProblem(league_participants.SUCCESSOR_FOLLOWS, 409)
    before = stored(season)
    fields = {key: value for key, value in body.items() if key in DEFAULTS and value is not None}
    rules = normalize({**(before or {}), **fields}) if body.get("active", True) else None
    async with _Lock(db, season["id"]):
        now = now_utc().isoformat()
        # Rückfrage (Entscheidung 26.11.): Braucht danach niemand mehr eine Zusage, gelten offene Startrechte als zugesagt - das
        # geschieht nur mit ausdrücklicher Bestätigung (``confirm_open``), nie nebenbei.
        waiting = await db.league_applications.count_documents({"season_id": season["id"], **OFFERED_QUERY})
        if waiting and (rules or {}).get("mode") != ACCEPT and not body.get("confirm_open"):
            raise StartRightProblem(CONFIRM_OPEN_ONE if waiting == 1 else CONFIRM_OPEN_MANY.format(count=waiting), 409)
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
        # Die Frist ruht (Vorgänger wieder geöffnet) bzw. ist vorbei und das Startdatum erreicht: Dann entscheidet die Leitung.
        "paused": resting(application, season), "waits_for_lead": waits_for_lead(application, season, now),
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
    from services.league_applications import _names
    from services.league_permissions import belongs_to_side, is_superadmin, side_of
    from services.match_audience import teams_by_id

    now = now or now_utc()
    settings = stored(season)
    out: dict = {"active": settings is not None, "settings": settings, "defaults": defaults(), "predecessor": None, "paused": False,
                 # ``started``: Das Startdatum ist erreicht (auch im Entwurf) - ab dann verfällt und rückt nichts mehr von selbst.
                 "started": start_reached(season, now), "superadmin": is_superadmin(user), "counts": {}, "rows": [], "open_places": [],
                 # Offene Zusagen: Beim Ausschalten oder Umschalten auf „automatisch“ gelten sie als zugesagt - die Verwaltung fragt nach.
                 "open_rights": 0}
    if not season.get("predecessor_id"):
        return out
    rows = await db.league_applications.find({"season_id": season["id"], "carry_over": {"$exists": True}}, {"_id": 0}).to_list(1000)
    ctx = await _context(db, season)
    if ctx["predecessor"]:
        out["predecessor"] = {"id": ctx["predecessor"]["id"], "name": ctx["predecessor"].get("name")}
    out["paused"] = ctx["paused"] or open_pause(season)
    out["open_rights"] = len([row for row in rows if row.get("status") == "accepted" and (right_of(row) or {}).get("status") == OFFERED])
    people = {(right_of(row) or {}).get("accepted_by") for row in rows} | {(row["carry_over"].get("fills") or {}).get("by") for row in rows}
    names = await _names(db, {uid for uid in people if uid})
    sides = {row["id"]: side_of(row) for row in rows}
    side_teams = await teams_by_id(db, sides.values())
    rows.sort(key=lambda row: (row["carry_over"].get("division_level") or 99, row["carry_over"].get("from_level") or 99,
                               str(row["carry_over"].get("from_staffel") or ""), int(row["carry_over"].get("rank") or 0)))
    by_id = {row["id"]: row for row in rows}
    # Wer einen frei gewordenen Platz gerade wirklich hält (``_holds``) - eine veraltete Vergabe wird nicht mehr gezeigt.
    holders = {row["id"]: by_id.get((row["carry_over"].get("filled_by") or {}).get("application_id") or "") for row in rows
               if isinstance(row["carry_over"].get("filled_by"), dict)}
    holders = {key: holder for key, holder in holders.items() if _holds(holder, by_id[key])}
    for row in rows:
        entry = _row(row, season, names, belongs_to_side(user, sides[row["id"]], side_teams.get(row["team_id"])), now)
        entry["filled_by"] = entry["filled_by"] if row["id"] in holders else None
        out["rows"].append(entry)
        out["counts"][entry["state"]] = out["counts"].get(entry["state"], 0) + 1
    if settings is None:
        return out
    for row in rows:
        if not _is_free(row, ctx, holders.get(row["id"])):
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
