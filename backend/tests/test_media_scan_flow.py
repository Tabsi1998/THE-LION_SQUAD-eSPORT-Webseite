"""Bildprüfung (#415): ein Chat-Bild bleibt bis zum Ergebnis verborgen, ein entferntes Bild geht in die
Quarantäne (Treffer, Nachricht, Moderation), ein Mensch kann jede Entscheidung umdrehen; öffentliche
Uploads verlieren beim Entfernen ihre Verweise; ein toter Anbieter blockiert nichts (fail-open);
die Aufbewahrung löscht alte Originale. Der Testanbieter liefert feste Werte."""
import io
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from routes import upload_routes  # noqa: E402
from services import chat_attachments, media_scan  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(chat_attachments, "PRIVATE_CHAT_DIR", tmp_path / "chat")
    monkeypatch.setattr(upload_routes, "PUBLIC_UPLOAD_DIR", tmp_path / "public")
    monkeypatch.setattr(media_scan, "QUARANTINE_DIR", tmp_path / "quarantine")
    monkeypatch.setattr(media_scan, "auto_process", False)
    media_scan.fake_results.clear()
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()
        media_scan.fake_results.clear()


def png(color=(200, 40, 40)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (64, 48), color).save(buffer, format="PNG")
    return buffer.getvalue()


async def upload_chat_image(flow) -> dict:
    response = await flow.post("/api/chat-attachments", files={"file": ("bild.png", png(), "image/png")})
    assert response.status_code == 200, response.text
    return response.json()


async def people(flow):
    return (
        await flow.add_user(name="alice"),
        await flow.add_user(name="bob"),
        await flow.add_user(role="moderator", name="mod"),
    )


def scores(nudity: float, violence: float = 0.0) -> dict:
    return {"scores": {"nudity": nudity, "violence": violence, "racy": 0.0}}


@pytest.mark.asyncio
async def test_chat_image_is_hidden_until_checked_and_a_blocked_one_goes_to_quarantine(flow, tmp_path):
    alice, bob, mod = await people(flow)
    flow.act_as(alice)
    attachment = await upload_chat_image(flow)
    assert attachment["scan_state"] == "pending"
    sent = await flow.post(f"/api/messages/direct/{bob['id']}", json={"attachment_ids": [attachment["id"]]})
    assert sent.status_code == 200, sent.text
    assert sent.json()["attachments"][0]["scan_state"] == "pending"
    url = f"/api/chat-attachments/{attachment['id']}"

    # Bis zum Ergebnis: der Absender ja, der Empfänger nein - und die Moderation sieht es nur über die
    # Vorschau der Bildprüfung, nicht über den Chat (in dem sie nicht ist).
    assert (await flow.get(url)).status_code == 200
    flow.act_as(bob)
    assert (await flow.get(url)).status_code == 404
    flow.act_as(mod)
    assert (await flow.get(url)).status_code == 404

    media_scan.fake_results.append(scores(0.92))
    assert (await media_scan.process_pending())["processed"] == 1
    doc = await flow.db.media_scans.find_one({"ref_id": attachment["id"]}, {"_id": 0})
    assert doc["state"] == "blocked" and doc["provider"] == "fake" and doc["scores"]["nudity"] == 0.92
    assert doc["quarantine_key"] and (tmp_path / "quarantine" / doc["quarantine_key"]).is_file()
    assert not list((tmp_path / "chat").glob("*.png")) or not (tmp_path / "chat" / f"{doc['quarantine_key']}").exists()
    stored = await flow.db.chat_attachments.find_one({"id": attachment["id"]}, {"_id": 0})
    assert stored["scan_state"] == "blocked"
    flow.act_as(alice)
    assert (await flow.get(url)).status_code == 404
    strikes = await flow.db.moderation_strikes.find({"user_id": alice["id"], "source": "image_scan"}, {"_id": 0}).to_list(10)
    assert len(strikes) == 1 and strikes[0]["ref_id"] == doc["id"]
    assert (await flow.get("/api/moderation/media-scan/queue")).status_code == 403

    # Die Moderation sieht es mit Vorschau und dreht es um: Bild zurück, Treffer weg.
    flow.act_as(mod)
    rows = (await flow.get("/api/moderation/media-scan/queue?state=blocked")).json()
    assert [row["id"] for row in rows] == [doc["id"]]
    assert rows[0]["owner"]["username"] == "alice" and rows[0]["context_label"] == "Direktnachricht" and rows[0]["preview_url"]
    preview = await flow.get(rows[0]["preview_url"])
    assert preview.status_code == 200 and preview.headers["content-type"].startswith("image/")
    approved = (await flow.post(f"/api/moderation/media-scan/{doc['id']}/approve", json={"note": "Badefoto, passt"})).json()
    assert approved["state"] == "safe" and approved["quarantine_key"] is None and approved["note"] == "Badefoto, passt"
    flow.act_as(bob)
    assert (await flow.get(url)).status_code == 200
    strike = await flow.db.moderation_strikes.find_one({"id": strikes[0]["id"]}, {"_id": 0})
    assert strike["revoked"] is True
    assert await flow.db.audit_logs.count_documents({"action": "media_scan.approved", "target_id": doc["id"]}) == 1


@pytest.mark.asyncio
async def test_review_waits_for_a_person_and_the_switch_off_skips_the_check(flow):
    alice, bob, mod = await people(flow)
    flow.act_as(alice)
    attachment = await upload_chat_image(flow)
    await flow.post(f"/api/messages/direct/{bob['id']}", json={"attachment_ids": [attachment["id"]]})
    media_scan.fake_results.append(scores(0.7))
    await media_scan.process_pending()
    doc = await flow.db.media_scans.find_one({"ref_id": attachment["id"]}, {"_id": 0})
    assert doc["state"] == "review"
    url = f"/api/chat-attachments/{attachment['id']}"
    assert (await flow.get(url)).status_code == 200
    flow.act_as(bob)
    assert (await flow.get(url)).status_code == 404

    flow.act_as(mod)
    assert [row["id"] for row in (await flow.get("/api/moderation/media-scan/queue")).json()] == [doc["id"]]
    status = (await flow.get("/api/moderation/media-scan/status")).json()
    assert status["review_open"] == 1 and status["health"]["provider"] == "fake"
    removed = (await flow.post(f"/api/moderation/media-scan/{doc['id']}/remove", json={"note": "geht nicht"})).json()
    assert removed["state"] == "blocked" and removed["decided_by"] == mod["id"] and removed["quarantine_key"]
    assert await flow.db.moderation_strikes.count_documents({"user_id": alice["id"], "source": "image_scan"}) == 1
    assert (await flow.get("/api/moderation/media-scan/queue?state=review")).json() == []

    # Schalter aus: kein Anbieter, jedes Bild sofort frei.
    assert (await flow.put("/api/moderation/media-scan/settings", json={"provider": "off"})).status_code == 200
    flow.act_as(alice)
    second = await upload_chat_image(flow)
    await media_scan.process_pending()
    doc = await flow.db.media_scans.find_one({"ref_id": second["id"]}, {"_id": 0})
    assert doc["state"] == "safe" and doc["provider"] == "off"
    assert (await flow.db.chat_attachments.find_one({"id": second["id"]}, {"_id": 0}))["scan_state"] == "safe"


@pytest.mark.asyncio
async def test_blocked_public_upload_clears_avatar_and_settings_are_checked(flow, tmp_path):
    alice, _bob, mod = await people(flow)
    flow.act_as(alice)
    uploaded = await flow.post("/api/uploads/image", files={"file": ("avatar.png", png((20, 200, 80)), "image/png")})
    assert uploaded.status_code == 200, uploaded.text
    url = uploaded.json()["url"]
    await flow.db.users.update_one({"id": alice["id"]}, {"$set": {"avatar_url": url}})
    media_scan.fake_results.append(scores(0.2, violence=0.97))
    await media_scan.process_pending()
    doc = await flow.db.media_scans.find_one({"kind": "upload", "url": url}, {"_id": 0})
    assert doc["state"] == "blocked" and doc["references_cleared"] == 1
    assert (await flow.db.users.find_one({"id": alice["id"]}, {"_id": 0, "avatar_url": 1}))["avatar_url"] is None
    assert not (tmp_path / "public" / uploaded.json()["filename"]).exists()
    assert (tmp_path / "quarantine" / doc["quarantine_key"]).is_file()
    assert (await flow.db.media_uploads.find_one({"id": doc["ref_id"]}, {"_id": 0}))["scan_state"] == "blocked"

    flow.act_as(mod)
    bad_order = await flow.put("/api/moderation/media-scan/settings", json={"review_threshold": 0.9, "block_threshold": 0.5})
    assert bad_order.status_code == 400 and "unter" in bad_order.json()["detail"]
    bad_provider = await flow.put("/api/moderation/media-scan/settings", json={"provider": "nope"})
    assert bad_provider.status_code == 400
    saved = (await flow.put("/api/moderation/media-scan/settings", json={"provider": "google_vision", "google_api_key": "AIza-geheim", "retention_days": 30})).json()
    assert saved["provider"] == "google_vision" and saved["google_api_key_masked"] is True and saved["retention_days"] == 30
    assert "google_api_key" not in saved
    raw = await flow.db.settings.find_one({"id": "media_scan"}, {"_id": 0})
    assert raw["google_api_key"] != "AIza-geheim"
    status = (await flow.get("/api/moderation/media-scan/status")).json()
    assert status["health"]["ok"] is True and status["counts_30d"]["blocked"] == 1
    cleared = (await flow.put("/api/moderation/media-scan/settings", json={"clear_google_api_key": True})).json()
    assert cleared["google_api_key_masked"] is False


@pytest.mark.asyncio
async def test_a_dead_provider_fails_open_and_the_purge_removes_old_originals(flow, tmp_path):
    alice, bob, _mod = await people(flow)
    flow.act_as(alice)
    attachment = await upload_chat_image(flow)
    await flow.post(f"/api/messages/direct/{bob['id']}", json={"attachment_ids": [attachment["id"]]})
    media_scan.fake_results.extend([{"error": "Modell weg"}, {"error": "Modell weg"}, {"error": "Modell weg"}])
    for _ in range(3):
        await media_scan.process_pending()
    doc = await flow.db.media_scans.find_one({"ref_id": attachment["id"]}, {"_id": 0})
    assert doc["state"] == "failed" and doc["attempts"] == 3 and "Modell weg" in doc["error"]
    # Sichtbar trotz Ausfall - sonst stünde jeder Chat still.
    flow.act_as(bob)
    assert (await flow.get(f"/api/chat-attachments/{attachment['id']}")).status_code == 200

    flow.act_as(alice)
    blocked = await upload_chat_image(flow)
    media_scan.fake_results.append(scores(0.99))
    await media_scan.process_pending()
    doc = await flow.db.media_scans.find_one({"ref_id": blocked["id"]}, {"_id": 0})
    assert (tmp_path / "quarantine" / doc["quarantine_key"]).is_file()
    assert await media_scan.purge_quarantine(flow.db) == 0
    await flow.db.media_scans.update_one({"id": doc["id"]}, {"$set": {"decided_at": (now_utc() - timedelta(days=100)).isoformat()}})
    assert await media_scan.purge_quarantine(flow.db) == 1
    assert not (tmp_path / "quarantine" / doc["quarantine_key"]).exists()
    after = await flow.db.media_scans.find_one({"id": doc["id"]}, {"_id": 0})
    assert after["quarantine_key"] is None and after["original_removed_at"] and after["state"] == "blocked"
