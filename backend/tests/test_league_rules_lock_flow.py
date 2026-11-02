"""Regelwerk der Liga (docs/LIGA.md, #1646): Veröffentlichen, Zustimmen und Löschen laufen über dieselbe Sperre - zwischen der letzten Prüfung und dem
Löschen kommt nichts mehr dazu. Sperren sind nur auf echtem MongoDB exklusiv (eindeutiger Index), darum laufen diese Tests dort
(``scripts/flow_mongo_tests.py``). Erfundene Inhalte."""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_rules_world import ADMIN_LEAGUES, PUBLIC, league_scope, make_bare_world, make_world, publish, season_scope, today  # noqa: E402
from league_start_world import ok  # noqa: E402
from services import league_rule_blocks, league_service, squad_registration  # noqa: E402
from services.mutation_lock import league_resource, league_season_resource, mutation_lock  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def only_real(flow) -> None:
    if not flow.real_mongo:
        pytest.skip("Sperren sind nur auf echtem MongoDB exklusiv")


async def draft(flow, target: str, body: str = "# A\nText") -> dict:
    return ok(await flow.put(f"{target}/draft", json={"title": "A", "body_md": body, "annexes": []}))


def publish_body(revision: int) -> dict:
    return {"revision": revision, "valid_from": today(), "change_reason": "Ein Grund"}


async def ask_to_delete(flow, url: str):
    return await flow.client.request("DELETE", url, json={"reason": "Testweise aufräumen"})


def test_rules_use_the_existing_lock_of_the_season():
    assert squad_registration.season_lock_resource({"league_context": {"season_id": "s1"}}) == league_season_resource("s1")
    assert league_resource("l1") != league_season_resource("l1")


@pytest.mark.asyncio
async def test_publishing_waits_for_the_lock_of_its_scope(flow):
    only_real(flow)
    w = await make_bare_world(flow)
    for target, resource in ((season_scope(w), league_season_resource(w["season"]["id"])), (league_scope(w), league_resource(w["league"]["id"]))):
        row = await draft(flow, target)
        async with mutation_lock(flow.db, resource):
            busy = await flow.post(f"{target}/publish", json=publish_body(row["revision"]))
        assert busy.status_code == 409, busy.text
        assert await flow.db.league_rules.count_documents({"id": row["id"], "status": "published"}) == 0
        ok(await flow.post(f"{target}/publish", json=publish_body(row["revision"])))


@pytest.mark.asyncio
async def test_a_consent_waits_for_the_lock_of_the_season(flow):
    only_real(flow)
    w = await make_world(flow)
    version = await publish(flow, w, requires_consent=True)
    flow.act_as(w["captain"])
    body = {"version_id": version["id"], "season_id": w["season"]["id"], "squad_id": w["squads"][0]["id"]}
    async with mutation_lock(flow.db, league_season_resource(w["season"]["id"])):
        busy = await flow.post(f"{PUBLIC}/consents", json=body)
    assert busy.status_code == 409, busy.text
    assert await flow.db.league_rule_consents.count_documents({}) == 0
    ok(await flow.post(f"{PUBLIC}/consents", json=body))


@pytest.mark.asyncio
async def test_deleting_waits_for_the_locks_of_season_and_league(flow):
    only_real(flow)
    w = await make_bare_world(flow)
    season_url, league_url = f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}", f"{ADMIN_LEAGUES}/{w['league']['id']}"
    async with mutation_lock(flow.db, league_season_resource(w["season"]["id"])):
        assert (await ask_to_delete(flow, season_url)).status_code == 409
        assert (await ask_to_delete(flow, league_url)).status_code == 409
    async with mutation_lock(flow.db, league_resource(w["league"]["id"])):
        assert (await ask_to_delete(flow, league_url)).status_code == 409
    assert await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 1})
    assert await flow.db.leagues.find_one({"id": w["league"]["id"]}, {"_id": 1})


@pytest.mark.asyncio
async def test_publishing_after_the_last_check_of_a_deletion_does_not_get_through(flow, monkeypatch):
    """Die Lücke aus der Prüfung: Die Prüfung ist durch, das Löschen läuft gleich - genau dann versucht jemand zu veröffentlichen."""
    only_real(flow)
    w = await make_bare_world(flow)
    row = await draft(flow, season_scope(w))
    answers = []
    real = league_service._added_meanwhile

    async def meanwhile(*args):
        answers.append(await flow.post(f"{season_scope(w)}/publish", json=publish_body(row["revision"])))
        return await real(*args)

    monkeypatch.setattr(league_service, "_added_meanwhile", meanwhile)
    deleted = await ask_to_delete(flow, f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}")
    assert deleted.status_code == 200, deleted.text
    assert answers[0].status_code == 409, answers[0].text
    assert await flow.db.league_rules.count_documents({"status": "published"}) == 0, "nichts Veröffentlichtes ohne Season"


@pytest.mark.asyncio
async def test_deleting_during_a_publication_does_not_get_through(flow, monkeypatch):
    only_real(flow)
    w = await make_bare_world(flow)
    row = await draft(flow, season_scope(w), body="# Maps\n[[baustein:map_pool]]")
    answers = []
    real = league_rule_blocks.resolve

    async def meanwhile(db, keys, league, season):
        answers.append(await ask_to_delete(flow, f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}"))
        return await real(db, keys, league, season)

    monkeypatch.setattr(league_rule_blocks, "resolve", meanwhile)
    published = await flow.post(f"{season_scope(w)}/publish", json=publish_body(row["revision"]))
    assert published.status_code == 200, published.text
    assert answers[0].status_code == 409, answers[0].text
    assert await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 1})


@pytest.mark.asyncio
@pytest.mark.parametrize("attempt", range(3))
async def test_publishing_and_deleting_at_once_never_both_win(flow, attempt):
    only_real(flow)
    w = await make_bare_world(flow)
    row = await draft(flow, season_scope(w))
    delete_call = ask_to_delete(flow, f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}")
    publish_call = flow.post(f"{season_scope(w)}/publish", json=publish_body(row["revision"]))
    if attempt % 2:
        published, deleted = await asyncio.gather(publish_call, delete_call)
    else:
        deleted, published = await asyncio.gather(delete_call, publish_call)
    assert not (deleted.status_code == 200 and published.status_code == 200), attempt
    remaining = await flow.db.league_rules.count_documents({"status": "published"})
    gone = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 1}) is None
    assert not (gone and remaining), "eine Fassung ohne Season darf es nicht geben"
