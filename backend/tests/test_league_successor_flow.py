"""F.2 Neue Season aus der Vorgänger-Season (#1627, docs/LIGA.md; Entscheidungen Nr. 158–161) - über die echten Routen.

Drei Liga N mit je einer Staffel aus vier Co-Teams, alles gespielt und abgeschlossen (F.1). Dann: Zonen in Tabelle und Endstand, neue Season
mit allen Einstellungen als Entwurf, Teams nach Auf- und Abstieg, Abmelden mit Frist, der Vorgänger bleibt unverändert, Doppelklick, Rechte und
die Season-Historie. Nur erfundene Namen.
"""
import asyncio
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_rules_world import ADMIN as RULES_ADMIN  # noqa: E402
from league_rules_world import BODY, today  # noqa: E402
from league_start_world import ADMIN, GAME, add_staffel, ok, season_body  # noqa: E402
from models import now_utc  # noqa: E402

STAFFELN = f"{ADMIN}/staffeln"
LONG_AGO = (now_utc() - timedelta(days=90)).isoformat()
NEW_START = (now_utc() + timedelta(days=30)).date().isoformat() + "T00:00:00"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def regs_of(flow, tid: str) -> list[dict]:
    rows = await flow.db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0}).to_list(None)
    return sorted(rows, key=lambda row: row["display_name"])


async def play(flow, tid: str) -> list[dict]:
    """Jeder gegen jeden, das Team mit dem kleineren Namen gewinnt: Die Tabelle steht 1, 2, 3, 4 in der Reihenfolge der Namen."""
    regs = await regs_of(flow, tid)
    strength = {row["id"]: index for index, row in enumerate(regs)}
    for match in await flow.db.matches_v2.find({"tournament_id": tid, "is_preview": {"$ne": True}}, {"_id": 0}).to_list(None):
        sides = [slot["registration_id"] for slot in match.get("slots") or [] if slot.get("registration_id")]
        if len(sides) != 2:
            continue
        winner, loser = sorted(sides, key=lambda value: strength[value])
        await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {
            "status": "completed", "completed_at": LONG_AGO,
            "results": [{"registration_id": winner, "rank": 1, "score": 2}, {"registration_id": loser, "rank": 2, "score": 0}]}})
    return regs


async def build(flow, *, levels: int = 3, teams: int = 4, zones: dict | None = None, exits: dict | None = None,
                extra: dict | None = None) -> dict:
    """Liga mit ``levels`` Liga N (je eine Staffel mit ``teams`` Co-Teams), gespielt. ``exits``: {(level, index): status} vor dem Abschluss.
    ``extra``: {level: [Größe, …]} weitere Staffeln dieser Liga N (``world["more"][level]`` mit Turnier und Anmeldungen)."""
    lead = await flow.add_staff()
    flow.act_as(lead)
    game = ok(await flow.post("/api/games", json=GAME))
    league = ok(await flow.post(ADMIN, json={"name": "Aufstiegs-Liga", "game_id": game["id"]}))
    season = ok(await flow.post(f"{ADMIN}/{league['id']}/seasons", json=season_body(
        blocked_periods=[{"start_date": "2030-12-21", "end_date": "2031-01-03", "label": "Pause"}],
        application_slots=12, best_of=5, team_size=4)))
    world = {"lead": lead, "game": game, "league": league, "season": season, "divisions": [], "tids": [], "regs": {}}
    for level in range(1, levels + 1):
        body = {"zones": zones} if zones and level == 2 else {}
        division = ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json=body))
        tid = await add_staffel(flow, lead, division["id"], teams, game=game, prefix=f"L{level}")
        flow.act_as(lead)
        ok(await flow.post(f"/api/tournaments/{tid}/status", json={"status": "live"}))
        regs = await play(flow, tid)
        for (exit_level, index), status in (exits or {}).items():
            if exit_level == level:
                await flow.db.tournament_registrations.update_one({"id": regs[index]["id"]}, {"$set": {
                    "status": status, "removal": {"at": LONG_AGO, "mode": "forfeit"}}})
        world["divisions"].append(division)
        world["tids"].append(tid)
        world["regs"][level] = regs
        for index, size in enumerate((extra or {}).get(level, [])):
            more = await add_staffel(flow, lead, division["id"], size, game=game, prefix=f"L{level}X{index}")
            flow.act_as(lead)
            ok(await flow.post(f"/api/tournaments/{more}/status", json={"status": "live"}))
            world["tids"].append(more)
            world.setdefault("more", {}).setdefault(level, []).append({"tid": more, "regs": await play(flow, more)})
    return world


async def close_all(flow, world: dict) -> None:
    flow.act_as(world["lead"])
    for tid in world["tids"]:
        ok(await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}))


async def successor(flow, world: dict, **body):
    flow.act_as(world["lead"])
    return await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/successor", json={"start_date": NEW_START, "confirm": True, **body})


async def new_season(flow, world: dict) -> dict:
    answer = ok(await successor(flow, world))
    return await flow.db.league_seasons.find_one({"id": answer["season"]["id"]}, {"_id": 0})


def squad_of(world: dict, level: int, index: int) -> str:
    return world["regs"][level][index]["squad_id"]


async def carried(flow, season_id: str) -> dict[str, dict]:
    rows = await flow.db.league_applications.find({"season_id": season_id}, {"_id": 0}).to_list(None)
    return {row["squad_id"]: row for row in rows}


# ---------------------------------------------------------------- Zonen

@pytest.mark.asyncio
async def test_zones_in_table_and_final_per_division_with_top_and_bottom(flow):
    world = await build(flow)
    flow.act_as(world["lead"])
    tables = [ok(await flow.get(f"/api/tournaments/{tid}/standings")) for tid in world["tids"]]
    zones = [[row["zone"] for row in rows] for rows in tables]
    assert zones[0] == [None, None, None, "relegation"]  # Liga 1: kein Aufstieg
    assert zones[1] == ["promotion", None, None, "relegation"]
    assert zones[2] == ["promotion", None, None, None]  # unterste Liga: kein Abstieg
    await close_all(flow, world)
    final = await flow.db.league_final_tables.find_one({"tournament_id": world["tids"][1], "active": True}, {"_id": 0})
    assert final["zones"]["promote"] == 1 and final["zones"]["relegate"] == 1
    assert sorted(final["promotion"].values()) == ["promotion", "relegation"]
    assert [row["zone"] for row in final["rows"]] == ["promotion", None, None, "relegation"]
    # Eingefroren: Eine spätere Änderung der Zonen ändert den Endstand nicht.
    ok(await flow.patch(f"{ADMIN}/divisions/{world['divisions'][1]['id']}", json={"zones": {"promote": 2, "relegate": 2}}))
    rows = ok(await flow.get(f"/api/tournaments/{world['tids'][1]}/standings"))
    assert [row["zone"] for row in rows] == ["promotion", None, None, "relegation"]


@pytest.mark.asyncio
async def test_zone_settings_are_checked_against_the_staffel_size(flow):
    world = await build(flow, levels=2, teams=2)
    division = world["divisions"][1]
    flow.act_as(world["lead"])
    refused = await flow.patch(f"{ADMIN}/divisions/{division['id']}", json={"zones": {"promote": 9, "relegate": 9}})
    assert refused.status_code == 422 and "überschneiden" in refused.json()["detail"]
    saved = ok(await flow.patch(f"{ADMIN}/divisions/{division['id']}", json={"zones": {"promote": 2, "relegate": 0, "playoff_promote": 1}}))
    assert saved["zones"] == {"promote": 2, "relegate": 0, "playoff_promote": 1, "playoff_relegate": 0}
    view = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}"))
    by_level = {row["level"]: row for row in view["divisions"]}
    # Liga 2 ist die unterste: Abstieg gibt es dort ohnehin nicht, Liga 1 die oberste ohne Aufstieg.
    assert by_level[2]["zones_effective"]["bottom"] and by_level[2]["zones_effective"]["promote"] == 2
    assert by_level[1]["zones_effective"]["top"] and by_level[1]["zones_effective"]["promote"] == 0


@pytest.mark.asyncio
async def test_tie_at_a_zone_boundary_blocks_the_close(flow):
    world = await build(flow, levels=2)
    tid = world["tids"][1]
    regs = world["regs"][2]
    # Platz 1 und 2 der unteren Liga stehen in allem gleich: Ihr direktes Spiel ist abgesagt, beide schlagen die übrigen gleich hoch.
    duel = next(match for match in await flow.db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(None)
                if {slot["registration_id"] for slot in match["slots"]} == {regs[0]["id"], regs[1]["id"]})
    await flow.db.matches_v2.update_one({"id": duel["id"]}, {"$set": {"status": "cancelled"}, "$unset": {"results": ""}})
    flow.act_as(world["lead"])
    refused = await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True})
    assert refused.status_code == 409 and "Grenze" in refused.json()["detail"]
    cockpit = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/closing"))
    row = next(item for item in cockpit["staffeln"] if item["tournament_id"] == tid)
    assert any(blocker["code"] == "zone_tie" for blocker in row["blockers"])
    assert [tie["kind"] for tie in row["ties"]] == ["zone"]
    # Gegenprobe: Die obere Liga hat keinen solchen Gleichstand und schließt ab.
    ok(await flow.post(f"{STAFFELN}/{world['tids'][0]}/close", json={"confirm": True}))


# ---------------------------------------------------------------- Neue Season

@pytest.mark.asyncio
async def test_only_a_closed_season_gets_a_successor(flow):
    world = await build(flow, levels=2, teams=2)
    flow.act_as(world["lead"])
    ok(await flow.post(f"{STAFFELN}/{world['tids'][0]}/close", json={"confirm": True}))
    preview = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/successor"))
    assert not preview["can_create"] and "nicht abgeschlossen" in preview["problems"][0]
    refused = await successor(flow, world)
    assert refused.status_code == 409
    assert await flow.db.league_seasons.count_documents({"league_id": world["league"]["id"]}) == 1
    ok(await flow.post(f"{STAFFELN}/{world['tids'][1]}/close", json={"confirm": True}))
    preview = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/successor"))
    assert preview["can_create"] and preview["problems"] == []


@pytest.mark.asyncio
async def test_teams_move_by_zones_and_exited_or_disqualified_fall_out(flow):
    world = await build(flow, exits={(1, 1): "withdrawn", (3, 2): "disqualified"})
    await close_all(flow, world)
    preview = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/successor"))
    by_level = {row["level"]: [team["squad_id"] for team in row["teams"]] for row in preview["divisions"]}
    # Liga 1: Das ausgetretene Team (Platz 2) belegt den Abstiegsplatz - der Letzte in der Wertung bleibt, dazu der Aufsteiger aus Liga 2.
    assert set(by_level[1]) == {squad_of(world, 1, 0), squad_of(world, 1, 2), squad_of(world, 1, 3), squad_of(world, 2, 0)}
    # Liga 2: Die Mitte bleibt, der Aufsteiger aus Liga 3 kommt; aus Liga 1 kommt niemand (dort belegt der Ausgetretene den Abstieg).
    assert set(by_level[2]) == {squad_of(world, 2, 1), squad_of(world, 2, 2), squad_of(world, 3, 0)}
    # Der Disqualifizierte der untersten Liga fällt heraus - unten gibt es sonst keinen Abstieg.
    assert set(by_level[3]) == {squad_of(world, 2, 3), squad_of(world, 3, 1), squad_of(world, 3, 3)}
    dropped = {row["display_name"]: row["reason"] for row in preview["dropped"]}
    assert sorted(dropped.values()) == ["Ausgetreten", "Disqualifiziert"]
    season = await new_season(flow, world)
    rows = await carried(flow, season["id"])
    assert len(rows) == 10
    assert squad_of(world, 1, 1) not in rows and squad_of(world, 3, 2) not in rows
    climb = rows[squad_of(world, 2, 0)]
    assert climb["status"] == "accepted" and climb["carry_over"]["movement"] == "up" and climb["carry_over"]["division_level"] == 1
    assert rows[squad_of(world, 2, 3)]["carry_over"]["movement"] == "down"
    assert rows[squad_of(world, 1, 0)]["carry_over"]["movement"] == "stay"
    divisions = {row["level"]: row for row in await flow.db.league_divisions.find({"season_id": season["id"]}, {"_id": 0}).to_list(None)}
    assert climb["carry_over"]["division_id"] == divisions[1]["id"]


@pytest.mark.asyncio
async def test_all_settings_come_over_as_draft_dates_are_new(flow):
    world = await build(flow, levels=2, teams=2, zones={"promote": 1, "relegate": 0, "playoff_promote": 1})
    flow.act_as(world["lead"])
    maps = ok(await flow.post(f"/api/games/{world['game']['id']}/maps", json={"name": "Hafenkante", "modes": ["flagge"]}))
    ok(await flow.put(f"{ADMIN}/seasons/{world['season']['id']}/map-pool", json={"modes": [{"mode": "flagge", "map_ids": [maps["id"]]}]}))
    await flow.db.league_seasons.update_one({"id": world["season"]["id"]}, {"$set": {"veto_presets": [{"week": 2, "mode": "flagge", "map_id": maps["id"]}],
                                                                                   "protest_hours": 36}})
    await close_all(flow, world)
    before = await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})
    season = await new_season(flow, world)
    assert season["status"] == "draft" and season["visibility"] == "off" and season["number"] == 2 and season["name"] == "Season 2"
    assert season["predecessor_id"] == before["id"]
    for key in ("best_of", "team_size", "scoring_rules", "veto_rules", "checkin_rules", "schedule_rules", "application_slots", "veto_presets",
                "protest_hours", "game_mode_order", "max_staffel_size"):
        assert season.get(key) == before.get(key), key
    # Zeitraum und Termine neu (Nr. 161).
    from services.league_service import VIENNA, _aware

    assert _aware(season["start_date"]).astimezone(VIENNA).date().isoformat() == NEW_START[:10] and season["start_date"] != before["start_date"]
    assert season.get("blocked_periods") == [] and not season.get("application_opens_at")
    divisions = sorted(await flow.db.league_divisions.find({"season_id": season["id"]}, {"_id": 0}).to_list(None), key=lambda row: row["level"])
    assert [row["level"] for row in divisions] == [1, 2] and divisions[1]["zones"]["playoff_promote"] == 1
    old_pool = await flow.db.map_pools.find_one({"scope": "league_season", "scope_id": before["id"]}, {"_id": 0}, sort=[("version", -1)])
    new_pool = await flow.db.map_pools.find_one({"scope": "league_season", "scope_id": season["id"]}, {"_id": 0})
    assert new_pool and new_pool["version"] == 1 and new_pool["modes"] == old_pool["modes"]


@pytest.mark.asyncio
async def test_own_rules_become_a_draft_and_teams_must_agree_again(flow):
    from services import league_rules

    world = await build(flow, levels=1, teams=2)
    flow.act_as(world["lead"])
    scope = f"{RULES_ADMIN}/league_season/{world['season']['id']}"
    draft = ok(await flow.put(f"{scope}/draft", json={"title": "Regelwerk", "body_md": BODY, "annexes": []}))
    ok(await flow.post(f"{scope}/publish", json={"revision": draft["revision"], "valid_from": today(), "change_reason": "Erste Fassung",
                                                   "requires_consent": True, "confirm_empty": True}))
    await close_all(flow, world)
    season = await new_season(flow, world)
    view = ok(await flow.get(f"{RULES_ADMIN}/league_season/{season['id']}"))
    assert view["draft"]["body_md"] == BODY and view["draft"]["carried_from"]["season_id"] == world["season"]["id"]
    assert view["versions"] == []  # nichts veröffentlicht sich selbst
    # Freigabe der neuen Fassung, dann ein übernommenes Co-Team in eine Staffel: Vor dem Spiel ist die Zustimmung offen (D.2-Sperre).
    ok(await flow.post(f"{RULES_ADMIN}/league_season/{season['id']}/publish", json={
        "revision": view["draft"]["revision"], "valid_from": today(), "change_reason": "Neue Season", "requires_consent": True, "confirm_empty": True}))
    division = await flow.db.league_divisions.find_one({"season_id": season["id"]}, {"_id": 0})
    staffel = ok(await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={}))
    application = next(iter((await carried(flow, season["id"])).values()))
    ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/applications/{application['id']}/assign", json={"tournament_id": staffel["tournament_id"]}))
    tournament = await flow.db.tournaments.find_one({"id": staffel["tournament_id"]}, {"_id": 0})
    registrations = await flow.db.tournament_registrations.find({"tournament_id": staffel["tournament_id"]}, {"_id": 0}).to_list(None)
    consent = await league_rules.sides_consent(flow.db, tournament, registrations)
    assert all(state and state["open"] for state in consent.values())
    # Gegenprobe: In der alten Season war zugestimmt? Gilt nicht - die Zustimmung zählt je Season.
    old = await league_rules.sides_consent(flow.db, await flow.db.tournaments.find_one({"id": world["tids"][0]}, {"_id": 0}),
                                           await regs_of(flow, world["tids"][0]))
    assert all(state and state["open"] for state in old.values())


@pytest.mark.asyncio
async def test_league_rules_keep_applying_without_a_season_draft(flow):
    world = await build(flow, levels=1, teams=2)
    flow.act_as(world["lead"])
    scope = f"{RULES_ADMIN}/league/{world['league']['id']}"
    draft = ok(await flow.put(f"{scope}/draft", json={"title": "Liga-Regeln", "body_md": "Fair spielen.", "annexes": []}))
    ok(await flow.post(f"{scope}/publish", json={"revision": draft["revision"], "valid_from": today(), "change_reason": "Liga-Fassung",
                                                   "requires_consent": False, "confirm_empty": True}))
    await close_all(flow, world)
    preview = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/successor"))
    assert preview["rules"]["kind"] == "league"
    season = await new_season(flow, world)
    assert not await flow.db.league_rules.find_one({"scope": "league_season", "scope_id": season["id"]}, {"_id": 1})


# ---------------------------------------------------------------- Abmelden

@pytest.mark.asyncio
async def test_captain_withdraws_until_start_and_frees_the_seat(flow):
    world = await build(flow, levels=1, teams=3)
    await close_all(flow, world)
    season = await new_season(flow, world)
    rows = await carried(flow, season["id"])
    squad_id = squad_of(world, 1, 0)
    application = rows[squad_id]
    squad = await flow.db.team_squads.find_one({"id": squad_id}, {"_id": 0})
    captain = await flow.db.users.find_one({"id": squad["captain_id"]}, {"_id": 0})
    member = next(uid for uid in squad["member_ids"] if uid not in (squad["captain_id"], squad["vice_captain_id"]))
    # Nachricht beim Anlegen: an Captain und Vertreter, mit Frist.
    notes = await flow.db.notifications.find({"meta.reason": "league_successor"}, {"_id": 0}).to_list(None)
    mine = [row for row in notes if row.get("user_id") == captain["id"]]
    assert len(mine) == 1 and "Liga 1" in mine[0]["body"] and "meldet sich bis" in mine[0]["body"]
    assert {row["user_id"] for row in notes if row["meta"]["application_id"] == application["id"]} == {squad["captain_id"], squad["vice_captain_id"]}
    # Die Season ist noch „off“ - der Captain sieht sein Co-Team trotzdem unter Teams, mit Frist.
    flow.act_as(captain)
    items = ok(await flow.get("/api/me/league-applications"))["items"]
    item = next(row for row in items if row["id"] == application["id"])
    assert item["can_withdraw"] and item["carry_over"]["withdraw_until"] and item["url"] is None
    # Rechte: ein Spieler des Kaders darf nicht abmelden.
    flow.act_as(await flow.db.users.find_one({"id": member}, {"_id": 0}))
    refused = await flow.post(f"/api/me/league-applications/{application['id']}/withdraw")
    assert refused.status_code == 403
    from services.league_applications import seat_stats

    taken = (await seat_stats(flow.db, season))["taken"]
    flow.act_as(captain)
    done = ok(await flow.post(f"/api/me/league-applications/{application['id']}/withdraw"))
    assert done["status"] == "withdrawn"
    assert (await seat_stats(flow.db, season))["taken"] == taken - 1
    # Frist vorbei: Ein anderes Co-Team meldet sich nach dem Start nicht mehr selbst ab.
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"start_date": (now_utc() - timedelta(days=1)).isoformat()}})
    other = rows[squad_of(world, 1, 1)]
    other_squad = await flow.db.team_squads.find_one({"id": other["squad_id"]}, {"_id": 0})
    flow.act_as(await flow.db.users.find_one({"id": other_squad["captain_id"]}, {"_id": 0}))
    late = await flow.post(f"/api/me/league-applications/{other['id']}/withdraw")
    assert late.status_code == 409 and "Start" in late.json()["detail"]
    assert (await flow.db.league_applications.find_one({"id": other["id"]}, {"_id": 0}))["status"] == "accepted"


# ---------------------------------------------------------------- Vorgänger, Doppelklick, Rechte

async def snapshot(flow, world: dict) -> dict:
    season_id = world["season"]["id"]
    query = {"tournament_id": {"$in": world["tids"]}}
    return {
        "season": await flow.db.league_seasons.find_one({"id": season_id}, {"_id": 0}),
        "divisions": await flow.db.league_divisions.find({"season_id": season_id}, {"_id": 0}).sort("level", 1).to_list(None),
        "finals": await flow.db.league_final_tables.find(query, {"_id": 0}).sort("tournament_id", 1).to_list(None),
        "matches": await flow.db.matches_v2.find(query, {"_id": 0}).sort("id", 1).to_list(None),
        "registrations": await flow.db.tournament_registrations.find(query, {"_id": 0}).sort("id", 1).to_list(None),
        "tournaments": await flow.db.tournaments.find({"id": {"$in": world["tids"]}}, {"_id": 0}).sort("id", 1).to_list(None),
        "pools": await flow.db.map_pools.find({"scope_id": season_id}, {"_id": 0}).sort("version", 1).to_list(None),
        "rules": await flow.db.league_rules.find({"scope_id": season_id}, {"_id": 0}).to_list(None),
        "applications": await flow.db.league_applications.find({"season_id": season_id}, {"_id": 0}).to_list(None),
    }


@pytest.mark.asyncio
async def test_predecessor_stays_unchanged(flow):
    world = await build(flow, levels=2, teams=3)
    await close_all(flow, world)
    before = await snapshot(flow, world)
    standings_before = [ok(await flow.get(f"/api/tournaments/{tid}/standings")) for tid in world["tids"]]
    season = await new_season(flow, world)
    # Auch Arbeit an der neuen Season ändert nichts am Vorgänger.
    division = await flow.db.league_divisions.find_one({"season_id": season["id"], "level": 1}, {"_id": 0})
    ok(await flow.patch(f"{ADMIN}/divisions/{division['id']}", json={"zones": {"relegate": 2}}))
    ok(await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"best_of": 1}))
    assert await snapshot(flow, world) == before
    assert [ok(await flow.get(f"/api/tournaments/{tid}/standings")) for tid in world["tids"]] == standings_before


@pytest.mark.asyncio
async def test_double_click_creates_one_season(flow):
    world = await build(flow, levels=2, teams=2)
    await close_all(flow, world)
    first, second = await asyncio.gather(successor(flow, world), successor(flow, world))
    assert sorted([first.status_code, second.status_code]) in ([200, 200], [200, 409])
    seasons = await flow.db.league_seasons.find({"predecessor_id": world["season"]["id"]}, {"_id": 0}).to_list(None)
    assert len(seasons) == 1
    again = ok(await successor(flow, world))
    assert again["replay"] and again["season"]["id"] == seasons[0]["id"]
    assert await flow.db.league_applications.count_documents({"season_id": seasons[0]["id"]}) == 4
    assert await flow.db.league_divisions.count_documents({"season_id": seasons[0]["id"]}) == 2
    keys = [row["meta"]["dedupe_key"] for row in await flow.db.notifications.find({"meta.reason": "league_successor"}, {"_id": 0}).to_list(None)]
    assert len(keys) == 8 and len(keys) == len(set(keys))  # vier Co-Teams, je Captain und Vertreter einmal


@pytest.mark.asyncio
async def test_rights_manage_creates_season_only_sees_nothing(flow):
    world = await build(flow, levels=1, teams=2)
    await close_all(flow, world)
    league_id = world["league"]["id"]

    async def lead(name: str, *capabilities: str) -> dict:
        user = await flow.add_user(name=name)
        await flow.db.league_staff.insert_one({"id": new_id(), "league_id": league_id, "user_id": user["id"],
                                               "capabilities": list(capabilities), "created_at": now_utc().isoformat()})
        return user

    flow.act_as(await lead("Nur Season", "season", "results"))
    refused = await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/successor", json={"start_date": NEW_START, "confirm": True})
    assert refused.status_code == 403
    assert (await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/successor")).status_code == 403
    manager = await lead("Verwaltet", "manage")
    flow.act_as(manager)
    unconfirmed = await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/successor", json={"start_date": NEW_START})
    assert unconfirmed.status_code == 422
    done = ok(await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/successor", json={"start_date": NEW_START, "confirm": True}))
    log = await flow.db.audit_logs.find_one({"action": "league.season.successor", "target_id": done["season"]["id"]}, {"_id": 0})
    assert log and log["actor_id"] == manager["id"]


# ---------------------------------------------------------------- Season-Historie

@pytest.mark.asyncio
async def test_season_history_on_team_and_player(flow):
    world = await build(flow, levels=2, teams=2)
    await close_all(flow, world)
    winner = world["regs"][1][0]
    flow.act_as(world["lead"])
    team = ok(await flow.get(f"/api/teams/{winner['team_id']}"))
    assert len(team["league_history"]) == 1
    entry = team["league_history"][0]
    assert entry["division_label"] == "Liga 1" and entry["rank"] == 1 and entry["champion"] and entry["of"] == 2
    climber = world["regs"][2][0]
    team = ok(await flow.get(f"/api/teams/{climber['team_id']}"))
    assert team["league_history"][0]["zone"] == "promotion" and not team["league_history"][0]["champion"]
    squad = await flow.db.team_squads.find_one({"id": winner["squad_id"]}, {"_id": 0})
    player = await flow.db.users.find_one({"id": squad["member_ids"][0]}, {"_id": 0})
    await flow.db.users.update_one({"id": player["id"]}, {"$set": {"privacy_public_profile": True}})
    profile = ok(await flow.get(f"/api/users/public/{player['username']}"))
    assert [(row["season_name"], row["division_label"], row["rank"], row["champion"]) for row in profile["league_history"]] == [
        ("Season 1", "Liga 1", 1, True)]
    # Gegenprobe: Wer nicht im Kader war, hat keine Season.
    outsider = await flow.add_user(name="Zaungast")
    await flow.db.users.update_one({"id": outsider["id"]}, {"$set": {"privacy_public_profile": True}})
    assert ok(await flow.get(f"/api/users/public/{outsider['username']}"))["league_history"] == []


@pytest.mark.asyncio
async def test_tv_shows_the_zones_with_key_and_for_staff(flow):
    world = await build(flow, levels=2, teams=4)
    tid = world["tids"][1]
    flow.act_as(world["lead"])
    staff = ok(await flow.get(f"/api/tournaments/{tid}/bracket/display", params={"table": "1"}))
    assert [row.get("zone") for row in staff["standings"]] == ["promotion", None, None, None]
    key = ok(await flow.post("/api/tv/keys", json={"tournament_id": tid, "label": "Beamer Liga 2"}))["token"]
    flow.act_as(None)
    tv = ok(await flow.get(f"/api/tournaments/{tid}/bracket/display", params={"key": key, "table": "1"}))
    assert [row.get("zone") for row in tv["standings"]] == ["promotion", None, None, None]
    # Nur Platz, Name und Zahlen - nie Konto oder Team-Kennung.
    assert not any("team_id" in row or "user_id" in row for row in tv["standings"])


@pytest.mark.asyncio
async def test_archived_middle_division_and_several_staffeln_of_unequal_size(flow):
    """Liga 2 hat zwei Staffeln (4 und 3 Teams) und wird nach dem Abschluss archiviert: Ihre Aufsteiger gehen in Liga 1, die anderen in
    die nächste aktive darunter (Liga 3), die Absteiger aus Liga 1 ebenso - niemand rutscht um zwei Stufen (Liga 4)."""
    world = await build(flow, levels=4, extra={2: [3]})
    await close_all(flow, world)
    flow.act_as(world["lead"])
    ok(await flow.patch(f"{ADMIN}/divisions/{world['divisions'][1]['id']}", json={"status": "archived"}))
    preview = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/successor"))
    where = {team["squad_id"]: (row["level"], team["movement"]) for row in preview["divisions"] for team in row["teams"]}
    assert [row["level"] for row in preview["divisions"]] == [1, 3, 4]
    small = world["more"][2][0]["regs"]
    # Je Staffel ein Aufsteiger: zwei aus Liga 2 nach oben.
    assert where[squad_of(world, 2, 0)] == (1, "up") and where[small[0]["squad_id"]] == (1, "up")
    # Liga 2 gibt es nicht mehr: die Mitte und die Absteiger beider Staffeln in Liga 3, nicht in Liga 4.
    for squad in (squad_of(world, 2, 1), squad_of(world, 2, 3), small[1]["squad_id"], small[2]["squad_id"]):
        assert where[squad] == (3, "down"), squad
    # Absteiger aus Liga 1 in die nächste aktive darunter, Aufsteiger aus Liga 3 nach Liga 1 (Ziel Liga 2 ist archiviert).
    assert where[squad_of(world, 1, 3)] == (3, "down")
    assert where[squad_of(world, 3, 0)] == (1, "up")
    assert where[squad_of(world, 3, 3)] == (4, "down") and where[squad_of(world, 4, 0)] == (3, "up")
    assert preview["carried"] == 4 + 4 + 3 + 4 + 4


# ---------------------------------------------------------------- Übernahme neu berechnen (Nr. 162)

async def second_lead(flow, world: dict) -> dict:
    user = await flow.add_user(name="Zweite Leitung")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": world["league"]["id"], "user_id": user["id"],
                                           "capabilities": ["season", "results", "manage"], "created_at": now_utc().isoformat()})
    return user


async def flip_top_two(flow, tid: str, regs: list[dict]) -> None:
    """Korrektur: Platz 2 hat das direkte Spiel gegen Platz 1 gewonnen - danach steht Platz 2 vorn."""
    duel = next(match for match in await flow.db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(None)
                if {slot["registration_id"] for slot in match["slots"]} == {regs[0]["id"], regs[1]["id"]})
    await flow.db.matches_v2.update_one({"id": duel["id"]}, {"$set": {"results": [
        {"registration_id": regs[1]["id"], "rank": 1, "score": 2}, {"registration_id": regs[0]["id"], "rank": 2, "score": 0}]}})


@pytest.mark.asyncio
async def test_recompute_after_reopen_correct_and_close_again(flow):
    world = await build(flow, levels=2, teams=4)
    await close_all(flow, world)
    season = await new_season(flow, world)
    rows = await carried(flow, season["id"])
    winner, runner_up, third = (squad_of(world, 2, index) for index in range(3))
    assert rows[winner]["carry_over"]["division_level"] == 1 and rows[runner_up]["carry_over"]["division_level"] == 2
    # Der Absteiger aus Liga 1 ist schon zugeteilt - er bleibt, wie er ist.
    flow.act_as(world["lead"])
    division_2 = await flow.db.league_divisions.find_one({"season_id": season["id"], "level": 2}, {"_id": 0})
    staffel = ok(await flow.post(f"{ADMIN}/divisions/{division_2['id']}/staffeln", json={}))
    relegated = rows[squad_of(world, 1, 3)]
    ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/applications/{relegated['id']}/assign", json={"tournament_id": staffel["tournament_id"]}))
    assigned = await flow.db.league_applications.find_one({"id": relegated["id"]}, {"_id": 0})
    # Nichts geändert: Die Vorschau hat nichts zu tun.
    preview = ok(await flow.get(f"{ADMIN}/seasons/{season['id']}/successor/recompute"))
    assert preview["can_run"] and preview["changes"] == [] and preview["manual"] == []

    # Wieder öffnen (zweite Person), korrigieren: Platz 2 schlägt Platz 1, Platz 3 wird disqualifiziert. Neu abschließen.
    tid = world["tids"][1]
    regs = world["regs"][2]
    flow.act_as(await second_lead(flow, world))
    ok(await flow.post(f"{STAFFELN}/{tid}/reopen", json={"reason": "Ergebnis vertauscht eingetragen"}))
    cockpit = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/closing"))
    assert cockpit["successor"]["id"] == season["id"]
    await flip_top_two(flow, tid, regs)
    await flow.db.tournament_registrations.update_one({"id": regs[2]["id"]}, {"$set": {"status": "disqualified",
                                                                                     "removal": {"at": LONG_AGO, "mode": "forfeit"}}})
    flow.act_as(world["lead"])
    ok(await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}))

    preview = ok(await flow.get(f"{ADMIN}/seasons/{season['id']}/successor/recompute"))
    kinds = {change["squad_id"]: change["kind"] for change in preview["changes"]}
    # Der Letzte rückt einen Platz vor (der Disqualifizierte steht hinten): gleiche Liga, nur der Platz ändert sich.
    assert kinds == {winner: "moved", runner_up: "moved", third: "revoked", squad_of(world, 2, 3): "updated"}
    assert preview["manual"] == []  # der zugeteilte Absteiger aus Liga 1 bleibt richtig in Liga 2
    done = ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/successor/recompute", json={"confirm": True, "stamp": preview["stamp"]}))
    assert done["moved"] == 2 and done["revoked"] == 1 and done["updated"] == 1
    after = await carried(flow, season["id"])
    assert after[runner_up]["carry_over"]["division_level"] == 1 and after[runner_up]["carry_over"]["movement"] == "up"
    assert after[winner]["carry_over"]["division_level"] == 2 and after[winner]["carry_over"]["movement"] == "stay"
    assert after[third]["status"] == "rejected" and after[third]["carry_over"]["revoked_at"] and "active_key" not in after[third]
    # Zugeteilt: unverändert.
    assert after[squad_of(world, 1, 3)] == assigned
    # Nachricht mit der Fassung im Schlüssel; ein zweiter Lauf ändert nichts und schickt nichts.
    keys = [row["meta"]["dedupe_key"] for row in await flow.db.notifications.find({"meta.reason": "league_successor"}, {"_id": 0}).to_list(None)]
    assert any(key.endswith(f":{preview['stamp']}:moved") for key in keys) and any(key.endswith(f":{preview['stamp']}:revoked") for key in keys)
    again = ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/successor/recompute", json={"confirm": True}))
    assert again["changed"] == 0 and again["notified"] == 0
    assert await flow.db.audit_logs.count_documents({"action": "league.season.successor.recompute"}) == 2
    # Veralteter Stand der Vorschau: 409.
    stale = await flow.post(f"{ADMIN}/seasons/{season['id']}/successor/recompute", json={"confirm": True, "stamp": "veraltet"})
    assert stale.status_code == 409


@pytest.mark.asyncio
async def test_recompute_lists_assigned_teams_for_a_manual_check_and_stops_after_the_start(flow):
    world = await build(flow, levels=2, teams=3)
    await close_all(flow, world)
    season = await new_season(flow, world)
    rows = await carried(flow, season["id"])
    winner = squad_of(world, 2, 0)
    flow.act_as(world["lead"])
    division_1 = await flow.db.league_divisions.find_one({"season_id": season["id"], "level": 1}, {"_id": 0})
    staffel = ok(await flow.post(f"{ADMIN}/divisions/{division_1['id']}/staffeln", json={}))
    ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/applications/{rows[winner]['id']}/assign", json={"tournament_id": staffel["tournament_id"]}))
    tid = world["tids"][1]
    flow.act_as(await second_lead(flow, world))
    ok(await flow.post(f"{STAFFELN}/{tid}/reopen", json={"reason": "Ergebnis vertauscht eingetragen"}))
    await flip_top_two(flow, tid, world["regs"][2])
    # Solange der Vorgänger offen ist, geht nichts.
    flow.act_as(world["lead"])
    blocked = ok(await flow.get(f"{ADMIN}/seasons/{season['id']}/successor/recompute"))
    assert not blocked["can_run"] and "nicht abgeschlossen" in blocked["problems"][0]
    ok(await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}))
    preview = ok(await flow.get(f"{ADMIN}/seasons/{season['id']}/successor/recompute"))
    assert [row["application_id"] for row in preview["manual"]] == [rows[winner]["id"]] and preview["manual"][0]["why"] == "zugeteilt"
    ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/successor/recompute", json={"confirm": True}))
    assert (await flow.db.league_applications.find_one({"id": rows[winner]["id"]}, {"_id": 0}))["carry_over"]["division_level"] == 1
    # Rechte: nur „Liga verwalten“. Nach dem Start: 409. An der alten Season gibt es nichts neu zu berechnen.
    only = await flow.add_user(name="Nur Ergebnisse")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": world["league"]["id"], "user_id": only["id"],
                                           "capabilities": ["results", "season"], "created_at": now_utc().isoformat()})
    flow.act_as(only)
    refused = await flow.post(f"{ADMIN}/seasons/{season['id']}/successor/recompute", json={"confirm": True})
    assert refused.status_code == 403
    flow.act_as(world["lead"])
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"status": "active", "start_date": (now_utc() - timedelta(days=1)).isoformat()}})
    late = await flow.post(f"{ADMIN}/seasons/{season['id']}/successor/recompute", json={"confirm": True})
    assert late.status_code == 409 and "begonnen" in late.json()["detail"]
    old = await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/successor/recompute")
    assert old.status_code == 404


# ---------------------------------------------------------------- Nachbesserung: Wiederholen, Nachrichten, Umzug

@pytest.mark.asyncio
async def test_replay_waits_for_a_closed_predecessor_and_sends_missing_messages(flow):
    world = await build(flow, levels=1, teams=3)
    await close_all(flow, world)
    season = await new_season(flow, world)
    # Nachricht: Die Season ist „Aus“ - nur der Weg unter Teams, kein Verweis auf die Ligaseite.
    body = (await flow.db.notifications.find_one({"meta.reason": "league_successor"}, {"_id": 0}))["body"]
    assert "unter Teams beim Co-Team." in body and "Ligaseite" not in body
    # Abgebrochenes Anlegen nachstellen: nicht fertig, eine Nachricht fehlt (ohne Merker).
    rows = await carried(flow, season["id"])
    missing = rows[squad_of(world, 1, 0)]
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$unset": {"successor_ready": ""}})
    await flow.db.league_applications.update_one({"id": missing["id"]}, {"$unset": {"carry_over.notified_at": ""}})
    await flow.db.notifications.delete_many({"meta.application_id": missing["id"]})
    assert all(row["carry_over"].get("notified_at") for key, row in rows.items() if key != missing["squad_id"])
    # Inzwischen wieder geöffnet: 409 mit Hinweis, die Season bleibt „nicht fertig“.
    flow.act_as(await second_lead(flow, world))
    ok(await flow.post(f"{STAFFELN}/{world['tids'][0]}/reopen", json={"reason": "Ergebnis vertauscht eingetragen"}))
    refused = await successor(flow, world)
    assert refused.status_code == 409 and "nicht mehr abgeschlossen" in refused.json()["detail"]
    assert not (await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})).get("successor_ready")
    # Wieder abgeschlossen: Das Wiederholen holt genau die fehlende Nachricht nach.
    flow.act_as(world["lead"])
    ok(await flow.post(f"{STAFFELN}/{world['tids'][0]}/close", json={"confirm": True}))
    again = ok(await successor(flow, world))
    assert again["replay"] and again["notified"] == 2  # Captain und Vertreter des einen Co-Teams
    assert (await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0}))["successor_ready"]
    assert (await flow.db.league_applications.find_one({"id": missing["id"]}, {"_id": 0}))["carry_over"]["notified_at"]


@pytest.mark.asyncio
async def test_co_team_that_moved_between_staffeln_appears_once_as_carried(flow):
    world = await build(flow, levels=1, teams=3, extra={1: [2]}, exits={(1, 1): "withdrawn"})
    moved = world["regs"][1][1]
    other = world["more"][1][0]["regs"][0]
    # Dasselbe Co-Team: in Staffel A ausgetreten, in Staffel B aktiv.
    await flow.db.tournament_registrations.update_one({"id": other["id"]}, {"$set": {"squad_id": moved["squad_id"], "team_id": moved["team_id"]}})
    await close_all(flow, world)
    preview = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/successor"))
    squads = [team["squad_id"] for row in preview["divisions"] for team in row["teams"]]
    assert squads.count(moved["squad_id"]) == 1
    assert moved["id"] not in [row["registration_id"] for row in preview["dropped"]]


@pytest.mark.asyncio
async def test_carried_team_goes_into_its_own_division_other_only_with_reason(flow):
    world = await build(flow, levels=2, teams=2)
    await close_all(flow, world)
    season = await new_season(flow, world)
    rows = await carried(flow, season["id"])
    climber = rows[squad_of(world, 2, 0)]  # Aufsteiger: Liga 1
    flow.act_as(world["lead"])
    division_2 = await flow.db.league_divisions.find_one({"season_id": season["id"], "level": 2}, {"_id": 0})
    other = ok(await flow.post(f"{ADMIN}/divisions/{division_2['id']}/staffeln", json={}))
    url = f"{ADMIN}/seasons/{season['id']}/applications/{climber['id']}/assign"
    refused = await flow.post(url, json={"tournament_id": other["tournament_id"]})
    assert refused.status_code == 422 and "Liga 1" in refused.json()["detail"]
    assert "assignment" not in await flow.db.league_applications.find_one({"id": climber["id"]}, {"_id": 0})
    done = ok(await flow.post(url, json={"tournament_id": other["tournament_id"], "deviation_reason": "Liga 1 ist voll, Absprache mit dem Team"}))
    assert done["status"] == "accepted"
    stored = await flow.db.league_applications.find_one({"id": climber["id"]}, {"_id": 0})
    assert stored["assignment"]["deviation_reason"] == "Liga 1 ist voll, Absprache mit dem Team"


@pytest.mark.asyncio
async def test_withdraw_under_teams_only_for_carried_applications(flow):
    world = await build(flow, levels=1, teams=2)
    await close_all(flow, world)
    season = await new_season(flow, world)
    rows = await carried(flow, season["id"])
    application = rows[squad_of(world, 1, 0)]
    squad = await flow.db.team_squads.find_one({"id": application["squad_id"]}, {"_id": 0})
    # Ein gewöhnlicher Antrag (ohne Übernahme): der Weg unter Teams kennt ihn nicht.
    await flow.db.league_applications.update_one({"id": application["id"]}, {"$unset": {"carry_over": ""}})
    flow.act_as(await flow.db.users.find_one({"id": squad["captain_id"]}, {"_id": 0}))
    refused = await flow.post(f"/api/me/league-applications/{application['id']}/withdraw")
    assert refused.status_code == 404
    assert (await flow.db.league_applications.find_one({"id": application["id"]}, {"_id": 0}))["status"] == "accepted"


@pytest.mark.asyncio
async def test_season_history_visibility_for_guests_off_seasons_and_hidden_staffeln(flow):
    world = await build(flow, levels=1, teams=4, exits={(1, 3): "withdrawn"})
    await close_all(flow, world)
    winner = world["regs"][1][0]
    tid = world["tids"][0]
    await flow.db.league_seasons.update_one({"id": world["season"]["id"]}, {"$set": {"visibility": "public"}})
    await flow.db.tournaments.update_one({"id": tid}, {"$set": {"visibility": "public", "is_public": True}})
    flow.act_as(None)
    guest = ok(await flow.get(f"/api/teams/{winner['team_id']}"))
    # Von wie vielen: ohne das ausgetretene Team.
    assert [(row["rank"], row["of"], row["champion"]) for row in guest["league_history"]] == [(1, 3, True)]
    # Staffel intern (Turnierseite verborgen): Gäste sehen den Eintrag nicht, die Leitung schon.
    await flow.db.tournaments.update_one({"id": tid}, {"$set": {"visibility": "internal", "is_public": False}})
    assert ok(await flow.get(f"/api/teams/{winner['team_id']}"))["league_history"] == []
    flow.act_as(world["lead"])
    assert len(ok(await flow.get(f"/api/teams/{winner['team_id']}"))["league_history"]) == 1
    # Season „Aus“: Gäste sehen nichts, auch wenn die Staffel öffentlich wäre.
    await flow.db.tournaments.update_one({"id": tid}, {"$set": {"visibility": "public", "is_public": True}})
    await flow.db.league_seasons.update_one({"id": world["season"]["id"]}, {"$set": {"visibility": "off"}})
    flow.act_as(None)
    assert ok(await flow.get(f"/api/teams/{winner['team_id']}"))["league_history"] == []
    squad = await flow.db.team_squads.find_one({"id": winner["squad_id"]}, {"_id": 0})
    player = await flow.db.users.find_one({"id": squad["member_ids"][0]}, {"_id": 0})
    await flow.db.users.update_one({"id": player["id"]}, {"$set": {"privacy_public_profile": True}})
    assert ok(await flow.get(f"/api/users/public/{player['username']}"))["league_history"] == []
    await flow.db.league_seasons.update_one({"id": world["season"]["id"]}, {"$set": {"visibility": "public"}})
    assert len(ok(await flow.get(f"/api/users/public/{player['username']}"))["league_history"]) == 1
