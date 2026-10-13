"""Passwortvertrag (#1033): eine Regel für Registrierung, Ändern, Zurücksetzen, Einrichtung und Anmeldung.

Vertrag: Unicode wird nach NFC vereinheitlicht, Leerzeichen bleiben unverändert, mindestens 10 Zeichen,
höchstens 72 Byte in UTF-8, keine Steuerzeichen, nicht nur Leerzeichen. Bestehende Konten melden sich weiter an.
Alle Werte sind erfundene Testpasswörter."""
import pathlib
import unicodedata

import bcrypt
import pytest
from pydantic import ValidationError

import auth
import models
from routes.setup_routes import SetupWizardBody
from services import password_policy as policy

COMPOSED = "Löwenrudel-Grüße"
DECOMPOSED = unicodedata.normalize("NFD", COMPOSED)


def _legacy_hash(raw: str) -> str:
    """So wurde früher gehasht: die rohen UTF-8-Bytes, ab Byte 72 abgeschnitten."""
    return bcrypt.hashpw(raw.encode("utf-8")[:72], bcrypt.gensalt(4)).decode("utf-8")


def _new_password_models():
    return [
        lambda value: models.UserRegister(
            username="testloewe", email="loewe@example.com", password=value,
            accept_privacy=True, accept_terms=True,
        ).password,
        lambda value: models.ResetPasswordBody(token="t", new_password=value).new_password,
        lambda value: models.ChangePasswordBody(current_password="alt", new_password=value).new_password,
        lambda value: models.AdminUserCreate(username="testloewe", email="loewe@example.com", password=value).password,
        lambda value: SetupWizardBody(new_admin_password=value).new_admin_password,
    ]


# ---------------------------------------------------------------- die Regel selbst

def test_contract_constants_live_in_one_place():
    assert policy.MIN_PASSWORD_LENGTH == 10
    assert policy.MAX_PASSWORD_BYTES == 72
    assert models.MIN_PASSWORD_LENGTH == policy.MIN_PASSWORD_LENGTH


@pytest.mark.parametrize("value", [
    "a" * 10,
    "a" * 72,
    "ä" * 36,
    "🦁" * 18,
    "  mit Leerzeichen  ",
    COMPOSED,
    DECOMPOSED,
])
def test_accepted_passwords(value):
    assert policy.password_problem(value) is None


@pytest.mark.parametrize("value", [
    "kurz",
    "a" * 9,
    "a\u0308" * 9,
    "a" * 73,
    "ä" * 37,
    "ä" * 80,
    "🦁" * 9,
    "🦁" * 19,
    " " * 12,
    "zehn\tzeichen",
    "zehn\x00zeichen",
    "zehn\ud800zeichen",
])
def test_rejected_passwords(value):
    assert policy.password_problem(value)


BLANK_CASES = [
    (" " * 12, True),
    ("\u00a0" * 10, True),
    ("\u3000" * 10, True),
    ("\u2028" * 10, True),
    ("\ufeff" * 10, False),
    ("\u200b" * 10, False),
]


@pytest.mark.parametrize(("value", "blank"), BLANK_CASES)
def test_blank_check_uses_the_same_explicit_class_as_the_web(value, blank):
    # Gleiche Fälle wie in frontend/src/lib/passwordRules.test.js.
    assert (policy.password_problem(value) == policy.MESSAGE_BLANK) is blank
    if not blank:
        assert policy.password_problem(value) is None


def test_length_is_counted_after_normalization():
    # Neun zusammengesetzte Zeichen bleiben neun Zeichen, egal wie das Gerät sie schickt.
    assert policy.password_problem("ä" * 9) == policy.password_problem("a\u0308" * 9)
    assert policy.password_problem("ä" * 10) is None
    assert policy.password_problem("a\u0308" * 10) is None


def test_bytes_are_counted_after_normalization():
    assert policy.password_problem("a\u0308" * 36) is None
    assert policy.password_problem("a\u0308" * 37)


def test_whitespace_is_kept_unchanged():
    hashed = auth.hash_password("  mit Leerzeichen  ")
    assert auth.verify_password("  mit Leerzeichen  ", hashed)
    assert not auth.verify_password("mit Leerzeichen", hashed)
    assert not auth.verify_password("  mit Leerzeichen", hashed)


# ---------------------------------------------------------------- Hash und Prüfung

def test_both_unicode_forms_match_a_new_hash():
    for stored_from in (COMPOSED, DECOMPOSED):
        hashed = auth.hash_password(stored_from)
        assert auth.verify_password(COMPOSED, hashed)
        assert auth.verify_password(DECOMPOSED, hashed)
        assert not auth.verify_password("Loewenrudel-Gruesse", hashed)


@pytest.mark.parametrize("value", ["kurz", "a" * 73, "ä" * 37, " " * 12, "zehn\x00zeichen"])
def test_no_hash_is_created_outside_the_contract(value):
    with pytest.raises(ValueError):
        auth.hash_password(value)


@pytest.mark.parametrize("value", ["a" * 200, "ä" * 80, "zehn\x00zeichen", "zehn\ud800zeichen", ""])
def test_verification_never_raises(value):
    hashed = auth.hash_password("a" * 10)
    assert auth.verify_password(value, hashed) is False


@pytest.mark.parametrize("stored", ["!pending_invite", "!disabled", "", "kein-hash"])
def test_placeholder_hashes_never_match(stored):
    assert auth.verify_password("a" * 10, stored) is False


# ---------------------------------------------------------------- bestehende Konten

@pytest.mark.parametrize("raw", [
    "ä" * 80,
    "a" + "ä" * 40,
    "b" * 100,
])
def test_existing_accounts_with_long_passwords_still_sign_in(raw):
    hashed = _legacy_hash(raw)
    assert auth.verify_password(raw, hashed)
    assert not auth.verify_password("c" + raw[1:], hashed)


def test_existing_accounts_with_decomposed_input_still_sign_in():
    hashed = _legacy_hash(DECOMPOSED)
    assert auth.verify_password(DECOMPOSED, hashed)


def test_existing_accounts_with_ordinary_passwords_still_sign_in():
    hashed = _legacy_hash("altes-testpasswort")
    assert auth.verify_password("altes-testpasswort", hashed)
    assert not auth.verify_password("altes-testpasswort ", hashed)


# ---------------------------------------------------------------- alle Eingänge gleich

@pytest.mark.parametrize("build", _new_password_models())
@pytest.mark.parametrize("value", ["kurz", "a" * 73, "ä" * 37, " " * 12, "zehn\tzeichen"])
def test_every_new_password_entry_rejects_the_same_values(build, value):
    with pytest.raises(ValidationError) as exc:
        build(value)
    message = exc.value.errors()[0]["msg"]
    assert message == policy.password_problem(value)


@pytest.mark.parametrize("build", _new_password_models())
def test_every_new_password_entry_accepts_and_normalizes(build):
    assert build(DECOMPOSED) == COMPOSED
    assert build("ä" * 36) == "ä" * 36
    assert build("  mit Leerzeichen  ") == "  mit Leerzeichen  "


def test_sign_in_and_confirmation_fields_accept_any_input():
    # Anmelden und Bestätigen prüfen nur gegen den Hash, nie gegen die Regel für neue Passwörter.
    assert models.UserLogin(email="loewe@example.com", password="kurz").password == "kurz"
    assert models.ChangePasswordBody(current_password="ä" * 80, new_password="a" * 10).current_password == "ä" * 80


def test_only_the_auth_module_hashes_passwords():
    backend = pathlib.Path(__file__).resolve().parents[1]
    offenders = []
    for path in backend.rglob("*.py"):
        if "tests" in path.parts or path.name == "auth.py":
            continue
        if "bcrypt.hashpw" in path.read_text(encoding="utf-8"):
            offenders.append(path.relative_to(backend).as_posix())
    assert offenders == []


# ---------------------------------------------------------------- Markierung am Konto

def _marked(password: str) -> dict:
    return {"id": "neu", **auth.password_fields(password)}


def _unmarked(raw: str) -> dict:
    return {"id": "alt", "password_hash": _legacy_hash(raw)}


def test_every_new_hash_carries_the_contract_marker():
    fields = auth.password_fields("a" * 10)
    assert fields["password_contract"] == auth.PASSWORD_CONTRACT_VERSION == 2
    assert bcrypt.checkpw(b"a" * 10, fields["password_hash"].encode("utf-8"))


def test_marked_accounts_are_checked_strictly():
    user = _marked("a" * 72)
    assert auth.verify_user_password(user, "a" * 72)
    assert not auth.verify_user_password(user, "a" * 72 + "rest")
    assert not auth.verify_user_password(user, "ä" * 80)


def test_marked_accounts_accept_both_unicode_forms():
    user = _marked(COMPOSED)
    assert auth.verify_user_password(user, COMPOSED)
    assert auth.verify_user_password(user, DECOMPOSED)


def test_unmarked_accounts_keep_the_previous_check():
    user = _unmarked("a" * 72)
    assert auth.verify_user_password(user, "a" * 72)
    assert auth.verify_user_password(user, "a" * 72 + "rest")
    assert auth.verify_user_password(_unmarked(DECOMPOSED), DECOMPOSED)


@pytest.mark.parametrize("stored", ["!pending_invite", "!disabled", ""])
def test_marked_placeholders_never_match(stored):
    assert not auth.verify_user_password({"password_hash": stored, "password_contract": 2}, "a" * 10)
    assert not auth.verify_user_password({"password_contract": 2}, "a" * 10)


def test_marker_is_private_and_not_in_the_data_export():
    from routes.dsgvo_routes import HIDDEN_KEYS
    from services.private_fields import PRIVATE_USER_FIELDS

    assert "password_contract" in PRIVATE_USER_FIELDS
    assert "password_contract" in HIDDEN_KEYS


def test_only_password_fields_writes_new_hashes():
    backend = pathlib.Path(__file__).resolve().parents[1]
    offenders = []
    for path in backend.rglob("*.py"):
        if "tests" in path.parts or path.name == "auth.py":
            continue
        if "hash_password(" in path.read_text(encoding="utf-8"):
            offenders.append(path.relative_to(backend).as_posix())
    assert offenders == []
