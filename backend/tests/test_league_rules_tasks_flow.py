"""Regelwerk der Liga (docs/LIGA.md, #1646): Die Aufgabe „Regeln zustimmen“ auf der Startseite lädt gesammelt - die Zahl der Abfragen hängt
nicht an der Zahl der Seasons. Erfundene Inhalte."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services.league_rules import own_consent_tasks  # noqa: E402

READS = {"find", "find_one", "count_documents", "aggregate", "distinct"}


class CountingCollection:
    def __init__(self, collection, log: list[str], name: str):
        self._collection, self._log, self._name = collection, log, name

    def __getattr__(self, attribute):
        if attribute in READS:
            self._log.append(f"{self._name}.{attribute}")
        return getattr(self._collection, attribute)


class CountingDb:
    def __init__(self, db):
        self._db, self.log = db, []

    def __getattr__(self, name):
        return CountingCollection(getattr(self._db, name), self.log, name)


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def world(flow, seasons: int) -> tuple[dict, list[dict]]:
    """Eine Person ist Captain je eines Co-Teams in ``seasons`` Seasons; jede zweite Season hat ein eigenes Regelwerk, die übrigen erben die Liga."""
    captain = await flow.add_user(name="Captain")
    await flow.db.teams.insert_one({"id": "team", "name": "Löwen", "leader_id": "jemand", "member_ids": [captain["id"]]})
    registrations = []
    for index in range(seasons):
        league_id, season_id = f"l{index % 3}", f"s{index}"
        if not await flow.db.leagues.find_one({"id": league_id}, {"_id": 1}):
            await flow.db.leagues.insert_one({"id": league_id, "name": f"Liga {index % 3}", "slug": f"liga-{index % 3}", "status": "active"})
            await flow.db.league_rules.insert_one({"id": f"rl{index % 3}", "scope": "league", "scope_id": league_id, "status": "published", "version": 1,
                                                   "valid_from": "2020-01-01", "published_at": "2020-01-01T00:00:00+00:00", "requires_consent": True,
                                                   "body_md": "# Lang\nText", "frozen": {}})
        await flow.db.league_seasons.insert_one({"id": season_id, "league_id": league_id, "name": f"Season {index}", "slug": f"season-{index}",
                                                 "status": "active", "visibility": "public", "number": index})
        await flow.db.tournaments.insert_one({"id": f"t{index}", "title": "Staffel", "league_context": {"league_id": league_id, "season_id": season_id,
                                                                                                         "division_id": "d", "staffel": "A"}})
        await flow.db.team_squads.insert_one({"id": f"q{index}", "team_id": "team", "name": f"Rudel {index}", "captain_id": captain["id"],
                                              "member_ids": [captain["id"]], "status": "active"})
        if index % 2:
            await flow.db.league_rules.insert_one({"id": f"rs{index}", "scope": "league_season", "scope_id": season_id, "status": "published", "version": 1,
                                                   "valid_from": "2020-01-01", "published_at": "2021-01-01T00:00:00+00:00", "requires_consent": True,
                                                   "body_md": "# Lang\nText", "frozen": {}})
        registrations.append({"id": f"r{index}", "tournament_id": f"t{index}", "team_id": "team", "squad_id": f"q{index}", "user_id": None})
    return captain, registrations


@pytest.mark.asyncio
async def test_the_number_of_reads_does_not_grow_with_the_seasons(flow):
    captain, registrations = await world(flow, 12)
    small = CountingDb(flow.db)
    tasks_small = await own_consent_tasks(small, captain, registrations[:2])
    large = CountingDb(flow.db)
    tasks_large = await own_consent_tasks(large, captain, registrations)
    assert len(tasks_small) == 2 and len(tasks_large) == 12
    assert len(large.log) == len(small.log), f"{sorted(large.log)} gegen {sorted(small.log)}"
    assert len(large.log) <= 12


@pytest.mark.asyncio
async def test_the_rule_texts_are_not_loaded_for_a_task(flow):
    captain, registrations = await world(flow, 2)
    calls = []
    real = flow.db.league_rules.find

    def find(query, projection=None, **kwargs):
        calls.append(projection or {})
        return real(query, projection, **kwargs)

    class Spy(CountingDb):
        def __getattr__(self, name):
            if name == "league_rules":
                return type("Rules", (), {"find": staticmethod(find)})
            return super().__getattr__(name)

    await own_consent_tasks(Spy(flow.db), captain, registrations)
    assert calls and all(row.get("body_md") == 0 and row.get("frozen") == 0 for row in calls)


@pytest.mark.asyncio
async def test_a_task_lists_only_what_is_open_and_visible(flow):
    captain, registrations = await world(flow, 4)
    await flow.db.league_rule_consents.insert_one({"id": "z", "rule_version_id": "rl0", "season_id": "s0", "squad_id": "q0", "user_id": captain["id"]})
    await flow.db.league_seasons.update_one({"id": "s2"}, {"$set": {"visibility": "off"}})
    await flow.db.league_seasons.update_one({"id": "s3"}, {"$set": {"status": "completed"}})
    tasks = await own_consent_tasks(flow.db, captain, registrations)
    assert [(row["season_id"], row["squad_name"], row["version_label"]) for row in tasks] == [("s1", "Rudel 1", "Version 1")]
    assert tasks[0]["rules_url"] == "/liga/liga-1/season-1/regeln" and tasks[0]["title"] == "Liga 1 Season 1"


@pytest.mark.asyncio
async def test_someone_without_a_role_gets_no_task(flow):
    captain, registrations = await world(flow, 2)
    other = await flow.add_user(name="Mitglied")
    assert await own_consent_tasks(flow.db, other, registrations) == []
    assert captain


@pytest.mark.asyncio
async def test_without_squads_nothing_is_read(flow):
    log = CountingDb(flow.db)
    user = await flow.add_user(name="Einzeln")
    assert await own_consent_tasks(log, user, [{"id": "r", "tournament_id": "t", "user_id": user["id"]}]) == []
    assert log.log == []
