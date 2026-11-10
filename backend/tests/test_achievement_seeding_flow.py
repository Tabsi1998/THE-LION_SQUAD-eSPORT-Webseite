"""Topgesetzt und Riesentöter (#2337) zählen nur bei fester Setzliste.

Belege aus dem Audit vom 10.11.2026: „Topgesetzt“ zählte jede Setznummer 1 - auch ausgelost, im abgesagten Turnier oder
nach dem Austritt. „Riesentöter“ verglich den Platz im Baum (``slot.seed``) statt der Setznummer der Anmeldung.
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


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


async def count(user: dict, key: str) -> int:
    return (await counters.compute(user["id"], {key}))[key]


async def players(flow, number: int) -> list[dict]:
    return [await flow.add_user(name=f"Spieler {n}") for n in range(1, number + 1)]


# ---------------------------------------------------------------- Topgesetzt (H5)

@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["manual", "ranking"])
async def test_topgesetzt_bei_fester_setzliste_im_gespielten_turnier(flow, mode):
    field = await players(flow, 4)
    await play.played_cup(flow, field, seeding_mode=mode)
    assert [await count(person, "seed_one_count") for person in field] == [1, 0, 0, 0]


@pytest.mark.asyncio
async def test_ausgeloste_nummer_eins_ist_nicht_topgesetzt(flow):
    field = await players(flow, 4)
    tournament, _regs = await play.played_cup(flow, field, seeding_mode="random")
    drawn = await flow.db.tournament_registrations.find_one({"tournament_id": tournament["id"], "seed": 1}, {"_id": 0})
    assert drawn, "auch beim Auslosen trägt eine Anmeldung die Nummer 1"
    assert [await count(person, "seed_one_count") for person in field] == [0, 0, 0, 0]


@pytest.mark.asyncio
async def test_topgesetzt_erst_nach_dem_abschluss_und_nie_im_abgesagten_turnier(flow):
    field = await players(flow, 4)
    staff, tournament, regs = await play.cup_for(flow, field)
    await play.play_out(flow, staff, tournament, [reg["id"] for reg in regs])
    assert await count(field[0], "seed_one_count") == 0, "das Turnier läuft noch"
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "cancelled"}})
    assert await count(field[0], "seed_one_count") == 0, "abgesagt"
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "completed"}})
    assert await count(field[0], "seed_one_count") == 1


@pytest.mark.asyncio
async def test_ausgetreten_oder_nicht_gespielt_ist_nicht_topgesetzt(flow):
    # Ausgetreten: die Nummer 1 hat gespielt, ist dann aber nicht mehr angenommen.
    field = await players(flow, 4)
    tournament, regs = await play.played_cup(flow, field)
    assert await count(field[0], "seed_one_count") == 1
    await flow.db.tournament_registrations.update_one({"id": regs[0]["id"]}, {"$set": {"status": "withdrawn"}})
    assert await count(field[0], "seed_one_count") == 0

    # Nicht erschienen: die Nummer 1 verliert ihr einziges Spiel kampflos - sie war in keinem echten Spiel dabei.
    others = await players(flow, 4)
    staff, second, entries = await play.cup_for(flow, others)
    opening = next(match for match in await play.open_matches(flow, second) if entries[0]["id"] in play.sides(match))
    await play.walkover(flow, staff, opening, entries[0]["id"])
    await play.play_out(flow, staff, second, [entry["id"] for entry in entries[1:]])
    await play.finish(flow, staff, second)
    assert await count(others[0], "seed_one_count") == 0


@pytest.mark.asyncio
async def test_liga_staffel_kennt_kein_topgesetzt(flow):
    captain, rival = await players(flow, 2)
    staffel, home, _away = await play.league_match(flow, home_lineup=[captain], home_bench=[], away=rival, status="results_published")
    await flow.db.tournament_registrations.update_one({"id": home["id"]}, {"$set": {"seed": 1}})
    assert staffel["seeding_mode"] == "manual"
    assert await count(captain, "seed_one_count") == 0


@pytest.mark.asyncio
async def test_topgesetztes_team_zaehlt_fuer_alle_die_gespielt_haben(flow):
    staff, tournament, _team, registration, (lead, member, bench), rival_regs = await play.team_cup(flow)
    await play.play_out(flow, staff, tournament, [registration["id"], *[reg["id"] for reg in rival_regs]])
    await play.finish(flow, staff, tournament)
    assert [await count(person, "seed_one_count") for person in (lead, member, bench)] == [1, 1, 1]


# ---------------------------------------------------------------- Riesentöter (H6)

async def underdog_run(flow, **fields):
    """Die Nummer 4 gewinnt das Turnier: erst gegen die Nummer 1, dann im Finale gegen einen weiteren besser Gesetzten."""
    field = await players(flow, 4)
    staff, tournament, regs = await play.cup_for(flow, field, **fields)
    opening = next(match for match in await play.open_matches(flow, tournament) if regs[3]["id"] in play.sides(match))
    assert regs[0]["id"] in play.sides(opening), "1 gegen 4 in der ersten Runde"
    await play.decide(flow, staff, opening, regs[3]["id"])
    await play.play_out(flow, staff, tournament, [regs[3]["id"], *[reg["id"] for reg in regs[:3]]])
    return field, tournament, regs


@pytest.mark.asyncio
async def test_riesentoeter_nimmt_die_setznummer_der_anmeldung_in_jeder_runde(flow):
    field, tournament, regs = await underdog_run(flow)
    final = max(await flow.matches(tournament), key=lambda match: int(match.get("round") or 0))
    assert regs[3]["id"] in play.sides(final) and final["status"] == "completed"
    assert await count(field[3], "upsets") == 2, "Halbfinale gegen die 1, Finale gegen die 2 oder 3"
    assert [await count(person, "upsets") for person in field[:3]] == [0, 0, 0]


@pytest.mark.asyncio
async def test_kein_riesentoeter_wenn_ausgelost_wurde(flow):
    """Dieselben Nummern an den Anmeldungen, aber das Los hat den Baum gesetzt: Dann gibt es keinen Favoriten."""
    field = await players(flow, 4)
    staff, tournament, regs = await play.cup_for(flow, field, seeding_mode="random")
    for seed, reg in enumerate(regs, start=1):
        await flow.db.tournament_registrations.update_one({"id": reg["id"]}, {"$set": {"seed": seed}})
    # Der ausgeloste Platz im Baum steht am Spiel (``slot.seed``) - hier fest: die spätere Siegerin auf dem schlechteren.
    opening = next(match for match in await play.open_matches(flow, tournament) if regs[3]["id"] in play.sides(match))
    slots = [{**slot, "seed": 2 if slot.get("registration_id") == regs[3]["id"] else 1} for slot in opening["slots"]]
    await flow.db.matches_v2.update_one({"id": opening["id"]}, {"$set": {"slots": slots}})
    await play.play_out(flow, staff, tournament, [regs[3]["id"], *[reg["id"] for reg in regs[:3]]])
    assert (await counters.compute(field[3]["id"], {"matches_won"}))["matches_won"] == 2, "die Nummer 4 hat zwei besser Nummerierte geschlagen"
    assert [await count(person, "upsets") for person in field] == [0, 0, 0, 0]
