"""Team am Spieltag (#1192): Aufstellung wählen und sehen, wer da ist - nur bei Team-Turnieren.

Fabian wollte beides (Einstellung „Team am Spieltag: beides“, keine Nutzer-Einstellung):

- **Aufstellung**: Kapitän oder Co-Kapitän wählt vor dem Spieltag, wer spielt - genau so viele, wie das Turnier
  Spieler je Team hat. Sind Ersatzspieler erlaubt, sind alle anderen Mitglieder Ersatz; sonst gibt es keinen.
  Änderbar bis zum Ende des Check-ins (``check_in_until``) und nie mehr, wenn das Turnier läuft. Gespeichert an der
  Team-Anmeldung (``lineup``, ``substitutes``) - die Turnierleitung sieht sie beim Check-in.
- **Wer ist da**: Am Turniertag (Wiener Kalender, vom Start- bis zum Endtag) tippt jedes Mitglied „Ich bin da“.
  Gezählt werden die Aufgestellten samt Ersatz, ohne Aufstellung alle Mitglieder. Der Kapitän sieht „4 von 5 da“
  und kann Fehlende anstupsen - eine Meldung, höchstens alle 10 Minuten je Team.

Wer welche Nachricht bekommt (#1136): Aufruf und Spiel-Meldungen gehen an die Aufgestellten, ohne Aufstellung an
alle Mitglieder (Ergebnis, Erinnerung, Aufruf an der Station). Die Regel steht an einer Stelle in
``services.match_audience`` (``playing_ids``); ``registration_recipients`` reicht sie nur weiter.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from models import now_utc
from services.match_audience import playing_user_ids

VIENNA = ZoneInfo("Europe/Vienna")
NUDGE_MINUTES = 10
LOCKED_STATUSES = {"live", "paused", "completed", "results_published", "archived", "cancelled"}
CLOSED_REGISTRATIONS = {"rejected", "no_show"}


def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def is_team_tournament(tournament: dict | None) -> bool:
    return bool(tournament) and (tournament.get("team_mode") or "solo") != "solo"


def team_size(tournament: dict) -> int:
    try:
        return max(1, int(tournament.get("team_size") or 2))
    except (TypeError, ValueError):
        return 2


def can_lead(team: dict | None, user: dict | None) -> bool:
    """Aufstellen und Anstupsen: nur Kapitän und Co-Kapitän des Teams."""
    if not team or not user:
        return False
    return team.get("leader_id") == user.get("id") or user.get("id") in (team.get("co_leader_ids") or [])


def lineup_deadline(tournament: dict) -> datetime | None:
    return _parse(tournament.get("check_in_until"))


def lineup_open(tournament: dict, registration: dict, now: datetime | None = None) -> bool:
    if tournament.get("status") in LOCKED_STATUSES or registration.get("status") in CLOSED_REGISTRATIONS:
        return False
    deadline = lineup_deadline(tournament)
    return not (deadline and (now or now_utc()) > deadline)


def tournament_days(tournament: dict) -> tuple[str, str] | None:
    """Erster und letzter Turniertag im Wiener Kalender - ohne Startzeit keiner."""
    start = _parse(tournament.get("start_date"))
    if not start:
        return None
    end = _parse(tournament.get("end_date")) or start
    first = start.astimezone(VIENNA).date().isoformat()
    last = max(end, start).astimezone(VIENNA).date().isoformat()
    return first, last


def is_tournament_day(tournament: dict, now: datetime | None = None) -> bool:
    days = tournament_days(tournament)
    if not days:
        return False
    today = (now or now_utc()).astimezone(VIENNA).date().isoformat()
    return days[0] <= today <= days[1]


def counted_members(team: dict, registration: dict) -> list[str]:
    """Wer bei „Wer ist da“ zählt: die Aufgestellten samt Ersatz, ohne Aufstellung alle Mitglieder."""
    lineup = list(registration.get("lineup") or [])
    if lineup:
        return lineup + [uid for uid in registration.get("substitutes") or [] if uid not in lineup]
    return list(team.get("member_ids") or [])


def validate_lineup(team: dict, tournament: dict, starters: list[str]) -> tuple[list[str], list[str]]:
    """Genau so viele Aufgestellte wie Spieler je Team, alle aus dem Team; Ersatz sind die übrigen, wenn erlaubt."""
    members = list(team.get("member_ids") or [])
    clean: list[str] = []
    for uid in starters or []:
        if uid not in members:
            raise HTTPException(status_code=400, detail="Aufstellen kannst du nur Mitglieder des Teams.")
        if uid in clean:
            raise HTTPException(status_code=400, detail="Jede Person steht nur einmal in der Aufstellung.")
        clean.append(uid)
    size = team_size(tournament)
    if len(clean) != size:
        raise HTTPException(status_code=400, detail=f"Bei diesem Turnier spielen {size} je Team – bitte genau {size} auswählen.")
    substitutes = [uid for uid in members if uid not in clean] if tournament.get("substitutes_allowed") else []
    return clean, substitutes


async def registration_recipients(db, registrations: list[dict]) -> set[str]:
    """Wer zu einer Anmeldung Spiel-Meldungen bekommt (#1192, #1136): Einzel die Person; Team die Aufgestellten,
    ohne Aufstellung alle Mitglieder samt Leitung (aus dem Team und der Mitgliederliste)."""
    return await playing_user_ids(db, registrations)


def minutes_until(moment: str, now: datetime | None = None) -> int:
    target = _parse(moment)
    if not target:
        return 0
    seconds = (target - (now or now_utc())).total_seconds()
    return max(1, int(seconds // 60) + (1 if seconds % 60 else 0))


def nudge_available_at(registration: dict) -> str | None:
    last = _parse(registration.get("presence_nudged_at"))
    if not last:
        return None
    return (last + timedelta(minutes=NUDGE_MINUTES)).isoformat()
