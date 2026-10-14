"""Records which competition write path actually runs.

Before the classic store can be switched off, one question has to be answered
with numbers rather than with confidence: is anything still writing to it? The
codebase can show that a path *exists*; only measurement shows whether it is
*used*, and by which format.

Recording is deliberately best-effort. A failed measurement must never turn into
a failed tournament operation, so every error is swallowed - a missing data point
is acceptable, a broken result entry is not.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from database import get_db
from models import now_utc
from services.log_safe import log_safe

logger = logging.getLogger("tls.competition.usage")

COLLECTION = "competition_write_usage"

CLASSIC = "classic"
GRAPH = "graph"


def engine_for_match(match: dict | None) -> str:
    """Tell the two match shapes apart without asking the database again.

    Graph matches carry a stage and slots; classic ones carry the fixed A/B
    participant fields. Anything else is recorded as unknown rather than guessed
    into one of the two - a wrong number here would be worse than a missing one.
    """
    if not match:
        return "unknown"
    if match.get("stage_id") or match.get("slots") is not None:
        return GRAPH
    if "participant_a_id" in match or "score_a" in match:
        return CLASSIC
    return "unknown"


async def record_write(
    engine: str,
    capability: str,
    *,
    tournament_id: str | None = None,
    format_key: str | None = None,
    detail: str | None = None,
) -> None:
    """Note that one competition write happened. Never raises."""
    try:
        await get_db()[COLLECTION].insert_one({
            "engine": engine,
            "capability": capability,
            "tournament_id": tournament_id,
            "format": format_key,
            "detail": detail,
            "created_at": now_utc(),
        })
    except Exception as exc:
        logger.debug("[usage] not recorded capability=%s type=%s", log_safe(capability, 80), type(exc).__name__)


async def usage_summary(days: int = 30) -> dict:
    """Counts per engine and capability for the given window.

    This is the number the consolidation decisions hang on: as long as the
    classic engine shows writes, switching it off would remove something that is
    still in use.
    """
    since = now_utc() - timedelta(days=max(1, days))
    db = get_db()
    rows = await db[COLLECTION].aggregate([
        {"$match": {"created_at": {"$gte": since}}},
        {"$group": {
            "_id": {"engine": "$engine", "capability": "$capability"},
            "count": {"$sum": 1},
            "last_at": {"$max": "$created_at"},
            "tournaments": {"$addToSet": "$tournament_id"},
        }},
    ]).to_list(500)

    by_engine: dict[str, int] = {}
    capabilities = []
    for row in rows:
        engine = row["_id"].get("engine") or "unknown"
        by_engine[engine] = by_engine.get(engine, 0) + row["count"]
        capabilities.append({
            "engine": engine,
            "capability": row["_id"].get("capability") or "unknown",
            "count": row["count"],
            "last_at": row.get("last_at"),
            "tournament_count": len([t for t in row.get("tournaments", []) if t]),
        })

    capabilities.sort(key=lambda item: (-item["count"], item["capability"]))
    return {
        "window_days": days,
        "total": sum(by_engine.values()),
        "by_engine": by_engine,
        "classic_writes": by_engine.get(CLASSIC, 0),
        "graph_writes": by_engine.get(GRAPH, 0),
        "capabilities": capabilities,
    }
