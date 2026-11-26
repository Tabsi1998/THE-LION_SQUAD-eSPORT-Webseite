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
from datetime import datetime, timedelta

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services.log_safe import log_safe

from services import mail_digest_rules as rules
from services.mail_digest_rules import (  # noqa: F401 - hier weiter erreichbar (Job, Einstellungen, Tests)
    DEFAULTS, DIGEST_TEMPLATE, OWN_FORMAT_TEMPLATES, PREVIEW_FIELDS, PREVIEW_MAX, RHYTHM_LABELS, RHYTHMS, SETTINGS_ID,
    URGENT_TEMPLATES, VIENNA, WEEKDAYS, hold, last_slot, load_settings, normalized_settings, period_key, preview_line, rhythm_of,
    schedule_text, settings_payload,
)

logger = logging.getLogger("tls.mail_digest")

CLAIM_SECONDS = 600
# Verschickte und herausgefallene Zeilen und abgeschlossene Läufe bleiben so lange (Nachfragen), dann räumt ``send_due`` auf.
KEEP_DAYS = 90
# Was der Versand vom Konto braucht - nie die privaten Felder (services/private_fields.py).
USER_FIELDS = {"_id": 0, "id": 1, "email": 1, "display_name": 1, "username": 1, "is_active": 1, "is_banned": 1, "mail_digest": 1,
               "newsletter_consent": 1, "notification_preferences": 1}
SETTINGS_PATH = "/profile?tab=notifications&bereich=mail"
MEMBER_STATUSES = ("active", "honorary")


# ---------------------------------------------------------------- Regeln

def collectable(template_key: str, importance: str | None = None) -> bool:
    """Darf diese Mail in die Sammlung? Wie ``mail_digest_rules.collectable`` - Pflicht-Mails aus den Einstellungen."""
    from services.notification_preferences import REQUIRED_EMAIL_TEMPLATES

    return rules.collectable(template_key, importance, template_key in REQUIRED_EMAIL_TEMPLATES)


# ---------------------------------------------------------------- Datenbank

async def claim_run(db, user_id: str, key: str, now: datetime, cutoff: str | None = None) -> dict | None:
    """Den Zeitraum für diesen Lauf beanspruchen - ``None``: schon verschickt oder ein anderer Lauf ist dran. ``cutoff``: bis
    wann gesammelte Zeilen dazugehören (steht am Lauf, damit eine Übernahme dieselbe Grenze nimmt)."""
    run = {"id": new_id(), "user_id": user_id, "period": key, "status": "claimed", "claimed_at": now.isoformat(),
           "cutoff": cutoff or now.isoformat(), "created_at": now.isoformat()}
    try:
        await db.mail_digest_runs.insert_one(dict(run))
        # Ohne den eindeutigen Index (Testdatenbank im Speicher) kann ein zweiter Lauf einfügen: Gibt es schon einen anderen,
        # zieht sich dieser zurück - unabhängig davon, wie die Kennungen sortiert sind.
        if not await db.mail_digest_runs.find_one({"user_id": user_id, "period": key, "id": {"$ne": run["id"]}}, {"_id": 1}):
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
        user = await db.users.find_one({"id": user_id}, USER_FIELDS)
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
        user = await db.users.find_one({"id": run["user_id"]}, USER_FIELDS) or {"id": run["user_id"]}
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
