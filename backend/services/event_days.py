"""Mehrtägige Events (#884): je Tag Datum, Beginn und Ende.

Ein Event über mehrere Tage hat je Tag eigene Zeiten (Fr 18–23, Sa 10–22, So 10–16). Die Tage stehen als Liste
``days`` am Event; ``start_date``, ``end_date`` und ``door_time`` ergeben sich aus dem ersten und letzten Tag, damit
alles, was nur diese Felder liest, unverändert weiterläuft. Ein Event ohne ``days`` ist ein eintägiges Event wie bisher.

Die Zeiten sind Wiener Zeit, so wie sie im Verein gilt: gespeichert werden Datum und Uhrzeit als Text und dazu die
Zeitpunkte in UTC (``start_at``, ``end_at``, ``door_at``), gerechnet mit der Zeitzone - auch über die Zeitumstellung.
Ein Ende vor dem Beginn heißt „nach Mitternacht“ (Sa 20:00 – 02:00).

Alles hier ist reine Rechnung ohne Datenbank: prüfen, den Gesamtzeitraum ableiten, „läuft gerade“ je Tag und die
Texte, die Website, App, Discord, Kalender und Mail gleich zeigen.
"""
from __future__ import annotations

import re
from datetime import date as date_cls
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

VIENNA = ZoneInfo("Europe/Vienna")
MIN_DAYS = 2
MAX_DAYS = 14
TITLE_MAX = 60
WEEKDAYS = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")
_CLOCK = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _dt(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return (parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def _clock(value, what: str, label: str) -> tuple[int, int]:
    match = _CLOCK.match(str(value or "").strip())
    if not match:
        raise ValueError(f"{label}: {what} fehlt oder ist keine Uhrzeit (HH:MM).")
    return int(match.group(1)), int(match.group(2))


def _local(day: date_cls, hour: int, minute: int) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=VIENNA)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def normalize_days(raw_list, *, location_keys: set[str] | None = None) -> list[dict]:
    """Die Tage aus dem Formular prüfen und ordnen. Fehler sind Sätze, die das Formular so zeigt.

    Regeln: zwei bis vierzehn Tage, jedes Datum einmal, Beginn und Ende je Tag, Ende nach Mitternacht erlaubt,
    Einlass nicht nach dem Beginn, kein Tag beginnt, bevor der vorige endet. Die Reihenfolge ergibt sich aus der Zeit.
    """
    if not isinstance(raw_list, list):
        raise ValueError("Die Tage müssen eine Liste sein.")
    if len(raw_list) < MIN_DAYS:
        raise ValueError("Mehrere Tage heißt mindestens zwei. Für einen Tag reichen Beginn und Ende des Events.")
    if len(raw_list) > MAX_DAYS:
        raise ValueError(f"Höchstens {MAX_DAYS} Tage je Event.")
    rows: list[tuple[datetime, datetime, dict]] = []
    for position, raw in enumerate(raw_list):
        raw = raw if isinstance(raw, dict) else {}
        label = f"Tag {position + 1}"
        date_text = str(raw.get("date") or "").strip()
        if not _DATE.match(date_text):
            raise ValueError(f"{label}: Das Datum fehlt.")
        try:
            day = date_cls.fromisoformat(date_text)
        except ValueError:
            raise ValueError(f"{label}: Das Datum gibt es nicht.") from None
        start_clock = _clock(raw.get("start"), "Der Beginn", label)
        end_clock = _clock(raw.get("end"), "Das Ende", label)
        if start_clock == end_clock:
            raise ValueError(f"{label}: Beginn und Ende sind gleich.")
        start = _local(day, *start_clock)
        end = _local(day, *end_clock)
        if end <= start:
            # Ende nach Mitternacht: der Tag läuft in den nächsten hinein.
            end = _local(day + timedelta(days=1), *end_clock)
        door = None
        door_text = str(raw.get("door") or "").strip()
        if door_text:
            door = _local(day, *_clock(door_text, "Der Einlass", label))
            if door > start:
                raise ValueError(f"{label}: Der Einlass liegt nach dem Beginn.")
        location_key = str(raw.get("location_key") or "").strip()[:40] or None
        if location_key and location_keys is not None and location_key not in location_keys:
            raise ValueError(f"{label}: Der Standort gehört nicht zu diesem Event.")
        rows.append((start, end, {
            "date": date_text,
            "start": f"{start_clock[0]:02d}:{start_clock[1]:02d}",
            "end": f"{end_clock[0]:02d}:{end_clock[1]:02d}",
            "door": door_text or None,
            "title": str(raw.get("title") or "").strip()[:TITLE_MAX],
            "location_key": location_key,
            "start_at": _iso(start),
            "end_at": _iso(end),
            "door_at": _iso(door) if door else None,
        }))
    rows.sort(key=lambda row: row[0])
    dates = [row[2]["date"] for row in rows]
    if len(set(dates)) != len(dates):
        raise ValueError("Jeder Tag kommt nur einmal vor.")
    for (_, previous_end, previous), (current_start, _, current) in zip(rows, rows[1:]):
        if current_start < previous_end:
            raise ValueError(f"Der {day_label(current)} beginnt, bevor der {day_label(previous)} endet.")
    return [row[2] for row in rows]


def stored_days(event: dict | None) -> list[dict]:
    """Die Tage eines Events, nach Beginn sortiert - leer, wenn es kein mehrtägiges Event ist."""
    raw = (event or {}).get("days")
    if not isinstance(raw, list):
        return []
    days = [day for day in raw if isinstance(day, dict) and _dt(day.get("start_at")) and _dt(day.get("end_at"))]
    if len(days) < MIN_DAYS:
        return []
    return sorted(days, key=lambda day: _dt(day["start_at"]))


def is_multi_day(event: dict | None) -> bool:
    return bool(stored_days(event))


def derived_range(days: list[dict]) -> dict:
    """Beginn, Ende und Einlass des ganzen Events aus dem ersten und letzten Tag."""
    return {"start_date": days[0]["start_at"], "end_date": days[-1]["end_at"], "door_time": days[0].get("door_at") or None}


def day_label(day: dict) -> str:
    """„Fr 17.10.“ - Wochentag und Datum, so kurz wie auf einem Plakat."""
    try:
        value = date_cls.fromisoformat(str(day.get("date")))
    except ValueError:
        return str(day.get("date") or "")
    return f"{WEEKDAYS[value.weekday()]} {value.day:02d}.{value.month:02d}."


def time_label(day: dict) -> str:
    return f"{day.get('start')}–{day.get('end')}"


def range_label(days: list[dict]) -> str:
    return f"{day_label(days[0])} – {day_label(days[-1])}"


def position(event: dict | None, now: datetime | None = None) -> dict | None:
    """Wo das Event gerade steht: vor dem ersten Tag, in einem Tag, zwischen zwei Tagen oder vorbei.

    ``index`` ist der laufende Tag bzw. der nächste (ab 0). Ohne mehrere Tage ``None``.
    """
    days = stored_days(event)
    if not days:
        return None
    current = _dt(now) or datetime.now(timezone.utc)
    for index, day in enumerate(days):
        start, end = _dt(day["start_at"]), _dt(day["end_at"])
        if start <= current < end:
            return {"state": "running", "index": index, "count": len(days), "day": day}
        if current < start:
            return {"state": "before" if index == 0 else "break", "index": index, "count": len(days), "day": day}
    return {"state": "after", "index": None, "count": len(days), "day": None}


def next_start(event: dict | None, now: datetime | None = None) -> datetime | None:
    """Beginn des laufenden bzw. nächsten Tages - danach sortieren Listen ein mehrtägiges Event."""
    where = position(event, now)
    if not where or not where.get("day"):
        return None
    return _dt(where["day"]["start_at"])


def overlaps(event: dict | None, start: datetime, end: datetime) -> bool | None:
    """Liegt einer der Tage im Zeitfenster? ``None`` bei eintägigen Events - dann gilt der Gesamtzeitraum."""
    days = stored_days(event)
    if not days:
        return None
    return any(_dt(day["start_at"]) < end and _dt(day["end_at"]) >= start for day in days)


def _relative(target: datetime, now: datetime) -> str:
    local_target, local_now = target.astimezone(VIENNA), now.astimezone(VIENNA)
    clock = local_target.strftime("%H:%M")
    delta = (local_target.date() - local_now.date()).days
    if delta == 0:
        return f"heute um {clock}"
    if delta == 1:
        return f"morgen um {clock}"
    return f"am {WEEKDAYS[local_target.weekday()]} {local_target.day:02d}.{local_target.month:02d}. um {clock}"


def now_text(event: dict | None, now: datetime | None = None) -> str:
    """Der eine Satz zum Stand: „Heute 10:00–22:00“ bzw. „Tag 2 beginnt morgen um 10:00“."""
    current = _dt(now) or datetime.now(timezone.utc)
    where = position(event, current)
    if not where:
        return ""
    if where["state"] == "after":
        return "Beendet"
    day = where["day"]
    if where["state"] == "running":
        if day["date"] == current.astimezone(VIENNA).date().isoformat():
            return f"Heute {time_label(day)}"
        return f"Läuft bis {day['end']}"
    when = _relative(_dt(day["start_at"]), current)
    if where["state"] == "before":
        return f"Beginnt {when}"
    return f"Tag {where['index'] + 1} beginnt {when}"


def phase_label(where: dict) -> str:
    number = f"Tag {where['index'] + 1}/{where['count']}"
    return f"{number} läuft" if where["state"] == "running" else number


def day_line(day: dict, *, location_name: str | None = None) -> str:
    """Eine Zeile je Tag für Mail, Discord und Kalendertext: „Sa 18.10. · 10:00–22:00 · Einlass 09:00 · Finaltag“."""
    parts = [day_label(day), time_label(day)]
    if day.get("door"):
        parts.append(f"Einlass {day['door']}")
    if location_name:
        parts.append(location_name)
    if day.get("title"):
        parts.append(day["title"])
    return " · ".join(parts)


def _location_names(event: dict) -> dict[str, str]:
    names: dict[str, str] = {}
    for place in (event or {}).get("locations") or []:
        if isinstance(place, dict) and place.get("key"):
            names[str(place["key"])] = str(place.get("name") or place.get("city") or "").strip()
    return names


def lines(event: dict | None) -> list[str]:
    names = _location_names(event or {})
    return [day_line(day, location_name=names.get(day.get("location_key") or "") or None) for day in stored_days(event)]


def summary_text(event: dict | None) -> str:
    """„3 Tage · Fr 17.10. – So 19.10.“ - leer bei eintägigen Events."""
    days = stored_days(event)
    return f"{len(days)} Tage · {range_label(days)}" if days else ""


def schedule_view(event: dict | None, now: datetime | None = None) -> dict | None:
    """Was Website und App zeigen: Überschrift, die Tage mit Zeiten und Stand, der Satz zum Jetzt.

    ``None`` bei eintägigen Events - dort bleibt die Anzeige, wie sie war.
    """
    days = stored_days(event)
    if not days:
        return None
    current = _dt(now) or datetime.now(timezone.utc)
    where = position(event, current)
    names = _location_names(event or {})
    rows = []
    next_marked = False
    for index, day in enumerate(days):
        start, end = _dt(day["start_at"]), _dt(day["end_at"])
        if end <= current:
            state = "past"
        elif start <= current:
            state = "running"
        elif not next_marked:
            state, next_marked = "next", True
        else:
            state = "upcoming"
        rows.append({
            "index": index + 1,
            "date": day["date"],
            "label": day_label(day),
            "time_label": time_label(day),
            "start": day.get("start"),
            "end": day.get("end"),
            "door": day.get("door") or None,
            "title": day.get("title") or "",
            "location_key": day.get("location_key") or None,
            "location_name": names.get(day.get("location_key") or "") or None,
            "start_at": day["start_at"],
            "end_at": day["end_at"],
            "door_at": day.get("door_at") or None,
            "ends_next_day": _dt(day["end_at"]).astimezone(VIENNA).date().isoformat() != day["date"],
            "state": state,
        })
    upcoming = next_start(event, current)
    return {
        "multi_day": True,
        "count": len(days),
        "label": summary_text(event),
        "range_label": range_label(days),
        "days": rows,
        "now": {
            "state": where["state"],
            "day_index": where["index"] + 1 if where["index"] is not None else None,
            "text": now_text(event, current),
        },
        "next_at": upcoming.isoformat() if upcoming else None,
    }


def day_of(event: dict | None, instant) -> dict | None:
    """Der Tag, an dem etwas läuft (ein Turnier unter dem Event): erst nach dem Zeitfenster, sonst nach dem Datum."""
    days = stored_days(event)
    moment = _dt(instant)
    if not days or not moment:
        return None
    for index, day in enumerate(days):
        opens = _dt(day.get("door_at")) or _dt(day["start_at"])
        if opens <= moment < _dt(day["end_at"]):
            return {"index": index + 1, "count": len(days), "label": day_label(day), "date": day["date"]}
    local_date = moment.astimezone(VIENNA).date().isoformat()
    for index, day in enumerate(days):
        if day["date"] == local_date:
            return {"index": index + 1, "count": len(days), "label": day_label(day), "date": day["date"]}
    return None
