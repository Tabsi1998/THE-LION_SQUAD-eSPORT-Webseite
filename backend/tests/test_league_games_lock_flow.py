"""Doppel-Einsatz über Staffeln hinweg unter der Season-Sperre (#1650, Review P4): zwei gleichzeitige Meldungen
mit derselben Person in zwei Staffeln derselben Season lassen nur eine durch. Erfundene Namen."""

import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import duel, ids, staffel, two_nil, world  # noqa: E402
from squad_world import squad_registration  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def second_staffel(flow, w: dict) -> dict:
    """Staffel B derselben Season: Rudel B (mit Tom) gegen Horst am selben Spieltag."""
    staffel_b = await staffel(flow, w["season_id"], "B")
    reg_b = await squad_registration(flow, staffel_b, w["lions"], w["squad_b"])
    rivals = await squad_registration(flow, staffel_b, w["falcons"], w["horst"])
    match = await duel(flow, staffel_b, reg_b, rivals, matchday=1)
    body = {
        "results": [
            {"registration_id": reg_b["id"], "rank": 1, "score": 2},
            {"registration_id": rivals["id"], "rank": 2, "score": 0},
        ],
        "games": [
            {
                "position": 1,
                "mode": "stellung",
                "map_id": "map-hafen",
                "winner_registration_id": reg_b["id"],
                "lineup": ids(w, "Tom", "Ida"),
            },
            {
                "position": 2,
                "mode": "suchen",
                "map_id": "map-turm",
                "winner_registration_id": reg_b["id"],
                "lineup": ids(w, "Tom", "Ida"),
            },
        ],
    }
    return {"match": match, "body": body}


async def report_b(flow, w: dict, b: dict):
    flow.act_as(w["users"]["LoeLeitung"])  # Rudel B hat keinen Captain - die Teamleitung handelt dort
    return await flow.post(f"/api/matches/{b['match']['id']}/report", json=b["body"])


class LineupCheckGate:
    """Lässt die ersten beiden Doppel-Einsatz-Abfragen (``lineup_user_ids``) aufeinander warten - so lesen ohne Sperre
    beide den alten Stand, bevor eine schreibt (wie zwei Worker auf echtem MongoDB). Mit Sperre wartet die zweite
    Anfrage schon vorher; die erste läuft nach kurzer Wartezeit allein weiter."""

    def __init__(self, db, timeout: float = 0.5):
        self._db = db
        self._barrier = asyncio.Barrier(2)
        self._timeout = timeout
        self._met = 0

    def __getattr__(self, name):
        target = getattr(self._db, name)
        return _GatedMatches(target, self) if name == "matches_v2" else target

    def __getitem__(self, name):
        return self.__getattr__(name)

    async def meet(self):
        if self._met >= 2:
            return
        self._met += 1
        try:
            await asyncio.wait_for(self._barrier.wait(), self._timeout)
        except (asyncio.TimeoutError, asyncio.BrokenBarrierError):
            pass


class _GatedMatches:
    def __init__(self, collection, gate):
        self._collection = collection
        self._gate = gate

    def __getattr__(self, name):
        return getattr(self._collection, name)

    def find(self, query=None, *args, **kwargs):
        cursor = self._collection.find(query, *args, **kwargs)
        if not (isinstance(query, dict) and "lineup_user_ids" in query):
            return cursor
        gate = self._gate

        class Cursor:
            async def to_list(self, length=None):
                rows = await cursor.to_list(length)
                await gate.meet()
                return rows

        return Cursor()


@pytest.mark.asyncio
async def test_two_reports_at_once_with_the_same_person_let_one_through(flow, monkeypatch):
    import routes.match_routes as match_routes

    w = await world(flow)
    b = await second_staffel(flow, w)
    # Wie in database.init_indexes: eine Sperre je Ressource - erst damit schließt mongomock einander aus.
    await flow.db.mutation_locks.create_index("resource", unique=True)
    gate = LineupCheckGate(flow.db)
    monkeypatch.setattr(match_routes, "get_db", lambda: gate)
    tom_a = two_nil(w, lineup=ids(w, "Kapitaen", "Tom"))
    users = w["users"]

    # Beide Anfragen laufen gleichzeitig - je eine eigene Person, über einen Kopf der Anfrage.
    import server
    from auth import get_current_user
    from fastapi import Request

    async def by_header(request: Request) -> dict:
        return users[request.headers["x-test-user"]]

    monkeypatch.setitem(server.app.dependency_overrides, get_current_user, by_header)
    first, second = await asyncio.gather(
        flow.client.post(f"/api/matches/{w['match']['id']}/report", json=tom_a, headers={"x-test-user": "Kapitaen"}),
        flow.client.post(
            f"/api/matches/{b['match']['id']}/report", json=b["body"], headers={"x-test-user": "LoeLeitung"}
        ),
    )

    assert sorted([first.status_code, second.status_code]) == [200, 409], (first.text, second.text)
    taken = [
        m
        for m in await flow.db.matches_v2.find({"lineup_user_ids": users["Tom"]["id"]}, {"_id": 0, "id": 1}).to_list(5)
    ]
    assert len(taken) == 1, "Tom steht nur in einer Aufstellung des Spieltags"
