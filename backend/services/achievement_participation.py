"""Wer hat gespielt (#2337): die eine Grundlage der Turnier- und Spiel-Erfolge einer Person.

Früher zählte alles über ``tournament_registrations.user_id`` - bei einem Team also nur für die Person, die es angemeldet
hat, und in einer Liga-Staffel (Anmeldung ohne Person) für niemanden. Jetzt gilt für jedes Spiel einzeln:

- Einzel-Anmeldung: die Person selbst.
- Team mit Teilnehmerliste am Spiel (Liga: ``lineups`` am Spiel bzw. an seinen Maps): wer darauf steht.
- Team mit Aufstellung an der Anmeldung (Team am Spieltag, ``lineup``): die Aufgestellten.
- Co-Team ohne beides: sein Kader.
- sonst: alle, die zum Zeitpunkt des Spiels im Team waren - aus dem heutigen Stand (``teams``, ``team_members``) und dem
  Protokoll (``team.join`` / ``team.leave`` / ``team.kick``), für aufgelöste Teams aus ``dissolved_teams``. Wer das Team
  später verlässt, behält so, was er mit ihm gespielt hat.

``Played`` ist ein Spiel aus Sicht der Person. Was als Spiel zählt (nie ein Freilos, kampflos nur für den Sieger), steht in
``services.match_winner``. ``Participation.entries`` sind die Teilnahmen: angenommen oder eingecheckt, mindestens ein
echtes Spiel selbst gespielt, Turnier nicht abgesagt.

Der alte Zähler-Block und die Registry rechnen aus derselben ``Participation``; innerhalb eines Laufs (``shared``) wird sie
je Person nur einmal geladen.
"""
from __future__ import annotations

import contextlib
import contextvars
from dataclasses import dataclass
from datetime import datetime, timezone

from services.competition_standings import STANDING_REGISTRATION_STATUSES, badge_match_progress
from services.league_scope import is_league_staffel
from services.match_winner import is_real_match, lost_by, no_show_ids, participant_ids, won_by

# Ein Turnier ist abgeschlossen, wenn es beendet, veröffentlicht oder archiviert ist - erst dann stehen Plätze fest.
DONE_TOURNAMENT_STATUSES = frozenset({"completed", "results_published", "archived"})
TOURNAMENT_FIELDS = {"_id": 0, "id": 1, "status": 1, "format": 1, "game_id": 1, "season_id": 1, "stream_url": 1, "is_public": 1,
                     "registration_opens_at": 1, "registration_open_from": 1, "league_context": 1, "seeding_mode": 1, "start_date": 1}
MATCH_FIELDS = {"_id": 0, "id": 1, "tournament_id": 1, "status": 1, "slots": 1, "results": 1, "winner_id": 1, "completed_at": 1,
                "updated_at": 1, "scheduled_at": 1, "best_of": 1, "map": 1, "maps": 1, "disputes": 1, "forfeit_registration_id": 1,
                "section": 1, "bracket": 1, "round_name": 1, "group_id": 1, "stage_number": 1, "round": 1, "order": 1,
                "match_type": 1, "is_preview": 1, "lineups": 1, "games.lineups": 1}

_SHARED: contextvars.ContextVar[dict | None] = contextvars.ContextVar("achievement_participation", default=None)


def parse_time(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


@dataclass(frozen=True)
class Played:
    """Ein echtes Spiel aus Sicht der Person. ``no_show``: ihre Seite ist nicht angetreten - das Spiel zählt für sie nicht
    als gespielt, ist aber eine Niederlage, wenn es einen Sieger gibt."""

    match: dict
    mine: frozenset
    opponents: frozenset
    when: datetime | None
    won: bool
    lost: bool
    no_show: bool


class TeamTimeline:
    """Wann die Person in welchem Team war."""

    def __init__(self) -> None:
        self.joined: dict[str, datetime | None] = {}  # heute Mitglied: seit wann (None = unbekannt, also schon immer)
        self.events: dict[str, list[tuple[datetime, str]]] = {}  # Beitritt und Austritt aus dem Protokoll
        self.closed: dict[str, tuple[datetime | None, datetime | None]] = {}  # aufgelöste Teams: (seit, bis)

    def team_ids(self) -> set[str]:
        return set(self.joined) | set(self.events) | set(self.closed)

    def knows(self, team_id: str | None) -> bool:
        return team_id in self.joined or team_id in self.events or team_id in self.closed

    def member_at(self, team_id: str | None, when: datetime | None) -> bool:
        if team_id in self.joined:
            since = self.joined[team_id]
            if when is None or since is None or since <= when:
                return True
        if when is None:
            return False
        if team_id in self.closed:
            since, until = self.closed[team_id]
            if (since is None or since <= when) and (until is None or when <= until):
                return True
        events = self.events.get(team_id) or []
        left_later = [stamp for stamp, kind in events if kind == "leave" and stamp >= when]
        if not left_later:
            return False
        left = min(left_later)
        joins = [stamp for stamp, kind in events if kind == "join" and stamp <= left]
        # Ohne Beitritt im Protokoll (Gründung, älterer Bestand) war die Person vor dem Austritt schon immer dabei.
        return not joins or max(joins) <= when


def lineup_of(match: dict, registration_id: str) -> set[str]:
    """Die Teilnehmerliste einer Seite an diesem Spiel (Liga): am Spiel und an seinen Maps."""
    listed = set((match.get("lineups") or {}).get(registration_id) or [])
    for game in match.get("games") or []:
        if isinstance(game, dict):
            listed.update((game.get("lineups") or {}).get(registration_id) or [])
    return {user_id for user_id in listed if user_id}


class Participation:
    """Anmeldungen, Turniere und Spiele einer Person - auch über ihre Teams."""

    def __init__(self, user_id: str, registrations: dict[str, dict], tournaments: dict[str, dict], matches: list[dict],
                 timeline: TeamTimeline, squads: dict[str, set[str]]):
        self.user_id = user_id
        self.registrations = registrations
        self.tournaments = tournaments
        self.matches = matches
        self.timeline = timeline
        self.squads = squads
        self.rows: list[Played] = [row for row in (self._row(match) for match in matches) if row]
        self.played: list[Played] = [row for row in self.rows if not row.no_show]

    # ------------------------------------------------ wer zählt für eine Anmeldung in einem Spiel

    def plays(self, registration: dict, match: dict, when: datetime | None) -> bool:
        if not registration.get("team_id"):
            return registration.get("user_id") == self.user_id
        listed = lineup_of(match, registration["id"])
        if listed:
            return self.user_id in listed
        lineup = [user_id for user_id in registration.get("lineup") or [] if user_id]
        if lineup:
            return self.user_id in lineup
        squad = self.squads.get(registration.get("squad_id") or "")
        if squad:
            return self.user_id in squad
        team_id = registration["team_id"]
        if self.timeline.member_at(team_id, when):
            return True
        # Ein Team, von dem es weder Mitglieder noch Protokoll gibt (älterer Bestand): dann zählt, wer es angemeldet hat.
        return registration.get("user_id") == self.user_id and not self.timeline.knows(team_id)

    def _row(self, match: dict) -> Played | None:
        if not is_real_match(match):
            return None
        sides = participant_ids(match)
        candidates = sides & set(self.registrations)
        if not candidates:
            return None
        tournament = self.tournaments.get(match.get("tournament_id")) or {}
        when = parse_time(match.get("completed_at") or match.get("updated_at") or match.get("scheduled_at"))
        mine = frozenset(reg_id for reg_id in candidates
                         if self.plays(self.registrations[reg_id], match, when or parse_time(tournament.get("start_date"))))
        if not mine:
            return None
        no_show = bool(mine & no_show_ids(match))
        return Played(match=match, mine=mine, opponents=frozenset(sides - mine), when=when,
                      won=not no_show and won_by(match, mine), lost=lost_by(match, mine), no_show=no_show)

    # ------------------------------------------------ Sichten

    @property
    def registration_ids(self) -> set[str]:
        """Alle Anmeldungen, an denen die Person hängt - die eigenen und die ihrer Teams."""
        return set(self.registrations)

    @property
    def played_registration_ids(self) -> set[str]:
        """Die Anmeldungen, für die die Person mindestens ein echtes Spiel selbst gespielt hat."""
        return {reg_id for row in self.played for reg_id in row.mine}

    def is_league(self, tournament_id: str | None) -> bool:
        return is_league_staffel(self.tournaments.get(tournament_id))

    def is_done(self, tournament_id: str | None) -> bool:
        return (self.tournaments.get(tournament_id) or {}).get("status") in DONE_TOURNAMENT_STATUSES

    def entries(self) -> list[dict]:
        """Die Teilnahmen: angenommen oder eingecheckt (ohne Status gilt älterer Bestand als angenommen), mindestens ein
        echtes Spiel selbst gespielt, das Turnier nicht abgesagt. Liga-Staffeln sind dabei - wer sie nicht will, fragt
        ``is_league``."""
        played = self.played_registration_ids
        out = []
        for registration in self.registrations.values():
            tournament = self.tournaments.get(registration.get("tournament_id"))
            if (registration.get("id") in played and tournament and tournament.get("status") != "cancelled"
                    and (registration.get("status") or "approved") in STANDING_REGISTRATION_STATUSES):
                out.append(registration)
        return out

    def match_progress(self) -> dict:
        """Spielmacher, Sieger und Siegesserie - dieselbe Rechnung wie ``registration_badge_match_progress``."""
        return badge_match_progress((row.match, row.mine) for row in self.rows)


# ---------------------------------------------------------------- Laden

@contextlib.contextmanager
def shared():
    """Innerhalb dieses Blocks wird je Person nur einmal geladen (alter Block und Registry in einem Lauf)."""
    token = _SHARED.set({})
    try:
        yield
    finally:
        _SHARED.reset(token)


async def load_participation(db, user_id: str) -> Participation:
    cache = _SHARED.get()
    if cache is not None and user_id in cache:
        return cache[user_id]
    participation = await _load(db, user_id)
    if cache is not None:
        cache[user_id] = participation
    return participation


async def _timeline(db, user_id: str) -> TeamTimeline:
    timeline = TeamTimeline()
    async for row in db.team_members.find({"user_id": user_id}, {"_id": 0, "team_id": 1, "joined_at": 1}):
        if row.get("team_id"):
            timeline.joined[row["team_id"]] = parse_time(row.get("joined_at"))
    async for team in db.teams.find({"$or": [{"member_ids": user_id}, {"leader_id": user_id}]}, {"_id": 0, "id": 1}):
        if team.get("id"):
            timeline.joined.setdefault(team["id"], None)
    events = db.audit_logs.find({"$or": [
        {"action": {"$in": ["team.join", "team.leave"]}, "actor_id": user_id},
        {"action": "team.kick", "data.kicked_user_id": user_id},
    ]}, {"_id": 0, "action": 1, "target_id": 1, "created_at": 1})
    async for event in events:
        stamp = parse_time(event.get("created_at"))
        if stamp and event.get("target_id"):
            kind = "join" if event.get("action") == "team.join" else "leave"
            timeline.events.setdefault(event["target_id"], []).append((stamp, kind))
    closed = db.dissolved_teams.find({"$or": [{"memberships.user_id": user_id}, {"member_ids": user_id}]},
                                     {"_id": 0, "id": 1, "memberships": 1, "dissolved_at": 1})
    async for team in closed:
        own = next((row for row in team.get("memberships") or [] if row.get("user_id") == user_id), {})
        if team.get("id"):
            timeline.closed[team["id"]] = (parse_time(own.get("joined_at")), parse_time(team.get("dissolved_at")))
    return timeline


async def _load(db, user_id: str) -> Participation:
    timeline = await _timeline(db, user_id)
    registrations = {row["id"]: row async for row in db.tournament_registrations.find({"user_id": user_id}, {"_id": 0}) if row.get("id")}
    team_ids = sorted(timeline.team_ids())
    if team_ids:
        async for row in db.tournament_registrations.find({"team_id": {"$in": team_ids}}, {"_id": 0}):
            if row.get("id"):
                registrations.setdefault(row["id"], row)
    # Liga: wer auf einer Teilnehmerliste steht, zählt auch dann, wenn die Mitgliedschaft nicht mehr nachzuvollziehen ist.
    listed = set()
    async for match in db.matches_v2.find({"lineup_user_ids": user_id}, {"_id": 0, "slots.registration_id": 1}):
        listed |= {slot.get("registration_id") for slot in match.get("slots") or [] if slot.get("registration_id")}
    missing = sorted(listed - set(registrations))
    if missing:
        async for row in db.tournament_registrations.find({"id": {"$in": missing}}, {"_id": 0}):
            if row.get("id") and row.get("team_id"):
                registrations[row["id"]] = row

    tournament_ids = sorted({row.get("tournament_id") for row in registrations.values() if row.get("tournament_id")})
    tournaments = {}
    if tournament_ids:
        tournaments = {row["id"]: row async for row in db.tournaments.find({"id": {"$in": tournament_ids}}, TOURNAMENT_FIELDS)}
    squad_ids = sorted({row["squad_id"] for row in registrations.values() if row.get("team_id") and row.get("squad_id")})
    squads = {}
    if squad_ids:
        squads = {row["id"]: {member for member in row.get("member_ids") or [] if member}
                  async for row in db.team_squads.find({"id": {"$in": squad_ids}}, {"_id": 0, "id": 1, "member_ids": 1})}
    matches = []
    if registrations:
        ids = sorted(registrations)
        matches = await db.matches_v2.find(
            {"tournament_id": {"$in": tournament_ids},
             "$or": [{"slots.registration_id": {"$in": ids}}, {"results.registration_id": {"$in": ids}}]},
            MATCH_FIELDS,
        ).to_list(10000)
    return Participation(user_id, registrations, tournaments, matches, timeline, squads)
