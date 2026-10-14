"""F1 Fast Lap Challenge routes."""
import io
import csv
import logging
import math
from urllib.parse import quote, urlencode, urlsplit
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import RedirectResponse, StreamingResponse
from database import get_db
from services.permissions import MFA_MESSAGE, is_confirmed_tournament_lead, lead_without_second_factor
from auth import get_current_user, require_admin, get_optional_user, require_area
from services.visibility import user_can_see
from services.visibility import hide_unseen_event_links, lead_can_see
from services.access_links import public_access_link_payload, touch_access_link, validate_access_link
from services.public_phase import derive_public_phase
from services.slug_utils import apply_slug_history, find_by_slug_or_history, slug_source_for_update, unique_slug
from services.log_safe import log_safe
from services.mutation_lock import MutationLockBusy, mutation_lock
from services.private_fields import private_projection
from services.csv_safe import safe_cell
from services.fastlap_standings import (
    REFERENCE_SCOPE, effective_ms, load_laps, official_times, participant_id, penalty_ms, rank_laps, track_ranking,
)
from services.fastlap_guests import (
    clean_guest_name, ensure_unique_name, find_guest, guest_participant_id, guest_payload, guests_by_id,
)
from services.laptime import format_lap_time, plausibility_warning, plausible_range
from models import (
    F1ChallengeCreate, F1ChallengeUpdate, F1TrackCreate, F1TrackUpdate,
    F1LapTimeCreate, F1LapTimeDelete, F1LapTimeUpdate,
    F1GuestCreate, F1QueueCreate, F1QueueNext, F1QueueStart,
    now_utc, new_id,
)

def _validate_penalty_note(penalty_seconds: float, is_invalid: bool, admin_note: str | None):
    """P0 — Penalty Transparency: any penalty MUST have a reason ≥5 chars.

    Raises HTTP 422 when penalty_seconds>0 or is_invalid=True without an explanatory admin_note.
    """
    has_penalty = (penalty_seconds or 0) > 0 or bool(is_invalid)
    if has_penalty:
        note = (admin_note or "").strip()
        if len(note) < 5:
            raise HTTPException(
                status_code=422,
                detail="Bei Zeitstrafen oder ungültigen Runden muss eine Begründung "
                       "(mind. 5 Zeichen) angegeben werden — Spieler haben Anspruch auf Transparenz.",
            )


def _max_attempts(challenge: dict) -> int | None:
    if challenge.get("unlimited_attempts") is not False:
        return None
    try:
        value = int(challenge.get("max_attempts") or 0)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


# Grenzen einer Fast-Lap-Zeit (#1038): eine Runde dauert mehr als null und höchstens eine Stunde; Strafsekunden sind
# nie eine Gutschrift und ebenfalls höchstens eine Stunde.
MAX_LAP_MS = 60 * 60 * 1000
MAX_PENALTY_SECONDS = 60 * 60
# Versuche zählen und die Zeit schreiben geschehen unter einer Sperre je Challenge, Strecke, Person und Wertung -
# sonst kämen zwei gleichzeitige Eintragungen beide unter der Versuchsgrenze durch.
LAP_WAIT_SECONDS = 5.0
LAP_BUSY = "Gerade wird für diese Person auf dieser Strecke eine Zeit gespeichert – bitte gleich noch einmal versuchen."


def lap_attempt_resource(challenge_id: str | None, track_id: str | None, user_id: str | None, score_scope: str) -> str:
    return f"f1:{challenge_id}:{track_id}:{user_id}:{score_scope or 'official'}"


def safe_proof_url(value) -> str | None:
    """Der Nachweis-Link, wenn er ein http(s)-Link mit Host ist - sonst ``None`` (auch bei kaputten Links)."""
    text = (value or "").strip() if isinstance(value, str) else ""
    if not text:
        return None
    try:
        parts = urlsplit(text)
    except ValueError:
        return None
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc:
        return None
    return text


async def check_lap_time(db, challenge: dict, lap: dict, *, current: dict | None = None, check_plausibility: bool = True,
                         confirm_implausible: bool = False) -> int:
    """Die eine Prüfung einer Fast-Lap-Zeit (#1038): Eintragen (Website, App) und Korrigieren rufen dieselbe Funktion;
    auch das Zurücknehmen einer Strafe aus der Strafen-Liste (#1388) soll hier durch.

    ``lap`` ist der Stand nach der Änderung, ``current`` bei einer Korrektur der gespeicherte Eintrag. Die Rechte
    (Turnierleitung oder Einsatz in der Challenge) prüft die Route vorher mit ``_require_f1_result_permission``.
    Eine unplausible Zeit (#1584, Grenzen je Strecke, Standard unter 20 s oder über 10 min) geht nur mit
    ``confirm_implausible`` durch - ``check_plausibility`` ist bei einer Korrektur aus, wenn die Zeit gleich bleibt.
    Gibt die Zahl der bisherigen Versuche in der Wertung zurück - ohne den korrigierten Eintrag selbst."""
    time_ms = lap.get("time_ms")
    # Eine ungültige Runde darf ohne Zeit kommen (0, #1585: „Runde nicht beendet“) - sie zählt nur als Versuch.
    no_time = bool(lap.get("is_invalid")) and time_ms == 0
    if isinstance(time_ms, bool) or not isinstance(time_ms, int) or not (no_time or 0 < time_ms <= MAX_LAP_MS):
        raise HTTPException(status_code=400, detail="Die Rundenzeit muss größer als null und höchstens 60 Minuten sein.")
    penalty = lap.get("penalty_seconds") or 0
    if isinstance(penalty, bool) or not isinstance(penalty, (int, float)) or not math.isfinite(penalty) \
            or not 0 <= penalty <= MAX_PENALTY_SECONDS:
        raise HTTPException(status_code=400, detail=f"Strafsekunden müssen zwischen 0 und {MAX_PENALTY_SECONDS} liegen.")
    if (lap.get("proof_url") or "").strip() and not safe_proof_url(lap.get("proof_url")):
        raise HTTPException(status_code=400, detail="Der Nachweis-Link muss mit http:// oder https:// beginnen.")
    track = await db.f1_tracks.find_one({"id": lap.get("track_id"), "challenge_id": challenge.get("id")},
                                        {"_id": 0, "id": 1, "min_plausible_ms": 1, "max_plausible_ms": 1})
    if not track:
        raise HTTPException(status_code=400, detail="Strecke gehört nicht zur Challenge")
    if check_plausibility and not no_time and not confirm_implausible and plausibility_warning(time_ms, track):
        low, high = plausible_range(track)
        raise HTTPException(
            status_code=422,
            detail=f"Die Zeit {format_lap_time(time_ms)} wirkt unplausibel (erwartet zwischen {format_lap_time(low)} "
                   f"und {format_lap_time(high)}) - bitte prüfen und bestätigen.",
        )
    score_scope = lap.get("score_scope") or "official"
    is_guest = not lap.get("user_id")
    if is_guest and score_scope == "club_reference":
        # Gäste (#1585) sind nie Vereinsmitglieder - eine Referenzzeit ohne Konto gibt es nicht.
        raise HTTPException(status_code=400, detail="Gäste fahren nur in der offiziellen Wertung.")
    if score_scope == "club_reference" and not challenge.get("allow_club_reference_times", True):
        raise HTTPException(
            status_code=400,
            detail="Vereins-Referenzzeiten sind bei dieser Challenge deaktiviert.",
        )
    if score_scope == "official" and challenge.get("block_club_member_results") and await _is_active_club_member(lap.get("user_id")):
        raise HTTPException(
            status_code=400,
            detail="Vereinsmitglieder dürfen bei dieser Challenge nur als Vereins-Referenz eingetragen werden.",
        )
    _validate_penalty_note(penalty, bool(lap.get("is_invalid")), lap.get("admin_note"))
    # Versuche zählen, sobald eine Zeit in eine Wertung kommt: beim Eintragen und wenn eine Korrektur die Wertung wechselt.
    # Je Person - bei Gästen je Gast (#1585), nie über alle Zeiten ohne Konto.
    who = {"guest_id": lap.get("guest_id")} if is_guest else {"user_id": lap.get("user_id")}
    if not next(iter(who.values())):
        raise HTTPException(status_code=400, detail="Bitte einen Fahrer oder einen Gast wählen.")
    attempt_query = {"challenge_id": challenge.get("id"), "track_id": lap.get("track_id"), **who}
    if score_scope == "club_reference":
        attempt_query["score_scope"] = "club_reference"
    else:
        attempt_query["$or"] = [{"score_scope": {"$exists": False}}, {"score_scope": "official"}]
    if current:
        attempt_query["id"] = {"$ne": current.get("id")}
    attempt_count = await db.f1_lap_times.count_documents(attempt_query)
    entering_scope = current is None or (current.get("score_scope") or "official") != score_scope
    max_attempts = _max_attempts(challenge)
    if entering_scope and max_attempts is not None and attempt_count >= max_attempts:
        scope_label = "Referenzzeiten" if score_scope == "club_reference" else "offizielle Zeiten"
        raise HTTPException(
            status_code=400,
            detail=f"Maximale Anzahl Versuche erreicht ({max_attempts}) für {scope_label}.",
        )
    return attempt_count


router = APIRouter(prefix="/api/f1", tags=["f1"])
logger = logging.getLogger("tls.f1")
# Fast-Lap-Zeiten für alle Challenges: Turnierleitung, Club-Admin, Superadmin; sonst nur mit Einsatz
# in der Challenge (f1_staff_assignments).
STAFF_ROLES = {"tournament_admin", "club_admin", "superadmin"}
F1_RESULT_STAFF_ROLES = {"organizer", "referee", "scorekeeper"}


def _iso(dt):
    if dt is None:
        return None
    if hasattr(dt, "isoformat"):
        return dt.isoformat()
    return dt


def _page_items(items: list[dict], limit: int, offset: int, paged: bool):
    safe_limit = max(1, min(int(limit or 48), 200))
    safe_offset = max(0, int(offset or 0))
    page = items[safe_offset:safe_offset + safe_limit]
    if not paged:
        return page
    return {"items": page, "total": len(items), "limit": safe_limit, "offset": safe_offset}


def _compact_challenge(challenge: dict) -> dict:
    return {
        "id": challenge.get("id"),
        "title": challenge.get("title"),
        "slug": challenge.get("slug"),
        "description": challenge.get("description"),
        "banner_url": challenge.get("banner_url"),
        "status": challenge.get("status"),
        "visibility": challenge.get("visibility"),
        "public_phase": challenge.get("public_phase"),
        "start_date": challenge.get("start_date"),
        # Das Event als Klammer (#1182): Liste und Startseite stellen die Fast Lap unter ihr Event.
        "end_date": challenge.get("end_date"),
        "event_id": challenge.get("event_id"),
        "platform": challenge.get("platform"),
        "registration_enabled": challenge.get("registration_enabled"),
        "online_registration_enabled": challenge.get("online_registration_enabled"),
        "registration_open_from": challenge.get("registration_open_from"),
        "registration_open_until": challenge.get("registration_open_until"),
        "is_championship": bool(challenge.get("is_championship")),
        "block_club_member_results": bool(challenge.get("block_club_member_results")),
        "allow_club_reference_times": challenge.get("allow_club_reference_times"),
        "show_club_reference_times": challenge.get("show_club_reference_times"),
        "club_reference_count": challenge.get("club_reference_count", 0),
        "track_count": challenge.get("track_count", 0),
        "participant_count": challenge.get("participant_count", 0),
    }


async def _resolve_cid(slug_or_id: str) -> str:
    db = get_db()
    c, _ = await find_by_slug_or_history(db.f1_challenges, slug_or_id, {"id": 1})
    if not c:
        raise HTTPException(status_code=404, detail="Challenge nicht gefunden")
    return c["id"]


def _auth_user(user) -> dict | None:
    return user if isinstance(user, dict) else None


def _is_staff(user: dict | None) -> bool:
    # Bereich Turnierleitung aus Rolle oder Freigabe (#1350): die Freigabe zählt in jeder Fast Lap wie die Rolle -
    # wie jeder Adminbereich nur mit bestätigter Zwei-Faktor-Anmeldung (#291).
    return is_confirmed_tournament_lead(_auth_user(user))


async def _has_f1_staff_permission(
    user: dict | None,
    challenge_id: str,
    allowed_roles: set[str] | None = None,
) -> bool:
    user = _auth_user(user)
    if _is_staff(user):
        return True
    if not user:
        return False
    query = {
        "challenge_id": challenge_id,
        "user_id": user["id"],
        "is_active": {"$ne": False},
    }
    if allowed_roles:
        query["role"] = {"$in": sorted(allowed_roles)}
    db = get_db()
    return bool(await db.f1_staff_assignments.find_one(query, {"_id": 0, "id": 1}))


async def _assigned_challenge_ids(user: dict | None) -> list[str]:
    if not user or not user.get("id"):
        return []
    return await get_db().f1_staff_assignments.distinct("challenge_id", {"user_id": user["id"], "is_active": {"$ne": False}})


async def _require_f1_result_permission(user: dict | None, challenge_id: str) -> None:
    if await _has_f1_staff_permission(user, challenge_id, F1_RESULT_STAFF_ROLES):
        return
    if lead_without_second_factor(_auth_user(user)):
        raise HTTPException(status_code=403, detail=MFA_MESSAGE)
    raise HTTPException(status_code=403, detail="Keine Fast-Lap-Berechtigung für diese Aktion")


async def _enrich_f1_staff_assignments(assignments: list[dict]) -> list[dict]:
    user_ids = list({row.get("user_id") for row in assignments if row.get("user_id")})
    users = {}
    if user_ids:
        rows = await get_db().users.find(
            {"id": {"$in": user_ids}},
            {"_id": 0, "id": 1, "username": 1, "display_name": 1, "email": 1, "avatar_url": 1},
        ).to_list(500)
        users = {row["id"]: row for row in rows}
    for row in assignments:
        row["user"] = users.get(row.get("user_id"))
    return assignments


async def _is_active_club_member(user_id: str | None) -> bool:
    if not user_id:
        return False
    db = get_db()
    membership = await db.memberships.find_one(
        {"user_id": user_id, "member_status": {"$in": ["active", "honorary"]}},
        {"_id": 0, "id": 1},
    )
    return bool(membership)


def _official_time_query(extra: dict | None = None) -> dict:
    return {
        **(extra or {}),
        "is_invalid": {"$ne": True},
        "$or": [{"score_scope": {"$exists": False}}, {"score_scope": {"$ne": "club_reference"}}],
    }


def _reference_time_query(extra: dict | None = None) -> dict:
    return {
        **(extra or {}),
        "is_invalid": {"$ne": True},
        "score_scope": "club_reference",
    }


async def _participant_count(db, challenge_id: str) -> int:
    """Wer eine gültige offizielle Zeit hat - Konten und Gäste (#1585) je für sich."""
    query = _official_time_query({"challenge_id": challenge_id})
    users = [uid for uid in await db.f1_lap_times.distinct("user_id", query) if uid]
    guests = [gid for gid in await db.f1_lap_times.distinct("guest_id", {**query, "user_id": None}) if gid]
    return len(users) + len(guests)


def _normalize_reference_settings(doc: dict) -> dict:
    """Keep Fast-Lap reference settings explicit and internally consistent."""
    if doc.get("block_club_member_results") is True:
        doc["allow_club_reference_times"] = True
    elif "allow_club_reference_times" not in doc:
        doc["allow_club_reference_times"] = True
    if "show_club_reference_times" not in doc:
        doc["show_club_reference_times"] = True
    return doc


async def _annotate_reference_policy(challenge: dict, include_counts: bool = False) -> dict:
    db = get_db()
    _normalize_reference_settings(challenge)
    allow_reference = challenge.get("allow_club_reference_times", True)
    challenge["club_reference_policy"] = {
        "block_club_member_results": bool(challenge.get("block_club_member_results")),
        "allow_club_reference_times": bool(allow_reference),
        "show_club_reference_times": bool(allow_reference and challenge.get("show_club_reference_times", True)),
    }
    if include_counts:
        challenge["club_reference_count"] = 0
        if allow_reference:
            challenge["club_reference_count"] = len(await db.f1_lap_times.distinct(
                "user_id",
                _reference_time_query({"challenge_id": challenge["id"]}),
            ))
    return challenge


def _lap_entries(ranked: list[dict], users: dict[str, dict], guests: dict[str, dict] | None = None) -> list[dict]:
    """Zeilen der Tabelle aus der einen Rangfunktion (#1584, ``services.fastlap_standings.rank_laps``). Gäste (#1585)
    tragen ``guest_id`` und ``is_guest``, ``user_id`` ist dann leer; ``participant_id`` ist bei allen der Schlüssel."""
    leader_ms = ranked[0]["effective_ms"] if ranked else 0
    entries = []
    for row in ranked:
        uid = row["user_id"]
        is_guest = bool(row.get("is_guest"))
        u = users.get(uid, {}) if uid else {}
        name = ((guests or {}).get(row.get("guest_id")) or {}).get("display_name") or "Gast" if is_guest \
            else u.get("display_name") or u.get("username")
        gap = row["effective_ms"] - leader_ms
        entries.append({
            "user_id": uid,
            "guest_id": row.get("guest_id") if is_guest else None,
            "participant_id": row.get("participant_id") or uid,
            "is_guest": is_guest,
            "username": u.get("username"),
            "display_name": name,
            "avatar_url": u.get("avatar_url"),
            "time_ms": row["effective_ms"],
            "time_str": _ms_to_time_str(row["effective_ms"]),
            "raw_time_ms": row["time_ms"],
            "penalty_seconds": row.get("penalty_seconds") or 0,
            "penalty_note": row.get("admin_note") if penalty_ms(row.get("penalty_seconds")) > 0 else None,
            "attempts": row["attempts"],
            "last_updated": row.get("created_at"),
            "score_scope": row.get("score_scope") or "official",
            "rank": row["rank"],
            "gap_ms": gap,
            "gap_str": f"+{gap / 1000:.3f}s" if row["rank"] > 1 else "",
        })
    return entries


def _best_lap_entries(times: list[dict], users: dict[str, dict], scope: str = "official") -> list[dict]:
    return _lap_entries(rank_laps(times, scope), users)


# Nach „Ergebnisse veröffentlicht“ (#1584): Gewinne und Saisonpunkte stehen fest, die Zeiten auch. Ändern darf nur noch die
# Turnierleitung, mit Begründung - und jede Änderung steht im Protokoll.
LOCKED_STATUSES = {"results_published", "archived"}
MIN_CHANGE_REASON = 10
LOCKED_FOR_HELPERS = ("Die Ergebnisse sind veröffentlicht - Zeiten ändert jetzt nur noch die Turnierleitung, "
                      "mit Begründung.")
LOCKED_NEEDS_REASON = (f"Die Ergebnisse sind veröffentlicht - bitte begründe die Änderung (mind. {MIN_CHANGE_REASON} "
                       "Zeichen). Sie steht danach im Protokoll.")


def _published_change_reason(challenge: dict, me: dict, reason: str | None) -> str | None:
    """Die Begründung einer Änderung nach der Veröffentlichung - ``None``, solange nichts veröffentlicht ist."""
    if challenge.get("status") not in LOCKED_STATUSES:
        return None
    if not _is_staff(me):
        raise HTTPException(status_code=409, detail=LOCKED_FOR_HELPERS)
    text = (reason or "").strip() if isinstance(reason, str) else ""
    if len(text) < MIN_CHANGE_REASON:
        raise HTTPException(status_code=409, detail=LOCKED_NEEDS_REASON)
    return text


LAP_AUDIT_FIELDS = ("time_ms", "penalty_seconds", "is_invalid", "score_scope")


def _lap_facts(lap: dict | None) -> dict | None:
    return {field: lap.get(field) for field in LAP_AUDIT_FIELDS} if lap else None


def _has_penalty(lap: dict | None) -> bool:
    return bool(lap) and (penalty_ms(lap.get("penalty_seconds")) > 0 or bool(lap.get("is_invalid")))


def _penalty_changed(before: dict | None, after: dict | None) -> bool:
    if not before:
        return _has_penalty(after)
    if not after:
        return False
    return (penalty_ms(before.get("penalty_seconds")) != penalty_ms(after.get("penalty_seconds"))
            or bool(before.get("is_invalid")) != bool(after.get("is_invalid")))


async def _audit_lap(db, action: str, me: dict, lap: dict, *, before: dict | None, after: dict | None, reason: str | None) -> None:
    """Protokoll (#1584): wer was an welcher Zeit geändert hat - nur Kennungen und Zahlen, keine Namen."""
    stamp = now_utc().isoformat()
    data = {
        "challenge_id": lap.get("challenge_id"), "track_id": lap.get("track_id"), "user_id": lap.get("user_id"),
        "before": _lap_facts(before), "after": _lap_facts(after), "reason": reason, "after_publishing": reason is not None,
    }
    actions = [action]
    if action != "fastlap.time.delete" and _penalty_changed(before, after):
        actions.append("fastlap.time.penalty")
    for name in actions:
        await db.audit_logs.insert_one({"id": new_id(), "action": name, "actor_id": me.get("id"), "target_id": lap.get("id"),
                                        "data": data, "created_at": stamp})


async def _visible_event_summary(event_id: str, user: dict | None, include_draft: bool = False) -> dict | None:
    db = get_db()
    user = _auth_user(user)
    event = await db.events.find_one(
        {"id": event_id},
        {"_id": 0, "id": 1, "slug": 1, "name": 1, "start_date": 1, "status": 1, "location": 1, "visibility": 1},
    )
    if not event:
        return None
    if event.get("status") == "draft" and not _is_staff(user):
        return None
    if not await lead_can_see(user, event.get("visibility") or "public"):
        return None
    return event


async def _get_visible_challenge_record(slug_or_id: str, user: dict | None = None, include_draft: bool = False, access: str | None = None) -> tuple[dict, bool]:
    db = get_db()
    user = _auth_user(user)
    c, was_old_slug = await find_by_slug_or_history(db.f1_challenges, slug_or_id, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Challenge nicht gefunden")
    is_assigned = await _has_f1_staff_permission(user, c["id"], F1_RESULT_STAFF_ROLES)
    access_link = await validate_access_link(db, access, "fastlap", c["id"], user, "view")
    has_access = bool(access_link)
    if c.get("status") == "draft" and not (_is_staff(user) or is_assigned or has_access):
        raise HTTPException(status_code=404, detail="Challenge nicht gefunden")
    if not (_is_staff(user) or is_assigned or has_access) and not await user_can_see(user, c.get("visibility") or "public"):
        raise HTTPException(status_code=403, detail="Challenge ist nicht sichtbar")
    c["public_phase"] = derive_public_phase(c, "f1")
    if access_link:
        await touch_access_link(db, access_link, user)
        c["access_link"] = public_access_link_payload(access_link)
    return c, was_old_slug


async def _get_visible_challenge(slug_or_id: str, user: dict | None = None, include_draft: bool = False, access: str | None = None) -> dict:
    c, _ = await _get_visible_challenge_record(slug_or_id, user, include_draft=include_draft, access=access)
    return c


def _lap_time_text(lap: dict) -> str:
    """Die Zeit einer Runde als Text; eine ungültige Runde ohne Zeit (#1585) heißt „ohne Zeit“."""
    if lap.get("is_invalid") and not lap.get("time_ms"):
        return "ohne Zeit"
    return _ms_to_time_str(lap.get("time_ms"))


def _ms_to_time_str(ms: int) -> str:
    if ms is None:
        return "—"
    m = ms // 60000
    s = (ms % 60000) // 1000
    mil = ms % 1000
    return f"{m}:{s:02d}.{mil:03d}"


@router.get("/challenges")
async def list_challenges(
    status: str | None = None,
    limit: int = 100,
    offset: int = 0,
    paged: bool = False,
    compact: bool = False,
    include_drafts: bool = False,
    managed: bool = False,
    user=Depends(get_optional_user),
):
    db = get_db()
    is_staff = _is_staff(user)
    # Helfer einer Fast Lap sehen deren Entwurf wie die Turnierleitung (#1028).
    assigned_ids = [] if is_staff else await _assigned_challenge_ids(_auth_user(user))
    q = {}
    if status:
        if status == "draft" and not (include_drafts and (is_staff or assigned_ids)):
            return []
        q["status"] = status
    elif include_drafts and is_staff:
        pass
    elif include_drafts and assigned_ids:
        q["$or"] = [{"status": {"$ne": "draft"}}, {"id": {"$in": assigned_ids}}]
    else:
        q["status"] = {"$ne": "draft"}
    if managed and not is_staff:
        # Verwaltungsliste (#1028): ohne die Turnierleitung über alle Fast Laps - dazu gehört die bestätigte
        # Zwei-Faktor-Anmeldung - nur die Fast Laps des eigenen Helfer-Einsatzes.
        q["id"] = {"$in": assigned_ids}
    safe_limit = max(1, min(int(limit or 100), 500))
    projection = {"_id": 0}
    if compact:
        projection = {
            "_id": 0, "id": 1, "title": 1, "slug": 1, "description": 1,
            "banner_url": 1, "status": 1, "visibility": 1, "start_date": 1, "end_date": 1, "event_id": 1,
            "platform": 1, "registration_enabled": 1, "online_registration_enabled": 1,
            "registration_open_from": 1, "registration_open_until": 1,
            "is_championship": 1, "block_club_member_results": 1,
            "allow_club_reference_times": 1, "show_club_reference_times": 1,
        }
    fetch_limit = max(safe_limit, min(safe_limit + max(int(offset or 0), 0) + 80, 500))
    challenges = await db.f1_challenges.find(q, projection).sort("created_at", -1).to_list(fetch_limit)
    visible = []
    for c in challenges:
        if c.get("id") not in assigned_ids and not await lead_can_see(user, c.get("visibility") or "public"):
            continue
        await _annotate_reference_policy(c, include_counts=True)
        c["public_phase"] = derive_public_phase(c, "f1")
        c["track_count"] = await db.f1_tracks.count_documents({"challenge_id": c["id"]})
        c["participant_count"] = await _participant_count(db, c["id"])
        visible.append(c)
    # Das Event als Klammer (#1182): die Kennung des Events nur, wenn es für die Person sichtbar ist (#1473).
    await hide_unseen_event_links(db, user, visible)
    if compact:
        visible = [_compact_challenge(c) for c in visible]
        return _page_items(visible, limit, offset, paged)
    return visible


@router.get("/challenges/{slug_or_id}")
async def get_challenge(slug_or_id: str, include_draft: bool = False, access: str | None = None, user=Depends(get_optional_user)):
    db = get_db()
    c, was_old_slug = await _get_visible_challenge_record(slug_or_id, user, include_draft=include_draft, access=access)
    if was_old_slug and c.get("slug"):
        suffix = f"?{urlencode({'access': access})}" if access else ""
        return RedirectResponse(url=f"/api/f1/challenges/{quote(str(c['slug']), safe='')}{suffix}", status_code=301)
    await _annotate_reference_policy(c, include_counts=True)
    c["can_manage_times"] = await _has_f1_staff_permission(user, c["id"], F1_RESULT_STAFF_ROLES)
    tracks = await db.f1_tracks.find({"challenge_id": c["id"]}, {"_id": 0}).sort("order_index", 1).to_list(100)
    c["tracks"] = tracks
    c["participant_count"] = await _participant_count(db, c["id"])
    c["attempt_limit"] = _max_attempts(c)
    if c.get("event_id"):
        event = await _visible_event_summary(c["event_id"], user)
        if event:
            c["event"] = event
    return c


@router.get("/challenges/{cid}/assignable-users")
async def assignable_users(cid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    cid = await _resolve_cid(cid)
    await _require_f1_result_permission(me, cid)
    # Für die Auswahl am Simulator reichen Name und Bild; Kontodaten wie E-Mail oder Rolle braucht dort niemand.
    users = await db.users.find(
        {},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1},
    ).sort("display_name", 1).to_list(1000)
    member_ids = set(await db.memberships.distinct("user_id", {"member_status": {"$in": ["active", "honorary"]}}))
    for user in users:
        user["is_club_member"] = user.get("id") in member_ids
    return users


@router.get("/challenges/{cid}/staff")
async def list_challenge_staff(cid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    cid = await _resolve_cid(cid)
    if not _is_staff(me):
        await _require_f1_result_permission(me, cid)
    assignments = await db.f1_staff_assignments.find(
        {"challenge_id": cid},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    rows = await _enrich_f1_staff_assignments(assignments)
    if not _is_staff(me):
        # Helfer einer einzelnen Fast Lap sehen die anderen Helfer mit Namen, nicht mit E-Mail.
        for row in rows:
            if isinstance(row.get("user"), dict):
                row["user"] = {key: value for key, value in row["user"].items() if key != "email"}
    return rows


@router.post("/challenges/{cid}/staff")
async def create_challenge_staff(cid: str, body: dict, me: dict = Depends(require_admin())):
    db = get_db()
    cid = await _resolve_cid(cid)
    user_id = body.get("user_id")
    role = body.get("role") or "scorekeeper"
    if role not in F1_RESULT_STAFF_ROLES:
        raise HTTPException(status_code=400, detail="Ungültige Fast-Lap-Rolle")
    if not user_id or not await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=400, detail="Nutzer nicht gefunden")
    existing = await db.f1_staff_assignments.find_one({
        "challenge_id": cid,
        "user_id": user_id,
        "role": role,
    })
    if existing:
        raise HTTPException(status_code=409, detail="Diese Zuweisung existiert bereits")
    doc = {
        "id": new_id(),
        "challenge_id": cid,
        "user_id": user_id,
        "role": role,
        "is_active": body.get("is_active") is not False,
        "notes": body.get("notes") or "",
        "created_by": me["id"],
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    await db.f1_staff_assignments.insert_one(doc)
    doc.pop("_id", None)
    return (await _enrich_f1_staff_assignments([doc]))[0]


@router.patch("/challenges/{cid}/staff/{assignment_id}")
async def update_challenge_staff(cid: str, assignment_id: str, body: dict, me: dict = Depends(require_admin())):
    db = get_db()
    cid = await _resolve_cid(cid)
    current = await db.f1_staff_assignments.find_one({"id": assignment_id, "challenge_id": cid}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Zuweisung nicht gefunden")
    updates = {}
    if "is_active" in body:
        updates["is_active"] = body.get("is_active") is not False
    if "notes" in body:
        updates["notes"] = body.get("notes") or ""
    if "role" in body:
        role = body.get("role")
        if role not in F1_RESULT_STAFF_ROLES:
            raise HTTPException(status_code=400, detail="Ungültige Fast-Lap-Rolle")
        updates["role"] = role
    if not updates:
        return current
    updates["updated_at"] = now_utc().isoformat()
    await db.f1_staff_assignments.update_one({"id": assignment_id}, {"$set": updates})
    updated = await db.f1_staff_assignments.find_one({"id": assignment_id}, {"_id": 0})
    return (await _enrich_f1_staff_assignments([updated]))[0]


@router.delete("/challenges/{cid}/staff/{assignment_id}")
async def delete_challenge_staff(cid: str, assignment_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    cid = await _resolve_cid(cid)
    result = await db.f1_staff_assignments.delete_one({"id": assignment_id, "challenge_id": cid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Zuweisung nicht gefunden")
    return {"ok": True}


@router.post("/challenges")
async def create_challenge(body: F1ChallengeCreate, me: dict = Depends(require_admin())):
    return await create_challenge_doc(body, me)


async def create_challenge_doc(body: F1ChallengeCreate, me: dict) -> dict:
    """Anlegen ohne Route - auch für „+ Fast Lap“ im Event (#1371, ``event_program_routes``)."""
    db = get_db()
    doc = body.model_dump()
    doc["slug"] = await unique_slug(db.f1_challenges, doc.get("slug") or doc.get("title"), fallback="fastlap")
    _normalize_reference_settings(doc)
    doc["id"] = new_id()
    doc["status"] = doc.get("status") or "draft"
    doc["online_registration_enabled"] = doc.get("registration_enabled") is True
    if doc.get("online_registration_enabled") is not True:
        doc["registration_enabled"] = False
        doc["online_registration_enabled"] = False
        doc["registration_open_from"] = None
        doc["registration_open_until"] = None
    for k in ["registration_open_from", "registration_open_until", "start_date", "end_date"]:
        doc[k] = _iso(doc.get(k))
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    doc["created_by"] = me["id"]
    await db.f1_challenges.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/challenges/{cid}")
@router.patch("/challenges/{cid}")
async def update_challenge(cid: str, body: F1ChallengeUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    cid = await _resolve_cid(cid)
    existing = await db.f1_challenges.find_one({"id": cid}, {"_id": 0}) or {}
    raw = body.model_dump(exclude_unset=True)
    change_reason = raw.pop("change_reason", None)
    # Event als Klammer (#1371): verbunden wird nur im Event - wie beim Turnier.
    if "event_id" in raw and (raw.pop("event_id") or None) != (existing.get("event_id") or None):
        raise HTTPException(status_code=400, detail="Zu welchem Event das gehört, änderst du im Event unter „Programm“.")
    nullable_fields = {
        "description", "event_id", "vehicle", "weather", "assists_allowed", "controller_type",
        "platform", "banner_url", "twitch_channel", "stream_platform",
        "stream_url", "stream_title", "max_attempts", "prize_places",
        "registration_open_from", "registration_open_until", "start_date", "end_date",
    }
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    slug_source = slug_source_for_update(raw, existing, "title", fallback="fastlap")
    if slug_source is not None:
        updates["slug"] = await unique_slug(db.f1_challenges, slug_source, current_id=cid, fallback="fastlap")
        apply_slug_history(existing, updates)
    if updates.get("block_club_member_results") is True:
        updates["allow_club_reference_times"] = True
    elif updates.get("allow_club_reference_times") is False and (
        updates.get("block_club_member_results") is True
        or (existing.get("block_club_member_results") is True and updates.get("block_club_member_results") is not False)
    ):
        raise HTTPException(
            status_code=400,
            detail="Wenn Vereinsmitglieder von der offiziellen Wertung ausgeschlossen sind, müssen Vereins-Referenzzeiten erlaubt bleiben.",
        )
    # Wertungsregeln nach der Veröffentlichung (#1584) - wie eine Zeitkorrektur: nur die Turnierleitung, mit
    # Begründung, im Protokoll, danach Gewinne und Saisonpunkte abgleichen.
    rule_fields = _changed_scoring_fields(existing, updates)
    rules_reason = _published_change_reason(existing, me, change_reason) if rule_fields else None
    member_rule_changed = "block_club_member_results" in rule_fields
    if "registration_enabled" in updates:
        updates["online_registration_enabled"] = updates.get("registration_enabled") is True
    if updates.get("online_registration_enabled") is False:
        updates["registration_enabled"] = False
        updates["registration_open_from"] = None
        updates["registration_open_until"] = None
        if existing.get("status") in ("registration_open", "registration_closed"):
            updates["status"] = "scheduled"
    for k in ["registration_open_from", "registration_open_until", "start_date", "end_date"]:
        if k in updates:
            updates[k] = _iso(updates.get(k))
    updates["updated_at"] = now_utc().isoformat()
    await db.f1_challenges.update_one({"id": cid}, {"$set": updates})
    moved = moved_back = 0
    if updates.get("block_club_member_results") is True:
        member_ids = await db.memberships.distinct("user_id", {"member_status": {"$in": ["active", "honorary"]}})
        if member_ids:
            # Was die Regel verschiebt, trägt eine Markierung - nur das stellt das Abschalten wieder zurück.
            moved_result = await db.f1_lap_times.update_many(
                {
                    "challenge_id": cid,
                    "user_id": {"$in": member_ids},
                    "$or": [{"score_scope": {"$exists": False}}, {"score_scope": "official"}],
                },
                {"$set": {"score_scope": "club_reference", "moved_by_member_rule": True, "updated_at": now_utc().isoformat()}},
            )
            moved = getattr(moved_result, "modified_count", 0) or 0
    elif member_rule_changed:
        back_result = await db.f1_lap_times.update_many(
            {"challenge_id": cid, "moved_by_member_rule": True, "score_scope": "club_reference"},
            {"$set": {"score_scope": "official", "moved_by_member_rule": False, "updated_at": now_utc().isoformat()}},
        )
        moved_back = getattr(back_result, "modified_count", 0) or 0
    c = await db.f1_challenges.find_one({"id": cid}, {"_id": 0})
    await _annotate_reference_policy(c, include_counts=True)
    if existing.get("status") in LOCKED_STATUSES and c.get("status") not in LOCKED_STATUSES:
        # Die Veröffentlichung zurücknehmen öffnet die Zeiten wieder - das steht im Protokoll (#1584).
        await db.audit_logs.insert_one({"id": new_id(), "action": "fastlap.challenge.unpublish", "actor_id": me.get("id"), "target_id": cid,
                                        "data": {"from": existing.get("status"), "to": c.get("status")}, "created_at": now_utc().isoformat()})
    if existing.get("status") != c.get("status") and c.get("status") == "results_published":
        try:
            await _award_f1_season_points(c)
        except Exception:
            logger.warning("[f1] Saisonpunkte für %s nicht vergeben", log_safe(cid), exc_info=True)
    prize_status = c.get("status") in {"completed", "results_published", "archived"}
    should_create_prizes = prize_status and (
        existing.get("status") != c.get("status") or "prize_places" in updates
    )
    if should_create_prizes:
        try:
            from services.prize_service import auto_create_for_f1_challenge
            await auto_create_for_f1_challenge(c["id"])
        except Exception:
            logger.warning("[f1] Preise für %s nicht angelegt", log_safe(cid), exc_info=True)
    stamp = now_utc().isoformat()
    if member_rule_changed:
        await db.audit_logs.insert_one({"id": new_id(), "action": "fastlap.challenge.member_rule", "actor_id": me.get("id"), "target_id": cid,
                                        "data": {"block_club_member_results": bool(c.get("block_club_member_results")), "moved": moved,
                                                 "moved_back": moved_back, "reason": rules_reason}, "created_at": stamp})
    other_rules = [field for field in rule_fields if field != "block_club_member_results"]
    if other_rules and rules_reason is not None:
        await db.audit_logs.insert_one({"id": new_id(), "action": "fastlap.challenge.rules", "actor_id": me.get("id"), "target_id": cid,
                                        "data": {"fields": other_rules, "reason": rules_reason}, "created_at": stamp})
    warning = await _resync_published_results(db, cid, me, rules_reason, "fastlap.challenge.rules")
    if warning:
        c["resync_warning"] = warning
    return c


# Felder, die über Rangfolge, Gewinne oder Saisonpunkte entscheiden (#1584) - nach der Veröffentlichung nur mit Begründung.
SCORING_FIELDS = ("block_club_member_results", "is_championship", "points_per_position", "prize_places", "season_weight")


def _changed_scoring_fields(existing: dict, updates: dict) -> list[str]:
    changed = []
    for field in SCORING_FIELDS:
        if field not in updates:
            continue
        before, after = existing.get(field), updates[field]
        if field in ("block_club_member_results", "is_championship"):
            before, after = bool(before), bool(after)
        elif field == "season_weight":
            before, after = float(before if before is not None else 1.0), float(after if after is not None else 1.0)
        if before != after:
            changed.append(field)
    return changed


RESYNC_WARNING = "Korrektur gespeichert - Gewinne und Saisonpunkte ließen sich nicht angleichen, bitte prüfen."
RESYNC_WAIT_SECONDS = 10.0


def results_resource(challenge_id: str) -> str:
    return f"fastlap:{challenge_id}:results"


async def _resync_published_results(db, challenge_id: str, me: dict, reason: str | None, trigger: str) -> str | None:
    """Nach einer Korrektur veröffentlichter Ergebnisse (#1584): Gewinne und Saisonpunkte an die neue Rangfolge
    angleichen - dieselbe Rechnung wie beim Veröffentlichen, wiederholbar und je Challenge unter einer Sperre, damit zwei
    gleichzeitige Korrekturen nichts doppelt anlegen. Ausgegebene Gewinne werden nie entzogen, sondern als „nach
    Korrektur prüfen“ markiert. Was sich geändert hat, steht im Protokoll; scheitert der Abgleich, steht auch das dort,
    und die Antwort bekommt einen Hinweis (Rückgabe)."""
    if reason is None:
        return None
    challenge = await db.f1_challenges.find_one({"id": challenge_id}, {"_id": 0})
    if not challenge or challenge.get("status") not in LOCKED_STATUSES:
        return None
    try:
        async with mutation_lock(db, results_resource(challenge_id), wait_seconds=RESYNC_WAIT_SECONDS):
            from services.prize_service import review_f1_prizes
            prizes = await review_f1_prizes(challenge_id)
            points = await _resync_f1_season_points(challenge)
    except Exception:
        logger.warning("[f1] Abgleich nach Korrektur in %s fehlgeschlagen", log_safe(challenge_id), exc_info=True)
        await db.audit_logs.insert_one({"id": new_id(), "action": "fastlap.results.resync_failed", "actor_id": me.get("id"),
                                        "target_id": challenge_id, "data": {"status": challenge.get("status"), "trigger": trigger},
                                        "created_at": now_utc().isoformat()})
        return RESYNC_WARNING
    await db.audit_logs.insert_one({"id": new_id(), "action": "fastlap.results.resync", "actor_id": me.get("id"), "target_id": challenge_id,
                                    "data": {"reason": reason, "prizes_created": prizes["created"], "prizes_to_review": prizes["to_review"],
                                             "season_points": points}, "created_at": now_utc().isoformat()})
    return None


async def _resync_f1_season_points(challenge: dict) -> dict:
    """Saisonpunkte je Strecke angleichen - in der Saison, in der sie beim Veröffentlichen vergeben wurden. Wurden keine
    vergeben (keine aktive Saison damals), bleibt es dabei."""
    from collections import Counter
    from services.season_service import resync_source_points

    db = get_db()
    cid = challenge["id"]
    tracks = await db.f1_tracks.find({"challenge_id": cid}, {"_id": 0}).sort("order_index", 1).to_list(100)
    source_ids = [f"{cid}:{track['id']}" for track in tracks]
    awarded = await db.season_points.find({"source_type": "fastlap", "source_id": {"$in": source_ids}},
                                          {"_id": 0, "season_id": 1, "source_id": 1}).to_list(None)
    totals: Counter = Counter()
    if not awarded:
        return dict(totals)
    season_by_source = {row["source_id"]: row["season_id"] for row in awarded}
    fallback = Counter(row["season_id"] for row in awarded).most_common(1)[0][0]
    weight = float(challenge.get("season_weight") or 1.0)
    for track in tracks:
        source_id = f"{cid}:{track['id']}"
        ranked = track_ranking(await official_times(db, cid, track["id"]))
        totals.update(await resync_source_points(
            season_id=season_by_source.get(source_id, fallback), source_type="fastlap", source_id=source_id,
            source_name=f"{challenge.get('title') or 'Fast Lap'} - {track.get('name') or 'Strecke'}",
            ranking=[(uid, pos + 1) for pos, (uid, _) in enumerate(ranked)], weight=weight,
        ))
    return dict(totals)


async def _award_f1_season_points(challenge: dict):
    db = get_db()
    from services.season_service import award_points

    cid = challenge["id"]
    tracks = await db.f1_tracks.find({"challenge_id": cid}, {"_id": 0}).sort("order_index", 1).to_list(100)
    weight = float(challenge.get("season_weight") or 1.0)
    for track in tracks:
        ranked = track_ranking(await official_times(db, cid, track["id"]))
        num_participants = max(len(ranked), 1)
        for pos, (uid, _) in enumerate(ranked):
            await award_points(
                user_id=uid,
                source_type="fastlap",
                source_id=f"{cid}:{track['id']}",
                source_name=f"{challenge.get('title') or 'Fast Lap'} - {track.get('name') or 'Strecke'}",
                rank=pos + 1,
                num_participants=num_participants,
                weight=weight,
            )


@router.delete("/challenges/{cid}")
async def delete_challenge(cid: str, me: dict = Depends(require_admin())):
    db = get_db()
    cid = await _resolve_cid(cid)
    current = await db.f1_challenges.find_one({"id": cid}, {"_id": 0, "status": 1}) or {}
    # Veröffentlichte Ergebnisse verschwinden nicht mit der Challenge (#1584) - dafür gibt es „Archiviert“.
    if current.get("status") in LOCKED_STATUSES and await db.f1_lap_times.count_documents({"challenge_id": cid}):
        raise HTTPException(status_code=409, detail="Die Ergebnisse sind veröffentlicht - eine Challenge mit Zeiten wird archiviert, nicht gelöscht.")
    await db.f1_challenges.delete_one({"id": cid})
    await db.f1_tracks.delete_many({"challenge_id": cid})
    await db.f1_lap_times.delete_many({"challenge_id": cid})
    await db.f1_staff_assignments.delete_many({"challenge_id": cid})
    await db.f1_guests.delete_many({"challenge_id": cid})
    await db.f1_queue.delete_many({"challenge_id": cid})
    await db.prize_pickups.delete_many({"source_type": "fastlap", "fastlap_challenge_id": cid})
    return {"ok": True}


# --- Tracks ---
def _check_plausible_limits(track: dict) -> None:
    """Plausibilität (#1584): die untere Grenze liegt unter der oberen - sonst fragte jede Zeit nach."""
    low, high = plausible_range(track)
    if low >= high:
        raise HTTPException(status_code=400, detail="Die untere Grenze für plausible Zeiten muss unter der oberen liegen.")



@router.post("/challenges/{cid}/tracks")
async def add_track(cid: str, body: F1TrackCreate, me: dict = Depends(require_admin())):
    db = get_db()
    cid = await _resolve_cid(cid)
    c = await db.f1_challenges.find_one({"id": cid})
    if not c:
        raise HTTPException(status_code=404)
    doc = body.model_dump()
    _check_plausible_limits(doc)
    doc["id"] = new_id()
    doc["challenge_id"] = cid
    doc["created_at"] = now_utc().isoformat()
    await db.f1_tracks.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/tracks/{tid}")
@router.patch("/tracks/{tid}")
async def update_track(tid: str, body: F1TrackUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    nullable_fields = {"image_url", "country", "target_time_ms", "min_plausible_ms", "max_plausible_ms"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    current = await db.f1_tracks.find_one({"id": tid}, {"_id": 0, "min_plausible_ms": 1, "max_plausible_ms": 1}) or {}
    # Plausibilität (#1584): die untere Grenze liegt unter der oberen - sonst fragte jede Zeit nach.
    _check_plausible_limits({**current, **{k: v for k, v in updates.items() if k in ("min_plausible_ms", "max_plausible_ms")}})
    await db.f1_tracks.update_one({"id": tid}, {"$set": updates})
    tr = await db.f1_tracks.find_one({"id": tid}, {"_id": 0})
    return tr


@router.delete("/tracks/{tid}")
async def delete_track(tid: str, me: dict = Depends(require_admin())):
    db = get_db()
    track = await db.f1_tracks.find_one({"id": tid}, {"_id": 0, "challenge_id": 1}) or {}
    challenge = await db.f1_challenges.find_one({"id": track.get("challenge_id")}, {"_id": 0, "status": 1}) or {}
    # Nach der Veröffentlichung (#1584) löscht eine Strecke ihre Zeiten nicht mehr nebenbei.
    if challenge.get("status") in LOCKED_STATUSES and await db.f1_lap_times.count_documents({"track_id": tid}):
        raise HTTPException(status_code=409, detail="Die Ergebnisse sind veröffentlicht - eine Strecke mit Zeiten bleibt stehen.")
    await db.f1_tracks.delete_one({"id": tid})
    await db.f1_lap_times.delete_many({"track_id": tid})
    return {"ok": True}


# --- Lap times ---
@router.get("/challenges/{cid}/leaderboard")
async def leaderboard(cid: str, track_id: str | None = None, access: str | None = None, user=Depends(get_optional_user)):
    """Per-track leaderboard. If no track_id, use first track."""
    db = get_db()
    c = await _get_visible_challenge(cid, user, access=access)
    cid = c["id"]
    if not track_id:
        first_track = await db.f1_tracks.find_one({"challenge_id": cid}, {"_id": 0},
                                                    sort=[("order_index", 1)])
        if not first_track:
            return {"challenge": c, "track": None, "entries": []}
        track_id = first_track["id"]
    # Nur Strecken dieser Challenge (#1584) - eine fremde Kennung verrät nichts über andere Challenges.
    track = await db.f1_tracks.find_one({"id": track_id, "challenge_id": cid}, {"_id": 0})
    if not track:
        raise HTTPException(status_code=404, detail="Strecke nicht gefunden")
    # Alle Zeiten der Strecke: die Rangfunktion wertet nur gültige, zählt aber jede als Versuch (#1584).
    times = await load_laps(db, {"challenge_id": cid, "track_id": track_id})
    # Die Tabelle zeigt auch Gäste ohne Konto (#1585) - Gewinne, Saisonpunkte und Erfolge rechnen ohne sie.
    ranked = rank_laps(times, include_guests=True)
    show_reference = c.get("allow_club_reference_times", True) and c.get("show_club_reference_times", True)
    reference_ranked = rank_laps(times, REFERENCE_SCOPE)[:3] if show_reference else []
    user_ids = list({row["user_id"] for row in ranked + reference_ranked if row.get("user_id")})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, private_projection()).to_list(len(user_ids) + 10)} if user_ids else {}
    guests = await guests_by_id(db, [row.get("guest_id") for row in ranked if row.get("is_guest")])
    entries = _lap_entries(ranked, users, guests)
    club_reference_entries = _lap_entries(reference_ranked, users)
    return {
        "challenge": c,
        "track": track,
        # Versuche je Person und Strecke (#1585): Zahl oder None für unbegrenzt - alle Anzeigen lesen diesen Wert.
        "max_attempts": _max_attempts(c),
        "entries": entries,
        "club_reference_entries": club_reference_entries,
        "club_reference_public": bool(c.get("allow_club_reference_times", True) and c.get("show_club_reference_times", True)),
    }


@router.get("/challenges/{cid}/championship")
async def championship_standings(cid: str, access: str | None = None, user=Depends(get_optional_user)):
    """Championship standings across all tracks using points_per_position - dieselbe Rechnung wie der Zähler
    „Meisterschafts-Top“ (services/fastlap_standings.py, #613)."""
    db = get_db()
    from services.fastlap_standings import challenge_standings
    c = await _get_visible_challenge(cid, user, access=access)
    standings, per_track_results, tracks = await challenge_standings(db, c)
    for entry in per_track_results.values():
        for result in entry["results"]:
            result["time_str"] = _ms_to_time_str(result["time_ms"])
    # enrich users
    user_ids = [s["user_id"] for s in standings]
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, private_projection()).to_list(500)}
    arr = []
    for s in standings:
        u = users.get(s["user_id"], {})
        arr.append({**s, "username": u.get("username"),
                     "display_name": u.get("display_name") or u.get("username"),
                     "avatar_url": u.get("avatar_url")})
    return {"challenge": c, "standings": arr, "per_track": per_track_results, "tracks": tracks}


@router.post("/challenges/{cid}/times")
async def add_time(cid: str, body: F1LapTimeCreate, me: dict = Depends(get_current_user)):
    db = get_db()
    cid = await _resolve_cid(cid)
    # Verify
    c = await db.f1_challenges.find_one({"id": cid})
    if not c:
        raise HTTPException(status_code=404)
    await _require_f1_result_permission(me, cid)
    reason = _published_change_reason(c, me, body.change_reason)
    # Genau eine Person: ein Konto oder ein Gast dieser Challenge (#1585).
    if bool(body.user_id) == bool(body.guest_id):
        raise HTTPException(status_code=400, detail="Bitte genau einen Fahrer oder einen Gast wählen.")
    if body.guest_id:
        await find_guest(db, cid, body.guest_id)
    elif not await db.users.find_one({"id": body.user_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=400, detail="Spieler nicht gefunden")
    score_scope = body.score_scope or "official"
    driver_key = body.user_id or guest_participant_id(body.guest_id)
    # Dieselbe Prüfung wie beim Korrigieren (#1038) - Versuche zählen und schreiben unter einer Sperre.
    try:
        async with mutation_lock(db, lap_attempt_resource(cid, body.track_id, driver_key, score_scope), wait_seconds=LAP_WAIT_SECONDS):
            attempt_count = await check_lap_time(db, c, {**body.model_dump(), "user_id": body.user_id or None, "score_scope": score_scope},
                                                 confirm_implausible=body.confirm_implausible)
            stamp = now_utc().isoformat()
            doc = {
                "id": new_id(),
                "challenge_id": cid,
                "track_id": body.track_id,
                "user_id": body.user_id or None,
                "guest_id": body.guest_id or None,
                "time_ms": body.time_ms,
                "penalty_seconds": body.penalty_seconds,
                "is_invalid": body.is_invalid,
                "proof_url": body.proof_url,
                "admin_note": body.admin_note,
                "score_scope": score_scope,
                "attempt_number": attempt_count + 1,
                "created_by": me["id"],
                "created_at": stamp,
                "updated_at": stamp,
            }
            # Wer eine Strafe setzt, steht als Aussteller in der Strafen-Liste (#1584).
            if _has_penalty(doc):
                doc["penalty_set_by"], doc["penalty_set_at"] = me["id"], stamp
            await db.f1_lap_times.insert_one(doc)
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=LAP_BUSY)
    doc.pop("_id", None)
    await _audit_lap(db, "fastlap.time.create", me, doc, before=None, after=doc, reason=reason)
    warning = await _resync_published_results(db, cid, me, reason, "fastlap.time.create")
    if warning:
        doc["resync_warning"] = warning
    doc["proof_url"] = safe_proof_url(doc.get("proof_url"))
    doc["time_str"] = _lap_time_text(doc)
    # Discord trigger: if this submission is the new P1 on this track. Gäste (#1585) melden wir nicht - ihr Name ginge
    # an Discord, wo er nicht abläuft; die Bestzeit eines Gastes zählt aber als Zeit, die ein Konto schlagen muss.
    was_new_leader = False
    if not body.is_invalid and score_scope != "club_reference" and body.user_id:
        try:
            from discord_service import send_public_discord
            effective = effective_ms(doc)
            # Die bisherige Bestzeit aus der einen Rangfunktion (#1584); gleich schnell ist keine neue Bestzeit -
            # bei Gleichstand bleibt die früher gefahrene vorn.
            others = await load_laps(db, {**_official_time_query({"challenge_id": cid, "track_id": body.track_id}), "id": {"$ne": doc["id"]}})
            ranked_before = rank_laps(others, include_guests=True)
            prev_best = ranked_before[0]["effective_ms"] if ranked_before else None
            if prev_best is None or effective < prev_best:
                was_new_leader = True
                u = await db.users.find_one({"id": body.user_id}, {"display_name": 1, "username": 1}) or {}
                tr = await db.f1_tracks.find_one({"id": body.track_id}, {"name": 1}) or {}
                # Dieselbe Meldung wie in der Vorschau unter Verbindungen → Discord (#583).
                from services.discord_announcements import fast_lap_message
                message = fast_lap_message({**c, "id": cid}, driver=u.get("display_name") or u.get("username") or "", track=tr.get("name") or "",
                                           time_text=_ms_to_time_str(effective), previous_text=_ms_to_time_str(prev_best) if prev_best else None)
                await send_public_discord(
                    c, message["title"], message["description"],
                    color=message["color"], url=message["url"], fields=message["fields"], event_key=message["event_key"],
                    buttons=message["buttons"],
                )
        except Exception:
            logger.warning("[f1] Discord-Meldung zur Bestzeit in %s fehlgeschlagen", log_safe(cid), exc_info=True)
    # Badge trigger - nur für Konten; Gäste sammeln keine Erfolge (#1585).
    if score_scope != "club_reference" and body.user_id:
        try:
            from badges import on_lap_submitted
            await on_lap_submitted(body.user_id, cid, body.track_id, was_new_leader, body.is_invalid)
        except Exception:
            logger.warning("[achievements] Rundenzeit in %s nicht ausgewertet", log_safe(cid), exc_info=True)
    return doc


@router.get("/challenges/{cid}/times")
async def list_times(cid: str, track_id: str | None = None, user_id: str | None = None, me: dict = Depends(get_current_user)):
    db = get_db()
    cid = await _resolve_cid(cid)
    await _require_f1_result_permission(me, cid)
    q = {"challenge_id": cid}
    if track_id:
        q["track_id"] = track_id
    if user_id:
        q["user_id"] = user_id
    times = await db.f1_lap_times.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    user_ids = list({t["user_id"] for t in times if t.get("user_id")})
    guests = await guests_by_id(db, [t.get("guest_id") for t in times])
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, private_projection()).to_list(500)}
    memberships = set(await db.memberships.distinct("user_id", {
        "user_id": {"$in": user_ids},
        "member_status": {"$in": ["active", "honorary"]},
    }))
    for t in times:
        t["score_scope"] = t.get("score_scope") or "official"
        t["participant_id"] = participant_id(t)
        if not t.get("user_id") and t.get("guest_id"):
            guest = guests.get(t["guest_id"], {})
            t["user"] = {"username": None, "display_name": guest.get("display_name") or "Gast", "avatar_url": None,
                         "is_club_member": False, "is_guest": True}
        else:
            u = users.get(t.get("user_id"), {})
            t["user"] = {"username": u.get("username"), "display_name": u.get("display_name"),
                          "avatar_url": u.get("avatar_url"), "is_club_member": t.get("user_id") in memberships}
        t["time_str"] = _lap_time_text(t)
        # Alte Einträge können einen Link ohne http(s) tragen - ausgeliefert wird er dann nicht (#1038).
        t["proof_url"] = safe_proof_url(t.get("proof_url"))
    return times


@router.put("/times/{time_id}")
@router.patch("/times/{time_id}")
async def update_time(time_id: str, body: F1LapTimeUpdate, me: dict = Depends(get_current_user)):
    db = get_db()
    existing = await db.f1_lap_times.find_one({"id": time_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Lap-Time nicht gefunden")
    await _require_f1_result_permission(me, existing.get("challenge_id"))
    nullable_fields = {"proof_url", "admin_note"}
    raw = body.model_dump(exclude_unset=True)
    change_reason = raw.pop("change_reason", None)
    confirm_implausible = bool(raw.pop("confirm_implausible", False))
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    challenge = await db.f1_challenges.find_one({"id": existing.get("challenge_id")}, {"_id": 0})
    if not challenge:
        raise HTTPException(404, "Challenge nicht gefunden")
    reason = _published_change_reason(challenge, me, change_reason)
    # Dieselbe Prüfung wie beim Eintragen (#1038) - auf den Stand nach der Korrektur. Nach der Plausibilität fragt sie
    # nur, wenn sich die Zeit ändert (#1584).
    final = {**existing, **updates, "score_scope": updates.get("score_scope", existing.get("score_scope") or "official")}
    new_time = "time_ms" in updates and updates["time_ms"] != existing.get("time_ms")
    resource = lap_attempt_resource(final.get("challenge_id"), final.get("track_id"), participant_id(final), final["score_scope"])
    try:
        async with mutation_lock(db, resource, wait_seconds=LAP_WAIT_SECONDS):
            await check_lap_time(db, challenge, final, current=existing, check_plausibility=new_time,
                                 confirm_implausible=confirm_implausible)
            stamp = now_utc().isoformat()
            updates["updated_at"] = stamp
            updates["updated_by"] = me["id"]
            if "score_scope" in updates:
                updates["moved_by_member_rule"] = False
            if _penalty_changed(existing, final):
                updates["penalty_set_by"], updates["penalty_set_at"] = me["id"], stamp
            await db.f1_lap_times.update_one({"id": time_id}, {"$set": updates})
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=LAP_BUSY)
    t = await db.f1_lap_times.find_one({"id": time_id}, {"_id": 0})
    await _audit_lap(db, "fastlap.time.update", me, t or existing, before=existing, after=t, reason=reason)
    warning = await _resync_published_results(db, existing.get("challenge_id"), me, reason, "fastlap.time.update")
    if t and warning:
        t["resync_warning"] = warning
    if t:
        t["time_str"] = _lap_time_text(t)
        t["proof_url"] = safe_proof_url(t.get("proof_url"))
    return t


@router.delete("/times/{time_id}")
async def delete_time(time_id: str, body: F1LapTimeDelete | None = None, me: dict = Depends(get_current_user)):
    db = get_db()
    existing = await db.f1_lap_times.find_one({"id": time_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Lap-Time nicht gefunden")
    await _require_f1_result_permission(me, existing.get("challenge_id"))
    challenge = await db.f1_challenges.find_one({"id": existing.get("challenge_id")}, {"_id": 0, "status": 1}) or {}
    reason = _published_change_reason(challenge, me, body.change_reason if body else None)
    await db.f1_lap_times.delete_one({"id": time_id})
    await _audit_lap(db, "fastlap.time.delete", me, existing, before=existing, after=None, reason=reason)
    warning = await _resync_published_results(db, existing.get("challenge_id"), me, reason, "fastlap.time.delete")
    return {"ok": True, **({"resync_warning": warning} if warning else {})}


@router.get("/challenges/{cid}/export.csv")
async def export_csv(cid: str, track_id: str | None = None, me: dict = Depends(require_area("tournaments"))):
    db = get_db()
    c = await _get_visible_challenge(cid, me)
    cid = c["id"]
    output = io.StringIO()
    w = csv.writer(output, delimiter=";")
    w.writerow(["Rang", "Spieler", "Discord", "Strecke", "Zeit", "Zeit (ms)", "Versuche", "Strafzeiten", "Aktualisiert"])
    tracks = await db.f1_tracks.find({"challenge_id": cid}, {"_id": 0}).sort("order_index", 1).to_list(100)
    if track_id:
        tracks = [t for t in tracks if t["id"] == track_id]
    for tr in tracks:
        lb = await leaderboard(cid, tr["id"], None, me)
        for entry in lb["entries"]:
            # Jede Zelle als Text (#1584): ein Name, der mit „=“ beginnt, wird in der Tabellenkalkulation keine Formel.
            w.writerow([safe_cell(value) for value in (
                entry["rank"], entry["display_name"], "",
                tr["name"], entry["time_str"], entry["time_ms"],
                entry["attempts"], entry["penalty_seconds"], entry["last_updated"],
            )])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=f1_{c['slug']}.csv"},
    )


# --- Gäste ohne Konto (#1585) ---
@router.get("/challenges/{cid}/guests")
async def list_guests(cid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    cid = await _resolve_cid(cid)
    await _require_f1_result_permission(me, cid)
    rows = await db.f1_guests.find({"challenge_id": cid}, {"_id": 0}).sort("number", 1).to_list(2000)
    return [guest_payload(row) for row in rows]


@router.post("/challenges/{cid}/guests")
async def create_guest(cid: str, body: F1GuestCreate, me: dict = Depends(get_current_user)):
    """Einen Gast anlegen - nur mit Anzeigenamen; ein Konto braucht er nicht. Dürfen Leitung und Fast-Lap-Team."""
    db = get_db()
    cid = await _resolve_cid(cid)
    await _require_f1_result_permission(me, cid)
    name = clean_guest_name(body.display_name)
    try:
        async with mutation_lock(db, f"fastlap:{cid}:guests", wait_seconds=LAP_WAIT_SECONDS):
            await ensure_unique_name(db, cid, name)
            last = await db.f1_guests.find_one({"challenge_id": cid}, {"_id": 0, "number": 1}, sort=[("number", -1)])
            stamp = now_utc().isoformat()
            doc = {"id": new_id(), "challenge_id": cid, "display_name": name, "number": int((last or {}).get("number") or 0) + 1,
                   "created_by": me["id"], "created_at": stamp, "updated_at": stamp, "name_expired_at": None}
            await db.f1_guests.insert_one(doc)
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail="Gerade wird ein Gast angelegt - bitte gleich noch einmal versuchen.")
    doc.pop("_id", None)
    return guest_payload(doc)


@router.patch("/guests/{gid}")
async def rename_guest(gid: str, body: F1GuestCreate, me: dict = Depends(get_current_user)):
    """Umbenennen - auch, wenn ein Gast seinen Namen nicht mehr zeigen will (dann etwa „Gast 3“ eintragen)."""
    db = get_db()
    guest = await db.f1_guests.find_one({"id": gid}, {"_id": 0})
    if not guest:
        raise HTTPException(status_code=404, detail="Gast nicht gefunden")
    await _require_f1_result_permission(me, guest["challenge_id"])
    name = clean_guest_name(body.display_name)
    await ensure_unique_name(db, guest["challenge_id"], name, current_id=gid)
    await db.f1_guests.update_one({"id": gid}, {"$set": {"display_name": name, "updated_at": now_utc().isoformat()}})
    return guest_payload({**guest, "display_name": name})


# --- Am Start / Als Nächstes (#1585) ---
# Je Fast Lap eine Liste: „on_track“ fährt gerade (an einer Station), „next“ wartet in Reihenfolge. Wer fertig ist,
# verlässt die Liste - eine Geschichte braucht niemand, die Zeiten stehen in der Tabelle. Öffentlich lesbar wie die
# Tabelle (TV), ändern darf nur, wer Zeiten eintragen darf. Änderungen laufen unter einer Sperre je Challenge, damit zwei
# Helfer mit „Nächster Fahrer“ nicht zwei Leute gleichzeitig an dieselbe Station schicken.
QUEUE_BUSY = "Die Liste wird gerade geändert - bitte gleich noch einmal versuchen."


def queue_resource(challenge_id: str) -> str:
    return f"fastlap:{challenge_id}:queue"


def _clean_station(value) -> str | None:
    text = " ".join(str(value or "").split())
    return text[:40] or None


async def _queue_entry(db, qid: str, me: dict) -> dict:
    entry = await db.f1_queue.find_one({"id": qid}, {"_id": 0})
    if not entry:
        raise HTTPException(status_code=404, detail="Eintrag nicht gefunden")
    await _require_f1_result_permission(me, entry["challenge_id"])
    return entry


async def _queue_attempts(db, challenge: dict, entry: dict) -> int:
    """Wie viele Versuche die Person auf der Strecke schon hat - in der Wertung, in der sie fährt."""
    query = {"challenge_id": challenge["id"], "track_id": entry.get("track_id")}
    if entry.get("guest_id"):
        return await db.f1_lap_times.count_documents({**query, "guest_id": entry["guest_id"], "user_id": None})
    reference = challenge.get("block_club_member_results") and await _is_active_club_member(entry.get("user_id"))
    scope = {"score_scope": "club_reference"} if reference else \
        {"$or": [{"score_scope": {"$exists": False}}, {"score_scope": "official"}]}
    return await db.f1_lap_times.count_documents({**query, "user_id": entry.get("user_id"), **scope})


async def _queue_payload(db, challenge: dict, rows: list[dict]) -> list[dict]:
    user_ids = [row["user_id"] for row in rows if row.get("user_id")]
    users = {u["id"]: u for u in await db.users.find({"id": {"$in": user_ids}}, private_projection()).to_list(len(user_ids) + 10)} if user_ids else {}
    guests = await guests_by_id(db, [row.get("guest_id") for row in rows])
    out = []
    for row in rows:
        if row.get("guest_id"):
            name, avatar = (guests.get(row["guest_id"]) or {}).get("display_name") or "Gast", None
        else:
            user = users.get(row.get("user_id")) or {}
            name, avatar = user.get("display_name") or user.get("username") or "Gelöschter User", user.get("avatar_url")
        out.append({
            "id": row["id"], "state": row.get("state"), "track_id": row.get("track_id"), "station": row.get("station"),
            "user_id": row.get("user_id"), "guest_id": row.get("guest_id"), "is_guest": bool(row.get("guest_id")),
            "participant_id": participant_id(row), "display_name": name, "avatar_url": avatar,
            "attempts_used": await _queue_attempts(db, challenge, row), "started_at": row.get("started_at"),
        })
    return out


@router.get("/challenges/{cid}/queue")
async def get_queue(cid: str, track_id: str | None = None, access: str | None = None, user=Depends(get_optional_user)):
    db = get_db()
    c = await _get_visible_challenge(cid, user, access=access)
    query = {"challenge_id": c["id"], **({"track_id": track_id} if track_id else {})}
    rows = await db.f1_queue.find(query, {"_id": 0}).sort("order", 1).to_list(500)
    on_track = sorted([row for row in rows if row.get("state") == "on_track"], key=lambda row: row.get("started_at") or "")
    waiting = [row for row in rows if row.get("state") != "on_track"]
    stations = set()
    if c.get("event_id"):
        stations.update(row.get("name") for row in await db.stations.find({"event_id": c["event_id"]}, {"_id": 0, "name": 1}).to_list(200))
    stations.update(row.get("station") for row in rows)
    return {
        "challenge_id": c["id"],
        "max_attempts": _max_attempts(c),
        "on_track": await _queue_payload(db, c, on_track),
        "next": await _queue_payload(db, c, waiting),
        "stations": sorted(name for name in stations if name),
    }


@router.post("/challenges/{cid}/queue")
async def add_to_queue(cid: str, body: F1QueueCreate, me: dict = Depends(get_current_user)):
    db = get_db()
    cid = await _resolve_cid(cid)
    await _require_f1_result_permission(me, cid)
    if bool(body.user_id) == bool(body.guest_id):
        raise HTTPException(status_code=400, detail="Bitte genau einen Fahrer oder einen Gast wählen.")
    if body.guest_id:
        await find_guest(db, cid, body.guest_id)
    elif not await db.users.find_one({"id": body.user_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=400, detail="Spieler nicht gefunden")
    track = await db.f1_tracks.find_one({"challenge_id": cid, **({"id": body.track_id} if body.track_id else {})},
                                        {"_id": 0, "id": 1}, sort=[("order_index", 1)])
    if not track:
        raise HTTPException(status_code=400, detail="Strecke gehört nicht zur Challenge")
    who = {"guest_id": body.guest_id} if body.guest_id else {"user_id": body.user_id}
    try:
        async with mutation_lock(db, queue_resource(cid), wait_seconds=LAP_WAIT_SECONDS):
            if await db.f1_queue.find_one({"challenge_id": cid, "track_id": track["id"], **who}, {"_id": 0, "id": 1}):
                raise HTTPException(status_code=409, detail="Steht schon in der Liste.")
            last = await db.f1_queue.find_one({"challenge_id": cid}, {"_id": 0, "order": 1}, sort=[("order", -1)])
            stamp = now_utc().isoformat()
            doc = {"id": new_id(), "challenge_id": cid, "track_id": track["id"], "user_id": body.user_id or None,
                   "guest_id": body.guest_id or None, "station": _clean_station(body.station), "state": "next",
                   "order": float((last or {}).get("order") or 0) + 1, "created_by": me["id"], "created_at": stamp,
                   "started_at": None}
            await db.f1_queue.insert_one(doc)
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=QUEUE_BUSY)
    doc.pop("_id", None)
    challenge = await db.f1_challenges.find_one({"id": cid}, {"_id": 0})
    return (await _queue_payload(db, challenge, [doc]))[0]


@router.post("/queue/{qid}/up")
async def move_up_in_queue(qid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    entry = await _queue_entry(db, qid, me)
    try:
        async with mutation_lock(db, queue_resource(entry["challenge_id"]), wait_seconds=LAP_WAIT_SECONDS):
            before = await db.f1_queue.find_one({"challenge_id": entry["challenge_id"], "state": "next", "order": {"$lt": entry["order"]}},
                                                {"_id": 0, "id": 1, "order": 1}, sort=[("order", -1)])
            if before:
                await db.f1_queue.update_one({"id": entry["id"]}, {"$set": {"order": before["order"]}})
                await db.f1_queue.update_one({"id": before["id"]}, {"$set": {"order": entry["order"]}})
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=QUEUE_BUSY)
    return {"ok": True}


@router.post("/queue/{qid}/start")
async def start_from_queue(qid: str, body: F1QueueStart | None = None, me: dict = Depends(get_current_user)):
    db = get_db()
    entry = await _queue_entry(db, qid, me)
    station = _clean_station(body.station if body else None) or entry.get("station")
    await db.f1_queue.update_one({"id": qid}, {"$set": {"state": "on_track", "station": station, "started_at": now_utc().isoformat()}})
    return {"ok": True}


@router.delete("/queue/{qid}")
async def remove_from_queue(qid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    await _queue_entry(db, qid, me)
    await db.f1_queue.delete_one({"id": qid})
    return {"ok": True}


@router.post("/challenges/{cid}/queue/next")
async def next_in_queue(cid: str, body: F1QueueNext | None = None, me: dict = Depends(get_current_user)):
    """„Nächster Fahrer“: wer fertig ist, verlässt die Liste; der Erste, der wartet, geht an dieselbe Station."""
    db = get_db()
    cid = await _resolve_cid(cid)
    await _require_f1_result_permission(me, cid)
    body = body or F1QueueNext()
    try:
        async with mutation_lock(db, queue_resource(cid), wait_seconds=LAP_WAIT_SECONDS):
            done = await db.f1_queue.find_one({"id": body.done_id, "challenge_id": cid}, {"_id": 0}) if body.done_id else None
            if done:
                await db.f1_queue.delete_one({"id": done["id"]})
            track_id = body.track_id or (done or {}).get("track_id")
            following = await db.f1_queue.find_one({"challenge_id": cid, "state": "next", **({"track_id": track_id} if track_id else {})},
                                                   {"_id": 0}, sort=[("order", 1)])
            if not following:
                return None
            station = _clean_station(body.station) or (done or {}).get("station") or following.get("station")
            stamp = now_utc().isoformat()
            await db.f1_queue.update_one({"id": following["id"]}, {"$set": {"state": "on_track", "station": station, "started_at": stamp}})
            following.update(state="on_track", station=station, started_at=stamp)
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=QUEUE_BUSY)
    challenge = await db.f1_challenges.find_one({"id": cid}, {"_id": 0})
    return (await _queue_payload(db, challenge, [following]))[0]
