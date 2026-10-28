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


# ---------------------------------------------------------------- 1. Sichtbarkeit sofort

@pytest.mark.asyncio
async def test_switching_the_season_off_hides_every_staffel_at_once_even_locked_ones(flow):
    admin, season, division, staffel = await setup_staffel(flow, season={"visibility": "public"})
    second = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()
    await flow.db.tournaments.update_many({}, {"$set": {"status": "live", "visibility": "public", "is_public": True}})
    await flow.db.tournaments.update_one({"id": second["tournament_id"]}, {"$set": {"locked_at": "2026-12-01T10:00:00+00:00"}})
    slugs = [staffel["slug"], second["slug"]]

    flow.act_as(None)
    assert (await flow.get(f"/api/tournaments/{staffel['slug']}")).status_code == 200
    assert staffel["slug"] in (await flow.get("/api/sitemap.xml")).text

    flow.act_as(admin)
    changed = await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"visibility": "off"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["visibility_applied"] == 2
    assert changed.json()["staffeln_to_sync"] == 0  # nur die Sichtbarkeit - nichts mehr zu übertragen
    for row in await flow.db.tournaments.find({}, {"_id": 0}).to_list(None):
        assert (row["visibility"], row["is_public"]) == ("internal", False)

    flow.act_as(None)
    for slug in slugs:
        assert (await flow.get(f"/api/tournaments/{slug}")).status_code == 404
    listed = {row["slug"] for row in (await flow.get("/api/tournaments")).json()}
    assert not listed & set(slugs)
    found = (await flow.get("/api/search", params={"q": "Staffel"})).json()["items"]
    assert not [row for row in found if row["kind"] == "tournament"]
    sitemap = (await flow.get("/api/sitemap.xml")).text
    assert all(slug not in sitemap for slug in slugs)
    actions = [row["action"] for row in await flow.db.audit_logs.find({}, {"_id": 0}).to_list(None)]
    assert actions.count("league.staffel.sync") == 1


@pytest.mark.asyncio
async def test_a_locked_staffel_still_takes_rules_text_but_keeps_its_calendar(flow):
    admin, season, _division, staffel = await setup_staffel(flow)
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"locked_at": "2026-12-01T10:00:00+00:00"}})
    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"rules_text": "Neu", "weeks_total": 12})

    result = (await flow.post(f"{ADMIN}/seasons/{season['id']}/sync")).json()["staffeln"][0]
    assert "always" in result["applied"]
    assert {item["group"]: item["reason"] for item in result["skipped"]} == {
        "before_start": "Die Staffel ist gesperrt.", "before_result": "Die Staffel ist gesperrt."}
    after = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0})
    assert after["rules"] == "Neu" and after["matchday_weeks_total"] == 10


# ---------------------------------------------------------------- 3. Map-Pool entfernen

@pytest.mark.asyncio
async def test_removing_the_season_pool_reaches_staffeln_without_a_result_only(flow):
    from services import map_pools

    admin, season, division, staffel = await setup_staffel(flow, with_pool=True)
    played = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()
    await flow.db.matches_v2.insert_one({"id": "m1", "tournament_id": played["tournament_id"], "status": "completed",
                                         "slots": []})
    assert await map_pools.current(flow.db, "tournament", staffel["id"])

    assert (await flow.delete(f"{ADMIN}/seasons/{season['id']}/map-pool")).status_code == 200
    rows = {row["tournament_id"]: row for row in (await flow.post(f"{ADMIN}/seasons/{season['id']}/sync")).json()["staffeln"]}

    assert await map_pools.current(flow.db, "tournament", staffel["id"]) is None
    assert "map_pool" in rows[staffel["id"]]["applied"] and "map_pool" in rows[staffel["id"]]["changed"]
    assert await map_pools.current(flow.db, "tournament", played["tournament_id"])
    kept = rows[played["tournament_id"]]
    assert "map_pool" not in kept["applied"]
    assert [item["reason"] for item in kept["skipped"] if item["group"] == "map_pool"] == [
        "Die Season hat keinen Map-Pool mehr, die Staffel behält ihren: Es gibt schon ein Ergebnis."]
