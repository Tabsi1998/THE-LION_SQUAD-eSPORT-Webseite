"""Authentication routes."""
import os
import secrets
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Response, Request, HTTPException, Depends
from pydantic import BaseModel
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from starlette.concurrency import run_in_threadpool
from database import get_db
from auth import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    set_auth_cookies, clear_auth_cookies, get_current_user, get_optional_user, _decode,
    hash_token, refresh_expires_at, as_utc_datetime,
)
from email_service import send_template, _site_base_url
from models import (
    UserRegister, UserLogin, ForgotPasswordBody, ResetPasswordBody, ChangePasswordBody,
    now_utc, new_id,
)
from services.rate_limit import enforce_rate_limit, get_client_ip
from services.auth_settings import load_auth_settings
from services.google_identity import GoogleIdentityError, verify_google_credential
from services.secret_store import decrypt_secret, encrypt_secret
from services.totp import generate_recovery_codes, generate_totp_secret, provisioning_uri, verify_totp

router = APIRouter(prefix="/api/auth", tags=["auth"])

BRUTE_FORCE_MAX = 7
BRUTE_FORCE_WINDOW_MIN = 15
REFRESH_REPLAY_GRACE_SECONDS = 10
ADMIN_ROLES = {"tournament_admin", "club_admin", "superadmin"}


class MobileRefreshBody(BaseModel):
    refresh_token: str


class MobileLogoutBody(BaseModel):
    refresh_token: str | None = None


class GoogleCredentialBody(BaseModel):
    credential: str = ""
    intent: str = "login"
    accept_privacy: bool = False
    accept_terms: bool = False
    newsletter_consent: bool = False


class EmailVerificationBody(BaseModel):
    token: str = ""


class MfaPasswordBody(BaseModel):
    current_password: str = ""


class MfaCodeBody(BaseModel):
    code: str = ""


class MfaDisableBody(BaseModel):
    current_password: str = ""
    code: str = ""


class MfaLoginBody(BaseModel):
    ticket: str = ""
    code: str = ""
    client: str = "web"


class ConsentBody(BaseModel):
    accept_privacy: bool = False
    accept_terms: bool = False


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


async def _record_registration_consents(
    db,
    user_id: str,
    *,
    privacy: bool,
    terms: bool,
    newsletter: bool,
    source: str,
) -> None:
    timestamp = now_utc()
    rows = []
    if privacy:
        rows.append({"type": "privacy", "version": os.environ.get("PRIVACY_POLICY_VERSION", "2026-08-26")})
    if terms:
        rows.append({"type": "terms", "version": os.environ.get("TERMS_VERSION", "2026-08-26")})
    rows.append({"type": "newsletter", "version": "1", "granted": bool(newsletter)})
    documents = [{
        "id": new_id(),
        "user_id": user_id,
        "consent_type": row["type"],
        "policy_version": row["version"],
        "granted": row.get("granted", True),
        "source": source,
        "created_at": timestamp,
    } for row in rows]
    if documents:
        await db.consent_records.insert_many(documents)


async def _send_email_verification(db, user: dict) -> None:
    token = secrets.token_urlsafe(32)
    now = now_utc()
    # Keep earlier, unexpired links usable until one is redeemed. A public
    # resend request (or a delayed/failed mail) must not invalidate the link
    # already in the account owner's inbox. verify_email consumes all links.
    await db.email_verification_tokens.insert_one({
        "id": new_id(),
        "token_hash": hash_token(token),
        "user_id": user["id"],
        "used": False,
        "created_at": now,
        "expires_at": now + timedelta(hours=24),
    })
    frontend = await _site_base_url()
    verification_url = f"{frontend}/verify-email?token={token}"
    await send_template(
        "email_verification",
        user["email"],
        display_name=user.get("display_name") or user.get("username"),
        verification_url=verification_url,
        dedupe_key=f"email-verification:{user['id']}:{hash_token(token)[:12]}",
    )


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


def _requires_admin_mfa(user: dict) -> bool:
    return user.get("role") in ADMIN_ROLES and user.get("mfa_enabled") is True


async def _create_mfa_login_challenge(db, user: dict, request: Request, client: str) -> dict:
    ticket = secrets.token_urlsafe(32)
    now = now_utc()
    user_agent, ip = _request_identity(request)
    await db.mfa_login_challenges.insert_one({
        "id": new_id(),
        "ticket_hash": hash_token(ticket),
        "user_id": user["id"],
        "client": client,
        "user_agent": user_agent,
        "ip": ip,
        "used": False,
        "attempts": 0,
        "created_at": now,
        "expires_at": now + timedelta(minutes=5),
    })
    return {"mfa_required": True, "mfa_ticket": ticket, "expires_in": 300}


async def _verify_mfa_code(db, user: dict, code: str) -> bool:
    normalized = str(code or "").replace("-", "").replace(" ", "").upper()
    secret = decrypt_secret(user.get("mfa_secret"))
    if secret and verify_totp(secret, normalized):
        return True
    recovery_hash = hash_token(normalized)
    if recovery_hash in (user.get("mfa_recovery_code_hashes") or []):
        await db.users.update_one({"id": user["id"]}, {"$pull": {"mfa_recovery_code_hashes": recovery_hash}})
        return True
    return False


async def _security_audit(db, user_id: str, action: str, request: Request) -> None:
    user_agent, ip = _request_identity(request)
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": action,
        "actor_id": user_id,
        "target_type": "user",
        "target_id": user_id,
        "data": {"ip": ip, "user_agent": user_agent},
        "created_at": now_utc(),
    })


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
    mfa_verified: bool = False,
) -> tuple[str, str]:
    refresh = create_refresh_token(user["id"], token_id, family_id, expires_at, mfa_verified=mfa_verified)
    access = create_access_token(
        user["id"], user["email"], user.get("role", "player"), token_id, family_id,
        mfa_verified=mfa_verified,
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
        "mfa_verified": bool(mfa_verified),
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
    mfa_verified: bool = False,
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
        mfa_verified=mfa_verified,
    )


async def _issue_session(db, response: Response, user: dict, request: Request, *, mfa_verified: bool = False):
    access, refresh = await _issue_tokens(db, user, request, mfa_verified=mfa_verified)
    set_auth_cookies(response, access, refresh)
    return access, refresh


async def with_areas(user: dict) -> dict:
    """Die Bereiche einer Person (#287) für Web und App – ohne interne Felder."""
    from services.permissions import areas_for

    doc = dict(user)
    doc["areas"] = sorted(await areas_for(user))
    doc.pop("_areas", None)
    return doc


def _public_user(user: dict) -> dict:
    doc = dict(user)
    for field in (
        "_id",
        "password_hash",
        "google_id",
        "mfa_secret",
        "mfa_pending_secret",
        "mfa_pending_created_at",
        "mfa_recovery_code_hashes",
    ):
        doc.pop(field, None)
    privacy_version = os.environ.get("PRIVACY_POLICY_VERSION", "2026-08-26")
    terms_version = os.environ.get("TERMS_VERSION", "2026-08-26")
    doc["consent_required"] = bool(
        doc.get("accepted_privacy") is not True
        or doc.get("accepted_terms") is not True
        or doc.get("privacy_policy_version") != privacy_version
        or doc.get("terms_version") != terms_version
    )
    doc["required_privacy_policy_version"] = privacy_version
    doc["required_terms_version"] = terms_version
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


async def _issue_mobile_session(db, user: dict, request: Request, *, mfa_verified: bool = False) -> tuple[str, str]:
    return await _issue_tokens(db, user, request, client="mobile", mfa_verified=mfa_verified)


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
        mfa_verified=bool(payload.get("mfa")),
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
        "privacy_public_profile": False,
        "profile_visibility": {},
        "dm_privacy": "everyone",
        "bio": None,
        "is_active": True, "is_banned": False, "email_verified": False,
        "accepted_privacy": body.accept_privacy,
        "accepted_terms": body.accept_terms,
        "newsletter_consent": body.newsletter_consent,
        "privacy_policy_version": os.environ.get("PRIVACY_POLICY_VERSION", "2026-08-26"),
        "terms_version": os.environ.get("TERMS_VERSION", "2026-08-26"),
        "password_login_available": True,
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    await db.users.insert_one(user_doc)
    await _record_registration_consents(
        db, user_id, privacy=body.accept_privacy, terms=body.accept_terms,
        newsletter=body.newsletter_consent, source="web_registration",
    )
    await _send_email_verification(db, user_doc)
    return {"verification_required": True, "email": email}


@router.post("/login")
async def login(body: UserLogin, request: Request, response: Response):
    db = get_db()
    if not (await load_auth_settings(db))["password_login_enabled"]:
        raise HTTPException(status_code=403, detail="Die Anmeldung mit E-Mail und Passwort ist derzeit deaktiviert.")
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
    if user.get("email_verified") is False:
        raise HTTPException(
            status_code=403,
            detail="E-Mail-Adresse noch nicht bestätigt. Bitte fordere einen Bestätigungslink an. Das ist auch für bestehende Konten erforderlich.",
            headers={"X-Auth-Error": "email_verification_required"},
        )

    await _clear_failed(db, identifier)
    if _requires_admin_mfa(user):
        return await _create_mfa_login_challenge(db, user, request, "web")
    await _issue_session(db, response, user, request)
    user = _public_user(user)
    # Attach membership for instant UI gating
    await _attach_membership(user)
    return user


async def _resolve_google_identity(credential: str, client_id: str) -> dict:
    try:
        return await run_in_threadpool(verify_google_credential, credential, client_id)
    except GoogleIdentityError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc



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
        "google_email": email, "google_linked": True,
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
        "privacy_public_profile": False, "profile_visibility": {}, "dm_privacy": "everyone",
        "bio": None,
        "is_active": True, "is_banned": False, "email_verified": True,
        "accepted_privacy": False, "accepted_terms": False, "newsletter_consent": False,
        "password_setup_required": False, "password_login_available": False,
        "created_at": ts, "updated_at": ts,
    }


@router.post("/google/session")
async def google_session(body: GoogleCredentialBody, request: Request, response: Response):
    """Verify a Google ID token and issue an application-owned session."""
    await enforce_rate_limit(request, "auth:google:ip", limit=30, window_seconds=3600)
    db = get_db()
    settings = await load_auth_settings(db)
    if not settings["google_login_enabled"]:
        raise HTTPException(status_code=403, detail="Google-Login ist derzeit deaktiviert.")
    data = await _resolve_google_identity(body.credential, settings["google_client_id"])
    email = (data.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(status_code=400, detail="Keine E-Mail von Google erhalten")

    google_id = data.get("id")
    user = await db.users.find_one({"google_id": google_id})
    created = False
    if not user:
        existing_email = await db.users.find_one({"email": email})
        if existing_email:
            raise HTTPException(
                status_code=409,
                detail="Für diese E-Mail existiert bereits ein Konto. Bitte dort anmelden und Google im Profil verknüpfen.",
            )
        if body.intent != "register":
            raise HTTPException(status_code=409, detail="Noch kein Google-Konto vorhanden. Bitte zuerst registrieren.")
        if not settings["registration_enabled"] or not settings["google_registration_enabled"]:
            raise HTTPException(status_code=403, detail="Die Registrierung mit Google ist derzeit deaktiviert.")
        if not body.accept_privacy or not body.accept_terms:
            raise HTTPException(status_code=400, detail="Datenschutz und Nutzungsbedingungen müssen akzeptiert werden.")
        username = await _unique_username(db, data.get("name") or email.split("@")[0])
        user = _google_user_doc(email, data.get("name"), data.get("picture"), google_id, username)
        user.update({
            "accepted_privacy": True,
            "accepted_terms": True,
            "newsletter_consent": body.newsletter_consent,
            "privacy_policy_version": os.environ.get("PRIVACY_POLICY_VERSION", "2026-08-26"),
            "terms_version": os.environ.get("TERMS_VERSION", "2026-08-26"),
        })
        await db.users.insert_one(user)
        await _record_registration_consents(
            db, user["id"], privacy=True, terms=True,
            newsletter=body.newsletter_consent, source="google_registration",
        )
        created = True
        await send_template("registration", email, display_name=user["display_name"])
    else:
        updates = {
            "google_linked": True,
            "google_email": email,
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

    if _requires_admin_mfa(user):
        return await _create_mfa_login_challenge(db, user, request, "web")
    await _issue_session(db, response, user, request)
    public = _public_user(user)
    await _attach_membership(public)
    public["_created"] = created
    return public


@router.post("/google/link")
async def google_link(body: GoogleCredentialBody, request: Request, user: dict = Depends(get_current_user)):
    """Link a Google identity to the CURRENTLY authenticated local account.

    Secure account linking: requires an active session, re-verifies the Google
    identity server-side and refuses to hijack a Google account or email that
    already belongs to another user.
    """
    await enforce_rate_limit(request, "auth:google-link:ip", limit=30, window_seconds=3600)
    db = get_db()
    settings = await load_auth_settings(db)
    if not settings["google_linking_enabled"]:
        raise HTTPException(status_code=403, detail="Google-Verknüpfung ist derzeit deaktiviert.")
    data = await _resolve_google_identity(body.credential, settings["google_client_id"])
    google_id = data.get("id")
    google_email = (data.get("email") or "").lower().strip()
    if not google_id or not google_email:
        raise HTTPException(status_code=400, detail="Keine gültigen Google-Daten erhalten")
    if google_email != str(user.get("email") or "").lower().strip():
        raise HTTPException(status_code=409, detail="Das Google-Konto muss dieselbe E-Mail-Adresse verwenden.")

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
        "auth_provider": "hybrid" if user.get("password_login_available", True) else "google",
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
    if not full.get("password_login_available", full.get("auth_provider") != "google"):
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
        "privacy_public_profile": False,
        "profile_visibility": {},
        "dm_privacy": "everyone",
        "bio": None,
        "is_active": True, "is_banned": False, "email_verified": False,
        "accepted_privacy": body.accept_privacy,
        "accepted_terms": body.accept_terms,
        "newsletter_consent": body.newsletter_consent,
        "privacy_policy_version": os.environ.get("PRIVACY_POLICY_VERSION", "2026-08-26"),
        "terms_version": os.environ.get("TERMS_VERSION", "2026-08-26"),
        "password_login_available": True,
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    await db.users.insert_one(user_doc)
    await _record_registration_consents(
        db, user_doc["id"], privacy=body.accept_privacy, terms=body.accept_terms,
        newsletter=body.newsletter_consent, source="mobile_registration",
    )
    await _send_email_verification(db, user_doc)
    return {"verification_required": True, "email": email}


@router.post("/mobile/login")
async def mobile_login(body: UserLogin, request: Request):
    db = get_db()
    if not (await load_auth_settings(db))["password_login_enabled"]:
        raise HTTPException(status_code=403, detail="Die Anmeldung mit E-Mail und Passwort ist derzeit deaktiviert.")
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
    if user.get("email_verified") is False:
        raise HTTPException(
            status_code=403,
            detail="E-Mail-Adresse noch nicht bestätigt. Bitte fordere einen Bestätigungslink an. Das ist auch für bestehende Konten erforderlich.",
            headers={"X-Auth-Error": "email_verification_required"},
        )

    await _clear_failed(db, identifier)
    if _requires_admin_mfa(user):
        return await _create_mfa_login_challenge(db, user, request, "mobile")
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
    if user is not None:
        user = await with_areas(user)
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


@router.post("/resend-verification")
async def resend_verification(body: ForgotPasswordBody, request: Request):
    db = get_db()
    email = body.email.lower().strip()
    await enforce_rate_limit(request, "auth:verify-resend:ip", limit=6, window_seconds=3600)
    await enforce_rate_limit(request, "auth:verify-resend:email", limit=3, window_seconds=3600, subject=email)
    user = await db.users.find_one({"email": email})
    if user and user.get("email_verified") is False and user.get("is_active") is not False and not user.get("is_banned"):
        await _send_email_verification(db, user)
    return {"ok": True, "message": "Falls eine Bestätigung aussteht, wurde der Versand angefordert. Bitte prüfe in einigen Minuten dein Postfach und den Spam-Ordner."}


@router.post("/verify-email")
async def verify_email(body: EmailVerificationBody, request: Request):
    await enforce_rate_limit(request, "auth:verify:ip", limit=30, window_seconds=3600)
    token = body.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Bestätigungs-Token fehlt")
    db = get_db()
    doc = await db.email_verification_tokens.find_one({"token_hash": hash_token(token), "used": False})
    if not doc:
        raise HTTPException(status_code=400, detail="Bestätigungslink ist ungültig oder wurde bereits verwendet.")
    expires_at = as_utc_datetime(doc.get("expires_at"))
    if not expires_at or expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Bestätigungslink ist abgelaufen.")
    user = await db.users.find_one({"id": doc["user_id"]})
    if not user:
        raise HTTPException(status_code=400, detail="Account wurde nicht gefunden.")
    now = now_utc()
    await db.email_verification_tokens.update_many(
        {"user_id": user["id"], "used": False},
        {"$set": {"used": True, "used_at": now}},
    )
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"email_verified": True, "email_verified_at": now, "updated_at": now.isoformat()}},
    )
    await send_template("registration", user["email"], display_name=user.get("display_name") or user.get("username"))
    return {"ok": True}


@router.post("/mfa/complete")
async def complete_mfa_login(body: MfaLoginBody, request: Request, response: Response):
    await enforce_rate_limit(request, "auth:mfa:ip", limit=20, window_seconds=900)
    db = get_db()
    now = now_utc()
    challenge = await db.mfa_login_challenges.find_one(
        {
            "ticket_hash": hash_token(body.ticket.strip()),
            "used": False,
            "expires_at": {"$gt": now},
            "attempts": {"$lt": 5},
        },
    )
    if not challenge:
        raise HTTPException(status_code=401, detail="MFA-Anmeldung ist ungültig oder abgelaufen.")
    user_agent, ip = _request_identity(request)
    if challenge.get("ip") != ip or challenge.get("user_agent") != user_agent:
        raise HTTPException(status_code=401, detail="MFA-Anmeldung gehört zu einem anderen Gerät.")
    user = _eligible_session_user(await db.users.find_one({"id": challenge["user_id"]}))
    if not await _verify_mfa_code(db, user, body.code):
        await db.mfa_login_challenges.update_one(
            {"_id": challenge["_id"], "used": False},
            {"$inc": {"attempts": 1}, "$set": {"last_failed_at": now}},
        )
        await _security_audit(db, user["id"], "auth.mfa.failed", request)
        raise HTTPException(status_code=401, detail="Ungültiger MFA- oder Wiederherstellungscode.")
    claimed = await db.mfa_login_challenges.find_one_and_update(
        {"_id": challenge["_id"], "used": False, "attempts": {"$lt": 5}},
        {"$set": {"used": True, "used_at": now}},
        return_document=ReturnDocument.BEFORE,
    )
    if not claimed:
        raise HTTPException(status_code=401, detail="MFA-Anmeldung wurde bereits verwendet.")
    client = "mobile" if challenge.get("client") == "mobile" or body.client == "mobile" else "web"
    await _security_audit(db, user["id"], "auth.mfa.login", request)
    if client == "mobile":
        access, refresh = await _issue_mobile_session(db, user, request, mfa_verified=True)
        public = _public_user(user)
        await _attach_membership(public)
        return {"user": public, "access_token": access, "refresh_token": refresh, "token_type": "bearer"}
    await _issue_session(db, response, user, request, mfa_verified=True)
    public = _public_user(user)
    await _attach_membership(public)
    return public


@router.post("/consent")
async def accept_current_consent(body: ConsentBody, user: dict = Depends(get_current_user)):
    if not (body.accept_privacy and body.accept_terms):
        raise HTTPException(400, "Datenschutz und Nutzungsbedingungen müssen akzeptiert werden.")
    db = get_db()
    privacy_version = os.environ.get("PRIVACY_POLICY_VERSION", "2026-08-26")
    terms_version = os.environ.get("TERMS_VERSION", "2026-08-26")
    now = now_utc()
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "accepted_privacy": True, "accepted_terms": True,
        "privacy_policy_version": privacy_version, "terms_version": terms_version,
        "consent_required": False, "consent_updated_at": now.isoformat(), "updated_at": now.isoformat(),
    }})
    await _record_registration_consents(
        db, user["id"], privacy=True, terms=True,
        newsletter=bool(user.get("newsletter_consent")), source="policy_reconsent",
    )
    return {"ok": True, "privacy_policy_version": privacy_version, "terms_version": terms_version}


@router.get("/mfa/status")
async def mfa_status(user: dict = Depends(get_current_user)):
    db = get_db()
    secret_state = await db.users.find_one(
        {"id": user["id"]},
        {"_id": 0, "mfa_recovery_code_hashes": 1},
    ) or {}
    return {
        "required_for_admin": user.get("role") in ADMIN_ROLES,
        "enabled": bool(user.get("mfa_enabled")),
        "session_verified": bool(user.get("auth_mfa_verified")),
        "recovery_codes_remaining": len(secret_state.get("mfa_recovery_code_hashes") or []),
    }


@router.post("/mfa/setup")
async def setup_mfa(body: MfaPasswordBody, request: Request, user: dict = Depends(get_current_user)):
    if user.get("role") not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="MFA-Einrichtung ist derzeit für Administrationskonten vorgesehen.")
    await enforce_rate_limit(request, "auth:mfa-setup:user", limit=5, window_seconds=3600, subject=user["id"])
    db = get_db()
    full = await db.users.find_one({"id": user["id"]})
    if not full or not full.get("password_login_available", full.get("auth_provider") != "google"):
        raise HTTPException(status_code=400, detail="Bitte zuerst ein eigenes Passwort über Passwort vergessen setzen.")
    if not verify_password(body.current_password, full.get("password_hash") or ""):
        raise HTTPException(status_code=400, detail="Aktuelles Passwort falsch")
    secret = generate_totp_secret()
    now = now_utc()
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "mfa_pending_secret": encrypt_secret(secret),
        "mfa_pending_created_at": now,
        "updated_at": now.isoformat(),
    }})
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "club_name": 1}) or {}
    issuer = branding.get("club_name") or "THE LION SQUAD"
    return {"secret": secret, "provisioning_uri": provisioning_uri(secret, user["email"], issuer)}


@router.post("/mfa/enable")
async def enable_mfa(body: MfaCodeBody, request: Request, user: dict = Depends(get_current_user)):
    db = get_db()
    full = await db.users.find_one({"id": user["id"]})
    pending_at = as_utc_datetime((full or {}).get("mfa_pending_created_at"))
    secret = decrypt_secret((full or {}).get("mfa_pending_secret"))
    if not secret or not pending_at or pending_at < datetime.now(timezone.utc) - timedelta(minutes=10):
        raise HTTPException(status_code=400, detail="MFA-Einrichtung ist abgelaufen. Bitte neu starten.")
    if not verify_totp(secret, body.code):
        raise HTTPException(status_code=400, detail="Der Bestätigungscode ist ungültig.")
    recovery_codes = generate_recovery_codes()
    now = now_utc()
    await db.users.update_one({"id": user["id"]}, {
        "$set": {
            "mfa_enabled": True,
            "mfa_secret": encrypt_secret(secret),
            "mfa_recovery_code_hashes": [hash_token(code) for code in recovery_codes],
            "mfa_enabled_at": now,
            "updated_at": now.isoformat(),
        },
        "$unset": {"mfa_pending_secret": "", "mfa_pending_created_at": ""},
    })
    await _security_audit(db, user["id"], "auth.mfa.enabled", request)
    return {"ok": True, "recovery_codes": recovery_codes, "requires_new_login": True}


@router.post("/mfa/disable")
async def disable_mfa(body: MfaDisableBody, request: Request, user: dict = Depends(get_current_user)):
    db = get_db()
    full = await db.users.find_one({"id": user["id"]})
    if not full or not full.get("mfa_enabled"):
        raise HTTPException(status_code=400, detail="MFA ist nicht aktiviert.")
    if not verify_password(body.current_password, full.get("password_hash") or ""):
        raise HTTPException(status_code=400, detail="Aktuelles Passwort falsch")
    if not await _verify_mfa_code(db, full, body.code):
        raise HTTPException(status_code=400, detail="MFA- oder Wiederherstellungscode ist ungültig.")
    now = now_utc()
    await db.users.update_one({"id": user["id"]}, {
        "$set": {"mfa_enabled": False, "updated_at": now.isoformat()},
        "$unset": {"mfa_secret": "", "mfa_recovery_code_hashes": "", "mfa_enabled_at": ""},
    })
    await _revoke_all_auth_sessions(db, user["id"], "mfa_disabled")
    await _security_audit(db, user["id"], "auth.mfa.disabled", request)
    return {"ok": True, "requires_new_login": True}


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
    is_invite = doc.get("purpose") == "admin_invite"
    if is_invite and not (body.accept_privacy and body.accept_terms):
        raise HTTPException(status_code=400, detail="Datenschutz und Nutzungsbedingungen müssen für die Account-Aktivierung akzeptiert werden.")
    now = now_utc()
    updates = {
        "password_hash": hash_password(body.new_password),
        "password_setup_required": False,
        "password_login_available": True,
        "auth_provider": "hybrid",
        "email_verified": True,
        "updated_at": now.isoformat(),
    }
    if is_invite:
        updates.update({
            "accepted_privacy": True, "accepted_terms": True, "consent_required": False,
            "privacy_policy_version": os.environ.get("PRIVACY_POLICY_VERSION", "2026-08-26"),
            "terms_version": os.environ.get("TERMS_VERSION", "2026-08-26"),
        })
    await db.users.update_one(
        {"id": doc["user_id"]},
        {"$set": updates},
    )
    if is_invite:
        await _record_registration_consents(
            db, doc["user_id"], privacy=True, terms=True, newsletter=False, source="admin_invitation",
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
