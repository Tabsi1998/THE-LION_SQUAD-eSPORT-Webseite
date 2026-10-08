"""Fehler beim Mailversand landen im Protokoll ohne Mail-Adressen und in einer Zeile; die volle Meldung steht nur im
Eintrag der Warteschlange, den der Admin unter System sieht."""
import logging
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from flow_harness import make_flow  # noqa: E402
from services.log_safe import mask_addresses  # noqa: E402

ADDRESS = "paula.beispiel@example.test"
REFUSED = f"(550, b'5.1.1 <{ADDRESS}>: Recipient address rejected')\nZweite Zeile vom Server"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def logged(caplog, name: str) -> list[str]:
    return [record.getMessage() for record in caplog.records if record.name == name]


def test_addresses_are_shortened_to_first_letter_and_domain():
    masked = mask_addresses(f"An {ADDRESS} und an x@lionsquad.example - Kopie an <a.b+c@sub.example.test>")
    assert masked == "An p***@example.test und an x***@lionsquad.example - Kopie an <a***@sub.example.test>"
    assert mask_addresses(None) == "" and mask_addresses("kein Treffer @ hier") == "kein Treffer @ hier"


@pytest.mark.asyncio
async def test_a_refused_mail_is_logged_masked_on_one_line_and_kept_in_full_for_the_admin(flow, monkeypatch, caplog):
    from services import mail_queue

    async def settings():
        return {"enabled": True, "provider": "smtp"}

    async def refuse(_cfg, _to, _subject, _html):
        raise RuntimeError(REFUSED)

    monkeypatch.setattr(mail_queue, "get_mail_settings", settings)
    monkeypatch.setattr(mail_queue, "_dispatch", refuse)
    queued = await mail_queue.enqueue_mail(ADDRESS, "Hallo", "<p>x</p>")
    job = await flow.db.mail_jobs.find_one({"id": queued["id"]}, {"_id": 0})
    with caplog.at_level(logging.ERROR, logger="tls.mailqueue"):
        await mail_queue._try_send_job(job)
    lines = logged(caplog, "tls.mailqueue")
    assert len(lines) == 1 and "p***@example.test" in lines[0]
    assert ADDRESS not in lines[0] and "\n" not in lines[0] and "Zweite Zeile" in lines[0]
    stored = await flow.db.mail_jobs.find_one({"id": queued["id"]}, {"_id": 0})
    assert stored["status"] == "pending" and stored["last_error"] == REFUSED, "der Admin sieht die volle Meldung"

    # Letzter Versuch: auch der Alarm nennt die Adresse nur gekürzt (Discord bleibt hier aus).
    from services import ops_alerts

    async def no_discord(*_args, **_kwargs):
        return False

    monkeypatch.setattr(ops_alerts, "_send", no_discord)
    await flow.db.mail_jobs.update_one({"id": queued["id"]}, {"$set": {"attempts": mail_queue.MAX_ATTEMPTS - 1}})
    last = await flow.db.mail_jobs.find_one({"id": queued["id"]}, {"_id": 0})
    await mail_queue._try_send_job(last)
    alert = await flow.db.ops_alert_log.find_one({"kind": "mail_failed"}, {"_id": 0})
    assert alert and ADDRESS not in alert["description"] and "p***@example.test" in alert["description"]


@pytest.mark.asyncio
async def test_a_crashed_send_and_the_direct_path_log_no_address_either(flow, monkeypatch, caplog):
    import email_service
    import resend
    from services import mail_queue

    async def crash(_job):
        raise RuntimeError(REFUSED)

    monkeypatch.setattr(mail_queue, "_try_send_job", crash)
    await mail_queue.enqueue_mail(ADDRESS, "Hallo", "<p>x</p>")

    def refuse(_params):
        raise RuntimeError(REFUSED)

    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    monkeypatch.setattr(resend, "api_key", None)
    monkeypatch.setattr(resend.Emails, "send", refuse)
    with caplog.at_level(logging.ERROR):
        await mail_queue.process_mail_queue(batch=5)
        result = await email_service.send_mail(ADDRESS, "Hallo", "<p>x</p>")
    assert result["ok"] is False
    lines = logged(caplog, "tls.mailqueue") + logged(caplog, "tls-arena.email")
    assert len(lines) == 2 and all(ADDRESS not in line and "\n" not in line and "p***@example.test" in line for line in lines)
    assert not any(record.exc_info for record in caplog.records if record.name == "tls.mailqueue"), "kein Stacktrace mit der Adresse"
    stored = await flow.db.email_logs.find_one({"to": ADDRESS, "status": "failed"}, {"_id": 0})
    assert stored and ADDRESS in stored["error"], "das Versandprotokoll im Admin behält die volle Meldung"
