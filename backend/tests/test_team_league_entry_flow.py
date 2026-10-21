"""Team-Liga einfacher eintragen (#1931) über die echten Routen: Terminliste mit Gegner („vs“/„@“) und
Spieltag-Zeitraum, Termin mit Heim/Auswärts und Ende des Spieltags, Kader einfügen und ein Spieltag mit allen Spielen.
Nur erfundene Teamnamen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_round_routes, reference_series_public_routes  # noqa: E402
from services import migrations  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"
OWN = "Probe Löwen"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-05-15")
    monkeypatch.setattr(reference_series_public_routes, "club_today", lambda: "2026-05-15")
    try:
        yield instance
    finally:
        await shutdown()


async def _setup(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={
        "title": "Probe Liga S&D 4vs4", "kind": "team_league", "organizer": "Probe Verband"})).json()
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2026", "team_name": OWN, "default_time": "20:00",
        "status": "active"})).json()
    return admin, lineage, series


def _rounds(series):
    return f"{ADMIN}/series/{series['id']}/rounds"


# ---------------------------------------------------------------- Terminliste
@pytest.mark.asyncio
async def test_a_pasted_list_keeps_opponent_side_and_matchday_window(flow):
    _, lineage, series = await _setup(flow)
    text = "ST1 · 06.05.2026 20:30 · vs Probe Falken\nST2 · 13.05.–17.05. · @ Probe Wölfe\nST3 · 20.05. · Probe Arena"
    preview = await flow.post(f"{_rounds(series)}/paste", json={"text": text})
    assert preview.status_code == 200, preview.text
    assert [(row["opponent"], row["at_home"], row["day_end"]) for row in preview.json()["rows"]] == [
        ("Probe Falken", True, None), ("Probe Wölfe", False, "2026-05-17"), (None, None, None)]

    applied = await flow.post(f"{_rounds(series)}/paste", json={"text": text, "apply": True})
    assert applied.status_code == 200, applied.text
    rounds = applied.json()["rounds"]
    assert [(item["code"], item["opponent"], item["at_home"], item["club_day_end"], item["venue"], item["state"])
            for item in rounds] == [
        ("ST1", "Probe Falken", True, None, None, "missing"),
        ("ST2", "Probe Wölfe", False, "2026-05-17", None, "today"),
        ("ST3", None, None, None, "Probe Arena", "planned")]

    flow.act_as(None)
    public = await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}/calendar")
    assert public.status_code == 200, public.text
    second = public.json()["rounds"][1]
    assert (second["opponent"], second["at_home"], second["club_day_end"]) == ("Probe Wölfe", False, "2026-05-17")

    # Übersicht der laufenden Saisons: der nächste Spieltag nennt den Gegner samt Seite und Zeitraum.
    running = await flow.get(f"{PUBLIC}/running")
    assert running.status_code == 200, running.text
    upcoming = running.json()["items"][0]["next"]
    assert (upcoming["code"], upcoming["opponent"], upcoming["at_home"], upcoming["club_day_end"]) == (
        "ST2", "Probe Wölfe", False, "2026-05-17")


@pytest.mark.asyncio
async def test_a_round_takes_side_and_window_and_refuses_an_end_before_its_day(flow):
    _, _, series = await _setup(flow)
    created = await flow.post(_rounds(series), json={
        "code": "ST1", "day": "2026-05-20", "opponent": "Probe Adler", "at_home": False, "day_end": "2026-05-24"})
    assert created.status_code == 200, created.text
    doc = created.json()
    assert (doc["at_home"], doc["club_day_end"]) == (False, "2026-05-24")

    edited = await flow.patch(f"{_rounds(series)}/{doc['id']}", json={"at_home": True, "day_end": None})
    assert edited.status_code == 200, edited.text
    assert (edited.json()["at_home"], edited.json()["club_day_end"]) == (True, None)

    before = await flow.patch(f"{_rounds(series)}/{doc['id']}", json={"day_end": "2026-05-19"})
    assert before.status_code == 422
    moved = await flow.patch(f"{_rounds(series)}/{doc['id']}", json={"day_end": "2026-05-22"})
    assert moved.status_code == 200
    later = await flow.patch(f"{_rounds(series)}/{doc['id']}", json={"day": "2026-05-23"})
    assert later.status_code == 422, "Ein neuer Tag nach dem Ende des Spieltags passt nicht."


@pytest.mark.asyncio
async def test_postponing_a_matchday_drops_its_window(flow):
    _, _, series = await _setup(flow)
    doc = (await flow.post(_rounds(series), json={"code": "ST1", "day": "2026-05-20", "day_end": "2026-05-24"})).json()
    moved = await flow.post(f"{_rounds(series)}/{doc['id']}/postpone", json={"day": "2026-05-28", "time": "20:00"})
    assert moved.status_code == 200, moved.text
    assert (moved.json()["club_day"], moved.json()["club_day_end"]) == ("2026-05-28", None)


# ---------------------------------------------------------------- Kader
async def _roster(flow, series, team, names):
    response = await flow.post(f"{ADMIN}/series/{series['id']}/participants/batch", json={"names": names, "team": team})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_a_pasted_roster_creates_new_players_and_assigns_known_ones_to_the_team(flow):
    _, _, series = await _setup(flow)
    first = await _roster(flow, series, OWN, ["Probe Anna", "Probe Bert"])
    assert [(row["name"], row["default_team"]) for row in first["created"]] == [
        ("Probe Anna", OWN), ("Probe Bert", OWN)]
    again = await _roster(flow, series, "Probe Löwen B", ["probe bert", "Probe Cleo"])
    assert [row["name"] for row in again["created"]] == ["Probe Cleo"]
    assert [(row["name"], row["default_team"]) for row in again["assigned"]] == [("Probe Bert", "Probe Löwen B")]
    stored = {row["name"]: row["default_team"] async for row in flow.db.reference_participants.find({})}
    assert stored == {"Probe Anna": OWN, "Probe Bert": "Probe Löwen B", "Probe Cleo": "Probe Löwen B"}


# ---------------------------------------------------------------- Spieltag
async def _matchday(flow, series, code="ST1", day="2026-05-13"):
    response = await flow.post(_rounds(series), json={"code": code, "day": day, "opponent": "Probe Falken",
                                                      "at_home": True})
    assert response.status_code == 200, response.text
    return response.json()


def _sheet(**own):
    return {"matches": [
        {"home": OWN, "away": "Probe Falken", "home_score": 2, "away_score": 1, "day": "2026-05-14", "time": "21:15",
         "maps": [{"name": "Karte Ost", "role": "banned", "by": "own"},
                  {"name": "Karte Hafen", "role": "banned", "by": "opponent"},
                  {"name": "Karte Nord", "home_score": 6, "away_score": 3, "role": "picked", "by": "own",
                   "lineup": [{"name": "Probe Anna"}, {"name": "Probe Bert"}]},
                  {"name": "Karte Süd", "home_score": 4, "away_score": 6, "role": "picked", "by": "opponent",
                   "lineup": [{"name": "Probe Anna"}, {"name": "Probe Cleo"}]},
                  {"name": "Karte West", "home_score": 6, "away_score": 5, "role": "decider"}],
         **own},
        {"home": "Probe Adler", "away": "Probe Eulen", "home_score": 0, "away_score": 2},
        {"home": "Probe Wölfe", "away": "Probe Bären", "home_score": 1, "away_score": 1},
    ]}


@pytest.mark.asyncio
async def test_a_matchday_with_the_other_matches_saves_maps_bans_time_and_lineups(flow):
    _, _, series = await _setup(flow)
    await _roster(flow, series, OWN, ["Probe Anna", "Probe Bert", "Probe Cleo", "Probe Dora"])
    round_doc = await _matchday(flow, series)
    base = f"{ADMIN}/series/{series['id']}/rounds/{round_doc['id']}/results"

    loaded = await flow.get(base)
    assert loaded.status_code == 200, loaded.text
    assert loaded.json()["series"]["own_team_list"] == [{"name": OWN, "aliases": []}]
    assert loaded.json()["round"]["at_home"] is True
    assert loaded.json()["series"]["map_names"] == []

    preview = await flow.post(f"{base}/preview", json=_sheet())
    assert preview.status_code == 200, preview.text
    assert preview.json()["errors"] == []
    assert "own_team_missing" not in [item["code"] for item in preview.json()["warnings"]]

    saved = await flow.put(base, json={**_sheet(), "status": "published", "expected_version": 0})
    assert saved.status_code == 200, saved.text
    ids = {row["name"]: row["id"] async for row in flow.db.reference_participants.find({})}
    own = saved.json()["sheet"]["matches"][0]
    assert own["lineup"] == [ids["Probe Anna"], ids["Probe Bert"], ids["Probe Cleo"]]
    assert [(item.get("role"), item.get("by"), item.get("lineup")) for item in own["maps"]] == [
        ("banned", "own", None), ("banned", "opponent", None),
        ("picked", "own", [ids["Probe Anna"], ids["Probe Bert"]]),
        ("picked", "opponent", [ids["Probe Anna"], ids["Probe Cleo"]]), ("decider", None, None)]
    assert (own["club_day"], own["time"], own["starts_at"]) == ("2026-05-14", "21:15", "2026-05-14T19:15:00+00:00")
    assert len(saved.json()["sheet"]["matches"]) == 3

    # Ohne Tabelle laut Veranstalter rechnet die Tabelle aus allen eingetragenen Spielen des Spieltags.
    table = await flow.db.reference_standings.find_one({"series_id": series["id"], "scope": "table"})
    assert sorted(row["team"] for row in table["rows"]) == sorted(
        [OWN, "Probe Falken", "Probe Adler", "Probe Eulen", "Probe Wölfe", "Probe Bären"])

    # Vorschläge für die Map-Namen beim nächsten Spieltag: was in der Saison schon steht, häufigste zuerst.
    second = await _matchday(flow, series, code="ST2", day="2026-05-20")
    again = await flow.get(f"{ADMIN}/series/{series['id']}/rounds/{second['id']}/results")
    assert again.json()["series"]["map_names"] == ["Karte Hafen", "Karte Nord", "Karte Ost", "Karte Süd", "Karte West"]
