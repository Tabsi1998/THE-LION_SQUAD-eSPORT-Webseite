"""Abnahme #1931 über die echten Routen: eine Saison wie in einer CoD-Team-Liga - 7 Spieltage, 8 Teams, 10 Spieler im
Kader - nur über die Wege, die das Einfügen nutzt (Terminliste, Kader, je Spieltag die Begegnungsliste mit allen
Spielen, Maps samt Wahl und Bann). Danach stimmen Tabelle, Bilanz, Einsätze je Person (auch im Mitgliederprofil) und
die Spieltag-Karten der Serienseite. Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_round_routes  # noqa: E402
from services import migrations  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"
OWN = "Probe Löwen"
TEAMS = [OWN, "Probe Falken", "Probe Wölfe", "Probe Adler", "Probe Eulen", "Probe Bären", "Probe Füchse",
         "Probe Luchse"]
ROSTER = [f"Spieler {letter}" for letter in "ABCDEFGHIJ"]
RULES = {"points_mode": "organizer", "match_points": {"win": 3, "draw": 1, "loss": 0},
         "table_tiebreakers": ["score_diff", "score_for"]}


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-07-15")
    try:
        yield instance
    finally:
        await shutdown()


def _schedule():
    """Jeder gegen jeden (Kreisverfahren): 7 Spieltage mit je 4 Spielen."""
    teams = list(TEAMS)
    days = []
    for _ in range(len(teams) - 1):
        days.append([(teams[index], teams[-1 - index]) for index in range(len(teams) // 2)])
        teams = [teams[0], teams[-1], *teams[1:-1]]
    return days


def _maps_of(day: int, own_home: bool):
    """Veto wie in S&D: zwei Banns, zwei Wahlen, Decider - drei gespielte Maps (bis 6 Runden); Ergebnis aus Sicht des
    Heimteams."""
    own_wins = [(6, 3), (6, 4), (2, 6)] if day % 3 else [(4, 6), (6, 5), (3, 6)]
    maps = [{"name": "Karte 4", "role": "banned", "by": "own"}, {"name": "Karte 5", "role": "banned", "by": "opponent"}]
    roles = [("picked", "own"), ("picked", "opponent"), ("decider", None)]
    for number, (mine, theirs) in enumerate(own_wins, start=1):
        home, away = (mine, theirs) if own_home else (theirs, mine)
        role, by = roles[number - 1]
        maps.append({"name": f"Karte {number}", "home_score": home, "away_score": away, "role": role,
                     **({"by": by} if by else {})})
    return maps


def _played(maps):
    return [game for game in maps if game.get("role") != "banned"]


def _other_score(day: int, index: int):
    return [(2, 1), (0, 2), (1, 1), (2, 0)][(day + index) % 4]


async def _setup(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={
        "title": "Probe Liga S&D 4vs4", "kind": "team_league", "organizer": "Probe Verband"})).json()
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "Season 3", "team_name": OWN, "rules": RULES, "default_time": "20:00",
        "status": "active"})).json()
    await flow.db.club_member_profiles.insert_one({"id": "profil-a", "slug": "spieler-a", "display_name": "Spieler A",
                                                   "is_active": True})
    return admin, lineage, series


async def _enter_season(flow, series):
    """Alles wie die Oberfläche es nach dem Einfügen schickt."""
    sid = series["id"]
    days = _schedule()
    lines = []
    for number, games in enumerate(days, start=1):
        game = next(game for game in games if OWN in game)
        opponent = game[1] if game[0] == OWN else game[0]
        sign = "vs" if game[0] == OWN else "@"
        lines.append(f"ST{number} · {6 + number:02d}.05.–{8 + number:02d}.05. · {sign} {opponent}")
    # Ein Spieltag je Woche ist hier zu dicht für Zeiträume ohne Überschneidung - egal für die Wertung.
    pasted = await flow.post(f"{ADMIN}/series/{sid}/rounds/paste", json={"text": "\n".join(lines), "apply": True})
    assert pasted.status_code == 200, pasted.text
    rounds = pasted.json()["rounds"]
    roster = await flow.post(f"{ADMIN}/series/{sid}/participants/batch", json={"names": ROSTER, "team": OWN})
    assert roster.status_code == 200, roster.text
    ids = {row["name"]: row["id"] for row in roster.json()["created"]}
    # Spieler A ist Vereinsmitglied mit Profil.
    await flow.db.reference_participants.update_one({"id": ids["Spieler A"]}, {"$set": {
        "link": "member", "profile_id": "profil-a", "is_club_member": True, "link_status": "decided"}})

    played = {name: 0 for name in ROSTER}
    for number, (games, item) in enumerate(zip(days, rounds), start=1):
        lineup = [ROSTER[(number + offset) % len(ROSTER)] for offset in range(4)]
        for name in lineup:
            played[name] += 1
        matches = []
        for index, (home, away) in enumerate(games):
            if OWN in (home, away):
                maps = _maps_of(number, home == OWN)
                won = sum(1 for game in _played(maps) if (game["home_score"] > game["away_score"]) == (home == OWN))
                home_score, away_score = (won, 3 - won) if home == OWN else (3 - won, won)
                matches.append({"home": home, "away": away, "home_score": home_score, "away_score": away_score,
                                "time": "20:30", "maps": maps, "lineup": [{"name": name} for name in lineup]})
            else:
                home_score, away_score = _other_score(number, index)
                matches.append({"home": home, "away": away, "home_score": home_score, "away_score": away_score})
        base = f"{ADMIN}/series/{sid}/rounds/{item['id']}/results"
        saved = await flow.put(base, json={"matches": matches, "status": "published", "expected_version": 0})
        assert saved.status_code == 200, saved.text
    return rounds, ids, played


def _expected_table():
    rows = {team: {"won": 0, "drawn": 0, "lost": 0, "for": 0, "against": 0} for team in TEAMS}
    for number, games in enumerate(_schedule(), start=1):
        for index, (home, away) in enumerate(games):
            if OWN in (home, away):
                maps = _maps_of(number, home == OWN)
                won = sum(1 for game in _played(maps) if (game["home_score"] > game["away_score"]) == (home == OWN))
                scores = (won, 3 - won) if home == OWN else (3 - won, won)
            else:
                scores = _other_score(number, index)
            for team, mine, theirs in ((home, *scores), (away, scores[1], scores[0])):
                key = "won" if mine > theirs else "lost" if mine < theirs else "drawn"
                rows[team][key] += 1
                rows[team]["for"] += mine
                rows[team]["against"] += theirs
    return {team: {**row, "points": row["won"] * 3 + row["drawn"]} for team, row in rows.items()}


@pytest.mark.asyncio
async def test_a_whole_season_entered_by_paste_has_the_right_table_record_and_appearances(flow):
    _, lineage, series = await _setup(flow)
    rounds, ids, played = await _enter_season(flow, series)
    expected = _expected_table()

    flow.act_as(None)
    response = await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")
    assert response.status_code == 200, response.text
    league = response.json()["team_league"]

    table = {row["team"]: row for row in league["table"]["rows"]}
    assert len(table) == 8
    for team, row in expected.items():
        assert (table[team]["won"], table[team]["drawn"], table[team]["lost"], table[team]["points"]) == (
            row["won"], row["drawn"], row["lost"], row["points"]), team
    assert table[OWN]["own"] is True and sum(1 for row in table.values() if row["own"]) == 1

    record = league["record"]
    assert [item["team"] for item in record] == [OWN]
    own = expected[OWN]
    assert (record[0]["played"], record[0]["won"], record[0]["drawn"], record[0]["lost"]) == (
        7, own["won"], own["drawn"], own["lost"])
    assert (record[0]["maps_for"], record[0]["maps_against"]) == (own["for"], own["against"])
    rounds_for = sum(sum((6, 6, 2) if number % 3 else (4, 6, 3)) for number in range(1, 8))
    rounds_against = sum(sum((3, 4, 6) if number % 3 else (6, 5, 6)) for number in range(1, 8))
    assert (record[0]["rounds_for"], record[0]["rounds_against"], record[0]["rounds_matches"]) == (
        rounds_for, rounds_against, 7)

    players = {player["name"]: player for player in league["lineup"]["players"]}
    assert set(players) == set(ROSTER), "Der ganze Kader steht da - auch wer nie gespielt hat."
    for name in ROSTER:
        assert (players[name]["appearances"], players[name]["of"], players[name]["in_roster"]) == (
            played[name], 7, True), name
        assert len(players[name]["bench_round_ids"]) == 7 - played[name]
    assert players["Spieler A"]["profile_slug"] == "spieler-a"


@pytest.mark.asyncio
async def test_matchday_cards_carry_maps_with_picks_bans_the_time_and_the_other_matches(flow):
    _, lineage, series = await _setup(flow)
    rounds, _, _ = await _enter_season(flow, series)
    flow.act_as(None)
    league = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()["team_league"]
    first = league["matchdays"][0]
    assert first["round"]["club_day_end"] == "2026-05-09"
    games = _schedule()[0]
    own_home = next(game for game in games if OWN in game)[0] == OWN
    match = first["match"]
    assert match["time"] == "20:30" and match["home"] is own_home
    # Wer gewählt bzw. gesperrt hat, steht schon aus eigener Sicht im Blatt - egal ob daheim oder auswärts.
    assert match["home"] is own_home
    assert [item["picked"] for item in match["maps"]] == ["own", "opponent", "decider"]
    assert match["bans"] == [{"name": "Karte 4", "by": "own", "map_id": None},
                             {"name": "Karte 5", "by": "opponent", "map_id": None}]
    assert [(item["home"], item["away"]) for item in first["others"]] == [game for game in games if OWN not in game]


@pytest.mark.asyncio
async def test_the_member_profile_shows_the_appearances_of_a_linked_season(flow):
    admin, _, series = await _setup(flow)
    _, _, played = await _enter_season(flow, series)
    flow.act_as(admin)
    await flow.db.references.insert_one({
        "id": "ref-saison", "title": "Probe Liga Season 3", "series_id": series["id"], "visibility": "public",
        "is_active": True, "member_profile_ids": ["profil-a"], "date": "2026-07-01",
        "entries": [{"kind": "team", "team_name": OWN, "member_profile_ids": ["profil-a"], "placement": 3}]})
    flow.act_as(None)
    profile = await flow.get("/api/membership/profiles/spieler-a")
    assert profile.status_code == 200, profile.text
    reference = next(item for item in profile.json()["references"] if item["id"] == "ref-saison")
    assert reference["appearances"] == {"played": played["Spieler A"], "of": 7, "unit": "matches", "team": OWN}


@pytest.mark.asyncio
async def test_the_member_profile_counts_races_of_a_racing_season(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Racing", "kind": "racing"})).json()
    series = (await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2026"})).json()
    await flow.db.club_member_profiles.insert_one({"id": "profil-r", "slug": "fahrer-r", "display_name": "Fahrer R",
                                                   "is_active": True})
    rounds = []
    for code, day in (("R1", "2026-05-06"), ("R2", "2026-05-13"), ("R3", "2026-08-01")):
        created = await flow.post(f"{ADMIN}/series/{series['id']}/rounds", json={"code": code, "day": day})
        rounds.append(created.json())
    people = (await flow.post(f"{ADMIN}/series/{series['id']}/participants/batch",
                              json={"names": ["Fahrer R", "Fahrer S"]})).json()["created"]
    await flow.db.reference_participants.update_one({"id": people[0]["id"]}, {"$set": {
        "link": "member", "profile_id": "profil-r", "is_club_member": True, "link_status": "decided"}})
    for item, names in ((rounds[0], ["Fahrer R", "Fahrer S"]), (rounds[1], ["Fahrer S"])):
        saved = await flow.put(f"{ADMIN}/series/{series['id']}/rounds/{item['id']}/results", json={
            "rows": [{"name": name, "place": place} for place, name in enumerate(names, start=1)],
            "status": "published", "expected_version": 0})
        assert saved.status_code == 200, saved.text
    await flow.db.references.insert_one({
        "id": "ref-rennen", "title": "Probe Racing 2026", "series_id": series["id"], "visibility": "public",
        "is_active": True, "member_profile_ids": ["profil-r"], "date": "2026-07-01",
        "entries": [{"kind": "solo", "member_profile_ids": ["profil-r"], "placement": 2}]})
    flow.act_as(None)
    profile = (await flow.get("/api/membership/profiles/fahrer-r")).json()
    reference = next(item for item in profile["references"] if item["id"] == "ref-rennen")
    assert reference["appearances"] == {"played": 1, "of": 2, "unit": "races", "team": None}


@pytest.mark.asyncio
async def test_two_own_teams_on_the_same_matchday_each_get_card_record_and_appearances(flow):
    """Prüfung #1931, Punkt 1: spielen zwei eigene Teams am selben Spieltag, zählt jedes - Karte, Bilanz, Form und
    Einsätze je eigenem Team; nur fremde Spiele stehen unter „weitere Spiele“."""
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Liga Zwei", "kind": "team_league"})).json()
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2026", "rules": RULES, "status": "active",
        "own_teams": [{"name": "Lions Black", "aliases": []}, {"name": "Lions Gold", "aliases": []}]})).json()
    item = (await flow.post(f"{ADMIN}/series/{series['id']}/rounds", json={"code": "ST1", "day": "2026-06-10"})).json()
    for team, names in (("Lions Black", ["Black Eins", "Black Zwei"]), ("Lions Gold", ["Gold Eins", "Gold Zwei"])):
        await flow.post(f"{ADMIN}/series/{series['id']}/participants/batch", json={"names": names, "team": team})
    # Reihenfolge wie in der Begegnungsliste des Veranstalters: Gold zuerst.
    saved = await flow.put(f"{ADMIN}/series/{series['id']}/rounds/{item['id']}/results", json={"matches": [
        {"home": "Lions Gold", "away": "Gegner A", "home_score": 2, "away_score": 0,
         "lineup": [{"name": "Gold Eins"}, {"name": "Gold Zwei"}]},
        {"home": "Gegner B", "away": "Lions Black", "home_score": 0, "away_score": 2,
         "lineup": [{"name": "Black Eins"}]},
        {"home": "Gegner C", "away": "Gegner D", "home_score": 1, "away_score": 1},
    ], "status": "published", "expected_version": 0})
    assert saved.status_code == 200, saved.text

    flow.act_as(None)
    league = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()["team_league"]
    day = league["matchdays"][0]
    assert [(view["team"], view["opponent"], view["home"]) for view in day["matches"]] == [
        ("Lions Gold", "Gegner A", True), ("Lions Black", "Gegner B", False)]
    assert day["match"]["team"] == "Lions Gold"
    assert [(item["home"], item["away"]) for item in day["others"]] == [("Gegner C", "Gegner D")]
    assert [(item["team"], item["played"], item["won"]) for item in league["record"]] == [
        ("Lions Black", 1, 1), ("Lions Gold", 1, 1)]
    form = {row["team"]: row["form"] for row in league["table"]["rows"] if row["own"]}
    assert form == {"Lions Black": ["W"], "Lions Gold": ["W"]}
    players = {player["name"]: player for player in league["lineup"]["players"]}
    assert {name: (player["appearances"], player["of"], player["team"], len(player["bench_round_ids"]))
            for name, player in players.items()} == {
        "Gold Eins": (1, 1, "Lions Gold", 0), "Gold Zwei": (1, 1, "Lions Gold", 0),
        "Black Eins": (1, 1, "Lions Black", 0), "Black Zwei": (0, 1, "Lions Black", 1)}


@pytest.mark.asyncio
async def test_a_played_map_needs_its_result_an_unplayed_pick_or_decider_stays_empty(flow):
    """Prüfung #1931, Punkt 3: eine gespielte Map ohne Ergebnis wird nicht still 0:0 - 422 mit Hinweis auf Spiel, Map
    und Feld. Bann, Wahl und Decider dürfen ohne Ergebnis sein (ein Decider bei 2:0 wird nicht gespielt): sie bleiben
    leer, zählen nicht für Maps und Runden und stehen nicht unter den gespielten Maps."""
    _, lineage, series = await _setup(flow)
    item = (await flow.post(f"{ADMIN}/series/{series['id']}/rounds", json={"code": "ST1", "day": "2026-06-10"})).json()
    base = f"{ADMIN}/series/{series['id']}/rounds/{item['id']}/results"
    played = [{"name": "Karte 1", "role": "picked", "by": "own", "home_score": 6, "away_score": 2},
              {"name": "Karte 2", "role": "picked", "by": "opponent", "home_score": 6, "away_score": 4}]

    missing = await flow.put(base, json={"matches": [
        {"home": OWN, "away": "Probe Falken", "home_score": 3, "away_score": 0,
         "maps": [*played, {"name": "Karte 3", "role": "played", "home_score": 6}]}],
        "status": "published", "expected_version": 0})
    assert missing.status_code == 422, missing.text
    errors = missing.json()["detail"]["errors"]
    assert [(error["code"], error["match"], error["map"], error["map_field"]) for error in errors] == [
        ("map_score_missing", 0, 2, "away_score")]
    assert errors[0]["message"] == "Spiel 1, Map 3: Das Ergebnis fehlt - eine gespielte Map braucht beide Stände."

    saved = await flow.put(base, json={"matches": [
        {"home": OWN, "away": "Probe Falken", "home_score": 2, "away_score": 0,
         "maps": [{"name": "Karte 4", "role": "banned", "by": "own"}, *played,
                  {"name": "Karte 3", "role": "decider"}]}],
        "status": "published", "expected_version": 0})
    assert saved.status_code == 200, saved.text
    stored = await flow.db.reference_round_results.find_one({"round_id": item["id"]}, {"_id": 0})
    assert stored["matches"][0]["maps"][-1] == {"name": "Karte 3", "role": "decider"}
    assert not any(problem["code"] == "maps_differ" for problem in saved.json().get("warnings") or [])

    flow.act_as(None)
    league = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()["team_league"]
    match = league["matchdays"][0]["match"]
    assert [entry["name"] for entry in match["maps"]] == ["Karte 1", "Karte 2"]
    assert [entry["name"] for entry in match["bans"]] == ["Karte 4"]
    record = league["record"][0]
    assert (record["rounds_for"], record["rounds_against"]) == (12, 6)
    # Das ganze Veto in seiner Reihenfolge (Obmann, #1931): auch der nicht gespielte Decider, ohne Ergebnis.
    assert [(entry["name"], entry["role"], entry["played"]) for entry in match["veto"]] == [
        ("Karte 4", "banned", False), ("Karte 1", "picked", True), ("Karte 2", "picked", True),
        ("Karte 3", "decider", False)]
    assert match["veto"][1]["score_for"] == 6 and match["veto"][1]["picked"] == "own"
    assert "score_for" not in match["veto"][3] and match["veto"][3]["picked"] == "decider"
