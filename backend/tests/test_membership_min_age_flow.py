"""Mindestalter beim Beitritt (#1698, Fabians Entscheidung vom 16.11.): Vereinsmitglied ab 18, gerechnet als Wiener Tag.

Vertrag:
- Der Beitrittsantrag (Website-Antrag wie Antrag nach Dolibarr) verlangt ein Geburtsdatum; ohne Datum 422.
- 17 Jahre und 364 Tage: abgelehnt mit verständlicher Meldung, nichts gespeichert. Genau 18: angenommen.
- Der Website-Antrag hebt das Geburtsdatum für den Vorstand auf.
- Altanträge ohne Geburtsdatum und die Verwaltung (Mitgliedschaft von Hand setzen) prüfen nichts nach.
Erfundene Konten."""
import pathlib
import sys
from datetime import date, datetime, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402

from services import membership_age  # noqa: E402

TODAY = date(2026, 11, 16)
APPLICATION = {"motivation": "Ich möchte mitspielen und mich beim Verein einbringen.", "contribution_pref": "full",
               "accept_statutes": True, "accept_privacy": True}


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setattr(membership_age, "vienna_today", lambda now=None: TODAY)
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def applicant(flow) -> dict:
    user = await flow.add_user(name=f"anwaerter-{new_id()[:6]}")
    flow.act_as(user)
    return user


def test_the_age_counts_from_the_vienna_day():
    # 16.11. 23:30 UTC ist in Wien schon der 17.11. - der 18. Geburtstag am 17.11. zählt damit.
    late = datetime(2026, 11, 16, 23, 30, tzinfo=timezone.utc)
    assert membership_age.vienna_today(late) == date(2026, 11, 17)
    assert membership_age.membership_birth_problem("2008-11-17", date(2026, 11, 17)) is None
    assert membership_age.membership_birth_problem("2008-11-17", date(2026, 11, 16)) == membership_age.TOO_YOUNG_TEXT


def test_missing_wrong_and_future_dates_are_named():
    assert membership_age.membership_birth_problem(None, TODAY) == membership_age.MISSING_TEXT
    assert membership_age.membership_birth_problem("", TODAY) == membership_age.MISSING_TEXT
    assert membership_age.membership_birth_problem("2030-01-01", TODAY) == membership_age.INVALID_TEXT
    assert membership_age.membership_birth_problem("1990-01-01", TODAY) is None


@pytest.mark.asyncio
async def test_one_day_short_of_18_is_refused_and_nothing_is_stored(flow):
    await applicant(flow)
    res = await flow.post("/api/membership/apply", json={**APPLICATION, "birth": "2008-11-17"})
    assert res.status_code == 422
    assert "ab 18" in res.json()["detail"]
    assert await flow.db.membership_applications.count_documents({}) == 0


@pytest.mark.asyncio
async def test_exactly_18_is_accepted_and_the_board_sees_the_date(flow):
    user = await applicant(flow)
    res = await flow.post("/api/membership/apply", json={**APPLICATION, "birth": "2008-11-16"})
    assert res.status_code == 200, res.text
    stored = await flow.db.membership_applications.find_one({"user_id": user["id"]}, {"_id": 0})
    assert stored["birth"] == "2008-11-16"


@pytest.mark.asyncio
async def test_without_a_birth_date_the_application_is_incomplete(flow):
    await applicant(flow)
    res = await flow.post("/api/membership/apply", json=APPLICATION)
    assert res.status_code == 422
    assert "Geburtsdatum" in res.json()["detail"]
    assert await flow.db.membership_applications.count_documents({}) == 0


@pytest.mark.asyncio
async def test_old_applications_and_the_administration_stay_as_they_were(flow):
    chair = await flow.add_user(role="player", name="vorstand")
    await flow.db.users.update_one({"id": chair["id"]}, {"$set": {"areas": ["club"]}})
    chair["areas"] = ["club"]
    erika = await flow.add_user(name="erika")
    app_id = new_id()
    await flow.db.membership_applications.insert_one({
        "id": app_id, "user_id": erika["id"], "status": "pending", "motivation": "Ich möchte gern im Verein mitspielen.",
        "contribution_pref": "full", "type_id": None, "type_label": None, "created_at": "2026-10-01T10:00:00+00:00"})
    flow.act_as(chair)
    decided = await flow.patch(f"/api/membership/applications/{app_id}", json={"decision": "approve"})
    assert decided.status_code == 200, decided.text
    young = await flow.add_user(name="jung")
    await flow.db.users.update_one({"id": young["id"]}, {"$set": {"birth_date": "2012-05-05"}})
    by_hand = await flow.put(f"/api/membership/user/{young['id']}", json={"member_status": "active"})
    assert by_hand.status_code == 200, by_hand.text


@pytest.mark.asyncio
async def test_deleting_the_account_removes_the_birth_date_from_the_application(flow):
    from services import account_erasure

    user = await applicant(flow)
    assert (await flow.post("/api/membership/apply", json={**APPLICATION, "birth": "1990-04-12"})).status_code == 200
    await account_erasure._applications(flow.db, user["id"], "2026-11-16T10:00:00+00:00")
    stored = await flow.db.membership_applications.find_one({"user_id": user["id"]}, {"_id": 0})
    assert "birth" not in stored
