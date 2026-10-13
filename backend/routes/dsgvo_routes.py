"""GDPR endpoints: data export and account anonymisation."""

import json
from datetime import date, datetime

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse

from database import get_db
from auth import require_super, get_current_user
from services import account_erasure
from services.competition_privacy import registration_match_snapshot
from models import now_utc, new_id

dsgvo_router = APIRouter(prefix="/api/dsgvo", tags=["dsgvo"])

# Auskunft (#1030). Welche Sammlung wo steht, legt services/personal_data.py fest; ein Test vergleicht beide Listen.
# Nie in die Auskunft: Prüfwerte, Schlüssel und Speicherorte - sie sagen über die Person nichts aus und wären außerhalb
# des Systems ein Werkzeug.
HIDDEN_KEYS = frozenset({"_id", "password_hash", "token_hash", "storage_key", "poster_key", "mfa_secret", "mfa_pending_secret",
                         "mfa_recovery_code_hashes"})
# Seitenweise lesen statt einer Obergrenze: jede Liste kommt vollständig, sortiert nach dem Zeitpunkt des Anlegens (_id).
EXPORT_PAGE = 500
# Meldungen über die Person: Art und Stand - wer gemeldet hat und was er schrieb, bleibt bei ihm (Art. 15 Abs. 4).
REPORT_ABOUT_ME = ("id", "category", "status", "created_at", "reviewed_at")
# Einträge im Adminprotokoll, in denen die Person gehandelt hat: nur der Vorgang - der Inhalt betrifft andere.
AUDIT_FIELDS = ("id", "action", "target_type", "created_at")
# Nachrichten: eigene mit Inhalt; empfangene nur als Vorgang (wann, in welchem Gespräch, gelesen) - der Inhalt ist der der
# anderen Person. Gruppen-Chats (Team, Match, Turnier) nennen nur die eigenen Nachrichten.
OWN_MESSAGE = ("id", "message", "sticker", "type", "created_at", "updated_at", "deleted_at", "read_at")
RECEIVED_MESSAGE = ("id", "created_at", "read_at")
CHAT_PLACE = ("team_id", "match_id", "stage_id", "tournament_id")
# Terminvorschläge: der eigene Vorschlag - wer auf der anderen Seite entschieden hat und was er dazu schrieb, nicht.
PROPOSAL = ("id", "match_id", "match_collection", "tournament_id", "stage_id", "kind", "status", "scheduled_at", "note",
            "parent_proposal_id", "created_at", "updated_at")
# Dateien: was die Datei ist und wie sie geprüft wurde - ohne Dateinamen, Adresse oder Ablageort.
UPLOAD = ("id", "media_scope", "media_type", "kind", "mime", "size", "width", "height", "scan_state", "status", "created_at",
          "updated_at")
UPLOAD_EVENT = ("id", "created_at", "endpoint", "media_scope", "kind", "mime", "size", "status", "status_code", "duration_ms",
                "ip", "user_agent")
ATTACHMENT = ("id", "kind", "mime", "size", "width", "height", "status", "context", "created_at", "updated_at")
PROOF_PHOTO = ("id", "match_id", "tournament_id", "registration_id", "mime", "size", "width", "height", "status", "created_at",
               "updated_at")


def _clean(row: dict, *drop: str) -> dict:
    return {key: value for key, value in row.items() if key not in HIDDEN_KEYS and key not in drop}


def _pick(*keys: str):
    return lambda row: {key: row.get(key) for key in keys}


def _audit_entry(user_id: str):
    def shape(row: dict) -> dict:
        entry = {key: row.get(key) for key in AUDIT_FIELDS}
        if row.get("target_id") == user_id:
            entry["data"] = row.get("data")
        return entry
    return shape


def _report(user_id: str):
    def shape(row: dict) -> dict:
        if row.get("reporter_id") == user_id:
            return _clean(row, "reviewed_by")
        return {**{key: row.get(key) for key in REPORT_ABOUT_ME}, "about_me": True}
    return shape


def _direct_message(user_id: str):
    def shape(row: dict) -> dict:
        if row.get("sender_id") == user_id:
            return {**{key: row.get(key) for key in OWN_MESSAGE}, "conversation": row.get("recipient_id"),
                    "attachments": len(row.get("attachments") or [])}
        return {**{key: row.get(key) for key in RECEIVED_MESSAGE}, "conversation": row.get("sender_id"), "received": True}
    return shape


def _sanction(row: dict) -> dict:
    out = _clean(row, "created_by", "lifted_by")
    if isinstance(out.get("appeal"), dict):
        out["appeal"] = {key: value for key, value in out["appeal"].items() if key != "decided_by"}
    return out


async def _paged(collection, query: dict):
    """Alle Zeilen, seitenweise nach ``_id`` - ohne Obergrenze und ohne alles auf einmal im Speicher."""
    last = None
    while True:
        page_query = query if last is None else {"$and": [query, {"_id": {"$gt": last}}]}
        page = await collection.find(page_query).sort("_id", 1).limit(EXPORT_PAGE).to_list(EXPORT_PAGE)
        for row in page:
            yield row
        if len(page) < EXPORT_PAGE or "_id" not in page[-1]:
            return
        last = page[-1]["_id"]


def _rows(collection, query: dict, shape=_clean):
    async def produce():
        async for row in _paged(collection, query):
            yield shape(row)
    return ("list", produce)


def _value(make):
    return ("value", make)


def _chat_rows(db, user_id: str):
    async def own_chat_messages():
        for name in ("team_chat_messages", "match_chat_messages", "tournament_chat_messages"):
            async for row in _paged(getattr(db, name), {"user_id": user_id}):
                place = {key: row[key] for key in CHAT_PLACE if row.get(key)}
                yield {"chat": name.removesuffix("_chat_messages"), **place, **{key: row.get(key) for key in OWN_MESSAGE if key != "read_at"},
                       "attachments": len(row.get("attachments") or [])}
    return ("list", own_chat_messages)


async def _user_data_sections(db, user_id: str) -> list[tuple[str, tuple]]:
    """Die Auskunft als Abschnitte. Der Aufbau ist billig; gelesen wird erst beim Schreiben (``_stream``)."""
    from services.event_photos import EXPORT_FIELDS as GALLERY_FIELDS

    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(404, "Account nicht gefunden")
    user = _clean(user)
    email = user.get("email", "")
    me = {"user_id": user_id}

    async def matches():
        registration_ids = [row["id"] async for row in _paged(db.tournament_registrations, me) if row.get("id")]
        return await registration_match_snapshot(db, registration_ids, limit=None)

    async def stamp():
        return now_utc().isoformat()

    async def one(collection, query):
        row = await collection.find_one(query)
        return _clean(row) if row else None

    async def static(value):
        return value

    return [
        ("format_version", _value(lambda: static(5))),
        ("exported_at", _value(stamp)),
        ("user", _value(lambda: static(user))),
        ("consent_records", _rows(db.consent_records, me)),
        ("membership", _value(lambda: one(db.memberships, me))),
        ("social_accounts", _rows(db.user_socials, me)),
        ("platform_links", _rows(db.platform_links, me)),
        ("tournament_registrations", _rows(db.tournament_registrations, me)),
        ("competition_matches", _value(matches)),
        ("event_registrations", _rows(db.event_registrations, me)),
        ("f1_lap_times", _rows(db.f1_lap_times, me)),
        ("teams", _rows(db.teams, {"$or": [{"member_ids": user_id}, {"leader_id": user_id}]}, lambda row: _clean(row, "join_code"))),
        ("team_memberships", _rows(db.team_members, me)),
        ("team_invites", _rows(db.team_invites, me)),
        ("achievements", _rows(db.user_achievements, me)),
        # Was für die Erfolge gezählt wurde (#616, #678): der Stand aller Zähler, die Signale je Tag (Kürbis,
        # Fledermäuse, Schneeflocken …), gelesene News, geöffnete Streams und gegebenes GG - nur Zahlen und Zeitpunkte.
        ("achievement_counters", _value(lambda: one(db.user_achievement_stats, me))),
        ("achievement_signals", _rows(db.user_signals, me)),
        ("news_reads", _rows(db.news_reads, me)),
        ("stream_watches", _rows(db.stream_watches, me)),
        # Adventkalender (#641): welches Türchen wann geöffnet wurde - beim Quiz nur, dass mitgemacht wurde.
        ("advent_openings", _rows(db.advent_openings, me)),
        # Ostereiersuche (#646): welche Eier wann gefunden wurden und der Korb.
        ("easter_finds", _rows(db.easter_finds, me)),
        ("easter_progress", _rows(db.easter_progress, me)),
        # Verlosungen (#641): wo die Person mitmacht. Ein Gewinn steht bei ``prize_pickups``.
        ("raffle_entries", _rows(db.season_raffle_entries, me)),
        ("commendations_given", _rows(db.match_commendations, {"from_user_id": user_id})),
        ("season_points", _rows(db.season_points, me)),
        ("prize_pickups", _rows(db.prize_pickups, me)),
        ("notifications", _rows(db.notifications, me)),
        ("direct_messages", _rows(db.direct_messages, {"$or": [{"sender_id": user_id}, {"recipient_id": user_id}]},
                                  _direct_message(user_id))),
        ("friendships", _rows(db.friendships, {"$or": [{"requester_id": user_id}, {"recipient_id": user_id}]})),
        # Seit Fassung 5 nur, wen die Person blockiert hat - wer sie blockiert, erfährt sie auch sonst nicht.
        ("blocks", _rows(db.user_blocks, {"blocker_id": user_id})),
        ("moderation_reports", _rows(db.user_reports, {"$or": [{"reporter_id": user_id}, {"target_user_id": user_id}]},
                                     _report(user_id))),
        ("email_logs", _rows(db.email_logs, {"to": email})),
        ("mobile_devices", _rows(db.mobile_push_tokens, me, lambda row: _clean(row, "token"))),
        ("mobile_client_logs", _rows(db.mobile_client_logs, me)),
        ("audit_trail", _rows(db.audit_logs, {"$or": [{"actor_id": user_id}, {"target_id": user_id}]}, _audit_entry(user_id))),
        # Seit Fassung 3 (#928): was bisher weder in der Auskunft stand noch beim Löschen aufgeräumt wurde.
        ("xp", _value(lambda: one(db.user_xp, me))),
        ("xp_events", _rows(db.xp_events, me)),
        ("directory_profiles", _rows(db.club_member_profiles, me)),
        ("membership_applications", _rows(db.membership_applications, me)),
        ("membership_invitations", _rows(db.membership_invitations, me)),
        ("board_positions", _rows(db.board_positions, {"$or": [me, {"deputy_user_id": user_id}]})),
        ("tournament_staff", _rows(db.tournament_staff_assignments, me)),
        ("moderation_items", _rows(db.moderation_items, me)),
        ("discord_activity", _rows(db.discord_activity, me)),
        # Statistik je Server (#631): an welchen Tagen das Konto auf welchem Server geschrieben hat - höchstens 35 Tage zurück.
        ("discord_activity_servers", _rows(db.discord_guild_active, me)),
        ("discord_memberships", _rows(db.discord_memberships, me)),
        # Seit Fassung 4: der Einlass bei der Generalversammlung (#845) - die eigene Anwesenheit, und wo man als
        # Vorstand selbst eingelassen hat (nur der Vorgang, nie der Name der anderen Person).
        ("meeting_admissions", _rows(db.meeting_admissions, me,
                                     _pick("meeting_id", "name", "state", "voting", "reason", "arrived", "updated_at"))),
        ("meeting_admissions_recorded", _rows(db.meeting_admissions, {"by": user_id}, _pick("meeting_id", "state", "updated_at"))),
        ("uploads", _rows(db.media_uploads, {"owner_id": user_id}, _pick(*UPLOAD))),
        # Eingesandte Galerie-Fotos (#1186): Album, Stand, „Foto: Name“ gewünscht und wann eingewilligt - ohne Datei.
        ("gallery_submissions", _rows(db.gallery_submissions, {"owner_id": user_id}, _pick(*GALLERY_FIELDS))),
        # Seit Fassung 5 (#1030): alles, was services/personal_data.py als Daten über die Person führt.
        # Sitzungen mit Gerät, Browser und IP-Adresse - ohne die Kennungen der Anmeldetokens.
        ("sessions", _rows(db.auth_sessions, me, lambda row: _clean(row, "current_jti", "family_id"))),
        ("passkeys", _rows(db.passkeys, me, _pick("id", "name", "kind", "created_at", "last_used_at"))),
        ("access_links", _rows(db.access_links, {"$or": [me] + ([{"email": email}] if email else [])})),
        ("consent_decisions", _rows(db.consent_decisions, me)),
        ("chat_reads", _rows(db.chat_reads, me)),
        ("document_opens", _rows(db.document_opens, me)),
        ("year_review_notices", _rows(db.year_review_notices, me)),
        ("feedback_answered", _rows(db.feedback_receipts, me)),
        ("chat_messages", _chat_rows(db, user_id)),
        ("chat_attachments", _rows(db.chat_attachments, {"owner_id": user_id}, _pick(*ATTACHMENT))),
        ("moderation_strikes", _rows(db.moderation_strikes, me, lambda row: _clean(row, "moderator_id", "revoked_by"))),
        ("moderation_sanctions", _rows(db.moderation_sanctions, me, _sanction)),
        # Nur, was angemeldet geschrieben wurde: eine Anfrage ohne Konto lässt sich der Person nicht sicher zuordnen.
        ("contact_messages", _rows(db.contact_messages, me, lambda row: _clean(row, "internal_note", "answered_by"))),
        # Was die Verwaltung bei den Erfolgen für die Person vermerkt hat - ohne den Namen der Verwalterin.
        ("achievement_log", _rows(db.achievement_events, me, _pick("id", "kind", "at", "tier_code", "tier_name", "note"))),
        ("stickers", _rows(db.user_stickers, me)),
        ("stream_sessions", _rows(db.twitch_stream_sessions, me)),
        ("stream_announcements", _rows(db.tournament_stream_announcements, me)),
        ("dolibarr_links", _rows(db.dolibarr_links, me, lambda row: _clean(row, "member_key"))),
        ("dolibarr_identities", _rows(db.dolibarr_identities, me)),
        ("dolibarr_honours", _rows(db.dolibarr_honours, me)),
        ("billing_orders", _rows(db.billing_orders, me)),
        ("billing_customers", _rows(db.billing_customers, me)),
        ("match_reports", _rows(db.match_reports_v2, {"reporter_user_id": user_id})),
        ("schedule_proposals", _rows(db.match_schedule_proposals, {"actor_user_id": user_id}, _pick(*PROPOSAL))),
        ("match_proof_photos", _rows(db.match_proof_photos, {"owner_id": user_id}, _pick(*PROOF_PHOTO))),
        ("f1_staff", _rows(db.f1_staff_assignments, me)),
        ("season_standings", _rows(db.season_standings, me)),
        ("season_rank_history", _rows(db.season_rank_snapshots, me)),
        ("upload_events", _rows(db.upload_events, {"owner_id": user_id}, _pick(*UPLOAD_EVENT))),
    ]


def _json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def _dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, default=_json_default)


async def _stream(sections):
    """Die Auskunft als ein JSON-Objekt, Zeile für Zeile geschrieben - auch tausende Einträge je Liste."""
    yield b"{"
    for index, (key, (kind, make)) in enumerate(sections):
        yield f"{',' if index else ''}{_dumps(key)}:".encode()
        if kind == "value":
            yield _dumps(await make()).encode()
            continue
        yield b"["
        first = True
        async for row in make():
            yield f"{'' if first else ','}{_dumps(row)}".encode()
            first = False
        yield b"]"
    yield b"}"


async def _user_data_export(db, user_id: str) -> dict:
    """Die ganze Auskunft als ``dict`` - für Tests und Aufrufe im Haus; die Route streamt."""
    return json.loads(b"".join([chunk async for chunk in _stream(await _user_data_sections(db, user_id))]))


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
            "threads_handle": None, "facebook_handle": None, "linkedin_handle": None, "snapchat_handle": None, "pinterest_handle": None, "telegram_handle": None, "wargaming_handle": None, "bungie_handle": None, "mastodon_handle": None, "bluesky_handle": None,
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
                       db.passkeys, db.passkey_challenges, db.platform_links, db.platform_link_flows,
                       # Verhalten, das nur für die Erfolge gezählt wurde (#616, #678) - ohne Konto ohne Zweck.
                       # Das gegebene GG bleibt: es gehört zum Match wie das Ergebnis, und das Lob der anderen Seite
                       # soll nicht verschwinden, weil jemand sein Konto löscht.
                       db.user_signals, db.news_reads, db.stream_watches, db.user_achievement_stats, db.advent_openings,
                       db.easter_finds, db.easter_progress,
                       # Teilnahmen an Verlosungen: wer kein Konto mehr hat, kann nicht gewinnen.
                       db.season_raffle_entries):
        await collection.delete_many({"user_id": user_id})
    await db.friendships.delete_many({"$or": [{"requester_id": user_id}, {"recipient_id": user_id}]})
    await db.user_blocks.delete_many({"$or": [{"blocker_id": user_id}, {"blocked_id": user_id}]})
    await db.direct_messages.update_many({"sender_id": user_id}, {"$set": {"message": "[Nachricht gelöscht]", "sender_anonymized": True}})
    await db.team_chat_messages.update_many({"user_id": user_id}, {"$set": {"message": "[Nachricht gelöscht]", "author_anonymized": True}})
    await db.match_chat_messages.update_many({"user_id": user_id}, {"$set": {"message": "[Nachricht gelöscht]", "author_anonymized": True}})
    await db.tournament_chat_messages.update_many({"user_id": user_id}, {"$set": {"message": "[Nachricht gelöscht]", "author_anonymized": True}})
    from services.chat_attachments import delete_user_attachments
    await delete_user_attachments(db, user_id)
    # Fotos vom Ergebnis (#1157): Dateien und Einträge weg; Meldungen behalten nur die (dann tote) Kennung.
    from services.match_proofs import delete_for_user as delete_user_proofs
    await delete_user_proofs(db, user_id)
    # Eingesandte Galerie-Fotos (#1186): offene samt Dateien weg, „Foto: Name“ an freigegebenen weg.
    from services.event_photos import delete_for_user as delete_user_photo_submissions
    await delete_user_photo_submissions(db, user_id)
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
    # Alles außerhalb des Kontos (#928): Verzeichnis, Anträge, Anmeldungen, XP, Zugänge und die eigenen Bilder.
    erased = await account_erasure.erase_related(db, user, now)
    # Kontaktanfragen ohne Konto mit derselben Adresse bleiben unberührt (nicht sicher zuzuordnen) - die Zahl steht hier,
    # damit der Vorstand sie bei einem Löschwunsch per Hand prüfen kann.
    await db.audit_logs.insert_one({
        "id": new_id(), "action": action, "actor_id": actor_id, "target_id": user_id,
        "data": {"personal_data_removed": True, "unlinked_contact_messages": erased["unlinked_contact_messages"]}, "created_at": now,
    })


@dsgvo_router.get("/export-my-data")
async def export_my_data(me: dict = Depends(get_current_user)):
    sections = await _user_data_sections(get_db(), me["id"])
    return StreamingResponse(_stream(sections), media_type="application/json")


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
