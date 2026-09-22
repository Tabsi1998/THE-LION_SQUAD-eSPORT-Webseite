"""Website passkey enrollment and login using verified WebAuthn ceremonies."""
import json
import ipaddress
import os
import re
import secrets
from datetime import timedelta
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError
from starlette.concurrency import run_in_threadpool
from webauthn import (
    generate_authentication_options, generate_registration_options, options_to_json,
    verify_authentication_response, verify_registration_response,
)
from webauthn.helpers import bytes_to_base64url, base64url_to_bytes
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria, PublicKeyCredentialDescriptor,
    ResidentKeyRequirement, UserVerificationRequirement,
)

from auth import get_current_user, hash_token, verify_password
from database import get_db
from models import now_utc
from routes.auth_routes import (
    _attach_membership, _current_session_family,
    _eligible_session_user, _issue_session, _public_user, _requires_admin_mfa,
    _security_audit,
)
from services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api/auth/passkeys", tags=["passkeys"])


class PasswordProof(BaseModel):
    current_password: str = Field(default="", max_length=1024)


class RegistrationStart(PasswordProof):
    name: str = Field(default="Mein Passkey", min_length=1, max_length=80)


class CredentialResponse(BaseModel):
    credential: dict
    # „Angemeldet bleiben“ (#348) - nur beim Anmelden von Belang.
    remember: bool = True


def passkey_configuration():
    if os.environ.get("PASSKEY_ENABLED", "true").lower() != "true":
        return None
    try:
        parsed = urlsplit(os.environ.get("FRONTEND_URL", "").strip())
        local = parsed.hostname == "localhost" and os.environ.get("APP_ENV", "development") not in {"production", "prod"}
        if not parsed.hostname or (parsed.scheme != "https" and not (local and parsed.scheme == "http")):
            return None
        if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
            return None
        if parsed.port and not local and parsed.port != 443:
            return None
        try:
            ipaddress.ip_address(parsed.hostname)
        except ValueError:
            pass
        else:
            return None
        authority = parsed.hostname.lower()
        if parsed.port and not (parsed.scheme == "https" and parsed.port == 443) and not (parsed.scheme == "http" and parsed.port == 80):
            authority += f":{parsed.port}"
        return {"origin": f"{parsed.scheme}://{authority}", "rp_id": parsed.hostname.lower(), "secure": parsed.scheme == "https"}
    except ValueError:
        return None


def _config(request=None):
    config = passkey_configuration()
    if not config:
        raise HTTPException(503, "Passkeys sind für diese Website derzeit nicht verfügbar.")
    if request is not None and request.headers.get("origin") != config["origin"]:
        raise HTTPException(403, "Bitte Passkeys direkt auf der Website verwenden.")
    return config


def _credential_id(body):
    identifier = body.credential.get("id")
    if not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,1400}", identifier) or len(json.dumps(body.credential)) > 65536:
        raise HTTPException(400, "Ungültige Passkey-Antwort.")
    return identifier


async def _management_proof(db, user, password, request):
    await enforce_rate_limit(request, "passkey:manage", limit=8, window_seconds=900, subject=user["id"])
    current = _eligible_session_user(await db.users.find_one({"id": user["id"]}))
    if current.get("email_verified") is not True:
        raise HTTPException(403, "Bitte zuerst deine E-Mail-Adresse bestätigen.")
    if _requires_admin_mfa(current) and not user.get("auth_mfa_verified"):
        raise HTTPException(403, "Bitte zuerst deine Admin-Anmeldung mit MFA bestätigen.")
    if not current.get("password_hash") or not await run_in_threadpool(verify_password, password, current["password_hash"]):
        raise HTTPException(401, "Bitte bestätige dein aktuelles Passwort.")
    return current


async def _challenge(db, request, response, config, kind, challenge, **metadata):
    ticket = secrets.token_urlsafe(32)
    await db.passkey_challenges.insert_one({
        "_id": hash_token(ticket), "kind": kind, "challenge": bytes_to_base64url(challenge),
        "origin": config["origin"], "rp_id": config["rp_id"],
        "expires_at": now_utc() + timedelta(minutes=5), **metadata,
    })
    response.set_cookie(f"tls_passkey_{kind}", ticket, max_age=300, httponly=True,
                        secure=config["secure"], samesite="strict", path="/api/auth/passkeys")


async def _consume(db, request, response, config, kind, **binding):
    ticket = request.cookies.get(f"tls_passkey_{kind}", "")
    if not ticket:
        raise HTTPException(401, "Passkey-Anfrage abgelaufen. Bitte erneut starten.")
    challenge = await db.passkey_challenges.find_one_and_delete({
        "_id": hash_token(ticket), "kind": kind, "expires_at": {"$gt": now_utc()},
        "origin": config["origin"], "rp_id": config["rp_id"], **binding,
    })
    response.delete_cookie(f"tls_passkey_{kind}", path="/api/auth/passkeys", secure=config["secure"], httponly=True, samesite="strict")
    if not challenge:
        raise HTTPException(401, "Passkey-Anfrage abgelaufen oder bereits verwendet. Bitte erneut starten.")
    return challenge


@router.get("/status")
async def status():
    return {"enabled": bool(passkey_configuration())}


@router.get("")
async def list_passkeys(user: dict = Depends(get_current_user)):
    rows = await get_db().passkeys.find({"user_id": user["id"]}, {
        "_id": 1, "name": 1, "created_at": 1, "last_used_at": 1,
    }).sort("created_at", -1).to_list(20)
    return [{"id": row["_id"], "name": row.get("name", "Passkey"),
             "created_at": row.get("created_at"), "last_used_at": row.get("last_used_at")} for row in rows]


@router.post("/register/options")
async def registration_options(body: RegistrationStart, request: Request, response: Response, user: dict = Depends(get_current_user)):
    config = _config(request)
    db = get_db()
    current = await _management_proof(db, user, body.current_password, request)
    family = await _current_session_family(db, request)
    if not family:
        raise HTTPException(401, "Bitte erneut anmelden.")
    existing = await db.passkeys.find({"user_id": user["id"]}, {"_id": 1}).to_list(10)
    if len(existing) >= 10:
        raise HTTPException(400, "Bitte zuerst einen nicht mehr benötigten Passkey entfernen.")
    options = generate_registration_options(
        rp_id=config["rp_id"], rp_name="THE LION SQUAD", user_id=user["id"].encode(),
        user_name=current["email"], user_display_name=current.get("display_name") or current.get("username"),
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED, require_resident_key=True,
            user_verification=UserVerificationRequirement.REQUIRED,
        ), exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(row["_id"])) for row in existing],
    )
    await _challenge(db, request, response, config, "register", options.challenge,
                     user_id=user["id"], family=family, name=body.name.strip() or "Mein Passkey")
    return json.loads(options_to_json(options))


@router.post("/register/verify")
async def registration_verify(body: CredentialResponse, request: Request, response: Response, user: dict = Depends(get_current_user)):
    config = _config(request)
    db = get_db()
    await enforce_rate_limit(request, "passkey:register-verify", limit=15, window_seconds=900, subject=user["id"])
    _credential_id(body)
    current = _eligible_session_user(await db.users.find_one({"id": user["id"]}))
    if current.get("email_verified") is not True or (_requires_admin_mfa(current) and not user.get("auth_mfa_verified")):
        raise HTTPException(403, "Bitte E-Mail-Adresse und Admin-Anmeldung bestätigen.")
    family = await _current_session_family(db, request)
    if not family:
        raise HTTPException(401, "Bitte erneut anmelden.")
    challenge = await _consume(db, request, response, config, "register", user_id=user["id"], family=family)
    try:
        verified = await run_in_threadpool(verify_registration_response, credential=body.credential,
            expected_challenge=base64url_to_bytes(challenge["challenge"]), expected_rp_id=config["rp_id"],
            expected_origin=config["origin"], require_user_verification=True)
    except Exception as exc:
        raise HTTPException(400, "Passkey konnte nicht bestätigt werden. Bitte erneut starten.") from exc
    try:
        await db.passkeys.insert_one({
            "_id": bytes_to_base64url(verified.credential_id), "user_id": user["id"],
            "public_key": bytes_to_base64url(verified.credential_public_key), "sign_count": verified.sign_count,
            "rp_id": config["rp_id"], "name": challenge["name"], "created_at": now_utc(), "last_used_at": None,
        })
    except DuplicateKeyError as exc:
        raise HTTPException(409, "Dieser Passkey ist bereits registriert.") from exc
    await _security_audit(db, user["id"], "auth.passkey.registered", request)
    return {"ok": True}


@router.post("/login/options")
async def login_options(request: Request, response: Response):
    config = _config(request)
    await enforce_rate_limit(request, "passkey:login-options", limit=30, window_seconds=900)
    options = generate_authentication_options(rp_id=config["rp_id"], user_verification=UserVerificationRequirement.REQUIRED)
    await _challenge(get_db(), request, response, config, "login", options.challenge)
    return json.loads(options_to_json(options))


@router.post("/login/verify")
async def login_verify(body: CredentialResponse, request: Request, response: Response):
    config = _config(request)
    db = get_db()
    await enforce_rate_limit(request, "passkey:login-verify", limit=30, window_seconds=900)
    identifier = _credential_id(body)
    challenge = await _consume(db, request, response, config, "login")
    key = await db.passkeys.find_one({"_id": identifier, "rp_id": config["rp_id"]})
    if not key:
        raise HTTPException(401, "Passkey-Anmeldung fehlgeschlagen.")
    try:
        verified = await run_in_threadpool(verify_authentication_response, credential=body.credential,
            expected_challenge=base64url_to_bytes(challenge["challenge"]), expected_rp_id=config["rp_id"],
            expected_origin=config["origin"], credential_public_key=base64url_to_bytes(key["public_key"]),
            credential_current_sign_count=key["sign_count"], require_user_verification=True)
        handle = body.credential.get("response", {}).get("userHandle")
        if handle and base64url_to_bytes(handle) != key["user_id"].encode():
            raise ValueError("User handle mismatch")
    except Exception as exc:
        raise HTTPException(401, "Passkey-Anmeldung fehlgeschlagen.") from exc
    updated = await db.passkeys.update_one({"_id": identifier, "sign_count": key["sign_count"]}, {
        "$set": {"sign_count": verified.new_sign_count, "last_used_at": now_utc()},
    })
    if updated.matched_count != 1:
        raise HTTPException(401, "Passkey wurde geändert. Bitte erneut anmelden.")
    user = _eligible_session_user(await db.users.find_one({"id": key["user_id"]}))
    if user.get("email_verified") is not True:
        raise HTTPException(403, "Bitte zuerst deine E-Mail-Adresse bestätigen.")
    await _security_audit(db, user["id"], "auth.passkey.login", request)
    # Ein Passkey mit Gerätesperre zählt als zweiter Faktor (Entscheidung des Betreibers, #358):
    # Der Server verlangt die Gerätesperre (`require_user_verification`), also hat die Person
    # Gerät und Fingerabdruck/Gesicht/PIN vorgezeigt. Die Sitzung ist damit bestätigt - auch für
    # Adminbereiche. Der Code aus der Authenticator-App bleibt dem Passwort-Login vorbehalten.
    await _issue_session(db, response, user, request, mfa_verified=True, remember=body.remember)
    public = _public_user(user)
    await _attach_membership(public)
    return public


@router.post("/{credential_id}/remove")
async def remove_passkey(credential_id: str, body: PasswordProof, request: Request, user: dict = Depends(get_current_user)):
    _config(request)
    db = get_db()
    await _management_proof(db, user, body.current_password, request)
    result = await db.passkeys.delete_one({"_id": credential_id, "user_id": user["id"]})
    if not result.deleted_count:
        raise HTTPException(404, "Passkey nicht gefunden.")
    await _security_audit(db, user["id"], "auth.passkey.removed", request)
    return {"ok": True}
