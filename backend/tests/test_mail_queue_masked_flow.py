"""Mail-Warteschlange (#1418): die Liste zeigt Empfänger nur gekürzt (``p***@gmail.com``) - ohne Klick steht keine ganze
Adresse in der Antwort, auch nicht in Betreff, Meldung des Mailservers oder Statistik. „Adresse zeigen“ gibt die ganze
Adresse einer Zeile nur dem Bereich System und schreibt das ins Protokoll; die Suche nach einer Adresse trifft die ganze
Adresse, zeigt aber gekürzt."""
import json
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services.mail_queue import masked_recipient  # noqa: E402

STAMP = "2026-10-08T08:00:00+00:00"
FULL = ("paula.beispiel@gmail.com", "max@lionsquad.example")


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _jobs(flow):
    await flow.db.mail_jobs.insert_many([
        {"id": "job-1", "to": FULL[0], "subject": "Hallo Paula", "html": "<p>an paula.beispiel@gmail.com</p>", "template_key": "password_reset",
         "status": "failed", "attempts": 5, "last_error": "550 5.1.1 <paula.beispiel@gmail.com> user unknown", "dedupe_key": "x:paula.beispiel@gmail.com",
         "meta": {"reply_to": "paula.beispiel@gmail.com"}, "next_attempt_at": STAMP, "created_at": STAMP, "updated_at": STAMP},
        {"id": "job-2", "to": FULL[1], "subject": "Newsletter", "html": "<p>x</p>", "template_key": "newsletter",
         "status": "pending", "attempts": 0, "last_error": None, "next_attempt_at": STAMP, "created_at": STAMP, "updated_at": STAMP},
    ])


def test_masked_recipient_keeps_first_letter_and_domain():
    assert masked_recipient("paula@gmail.com") == "p***@gmail.com"
    assert masked_recipient("m@x.at") == "m***@x.at"
    assert masked_recipient("keine-adresse") == "***"
    assert masked_recipient("") == "" and masked_recipient(None) == ""


@pytest.mark.asyncio
async def test_list_and_stats_never_carry_a_full_address(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="system"))
    await _jobs(flow)
    listed = await flow.get("/api/settings/mail-queue?limit=100")
    assert listed.status_code == 200, listed.text
    rows = {row["id"]: row for row in listed.json()}
    assert rows["job-1"]["to_masked"] == "p***@gmail.com"
    assert rows["job-2"]["to_masked"] == "m***@lionsquad.example"
    assert "to" not in rows["job-1"] and "dedupe_key" not in rows["job-1"] and "html" not in rows["job-1"]
    assert rows["job-1"]["last_error"] == "550 5.1.1 <p***@gmail.com> user unknown"
    stats = await flow.get("/api/settings/mail-queue/stats")
    assert stats.status_code == 200, stats.text
    for text in (listed.text, stats.text):
        for address in FULL:
            assert address not in text
    assert stats.json()["latest_problem"]["to_masked"] == "p***@gmail.com"


@pytest.mark.asyncio
async def test_reveal_gives_the_full_address_and_writes_the_audit_log(flow):
    system = await flow.add_user(role="club_admin", name="system")
    flow.act_as(system)
    await _jobs(flow)
    shown = await flow.post("/api/settings/mail-queue/job-1/recipient")
    assert shown.status_code == 200, shown.text
    assert shown.json() == {"id": "job-1", "to": FULL[0]}
    [entry] = await flow.db.audit_logs.find({"action": "mail_queue.recipient_revealed"}, {"_id": 0}).to_list(10)
    assert (entry["actor_id"], entry["target_id"]) == (system["id"], "job-1")
    assert FULL[0] not in json.dumps(entry), "das Protokoll nennt die Mail, nicht die Adresse"

    missing = await flow.post("/api/settings/mail-queue/job-weg/recipient")
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_reveal_and_list_only_for_the_system_area(flow):
    await _jobs(flow)
    for role, areas in (("tournament_admin", None), ("player", ["content", "club", "finance"]), ("moderator", None)):
        person = await flow.add_user(role=role)
        if areas:
            person["areas"] = areas
        flow.act_as(person)
        assert (await flow.post("/api/settings/mail-queue/job-1/recipient")).status_code == 403, role
        assert (await flow.get("/api/settings/mail-queue")).status_code == 403, role
    assert await flow.db.audit_logs.count_documents({"action": "mail_queue.recipient_revealed"}) == 0


@pytest.mark.asyncio
async def test_search_by_address_finds_the_mail_but_shows_it_masked(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="system"))
    await _jobs(flow)
    found = await flow.post("/api/settings/mail-queue/search", json={"q": "PAULA.beispiel@"})
    assert found.status_code == 200, found.text
    assert [row["id"] for row in found.json()] == ["job-1"]
    assert FULL[0] not in found.text
    # Regex-Zeichen gelten wörtlich.
    nothing = await flow.post("/api/settings/mail-queue/search", json={"q": ".*"})
    assert nothing.json() == []
    filtered = await flow.post("/api/settings/mail-queue/search", json={"q": "lionsquad", "status": "failed"})
    assert filtered.json() == []


# ---- Nach Codex-Prüfung: ein zentraler Redactor für jede Adressform, Drosselung, keine ungekürzte Versandliste mehr.

@pytest.mark.parametrize("text, expected", [
    ("a@x.test, bob@x.test", "a***@x.test, b***@x.test"),
    ("a@x.test,bob@x.test;cleo@y.test", "a***@x.test,b***@x.test;c***@y.test"),
    ('"Bob Beispiel" <bob@x.test>', '"Bob Beispiel" <b***@x.test>'),
    ("mailto:Bob.Smith+tag@Example.COM", "mailto:B***@Example.COM"),
    ("PAULA@GMAIL.COM", "P***@GMAIL.COM"),
    ("jürgen.müller@bücher.at", "j***@bücher.at"),
    ("550 5.1.1 <paula.beispiel@gmail.com>: user unknown", "550 5.1.1 <p***@gmail.com>: user unknown"),
    ("x" * 300 + "@lang.test", "x***@lang.test"),
    ("keine Adresse hier", "keine Adresse hier"),
])
def test_redactor_masks_every_address_form(text, expected):
    from services.log_safe import mask_addresses
    assert mask_addresses(text) == expected


def test_masked_recipient_with_several_addresses_and_deep_keys():
    from services.mail_queue import masked_job
    assert masked_recipient("a@x.test, bob@x.test") == "a***@x.test, b***@x.test"
    job = masked_job({"id": "j", "to": "a@x.test", "meta": {"bob@x.test": "ok", "list": ["cleo@y.test"]}})
    assert job["meta"] == {"b***@x.test": "ok", "list": ["c***@y.test"]}
    assert "bob@x.test" not in json.dumps(job) and "cleo@y.test" not in json.dumps(job)


@pytest.mark.asyncio
async def test_list_masks_several_recipients_and_meta_keys(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="system"))
    await flow.db.mail_jobs.insert_one({"id": "job-multi", "to": "anna@x.test, bob@x.test", "subject": "An Bob <bob@x.test>", "template_key": "custom",
                                        "status": "sent", "meta": {"bob@x.test": "zugestellt"}, "created_at": STAMP, "updated_at": STAMP})
    listed = await flow.get("/api/settings/mail-queue")
    assert listed.status_code == 200, listed.text
    assert "anna@x.test" not in listed.text and "bob@x.test" not in listed.text
    assert listed.json()[0]["to_masked"] == "a***@x.test, b***@x.test"


@pytest.mark.asyncio
async def test_reveal_is_rate_limited_per_person(flow, monkeypatch):
    import routes.settings_routes as settings_routes
    monkeypatch.setattr(settings_routes, "REVEAL_LIMIT", 2)
    flow.act_as(await flow.add_user(role="club_admin", name="system"))
    await _jobs(flow)
    for _ in range(2):
        assert (await flow.post("/api/settings/mail-queue/job-1/recipient")).status_code == 200
    blocked = await flow.post("/api/settings/mail-queue/job-1/recipient")
    assert blocked.status_code == 429, blocked.text
    assert await flow.db.audit_logs.count_documents({"action": "mail_queue.recipient_revealed"}) == 2, "gedrosselt vor dem Aufdecken"
    # Eine andere Person hat ihr eigenes Kontingent.
    flow.act_as(await flow.add_user(role="club_admin", name="system-2"))
    assert (await flow.post("/api/settings/mail-queue/job-1/recipient")).status_code == 200


@pytest.mark.asyncio
async def test_unmasked_email_log_list_is_gone(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="system"))
    await flow.db.email_logs.insert_one({"id": "l-1", "to": "paula@gmail.com", "subject": "Hallo", "status": "sent", "created_at": STAMP})
    response = await flow.get("/api/settings/email/logs")
    assert response.status_code in (404, 405)
    assert "paula@gmail.com" not in response.text
