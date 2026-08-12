"""Browser request checks for cookie-authenticated API mutations."""
from __future__ import annotations

import secrets
from collections.abc import Collection
from urllib.parse import urlparse


UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def normalize_origin(value: str | None) -> str:
    raw = str(value or "").strip()
    if not raw or raw.lower() == "null":
        return ""
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return ""
    host = parsed.hostname.lower().rstrip(".")
    default_port = 443 if parsed.scheme == "https" else 80
    try:
        parsed_port = parsed.port
    except ValueError:
        return ""
    port = f":{parsed_port}" if parsed_port and parsed_port != default_port else ""
    return f"{parsed.scheme}://{host}{port}"


def csrf_rejection_detail(
    request,
    allowed_origins: Collection[str],
    exempt_paths: Collection[str],
) -> str | None:
    """Return a safe error detail or ``None`` when the request may proceed."""
    method = str(request.method or "").upper()
    path = request.url.path
    if method not in UNSAFE_METHODS or not path.startswith("/api/"):
        return None

    fetch_site = str(request.headers.get("sec-fetch-site", "")).strip().lower()
    if fetch_site == "cross-site":
        return "Untrusted request origin"

    origin_header = request.headers.get("origin")
    if origin_header is not None:
        origin = normalize_origin(origin_header)
        trusted = {normalize_origin(value) for value in allowed_origins}
        trusted.discard("")
        if not origin or origin not in trusted:
            return "Untrusted request origin"

    if path in exempt_paths:
        return None
    has_auth_cookie = bool(
        request.cookies.get("access_token") or request.cookies.get("refresh_token")
    )
    if not has_auth_cookie:
        return None
    cookie_token = request.cookies.get("csrf_token")
    header_token = request.headers.get("x-csrf-token")
    if (
        not cookie_token
        or not header_token
        or not secrets.compare_digest(str(cookie_token), str(header_token))
    ):
        return "CSRF token missing or invalid"
    return None
