"""Tageszusammenfassung für den Betrieb (#1657).

Einmal am Tag, ab der Stunde unter Betrieb → Alarme (Vorgabe 8 Uhr Wiener Zeit), geht über den gewohnten Weg
(Ereignisart „Tageszusammenfassung“: Discord-Betriebskanal, auf Wunsch Mail) eine kurze Übersicht der letzten 24 Stunden:
aktive und neue Fehlergruppen, die häufigsten fünf, offene Gruppen, Ausfälle und die Häufungen aus Website und App
(die sich nie sofort melden). An ruhigen Tagen kommt nichts.

Nie doppelt: Der Schlüssel ``daily:<Datum>`` wird für zwei Tage geholt (``claim_alert``) - auch zwei Läufe zugleich
oder ein Neustart senden ihn nur einmal. Scheitert der Versand, versucht es der nächste Lauf nach dem wachsenden
Mindestabstand. Die Zeile im Alarm-Verlauf gilt sofort als erledigt - eine Zusammenfassung ist kein offenes Problem.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from models import now_utc
from services import ops_alerts

VIENNA = ZoneInfo("Europe/Vienna")
TOP_LIMIT = 5
CLAIM_SECONDS = 2 * 86400


def _plural(count: int, one: str, many: str) -> str:
    return f"{count} {one if count == 1 else many}"


def _label(row: dict) -> str:
    source = ops_alerts.SOURCE_LABELS.get(row.get("source") or "server", "Server")
    place = f"{row.get('method') or ''} {row.get('route') or ''}".strip() or "/"
    return f"{row.get('error_type') or 'Fehler'} auf {place} ({source})"


async def build_summary(db, now: datetime) -> dict | None:
    since = (now - timedelta(hours=24)).isoformat()
    active = await db.ops_errors.find({"last_seen_at": {"$gte": since}}, {"_id": 0, "stack": 0}).to_list(2000)
    outages = await db.ops_alert_log.count_documents({"kind": "reachability", "at": {"$gte": since}, "key": {"$not": {"$regex": ":back$"}}})
    if not active and not outages:
        return None
    new = sum(1 for row in active if str(row.get("first_seen_at") or "") >= since)
    still_open = await db.ops_errors.count_documents({"resolved_at": None})
    top = sorted(active, key=lambda row: -int(row.get("count") or 0))[:TOP_LIMIT]
    lines = [
        f"{_plural(len(active), 'Fehlergruppe', 'Fehlergruppen')} aktiv, davon {new} neu · {still_open} offen insgesamt · "
        f"{_plural(outages, 'Ausfall', 'Ausfälle')}.",
    ]
    for row in top:
        lines.append(f"• {int(row.get('count') or 0)}× {_label(row)}")
    # Häufungen aus Website und App (#1657) melden sich nie sofort - hier stehen sie.
    bursts = [row for row in active if row.get("source") in ("web", "app") and str(row.get("spike_window") or "") >= since]
    if bursts:
        lines.append(f"Häufungen aus Website und App: {len(bursts)}")
        for row in sorted(bursts, key=lambda item: -int(item.get("spike_count") or 0))[:TOP_LIMIT]:
            lines.append(f"• Häufung: {_label(row)}")
    return {"description": "\n".join(lines), "fields": [{"name": "Zeitraum", "value": "letzte 24 Stunden", "inline": True}]}


async def send_daily_summary(db, now: datetime | None = None) -> dict:
    current = now or now_utc()
    local = current.astimezone(VIENNA)
    settings = await ops_alerts.load_alert_settings(db)
    if local.hour < int(settings["daily_summary_hour"]):
        return {"sent": False, "reason": "early"}
    key = f"daily:{local.date().isoformat()}"
    if await db.ops_alert_state.find_one({"key": key, "last_sent_at": {"$ne": None}}, {"_id": 0, "key": 1}):
        return {"sent": False, "reason": "already"}
    summary = await build_summary(db, current)
    if summary is None:
        return {"sent": False, "reason": "quiet"}
    claim = await ops_alerts.claim_alert(db, key, now=current, window_seconds=CLAIM_SECONDS)
    if claim is None:
        return {"sent": False, "reason": "already"}
    from services.date_text import format_moment

    title = f"Betrieb: Tageszusammenfassung {format_moment(local, time=False)}"
    outcome = await ops_alerts.notify(db, "daily_summary", title, summary["description"], summary["fields"], key=key, force=True,
                                      event_key="ops_daily_summary", log_gate=lambda: ops_alerts.claim_failure_log(db, key))
    await db.ops_alert_log.update_many({"key": key, "resolved_at": None}, {"$set": {"resolved_at": current.isoformat()}})
    if outcome.get("reason") == "failed":
        await ops_alerts.alert_failed(db, claim)
        return {"sent": False, "reason": "failed"}
    if outcome.get("sent"):
        return {"sent": True, "channels": outcome["channels"]}
    # Kein Weg eingerichtet: der Tag gilt als erledigt, die Zeile steht einmal im Verlauf.
    return {"sent": False, "reason": outcome.get("reason")}
