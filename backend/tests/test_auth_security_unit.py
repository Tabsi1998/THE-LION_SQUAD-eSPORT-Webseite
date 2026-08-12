import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import jwt
import pytest
from fastapi import HTTPException, Response
from pymongo.errors import DuplicateKeyError

from auth import (
    JWT_ALGORITHM,
    create_access_token,
    create_refresh_token,
    get_jwt_secret,
    get_current_user,
    hash_token,
    refresh_expires_at,
    set_auth_cookies,
)
from routes.auth_routes import _rotate_session
from services.csrf import csrf_rejection_detail, normalize_origin


class _Documents:
    def __init__(self, documents=None):
        self.documents = [deepcopy(document) for document in (documents or [])]
        self.lock = asyncio.Lock()

    @staticmethod
    def _matches(document, query):
        for key, expected in query.items():
            if key == "$or":
                if not any(_Documents._matches(document, branch) for branch in expected):
                    return False
                continue
            actual = document.get(key)
            if isinstance(expected, dict) and "$ne" in expected:
                if actual == expected["$ne"]:
                    return False
            elif actual != expected:
                return False
        return True

    async def insert_one(self, document):
        async with self.lock:
            if any(
                row.get("id") == document.get("id") or row.get("jti") == document.get("jti")
                for row in self.documents
            ):
                raise DuplicateKeyError("duplicate session")
            self.documents.append(deepcopy(document))

    async def find_one(self, query, *_args, **_kwargs):
        async with self.lock:
            for document in self.documents:
                if self._matches(document, query):
                    return deepcopy(document)
        return None

    async def find_one_and_update(self, query, update, **_kwargs):
        async with self.lock:
            for document in self.documents:
                if self._matches(document, query):
                    before = deepcopy(document)
                    document.update(deepcopy(update["$set"]))
                    return before
        return None

    async def update_one(self, query, update):
        async with self.lock:
            for document in self.documents:
                if self._matches(document, query):
                    document.update(deepcopy(update["$set"]))
                    return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)

    async def update_many(self, query, update):
        matched = 0
        async with self.lock:
            for document in self.documents:
                if self._matches(document, query):
                    document.update(deepcopy(update["$set"]))
                    matched += 1
        return SimpleNamespace(modified_count=matched)


class _Users:
    def __init__(self, user):
        self.user = deepcopy(user)

    async def find_one(self, query, *_args, **_kwargs):
        if self.user and self.user.get("id") == query.get("id"):
            return deepcopy(self.user)
        return None


def _request(*, access="", refresh="", csrf="", origin=None, fetch_site=None, user_agent="browser-a"):
    headers = {"user-agent": user_agent}
    if csrf:
        headers["x-csrf-token"] = csrf
    if origin is not None:
        headers["origin"] = origin
    if fetch_site is not None:
        headers["sec-fetch-site"] = fetch_site
    return SimpleNamespace(
        method="POST",
        url=SimpleNamespace(path="/api/auth/refresh"),
        headers=headers,
        cookies={
            key: value
            for key, value in {
                "access_token": access,
                "refresh_token": refresh,
                "csrf_token": csrf,
            }.items()
            if value
        },
        client=SimpleNamespace(host="198.51.100.10"),
    )


@pytest.fixture(autouse=True)
def _jwt_secret(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "unit-test-auth-secret-that-is-long-enough")


def test_https_auth_cookies_are_lax_secure_and_shared_across_canonical_hosts(monkeypatch):
    monkeypatch.setenv("FRONTEND_URL", "https://lionsquad.at")
    monkeypatch.setenv("AUTH_COOKIE_DOMAIN", ".lionsquad.at")
    response = Response()

    set_auth_cookies(response, "access", "refresh", "csrf")

    cookies = [
        value.decode("latin-1")
        for name, value in response.raw_headers
        if name.lower() == b"set-cookie"
    ]
    assert len(cookies) == 3
    assert all("Domain=.lionsquad.at" in value for value in cookies)
    assert all("SameSite=lax" in value for value in cookies)
    assert all("Secure" in value for value in cookies)
    assert "HttpOnly" in cookies[0] and "HttpOnly" in cookies[1]
    assert "HttpOnly" not in cookies[2]


def test_cookie_domain_must_match_frontend_host(monkeypatch):
    monkeypatch.setenv("FRONTEND_URL", "https://lionsquad.at")
    monkeypatch.setenv("AUTH_COOKIE_DOMAIN", ".attacker.example")

    with pytest.raises(RuntimeError, match="must contain"):
        set_auth_cookies(Response(), "access", "refresh", "csrf")


def test_csrf_checks_origin_fetch_metadata_and_refresh_token_pair():
    allowed = {"https://lionsquad.at", "https://www.lionsquad.at"}
    exempt = {"/api/auth/login"}
    request = _request(refresh="refresh", csrf="same", origin="https://www.lionsquad.at")

    assert csrf_rejection_detail(request, allowed, exempt) is None
    request.headers["x-csrf-token"] = "different"
    assert csrf_rejection_detail(request, allowed, exempt) == "CSRF token missing or invalid"
    request.headers["origin"] = "https://attacker.example"
    assert csrf_rejection_detail(request, allowed, exempt) == "Untrusted request origin"
    request.headers.pop("origin")
    request.headers["sec-fetch-site"] = "cross-site"
    assert csrf_rejection_detail(request, allowed, exempt) == "Untrusted request origin"


def test_cross_site_login_is_rejected_even_when_path_is_csrf_exempt():
    request = _request(origin="https://attacker.example")
    request.url.path = "/api/auth/login"

    assert csrf_rejection_detail(
        request,
        {"https://lionsquad.at"},
        {"/api/auth/login"},
    ) == "Untrusted request origin"
    assert normalize_origin("https://LIONSQUAD.AT:443/") == "https://lionsquad.at"
    assert normalize_origin("https://lionsquad.at:invalid") == ""


def test_parallel_refresh_replays_return_one_deterministic_successor():
    async def scenario():
        user = {
            "id": "user-1",
            "email": "player@example.test",
            "role": "player",
            "is_active": True,
        }
        old_jti = "old-session"
        expiry = refresh_expires_at()
        old_token = create_refresh_token(user["id"], old_jti, old_jti, expiry)
        sessions = _Documents([{
            "id": "old-record",
            "jti": old_jti,
            "family_id": old_jti,
            "user_id": user["id"],
            "token_hash": hash_token(old_token),
            "revoked": False,
            "expires_at": expiry,
        }])
        db = SimpleNamespace(refresh_tokens=sessions, users=_Users(user))
        request = _request(refresh=old_token)

        first, second = await asyncio.gather(
            _rotate_session(db, old_token, request),
            _rotate_session(db, old_token, request),
        )

        assert first[2] == second[2]
        replacement = jwt.decode(first[2], get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        assert replacement["fid"] == old_jti
        active = [row for row in sessions.documents if row.get("revoked") is not True]
        assert [row["jti"] for row in active] == [replacement["jti"]]
        for result in (first, second):
            access = jwt.decode(result[1], get_jwt_secret(), algorithms=[JWT_ALGORITHM])
            assert access["sid"] == replacement["jti"]

    asyncio.run(scenario())


def test_legacy_refresh_token_is_migrated_into_a_session_family():
    async def scenario():
        user = {
            "id": "user-1",
            "email": "player@example.test",
            "role": "player",
            "is_active": True,
        }
        expiry = refresh_expires_at()
        legacy_token = jwt.encode({
            "sub": user["id"],
            "jti": "legacy-session",
            "exp": expiry,
            "type": "refresh",
        }, get_jwt_secret(), algorithm=JWT_ALGORITHM)
        sessions = _Documents([{
            "id": "legacy-record",
            "jti": "legacy-session",
            "user_id": user["id"],
            "token_hash": hash_token(legacy_token),
            "revoked": False,
            "expires_at": expiry,
        }])
        db = SimpleNamespace(refresh_tokens=sessions, users=_Users(user))

        _user, access, refresh = await _rotate_session(db, legacy_token, _request(refresh=legacy_token))

        refresh_payload = jwt.decode(refresh, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        access_payload = jwt.decode(access, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        assert refresh_payload["fid"] == "legacy-session"
        assert access_payload["sid"] == refresh_payload["jti"]

    asyncio.run(scenario())


def test_refresh_reuse_outside_the_same_client_grace_revokes_only_that_family():
    async def scenario():
        user = {
            "id": "user-1",
            "email": "player@example.test",
            "role": "player",
            "is_active": True,
        }
        expiry = refresh_expires_at()
        token = create_refresh_token(user["id"], "family-a", "family-a", expiry)
        sessions = _Documents([
            {
                "id": "family-a-old",
                "jti": "family-a",
                "family_id": "family-a",
                "user_id": user["id"],
                "token_hash": hash_token(token),
                "revoked": False,
                "expires_at": expiry,
            },
            {
                "id": "family-b-active",
                "jti": "family-b",
                "family_id": "family-b",
                "user_id": user["id"],
                "token_hash": "other",
                "revoked": False,
                "expires_at": expiry,
            },
        ])
        db = SimpleNamespace(refresh_tokens=sessions, users=_Users(user))
        await _rotate_session(db, token, _request(refresh=token, user_agent="browser-a"))

        with pytest.raises(HTTPException) as exc:
            await _rotate_session(db, token, _request(refresh=token, user_agent="browser-b"))

        assert exc.value.status_code == 401
        family_a = [row for row in sessions.documents if row.get("family_id") == "family-a"]
        family_b = [row for row in sessions.documents if row.get("family_id") == "family-b"]
        assert family_a and all(row.get("revoked") is True for row in family_a)
        assert family_b[0].get("revoked") is False

    asyncio.run(scenario())


def test_access_token_is_rejected_after_its_session_is_revoked(monkeypatch):
    async def scenario():
        expiry = datetime.now(timezone.utc) + timedelta(days=1)
        session = {"jti": "session-1", "user_id": "user-1", "expires_at": expiry}
        db = SimpleNamespace(
            refresh_tokens=SimpleNamespace(find_one=AsyncMock(return_value=session)),
            users=SimpleNamespace(find_one=AsyncMock(return_value={
                "id": "user-1", "role": "player", "is_active": True,
            })),
            memberships=SimpleNamespace(find_one=AsyncMock(return_value=None)),
            tournament_staff_assignments=SimpleNamespace(count_documents=AsyncMock(return_value=0)),
        )
        monkeypatch.setattr("auth.get_db", lambda: db)
        token = create_access_token("user-1", "player@example.test", "player", "session-1")
        request = SimpleNamespace(cookies={"access_token": token}, headers={})

        assert (await get_current_user(request))["id"] == "user-1"
        db.refresh_tokens.find_one.return_value = None
        with pytest.raises(HTTPException) as exc:
            await get_current_user(request)
        assert exc.value.status_code == 401
        assert exc.value.detail == "Session expired"

    asyncio.run(scenario())


def test_inactive_account_is_rejected_at_the_authenticated_boundary(monkeypatch):
    async def scenario():
        db = SimpleNamespace(
            refresh_tokens=SimpleNamespace(find_one=AsyncMock(return_value={
                "jti": "session-1",
                "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            })),
            users=SimpleNamespace(find_one=AsyncMock(return_value={
                "id": "user-1", "role": "player", "is_active": False,
            })),
        )
        monkeypatch.setattr("auth.get_db", lambda: db)
        token = create_access_token("user-1", "player@example.test", "player", "session-1")

        with pytest.raises(HTTPException) as exc:
            await get_current_user(SimpleNamespace(cookies={"access_token": token}, headers={}))
        assert exc.value.status_code == 403
        assert exc.value.detail == "Account is inactive"

    asyncio.run(scenario())
