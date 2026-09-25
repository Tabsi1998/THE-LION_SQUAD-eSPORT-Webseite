"""Vorschau jeder Meldungsart (#583): dieselben Funktionen wie die echte Meldung, mit Beispieldaten.

Wer im Admin an Discord-Meldungen dreht, will sehen, wie sie im Discord aussehen - ohne die
Community damit zu behelligen. Der Katalog hier baut jede Meldungsart, die die Website kennt, über
genau die Funktionen, die auch die echte Meldung bauen (``discord_announcements``, ``discord_dm``,
``ops_alerts``): aus den letzten echten Daten, wenn es welche gibt (letzte öffentliche News, nächstes
Event, letztes öffentliches Turnier, letzte Fast-Lap-Challenge), sonst aus festen Beispielen.
Personen heißen in den Beispielen immer „Paula“ - nie echte Namen.

Auf Knopfdruck geht das Embed echt raus: in den **Testkanal** (privates Ziel ``test`` - fällt nie auf
einen öffentlichen Kanal zurück; fehlt er, wird nichts gesendet) oder als **Direktnachricht an den
Admin selbst** (sein verknüpftes Discord-Konto). Beides trägt den Vermerk „Test · nicht an die
Community“ und steht im Versand-Log mit ``test: True`` - zählt also nicht als Meldung.
"""
from __future__ import annotations

from datetime import timedelta

from database import get_db
from models import new_id, now_utc

GROUPS = (
    {"key": "public", "label": "Öffentliche Kanäle"},
    {"key": "board", "label": "Vorstand (privat)"},
    {"key": "ops", "label": "Betrieb (privat)"},
    {"key": "dm", "label": "Direktnachrichten"},
)
TEST_FOOTER = "Test · nicht an die Community"
SAMPLE_NAME = "Paula"
SOURCE_EXAMPLE = "Beispiel"


def _example_news() -> dict:
    return {"id": "beispiel-news", "slug": "sommerfest", "title": "Sommerfest am Vereinsplatz",
            "excerpt": "Grillen, Turniere auf der Leinwand und die Siegerehrung der Saison – alle Mitglieder und Freunde sind eingeladen.",
            "visibility": "public", "published": True}


def _example_event() -> dict:
    start = (now_utc() + timedelta(days=14)).replace(hour=16, minute=0, second=0, microsecond=0)
    return {"id": "beispiel-event", "slug": "lan-party", "name": "LAN-Party im Vereinsheim",
            "short_description": "Zwei Tage zocken, Turniere und Pizza – bring deinen Rechner mit.",
            "start_date": start.isoformat(), "location": "Vereinsheim", "city": "Wien",
            "has_registration": True, "max_participants": 24, "status": "scheduled", "visibility": "public"}


def _example_tournament() -> dict:
    return {"id": "beispiel-turnier", "slug": "sommer-cup", "title": "Sommer-Cup", "description": "Das Vereinsturnier der Saison – offen für alle Mitglieder.",
            "format": "double_elimination", "format_label": "Double Elimination", "max_participants": 16, "visibility": "public", "is_public": True}


def _example_challenge() -> dict:
    return {"id": "beispiel-challenge", "slug": "spa-time-attack", "title": "Spa Time Attack"}


# Direktnachrichten (#567, #568): eine Beispiel-Benachrichtigung je Thema, gebaut wie im Betrieb.
DM_SAMPLES = (
    ("notify.match_reminder", "Match-Erinnerung", {"kind": "match_reminder", "title": "Dein Match startet in 15 Minuten",
                                                    "body": "Sommer-Cup · Runde 2 · Team Lions gegen Team Falcons", "url": "/tournaments/sommer-cup"}),
    ("notify.tournament_checkin", "Turnier: Check-in", {"kind": "tournament_checkin", "title": "Check-in für den Sommer-Cup ist offen",
                                                         "body": "Bis 17:45 Uhr einchecken, sonst rückt der Ersatz nach.", "url": "/tournaments/sommer-cup"}),
    ("notify.prize_pending", "Gewinn bereit", {"kind": "prize_pending", "title": "Dein Gewinn liegt bereit",
                                                "body": "Sommer-Cup · 2. Platz – Abholung beim nächsten Vereinsabend.", "url": "/profile?tab=prizes"}),
    ("notify.achievement", "Erfolg-Gratulation", {"kind": "achievement", "title": "Erfolg freigeschaltet", "body": "Erste Bestzeit",
                                                   "url": "/profile?tab=achievements",
                                                   "meta": {"awards": [{"name": "Erste Bestzeit", "group": "Fast Lap", "points": 25}], "points": 25, "level": 2}}),
    ("notify.membership_update", "Vereinsmitgliedschaft", {"kind": "membership_update", "title": "Willkommen im Verein!",
                                                            "body": "Dein Antrag ist angenommen – der Mitgliederbereich ist ab jetzt offen.", "url": "/member-area"}),
    ("notify.direct_message", "Nachricht (nur der Hinweis)", {"kind": "direct_message", "title": "Neue Nachricht von Leon",
                                                               "body": "Hey, hast du heute Abend Zeit für ein Match?", "url": "/messages"}),
    ("notify.news_member", "Vereinsintern: News", {"kind": "news_member", "title": "Neue interne News: Jahreshauptversammlung",
                                                     "body": "Einladung und Tagesordnung stehen im Mitgliederbereich.", "url": "/news/jahreshauptversammlung"}),
)


async def _latest_public(collection, query: dict, sort: list) -> dict | None:
    from discord_service import should_post_to_public_discord

    for item in await collection.find(query, {"_id": 0}).sort(sort).to_list(5):
        if should_post_to_public_discord(item):
            return item
    return None


async def sample_catalog(db=None) -> list[dict]:
    """Jede Meldungsart mit Embed, Ziel, Herkunft der Daten und ob das Ereignis eingeschaltet ist."""
    from discord_service import EVENTS, _get_discord_config, build_embed, event_enabled, resolve_target
    from services.discord_announcements import (EVENT_PUBLIC_STATUSES, TOURNAMENT_STATUS, board_message, event_message, fast_lap_message,
                                                news_message, stream_live_message, tournament_message)
    from services.discord_dm import dm_content
    from services.notification_preferences import NOTIFICATION_KIND_CATEGORY
    from services.ops_alerts import RED, check_red_message, error_group_message

    db = db if db is not None else get_db()
    cfg = await _get_discord_config()
    entries: list[dict] = []

    async def add(key: str, label: str, group: str, message: dict, *, target: str, source_text: str, source: str = "example"):
        embed = await build_embed(message["title"], message.get("description") or "", color=message.get("color") or 0x29B6E8, url=message.get("url"),
                                  fields=message.get("fields"), image_url=message.get("image_url"))
        entry = {"key": key, "label": label, "group": group, "target": target, "source": source, "source_text": source_text,
                 "embed": embed, "dm": target == "dm", "message": message}
        if target != "dm":
            resolved = resolve_target(cfg, target)
            entry["delivers_to"] = resolved["target"] if resolved["channel_id"] else None
            event_key = message.get("event_key")
            entry["enabled"] = event_enabled(cfg, event_key) if event_key in EVENTS else True
        entries.append(entry)

    # Öffentliche Kanäle: aus den letzten echten Daten, wenn es welche gibt.
    post = await _latest_public(db.news_posts, {"published": True}, [("published_at", -1)])
    await add("news.published", EVENTS["news.published"]["label"], "public", news_message(post or _example_news()), target="news",
              source="latest" if post else "example", source_text=f"aus der letzten News „{post.get('title')}“" if post else SOURCE_EXAMPLE)
    event = await _latest_public(db.events, {"status": {"$in": list(EVENT_PUBLIC_STATUSES)}, "start_date": {"$gte": now_utc().isoformat()}}, [("start_date", 1)])
    await add("event.announced", EVENTS["event.announced"]["label"], "public", event_message(event or _example_event()), target="events",
              source="latest" if event else "example", source_text=f"aus dem nächsten Event „{event.get('name') or event.get('title')}“" if event else SOURCE_EXAMPLE)
    tournament = await _latest_public(db.tournaments, {}, [("created_at", -1)])
    game = await db.games.find_one({"id": tournament.get("game_id")}, {"_id": 0, "name": 1}) if tournament and tournament.get("game_id") else None
    game_name = (game or {}).get("name") or (None if tournament else "Rocket League")
    for status in TOURNAMENT_STATUS:
        key = f"tournament.{status}"
        await add(key, EVENTS[key]["label"], "public", tournament_message(tournament or _example_tournament(), status, game_name=game_name), target="events",
                  source="latest" if tournament else "example", source_text=f"aus dem Turnier „{tournament.get('title')}“" if tournament else SOURCE_EXAMPLE)
    challenge = await db.f1_challenges.find_one({}, {"_id": 0}, sort=[("created_at", -1)])
    await add("f1.new_leader", EVENTS["f1.new_leader"]["label"], "public",
              fast_lap_message(challenge or _example_challenge(), driver=SAMPLE_NAME, track="Spa-Francorchamps", time_text="1:42.318", previous_text="1:42.905"),
              target="events", source="latest" if challenge else "example",
              source_text=f"aus der Challenge „{challenge.get('title')}“ mit Beispielzeit" if challenge else SOURCE_EXAMPLE)

    # „Turnier live“ (#579): ein Teilnehmer streamt - Beispielstream, das Turnier wie oben.
    await add("tournament.stream_live", EVENTS["tournament.stream_live"]["label"], "public",
              stream_live_message(tournament or _example_tournament(), {"display_name": SAMPLE_NAME, "title": "Finale – wir holen den Cup!", "game_name": game_name or "Rocket League",
                                                                         "viewer_count": 12, "stream_url": "https://www.twitch.tv/paula", "thumbnail_url": None}),
              target="events", source_text=SOURCE_EXAMPLE)

    # Vorstand: nie Namen oder Texte - die stehen im Admin.
    await add("membership.application", EVENTS["membership.application"]["label"], "board",
              board_message("membership.application", "Ein neuer Antrag wartet auf die Entscheidung des Vorstands."), target="board", source_text=SOURCE_EXAMPLE)
    await add("contact.request", EVENTS["contact.request"]["label"], "board", board_message("contact.request", "Thema: Turniere"), target="board", source_text=SOURCE_EXAMPLE)

    # Betrieb: roter Auto-Check und Serverfehler, wie Betrieb → Alarme sie schickt.
    check = check_red_message({"key": "mail_queue", "label": "Mail-Queue", "value": "3 Mails hängen", "detail": "Seit 20 Minuten kein Versand."},
                              {"at": now_utc().strftime("%d.%m.%Y %H:%M UTC")})
    await add("ops.check_red", "Auto-Check rot", "ops", {**check, "event_key": "ops_check", "color": RED, "url": "/admin/ops"}, target="ops", source_text=SOURCE_EXAMPLE)
    error = error_group_message({"error_type": "TimeoutError", "method": "GET", "route": "/api/tournaments/{id}/bracket", "message": "Die Datenbank hat nicht geantwortet.",
                                 "status_code": 500, "count": 4})
    await add("ops.error_group", "Serverfehler (5xx)", "ops", {**error, "event_key": "ops_error", "color": RED, "url": "/admin/ops"}, target="ops", source_text=SOURCE_EXAMPLE)

    # Direktnachrichten: dieselbe Funktion wie beim Versand - fremde Nachrichtentexte bleiben draußen.
    for key, label, notification in DM_SAMPLES:
        content = dm_content(notification, NOTIFICATION_KIND_CATEGORY.get(notification["kind"]), name=SAMPLE_NAME)
        await add(key, label, "dm", {**content, "event_key": key, "fields": [], "image_url": None}, target="dm", source_text=SOURCE_EXAMPLE)
    return entries


def public_entries(entries: list[dict]) -> list[dict]:
    """Für die Oberfläche - ohne die Rohdaten der Meldung."""
    return [{k: v for k, v in entry.items() if k != "message"} for entry in entries]


async def send_sample(key: str, via: str, admin: dict) -> dict:
    """Ein Beispiel echt senden: ``via="test"`` in den Testkanal, ``via="dm"`` an den Admin selbst."""
    from discord_service import REASON_TEXTS, build_embed, send_to
    from services.discord_bot import bot, bot_settings
    from services.discord_dm import discord_link_id

    db = get_db()
    entry = next((row for row in await sample_catalog(db) if row["key"] == key), None)
    if entry is None:
        raise KeyError(key)
    message = entry["message"]
    if via == "test":
        result = await send_to("test", message["title"], message.get("description") or "", color=message.get("color") or 0x29B6E8, url=message.get("url"),
                               fields=message.get("fields"), image_url=message.get("image_url"), event_key=f"test.{key}", footer=TEST_FOOTER, test=True)
        if result.get("ok"):
            from discord_service import target_status
            result["channel_name"] = (await target_status(db)).get("test", {}).get("channel_name")
        return result

    discord_id = await discord_link_id(db, admin["id"])
    if not discord_id:
        return {"ok": False, "reason": "not_linked", "error": REASON_TEXTS["not_linked"], "target": "dm"}
    log = {"id": new_id(), "channel": "discord", "target": "dm", "user_id": admin["id"], "event_key": f"test.{key}", "title": message["title"],
           "status": "skipped", "error": None, "reason": None, "test": True, "created_at": now_utc().isoformat()}
    settings = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
    reason = None
    if not bool(settings.get("enabled", True)):
        reason = "disabled"
    elif not bot_settings(settings)["enabled"]:
        reason = "bot_off"
    if reason:
        log["reason"], log["error"] = reason, REASON_TEXTS[reason]
        await db.email_logs.insert_one(log)
        return {"ok": False, "reason": reason, "error": REASON_TEXTS[reason], "target": "dm"}
    embed = await build_embed(message["title"], message.get("description") or "", color=message.get("color") or 0x29B6E8, url=message.get("url"),
                              fields=message.get("fields"), image_url=message.get("image_url"), footer=TEST_FOOTER)
    try:
        result = await bot.send_dm(discord_id, embed)
    except Exception as exc:  # noqa: BLE001 - ein Discord-Fehler darf nichts abbrechen
        result = {"ok": False, "reason": "error", "error": type(exc).__name__}
    if result.get("ok"):
        log["status"], log["message_id"] = "sent", result.get("message_id")
    else:
        reason = result.get("reason") or "error"
        log["status"] = "skipped" if reason == "bot_offline" else "failed"
        log["reason"] = "dm_forbidden" if reason == "forbidden" else reason
        log["error"] = result.get("error") or REASON_TEXTS.get(log["reason"]) or reason
    await db.email_logs.insert_one(log)
    return {"ok": log["status"] == "sent", "reason": log.get("reason"), "error": log.get("error"), "target": "dm", "message_id": log.get("message_id")}
