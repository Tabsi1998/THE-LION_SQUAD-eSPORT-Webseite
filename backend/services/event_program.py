"""Event als Klammer in der Verwaltung (#1371): Turniere und Fast Laps gehören zu einem Event, wenn sie im Event
angelegt oder dort hinzugefügt werden - ein Weg statt zwei. Hier stehen die Regeln dafür, die Routen sind in
``routes/event_program_routes.py``.

- **Vorbelegung:** Neu im Event Angelegtes übernimmt Ort, Tag, Partner und die Discord-Einstellungen des Events. Was
  im Formular schon gesetzt ist, bleibt.
- **Zeitraum:** Ein Turnier beginnt an einem Tag des Events (Wiener Zeit); eine Fast Lap überschneidet sich mit dem
  Event. Ohne Termin an einer Seite gibt es nichts zu prüfen.
- **Ein Event je Eintrag:** Gehört ein Turnier schon zu einem anderen Event, wird es dort erst gelöst.
"""
from __future__ import annotations

from datetime import date

from services.event_recap import last_day, vienna_day

KINDS = {"tournament": "tournaments", "fastlap": "f1_challenges"}
KIND_WORD = {"tournament": "Das Turnier", "fastlap": "Die Fast Lap"}


def first_day(event: dict) -> date | None:
    return vienna_day(event.get("start_date"))


def _day_text(day: date) -> str:
    return day.strftime("%d.%m.%Y")


def window_text(event: dict) -> str:
    start, end = first_day(event), last_day(event)
    if not start:
        return ""
    if not end or end == start:
        return f"am {_day_text(start)}"
    return f"vom {_day_text(start)} bis {_day_text(end)}"


def location_line(event: dict) -> str:
    """Der Ort des Events in einer Zeile, wie ihn ein Turnier als Ort trägt: „Vereinsheim · Telfs“."""
    if event.get("is_online") and not event.get("is_hybrid"):
        return "Online"
    parts = [str(event.get(key) or "").strip() for key in ("location", "city")]
    return " · ".join(part for part in parts if part)


def event_mode(event: dict) -> str:
    if event.get("is_hybrid"):
        return "hybrid"
    if event.get("is_online"):
        return "online"
    return "local"


def tournament_defaults(event: dict) -> dict:
    """Was ein neues Turnier im Event mitbringt."""
    defaults = {
        "start_date": event.get("start_date") or None,
        "location": location_line(event) or None,
        "partner_ids": list(event.get("partner_ids") or []),
        "discord_skip": bool(event.get("discord_skip")),
        "discord_registration": event.get("discord_registration") is not False,
        "event_mode": event_mode(event),
    }
    return defaults


def fastlap_defaults(event: dict) -> dict:
    return {"start_date": event.get("start_date") or None, "end_date": event.get("end_date") or None}


def fits(event: dict, kind: str, item: dict) -> str:
    """Leerer Text, wenn der Eintrag in den Zeitraum des Events passt - sonst der Satz, warum nicht."""
    start, end = first_day(event), last_day(event) or first_day(event)
    if not start:
        return ""
    item_start = vienna_day(item.get("start_date"))
    if not item_start:
        return ""
    if kind == "fastlap":
        item_end = vienna_day(item.get("end_date")) or item_start
        if item_end >= start and item_start <= end:
            return ""
    elif start <= item_start <= end:
        return ""
    return (f"{KIND_WORD[kind]} beginnt am {_day_text(item_start)}, das Event ist {window_text(event)}. "
            "Passe den Tag an oder wähle ein anderes Event.")
