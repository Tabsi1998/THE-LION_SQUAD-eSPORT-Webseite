"""Liga Stufe 1 - der ganze Weg in einem Durchlauf (docs/LIGA.md, P6, #2096). Erfundene Namen, keine echten Personen.

Über die echten Routen, wie Turnierleitung, Teamleitung und Captains sie im Browser benutzen: Spiel mit Map-Bibliothek,
Liga, Season 1 (Start Di 10.11.2026, 10 Wochen, Weihnachtspause 21.12.-3.1., nur Hinrunde, Best of 3, Teamgröße 4),
Map-Pool, Liga 1, Staffel A, acht Hauptteams mit je einem Co-Team (Captain und Vertreter), zuteilen, „Liga starten“
(Spielplan fest), Terminvorschlag (in der Weihnachtspause abgelehnt), Melden mit Maps und eigener Aufstellung,
Bestätigen im Web und aus der App, Aufstellung nachtragen, 48-h-Automatik, Tabelle mit Punkten, Einspruch, Korrektur
der Turnierleitung, Ligaseite. Ergebnis je Map mit Aufstellung kommt aus P4 (#1650).
"""
from __future__ import annotations

import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from squad_world import make_team  # noqa: E402

ADMIN = "/api/admin/leagues"
GAME = {
    "name": "Call of Duty (Probe)",
    "slug": "probe-cod",
    "match_modes": [
        {"mode": "stellung", "label": "Stellung"},
        {"mode": "suchen", "label": "Suchen & Zerstören"},
        {"mode": "kontrolle", "label": "Kontrolle"},
    ],
}
MAPS = {
    "Hafenkante": ["stellung", "suchen", "kontrolle"],
    "Nebelwerk": ["stellung", "suchen"],
    "Turmruine": ["suchen", "kontrolle"],
    "Salzmine": ["stellung", "kontrolle"],
}
POOL = {"stellung": ["Hafenkante", "Nebelwerk", "Salzmine"], "suchen": ["Nebelwerk", "Turmruine", "Hafenkante"],
        "kontrolle": ["Turmruine", "Salzmine"]}
# Je Position der Modus (game_mode_order der Season) und die Map, die in den Tests gespielt wird.
PLAYED = [("stellung", "Hafenkante"), ("suchen", "Turmruine"), ("kontrolle", "Salzmine")]
CHRISTMAS = [{"start_date": "2026-12-21", "end_date": "2027-01-03", "label": "Weihnachtspause"}]
SEASON_ONE = {
    "start_date": "2026-11-10T00:00:00",
    "weeks_total": 10,
    "blocked_periods": CHRISTMAS,
    "round_robin_legs": 1,
    "best_of": 3,
    "team_size": 4,
    "game_mode_order": ["stellung", "suchen", "kontrolle"],
    "rules_text": "## Regeln\nPlatzhalter für den Regeltext der Season.",
    "registration_deadline": "2026-11-06",
    "visibility": "admins",
}
# Acht erfundene Hauptteams mit je einem Co-Team (4 bis 6 im Kader).
TEAMS = [("Nebelwölfe", "Rudel"), ("Sturmvögel", "Schwarm"), ("Glutfüchse", "Bau"), ("Frostluchse", "Pfote"),
         ("Donnerdachse", "Höhle"), ("Schattenraben", "Horst"), ("Steinböcke", "Grat"), ("Blitzmarder", "Funke")]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def ok(response, code: int = 200):
    assert response.status_code == code, response.text
    return response.json()


# ---------------------------------------------------------------- Aufbau über die Routen

async def build_league(flow) -> dict:
    """Spiel mit Maps, Liga, Season 1 mit Pool, Liga 1, Staffel A, acht Co-Teams mit Captain und Vertreter, zugeteilt."""
    lead = await flow.add_staff()
    flow.act_as(lead)
    game = ok(await flow.post("/api/games", json=GAME))
    maps = {}
    for name, modes in MAPS.items():
        maps[name] = ok(await flow.post(f"/api/games/{game['id']}/maps", json={"name": name, "modes": modes}))
    league = ok(await flow.post(ADMIN, json={"name": "CoD-Liga", "game_id": game["id"]}))
    season = ok(await flow.post(f"{ADMIN}/{league['id']}/seasons", json=SEASON_ONE))
    ok(await flow.put(f"{ADMIN}/seasons/{season['id']}/map-pool", json={"modes": [
        {"mode": mode, "map_ids": [maps[name]["id"] for name in names]} for mode, names in POOL.items()]}))
    division = ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json={}))
    staffel = ok(await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={}))
    tid = staffel["tournament_id"]

    people: dict[str, dict] = {}
    squads: dict[str, dict] = {}
    for index, (team_name, squad_word) in enumerate(TEAMS):
        size = 4 + index % 3  # 4, 5 oder 6 im Kader
        players = [await flow.add_user(name=f"{team_name[:5]}{number}") for number in range(1, size + 2)]
        leader, roster = players[0], players[1:]
        team = await make_team(flow, team_name, leader=leader, members=roster)
        # Das Co-Team legt die Teamleitung im Profil an - Kader, Captain und Vertreter in einem Schritt.
        flow.act_as(leader)
        squad = ok(await flow.post(f"/api/teams/{team['id']}/squads", json={
            "name": f"{team_name} {squad_word}", "game_id": game["id"], "member_ids": [user["id"] for user in roster],
            "captain_id": roster[0]["id"], "vice_captain_id": roster[1]["id"]}))
        for user in players:
            people[user["id"]] = user
        flow.act_as(lead)
        assigned = ok(await flow.post(f"/api/tournaments/{tid}/squad-registrations",
                                      json={"team_id": team["id"], "squad_id": squad["id"]}))
        squads[assigned["registration"]["id"]] = {**squad, "team": team, "leader": leader}
    return {"lead": lead, "game": game, "maps": maps, "league": league, "season": season, "division": division,
            "tid": tid, "people": people, "squads": squads}


async def start_staffel(flow, world: dict) -> list[dict]:
    """Starten: Status „Live“ - der Spielplan wird dabei fest (aus der Vorschau mit den zugeteilten Co-Teams)."""
    flow.act_as(world["lead"])
    ok(await flow.post(f"/api/tournaments/{world['tid']}/status", json={"status": "live"}))
    return await fixed_matches(flow, world)


async def fixed_matches(flow, world: dict) -> list[dict]:
    rows = await flow.db.matches_v2.find({"tournament_id": world["tid"], "is_preview": {"$ne": True}},
                                         {"_id": 0}).to_list(None)
    return sorted(rows, key=lambda row: (int(row.get("round") or 0), row.get("order") or 0, row.get("match_key") or ""))


def sides(match: dict) -> tuple[str, str]:
    home, away = [slot["registration_id"] for slot in match["slots"]]
    return home, away


def captain(world: dict, registration_id: str) -> dict:
    return world["people"][world["squads"][registration_id]["captain_id"]]


def vice(world: dict, registration_id: str) -> dict:
    return world["people"][world["squads"][registration_id]["vice_captain_id"]]


def lineup(world: dict, registration_id: str) -> list[str]:
    """Vier aus dem Kader (Teamgröße 4)."""
    return world["squads"][registration_id]["member_ids"][:4]


def results(winner: str, loser: str, score: tuple[int, int]) -> list[dict]:
    return [{"registration_id": winner, "rank": 1, "score": score[0]},
            {"registration_id": loser, "rank": 2, "score": score[1]}]


def games(world: dict, winner: str, loser: str, score: tuple[int, int], *, side: str | None = None,
          both: bool = False, maps=PLAYED) -> list[dict]:
    """Die Maps einer Serie in der Reihenfolge der Season: der Sieger gewinnt die erste und die letzte Map. ``side``:
    eigene Aufstellung der meldenden Seite; ``both``: Aufstellungen beider Seiten (Turnierleitung)."""
    played = score[0] + score[1]
    winners = [winner] * played
    if score[1]:
        winners[1] = loser
    rows = []
    for position, (mode, name) in enumerate(maps[:played], start=1):
        row = {"position": position, "mode": mode, "map_id": world["maps"][name]["id"],
               "winner_registration_id": winners[position - 1]}
        if side:
            row["lineup"] = lineup(world, side)
        if both:
            row["lineups"] = {winner: lineup(world, winner), loser: lineup(world, loser)}
        rows.append(row)
    return rows


def report_body(world: dict, winner: str, loser: str, score: tuple[int, int], *, side: str) -> dict:
    """Was eine Seite im Web meldet: Stand, Maps und die eigene Aufstellung."""
    return {"results": results(winner, loser, score), "games": games(world, winner, loser, score, side=side)}


def correction_body(world: dict, winner: str, loser: str, score: tuple[int, int], reason: str) -> dict:
    """Korrektur der Turnierleitung: Stand, Maps und die Aufstellungen beider Seiten, mit Grund."""
    return {"results": results(winner, loser, score), "reason": reason,
            "games": games(world, winner, loser, score, both=True)}


async def table(flow, world: dict) -> dict:
    rows = ok(await flow.get(f"/api/tournaments/{world['tid']}/standings"))
    return {row["registration_id"]: row for row in rows}


def season_page(world: dict) -> str:
    return f"/api/leagues/{world['league']['slug']}/{world['season']['slug']}"


async def staffel_page(flow, world: dict) -> dict:
    return ok(await flow.get(f"{season_page(world)}/staffeln/{world['tid']}"))


async def stored(flow, match: dict) -> dict:
    return await flow.db.matches_v2.find_one({"id": match["id"]}, {"_id": 0})


# ---------------------------------------------------------------- Rahmen bis zum Spielplan

@pytest.mark.asyncio
async def test_from_the_league_to_a_started_schedule_with_the_christmas_break(flow):
    world = await build_league(flow)
    tid = world["tid"]

    # Anlegen: die Staffel trägt die Vorgaben der Season, acht Co-Teams sind zugeteilt.
    tournament = await flow.db.tournaments.find_one({"id": tid}, {"_id": 0})
    assert tournament["title"] == "CoD-Liga Season 1 · Liga 1 · Staffel A"
    assert (tournament["best_of"], tournament["team_size"], tournament["round_robin_legs"]) == (3, 4, 1)
    assert tournament["matchday_blocked_weeks"] == [7, 8]
    assert (tournament["visibility"], tournament["is_public"]) == ("internal", False)
    names = sorted(row["display_name"] for row in ok(await flow.get(f"/api/tournaments/{tid}/registrations")))
    assert names == sorted(f"{team} · {team} {word}" for team, word in TEAMS)

    # Sichtbarkeit „Nur Turnierleitung“: die Ligaseite gibt es für alle anderen nicht.
    flow.act_as(None)
    assert (await flow.get(season_page(world))).status_code == 404
    outsider = await flow.add_user(name="Zuschauer")
    flow.act_as(outsider)
    assert (await flow.get(season_page(world))).status_code == 404
    flow.act_as(world["lead"])
    assert ok(await flow.get(season_page(world)))["season"]["name"] == "Season 1"

    # Spielplan fest und starten: nur Hinrunde - 7 Spieltage zu je 4 Spielen.
    matches = await start_staffel(flow, world)
    assert len(matches) == 28
    assert sorted({int(match["round"]) for match in matches}) == list(range(1, 8))
    for registration_id in world["squads"]:
        assert sum(registration_id in sides(match) for match in matches) == 7, "jedes Team spielt jeden einmal"
    assert (await flow.db.tournaments.find_one({"id": tid}, {"_id": 0}))["status"] == "live"

    # Kalender auf der Ligaseite: Wochen 7 und 8 sind die Weihnachtspause, Spieltag 7 liegt in Woche 9.
    weeks = {row["week"]: row for row in (await staffel_page(flow, world))["weeks"]}
    assert [weeks[number]["kind"] for number in (7, 8)] == ["pause", "pause"]
    assert weeks[7]["label"] == "Weihnachtspause"
    assert (weeks[6]["matchday"], weeks[9]["matchday"], weeks[10]["kind"]) == (6, 7, "reserve")
    assert weeks[9]["first_day"] == "2027-01-05" and len(weeks[9]["matches"]) == 4
    assert weeks[1]["first_day"] == "2026-11-10" and weeks[1]["label"] == "Spieltag 1"

    # Terminvorschlag: der Captain der Heimseite schlägt vor, der Vertreter der Gegenseite nimmt an.
    first = matches[0]
    home, away = sides(first)
    flow.act_as(captain(world, home))
    proposal = ok(await flow.post(f"/api/matches/{first['id']}/schedule-proposals",
                                  json={"scheduled_at": "2026-11-12T18:30:00+00:00"}))
    flow.act_as(vice(world, away))
    accepted = ok(await flow.post(f"/api/matches/{first['id']}/schedule-proposals/{proposal['id']}/decision",
                                  json={"action": "accept"}))
    assert accepted["status"] == "accepted"
    assert (await stored(flow, first))["scheduled_at"].startswith("2026-11-12T18:30")
    # Ein einfaches Mitglied des Co-Teams stimmt keine Termine ab.
    member = world["people"][world["squads"][home]["member_ids"][3]]
    flow.act_as(member)
    refused = await flow.post(f"/api/matches/{first['id']}/schedule-proposals",
                              json={"scheduled_at": "2026-11-13T18:30:00+00:00"})
    assert refused.status_code == 403

    # Am 10.11. stellt der Obmann auf „Öffentlich“: Ligaseite und Staffel sind für alle da.
    flow.act_as(world["lead"])
    saved = ok(await flow.patch(f"{ADMIN}/seasons/{world['season']['id']}", json={"visibility": "public"}))
    assert saved["visibility_applied"] == 1
    flow.act_as(None)
    assert ok(await flow.get(season_page(world)))["season"]["name"] == "Season 1"
    assert len((await staffel_page(flow, world))["teams"]) == 8


# ---------------------------------------------------------------- Ergebnisse, Tabelle, Einspruch, Korrektur

@pytest.mark.asyncio
async def test_results_reach_the_table_and_a_correction_after_a_dispute_moves_the_points(flow):
    from services.match_deadline_sweep import sweep

    world = await build_league(flow)
    matches = await start_staffel(flow, world)
    day_one = [match for match in matches if int(match["round"]) == 1]
    assert len(day_one) == 4
    confirmed, automatic, disputed, entered = day_one

    # 1) Melden und Bestätigen: Heimseite meldet 2:0, die Gegenseite bestätigt (im Web mit eigener Aufstellung).
    home, away = sides(confirmed)
    flow.act_as(captain(world, home))
    ok(await flow.post(f"/api/matches/{confirmed['id']}/report", json=report_body(world, home, away, (2, 0), side=home)))
    assert (await stored(flow, confirmed))["status"] != "completed", "erst die Gegenseite macht es fest"
    flow.act_as(captain(world, away))
    ok(await flow.post(f"/api/matches/{confirmed['id']}/report", json=report_body(world, home, away, (2, 0), side=away)))
    assert (await stored(flow, confirmed))["status"] == "completed"

    # 2) Ohne Antwort: nach 48 Stunden gilt die Meldung (Fristen-Job).
    a_home, a_away = sides(automatic)
    flow.act_as(vice(world, a_away))
    ok(await flow.post(f"/api/matches/{automatic['id']}/report",
                       json=report_body(world, a_away, a_home, (2, 1), side=a_away)))
    await sweep(flow.db, now=datetime.now(timezone.utc) + timedelta(hours=47))
    assert (await stored(flow, automatic))["status"] != "completed", "vor Ablauf der 48 Stunden bleibt es offen"
    await sweep(flow.db, now=datetime(2027, 2, 1, tzinfo=timezone.utc))
    after = await stored(flow, automatic)
    assert after["status"] == "completed" and after["result_meta"]["auto_confirmed"] is True

    # 3) Einspruch: die Gegenseite widerspricht der Meldung, die Turnierleitung korrigiert mit Grund.
    d_home, d_away = sides(disputed)
    flow.act_as(captain(world, d_home))
    ok(await flow.post(f"/api/matches/{disputed['id']}/report", json=report_body(world, d_home, d_away, (2, 0), side=d_home)))
    flow.act_as(captain(world, d_away))
    ok(await flow.post(f"/api/matches/{disputed['id']}/dispute",
                       json={"reason": "Wir haben die zweite und dritte Map gewonnen.", "category": "wrong_result"}))
    assert (await stored(flow, disputed))["status"] == "disputed"
    flow.act_as(world["lead"])
    ok(await flow.post(f"/api/matches/{disputed['id']}/result?force=true",
                       json=correction_body(world, d_away, d_home, (2, 1), "Laut Aufzeichnung 2:1 für die Gäste")))
    corrected = await stored(flow, disputed)
    assert corrected["status"] == "completed"
    assert all(row.get("resolved_at") for row in corrected.get("disputes") or [])

    # 4) Die Turnierleitung trägt ein Ergebnis selbst ein (etwa nach Absprache im Discord).
    e_home, e_away = sides(entered)
    ok(await flow.post(f"/api/matches/{entered['id']}/result", json={
        "results": results(e_home, e_away, (2, 1)), "games": games(world, e_home, e_away, (2, 1), both=True)}))

    # Tabelle: Sieg 3 Punkte, Niederlage 0 - nach der Korrektur zählt der Sieg der Gäste.
    rows = await table(flow, world)
    winners = {home, a_away, d_away, e_home}
    losers = {away, a_home, d_home, e_away}
    assert {rows[rid]["points"] for rid in winners} == {3}
    assert {rows[rid]["points"] for rid in losers} == {0}
    assert all(rows[rid]["played"] == 1 for rid in winners | losers)

    # Ligaseite: Spieltag 1 mit allen Ergebnissen, Stand je Seite - ohne Aufstellungen.
    flow.act_as(world["lead"])
    page = await staffel_page(flow, world)
    shown = {row["id"]: row for row in page["weeks"][0]["matches"]}
    assert all(row["done"] for row in shown.values())
    assert shown[disputed["id"]]["winner_registration_id"] == d_away
    assert (shown[disputed["id"]]["home"]["score"], shown[disputed["id"]]["away"]["score"]) == (1, 2)
    standings = {row["registration_id"]: row for row in page["standings"]}
    assert standings[d_away]["points"] == 3
    assert "lineups" not in str(page)


# ---------------------------------------------------------------- Maps, Aufstellung, Nachtrag, Sperrzeit (P4)

@pytest.mark.asyncio
async def test_a_proposal_in_the_christmas_break_is_refused(flow):
    world = await build_league(flow)
    matches = await start_staffel(flow, world)
    match = next(row for row in matches if int(row["round"]) == 6)
    home, away = sides(match)
    flow.act_as(captain(world, home))

    refused = await flow.post(f"/api/matches/{match['id']}/schedule-proposals",
                              json={"scheduled_at": "2026-12-27T19:00:00+00:00"})

    assert refused.status_code == 409
    assert "Weihnachtspause" in refused.json()["detail"]
    # Die Sperrzeit gilt tageweise: der Montag 21.12. gehört noch zu Woche 6, ist aber schon Pause.
    monday = await flow.post(f"/api/matches/{match['id']}/schedule-proposals",
                             json={"scheduled_at": "2026-12-21T19:00:00+00:00"})
    assert monday.status_code == 409
    allowed = await flow.post(f"/api/matches/{match['id']}/schedule-proposals",
                              json={"scheduled_at": "2026-12-17T19:00:00+00:00"})
    assert allowed.status_code == 200, allowed.text


@pytest.mark.asyncio
async def test_maps_and_lineups_from_report_to_app_confirmation_amendment_and_league_page(flow):
    from services.match_deadline_sweep import sweep

    world = await build_league(flow)
    matches = await start_staffel(flow, world)
    app_confirmed, automatic, other_maps, _rest = [match for match in matches if int(match["round"]) == 1]

    # Melden mit Maps und eigener Aufstellung, Bestätigen aus der App ohne Maps: die Gegenseite fehlt noch.
    home, away = sides(app_confirmed)
    flow.act_as(captain(world, home))
    ok(await flow.post(f"/api/matches/{app_confirmed['id']}/report",
                       json=report_body(world, home, away, (2, 1), side=home)))
    flow.act_as(captain(world, away))
    ok(await flow.post(f"/api/matches/{app_confirmed['id']}/report", json={"results": results(home, away, (2, 1))}))
    match = await stored(flow, app_confirmed)
    assert match["status"] == "completed"
    assert [game["map_name"] for game in match["games"]] == [name for _mode, name in PLAYED]
    assert match["lineups_missing"] == [away]

    # Nachtrag im Web: der Vertreter trägt die Aufstellung je Map nach.
    flow.act_as(vice(world, away))
    ok(await flow.put(f"/api/matches/{app_confirmed['id']}/lineups", json={
        "games": [{"position": position, "lineup": lineup(world, away)} for position in (1, 2, 3)]}))
    match = await stored(flow, app_confirmed)
    assert match["lineups_missing"] == []
    assert match["games"][0]["lineups"] == {home: lineup(world, home), away: lineup(world, away)}

    # 48-h-Automatik: die Meldung gilt mit ihren Maps, die stumme Seite trägt nach.
    a_home, a_away = sides(automatic)
    flow.act_as(captain(world, a_home))
    ok(await flow.post(f"/api/matches/{automatic['id']}/report",
                       json=report_body(world, a_home, a_away, (2, 0), side=a_home)))
    await sweep(flow.db, now=datetime(2027, 2, 1, tzinfo=timezone.utc))
    match = await stored(flow, automatic)
    assert match["status"] == "completed"
    assert [game["position"] for game in match["games"]] == [1, 2]
    assert match["lineups_missing"] == [a_away]

    # Andere Maps beim Bestätigen: 409 mit Hinweis auf den Einspruch, dann Einspruch und Korrektur mit Maps.
    o_home, o_away = sides(other_maps)
    flow.act_as(captain(world, o_home))
    ok(await flow.post(f"/api/matches/{other_maps['id']}/report",
                       json=report_body(world, o_home, o_away, (2, 0), side=o_home)))
    flow.act_as(captain(world, o_away))
    elsewhere = [("stellung", "Nebelwerk"), ("suchen", "Turmruine")]
    conflict = await flow.post(f"/api/matches/{other_maps['id']}/report", json={
        "results": results(o_home, o_away, (2, 0)),
        "games": games(world, o_home, o_away, (2, 0), side=o_away, maps=elsewhere)})
    assert conflict.status_code == 409 and "Einspruch" in conflict.json()["detail"]
    ok(await flow.post(f"/api/matches/{other_maps['id']}/dispute",
                       json={"reason": "Die erste Map war Nebelwerk.", "category": "wrong_result"}))
    flow.act_as(world["lead"])
    body = {"results": results(o_home, o_away, (2, 0)), "reason": "Erste Map laut Aufzeichnung Nebelwerk",
            "games": games(world, o_home, o_away, (2, 0), both=True, maps=elsewhere)}
    ok(await flow.post(f"/api/matches/{other_maps['id']}/result?force=true", json=body))
    match = await stored(flow, other_maps)
    assert match["status"] == "completed"
    assert [game["map_name"] for game in match["games"]] == ["Nebelwerk", "Turmruine"]
    assert match["lineups_missing"] == []

    # Ligaseite: Maps mit Namen und Sieger, keine Aufstellungen.
    flow.act_as(world["lead"])
    shown = {row["id"]: row for row in (await staffel_page(flow, world))["weeks"][0]["matches"]}
    assert [game["map_name"] for game in shown[other_maps["id"]]["games"]] == ["Nebelwerk", "Turmruine"]
    assert all("lineups" not in game for row in shown.values() for game in row["games"])
