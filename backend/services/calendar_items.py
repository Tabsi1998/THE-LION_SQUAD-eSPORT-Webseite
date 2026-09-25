"""Kalender (#402): eine Zusammenstellung der Termine für Website und Abo-Feed.

Events, Turniere und Fast-Lap-Challenges, so wie die App sie seit #216 zeigt - hier einmal am
Server, damit Website, Feed und Startseite dieselbe Liste bekommen. Was jemand sehen darf,
entscheidet `user_can_see` (public/community/members/internal, #342); ein nicht-öffentliches
Turnier bleibt draußen. Der Abo-Feed ist immer die anonyme Sicht: keine Personendaten, keine
internen Termine, kein „angemeldet“.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from services.public_phase import derive_public_phase
from services.visibility import user_can_see

KIND_LABELS = {"event": "Event", "tournament": "Turnier", "fastlap": "Fast Lap"}
ACTIVE_EVENT_REGISTRATION = ("registered", "checked_in", "waitlist")
INACTIVE_TOURNAMENT_REGISTRATION = ("cancelled", "rejected", "withdrawn", "no_show")
FINISHED = {"completed", "results_published", "archived", "cancelled"}
# Ein Termin ohne Ende dauert im Feed zwei Stunden - wie „In meinen Kalender“ (#216).
DEFAULT_DURATION = timedelta(hours=2)
# Die ICS je Termin (#580) erinnert eine Stunde vorher.
ALARM_MINUTES = 60
VIENNA = ZoneInfo("Europe/Vienna")

_EVENT_FIELDS = {"_id": 0, "id": 1, "slug": 1, "name": 1, "start_date": 1, "end_date": 1, "status": 1,
                 "visibility": 1, "location": 1, "city": 1, "event_type": 1}
_TOURNAMENT_FIELDS = {"_id": 0, "id": 1, "slug": 1, "title": 1, "start_date": 1, "end_date": 1, "status": 1,
                      "visibility": 1, "is_public": 1, "registration_open_until": 1, "game_name": 1}
_FASTLAP_FIELDS = {"_id": 0, "id": 1, "slug": 1, "title": 1, "start_date": 1, "end_date": 1, "status": 1,
                   "visibility": 1, "event_mode": 1}


def _dt(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _iso(value) -> str | None:
    dt = _dt(value)
    return dt.isoformat() if dt else None


def _item(kind: str, doc: dict, *, title: str, path: str, start, end=None, location: str | None = None,
          mine: bool = False, marker: str | None = None, item_id: str | None = None) -> dict | None:
    start_iso = _iso(start)
    if not start_iso:
        return None
    phase = derive_public_phase(dict(doc), "f1" if kind == "fastlap" else kind)
    return {
        "id": item_id or doc.get("id"),
        "kind": kind,
        "slug": doc.get("slug"),
        "title": title,
        "start": start_iso,
        "end": _iso(end),
        "status": doc.get("status"),
        "phase": {"label": phase.get("label"), "state": phase.get("state")} if isinstance(phase, dict) else None,
        "location": location or None,
        "path": path,
        "visibility": doc.get("visibility") or "public",
        "mine": bool(mine),
        "marker": marker,
    }


def event_item(doc: dict, *, mine: bool = False) -> dict | None:
    place = ", ".join(part for part in (doc.get("location"), doc.get("city")) if part)
    return _item("event", doc, title=doc.get("name") or "Event", path=f"/events/{doc.get('slug') or doc.get('id')}",
                 start=doc.get("start_date"), end=doc.get("end_date"), location=place, mine=mine)


def tournament_item(doc: dict, *, mine: bool = False) -> dict | None:
    return _item("tournament", doc, title=doc.get("title") or "Turnier", path=f"/tournaments/{doc.get('slug') or doc.get('id')}",
                 start=doc.get("start_date"), end=doc.get("end_date"), location=doc.get("game_name"), mine=mine)


def vienna(value, *, with_time: bool = True) -> str:
    """Zeit so, wie sie im Verein gilt - mit „Uhr“."""
    dt = _dt(value)
    if not dt:
        return ""
    local = dt.astimezone(VIENNA)
    return local.strftime("%d.%m.%Y, %H:%M Uhr") if with_time else local.strftime("%d.%m.%Y")


def check_in_note(doc: dict) -> str | None:
    """Turniere mit Check-in (#580): der Termin ist der Start, der Check-in steht im Text."""
    opens = _dt(doc.get("check_in_from"))
    if not opens:
        return None
    closes = _dt(doc.get("check_in_until"))
    note = f"Check-in ab {vienna(opens)}"
    if closes and closes > opens:
        same_day = closes.astimezone(VIENNA).date() == opens.astimezone(VIENNA).date()
        note += f" bis {closes.astimezone(VIENNA).strftime('%H:%M')} Uhr" if same_day else f" bis {vienna(closes)}"
    return note


async def collect(db, user: dict | None) -> list[dict]:
    """Alle sichtbaren Termine, nach Beginn sortiert - Vergangenes bleibt drin (Vormonat)."""
    events = await db.events.find({"status": {"$ne": "draft"}}, _EVENT_FIELDS).to_list(2000)
    tournaments = await db.tournaments.find({"status": {"$ne": "draft"}, "is_public": {"$ne": False}}, _TOURNAMENT_FIELDS).to_list(2000)
    fastlaps = await db.f1_challenges.find({"status": {"$ne": "draft"}}, _FASTLAP_FIELDS).to_list(2000)

    my_events: set[str] = set()
    my_tournaments: set[str] = set()
    if user:
        async for reg in db.event_registrations.find({"user_id": user["id"], "status": {"$in": list(ACTIVE_EVENT_REGISTRATION)}}, {"_id": 0, "event_id": 1}):
            my_events.add(reg.get("event_id"))
        async for reg in db.tournament_registrations.find({"user_id": user["id"], "status": {"$nin": list(INACTIVE_TOURNAMENT_REGISTRATION)}}, {"_id": 0, "tournament_id": 1}):
            my_tournaments.add(reg.get("tournament_id"))

    items: list[dict] = []
    for ev in events:
        if not await user_can_see(user, ev.get("visibility")):
            continue
        item = event_item(ev, mine=ev.get("id") in my_events)
        if item:
            items.append(item)
    for t in tournaments:
        if not await user_can_see(user, t.get("visibility")):
            continue
        path = f"/tournaments/{t.get('slug') or t.get('id')}"
        item = tournament_item(t, mine=t.get("id") in my_tournaments)
        if item:
            items.append(item)
        # Der Anmeldeschluss als eigener Eintrag, solange das Turnier noch nicht vorbei ist (#402).
        closes = _dt(t.get("registration_open_until"))
        if closes and t.get("status") not in FINISHED:
            deadline = _item("tournament", t, title=f"Anmeldeschluss: {t.get('title') or 'Turnier'}", path=path,
                             start=closes, marker="registration_close", item_id=f"{t.get('id')}-anmeldeschluss",
                             mine=t.get("id") in my_tournaments)
            if deadline:
                items.append(deadline)
    for c in fastlaps:
        if not await user_can_see(user, c.get("visibility")):
            continue
        item = _item("fastlap", c, title=c.get("title") or "Fast Lap", path=f"/fastlap/{c.get('slug') or c.get('id')}",
                     start=c.get("start_date"), end=c.get("end_date"))
        if item:
            items.append(item)
    items.sort(key=lambda item: (item["start"], item["kind"], item["title"]))
    return items


# ---------------------------------------------------------------- Abo-Feed (.ics)

def _ics_text(value: str) -> str:
    return str(value).replace("\\", "\\\\").replace("\n", "\\n").replace(";", "\\;").replace(",", "\\,")


def _stamp(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _fold(line: str) -> list[str]:
    """RFC 5545: Zeilen über 75 Byte werden mit Leerzeichen fortgesetzt."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return [line]
    out, current = [], b""
    for char in line:
        piece = char.encode("utf-8")
        if len(current) + len(piece) > (75 if not out else 74):
            out.append(current.decode("utf-8"))
            current = b""
        current += piece
    if current:
        out.append(current.decode("utf-8"))
    return [out[0]] + [f" {rest}" for rest in out[1:]]


def _vevent(item: dict, *, origin: str, now: datetime, alarm_minutes: int | None = None, extra_detail: str | None = None) -> list[str]:
    """Ein VEVENT - Feed und Einzeltermin (#580) bauen ihn gleich; der Einzeltermin trägt die Erinnerung."""
    start = _dt(item.get("start"))
    if not start:
        return []
    end = _dt(item.get("end"))
    if not end or end <= start:
        end = start + DEFAULT_DURATION
    detail = [KIND_LABELS.get(item["kind"], item["kind"])]
    if item.get("phase", {}) and item["phase"].get("label"):
        detail.append(item["phase"]["label"])
    if extra_detail:
        detail.append(extra_detail)
    lines = [
        "BEGIN:VEVENT",
        f"UID:{item['kind']}-{item['id']}@lionsquad.at",
        f"DTSTAMP:{_stamp(now)}",
        f"DTSTART:{_stamp(start)}",
        f"DTEND:{_stamp(end)}",
        f"SUMMARY:{_ics_text(item['title'])}",
        f"DESCRIPTION:{_ics_text(' · '.join(detail))}",
        f"URL:{origin}{item['path']}",
    ]
    if item.get("location"):
        lines.append(f"LOCATION:{_ics_text(item['location'])}")
    if item.get("status") == "cancelled":
        lines.append("STATUS:CANCELLED")
    if alarm_minutes:
        lines += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{_ics_text(item['title'])}", f"TRIGGER:-PT{int(alarm_minutes)}M", "END:VALARM"]
    lines.append("END:VEVENT")
    return lines


def _calendar(lines: list[str], *, name: str | None = None) -> str:
    head = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//THE LION SQUAD//Website//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"]
    if name:
        head.append(f"X-WR-CALNAME:{_ics_text(name)}")
    head.append("X-WR-TIMEZONE:Europe/Vienna")
    folded = [piece for line in head + lines + ["END:VCALENDAR"] for piece in _fold(line)]
    return "\r\n".join(folded) + "\r\n"


def ics_feed(items: list[dict], *, origin: str, now: datetime | None = None, name: str = "THE LION SQUAD Termine") -> str:
    """Der öffentliche Feed - nur was `collect(db, None)` liefert, ohne `mine`."""
    now = now or datetime.now(timezone.utc)
    lines: list[str] = []
    for item in items:
        lines += _vevent(item, origin=origin, now=now)
    return _calendar(lines, name=name)


def ics_single(item: dict, *, origin: str, now: datetime | None = None, alarm_minutes: int | None = ALARM_MINUTES, extra_detail: str | None = None) -> str:
    """Ein Termin als ICS-Datei (#580): gleiche Felder wie im Feed, Erinnerung eine Stunde vorher."""
    now = now or datetime.now(timezone.utc)
    return _calendar(_vevent(item, origin=origin, now=now, alarm_minutes=alarm_minutes, extra_detail=extra_detail))


def ics_filename(item: dict) -> str:
    """Dateiname aus dem Titel - wie „In meinen Kalender“ im Web (ASCII, Bindestriche)."""
    base = str(item.get("title") or "termin")
    base = base.replace("ß", "ss").replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("Ä", "Ae").replace("Ö", "Oe").replace("Ü", "Ue")
    base = re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")
    return f"{base or 'termin'}.ics"
