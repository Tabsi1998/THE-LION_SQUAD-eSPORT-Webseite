"""Konten aus der Verwaltung (#932): der Superadmin legt ein Konto per Einladung an - die Antwort trägt die Einladung,
das Protokoll zwei Einträge mit eigener ID - und anonymisiert ein normales Konto ohne Fehler.

Ersetzt die alten Live-Tests
test_iter20_bug_hunt.py::TestAdminInvite::test_admin_invite_user,
test_iter20_bugfixes.py::test_admin_user_invite_no_duplicate_key und die Restlücke aus
test_iter20_edge_cases.py::test_admin_audit_paths_no_500 (Konto löschen).
Erfundene Daten, keine echten Personen (example.com, weil die E-Mail-Prüfung .test als reservierten Namen ablehnt); die Einladungsmail wird nicht verschickt, sondern mitgeschrieben."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def sent(monkeypatch):
    from routes import user_routes

    mails = []

    async def capture(template, to, **kwargs):
        mails.append({"template": template, "to": to, **kwargs})
        return {"ok": True, "status": "sent"}

    monkeypatch.setattr(user_routes, "send_template", capture)
    return mails


@pytest.mark.asyncio
async def test_admin_invites_a_new_account_and_logs_both_steps(flow, sent):
    admin = await flow.add_staff()
    flow.act_as(admin)

    res = await flow.post("/api/users", json={"email": "neues.mitglied@example.com", "username": "neuesmitglied",
                                              "display_name": "Neues Mitglied", "send_invite": True})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["email"] == "neues.mitglied@example.com"
    assert body["invite_url"]
    assert body["invite_email"] == {"ok": True, "status": "sent"}
    assert "password_hash" not in body

    assert len(sent) == 1
    assert sent[0]["template"] == "user_invite" and sent[0]["to"] == "neues.mitglied@example.com"
    assert sent[0]["invite_url"] == body["invite_url"]

    rows = await flow.db.audit_logs.find({"target_id": body["id"]}, {"_id": 0}).to_list(10)
    assert sorted(row["action"] for row in rows) == ["user.create", "user.invite"]
    ids = [row.get("id") for row in rows]
    assert all(ids) and len(set(ids)) == 2, "jeder Protokolleintrag hat seine eigene ID"
    assert {row["actor_id"] for row in rows} == {admin["id"]}


@pytest.mark.asyncio
async def test_admin_anonymizes_a_normal_account(flow):
    admin = await flow.add_staff()
    member = await flow.add_user(name="ehemalig")
    flow.act_as(admin)

    res = await flow.delete(f"/api/users/{member['id']}")
    assert res.status_code == 200
    assert res.json() == {"ok": True, "anonymized": True}

    stored = await flow.db.users.find_one({"id": member["id"]}, {"_id": 0})
    assert stored["username"] == f"deleted_{member['id'][:12]}", "die Person ist nicht mehr erkennbar"
    assert stored["email"] == f"deleted_{member['id'][:12]}@deleted.invalid"
    assert await flow.db.audit_logs.count_documents({"action": "user.admin_anonymize", "actor_id": admin["id"]}) == 1
