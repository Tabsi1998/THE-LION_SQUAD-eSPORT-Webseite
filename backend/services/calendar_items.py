"""Kalender (#402): eine Zusammenstellung der Termine für Website und Abo-Feed.

Events, Turniere und Fast-Lap-Challenges, so wie die App sie seit #216 zeigt - hier einmal am
Server, damit Website, Feed und Startseite dieselbe Liste bekommen. Was jemand sehen darf,
entscheidet `user_can_see` (public/community/members/internal, #342); ein nicht-öffentliches
Turnier bleibt draußen. Der Abo-Feed ist immer die anonyme Sicht: keine Personendaten, keine
internen Termine, kein „angemeldet“.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from services.public_phase import derive_public_phase
from services.visibility import user_can_see

KIND_LABELS = {"event": "Event", "tournament": "Turnier", "fastlap": "Fast Lap"}
ACTIVE_EVENT_REGISTRATION = ("registered", "checked_in", "waitlist")
INACTIVE_TOURNAMENT_REGISTRATION = ("cancelled", "rejected", "withdrawn", "no_show")
FINISHED = {"completed", "results_published", "archived", "cancelled"}
# Ein Termin ohne Ende dauert im Feed zwei Stunden - wie „In meinen Kalender“ (#216).
DEFAULT_DURATION = timedelta(hours=2)

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
        place = ", ".join(part for part in (ev.get("location"), ev.get("city")) if part)
        item = _item("event", ev, title=ev.get("name") or "Event", path=f"/events/{ev.get('slug') or ev.get('id')}",
                     start=ev.get("start_date"), end=ev.get("end_date"), location=place, mine=ev.get("id") in my_events)
        if item:
            items.append(item)
    for t in tournaments:
        if not await user_can_see(user, t.get("visibility")):
            continue
        path = f"/tournaments/{t.get('slug') or t.get('id')}"
        item = _item("tournament", t, title=t.get("title") or "Turnier", path=path, start=t.get("start_date"),
                     end=t.get("end_date"), location=t.get("game_name"), mine=t.get("id") in my_tournaments)
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


def ics_feed(items: list[dict], *, origin: str, now: datetime | None = None, name: str = "THE LION SQUAD Termine") -> str:
    """Der öffentliche Feed - nur was `collect(db, None)` liefert, ohne `mine`."""
    now = now or datetime.now(timezone.utc)
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//THE LION SQUAD//Website//DE", "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH", f"X-WR-CALNAME:{_ics_text(name)}", "X-WR-TIMEZONE:Europe/Vienna",
    ]
    for item in items:
        start = _dt(item.get("start"))
        if not start:
            continue
        end = _dt(item.get("end"))
        if not end or end <= start:
            end = start + DEFAULT_DURATION
        detail = [KIND_LABELS.get(item["kind"], item["kind"])]
        if item.get("phase", {}) and item["phase"].get("label"):
            detail.append(item["phase"]["label"])
        lines += [
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
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    folded = [piece for line in lines for piece in _fold(line)]
    return "\r\n".join(folded) + "\r\n"
