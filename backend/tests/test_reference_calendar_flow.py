"""Kalender je Serie (#1742) über die echten Routen: Termine einzeln und als eingefügte Liste, Standard-Wochentag und
-Uhrzeit der Serie als Vorgabe, Bearbeiten, Verschieben (der ursprüngliche Termin bleibt), Absagen (fehlt nie),
Reihenfolge, Archivieren statt Löschen, Rechte und die öffentliche Terminliste mit der Sichtbarkeit der Serie.
Nur erfundene Namen und Orte."""
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


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    # Heute in Wien: Donnerstag, 05.11.2026.
    monkeypatch.setattr(reference_round_routes, "club_today", lambda: "2026-11-05")
    try:
        yield instance
    finally:
        await shutdown()


async def _setup(flow, *, weekday=3, clock="20:30", **series_fields):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Racing F1", "kind": "racing"})).json()
    body = {"lineage_id": lineage["id"], "season": "2026", "default_weekday": weekday, "default_time": clock,
            **series_fields}
    series = (await flow.post(f"{ADMIN}/series", json=body)).json()
    return admin, lineage, series


def _rounds(series):
    return f"{ADMIN}/series/{series['id']}/rounds"


async def _calendar(flow, series):
    response = await flow.get(f"{ADMIN}/series/{series['id']}/calendar")
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------- Einzeln
@pytest.mark.asyncio
async def test_a_single_round_takes_the_series_time_unless_it_has_its_own(flow):
    _, _, series = await _setup(flow)
    first = await flow.post(_rounds(series), json={"code": "R1", "venue": "Probering", "day": "2026-11-12"})
    assert first.status_code == 200, first.text
    body = first.json()
    # 20:30 in Wien im November ist 19:30 UTC.
    assert (body["club_day"], body["starts_at"], body["order"], body["status"]) == (
        "2026-11-12", "2026-11-12T19:30:00+00:00", 1, "planned")
    own = (await flow.post(_rounds(series), json={"code": "R2", "day": "2026-11-19", "time": "18:00"})).json()
    assert (own["starts_at"], own["order"]) == ("2026-11-19T17:00:00+00:00", 2)
    no_time = (await flow.post(_rounds(series), json={"code": "R3", "day": "2026-11-26", "time": None})).json()
    assert (no_time["club_day"], no_time["starts_at"]) == ("2026-11-26", None)

    edited = await flow.patch(f"{_rounds(series)}/{own['id']}", json={"venue": "Teststadt", "time": "21:15",
                                                                     "counts": False, "kind": "final"})
    assert edited.status_code == 200, edited.text
    assert (edited.json()["venue"], edited.json()["starts_at"], edited.json()["counts"], edited.json()["kind"]) == (
        "Teststadt", "2026-11-19T20:15:00+00:00", False, "final")
    calendar = await _calendar(flow, series)
    assert [(item["code"], item["time"], item["state"]) for item in calendar["rounds"]] == [
        ("R1", "20:30", "planned"), ("R2", "21:15", "planned"), ("R3", None, "planned")]
    assert calendar["today"] == "2026-11-05"


@pytest.mark.asyncio
async def test_invalid_rounds_are_refused(flow):
    _, _, series = await _setup(flow)
    assert (await flow.post(_rounds(series), json={"day": "2026-02-31"})).status_code == 422
    assert (await flow.post(_rounds(series), json={"day": "2026-11-12", "time": "24:00"})).status_code == 422
    assert (await flow.post(_rounds(series), json={"day": "2026-11-12", "status": "cancelled"})).status_code == 422
    created = (await flow.post(_rounds(series), json={"day": "2026-11-12"})).json()
    assert (await flow.patch(f"{_rounds(series)}/{created['id']}", json={"status": "scored"})).status_code == 422
    assert (await flow.post(f"{ADMIN}/series/fehlt/rounds", json={"day": "2026-11-12"})).status_code == 404


# ---------------------------------------------------------------- Status, Verschieben, Absagen
@pytest.mark.asyncio
async def test_states_postpone_and_cancel_with_the_gap_hint(flow):
    admin, _, series = await _setup(flow)
    ids = {}
    for code, day in (("R1", "2026-10-22"), ("R2", "2026-10-29"), ("R3", "2026-11-05"), ("R4", "2026-11-12"),
                      ("R5", "2026-11-19")):
        ids[code] = (await flow.post(_rounds(series), json={"code": code, "day": day})).json()["id"]
    # R2 hat ein veröffentlichtes Ergebnis, R1 nicht - R1 ist eine Lücke.
    await flow.db.reference_round_results.insert_one({"id": "blatt-2", "series_id": series["id"],
                                                      "round_id": ids["R2"], "status": "published", "rows": []})
    calendar = await _calendar(flow, series)
    assert [(item["code"], item["state"]) for item in calendar["rounds"]] == [
        ("R1", "missing"), ("R2", "scored"), ("R3", "today"), ("R4", "planned"), ("R5", "planned")]
    assert [hint["round_id"] for hint in calendar["hints"]] == [ids["R1"]]
    assert calendar["counts"]["missing"] == 1

    # Absagen: R1 fehlt nicht mehr, der Hinweis ist weg.
    cancelled = await flow.post(f"{_rounds(series)}/{ids['R1']}/cancel", json={"note": "Server ausgefallen"})
    assert cancelled.json()["status"] == "cancelled" and cancelled.json()["status_note"] == "Server ausgefallen"
    calendar = await _calendar(flow, series)
    assert calendar["rounds"][0]["state"] == "cancelled" and calendar["hints"] == []
    assert calendar["counts"]["missing"] == 0

    # Verschieben: der ursprüngliche Termin bleibt - auch beim zweiten Verschieben.
    moved = await flow.post(f"{_rounds(series)}/{ids['R4']}/postpone", json={"day": "2026-11-14"})
    assert moved.status_code == 200, moved.text
    body = moved.json()
    assert (body["status"], body["club_day"], body["original_club_day"]) == ("postponed", "2026-11-14", "2026-11-12")
    assert (body["starts_at"], body["original_starts_at"]) == ("2026-11-14T19:30:00+00:00", "2026-11-12T19:30:00+00:00")
    again = (await flow.post(f"{_rounds(series)}/{ids['R4']}/postpone", json={"day": "2026-11-21", "time": "19:00"})).json()
    assert (again["club_day"], again["original_club_day"], again["starts_at"]) == (
        "2026-11-21", "2026-11-12", "2026-11-21T18:00:00+00:00")
    assert (await _calendar(flow, series))["rounds"][3]["state"] == "postponed"

    # Eine verschobene Runde absagen und die Absage zurücknehmen: wieder verschoben.
    await flow.post(f"{_rounds(series)}/{ids['R4']}/cancel", json={})
    back = (await flow.post(f"{_rounds(series)}/{ids['R4']}/reinstate")).json()
    assert (back["status"], back["original_club_day"]) == ("postponed", "2026-11-12")

    # Eine gewertete Runde lässt sich nicht absagen.
    await flow.db.reference_rounds.update_one({"id": ids["R2"]}, {"$set": {"status": "scored"}})
    assert (await flow.post(f"{_rounds(series)}/{ids['R2']}/cancel", json={})).status_code == 409
    assert (await flow.post(f"{_rounds(series)}/{ids['R2']}/postpone", json={"day": "2026-12-01"})).status_code == 409

    actions = [log["action"] async for log in flow.db.audit_logs.find({"target_id": series["id"]})]
    assert {"reference_round.cancel", "reference_round.postpone", "reference_round.reinstate"} <= set(actions)
    actors = {log["actor_id"] async for log in flow.db.audit_logs.find({"action": {"$regex": "^reference_round"}})}
    assert actors == {admin["id"]}


@pytest.mark.asyncio
async def test_archiving_hides_a_round_without_deleting_it(flow):
    _, _, series = await _setup(flow)
    created = (await flow.post(_rounds(series), json={"code": "R1", "day": "2026-11-12"})).json()
    archived = await flow.post(f"{_rounds(series)}/{created['id']}/archive")
    assert archived.status_code == 200 and archived.json()["archived_at"]
    calendar = await _calendar(flow, series)
    assert calendar["rounds"] == [] and [item["id"] for item in calendar["archived"]] == [created["id"]]
    removal = await flow.delete(f"{_rounds(series)}/{created['id']}")
    assert removal.status_code == 405
    await flow.post(f"{_rounds(series)}/{created['id']}/restore")
    assert [item["id"] for item in (await _calendar(flow, series))["rounds"]] == [created["id"]]


# ---------------------------------------------------------------- Reihenfolge
@pytest.mark.asyncio
async def test_order_and_sort_by_date(flow):
    _, _, series = await _setup(flow)
    a = (await flow.post(_rounds(series), json={"code": "A", "day": "2026-11-19"})).json()
    b = (await flow.post(_rounds(series), json={"code": "B", "day": "2026-11-12"})).json()
    c = (await flow.post(_rounds(series), json={"code": "C"})).json()
    wrong = await flow.post(f"{_rounds(series)}/order", json={"ids": [a["id"], b["id"]]})
    assert wrong.status_code == 422
    twice = await flow.post(f"{_rounds(series)}/order", json={"ids": [a["id"], a["id"], b["id"]]})
    assert twice.status_code == 422
    ordered = await flow.post(f"{_rounds(series)}/order", json={"ids": [c["id"], a["id"], b["id"]]})
    assert [item["code"] for item in ordered.json()["rounds"]] == ["C", "A", "B"]
    by_date = await flow.post(f"{_rounds(series)}/sort-by-date")
    assert [(item["code"], item["position"]) for item in by_date.json()["rounds"]] == [("B", 1), ("A", 2), ("C", 3)]


# ---------------------------------------------------------------- Einfügen
@pytest.mark.asyncio
async def test_a_pasted_list_is_previewed_then_applied(flow):
    _, _, series = await _setup(flow, season="2026/27")
    text = "R1 · 05.11. · Probering\nR2 · 12.11. · Teststadt 19:00\nR3 Beispielpark\nR4 · 07.01. · Musterkurs"
    preview = await flow.post(f"{_rounds(series)}/paste", json={"text": text})
    assert preview.status_code == 200, preview.text
    rows = preview.json()["rows"]
    assert [(row["code"], row["day"], row["time"]) for row in rows] == [
        ("R1", "2026-11-05", "20:30"), ("R2", "2026-11-12", "19:00"), ("R3", "2026-11-19", "20:30"),
        ("R4", "2027-01-07", "20:30")]
    assert await flow.db.reference_rounds.count_documents({}) == 0

    applied = await flow.post(f"{_rounds(series)}/paste", json={"text": text, "apply": True})
    assert applied.status_code == 200, applied.text
    assert applied.json()["created"] == 4
    assert [(item["code"], item["venue"], item["position"], item["state"]) for item in applied.json()["rounds"]] == [
        ("R1", "Probering", 1, "today"), ("R2", "Teststadt", 2, "planned"), ("R3", "Beispielpark", 3, "planned"),
        ("R4", "Musterkurs", 4, "planned")]
    stored = await flow.db.reference_rounds.find_one({"code": "R2"})
    assert (stored["starts_at"], stored["source"]) == ("2026-11-12T18:00:00+00:00", "paste")


@pytest.mark.asyncio
async def test_a_list_with_errors_is_never_applied(flow):
    _, _, series = await _setup(flow)
    broken = await flow.post(f"{_rounds(series)}/paste", json={"text": "R1 05.11. Nord\nR2 31.11. Süd", "apply": True})
    assert broken.status_code == 422
    assert broken.json()["detail"]["errors"] == [
        {"line": 2, "text": "R2 31.11. Süd", "message": "Datum 31.11. gibt es nicht."}]
    empty = await flow.post(f"{_rounds(series)}/paste", json={"text": "\n# nur Kommentar\n", "apply": True})
    assert empty.status_code == 422
    assert await flow.db.reference_rounds.count_documents({}) == 0
    too_long = await flow.post(f"{_rounds(series)}/paste", json={"text": "x" * 20001})
    assert too_long.status_code == 422


# ---------------------------------------------------------------- Rechte
@pytest.mark.asyncio
async def test_only_the_content_area_manages_the_calendar(flow):
    _, _, series = await _setup(flow)
    created = (await flow.post(_rounds(series), json={"code": "R1", "day": "2026-11-12"})).json()
    _, _, other = await _setup(flow)
    # Ein Termin gehört zur Serie im Pfad - über eine andere Serie ist er nicht erreichbar.
    assert (await flow.patch(f"{_rounds(other)}/{created['id']}", json={"venue": "x"})).status_code == 404
    assert (await flow.post(f"{_rounds(other)}/{created['id']}/cancel", json={})).status_code == 404

    calls = [
        ("get", f"{ADMIN}/series/{series['id']}/calendar", None),
        ("post", _rounds(series), {"day": "2026-11-12"}),
        ("patch", f"{_rounds(series)}/{created['id']}", {"venue": "x"}),
        ("post", f"{_rounds(series)}/{created['id']}/cancel", {}),
        ("post", f"{_rounds(series)}/{created['id']}/postpone", {"day": "2026-11-13"}),
        ("post", f"{_rounds(series)}/{created['id']}/archive", None),
        ("post", f"{_rounds(series)}/order", {"ids": [created["id"]]}),
        ("post", f"{_rounds(series)}/paste", {"text": "R1 05.11. Nord"}),
    ]
    for role in ("player", "tournament_admin"):
        flow.act_as(await flow.add_user(role=role))
        for method, url, body in calls:
            response = await getattr(flow, method)(url, **({"json": body} if body is not None else {}))
            assert response.status_code == 403, (role, method, url, response.status_code)
    flow.act_as(None)
    for method, url, body in calls:
        response = await getattr(flow, method)(url, **({"json": body} if body is not None else {}))
        assert response.status_code == 401, (method, url, response.status_code)
    stored = await flow.db.reference_rounds.find_one({"id": created["id"]})
    assert (stored["status"], stored["venue"], stored["archived_at"]) == ("planned", None, None)


# ---------------------------------------------------------------- Öffentlich
@pytest.mark.asyncio
async def test_the_public_calendar_respects_visibility_and_hides_notes(flow):
    admin, lineage, series = await _setup(flow)
    created = (await flow.post(_rounds(series), json={"code": "R1", "venue": "Probering", "day": "2026-11-12",
                                                      "note": "Nur intern"})).json()
    await flow.post(f"{_rounds(series)}/{created['id']}/cancel", json={"note": "Interner Grund"})
    hidden = (await flow.post(_rounds(series), json={"code": "R9", "day": "2026-12-12"})).json()
    await flow.post(f"{_rounds(series)}/{hidden['id']}/archive")

    flow.act_as(None)
    url = f"{PUBLIC}/{lineage['slug']}/{series['season_slug']}/calendar"
    response = await flow.get(url)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["lineage"]["title"] == "Probe Racing F1" and body["series"]["season"] == "2026"
    assert [(item["code"], item["state"], item["venue"]) for item in body["rounds"]] == [("R1", "cancelled", "Probering")]
    assert "Nur intern" not in response.text and "Interner Grund" not in response.text
    assert "note" not in body["rounds"][0] and "status_note" not in body["rounds"][0]

    # Nur für Mitglieder: Gäste sehen die Serie nicht - weder über die Serie noch über die Spur.
    flow.act_as(admin)
    await flow.patch(f"{ADMIN}/series/{series['id']}", json={"visibility": "members"})
    flow.act_as(None)
    assert (await flow.get(url)).status_code == 404
    flow.act_as(admin)
    await flow.patch(f"{ADMIN}/series/{series['id']}", json={"visibility": "public"})
    await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"visibility": "internal"})
    flow.act_as(await flow.add_user(role="player"))
    assert (await flow.get(url)).status_code == 404

    # Archiviert ist nicht öffentlich; eine alte Adresse der Saison führt weiter zur Serie.
    flow.act_as(admin)
    await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"visibility": "public"})
    await flow.patch(f"{ADMIN}/series/{series['id']}", json={"tier": "Division 1"})
    flow.act_as(None)
    old = await flow.get(url)
    assert old.status_code == 200 and old.json()["series"]["season_slug"] == "2026-division-1"
    flow.act_as(admin)
    await flow.post(f"{ADMIN}/series/{series['id']}/archive")
    flow.act_as(None)
    assert (await flow.get(url)).status_code == 404
    assert (await flow.get(f"{PUBLIC}/gibt-es-nicht/2026/calendar")).status_code == 404
