"""Termine ohne Datum und geplante Termine einer Saison (#2015) über die echten Routen: eine Terminliste mit „offen“,
„?“ oder „tbd“ legt Termine ohne Datum an (keine vorgeschlagenen Tage), „geplante Termine“ zeigt „0 von 9“ und füllt
mit „fehlende Termine anlegen“ auf, ein nachgetragenes Datum sortiert den Termin vor die offenen, und ohne Datum gibt es
keinen Zeitpunkt (also auch keinen Kalendereintrag). Nur erfundene Namen und Orte."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import reference_round_routes  # noqa: E402
from services import migrations  # noqa: E402
from services.reference_calendar import missing_codes, parse_round_lines, planned_status  # noqa: E402

ADMIN = "/api/reference-series/admin"
PUBLIC = "/api/reference-series/public"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-11-05")
    try:
        yield instance
    finally:
        await shutdown()


async def _setup(flow, **series_fields):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe TFT Masters", "kind": "series"})).json()
    body = {"lineage_id": lineage["id"], "season": "2026/27", "default_weekday": 3, "default_time": "19:00",
            "visibility": "public", "status": "active", **series_fields}
    series = (await flow.post(f"{ADMIN}/series", json=body)).json()
    return lineage, series


def _rounds(series):
    return f"{ADMIN}/series/{series['id']}/rounds"


async def _calendar(flow, series):
    response = await flow.get(f"{ADMIN}/series/{series['id']}/calendar")
    assert response.status_code == 200, response.text
    return response.json()


async def _paste(flow, series, text, apply=True):
    calendar = await _calendar(flow, series)
    body = {"text": text, "apply": apply, "expected_version": calendar["version"]}
    response = await flow.post(f"{_rounds(series)}/paste", json=body)
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------- Liste mit „offen“
def test_the_list_reads_offen_question_mark_and_tbd_as_no_date_with_optional_time_and_place():
    parsed = parse_round_lines("T1 · 01.10.2026\nT2 · offen\nT3 · ? · 20:30 · Halle Nord\nT4 tbd\nT5\nT6 · Offen,",
                               season="2026/27", today="2026-10-20", default_weekday=3, default_time="19:00")
    assert parsed["errors"] == []
    assert [(row["code"], row["day"], row["open"], row["time"], row["venue"], row["starts_at"] is None)
            for row in parsed["rows"]] == [
        ("T1", "2026-10-01", False, "19:00", None, False),
        ("T2", None, True, "19:00", None, True),
        ("T3", None, True, "20:30", "Halle Nord", True),
        ("T4", None, True, "19:00", None, True),
        # Eine Zeile ohne Datum nach offenen Terminen rechnet vom letzten Datum weiter (Donnerstag nach T1).
        ("T5", "2026-10-08", False, "19:00", None, False),
        ("T6", None, True, "19:00", None, True),
    ]
    # Ohne jedes Datum davor fehlt das Datum weiter - die Meldung nennt „offen“.
    missing = parse_round_lines("T1", season="2026", today="2026-10-20", default_weekday=None, default_time=None)
    assert "offen" in missing["errors"][0]["message"]
    # „offen“ ist nur das ganze Wort: ein Ort „Offenbach“ bleibt ein Ort.
    place = parse_round_lines("T1 · 01.10.2026 · Offenbach", season="2026", today="2026-10-20",
                              default_weekday=None, default_time=None)
    assert place["rows"][0]["venue"] == "Offenbach" and place["rows"][0]["open"] is False


@pytest.mark.asyncio
async def test_nine_open_lines_make_nine_open_rounds_and_planned_nine_shows_zero_of_nine(flow):
    lineage, series = await _setup(flow)
    text = "\n".join(f"T{number} · offen" for number in range(1, 10))
    preview = await _paste(flow, series, text, apply=False)
    assert preview["count"] == 9 and all(row["open"] and row["day"] is None for row in preview["rows"])
    created = await _paste(flow, series, text)
    assert created["created"] == 9
    calendar = await _calendar(flow, series)
    assert [(item["code"], item["club_day"], item["starts_at"], item["time"], item["state"])
            for item in calendar["rounds"]] == [(f"T{number}", None, None, "19:00", "planned")
                                                for number in range(1, 10)]
    # Geplante Termine = 9: „0 von 9“ auf Serienseite und in „Läuft gerade“.
    assert (await flow.patch(f"{ADMIN}/series/{series['id']}", json={"planned_rounds": 9})).status_code == 200
    page = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}")).json()
    assert (page["progress"]["scored"], page["progress"]["total"], page["series"]["planned_rounds"]) == (0, 9, 9)
    running = (await flow.get(f"{PUBLIC}/running")).json()["items"]
    assert running[0]["progress"] == {"total": 9, "scored": 0}
    # Ohne Datum kein Zeitpunkt - öffentlich wie in der Verwaltung, und nichts davon im Vereinskalender (iCal).
    public = (await flow.get(f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}/calendar")).json()
    assert all(item["club_day"] is None and item["starts_at"] is None for item in public["rounds"])
    feed = await flow.get("/api/calendar/feed.ics")
    assert feed.status_code == 200 and "T1" not in feed.text and "Probe TFT Masters" not in feed.text


@pytest.mark.asyncio
async def test_entering_a_date_later_sorts_the_round_before_the_open_ones(flow):
    _, series = await _setup(flow)
    await _paste(flow, series, "T1 · 01.10.2026\nT2 · 08.10.2026\nT3 · offen\nT4 · offen\nT5 · offen")
    rounds = {item["code"]: item for item in (await _calendar(flow, series))["rounds"]}
    version = (await _calendar(flow, series))["version"]
    response = await flow.patch(f"{_rounds(series)}/{rounds['T5']['id']}",
                                json={"day": "2026-10-15", "expected_version": version})
    assert response.status_code == 200, response.text
    # Die gemerkte Uhrzeit wird zum Zeitpunkt (19:00 Wien = 17:00 UTC im Oktober).
    assert (response.json()["starts_at"], response.json()["open_time"]) == ("2026-10-15T17:00:00+00:00", None)
    calendar = await _calendar(flow, series)
    assert [item["code"] for item in calendar["rounds"]] == ["T1", "T2", "T5", "T3", "T4"]
    # Schon richtig einsortiert: nichts verschiebt sich.
    version = calendar["version"]
    await flow.patch(f"{_rounds(series)}/{rounds['T3']['id']}", json={"day": "2026-10-22", "expected_version": version})
    assert [item["code"] for item in (await _calendar(flow, series))["rounds"]] == ["T1", "T2", "T5", "T3", "T4"]


# ---------------------------------------------------------------- Fehlende Termine anlegen
@pytest.mark.asyncio
async def test_fill_planned_adds_the_missing_rounds_as_open_with_the_next_codes(flow):
    lineage, series = await _setup(flow, planned_rounds=9)
    await _paste(flow, series, "T1 · 01.10.2026\nT2 · 08.10.2026\nT3 · 15.10.2026\nT4 · 22.10.2026")
    calendar = await _calendar(flow, series)
    assert calendar["planned"] == {"planned": 9, "count": 4, "missing": 5}
    preview = await flow.post(f"{_rounds(series)}/fill-planned", json={})
    assert preview.json() == {"planned": 9, "count": 4, "missing": 5, "codes": ["T5", "T6", "T7", "T8", "T9"]}
    assert len((await _calendar(flow, series))["rounds"]) == 4  # die Vorschau legt nichts an
    done = await flow.post(f"{_rounds(series)}/fill-planned",
                           json={"apply": True, "expected_version": calendar["version"]})
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["created"] == 5 and body["planned"] == {"planned": 9, "count": 9, "missing": 0}
    assert [(item["code"], item["club_day"], item["time"]) for item in body["rounds"][4:]] == [
        (f"T{number}", None, "19:00") for number in range(5, 10)]
    again = await flow.post(f"{_rounds(series)}/fill-planned", json={"apply": True})
    assert again.json()["created"] == 0
    log = await flow.db.audit_logs.find_one({"action": "reference_round.fill_planned"}, {"_id": 0})
    assert log["data"]["codes"] == ["T5", "T6", "T7", "T8", "T9"]
    # Ohne geplante Zahl gibt es nichts aufzufüllen.
    await flow.patch(f"{ADMIN}/series/{series['id']}", json={"planned_rounds": None})
    assert (await flow.post(f"{_rounds(series)}/fill-planned", json={"apply": True})).status_code == 422


def test_missing_codes_follow_the_highest_code_and_never_repeat_one():
    rounds = [{"id": "a", "code": "T1", "order": 1}, {"id": "b", "code": "T2", "order": 2},
              {"id": "c", "code": "T4", "order": 3, "archived_at": "2026-10-01"}]
    assert missing_codes(rounds, 3) == ["T5", "T6", "T7"]
    assert missing_codes([{"id": "a", "code": "Runde 3", "order": 1}], 2) == ["Runde 4", "Runde 5"]
    assert missing_codes([{"id": "a", "code": None, "order": 1}], 2, "R") == ["R2", "R3"]
    # Finale, Termine außerhalb der Wertung, abgesagte und archivierte zählen nicht zu den gespielten Terminen.
    calendar = [{"id": "1", "order": 1}, {"id": "2", "order": 2, "status": "cancelled"},
                {"id": "3", "order": 3, "kind": "final"}, {"id": "4", "order": 4, "counts": False},
                {"id": "5", "order": 5, "archived_at": "2026-10-01"}]
    assert planned_status(calendar, 9) == {"planned": 9, "count": 1, "missing": 8}
    assert planned_status(calendar, None) is None
