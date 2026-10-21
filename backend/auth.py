"""JWT auth helpers + password hashing + role deps."""
import asyncio
import logging
import os
import weakref
import anyio
import bcrypt
import jwt
import hashlib
import secrets
from urllib.parse import urlparse
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException, Request, Depends, Response
from database import get_db
from services import password_policy
from services.private_fields import private_projection

logger = logging.getLogger("tls.auth")

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = 60 * 12  # 12h
REFRESH_TOKEN_DAYS = 14
# „Angemeldet bleiben“ (#348): 90 Tage, die mit jeder Nutzung neu beginnen. Ohne den Haken
# endet die Sitzung mit dem Browser (Cookies ohne Ablaufdatum) und am Server nach einem Tag
# ohne Nutzung. Sitzungen von vor #348 tragen kein Kennzeichen und gelten als „bleiben“.
REMEMBER_DAYS = 90
SESSION_ONLY_HOURS = 24
# „Zuletzt aktiv“ (#942) wandert mit jedem normalen Aufruf mit - höchstens einmal je Stunde ein Schreibzugriff.
LAST_ACTIVE_TOUCH_MINUTES = 60
CSRF_TOKEN_BYTES = 32
# Short grace so in-flight actions are not hard-killed mid-request by benign
# security revocations (password reset / admin action). Theft & logout stay immediate.
ACCESS_REVOCATION_GRACE_SECONDS = 30
GRACEABLE_REVOCATION_REASONS = {"password_reset", "password_change", "admin_revoked"}

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


# Passwortvertrag (#1033): jeder Hash, der nach dem Vertrag entsteht, trägt diese Markierung am Konto. Mit ihr wird
# beim Anmelden nur die Form des Vertrags geprüft; ohne sie (Konten von vorher) gilt zusätzlich der frühere Weg.
PASSWORD_CONTRACT_FIELD = "password_contract"
PASSWORD_CONTRACT_VERSION = 2


def hash_password(password: str) -> str:
    """Hash eines neuen Passworts nach dem Passwortvertrag (#1033); außerhalb des Vertrags ``ValueError``.

    Gespeichert wird er nur über ``password_fields`` - dort kommt die Markierung dazu."""
    return bcrypt.hashpw(password_policy.new_password_bytes(password), bcrypt.gensalt()).decode("utf-8")


def password_fields(password: str) -> dict:
    """Die Kontofelder für ein neues Passwort: Hash samt Vertragsmarkierung. Jede Stelle, die ein Passwort setzt."""
    return {"password_hash": hash_password(password), PASSWORD_CONTRACT_FIELD: PASSWORD_CONTRACT_VERSION}


def has_password_contract(user: dict) -> bool:
    return user.get(PASSWORD_CONTRACT_FIELD) == PASSWORD_CONTRACT_VERSION


_STAND_IN_HASH: bytes | None = None


def _stand_in_hash() -> bytes:
    """Ein Hash mit denselben Kosten wie jeder echte, zu dem kein Passwort passt - einmal je Prozess erzeugt."""
    global _STAND_IN_HASH
    if _STAND_IN_HASH is None:
        _STAND_IN_HASH = bcrypt.hashpw(secrets.token_hex(32).encode("ascii"), bcrypt.gensalt())
    return _STAND_IN_HASH


def _has_usable_hash(user: dict | None) -> bool:
    stored = (user or {}).get("password_hash")
    return isinstance(stored, str) and stored.startswith("$2") and len(stored) == 60


def _stand_in_checks(count: int) -> None:
    for _ in range(max(0, count)):
        bcrypt.checkpw(b"-", _stand_in_hash())


def _matches(candidates: list[bytes], hashed, work: int) -> bool:
    """Prüft die Kandidaten gegen den Hash. Bleibt es ohne Treffer, sind es immer genau ``work`` vollwertige
    Vergleiche (#1510): fehlende werden gegen den Platzhalter-Hash nachgeholt."""
    try:
        stored = hashed.encode("utf-8")
    except Exception:
        stored = None
    done = 0
    for candidate in candidates if stored is not None else []:
        done += 1
        try:
            if bcrypt.checkpw(candidate, stored):
                return True
        except Exception:
            break
    _stand_in_checks(work - done)
    return False


def password_work(plain: str) -> int:
    """Wie viele Vergleiche eine abgelehnte Prüfung dieser Eingabe kostet: so viele Formen, wie die Eingabe hat
    (``verification_candidates``: eins, bei nicht vereinheitlichter Eingabe zwei) - für jedes Konto gleich."""
    try:
        return max(1, len(password_policy.verification_candidates(plain)))
    except Exception:
        return 1


def verify_password(plain: str, hashed: str, *, strict: bool = False) -> bool:
    """Prüft eine Eingabe gegen einen Hash. ``strict``: nur die Form des Vertrags, sonst auch der frühere Weg.

    Ein Konto von vor dem Vertrag braucht beide Formen der Eingabe: gehasht wurde damals, wie das Gerät sie schickte,
    heute kann dasselbe Passwort in der anderen Unicode-Form ankommen. Damit eine Ablehnung trotzdem nichts über das
    Konto verrät, kostet sie immer ``password_work`` Vergleiche - auch bei strenger Prüfung und ohne prüfbare Form."""
    work = password_work(plain)
    try:
        if strict:
            exact = password_policy.contract_bytes(plain)
            candidates = [exact] if exact is not None else []
        else:
            candidates = password_policy.verification_candidates(plain)
    except Exception:
        candidates = []
    return _matches(candidates, hashed, work)


def verify_user_password(user: dict, plain: str) -> bool:
    """Prüft das Passwort eines Kontos - streng, wenn das Konto die Vertragsmarkierung trägt."""
    return verify_password(plain, user.get("password_hash") or "", strict=has_password_contract(user))


# bcrypt läuft nie im Event-Loop (#1510): höchstens so viele Prüfungen gleichzeitig in Hintergrund-Threads.
PASSWORD_WORKERS = 4
_PASSWORD_LIMITERS: "weakref.WeakKeyDictionary" = weakref.WeakKeyDictionary()


def _password_limiter() -> anyio.CapacityLimiter:
    loop = asyncio.get_running_loop()
    limiter = _PASSWORD_LIMITERS.get(loop)
    if limiter is None:
        limiter = anyio.CapacityLimiter(PASSWORD_WORKERS)
        _PASSWORD_LIMITERS[loop] = limiter
    return limiter


async def run_password_work(function, *args):
    """``function(*args)`` (bcrypt) in einem der ``PASSWORD_WORKERS`` Threads - der Event-Loop bleibt frei."""
    return await anyio.to_thread.run_sync(function, *args, limiter=_password_limiter())


async def verify_user_password_async(user: dict, plain: str) -> bool:
    """``verify_user_password`` über den begrenzten Pool - für Routen, die ein Passwort bestätigen lassen."""
    return await run_password_work(verify_user_password, user, plain)


async def verify_and_upgrade_password(db, user: dict | None, plain: str) -> bool:
    """Anmeldung: prüft das Passwort und hasht ein Konto ohne Markierung nach dem Vertrag neu, wenn die Eingabe
    in dessen Form passt (höchstens 72 Byte). So verschwinden Hashes von vor dem Vertrag mit der Zeit.

    Einheitlich (#1510): ohne Konto oder ohne verwendbaren Hash wird trotzdem ein vollwertiger Vergleich gerechnet -
    eine abgelehnte Anmeldung kostet und antwortet immer gleich."""
    if not _has_usable_hash(user):
        await run_password_work(verify_password, plain, _stand_in_hash().decode("ascii"))
        return False
    if not await verify_user_password_async(user, plain):
        return False
    if has_password_contract(user):
        return True
    exact = password_policy.contract_bytes(plain)
    if exact is None:
        return True
    fresh = (await run_password_work(bcrypt.hashpw, exact, bcrypt.gensalt())).decode("utf-8")
    try:
        # Nur, wenn sich der Hash seit dem Lesen nicht geändert hat - ein gleichzeitig gesetztes Passwort bleibt.
        await db.users.update_one(
            {"id": user["id"], "password_hash": user.get("password_hash")},
            {"$set": {"password_hash": fresh, PASSWORD_CONTRACT_FIELD: PASSWORD_CONTRACT_VERSION}},
        )
    except Exception:
        # Das Neu-Hashen ist eine Aufräumarbeit; die Anmeldung scheitert daran nicht. Beim nächsten Mal wieder.
        logger.warning("Passwort-Hash konnte nicht nach dem Vertrag erneuert werden", exc_info=True)
    return True


def create_access_token(user_id: str, email: str, role: str, session_id: str, family_id: str | None = None, *, mfa_verified: bool = False) -> str:
    # `iat` (#1519): die App rechnet die Laufzeit (exp - iat) ab Erhalt, statt `exp` mit der Geräteuhr zu vergleichen.
    issued_at = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "sid": session_id,
        "iat": issued_at,
        "exp": issued_at + timedelta(minutes=ACCESS_TOKEN_MINUTES),
        "type": "access",
        "mfa": bool(mfa_verified),
    }
    if family_id:
        payload["fam"] = family_id
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(
    user_id: str,
    token_id: str,
    family_id: str,
    expires_at: datetime | None = None,
    *,
    mfa_verified: bool = False,
    remember: bool = True,
) -> str:
    payload = {
        "sub": user_id,
        "jti": token_id,
        "fid": family_id,
        "exp": expires_at or refresh_expires_at(remember),
        "type": "refresh",
        "mfa": bool(mfa_verified),
        "rem": bool(remember),
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def refresh_expires_at(remember: bool = True) -> datetime:
    if remember:
        return datetime.now(timezone.utc) + timedelta(days=REMEMBER_DAYS)
    return datetime.now(timezone.utc) + timedelta(hours=SESSION_ONLY_HOURS)


def token_remembers(payload: dict | None) -> bool:
    """Ob diese Sitzung „angemeldet bleiben“ soll. Ohne Kennzeichen (Sitzung von früher): ja."""
    return (payload or {}).get("rem") is not False


def as_utc_datetime(value) -> datetime | None:
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


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
        domain = explicit.lower().strip(".")
        if not domain or "." not in domain or any(char in domain for char in "/:@"):
            raise RuntimeError("AUTH_COOKIE_DOMAIN must be a hostname without scheme or port.")
        frontend_host = (urlparse(os.environ.get("FRONTEND_URL", "")).hostname or "").lower().strip(".")
        if frontend_host and frontend_host != domain and not frontend_host.endswith(f".{domain}"):
            raise RuntimeError("AUTH_COOKIE_DOMAIN must contain the configured FRONTEND_URL host.")
        return f".{domain}"
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


def set_auth_cookies(response: Response, access: str, refresh: str, csrf_token: str | None = None, *, remember: bool = True):
    secure = _secure_cookies()
    csrf_token = csrf_token or new_csrf_token()
    domain = _cookie_domain()
    # Ohne „Angemeldet bleiben“ bekommen die Cookies kein Ablaufdatum: Der Browser wirft sie
    # weg, wenn er geschlossen wird.
    long_lived = REMEMBER_DAYS * 24 * 3600 if remember else None
    response.set_cookie(
        "access_token", access, httponly=True, secure=secure, samesite="lax",
        max_age=ACCESS_TOKEN_MINUTES * 60 if remember else None, path="/", domain=domain,
    )
    response.set_cookie(
        "refresh_token", refresh, httponly=True, secure=secure, samesite="lax",
        max_age=long_lived, path="/", domain=domain,
    )
    response.set_cookie(
        "csrf_token", csrf_token, httponly=False, secure=secure, samesite="lax",
        max_age=long_lived, path="/", domain=domain,
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


async def touch_session_activity(db, user_id: str, family_id: str, now: datetime) -> None:
    """„Zuletzt aktiv“ fortschreiben (#942): ein Schreibzugriff nur, wenn der Stand älter als eine Stunde ist - sonst
    zeigte die Sitzungsliste bei der App dauerhaft „Angemeldet“, weil nur Anmeldung und Erneuerung schrieben."""
    try:
        await db.auth_sessions.update_one(
            {
                "family_id": family_id,
                "user_id": user_id,
                "$or": [{"last_active": {"$lt": now - timedelta(minutes=LAST_ACTIVE_TOUCH_MINUTES)}}, {"last_active": None}],
            },
            {"$set": {"last_active": now}},
        )
    except Exception:  # noqa: BLE001 - die Anzeige ist kein Grund, einen Aufruf scheitern zu lassen
        logger.debug("last_active nicht aktualisiert", exc_info=True)


async def get_current_user(request: Request) -> dict:
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = _decode(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    db = get_db()
    user_id = payload.get("sub")
    session_id = payload.get("sid")
    if not user_id or not session_id:
        raise HTTPException(status_code=401, detail="Session expired")
    now = datetime.now(timezone.utc)
    session_ok = False
    family_id = payload.get("fam")
    if family_id:
        # New tokens validate against the family session document. Access tokens
        # survive benign refresh rotations; only a real family revocation ends them.
        session = await db.auth_sessions.find_one(
            {"family_id": family_id, "user_id": user_id},
            {"_id": 0, "revoked": 1, "revoked_at": 1, "revocation_reason": 1, "expires_at": 1},
        )
        if session:
            expires_at = as_utc_datetime(session.get("expires_at"))
            if not expires_at or expires_at > now:
                if not session.get("revoked"):
                    session_ok = True
                else:
                    reason = session.get("revocation_reason")
                    revoked_at = as_utc_datetime(session.get("revoked_at"))
                    if (
                        reason in GRACEABLE_REVOCATION_REASONS
                        and revoked_at
                        and now - revoked_at <= timedelta(seconds=ACCESS_REVOCATION_GRACE_SECONDS)
                    ):
                        session_ok = True
    else:
        # Legacy tokens (issued before family sessions) keep the jti check.
        legacy = await db.refresh_tokens.find_one({
            "jti": session_id,
            "user_id": user_id,
            "revoked": {"$ne": True},
        }, {"_id": 0, "expires_at": 1})
        if legacy:
            expires_at = as_utc_datetime(legacy.get("expires_at"))
            if not expires_at or expires_at > now:
                session_ok = True
    if not session_ok:
        raise HTTPException(status_code=401, detail="Session expired")
    if family_id:
        await touch_session_activity(db, user_id, family_id, now)
    user = await db.users.find_one({"id": user_id}, private_projection())
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.get("is_active") is False:
        raise HTTPException(status_code=403, detail="Account is inactive")
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
    # Turnierleitung über alle Turniere (Rolle oder Freigabe, #1350) oder Helfer in mindestens einem Turnier oder
    # einer Fast Lap; Moderation allein zählt nicht. Der Einsatz steht getrennt daneben (#1028): eine Turnierleitung
    # ohne bestätigte Zwei-Faktor-Anmeldung behält ihn - die Rechte über alle Turniere nicht.
    from services.permissions import is_tournament_lead

    assignment_query = {"user_id": user["id"], "is_active": {"$ne": False}}
    user["has_staff_assignment"] = bool(
        await db.tournament_staff_assignments.count_documents(assignment_query)
        or await db.f1_staff_assignments.count_documents(assignment_query)
    )
    user["is_tournament_staff"] = bool(is_tournament_lead(user) or user["has_staff_assignment"])
    user["auth_mfa_verified"] = bool(payload.get("mfa"))
    privacy_version = os.environ.get("PRIVACY_POLICY_VERSION", "2026-08-26")
    terms_version = os.environ.get("TERMS_VERSION", "2026-08-26")
    user["consent_required"] = bool(
        user.get("accepted_privacy") is not True
        or user.get("accepted_terms") is not True
        or user.get("privacy_policy_version") != privacy_version
        or user.get("terms_version") != terms_version
    )
    user["required_privacy_policy_version"] = privacy_version
    user["required_terms_version"] = terms_version
    return user


async def get_optional_user(request: Request) -> dict | None:
    try:
        return await get_current_user(request)
    except HTTPException:
        return None


def require_role(*allowed_roles: str):
    """Returns a FastAPI dependency that ensures user has one of the allowed roles."""
    async def dep(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") in {"tournament_admin", "club_admin", "superadmin"}:
            if not user.get("mfa_enabled") or not user.get("auth_mfa_verified"):
                raise HTTPException(status_code=403, detail="Für den Adminbereich ist eine bestätigte Zwei-Faktor-Anmeldung erforderlich.")
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
    """Aktive Vereinsmitglieder - und wer den Bereich Vereinsverwaltung oder System hat, wie bei
    Mitglieder-Inhalten (services/visibility.py, #1350). Die Rolle Turnierleitung allein reicht nicht."""
    async def dep(user: dict = Depends(get_current_user)) -> dict:
        from services.visibility import sees_member_content

        if await sees_member_content(user):
            return user
        raise HTTPException(status_code=403, detail="Nur Vereinsmitglieder.")
    return dep


def require_area(*areas: str):
    """Bereich statt Rang (#287): erlaubt, wer einen der Bereiche hat – aus Rolle,
    Freigabe oder Vorstandsposten. Zwei-Faktor ist Pflicht, sobald ein Bereich
    außer „Moderation“ verlangt wird (#291). Die Entscheidung trifft ``area_refusal`` - dieselbe wie ``can_use_area``
    (#1479)."""
    wanted = tuple(areas)

    async def dep(user: dict = Depends(get_current_user)) -> dict:
        from services.permissions import area_refusal

        refusal = await area_refusal(user, wanted)
        if refusal:
            raise HTTPException(status_code=403, detail=refusal)
        return user

    return dep


def require_any_admin():
    """Irgendein Adminbereich – für Tageszentrale, Systemstatus und Downloads."""
    return require_area("tournaments", "content", "club", "system")


def require_dashboard():
    """Startseite der Verwaltung (#1353, #992): jeder Verwaltungsbereich - auch Finanzen (Kassier), mit Zwei-Faktor.
    Spiegel von ``ADMIN_AREAS`` im Web (Menüeintrag „Dashboard“, Seiten-Schutz von /admin)."""
    return require_area("tournaments", "content", "club", "finance", "system")


def require_admin():
    """Turnierleitung: Turniere, Events, Stationen, Fast Lap, Saisons, Gewinne (#288)."""
    return require_area("tournaments")


def require_club_admin():
    """System: Einstellungen, Game-Server, Betrieb, Logs – Club-Admin und Superadmin, mit Zwei-Faktor (#291)."""
    return require_area("system")


def require_super():
    async def dep(user: dict = Depends(require_role("superadmin"))) -> dict:
        if not user.get("mfa_enabled") or not user.get("auth_mfa_verified"):
            raise HTTPException(status_code=403, detail="Für diese Aktion ist eine bestätigte Zwei-Faktor-Anmeldung erforderlich.")
        return user
    return dep
