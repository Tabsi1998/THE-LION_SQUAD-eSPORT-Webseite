"""Aufstellungen sind keine öffentliche Angabe (#1650, Datenschutz): Gäste und Unbeteiligte sehen je Map nur
Schnappschuss, Sieger und Punkte - keine Konto-Kennungen, keine Aufstellung. Die Beteiligten des Spiels (Kader beider
Seiten, Leitung) und die Turnierleitung sehen die Aufstellungen mit Namen. Erfundene Namen."""

import json
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import ids, two_nil, world  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def decided(flow) -> dict:
    w = await world(flow)
    flow.act_as(w["users"]["Kapitaen"])
    first = await flow.post(
        f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila"))
    )
    assert first.status_code == 200, first.text
    flow.act_as(w["users"]["Falke1"])
    second = await flow.post(
        f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Falke2", "Falke3"))
    )
    assert second.status_code == 200, second.text
    return w


def lineup_ids(w: dict) -> list[str]:
    return ids(w, "Kapitaen", "Mila", "Falke2", "Falke3")


@pytest.mark.asyncio
@pytest.mark.parametrize("viewer", [None, "Fremd"], ids=["gast", "unbeteiligt"])
async def test_guests_see_maps_winners_and_scores_but_no_lineup_and_no_account_id(flow, viewer):
    w = await decided(flow)
    flow.act_as(w["users"][viewer] if viewer else None)
    match_id = w["match"]["id"]

    responses = {
        "match": await flow.get(f"/api/matches/{match_id}"),
        "page": await flow.get(f"/api/matches/{match_id}/page"),
        "list": await flow.get(f"/api/tournaments/{w['tournament']['id']}/matches-v2"),
    }

    for name, response in responses.items():
        assert response.status_code == 200, (name, response.text)
        text = json.dumps(response.json())
        for user_id in lineup_ids(w):
            assert user_id not in text, (name, "Konto-Kennung eines Aufgestellten")
        assert '"lineups": {"' not in text and "lineup_user_ids" not in text, name
    page = responses["page"].json()
    games = page["match"]["games"]
    assert [(g["map_name"], g["mode"], g["winner_registration_id"]) for g in games] == [
        ("Hafen", "stellung", w["reg_a"]["id"]),
        ("Turm", "suchen", w["reg_a"]["id"]),
    ]
    assert games[0]["scores"] == {w["reg_a"]["id"]: 250, w["reg_h"]["id"]: 180}
    assert games[0]["map_image_url"] == "/uploads/maps/hafen.webp"
    assert all(game["lineups"] == {} for game in page["league"]["games"])
    assert page["league"]["roster"] == [] and page["league"]["rosters"] == {}


@pytest.mark.asyncio
async def test_participants_and_staff_see_lineups_with_names(flow):
    w = await decided(flow)
    match_id = w["match"]["id"]

    # Mitglied ohne Rolle aus dem Kader der Gegenseite: Aufstellungen beider Seiten mit Namen.
    flow.act_as(w["users"]["Falke2"])
    page = (await flow.get(f"/api/matches/{match_id}/page")).json()
    lineups = page["league"]["games"][0]["lineups"]
    assert [person["name"] for person in lineups[w["reg_a"]["id"]]] == ["Kapitaen", "Mila"]
    assert [person["name"] for person in lineups[w["reg_h"]["id"]]] == ["Falke2", "Falke3"]
    assert "lineups" not in page["match"]["games"][0], "am Datensatz nie - nur im Block mit Namen"
    assert "lineup_user_ids" not in page["match"]

    flow.act_as(w["staff"])
    staff_page = (await flow.get(f"/api/matches/{match_id}/page")).json()
    assert set(staff_page["league"]["rosters"]) == {w["reg_a"]["id"], w["reg_h"]["id"]}
    names = sorted(person["name"] for person in staff_page["league"]["rosters"][w["reg_h"]["id"]])
    assert names == ["Falke1", "Falke2", "Falke3"]
    assert staff_page["league"]["games"][0]["lineups"][w["reg_h"]["id"]]
