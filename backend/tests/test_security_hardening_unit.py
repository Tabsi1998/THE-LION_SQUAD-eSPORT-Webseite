"""Focused regressions for Package 2 security hardening."""
import logging
from pathlib import Path
import runpy
import sys
import types

import pytest


def test_scheduler_failure_log_excludes_exception_payload(caplog):
    from services.scheduler import _log_task_failure

    caplog.set_level(logging.ERROR, logger="tls.scheduler")
    _log_task_failure("birthday_greetings", RuntimeError("private-user@example.test token=secret"))

    message = caplog.text
    assert "birthday_greetings" in message
    assert "RuntimeError" in message
    assert "private-user@example.test" not in message
    assert "token=secret" not in message


def test_setup_requires_preconfigured_non_placeholder_jwt(monkeypatch):
    from setup_cli import require_jwt_secret

    monkeypatch.delenv("JWT_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="sicher gesetzt"):
        require_jwt_secret()

    monkeypatch.setenv("JWT_SECRET", "change-me-change-me-change-me-change-me")
    with pytest.raises(RuntimeError, match="sicher gesetzt"):
        require_jwt_secret()

    value = "package-two-realistic-secret-value-1234567890"
    monkeypatch.setenv("JWT_SECRET", value)
    assert require_jwt_secret() == value


def test_entrypoint_uses_owner_only_upload_permissions(monkeypatch):
    fake_pwd = types.SimpleNamespace(struct_passwd=object)
    monkeypatch.setitem(sys.modules, "pwd", fake_pwd)
    entrypoint = runpy.run_path(str(Path(__file__).resolve().parents[1] / "docker-entrypoint.py"))

    assert entrypoint["DIRECTORY_MODE"] == 0o700
    assert entrypoint["FILE_MODE"] == 0o600
