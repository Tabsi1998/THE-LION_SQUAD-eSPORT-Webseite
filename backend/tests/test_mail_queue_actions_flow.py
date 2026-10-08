"""Mail-Warteschlange (#1361): „Nochmal versuchen“ nur bei fehlgeschlagenen Mails - eine gesendete, wartende oder
gerade laufende Mail geht nie ein zweites Mal hinaus. Nur System kommt an die Warteschlange."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

STAMP = "2026-10-08T08:00:00+00:00"


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def queued(flow, status: str, template_key: str = "password_reset") -> str:
    job_id = f"job-{status}"
    await flow.db.mail_jobs.insert_one({
        "id": job_id, "to": f"{status}@example.test", "subject": "Hallo", "html": "<p>Hallo</p>", "template_key": template_key,
        "status": status, "attempts": 5 if status == "failed" else 1, "last_error": "550 5.1.1 user unknown" if status == "failed" else None,
        "next_attempt_at": STAMP, "created_at": STAMP, "updated_at": STAMP,
    })
    return job_id


@pytest.mark.asyncio
async def test_only_failed_mails_go_back_into_the_queue(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="system"))
    failed = await queued(flow, "failed")
    retried = await flow.post(f"/api/settings/mail-queue/{failed}/retry")
    assert retried.status_code == 200, retried.text
    job = await flow.db.mail_jobs.find_one({"id": failed})
    assert job["status"] == "pending" and job["attempts"] == 0 and job["last_error"] is None

    # Zweiter Klick auf dieselbe Mail: sie wartet schon - kein zweiter Versand.
    again = await flow.post(f"/api/settings/mail-queue/{failed}/retry")
    assert again.status_code == 409 and again.json()["detail"] == "Diese Mail wartet schon auf den Versand."

    expected = {"sent": "schon gesendet", "sending": "wird gerade gesendet", "skipped": "übersprungen"}
    for status, words in expected.items():
        job_id = await queued(flow, status)
        refused = await flow.post(f"/api/settings/mail-queue/{job_id}/retry")
        assert refused.status_code == 409, status
        assert words in refused.json()["detail"], status
        unchanged = await flow.db.mail_jobs.find_one({"id": job_id})
        assert unchanged["status"] == status

    missing = await flow.post("/api/settings/mail-queue/job-weg/retry")
    assert missing.status_code == 404 and missing.json()["detail"] == "Diese Mail gibt es nicht mehr."


@pytest.mark.asyncio
async def test_the_list_names_the_template_in_german_and_only_system_gets_in(flow):
    await queued(flow, "failed", template_key="registration_received")
    await queued(flow, "sent", template_key="eigene_vorlage")
    flow.act_as(await flow.add_user(role="superadmin", name="root"))
    listing = await flow.get("/api/settings/mail-queue?limit=10")
    assert listing.status_code == 200, listing.text
    rows = {row["id"]: row for row in listing.json()}
    assert rows["job-failed"]["template_label"] == "Turnier: Anmeldung eingegangen"
    assert "template_label" not in rows["job-sent"]
    assert all("html" not in row for row in rows.values())
    only_failed = await flow.get("/api/settings/mail-queue?status=failed")
    assert [row["id"] for row in only_failed.json()] == ["job-failed"]

    for role in ("tournament_admin", "moderator", "player"):
        flow.act_as(await flow.add_user(role=role, name=f"ohne-{role}"))
        refused = await flow.post("/api/settings/mail-queue/job-failed/retry")
        assert refused.status_code == 403, role
        hidden = await flow.get("/api/settings/mail-queue")
        assert hidden.status_code == 403, role
    granted = await flow.add_user(role="player", name="redaktion")
    await flow.db.users.update_one({"id": granted["id"]}, {"$set": {"areas": ["content", "club", "finance"]}})
    granted["areas"] = ["content", "club", "finance"]
    flow.act_as(granted)
    refused = await flow.post("/api/settings/mail-queue/job-failed/retry")
    assert refused.status_code == 403
    job = await flow.db.mail_jobs.find_one({"id": "job-failed"})
    assert job["status"] == "failed"
