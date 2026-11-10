"""``team_members.joined_at`` beim Anlegen einer Zeile (#2337, Review N3).

Rolle setzen und Teamleitung übergeben legen die Zeile in ``team_members`` an, wenn sie fehlt - bisher ohne ``joined_at``.
Beide Wege verlangen, dass die Person schon im Team steht (``teams.member_ids``); es fehlt nur die Zeile. Das genaueste
Datum gewinnt: der letzte Beitritt der Person zu diesem Team aus dem Protokoll (bei einem Wiedereintritt der letzte),
sonst das Gründungsdatum des Teams, erst dann „jetzt“. So verliert ein langjähriges Mitglied keine alten Teamspiele, wer
später kam, bekommt keine geschenkt, und das Feld ist nie leer. Eine vorhandene Zeile behält ihr Beitrittsdatum.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import achievement_play as play  # noqa: E402
from flow_harness import make_flow, new_id  # noqa: E402
import badges  # noqa: E402
from models import now_utc  # noqa: E402
from services import achievement_counters as counters  # noqa: E402

FOUNDED = "2026-01-01T00:00:00+00:00"
LATER = "2026-03-01T00:00:00+00:00"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


async def row(flow, team: dict, user: dict) -> dict | None:
    return await flow.db.team_members.find_one({"team_id": team["id"], "user_id": user["id"]}, {"_id": 0})


async def team_with_rowless_member(flow):
    """Leitung (gegründet am 1.1.) und ein Mitglied mit Zeile seit März, dazu eine Person, die nur in ``member_ids`` steht."""
    lead, member, rowless = [await flow.add_user(name=name) for name in ("Leitung", "Mitglied", "Ohne Zeile")]
    team = await play.add_team(flow, "Lions", lead, [member], joined_at=FOUNDED)
    await flow.db.team_members.update_one({"team_id": team["id"], "user_id": member["id"]}, {"$set": {"joined_at": LATER}})
    await flow.db.teams.update_one({"id": team["id"]}, {"$addToSet": {"member_ids": rowless["id"]}})
    return team, lead, member, rowless


async def set_role(flow, team: dict, person: dict, role: str = "co_leader") -> None:
    response = await flow.post(f"/api/teams/{team['id']}/members/{person['id']}/role", json={"role": role})
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_rolle_setzen_legt_die_zeile_mit_dem_gruendungsdatum_an(flow):
    team, lead, member, rowless = await team_with_rowless_member(flow)
    flow.act_as(lead)
    for person in (rowless, member):
        await set_role(flow, team, person)
    created = await row(flow, team, rowless)
    assert (created["role"], created["joined_at"]) == ("co_leader", FOUNDED), "kein Beitritt im Protokoll: seit der Gründung"
    kept = await row(flow, team, member)
    assert (kept["role"], kept["joined_at"]) == ("co_leader", LATER), "eine vorhandene Zeile behält ihr Beitrittsdatum"


def join(team_id: str, user: dict, when: str, via: str = "invite") -> dict:
    """Ein Beitritt im Protokoll, wie ``_team_audit`` ihn schreibt."""
    return {"id": new_id(), "action": "team.join", "target_id": team_id, "actor_id": user["id"], "data": {"via": via}, "created_at": when}


@pytest.mark.asyncio
async def test_der_letzte_beitritt_aus_dem_protokoll_geht_vor_dem_gruendungsdatum(flow):
    """Das genaueste Datum gewinnt: Bei einem Wiedereintritt zählt der letzte Beitritt, nicht der erste - und nie einer
    zu einem anderen Team, eines anderen Mitglieds oder aus der Zukunft."""
    team, lead, member, rowless = await team_with_rowless_member(flow)
    await flow.db.audit_logs.insert_many([
        join(team["id"], rowless, "2026-02-01T10:00:00+00:00"),
        join(team["id"], rowless, "2026-05-01T10:00:00+00:00", via="join_code"),
        join(team["id"], rowless, "2999-01-01T00:00:00+00:00"),
        join("anderes-team", rowless, "2026-06-01T10:00:00+00:00"),
        join(team["id"], member, "2026-07-01T10:00:00+00:00"),
    ])
    flow.act_as(lead)
    await set_role(flow, team, rowless)
    assert (await row(flow, team, rowless))["joined_at"] == "2026-05-01T10:00:00+00:00"


@pytest.mark.asyncio
async def test_ohne_beitritt_im_protokoll_und_ohne_gruendungsdatum_gilt_jetzt(flow):
    team, lead, _member, rowless = await team_with_rowless_member(flow)
    known = await flow.add_user(name="Mit Protokoll")
    await flow.db.teams.update_one({"id": team["id"]}, {"$unset": {"created_at": ""}, "$addToSet": {"member_ids": known["id"]}})
    await flow.db.audit_logs.insert_one(join(team["id"], known, "2026-02-01T10:00:00+00:00"))
    before = now_utc().isoformat()
    flow.act_as(lead)
    for person in (rowless, known):
        await set_role(flow, team, person)
    assert (await row(flow, team, rowless))["joined_at"] >= before, "gar nichts bekannt: jetzt - aber nie leer"
    assert (await row(flow, team, known))["joined_at"] == "2026-02-01T10:00:00+00:00", "das Protokoll reicht auch ohne Gründungsdatum"


@pytest.mark.asyncio
async def test_leitung_uebergeben_legt_fehlende_zeilen_mit_dem_gruendungsdatum_an(flow):
    team, lead, _member, rowless = await team_with_rowless_member(flow)
    await flow.db.team_members.delete_one({"team_id": team["id"], "user_id": lead["id"]})
    flow.act_as(lead)
    response = await flow.post(f"/api/teams/{team['id']}/transfer-leader", json={"new_leader_id": rowless["id"]})
    assert response.status_code == 200, response.text
    new_leader, old_leader = await row(flow, team, rowless), await row(flow, team, lead)
    assert (new_leader["role"], old_leader["role"]) == ("leader", "co_leader")
    assert (new_leader["joined_at"], old_leader["joined_at"]) == (FOUNDED, FOUNDED)


@pytest.mark.asyncio
async def test_langjaehriges_mitglied_ohne_zeile_behaelt_seine_alten_teamspiele(flow):
    """Das Team gewinnt ein Spiel mit einem Mitglied, das nur in ``member_ids`` steht. Bekommt es danach eine Rolle (die
    Zeile entsteht), zählt das Spiel weiter - mit „jetzt“ als Beitrittsdatum wäre es verloren."""
    staff, tournament, team, registration, (lead, _member, _bench), _rival_regs = await play.team_cup(flow)
    veteran = await flow.add_user(name="Seit Jahren dabei")
    await flow.db.teams.update_one({"id": team["id"]}, {"$addToSet": {"member_ids": veteran["id"]}})
    opening = next(match for match in await play.open_matches(flow, tournament) if registration["id"] in play.sides(match))
    await play.decide(flow, staff, opening, registration["id"])

    async def team_games(person: dict) -> tuple:
        found = await counters.compute(person["id"], {"matches_played", "team_match_wins"})
        return found["matches_played"], found["team_match_wins"]

    assert await team_games(veteran) == (1, 1)
    flow.act_as(lead)
    await set_role(flow, team, veteran)
    stored = await row(flow, team, veteran)
    assert stored["joined_at"] == team["created_at"]
    assert await team_games(veteran) == (1, 1), "die neue Zeile nimmt ihr das alte Spiel nicht"


@pytest.mark.asyncio
async def test_wer_laut_protokoll_erst_nach_dem_spiel_kam_bekommt_es_nicht(flow):
    """Die Gegenrichtung: Der Beitritt steht im Protokoll und liegt nach dem Spiel. Mit dem Gründungsdatum bekäme die
    Person das alte Spiel geschenkt - das genauere Datum verhindert das."""
    staff, tournament, team, registration, (lead, _member, _bench), _rival_regs = await play.team_cup(flow)
    opening = next(match for match in await play.open_matches(flow, tournament) if registration["id"] in play.sides(match))
    await play.decide(flow, staff, opening, registration["id"])
    # Feste Reihenfolge statt zweimal „jetzt“: das Spiel vor zwei Stunden, der Beitritt vor einer.
    await play.backdate(flow, opening, minutes=120)
    newcomer = await flow.add_user(name="Gerade gekommen")
    await flow.db.teams.update_one({"id": team["id"]}, {"$addToSet": {"member_ids": newcomer["id"]}})
    joined = (now_utc() - timedelta(minutes=60)).isoformat()
    await flow.db.audit_logs.insert_one(join(team["id"], newcomer, joined, via="join_code"))
    flow.act_as(lead)
    await set_role(flow, team, newcomer)

    assert (await row(flow, team, newcomer))["joined_at"] == joined
    found = await counters.compute(newcomer["id"], {"matches_played", "team_match_wins"})
    assert (found["matches_played"], found["team_match_wins"]) == (0, 0), "das Spiel war vor ihrer Zeit"
