"""Phase C — Membership applications & profile completeness routes.

Endpoints:
  GET  /api/users/me/profile-completeness        — score + missing fields
  POST /api/membership/apply                     — registered user submits application
  GET  /api/membership/applications              — admin queue
  PATCH /api/membership/applications/{id}        — admin approve/reject
"""
import html

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field, field_validator
from typing import Optional, Literal

from database import get_db
from auth import get_current_user, require_club_admin, require_area
from models import now_utc, new_id
from badges import compute_profile_completeness, PROFILE_FIELDS, evaluate_user_progress
from services import dolibarr_applications
from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings as load_dolibarr_settings

router = APIRouter(prefix="/api", tags=["phase-c"])


def _html(value: object) -> str:
    return html.escape(str(value or ""), quote=True)


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
class ApplicationConsent(BaseModel):
    code: str = Field(max_length=32)
    version: int = Field(ge=1)


class ApplyBody(BaseModel):
    # Website-Antrag (ohne Dolibarr): Motivation und Beitragswunsch.
    motivation: Optional[str] = Field(default=None, max_length=2000)
    contribution_pref: Literal["full", "supporter", "youth", "honorary"] = "full"
    accept_statutes: bool
    accept_privacy: bool
    notes: Optional[str] = Field(default=None, max_length=2000)
    # Antrag nach Dolibarr (#328): Person, Mitgliedsart, eigene Felder, Einwilligungen mit gezeigter Version.
    type_id: Optional[int] = Field(default=None, ge=1)
    firstname: Optional[str] = Field(default=None, max_length=80)
    lastname: Optional[str] = Field(default=None, max_length=80)
    phone: Optional[str] = Field(default=None, max_length=40)
    birth: Optional[str] = Field(default=None, max_length=10)
    address: Optional[str] = Field(default=None, max_length=160)
    zip: Optional[str] = Field(default=None, max_length=16)
    town: Optional[str] = Field(default=None, max_length=80)
    country_code: Optional[str] = Field(default="AT", max_length=2)
    fields: dict[str, str] = Field(default_factory=dict)
    consents: list[ApplicationConsent] = Field(default_factory=list)

    @field_validator("motivation")
    @classmethod
    def clean_motivation(cls, value: Optional[str]):
        cleaned = str(value or "").strip()
        return cleaned or None

    @field_validator("notes")
    @classmethod
    def clean_notes(cls, value: Optional[str]):
        cleaned = str(value or "").strip()
        return cleaned or None

    @field_validator("birth")
    @classmethod
    def clean_birth(cls, value: Optional[str]):
        cleaned = str(value or "").strip()[:10]
        if cleaned:
            from datetime import date as _date
            try:
                _date.fromisoformat(cleaned)
            except ValueError:
                raise ValueError("Geburtsdatum als JJJJ-MM-TT angeben")
        return cleaned or None


CONTRIBUTION_OPTIONS = [
    {"value": "full", "label": "Vollmitgliedschaft"}, {"value": "supporter", "label": "Unterstützer-Mitgliedschaft"},
    {"value": "youth", "label": "Jugend-Mitgliedschaft"}, {"value": "honorary", "label": "Ehrenmitgliedschaft (auf Einladung)"},
]


async def _account(db, me: dict) -> dict:
    """E-Mail und Name so, wie sie jetzt am Konto stehen - nicht aus der Sitzung."""
    fresh = await db.users.find_one({"id": me["id"]}, {"_id": 0, "id": 1, "username": 1, "display_name": 1, "email": 1, "email_verified": 1})
    return fresh or me


async def _application_client(db):
    """Die Anbindung für Anträge - oder None, solange Anträge auf der Website bleiben."""
    settings = await load_dolibarr_settings(db)
    if not dolibarr_applications.coupled(settings):
        return settings, None
    try:
        return settings, DolibarrClient(settings)
    except DolibarrError as exc:
        raise HTTPException(503, f"Mitgliederverwaltung nicht erreichbar: {exc.text}")


@router.get("/membership/apply/form")
async def membership_apply_form(me: dict = Depends(get_current_user)):
    """Was „Mitglied werden“ fragt: mit Dolibarr die Pflichtfelder, Mitgliedsarten und Einwilligungstexte
    von dort - sonst die Beitragswünsche der Website."""
    db = get_db()
    settings, client = await _application_client(db)
    me = await _account(db, me)
    account = {"email": me.get("email"), "display_name": me.get("display_name") or me.get("username")}
    if client is None:
        return {"coupled": False, "contribution_options": CONTRIBUTION_OPTIONS, "account": account}
    try:
        bundle = await dolibarr_applications.form_bundle(client)
    except DolibarrError as exc:
        return {"coupled": True, "available": False, "error": exc.kind, "text": exc.text, "account": account}
    return {"coupled": True, "available": True, **bundle, "account": account}


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
        {"user_id": me["id"], "status": {"$in": ["pending", "submitting"]}})
    if pending:
        raise HTTPException(409, "Du hast bereits eine offene Bewerbung.")
    settings, client = await _application_client(db)
    if client is not None:
        return await _apply_via_dolibarr(db, client, body, me)
    if not body.motivation or len(body.motivation) < 20:
        raise HTTPException(422, "Bitte beschreibe deine Motivation mit mindestens 20 Zeichen.")
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
    # Vorstands-Kanal (#300): nur der Hinweis, keine Namen - Discord ist ein fremder Dienst.
    from services.discord_announcements import notify_board
    await notify_board("membership.application", "📝 Neuer Mitgliedsantrag",
                       "Ein neuer Antrag wartet auf die Entscheidung des Vorstands.", url="/admin/membership-applications")
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
            fallback_html=f"<p>{_html(applicant_name)} hat eine Mitgliedsbewerbung eingereicht.</p>",
        )
        for a in admins:
            if a.get("email"):
                await enqueue_mail(to=a["email"], subject=subj, html=html)
    except Exception:
        pass
    doc.pop("_id", None)
    return doc


async def _apply_via_dolibarr(db, client, body: ApplyBody, me: dict) -> dict:
    """Antrag nach Dolibarr (#328): erst lokal festhalten (feste external_id), dann senden."""
    try:
        bundle = await dolibarr_applications.form_bundle(client)
    except DolibarrError as exc:
        raise HTTPException(503, f"Mitgliederverwaltung nicht erreichbar: {exc.text}")
    me = await _account(db, me)
    email = str(me.get("email") or "").strip()
    if not email or not me.get("email_verified", True):
        raise HTTPException(400, "Für den Antrag braucht dein Konto eine bestätigte E-Mail-Adresse.")
    person = {
        "firstname": str(body.firstname or "").strip(), "lastname": str(body.lastname or "").strip(), "email": email,
        "phone": str(body.phone or "").strip(), "birth": body.birth or "", "address": str(body.address or "").strip(),
        "zip": str(body.zip or "").strip(), "town": str(body.town or "").strip(), "country_code": (body.country_code or "AT").upper()[:2],
    }
    consents = [{"code": c.code, "version": c.version, "granted_at": now_utc().isoformat()} for c in body.consents]
    problems = dolibarr_applications.validate_submission(bundle, person, body.type_id, consents, body.fields)
    if problems:
        raise HTTPException(422, " ".join(problems))
    app_id = new_id()
    doc = {
        "id": app_id, "user_id": me["id"], "external_id": dolibarr_applications.external_id_for(app_id), "source": "dolibarr",
        "motivation": body.motivation, "contribution_pref": None, "notes": body.notes, "type_id": body.type_id,
        "type_label": next((fee["label"] for fee in bundle["fees"] if fee["id"] == body.type_id), None),
        "person": person, "fields": {code: str(value).strip() for code, value in body.fields.items() if str(value).strip()}, "consents": consents,
        "status": "submitting", "created_at": now_utc().isoformat(), "decided_at": None, "decided_by": None, "decision_note": None, "dolibarr": {"attempts": 0},
    }
    await db.membership_applications.insert_one(doc)
    doc.pop("_id", None)
    saved = await dolibarr_applications.submit(db, client, doc)
    if saved.get("status") == "failed":
        raise HTTPException(502, f"Die Mitgliederverwaltung hat den Antrag nicht angenommen ({saved.get('dolibarr', {}).get('error_text') or 'Fehler'}). Bitte Angaben prüfen und neu stellen.")
    from services.discord_announcements import notify_board
    await notify_board("membership.application", "📝 Neuer Mitgliedsantrag",
                       "Ein neuer Antrag ist in der Mitgliederverwaltung eingegangen.", url="/admin/membership-applications")
    return dolibarr_applications.own_view(saved)


@router.post("/membership/apply/withdraw")
async def withdraw_application(me: dict = Depends(get_current_user)):
    """Zurückziehen, solange der Verein nicht entschieden hat (#328)."""
    db = get_db()
    app = await db.membership_applications.find_one({"user_id": me["id"], "status": {"$in": ["pending", "submitting", "failed"]}}, {"_id": 0}, sort=[("created_at", -1)])
    if not app:
        raise HTTPException(404, "Kein offener Antrag.")
    if not app.get("external_id"):
        raise HTTPException(409, "Dieser Antrag liegt beim Vorstand der Website - dort zurückziehen lassen.")
    if app.get("status") in ("submitting", "failed"):
        now = now_utc().isoformat()
        await db.membership_applications.update_one({"id": app["id"]}, {"$set": {"status": "withdrawn", "withdrawn_at": now, "decided_at": now, "decided_by": me["id"]}})
        return dolibarr_applications.own_view(await db.membership_applications.find_one({"id": app["id"]}, {"_id": 0}))
    settings, client = await _application_client(db)
    if client is None:
        raise HTTPException(409, "Die Anbindung ist aus - bitte den Vorstand bitten, den Antrag in Dolibarr zurückzuziehen.")
    try:
        return dolibarr_applications.own_view(await dolibarr_applications.withdraw(db, client, app))
    except DolibarrError as exc:
        if exc.kind == "conflict":
            fresh = await dolibarr_applications.refresh(db, settings, client, app, force=True)
            raise HTTPException(409, "Der Verein hat schon entschieden." if fresh.get("status") != "pending" else "Der Antrag lässt sich gerade nicht zurückziehen.")
        raise HTTPException(503, f"Mitgliederverwaltung nicht erreichbar: {exc.text}")


@router.get("/membership/apply/me")
async def my_application(me: dict = Depends(get_current_user)):
    db = get_db()
    app = await db.membership_applications.find_one(
        {"user_id": me["id"]}, {"_id": 0}, sort=[("created_at", -1)])
    if app and app.get("external_id") and app.get("status") in ("pending", "submitting"):
        # Der eigene Stand: hängende Sendung gleich versuchen, offenen Antrag nachlesen (gedrosselt).
        settings, client = await _application_client(db)
        if client is not None:
            if app["status"] == "submitting":
                app = await dolibarr_applications.submit(db, client, app)
            if app.get("status") == "pending":
                app = await dolibarr_applications.refresh(db, settings, client, app)
        return dolibarr_applications.own_view(app)
    if app and app.get("external_id"):
        return dolibarr_applications.own_view(app)
    return app


@router.get("/membership/applications")
async def admin_list_applications(status: Optional[str] = None,
                                   me: dict = Depends(require_area("club"))):
    db = get_db()
    q: dict = {}
    if status:
        q["status"] = status
    apps = await db.membership_applications.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Anträge aus Dolibarr (#328): Stand und Mitgliedskarte, aber keine zweite Entscheidung auf der Website.
    settings = await load_dolibarr_settings(db)
    apps = [dolibarr_applications.admin_view(a, settings) for a in apps]
    for a in apps:
        a.pop("person", None)
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
                                    me: dict = Depends(require_area("club"))):
    db = get_db()
    app = await db.membership_applications.find_one({"id": app_id})
    if not app:
        raise HTTPException(404, "Bewerbung nicht gefunden.")
    if app.get("external_id"):
        raise HTTPException(409, "Dieser Antrag liegt in der Mitgliederverwaltung (Dolibarr) - dort aufnehmen oder ablehnen; die Website übernimmt den Stand.")
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
                fallback_html=(f"<p>Hallo {_html(display)},</p><p>Deine Bewerbung wurde "
                               f"{'angenommen' if body.decision == 'approve' else 'abgelehnt'}.</p>"
                               f"<p>{_html(body.note or '')}</p>"),
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
