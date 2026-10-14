"""Anmeldung und Passwort ändern einheitlich (#1510), über die echten Routen gegen die Datenbank im Speicher.

Vertrag:
- Eine abgelehnte Anmeldung (Web und App) sieht immer gleich aus - gleiche Antwort, gleicher Prüfaufwand (so viele
  vollwertige Hash-Vergleiche, wie die Eingabe Formen hat, ``auth.password_work``), egal ob es zur E-Mail ein Konto gibt
  und in welchem Zustand es ist. Erst nach dem richtigen Passwort darf die Antwort den Zustand nennen.
- Vor jeder Prüfung bremst eine Grenze je Adresse, auch über viele E-Mails hinweg; bcrypt läuft im begrenzten Pool,
  nie im Event-Loop.
- Jeder Konto-Endpunkt, der ein Passwort prüft, ist begrenzt - auch „Passwort ändern“.
Erfundene Konten und Testpasswörter."""
import ast
import asyncio
import pathlib
import sys
import threading
import time
import unicodedata

import bcrypt
import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402

import auth  # noqa: E402

BACKEND = pathlib.Path(__file__).resolve().parents[1]
PASSWORD = "Loewen-Testpasswort-1"
WRONG = "Falsches-Testpasswort-2"
WRONG_DECOMPOSED = unicodedata.normalize("NFD", "Löwen-falsch-Grüße")
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
        "email_verified": True, "mfa_enabled": False, **auth.password_fields(PASSWORD),
        "password_login_available": True, "privacy_policy_version": "2026-08-26",
    }
    user.update(fields)
    await flow.db.users.insert_one(dict(user))
    return user


class _Checks(list):
    def __init__(self):
        super().__init__()
        self.threads: list[int] = []

    def __eq__(self, other):
        # Gleichheit wie bei einer Liste: nur die Kosten-Präfixe zählen, ``threads`` ist Beiwerk.
        return list.__eq__(self, other)

    __hash__ = None


@pytest.fixture
def hash_checks(monkeypatch):
    """Zählt die vollwertigen Hash-Vergleiche (gegen einen echten bcrypt-Hash) und merkt sich deren Kosten."""
    real = bcrypt.checkpw
    seen = _Checks()

    def counting(candidate, stored):
        if isinstance(stored, (bytes, bytearray)) and bytes(stored).startswith(b"$2") and len(stored) == 60:
            seen.append(bytes(stored[:7]))
            seen.threads.append(threading.get_ident())
        return real(candidate, stored)

    monkeypatch.setattr(bcrypt, "checkpw", counting)
    return seen


def cost_prefix() -> bytes:
    return auth.hash_password(PASSWORD).encode("utf-8")[:7]


async def rejected_states(flow) -> dict[str, str]:
    """Je Zustand eine E-Mail, mit der die Anmeldung mit falschem Passwort scheitert."""
    known = await account(flow)
    legacy = await account(flow, password_hash=bcrypt.hashpw(PASSWORD.encode("utf-8"), bcrypt.gensalt()).decode("utf-8"))
    await flow.db.users.update_one({"id": legacy["id"]}, {"$unset": {"password_contract": ""}})
    banned = await account(flow, is_banned=True)
    inactive = await account(flow, is_active=False)
    unverified = await account(flow, email_verified=False)
    invited = await account(flow, password_hash="!pending_invite", password_setup_required=True)
    reinvited = await account(flow, password_setup_required=True)
    without_hash = await account(flow)
    await flow.db.users.update_one({"id": without_hash["id"]}, {"$unset": {"password_hash": "", "password_contract": ""}})
    return {
        "kein Konto": f"niemand-{new_id()[:6]}@example.com",
        "falsches Passwort": known["email"],
        "Konto von vor dem Vertrag": legacy["email"],
        "gesperrt": banned["email"],
        "deaktiviert": inactive["email"],
        "E-Mail unbestätigt": unverified["email"],
        "Einladung offen": invited["email"],
        "Einladung erneut": reinvited["email"],
        "ohne Passwort": without_hash["email"],
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("path", LOGIN_PATHS)
@pytest.mark.parametrize("attempt", [WRONG, "x" * 100, WRONG_DECOMPOSED], ids=["kurz", "lang", "zerlegt"])
async def test_a_rejected_sign_in_looks_the_same_in_every_account_state(flow, hash_checks, path, attempt):
    answers = {}
    expected = [cost_prefix()] * auth.password_work(attempt)
    loop_thread = threading.get_ident()
    for state, email in (await rejected_states(flow)).items():
        hash_checks.clear()
        hash_checks.threads.clear()
        response = await flow.post(path, json={"email": email, "password": attempt})
        answers[state] = (response.status_code, response.json())
        assert hash_checks == expected, f"{state}: dieselbe Zahl vollwertiger Vergleiche mit denselben Kosten"
        assert loop_thread not in hash_checks.threads, f"{state}: bcrypt läuft nicht im Event-Loop"
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

    # Gegenprobe: erst wer das richtige Passwort kennt, erfährt, warum es nicht weitergeht.
    for fields, part in (({"password_setup_required": True}, "Einladungslink"), ({"is_banned": True}, "gesperrt"),
                         ({"is_active": False}, "deaktiviert"), ({"email_verified": False}, "nicht bestätigt")):
        holder = await account(flow, **fields)
        response = await flow.post(path, json={"email": holder["email"], "password": PASSWORD})
        assert response.status_code == 403 and part in response.json()["detail"], fields


def per_address_limit() -> int:
    from routes import auth_routes

    assert auth_routes.LOGIN_PER_IP_PER_MINUTE >= 30, "großzügig genug für viele Geräte hinter einem Anschluss"
    return auth_routes.LOGIN_PER_IP_PER_MINUTE


@pytest.mark.asyncio
@pytest.mark.parametrize("path", LOGIN_PATHS)
async def test_sign_in_is_limited_per_address_before_any_password_check(flow, hash_checks, path, monkeypatch):
    from datetime import datetime, timezone

    from services import rate_limit

    class Frozen(datetime):
        """Die Uhr steht mitten in einem Fenster - sonst kippt der Test, wenn er über eine Minutengrenze läuft."""

        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 14, 12, 0, 30, tzinfo=timezone.utc)

    monkeypatch.setattr(rate_limit, "datetime", Frozen)
    known = await account(flow)
    for number in range(per_address_limit()):
        response = await flow.post(path, json={"email": f"niemand-{number}@example.com", "password": WRONG})
        assert response.status_code == 401, number
    hash_checks.clear()
    for email in (f"niemand-{new_id()[:6]}@example.com", known["email"]):
        for password in (WRONG, PASSWORD):
            response = await flow.post(path, json={"email": email, "password": password})
            assert response.status_code == 429, (email, password)
    assert list(hash_checks) == [], "über der Grenze wird kein Passwort mehr geprüft"


@pytest.mark.asyncio
async def test_password_checks_run_in_a_bounded_pool(monkeypatch):
    state = {"active": 0, "peak": 0}
    threads = set()
    lock = threading.Lock()

    def slow(candidate, stored):
        with lock:
            state["active"] += 1
            state["peak"] = max(state["peak"], state["active"])
            threads.add(threading.get_ident())
        time.sleep(0.05)
        with lock:
            state["active"] -= 1
        return False

    auth._stand_in_hash()
    monkeypatch.setattr(bcrypt, "checkpw", slow)
    count = auth.PASSWORD_WORKERS * 3
    results = await asyncio.gather(*(auth.verify_and_upgrade_password(None, None, WRONG) for _ in range(count)))
    assert results == [False] * count
    assert 1 < state["peak"] <= auth.PASSWORD_WORKERS, state
    assert threading.get_ident() not in threads


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


PASSWORD_CHECKS = {"verify_user_password", "verify_user_password_async", "verify_and_upgrade_password", "verify_password"}
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
