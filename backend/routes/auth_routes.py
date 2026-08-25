"""Authentication routes."""
import os
import secrets
import httpx
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Response, Request, HTTPException, Depends
from pydantic import BaseModel
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from database import get_db
from auth import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    set_auth_cookies, clear_auth_cookies, get_current_user, get_optional_user, _decode,
    hash_token, refresh_expires_at, as_utc_datetime,
)
from email_service import send_template
from models import (
    UserRegister, UserLogin, ForgotPasswordBody, ResetPasswordBody, ChangePasswordBody,
    now_utc, new_id,
)
from services.rate_limit import enforce_rate_limit, get_client_ip

router = APIRouter(prefix="/api/auth", tags=["auth"])

BRUTE_FORCE_MAX = 7
BRUTE_FORCE_WINDOW_MIN = 15
REFRESH_REPLAY_GRACE_SECONDS = 10


class MobileRefreshBody(BaseModel):
    refresh_token: str


class MobileLogoutBody(BaseModel):
    refresh_token: str | None = None


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
    return f"{get_client_ip(request)}:{email}"


async def _record_failed(db, identifier: str):
    await db.login_attempts.insert_one({
        "id": new_id(),
        "identifier": identifier,
        "created_at": datetime.now(timezone.utc),
    })


async def _clear_failed(db, identifier: str):
    await db.login_attempts.delete_many({"identifier": identifier})


def _request_identity(request: Request) -> tuple[str, str]:
    return (str(request.headers.get("user-agent") or "")[:512], get_client_ip(request))


def _eligible_session_user(user: dict | None) -> dict:
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.get("is_active") is False:
        raise HTTPException(status_code=403, detail="Account deaktiviert")
    if user.get("is_banned"):
        raise HTTPException(status_code=403, detail="Account gesperrt")
    if user.get("password_setup_required"):
        raise HTTPException(status_code=403, detail="Bitte zuerst ein Passwort erstellen")
    return user


async def _store_session(
    db,
    user: dict,
    request: Request,
    *,
    token_id: str,
    family_id: str,
    record_id: str,
    expires_at: datetime,
    client: str | None = None,
) -> tuple[str, str]:
    refresh = create_refresh_token(user["id"], token_id, family_id, expires_at)
    access = create_access_token(
        user["id"], user["email"], user.get("role", "player"), token_id,
    )
    user_agent, ip = _request_identity(request)
    document = {
        "id": record_id,
        "jti": token_id,
        "family_id": family_id,
        "user_id": user["id"],
        "token_hash": hash_token(refresh),
        "revoked": False,
        "created_at": now_utc(),
        "expires_at": expires_at,
        "user_agent": user_agent,
        "ip": ip,
    }
    if client:
        document["client"] = client
    try:
        await db.refresh_tokens.insert_one(document)
    except DuplicateKeyError:
        existing = await db.refresh_tokens.find_one({"jti": token_id})
        if not existing or existing.get("token_hash") != document["token_hash"] or existing.get("revoked") is True:
            raise HTTPException(status_code=401, detail="Invalid refresh token")
    return access, refresh


async def _issue_tokens(
    db,
    user: dict,
    request: Request,
    *,
    client: str | None = None,
) -> tuple[str, str]:
    token_id = secrets.token_urlsafe(24)
    return await _store_session(
        db,
        user,
        request,
        token_id=token_id,
        family_id=token_id,
        record_id=new_id(),
        expires_at=refresh_expires_at(),
        client=client,
    )


async def _issue_session(db, response: Response, user: dict, request: Request):
    access, refresh = await _issue_tokens(db, user, request)
    set_auth_cookies(response, access, refresh)
    return access, refresh


def _public_user(user: dict) -> dict:
    doc = dict(user)
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc


async def _attach_membership(user: dict) -> dict:
    db = get_db()
    membership = await db.memberships.find_one({"user_id": user["id"]}, {"_id": 0})
    user["membership"] = membership
    user["is_club_member"] = bool(membership and membership.get("member_status") in ("active", "honorary"))
    if user["is_club_member"]:
        user["user_type"] = "club_member"
    elif not user.get("user_type"):
        user["user_type"] = "community_user"
    return user


async def _issue_mobile_session(db, user: dict, request: Request) -> tuple[str, str]:
    return await _issue_tokens(db, user, request, client="mobile")


def _recent_same_client_rotation(stored: dict, request: Request, now: datetime) -> bool:
    rotated_at = as_utc_datetime(stored.get("rotated_at"))
    if not rotated_at or now - rotated_at > timedelta(seconds=REFRESH_REPLAY_GRACE_SECONDS):
        return False
    user_agent, ip = _request_identity(request)
    return (
        stored.get("rotation_user_agent", "") == user_agent
        and stored.get("rotation_ip", "") == ip
    )


async def _revoke_refresh_family(db, user_id: str, family_id: str, reason: str):
    await db.refresh_tokens.update_many(
        {"user_id": user_id, "$or": [{"family_id": family_id}, {"jti": family_id}]},
        {"$set": {
            "revoked": True,
            "revoked_at": now_utc(),
            "revocation_reason": reason,
        }},
    )


async def _rotate_session(
    db,
    token: str,
    request: Request,
    *,
    client: str | None = None,
) -> tuple[dict, str, str]:
    payload = _decode(token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    token_id = payload.get("jti")
    user_id = payload.get("sub")
    if not token_id or not user_id:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    now = datetime.now(timezone.utc)
    family_id = payload.get("fid") or token_id
    replacement_jti = secrets.token_urlsafe(24)
    replacement_id = new_id()
    replacement_expires_at = refresh_expires_at()
    user_agent, ip = _request_identity(request)
    stored = await db.refresh_tokens.find_one_and_update(
        {
            "jti": token_id,
            "token_hash": hash_token(token),
            "revoked": {"$ne": True},
        },
        {"$set": {
            "revoked": True,
            "rotated_at": now,
            "revocation_reason": "rotated",
            "family_id": family_id,
            "replacement_jti": replacement_jti,
            "replacement_id": replacement_id,
            "replacement_expires_at": replacement_expires_at,
            "rotation_user_agent": user_agent,
            "rotation_ip": ip,
        }},
        return_document=ReturnDocument.BEFORE,
    )

    if stored is None:
        stored = await db.refresh_tokens.find_one({
            "jti": token_id,
            "token_hash": hash_token(token),
        })
        if not stored or not _recent_same_client_rotation(stored, request, now):
            await _revoke_refresh_family(db, user_id, family_id, "refresh_reuse")
            raise HTTPException(status_code=401, detail="Invalid refresh token")
        replacement_jti = stored.get("replacement_jti")
        replacement_id = stored.get("replacement_id")
        replacement_expires_at = as_utc_datetime(stored.get("replacement_expires_at"))
        if not replacement_jti or not replacement_id or not replacement_expires_at:
            await _revoke_refresh_family(db, user_id, family_id, "incomplete_rotation")
            raise HTTPException(status_code=401, detail="Invalid refresh token")

    user = _eligible_session_user(await db.users.find_one({"id": user_id}))
    access, refresh = await _store_session(
        db,
        user,
        request,
        token_id=replacement_jti,
        family_id=family_id,
        record_id=replacement_id,
        expires_at=replacement_expires_at,
        client=client,
    )
    return user, access, refresh


async def _refresh_mobile_session(db, token: str, request: Request) -> tuple[dict, str, str]:
    return await _rotate_session(db, token, request, client="mobile")


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
    await enforce_rate_limit(request, "auth:register:ip", limit=5, window_seconds=3600)
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
        "display_name": username,
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
        "gender": body.gender,
        "favorite_games": [],
        "main_platform": None, "preferred_role": None, "input_device": None,
        "privacy_public_profile": True,
        "profile_visibility": {},
        "dm_privacy": "everyone",
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
    return _public_user(user_doc)


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
    if user.get("is_active") is False:
        raise HTTPException(status_code=403, detail="Account deaktiviert")
    if user.get("is_banned"):
        raise HTTPException(status_code=403, detail="Account gesperrt")

    await _clear_failed(db, identifier)
    await _issue_session(db, response, user, request)
    user = _public_user(user)
    # Attach membership for instant UI gating
    await _attach_membership(user)
    return user


EMERGENT_SESSION_DATA_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"


async def _unique_username(db, base: str) -> str:
    cleaned = "".join(ch for ch in (base or "").strip() if ch.isalnum() or ch in ("_", "-", " ")).replace(" ", "_")
    cleaned = (cleaned or "player")[:20]
    candidate = cleaned
    suffix = 0
    while await db.users.find_one({"username": candidate}):
        suffix += 1
        candidate = f"{cleaned}{suffix}"
    return candidate


def _google_user_doc(email: str, name: str, picture: str | None, google_id: str | None, username: str) -> dict:
    display = (name or username).strip() or username
    ts = now_utc().isoformat()
    return {
        "id": new_id(),
        "email": email,
        "username": username,
        # Random unusable password; the account signs in via Google (or via reset).
        "password_hash": hash_password(secrets.token_urlsafe(32)),
        "display_name": display,
        "avatar_url": picture or None, "banner_url": None,
        "role": "player", "roles": ["player"], "user_type": "community_user",
        "is_club_member": False,
        "auth_provider": "google", "google_id": google_id,
        "discord_name": None, "discord_id": None,
        "switch_code": None, "steam_id": None, "epic_id": None,
        "psn_id": None, "xbox_id": None, "riot_id": None,
        "twitch_handle": None, "youtube_handle": None, "tiktok_handle": None,
        "instagram_handle": None, "x_handle": None, "nintendo_fc": None,
        "ea_id": None, "battlenet_id": None, "website": None,
        "country": None, "state": None, "city": None,
        "first_name": None, "last_name": None, "nickname": None,
        "birth_date": None, "gender": None, "favorite_games": [],
        "main_platform": None, "preferred_role": None, "input_device": None,
        "privacy_public_profile": True, "profile_visibility": {}, "dm_privacy": "everyone",
        "bio": None,
        "is_active": True, "is_banned": False, "email_verified": True,
        "accepted_privacy": True, "accepted_terms": True, "newsletter_consent": False,
        "password_setup_required": False,
        "created_at": ts, "updated_at": ts,
    }


@router.post("/google/session")
async def google_session(request: Request, response: Response):
    """Exchange an Emergent Google-OAuth session_id for an app session.
    Creates a real user in the users collection (or links an existing one by email)."""
    await enforce_rate_limit(request, "auth:google:ip", limit=30, window_seconds=3600)
    try:
        payload = await request.json()
    except Exception:
        payload = None
    session_id = (payload or {}).get("session_id") if isinstance(payload, dict) else None
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id fehlt")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(EMERGENT_SESSION_DATA_URL, headers={"X-Session-ID": session_id})
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Google-Anmeldung derzeit nicht erreichbar")
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Google-Anmeldung fehlgeschlagen")
    data = resp.json()
    email = (data.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(status_code=400, detail="Keine E-Mail von Google erhalten")

    db = get_db()
    user = await db.users.find_one({"email": email})
    created = False
    if not user:
        username = await _unique_username(db, data.get("name") or email.split("@")[0])
        user = _google_user_doc(email, data.get("name"), data.get("picture"), data.get("id"), username)
        await db.users.insert_one(user)
        created = True
        await send_template("registration", email, display_name=user["display_name"])
    else:
        updates = {
            "google_id": data.get("id") or user.get("google_id"),
            "auth_provider": user.get("auth_provider") or "google",
            "email_verified": True,
            "updated_at": now_utc().isoformat(),
        }
        if not user.get("avatar_url") and data.get("picture"):
            updates["avatar_url"] = data["picture"]
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
        user = {**user, **updates}

    if user.get("is_active") is False:
        raise HTTPException(status_code=403, detail="Account deaktiviert")
    if user.get("is_banned"):
        raise HTTPException(status_code=403, detail="Account gesperrt")

    await _issue_session(db, response, user, request)
    public = _public_user(user)
    await _attach_membership(public)
    public["_created"] = created
    return public


@router.post("/mobile/register")
async def mobile_register(body: UserRegister, request: Request):
    db = get_db()
    if not body.accept_privacy or not body.accept_terms:
        raise HTTPException(status_code=400, detail="Datenschutz und Nutzungsbedingungen müssen akzeptiert werden.")
    email = body.email.lower().strip()
    username = body.username.strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="E-Mail bereits registriert")
    if await db.users.find_one({"username": username}):
        raise HTTPException(status_code=409, detail="Benutzername bereits vergeben")
    user_doc = {
        "id": new_id(),
        "email": email,
        "username": username,
        "password_hash": hash_password(body.password),
        "display_name": username,
        "avatar_url": None, "banner_url": None,
        "role": "player",
        "roles": ["player"],
        "user_type": "community_user",
        "is_club_member": False,
        "discord_name": body.discord_name, "discord_id": None,
        "switch_code": None, "steam_id": None, "epic_id": None,
        "psn_id": None, "xbox_id": None, "riot_id": None,
        "twitch_handle": None, "youtube_handle": None, "tiktok_handle": None,
        "instagram_handle": None, "x_handle": None,
        "nintendo_fc": None,
        "ea_id": None, "battlenet_id": None,
        "website": None,
        "country": None, "state": None, "city": None,
        "first_name": None, "last_name": None, "nickname": None,
        "birth_date": body.birth_date,
        "gender": body.gender,
        "favorite_games": [],
        "main_platform": None, "preferred_role": None, "input_device": None,
        "privacy_public_profile": True,
        "profile_visibility": {},
        "dm_privacy": "everyone",
        "bio": None,
        "is_active": True, "is_banned": False, "email_verified": False,
        "accepted_privacy": body.accept_privacy,
        "accepted_terms": body.accept_terms,
        "newsletter_consent": body.newsletter_consent,
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    await db.users.insert_one(user_doc)
    access, refresh = await _issue_mobile_session(db, user_doc, request)
    await send_template("registration", email, display_name=user_doc["display_name"])
    user = _public_user(user_doc)
    await _attach_membership(user)
    return {"user": user, "access_token": access, "refresh_token": refresh, "token_type": "bearer"}


@router.post("/mobile/login")
async def mobile_login(body: UserLogin, request: Request):
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
    if user.get("is_active") is False:
        raise HTTPException(status_code=403, detail="Account deaktiviert")
    if user.get("is_banned"):
        raise HTTPException(status_code=403, detail="Account gesperrt")

    await _clear_failed(db, identifier)
    access, refresh = await _issue_mobile_session(db, user, request)
    user = _public_user(user)
    await _attach_membership(user)
    return {"user": user, "access_token": access, "refresh_token": refresh, "token_type": "bearer"}


@router.post("/mobile/refresh")
async def mobile_refresh(body: MobileRefreshBody, request: Request):
    db = get_db()
    user, access, refresh = await _refresh_mobile_session(db, body.refresh_token, request)
    user = _public_user(user)
    await _attach_membership(user)
    return {"user": user, "access_token": access, "refresh_token": refresh, "token_type": "bearer"}


@router.post("/mobile/logout")
async def mobile_logout(body: MobileLogoutBody):
    if body.refresh_token:
        db = get_db()
        await _revoke_refresh(db, body.refresh_token)
    return {"ok": True}


@router.post("/logout")
async def logout(request: Request, response: Response):
    db = get_db()
    token = request.cookies.get("refresh_token")
    if token:
        await _revoke_refresh(db, token)
    clear_auth_cookies(response)
    return {"ok": True}


@router.get("/me")
async def me(request: Request, response: Response, user: dict | None = Depends(get_optional_user)):
    """Return a quiet guest response while preserving refreshable sessions.

    Public pages can bootstrap auth without producing an expected 401 in every
    guest browser. A stale access cookie is refreshed explicitly by the client.
    """
    response.headers["Cache-Control"] = "no-store"
    if user is None and request.cookies.get("refresh_token"):
        response.headers["X-Session-Refresh"] = "required"
    return user


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    db = get_db()
    _user, access, refresh_token = await _rotate_session(db, token, request)
    set_auth_cookies(response, access, refresh_token)
    return {"ok": True}


@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordBody, request: Request):
    db = get_db()
    email = body.email.lower().strip()
    await enforce_rate_limit(request, "auth:forgot:ip", limit=8, window_seconds=900)
    await enforce_rate_limit(request, "auth:forgot:email", limit=5, window_seconds=3600, subject=email)
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
async def reset_password(body: ResetPasswordBody, request: Request):
    await enforce_rate_limit(request, "auth:reset:ip", limit=20, window_seconds=900)
    db = get_db()
    doc = await db.password_reset_tokens.find_one({"token_hash": hash_token(body.token), "used": False})
    if not doc:
        raise HTTPException(status_code=400, detail="Ungültiger oder abgelaufener Token")
    # Expiry check (defense-in-depth; Mongo TTL also handles it)
    exp = as_utc_datetime(doc.get("expires_at"))
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
    await db.refresh_tokens.update_many(
        {"user_id": doc["user_id"], "revoked": {"$ne": True}},
        {"$set": {
            "revoked": True,
            "revoked_at": now_utc(),
            "revocation_reason": "password_reset",
        }},
    )
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
    await db.refresh_tokens.update_many(
        {"user_id": user["id"], "revoked": {"$ne": True}},
        {"$set": {
            "revoked": True,
            "revoked_at": now_utc(),
            "revocation_reason": "password_change",
        }},
    )
    return {"ok": True}
