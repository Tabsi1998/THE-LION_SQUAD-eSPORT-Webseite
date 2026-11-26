"""Ruhezeit (#1206): von–bis in Wiener Zeit, Standard aus; beim Einschalten vorgeschlagen 22:00 bis 7:00.

In der Ruhezeit geht kein Push aufs Handy, keine Browser-Meldung (#1163) und keine Discord-Direktnachricht (#567) hinaus.
Die Benachrichtigung entsteht trotzdem und liegt in der Glocke - zurückgehalten, nicht verworfen: Sie trägt
``quiet_hold_until`` (Ende der Ruhezeit, UTC) und ``quiet_held_channels`` (die Wege, die sie genommen hätte). Nach dem Ende
schickt der Job ``quiet_digest`` genau eine Sammelmeldung („In der Nacht: 4 Meldungen“) über diese Wege - nur, wenn noch
etwas ungelesen ist. E-Mail bleibt unverändert.

Ausnahmen, die auch in der Ruhezeit sofort kommen:

- ``match_call``: Aufruf zum eigenen Spiel (#1137) - dieselbe Art tragen in der Liga „Check-in offen“ fürs eigene Spiel und
  „Veto – ihr seid am Zug“ (D.2, D.3).
- ``match_station`` und die Liga-Meldung ``match_schedule`` mit Grund ``checkin_started``: „Match startet jetzt“.
- ``match_attention`` für die Turnierleitung (#1160), solange ihr Turnier läuft (Check-in, live, Pause) - nicht bei
  Liga-Staffeln: deren Leitungs-Meldungen (Verfahren, Fristen) haben Tage Zeit, die Sammelmeldung am Morgen reicht.

Doppelt geht nichts, verschluckt wird nichts (``release_due``):

- Je Person und Freigabe ein fester Schlüssel ``quiet_digest:<id der ältesten zurückgehaltenen Zeile>`` - zwei Läufe zur
  selben Zeit rechnen denselben, und der Teilindex ``user_unique_dedupe`` lässt nur eine Sammelmeldung zu.
- Versenden darf nur, wer die Sammelmeldung vorher für sich beansprucht (``quiet_claimed_at``); erst nach dem Versand steht
  ``quiet_delivered`` - und nur, solange der Anspruch noch der eigene ist. Bricht ein Lauf vor dem Versand ab, holt ein
  späterer ihn nach (Anspruch verfällt nach ``CLAIM_SECONDS``; Discord wartet höchstens ``DISCORD_TIMEOUT_SECONDS``).
- Eine Sammelmeldung deckt die Zeilen bis ``meta.covers_until`` (``created_at`` der neuesten) - freigegeben werden genau
  diese, über alle Zeilen der Person, nicht nur die gelesene Charge. Wer eine schon angelegte Sammelmeldung vorfindet,
  übernimmt ihre Abgrenzung.
- Ist die Person wieder still, bevor eine angelegte Sammelmeldung hinausging, wird sie verworfen und die Zeilen warten auf
  die nächste Freigabe; ging sie schon hinaus, werden ihre Zeilen freigegeben, neuere warten.

Der Push-Test der Verwaltung (``admin_push_test``) ist ebenfalls eine Ausnahme.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services import quiet_hours_rules as rules
from services.log_safe import log_safe
from services.quiet_hours_rules import ACTIVE_TOURNAMENT_STATUSES, EXEMPT_KINDS, crosses_midnight

logger = logging.getLogger("tls.quiet_hours")

DIGEST_KIND = "quiet_digest"
DIGEST_URL = "/notifications"
HELD_CHANNELS = ("push", "browser", "discord")
# So viele zurückgehaltene Zeilen liest ein Lauf je Person für Text und Wege der Sammelmeldung - gezählt und freigegeben
# werden immer alle Zeilen der Person.
RELEASE_BATCH = 2000
# So lange gilt der Anspruch eines Laufs auf den Versand einer Sammelmeldung; danach darf ein anderer Lauf nachholen.
CLAIM_SECONDS = 600
# Die Direktnachricht wartet höchstens so lange auf Discord - ein Lauf darf nie über ``CLAIM_SECONDS`` hängen.
DISCORD_TIMEOUT_SECONDS = 30


def quiet_until(user: dict | None, now: datetime | None = None) -> datetime | None:
    """Siehe ``quiet_hours_rules.quiet_until`` - hier mit der Uhr des Servers (in Tests verstellbar)."""
    return rules.quiet_until(user, now or now_utc())


# Zeitkritisches (Absage, neuer Termin, Nachrücken) kommt in der Ruhezeit sofort, wenn sein Termin noch bevorsteht und spätestens
# so lange nach dem Ende der Ruhezeit beginnt (Fabians Nr. 267: „vor 9 Uhr“ bei Ruhezeit bis 7 Uhr) - sonst nach der Ruhezeit.
TIMELY_GRACE_HOURS = 2


def _timely_now(meta: dict, until: datetime | None, now: datetime | None = None) -> bool:
    """``jetzt <= Termin < Ende der Ruhezeit + 2 Stunden``. Ein vergangener Termin weckt niemanden."""
    if not until or not meta.get("starts_at"):
        return False
    from datetime import timedelta
    from zoneinfo import ZoneInfo
    try:
        starts = datetime.fromisoformat(str(meta["starts_at"]).replace("Z", "+00:00"))
    except ValueError:
        return False
    if starts.tzinfo is None:
        starts = starts.replace(tzinfo=ZoneInfo("Europe/Vienna"))
    now = now or now_utc()
    return now <= starts < until + timedelta(hours=TIMELY_GRACE_HOURS)


async def is_exempt(db, kind: str, meta: dict | None, until: datetime | None = None, now: datetime | None = None) -> bool:
    """Kommt diese Meldung auch in der Ruhezeit sofort? Siehe Modulbeschreibung. ``until``: Ende der Ruhezeit."""
    meta = meta or {}
    from services.notification_preferences import notification_timely
    if notification_timely(kind, meta) and _timely_now(meta, until, now):
        return True
    if kind in EXEMPT_KINDS:
        return True
    # Dringendes kommt trotzdem (#1662): die Wichtigkeit der Meldung - auch „Match startet jetzt“ der Liga (checkin_started).
    from services.notification_preferences import notification_importance
    if notification_importance(kind, meta) == "urgent":
        return True
    if kind == "match_attention" and meta.get("tournament_id"):
        tournament = await db.tournaments.find_one(
            {"id": meta["tournament_id"]}, {"_id": 0, "status": 1, "league_context": 1},
        )
        if not tournament or isinstance(tournament.get("league_context"), dict):
            return False
        return tournament.get("status") in ACTIVE_TOURNAMENT_STATUSES
    return False


async def hold_until(db, user: dict | None, kind: str, meta: dict | None, now: datetime | None = None) -> str | None:
    """Ende der Ruhezeit als UTC-Zeitstempel, wenn diese Meldung zurückgehalten wird - sonst ``None``."""
    until = quiet_until(user, now)
    if until is None or await is_exempt(db, kind, meta, until, now):
        return None
    return until.isoformat()


def digest_title(count: int, night: bool) -> str:
    what = "1 Meldung" if count == 1 else f"{count} Meldungen"
    return f"In der Nacht: {what}" if night else f"In deiner Ruhezeit: {what}"


def digest_body(rows: list[dict]) -> str:
    """Nur die Themen und wie viele - keine fremden Nachrichtentexte."""
    from services.notification_preferences import NOTIFICATION_KIND_CATEGORY, OPTIONAL_EMAIL_PREFERENCES

    counts: dict[str, int] = {}
    for row in rows:
        topic = (row.get("meta") or {}).get("category") or NOTIFICATION_KIND_CATEGORY.get(str(row.get("kind") or ""))
        label = (OPTIONAL_EMAIL_PREFERENCES.get(topic) or {}).get("label") or "Sonstiges"
        counts[label] = counts.get(label, 0) + 1
    parts = [f"{label} {count}" for label, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))]
    return " · ".join(parts[:4]) + " – alles liegt in der Glocke."


def _held(user_id: str, extra: dict | None = None) -> dict:
    return {"user_id": user_id, "quiet_hold_until": {"$exists": True}, **(extra or {})}


_ROW_FIELDS = {"_id": 0, "id": 1, "kind": 1, "read": 1, "meta": 1, "created_at": 1, "quiet_hold_until": 1, "quiet_held_channels": 1}


async def _edge_row(db, user_id: str, direction: int) -> dict | None:
    """Die älteste (1) bzw. neueste (-1) zurückgehaltene Zeile der Person."""
    rows = await db.notifications.find(_held(user_id), _ROW_FIELDS).sort([("created_at", direction), ("id", direction)]).to_list(1)
    return rows[0] if rows else None


async def _create_digest(db, user: dict, key: str, covers: str, until: str, unread: list[dict], total: int) -> dict:
    """Die Sammelmeldung anlegen - gibt es sie unter dem Schlüssel schon (paralleler Lauf), die vorhandene."""
    doc = {
        "id": new_id(),
        "user_id": user["id"],
        "kind": DIGEST_KIND,
        "title": digest_title(total, crosses_midnight(user)),
        "body": digest_body(unread),
        "url": DIGEST_URL,
        # Die Meldungen selbst liegen schon in der Glocke - die Sammelmeldung nicht noch einmal.
        "read": True,
        "in_app_visible": False,
        "meta": {"dedupe_key": key, "count": total, "quiet_until": until, "covers_until": covers},
        "unique_dedupe_key": key,
        "quiet_delivered": False,
        "created_at": now_utc().isoformat(),
    }
    try:
        await db.notifications.insert_one(doc)
    except DuplicateKeyError:
        return await db.notifications.find_one({"user_id": user["id"], "unique_dedupe_key": key}, {"_id": 0}) or {}
    doc.pop("_id", None)
    return doc


async def _deliver(db, user: dict, digest: dict, channels: set[str], now: datetime) -> bool:
    """Die Sammelmeldung über die zurückgehaltenen Wege schicken - nur, wer sie vorher beansprucht hat. ``False``: ein anderer
    Lauf schickt gerade."""
    from datetime import timedelta

    from services.notification_preferences import browser_allowed, discord_allowed, push_allowed

    stale = (now - timedelta(seconds=CLAIM_SECONDS)).isoformat()
    claim = await db.notifications.update_one(
        {"id": digest["id"], "quiet_delivered": False,
         "$or": [{"quiet_claimed_at": {"$exists": False}}, {"quiet_claimed_at": {"$lt": stale}}]},
        {"$set": {"quiet_claimed_at": now.isoformat()}},
    )
    if not int(getattr(claim, "modified_count", 0) or 0):
        return False
    sent: dict[str, int] = {}
    if "push" in channels and push_allowed(user, DIGEST_KIND):
        try:
            from services.push_notifications import send_mobile_push_for_notification
            sent["push_sent_count"] = await send_mobile_push_for_notification(digest)
        except Exception:  # ein Weg hält die anderen nicht auf
            logger.warning("[quiet] Sammel-Push %s fehlgeschlagen", log_safe(digest["id"]), exc_info=True)
    if "browser" in channels and browser_allowed(user, DIGEST_KIND):
        try:
            from services.web_push import send_web_push_for_notification
            sent["browser_sent_count"] = await send_web_push_for_notification(digest)
        except Exception:
            logger.warning("[quiet] Sammel-Browser-Push %s fehlgeschlagen", log_safe(digest["id"]), exc_info=True)
    if "discord" in channels and discord_allowed(user, DIGEST_KIND):
        try:
            from services.discord_dm import send_discord_dm_for_notification
            sent["discord_sent_count"] = await asyncio.wait_for(send_discord_dm_for_notification(digest, None), DISCORD_TIMEOUT_SECONDS)
        except Exception:
            logger.warning("[quiet] Sammel-Direktnachricht %s fehlgeschlagen", log_safe(digest["id"]), exc_info=True)
    # Nur mit dem eigenen Anspruch als verschickt markieren - hat ein anderer Lauf ihn inzwischen übernommen, schließt der ab.
    done = await db.notifications.update_one({"id": digest["id"], "quiet_claimed_at": now.isoformat()},
                                             {"$set": {**sent, "quiet_delivered": True}})
    return bool(int(getattr(done, "modified_count", 0) or 0))


async def _release(db, user_id: str, covers: str, now_iso: str) -> int:
    """Alle zurückgehaltenen Zeilen der Person bis ``covers`` (``created_at``) freigeben - nicht nur die gelesene Charge."""
    result = await db.notifications.update_many(
        _held(user_id, {"created_at": {"$lte": covers}}),
        {"$unset": {"quiet_hold_until": "", "quiet_held_channels": ""}, "$set": {"quiet_released_at": now_iso}},
    )
    return int(getattr(result, "modified_count", 0) or 0)


async def _digest_for(db, user_id: str, oldest: dict) -> tuple[str, dict | None]:
    key = f"{DIGEST_KIND}:{oldest['id']}"
    return key, await db.notifications.find_one({"user_id": user_id, "unique_dedupe_key": key}, {"_id": 0})


async def _settle_quiet(db, user_id: str, until: str, now: datetime, counts: dict) -> None:
    """Die Person ist (wieder) still: Was eine schon verschickte Sammelmeldung deckt, wird freigegeben; eine angelegte, aber
    nie verschickte wird verworfen; alles Übrige bekommt das jetzige Ende."""
    from datetime import timedelta

    oldest = await _edge_row(db, user_id, 1)
    if oldest:
        _key, digest = await _digest_for(db, user_id, oldest)
        if digest and digest.get("quiet_delivered"):
            counts["released"] += await _release(db, user_id, (digest.get("meta") or {}).get("covers_until") or "", now.isoformat())
        elif digest:
            stale = (now - timedelta(seconds=CLAIM_SECONDS)).isoformat()
            await db.notifications.delete_one(
                {"id": digest["id"], "quiet_delivered": False,
                 "$or": [{"quiet_claimed_at": {"$exists": False}}, {"quiet_claimed_at": {"$lt": stale}}]})
    result = await db.notifications.update_many(_held(user_id, {"quiet_hold_until": {"$exists": True, "$ne": until}}),
                                                {"$set": {"quiet_hold_until": until}})
    counts["restamped"] += int(getattr(result, "modified_count", 0) or 0)


async def release_due(db, now: datetime | None = None) -> dict[str, int]:
    """Zurückgehaltene Meldungen freigeben, sobald die Person nicht mehr still ist - je Person und Freigabe genau eine
    Sammelmeldung (siehe Modulbeschreibung).

    Je Person, nicht je altem Ende: Wer die Ruhezeit verlängert oder den Job über zwei Nächte verpasst, bekommt trotzdem nur
    eine Sammelmeldung. Ist die Person gerade still, bekommen ihre Zeilen das neue Ende (umstempeln) - so blockieren sie
    nichts. Wer die Ruhezeit ausschaltet oder verkürzt, bekommt seine Meldungen beim nächsten Lauf."""
    now = now or now_utc()
    now_iso = now.isoformat()
    counts = {"released": 0, "digests": 0, "restamped": 0}
    user_ids = sorted(await db.notifications.distinct("user_id", {"quiet_hold_until": {"$exists": True}}))
    for user_id in user_ids:
        user = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, "id": 1, "newsletter_consent": 1, "notification_preferences": 1, "quiet_hours": 1},
        )
        still = quiet_until(user, now) if user else None
        if still is not None:
            await _settle_quiet(db, user_id, still.isoformat(), now, counts)
            continue
        # Höchstens zwei Runden: Hat ein abgebrochener Lauf die Sammelmeldung zu den ältesten Zeilen schon verschickt, werden
        # erst diese Zeilen freigegeben - neuere bekommen danach ihre eigene.
        for _round in range(2):
            oldest = await _edge_row(db, user_id, 1)
            if not oldest:
                break
            key, digest = await _digest_for(db, user_id, oldest)
            if digest and digest.get("quiet_delivered"):
                counts["released"] += await _release(db, user_id, (digest.get("meta") or {}).get("covers_until") or "", now_iso)
                continue
            newest = await _edge_row(db, user_id, -1)
            covers = str((digest or {}).get("meta", {}).get("covers_until") or (newest or oldest).get("created_at") or "")
            scope = _held(user_id, {"created_at": {"$lte": covers}})
            rows = await db.notifications.find(scope, _ROW_FIELDS).sort([("created_at", 1), ("id", 1)]).to_list(RELEASE_BATCH)
            unread = [row for row in rows if not row.get("read")]
            channels = {channel for row in unread for channel in (row.get("quiet_held_channels") or []) if channel in HELD_CHANNELS}
            total = await db.notifications.count_documents({**scope, "read": {"$ne": True}})
            if digest is None and user and total and channels:
                latest = max(str(row.get("quiet_hold_until") or "") for row in rows)
                digest = await _create_digest(db, user, key, covers, latest, unread, total)
                # Hat ein paralleler Lauf sie schon angelegt, gilt seine Abgrenzung - sonst gäbe dieser Lauf Zeilen frei, die
                # in keiner Sammelmeldung stehen.
                covers = str((digest.get("meta") or {}).get("covers_until") or covers)
            if digest and not digest.get("quiet_delivered") and user:
                if not await _deliver(db, user, digest, channels, now):
                    # Ein anderer Lauf schickt gerade - er gibt auch frei. Bricht er ab, holt ein späterer Lauf nach.
                    break
                counts["digests"] += 1
            counts["released"] += await _release(db, user_id, covers, now_iso)
            break
    return counts
