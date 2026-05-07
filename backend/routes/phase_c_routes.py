"""Phase C — Membership applications & profile completeness routes.

Endpoints:
  GET  /api/users/me/profile-completeness        — score + missing fields
  POST /api/membership/apply                     — registered user submits application
  GET  /api/membership/applications              — admin queue
  PATCH /api/membership/applications/{id}        — admin approve/reject
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, Literal

from database import get_db
from auth import get_current_user, require_admin
from models import now_utc, new_id
from badges import compute_profile_completeness, PROFILE_FIELDS, evaluate_user_progress

router = APIRouter(prefix="/api", tags=["phase-c"])


# -------------- Profile Completeness --------------
@router.get("/users/me/profile-completeness")
async def my_profile_completeness(me: dict = Depends(get_current_user)):
    db = get_db()
    user = await db.users.find_one({"id": me["id"]}, {"_id": 0})
    if not user:
        raise HTTPException(404, "Nicht gefunden.")
    score = compute_profile_completeness(user)
    missing = []
    for key, _w in PROFILE_FIELDS:
        v = user.get(key)
        ok = (isinstance(v, list) and len(v) > 0) or (isinstance(v, bool)) or (v not in (None, "", 0))
        if not ok:
            missing.append(key)
    # Trigger any auto-award on profile_completeness tier
    await evaluate_user_progress(me["id"])
    return {"score": score, "missing": missing, "fields_total": len(PROFILE_FIELDS)}


@router.get("/users/{user_id}/profile-completeness")
async def public_profile_completeness(user_id: str):
    db = get_db()
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(404, "Nicht gefunden.")
    return {"score": compute_profile_completeness(user)}


# -------------- Membership Applications --------------
class ApplyBody(BaseModel):
    motivation: str = Field(min_length=20, max_length=2000)
    contribution_pref: Literal["full", "supporter", "youth", "honorary"] = "full"
    accept_statutes: bool
    accept_privacy: bool
    notes: Optional[str] = None


@router.post("/membership/apply")
async def membership_apply(body: ApplyBody, me: dict = Depends(get_current_user)):
    if not body.accept_statutes or not body.accept_privacy:
        raise HTTPException(400, "Statuten und Datenschutz müssen akzeptiert werden.")
    db = get_db()
    # Reject if already an active member
    existing_member = await db.memberships.find_one(
        {"user_id": me["id"], "member_status": {"$in": ["active", "honorary"]}})
    if existing_member:
        raise HTTPException(409, "Du bist bereits aktives Vereinsmitglied.")
    pending = await db.membership_applications.find_one(
        {"user_id": me["id"], "status": "pending"})
    if pending:
        raise HTTPException(409, "Du hast bereits eine offene Bewerbung.")
    doc = {
        "id": new_id(),
        "user_id": me["id"],
        "motivation": body.motivation,
        "contribution_pref": body.contribution_pref,
        "notes": body.notes,
        "status": "pending",
        "created_at": now_utc().isoformat(),
        "decided_at": None,
        "decided_by": None,
        "decision_note": None,
    }
    await db.membership_applications.insert_one(doc)
    # Notify admin via SMTP queue (best-effort)
    try:
        from services.mail_queue import enqueue_mail
        from routes.phase_ef_routes import render_template
        admins = await db.users.find({"role": {"$in": ["club_admin", "superadmin"]}},
                                      {"_id": 0, "email": 1}).to_list(20)
        applicant_name = me.get("display_name") or me.get("username") or "Spieler"
        subj, html = await render_template(
            "membership_application_admin",
            {"applicant": applicant_name},
            fallback_subject="Neue Mitgliedsbewerbung",
            fallback_html=f"<p>{applicant_name} hat eine Mitgliedsbewerbung eingereicht.</p>",
        )
        for a in admins:
            if a.get("email"):
                await enqueue_mail(to=a["email"], subject=subj, html=html)
    except Exception:
        pass
    doc.pop("_id", None)
    return doc


@router.get("/membership/apply/me")
async def my_application(me: dict = Depends(get_current_user)):
    db = get_db()
    app = await db.membership_applications.find_one(
        {"user_id": me["id"]}, {"_id": 0}, sort=[("created_at", -1)])
    return app


@router.get("/membership/applications")
async def admin_list_applications(status: Optional[str] = None,
                                   me: dict = Depends(require_admin())):
    db = get_db()
    q: dict = {}
    if status:
        q["status"] = status
    apps = await db.membership_applications.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    user_ids = [a["user_id"] for a in apps]
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "email": 1, "avatar_url": 1}
    ).to_list(500)}
    for a in apps:
        u = users.get(a["user_id"], {})
        a["user_username"] = u.get("username")
        a["user_display_name"] = u.get("display_name")
        a["user_email"] = u.get("email")
        a["user_avatar_url"] = u.get("avatar_url")
    return apps


class DecisionBody(BaseModel):
    decision: Literal["approve", "reject"]
    note: Optional[str] = None


@router.put("/membership/applications/{app_id}")
@router.patch("/membership/applications/{app_id}")
async def admin_decide_application(app_id: str, body: DecisionBody,
                                    me: dict = Depends(require_admin())):
    db = get_db()
    app = await db.membership_applications.find_one({"id": app_id})
    if not app:
        raise HTTPException(404, "Bewerbung nicht gefunden.")
    if app["status"] != "pending":
        raise HTTPException(400, "Bereits entschieden.")
    new_status = "approved" if body.decision == "approve" else "rejected"
    await db.membership_applications.update_one(
        {"id": app_id},
        {"$set": {
            "status": new_status,
            "decided_at": now_utc().isoformat(),
            "decided_by": me["id"],
            "decision_note": body.note,
        }},
    )
    if body.decision == "approve":
        # Create or activate membership
        m = await db.memberships.find_one({"user_id": app["user_id"]})
        update = {
            "member_status": "active",
            "member_since": now_utc().isoformat() if not (m and m.get("member_since")) else m.get("member_since"),
            "contribution_pref": app["contribution_pref"],
        }
        if m:
            await db.memberships.update_one({"user_id": app["user_id"]}, {"$set": update})
        else:
            await db.memberships.insert_one({
                "id": new_id(),
                "user_id": app["user_id"],
                **update,
                "created_at": now_utc().isoformat(),
            })
        await evaluate_user_progress(app["user_id"])

    # Notify applicant via mail queue
    try:
        from services.mail_queue import enqueue_mail
        from routes.phase_ef_routes import render_template
        u = await db.users.find_one(
            {"id": app["user_id"]},
            {"_id": 0, "email": 1, "display_name": 1, "username": 1, "newsletter_consent": 1, "notification_preferences": 1},
        )
        if u and u.get("email"):
            tpl_key = "membership_approve" if body.decision == "approve" else "membership_reject"
            display = u.get("display_name") or u.get("username") or "Spieler"
            subj, html = await render_template(
                tpl_key,
                {"display_name": display, "note": body.note or ""},
                fallback_subject=("Mitgliedsbewerbung angenommen 🦁" if body.decision == "approve" else "Mitgliedsbewerbung abgelehnt"),
                fallback_html=(f"<p>Hallo {display},</p><p>Deine Bewerbung wurde "
                               f"{'angenommen' if body.decision == 'approve' else 'abgelehnt'}.</p>"
                               f"<p>{body.note or ''}</p>"),
            )
            from services.notification_preferences import email_allowed
            if email_allowed(u, tpl_key, "membership_updates"):
                await enqueue_mail(to=u["email"], subject=subj, html=html)
    except Exception:
        pass

    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": f"membership.{body.decision}",
        "actor_id": me["id"], "target_id": app["user_id"],
        "data": {"application_id": app_id, "note": body.note},
        "created_at": now_utc().isoformat(),
    })
    return await db.membership_applications.find_one({"id": app_id}, {"_id": 0})
