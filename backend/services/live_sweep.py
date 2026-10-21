"""Welche laufenden Turniere die Minuten-Jobs ansehen (#1940) - Show-Auslosung (services/draw_show) und Fristen
(services/match_deadline_sweep).

Gesucht wird von den Spielen her: nur Turniere, an deren Spielen etwas fällig sein kann (eine wartende Auslosung, ein
offenes Spiel), über einen Index (database.init_indexes) - und davon die mit Status „live“, ohne feste Obergrenze.
Vorher lasen beide Jobs die ersten 200 Turniere mit Status „live“ ohne Reihenfolge; standen mehr da (alte Seeds und
Probeläufe), fiel der Cup des Abends still heraus.

Stehen ungewöhnlich viele Turniere auf „live“, sagt es das Log - höchstens einmal je Stunde und Job.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from models import now_utc

logger = logging.getLogger("tls.live_sweep")

# Ab so vielen laufenden Turnieren meldet sich das Log - am Abend laufen eine Handvoll.
LIVE_WARN_THRESHOLD = 50
LIVE_WARN_EVERY = timedelta(hours=1)
TOURNAMENT_PROJECTION = {"_id": 0, "creation_key": 0, "billing": 0}

_last_warned: dict[str, datetime] = {}


async def warn_if_many_live(db, job: str, now: datetime | None = None) -> int:
    """Zählt die Turniere mit Status „live“ und warnt ab der Schwelle - je Job höchstens einmal je Stunde."""
    now = now or now_utc()
    count = await db.tournaments.count_documents({"status": "live"})
    last = _last_warned.get(job)
    if count >= LIVE_WARN_THRESHOLD and (last is None or now - last >= LIVE_WARN_EVERY):
        _last_warned[job] = now
        logger.warning("[%s] %s Turniere stehen auf „live“ - alte Probeläufe beenden oder archivieren", job, count)
    return count


async def live_tournaments_with(db, match_filter: dict, *, job: str, now: datetime | None = None) -> list[dict]:
    """Die laufenden Turniere, an deren Spielen ``match_filter`` passt (Vorschau-Spiele zählen nie) - alle, sortiert."""
    await warn_if_many_live(db, job, now)
    ids = await db.matches_v2.distinct("tournament_id", {**match_filter, "is_preview": {"$ne": True}})
    ids = sorted(str(value) for value in ids if value)
    if not ids:
        return []
    return await db.tournaments.find({"id": {"$in": ids}, "status": "live"}, TOURNAMENT_PROJECTION) \
        .sort("id", 1).to_list(None)
