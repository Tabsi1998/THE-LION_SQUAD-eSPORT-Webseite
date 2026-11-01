"""Mitgliedschaft ohne Sackgassen (#2125): Annehmen vergibt Nummer und Art, Entscheidungen kommen immer an, Statuswechsel
mailen nur bei echter Änderung, das Mitglied entscheidet über die öffentliche Nummer, Austritt und Zurückziehen gehen ohne
Dolibarr, und der Export trägt nur, was nötig ist."""
import csv
import io
import pathlib
import sys
from datetime import date, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from services.dolibarr_policy import club_today  # noqa: E402
from services.notification_preferences import preference_key  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def chair_of(flow) -> dict:
    user = await flow.add_user(role="player", name="vorstand")
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": ["club"]}})
    user["areas"] = ["club"]
    return user


async def application(flow, user: dict, **extra) -> str:
    app_id = new_id()
    await flow.db.membership_applications.insert_one({"id": app_id, "user_id": user["id"], "status": "pending", "motivation": "Ich möchte gern im Verein mitspielen.",
                                                      "contribution_pref": "full", "type_id": None, "type_label": None, "created_at": "2026-10-01T10:00:00+00:00", **extra})
    return app_id


async def mails_to(flow, user: dict) -> list[dict]:
    email = (await flow.db.users.find_one({"id": user["id"]}))["email"]
    return await flow.db.mail_jobs.find({"to": email}, {"_id": 0}).to_list(20)


# ---------------------------------------------------------------- MG7, MG12: Liste und Export
@pytest.mark.asyncio
async def test_the_member_number_is_searchable(flow):
    chair = await chair_of(flow)
    erika = await flow.add_user(name="erika")
    await flow.db.memberships.insert_one({"user_id": erika["id"], "member_status": "active", "member_number": "TLS-2026-0042"})
    await flow.add_user(name="mara")
    flow.act_as(chair)
    found = (await flow.get("/api/users?q=2026-0042")).json()
    assert [row["username"] for row in found] == ["erika"]
    assert (await flow.get("/api/users?q=tls-2026-9999")).json() == []


@pytest.mark.asyncio
async def test_export_holds_only_the_needed_fields_and_is_logged(flow):
    chair = await chair_of(flow)
    erika, mara, gone = await flow.add_user(name="erika"), await flow.add_user(name="mara"), await flow.add_user(name="gone")
    await flow.db.users.update_one({"id": mara["id"]}, {"$set": {"display_name": "=SUMME(A1)"}})
    await flow.db.memberships.insert_many([
        {"user_id": erika["id"], "member_status": "active", "member_number": "TLS-2026-0001", "membership_type": "ordinary", "member_since": "2024-05-01T00:00:00+00:00", "notes": "GEHEIME NOTIZ", "internal_role": "Helfer"},
        {"user_id": mara["id"], "member_status": "honorary", "member_number": "TLS-2026-0002"},
        {"user_id": gone["id"], "member_status": "former", "member_number": "TLS-2020-0001"},
    ])
    flow.act_as(chair)
    response = await flow.get("/api/membership/export.csv")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv") and "no-store" in response.headers["cache-control"]
    assert "GEHEIME NOTIZ" not in response.text
    rows = list(csv.reader(io.StringIO(response.text.lstrip("﻿")), delimiter=";"))
    assert rows[0] == ["Mitgliedsnummer", "Name", "Benutzername", "E-Mail", "Status", "Art", "Mitglied seit", "Interne Rolle"]
    names = [row[2] for row in rows[1:]]
    assert sorted(names) == ["erika", "mara"], "Ehemalige nur mit scope=all"
    by_name = {row[2]: row for row in rows[1:]}
    assert by_name["erika"][4:8] == ["Aktives Mitglied", "Ordentlich", "2024-05-01", "Helfer"]
    assert by_name["mara"][1] == "'=SUMME(A1)", "keine Formel in der Tabelle"
    audit = await flow.db.audit_logs.find_one({"action": "membership.export"}, {"_id": 0})
    assert audit["data"] == {"scope": "active", "rows": 2} and audit["actor_id"] == chair["id"]

    everyone = await flow.get("/api/membership/export.csv?scope=all")
    assert "gone" in everyone.text

    flow.act_as(await flow.add_user(role="moderator", name="moderator"))
    assert (await flow.get("/api/membership/export.csv")).status_code == 403


@pytest.mark.asyncio
async def test_export_stays_in_dolibarr_when_it_leads(flow, monkeypatch):
    from routes import membership_routes

    async def live(*_args):
        return {"mode": "live"}

    monkeypatch.setattr(membership_routes, "load_dolibarr_settings", live)
    flow.act_as(await chair_of(flow))
    refused = await flow.get("/api/membership/export.csv")
    assert refused.status_code == 409 and "Dolibarr" in refused.json()["detail"]
    assert (await flow.get("/api/membership/meta")).json()["export_available"] is False


# ---------------------------------------------------------------- MG9, MG16: Statuswechsel
@pytest.mark.asyncio
async def test_a_status_change_mails_once_and_a_note_mails_nothing(flow):
    chair = await chair_of(flow)
    erika = await flow.add_user(name="erika")
    flow.act_as(chair)
    active = await flow.put(f"/api/membership/user/{erika['id']}", json={"member_status": "active"})
    assert active.status_code == 200 and active.json()["mail"] == "queued"
    assert [mail["template_key"] for mail in await mails_to(flow, erika)] == ["membership_activated"]

    # Die Seite schickt den Status immer mit: eine neue Notiz ist kein Statuswechsel.
    note = await flow.put(f"/api/membership/user/{erika['id']}", json={"member_status": "active", "notes": "Hilft beim Aufbau"})
    assert note.status_code == 200 and note.json()["mail"] is None
    assert len(await mails_to(flow, erika)) == 1

    told = await flow.db.notifications.find({"user_id": erika["id"], "kind": "membership_decision"}, {"_id": 0}).to_list(5)
    assert [row["title"] for row in told] == ["Deine Mitgliedschaft ist aktiv"]


@pytest.mark.asyncio
async def test_without_mail_is_a_choice_and_it_is_logged(flow):
    chair = await chair_of(flow)
    erika = await flow.add_user(name="erika")
    await flow.db.memberships.insert_one({"user_id": erika["id"], "member_status": "active", "member_number": "TLS-2026-0001"})
    flow.act_as(chair)
    response = await flow.put(f"/api/membership/user/{erika['id']}", json={"member_status": "former", "notify": False})
    assert response.status_code == 200 and response.json()["mail"] == "skipped"
    assert await mails_to(flow, erika) == []
    assert await flow.db.notifications.count_documents({"user_id": erika["id"], "kind": "membership_decision"}) == 0
    assert (await flow.db.audit_logs.find_one({"action": "membership.update"}))["data"] == {"member_status": "former", "notify": False}


@pytest.mark.asyncio
async def test_blocked_and_ended_arrive_with_mails_switched_off(flow):
    chair = await chair_of(flow)
    erika = await flow.add_user(name="erika")
    await flow.db.users.update_one({"id": erika["id"]}, {"$set": {"notification_preferences": {
        preference_key("email", "membership_updates"): False, preference_key("in_app", "membership_updates"): False, "membership_updates": False}}})
    await flow.db.memberships.insert_one({"user_id": erika["id"], "member_status": "active", "member_number": "TLS-2026-0001"})
    flow.act_as(chair)
    blocked = await flow.put(f"/api/membership/user/{erika['id']}", json={"member_status": "blocked"})
    assert blocked.json()["mail"] == "queued"
    ended = await flow.put(f"/api/membership/user/{erika['id']}", json={"member_status": "former"})
    assert ended.json()["mail"] == "queued"
    assert [mail["template_key"] for mail in await mails_to(flow, erika)] == ["membership_blocked", "membership_deactivated"]
    assert await flow.db.notifications.count_documents({"user_id": erika["id"], "kind": "membership_decision"}) == 2


@pytest.mark.asyncio
async def test_the_answer_says_honestly_when_no_mail_goes_out(flow):
    chair = await chair_of(flow)
    no_address = await flow.add_user(name="ohneadresse")
    await flow.db.users.update_one({"id": no_address["id"]}, {"$set": {"email": None}})
    flow.act_as(chair)
    assert (await flow.put(f"/api/membership/user/{no_address['id']}", json={"member_status": "active"})).json()["mail"] == "no_address"

    off = await flow.add_user(name="versandaus")
    await flow.db.settings.insert_one({"id": "mail", "enabled": False})
    flow.act_as(chair)
    assert (await flow.put(f"/api/membership/user/{off['id']}", json={"member_status": "active"})).json()["mail"] == "mail_off"


# ---------------------------------------------------------------- MG14: Annehmen
@pytest.mark.asyncio
async def test_approve_goes_the_same_way_as_by_hand(flow):
    chair = await chair_of(flow)
    erika = await flow.add_user(name="erika")
    app_id = await application(flow, erika, contribution_pref="supporter")
    flow.act_as(chair)
    response = await flow.patch(f"/api/membership/applications/{app_id}", json={"decision": "approve", "note": "Schön, dass du da bist."})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "approved" and response.json()["mail"] == "queued"
    membership = await flow.db.memberships.find_one({"user_id": erika["id"]}, {"_id": 0})
    assert membership["member_status"] == "active" and membership["member_number"].startswith("TLS-")
    assert membership["membership_type"] == "supporting" and membership["contribution_pref"] == "supporter"
    assert membership["member_since"] and membership["history"][-1]["to_status"] == "active" and membership["history"][-1]["actor_id"] == chair["id"]
    account = await flow.db.users.find_one({"id": erika["id"]})
    assert account["is_club_member"] is True and account["user_type"] == "club_member"
    mail = (await mails_to(flow, erika))[0]
    assert mail["template_key"] == "membership_approve" and "Schön, dass du da bist." in mail["html"]
    told = await flow.db.notifications.find_one({"user_id": erika["id"], "kind": "membership_decision"}, {"_id": 0})
    assert "Schön, dass du da bist." in told["body"]
    # Zweimal entscheiden geht nicht.
    assert (await flow.patch(f"/api/membership/applications/{app_id}", json={"decision": "reject", "note": "doch nicht"})).status_code == 400


@pytest.mark.asyncio
async def test_a_returning_member_keeps_the_number_and_the_beginning(flow):
    chair = await chair_of(flow)
    erika = await flow.add_user(name="erika")
    await flow.db.memberships.insert_one({"user_id": erika["id"], "member_status": "former", "member_number": "TLS-2020-0007", "member_since": "2020-02-01T00:00:00+00:00", "membership_type": "former", "history": []})
    app_id = await application(flow, erika)
    flow.act_as(chair)
    assert (await flow.patch(f"/api/membership/applications/{app_id}", json={"decision": "approve"})).status_code == 200
    membership = await flow.db.memberships.find_one({"user_id": erika["id"]}, {"_id": 0})
    assert membership["member_number"] == "TLS-2020-0007" and membership["member_since"] == "2020-02-01T00:00:00+00:00"
    assert membership["member_status"] == "active" and membership["membership_type"] == "ordinary"
    assert membership["history"][-1]["from_status"] == "former"


@pytest.mark.asyncio
async def test_a_fee_type_names_the_membership_type(flow):
    chair = await chair_of(flow)
    erika, mara = await flow.add_user(name="erika"), await flow.add_user(name="mara")
    first = await application(flow, erika, type_id=3, type_label="Fördernde Mitgliedschaft")
    second = await application(flow, mara, type_id=4, type_label="Mitgliedschaft Standard")
    flow.act_as(chair)
    await flow.patch(f"/api/membership/applications/{first}", json={"decision": "approve"})
    await flow.patch(f"/api/membership/applications/{second}", json={"decision": "approve"})
    assert (await flow.db.memberships.find_one({"user_id": erika["id"]}))["membership_type"] == "supporting"
    assert (await flow.db.memberships.find_one({"user_id": mara["id"]}))["membership_type"] == "ordinary"


@pytest.mark.asyncio
async def test_a_membership_led_by_dolibarr_is_not_approved_here(flow, monkeypatch):
    from routes import phase_c_routes

    async def live(*_args):
        return {"mode": "live"}

    async def linked(*_args):
        return {"status": "verified"}

    monkeypatch.setattr(phase_c_routes, "load_dolibarr_settings", live)
    monkeypatch.setattr(phase_c_routes, "verified_link", linked)
    chair = await chair_of(flow)
    erika = await flow.add_user(name="erika")
    app_id = await application(flow, erika)
    flow.act_as(chair)
    refused = await flow.patch(f"/api/membership/applications/{app_id}", json={"decision": "approve"})
    assert refused.status_code == 409 and "Dolibarr" in refused.json()["detail"]
    assert (await flow.db.membership_applications.find_one({"id": app_id}))["status"] == "pending"
    assert await flow.db.memberships.count_documents({"user_id": erika["id"]}) == 0


@pytest.mark.asyncio
async def test_a_rejection_arrives_even_with_mails_switched_off(flow):
    chair = await chair_of(flow)
    erika = await flow.add_user(name="erika")
    await flow.db.users.update_one({"id": erika["id"]}, {"$set": {"notification_preferences": {preference_key("email", "membership_updates"): False}}})
    app_id = await application(flow, erika)
    flow.act_as(chair)
    response = await flow.patch(f"/api/membership/applications/{app_id}", json={"decision": "reject", "note": "Bitte zuerst vorbeischauen."})
    assert response.json()["mail"] == "queued"
    assert [mail["template_key"] for mail in await mails_to(flow, erika)] == ["membership_reject"]
    assert "Bitte zuerst vorbeischauen." in (await flow.db.notifications.find_one({"user_id": erika["id"], "kind": "membership_decision"}))["body"]


# ---------------------------------------------------------------- MG13: Zurückziehen und Austritt
@pytest.mark.asyncio
async def test_a_person_withdraws_a_website_application_and_can_apply_again(flow):
    erika = await flow.add_user(name="erika")
    app_id = await application(flow, erika)
    flow.act_as(erika)
    response = await flow.post("/api/membership/apply/withdraw")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "withdrawn"
    stored = await flow.db.membership_applications.find_one({"id": app_id})
    assert stored["status"] == "withdrawn" and stored["decided_by"] == erika["id"]
    assert (await flow.db.audit_logs.find_one({"action": "membership.application_withdrawn"}))["target_id"] == erika["id"]
    assert (await flow.post("/api/membership/apply/withdraw")).status_code == 404


@pytest.mark.asyncio
async def test_the_board_withdraws_and_the_person_is_told(flow):
    chair = await chair_of(flow)
    erika = await flow.add_user(name="erika")
    app_id = await application(flow, erika)
    flow.act_as(erika)
    assert (await flow.post(f"/api/membership/applications/{app_id}/withdraw", json={})).status_code == 403
    flow.act_as(chair)
    response = await flow.post(f"/api/membership/applications/{app_id}/withdraw", json={"note": "Auf Wunsch per Telefon."})
    assert response.status_code == 200 and response.json()["status"] == "withdrawn"
    assert "Auf Wunsch per Telefon." in (await flow.db.notifications.find_one({"user_id": erika["id"], "kind": "membership_decision"}))["body"]
    assert (await flow.db.audit_logs.find_one({"action": "membership.application_withdrawn_by_board"}))["actor_id"] == chair["id"]
    # Schon zurückgezogen: nichts mehr zu tun.
    assert (await flow.post(f"/api/membership/applications/{app_id}/withdraw", json={})).status_code == 409
    missing = await flow.post("/api/membership/applications/gibt-es-nicht/withdraw", json={})
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_a_dolibarr_application_is_not_withdrawn_by_the_board_here(flow):
    chair = await chair_of(flow)
    erika = await flow.add_user(name="erika")
    app_id = await application(flow, erika, external_id="ext-1", dolibarr={})
    flow.act_as(chair)
    assert (await flow.post(f"/api/membership/applications/{app_id}/withdraw", json={})).status_code == 409


@pytest.mark.asyncio
async def test_failed_applications_can_be_listed(flow):
    chair = await chair_of(flow)
    erika = await flow.add_user(name="erika")
    await application(flow, erika, status="failed", external_id="ext-2", dolibarr={"error_text": "Pflichtfeld fehlt"})
    flow.act_as(chair)
    rows = (await flow.get("/api/membership/applications?status=failed")).json()
    assert len(rows) == 1 and rows[0]["dolibarr"]["error_text"] == "Pflichtfeld fehlt"


@pytest.mark.asyncio
async def test_exit_is_a_declaration_for_the_board_and_ending_clears_it(flow):
    chair = await chair_of(flow)
    erika = await flow.add_user(name="erika")
    await flow.db.memberships.insert_one({"user_id": erika["id"], "member_status": "active", "member_number": "TLS-2026-0001"})
    flow.act_as(erika)
    today = date.fromisoformat(club_today())
    past = (today - timedelta(days=1)).isoformat()
    assert (await flow.post("/api/membership/me/exit", json={"wished_last_day": past})).status_code == 422
    wished = (today + timedelta(days=30)).isoformat()
    declared = await flow.post("/api/membership/me/exit", json={"wished_last_day": wished})
    assert declared.status_code == 200, declared.text
    stored = await flow.db.memberships.find_one({"user_id": erika["id"]})
    assert stored["member_status"] == "active", "die Mitgliedschaft läuft, bis der Vorstand sie beendet"
    assert stored["exit_request"]["wished_last_day"] == wished
    assert (await flow.get("/api/membership/me")).json()["membership"]["exit_request"]["wished_last_day"] == wished
    assert (await flow.post("/api/membership/me/exit", json={})).json()["already"] is True
    assert await flow.db.audit_logs.count_documents({"action": "membership.exit_declared"}) == 1
    chair_doc = await flow.db.users.find_one({"id": chair["id"]})
    notice = await flow.db.mail_jobs.find_one({"to": chair_doc["email"], "template_key": "membership_exit_admin"})
    assert notice and (erika.get("display_name") or erika["username"]) in notice["html"]
    assert await flow.db.notifications.count_documents({"user_id": erika["id"], "kind": "membership_decision"}) == 1

    # Zurücknehmen, solange der Vorstand nichts getan hat.
    assert (await flow.delete("/api/membership/me/exit")).status_code == 200
    assert "exit_request" not in await flow.db.memberships.find_one({"user_id": erika["id"]})
    assert (await flow.delete("/api/membership/me/exit")).status_code == 404

    await flow.post("/api/membership/me/exit", json={})
    flow.act_as(chair)
    await flow.put(f"/api/membership/user/{erika['id']}", json={"member_status": "former"})
    assert "exit_request" not in await flow.db.memberships.find_one({"user_id": erika["id"]})


@pytest.mark.asyncio
async def test_exit_needs_a_running_membership_not_led_by_dolibarr(flow, monkeypatch):
    from routes import membership_routes

    erika = await flow.add_user(name="erika")
    flow.act_as(erika)
    assert (await flow.post("/api/membership/me/exit", json={})).status_code == 409
    await flow.db.memberships.insert_one({"user_id": erika["id"], "member_status": "active"})

    async def led(_user_id):
        return True

    monkeypatch.setattr(membership_routes, "_led_by_dolibarr", led)
    refused = await flow.post("/api/membership/me/exit", json={})
    assert refused.status_code == 409 and "Dolibarr" in refused.json()["detail"]


# ---------------------------------------------------------------- MG11: Nummer öffentlich
@pytest.mark.asyncio
async def test_the_member_decides_about_the_public_number_and_the_board_cannot(flow):
    chair = await chair_of(flow)
    erika = await flow.add_user(name="erika")
    await flow.db.users.update_one({"id": erika["id"]}, {"$set": {"privacy_public_profile": True}})
    await flow.db.memberships.insert_one({"user_id": erika["id"], "member_status": "active", "member_number": "TLS-2026-0001", "show_member_number_publicly": False})

    flow.act_as(chair)
    ignored = await flow.put(f"/api/membership/user/{erika['id']}", json={"show_member_number_publicly": True, "notes": "x"})
    assert ignored.status_code == 200 and ignored.json()["membership"]["show_member_number_publicly"] is False

    flow.act_as(erika)
    switched = await flow.put("/api/membership/me/number-visibility", json={"public": True})
    assert switched.status_code == 200 and switched.json()["show_member_number_publicly"] is True
    assert (await flow.db.memberships.find_one({"user_id": erika["id"]}))["show_member_number_publicly"] is True
    assert (await flow.put("/api/membership/me/number-visibility", json={"public": False})).status_code == 200

    # Ohne Nummer gibt es nichts zu zeigen.
    flow.act_as(await flow.add_user(name="community"))
    assert (await flow.put("/api/membership/me/number-visibility", json={"public": True})).status_code == 409


@pytest.mark.asyncio
async def test_existing_public_numbers_stay_public(flow):
    chair = await chair_of(flow)
    erika = await flow.add_user(name="erika")
    await flow.db.memberships.insert_one({"user_id": erika["id"], "member_status": "active", "member_number": "TLS-2026-0001", "show_member_number_publicly": True})
    flow.act_as(chair)
    await flow.put(f"/api/membership/user/{erika['id']}", json={"show_member_number_publicly": False, "notes": "y"})
    assert (await flow.db.memberships.find_one({"user_id": erika["id"]}))["show_member_number_publicly"] is True


# ---------------------------------------------------------------- MG17: Hinweis an den Vorstand
@pytest.mark.asyncio
async def test_a_new_application_reaches_everyone_with_the_club_area(flow):
    root = await flow.add_user(role="superadmin", name="root")
    grant = await chair_of(flow)
    holder = await flow.add_user(name="obfrau")
    await flow.db.memberships.insert_one({"user_id": holder["id"], "member_status": "active"})
    await flow.db.board_positions.insert_one({"id": new_id(), "slug": "obmann", "title_male": "Obmann", "is_active": True, "user_id": holder["id"]})
    outsider = await flow.add_user(role="moderator", name="moderator")
    applicant = await flow.add_user(name="erika")
    flow.act_as(applicant)
    response = await flow.post("/api/membership/apply", json={"motivation": "Ich möchte gern im Verein mitspielen.", "accept_statutes": True, "accept_privacy": True})
    assert response.status_code == 200, response.text
    told = {row["to"] for row in await flow.db.mail_jobs.find({"template_key": "membership_application_admin"}, {"_id": 0, "to": 1}).to_list(20)}
    addresses = {row["id"]: row["email"] for row in await flow.db.users.find({}, {"_id": 0, "id": 1, "email": 1}).to_list(20)}
    assert told == {addresses[root["id"]], addresses[grant["id"]], addresses[holder["id"]]}
    assert addresses[outsider["id"]] not in told and addresses[applicant["id"]] not in told


# ---------------------------------------------------------------- MG19: Vorteile
@pytest.mark.asyncio
async def test_benefits_respect_their_days(flow):
    erika = await flow.add_user(name="erika")
    await flow.db.memberships.insert_one({"user_id": erika["id"], "member_status": "active"})
    today = date.fromisoformat(club_today())
    day = lambda offset: (today + timedelta(days=offset)).isoformat()  # noqa: E731
    await flow.db.member_benefits.insert_many([
        {"id": "b-open", "title": "Ohne Datum", "is_active": True, "order_index": 1},
        {"id": "b-now", "title": "Läuft", "is_active": True, "order_index": 2, "valid_from": day(-1), "valid_until": day(1)},
        {"id": "b-ends-today", "title": "Letzter Tag", "is_active": True, "order_index": 3, "valid_until": day(0)},
        {"id": "b-starts-today", "title": "Erster Tag", "is_active": True, "order_index": 4, "valid_from": day(0)},
        {"id": "b-over", "title": "Abgelaufen", "is_active": True, "order_index": 5, "valid_until": day(-1)},
        {"id": "b-soon", "title": "Noch nicht", "is_active": True, "order_index": 6, "valid_from": day(1)},
    ])
    flow.act_as(erika)
    visible = [row["id"] for row in (await flow.get("/api/membership/benefits")).json()]
    assert visible == ["b-open", "b-now", "b-ends-today", "b-starts-today"]

    flow.act_as(await chair_of(flow))
    assert len((await flow.get("/api/membership/benefits/all")).json()) == 6, "die Verwaltung sieht alle"
