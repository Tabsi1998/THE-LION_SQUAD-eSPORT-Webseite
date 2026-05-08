"""JWT auth helpers + password hashing + role deps."""
import os
import bcrypt
import jwt
import hashlib
import secrets
from urllib.parse import urlparse
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException, Request, Depends, Response
from database import get_db

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = 60 * 12  # 12h
REFRESH_TOKEN_DAYS = 14
CSRF_TOKEN_BYTES = 32

# Hierarchy for role checks (higher number = more permissions)
ROLE_LEVELS = {
    "player": 1,
    "team_leader": 2,
    "moderator": 3,
    "tournament_admin": 4,
    "club_admin": 5,
    "superadmin": 10,
}


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINUTES),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str, token_id: str) -> str:
    payload = {
        "sub": user_id,
        "jti": token_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS),
        "type": "refresh",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def refresh_expires_at() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_csrf_token() -> str:
    return secrets.token_urlsafe(CSRF_TOKEN_BYTES)


def _secure_cookies() -> bool:
    """Use Secure cookies when served behind HTTPS (preview / production)."""
    fu = os.environ.get("FRONTEND_URL", "")
    return fu.startswith("https://")


def _cookie_domain() -> str | None:
    explicit = os.environ.get("AUTH_COOKIE_DOMAIN", "").strip()
    if explicit:
        return explicit if explicit.startswith(".") else f".{explicit}"
    host = urlparse(os.environ.get("FRONTEND_URL", "")).hostname or ""
    host = host.lower().strip(".")
    if not host or host in {"localhost", "127.0.0.1"} or host.endswith(".local"):
        return None
    if host.startswith("www."):
        host = host[4:]
    parts = host.split(".")
    if len(parts) >= 2:
        return "." + ".".join(parts[-2:])
    return None


def set_auth_cookies(response: Response, access: str, refresh: str, csrf_token: str | None = None):
    secure = _secure_cookies()
    # When on HTTPS (cross-site scenarios behind CDN), use SameSite=None + Secure.
    # When purely local HTTP, use SameSite=Lax.
    samesite = "none" if secure else "lax"
    csrf_token = csrf_token or new_csrf_token()
    domain = _cookie_domain()
    response.set_cookie(
        "access_token", access, httponly=True, secure=secure, samesite=samesite,
        max_age=ACCESS_TOKEN_MINUTES * 60, path="/", domain=domain,
    )
    response.set_cookie(
        "refresh_token", refresh, httponly=True, secure=secure, samesite=samesite,
        max_age=REFRESH_TOKEN_DAYS * 24 * 3600, path="/", domain=domain,
    )
    response.set_cookie(
        "csrf_token", csrf_token, httponly=False, secure=secure, samesite=samesite,
        max_age=REFRESH_TOKEN_DAYS * 24 * 3600, path="/", domain=domain,
    )


def clear_auth_cookies(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    response.delete_cookie("csrf_token", path="/")
    domain = _cookie_domain()
    if domain:
        response.delete_cookie("access_token", path="/", domain=domain)
        response.delete_cookie("refresh_token", path="/", domain=domain)
        response.delete_cookie("csrf_token", path="/", domain=domain)


def _decode(token: str) -> dict:
    try:
        return jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def _extract_token(request: Request) -> str | None:
    tok = request.cookies.get("access_token")
    if tok:
        return tok
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


async def get_current_user(request: Request) -> dict:
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = _decode(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    db = get_db()
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.get("is_banned"):
        raise HTTPException(status_code=403, detail="Account is banned")
    # Attach membership for downstream guards / UI
    membership = await db.memberships.find_one({"user_id": user["id"]}, {"_id": 0})
    user["membership"] = membership
    user["is_club_member"] = bool(membership and membership.get("member_status") in ("active", "honorary"))
    if user["is_club_member"]:
        user["user_type"] = "club_member"
    elif not user.get("user_type"):
        user["user_type"] = "community_user"
    user["is_tournament_staff"] = bool(
        user.get("role") in {"moderator", "tournament_admin", "club_admin", "superadmin"}
        or await db.tournament_staff_assignments.count_documents({
            "user_id": user["id"],
            "is_active": {"$ne": False},
        })
    )
    return user


async def get_optional_user(request: Request) -> dict | None:
    try:
        return await get_current_user(request)
    except HTTPException:
        return None


def require_role(*allowed_roles: str):
    """Returns a FastAPI dependency that ensures user has one of the allowed roles."""
    async def dep(user: dict = Depends(get_current_user)) -> dict:
        user_level = ROLE_LEVELS.get(user.get("role", "player"), 0)
        if user.get("role") in allowed_roles:
            return user
        # Also allow higher-level roles
        for r in allowed_roles:
            if user_level >= ROLE_LEVELS.get(r, 99):
                return user
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return dep


def require_club_member():
    """Active club member only — admins are also allowed."""
    async def dep(user: dict = Depends(get_current_user)) -> dict:
        # Admins always pass
        admin_roles = {"moderator", "tournament_admin", "club_admin", "superadmin"}
        if user.get("role") in admin_roles:
            return user
        if user.get("is_club_member"):
            return user
        raise HTTPException(status_code=403, detail="Nur Vereinsmitglieder.")
    return dep


def require_admin():
    """Admin = tournament_admin | club_admin | superadmin."""
    return require_role("tournament_admin", "club_admin", "superadmin")


def require_super():
    return require_role("superadmin")
