"""Stand des Abstimmungs-Feeds (#1420: aus services/dolibarr_ballot_watch.py herausgelöst).

Die offenen Abstimmungen (services/dolibarr_meetings.py) fragen hier, ob der Feed läuft; der Feed selbst
(dolibarr_ballot_watch) liest die Versammlungen. Ein Blatt, damit sich die beiden nicht gegenseitig importieren.
"""
from __future__ import annotations

STATE_ID = "dolibarr_ballot_watch"


async def load_state(db) -> dict:
    return await db.settings.find_one({"id": STATE_ID}, {"_id": 0}) or {"id": STATE_ID}


async def feed_state(db) -> str:
    """„ok“, „forbidden“ oder „error“ - ohne Feed fragen offene Seiten am Versammlungstag selbst nach."""
    return str((await load_state(db)).get("feed") or "")
