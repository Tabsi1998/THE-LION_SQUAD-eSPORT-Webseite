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
from services.auth_settings import load_auth_settings

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
        user["id"], user["email"], user.get("role", "player"), token_id, family_id,
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
    await _touch_auth_session(
        db,
        user_id=user["id"],
        family_id=family_id,
        token_id=token_id,
        expires_at=expires_at,
        user_agent=user_agent,
        ip=ip,
        client=client,
    )
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


def _ua_fingerprint(user_agent: str) -> tuple[str, str]:
    """Coarse browser+OS fingerprint so minor UA mutations (Chrome UA reduction,
    proxy rewrites) don't break the benign-refresh grace, while a different
    browser/OS still counts as a different client."""
    ua = (user_agent or "").lower()
    browser = next((b for b in ("edg/", "opr/", "fxios", "firefox", "crios", "chrome", "safari") if b in ua), None)
    os_name = next((o for o in ("windows", "android", "iphone", "ipad", "mac os", "linux") if o in ua), None)
    if not browser and not os_name:
        return (ua, "")
    return (browser or "", os_name or "")


def _within_rotation_grace(stored: dict, now: datetime, user_agent: str) -> bool:
    """Benign concurrent-refresh detection.

    A refresh token that was JUST rotated (within the grace window) by the SAME
    client (identical user agent) and has a recorded replacement is a normal
    concurrent/duplicate refresh (React StrictMode double-effects, parallel
    first-load requests, quick retries). We must NOT treat this as token theft,
    otherwise the whole session family gets revoked and the user is logged out
    immediately after login.

    Genuine reuse (a token replayed long after rotation, from a different
    client, or one that was revoked for any reason other than a clean rotation)
    still falls through to revocation.
    """
    if stored.get("revocation_reason") not in (None, "rotated"):
        return False
    rotated_at = as_utc_datetime(stored.get("rotated_at"))
    if not rotated_at or now - rotated_at > timedelta(seconds=REFRESH_REPLAY_GRACE_SECONDS):
        return False
    if _ua_fingerprint(stored.get("rotation_user_agent")) != _ua_fingerprint(user_agent):
        return False
    return bool(
        stored.get("replacement_jti")
        and stored.get("replacement_id")
        and stored.get("replacement_expires_at")
    )


async def _touch_auth_session(
    db,
    *,
    user_id: str,
    family_id: str,
    token_id: str,
    expires_at: datetime,
    user_agent: str,
    ip: str,
    client: str | None = None,
) -> None:
    """Keep one device/session document per refresh-token family."""
    update = {
        "user_id": user_id,
        "current_jti": token_id,
        "last_active": now_utc(),
        "expires_at": expires_at,
        "user_agent": user_agent,
        "ip": ip,
    }
    if client:
        update["client"] = client
    try:
        await db.auth_sessions.update_one(
            {"family_id": family_id},
            {
                "$set": update,
                "$setOnInsert": {
                    "id": new_id(),
                    "family_id": family_id,
                    "created_at": now_utc(),
                    "revoked": False,
                },
            },
            upsert=True,
        )
    except DuplicateKeyError:
        await db.auth_sessions.update_one({"family_id": family_id}, {"$set": update})


async def _revoke_refresh_family(db, user_id: str, family_id: str, reason: str):
    await db.refresh_tokens.update_many(
        {"user_id": user_id, "$or": [{"family_id": family_id}, {"jti": family_id}]},
        {"$set": {
            "revoked": True,
            "revoked_at": now_utc(),
            "revocation_reason": reason,
        }},
    )
    await db.auth_sessions.update_many(
        {"user_id": user_id, "family_id": family_id, "revoked": {"$ne": True}},
        {"$set": {
            "revoked": True,
            "revoked_at": now_utc(),
            "revocation_reason": reason,
        }},
    )


async def _revoke_all_auth_sessions(db, user_id: str, reason: str, *, exclude_family: str | None = None):
    query = {"user_id": user_id, "revoked": {"$ne": True}}
    if exclude_family:
        query["family_id"] = {"$ne": exclude_family}
    await db.auth_sessions.update_many(
        query,
        {"$set": {"revoked": True, "revoked_at": now_utc(), "revocation_reason": reason}},
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
        if not stored or not _within_rotation_grace(stored, now, user_agent):
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
    # A logout ends the whole device session (family), so lingering access
    # tokens bound to this family die immediately too.
    user_id = payload.get("sub")
    family_id = payload.get("fid") or token_id
    if user_id:
        await _revoke_refresh_family(db, user_id, family_id, "logout")


@router.post("/register")
async def register(body: UserRegister, request: Request, response: Response):
    await enforce_rate_limit(request, "auth:register:ip", limit=5, window_seconds=3600)
    db = get_db()
    if not (await load_auth_settings(db))["registration_enabled"]:
        raise HTTPException(status_code=403, detail="Die Registrierung ist derzeit deaktiviert.")
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


async def _resolve_google_identity(request: Request) -> dict:
    """Read the session_id from the request body and resolve the Google identity server-side."""
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
    return resp.json()



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
    db = get_db()
    if not (await load_auth_settings(db))["google_login_enabled"]:
        raise HTTPException(status_code=403, detail="Google-Login ist derzeit deaktiviert.")
    data = await _resolve_google_identity(request)
    email = (data.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(status_code=400, detail="Keine E-Mail von Google erhalten")

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
            "google_linked": True,
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


@router.post("/google/link")
async def google_link(request: Request, user: dict = Depends(get_current_user)):
    """Link a Google identity to the CURRENTLY authenticated local account.

    Secure account linking: requires an active session, re-verifies the Google
    identity server-side and refuses to hijack a Google account or email that
    already belongs to another user.
    """
    await enforce_rate_limit(request, "auth:google-link:ip", limit=30, window_seconds=3600)
    db = get_db()
    if not (await load_auth_settings(db))["google_linking_enabled"]:
        raise HTTPException(status_code=403, detail="Google-Verknüpfung ist derzeit deaktiviert.")
    data = await _resolve_google_identity(request)
    google_id = data.get("id")
    google_email = (data.get("email") or "").lower().strip()
    if not google_id or not google_email:
        raise HTTPException(status_code=400, detail="Keine gültigen Google-Daten erhalten")

    existing_by_google = await db.users.find_one({"google_id": google_id})
    if existing_by_google and existing_by_google["id"] != user["id"]:
        raise HTTPException(status_code=409, detail="Dieses Google-Konto ist bereits mit einem anderen Account verknüpft.")
    existing_by_email = await db.users.find_one({"email": google_email})
    if existing_by_email and existing_by_email["id"] != user["id"]:
        raise HTTPException(status_code=409, detail="Diese Google-E-Mail gehört bereits zu einem anderen Account.")

    updates = {
        "google_id": google_id,
        "google_email": google_email,
        "google_linked": True,
        "email_verified": True,
        "updated_at": now_utc().isoformat(),
    }
    await db.users.update_one({"id": user["id"]}, {"$set": updates})
    return {"ok": True, "google_email": google_email}


@router.post("/google/unlink")
async def google_unlink(user: dict = Depends(get_current_user)):
    """Remove the Google link from the current account (blocked for Google-only accounts to avoid lockout)."""
    db = get_db()
    full = await db.users.find_one({"id": user["id"]})
    if not full:
        raise HTTPException(status_code=404, detail="Account nicht gefunden")
    if full.get("auth_provider") == "google":
        raise HTTPException(
            status_code=400,
            detail="Dieser Account nutzt nur Google-Login. Setze zuerst über \"Passwort vergessen\" ein Passwort, dann kannst du Google trennen.",
        )
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"google_id": None, "google_email": None, "google_linked": False, "updated_at": now_utc().isoformat()}},
    )
    return {"ok": True}


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


async def _current_session_family(db, request: Request) -> str | None:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        return None
    try:
        payload = _decode(token)
    except HTTPException:
        return None
    family = payload.get("fam")
    if family:
        return family
    sid = payload.get("sid")
    if not sid:
        return None
    doc = await db.refresh_tokens.find_one({"jti": sid}, {"_id": 0, "family_id": 1})
    return (doc or {}).get("family_id") or sid


@router.get("/sessions")
async def list_sessions(request: Request, user: dict = Depends(get_current_user)):
    """Active sessions/devices of the current user."""
    db = get_db()
    current_family = await _current_session_family(db, request)
    now = datetime.now(timezone.utc)
    rows = await db.auth_sessions.find(
        {"user_id": user["id"], "revoked": {"$ne": True}}, {"_id": 0}
    ).sort("last_active", -1).to_list(100)
    sessions = []
    for row in rows:
        expires_at = as_utc_datetime(row.get("expires_at"))
        if expires_at and expires_at <= now:
            continue
        created_at = as_utc_datetime(row.get("created_at"))
        last_active = as_utc_datetime(row.get("last_active"))
        sessions.append({
            "id": row.get("id"),
            "created_at": created_at.isoformat() if created_at else None,
            "last_active": last_active.isoformat() if last_active else None,
            "user_agent": row.get("user_agent") or "",
            "ip": row.get("ip") or "",
            "client": row.get("client") or "web",
            "current": bool(current_family and row.get("family_id") == current_family),
        })
    return sessions


@router.delete("/sessions/{session_id}")
async def revoke_session(session_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Log out a single device/session of the current user."""
    db = get_db()
    row = await db.auth_sessions.find_one({"id": session_id, "user_id": user["id"]}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Sitzung nicht gefunden")
    await _revoke_refresh_family(db, user["id"], row["family_id"], "user_revoked")
    current_family = await _current_session_family(db, request)
    return {"ok": True, "current": bool(current_family and row["family_id"] == current_family)}


@router.post("/sessions/logout-all")
async def logout_all_sessions(request: Request, user: dict = Depends(get_current_user)):
    """Log out every other device; the current session stays alive."""
    db = get_db()
    current_family = await _current_session_family(db, request)
    if not current_family:
        raise HTTPException(status_code=400, detail="Aktuelle Sitzung konnte nicht bestimmt werden. Bitte neu einloggen.")
    rows = await db.auth_sessions.find(
        {"user_id": user["id"], "revoked": {"$ne": True}}, {"_id": 0, "family_id": 1}
    ).to_list(500)
    revoked = 0
    for row in rows:
        family_id = row.get("family_id")
        if not family_id or family_id == current_family:
            continue
        await _revoke_refresh_family(db, user["id"], family_id, "user_revoked")
        revoked += 1
    # Sweep legacy refresh tokens that never got a session document.
    await db.refresh_tokens.update_many(
        {"user_id": user["id"], "revoked": {"$ne": True}, "family_id": {"$ne": current_family}},
        {"$set": {"revoked": True, "revoked_at": now_utc(), "revocation_reason": "user_revoked"}},
    )
    return {"ok": True, "revoked_sessions": revoked}


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
    await _revoke_all_auth_sessions(db, doc["user_id"], "password_reset")
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
    await _revoke_all_auth_sessions(db, user["id"], "password_change")
    return {"ok": True}
