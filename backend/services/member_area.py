"""Was im Mitgliederbereich offen ist (#1257): eine Antwort für die Sprungleiste im Mitgliederbereich und die Kacheln auf
/verein (Web) und im Tab „Verein“ der App - dieselben Zahlen überall.

- ``meetings_open``: kommende Versammlungen, auf die die Person noch nicht geantwortet hat, plus offene Abstimmungen, bei
  denen sie abstimmen kann; ``next_meeting`` die nächste Versammlung (mit Antwort) für die Zusage direkt in der Karte.
- ``helping_free`` / ``helping_mine``: freie Plätze bei Helferdiensten und eigene Dienste.
- ``news_new``: interne News (Mitglieder oder intern), die die Person sehen darf, aus den letzten zwei Wochen.
- ``documents`` / ``documents_new``: die Vereinsdokumente (ohne persönliche Schreiben aus der Vereinsakte, #1255) und wie
  viele davon in den letzten zwei Wochen dazugekommen sind.

Was aus Dolibarr kommt, fällt bei einem Ausfall einfach auf null - die Seite scheitert nie daran.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from models import now_utc
from services.visibility import user_can_see

logger = logging.getLogger("tls.member_area")

NEW_DAYS = 14   # „neu“ heißt: in den letzten zwei Wochen erschienen - für News und Dokumente gleich


def _moment(value) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        moment = datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


async def _meetings(db, user: dict) -> dict:
    from services import dolibarr_meetings

    try:
        view = await dolibarr_meetings.overview(db, user)
    except Exception as exc:  # noqa: BLE001 - die Zusammenfassung darf nie an Dolibarr scheitern
        logger.warning("[member_area] Versammlungen nicht lesbar: %s", exc)
        return {"open": 0, "ballots": 0, "next": None}
    upcoming = [row for row in view.get("meetings") or [] if row.get("upcoming")]
    upcoming.sort(key=lambda row: (row.get("day") or "", row.get("time") or ""))
    unanswered = [row for row in upcoming if not row.get("response")]
    ballots = [row for row in view.get("ballots") or [] if row.get("can_vote")]
    following = upcoming[0] if upcoming else None
    return {"open": len(unanswered), "ballots": len(ballots), "next": {
        key: following.get(key) for key in ("id", "kind", "kind_label", "title", "day", "time", "place", "format_label", "response", "response_label", "can_respond")
    } if following else None}


async def _helping(db, user: dict) -> dict:
    from services import dolibarr_helper_shifts

    try:
        view = await dolibarr_helper_shifts.overview(db, user)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[member_area] Helferdienste nicht lesbar: %s", exc)
        return {"free": 0, "mine": 0}
    return {"free": int(view.get("open_places") or 0), "mine": int(view.get("my_count") or 0)}


def _is_new(value, now: datetime) -> bool:
    moment = _moment(value)
    return bool(moment and now - timedelta(days=NEW_DAYS) <= moment <= now)


async def _news_new(db, user: dict, now: datetime) -> int:
    count = 0
    async for post in db.news_posts.find({"published": True, "visibility": {"$in": ["members", "internal"]}},
                                        {"_id": 0, "visibility": 1, "published_at": 1, "created_at": 1}):
        if _is_new(post.get("published_at") or post.get("created_at"), now) and await user_can_see(user, post.get("visibility")):
            count += 1
    return count


async def summary(db, user: dict, *, now: datetime | None = None) -> dict:
    from routes.document_routes import club_documents_for

    now = now or now_utc()
    meetings = await _meetings(db, user)
    helping = await _helping(db, user)
    try:
        documents = await club_documents_for(db, user)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[member_area] Dokumente nicht zählbar: %s", exc)
        documents = []
    return {
        "meetings_open": meetings["open"] + meetings["ballots"], "ballots_open": meetings["ballots"], "next_meeting": meetings["next"],
        "helping_free": helping["free"], "helping_mine": helping["mine"],
        "news_new": await _news_new(db, user, now),
        "documents": len(documents), "documents_new": sum(1 for doc in documents if _is_new(doc.get("created_at"), now)),
    }
