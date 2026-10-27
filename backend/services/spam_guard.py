"""Spamschutz für öffentliche Formulare (#2067) - ohne externen Dienst, ohne Captcha.

Anlass: Über das Kontaktformular kamen Bot-Nachrichten, deren Name, Betreff und Text aus Zufallszeichen bestehen
(„KuHHNCqrrWoOGwLSltUsNs“) und deren Absender Gmail-Adressen mit vielen Punkten sind. Geschützt war nur ein IP-Limit.

Welche Formulare ohne Konto erreichbar sind und hier geprüft werden (``FORMS``):

- ``contact``: Kontaktformular (``POST /api/contact/submit``), nur auf der Website.
- ``register``: Registrierung (``POST /api/auth/register``) auf der Website und ``POST /api/auth/mobile/register`` aus
  der LionsAPP.
- ``forgot_password`` und ``resend_verification``: „Passwort vergessen“ und „Bestätigungsmail erneut senden“ - Website
  und App rufen dieselbe Adresse auf.

Die Stufen, in dieser Reihenfolge:

1. **Limits** je IP und je E-Mail über ein Zeitfenster (``services/rate_limit``). Gezählt wird unter einem Schlüssel-Hash
   (HMAC mit dem Server-Geheimnis), nie unter der Adresse selbst; die Zähler laufen nach zwei Fenstern ab. Ein
   überschrittenes Limit antwortet wie bisher mit 429 - echte Menschen sollen wissen, warum es nicht geht.
2. **Honeypot**: ein unsichtbares Feld (``HONEYPOT_FIELD``), das nur ein Bot ausfüllt.
3. **Formular-Token** (``issue_token``): ``<formular>.<ausgestellt>.<zufall>.<HMAC>``. Zu schnell (Vorgabe 3 s),
   abgelaufen (Vorgabe 2 h), gefälscht, für ein anderes Formular oder zu oft benutzt heißt: sicher ein Bot.
4. **Cloudflare Turnstile** (optional, Vorgabe aus): siehe ``turnstile_*``.
5. **Inhalt** (``score_content``): Punkte mit Gründen - Zufallszeichen in allen Feldern, Gmail mit Punkt-Trick, viele
   Links, bekannte Spam-Wörter und der Wortfilter der Moderation.

Ergebnis (``Verdict``): ``drop`` (sicher Spam - still verwerfen, die Antwort sieht aus wie ein Erfolg), ``suspect``
(nur der Inhalt ist verdächtig - annehmen, markieren, keine Mail an den Vorstand) oder ``accept``. Gespeichert wird je
Ergebnis nur ein Zähler mit Grund und Stunde (``spam_guard_stats``), nie Inhalt, Adresse oder IP.

Die App schickt (noch) kein Token: Für ``client="app"`` und für die beiden geteilten Adressen ohne Token gelten
Limits und Inhalt, aber kein Token-Zwang (Übergangsregel). Schickt ein Client ein Token mit, wird es immer geprüft.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import re
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException, Request
from pymongo import ReturnDocument

from models import new_id, now_utc
from services.log_safe import log_safe, mask_addresses
from services.secret_store import decrypt_secret, encrypt_secret, secret_is_configured

logger = logging.getLogger(__name__)

SETTINGS_ID = "spam_guard"
FORMS = ("contact", "register", "forgot_password", "resend_verification")
FORM_LABELS = {
    "contact": "Kontaktformular",
    "register": "Registrierung",
    "forgot_password": "Passwort vergessen",
    "resend_verification": "Bestätigungsmail erneut senden",
}
# Nur hier unterscheidet sich die Website sicher von der App: die App hat eine eigene Registrierung und kein
# Kontaktformular. „Passwort vergessen“ und „Bestätigung erneut senden“ teilen sich die Adresse mit der App.
WEB_ONLY_FORMS = ("contact", "register")
TURNSTILE_FORMS = WEB_ONLY_FORMS
LIMIT_BUCKETS = {"contact": "contact:submit", "forgot_password": "auth:forgot", "resend_verification": "auth:verify-resend"}

HONEYPOT_FIELD = "hp_fax"
TOKEN_FIELD = "form_token"
TURNSTILE_FIELD = "turnstile_token"
TOKEN_MAX_LENGTH = 200
STATS_DAYS = 90

ACCEPT, SUSPECT, DROP = "accept", "suspect", "drop"

REASON_LABELS = {
    "honeypot": "Verstecktes Feld ausgefüllt",
    "token_missing": "Ohne Formular-Token",
    "token_malformed": "Token unbrauchbar",
    "token_forged": "Token gefälscht",
    "token_wrong_form": "Token eines anderen Formulars",
    "token_too_fast": "Zu schnell abgeschickt",
    "token_expired": "Token abgelaufen",
    "token_reused": "Token zu oft benutzt",
    "turnstile_invalid": "Turnstile abgelehnt",
    "turnstile_missing": "Turnstile nicht gelöst",
    "turnstile_unavailable": "Turnstile nicht erreichbar",
    "turnstile_passed": "Turnstile bestanden",
    "random_text": "Zufallszeichen",
    "gmail_dots": "Gmail mit Punkt-Trick",
    "links": "Viele Links",
    "spam_words": "Spam-Wörter",
    "word_filter": "Wortfilter",
    "ip": "Limit je IP",
    "email": "Limit je E-Mail",
}
CONTENT_REASONS = ("random_text", "gmail_dots", "links", "spam_words", "word_filter")

DEFAULT_SPAM_WORDS = (
    "casino", "viagra", "cialis", "crypto investment", "bitcoin investment", "binary options", "seo services",
    "backlinks", "escort", "porn", "loan offer", "betting tips", "make money fast", "weight loss", "forex trading",
)
DEFAULT_WEIGHTS = {"random_text": 6, "gmail_dots": 2, "links": 3, "spam_words": 3, "word_filter_hold": 3, "word_filter_flag": 1}
DEFAULT_LIMITS = {
    # Wie bisher: Kontakt 5 je IP in 15 Minuten; neu je E-Mail. „Passwort vergessen“ und „erneut senden“ wie bisher.
    "contact": {"ip_limit": 5, "ip_window_minutes": 15, "email_limit": 5, "email_window_minutes": 60},
    "forgot_password": {"ip_limit": 8, "ip_window_minutes": 15, "email_limit": 5, "email_window_minutes": 60},
    "resend_verification": {"ip_limit": 6, "ip_window_minutes": 60, "email_limit": 3, "email_window_minutes": 60},
}
NUMBERS = {
    # Feld: (Vorgabe, kleinster Wert, größter Wert)
    "min_seconds": (3, 0, 60),
    "max_age_minutes": (120, 10, 1440),
    "token_max_uses": (5, 1, 50),
    "suspect_score": (5, 1, 100),
    "random_min_length": (12, 8, 64),
    "gmail_dots_min": (3, 2, 20),
    "links_min": (3, 1, 50),
    "peak_per_hour": (30, 5, 10000),
}
WEIGHT_RANGE = (0, 50)
LIMIT_RANGES = {"ip_limit": (1, 1000), "email_limit": (1, 1000), "ip_window_minutes": (1, 1440), "email_window_minutes": (1, 1440)}
SPAM_WORD_MIN, SPAM_WORD_MAX, SPAM_WORDS_MAX = 2, 60, 200
UPDATE_FIELDS = ("enabled", *NUMBERS, "weights", "spam_words", "limits")

TURNSTILE_MODES = ("always", "suspect")
TURNSTILE_MODE_LABELS = {"always": "Immer", "suspect": "Nur bei Verdacht"}
SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
TIMEOUT_SECONDS = 5.0
# Für Tests: ein httpx-Transport statt des Netzes. Ein echter Aufruf an Cloudflare passiert in Tests nie.
TRANSPORT: httpx.AsyncBaseTransport | None = None
TURNSTILE_TOKEN_MAX = 2048
SITE_KEY_PATTERN = re.compile(r"^[A-Za-z0-9_-]{10,100}$")
SECRET_MIN, SECRET_MAX = 10, 200
# Diese Antworten sagen, dass unsere Seite falsch eingerichtet ist oder Cloudflare hakt - nicht, dass ein Bot schreibt.
TURNSTILE_OUR_FAULT = ("missing-input-secret", "invalid-input-secret", "internal-error")
UNREADABLE_SECRET = "gespeichert, aber nicht lesbar – SETTINGS_ENCRYPTION_KEY in der .env prüfen"


class SpamGuardError(ValueError):
    """Eine Einstellung ist ungültig (Antwort 400)."""


@dataclass
class Verdict:
    form: str
    outcome: str
    reasons: list[str] = field(default_factory=list)
    score: int = 0

    @property
    def dropped(self) -> bool:
        return self.outcome == DROP

    @property
    def suspect(self) -> bool:
        return self.outcome == SUSPECT

    def record(self) -> dict:
        """Was an einer angenommenen, aber verdächtigen Nachricht steht - Punkte und Gründe, kein Inhalt."""
        return {"score": self.score, "reasons": list(self.reasons), "checked_at": now_utc().isoformat()}


def _now() -> float:
    return time.time()


# ---------------------------------------------------------------- Einstellungen


def _number(value: Any, default: int, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        return default
    return value


def _turnstile(raw: Any) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    forms = raw.get("forms") if isinstance(raw.get("forms"), dict) else {}
    return {
        "enabled": raw.get("enabled") is True,
        "mode": raw.get("mode") if raw.get("mode") in TURNSTILE_MODES else "always",
        "site_key": str(raw.get("site_key") or "") if SITE_KEY_PATTERN.match(str(raw.get("site_key") or "")) else "",
        "secret_key": str(raw.get("secret_key") or ""),
        "forms": {form: forms.get(form) is not False for form in TURNSTILE_FORMS},
        "secret_saved_at": raw.get("secret_saved_at"),
        "last_test": raw.get("last_test") if isinstance(raw.get("last_test"), dict) else None,
    }


def normalized(raw: dict | None) -> dict:
    """Die gespeicherten Einstellungen mit sicheren Vorgaben - Unsinn fällt auf die Vorgabe, Turnstile bleibt aus."""
    raw = raw or {}
    weights = raw.get("weights") if isinstance(raw.get("weights"), dict) else {}
    limits = raw.get("limits") if isinstance(raw.get("limits"), dict) else {}
    words = raw.get("spam_words")
    config = {
        "enabled": raw.get("enabled") is not False,
        **{key: _number(raw.get(key), *spec) for key, spec in NUMBERS.items()},
        "weights": {key: _number(weights.get(key), default, *WEIGHT_RANGE) for key, default in DEFAULT_WEIGHTS.items()},
        "spam_words": [str(word) for word in words if isinstance(word, str) and word.strip()]
        if isinstance(words, list) else list(DEFAULT_SPAM_WORDS),
        "limits": {},
        "turnstile": _turnstile(raw.get("turnstile")),
        "updated_at": raw.get("updated_at"),
        "updated_by": raw.get("updated_by"),
    }
    for form, defaults in DEFAULT_LIMITS.items():
        current = limits.get(form) if isinstance(limits.get(form), dict) else {}
        config["limits"][form] = {key: _number(current.get(key), value, *LIMIT_RANGES[key]) for key, value in defaults.items()}
    return config


def defaults() -> dict:
    return normalized(None)


async def load(db) -> dict:
    return normalized(await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}))


def _strict_number(name: str, value: Any, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise SpamGuardError(f"{name}: ganze Zahl von {low} bis {high}.")
    return value


def _clean_words(value: Any) -> list[str]:
    if not isinstance(value, list):
        raise SpamGuardError("Spam-Wörter: eine Liste.")
    from services.word_filter import normalize

    words, seen = [], set()
    for raw in value:
        word = " ".join(str(raw or "").split())
        if not SPAM_WORD_MIN <= len(word) <= SPAM_WORD_MAX or not normalize(word):
            raise SpamGuardError(f"Ein Spam-Wort hat {SPAM_WORD_MIN} bis {SPAM_WORD_MAX} Zeichen mit Buchstaben oder Ziffern.")
        key = normalize(word)
        if key not in seen:
            seen.add(key)
            words.append(word)
    if len(words) > SPAM_WORDS_MAX:
        raise SpamGuardError(f"Höchstens {SPAM_WORDS_MAX} Spam-Wörter.")
    return words


def validate_changes(config: dict, changes: dict) -> dict:
    """Prüft eine Änderung und liefert nur die Felder, die sich wirklich ändern (Gewichte und Limits ganz)."""
    if not isinstance(changes, dict):
        raise SpamGuardError("Änderungen fehlen.")
    unknown = sorted(set(changes) - set(UPDATE_FIELDS))
    if unknown:
        raise SpamGuardError(f"Unbekannte Einstellungen ({', '.join(unknown)}).")
    after: dict = {}
    for key, value in changes.items():
        if key == "enabled":
            if not isinstance(value, bool):
                raise SpamGuardError("Spamschutz ist an oder aus.")
            new = value
        elif key in NUMBERS:
            new = _strict_number(key, value, *NUMBERS[key][1:])
        elif key == "weights":
            if not isinstance(value, dict) or set(value) - set(DEFAULT_WEIGHTS):
                raise SpamGuardError("Unbekanntes Gewicht.")
            new = {**config["weights"], **{k: _strict_number(f"Gewicht {k}", v, *WEIGHT_RANGE) for k, v in value.items()}}
        elif key == "spam_words":
            new = _clean_words(value)
        else:  # limits
            if not isinstance(value, dict) or set(value) - set(DEFAULT_LIMITS):
                raise SpamGuardError("Limits gibt es nur für Kontakt, „Passwort vergessen“ und „Bestätigung erneut senden“.")
            new = {form: dict(rule) for form, rule in config["limits"].items()}
            for form, rule in value.items():
                if not isinstance(rule, dict) or set(rule) - set(LIMIT_RANGES):
                    raise SpamGuardError("Unbekannter Limit-Wert.")
                for name, number in rule.items():
                    new[form][name] = _strict_number(f"{FORM_LABELS[form]} {name}", number, *LIMIT_RANGES[name])
        if config.get(key) != new:
            after[key] = new
    return after


def clean_reason(reason: Any) -> str:
    """Pflicht-Grund einer Änderung: eine Zeile, Mail-Adressen gekürzt."""
    text = log_safe(mask_addresses(" ".join(str(reason or "").split())), 500)
    if len(text) < 3:
        raise SpamGuardError("Bitte einen Grund angeben.")
    return text


async def _audit(db, action: str, *, actor_id: str, reason: str, data: dict) -> None:
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": actor_id, "target_id": SETTINGS_ID,
                                    "data": {**data, "reason": reason}, "created_at": now_utc().isoformat()})


async def _save(db, fields: dict, *, actor_id: str) -> None:
    await db.settings.update_one({"id": SETTINGS_ID}, {"$set": {"id": SETTINGS_ID, **fields, "updated_at": now_utc().isoformat(),
                                                                 "updated_by": actor_id}}, upsert=True)


async def update(db, changes: dict, *, actor: dict, reason: Any) -> tuple[dict, list[str]]:
    """Schwellen ändern - immer mit Grund und Protokolleintrag (vorher und nachher)."""
    text = clean_reason(reason)
    current = await load(db)
    after = validate_changes(current, changes)
    if not after:
        return current, []
    await _save(db, after, actor_id=actor["id"])
    await _audit(db, "spam_guard.settings", actor_id=actor["id"], reason=text,
                 data={"before": {key: current[key] for key in after}, "after": after})
    return await load(db), sorted(after)


# ---------------------------------------------------------------- Formular-Token


def _key() -> bytes:
    from auth import get_jwt_secret

    return hmac.new(get_jwt_secret().encode("utf-8"), b"spam-guard-form-token-v1", hashlib.sha256).digest()


def _sign(payload: str) -> str:
    digest = hmac.new(_key(), payload.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def issue_token(form: str, *, now: float | None = None) -> str:
    """Ein Token für genau dieses Formular, mit der Ausstellzeit (Sekunden) und einem Zufallswert."""
    if form not in FORMS:
        raise ValueError("unbekanntes Formular")
    issued = int(_now() if now is None else now)
    payload = f"{form}.{issued}.{secrets.token_hex(8)}"
    return f"{payload}.{_sign(payload)}"


def verify_token(config: dict, token: Any, form: str, *, now: float | None = None) -> tuple[bool, str]:
    """(gültig, Grund): ``ok``, ``missing``, ``malformed``, ``forged``, ``wrong_form``, ``too_fast`` oder ``expired``."""
    value = str(token or "")
    if not value:
        return False, "missing"
    parts = value.split(".")
    if len(value) > TOKEN_MAX_LENGTH or len(parts) != 4 or parts[0] not in FORMS or not re.fullmatch(r"[0-9]{1,12}", parts[1]) \
            or not re.fullmatch(r"[0-9a-f]{16}", parts[2]):
        return False, "malformed"
    payload = ".".join(parts[:3])
    if not hmac.compare_digest(_sign(payload), parts[3]):
        return False, "forged"
    if parts[0] != form:
        return False, "wrong_form"
    age = (_now() if now is None else now) - int(parts[1])
    if age < config["min_seconds"]:
        return False, "too_fast"
    if age > config["max_age_minutes"] * 60:
        return False, "expired"
    return True, "ok"


async def _token_use_allowed(db, config: dict, token: str) -> bool:
    """Ein Token gilt für ein paar Versuche (Tippfehler, „Name vergeben“), nicht für eine Flut."""
    key = hashlib.sha256(token.encode("utf-8")).hexdigest()[:32]
    row = await db.spam_guard_tokens.find_one_and_update(
        {"_id": key},
        {"$inc": {"uses": 1}, "$setOnInsert": {"expires_at": datetime.now(timezone.utc) + timedelta(minutes=config["max_age_minutes"] + 60)}},
        upsert=True, return_document=ReturnDocument.AFTER)
    return int((row or {}).get("uses") or 0) <= config["token_max_uses"]


# ---------------------------------------------------------------- Inhalt

_LETTERS_ONLY = re.compile(r"^[A-Za-z]+$")
_VOWELS = frozenset("aeiouyAEIOUY")
_LINK = re.compile(r"https?://|www\.", re.IGNORECASE)
GMAIL_DOMAINS = ("gmail.com", "googlemail.com")


def looks_random(text: Any, *, min_length: int) -> bool:
    """Ein langes Wort ohne Leerzeichen, nur Buchstaben, mit Groß-Klein-Wirrwarr oder (fast) ohne Vokale.

    Absichtlich eng: Umlaute, Bindestrich, Unterstrich, Ziffern oder ein Leerzeichen machen ein Feld nie „zufällig“ -
    so bleiben Namen wie „Jürgen Müller-Lüdenscheidt“ und Gamertags wie „xX_Lion_Xx“ außen vor."""
    value = str(text or "").strip()
    if len(value) < min_length or not _LETTERS_ONLY.match(value):
        return False
    interior_upper = sum(1 for char in value[1:] if char.isupper())
    switches = sum(1 for left, right in zip(value, value[1:]) if left.isupper() != right.isupper())
    if interior_upper >= 4 and switches / (len(value) - 1) >= 0.3:
        return True
    return sum(1 for char in value if char in _VOWELS) / len(value) < 0.12


def dotted_gmail(email: Any, *, min_dots: int) -> bool:
    local, _, domain = str(email or "").strip().lower().rpartition("@")
    return domain in GMAIL_DOMAINS and local.count(".") >= min_dots


def spam_word_hits(words: list[str], text: str) -> list[str]:
    """Spam-Wörter als ganzes Wort bzw. ganze Wortfolge - kein Teilwort, sonst trifft „escort“ in „des Cortina“."""
    from services.word_filter import normalize

    haystack = f" {normalize(text)} "
    return [word for word in words if normalize(word) and f" {normalize(word)} " in haystack]


def score_content(config: dict, fields: dict | None, *, email: Any = None) -> dict:
    """Punkte und Gründe für den Inhalt. ``fields`` sind die Freitext-Felder (Name, Betreff, Text, Benutzername)."""
    texts = [str(value) for value in (fields or {}).values() if isinstance(value, str) and value.strip()]
    weights = config["weights"]
    reasons, score = [], 0
    if texts and all(looks_random(text, min_length=config["random_min_length"]) for text in texts):
        reasons.append("random_text")
        score += weights["random_text"]
    if dotted_gmail(email, min_dots=config["gmail_dots_min"]):
        reasons.append("gmail_dots")
        score += weights["gmail_dots"]
    joined = "\n".join(texts)
    if len(_LINK.findall(joined)) >= config["links_min"]:
        reasons.append("links")
        score += weights["links"]
    if joined and spam_word_hits(config["spam_words"], joined):
        reasons.append("spam_words")
        score += weights["spam_words"]
    return {"score": score, "reasons": reasons}


def word_filter_points(config: dict, result: dict) -> int:
    action = (result or {}).get("action")
    if action == "hold":
        return config["weights"]["word_filter_hold"]
    if action == "flag":
        return config["weights"]["word_filter_flag"]
    return 0


# ---------------------------------------------------------------- Cloudflare Turnstile (optional)


def secret_state(config: dict) -> str:
    """„missing“, „ok“ oder „unreadable“ - ohne den Secret Key herauszugeben."""
    stored = config["turnstile"].get("secret_key")
    if not secret_is_configured(stored):
        return "missing"
    try:
        decrypt_secret(stored)
    except RuntimeError:
        return "unreadable"
    return "ok"


def turnstile_ready(config: dict) -> bool:
    turnstile = config["turnstile"]
    return turnstile["enabled"] and bool(turnstile["site_key"]) and secret_state(config) == "ok"


def turnstile_applies(config: dict, form: str) -> bool:
    return form in TURNSTILE_FORMS and turnstile_ready(config) and config["turnstile"]["forms"].get(form, False)


def public_turnstile(config: dict, form: str) -> dict | None:
    """Was das Formular braucht, um das Widget zu zeigen - nur Site Key, Modus und Aktion."""
    if not turnstile_applies(config, form):
        return None
    return {"site_key": config["turnstile"]["site_key"], "mode": config["turnstile"]["mode"], "action": form}


def _host(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    host = (parsed.hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


async def allowed_hostnames(db) -> set[str]:
    """Die eigenen Hostnamen (FRONTEND_URL und Domain im Branding). Leer heißt: nicht eingerichtet, dann ohne Prüfung."""
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "domain": 1}) or {}
    return {host for host in (_host(os.environ.get("FRONTEND_URL")), _host(branding.get("domain"))) if host}


async def siteverify(secret: str, response_token: str) -> dict | None:
    """Ein Aufruf bei Cloudflare: feste Adresse, Zeitlimit, keine Weiterleitung. ``None`` heißt nicht erreichbar.

    Die IP der Besucherin geht nicht mit (``remoteip`` ist freiwillig). Der Secret Key steht nie im Log."""
    from services.outbound_guard import outbound_disabled

    if outbound_disabled():
        return None
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=False, transport=TRANSPORT) as client:
            response = await client.post(SITEVERIFY_URL, data={"secret": secret, "response": response_token})
    except httpx.HTTPError as exc:
        logger.warning("Turnstile: Cloudflare nicht erreichbar (%s)", type(exc).__name__)
        return None
    if response.status_code != 200:
        logger.warning("Turnstile: Cloudflare antwortet mit %s", response.status_code)
        return None
    try:
        data = response.json()
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def judge_turnstile(data: dict | None, *, form: str, hostnames: set[str]) -> str:
    """``ok``, ``invalid`` (Cloudflare sagt nein, falscher Hostname oder falsche Aktion) oder ``unavailable``."""
    if data is None:
        return "unavailable"
    if data.get("success") is not True:
        codes = [str(code) for code in (data.get("error-codes") or []) if isinstance(code, str)]
        return "unavailable" if any(code in TURNSTILE_OUR_FAULT for code in codes) else "invalid"
    if hostnames and _host(data.get("hostname")) not in hostnames:
        return "invalid"
    if data.get("action") != form:
        return "invalid"
    return "ok"


async def check_turnstile(db, config: dict, form: str, response_token: Any) -> str:
    token = str(response_token or "")
    if not token:
        return "missing"
    if len(token) > TURNSTILE_TOKEN_MAX:
        return "invalid"
    data = await siteverify(decrypt_secret(config["turnstile"]["secret_key"]), token)
    return judge_turnstile(data, form=form, hostnames=await allowed_hostnames(db))


def turnstile_required_error(config: dict, form: str) -> HTTPException:
    return HTTPException(428, detail={"code": "turnstile_required", "msg": "Bitte bestätige kurz, dass du kein Bot bist.",
                                      "turnstile": public_turnstile(config, form)})


def clean_site_key(value: Any) -> str:
    key = str(value or "").strip()
    if not SITE_KEY_PATTERN.match(key):
        raise SpamGuardError("Der Site Key hat 10 bis 100 Zeichen (Buchstaben, Ziffern, - und _).")
    return key


def clean_secret(value: Any) -> str:
    secret = str(value or "").strip()
    if not SECRET_MIN <= len(secret) <= SECRET_MAX or any(char.isspace() for char in secret):
        raise SpamGuardError(f"Der Secret Key hat {SECRET_MIN} bis {SECRET_MAX} Zeichen ohne Leerzeichen.")
    return secret


async def update_turnstile(db, changes: dict, *, actor: dict, reason: Any) -> dict:
    """An/aus, Site Key, Modus und je Formular ein Schalter. Einschalten nur mit Site Key und lesbarem Secret Key."""
    text = clean_reason(reason)
    current = await load(db)
    turnstile = dict(current["turnstile"])
    unknown = sorted(set(changes) - {"enabled", "site_key", "mode", "forms"})
    if unknown:
        raise SpamGuardError(f"Unbekannte Turnstile-Einstellungen ({', '.join(unknown)}).")
    after: dict = {}
    if "site_key" in changes:
        after["site_key"] = clean_site_key(changes["site_key"])
    if "mode" in changes:
        if changes["mode"] not in TURNSTILE_MODES:
            raise SpamGuardError("Modus ist „immer“ oder „nur bei Verdacht“.")
        after["mode"] = changes["mode"]
    if "forms" in changes:
        forms = changes["forms"]
        if not isinstance(forms, dict) or set(forms) - set(TURNSTILE_FORMS) or not all(isinstance(v, bool) for v in forms.values()):
            raise SpamGuardError("Turnstile gibt es für Kontaktformular und Registrierung - je ein Schalter an oder aus.")
        after["forms"] = {**turnstile["forms"], **forms}
    if "enabled" in changes:
        if not isinstance(changes["enabled"], bool):
            raise SpamGuardError("Turnstile ist an oder aus.")
        after["enabled"] = changes["enabled"]
    after = {key: value for key, value in after.items() if turnstile.get(key) != value}
    if not after:
        return current
    merged = {**turnstile, **after}
    if merged["enabled"] and (not merged["site_key"] or secret_state(current) != "ok"):
        raise SpamGuardError("Erst Site Key und Secret Key hinterlegen, dann einschalten.")
    await _save(db, {f"turnstile.{key}": value for key, value in after.items()}, actor_id=actor["id"])
    await _audit(db, "spam_guard.turnstile", actor_id=actor["id"], reason=text,
                 data={"before": {key: turnstile.get(key) for key in after}, "after": after})
    return await load(db)


async def set_turnstile_secret(db, raw_secret: Any, *, actor: dict, reason: Any) -> dict:
    """Secret Key verschlüsselt speichern (``SETTINGS_ENCRYPTION_KEY``). Ins Protokoll kommt nur „hinterlegt“."""
    secret = clean_secret(raw_secret)
    text = clean_reason(reason)
    current = await load(db)
    before = "hinterlegt" if secret_state(current) != "missing" else "fehlt"
    await _save(db, {"turnstile.secret_key": encrypt_secret(secret), "turnstile.secret_saved_at": now_utc().isoformat(),
                     "turnstile.last_test": None}, actor_id=actor["id"])
    await _audit(db, "spam_guard.turnstile", actor_id=actor["id"], reason=text,
                 data={"before": {"secret_key": before}, "after": {"secret_key": "hinterlegt"}})
    return await load(db)


async def remove_turnstile_secret(db, *, actor: dict, reason: Any) -> dict:
    """Secret Key entfernen - Turnstile geht in demselben Schritt aus: ohne Schlüssel lässt sich nichts prüfen."""
    text = clean_reason(reason)
    current = await load(db)
    if secret_state(current) == "missing":
        return current
    before, after = {"secret_key": "hinterlegt"}, {"secret_key": "entfernt"}
    if current["turnstile"]["enabled"]:
        before["enabled"], after["enabled"] = True, False
    await _save(db, {"turnstile.secret_key": "", "turnstile.secret_saved_at": None, "turnstile.last_test": None,
                     "turnstile.enabled": False}, actor_id=actor["id"])
    await _audit(db, "spam_guard.turnstile", actor_id=actor["id"], reason=text, data={"before": before, "after": after})
    return await load(db)


async def run_turnstile_test(db) -> dict:
    """Verbindungstest: eine Prüfung mit einem Platzhalter. Cloudflare lehnt den Platzhalter ab - entscheidend ist, ob
    der Secret Key dabei angenommen wird."""
    config = await load(db)
    state = secret_state(config)
    if state != "ok":
        result = {"ok": False, "detail": "Kein lesbarer Secret Key hinterlegt." if state == "missing" else f"Secret Key {UNREADABLE_SECRET}."}
    else:
        data = await siteverify(decrypt_secret(config["turnstile"]["secret_key"]), "lsw-verbindungstest")
        codes = [str(code) for code in ((data or {}).get("error-codes") or []) if isinstance(code, str)]
        if data is None:
            result = {"ok": False, "detail": "Cloudflare ist nicht erreichbar."}
        elif any(code in ("missing-input-secret", "invalid-input-secret") for code in codes):
            result = {"ok": False, "detail": "Cloudflare lehnt den Secret Key ab."}
        elif "internal-error" in codes:
            result = {"ok": False, "detail": "Cloudflare meldet einen internen Fehler – später noch einmal testen."}
        else:
            result = {"ok": True, "detail": "Verbindung steht, der Secret Key wird angenommen."}
    if not config["turnstile"]["site_key"] and result["ok"]:
        result = {"ok": False, "detail": "Secret Key passt, aber der Site Key fehlt noch."}
    await db.settings.update_one({"id": SETTINGS_ID}, {"$set": {"id": SETTINGS_ID, "turnstile.last_test": {
        "at": now_utc().isoformat(), "ok": result["ok"], "detail": result["detail"]}}}, upsert=True)
    return result


# ---------------------------------------------------------------- Zähler (ohne Inhalt)


def _hour_key(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H")


async def record(db, form: str, outcome: str, reason: str | None = None) -> None:
    """Ein Zähler je Stunde, Formular, Ergebnis und Grund - keine Adresse, keine IP, kein Text."""
    now = datetime.now(timezone.utc)
    hour = _hour_key(now)
    key = f"{hour}|{form}|{outcome}|{reason or '-'}"
    await db.spam_guard_stats.update_one(
        {"_id": key},
        {"$inc": {"count": 1}, "$setOnInsert": {"hour": hour, "form": form, "outcome": outcome, "reason": reason,
                                                "expires_at": now + timedelta(days=STATS_DAYS)}},
        upsert=True)


async def _drop(db, form: str, reason: str) -> Verdict:
    await record(db, form, "dropped", reason)
    return Verdict(form, DROP, [reason], 0)


def _vienna_midnight_utc(now: datetime) -> datetime:
    from zoneinfo import ZoneInfo

    local = now.astimezone(ZoneInfo("Europe/Vienna"))
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)


def _summary(rows: list[dict]) -> dict:
    out = {"dropped": 0, "suspect": 0, "accepted": 0, "limited": 0, "challenged": 0, "by_reason": {}}
    for row in rows:
        count = int(row.get("count") or 0)
        outcome = row.get("outcome")
        if outcome == "turnstile_unavailable":
            continue
        if outcome in out:
            out[outcome] += count
        if outcome in ("dropped", "suspect", "limited") and row.get("reason"):
            out["by_reason"][row["reason"]] = out["by_reason"].get(row["reason"], 0) + count
    out["caught"] = out["dropped"] + out["suspect"]
    return out


async def stats_view(db, *, now: datetime | None = None) -> dict:
    """Abgefangen heute (Wiener Tag) und in den letzten 7 Tagen, mit Gründen, Spam-Quote und der stärksten Stunde."""
    now = now or datetime.now(timezone.utc)
    week_start = _hour_key(now - timedelta(days=7))
    rows = await db.spam_guard_stats.find({"hour": {"$gte": week_start}}, {"_id": 0}).to_list(20000)
    today_start = _hour_key(_vienna_midnight_utc(now))
    day_start = _hour_key(now - timedelta(hours=24))
    week = _summary(rows)
    today = _summary([row for row in rows if row["hour"] >= today_start])
    per_hour: dict[str, int] = {}
    unavailable = 0
    for row in rows:
        if row["hour"] < day_start:
            continue
        if row.get("outcome") == "turnstile_unavailable":
            unavailable += int(row.get("count") or 0)
        elif row.get("outcome") in ("dropped", "suspect"):
            per_hour[row["hour"]] = per_hour.get(row["hour"], 0) + int(row.get("count") or 0)
    peak_hour = max(per_hour, key=per_hour.get) if per_hour else None
    submissions = week["dropped"] + week["suspect"] + week["accepted"]
    return {
        "today": today, "week": week,
        "quote_week": round(week["caught"] / submissions * 100, 1) if submissions else None,
        "peak_24h": {"hour": f"{peak_hour}:00Z" if peak_hour else None, "count": per_hour.get(peak_hour, 0) if peak_hour else 0},
        "turnstile_unavailable_24h": unavailable,
        "labels": REASON_LABELS,
    }


# ---------------------------------------------------------------- Die Prüfung


async def _enforce_limits(request: Request, db, config: dict, form: str, email: str | None) -> None:
    rule = config["limits"].get(form)
    bucket = LIMIT_BUCKETS.get(form)
    if not rule or not bucket:
        return
    from services.rate_limit import enforce_rate_limit, get_client_ip, keyed_subject

    checks = [("ip", f"{bucket}:ip", rule["ip_limit"], rule["ip_window_minutes"], keyed_subject(f"ip:{get_client_ip(request)}"))]
    if email:
        checks.append(("email", f"{bucket}:email", rule["email_limit"], rule["email_window_minutes"],
                       keyed_subject(f"email:{str(email).strip().lower()}")))
    for reason, name, limit, minutes, subject in checks:
        try:
            await enforce_rate_limit(request, name, limit=limit, window_seconds=minutes * 60, subject=subject)
        except HTTPException as exc:
            if exc.status_code == 429:
                await record(db, form, "limited", reason)
            raise


async def screen(request: Request, form: str, *, token: Any = None, honeypot: Any = None, turnstile_token: Any = None,
                 email: str | None = None, fields: dict | None = None, client: str = "web", db=None) -> Verdict:
    """Die ganze Prüfung für ein Formular. Wirft 429 (Limit) und 428 (Turnstile nötig, Modus „nur bei Verdacht“)."""
    if form not in FORMS:
        raise ValueError("unbekanntes Formular")
    if db is None:
        from database import get_db

        db = get_db()
    config = await load(db)
    await _enforce_limits(request, db, config, form, email)
    if not config["enabled"]:
        await record(db, form, "accepted")
        return Verdict(form, ACCEPT)
    if str(honeypot or "").strip():
        return await _drop(db, form, "honeypot")
    token_value = str(token or "")
    if token_value:
        ok, why = verify_token(config, token_value, form)
        if not ok:
            return await _drop(db, form, f"token_{why}")
        if not await _token_use_allowed(db, config, token_value):
            return await _drop(db, form, "token_reused")
    elif client == "web" and form in WEB_ONLY_FORMS:
        return await _drop(db, form, "token_missing")
    # Website heißt: ein gültiges Token ist da. Ohne Token (App, ältere Clients) gibt es kein Turnstile.
    turnstile = turnstile_applies(config, form) if client == "web" and token_value else False
    mode = config["turnstile"]["mode"]

    content = score_content(config, fields, email=email)
    reasons, score = list(content["reasons"]), content["score"]
    joined = "\n".join(str(value) for value in (fields or {}).values() if isinstance(value, str))
    if joined.strip():
        from services import word_filter

        points = word_filter_points(config, await word_filter.check_text(db, joined))
        if points:
            reasons.append("word_filter")
            score += points
    forced = False
    if turnstile and mode == "always":
        result = await check_turnstile(db, config, form, turnstile_token)
        if result == "invalid":
            return await _drop(db, form, "turnstile_invalid")
        if result == "missing":
            # Ein Werbeblocker kann das Widget verhindern: dann nicht verwerfen, sondern markieren.
            reasons.append("turnstile_missing")
            forced = True
        elif result == "unavailable":
            # Cloudflare hakt: die eigenen Stufen entscheiden allein, der Betrieb sieht es im Check.
            await record(db, form, "turnstile_unavailable")
    suspect = forced or score >= config["suspect_score"]
    if suspect and turnstile and mode == "suspect":
        result = await check_turnstile(db, config, form, turnstile_token)
        if result == "missing":
            await record(db, form, "challenged", reasons[0] if reasons else None)
            raise turnstile_required_error(config, form)
        if result == "invalid":
            return await _drop(db, form, "turnstile_invalid")
        if result == "ok":
            await record(db, form, "accepted", "turnstile_passed")
            return Verdict(form, ACCEPT, ["turnstile_passed"], score)
        await record(db, form, "turnstile_unavailable")
    if suspect:
        await record(db, form, "suspect", reasons[0] if reasons else None)
        return Verdict(form, SUSPECT, reasons, score)
    await record(db, form, "accepted")
    return Verdict(form, ACCEPT, [], score)


# ---------------------------------------------------------------- Admin-Ansicht


def admin_view(config: dict) -> dict:
    """Was die Einstellungsseite zeigt - ohne Secret Key, ohne verschlüsselten Wert."""
    turnstile = config["turnstile"]
    state = secret_state(config)
    return {
        "config": {key: config[key] for key in UPDATE_FIELDS},
        "defaults": {key: value for key, value in defaults().items() if key in UPDATE_FIELDS},
        "bounds": {"numbers": {key: {"min": spec[1], "max": spec[2]} for key, spec in NUMBERS.items()},
                   "weights": {"min": WEIGHT_RANGE[0], "max": WEIGHT_RANGE[1]},
                   "limits": {key: {"min": low, "max": high} for key, (low, high) in LIMIT_RANGES.items()}},
        "forms": [{"key": form, "label": FORM_LABELS[form], "turnstile": form in TURNSTILE_FORMS, "limits": form in DEFAULT_LIMITS}
                  for form in FORMS],
        "turnstile": {
            "enabled": turnstile["enabled"], "ready": turnstile_ready(config), "mode": turnstile["mode"],
            "modes": [{"key": key, "label": TURNSTILE_MODE_LABELS[key]} for key in TURNSTILE_MODES],
            "site_key": turnstile["site_key"], "forms": turnstile["forms"],
            "secret": {"state": state, "saved_at": turnstile["secret_saved_at"] if state != "missing" else None,
                       "detail": UNREADABLE_SECRET if state == "unreadable" else None},
            "last_test": turnstile["last_test"],
        },
        "updated_at": config["updated_at"],
    }
