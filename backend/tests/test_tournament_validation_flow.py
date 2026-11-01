"""Der Server prüft Turnierzahlen und Titel (#2111, TA3).

Vorher nahm er 0 oder negative Teilnehmerzahlen, Best of und Jahreswertung, einen leeren Titel, beim Anlegen jede
Teamgröße und „Min. größer als Max.“ (das gab es nur als Warnung im Browser). Geprüft wird nur, was eine Anfrage
schickt - ein gespeichertes Turnier mit Altwerten lädt und speichert weiter.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    game_id = new_id()
    await flow.db.games.insert_one({"id": game_id, "name": "Probe-Spiel", "slug": f"probe-{game_id[:6]}"})
    return game_id


@pytest.mark.asyncio
async def test_create_refuses_impossible_numbers_and_an_empty_title(flow):
    game_id = await setup(flow)
    base = {"title": "Herbst-Cup", "game_id": game_id}
    for body, word in (
        ({"title": "   "}, "Titel"),
        ({"max_participants": 0}, "Max. Teilnehmer"),
        ({"min_participants": -1}, "Min. Teilnehmer"),
        ({"best_of": 0}, "Best of"),
        ({"season_weight": -1}, "Jahreswertung"),
        ({"min_participants": 9, "max_participants": 8}, "Min. Teilnehmer darf nicht größer"),
    ):
        refused = await flow.post("/api/tournaments", json={**base, **body})
        assert refused.status_code == 422, (body, refused.text)
        assert word in str(refused.json()["detail"]), (body, refused.json())
    too_big_team = await flow.post("/api/tournaments", json={**base, "team_mode": "team", "team_size": 9})
    assert too_big_team.status_code == 422 and "zwischen 2 und 6" in too_big_team.json()["detail"]
    assert await flow.db.tournaments.count_documents({}) == 0

    # Ein Turnier für 1 mit der Vorgabe „Min. 2“ bleibt erlaubt; ein Team ohne Größe hat 2; der Titel wird getrimmt.
    created = await flow.post("/api/tournaments", json={**base, "title": "  Mini-Cup ", "max_participants": 1, "team_mode": "team"})
    assert created.status_code == 200, created.text
    assert (created.json()["title"], created.json()["team_size"]) == ("Mini-Cup", 2)


@pytest.mark.asyncio
async def test_update_checks_only_what_changes(flow):
    await setup(flow)
    # Altbestand aus der Zeit vor der Prüfung: Min. über Max., Best of 0.
    old = await flow.create_tournament(status="draft", min_participants=8, max_participants=4, best_of=0)
    url = f"/api/tournaments/{old['id']}"
    untouched = await flow.patch(url, json={"rules": "Fair spielen"})
    assert untouched.status_code == 200, "ein Altwert hält anderes Speichern nicht auf"
    refused = await flow.patch(url, json={"max_participants": 6})
    assert refused.status_code == 422 and "Min. Teilnehmer darf nicht größer" in refused.json()["detail"]
    fixed = await flow.patch(url, json={"max_participants": 16})
    assert fixed.status_code == 200, fixed.text
    assert (await flow.patch(url, json={"title": ""})).status_code == 422
    assert (await flow.patch(url, json={"best_of": 100})).status_code == 422
