"""Terminvorschläge nur in der Zukunft (#2124, TP8).

Ein Vorschlag oder Gegenvorschlag muss mindestens ``LEAD_MINUTES`` nach jetzt liegen - einen Termin in der
Vergangenheit kann niemand mehr spielen. Die Webseite setzt dieselbe Grenze als ``min`` ins Feld; der Server prüft
trotzdem, denn die App und ältere Seiten schicken ohne Grenze.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from models import now_utc

LEAD_MINUTES = 5
PAST_DETAIL = f"Der Termin liegt in der Vergangenheit – bitte einen Zeitpunkt frühestens {LEAD_MINUTES} Minuten ab jetzt wählen."


def _aware(moment: datetime) -> datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def refuse_past_proposal(moment: datetime | None) -> None:
    """422, wenn der vorgeschlagene Zeitpunkt früher als jetzt + ``LEAD_MINUTES`` liegt."""
    if moment is None:
        return
    if _aware(moment) < now_utc() + timedelta(minutes=LEAD_MINUTES):
        raise HTTPException(status_code=422, detail=PAST_DETAIL)


EXPIRED_DETAIL = "Dieser Vorschlag ist abgelaufen – der Termin ist schon vorbei. Bitte einen neuen Termin vorschlagen."


def refuse_expired_proposal(scheduled_at) -> None:
    """409 beim Annehmen eines Vorschlags, dessen Termin schon vorbei ist (#2124)."""
    if not scheduled_at:
        return
    try:
        moment = scheduled_at if isinstance(scheduled_at, datetime) else datetime.fromisoformat(str(scheduled_at).replace("Z", "+00:00"))
    except ValueError:
        return
    if _aware(moment) <= now_utc():
        raise HTTPException(status_code=409, detail=EXPIRED_DETAIL)
