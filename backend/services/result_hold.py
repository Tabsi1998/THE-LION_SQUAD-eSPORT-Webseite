"""Ergebnis mit „Rückgängig“ (#1156): die Turnierleitung speichert, der Server hält das Ergebnis 10 Sekunden zurück.

Erst danach rückt der Turnierbaum weiter, sieht der TV das Ergebnis und gehen die Nachrichten raus. Wer in den 10
Sekunden „Rückgängig“ tippt, nimmt es zurück - es bleibt nichts übrig außer einer Zeile im Protokoll. So sieht es auch
das Ergebnis-Fenster in Turnierleitung, Matchplan, Stationen und auf der Matchseite (#1370): ein Server-Weg für alle.

- Halten: ``hold_result`` prüft das Ergebnis vollständig (wie beim Speichern), legt es als ``pending_result`` an das
  Spiel und schreibt „match.result.hold“ ins Protokoll. Öffentlich sieht niemand etwas davon (match_public_view).
- Veröffentlichen: ``publish_due_holds`` - ein Zeitgeber im Server nach den 10 Sekunden (plus 2 Sekunden Puffer, damit
  ein knapp gesendetes „Rückgängig“ noch ankommt) und der Sammler im Scheduler alle 5 Sekunden, falls der Server
  dazwischen neu gestartet ist.
- Rückgängig: ``undo_result`` - nur der letzte Eintrag eines Spiels, nur mit Ergebnis-Recht, mit Protokoll. Liegt das
  Ergebnis noch bereit, fällt es einfach weg. Ist es schon veröffentlicht (das „Rückgängig“ kam zu spät), nimmt der
  Server auch das Weiterrücken im Baum zurück - oder lehnt mit einem Satz ab, wenn das nächste Spiel schon begonnen hat.
- Korrigieren: ein fertiges Ergebnis ändert die Turnierleitung nur mit Grund; der Grund steht am Ergebnis und im
  Protokoll.
- „Nicht erschienen“ im Duell ist eine Wertung (services/match_forfeit): die andere Seite gewinnt, die Begründung sieht
  die betroffene Person unter ihren Strafen.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta

from models import new_id, now_utc
from services.advancement_draw import draw_group_of, group_targets
from services.match_forfeit import apply_forfeit
from services.match_v2_results import (
    DECIDED_STATUSES,
    LOCKED_DOWNSTREAM_STATUSES,
    MatchV2ResultError,
    _clear_slot,
    _status_after_slot_fill,
    build_v2_result_application,
    checked_results,
    ensure_correction_allowed,
)
from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource
from services.v2_result_submission import submit_v2_result

logger = logging.getLogger("tls.result_hold")

HOLD_SECONDS = 10
# Das „Rückgängig“ der Oberfläche zählt 10 Sekunden ab der Antwort; der Server wartet etwas länger.
GRACE_SECONDS = 2
NO_SHOW_NOTE = "Nicht erschienen"
BUSY_DETAIL = "Für dieses Spiel wird gerade ein Ergebnis gespeichert. Bitte kurz warten oder „Rückgängig“ nutzen."
# Felder einer Ergebniszeile, die das gehaltene Ergebnis aufhebt - dieselben, die der Ergebnis-Weg liest.
RESULT_FIELDS = ("registration_id", "rank", "score", "points", "time_ms", "dnf", "forfeit", "note")

_timer_tasks: set[asyncio.Task] = set()


def timers_enabled() -> bool:
    """Im Betrieb veröffentlicht ein Zeitgeber nach den 10 Sekunden; Tests stoßen das selbst an."""
    return os.environ.get("APP_ENV") != "test"


def ensure_no_hold(match: dict) -> None:
    """Liegt gerade ein Ergebnis für „Rückgängig“ bereit, nimmt das Spiel nichts anderes an (Meldung, Wertung, Ergebnis)."""
    if isinstance(match.get("pending_result"), dict):
        raise MatchV2ResultError(BUSY_DETAIL, 409)


def hold_view(match: dict | None, viewer_id: str | None = None) -> dict | None:
    """Das bereitliegende Ergebnis für die Oberfläche der Turnierleitung: von wem, bis wann noch „Rückgängig“."""
    hold = (match or {}).get("pending_result")
    if not isinstance(hold, dict):
        return None
    return {
        "id": hold.get("id"),
        "held_at": hold.get("held_at"),
        "publish_at": hold.get("publish_at"),
        "undo_seconds": HOLD_SECONDS,
        "mine": bool(viewer_id and hold.get("actor_id") == viewer_id),
        "actor_name": hold.get("actor_name") or "Turnierleitung",
        "correction": bool(hold.get("force")),
    }


def _clean_rows(results: list[dict]) -> list[dict]:
    return [{key: row.get(key) for key in RESULT_FIELDS if row.get(key) not in (None, "")} for row in results]


def _no_show(match: dict, results: list[dict]) -> str | None:
    """Im Duell mit genau einer Seite „Nicht erschienen“ ist das Ergebnis eine Wertung - wer fehlt, verliert."""
    filled = [slot.get("registration_id") for slot in match.get("slots") or [] if slot.get("registration_id")]
    if len(filled) != 2:
        return None
    missing = [row.get("registration_id") for row in results if row.get("forfeit")]
    return missing[0] if len(missing) == 1 else None


async def hold_result(db, match: dict, raw_results: list[dict], *, actor: dict, note: str | None,
                      proof_url: str | None, force: bool, reason: str | None,
                      games: list[dict] | None = None, lineups_missing: list[str] | None = None) -> dict:
    """Ein Ergebnis für 10 Sekunden bereitlegen. Prüft alles wie beim Speichern - Fehler kommen sofort zurück."""
    actor_id = actor["id"]
    normalized = await checked_results(db, match, raw_results)
    existing = match.get("pending_result")
    if isinstance(existing, dict):
        same = existing.get("actor_id") == actor_id and _clean_rows(existing.get("results") or []) == _clean_rows(normalized)
        if same:
            return {"ok": True, "held": True, "hold": hold_view(match, actor_id), "idempotent_replay": True}
        raise MatchV2ResultError(BUSY_DETAIL, 409)
    reason_text = (reason or "").strip()
    # Dieselbe Regel wie beim direkten Speichern (services/match_v2_results): Korrektur nur mit Grund.
    ensure_correction_allowed(match, force=force, reason=reason_text)
    forfeiting = _no_show(match, normalized)
    note_text = (note or "").strip() or (NO_SHOW_NOTE if forfeiting else "")
    # Probelauf: würde das Ergebnis so durchgehen (belegte Folgespiele, abgesagtes Spiel …)? Dann jetzt sagen, nicht in
    # 10 Sekunden.
    stage_matches = await db.matches_v2.find({"stage_id": match.get("stage_id")}, {"_id": 0}).to_list(3000)
    trial = build_v2_result_application(match, stage_matches, normalized, actor_id=actor_id,
                                        now_iso=now_utc().isoformat(), proof_url=proof_url, note=note_text, force=force)
    now = now_utc()
    hold = {
        "id": new_id(),
        "kind": "forfeit" if forfeiting else "result",
        "results": _clean_rows(normalized),
        "forfeit_registration_id": forfeiting,
        "note": note_text or None,
        "proof_url": (proof_url or "").strip() or None,
        "force": bool(force),
        "reason": reason_text or None,
        "actor_id": actor_id,
        "actor_name": actor.get("display_name") or actor.get("username") or "Turnierleitung",
        "held_at": now.isoformat(),
        "publish_at": (now + timedelta(seconds=HOLD_SECONDS + GRACE_SECONDS)).isoformat(),
        # Liga (#1650): geprüfte Maps samt Aufstellungen gehen mit dem Ergebnis raus.
        **({"games": games, "lineups_missing": lineups_missing or []} if games is not None else {}),
    }
    stored = await db.matches_v2.update_one(
        {"id": match["id"], "pending_result": {"$exists": False}},
        {"$set": {"pending_result": hold}},
    )
    if not stored.modified_count:
        raise MatchV2ResultError(BUSY_DETAIL, 409)
    await _audit(db, "match.result.hold", match, actor_id, {
        "hold_id": hold["id"], "force": bool(force), **({"reason": reason_text} if reason_text else {}),
        **({"no_show_registration_id": forfeiting} if forfeiting else {}),
    })
    schedule_publication(match["id"], HOLD_SECONDS + GRACE_SECONDS)
    held_match = {**match, "pending_result": hold}
    # Folgespiele, die diese Korrektur zurücksetzen würde (#1035) - die Oberfläche kann es vor Ablauf nennen.
    reset_ids = [row["id"] for row in trial.get("reset_matches") or []]
    return {"ok": True, "held": True, "hold": hold_view(held_match, actor_id), "reset_match_ids": reset_ids,
            "idempotent_replay": False}


async def _audit(db, action: str, match: dict, actor_id: str | None, data: dict) -> None:
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": action,
        "target_id": match.get("tournament_id") or match.get("id"),
        "actor_id": actor_id,
        "data": {"match_id": match.get("id"), "stage_id": match.get("stage_id"), "match_key": match.get("match_key"), **data},
        "created_at": now_utc().isoformat(),
    })


def schedule_publication(match_id: str, delay_seconds: float) -> None:
    """Nach den 10 Sekunden veröffentlichen - im laufenden Server; der Sammler im Scheduler fängt den Rest auf."""
    if not timers_enabled():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    async def _run() -> None:
        await asyncio.sleep(max(0.0, delay_seconds))
        try:
            from database import get_db

            await publish_due_holds(get_db(), match_id=match_id)
        except Exception as exc:  # noqa: BLE001 - der Sammler versucht es wieder
            logger.warning("Held result publication failed for match=%s type=%s", match_id, type(exc).__name__)

    task = loop.create_task(_run())
    _timer_tasks.add(task)
    task.add_done_callback(_timer_tasks.discard)


async def publish_due_holds(db, *, now: datetime | None = None, match_id: str | None = None) -> int:
    """Alle Ergebnisse veröffentlichen, deren „Rückgängig“ abgelaufen ist. Gibt die Zahl der veröffentlichten zurück."""
    moment = (now or now_utc()).isoformat()
    query: dict = {"pending_result.publish_at": {"$lte": moment}}
    if match_id:
        query["id"] = match_id
    due = await db.matches_v2.find(query, {"_id": 0, "id": 1, "tournament_id": 1, "pending_result.id": 1}).to_list(50)
    published = 0
    for row in due:
        hold_id = (row.get("pending_result") or {}).get("id")
        try:
            async with mutation_lock(db, tournament_write_resource(row["tournament_id"]), wait_seconds=5.0):
                if await _publish_one(db, row["id"], hold_id, moment):
                    published += 1
        except MutationLockBusy:
            logger.info("Held result for match=%s waits for the tournament lock", row.get("id"))
    return published


async def _publish_one(db, match_id: str, hold_id: str | None, moment: str) -> bool:
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    hold = (match or {}).get("pending_result")
    if not isinstance(hold, dict) or hold.get("id") != hold_id or str(hold.get("publish_at") or "") > moment:
        return False
    # Zuerst vom Spiel nehmen - wer gleichzeitig „Rückgängig“ tippt, findet dann nichts mehr und bekommt das zu hören.
    claimed = await db.matches_v2.update_one({"id": match_id, "pending_result.id": hold_id}, {"$unset": {"pending_result": ""}})
    if not claimed.modified_count:
        return False
    match.pop("pending_result", None)
    try:
        if hold.get("kind") == "forfeit" and hold.get("forfeit_registration_id"):
            await apply_forfeit(db, match, hold["forfeit_registration_id"], note=hold.get("note") or NO_SHOW_NOTE,
                                actor_id=hold.get("actor_id"), force=bool(hold.get("force")), reason=hold.get("reason"),
                                hold_id=hold_id)
        else:
            await submit_v2_result(
                db, match, hold.get("results") or [], actor_id=hold.get("actor_id"), proof_url=hold.get("proof_url"),
                note=hold.get("note"), force=bool(hold.get("force")), audit_action="match.result.submit",
                reason=hold.get("reason"), hold_id=hold_id,
                games=hold.get("games") if "games" in hold else None,
                lineups_missing=hold.get("lineups_missing") if "games" in hold else None,
            )
    except MatchV2ResultError as exc:
        # Inzwischen hat sich etwas geändert (etwa ein Folgespiel läuft schon): nichts schreiben, Bescheid geben.
        await _audit(db, "match.result.hold_failed", match, hold.get("actor_id"), {"hold_id": hold_id, "detail": str(exc)[:200]})
        await _tell_actor_failed(db, match, hold, str(exc))
        return False
    try:
        from services.change_events import publish_api_change

        await publish_api_change("POST", f"/api/matches/{match_id}/result", 200)
    except Exception:  # noqa: BLE001 - die Anzeige holt es beim nächsten Abruf
        logger.debug("Live-Meldung für Match %s nicht verschickt", match_id, exc_info=True)
    return True


async def _tell_actor_failed(db, match: dict, hold: dict, detail: str) -> None:
    from services.user_notifications import create_user_notification

    try:
        await create_user_notification(
            hold.get("actor_id"),
            "Ergebnis nicht gespeichert",
            f"Das Ergebnis zu {match.get('round_name') or match.get('match_key') or 'einem Spiel'} ging nicht durch: {detail}",
            url=f"/matches/{match.get('id')}",
            kind="match_attention",
            meta={"category": "tournament_updates", "match_id": match.get("id"), "tournament_id": match.get("tournament_id"),
                  "dedupe_key": f"hold-failed:{hold.get('id')}", "reason": "hold_failed"},
        )
    except Exception:  # noqa: BLE001
        logger.warning("Hold failure notice failed for match=%s", match.get("id"))


# ---------------------------------------------------------------- Rückgängig

def _downstream(match: dict, stage_matches: list[dict]) -> list[dict]:
    """Die Spiele, in die dieses Ergebnis jemanden geschoben hat (oder ein Freilos eingetragen). Gemischt (#1548): hat
    dieses Ergebnis eine Auslosung ausgelöst, gehört die ganze ausgeloste Runde dazu - Rückgängig nimmt das Los zurück."""
    direct = [
        candidate for candidate in stage_matches
        if candidate.get("id") != match.get("id") and any(
            (slot.get("source_result") or {}).get("from_match_id") == match.get("id")
            for slot in candidate.get("slots") or []
        )
    ]
    found = {row["id"]: row for row in direct}
    for target in direct:
        group = draw_group_of(target)
        if group and isinstance(target.get("draw"), dict):
            for mate in group_targets(stage_matches, group, target.get("stage_id")):
                if mate.get("status") != "cancelled":
                    found.setdefault(mate["id"], mate)
    return list(found.values())


def _ready_groups_fed_by(match: dict, stage_matches: list[dict]) -> list[tuple[str, str | None]]:
    """Die Show-Runden (#1590), die dieses Spiel beliefert und die gerade „bereit“ sind - je Phase und Gruppe."""
    by_id = {row.get("id"): row for row in stage_matches if row.get("id")}
    found: list[tuple[str, str | None]] = []
    for entry in match.get("advancement") or []:
        target = by_id.get(entry.get("to_match_id"))
        group = draw_group_of(target)
        if not group or not isinstance(target.get("draw_ready"), dict) or isinstance(target.get("draw"), dict):
            continue
        scope = (group, target.get("stage_id"))
        if scope not in found:
            found.append(scope)
    return found


def _undoes_draw(slot: dict, target: dict, match: dict) -> bool:
    """Was Rückgängig leert: den Platz aus diesem Spiel - und gemischt jeden Platz aus der Auslosung dieser Runde."""
    origin = slot.get("source_result") or {}
    if origin.get("from_match_id") == match.get("id"):
        return True
    draw = target.get("draw") if isinstance(target.get("draw"), dict) else {}
    return bool(draw.get("id")) and origin.get("draw_id") == draw.get("id")


def _started(target: dict) -> bool:
    return (
        str(target.get("status") or "") in LOCKED_DOWNSTREAM_STATUSES
        or bool(target.get("results"))
        or bool(target.get("started_at"))
        or isinstance(target.get("pending_result"), dict)
    )


def _open_status(match: dict) -> str:
    previous = str((match.get("result_meta") or {}).get("previous_status") or "")
    if previous in {"pending", "ready", "scheduled", "in_progress", "running", "waiting_result"}:
        return previous
    if match.get("started_at"):
        return "waiting_result"
    return "scheduled" if match.get("scheduled_at") else "ready"


async def undo_result(db, match: dict, *, actor_id: str, hold_id: str | None = None) -> dict:
    """„Rückgängig“: das bereitliegende Ergebnis verwerfen - oder das gerade veröffentlichte zurücknehmen."""
    hold = match.get("pending_result")
    if isinstance(hold, dict) and (not hold_id or hold.get("id") == hold_id):
        removed = await db.matches_v2.update_one({"id": match["id"], "pending_result.id": hold.get("id")}, {"$unset": {"pending_result": ""}})
        if removed.modified_count:
            await _audit(db, "match.result.undo", match, actor_id, {"hold_id": hold.get("id"), "held": True})
            return {"ok": True, "undone": True, "held": True}
        match = await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0}) or match
    return await _revert_published(db, match, actor_id=actor_id, hold_id=hold_id)


async def _revert_published(db, match: dict, *, actor_id: str, hold_id: str | None) -> dict:
    meta = match.get("result_meta") or {}
    status = str(match.get("status") or "")
    if status not in DECIDED_STATUSES or not match.get("results"):
        raise MatchV2ResultError("Für dieses Spiel gibt es nichts zum Zurücknehmen.", 409)
    if hold_id and meta.get("hold_id") != hold_id:
        raise MatchV2ResultError("Rückgängig gilt nur für den letzten Eintrag dieses Spiels.", 409)
    if status == "forfeit" or meta.get("force") or meta.get("previous_status") == "disputed":
        raise MatchV2ResultError(
            "Dieser Eintrag ist schon veröffentlicht und lässt sich nicht mehr zurücknehmen – bitte über „Korrigieren“ ändern.", 409)
    stage_matches = await db.matches_v2.find({"stage_id": match.get("stage_id")}, {"_id": 0}).to_list(3000)
    targets = _downstream(match, stage_matches)
    for target in targets:
        if _started(target):
            name = target.get("round_name") or target.get("match_key") or "Das nächste Spiel"
            raise MatchV2ResultError(
                f"Rückgängig geht nicht mehr: {name} hat schon begonnen. Bitte das Ergebnis über „Korrigieren“ ändern.", 409)
    now_iso = now_utc().isoformat()
    cleared: list[str] = []
    for target in targets:
        slots = target.get("slots") or []
        changed = False
        for slot in slots:
            if _undoes_draw(slot, target, match):
                changed = _clear_slot(slot) or changed
        drawn = isinstance(target.get("draw"), dict) and draw_group_of(target)
        if changed or drawn:
            target["slots"] = slots
            await db.matches_v2.update_one({"id": target["id"]}, {"$set": {
                "slots": slots, "status": _status_after_slot_fill(target, preserve_terminal=False), "updated_at": now_iso,
                # Meldungen gehörten zur alten Paarung (#1035).
                **({"reports": []} if target.get("reports") else {}),
            }, **({"$unset": {"draw": ""}} if drawn else {})})
            cleared.append(target["id"])
    # Show-Auslosung (#1590): war die Runde „bereit“, ist sie es ohne dieses Ergebnis nicht mehr - die Marke geht weg.
    for group, stage_id in _ready_groups_fed_by(match, stage_matches):
        result = await db.matches_v2.update_many(
            {"stage_id": stage_id, "settings.draw_group": group, "draw_ready": {"$type": "object"}, "draw": {"$exists": False}},
            {"$set": {"draw_ready": None, "updated_at": now_iso}},
        )
        if getattr(result, "modified_count", 0):
            cleared.extend(row["id"] for row in group_targets(stage_matches, group, stage_id)
                           if isinstance(row.get("draw_ready"), dict) and row["id"] not in cleared)
    await db.matches_v2.update_one({"id": match["id"]}, {
        "$set": {"results": [], "result_meta": None, "completed_at": None, "completed_by": None,
                 "status": _open_status(match), "updated_at": now_iso},
        # Liga (#1650): die geltenden Maps gehören zum Ergebnis - offene Meldungen bleiben, der Index folgt ihnen.
        **({"$unset": {"games": "", "lineups_missing": ""}} if "games" in match or "lineups_missing" in match else {}),
    })
    if "games" in match or match.get("lineup_user_ids"):
        from services.league_games import refresh_lineup_index
        await refresh_lineup_index(db, match["id"])
    await _audit(db, "match.result.undo", match, actor_id, {
        "held": False, "report_id": meta.get("report_id"), "cleared_matches": cleared,
    })
    await _tell_players_undone(db, match, meta.get("report_id"))
    try:
        from services.change_events import publish_api_change

        await publish_api_change("POST", f"/api/matches/{match['id']}/result/undo", 200)
    except Exception:  # noqa: BLE001
        logger.debug("Live-Meldung für Match %s nicht verschickt", match.get("id"), exc_info=True)
    return {"ok": True, "undone": True, "held": False, "cleared_matches": cleared}


async def _tell_players_undone(db, match: dict, report_id: str | None) -> int:
    """Das Ergebnis war schon draußen: wer „Ergebnis bestätigt“ bekommen hat, erfährt, dass es zurückgenommen ist -
    dieselben Leute (#1136: wer antritt, bei Teams mit Aufstellung die Aufgestellten)."""
    from services.match_audience import playing_user_ids, registrations_for_match
    from services.user_notifications import create_user_notification

    registrations = await registrations_for_match(db, match)
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "title": 1}) or {}
    sent = 0
    for user_id in sorted(await playing_user_ids(db, registrations)):
        if await create_user_notification(
            user_id,
            "Ergebnis zurückgenommen",
            f"{tournament.get('title') or 'Turnier'}: Die Turnierleitung hat das Ergebnis zurückgenommen und trägt es neu ein.",
            url=f"/matches/{match.get('id')}",
            kind="match_result",
            meta={"match_id": match.get("id"), "tournament_id": match.get("tournament_id"),
                  "dedupe_key": f"match-result-undo:{match.get('id')}:{report_id}"},
        ):
            sent += 1
    return sent
