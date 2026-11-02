"""Das Modell beim Image-Bau: Serverfehler der Quelle dürfen Deploy und CI nicht abbrechen."""
import hashlib
import io
import pathlib
import sys
import urllib.error

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import fetch_ocr_model  # noqa: E402


def http_error(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError("https://modell.example.test/m.onnx", code, "Fehler", {}, io.BytesIO())


def answers(monkeypatch, *replies):
    calls = []

    def fake_urlopen(url, timeout=None):
        calls.append(url)
        reply = replies[len(calls) - 1]
        if isinstance(reply, Exception):
            raise reply
        return io.BytesIO(reply)

    monkeypatch.setattr(fetch_ocr_model.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(fetch_ocr_model.time, "sleep", lambda _seconds: None)
    return calls


def test_a_server_error_is_tried_again(monkeypatch):
    calls = answers(monkeypatch, http_error(500), OSError("Verbindung weg"), http_error(429), b"modell")
    assert fetch_ocr_model.download("https://modell.example.test/m.onnx") == b"modell"
    assert len(calls) == 4


def test_a_missing_file_stops_at_once(monkeypatch):
    calls = answers(monkeypatch, http_error(404), b"modell")
    with pytest.raises(urllib.error.HTTPError):
        fetch_ocr_model.download("https://modell.example.test/m.onnx")
    assert len(calls) == 1


def test_after_the_last_attempt_the_error_stays_visible(monkeypatch):
    calls = answers(monkeypatch, *[http_error(500)] * fetch_ocr_model.ATTEMPTS)
    with pytest.raises(urllib.error.HTTPError):
        fetch_ocr_model.download("https://modell.example.test/m.onnx")
    assert len(calls) == fetch_ocr_model.ATTEMPTS


def test_another_file_aborts_and_writes_nothing(monkeypatch, tmp_path):
    answers(monkeypatch, b"andere datei")
    checksum = tmp_path / "modell.sha256"
    checksum.write_text(f"{hashlib.sha256(b'modell').hexdigest()}  m.onnx\n", encoding="ascii")
    target = tmp_path / "m.onnx"
    with pytest.raises(SystemExit):
        fetch_ocr_model.main("https://modell.example.test/m.onnx", str(checksum), str(target))
    assert not target.exists()


def test_the_right_file_is_written(monkeypatch, tmp_path):
    answers(monkeypatch, b"modell")
    checksum = tmp_path / "modell.sha256"
    checksum.write_text(f"{hashlib.sha256(b'modell').hexdigest()}  m.onnx\n", encoding="ascii")
    target = tmp_path / "m.onnx"
    fetch_ocr_model.main("https://modell.example.test/m.onnx", str(checksum), str(target))
    assert target.read_bytes() == b"modell"
