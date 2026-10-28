"""Newsletter mit einem Klick abbestellen (#2119 ML4).

Bisher ging das nur nach dem Login in den Einstellungen. Gmail und Yahoo verlangen für Massenversand einen
Abmeldelink ohne Login und die Kopfzeilen `List-Unsubscribe` und `List-Unsubscribe-Post` (RFC 8058). Der Link trägt
einen signierten Schlüssel je Konto; ein GET (Linkvorschau, Virenscanner) ändert nichts, erst das POST meldet ab.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def reader(flow, name="leserin"):
    user = await flow.add_user(name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"newsletter_consent": True}})
    return user


@pytest.mark.asyncio
async def test_every_newsletter_mail_carries_a_one_click_link_and_the_headers(flow):
    from services.newsletter_unsubscribe import token_for
    from services.notification_preferences import enqueue_newsletter_for_item

    paula = await reader(flow)
    post = {"id": new_id(), "slug": "herbst-lan", "title": "Herbst-LAN", "visibility": "public", "published": True}
    result = await enqueue_newsletter_for_item("news", post)
    assert result["queued"] == 1
    job = await flow.db.mail_jobs.find_one({"to": paula["email"]}, {"_id": 0})
    token = token_for(paula["id"])
    assert job["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert job["headers"]["List-Unsubscribe"] == f"<https://lionsquad.at/api/settings/newsletter/unsubscribe?token={token}>"
    assert f"https://lionsquad.at/newsletter/abbestellen?token={token}" in job["html"]


@pytest.mark.asyncio
async def test_one_click_unsubscribes_without_login_and_only_with_a_valid_key(flow):
    from services.newsletter_unsubscribe import token_for

    paula = await reader(flow)
    max_ = await reader(flow, "max")
    token = token_for(paula["id"])

    # Ein Schlüssel für ein anderes Konto lässt sich nicht basteln.
    forged = token.split(".")[0].replace(paula["id"], max_["id"]) + "." + token.split(".")[1]
    refused = await flow.client.post(f"/api/settings/newsletter/unsubscribe?token={forged}")
    assert refused.status_code == 400 and "ungültig" in refused.json()["detail"]
    assert (await flow.client.post("/api/settings/newsletter/unsubscribe?token=kaputt")).status_code == 400

    # Wie Gmail: POST mit Formular „List-Unsubscribe=One-Click“, ohne Anmeldung.
    done = await flow.client.post(f"/api/settings/newsletter/unsubscribe?token={token}", content="List-Unsubscribe=One-Click",
                                  headers={"Content-Type": "application/x-www-form-urlencoded"})
    assert done.status_code == 200, done.text
    assert done.json() == {"ok": True, "already": False}
    stored = await flow.db.users.find_one({"id": paula["id"]}, {"_id": 0})
    assert stored["newsletter_consent"] is False
    assert (await flow.db.users.find_one({"id": max_["id"]}, {"_id": 0}))["newsletter_consent"] is True
    record = await flow.db.consent_records.find_one({"user_id": paula["id"], "consent_type": "newsletter"}, {"_id": 0})
    assert record["granted"] is False and record["source"] == "mail_unsubscribe"

    again = await flow.client.post(f"/api/settings/newsletter/unsubscribe?token={token}")
    assert again.json() == {"ok": True, "already": True}


@pytest.mark.asyncio
async def test_smtp_and_resend_send_the_headers(monkeypatch):
    from services import mail_queue

    sent = {}

    async def fake_send(message, **_kwargs):
        sent["smtp"] = message

    monkeypatch.setattr(mail_queue.aiosmtplib, "send", fake_send)
    cfg = {"smtp_auth": "none", "smtp_user": "", "smtp_pass": "", "smtp_envelope_from": "", "message_id_domain": "", "sender_email": "noreply@example.test",
           "sender_name": "Verein", "reply_to_email": "", "smtp_port": 25, "smtp_security": "none", "smtp_host": "mail.example.test", "smtp_tls_verify": False}
    headers = {"List-Unsubscribe": "<https://example.test/x>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "X-Evil": "nein"}
    await mail_queue._smtp_send(cfg, "paula@example.test", "Betreff", "<p>Hallo</p>", headers=headers)
    assert sent["smtp"]["List-Unsubscribe"] == "<https://example.test/x>"
    assert sent["smtp"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert sent["smtp"]["X-Evil"] is None, "nur die beiden Abmelde-Kopfzeilen gehen durch"

    def fake_resend(params):
        sent["resend"] = params
        return {"id": "r1"}

    monkeypatch.setattr(mail_queue.resend.Emails, "send", fake_resend)
    await mail_queue._resend_send({**cfg, "resend_api_key": "re_test"}, "paula@example.test", "Betreff", "<p>Hallo</p>", headers=headers)
    assert sent["resend"]["headers"]["List-Unsubscribe"] == "<https://example.test/x>"
    assert "X-Evil" not in sent["resend"]["headers"]


@pytest.mark.asyncio
async def test_the_queue_list_never_shows_the_personal_key(flow):
    from services.notification_preferences import enqueue_newsletter_for_item

    await reader(flow)
    await enqueue_newsletter_for_item("news", {"id": new_id(), "slug": "x", "title": "X", "visibility": "public", "published": True})
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    rows = (await flow.get("/api/settings/mail-queue")).json()
    assert rows and all("headers" not in row for row in rows)
    assert "token=" not in str(rows)
    stats = (await flow.get("/api/settings/mail-queue/stats")).json()
    assert "token=" not in str(stats)


@pytest.mark.asyncio
async def test_odd_keys_are_simply_invalid(flow):
    from services.newsletter_unsubscribe import token_for, user_id_from

    paula = await reader(flow)
    user_id = paula["id"]
    assert user_id_from(f"{user_id}.äöü") is None
    assert user_id_from(f"{user_id}.{token_for(user_id).split('.')[1]}ß") is None
    assert user_id_from("") is None and user_id_from(".") is None
    response = await flow.client.post("/api/settings/newsletter/unsubscribe", params={"token": f"{user_id}.äöü"})
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_two_clicks_at_once_withdraw_and_log_only_once(flow):
    import asyncio

    from services.newsletter_unsubscribe import token_for

    paula = await reader(flow)
    url = f"/api/settings/newsletter/unsubscribe?token={token_for(paula['id'])}"
    first, second = await asyncio.gather(flow.client.post(url), flow.client.post(url))
    assert sorted(response.json()["already"] for response in (first, second)) == [False, True]
    assert await flow.db.consent_records.count_documents({"user_id": paula["id"], "granted": False}) == 1
    assert await flow.db.audit_logs.count_documents({"action": "newsletter.unsubscribe"}) == 1


@pytest.mark.asyncio
async def test_only_invalid_attempts_are_limited(flow):
    from services.newsletter_unsubscribe import token_for

    paula = await reader(flow)
    for _ in range(30):
        assert (await flow.client.post("/api/settings/newsletter/unsubscribe?token=x.y")).status_code == 400
    assert (await flow.client.post("/api/settings/newsletter/unsubscribe?token=x.y")).status_code == 429
    # Ein gültiger Link geht trotzdem durch.
    valid = await flow.client.post(f"/api/settings/newsletter/unsubscribe?token={token_for(paula['id'])}")
    assert valid.status_code == 200 and valid.json()["already"] is False


def test_the_key_is_derived_and_masked_in_the_access_log(monkeypatch):
    import hashlib
    import hmac
    import logging

    from services import log_safe
    from services.newsletter_unsubscribe import _secret

    # Ein eigener Schlüssel nur für diese Links, abgeleitet - nie das Server-Geheimnis selbst.
    monkeypatch.setenv("JWT_SECRET", "ein-test-geheimnis-mit-mindestens-32-zeichen")
    assert _secret() == hmac.new(b"ein-test-geheimnis-mit-mindestens-32-zeichen", b"newsletter-unsubscribe-key-v1", hashlib.sha256).digest()
    assert _secret() != b"ein-test-geheimnis-mit-mindestens-32-zeichen"
    line = "POST /api/settings/newsletter/unsubscribe?token=u1.SIGNATUR HTTP/1.1"
    assert log_safe.redact_secret_paths(line) == "POST /api/settings/newsletter/unsubscribe?token=*** HTTP/1.1"
    assert log_safe.redact_secret_paths("GET /newsletter/abbestellen?x=1&token=u1.SIG&y=2") == "GET /newsletter/abbestellen?x=1&token=***&y=2"
    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d', ("127.0.0.1", "POST", "/api/settings/newsletter/unsubscribe?token=u1.SIG", "1.1", 200), None)
    log_safe.SecretPathFilter().filter(record)
    assert "u1.SIG" not in record.getMessage()