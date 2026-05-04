"""Authentication routes."""
import os
import secrets
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Response, Request, HTTPException, Depends
from database import get_db
from auth import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    set_auth_cookies, clear_auth_cookies, get_current_user, _decode,
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
        "created_at": {"$gte": cutoff.isoformat()},
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
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


async def _clear_failed(db, identifier: str):
    await db.login_attempts.delete_many({"identifier": identifier})


@router.post("/register")
async def register(body: UserRegister, response: Response):
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
    access = create_access_token(user_id, email, "player")
    refresh = create_refresh_token(user_id)
    set_auth_cookies(response, access, refresh)
    # Send welcome email (silent fail if not configured)
    await send_template("registration", email, display_name=user_doc["display_name"])
    user_doc.pop("_id", None)
    user_doc.pop("password_hash", None)
    return {**user_doc, "access_token": access, "refresh_token": refresh}


@router.post("/login")
async def login(body: UserLogin, request: Request, response: Response):
    db = get_db()
    email = body.email.lower().strip()
    identifier = _client_identifier(request, email)
    await _check_brute_force(db, identifier)

    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        await _record_failed(db, identifier)
        raise HTTPException(status_code=401, detail="Ungültige Zugangsdaten")
    if user.get("is_banned"):
        raise HTTPException(status_code=403, detail="Account gesperrt")

    await _clear_failed(db, identifier)
    access = create_access_token(user["id"], user["email"], user.get("role", "player"))
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
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
    return {**user, "access_token": access, "refresh_token": refresh}


@router.post("/logout")
async def logout(response: Response):
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
    db = get_db()
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    access = create_access_token(user["id"], user["email"], user.get("role", "player"))
    new_refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, new_refresh)
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
            "token": token,
            "user_id": user["id"],
            "used": False,
            "created_at": now_utc().isoformat(),
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        })
        # SMTP / Resend integration — try to send actual email
        frontend = os.environ.get("FRONTEND_URL", "").rstrip("/")
        reset_url = f"{frontend}/reset-password?token={token}" if frontend else f"/reset-password?token={token}"
        await send_template("password_reset", email, reset_url=reset_url)
        print(f"[Password Reset] For {email}: {reset_url}")
    return {"ok": True, "message": "Falls diese E-Mail registriert ist, wurde ein Link gesendet."}


@router.post("/reset-password")
async def reset_password(body: ResetPasswordBody):
    db = get_db()
    doc = await db.password_reset_tokens.find_one({"token": body.token, "used": False})
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
