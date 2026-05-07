"""Public date/status phase helpers for events, tournaments and F1 challenges."""
from __future__ import annotations

from datetime import datetime, timezone


TERMINAL_STATUSES = {"completed", "results_published", "archived", "cancelled"}
MANUAL_STATUSES = {"draft", "paused", *TERMINAL_STATUSES}

STATUS_LABELS = {
    "draft": "Entwurf",
    "announced": "Angekündigt",
    "registration_pending": "Anmeldung öffnet",
    "registration_open": "Anmeldung offen",
    "registration_closed": "Anmeldung geschlossen",
    "check_in": "Check-in offen",
    "live": "Läuft",
    "paused": "Pausiert",
    "completed": "Beendet",
    "results_published": "Ergebnisse veröffentlicht",
    "archived": "Archiviert",
    "cancelled": "Abgesagt",
}


def parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _label(state: str) -> str:
    return STATUS_LABELS.get(state, state.replace("_", " ").title())


def derive_public_phase(doc: dict, kind: str = "content", now: datetime | None = None) -> dict:
    """Return one public phase derived from status and dates.

    The stored status remains available for admin workflows. Public pages should
    prefer this value so users do not see both a raw status and a date phase.
    """
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)

    raw_status = doc.get("status") or "draft"
    normalized_status = "check_in" if raw_status == "checkin_open" else raw_status

    start = parse_dt(doc.get("start_date"))
    end = parse_dt(doc.get("end_date"))
    if kind == "event":
        reg_enabled = bool(doc.get("has_registration") or doc.get("registration_url"))
        reg_from = parse_dt(doc.get("registration_opens_at"))
        reg_until = parse_dt(doc.get("registration_closes_at"))
        start_target = parse_dt(doc.get("door_time")) or start
    else:
        reg_enabled = doc.get("registration_enabled") is not False and not doc.get("is_invite_only")
        reg_from = parse_dt(doc.get("registration_open_from"))
        reg_until = parse_dt(doc.get("registration_open_until"))
        check_from = parse_dt(doc.get("check_in_from"))
        check_until = parse_dt(doc.get("check_in_until"))
        start_target = start

    if normalized_status in MANUAL_STATUSES:
        return {
            "state": normalized_status,
            "label": _label(normalized_status),
            "raw_status": raw_status,
            "target_at": None,
            "next_transition_at": None,
            "countdown_kind": None,
            "now": now.isoformat(),
        }

    if end and now >= end:
        return {
            "state": "completed",
            "label": _label("completed"),
            "raw_status": raw_status,
            "target_at": None,
            "next_transition_at": None,
            "countdown_kind": None,
            "now": now.isoformat(),
        }

    if start and now >= start:
        return {
            "state": "live",
            "label": _label("live"),
            "raw_status": raw_status,
            "target_at": _iso(end),
            "next_transition_at": _iso(end),
            "countdown_kind": "ends",
            "now": now.isoformat(),
        }

    if normalized_status == "check_in":
        return {
            "state": "check_in",
            "label": _label("check_in"),
            "raw_status": raw_status,
            "target_at": _iso(start_target),
            "next_transition_at": _iso(start_target),
            "countdown_kind": "starts",
            "now": now.isoformat(),
        }

    if kind != "event" and check_from and now >= check_from and (not check_until or now <= check_until):
        return {
            "state": "check_in",
            "label": _label("check_in"),
            "raw_status": raw_status,
            "target_at": _iso(check_until or start_target),
            "next_transition_at": _iso(check_until or start_target),
            "countdown_kind": "check_in_closes",
            "now": now.isoformat(),
        }

    if reg_enabled and reg_from and now < reg_from:
        return {
            "state": "registration_pending",
            "label": _label("registration_pending"),
            "raw_status": raw_status,
            "target_at": reg_from.isoformat(),
            "next_transition_at": reg_from.isoformat(),
            "countdown_kind": "registration_opens",
            "now": now.isoformat(),
        }

    if normalized_status == "registration_open" and not reg_enabled:
        return {
            "state": "announced",
            "label": _label("announced"),
            "raw_status": raw_status,
            "target_at": _iso(start_target),
            "next_transition_at": _iso(start_target),
            "countdown_kind": "starts",
            "now": now.isoformat(),
        }

    if reg_enabled and (not reg_from or now >= reg_from) and (not reg_until or now <= reg_until):
        return {
            "state": "registration_open",
            "label": _label("registration_open"),
            "raw_status": raw_status,
            "target_at": _iso(reg_until),
            "next_transition_at": _iso(reg_until),
            "countdown_kind": "registration_closes",
            "now": now.isoformat(),
        }

    if reg_enabled and reg_until and now > reg_until:
        return {
            "state": "registration_closed",
            "label": _label("registration_closed"),
            "raw_status": raw_status,
            "target_at": _iso(check_from if kind != "event" and check_from and now < check_from else start_target),
            "next_transition_at": _iso(check_from if kind != "event" and check_from and now < check_from else start_target),
            "countdown_kind": "check_in_opens" if kind != "event" and check_from and now < check_from else "starts",
            "now": now.isoformat(),
        }

    return {
        "state": "announced",
        "label": _label("announced"),
        "raw_status": raw_status,
        "target_at": _iso(start_target),
        "next_transition_at": _iso(start_target),
        "countdown_kind": "starts",
        "now": now.isoformat(),
    }
