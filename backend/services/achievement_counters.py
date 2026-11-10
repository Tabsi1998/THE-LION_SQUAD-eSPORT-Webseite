"""Zähler für die Erfolge (#616): eine Registry, die weiß, welcher Schlüssel aus welcher Quelle kommt.

Jeder Zähler ist eine kleine Funktion über einem ``Context`` (lädt Daten einmal je Auswertung). Der
alte Block ``badges.compute_user_progress`` liefert weiterhin seine Schlüssel und wird bei jeder
Auffrischung mitgerechnet; die neuen Zähler laufen nur, wenn ihre Quelle sich geändert hat. Der Stand
je Person liegt in ``user_achievement_stats`` - Profil und Katalog lesen ihn, statt alles neu zu rechnen.
Nächtlich rechnet ``reconcile`` alle Aktiven komplett nach und protokolliert Abweichungen.

Signale (``user_signals``) sind Ereignisse, die der Client meldet - Kürbis geklickt, Konami-Code,
Schneeflocken, verscheuchte Fledermäuse - je Tag gezählt, vom Server auf Plausibilität geprüft (Saison, Deckel).
Wer ohne Anmeldung sammelt, meldet nach dem Login nach (#678): je Tag, höchstens eine Woche zurück, mit demselben
Deckel und nur für Tage, an denen die Saison lief. Gespeichert wird nur Person, Signal, Tag und Anzahl.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Awaitable, Callable

from database import get_db
from models import now_utc
from services import achievement_participation, achievement_progress
from services.achievement_core import SIGNAL_RULES, SIGNALS, STATS, VIENNA, evaluator  # noqa: F401 - umgezogen (#1420)
from services.league_scope import NOT_LEAGUE, league_tournament_ids
from services.match_winner import DECIDED_STATUSES, is_duel, is_real_match, match_winner_id, participant_ids
from services.private_fields import private_projection

logger = logging.getLogger("tls.achievements.counters")
STALE_SECONDS = 600
LOGO_CLICKS_FOR_TAMER = 20


def _log_safe(value, limit: int = 120) -> str:
    """Werte ins Protokoll nur ohne Zeilenumbrüche - sonst ließe sich eine falsche Protokollzeile einschleusen."""
    return str(value or "").replace("\r", " ").replace("\n", " ")[:limit]


# Quellen: wer ein Ereignis auslöst, nennt sie - danach richtet sich, welche Zähler neu gerechnet werden.
SOURCES = ("match", "tournament", "fastlap", "season", "team", "event", "community", "discord", "chat", "profile",
           "club", "achievement", "xp", "signal", "stream", "friend", "registration")
# Was der alte Block (badges.compute_user_progress) liefert - bei jeder Auffrischung mitgerechnet.
LEGACY_KEYS = frozenset({
    "tournaments_registered", "distinct_games_registered", "distinct_formats", "matches_played", "matches_won",
    "match_streak_max", "tournaments_won", "podium_finishes", "rank_4_count", "fastlap_valid_count", "distinct_tracks",
    "pole_count", "membership_days", "events_attended", "season_points_total", "distinct_platforms", "seasons_active",
    "profile_completeness", "achievements_unlocked", "achievement_points", "teams_founded", "team_days_max",
    "twitch_live_sessions", "twitch_stream_minutes", "friends_count",
})
# Discord-Stimme und die Chat-Zähler stehen seit #2338 nur in der Registry (eine Rechnung, leicht auswertbar).


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
        return await self._memo("user", lambda: self.db.users.find_one({"id": self.user_id}, private_projection())) or {}

    async def registrations(self) -> list[dict]:
        """Die Anmeldungen, die die Person selbst abgegeben hat - für das, was sie beim Anmelden und Einchecken tut
        (schnelle Anmeldung, Check-in-Serie, Saisonstart). Gespielt und platziert wird über ``participation``."""
        return await self._memo("registrations", lambda: self.db.tournament_registrations.find({"user_id": self.user_id}, {"_id": 0}).to_list(2000))

    async def tournaments(self) -> dict[str, dict]:
        """Die Turniere der eigenen Anmeldungen - ohne Liga-Staffeln (docs/LIGA.md, Abschnitt 7): eine Staffel ist kein
        Turnier für die Turnierzähler; ihre Spiele zählen über ``played`` weiter."""
        async def load():
            ids = list({r.get("tournament_id") for r in await self.registrations() if r.get("tournament_id")})
            rows = await self.db.tournaments.find({"id": {"$in": ids}, **NOT_LEAGUE}, {"_id": 0, "id": 1, "status": 1, "registration_opens_at": 1, "registration_open_from": 1, "is_public": 1, "game_id": 1, "season_id": 1, "stream_url": 1, "format": 1}).to_list(2000) if ids else []
            return {row["id"]: row for row in rows}
        return await self._memo("tournaments", load)

    async def tournament_registrations(self) -> list[dict]:
        """Eigene Anmeldungen ohne die in Liga-Staffeln - für die Turnierzähler."""
        async def load():
            regs = await self.registrations()
            league = await league_tournament_ids(self.db, [r.get("tournament_id") for r in regs])
            return [r for r in regs if r.get("tournament_id") not in league]
        return await self._memo("tournament_registrations", load)

    async def participation(self) -> achievement_participation.Participation:
        """Wer hat gespielt (#2337): Anmeldungen, Turniere und Spiele der Person - auch über ihre Teams und die Liga."""
        return await self._memo("participation", lambda: achievement_participation.load_participation(self.db, self.user_id))

    async def played(self) -> list[achievement_participation.Played]:
        """Die echten Spiele, in denen die Person selbst angetreten ist - nie ein Freilos, kampflos nur für den Sieger."""
        return (await self.participation()).played

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

    async def club_record(self) -> dict:
        """Was die Website zuletzt aus der Vereinsakte gezählt hat (#615, services/member_activity.py): Abstimmungen,
        Versammlungen, Helferdienste, Stunden - nur Zahlen und Zeitpunkte, im Stand der Zähler selbst."""
        async def load():
            doc = await self.db[STATS].find_one({"user_id": self.user_id}, {"_id": 0, "club": 1}) or {}
            return doc.get("club") or {}
        return await self._memo("club_record", load)

    async def club_servers(self) -> tuple[int, int]:
        """(Discord-Server des Vereins, auf denen die Person ist; eingeschaltete Server insgesamt) - wie der Bot es
        zuletzt gesehen hat (#626). Ausgeschaltete und verlassene Server zählen auf keiner Seite. Gezählt wird nur mit
        verknüpftem Discord und nur, was für genau dieses Konto gemerkt ist (#2338) - nach dem Trennen nichts mehr."""
        async def load():
            enabled = [row["guild_id"] async for row in self.db.discord_guilds.find({"enabled": True}, {"_id": 0, "guild_id": 1, "left_at": 1}) if not row.get("left_at")]
            if not enabled:
                return 0, 0
            link = await self.db.platform_links.find_one({"user_id": self.user_id, "platform": "discord"}, {"_id": 0, "external_id": 1}) or {}
            discord_id = str(link.get("external_id") or "")
            if not discord_id:
                return 0, len(enabled)
            joined = await self.db.discord_memberships.count_documents({
                "user_id": self.user_id, "member": True, "guild_id": {"$in": enabled},
                "$or": [{"discord_id": {"$exists": False}}, {"discord_id": discord_id}],
            })
            return joined, len(enabled)
        return await self._memo("club_servers", load)

    async def links(self) -> set[str]:
        async def load():
            rows = await self.db.platform_links.find({"user_id": self.user_id}, {"_id": 0, "platform": 1}).to_list(100)
            return {row.get("platform") for row in rows if row.get("platform")}
        return await self._memo("links", load)

    async def season_standings(self) -> list[dict]:
        return await self._memo("season_standings", lambda: self.db.season_standings.find({"user_id": self.user_id}, {"_id": 0, "rank": 1, "season_id": 1}).to_list(500))

    async def placements(self) -> dict[str, achievement_participation.Placement]:
        """Der Platz je abgeschlossenem Turnier (#2337) - der gespeicherte Rang der Auszeichnung, nie ein Zwischenstand."""
        return await (await self.participation()).placements(self.db)

    async def finals(self) -> set[str]:
        """Die abgeschlossenen Turniere, in deren Finale die Person stand."""
        return await (await self.participation()).finals(self.db)

    async def opponent_registrations(self) -> dict[str, dict]:
        """Die Anmeldungen der Gegner aus allen eigenen Matches (Check-in-Zeiten, Status) - Katalog A."""
        async def load():
            ids = {reg_id for row in await self.played() for reg_id in row.opponents}
            rows = await self.db.tournament_registrations.find({"id": {"$in": list(ids)}}, {"_id": 0, "id": 1, "status": 1, "checked_in_at": 1, "updated_at": 1, "user_id": 1, "team_id": 1, "seed": 1}).to_list(5000) if ids else []
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
        return await self._memo(key, lambda: self.db.matches_v2.find({"tournament_id": tournament_id, "group_id": group_id, "status": {"$in": sorted(DECIDED_STATUSES)}}, {"_id": 0, "status": 1, "slots": 1, "results": 1, "winner_id": 1}).to_list(2000))

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
            # Die Spitze aus der einen Rangfunktion (#1584): Gleichstand - die früher gefahrene Zeit vorn.
            from services.fastlap_standings import official_query, rank_laps
            ids = list({row.get("track_id") for row in await self.lap_times() if row.get("track_id")})
            by_track: dict[str, list[dict]] = {}
            if ids:
                async for row in self.db.f1_lap_times.find(official_query({"track_id": {"$in": ids}}), {"_id": 0, "id": 1, "user_id": 1, "track_id": 1, "time_ms": 1, "penalty_seconds": 1, "created_at": 1}):
                    if row.get("track_id"):
                        by_track.setdefault(row["track_id"], []).append(row)
            best: dict[str, tuple[str, int]] = {}
            for tid, rows in by_track.items():
                ranked = rank_laps(rows)
                if ranked:
                    best[tid] = (ranked[0]["user_id"], ranked[0]["effective_ms"])
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


_parse = achievement_participation.parse_time


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


@counter("member_documents_opened", "club")
async def _documents_opened(ctx):
    """Papierkram (#615): verschiedene Vereinsdokumente, die die Person geöffnet hat - jedes einmal."""
    return await ctx.db.document_opens.count_documents({"user_id": ctx.user_id})


@counter("board_days", "club")
async def _board_days(ctx):
    """Vorstandsarbeit (#615): Tage im längsten laufenden Vorstandsamt - aus Dolibarr (Funktion mit „seit“, nur
    Vorstandsfunktionen) oder von Hand (Zuweisung im Admin mit Datum). Wer nicht mehr im Amt ist, zählt nicht weiter."""
    from services import club_facts

    today = now_utc().date()
    starts = []
    state = await club_facts.snapshot(ctx.db)
    codes = {row.get("code") for row in club_facts.board_public(state.get("board")) if row.get("code")} if state.get("board") else set()
    if codes:
        membership = await ctx.db.memberships.find_one({"user_id": ctx.user_id, "member_status": {"$in": ["active", "honorary"]}}, {"_id": 0, "dolibarr.functions": 1}) or {}
        for fn in (membership.get("dolibarr") or {}).get("functions") or []:
            if fn.get("code") in codes and _parse(fn.get("since")):
                starts.append(_parse(fn.get("since")).date())
    async for seat in ctx.db.board_positions.find({"$or": [{"user_id": ctx.user_id}, {"deputy_user_id": ctx.user_id}], "is_active": {"$ne": False}}, {"_id": 0, "user_id": 1, "deputy_user_id": 1, "user_since": 1, "deputy_since": 1}):
        since = seat.get("user_since") if seat.get("user_id") == ctx.user_id else seat.get("deputy_since")
        if _parse(since):
            starts.append(_parse(since).date())
    return max(((today - start).days for start in starts), default=0)


@counter("profile_completed_fast", "profile")
async def _profile_sprint(ctx):
    """Sprinter (#615): das Profil binnen zehn Minuten nach der Registrierung vollständig."""
    user = await ctx.user()
    created, completed = _parse(user.get("created_at")), _parse(user.get("profile_completed_at"))
    return 1 if created and completed and timedelta(0) <= completed - created <= timedelta(minutes=10) else 0


@counter("app_days", "signal")
async def _app_days(ctx):
    return _signal_days(await ctx.signals(), "app_open")


@counter("onboarding_completed", "signal", "profile")
async def _onboarding(ctx):
    return 1 if _signal_count(await ctx.signals(), "tutorial_done") else 0


@counter("advent_doors_opened", "signal")
async def _advent(ctx):
    """Die meisten Türchen in einem Advent (#641) - aus den echten Öffnungen, nicht aus dem Signal: „Alle Türchen“
    heißt 24 von 24 im selben Jahr."""
    from services.season_collections import doors_in_best_year
    return await doors_in_best_year(ctx.db, ctx.user_id)


@counter("easter_eggs_found", "signal")
async def _eggs(ctx):
    return _signal_count(await ctx.signals(), "easter_egg")


@counter("easter_hunts_completed", "signal")
async def _egg_king(ctx):
    """Wie oft jemand bei der Ostereiersuche (#646) alle Eier gefunden hat - aus den Körben, nicht aus dem Signal."""
    from services.season_collections import hunts_completed
    return await hunts_completed(ctx.db, ctx.user_id)


@counter("halloween_bats_scared", "signal")
async def _bats(ctx):
    return _signal_count(await ctx.signals(), "halloween_bats_scared")


@counter("season_collectibles_total", "signal")
async def _collectibles(ctx):
    """Alle Saison-Fundstücke zusammen (#678) - die Liste steht in services/collectibles.py."""
    from services.season_collections import total_of
    return total_of(await ctx.signals())


# ------------------------------------------------------------------ Profil und Konten

@counter("discord_linked", "profile")
async def _discord_linked(ctx):
    return 1 if "discord" in await ctx.links() else 0


@counter("discord_guilds_joined", "discord")
async def _discord_guilds_joined(ctx):
    """Auf wie vielen eingeschalteten Servern des Vereins die Person ist (#626) - wie der Bot es zuletzt gesehen hat."""
    return (await ctx.club_servers())[0]


def servers_for_stage(stage: int, enabled: int) -> int:
    """So viele eingeschaltete Server braucht Stufe 1, 2 oder 3 von „Überall dabei“ (#2338): einen, die Hälfte
    (aufgerundet, mindestens zwei) und alle. Nie mehr, als es Server gibt - mit einem Server reicht er für alle drei."""
    if enabled <= 0:
        return 1
    wanted = {1: 1, 2: max(2, -(-enabled // 2)), 3: enabled}[stage]
    return min(wanted, enabled)


@counter("discord_servers_stage", "discord")
async def _discord_servers_stage(ctx):
    """Überall dabei (#614, #615, #2338): die erreichte Stufe, gemessen an den eingeschalteten Servern - Stufe 1 auf
    einem, Stufe 2 auf der Hälfte, Stufe 3 auf allen. Die Ziele wachsen und schrumpfen mit der Zahl der Server; sie
    liegen nie über ihr."""
    joined, enabled = await ctx.club_servers()
    return max((stage for stage in (1, 2, 3) if enabled and joined >= servers_for_stage(stage, enabled)), default=0)


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
    """Datenbewusst (#2338): eine selbst gespeicherte Privatsphäre-Einstellung oder ein geholter Datenexport. Die
    Registrierung setzt die Felder schon - deren Wert allein zählt nicht mehr."""
    user = await ctx.user()
    return 1 if user.get("privacy_reviewed_at") or user.get("data_exported_at") else 0


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

# Teilnahme statt Anmeldung (#2337): Turnierveteran, Multitalent und Formatvielfalt zählen, wo die Person angenommen
# oder eingecheckt war und in mindestens einem echten Spiel angetreten ist - abgesagte Turniere nie. Die Schlüssel
# heißen weiter „…_registered“; Katalog und gespeicherte Stände hängen daran. Dieselbe Rechnung wie im alten Block
# (achievement_progress.compute_user_progress), damit Teil- und voller Lauf dieselben Werte schreiben. Eine Anmeldung
# ändert sie nicht mehr - deshalb hängen sie nicht an der Quelle „registration“: Der Anmelde-Pfad bleibt leicht (#1871).
@counter("tournaments_registered", "match", "tournament")
async def _tournaments_registered(ctx):
    return (await ctx.participation()).tournaments_played()


@counter("distinct_games_registered", "match", "tournament")
async def _distinct_games_registered(ctx):
    return (await ctx.participation()).distinct_games()


@counter("distinct_formats", "match", "tournament")
async def _distinct_formats(ctx):
    return (await ctx.participation()).distinct_formats()


# Preisträger (#2337): Preise aus Turnieren - nicht aus Fast Lap, Verlosung oder Eiersuche (``source_type``) -, die vergeben
# sind: vorgemerkt, abholbereit oder abgeholt. Verfallene und nach einer Korrektur strittige („bitte prüfen“) zählen nicht.
PRIZE_STATUSES = frozenset({"pending", "ready", "picked_up"})


@counter("prizes_received", "tournament")
async def _prizes(ctx):
    """Ein Preis für die Person zählt für sie; ein Preis für ein Team für alle, die in dem Turnier für das Team gespielt
    haben - nicht nur für die Person, die es angemeldet hat."""
    participation = await ctx.participation()
    played_for = {(registration["tournament_id"], registration["team_id"]) for registration in participation.entries() if registration.get("team_id")}
    team_ids = sorted({team_id for _tournament_id, team_id in played_for})
    query = {"$or": [{"user_id": ctx.user_id}, {"team_id": {"$in": team_ids}}]} if team_ids else {"user_id": ctx.user_id}
    count = 0
    async for pickup in ctx.db.prize_pickups.find(query, {"_id": 0, "tournament_id": 1, "user_id": 1, "team_id": 1, "status": 1, "source_type": 1, "needs_review": 1}):
        if not pickup.get("tournament_id") or (pickup.get("source_type") or "tournament") != "tournament":
            continue
        if (pickup.get("status") or "pending") not in PRIZE_STATUSES or pickup.get("needs_review"):
            continue
        if pickup.get("team_id"):
            count += int((pickup["tournament_id"], pickup["team_id"]) in played_for)
        else:
            count += int(pickup.get("user_id") == ctx.user_id)
    return count


@counter("tournaments_staffed_completed", "tournament")
async def _staffed(ctx):
    ids = {row.get("tournament_id") async for row in ctx.db.tournament_staff_assignments.find({"user_id": ctx.user_id}, {"_id": 0, "tournament_id": 1}) if row.get("tournament_id")}
    if not ids:
        return 0
    return await ctx.db.tournaments.count_documents({"id": {"$in": list(ids)}, "status": {"$in": ["completed", "results_published", "archived"]}, **NOT_LEAGUE})


@counter("seed_one_count", "tournament")
async def _seed_one(ctx):
    """Topgesetzt (#2337): Setznummer 1 der Anmeldung in einem abgeschlossenen Turnier mit fester Setzliste, in dem die
    Person gespielt hat - je Turnier einmal. Ausgelost, abgesagt, ausgetreten und Liga zählen nicht; die Nummern je Lauf
    (Plätze im Baum) auch nicht."""
    participation = await ctx.participation()
    return len({
        registration["tournament_id"] for registration in participation.tournament_entries(still_in=True)
        if registration.get("seed") == 1 and participation.is_done(registration["tournament_id"])
        and participation.has_fixed_seeding(registration["tournament_id"])
    })


@counter("tournaments_completed", "tournament")
async def _tournaments_completed(ctx):
    tournaments = await ctx.tournaments()
    done = {tid for tid, t in tournaments.items() if t.get("status") in ("completed", "results_published", "archived")}
    return len({r.get("tournament_id") for r in await ctx.registrations() if r.get("tournament_id") in done})


@counter("fast_registrations", "tournament", "registration")
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
    """Erster Check-in eines Turniers: der eigene Check-in-Zeitpunkt liegt vor allen anderen - in einem Turnier, in dem
    die Person dann auch gespielt hat (#2337); eingecheckt hat, wer die Anmeldung trägt."""
    mine = [r for r in (await ctx.participation()).tournament_entries() if r.get("status") == "checked_in" and r.get("user_id") == ctx.user_id]
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
    """Platz 1 bis 8 in einem abgeschlossenen Turnier - erst ab mehr als acht Teilnehmern, sonst wäre jeder dabei."""
    return sum(1 for placement in (await ctx.placements()).values() if placement.participants > 8 and any(rank <= 8 for rank in placement.ranks))


@counter("finals_played", "tournament")
async def _finals(ctx):
    """Im Finale gestanden: Endspiel, Grand Final oder Finallauf - nicht „Platz 1 oder 2“ (Tabellen haben kein Finale)."""
    return len(await ctx.finals())


# ------------------------------------------------------------------ Match (Zeit, Gegner, Lob)
# Alle Spiel-Zähler laufen über ``ctx.played()`` (#2337): echte Spiele, in denen die Person selbst angetreten ist - ein
# Freilos nie, kampflos gewertet nur für den Sieger, im Team und in der Liga nach Aufstellung bzw. Mitgliedschaft.

@counter("matches_before_9", "match")
async def _before_9(ctx):
    return sum(1 for row in await ctx.played() if row.when and row.when.astimezone(VIENNA).hour < 9)


@counter("matches_after_23", "match")
async def _after_23(ctx):
    return sum(1 for row in await ctx.played() if row.when and row.when.astimezone(VIENNA).hour >= 23)


@counter("weekend_matches", "match")
async def _weekend(ctx):
    return sum(1 for row in await ctx.played() if row.when and row.when.astimezone(VIENNA).weekday() >= 5)


@counter("same_opponent_max", "match")
async def _same_opponent(ctx):
    rows = await ctx.played()
    regs = (await ctx.opponent_registrations()).values()
    owner = {r["id"]: r.get("user_id") or r.get("team_id") for r in regs}
    tally: dict[str, int] = {}
    for row in rows:
        for opp in row.opponents:
            key = owner.get(opp)
            if key:
                tally[key] = tally.get(key, 0) + 1
    return max(tally.values()) if tally else 0


@counter("upsets", "match")
async def _upsets(ctx):
    """Sieg gegen einen besser gesetzten Gegner (kleinere Setznummer) - die Setznummer der Anmeldung, nicht der Platz im
    Baum, und nur bei fester Setzliste (#2337): Wo das Los die Nummern vergibt, gibt es keinen Favoriten."""
    participation = await ctx.participation()
    others = await ctx.opponent_registrations()
    count = 0
    for row in participation.played:
        match = row.match
        # Favoritenschreck ist ein Duell-Erfolg (#1796): im FFA-Lauf schlägt Platz 1 nicht „den Gegner“.
        if not row.won or not is_duel(match) or not participation.has_fixed_seeding(match.get("tournament_id")):
            continue
        my_seed = participation.seed_of(row.mine)
        seeds = [(others.get(reg_id) or {}).get("seed") for reg_id in row.opponents]
        their = min((seed for seed in seeds if isinstance(seed, int) and not isinstance(seed, bool)), default=None)
        if my_seed is not None and their is not None and their < my_seed:
            count += 1
    return count


@counter("commendations_received", "match")
async def _gg_received(ctx):
    """GG-Lob für eine Seite zählt für die, die das Spiel für sie gespielt haben (#2337) - im Team nach Aufstellung."""
    sides = {(row.match.get("id"), reg_id) for row in await ctx.played() for reg_id in row.mine}
    match_ids = sorted({match_id for match_id, _reg in sides if match_id})
    if not match_ids:
        return 0
    rows = ctx.db.match_commendations.find({"match_id": {"$in": match_ids}}, {"_id": 0, "match_id": 1, "to_registration_id": 1})
    return sum([1 async for row in rows if (row.get("match_id"), row.get("to_registration_id")) in sides])


@counter("commendations_given", "match")
async def _gg_given(ctx):
    return await ctx.db.match_commendations.count_documents({"from_user_id": ctx.user_id})


# ------------------------------------------------------------------ Team

@counter("team_size_max", "team")
async def _team_size(ctx):
    return max((len(team.get("member_ids") or []) for team in await ctx.teams()), default=0)


def team_profile_complete(team: dict) -> bool:
    """Teamauftritt (#2338): Logo, Banner und Beschreibung - die Beschreibung nicht leer nach dem Trimmen."""
    return bool(str(team.get("logo_url") or "").strip() and str(team.get("banner_url") or "").strip() and str(team.get("description") or "").strip())


@counter("team_profile_complete", "team")
async def _team_profile(ctx):
    """Für die Teamleitung und die Co-Leitung eines Teams mit vollständigem Auftritt (#2338)."""
    return 1 if any(team_profile_complete(team) for team in await ctx.teams()
                    if team.get("leader_id") == ctx.user_id or ctx.user_id in (team.get("co_leader_ids") or [])) else 0


@counter("captain_days", "team")
async def _captain_days(ctx):
    """Kapitän (#2338): Tage seit der Übernahme der Leitung (``leader_since``). Teams von vor dieser Angabe: die letzte
    protokollierte Übergabe an diese Person (``team.transfer_leader``), erst ohne eine solche ab der Gründung."""
    days = 0
    for team in await ctx.teams():
        if team.get("leader_id") != ctx.user_id:
            continue
        since = _parse(team.get("leader_since")) or await _last_handover(ctx, team.get("id")) or _parse(team.get("created_at"))
        if since:
            days = max(days, (now_utc() - since).days)
    return days


async def _last_handover(ctx, team_id: str | None) -> datetime | None:
    """Wann die Person die Leitung dieses Teams zuletzt übergeben bekam - aus dem Protokoll."""
    if not team_id:
        return None
    rows = await ctx.db.audit_logs.find(
        {"action": "team.transfer_leader", "target_id": team_id, "data.new_leader": ctx.user_id},
        {"_id": 0, "created_at": 1}).sort("created_at", -1).to_list(1)
    return _parse(rows[0].get("created_at")) if rows else None


@counter("team_level_max", "team")
async def _team_level(ctx):
    teams = await ctx.teams()
    if not teams:
        return 0
    from services.team_levels import compute_all_team_levels
    levels = await compute_all_team_levels()
    return max((int((levels.get(team["id"]) or {}).get("level") or 0) for team in teams if team.get("id")), default=0)


@counter("team_tournaments_played", "team", "tournament", "match")
async def _team_tournaments(ctx):
    """Turniere, in denen die Person für ein Team gespielt hat (#2337) - nicht jedes, zu dem ein Team angemeldet ist."""
    return len({registration["tournament_id"] for registration in (await ctx.participation()).tournament_entries() if registration.get("team_id")})


# ------------------------------------------------------------------ Events, Saison, Community

@counter("events_hosted_completed", "event")
async def _events_hosted(ctx):
    return await ctx.db.events.count_documents({"created_by": ctx.user_id, "status": "completed"})


@counter("club_events_attended", "event", "club")
async def _club_events(ctx):
    """Vereinsleben (#2338): besuchte Events, die vereinsintern sind - nach Sichtbarkeit (Mitglieder, intern) oder Art
    (Vereinsabend, intern). Anwesenheit und „abgesagt zählt nicht“ wie bei „Eventgänger“ (achievement_progress)."""
    event_ids = await achievement_progress.attended_event_ids(ctx.db, ctx.user_id)
    if not event_ids:
        return 0
    return await ctx.db.events.count_documents({"id": {"$in": sorted(event_ids)}, **achievement_progress.INTERNAL_EVENT_QUERY})


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

async def compute(user_id: str, keys: set[str] | None = None, legacy: bool = True) -> dict[str, int]:
    """Zähler rechnen - alle, oder nur ``keys``. Der alte Block läuft mit, außer ``legacy`` ist aus (nur mit ``keys``):
    dann werden wirklich nur diese Zähler gerechnet - für Signale, die nichts am alten Block ändern."""
    db = get_db()
    values: dict[str, int] = {}
    # Alter Block und Registry rechnen aus denselben Anmeldungen und Spielen (#2337) - je Lauf einmal geladen.
    with achievement_participation.shared():
        if legacy or keys is None:
            values = dict(await achievement_progress.compute_user_progress(user_id))
        ctx = Context(db, user_id)
        for key, item in REGISTRY.items():
            if keys is not None and key not in keys:
                continue
            try:
                values[key] = int(await item.compute(ctx) or 0)
            except Exception:  # noqa: BLE001 - ein kaputter Zähler hält die anderen nicht auf
                logger.warning("[achievements] counter %s failed for %s", key, _log_safe(user_id), exc_info=True)
    return values


async def refresh(user_id: str, sources=None, legacy: bool = True) -> dict[str, int]:
    """Stand auffrischen: mit ``sources`` nur die betroffenen neuen Zähler, sonst alles. ``legacy`` aus (nur mit
    ``sources``) lässt den alten Block weg."""
    db = get_db()
    keys = None if not sources else keys_for_sources(sources)
    fresh = await compute(user_id, keys, legacy=legacy)
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
    evaluate_user_progress = evaluator()
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
    result = {"checked": checked, "drift": drift, "awarded": awarded}
    await db.settings.update_one({"id": "achievements_reconcile_last"}, {"$set": {"id": "achievements_reconcile_last", "at": now_utc().isoformat(), **result}}, upsert=True)
    return result


# ------------------------------------------------------------------ Signale

# So viele Tage zurück lässt sich nachmelden (#678): wer ohne Anmeldung gesammelt hat, verliert die Woche nicht.
REPLAY_DAYS = 7


def signal_day(value, today: date) -> tuple[date | None, str | None]:
    """Der Tag einer Meldung: ohne Angabe heute; sonst ein Datum von heute bis ``REPLAY_DAYS`` zurück. Liefert
    (Tag, None) oder (None, Grund) - ``day`` für ein kaputtes oder künftiges Datum, ``old`` für ein zu altes."""
    if value in (None, ""):
        return today, None
    try:
        day = date.fromisoformat(str(value)[:10])
    except ValueError:
        return None, "day"
    if day > today:
        return None, "day"
    if (today - day).days > REPLAY_DAYS:
        return None, "old"
    return day, None


def in_signal_window(window: dict, day: date, moment: datetime | None) -> bool:
    """Liegt die Meldung im Fenster des Signals (#2338)? Der Tag muss passen; die Stunde (Wien) nur, wenn die Meldung
    jetzt kommt - ein nachgemeldeter Tag trägt keine Uhrzeit mehr."""
    if (day.month, day.day) != (int(window["month"]), int(window["day"])):
        return False
    return moment is None or moment.hour >= int(window.get("from_hour") or 0)


async def season_allows(name: str, day: date | None = None) -> bool:
    """Saisongebundene Signale zählen nur, während die Saison (und die Phase) wirklich läuft - Serverzeit. Für einen
    nachgemeldeten Tag zählt, ob die Saison an diesem Tag zu Mittag lief (die Fenster der Sammel-Saisonen sind ganze Tage)."""
    rule = SIGNAL_RULES.get(name) or {}
    if not rule.get("season"):
        return True
    from routes.seasons_routes import load_context
    from services import seasons
    db = get_db()
    stored, founded = await load_context(db)
    moment = datetime.combine(day, time(12, 0), tzinfo=VIENNA) if day else None
    active = {s["key"]: s for s in seasons.active(moment, stored, founded)["seasons"]}
    state = active.get(rule["season"])
    if not state:
        return False
    return not rule.get("phases") or state.get("phase") in rule["phases"]


async def record_signal(user_id: str, name: str, count: int = 1, day: str | None = None, trusted: bool = False) -> dict:
    """Ein Signal zählen. Liefert {accepted, count, day_count, day} - abgelehnt bei Deckel (``cap``), falscher Saison
    (``season``), kaputtem oder künftigem Tag (``day``), zu altem Tag (``old``) oder einem Signal, das nur im
    Augenblick zählt (``live``). ``trusted`` setzt nur der Server selbst: Signale mit ``server`` gelten für Clients
    als unbekannt."""
    if name not in SIGNAL_RULES or not user_id:
        return {"accepted": False, "reason": "unknown"}
    rule = SIGNAL_RULES[name]
    if rule.get("server") and not trusted:
        return {"accepted": False, "reason": "unknown"}
    moment = now_utc().astimezone(VIENNA)
    today = moment.date()
    when, problem = signal_day(day, today)
    if problem:
        return {"accepted": False, "reason": problem}
    replay = when != today
    if replay and rule.get("live"):
        return {"accepted": False, "reason": "live"}
    if not await season_allows(name, when if replay else None):
        return {"accepted": False, "reason": "season"}
    if rule.get("window") and not in_signal_window(rule["window"], when, None if replay else moment):
        return {"accepted": False, "reason": "time"}
    db = get_db()
    day = when.isoformat()
    doc = await db[SIGNALS].find_one({"user_id": user_id, "name": name}, {"_id": 0}) or {}
    counted = int((doc.get("days") or {}).get(day) or 0)
    room = max(0, int(rule["per_day"]) - counted)
    add = min(max(1, int(count)), room)
    if add <= 0:
        return {"accepted": False, "reason": "cap", "count": int(doc.get("count") or 0), "day_count": counted, "day": day}
    stamp = now_utc().isoformat()
    await db[SIGNALS].update_one({"user_id": user_id, "name": name}, {"$inc": {"count": add, f"days.{day}": add}, "$set": {"last_at": stamp}, "$setOnInsert": {"user_id": user_id, "name": name, "first_at": stamp}}, upsert=True)
    return {"accepted": True, "count": int(doc.get("count") or 0) + add, "day_count": counted + add, "day": day}


# ------------------------------------------------------------------ Katalog A (#612): Serien, Karten, Pünktlichkeit, Dispute, Turnierläufe

def _score_pair(match: dict, mine: set[str]) -> tuple[int, int] | None:
    """(eigene Punkte, Gegnerpunkte) aus results[].score - None, wenn keine Zahlen eingetragen sind oder es kein Duell
    ist: Zu Null, volle Distanz und Entscheider gibt es nur bei genau zwei Seiten (#1796), nie in einem FFA-Lauf."""
    if not is_duel(match):
        return None
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
    rows = await ctx.played()
    if len(rows) < 30:
        return 0
    return round(100 * sum(1 for row in rows if row.won) / len(rows))


@counter("clean_sheets", "match")
async def _clean_sheets(ctx):
    count = 0
    for row in await ctx.played():
        pair = _score_pair(row.match, row.mine)
        if row.won and pair and pair[1] == 0 and pair[0] > 0:
            count += 1
    return count


@counter("full_distance_series", "match")
async def _full_distance_series(ctx):
    return sum(1 for row in await ctx.played() if _full_distance(row.match, row.mine))


@counter("deciders_won", "match")
async def _deciders_won(ctx):
    return sum(1 for row in await ctx.played() if row.won and _full_distance(row.match, row.mine))


@counter("comebacks", "match")
async def _comebacks(ctx):
    """Sieg nach 0:1 oder 0:2 - braucht die Kartenreihenfolge (match.maps mit winner_registration_id); ohne sie zählt nichts."""
    count = 0
    for row in await ctx.played():
        match = row.match
        maps = [m for m in (match.get("maps") or []) if isinstance(m, dict) and m.get("winner_registration_id")]
        if row.won and is_duel(match) and maps and maps[0]["winner_registration_id"] not in row.mine:
            count += 1
    return count


@counter("distinct_maps", "match")
async def _distinct_maps(ctx):
    names = {str(row.match.get("map") or "").strip().lower() for row in await ctx.played()}
    return len({name for name in names if name})


@counter("matches_ready_on_time", "match")
async def _ready_on_time(ctx):
    """Beide Seiten vor dem angesetzten Start eingecheckt, kein Forfeit."""
    own = (await ctx.participation()).registrations
    others = await ctx.opponent_registrations()
    count = 0
    for row in await ctx.played():
        match = row.match
        scheduled = _parse(match.get("scheduled_at"))
        if not scheduled or match.get("forfeit_registration_id"):
            continue
        slots = {slot.get("registration_id") for slot in match.get("slots") or [] if slot.get("registration_id")}
        stamps = []
        for reg_id in slots:
            reg = own.get(reg_id) or others.get(reg_id)
            stamp = achievement_participation.checked_in_at(reg)
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
    completed = {row.match["id"] for row in await ctx.played()}
    reported = {str((row.get("data") or {}).get("match_id") or "") for row in await ctx.result_submissions()}
    return len(reported & completed)


@counter("dispute_free_streak", "match")
async def _dispute_free_streak(ctx):
    rows = sorted(await ctx.played(), key=lambda row: row.when or datetime.min.replace(tzinfo=timezone.utc))
    best = streak = 0
    for row in rows:
        if row.match.get("disputes"):
            streak = 0
            continue
        streak += 1
        best = max(best, streak)
    return best


def _forced_the_reset(match: dict, mine: set) -> bool:
    """Im Reset-Spiel (#1549) steht auf dem Platz aus „Platz 1 des Grand Finals“, wer den Reset erzwungen hat - der
    Spieler aus der Verliererrunde. Nur sein Sieg ist der Bracket Reset; ältere Spiele ohne Herkunft zählen wie bisher."""
    for slot in match.get("slots") or []:
        if slot.get("registration_id") in mine:
            source = slot.get("source_result") or {}
            return source.get("rank") is None or int(source.get("rank") or 0) == 1
    return True


@counter("bracket_resets_won", "match")
async def _bracket_resets(ctx):
    return sum(
        1 for row in await ctx.played()
        if row.won and "reset" in str(row.match.get("round_name") or "").lower() and _forced_the_reset(row.match, row.mine)
    )


@counter("streamed_matches", "match", "tournament")
async def _streamed(ctx):
    participation = await ctx.participation()
    with_stream = {tid for tid, t in participation.tournaments.items()
                   if str(t.get("stream_url") or "").strip() and not participation.is_league(tid)}
    return sum(1 for row in participation.played if row.match.get("tournament_id") in with_stream)


@counter("tournaments_completed_no_forfeit", "tournament", "match")
async def _completed_no_forfeit(ctx):
    """Durchzieher (#2337): abgeschlossenes Turnier, in dem die Person gespielt hat - ohne kampflose Niederlage. Wer
    ausgetreten ist oder disqualifiziert wurde, hat teilgenommen, aber nicht durchgezogen (``finished_entries``)."""
    participation = await ctx.participation()
    forfeited = {row.match.get("tournament_id") for row in participation.rows if row.no_show}
    finished = {tid for tid in participation.finished_entries() if tid not in forfeited}
    return len(finished)


@counter("checkin_streak", "tournament")
async def _checkin_streak(ctx):
    """Turnier für Turnier eingecheckt, in der Reihenfolge der Anmeldungen - die längste Folge zählt."""
    rows = sorted((r for r in await ctx.tournament_registrations() if r.get("tournament_id")), key=lambda r: str(r.get("created_at") or ""))
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
    lower = {row.match.get("tournament_id") for row in await ctx.played() if _is_lower_section(row.match)}
    return sum(1 for tid, placement in (await ctx.placements()).items() if tid in lower and any(rank <= 4 for rank in placement.ranks))


@counter("tournaments_won_undefeated", "tournament", "match")
async def _undefeated(ctx):
    """Turniersieg mit einer Anmeldung, die kein Spiel verloren hat (#2337) - auch keines, in dem die Person selbst nicht
    aufgestellt war. Verloren hat nur, wer einem anderen Sieger gegenüberstand (auch kampflos); ein Freilos oder ein
    Unentschieden ist keine Niederlage."""
    beaten = (await ctx.participation()).beaten_registration_ids()
    return sum(1 for placement in (await ctx.placements()).values() if placement.registrations_on(1) - beaten)


@counter("group_stage_firsts", "tournament", "match")
async def _group_firsts(ctx):
    """Platz 1 in einer Gruppe: die meisten Siege unter allen Anmeldungen der Gruppe (Gleichstand zählt)."""
    groups: dict[tuple, set[str]] = {}
    for row in await ctx.played():
        if row.match.get("group_id"):
            groups.setdefault((row.match.get("tournament_id"), row.match["group_id"]), set()).update(row.mine)
    count = 0
    for (tournament_id, group_id), mine in groups.items():
        wins: dict[str, int] = {}
        for match in await ctx.group_matches(tournament_id, group_id):
            if not is_real_match(match):
                continue
            winner = match_winner_id(match)
            for reg in participant_ids(match):
                wins[reg] = wins.get(reg, 0) + (1 if reg == winner else 0)
        if not wins:
            continue
        best = max(wins.values())
        if best > 0 and any(wins.get(reg, 0) == best for reg in mine):
            count += 1
    return count


@counter("disputes_resolved_as_staff", "tournament", "match")
async def _disputes_resolved(ctx):
    """Als Turnierleitung ein disputiertes Match mit einem Ergebnis abgeschlossen - je Match einmal."""
    mine = (await ctx.participation()).registration_ids
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


@counter("grand_prix_entries", "fastlap", "tournament", "registration")
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


def fully_played(season: dict, points: list[dict]) -> bool:
    """Bei jedem Turnier und jeder Challenge einer Saison Punkte geholt (``points``: Saisonpunkte der Person)."""
    tournaments = [tid for tid in season.get("tournament_ids") or [] if tid]
    challenges = [cid for cid in season.get("f1_challenge_ids") or [] if cid]
    if not tournaments and not challenges:
        return False
    sources = {str(row.get("source_id") or "") for row in points if row.get("season_id") == season["id"]}
    played_tournaments = all(tid in sources for tid in tournaments)
    played_challenges = all(any(source == cid or source.startswith(f"{cid}:") for source in sources) for cid in challenges)
    return played_tournaments and played_challenges


@counter("seasons_fully_played", "season")
async def _seasons_fully_played(ctx):
    """Abgeschlossene Saisons, in denen die Person bei jedem Turnier und jeder Challenge Punkte geholt hat."""
    points = await ctx.season_points()
    return sum(1 for season in await ctx.seasons() if _finished(season) and fully_played(season, points))


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
    """Matches, die ein Team gewonnen hat, während die Person dabei war (#2337): nach Aufstellung bzw. Teilnehmerliste,
    ohne sie nach der Mitgliedschaft zum Zeitpunkt des Spiels - auch wenn sie das Team inzwischen verlassen hat."""
    participation = await ctx.participation()
    return sum(1 for row in participation.played
               if row.won and (participation.registrations.get(match_winner_id(row.match)) or {}).get("team_id"))


@counter("team_invites_accepted", "team")
async def _team_invites_accepted(ctx):
    """Einladungen der Person, die angenommen wurden."""
    return await ctx.db.team_invites.count_documents({"invited_by": ctx.user_id, "status": "accepted"})


# ------------------------------------------------------------------ Katalog C (#614): Community, Creator, Profil

@counter("discord_messages", "discord", "community")
async def _discord_messages(ctx):
    """Nachrichten auf dem Vereins-Discord - der Bot zählt je Nachricht am Nutzer hoch."""
    return int((await ctx.user()).get("discord_messages_count") or 0)


# Chat (#2338): „Plauderer“, Team-, Turnier-, Match-Chat und Direktnachrichten - eine Rechnung
# (achievement_progress.chat_counters: nichts Zurückgehaltenes oder Gelöschtes, höchstens 50 am Tag), je Auswertung
# einmal geladen. Neu gerechnet nach einer Chat-Nachricht (Quellen chat, community - leicht, über die Warteschlange) und
# in jedem vollen Lauf; andere Quellen lassen den gespeicherten Stand stehen.
CHAT_COUNTER_SOURCES = ("chat", "community")


async def _chat_value(ctx, key: str) -> int:
    values = await ctx._memo("chat_counters", lambda: achievement_progress.chat_counters(ctx.db, ctx.user_id))
    return int(values.get(key) or 0)


@counter("community_messages_sent", *CHAT_COUNTER_SOURCES)
async def _community_messages(ctx):
    """Plauderer: die offenen Chats - Turnier-Chat und Match-Chat mit einem gemeinsamen Tagesdeckel."""
    return await _chat_value(ctx, "community_messages_sent")


@counter("direct_messages_sent", *CHAT_COUNTER_SOURCES)
async def _direct_messages(ctx):
    return await _chat_value(ctx, "direct_messages_sent")


@counter("team_chat_messages_sent", *CHAT_COUNTER_SOURCES)
async def _team_chat_messages(ctx):
    return await _chat_value(ctx, "team_chat_messages_sent")


@counter("match_chat_messages_sent", *CHAT_COUNTER_SOURCES)
async def _match_chat_messages(ctx):
    return await _chat_value(ctx, "match_chat_messages_sent")


@counter("tournament_chat_messages_sent", *CHAT_COUNTER_SOURCES)
async def _tournament_chat_messages(ctx):
    return await _chat_value(ctx, "tournament_chat_messages_sent")


@counter("gallery_uploads_approved", "community")
async def _gallery_uploads(ctx):
    """Fotos, die die Person in Galerie-Alben hochgeladen hat."""
    return await ctx.db.gallery_photos.count_documents({"uploaded_by": ctx.user_id})


@counter("stickers_collected", "community", "chat")
async def _stickers(ctx):
    """Verschiedene Sticker, die die Person in irgendeinem Chat verschickt hat - wie bei den Chat-Zählern nur aus
    Nachrichten, die nicht zurückgehalten, abgelehnt oder gelöscht sind (#2338)."""
    ids = set()
    for name, field in achievement_progress.CHAT_COLLECTIONS.values():
        query = achievement_progress.counted_chat_query(field, ctx.user_id, **{"sticker.id": {"$exists": True}})
        async for row in ctx.db[name].find(query, {"_id": 0, "sticker.id": 1}):
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


@counter("clips_synced", "stream", "profile")
async def _clips(ctx):
    """Clips auf dem Vereinskanal, die die Person erstellt hat - erkannt am per Anmeldung verknüpften Twitch-Konto
    (#2338): an der Twitch-Kennung, bei älteren Clips ohne Kennung am Namen. Ein getippter Name zählt nicht."""
    twitch = await achievement_progress.linked_twitch(ctx.db, ctx.user_id)
    if not twitch or not (twitch["external_id"] or twitch["login"]):
        return 0
    from services.twitch_clips import STATE_ID
    doc = await ctx.db.settings.find_one({"id": STATE_ID}, {"_id": 0, "clips": 1}) or {}

    def mine(clip: dict) -> bool:
        if clip.get("creator_id"):
            return str(clip["creator_id"]) == twitch["external_id"]
        return bool(twitch["login"]) and str(clip.get("creator_name") or "").strip().lstrip("@").lower() == twitch["login"]
    return sum(1 for clip in doc.get("clips") or [] if mine(clip))


@counter("streamer_verified", "profile", "club", "stream")
async def _streamer_verified(ctx):
    """Verifizierter Streamer (#2338): Twitch per Anmeldung verknüpft und der Verein führt die Person als Streamer
    oder Creator (Kennzeichen ``creator`` am Vereinsprofil, Mitgliederverwaltung → Öffentliche Profile). Von Hand
    vergeben geht weiterhin."""
    if not await achievement_progress.linked_twitch(ctx.db, ctx.user_id):
        return 0
    return 1 if await ctx.db.club_member_profiles.find_one({"user_id": ctx.user_id, "creator": True}, {"_id": 0, "id": 1}) else 0


# ------------------------------------------------------------------ Katalog D (#615): Verein, Besonders, Geheim

# Mondphase wie im Web (seasons/halloween/moon.js): mittlere Rechnung ab dem Neumond vom 6.1.2000, 18:14 UTC.
SYNODIC_DAYS = 29.530588853
REFERENCE_NEW_MOON = datetime(2000, 1, 6, 18, 14, tzinfo=timezone.utc)
FULL_MOON_WINDOW = 0.017  # rund ein halber Tag zu jeder Seite


def moon_phase(at: datetime) -> float:
    """0 = Neumond, 0,5 = Vollmond."""
    days = (at - REFERENCE_NEW_MOON).total_seconds() / 86400
    return (days / SYNODIC_DAYS) % 1


@counter("member_since_founding_year", "club")
async def _founding_member(ctx):
    """Aktives Mitglied seit dem Gründungsjahr des Vereins (Verein → Über uns)."""
    membership = await ctx.db.memberships.find_one({"user_id": ctx.user_id}, {"_id": 0, "member_since": 1, "member_status": 1})
    if not membership or membership.get("member_status") not in ("active", "honorary"):
        return 0
    from services import founding

    # Das Jahr reicht (Handfeld, Gründungsdatum oder Dolibarr) - früher zählte nur ein volles Datum.
    year = (await founding.founding(ctx.db))["founded_year"]
    since = _parse(membership.get("member_since"))
    return 1 if year and since and since.year == year else 0


@counter("membership_years", "club")
async def _membership_years(ctx):
    """Vereinsjubiläum (#848): volle Jahre seit dem Mitgliedsbeginn - der Jahrestag zählt am Tag selbst, in Wien."""
    membership = await ctx.db.memberships.find_one({"user_id": ctx.user_id}, {"_id": 0, "member_since": 1, "member_status": 1})
    if not membership or membership.get("member_status") not in ("active", "honorary"):
        return 0
    since = _parse(membership.get("member_since"))
    if not since:
        return 0
    start = since.astimezone(VIENNA).date()
    today = now_utc().astimezone(VIENNA).date()
    return max(today.year - start.year - ((today.month, today.day) < (start.month, start.day)), 0)


@counter("pioneer_account", "profile")
async def _pioneer(ctx):
    """Eines der ersten hundert Konten der Plattform."""
    created = (await ctx.user()).get("created_at")
    if not created:
        return 0
    return 1 if await ctx.db.users.count_documents({"created_at": {"$lt": created}}) < 100 else 0


@counter("distinct_game_wins_one_season", "tournament")
async def _grand_slam(ctx):
    """Turniersiege in verschiedenen Spielen innerhalb einer Saison - das Maximum über die Saisons."""
    tournaments = (await ctx.participation()).tournaments
    per_season: dict[str, set[str]] = {}
    for tournament_id, placement in (await ctx.placements()).items():
        if 1 not in placement.ranks:
            continue
        tournament = tournaments.get(tournament_id) or {}
        if tournament.get("season_id") and tournament.get("game_id"):
            per_season.setdefault(tournament["season_id"], set()).add(tournament["game_id"])
    return max((len(games) for games in per_season.values()), default=0)


@counter("all_visible_achievements", "achievement")
async def _completionist(ctx):
    """Jede messbare Stufe, die diese Person sehen kann, ist erreicht (ohne Geheimes, Negatives, Hand-Stufen und sich selbst)."""
    user = await ctx.user()
    groups = [g async for g in ctx.db.achievement_groups.find({"public": True, "is_negative": {"$ne": True}, "hidden": {"$ne": True}, "code": {"$ne": "completionist"}}, {"_id": 0, "code": 1, "category": 1})]
    if not user.get("is_club_member"):
        groups = [g for g in groups if g.get("category") != "club"]
    codes = [g["code"] for g in groups]
    if not codes:
        return 0
    tiers = {t["code"] async for t in ctx.db.achievements.find({"group_code": {"$in": codes}, "manual_only": {"$ne": True}}, {"_id": 0, "code": 1})}
    earned = {award.get("tier_code") for award in await ctx.awards()}
    return 1 if tiers and tiers <= earned else 0


@counter("witching_hour_matches", "match")
async def _witching_hour(ctx):
    """Matches, die zwischen 00:00 und 00:15 (Wien) endeten."""
    count = 0
    for row in await ctx.played():
        local = row.when.astimezone(VIENNA) if row.when else None
        if local and local.hour == 0 and local.minute < 15:
            count += 1
    return count


@counter("lucky_seven_days", "match")
async def _lucky_seven(ctx):
    """Tage, die ein Siebter waren und sieben Siege brachten."""
    wins: dict = {}
    for row in await ctx.played():
        if not row.won or not row.when:
            continue
        local = row.when.astimezone(VIENNA)
        if local.day == 7:
            wins[local.date()] = wins.get(local.date(), 0) + 1
    return sum(1 for n in wins.values() if n >= 7)


@counter("palindrome_laps", "fastlap")
async def _palindrome(ctx):
    """Gültige Rundenzeiten, deren Ziffern sich von hinten wie von vorn lesen (1:23.321)."""
    from services.fastlap_standings import effective_ms
    count = 0
    for row in await ctx.lap_times():
        ms = effective_ms(row)
        digits = f"{ms // 60000}{(ms % 60000) // 1000:02d}{ms % 1000:03d}"
        if len(digits) >= 5 and digits == digits[::-1]:
            count += 1
    return count


@counter("echo_results", "match")
async def _echo(ctx):
    """Dreimal hintereinander derselbe Kartenstand (in Spielreihenfolge)."""
    rows = sorted((row for row in await ctx.played() if row.when), key=lambda row: row.when)
    count = 0
    streak = 0
    last = None
    for row in rows:
        pair = _score_pair(row.match, row.mine)
        if pair is None:
            streak = 0
            last = None
            continue
        streak = streak + 1 if pair == last else 1
        last = pair
        if streak == 3:
            count += 1
            streak = 0
            last = None
    return count


@counter("night_shift_nights", "match")
async def _night_shift(ctx):
    """Nächte (22 Uhr bis 6 Uhr, Wien) mit mindestens fünf abgeschlossenen Matches."""
    nights: dict = {}
    for row in await ctx.played():
        if not row.when:
            continue
        local = row.when.astimezone(VIENNA)
        if local.hour >= 22:
            key = local.date()
        elif local.hour < 6:
            key = (local - timedelta(days=1)).date()
        else:
            continue
        nights[key] = nights.get(key, 0) + 1
    return sum(1 for n in nights.values() if n >= 5)


@counter("full_moon_wins", "match")
async def _full_moon(ctx):
    """Siege, während der Mond voll war (rund ein halber Tag zu jeder Seite)."""
    return sum(1 for row in await ctx.played() if row.won and row.when and abs(moon_phase(row.when) - 0.5) <= FULL_MOON_WINDOW)


@counter("leap_day_logins", "profile", "xp")
async def _leap_day(ctx):
    """Tages-Logins an einem 29. Februar."""
    return await ctx.db.xp_events.count_documents({"user_id": ctx.user_id, "source": "daily_login", "day": {"$regex": "-02-29$"}})


# ------------------------------------------------------------------ Katalog D, Rest (#615): Zahlen aus der Vereinsakte
# Abstimmungen und Helferdienste führt das Vereinsmodul. Gezählt wird, wo die Website die Daten der Person ohnehin liest
# (services/member_activity.py); hier steht nur der zuletzt gesehene Stand - fällt Dolibarr aus, bleibt er.

@counter("meetings_attended", "club")
async def _meetings_attended(ctx):
    """Versammlungsbesucher: Generalversammlungen, bei denen die Person da war - am Eingang eingelassen (#845) oder mit
    abgegebener Stimme (ohne Anwesenheit nimmt das Vereinsmodul keine an). Die Akte selbst nennt je Mitglied nur Zu-
    oder Absage, keine Anwesenheit."""
    from services.member_activity import admitted_meetings, member_id_of
    admitted = await admitted_meetings(ctx.db, ctx.user_id, await member_id_of(ctx.db, ctx.user_id))
    return max(len(admitted), int((await ctx.club_record()).get("meetings") or 0))


@counter("member_votes_cast", "club")
async def _member_votes(ctx):
    """Mitgliederstimme: Abstimmungen, bei denen die Person eine Stimme abgegeben hat - nur die Anzahl, nie die Antwort."""
    return int((await ctx.club_record()).get("votes") or 0)


@counter("helper_shifts_completed", "club")
async def _helper_shifts(ctx):
    """Helfer: bestätigte Helferdienste aus der Mitgliederakte, deren Tag vorbei ist."""
    return int((await ctx.club_record()).get("shifts") or 0)


@counter("helper_hours", "club")
async def _helper_hours(ctx):
    """Helferstunden: die Stunden dieser Dienste (notiert oder die Länge der Schicht) - volle Stunden zählen."""
    return int(float((await ctx.club_record()).get("hours") or 0))


# ------------------------------------------------------------------ Katalog F (#1750): externe Wettbewerbe
# Aus den Referenzen des Vereins: je Eintrag, in dem die Person (über ihr Vereinsprofil) steht. Nur aktive,
# abgeschlossene Referenzen - laufende und geplante haben noch keinen Endplatz. Abzeichen ohne Saisonpunkte.

async def _external_entries(ctx) -> list[tuple[dict, dict]]:
    async def load():
        profiles = {row["id"] async for row in ctx.db.club_member_profiles.find(
            {"user_id": ctx.user_id}, {"_id": 0, "id": 1})}
        if not profiles:
            return []
        refs = await ctx.db.references.find(
            {"entries.member_profile_ids": {"$in": list(profiles)}, "is_active": {"$ne": False},
             "status": {"$nin": ["planned", "active"]}},
            {"_id": 0, "id": 1, "series_id": 1, "entries": 1}).to_list(5000)
        return [(ref, entry) for ref in refs for entry in ref.get("entries") or []
                if isinstance(entry, dict) and profiles & set(entry.get("member_profile_ids") or [])]
    return await ctx._memo("external_entries", load)


def _external_place(entry: dict) -> int:
    try:
        return int(entry.get("placement") or 0)
    except (TypeError, ValueError):
        return 0


@counter("external_podiums", "club")
async def _external_podiums(ctx):
    """Podest extern: eigene Einträge mit Platz 1 bis 3 - Team und Einzel getrennt."""
    return sum(1 for _ref, entry in await _external_entries(ctx) if 1 <= _external_place(entry) <= 3)


@counter("external_seasons", "club")
async def _external_seasons(ctx):
    """Dauerbrenner: Saisons (``series_id``) mit eigenem Endplatz in einer ihrer Referenzen - jede Saison einmal, auch
    wenn mehrere Referenzen zu ihr gehören; eine abgebrochene Saison hat keinen Endplatz."""
    return len({ref["series_id"] for ref, entry in await _external_entries(ctx)
                if ref.get("series_id") and _external_place(entry) >= 1})
