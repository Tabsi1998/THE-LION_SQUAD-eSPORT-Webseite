"""Membership routes — admin can mark users as official club members."""
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from datetime import date
from database import get_db
from auth import get_current_user, require_club_admin, get_optional_user, require_area
from services.membership_service import (
    upsert_membership, get_membership, get_user_with_membership,
    is_active_member, derived_user_type, VALID_STATUSES, VALID_TYPES,
    ACTIVE_STATUSES, end_self_directory_entry,
)
from services.visibility import user_can_see
from services.slug_utils import apply_slug_history, find_by_slug_or_history, slugify
from models import (
    MembershipUpdate, MemberBenefitCreate, MemberBenefitUpdate, now_utc, new_id,
)
from services.notification_preferences import send_user_template
from typing import Literal
from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings as load_dolibarr_settings
from services.dolibarr_links import link_for_user, public_link, verified_link
from services.dolibarr_policy import MAX_STATE_AGE_HOURS
from services.dolibarr_sync import try_auto_link
from services import dolibarr_identity, dolibarr_self_service
from services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api/membership", tags=["membership"])


class ClubMemberProfileCreate(BaseModel):
    display_name: str
    gamertag: str | None = None
    real_name: str | None = None
    slug: str | None = None
    role_title: str | None = None
    photo_url: str | None = None
    cover_url: str | None = None
    bio: str | None = None
    birth_date: date | None = None
    gender: str | None = None
    games: list[str] = []
    platforms: list[str] = []
    user_id: str | None = None
    order_index: int = 0
    is_active: bool = True


class ClubMemberProfileUpdate(BaseModel):
    display_name: str | None = None
    gamertag: str | None = None
    real_name: str | None = None
    slug: str | None = None
    role_title: str | None = None
    photo_url: str | None = None
    cover_url: str | None = None
    bio: str | None = None
    birth_date: date | None = None
    gender: str | None = None
    games: list[str] | None = None
    platforms: list[str] | None = None
    user_id: str | None = None
    order_index: int | None = None
    is_active: bool | None = None
    # Verzeichnis per Opt-in (#410): die Verwaltung kann einen Eintrag sperren - das Mitglied kann ihn
    # dann nicht wieder einschalten, bis die Sperre weg ist.
    directory_blocked: bool | None = None


class DirectoryEntryUpdate(BaseModel):
    """Was ein Mitglied an seinem eigenen Verzeichnis-Eintrag pflegt (#410)."""
    listed: bool | None = None
    gamertag: str | None = None
    bio: str | None = None
    games: list[str] | None = None
    platforms: list[str] | None = None


# ---------- Helpers ----------
async def _audit(actor_id: str, action: str, target_id: str, data: dict | None = None):
    db = get_db()
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": action,
        "actor_id": actor_id,
        "target_id": target_id,
        "data": data or {},
        "created_at": now_utc().isoformat(),
    })


def _slugify(value: str) -> str:
    return slugify(value, fallback="mitglied", max_length=80)


def _clean_list(values: list[str] | None) -> list[str]:
    out: list[str] = []
    for value in values or []:
        item = str(value or "").strip()
        if item and item not in out:
            out.append(item[:80])
    return out[:20]


def _clean_gender(value: str | None) -> str | None:
    value = str(value or "").strip().lower()
    return value if value in {"male", "female", "diverse"} else None


def _clean_name(value: str | None, limit: int = 120) -> str | None:
    value = str(value or "").strip()
    return value[:limit] if value else None


def _age_from_birth_date(value: str | date | None) -> int | None:
    if not value:
        return None
    try:
        born = value if isinstance(value, date) else date.fromisoformat(str(value)[:10])
    except ValueError:
        return None
    today = date.today()
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def _achievement_level(points: int) -> dict:
    points = max(int(points or 0), 0)
    level = 1
    while points >= (level * level * 100):
        level += 1
    current_floor = (level - 1) * (level - 1) * 100
    next_floor = level * level * 100
    span = max(next_floor - current_floor, 1)
    progress = round(((points - current_floor) / span) * 100)
    title = _achievement_level_title(level)
    return {
        "level": level,
        "points": points,
        "current_level_points": current_floor,
        "next_level_points": next_floor,
        "progress": max(0, min(progress, 100)),
        "title": title,
    }


def _achievement_level_title(level: int) -> str:
    if level >= 20:
        return "Legendär"
    if level >= 16:
        return "Champion"
    if level >= 12:
        return "Elite"
    if level >= 8:
        return "Veteran"
    if level >= 5:
        return "Pro"
    if level >= 3:
        return "Challenger"
    return "Rookie"


def _title_for_position(position: dict, person: dict | None = None) -> str:
    if person and person.get("gender") == "female" and position.get("title_female"):
        return position["title_female"]
    return position.get("title_male") or position.get("display_title") or "Vorstand"


async def _board_titles_by_profile_id(db) -> dict[str, str]:
    profiles = await db.club_member_profiles.find(
        {},
        {"_id": 0, "id": 1, "user_id": 1, "gender": 1},
    ).to_list(2000)
    by_profile_id = {p["id"]: p for p in profiles}
    by_user_id = {p["user_id"]: p for p in profiles if p.get("user_id")}
    titles: dict[str, str] = {}
    positions = await db.board_positions.find(
        {"is_active": True}, {"_id": 0}
    ).sort("order_index", 1).to_list(200)
    for position in positions:
        main = by_profile_id.get(position.get("user_id")) or by_user_id.get(position.get("user_id"))
        if main:
            titles[main["id"]] = _title_for_position(position, main)
        deputy = by_profile_id.get(position.get("deputy_user_id")) or by_user_id.get(position.get("deputy_user_id"))
        if deputy:
            titles[deputy["id"]] = f"{_title_for_position(position, deputy)}-Stv."
    return titles


def _public_profile(doc: dict, detail: bool = False, board_title: str | None = None) -> dict:
    role_title = board_title or doc.get("role_title") or "Mitglied"
    out = {
        "id": doc["id"],
        "slug": doc["slug"],
        "display_name": doc.get("display_name"),
        "gamertag": doc.get("gamertag"),
        "real_name": doc.get("real_name"),
        "role_title": role_title,
        "editorial_role_title": doc.get("role_title"),
        "board_title": board_title,
        "photo_url": doc.get("photo_url"),
        "cover_url": doc.get("cover_url"),
        "games": doc.get("games") or [],
        "platforms": doc.get("platforms") or [],
        # Das Alter war als „Level“ öffentlich (#410) - es bleibt jetzt in der Verwaltung.
        "gender": doc.get("gender"),
        "order_index": doc.get("order_index") or 0,
        "source": doc.get("source") or "editorial",
    }
    if detail:
        out["bio"] = doc.get("bio") or ""
    return out


def _admin_profile(doc: dict) -> dict:
    out = _public_profile(doc, detail=True)
    out.update({
        "birth_date": doc.get("birth_date"),
        "age": _age_from_birth_date(doc.get("birth_date")),
        "user_id": doc.get("user_id"),
        "is_active": doc.get("is_active", True),
        "directory_blocked": bool(doc.get("directory_blocked")),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
        # Mitgliederverzeichnis aus der Einwilligung (#410 Nachtrag): warum ein Eintrag da oder offline ist.
        "consent": doc.get("consent"),
        "deactivated_reason": doc.get("deactivated_reason"),
        # Profil aus Dolibarr (#496): wann der Abgleich zuletzt Gamertag, Kurztext, Spiele oder Foto von dort genommen hat.
        "dolibarr_profile_at": doc.get("dolibarr_profile_at"),
        # Mitgliedsnummer aus Dolibarr (#504): darüber findet der Abgleich das Profil wieder - nie ein zweites.
        "dolibarr_member_id": doc.get("dolibarr_member_id"),
    })
    return out


def _public_account(user: dict | None, admin: bool = False) -> dict | None:
    if not user:
        return None
    twitch_visible = (user.get("profile_visibility") or {}).get("twitch", "public") == "public"
    twitch_handle = user.get("twitch_handle") if twitch_visible else None
    out = {
        "id": user.get("id"),
        "username": user.get("username"),
        "display_name": user.get("display_name"),
        "avatar_url": user.get("avatar_url"),
        "profile_url": f"/u/{user.get('username')}" if user.get("username") else None,
        "achievement_level": user.get("achievement_level"),
        "twitch_handle": twitch_handle,
        "show_twitch_embed": bool(user.get("show_twitch_embed") and twitch_handle),
    }
    if admin:
        out["email"] = user.get("email")
        out["is_club_member"] = user.get("is_club_member")
    return out


async def _account_map_for_profiles(db, rows: list[dict], public_only: bool = True) -> dict[str, dict]:
    user_ids = [row.get("user_id") for row in rows if row.get("user_id")]
    if not user_ids:
        return {}
    query: dict = {
        "id": {"$in": list(set(user_ids))},
        "is_active": True,
        "is_banned": {"$ne": True},
    }
    if public_only:
        query["privacy_public_profile"] = True
    projection = {
        "_id": 0,
        "id": 1,
        "username": 1,
        "display_name": 1,
        "avatar_url": 1,
        "email": 1,
        "is_club_member": 1,
        "profile_visibility": 1,
        "show_twitch_embed": 1,
        "twitch_handle": 1,
    }
    users = await db.users.find(query, projection).to_list(2000)
    neg_codes = [g["code"] async for g in db.achievement_groups.find(
        {"is_negative": True}, {"_id": 0, "code": 1}
    )]
    awards = await db.user_achievements.find(
        {"user_id": {"$in": list(set(user_ids))}, "group_code": {"$nin": neg_codes}},
        {"_id": 0, "user_id": 1, "tier_code": 1},
    ).to_list(10000)
    tier_codes = list({award.get("tier_code") for award in awards if award.get("tier_code")})
    tiers = {tier["code"]: tier for tier in await db.achievements.find(
        {"code": {"$in": tier_codes}}, {"_id": 0, "code": 1, "points": 1}
    ).to_list(2000)} if tier_codes else {}
    points_by_user: dict[str, int] = {}
    for award in awards:
        points_by_user[award["user_id"]] = points_by_user.get(award["user_id"], 0) + int(tiers.get(award.get("tier_code"), {}).get("points") or 0)
    for user in users:
        user["achievement_level"] = _achievement_level(points_by_user.get(user["id"], 0))
    return {user["id"]: user for user in users}


async def _attach_linked_accounts(db, rows: list[dict], items: list[dict], public_only: bool = True, admin: bool = False) -> list[dict]:
    accounts = await _account_map_for_profiles(db, rows, public_only=public_only)
    for row, item in zip(rows, items):
        account = _public_account(accounts.get(row.get("user_id")), admin=admin)
        item["linked_account"] = account
        item["gamertag"] = item.get("gamertag") or (account or {}).get("username") or item.get("display_name")
        item["real_name"] = item.get("real_name") or (
            item.get("display_name") if item.get("display_name") != item.get("gamertag") else None
        )
    return items


async def _attach_reference_stats(db, item: dict, profile_id: str) -> dict:
    refs_raw = await db.references.find(
        {"member_profile_ids": profile_id, "is_active": {"$ne": False}},
        {"_id": 0},
    ).to_list(200)
    refs_raw = [ref for ref in refs_raw if await user_can_see(None, ref.get("visibility") or "public")]
    if refs_raw:
        from routes.news_routes import _enrich_references, _sort_references
        references = _sort_references(await _enrich_references(refs_raw))[:30]
    else:
        references = []
    # Je Teilnahme zählt der Eintrag, in dem diese Person steht (#409): ein Einzelstarter hat
    # seine eigene Platzierung, ein Teammitglied die seines Teams.
    placements = []
    solo = team = 0
    for ref in references:
        entries = ref.get("entries") or []
        mine = [row for row in entries if profile_id in (row.get("member_profile_ids") or [])] or entries[:1]
        # Für die Karte zählt der beste eigene Eintrag; in die Bilanz gehen alle eigenen Einträge.
        ref["member_entry"] = min(mine, key=lambda row: int(row.get("placement") or 10**6)) if mine else None
        for entry in mine:
            if entry.get("kind") == "solo":
                solo += 1
            else:
                team += 1
            try:
                if entry.get("placement"):
                    placements.append(int(entry["placement"]))
            except (TypeError, ValueError):
                continue
    item["references"] = references
    item["reference_stats"] = {
        "total": len(references),
        "gold": sum(1 for place in placements if place == 1),
        "silver": sum(1 for place in placements if place == 2),
        "bronze": sum(1 for place in placements if place == 3),
        "podiums": sum(1 for place in placements if place <= 3),
        "solo": solo,
        "team": team,
    }
    return item


async def _normalize_linked_user_id(db, user_id: str | None, current_profile_id: str | None = None) -> str | None:
    user_id = str(user_id or "").strip()
    if not user_id:
        return None
    user = await db.users.find_one({"id": user_id}, {"_id": 1})
    if not user:
        raise HTTPException(400, "Verknüpftes Plattform-Konto wurde nicht gefunden.")
    duplicate_query: dict = {"user_id": user_id}
    if current_profile_id:
        duplicate_query["id"] = {"$ne": current_profile_id}
    duplicate = await db.club_member_profiles.find_one(duplicate_query, {"_id": 0, "display_name": 1})
    if duplicate:
        raise HTTPException(409, f"Dieses Plattform-Konto ist bereits mit {duplicate.get('display_name') or 'einem Mitgliederprofil'} verknüpft.")
    return user_id


async def _led_by_dolibarr(user_id: str) -> bool:
    """Führt Dolibarr die Mitgliedschaft dieser Person (#295)? Dann pflegt die Website sie nicht mehr selbst."""
    settings = await load_dolibarr_settings()
    if settings["mode"] != "live":
        return False
    return await verified_link(get_db(), settings, user_id) is not None


def _dolibarr_view(membership: dict | None, link: dict | None, settings: dict) -> dict | None:
    """Was die Person selbst über ihren Stand aus der Mitgliederverwaltung sieht."""
    if settings["mode"] == "off":
        return None
    state = (membership or {}).get("dolibarr") or {}
    led = settings["mode"] == "live" and (membership or {}).get("source") == "dolibarr" and (link or {}).get("status") == "verified"
    view = {"connected": True, "led_by_dolibarr": led, "link": public_link(link)}
    if not led:
        return view
    synced = state.get("synced_at")
    stale = True
    if synced:
        try:
            from datetime import datetime, timezone
            parsed = datetime.fromisoformat(synced.replace("Z", "+00:00"))
            parsed = parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
            stale = (now_utc() - parsed).total_seconds() > MAX_STATE_AGE_HOURS * 3600
        except ValueError:
            stale = True
    view.update({
        "as_of": synced,
        "stale": stale,
        "member_ref": state.get("ref"),
        "type_label": (state.get("type") or {}).get("label"),
        "paid_until": state.get("paid_until"),
        "membership_ends": state.get("membership_ends"),
        "fee": state.get("fee"),
        "functions": [{"label": fn.get("label"), "since": fn.get("since")} for fn in state.get("functions") or []],
    })
    return view


async def _activate_linked_membership(profile: dict, actor_id: str):
    user_id = profile.get("user_id")
    if not user_id or profile.get("is_active") is False:
        return
    # Profilpflege ist Redaktion. Führt Dolibarr die Mitgliedschaft, darf sie
    # weder einen Austritt rückgängig machen noch die Mitgliedsart setzen (#295).
    if await _led_by_dolibarr(user_id):
        return
    existing = await get_membership(user_id)
    payload = {}
    if not existing or existing.get("member_status") not in ACTIVE_STATUSES:
        payload["member_status"] = "active"
    if not existing or not existing.get("membership_type"):
        payload["membership_type"] = "ordinary"
    if not payload:
        return
    try:
        await upsert_membership(
            user_id=user_id,
            actor_id=actor_id,
            **payload,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))


async def _unique_profile_slug(db, slug: str, current_id: str | None = None) -> str:
    base = _slugify(slug)
    candidate = base
    counter = 2
    while True:
        query = {"slug": candidate}
        if current_id:
            query["id"] = {"$ne": current_id}
        if not await db.club_member_profiles.find_one(query, {"_id": 1}):
            return candidate
        candidate = f"{base}-{counter}"
        counter += 1


# ---------- Public meta ----------
@router.get("/meta")
async def membership_meta():
    """Public: list of valid status / membership types for forms."""
    return {
        "statuses": sorted(VALID_STATUSES),
        "types": sorted(VALID_TYPES),
    }


# ---------- Meine Einwilligungen (#329, Teil 1) ----------
# Die Einwilligungen eines Mitglieds führt Dolibarr; die Website zeigt den Stand, der dort steht,
# und schickt jede Entscheidung dorthin - mit fester Vorgangskennung, damit ein zweites Senden
# nichts doppelt speichert. Zustimmen nur mit der Textfassung, die die Person gesehen hat;
# Widerrufen immer, auch wenn es inzwischen eine neue Fassung gibt. Ohne bestätigte Zuordnung
# oder ohne Anbindung gibt es hier nichts - und keinen lokalen zweiten Stand.

CONSENT_FORM_NAME = "Website: Meine Mitgliedschaft"


class ConsentDecisionBody(BaseModel):
    code: str
    decision: Literal["given", "withdrawn"]
    version: int | None = None


async def _consent_context(db, user: dict):
    """Anbindung live und Zuordnung bestätigt - sonst der Grund, warum es hier nichts gibt."""
    settings = await load_dolibarr_settings(db)
    if settings["mode"] != "live":
        return settings, None, None, "not_connected"
    link = await verified_link(db, settings, user["id"])
    if not link:
        return settings, None, None, "not_linked"
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        return settings, link, None, exc.kind
    return settings, link, client, None


def _consent_view(row: dict, texts: dict[str, dict]) -> dict:
    code = str(row.get("code") or "")
    text = texts.get(code) or {}
    return {
        "code": code, "label": row.get("label") or text.get("label") or code, "state": row.get("state") or "none",
        "version": int(row.get("version") or 0), "current_version": int(row.get("current_version") or 0), "moment": row.get("moment") or None,
        "can_give": bool(row.get("can_give")), "can_withdraw": bool(row.get("can_withdraw")),
        # Der aktuelle Text nur dort, wo eine Zustimmung möglich ist - genau die Fassung, die zurückgeschickt wird.
        "text": text.get("text") if row.get("can_give") else None,
        "text_changed": bool(row.get("state") == "given" and int(row.get("version") or 0) < int(row.get("current_version") or 0)),
    }


async def _consent_list(client: DolibarrClient, member_id: int) -> list[dict]:
    rows = await client.member_consents(member_id)
    texts = {str(t.get("code") or ""): t for t in await client.consent_texts()}
    return [_consent_view(row, texts) for row in rows if row.get("code")]


@router.get("/me/consents")
async def my_consents(user: dict = Depends(get_current_user)):
    db = get_db()
    settings, link, client, reason = await _consent_context(db, user)
    if reason:
        return {"available": False, "reason": reason}
    try:
        consents = await _consent_list(client, link["member_id"])
    except DolibarrError as exc:
        return {"available": False, "reason": exc.kind, "text": exc.text}
    return {"available": True, "as_of": now_utc().isoformat(), "consents": consents}


@router.post("/me/consents")
async def decide_my_consent(body: ConsentDecisionBody, user: dict = Depends(get_current_user)):
    db = get_db()
    settings, link, client, reason = await _consent_context(db, user)
    if reason:
        raise HTTPException(409, "Deine Einwilligungen führt die Mitgliederverwaltung - dafür braucht dein Konto eine bestätigte Zuordnung.")
    code = body.code.strip()[:32]
    if not code:
        raise HTTPException(400, "Zweck fehlt.")
    if body.decision == "given" and not body.version:
        raise HTTPException(400, "Zum Zustimmen gehört die Fassung des Textes, die dir gezeigt wurde.")
    now = now_utc().isoformat()
    record = {
        "id": new_id(), "user_id": user["id"], "member_id": int(link["member_id"]), "code": code, "decision": body.decision,
        "version": body.version if body.decision == "given" else None, "reference": f"web-c-{new_id()}", "created_at": now, "status": "sent",
    }
    await db.consent_decisions.insert_one(record)
    payload = {"code": code, "decision": body.decision, "granted_at": now, "form": CONSENT_FORM_NAME, "reference": record["reference"]}
    if body.decision == "given":
        payload["version"] = int(body.version)
    try:
        result = await client.decide_consent(link["member_id"], payload)
    except DolibarrError as exc:
        await db.consent_decisions.update_one({"id": record["id"]}, {"$set": {"status": "failed", "error": exc.kind}})
        if exc.kind == "bad_request":
            raise HTTPException(400, "Der Text hat sich inzwischen geändert - bitte die Seite neu laden und noch einmal lesen.")
        if exc.kind == "conflict":
            raise HTTPException(409, "Ein späterer Widerruf bleibt bestehen - die Zustimmung wurde nicht gespeichert.")
        raise HTTPException(503, f"Mitgliederverwaltung nicht erreichbar - nichts geändert ({exc.text}).")
    await db.consent_decisions.update_one({"id": record["id"]}, {"$set": {"status": "recorded" if result.get("recorded") else "duplicate", "result_state": result.get("state")}})
    await _audit(user["id"], f"consent.{body.decision}", user["id"], {"code": code, "version": result.get("version"), "reference": record["reference"]})
    try:
        consents = await _consent_list(client, link["member_id"])
    except DolibarrError:
        consents = None
    return {"ok": True, "result": {"code": result.get("code"), "state": result.get("state"), "version": result.get("version"), "recorded": bool(result.get("recorded"))}, "consents": consents}


# ---------- Self ----------
class IdentityClaimBody(BaseModel):
    code: str


@router.get("/me/identity")
async def my_identity(user: dict = Depends(get_current_user)):
    """Vereinsakte verbinden (#324 Teil 1): ist das Konto an das Vereinsmodul gebunden, und was darf es dort?"""
    return await dolibarr_identity.state(get_db(), user)


@router.post("/me/identity")
async def claim_identity(body: IdentityClaimBody, request: Request, user: dict = Depends(get_current_user)):
    """Einen Einladungscode vom Vorstand einlösen. Der Code ist der Nachweis; das Modul entscheidet."""
    await enforce_rate_limit(request, "dolibarr:identity:claim", limit=10, window_seconds=900, subject=user["id"])
    try:
        return await dolibarr_identity.claim(get_db(), user, body.code)
    except dolibarr_identity.ClaimError as exc:
        raise HTTPException(exc.status, exc.detail)


class SelfServiceChangeBody(BaseModel):
    version: str
    changes: dict[str, str]


class SelfServiceExitBody(BaseModel):
    wished_last_day: str | None = None


@router.get("/me/self-service")
async def my_self_service(user: dict = Depends(get_current_user)):
    """Eigene Daten und Einreichungen aus der Vereinsakte (#329 Teil 2) - nur mit Bindung und Fähigkeit „profile“."""
    return await dolibarr_self_service.overview(get_db(), user)


@router.post("/me/self-service/changes")
async def request_self_service_change(body: SelfServiceChangeBody, request: Request, user: dict = Depends(get_current_user)):
    await enforce_rate_limit(request, "dolibarr:self-service:change", limit=20, window_seconds=3600, subject=user["id"])
    try:
        return await dolibarr_self_service.request_change(get_db(), user, body.version, body.changes)
    except dolibarr_self_service.SelfServiceError as exc:
        raise HTTPException(exc.status, exc.detail)


@router.post("/me/self-service/exit")
async def request_self_service_exit(body: SelfServiceExitBody, request: Request, user: dict = Depends(get_current_user)):
    await enforce_rate_limit(request, "dolibarr:self-service:exit", limit=5, window_seconds=3600, subject=user["id"])
    try:
        return await dolibarr_self_service.request_exit(get_db(), user, body.wished_last_day)
    except dolibarr_self_service.SelfServiceError as exc:
        raise HTTPException(exc.status, exc.detail)


class WebsiteProfileBody(BaseModel):
    gamertag: str | None = None
    bio: str | None = None
    games: list[str] | str | None = None
    platforms: list[str] | str | None = None


@router.get("/me/website-profile")
async def my_website_profile(user: dict = Depends(get_current_user)):
    """Eigenes Website-Profil aus der Vereinsakte (#260) - nur mit Bindung und Fähigkeit „eigene Daten“."""
    return await dolibarr_self_service.website_profile(get_db(), user)


@router.put("/me/website-profile")
async def save_my_website_profile(body: WebsiteProfileBody, request: Request, user: dict = Depends(get_current_user)):
    await enforce_rate_limit(request, "dolibarr:website-profile", limit=20, window_seconds=3600, subject=user["id"])
    try:
        return await dolibarr_self_service.save_website_profile(get_db(), user, body.model_dump(exclude_unset=True))
    except dolibarr_self_service.SelfServiceError as exc:
        raise HTTPException(exc.status, exc.detail)


@router.get("/me")
async def my_membership(user: dict = Depends(get_current_user)):
    """Return logged-in user's membership record (or None)."""
    db = get_db()
    settings = await load_dolibarr_settings(db)
    link = None
    if settings["mode"] != "off":
        try:
            link = await try_auto_link(db, settings, user)
        except Exception:  # noqa: BLE001 - die eigene Seite darf nie an Dolibarr scheitern
            link = None
        link = link or await link_for_user(db, settings, user["id"])
    m = await get_membership(user["id"])
    view = dict(m) if m else None
    if view:
        # Der Rohstand der Anbindung gehört nicht in die Antwort; `dolibarr` unten ist die geprüfte Sicht.
        view.pop("dolibarr", None)
        # Im Admin heißt das Feld „Interne Notizen“ - also sieht das Mitglied sie nicht (#345).
        # Dasselbe gilt für die Notiz je Statuswechsel und dafür, wer ihn vorgenommen hat.
        for internal in ("notes", "created_by", "updated_by"):
            view.pop(internal, None)
        view["history"] = [
            {"at": entry.get("at"), "from_status": entry.get("from_status"), "to_status": entry.get("to_status"),
             "source": "dolibarr" if entry.get("actor_id") == "dolibarr" else "verein"}
            for entry in (view.get("history") or [])
        ]
    return {
        "user_id": user["id"],
        "membership": view,
        "is_active_member": is_active_member(m),
        "user_type": derived_user_type(user, m),
        "dolibarr": _dolibarr_view(m, link, settings),
    }


# ---------- Admin: list memberships ----------
@router.get("")
async def list_memberships(
    status: str | None = None,
    membership_type: str | None = None,
    q: str | None = None,
    me: dict = Depends(require_area("club")),
):
    db = get_db()
    query = {}
    if status:
        query["member_status"] = status
    if membership_type:
        query["membership_type"] = membership_type
    cursor = db.memberships.find(query, {"_id": 0}).sort("created_at", -1)
    memberships = await cursor.to_list(1000)
    user_ids = [m["user_id"] for m in memberships]
    user_map = {
        u["id"]: u for u in await db.users.find(
            {"id": {"$in": user_ids}},
            {"_id": 0, "password_hash": 0, "mfa_secret": 0, "mfa_pending_secret": 0, "mfa_recovery_code_hashes": 0},
        ).to_list(2000)
    }
    out = []
    for m in memberships:
        user = user_map.get(m["user_id"])
        if not user:
            continue
        if q:
            blob = " ".join([
                user.get("username") or "",
                user.get("email") or "",
                user.get("display_name") or "",
                m.get("member_number") or "",
            ]).lower()
            if q.lower() not in blob:
                continue
        out.append({"membership": m, "user": user})
    return out


# ---------- Admin: get/update/upgrade a user's membership ----------
@router.get("/user/{user_id}")
async def get_user_membership(user_id: str, me: dict = Depends(require_area("club"))):
    user = await get_user_with_membership(user_id)
    if not user:
        raise HTTPException(404, "Benutzer nicht gefunden.")
    return user


@router.put("/user/{user_id}")
async def update_user_membership(
    user_id: str,
    body: MembershipUpdate,
    me: dict = Depends(require_area("club")),
):
    db = get_db()
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0, "mfa_secret": 0, "mfa_pending_secret": 0, "mfa_recovery_code_hashes": 0})
    if not user:
        raise HTTPException(404, "Benutzer nicht gefunden.")
    payload = body.model_dump(exclude_unset=True)
    led_fields = {"member_status", "membership_type", "member_number", "member_since", "member_since_precision"} & set(payload)
    if led_fields and await _led_by_dolibarr(user_id):
        raise HTTPException(409, "Diese Mitgliedschaft wird in Dolibarr geführt. Status, Art, Nummer und Beginn dort ändern – hier bleiben Notiz, interne Rolle und die Sichtbarkeit der Nummer.")
    try:
        m = await upsert_membership(user_id=user_id, actor_id=me["id"], **payload)
    except ValueError as e:
        raise HTTPException(400, str(e))

    await _audit(me["id"], "membership.update", user_id, payload)
    # Endet die Mitgliedschaft, geht ein selbst angelegter Verzeichnis-Eintrag offline (#410).
    await end_self_directory_entry(user_id, m.get("member_status") in ACTIVE_STATUSES)

    # Fire emails based on transitions
    new_status = payload.get("member_status")
    if new_status == "active":
        await send_user_template(
            user,
            "membership_activated",
            display_name=user.get("display_name") or user.get("username"),
            member_number=m.get("member_number") or "",
        )
        # Phase 6: Auto-award members-only badges
        try:
            from badges import evaluate_membership_badges
            await evaluate_membership_badges(user_id)
        except Exception:
            pass
    elif new_status == "blocked":
        await send_user_template(
            user,
            "membership_blocked",
            display_name=user.get("display_name") or user.get("username"),
        )
    elif new_status in ("inactive", "former"):
        await send_user_template(
            user,
            "membership_deactivated",
            display_name=user.get("display_name") or user.get("username"),
        )

    user["membership"] = m
    user["user_type"] = derived_user_type(user, m)
    user["is_club_member"] = is_active_member(m)
    return user


# ---------- Member benefits ----------
@router.get("/benefits")
async def list_benefits(user: dict | None = Depends(get_optional_user)):
    """Public: only returns active benefits visible to the calling user."""
    db = get_db()
    cursor = db.member_benefits.find({"is_active": True}, {"_id": 0}).sort("order_index", 1)
    benefits = await cursor.to_list(500)
    if not user:
        return []
    m = await get_membership(user["id"])
    if not is_active_member(m):
        return []
    user_type = m.get("membership_type")
    out = []
    for b in benefits:
        allowed = b.get("visible_for_membership_types") or []
        if not allowed or (user_type and user_type in allowed):
            out.append(b)
    return out


@router.get("/benefits/all")
async def list_all_benefits(me: dict = Depends(require_area("club"))):
    db = get_db()
    cursor = db.member_benefits.find({}, {"_id": 0}).sort("order_index", 1)
    return await cursor.to_list(500)


@router.post("/benefits")
async def create_benefit(body: MemberBenefitCreate, me: dict = Depends(require_area("club"))):
    db = get_db()
    doc = {
        "id": new_id(),
        **body.model_dump(),
        "created_at": now_utc().isoformat(),
        "created_by": me["id"],
    }
    await db.member_benefits.insert_one(doc)
    await _audit(me["id"], "benefit.create", doc["id"], {"title": doc["title"]})
    doc.pop("_id", None)
    return doc


@router.put("/benefits/{benefit_id}")
@router.patch("/benefits/{benefit_id}")
async def update_benefit(
    benefit_id: str, body: MemberBenefitUpdate, me: dict = Depends(require_area("club")),
):
    db = get_db()
    nullable_fields = {
        "description", "category", "image_url", "link_url", "valid_from", "valid_until",
    }
    raw = body.model_dump(exclude_unset=True)
    update = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if not update:
        raise HTTPException(400, "Keine Änderungen.")
    update["updated_at"] = now_utc().isoformat()
    res = await db.member_benefits.update_one({"id": benefit_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Vorteil nicht gefunden.")
    await _audit(me["id"], "benefit.update", benefit_id, update)
    doc = await db.member_benefits.find_one({"id": benefit_id}, {"_id": 0})
    return doc


@router.delete("/benefits/{benefit_id}")
async def delete_benefit(benefit_id: str, me: dict = Depends(require_area("club"))):
    db = get_db()
    res = await db.member_benefits.delete_one({"id": benefit_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Vorteil nicht gefunden.")
    await _audit(me["id"], "benefit.delete", benefit_id)
    return {"ok": True}


# ---------- Editable public club member profiles ----------
@router.get("/profiles")
async def list_public_member_profiles():
    db = get_db()
    rows = await db.club_member_profiles.find(
        {"is_active": {"$ne": False}}, {"_id": 0}
    ).sort([("order_index", 1), ("display_name", 1)]).to_list(1000)
    board_titles = await _board_titles_by_profile_id(db)
    items = [_public_profile(row, board_title=board_titles.get(row["id"])) for row in rows]
    return await _attach_linked_accounts(db, rows, items, public_only=True)


@router.get("/profiles/{slug}")
async def get_public_member_profile(slug: str):
    db = get_db()
    row, was_old_slug = await find_by_slug_or_history(db.club_member_profiles, slug, {"_id": 0})
    if not row:
        raise HTTPException(404, "Mitglied nicht gefunden.")
    if row.get("is_active") is False:
        raise HTTPException(404, "Mitglied nicht gefunden.")
    if was_old_slug and row.get("slug"):
        return RedirectResponse(url=f"/api/membership/profiles/{row['slug']}", status_code=301)
    board_titles = await _board_titles_by_profile_id(db)
    item = _public_profile(row, detail=True, board_title=board_titles.get(row["id"]))
    item = (await _attach_linked_accounts(db, [row], [item], public_only=True))[0]
    return await _attach_reference_stats(db, item, row["id"])


@router.get("/profiles/admin/all")
async def admin_list_member_profiles(me: dict = Depends(require_area("club"))):
    db = get_db()
    rows = await db.club_member_profiles.find({}, {"_id": 0}).sort([("order_index", 1), ("display_name", 1)]).to_list(1000)
    board_titles = await _board_titles_by_profile_id(db)
    out = []
    for row in rows:
        item = _admin_profile(row)
        item["board_title"] = board_titles.get(row["id"])
        item["role_title"] = board_titles.get(row["id"]) or item.get("role_title")
        out.append(item)
    return await _attach_linked_accounts(db, rows, out, public_only=False, admin=True)


@router.post("/profiles/admin")
async def admin_create_member_profile(body: ClubMemberProfileCreate, me: dict = Depends(require_area("club"))):
    db = get_db()
    name = body.display_name.strip()
    if not name:
        raise HTTPException(400, "Name ist erforderlich.")
    slug = await _unique_profile_slug(db, body.slug or name)
    payload = body.model_dump()
    payload["user_id"] = await _normalize_linked_user_id(db, payload.get("user_id"))
    doc = {
        "id": new_id(),
        **payload,
        "display_name": name,
        "gamertag": _clean_name(payload.get("gamertag"), 40),
        "real_name": _clean_name(payload.get("real_name")) or name,
        "slug": slug,
        "photo_url": payload.get("photo_url") or None,
        "cover_url": payload.get("cover_url") or None,
        "role_title": payload.get("role_title") or None,
        "bio": payload.get("bio") or "",
        "games": _clean_list(payload.get("games")),
        "platforms": _clean_list(payload.get("platforms")),
        "birth_date": payload.get("birth_date").isoformat() if payload.get("birth_date") else None,
        "gender": _clean_gender(payload.get("gender")),
        "created_at": now_utc().isoformat(),
        "created_by": me["id"],
    }
    await db.club_member_profiles.insert_one(doc)
    await _activate_linked_membership(doc, me["id"])
    await _audit(me["id"], "club_member_profile.create", doc["id"], {"display_name": name})
    doc.pop("_id", None)
    item = _admin_profile(doc)
    return (await _attach_linked_accounts(db, [doc], [item], public_only=False, admin=True))[0]


@router.put("/profiles/admin/{profile_id}")
@router.patch("/profiles/admin/{profile_id}")
async def admin_update_member_profile(profile_id: str, body: ClubMemberProfileUpdate, me: dict = Depends(require_area("club"))):
    db = get_db()
    existing = await db.club_member_profiles.find_one({"id": profile_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Mitgliedsprofil nicht gefunden.")
    raw = body.model_dump(exclude_unset=True)
    nullable = {"role_title", "photo_url", "cover_url", "bio", "birth_date", "gender", "user_id", "gamertag", "real_name"}
    update = {k: v for k, v in raw.items() if v is not None or k in nullable}
    if "display_name" in update:
        update["display_name"] = str(update["display_name"] or "").strip()
        if not update["display_name"]:
            raise HTTPException(400, "Name ist erforderlich.")
    if "gamertag" in update:
        update["gamertag"] = _clean_name(update.get("gamertag"), 40)
    if "real_name" in update:
        update["real_name"] = _clean_name(update.get("real_name"))
    if "slug" in update:
        update["slug"] = await _unique_profile_slug(db, update["slug"] or existing.get("display_name") or "mitglied", profile_id)
    elif "display_name" in update:
        update["slug"] = await _unique_profile_slug(db, update["display_name"] or existing.get("display_name") or "mitglied", profile_id)
    apply_slug_history(existing, update)
    if "games" in update:
        update["games"] = _clean_list(update["games"])
    if "platforms" in update:
        update["platforms"] = _clean_list(update["platforms"])
    if "birth_date" in update and update["birth_date"]:
        update["birth_date"] = update["birth_date"].isoformat()
    if "gender" in update:
        update["gender"] = _clean_gender(update.get("gender"))
    if "user_id" in update:
        update["user_id"] = await _normalize_linked_user_id(db, update.get("user_id"), profile_id)
    if update.get("directory_blocked"):
        # Sperren heißt: sofort offline, und das Mitglied kann es nicht selbst zurückdrehen.
        update["is_active"] = False
    if not update:
        raise HTTPException(400, "Keine Änderungen.")
    update["updated_at"] = now_utc().isoformat()
    await db.club_member_profiles.update_one({"id": profile_id}, {"$set": update})
    await _audit(me["id"], "club_member_profile.update", profile_id, update)
    row = await db.club_member_profiles.find_one({"id": profile_id}, {"_id": 0})
    await _activate_linked_membership(row, me["id"])
    item = _admin_profile(row)
    return (await _attach_linked_accounts(db, [row], [item], public_only=False, admin=True))[0]


@router.delete("/profiles/admin/{profile_id}")
async def admin_delete_member_profile(profile_id: str, me: dict = Depends(require_area("club"))):
    db = get_db()
    res = await db.club_member_profiles.delete_one({"id": profile_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Mitgliedsprofil nicht gefunden.")
    await _audit(me["id"], "club_member_profile.delete", profile_id)
    return {"ok": True}


# ---------- Mitgliederverzeichnis per Opt-in (#410) ----------
# Wer laut Mitgliederverwaltung aktives Mitglied ist, entscheidet selbst, ob er im Verzeichnis steht,
# und pflegt dort Gamertag, Spiele, Plattformen und eine kurze Bio. Der Eintrag ist ein normales
# Mitgliederprofil (`club_member_profiles`, `source: "member"`) - Verzeichnis, Profilseite, Vorstands-
# titel und Referenzen funktionieren damit wie bei redaktionellen Profilen. Die Verwaltung kann
# sperren; endet die Mitgliedschaft, geht der Eintrag offline.

def _own_directory_view(profile: dict | None, membership: dict | None, user: dict) -> dict:
    listed = bool(profile) and profile.get("is_active") is not False
    return {
        "eligible": is_active_member(membership),
        "listed": listed,
        "blocked": bool(profile and profile.get("directory_blocked")),
        "editorial": bool(profile and (profile.get("source") or "editorial") != "member"),
        "slug": profile.get("slug") if profile else None,
        "entry": {
            "display_name": (profile or {}).get("display_name") or user.get("display_name") or user.get("username"),
            "gamertag": (profile or {}).get("gamertag") or user.get("username"),
            "photo_url": (profile or {}).get("photo_url") or user.get("avatar_url"),
            "bio": (profile or {}).get("bio") or "",
            "games": (profile or {}).get("games") if profile else (user.get("favorite_games") or []),
            "platforms": (profile or {}).get("platforms") if profile else (user.get("main_platforms") or []),
        },
    }


async def _account_for_directory(db, user: dict) -> dict:
    """Name, Foto, Spiele und Plattformen so, wie sie jetzt am Konto stehen - nicht aus der Sitzung."""
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "favorite_games": 1, "main_platforms": 1, "gender": 1})
    return fresh or user


@router.get("/me/directory")
async def my_directory_entry(me: dict = Depends(get_current_user)):
    db = get_db()
    user = await _account_for_directory(db, me)
    membership = await get_membership(user["id"])
    profile = await db.club_member_profiles.find_one({"user_id": user["id"]}, {"_id": 0})
    return _own_directory_view(profile, membership, user)


@router.put("/me/directory")
async def update_my_directory_entry(body: DirectoryEntryUpdate, me: dict = Depends(get_current_user)):
    db = get_db()
    user = await _account_for_directory(db, me)
    membership = await get_membership(user["id"])
    if not is_active_member(membership):
        raise HTTPException(403, "Ins Mitgliederverzeichnis können sich nur aktive Vereinsmitglieder eintragen.")
    profile = await db.club_member_profiles.find_one({"user_id": user["id"]}, {"_id": 0})
    if profile and profile.get("directory_blocked"):
        raise HTTPException(403, "Dein Eintrag ist von der Vereinsverwaltung gesperrt - bitte beim Vorstand melden.")
    raw = body.model_dump(exclude_unset=True)
    listed = raw.pop("listed", None)
    fields: dict = {}
    if "gamertag" in raw:
        fields["gamertag"] = _clean_name(raw.get("gamertag"), 40) or None
    if "bio" in raw:
        fields["bio"] = str(raw.get("bio") or "").strip()[:2000]
    if "games" in raw:
        fields["games"] = _clean_list(raw.get("games"))
    if "platforms" in raw:
        fields["platforms"] = _clean_list(raw.get("platforms"))
    now = now_utc().isoformat()
    if profile is None:
        if listed is not True:
            raise HTTPException(400, "Zuerst „Im Mitgliederverzeichnis zeigen“ einschalten.")
        name = str(user.get("display_name") or user.get("username") or "Mitglied").strip()
        gamertag = fields.get("gamertag") or _clean_name(user.get("username"), 40)
        doc = {
            "id": new_id(), "display_name": name, "gamertag": gamertag, "real_name": None,
            "slug": await _unique_profile_slug(db, gamertag or name),
            "role_title": None, "photo_url": user.get("avatar_url") or None, "cover_url": None,
            "bio": fields.get("bio", ""), "birth_date": None, "gender": _clean_gender(user.get("gender")),
            "games": fields.get("games", _clean_list(user.get("favorite_games"))),
            "platforms": fields.get("platforms", _clean_list(user.get("main_platforms"))),
            "user_id": user["id"], "order_index": 0, "is_active": True, "source": "member",
            "created_at": now, "created_by": user["id"], "updated_at": now,
        }
        await db.club_member_profiles.insert_one(doc)
        doc.pop("_id", None)
        await _audit(user["id"], "club_member_profile.self_create", doc["id"], {"display_name": name})
        profile = doc
    else:
        update = dict(fields)
        if listed is not None:
            update["is_active"] = bool(listed)
        if not update:
            raise HTTPException(400, "Keine Änderungen.")
        update["updated_at"] = now
        await db.club_member_profiles.update_one({"id": profile["id"]}, {"$set": update})
        await _audit(user["id"], "club_member_profile.self_update", profile["id"], update)
        profile = await db.club_member_profiles.find_one({"id": profile["id"]}, {"_id": 0})
    return _own_directory_view(profile, membership, user)


@router.get("/count")
async def membership_count():
    """Öffentlich: wie viele Mitglieder der Verein laut Mitgliederverwaltung hat und wie viele im
    Verzeichnis stehen - für die Community-Seite statt einer Zählung der Handliste."""
    db = get_db()
    return {
        "members": await db.memberships.count_documents({"member_status": {"$in": list(ACTIVE_STATUSES)}}),
        "listed": await db.club_member_profiles.count_documents({"is_active": {"$ne": False}}),
    }


# ---------- Public members directory ----------
@router.get("/public")
async def public_members_directory():
    """Public: list of active club members (only those with public profile)."""
    db = get_db()
    memberships = await db.memberships.find(
        {"member_status": {"$in": ["active", "honorary"]}}, {"_id": 0}
    ).to_list(2000)
    user_ids = [m["user_id"] for m in memberships]
    users = await db.users.find(
        {"id": {"$in": user_ids}, "is_active": True, "is_banned": {"$ne": True},
         "privacy_public_profile": True},
        {"_id": 0, "password_hash": 0, "email": 0, "mfa_secret": 0, "mfa_pending_secret": 0, "mfa_recovery_code_hashes": 0},
    ).to_list(2000)
    user_map = {u["id"]: u for u in users}
    out = []
    for m in memberships:
        u = user_map.get(m["user_id"])
        if not u:
            continue
        out.append({
            "username": u["username"],
            "display_name": u.get("display_name"),
            "avatar_url": u.get("avatar_url"),
            "country": u.get("country"),
            "favorite_games": u.get("favorite_games") or [],
            "membership_type": m.get("membership_type"),
            "member_since": m.get("member_since"),
            "internal_role": m.get("internal_role"),
            "member_number": m.get("member_number") if m.get("show_member_number_publicly") else None,
        })
    out.sort(key=lambda x: (x.get("member_since") or ""))
    return out
