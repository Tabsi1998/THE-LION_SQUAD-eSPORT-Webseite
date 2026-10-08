"""Aufruf beim Reservieren der Station (#1137) - dieselben Daten wie die Aufruf-Tafel am TV (#1122).

Weist die Turnierleitung ein Spiel einer Station zu, ohne es zu starten, ist es „aufgerufen“: am Spiel und an der
Station steht ``called_at``. Entscheidung des Betreibers (07.10.2026): Bei Turnieren vor Ort mit fester Zeit reicht
dieser Aufruf - mit Countdown aufs Handy und auf den TV. Eine Erinnerung 10 Minuten vorher gibt es dort nicht.

- Nachricht: einmal je Aufruf an alle Spieler des Spiels (#1136: bei Teams jedes Mitglied) - im Postfach und per Push.
  Wird dieselbe Reservierung noch einmal gespeichert, bleibt ``called_at`` - und damit bleibt es bei einer Nachricht.
- Countdown: bis zur geplanten Zeit des Spiels; ohne geplante Zeit - oder wenn die schon vor dem Aufruf lag - die
  „Zeit zum Antreten“ der TV-Einstellungen ab dem Aufruf (Standard 2 Minuten). Dieselbe Rechnung wie
  frontend/src/lib/tvCalls.js; Matchseite in Web und App bekommen das fertige ``report_by`` vom Server.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from services.match_audience import match_player_users, registrations_for_match
from services.station_labels import station_text
from services.tv_display import SETTINGS_ID as TV_SETTINGS_ID, merge as merge_tv_settings
from services.user_notifications import create_user_notification

# Solange ein Spiel einen dieser Zustände hat, darf ein Aufruf stehen bleiben (wie match_routes.CALL_OPEN_STATUSES).
CALL_OPEN_STATUSES = {"pending", "preview", "ready", "scheduled"}


def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


async def report_minutes(db) -> int:
    """„Zeit zum Antreten“ aus den TV-Einstellungen (Standard 2 Minuten)."""
    stored = await db.settings.find_one({"id": TV_SETTINGS_ID}, {"_id": 0}) or {}
    return int(merge_tv_settings(stored).get("report_minutes") or 2)


def report_by(match: dict, called_at, minutes: int) -> datetime | None:
    """Bis wann die Spieler an der Station sein sollen - wie ``callsOf`` der Aufruf-Tafel."""
    called = _parse(called_at)
    scheduled = _parse(match.get("scheduled_at"))
    if scheduled and (called is None or scheduled > called):
        return scheduled
    if called:
        return called + timedelta(minutes=max(1, int(minutes or 2)))
    return None


async def call_view(db, match: dict) -> dict | None:
    """Der laufende Aufruf für die Matchseite: aufgerufen um, antreten bis und die Station im Klartext."""
    if not match.get("called_at") or str(match.get("status") or "pending") not in CALL_OPEN_STATUSES:
        return None
    due = report_by(match, match.get("called_at"), await report_minutes(db))
    return {
        "called_at": match.get("called_at"),
        "report_by": due.isoformat() if due else None,
        "station_text": match.get("station_text") or "",
    }


def _clock(moment: datetime | None) -> str:
    return moment.astimezone(ZoneInfo("Europe/Vienna")).strftime("%H:%M") if moment else ""


async def notify_match_called(db, match: dict, station: dict, called_at: str) -> int:
    """„Du bist dran“ - einmal je Aufruf an alle Spieler des Spiels, im Postfach und per Push."""
    users = await match_player_users(db, match)
    if not users:
        return 0
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "title": 1}) or {}
    registrations = await registrations_for_match(db, match)
    names = [reg.get("display_name") or reg.get("ingame_name") for reg in registrations]
    names = [name for name in names if name]
    where = station_text(station.get("name") or station.get("label"), station.get("device_type")) or "deiner Station"
    due = report_by(match, called_at, await report_minutes(db))
    what = " gegen ".join(names[:2]) if len(names) == 2 else (f"Durchgang {match.get('match_key')}" if match.get("match_key") else "Dein Spiel")
    body = f"{tournament.get('title') or 'Turnier'}: {what} – bitte {f'bis {_clock(due)} ' if due else ''}an {where} antreten."
    dedupe = f"match_call:{match.get('id')}:{station.get('id')}:{called_at}"
    sent = 0
    for user in users:
        if await create_user_notification(
            user["id"],
            f"Du bist dran: {where}",
            body,
            url=f"/matches/{match.get('id')}",
            kind="match_call",
            meta={
                "category": "match_reminders",
                "dedupe_key": dedupe,
                "match_id": match.get("id"),
                "tournament_id": match.get("tournament_id"),
                "station_id": station.get("id"),
                "called_at": called_at,
                "report_by": due.isoformat() if due else None,
            },
        ):
            sent += 1
    return sent
