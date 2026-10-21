"""Rennwochenende mit Läufen (#1930) über die echten Routen: „Läufe je Runde“ als Vorgabe der Saison (auch ab Runde X
wechselnd), eine Zeile je Runde legt alle Läufe an, Qualifying zählt nicht und setzt die Pole selbst, Startplatz und
Pole des Rennens kommen aus dem Qualifying, ein Sprint hat sein eigenes Punkteschema, die Serienseite zählt Runden statt
Läufe und „Läuft gerade“ nennt den nächsten Lauf. Nur erfundene Namen und Orte."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_result_routes, reference_round_routes, reference_series_public_routes  # noqa: E402
from services import migrations, reference_running_cache  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"
QUALI_SPRINT_RACE = {"formats": [{"sessions": [
    {"label": "Qualifying", "offset": 0},
    {"label": "Sprint", "offset": 30, "points": [12, 9, 7, 6, 5, 4, 3, 2, 1]},
    {"label": "Rennen", "offset": 75}]}]}
F2 = {"formats": [
    {"from_round": 1, "sessions": [
        {"label": "Blitz-Qualifying"}, {"label": "Sprint", "offset": 30, "points": "series"},
        {"label": "Hauptrennen", "offset": 75}]},
    {"from_round": 5, "sessions": [
        {"label": "Sprint", "grid": "reverse_standings"},
        {"label": "Hauptrennen", "offset": 45, "grid": "reverse_standings"}]}]}
VENUES = ["Probering", "Testkurs", "Imola", "Monza", "Spa-Francorchamps", "Silverstone", "Zandvoort", "Suzuka"]


@pytest_asyncio.fixture
async def flow(monkeypatch):
    reference_running_cache.reset()
    instance, shutdown = make_flow()
    for module in (reference_round_routes, reference_series_public_routes, reference_result_routes):
        monkeypatch.setattr(module, "club_today", lambda: "2026-03-05")
    try:
        yield instance
    finally:
        await shutdown()


async def _series(flow, weekend=None, **rules):
    await migrations.migrate_points_scheme_templates(flow.db)
    flow.act_as(await flow.add_user(role="club_admin", name="vorstand"))
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Rennliga F2", "kind": "racing"})).json()
    body = {"lineage_id": lineage["id"], "season": "2026", "status": "active", "default_time": "20:00",
            "rules": {"points_mode": "scheme", "points_by_place": [25, 18, 15, 12], **rules}}
    if weekend is not None:
        body["weekend"] = weekend
    response = await flow.post(f"{ADMIN}/series", json=body)
    assert response.status_code == 200, response.text
    return lineage, response.json()


async def _paste(flow, series, count=8, apply=True):
    lines = [f"R{index} · {index + 7:02d}.03.2026 · {VENUES[index - 1]}" for index in range(1, count + 1)]
    response = await flow.post(f"{ADMIN}/series/{series['id']}/rounds/paste",
                               json={"text": "\n".join(lines), "apply": apply})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_eight_lines_make_eight_weekends_with_three_sessions_each(flow):
    lineage, series = await _series(flow, QUALI_SPRINT_RACE)
    preview = await _paste(flow, series, apply=False)
    assert preview["count"] == 24 and len(preview["rows"]) == 8
    assert [item["session"] for item in preview["rows"][0]["sessions"]] == ["Qualifying", "Sprint", "Rennen"]

    calendar = await _paste(flow, series)
    assert calendar["created"] == 24
    rounds = calendar["rounds"]
    assert len(rounds) == 24 and len({item["weekend"] for item in rounds}) == 8
    first = rounds[:3]
    assert [(item["code"], item["session"], item["time"], item["counts"], item["session_kind"]) for item in first] == [
        ("R1", "Qualifying", "20:00", False, "qualifying"), ("R1", "Sprint", "20:30", True, "sprint"),
        ("R1", "Rennen", "21:15", True, "race")]
    # Ein Lauf lässt sich einzeln absagen - die Runde bleibt.
    cancel = await flow.post(f"{ADMIN}/series/{series['id']}/rounds/{rounds[4]['id']}/cancel", json={})
    assert cancel.status_code == 200, cancel.text

    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()
    # Im Kalender 8 Runden - der Fortschritt zählt Runden, nicht Läufe.
    assert (page["progress"]["total"], page["progress"]["scored"], page["progress"]["cancelled"]) == (8, 0, 0)
    assert page["progress"]["next"]["session"] == "Qualifying"
    assert page["series"]["weekend"]["formats"][0]["sessions"][1]["points"][0] == 12
    assert {item["session"] for item in page["rounds"]} == {"Qualifying", "Sprint", "Rennen"}

    # Noch einmal dieselbe Zeile: den Lauf gibt es schon.
    flow.act_as(await flow.add_user(role="club_admin", name="vorstand2"))
    again = await flow.post(f"{ADMIN}/series/{series['id']}/rounds/paste",
                            json={"text": "R1 Sprint · 08.03.2026", "apply": True})
    assert again.status_code == 422
    assert again.json()["detail"]["errors"][0]["message"] == "R1 Sprint gibt es schon."


@pytest.mark.asyncio
async def test_the_format_can_change_from_a_round_on(flow):
    _, series = await _series(flow, F2)
    rounds = (await _paste(flow, series))["rounds"]
    assert len(rounds) == 4 * 3 + 4 * 2
    by_weekend: dict = {}
    for item in rounds:
        by_weekend.setdefault(item["weekend"], []).append((item["session"], item["time"]))
    assert by_weekend[4] == [("Blitz-Qualifying", "20:00"), ("Sprint", "20:30"), ("Hauptrennen", "21:15")]
    assert by_weekend[5] == [("Sprint", "20:00"), ("Hauptrennen", "20:45")]


@pytest.mark.asyncio
async def test_a_new_qualifying_does_not_count_unless_told(flow):
    _, series = await _series(flow)
    url = f"{ADMIN}/series/{series['id']}/rounds"
    quali = (await flow.post(url, json={"code": "R1", "session": " Qualifying ", "day": "2026-03-08"})).json()
    race = (await flow.post(url, json={"code": "R1", "session": "Rennen", "day": "2026-03-08"})).json()
    points = (await flow.post(url, json={"code": "R2", "session": "Quali", "day": "2026-03-15",
                                         "counts": True})).json()
    assert [(item["session"], item["counts"]) for item in (quali, race, points)] == [
        ("Qualifying", False), ("Rennen", True), ("Quali", True)]
    edited = await flow.patch(f"{url}/{race['id']}", json={"session": "Hauptrennen"})
    assert edited.json()["session"] == "Hauptrennen"
    too_long = await flow.post(url, json={"code": "R3", "session": "x" * 31, "day": "2026-03-22"})
    assert too_long.status_code == 422


@pytest.mark.asyncio
async def test_a_new_qualifying_with_points_in_the_template_counts(flow):
    _, series = await _series(flow, {"formats": [{"sessions": [{"label": "Qualifying", "points": [2]},
                                                               {"label": "Rennen", "offset": 30}]}]})
    created = await flow.post(f"{ADMIN}/series/{series['id']}/rounds",
                              json={"code": "R1", "session": "Qualifying", "day": "2026-03-08"})
    assert created.json()["counts"] is True


def _people(count=4):
    return [f"Probe Fahrer {number}" for number in range(1, count + 1)]


async def _publish(flow, series, round_id, rows):
    url = f"{ADMIN}/series/{series['id']}/rounds/{round_id}/results"
    saved = await flow.put(url, json={"rows": rows, "status": "published", "expected_version": 0})
    assert saved.status_code == 200, saved.text
    return saved.json()


@pytest.mark.asyncio
async def test_grid_and_pole_of_the_race_come_from_the_qualifying(flow):
    lineage, series = await _series(flow, {"formats": [{"sessions": [{"label": "Qualifying"}, {"label": "Rennen"}]}]},
                                    bonuses={"pole": {"points": 1}})
    rounds = (await _paste(flow, series, count=2))["rounds"]
    quali, race = rounds[0], rounds[1]
    names = _people()
    url = f"{ADMIN}/series/{series['id']}/rounds/{quali['id']}/results"
    # Qualifying mit Zeiten, ein Fahrer ohne Zeit: Platz 1 bekommt die Pole von selbst, ohne Hinweis „zählt nicht“.
    quali_rows = [{"place": 1, "name": names[2], "time": "1:21.004"}, {"place": 2, "name": names[0], "gap": "+0.359"},
                  {"place": 3, "name": names[1], "gap": "+1.200"}, {"place": 4, "name": names[3], "time": "--:--.---"}]
    preview = (await flow.post(f"{url}/preview", json={"rows": quali_rows})).json()
    assert preview["errors"] == [] and "round_not_counted" not in {item["code"] for item in preview["warnings"]}
    assert [row["marks"] for row in preview["rows"]] == [["pole"], [], [], []]
    assert preview["round"]["session_kind"] == "qualifying"
    sheet = (await _publish(flow, series, quali["id"], quali_rows))["sheet"]
    assert sheet["rows"][0]["time"] == "1:21.004" and sheet["rows"][3].get("time") is None

    # Rennen ohne Startplatz - nur einer hat eine Strafe (Startplatz 4 statt 2).
    race_rows = [{"place": 1, "name": names[0], "grid": 4}, {"place": 2, "name": names[2]},
                 {"place": 3, "name": names[1]}, {"place": 4, "name": names[3]}]
    await _publish(flow, series, race["id"], race_rows)

    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()
    rows = {row["name"]: row for row in page["standings"]["rows"]}
    grid = {name: rows[name]["results"][0].get("grid") for name in names}
    assert grid == {names[0]: 4, names[1]: 3, names[2]: 1, names[3]: 4}
    # Die Pole zählt am Rennen - mit ihrem Bonus.
    assert rows[names[2]]["results"][0]["marks"] == ["pole"]
    assert rows[names[2]]["points"] == 18 + 1
    # Das Qualifying steht nicht in der Tabelle, aber im Rennliga-Teil für Poles und Quali-Duell.
    assert [item["round_id"] for item in rows[names[0]]["results"]] == [race["id"]]
    places = page["racing"]["qualifying"]
    assert [item["round_id"] for item in places] == [quali["id"]]
    assert {rows[name]["key"]: name for name in names}[next(
        pid for pid, place in places[0]["places"].items() if place == 1)] == names[2]
    assert page["progress"]["scored"] == 1


@pytest.mark.asyncio
async def test_a_sprint_counts_with_its_own_points(flow):
    lineage, series = await _series(flow, QUALI_SPRINT_RACE)
    rounds = (await _paste(flow, series, count=1))["rounds"]
    sprint = rounds[1]
    names = _people(3)
    url = f"{ADMIN}/series/{series['id']}/rounds/{sprint['id']}/results"
    rows = [{"place": index, "name": name} for index, name in enumerate(names, start=1)]
    preview = (await flow.post(f"{url}/preview", json={"rows": rows})).json()
    assert [row["scored"]["points"] for row in preview["rows"]] == [12, 9, 7]
    loaded = (await flow.get(url)).json()
    assert loaded["series"]["rules"]["points_by_place"][:3] == [12, 9, 7]
    await _publish(flow, series, sprint["id"], rows)
    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()
    assert [row["points"] for row in page["standings"]["rows"]] == [12, 9, 7]
    # Erst wenn alle zählenden Läufe der Runde gewertet sind, ist die Runde gewertet.
    assert page["progress"]["scored"] == 0


@pytest.mark.asyncio
async def test_changing_the_weekend_template_recomputes_and_is_logged(flow):
    lineage, series = await _series(flow, QUALI_SPRINT_RACE)
    rounds = (await _paste(flow, series, count=1))["rounds"]
    rows = [{"place": index, "name": name} for index, name in enumerate(_people(2), start=1)]
    await _publish(flow, series, rounds[1]["id"], rows)
    same_as_race = {"formats": [{"sessions": [{"label": "Qualifying"}, {"label": "Sprint", "offset": 30},
                                              {"label": "Rennen", "offset": 75}]}]}
    changed = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"weekend": same_as_race})
    assert changed.status_code == 200, changed.text
    assert changed.json()["weekend"]["formats"][0]["sessions"][1]["points"] == "series"
    log = await flow.db.audit_logs.find_one({"action": "reference_series.weekend_change"}, {"_id": 0})
    assert log["data"]["previous"]["formats"][0]["sessions"][1]["points"][0] == 12
    broken = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"weekend": {"formats": [{"sessions": []}]}})
    assert broken.status_code == 422
    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()
    assert [row["points"] for row in page["standings"]["rows"]] == [25, 18]


@pytest.mark.asyncio
async def test_running_names_the_next_session_and_its_weekend(flow):
    _, series = await _series(flow, QUALI_SPRINT_RACE)
    await flow.post(f"{ADMIN}/series/{series['id']}/rounds/paste",
                    json={"text": "R1 · 05.03.2026 · Probering\nR2 · 12.03.2026 · Testkurs", "apply": True})
    flow.act_as(None)
    body = (await flow.get(f"{PUBLIC}/running")).json()
    item = body["items"][0]
    assert item["today"] is True and item["progress"] == {"total": 2, "scored": 0}
    assert (item["next"]["code"], item["next"]["session"], item["next"]["time"]) == ("R1", "Qualifying", "20:00")
    assert [(entry["session"], entry["time"], entry["next"]) for entry in item["next"]["sessions"]] == [
        ("Qualifying", "20:00", True), ("Sprint", "20:30", False), ("Rennen", "21:15", False)]
