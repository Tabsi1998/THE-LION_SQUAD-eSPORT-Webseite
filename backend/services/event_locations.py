"""Events an mehreren Standorten (#203) und die Karte aus der Adresse (#204).

Ein Event kann an einem oder mehreren Standorten stattfinden. Jeder Standort hat einen Namen
(„Vereinsheim“, „Gemeindesaal Telfs“ - optional), eine Postadresse, eigene Zeiten (Start, Ende,
Einlass) und bei Bedarf eine Platzzahl als Hinweis. Die Anmeldung bleibt je Event - ein
Teilnehmerlimit je Standort wäre ein zweites Anmeldesystem, das kein Event heute braucht.

Keine Migration: Ein Event ohne ``locations`` ist ein Event mit genau einem Standort aus den
bisherigen Feldern (``location``, ``address``, …, ``start_date``). ``event_locations`` liefert
in beiden Fällen dieselbe Form. Speichert der Admin Standorte, spiegelt ``mirror_primary`` den
ersten in die bisherigen Felder, damit Listen, Kompaktansichten, Erinnerungen und die App
weiter dieselben Felder lesen. Die Zeiten des Events selbst bleiben der Gesamtzeitraum.

Die Karte sucht nur nach der **Adresse** (Straße, PLZ, Stadt, Land) - der Name des
Veranstaltungsorts steht daneben, sucht aber nicht mit; ohne Adresse bleibt der Name als
Rückfall (#204).
"""
from __future__ import annotations

MAX_LOCATIONS = 12
ADDRESS_FIELDS = ("address", "postal_code", "city", "country")
TIME_FIELDS = ("start_date", "end_date", "door_time")


def address_line(place: dict | None) -> str:
    place = place or {}
    city_line = " ".join(part for part in (str(place.get("postal_code") or "").strip(), str(place.get("city") or "").strip()) if part)
    return ", ".join(part for part in (str(place.get("address") or "").strip(), city_line, str(place.get("country") or "").strip()) if part)


def map_query(place: dict | None) -> str:
    """Wonach die Karte sucht: die Adresse - nicht „Vereinsheim, Telfs“ (#204)."""
    return address_line(place) or str((place or {}).get("name") or (place or {}).get("location") or "").strip()


def normalize_location(raw: dict, index: int) -> dict:
    raw = raw or {}
    seats = raw.get("max_participants")
    try:
        seats = int(seats) if seats not in (None, "") else None
    except (TypeError, ValueError):
        seats = None
    if seats is not None and seats < 0:
        seats = None
    out = {
        "key": str(raw.get("key") or "").strip()[:40] or f"ort-{index + 1}",
        "name": str(raw.get("name") or raw.get("location") or "").strip()[:120],
        "note": str(raw.get("note") or "").strip()[:500],
        "max_participants": seats,
        "order": index,
    }
    for field in ADDRESS_FIELDS:
        out[field] = str(raw.get(field) or "").strip()[:120]
    for field in TIME_FIELDS:
        value = raw.get(field)
        out[field] = value.isoformat() if hasattr(value, "isoformat") else (str(value).strip() or None) if value else None
    return out


def normalize_locations(raw_list) -> list[dict]:
    if not isinstance(raw_list, list):
        raise ValueError("Standorte müssen eine Liste sein.")
    if len(raw_list) > MAX_LOCATIONS:
        raise ValueError(f"Höchstens {MAX_LOCATIONS} Standorte je Event.")
    places = [normalize_location(item, index) for index, item in enumerate(raw_list)]
    for place in places:
        if not (place["name"] or address_line(place)):
            raise ValueError(f"Standort {place['order'] + 1}: Name oder Adresse fehlt.")
    keys = [place["key"] for place in places]
    if len(set(keys)) != len(keys):
        raise ValueError("Standorte brauchen eindeutige Schlüssel.")
    return places


def primary_from_event(event: dict) -> dict | None:
    """Der eine Standort eines Events ohne Standortliste - aus den bisherigen Feldern."""
    place = {
        "key": "ort-1", "name": str(event.get("location") or "").strip(), "note": "", "max_participants": None, "order": 0,
        **{field: str(event.get(field) or "").strip() for field in ADDRESS_FIELDS},
        **{field: event.get(field) or None for field in TIME_FIELDS},
    }
    return place if (place["name"] or address_line(place)) else None


def event_locations(event: dict) -> list[dict]:
    """Alle Standorte in einer Form - mindestens der eine aus den bisherigen Feldern, wenn es ihn gibt."""
    stored = event.get("locations")
    if isinstance(stored, list) and stored:
        places = []
        for index, item in enumerate(sorted(stored, key=lambda p: (p or {}).get("order", 0))):
            place = dict(item or {})
            place.setdefault("order", index)
            # Zeiten eines Standorts ohne eigene Angabe: die des Events.
            for field in TIME_FIELDS:
                if not place.get(field):
                    place[field] = event.get(field) or None
            places.append(place)
        return places
    primary = primary_from_event(event)
    return [primary] if primary else []


def mirror_primary(places: list[dict], updates: dict) -> dict:
    """Den ersten Standort in die bisherigen Felder schreiben - Listen und App lesen die weiter."""
    if not places:
        return updates
    first = places[0]
    updates["location"] = first.get("name") or ""
    for field in ADDRESS_FIELDS:
        updates[field] = first.get(field) or ""
    return updates


def with_map(place: dict) -> dict:
    """Ein Standort für die Seite: plus Adresszeile und Kartensuche."""
    return {**place, "address_line": address_line(place), "map_query": map_query(place)}
