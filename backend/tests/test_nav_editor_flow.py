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
