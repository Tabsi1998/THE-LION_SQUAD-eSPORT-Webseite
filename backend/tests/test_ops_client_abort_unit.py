"""Was als Abbruch durch den Client gilt (#2446) - und was trotz getrennter Verbindung ein Serverfehler bleibt."""
import asyncio
import pathlib
import sys

import pytest
from starlette.requests import ClientDisconnect

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import ops_monitor  # noqa: E402
from services.ops_monitor import NO_RESPONSE_MESSAGE, OpsMonitorMiddleware, is_client_abort  # noqa: E402


def test_client_disconnect_is_always_an_abort():
    assert is_client_abort(ClientDisconnect(), client_gone=False)
    assert is_client_abort(ClientDisconnect(), client_gone=True)
    assert is_client_abort(BaseExceptionGroup("eine", [ClientDisconnect()]), client_gone=True)


def test_no_response_counts_as_abort_only_when_the_client_really_left():
    assert is_client_abort(RuntimeError(NO_RESPONSE_MESSAGE), client_gone=True)
    # Ohne getrennte Verbindung ist eine fehlende Antwort ein Fehler im eigenen Code.
    assert not is_client_abort(RuntimeError(NO_RESPONSE_MESSAGE), client_gone=False)


def test_other_errors_stay_server_errors_even_after_the_client_left():
    assert not is_client_abort(RuntimeError("Speichern kaputt"), client_gone=True)
    assert not is_client_abort(KeyError("id"), client_gone=True)
    assert not is_client_abort(OSError("Platte voll"), client_gone=True)


def scope(path="/api/ops/vitals"):
    return {"type": "http", "method": "POST", "path": path, "raw_path": path.encode("ascii"), "query_string": b"",
            "root_path": "", "scheme": "http", "headers": [(b"host", b"testserver")], "server": ("testserver", 80)}


def run_middleware(inner, receive, send, monkeypatch):
    recorded = []

    async def record_exception(_app, _request, exc, status_code=500):
        recorded.append(("exception", type(exc).__name__))

    async def record_http_error(_app, _request, status_code):
        recorded.append(("http", status_code))

    monkeypatch.setattr(ops_monitor, "record_exception", record_exception)
    monkeypatch.setattr(ops_monitor, "record_http_error", record_http_error)

    async def go():
        await OpsMonitorMiddleware(inner)(scope(), receive, send)

    return recorded, go


async def _disconnect():
    return {"type": "http.disconnect"}


async def _drop(_message):
    return None


def test_a_missing_answer_without_disconnect_still_becomes_a_group(monkeypatch):
    async def inner(_scope, _receive, _send):
        raise RuntimeError(NO_RESPONSE_MESSAGE)

    async def receive():
        return {"type": "http.request", "body": b"{}", "more_body": False}

    recorded, go = run_middleware(inner, receive, _drop, monkeypatch)
    with pytest.raises(RuntimeError):
        asyncio.run(go())
    assert recorded == [("exception", "RuntimeError")]


def test_a_missing_answer_after_disconnect_is_dropped_quietly(monkeypatch):
    async def inner(_scope, receive, _send):
        await receive()
        raise RuntimeError(NO_RESPONSE_MESSAGE)

    recorded, go = run_middleware(inner, _disconnect, _drop, monkeypatch)
    asyncio.run(go())
    assert recorded == []


def test_a_real_error_after_disconnect_still_becomes_a_group(monkeypatch):
    async def inner(_scope, receive, _send):
        await receive()
        raise RuntimeError("Speichern kaputt")

    recorded, go = run_middleware(inner, _disconnect, _drop, monkeypatch)
    with pytest.raises(RuntimeError):
        asyncio.run(go())
    assert recorded == [("exception", "RuntimeError")]


def test_a_failing_send_becomes_a_quiet_client_disconnect(monkeypatch):
    async def inner(_scope, _receive, send):
        await send({"type": "http.response.start", "status": 202, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    async def send(_message):
        raise OSError("client disconnected")

    recorded, go = run_middleware(inner, _disconnect, send, monkeypatch)
    asyncio.run(go())
    assert recorded == []


def test_a_5xx_answer_is_recorded_unless_it_is_the_write_pause(monkeypatch):
    from services import maintenance

    def answering(headers):
        async def inner(_scope, _receive, send):
            await send({"type": "http.response.start", "status": 503, "headers": headers})
            await send({"type": "http.response.body", "body": b""})
        return inner

    recorded, go = run_middleware(answering([]), _disconnect, _drop, monkeypatch)
    asyncio.run(go())
    assert recorded == [("http", 503)]

    marker = [(maintenance.MARKER_HEADER.lower().encode("latin-1"), b"1")]
    recorded, go = run_middleware(answering(marker), _disconnect, _drop, monkeypatch)
    asyncio.run(go())
    assert recorded == []
