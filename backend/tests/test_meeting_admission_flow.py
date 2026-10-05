"""Einlass bei der Generalversammlung (#845, Vereine 1.7.0): Der Vorstand scannt am Eingang die Mitgliedskarte, die
Anwesenheit steht sofort in Dolibarr - im Namen des scannenden Vorstandsmitglieds. Doppelt scannen ändert nichts,
Rücknahme nur mit Grund, danach ist ein neuer Scan ein neuer Einlass. Ohne Karte geht die Mitgliedsnummer. Nur der
Bereich „Verein“ kommt hin; wer heute nicht im Vorstand ist, abgelaufene und fremde Karten werden klar abgelehnt."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import dolibarr_client, dolibarr_identity, dolibarr_policy  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402

GV = 5


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch):
    instance = FakeDolibarr()
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    monkeypatch.setattr(dolibarr_policy, "club_today", lambda: instance.today)
    dolibarr_identity.reset_cache()
    return instance


async def person(flow, name: str, member_id: int | None, **fields) -> dict:
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    user.update(fields)
    if member_id:
        await flow.db.dolibarr_links.insert_one({"id": f"l-{name}", "user_id": user["id"], "instance": "verein:1", "member_key": f"verein:1:{member_id}",
                                                 "member_id": member_id, "member_ref": str(member_id), "status": "verified"})
    return user


async def scene(flow, fake) -> dict:
    """GV heute: Otto (Obmann, Mitglied 7) lässt ein; Paula (12) stimmberechtigt, Carl (13) ohne Stimmrecht eingeladen."""
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": "live", "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1,
    }}, upsert=True)
    await flow.db.settings.update_one({"id": "dolibarr_sync_state"}, {"$set": {"id": "dolibarr_sync_state", "module_version": "1.9.0"}}, upsert=True)
    for member_id, firstname in ((7, "Otto"), (12, "Paula"), (13, "Carl"), (14, "Dora")):
        fake.add(member(member_id, firstname=firstname))
    fake.board_today = {7}
    fake.add_meeting(GV, day=fake.today, invited=[(7, True), (12, True), (13, False), (14, True)])
    otto = await person(flow, "otto", 7, areas=["club"])
    paula = await person(flow, "paula", 12)
    await flow.db.memberships.insert_one({"user_id": paula["id"], "member_status": "active", "first_name": "Paula", "last_name": "Beispiel"})
    return {"otto": otto, "paula": paula}


async def card_code(flow, user: dict) -> str:
    flow.act_as(user)
    card = await flow.get("/api/account/member-card")
    assert card.status_code == 200 and card.json()["status"] == "valid", card.text
    return card.json()["verify_url"]


@pytest.mark.asyncio
async def test_scan_sets_present_once_with_voting_and_counts(flow, fake):
    people = await scene(flow, fake)
    code = await card_code(flow, people["paula"])
    flow.act_as(people["otto"])
    overview = (await flow.get("/api/admin/admission")).json()
    assert overview["ready"] is True and [m["id"] for m in overview["meetings"]] == [GV]

    first = await flow.post(f"/api/admin/admission/{GV}/scan", json={"code": code})
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["headline"] == "Anwesend: Paula B." and body["detail"] == "stimmberechtigt" and body["already"] is False
    assert body["counts"] == {"present": 1, "eligible": 3, "quorum_from": 2, "quorum_reached": False, "at": body["counts"]["at"]}
    assert 12 in fake.present[GV] and fake.admission_log[-1]["by"] == 7, "im Namen des scannenden Vorstandsmitglieds"

    # Doppelt scannen ändert nichts - dieselbe Kennung, dieselbe Antwort.
    again = (await flow.post(f"/api/admin/admission/{GV}/scan", json={"code": code})).json()
    assert again["headline"] == "Schon anwesend: Paula B." and len(fake.admission_log) == 1

    # Ohne Karte: Mitgliedsnummer; Carl ist ohne Stimmrecht eingeladen.
    carl = (await flow.post(f"/api/admin/admission/{GV}/scan", json={"number": "13"})).json()
    assert carl["headline"] == "Anwesend: Carl B." and carl["detail"] == "ohne Stimmrecht (laut Einladung)"
    assert carl["counts"]["present"] == 2
    listed = (await flow.get("/api/admin/admission")).json()["meetings"][0]
    assert [row["name"] for row in listed["recent"]] == ["Carl B.", "Paula B."] and listed["counts"]["present"] == 2


@pytest.mark.asyncio
async def test_undo_needs_a_reason_and_a_new_scan_is_a_new_admission(flow, fake):
    people = await scene(flow, fake)
    code = await card_code(flow, people["paula"])
    flow.act_as(people["otto"])
    await flow.post(f"/api/admin/admission/{GV}/scan", json={"code": code})
    assert (await flow.post(f"/api/admin/admission/{GV}/undo", json={"member_id": 12, "reason": ""})).status_code == 422
    undone = await flow.post(f"/api/admin/admission/{GV}/undo", json={"member_id": 12, "reason": "falscher Ausweis"})
    assert undone.status_code == 200, undone.text
    assert undone.json()["admission"]["state"] == "absent" and 12 not in fake.present[GV]
    assert fake.admission_log[-1] == {"external_id": f"out-{GV}-12-0", "change": "out", "member_id": 12, "by": 7, "reason": "falscher Ausweis"}
    # Neue Runde: der nächste Scan ist ein neuer Einlass (neue Kennung), kein 409.
    back = (await flow.post(f"/api/admin/admission/{GV}/scan", json={"code": code})).json()
    assert back["headline"] == "Anwesend: Paula B." and fake.admission_log[-1]["external_id"] == f"in-{GV}-12-1"
    # Wer nicht anwesend ist, kann nicht zurückgenommen werden.
    assert (await flow.post(f"/api/admin/admission/{GV}/undo", json={"member_id": 13, "reason": "x"})).status_code == 404


@pytest.mark.asyncio
async def test_clear_refusals(flow, fake):
    people = await scene(flow, fake)
    code = await card_code(flow, people["paula"])

    # Nur der Bereich „Verein“ kommt hin.
    flow.act_as(people["paula"])
    assert (await flow.get("/api/admin/admission")).status_code == 403
    flow.act_as(people["otto"])

    # Kein Kartencode, abgelaufene Karte, unbekannte Nummer.
    assert (await flow.post(f"/api/admin/admission/{GV}/scan", json={"code": "https://example.test/irgendwas"})).json()["detail"] == "Das ist kein QR-Code einer Mitgliedskarte."
    await flow.db.member_card_tokens.update_many({}, {"$set": {"expires_at": now_utc() - timedelta(minutes=1)}})
    expired = await flow.post(f"/api/admin/admission/{GV}/scan", json={"code": code})
    assert expired.status_code == 409 and "abgelaufen" in expired.json()["detail"]
    missing = await flow.post(f"/api/admin/admission/{GV}/scan", json={"number": "999"})
    assert missing.status_code == 404 and "999" in missing.json()["detail"]

    # Nicht eingeladen (Mitglied 15 gibt es, ist aber nicht eingeladen).
    fake.add(member(15, firstname="Emil"))
    assert "nicht eingeladen" in (await flow.post(f"/api/admin/admission/{GV}/scan", json={"number": "15"})).json()["detail"]

    # Otto ist heute nicht im Vorstand: das Modul sagt Nein, die Website sagt warum.
    fake.board_today = set()
    refused = await flow.post(f"/api/admin/admission/{GV}/scan", json={"number": "13"})
    assert refused.status_code == 403 and "keine Funktion im Vorstand" in refused.json()["detail"]
    fake.board_today = {7}
    fake.admit_right = False
    right = await flow.post(f"/api/admin/admission/{GV}/scan", json={"number": "13"})
    assert right.status_code == 403 and "Mitglieder bei einer Generalversammlung einlassen" in right.json()["detail"]

    # Kein Versammlungstag: keine Versammlung in der Liste, ein Scan wird abgelehnt.
    fake.admit_right = True
    fake.today = "2026-09-26"
    assert (await flow.get("/api/admin/admission")).json()["reason"] == "no_meeting"
    assert (await flow.post(f"/api/admin/admission/{GV}/scan", json={"number": "13"})).status_code == 409
