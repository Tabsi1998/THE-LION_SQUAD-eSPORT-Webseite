"""Konto anonymisieren (#2118): danach ist kein Profilfeld mehr gefüllt - außer den wenigen, die bewusst einen festen
Wert bekommen (Name „Gelöschter User“, Einwilligungen und Schalter aus).

Die Liste der Profilfelder kommt aus dem Profilformular (``models.UserUpdate``) und den leerbaren Feldern
(``routes.user_routes.USER_NULLABLE_FIELDS``). Kommt dort ein neues Feld dazu, füllt dieser Test es und verlangt, dass
es nach dem Anonymisieren leer ist - ein vergessenes Feld fällt so sofort auf. Namen und Werte sind erfunden.
"""
import pathlib
import sys
import typing

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import UserUpdate  # noqa: E402
from routes import dsgvo_routes  # noqa: E402
from routes.user_routes import USER_NULLABLE_FIELDS  # noqa: E402
from services import account_erasure, migrations  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def _sample(name: str, annotation):
    """Ein gefüllter Wert passend zum Typ des Felds - so, wie das Profilformular ihn speichern würde."""
    args = [arg for arg in typing.get_args(annotation) if arg is not type(None)]
    inner = args[0] if args else annotation
    origin = typing.get_origin(inner)
    if inner is bool:
        return True
    if inner is int:
        return 42
    if origin is list:
        return ["testwert"]
    if origin is dict:
        return {"cs2": {"steam": "testwert"}} if name == "game_ids" else {"x": "public"}
    if origin is typing.Literal:
        return typing.get_args(inner)[0]
    return f"test-{name}"


def _filled_profile() -> dict:
    fields = UserUpdate.model_fields
    values = {name: _sample(name, info.annotation) for name, info in fields.items()}
    for name in USER_NULLABLE_FIELDS - set(values):
        values[name] = f"test-{name}"
    # Felder außerhalb des Formulars, die trotzdem die Person beschreiben.
    values.update({field: "test-wert" for field in account_erasure.EXTRA_PERSONAL_USER_FIELDS})
    return values


def _empty(value) -> bool:
    return value in (None, "", [], {}, False)


def test_the_field_list_covers_the_profile_form_and_every_nullable_field():
    cleared = account_erasure.profile_fields_to_clear()
    kept = set(account_erasure.ANONYMIZED_USER_VALUES)
    assert set(UserUpdate.model_fields) <= cleared | kept
    assert USER_NULLABLE_FIELDS <= cleared | kept
    # Bewusst behalten wird nur, was einen festen, nichtssagenden Wert bekommt.
    assert kept & set(UserUpdate.model_fields) == {"display_name", "newsletter_consent", "notification_preferences",
                                                   "privacy_public_profile", "privacy_achievements_public"}


@pytest.mark.asyncio
async def test_after_anonymizing_no_profile_field_is_left(flow):
    person = await flow.add_user(role="player", name="testperson")
    await flow.db.users.update_one({"id": person["id"]}, {"$set": _filled_profile()})

    await dsgvo_routes._anonymize_user_data(flow.db, person["id"], person["id"], "user.self_anonymize")

    stored = await flow.db.users.find_one({"id": person["id"]}, {"_id": 0})
    expected = account_erasure.ANONYMIZED_USER_VALUES
    left = {
        name: stored.get(name)
        for name in set(UserUpdate.model_fields) | USER_NULLABLE_FIELDS | set(account_erasure.EXTRA_PERSONAL_USER_FIELDS)
        if name not in expected and not _empty(stored.get(name))
    }
    assert left == {}
    for name, value in expected.items():
        assert stored.get(name) == value, name
    assert stored["is_active"] is False and stored["is_banned"] is True and stored["anonymized_at"]


@pytest.mark.asyncio
async def test_accounts_anonymized_earlier_are_cleaned_up_once(flow):
    person = await flow.add_user(role="player", name="altkonto")
    await flow.db.users.update_one({"id": person["id"]}, {"$set": {
        **_filled_profile(), "display_name": "Gelöschter User", "is_active": False, "anonymized_at": "2026-01-01T00:00:00+00:00",
        "email": f"deleted_{person['id'][:12]}@deleted.invalid",
    }})
    living = await flow.add_user(role="player", name="lebendig")
    await flow.db.users.update_one({"id": living["id"]}, {"$set": {"x_handle": "bleibt", "favorite_games": ["Rocket League"]}})

    result = await migrations.migrate_anonymized_profile_fields(flow.db)
    assert result.startswith("1 ")

    stored = await flow.db.users.find_one({"id": person["id"]}, {"_id": 0})
    assert not stored.get("x_handle") and not stored.get("favorite_games") and not stored.get("dm_privacy")
    assert stored["display_name"] == "Gelöschter User"
    other = await flow.db.users.find_one({"id": living["id"]}, {"_id": 0})
    assert other["x_handle"] == "bleibt" and other["favorite_games"] == ["Rocket League"]
    assert any(version == 15 for version, _name, _run in migrations.MIGRATIONS)
