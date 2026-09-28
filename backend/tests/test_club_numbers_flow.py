"""Der Verein in Zahlen (#621): Preise mit Preisgeld aus dem Preistext, gespielte Turniere, Jahre aus dem
Gründungsjahr, und die Wahl des Betreibers, welche Zähler die Seite zeigt - geprüft, gespeichert, geliefert."""
import pathlib
import sys
from datetime import datetime, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes.home_routes import euro_amount  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def test_preisgeld_aus_dem_preistext():
    assert euro_amount("50 €") == 50.0
    assert euro_amount("EUR 12,50") == 12.5
    assert euro_amount("Headset (30€)") == 30.0
    assert euro_amount("€ 100") == 100.0
    assert euro_amount("Headset") == 0.0
    assert euro_amount(None) == 0.0


@pytest.mark.asyncio
async def test_preise_turniere_und_jahre_zaehlen(flow):
    await flow.db.settings.insert_one({"id": "about_page", "founded_year": 2019})
    await flow.db.tournaments.insert_many([
        {"id": "t1", "slug": "cup", "title": "Cup", "status": "results_published", "is_public": True},
        {"id": "t2", "slug": "alt", "title": "Alt", "status": "archived", "is_public": True},
        {"id": "t3", "slug": "bald", "title": "Bald", "status": "scheduled", "is_public": True},
        {"id": "t4", "slug": "geheim", "title": "Geheim", "status": "completed", "is_public": False},
    ])
    await flow.db.prize_pickups.insert_many([
        {"id": "p1", "tournament_id": "t1", "user_id": "u1", "place": 1, "prize_value": "50 €", "status": "picked_up"},
        {"id": "p2", "tournament_id": "t1", "user_id": "u2", "place": 2, "prize_value": "Headset (30€)", "status": "pending"},
        {"id": "p3", "tournament_id": "t2", "user_id": "u3", "place": 1, "prize_value": "Pokal", "status": "ready"},
    ])
    flow.act_as(None)
    page = (await flow.get("/api/home/about")).json()
    numbers = page["numbers"]
    assert numbers["prizes"] == 3 and numbers["prize_money_eur"] == 80.0
    assert numbers["tournaments_completed"] == 2, "abgeschlossene, öffentliche - nicht die geplanten, nicht die nicht-öffentlichen"
    assert numbers["tournaments"] == 3
    assert numbers["years_active"] == datetime.now(timezone.utc).year - 2019
    assert page["numbers_shown"] == ["prizes", "tournaments_completed", "members", "years_active"]
    assert "numbers_shown" not in page["texts"]
    home = (await flow.get("/api/home/state")).json()
    assert home["club_numbers"]["prizes"] == 3 and home["club_numbers_shown"] == page["numbers_shown"]


@pytest.mark.asyncio
async def test_betreiber_waehlt_und_ordnet_die_zahlen(flow):
    admin = await flow.add_user(role="club_admin", name="Redaktion")
    flow.act_as(admin)
    view = (await flow.get("/api/home/about/admin")).json()
    assert view["number_keys"][0] == "prizes" and "achievements" not in view["number_keys"]
    assert view["texts"]["numbers_shown"] == ["prizes", "tournaments_completed", "members", "years_active"]
    res = await flow.put("/api/home/about/admin", json={"numbers_shown": ["members", "achievements", "prizes", "members", "unsinn"]})
    assert res.status_code == 200
    assert res.json()["texts"]["numbers_shown"] == ["members", "prizes"], "nur bekannte Zähler, jeder einmal, Erfolge sind keine Wahl"
    flow.act_as(None)
    assert (await flow.get("/api/home/about")).json()["numbers_shown"] == ["members", "prizes"]
    # Alles abgewählt = Vorgabe, damit die Seite nie leer ist.
    flow.act_as(admin)
    res = await flow.put("/api/home/about/admin", json={"numbers_shown": []})
    assert res.json()["texts"]["numbers_shown"] == ["prizes", "tournaments_completed", "members", "years_active"]
