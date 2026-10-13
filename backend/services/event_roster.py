"""Wer zu einer Turnier-Anmeldung gehört - für den Rückblick (#1187) und „Freunde beim Event“ (#1188).

Nie das heutige Team: wer erst nach dem Turnier einem Team beitritt, war nicht dabei. Gezählt wird nur, was zur
Anmeldung gespeichert ist bzw. was die Mitgliedschaft mit Datum belegt:

- Einzel-Anmeldung: die angemeldete Person.
- Team-Anmeldung: wer das Team angemeldet hat (``user_id`` der Anmeldung, in der Regel der Kapitän), dazu
  - die gespeicherte Aufstellung samt Ersatz (``lineup``, ``substitutes`` an der Anmeldung, #1192), sonst
  - die Mitglieder aus ``team_members``, deren ``joined_at`` spätestens am letzten Turniertag (Wiener Tag) liegt.
    Ohne Beitrittsdatum zählt niemand - lieber eine Person zu wenig als eine, die nicht dabei war.
  ``teams.member_ids`` (der heutige Stand) wird bewusst nicht gelesen.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

VIENNA = ZoneInfo("Europe/Vienna")


def _vienna_day(value) -> date | None:
    if not value:
        return None
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    parsed = parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(VIENNA).date()


def tournament_day(tournament: dict | None) -> date | None:
    """Der letzte Turniertag in Wien - Ende, sonst Beginn."""
    tournament = tournament or {}
    return _vienna_day(tournament.get("end_date")) or _vienna_day(tournament.get("start_date"))


async def registration_players(db, registrations: list[dict], tournaments: dict[str, dict]) -> dict[str, set[str]]:
    """Anmeldung → die Personen, die dazu gehören (siehe oben). ``tournaments`` nach Kennung, für den Turniertag."""
    needs_members = {reg["team_id"] for reg in registrations if reg.get("team_id") and not reg.get("lineup")}
    joined: dict[str, list[tuple[str, date | None]]] = {}
    if needs_members:
        async for row in db.team_members.find({"team_id": {"$in": list(needs_members)}}, {"_id": 0, "team_id": 1, "user_id": 1, "joined_at": 1}):
            if row.get("user_id"):
                joined.setdefault(row["team_id"], []).append((row["user_id"], _vienna_day(row.get("joined_at"))))
    out: dict[str, set[str]] = {}
    for reg in registrations:
        players: set[str] = {reg["user_id"]} if reg.get("user_id") else set()
        if reg.get("team_id"):
            if reg.get("lineup"):
                players |= set(reg.get("lineup") or []) | set(reg.get("substitutes") or [])
            else:
                day = tournament_day(tournaments.get(reg.get("tournament_id")))
                players |= {user_id for user_id, since in joined.get(reg["team_id"], []) if since and day and since <= day}
        out[reg["id"]] = {player for player in players if player}
    return out
