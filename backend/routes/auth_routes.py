"""Authentication routes."""
import os
import secrets
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Response, Request, HTTPException, Depends
from database import get_db
from auth import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    set_auth_cookies, clear_auth_cookies, get_current_user, _decode,
    hash_token, refresh_expires_at,
)
from email_service import send_template
from models import (
    UserRegister, UserLogin, ForgotPasswordBody, ResetPasswordBody, ChangePasswordBody,
    now_utc, new_id,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

BRUTE_FORCE_MAX = 7
BRUTE_FORCE_WINDOW_MIN = 15


async def _check_brute_force(db, identifier: str):
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=BRUTE_FORCE_WINDOW_MIN)
    count = await db.login_attempts.count_documents({
        "identifier": identifier,
        "created_at": {"$gte": cutoff},
    })
    if count >= BRUTE_FORCE_MAX:
        raise HTTPException(
            status_code=429,
            detail="Zu viele Loginversuche. Bitte in 15 Minuten erneut versuchen."
        )


def _client_identifier(request: Request, email: str) -> str:
    """Key brute-force counter by X-Forwarded-For (first hop) to survive behind proxies,
    fall back to direct client host + email."""
    xff = request.headers.get("x-forwarded-for", "")
    first = xff.split(",")[0].strip() if xff else ""
    ip = first or (request.client.host if request.client else "unknown")
    return f"{ip}:{email}"


async def _record_failed(db, identifier: str):
    await db.login_attempts.insert_one({
        "id": new_id(),
        "identifier": identifier,
        "created_at": datetime.now(timezone.utc),
    })


async def _clear_failed(db, identifier: str):
    await db.login_attempts.delete_many({"identifier": identifier})


async def _issue_session(db, response: Response, user: dict, request: Request):
    access = create_access_token(user["id"], user["email"], user.get("role", "player"))
    token_id = secrets.token_urlsafe(24)
    refresh = create_refresh_token(user["id"], token_id)
    await db.refresh_tokens.insert_one({
        "id": new_id(),
        "jti": token_id,
        "user_id": user["id"],
        "token_hash": hash_token(refresh),
        "revoked": False,
        "created_at": now_utc(),
        "expires_at": refresh_expires_at(),
        "user_agent": request.headers.get("user-agent"),
        "ip": request.headers.get("x-forwarded-for", "").split(",")[0].strip()
              or (request.client.host if request.client else None),
    })
    set_auth_cookies(response, access, refresh)


async def _revoke_refresh(db, token: str):
    try:
        payload = _decode(token)
    except HTTPException:
        return
    token_id = payload.get("jti")
    if not token_id:
        return
    await db.refresh_tokens.update_one(
        {"jti": token_id, "token_hash": hash_token(token)},
        {"$set": {"revoked": True, "revoked_at": now_utc()}},
    )


@router.post("/register")
async def register(body: UserRegister, request: Request, response: Response):
    db = get_db()
    if not body.accept_privacy or not body.accept_terms:
        raise HTTPException(status_code=400, detail="Datenschutz und Nutzungsbedingungen müssen akzeptiert werden.")
    email = body.email.lower().strip()
    username = body.username.strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="E-Mail bereits registriert")
    if await db.users.find_one({"username": username}):
        raise HTTPException(status_code=409, detail="Benutzername bereits vergeben")
    user_id = new_id()
    user_doc = {
        "id": user_id,
        "email": email,
        "username": username,
        "password_hash": hash_password(body.password),
        "display_name": body.display_name or username,
        "avatar_url": None, "banner_url": None,
        "role": "player",
        "roles": ["player"],
        "user_type": "community_user",
        "is_club_member": False,
        "discord_name": body.discord_name, "discord_id": None,
        "switch_code": None, "steam_id": None, "epic_id": None,
        "psn_id": None, "xbox_id": None, "riot_id": None,
        "twitch_handle": None, "youtube_handle": None, "tiktok_handle": None,
        "instagram_handle": None, "x_handle": None, "nintendo_fc": None,
        "ea_id": None, "battlenet_id": None, "website": None,
        "country": None, "state": None, "city": None,
        "first_name": None, "last_name": None, "nickname": None,
        "birth_date": body.birth_date,
        "favorite_games": [],
        "main_platform": None, "preferred_role": None, "input_device": None,
        "privacy_public_profile": True,
        "profile_visibility": {},
        "bio": None,
        "is_active": True, "is_banned": False, "email_verified": False,
        "accepted_privacy": body.accept_privacy,
        "accepted_terms": body.accept_terms,
        "newsletter_consent": body.newsletter_consent,
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    await db.users.insert_one(user_doc)
    await _issue_session(db, response, user_doc, request)
    # Send welcome email (silent fail if not configured)
    await send_template("registration", email, display_name=user_doc["display_name"])
    user_doc.pop("_id", None)
    user_doc.pop("password_hash", None)
    return user_doc


@router.post("/login")
async def login(body: UserLogin, request: Request, response: Response):
    db = get_db()
    email = body.email.lower().strip()
    identifier = _client_identifier(request, email)
    await _check_brute_force(db, identifier)

    user = await db.users.find_one({"email": email})
    if user and user.get("password_setup_required"):
        await _record_failed(db, identifier)
        raise HTTPException(status_code=403, detail="Bitte zuerst den Einladungslink verwenden und ein Passwort erstellen.")
    if not user or not verify_password(body.password, user["password_hash"]):
        await _record_failed(db, identifier)
        raise HTTPException(status_code=401, detail="Ungültige Zugangsdaten")
    if user.get("is_banned"):
        raise HTTPException(status_code=403, detail="Account gesperrt")

    await _clear_failed(db, identifier)
    await _issue_session(db, response, user, request)
    user.pop("_id", None)
    user.pop("password_hash", None)
    # Attach membership for instant UI gating
    membership = await db.memberships.find_one({"user_id": user["id"]}, {"_id": 0})
    user["membership"] = membership
    user["is_club_member"] = bool(membership and membership.get("member_status") in ("active", "honorary"))
    if user["is_club_member"]:
        user["user_type"] = "club_member"
    elif not user.get("user_type"):
        user["user_type"] = "community_user"
    return user


@router.post("/logout")
async def logout(request: Request, response: Response):
    db = get_db()
    token = request.cookies.get("refresh_token")
    if token:
        await _revoke_refresh(db, token)
    clear_auth_cookies(response)
    return {"ok": True}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    payload = _decode(token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    token_id = payload.get("jti")
    if not token_id:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    db = get_db()
    stored = await db.refresh_tokens.find_one({
        "jti": token_id,
        "token_hash": hash_token(token),
        "revoked": {"$ne": True},
    })
    if not stored:
        await db.refresh_tokens.update_many(
            {"user_id": payload["sub"]},
            {"$set": {"revoked": True, "revoked_at": now_utc(), "revocation_reason": "refresh_reuse"}},
        )
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    await db.refresh_tokens.update_one(
        {"id": stored["id"]},
        {"$set": {"revoked": True, "rotated_at": now_utc()}},
    )
    await _issue_session(db, response, user, request)
    return {"ok": True}


@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordBody):
    db = get_db()
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    # Always return ok to prevent user enumeration
    if user:
        token = secrets.token_urlsafe(32)
        await db.password_reset_tokens.insert_one({
            "id": new_id(),
            "token_hash": hash_token(token),
            "user_id": user["id"],
            "used": False,
            "created_at": now_utc().isoformat(),
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        })
        # SMTP / Resend integration — try to send actual email
        frontend = os.environ.get("FRONTEND_URL", "").rstrip("/")
        reset_url = f"{frontend}/reset-password?token={token}" if frontend else f"/reset-password?token={token}"
        await send_template("password_reset", email, reset_url=reset_url)
    return {"ok": True, "message": "Falls diese E-Mail registriert ist, wurde ein Link gesendet."}


@router.post("/reset-password")
async def reset_password(body: ResetPasswordBody):
    db = get_db()
    doc = await db.password_reset_tokens.find_one({"token_hash": hash_token(body.token), "used": False})
    if not doc:
        raise HTTPException(status_code=400, detail="Ungültiger oder abgelaufener Token")
    # Expiry check (defense-in-depth; Mongo TTL also handles it)
    exp = doc.get("expires_at")
    if isinstance(exp, str):
        exp = datetime.fromisoformat(exp.replace("Z", "+00:00"))
    if exp and exp < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Token abgelaufen")
    await db.users.update_one(
        {"id": doc["user_id"]},
        {"$set": {"password_hash": hash_password(body.new_password),
                  "password_setup_required": False,
                  "email_verified": True,
                  "updated_at": now_utc().isoformat()}},
    )
    await db.password_reset_tokens.update_one({"id": doc["id"]}, {"$set": {"used": True}})
    return {"ok": True}


@router.post("/change-password")
async def change_password(body: ChangePasswordBody, user: dict = Depends(get_current_user)):
    db = get_db()
    full = await db.users.find_one({"id": user["id"]})
    if not full or not verify_password(body.current_password, full["password_hash"]):
        raise HTTPException(status_code=400, detail="Aktuelles Passwort falsch")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(body.new_password),
                  "updated_at": now_utc().isoformat()}},
    )
    return {"ok": True}
