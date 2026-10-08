"""News und Events im Discord ankündigen - und zeigen, wie die Meldung aussehen wird (#300, #303).

Ein Job sieht jede Minute nach, was veröffentlicht und noch nicht geprüft ist.
Damit gilt dieselbe Stelle für „sofort veröffentlicht“ und „geplant für 18 Uhr“,
und jede News, jedes Event wird genau einmal geprüft (`discord_checked_at`) -
ob gesendet oder aus gutem Grund nicht.

Wohin, entscheidet die Sichtbarkeit (#605): Öffentliches in den News- bzw.
Events-Kanal, „nur Mitglieder“ in den privaten Mitgliederkanal, Internes in den
Vorstandskanal - dort ohne Text, nur Titel, Zeit, Ort und Link. Jede Art hat ihren
eigenen Schalter; `send_event` prüft die Grenze noch einmal selbst. Nie gesendet
wird, was der Autor mit „Ohne Discord“ markiert hat, Entwürfe, und Altes: Wer den
Schalter heute einschaltet, bekommt nicht das Archiv der letzten Jahre in den Kanal.

Aussehen (#866 Teil 2): News, Events und Turniere gehen im Aussehen der Gestaltung hinaus (Verbindungen → Discord →
„Gestaltung“, Gruppe „Meldungen“) - eigene Fassung oder Standard. Die ``*_values`` liefern dieselben Werte für Versand,
Vorschau und Beispiele; ``designed_*`` hängt die gerenderte Einbettung an die Meldung. Interne Meldungen an den Vorstand
bleiben ohne Vorlage (nur Titel und Link - kein Text im fremden Dienst).
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from database import get_db
from models import now_utc

from services import event_days

logger = logging.getLogger("tls.discord.announce")

VIENNA = ZoneInfo("Europe/Vienna")
MAX_AGE_HOURS = 24
EVENT_PUBLIC_STATUSES = ("scheduled", "registration_open")
NEWS_COLOR = 0x29B6E8
EVENT_COLOR = 0x00FF88


def _parse(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def vienna(value, *, with_time: bool = True) -> str:
    """Zeit so, wie sie im Verein gilt - mit „Uhr“, damit im Discord niemand rechnet."""
    parsed = _parse(value)
    if not parsed:
        return ""
    local = parsed.astimezone(VIENNA)
    return local.strftime("%d.%m.%Y, %H:%M Uhr") if with_time else local.strftime("%d.%m.%Y")


def _without_tags(text: str) -> str:
    """HTML-Tags werden zu Leerzeichen (#1408). Ein Tag reicht von „<“ bis zum nächsten „>“, mit mindestens einem
    Zeichen dazwischen; „<>“ und ein „<“ ohne „>“ dahinter bleiben stehen. Das Ergebnis ist dasselbe wie früher mit
    ``re.sub(r"<[^>]+>", " ", text)`` - nur läuft es in einem Durchgang: ein langer Text voller „<“ ohne „>“ brauchte
    vorher quadratisch lange."""
    parts, pos = [], 0
    while True:
        start = text.find("<", pos)
        end = text.find(">", start + 1) if start >= 0 else -1
        if end < 0:  # kein „>“ mehr dahinter - dann auch hinter keinem späteren „<“
            break
        if end == start + 1:  # „<>“ ist kein Tag: stehen lassen, ab dem „>“ weitersuchen
            parts.append(text[pos:end])
            pos = end
        else:
            parts.append(text[pos:start] + " ")
            pos = end + 1
    parts.append(text[pos:])
    return "".join(parts)


def plain_text(value: str | None, limit: int = 300) -> str:
    text = _without_tags(value or "")
    text = re.sub(r"[#*_`>\[\]]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def audience(item: dict) -> str:
    """Für wen (#605): öffentlich (auch „Community“), nur Mitglieder oder intern."""
    visibility = item.get("visibility") or "public"
    return visibility if visibility in ("members", "internal") else "public"


AUDIENCE_KEYS = {"news": {"public": "news.published", "members": "news.members", "internal": "news.internal"},
                 "event": {"public": "event.announced", "members": "event.members", "internal": "event.internal"}}


def news_message(post: dict) -> dict:
    url = f"/news/{post.get('slug') or post.get('id')}"
    who = audience(post)
    return {
        "event_key": AUDIENCE_KEYS["news"][who],
        "title": f"📰 {post.get('title') or 'News'}",
        # Intern: kein Text in einem fremden Dienst - der Vorstand liest ihn auf der Website.
        "description": "" if who == "internal" else plain_text(post.get("excerpt") or post.get("content"), 400),
        "color": NEWS_COLOR,
        "url": url,
        "image_url": None if who == "internal" else post.get("banner_url") or post.get("cover_url"),
        "fields": [],
        "buttons": [{"label": "Weiterlesen", "url": url}],
    }


def event_message(event: dict) -> dict:
    fields = []
    day_lines = event_days.lines(event)
    if day_lines:
        # Mehrtägig (#884): der Zeitraum und je Tag eine Zeile.
        fields.append({"name": "Wann", "value": event_days.summary_text(event), "inline": True})
        fields.append({"name": "Tage", "value": "\n".join(day_lines)[:1024], "inline": False})
    elif event.get("start_date"):
        when = vienna(event["start_date"])
        end = _parse(event.get("end_date"))
        start = _parse(event.get("start_date"))
        if end and start and end.astimezone(VIENNA).date() != start.astimezone(VIENNA).date():
            when = f"{when} – {vienna(end, with_time=False)}"
        fields.append({"name": "Wann", "value": when, "inline": True})
    place = ", ".join(part for part in (event.get("location"), event.get("city")) if part)
    if place:
        fields.append({"name": "Wo", "value": place, "inline": True})
    if event.get("has_registration"):
        if event.get("registration_closes_at"):
            fields.append({"name": "Anmeldung bis", "value": vienna(event["registration_closes_at"]), "inline": True})
        if event.get("max_participants"):
            fields.append({"name": "Plätze", "value": str(event["max_participants"]), "inline": True})
    url = f"/events/{event.get('slug') or event.get('id')}"
    who = audience(event)
    return {
        "event_key": AUDIENCE_KEYS["event"][who],
        "title": f"📅 {event.get('name') or event.get('title') or 'Event'}",
        # Mitglieder-Events mit Zeit und Ort (Discord-Termine sind serverweit sichtbar); intern ohne Text.
        "description": "" if who == "internal" else plain_text(event.get("short_description") or event.get("description"), 400),
        "color": EVENT_COLOR,
        "url": url,
        "image_url": None if who == "internal" else event.get("banner_url") or event.get("poster_url"),
        "fields": fields,
        "buttons": [{"label": "Event ansehen", "url": url}],
    }


def _hex(color: int) -> str:
    return f"#{int(color) & 0xFFFFFF:06X}"


async def _public(link: str | None, image: bool = False) -> str:
    from discord_service import _public_avatar_url, _public_link_url

    return (await (_public_avatar_url(link) if image else _public_link_url(link))) or ""


def _audience_text(item: dict) -> str:
    return "nur für Mitglieder" if audience(item) == "members" else ""


async def news_values(post: dict) -> dict:
    """Die Werte der Vorlage „News“ (#866 Teil 2) - dieselben für Versand, Vorschau und Beispiel."""
    return {"title": str(post.get("title") or "News"), "text": plain_text(post.get("excerpt") or post.get("content"), 400),
            "link": await _public(f"/news/{post.get('slug') or post.get('id')}"),
            "image": await _public(post.get("banner_url") or post.get("cover_url"), image=True), "audience": _audience_text(post)}


async def event_values(event: dict) -> dict:
    """Die Werte der Vorlage „Event“: Wann (mit Ende an einem anderen Tag), Wo, Anmeldeschluss und Plätze nur mit Anmeldung."""
    when = vienna(event.get("start_date")) if event.get("start_date") else ""
    start, end = _parse(event.get("start_date")), _parse(event.get("end_date"))
    if when and start and end and end.astimezone(VIENNA).date() != start.astimezone(VIENNA).date():
        when = f"{when} – {vienna(end, with_time=False)}"
    day_lines = event_days.lines(event)
    if day_lines:
        when = event_days.summary_text(event) + "\n" + "\n".join(day_lines)
    registration = bool(event.get("has_registration"))
    return {"name": str(event.get("name") or event.get("title") or "Event"),
            "text": plain_text(event.get("short_description") or event.get("description"), 400), "when": when,
            "where": ", ".join(part for part in (event.get("location"), event.get("city")) if part),
            "registration_until": vienna(event.get("registration_closes_at")) if registration and event.get("registration_closes_at") else "",
            "places": str(event["max_participants"]) if registration and event.get("max_participants") else "",
            "link": await _public(f"/events/{event.get('slug') or event.get('id')}"),
            "image": await _public(event.get("banner_url") or event.get("poster_url"), image=True), "audience": _audience_text(event)}


async def tournament_values(tournament: dict, status: str, game: dict | None = None) -> dict:
    """Die Werte der Vorlagen „Turnier: Ankündigung“ und „Turnier: im Thread“."""
    spec = TOURNAMENT_STATUS.get(status) or {"label": status, "color": 0x29B6E8}
    format_text = tournament.get("format_label") or (str(tournament["format"]).replace("_", " ").title() if tournament.get("format") else "")
    return {"title": str(tournament.get("title") or "Turnier"), "status": spec["label"], "status_color": _hex(spec["color"]),
            "text": plain_text(tournament.get("description"), 1500), "game": str((game or {}).get("name") or ""), "format": format_text,
            "participants": f"max. {tournament['max_participants']}" if tournament.get("max_participants") else "",
            "link": await _public(f"/tournaments/{tournament.get('slug') or tournament.get('id')}"),
            "banner": await _public(tournament.get("banner_url"), image=True), "game_logo": await _public((game or {}).get("logo_url"), image=True),
            "line": thread_line(tournament, status)}


async def _design(db, kind: str, message: dict, values: dict) -> dict:
    from services import discord_design

    rendered = await discord_design.designed(db, kind, values)
    return {**message, "embed": rendered["embed"], "content": rendered.get("content")}


async def designed_news(db, post: dict) -> dict:
    """Die News-Meldung im Aussehen der Gestaltung - interne bleiben ohne Vorlage (nur Titel und Link)."""
    message = news_message(post)
    return message if audience(post) == "internal" else await _design(db, "news", message, await news_values(post))


async def _with_registration(db, kind: str, doc: dict, message: dict, status: str | None = None) -> dict:
    """„Anmelden“ als erster Knopf (#885) - nur, wenn der Schalter an ist und nichts dagegen spricht."""
    from services.discord_registration_rules import announcement_button

    button = await announcement_button(db, kind, doc, status)
    return {**message, "buttons": [button, *(message.get("buttons") or [])]} if button else message


async def designed_event(db, event: dict) -> dict:
    message = await _with_registration(db, "event", event, event_message(event))
    return message if audience(event) == "internal" else await _design(db, "event", message, await event_values(event))


async def designed_tournament(db, tournament: dict, status: str, game: dict | None = None, *, in_thread: bool = False) -> dict:
    """Die Turnier-Meldung im Aussehen der Gestaltung: die Ankündigung im Kanal oder die kurze Fassung im Thread."""
    message = await _with_registration(db, "tournament", tournament, tournament_message(tournament, status, game_name=(game or {}).get("name"), in_thread=in_thread), status)
    return await _design(db, "tournament_thread" if in_thread else "tournament", message, await tournament_values(tournament, status, game))


def skip_reason(item: dict, *, published_at, now: datetime | None = None) -> str | None:
    """Warum diese News / dieses Event nicht gemeldet wird - oder None. Wohin es nach seiner Sichtbarkeit
    darf, entscheidet send_event (#605)."""
    if item.get("discord_skip"):
        return "author_opt_out"
    when = _parse(published_at)
    if when and (now or now_utc()) - when > timedelta(hours=MAX_AGE_HOURS):
        return "too_old"
    return None


def _with_form_days(item: dict) -> dict:
    """Das Formular schickt Tage als Wandzeit (#884); die Vorschau rechnet sie wie das Speichern. Unvollständige
    Tage lässt sie weg - der Fehler kommt beim Speichern als Satz."""
    raw = item.get("days")
    if not isinstance(raw, list) or not raw or any(isinstance(day, dict) and day.get("start_at") for day in raw):
        return item
    keys = {str(place.get("key")) for place in item.get("locations") or [] if isinstance(place, dict) and place.get("key")}
    try:
        days = event_days.normalize_days(raw, location_keys=keys or None)
    except ValueError:
        return {**item, "days": None}
    return {**item, "days": days, **event_days.derived_range(days)}


async def preview(kind: str, item: dict) -> dict:
    """Dasselbe Embed wie beim Senden - mit den Knöpfen darunter (#573) -, plus ob und wohin es ginge."""
    if kind == "event":
        item = _with_form_days(item)
    from discord_service import EVENTS, _get_discord_config, build_embed, event_enabled, resolve_buttons, resolve_target

    from discord_service import allowed_in_target

    from database import get_db as _db

    message = await (designed_news(_db(), item) if kind == "news" else designed_event(_db(), item))
    cfg = await _get_discord_config()
    resolved = resolve_target(cfg, EVENTS[message["event_key"]]["target"])
    reason = skip_reason(item, published_at=None)
    if not reason and not allowed_in_target(item, resolved["target"]):
        reason = "private_visibility"
    if not reason and not event_enabled(cfg, message["event_key"]):
        reason = "event_disabled"
    if not reason and not cfg["master"]:
        reason = "disabled"
    if not reason and not cfg["bot"]["enabled"]:
        reason = "bot_off"
    if not reason and not resolved["channel_id"]:
        reason = "no_channel"
    embed = message.get("embed") or await build_embed(message["title"], message["description"], color=message["color"], url=message["url"],
                                                      fields=message["fields"], image_url=message["image_url"])
    out = {"embed": embed, "content": message.get("content"), "buttons": await resolve_buttons(message["buttons"]), "would_send": reason is None, "reason": reason, "target": resolved["target"]}
    if kind == "event":
        # Discord-Termin (#570): so erscheint der Termin - oder warum nicht.
        from database import get_db
        from services.discord_scheduled import preview_for
        out["scheduled_event"] = await preview_for(get_db(), "event", item)
    return out


async def _announce(collection, item: dict, message: dict, published_at) -> str:
    from discord_service import send_event

    reason = skip_reason(item, published_at=published_at)
    outcome = reason
    if not reason:
        result = await send_event(message["event_key"], message["title"], message["description"], item=item,
                                  color=message["color"], url=message["url"], fields=message["fields"], image_url=message["image_url"],
                                  buttons=message["buttons"], embed=message.get("embed"), content=message.get("content"))
        outcome = "sent" if result.get("ok") else (result.get("reason") or "failed")
    await collection.update_one({"id": item["id"]}, {"$set": {"discord_checked_at": now_utc().isoformat(), "discord_outcome": outcome}})
    return outcome


async def announce_due(limit: int = 50) -> dict:
    db = get_db()
    now_iso = now_utc().isoformat()
    outcomes: dict[str, int] = {}
    posts = await db.news_posts.find(
        {"published": True, "published_at": {"$lte": now_iso}, "discord_checked_at": {"$exists": False}}, {"_id": 0}
    ).sort("published_at", 1).to_list(limit)
    for post in posts:
        outcome = await _announce(db.news_posts, post, await designed_news(db, post), post.get("published_at"))
        outcomes[outcome] = outcomes.get(outcome, 0) + 1
    events = await db.events.find(
        {"status": {"$in": list(EVENT_PUBLIC_STATUSES)}, "discord_checked_at": {"$exists": False}}, {"_id": 0}
    ).sort("created_at", 1).to_list(limit)
    for event in events:
        start = _parse(event.get("start_date"))
        if start and start < now_utc():
            await db.events.update_one({"id": event["id"]}, {"$set": {"discord_checked_at": now_iso, "discord_outcome": "past_event"}})
            outcomes["past_event"] = outcomes.get("past_event", 0) + 1
            continue
        outcome = await _announce(db.events, event, await designed_event(db, event), event.get("published_at") or event.get("updated_at") or event.get("created_at"))
        outcomes[outcome] = outcomes.get(outcome, 0) + 1
    return {"news": len(posts), "events": len(events), "outcomes": outcomes}


# ---------------------------------------------------------------- Turniere und Fast Lap (eine Quelle, #583)

TOURNAMENT_STATUS = {
    "registration_open": {"label": "Anmeldung offen", "color": 0x00FF88},
    "check_in": {"label": "Check-in offen", "color": 0x00FF88},
    "live": {"label": "Jetzt live", "color": 0x29B6E8},
    "completed": {"label": "Beendet", "color": 0xFFD700},
    "results_published": {"label": "Ergebnisse veröffentlicht", "color": 0xFFD700},
}


def thread_line(tournament: dict, status: str) -> str:
    """Der eine Satz einer Meldung im Turnier-Thread (#572)."""
    if status == "registration_open":
        until = vienna(tournament.get("registration_open_until"))
        return f"Die Anmeldung ist offen{f' – bis {until}' if until else ''}."
    if status == "check_in":
        until = vienna(tournament.get("check_in_until"))
        return f"Jetzt einchecken{f' – bis {until}' if until else ''}: auf der Turnierseite oder in der App."
    if status == "live":
        return "Das Turnier läuft. Das Bracket steht hier im Thread und wird nach jedem Ergebnis aktualisiert."
    if status == "completed":
        return "Das Turnier ist beendet – der Endstand kommt gleich hier darunter."
    if status == "results_published":
        return "Die Ergebnisse sind veröffentlicht – Platzierungen und Auszeichnungen stehen auf der Turnierseite."
    return ""


def tournament_buttons(tournament: dict, status: str) -> list[dict]:
    """Der Knopf je Status (#573): zur Anmeldung, zum Check-in, sonst zum Bracket."""
    base = f"/tournaments/{tournament.get('slug') or tournament.get('id')}"
    if status == "registration_open":
        return [{"label": "Zur Anmeldung", "url": base}]
    if status == "check_in":
        return [{"label": "Zum Check-in", "url": base}]
    return [{"label": "Bracket ansehen", "url": f"{base}/bracket"}]


def tournament_message(tournament: dict, status: str, *, game_name: str | None = None, in_thread: bool = False) -> dict:
    """Die Turnier-Meldung je Statuswechsel - der Statuswechsel und die Vorschau bauen sie hiermit. Im Thread des
    Turniers (#572) kurz: Spiel, Format, Beschreibung und Bild stehen schon in der Ankündigung darüber."""
    spec = TOURNAMENT_STATUS.get(status) or {"label": status, "color": 0x29B6E8}
    if in_thread:
        return {"event_key": f"tournament.{status}", "title": f"🏆 {tournament.get('title') or 'Turnier'} · {spec['label']}",
                "description": thread_line(tournament, status), "color": spec["color"],
                "url": f"/tournaments/{tournament.get('slug') or tournament.get('id')}", "fields": [], "image_url": None,
                "buttons": tournament_buttons(tournament, status)}
    fields = []
    if game_name:
        fields.append({"name": "Spiel", "value": game_name, "inline": True})
    if tournament.get("format"):
        fields.append({"name": "Format", "value": tournament.get("format_label") or str(tournament["format"]).replace("_", " ").title(), "inline": True})
    if tournament.get("max_participants"):
        fields.append({"name": "Teilnehmer", "value": f"max. {tournament['max_participants']}", "inline": True})
    return {
        "event_key": f"tournament.{status}",
        "title": f"🏆 {tournament.get('title') or 'Turnier'} · {spec['label']}",
        "description": tournament.get("description") or "",
        "color": spec["color"],
        "url": f"/tournaments/{tournament.get('slug') or tournament.get('id')}",
        "fields": fields,
        "image_url": tournament.get("banner_url"),
        "buttons": tournament_buttons(tournament, status),
    }


def fast_lap_message(challenge: dict, *, driver: str, track: str, time_text: str, previous_text: str | None = None) -> dict:
    """Die Bestzeit-Meldung - Zeiten kommen schon formatiert (die Formatierung wohnt bei Fast Lap)."""
    fields = [{"name": "Zeit", "value": time_text, "inline": True}]
    if previous_text:
        fields.append({"name": "Vorher", "value": previous_text, "inline": True})
    return {
        "event_key": "f1.new_leader",
        "title": f"🏁 Neue Bestzeit · {challenge.get('title') or 'Fast Lap'}",
        "description": f"**{driver or 'Fahrer'}** führt jetzt auf **{track or '–'}**!",
        "color": 0xFFD700,
        "url": f"/fastlap/{challenge.get('slug') or challenge.get('id')}",
        "fields": fields,
        "image_url": None,
        "buttons": [{"label": "Bestenliste", "url": f"/fastlap/{challenge.get('slug') or challenge.get('id')}"}],
    }


def stream_live_message(tournament: dict, stream: dict) -> dict:
    """„Turnier live“ (#579): ein Teilnehmer streamt, während das Turnier läuft - einmal je Stream-Start."""
    name = stream.get("display_name") or stream.get("username") or "Ein Teilnehmer"
    title = tournament.get("title") or "Turnier"
    lines = []
    if stream.get("title"):
        lines.append(f"„{plain_text(stream['title'], 200)}“")
    lines.append(f"Jetzt zuschauen: {stream.get('stream_url') or ''}".rstrip())
    fields = [{"name": "Turnier", "value": title, "inline": True}]
    if stream.get("game_name"):
        fields.append({"name": "Spiel", "value": str(stream["game_name"]), "inline": True})
    buttons = [{"label": "Zuschauen", "url": stream.get("stream_url")}] if stream.get("stream_url") else []
    if stream.get("public_profile_url"):
        buttons.append({"label": "Profil", "url": stream["public_profile_url"]})
    return {
        "event_key": "tournament.stream_live",
        "title": f"🔴 {name} streamt den {title}",
        "description": "\n".join(lines),
        "color": 0x9146FF,
        "url": stream.get("stream_url") or f"/tournaments/{tournament.get('slug') or tournament.get('id')}",
        "fields": fields,
        "image_url": stream.get("thumbnail_url") or None,
        "buttons": buttons,
    }


# ---------------------------------------------------------------- Vorstand (privates Ziel)

# Titel und Ziel je Vorstands-Hinweis - Namen und Texte stehen nie drin, die sind im Admin.
BOARD_MESSAGES = {
    "membership.application": {"title": "📝 Neuer Mitgliedsantrag", "url": "/admin/membership-applications"},
    "contact.request": {"title": "✉️ Neue Kontaktanfrage", "url": "/admin/contact"},
}


def board_message(event_key: str, description: str = "") -> dict:
    spec = BOARD_MESSAGES.get(event_key) or {"title": "Hinweis an den Vorstand", "url": "/admin"}
    return {"event_key": event_key, "title": spec["title"], "description": description, "color": 0xFFD700, "url": spec["url"], "fields": [], "image_url": None,
            "buttons": [{"label": "Im Admin öffnen", "url": spec["url"]}]}


async def notify_board(event_key: str, description: str = "", *, fields: list | None = None) -> dict:
    """Nur in den Vorstandskanal. Fehlt er, passiert nichts - nie ein Rückfall auf die Community."""
    from discord_service import send_event

    message = board_message(event_key, description)
    try:
        return await send_event(event_key, message["title"], description, color=message["color"], url=message["url"], fields=fields,
                                buttons=message["buttons"])
    except Exception:  # noqa: BLE001 - ein Antrag darf nie an Discord scheitern
        logger.warning("[discord] board notification failed", exc_info=True)
        return {"ok": False, "reason": "error"}
