"""Platz-Erfolge (#2337): Champion, Podest, Finalist, Top 8, Lower-Bracket-Lauf, Ungeschlagen.

Belege aus dem Audit vom 10.11.2026:
- K1: Die Zähler lasen ``tournament_awards.place``, geschrieben wird ``rank`` - Finalist, Top 8, Lower-Bracket-Lauf,
  Ungeschlagen und Grand Slam standen immer auf 0. Die Tests legten erfundene ``place``-Daten an und merkten es nicht.
- K2: „Finalist = Platz 1 oder 2“ zählte im Mehrspieler-Finale nur zwei aus dem Finallauf und in Tabellen ohne Finale
  trotzdem jemanden.
- K3: Champion und Podest gab es schon während des Turniers.

Darum spielt hier alles über die echten Wege (``achievement_play``); die Plätze hält ``record_tournament_awards`` fest.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import achievement_play as play  # noqa: E402
from flow_harness import make_flow  # noqa: E402
import badges  # noqa: E402
from services import achievement_counters as counters  # noqa: E402
from services import achievement_progress  # noqa: E402

KEYS = {"tournaments_won", "podium_finishes", "rank_4_count", "finals_played", "top8_finishes", "lower_bracket_top4",
        "tournaments_won_undefeated", "distinct_game_wins_one_season"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


async def values(user: dict) -> dict:
    found = await counters.compute(user["id"], set(KEYS))
    return {key: found[key] for key in KEYS}


async def players(flow, count: int) -> list[dict]:
    return [await flow.add_user(name=f"Spieler {n}") for n in range(1, count + 1)]


# ---------------------------------------------------------------- K1: der gespeicherte Rang

@pytest.mark.asyncio
async def test_plaetze_kommen_aus_der_gespeicherten_auszeichnung(flow):
    field = await players(flow, 4)
    tournament, regs = await play.played_cup(flow, field)
    stored = {doc["registration_id"]: doc async for doc in flow.db.tournament_awards.find({"tournament_id": tournament["id"]}, {"_id": 0})}
    assert sorted(doc["rank"] for doc in stored.values()) == [1, 2, 3, 4]
    assert all("place" not in doc for doc in stored.values()), "geschrieben wird ``rank`` - ``place`` gibt es nicht"

    winner, runner_up = await values(field[0]), await values(field[1])
    assert winner == {"tournaments_won": 1, "podium_finishes": 1, "rank_4_count": 0, "finals_played": 1, "top8_finishes": 0,
                      "lower_bracket_top4": 0, "tournaments_won_undefeated": 1, "distinct_game_wins_one_season": 0}
    assert (runner_up["tournaments_won"], runner_up["podium_finishes"], runner_up["finals_played"], runner_up["tournaments_won_undefeated"]) == (0, 1, 1, 0)
    others = [await values(person) for person in field[2:]]
    assert [entry["finals_played"] for entry in others] == [0, 0], "im Halbfinale ausgeschieden"
    assert sorted(entry["podium_finishes"] for entry in others) == [0, 1] and sorted(entry["rank_4_count"] for entry in others) == [0, 1]
    # Der alte Block allein liefert dieselben Zahlen - eine Definition, nicht zwei.
    legacy = await achievement_progress.compute_user_progress(field[0]["id"])
    assert (legacy["tournaments_won"], legacy["podium_finishes"], legacy["rank_4_count"]) == (1, 1, 0)


@pytest.mark.asyncio
async def test_grand_slam_drei_spiele_in_einer_saison(flow):
    me, rival = await players(flow, 2)
    for game in ("mk8", "fifa", "tekken"):
        await play.played_cup(flow, [me, rival], game_id=game, season_id="saison-1")
    await play.played_cup(flow, [me, rival], game_id="mk8", season_id="saison-2")
    assert (await values(me))["distinct_game_wins_one_season"] == 3
    assert (await values(rival))["distinct_game_wins_one_season"] == 0


# ---------------------------------------------------------------- K3: erst nach dem Abschluss

@pytest.mark.asyncio
async def test_champion_und_podest_erst_wenn_das_turnier_abgeschlossen_ist(flow):
    field = await players(flow, 4)
    staff, tournament, regs = await play.cup_for(flow, field)
    for match in await play.open_matches(flow, tournament):
        await play.decide(flow, staff, match, min(play.sides(match), key=[reg["id"] for reg in regs].index))
    final = (await play.open_matches(flow, tournament))[0]
    assert sorted(play.sides(final)) == sorted([regs[0]["id"], regs[1]["id"]]), "die Halbfinals sind gespielt, das Finale ist offen"

    during = [await values(person) for person in field]
    assert all(entry == dict.fromkeys(KEYS, 0) for entry in during), "während des Turniers gibt es keinen Platz-Erfolg"
    legacy = [await achievement_progress.compute_user_progress(person["id"]) for person in field]
    assert [(entry["tournaments_won"], entry["podium_finishes"], entry["rank_4_count"]) for entry in legacy] == [(0, 0, 0)] * 4

    await play.decide(flow, staff, final, regs[0]["id"])
    assert (await values(field[0]))["tournaments_won"] == 0, "das Finale ist gespielt, das Turnier läuft noch"

    # Beendet, aber noch nicht veröffentlicht: Es gilt der Platz, den die Auszeichnung festhalten wird.
    await play.finish(flow, staff, tournament, publish=False)
    assert await flow.db.tournament_awards.count_documents({"tournament_id": tournament["id"]}) == 0
    done = await values(field[0])
    assert (done["tournaments_won"], done["podium_finishes"], done["finals_played"]) == (1, 1, 1)
    await play.finish(flow, staff, tournament)
    assert await flow.db.tournament_awards.count_documents({"tournament_id": tournament["id"]}) == 4
    assert await values(field[0]) == done, "nach dem Veröffentlichen dieselben Zahlen aus dem gespeicherten Rang"


@pytest.mark.asyncio
async def test_abgesagtes_turnier_bringt_keinen_platz(flow):
    field = await players(flow, 4)
    staff, tournament, regs = await play.cup_for(flow, field)
    await play.play_out(flow, staff, tournament, [reg["id"] for reg in regs])
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "cancelled"}})
    assert await values(field[0]) == dict.fromkeys(KEYS, 0)


@pytest.mark.asyncio
async def test_liga_staffel_bringt_keinen_turnier_platz(flow):
    captain, rival = await players(flow, 2)
    staffel, _home, _away = await play.league_match(flow, home_lineup=[captain], home_bench=[], away=rival, status="results_published")
    assert (await counters.compute(captain["id"], {"matches_won"}))["matches_won"] == 1, "das Spiel selbst zählt"
    assert await values(captain) == dict.fromkeys(KEYS, 0), "eine Staffel ist kein Turnier für Champion, Podest und Finalist"


# ---------------------------------------------------------------- Top 8

@pytest.mark.asyncio
async def test_top_acht_erst_ab_mehr_als_acht_teilnehmern(flow):
    big = await players(flow, 9)
    await play.played_cup(flow, big)
    assert sum([(await values(person))["top8_finishes"] for person in big]) == 8, "neun Teilnehmer, die besten acht"
    small = await players(flow, 8)
    await play.played_cup(flow, small)
    assert sum([(await values(person))["top8_finishes"] for person in small]) == 0, "bei acht Teilnehmern wäre jeder dabei"


# ---------------------------------------------------------------- K2: Finalist

@pytest.mark.asyncio
async def test_mehrspieler_der_ganze_finallauf_ist_finalist(flow):
    """Acht Spieler, zwei Vorläufe, ein Finallauf zu viert: alle vier standen im Finale - nicht nur Platz 1 und 2."""
    field = await players(flow, 8)
    staff, tournament, regs = await play.cup_for(flow, field, format="ffa_custom_bracket")
    heats = await play.open_matches(flow, tournament)
    assert [len(play.sides(heat)) for heat in heats] == [4, 4]
    for heat in heats:
        await play.rank(flow, staff, heat, play.sides(heat))
    [final] = await play.open_matches(flow, tournament)
    finalists = play.sides(final)
    assert len(finalists) == 4
    await play.rank(flow, staff, final, finalists)
    await play.finish(flow, staff, tournament)

    user_of = {reg["id"]: user for reg, user in zip(regs, field)}
    assert [(await values(user_of[reg_id]))["finals_played"] for reg_id in finalists] == [1, 1, 1, 1]
    out = [reg["id"] for reg in regs if reg["id"] not in finalists]
    assert [(await values(user_of[reg_id]))["finals_played"] for reg_id in out] == [0, 0, 0, 0]
    assert (await values(user_of[finalists[0]]))["tournaments_won"] == 1


@pytest.mark.asyncio
async def test_jeder_gegen_jeden_hat_kein_finale(flow):
    field = await players(flow, 3)
    tournament, regs = await play.played_cup(flow, field, format="round_robin")
    ranks = sorted([doc["rank"] async for doc in flow.db.tournament_awards.find({"tournament_id": tournament["id"]}, {"_id": 0, "rank": 1})])
    assert ranks == [1, 2, 3], "Plätze gibt es - ein Finale nicht"
    found = [await values(person) for person in field]
    assert [entry["finals_played"] for entry in found] == [0, 0, 0]
    assert [entry["tournaments_won"] for entry in found] == [1, 0, 0] and [entry["podium_finishes"] for entry in found] == [1, 1, 1]


@pytest.mark.asyncio
async def test_doppel_ko_grand_final_und_lower_bracket_lauf(flow):
    field = await players(flow, 4)
    tournament, regs = await play.played_cup(flow, field, format="double_elim")
    matches = await flow.matches(tournament)
    grand_final = next(match for match in matches if str(match.get("section") or "").upper() == "GF" and "reset" not in str(match.get("round_name") or "").lower())
    user_of = {reg["id"]: user for reg, user in zip(regs, field)}
    in_final = play.sides(grand_final)
    assert regs[0]["id"] in in_final and len(in_final) == 2
    for reg in regs:
        found = await values(user_of[reg["id"]])
        assert found["finals_played"] == int(reg["id"] in in_final), reg["id"]
    champion = await values(field[0])
    assert (champion["tournaments_won"], champion["tournaments_won_undefeated"], champion["lower_bracket_top4"]) == (1, 1, 0)
    challenger = await values(user_of[next(reg_id for reg_id in in_final if reg_id != regs[0]["id"])])
    assert (challenger["podium_finishes"], challenger["lower_bracket_top4"], challenger["tournaments_won_undefeated"]) == (1, 1, 0)


@pytest.mark.asyncio
async def test_kampfloses_finale_zaehlt_nicht_als_im_finale_gestanden(flow):
    field = await players(flow, 4)
    staff, tournament, regs = await play.cup_for(flow, field)
    for match in await play.open_matches(flow, tournament):
        await play.decide(flow, staff, match, min(play.sides(match), key=[reg["id"] for reg in regs].index))
    [final] = await play.open_matches(flow, tournament)
    await play.walkover(flow, staff, final, regs[1]["id"])
    await play.finish(flow, staff, tournament)

    winner, absent = await values(field[0]), await values(field[1])
    assert (winner["tournaments_won"], winner["finals_played"]) == (1, 0), "Champion ja - im Finale gespielt hat niemand"
    assert (absent["podium_finishes"], absent["finals_played"]) == (1, 0)


# ---------------------------------------------------------------- Ungeschlagen

@pytest.mark.asyncio
async def test_ungeschlagen_trotz_freilos(flow):
    """Drei Teilnehmer: die Nummer 1 hat ein Freilos und gewinnt das Finale. Früher galt das Freilos als „nicht gewonnen“."""
    field = await players(flow, 3)
    tournament, _regs = await play.played_cup(flow, field)
    byes = [match for match in await flow.matches(tournament) if len(play.sides(match)) == 1 and match.get("status") == "completed"]
    assert len(byes) == 1
    champion = await values(field[0])
    assert (champion["tournaments_won"], champion["tournaments_won_undefeated"], champion["finals_played"]) == (1, 1, 1)


# ---------------------------------------------------------------- Team (K4)

@pytest.mark.asyncio
async def test_turniersieg_im_team_zaehlt_fuer_alle_die_gespielt_haben(flow):
    staff, tournament, _team, registration, (lead, member, bench), rival_regs = await play.team_cup(flow)
    await play.play_out(flow, staff, tournament, [registration["id"], *[reg["id"] for reg in rival_regs]])
    await play.finish(flow, staff, tournament)
    for person in (lead, member, bench):
        found = await values(person)
        assert (found["tournaments_won"], found["podium_finishes"], found["finals_played"], found["tournaments_won_undefeated"]) == (1, 1, 1, 1), person["username"]


@pytest.mark.asyncio
async def test_turniersieg_im_team_mit_aufstellung_nur_fuer_die_aufgestellten(flow):
    staff, tournament, _team, registration, (lead, member, bench), rival_regs = await play.team_cup(flow)
    await flow.db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {"lineup": [member["id"]]}})
    await play.play_out(flow, staff, tournament, [registration["id"], *[reg["id"] for reg in rival_regs]])
    await play.finish(flow, staff, tournament)
    assert (await values(member))["tournaments_won"] == 1
    for person in (lead, bench):
        assert await values(person) == dict.fromkeys(KEYS, 0), person["username"]
