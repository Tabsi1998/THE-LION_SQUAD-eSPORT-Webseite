"""Das Menü am PC (#1143) - durch die echte Anwendung geschickt.

Jahreswertung und Erfolge stehen unter „Community“, dazu die Chats (nur mit Konto). Ein Name für die Erfolge. Ein
gespeichertes Menü aus der Zeit davor wird beim Lesen umgestellt: die beiden Einträge verschwinden unter „eSports“ und
stehen unter „Community“ - nichts doppelt, nichts verloren.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def children(nav: dict, key: str) -> list[dict]:
    item = next(item for item in nav["items"] if item.get("key") == key)
    return item.get("children") or []


@pytest.mark.asyncio
async def test_default_menu_has_leaderboards_and_chats_under_community(flow):
    nav = (await flow.get("/api/nav")).json()
    community = [(child["key"], child["label"]) for child in children(nav, "community")]
    assert ("season", "Jahreswertung") in community
    assert ("achievements", "Erfolge") in community
    assert ("chats", "Chats") in community
    assert next(child for child in children(nav, "community") if child["key"] == "chats")["auth_only"] is True
    # Liga steht seit #2122 NW7 im Menü-Editor; die Website zeigt sie nur mit sichtbarer Season.
    assert {child["key"] for child in children(nav, "esports")} == {"esports_overview", "tournaments", "league", "fastlap"}


@pytest.mark.asyncio
async def test_a_stored_menu_moves_both_entries_without_doubles(flow):
    await flow.db.cms_nav.insert_one({"id": "main_nav", "items": [
        {"key": "esports", "to": "/esports", "label": "eSports", "visible": True, "order": 4, "children": [
            {"key": "esports_overview", "to": "/esports", "label": "Übersicht", "visible": True},
            {"key": "achievements", "to": "/achievements", "label": "Achievements", "visible": True},
            {"key": "season", "to": "/seasons/current", "label": "Jahreswertung", "visible": True},
        ]},
        {"key": "community", "label": "Community", "visible": True, "order": 5, "children": [
            {"key": "community_overview", "to": "/community", "label": "Übersicht", "visible": True},
            {"key": "players", "to": "/players", "label": "Spieler", "visible": True},
        ]},
    ]})
    nav = (await flow.get("/api/nav")).json()
    esports = [child["to"] for child in children(nav, "esports")]
    community = [child["to"] for child in children(nav, "community")]
    assert "/achievements" not in esports and "/seasons/current" not in esports
    assert community.count("/achievements") == 1 and community.count("/seasons/current") == 1
    # Eigene Beschriftungen des Vereins bleiben.
    assert next(child for child in children(nav, "community") if child["key"] == "players")["label"] == "Spieler"
    assert all(child["label"] != "Achievements" for item in nav["items"] for child in item.get("children") or [])
    # Die FAQ (#2448) kommt in ein gespeichertes Menü ohne sie von selbst dazu, genau einmal und oben.
    assert [item.get("to") for item in nav["items"]].count("/faq") == 1
    assert "/hilfe" not in community


def top_level(nav: dict) -> list[str]:
    return [item.get("key") for item in nav["items"]]


@pytest.mark.asyncio
async def test_faq_is_the_last_entry_of_the_main_bar(flow):
    """FAQ (#2448, Fabian 16.11.): letzter Eintrag rechts, ohne Untermenü - und nicht mehr unter „Community“."""
    nav = (await flow.get("/api/nav")).json()
    assert top_level(nav)[-1] == "faq"
    faq = nav["items"][-1]
    assert (faq["to"], faq["label"]) == ("/faq", "FAQ") and not faq.get("children")
    assert "help" not in {child["key"] for child in children(nav, "community")}


@pytest.mark.parametrize("visible", [True, False])
@pytest.mark.asyncio
async def test_a_stored_help_entry_under_community_moves_to_the_faq(flow, visible):
    """Ein gespeichertes Menü aus #2295 hat „Hilfe“ unter „Community“ - ausgeblendet oder nicht. Sie verschwindet
    dort, die FAQ steht genau einmal in der Hauptleiste."""
    await flow.db.cms_nav.insert_one({"id": "main_nav", "items": [
        {"key": "community", "label": "Community", "visible": True, "order": 5, "children": [
            {"key": "community_overview", "to": "/community", "label": "Übersicht", "visible": True},
            {"key": "help", "to": "/hilfe", "label": "Hilfe", "visible": visible},
        ]},
        {"key": "contact", "to": "/contact", "label": "Kontakt", "visible": True, "order": 6},
    ]})
    nav = (await flow.get("/api/nav")).json()
    assert "/hilfe" not in [child["to"] for child in children(nav, "community")]
    assert top_level(nav).count("faq") == 1 and top_level(nav)[-1] == "faq"
    flow.act_as(await flow.add_staff())
    stored = (await flow.get("/api/admin/nav")).json()
    assert all(child.get("key") != "help" for item in stored["items"] for child in item.get("children") or [])


@pytest.mark.asyncio
async def test_a_hidden_faq_stays_hidden(flow):
    """Blendet der Verein die FAQ im Menü-Editor aus, bleibt sie draußen."""
    await flow.db.cms_nav.insert_one({"id": "main_nav", "items": [
        {"key": "faq", "to": "/faq", "label": "FAQ", "visible": False, "order": 7},
    ]})
    nav = (await flow.get("/api/nav")).json()
    assert "faq" not in top_level(nav)
