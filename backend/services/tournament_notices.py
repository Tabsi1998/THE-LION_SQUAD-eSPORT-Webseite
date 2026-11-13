"""Hinweis der Turnierleitung (#1166): ein kurzer Satz an alle im Turnier - oder an alle Turniere eines Events.

Die Turnierleitung schreibt in ``/tournaments/<slug>/leitung`` (Reiter „Hinweis“) höchstens 140 Zeichen, etwa „Pause bis
14:30“, „Finale an PC 1“ oder „Bitte zum Check-in“. Der Hinweis

- kommt als Benachrichtigung „Hinweis der Turnierleitung“ (Glocke, Push, Discord nach den Einstellungen der Person, Thema
  „Turnier-Updates“) zu allen Angemeldeten - bei Teams zu allen Mitgliedern, wie die Rundnachricht der Liga
  (``match_audience.player_user_ids``); nie an Unbeteiligte, Abgemeldete oder gesperrte Konten,
- steht als Banner oben auf der Turnierseite (Ziel „Event“: auf der Event-Seite und den Seiten aller Turniere des Events),
  bis er abläuft (Vorgabe zwei Stunden, im Formular einstellbar) oder die Leitung ihn entfernt,
- erscheint mit dem Haken „auch am TV zeigen“ am Turnierbaum-TV und an der Hallen-Tafel.

Gegen Doppelversand wie die Rundnachricht aus E.4 (``league_desk``): eine Kennung je Hinweis (``request_id`` vom Formular).
Der Hinweis selbst ist die Sperre (fester ``_id`` aus Turnier und Kennung); ein zweiter Aufruf mit derselben Kennung schickt
nichts Neues. Verschickt wird im Hintergrund, Person für Person mit Fortschritt - ein großer Kreis hält die Anfrage nicht
auf. Bricht der Versand ab, setzt derselbe Aufruf ihn fort; Glocke und Push sind je Person entdoppelt.

Öffentlich (Banner, TV) stehen nur Text und Zeit, nie die Person, die geschrieben hat. Wer, wann, an wen und wie viele steht
im Protokoll (``audit_logs``) und in der Liste der Turnierleitung.

Der Server-Weg ist für #1372 vorbereitet: Die Event-Leitung kann ``send``/``remove`` mit dem Ziel „event“ später aus
„Anmeldungen & Einlass“ aufrufen; die Regeln stehen nur hier.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta

from pymongo.errors import DuplicateKeyError

from models import now_utc
from services.log_safe import log_safe

logger = logging.getLogger("tls.tournament_notices")

TEXT_MIN, TEXT_MAX = 3, 140
DURATION_DEFAULT, DURATION_MIN, DURATION_MAX = 120, 15, 12 * 60
TARGETS = ("tournament", "event")
TARGET_LABELS = {"tournament": "Alle im Turnier", "event": "Alle im Event"}
# Wer als angemeldet zählt - wie bei der Rundnachricht der Liga: offen, bestätigt, eingecheckt. Abgemeldet, abgelehnt,
# Warteliste und disqualifiziert bekommen nichts.
ACTIVE_REGISTRATIONS = ("pending", "approved", "checked_in")
# Schreiben und entfernen: Organisation und Schiedsrichter mit Einsatz für das ganze Turnier - in einer Staffel das
# Liga-Recht „Spiele betreuen“. Die Turnierleitung als Rolle oder Freigabe darf es immer.
NOTICE_ROLES = frozenset({"organizer", "referee"})
NOTICE_CAPABILITY = "matches"
KIND = "tournament_notice"
CATEGORY = "tournament_updates"
HEADING = "Hinweis der Turnierleitung"
STALE_SECONDS = 120
SKIPPED_TOURNAMENT_STATUSES = ("draft", "cancelled", "archived")
LIST_LIMIT = 20

OTHER_TEXT = "Text, Ziel, Dauer oder TV-Haken weichen vom begonnenen Hinweis ab. Bitte einen neuen Hinweis schreiben."
NO_EVENT = "Dieses Turnier gehört zu keinem Event."
NOT_FOUND = "Diesen Hinweis gibt es nicht."


class NoticeProblem(Exception):
    def __init__(self, detail: str, status_code: int = 422):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


# ---------------------------------------------------------------- Rechte


async def can_write(user: dict | None, tournament_id: str | None) -> bool:
    """Darf die Person in diesem Turnier Hinweise schreiben und entfernen?"""
    from services.tournament_permissions import has_tournament_staff_permission

    if not user or not tournament_id:
        return False
    return await has_tournament_staff_permission(user, tournament_id, set(NOTICE_ROLES), "tournament",
                                                 capability=NOTICE_CAPABILITY)


async def event_tournaments(db, event_id: str | None) -> list[dict]:
    """Die Turniere eines Events, an die ein Hinweis gehen kann - ohne Entwürfe, abgesagte und archivierte."""
    if not event_id:
        return []
    return await db.tournaments.find({"event_id": event_id, "status": {"$nin": list(SKIPPED_TOURNAMENT_STATUSES)}},
                                     {"_id": 0, "id": 1, "slug": 1, "title": 1, "status": 1}).to_list(200)


async def can_write_event(db, user: dict | None, event_id: str | None) -> bool:
    """Ziel „ganzes Event“: wer in jedem Turnier des Events Hinweise schreiben darf. Ohne Abkürzung für die Turnierleitung als
    Rolle: Ist eine Liga-Staffel im Event, braucht es dort das Liga-Recht (Review N3). Später entscheidet das die
    Event-Leitung (#1372)."""
    if not user or not event_id:
        return False
    rows = await event_tournaments(db, event_id)
    if not rows:
        return False
    for row in rows:
        if not await can_write(user, row["id"]):
            return False
    return True


# ---------------------------------------------------------------- Werte prüfen


def clean_text(value) -> str:
    """Ein Satz: Leerraum zusammengefasst, 3 bis 140 Zeichen."""
    text = " ".join(str(value or "").split())
    if len(text) < TEXT_MIN:
        raise NoticeProblem(f"Der Hinweis braucht mindestens {TEXT_MIN} Zeichen.")
    if len(text) > TEXT_MAX:
        raise NoticeProblem(f"Der Hinweis darf höchstens {TEXT_MAX} Zeichen haben.")
    return text


def clean_duration(value) -> int:
    try:
        minutes = int(value if value is not None else DURATION_DEFAULT)
    except (TypeError, ValueError):
        raise NoticeProblem("Die Dauer ist keine Zahl.") from None
    if not DURATION_MIN <= minutes <= DURATION_MAX:
        raise NoticeProblem(f"Der Hinweis steht zwischen {DURATION_MIN} Minuten und {DURATION_MAX // 60} Stunden.")
    return minutes


def notice_id(tournament_id: str, request_id: str) -> str:
    """Fest aus Turnier und Kennung: derselbe Aufruf trifft denselben Hinweis (``_id``), auch ohne eigenen Index."""
    return "tn-" + hashlib.sha256(f"{tournament_id}:{request_id}".encode("utf-8")).hexdigest()[:24]


def text_digest(text: str, target: str, minutes: int = DURATION_DEFAULT, show_on_tv: bool = False) -> str:
    """Fingerabdruck von allem, was ein Hinweis festlegt (Review N1): Text, Ziel, Dauer, TV-Haken. Eine Kennung mit anderen
    Werten ist ein anderer Hinweis - 409 statt still den ersten zu wiederholen."""
    return hashlib.sha256(f"{target}\n{int(minutes)}\n{int(bool(show_on_tv))}\n{text}".encode("utf-8")).hexdigest()


def _parse(value) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else None
    except ValueError:
        return None


def is_active(doc: dict, now: datetime | None = None) -> bool:
    """Steht der Hinweis noch? Nicht entfernt und nicht abgelaufen."""
    if doc.get("removed_at"):
        return False
    until = _parse(doc.get("expires_at"))
    return bool(until and until > (now or now_utc()))


# ---------------------------------------------------------------- Empfänger


async def scope_tournaments(db, tournament: dict, target: str) -> list[dict]:
    if target == "event":
        if not tournament.get("event_id"):
            raise NoticeProblem(NO_EVENT, 409)
        return await event_tournaments(db, tournament["event_id"])
    return [tournament]


async def recipients(db, tournament_ids: list[str], *, sender_id: str | None) -> list[str]:
    """Alle Angemeldeten der Turniere - bei Teams alle Mitglieder (bei einem Co-Team dessen Kader und die Leitung des
    Hauptteams). Ohne gesperrte oder stillgelegte Konten und ohne die Person, die schreibt."""
    from services.match_audience import player_user_ids, users_for

    if not tournament_ids:
        return []
    registrations = await db.tournament_registrations.find(
        {"tournament_id": {"$in": list(tournament_ids)}, "status": {"$in": list(ACTIVE_REGISTRATIONS)}}, {"_id": 0}).to_list(None)
    wanted = await player_user_ids(db, registrations)
    people = await users_for(db, wanted - {sender_id}, {"_id": 0, "id": 1, "is_active": 1})
    return sorted(row["id"] for row in people if row.get("is_active") is not False)


async def preview(db, tournament: dict, *, target: str, sender_id: str | None) -> dict:
    if target not in TARGETS:
        raise NoticeProblem("Unbekanntes Ziel.")
    rows = await scope_tournaments(db, tournament, target)
    ids = await recipients(db, [row["id"] for row in rows], sender_id=sender_id)
    return {"recipients": len(ids), "target": target, "target_label": TARGET_LABELS[target], "tournaments": len(rows)}


# ---------------------------------------------------------------- Schreiben


async def send(db, tournament: dict, me: dict, *, request_id, text, target: str, show_on_tv: bool,
               duration_minutes=None, now: datetime | None = None) -> tuple[dict, dict | None]:
    """Einen Hinweis anlegen - einmal je ``request_id``. Gibt die Antwort und den Auftrag für ``deliver`` zurück (``None``:
    nichts zu tun). Rechte prüft die Route."""
    request_id = str(request_id or "").strip()
    if not 8 <= len(request_id) <= 80:
        raise NoticeProblem("Die Anfrage ist unvollständig. Bitte die Seite neu laden.")
    if target not in TARGETS:
        raise NoticeProblem("Unbekanntes Ziel.")
    text = clean_text(text)
    minutes = clean_duration(duration_minutes)
    moment = now or now_utc()
    nid = notice_id(tournament["id"], request_id)
    earlier = await db.tournament_notices.find_one({"_id": nid}, {"_id": 0})
    if earlier:
        if earlier.get("text_sha256") != text_digest(text, target, minutes, show_on_tv):
            raise NoticeProblem(OTHER_TEXT, 409)
        return await _replay(db, earlier, moment)
    rows = await scope_tournaments(db, tournament, target)
    ids = await recipients(db, [row["id"] for row in rows], sender_id=me.get("id"))
    doc = {
        "id": nid, "request_id": request_id, "tournament_id": tournament["id"], "event_id": tournament.get("event_id"),
        "target": target, "text": text, "text_sha256": text_digest(text, target, minutes, show_on_tv), "show_on_tv": bool(show_on_tv),
        "duration_minutes": minutes, "created_by": me.get("id"), "created_at": moment.isoformat(),
        "expires_at": (moment + timedelta(minutes=minutes)).isoformat(),
        "recipients": len(ids), "processed": 0, "delivered": 0, "state": "sending" if ids else "sent",
        "progress_at": moment.isoformat(),
    }
    try:
        await db.tournament_notices.insert_one({"_id": nid, **doc})
    except DuplicateKeyError:
        # Zwei Klicks zugleich: der zweite findet den ersten und schickt nichts.
        return {**answer(await db.tournament_notices.find_one({"_id": nid}, {"_id": 0}) or doc, moment), "replay": True}, None
    from models import new_id

    # Protokoll: wer (``actor_id``), wann, an wen (Ziel, Turnier bzw. Event) und wie viele - ohne Namen der Empfänger.
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "tournament.notice.send", "actor_id": me.get("id"), "target_id": tournament["id"],
        "data": {"notice_id": nid, "target": target, "event_id": tournament.get("event_id"), "tournaments": len(rows),
                 "recipients": len(ids), "show_on_tv": bool(show_on_tv), "length": len(text), "expires_at": doc["expires_at"]},
        "created_at": moment.isoformat(),
    })
    return {**answer(doc, moment), "replay": False}, ({"notice_id": nid} if ids else None)


def is_stale(doc: dict, now: datetime | None = None) -> bool:
    """Hängt der Versand? Abgebrochen (``interrupted``) oder seit ``STALE_SECONDS`` ohne Fortschritt auf „sending“."""
    if doc.get("state") == "interrupted":
        return True
    if doc.get("state") != "sending":
        return False
    last = _parse(doc.get("progress_at"))
    quiet = ((now or now_utc()) - last).total_seconds() if last else STALE_SECONDS + 1
    return quiet >= STALE_SECONDS


async def _replay(db, doc: dict, moment: datetime) -> tuple[dict, dict | None]:
    if not is_stale(doc, moment):
        return {**answer(doc, moment), "replay": True}, None
    # Nur ein Aufruf übernimmt den Rest: die Bedingung auf den gelesenen Stand.
    taken = await db.tournament_notices.update_one(
        {"_id": doc["id"], "state": doc.get("state"), "progress_at": doc.get("progress_at")},
        {"$set": {"state": "sending", "progress_at": moment.isoformat()}})
    if not taken.modified_count:
        return {**answer(doc, moment), "replay": True}, None
    resumed = {**doc, "state": "sending", "progress_at": moment.isoformat()}
    return {**answer(resumed, moment), "replay": True, "resumed": True}, {"notice_id": doc["id"]}


async def deliver(db, *, notice_id: str) -> dict:
    """Der Versand im Hintergrund. Geht etwas schief, steht der Hinweis auf ``interrupted`` - derselbe Aufruf setzt fort."""
    try:
        return await _deliver(db, notice_id)
    except Exception:  # noqa: BLE001 - eine Hintergrundaufgabe hat niemanden, der den Fehler sieht: Stand speichern
        logger.warning("[tournament_notices] Versand von %s abgebrochen", log_safe(notice_id), exc_info=True)
        try:
            await db.tournament_notices.update_one({"_id": notice_id, "state": "sending"}, {"$set": {"state": "interrupted"}})
        except Exception:  # noqa: BLE001 - dann gilt „sending“ ohne Fortschritt nach STALE_SECONDS als hängend
            logger.warning("[tournament_notices] Stand von %s nicht gespeichert", log_safe(notice_id), exc_info=True)
        return answer(await db.tournament_notices.find_one({"_id": notice_id}, {"_id": 0}) or {})


async def _deliver(db, nid: str) -> dict:
    """Glocke, Push und Discord je Person nach ihren Einstellungen; nach jeder Person steht der Fortschritt am Hinweis.

    Klemmt es bei einer Person, zählt sie nicht als verarbeitet (Review N4): Der Versand endet dann auf ``interrupted`` mit
    der Zahl der Fehlschläge, „Fortsetzen“ holt genau sie nach - wer schon benachrichtigt ist, bekommt nichts doppelt."""
    from services.user_notifications import create_user_notification

    doc = await db.tournament_notices.find_one({"_id": nid}, {"_id": 0})
    if not doc:
        return {}
    tournament = await db.tournaments.find_one({"id": doc["tournament_id"]}, {"_id": 0}) or {"id": doc["tournament_id"]}
    rows = await scope_tournaments(db, tournament, doc["target"])
    ids = await recipients(db, [row["id"] for row in rows], sender_id=doc.get("created_by"))
    name, path = await _place(db, tournament, doc)
    handled = failed = 0
    for user_id in ids:
        try:
            done = await create_user_notification(
                user_id, f"{HEADING} · {name}", doc["text"], url=path, kind=KIND,
                # ``unique_dedupe``: Teilindex je Person und Schlüssel - läuft ein Fortsetzen parallel, verliert es beim
                # Eintragen und schickt weder Push noch Direktnachricht.
                meta={"category": CATEGORY, "tournament_id": doc["tournament_id"], "event_id": doc.get("event_id"),
                      "notice_id": nid, "dedupe_key": f"tournament-notice:{nid}:{user_id}", "unique_dedupe": True})
        except Exception:  # noqa: BLE001 - eine Person, bei der es klemmt, hält die anderen nicht auf
            logger.warning("[tournament_notices] Hinweis %s nicht zugestellt", log_safe(nid), exc_info=True)
            failed += 1
            await db.tournament_notices.update_one({"_id": nid}, {"$set": {"progress_at": now_utc().isoformat()}})
            continue
        handled += 1
        # Beim Fortsetzen beginnt die Schleife vorn - der gespeicherte Stand geht dabei nie zurück.
        change: dict = {"$set": {"progress_at": now_utc().isoformat()}, "$max": {"processed": handled}}
        if done:
            change["$inc"] = {"delivered": 1}
        await db.tournament_notices.update_one({"_id": nid}, change)
    await db.tournament_notices.update_one({"_id": nid}, {"$set": {
        "state": "interrupted" if failed else "sent", "failed": failed, "recipients": len(ids), "progress_at": now_utc().isoformat()}})
    return answer(await db.tournament_notices.find_one({"_id": nid}, {"_id": 0}) or {})


async def _place(db, tournament: dict, doc: dict) -> tuple[str, str]:
    """Name und Seite für die Benachrichtigung: das Turnier - beim Ziel „Event“ das Event."""
    if doc.get("target") == "event" and doc.get("event_id"):
        event = await db.events.find_one({"id": doc["event_id"]}, {"_id": 0, "name": 1, "slug": 1, "id": 1}) or {}
        return event.get("name") or "Event", f"/events/{event.get('slug') or doc['event_id']}"
    return tournament.get("title") or "Turnier", f"/tournaments/{tournament.get('slug') or tournament['id']}"


def answer(doc: dict, now: datetime | None = None) -> dict:
    """Stand eines Hinweises für die Turnierleitung (ohne Text der Empfänger, ohne Namen)."""
    return {"id": doc.get("id"), "request_id": doc.get("request_id"), "target": doc.get("target"),
            "target_label": TARGET_LABELS.get(doc.get("target"), ""),
            "recipients": int(doc.get("recipients") or 0), "processed": int(doc.get("processed") or 0),
            "delivered": int(doc.get("delivered") or 0), "failed": int(doc.get("failed") or 0), "state": doc.get("state") or "sent",
            "stale": is_stale(doc, now), "expires_at": doc.get("expires_at")}


# ---------------------------------------------------------------- Fortsetzen (Review M1)

GONE = "Dieser Hinweis steht nicht mehr - entfernt oder abgelaufen. Bitte einen neuen schreiben."


async def resume(db, tournament: dict, me: dict, nid: str, now: datetime | None = None) -> tuple[dict, dict | None]:
    """„Fortsetzen“ im Protokoll: ein unterbrochener oder hängender Versand läuft mit den gespeicherten Werten weiter (Text,
    Ziel, Kennung). Wer schon benachrichtigt ist, bekommt nichts doppelt. Läuft er noch oder ist er durch, passiert nichts.
    Rechte für das Turnier prüft die Route; beim Ziel „Event“ hier die für das Event."""
    doc = await _notice_of(db, tournament, nid)
    if doc.get("target") == "event" and not await can_write_event(db, me, doc.get("event_id")):
        raise NoticeProblem("Einen Hinweis an das ganze Event setzt fort, wer für alle Turniere des Events schreiben darf.", 403)
    moment = now or now_utc()
    if not is_active(doc, moment):
        raise NoticeProblem(GONE, 409)
    return await _replay(db, doc, moment)


# ---------------------------------------------------------------- Entfernen


async def remove(db, tournament: dict, me: dict, nid: str) -> dict:
    """Den Hinweis abnehmen: Banner und TV zeigen ihn nicht mehr. Die Benachrichtigungen bleiben, wo sie sind. Ein zweites
    Entfernen ändert nichts. Rechte für das Turnier prüft die Route; beim Ziel „Event“ hier die für das Event."""
    doc = await _notice_of(db, tournament, nid)
    if doc.get("target") == "event" and not await can_write_event(db, me, doc.get("event_id")):
        raise NoticeProblem("Einen Hinweis an das ganze Event entfernt, wer für alle Turniere des Events schreiben darf.", 403)
    if doc.get("removed_at"):
        return {"ok": True, "idempotent_replay": True}
    moment = now_utc().isoformat()
    changed = await db.tournament_notices.update_one({"_id": nid, "removed_at": {"$exists": False}},
                                                     {"$set": {"removed_at": moment, "removed_by": me.get("id")}})
    if not changed.modified_count:
        return {"ok": True, "idempotent_replay": True}
    from models import new_id

    await db.audit_logs.insert_one({
        "id": new_id(), "action": "tournament.notice.remove", "actor_id": me.get("id"), "target_id": tournament["id"],
        "data": {"notice_id": nid, "target": doc.get("target"), "event_id": doc.get("event_id")}, "created_at": moment,
    })
    return {"ok": True, "idempotent_replay": False}


async def _notice_of(db, tournament: dict, nid: str) -> dict:
    """Ein Hinweis dieses Turniers - oder einer an das ganze Event des Turniers."""
    doc = await db.tournament_notices.find_one({"_id": str(nid or "")}, {"_id": 0})
    if not doc:
        raise NoticeProblem(NOT_FOUND, 404)
    own = doc.get("tournament_id") == tournament["id"]
    same_event = doc.get("target") == "event" and doc.get("event_id") and doc.get("event_id") == tournament.get("event_id")
    if not (own or same_event):
        raise NoticeProblem(NOT_FOUND, 404)
    return doc


# ---------------------------------------------------------------- Lesen


def _query_for(tournament_ids: list[str], event_id: str | None) -> dict:
    ors: list[dict] = [{"target": "tournament", "tournament_id": {"$in": list(tournament_ids)}}]
    if event_id:
        ors.append({"target": "event", "event_id": event_id})
    return {"$or": ors}


def public_notice(doc: dict, titles: dict[str, str] | None = None) -> dict:
    """Was Banner und TV zeigen: Text, Zeit, Ziel - nie die Person, die geschrieben oder entfernt hat."""
    out = {"id": doc.get("id"), "text": doc.get("text") or "", "created_at": doc.get("created_at"),
           "expires_at": doc.get("expires_at"), "target": doc.get("target"), "tv": bool(doc.get("show_on_tv"))}
    if titles is not None and doc.get("target") == "tournament":
        out["tournament_title"] = titles.get(doc.get("tournament_id") or "", "")
    return out


async def active_notices(db, *, tournament_ids: list[str], event_id: str | None, tv_only: bool = False,
                         titles: dict[str, str] | None = None, now: datetime | None = None) -> list[dict]:
    """Die stehenden Hinweise, der neueste zuerst."""
    moment = now or now_utc()
    query = {**_query_for(tournament_ids, event_id), "removed_at": {"$exists": False}}
    if tv_only:
        query["show_on_tv"] = True
    rows = await db.tournament_notices.find(query, {"_id": 0}).sort("created_at", -1).to_list(50)
    return [public_notice(row, titles) for row in rows if is_active(row, moment)]


async def for_tournament(db, tournament: dict, *, tv_only: bool = False) -> list[dict]:
    """Banner bzw. TV eines Turniers: seine eigenen Hinweise und die an sein ganzes Event."""
    return await active_notices(db, tournament_ids=[tournament["id"]], event_id=tournament.get("event_id"), tv_only=tv_only)


async def for_event(db, event_id: str, tournaments: list[dict], *, tv_only: bool = False) -> list[dict]:
    """Event-Seite bzw. Hallen-Tafel: die Hinweise an das ganze Event und die der gezeigten Turniere (mit Turniername)."""
    titles = {row["id"]: row.get("title") or "" for row in tournaments if row.get("id")}
    return await active_notices(db, tournament_ids=sorted(titles), event_id=event_id, tv_only=tv_only, titles=titles)


async def lead_list(db, tournament: dict, me: dict) -> dict:
    """Reiter „Hinweis“: die letzten Hinweise dieses Turniers und seines Events mit Protokoll (wer, wann, an wen, wie viele)."""
    moment = now_utc()
    rows = await db.tournament_notices.find(_query_for([tournament["id"]], tournament.get("event_id")), {"_id": 0}).sort(
        "created_at", -1).to_list(LIST_LIMIT)
    people = sorted({row.get(field) for row in rows for field in ("created_by", "removed_by") if row.get(field)})
    names = {row["id"]: row.get("display_name") or row.get("username") or "" for row in await db.users.find(
        {"id": {"$in": people}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(len(people) + 5)} if people else {}
    event_ok = await can_write_event(db, me, tournament.get("event_id")) if tournament.get("event_id") else False
    items = []
    for row in rows:
        items.append({
            **public_notice(row), **answer(row, moment), "active": is_active(row, moment),
            "author": names.get(row.get("created_by") or "", "Gelöschter User" if row.get("created_by") else ""),
            "removed_at": row.get("removed_at"), "removed_by": names.get(row.get("removed_by") or "") if row.get("removed_by") else None,
            "from_other_tournament": row.get("tournament_id") != tournament["id"],
            "can_remove": row.get("target") != "event" or event_ok,
        })
    return {"items": items, "can_target_event": event_ok, "event_id": tournament.get("event_id"),
            "limits": {"text_max": TEXT_MAX, "duration_default": DURATION_DEFAULT, "duration_min": DURATION_MIN,
                       "duration_max": DURATION_MAX}}
