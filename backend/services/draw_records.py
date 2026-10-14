"""Auslosungen festhalten (#1548): Protokoll mit Zeitpunkt, Person und Ergebnis, dazu das Live-Ereignis ``draw_done``.

Eine Auslosung entsteht beim Ergebnis, das eine Runde fertig macht (Person: wer es eingetragen hat), beim Bau, wenn eine
Runde schon kampflos entschieden ist (Person: wer gebaut hat), oder mit „Neu auslosen“ durch die Turnierleitung. Das
Protokoll (``audit_logs``) ist nur für die Verwaltung; öffentlich geht nur das Ereignis ohne Einzelheiten raus.
"""
from __future__ import annotations

import logging
from collections import defaultdict

from services.change_events import publish_draw_done

logger = logging.getLogger("tls.draws")

ACTION_DONE = "tournament.draw.done"
ACTION_REDRAWN = "tournament.draw.redrawn"


async def record_draws(db, draws: list[dict] | None, *, actor_id: str | None, tournament_id: str | None = None) -> int:
    """Jede Auslosung genau einmal ins Protokoll (Kennung der Auslosung) und als Live-Ereignis."""
    count = 0
    for draw in draws or []:
        target_id = draw.get("tournament_id") or tournament_id
        if not target_id or not draw.get("id"):
            continue
        action = ACTION_REDRAWN if draw.get("trigger") == "redraw" else ACTION_DONE
        await db.audit_logs.update_one(
            {"id": f"audit-draw-{draw['id']}"},
            {"$setOnInsert": {
                "id": f"audit-draw-{draw['id']}",
                "action": action,
                "target_id": target_id,
                "actor_id": actor_id,
                "data": {
                    "stage_id": draw.get("stage_id"),
                    "group": draw.get("group"),
                    "draw_id": draw["id"],
                    "kind": draw.get("kind") or "advancement",
                    "trigger": draw.get("trigger"),
                    "assignments": draw.get("assignments") or [],
                },
                "created_at": draw.get("drawn_at"),
            }},
            upsert=True,
        )
        try:
            await publish_draw_done(target_id, {
                "tournament_id": target_id,
                "stage_id": draw.get("stage_id"),
                "group": draw.get("group"),
                "draw_id": draw["id"],
                "kind": draw.get("kind") or "advancement",
            })
        except Exception as exc:  # noqa: BLE001 - das Ereignis ist ein Hinweis, das Protokoll steht schon
            logger.warning("draw_done event failed type=%s", type(exc).__name__)
        count += 1
    return count


def draws_from_matches(matches: list[dict]) -> list[dict]:
    """Die Auslosungen, die schon beim Bau entstanden sind (Liga-Spieltage, kampflos entschiedene Runde) - aus den
    gebauten Spielen gelesen, damit sie wie jede andere ins Protokoll kommen."""
    by_draw: dict[str, dict] = {}
    assignments: dict[str, list[dict]] = defaultdict(list)
    for match in sorted(matches, key=lambda row: (row.get("round") or 0, row.get("order") or 0)):
        marker = match.get("draw")
        if not isinstance(marker, dict) or not marker.get("id") or match.get("is_preview"):
            continue
        by_draw.setdefault(marker["id"], {
            **marker,
            "kind": marker.get("kind") or "advancement",
            "stage_id": match.get("stage_id"),
            "tournament_id": match.get("tournament_id"),
        })
        slots = match.get("slots") or []
        if marker.get("kind") == "league":
            assignments[marker["id"]].append({
                "match_id": match.get("id"), "match_key": match.get("match_key"), "round": match.get("round"),
                "home": slots[0].get("registration_id") if slots else None,
                "away": slots[1].get("registration_id") if len(slots) > 1 else None,
            })
            continue
        for slot in slots:
            origin = slot.get("source_result") or {}
            if origin.get("draw_id") != marker["id"]:
                continue
            assignments[marker["id"]].append({
                "match_id": match.get("id"), "match_key": match.get("match_key"), "slot": slot.get("slot"),
                "registration_id": slot.get("registration_id"), "from_match_key": origin.get("from_match_key"),
                "rank": origin.get("rank"), "flow": origin.get("flow"),
            })
    return [{**draw, "assignments": assignments[draw_id]} for draw_id, draw in by_draw.items()]


async def record_build_draws(db, matches: list[dict], *, actor_id: str | None) -> int:
    return await record_draws(db, draws_from_matches(matches), actor_id=actor_id)
