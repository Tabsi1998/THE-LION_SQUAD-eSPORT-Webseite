"""Prüffehler (422) auf Deutsch (#2119 X1).

FastAPI meldet ungültige Eingaben auf Englisch („String should have at most 1000 characters“) - die Oberfläche zeigt
den Text 1:1 als Meldung. Der Handler übersetzt die häufigen Arten; `type` und `loc` bleiben für Programme gleich.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from flow_harness import make_flow  # noqa: E402
from services.validation_messages import german_message  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.parametrize("error, expected", [
    ({"type": "string_too_long", "loc": ("body", "message"), "msg": "String should have at most 1000 characters", "ctx": {"max_length": 1000}},
     "Nachricht: höchstens 1000 Zeichen."),
    ({"type": "string_too_short", "loc": ("body", "name"), "msg": "String should have at least 2 characters", "ctx": {"min_length": 2}},
     "Name: mindestens 2 Zeichen."),
    ({"type": "string_too_short", "loc": ("body", "subject"), "msg": "String should have at least 1 character", "ctx": {"min_length": 1}},
     "Betreff: bitte ausfüllen."),
    ({"type": "missing", "loc": ("body", "email"), "msg": "Field required"}, "E-Mail: bitte ausfüllen."),
    ({"type": "missing", "loc": ("body", "score_a"), "msg": "Field required"}, "Pflichtangabe fehlt (score_a)."),
    ({"type": "int_parsing", "loc": ("body", "max_participants"), "msg": "Input should be a valid integer"}, "Bitte eine ganze Zahl eingeben (max_participants)."),
    ({"type": "float_parsing", "loc": ("query", "amount"), "msg": "Input should be a valid number"}, "Bitte eine Zahl eingeben (amount)."),
    ({"type": "greater_than_equal", "loc": ("body", "max_participants"), "msg": "x", "ctx": {"ge": 2}}, "Mindestens 2 (max_participants)."),
    ({"type": "less_than_equal", "loc": ("body", "delta"), "msg": "x", "ctx": {"le": 10000}}, "Höchstens 10000 (delta)."),
    ({"type": "greater_than", "loc": ("body", "price"), "msg": "x", "ctx": {"gt": 0}}, "Muss größer als 0 sein (price)."),
    ({"type": "string_pattern_mismatch", "loc": ("body", "slug"), "msg": "x", "ctx": {"pattern": "^[a-z]+$"}}, "Format stimmt nicht (slug)."),
    ({"type": "value_error", "loc": ("body", "email"), "msg": "value is not a valid email address: An email address must have an @-sign."},
     "E-Mail: bitte eine gültige E-Mail-Adresse eingeben."),
    ({"type": "value_error", "loc": ("body", "password"), "msg": "Value error, Das Passwort braucht mindestens 10 Zeichen."},
     "Passwort: Das Passwort braucht mindestens 10 Zeichen."),
    ({"type": "literal_error", "loc": ("body", "status"), "msg": "Input should be 'a' or 'b'", "ctx": {"expected": "'a' or 'b'"}},
     "Status: dieser Wert ist nicht erlaubt."),
    ({"type": "too_long", "loc": ("body", "tags"), "msg": "List should have at most 5 items", "ctx": {"max_length": 5}}, "Höchstens 5 Einträge (tags)."),
    ({"type": "bool_parsing", "loc": ("body", "enabled"), "msg": "Input should be a valid boolean"}, "Bitte ja oder nein angeben (enabled)."),
    ({"type": "string_type", "loc": ("body", "x"), "msg": "Input should be a valid string"}, "Eingabe ungültig (x)."),
    ({"type": "password_policy", "loc": ("body", "password"), "msg": "Höchstens 72 Byte."}, "Höchstens 72 Byte."),
])
def test_common_validation_errors_read_in_german(error, expected):
    assert german_message(error) == expected


@pytest.mark.asyncio
async def test_the_handler_answers_in_german_and_keeps_type_and_loc(flow):
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    response = await flow.post("/api/admin/mobile-push/test", json={"title": "x" * 200, "body": "ok"})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail[0]["msg"] == "Titel: höchstens 120 Zeichen."
    assert detail[0]["type"] == "string_too_long" and detail[0]["loc"] == ["body", "title"]
