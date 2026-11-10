"""Plätze und Finalisten werden je Turnier einmal ermittelt, nicht je Person (#2337, Review M3).

Wer im Finale stand, hält die Veröffentlichung an der Auszeichnung fest (``tournament_awards.finalist``). Für älteren
Bestand ohne das Feld und für Turniere, die beendet, aber noch nicht veröffentlicht sind, rechnet
``awards.tournament_outcome`` einmal und merkt es sich prozessweit.
"""
import pathlib
import sys

import pytest
import pytest_asyncio
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import achievement_play as play  # noqa: E402
from flow_harness import make_flow  # noqa: E402
import badges  # noqa: E402
import database  # noqa: E402
from services import achievement_counters as counters  # noqa: E402
from services import awards  # noqa: E402

KEYS = {"tournaments_won", "podium_finishes", "finals_played", "top8_finishes"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def tree_loads(monkeypatch):
    """Zählt, wie oft der Baum eines Turniers für Plätze und Finalisten gebaut wird."""
    calls = []
    real = awards.tournament_ranks

    async def counted(db, tournament, **kwargs):
        calls.append(tournament["id"])
        return await real(db, tournament, **kwargs)

    monkeypatch.setattr(awards, "tournament_ranks", counted)
    return calls


async def everyone(field: list[dict]) -> list[dict]:
    found = []
    for person in field:
        values = await counters.compute(person["id"], set(KEYS))
        found.append({key: values[key] for key in KEYS})
    return found


async def players(flow, number: int) -> list[dict]:
    return [await flow.add_user(name=f"Spieler {n}") for n in range(1, number + 1)]


@pytest.mark.asyncio
async def test_veroeffentlichen_haelt_die_finalisten_an_der_auszeichnung_fest(flow, tree_loads):
    field = await players(flow, 4)
    tournament, regs = await play.played_cup(flow, field)
    stored = {doc["registration_id"]: doc async for doc in flow.db.tournament_awards.find({"tournament_id": tournament["id"]}, {"_id": 0})}
    final = max(await flow.matches(tournament), key=lambda match: int(match.get("round") or 0))
    assert [stored[reg["id"]]["finalist"] for reg in regs] == [True, True, False, False]
    assert [stored[reg["id"]]["final_match_id"] for reg in regs] == [final["id"], final["id"], None, None]

    tree_loads.clear()
    found = await everyone(field)
    assert [entry["finals_played"] for entry in found] == [1, 1, 0, 0]
    assert tree_loads == [], "aus der Auszeichnung gelesen - kein Baum je Person"


@pytest.mark.asyncio
async def test_aelterer_bestand_ohne_finalist_feld_rechnet_einmal_je_turnier(flow, tree_loads):
    field = await players(flow, 4)
    tournament, _regs = await play.played_cup(flow, field)
    await flow.db.tournament_awards.update_many({"tournament_id": tournament["id"]}, {"$unset": {"finalist": "", "final_match_id": ""}})
    awards.forget_outcome(flow.db)
    tree_loads.clear()

    first, second = await everyone(field), await everyone(field)
    assert [entry["finals_played"] for entry in first] == [1, 1, 0, 0] and second == first
    assert tree_loads == [tournament["id"]], "acht Auswertungen, ein Baum"


@pytest.mark.asyncio
async def test_beendet_ohne_veroeffentlichung_rechnet_einmal_je_turnier(flow, tree_loads):
    field = await players(flow, 4)
    tournament, regs = await play.played_cup(flow, field, publish=False)
    assert await flow.db.tournament_awards.count_documents({"tournament_id": tournament["id"]}) == 0
    tree_loads.clear()

    found = await everyone(field)
    assert [(entry["tournaments_won"], entry["finals_played"]) for entry in found] == [(1, 1), (0, 1), (0, 0), (0, 0)]
    assert sum(entry["podium_finishes"] for entry in found) == 3
    assert tree_loads == [tournament["id"]], "vier Personen, ein Baum"

    # Veröffentlichen schreibt die Auszeichnungen und verwirft das Gemerkte - danach gilt, was gespeichert ist.
    staff = await flow.add_staff()
    await play.finish(flow, staff, tournament)
    tree_loads.clear()
    assert await everyone(field) == found
    assert tree_loads == []


@pytest.mark.asyncio
async def test_gemerktes_gilt_fuer_beendet_nur_kurz_und_je_datenbank(flow, monkeypatch):
    field = await players(flow, 2)
    staff, tournament, regs = await play.cup_for(flow, field)
    await play.play_out(flow, staff, tournament, [reg["id"] for reg in regs])
    await play.finish(flow, staff, tournament, publish=False)
    clock = [1000.0]
    monkeypatch.setattr(awards.time, "monotonic", lambda: clock[0])

    first = await awards.tournament_outcome(flow.db, tournament["id"])
    assert first["ranks"] == {regs[0]["id"]: 1, regs[1]["id"]: 2} and first["participants"] == 2
    assert first["final_match_id"] is None and first["finalists"] == frozenset(), "zwei Teilnehmer, ein Spiel: kein Finale"
    # Ein korrigiertes Ergebnis kommt nach Ablauf der Frist an, vorher gilt das Gemerkte.
    [match] = await flow.matches(tournament)
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"results": [
        {"registration_id": regs[1]["id"], "rank": 1}, {"registration_id": regs[0]["id"], "rank": 2}]}})
    assert (await awards.tournament_outcome(flow.db, tournament["id"]))["ranks"][regs[0]["id"]] == 1
    clock[0] += awards.OUTCOME_TTL_SECONDS + 1
    assert (await awards.tournament_outcome(flow.db, tournament["id"]))["ranks"][regs[0]["id"]] == 2
    # Eine andere Datenbank (im Test: ein anderes Objekt) hat ihren eigenen Merkzettel.
    # Der Vergleich der Objekte zählt, nicht ihr Name: mongomock hält zwei gleichnamige Datenbanken für gleich.
    other = AsyncMongoMockClient()[flow.db.name]
    assert await awards.tournament_outcome(other, tournament["id"]) == awards.EMPTY_OUTCOME


def test_anmeldungen_haben_indizes_fuer_person_und_team():
    import asyncio

    async def scenario():
        db = AsyncMongoMockClient()["indizes"]
        original = database.get_db
        database.get_db = lambda: db
        try:
            await database.init_indexes()
        finally:
            database.get_db = original
        return set(await db.tournament_registrations.index_information())

    names = asyncio.run(scenario())
    assert {"user_id_1", "team_id_1"} <= names
