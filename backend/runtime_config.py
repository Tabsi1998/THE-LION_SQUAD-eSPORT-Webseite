"""Fail-closed runtime configuration shared by API and maintenance commands."""
from __future__ import annotations

import os
from collections.abc import Mapping
from ipaddress import ip_network
from urllib.parse import urlparse


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
LOCAL_HTTP_HOSTS = ("localhost", "127.0.0.1", "[::1]", "backend")


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


def trusted_proxy_cidrs(environ: Mapping[str, str] | None = None) -> tuple[str, ...]:
    """Return validated proxy IPs/networks accepted by Uvicorn."""
    source = environ if environ is not None else os.environ
    if not env_flag("TRUST_PROXY_HEADERS", source):
        return ()

    raw_values = str(source.get("TRUSTED_PROXY_CIDRS", "")).split(",")
    values: list[str] = []
    for raw in raw_values:
        value = raw.strip()
        if not value:
            continue
        if value == "*":
            raise RuntimeError("TRUSTED_PROXY_CIDRS must never trust every source.")
        try:
            network = ip_network(value, strict=False)
        except ValueError as exc:
            raise RuntimeError(f"Invalid trusted proxy IP/network: {value!r}.") from exc
        if network.prefixlen == 0:
            raise RuntimeError("TRUSTED_PROXY_CIDRS must never include a default route.")
        normalized = str(network)
        if normalized not in values:
            values.append(normalized)
    if not values:
        raise RuntimeError(
            "TRUST_PROXY_HEADERS=true requires explicit TRUSTED_PROXY_CIDRS."
        )
    return tuple(values)


def trusted_http_hosts(environ: Mapping[str, str] | None = None) -> tuple[str, ...]:
    """Build the public/internal Host allowlist without accepting wildcards in production."""
    source = environ if environ is not None else os.environ
    app_env = resolve_app_environment(source)
    configured = [
        value.strip().lower().rstrip(".")
        for value in str(source.get("TRUSTED_HOSTS", "")).split(",")
        if value.strip()
    ]
    if "*" in configured and app_env == "production":
        raise RuntimeError("TRUSTED_HOSTS='*' is not allowed in production.")

    hosts = list(configured)
    for raw_url in (
        str(source.get("FRONTEND_URL", "")),
        *str(source.get("CORS_ORIGINS", "")).split(","),
    ):
        value = raw_url.strip()
        if not value or value == "*":
            continue
        parsed = urlparse(value if "://" in value else f"https://{value}")
        host = (parsed.hostname or "").lower().rstrip(".")
        if host and host not in hosts:
            hosts.append(host)

    for host in LOCAL_HTTP_HOSTS:
        if host not in hosts:
            hosts.append(host)
    return tuple(hosts)


def validate_runtime_environment(environ: Mapping[str, str] | None = None) -> str:
    source = environ if environ is not None else os.environ
    app_env = resolve_app_environment(source)

    if env_flag("TLS_RESET", source):
        raise RuntimeError(
            "TLS_RESET is not supported by the API process. Use reset_data.py in an explicit non-production environment."
        )

    trusted_proxy_cidrs(source)
    trusted_http_hosts(source)

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
