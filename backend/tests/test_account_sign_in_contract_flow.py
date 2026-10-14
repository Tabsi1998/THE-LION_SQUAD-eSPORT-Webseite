"""Anmeldung und Passwort ändern einheitlich (#1510), über die echten Routen gegen die Datenbank im Speicher.

Vertrag:
- Eine abgelehnte Anmeldung (Web und App) sieht immer gleich aus - gleiche Antwort, gleicher Prüfaufwand (genau ein
  vollwertiger Hash-Vergleich), egal ob es zur E-Mail ein Konto gibt und in welchem Zustand es ist.
- Jeder Konto-Endpunkt, der ein Passwort prüft, ist begrenzt - auch „Passwort ändern“.
Erfundene Konten und Testpasswörter."""
import ast
import pathlib
import sys

import bcrypt
import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402

from auth import hash_password, password_fields  # noqa: E402

BACKEND = pathlib.Path(__file__).resolve().parents[1]
PASSWORD = "Loewen-Testpasswort-1"
WRONG = "Falsches-Testpasswort-2"
LOGIN_PATHS = ("/api/auth/login", "/api/auth/mobile/login")


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "sign-in-tests-secret-with-at-least-32-characters")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def account(flow, **fields) -> dict:
    name = f"loewe-{new_id()[:6]}"
    user = {
        "id": new_id(), "username": name, "display_name": name, "email": f"{name}@example.com",
        "role": "player", "roles": ["player"], "is_active": True, "is_banned": False,
        "email_verified": True, "mfa_enabled": False, **password_fields(PASSWORD),
        "password_login_available": True, "privacy_policy_version": "2026-08-26",
    }
    user.update(fields)
    await flow.db.users.insert_one(dict(user))
    return user


@pytest.fixture
def hash_checks(monkeypatch):
    """Zählt die vollwertigen Hash-Vergleiche (gegen einen echten bcrypt-Hash) und merkt sich deren Kosten."""
    real = bcrypt.checkpw
    seen: list[bytes] = []

    def counting(candidate, stored):
        if isinstance(stored, (bytes, bytearray)) and bytes(stored).startswith(b"$2") and len(stored) == 60:
            seen.append(bytes(stored[:7]))
        return real(candidate, stored)

    monkeypatch.setattr(bcrypt, "checkpw", counting)
    return seen


def cost_prefix() -> bytes:
    return hash_password(PASSWORD).encode("utf-8")[:7]


async def rejected_states(flow) -> dict[str, str]:
    """Je Zustand eine E-Mail, mit der die Anmeldung mit ``WRONG`` scheitert."""
    known = await account(flow)
    invited = await account(flow, password_hash="!pending_invite", password_setup_required=True)
    reinvited = await account(flow, password_setup_required=True)
    without_hash = await account(flow)
    await flow.db.users.update_one({"id": without_hash["id"]}, {"$unset": {"password_hash": "", "password_contract": ""}})
    return {
        "kein Konto": f"niemand-{new_id()[:6]}@example.com",
        "falsches Passwort": known["email"],
        "Einladung offen": invited["email"],
        "Einladung erneut": reinvited["email"],
        "ohne Passwort": without_hash["email"],
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("path", LOGIN_PATHS)
@pytest.mark.parametrize("attempt", [WRONG, "x" * 100], ids=["kurz", "lang"])
async def test_a_rejected_sign_in_looks_the_same_in_every_account_state(flow, hash_checks, path, attempt):
    answers = {}
    for state, email in (await rejected_states(flow)).items():
        hash_checks.clear()
        response = await flow.post(path, json={"email": email, "password": attempt})
        answers[state] = (response.status_code, response.json())
        assert hash_checks == [cost_prefix()], f"{state}: genau ein vollwertiger Vergleich mit denselben Kosten"
    assert len(set(map(repr, answers.values()))) == 1, answers
    assert answers["kein Konto"] == (401, {"detail": "Ungültige Zugangsdaten"})


@pytest.mark.asyncio
@pytest.mark.parametrize("path", LOGIN_PATHS)
async def test_every_rejected_sign_in_counts_toward_the_same_limit(flow, path):
    for state, email in (await rejected_states(flow)).items():
        before = await flow.db.login_attempts.count_documents({})
        await flow.post(path, json={"email": email, "password": WRONG})
        assert await flow.db.login_attempts.count_documents({}) == before + 1, state


@pytest.mark.asyncio
@pytest.mark.parametrize("path", LOGIN_PATHS)
async def test_the_right_password_still_signs_in_and_names_an_open_invitation(flow, path):
    known = await account(flow)
    assert (await flow.post(path, json={"email": known["email"], "password": PASSWORD})).status_code == 200

    # Gegenprobe: wer das richtige Passwort kennt, erfährt, dass erst der Einladungslink dran ist.
    reinvited = await account(flow, password_setup_required=True)
    response = await flow.post(path, json={"email": reinvited["email"], "password": PASSWORD})
    assert response.status_code == 403 and "Einladungslink" in response.json()["detail"]


async def change(flow, current: str):
    return await flow.post("/api/auth/change-password", json={"current_password": current, "new_password": "Neues-Testpasswort-3"})


@pytest.mark.asyncio
async def test_change_password_is_limited_per_account(flow):
    user = await account(flow)
    other = await account(flow)
    flow.act_as(user)
    codes = [(await change(flow, WRONG)).status_code for _ in range(12)]
    assert codes[0] == 400 and codes[-1] == 429, codes
    first_limited = codes.index(429)
    assert all(code == 429 for code in codes[first_limited:])

    # Auch das richtige Passwort wartet, bis das Fenster vorbei ist - das Konto bleibt unverändert.
    assert (await change(flow, PASSWORD)).status_code == 429
    stored = await flow.db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 1})
    assert stored["password_hash"] == user["password_hash"]

    # Gegenprobe: ein anderes Konto ist davon nicht betroffen.
    flow.act_as(other)
    assert (await change(flow, PASSWORD)).status_code == 200


PASSWORD_CHECKS = {"verify_user_password", "verify_and_upgrade_password", "verify_password"}
LIMITS = {"enforce_rate_limit", "_check_brute_force"}


def _called_names(function) -> set[str]:
    names = set()
    for node in ast.walk(function):
        if isinstance(node, ast.Call):
            target = node.func
            if isinstance(target, ast.Name):
                names.add(target.id)
            elif isinstance(target, ast.Attribute):
                names.add(target.attr)
            for argument in node.args:
                if isinstance(argument, ast.Name):
                    names.add(argument.id)
    return names


def test_every_route_that_checks_a_password_is_limited():
    """Wächter: wer in ``routes/`` ein Passwort prüft, begrenzt in derselben Funktion die Versuche."""
    missing = []
    for path in sorted((BACKEND / "routes").glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for function in ast.walk(tree):
            if not isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            called = _called_names(function)
            if called & PASSWORD_CHECKS and not called & LIMITS:
                missing.append(f"{path.relative_to(BACKEND).as_posix()}:{function.name}")
    assert missing == [], missing
