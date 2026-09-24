"""GDPR endpoints: data export and account anonymisation."""

from fastapi import APIRouter, HTTPException, Depends

from database import get_db
from auth import require_super, get_current_user
from services.competition_privacy import registration_match_snapshot
from models import now_utc, new_id

dsgvo_router = APIRouter(prefix="/api/dsgvo", tags=["dsgvo"])


async def _user_data_export(db, user_id: str) -> dict:
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "password_hash": 0, "mfa_secret": 0, "mfa_pending_secret": 0,
         "mfa_recovery_code_hashes": 0},
    )
    if not user:
        raise HTTPException(404, "Account nicht gefunden")
    email = user.get("email", "")
    async def rows(collection, query, limit=5000):
        return await collection.find(query, {"_id": 0}).to_list(limit)

    registrations = await rows(db.tournament_registrations, {"user_id": user_id})
    return {
        "format_version": 2,
        "exported_at": now_utc().isoformat(),
        "user": user,
        "consent_records": await rows(db.consent_records, {"user_id": user_id}),
        "membership": await db.memberships.find_one({"user_id": user_id}, {"_id": 0}),
        "social_accounts": await rows(db.user_socials, {"user_id": user_id}),
        "platform_links": await rows(db.platform_links, {"user_id": user_id}),
        "tournament_registrations": registrations,
        "competition_matches": await registration_match_snapshot(
            db, [row.get("id") for row in registrations if row.get("id")],
        ),
        "event_registrations": await rows(db.event_registrations, {"user_id": user_id}),
        "f1_lap_times": await rows(db.f1_lap_times, {"user_id": user_id}),
        "teams": await rows(db.teams, {"$or": [{"member_ids": user_id}, {"leader_id": user_id}]}),
        "team_memberships": await rows(db.team_members, {"user_id": user_id}),
        "team_invites": await rows(db.team_invites, {"user_id": user_id}),
        "achievements": await rows(db.user_achievements, {"user_id": user_id}),
        "season_points": await rows(db.season_points, {"user_id": user_id}),
        "prize_pickups": await rows(db.prize_pickups, {"user_id": user_id}),
        "notifications": await rows(db.notifications, {"user_id": user_id}),
        "direct_messages": await rows(db.direct_messages, {"$or": [{"sender_id": user_id}, {"recipient_id": user_id}]}),
        "friendships": await rows(db.friendships, {"$or": [{"requester_id": user_id}, {"recipient_id": user_id}]}),
        "blocks": await rows(db.user_blocks, {"$or": [{"blocker_id": user_id}, {"blocked_id": user_id}]}),
        "moderation_reports": await rows(db.user_reports, {"$or": [{"reporter_id": user_id}, {"target_user_id": user_id}]}),
        "email_logs": await rows(db.email_logs, {"to": email}),
        "mobile_devices": await rows(db.mobile_push_tokens, {"user_id": user_id}),
        "mobile_client_logs": await rows(db.mobile_client_logs, {"user_id": user_id}),
        "audit_trail": await rows(db.audit_logs, {"$or": [{"actor_id": user_id}, {"target_id": user_id}]}),
    }


async def _anonymize_user_data(db, user_id: str, actor_id: str, action: str) -> None:
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(404, "Account nicht gefunden")
    now = now_utc().isoformat()
    anonymous_email = f"deleted_{user_id[:12]}@deleted.invalid"
    anonymous_username = f"deleted_{user_id[:12]}"
    await db.users.update_one({"id": user_id}, {
        "$set": {
            "email": anonymous_email, "username": anonymous_username, "display_name": "Gelöschter User",
            "first_name": None, "last_name": None, "nickname": None, "birth_date": None, "gender": None,
            "bio": None, "discord_name": None, "discord_id": None, "switch_code": None, "steam_id": None,
            "epic_id": None, "psn_id": None, "xbox_id": None, "riot_id": None, "game_ids": {},
            "faceit_handle": None, "startgg_handle": None, "roblox_handle": None, "osu_handle": None, "lichess_handle": None, "github_handle": None, "kick_handle": None, "reddit_handle": None, "spotify_handle": None,
            "country": None, "state": None, "city": None, "avatar_url": None, "banner_url": None,
            "twitch_handle": None, "youtube_handle": None, "instagram_handle": None,
            "newsletter_consent": False, "notification_preferences": {}, "privacy_public_profile": False,
            "google_linked": False, "password_login_available": False, "email_verified": False,
            "is_active": False, "is_banned": True, "mfa_enabled": False,
            "password_hash": "!disabled", "anonymized_at": now, "updated_at": now,
        },
        "$unset": {
            "google_id": "", "google_email": "", "mfa_secret": "", "mfa_pending_secret": "",
            "mfa_pending_created_at": "", "mfa_recovery_code_hashes": "", "platform_verified": "",
        },
    })
    for collection in (db.refresh_tokens, db.auth_sessions, db.email_verification_tokens,
                       db.password_reset_tokens, db.mfa_login_challenges, db.mobile_push_tokens,
                       db.mobile_client_logs, db.notifications, db.user_socials,
                       db.passkeys, db.passkey_challenges, db.platform_links):
        await collection.delete_many({"user_id": user_id})
    await db.friendships.delete_many({"$or": [{"requester_id": user_id}, {"recipient_id": user_id}]})
    await db.user_blocks.delete_many({"$or": [{"blocker_id": user_id}, {"blocked_id": user_id}]})
    await db.direct_messages.update_many({"sender_id": user_id}, {"$set": {"message": "[Nachricht gelöscht]", "sender_anonymized": True}})
    await db.team_chat_messages.update_many({"user_id": user_id}, {"$set": {"message": "[Nachricht gelöscht]", "author_anonymized": True}})
    await db.match_chat_messages.update_many({"user_id": user_id}, {"$set": {"message": "[Nachricht gelöscht]", "author_anonymized": True}})
    await db.tournament_chat_messages.update_many({"user_id": user_id}, {"$set": {"message": "[Nachricht gelöscht]", "author_anonymized": True}})
    from services.chat_attachments import delete_user_attachments
    await delete_user_attachments(db, user_id)
    await db.email_logs.update_many({"to": user.get("email")}, {"$set": {"to": anonymous_email, "recipient_anonymized": True}})
    await db.memberships.update_many({"user_id": user_id}, {"$set": {
        "email": anonymous_email, "first_name": None, "last_name": None, "phone": None,
        "address": None, "member_status": "former", "updated_at": now,
    }})
    # Dolibarr (#316, #296): Zuordnung lösen, Rechnungs-Stand vergessen - das Mitglied selbst bleibt in Dolibarr.
    await db.dolibarr_links.update_many({"user_id": user_id}, {"$set": {"status": "revoked", "updated_at": now}, "$unset": {"member_key": ""}})
    await db.dolibarr_invoice_cache.delete_many({"user_id": user_id})
    # Abrechnung (#322): Belege bleiben in Dolibarr; der Auftrag hier behält Betrag und Nummer, verliert Name und E-Mail.
    from services.billing_orders import anonymize_user as anonymize_billing
    await anonymize_billing(db, user_id)
    await db.audit_logs.insert_one({
        "id": new_id(), "action": action, "actor_id": actor_id, "target_id": user_id,
        "data": {"personal_data_removed": True}, "created_at": now,
    })


@dsgvo_router.get("/export-my-data")
async def export_my_data(me: dict = Depends(get_current_user)):
    db = get_db()
    return await _user_data_export(db, me["id"])


@dsgvo_router.post("/anonymize-me")
async def anonymize_me(me: dict = Depends(get_current_user)):
    """Anonymize own account but keep tournament history for statistical integrity."""
    db = get_db()
    await _anonymize_user_data(db, me["id"], me["id"], "user.self_anonymize")
    return {"ok": True}


@dsgvo_router.post("/admin/anonymize/{user_id}")
async def admin_anonymize(user_id: str, me: dict = Depends(require_super())):
    db = get_db()
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "role": 1})
    if target and target.get("role") == "superadmin" and user_id != me["id"]:
        raise HTTPException(403, "Andere Superadmins dürfen nicht anonymisiert werden.")
    await _anonymize_user_data(db, user_id, me["id"], "user.admin_anonymize")
    return {"ok": True}
