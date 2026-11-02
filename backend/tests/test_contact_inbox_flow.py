"""Kontakt-Inbox (#2131): Liste vom Server (offen, Suche ohne Regex-Injection, Seiten), zuständig, Antwort über die
Mail-Queue, Aufbewahrung mit wirklich entfernten Personendaten, deutsche Meldungen, Thema Rechnung, Kontext beim
Fehler melden. Nur Fakes: die Warteschlange wird gelesen, nichts wird versandt."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import contact_retention, ops_alerts  # noqa: E402
from services.mail_catalog import CATALOG  # noqa: E402
from services.notification_preferences import TEMPLATE_CATEGORY  # noqa: E402

NOW = datetime.now(timezone.utc)


def days_ago(days: int) -> str:
    return (NOW - timedelta(days=days)).isoformat()


def message(mid: str, **fields) -> dict:
    return {"id": mid, "name": "Paula Beispiel", "email": "paula@example.test", "topic": "general", "subject": f"Betreff {mid}", "message": "Eine Frage", "status": "new",
            "created_at": days_ago(1), "user_id": None, "internal_note": "", **fields}


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "kontakt-tests-secret-with-at-least-32-characters")
    monkeypatch.setenv("FRONTEND_URL", "https://lionsquad.at")
    instance, shutdown = make_flow()
    from services import discord_announcements

    async def silent(*_args, **_kwargs):
        return None

    monkeypatch.setattr(discord_announcements, "notify_board", silent)
    try:
        yield instance
    finally:
        await shutdown()


async def club_person(flow, name="Vera Vorstand") -> dict:
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": ["club"], "is_active": True}})
    return {**user, "areas": ["club"], "is_active": True}


async def inbox(flow, **params):
    response = await flow.get("/api/contact", params=params)
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------- Liste

@pytest.mark.asyncio
async def test_default_view_is_open_and_counts_stay_for_everything(flow):
    await flow.db.contact_messages.insert_many([
        message("a"), message("b", status="in_progress"), message("c", status="answered"), message("d", status="closed"),
        message("e", status="spam", spam={"reasons": ["links"]}), message("f", status="spam"),
    ])
    flow.act_as(await club_person(flow))
    data = await inbox(flow)
    assert {row["id"] for row in data["items"]} == {"a", "b"}, "Standard: was noch jemanden braucht"
    assert data["total"] == 2 and data["counts"] == {"new": 1, "in_progress": 1, "answered": 1, "closed": 1, "spam": 2}
    assert data["suspicious"] == 1, "nur vom Spamschutz markierte"
    assert data["retention"] == {"done_days": 365, "spam_days": 30}
    assert {row["id"] for row in (await inbox(flow, status="all"))["items"]} == {"a", "b", "c", "d"}, "Alle heißt: ohne Spam"
    assert {row["id"] for row in (await inbox(flow, status="spam"))["items"]} == {"e", "f"}
    assert (await flow.get("/api/contact", params={"status": "unsinn"})).status_code == 422


@pytest.mark.asyncio
async def test_inbox_needs_the_club_area(flow):
    await flow.db.contact_messages.insert_one(message("a"))
    flow.act_as(await flow.add_user(role="tournament_admin", name="Turnier"))
    for call in (flow.get("/api/contact"), flow.get("/api/contact/assignees"), flow.post("/api/contact/a/reply", json={"text": "Hallo du", "request_id": "abcdefgh"}),
                 flow.patch("/api/contact/a", json={"assigned_to": ""})):
        assert (await call).status_code == 403
    assert await flow.db.mail_jobs.count_documents({}) == 0


@pytest.mark.asyncio
async def test_search_treats_input_as_text_and_pages_through(flow):
    await flow.db.contact_messages.insert_many([
        message("a", subject="Frage (dringend)"), message("b", name="Max Muster", subject="Turnier"), message("c", email="noch.jemand@example.test", subject="x"),
        message("d", message="Hier steht .* drin", subject="y"),
    ])
    flow.act_as(await club_person(flow))
    assert [row["id"] for row in (await inbox(flow, q="(dringend"))["items"]] == ["a"], "eine offene Klammer ist kein Fehler"
    assert [row["id"] for row in (await inbox(flow, q="MUSTER"))["items"]] == ["b"]
    assert [row["id"] for row in (await inbox(flow, q="noch.jemand"))["items"]] == ["c"]
    assert [row["id"] for row in (await inbox(flow, q=".*"))["items"]] == ["d"], "kein Regex: .* findet nur den wörtlichen Text"
    assert (await inbox(flow, q="^P"))["items"] == []
    assert (await flow.get("/api/contact", params={"q": "x" * 121})).status_code == 422

    await flow.db.contact_messages.insert_many([message(f"seite-{index}", created_at=days_ago(100 + index), subject="Stapel") for index in range(5)])
    first = await inbox(flow, q="Stapel", limit=2, page=1)
    second = await inbox(flow, q="Stapel", limit=2, page=3)
    assert first["total"] == 5 and [row["id"] for row in first["items"]] == ["seite-0", "seite-1"]
    assert [row["id"] for row in second["items"]] == ["seite-4"]
    assert (await flow.get("/api/contact", params={"limit": 101})).status_code == 422


# ---------------------------------------------------------------- Zuständig, Status, Notiz

@pytest.mark.asyncio
async def test_assign_only_to_people_with_the_club_area_and_filter_by_it(flow):
    await flow.db.contact_messages.insert_many([message("a"), message("b")])
    me = await club_person(flow)
    flow.act_as(me)
    assert {"id": me["id"], "name": "Vera Vorstand"} in (await flow.get("/api/contact/assignees")).json()
    stranger = await flow.add_user(role="player", name="Spieler")
    wrong = await flow.patch("/api/contact/a", json={"assigned_to": stranger["id"]})
    assert wrong.status_code == 400 and "Vereinsverwaltung" in wrong.json()["detail"]

    set_to = await flow.patch("/api/contact/a", json={"assigned_to": me["id"]})
    assert set_to.status_code == 200 and set_to.json()["assigned_to"] == me["id"] and set_to.json()["assigned_to_name"] == "Vera Vorstand"
    assert [row["id"] for row in (await inbox(flow, assigned="me"))["items"]] == ["a"]
    assert [row["id"] for row in (await inbox(flow, assigned="none"))["items"]] == ["b"]
    logged = await flow.db.audit_logs.find_one({"action": "contact.assign"}, {"_id": 0})
    assert logged["target_id"] == "a" and logged["data"] == {"to": me["id"]}

    cleared = await flow.patch("/api/contact/a", json={"assigned_to": ""})
    assert cleared.status_code == 200 and cleared.json()["assigned_to"] is None and cleared.json()["assigned_to_name"] is None


@pytest.mark.asyncio
async def test_note_alone_changes_neither_status_nor_its_clock(flow):
    await flow.db.contact_messages.insert_one(message("a", status="in_progress", status_changed_at=days_ago(5), internal_note="alt"))
    flow.act_as(await club_person(flow))
    saved = await flow.patch("/api/contact/a", json={"internal_note": ""})
    assert saved.status_code == 200 and saved.json()["internal_note"] == "" and saved.json()["status"] == "in_progress"
    assert saved.json()["status_changed_at"] == days_ago(5)
    assert (await flow.patch("/api/contact/a", json={})).status_code == 400
    assert (await flow.patch("/api/contact/fehlt", json={"status": "closed"})).status_code == 404
    assert (await flow.patch("/api/contact/a", json={"internal_note": "x" * 4001})).status_code == 422


@pytest.mark.asyncio
async def test_answered_by_hand_keeps_who_and_when_and_the_first_time_counts(flow):
    await flow.db.contact_messages.insert_one(message("a"))
    me = await club_person(flow)
    flow.act_as(me)
    marked = (await flow.patch("/api/contact/a", json={"status": "answered"})).json()
    assert marked["answered_by"] == me["id"] and marked["answered_by_name"] == "Vera Vorstand" and marked["answered_at"]
    other = await club_person(flow, "Otto Obmann")
    flow.act_as(other)
    again = (await flow.patch("/api/contact/a", json={"status": "answered"})).json()
    assert again["answered_by"] == me["id"], "noch einmal derselbe Status ändert nichts"


# ---------------------------------------------------------------- Antwort

@pytest.mark.asyncio
async def test_reply_goes_through_the_queue_only_to_the_address_of_the_request(flow):
    await flow.db.contact_messages.insert_one(message("a", name="Paula Beispiel", subject="Frage\r\nBcc: alle@example.test"))
    me = await club_person(flow)
    flow.act_as(me)
    sent = await flow.post("/api/contact/a/reply", json={"text": "  Danke für die Nachricht.\r\nZweite <b>Zeile</b>\x07  ", "request_id": "antwort-eins"})
    assert sent.status_code == 200, sent.text
    body = sent.json()
    assert body["status"] == "answered" and body["answered_by_name"] == "Vera Vorstand" and body["status_changed_at"] == body["answered_at"]
    assert [reply["text"] for reply in body["replies"]] == ["Danke für die Nachricht.\nZweite <b>Zeile</b>"], "Wortlaut im Verlauf, ohne Steuerzeichen"
    assert body["replies"][0]["by_name"] == "Vera Vorstand"

    [job] = await flow.db.mail_jobs.find({"template_key": "contact_reply"}, {"_id": 0}).to_list(5)
    assert job["to"] == "paula@example.test" and job["meta"] == {"contact_id": "a"}
    assert "\n" not in job["subject"] and "\r" not in job["subject"], "keine weitere Kopfzeile"
    assert "&lt;b&gt;Zeile&lt;/b&gt;" in job["html"] and "<b>Zeile" not in job["html"], "als Text in die Mail"
    assert "Hallo Paula" in job["html"]
    assert "List-Unsubscribe" not in (job.get("headers") or {})

    logged = await flow.db.audit_logs.find_one({"action": "contact.reply"}, {"_id": 0})
    assert logged["target_id"] == "a" and "Danke" not in str(logged) and "paula" not in str(logged).lower(), "kein Wortlaut, keine Adresse im Protokoll"


@pytest.mark.asyncio
async def test_same_request_twice_means_one_entry_and_one_mail(flow):
    await flow.db.contact_messages.insert_one(message("a"))
    flow.act_as(await club_person(flow))
    payload = {"text": "Einmal reicht", "request_id": "doppelklick"}
    assert (await flow.post("/api/contact/a/reply", json=payload)).status_code == 200
    again = await flow.post("/api/contact/a/reply", json=payload)
    assert again.status_code == 200 and len(again.json()["replies"]) == 1
    assert await flow.db.mail_jobs.count_documents({"template_key": "contact_reply"}) == 1
    # Stürzt es zwischen Verlauf und Mail ab, holt derselbe Versuch die Mail nach.
    await flow.db.mail_jobs.delete_many({})
    assert (await flow.post("/api/contact/a/reply", json=payload)).status_code == 200
    assert await flow.db.mail_jobs.count_documents({"template_key": "contact_reply"}) == 1
    # Ein neuer Text ist eine neue Antwort.
    assert (await flow.post("/api/contact/a/reply", json={"text": "Noch etwas", "request_id": "zweite-antwort"})).status_code == 200
    assert await flow.db.mail_jobs.count_documents({"template_key": "contact_reply"}) == 2


@pytest.mark.asyncio
async def test_no_reply_to_spam_without_address_or_with_a_bad_one(flow):
    await flow.db.contact_messages.insert_many([
        message("spam", status="spam", spam={"reasons": ["links"]}), message("weg", email=None, name="Gelöschter User"),
        message("kaputt", email="a@example.test\r\nBcc: b@example.test"), message("zwei", email="a@example.test, b@example.test"),
    ])
    flow.act_as(await club_person(flow))
    payload = {"text": "Hallo du", "request_id": "abcdefgh"}
    blocked = await flow.post("/api/contact/spam/reply", json=payload)
    assert blocked.status_code == 409 and "Spam" in blocked.json()["detail"]
    for cid in ("weg", "kaputt", "zwei"):
        assert (await flow.post(f"/api/contact/{cid}/reply", json=payload)).status_code == 409, cid
    assert (await flow.post("/api/contact/fehlt/reply", json=payload)).status_code == 404
    assert (await flow.post("/api/contact/spam/reply", json={"text": "x", "request_id": "abcdefgh"})).status_code == 422
    assert (await flow.post("/api/contact/spam/reply", json={"text": "Hallo", "request_id": "kein gültiger Wert!"})).status_code == 422
    empty = await flow.post("/api/contact/weg/reply", json={"text": "\x07\x07\x07", "request_id": "abcdefgh"})
    assert empty.status_code == 400
    assert await flow.db.mail_jobs.count_documents({}) == 0
    assert (await flow.db.contact_messages.find_one({"id": "spam"}))["status"] == "spam"


def test_the_reply_is_in_the_catalog_and_cannot_be_unsubscribed():
    assert CATALOG["contact_reply"]["category"] == "club"
    assert "contact_reply" not in TEMPLATE_CATEGORY, "die Person hat gefragt - keine Abbestell-Kategorie"


@pytest.mark.asyncio
async def test_an_own_template_is_used_and_values_stay_text(flow):
    await flow.db.contact_messages.insert_one(message("a"))
    await flow.db.email_templates.insert_one({"key": "contact_reply", "id": "contact_reply", "subject": "Antwort vom Verein", "html": "<p>{{reply}} / {{subject}}</p>"})
    flow.act_as(await club_person(flow))
    assert (await flow.post("/api/contact/a/reply", json={"text": "<script>x</script>", "request_id": "abcdefgh"})).status_code == 200
    job = await flow.db.mail_jobs.find_one({"template_key": "contact_reply"})
    assert job["subject"] == "Antwort vom Verein" and "&lt;script&gt;" in job["html"] and "<script>" not in job["html"]


# ---------------------------------------------------------------- Aufbewahrung

async def keep_days(flow, done=365, spam=30):
    await ops_alerts.save_alert_settings(flow.db, {"retention_days": {"contact_done": done, "contact_spam": spam}})


@pytest.mark.asyncio
async def test_done_and_spam_run_out_open_ones_never(flow):
    await flow.db.contact_messages.insert_many([
        message("zu-alt", status="closed", status_changed_at=days_ago(366), created_at=days_ago(800)),
        message("zu-jung", status="closed", status_changed_at=days_ago(364), created_at=days_ago(800)),
        message("beantwortet-alt", status="answered", status_changed_at=days_ago(366)),
        message("spam-alt", status="spam", status_changed_at=days_ago(31), spam={"reasons": ["links"]}),
        message("spam-jung", status="spam", status_changed_at=days_ago(29), spam={"reasons": ["links"]}),
        message("spam-laeuft", status="spam", status_changed_at=days_ago(31), spam={"reasons": ["links"], "release": {"state": "releasing"}}),
        message("offen-uralt", status="new", created_at=days_ago(2000), status_changed_at=days_ago(2000)),
        message("in-arbeit-uralt", status="in_progress", created_at=days_ago(2000), status_changed_at=days_ago(2000)),
    ])
    removed = await ops_alerts.purge_old_logs(flow.db)
    assert removed["contact_messages"] == 3
    left = {row["id"] async for row in flow.db.contact_messages.find({}, {"_id": 0, "id": 1})}
    assert left == {"zu-jung", "spam-jung", "spam-laeuft", "offen-uralt", "in-arbeit-uralt"}


@pytest.mark.asyncio
async def test_the_values_can_be_changed_and_are_bounded(flow):
    await flow.db.contact_messages.insert_many([
        message("a", status="closed", status_changed_at=days_ago(40)), message("b", status="spam", status_changed_at=days_ago(8)),
    ])
    assert (await contact_retention.purge_expired(flow.db, done_days=365, spam_days=30)) == 0
    await keep_days(flow, done=30, spam=7)
    assert (await ops_alerts.purge_old_logs(flow.db))["contact_messages"] == 2
    flow.act_as(await flow.add_user(role="club_admin", name="System"))
    assert (await flow.put("/api/admin/ops/alerts", json={"retention_days": {"contact_spam": 3}})).status_code == 400
    assert (await flow.put("/api/admin/ops/alerts", json={"retention_days": {"contact_spam": 14}})).status_code == 200
    assert (await inbox(flow))["retention"]["spam_days"] == 14


@pytest.mark.asyncio
async def test_rows_from_before_the_rule_get_a_full_term_instead_of_going_right_away(flow):
    await flow.db.contact_messages.insert_one(message("alt", status="closed", created_at=days_ago(2000)))
    assert (await ops_alerts.purge_old_logs(flow.db))["contact_messages"] == 0
    row = await flow.db.contact_messages.find_one({"id": "alt"})
    assert row["status_changed_at"], "beim ersten Lauf gestempelt"
    assert await contact_retention.purge_expired(flow.db, done_days=365, spam_days=30, now=NOW + timedelta(days=366)) == 1


@pytest.mark.asyncio
async def test_personal_data_really_goes_with_the_copies_of_the_mails(flow):
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"id": "branding", "contact_email": "vorstand@example.test", "domain": "https://lionsquad.at"}}, upsert=True)
    from routes import contact_board_routes

    doc = message("a", subject="Geheimes Thema", message="Meine Adresse ist Teststraße 1", status="closed", status_changed_at=days_ago(400))
    await flow.db.contact_messages.insert_one(doc)
    await contact_board_routes._notify_contact(flow.db, doc)
    other = message("b", name="Andere Person", email="andere@example.test", subject="Bleibt", status="new")
    await flow.db.contact_messages.insert_one(other)
    await contact_board_routes._notify_contact(flow.db, other)
    jobs = await flow.db.mail_jobs.find({"meta.contact_id": "a"}, {"_id": 0}).to_list(10)
    assert len(jobs) == 2
    for job in jobs:
        await flow.db.email_logs.insert_one({"id": job["id"], "to": job["to"], "subject": job["subject"], "template_key": job["template_key"], "status": "sent", "created_at": days_ago(1)})

    assert (await ops_alerts.purge_old_logs(flow.db))["contact_messages"] == 1
    assert await flow.db.contact_messages.find_one({"id": "a"}) is None
    assert await flow.db.mail_jobs.count_documents({"meta.contact_id": "a"}) == 0
    leftovers = str(await flow.db.email_logs.find({}, {"_id": 0}).to_list(10)) + str(await flow.db.mail_jobs.find({}, {"_id": 0}).to_list(10))
    assert "Geheimes Thema" not in leftovers and "Teststraße" not in leftovers and "paula@example.test" not in leftovers
    assert await flow.db.mail_jobs.count_documents({"meta.contact_id": "b"}) == 2, "andere Anfragen bleiben unberührt"


@pytest.mark.asyncio
async def test_deleting_by_hand_also_takes_the_copies(flow):
    await flow.db.contact_messages.insert_one(message("a"))
    await flow.db.mail_jobs.insert_one({"id": "j", "to": "paula@example.test", "subject": "Betreff a", "template_key": "contact_autoreply", "meta": {"contact_id": "a"}})
    await flow.db.email_logs.insert_one({"id": "l", "to": "paula@example.test", "subject": "Betreff a", "template_key": "contact_autoreply"})
    flow.act_as(await club_person(flow))
    gone = await flow.delete("/api/contact/a")
    assert gone.status_code == 200
    assert await flow.db.mail_jobs.count_documents({}) == 0 and await flow.db.email_logs.count_documents({}) == 0


@pytest.mark.asyncio
async def test_status_clock_starts_on_every_change_and_reopening_stops_it(flow):
    await flow.db.contact_messages.insert_one(message("a", status="closed", status_changed_at=days_ago(300)))
    flow.act_as(await club_person(flow))
    reopened = (await flow.patch("/api/contact/a", json={"status": "in_progress"})).json()
    assert reopened["status_changed_at"] > days_ago(1)
    assert await contact_retention.purge_expired(flow.db, done_days=365, spam_days=30, now=NOW + timedelta(days=4000)) == 0, "wieder offen läuft nicht ab"
    closed = (await flow.patch("/api/contact/a", json={"status": "closed"})).json()
    assert closed["status_changed_at"] >= reopened["status_changed_at"]


# ---------------------------------------------------------------- Formular

BODY = {"name": "Nora Neu", "email": "nora@beispielverein.at", "subject": "Hallo Verein", "message": "Eine lange genug Nachricht", "accept_privacy": True}


@pytest.mark.asyncio
async def test_messages_are_german_and_the_structure_of_the_422_stays(flow):
    short = await flow.post("/api/contact/submit", json={**BODY, "message": "  ab  "})
    assert short.status_code == 422
    [error] = short.json()["detail"]
    assert error["msg"] == "Nachricht: mindestens 5 Zeichen."
    assert error["loc"] == ["body", "message"] and error["type"] == "value_error"
    assert (await flow.post("/api/contact/submit", json={**BODY, "name": " a "})).json()["detail"][0]["msg"] == "Name: mindestens 2 Zeichen."
    long_name = await flow.post("/api/contact/submit", json={**BODY, "name": "x" * 121})
    assert long_name.json()["detail"][0]["msg"] == "Name: höchstens 120 Zeichen." and long_name.json()["detail"][0]["type"] == "string_too_long"


@pytest.mark.asyncio
async def test_topics_include_invoice_and_the_form_accepts_it(flow):
    topics = {row["value"]: row["label"] for row in (await flow.get("/api/contact/topics")).json()}
    assert topics["invoice"] == "Rechnung" and topics["report_bug"] == "Fehler melden"


@pytest.mark.asyncio
async def test_context_is_kept_only_for_a_bug_report_and_cleaned(flow):
    doc = await _submit_direct(flow, topic="report_bug", context={"page": "/events/x\x07", "device": "Testgerät", "version": "1.53.0"})
    assert doc["context"] == {"page": "/events/x", "device": "Testgerät", "version": "1.53.0"}
    plain = await _submit_direct(flow, topic="general", context={"page": "/events/x"})
    assert "context" not in plain, "nur beim Fehler melden"
    assert (await flow.post("/api/contact/submit", json={**BODY, "accept_privacy": True, "context": {"page": "x" * 301}})).status_code == 422


async def _submit_direct(flow, **fields) -> dict:
    """Am Spamschutz vorbei: der hat eigene Tests (test_spam_guard_flow) - hier geht es nur um das, was gespeichert wird."""
    from fastapi import Request

    from routes import contact_board_routes
    from services import spam_guard

    class Clean:
        dropped = False
        suspect = False

    async def passes(*_args, **_kwargs):
        return Clean()

    original = spam_guard.screen
    spam_guard.screen = passes
    try:
        body = contact_board_routes.ContactSubmit(**BODY, **fields)
        request = Request({"type": "http", "headers": [], "client": ("127.0.0.1", 1), "method": "POST", "path": "/api/contact/submit"})
        result = await contact_board_routes.submit_contact(body, request, None)
    finally:
        spam_guard.screen = original
    return await flow.db.contact_messages.find_one({"id": result["id"]}, {"_id": 0})


# ---------------------------------------------------------------- Kontolöschung und Auskunft

@pytest.mark.asyncio
async def test_erasure_also_clears_replies_note_and_context_and_the_notice_to_the_club(flow):
    from services import account_erasure

    user = {"id": "u-weg", "email": "weg@example.test"}
    await flow.db.contact_messages.insert_one(message("a", user_id="u-weg", email="weg@example.test", internal_note="ruft zurück: 0664", replies=[{"text": "Hallo Paula", "at": days_ago(1), "by": "x"}],
                                                      context={"page": "/profil"}))
    await flow.db.mail_jobs.insert_one({"id": "j", "to": "vorstand@example.test", "subject": "x", "html": "Paula", "meta": {"contact_id": "a"}})
    await account_erasure._records(flow.db, user, NOW.isoformat(), NOW + timedelta(days=1000))
    row = await flow.db.contact_messages.find_one({"id": "a"}, {"_id": 0})
    assert row["replies"] == [] and row["internal_note"] == "" and row["context"] is None and row["email"] is None
    assert await flow.db.mail_jobs.count_documents({"meta.contact_id": "a"}) == 0
