"""Jede Rolle bekommt nur, was sie für ihre Arbeit braucht.

Der Systemstatus zeigt allen Admin-Bereichen, ob Datenbank, Mail, Discord und Zeitplan laufen; Server-Namen, Absender,
Upload-Pfade und Fehlertexte sieht nur der Bereich System. Helfer einer einzelnen Fast Lap wählen Fahrer nach Name und
Bild aus - E-Mail-Adressen und Rollen der Konten braucht dafür niemand.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def mail_with_problem(flow):
    await flow.db.settings.update_one(
        {"id": "mail"},
        {"$set": {"id": "mail", "provider": "smtp", "smtp_host": "mail.example.test",
                  "sender_email": "verein@example.test", "enabled": True}},
        upsert=True,
    )
    await flow.db.email_logs.insert_one({
        "created_at": "2026-10-07T12:00:00+00:00", "status": "failed",
        "error": "550 Empfänger jemand@example.test abgelehnt", "template_key": "news", "event_key": "news.published",
    })


@pytest.mark.asyncio
async def test_system_area_sees_details_other_areas_only_whether_it_runs(flow, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    await mail_with_problem(flow)

    flow.act_as(await flow.add_user(role="superadmin"))
    full = await flow.get("/api/admin/system-status")
    assert full.status_code == 200, full.text
    details = full.json()
    assert details["smtp"]["host"] == "mail.example.test"
    assert details["smtp"]["latest_problem"]["error"].startswith("550")
    assert details["uploads"]["checks"], "der Bereich System sieht die einzelnen Upload-Prüfungen"

    flow.act_as(await flow.add_user(role="tournament_admin"))
    short = await flow.get("/api/admin/system-status")
    assert short.status_code == 200, short.text
    summary = short.json()
    assert summary["smtp"]["ok"] is True and summary["smtp"]["provider"] == "smtp"
    assert summary["smtp"]["host"] == "" and summary["smtp"]["sender_email"] == "" and summary["smtp"]["latest_problem"] is None
    assert summary["discord"]["latest"] is None
    assert summary["uploads"] == {"ok": True}
    assert set(summary["mail_queue"]) == {"pending", "sending", "sent", "failed", "skipped"}
    assert "example.test" not in str(summary), "keine Server-Namen, Absender oder Adressen aus Fehlertexten"


@pytest.mark.asyncio
async def test_fast_lap_helper_picks_drivers_by_name_without_account_data(flow):
    admin = await flow.add_user(role="superadmin", name="Vorstand")
    helper = await flow.add_user(role="player", name="Helferlein")
    await flow.add_user(role="player", name="Fahrerin")
    await flow.db.f1_challenges.insert_one({"id": "fl-spa", "slug": "spa-test", "title": "Fast Lap Spa", "status": "live"})
    await flow.db.f1_staff_assignments.insert_one({
        "id": "fa-1", "challenge_id": "fl-spa", "user_id": helper["id"], "role": "scorekeeper", "is_active": True,
        "created_at": "2026-10-07T10:00:00+00:00",
    })

    flow.act_as(helper)
    users = await flow.get("/api/f1/challenges/fl-spa/assignable-users")
    assert users.status_code == 200, users.text
    rows = users.json()
    assert {row["display_name"] for row in rows} >= {"Fahrerin", "Helferlein", "Vorstand"}
    assert all("email" not in row and "role" not in row for row in rows)
    assert all("is_club_member" in row for row in rows), "die Wertung braucht weiter, wer Vereinsmitglied ist"

    staff = await flow.get("/api/f1/challenges/fl-spa/staff")
    assert staff.status_code == 200, staff.text
    assert staff.json() and all("email" not in (row.get("user") or {}) for row in staff.json())

    flow.act_as(admin)
    admin_staff = await flow.get("/api/f1/challenges/fl-spa/staff")
    assert admin_staff.status_code == 200, admin_staff.text
    assert all((row.get("user") or {}).get("email") for row in admin_staff.json()), "der Vorstand sieht die Helfer wie bisher"


@pytest.mark.asyncio
async def test_tournament_helper_picks_accounts_by_name_staff_still_sees_email(flow):
    await flow.add_user(role="player", name="Mitspielerin")
    tournament = await flow.create_tournament()
    helper = await flow.add_user(role="player", name="Turnierhelfer")
    await flow.db.tournament_staff_assignments.insert_one({
        "id": "ts-1", "tournament_id": tournament["id"], "user_id": helper["id"], "role": "organizer", "is_active": True,
    })

    flow.act_as(helper)
    listed = await flow.get(f"/api/tournaments/{tournament['id']}/assignable-users")
    assert listed.status_code == 200, listed.text
    assert listed.json() and all("email" not in row and "role" not in row for row in listed.json())
    by_mail = await flow.get(f"/api/tournaments/{tournament['id']}/assignable-users", params={"q": "example.test"})
    assert by_mail.status_code == 200 and by_mail.json() == [], "Helfer finden Konten nicht über die E-Mail-Adresse"
    by_name = await flow.get(f"/api/tournaments/{tournament['id']}/assignable-users", params={"q": "Mitspiel"})
    assert [row["display_name"] for row in by_name.json()] == ["Mitspielerin"]

    flow.act_as(await flow.add_user(role="tournament_admin"))
    staff_view = await flow.get(f"/api/tournaments/{tournament['id']}/assignable-users", params={"q": "Mitspiel"})
    assert staff_view.status_code == 200, staff_view.text
    assert staff_view.json()[0]["email"].endswith("@example.test")


@pytest.mark.asyncio
async def test_dashboard_lists_recent_admin_actions_full_entries_only_for_system(flow, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    await flow.db.audit_logs.insert_one({
        "id": "al-1", "action": "auth.login.2fa", "actor": "u-1", "ip": "203.0.113.7", "user_agent": "Testbrowser/1.0",
        "details": {"note": "intern"}, "created_at": "2026-10-07T12:00:00+00:00",
    })

    flow.act_as(await flow.add_user(role="tournament_admin"))
    lead = await flow.get("/api/admin/dashboard")
    assert lead.status_code == 200, lead.text
    assert lead.json()["recent_audit_logs"] == [{"action": "auth.login.2fa", "created_at": "2026-10-07T12:00:00+00:00"}]

    flow.act_as(await flow.add_user(role="superadmin"))
    system = await flow.get("/api/admin/dashboard")
    assert system.status_code == 200, system.text
    assert system.json()["recent_audit_logs"][0]["ip"] == "203.0.113.7"
