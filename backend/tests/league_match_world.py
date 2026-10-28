"""Aufbau für die Tests „Ergebnis je Map mit Aufstellung“ (docs/LIGA.md, #1650). Erfundene Namen.

Eine Liga-Staffel (``league_context``, Best of 3, Teamgröße 2) mit Map-Pool für zwei Modi, zwei Co-Teams mit Captain
und ein Spiel am ersten Spieltag zwischen ihnen. Der Pool erlaubt in „Stellung“ Hafen und Nebel, in „Suchen“ Nebel und
Turm; die Reihenfolge der Modi ist Stellung, Suchen, Stellung.
"""

from __future__ import annotations

from datetime import timedelta

from flow_harness import new_id
from models import now_utc
from squad_world import make_squad, make_team, squad_registration

GAME_ID = "probe-shooter"
POOL = [
    {
        "mode": "stellung",
        "label": "Stellung",
        "maps": [
            {"map_id": "map-hafen", "slug": "hafen", "name": "Hafen", "image_url": "/uploads/maps/hafen.webp"},
            {"map_id": "map-nebel", "slug": "nebel", "name": "Nebel", "image_url": "/uploads/maps/nebel.webp"},
        ],
    },
    {
        "mode": "suchen",
        "label": "Suchen & Zerstören",
        "maps": [
            {"map_id": "map-nebel", "slug": "nebel", "name": "Nebel", "image_url": "/uploads/maps/nebel.webp"},
            {"map_id": "map-turm", "slug": "turm", "name": "Turm", "image_url": "/uploads/maps/turm.webp"},
        ],
    },
]


async def add_pool(flow, tournament: dict) -> dict:
    doc = {
        "id": new_id(),
        "scope": "tournament",
        "scope_id": tournament["id"],
        "tournament_id": tournament["id"],
        "version": 1,
        "game_id": GAME_ID,
        "modes": POOL,
        "created_at": now_utc().isoformat(),
    }
    await flow.db.map_pools.insert_one(dict(doc))
    return doc


async def staffel(flow, season_id: str, letter: str = "A", **fields) -> dict:
    tournament = await flow.create_tournament(
        team_mode="team",
        team_size=2,
        format="league",
        game_id=GAME_ID,
        status="live",
        best_of=3,
        event_mode="online",
        max_participants=8,
        game_mode_order=["stellung", "suchen"],
        league_context={"league_id": "liga", "season_id": season_id, "division_id": "liga-1", "staffel": letter},
        **fields,
    )
    await add_pool(flow, tournament)
    return tournament


async def duel(flow, tournament: dict, reg_a: dict, reg_b: dict, *, matchday: int = 1) -> dict:
    match = {
        "id": new_id(),
        "tournament_id": tournament["id"],
        "stage_id": new_id(),
        "match_type": "duel",
        "status": "scheduled",
        "round": matchday,
        "matchday_number": matchday,
        "scheduled_at": (now_utc() - timedelta(hours=1)).isoformat(),
        "slots": [
            {"slot": 1, "status": "filled", "registration_id": reg_a["id"]},
            {"slot": 2, "status": "filled", "registration_id": reg_b["id"]},
        ],
    }
    await flow.db.matches_v2.insert_one(dict(match))
    return match


async def world(flow) -> dict:
    names = ["LoeLeitung", "Kapitaen", "Mila", "Tom", "Ida", "FalLeitung", "Falke1", "Falke2", "Falke3", "Fremd"]
    users = {name: await flow.add_user(name=name) for name in names}
    lions = await make_team(
        flow, "Loewen", leader=users["LoeLeitung"], members=[users[name] for name in ("Kapitaen", "Mila", "Tom", "Ida")]
    )
    falcons = await make_team(
        flow, "Falken", leader=users["FalLeitung"], members=[users[name] for name in ("Falke1", "Falke2", "Falke3")]
    )
    squad_a = await make_squad(
        flow,
        lions,
        "Rudel A",
        [users[n] for n in ("Kapitaen", "Mila", "Tom")],
        captain=users["Kapitaen"],
        game_id=GAME_ID,
    )
    squad_b = await make_squad(
        flow, lions, "Rudel B", [users[n] for n in ("Tom", "Ida", "LoeLeitung")], game_id=GAME_ID
    )
    horst = await make_squad(
        flow,
        falcons,
        "Horst",
        [users[n] for n in ("Falke1", "Falke2", "Falke3")],
        captain=users["Falke1"],
        game_id=GAME_ID,
    )
    season_id = new_id()
    tournament = await staffel(flow, season_id)
    reg_a = await squad_registration(flow, tournament, lions, squad_a)
    reg_h = await squad_registration(flow, tournament, falcons, horst)
    match = await duel(flow, tournament, reg_a, reg_h)
    staff = await flow.add_staff()
    return {
        "users": users,
        "lions": lions,
        "falcons": falcons,
        "squad_a": squad_a,
        "squad_b": squad_b,
        "horst": horst,
        "season_id": season_id,
        "tournament": tournament,
        "reg_a": reg_a,
        "reg_h": reg_h,
        "match": match,
        "staff": staff,
    }


def ids(w: dict, *names: str) -> list[str]:
    return [w["users"][name]["id"] for name in names]


def two_nil(w: dict, *, lineup: list[str] | None = None, side: str = "reg_a", winner: str = "reg_a") -> dict:
    """Meldung 2:0 mit Hafen (Stellung) und Turm (Suchen) - auf Wunsch mit eigener Aufstellung."""
    win, lose = (w["reg_a"], w["reg_h"]) if winner == "reg_a" else (w["reg_h"], w["reg_a"])
    games = [
        {
            "position": 1,
            "mode": "stellung",
            "map_id": "map-hafen",
            "winner_registration_id": win["id"],
            "scores": {win["id"]: 250, lose["id"]: 180},
        },
        {"position": 2, "mode": "suchen", "map_id": "map-turm", "winner_registration_id": win["id"]},
    ]
    if lineup is not None:
        games = [{**game, "lineup": lineup} for game in games]
    return {
        "results": [
            {"registration_id": win["id"], "rank": 1, "score": 2},
            {"registration_id": lose["id"], "rank": 2, "score": 0},
        ],
        "games": games,
    }
