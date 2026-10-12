"""Beitrittsantrag über Dolibarr (#328): mit Schalter fragt „Mitglied werden“ Dolibarr nach Pflichtfeldern,
Mitgliedsarten und Einwilligungstexten, schickt den Antrag genau einmal (feste external_id), hält
einen technischen Fehler als „wird übermittelt“ statt als Absage, liest den Stand nach, bindet bei der
Aufnahme genau das Konto und lässt die Website nicht mehr selbst entscheiden. Ohne Schalter bleibt
alles wie bisher."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import dolibarr_applications, dolibarr_client, dolibarr_sync  # noqa: E402
from services.notification_preferences import preference_key  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402


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
    monkeypatch.setattr(dolibarr_sync, "PENDING_DELAY_SECONDS", 0)
    return instance


async def connect(flow, mode="live", **extra):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": mode, "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1, "type_map": {"2": "ordinary", "3": "youth"}, **extra,
    }}, upsert=True)


async def person(flow, name):
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"email": f"{name}@example.test", "email_verified": True, "display_name": name.capitalize()}})
    return user


APPLICATION = {
    "accept_statutes": True, "accept_privacy": True, "type_id": 2, "firstname": "Amelie", "lastname": "Beispiel", "address": "Hauptplatz 1",
    "zip": "6020", "town": "Innsbruck", "birth": "2001-04-30", "motivation": "Ich spiele gern Rocket League.", "consents": [{"code": "fotos", "version": 2}],
}


@pytest.mark.asyncio
async def test_without_the_switch_the_website_keeps_its_own_application(flow, fake):
    await connect(flow)  # live, aber Schalter aus
    flow.act_as(await person(flow, "amelie"))
    form = (await flow.get("/api/membership/apply/form")).json()
    assert form["coupled"] is False and [o["value"] for o in form["contribution_options"]][:2] == ["full", "supporter"]
    short = await flow.post("/api/membership/apply", json={"motivation": "zu kurz", "accept_statutes": True, "accept_privacy": True})
    assert short.status_code == 422
    sent = await flow.post("/api/membership/apply", json={"motivation": "Ich möchte mitspielen und mich einbringen.", "contribution_pref": "youth", "accept_statutes": True, "accept_privacy": True})
    assert sent.status_code == 200 and sent.json()["status"] == "pending" and "external_id" not in sent.json()
    assert fake.applications == {}, "ohne Schalter geht nichts nach Dolibarr"
    assert (await flow.get("/api/membership/apply/me")).json()["status"] == "pending"


@pytest.mark.asyncio
async def test_application_goes_to_dolibarr_once_and_the_person_follows_its_state(flow, fake):
    await connect(flow, applications_enabled=True)
    fake.application_form["fields"] = [{"code": "gamertag", "label": "Gamertag", "required": True, "type": "text"}]
    amelie = await person(flow, "amelie")
    flow.act_as(amelie)

    form = (await flow.get("/api/membership/apply/form")).json()
    assert form["coupled"] is True and form["available"] is True
    assert form["form"]["required"] == ["lastname", "firstname", "address", "zip", "town", "email"] and form["form"]["fields"][0]["code"] == "gamertag"
    assert [fee["id"] for fee in form["fees"]] == [2, 3], "Mitgliedsarten für juristische Personen bleiben weg"
    assert form["fees"][0]["period_label"] == "je Jahr" and form["fees"][0]["prorated"] is True
    assert form["consents"] == [{"code": "fotos", "label": "Fotos auf der Website", "version": 2, "text": fake.consent_texts[0]["text"]}]

    # Die Website prüft vor dem Senden mit derselben Liste wie Dolibarr - in Worten.
    missing = await flow.post("/api/membership/apply", json={**APPLICATION, "town": "", "consents": [{"code": "fotos", "version": 1}]})
    assert missing.status_code == 422
    assert "Ort fehlt" in missing.json()["detail"] and "Gamertag fehlt" in missing.json()["detail"] and "geändert" in missing.json()["detail"]
    assert fake.applications == {}

    sent = await flow.post("/api/membership/apply", json={**APPLICATION, "fields": {"gamertag": "Ami"}})
    assert sent.status_code == 200, sent.text
    view = sent.json()
    assert view["status"] == "pending" and view["coupled"] is True and view["dolibarr"]["application_status"] == "received" and view["dolibarr"]["member_ref"]
    external_id = view["dolibarr"]["external_id"]
    assert external_id.startswith("web-") and len(fake.applications) == 1
    payload = fake.applications[external_id]["payload"]
    assert payload["email"] == "amelie@example.test" and payload["fields"] == {"gamertag": "Ami"} and payload["note"] == APPLICATION["motivation"]
    assert payload["consents"][0]["code"] == "fotos" and payload["consents"][0]["version"] == 2 and payload["consents"][0]["reference"] == external_id and "ip" not in payload["consents"][0]
    draft = fake.members[fake.applications[external_id]["draft_member_id"]]
    assert draft["status"] == "draft"

    # Kein zweiter Antrag, solange einer offen ist; ein erneutes Senden desselben Antrags legt nichts Neues an.
    assert (await flow.post("/api/membership/apply", json=APPLICATION)).status_code == 409
    doc = await flow.db.membership_applications.find_one({"external_id": external_id}, {"_id": 0})
    client = dolibarr_client.DolibarrClient(await dolibarr_client.load_settings(flow.db))
    again = await dolibarr_applications.submit(flow.db, client, doc)
    assert again["dolibarr"]["duplicate"] is True and len(fake.applications) == 1 and len([m for m in fake.members.values() if m["status"] == "draft"]) == 1

    # Die Verwaltung sieht den Stand und die Mitgliedskarte, entscheidet aber nicht auf der Website.
    admin = await flow.add_user(role="club_admin")
    flow.act_as(admin)
    rows = (await flow.get("/api/membership/applications?status=pending")).json()
    assert rows[0]["coupled"] is True and rows[0]["dolibarr"]["member_url"].endswith(f"/adherents/card.php?rowid={draft['id']}") and "person" not in rows[0]
    assert (await flow.patch(f"/api/membership/applications/{doc['id']}", json={"decision": "approve"})).status_code == 409

    # Ein fremdes Konto sieht nichts.
    flow.act_as(await person(flow, "fremd"))
    assert (await flow.get("/api/membership/apply/me")).json() is None

    # Aufnahme in Dolibarr: die Website liest nach, bindet genau dieses Konto und der Abgleich macht es zum Mitglied.
    fake.decide(external_id, "accepted")
    flow.act_as(amelie)
    await flow.db.membership_applications.update_one({"id": doc["id"]}, {"$set": {"dolibarr.checked_at": "2026-01-01T00:00:00+00:00"}})
    mine = (await flow.get("/api/membership/apply/me")).json()
    assert mine["status"] == "approved" and mine["dolibarr"]["application_status"] == "accepted"
    link = await flow.db.dolibarr_links.find_one({"user_id": amelie["id"]}, {"_id": 0})
    assert link["status"] == "verified" and link["member_id"] == draft["id"] and link["source"] == "application"
    assert await flow.db.dolibarr_pending.count_documents({"member_id": draft["id"]}) == 1
    assert (await dolibarr_sync.process_pending(flow.db))["processed"] == 1
    membership = await flow.db.memberships.find_one({"user_id": amelie["id"]}, {"_id": 0})
    assert membership["member_status"] == "active" and membership["source"] == "dolibarr"
    assert (await flow.db.membership_applications.find_one({"id": doc["id"]}))["notified_at"]
    assert (await flow.get("/api/membership/me")).json()["is_active_member"] is True


@pytest.mark.asyncio
async def test_outage_keeps_the_application_in_transit_and_the_job_sends_it_later(flow, fake):
    await connect(flow, applications_enabled=True)
    amelie = await person(flow, "amelie")
    flow.act_as(amelie)
    assert (await flow.get("/api/membership/apply/form")).json()["available"] is True
    fake.fail_with, fake.fail_paths = 503, {"/vereine/applications"}
    sent = await flow.post("/api/membership/apply", json=APPLICATION)
    assert sent.status_code == 200, sent.text
    assert sent.json()["status"] == "submitting" and sent.json()["dolibarr"]["error"] == "unavailable" and sent.json()["dolibarr"]["next_try_at"]
    assert fake.applications == {}
    assert (await flow.post("/api/membership/apply", json=APPLICATION)).status_code == 409, "kein zweiter Antrag nebenher"

    # Dolibarr wieder da: der Job sendet den einen Antrag - kein neuer Inhalt, keine zweite external_id.
    fake.fail_with = None
    await flow.db.membership_applications.update_one({"user_id": amelie["id"]}, {"$set": {"dolibarr.next_try_at": "2026-01-01T00:00:00+00:00"}})
    result = await dolibarr_applications.refresh_due(flow.db)
    assert result == {"ok": True, "sent": 1, "checked": 0, "notified": 0}
    mine = (await flow.get("/api/membership/apply/me")).json()
    assert mine["status"] == "pending" and len(fake.applications) == 1

    # Ablehnung: der Grund kommt zur Person, nirgendwo sonst hin; zurückziehen geht dann nicht mehr.
    external_id = mine["dolibarr"]["external_id"]
    fake.decide(external_id, "rejected", reason="Bitte zuerst bei zwei Vereinsabenden vorbeischauen.")
    await flow.db.membership_applications.update_one({"external_id": external_id}, {"$set": {"dolibarr.checked_at": "2026-01-01T00:00:00+00:00"}})
    mine = (await flow.get("/api/membership/apply/me")).json()
    assert mine["status"] == "rejected" and mine["decision_note"] == "Bitte zuerst bei zwei Vereinsabenden vorbeischauen."
    assert await flow.db.dolibarr_links.count_documents({"user_id": amelie["id"]}) == 0
    assert (await flow.post("/api/membership/apply/withdraw")).status_code == 404

    # Neuer Antrag nach einer Ablehnung ist möglich - und lässt sich zurückziehen, solange offen.
    sent = await flow.post("/api/membership/apply", json=APPLICATION)
    assert sent.status_code == 200 and len(fake.applications) == 2
    withdrawn = await flow.post("/api/membership/apply/withdraw")
    assert withdrawn.status_code == 200 and withdrawn.json()["status"] == "withdrawn"
    assert fake.applications[withdrawn.json()["dolibarr"]["external_id"]]["status"] == "withdrawn"
    assert (await flow.post("/api/membership/apply/withdraw")).status_code == 404

    # Fachliches Nein von Dolibarr (veralteter Einwilligungstext zwischen Anzeigen und Senden): kein Hängen, neu stellen.
    fake.consent_texts[0]["version"] = 3
    doc_id = "app-alt"
    await flow.db.membership_applications.insert_one({
        "id": doc_id, "user_id": amelie["id"], "external_id": "web-app-alt", "source": "dolibarr", "type_id": 2, "status": "submitting",
        "person": {"firstname": "Amelie", "lastname": "Beispiel", "email": "amelie@example.test", "address": "Hauptplatz 1", "zip": "6020", "town": "Innsbruck", "country_code": "AT"},
        # Der jüngste Antrag der Person: morgen - ein festes Datum würde eines Tages vom Kalender überholt.
        "consents": [{"code": "fotos", "version": 2}], "created_at": (now_utc() + timedelta(days=1)).isoformat(), "dolibarr": {"attempts": 0, "next_try_at": "2026-01-01T00:00:00+00:00"},
    })
    await dolibarr_applications.refresh_due(flow.db)
    stale = await flow.db.membership_applications.find_one({"id": doc_id}, {"_id": 0})
    assert stale["status"] == "failed" and stale["dolibarr"]["error"] == "bad_request"
    mine = (await flow.get("/api/membership/apply/me")).json()
    assert mine["status"] == "failed" and mine["dolibarr"]["error_text"]


# --------------------------------------------------------------------------- Entscheidungsmail (#1444)
async def applied(flow, fake, name="amelie"):
    """Ein Antrag, der in Dolibarr liegt - zurück kommen Person und external_id."""
    await connect(flow, applications_enabled=True)
    user = await person(flow, name)
    flow.act_as(user)
    sent = await flow.post("/api/membership/apply", json=APPLICATION)
    assert sent.status_code == 200, sent.text
    return user, sent.json()["dolibarr"]["external_id"]


async def decided_in_dolibarr(flow, fake, external_id, status, reason=""):
    """Der Verein entscheidet in Dolibarr, der Job liest nach."""
    fake.decide(external_id, status, reason=reason)
    await flow.db.membership_applications.update_one({"external_id": external_id}, {"$set": {"dolibarr.checked_at": "2026-01-01T00:00:00+00:00"}})
    return await dolibarr_applications.refresh_due(flow.db)


async def mails_to(flow, user):
    address = (await flow.db.users.find_one({"id": user["id"]}))["email"]
    return await flow.db.mail_jobs.find({"to": address}, {"_id": 0}).to_list(50)


@pytest.mark.asyncio
async def test_acceptance_in_dolibarr_puts_exactly_one_mail_in_the_queue(flow, fake):
    amelie, external_id = await applied(flow, fake)
    await decided_in_dolibarr(flow, fake, external_id, "accepted")
    mails = await mails_to(flow, amelie)
    assert len(mails) == 1 and mails[0]["template_key"] == "membership_approve" and "Amelie" in mails[0]["html"]
    assert (await flow.db.membership_applications.find_one({"external_id": external_id}))["notified_at"]

    # Ein weiterer Lauf schickt nichts nach.
    await dolibarr_applications.refresh_due(flow.db)
    assert len(await mails_to(flow, amelie)) == 1


@pytest.mark.asyncio
async def test_rejection_in_dolibarr_sends_the_reason_once(flow, fake):
    amelie, external_id = await applied(flow, fake)
    await decided_in_dolibarr(flow, fake, external_id, "rejected", reason="Bitte zuerst bei zwei Vereinsabenden vorbeischauen.")
    mails = await mails_to(flow, amelie)
    assert len(mails) == 1 and mails[0]["template_key"] == "membership_reject"
    assert "Bitte zuerst bei zwei Vereinsabenden vorbeischauen." in mails[0]["html"]
    assert (await flow.db.membership_applications.find_one({"external_id": external_id}))["notified_at"]


@pytest.mark.asyncio
async def test_switched_off_membership_mails_send_nothing_but_count_as_done(flow, fake):
    amelie, external_id = await applied(flow, fake)
    await flow.db.users.update_one({"id": amelie["id"]}, {"$set": {"notification_preferences": {preference_key("email", "membership_updates"): False}}})
    await decided_in_dolibarr(flow, fake, external_id, "accepted")
    assert await mails_to(flow, amelie) == []
    assert (await flow.db.membership_applications.find_one({"external_id": external_id}))["notified_at"]


@pytest.mark.asyncio
async def test_a_failed_enqueue_leaves_the_decision_open_and_the_next_run_sends_once(flow, fake, monkeypatch, caplog):
    from services import mail_queue

    amelie, external_id = await applied(flow, fake)

    async def broken(*args, **kwargs):
        raise RuntimeError("Warteschlange voll für amelie@example.test")

    real = mail_queue.enqueue_mail
    monkeypatch.setattr(mail_queue, "enqueue_mail", broken)
    caplog.set_level("WARNING")
    await decided_in_dolibarr(flow, fake, external_id, "accepted")
    doc = await flow.db.membership_applications.find_one({"external_id": external_id}, {"_id": 0})
    assert doc["status"] == "approved" and not doc.get("notified_at"), "ohne Mail in der Warteschlange ist die Entscheidung nicht mitgeteilt"
    assert await mails_to(flow, amelie) == []
    assert "Entscheidungsmail" in caplog.text and "amelie@example.test" not in caplog.text, "Fehler im Protokoll, aber ohne Adresse"
    assert doc["decision_mail_pending"] is True, "der Fehlschlag ist für den nächsten Lauf markiert"

    monkeypatch.setattr(mail_queue, "enqueue_mail", real)
    await dolibarr_applications.refresh_due(flow.db)
    mails = await mails_to(flow, amelie)
    assert len(mails) == 1 and mails[0]["template_key"] == "membership_approve"
    done = await flow.db.membership_applications.find_one({"external_id": external_id}, {"_id": 0})
    assert done["notified_at"] and "decision_mail_pending" not in done and "decision_mail_claimed_at" not in done
    await dolibarr_applications.refresh_due(flow.db)
    assert len(await mails_to(flow, amelie)) == 1


@pytest.mark.asyncio
async def test_old_decisions_without_the_mark_get_no_mail_after_the_update(flow, fake):
    """Altbestand ohne notified_at (etwa aus der Zeit vor dem Feld) bleibt still - nachgeholt wird nur, was der
    neue Code selbst als gescheitert markiert hat."""
    await connect(flow, applications_enabled=True)
    old = await person(flow, "altbestand")
    await flow.db.membership_applications.insert_one({
        "id": "app-alt-entschieden", "user_id": old["id"], "external_id": "web-app-alt-entschieden", "source": "dolibarr",
        "status": "approved", "decided_by": "dolibarr", "decided_at": "2025-03-01T10:00:00+00:00", "created_at": "2025-02-01T10:00:00+00:00",
    })
    result = await dolibarr_applications.refresh_due(flow.db)
    assert result["notified"] == 0
    assert await mails_to(flow, old) == []
    assert not (await flow.db.membership_applications.find_one({"id": "app-alt-entschieden"})).get("notified_at")


@pytest.mark.asyncio
async def test_two_runs_at_once_queue_one_decision_mail(flow, fake, monkeypatch):
    import asyncio

    from services import mail_queue

    amelie, external_id = await applied(flow, fake)
    fake.decide(external_id, "accepted")
    await flow.db.membership_applications.update_one({"external_id": external_id}, {"$set": {"status": "approved", "decided_by": "dolibarr"}})
    doc = await flow.db.membership_applications.find_one({"external_id": external_id}, {"_id": 0})

    real = mail_queue.enqueue_mail

    async def slow(*args, **kwargs):
        await asyncio.sleep(0.01)  # beide Läufe sind gleichzeitig mitten im Einreihen
        return await real(*args, **kwargs)

    monkeypatch.setattr(mail_queue, "enqueue_mail", slow)
    first, second = await asyncio.gather(dolibarr_applications._notify_decision(flow.db, doc), dolibarr_applications._notify_decision(flow.db, doc))
    assert sorted([first, second]) == [False, True]
    assert len(await mails_to(flow, amelie)) == 1


@pytest.mark.asyncio
async def test_the_admin_decision_without_dolibarr_still_mails_the_person(flow, fake):
    """Der Weg ohne Dolibarr nutzt dieselbe Mail: Vorlage, Begründung, Einstellungen der Person."""
    admin = await flow.add_user(role="club_admin")
    for name, prefs in (("amelie", {}), ("ruhig", {preference_key("email", "membership_updates"): False})):
        user = await person(flow, name)
        await flow.db.users.update_one({"id": user["id"]}, {"$set": {"notification_preferences": prefs}})
        flow.act_as(user)
        sent = await flow.post("/api/membership/apply", json={"motivation": "Ich möchte mitspielen und mich einbringen.", "contribution_pref": "full", "accept_statutes": True, "accept_privacy": True})
        assert sent.status_code == 200, sent.text
        flow.act_as(admin)
        decided = await flow.patch(f"/api/membership/applications/{sent.json()['id']}", json={"decision": "reject", "note": "Bitte im Frühjahr nochmal."})
        assert decided.status_code == 200, decided.text
        mails = await mails_to(flow, user)
        if prefs:
            assert mails == [], "abgeschaltete Mitgliedschafts-Mails bleiben aus"
        else:
            assert len(mails) == 1 and "Bitte im Frühjahr nochmal." in mails[0]["html"]
