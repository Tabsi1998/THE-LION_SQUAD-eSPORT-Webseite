"""Spiel-Erfolge zählen für die, die gespielt haben (#2337): Freilos, kampflos, Team und Liga.

Belege aus dem Audit vom 10.11.2026, hier über die echten Wege (``achievement_play``): Ein Freilos zählte als Spiel und
riss die Siegesserie, ein kampfloser Sieg zählte nirgends, und im Team zählte alles nur für die Person, die angemeldet hat.
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
    # Feste Reihenfolge statt dreimal „jetzt“: das erste Spiel vor zwei Stunden, der Wechsel vor einer, das Finale jetzt.
    await play.backdate(flow, opening, minutes=120)
    changed = (now_utc() - timedelta(minutes=60)).isoformat()

    flow.act_as(member)
    left = await flow.post(f"/api/teams/{team['id']}/leave")
    assert left.status_code == 200, left.text
    assert await flow.db.team_members.count_documents({"team_id": team["id"], "user_id": member["id"]}) == 0
    stamped = await flow.db.audit_logs.update_one({"action": "team.leave", "target_id": team["id"], "actor_id": member["id"]},
                                                  {"$set": {"created_at": changed}})
    assert stamped.modified_count == 1, "der Austritt steht im Protokoll"
    late = await flow.add_user(name="Neuzugang")
    await flow.db.teams.update_one({"id": team["id"]}, {"$addToSet": {"member_ids": late["id"]}})
    await flow.db.team_members.insert_one({"team_id": team["id"], "user_id": late["id"], "role": "member", "joined_at": changed})

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


@pytest.mark.asyncio
async def test_co_team_kaderwechsel_aus_dem_protokoll(flow):
    """Review M4: Ein Spiel ohne Teilnehmerliste (etwa kampflos gewertet) zählt für den Kader von damals - laut Liga-Kader
    der Season (beim Zuteilen geschrieben). Danach wechselt „Wechsler“ per Transfer das Co-Team, „Neuzugang“ kommt in den
    Kader: Beides steht im Protokoll, so wie die Routen es schreiben (``league.transfer.approve``,
    ``league.squad.roster``), der Neuzugang dazu im Liga-Kader."""
    captain, stayer, mover, newcomer, sibling, rival = [
        await flow.add_user(name=name) for name in ("Captain", "Stamm", "Wechsler", "Neuzugang", "Zweites Co-Team", "Gegnerin")]
    team, squad, _home_reg, match = await play.squad_match(flow, leader=captain, squad_members=[captain, stayer, mover],
                                                          others=[newcomer, sibling], away=rival)
    staffel = await flow.db.tournaments.find_one({"id": match["tournament_id"]}, {"_id": 0})
    later = (now_utc() + timedelta(minutes=5)).isoformat()
    await play.record_squad_members(flow, staffel, squad["id"], [newcomer], via="member", at=later)
    await flow.db.team_squads.update_one({"id": squad["id"]}, {"$set": {"member_ids": [captain["id"], stayer["id"], newcomer["id"]], "updated_at": later}})
    await flow.db.audit_logs.insert_many([
        {"id": new_id(), "action": "league.transfer.approve", "target_id": "s1", "actor_id": "liga-leitung",
         "data": {"transfer_id": new_id(), "user_id": mover["id"], "from_squad_id": squad["id"], "to_squad_id": "anderes-co-team"}, "created_at": later},
        {"id": new_id(), "action": "league.squad.roster", "target_id": team["id"], "actor_id": captain["id"],
         "data": {"squad_id": squad["id"], "added": [newcomer["id"]], "removed": []}, "created_at": later},
    ])

    for person in (captain, stayer, mover):
        mine = await values(person)
        assert (mine["matches_played"], mine["matches_won"], mine["team_match_wins"]) == (1, 1, 1), person["username"]
    for person in (newcomer, sibling):
        mine = await values(person)
        assert (mine["matches_played"], mine["matches_won"], mine["team_match_wins"]) == (0, 0, 0), person["username"]


async def _delete_squad(flow, squad: dict, _bert: dict) -> None:
    await flow.db.team_squads.delete_one({"id": squad["id"]})


async def _add_after_season(flow, squad: dict, bert: dict) -> None:
    # Die Staffel ist beendet: Die Aufnahme steht dann weder im Protokoll noch im Liga-Kader der Season.
    await flow.db.team_squads.update_one({"id": squad["id"]}, {"$addToSet": {"member_ids": bert["id"]}})


async def _empty_squad(flow, squad: dict, _bert: dict) -> None:
    await flow.db.team_squads.update_one({"id": squad["id"]}, {"$set": {"member_ids": []}})


@pytest.mark.asyncio
@pytest.mark.parametrize("afterwards", [_delete_squad, _add_after_season, _empty_squad],
                         ids=["co-team-geloescht", "nach-der-season-aufgenommen", "kader-heute-leer"])
async def test_wer_nie_im_kader_des_co_teams_stand_bekommt_dessen_spiele_nicht(flow, afterwards):
    """Nachprüfung zu #2337: Co-Team A gewinnt ein Spiel ohne Teilnehmerliste. Bert ist seit Langem im Hauptteam, spielte
    die Season aber im Co-Team B - laut Liga-Kader. Was danach mit dem Kader von A geschieht, ändert nichts: Der heutige
    Kader ist kein Nachweis, das Hauptteam auch nicht. Anna stand im Kader von A und behält ihr Spiel."""
    captain, anna, bert, rival = [await flow.add_user(name=name) for name in ("Captain", "Anna", "Bert", "Gegnerin")]
    _team, squad, _home_reg, match = await play.squad_match(flow, leader=captain, squad_members=[captain, anna], others=[bert],
                                                           away=rival, status="completed")
    staffel = await flow.db.tournaments.find_one({"id": match["tournament_id"]}, {"_id": 0})
    await play.record_squad_members(flow, staffel, "co-team-b", [bert])
    entry = await flow.db.league_rosters.find_one({"user_id": bert["id"]}, {"_id": 0})
    assert entry["squad_ids"] == ["co-team-b"] and entry["season_id"] == staffel["league_context"]["season_id"]

    await afterwards(flow, squad, bert)

    mine = await values(bert)
    assert (mine["matches_played"], mine["matches_won"], mine["team_match_wins"]) == (0, 0, 0), "nie im Kader von A"
    kept = await values(anna)
    assert (kept["matches_played"], kept["matches_won"], kept["team_match_wins"]) == (1, 1, 1), "Anna stand im Kader"


@pytest.mark.asyncio
async def test_co_team_ohne_jeden_nachweis_zaehlt_fuer_niemanden(flow):
    """Kein Liga-Kader, kein Protokoll, keine Teilnehmerliste: Dann weiß niemand, wer gespielt hat. Das Spiel zählt für
    niemanden - lieber keiner als alle Mitglieder des Hauptteams."""
    captain, anna, rival = [await flow.add_user(name=name) for name in ("Captain", "Anna", "Gegnerin")]
    await play.squad_match(flow, leader=captain, squad_members=[captain, anna], others=[], away=rival)
    await flow.db.league_rosters.delete_many({})
    for person in (captain, anna):
        mine = await values(person)
        assert (mine["matches_played"], mine["team_match_wins"]) == (0, 0), person["username"]
    assert (await values(rival))["matches_played"] == 1, "die Gegnerin (Team ohne Co-Team) hat ihr Spiel"


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
