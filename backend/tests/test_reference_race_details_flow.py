"""Rennliga einfach eintragen (#1925, #1926, #1927) über die echten Routen, im Umfang einer großen Rennliga: 24 Rennen
als Terminliste eingefügt (Flaggen aus den Strecken), Punkteschema 35-30-26-…-1, 20 Fahrer in drei eigenen und
weiteren Teams, ein Rennen mit Startnummer, Startplatz, Zeit, Abstand, Ausfall, schnellster Runde mit Zeit und Fahrer
des Tages - so, wie die Texterkennung (#1756) es liefert. Nur erfundene Namen."""
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
VENUES = ["Australien", "China (Shanghai)", "Suzuka", "Bahrain", "Saudi-Arabien", "USA (Miami)", "Imola", "Monaco",
          "Spanien (Barcelona)", "Kanada", "Österreich", "Silverstone", "Spa-Francorchamps", "Ungarn", "Zandvoort",
          "Monza", "Aserbaidschan", "Singapur", "COTA", "Mexiko", "Interlagos", "Las Vegas", "Lusail", "Yas Marina"]
CODES = ["AU", "CN", "JP", "BH", "SA", "US", "IT", "MC", "ES", "CA", "AT", "GB", "BE", "HU", "NL", "IT", "AZ", "SG",
         "US", "MX", "BR", "US", "QA", "AE"]
TEAMS = ["Probe Löwen", "Probe Löwen B", "Probe-DarkFriday", "Fremd Rot", "Fremd Blau", "Fremd Grün", "Fremd Gelb",
         "Fremd Weiß", "Fremd Grau", "Fremd Lila"]


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


def _row(place, number):
    team = TEAMS[(number - 1) // 2]
    # Der Veranstalter schreibt das dritte eigene Team ohne Bindestrich.
    shown = "Probe DarkFriday" if team == "Probe-DarkFriday" else team
    return {"place": place, "name": f"Probe Fahrer {number:02d}", "start_number": str(number), "team": shown,
            "grid": 21 - place, "time": "1:32:45.123" if place == 1 else None,
            "gap": None if place == 1 else f"+{place * 1.5:.3f}"}


@pytest.mark.asyncio
async def test_a_whole_race_from_a_results_graphic_reaches_the_racing_page(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    flow.act_as(await flow.add_user(role="club_admin", name="vorstand"))
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Rennliga", "kind": "racing"})).json()
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2026", "status": "active", "default_time": "20:00",
        "own_teams": [{"name": "Probe Löwen"}, {"name": "Probe Löwen B"}, {"name": "Probe-DarkFriday"}],
        "rules": {"points_mode": "scheme", "points_by_place": SCHEME, "tiebreakers": ["countback"],
                  "bonuses": {"fastest_lap": {"points": 1, "max_place": 10}},
                  "team_scoring": {"enabled": True, "counting_drivers": 2, "guests_count": True}}})).json()
    lines = [f"R{index} · {(index - 1) % 4 * 7 + 1:02d}.{(index - 1) // 4 + 3:02d}.2026 · {venue}"
             for index, venue in enumerate(VENUES, start=1)]
    pasted = await flow.post(f"{ADMIN}/series/{series['id']}/rounds/paste",
                             json={"text": "\n".join(lines), "apply": True})
    assert pasted.status_code == 200, pasted.text
    rounds = pasted.json()["rounds"]
    assert len(rounds) == 24
    assert [item["country_code"] for item in rounds] == CODES

    # Rennen 1: 20 Fahrer - 19 im Ziel, einer fällt aus; schnellste Runde und Fahrer des Tages wie aus der Grafik.
    rows = [_row(place, number) for place, number in enumerate(range(1, 20), start=1)]
    rows.append({"place": None, "name": "Probe Fahrer 20", "start_number": "20", "team": "Fremd Lila", "grid": 1,
                 "dnf": True})
    body = {"rows": rows, "fastest_lap": {"name": "Probe Fahrer 03", "time": "1:31.456"},
            "driver_of_the_day": "Probe Fahrer 05", "status": "published", "expected_version": 0}
    url = f"{ADMIN}/series/{series['id']}/rounds/{rounds[0]['id']}/results"
    preview = await flow.post(f"{url}/preview", json=body)
    assert preview.status_code == 200, preview.text
    assert preview.json()["errors"] == []
    saved = await flow.put(url, json=body)
    assert saved.status_code == 200, saved.text
    sheet = saved.json()["sheet"]
    assert sheet["fastest_lap"]["time"] == "1:31.456"
    assert sheet["rows"][19]["marks"] == ["dnf"]
    assert sheet["rows"][2]["marks"] == ["fastest_lap"]

    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()
    by_name = {row["name"]: row for row in page["standings"]["rows"]}
    winner = by_name["Probe Fahrer 01"]["results"][0]
    assert (winner["place"], winner["points"], winner["grid"], winner["time"], winner["start_number"]) == (
        1, 35, 20, "1:32:45.123", "1")
    third = by_name["Probe Fahrer 03"]["results"][0]
    assert (third["points"], third["fastest_lap_time"], third["gap"]) == (27, "1:31.456", "+4.500")
    assert by_name["Probe Fahrer 05"]["results"][0]["driver_of_the_day"] is True
    out = by_name["Probe Fahrer 20"]["results"][0]
    assert (out["marks"], out["grid"], out["points"]) == (["dnf"], 1, 0)
    assert "driver_of_the_day" not in winner and "fastest_lap_time" not in winner

    racing = page["racing"]
    # Drei eigene Teams in der Garage - „Probe DarkFriday“ aus der Grafik ist das eigene „Probe-DarkFriday“.
    assert set(racing["club_teams"]) == {"Probe Löwen", "Probe Löwen B", "Probe-DarkFriday"}
    teams = {row["team"]: row["points"] for row in racing["teams"]["rows"]}
    assert teams["Probe Löwen"] == 35 + 30 and teams["Probe-DarkFriday"] == 20 + 17
    assert "Probe DarkFriday" not in teams
