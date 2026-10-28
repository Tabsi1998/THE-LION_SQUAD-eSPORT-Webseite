"""Liga P1 – Nachbesserungen aus der Prüfung (docs/LIGA.md, #1622): Teilindex, Sichtbarkeit sofort, Map-Pool entfernen,
gleichzeitiges Übertragen, Jahreswertung mit nur Staffeln, öffentliche Season-Ansicht. Nur erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

ADMIN = "/api/admin/leagues"
SEASON_ONE = {"start_date": "2026-11-10T00:00:00",
              "blocked_periods": [{"start_date": "2026-12-21", "end_date": "2027-01-03", "label": "Weihnachtspause"}]}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup_staffel(flow, *, season: dict | None = None, with_pool: bool = False):
    admin = await flow.add_staff()
    flow.act_as(admin)
    game = (await flow.post("/api/games", json={"name": "Probe Shooter", "slug": "probe-shooter",
                                                "match_modes": [{"mode": "snd", "label": "Suchen & Zerstören"}]})).json()
    league = (await flow.post(ADMIN, json={"name": "Probe-Liga", "game_id": game["id"]})).json()
    season_doc = (await flow.post(f"{ADMIN}/{league['id']}/seasons", json={**SEASON_ONE, **(season or {})})).json()
    if with_pool:
        hafen = (await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Hafenkante", "modes": ["snd"]})).json()
        saved = await flow.put(f"{ADMIN}/seasons/{season_doc['id']}/map-pool",
                               json={"modes": [{"mode": "snd", "map_ids": [hafen["id"]]}]})
        assert saved.status_code == 200, saved.text
    division = (await flow.post(f"{ADMIN}/seasons/{season_doc['id']}/divisions", json={})).json()
    created = await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})
    assert created.status_code == 200, created.text
    staffel = await flow.db.tournaments.find_one({"id": created.json()["tournament_id"]}, {"_id": 0})
    return admin, season_doc, division, staffel


# ---------------------------------------------------------------- 5. Teilindex

class RecordingTournaments:
    """Merkt sich jede Abfrage auf ``tournaments`` - für die Frage, ob sie den Teilindex treffen kann."""

    def __init__(self, db):
        self._db = db
        self.filters: list[dict] = []

    def __getattr__(self, name):
        target = getattr(self._db, name)
        return _Recorder(target, self.filters) if name == "tournaments" else target

    def __getitem__(self, name):
        return self.__getattr__(name)


class _Recorder:
    def __init__(self, collection, filters):
        self._collection = collection
        self._filters = filters

    def __getattr__(self, name):
        attribute = getattr(self._collection, name)
        if name not in ("find", "find_one", "count_documents", "distinct", "update_many", "update_one"):
            return attribute

        def call(*args, **kwargs):
            query = args[1] if name == "distinct" and len(args) > 1 else (args[0] if args else kwargs.get("filter"))
            if isinstance(query, dict):
                self._filters.append(query)
            return attribute(*args, **kwargs)
        return call


@pytest.mark.asyncio
async def test_league_context_queries_carry_the_partial_index_condition(flow, monkeypatch):
    import routes.league_routes as league_routes

    _admin, season, division, _staffel = await setup_staffel(flow)
    recorder = RecordingTournaments(flow.db)
    monkeypatch.setattr(league_routes, "get_db", lambda: recorder)

    assert (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).status_code == 200
    assert (await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"weeks_total": 11})).status_code == 200

    by_context = [query for query in recorder.filters if any(str(key).startswith("league_context.") for key in query)]
    assert len(by_context) >= 3
    assert all(query.get("league_context") == {"$type": "object"} for query in by_context), by_context
