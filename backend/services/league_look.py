"""Gestaltung der Liga (#2107): Emblem, Banner mit Fokuspunkt, Akzentfarbe und Gewinne.

- **Wo:** Emblem, Banner und Fokuspunkt an der Liga (``leagues``) und - überschreibend - an der Season
  (``league_seasons``); die Akzentfarbe nur an der Liga; Gewinne an der Season und optional an der Liga N
  (``league_divisions.prizes``).
- **Rückfälle:** Season → Liga → Standard (``None``: das Web zeigt dann das Liga-Zeichen bzw. kein Banner und die
  Vereinsfarbe). Gewinne: Liga N → Season.
- **Nur eigene Bilder:** wie das Logo einer Spur (``services/series_logo.py``, #2014) - nur eigene Upload-Adressen,
  die in der Mediathek stehen. Das Emblem kommt über den Logo-Upload (SVG wird dort bereinigt, PNG/WebP neu
  kodiert), Banner und Gewinnbilder über den Bild-Upload (kein SVG).
- **Akzentfarbe:** ``#RRGGBB`` mit mindestens 4,5 : 1 Kontrast zum dunklen Seitengrund - sonst wäre Text in der
  Farbe nicht lesbar. Leer heißt Vereinsfarbe.
- **Gewinne** sind reine Anzeige („Um was gespielt wird“): kein Bezug zu XP, Pokalen oder Jahreswertung -
  Staffeln bleiben dafür ``NOT_LEAGUE``.
"""
from __future__ import annotations

import re

from services import series_logo

EMBLEM = "emblem_url"
BANNER = "banner_url"
FOCUS = "banner_focus"
ACCENT = "accent_color"
PRIZES = "prizes"
LEAGUE_FIELDS = (EMBLEM, BANNER, FOCUS, ACCENT)
SEASON_FIELDS = (EMBLEM, BANNER, FOCUS, PRIZES)
FOCUS_KEYS = ("x", "y", "mobile_x", "mobile_y")
DEFAULT_FOCUS = {key: 50 for key in FOCUS_KEYS}

# Banner und Gewinnbilder: eigene Uploads ohne SVG (nur der Logo-Upload bereinigt SVG).
IMAGE_URL = re.compile(r"/api/static/uploads/[A-Za-z0-9][A-Za-z0-9_-]{0,150}\.(png|webp|jpg|jpeg)")
IMAGE_REFUSED = "Bild bitte über „Hochladen“ oder die Mediathek wählen (PNG, JPG oder WebP)."
IMAGE_MISSING = "Bild nicht in der Mediathek gefunden – bitte neu hochladen."

HEX_COLOR = re.compile(r"#?([0-9A-Fa-f]{6})")
# Der dunkle Seitengrund (bg-[#0A0A0A]) - dagegen muss die Akzentfarbe lesbar sein (WCAG AA für Text).
PAGE_BACKGROUND = "#0A0A0A"
MIN_CONTRAST = 4.5
COLOR_REFUSED = "Akzentfarbe bitte als Farbwert wie #29B6E8 angeben."
PRIZE_DOUBLE = "Jeder Platz nur einmal bei den Gewinnen."


class LookProblem(ValueError):
    """Eine Gestaltung, die nicht passt - mit deutscher Meldung (422)."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


# ---------------------------------------------------------------- Farbe

def _channel(value: int) -> float:
    part = value / 255
    return part / 12.92 if part <= 0.03928 else ((part + 0.055) / 1.055) ** 2.4


def luminance(color: str) -> float:
    """Relative Helligkeit nach WCAG für ``#RRGGBB``."""
    text = color.lstrip("#")
    red, green, blue = (int(text[index:index + 2], 16) for index in (0, 2, 4))
    return 0.2126 * _channel(red) + 0.7152 * _channel(green) + 0.0722 * _channel(blue)


def contrast(first: str, second: str) -> float:
    lighter, darker = sorted((luminance(first), luminance(second)), reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


def clean_accent(value) -> str | None:
    """``#RRGGBB`` in Großbuchstaben oder ``None`` (Vereinsfarbe). Zu dunkel auf dem Seitengrund: ``LookProblem``."""
    text = str(value or "").strip()
    if not text:
        return None
    match = HEX_COLOR.fullmatch(text)
    if not match:
        raise LookProblem(COLOR_REFUSED)
    color = f"#{match.group(1).upper()}"
    ratio = contrast(color, PAGE_BACKGROUND)
    if ratio < MIN_CONTRAST:
        shown = f"{ratio:.1f}".replace(".", ",")
        raise LookProblem(f"Die Akzentfarbe ist auf dem dunklen Grund zu schwach (Kontrast {shown} : 1, nötig 4,5 : 1) "
                          "– bitte eine hellere Farbe wählen oder leer lassen (Vereinsfarbe).")
    return color


# ---------------------------------------------------------------- Bilder

def clean_emblem(value) -> str | None:
    try:
        return series_logo.clean(value)
    except ValueError:
        raise LookProblem("Emblem bitte über „Hochladen“ oder die Mediathek wählen (SVG, PNG, JPG oder WebP).") from None


def clean_image(value) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if not IMAGE_URL.fullmatch(text):
        raise LookProblem(IMAGE_REFUSED)
    return text


def clean_focus(value) -> dict | None:
    if value is None:
        return None
    raw = value.model_dump() if hasattr(value, "model_dump") else dict(value)
    out = {}
    for key in FOCUS_KEYS:
        try:
            number = int(round(float(raw.get(key, 50))))
        except (TypeError, ValueError):
            number = 50
        out[key] = min(100, max(0, number))
    return out


def clean_prizes(rows) -> list[dict] | None:
    """Gewinne nach Platz sortiert; Text auf eine Zeile, jeder Platz nur einmal. Leer heißt keine (``None``)."""
    if rows is None:
        return None
    out = []
    for row in rows:
        item = row.model_dump() if hasattr(row, "model_dump") else dict(row)
        text = " ".join(str(item.get("text") or "").split())
        if not text:
            continue
        out.append({"place": int(item["place"]), "text": text[:160], "image_url": clean_image(item.get("image_url"))})
    places = [row["place"] for row in out]
    if len(places) != len(set(places)):
        raise LookProblem(PRIZE_DOUBLE)
    return sorted(out, key=lambda row: row["place"]) or None


def clean(body: dict, fields: tuple[str, ...]) -> dict:
    """Die gesetzten Gestaltungs-Felder aus ``body`` (nur ``fields``) geprüft - ``None`` heißt entfernen."""
    cleaners = {EMBLEM: clean_emblem, BANNER: clean_image, FOCUS: clean_focus, ACCENT: clean_accent,
                PRIZES: clean_prizes}
    return {key: cleaners[key](body[key]) for key in fields if key in body}


def image_urls(fields: dict) -> list[str]:
    urls = [fields.get(EMBLEM), fields.get(BANNER)]
    urls += [row.get("image_url") for row in fields.get(PRIZES) or []]
    return [url for url in urls if url]


async def check_uploaded(db, fields: dict) -> None:
    """Jede Bild-Adresse muss über den Upload in die Mediathek gekommen sein."""
    for url in image_urls(fields):
        if not await db.media_uploads.find_one({"url": url, "media_type": "image"}, {"_id": 1}):
            raise LookProblem(IMAGE_MISSING)


# ---------------------------------------------------------------- Rückfälle

def banner_of(owner: dict | None) -> dict | None:
    """Das Banner eines Eintrags mit Fokuspunkt - ohne eigenes ``None``."""
    url = (owner or {}).get(BANNER)
    if not url:
        return None
    return {"url": url, **DEFAULT_FOCUS, **{key: value for key, value in ((owner or {}).get(FOCUS) or {}).items()
                                            if key in FOCUS_KEYS}}


def effective(league: dict | None, season: dict | None = None) -> dict:
    """Was gezeigt wird: Emblem und Banner der Season, sonst der Liga, sonst nichts; die Farbe der Liga."""
    return {
        "emblem_url": (season or {}).get(EMBLEM) or (league or {}).get(EMBLEM) or None,
        "banner": banner_of(season) or banner_of(league),
        "accent_color": (league or {}).get(ACCENT) or None,
    }


def effective_banner_url(league: dict | None, season: dict | None) -> str | None:
    return (effective(league, season)["banner"] or {}).get("url")


def division_prizes(division: dict | None) -> list[dict] | None:
    """Die eigenen Gewinne einer Liga N - ``None`` heißt: sie spielt um die der Season."""
    return list((division or {}).get(PRIZES) or []) or None
