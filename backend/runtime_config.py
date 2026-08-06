"""Fail-closed runtime configuration shared by API and maintenance commands."""
from __future__ import annotations

import os
from collections.abc import Mapping


ENV_ALIASES = {
    "dev": "development",
    "development": "development",
    "test": "test",
    "testing": "test",
    "prod": "production",
    "production": "production",
}
PLACEHOLDER_SECRET_MARKERS = {
    "change-me",
    "changeme",
    "generate-with",
    "example",
    "replace-me",
}
TRUE_VALUES = {"1", "true", "yes", "on"}


def env_flag(name: str, environ: Mapping[str, str] | None = None) -> bool:
    source = environ if environ is not None else os.environ
    return str(source.get(name, "")).strip().lower() in TRUE_VALUES


def resolve_app_environment(environ: Mapping[str, str] | None = None) -> str:
    source = environ if environ is not None else os.environ
    raw = str(source.get("APP_ENV", "")).strip().lower()
    if not raw:
        raise RuntimeError(
            "APP_ENV must be set explicitly to development, test, or production."
        )
    resolved = ENV_ALIASES.get(raw)
    if not resolved:
        allowed = ", ".join(sorted(ENV_ALIASES))
        raise RuntimeError(f"Unsupported APP_ENV={raw!r}. Allowed values: {allowed}.")
    return resolved


def is_placeholder_secret(value: str) -> bool:
    normalized = str(value or "").strip().lower()
    return not normalized or any(marker in normalized for marker in PLACEHOLDER_SECRET_MARKERS)


def validate_runtime_environment(environ: Mapping[str, str] | None = None) -> str:
    source = environ if environ is not None else os.environ
    app_env = resolve_app_environment(source)

    if env_flag("TLS_RESET", source):
        raise RuntimeError(
            "TLS_RESET is not supported by the API process. Use reset_data.py in an explicit non-production environment."
        )

    if app_env != "production":
        return app_env

    jwt_secret = str(source.get("JWT_SECRET", ""))
    if len(jwt_secret) < 32 or is_placeholder_secret(jwt_secret):
        raise RuntimeError("JWT_SECRET must be a real secret with at least 32 characters in production.")
    if not str(source.get("FRONTEND_URL", "")).strip():
        raise RuntimeError("FRONTEND_URL must be set in production.")
    if env_flag("ALLOW_INSECURE_CORS", source):
        raise RuntimeError("ALLOW_INSECURE_CORS is blocked in production.")
    if env_flag("SEED_DEMO", source) or env_flag("SEED_GAME_SERVERS", source):
        raise RuntimeError("Demo seeding is blocked in production and must never run in the API process.")
    return app_env
