"""Adventkalender (#641): 24 Türchen je Jahr - was drin ist, pflegt die Verwaltung; wann eines aufgeht,
entscheidet der Server.

Ein Türchen öffnet sich an seinem Tag um 6 Uhr (Europe/Vienna) und lässt sich bis Dreikönig nachholen. Vorher
verrät die Schnittstelle nichts über seinen Inhalt - weder Titel noch Art. Wer angemeldet öffnet, sammelt
(``advent_openings``: einmal je Person, Jahr und Tag); Gäste sehen den Inhalt, gezählt wird für sie nichts.
Beim Quiz wird nie gespeichert, welche Antwort jemand gegeben hat - nur, dass mitgemacht wurde.

Verweise (News, Event, Mitglied der Woche) werden beim Anzeigen aufgelöst, nicht beim Speichern: was die
Person nicht sehen darf oder was es nicht mehr gibt, fällt weg - das Türchen bleibt mit Titel und Text stehen.
"""
from __future__ import annotations

import hashlib
import random
import re
from collections import Counter
from datetime import date, datetime

from fastapi import HTTPException

from models import new_id, now_utc
from services import season_raffles as raffles
from services import seasons

SEASON = "advent_calendar"
DOORS = 24
DOOR_DAYS = tuple(range(1, DOORS + 1))
DOOR_COLLECTION = "advent_doors"
OPENINGS = "advent_openings"
VIEWS = "advent_views"
SIGNAL = "advent_door"

KIND_LABELS = {
    "text": "Text",
    "image": "Bild",
    "video": "Video",
    "clip": "Twitch-Clip",
    "news": "News-Beitrag",
    "event": "Event",
    "member_spotlight": "Mitglied der Woche",
    "sticker": "Sticker",
    "quiz": "Quiz",
    "prize": "Gewinn",
}
KINDS = tuple(KIND_LABELS)
QUIZ_ANSWERS = 3
TITLE_MAX = 80
BODY_MAX = 2000
# Bilder nur aus dem eigenen Upload - eine fremde Adresse würde beim Öffnen jede Person bei Dritten abrufen lassen.
UPLOAD_URL = re.compile(r"/api/static/uploads/[A-Za-z0-9][A-Za-z0-9_.-]{0,150}\.(png|webp|jpg|jpeg|gif)")
YOUTUBE_ID = re.compile(r"[\w-]{11}")
CLIP_URL = re.compile(r"https?://(?:clips\.twitch\.tv/|(?:www\.|m\.)?twitch\.tv/[A-Za-z0-9_]{2,64}/clip/)([A-Za-z0-9_-]{4,120})(?:[/?#].*)?", re.IGNORECASE)
LINK_URL = re.compile(r"(/(?!/)[^\s]{0,300}|https://[^\s]{4,300})")
DEFAULT_BODY = "Der Löwe wünscht dir einen schönen Adventtag."


# ------------------------------------------------------------------ Zeit und Anordnung

def opens_at(year: int, day: int) -> datetime:
    return seasons.advent_door_opens_at(year, day)


def is_open(year: int, day: int, now: datetime) -> bool:
    return opens_at(year, day) <= now


def door_seed(year: int, day: int) -> int:
    """Eine feste Zahl je Jahr und Türchen (#732): daraus leiten Web und App Scharnier, Licht und Neigung ab -
    jedes Türchen anders, aber nach dem Neuladen dasselbe."""
    return int(hashlib.sha256(f"advent:{year}:{day}".encode("utf-8")).hexdigest()[:8], 16)


def raffle_key(year: int, day: int) -> str:
    return f"advent:{year}:{day}"


def door_order(year: int) -> list[int]:
    """Die Anordnung der Türchen: durcheinander wie bei einem echten Kalender, je Jahr fest."""
    order = list(DOOR_DAYS)
    random.Random(f"advent:{year}").shuffle(order)
    return order


async def running(db, now: datetime | None = None) -> dict | None:
    """Der laufende Kalender ({year, ends_at, now}) - None, wenn die Saison aus ist oder gerade nicht läuft."""
    from routes.seasons_routes import load_context

    now = seasons.to_vienna(now)
    stored, founded = await load_context(db)
    state = next((item for item in seasons.active(now, stored, founded)["seasons"] if item["key"] == SEASON), None)
    if not state or state.get("forced"):
        # Erzwungen außerhalb der Zeit gibt es die Deko, aber keinen Kalender - dessen Tage liegen dann in der Zukunft.
        return None
    window = seasons.current_window(SEASON, now)
    if not window:
        return None
    return {"year": window["year"], "ends_at": window["end"], "now": now, "channels": state.get("channels") or []}


async def next_start(now: datetime | None = None) -> str | None:
    window = seasons.next_window(SEASON, seasons.to_vienna(now))
    return window["start"].isoformat() if window else None


# ------------------------------------------------------------------ Prüfen, was die Verwaltung speichert

def _text(value, limit: int) -> str:
    cleaned = "".join(ch for ch in str(value or "") if ch in "\n\t" or ord(ch) >= 32)
    return cleaned.replace("\r\n", "\n").strip()[:limit]


def _fail(message: str):
    raise HTTPException(status_code=400, detail=message)


def youtube_id(value: str) -> str:
    """Die Video-Kennung aus einer YouTube-Adresse - leer, wenn es keine ist."""
    from urllib.parse import parse_qs, urlparse

    raw = str(value or "").strip()
    if not raw:
        return ""
    parsed = urlparse(raw if re.match(r"^https?://", raw, re.IGNORECASE) else f"https://{raw}")
    host = (parsed.hostname or "").lower()
    parts = [part for part in parsed.path.split("/") if part]
    if host == "youtu.be":
        candidate = parts[0] if parts else ""
    elif host in ("youtube.com", "www.youtube.com", "m.youtube.com", "www.youtube-nocookie.com"):
        candidate = (parse_qs(parsed.query).get("v") or [""])[0] or (parts[1] if len(parts) > 1 and parts[0] in ("embed", "shorts", "live") else "")
    else:
        return ""
    return candidate if YOUTUBE_ID.fullmatch(candidate or "") else ""


def clip_id(value: str) -> str:
    match = CLIP_URL.fullmatch(str(value or "").strip())
    return match.group(1) if match else ""


def _quiz(value) -> dict:
    data = value if isinstance(value, dict) else {}
    question = _text(data.get("question"), 200)
    answers = [_text(answer, 120) for answer in (data.get("answers") or [])] if isinstance(data.get("answers"), list) else []
    if not question:
        _fail("Das Quiz braucht eine Frage.")
    if len(answers) != QUIZ_ANSWERS or not all(answers):
        _fail("Das Quiz braucht genau drei Antworten.")
    if len(set(answer.lower() for answer in answers)) != QUIZ_ANSWERS:
        _fail("Die drei Antworten müssen sich unterscheiden.")
    try:
        correct = int(data.get("correct"))
    except (TypeError, ValueError):
        correct = -1
    if correct not in range(QUIZ_ANSWERS):
        _fail("Beim Quiz fehlt, welche Antwort richtig ist.")
    return {"question": question, "answers": answers, "correct": correct, "explanation": _text(data.get("explanation"), 400)}


async def clean_door(db, payload: dict, year: int, day: int) -> dict:
    """Was gespeichert wird - geprüft je Art. Wirft 400 mit einem Satz, der sagt, was fehlt."""
    kind = str(payload.get("kind") or "").strip()
    if kind not in KINDS:
        _fail("Diese Art von Türchen gibt es nicht.")
    title = _text(payload.get("title"), TITLE_MAX)
    if not title:
        _fail("Das Türchen braucht einen Titel.")
    door = {
        "kind": kind, "title": title, "body": _text(payload.get("body"), BODY_MAX),
        "media_url": None, "video_url": None, "video_id": None, "clip_url": None, "clip_id": None,
        "ref_id": None, "consent_confirmed": False, "sticker": None, "quiz": None, "prize": None,
        "link_url": None, "link_label": None,
    }
    media = str(payload.get("media_url") or "").strip()
    if media:
        if not UPLOAD_URL.fullmatch(media):
            _fail("Das Bild muss aus dem eigenen Upload kommen (Medien → Hochladen).")
        door["media_url"] = media
    link = str(payload.get("link_url") or "").strip()
    if link:
        if not LINK_URL.fullmatch(link):
            _fail("Der Link muss mit / (eigene Seite) oder https:// beginnen.")
        door["link_url"] = link
        door["link_label"] = _text(payload.get("link_label"), 40) or "Mehr dazu"

    if kind == "text" and not door["body"]:
        _fail("Ein Text-Türchen braucht einen Text.")
    if kind == "image" and not door["media_url"]:
        _fail("Ein Bild-Türchen braucht ein Bild.")
    if kind == "video":
        video = youtube_id(payload.get("video_url"))
        if not video:
            _fail("Das Video muss eine YouTube-Adresse sein.")
        door["video_id"] = video
        door["video_url"] = f"https://www.youtube.com/watch?v={video}"
    if kind == "clip":
        clip = clip_id(payload.get("clip_url"))
        if not clip:
            _fail("Der Clip muss eine Adresse von Twitch sein (clips.twitch.tv/… oder twitch.tv/kanal/clip/…).")
        door["clip_id"] = clip
        door["clip_url"] = f"https://clips.twitch.tv/{clip}"
    if kind in ("news", "event", "member_spotlight"):
        ref = str(payload.get("ref_id") or "").strip()[:80]
        collection = {"news": db.news_posts, "event": db.events, "member_spotlight": db.club_member_profiles}[kind]
        if not ref or not await collection.find_one({"id": ref}, {"_id": 0, "id": 1}):
            _fail({"news": "Diesen News-Beitrag gibt es nicht.", "event": "Dieses Event gibt es nicht.", "member_spotlight": "Dieses Mitglied gibt es nicht."}[kind])
        door["ref_id"] = ref
    if kind == "member_spotlight":
        if payload.get("consent_confirmed") is not True:
            _fail("Mitglied der Woche gibt es nur mit Einwilligung: bitte bestätigen, dass das Mitglied einverstanden ist.")
        door["consent_confirmed"] = True
    if kind == "sticker":
        from services.stickers import resolve_sticker

        sticker = await resolve_sticker(db, str(payload.get("sticker_id") or "").strip()[:120])
        if not sticker:
            _fail("Diesen Sticker gibt es nicht (mehr).")
        door["sticker"] = sticker
    if kind == "quiz":
        door["quiz"] = _quiz(payload.get("quiz"))
    if kind == "prize":
        door["prize"] = raffles.clean_prize(payload.get("prize"), opens_at(year, day), seasons.windows_for(SEASON, year)[0]["end"])
    return door


# ------------------------------------------------------------------ Was im Türchen steckt

def _link(door: dict) -> dict | None:
    return {"url": door["link_url"], "label": door.get("link_label") or "Mehr dazu"} if door.get("link_url") else None


async def _news_card(db, ref: str, viewer: dict | None) -> dict | None:
    from routes.news_routes import _published_now
    from services.visibility import user_can_see

    post = await db.news_posts.find_one({"id": ref}, {"_id": 0, "id": 1, "slug": 1, "title": 1, "excerpt": 1, "banner_url": 1, "published": 1, "published_at": 1, "visibility": 1})
    if not post or post.get("published") is False or not _published_now(post) or not await user_can_see(viewer, post.get("visibility") or "public"):
        return None
    return {"title": post.get("title"), "excerpt": post.get("excerpt") or "", "image_url": post.get("banner_url"), "url": f"/news/{post.get('slug') or post['id']}", "date": post.get("published_at")}


async def _event_card(db, ref: str, viewer: dict | None) -> dict | None:
    from services.visibility import user_can_see

    event = await db.events.find_one({"id": ref}, {"_id": 0, "id": 1, "slug": 1, "name": 1, "status": 1, "visibility": 1, "banner_url": 1, "start_date": 1, "location": 1})
    if not event or event.get("status") == "draft" or not await user_can_see(viewer, event.get("visibility") or "public"):
        return None
    return {"title": event.get("name"), "image_url": event.get("banner_url"), "url": f"/events/{event.get('slug') or event['id']}", "date": event.get("start_date"), "location": event.get("location") or ""}


async def _member_card(db, ref: str) -> dict | None:
    profile = await db.club_member_profiles.find_one({"id": ref}, {"_id": 0, "id": 1, "slug": 1, "display_name": 1, "gamertag": 1, "role_title": 1, "photo_url": 1, "is_active": 1})
    if not profile or profile.get("is_active") is False:
        return None
    return {"name": profile.get("gamertag") or profile.get("display_name"), "role": profile.get("role_title") or "Mitglied", "image_url": profile.get("photo_url"), "url": f"/members/{profile['slug']}" if profile.get("slug") else None}


def default_content(day: int) -> dict:
    """Ein Tag, für den nichts gepflegt ist: der Kalender bleibt ganz, das Türchen grüßt."""
    return {"kind": "text", "title": f"Türchen {day}", "body": DEFAULT_BODY, "media_url": None, "link": None, "fallback": True}


async def content_for(db, door: dict | None, day: int, viewer: dict | None = None, now: datetime | None = None) -> dict:
    """Der Inhalt, wie ihn diese Person sieht - nie mit der richtigen Quiz-Antwort, nie mit fremden Namen."""
    if not door:
        return default_content(day)
    kind = door.get("kind") if door.get("kind") in KINDS else "text"
    content = {"kind": kind, "title": door.get("title") or f"Türchen {day}", "body": door.get("body") or "", "media_url": door.get("media_url"), "link": _link(door)}
    if kind == "video":
        content["video"] = {"id": door.get("video_id"), "url": door.get("video_url")}
    elif kind == "clip":
        content["clip"] = {"id": door.get("clip_id"), "url": door.get("clip_url")}
    elif kind == "sticker":
        content["sticker"] = door.get("sticker")
    elif kind == "quiz":
        quiz = door.get("quiz") or {}
        content["quiz"] = {"question": quiz.get("question"), "answers": list(quiz.get("answers") or [])}
    elif kind == "prize":
        raffle = await db[raffles.RAFFLES].find_one({"id": door.get("raffle_id")}, {"_id": 0}) if door.get("raffle_id") else None
        if raffle:
            content["prize"] = await raffles.public_state(db, raffle, viewer, now)
        else:
            # Kopiert und für dieses Jahr noch nicht bestätigt: kein Gewinn, nur der Text.
            content["kind"] = "text"
            content["body"] = content["body"] or DEFAULT_BODY
    elif kind in ("news", "event", "member_spotlight"):
        if kind == "news":
            card = await _news_card(db, door.get("ref_id"), viewer)
        elif kind == "event":
            card = await _event_card(db, door.get("ref_id"), viewer)
        else:
            card = await _member_card(db, door.get("ref_id")) if door.get("consent_confirmed") is True else None
        if card:
            content["card"] = card
        else:
            # Der Verweis ist weg oder für diese Person nicht sichtbar: es bleibt beim Text.
            content["kind"] = "text"
            content["body"] = content["body"] or DEFAULT_BODY
    return content


# ------------------------------------------------------------------ Der Kalender für eine Person

async def _doors(db, year: int) -> dict[int, dict]:
    rows = await db[DOOR_COLLECTION].find({"year": year}, {"_id": 0}).to_list(DOORS * 2)
    return {int(row["day"]): row for row in rows if int(row.get("day") or 0) in DOOR_DAYS}


async def _openings(db, user_id: str | None, year: int) -> dict[int, dict]:
    if not user_id:
        return {}
    rows = await db[OPENINGS].find({"user_id": user_id, "year": year}, {"_id": 0}).to_list(DOORS * 2)
    return {int(row["day"]): row for row in rows}


def parse_days(value: str | None) -> set[int]:
    """``1,2,17`` aus der Adresse - Gäste merken sich im Browser, was sie geöffnet haben."""
    days = set()
    for part in str(value or "").split(",")[:DOORS * 2]:
        part = part.strip()
        if part.isdigit() and int(part) in DOOR_DAYS:
            days.add(int(part))
    return days


async def calendar_view(db, viewer: dict | None, now: datetime | None = None, guest_opened: set[int] | None = None,
                        year: int | None = None, record: bool = True) -> dict:
    """Der Kalender, wie ihn die Person jetzt sieht. ``year`` und ``record=False`` sind die Vorschau der Verwaltung:
    ein bestimmtes Jahr zu einer gewählten Zeit, ohne dass etwas gezählt wird."""
    now = seasons.to_vienna(now)
    if year is None:
        state = await running(db, now)
        if not state:
            return {"active": False, "next_start": await next_start(now)}
        year, ends_at = state["year"], state["ends_at"]
    else:
        ends_at = seasons.windows_for(SEASON, year)[0]["end"]
    doors = await _doors(db, year)
    if not doors:
        # Ein Jahr, für das noch nichts angelegt ist, zeigt keinen leeren Kalender.
        return {"active": False, "next_start": await next_start(now), "reason": "empty"}
    user_id = (viewer or {}).get("id") if record else None
    opened = await _openings(db, user_id, year)
    shown = set(opened) if user_id else set(guest_opened or ())
    items = []
    for day in DOOR_DAYS:
        available = is_open(year, day, now)
        item = {"day": day, "opens_at": opens_at(year, day).isoformat(), "seed": door_seed(year, day),
                "state": "locked" if not available else ("opened" if day in shown else "available")}
        if item["state"] == "opened":
            item["content"] = await content_for(db, doors.get(day), day, viewer, now)
            if item["content"].get("quiz") is not None:
                item["content"]["quiz"]["done"] = bool((opened.get(day) or {}).get("quiz_done"))
            if day in opened:
                item["opened_at"] = opened[day].get("opened_at")
        items.append(item)
    open_now = seasons.advent_doors_open(year, now)
    return {
        "active": True, "year": year, "now": now.isoformat(), "ends_at": ends_at.isoformat(),
        "catch_up": now.date() > date(year, 12, DOORS), "newest_door": open_now or None,
        "door_hour": seasons.ADVENT_DOOR_HOUR, "order": door_order(year), "doors": items,
        "signed_in": bool(user_id), "opened": len(opened) if user_id else len([d for d in shown if is_open(year, d, now)]), "total": DOORS,
    }


def locked_message(year: int, day: int) -> str:
    when = opens_at(year, day)
    return f"Dieses Türchen öffnet sich am {when.day}. Dezember um {when.hour} Uhr."


async def _require_open_door(db, day: int, now: datetime | None) -> tuple[dict, dict[int, dict]]:
    if day not in DOOR_DAYS:
        raise HTTPException(status_code=404, detail="Dieses Türchen gibt es nicht.")
    state = await running(db, now)
    doors = await _doors(db, state["year"]) if state else {}
    if not state or not doors:
        raise HTTPException(status_code=404, detail="Der Adventkalender ist gerade nicht geöffnet.")
    if not is_open(state["year"], day, state["now"]):
        raise HTTPException(status_code=409, detail=locked_message(state["year"], day))
    return state, doors


async def open_door(db, viewer: dict | None, day: int, now: datetime | None = None) -> dict:
    """Ein Türchen öffnen. Angemeldet zählt es einmal je Person, Jahr und Tag; Gäste sehen nur den Inhalt."""
    state, doors = await _require_open_door(db, day, now)
    year = state["year"]
    user_id = (viewer or {}).get("id")
    first = False
    newly = 0
    if user_id:
        stamp = now_utc().isoformat()
        result = await db[OPENINGS].update_one(
            {"user_id": user_id, "year": year, "day": day},
            {"$setOnInsert": {"id": new_id(), "user_id": user_id, "year": year, "day": day, "opened_at": stamp, "quiz_done": False}},
            upsert=True,
        )
        first = result.upserted_id is not None
        if first:
            newly = await _count_for_achievements(user_id)
    await db[VIEWS].update_one({"year": year, "day": day}, {"$inc": {"count": 1}, "$setOnInsert": {"year": year, "day": day}}, upsert=True)
    content = await content_for(db, doors.get(day), day, viewer, state["now"])
    opening = (await db[OPENINGS].find_one({"user_id": user_id, "year": year, "day": day}, {"_id": 0}) if user_id else None) or {}
    if content.get("quiz") is not None:
        content["quiz"]["done"] = bool(opening.get("quiz_done"))
    opened = await db[OPENINGS].count_documents({"user_id": user_id, "year": year}) if user_id else None
    return {
        "day": day, "year": year, "state": "opened", "seed": door_seed(year, day), "content": content,
        "counted": bool(user_id), "first": first, "opened": opened, "total": DOORS, "newly_awarded": newly,
        "opened_at": opening.get("opened_at"),
    }


async def _count_for_achievements(user_id: str) -> int:
    """Das Fundstück zählen (Karte „Saison-Fundstücke“) und die Erfolge gleich prüfen - leicht, nur die Zähler aus
    Signalen. Klappt das nicht, holt es die Warteschlange nach; das Türchen geht trotzdem auf."""
    from services import achievement_counters as counters

    try:
        await counters.record_signal(user_id, SIGNAL, 1, trusted=True)
        from badges import evaluate_user_progress

        return int(await evaluate_user_progress(user_id, {"signal"}, legacy=False) or 0)
    except Exception:  # noqa: BLE001 - ein Türchen scheitert nie an den Erfolgen
        import logging

        logging.getLogger("tls.advent").warning("[advent] Erfolge nach dem Öffnen nicht geprüft", exc_info=True)
        try:
            from services.achievement_queue import request_evaluation

            await request_evaluation([user_id], "advent_door", sources={"signal"})
        except Exception:  # noqa: BLE001
            pass
        return 0


async def answer_quiz(db, viewer: dict | None, day: int, answer: int, now: datetime | None = None) -> dict:
    """Die Auflösung zum Quiz. Gespeichert wird nie die Antwort - nur, dass die Person mitgemacht hat."""
    state, doors = await _require_open_door(db, day, now)
    door = doors.get(day) or {}
    quiz = door.get("quiz") if door.get("kind") == "quiz" else None
    if not quiz:
        raise HTTPException(status_code=404, detail="In diesem Türchen steckt kein Quiz.")
    if answer not in range(QUIZ_ANSWERS):
        raise HTTPException(status_code=400, detail="Diese Antwort gibt es nicht.")
    user_id = (viewer or {}).get("id")
    if user_id:
        done = await db[OPENINGS].update_one({"user_id": user_id, "year": state["year"], "day": day}, {"$set": {"quiz_done": True}})
        if not done.matched_count:
            raise HTTPException(status_code=409, detail="Öffne zuerst das Türchen.")
    return {"day": day, "correct": answer == quiz["correct"], "correct_index": quiz["correct"], "correct_answer": quiz["answers"][quiz["correct"]], "explanation": quiz.get("explanation") or "", "done": True}


async def _raffle_for_entry(db, viewer: dict | None, day: int, now: datetime | None) -> tuple[dict, dict]:
    """Die Verlosung hinter einem offenen Türchen - mitmachen kann nur, wer angemeldet ist und es geöffnet hat."""
    if not viewer or not viewer.get("id"):
        raise HTTPException(status_code=401, detail="Melde dich an, um mitzumachen.")
    state, doors = await _require_open_door(db, day, now)
    door = doors.get(day) or {}
    raffle = await db[raffles.RAFFLES].find_one({"id": door.get("raffle_id")}, {"_id": 0}) if door.get("kind") == "prize" and door.get("raffle_id") else None
    if not raffle:
        raise HTTPException(status_code=404, detail="In diesem Türchen steckt keine Verlosung.")
    if not await db[OPENINGS].find_one({"user_id": viewer["id"], "year": state["year"], "day": day}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=409, detail="Öffne zuerst das Türchen.")
    return state, raffle


async def enter_raffle(db, viewer: dict | None, day: int, now: datetime | None = None) -> dict:
    state, raffle = await _raffle_for_entry(db, viewer, day, now)
    return {"day": day, "prize": await raffles.enter(db, raffle, viewer, state["now"])}


async def withdraw_raffle(db, viewer: dict | None, day: int, now: datetime | None = None) -> dict:
    state, raffle = await _raffle_for_entry(db, viewer, day, now)
    return {"day": day, "prize": await raffles.withdraw(db, raffle, viewer, state["now"])}


# ------------------------------------------------------------------ Verwaltung

def check_year(year: int) -> int:
    if not 2024 <= int(year) <= 2100:
        raise HTTPException(status_code=400, detail="Dieses Jahr gibt es im Kalender nicht.")
    return int(year)


def _admin_door(door: dict) -> dict:
    return {key: door.get(key) for key in ("id", "year", "day", "kind", "title", "body", "media_url", "video_url", "video_id", "clip_url", "clip_id", "ref_id",
                                           "consent_confirmed", "sticker", "quiz", "prize", "raffle_id", "link_url", "link_label", "created_at", "updated_at", "updated_by", "copied_from")}


def door_problem(door: dict | None) -> str | None:
    """Warum ein gespeichertes Türchen noch nicht fertig ist - nach dem Kopieren fehlt die Einwilligung wieder."""
    if not door:
        return "Noch nichts eingetragen – an diesem Tag grüßt nur der Löwe."
    if door.get("kind") == "member_spotlight" and door.get("consent_confirmed") is not True:
        return "Die Einwilligung des Mitglieds ist für dieses Jahr noch nicht bestätigt."
    if door.get("kind") == "prize" and not door.get("raffle_id"):
        return "Der Gewinn ist für dieses Jahr noch nicht bestätigt – bitte Teilnahmeschluss prüfen und speichern."
    return None


async def admin_view(db, year: int, now: datetime | None = None) -> dict:
    year = check_year(year)
    now = seasons.to_vienna(now)
    doors = await _doors(db, year)
    openings = await db[OPENINGS].find({"year": year}, {"_id": 0, "day": 1, "opened_at": 1, "quiz_done": 1}).to_list(200000)
    views = {int(row["day"]): int(row.get("count") or 0) for row in await db[VIEWS].find({"year": year}, {"_id": 0}).to_list(DOORS * 2)}
    opened, same_day, quizzed = Counter(), Counter(), Counter()
    for row in openings:
        day = int(row.get("day") or 0)
        opened[day] += 1
        quizzed[day] += 1 if row.get("quiz_done") else 0
        try:
            when = seasons.to_vienna(datetime.fromisoformat(str(row.get("opened_at")))).date()
        except ValueError:
            continue
        same_day[day] += 1 if when == date(year, 12, day) else 0
    window = seasons.windows_for(SEASON, year)[0]
    drawings = {row["id"]: row for row in await db[raffles.RAFFLES].find({"season": SEASON, "year": year}, {"_id": 0}).to_list(DOORS * 2)}
    items = []
    for day in DOOR_DAYS:
        door = doors.get(day)
        items.append({
            "day": day, "opens_at": opens_at(year, day).isoformat(), "is_open": is_open(year, day, now), "seed": door_seed(year, day),
            "door": _admin_door(door) if door else None, "problem": door_problem(door),
            "stats": {"opened": opened[day], "same_day": same_day[day], "later": opened[day] - same_day[day], "views": views.get(day, 0), "quiz_done": quizzed[day]},
            "raffle": await raffles.admin_state(db, drawings.get((door or {}).get("raffle_id")), now) if (door or {}).get("kind") == "prize" else None,
        })
    years = sorted({int(value) for value in await db[DOOR_COLLECTION].distinct("year") if value}, reverse=True)
    return {
        "year": year, "kinds": [{"key": key, "label": label} for key, label in KIND_LABELS.items()], "door_hour": seasons.ADVENT_DOOR_HOUR,
        "starts_at": window["start"].isoformat(), "ends_at": window["end"].isoformat(), "order": door_order(year),
        "doors": items, "filled": len(doors), "total": DOORS, "years": years,
        "people": len({row_user for row_user in await db[OPENINGS].distinct("user_id", {"year": year})}),
        "running": bool(seasons.current_window(SEASON, now) and seasons.current_window(SEASON, now)["year"] == year),
    }


async def save_door(db, year: int, day: int, payload: dict, actor: dict) -> dict:
    year = check_year(year)
    if day not in DOOR_DAYS:
        raise HTTPException(status_code=404, detail="Dieses Türchen gibt es nicht.")
    door = await clean_door(db, payload, year, day)
    if door["kind"] == "prize":
        raffle = await raffles.save(
            db, season=SEASON, year=year, source_key=raffle_key(year, day), source_label=f"Türchen {day}", title=f"Adventkalender {year}",
            source_url="/advent", prize=door["prize"], actor=actor,
        )
        door["raffle_id"] = raffle["id"]
    else:
        # Aus einem Gewinn wird etwas anderes: nur, solange niemand mitmacht und nichts gezogen ist.
        await raffles.release(db, raffle_key(year, day))
        door["raffle_id"] = None
    stamp = now_utc().isoformat()
    await db[DOOR_COLLECTION].update_one(
        {"year": year, "day": day},
        {"$set": {**door, "updated_at": stamp, "updated_by": actor.get("id")}, "$unset": {"copied_from": ""},
         "$setOnInsert": {"id": new_id(), "year": year, "day": day, "created_at": stamp}},
        upsert=True,
    )
    return _admin_door(await db[DOOR_COLLECTION].find_one({"year": year, "day": day}, {"_id": 0}))


async def delete_door(db, year: int, day: int) -> bool:
    year = check_year(year)
    await raffles.release(db, raffle_key(year, day))
    result = await db[DOOR_COLLECTION].delete_one({"year": year, "day": day})
    return bool(result.deleted_count)


async def _door_raffle(db, year: int, day: int) -> dict:
    door = await db[DOOR_COLLECTION].find_one({"year": check_year(year), "day": day}, {"_id": 0, "kind": 1, "raffle_id": 1}) or {}
    raffle = await db[raffles.RAFFLES].find_one({"id": door.get("raffle_id")}, {"_id": 0}) if door.get("kind") == "prize" and door.get("raffle_id") else None
    if not raffle:
        raise HTTPException(status_code=404, detail="Zu diesem Türchen gibt es keine Verlosung.")
    return raffle


async def draw_raffle(db, year: int, day: int, actor: dict, close_early: bool = False, now: datetime | None = None) -> dict:
    now = seasons.to_vienna(now)
    if not is_open(check_year(year), day, now):
        raise HTTPException(status_code=409, detail="Gezogen wird erst, wenn das Türchen offen war.")
    raffle = await raffles.draw(db, await _door_raffle(db, year, day), actor, now, close_early)
    return await raffles.admin_state(db, raffle, now)


async def redraw_raffle(db, year: int, day: int, pickup_id: str, actor: dict, now: datetime | None = None) -> dict:
    raffle = await raffles.redraw(db, await _door_raffle(db, year, day), pickup_id, actor)
    return await raffles.admin_state(db, raffle, now)


async def copy_year(db, source: int, target: int, actor: dict) -> dict:
    """Die Türchen eines Jahres in ein anderes übernehmen - nur in leere Tage, ohne Zahlen. Die Einwilligung zum
    Mitglied der Woche gilt nicht automatisch weiter: sie muss für das neue Jahr neu bestätigt werden."""
    source, target = check_year(source), check_year(target)
    if source == target:
        raise HTTPException(status_code=400, detail="Quelle und Ziel sind dasselbe Jahr.")
    rows = await _doors(db, source)
    if not rows:
        raise HTTPException(status_code=404, detail=f"Für {source} sind keine Türchen angelegt.")
    existing = await _doors(db, target)
    stamp = now_utc().isoformat()
    copied, skipped, reconfirm = [], [], []
    for day in DOOR_DAYS:
        row = rows.get(day)
        if not row:
            continue
        if day in existing:
            skipped.append(day)
            continue
        door = {key: row.get(key) for key in ("kind", "title", "body", "media_url", "video_url", "video_id", "clip_url", "clip_id", "ref_id", "sticker", "quiz", "link_url", "link_label")}
        door["consent_confirmed"] = False
        # Der Gewinn wandert als Vorschlag mit - ohne Verlosung und ohne den Teilnahmeschluss vom Vorjahr.
        door["prize"] = {key: value for key, value in (row.get("prize") or {}).items() if key != "closes_at"} or None
        door["raffle_id"] = None
        if door["kind"] in ("member_spotlight", "prize"):
            reconfirm.append(day)
        await db[DOOR_COLLECTION].insert_one({**door, "id": new_id(), "year": target, "day": day, "created_at": stamp, "updated_at": stamp, "updated_by": actor.get("id"), "copied_from": source})
        copied.append(day)
    return {"source": source, "target": target, "copied": copied, "skipped": skipped, "reconfirm": reconfirm}


def _day_text(value) -> str:
    try:
        moment = seasons.to_vienna(datetime.fromisoformat(str(value).replace("Z", "+00:00")))
    except ValueError:
        return ""
    return f"{moment.day}.{moment.month}.{moment.year}"


async def editor_options(db) -> dict:
    """Was sich in ein Türchen legen lässt: News, Events, Mitglieder und Sticker - mit einem Hinweis, wenn etwas
    (noch) nicht für alle sichtbar ist. So braucht die Pflege keine weiteren Rechte als die für den Kalender."""
    from services.stickers import list_sticker_packs

    visibility = {"members": "nur Mitglieder", "community": "nur angemeldet", "internal": "nur intern"}
    news = []
    for row in await db.news_posts.find({}, {"_id": 0, "id": 1, "title": 1, "published": 1, "published_at": 1, "visibility": 1}).sort([("published_at", -1), ("created_at", -1)]).to_list(120):
        hints = [_day_text(row.get("published_at")), "Entwurf" if row.get("published") is False else "", visibility.get(row.get("visibility") or "public", "")]
        news.append({"id": row["id"], "label": row.get("title") or "Ohne Titel", "hint": " · ".join(hint for hint in hints if hint)})
    events = []
    for row in await db.events.find({"status": {"$nin": ["archived", "cancelled"]}}, {"_id": 0, "id": 1, "name": 1, "status": 1, "start_date": 1, "visibility": 1}).sort("start_date", -1).to_list(120):
        hints = [_day_text(row.get("start_date")), "Entwurf" if row.get("status") == "draft" else "", visibility.get(row.get("visibility") or "public", "")]
        events.append({"id": row["id"], "label": row.get("name") or "Ohne Titel", "hint": " · ".join(hint for hint in hints if hint)})
    members = []
    for row in await db.club_member_profiles.find({"is_active": {"$ne": False}}, {"_id": 0, "id": 1, "display_name": 1, "gamertag": 1, "role_title": 1}).sort([("order_index", 1), ("display_name", 1)]).to_list(400):
        members.append({"id": row["id"], "label": row.get("gamertag") or row.get("display_name") or "Ohne Namen", "hint": row.get("role_title") or "Mitglied"})
    stickers = [
        {"id": pack["id"], "name": pack["name"], "stickers": [{"id": sticker["id"], "name": sticker.get("name") or "Sticker", "url": sticker["url"]} for sticker in pack["stickers"]]}
        for pack in await list_sticker_packs(db)
    ]
    return {"news": news, "events": events, "members": members, "stickers": stickers, "audiences": [{"key": key, "label": label} for key, label in raffles.AUDIENCES.items()], "max_winners": raffles.MAX_WINNERS}


# ------------------------------------------------------------------ Für die Erfolge und den Datenschutz

async def doors_in_best_year(db, user_id: str) -> int:
    """Die meisten Türchen in einem Advent - „Alle Türchen“ heißt 24 von 24 im selben Jahr."""
    rows = await db[OPENINGS].find({"user_id": user_id}, {"_id": 0, "year": 1}).to_list(DOORS * 100)
    per_year = Counter(int(row.get("year") or 0) for row in rows)
    return max(per_year.values(), default=0)
