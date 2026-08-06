import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import seed
from runtime_config import resolve_app_environment, validate_runtime_environment


def test_app_environment_must_be_explicit():
    with pytest.raises(RuntimeError, match="APP_ENV must be set explicitly"):
        resolve_app_environment({})


def test_app_environment_rejects_unknown_value():
    with pytest.raises(RuntimeError, match="Unsupported APP_ENV"):
        resolve_app_environment({"APP_ENV": "prodution"})


def test_production_rejects_demo_and_reset_flags():
    base = {
        "APP_ENV": "production",
        "JWT_SECRET": "a" * 48,
        "FRONTEND_URL": "https://lionsquad.at",
    }
    with pytest.raises(RuntimeError, match="TLS_RESET"):
        validate_runtime_environment({**base, "TLS_RESET": "true"})
    with pytest.raises(RuntimeError, match="Demo seeding"):
        validate_runtime_environment({**base, "SEED_DEMO": "true"})


def test_development_still_rejects_api_reset_flag():
    with pytest.raises(RuntimeError, match="not supported by the API process"):
        validate_runtime_environment({"APP_ENV": "development", "TLS_RESET": "true"})


def test_admin_bootstrap_never_changes_existing_superadmin(monkeypatch):
    users = SimpleNamespace(
        find_one=AsyncMock(return_value={"id": "existing"}),
        insert_one=AsyncMock(),
    )
    memberships = SimpleNamespace(insert_one=AsyncMock())
    monkeypatch.setattr(seed, "get_db", lambda: SimpleNamespace(users=users, memberships=memberships))

    created = asyncio.run(seed.seed_admin("new-admin@example.com", "long-test-password"))

    assert created is False
    users.insert_one.assert_not_awaited()
    memberships.insert_one.assert_not_awaited()


def test_admin_bootstrap_refuses_to_promote_email_collision(monkeypatch):
    users = SimpleNamespace(
        find_one=AsyncMock(side_effect=[None, {"id": "ordinary-user"}]),
        insert_one=AsyncMock(),
    )
    memberships = SimpleNamespace(insert_one=AsyncMock())
    monkeypatch.setattr(seed, "get_db", lambda: SimpleNamespace(users=users, memberships=memberships))

    with pytest.raises(RuntimeError, match="non-superadmin"):
        asyncio.run(seed.seed_admin("member@example.com", "long-test-password"))

    users.insert_one.assert_not_awaited()


def test_admin_bootstrap_creates_once_without_logging_password(monkeypatch):
    users = SimpleNamespace(
        find_one=AsyncMock(side_effect=[None, None]),
        insert_one=AsyncMock(),
    )
    memberships = SimpleNamespace(insert_one=AsyncMock())
    monkeypatch.setattr(seed, "get_db", lambda: SimpleNamespace(users=users, memberships=memberships))
    monkeypatch.setattr(seed, "hash_password", lambda value: f"hash:{len(value)}")

    created = asyncio.run(seed.seed_admin("First.Admin@Example.com", "long-test-password"))

    assert created is True
    user = users.insert_one.await_args.args[0]
    assert user["email"] == "first.admin@example.com"
    assert user["password_hash"] == "hash:18"
    assert user["role"] == "superadmin"
    memberships.insert_one.assert_awaited_once()
