"""Gestaltung der Discord-Meldungen und Stream-Meldungen (#866) - Verbindungen → Discord.

``/design``: je Meldungsart die Vorlage (eigene Fassung oder Standard), die Platzhalter und eine Vorschau; speichern
nur, was die Prüfung besteht; „Standard wiederherstellen“; Vorschau und Testnachricht auch für ungespeicherte Entwürfe.
``/streams``: Schalter, Kanal, was am Ende passiert, welche Rolle erwähnt wird - und die Rollen des Hauptservers.
"""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException

from auth import require_club_admin
from database import get_db
from services import discord_design, discord_streams

router = APIRouter(prefix="/api/settings/discord", tags=["discord-design"])


def _origin() -> str:
    from services.platform_links import frontend_url

    return (frontend_url() or "https://lionsquad.at").rstrip("/")


def _kind(kind: str) -> str:
    if kind not in discord_design.KINDS:
        raise HTTPException(404, "Diese Meldungsart gibt es nicht.")
    return kind


async def _kind_view(db, kind: str, templates: dict, changed: dict) -> dict:
    spec = discord_design.KINDS[kind]
    origin = _origin()
    custom = templates.get(kind)
    template = custom if isinstance(custom, dict) else discord_design.default_template(kind)
    values, rows = discord_design.sample(kind, origin)
    return {"key": kind, "label": spec["label"], "group": spec["group"], "hint": spec["hint"], "list": bool(spec.get("list")),
            "placeholders": discord_design.placeholder_list(kind, origin), "template": template, "default": discord_design.default_template(kind),
            "customized": isinstance(custom, dict), "changed": changed.get(kind), "preview": discord_design.render(kind, template, values, rows)}


async def _design_state(db) -> tuple[dict, dict]:
    doc = await db.settings.find_one({"id": discord_design.SETTINGS_ID}, {"_id": 0}) or {}
    templates = doc.get("templates") if isinstance(doc.get("templates"), dict) else {}
    changed = doc.get("changed") if isinstance(doc.get("changed"), dict) else {}
    return templates, changed


@router.get("/design")
async def list_designs(me: dict = Depends(require_club_admin())):
    db = get_db()
    templates, changed = await _design_state(db)
    kinds = [await _kind_view(db, kind, templates, changed) for kind in discord_design.KINDS]
    groups = list(dict.fromkeys(spec["group"] for spec in discord_design.KINDS.values()))
    return {"kinds": kinds, "groups": groups, "limits": discord_design.LIMITS}


@router.put("/design/{kind}")
async def save_design(kind: str, body: dict = Body(...), me: dict = Depends(require_club_admin())):
    from routes.settings_routes import _audit_settings_change

    db = get_db()
    kind = _kind(kind)
    template = body.get("template")
    errors = discord_design.validate(kind, template, origin=_origin())
    if errors:
        raise HTTPException(400, errors[0] + (f" (dazu {len(errors) - 1} weitere Hinweise in der Vorschau)" if len(errors) > 1 else ""))
    await discord_design.save_template(db, kind, template, me.get("id"))
    await _audit_settings_change(db, "settings.discord.design", discord_design.SETTINGS_ID, me["id"], [kind])
    _refresh_after_change(kind)
    templates, changed = await _design_state(db)
    return await _kind_view(db, kind, templates, changed)


@router.delete("/design/{kind}")
async def reset_design(kind: str, me: dict = Depends(require_club_admin())):
    from routes.settings_routes import _audit_settings_change

    db = get_db()
    kind = _kind(kind)
    await discord_design.reset_template(db, kind)
    await _audit_settings_change(db, "settings.discord.design.reset", discord_design.SETTINGS_ID, me["id"], [kind])
    _refresh_after_change(kind)
    templates, changed = await _design_state(db)
    return await _kind_view(db, kind, templates, changed)


def _refresh_after_change(kind: str) -> None:
    """Eine neue Gestaltung einer angehefteten Einbettung zeigt sich bei der nächsten Bearbeitung (höchstens eine Minute)."""
    from services.discord_embeds import KINDS as EMBED_KINDS, request_refresh

    if kind in EMBED_KINDS:
        request_refresh(kind)


async def _live_context(db, kind: str) -> tuple[dict, list[dict], str | None]:
    """Echte Werte, wo es welche gibt - sonst Beispielwerte mit Hinweis."""
    from models import now_utc
    from services.discord_embeds import KINDS as EMBED_KINDS, context

    origin = _origin()
    current = now_utc()
    common = await discord_design.common_values(db, current)
    if kind in EMBED_KINDS:
        values, rows = await context(db, kind, current)
        return {**common, **values}, rows, None
    live = await _message_values(db, kind)
    if live is not None:
        return {**common, **live}, [], None
    streams = await discord_streams._visible_streams(db)
    if kind == "stream_live" and streams:
        stream, verdict = streams[0]
        return await discord_streams.stream_values(stream, verdict, common, now=current), [], None
    values, rows = discord_design.sample(kind, origin)
    note = "Gerade streamt niemand aus dem Verein – die Vorschau zeigt Beispielwerte." if kind == "stream_live" else "Die Vorschau zeigt Beispielwerte."
    return {**values, **common}, rows, note


async def _message_values(db, kind: str) -> dict | None:
    """Meldungen (#866 Teil 2): die letzte öffentliche News, das nächste Event, das jüngste Turnier - None ohne Daten."""
    from models import now_utc
    from services import discord_announcements as announce

    if kind == "news":
        post = await db.news_posts.find_one({"published": True, "visibility": {"$in": [None, "public", "community"]}}, {"_id": 0}, sort=[("published_at", -1)])
        return await announce.news_values(post) if post else None
    if kind == "event":
        event = await db.events.find_one({"status": {"$in": list(announce.EVENT_PUBLIC_STATUSES)}, "visibility": {"$in": [None, "public"]},
                                          "start_date": {"$gte": now_utc().isoformat()}}, {"_id": 0}, sort=[("start_date", 1)])
        return await announce.event_values(event) if event else None
    if kind in ("tournament", "tournament_thread"):
        tournament = await db.tournaments.find_one({"status": {"$ne": "draft"}, "is_public": {"$ne": False}, "visibility": {"$in": [None, "public"]}},
                                                   {"_id": 0}, sort=[("created_at", -1)])
        if not tournament:
            return None
        game = await db.games.find_one({"id": tournament.get("game_id")}, {"_id": 0, "name": 1, "logo_url": 1}) if tournament.get("game_id") else None
        status = tournament.get("status") if tournament.get("status") in announce.TOURNAMENT_STATUS else ("check_in" if kind == "tournament_thread" else "registration_open")
        return await announce.tournament_values(tournament, status, game)
    return None


@router.post("/design/{kind}/preview")
async def preview_design(kind: str, body: dict = Body(...), me: dict = Depends(require_club_admin())):
    """Vorschau eines Entwurfs - mit Beispielwerten oder den echten Daten von jetzt."""
    db = get_db()
    kind = _kind(kind)
    template = body.get("template")
    errors = discord_design.validate(kind, template, origin=_origin())
    if not isinstance(template, dict):
        return {"content": None, "embed": None, "errors": errors, "data": "sample"}
    if body.get("data") == "live":
        values, rows, note = await _live_context(db, kind)
        data = "sample" if note else "live"
    else:
        values, rows = discord_design.sample(kind, _origin())
        note, data = None, "sample"
    rendered = discord_design.render(kind, template, values, rows)
    return {**rendered, "errors": errors, "data": data, "note": note, "length": discord_design.embed_length(rendered["embed"])}


@router.post("/design/{kind}/test")
async def test_design(kind: str, body: dict = Body(default={}), me: dict = Depends(require_club_admin())):
    """Den Entwurf (oder die gespeicherte Fassung) in den privaten Testkanal - erwähnt niemanden."""
    from discord_service import REASON_TEXTS
    from services.discord_bot import bot, bot_settings

    db = get_db()
    kind = _kind(kind)
    template = body.get("template") if isinstance(body.get("template"), dict) else await discord_design.template_for(db, kind)
    errors = discord_design.validate(kind, template, origin=_origin())
    if errors:
        raise HTTPException(400, errors[0])
    settings = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
    channel_id = str(((settings.get("channels") or {}).get("test")) or "").strip()
    if not channel_id:
        raise HTTPException(409, REASON_TEXTS["test_channel_missing"])
    if not bot_settings(settings)["enabled"]:
        raise HTTPException(409, REASON_TEXTS["bot_off"])
    values, rows, _ = await _live_context(db, kind)
    if kind == "stream_live":
        values["role"] = "@Rolle"   # im Test pingt niemand
    rendered = discord_design.render(kind, template, values, rows)
    buttons = [{"label": "Zuschauen", "url": values["url"]}] if kind.startswith("stream_") and values.get("url") else None
    result = await bot.send_embed(channel_id, rendered["embed"], buttons, content=rendered["content"], mention_role_ids=None)
    if not result.get("ok"):
        reason = result.get("reason") or "error"
        raise HTTPException(409, REASON_TEXTS.get(reason) or result.get("error") or "Discord hat die Testnachricht abgelehnt.")
    return {"ok": True, "message_id": result.get("message_id")}


# ---------------------------------------------------------------- Stream-Meldungen

@router.get("/streams")
async def stream_settings(me: dict = Depends(require_club_admin())):
    from services.discord_bot import bot

    db = get_db()
    roles = await bot.list_roles()
    return {**await discord_streams.status(db), "roles": roles.get("roles") or [], "roles_available": bool(roles.get("ok"))}


@router.put("/streams")
async def update_stream_settings(body: dict = Body(...), me: dict = Depends(require_club_admin())):
    from discord_service import channel_id_valid
    from routes.settings_routes import _audit_settings_change

    db = get_db()
    updates: dict = {}
    for key, value in body.items():
        if key == "enabled":
            updates["streams.enabled"] = bool(value)
        elif key == "channel_id":
            channel_id = str(value or "").strip()
            if channel_id and not channel_id_valid(channel_id):
                raise HTTPException(400, "Eine Kanal-ID ist eine Zahl mit 17 bis 20 Stellen (Discord: Rechtsklick auf den Kanal → „Kanal-ID kopieren“, Entwicklermodus).")
            updates["streams.channel_id"] = channel_id
        elif key == "on_end":
            if value not in discord_streams.END_MODES:
                raise HTTPException(400, "Am Ende wird die Meldung bearbeitet („edit“) oder gelöscht („delete“).")
            updates["streams.on_end"] = value
        elif key == "role_id":
            role_id = str(value or "").strip()
            if role_id and not role_id.isdigit():
                raise HTTPException(400, "Die Rolle ist eine Zahl (Discord: Rechtsklick auf die Rolle → „Rollen-ID kopieren“).")
            updates["streams.role_id"] = role_id
        else:
            raise HTTPException(400, f"Unbekannte Einstellung für Stream-Meldungen: {key}")
    if updates:
        await db.settings.update_one({"id": "discord"}, {"$set": updates, "$setOnInsert": {"id": "discord"}}, upsert=True)
        await _audit_settings_change(db, "settings.discord.streams", "discord", me["id"], sorted(updates))
    return await discord_streams.status(db)
