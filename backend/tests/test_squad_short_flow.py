"""Kader unter Mindestgröße (docs/LIGA.md, #2202 D-5): Abgänge bleiben möglich (Entscheidung des Obmanns). Fällt der Kader
eines Co-Teams in einer nicht beendeten Staffel unter ``min_squad_size``, erfahren es Verantwortliche und Turnierleitung,
auf der Startseite steht „Kader auffüllen“, bis er wieder reicht. Erfundene Namen."""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import ids, world  # noqa: E402
from test_league_roster_flow import id_world  # noqa: E402

REASONS = ["league_squad_short", "league_squad_short_lead"]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def short_world(flow, *, make=world) -> dict:
    """Rudel A (Kapitaen, Mila, Tom) in einer Staffel mit Mindestkader 3: Jeder Abgang fällt darunter."""
    w = await make(flow)
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"min_squad_size": 3}})
    return w


async def warned(flow, user: dict) -> list[dict]:
    return await flow.db.notifications.find({"user_id": user["id"], "meta.reason": {"$in": REASONS}}, {"_id": 0}).to_list(None)


async def set_kader(flow, w: dict, *names: str):
    flow.act_as(w["users"]["LoeLeitung"])
    response = await flow.patch(f"/api/teams/{w['lions']['id']}/squads/{w['squad_a']['id']}",
                                json={"member_ids": ids(w, *names)})
    assert response.status_code == 200, response.text
    return response


async def actions(flow, user: dict) -> list[dict]:
    flow.act_as(user)
    return (await flow.get("/api/mobile/dashboard")).json()["me"]["actions"]


def fill_task(rows: list[dict]) -> dict | None:
    return next((row for row in rows if row["type"] == "squad_short"), None)


# ---------------------------------------------------------------- Abgang und Warnung


@pytest.mark.asyncio
async def test_removing_a_member_stays_possible_and_warns_team_and_lead(flow):
    w = await short_world(flow)
    flow.act_as(w["users"]["LoeLeitung"])

    removed = await flow.delete(f"/api/teams/{w['lions']['id']}/members/{w['users']['Mila']['id']}")

    assert removed.status_code == 200, removed.text
    captain = await warned(flow, w["users"]["Kapitaen"])
    assert [row["meta"]["reason"] for row in captain] == ["league_squad_short"]
    assert "Rudel A" in captain[0]["title"] and "2" in captain[0]["body"] and "3" in captain[0]["body"]
    assert captain[0]["url"] == f"/teams/{w['lions']['id']}"
    assert [row["meta"]["reason"] for row in await warned(flow, w["users"]["LoeLeitung"])] == ["league_squad_short"], (
        "den Kader pflegt die Teamleitung - auch wenn ein Captain da ist")
    lead = await warned(flow, w["staff"])
    assert [row["meta"]["reason"] for row in lead] == ["league_squad_short_lead"]
    assert await warned(flow, w["users"]["Mila"]) == [] and await warned(flow, w["users"]["Falke1"]) == []
    assert await warned(flow, w["users"]["Tom"]) == [], "der übrige Kader bekommt nichts"


@pytest.mark.asyncio
async def test_leaving_the_team_stays_possible_and_warns(flow):
    w = await short_world(flow)
    flow.act_as(w["users"]["Mila"])

    left = await flow.post(f"/api/teams/{w['lions']['id']}/leave")

    assert left.status_code == 200, left.text
    assert len(await warned(flow, w["users"]["Kapitaen"])) == 1 and len(await warned(flow, w["staff"])) == 1


@pytest.mark.asyncio
async def test_taking_someone_out_of_the_kader_stays_possible_and_warns(flow):
    w = await short_world(flow)

    await set_kader(flow, w, "Kapitaen", "Tom")

    assert len(await warned(flow, w["users"]["Kapitaen"])) == 1 and len(await warned(flow, w["staff"])) == 1


@pytest.mark.asyncio
async def test_a_grant_counts_as_tournament_lead_for_the_warning(flow):
    w = await short_world(flow)
    granted = await flow.add_user(role="player", name="Freigabe")
    await flow.db.users.update_one({"id": granted["id"]}, {"$set": {"areas": ["tournaments"]}})
    banned = await flow.add_staff(name="GesperrteLeitung")
    await flow.db.users.update_one({"id": banned["id"]}, {"$set": {"is_banned": True}})

    await set_kader(flow, w, "Kapitaen", "Tom")

    assert len(await warned(flow, granted)) == 1
    assert await warned(flow, banned) == []


@pytest.mark.asyncio
async def test_swapping_a_player_in_one_change_warns_nobody(flow):
    w = await short_world(flow)

    await set_kader(flow, w, "Kapitaen", "Tom", "Ida")

    assert await warned(flow, w["users"]["Kapitaen"]) == [] and await warned(flow, w["staff"]) == []


@pytest.mark.asyncio
async def test_a_kader_that_stays_big_enough_warns_nobody(flow):
    w = await world(flow)
    assert (await flow.db.tournaments.find_one({"id": w["tournament"]["id"]}, {"_id": 0})).get("min_squad_size") is None

    await set_kader(flow, w, "Kapitaen", "Tom")

    assert await warned(flow, w["users"]["Kapitaen"]) == [], "ohne Mindestkader gilt die Teamgröße 2"


@pytest.mark.asyncio
async def test_changing_other_fields_of_a_small_kader_warns_nobody(flow):
    w = await short_world(flow)
    await flow.db.team_squads.update_one({"id": w["squad_a"]["id"]}, {"$set": {"member_ids": ids(w, "Kapitaen", "Tom")}})
    flow.act_as(w["users"]["LoeLeitung"])

    response = await flow.patch(f"/api/teams/{w['lions']['id']}/squads/{w['squad_a']['id']}", json={"description": "Neu"})

    assert response.status_code == 200 and await warned(flow, w["users"]["Kapitaen"]) == []


@pytest.mark.asyncio
async def test_a_warning_for_the_same_size_goes_out_once_a_further_loss_warns_again(flow):
    w = await short_world(flow)

    await set_kader(flow, w, "Kapitaen", "Tom")
    await set_kader(flow, w, "Kapitaen", "Tom", "Mila")
    await set_kader(flow, w, "Kapitaen", "Tom")
    assert len(await warned(flow, w["users"]["Kapitaen"])) == 1, "gleicher Tag, gleiche Größe: eine Warnung"

    await set_kader(flow, w, "Kapitaen")
    assert len(await warned(flow, w["users"]["Kapitaen"])) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["completed", "results_published", "archived", "cancelled"])
async def test_a_finished_staffel_warns_nobody(flow, status):
    w = await short_world(flow)
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"status": status}})

    await set_kader(flow, w, "Kapitaen", "Tom")

    assert await warned(flow, w["users"]["Kapitaen"]) == [] and await warned(flow, w["staff"]) == []


@pytest.mark.asyncio
async def test_a_withdrawn_co_team_warns_nobody(flow):
    w = await short_world(flow)
    await flow.db.tournament_registrations.update_one({"id": w["reg_a"]["id"]}, {"$set": {"status": "withdrawn"}})

    await set_kader(flow, w, "Kapitaen", "Tom")

    assert await warned(flow, w["users"]["Kapitaen"]) == []


@pytest.mark.asyncio
async def test_a_failing_warning_does_not_stop_the_departure(flow, monkeypatch):
    from services import user_notifications

    async def broken(*_args, **_kwargs):
        raise RuntimeError("Nachricht klemmt")

    w = await short_world(flow)
    monkeypatch.setattr(user_notifications, "create_user_notification", broken)
    flow.act_as(w["users"]["Mila"])

    left = await flow.post(f"/api/teams/{w['lions']['id']}/leave")

    assert left.status_code == 200, left.text
    assert w["users"]["Mila"]["id"] not in (await flow.db.team_squads.find_one({"id": w["squad_a"]["id"]}))["member_ids"]


# ---------------------------------------------------------------- Aufgabe auf der Startseite


@pytest.mark.asyncio
async def test_the_task_stands_on_the_home_page_of_those_in_charge_until_the_kader_is_full(flow):
    w = await short_world(flow)
    await set_kader(flow, w, "Kapitaen", "Tom")

    task = fill_task(await actions(flow, w["users"]["Kapitaen"]))
    assert task and task["label"] == "Kader auffüllen"
    assert "Rudel A" in task["detail"] and "2 von mindestens 3" in task["detail"]
    assert task["team_id"] == w["lions"]["id"] and task["target_type"] == "team"
    assert not task.get("target_id"), "ältere Apps zeigen die Zeile; sie führt dort nirgends hin und trägt keinen Pfeil"

    assert fill_task(await actions(flow, w["users"]["LoeLeitung"]))
    assert fill_task(await actions(flow, w["users"]["Tom"])) is None, "Kader ohne Rolle"
    assert fill_task(await actions(flow, w["users"]["Falke1"])) is None, "Gegner"

    await set_kader(flow, w, "Kapitaen", "Tom", "Ida")

    assert fill_task(await actions(flow, w["users"]["Kapitaen"])) is None
    assert fill_task(await actions(flow, w["users"]["LoeLeitung"])) is None


@pytest.mark.asyncio
async def test_the_task_disappears_when_the_staffel_is_finished(flow):
    w = await short_world(flow)
    await set_kader(flow, w, "Kapitaen", "Tom")
    assert fill_task(await actions(flow, w["users"]["Kapitaen"]))

    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"status": "completed"}})

    assert fill_task(await actions(flow, w["users"]["Kapitaen"])) is None


@pytest.mark.asyncio
async def test_a_lower_minimum_ends_the_task_without_a_new_player(flow):
    w = await short_world(flow)
    await set_kader(flow, w, "Kapitaen", "Tom")

    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"min_squad_size": 2}})

    assert fill_task(await actions(flow, w["users"]["Kapitaen"])) is None


# ---------------------------------------------------------------- Kaderübersicht und Co-Team-Liste


@pytest.mark.asyncio
async def test_the_season_overview_marks_a_short_kader(flow):
    w = await short_world(flow, make=id_world)
    await set_kader(flow, w, "Kapitaen", "Tom")
    flow.act_as(w["staff"])

    overview = (await flow.get(f"/api/admin/leagues/seasons/{w['season_id']}/roster")).json()

    rows = {row["registration_id"]: row for row in overview["squads"]}
    assert rows[w["reg_a"]["id"]]["short"] is True
    assert rows[w["reg_a"]["id"]]["member_count"] == 2 and rows[w["reg_a"]["id"]]["min_squad_size"] == 3
    assert rows[w["reg_h"]["id"]]["short"] is False
    assert overview["counts"]["short"] == 1


@pytest.mark.asyncio
async def test_the_season_overview_ignores_a_finished_staffel(flow):
    w = await short_world(flow, make=id_world)
    await set_kader(flow, w, "Kapitaen", "Tom")
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"status": "completed"}})
    flow.act_as(w["staff"])

    overview = (await flow.get(f"/api/admin/leagues/seasons/{w['season_id']}/roster")).json()

    assert overview["counts"]["short"] == 0


@pytest.mark.asyncio
async def test_the_squad_list_names_what_the_staffel_demands(flow):
    w = await short_world(flow)
    flow.act_as(w["users"]["LoeLeitung"])

    rows = {row["id"]: row for row in (await flow.get(f"/api/teams/{w['lions']['id']}/squads")).json()}

    assert rows[w["squad_a"]["id"]]["league_requirement"] == {"min_size": 3, "title": w["tournament"]["title"]}
    assert "league_requirement" not in rows[w["squad_b"]["id"]], "nicht zugeteilt: keine Vorgabe"

    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"status": "completed"}})
    rows = {row["id"]: row for row in (await flow.get(f"/api/teams/{w['lions']['id']}/squads")).json()}
    assert "league_requirement" not in rows[w["squad_a"]["id"]], "beendet: keine Vorgabe mehr"
