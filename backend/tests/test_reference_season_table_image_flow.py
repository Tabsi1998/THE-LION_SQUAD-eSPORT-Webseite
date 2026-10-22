"""Saison- und Teamtabelle per Bild (#1999) über die echten Routen - die Texterkennung nachgestellt: nur Vorstand,
nicht in der Team-Liga, ohne Tesseract 503, Namen gegen Teilnehmer bzw. Teams der Saison, „kein Ergebnis“
(``NOT_A_RESULT``) gilt hier nicht, gespeichert wird beim Lesen nichts. Dazu die Teamwertung laut Veranstalter für die
gewählte Runde (Vorgabe: die letzte gewertete) mit Vorschau samt eigener Rechnung und Übernehmen mit Version,
Revision, Protokoll und Entwurf daneben. Nur erfundene Namen."""
import pathlib
import sys
from datetime import date, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import season_table_image_fixture as fixture  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import migrations, reference_running_cache, result_image_ocr, result_image_table  # noqa: E402
from services.dolibarr_policy import club_today  # noqa: E402
from services.result_image_table import TableCell, TableReading  # noqa: E402

ADMIN = "/api/reference-series/admin"
PNG = {"Content-Type": "image/png"}
F1 = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "season-image-tests-secret-with-32-characters")
    reference_running_cache.reset()
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


def _reading(names, kind_label="Team"):
    reading = TableReading(kinds=["rank", "name", "round", "round", "total", "gap"],
                           labels=["Pos.", kind_label, "Runde 1", "Runde 2", "Punkte", "Dif."], header_found=True,
                           text_height=12, mean_conf=92)
    top = None
    for index, (name, first, second) in enumerate(names, start=1):
        total = first + second
        top = total if top is None else top
        reading.rows.append([TableCell(text=str(index), value=index), TableCell(text=name, sure=False),
                             TableCell(text=str(first), value=first), TableCell(text=str(second), value=second),
                             TableCell(text=str(total), value=total),
                             TableCell(text="--", absent=True) if index == 1 else
                             TableCell(text=str(total - top), value=total - top)])
        reading.notes.append([])
    return reading


@pytest.fixture
def fake_table(monkeypatch):
    class Fake:
        reading = _reading([("Probe Rotr", 25, 18), ("Probe Blau", 18, 15)])
        calls = 0

    def read(image, template, *, max_rows=None, sums=True):
        Fake.calls += 1
        assert image.mode == "RGB" and template["id"] == "saisontabelle" and max_rows == 300
        assert sums is False  # die Summenprobe macht die Route - je nach Fahrer- oder Teamtabelle
        return Fake.reading

    monkeypatch.setattr(result_image_ocr, "available", lambda: True)
    monkeypatch.setattr(result_image_table, "read_table", read)
    return Fake


def _png() -> bytes:
    return fixture.png_bytes(fixture.render())


async def _season(flow, *, kind="racing", team_scoring=True, rules=None):
    await migrations.migrate_points_scheme_templates(flow.db)
    board = await flow.add_user(role="club_admin", name="vorstand-vera")
    flow.act_as(board)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Rennliga", "kind": kind})).json()
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2026", "status": "active",
        "rules": {"points_mode": "scheme", "points_by_place": F1, "tiebreakers": ["countback"],
                  "team_scoring": {"enabled": team_scoring, "counting_drivers": 2, "guests_count": True},
                  **(rules or {})}})).json()
    start = date.fromisoformat(club_today()) - timedelta(days=40)
    lines = [f"R{index} · {(start + timedelta(days=7 * index)).strftime('%d.%m.%Y')} · Probe Strecke {index}"
             for index in range(1, 4)]
    pasted = await flow.post(f"{ADMIN}/series/{series['id']}/rounds/paste", json={"text": "\n".join(lines),
                                                                                  "apply": True})
    assert pasted.status_code == 200, pasted.text
    return board, series, pasted.json()["rounds"]


async def _sheet(flow, series, rnd, rows, status="published", expected=0):
    saved = await flow.put(f"{ADMIN}/series/{series['id']}/rounds/{rnd['id']}/results",
                           json={"rows": rows, "status": status, "expected_version": expected})
    assert saved.status_code == 200, saved.text
    return saved.json()


ROWS = [{"name": "Ada Ausgedacht", "place": 1, "team": "Probe Rot"},
        {"name": "Bruno Beispiel", "place": 2, "team": "Probe Blau"},
        {"name": "Cleo Muster", "place": 3, "team": "Probe Rot"}]


# ---------------------------------------------------------------- Bild lesen
@pytest.mark.asyncio
async def test_only_the_board_reads_a_table_image_and_nothing_is_stored(flow, fake_table):
    board, series, _ = await _season(flow)
    url = f"{ADMIN}/series/{series['id']}/season-table/image"
    captain = await flow.add_user(role="user", name="captain-carl")
    await flow.db.reference_series_staff.insert_one({
        "id": "staff-1", "series_id": series["id"], "user_id": captain["id"], "role": "captain",
        "valid_until": (date.fromisoformat(club_today()) + timedelta(days=30)).isoformat()})
    await flow.db.memberships.insert_one({"user_id": captain["id"], "member_status": "active"})
    flow.act_as(captain)
    assert (await flow.get(url)).status_code == 403
    assert (await flow.post(url, content=_png(), headers=PNG)).status_code == 403
    flow.act_as(board)
    info = (await flow.get(url)).json()
    assert info["available"] is True and info["template"]["id"] == "saisontabelle"
    read = await flow.post(f"{url}?table=teams", content=_png(), headers=PNG)
    assert read.status_code == 200, read.text
    data = read.json()
    assert [column["kind"] for column in data["columns"]] == ["rank", "name", "round", "round", "total", "gap"]
    assert data["kind"] == "teams" and data["rows"][1]["cells"] == ["2", "Probe Blau", "18", "15", "33", "-10"]
    assert fake_table.calls == 1
    assert await flow.db.reference_round_results.count_documents({}) == 0


@pytest.mark.asyncio
async def test_names_are_matched_against_the_season(flow, fake_table):
    _, series, rounds = await _season(flow)
    await _sheet(flow, series, rounds[0], ROWS)
    url = f"{ADMIN}/series/{series['id']}/season-table/image"
    # Teams: „Probe Rotr“ ist „Probe Rot“ - nur ähnlich, darum gelb; „Probe Blau“ sicher.
    teams = (await flow.post(f"{url}?table=teams", content=_png(), headers=PNG)).json()
    assert [row["cells"][1] for row in teams["rows"]] == ["Probe Rot", "Probe Blau"]
    assert 1 in teams["rows"][0]["uncertain"] and teams["rows"][0]["read"]["1"] == "Probe Rotr"
    # Fahrer: gegen die Teilnehmer der Saison.
    fake_table.reading = _reading([("Ada Ausgedaht", 25, 18), ("Neu Name", 18, 15)], "Fahrer")
    drivers = (await flow.post(f"{url}?table=drivers", content=_png(), headers=PNG)).json()
    assert [row["cells"][1] for row in drivers["rows"]] == ["Ada Ausgedacht", "Neu Name"]
    assert drivers["kind"] == "drivers"


@pytest.mark.asyncio
async def test_no_table_unavailable_and_team_league_are_refused(flow, fake_table, monkeypatch):
    board, series, _ = await _season(flow)
    url = f"{ADMIN}/series/{series['id']}/season-table/image"
    fake_table.reading = TableReading(kinds=["round", "round"], labels=["Runde 1", "Runde 2"])
    assert (await flow.post(url, content=_png(), headers=PNG)).status_code == 422
    monkeypatch.setattr(result_image_ocr, "available", lambda: False)
    assert (await flow.post(url, content=_png(), headers=PNG)).status_code == 503
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Liga", "kind": "team_league"})).json()
    league = (await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2026"})).json()
    monkeypatch.setattr(result_image_ocr, "available", lambda: True)
    assert (await flow.post(f"{ADMIN}/series/{league['id']}/season-table/image", content=_png(),
                            headers=PNG)).status_code == 409


def _with_totals(reading, totals):
    for row, total in zip(reading.rows, totals):
        row[4] = TableCell(text=str(total), value=total)
    return reading


@pytest.mark.asyncio
async def test_a_different_sum_is_a_hint_for_teams_and_explained_for_drivers(flow, fake_table):
    _, series, _ = await _season(flow, rules={"count_mode": "best_n", "count_n": 1})
    url = f"{ADMIN}/series/{series['id']}/season-table/image"
    # Teamtabelle: „Punkte“ als aktuelle Besetzung (#1960) weicht von den Zellen ab - nur ein Hinweis.
    fake_table.reading = _with_totals(_reading([("Probe Rot", 25, 18), ("Probe Blau", 18, 15)]), [40, 33])
    teams = (await flow.post(f"{url}?table=teams", content=_png(), headers=PNG)).json()
    assert teams["rows"][0]["uncertain"] == [1] and teams["rows"][0]["notes"] == ["Summe der Runden 43 ≠ Punkte 40"]
    # Fahrertabelle mit „beste 1“: 25 statt 43 ist das Streichresultat - erklärt, nichts gelb.
    fake_table.reading = _with_totals(_reading([("Ada Ausgedacht", 25, 18), ("Bruno Beispiel", 18, 15)], "Fahrer"),
                                      [25, 30])
    drivers = (await flow.post(f"{url}?table=drivers", content=_png(), headers=PNG)).json()
    assert drivers["rows"][0]["notes"] == ["Summe der Runden 43, Punkte 25 – erklärt: Streichresultate −18"]
    assert 2 not in drivers["rows"][0]["uncertain"] and 3 not in drivers["rows"][0]["uncertain"]
    # 33 statt 30 erklärt nichts - die Zahlenzellen der Zeile werden gelb.
    assert {2, 3} <= set(drivers["rows"][1]["uncertain"])
    # Eine Team-Tabelle bleibt eine, auch ohne ?table=teams.
    fake_table.reading = _with_totals(_reading([("Probe Rot", 25, 18), ("Probe Blau", 18, 15)]), [40, 33])
    fake_table.reading.detected = "teams"
    detected = (await flow.post(url, content=_png(), headers=PNG)).json()
    assert detected["kind"] == "teams" and detected["rows"][0]["uncertain"] == [1]


# ---------------------------------------------------------------- Teamwertung laut Veranstalter
@pytest.mark.asyncio
async def test_team_totals_go_to_the_last_scored_round_with_a_preview(flow):
    _, series, rounds = await _season(flow)
    await _sheet(flow, series, rounds[0], ROWS)
    await _sheet(flow, series, rounds[1], ROWS)
    await _sheet(flow, series, rounds[2], ROWS, status="draft")
    url = f"{ADMIN}/series/{series['id']}/team-totals"
    totals = {"Probe Rot": 80, "Probe Blau": 30, "Probe Lila": 5}
    preview = await flow.post(f"{url}/preview", json={"totals": totals})
    assert preview.status_code == 200, preview.text
    data = preview.json()
    assert data["round"]["id"] == rounds[1]["id"]  # die letzte gewertete Runde, nicht der Entwurf in R3
    assert [item["id"] for item in data["rounds"]] == [item["id"] for item in rounds]
    by_team = {row["team"]: row for row in data["rows"]}
    # Eigene Rechnung bleibt als Prüfhinweis: Probe Rot 2 × (25 + 15) = 80, Probe Blau 2 × 18 = 36.
    assert (by_team["Probe Rot"]["computed_points"], by_team["Probe Rot"]["official_points"]) == (80, 80)
    assert (by_team["Probe Blau"]["computed_points"], by_team["Probe Blau"]["deviation"]) == (36, -6)
    assert data["unknown_teams"] == ["Probe Lila"] and data["team_scoring"] is True
    assert await flow.db.reference_round_results.count_documents({"official_team_totals.Probe Rot": 80}) == 0

    other = (await flow.post(f"{url}/preview", json={"totals": totals, "round_id": rounds[0]["id"]})).json()
    assert other["round"]["id"] == rounds[0]["id"]
    saved = await flow.put(url, json={"totals": totals, "round_id": rounds[1]["id"],
                                      "expected_version": data["expected_version"]})
    assert saved.status_code == 200, saved.text
    assert saved.json()["recomputed"] is True
    sheet = await flow.db.reference_round_results.find_one({"round_id": rounds[1]["id"]}, {"_id": 0})
    assert sheet["official_team_totals"] == totals and sheet["status"] == "published"
    assert await flow.db.reference_round_result_revisions.count_documents({"round_id": rounds[1]["id"],
                                                                           "reason": "team_totals"}) == 1
    assert await flow.db.audit_logs.count_documents({"action": "reference_result.team_totals"}) == 1
    stale = await flow.put(url, json={"totals": totals, "round_id": rounds[1]["id"],
                                      "expected_version": data["expected_version"]})
    assert stale.status_code == 409


@pytest.mark.asyncio
async def test_a_draft_beside_the_sheet_gets_the_same_team_totals(flow):
    _, series, rounds = await _season(flow)
    first = await _sheet(flow, series, rounds[0], ROWS)
    # Ein Entwurf daneben (wie aus der Saisontabelle): beim Freigeben gälten sonst die alten Werte.
    await flow.db.reference_round_results.update_one({"round_id": rounds[0]["id"]}, {"$set": {
        "pending_draft": {"rows": [], "official_team_totals": {}, "created_by": "x"}}})
    url = f"{ADMIN}/series/{series['id']}/team-totals"
    saved = await flow.put(url, json={"totals": {"Probe Rot": 1}, "round_id": rounds[0]["id"],
                                      "expected_version": first["version"]})
    assert saved.status_code == 200, saved.text
    sheet = await flow.db.reference_round_results.find_one({"round_id": rounds[0]["id"]}, {"_id": 0})
    assert sheet["pending_draft"]["official_team_totals"] == {"Probe Rot": 1}
    assert (await flow.post(f"{url}/preview", json={"totals": {}, "round_id": rounds[2]["id"]})).status_code == 409
