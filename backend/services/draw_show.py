"""Show-Auslosung (#1590): die Runde ist fertig, der Topf steht - gelost wird erst auf „Jetzt auslosen“.

- Sobald alle Quellspiele einer Show-Gruppe entschieden sind, tragen ihre Folgespiele ``draw_ready`` (Gruppe, ``since``,
  Topfgröße); das legt ``match_v2_results.run_draw`` an, zusammen mit dem Protokoll ``tournament.draw.ready`` und dem
  Anzeige-Ereignis ``draw_ready`` (services/draw_records).
- **Jetzt auslosen** (``perform_show_draw``): die Turnierleitung mit Aufbau-Recht über
  ``POST /api/tournaments/{tid}/stages/{stage_id}/draw`` - oder der Server nach der Frist. Gelost wird mit
  ``secrets``, geschrieben alles oder nichts (Compare-and-Set wie „Neu auslosen“), danach Protokoll
  ``tournament.draw.done`` (``trigger`` ``show`` bzw. ``timeout``), Ereignis ``draw_done`` und der Lauf-Umbau.
- **Der Job** (``sweep``, Scheduler „draw_show“, jede Minute auf genau einem Server): nach ``draw_show_minutes`` (Vorgabe
  10, je Turnier und Phase) eine Erinnerung an die Turnierleitung mit Aufbau-Recht (genau eine je Runde,
  ``draw_ready.reminded_at``), nach noch einmal so vielen Minuten lost er selbst - unter der Turnier-Schreibsperre, mit
  frisch gelesenem Stand; ein zweiter Lauf findet nichts mehr.
"""
from __future__ import annotations

import copy
import logging
from datetime import datetime, timedelta, timezone

from models import now_utc
from services.advancement_draw import draw_group_of, group_sources, group_targets, match_mode, show_minutes_of
from services.match_v2_results import DECIDED_OR_VOID, MatchV2ResultError, _pot_ranks, _advancement_result_rank, \
    build_show_draw_application
from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource

logger = logging.getLogger("tls.draw_show")

STALE_DETAIL = ("Ein Spiel dieser Runde hat sich inzwischen geändert (aufgerufen, gestartet oder neu gesetzt). "
                "Es wurde nichts ausgelost – bitte neu laden.")
REMINDER_KIND = "match_attention"


def _parse(value) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else None
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed and parsed.tzinfo is None else parsed


# ---------------------------------------------------------------------------------------------- Lesen

def ready_groups(matches: list[dict]) -> list[dict]:
    """Die Show-Runden, die gerade auf das Los warten: je Phase und Gruppe die Zielspiele mit ``draw_ready``."""
    found: dict[tuple, dict] = {}
    for match in matches:
        marker = match.get("draw_ready")
        group = draw_group_of(match)
        if not isinstance(marker, dict) or not group or isinstance(match.get("draw"), dict) \
                or match.get("status") == "cancelled" or match.get("is_preview"):
            continue
        scope = (match.get("stage_id"), group)
        entry = found.setdefault(scope, {"stage_id": match.get("stage_id"), "group": group, "since": marker.get("since"),
                                         "reminded_at": marker.get("reminded_at"), "targets": []})
        entry["targets"].append(match)
        if marker.get("reminded_at") and not entry.get("reminded_at"):
            entry["reminded_at"] = marker.get("reminded_at")
    return [found[key] for key in sorted(found, key=lambda scope: (str(scope[0] or ""), scope[1]))]


def draw_pot(group: str, stage_id, matches: list[dict], eliminated: set[str] | None = None) -> list[str]:
    """Wer im Topf ist: je Weiterleitung in die Gruppe die Anmeldung auf diesem Platz (Freilose zählen nicht) - dieselbe
    Regel wie das Los (``run_draw``)."""
    rows = [row for row in matches if row.get("stage_id") == stage_id]
    target_ids = {target.get("id") for target in group_targets(rows, group, stage_id) if target.get("status") != "cancelled"}
    pot: list[str] = []
    by_id = {row["id"]: row for row in rows if row.get("id")}
    for source in sorted(group_sources(rows, group, stage_id), key=lambda row: (row.get("round") or 0, row.get("order") or 0)):
        if str(source.get("status") or "") not in DECIDED_OR_VOID:
            continue
        results = [] if source.get("status") == "cancelled" else source.get("results") or []
        gone = set(eliminated or ()) | {row.get("registration_id") for row in results if row.get("eliminated")}
        by_rank, winner_path = _pot_ranks(source, results, gone, by_id)
        for advancement in source.get("advancement") or []:
            if advancement.get("to_match_id") not in target_ids:
                continue
            rank = _advancement_result_rank(source, advancement)
            flow = advancement.get("flow")
            result = (winner_path if flow == "W" else by_rank).get(rank)
            if not result or result.get("registration_id") in gone or (flow == "W" and result.get("forfeit")):
                continue
            pot.append(result.get("registration_id"))
    return pot


def timing_of(entry: dict, tournament: dict | None, stage: dict | None) -> dict:
    """Erinnerung nach X Minuten, automatisches Los nach 2·X - gerechnet ab ``since`` mit der heutigen Einstellung."""
    minutes = show_minutes_of(tournament, (stage or {}).get("settings"))
    since = _parse(entry.get("since")) or now_utc()
    return {"remind_minutes": minutes, "remind_at": since + timedelta(minutes=minutes),
            "due_at": since + timedelta(minutes=2 * minutes)}


def lead_cards(matches: list[dict], tournament: dict | None, stages: dict[str, dict], regs_by_id: dict[str, dict],
               *, can_draw: bool, eliminated: set[str] | None = None) -> list[dict]:
    """Die Karten „Auslosung bereit · N Namen“ für die Turnierleitung (Web und App)."""
    from services.match_timing import registration_name

    cards = []
    for entry in ready_groups(matches):
        stage = stages.get(entry.get("stage_id") or "")
        timing = timing_of(entry, tournament, stage)
        targets = sorted(entry["targets"], key=lambda row: (row.get("order") or 0, str(row.get("match_key") or "")))
        pot_ids = draw_pot(entry["group"], entry.get("stage_id"), matches, eliminated)
        label = next((((slot.get("source") or {}).get("draw") or {}).get("label")
                      for target in targets for slot in target.get("slots") or []
                      if ((slot.get("source") or {}).get("draw") or {}).get("label")), None)
        cards.append({
            "id": f"draw-{entry['group']}",
            "stage_id": entry.get("stage_id"),
            "stage_name": (stage or {}).get("name"),
            "group": entry["group"],
            "label": label or "Vorrunde",
            "round_name": targets[0].get("round_name") if targets else None,
            "match_ids": [target["id"] for target in targets],
            "match_keys": [target.get("match_key") for target in targets],
            "pot": [registration_name(regs_by_id.get(registration_id)) for registration_id in pot_ids],
            "pot_size": len(pot_ids),
            "since": entry.get("since"),
            "reminded_at": entry.get("reminded_at"),
            "remind_minutes": timing["remind_minutes"],
            "remind_at": timing["remind_at"].isoformat(),
            "due_at": timing["due_at"].isoformat(),
            "can_draw": bool(can_draw),
        })
    return cards


# ---------------------------------------------------------------------------------------------- Schreiben

def _unchanged_filter(before: dict) -> dict:
    """Das Spiel steht noch so da wie gelesen: Stand, Aufruf, Beginn, Zeitstempel (``None`` trifft auch „fehlt“)."""
    return {
        "id": before["id"],
        "status": before.get("status"),
        "called_at": before.get("called_at"),
        "started_at": before.get("started_at"),
        "updated_at": before.get("updated_at"),
    }


async def write_draw_sets(db, originals: dict[str, dict], target_sets: dict[str, dict]) -> None:
    """Alles oder nichts (Compare-and-Set): erst prüfen, ob jedes Spiel noch so dasteht wie gelesen, dann schreiben -
    jedes Schreiben nur mit diesem Filter. Trifft ein späteres Schreiben nicht mehr, wird das schon Geschriebene
    zurückgesetzt und mit 409 abgelehnt. Die Turnier-Schreibsperre hält Ergebnisse und Stationen ohnehin fern."""
    filters = {match_id: _unchanged_filter(originals[match_id]) for match_id in target_sets}
    for match_filter in filters.values():
        if await db.matches_v2.count_documents(match_filter) != 1:
            raise MatchV2ResultError(STALE_DETAIL, 409)
    written: list[str] = []
    for match_id, update in target_sets.items():
        result = await db.matches_v2.update_one(filters[match_id], {"$set": update})
        if result.matched_count == 1:
            written.append(match_id)
            continue
        for done in written:
            before, after = originals[done], target_sets[done]
            restore = {"$set": {key: before[key] for key in after if key in before}}
            gone = {key: "" for key in after if key not in before}
            if gone:
                restore["$unset"] = gone
            await db.matches_v2.update_one({"id": done, "updated_at": after.get("updated_at")}, restore)
        raise MatchV2ResultError(STALE_DETAIL, 409)


async def perform_show_draw(db, tournament: dict, stage_id: str, group: str, *, actor_id: str | None,
                            trigger: str = "show") -> dict:
    """Das Los einer bereiten Show-Runde legen - der Aufrufer hält die Turnier-Schreibsperre. Liest den Stand frisch,
    schreibt alles oder nichts, protokolliert, meldet das Ereignis und stößt den Lauf-Umbau an."""
    from services.draw_records import record_draws
    from services.heat_rebuild import evaluate_after_write
    from services.v2_result_submission import eliminated_registration_ids

    tid = tournament["id"]
    stage_matches = await db.matches_v2.find({"stage_id": stage_id, "is_preview": {"$ne": True}}, {"_id": 0}).to_list(3000)
    originals = {match["id"]: copy.deepcopy(match) for match in stage_matches}
    # Wer ausgetreten oder disqualifiziert ist, kommt nicht in den Topf (#1839) - wie beim Eintragen.
    application = build_show_draw_application(stage_matches, group, now_iso=now_utc().isoformat(), trigger=trigger,
                                              eliminated=await eliminated_registration_ids(db, tid))
    await write_draw_sets(db, originals, application["target_sets"])
    await record_draws(db, application["draws"], actor_id=actor_id, tournament_id=tid)
    # Erst auslosen, dann umbauen (#1550): die neue Belegung kann Läufe zusammenlegen oder ausgleichen.
    await evaluate_after_write(db, tid, actor_id=actor_id, trigger="draw")
    draw = application["draw"]
    return {
        "ok": True,
        "draw": {key: draw.get(key) for key in ("id", "group", "kind", "trigger", "drawn_at", "assignments")},
        "updated_match_ids": sorted(application["target_sets"]),
    }


# ---------------------------------------------------------------------------------------------- Der Job

async def _remind(db, tournament: dict, stage: dict | None, entry: dict, pot: list[str], now: datetime) -> int:
    """Genau eine Erinnerung je Runde: die Marke ``reminded_at`` wird nur gesetzt, wo sie noch fehlt."""
    from services.heat_rebuild import _structure_staff_user_ids
    from services.user_notifications import create_user_notification

    stored = await db.matches_v2.update_many(
        {"id": {"$in": [target["id"] for target in entry["targets"]]}, "draw_ready.group": entry["group"],
         "draw_ready.reminded_at": None, "draw": {"$exists": False}},
        {"$set": {"draw_ready.reminded_at": now.isoformat()}},
    )
    if not getattr(stored, "modified_count", 0):
        return 0
    minutes = show_minutes_of(tournament, (stage or {}).get("settings"))
    key = tournament.get("slug") or tournament["id"]
    label = next((((slot.get("source") or {}).get("draw") or {}).get("label")
                  for target in entry["targets"] for slot in target.get("slots") or []
                  if ((slot.get("source") or {}).get("draw") or {}).get("label")), None) or "Vorrunde"
    body = (f"{tournament.get('title') or 'Turnier'}: Die Auslosung nach {label} wartet seit {minutes} Minuten – "
            f"{len(pot)} Namen im Topf. Jetzt auslosen, sonst lost der Server in {minutes} Minuten selbst.")
    for user_id in sorted(await _structure_staff_user_ids(db, tournament["id"])):
        await create_user_notification(
            user_id, "Auslosung wartet", body, url=f"/tournaments/{key}/leitung?fall=draw-{entry['group']}",
            kind=REMINDER_KIND,
            meta={"category": "tournament_updates", "tournament_id": tournament["id"], "stage_id": entry.get("stage_id"),
                  "group": entry["group"], "reason": "draw_ready", "dedupe_key": f"draw-ready:{entry.get('stage_id')}:{entry['group']}:{entry.get('since')}"},
        )
    await db.audit_logs.insert_one({
        "id": f"audit-draw-remind-{entry.get('stage_id')}-{entry['group']}-{entry.get('since')}", "action": "tournament.draw.reminded",
        "target_id": tournament["id"], "actor_id": None,
        "data": {"stage_id": entry.get("stage_id"), "group": entry["group"], "pot_size": len(pot), "minutes": minutes},
        "created_at": now.isoformat(),
    })
    return 1


async def _draw_due(db, tournament: dict, entry: dict) -> int:
    """Nach der Frist lost der Server - unter der Turniersperre, mit frischem Stand (die Leitung kann inzwischen selbst
    gelost oder ein Ergebnis zurückgenommen haben)."""
    try:
        async with mutation_lock(db, tournament_write_resource(tournament["id"]), wait_seconds=2.0):
            fresh = await db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0, "creation_key": 0, "billing": 0})
            if not fresh or fresh.get("status") != "live" or fresh.get("locked_at"):
                return 0
            stage = await db.tournament_stages.find_one({"id": entry.get("stage_id")}, {"_id": 0})
            rows = await db.matches_v2.find({"stage_id": entry.get("stage_id"), "settings.draw_group": entry["group"],
                                             "is_preview": {"$ne": True}}, {"_id": 0}).to_list(500)
            current = next((item for item in ready_groups(rows) if item["group"] == entry["group"]), None)
            if not current or timing_of(current, fresh, stage)["due_at"] > now_utc():
                return 0
            try:
                await perform_show_draw(db, fresh, entry.get("stage_id"), entry["group"], actor_id=None, trigger="timeout")
            except MatchV2ResultError as exc:
                logger.info("Automatic show draw skipped tournament=%s group=%s detail=%s", tournament["id"], entry["group"], str(exc)[:120])
                return 0
    except MutationLockBusy:
        logger.info("Automatic show draw for tournament=%s waits for the tournament lock", tournament["id"])
        return 0
    return 1


async def sweep(db, *, now: datetime | None = None) -> dict:
    """Ein Lauf über alle laufenden Turniere: erinnern, was fällig ist, auslosen, was überfällig ist."""
    now = now or now_utc()
    reminded = drawn = 0
    tournaments = await db.tournaments.find({"status": "live"}, {"_id": 0, "creation_key": 0, "billing": 0}).to_list(200)
    for tournament in tournaments:
        matches = await db.matches_v2.find(
            {"tournament_id": tournament["id"], "draw_ready": {"$type": "object"}, "is_preview": {"$ne": True}}, {"_id": 0},
        ).to_list(3000)
        entries = [entry for entry in ready_groups(matches) if match_mode(entry["targets"][0]) == "draw_show"]
        if not entries:
            continue
        stage_rows = await db.tournament_stages.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(50)
        stages = {row["id"]: row for row in stage_rows if row.get("id")}
        all_matches = await db.matches_v2.find({"tournament_id": tournament["id"], "is_preview": {"$ne": True}}, {"_id": 0}).to_list(3000)
        for entry in entries:
            stage = stages.get(entry.get("stage_id") or "")
            timing = timing_of(entry, tournament, stage)
            if timing["due_at"] <= now:
                drawn += await _draw_due(db, tournament, entry)
                continue
            if timing["remind_at"] <= now and not entry.get("reminded_at"):
                reminded += await _remind(db, tournament, stage, entry, draw_pot(entry["group"], entry.get("stage_id"), all_matches), now)
    return {"reminded": reminded, "drawn": drawn}
