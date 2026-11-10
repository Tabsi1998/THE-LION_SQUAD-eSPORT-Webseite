"""Teilnahme statt Anmeldung (#2337): Turnierveteran, Multitalent, Formatvielfalt, Durchzieher, Teamturniere, Erster im Haus.

Belege aus dem Audit vom 10.11.2026: Es zählte jede Anmeldung - auch abgelehnt, ausgetreten oder im abgesagten Turnier.
Bei „Formatvielfalt“ fehlte die Liga, und „Mehrspieler frei“ zählte doppelt (``ffa`` und ``battle_royale``).
Jetzt zählt: angenommen oder eingecheckt und in mindestens einem echten Spiel angetreten.
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

KEYS = ("tournaments_registered", "distinct_games_registered", "distinct_formats", "tournaments_completed_no_forfeit",
        "team_tournaments_played", "first_checkins")


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


async def count(user: dict, key: str) -> int:
    return (await values(user))[key]


async def players(flow, number: int) -> list[dict]:
    return [await flow.add_user(name=f"Spieler {n}") for n in range(1, number + 1)]


# ---------------------------------------------------------------- Turnierveteran und Multitalent

@pytest.mark.asyncio
async def test_anmelden_allein_ist_keine_teilnahme(flow):
    me, rival = await players(flow, 2)
    staff, tournament, regs = await play.cup_for(flow, [me, rival], game_id="mk8")
    assert (await values(me))["tournaments_registered"] == 0, "ausgelost, aber noch nicht gespielt"
    [match] = await play.open_matches(flow, tournament)
    await play.decide(flow, staff, match, regs[1]["id"])
    for person in (me, rival):
        found = await values(person)
        assert (found["tournaments_registered"], found["distinct_games_registered"], found["distinct_formats"]) == (1, 1, 1), "auch wer verliert, hat teilgenommen"


@pytest.mark.asyncio
async def test_abgelehnt_und_abgesagt_zaehlen_nicht_ausgetreten_nach_dem_spiel_schon(flow):
    """Review M5: Wer gespielt hat, hat teilgenommen - auch wenn er danach austritt oder disqualifiziert wird."""
    me, rival = await players(flow, 2)
    _first, first_regs = await play.played_cup(flow, [me, rival], game_id="mk8")
    _second, second_regs = await play.played_cup(flow, [me, rival], game_id="fifa", format="double_elim")
    third, third_regs = await play.played_cup(flow, [me, rival], game_id="tekken")
    fourth, _fourth_regs = await play.played_cup(flow, [me, rival], game_id="rocket")

    async def triple(user: dict) -> tuple:
        found = await values(user)
        return found["tournaments_registered"], found["distinct_games_registered"], found["distinct_formats"]

    assert await triple(me) == (4, 4, 2)

    await flow.db.tournament_registrations.update_one({"id": first_regs[0]["id"]}, {"$set": {"status": "withdrawn"}})
    await flow.db.tournament_registrations.update_one({"id": second_regs[0]["id"]}, {"$set": {"status": "disqualified"}})
    assert await triple(me) == (4, 4, 2), "ausgetreten oder disqualifiziert nach dem Spiel: teilgenommen"
    assert (await values(me))["tournaments_completed_no_forfeit"] == 2, "durchgezogen hat sie nur die anderen beiden"

    await flow.db.tournament_registrations.update_one({"id": third_regs[0]["id"]}, {"$set": {"status": "rejected"}})
    assert await triple(me) == (3, 3, 2), "abgelehnt ist keine Teilnahme"
    await flow.db.tournaments.update_one({"id": fourth["id"]}, {"$set": {"status": "cancelled"}})
    assert await triple(me) == (2, 2, 2), "abgesagt"
    assert (await values(rival))["tournaments_registered"] == 3, "für die andere zählen die drei Turniere, die stattfanden"


@pytest.mark.asyncio
async def test_kampflos_verloren_ist_keine_teilnahme(flow):
    """Die Nummer 1 fehlt im Halbfinale und verliert kampflos - ihr einziges Spiel hat sie nicht gespielt."""
    field = await players(flow, 4)
    staff, tournament, regs = await play.cup_for(flow, field)
    opening = next(match for match in await play.open_matches(flow, tournament) if regs[0]["id"] in play.sides(match))
    await play.walkover(flow, staff, opening, regs[0]["id"])
    await play.play_out(flow, staff, tournament, [reg["id"] for reg in regs[1:]])
    await play.finish(flow, staff, tournament)
    assert (await values(field[0]))["tournaments_registered"] == 0, "nicht erschienen - in keinem echten Spiel dabei"
    assert [(await values(person))["tournaments_registered"] for person in field[1:]] == [1, 1, 1]


# ---------------------------------------------------------------- Formatvielfalt (H7)

@pytest.mark.asyncio
async def test_formatvielfalt_liga_zaehlt_einmal_und_mehrspieler_frei_nicht_doppelt(flow):
    me, rival, third = await players(flow, 3)
    await play.played_cup(flow, [me, rival], format="single_elim")
    assert await count(me, "distinct_formats") == 1

    # Mehrspieler frei und „Überlebensmodus“ sind dasselbe Format.
    for fmt in ("ffa", "battle_royale"):
        staff, heats, regs = await play.cup_for(flow, [me, rival, third], format=fmt)
        [heat] = await play.open_matches(flow, heats)
        await play.rank(flow, staff, heat, play.sides(heat))
        await play.finish(flow, staff, heats)
    assert await count(me, "distinct_formats") == 2

    # Die Liga: eine Staffel der Vereinsliga und das Turnierformat „Hin- und Rückrunde“ sind zusammen ein Format.
    await play.league_match(flow, home_lineup=[me], home_bench=[], away=rival)
    assert await count(me, "distinct_formats") == 3, "die Staffel zählt als Liga - früher fehlte sie"
    await play.played_cup(flow, [me, rival], format="league")
    assert await count(me, "distinct_formats") == 3
    assert await count(me, "tournaments_registered") == 4, "Turniere: K.-o., zweimal Mehrspieler, Hin- und Rückrunde - die Staffel ist kein Turnier"

    # Angemeldet, aber abgelehnt oder ohne Spiel: kein neues Format.
    for fmt, status in (("swiss", "rejected"), ("groups", "approved"), ("double_elim", "withdrawn")):
        tournament = await flow.create_tournament(format=fmt, status="results_published")
        await flow.register(tournament, me, status=status)
    assert await count(me, "distinct_formats") == 3


# ---------------------------------------------------------------- Durchzieher (M1)

@pytest.mark.asyncio
async def test_durchzieher_abgeschlossen_gespielt_ohne_kampflose_niederlage(flow):
    field = await players(flow, 4)
    staff, tournament, regs = await play.cup_for(flow, field)
    for match in await play.open_matches(flow, tournament):
        await play.decide(flow, staff, match, min(play.sides(match), key=[reg["id"] for reg in regs].index))
    [final] = await play.open_matches(flow, tournament)
    await play.walkover(flow, staff, final, regs[1]["id"])
    assert [await count(person, "tournaments_completed_no_forfeit") for person in field] == [0, 0, 0, 0], "das Turnier läuft noch"

    await play.finish(flow, staff, tournament)
    assert [await count(person, "tournaments_completed_no_forfeit") for person in field] == [1, 0, 1, 1], "wer im Finale fehlte, hat nicht durchgezogen"


@pytest.mark.asyncio
async def test_durchzieher_nicht_fuer_ausgetretene_disqualifizierte_oder_bloss_angemeldete(flow):
    field = await players(flow, 4)
    spectator = await flow.add_user(name="Nur angemeldet")
    tournament, regs = await play.played_cup(flow, field)
    await flow.register(tournament, spectator, status="rejected")
    await flow.db.tournament_registrations.update_one({"id": regs[2]["id"]}, {"$set": {"status": "withdrawn"}})
    await flow.db.tournament_registrations.update_one({"id": regs[3]["id"]}, {"$set": {"status": "disqualified"}})
    assert [await count(person, "tournaments_completed_no_forfeit") for person in (*field, spectator)] == [1, 1, 0, 0, 0]


# ---------------------------------------------------------------- Teamturniere

@pytest.mark.asyncio
async def test_teamturnier_zaehlt_fuer_die_die_fuer_das_team_gespielt_haben(flow):
    staff, tournament, _team, registration, (lead, member, bench), rival_regs = await play.team_cup(flow)
    await flow.db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {"lineup": [lead["id"], member["id"]]}})
    assert [await count(person, "team_tournaments_played") for person in (lead, member, bench)] == [0, 0, 0], "angemeldet, noch kein Spiel"
    await play.play_out(flow, staff, tournament, [registration["id"], *[reg["id"] for reg in rival_regs]])
    assert [await count(person, "team_tournaments_played") for person in (lead, member, bench)] == [1, 1, 0]
    rival = await flow.db.tournament_registrations.find_one({"id": rival_regs[0]["id"]}, {"_id": 0})
    assert await count({"id": rival["user_id"]}, "team_tournaments_played") == 0, "einzeln angetreten ist kein Teamturnier"
    # Review M5: Tritt das Team nach seinen Spielen aus, bleibt es ein gespieltes Teamturnier.
    await flow.db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {"status": "withdrawn"}})
    assert [await count(person, "team_tournaments_played") for person in (lead, member, bench)] == [1, 1, 0]


# ---------------------------------------------------------------- Erster im Haus

@pytest.mark.asyncio
async def test_erster_im_haus_nur_wenn_das_turnier_gespielt_wurde(flow):
    me, rival = await players(flow, 2)
    staff, tournament, regs = await play.cup_for(flow, [me, rival])
    await flow.db.tournament_registrations.update_one({"id": regs[0]["id"]}, {"$set": {"status": "checked_in", "updated_at": "2026-09-01T17:30:00+00:00"}})
    await flow.db.tournament_registrations.update_one({"id": regs[1]["id"]}, {"$set": {"status": "checked_in", "updated_at": "2026-09-01T17:45:00+00:00"}})
    assert await count(me, "first_checkins") == 0, "eingecheckt, aber noch kein Spiel"
    [match] = await play.open_matches(flow, tournament)
    await play.decide(flow, staff, match, regs[1]["id"])
    assert (await count(me, "first_checkins"), await count(rival, "first_checkins")) == (1, 0)
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "cancelled"}})
    assert await count(me, "first_checkins") == 0, "abgesagt"
