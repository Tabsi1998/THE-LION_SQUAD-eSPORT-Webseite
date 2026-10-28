"""Liga-Kader (#2108), Feinheiten: Korrekturen mit Altbestand, Stichtag je Co-Team, Nachzug alter Zuteilungen und
Festhalten erst nach dem Speichern - ohne eine festgehaltene ID zu überschreiben. Erfundene Namen und IDs."""

import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import ids, two_nil  # noqa: E402
from test_league_roster_flow import assign_squad_b, id_world, page, roster_entry, set_id  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def decided_with_lineup(flow, w: dict, lineup_names: tuple[str, ...]) -> None:
    """Ein schon entschiedenes Spiel mit gespeicherter Aufstellung (Altbestand)."""
    body = two_nil(w)
    games = [{**game, "mode_label": None, "map_name": None, "map_image_url": None, "scores": game.get("scores") or {},
              "lineups": {w["reg_a"]["id"]: ids(w, *lineup_names)}} for game in body["games"]]
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {
        "games": games, "status": "completed", "results": body["results"],
        "completed_at": "2026-10-20T10:00:00+00:00"}})


async def move_into_squad(flow, w: dict, squad: dict, name: str):
    flow.act_as(w["users"]["LoeLeitung"])
    response = await flow.patch(f"/api/teams/{w['lions']['id']}/squads/{squad['id']}",
                                json={"member_ids": [*squad["member_ids"], w["users"][name]["id"]]})
    assert response.status_code == 200, response.text
    return response


# ---------------------------------------------------------------- Korrektur mit Altbestand


@pytest.mark.asyncio
async def test_a_staff_correction_keeps_a_stored_lineup_without_id(flow):
    w = await id_world(flow, without=("Mila",))
    await decided_with_lineup(flow, w, ("Kapitaen", "Mila"))
    flow.act_as(w["staff"])
    body = two_nil(w)
    for game in body["games"]:
        game["lineups"] = {w["reg_a"]["id"]: ids(w, "Kapitaen", "Mila")}
    body["games"][0]["scores"] = {w["reg_a"]["id"]: 251, w["reg_h"]["id"]: 180}
    body["reason"] = "Punkte korrigiert"

    corrected = await flow.post(f"/api/matches/{w['match']['id']}/result?force=true", json=body)

    assert corrected.status_code == 200, corrected.text
    stored = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert stored["games"][0]["scores"][w["reg_a"]["id"]] == 251
    assert await roster_entry(flow, w, "Mila") is None, "ohne ID wird nichts festgehalten"

    # Wer neu dazukommt, braucht weiter eine gültige ID - auch bei der Turnierleitung.
    for game in body["games"]:
        game["lineups"] = {w["reg_a"]["id"]: ids(w, "Kapitaen", "Tom")}
    await set_id(flow, w["users"]["Tom"], None)
    refused = await flow.post(f"/api/matches/{w['match']['id']}/result?force=true", json=body)
    assert refused.status_code == 422 and "Tom kann nicht aufgestellt werden" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_amending_keeps_a_stored_lineup_without_id(flow):
    w = await id_world(flow, without=("Mila",))
    await decided_with_lineup(flow, w, ("Kapitaen", "Mila"))
    flow.act_as(w["staff"])

    kept = await flow.put(f"/api/matches/{w['match']['id']}/lineups", json={
        "registration_id": w["reg_a"]["id"], "reason": "Reihenfolge geklärt",
        "games": [{"position": 1, "lineup": ids(w, "Mila", "Kapitaen")}, {"position": 2, "lineup": ids(w, "Kapitaen", "Mila")}]})
    assert kept.status_code == 200, kept.text

    swapped = await flow.put(f"/api/matches/{w['match']['id']}/lineups", json={
        "registration_id": w["reg_a"]["id"], "reason": "Mila spielte Map 2 nicht",
        "games": [{"position": 1, "lineup": ids(w, "Kapitaen", "Mila")}, {"position": 2, "lineup": ids(w, "Kapitaen", "Tom")}]})
    assert swapped.status_code == 200, swapped.text
    back = await flow.put(f"/api/matches/{w['match']['id']}/lineups", json={
        "registration_id": w["reg_a"]["id"], "reason": "doch wieder Mila auf Map 2",
        "games": [{"position": 1, "lineup": ids(w, "Kapitaen", "Mila")}, {"position": 2, "lineup": ids(w, "Kapitaen", "Mila")}]})
    assert back.status_code == 422, "auf Map 2 steht Mila nicht mehr - neu aufstellen braucht die ID"


# ---------------------------------------------------------------- Stichtag je Co-Team


@pytest.mark.asyncio
async def test_after_the_deadline_a_move_into_another_squad_waits_for_approval(flow):
    w = await id_world(flow)
    assert (await assign_squad_b(flow, w)).status_code == 200
    locked = (await roster_entry(flow, w, "Ida"))["id_text"]
    await flow.db.league_seasons.update_one({"id": w["season_id"]}, {"$set": {"roster_deadline": "2026-01-01"}})

    await move_into_squad(flow, w, w["squad_a"], "Ida")

    ida = await roster_entry(flow, w, "Ida")
    assert ida["id_text"] == locked, "die festgehaltene ID bleibt dieselbe"
    assert ida["late_squad_ids"] == [w["squad_a"]["id"]]
    assert set(ida["squad_ids"]) == {w["squad_a"]["id"], w["squad_b"]["id"]}
    flow.act_as(w["users"]["Kapitaen"])
    roster = {row["name"]: row for row in (await page(flow, w))["league"]["roster"]}
    assert "Stichtag" in roster["Ida"]["lineup_blocked"] and roster["Ida"]["game_id_text"] == locked
    refused = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Ida")))
    assert refused.status_code == 422 and "Stichtag" in refused.json()["detail"]

    flow.act_as(w["staff"])
    overview = (await flow.get(f"/api/admin/leagues/seasons/{w['season_id']}/roster")).json()
    by_squad = {row["registration_id"]: {p["name"]: p for p in row["players"]} for row in overview["squads"]}
    assert by_squad[w["reg_a"]["id"]]["Ida"]["state"] == "late"
    other = next(row for row in overview["squads"] if row["registration_id"] not in (w["reg_a"]["id"], w["reg_h"]["id"]))
    assert {p["name"]: p for p in other["players"]}["Ida"]["state"] == "locked", "im bisherigen Co-Team spielt sie weiter"
    approved = await flow.post(f"/api/admin/leagues/seasons/{w['season_id']}/roster/{w['users']['Ida']['id']}/approve",
                               json={"reason": "Wechsel ins A-Team abgesprochen"})
    assert approved.status_code == 200, approved.text
    entry = await roster_entry(flow, w, "Ida")
    assert entry["late_squad_ids"] == [] and entry["id_text"] == locked
    assert entry["approvals"][-1]["old_text"] == locked
    flow.act_as(w["users"]["Kapitaen"])
    accepted = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Ida")))
    assert accepted.status_code == 200, accepted.text


@pytest.mark.asyncio
async def test_rejoining_the_same_squad_after_the_deadline_is_not_late(flow):
    w = await id_world(flow)
    assert (await assign_squad_b(flow, w)).status_code == 200
    await flow.db.league_seasons.update_one({"id": w["season_id"]}, {"$set": {"roster_deadline": "2026-01-01"}})
    squad_b = w["squad_b"]
    flow.act_as(w["users"]["LoeLeitung"])
    without = [uid for uid in squad_b["member_ids"] if uid != w["users"]["Ida"]["id"]]
    assert (await flow.patch(f"/api/teams/{w['lions']['id']}/squads/{squad_b['id']}", json={"member_ids": without})).status_code == 200

    back = await flow.patch(f"/api/teams/{w['lions']['id']}/squads/{squad_b['id']}", json={"member_ids": squad_b["member_ids"]})

    assert back.status_code == 200, back.text
    assert (await roster_entry(flow, w, "Ida"))["late_squad_ids"] == []


# ---------------------------------------------------------------- Nachzug alter Zuteilungen


@pytest.mark.asyncio
async def test_the_backfill_records_old_assignments_so_a_rejoin_is_not_late(flow):
    from services.migrations import MIGRATIONS, migrate_league_roster_backfill

    assert (17, "league_roster_backfill", migrate_league_roster_backfill) in MIGRATIONS
    w = await id_world(flow, deadline="2026-01-01")
    assert await roster_entry(flow, w, "Mila") is None, "Altbestand: zugeteilt ohne Kader-Eintrag"

    first = await migrate_league_roster_backfill(flow.db)
    again = await migrate_league_roster_backfill(flow.db)

    assert first == again
    mila = await roster_entry(flow, w, "Mila")
    assert mila["squad_ids"] == [w["squad_a"]["id"]] and mila["late_squad_ids"] == []
    assert mila["id_text"].startswith("TestloeweMila#") and mila["added_via"] == "backfill"
    assert await flow.db.league_rosters.count_documents({"user_id": w["users"]["Mila"]["id"]}) == 1
    squad = w["squad_a"]
    flow.act_as(w["users"]["LoeLeitung"])
    without = [uid for uid in squad["member_ids"] if uid != w["users"]["Mila"]["id"]]
    assert (await flow.patch(f"/api/teams/{w['lions']['id']}/squads/{squad['id']}", json={"member_ids": without})).status_code == 200
    assert (await flow.patch(f"/api/teams/{w['lions']['id']}/squads/{squad['id']}", json={"member_ids": squad["member_ids"]})).status_code == 200
    assert (await roster_entry(flow, w, "Mila"))["late_squad_ids"] == []


# ---------------------------------------------------------------- Festhalten


@pytest.mark.asyncio
async def test_a_locked_id_is_never_overwritten_without_approval(flow):
    from services import league_roster

    w = await id_world(flow)
    ctx = await league_roster.context_for_tournament(flow.db, w["tournament"], [w["users"]["Mila"]["id"]])
    mila = w["users"]["Mila"]["id"]

    first = await league_roster._lock(flow.db, ctx, mila, {"activision_id": "Erste#1111111"}, via="lineup", actor_id=None)
    second = await league_roster._lock(flow.db, ctx, mila, {"activision_id": "Zweite#2222222"}, via="lineup", actor_id=None)

    assert (first, second) == (True, False)
    assert (await roster_entry(flow, w, "Mila"))["id_text"] == "Erste#1111111"


@pytest.mark.asyncio
async def test_simultaneous_reports_record_each_id_once(flow):
    w = await id_world(flow)
    url = f"/api/matches/{w['match']['id']}/report"
    flow.act_as(w["users"]["Kapitaen"])
    own = flow.post(url, json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))
    flow.act_as(w["users"]["Kapitaen"])
    again = flow.post(url, json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))

    responses = await asyncio.gather(own, again)

    assert all(response.status_code in (200, 409) for response in responses), [r.text for r in responses]
    assert any(response.status_code == 200 for response in responses)
    for name in ("Kapitaen", "Mila"):
        count = await flow.db.league_rosters.count_documents({"season_id": w["season_id"], "user_id": w["users"][name]["id"]})
        assert count == 1, name


@pytest.mark.asyncio
async def test_a_refused_report_records_nothing(flow):
    w = await id_world(flow)
    flow.act_as(w["users"]["Kapitaen"])
    body = two_nil(w, lineup=ids(w, "Kapitaen", "Mila"))
    body["results"][0]["score"] = 1  # passt nicht zu den Maps

    refused = await flow.post(f"/api/matches/{w['match']['id']}/report", json=body)

    assert refused.status_code == 422
    assert await flow.db.league_rosters.count_documents({}) == 0
