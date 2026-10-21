"""Flagge je Termin (#1925) über die echten Routen: das Land kommt beim Anlegen und Einfügen aus Ort oder Strecke,
bleibt bei Kein-Treffer leer, ist im Termin wählbar und bleibt dann auch bei einer neuen Strecke. Die Serienseite,
„Läuft gerade“ und das Ergebnisblatt tragen den Code; bestehende Termine füllt eine Migration - nur leere Felder.
Nur erfundene Namen."""
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


@pytest_asyncio.fixture
async def flow(monkeypatch):
    reference_running_cache.reset()
    instance, shutdown = make_flow()
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-06-01")
    monkeypatch.setattr(reference_series_public_routes, "club_today", lambda: "2026-06-01")
    try:
        yield instance
    finally:
        await shutdown()


async def _setup(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Rennliga", "kind": "racing"})).json()
    series = (await flow.post(f"{ADMIN}/series", json={
        "lineage_id": lineage["id"], "season": "2026", "status": "active", "default_time": "20:00"})).json()
    return lineage, series


def _rounds(series):
    return f"{ADMIN}/series/{series['id']}/rounds"


@pytest.mark.asyncio
async def test_the_country_comes_from_the_venue_and_a_chosen_flag_stays(flow):
    _, series = await _setup(flow)
    monza = (await flow.post(_rounds(series), json={"code": "R1", "venue": "Monza", "day": "2026-06-04"})).json()
    assert (monza["country_code"], monza["country_auto"]) == ("IT", True)
    unknown = (await flow.post(_rounds(series), json={"code": "R2", "venue": "Probe-Ring", "day": "2026-06-11"})).json()
    assert (unknown["country_code"], unknown["country_auto"]) == (None, True)
    titled = (await flow.post(_rounds(series), json={"code": "R3", "title": "GP von Belgien",
                                                     "day": "2026-06-18"})).json()
    assert titled["country_code"] == "BE"

    # Automatisch: eine neue Strecke bringt das neue Land.
    moved = await flow.patch(f"{_rounds(series)}/{monza['id']}", json={"venue": "Baku"})
    assert moved.status_code == 200, moved.text
    assert (moved.json()["country_code"], moved.json()["country_auto"]) == ("AZ", True)

    # Von Hand gewählt: bleibt, auch wenn sich die Strecke danach ändert.
    chosen = await flow.patch(f"{_rounds(series)}/{monza['id']}", json={"country_auto": False, "country_code": "fr"})
    assert (chosen.json()["country_code"], chosen.json()["country_auto"]) == ("FR", False)
    kept = await flow.patch(f"{_rounds(series)}/{monza['id']}", json={"venue": "Imola"})
    assert (kept.json()["venue"], kept.json()["country_code"]) == ("Imola", "FR")
    # „Ohne Flagge“ von Hand und zurück auf automatisch.
    none = await flow.patch(f"{_rounds(series)}/{monza['id']}", json={"country_auto": False, "country_code": None})
    assert (none.json()["country_code"], none.json()["country_auto"]) == (None, False)
    back = await flow.patch(f"{_rounds(series)}/{monza['id']}", json={"country_auto": True})
    assert (back.json()["country_code"], back.json()["country_auto"]) == ("IT", True)

    wrong = await flow.patch(f"{_rounds(series)}/{monza['id']}", json={"country_auto": False, "country_code": "XX"})
    assert wrong.status_code == 422
    log = await flow.db.audit_logs.find_one({"action": "reference_round.update", "data.after.country_code": "FR"})
    assert log is not None


@pytest.mark.asyncio
async def test_a_pasted_calendar_sets_the_country_per_line(flow):
    lineage, series = await _setup(flow)
    text = "R1 · 18.06.2026 · Aserbaidschan\nR2 · 25.06.2026 · USA (Miami)\nR3 · 02.07.2026 · Probe-Ring"
    preview = await flow.post(f"{_rounds(series)}/paste", json={"text": text})
    assert preview.status_code == 200, preview.text
    assert [row["country_code"] for row in preview.json()["rows"]] == ["AZ", "US", None]
    applied = await flow.post(f"{_rounds(series)}/paste", json={"text": text, "apply": True})
    assert applied.status_code == 200, applied.text
    stored = await flow.db.reference_rounds.find({"series_id": series["id"]}, {"_id": 0}).to_list(None)
    assert sorted((item["code"], item["country_code"], item["country_auto"]) for item in stored) == [
        ("R1", "AZ", True), ("R2", "US", True), ("R3", None, True)]

    flow.act_as(None)
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()
    assert [item["country_code"] for item in page["rounds"]] == ["AZ", "US", None]
    calendar = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}/calendar")).json()
    assert calendar["rounds"][0]["country_code"] == "AZ"
    running = (await flow.get(f"{PUBLIC}/running")).json()
    assert running["items"][0]["next"]["country_code"] == "AZ"


@pytest.mark.asyncio
async def test_the_result_sheet_names_the_country_of_its_round(flow):
    _, series = await _setup(flow)
    round_doc = (await flow.post(_rounds(series), json={"code": "R1", "venue": "Suzuka", "day": "2026-05-28"})).json()
    sheet = await flow.get(f"{_rounds(series)}/{round_doc['id']}/results")
    assert sheet.status_code == 200, sheet.text
    assert sheet.json()["round"]["country_code"] == "JP"


@pytest.mark.asyncio
async def test_the_migration_fills_only_empty_countries(flow):
    _, series = await _setup(flow)
    base = {"series_id": series["id"], "status": "planned", "archived_at": None, "order": 1}
    await flow.db.reference_rounds.insert_many([
        {**base, "id": "alt-1", "venue": "Silverstone"},
        {**base, "id": "alt-2", "venue": "Monza", "country_code": "SM"},
        {**base, "id": "alt-3", "venue": "Probe-Ring"},
        {**base, "id": "alt-4", "venue": "Zandvoort", "country_code": None, "country_auto": False},
        {**base, "id": "alt-5", "title": "Saisonfinale Yas Marina", "country_code": ""},
    ])
    result = await migrations.migrate_round_countries(flow.db)
    assert result == "2 round countries filled"
    stored = {item["id"]: item async for item in flow.db.reference_rounds.find({}, {"_id": 0})}
    assert (stored["alt-1"]["country_code"], stored["alt-1"]["country_auto"]) == ("GB", True)
    # Ein gesetztes Land und eine bewusste „Ohne Flagge“ bleiben.
    assert stored["alt-2"]["country_code"] == "SM"
    assert stored["alt-4"]["country_code"] is None
    assert stored["alt-3"].get("country_code") is None
    assert stored["alt-5"]["country_code"] == "AE"
    assert any(version == 7 for version, _, _ in migrations.MIGRATIONS)
