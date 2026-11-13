"""F.5 Gesamtwertung über Seasons (#2215, docs/LIGA.md „F.5 Gesamtwertung über Seasons“, Nr. 170 bis 173) über die echten Routen:
Punkte nach Teamzahl mit Meister-Bonus, geteilter Platz und Ausgeschiedene, mehrere Staffeln, beste X mit Streichergebnis, Spielerwertung
mit Einsatz, Kader-Rückfall und Teamwechsel, Auf- und Abstieg, wieder geöffnete Season, Abschluss mit zweiter Person und Befangenheit,
Belohnungen auf Liga-Ebene ohne Doppel, Sichtbarkeit für Gäste, Rechte und gleichzeitiger Abschluss - jede Regel mit Gegenprobe.
Nur erfundene Namen.
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
from models import now_utc  # noqa: E402

ADMIN = "/api/admin/leagues"
STAFFELN = "/api/admin/leagues/staffeln"
SEASON = {"start_date": "2026-01-05T00:00:00", "visibility": "public", "readiness_override_reason": "Testaufbau ohne Prüfung"}
LONG_AGO = (now_utc() - timedelta(days=90)).isoformat()
GOLD = {"kind": "medal", "name": "Gesamtsieg", "places": {"mode": "rank", "rank": 1}, "recipients": ["team", "players"]}
EVERYONE = {"kind": "banner", "name": "Gesamtwertungs-Banner", "places": {"mode": "all"}, "recipients": ["players"]}


@pytest_asyncio.fixture
async def flow():
    from services import league_overall

    league_overall.forget_extracts()
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def ok(response, code: int = 200):
    assert response.status_code == code, response.text
    return response.json()


# ---------------------------------------------------------------- Aufbau

async def setup(flow) -> dict:
    admin = await flow.add_staff()
    flow.act_as(admin)
    game = ok(await flow.post("/api/games", json={"name": "Probe Shooter", "slug": "probe-shooter"}))
    league = ok(await flow.post(ADMIN, json={"name": "Probe-Liga", "game_id": game["id"]}))
    return {"admin": admin, "league": league, "seasons": [], "divisions": {}}


async def add_season(flow, world: dict, levels: int = 1, **season) -> dict:
    flow.act_as(world["admin"])
    row = ok(await flow.post(f"{ADMIN}/{world['league']['id']}/seasons", json={**SEASON, **season}))
    world["seasons"].append(row)
    world["divisions"][row["id"]] = [ok(await flow.post(f"{ADMIN}/seasons/{row['id']}/divisions", json={})) for _ in range(levels)]
    return row


async def team(flow, index: int) -> None:
    """Hauptteam ``team-<n>`` mit Co-Team ``squad-<n>``: Captain und drei Spieler ``p-<n>-1..3`` - nur einmal angelegt."""
    if await flow.db.teams.find_one({"id": f"team-{index}"}, {"_id": 1}):
        return
    people = [f"p-{index}-{number}" for number in (1, 2, 3)]
    for person in [f"captain-{index}", *people]:
        await flow.db.users.insert_one({"id": person, "username": person, "display_name": person.title(), "role": "user", "is_active": True,
                                        "email": f"{person}@example.test", "privacy_public_profile": True})
    await flow.db.teams.insert_one({"id": f"team-{index}", "name": f"Probe {index}", "leader_id": f"captain-{index}",
                                    "member_ids": [f"captain-{index}", *people]})
    await flow.db.team_squads.insert_one({"id": f"squad-{index}", "team_id": f"team-{index}", "name": f"Kader {index}", "status": "active",
                                          "member_ids": people})


async def staffel(flow, world: dict, season: dict, level: int, teams: list[int], *, start: bool = True) -> dict:
    flow.act_as(world["admin"])
    division = world["divisions"][season["id"]][level - 1]
    created = ok(await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={}))
    tournament = await flow.db.tournaments.find_one({"id": created["tournament_id"]}, {"_id": 0})
    for index in teams:
        await team(flow, index)
        await flow.db.tournament_registrations.insert_one({
            "id": f"{tournament['id']}-reg-{index}", "tournament_id": tournament["id"], "team_id": f"team-{index}",
            "squad_id": f"squad-{index}", "status": "approved", "registration_type": "team", "display_name": f"Probe {index}",
            "identity_key": f"{tournament['id']}:team:team-{index}"})
    if start:
        ok(await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "live"}))
    return tournament


def number(registration_id: str) -> int:
    return int(registration_id.rsplit("-", 1)[1])


async def play(flow, tournament: dict, order: list[int], lineups=None) -> None:
    """Jedes Spiel gewertet: Wer in ``order`` weiter vorn steht, gewinnt - die Tabelle steht in dieser Reihenfolge. In der Aufstellung
    die Spieler 1 und 2 (``lineups``: je Team eine eigene Liste, ``[]`` heißt keine Aufstellung gemeldet)."""
    strength = {index: at for at, index in enumerate(order)}
    lineups = lineups or {}
    for match in await flow.db.matches_v2.find({"tournament_id": tournament["id"], "is_preview": {"$ne": True}}, {"_id": 0}).to_list(None):
        sides = [slot["registration_id"] for slot in match.get("slots") or [] if slot.get("registration_id")]
        if len(sides) != 2:
            continue
        winner, loser = sorted(sides, key=lambda side: strength[number(side)])
        played = {side: lineups.get(number(side), [f"p-{number(side)}-1", f"p-{number(side)}-2"]) for side in sides}
        await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {
            "status": "completed", "completed_at": LONG_AGO, "lineups": {key: value for key, value in played.items() if value},
            "results": [{"registration_id": winner, "rank": 1, "score": 2}, {"registration_id": loser, "rank": 2, "score": 0}]}})


async def close_staffel(flow, world: dict, tournament: dict) -> None:
    flow.act_as(world["admin"])
    ok(await flow.post(f"{STAFFELN}/{tournament['id']}/close", json={"confirm": True}))


async def played_staffel(flow, world, season, level, order, lineups=None, close=True):
    tournament = await staffel(flow, world, season, level, sorted(order))
    await play(flow, tournament, order, lineups)
    if close:
        await close_staffel(flow, world, tournament)
    return tournament


async def configure(flow, world: dict, *, periods=None, **settings) -> dict:
    flow.act_as(world["admin"])
    periods = periods if periods is not None else [{"id": (world.get("period") or {}).get("id"), "name": "Jahr 2027",
                                                    "season_ids": [row["id"] for row in world["seasons"]]}]
    body = ok(await flow.put(f"{ADMIN}/{world['league']['id']}/overall", json={**settings, "periods": periods}))
    world["period"] = body["periods"][0]
    return body


def page(world: dict, season: dict | None = None) -> str:
    season = season or world["seasons"][-1]
    return f"/api/leagues/{world['league']['slug']}/{season['slug']}/overall"


async def public(flow, world: dict, *, user=None, season=None) -> dict:
    flow.act_as(user)
    return ok(await flow.get(page(world, season)))


def level_of(view: dict, level: int = 1) -> dict:
    return next(row for row in view["levels"] if row["level"] == level)


def totals(block: dict, what: str = "teams") -> list[tuple[str, int, int]]:
    return [(row["name"], row["place"], row["total"]) for row in block[what]]


def cockpit_url(world: dict) -> str:
    return f"{ADMIN}/{world['league']['id']}/overall/{world['period']['id']}"


async def lead(flow, world: dict, name: str, *capabilities: str) -> dict:
    user = await flow.add_user(name=name)
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": world["league"]["id"], "user_id": user["id"],
                                           "capabilities": list(capabilities), "created_at": now_utc().isoformat()})
    return user


async def two_seasons(flow, second=(2, 1, 3, 4)) -> dict:
    world = await setup(flow)
    first = await add_season(flow, world)
    world["s1"] = await played_staffel(flow, world, first, 1, [1, 2, 3, 4])
    other = await add_season(flow, world)
    world["s2"] = await played_staffel(flow, world, other, 1, list(second))
    return world


# ---------------------------------------------------------------- Punkte, Bonus, Summe

@pytest.mark.asyncio
async def test_points_by_team_count_with_champion_bonus_summed_over_seasons(flow):
    world = await two_seasons(flow)
    await configure(flow, world)
    block = level_of(await public(flow, world))
    # S1: 6, 3, 2, 1 (Meister + 2). S2: Probe 2 gewinnt. Gleich 9 Punkte: je ein Sieg, beste Platzierung 1 - die jüngste Season entscheidet.
    assert totals(block) == [("Probe 2", 1, 9), ("Probe 1", 2, 9), ("Probe 3", 3, 4), ("Probe 4", 4, 2)]
    first = block["teams"][0]
    assert [cell["points"] for cell in first["seasons"]] == [3, 6] and first["seasons"][1]["champion"] is True
    # Aufsteiger in der Wertung: Probe 2 war ohne die jüngste Season Zweiter.
    assert first["climbed"] is True and block["teams"][1]["climbed"] is False
    assert block["closed"] is False and [row["name"] for row in (await public(flow, world))["seasons"]] == ["Season 1", "Season 2"]
    # Gegenprobe: eigene Punkte je Platz statt nach Teamzahl.
    await configure(flow, world, points_mode="table", points_table=[10, 5], champion_bonus=0)
    assert totals(level_of(await public(flow, world)))[:2] == [("Probe 2", 1, 15), ("Probe 1", 2, 15)]


@pytest.mark.asyncio
async def test_shared_place_and_exited_teams(flow):
    world = await setup(flow)
    season = await add_season(flow, world)
    tournament = await staffel(flow, world, season, 1, [1, 2, 3, 4, 5])
    await play(flow, tournament, [1, 2, 3, 4, 5])
    # Team 5 tritt aus - 0 Punkte, die übrigen zählen als vier Teams.
    await flow.db.tournament_registrations.update_one({"id": f"{tournament['id']}-reg-5"}, {"$set": {"status": "withdrawn", "withdrawn_at": LONG_AGO}})
    await close_staffel(flow, world, tournament)
    final = await flow.db.league_final_tables.find_one({"tournament_id": tournament["id"], "active": True}, {"_id": 0})
    assert any(row.get("exit") for row in final["rows"])
    # Geteilter Platz im Endstand (z. B. nach Entscheid in einer unteren Liga N): Platz 2 zweimal.
    rows = [{**row, "rank": 2} if row.get("display_name") == "Probe 3" else row for row in final["rows"]]
    await flow.db.league_final_tables.update_one({"id": final["id"]}, {"$set": {"rows": rows}})
    await configure(flow, world)
    block = level_of(await public(flow, world))
    points = {row["name"]: row["total"] for row in block["teams"]}
    assert points == {"Probe 1": 6, "Probe 2": 3, "Probe 3": 3, "Probe 4": 1, "Probe 5": 0}
    shared = [row for row in block["teams"] if row["name"] in ("Probe 2", "Probe 3")]
    assert {row["place"] for row in shared} == {2} and all(row["tie"] for row in shared)
    out = next(row for row in block["teams"] if row["name"] == "Probe 5")
    assert out["seasons"][0]["exit"] and out["seasons"][0]["points"] == 0
    # Gegenprobe: N ohne den Ausgetretenen - der Letzte in der Wertung hat 1, nicht 2.
    assert points["Probe 4"] == 1


@pytest.mark.asyncio
async def test_several_staffeln_count_n_per_staffel(flow):
    world = await setup(flow)
    season = await add_season(flow, world)
    await played_staffel(flow, world, season, 1, [1, 2, 3, 4])
    await played_staffel(flow, world, season, 1, [5, 6, 7])
    await configure(flow, world)
    points = {row["name"]: row["total"] for row in level_of(await public(flow, world))["teams"]}
    # Staffel A: 4 Teams → 4 + 2; Staffel B: 3 Teams → 3 + 2. Je Staffel der Letzte 1.
    assert points["Probe 1"] == 6 and points["Probe 5"] == 5
    assert points["Probe 4"] == 1 and points["Probe 7"] == 1


@pytest.mark.asyncio
async def test_best_x_seasons_and_dropped_result(flow):
    world = await two_seasons(flow, second=(2, 3, 4, 1))
    await configure(flow, world, counting="best", best_count=1)
    block = level_of(await public(flow, world))
    one = next(row for row in block["teams"] if row["name"] == "Probe 1")
    # S1: 6 (zählt), S2: Letzter mit 1 - Streichergebnis.
    assert one["total"] == 6 and [cell["counted"] for cell in one["seasons"]] == [True, False]
    # Probe 2 hat mit S2 ebenfalls 6 als beste Season - gleich, die jüngste Season entscheidet für Probe 2.
    assert [row["name"] for row in block["teams"][:2]] == ["Probe 2", "Probe 1"]
    # Gegenprobe: mit allen Seasons zählt auch die 1.
    await configure(flow, world, counting="all")
    assert next(row for row in level_of(await public(flow, world))["teams"] if row["name"] == "Probe 1")["total"] == 7


# ---------------------------------------------------------------- Spielerwertung (Nr. 172)

@pytest.mark.asyncio
async def test_player_standing_with_fielding_roster_fallback_and_team_change(flow):
    world = await setup(flow)
    first = await add_season(flow, world)
    # Team 4 meldet nie eine Aufstellung - sein Kader zählt (Nr. 167).
    await played_staffel(flow, world, first, 1, [1, 2, 3, 4], lineups={4: []})
    second = await add_season(flow, world)
    # p-2-2 wechselt in Season 2 zu Team 1 und spielt dort.
    await played_staffel(flow, world, second, 1, [1, 2, 3, 4], lineups={1: ["p-1-1", "p-2-2"], 2: ["p-2-1", "p-2-3"], 4: []})
    await configure(flow, world)
    block = level_of(await public(flow, world))
    players = {row["name"]: row for row in block["players"]}
    # Einsatz: p-1-1 zweimal Erster (6 + 6); p-1-3 saß nur auf der Bank - steht nicht in der Wertung.
    assert players["P-1-1"]["total"] == 12 and "P-1-3" not in players
    # Teamwechsel: S1 die Punkte von Team 2 (3), S2 die von Team 1 (6).
    assert [cell["points"] for cell in players["P-2-2"]["seasons"]] == [3, 6] and players["P-2-2"]["total"] == 9
    assert players["P-2-2"]["seasons"][1]["co_team_name"] == "Probe 1"
    # Kader-Rückfall: alle drei aus dem Kader von Team 4 bekommen je 1.
    assert {name for name in players if name.startswith("P-4-")} == {"P-4-1", "P-4-2", "P-4-3"}
    assert players["P-4-3"]["total"] == 2
    # Privates Profil: Platz bleibt, Name nicht.
    await flow.db.users.update_one({"id": "p-1-1"}, {"$set": {"privacy_public_profile": False}})
    hidden = level_of(await public(flow, world))["players"][0]
    assert hidden["name"] == "Spieler mit privatem Profil" and hidden["key"] is None and hidden["place"] == 1


# ---------------------------------------------------------------- Auf- und Abstieg (Nr. 170)

@pytest.mark.asyncio
async def test_promoted_and_relegated_teams_score_in_the_level_they_played(flow):
    world = await setup(flow)
    first = await add_season(flow, world, levels=2)
    await played_staffel(flow, world, first, 1, [1, 2, 3, 4])
    await played_staffel(flow, world, first, 2, [5, 6, 7, 8])
    second = await add_season(flow, world, levels=2)
    # Team 4 steigt ab, Team 5 steigt auf.
    await played_staffel(flow, world, second, 1, [5, 1, 2, 3])
    await played_staffel(flow, world, second, 2, [4, 6, 7, 8])
    await configure(flow, world)
    view = await public(flow, world)
    top = {row["name"]: [cell.get("points") for cell in row["seasons"]] for row in level_of(view, 1)["teams"]}
    low = {row["name"]: [cell.get("points") for cell in row["seasons"]] for row in level_of(view, 2)["teams"]}
    assert top["Probe 5"] == [None, 6] and low["Probe 5"] == [6, None]
    assert top["Probe 4"] == [1, None] and low["Probe 4"] == [None, 6]
    # Keine Verrechnung zwischen Stufen: jede Wertung nur mit ihren Punkten.
    assert next(row for row in level_of(view, 1)["teams"] if row["name"] == "Probe 5")["total"] == 6


# ---------------------------------------------------------------- Wieder geöffnete Season

@pytest.mark.asyncio
async def test_reopened_season_counts_again_only_after_the_new_close(flow):
    world = await two_seasons(flow)
    await configure(flow, world)
    flow.act_as(await lead(flow, world, "Zweite Leitung", "season"))
    ok(await flow.post(f"{STAFFELN}/{world['s2']['id']}/reopen", json={"reason": "Ergebnis war falsch eingetragen"}))
    block = level_of(await public(flow, world))
    assert totals(block)[0] == ("Probe 1", 1, 6) and all(not row["seasons"][1]["played"] for row in block["teams"])
    await close_staffel(flow, world, world["s2"])
    # Gegenprobe: nach dem neuen Abschluss zählt Season 2 wieder.
    assert totals(level_of(await public(flow, world)))[0] == ("Probe 2", 1, 9)


# ---------------------------------------------------------------- Abschluss (Nr. 173)

@pytest.mark.asyncio
async def test_close_freezes_reopen_needs_reason_and_second_person(flow):
    world = await two_seasons(flow)
    await configure(flow, world)
    flow.act_as(world["admin"])
    cockpit = ok(await flow.get(cockpit_url(world)))
    assert cockpit["levels"][0]["can_close"] is True and cockpit["levels"][0]["blockers"] == []
    closed = ok(await flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True}))
    assert closed["version"] == 1 and closed["leader"] == "Probe 2"
    again = await flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True})
    assert again.status_code == 409
    # Fest: Eine Änderung der Punkte ändert die abgeschlossene Wertung nicht.
    await configure(flow, world, points_mode="table", points_table=[1], champion_bonus=0)
    block = level_of(await public(flow, world))
    assert block["closed"] is True and totals(block)[0] == ("Probe 2", 1, 9)
    # Wiederöffnen: Grund Pflicht, nicht die Person, die abgeschlossen hat (Superadmin nur mit Notausnahme).
    flow.act_as(world["admin"])
    own = await flow.post(f"{cockpit_url(world)}/levels/1/reopen", json={"reason": "Korrektur nötig"})
    assert own.status_code == 403
    second = await lead(flow, world, "Zweite Leitung", "season")
    flow.act_as(second)
    short = await flow.post(f"{cockpit_url(world)}/levels/1/reopen", json={"reason": "x"})
    assert short.status_code == 422
    ok(await flow.post(f"{cockpit_url(world)}/levels/1/reopen", json={"reason": "Korrektur nötig"}))
    # Danach rechnet sie wieder - mit den neuen Punkten.
    assert level_of(await public(flow, world))["closed"] is False
    assert level_of(await public(flow, world))["teams"][0]["total"] == 1
    flow.act_as(world["admin"])
    history = ok(await flow.get(cockpit_url(world)))["levels"][0]["history"]
    assert [(row["version"], row["active"], row["reopen_reason"]) for row in history] == [(1, False, "Korrektur nötig")]
    emergency = await flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True})
    assert emergency.status_code == 200 and emergency.json()["version"] == 2


@pytest.mark.asyncio
async def test_open_season_and_tie_on_top_block_the_close_until_decided(flow):
    world = await setup(flow)
    first = await add_season(flow, world)
    await played_staffel(flow, world, first, 1, [1, 2, 3, 4])
    second = await add_season(flow, world)
    open_staffel = await played_staffel(flow, world, second, 1, [2, 1, 4, 3], close=False)
    await configure(flow, world, tiebreakers=[])
    flow.act_as(world["admin"])
    blocked = await flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True})
    assert blocked.status_code == 409 and "Season nicht abgeschlossen" in blocked.json()["detail"]
    await close_staffel(flow, world, open_staffel)
    # Probe 1 und Probe 2 je 9 Punkte, ohne Kriterien: Gleichstand auf Platz 1.
    tie = await flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True})
    assert tie.status_code == 409 and "Gleichstand auf Platz 1" in tie.json()["detail"]
    cockpit = ok(await flow.get(cockpit_url(world)))["levels"][0]
    keys = cockpit["ties"][0]["keys"]
    wrong = await flow.put(f"{cockpit_url(world)}/levels/1/decision", json={"keys": [keys[0], "squad:squad-3"], "reason": "Los gezogen",
                                                                              "method": "lot"})
    assert wrong.status_code == 422
    no_method = await flow.put(f"{cockpit_url(world)}/levels/1/decision", json={"keys": list(reversed(keys)), "reason": "Los gezogen"})
    assert no_method.status_code == 422
    ok(await flow.put(f"{cockpit_url(world)}/levels/1/decision", json={"keys": list(reversed(keys)), "reason": "Los gezogen", "method": "lot"}))
    block = level_of(await public(flow, world))
    assert [row["place"] for row in block["teams"][:2]] == [1, 2] and block["teams"][0]["lead_decision"]["method"] == "lot"
    flow.act_as(world["admin"])
    ok(await flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True}))
    final = await flow.db.league_overall_finals.find_one({"active": True}, {"_id": 0})
    assert len(final["decisions"]) == 1 and final["teams"][0]["key"] == keys[-1]


@pytest.mark.asyncio
async def test_conflict_of_interest_blocks_close_superadmin_needs_reason(flow):
    world = await two_seasons(flow)
    await configure(flow, world)
    captain = await lead(flow, world, "Captain mit Amt", "season")
    await flow.db.team_squads.update_one({"id": "squad-3"}, {"$set": {"captain_id": captain["id"]}})
    flow.act_as(captain)
    refused = await flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True})
    assert refused.status_code == 403
    assert ok(await flow.get(cockpit_url(world)))["levels"][0]["own_team"] is True
    # Superadmin im Kader: nur als Notausnahme mit Grund.
    await flow.db.team_squads.update_one({"id": "squad-4"}, {"$set": {"member_ids": ["p-4-1", world["admin"]["id"]]}})
    flow.act_as(world["admin"])
    no_reason = await flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True})
    assert no_reason.status_code == 403
    ok(await flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True, "conflict_reason": "Niemand sonst erreichbar"}))
    assert await flow.db.audit_logs.count_documents({"action": "league.conflict.override", "data.action": "overall_close"}) == 1


@pytest.mark.asyncio
async def test_concurrent_close_gives_one_version(flow):
    world = await two_seasons(flow)
    await configure(flow, world)
    flow.act_as(world["admin"])
    first, second = await asyncio.gather(flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True}),
                                         flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True}))
    assert sorted([first.status_code, second.status_code]) == [200, 409]
    assert await flow.db.league_overall_finals.count_documents({"active": True}) == 1


# ---------------------------------------------------------------- Belohnungen auf Liga-Ebene

@pytest.mark.asyncio
async def test_league_rewards_on_close_rest_on_reopen_and_never_double(flow):
    world = await two_seasons(flow)
    await configure(flow, world, rewards=[GOLD, EVERYONE])
    flow.act_as(world["admin"])
    ok(await flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True}))
    scope = f"overall:{world['period']['id']}:1"
    docs = await flow.db.tournament_awards.find({"tournament_id": scope}, {"_id": 0}).to_list(50)
    gold = [doc for doc in docs if doc["reward"]["name"] == "Gesamtsieg"]
    assert [(doc["registration_id"], doc["team_id"], sorted(doc["player_ids"])) for doc in gold] == [("squad:squad-2", "team-2", ["p-2-1", "p-2-2"])]
    assert {doc["registration_id"] for doc in docs if doc["reward"]["name"] == "Gesamtwertungs-Banner"} == {f"squad:squad-{n}" for n in (1, 2, 3, 4)}
    assert gold[0]["reward"]["art"]["season"] == "Gesamtwertung Jahr 2027" and gold[0]["overall"]["level"] == 1
    sent = await flow.db.notifications.count_documents({"kind": "league_reward"})
    assert sent > 0
    # Profil: die Belohnung steht in der Sammlung; öffentlich, weil die Seasons öffentlich sind.
    flow.act_as(None)
    profile = ok(await flow.get("/api/users/public/p-2-1"))
    assert "Gesamtsieg" in {row["reward"]["name"] for row in profile["awards"] if row.get("reward")}
    assert profile["league_overall"][0]["place"] == 1
    # Wieder öffnen: ruht - neu abschließen: dieselben Einträge, keine Doppel, keine neue Nachricht.
    ids = sorted(doc["id"] for doc in docs)
    flow.act_as(await lead(flow, world, "Zweite Leitung", "season"))
    ok(await flow.post(f"{cockpit_url(world)}/levels/1/reopen", json={"reason": "Belohnung prüfen"}))
    assert await flow.db.tournament_awards.count_documents({"tournament_id": scope, "suspended": True}) == len(ids)
    flow.act_as(None)
    assert "Gesamtsieg" not in {row["reward"]["name"] for row in ok(await flow.get("/api/users/public/p-2-1"))["awards"] if row.get("reward")}
    flow.act_as(world["admin"])
    ok(await flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True}))
    again = await flow.db.tournament_awards.find({"tournament_id": scope}, {"_id": 0}).to_list(50)
    assert sorted(doc["id"] for doc in again) == ids and not any(doc["suspended"] for doc in again)
    assert await flow.db.notifications.count_documents({"kind": "league_reward"}) == sent


# ---------------------------------------------------------------- Sichtbarkeit, Rechte, Altdaten

@pytest.mark.asyncio
async def test_guests_see_only_public_seasons_lead_sees_all(flow):
    world = await two_seasons(flow)
    await configure(flow, world)
    flow.act_as(world["admin"])
    ok(await flow.patch(f"{ADMIN}/seasons/{world['seasons'][1]['id']}", json={"visibility": "off"}))
    view = await public(flow, world, season=world["seasons"][0])
    assert [row["name"] for row in view["seasons"]] == ["Season 1"]
    assert totals(level_of(view))[0] == ("Probe 1", 1, 6)
    flow.act_as(world["admin"])
    cockpit = ok(await flow.get(cockpit_url(world)))
    assert len(cockpit["seasons"]) == 2 and cockpit["levels"][0]["teams"][0]["total"] == 9
    # Auch abgeschlossen: Gäste sehen die Fassung ohne die unsichtbare Season.
    ok(await flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True}))
    closed = level_of(await public(flow, world, season=world["seasons"][0]))
    assert closed["closed"] is True and totals(closed)[0] == ("Probe 1", 1, 6)
    # Gegenprobe: wieder öffentlich - die ganze Fassung.
    flow.act_as(world["admin"])
    ok(await flow.patch(f"{ADMIN}/seasons/{world['seasons'][1]['id']}", json={"visibility": "public", "readiness_override_reason": "Testaufbau"}))
    assert totals(level_of(await public(flow, world)))[0] == ("Probe 2", 1, 9)


@pytest.mark.asyncio
async def test_rights_for_settings_close_and_reading(flow):
    world = await two_seasons(flow)
    await configure(flow, world)
    results_only = await lead(flow, world, "Nur Ergebnisse", "results")
    flow.act_as(results_only)
    assert (await flow.get(cockpit_url(world))).status_code == 200
    cockpit = ok(await flow.get(cockpit_url(world)))
    assert cockpit["can_act"] is False and cockpit["levels"][0]["can_close"] is False
    saving = await flow.put(f"{ADMIN}/{world['league']['id']}/overall", json={"counting": "all"})
    assert saving.status_code == 403
    closing = await flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True})
    assert closing.status_code == 403
    flow.act_as(await flow.add_user(name="Fremde Person"))
    assert (await flow.get(cockpit_url(world))).status_code == 403
    flow.act_as(None)
    assert (await flow.get(cockpit_url(world))).status_code == 401
    # Gegenprobe: „Season konfigurieren“ darf.
    flow.act_as(await lead(flow, world, "Season-Leitung", "season"))
    assert (await flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True})).status_code == 200


@pytest.mark.asyncio
async def test_without_settings_there_is_no_overall_standing_and_periods_are_checked(flow):
    world = await two_seasons(flow)
    flow.act_as(None)
    assert (await flow.get(page(world))).status_code == 404
    season_view = ok(await flow.get(f"/api/leagues/{world['league']['slug']}/{world['seasons'][0]['slug']}"))
    assert season_view["overall"] is None
    flow.act_as(world["admin"])
    double = await flow.put(f"{ADMIN}/{world['league']['id']}/overall", json={"periods": [
        {"name": "A", "season_ids": [world["seasons"][0]["id"]]}, {"name": "B", "season_ids": [world["seasons"][0]["id"]]}]})
    assert double.status_code == 422
    await configure(flow, world)
    season_view = ok(await flow.get(f"/api/leagues/{world['league']['slug']}/{world['seasons'][0]['slug']}"))
    assert season_view["overall"] == {"period_id": world["period"]["id"], "name": "Jahr 2027"}
    ok(await flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True}))
    locked = await flow.put(f"{ADMIN}/{world['league']['id']}/overall", json={"periods": []})
    assert locked.status_code == 409
    # Teamseite: Platz in der Gesamtwertung.
    flow.act_as(None)
    team_view = ok(await flow.get("/api/teams/team-2"))
    assert team_view["league_overall"][0]["place"] == 1 and team_view["league_overall"][0]["closed"] is True
    pdf = await flow.get(f"{page(world)}.pdf?level=1")
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"


# ---------------------------------------------------------------- Nachbesserung Runde 1

@pytest.mark.asyncio
async def test_roster_fallback_uses_the_roster_at_close(flow):
    world = await setup(flow)
    season = await add_season(flow, world)
    await played_staffel(flow, world, season, 1, [1, 2, 3, 4], lineups={4: []})
    # Nach dem Abschluss wechselt der Kader von Team 4: p-4-3 geht, eine neue Person kommt.
    await flow.db.team_squads.update_one({"id": "squad-4"}, {"$set": {"member_ids": ["p-4-1", "p-4-2", "p-neu"]}})
    await configure(flow, world)
    names = {row["key"] for row in level_of(await public(flow, world, user=world["admin"]))["players"]}
    assert {"p-4-1", "p-4-2", "p-4-3"} <= names and "p-neu" not in names
    # Profil und Wertung stimmen überein: p-4-3 sieht seinen Platz, p-neu keinen.
    flow.act_as(None)
    assert ok(await flow.get("/api/users/public/p-4-3"))["league_overall"][0]["points"] == 1


@pytest.mark.asyncio
async def test_player_reward_needs_a_counted_season_with_points_for_that_co_team(flow):
    world = await setup(flow)
    first = await add_season(flow, world)
    await played_staffel(flow, world, first, 1, [1, 2, 3, 4])
    second = await add_season(flow, world)
    # p-2-2 spielt in Season 2 für Team 1 - dort ist Season 2 Streichergebnis; für Team 2 spielt er nur in dessen Streichergebnis.
    await played_staffel(flow, world, second, 1, [2, 1, 3, 4], lineups={1: ["p-1-1", "p-2-2"], 2: ["p-2-1", "p-2-3"]})
    await configure(flow, world, counting="best", best_count=1, rewards=[EVERYONE])
    flow.act_as(world["admin"])
    ok(await flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True}))
    docs = {doc["registration_id"]: doc for doc in await flow.db.tournament_awards.find(
        {"tournament_id": f"overall:{world['period']['id']}:1"}, {"_id": 0}).to_list(50)}
    assert sorted(docs["squad:squad-1"]["player_ids"]) == ["p-1-1", "p-1-2"]
    assert sorted(docs["squad:squad-2"]["player_ids"]) == ["p-2-1", "p-2-3"]
    assert all("p-2-2" not in doc["player_ids"] for doc in docs.values())


@pytest.mark.asyncio
async def test_closed_standing_shows_the_counting_rule_of_its_version(flow):
    world = await two_seasons(flow)
    await configure(flow, world, counting="best", best_count=1)
    flow.act_as(world["admin"])
    ok(await flow.post(f"{cockpit_url(world)}/levels/1/close", json={"confirm": True}))
    await configure(flow, world, counting="all")
    view = await public(flow, world)
    assert level_of(view)["settings"]["counting"] == "best" and level_of(view)["settings"]["best_count"] == 1
    # Gegenprobe: die Einstellung von heute steht oben für laufende Wertungen.
    assert view["settings"]["counting"] == "all"
