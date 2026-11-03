"""Große Lobbys (#2216): Free for All und Battle Royale legen alle Anmeldungen in ein einziges Spiel.

Ein Turnier darf bis zu 4096 Teilnehmer haben (``models.PARTICIPANT_LIMIT``). Die Stellen, die die Anmeldungen eines Spiels
lesen, kappten bei 50, 64 oder 100 - auf echtem MongoDB fehlten danach alle weiteren: kein Platz auf der Matchseite, kein
Ergebnis melden, kein Matchchat, keine Benachrichtigung. Mongomock ignoriert die Länge bei ``to_list``, deshalb ist der Fehler
nur mit ``FLOW_MONGO_URL`` zu sehen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

LOBBY = 110


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def big_lobby(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(LOBBY, format="ffa")
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    [match] = await flow.matches(tournament)
    assert len([slot for slot in match["slots"] if slot.get("registration_id")]) == LOBBY
    return tournament, match, users, registrations


@pytest.mark.asyncio
async def test_the_match_page_lists_every_player_of_a_big_lobby(flow):
    _tournament, match, users, registrations = await big_lobby(flow)
    # Welche Anmeldungen hinter der alten Grenze lagen, entscheidet die Datenbank - deshalb jeder Platz, nicht nur der letzte.
    lost = []
    for user, registration in zip(users, registrations):
        flow.act_as(user)
        page = await flow.get(f"/api/matches/{match['id']}/page")
        assert page.status_code == 200, page.text
        data = page.json()
        assert len(data["participants"]) == LOBBY, "alle Plätze der Lobby stehen auf der Matchseite"
        if data["acting_registration_id"] != registration["id"] or data["can_act"] is not True:
            lost.append(user["display_name"])
    assert lost == [], "jeder Platz handelt auf der Matchseite für sich"


@pytest.mark.asyncio
async def test_every_player_of_a_big_lobby_hears_about_the_result(flow):
    _tournament, match, users, registrations = await big_lobby(flow)
    flow.act_as(await flow.add_staff())
    entered = await flow.post(f"/api/matches/{match['id']}/result", json={"results": [
        {"registration_id": reg["id"], "rank": rank} for rank, reg in enumerate(registrations, start=1)]})
    assert entered.status_code == 200, entered.text
    told = await flow.db.notifications.distinct("user_id", {"kind": "match_result"})
    assert set(told) == {user["id"] for user in users}, "jeder Platz erfährt das Ergebnis"
