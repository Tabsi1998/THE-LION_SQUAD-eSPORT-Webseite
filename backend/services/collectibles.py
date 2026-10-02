"""Saison-Fundstücke (#678): was jemand über die Jahreszeiten gesammelt hat - verscheuchte Fledermäuse, befreite
Geister, gefangene Schneeflocken, geöffnete Türchen, gefundene Eier.

Die Zahlen kommen aus den Signalen (``user_signals``, je Tag gezählt und gedeckelt). Hier steht nur, welche Signale
Fundstücke sind, wie sie heißen, zu welcher Saison sie gehören - und die Übersicht für das eigene Profil. Wer was
gesammelt hat, sieht nur die Person selbst.
"""
from __future__ import annotations

from datetime import date, datetime

from services import seasons
from services.achievement_counters import SIGNAL_RULES, SIGNALS, VIENNA

# Reihenfolge wie im Jahr, beginnend mit dem Herbst. ``icon`` wählt die kleine Figur in Web und App.
COLLECTIBLES: tuple[dict, ...] = (
    {"signal": "halloween_bats_scared", "season": "halloween", "label": "Fledermäuse verscheucht", "icon": "bat"},
    {"signal": "halloween_ghosts_freed", "season": "halloween", "label": "Geister befreit", "icon": "ghost"},
    {"signal": "halloween_cat_petted", "season": "halloween", "label": "Katze angestupst", "icon": "cat"},
    {"signal": "halloween_pumpkin", "season": "halloween", "label": "Gruselnächte erlebt", "icon": "pumpkin"},
    {"signal": "snowflakes_clicked", "season": "snow", "label": "Schneeflocken gefangen", "icon": "snowflake"},
    {"signal": "advent_door", "season": "advent_calendar", "label": "Türchen geöffnet", "icon": "door"},
    {"signal": "online_at_new_year", "season": "new_year", "label": "Silvester um Mitternacht dabei", "icon": "rocket"},
    {"signal": "easter_egg", "season": "easter_hunt", "label": "Ostereier gefunden", "icon": "egg"},
)
COLLECTIBLE_SIGNALS: tuple[str, ...] = tuple(item["signal"] for item in COLLECTIBLES)
SEASON_ORDER: tuple[str, ...] = tuple(dict.fromkeys(item["season"] for item in COLLECTIBLES))
# Kurze Namen für die Karte - „Schneefall“ und „Ostereiersuche“ heißen dort Winter und Ostern.
SEASON_LABELS = {"halloween": "Halloween", "snow": "Winter", "advent_calendar": "Adventkalender", "new_year": "Silvester", "easter_hunt": "Ostern"}


def total_of(signals: dict[str, dict]) -> int:
    """Alle Fundstücke zusammen - der Zähler für den „Sammler“."""
    return sum(int((signals.get(name) or {}).get("count") or 0) for name in COLLECTIBLE_SIGNALS)


def _in_window(day: str, window: dict | None) -> bool:
    if not window:
        return False
    try:
        moment = date.fromisoformat(day)
    except ValueError:
        return False
    return window["start"].date() <= moment <= window["end"].date()


def _latest_window(key: str, now: datetime, founded) -> dict | None:
    """Das Fenster, das gerade läuft - sonst das letzte, das schon vorbei ist."""
    current = seasons.current_window(key, now, founded)
    if current:
        return current
    past = [window for year in (now.year - 1, now.year) for window in seasons.windows_for(key, year, founded) if window["end"] < now]
    return max(past, key=lambda window: window["end"]) if past else None


def public_view(full: dict) -> dict:
    """Was andere auf dem öffentlichen Profil sehen (#678, nur mit Schalter): je Saison und Fundstück die Summe - kein
    „heute“, kein Datum, kein Tagesdeckel; das verriete, wann jemand online war. Saisonen ohne Fund fallen weg."""
    seasons_out = []
    for season in full.get("seasons") or []:
        items = [{"signal": item["signal"], "label": item["label"], "icon": item["icon"], "count": item["count"]} for item in season.get("items") or [] if item.get("count")]
        if items:
            seasons_out.append({"key": season["key"], "label": season["label"], "count": sum(item["count"] for item in items), "items": items})
    return {"total": full.get("total", 0), "seasons": seasons_out}


async def overview(db, user_id: str, stored: dict | None = None, founded=None, now: datetime | None = None) -> dict:
    """Die Fundstücke einer Person je Saison: insgesamt, in der laufenden (oder letzten) Saison, heute - mit dem
    Tagesdeckel und dem nächsten Termin der Saison."""
    now = seasons.to_vienna(now)
    founded_on = seasons.parse_founded(founded)
    today = now.astimezone(VIENNA).date().isoformat()
    names = list(COLLECTIBLE_SIGNALS)
    rows = await db[SIGNALS].find({"user_id": user_id, "name": {"$in": names}}, {"_id": 0}).to_list(len(names))
    signals = {row["name"]: row for row in rows}
    running = {state["key"] for state in seasons.active(now, stored, founded)["seasons"]}
    out = []
    for key in SEASON_ORDER:
        latest = _latest_window(key, now, founded_on)
        upcoming = seasons.next_window(key, now, founded_on)
        items = []
        for item in COLLECTIBLES:
            if item["season"] != key:
                continue
            doc = signals.get(item["signal"]) or {}
            days = doc.get("days") or {}
            items.append({
                "signal": item["signal"], "label": item["label"], "icon": item["icon"],
                "count": int(doc.get("count") or 0),
                "season_count": sum(int(value or 0) for day, value in days.items() if _in_window(day, latest)),
                "today": int(days.get(today) or 0),
                "per_day": int(SIGNAL_RULES[item["signal"]]["per_day"]),
                "first_at": doc.get("first_at"), "last_at": doc.get("last_at"),
            })
        out.append({
            "key": key, "label": SEASON_LABELS.get(key, seasons.SEASONS[key]["label"]), "active": key in running,
            "count": sum(item["count"] for item in items),
            "next_start": upcoming["start"].isoformat() if upcoming and key not in running else None,
            "ends_at": latest["end"].isoformat() if latest and key in running else None,
            "items": items,
        })
    return {"total": total_of(signals), "seasons": out, "now": now.isoformat()}
