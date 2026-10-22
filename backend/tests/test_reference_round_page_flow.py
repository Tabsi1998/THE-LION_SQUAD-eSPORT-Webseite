"""Ergebnistabelle je Runde und Lauf (#1950) über die echten Routen: eine Runde mit Qualifying und Rennen (20 Fahrer,
Zeit, Abstand, Pole, schnellste Runde, Fahrer des Tages, Ausfall, Strafsekunden), Teamfarben aus der Verwaltung und dem
Vorschlag der Bild-Erkennung, ein Rennen ohne Zeiten, die Statistik der Saison und die Sichtbarkeit fremder Namen. Nur
erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_round_routes, reference_series_public_routes  # noqa: E402
from services import migrations, reference_running_cache  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"
SCHEME = [35, 30, 26, 23, 20, 17, 15, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
TEAMS = ["Probe Löwen", "Probe Löwen B", "Probe-DarkFriday", "Fremd Rot", "Fremd Blau", "Fremd Grün", "Fremd Gelb",
         "Fremd Weiß", "Fremd Grau", "Fremd Lila"]
QUALI_RACE = {"formats": [{"sessions": [{"label": "Qualifying"}, {"label": "Rennen", "offset": 30}]}]}
QUALI_ORDER = [3, 1, 2, *range(4, 21)]
RACE_ORDER = [5, 3, 1, 2, 4, *range(6, 20)]


@pytest_asyncio.fixture
async def flow(monkeypatch):
    reference_running_cache.reset()
    instance, shutdown = make_flow()
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-03-20")
    monkeypatch.setattr(reference_series_public_routes, "club_today", lambda: "2026-03-20")
    try:
        yield instance
    finally:
        await shutdown()


def _name(number: int) -> str:
    return f"Probe Fahrer {number:02d}"


def _team(number: int) -> str:
    team = TEAMS[(number - 1) // 2]
    # Der Veranstalter schreibt das eigene Team „Probe-DarkFriday“ ohne Bindestrich.
    return "Probe DarkFriday" if team == "Probe-DarkFriday" else team


async def _season(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    flow.act_as(await flow.add_user(role="club_admin", name="vorstand"))
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Rennliga", "kind": "racing"})).json()
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2026", "status": "active", "default_time": "20:00",
        "weekend": QUALI_RACE, "own_teams": [{"name": "Probe Löwen"}, {"name": "Probe-DarkFriday"}],
        "rules": {"points_mode": "scheme", "points_by_place": SCHEME,
                  "bonuses": {"fastest_lap": {"points": 1, "max_place": 10}}}})).json()
    pasted = await flow.post(f"{ADMIN}/series/{series['id']}/rounds/paste", json={"text": "\n".join([
        "R1 · 08.03.2026 · Aserbaidschan", "R2 · 15.03.2026 · Singapur", "R3 · 29.03.2026 · Monza"]), "apply": True})
    assert pasted.status_code == 200, pasted.text
    return lineage, series, pasted.json()["rounds"]


async def _publish(flow, series, round_id, body):
    url = f"{ADMIN}/series/{series['id']}/rounds/{round_id}/results"
    saved = await flow.put(url, json={**body, "status": "published", "expected_version": 0})
    assert saved.status_code == 200, saved.text
    return saved.json()


def _quali_rows():
    return [{"place": place, "name": _name(number), "start_number": str(number), "team": _team(number),
             "time": "1:40.474" if place == 1 else None, "gap": None if place == 1 else f"+{place * 0.25:.3f}"}
            for place, number in enumerate(QUALI_ORDER, start=1)]


def _race_rows():
    rows = [{"place": place, "name": _name(number), "start_number": str(number), "team": _team(number),
             "time": "31:55.056" if place == 1 else None, "gap": None if place == 1 else f"+{place * 1.5:.3f}"}
            for place, number in enumerate(RACE_ORDER, start=1)]
    rows[11]["penalty_seconds"] = 5
    rows.append({"place": None, "name": _name(20), "start_number": "20", "team": _team(20), "dnf": True})
    return rows


async def _full_round(flow):
    lineage, series, rounds = await _season(flow)
    quali, race = rounds[0], rounds[1]
    await _publish(flow, series, quali["id"], {"rows": _quali_rows()})
    saved = await _publish(flow, series, race["id"], {
        "rows": _race_rows(), "fastest_lap": {"name": _name(3), "time": "1:43.375"}, "driver_of_the_day": _name(5)})
    assert saved["sheet"]["rows"][11]["penalty_seconds"] == 5
    people = {item["name"]: item["id"] async for item in flow.db.reference_participants.find(
        {"series_id": series["id"]}, {"_id": 0, "id": 1, "name": 1})}
    # Fahrer 01 ist Vereinsmitglied mit öffentlichem Profil, Fahrer 07 hat einen ausgeblendeten Namen.
    await flow.db.club_member_profiles.insert_one({"id": "profil-01", "slug": "probe-eins", "is_active": True})
    await flow.db.reference_participants.update_one({"id": people[_name(1)]}, {"$set": {
        "is_club_member": True, "link": "member", "profile_id": "profil-01"}})
    await flow.db.reference_participants.update_one({"id": people[_name(7)]}, {"$set": {"name_hidden": True}})
    return lineage, series, rounds, people


@pytest.mark.asyncio
async def test_a_round_shows_qualifying_and_race_like_the_organizer(flow):
    lineage, series, rounds, people = await _full_round(flow)
    colors = await flow.put(f"{ADMIN}/series/{series['id']}/team-colors",
                            json={"colors": {"Probe Löwen": "#FACC15", "Fremd Rot": "#ef4444", "Fremd Blau": None}})
    assert colors.status_code == 200, colors.text

    flow.act_as(None)
    response = await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}/rounds/1")
    assert response.status_code == 200, response.text
    page = response.json()
    head = page["round"]
    assert (head["number"], head["total"], head["code"], head["country_code"]) == (1, 3, "R1", "AZ")
    assert page["previous"] is None and page["next"]["number"] == 2 and page["next"]["country_code"] == "SG"
    assert page["own_teams"] == ["Probe Löwen", "Probe-DarkFriday"]
    assert [item["key"] for item in page["sessions"]] == ["qualifying", "rennen"]
    assert page["main"] == "rennen"

    quali, race = page["sessions"]
    assert quali["columns"] == ["start_number", "time", "gap"]
    assert quali["pole"] == {"key": people[_name(3)], "time": "1:40.474"}
    assert quali["rows"][0]["marks"] == ["pole"] and quali["rows"][0]["points"] is None

    assert race["columns"] == ["start_number", "grid", "time", "gap", "penalty_seconds", "points"]
    assert len(race["rows"]) == 20
    winner = race["rows"][0]
    # Startplatz aus dem Qualifying (im Blatt leer), gutgemacht 4 Plätze, Fahrer des Tages, Teamfarbe.
    assert (winner["key"], winner["place"], winner["time"], winner["grid"], winner["gained"]) == (
        people[_name(5)], 1, "31:55.056", 5, 4)
    assert winner["driver_of_the_day"] is True and winner["points"] == 35
    second = race["rows"][1]
    assert second["fastest_lap"] is True and second["fastest_lap_time"] == "1:43.375"
    assert "pole" in second["marks"] and second["points"] == 31  # 30 + Bonus schnellste Runde
    assert race["rows"][11]["penalty_seconds"] == 5
    out = race["rows"][-1]
    assert (out["status"], out["place"], out["key"]) == ("dnf", None, people[_name(20)])

    by_key = {row["key"]: row for row in race["rows"]}
    member = by_key[people[_name(1)]]
    assert member["own"] is True and member["club_member"] is True and member["profile_slug"] == "probe-eins"
    assert member["team_color"] == "#facc15"
    # „Probe DarkFriday“ aus der Grafik ist das eigene Team „Probe-DarkFriday“.
    darkfriday = by_key[people[_name(5)]]
    assert darkfriday["team"] == "Probe-DarkFriday" and darkfriday["own"] is True and darkfriday["team_color"] is None
    assert by_key[people[_name(7)]]["team_color"] == "#ef4444" and by_key[people[_name(7)]]["own"] is False
    hidden = by_key[people[_name(7)]]
    assert (hidden["name"], hidden["name_hidden"], hidden["start_number"]) == (None, True, None)

    summary = page["summary"]
    assert summary["winner"] == {"key": people[_name(5)], "session": "rennen", "grid": 5}
    assert summary["pole"] == {"key": people[_name(3)], "time": "1:40.474", "session": "qualifying"}
    assert summary["fastest_lap"] == {"key": people[_name(3)], "session": "rennen", "time": "1:43.375"}
    assert summary["driver_of_the_day"] == {"key": people[_name(5)], "session": "rennen"}
    # Mit Namen außerhalb der Tabelle nur öffentliche Vereinsfahrer.
    assert page["club_drivers"] == [people[_name(1)]]
    assert race["best_club"] == people[_name(1)] and quali["best_club"] == people[_name(1)]
    assert race["originals"] == [] and quali["originals"] == []


@pytest.mark.asyncio
async def test_a_race_without_times_shows_only_place_team_and_points(flow):
    lineage, series, rounds = await _season(flow)
    rows = [{"place": place, "name": _name(number), "team": _team(number)} for place, number in
            enumerate(range(1, 9), start=1)]
    await _publish(flow, series, rounds[3]["id"], {"rows": rows})
    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}/rounds/2")).json()
    quali, race = page["sessions"]
    assert quali["has_result"] is False and quali["rows"] == [] and quali["columns"] == []
    assert race["columns"] == ["points"]
    assert [row["points"] for row in race["rows"][:3]] == [35, 30, 26]
    assert page["previous"]["number"] == 1 and page["next"]["number"] == 3
    assert page["summary"]["winner"]["key"] == race["rows"][0]["key"]
    assert page["summary"]["pole"] is None and page["summary"]["fastest_lap"] is None


@pytest.mark.asyncio
async def test_unknown_rounds_and_other_kinds_are_not_found(flow):
    lineage, series, _ = await _season(flow)
    team_league = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Liga", "kind": "team_league"})).json()
    other = (await flow.post(f"{ADMIN}/series", json={"lineage_id": team_league["id"], "season": "2026"})).json()
    flow.act_as(None)
    base = f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}"
    assert (await flow.get(f"{base}/rounds/9")).status_code == 404
    assert (await flow.get(f"{base}/rounds/0")).status_code == 404
    assert (await flow.get(f"{PUBLIC}/{team_league['slug']}/{other['season_slug']}/rounds/1")).status_code == 404
    assert (await flow.get(f"{PUBLIC}/{team_league['slug']}/{other['season_slug']}/statistics")).status_code == 404


@pytest.mark.asyncio
async def test_team_colors_are_set_per_season_with_a_suggestion_from_the_image(flow):
    lineage, series, rounds, _ = await _full_round(flow)
    url = f"{ADMIN}/series/{series['id']}/team-colors"
    suggested = await flow.post(f"{url}/suggestions",
                                json={"colors": {"Fremd Blau": "#3B82F6", "Fremd Rot": "#ff0000"}})
    assert suggested.status_code == 200, suggested.text
    view = (await flow.get(url)).json()
    teams = {item["team"]: item for item in view["teams"]}
    assert set(TEAMS[:2]) <= set(teams) and "Probe DarkFriday" in teams and "Probe-DarkFriday" in teams
    assert teams["Fremd Blau"] == {"team": "Fremd Blau", "color": None, "suggestion": "#3b82f6", "own": False}
    assert teams["Probe Löwen"]["own"] is True

    bad = await flow.put(url, json={"colors": {"Fremd Blau": "blau"}})
    assert bad.status_code == 422
    saved = (await flow.put(url, json={"colors": {"Fremd Blau": "#3b82f6"}})).json()
    assert {item["team"]: item["color"] for item in saved["teams"]}["Fremd Blau"] == "#3b82f6"

    # Captains dürfen vorschlagen, aber keine Farben setzen; Gäste gar nichts.
    flow.act_as(await flow.add_user(role="member", name="mitglied"))
    assert (await flow.get(url)).status_code == 403
    assert (await flow.put(url, json={"colors": {}})).status_code == 403
    assert (await flow.post(f"{url}/suggestions", json={"colors": {}})).status_code == 403


@pytest.mark.asyncio
async def test_the_season_statistics_count_only_what_happened(flow):
    lineage, series, rounds, people = await _full_round(flow)
    # Runde 2: Rennen ohne Qualifying, Fahrer 01 gewinnt von Startplatz 3 mit Pole-Marke von Hand.
    rows = [{"place": 1, "name": _name(1), "team": _team(1), "grid": 3, "marks": ["pole"]},
            {"place": 2, "name": _name(5), "team": _team(5), "grid": 1},
            {"place": 3, "name": _name(3), "team": _team(3), "grid": 2}]
    await _publish(flow, series, rounds[3]["id"], {"rows": rows})

    flow.act_as(None)
    response = await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}/statistics")
    assert response.status_code == 200, response.text
    stats = response.json()
    drivers = {row["key"]: row for row in stats["drivers"]}
    one, three, five = drivers[people[_name(1)]], drivers[people[_name(3)]], drivers[people[_name(5)]]
    assert (one["wins"], one["podiums"], one["poles"], one["races"]) == (1, 2, 1, 2)
    # Die Pole aus dem Qualifying zählt einmal, auch wenn das Rennen die Marke trägt.
    assert (three["poles"], three["fastest_laps"], three["podiums"], three["avg_grid"]) == (1, 1, 2, 1.5)
    assert (five["wins"], five["driver_of_the_day"], five["gained"], five["avg_finish"]) == (1, 1, 3, 1.5)
    assert drivers[people[_name(20)]]["dnfs"] == 1
    assert drivers[people[_name(7)]]["name"] is None and drivers[people[_name(7)]]["name_hidden"] is True
    assert stats["metrics"]["drivers"] == ["wins", "podiums", "poles", "fastest_laps", "driver_of_the_day", "dnfs",
                                           "avg_grid", "avg_finish", "gained"]
    teams = {row["team"]: row for row in stats["teams"]}
    assert teams["Probe Löwen"]["own"] is True and teams["Probe Löwen"]["wins"] == 1
    assert teams["Probe-DarkFriday"]["wins"] == 1 and teams["Probe-DarkFriday"]["own"] is True
    assert "Probe DarkFriday" not in teams


@pytest.mark.asyncio
async def test_the_share_card_names_the_round_but_never_a_driver(flow):
    lineage, series, _, _ = await _full_round(flow)
    flow.act_as(None)
    path = f"/references/series/{lineage['slug']}/{series['season_slug']}/runde/1"
    response = await flow.get("/api/seo/meta", params={"path": path})
    assert response.status_code == 200, response.text
    meta = response.json()
    assert meta["title"].startswith("R1 · Aserbaidschan · Probe Rennliga 2026")
    assert meta["robots"] == "noindex, follow" and meta["canonical"].endswith(path)
    assert "Qualifying · Rennen" in meta["description"]
    assert "Probe Fahrer" not in response.text
    missing = await flow.get("/api/seo/meta", params={"path": path.replace("/runde/1", "/runde/9")})
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_metrics_that_never_happen_stay_out(flow):
    lineage, series, rounds = await _season(flow)
    rows = [{"place": place, "name": _name(number), "team": _team(number)} for place, number in
            enumerate(range(1, 5), start=1)]
    await _publish(flow, series, rounds[1]["id"], {"rows": rows})
    flow.act_as(None)
    stats = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}/statistics")).json()
    assert stats["metrics"]["drivers"] == ["wins", "podiums", "avg_finish"]
    assert stats["metrics"]["teams"] == ["wins", "podiums", "avg_finish"]
