"""Rückmeldung nach Turnier oder Event (#1196): kurz bewerten - nur für den Verein, ohne Namen.

Am Tag nach dem Turnier bzw. Event fragt die Website und die App einmal: „Wie war der FC 26 Cup?“ Ein bis fünf Sterne,
auf Wunsch Stichworte (Ablauf, Zeitplan, Stimmung, Technik, Essen) und ein Satz (höchstens 280 Zeichen). Wer nicht
will, tippt „Lieber nicht“ - dann fragt niemand mehr.

Gefragt wird nur, wer dabei war: bei Events die Eingecheckten; bei Turnieren, wer eingecheckt war oder gespielt hat -
bei Teams jedes Mitglied der Aufstellung (ohne Aufstellung jedes Mitglied). Die Frage steht vom Tag nach dem Ende an
zwei Wochen lang in „Offene Aktionen“ und kommt einmal als Meldung (Thema „Turnier-Updates“).

Anonym für den Verein (Fabians Entscheidung): Wer geantwortet hat, steht in ``feedback_receipts`` (damit niemand zweimal
gefragt wird); was er geantwortet hat, steht getrennt davon in ``feedback_entries`` - ohne Person und nur mit dem Tag,
nicht mit der Uhrzeit. Die Verwaltung sieht Schnitt, Stichworte und Sätze erst ab drei Rückmeldungen, damit bei zwei
Leuten niemand erraten werden kann, wer was geschrieben hat. Spieler sehen keine Bewertungen anderer.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from models import new_id, now_utc

VIENNA = ZoneInfo("Europe/Vienna")
KINDS = ("tournament", "event")
TAGS = ("Ablauf", "Zeitplan", "Stimmung", "Technik", "Essen")
TEXT_MAX = 280
WINDOW_DAYS = 14
MIN_FOR_DETAILS = 3
FINISHED_TOURNAMENTS = {"completed", "results_published", "archived"}
CLOSED_EVENTS = {"draft", "cancelled"}
NOTIFY_KIND = "feedback_request"


def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def today(now: datetime | None = None) -> date:
    return (now or now_utc()).astimezone(VIENNA).date()


def end_day(doc: dict) -> date | None:
    """Der letzte Tag in Wien - ein mehrtägiges Event endet mit seinem letzten Tag."""
    end = _parse(doc.get("end_date")) or _parse(doc.get("start_date"))
    return end.astimezone(VIENNA).date() if end else None


def title_of(kind: str, doc: dict) -> str:
    return (doc.get("title") or "Turnier") if kind == "tournament" else (doc.get("name") or doc.get("title") or "Event")


def question(kind: str, doc: dict) -> str:
    return f"Wie war {'der' if kind == 'tournament' else 'das'} {title_of(kind, doc)}?"


def in_window(kind: str, doc: dict, day: date) -> bool:
    """Ab dem Tag nach dem Ende zwei Wochen lang; nur fertige Turniere und stattgefundene Events."""
    last = end_day(doc)
    if not last or not (last < day <= last + timedelta(days=WINDOW_DAYS)):
        return False
    if kind == "tournament":
        return doc.get("status") in FINISHED_TOURNAMENTS
    return doc.get("status") not in CLOSED_EVENTS


async def find_target(db, kind: str, target_id: str) -> dict | None:
    if kind not in KINDS:
        return None
    collection = db.tournaments if kind == "tournament" else db.events
    return await collection.find_one({"$or": [{"id": target_id}, {"slug": target_id}]}, {"_id": 0})


async def _played(db, reg_id: str) -> bool:
    return bool(await db.matches_v2.count_documents({"results.registration_id": reg_id, "status": {"$in": ["completed", "forfeit"]}}))


async def tournament_participants(db, tournament: dict) -> set[str]:
    """Wer bei einem Turnier dabei war: eingecheckt oder gespielt; Teams mit der Aufstellung, sonst alle Mitglieder."""
    from services.team_lineup import registration_recipients
    out: set[str] = set()
    regs = await db.tournament_registrations.find(
        {"tournament_id": tournament["id"], "status": {"$in": ["approved", "checked_in"]}}, {"_id": 0},
    ).to_list(1000)
    for reg in regs:
        if reg.get("status") != "checked_in" and not await _played(db, reg["id"]):
            continue
        if reg.get("team_id"):
            if reg.get("lineup"):
                out.update(reg.get("lineup") or [])
                out.update(reg.get("substitutes") or [])
            else:
                out.update(await registration_recipients(db, [reg]))
        elif reg.get("user_id"):
            out.add(reg["user_id"])
    return {uid for uid in out if uid}


async def event_participants(db, event: dict) -> set[str]:
    rows = await db.event_registrations.find({"event_id": event["id"], "status": "checked_in"}, {"_id": 0, "user_id": 1}).to_list(5000)
    return {row["user_id"] for row in rows if row.get("user_id")}


async def participants(db, kind: str, doc: dict) -> set[str]:
    return await (tournament_participants(db, doc) if kind == "tournament" else event_participants(db, doc))


async def _receipts(db, user_id: str) -> set[tuple[str, str]]:
    rows = await db.feedback_receipts.find({"user_id": user_id}, {"_id": 0, "kind": 1, "target_id": 1}).to_list(2000)
    return {(row.get("kind"), row.get("target_id")) for row in rows}


async def _candidates(db, user: dict, day: date) -> list[tuple[str, dict]]:
    """Turniere und Events der letzten zwei Wochen, bei denen diese Person angemeldet war."""
    team_ids = {row.get("team_id") for row in await db.team_members.find({"user_id": user["id"]}, {"_id": 0, "team_id": 1}).to_list(200)}
    team_ids.update(row["id"] for row in await db.teams.find({"member_ids": user["id"]}, {"_id": 0, "id": 1}).to_list(200))
    team_ids.discard(None)
    reg_query = {"$or": [{"user_id": user["id"]}, *([{"team_id": {"$in": sorted(team_ids)}}] if team_ids else [])]}
    tournament_ids = {row.get("tournament_id") for row in await db.tournament_registrations.find(reg_query, {"_id": 0, "tournament_id": 1}).to_list(500)}
    out: list[tuple[str, dict]] = []
    if tournament_ids:
        for doc in await db.tournaments.find({"id": {"$in": sorted(tid for tid in tournament_ids if tid)}}, {"_id": 0}).to_list(500):
            out.append(("tournament", doc))
    event_ids = {row.get("event_id") for row in await db.event_registrations.find({"user_id": user["id"], "status": "checked_in"}, {"_id": 0, "event_id": 1}).to_list(500)}
    if event_ids:
        for doc in await db.events.find({"id": {"$in": sorted(eid for eid in event_ids if eid)}}, {"_id": 0}).to_list(200):
            out.append(("event", doc))
    return out


async def open_prompts(db, user: dict | None, *, now: datetime | None = None, limit: int = 3) -> list[dict]:
    """Was diese Person gerade bewerten kann - neueste zuerst, höchstens drei."""
    if not user:
        return []
    day = today(now)
    done = await _receipts(db, user["id"])
    prompts = []
    for kind, doc in await _candidates(db, user, day):
        if (kind, doc["id"]) in done or not in_window(kind, doc, day):
            continue
        if user["id"] not in await participants(db, kind, doc):
            continue
        prompts.append({
            "kind": kind, "target_id": doc["id"], "slug": doc.get("slug"), "title": title_of(kind, doc),
            "question": question(kind, doc), "day": end_day(doc).isoformat(),
        })
    prompts.sort(key=lambda row: row["day"], reverse=True)
    return prompts[:limit]


async def dashboard_actions(db, user: dict | None, actions: list[dict], *, now: datetime | None = None) -> list[dict]:
    """Die Fragen als Zeilen unter „Offene Aktionen“ (Website und App) - derselbe Weg wie „Check-in offen“."""
    extra = [{
        "id": f"feedback-{row['kind']}-{row['target_id']}",
        "type": "feedback",
        "label": row["question"],
        "detail": "Kurz bewerten – das sieht nur der Verein",
        "target_type": "feedback",
        "target_id": f"{row['kind']}:{row['target_id']}",
        "priority": 4,
    } for row in await open_prompts(db, user, now=now)]
    merged = [*actions, *extra]
    merged.sort(key=lambda item: int(item.get("priority") or 0), reverse=True)
    return merged[:8]


async def _eligible_target(db, user: dict, kind: str, target_id: str) -> dict:
    doc = await find_target(db, kind, target_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    if not in_window(kind, doc, today()) or user["id"] not in await participants(db, kind, doc):
        raise HTTPException(status_code=403, detail="Bewerten kann, wer dabei war – bis zwei Wochen danach.")
    if await db.feedback_receipts.find_one({"user_id": user["id"], "kind": kind, "target_id": doc["id"]}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Dazu hast du schon geantwortet – danke!")
    return doc


async def submit(db, user: dict, kind: str, target_id: str, *, stars: int, tags: list[str], text: str) -> dict:
    doc = await _eligible_target(db, user, kind, target_id)
    clean_tags = [tag for tag in TAGS if tag in set(tags or [])]
    sentence = " ".join(str(text or "").split())[:TEXT_MAX]
    day = today().isoformat()
    # Erst die Quittung (eindeutig je Person), dann die Antwort ohne Person - so gibt es nie zwei Antworten.
    await db.feedback_receipts.insert_one({"id": new_id(), "user_id": user["id"], "kind": kind, "target_id": doc["id"], "status": "answered", "day": day})
    await db.feedback_entries.insert_one({
        "id": new_id(), "kind": kind, "target_id": doc["id"], "stars": int(stars), "tone": "good" if int(stars) >= 4 else "bad",
        "tags": clean_tags, "text": sentence, "day": day,
    })
    await db.notifications.update_many({"user_id": user["id"], "kind": NOTIFY_KIND, "meta.target_id": doc["id"]}, {"$set": {"read": True}})
    return {"ok": True}


async def decline(db, user: dict, kind: str, target_id: str) -> dict:
    doc = await _eligible_target(db, user, kind, target_id)
    await db.feedback_receipts.insert_one({"id": new_id(), "user_id": user["id"], "kind": kind, "target_id": doc["id"], "status": "declined", "day": today().isoformat()})
    await db.notifications.update_many({"user_id": user["id"], "kind": NOTIFY_KIND, "meta.target_id": doc["id"]}, {"$set": {"read": True}})
    return {"ok": True}


async def summary(db, kind: str, target_id: str) -> dict:
    """Die Auswertung für die Verwaltung - ohne Namen, Einzelheiten erst ab drei Rückmeldungen."""
    doc = await find_target(db, kind, target_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    entries = await db.feedback_entries.find({"kind": kind, "target_id": doc["id"]}, {"_id": 0}).to_list(5000)
    declined = await db.feedback_receipts.count_documents({"kind": kind, "target_id": doc["id"], "status": "declined"})
    count = len(entries)
    base = {"title": title_of(kind, doc), "count": count, "declined": declined, "min_for_details": MIN_FOR_DETAILS, "details": count >= MIN_FOR_DETAILS}
    if count < MIN_FOR_DETAILS:
        return base
    stars = [int(row.get("stars") or 0) for row in entries]
    praised = {tag: 0 for tag in TAGS}
    criticised = {tag: 0 for tag in TAGS}
    for row in entries:
        bucket = praised if row.get("tone") == "good" else criticised
        for tag in row.get("tags") or []:
            if tag in bucket:
                bucket[tag] += 1
    texts = sorted(({"text": row["text"], "stars": int(row.get("stars") or 0)} for row in entries if row.get("text")),
                   key=lambda row: (-row["stars"], row["text"]))
    return {
        **base,
        "average": round(sum(stars) / count, 1),
        "distribution": {str(n): stars.count(n) for n in range(1, 6)},
        "praised": {tag: n for tag, n in praised.items() if n},
        "criticised": {tag: n for tag, n in criticised.items() if n},
        "texts": texts,
    }


async def send_requests(db, *, now: datetime | None = None) -> dict:
    """Am Tag danach (läuft täglich): eine Meldung an alle, die dabei waren und noch nicht geantwortet haben."""
    from services.user_notifications import create_user_notification
    day = today(now)
    yesterday = day - timedelta(days=1)
    lower = datetime.combine(yesterday - timedelta(days=7), datetime.min.time(), tzinfo=VIENNA).astimezone(timezone.utc)
    # Grob vorfiltern (Text und Datum, je nachdem wie der Termin gespeichert ist); genau prüft ``end_day``.
    recent = {"$or": [{"end_date": {"$gte": lower.isoformat()}}, {"start_date": {"$gte": lower.isoformat()}},
                      {"end_date": {"$gte": lower}}, {"start_date": {"$gte": lower}}]}
    sent = 0
    for kind in KINDS:
        collection = db.tournaments if kind == "tournament" else db.events
        docs = await collection.find(recent, {"_id": 0}).to_list(500)
        for doc in docs:
            if end_day(doc) != yesterday or not in_window(kind, doc, day):
                continue
            answered = {row["user_id"] for row in await db.feedback_receipts.find({"kind": kind, "target_id": doc["id"]}, {"_id": 0, "user_id": 1}).to_list(5000)}
            for user_id in sorted(await participants(db, kind, doc) - answered):
                created = await create_user_notification(
                    user_id,
                    title=question(kind, doc),
                    body="Ein bis fünf Sterne, auf Wunsch ein Satz – das sieht nur der Verein, ohne deinen Namen.",
                    url=f"/dashboard?bewerten={kind}:{doc['id']}",
                    kind=NOTIFY_KIND,
                    meta={"category": "tournament_updates", "kind": kind, "target_id": doc["id"], "dedupe_key": f"feedback:{kind}:{doc['id']}"},
                )
                sent += 1 if created else 0
    return {"sent": sent}
