"""Externe Serien - Rechte (#1749): Captain je Serie mit Ablauf; der Vorstand (Bereich Redaktion) darf alles.

- Captain kann nur ein aktives Vereinsmitglied werden; endet die Mitgliedschaft, ruht das Recht (geprüft bei jedem
  Zugriff in ``services/reference_series_access.py``).
- Captains verwaltet nur der Vorstand, in der Saison: hinzufügen (Personensuche, Zweck ``reference_series``), Ablauf
  (``valid_until``, Pflicht) und Veröffentlichen-Recht ändern, entfernen. Jede Änderung steht im Adminprotokoll
  (``audit_logs``, ``reference_series.staff_*``).
- „Meine Serien“ stehen in „Mein Dienst“ (``/api/users/me/duty``, Schlüssel ``series``).
- Die Prüfung für Routen anderer Pakete steht in ``services/reference_series_access.py`` (``require_series_editor``).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from auth import require_area
from database import get_db
from models import ReferenceSeriesStaffCreate, ReferenceSeriesStaffUpdate, new_id, now_utc
from services import reference_running_cache
from services.dolibarr_policy import club_today
from services.reference_series_access import active_member_ids, captain_may_publish, staff_is_valid

# Jeder schreibende Aufruf leert den Cache der laufenden Saisons (#1753, Startseite).
router = APIRouter(prefix="/api/reference-series", tags=["reference-series"],
                   dependencies=[Depends(reference_running_cache.reset_after_write)])

PAST_DAY = "Der Ablauf liegt in der Vergangenheit - so hätte der Captain kein Recht."
NOT_A_MEMBER = ("Captain kann nur ein aktives Vereinsmitglied werden. Diese Person ist gerade kein aktives Mitglied - "
                "zuerst die Mitgliedschaft klären (Admin → Mitglieder).")
USER_FIELDS = {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "mfa_enabled": 1,
               "is_active": 1, "is_banned": 1}


async def _series(db, series_id: str) -> dict:
    found = await db.reference_series.find_one({"id": series_id}, {"_id": 0})
    if not found:
        raise HTTPException(404, "Serie nicht gefunden.")
    return found


async def _staff(db, series_id: str, staff_id: str) -> dict:
    found = await db.reference_series_staff.find_one({"id": staff_id, "series_id": series_id}, {"_id": 0})
    if not found:
        raise HTTPException(404, "Captain nicht gefunden.")
    return found


def _not_past(day: str) -> None:
    if day < club_today():
        raise HTTPException(422, PAST_DAY)


async def _audit(db, me: dict, action: str, series_id: str, data: dict) -> None:
    await db.audit_logs.insert_one({
        "id": new_id(), "action": f"reference_series.{action}", "actor_id": me["id"], "target_id": series_id,
        "data": data, "created_at": now_utc().isoformat(),
    })


def _row(staff: dict, series: dict, user: dict | None, today: str, is_member: bool) -> dict:
    """Ein Captain für die Verwaltung: Name und Bild, Ablauf, gilt heute, Zwei-Faktor eingerichtet, aktives Mitglied -
    keine E-Mail."""
    user = user or {}
    return {
        "id": staff["id"], "series_id": staff["series_id"], "user_id": staff["user_id"], "role": staff.get("role"),
        "can_publish": staff.get("can_publish") is True, "valid_until": staff.get("valid_until"),
        "is_valid": staff_is_valid(staff, today), "publishes_directly": captain_may_publish(series, staff),
        "name": user.get("display_name") or user.get("username") or "Unbekanntes Konto",
        "avatar_url": user.get("avatar_url"), "mfa_enabled": bool(user.get("mfa_enabled")),
        "account_active": bool(user) and user.get("is_active") is not False and not user.get("is_banned"),
        "is_member": is_member,
        "created_at": staff.get("created_at"), "updated_at": staff.get("updated_at"),
    }


async def _rows(db, series: dict) -> list[dict]:
    staff = await db.reference_series_staff.find({"series_id": series["id"]}, {"_id": 0}).to_list(None)
    users = {row["id"]: row async for row in db.users.find(
        {"id": {"$in": sorted({row["user_id"] for row in staff})}}, USER_FIELDS)}
    today = club_today()
    members = await active_member_ids(db, users)
    rows = [_row(row, series, users.get(row["user_id"]), today, row["user_id"] in members) for row in staff]
    rows.sort(key=lambda row: (not row["is_valid"], row["name"].casefold()))
    return rows


@router.get("/admin/series/{series_id}/staff")
async def list_staff(series_id: str, me: dict = Depends(require_area("content"))):
    db = get_db()
    series = await _series(db, series_id)
    return {"staff": await _rows(db, series), "publish_mode": series.get("publish_mode") or "review"}


@router.post("/admin/series/{series_id}/staff")
async def add_staff(series_id: str, body: ReferenceSeriesStaffCreate, me: dict = Depends(require_area("content"))):
    db = get_db()
    series = await _series(db, series_id)
    _not_past(body.valid_until)
    user = await db.users.find_one({"id": body.user_id}, USER_FIELDS)
    if not user or user.get("is_active") is False or user.get("is_banned"):
        raise HTTPException(404, "Konto nicht gefunden.")
    if body.user_id not in await active_member_ids(db, [body.user_id]):
        raise HTTPException(422, NOT_A_MEMBER)
    if await db.reference_series_staff.find_one(
            {"series_id": series_id, "user_id": body.user_id, "role": body.role}, {"_id": 1}):
        raise HTTPException(409, "Diese Person ist in dieser Saison schon Captain.")
    now = now_utc().isoformat()
    doc = {"id": new_id(), "series_id": series_id, "user_id": body.user_id, "role": body.role,
           "can_publish": body.can_publish, "valid_until": body.valid_until,
           "created_at": now, "created_by": me["id"], "updated_at": now, "updated_by": me["id"]}
    await db.reference_series_staff.insert_one(dict(doc))
    await _audit(db, me, "staff_add", series_id, {"staff_id": doc["id"], "user_id": body.user_id, "role": body.role,
                                                  "can_publish": body.can_publish, "valid_until": body.valid_until})
    return _row(doc, series, user, club_today(), True)


@router.patch("/admin/series/{series_id}/staff/{staff_id}")
async def update_staff(series_id: str, staff_id: str, body: ReferenceSeriesStaffUpdate,
                       me: dict = Depends(require_area("content"))):
    db = get_db()
    series = await _series(db, series_id)
    existing = await _staff(db, series_id, staff_id)
    updates = body.model_dump(exclude_unset=True)
    if updates.get("can_publish") is None:
        updates.pop("can_publish", None)
    if "valid_until" in updates and updates["valid_until"] != existing.get("valid_until"):
        _not_past(updates["valid_until"])
    changes = {key: value for key, value in updates.items() if existing.get(key) != value}
    if changes:
        await db.reference_series_staff.update_one({"id": staff_id, "series_id": series_id}, {"$set": {
            **changes, "updated_at": now_utc().isoformat(), "updated_by": me["id"]}})
        await _audit(db, me, "staff_update", series_id, {
            "staff_id": staff_id, "user_id": existing["user_id"],
            "before": {key: existing.get(key) for key in changes}, "after": changes})
    saved = await _staff(db, series_id, staff_id)
    user = await db.users.find_one({"id": saved["user_id"]}, USER_FIELDS)
    is_member = saved["user_id"] in await active_member_ids(db, [saved["user_id"]])
    return _row(saved, series, user, club_today(), is_member)


@router.delete("/admin/series/{series_id}/staff/{staff_id}")
async def remove_staff(series_id: str, staff_id: str, me: dict = Depends(require_area("content"))):
    db = get_db()
    await _series(db, series_id)
    existing = await _staff(db, series_id, staff_id)
    await db.reference_series_staff.delete_one({"id": staff_id, "series_id": series_id})
    await _audit(db, me, "staff_remove", series_id, {
        "staff_id": staff_id, "user_id": existing["user_id"], "role": existing.get("role"),
        "can_publish": existing.get("can_publish"), "valid_until": existing.get("valid_until")})
    return {"ok": True}

