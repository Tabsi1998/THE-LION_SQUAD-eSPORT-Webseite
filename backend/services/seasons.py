"""Jahreszeiten (#632): welche Saison gerade läuft, in welcher Phase, wie stark - berechnet, nicht getippt.

Ostern und die Adventsonntage kommen aus Formeln, feste Termine aus einer Tabelle, alles in
Europe/Vienna. Der Betreiber schaltet je Saison (an/aus, automatisch oder erzwungen, Stärke, Kanäle,
Texte); Web und App fragen nur „was ist gerade aktiv“ und zeichnen. Reine Logik ohne Datenbank:
``active(now, stored)`` bekommt den gespeicherten Stand und die Zeit und gibt zurück, was zu zeigen ist.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import random
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

VIENNA = ZoneInfo("Europe/Vienna")
SETTINGS_ID = "seasons"
INTENSITIES = ("subtle", "normal", "full")
CHANNELS = ("web", "app")
MODES = ("auto", "force_on", "force_off")
PREFERENCES = ("on", "subtle", "off")
PREVIEW_SECONDS = 60
# Vereinsort für Wetter und Sonnenzeiten (#666); im Admin änderbar.
DEFAULT_LOCATION = {"lat": 47.2692, "lon": 11.4041, "name": "Innsbruck"}
# Erfolgs-Schlüssel, die die Jahreszeiten liefern (Zähler kommen mit Erfolge II, #616).
ACHIEVEMENT_SIGNALS = ("halloween_pumpkin", "snowflakes_clicked", "online_at_new_year", "advent_doors_opened", "easter_eggs_found")


# ------------------------------------------------------------------ Datumsformeln

def easter_sunday(year: int) -> date:
    """Ostersonntag nach der Gaußschen Osterformel (gregorianisch, gültig für jedes Jahr ab 1583)."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    m = (32 + 2 * e + 2 * i - h - k) % 7
    n = (a + 11 * h + 22 * m) // 451
    month, day = divmod(h + m - 7 * n + 114, 31)
    return date(year, month, day + 1)


def fourth_advent(year: int) -> date:
    """Der Sonntag vor dem 25.12. - fällt der 24.12. auf einen Sonntag, ist er selbst der 4. Advent."""
    christmas_eve = date(year, 12, 24)
    return christmas_eve - timedelta(days=(christmas_eve.weekday() + 1) % 7)


def first_advent(year: int) -> date:
    return fourth_advent(year) - timedelta(days=21)


def advent_sundays(year: int) -> list[date]:
    first = first_advent(year)
    return [first + timedelta(days=7 * i) for i in range(4)]


def palm_sunday(year: int) -> date:
    return easter_sunday(year) - timedelta(days=7)


def good_friday(year: int) -> date:
    return easter_sunday(year) - timedelta(days=2)


def easter_monday(year: int) -> date:
    return easter_sunday(year) + timedelta(days=1)


def carnival_tuesday(year: int) -> date:
    """Faschingsdienstag: 47 Tage vor Ostersonntag."""
    return easter_sunday(year) - timedelta(days=47)


def candles_lit(day: date) -> int:
    """Wie viele Kerzen am Kranz brennen: eine je vergangenem Adventsonntag, höchstens vier."""
    year = day.year if day.month >= 11 else day.year - 1
    return sum(1 for sunday in advent_sundays(year) if sunday <= day)


# ------------------------------------------------------------------ Zeitfenster

def at(day: date, hour: int = 0, minute: int = 0, second: int = 0) -> datetime:
    return datetime.combine(day, time(hour, minute, second), tzinfo=VIENNA)


def end_of(day: date) -> datetime:
    return at(day, 23, 59, 59)


def _windows_halloween(year: int, _founded) -> list[dict]:
    return [{"phase": "deko", "start": at(date(year, 10, 25)), "end": end_of(date(year, 11, 1))}]


def _windows_advent(year: int, _founded) -> list[dict]:
    return [{"phase": "kranz", "start": at(first_advent(year)), "end": end_of(date(year, 12, 26))}]


def _windows_snow(year: int, _founded) -> list[dict]:
    return [{"phase": "schnee", "start": at(first_advent(year)), "end": end_of(date(year + 1, 1, 6))}]


def _windows_christmas(year: int, _founded) -> list[dict]:
    return [
        {"phase": "gruss", "start": at(date(year, 12, 24)), "end": end_of(date(year, 12, 26))},
        {"phase": "abschied", "start": at(date(year + 1, 1, 6)), "end": end_of(date(year + 1, 1, 6))},
    ]


def _windows_nikolaus(year: int, _founded) -> list[dict]:
    return [{"phase": "stiefel", "start": at(date(year, 12, 6)), "end": end_of(date(year, 12, 6))}]


def _windows_advent_calendar(year: int, _founded) -> list[dict]:
    return [{"phase": "tuerchen", "start": at(date(year, 12, 1)), "end": end_of(date(year + 1, 1, 6))}]


def _windows_new_year(year: int, _founded) -> list[dict]:
    d29, d30, d31, jan1 = date(year, 12, 29), date(year, 12, 30), date(year, 12, 31), date(year + 1, 1, 1)
    return [
        {"phase": "ramp_29", "start": at(d29, 18), "end": end_of(d29)},
        {"phase": "ramp_30", "start": at(d30, 18), "end": end_of(d30)},
        {"phase": "evening_31", "start": at(d31, 18), "end": at(d31, 23, 44, 59)},
        {"phase": "pre_countdown", "start": at(d31, 23, 45), "end": at(d31, 23, 58, 59)},
        {"phase": "countdown", "start": at(d31, 23, 59), "end": at(d31, 23, 59, 59)},
        {"phase": "show", "start": at(jan1), "end": at(jan1, 0, 14, 59)},
        {"phase": "fade", "start": at(jan1, 0, 15), "end": at(jan1, 0, 44, 59)},
        {"phase": "greeting", "start": at(jan1, 0, 45), "end": end_of(jan1)},
    ]


def _windows_carnival(year: int, _founded) -> list[dict]:
    day = carnival_tuesday(year)
    return [{"phase": "deko", "start": at(day), "end": end_of(day)}]


def _windows_club_birthday(year: int, founded: date | None) -> list[dict]:
    if not founded or year <= founded.year:
        return []
    try:
        day = founded.replace(year=year)
    except ValueError:  # 29. Februar in einem Nicht-Schaltjahr → 28. Februar
        day = date(year, 2, 28)
    return [{"phase": "feier", "start": at(day), "end": end_of(day)}]


def _windows_easter(year: int, _founded) -> list[dict]:
    return [{"phase": "deko", "start": at(palm_sunday(year)), "end": end_of(easter_monday(year))}]


def _windows_easter_hunt(year: int, _founded) -> list[dict]:
    return [{"phase": "suche", "start": at(good_friday(year)), "end": end_of(easter_monday(year))}]


# Saisonen in der Reihenfolge des Jahres. ``texts``: Vorgaben, die der Betreiber überschreiben kann.
SEASONS: dict[str, dict] = {
    "halloween": {"label": "Halloween", "description": "Spinnweben, Fledermäuse und Kürbisse in der Woche um den 31. Oktober.",
                  "windows": _windows_halloween, "texts": {"greeting": "Happy Halloween von THE LION SQUAD"}},
    "advent": {"label": "Adventkranz", "description": "Vier Kerzen, angezündet je Adventsonntag, bis zum 26. Dezember.",
               "windows": _windows_advent, "texts": {}},
    "snow": {"label": "Schneefall", "description": "Schnee über der Website vom 1. Advent bis Dreikönig.",
             "windows": _windows_snow, "texts": {}},
    "nikolaus": {"label": "Nikolaus", "description": "Ein Stiefel im Footer am 6. Dezember.",
                 "windows": _windows_nikolaus, "texts": {"greeting": "Der Nikolaus war da"}},
    "advent_calendar": {"label": "Adventkalender", "description": "24 Türchen vom 1. bis 24. Dezember, nachholen bis Dreikönig.",
                        "windows": _windows_advent_calendar, "texts": {}},
    "christmas": {"label": "Weihnachten", "description": "Weihnachtsgruß vom 24. bis 26. Dezember, Abschied am 6. Jänner.",
                  "windows": _windows_christmas, "texts": {"greeting": "Frohe Weihnachten wünscht THE LION SQUAD", "farewell": "Danke fürs Mitfeiern – bis zum nächsten Jahr"}},
    "new_year": {"label": "Silvester", "description": "Raketen ab dem 29. Dezember abends, Countdown und Feuerwerk um Mitternacht, Gruß am 1. Jänner.",
                 "windows": _windows_new_year, "texts": {"greeting": "Frohes neues Jahr wünscht THE LION SQUAD"}},
    "carnival": {"label": "Fasching", "description": "Konfetti und Luftschlangen am Faschingsdienstag.",
                 "windows": _windows_carnival, "texts": {"greeting": "Schönen Fasching"}},
    "club_birthday": {"label": "Vereinsgeburtstag", "description": "Torte mit Kerzen am Gründungstag – braucht das Gründungsdatum unter Verein → Über uns.",
                      "windows": _windows_club_birthday, "texts": {"greeting": "{years} Jahre THE LION SQUAD – danke, dass ihr dabei seid"}},
    "easter": {"label": "Ostern", "description": "Eier, Hasenohren und Frühlingsfarben von Palmsonntag bis Ostermontag.",
               "windows": _windows_easter, "texts": {"greeting": "Frohe Ostern wünscht THE LION SQUAD"}},
    "easter_hunt": {"label": "Ostereiersuche", "description": "Versteckte Eier von Karfreitag bis Ostermontag – die Suche selbst braucht ein angelegtes Jahr.",
                    "windows": _windows_easter_hunt, "texts": {}},
}


def default_config(key: str) -> dict:
    return {"enabled": True, "mode": "auto", "until": None, "intensity": "normal", "channels": list(CHANNELS), "texts": dict(SEASONS[key]["texts"])}


def location_from(stored: dict | None) -> dict:
    """Der Vereinsort aus den gespeicherten Einstellungen - oder die Vorgabe, wenn nichts Brauchbares da ist."""
    saved = (stored or {}).get("location") or {}
    try:
        lat = float(saved.get("lat"))
        lon = float(saved.get("lon"))
    except (TypeError, ValueError):
        return dict(DEFAULT_LOCATION)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return dict(DEFAULT_LOCATION)
    name = str(saved.get("name") or "").strip()[:60] or DEFAULT_LOCATION["name"]
    return {"lat": round(lat, 4), "lon": round(lon, 4), "name": name}


def merge_settings(stored: dict | None) -> dict:
    """Gespeicherter Stand plus Vorgaben - für jede Saison ein vollständiger Eintrag."""
    stored = stored or {}
    seasons = {}
    for key in SEASONS:
        cfg = default_config(key)
        saved = (stored.get("seasons") or {}).get(key) or {}
        if isinstance(saved.get("enabled"), bool):
            cfg["enabled"] = saved["enabled"]
        if saved.get("mode") in MODES:
            cfg["mode"] = saved["mode"]
        if saved.get("until"):
            cfg["until"] = str(saved["until"])
        if saved.get("intensity") in INTENSITIES:
            cfg["intensity"] = saved["intensity"]
        if isinstance(saved.get("channels"), list):
            cfg["channels"] = [c for c in CHANNELS if c in saved["channels"]]
        for name in cfg["texts"]:
            value = (saved.get("texts") or {}).get(name)
            if isinstance(value, str) and value.strip():
                cfg["texts"][name] = value.strip()
        seasons[key] = cfg
    return {"enabled": stored.get("enabled", True) is not False, "seasons": seasons, "location": location_from(stored)}


def parse_founded(value) -> date | None:
    """Gründungsdatum aus Verein → Über uns (ISO-Datum); ein reines Jahr reicht nicht für einen Tag."""
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError:
        return None


def _parse_until(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=VIENNA)


def to_vienna(now: datetime | None) -> datetime:
    now = now or datetime.now(tz=VIENNA)
    return (now if now.tzinfo else now.replace(tzinfo=VIENNA)).astimezone(VIENNA)


def windows_for(key: str, year: int, founded: date | None = None) -> list[dict]:
    return SEASONS[key]["windows"](year, founded)


def current_window(key: str, now: datetime, founded: date | None = None) -> dict | None:
    """Das Fenster, in dem ``now`` liegt - Saisonen um den Jahreswechsel gehören zum Vorjahr."""
    for year in (now.year - 1, now.year):
        for window in windows_for(key, year, founded):
            if window["start"] <= now <= window["end"]:
                return {**window, "year": year}
    return None


def next_window(key: str, now: datetime, founded: date | None = None) -> dict | None:
    for year in (now.year - 1, now.year, now.year + 1):
        for window in windows_for(key, year, founded):
            if window["end"] >= now:
                return {**window, "year": year}
    return None


# ------------------------------------------------------------------ Phasendaten

def rocket_rate(phase: str, now: datetime) -> dict:
    """Raketen je Stunde (min/max) laut Rampe - untertags nichts, am 1. Jänner abends vereinzelt."""
    hour = now.hour + now.minute / 60
    if phase == "ramp_29":
        return {"min": 1, "max": 2}
    if phase == "ramp_30":
        return {"min": 3, "max": 6} if hour < 22 else {"min": 5, "max": 6}
    if phase == "evening_31":
        if hour < 21:
            return {"min": 6, "max": 10}
        if hour < 23:
            return {"min": 12, "max": 20}
        return {"min": 20, "max": 40}
    if phase == "pre_countdown":
        return {"min": 60, "max": 60}
    if phase == "countdown":
        return {"min": 60, "max": 60}
    if phase == "show":
        return {"min": 720, "max": 1440}
    if phase == "fade":
        minutes = now.minute - 15
        per_hour = max(12, round(60 - minutes * 1.6))
        return {"min": per_hour, "max": per_hour}
    if phase == "greeting":
        return {"min": 1, "max": 1} if hour >= 18 else {"min": 0, "max": 0}
    return {"min": 0, "max": 0}


def hourly_seed(now: datetime) -> int:
    """Saat je Stunde: ein Neuladen bringt nicht sofort eine neue Rakete, verschiedene Personen sehen verschiedene Momente."""
    return now.year * 1000 + now.timetuple().tm_yday * 24 + now.hour


def new_year_salvos(now: datetime) -> list[int]:
    """Sekunden (0–3599) in dieser Stunde, zu denen eine Rakete startet - aus Saat und Rampe, damit alle
    Geräte in derselben Stunde denselben Plan haben."""
    window = current_window("new_year", now)
    if not window:
        return []
    rate = rocket_rate(window["phase"], now)
    rng = random.Random(hourly_seed(now))
    count = rng.randint(rate["min"], rate["max"]) if rate["max"] else 0
    return sorted(rng.randrange(0, 3600) for _ in range(min(count, 1440)))


def phase_data(key: str, window: dict, now: datetime, founded: date | None, night: bool | None = None) -> dict:
    """Was der Client außer der Phase wissen muss. ``night`` kommt aus der Sonne (#666), sonst aus festen Stunden."""
    day = now.date()
    if key == "halloween":
        return {"night": night if night is not None else (now.hour >= 18 or now.hour < 6)}
    if key == "advent":
        return {"candles": candles_lit(day), "days_to_christmas": max(0, (date(window["year"], 12, 24) - day).days),
                "sundays": [s.isoformat() for s in advent_sundays(window["year"])]}
    if key == "snow":
        stage = 1 if day < date(window["year"], 12, 10) else 2 if day < date(window["year"], 12, 24) else 3
        return {"night": night if night is not None else (now.hour >= 20 or now.hour < 7), "snowcap_stage": stage}
    if key == "advent_calendar":
        return {"today_door": min(24, day.day) if (day.month == 12 and day.year == window["year"]) else 24, "catch_up": day.month == 1}
    if key == "new_year":
        rate = rocket_rate(window["phase"], now)
        return {"rate_per_hour": rate, "salvos": new_year_salvos(now), "seed": hourly_seed(now), "show_start": at(date(window["year"] + 1, 1, 1)).isoformat()}
    if key == "club_birthday" and founded:
        return {"years": window["year"] - founded.year}
    if key == "easter":
        return {"quiet": day == good_friday(window["year"]), "sunday": easter_sunday(window["year"]).isoformat()}
    if key == "easter_hunt":
        return {"good_friday": good_friday(window["year"]).isoformat(), "easter_monday": easter_monday(window["year"]).isoformat()}
    return {}


def render_texts(key: str, texts: dict, data: dict) -> dict:
    out = {}
    for name, value in texts.items():
        try:
            out[name] = value.format(**{k: v for k, v in data.items() if isinstance(v, (int, str))})
        except (KeyError, IndexError, ValueError):
            out[name] = value
    return out


# ------------------------------------------------------------------ Was gerade aktiv ist

def season_state(key: str, cfg: dict, now: datetime, founded: date | None, preview: bool = False, night: bool | None = None) -> dict | None:
    """Der Zustand einer Saison zu ``now`` - None, wenn nichts zu zeigen ist."""
    window = current_window(key, now, founded)
    forced = False
    if not preview:
        if not cfg["enabled"]:
            return None
        mode, until = cfg["mode"], _parse_until(cfg.get("until"))
        expired = until is not None and until < now
        if mode == "force_off" and not expired:
            return None
        if mode == "force_on" and not expired and window is None:
            forced = True
    elif window is None:
        forced = True
    if window is None:
        if not forced:
            return None
        # Erzwungen außerhalb des Fensters: das nächste Fenster leiht Phase und Jahr.
        window = next_window(key, now, founded) or {"phase": "deko", "start": now, "end": now, "year": now.year}
        if key == "new_year":
            window = {**window, "phase": "show"}
    data = phase_data(key, window, now, founded, night)
    return {
        "key": key,
        "label": SEASONS[key]["label"],
        "phase": window["phase"],
        "intensity": cfg["intensity"],
        "channels": cfg["channels"],
        "texts": render_texts(key, cfg["texts"], data),
        "starts_at": window["start"].isoformat(),
        "ends_at": window["end"].isoformat(),
        "forced": forced or preview,
        "data": data,
    }


def active(now: datetime | None, stored: dict | None, founded=None, preview_key: str | None = None, night: bool | None = None) -> dict:
    """Die öffentliche Antwort: nur, was jetzt zu zeigen ist."""
    now = to_vienna(now)
    settings = merge_settings(stored)
    founded_on = parse_founded(founded)
    seasons = []
    if preview_key in SEASONS:
        state = season_state(preview_key, settings["seasons"][preview_key], now, founded_on, preview=True, night=night)
        seasons = [state] if state else []
    elif settings["enabled"]:
        for key, cfg in settings["seasons"].items():
            state = season_state(key, cfg, now, founded_on, night=night)
            if state:
                seasons.append(state)
    return {"now": now.isoformat(), "timezone": "Europe/Vienna", "enabled": settings["enabled"], "preview": preview_key in SEASONS, "seasons": seasons}


def calendar(year: int, founded=None) -> list[dict]:
    """Alle Fenster eines Jahres in Worten - für den Admin-Reiter „Kalender“."""
    founded_on = parse_founded(founded)
    rows = []
    for key, meta in SEASONS.items():
        for window in windows_for(key, year, founded_on):
            rows.append({"key": key, "label": meta["label"], "phase": window["phase"], "start": window["start"].isoformat(), "end": window["end"].isoformat()})
    rows.sort(key=lambda row: row["start"])
    return rows


def admin_view(stored: dict | None, now: datetime | None = None, founded=None, weather: dict | None = None) -> dict:
    """Der Stand für die Admin-Seite: Konfiguration je Saison plus „läuft gerade“ und „nächstes Fenster“."""
    now = to_vienna(now)
    settings = merge_settings(stored)
    founded_on = parse_founded(founded)
    items = []
    for key, cfg in settings["seasons"].items():
        state = season_state(key, cfg, now, founded_on)
        upcoming = next_window(key, now, founded_on)
        items.append({
            "key": key, "label": SEASONS[key]["label"], "description": SEASONS[key]["description"],
            **cfg, "defaults": dict(SEASONS[key]["texts"]),
            "active_now": bool(state), "phase": state["phase"] if state else None, "forced": bool(state and state["forced"]),
            "next_start": upcoming["start"].isoformat() if upcoming else None, "next_end": upcoming["end"].isoformat() if upcoming else None,
            "needs_founded_on": key == "club_birthday" and founded_on is None,
        })
    return {"enabled": settings["enabled"], "now": now.isoformat(), "founded_on": founded_on.isoformat() if founded_on else None,
            "seasons": items, "calendar": calendar(now.year, founded_on), "intensities": list(INTENSITIES), "channels": list(CHANNELS), "location": settings["location"], "weather": weather}


# ------------------------------------------------------------------ Vorschau-Token

def _secret() -> bytes:
    return os.environ.get("JWT_SECRET", "tls-local-development-secret-store").encode("utf-8")


def preview_token(key: str, now: datetime | None = None, at_time: datetime | None = None) -> str:
    """Signiertes Kurzzeit-Token für „Vorschau 60 Sekunden“ - wirkt nur bei dem, der es mitschickt."""
    now = to_vienna(now)
    expires = int((now + timedelta(seconds=PREVIEW_SECONDS)).timestamp())
    at_part = str(int(at_time.timestamp())) if at_time else ""
    payload = f"{key}.{expires}.{at_part}"
    signature = hmac.new(_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()[:24]
    return f"{payload}.{signature}"


def read_preview_token(token: str | None, now: datetime | None = None) -> tuple[str, datetime | None] | None:
    """(Saison, simulierte Zeit) aus einem gültigen Token - sonst None."""
    if not token:
        return None
    parts = str(token).split(".")
    if len(parts) != 4:
        return None
    key, expires, at_part, signature = parts
    payload = f"{key}.{expires}.{at_part}"
    expected = hmac.new(_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()[:24]
    if not hmac.compare_digest(expected, signature) or key not in SEASONS or not expires.isdigit():
        return None
    if int(expires) < to_vienna(now).timestamp():
        return None
    at_time = datetime.fromtimestamp(int(at_part), tz=VIENNA) if at_part.isdigit() else None
    return key, at_time


def etag_for(payload: dict) -> str:
    import json
    return '"' + hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:20] + '"'


def adult_from_birth_date(value, today: date | None = None) -> bool:
    """Ab 18 (#680, Jumpscares): nur mit Geburtsdatum im Profil und mindestens 18 Jahren - sonst nie."""
    if not value:
        return False
    try:
        born = value if isinstance(value, date) else date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return False
    today = today or date.today()
    age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
    return age >= 18
