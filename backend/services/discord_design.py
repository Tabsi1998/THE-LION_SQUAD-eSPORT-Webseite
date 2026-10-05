"""Gestaltung der Discord-Meldungen (#866): Vorlagen mit Platzhaltern, geprüft gegen Discords Grenzen.

Eine Vorlage ist ein Discord-Embed als JSON - Farbe, Autorzeile, Titel, Text, Felder, kleines Bild rechts
(``thumbnail``), großes Bild, Fußzeile mit Symbol, Zeitstempel - mit Platzhaltern in geschweiften Klammern
(``{streamer}``, ``{title}`` …). Was in ``[[ … ]]`` steht, erscheint nur, wenn jeder Platzhalter darin einen Wert hat
(„🎮 {game}[[ · seit {started}]]“). Dazu optional der Text über dem Kasten (``content``) und bei Listen die Darstellung
je Eintrag: als Zeile (``row``, ergibt ``{rows}``) oder als eigenes Feld (``row_field``). Gespeichert wird nur, was
vom eingebauten Standard abweicht (Einstellung ``discord_design``); „Standard wiederherstellen“ löscht die eigene
Fassung wieder.

Werte aus der Website (Stream-Titel, Namen) werden dort, wo Discord Markdown zeigt, entschärft: ein Titel mit ``**``
macht nichts fett, ``@everyone`` darin pingt niemanden. Erwähnen kann nur ``{role}`` im Text über dem Kasten, und nur
die eine gewählte Rolle (``allowed_mentions`` beim Senden).
"""
from __future__ import annotations

import copy
import re
from datetime import datetime
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from models import now_utc

SETTINGS_ID = "discord_design"
VIENNA = ZoneInfo("Europe/Vienna")
PLACEHOLDER_RE = re.compile(r"\{([a-z_]+)\}")
OPTIONAL_RE = re.compile(r"\[\[(.+?)\]\]", re.S)
COLOR_RE = re.compile(r"^#?([0-9a-fA-F]{6})$")
MASS_MENTION_RE = re.compile(r"@(everyone|here)\b")
LIMITS = {"content": 2000, "title": 256, "description": 4096, "field_name": 256, "field_value": 1024, "fields": 25,
          "footer": 2048, "author": 256, "total": 6000}
TEMPLATE_KEYS = ("content", "color", "author", "title", "url", "description", "fields", "thumbnail", "image", "footer",
                 "timestamp", "rows", "row", "row_field", "empty", "max_rows")
SLOT_LABELS = {"content": "Text über dem Kasten", "title": "Titel", "url": "Link des Titels", "description": "Text",
               "author.name": "Autorzeile", "author.url": "Link der Autorzeile", "author.icon_url": "Bild der Autorzeile",
               "thumbnail.url": "Bild rechts", "image.url": "großes Bild", "footer.text": "Fußzeile", "footer.icon_url": "Symbol der Fußzeile",
               "row": "Zeile je Eintrag", "row_field.name": "Feldname je Eintrag", "row_field.value": "Feldinhalt je Eintrag",
               "empty": "Text ohne Einträge", "color": "Farbe"}
URL_SLOTS = ("url", "author.url", "author.icon_url", "thumbnail.url", "image.url", "footer.icon_url")

# Platzhalter, die jede Vorlage kennt: (Erklärung, Art, Beispiel). Arten: text (wird entschärft), url, raw, color.
COMMON = {
    "site": ("Adresse der Website", "url", "{origin}"),
    "club": ("Vereinsname", "text", "THE LION SQUAD"),
    "logo": ("Vereinslogo als Bild", "url", "{origin}/assets/brand/tls-favicon.png"),
    "now": ("Jetzt, z. B. 03.10.2026, 20:12 Uhr", "text", "03.10.2026, 20:12 Uhr"),
}

STREAM = {
    "streamer": ("Name (Gamertag im Mitgliederprofil)", "text", "TheLostFriday"),
    "login": ("Twitch-Name", "text", "thelostfriday"),
    "title": ("Titel des Streams", "text", "Irgendwie? Irgendwo? Aniimo!"),
    "game": ("Spiel", "text", "Aniimo"),
    "viewers": ("Zuschauer gerade", "text", "4"),
    "url": ("Link zum Stream", "url", "https://twitch.tv/thelostfriday"),
    "preview": ("Vorschaubild des Streams (wird bei jeder Aktualisierung neu geladen)", "url", "{origin}/assets/brand/og-default.png"),
    "avatar": ("Bild aus dem Mitgliederprofil", "url", "{origin}/assets/brand/tls-mascot.png"),
    "started": ("Beginn, z. B. 19:15 Uhr", "text", "19:15 Uhr"),
    "profile": ("Link zum Mitgliederprofil", "url", "{origin}/members/thelostfriday"),
    "platform": ("Plattform", "text", "Twitch"),
}

KINDS: dict[str, dict] = {
    "stream_live": {
        "label": "Stream gestartet", "group": "Streams",
        "hint": "Je Stream eine Meldung, sobald jemand aus dem Verein live geht. Zuschauer und Vorschaubild werden alle zehn Minuten aktualisiert.",
        "placeholders": {**STREAM, "role": ("Erwähnung der gewählten Rolle – pingt nur im Text über dem Kasten", "raw", "@Stream-Ping")},
        "default": {
            "content": "🔴 **{streamer}** ist jetzt live auf {platform}! {role}",
            "color": "#9146FF",
            "author": {"name": "{streamer}", "url": "{profile}", "icon_url": "{avatar}"},
            "title": "{title}",
            "url": "{url}",
            "fields": [{"name": "Spiel", "value": "{game}", "inline": True}, {"name": "Zuschauer", "value": "{viewers}", "inline": True}],
            "thumbnail": {"url": "{avatar}"},
            "image": {"url": "{preview}"},
            "footer": {"text": "{platform}[[ · live seit {started}]]", "icon_url": "{logo}"},
            "timestamp": True,
        },
    },
    "stream_ended": {
        "label": "Stream beendet", "group": "Streams",
        "hint": "So wird die Meldung, wenn der Stream vorbei ist (oder sie verschwindet – Einstellung bei den Stream-Meldungen).",
        "placeholders": {**STREAM, "duration": ("Dauer, z. B. 2 Std. 14 Min.", "text", "2 Std. 14 Min."),
                         "peak": ("Höchste Zuschauerzahl", "text", "12")},
        "default": {
            "content": "⚫ **{streamer}** war live auf {platform}.",
            "color": "#4E5058",
            "author": {"name": "{streamer}", "url": "{profile}", "icon_url": "{avatar}"},
            "title": "{title}",
            "url": "{url}",
            "description": "[[War {duration} live]][[ · bis zu {peak} Zuschauer]]",
            "fields": [{"name": "Spiel", "value": "{game}", "inline": True}],
            "thumbnail": {"url": "{avatar}"},
            "footer": {"text": "{platform} · Stream beendet", "icon_url": "{logo}"},
            "timestamp": True,
        },
    },
    "live": {
        "label": "Antwort auf /wer-streamt", "group": "Streams", "list": True, "max_rows": 10,
        "hint": "Was /wer-streamt antwortet – sieht nur, wer fragt. Ein Eintrag je Stream.",
        "placeholders": {},
        "row_placeholders": {key: STREAM[key] for key in ("streamer", "login", "title", "game", "viewers", "url", "preview", "avatar", "started", "profile", "platform")},
        "default": {
            "color": "#9146FF",
            "title": "🔴 Live jetzt",
            "url": "{site}/#live",
            "description": "{rows}",
            "rows": "fields",
            "row_field": {"name": "🔴 {streamer} · {viewers} Zuschauer", "value": "[{title}]({url})\n🎮 {game}[[ · seit {started}]]", "inline": False},
            "empty": "Gerade streamt niemand – schau später wieder vorbei.",
            "max_rows": 10,
            "thumbnail": {"url": "{logo}"},
            "footer": {"text": "Stand: {now}", "icon_url": "{logo}"},
        },
    },
    "events": {
        "label": "Nächste Events und Turniere", "group": "Angeheftete Einbettungen", "list": True, "max_rows": 5,
        "hint": "Die angeheftete Übersicht der nächsten Termine aus dem Kalender der Website.",
        "placeholders": {},
        "row_placeholders": {
            "icon": ("📅 Event, 🏆 Turnier, 🏁 Fast Lap", "text", "🏆"),
            "date": ("Datum und Uhrzeit, z. B. Sa, 03.10.2026 · 18:00 Uhr", "text", "Sa, 03.10.2026 · 18:00 Uhr"),
            "name": ("Name des Termins", "text", "Sommer-Cup"),
            "link": ("Link zur Seite des Termins", "url", "{origin}/tournaments/sommer-cup"),
            "kind": ("Event, Turnier oder Fast Lap", "text", "Turnier"),
            "state": ("Stand der Anmeldung, z. B. Anmeldung offen", "text", "Anmeldung offen"),
        },
        "default": {
            "color": "#29B6E8",
            "title": "📅 Nächste Events und Turniere",
            "url": "{site}/calendar",
            "description": "{rows}",
            "rows": "fields",
            "row_field": {"name": "{icon} {date}", "value": "**[{name}]({link})**\n{kind}[[ · {state}]]", "inline": False},
            "empty": "Nichts geplant – Termine folgen.",
            "max_rows": 5,
            "thumbnail": {"url": "{logo}"},
            "footer": {"text": "Stand: {now} · alle Termine im Kalender", "icon_url": "{logo}"},
        },
    },
    "ranking": {
        "label": "Rangliste", "group": "Angeheftete Einbettungen", "list": True, "max_rows": 10,
        "hint": "Die angeheftete Jahreswertung der laufenden Saison.",
        "placeholders": {"season": ("Name der Saison", "text", "Saison 2026"), "season_url": ("Link zur Saison", "url", "{origin}/seasons/2026")},
        "row_placeholders": {
            "medal": ("🥇, 🥈, 🥉 – ab Platz 4 die Zahl", "text", "🥇"),
            "rank": ("Platz", "text", "1"),
            "name": ("Name", "text", "Paula"),
            "points": ("Punkte", "text", "120,5"),
        },
        "default": {
            "color": "#FFD700",
            "title": "🏆 Rangliste – {season}",
            "url": "{season_url}",
            "description": "{rows}",
            "rows": "lines",
            "row": "{medal} **{name}** — {points} Punkte",
            "empty": "Noch keine Punkte vergeben.",
            "max_rows": 10,
            "thumbnail": {"url": "{logo}"},
            "footer": {"text": "Stand: {now}", "icon_url": "{logo}"},
        },
    },
    "achievement_week": {
        "label": "Erfolg der Woche", "group": "Angeheftete Einbettungen",
        "hint": "Die seltenste Freischaltung der letzten Woche – nur Personen mit öffentlichem Profil.",
        "placeholders": {
            "achievement": ("Name des Erfolgs", "text", "Eiserner Löwe"),
            "description": ("Beschreibung des Erfolgs", "text", "365 Tage in Folge angemeldet."),
            "person": ("Wer ihn freigeschaltet hat", "text", "Paula"),
            "material": ("Material, z. B. Gold", "text", "Diamant"),
            "rarity": ("Seltenheit, z. B. 0,4 % – nur diese Person", "text", "0,4 % – nur diese Person"),
            "group": ("Gruppe des Erfolgs", "text", "Treue"),
            "link": ("Link zum Profil oder zu den Erfolgen", "url", "{origin}/achievements"),
            "avatar": ("Profilbild der Person", "url", "{origin}/assets/brand/tls-mascot.png"),
            "material_color": ("Farbe des Materials", "color", "#B9F2FF"),
        },
        "default": {
            "color": "{material_color}",
            "author": {"name": "🏅 Erfolg der Woche"},
            "title": "{achievement}",
            "url": "{link}",
            "description": "{description}",
            "fields": [{"name": "Freigeschaltet von", "value": "{person}", "inline": True},
                       {"name": "Material", "value": "{material}", "inline": True},
                       {"name": "Seltenheit", "value": "{rarity}", "inline": True}],
            "thumbnail": {"url": "{avatar}"},
            "footer": {"text": "{group} · Stand: {now}", "icon_url": "{logo}"},
        },
    },
}
# Meldungen (#866 Teil 2): News, Events und Turniere - Werte aus discord_announcements (*_values), dieselben wie gesendet.
AUDIENCE = ("Für wen: leer bei öffentlich, sonst „nur für Mitglieder“", "text", "")
TOURNAMENT = {
    "title": ("Name des Turniers", "text", "Sommer-Cup"),
    "status": ("Stand, z. B. Anmeldung offen", "text", "Anmeldung offen"),
    "status_color": ("Farbe des Stands", "color", "#00FF88"),
    "link": ("Link zum Turnier", "url", "{origin}/tournaments/sommer-cup"),
}
KINDS.update({
    "news": {
        "label": "News", "group": "Meldungen",
        "hint": "Sobald eine News veröffentlicht ist – öffentliche in „News“, solche nur für Mitglieder im Mitgliederkanal. Interne News gehen "
                "ohne Text an den Vorstand; dafür gibt es keine Vorlage.",
        "placeholders": {
            "title": ("Titel der News", "text", "Neuer Vereinsrekord bei der LAN"),
            "text": ("Anrisstext (bis 400 Zeichen)", "text", "120 Leute, 14 Turniere – ein Wochenende zum Merken."),
            "link": ("Link zur News", "url", "{origin}/news/vereinsrekord"),
            "image": ("Titelbild der News", "url", "{origin}/assets/brand/og-default.png"),
            "audience": AUDIENCE,
        },
        "default": {
            "color": "#29B6E8",
            "author": {"name": "{club} · News", "url": "{site}/news", "icon_url": "{logo}"},
            "title": "📰 {title}",
            "url": "{link}",
            "description": "{text}",
            "image": {"url": "{image}"},
            "footer": {"text": "{club}[[ · {audience}]]", "icon_url": "{logo}"},
            "timestamp": True,
        },
    },
    "event": {
        "label": "Event", "group": "Meldungen",
        "hint": "Sobald ein Event veröffentlicht ist – öffentliche in „Events und Turniere“, solche nur für Mitglieder im Mitgliederkanal. Interne "
                "Events gehen ohne Text an den Vorstand.",
        "placeholders": {
            "name": ("Name des Events", "text", "LAN-Party im Vereinsheim"),
            "text": ("Kurzbeschreibung (bis 400 Zeichen)", "text", "Zwei Tage zocken, Turniere und Pizza."),
            "when": ("Wann, z. B. 10.10.2026, 18:00 Uhr – 11.10.2026", "text", "10.10.2026, 18:00 Uhr – 11.10.2026"),
            "where": ("Wo", "text", "Vereinsheim, Telfs"),
            "registration_until": ("Anmeldung bis (nur mit Anmeldung)", "text", "08.10.2026, 23:59 Uhr"),
            "places": ("Plätze (nur mit Anmeldung)", "text", "24"),
            "link": ("Link zum Event", "url", "{origin}/events/lan-party"),
            "image": ("Bild des Events", "url", "{origin}/assets/brand/og-default.png"),
            "audience": AUDIENCE,
        },
        "default": {
            "color": "#00FF88",
            "author": {"name": "{club} · Event", "url": "{site}/events", "icon_url": "{logo}"},
            "title": "📅 {name}",
            "url": "{link}",
            "description": "{text}",
            "fields": [{"name": "Wann", "value": "{when}", "inline": True}, {"name": "Wo", "value": "{where}", "inline": True},
                       {"name": "Anmeldung bis", "value": "{registration_until}", "inline": True}, {"name": "Plätze", "value": "{places}", "inline": True}],
            "image": {"url": "{image}"},
            "footer": {"text": "{club}[[ · {audience}]]", "icon_url": "{logo}"},
            "timestamp": True,
        },
    },
    "tournament": {
        "label": "Turnier: Ankündigung", "group": "Meldungen",
        "hint": "Die erste Meldung eines Turniers im Kanal (meist „Anmeldung offen“) – darunter öffnet der Bot den Thread des Turniers.",
        "placeholders": {
            **TOURNAMENT,
            "text": ("Beschreibung des Turniers", "text", "Das Vereinsturnier der Saison."),
            "game": ("Spiel", "text", "Rocket League"),
            "format": ("Format", "text", "Double Elimination"),
            "participants": ("Teilnehmer, z. B. max. 16", "text", "max. 16"),
            "banner": ("Banner des Turniers", "url", "{origin}/assets/brand/og-default.png"),
            "game_logo": ("Logo des Spiels", "url", "{origin}/assets/brand/tls-favicon.png"),
        },
        "default": {
            "color": "{status_color}",
            "author": {"name": "{club} · Turnier", "url": "{site}/tournaments", "icon_url": "{logo}"},
            "title": "🏆 {title} · {status}",
            "url": "{link}",
            "description": "{text}",
            "fields": [{"name": "Spiel", "value": "{game}", "inline": True}, {"name": "Format", "value": "{format}", "inline": True},
                       {"name": "Teilnehmer", "value": "{participants}", "inline": True}],
            "thumbnail": {"url": "{game_logo}"},
            "image": {"url": "{banner}"},
            "footer": {"text": "{club}", "icon_url": "{logo}"},
            "timestamp": True,
        },
    },
    "tournament_thread": {
        "label": "Turnier: im Thread", "group": "Meldungen",
        "hint": "Alles nach der Ankündigung, kurz im Thread des Turniers: Check-in offen, jetzt live, beendet, Ergebnisse veröffentlicht.",
        "placeholders": {**TOURNAMENT, "line": ("Der Satz zum Stand", "text", "Jetzt einchecken – bis 12.10.2026, 17:45 Uhr: auf der Turnierseite oder in der App.")},
        "default": {
            "color": "{status_color}",
            "title": "🏆 {title} · {status}",
            "url": "{link}",
            "description": "{line}",
            "footer": {"text": "{club}", "icon_url": "{logo}"},
            "timestamp": True,
        },
    },
})
FALLBACK_COLORS = {"stream_live": 0x9146FF, "stream_ended": 0x4E5058, "live": 0x9146FF, "events": 0x29B6E8, "ranking": 0xFFD700, "achievement_week": 0xA66BFF,
                   "news": 0x29B6E8, "event": 0x00FF88, "tournament": 0x29B6E8, "tournament_thread": 0x29B6E8}


# ---------------------------------------------------------------- Platzhalter

def placeholders(kind: str) -> dict[str, tuple[str, str, str]]:
    """Alle Platzhalter einer Art: gemeinsame, eigene und - bei Listen - die je Eintrag samt ``{rows}``."""
    spec = KINDS[kind]
    out = {**COMMON, **spec.get("placeholders", {})}
    if spec.get("list"):
        out["rows"] = ("Die Einträge als Zeilen – oder der Text ohne Einträge", "raw", "")
        out.update(spec.get("row_placeholders", {}))
    return out


def placeholder_rows(kind: str) -> set[str]:
    return set(KINDS[kind].get("row_placeholders", {}))


def placeholder_list(kind: str, origin: str) -> list[dict]:
    """Für den Editor: Name, Erklärung, Beispiel - und ob er nur je Eintrag gilt."""
    rows = placeholder_rows(kind)
    return [{"name": name, "text": text, "kind": kind_, "sample": sample.replace("{origin}", origin), "row": name in rows}
            for name, (text, kind_, sample) in placeholders(kind).items()]


def escape_markdown(value: str) -> str:
    """Discords Markdown entschärfen, Erwähnungen unschädlich machen - für Werte aus der Website."""
    text = re.sub(r"([\\*_~`|\[\]<])", r"\\\1", str(value))
    return MASS_MENTION_RE.sub(lambda match: "@​" + match.group(1), text)


def fill(text, values: dict, kinds: dict, *, escape: bool) -> str:
    """Platzhalter ersetzen. Unbekannte und leere Werte werden zu nichts; ein Teil in ``[[ … ]]`` fällt ganz weg,
    sobald einer seiner Platzhalter leer ist."""
    def optional(match):
        inner = match.group(1)
        return "" if any(not str(values.get(name) or "").strip() for name in PLACEHOLDER_RE.findall(inner)) else inner

    def replace(match):
        name = match.group(1)
        value = values.get(name)
        if value is None:
            return ""
        value = str(value)
        return escape_markdown(value) if escape and kinds.get(name, "text") == "text" else value
    return PLACEHOLDER_RE.sub(replace, OPTIONAL_RE.sub(optional, str(text or "")))


def tidy(text: str) -> str:
    """Was nach leeren Platzhaltern übrig bleibt: leere Links, Trennpunkte am Rand oder doppelt, leere Fettung."""
    lines = []
    for line in str(text or "").split("\n"):
        line = re.sub(r"\[\]\([^)]*\)", "", line)
        line = line.replace("****", "")
        line = re.sub(r"(\s*·\s*){2,}", " · ", line)
        line = re.sub(r"^\s*·\s*|\s*·\s*$", "", line)
        line = re.sub(r"\s{2,}", " ", line).strip()
        lines.append(line)
    return "\n".join(lines).strip()


def public_url(value: str) -> str | None:
    """Nur volle http(s)-Adressen - Discord lehnt alles andere ab (und zeigt kein Bild aus dem Heimnetz)."""
    text = str(value or "").strip()
    parsed = urlparse(text)
    if parsed.scheme in ("http", "https") and parsed.netloc and " " not in text:
        return text[:2048]
    return None


def parse_color(value, fallback: int) -> int:
    if isinstance(value, int) and 0 <= value <= 0xFFFFFF:
        return value
    match = COLOR_RE.match(str(value or "").strip())
    return int(match.group(1), 16) if match else fallback


# ---------------------------------------------------------------- Rendern

def render(kind: str, template: dict, values: dict, rows: list[dict] | None = None, *, now: datetime | None = None) -> dict:
    """Vorlage + Werte → ``{"content": str | None, "embed": dict}`` so, wie Discord es annimmt."""
    spec = KINDS[kind]
    kinds = {name: entry[1] for name, entry in placeholders(kind).items()}
    values = dict(values or {})
    current = now or now_utc()
    template = template if isinstance(template, dict) else {}
    row_fields: list[dict] = []
    if spec.get("list"):
        try:
            max_rows = max(1, min(LIMITS["fields"], int(template.get("max_rows") or spec.get("max_rows") or 10)))
        except (TypeError, ValueError):
            max_rows = spec.get("max_rows") or 10
        items = list(rows or [])[:max_rows]
        empty = tidy(fill(template.get("empty"), values, kinds, escape=True))
        if template.get("rows") == "fields":
            shape = template.get("row_field") if isinstance(template.get("row_field"), dict) else {}
            for item in items:
                merged = {**values, **item}
                name = tidy(fill(shape.get("name"), merged, kinds, escape=False))[:LIMITS["field_name"]]
                value = tidy(fill(shape.get("value"), merged, kinds, escape=True))[:LIMITS["field_value"]]
                if name and value:
                    row_fields.append({"name": name, "value": value, "inline": bool(shape.get("inline", False))})
            values["rows"] = "" if row_fields else empty
        else:
            lines = [tidy(fill(template.get("row"), {**values, **item}, kinds, escape=True)) for item in items]
            values["rows"] = "\n".join(line for line in lines if line) or empty

    embed: dict = {"color": parse_color(fill(template.get("color"), values, kinds, escape=False) if isinstance(template.get("color"), str) else template.get("color"),
                                        FALLBACK_COLORS.get(kind, 0x29B6E8))}
    title = tidy(fill(template.get("title"), values, kinds, escape=False))[:LIMITS["title"]]
    if title:
        embed["title"] = title
    url = public_url(fill(template.get("url"), values, kinds, escape=False))
    if url and title:
        embed["url"] = url
    description = tidy(fill(template.get("description"), values, kinds, escape=True))[:LIMITS["description"]]
    if description:
        embed["description"] = description
    author = template.get("author") if isinstance(template.get("author"), dict) else {}
    author_name = tidy(fill(author.get("name"), values, kinds, escape=False))[:LIMITS["author"]]
    if author_name:
        embed["author"] = {"name": author_name}
        for key in ("url", "icon_url"):
            link = public_url(fill(author.get(key), values, kinds, escape=False))
            if link:
                embed["author"][key] = link
    fields = []
    for field in template.get("fields") or []:
        if not isinstance(field, dict):
            continue
        name = tidy(fill(field.get("name"), values, kinds, escape=False))[:LIMITS["field_name"]]
        value = tidy(fill(field.get("value"), values, kinds, escape=True))[:LIMITS["field_value"]]
        if name and value:
            fields.append({"name": name, "value": value, "inline": bool(field.get("inline", True))})
    fields = (fields + row_fields)[:LIMITS["fields"]]
    if fields:
        embed["fields"] = fields
    for key in ("thumbnail", "image"):
        part = template.get(key) if isinstance(template.get(key), dict) else {}
        link = public_url(fill(part.get("url"), values, kinds, escape=False))
        if link:
            embed[key] = {"url": link}
    footer = template.get("footer") if isinstance(template.get("footer"), dict) else {}
    footer_text = tidy(fill(footer.get("text"), values, kinds, escape=False))[:LIMITS["footer"]]
    if footer_text:
        embed["footer"] = {"text": footer_text}
        icon = public_url(fill(footer.get("icon_url"), values, kinds, escape=False))
        if icon:
            embed["footer"]["icon_url"] = icon
    if template.get("timestamp"):
        embed["timestamp"] = str(values.get("timestamp_iso") or current.isoformat())
    _fit_total(embed)
    content = tidy(fill(template.get("content"), values, kinds, escape=True))[:LIMITS["content"]]
    return {"content": content or None, "embed": embed}


def embed_length(embed: dict) -> int:
    """Was Discord auf die 6000 Zeichen anrechnet."""
    total = len(embed.get("title") or "") + len(embed.get("description") or "")
    total += len((embed.get("author") or {}).get("name") or "") + len((embed.get("footer") or {}).get("text") or "")
    total += sum(len(field.get("name") or "") + len(field.get("value") or "") for field in embed.get("fields") or [])
    return total


def _fit_total(embed: dict) -> None:
    """Über 6000 Zeichen: erst Felder vom Ende, dann den Text kürzen - lieber knapp als gar nicht gesendet."""
    while embed_length(embed) > LIMITS["total"] and embed.get("fields"):
        embed["fields"].pop()
        if not embed["fields"]:
            embed.pop("fields")
    overflow = embed_length(embed) - LIMITS["total"]
    if overflow > 0 and embed.get("description"):
        embed["description"] = embed["description"][: max(0, len(embed["description"]) - overflow - 1)] + "…"


# ---------------------------------------------------------------- Prüfen

def _texts(template: dict) -> list[tuple[str, str]]:
    """Alle Textstellen einer Vorlage als (Stelle, Text)."""
    out = []
    for key in ("content", "title", "url", "description", "row", "empty", "color"):
        if isinstance(template.get(key), str):
            out.append((key, template[key]))
    for part, keys in (("author", ("name", "url", "icon_url")), ("thumbnail", ("url",)), ("image", ("url",)),
                       ("footer", ("text", "icon_url")), ("row_field", ("name", "value"))):
        value = template.get(part)
        if isinstance(value, dict):
            for key in keys:
                if isinstance(value.get(key), str):
                    out.append((f"{part}.{key}", value[key]))
    for index, field in enumerate(template.get("fields") or []):
        if isinstance(field, dict):
            for key in ("name", "value"):
                if isinstance(field.get(key), str):
                    out.append((f"fields.{index}.{key}", field[key]))
    return out


def _slot_label(slot: str) -> str:
    if slot.startswith("fields."):
        _, index, key = slot.split(".")
        return f"Feld {int(index) + 1} ({'Name' if key == 'name' else 'Inhalt'})"
    return SLOT_LABELS.get(slot, slot)


def validate(kind: str, template, *, origin: str = "https://example.org") -> list[str]:
    """Fehler in Worten - leer heißt: so lässt sich speichern und senden."""
    if kind not in KINDS:
        return ["Diese Meldungsart gibt es nicht."]
    if not isinstance(template, dict):
        return ["Die Vorlage muss ein JSON-Objekt sein – in geschweiften Klammern."]
    errors = []
    unknown = [key for key in template if key not in TEMPLATE_KEYS]
    if unknown:
        errors.append(f"Unbekannter Eintrag: {', '.join(unknown)} – möglich sind {', '.join(TEMPLATE_KEYS)}.")
    spec = KINDS[kind]
    allowed = set(placeholders(kind))
    row_only = placeholder_rows(kind)
    for slot, text in _texts(template):
        names = PLACEHOLDER_RE.findall(text)
        bad = [name for name in names if name not in allowed]
        if bad:
            errors.append(f"Unbekannter Platzhalter {', '.join('{' + name + '}' for name in bad)} in „{_slot_label(slot)}“.")
        in_row = slot == "row" or slot.startswith("row_field.")
        misplaced = [name for name in names if name in row_only and not in_row]
        if misplaced:
            errors.append(f"{', '.join('{' + name + '}' for name in misplaced)} gibt es nur je Eintrag (Zeile oder Feld je Eintrag), nicht in „{_slot_label(slot)}“.")
        if MASS_MENTION_RE.search(text):
            errors.append(f"@everyone und @here gehen nicht („{_slot_label(slot)}“) – für eine Erwähnung die Rolle wählen und {{role}} verwenden.")
        if slot in URL_SLOTS and text.strip() and not text.strip().startswith("{") and not public_url(text.strip().replace("{site}", origin)):
            errors.append(f"„{_slot_label(slot)}“ braucht eine volle Adresse mit https:// oder einen Platzhalter.")
    if any(slot != "content" and "{role}" in text for slot, text in _texts(template)):
        errors.append("{role} pingt nur im Text über dem Kasten – im Kasten selbst erwähnt Discord niemanden.")
    color = template.get("color")
    if color is not None and not (isinstance(color, int) and 0 <= color <= 0xFFFFFF) and not COLOR_RE.match(str(color).strip()) \
            and not re.fullmatch(r"\{[a-z_]+\}", str(color).strip()):
        errors.append("Die Farbe ist ein Farbcode wie #9146FF.")
    if template.get("fields") is not None and not isinstance(template.get("fields"), list):
        errors.append("„fields“ ist eine Liste von Feldern.")
    elif len(template.get("fields") or []) > LIMITS["fields"]:
        errors.append(f"Höchstens {LIMITS['fields']} Felder.")
    if spec.get("list"):
        if template.get("rows") not in (None, "lines", "fields"):
            errors.append("„rows“ ist „lines“ (Zeilen im Text) oder „fields“ (ein Feld je Eintrag).")
        try:
            max_rows = int(template.get("max_rows") or spec.get("max_rows") or 10)
        except (TypeError, ValueError):
            max_rows = 0
        if not 1 <= max_rows <= LIMITS["fields"]:
            errors.append(f"„max_rows“ liegt zwischen 1 und {LIMITS['fields']}.")
    elif any(key in template for key in ("rows", "row", "row_field", "empty", "max_rows")):
        errors.append("Zeilen je Eintrag gibt es nur bei Listen (Antwort auf /wer-streamt, Nächste Events, Rangliste).")
    for key, limit in (("content", LIMITS["content"]), ("title", LIMITS["title"]), ("description", LIMITS["description"])):
        if isinstance(template.get(key), str) and len(template[key]) > limit:
            errors.append(f"„{SLOT_LABELS[key]}“ ist zu lang – höchstens {limit} Zeichen.")
    if errors:
        return errors
    values, rows = sample(kind, origin)
    rendered = render(kind, template, values, rows)
    embed = rendered["embed"]
    if not any(embed.get(key) for key in ("title", "description", "fields", "image", "author")):
        errors.append("Die Meldung wäre leer – Titel, Text, ein Feld oder ein Bild braucht es.")
    if embed_length(embed) > LIMITS["total"]:
        errors.append(f"Zu viel Text – Discord nimmt höchstens {LIMITS['total']} Zeichen je Kasten.")
    return errors


def sample(kind: str, origin: str) -> tuple[dict, list[dict]]:
    """Beispielwerte für Vorschau und Prüfung."""
    values = {name: entry[2].replace("{origin}", origin) for name, entry in {**COMMON, **KINDS[kind].get("placeholders", {})}.items()}
    rows: list[dict] = []
    if KINDS[kind].get("list"):
        row = {name: entry[2].replace("{origin}", origin) for name, entry in KINDS[kind].get("row_placeholders", {}).items()}
        rows = [row]
        if kind == "ranking":
            rows = [{**row, "medal": medal, "rank": str(rank), "name": name, "points": points}
                    for rank, (medal, name, points) in enumerate([("🥇", "Paula", "120,5"), ("🥈", "Leon", "80"), ("🥉", "Mira", "64")], start=1)]
        elif kind == "events":
            rows = [row, {**row, "icon": "📅", "date": "Sa, 10.10.2026 · 19:00 Uhr", "name": "LAN-Party", "link": f"{origin}/events/lan-party", "kind": "Event", "state": "Plätze frei"}]
    if kind == "stream_live":
        values["role"] = "@Stream-Ping"
    # Fester Zeitpunkt passend zu „19:15 Uhr“ - die Vorschau mit Beispielwerten sieht jedes Mal gleich aus.
    values["timestamp_iso"] = "2026-10-03T17:15:00+00:00"
    return values, rows


# ---------------------------------------------------------------- Speichern

def default_template(kind: str) -> dict:
    return copy.deepcopy(KINDS[kind]["default"])


async def stored_templates(db) -> dict:
    doc = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}
    templates = doc.get("templates")
    return templates if isinstance(templates, dict) else {}


async def template_for(db, kind: str) -> dict:
    """Die eigene Fassung, sonst der Standard."""
    custom = (await stored_templates(db)).get(kind)
    return copy.deepcopy(custom) if isinstance(custom, dict) else default_template(kind)


async def save_template(db, kind: str, template: dict, actor_id: str | None) -> None:
    await db.settings.update_one({"id": SETTINGS_ID}, {"$set": {f"templates.{kind}": template, f"changed.{kind}": {"at": now_utc().isoformat(), "by": actor_id}},
                                                       "$setOnInsert": {"id": SETTINGS_ID}}, upsert=True)


async def reset_template(db, kind: str) -> None:
    await db.settings.update_one({"id": SETTINGS_ID}, {"$unset": {f"templates.{kind}": "", f"changed.{kind}": ""}})


def vienna_time(value) -> str:
    """„19:15 Uhr“ aus einem ISO-Zeitpunkt."""
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return ""
    return parsed.astimezone(VIENNA).strftime("%H:%M Uhr")


async def designed(db, kind: str, values: dict, *, now: datetime | None = None) -> dict:
    """Eine Meldung im Aussehen der Gestaltung (#866 Teil 2): eigene Fassung oder Standard, mit den gemeinsamen Werten."""
    return render(kind, await template_for(db, kind), {**await common_values(db, now), **values}, now=now)


async def common_values(db, now: datetime | None = None) -> dict:
    """Was jede Vorlage kennt: Adresse, Vereinsname, Logo, „jetzt“."""
    from services.platform_links import frontend_url

    origin = (frontend_url() or "https://lionsquad.at").rstrip("/")
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "club_name": 1}) or {}
    current = (now or now_utc()).astimezone(VIENNA)
    return {"site": origin, "club": branding.get("club_name") or "THE LION SQUAD", "logo": f"{origin}/assets/brand/tls-favicon.png",
            "now": current.strftime("%d.%m.%Y, %H:%M Uhr")}
