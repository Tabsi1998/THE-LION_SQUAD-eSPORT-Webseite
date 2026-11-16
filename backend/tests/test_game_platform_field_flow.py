"""Spiel: ein ID-Feld als Plattform kennzeichnen (#2281). Höchstens ein Feld je Spiel, nur mit Auswahl, geerbt über die ID-Quelle;
die Season schlägt das gekennzeichnete Feld vor. Altbestand ohne Kennzeichnung verhält sich wie bisher."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_start_world import ok  # noqa: E402
from services.league_roster import id_fields_problem  # noqa: E402
from test_league_platform_flow import PLATFORM, platform_world, settings_url  # noqa: E402

ACTIVISION = {"key": "activision_id", "label": "Activision-ID", "required": True}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def test_at_most_one_platform_field_and_only_with_options():
    assert id_fields_problem([ACTIVISION, {**PLATFORM, "platform": True}]) is None
    two = id_fields_problem([{**PLATFORM, "platform": True}, {"key": "konsole", "label": "Konsole", "options": ["PS5"], "platform": True}])
    assert two and "Nur ein ID-Feld" in two
    bare = id_fields_problem([{**ACTIVISION, "platform": True}])
    assert bare and "Activision-ID" in bare and "Auswahlwerte" in bare


@pytest.mark.asyncio
async def test_the_season_suggests_the_marked_field_also_through_the_id_source(flow):
    w = await platform_world(flow)
    flow.act_as(w["staff"])
    plain = ok(await flow.get(settings_url(w)))
    assert plain["suggested_field"] is None and plain["fields"][0]["platform"] is False, "ohne Kennzeichnung wie bisher"

    # Das Feld steht am Hauptspiel - die Liga spielt eine Version, die ihre IDs von dort erbt.
    await flow.db.games.update_one({"id": "probe-main", "player_id_fields.key": "platform"}, {"$set": {"player_id_fields.$.platform": True}})
    marked = ok(await flow.get(settings_url(w)))
    assert marked["suggested_field"] == "platform"
    assert marked["fields"][0]["platform"] is True
    assert marked["settings"]["platform_field"] is None, "nur ein Vorschlag - gespeichert wird erst mit der Season"


@pytest.mark.asyncio
async def test_the_game_page_refuses_two_platform_fields_or_one_without_options(flow):
    await flow.db.games.insert_one({"id": "spiel", "slug": "spiel", "name": "Spiel", "kind": "game", "player_id_fields": [ACTIVISION]})
    flow.act_as(await flow.add_user(role="superadmin", name="admin"))
    good = await flow.patch("/api/games/spiel", json={"player_id_fields": [ACTIVISION, {**PLATFORM, "required": True, "platform": True}]})
    assert good.status_code == 200, good.text
    assert [item.get("platform") for item in good.json()["player_id_fields"]] == [None, True]

    two = await flow.patch("/api/games/spiel", json={"player_id_fields": [
        {**ACTIVISION}, {**PLATFORM, "platform": True}, {"key": "konsole", "label": "Konsole", "options": ["PS5"], "platform": True}]})
    assert two.status_code == 422 and "Nur ein ID-Feld" in two.json()["detail"]
    bare = await flow.patch("/api/games/spiel", json={"player_id_fields": [{**ACTIVISION, "platform": True}, PLATFORM]})
    assert bare.status_code == 422 and "Auswahlwerte" in bare.json()["detail"]


@pytest.mark.asyncio
async def test_a_version_may_not_mark_a_second_field_when_its_id_source_has_one(flow):
    await flow.db.games.insert_one({"id": "haupt", "slug": "haupt", "name": "Hauptspiel", "kind": "game",
                                    "player_id_fields": [ACTIVISION, {**PLATFORM, "platform": True}]})
    await flow.db.games.insert_one({"id": "version", "slug": "version", "name": "Version", "kind": "edition", "parent_game_id": "haupt",
                                    "player_id_fields": []})
    flow.act_as(await flow.add_user(role="superadmin", name="admin"))
    second = await flow.patch("/api/games/version", json={"player_id_fields": [
        {"key": "konsole", "label": "Konsole", "options": ["PS5", "PC"], "platform": True}]})
    assert second.status_code == 422, second.text
    assert "Plattform" in second.json()["detail"] and "Hauptspiel" in second.json()["detail"]
    unmarked = await flow.patch("/api/games/version", json={"player_id_fields": [{"key": "konsole", "label": "Konsole", "options": ["PS5", "PC"]}]})
    assert unmarked.status_code == 200, unmarked.text
    own = await flow.patch("/api/games/version", json={"inherit_player_ids": False, "player_id_fields": [
        {"key": "konsole", "label": "Konsole", "options": ["PS5", "PC"], "platform": True}]})
    assert own.status_code == 200, "ohne Erben ist das eigene Feld die Plattform"


@pytest.mark.asyncio
async def test_a_main_game_may_not_mark_a_field_when_an_inheriting_version_has_its_own(flow):
    """Review #2281: auch andersherum - kennzeichnet das Hauptspiel, darf keine erbende Version schon ein eigenes haben."""
    await flow.db.games.insert_one({"id": "haupt", "slug": "haupt", "name": "Hauptspiel", "kind": "game",
                                    "player_id_fields": [ACTIVISION, PLATFORM]})
    await flow.db.games.insert_one({"id": "version", "slug": "version", "name": "Version Eins", "kind": "edition", "parent_game_id": "haupt",
                                    "player_id_fields": [{"key": "konsole", "label": "Konsole", "options": ["PS5", "PC"], "platform": True}]})
    flow.act_as(await flow.add_user(role="superadmin", name="admin"))
    refused = await flow.patch("/api/games/haupt", json={"player_id_fields": [ACTIVISION, {**PLATFORM, "platform": True}]})
    assert refused.status_code == 422, refused.text
    assert "Version Eins" in refused.json()["detail"] and "Konsole" in refused.json()["detail"]
    await flow.db.games.update_one({"id": "version"}, {"$set": {"inherit_player_ids": False}})
    allowed = await flow.patch("/api/games/haupt", json={"player_id_fields": [ACTIVISION, {**PLATFORM, "platform": True}]})
    assert allowed.status_code == 200, "eine Version, die nicht erbt, stört nicht"
