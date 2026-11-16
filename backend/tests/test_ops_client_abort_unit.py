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


def scope(path="/api/ops/vitals", method="POST", **extra):
    return {"type": "http", "method": method, "path": path, "raw_path": path.encode("ascii"), "query_string": b"",
            "root_path": "", "scheme": "http", "headers": [(b"host", b"testserver")], "server": ("testserver", 80),
            "asgi": {"version": "3.0", "spec_version": "2.4"}, **extra}


def run_middleware(inner, receive, send, monkeypatch, request_scope=None):
    recorded = []

    async def record_exception(_app, _request, exc, status_code=500):
        recorded.append(("exception", type(exc).__name__))

    async def record_http_error(_app, _request, status_code):
        recorded.append(("http", status_code))

    monkeypatch.setattr(ops_monitor, "record_exception", record_exception)
    monkeypatch.setattr(ops_monitor, "record_http_error", record_http_error)

    async def go():
        await OpsMonitorMiddleware(inner)(request_scope or scope(), receive, send)

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


class Collect:
    """Was beim Client ankommt."""

    def __init__(self, fail_on: int | None = None):
        self.messages = []
        self.fail_on = fail_on

    async def __call__(self, message):
        if self.fail_on is not None and len(self.messages) >= self.fail_on:
            raise OSError("client disconnected")
        self.messages.append(message)


def test_a_streamed_body_passes_unchanged_and_counts_nothing(monkeypatch):
    from starlette.responses import StreamingResponse

    async def chunks():
        yield b"eins,"
        yield b"zwei"

    client = Collect()
    recorded, go = run_middleware(StreamingResponse(chunks(), media_type="text/csv"), _disconnect, client, monkeypatch,
                                  scope(method="GET"))
    asyncio.run(go())
    assert recorded == []
    assert [message["type"] for message in client.messages] == ["http.response.start"] + ["http.response.body"] * 3
    assert [message.get("more_body", False) for message in client.messages[1:]] == [True, True, False]
    assert b"".join(message.get("body", b"") for message in client.messages[1:]) == b"eins,zwei"


def test_a_file_answer_with_pathsend_passes_unchanged(monkeypatch, tmp_path):
    from starlette.responses import FileResponse

    datei = tmp_path / "export.csv"
    datei.write_bytes(b"a,b\n")
    client = Collect()
    request_scope = scope(path="/api/export.csv", method="GET", extensions={"http.response.pathsend": {}})
    recorded, go = run_middleware(FileResponse(datei), _disconnect, client, monkeypatch, request_scope)
    asyncio.run(go())
    assert recorded == []
    assert [message["type"] for message in client.messages] == ["http.response.start", "http.response.pathsend"]
    assert client.messages[1]["path"] == str(datei)


def test_an_error_after_the_answer_started_still_becomes_a_group(monkeypatch):
    """Bricht ein Streaming-Körper mit einem echten Fehler ab, kann keine 500 mehr kommen - gezählt wird trotzdem."""
    from starlette.responses import StreamingResponse

    async def chunks():
        yield b"eins,"
        raise RuntimeError("Export kaputt")

    recorded, go = run_middleware(StreamingResponse(chunks()), _disconnect, Collect(), monkeypatch, scope(method="GET"))
    with pytest.raises(RuntimeError):
        asyncio.run(go())
    assert recorded == [("exception", "RuntimeError")]


def test_an_error_after_a_counted_5xx_is_not_counted_twice(monkeypatch):
    async def inner(_scope, _receive, send):
        await send({"type": "http.response.start", "status": 502, "headers": []})
        raise RuntimeError("Körper kaputt")

    recorded, go = run_middleware(inner, _disconnect, Collect(), monkeypatch)
    with pytest.raises(RuntimeError):
        asyncio.run(go())
    assert recorded == [("http", 502)]


def test_a_client_leaving_in_the_middle_of_a_stream_counts_nothing(monkeypatch):
    from starlette.responses import StreamingResponse

    async def chunks():
        for number in range(5):
            yield f"zeile {number}\n".encode("ascii")

    # Start und erstes Stück kommen an, danach ist die Verbindung zu.
    client = Collect(fail_on=2)
    recorded, go = run_middleware(StreamingResponse(chunks()), _disconnect, client, monkeypatch, scope(method="GET"))
    asyncio.run(go())
    assert recorded == []
    assert len(client.messages) == 2


@pytest.mark.parametrize("kind", ["websocket", "lifespan"])
def test_other_scopes_pass_both_middlewares_untouched(kind, monkeypatch):
    from services.maintenance import WritePauseMiddleware

    seen = []

    async def inner(inner_scope, inner_receive, inner_send):
        seen.append((inner_scope, inner_receive, inner_send))

    outer_scope = {"type": kind, "path": "/api/ops/vitals", "method": "POST"} if kind == "websocket" else {"type": kind}

    async def receive():
        return {"type": f"{kind}.connect" if kind == "websocket" else "lifespan.startup"}

    async def send(_message):
        return None

    def db_must_not_be_read():
        raise AssertionError("die Schreibpause darf außerhalb von HTTP nichts nachschlagen")

    monkeypatch.setattr("database.get_db", db_must_not_be_read)
    for middleware in (OpsMonitorMiddleware, WritePauseMiddleware):
        asyncio.run(middleware(inner)(outer_scope, receive, send))
    assert len(seen) == 2
    for inner_scope, inner_receive, inner_send in seen:
        assert inner_scope is outer_scope and inner_receive is receive and inner_send is send
