"""Spamschutz für öffentliche Formulare (#2067) mit echten Routen und einer Datenbank im Speicher.

Sicher Spam (Honeypot, Token fehlt, gefälscht, zu schnell, abgelaufen, falsches Formular) wird still verworfen: die
Antwort sieht aus wie ein Erfolg, gespeichert wird nur ein Zähler. Verdächtiger Inhalt landet in der Kontakt-Inbox als
„Spam“ ohne Mail; „kein Spam“ holt die Mail nach. Die App (ohne Token) bleibt bedienbar. Turnstile ist optional und
wird hier nur gegen einen nachgebauten Cloudflare-Endpunkt geprüft - nie gegen das Netz.
"""
import json
import logging
import pathlib
import sys
import time

import httpx
import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from spam_forms import form_fields  # noqa: E402
from services import spam_guard  # noqa: E402

BOT = {"name": "KuHHNCqrrWoOGwLSltUsNs", "email": "i.w.irir.o.f.a6.7@gmail.com", "topic": "general",
       "subject": "JTslVviyjzDQSoOqIpLRRSU", "message": "welHMCbnDXaAOykIMdahEVhy", "accept_privacy": True}
HUMAN = {"name": "Jürgen Müller-Lüdenscheidt", "email": "juergen@lionsquad-test.at", "topic": "tournament",
         "subject": "Turnier", "message": "Hallo, wann ist das nächste Turnier?", "accept_privacy": True}
SECRET_KEY = "0x4AAAAAAAgeheimerSchluessel-nie-zeigen"
SITE_KEY = "0x4AAAAAAAoeffentlicherKey"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "spam-guard-tests-secret-with-at-least-32-characters")
    monkeypatch.setenv("FRONTEND_URL", "https://lionsquad.at")
    instance, shutdown = make_flow()
    board_hints = []

    async def fake_notify_board(event, text, **_kwargs):
        board_hints.append(event)

    from services import discord_announcements

    monkeypatch.setattr(discord_announcements, "notify_board", fake_notify_board)
    instance.board_hints = board_hints
    await instance.db.settings.update_one({"id": "branding"}, {"$set": {"id": "branding", "contact_email": "vorstand@lionsquad-test.at",
                                                                        "domain": "https://lionsquad.at"}}, upsert=True)
    try:
        yield instance
    finally:
        spam_guard.TRANSPORT = None
        await shutdown()


async def contact(flow, body: dict, **fields):
    return await flow.post("/api/contact/submit", json={**body, **fields})


async def board_mails(flow) -> list[dict]:
    return await flow.db.mail_jobs.find({"to": "vorstand@lionsquad-test.at"}, {"_id": 0}).to_list(100)


async def caught(flow, reason: str) -> int:
    rows = await flow.db.spam_guard_stats.find({"reason": reason}, {"_id": 0}).to_list(100)
    return sum(row["count"] for row in rows)


# ---------------------------------------------------------------- Token holen


@pytest.mark.asyncio
async def test_form_token_endpoint(flow):
    response = await flow.get("/api/spam-guard/token", params={"form": "contact"})
    assert response.status_code == 200
    data = response.json()
    assert data["token"].startswith("contact.")
    assert data["honeypot"] == spam_guard.HONEYPOT_FIELD
    assert data["min_seconds"] == 3
    assert data["turnstile"] is None
    assert "no-store" in response.headers.get("cache-control", "")
    assert (await flow.get("/api/spam-guard/token", params={"form": "newsletter"})).status_code == 422


# ---------------------------------------------------------------- Kontakt: echte Menschen


@pytest.mark.asyncio
async def test_real_person_gets_through_with_mails(flow):
    response = await contact(flow, HUMAN, **form_fields("contact"))
    assert response.status_code == 200, response.text
    stored = await flow.db.contact_messages.find_one({"id": response.json()["id"]}, {"_id": 0})
    assert stored["status"] == "new" and "spam" not in stored
    assert len(await board_mails(flow)) == 1
    assert await flow.db.mail_jobs.count_documents({"to": HUMAN["email"]}) == 1
    assert flow.board_hints == ["contact.request"]


# ---------------------------------------------------------------- Kontakt: Token fehlt


@pytest.mark.asyncio
async def test_missing_token_is_kept_as_suspect_not_dropped(flow):
    """Etwa ein Tab mit dem Frontend von vor einem Deploy: die Nachricht geht nie verloren, sie landet als „Spam“
    in der Inbox - ohne Mails - und „kein Spam“ holt sie ein."""
    response = await contact(flow, HUMAN)
    assert response.status_code == 200
    stored = await flow.db.contact_messages.find_one({"id": response.json()["id"]}, {"_id": 0})
    assert stored["status"] == "spam" and stored["spam"]["reasons"][0] == "token_missing"
    assert stored["message"] == HUMAN["message"]
    assert await flow.db.mail_jobs.count_documents({}) == 0 and flow.board_hints == []
    flow.act_as(await flow.add_staff())
    assert (await flow.post(f"/api/contact/{stored['id']}/not-spam")).status_code == 200
    assert len(await board_mails(flow)) == 1


@pytest.mark.asyncio
async def test_missing_token_with_honeypot_is_still_dropped(flow):
    response = await contact(flow, HUMAN, **{spam_guard.HONEYPOT_FIELD: "x"})
    assert response.status_code == 200
    assert await flow.db.contact_messages.count_documents({}) == 0


# ---------------------------------------------------------------- Kontakt: sicher Spam


@pytest.mark.parametrize("case,reason", [
    ("honeypot", "honeypot"),
    ("forged", "token_forged"),
    ("too_fast", "token_too_fast"),
    ("expired", "token_expired"),
    ("other_form", "token_wrong_form"),
])
@pytest.mark.asyncio
async def test_sure_spam_is_dropped_silently(flow, case, reason):
    fields = form_fields("contact")
    if case == "honeypot":
        fields[spam_guard.HONEYPOT_FIELD] = "+43 512 123456"
    elif case == "forged":
        fields[spam_guard.TOKEN_FIELD] = fields[spam_guard.TOKEN_FIELD][:-3] + "abc"
    elif case == "too_fast":
        fields[spam_guard.TOKEN_FIELD] = spam_guard.issue_token("contact")
    elif case == "expired":
        fields[spam_guard.TOKEN_FIELD] = spam_guard.issue_token("contact", now=time.time() - 3 * 3600)
    else:
        fields[spam_guard.TOKEN_FIELD] = spam_guard.issue_token("register", now=time.time() - 30)
    response = await contact(flow, HUMAN, **fields)
    assert response.status_code == 200
    assert response.json()["ok"] is True and response.json()["id"]
    assert await flow.db.contact_messages.count_documents({}) == 0
    assert await flow.db.mail_jobs.count_documents({}) == 0
    assert flow.board_hints == []
    assert await caught(flow, reason) == 1
    # Nur ein Zähler: kein Name, keine Adresse, kein Text, keine IP.
    blob = json.dumps(await flow.db.spam_guard_stats.find({}, {"_id": 0}).to_list(10), default=str)
    for secret in ("Jürgen", "juergen", "Turnier", "127.0.0.1"):
        assert secret not in blob


@pytest.mark.asyncio
async def test_token_cannot_be_used_endlessly(flow):
    await flow.db.settings.update_one({"id": spam_guard.SETTINGS_ID}, {"$set": {"id": spam_guard.SETTINGS_ID, "limits": {
        "contact": {"ip_limit": 100, "ip_window_minutes": 15, "email_limit": 5, "email_window_minutes": 60}}}}, upsert=True)
    fields = form_fields("contact")
    config = spam_guard.defaults()
    for index in range(config["token_max_uses"]):
        await contact(flow, {**HUMAN, "email": f"p{index}@lionsquad-test.at"}, **fields)
    assert await flow.db.contact_messages.count_documents({"status": "new"}) == config["token_max_uses"]
    # Ein gültiges, nur aufgebrauchtes Token gilt wie ein fehlendes: Verdacht, nicht verworfen (Codex-Befund).
    response = await contact(flow, {**HUMAN, "email": "noch@lionsquad-test.at"}, **fields)
    stored = await flow.db.contact_messages.find_one({"id": response.json()["id"]}, {"_id": 0})
    assert stored["status"] == "spam" and stored["spam"]["reasons"][0] == "token_reused"
    assert await caught(flow, "token_reused") == 1


@pytest.mark.asyncio
async def test_used_up_token_at_registration_asks_to_reload(flow):
    await flow.db.settings.update_one({"id": spam_guard.SETTINGS_ID}, {"$set": {"id": spam_guard.SETTINGS_ID, "token_max_uses": 2}}, upsert=True)
    fields = form_fields("register")
    for index in range(2):
        body = {**REGISTRATION, "username": f"spieler{index}", "email": f"spieler{index}@lionsquad-test.at", **fields}
        assert (await flow.post("/api/auth/register", json=body)).status_code == 200
    again = await flow.post("/api/auth/register", json={**REGISTRATION, **fields})
    assert again.status_code == 400 and again.json()["detail"] == spam_guard.STALE_PAGE


# ---------------------------------------------------------------- Kontakt: verdächtiger Inhalt


@pytest.mark.asyncio
async def test_bot_text_lands_as_spam_without_mail(flow):
    response = await contact(flow, BOT, **form_fields("contact"))
    assert response.status_code == 200
    stored = await flow.db.contact_messages.find_one({"id": response.json()["id"]}, {"_id": 0})
    assert stored["status"] == "spam"
    assert "random_text" in stored["spam"]["reasons"]
    assert await flow.db.mail_jobs.count_documents({}) == 0
    assert flow.board_hints == []


@pytest.mark.asyncio
async def test_second_real_bot_sample(flow):
    body = {**BOT, "name": "wBHeAZnwWoXYMRRGjJZrpspl", "subject": "nTXHBYWEppRvQjssDrRyWaT", "message": "KpKDzELIGCspLEZGffS",
            "email": "someone@example.com"}
    response = await contact(flow, body, **form_fields("contact"))
    stored = await flow.db.contact_messages.find_one({"id": response.json()["id"]}, {"_id": 0})
    assert stored["status"] == "spam"


@pytest.mark.asyncio
async def test_not_spam_files_it_and_sends_the_mails(flow):
    response = await contact(flow, BOT, **form_fields("contact"))
    cid = response.json()["id"]
    flow.act_as(None)
    assert (await flow.post(f"/api/contact/{cid}/not-spam")).status_code == 401
    flow.act_as(await flow.add_staff())
    cleared = await flow.post(f"/api/contact/{cid}/not-spam")
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["status"] == "new"
    assert cleared.json()["spam"]["cleared_by"]
    assert len(await board_mails(flow)) == 1
    assert await flow.db.mail_jobs.count_documents({"to": BOT["email"]}) == 1
    assert flow.board_hints == ["contact.request"]
    # Ein zweites „kein Spam“ verschickt nichts doppelt.
    assert (await flow.post(f"/api/contact/{cid}/not-spam")).status_code == 409
    assert len(await board_mails(flow)) == 1


# ---------------------------------------------------------------- Limits


@pytest.mark.asyncio
async def test_limit_per_ip(flow):
    for index in range(5):
        response = await contact(flow, {**HUMAN, "email": f"p{index}@lionsquad-test.at"}, **form_fields("contact"))
        assert response.status_code == 200
    blocked = await contact(flow, {**HUMAN, "email": "p9@lionsquad-test.at"}, **form_fields("contact"))
    assert blocked.status_code == 429
    assert await caught(flow, "ip") == 1
    # Gezählt wird unter einem Hash, nie unter der IP.
    rows = await flow.db.rate_limits.find({"bucket": "contact:submit:ip"}, {"_id": 0}).to_list(10)
    assert rows and all("127.0.0.1" not in json.dumps(row, default=str) for row in rows)


@pytest.mark.asyncio
async def test_limit_per_email(flow):
    await flow.db.settings.update_one({"id": spam_guard.SETTINGS_ID}, {"$set": {"id": spam_guard.SETTINGS_ID, "limits": {
        "contact": {"ip_limit": 100, "ip_window_minutes": 15, "email_limit": 2, "email_window_minutes": 60}}}}, upsert=True)
    for _ in range(2):
        assert (await contact(flow, HUMAN, **form_fields("contact"))).status_code == 200
    assert (await contact(flow, {**HUMAN, "email": HUMAN["email"].upper()}, **form_fields("contact"))).status_code == 429
    assert (await contact(flow, {**HUMAN, "email": "andere@lionsquad-test.at"}, **form_fields("contact"))).status_code == 200
    assert await caught(flow, "email") == 1


@pytest.mark.asyncio
async def test_switched_off_only_keeps_the_limits(flow):
    await flow.db.settings.update_one({"id": spam_guard.SETTINGS_ID}, {"$set": {"id": spam_guard.SETTINGS_ID, "enabled": False}}, upsert=True)
    response = await contact(flow, BOT)
    stored = await flow.db.contact_messages.find_one({"id": response.json()["id"]}, {"_id": 0})
    assert stored["status"] == "new"


# ---------------------------------------------------------------- Registrierung, Website und App

REGISTRATION = {"username": "neonfalke", "email": "neonfalke@lionsquad-test.at", "password": "Passwort-123!",
                "accept_privacy": True, "accept_terms": True}


@pytest.mark.asyncio
async def test_web_registration_needs_the_token(flow):
    # Fehlt das Token (alte Seite, z. B. offen über einen Deploy), sagt das die Antwort - kein stiller Abbruch.
    refused = await flow.post("/api/auth/register", json=REGISTRATION)
    assert refused.status_code == 400
    assert refused.json()["detail"] == spam_guard.STALE_PAGE
    assert await flow.db.users.count_documents({"email": REGISTRATION["email"]}) == 0
    assert await flow.db.mail_jobs.count_documents({}) == 0
    created = await flow.post("/api/auth/register", json={**REGISTRATION, **form_fields("register")})
    assert created.status_code == 200, created.text
    assert await flow.db.users.count_documents({"email": REGISTRATION["email"]}) == 1


@pytest.mark.asyncio
async def test_web_registration_with_expired_token_asks_to_reload(flow):
    expired = {**form_fields("register"), spam_guard.TOKEN_FIELD: spam_guard.issue_token("register", now=time.time() - 3 * 3600)}
    response = await flow.post("/api/auth/register", json={**REGISTRATION, **expired})
    assert response.status_code == 400
    assert response.json()["detail"] == "Die Seite war zu lange offen – bitte neu laden und noch einmal absenden."
    assert await flow.db.users.count_documents({}) == 0


@pytest.mark.asyncio
async def test_web_registration_with_forged_token_is_dropped_silently(flow):
    fields = form_fields("register")
    fields[spam_guard.TOKEN_FIELD] = fields[spam_guard.TOKEN_FIELD][:-3] + "abc"
    response = await flow.post("/api/auth/register", json={**REGISTRATION, **fields})
    assert response.status_code == 200
    assert response.json() == {"verification_required": True, "email": REGISTRATION["email"]}
    assert await flow.db.users.count_documents({}) == 0


@pytest.mark.asyncio
async def test_web_registration_with_honeypot_is_dropped(flow):
    fields = {**form_fields("register"), spam_guard.HONEYPOT_FIELD: "x"}
    response = await flow.post("/api/auth/register", json={**REGISTRATION, **fields})
    assert response.status_code == 200
    assert await flow.db.users.count_documents({}) == 0


@pytest.mark.asyncio
async def test_app_registration_works_without_token(flow):
    response = await flow.post("/api/auth/mobile/register", json=REGISTRATION)
    assert response.status_code == 200, response.text
    assert await flow.db.users.count_documents({"email": REGISTRATION["email"]}) == 1


@pytest.mark.asyncio
async def test_app_registration_still_checks_a_sent_honeypot(flow):
    response = await flow.post("/api/auth/mobile/register", json={**REGISTRATION, spam_guard.HONEYPOT_FIELD: "bot"})
    assert response.status_code == 200
    assert await flow.db.users.count_documents({}) == 0


@pytest.mark.asyncio
async def test_random_username_is_accepted_but_counted(flow):
    body = {**REGISTRATION, "username": "KuHHNCqrrWoOGwLSltUsNs", **form_fields("register")}
    assert (await flow.post("/api/auth/register", json=body)).status_code == 200
    assert await flow.db.users.count_documents({"username": "KuHHNCqrrWoOGwLSltUsNs"}) == 1
    rows = await flow.db.spam_guard_stats.find({"form": "register", "outcome": "suspect"}, {"_id": 0}).to_list(10)
    assert rows and rows[0]["reason"] == "random_text"


# ---------------------------------------------------------------- Passwort vergessen, Bestätigung erneut senden


async def member(flow) -> dict:
    user = await flow.add_user()
    user["email"] = f"{user['username']}@lionsquad-test.at"
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"email": user["email"]}})
    return user


@pytest.mark.asyncio
async def test_forgot_password_from_the_app_works_without_token(flow):
    user = await member(flow)
    response = await flow.post("/api/auth/forgot-password", json={"email": user["email"]})
    assert response.status_code == 200
    assert await flow.db.password_reset_tokens.count_documents({"user_id": user["id"]}) == 1


@pytest.mark.asyncio
async def test_forgot_password_with_honeypot_sends_nothing(flow):
    user = await member(flow)
    response = await flow.post("/api/auth/forgot-password", json={"email": user["email"], spam_guard.HONEYPOT_FIELD: "x"})
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert await flow.db.password_reset_tokens.count_documents({}) == 0


@pytest.mark.asyncio
async def test_forgot_password_with_forged_token_sends_nothing(flow):
    user = await member(flow)
    fields = form_fields("forgot_password")
    fields[spam_guard.TOKEN_FIELD] = spam_guard.issue_token("contact", now=time.time() - 30)
    response = await flow.post("/api/auth/forgot-password", json={"email": user["email"], **fields})
    assert response.status_code == 200
    assert await flow.db.password_reset_tokens.count_documents({}) == 0


@pytest.mark.asyncio
async def test_resend_verification_with_honeypot_sends_nothing(flow):
    await flow.post("/api/auth/mobile/register", json=REGISTRATION)
    before = await flow.db.mail_jobs.count_documents({})
    response = await flow.post("/api/auth/resend-verification", json={"email": REGISTRATION["email"], spam_guard.HONEYPOT_FIELD: "x"})
    assert response.status_code == 200
    assert await flow.db.mail_jobs.count_documents({}) == before


@pytest.mark.asyncio
async def test_forgot_password_limit_per_email(flow):
    user = await member(flow)
    for _ in range(5):
        assert (await flow.post("/api/auth/forgot-password", json={"email": user["email"]})).status_code == 200
    assert (await flow.post("/api/auth/forgot-password", json={"email": user["email"]})).status_code == 429


# ---------------------------------------------------------------- Verwaltung: Zähler, Einstellungen, Protokoll


@pytest.mark.asyncio
async def test_inbox_counter_with_reasons(flow):
    await contact(flow, HUMAN, **{**form_fields("contact"), spam_guard.HONEYPOT_FIELD: "x"})
    await contact(flow, HUMAN)
    await contact(flow, BOT, **form_fields("contact"))
    await contact(flow, HUMAN, **form_fields("contact"))
    flow.act_as(None)
    assert (await flow.get("/api/spam-guard/stats")).status_code == 401
    flow.act_as(await flow.add_staff())
    stats = (await flow.get("/api/spam-guard/stats")).json()
    assert stats["today"]["caught"] == 3 and stats["week"]["caught"] == 3
    assert stats["today"]["by_reason"] == {"honeypot": 1, "token_missing": 1, "random_text": 1}
    assert stats["today"]["accepted"] == 1
    assert stats["quote_week"] == 75.0
    assert stats["labels"]["honeypot"]


@pytest.mark.asyncio
async def test_settings_need_superadmin_and_a_reason(flow):
    flow.act_as(await flow.add_user(role="club_admin"))
    assert (await flow.get("/api/spam-guard/settings")).status_code == 403
    flow.act_as(await flow.add_staff())
    view = (await flow.get("/api/spam-guard/settings")).json()
    assert view["config"]["min_seconds"] == 3
    no_reason = await flow.put("/api/spam-guard/settings", json={"changes": {"min_seconds": 5}, "reason": ""})
    assert no_reason.status_code == 400
    out_of_range = await flow.put("/api/spam-guard/settings", json={"changes": {"min_seconds": 999}, "reason": "Test"})
    assert out_of_range.status_code == 400
    saved = await flow.put("/api/spam-guard/settings", json={"changes": {"min_seconds": 5}, "reason": "Bots werden schneller"})
    assert saved.status_code == 200, saved.text
    assert saved.json()["config"]["min_seconds"] == 5
    entry = await flow.db.audit_logs.find_one({"action": "spam_guard.settings"}, {"_id": 0})
    assert entry["data"]["before"] == {"min_seconds": 3} and entry["data"]["after"] == {"min_seconds": 5}
    assert entry["data"]["reason"] == "Bots werden schneller"


@pytest.mark.asyncio
async def test_ops_check_shows_quote_and_peaks(flow):
    from services import ops_checks

    assert "spam_guard" in {key for key, _label, _run in ops_checks.default_checks(flow.db)}
    quiet = await ops_checks.check_spam_guard(flow.db)
    assert quiet["status"] == "ok"
    for _ in range(31):
        await spam_guard.record(flow.db, "contact", "dropped", "honeypot")
    loud = await ops_checks.check_spam_guard(flow.db)
    assert loud["status"] == "warn"
    assert "31" in loud["detail"]


# ---------------------------------------------------------------- Turnstile (optional, Vorgabe aus)


def cloudflare(answer: dict | None = None, *, fail: bool = False, seen: list | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == spam_guard.SITEVERIFY_URL
        if seen is not None:
            seen.append(request.content.decode())
        if fail:
            raise httpx.ConnectError("unreachable", request=request)
        return httpx.Response(200, json=answer)
    return httpx.MockTransport(handler)


async def enable_turnstile(flow, *, mode: str = "always") -> None:
    flow.act_as(await flow.add_staff())
    assert (await flow.put("/api/spam-guard/turnstile/secret", json={"secret": SECRET_KEY, "reason": "Turnstile testen"})).status_code == 200
    saved = await flow.put("/api/spam-guard/turnstile", json={"enabled": True, "site_key": SITE_KEY, "mode": mode, "reason": "Turnstile testen"})
    assert saved.status_code == 200, saved.text
    flow.act_as(None)


GOOD = {"success": True, "hostname": "lionsquad.at", "action": "contact"}


@pytest.mark.asyncio
async def test_turnstile_off_changes_nothing(flow):
    seen = []
    spam_guard.TRANSPORT = cloudflare(GOOD, seen=seen)
    response = await contact(flow, HUMAN, **form_fields("contact"))
    assert (await flow.db.contact_messages.find_one({"id": response.json()["id"]}))["status"] == "new"
    assert seen == []


@pytest.mark.asyncio
async def test_turnstile_token_endpoint_tells_the_form(flow):
    await enable_turnstile(flow)
    data = (await flow.get("/api/spam-guard/token", params={"form": "contact"})).json()
    assert data["turnstile"] == {"site_key": SITE_KEY, "mode": "always", "action": "contact"}
    assert (await flow.get("/api/spam-guard/token", params={"form": "forgot_password"})).json()["turnstile"] is None


@pytest.mark.asyncio
async def test_turnstile_valid(flow):
    await enable_turnstile(flow)
    seen = []
    spam_guard.TRANSPORT = cloudflare(GOOD, seen=seen)
    response = await contact(flow, HUMAN, **form_fields("contact"), turnstile_token="cf-token")
    assert (await flow.db.contact_messages.find_one({"id": response.json()["id"]}))["status"] == "new"
    assert len(seen) == 1 and "remoteip" not in seen[0]


@pytest.mark.parametrize("answer", [
    {"success": False, "error-codes": ["invalid-input-response"]},
    {"success": True, "hostname": "evil.example", "action": "contact"},
    {"success": True, "hostname": "lionsquad.at", "action": "register"},
], ids=["rejected", "wrong_hostname", "wrong_action"])
@pytest.mark.asyncio
async def test_turnstile_invalid_is_dropped(flow, answer):
    await enable_turnstile(flow)
    spam_guard.TRANSPORT = cloudflare(answer)
    response = await contact(flow, HUMAN, **form_fields("contact"), turnstile_token="cf-token")
    assert response.status_code == 200 and response.json()["ok"] is True
    assert await flow.db.contact_messages.count_documents({}) == 0
    assert await caught(flow, "turnstile_invalid") == 1


@pytest.mark.asyncio
async def test_turnstile_unreachable_falls_back(flow, caplog):
    await enable_turnstile(flow)
    spam_guard.TRANSPORT = cloudflare(fail=True)
    with caplog.at_level(logging.DEBUG):
        response = await contact(flow, HUMAN, **form_fields("contact"), turnstile_token="cf-token")
    assert (await flow.db.contact_messages.find_one({"id": response.json()["id"]}))["status"] == "new"
    assert SECRET_KEY not in caplog.text
    from services import ops_checks

    check = await ops_checks.check_spam_guard(flow.db)
    assert check["status"] == "warn" and "Turnstile" in check["detail"]


@pytest.mark.asyncio
async def test_turnstile_missing_marks_as_suspect(flow):
    await enable_turnstile(flow)
    spam_guard.TRANSPORT = cloudflare(GOOD)
    response = await contact(flow, HUMAN, **form_fields("contact"))
    stored = await flow.db.contact_messages.find_one({"id": response.json()["id"]}, {"_id": 0})
    assert stored["status"] == "spam" and stored["spam"]["reasons"] == ["turnstile_missing"]
    assert await flow.db.mail_jobs.count_documents({}) == 0


@pytest.mark.asyncio
async def test_turnstile_only_on_suspicion(flow):
    await enable_turnstile(flow, mode="suspect")
    # Ohne Zufallsanteil, sonst wäre der Test vom Zufall abhängig (der Anteil hat einen eigenen Test).
    await flow.db.settings.update_one({"id": spam_guard.SETTINGS_ID}, {"$set": {"turnstile.sample_percent": 0}})
    seen = []
    spam_guard.TRANSPORT = cloudflare(GOOD, seen=seen)
    human = await contact(flow, HUMAN, **form_fields("contact"))
    assert (await flow.db.contact_messages.find_one({"id": human.json()["id"]}))["status"] == "new"
    assert seen == []
    fields = form_fields("contact")
    challenged = await contact(flow, BOT, **fields)
    assert challenged.status_code == 428
    assert challenged.json()["detail"]["code"] == "turnstile_required"
    assert challenged.json()["detail"]["turnstile"]["site_key"] == SITE_KEY
    solved = await contact(flow, BOT, **fields, turnstile_token="cf-token")
    assert solved.status_code == 200
    assert (await flow.db.contact_messages.find_one({"id": solved.json()["id"]}))["status"] == "new"


@pytest.mark.asyncio
async def test_turnstile_secret_never_leaves(flow, caplog):
    staff = await flow.add_staff()
    flow.act_as(staff)
    with caplog.at_level(logging.DEBUG):
        await flow.put("/api/spam-guard/turnstile/secret", json={"secret": SECRET_KEY, "reason": "einrichten"})
        await flow.put("/api/spam-guard/turnstile", json={"enabled": True, "site_key": SITE_KEY, "reason": "einrichten"})
        spam_guard.TRANSPORT = cloudflare({"success": False, "error-codes": ["invalid-input-response"]})
        tested = await flow.post("/api/spam-guard/turnstile/test")
        view = await flow.get("/api/spam-guard/settings")
        flow.act_as(None)
        token = await flow.get("/api/spam-guard/token", params={"form": "contact"})
    assert tested.json()["ok"] is True
    for response in (tested, view, token):
        assert SECRET_KEY not in response.text
    assert view.json()["turnstile"]["secret"]["state"] == "ok"
    stored = await flow.db.settings.find_one({"id": spam_guard.SETTINGS_ID})
    assert SECRET_KEY not in json.dumps(stored, default=str)
    assert SECRET_KEY not in json.dumps(await flow.db.audit_logs.find({}, {"_id": 0}).to_list(20), default=str)
    assert SECRET_KEY not in caplog.text


@pytest.mark.asyncio
async def test_turnstile_cannot_be_enabled_without_keys(flow):
    flow.act_as(await flow.add_staff())
    response = await flow.put("/api/spam-guard/turnstile", json={"enabled": True, "site_key": SITE_KEY, "reason": "einschalten"})
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_turnstile_test_reports_a_rejected_secret(flow):
    flow.act_as(await flow.add_staff())
    await flow.put("/api/spam-guard/turnstile/secret", json={"secret": SECRET_KEY, "reason": "einrichten"})
    await flow.put("/api/spam-guard/turnstile", json={"site_key": SITE_KEY, "reason": "einrichten"})
    spam_guard.TRANSPORT = cloudflare({"success": False, "error-codes": ["invalid-input-secret"]})
    assert (await flow.post("/api/spam-guard/turnstile/test")).json()["ok"] is False
    spam_guard.TRANSPORT = cloudflare(fail=True)
    result = (await flow.post("/api/spam-guard/turnstile/test")).json()
    assert result["ok"] is False and "nicht erreichbar" in result["detail"]


@pytest.mark.asyncio
async def test_app_registration_never_sees_turnstile(flow):
    await enable_turnstile(flow)
    seen = []
    spam_guard.TRANSPORT = cloudflare(GOOD, seen=seen)
    response = await flow.post("/api/auth/mobile/register", json=REGISTRATION)
    assert response.status_code == 200
    assert await flow.db.users.count_documents({"email": REGISTRATION["email"]}) == 1
    assert seen == []


# ---------------------------------------------------------------- Codex-Befunde (#2067)


@pytest.mark.asyncio
async def test_dotted_gmail_with_links_is_no_spam(flow):
    body = {**HUMAN, "email": "anna.maria.lisa.huber@gmail.com",
            "message": "Hallo! Unsere Seiten: https://a.example https://b.example https://c.example - meldet euch gern."}
    response = await contact(flow, body, **form_fields("contact"))
    stored = await flow.db.contact_messages.find_one({"id": response.json()["id"]}, {"_id": 0})
    assert stored["status"] == "new"
    assert len(await board_mails(flow)) == 1


@pytest.mark.asyncio
async def test_daily_digest_names_only_the_count(flow):
    assert await spam_guard.queue_spam_digest(flow.db) == {"queued": False, "count": 0}
    await contact(flow, BOT, **form_fields("contact"))
    await contact(flow, {**BOT, "email": "x.y.z.w@gmail.com"}, **form_fields("contact"))
    result = await spam_guard.queue_spam_digest(flow.db)
    assert result == {"queued": True, "count": 2}
    jobs = await board_mails(flow)
    assert len(jobs) == 1 and jobs[0]["template_key"] == "spam_digest"
    assert "2 Nachrichten" in jobs[0]["subject"] and "/admin/contact" in jobs[0]["html"]
    for secret in (BOT["name"], BOT["subject"], BOT["message"], BOT["email"]):
        assert secret not in jobs[0]["html"] and secret not in jobs[0]["subject"]
    # Einmal am Tag: ein zweiter Lauf verschickt nichts doppelt.
    await spam_guard.queue_spam_digest(flow.db)
    assert len(await board_mails(flow)) == 1


@pytest.mark.asyncio
async def test_scheduler_job_queues_the_digest(flow):
    from services import scheduler

    await scheduler._safe_spam_digest()
    assert await board_mails(flow) == []
    await contact(flow, BOT, **form_fields("contact"))
    await scheduler._safe_spam_digest()
    jobs = await board_mails(flow)
    assert [job["template_key"] for job in jobs] == ["spam_digest"]


@pytest.mark.asyncio
async def test_app_registration_has_its_own_ip_limit(flow):
    for index in range(3):
        body = {**REGISTRATION, "username": f"appspieler{index}", "email": f"app{index}@lionsquad-test.at"}
        assert (await flow.post("/api/auth/mobile/register", json=body)).status_code == 200
    blocked = await flow.post("/api/auth/mobile/register", json={**REGISTRATION, "username": "appspieler9", "email": "app9@lionsquad-test.at"})
    assert blocked.status_code == 429
    assert await caught(flow, "app_ip") == 1


@pytest.mark.asyncio
async def test_app_registration_has_a_global_limit(flow, monkeypatch):
    await flow.db.settings.update_one({"id": spam_guard.SETTINGS_ID}, {"$set": {"id": spam_guard.SETTINGS_ID, "app_register_ip_per_hour": 100,
                                                                              "app_register_global_per_hour": 2}}, upsert=True)
    from services import rate_limit

    import itertools

    # Jede Anfrage aus einem anderen Netz: nur das globale Limit kann greifen.
    counter = itertools.count(1)
    monkeypatch.setattr(rate_limit, "get_client_ip", lambda _request: f"10.0.{next(counter)}.1")
    for index in range(2):
        body = {**REGISTRATION, "username": f"appspieler{index}", "email": f"app{index}@lionsquad-test.at"}
        assert (await flow.post("/api/auth/mobile/register", json=body)).status_code == 200
    blocked = await flow.post("/api/auth/mobile/register", json={**REGISTRATION, "username": "appspieler9", "email": "app9@lionsquad-test.at"})
    assert blocked.status_code == 429
    assert await caught(flow, "app_global") == 1
    from services import ops_checks

    check = await ops_checks.check_spam_guard(flow.db)
    assert check["status"] == "warn" and "App-Registrierungen" in check["detail"]


@pytest.mark.asyncio
async def test_suspect_mode_also_asks_a_random_share(flow):
    await enable_turnstile(flow, mode="suspect")
    spam_guard.TRANSPORT = cloudflare(GOOD)
    await flow.db.settings.update_one({"id": spam_guard.SETTINGS_ID}, {"$set": {"turnstile.sample_percent": 100}})
    asked = await contact(flow, HUMAN, **form_fields("contact"))
    assert asked.status_code == 428
    await flow.db.settings.update_one({"id": spam_guard.SETTINGS_ID}, {"$set": {"turnstile.sample_percent": 0}})
    assert (await contact(flow, HUMAN, **form_fields("contact"))).status_code == 200


@pytest.mark.asyncio
async def test_sample_percent_is_set_with_reason(flow):
    flow.act_as(await flow.add_staff())
    assert (await flow.put("/api/spam-guard/turnstile", json={"sample_percent": 101, "reason": "mehr prüfen"})).status_code == 400
    saved = await flow.put("/api/spam-guard/turnstile", json={"sample_percent": 25, "reason": "mehr prüfen"})
    assert saved.status_code == 200 and saved.json()["turnstile"]["sample_percent"] == 25


@pytest.mark.asyncio
async def test_not_spam_can_be_retried_after_a_crash(flow, monkeypatch):
    response = await contact(flow, BOT, **form_fields("contact"))
    cid = response.json()["id"]
    flow.act_as(await flow.add_staff())
    from services import mail_outbox

    real = mail_outbox.enqueue_mail
    calls = {"n": 0}

    async def crash_after_first(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("Absturz zwischen den Mails")
        return await real(*args, **kwargs)

    monkeypatch.setattr(mail_outbox, "enqueue_mail", crash_after_first)
    with pytest.raises(RuntimeError):
        await flow.post(f"/api/contact/{cid}/not-spam")
    stored = await flow.db.contact_messages.find_one({"id": cid}, {"_id": 0})
    assert stored["status"] == "spam" and stored["spam"]["release"]["state"] == "releasing"
    monkeypatch.setattr(mail_outbox, "enqueue_mail", real)
    # Gleich danach: es läuft noch (oder hängt) - kein zweiter Start, aber auch kein 409.
    assert (await flow.post(f"/api/contact/{cid}/not-spam")).status_code == 423
    # Nach ein paar Minuten darf es neu angestoßen werden - ohne doppelte Mails.
    await flow.db.contact_messages.update_one({"id": cid}, {"$set": {"spam.release.started_at": "2000-01-01T00:00:00+00:00"}})
    retried = await flow.post(f"/api/contact/{cid}/not-spam")
    assert retried.status_code == 200, retried.text
    assert retried.json()["status"] == "new" and retried.json()["spam"]["release"]["state"] == "released"
    assert await flow.db.mail_jobs.count_documents({"to": BOT["email"]}) == 1
    assert len(await board_mails(flow)) == 1
    assert (await flow.post(f"/api/contact/{cid}/not-spam")).status_code == 409
