"""Zähler für die Erfolge (#616): eine Registry, die weiß, welcher Schlüssel aus welcher Quelle kommt.

Jeder Zähler ist eine kleine Funktion über einem ``Context`` (lädt Daten einmal je Auswertung). Der
alte Block ``badges.compute_user_progress`` liefert weiterhin seine Schlüssel und wird bei jeder
Auffrischung mitgerechnet; die neuen Zähler laufen nur, wenn ihre Quelle sich geändert hat. Der Stand
je Person liegt in ``user_achievement_stats`` - Profil und Katalog lesen ihn, statt alles neu zu rechnen.
Nächtlich rechnet ``reconcile`` alle Aktiven komplett nach und protokolliert Abweichungen.

Signale (``user_signals``) sind Ereignisse, die der Client meldet - Kürbis geklickt, Konami-Code,
Schneeflocken - je Tag gezählt, vom Server auf Plausibilität geprüft (Saison, Deckel).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable
from zoneinfo import ZoneInfo

from database import get_db
from models import now_utc

logger = logging.getLogger("tls.achievements.counters")
VIENNA = ZoneInfo("Europe/Vienna")
STATS = "user_achievement_stats"
SIGNALS = "user_signals"
STALE_SECONDS = 600
LOGO_CLICKS_FOR_TAMER = 20

# Quellen: wer ein Ereignis auslöst, nennt sie - danach richtet sich, welche Zähler neu gerechnet werden.
SOURCES = ("match", "tournament", "fastlap", "season", "team", "event", "community", "discord", "chat", "profile",
           "club", "achievement", "xp", "signal", "stream", "friend")
# Was der alte Block (badges.compute_user_progress) liefert - bei jeder Auffrischung mitgerechnet.
LEGACY_KEYS = frozenset({
    "tournaments_registered", "distinct_games_registered", "distinct_formats", "matches_played", "matches_won",
    "match_streak_max", "tournaments_won", "podium_finishes", "rank_4_count", "fastlap_valid_count", "distinct_tracks",
    "pole_count", "membership_days", "events_attended", "season_points_total", "distinct_platforms", "seasons_active",
    "profile_completeness", "achievements_unlocked", "achievement_points", "teams_founded", "team_days_max",
    "discord_messages", "twitch_live_sessions", "twitch_stream_minutes", "friends_count", "direct_messages_sent",
    "team_chat_messages_sent", "match_chat_messages_sent", "tournament_chat_messages_sent", "community_messages_sent",
})


@dataclass(frozen=True)
class Counter:
    key: str
    sources: frozenset
    compute: Callable[["Context"], Awaitable[int]]


REGISTRY: dict[str, Counter] = {}


def counter(key: str, *sources: str):
    """Einen Zähler registrieren: ``@counter("prizes_received", "tournament")``."""
    unknown = set(sources) - set(SOURCES)
    if unknown:
        raise ValueError(f"Unbekannte Quelle {unknown} für {key}")

    def wrap(fn):
        REGISTRY[key] = Counter(key, frozenset(sources), fn)
        return fn
    return wrap


def keys_for_sources(sources) -> set[str]:
    wanted = set(sources or [])
    return {key for key, item in REGISTRY.items() if item.sources & wanted}


# ------------------------------------------------------------------ Kontext

class Context:
    """Daten einer Person, je Auswertung einmal geladen."""

    def __init__(self, db, user_id: str):
        self.db = db
        self.user_id = user_id
        self._cache: dict = {}

    async def _memo(self, name: str, loader):
        if name not in self._cache:
            self._cache[name] = await loader()
        return self._cache[name]

    async def user(self) -> dict:
        return await self._memo("user", lambda: self.db.users.find_one({"id": self.user_id}, {"_id": 0})) or {}

    async def registrations(self) -> list[dict]:
        return await self._memo("registrations", lambda: self.db.tournament_registrations.find({"user_id": self.user_id}, {"_id": 0}).to_list(2000))

    async def registration_ids(self) -> set[str]:
        return {r["id"] for r in await self.registrations() if r.get("id")}

    async def tournaments(self) -> dict[str, dict]:
        async def load():
            ids = list({r.get("tournament_id") for r in await self.registrations() if r.get("tournament_id")})
            rows = await self.db.tournaments.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "status": 1, "registration_opens_at": 1, "registration_open_from": 1, "is_public": 1, "game_id": 1, "season_id": 1, "stream_url": 1, "format": 1}).to_list(2000) if ids else []
            return {row["id"]: row for row in rows}
        return await self._memo("tournaments", load)

    async def matches(self) -> list[dict]:
        """Rohe Matches aus ``matches_v2`` - mit Zeitstempeln, die der kanonische Umbau nicht mitnimmt."""
        async def load():
            ids = list(await self.registration_ids())
            if not ids:
                return []
            return await self.db.matches_v2.find({"slots.registration_id": {"$in": ids}}, {"_id": 0, "id": 1, "tournament_id": 1, "status": 1, "slots": 1, "results": 1, "completed_at": 1, "updated_at": 1, "scheduled_at": 1, "best_of": 1, "map": 1, "maps": 1, "disputes": 1, "forfeit_registration_id": 1, "section": 1, "bracket": 1, "round_name": 1, "group_id": 1}).to_list(5000)
        return await self._memo("matches", load)

    async def awards(self) -> list[dict]:
        return await self._memo("awards", lambda: self.db.user_achievements.find({"user_id": self.user_id}, {"_id": 0}).to_list(2000))

    async def teams(self) -> list[dict]:
        return await self._memo("teams", lambda: self.db.teams.find({"member_ids": self.user_id}, {"_id": 0}).to_list(100))

    async def xp(self) -> dict:
        return await self._memo("xp", lambda: self.db.user_xp.find_one({"user_id": self.user_id}, {"_id": 0})) or {}

    async def signals(self) -> dict[str, dict]:
        async def load():
            rows = await self.db[SIGNALS].find({"user_id": self.user_id}, {"_id": 0}).to_list(200)
            return {row["name"]: row for row in rows}
        return await self._memo("signals", load)

    async def links(self) -> set[str]:
        async def load():
            rows = await self.db.platform_links.find({"user_id": self.user_id}, {"_id": 0, "platform": 1}).to_list(100)
            return {row.get("platform") for row in rows if row.get("platform")}
        return await self._memo("links", load)

    async def season_standings(self) -> list[dict]:
        return await self._memo("season_standings", lambda: self.db.season_standings.find({"user_id": self.user_id}, {"_id": 0, "rank": 1, "season_id": 1}).to_list(500))

    async def awards_places(self) -> list[dict]:
        async def load():
            ids = list(await self.registration_ids())
            return await self.db.tournament_awards.find({"registration_id": {"$in": ids}}, {"_id": 0, "tournament_id": 1, "place": 1}).to_list(2000) if ids else []
        return await self._memo("awards_places", load)

    async def opponent_registrations(self) -> dict[str, dict]:
        """Die Anmeldungen der Gegner aus allen eigenen Matches (Check-in-Zeiten, Status) - Katalog A."""
        async def load():
            mine = await self.registration_ids()
            ids = {slot.get("registration_id") for match in await self.matches() for slot in match.get("slots") or [] if slot.get("registration_id") and slot.get("registration_id") not in mine}
            rows = await self.db.tournament_registrations.find({"id": {"$in": list(ids)}}, {"_id": 0, "id": 1, "status": 1, "checked_in_at": 1, "updated_at": 1, "user_id": 1, "team_id": 1}).to_list(5000) if ids else []
            return {row["id"]: row for row in rows}
        return await self._memo("opponent_registrations", load)

    async def result_submissions(self) -> list[dict]:
        """Eigene Ergebnismeldungen aus dem Protokoll (match.result.submit) - Katalog A."""
        return await self._memo("result_submissions", lambda: self.db.audit_logs.find({"action": "match.result.submit", "actor_id": self.user_id}, {"_id": 0, "data": 1, "created_at": 1}).to_list(5000))

    async def matches_by_ids(self, ids) -> dict[str, dict]:
        ids = [i for i in set(ids) if i]
        if not ids:
            return {}
        rows = await self.db.matches_v2.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "status": 1, "slots": 1, "disputes": 1}).to_list(5000)
        return {row["id"]: row for row in rows}

    async def group_matches(self, tournament_id: str, group_id: str) -> list[dict]:
        key = f"group:{tournament_id}:{group_id}"
        return await self._memo(key, lambda: self.db.matches_v2.find({"tournament_id": tournament_id, "group_id": group_id, "status": "completed"}, {"_id": 0, "slots": 1, "results": 1}).to_list(2000))

    # ---- Katalog B (#613): Fast Lap, Saison, Team

    async def lap_times(self) -> list[dict]:
        """Eigene gültige Fast-Lap-Zeiten (nicht ungültig, keine Vereins-Referenzzeit)."""
        from services.fastlap_standings import official_query
        return await self._memo("lap_times", lambda: self.db.f1_lap_times.find(official_query({"user_id": self.user_id}), {"_id": 0, "id": 1, "challenge_id": 1, "track_id": 1, "time_ms": 1, "penalty_seconds": 1, "created_at": 1, "attempt_number": 1}).to_list(10000))

    async def lap_tracks(self) -> dict[str, dict]:
        """Die Strecken der eigenen Zeiten (Zielzeit)."""
        async def load():
            ids = list({row.get("track_id") for row in await self.lap_times() if row.get("track_id")})
            rows = await self.db.f1_tracks.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "challenge_id": 1, "target_time_ms": 1}).to_list(1000) if ids else []
            return {row["id"]: row for row in rows}
        return await self._memo("lap_tracks", load)

    async def track_bests(self) -> dict[str, tuple[str, int]]:
        """Die schnellste gültige Zeit aller je Strecke, auf der die Person gefahren ist: (Person, Zeit)."""
        async def load():
            from services.fastlap_standings import effective_ms, official_query
            ids = list({row.get("track_id") for row in await self.lap_times() if row.get("track_id")})
            best: dict[str, tuple[str, int]] = {}
            if ids:
                async for row in self.db.f1_lap_times.find(official_query({"track_id": {"$in": ids}}), {"_id": 0, "user_id": 1, "track_id": 1, "time_ms": 1, "penalty_seconds": 1}):
                    ms = effective_ms(row)
                    tid = row.get("track_id")
                    if tid and (tid not in best or ms < best[tid][1]):
                        best[tid] = (row.get("user_id"), ms)
            return best
        return await self._memo("track_bests", load)

    async def fastlap_challenges(self) -> list[dict]:
        async def load():
            ids = list({row.get("challenge_id") for row in await self.lap_times() if row.get("challenge_id")})
            return await self.db.f1_challenges.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "status": 1, "points_per_position": 1}).to_list(500) if ids else []
        return await self._memo("fastlap_challenges", load)

    async def seasons(self) -> list[dict]:
        return await self._memo("seasons", lambda: self.db.seasons.find({}, {"_id": 0, "id": 1, "status": 1, "tournament_ids": 1, "f1_challenge_ids": 1, "start_date": 1}).to_list(500))

    async def season_points(self) -> list[dict]:
        return await self._memo("season_points", lambda: self.db.season_points.find({"user_id": self.user_id}, {"_id": 0, "season_id": 1, "source_type": 1, "source_id": 1}).to_list(5000))

    async def rank_snapshots(self) -> list[dict]:
        from services.season_ranks import SNAPSHOTS
        return await self._memo("rank_snapshots", lambda: self.db[SNAPSHOTS].find({"user_id": self.user_id}, {"_id": 0, "season_id": 1, "day": 1, "rank": 1}).to_list(10000))

    async def season_tournaments(self) -> dict[str, dict]:
        """Die Turniere aller Saisons mit Startdatum - für den Saisonstart."""
        async def load():
            ids = list({tid for season in await self.seasons() for tid in (season.get("tournament_ids") or []) if tid})
            rows = await self.db.tournaments.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "start_date": 1, "created_at": 1}).to_list(2000) if ids else []
            return {row["id"]: row for row in rows}
        return await self._memo("season_tournaments", load)

    async def team_memberships(self) -> dict[str, dict]:
        async def load():
            rows = await self.db.team_members.find({"user_id": self.user_id}, {"_id": 0, "team_id": 1, "joined_at": 1, "role": 1}).to_list(200)
            return {row["team_id"]: row for row in rows if row.get("team_id")}
        return await self._memo("team_memberships", load)

    async def team_registrations(self) -> dict[str, dict]:
        async def load():
            ids = [team["id"] for team in await self.teams() if team.get("id")]
            rows = await self.db.tournament_registrations.find({"team_id": {"$in": ids}}, {"_id": 0, "id": 1, "team_id": 1, "tournament_id": 1}).to_list(5000) if ids else []
            return {row["id"]: row for row in rows}
        return await self._memo("team_registrations", load)

    async def team_matches(self) -> list[dict]:
        async def load():
            ids = list(await self.team_registrations())
            return await self.db.matches_v2.find({"slots.registration_id": {"$in": ids}, "status": "completed"}, {"_id": 0, "id": 1, "slots": 1, "results": 1, "completed_at": 1, "updated_at": 1}).to_list(10000) if ids else []
        return await self._memo("team_matches", load)


def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _signal_count(signals: dict, name: str) -> int:
    return int((signals.get(name) or {}).get("count") or 0)


def _signal_days(signals: dict, name: str) -> int:
    return len((signals.get(name) or {}).get("days") or {})


# ------------------------------------------------------------------ Signale (Client meldet, Server prüft)

@counter("halloween_pumpkin", "signal")
async def _halloween_pumpkin(ctx):
    return 1 if _signal_count(await ctx.signals(), "halloween_pumpkin") else 0


@counter("snowflakes_clicked", "signal")
async def _snowflakes(ctx):
    return _signal_count(await ctx.signals(), "snowflakes_clicked")


@counter("online_at_new_year", "signal")
async def _new_year(ctx):
    return 1 if _signal_count(await ctx.signals(), "online_at_new_year") else 0


@counter("konami_found", "signal")
async def _konami(ctx):
    return 1 if _signal_count(await ctx.signals(), "konami") else 0


@counter("lost_404", "signal")
async def _lost(ctx):
    return 1 if _signal_count(await ctx.signals(), "lost_404") else 0


@counter("logo_clicks", "signal")
async def _logo(ctx):
    return _signal_count(await ctx.signals(), "logo_clicks")


@counter("explorer_done", "signal")
async def _explorer(ctx):
    return 1 if _signal_count(await ctx.signals(), "explorer_done") else 0


@counter("calendar_subscribed", "signal")
async def _calendar(ctx):
    return 1 if _signal_count(await ctx.signals(), "calendar_used") else 0


@counter("member_card_added", "signal", "club")
async def _member_card(ctx):
    return 1 if _signal_count(await ctx.signals(), "member_card_added") else 0


@counter("app_days", "signal")
async def _app_days(ctx):
    return _signal_days(await ctx.signals(), "app_open")


@counter("onboarding_completed", "signal", "profile")
async def _onboarding(ctx):
    return 1 if _signal_count(await ctx.signals(), "tutorial_done") else 0


@counter("advent_doors_opened", "signal")
async def _advent(ctx):
    return _signal_count(await ctx.signals(), "advent_door")


@counter("easter_eggs_found", "signal")
async def _eggs(ctx):
    return _signal_count(await ctx.signals(), "easter_egg")


# ------------------------------------------------------------------ Profil und Konten

@counter("discord_linked", "profile")
async def _discord_linked(ctx):
    return 1 if "discord" in await ctx.links() else 0


@counter("twitch_linked", "profile")
async def _twitch_linked(ctx):
    return 1 if "twitch" in await ctx.links() else 0


@counter("youtube_linked", "profile")
async def _youtube_linked(ctx):
    return 1 if "youtube" in await ctx.links() else 0


@counter("tiktok_linked", "profile")
async def _tiktok_linked(ctx):
    return 1 if "tiktok" in await ctx.links() else 0


@counter("linked_accounts", "profile")
async def _linked_accounts(ctx):
    return len(await ctx.links())


@counter("avatar_and_banner", "profile")
async def _avatar_banner(ctx):
    user = await ctx.user()
    return 1 if user.get("avatar_url") and user.get("banner_url") else 0


@counter("bio_and_socials", "profile")
async def _bio_socials(ctx):
    user = await ctx.user()
    socials = any(user.get(key) for key in ("website", "discord_name", "twitch_handle", "youtube_handle", "tiktok_handle", "instagram_handle", "x_handle"))
    return 1 if str(user.get("bio") or "").strip() and (socials or await ctx.links()) else 0


@counter("email_verified", "profile")
async def _email_verified(ctx):
    return 1 if (await ctx.user()).get("email_verified") else 0


@counter("passkey_registered", "profile")
async def _passkey(ctx):
    return 1 if await ctx.db.passkeys.count_documents({"user_id": ctx.user_id}) else 0


@counter("notification_prefs_saved", "profile")
async def _notification_prefs(ctx):
    prefs = (await ctx.user()).get("notification_preferences")
    return 1 if isinstance(prefs, dict) and prefs else 0


@counter("privacy_reviewed", "profile")
async def _privacy(ctx):
    user = await ctx.user()
    return 1 if isinstance(user.get("privacy_public_profile"), bool) or user.get("profile_visibility") else 0


@counter("newsletter_subscribed", "profile", "community")
async def _newsletter(ctx):
    return 1 if (await ctx.user()).get("newsletter_consent") else 0


@counter("push_enabled", "profile")
async def _push(ctx):
    return 1 if await ctx.db.mobile_push_tokens.count_documents({"user_id": ctx.user_id}) else 0


@counter("account_years", "profile")
async def _account_years(ctx):
    created = _parse((await ctx.user()).get("created_at"))
    return max(0, (now_utc() - created).days // 365) if created else 0


# ------------------------------------------------------------------ XP und Erfolge

@counter("login_streak_max", "xp")
async def _login_streak(ctx):
    return int((await ctx.xp()).get("login_streak_max") or 0)


@counter("level", "xp")
async def _level(ctx):
    return int((await ctx.xp()).get("level") or 1)


@counter("prestige_stars", "xp")
async def _prestige(ctx):
    return int((await ctx.xp()).get("prestige") or 0)


@counter("birthday_logins", "xp")
async def _birthday(ctx):
    return int((await ctx.xp()).get("birthday_logins") or 0)


@counter("hidden_unlocked", "achievement")
async def _hidden(ctx):
    hidden = {g["code"] async for g in ctx.db.achievement_groups.find({"hidden": True}, {"_id": 0, "code": 1})}
    return sum(1 for award in await ctx.awards() if award.get("group_code") in hidden)


@counter("categories_completed", "achievement")
async def _categories(ctx):
    groups = {g["code"]: g async for g in ctx.db.achievement_groups.find({"public": True, "is_negative": {"$ne": True}, "hidden": {"$ne": True}}, {"_id": 0, "code": 1, "category": 1})}
    tiers_by_category: dict[str, set[str]] = {}
    async for tier in ctx.db.achievements.find({"group_code": {"$in": list(groups)}}, {"_id": 0, "code": 1, "group_code": 1}):
        tiers_by_category.setdefault(groups[tier["group_code"]].get("category") or "special", set()).add(tier["code"])
    earned = {award.get("tier_code") for award in await ctx.awards()}
    return sum(1 for codes in tiers_by_category.values() if codes and codes <= earned)


# ------------------------------------------------------------------ Turnier

@counter("prizes_received", "tournament")
async def _prizes(ctx):
    return await ctx.db.prize_pickups.count_documents({"user_id": ctx.user_id})


@counter("tournaments_staffed_completed", "tournament")
async def _staffed(ctx):
    ids = {row.get("tournament_id") async for row in ctx.db.tournament_staff_assignments.find({"user_id": ctx.user_id}, {"_id": 0, "tournament_id": 1}) if row.get("tournament_id")}
    if not ids:
        return 0
    return await ctx.db.tournaments.count_documents({"id": {"$in": list(ids)}, "status": {"$in": ["completed", "results_published", "archived"]}})


@counter("seed_one_count", "tournament")
async def _seed_one(ctx):
    """Topgesetzt: je Turnier einmal, egal wie viele Anmeldungen dort auf Platz 1 gesetzt waren."""
    return len({r.get("tournament_id") for r in await ctx.registrations() if r.get("seed") == 1 and r.get("tournament_id")})


@counter("tournaments_completed", "tournament")
async def _tournaments_completed(ctx):
    tournaments = await ctx.tournaments()
    done = {tid for tid, t in tournaments.items() if t.get("status") in ("completed", "results_published", "archived")}
    return len({r.get("tournament_id") for r in await ctx.registrations() if r.get("tournament_id") in done})


@counter("fast_registrations", "tournament")
async def _fast_registrations(ctx):
    tournaments = await ctx.tournaments()
    count = 0
    for reg in await ctx.registrations():
        tournament = tournaments.get(reg.get("tournament_id")) or {}
        opened = _parse(tournament.get("registration_opens_at") or tournament.get("registration_open_from"))
        created = _parse(reg.get("created_at"))
        if opened and created and timedelta(0) <= created - opened <= timedelta(minutes=10):
            count += 1
    return count


@counter("first_checkins", "tournament")
async def _first_checkins(ctx):
    """Erster Check-in eines Turniers: der eigene Check-in-Zeitpunkt liegt vor allen anderen."""
    mine = [r for r in await ctx.registrations() if r.get("status") == "checked_in" and r.get("tournament_id")]
    count = 0
    for reg in mine:
        stamp = str(reg.get("checked_in_at") or reg.get("updated_at") or "")
        if not stamp:
            continue
        earlier = await ctx.db.tournament_registrations.count_documents({"tournament_id": reg["tournament_id"], "status": "checked_in", "id": {"$ne": reg["id"]}, "$or": [{"checked_in_at": {"$lt": stamp}}, {"checked_in_at": {"$exists": False}, "updated_at": {"$lt": stamp}}]})
        if earlier == 0:
            count += 1
    return count


@counter("top8_finishes", "tournament")
async def _top8(ctx):
    return len({row["tournament_id"] for row in await ctx.awards_places() if row.get("tournament_id") and int(row.get("place") or 99) <= 8})


@counter("finals_played", "tournament")
async def _finals(ctx):
    return len({row["tournament_id"] for row in await ctx.awards_places() if row.get("tournament_id") and int(row.get("place") or 99) <= 2})


# ------------------------------------------------------------------ Match (Zeit, Gegner, Lob)

def _completed_matches(matches: list[dict], registration_ids: set[str]) -> list[tuple[dict, bool, datetime | None, set[str]]]:
    out = []
    for match in matches:
        if match.get("status") != "completed":
            continue
        slots = [slot for slot in match.get("slots") or [] if slot.get("registration_id")]
        mine = {slot["registration_id"] for slot in slots} & registration_ids
        if not mine:
            continue
        won = any(result.get("registration_id") in registration_ids and result.get("outcome") == "winner" for result in match.get("results") or [])
        when = _parse(match.get("completed_at") or match.get("updated_at") or match.get("scheduled_at"))
        opponents = {slot["registration_id"] for slot in slots} - registration_ids
        out.append((match, won, when, opponents))
    return out


@counter("matches_before_9", "match")
async def _before_9(ctx):
    return sum(1 for _m, _w, when, _o in _completed_matches(await ctx.matches(), await ctx.registration_ids()) if when and when.astimezone(VIENNA).hour < 9)


@counter("matches_after_23", "match")
async def _after_23(ctx):
    return sum(1 for _m, _w, when, _o in _completed_matches(await ctx.matches(), await ctx.registration_ids()) if when and when.astimezone(VIENNA).hour >= 23)


@counter("weekend_matches", "match")
async def _weekend(ctx):
    return sum(1 for _m, _w, when, _o in _completed_matches(await ctx.matches(), await ctx.registration_ids()) if when and when.astimezone(VIENNA).weekday() >= 5)


@counter("same_opponent_max", "match")
async def _same_opponent(ctx):
    rows = _completed_matches(await ctx.matches(), await ctx.registration_ids())
    opponent_ids = {opp for _m, _w, _when, opponents in rows for opp in opponents}
    if not opponent_ids:
        return 0
    regs = await ctx.db.tournament_registrations.find({"id": {"$in": list(opponent_ids)}}, {"_id": 0, "id": 1, "user_id": 1, "team_id": 1}).to_list(5000)
    owner = {r["id"]: r.get("user_id") or r.get("team_id") for r in regs}
    tally: dict[str, int] = {}
    for _m, _w, _when, opponents in rows:
        for opp in opponents:
            key = owner.get(opp)
            if key:
                tally[key] = tally.get(key, 0) + 1
    return max(tally.values()) if tally else 0


@counter("upsets", "match")
async def _upsets(ctx):
    """Sieg gegen einen besser gesetzten Gegner (kleinere Setznummer)."""
    count = 0
    mine = await ctx.registration_ids()
    for match, won, _when, _opponents in _completed_matches(await ctx.matches(), mine):
        if not won:
            continue
        seeds = {slot.get("registration_id"): slot.get("seed") for slot in match.get("slots") or [] if slot.get("registration_id")}
        my_seed = min((int(seeds[r]) for r in seeds if r in mine and isinstance(seeds.get(r), int)), default=None)
        their = min((int(seeds[r]) for r in seeds if r not in mine and isinstance(seeds.get(r), int)), default=None)
        if my_seed is not None and their is not None and their < my_seed:
            count += 1
    return count


@counter("commendations_received", "match")
async def _gg_received(ctx):
    ids = list(await ctx.registration_ids())
    return await ctx.db.match_commendations.count_documents({"to_registration_id": {"$in": ids}}) if ids else 0


@counter("commendations_given", "match")
async def _gg_given(ctx):
    return await ctx.db.match_commendations.count_documents({"from_user_id": ctx.user_id})


# ------------------------------------------------------------------ Team

@counter("team_size_max", "team")
async def _team_size(ctx):
    return max((len(team.get("member_ids") or []) for team in await ctx.teams()), default=0)


@counter("team_profile_complete", "team")
async def _team_profile(ctx):
    return 1 if any(team.get("logo_url") and team.get("banner_url") and str(team.get("description") or "").strip() for team in await ctx.teams() if team.get("leader_id") == ctx.user_id) else 0


@counter("captain_days", "team")
async def _captain_days(ctx):
    days = 0
    for team in await ctx.teams():
        if team.get("leader_id") != ctx.user_id:
            continue
        created = _parse(team.get("created_at"))
        if created:
            days = max(days, (now_utc() - created).days)
    return days


@counter("team_level_max", "team")
async def _team_level(ctx):
    teams = await ctx.teams()
    if not teams:
        return 0
    from services.team_levels import compute_all_team_levels
    levels = await compute_all_team_levels()
    return max((int((levels.get(team["id"]) or {}).get("level") or 0) for team in teams if team.get("id")), default=0)


@counter("team_tournaments_played", "team", "tournament")
async def _team_tournaments(ctx):
    ids = [team["id"] for team in await ctx.teams() if team.get("id")]
    if not ids:
        return 0
    return len(await ctx.db.tournament_registrations.distinct("tournament_id", {"team_id": {"$in": ids}}))


# ------------------------------------------------------------------ Events, Saison, Community

@counter("events_hosted_completed", "event")
async def _events_hosted(ctx):
    return await ctx.db.events.count_documents({"created_by": ctx.user_id, "status": "completed"})


@counter("club_events_attended", "event", "club")
async def _club_events(ctx):
    event_ids = [row.get("event_id") async for row in ctx.db.event_registrations.find({"user_id": ctx.user_id, "$or": [{"status": "checked_in"}, {"checked_in": True}]}, {"_id": 0, "event_id": 1}) if row.get("event_id")]
    if not event_ids:
        return 0
    return await ctx.db.events.count_documents({"id": {"$in": event_ids}, "visibility": {"$in": ["members", "internal"]}})


@counter("season_top10_finishes", "season")
async def _season_top10(ctx):
    return sum(1 for row in await ctx.season_standings() if isinstance(row.get("rank"), int) and row["rank"] <= 10)


@counter("season_wins", "season")
async def _season_wins(ctx):
    return sum(1 for row in await ctx.season_standings() if row.get("rank") == 1)


@counter("news_read", "community")
async def _news_read(ctx):
    return await ctx.db.news_reads.count_documents({"user_id": ctx.user_id})


@counter("streams_watched", "community", "stream")
async def _streams_watched(ctx):
    return await ctx.db.stream_watches.count_documents({"user_id": ctx.user_id})


@counter("reports_actioned", "community")
async def _reports(ctx):
    return await ctx.db.user_reports.count_documents({"reporter_id": ctx.user_id, "status": {"$in": ["removed", "actioned", "accepted"]}})


# ------------------------------------------------------------------ Rechnen, Cache, Abgleich

async def compute(user_id: str, keys: set[str] | None = None) -> dict[str, int]:
    """Zähler rechnen - alle, oder nur ``keys``. Der alte Block läuft immer mit."""
    db = get_db()
    from badges import compute_user_progress
    values = dict(await compute_user_progress(user_id))
    ctx = Context(db, user_id)
    for key, item in REGISTRY.items():
        if keys is not None and key not in keys:
            continue
        try:
            values[key] = int(await item.compute(ctx) or 0)
        except Exception:  # noqa: BLE001 - ein kaputter Zähler hält die anderen nicht auf
            logger.warning("[achievements] counter %s failed for %s", key, user_id, exc_info=True)
    return values


async def refresh(user_id: str, sources=None) -> dict[str, int]:
    """Stand auffrischen: mit ``sources`` nur die betroffenen neuen Zähler, sonst alles."""
    db = get_db()
    keys = None if not sources else keys_for_sources(sources)
    fresh = await compute(user_id, keys)
    current = await db[STATS].find_one({"user_id": user_id}, {"_id": 0}) or {}
    values = {**(current.get("values") or {}), **fresh}
    stamp = now_utc().isoformat()
    update = {"$set": {"values": values, "updated_at": stamp}, "$setOnInsert": {"user_id": user_id}}
    if keys is None:
        update["$set"]["full_at"] = stamp
    await db[STATS].update_one({"user_id": user_id}, update, upsert=True)
    return values


async def stats(user_id: str, max_age_seconds: int = STALE_SECONDS) -> dict[str, int]:
    """Der gespeicherte Stand - frisch gerechnet, wenn er fehlt oder älter als zehn Minuten ist."""
    doc = await get_db()[STATS].find_one({"user_id": user_id}, {"_id": 0})
    full_at = _parse((doc or {}).get("full_at"))
    if doc and full_at and now_utc() - full_at <= timedelta(seconds=max_age_seconds):
        return dict(doc.get("values") or {})
    return await refresh(user_id)


async def reconcile(days: int = 7, limit: int = 5000) -> dict:
    """Nächtlich: alle, die in den letzten Tagen aktiv waren, komplett neu rechnen, Abweichungen protokollieren, auswerten."""
    db = get_db()
    since = (now_utc() - timedelta(days=days)).isoformat()
    active = {row["user_id"] async for row in db.xp_events.find({"at": {"$gte": since}}, {"_id": 0, "user_id": 1})}
    active |= {row["user_id"] async for row in db[STATS].find({"updated_at": {"$gte": since}}, {"_id": 0, "user_id": 1})}
    from badges import evaluate_user_progress
    checked = drift = awarded = 0
    for user_id in list(active)[:limit]:
        before = ((await db[STATS].find_one({"user_id": user_id}, {"_id": 0, "values": 1}) or {}).get("values") or {})
        after = await refresh(user_id)
        changed = {key: (before.get(key), value) for key, value in after.items() if key in before and before[key] != value}
        if changed:
            drift += 1
            logger.info("[achievements] reconcile %s: %s", user_id, changed)
        awarded += await evaluate_user_progress(user_id)
        checked += 1
    return {"checked": checked, "drift": drift, "awarded": awarded}


# ------------------------------------------------------------------ Signale

# Name → Regeln: höchstens so oft je Tag, nur in dieser Saison (wenn gesetzt), nur in diesen Phasen.
SIGNAL_RULES: dict[str, dict] = {
    "halloween_pumpkin": {"per_day": 1, "season": "halloween"},
    "snowflakes_clicked": {"per_day": 200, "season": "snow"},
    "online_at_new_year": {"per_day": 1, "season": "new_year", "phases": {"pre_countdown", "countdown", "show", "fade"}},
    "konami": {"per_day": 1},
    "lost_404": {"per_day": 1},
    "logo_clicks": {"per_day": 100},
    "explorer_done": {"per_day": 1},
    "calendar_used": {"per_day": 1},
    "member_card_added": {"per_day": 1},
    "app_open": {"per_day": 1},
    "tutorial_done": {"per_day": 1},
    "advent_door": {"per_day": 24, "season": "advent_calendar"},
    "easter_egg": {"per_day": 50, "season": "easter_hunt"},
}


async def season_allows(name: str) -> bool:
    """Saisongebundene Signale zählen nur, während die Saison (und die Phase) wirklich läuft - Serverzeit."""
    rule = SIGNAL_RULES.get(name) or {}
    if not rule.get("season"):
        return True
    from routes.seasons_routes import load_context
    from services import seasons
    db = get_db()
    stored, founded = await load_context(db)
    active = {s["key"]: s for s in seasons.active(None, stored, founded)["seasons"]}
    state = active.get(rule["season"])
    if not state:
        return False
    return not rule.get("phases") or state.get("phase") in rule["phases"]


async def record_signal(user_id: str, name: str, count: int = 1) -> dict:
    """Ein Signal zählen. Liefert {accepted, count, day_count} - abgelehnt bei Deckel oder falscher Saison."""
    if name not in SIGNAL_RULES or not user_id:
        return {"accepted": False, "reason": "unknown"}
    if not await season_allows(name):
        return {"accepted": False, "reason": "season"}
    db = get_db()
    rule = SIGNAL_RULES[name]
    day = now_utc().astimezone(VIENNA).date().isoformat()
    doc = await db[SIGNALS].find_one({"user_id": user_id, "name": name}, {"_id": 0}) or {}
    today = int((doc.get("days") or {}).get(day) or 0)
    room = max(0, int(rule["per_day"]) - today)
    add = min(max(1, int(count)), room)
    if add <= 0:
        return {"accepted": False, "reason": "cap", "count": int(doc.get("count") or 0), "day_count": today}
    stamp = now_utc().isoformat()
    await db[SIGNALS].update_one({"user_id": user_id, "name": name}, {"$inc": {"count": add, f"days.{day}": add}, "$set": {"last_at": stamp}, "$setOnInsert": {"user_id": user_id, "name": name, "first_at": stamp}}, upsert=True)
    return {"accepted": True, "count": int(doc.get("count") or 0) + add, "day_count": today + add}


# ------------------------------------------------------------------ Katalog A (#612): Serien, Karten, Pünktlichkeit, Dispute, Turnierläufe

def _score_pair(match: dict, mine: set[str]) -> tuple[int, int] | None:
    """(eigene Punkte, Gegnerpunkte) aus results[].score - None, wenn keine Zahlen eingetragen sind."""
    own = their = None
    for entry in match.get("results") or []:
        score = entry.get("score")
        if not isinstance(score, (int, float)):
            continue
        if entry.get("registration_id") in mine:
            own = max(own or 0, int(score))
        else:
            their = max(their or 0, int(score))
    if own is None or their is None:
        return None
    return own, their


def _best_of(match: dict) -> int:
    try:
        return int(match.get("best_of") or 0)
    except (TypeError, ValueError):
        return 0


def _full_distance(match: dict, mine: set[str]) -> bool:
    """Volle Distanz: alle Karten gespielt - 2:1 im Bo3, 3:2 im Bo5."""
    pair = _score_pair(match, mine)
    best_of = _best_of(match)
    return bool(pair) and best_of >= 3 and pair[0] + pair[1] == best_of


def _is_lower_section(match: dict) -> bool:
    section = str(match.get("section") or match.get("bracket") or "").strip().lower()
    return section in {"lb", "loser", "losers", "lower", "lower_bracket", "loser bracket", "looser"} or section.startswith("lower")


@counter("win_rate_qualified", "match")
async def _win_rate(ctx):
    """Siegquote in Prozent - erst ab 30 gespielten Matches, davor 0."""
    rows = _completed_matches(await ctx.matches(), await ctx.registration_ids())
    if len(rows) < 30:
        return 0
    return round(100 * sum(1 for _m, won, _w, _o in rows if won) / len(rows))


@counter("clean_sheets", "match")
async def _clean_sheets(ctx):
    mine = await ctx.registration_ids()
    count = 0
    for match, won, _w, _o in _completed_matches(await ctx.matches(), mine):
        pair = _score_pair(match, mine)
        if won and pair and pair[1] == 0 and pair[0] > 0:
            count += 1
    return count


@counter("full_distance_series", "match")
async def _full_distance_series(ctx):
    mine = await ctx.registration_ids()
    return sum(1 for match, _w, _when, _o in _completed_matches(await ctx.matches(), mine) if _full_distance(match, mine))


@counter("deciders_won", "match")
async def _deciders_won(ctx):
    mine = await ctx.registration_ids()
    return sum(1 for match, won, _when, _o in _completed_matches(await ctx.matches(), mine) if won and _full_distance(match, mine))


@counter("comebacks", "match")
async def _comebacks(ctx):
    """Sieg nach 0:1 oder 0:2 - braucht die Kartenreihenfolge (match.maps mit winner_registration_id); ohne sie zählt nichts."""
    mine = await ctx.registration_ids()
    count = 0
    for match, won, _when, _o in _completed_matches(await ctx.matches(), mine):
        maps = [m for m in (match.get("maps") or []) if isinstance(m, dict) and m.get("winner_registration_id")]
        if won and maps and maps[0]["winner_registration_id"] not in mine:
            count += 1
    return count


@counter("distinct_maps", "match")
async def _distinct_maps(ctx):
    names = {str(match.get("map") or "").strip().lower() for match, _w, _when, _o in _completed_matches(await ctx.matches(), await ctx.registration_ids())}
    return len({name for name in names if name})


@counter("matches_ready_on_time", "match")
async def _ready_on_time(ctx):
    """Beide Seiten vor dem angesetzten Start eingecheckt, kein Forfeit."""
    mine = await ctx.registration_ids()
    own = {r["id"]: r for r in await ctx.registrations() if r.get("id")}
    others = await ctx.opponent_registrations()
    count = 0
    for match, _won, _when, opponents in _completed_matches(await ctx.matches(), mine):
        scheduled = _parse(match.get("scheduled_at"))
        if not scheduled or match.get("forfeit_registration_id"):
            continue
        slots = {slot.get("registration_id") for slot in match.get("slots") or [] if slot.get("registration_id")}
        stamps = []
        for reg_id in slots:
            reg = own.get(reg_id) or others.get(reg_id)
            stamp = _parse((reg or {}).get("checked_in_at"))
            if not stamp:
                stamps = []
                break
            stamps.append(stamp)
        if stamps and all(stamp <= scheduled for stamp in stamps):
            count += 1
    return count


@counter("results_reported_accepted", "match")
async def _results_reported(ctx):
    """Eigene Ergebnismeldungen zu Matches, die damit abgeschlossen wurden - je Match einmal."""
    completed = {match["id"] for match, _w, _when, _o in _completed_matches(await ctx.matches(), await ctx.registration_ids())}
    reported = {str((row.get("data") or {}).get("match_id") or "") for row in await ctx.result_submissions()}
    return len(reported & completed)


@counter("dispute_free_streak", "match")
async def _dispute_free_streak(ctx):
    rows = sorted(_completed_matches(await ctx.matches(), await ctx.registration_ids()), key=lambda row: row[2] or datetime.min.replace(tzinfo=timezone.utc))
    best = streak = 0
    for match, _w, _when, _o in rows:
        if match.get("disputes"):
            streak = 0
            continue
        streak += 1
        best = max(best, streak)
    return best


@counter("bracket_resets_won", "match")
async def _bracket_resets(ctx):
    mine = await ctx.registration_ids()
    return sum(1 for match, won, _when, _o in _completed_matches(await ctx.matches(), mine) if won and "reset" in str(match.get("round_name") or "").lower())


@counter("streamed_matches", "match", "tournament")
async def _streamed(ctx):
    tournaments = await ctx.tournaments()
    with_stream = {tid for tid, t in tournaments.items() if str(t.get("stream_url") or "").strip()}
    return sum(1 for match, _w, _when, _o in _completed_matches(await ctx.matches(), await ctx.registration_ids()) if match.get("tournament_id") in with_stream)


@counter("tournaments_completed_no_forfeit", "tournament", "match")
async def _completed_no_forfeit(ctx):
    tournaments = await ctx.tournaments()
    done = {tid for tid, t in tournaments.items() if t.get("status") in ("completed", "results_published", "archived")}
    mine = await ctx.registration_ids()
    forfeited = {match.get("tournament_id") for match in await ctx.matches() if match.get("forfeit_registration_id") in mine}
    gave_up = {r.get("tournament_id") for r in await ctx.registrations() if r.get("status") in ("withdrawn", "disqualified", "no_show")}
    return len({r.get("tournament_id") for r in await ctx.registrations() if r.get("tournament_id") in done and r.get("tournament_id") not in forfeited and r.get("tournament_id") not in gave_up})


@counter("checkin_streak", "tournament")
async def _checkin_streak(ctx):
    """Turnier für Turnier eingecheckt, in der Reihenfolge der Anmeldungen - die längste Folge zählt."""
    rows = sorted((r for r in await ctx.registrations() if r.get("tournament_id")), key=lambda r: str(r.get("created_at") or ""))
    best = streak = 0
    for reg in rows:
        if reg.get("status") in ("checked_in", "ready") or reg.get("checked_in_at"):
            streak += 1
            best = max(best, streak)
        else:
            streak = 0
    return best


@counter("lower_bracket_top4", "tournament", "match")
async def _lower_bracket_top4(ctx):
    places = {row["tournament_id"]: int(row.get("place") or 99) for row in await ctx.awards_places() if row.get("tournament_id")}
    lower = {match.get("tournament_id") for match in await ctx.matches() if match.get("status") == "completed" and _is_lower_section(match)}
    return len({tid for tid, place in places.items() if place <= 4 and tid in lower})


@counter("tournaments_won_undefeated", "tournament", "match")
async def _undefeated(ctx):
    mine = await ctx.registration_ids()
    won_tournaments = {row["tournament_id"] for row in await ctx.awards_places() if row.get("tournament_id") and int(row.get("place") or 99) == 1}
    lost_in = {match.get("tournament_id") for match, won, _when, _o in _completed_matches(await ctx.matches(), mine) if not won}
    return len(won_tournaments - lost_in)


@counter("group_stage_firsts", "tournament", "match")
async def _group_firsts(ctx):
    """Platz 1 in einer Gruppe: die meisten Siege unter allen Anmeldungen der Gruppe (Gleichstand zählt)."""
    mine = await ctx.registration_ids()
    groups = {(match.get("tournament_id"), match.get("group_id")) for match in await ctx.matches() if match.get("group_id") and match.get("status") == "completed"}
    count = 0
    for tournament_id, group_id in groups:
        wins: dict[str, int] = {}
        for match in await ctx.group_matches(tournament_id, group_id):
            for result in match.get("results") or []:
                reg = result.get("registration_id")
                if reg:
                    wins[reg] = wins.get(reg, 0) + (1 if result.get("outcome") == "winner" else 0)
        if not wins:
            continue
        best = max(wins.values())
        if best > 0 and any(wins.get(reg, 0) == best for reg in mine):
            count += 1
    return count


@counter("disputes_resolved_as_staff", "tournament", "match")
async def _disputes_resolved(ctx):
    """Als Turnierleitung ein disputiertes Match mit einem Ergebnis abgeschlossen - je Match einmal."""
    mine = await ctx.registration_ids()
    ids = {str((row.get("data") or {}).get("match_id") or "") for row in await ctx.result_submissions()}
    matches = await ctx.matches_by_ids(ids)
    count = 0
    for match in matches.values():
        if match.get("status") != "completed" or not match.get("disputes"):
            continue
        slots = {slot.get("registration_id") for slot in match.get("slots") or []}
        if slots & mine:
            continue
        count += 1
    return count


# ------------------------------------------------------------------ Katalog B (#613): Fast Lap

_INACTIVE_REGISTRATION = {"withdrawn", "rejected", "cancelled", "declined", "disqualified"}


def _laps_by_track(times: list[dict]) -> dict[str, list[dict]]:
    by_track: dict[str, list[dict]] = {}
    for row in times:
        if row.get("track_id"):
            by_track.setdefault(row["track_id"], []).append(row)
    return by_track


@counter("pb_improvements", "fastlap")
async def _pb_improvements(ctx):
    """Jede gültige Runde, die die eigene bisherige Bestzeit auf der Strecke unterbietet (Strafsekunden eingerechnet)."""
    from services.fastlap_standings import effective_ms
    count = 0
    for rows in _laps_by_track(await ctx.lap_times()).values():
        best = None
        for row in sorted(rows, key=lambda item: (str(item.get("created_at") or ""), int(item.get("attempt_number") or 0))):
            ms = effective_ms(row)
            if best is not None and ms < best:
                count += 1
            best = ms if best is None else min(best, ms)
    return count


@counter("sub_target_laps", "fastlap")
async def _sub_target(ctx):
    """Gültige Runden unter der Zielzeit der Strecke (Strecken ohne Zielzeit zählen nicht)."""
    from services.fastlap_standings import effective_ms
    tracks = await ctx.lap_tracks()
    count = 0
    for row in await ctx.lap_times():
        target = (tracks.get(row.get("track_id")) or {}).get("target_time_ms")
        if isinstance(target, (int, float)) and target > 0 and effective_ms(row) <= target:
            count += 1
    return count


@counter("track_records_held", "fastlap")
async def _track_records(ctx):
    """Strecken, auf denen die eigene Bestzeit die schnellste gültige Zeit aller ist."""
    from services.fastlap_standings import effective_ms
    bests = await ctx.track_bests()
    held = 0
    for track_id, rows in _laps_by_track(await ctx.lap_times()).items():
        mine = min(effective_ms(row) for row in rows)
        overall = bests.get(track_id)
        if overall and mine <= overall[1]:
            held += 1
    return held


@counter("consistent_sessions", "fastlap")
async def _consistency(ctx):
    """Strecken mit mindestens zehn gültigen Runden binnen einem Prozent der eigenen Bestzeit."""
    from services.fastlap_standings import effective_ms
    count = 0
    for rows in _laps_by_track(await ctx.lap_times()).values():
        if len(rows) < 10:
            continue
        times = [effective_ms(row) for row in rows]
        best = min(times)
        if sum(1 for ms in times if ms <= best * 1.01) >= 10:
            count += 1
    return count


@counter("championship_top3", "fastlap")
async def _championship_top3(ctx):
    """Abgeschlossene Challenges, deren Championship die Person auf Platz 1 bis 3 beendet hat."""
    from services.fastlap_standings import challenge_standings
    count = 0
    for challenge in await ctx.fastlap_challenges():
        if challenge.get("status") != "completed":
            continue
        standings, _per_track, _tracks = await challenge_standings(ctx.db, challenge)
        if any(entry["user_id"] == ctx.user_id and entry["rank"] <= 3 for entry in standings):
            count += 1
    return count


@counter("grand_prix_entries", "fastlap", "tournament")
async def _grand_prix(ctx):
    """Anmeldungen zu Turnieren im Format Grand Prix (zurückgezogene zählen nicht)."""
    tournaments = await ctx.tournaments()
    return sum(1 for reg in await ctx.registrations() if reg.get("status") not in _INACTIVE_REGISTRATION and (tournaments.get(reg.get("tournament_id")) or {}).get("format") == "grand_prix")


# ------------------------------------------------------------------ Katalog B (#613): Saison

def _finished(season: dict) -> bool:
    return season.get("status") in ("completed", "archived")


@counter("season_climbs_10", "season")
async def _season_climbs(ctx):
    """Saisons, in denen die Person laut den täglichen Schnappschüssen mindestens zehn Plätze gutgemacht hat."""
    from services.season_ranks import climbs
    return climbs(await ctx.rank_snapshots(), 10)


@counter("seasons_fully_played", "season")
async def _seasons_fully_played(ctx):
    """Abgeschlossene Saisons, in denen die Person bei jedem Turnier und jeder Challenge Punkte geholt hat."""
    points = await ctx.season_points()
    count = 0
    for season in await ctx.seasons():
        if not _finished(season):
            continue
        tournaments = [tid for tid in season.get("tournament_ids") or [] if tid]
        challenges = [cid for cid in season.get("f1_challenge_ids") or [] if cid]
        if not tournaments and not challenges:
            continue
        sources = {str(row.get("source_id") or "") for row in points if row.get("season_id") == season["id"]}
        played_tournaments = all(tid in sources for tid in tournaments)
        played_challenges = all(any(source == cid or source.startswith(f"{cid}:") for source in sources) for cid in challenges)
        if played_tournaments and played_challenges:
            count += 1
    return count


@counter("season_openers_played", "season")
async def _season_openers(ctx):
    """Saisons, bei deren erstem Turnier (frühester Start) die Person angemeldet war oder Punkte geholt hat."""
    tournaments = await ctx.season_tournaments()
    registered = {reg.get("tournament_id") for reg in await ctx.registrations() if reg.get("status") not in _INACTIVE_REGISTRATION}
    played = {str(row.get("source_id") or "") for row in await ctx.season_points()}
    count = 0
    for season in await ctx.seasons():
        ids = [tid for tid in season.get("tournament_ids") or [] if tid in tournaments]
        if not ids:
            continue
        opener = min(ids, key=lambda tid: str(tournaments[tid].get("start_date") or tournaments[tid].get("created_at") or "9999"))
        if opener in registered or opener in played:
            count += 1
    return count


# ------------------------------------------------------------------ Katalog B (#613): Team

@counter("team_match_wins", "team", "match")
async def _team_match_wins(ctx):
    """Matches, die ein Team der Person gewonnen hat, nachdem sie beigetreten war."""
    registrations = await ctx.team_registrations()
    memberships = await ctx.team_memberships()
    wins = 0
    for match in await ctx.team_matches():
        when = _parse(match.get("completed_at") or match.get("updated_at"))
        for result in match.get("results") or []:
            reg = registrations.get(result.get("registration_id"))
            if not reg or result.get("outcome") != "winner":
                continue
            joined = _parse((memberships.get(reg.get("team_id")) or {}).get("joined_at"))
            if joined and when and when < joined:
                continue
            wins += 1
            break
    return wins


@counter("team_invites_accepted", "team")
async def _team_invites_accepted(ctx):
    """Einladungen der Person, die angenommen wurden."""
    return await ctx.db.team_invites.count_documents({"invited_by": ctx.user_id, "status": "accepted"})


# ------------------------------------------------------------------ Katalog C (#614): Community, Creator, Profil

@counter("discord_messages", "discord", "community")
async def _discord_messages(ctx):
    """Nachrichten auf dem Vereins-Discord - der Bot zählt je Nachricht am Nutzer hoch."""
    return int((await ctx.user()).get("discord_messages_count") or 0)


@counter("community_messages_sent", "community", "tournament", "match")
async def _community_messages(ctx):
    """Nachrichten in den offenen Chats: Turnier-Chat und Match-Chat."""
    return await ctx.db.tournament_chat_messages.count_documents({"user_id": ctx.user_id}) + await ctx.db.match_chat_messages.count_documents({"user_id": ctx.user_id})


@counter("gallery_uploads_approved", "community")
async def _gallery_uploads(ctx):
    """Fotos, die die Person in Galerie-Alben hochgeladen hat."""
    return await ctx.db.gallery_photos.count_documents({"uploaded_by": ctx.user_id})


@counter("stickers_collected", "community", "chat")
async def _stickers(ctx):
    """Verschiedene Sticker, die die Person in irgendeinem Chat verschickt hat."""
    ids = set()
    for name, field in (("direct_messages", "sender_id"), ("team_chat_messages", "user_id"), ("tournament_chat_messages", "user_id"), ("match_chat_messages", "user_id")):
        async for row in ctx.db[name].find({field: ctx.user_id, "sticker.id": {"$exists": True}}, {"_id": 0, "sticker.id": 1}):
            sticker_id = (row.get("sticker") or {}).get("id")
            if sticker_id:
                ids.add(sticker_id)
    return len(ids)


@counter("app_user_stage", "signal", "profile")
async def _app_user_stage(ctx):
    """1 = App genutzt, 2 = 30 Tage mit der App, 3 = dazu Push eingeschaltet."""
    days = int(await REGISTRY["app_days"].compute(ctx) or 0)
    push = int(await REGISTRY["push_enabled"].compute(ctx) or 0)
    if days >= 30 and push:
        return 3
    if days >= 30:
        return 2
    return 1 if days >= 1 else 0


@counter("own_tournament_streams", "stream", "tournament")
async def _own_tournament_streams(ctx):
    """Turniere, bei denen der eigene Stream während eigener Matches gezeigt wurde - je Turnier einmal."""
    from services.tournament_streams import ANNOUNCEMENTS
    return len([t for t in await ctx.db[ANNOUNCEMENTS].distinct("tournament_id", {"user_id": ctx.user_id}) if t])


@counter("clips_synced", "stream")
async def _clips(ctx):
    """Clips auf dem Vereinskanal, die die Person erstellt hat - erkannt am Twitch-Namen aus dem Profil."""
    user = await ctx.user()
    handle = str(user.get("twitch_handle") or user.get("twitch_channel") or "").strip().lstrip("@").lower()
    if not handle:
        return 0
    from services.twitch_clips import STATE_ID
    doc = await ctx.db.settings.find_one({"id": STATE_ID}, {"_id": 0, "clips": 1}) or {}
    return sum(1 for clip in doc.get("clips") or [] if str(clip.get("creator_name") or "").strip().lstrip("@").lower() == handle)
