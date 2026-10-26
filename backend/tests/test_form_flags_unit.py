"""Ja/Nein-Felder aus Formularen: ohne Feld gilt die Vorgabe, auch mit FastAPI ab 0.161 (services/form_flags.py)."""
import pathlib
import sys

import pytest
from fastapi import FastAPI, Form, HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.form_flags import form_flag  # noqa: E402


@pytest.mark.parametrize("value,default,expected", [
    (None, True, True), (None, False, False), ("", True, True), ("  ", False, False),
    ("true", False, True), ("TRUE", False, True), ("1", False, True), ("on", False, True), ("ja", False, True),
    ("false", True, False), ("0", True, False), ("off", True, False), ("nein", True, False),
])
def test_missing_or_empty_takes_the_default_and_words_are_read(value, default, expected):
    assert form_flag(value, default=default) is expected


def test_an_unknown_word_is_refused():
    with pytest.raises(HTTPException) as error:
        form_flag("vielleicht", default=True)
    assert error.value.status_code == 422


def test_a_missing_form_field_keeps_the_default_through_fastapi():
    app = FastAPI()

    @app.post("/flag")
    def read(flag: str | None = Form(None)):
        return {"flag": form_flag(flag, default=True)}

    client = TestClient(app)
    assert client.post("/flag", data={"other": "1"}).json() == {"flag": True}
    assert client.post("/flag", data={"flag": "false"}).json() == {"flag": False}
