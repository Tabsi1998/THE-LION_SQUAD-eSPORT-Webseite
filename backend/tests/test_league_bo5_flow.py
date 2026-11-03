"""Liga mit Best of 5 über die echten Routen (#2200): 16 Teams, Punkte 3/0/0, Modusplan mit fünf Positionen.

Season mit Start an einem Donnerstag, 18 Wochen, Weihnachtspause, nur Hinrunde, Teamgröße 4. Alles frei erfunden: Spiel,
Modi, Maps und Teams sind Testwerte, die Regeln kommen aus der Season und nicht aus dem Code. Die Zeit steht fest (die
Season liegt in den festen Tagen unten), damit nichts mit dem Kalender ausläuft.

Läuft wie alle Ablauf-Tests auf mongomock und mit ``FLOW_MONGO_URL`` auf echtem MongoDB. Bekannte Fehler der Systemanalyse
(Kampflos, gesperrte Konten, Kader verkleinern ...) stehen hier bewusst nicht als Soll: die behandeln #2201 und #2202.
"""
from __future__ import annotations

import pathlib
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import OLD_RULES  # noqa: E402
from squad_world import make_team  # noqa: E402

ADMIN = "/api/admin/leagues"
VIENNA = ZoneInfo("Europe/Vienna")
GAME = {"name": "Probe-Shooter", "slug": "probe-shooter",
        "match_modes": [{"mode": "flagge", "label": "Flagge"}, {"mode": "bombe", "label": "Bombe"},
                        {"mode": "zone", "label": "Zone"}]}
# Die Bibliothek erlaubt je Map nur bestimmte Modi, der Pool wählt daraus: „Delta“ gibt es für Bombe gar nicht.
MAPS = {"Alpha": ["flagge", "bombe", "zone"], "Beta": ["flagge", "bombe"], "Gamma": ["bombe", "zone"],
        "Delta": ["flagge", "zone"]}
POOL = {"flagge": ["Alpha", "Beta", "Delta"], "bombe": ["Alpha", "Beta", "Gamma"], "zone": ["Gamma", "Delta"]}
MODE_PLAN = ["flagge", "bombe", "zone", "flagge", "bombe"]
# Je Position die gespielte Map zum Modusplan.
PLAYED = [("flagge", "Alpha"), ("bombe", "Gamma"), ("zone", "Delta"), ("flagge", "Beta"), ("bombe", "Beta")]
CHRISTMAS = [{"start_date": "2026-12-21", "end_date": "2027-01-03", "label": "Weihnachtspause"}]
# Donnerstag, 12.11.2026.
SEASON = {"start_date": "2026-11-12T00:00:00", "weeks_total": 18, "blocked_periods": CHRISTMAS, "round_robin_legs": 1,
          "best_of": 5, "team_size": 4, "max_staffel_size": 16, "game_mode_order": MODE_PLAN,
          "scoring_rules": {"match_points": {"win": 3, "draw": 0, "loss": 0}}, "rules_text": "Regeln der Probe-Season",
          "default_match_weekday": 6, "default_match_time": "20:00", "visibility": "admins",
          "readiness_override_reason": "Testaufbau ohne Prüfung"}


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


def refused(response, text: str) -> None:
    """Abgelehnt, und zwar aus genau diesem Grund - ein anderer Fehler täte sonst so, als wäre die Regel geprüft."""
    assert response.status_code == 422, response.text
    assert text in response.json()["detail"], response.text


# ---------------------------------------------------------------- Aufbau über die Routen

async def build(flow, teams: int, season: dict | None = None) -> dict:
    lead = await flow.add_staff()
    flow.act_as(lead)
    game = ok(await flow.post("/api/games", json=GAME))
    maps = {name: ok(await flow.post(f"/api/games/{game['id']}/maps", json={"name": name, "modes": modes}))
            for name, modes in MAPS.items()}
    league = ok(await flow.post(ADMIN, json={"name": "Probe-Liga", "game_id": game["id"]}))
    season_row = ok(await flow.post(f"{ADMIN}/{league['id']}/seasons", json={**OLD_RULES, **(season or SEASON)}))
    ok(await flow.put(f"{ADMIN}/seasons/{season_row['id']}/map-pool", json=pool_body(maps, POOL)))
    division = ok(await flow.post(f"{ADMIN}/seasons/{season_row['id']}/divisions", json={}))
    staffel = ok(await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={}))
    tid = staffel["tournament_id"]
    people, squads = {}, {}
    for index in range(teams):
        players = [await flow.add_user(name=f"T{index}S{number}") for number in range(6)]
        leader, roster = players[0], players[1:]
        team = await make_team(flow, f"Probeteam {index}", leader=leader, members=roster)
        flow.act_as(leader)
        squad = ok(await flow.post(f"/api/teams/{team['id']}/squads", json={
            "name": f"Probeteam {index} Eins", "game_id": game["id"], "member_ids": [user["id"] for user in roster],
            "captain_id": roster[0]["id"], "vice_captain_id": roster[1]["id"]}))
        people.update({user["id"]: user for user in players})
        flow.act_as(lead)
        assigned = ok(await flow.post(f"/api/tournaments/{tid}/squad-registrations",
                                      json={"team_id": team["id"], "squad_id": squad["id"]}))
        squads[assigned["registration"]["id"]] = squad
    return {"lead": lead, "game": game, "maps": maps, "tid": tid, "people": people, "squads": squads,
            "season": season_row, "league": league}


def pool_body(maps: dict, keep: dict) -> dict:
    return {"modes": [{"mode": mode, "map_ids": [maps[name]["id"] for name in names]} for mode, names in keep.items()]}


async def start(flow, world: dict) -> list[dict]:
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


def report(world: dict, winner: str, loser: str, score: tuple[int, int], side: str, winners: list[str],
           played=PLAYED) -> dict:
    """Was eine Seite im Web meldet: Stand, Maps je Position mit Sieger und die eigene Aufstellung."""
    games = [{"position": position, "mode": mode, "map_id": world["maps"][name]["id"],
              "winner_registration_id": winners[position - 1], "lineup": world["squads"][side]["member_ids"][:4]}
             for position, (mode, name) in enumerate(played[:len(winners)], start=1)]
    return {"results": [{"registration_id": winner, "rank": 1, "score": score[0]},
                        {"registration_id": loser, "rank": 2, "score": score[1]}], "games": games}


def series(home: str, away: str, score: tuple[int, int]) -> list[str]:
    """Wer welche Map gewinnt: die Heimseite gewinnt die Serie, die Gäste holen die ersten Punkte danach."""
    return {(3, 0): [home, home, home], (3, 1): [home, away, home, home],
            (3, 2): [home, away, away, home, home]}[score]


async def play(flow, world: dict, match: dict, score: tuple[int, int]) -> None:
    """Melden und Bestätigen durch beide Captains."""
    home, away = sides(match)
    order = series(home, away, score)
    flow.act_as(captain(world, home))
    ok(await flow.post(f"/api/matches/{match['id']}/report", json=report(world, home, away, score, home, order)))
    flow.act_as(captain(world, away))
    ok(await flow.post(f"/api/matches/{match['id']}/report", json=report(world, home, away, score, away, order)))


async def stored(flow, match: dict) -> dict:
    return await flow.db.matches_v2.find_one({"id": match["id"]}, {"_id": 0})


async def table(flow, world: dict) -> dict:
    flow.act_as(world["lead"])
    rows = ok(await flow.get(f"/api/tournaments/{world['tid']}/standings"))
    return {row["registration_id"]: row for row in rows}


# ---------------------------------------------------------------- Rahmen: 16 Teams, 120 Spiele, 15 Runden

@pytest.mark.asyncio
async def test_sixteen_teams_play_120_matches_in_15_rounds_around_the_christmas_break(flow):
    world = await build(flow, 16)
    tournament = await flow.db.tournaments.find_one({"id": world["tid"]}, {"_id": 0})
    assert (tournament["best_of"], tournament["team_size"], tournament["round_robin_legs"]) == (5, 4, 1)
    assert tournament["game_mode_order"] == MODE_PLAN
    assert tournament["scoring_rules"]["match_points"] == {"win": 3, "draw": 0, "loss": 0}

    matches = await start(flow, world)
    assert len(matches) == 120
    assert sorted({int(match["round"]) for match in matches}) == list(range(1, 16))
    for registration_id in world["squads"]:
        assert sum(registration_id in sides(match) for match in matches) == 15, "jedes Team spielt jeden einmal"
    pairings = {frozenset(sides(match)) for match in matches}
    assert len(pairings) == 120, "keine Paarung doppelt"

    # Die Woche läuft von Donnerstag bis Mittwoch; die Pause verschiebt die Spieltage dahinter, keiner fällt hinein.
    league = await flow.db.tournaments.find_one({"id": world["tid"]}, {"_id": 0, "matchday_blocked_weeks": 1})
    assert league["matchday_blocked_weeks"], "die Weihnachtspause sperrt ganze Spielwochen"
    flow.act_as(world["lead"])
    page = ok(await flow.get(f"/api/leagues/{world['league']['slug']}/{world['season']['slug']}/staffeln/{world['tid']}"))
    weeks = {row["week"]: row for row in page["weeks"]}
    assert weeks[1]["first_day"] == "2026-11-12"
    assert all(datetime.fromisoformat(row["first_day"]).weekday() == 3 for row in page["weeks"])
    played_weeks = [row for row in page["weeks"] if row["kind"] == "matchday"]
    assert [row["matchday"] for row in played_weeks] == list(range(1, 16))
    pause = [row for row in page["weeks"] if row["kind"] == "pause"]
    assert pause and all(row["label"] == "Weihnachtspause" and not row.get("matches") for row in pause)
    assert all(len(row["matches"]) == 8 for row in played_weeks)


@pytest.mark.asyncio
@pytest.mark.parametrize(("teams", "games", "rounds"), [(4, 6, 3), (5, 10, 5), (15, 105, 15)])
async def test_other_team_counts_fill_the_same_season(flow, teams, games, rounds):
    world = await build(flow, teams)
    matches = await start(flow, world)
    assert len(matches) == games
    assert max(int(match["round"]) for match in matches) == rounds
    for registration_id in world["squads"]:
        assert sum(registration_id in sides(match) for match in matches) == teams - 1
    assert all(len(sides(match)) == 2 for match in matches), "ein Freilos ist kein Spiel"


# ---------------------------------------------------------------- Best of 5: gültige Serien, Tabelle

@pytest.mark.asyncio
async def test_three_valid_series_with_confirmation_reach_the_table_with_points_and_maps(flow):
    world = await build(flow, 8)
    matches = await start(flow, world)
    day_one = [match for match in matches if int(match["round"]) == 1]
    assert len(day_one) == 4

    for match, score in zip(day_one, [(3, 0), (3, 1), (3, 2)]):
        home, away = sides(match)
        order = series(home, away, score)
        flow.act_as(captain(world, home))
        ok(await flow.post(f"/api/matches/{match['id']}/report", json=report(world, home, away, score, home, order)))
        assert (await stored(flow, match))["status"] != "completed", "erst die Gegenseite macht es fest"
        flow.act_as(captain(world, away))
        ok(await flow.post(f"/api/matches/{match['id']}/report", json=report(world, home, away, score, away, order)))
        after = await stored(flow, match)
        assert after["status"] == "completed"
        assert [game["position"] for game in after["games"]] == list(range(1, sum(score) + 1))
        assert [game["mode"] for game in after["games"]] == MODE_PLAN[:sum(score)]
        assert [game["winner_registration_id"] for game in after["games"]] == order
        assert after["lineups_missing"] == []

    rows = await table(flow, world)
    for match, (won, lost) in zip(day_one, [(3, 0), (3, 1), (3, 2)]):
        home, away = sides(match)
        assert (rows[home]["points"], rows[home]["won"], rows[home]["played"]) == (3, 1, 1)
        assert (rows[away]["points"], rows[away]["lost"], rows[away]["played"]) == (0, 1, 1)
        assert (rows[home]["score_for"], rows[home]["score_against"]) == (won, lost), "die Tabelle zählt Maps"
        assert (rows[away]["score_for"], rows[away]["score_against"]) == (lost, won)
    open_match = day_one[3]
    assert all(rows[side]["played"] == 0 and rows[side]["points"] == 0 for side in sides(open_match))

    # Bei gleichen Punkten entscheidet die Map-Differenz: 3:0 vor 3:1 vor 3:2.
    ranks = {row: rows[row]["rank"] for row in rows}
    first, second, third = (sides(match)[0] for match in day_one[:3])
    assert ranks[first] < ranks[second] < ranks[third]


# ---------------------------------------------------------------- Best of 5: abgelehnte Meldungen

@pytest.mark.asyncio
async def test_invalid_reports_are_refused_and_leave_the_match_untouched(flow):
    world = await build(flow, 4)
    matches = await start(flow, world)
    match = matches[0]
    home, away = sides(match)
    flow.act_as(captain(world, home))
    url = f"/api/matches/{match['id']}/report"

    # 2:2 entscheidet keine Serie.
    level = report(world, home, away, (2, 2), home, [home, away, home, away])
    refused(await flow.post(url, json=level), "Best of 5: der Sieger braucht genau 3 gewonnene Spiele.")

    # Falscher Modus an Position 2: der Plan verlangt dort „bombe“.
    wrong_mode = report(world, home, away, (3, 0), home, series(home, away, (3, 0)))
    wrong_mode["games"][1].update({"mode": "zone", "map_id": world["maps"]["Delta"]["id"]})
    refused(await flow.post(url, json=wrong_mode), "Map 2: gespielt wird hier Bombe.")

    # Eine Map nach der Entscheidung: bei 3:0 gibt es keine vierte.
    extra = report(world, home, away, (3, 0), home, series(home, away, (3, 0)))
    extra["games"].append({**extra["games"][0], "position": 4, "map_id": world["maps"]["Beta"]["id"]})
    refused(await flow.post(url, json=extra), "Nach Map 3 stand der Sieger schon fest")

    # Die Bibliothek kennt „Delta“ nicht für „bombe“, der Pool also auch nicht.
    locked_combo = report(world, home, away, (3, 0), home, series(home, away, (3, 0)))
    locked_combo["games"][1]["map_id"] = world["maps"]["Delta"]["id"]
    refused(await flow.post(url, json=locked_combo), "Map 2: diese Map ist im Pool")

    # Und auch der Pool selbst nimmt die Kombination nicht an: vollständig, nur „Delta“ für „bombe“ dazu.
    flow.act_as(world["lead"])
    with_delta = {**POOL, "bombe": [*POOL["bombe"], "Delta"]}
    refused(await flow.put(f"{ADMIN}/seasons/{world['season']['id']}/map-pool", json=pool_body(world["maps"], with_delta)),
            "Die Map „Delta“ ist für Bombe nicht freigegeben.")

    after = await stored(flow, match)
    assert after["status"] != "completed"
    assert not after.get("reports") and not after.get("games")


# ---------------------------------------------------------------- Standardtermin in Wiener Zeit

async def default_times(flow, world: dict) -> dict[int, datetime]:
    from services.matchday_schedule import persist_matchday_schedule

    tournament = await flow.db.tournaments.find_one({"id": world["tid"]}, {"_id": 0})
    written = await persist_matchday_schedule(flow.db, tournament)
    assert written["applies"] is True and written["written"] > 0
    matches = await fixed_matches(flow, world)
    assert {match["schedule_source"] for match in matches} == {"default"}
    return {int(match["round"]): datetime.fromisoformat(match["scheduled_at"]) for match in matches}


@pytest.mark.asyncio
async def test_default_time_is_sunday_evening_in_vienna_and_skips_the_break(flow):
    world = await build(flow, 16)
    await start(flow, world)
    times = await default_times(flow, world)

    assert len(times) == 15
    for moment in times.values():
        local = moment.astimezone(VIENNA)
        assert (local.weekday(), local.hour, local.minute) == (6, 20, 0), "Sonntag 20:00 auf der Wanduhr"
    assert times[1].astimezone(VIENNA).date().isoformat() == "2026-11-15"
    pause = (datetime(2026, 12, 21, tzinfo=VIENNA), datetime(2027, 1, 4, tzinfo=VIENNA))
    assert not [moment for moment in times.values() if pause[0] <= moment < pause[1]]
    assert list(times.values()) == sorted(times.values()), "die Spieltage liegen der Reihe nach"


@pytest.mark.asyncio
async def test_default_time_stays_on_the_wall_clock_across_the_time_change(flow):
    spring = {**SEASON, "start_date": "2027-03-11T00:00:00", "blocked_periods": []}
    world = await build(flow, 4, spring)
    await start(flow, world)
    times = await default_times(flow, world)

    # Die Uhren springen am 28.3.2027: in UTC rückt der Termin eine Stunde vor, in Wien bleibt er 20:00.
    assert [moment.astimezone(timezone.utc).hour for moment in times.values()] == [19, 19, 18]
    assert {moment.astimezone(VIENNA).hour for moment in times.values()} == {20}
    assert times[3].astimezone(VIENNA).date().isoformat() == "2027-03-28"


# ---------------------------------------------------------------- Map sperren: neue Pool-Version und Übertragen

@pytest.mark.asyncio
async def test_a_new_pool_version_locks_a_map_for_new_matches_only(flow):
    world = await build(flow, 4)
    matches = await start(flow, world)
    finished, held, fresh = matches[0], matches[1], matches[2]
    season_id = world["season"]["id"]

    # Ein Spiel ist fertig, eines hat die erste Meldung (sein Pool ist damit festgehalten).
    await play(flow, world, finished, (3, 0))
    before = await stored(flow, finished)
    held_home, held_away = sides(held)
    order = series(held_home, held_away, (3, 0))
    flow.act_as(captain(world, held_home))
    ok(await flow.post(f"/api/matches/{held['id']}/report", json=report(world, held_home, held_away, (3, 0), held_home, order)))

    async def staffel_pool_version() -> int:
        row = await flow.db.map_pools.find_one({"scope": "tournament", "scope_id": world["tid"]}, {"_id": 0, "version": 1},
                                               sort=[("version", -1)])
        return row["version"]

    # Sperren heißt: neue Version des Season-Pools ohne die Map, dann in die Staffel übertragen.
    version_before = await staffel_pool_version()
    flow.act_as(world["lead"])
    without_alpha_and_gamma = {"flagge": ["Beta", "Delta"], "bombe": ["Beta"], "zone": ["Delta"]}
    ok(await flow.put(f"{ADMIN}/seasons/{season_id}/map-pool", json=pool_body(world["maps"], without_alpha_and_gamma)))
    assert await staffel_pool_version() == version_before, "die Staffel behält ihren Pool bis zum Übertragen"
    ok(await flow.post(f"{ADMIN}/seasons/{season_id}/sync", json={}))
    assert await staffel_pool_version() == version_before + 1
    versions = await flow.db.map_pools.count_documents({"scope": "league_season", "scope_id": season_id})
    assert versions == 2, "ältere Versionen bleiben stehen"

    # Ein neues Spiel kann die gesperrte Map nicht mehr melden, mit dem neuen Pool geht es.
    home, away = sides(fresh)
    flow.act_as(captain(world, home))
    url = f"/api/matches/{fresh['id']}/report"
    locked = await flow.post(url, json=report(world, home, away, (3, 0), home, series(home, away, (3, 0))))
    refused(locked, "Map 1: diese Map ist im Pool")
    allowed = [("flagge", "Beta"), ("bombe", "Beta"), ("zone", "Delta")]
    ok(await flow.post(url, json=report(world, home, away, (3, 0), home, series(home, away, (3, 0)), played=allowed)))

    # Fertiges Spiel unberührt, das festgehaltene lässt sich mit den alten Maps bestätigen.
    assert await stored(flow, finished) == before
    flow.act_as(captain(world, held_away))
    ok(await flow.post(f"/api/matches/{held['id']}/report", json=report(world, held_home, held_away, (3, 0), held_away, order)))
    confirmed = await stored(flow, held)
    assert confirmed["status"] == "completed"
    assert [game["map_name"] for game in confirmed["games"]] == [name for _mode, name in PLAYED[:3]]
