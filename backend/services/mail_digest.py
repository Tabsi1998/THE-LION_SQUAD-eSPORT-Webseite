"""Sammel-Mail (#1662): statt vieler Einzelmails eine Mail am Tag oder in der Woche.

Je Person ein Rhythmus (``users.mail_digest``): ``instant`` (jede Mail sofort, wie bisher), ``daily`` oder ``weekly``. Fehlt er,
gilt die Vorgabe der Verwaltung (``settings`` mit ``id = notification_digest``: Rhythmus, Uhrzeit täglich, Wochentag und
Uhrzeit wöchentlich, Wiener Zeit). Ohne Entscheidung bleibt alles wie bisher („sofort“).

Sammeln (``hold``): ``send_user_template`` legt optionale Mails einer Person mit Sammel-Rhythmus nicht in die Warteschlange,
sondern als Zeile in ``mail_digest_items`` ab - mit Betreff, einer Zeile Vorschau und Link. Nie gesammelt wird, was nicht warten
kann oder schon selbst ein Gruß bzw. eine Zusammenfassung ist (``collectable``): Pflichtmails (Konto, Mitgliedschafts-
Entscheidungen), Dringendes (Spiel in 10 Minuten, Check-in schließt, Ergebnis bestätigen, Dispute) und alles, was beim Aufruf
``importance="urgent"`` sagt.

Versand (``send_due``, Job alle 10 Minuten): Je Person ist der Zeitraum der zuletzt begonnene Termin (``last_slot``). Was davor
gesammelt wurde, geht in genau eine Mail; was danach kam, wartet auf den nächsten Termin. Doppelt geht nichts hinaus:

- Zuerst beansprucht ein Lauf den Zeitraum (``mail_digest_runs``, eindeutig je Person und Zeitraum). Wer verliert, schickt
  nicht. Bricht der Gewinner ab, darf nach ``CLAIM_SECONDS`` ein anderer Lauf übernehmen - mit denselben Zeilen.
- Die Zeilen tragen danach die Kennung des Laufs (``digest_id``); eingereiht wird mit ``dedupe_key = mail_digest:<lauf>``,
  dem eindeutigen Schlüssel der Warteschlange - auch ein übernommener Lauf reiht nicht zweimal ein.

Sichtbarkeit: Beim Versand wird jede Zeile neu geprüft - Konto aktiv und nicht gesperrt, Thema per Mail noch an, Vereins-
internes nur für Mitglieder. Was nicht mehr passt, fällt still heraus (``dropped``). Jede Zeile gehört genau einer Person; die
Mail enthält nur ihre Zeilen. Am Ende stehen ein Link zu den Einstellungen und der Hinweis, wie man zurück auf Einzelmails
stellt.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services.log_safe import log_safe

logger = logging.getLogger("tls.mail_digest")

VIENNA = ZoneInfo("Europe/Vienna")
SETTINGS_ID = "notification_digest"
DIGEST_TEMPLATE = "notification_digest"
RHYTHMS: tuple[str, ...] = ("instant", "daily", "weekly")
RHYTHM_LABELS = {"instant": "Sofort", "daily": "Täglich", "weekly": "Wöchentlich"}
WEEKDAYS = ("Montags", "Dienstags", "Mittwochs", "Donnerstags", "Freitags", "Samstags", "Sonntags")
DEFAULTS: dict[str, Any] = {"default_rhythm": "instant", "daily_time": "07:00", "weekly_weekday": 0, "weekly_time": "07:00"}
# Kann nicht warten: Spiel in 10 Minuten, Erinnerung vor dem Spiel, Check-in schließt, Ergebnis bestätigen, Dispute offen.
URGENT_TEMPLATES = frozenset({
    "match_lead_10m", "match_reminder", "checkin_closes_soon", "checkin_closes_soon_on_site", "score_reported", "dispute_opened",
})
# Schon selbst ein Gruß bzw. eine Zusammenfassung - und die Newsletter mit eigenem Abmeldeweg.
OWN_FORMAT_TEMPLATES = frozenset({"birthday_greeting", "achievement_recap", "newsletter_news", "newsletter_event", DIGEST_TEMPLATE})
PREVIEW_FIELDS = ("text", "detail", "summary", "message", "preview", "decision", "reason", "when")
PREVIEW_MAX = 200
CLAIM_SECONDS = 600
# Verschickte und herausgefallene Zeilen und abgeschlossene Läufe bleiben so lange (Nachfragen), dann räumt ``send_due`` auf.
KEEP_DAYS = 90
SETTINGS_PATH = "/profile?tab=notifications&bereich=mail"
MEMBER_STATUSES = ("active", "honorary")


# ---------------------------------------------------------------- Regeln ohne Datenbank

def _clock(value: Any) -> str | None:
    from services.quiet_hours_rules import parse_time

    return str(value).strip() if parse_time(value) is not None else None


def normalized_settings(raw: dict | None) -> dict[str, Any]:
    """Die Vorgaben der Verwaltung - Ungültiges fällt auf den Standard zurück."""
    raw = raw or {}
    weekday = raw.get("weekly_weekday")
    return {
        "default_rhythm": raw.get("default_rhythm") if raw.get("default_rhythm") in RHYTHMS else DEFAULTS["default_rhythm"],
        "daily_time": _clock(raw.get("daily_time")) or DEFAULTS["daily_time"],
        "weekly_weekday": weekday if isinstance(weekday, int) and not isinstance(weekday, bool) and 0 <= weekday <= 6
        else DEFAULTS["weekly_weekday"],
        "weekly_time": _clock(raw.get("weekly_time")) or DEFAULTS["weekly_time"],
    }


def rhythm_of(user: dict | None, cfg: dict) -> str:
    own = (user or {}).get("mail_digest")
    return own if own in RHYTHMS else cfg["default_rhythm"]


def collectable(template_key: str, importance: str | None = None) -> bool:
    """Darf diese Mail in die Sammlung? Nie: Pflicht, Dringendes, eigene Formate."""
    from services.notification_preferences import REQUIRED_EMAIL_TEMPLATES

    if importance == "urgent":
        return False
    return template_key not in REQUIRED_EMAIL_TEMPLATES and template_key not in URGENT_TEMPLATES \
        and template_key not in OWN_FORMAT_TEMPLATES


def _at(day, clock: str) -> datetime:
    hours, minutes = (int(part) for part in clock.split(":"))
    return datetime(day.year, day.month, day.day, hours, minutes, tzinfo=VIENNA).astimezone(timezone.utc)


def last_slot(rhythm: str, cfg: dict, now: datetime) -> datetime:
    """Der zuletzt begonnene Termin (UTC) - täglich zur Uhrzeit, wöchentlich am Wochentag zur Uhrzeit, Wiener Zeit."""
    today = now.astimezone(VIENNA).date()
    if rhythm == "weekly":
        day = today - timedelta(days=(today.weekday() - cfg["weekly_weekday"]) % 7)
        slot = _at(day, cfg["weekly_time"])
        return slot if slot <= now else _at(day - timedelta(days=7), cfg["weekly_time"])
    slot = _at(today, cfg["daily_time"])
    return slot if slot <= now else _at(today - timedelta(days=1), cfg["daily_time"])


def period_key(rhythm: str, slot: datetime) -> str:
    return f"{rhythm}:{slot.astimezone(VIENNA).date().isoformat()}"


def schedule_text(rhythm: str, cfg: dict) -> str:
    if rhythm == "daily":
        return f"Täglich um {cfg['daily_time']} Uhr"
    if rhythm == "weekly":
        return f"{WEEKDAYS[cfg['weekly_weekday']]} um {cfg['weekly_time']} Uhr"
    return "Jede Mail sofort"


def preview_line(values: dict) -> str:
    """Eine Zeile Vorschau aus den Werten der Mail - der erste Text, Leerraum zusammengefasst, höchstens 200 Zeichen."""
    for field in PREVIEW_FIELDS:
        value = values.get(field)
        if isinstance(value, str) and value.strip():
            text = " ".join(value.split())
            return text if len(text) <= PREVIEW_MAX else text[:PREVIEW_MAX - 1].rstrip() + "…"
    return ""


def settings_payload(user: dict | None, cfg: dict) -> dict:
    """Für die Einstellungen der Person."""
    own = (user or {}).get("mail_digest")
    return {
        "rhythm": rhythm_of(user, cfg),
        "own": own if own in RHYTHMS else None,
        "default": cfg["default_rhythm"],
        "options": [{"key": key, "label": RHYTHM_LABELS[key], "schedule": schedule_text(key, cfg)} for key in RHYTHMS],
    }


# ---------------------------------------------------------------- Datenbank

async def load_settings(db) -> dict:
    return normalized_settings(await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}))


async def hold(user: dict, template_key: str, category: str | None, values: dict) -> dict | None:
    """Die Mail sammeln statt einreihen - ``None``: geht wie bisher sofort. Gleicher ``dedupe_key``: nur einmal gesammelt."""
    from database import get_db
    from email_service import render_named

    db = get_db()
    cfg = await load_settings(db)
    if "mail_digest" not in user:
        # Viele Aufrufer lesen das Konto mit schmaler Projektion - der Rhythmus wird dann hier nachgelesen.
        stored = await db.users.find_one({"id": user["id"]}, {"_id": 0, "mail_digest": 1}) or {}
        user = {**user, "mail_digest": stored.get("mail_digest")}
    if rhythm_of(user, cfg) == "instant":
        return None
    template_values = {key: value for key, value in values.items() if key not in ("dedupe_key", "mail_meta", "mail_headers")}
    rendered = await render_named(template_key, **template_values)
    if rendered is None:
        return None
    dedupe_key = values.get("dedupe_key") or None
    item = {
        "id": new_id(),
        "user_id": user["id"],
        "template_key": template_key,
        "category": category,
        "subject": rendered[0],
        "preview": preview_line(template_values),
        "url": str(template_values.get("url") or ""),
        "created_at": now_utc().isoformat(),
        **({"dedupe_key": dedupe_key} if dedupe_key else {}),
    }
    if dedupe_key and await db.mail_digest_items.find_one({"user_id": user["id"], "dedupe_key": dedupe_key}, {"_id": 1}):
        return {"ok": True, "digest": True, "deduped": True}
    try:
        await db.mail_digest_items.insert_one(dict(item))
    except DuplicateKeyError:
        return {"ok": True, "digest": True, "deduped": True}
    return {"ok": True, "digest": True, "id": item["id"]}


async def claim_run(db, user_id: str, key: str, now: datetime, cutoff: str | None = None) -> dict | None:
    """Den Zeitraum für diesen Lauf beanspruchen - ``None``: schon verschickt oder ein anderer Lauf ist dran. ``cutoff``: bis
    wann gesammelte Zeilen dazugehören (steht am Lauf, damit eine Übernahme dieselbe Grenze nimmt)."""
    run = {"id": new_id(), "user_id": user_id, "period": key, "status": "claimed", "claimed_at": now.isoformat(),
           "cutoff": cutoff or now.isoformat(), "created_at": now.isoformat()}
    try:
        await db.mail_digest_runs.insert_one(dict(run))
        # Ohne den eindeutigen Index (Testdatenbank im Speicher) könnte ein zweiter Lauf eingefügt haben: Es gilt der erste.
        first = await db.mail_digest_runs.find({"user_id": user_id, "period": key}, {"_id": 0, "id": 1}) \
            .sort([("created_at", 1), ("id", 1)]).to_list(1)
        if first and first[0]["id"] == run["id"]:
            return run
        await db.mail_digest_runs.delete_one({"id": run["id"]})
    except DuplicateKeyError:
        pass
    existing = await db.mail_digest_runs.find_one({"user_id": user_id, "period": key}, {"_id": 0})
    if not existing or existing.get("status") == "sent":
        return None
    stale = (now - timedelta(seconds=CLAIM_SECONDS)).isoformat()
    if str(existing.get("claimed_at") or "") >= stale:
        return None
    taken = await db.mail_digest_runs.update_one(
        {"id": existing["id"], "status": "claimed", "claimed_at": existing.get("claimed_at")},
        {"$set": {"claimed_at": now.isoformat()}},
    )
    return {**existing, "claimed_at": now.isoformat()} if int(getattr(taken, "modified_count", 0) or 0) else None


async def _is_member(db, user_id: str) -> bool:
    return bool(await db.memberships.find_one({"user_id": user_id, "member_status": {"$in": list(MEMBER_STATUSES)}}, {"_id": 1}))


async def _visible(db, user: dict, item: dict, member: bool | None) -> tuple[bool, bool | None]:
    """Darf die Person das (noch) sehen? Gibt auch den einmal gelesenen Mitgliedsstand zurück."""
    from services.notification_preferences import email_allowed

    if not email_allowed(user, item.get("template_key") or "", item.get("category")):
        return False, member
    if item.get("category") == "club_internal":
        if member is None:
            member = await _is_member(db, user["id"])
        if not member:
            return False, member
    return True, member


def _account_ok(user: dict | None) -> bool:
    return bool(user and user.get("email") and user.get("is_active", True) and not user.get("is_banned"))


async def render_digest(items: list[dict], display_name: str, base: str) -> tuple[str, str]:
    from email_service import render_named

    from services.email_delivery import SafeHtml, html_value
    from services.notification_preferences import TOPIC_LABELS

    groups: dict[str, list[dict]] = {}
    for item in items:
        groups.setdefault(TOPIC_LABELS.get(item.get("category") or "") or "Weitere Neuigkeiten", []).append(item)
    parts: list[str] = []
    for label in sorted(groups, key=lambda name: (-len(groups[name]), name)):
        rows = []
        for item in groups[label]:
            title = html_value(item.get("subject") or "Neuigkeit")
            link = f'<a href="{html_value(item["url"])}" style="color:#167da3;font-weight:700;text-decoration:none">{title}</a>' \
                if item.get("url", "").startswith(("http://", "https://")) else f"<strong>{title}</strong>"
            preview = f'<br><span style="color:#5b6573">{html_value(item["preview"])}</span>' if item.get("preview") else ""
            rows.append(f'<li style="margin:0 0 10px">{link}{preview}</li>')
        parts.append(f'<p style="margin:18px 0 6px;font-size:13px;font-weight:700;color:#111827;text-transform:uppercase;'
                     f'letter-spacing:.06em">{html_value(label)}</p><ul style="margin:0;padding-left:18px">{"".join(rows)}</ul>')
    count = len(items)
    rendered = await render_named(
        DIGEST_TEMPLATE, display_name=display_name, count=str(count), items=SafeHtml("".join(parts)),
        preferences_url=f"{base}{SETTINGS_PATH}",
    )
    return rendered or ("", "")


async def _finish(db, run: dict, user: dict, now: datetime, cutoff: str) -> tuple[int, int]:
    """Zeilen an den Lauf binden, prüfen, einreihen, abschließen. Rückgabe: (eingereihte Zeilen, herausgefallene)."""
    from services.mail_queue import enqueue_mail
    from services.notification_preferences import _site_base_url

    await db.mail_digest_items.update_many(
        {"user_id": user["id"], "digest_id": {"$exists": False}, "created_at": {"$lt": cutoff}},
        {"$set": {"digest_id": run["id"]}},
    )
    items = await db.mail_digest_items.find({"digest_id": run["id"]}, {"_id": 0}).sort([("created_at", 1), ("id", 1)]).to_list(500)
    shown: list[dict] = []
    dropped: list[str] = []
    member: bool | None = None
    for item in items:
        ok, member = await _visible(db, user, item, member) if _account_ok(user) else (False, member)
        (shown.append(item) if ok else dropped.append(item["id"]))
    stamp = now.isoformat()
    if shown:
        subject, html = await render_digest(shown, user.get("display_name") or user.get("username") or "Löwe", await _site_base_url())
        await enqueue_mail(to=user["email"], subject=subject, html=html, template_key=DIGEST_TEMPLATE,
                           dedupe_key=f"mail_digest:{run['id']}",
                           meta={"kind": "notification_digest", "user_id": user["id"], "period": run["period"], "count": len(shown)})
        await db.mail_digest_items.update_many({"id": {"$in": [item["id"] for item in shown]}}, {"$set": {"sent_at": stamp}})
    if dropped:
        await db.mail_digest_items.update_many({"id": {"$in": dropped}}, {"$set": {"dropped": stamp}})
    await db.mail_digest_runs.update_one({"id": run["id"]}, {"$set": {"status": "sent", "sent_at": stamp, "count": len(shown)}})
    return len(shown), len(dropped)


async def send_due(db, now: datetime | None = None) -> dict[str, int]:
    """Alle fälligen Sammel-Mails einreihen - je Person und Zeitraum genau eine (siehe Modulbeschreibung)."""
    now = now or now_utc()
    cfg = await load_settings(db)
    counts = {"digests": 0, "items": 0, "skipped": 0}
    stale = (now - timedelta(seconds=CLAIM_SECONDS)).isoformat()
    # Abgebrochene Läufe zuerst: Sie besitzen ihre Zeilen schon.
    for run in await db.mail_digest_runs.find({"status": "claimed", "claimed_at": {"$lt": stale}}, {"_id": 0}).to_list(500):
        taken = await claim_run(db, run["user_id"], run["period"], now)
        if taken:
            await _settle(db, taken, now, run.get("cutoff") or now.isoformat(), counts)
    user_ids = sorted(await db.mail_digest_items.distinct("user_id", {"digest_id": {"$exists": False}}))
    for user_id in user_ids:
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "email": 1, "display_name": 1, "username": 1,
                                                          "is_active": 1, "is_banned": 1, "mail_digest": 1,
                                                          "newsletter_consent": 1, "notification_preferences": 1})
        rhythm = rhythm_of(user, cfg)
        if rhythm == "instant":
            oldest = await db.mail_digest_items.find({"user_id": user_id, "digest_id": {"$exists": False}}, {"_id": 0, "id": 1}) \
                .sort([("created_at", 1), ("id", 1)]).to_list(1)
            key, cutoff = f"instant:{oldest[0]['id']}", (now + timedelta(seconds=1)).isoformat()
        else:
            slot = last_slot(rhythm, cfg, now)
            key, cutoff = period_key(rhythm, slot), slot.isoformat()
            if not await db.mail_digest_items.find_one(
                    {"user_id": user_id, "digest_id": {"$exists": False}, "created_at": {"$lt": cutoff}}, {"_id": 1}):
                continue
        run = await claim_run(db, user_id, key, now, cutoff)
        if not run:
            continue
        await _settle(db, run, now, run.get("cutoff") or cutoff, counts, user)
    old = (now - timedelta(days=KEEP_DAYS)).isoformat()
    await db.mail_digest_items.delete_many({"created_at": {"$lt": old}, "$or": [{"sent_at": {"$exists": True}},
                                                                                {"dropped": {"$exists": True}}]})
    await db.mail_digest_runs.delete_many({"status": "sent", "sent_at": {"$lt": old}})
    return counts


async def _settle(db, run: dict, now: datetime, cutoff: str, counts: dict, user: dict | None = None) -> None:
    if user is None:
        user = await db.users.find_one({"id": run["user_id"]}, {"_id": 0}) or {"id": run["user_id"]}
    try:
        shown, dropped = await _finish(db, run, user, now, cutoff)
    except Exception:  # noqa: BLE001 - eine Person hält die anderen nicht auf; der Anspruch verfällt, ein späterer Lauf holt nach
        logger.warning("[mail-digest] Sammel-Mail %s nicht eingereiht", log_safe(run.get("id")), exc_info=True)
        return
    counts["digests"] += 1 if shown else 0
    counts["items"] += shown
    counts["skipped"] += dropped


async def preview(db, display_name: str) -> dict:
    """Die Sammel-Mail mit Beispielzeilen - für die Verwaltung, ohne etwas einzureihen."""
    from services.notification_preferences import _site_base_url

    base = await _site_base_url()
    samples = [
        {"category": "tournament_updates", "subject": "Anmeldung bestätigt: Mario Kart Winter Cup", "preview": "Check-in ab 17:30 Uhr.",
         "url": f"{base}/tournaments/mario-kart-winter-cup"},
        {"category": "tournament_updates", "subject": "Liga 1: Neue Rundnachricht", "preview": "Spieltag 4 ist verschoben.",
         "url": f"{base}/liga"},
        {"category": "prize_updates", "subject": "Dein Gewinn ist bereit", "preview": "Gutschein 50 € – abholbar bis 31.10.2026.",
         "url": f"{base}/my/prizes"},
        {"category": "community_messages", "subject": "Neue Nachricht von Max", "preview": "Bist du am Samstag dabei?",
         "url": f"{base}/messages"},
    ]
    subject, html = await render_digest(samples, display_name or "Paula", base)
    return {"subject": subject, "html": html, "settings": await load_settings(db)}
