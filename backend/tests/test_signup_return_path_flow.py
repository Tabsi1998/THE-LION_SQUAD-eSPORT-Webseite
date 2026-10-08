"""Nach dem Registrieren zurück dorthin, wo man hinwollte (#1225): der Server merkt sich beim Registrieren das geprüfte
Ziel und hängt es an den Link in der Bestätigungs-Mail; nach der Bestätigung nennt er es der Seite. Erlaubt ist nur ein
Pfad dieser Website mit genau einem „/“ am Anfang - fremde Ziele werden verworfen. Alle Daten sind erfunden."""
import pathlib
import sys
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlparse

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services.return_path import safe_next_path  # noqa: E402


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    from routes import auth_routes

    sent = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(auth_routes, "send_template", sent)
    monkeypatch.setattr(auth_routes, "_site_base_url", AsyncMock(return_value="https://verein.example"))
    instance.sent = sent
    try:
        yield instance
    finally:
        await shutdown()


def registration(name: str, next_path=None) -> dict:
    body = {"username": name, "email": f"{name}@lionsquad-test.at", "password": "testtest-42", "accept_privacy": True, "accept_terms": True}
    if next_path is not None:
        body["next"] = next_path
    return body


def mail_link(flow) -> str:
    calls = [call for call in flow.sent.call_args_list if call.args and call.args[0] == "email_verification"]
    assert calls, "keine Bestätigungs-Mail"
    return calls[-1].kwargs["verification_url"]


def test_only_paths_of_this_site_count():
    assert safe_next_path("/tournaments/mk-cup") == "/tournaments/mk-cup"
    assert safe_next_path("/tournaments/mk-cup?access=abc") == "/tournaments/mk-cup?access=abc"
    for bad in ["//fremd.example/x", "https://fremd.example", "javascript:alert(1)", "/\\fremd.example", "tournaments/x", "", None, 42, "/" + "x" * 600, "/a\nb"]:
        assert safe_next_path(bad) is None, bad


@pytest.mark.asyncio
async def test_target_is_stored_and_travels_in_the_mail_link(flow):
    response = await flow.post("/api/auth/register", json=registration("neonfalke", "/tournaments/mk-cup"))
    assert response.status_code == 200, response.text
    user = await flow.db.users.find_one({"username": "neonfalke"})
    assert user["signup_next"] == "/tournaments/mk-cup"
    link = urlparse(mail_link(flow))
    assert link.path == "/verify-email"
    assert parse_qs(link.query)["next"] == ["/tournaments/mk-cup"]

    # Ein neuer Link (Mail nicht angekommen) trägt dasselbe Ziel.
    resend = await flow.post("/api/auth/resend-verification", json={"email": "neonfalke@lionsquad-test.at"})
    assert resend.status_code == 200, resend.text
    assert parse_qs(urlparse(mail_link(flow)).query)["next"] == ["/tournaments/mk-cup"]

    token = parse_qs(link.query)["token"][0]
    verified = await flow.post("/api/auth/verify-email", json={"token": token})
    assert verified.status_code == 200, verified.text
    assert verified.json() == {"ok": True, "next": "/tournaments/mk-cup"}
    user = await flow.db.users.find_one({"username": "neonfalke"})
    assert user["email_verified"] is True
    assert "signup_next" not in user


@pytest.mark.asyncio
async def test_foreign_targets_are_dropped(flow):
    for index, bad in enumerate(["//fremd.example/x", "https://fremd.example", "javascript:alert(1)", "/\\fremd.example"]):
        name = f"spieler{index}"
        response = await flow.post("/api/auth/register", json=registration(name, bad))
        assert response.status_code == 200, response.text
        user = await flow.db.users.find_one({"username": name})
        assert "signup_next" not in user
        assert "next=" not in mail_link(flow)


@pytest.mark.asyncio
async def test_without_target_nothing_changes(flow):
    response = await flow.post("/api/auth/register", json=registration("lunabyte"))
    assert response.status_code == 200, response.text
    link = urlparse(mail_link(flow))
    assert "next" not in parse_qs(link.query)
    verified = await flow.post("/api/auth/verify-email", json={"token": parse_qs(link.query)["token"][0]})
    assert verified.json() == {"ok": True, "next": None}
