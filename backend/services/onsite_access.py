"""Vor-Ort-Zugang (#1592): ein QR-Code je Turnier, über den sich auch Nicht-Mitglieder anmelden.

So läuft es:

- Der Token ist ``HMAC(JWT_SECRET, "onsite:<turnier>:<zufallswert>")``. Gespeichert werden nur der Zufallswert und der
  Hash des Tokens - in einer eigenen Sammlung ``tournament_onsite_access``, nie am Turnier: das Turnier geht an vielen
  Stellen ganz hinaus (Seite, Baum, Spielseite, App). TV und Aushang können den Token jederzeit wieder bilden.
- Einlösen tauscht den Token gegen eine Freigabe im Browser: ein signiertes, HttpOnly-Cookie nur unter ``/api``, für
  genau dieses Turnier, höchstens 12 Stunden. Danach steht der Token nirgends mehr (der QR-Code trägt ihn hinter dem
  ``#``, das die Seite sofort entfernt - er erreicht weder Server-Logs noch Referrer).
- Gültig nur im Zeitfenster: ab Öffnung der Anmeldung bzw. des Check-ins bis Turnierende. Erneuern (neuer Zufallswert)
  und Abschalten machen alte QR-Codes und alte Freigaben sofort ungültig.

Die Freigabe öffnet nur die schlanke Turnierseite und die Anmeldung. Wer angemeldet ist, sieht sein Turnier als
Teilnehmer (``routes/tournament_common._get_visible_tournament``), nicht über die Freigabe.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from models import now_utc
from services.tournament_rules import tournament_event_mode

PASS_COOKIE = "tls_onsite"
PASS_PATH = "/api"
PASS_MAX_AGE = timedelta(hours=12)
# Mehr Freigaben hält ein Browser nicht - wer an einem Abend fünf Turniere scannt, verliert die älteste.
MAX_PASSES = 5
ONSITE_EVENT_MODES = frozenset({"local", "hybrid"})
# Ab Öffnung der Anmeldung bis Turnierende - davor und danach gilt wieder die normale Sichtbarkeit.
OPEN_STATUSES = frozenset({"registration_open", "registration_closed", "check_in", "live", "paused"})
# Ohne Turnierende: ein Tag ab Start.
FALLBACK_LENGTH = timedelta(hours=24)


def _secret() -> bytes:
    from auth import get_jwt_secret

    return get_jwt_secret().encode("utf-8")


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _token_for(tournament_id: str, nonce: str) -> str:
    return _b64(hmac.new(_secret(), f"onsite:{tournament_id}:{nonce}".encode("utf-8"), hashlib.sha256).digest())


def hash_token(token: str) -> str:
    return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()


def _parse_dt(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# ------------------------------------------------------------------ Einstellung und Zeitfenster


def default_enabled(tournament: dict) -> bool:
    """Vorgabe: an bei Turnieren vor Ort (auch hybrid), aus bei reinen Online-Turnieren."""
    return tournament_event_mode(tournament) in ONSITE_EVENT_MODES


def is_enabled(tournament: dict) -> bool:
    value = tournament.get("onsite_access_enabled")
    return default_enabled(tournament) if value is None else value is True


def window(tournament: dict) -> tuple[datetime | None, datetime | None]:
    """Von der Öffnung der Anmeldung bzw. des Check-ins (das Frühere) bis Turnierende."""
    opens = [dt for dt in (_parse_dt(tournament.get("registration_open_from")), _parse_dt(tournament.get("check_in_from"))) if dt]
    start = min(opens) if opens else None
    end = _parse_dt(tournament.get("end_date"))
    if not end:
        begins = _parse_dt(tournament.get("start_date"))
        end = begins + FALLBACK_LENGTH if begins else None
    return start, end


def is_open(tournament: dict, now: datetime | None = None) -> bool:
    """Gilt der Zugang jetzt? Eingeschaltet, Status zwischen Anmeldung und Ende, innerhalb des Fensters."""
    if not tournament or not is_enabled(tournament) or tournament.get("status") not in OPEN_STATUSES:
        return False
    now = now or now_utc()
    start, end = window(tournament)
    if start and now < start:
        return False
    if end and now > end:
        return False
    return True


# ------------------------------------------------------------------ Geheimnis je Turnier


async def _record(db, tournament_id: str) -> dict | None:
    return await db.tournament_onsite_access.find_one({"tournament_id": tournament_id}, {"_id": 0})


def _new_record(tournament_id: str, actor_id: str | None) -> dict:
    nonce = secrets.token_urlsafe(24)
    return {
        "tournament_id": tournament_id,
        "nonce": nonce,
        "token_hash": hash_token(_token_for(tournament_id, nonce)),
        "rotated_at": now_utc().isoformat(),
        "rotated_by": actor_id,
    }


async def ensure_token(db, tournament_id: str, actor_id: str | None = None) -> str:
    """Den Token des Turniers bilden - beim ersten Mal den Zufallswert anlegen."""
    record = await _record(db, tournament_id)
    if not record or not record.get("nonce"):
        # Zwei gleichzeitige erste Abrufe: nur einer legt an, der andere liest dessen Wert.
        await db.tournament_onsite_access.update_one(
            {"tournament_id": tournament_id}, {"$setOnInsert": _new_record(tournament_id, actor_id)}, upsert=True)
        record = await _record(db, tournament_id)
    return _token_for(tournament_id, record["nonce"])


async def renew_token(db, tournament_id: str, actor_id: str | None) -> str:
    """Neuer Zufallswert: der alte QR-Code und alle damit eingelösten Freigaben gelten nicht mehr."""
    record = _new_record(tournament_id, actor_id)
    await db.tournament_onsite_access.update_one({"tournament_id": tournament_id}, {"$set": record}, upsert=True)
    return _token_for(tournament_id, record["nonce"])


def onsite_path(token: str) -> str:
    """Die Adresse im QR-Code: der Token steht hinter dem ``#`` und geht so nie an einen Server."""
    return f"/vor-ort#{token}"


async def tournament_for_token(db, token: str) -> dict | None:
    """Das Turnier zu einem Token - nur wenn der Zugang jetzt gilt. Sonst ``None``, ohne Grund."""
    raw = str(token or "").strip()
    if not raw or len(raw) > 128:
        return None
    record = await db.tournament_onsite_access.find_one({"token_hash": hash_token(raw)}, {"_id": 0})
    if not record or not record.get("nonce"):
        return None
    tournament = await db.tournaments.find_one({"id": record["tournament_id"]}, {"_id": 0})
    if not tournament or not is_open(tournament):
        return None
    return tournament


# ------------------------------------------------------------------ Freigabe im Browser


def _fingerprint(nonce: str) -> str:
    return hashlib.sha256(f"onsite-pass:{nonce}".encode("utf-8")).hexdigest()[:16]


def _sign(body: str) -> str:
    return _b64(hmac.new(_secret(), f"onsite-pass:{body}".encode("utf-8"), hashlib.sha256).digest())


def _parse_passes(cookie: str | None) -> list[tuple[str, str, int]]:
    """Gültig signierte Einträge ``(turnier, fingerabdruck, ablauf)`` - alles andere fällt still weg."""
    out: list[tuple[str, str, int]] = []
    for entry in str(cookie or "").split("~")[: MAX_PASSES * 2]:
        parts = entry.split(".")
        if len(parts) != 4:
            continue
        tournament_id, fingerprint, expires, signature = parts
        body = f"{tournament_id}.{fingerprint}.{expires}"
        if not hmac.compare_digest(_sign(body), signature):
            continue
        try:
            out.append((tournament_id, fingerprint, int(expires)))
        except ValueError:
            continue
    return out


async def pass_cookie_value(db, tournament: dict, existing: str | None) -> tuple[str, int]:
    """Den Cookie-Wert mit der neuen Freigabe und die Lebensdauer in Sekunden."""
    record = await _record(db, tournament["id"])
    now = now_utc()
    expires_at = now + PASS_MAX_AGE
    _, end = window(tournament)
    if end and end < expires_at:
        expires_at = end
    expires = int(expires_at.timestamp())
    body = f"{tournament['id']}.{_fingerprint(record['nonce'])}.{expires}"
    entries = [f"{body}.{_sign(body)}"]
    for tournament_id, fingerprint, other_expires in _parse_passes(existing):
        if tournament_id != tournament["id"] and other_expires > int(now.timestamp()):
            other = f"{tournament_id}.{fingerprint}.{other_expires}"
            entries.append(f"{other}.{_sign(other)}")
    max_age = max(1, max(int(entry.split(".")[2]) for entry in entries) - int(now.timestamp()))
    return "~".join(entries[:MAX_PASSES]), max_age


async def has_pass(db, request, tournament: dict | None) -> bool:
    """Trägt dieser Browser eine gültige Freigabe für genau dieses Turnier - jetzt, mit dem aktuellen QR-Code?"""
    if request is None or not tournament or not is_open(tournament):
        return False
    cookie = request.cookies.get(PASS_COOKIE)
    if not cookie:
        return False
    now = int(now_utc().timestamp())
    wanted = [(fp, exp) for tid, fp, exp in _parse_passes(cookie) if tid == tournament.get("id") and exp > now]
    if not wanted:
        return False
    record = await _record(db, tournament["id"])
    if not record or not record.get("nonce"):
        return False
    current = _fingerprint(record["nonce"])
    return any(hmac.compare_digest(fp, current) for fp, _ in wanted)


def set_pass_cookie(response, value: str, max_age: int) -> None:
    from auth import _secure_cookies

    response.set_cookie(
        PASS_COOKIE, value, max_age=max_age, path=PASS_PATH, httponly=True, secure=_secure_cookies(), samesite="lax",
    )


# ------------------------------------------------------------------ Schlanke Ansicht


SLIM_FIELDS = (
    "id", "slug", "title", "status", "public_phase", "start_date", "end_date", "banner_url", "team_mode", "team_size",
    "max_participants", "participant_count", "waitlist_count", "registration_enabled", "registration_open_from", "registration_open_until",
    "check_in_from", "check_in_until", "is_invite_only", "event_mode", "location", "platform", "format", "format_label",
    "offer",
)
SLIM_GAME_FIELDS = (
    "id", "name", "display_name", "slug", "short_name", "cover_url", "logo_url", "player_id_fields",
    "effective_player_id_fields", "identity_game_slug", "identity_game_name",
)


def slim_view(tournament: dict) -> dict:
    """Was Begleitpersonen vor der Anmeldung sehen: Titel, Termin, Spiel, freie Plätze - und was die Anmeldung braucht."""
    out = {key: tournament.get(key) for key in SLIM_FIELDS if key in tournament}
    game = tournament.get("game") or None
    out["game"] = {key: game.get(key) for key in SLIM_GAME_FIELDS if key in game} if game else None
    out["onsite_view"] = True
    return out
