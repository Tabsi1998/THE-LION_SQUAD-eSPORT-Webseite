"""Small helpers for in-app user notifications."""
import logging
import os
from typing import Any
from datetime import timedelta

from pymongo.errors import DuplicateKeyError

from database import get_db
from models import new_id, now_utc
from services.notification_preferences import (
    NOTIFICATION_KIND_CATEGORY, browser_allowed, discord_allowed, notification_allowed, notification_importance,
    notification_topic, push_allowed,
)
from services.log_safe import log_safe

logger = logging.getLogger("tls.notifications")


DEFAULT_COOLDOWN_SECONDS = {
    "match_reminder": 10 * 60,
    "match_station": 10 * 60,
    "tournament_checkin": 15 * 60,
    "tournament_chat_message": 2 * 60,
    "match_chat_message": 2 * 60,
    "team_chat_message": 2 * 60,
    "news_mention": 10 * 60,
    "membership_update": 10 * 60,
    # Kronen (#2126): schaltet jemand „Erfolge öffentlich“ hin und her, wechseln sie jedes Mal - höchstens eine Meldung je Art.
    "crown_gained": 6 * 60 * 60,
    "crown_changed": 6 * 60 * 60,
    "crown_lost": 6 * 60 * 60,
    "crown_onyx": 6 * 60 * 60,
}
NO_COOLDOWN_KINDS = {
    "direct_message",
    "match_chat_mention",
    "team_chat_mention",
    "tournament_chat_mention",
}
# Erfolge II (#622): Erfolge, Level und Prestige schicken höchstens drei Pushes am Tag (Wien) - der Rest steht im
# Postfach. Ein Paket ist schon eine Meldung (achievement_queue bündelt eine Minute).
# Gebündelter App-Push (#2553, Fabian 24.11.): scheitert die Anfrage an Expo, holt die Nachhol-Stufe den Push nach - höchstens so
# oft, danach gilt er als gescheitert (sonst versuchte es jede Minute endlos, wenn Expo weg ist). Frühestens nach dieser Pause.
PUSH_RETRY_LIMIT = 5
PUSH_RETRY_AFTER_SECONDS = 60
# Wer eine Meldung zum Senden beansprucht hat und dann abbricht, hält sie nur so lange - danach darf ein anderer Lauf.
PUSH_CLAIM_STALE_SECONDS = 300
ACHIEVEMENT_PUSH_KINDS = ("achievement", "level", "prestige")
ACHIEVEMENT_PUSH_DAILY_CAP = 3


def vienna_day_start(now=None) -> str:
    """Der Beginn des heutigen Tages in Wien, als UTC-Zeitstempel wie in ``created_at``."""
    from datetime import timezone
    from zoneinfo import ZoneInfo

    local = (now or now_utc()).astimezone(ZoneInfo("Europe/Vienna"))
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()


async def achievement_push_capped(db, user_id: str, kind: str, now=None) -> bool:
    """Hat diese Person heute schon drei Erfolgs-Pushes bekommen?"""
    if kind not in ACHIEVEMENT_PUSH_KINDS:
        return False
    sent = await db.notifications.count_documents({
        "user_id": user_id, "kind": {"$in": list(ACHIEVEMENT_PUSH_KINDS)},
        "created_at": {"$gte": vienna_day_start(now)},
        # App oder Browser (#1163): beides zählt als Push.
        "$or": [{"push_sent_count": {"$gt": 0}}, {"browser_sent_count": {"$gt": 0}}],
    })
    return sent >= ACHIEVEMENT_PUSH_DAILY_CAP


def with_topic(row: dict) -> dict:
    """Eine Zeile fürs Postfach (#1662): mit Thema und Wichtigkeit - ältere Zeilen ohne die Felder bekommen sie beim Lesen."""
    if row.get("topic") and row.get("importance"):
        return row
    kind, meta = str(row.get("kind") or ""), row.get("meta") or {}
    return {**row, "topic": row.get("topic") or notification_topic(kind, meta),
            "importance": row.get("importance") or notification_importance(kind, meta)}


async def build_public_url(path: str = "") -> str:
    """Build an absolute frontend URL for notification mails."""
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "domain": 1}) or {}
    base = (os.environ.get("FRONTEND_URL") or branding.get("domain") or "https://lionsquad.at").strip().rstrip("/")
    if base and not base.startswith(("http://", "https://")):
        base = "https://" + base
    base = base or "https://lionsquad.at"
    raw = str(path or "").strip()
    if raw.startswith(("http://", "https://")):
        return raw
    return f"{base}/{raw.lstrip('/')}" if raw else base


async def create_user_notification(
    user_id: str | None,
    title: str,
    body: str = "",
    url: str = "",
    kind: str = "general",
    meta: dict[str, Any] | None = None,
    push_batch: list[dict] | None = None,
) -> dict | None:
    """``push_batch`` (#2553): statt sofort an Expo kommt die Meldung in diese Liste - ``send_collected_pushes`` schickt
    sie dann gebündelt (bis zu 100 Nachrichten je Anfrage) und trägt ``push_sent_count`` nach."""
    if not user_id:
        return None
    db = get_db()
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "id": 1, "newsletter_consent": 1, "notification_preferences": 1, "quiet_hours": 1},
    )
    category = (meta or {}).get("category")
    in_app_allowed = (not user) or notification_allowed(user, kind, category)
    # `in_app_only`: nur ins Postfach - etwa eine Rücknahme (#622), die niemand per Push erfahren soll.
    in_app_only = bool((meta or {}).get("in_app_only"))
    # `no_push` / `no_browser`: ein Weg bleibt zu - etwa bei News nur für die Website bzw. nur für die App (#1532).
    push_channel_allowed = push_allowed(user, kind, category) and not in_app_only and not (meta or {}).get("no_push")
    # Browser-Benachrichtigungen (#1163): wie der App-Push, mit eigenem Kanal „Browser“.
    browser_channel_allowed = browser_allowed(user, kind, category) and not in_app_only and not (meta or {}).get("no_browser")
    if browser_channel_allowed:
        # Ohne angemeldeten Browser zählt der Kanal nicht - sonst entstünde für Personen ohne Browser-Anmeldung eine
        # unsichtbare Meldung, obwohl Postfach und Push aus sind.
        from services.web_push import has_browser_subscription
        browser_channel_allowed = await has_browser_subscription(db, user_id)
    # `no_discord`: Postfach und Push, aber keine Direktnachricht - etwa die Sammel-Nachricht der Neuberechnung (#2340).
    discord_channel_allowed = discord_allowed(user, kind, category) and not in_app_only and not (meta or {}).get("no_discord")
    if not in_app_allowed and not push_channel_allowed and not browser_channel_allowed and not discord_channel_allowed:
        return None
    meta = meta or {}
    # Ruhezeit (#1206): Push, Browser und Discord warten bis zum Ende der Ruhezeit, die Meldung liegt sofort in der Glocke.
    # Danach geht genau eine Sammelmeldung über die zurückgehaltenen Wege (services/quiet_hours.py) - Ausnahmen kommen sofort.
    held_until = None
    held_channels: list[str] = []
    if user and (push_channel_allowed or browser_channel_allowed or discord_channel_allowed):
        from services.quiet_hours import hold_until
        held_until = await hold_until(db, user, kind, meta)
    if held_until:
        # Discord nur, wenn diese Art überhaupt als Direktnachricht ginge (nie: Moderation, Rechnungen).
        from services.discord_dm import EXCLUDED_KINDS as NO_DM_KINDS
        held_channels = [name for name, allowed in (("push", push_channel_allowed), ("browser", browser_channel_allowed),
                                                    ("discord", discord_channel_allowed and kind not in NO_DM_KINDS)) if allowed]
        push_channel_allowed = browser_channel_allowed = discord_channel_allowed = False
        in_app_allowed = True
    dedupe_key = meta.get("dedupe_key")
    unique = bool(dedupe_key and meta.get("unique_dedupe"))
    if dedupe_key:
        # Liga-Erinnerungen (#1647): die Prüfung trifft den Teilindex ``user_unique_dedupe`` (Person + Schlüssel) - die übrigen
        # Arten fragen wie bisher nach Art und ``meta.dedupe_key``.
        existing = await db.notifications.find_one(
            {"user_id": user_id, "unique_dedupe_key": dedupe_key} if unique
            else {"user_id": user_id, "kind": kind, "meta.dedupe_key": dedupe_key},
            {"_id": 1},
        )
        if existing:
            return None
    # Liga-Erinnerungen (#1647) mit eindeutigem Schlüssel brauchen keine Abkühlzeit: Der Schlüssel hält Doppeltes auf, und die
    # Erinnerung eine Stunde vorher darf nicht an „Spiel startet in 10 Minuten“ eines anderen Laufs hängen bleiben.
    if kind not in NO_COOLDOWN_KINDS and not unique:
        cooldown_seconds = int(meta.get("cooldown_seconds") or DEFAULT_COOLDOWN_SECONDS.get(kind, 0) or 0)
        if cooldown_seconds > 0:
            cutoff = (now_utc() - timedelta(seconds=cooldown_seconds)).isoformat()
            cooldown_query: dict[str, Any] = {
                "user_id": user_id,
                "kind": kind,
                "created_at": {"$gte": cutoff},
                # Nur Zeilen ohne eindeutigen Schlüssel zählen (#1647, N3): „Liga-Spiel in 30 Minuten“ darf „Match startet in
                # 10 Minuten“ nicht unterdrücken.
                "unique_dedupe_key": {"$exists": False},
            }
            if category:
                cooldown_query["meta.category"] = category
            if meta.get("match_id"):
                cooldown_query["meta.match_id"] = meta["match_id"]
            elif meta.get("tournament_id"):
                cooldown_query["meta.tournament_id"] = meta["tournament_id"]
            recent = await db.notifications.find_one(cooldown_query, {"_id": 1})
            if recent:
                return None
    doc = {
        "id": new_id(),
        "user_id": user_id,
        "kind": kind,
        "title": title,
        "body": body,
        "url": url,
        "read": False,
        "in_app_visible": bool(in_app_allowed),
        # Benachrichtigungs-Zentrum (#1662): Glocke, App und Sammel-Mail gliedern danach. Ältere Zeilen ohne die Felder
        # rechnen ``with_topic`` beim Lesen nach - eine Migration gibt es nicht.
        "topic": notification_topic(kind, meta),
        "importance": notification_importance(kind, meta),
        "meta": meta,
        "created_at": now_utc().isoformat(),
    }
    if held_until:
        doc["quiet_hold_until"] = held_until
        doc["quiet_held_channels"] = held_channels
    if unique:
        # Liga-Erinnerungen (#1647): der Teilindex ``user_unique_dedupe`` lässt je Person und Schlüssel nur eine Zeile zu - laufen
        # zwei Jobs gleichzeitig, verliert der zweite hier und schickt weder Push noch Discord.
        doc["unique_dedupe_key"] = dedupe_key
    # Die Tagesgrenze der Erfolgs-Pushes (#622) gilt für App und Browser zusammen - vor dem Anlegen geprüft, damit die Zeile
    # schon beim Anlegen weiß, ob ihr Push gebündelt noch aussteht.
    capped = False
    if push_channel_allowed or browser_channel_allowed:
        try:
            capped = await achievement_push_capped(db, user_id, kind)
        except Exception:
            capped = False
    if capped:
        push_channel_allowed = False
        browser_channel_allowed = False
    batched = bool(push_channel_allowed and push_batch is not None)
    if batched:
        # Gebündelt (#2553): Der Push steht aus, bis ``send_collected_pushes`` ihn zugestellt hat - bricht der Lauf vorher ab,
        # findet die Nachhol-Stufe genau diese Zeilen. Von Ruhezeit oder Tagesgrenze gehaltene Pushes stehen nie aus.
        doc["push_pending"] = True
    try:
        await db.notifications.insert_one(doc)
    except DuplicateKeyError:
        return None
    doc.pop("_id", None)
    if in_app_allowed:
        # Only the recipient hears about it, and only that something is new. Ein Fehler beim Signal bricht die Meldung nicht ab
        # (#2553 K2) - sie steht schon in der Datenbank, und Push, Browser und Discord sollen trotzdem hinaus.
        try:
            from services.change_events import publish_user_change
            await publish_user_change([user_id], "notifications")
        except Exception:
            logger.warning("[notifications] Änderungs-Signal zu %s fehlgeschlagen", log_safe(doc["id"]), exc_info=True)
    if batched:
        # Gebündelt (#2553): Versand und ``push_sent_count`` übernimmt ``send_collected_pushes``.
        push_batch.append(doc)
    else:
        try:
            push_sent_count = 0
            if push_channel_allowed:
                from services.push_notifications import send_mobile_push_for_notification
                push_sent_count = await send_mobile_push_for_notification(doc)
            doc["push_sent_count"] = push_sent_count
            doc["push_sent_at"] = now_utc().isoformat()
            await db.notifications.update_one(
                {"id": doc["id"]},
                {"$set": {"push_sent_count": push_sent_count, "push_sent_at": doc["push_sent_at"]}},
            )
        except Exception:
            logger.warning("[push] Push zur Benachrichtigung %s fehlgeschlagen", log_safe(doc["id"]), exc_info=True)
    try:
        browser_sent = 0
        if browser_channel_allowed:
            from services.web_push import send_web_push_for_notification
            browser_sent = await send_web_push_for_notification(doc)
        doc["browser_sent_count"] = browser_sent
        if browser_sent:
            await db.notifications.update_one({"id": doc["id"]}, {"$set": {"browser_sent_count": browser_sent}})
    except Exception:
        logger.warning("[web-push] Browser-Push zur Benachrichtigung %s fehlgeschlagen", log_safe(doc["id"]), exc_info=True)
        doc.setdefault("browser_sent_count", 0)
    # Discord als persönlicher Kanal (#567): Direktnachricht vom Bot - nur mit Opt-in und verknüpftem Konto.
    try:
        discord_sent = 0
        if discord_channel_allowed:
            from services.discord_dm import send_discord_dm_for_notification
            discord_sent = await send_discord_dm_for_notification(doc, category or NOTIFICATION_KIND_CATEGORY.get(kind))
        doc["discord_sent_count"] = discord_sent
        await db.notifications.update_one({"id": doc["id"]}, {"$set": {"discord_sent_count": discord_sent}})
    except Exception:
        doc.setdefault("discord_sent_count", 0)
    return doc


async def send_collected_pushes(batch: list[dict]) -> int:
    """Schickt die über ``push_batch`` gesammelten Meldungen gebündelt an Expo (#2553) und leert die Liste. Rückgabe: Zahl
    der Geräte.

    Vor dem Senden wird jede Zeile beansprucht (K1): nur, wessen Kennung danach an der Zeile steht, schickt. So schicken der
    Hauptweg und die Nachhol-Stufe eines zweiten Laufs dieselbe Meldung nie beide. Danach:

    - zugestellt (auch an 0 Geräte, etwa ohne gültiges Gerät): ``push_sent_count``, ``push_sent_at``, der Push steht nicht mehr aus;
    - gescheitert (Fabian 24.11., F1): die Zeile bleibt offen und wird frühestens nach ``PUSH_RETRY_AFTER_SECONDS`` nachgeholt,
      nach ``PUSH_RETRY_LIMIT`` Versuchen gilt sie als gescheitert (``push_failed``, 0 Geräte).
    """
    if not batch:
        return 0
    docs = list(batch)
    batch.clear()
    db = get_db()
    claim = new_id()
    moment = now_utc()
    stamp = moment.isoformat()
    stale = (moment - timedelta(seconds=PUSH_CLAIM_STALE_SECONDS)).isoformat()
    ids = [doc["id"] for doc in docs]
    await db.notifications.update_many(
        {"id": {"$in": ids}, "push_pending": True,
         "$or": [{"push_claim": {"$exists": False}}, {"push_claimed_at": {"$lt": stale}}]},
        {"$set": {"push_claim": claim, "push_claimed_at": stamp}},
    )
    mine = set(await db.notifications.distinct("id", {"id": {"$in": ids}, "push_claim": claim}))
    docs = [doc for doc in docs if doc["id"] in mine]
    if not docs:
        return 0
    try:
        from services.push_notifications import send_mobile_push_batch
        counts = await send_mobile_push_batch(docs)
    except Exception:
        logger.warning("[push] Gebündelter Push für %s Meldungen fehlgeschlagen", len(docs), exc_info=True)
        counts = {doc["id"]: None for doc in docs}
    by_count: dict[int, list[str]] = {}
    failed: list[str] = []
    for doc in docs:
        value = counts.get(doc["id"], 0)
        if value is None:
            failed.append(doc["id"])
            continue
        doc["push_sent_count"] = int(value or 0)
        doc["push_sent_at"] = stamp
        by_count.setdefault(doc["push_sent_count"], []).append(doc["id"])
    done_unset = {"push_pending": "", "push_claim": "", "push_claimed_at": "", "push_retry_at": ""}
    for sent, done in by_count.items():
        await db.notifications.update_many({"id": {"$in": done}, "push_claim": claim},
                                           {"$set": {"push_sent_count": sent, "push_sent_at": stamp}, "$unset": done_unset})
    if failed:
        retry_at = (moment + timedelta(seconds=PUSH_RETRY_AFTER_SECONDS)).isoformat()
        await db.notifications.update_many({"id": {"$in": failed}, "push_claim": claim},
                                           {"$set": {"push_retry_at": retry_at}, "$unset": {"push_claim": "", "push_claimed_at": ""},
                                            "$inc": {"push_attempts": 1}})
        await db.notifications.update_many(
            {"id": {"$in": failed}, "push_pending": True, "push_attempts": {"$gte": PUSH_RETRY_LIMIT}},
            {"$set": {"push_sent_count": 0, "push_sent_at": stamp, "push_failed": True}, "$unset": done_unset})
    return sum(int(value or 0) for value in counts.values() if value is not None)
