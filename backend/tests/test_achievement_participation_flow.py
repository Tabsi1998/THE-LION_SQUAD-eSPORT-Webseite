"""Spiel-Erfolge zählen für die, die gespielt haben (#2337): Freilos, kampflos, Team und Liga.

Belege aus dem Audit vom 10.11.2026, hier über die echten Wege (``achievement_play``): Ein Freilos zählte als Spiel und
riss die Siegesserie, ein kampfloser Sieg zählte nirgends, und im Team zählte alles nur für die Person, die angemeldet hat.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import achievement_play as play  # noqa: E402
from flow_harness import make_flow  # noqa: E402
import badges  # noqa: E402
from models import now_utc  # noqa: E402
from services import achievement_counters as counters  # noqa: E402
from services import achievement_progress  # noqa: E402

MATCH_KEYS = {"matches_played", "matches_won", "match_streak_max", "dispute_free_streak", "streamed_matches", "team_match_wins"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


async def values(user: dict, keys=MATCH_KEYS) -> dict:
    return await counters.compute(user["id"], set(keys))


# ---------------------------------------------------------------- Freilos (H1)

@pytest.mark.asyncio
async def test_freilos_ist_kein_spiel_und_reisst_die_siegesserie_nicht(flow):
    """Zwei Siege im ersten Turnier, im zweiten ein Freilos und ein Sieg im Finale: drei Spiele, drei Siege in Folge."""
    staff, first, users, regs = await play.cup(flow, 4, stream_url="https://twitch.tv/lions")
    await play.play_out(flow, staff, first, [reg["id"] for reg in regs])
    me = users[0]

    second = await flow.create_tournament(max_participants=3, stream_url="https://twitch.tv/lions")
    others = [await flow.add_user(name=f"Gast {n}") for n in (1, 2)]
    entries = [await flow.register(second, user, seed=seed) for seed, user in enumerate([me, *others], start=1)]
    flow.act_as(staff)
    await play.draw(flow, second)
    byes = [match for match in await flow.matches(second) if len(play.sides(match)) == 1 and match.get("status") == "completed"]
    assert [play.sides(match) for match in byes] == [[entries[0]["id"]]], "die Nummer 1 hat ein Freilos - als abgeschlossenes Spiel gespeichert"
    await play.play_out(flow, staff, second, [entry["id"] for entry in entries])

    mine = await values(me)
    assert (mine["matches_played"], mine["matches_won"], mine["match_streak_max"]) == (3, 3, 3)
    assert mine["dispute_free_streak"] == 3, "Ohne Streit zählt das Freilos nicht mit"
    assert mine["streamed_matches"] == 3, "Im Rampenlicht steht nur, wer wirklich spielt"
    # Der alte Block allein liefert dieselben Zahlen - eine Definition, nicht zwei.
    legacy = await achievement_progress.compute_user_progress(me["id"])
    assert (legacy["matches_played"], legacy["matches_won"], legacy["match_streak_max"]) == (3, 3, 3)


# ---------------------------------------------------------------- Kampflos (H2)

@pytest.mark.asyncio
async def test_kampfloser_sieg_zaehlt_als_spiel_und_sieg_nur_fuer_den_sieger(flow):
    staff, tournament, users, regs = await play.cup(flow, 4)
    opening = (await play.open_matches(flow, tournament))[0]
    present, absent = play.sides(opening)
    stored = await play.walkover(flow, staff, opening, absent)
    assert stored["status"] == "forfeit" and stored["forfeit_registration_id"] == absent
    user_of = {reg["id"]: user for reg, user in zip(regs, users)}

    winner = await values(user_of[present])
    assert (winner["matches_played"], winner["matches_won"], winner["match_streak_max"]) == (1, 1, 1)
    missing = await values(user_of[absent])
    assert (missing["matches_played"], missing["matches_won"], missing["match_streak_max"]) == (0, 0, 0), "wer nicht erschienen ist, bekommt nichts"


# ---------------------------------------------------------------- Team (K4)

@pytest.mark.asyncio
async def test_im_team_zaehlt_jedes_mitglied_nicht_nur_wer_angemeldet_hat(flow):
    staff, tournament, _team, registration, (lead, member, bench), rival_regs = await play.team_cup(flow)
    await play.play_out(flow, staff, tournament, [registration["id"], *[reg["id"] for reg in rival_regs]])

    for person in (lead, member, bench):
        mine = await values(person)
        assert (mine["matches_played"], mine["matches_won"], mine["team_match_wins"]) == (2, 2, 2), person["username"]


@pytest.mark.asyncio
async def test_mit_aufstellung_zaehlen_nur_die_aufgestellten(flow):
    """Team am Spieltag: Die Leitung hat angemeldet, steht aber nicht in der Aufstellung - sie hat nicht gespielt."""
    staff, tournament, _team, registration, (lead, member, bench), rival_regs = await play.team_cup(flow)
    await flow.db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {"lineup": [member["id"]], "substitutes": [bench["id"]]}})
    await play.play_out(flow, staff, tournament, [registration["id"], *[reg["id"] for reg in rival_regs]])

    assert (await values(member))["matches_won"] == 2
    for person in (lead, bench):
        mine = await values(person)
        assert (mine["matches_played"], mine["matches_won"], mine["team_match_wins"]) == (0, 0, 0), person["username"]


@pytest.mark.asyncio
async def test_nach_dem_teamwechsel_bleibt_was_gespielt_wurde(flow):
    """Das Mitglied verlässt das Team nach dem ersten Spiel (echter Weg, steht im Protokoll); eine Neue kommt erst danach."""
    staff, tournament, team, registration, (lead, member, _bench), rival_regs = await play.team_cup(flow)
    opening = next(match for match in await play.open_matches(flow, tournament) if registration["id"] in play.sides(match))
    await play.decide(flow, staff, opening, registration["id"])

    flow.act_as(member)
    left = await flow.post(f"/api/teams/{team['id']}/leave")
    assert left.status_code == 200, left.text
    assert await flow.db.team_members.count_documents({"team_id": team["id"], "user_id": member["id"]}) == 0
    late = await flow.add_user(name="Neuzugang")
    await flow.db.teams.update_one({"id": team["id"]}, {"$addToSet": {"member_ids": late["id"]}})
    await flow.db.team_members.insert_one({"team_id": team["id"], "user_id": late["id"], "role": "member", "joined_at": now_utc().isoformat()})

    await play.play_out(flow, staff, tournament, [registration["id"], *[reg["id"] for reg in rival_regs]])

    assert (await values(lead))["matches_won"] == 2
    gone = await values(member)
    assert (gone["matches_played"], gone["matches_won"], gone["team_match_wins"]) == (1, 1, 1), "das erste Spiel bleibt, das Finale kommt nicht dazu"
    new = await values(late)
    assert (new["matches_played"], new["matches_won"], new["team_match_wins"]) == (1, 1, 1), "nur das Finale - vorher war sie nicht dabei"


# ---------------------------------------------------------------- Liga (K4)

@pytest.mark.asyncio
async def test_liga_staffel_zaehlt_fuer_die_teilnehmerliste_des_spiels(flow):
    """Eine Staffel meldet Teams ohne Person an. Gezählt wird, wer auf der Teilnehmerliste des Spiels steht."""
    captain, player, absent = [await flow.add_user(name=name) for name in ("Captain", "Stamm", "Fehlt")]
    rival = await flow.add_user(name="Gegnerin")
    await play.league_match(flow, home_lineup=[captain, player], home_bench=[absent], away=rival)

    for person in (captain, player):
        mine = await values(person)
        assert (mine["matches_played"], mine["matches_won"], mine["team_match_wins"]) == (1, 1, 1), person["username"]
    loser = await values(rival)
    assert (loser["matches_played"], loser["matches_won"]) == (1, 0)
    missing = await values(absent)
    assert (missing["matches_played"], missing["matches_won"], missing["team_match_wins"]) == (0, 0, 0), "nicht auf der Liste, nicht gespielt"


# ---------------------------------------------------------------- GG-Lob (K4)

@pytest.mark.asyncio
async def test_gg_lob_fuer_ein_team_bekommen_die_die_gespielt_haben(flow):
    staff, tournament, _team, registration, (lead, member, bench), _rival_regs = await play.team_cup(flow)
    await flow.db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {"lineup": [lead["id"], member["id"]]}})
    opening = next(match for match in await play.open_matches(flow, tournament) if registration["id"] in play.sides(match))
    await play.decide(flow, staff, opening, registration["id"])
    opponent_reg = next(side for side in play.sides(opening) if side != registration["id"])
    opponent = await flow.db.tournament_registrations.find_one({"id": opponent_reg}, {"_id": 0})
    flow.act_as({"id": opponent["user_id"]})
    response = await flow.post(f"/api/matches/{opening['id']}/commend")
    assert response.status_code == 200, response.text

    for person in (lead, member):
        assert (await values(person, {"commendations_received"}))["commendations_received"] == 1, person["username"]
    assert (await values(bench, {"commendations_received"}))["commendations_received"] == 0, "nicht aufgestellt, kein Lob"
