"""Strafen und Dokumente (#2125): Vorfälle erscheinen unter Strafen, die Filter zählen vom Server, gelöschte Dokumente nehmen die
Datei mit, und gesperrte Downloads öffnet die Vereinsverwaltung - nicht die Rolle."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from services.permissions import MFA_MESSAGE  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def doc_dir(tmp_path, monkeypatch):
    from routes import document_routes

    folder = tmp_path / "docs"
    folder.mkdir()
    monkeypatch.setattr(document_routes, "PRIVATE_DOC_DIR", folder)
    return folder


async def chair_of(flow, **extra) -> dict:
    user = await flow.add_user(role="player", name="vorstand")
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": ["club"]}})
    return {**user, "areas": ["club"], **extra}


async def incident(flow, user: dict, *, group: str = "unsport", note: str | None = "Beleidigung im Chat", by: str = "admin-1", visible: bool = True) -> str:
    await flow.db.achievement_groups.update_one({"code": group}, {"$set": {"code": group, "name": "Unsportliches Verhalten", "is_negative": True}}, upsert=True)
    award = new_id()
    await flow.db.user_achievements.insert_one({"id": award, "user_id": user["id"], "tier_code": f"{group}_1", "group_code": group, "level": 1,
                                                "earned_at": "2026-10-20T10:00:00+00:00", "context": {"manual": True, "by": by, "note": note, **({"note_visible": True} if visible else {})}, "awarded_by": by})
    return award


# ---------------------------------------------------------------- MG20, MG21: Strafen
@pytest.mark.asyncio
async def test_incidents_appear_for_the_person_and_the_admin(flow):
    erika = await flow.add_user(name="erika")
    admin = await flow.add_user(role="tournament_admin", name="turnierleitung")
    award = await incident(flow, erika, by=admin["id"])
    # Ein normaler Erfolg ist kein Vorfall.
    await flow.db.achievement_groups.insert_one({"code": "sieger", "name": "Sieger", "is_negative": False})
    await flow.db.user_achievements.insert_one({"id": new_id(), "user_id": erika["id"], "tier_code": "sieger_1", "group_code": "sieger", "earned_at": "2026-10-21T10:00:00+00:00"})

    flow.act_as(erika)
    mine = (await flow.get("/api/penalties/me")).json()
    assert mine["count"] == 1
    row = mine["items"][0]
    assert row["kind"] == "incident" and row["ref_id"] == award and row["label"] == "Unsportliches Verhalten"
    assert row["reason"] == "Beleidigung im Chat" and row["issued_at"] == "2026-10-20T10:00:00+00:00"
    assert row["issued_by_name"] in (admin.get("display_name"), admin["username"])

    flow.act_as(admin)
    listed = (await flow.get("/api/admin/penalties")).json()
    assert [item["user_id"] for item in listed["items"]] == [erika["id"]]


@pytest.mark.asyncio
async def test_an_internal_note_stays_internal(flow):
    # Einzel- und Massenvergabe schreiben ihre Notiz ohne Freigabe: Die Person und die Turnierleitung sehen sie nicht.
    erika = await flow.add_user(name="erika")
    await incident(flow, erika, note="Nur für den Vorstand", visible=False)
    flow.act_as(erika)
    mine = (await flow.get("/api/penalties/me")).json()["items"][0]
    assert mine["reason"] == "(keine Begründung hinterlegt)"
    flow.act_as(await flow.add_user(role="tournament_admin", name="turnierleitung"))
    listed = await flow.get("/api/admin/penalties")
    assert "Nur für den Vorstand" not in listed.text


@pytest.mark.asyncio
async def test_a_note_from_the_incident_form_reaches_the_person(flow):
    from services.achievement_core import NEGATIVE_INCIDENTS

    kind, tier = next(iter(NEGATIVE_INCIDENTS.items()))
    from badges import TIER_BY_CODE

    group = TIER_BY_CODE[tier]["group_code"]
    await flow.db.achievement_groups.update_one({"code": group}, {"$set": {"code": group, "name": "Vorfall", "is_negative": True}}, upsert=True)
    await flow.db.achievements.update_one({"code": tier}, {"$set": TIER_BY_CODE[tier]}, upsert=True)
    erika = await flow.add_user(name="erika")
    flow.act_as(await flow.add_user(role="club_admin", name="clubadmin"))
    sent = await flow.post("/api/admin/achievements/trigger-incident", json={"user_id": erika["id"], "incident_type": kind, "note": "Beim Finale"})
    assert sent.status_code == 200, sent.text
    award = await flow.db.user_achievements.find_one({"user_id": erika["id"]}, {"_id": 0})
    assert award["context"]["note_visible"] is True
    flow.act_as(erika)
    assert (await flow.get("/api/penalties/me")).json()["items"][0]["reason"] == "Beim Finale"


@pytest.mark.asyncio
async def test_automatic_fun_awards_are_no_penalties(flow):
    # Einen Dispute öffnen oder spät einchecken vergibt von selbst einen Fun-Erfolg - das ist keine Strafe.
    erika, mara = await flow.add_user(name="erika"), await flow.add_user(name="mara")
    await flow.db.achievement_groups.insert_one({"code": "neg_dispute", "name": "Einspruch", "is_negative": True})
    await flow.db.user_achievements.insert_many([
        {"id": new_id(), "user_id": erika["id"], "tier_code": "neg_dispute_1", "group_code": "neg_dispute", "earned_at": "2026-10-20T10:00:00+00:00", "context": {"match_id": "m-1"}},
        {"id": new_id(), "user_id": mara["id"], "tier_code": "neg_dispute_1", "group_code": "neg_dispute", "earned_at": "2026-10-20T10:00:00+00:00", "context": {"tournament_id": "t-1", "reason": "late_checkin"}},
    ])
    flow.act_as(erika)
    assert (await flow.get("/api/penalties/me")).json() == {"count": 0, "items": []}
    flow.act_as(await flow.add_user(role="tournament_admin", name="turnierleitung"))
    listed = (await flow.get("/api/admin/penalties")).json()
    assert listed["count"] == 0 and listed["counts"] == {"all": 0}


@pytest.mark.asyncio
async def test_filter_counts_come_from_the_server_also_with_a_filter(flow):
    erika = await flow.add_user(name="erika")
    await incident(flow, erika)
    await flow.db.f1_lap_times.insert_many([
        {"id": new_id(), "user_id": erika["id"], "is_invalid": True, "created_at": "2026-10-01T10:00:00+00:00"},
        {"id": new_id(), "user_id": erika["id"], "penalty_seconds": 5, "created_at": "2026-10-02T10:00:00+00:00"},
    ])
    flow.act_as(await flow.add_user(role="tournament_admin", name="turnierleitung"))
    filtered = (await flow.get("/api/admin/penalties?kind=incident")).json()
    assert filtered["count"] == 1 and [item["kind"] for item in filtered["items"]] == ["incident"]
    assert filtered["counts"] == {"all": 3, "incident": 1, "lap_invalid": 1, "lap_penalty": 1}


@pytest.mark.asyncio
async def test_a_forfeit_has_a_german_label(flow):
    from routes import penalty_routes

    erika = await flow.add_user(name="erika")
    await flow.db.tournament_registrations.insert_one({"id": "reg-1", "user_id": erika["id"], "tournament_id": "t-1"})

    async def forfeits(_db, _ids, limit=500):
        return [{"tournament_id": "t-1", "match_id": "m-1", "reason": "Nicht erschienen", "issued_at": "2026-10-01T10:00:00+00:00"}]

    from unittest.mock import patch
    with patch.object(penalty_routes, "load_forfeit_penalties", forfeits):
        flow.act_as(erika)
        row = (await flow.get("/api/penalties/me")).json()["items"][0]
    assert row["label"] == "Kampflos verloren"


# ---------------------------------------------------------------- MG22: Löschen und Protokoll
async def stored_doc(flow, folder, key: str = "protokoll.pdf", **extra) -> dict:
    (folder / key).write_bytes(b"%PDF-1.4\n")
    doc = {"id": new_id(), "title": "Protokoll Sitzung", "category": "minutes", "visibility": "internal", "storage_key": key, "file_url": "/api/documents/x/download",
           "allow_download": False, "created_at": "2026-09-01T10:00:00+00:00", **extra}
    await flow.db.documents.insert_one(dict(doc))
    return doc


@pytest.mark.asyncio
async def test_create_update_delete_are_logged_and_delete_takes_the_file(flow, doc_dir):
    chair = await chair_of(flow)
    flow.act_as(chair)
    (doc_dir / "neu.pdf").write_bytes(b"%PDF-1.4\n")
    created = await flow.post("/api/documents", json={"title": "Statuten 2026", "category": "statutes", "file_url": "", "storage_key": "neu.pdf"})
    assert created.status_code == 200, created.text
    doc_id = created.json()["id"]
    assert (await flow.db.audit_logs.find_one({"action": "document.create"}))["data"]["title"] == "Statuten 2026"

    updated = await flow.patch(f"/api/documents/{doc_id}", json={"title": "Statuten 2027"})
    assert updated.status_code == 200
    audit = await flow.db.audit_logs.find_one({"action": "document.update"})
    assert audit["data"]["fields"] == ["title"] and audit["actor_id"] == chair["id"]
    assert (doc_dir / "neu.pdf").exists()

    deleted = await flow.delete(f"/api/documents/{doc_id}")
    assert deleted.status_code == 200 and deleted.json()["file_removed"] is True
    assert not (doc_dir / "neu.pdf").exists()
    audit = await flow.db.audit_logs.find_one({"action": "document.delete"})
    assert audit["data"] == {"title": "Statuten 2027", "category": "statutes", "file_removed": True}

    removed = await flow.delete(f"/api/documents/{doc_id}")
    assert removed.status_code == 404


@pytest.mark.asyncio
async def test_a_new_file_replaces_the_old_one(flow, doc_dir):
    chair = await chair_of(flow)
    doc = await stored_doc(flow, doc_dir)
    (doc_dir / "neu.pdf").write_bytes(b"%PDF-1.4\n")
    flow.act_as(chair)
    assert (await flow.patch(f"/api/documents/{doc['id']}", json={"storage_key": "neu.pdf"})).status_code == 200
    assert not (doc_dir / "protokoll.pdf").exists() and (doc_dir / "neu.pdf").exists()


@pytest.mark.asyncio
async def test_a_shared_file_stays(flow, doc_dir):
    chair = await chair_of(flow)
    first = await stored_doc(flow, doc_dir)
    second = await stored_doc(flow, doc_dir, title="Kopie")
    mappe = await stored_doc(flow, doc_dir, key="mappe.pdf")
    await flow.db.settings.insert_one({"id": "sponsoring_offer", "pdf_key": "mappe.pdf"})
    flow.act_as(chair)
    removed = await flow.delete(f"/api/documents/{first['id']}")
    assert removed.json()["file_removed"] is False
    assert (doc_dir / "protokoll.pdf").exists()
    removed = await flow.delete(f"/api/documents/{second['id']}")
    assert removed.json()["file_removed"] is True
    assert not (doc_dir / "protokoll.pdf").exists()
    removed = await flow.delete(f"/api/documents/{mappe['id']}")
    assert removed.json()["file_removed"] is False
    assert (doc_dir / "mappe.pdf").exists()


@pytest.mark.asyncio
async def test_an_old_public_file_stays_while_something_uses_it(flow, monkeypatch, tmp_path):
    from routes import document_routes
    from services import media_audit

    uploads = tmp_path / "alt"
    uploads.mkdir()
    monkeypatch.setattr(document_routes, "UPLOAD_DIR", uploads)
    (uploads / "alt.pdf").write_bytes(b"%PDF-1.4\n")
    (uploads / "frei.pdf").write_bytes(b"%PDF-1.4\n")
    used = {"id": new_id(), "title": "Alt", "file_url": "/api/static/uploads/alt.pdf"}
    free = {"id": new_id(), "title": "Frei", "file_url": "/api/static/uploads/frei.pdf"}
    await flow.db.documents.insert_many([dict(used), dict(free)])
    collection, fields, _text = media_audit.usage_places()[0]
    await getattr(flow.db, collection).insert_one({"id": new_id(), fields[0]: "/api/static/uploads/alt.pdf"})
    flow.act_as(await chair_of(flow))
    removed = await flow.delete(f"/api/documents/{used['id']}")
    assert removed.json()["file_removed"] is False
    assert (uploads / "alt.pdf").exists()
    removed = await flow.delete(f"/api/documents/{free['id']}")
    assert removed.json()["file_removed"] is True
    assert not (uploads / "frei.pdf").exists()


@pytest.mark.asyncio
async def test_a_link_in_a_text_keeps_an_old_file(flow, monkeypatch, tmp_path):
    from routes import document_routes

    uploads = tmp_path / "alt"
    uploads.mkdir()
    monkeypatch.setattr(document_routes, "UPLOAD_DIR", uploads)
    (uploads / "verlinkt.pdf").write_bytes(b"%PDF-1.4\n")
    doc = {"id": new_id(), "title": "Alt", "file_url": "/api/static/uploads/verlinkt.pdf"}
    await flow.db.documents.insert_one(dict(doc))
    await flow.db.settings.insert_one({"id": "branding", "terms_of_use": 'Siehe <a href="/api/static/uploads/verlinkt.pdf">Bedingungen</a>.'})
    flow.act_as(await chair_of(flow))
    removed = await flow.delete(f"/api/documents/{doc['id']}")
    assert removed.json()["file_removed"] is False
    assert (uploads / "verlinkt.pdf").exists()


@pytest.mark.asyncio
async def test_only_the_club_area_changes_documents(flow, doc_dir):
    doc = await stored_doc(flow, doc_dir)
    flow.act_as(await flow.add_user(role="moderator", name="moderator"))
    removed = await flow.delete(f"/api/documents/{doc['id']}")
    assert removed.status_code == 403
    assert (doc_dir / "protokoll.pdf").exists()


# ---------------------------------------------------------------- MG23: Gesperrter Download
@pytest.mark.asyncio
async def test_the_club_area_opens_locked_downloads(flow, doc_dir):
    doc = await stored_doc(flow, doc_dir, visibility="members")
    grant = await chair_of(flow)
    holder = await flow.add_user(name="obfrau")
    await flow.db.memberships.insert_one({"user_id": holder["id"], "member_status": "active"})
    await flow.db.board_positions.insert_one({"id": new_id(), "slug": "obmann", "title_male": "Obmann", "is_active": True, "user_id": holder["id"]})
    member = await flow.add_user(name="mitglied")
    await flow.db.memberships.insert_one({"user_id": member["id"], "member_status": "active"})

    for allowed in (grant, holder, await flow.add_user(role="club_admin", name="clubadmin")):
        flow.act_as(allowed)
        assert (await flow.get(f"/api/documents/{doc['id']}/download")).status_code == 200
        rows = (await flow.get("/api/documents?scope=club")).json()
        assert [row for row in rows if row["id"] == doc["id"]][0]["download_url"].endswith("/download")

    flow.act_as({**member, "is_club_member": True})
    refused = await flow.get(f"/api/documents/{doc['id']}/download")
    assert refused.status_code == 403 and refused.json()["detail"] == "Download ist für dieses Dokument deaktiviert."
    rows = (await flow.get("/api/documents?scope=club")).json()
    assert "download_url" not in [row for row in rows if row["id"] == doc["id"]][0]

    # Ohne Zwei-Faktor gilt die Vereinsverwaltung nicht - das Mitglied bekommt den Hinweis darauf.
    flow.act_as({**grant, "mfa_enabled": False, "auth_mfa_verified": False, "is_club_member": True})
    await flow.db.memberships.insert_one({"user_id": grant["id"], "member_status": "active"})
    refused = await flow.get(f"/api/documents/{doc['id']}/download")
    assert refused.status_code == 403 and refused.json()["detail"] == MFA_MESSAGE


# ---------------------------------------------------------------- MG24
@pytest.mark.asyncio
async def test_document_words_have_umlauts(flow):
    meta = (await flow.get("/api/documents/meta")).json()
    assert {"k": "presentation", "l": "Präsentation"} in meta["categories"]
