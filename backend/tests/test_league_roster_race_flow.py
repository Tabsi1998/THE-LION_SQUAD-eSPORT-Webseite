"""Zwei gleichzeitige Aufnahmen derselben Person in verschiedene Co-Teams einer Season (docs/LIGA.md, #2202): Der Eintrag ist je
Season und Person eindeutig, das zweite Einfügen scheitert. Auch dann gehört das zweite Co-Team in den Eintrag - sonst wäre die
Person dort nach dem Stichtag ohne Freigabe aufstellbar und bekäme keinen Hinweis. Der eindeutige Index greift auf echtem
MongoDB von selbst; hier legt ihn der Test an, damit er auch auf mongomock greift. Erfundene Namen."""

import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import staffel  # noqa: E402
from squad_world import squad_registration  # noqa: E402
from test_league_roster_flow import id_world, roster_entry  # noqa: E402

from services import league_roster  # noqa: E402

PAST_DAY = "2026-01-01"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def race_world(flow, *, deadline: str | None = PAST_DAY) -> dict:
    """Rudel A und Rudel B spielen in zwei Staffeln derselben Season; Ida hat noch keinen Eintrag."""
    w = await id_world(flow, deadline=deadline)
    await flow.db.league_rosters.create_index([("season_id", 1), ("user_id", 1)], unique=True)
    w["staffel_b"] = await staffel(flow, w["season_id"], "B")
    w["reg_b"] = await squad_registration(flow, w["staffel_b"], w["lions"], w["squad_b"])
    return w


@pytest.mark.asyncio
async def test_the_second_insert_still_adds_its_co_team_and_the_wait_for_approval(flow):
    w = await race_world(flow)
    ida = w["users"]["Ida"]["id"]
    # Beide haben gelesen, bevor der andere geschrieben hat: Für beide gibt es noch keinen Eintrag.
    first = await league_roster.context_for_tournament(flow.db, w["tournament"], [ida])
    second = await league_roster.context_for_tournament(flow.db, w["staffel_b"], [ida])

    await league_roster.record_members(flow.db, first, [ida], via="squad_join", actor_id=None, squad_id=w["squad_a"]["id"], late=True)
    found = await league_roster.record_members(flow.db, second, [ida], via="squad_join", actor_id=None, squad_id=w["squad_b"]["id"], late=True)

    entry = await roster_entry(flow, w, "Ida")
    assert set(entry["squad_ids"]) == {w["squad_a"]["id"], w["squad_b"]["id"]}
    assert set(entry["late_squad_ids"]) == {w["squad_a"]["id"], w["squad_b"]["id"]}
    assert found[ida]["state"] == "late" and found[ida]["ok"] is False, "dort nicht aufstellbar"
    assert await flow.db.league_rosters.count_documents({"season_id": w["season_id"], "user_id": ida}) == 1


@pytest.mark.asyncio
async def test_before_the_deadline_the_second_co_team_counts_without_waiting(flow):
    w = await race_world(flow, deadline=None)
    ida = w["users"]["Ida"]["id"]
    first = await league_roster.context_for_tournament(flow.db, w["tournament"], [ida])
    second = await league_roster.context_for_tournament(flow.db, w["staffel_b"], [ida])

    await league_roster.record_members(flow.db, first, [ida], via="squad_join", actor_id=None, squad_id=w["squad_a"]["id"])
    found = await league_roster.record_members(flow.db, second, [ida], via="squad_join", actor_id=None, squad_id=w["squad_b"]["id"])

    entry = await roster_entry(flow, w, "Ida")
    assert set(entry["squad_ids"]) == {w["squad_a"]["id"], w["squad_b"]["id"]}
    assert entry["late_squad_ids"] == [] and entry["locked_at"], "die ID ist festgehalten"
    assert found[ida]["state"] == "locked" and found[ida]["ok"] is True


@pytest.mark.asyncio
async def test_the_loser_of_the_race_is_told_about_the_second_co_team(flow, monkeypatch):
    w = await race_world(flow)
    ida = w["users"]["Ida"]["id"]
    read = league_roster.context_for_tournament

    async def stale(db, tournament, user_ids):
        ctx = await read(db, tournament, user_ids)
        if ctx:
            ctx.entries = {}
        return ctx

    monkeypatch.setattr(league_roster, "context_for_tournament", stale)

    await league_roster.on_squad_members_added(flow.db, w["squad_a"], [ida], None)
    await league_roster.on_squad_members_added(flow.db, w["squad_b"], [ida], None)

    notes = await flow.db.notifications.find({"user_id": ida, "meta.reason": "league_late"}, {"_id": 0}).to_list(None)
    assert {row["meta"]["dedupe_key"] for row in notes} == {
        f"league-late:{w['season_id']}:{w['squad_a']['id']}:{ida}", f"league-late:{w['season_id']}:{w['squad_b']['id']}:{ida}"}


@pytest.mark.asyncio
async def test_truly_parallel_additions_end_with_both_co_teams(flow):
    """Auf echtem MongoDB läuft das wirklich gleichzeitig; das Ergebnis muss in jeder Reihenfolge stimmen."""
    w = await race_world(flow)
    ida = w["users"]["Ida"]["id"]

    await asyncio.gather(
        league_roster.on_squad_members_added(flow.db, w["squad_a"], [ida], None),
        league_roster.on_squad_members_added(flow.db, w["squad_b"], [ida], None),
    )

    entry = await roster_entry(flow, w, "Ida")
    assert set(entry["squad_ids"]) == {w["squad_a"]["id"], w["squad_b"]["id"]}
    assert set(entry["late_squad_ids"]) == {w["squad_a"]["id"], w["squad_b"]["id"]}


@pytest.mark.asyncio
async def test_a_second_addition_to_the_same_co_team_stays_one_entry(flow):
    w = await race_world(flow)
    ida = w["users"]["Ida"]["id"]
    first = await league_roster.context_for_tournament(flow.db, w["tournament"], [ida])
    second = await league_roster.context_for_tournament(flow.db, w["tournament"], [ida])

    await league_roster.record_members(flow.db, first, [ida], via="squad_join", actor_id=None, squad_id=w["squad_a"]["id"], late=True)
    found = await league_roster.record_members(flow.db, second, [ida], via="squad_join", actor_id=None, squad_id=w["squad_a"]["id"], late=True)

    entry = await roster_entry(flow, w, "Ida")
    assert entry["squad_ids"] == [w["squad_a"]["id"]] and entry["late_squad_ids"] == [w["squad_a"]["id"]]
    assert found[ida]["state"] == "late"
