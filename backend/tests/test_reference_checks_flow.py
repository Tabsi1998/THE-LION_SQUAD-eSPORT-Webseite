"""Prüfung beim Speichern einer Referenz (#1755): Speichern bleibt möglich, die Antwort trägt Warnungen je Feld; das
Formular kann vorher prüfen, der Admin sieht eine Liste der Auffälligkeiten in den Altdaten, und die Grenzen sind
einstellbar. Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import news_routes  # noqa: E402
from services import dolibarr_policy  # noqa: E402

CHECKS = "/api/references/admin/checks"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setattr(dolibarr_policy, "club_today", lambda: "2026-10-21")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _board(flow):
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    return admin


def _codes(body) -> list[tuple]:
    return [(item["field"], item["code"]) for item in body]


@pytest.mark.asyncio
async def test_saving_a_typo_still_saves_and_names_the_fields(flow):
    await _board(flow)
    response = await flow.post("/api/references", json={
        "title": "Probe Cup", "start_date": "2026-03-01", "end_date": "2028-03-01",
        "entries": [{"kind": "team", "team_name": "Löwen Probe", "placement": 12, "team_count": 8}],
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert _codes(body["check_warnings"]) == [("end_date", "too_long"), ("end_date", "end_in_future"),
                                              ("entries.0.placement", "placement_above_count")]
    stored = await flow.db.references.find_one({"id": body["id"]}, {"_id": 0})
    assert "check_warnings" not in stored and stored["end_date"] == "2028-03-01"

    fixed = await flow.patch(f"/api/references/{body['id']}", json={"end_date": "2026-03-02"})
    assert fixed.status_code == 200, fixed.text
    assert _codes(fixed.json()["check_warnings"]) == [("entries.0.placement", "placement_above_count")]


@pytest.mark.asyncio
async def test_the_form_can_check_before_saving_without_storing_anything(flow):
    await _board(flow)
    response = await flow.post(f"{CHECKS}/preview", json={
        "start_date": "2026-03-05", "end_date": "2026-03-01", "status": "active",
        "entries": [{"kind": "solo", "placement": 3, "participant_count": 32}],
    })
    assert response.status_code == 200, response.text
    assert _codes(response.json()["warnings"]) == [("end_date", "end_before_start")]
    assert await flow.db.references.count_documents({}) == 0


@pytest.mark.asyncio
async def test_old_data_is_listed_with_its_findings_and_the_limits_are_settings(flow):
    await _board(flow)
    await flow.db.references.insert_many([
        {"id": "ref-ok", "title": "Ruhiger Cup", "start_date": "2025-01-01", "end_date": "2025-01-02",
         "placement": 2, "participant_count": 16, "status": "completed"},
        {"id": "ref-alt", "title": "Alter Cup", "start_date": "2025-01-01", "end_date": "2025-04-01",
         "placement": 20, "participant_count": 16, "status": "completed"},
    ])
    listing = (await flow.get(CHECKS)).json()
    assert listing["settings"] == {"max_duration_days": 365, "warn_future_end": True}
    assert [(item["id"], _codes(item["warnings"])) for item in listing["items"]] == [
        ("ref-alt", [("placement", "placement_above_count")])]
    assert listing["checked"] == 2

    saved = await flow.patch(CHECKS, json={"max_duration_days": 30})
    assert saved.status_code == 200, saved.text
    assert saved.json() == {"max_duration_days": 30, "warn_future_end": True}
    listing = (await flow.get(CHECKS)).json()
    assert [(item["id"], _codes(item["warnings"])) for item in listing["items"]] == [
        ("ref-alt", [("end_date", "too_long"), ("placement", "placement_above_count")])]

    refused = await flow.patch(CHECKS, json={"max_duration_days": 0})
    assert refused.status_code == 422


@pytest.mark.asyncio
async def test_only_the_content_area_sees_the_checks(flow):
    member = await flow.add_user(role="user", name="mitglied")
    flow.act_as(member)
    assert (await flow.get(CHECKS)).status_code == 403
    assert (await flow.post(f"{CHECKS}/preview", json={})).status_code == 403


@pytest.mark.asyncio
async def test_a_change_of_the_limits_lands_in_the_admin_log(flow):
    admin = await _board(flow)
    await flow.patch(CHECKS, json={"max_duration_days": 90})
    # Gleicher Wert noch einmal: keine zweite Zeile.
    await flow.patch(CHECKS, json={"max_duration_days": 90})
    await flow.patch(CHECKS, json={"warn_future_end": False})
    logs = await flow.db.audit_logs.find({"action": "references.checks_change"}, {"_id": 0}).sort(
        "created_at", 1).to_list(None)
    assert [(log["actor_id"], log["target_id"], log["data"]) for log in logs] == [
        (admin["id"], "reference_checks", {"previous": {"max_duration_days": 365, "warn_future_end": True},
                                           "settings": {"max_duration_days": 90, "warn_future_end": True}}),
        (admin["id"], "reference_checks", {"previous": {"max_duration_days": 90, "warn_future_end": True},
                                           "settings": {"max_duration_days": 90, "warn_future_end": False}}),
    ]


@pytest.mark.asyncio
async def test_the_list_reads_every_reference_in_blocks(flow, monkeypatch):
    await _board(flow)
    docs = [{"id": f"ref-{index:04d}", "title": f"Cup {index:04d}", "status": "completed", "placement": 1,
             "participant_count": 8, "description": "x" * 50} for index in range(1003)]
    # Drei auffällige - eine davon ganz am Ende, hinter der alten Grenze von 1000.
    for index in (0, 600, 1002):
        docs[index].update({"placement": 20, "participant_count": 16})
    await flow.db.references.insert_many(docs)
    listing = (await flow.get(CHECKS)).json()
    assert listing["checked"] == 1003
    assert sorted(item["id"] for item in listing["items"]) == ["ref-0000", "ref-0600", "ref-1002"]
    # Kleinere Blöcke ergeben dasselbe; die Liste trägt nur, was sie zeigt.
    monkeypatch.setattr(news_routes, "REFERENCE_CHECK_BLOCK", 7)
    again = (await flow.get(CHECKS)).json()
    assert again["checked"] == 1003 and again["items"] == listing["items"]
    assert set(listing["items"][0]) == {"id", "title", "start_date", "warnings"}
