"""Ergebnis je Map mit Aufstellung in der Liga (docs/LIGA.md, Abschnitte 2, 5 und 6; #1650, Teile von #1617).

Bei Spielen einer Liga-Staffel (Turnier mit ``league_context``) meldet eine Seite die gespielten Maps: je Map Position,
Modus, Map aus dem geltenden Pool, Sieger, auf Wunsch die Punkte und ihre **eigene** Aufstellung. Die Gegenseite
bestätigt und ergänzt **ihre** Aufstellung. Ein Map-Veto gibt es nicht im System - die Maps werden beim Ergebnis aus dem
Pool erfasst.

Gespeichert wird am Spiel (``matches_v2``):

- ``games``: die geltenden Maps (``MatchGame``) - beim Bestätigen, durch die 48-h-Automatik oder die Turnierleitung,
- ``reports[].games``: die Sicht der jeweiligen Meldung bis zur Bestätigung,
- ``lineups_missing``: Seiten ohne Aufstellung (Bestätigung aus der App, Automatik),
- ``lineup_user_ids``: alle Aufgestellten aus ``games`` und offenen Meldungen - für die Doppel-Einsatz-Prüfung,
- ``map_pool_id``: der Pool, aus dem gemeldet wurde (beim ersten Melden, wenn leer).

Alle Prüfungen stehen hier und melden sich auf Deutsch (``LeagueGamesError``). Turniere ohne ``league_context``
berührt nichts davon - dort bleibt ``games`` unbeachtet.
"""

from __future__ import annotations

import contextlib
import math
from dataclasses import dataclass, field

from services import map_pools
from services.match_audience import registrations_for_match, responsible_user_ids, roster_ids, teams_by_id, users_for
from services.matchday_schedule import matchday_number_of

APP_DETAIL = "Bitte im Web mit Maps und Aufstellung melden."
CONFIRM_DIFFERENT_DETAIL = (
    "Deine Maps, Modi oder Sieger weichen von der Meldung der Gegenseite ab. Wenn ihre Meldung "
    "nicht stimmt, bitte über „Problem melden“ Einspruch einlegen."
)
LINEUP_MISSING_TEXT = "Bitte Aufstellung im Web nachtragen."
NO_POOL_DETAIL = "Für diese Staffel ist noch kein Map-Pool hinterlegt – bitte die Turnierleitung fragen."
DEFAULT_AMEND_HOURS = 48
# Ein Spiel mit festem Ergebnis: seine Maps gelten, offene Meldungen nicht mehr (Doppel-Einsatz-Index).
DECIDED_STATUSES = {"completed", "forfeit"}
MAX_SCORE = 1_000_000


class LeagueGamesError(Exception):
    def __init__(self, detail: str, status_code: int = 422):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def is_league(tournament: dict | None) -> bool:
    """Liga-Spiel heißt: das Turnier ist eine Staffel (``league_context``). Alle anderen Turniere bleiben wie bisher."""
    return bool((tournament or {}).get("league_context"))


@dataclass
class LeagueSetup:
    tournament: dict
    stage: dict | None
    match: dict
    best_of: int
    team_size: int
    mode_order: list[str]
    pool: dict | None
    registrations: list[dict]
    rosters: dict[str, set[str]] = field(default_factory=dict)
    names: dict[str, str] = field(default_factory=dict)

    @property
    def reg_ids(self) -> list[str]:
        return [reg["id"] for reg in self.registrations if reg.get("id")]

    @property
    def needed(self) -> int:
        return self.best_of // 2 + 1


def _positive_int(value, fallback: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    return number if number >= 1 else fallback


async def setup(db, match: dict, tournament: dict | None = None, stage: dict | None = None) -> LeagueSetup | None:
    """Alles, was die Prüfung eines Liga-Spiels braucht - ``None``, wenn das Spiel zu keiner Staffel gehört."""
    from services.match_v2_results import result_best_of

    if tournament is None:
        tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0})
    if not is_league(tournament):
        return None
    if stage is None and match.get("stage_id"):
        stage = await db.tournament_stages.find_one({"id": match["stage_id"]}, {"_id": 0})
    registrations = await registrations_for_match(db, match)
    teams = await teams_by_id(db, registrations)
    rosters = {
        reg["id"]: roster_ids(reg, teams.get(reg.get("team_id") or "")) for reg in registrations if reg.get("id")
    }
    return LeagueSetup(
        tournament=tournament,
        stage=stage,
        match=match,
        best_of=await result_best_of(db, match),
        team_size=_positive_int(tournament.get("team_size"), 1),
        mode_order=[str(mode) for mode in tournament.get("game_mode_order") or [] if mode],
        pool=await map_pools.effective_pool(db, tournament, stage=stage, match=match),
        registrations=registrations,
        rosters=rosters,
        names={
            reg["id"]: reg.get("display_name") or reg.get("ingame_name") or "Team"
            for reg in registrations
            if reg.get("id")
        },
    )


# ---------------------------------------------------------------- Prüfen


def _pool_modes(pool: dict | None) -> list[dict]:
    return [group for group in (pool or {}).get("modes") or [] if group.get("mode")]


def _mode_label(pool: dict | None, mode: str | None) -> str:
    for group in (pool or {}).get("modes") or []:
        if group.get("mode") == mode:
            return group.get("label") or str(mode or "")
    return str(mode or "")


def _map_snapshot(pool: dict | None, mode: str | None, map_id: str) -> dict:
    for group in (pool or {}).get("modes") or []:
        if group.get("mode") == mode:
            for item in group.get("maps") or []:
                if item.get("map_id") == map_id:
                    return item
    return {}


def _score(value, label: str) -> int | float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise LeagueGamesError(f"{label}: Punkte bitte als Zahl angeben.")
    if not math.isfinite(number) or number < 0 or number > MAX_SCORE:
        raise LeagueGamesError(f"{label}: Punkte müssen zwischen 0 und {MAX_SCORE} liegen.")
    return int(number) if number == int(number) else number


def _lineup(setup: LeagueSetup, registration_id: str, raw, label: str) -> list[str]:
    side = setup.names.get(registration_id, "Team")
    ids = [str(item).strip() for item in raw or [] if str(item or "").strip()]
    if len(set(ids)) != len(ids):
        raise LeagueGamesError(f"{label}: jede Person steht nur einmal in der Aufstellung von {side}.")
    if len(ids) != setup.team_size:
        raise LeagueGamesError(f"{label}: die Aufstellung von {side} braucht genau {setup.team_size} Spieler.")
    roster = setup.rosters.get(registration_id) or set()
    if any(user_id not in roster for user_id in ids):
        raise LeagueGamesError(f"{label}: aufgestellt werden nur Spieler aus dem Kader von {side}.")
    return ids


def normalize_games(
    setup: LeagueSetup,
    items: list[dict],
    *,
    required_lineups: set[str] | frozenset = frozenset(),
    allowed_lineups: set[str] | frozenset = frozenset(),
) -> list[dict]:
    """Die gemeldeten Maps nach dem Vertrag prüfen und in die gespeicherte Form bringen (``MatchGame``).

    ``items``: ``{position, mode, map_id, winner_registration_id, scores, lineups: {registration_id: [user_id]}}``.
    ``required_lineups``: Seiten, deren Aufstellung jede Map haben muss; ``allowed_lineups``: Seiten, die eine haben
    dürfen (die eigene beim Melden, beide bei der Turnierleitung)."""
    if not setup.pool:
        raise LeagueGamesError(NO_POOL_DETAIL)
    if not items:
        raise LeagueGamesError("Bitte mindestens eine Map eintragen.")
    if len(items) > setup.best_of:
        raise LeagueGamesError(f"Best of {setup.best_of}: höchstens {setup.best_of} Maps.")
    positions = sorted(int(item.get("position") or 0) for item in items)
    if positions != list(range(1, len(items) + 1)):
        raise LeagueGamesError("Die Maps brauchen die Positionen 1, 2, 3 … ohne Lücke.")
    sides = setup.reg_ids
    with_modes = bool(_pool_modes(setup.pool))
    games: list[dict] = []
    wins = {reg_id: 0 for reg_id in sides}
    for item in sorted(items, key=lambda row: int(row.get("position") or 0)):
        position = int(item["position"])
        label = f"Map {position}"
        mode = (str(item.get("mode") or "").strip() or None) if with_modes else None
        if with_modes:
            if not mode or mode not in {group["mode"] for group in _pool_modes(setup.pool)}:
                raise LeagueGamesError(f"{label}: bitte einen Modus aus dem Pool wählen.")
            if setup.mode_order:
                expected = setup.mode_order[(position - 1) % len(setup.mode_order)]
                if mode != expected:
                    raise LeagueGamesError(f"{label}: gespielt wird hier {_mode_label(setup.pool, expected)}.")
        map_id = str(item.get("map_id") or "").strip()
        if not map_pools.allowed(setup.pool, mode, map_id):
            where = f" für {_mode_label(setup.pool, mode)}" if mode else ""
            raise LeagueGamesError(f"{label}: diese Map ist im Pool{where} nicht freigegeben.")
        winner = str(item.get("winner_registration_id") or "").strip()
        if winner not in sides:
            raise LeagueGamesError(f"{label}: bitte den Sieger der Map wählen.")
        if any(count >= setup.needed for count in wins.values()):
            raise LeagueGamesError(f"Nach Map {position - 1} stand der Sieger schon fest – keine weitere Map.")
        wins[winner] += 1
        scores_raw = item.get("scores") or {}
        if not isinstance(scores_raw, dict) or any(key not in sides for key in scores_raw):
            raise LeagueGamesError(f"{label}: Punkte gehören zu den beiden Seiten des Spiels.")
        scores = {key: _score(value, label) for key, value in scores_raw.items() if value is not None and value != ""}
        lineups_raw = item.get("lineups") or {}
        if not isinstance(lineups_raw, dict) or any(key not in allowed_lineups for key in lineups_raw):
            raise LeagueGamesError(f"{label}: eine Aufstellung gibt nur die eigene Seite an.")
        lineups = {key: _lineup(setup, key, value, label) for key, value in lineups_raw.items() if value}
        for reg_id in required_lineups:
            if reg_id not in lineups:
                raise LeagueGamesError(f"{label}: bitte die eigene Aufstellung angeben ({setup.team_size} Spieler).")
        snapshot = _map_snapshot(setup.pool, mode, map_id)
        games.append(
            {
                "position": position,
                "mode": mode,
                "mode_label": _mode_label(setup.pool, mode) if mode else None,
                "map_id": map_id,
                "map_name": snapshot.get("name"),
                "map_image_url": snapshot.get("image_url"),
                "winner_registration_id": winner,
                "scores": scores,
                "lineups": lineups,
            }
        )
    if max(wins.values() or [0]) < setup.needed:
        raise LeagueGamesError(
            f"Best of {setup.best_of}: eine Seite braucht {setup.needed} gewonnene "
            f"{'Map' if setup.needed == 1 else 'Maps'}."
        )
    return games


def derived_results(setup: LeagueSetup, games: list[dict]) -> list[dict]:
    """Das Ergebnis aus den Maps: Sieger auf Platz 1, ``score`` = gewonnene Maps je Seite."""
    wins = {reg_id: 0 for reg_id in setup.reg_ids}
    for game in games:
        wins[game["winner_registration_id"]] = wins.get(game["winner_registration_id"], 0) + 1
    ordered = sorted(wins.items(), key=lambda pair: -pair[1])
    return [
        {"registration_id": reg_id, "rank": index + 1, "score": count} for index, (reg_id, count) in enumerate(ordered)
    ]


def check_results(setup: LeagueSetup, games: list[dict], results: list[dict]) -> None:
    """Das gemeldete Ergebnis passt zu den Maps - Platz und gewonnene Maps je Seite."""
    expected = {row["registration_id"]: row for row in derived_results(setup, games)}
    given = {row.get("registration_id"): row for row in results or []}
    for reg_id, row in expected.items():
        other = given.get(reg_id) or {}
        score = other.get("score")
        if int(other.get("rank") or 0) != row["rank"] or score is None or float(score) != float(row["score"]):
            text = ":".join(str(item["score"]) for item in derived_results(setup, games))
            raise LeagueGamesError(f"Der Spielstand passt nicht zu den Maps – laut Maps steht es {text}.")


def same_outcome(first: list[dict] | None, second: list[dict] | None) -> bool:
    """Zwei Meldungen nennen dieselben Maps: Position, Modus, Map und Sieger (Punkte und Aufstellungen zählen nicht)."""

    def key(games):
        return [
            (g.get("position"), g.get("mode"), g.get("map_id"), g.get("winner_registration_id")) for g in games or []
        ]

    return key(first) == key(second)


def with_lineups(base: list[dict], other: list[dict] | None, registration_id: str) -> list[dict]:
    """Die Maps der Erstmeldung, ergänzt um die Aufstellung einer Seite aus einer zweiten Meldung."""
    by_position = {game.get("position"): game for game in other or []}
    out = []
    for game in base:
        lineups = dict(game.get("lineups") or {})
        lineup = ((by_position.get(game.get("position")) or {}).get("lineups") or {}).get(registration_id)
        if lineup:
            lineups[registration_id] = lineup
        out.append({**game, "lineups": lineups})
    return out


def missing_lineups(games: list[dict], registration_ids: list[str]) -> list[str]:
    """Seiten, denen in irgendeiner Map die Aufstellung fehlt."""
    return [
        reg_id for reg_id in registration_ids if any(reg_id not in (game.get("lineups") or {}) for game in games or [])
    ]


def _lineup_sources(match: dict) -> list[list[dict]]:
    """Welche Aufstellungen gerade gelten: steht ein Ergebnis fest (``results`` oder Status entschieden), nur ``games``
    des Spiels - auch leer, etwa nach „Nicht erschienen“ ohne Maps; sonst je Seite nur ihre letzte Meldung. Ein
    gehaltenes Ergebnis (10 Sekunden „Rückgängig“) zählt mit seinen Maps schon dazu."""
    from services.v2_match_flows import latest_reports

    if match.get("games") or match.get("results") or str(match.get("status") or "") in DECIDED_STATUSES:
        sources = [match.get("games") or []]
    else:
        sources = [report.get("games") or [] for report in latest_reports(match.get("reports")).values()]
    held = match.get("pending_result")
    if isinstance(held, dict) and held.get("games"):
        sources.append(held["games"])
    return sources


def lineup_union(match: dict) -> list[str]:
    """Alle geltenden Aufgestellten (``_lineup_sources``) - der Index für den Doppel-Einsatz."""
    ids: set[str] = set()
    for games in _lineup_sources(match):
        for game in games:
            for lineup in (game.get("lineups") or {}).values():
                ids.update(user_id for user_id in lineup or [] if user_id)
    return sorted(ids)


def _sides_of(match: dict, user_id: str) -> set[str]:
    sides: set[str] = set()
    for games in _lineup_sources(match):
        for game in games:
            for reg_id, lineup in (game.get("lineups") or {}).items():
                if user_id in (lineup or []):
                    sides.add(reg_id)
    return sides


async def check_double_use(db, setup: LeagueSetup, games: list[dict], registration_ids: set[str] | list[str]) -> None:
    """Kein Doppel-Einsatz: dieselbe Person steht am selben Spieltag in Staffeln derselben Season nicht in den
    Aufstellungen zweier Anmeldungen (``lineup_user_ids``-Index)."""
    season_id = (setup.tournament.get("league_context") or {}).get("season_id")
    matchday = matchday_number_of(setup.match)
    if not season_id or not matchday:
        return
    own_side_of = {}
    for game in games:
        for reg_id, lineup in (game.get("lineups") or {}).items():
            if reg_id in registration_ids:
                for user_id in lineup or []:
                    own_side_of[user_id] = reg_id
    if not own_side_of:
        return
    tournament_ids = [
        row["id"]
        for row in await db.tournaments.find({"league_context.season_id": season_id}, {"_id": 0, "id": 1}).to_list(200)
        if row.get("id")
    ]
    others = await db.matches_v2.find(
        {
            "tournament_id": {"$in": tournament_ids},
            "id": {"$ne": setup.match.get("id")},
            "lineup_user_ids": {"$in": sorted(own_side_of)},
        },
        {"_id": 0},
    ).to_list(200)
    for other in others:
        if matchday_number_of(other) != matchday:
            continue
        for user_id, reg_id in own_side_of.items():
            if _sides_of(other, user_id) - {reg_id}:
                person = (
                    await users_for(db, [user_id], {"_id": 0, "id": 1, "display_name": 1, "username": 1}) or [{}]
                )[0]
                name = person.get("display_name") or person.get("username") or "Eine Person"
                raise LeagueGamesError(
                    f"{name} steht an diesem Spieltag schon in der Aufstellung eines anderen Teams "
                    "– jede Person spielt je Spieltag nur für ein Team.",
                    409,
                )


async def refresh_lineup_index(db, match_id: str) -> None:
    """``lineup_user_ids`` nach dem Stand am Spiel neu setzen (nach Meldung, Ergebnis, Nachtrag, Rückgängig)."""
    match = await db.matches_v2.find_one(
        {"id": match_id}, {"_id": 0, "games": 1, "reports": 1, "results": 1, "status": 1, "pending_result": 1}
    )
    if not match:
        return
    ids = lineup_union(match)
    if ids:
        await db.matches_v2.update_one({"id": match_id}, {"$set": {"lineup_user_ids": ids}})
    else:
        await db.matches_v2.update_one({"id": match_id}, {"$unset": {"lineup_user_ids": ""}})


async def remember_pool(db, setup: LeagueSetup) -> None:
    """Beim ersten Melden mit Maps hält das Spiel den Pool fest, aus dem gemeldet wurde (#1616)."""
    if setup.pool and setup.pool.get("id") and not setup.match.get("map_pool_id"):
        await db.matches_v2.update_one(
            {"id": setup.match["id"], "map_pool_id": None}, {"$set": {"map_pool_id": setup.pool["id"]}}
        )


async def tell_missing_lineups(db, match: dict, registration_ids: list[str]) -> None:
    """Wer ohne Aufstellung bestätigt hat (App, Automatik), wird gebeten, sie im Web nachzutragen."""
    from services.user_notifications import create_user_notification

    if not registration_ids:
        return
    registrations = [reg for reg in await registrations_for_match(db, match) if reg.get("id") in set(registration_ids)]
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "title": 1}) or {}
    label = match.get("round_name") or match.get("matchday_label") or "dein Spiel"
    for user in await users_for(db, await responsible_user_ids(db, registrations)):
        await create_user_notification(
            user["id"],
            "Aufstellung fehlt noch",
            f"{tournament.get('title') or 'Liga'} · {label}: {LINEUP_MISSING_TEXT}",
            url=f"/matches/{match.get('id')}",
            kind="match_result",
            meta={
                "match_id": match.get("id"),
                "tournament_id": match.get("tournament_id"),
                "reason": "lineup_missing",
                "dedupe_key": f"lineup-missing:{match.get('id')}:{user['id']}",
            },
        )


# ---------------------------------------------------------------- Melden und Bestätigen


async def prepare_report(
    db, setup: LeagueSetup, raw_games: list[dict] | None, own_registration_id: str, results: list[dict]
) -> list[dict] | None:
    """Eine Meldung eines Liga-Spiels prüfen. Mit Maps: alles nach dem Vertrag, die eigene Aufstellung je Map, passend
    zur Meldung der Gegenseite (sonst 409 mit Hinweis auf Einspruch). Ohne Maps (die App): nur als Bestätigung einer
    vorhandenen Meldung mit gleichem Stand - sonst 422 „Bitte im Web mit Maps und Aufstellung melden“."""
    from services.v2_match_flows import latest_reports, reports_conflict

    others = [
        report for key, report in latest_reports(setup.match.get("reports")).items() if key != own_registration_id
    ]
    other = others[-1] if others else None
    if raw_games:
        items = [
            {**game, "lineups": {own_registration_id: game.get("lineup")} if game.get("lineup") else {}}
            for game in raw_games
        ]
        games = normalize_games(
            setup, items, required_lineups={own_registration_id}, allowed_lineups={own_registration_id}
        )
        check_results(setup, games, results)
        if other and other.get("games") and not same_outcome(other["games"], games):
            raise LeagueGamesError(CONFIRM_DIFFERENT_DETAIL, 409)
        await check_double_use(db, setup, games, {own_registration_id})
        return games
    if not other or not other.get("games"):
        raise LeagueGamesError(APP_DETAIL)
    if reports_conflict([other, {"registration_id": own_registration_id, "results": results}]):
        raise LeagueGamesError(APP_DETAIL)
    return None


def consensus_games(reports: list[dict] | None, registration_ids: list[str]) -> tuple[list[dict] | None, list[str]]:
    """Die geltenden Maps aus zwei übereinstimmenden Meldungen: die Maps der früheren Meldung, ergänzt um die
    Aufstellung der späteren; dazu die Seiten, denen noch eine Aufstellung fehlt."""
    from services.v2_match_flows import latest_reports

    latest = latest_reports(reports)
    order = {id(report): index for index, report in enumerate(reports or [])}
    ranked = sorted(latest.items(), key=lambda pair: order.get(id(pair[1]), 0))
    base = next(((key, report) for key, report in ranked if report.get("games")), None)
    if not base:
        return None, []
    games = [dict(game) for game in base[1]["games"]]
    for key, report in ranked:
        if key != base[0] and report.get("games"):
            games = with_lineups(games, report["games"], key)
    return games, missing_lineups(games, registration_ids)


def admin_games(setup: LeagueSetup, raw_games: list[dict], results: list[dict]) -> tuple[list[dict], list[str]]:
    """Maps der Turnierleitung (Eintragen oder Korrektur): Aufstellungen beider Seiten, je Seite freiwillig."""
    sides = set(setup.reg_ids)
    games = normalize_games(setup, raw_games, allowed_lineups=sides)
    check_results(setup, games, results)
    return games, missing_lineups(games, setup.reg_ids)


# ---------------------------------------------------------------- Aufstellung nachtragen


AMEND_CLOSED_DETAIL = "Die Frist zum Nachtragen ist vorbei – ändern kann die Aufstellung jetzt nur die Turnierleitung."
REASON_MIN_LENGTH = 5


def _parse_moment(value):
    from datetime import datetime, timezone

    if not value:
        return None
    try:
        moment = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def amend_deadline(setup: LeagueSetup):
    """Bis wann die Seiten ihre Aufstellung nachtragen: ``lineup_amend_hours`` nach dem Ergebnis (Vorgabe 48 h)."""
    from datetime import timedelta

    done = _parse_moment(setup.match.get("completed_at"))
    if not done:
        return None
    return done + timedelta(hours=_positive_int(setup.tournament.get("lineup_amend_hours"), DEFAULT_AMEND_HOURS))


async def amend_lineups(
    db, setup: LeagueSetup, items: list[dict], *, registration_id: str, actor_id: str, staff: bool, reason: str | None
) -> dict:
    """Die Aufstellung einer Seite je Map nachtragen oder ändern (``PUT /api/matches/{id}/lineups``). Die Seiten bis
    ``lineup_amend_hours`` nach dem Ergebnis, danach nur die Turnierleitung - sie immer mit Grund."""
    from models import new_id, now_utc

    match = setup.match
    games = match.get("games") or []
    if not games:
        raise LeagueGamesError(
            "Für dieses Spiel stehen die Maps noch nicht fest – die Aufstellung kommt mit der Meldung.", 409
        )
    if registration_id not in setup.reg_ids:
        raise LeagueGamesError("Diese Seite spielt in diesem Spiel nicht.")
    reason_text = (reason or "").strip()
    if staff:
        if len(reason_text) < REASON_MIN_LENGTH:
            raise LeagueGamesError(f"Bitte einen Grund angeben (mindestens {REASON_MIN_LENGTH} Zeichen).")
    else:
        deadline = amend_deadline(setup)
        if deadline and now_utc() > deadline:
            raise LeagueGamesError(AMEND_CLOSED_DETAIL, 409)
    wanted = {int(item.get("position") or 0): item.get("lineup") for item in items}
    if sorted(wanted) != sorted(int(game.get("position") or 0) for game in games):
        raise LeagueGamesError("Bitte für jede Map des Spiels die Aufstellung angeben.")
    new_games = [
        {
            **game,
            "lineups": {
                **(game.get("lineups") or {}),
                registration_id: _lineup(setup, registration_id, wanted[game["position"]], f"Map {game['position']}"),
            },
        }
        for game in games
    ]
    await check_double_use(db, setup, new_games, {registration_id})
    missing = missing_lineups(new_games, setup.reg_ids)
    stored = await db.matches_v2.update_one(
        {"id": match["id"], "games": games},
        {"$set": {"games": new_games, "lineups_missing": missing, "updated_at": now_utc().isoformat()}},
    )
    if not stored.matched_count:
        raise LeagueGamesError("Das Spiel hat sich gerade geändert – bitte neu laden und noch einmal speichern.", 409)
    await refresh_lineup_index(db, match["id"])
    await db.audit_logs.insert_one(
        {
            "id": new_id(),
            "action": "match.lineup.amend",
            "target_id": match.get("tournament_id"),
            "actor_id": actor_id,
            "data": {
                "match_id": match["id"],
                "registration_id": registration_id,
                "by_staff": staff,
                **({"reason": reason_text} if reason_text else {}),
            },
            "created_at": now_utc().isoformat(),
        }
    )
    return await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0})


# ---------------------------------------------------------------- Matchseite


def _games_view(games: list[dict] | None, people: dict[str, dict], with_lineups: bool = True) -> list[dict]:
    """Maps für die Matchseite - Aufstellungen nur mit Namen und nur für Beteiligte und Turnierleitung (#1650)."""
    out = []
    for game in games or []:
        out.append(
            {
                **{
                    key: game.get(key)
                    for key in (
                        "position",
                        "mode",
                        "mode_label",
                        "map_id",
                        "map_name",
                        "map_image_url",
                        "winner_registration_id",
                        "scores",
                    )
                },
                "lineups": (
                    {
                        reg_id: [people.get(user_id) or {"id": user_id, "name": "Spieler"} for user_id in lineup or []]
                        for reg_id, lineup in (game.get("lineups") or {}).items()
                    }
                    if with_lineups
                    else {}
                ),
            }
        )
    return out


async def page_block(db, setup: LeagueSetup, *, side_id: str | None, can_act: bool, staff: bool = False) -> dict:
    """Was die Matchseite zum Melden, Bestätigen, Nachtragen und Anzeigen braucht. ``side_id``: die Anmeldung, zu der
    die Person gehört (sonst ``None``); ``can_act``: sie darf für diese Seite handeln; ``staff``: Turnierleitung - sie
    bekommt dazu die Kader beider Seiten fürs Ergebnis-Fenster. Aufstellungen sehen nur Beteiligte und die Leitung;
    Gäste bekommen Maps, Sieger und Punkte wie in der Staffel-API."""
    sees_lineups = bool(side_id) or staff
    from models import now_utc
    from services.v2_match_flows import latest_reports

    match = setup.match
    latest = latest_reports(match.get("reports"))
    own_report = latest.get(side_id) if side_id else None
    other_reports = [report for key, report in latest.items() if key != side_id]
    roster = sorted(setup.rosters.get(side_id) or set()) if side_id else []
    wanted = set(roster)
    if staff:
        for members in setup.rosters.values():
            wanted.update(members)
    for games in [match.get("games") or []] + [report.get("games") or [] for report in latest.values()]:
        for game in games:
            for lineup in (game.get("lineups") or {}).values():
                wanted.update(lineup or [])
    people = {}
    if wanted:
        for user in await db.users.find(
            {"id": {"$in": sorted(wanted)}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1, "avatar_url": 1}
        ).to_list(500):
            people[user["id"]] = {
                "id": user["id"],
                "name": user.get("display_name") or user.get("username") or "Spieler",
                "avatar_url": user.get("avatar_url"),
            }
    deadline = amend_deadline(setup)
    open_window = bool(match.get("games")) and (deadline is None or now_utc() <= deadline)
    return {
        "best_of": setup.best_of,
        "needed": setup.needed,
        "team_size": setup.team_size,
        "mode_order": setup.mode_order,
        "pool": setup.pool,
        "sides": [{"registration_id": reg_id, "name": setup.names.get(reg_id)} for reg_id in setup.reg_ids],
        "own_registration_id": side_id,
        "roster": [people.get(user_id) or {"id": user_id, "name": "Spieler"} for user_id in roster],
        "rosters": (
            {
                reg_id: [people.get(user_id) or {"id": user_id, "name": "Spieler"} for user_id in sorted(members)]
                for reg_id, members in setup.rosters.items()
            }
            if staff
            else {}
        ),
        "games": _games_view(match.get("games"), people, sees_lineups),
        "lineups_missing": list(match.get("lineups_missing") or []),
        "own_games": _games_view((own_report or {}).get("games"), people) if side_id else [],
        "proposal_games": (
            _games_view((other_reports[-1] if other_reports else {}).get("games"), people) if side_id or staff else []
        ),
        "can_amend_lineup": bool(can_act and side_id and open_window),
        "amend_until": deadline.isoformat() if deadline else None,
        "app_detail": APP_DETAIL,
    }


@contextlib.asynccontextmanager
async def season_lock(db, tournament: dict | None):
    """Sperre je Season für den Doppel-Einsatz (#1650): Prüfung, Schreiben und Index laufen über Staffeln derselben
    Season nacheinander. Immer nach der Turnier-Sperre nehmen, nie umgekehrt. Ohne Liga-Rahmen: keine Sperre."""
    from services.mutation_lock import mutation_lock

    season_id = ((tournament or {}).get("league_context") or {}).get("season_id")
    if not season_id:
        yield
        return
    async with mutation_lock(db, f"league_season:{season_id}:lineups", wait_seconds=5.0):
        yield
