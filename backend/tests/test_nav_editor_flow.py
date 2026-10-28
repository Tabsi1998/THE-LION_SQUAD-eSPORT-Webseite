"""Navigation-Editor (#2122): Reihenfolge der Unterpunkte, Liga als Menüpunkt, Pflichtname, Zurücksetzen, „Start“."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def child_keys(items, parent):
    return [child["key"] for child in next(item for item in items if item["key"] == parent)["children"]]


# ---------------------------------------------------------------- NW6 Reihenfolge der Unterpunkte

@pytest.mark.asyncio
async def test_child_order_is_saved_and_survives_a_reload(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="redaktion"))
    items = (await flow.get("/api/admin/nav")).json()["items"]
    club = next(item for item in items if item["key"] == "club")
    reordered = list(reversed(club["children"]))
    club["children"] = [{**child, "order": index} for index, child in enumerate(reordered)]
    items = [{**item, "order": index} for index, item in enumerate(items)]
    saved = (await flow.put("/api/admin/nav", json={"items": items})).json()["items"]
    expected = [child["key"] for child in reordered]
    assert child_keys(saved, "club") == expected
    assert child_keys((await flow.get("/api/admin/nav")).json()["items"], "club") == expected
    flow.act_as(None)
    assert child_keys((await flow.get("/api/nav")).json()["items"], "club") == expected, "die Website zeigt dieselbe Reihenfolge"


@pytest.mark.asyncio
async def test_child_without_saved_place_keeps_its_default_place(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="redaktion"))
    items = (await flow.get("/api/admin/nav")).json()["items"]
    community = next(item for item in items if item["key"] == "community")
    community["children"] = [{**child, "order": index} for index, child in enumerate(community["children"]) if child["key"] != "servers"]
    saved = (await flow.put("/api/admin/nav", json={"items": items})).json()["items"]
    assert "servers" in child_keys(saved, "community"), "ein fehlender Unterpunkt kommt aus der Vorgabe zurück"


# ---------------------------------------------------------------- NW7 Liga, Pflichtname, Zurücksetzen, „Start“

@pytest.mark.asyncio
async def test_league_is_a_menu_entry_that_can_be_hidden_and_renamed(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="redaktion"))
    items = (await flow.get("/api/admin/nav")).json()["items"]
    assert child_keys(items, "esports")[:3] == ["esports_overview", "tournaments", "league"]
    esports = next(item for item in items if item["key"] == "esports")
    for child in esports["children"]:
        if child["key"] == "league":
            child["label"] = "Rudel-Liga"
    saved = (await flow.put("/api/admin/nav", json={"items": items})).json()["items"]
    league = next(child for child in next(item for item in saved if item["key"] == "esports")["children"] if child["key"] == "league")
    assert league["label"] == "Rudel-Liga"
    league["visible"] = False
    await flow.put("/api/admin/nav", json={"items": saved})
    flow.act_as(None)
    assert "league" not in child_keys((await flow.get("/api/nav")).json()["items"], "esports"), "ausgeblendet heißt: nicht im Menü"


@pytest.mark.asyncio
async def test_empty_name_falls_back_and_home_is_called_start(flow):
    await flow.db.cms_nav.insert_one({"id": "main_nav", "items": [{"key": "home", "to": "/", "label": "Home", "visible": True, "order": 0}]})
    flow.act_as(await flow.add_user(role="club_admin", name="redaktion"))
    items = (await flow.get("/api/admin/nav")).json()["items"]
    assert items[0]["label"] == "Start", "das alte „Home“ heißt jetzt „Start“"
    items[1]["label"] = "   "
    saved = (await flow.put("/api/admin/nav", json={"items": items})).json()["items"]
    assert saved[1]["label"] == "News", "ein leerer Name wird nicht gespeichert"


@pytest.mark.asyncio
async def test_reset_restores_the_default_menu(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="redaktion"))
    items = (await flow.get("/api/admin/nav")).json()["items"]
    items[1]["label"] = "Neuigkeiten"
    items[1]["visible"] = False
    await flow.put("/api/admin/nav", json={"items": list(reversed(items))})
    reset = (await flow.post("/api/admin/nav/reset")).json()["items"]
    assert [item["key"] for item in reset][:3] == ["home", "news", "events"]
    assert reset[1]["label"] == "News" and reset[1]["visible"] is True
    flow.act_as(await flow.add_user(name="leser"))
    assert (await flow.post("/api/admin/nav/reset")).status_code == 403
