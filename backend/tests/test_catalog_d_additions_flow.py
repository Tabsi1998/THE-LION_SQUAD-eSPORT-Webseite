"""Katalog D, Nachtrag (#615): Papierkram, Vorstandsarbeit und Sprinter sind messbar - durch die echte Anwendung.

Papierkram zählt jedes Vereinsdokument einmal je Person (erst nach der Rechteprüfung). Vorstandsarbeit zählt die Tage
im längsten laufenden Amt - aus Dolibarr (Funktion mit „seit“, nur Vorstandsfunktionen) oder von Hand (Zuweisung mit
Datum, das bei jedem Wechsel neu beginnt). Sprinter: das Profil binnen zehn Minuten nach der Registrierung vollständig -
der Zeitpunkt wird einmal festgehalten, auch wenn ein verknüpftes Konto das letzte Feld füllt.
"""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import achievement_counters as counters  # noqa: E402

COMPLETE_PROFILE = {
    "avatar_url": "/api/static/uploads/a.png", "banner_url": "/api/static/uploads/b.png", "bio": "Hallo!", "country": "AT", "city": "Innsbruck",
    "birth_date": "2000-01-01", "main_platforms": ["pc"], "input_devices": ["controller"], "favorite_games": ["Rocket League"],
    "discord_name": "paula", "twitch_handle": "paula", "privacy_public_profile": True,
}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_each_document_counts_once_per_person(flow):
    from services.member_activity import note_document_open

    paula = await flow.add_user(name="paula")
    assert await note_document_open(flow.db, paula, "d1") is True
    assert await note_document_open(flow.db, paula, "d1") is False, "zweimal öffnen zählt einmal"
    assert await note_document_open(flow.db, paula, "dolibarr-7") is True
    assert await note_document_open(flow.db, None, "d1") is False, "ohne Anmeldung keine Spur"
    assert (await counters.compute(paula["id"], {"member_documents_opened"}))["member_documents_opened"] == 2


@pytest.mark.asyncio
async def test_a_forbidden_document_leaves_no_trace(flow):
    paula = await flow.add_user(name="paula")
    await flow.db.documents.insert_one({"id": "d9", "title": "Intern", "visibility": "board", "filename": "x.pdf"})
    flow.act_as(paula)
    response = await flow.get("/api/documents/d9/view")
    assert response.status_code in (403, 404)
    assert await flow.db.document_opens.count_documents({"user_id": paula["id"]}) == 0


@pytest.mark.asyncio
async def test_board_days_from_dolibarr_and_from_a_manual_seat(flow):
    paula = await flow.add_user(name="paula")
    max_ = await flow.add_user(name="max")
    since = (datetime.now(timezone.utc) - timedelta(days=400)).date().isoformat()
    await flow.db.dolibarr_public.insert_one({"id": "state", "board": [
        {"code": "PRES", "label": "Obfrau", "board": True, "holders": [{"name": "Paula", "since": since}]},
        {"code": "AUDIT", "label": "Rechnungsprüfung", "board": False, "holders": []},
    ]})
    await flow.db.memberships.insert_one({"user_id": paula["id"], "member_status": "active", "dolibarr": {"functions": [
        {"code": "PRES", "label": "Obfrau", "since": since}, {"code": "AUDIT", "label": "Rechnungsprüfung", "since": "2010-01-01"}]}})
    assert 399 <= (await counters.compute(paula["id"], {"board_days"}))["board_days"] <= 401, "nur Vorstandsfunktionen zählen"

    # Von Hand: die Zuweisung im Admin setzt das Datum, ein Wechsel beginnt neu, Leeren nimmt es weg.
    admin = await flow.add_user(role="superadmin", name="vorstand")
    flow.act_as(admin)
    await flow.db.board_positions.insert_one({"id": "p1", "slug": "kassier", "title_male": "Kassier", "is_active": True, "order_index": 2})
    assigned = await flow.put("/api/board/p1", json={"user_id": max_["id"]})
    assert assigned.status_code == 200, assigned.text
    seat = await flow.db.board_positions.find_one({"id": "p1"}, {"_id": 0})
    assert seat["user_id"] == max_["id"] and seat["user_since"]
    await flow.db.board_positions.update_one({"id": "p1"}, {"$set": {"user_since": (datetime.now(timezone.utc) - timedelta(days=100)).isoformat()}})
    assert (await counters.compute(max_["id"], {"board_days"}))["board_days"] == 100
    cleared = await flow.put("/api/board/p1", json={"user_id": ""})
    assert cleared.status_code == 200
    assert (await flow.db.board_positions.find_one({"id": "p1"}, {"_id": 0})).get("user_since") is None
    assert (await counters.compute(max_["id"], {"board_days"}))["board_days"] == 0


@pytest.mark.asyncio
async def test_sprinter_needs_a_complete_profile_within_ten_minutes(flow):
    fast = await flow.add_user(name="schnell")
    slow = await flow.add_user(name="langsam")
    now = datetime.now(timezone.utc)
    await flow.db.users.update_one({"id": fast["id"]}, {"$set": {"created_at": (now - timedelta(minutes=5)).isoformat()}})
    await flow.db.users.update_one({"id": slow["id"]}, {"$set": {"created_at": (now - timedelta(hours=2)).isoformat()}})
    for user in (fast, slow):
        flow.act_as(user)
        response = await flow.put("/api/users/me", json=COMPLETE_PROFILE)
        assert response.status_code == 200, response.text
    stored = await flow.db.users.find_one({"id": fast["id"]}, {"_id": 0, "profile_completed_at": 1})
    assert stored["profile_completed_at"]
    assert (await counters.compute(fast["id"], {"profile_completed_fast"}))["profile_completed_fast"] == 1
    assert (await counters.compute(slow["id"], {"profile_completed_fast"}))["profile_completed_fast"] == 0
    # Einmal gesetzt, nie überschrieben.
    flow.act_as(fast)
    await flow.put("/api/users/me", json={"bio": "Neu"})
    assert (await flow.db.users.find_one({"id": fast["id"]}, {"_id": 0, "profile_completed_at": 1}))["profile_completed_at"] == stored["profile_completed_at"]


@pytest.mark.asyncio
async def test_an_incomplete_profile_sets_nothing(flow):
    from services.member_activity import note_profile_completion

    paula = await flow.add_user(name="paula")
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"bio": "Hallo"}})
    assert await note_profile_completion(flow.db, paula["id"]) is False
    assert (await flow.db.users.find_one({"id": paula["id"]}, {"_id": 0})).get("profile_completed_at") is None
