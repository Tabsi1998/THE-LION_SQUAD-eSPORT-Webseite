"""Mitteilung an mehrere Server (#631, Discord VI): ``/verteilen`` für Turnierleitung und Vorstand - und dieselbe Auswahl im Admin.

Der Bot kopiert keine Nachrichten zwischen Servern; dafür gibt es das Folgen von Ankündigungskanälen
(``services/discord_follow.py``). Was hier hinausgeht, schreibt ein Mensch bewusst: ein Text, ein Ziel (Community, News
oder Events und Turniere), alle eingeschalteten Server oder einzelne. Je Server geht eine Einbettung in den Kanal dieses
Ziels - über ``send_to``, also mit den Regeln jeder Meldung: nur öffentliche Ziele, nie auf einen anderen Server, jede
Sendung im Versand-Log mit ihrem Server. Die Fußzeile sagt, wer verteilt hat und von wo. Erwähnt wird niemand.

Erst die Vorschau (``plan``), dann das Senden (``send``): im Discord als Antwort nur für die fragende Person mit dem
Knopf „Senden“, im Admin als Liste „geht an …“ vor dem zweiten Klick.
"""
from __future__ import annotations

from models import new_id, now_utc

# Wer verteilen darf: Turnierleitung, Vereinsverwaltung (Vorstand) und System.
STAFF_AREAS = frozenset({"tournaments", "club", "system"})
TARGET_CHOICES = (("community", "Community"), ("news", "News"), ("events", "Events und Turniere"))
TARGET_NAMES = dict(TARGET_CHOICES)
EVENT_KEY = "staff.distribute"
DEFAULT_TITLE = "Mitteilung"
MAX_TEXT = 1800
MAX_TITLE = 120
COLOR = 0x29B6E8
NOT_STAFF = "Nur für Turnierleitung und Vorstand – mit einem Discord-Konto, das mit der Website verknüpft ist (`/verknuepfen`)."


class DistributeError(ValueError):
    """Eine Eingabe, die so nicht verschickt werden kann - der Text sagt warum."""


async def staff_user(db, discord_user_id) -> dict | None:
    """Das verknüpfte Konto hinter einer Discord-Kennung - nur, wenn es Turnierleitung oder Vorstand ist."""
    from services.discord_bot import linked_discord_ids
    from services.permissions import areas_for

    user_id = (await linked_discord_ids(db)).get(str(discord_user_id))
    user = await db.users.find_one({"id": user_id}, {"_id": 0}) if user_id else None
    if not user or user.get("is_active") is False or user.get("is_banned"):
        return None
    return user if STAFF_AREAS & await areas_for(user, db) else None


async def servers(db) -> list[dict]:
    """Wohin verteilt werden kann: der Hauptserver und jeder eingeschaltete Unterserver, auf dem der Bot noch ist."""
    from services import discord_guilds

    return [row for row in await discord_guilds.list_guilds(db) if not row.get("left_at") and (row.get("role") == "main" or row.get("enabled"))]


async def server_choices(db, typed: str = "", limit: int = 25) -> list[dict]:
    """Vorschläge für ``server:`` im Befehl - nach Name gefiltert."""
    needle = str(typed or "").strip().lower()
    rows = [row for row in await servers(db) if needle in str(row.get("name") or "").lower()]
    return [{"name": str(row.get("name") or "Server")[:100], "value": str(row["guild_id"])} for row in rows[:limit]]


def clean(text, title=None) -> tuple[str, str]:
    """Text und Überschrift, wie sie hinausgehen - oder der Grund, warum nicht."""
    body = str(text or "").strip()
    if not body:
        raise DistributeError("Der Text fehlt.")
    if len(body) > MAX_TEXT:
        raise DistributeError(f"Der Text ist zu lang ({len(body)} Zeichen) – höchstens {MAX_TEXT}.")
    head = " ".join(str(title or "").split())[:MAX_TITLE] or DEFAULT_TITLE
    return body, head


def footer_text(author: str, origin: str = "") -> str:
    name = " ".join(str(author or "").split())[:60] or "dem Verein"
    place = " ".join(str(origin or "").split())[:60]
    return f"verteilt von {name} vom {place}" if place else f"verteilt von {name} über die Website"


async def plan(db, *, text, target: str = "community", guild_ids=None, title=None) -> dict:
    """Was verschickt würde: je Server der Kanal des Ziels - oder dass dort keiner gewählt ist."""
    from discord_service import PUBLIC_TARGETS, target_channel

    body, head = clean(text, title)
    if target not in PUBLIC_TARGETS:
        raise DistributeError("Verteilt wird nur in öffentliche Kanäle: Community, News oder Events und Turniere.")
    rows = await servers(db)
    if guild_ids:
        wanted = {str(value) for value in guild_ids}
        if wanted - {str(row["guild_id"]) for row in rows}:
            raise DistributeError("Diesen Server gibt es nicht, oder er ist ausgeschaltet.")
        rows = [row for row in rows if str(row["guild_id"]) in wanted]
    if not rows:
        raise DistributeError("Es gibt keinen Server, an den verteilt werden kann.")
    out = []
    for row in rows:
        resolved = await target_channel(target, None if row.get("role") == "main" else row)
        out.append({"guild_id": str(row["guild_id"]), "name": row.get("name") or "Server", "main": row.get("role") == "main",
                    "target": resolved["target"], "fallback": bool(resolved.get("fallback")), "channel_id": resolved.get("channel_id") or "",
                    "ready": bool(resolved.get("channel_id"))})
    return {"title": head, "text": body, "target": target, "servers": out}


def preview_text(drafted: dict) -> str:
    """Die Rückfrage über der Vorschau: wohin es geht - und wo heute kein Kanal dafür gewählt ist."""
    label = TARGET_NAMES.get(drafted["target"], drafted["target"])
    ready = [row for row in drafted["servers"] if row["ready"]]
    lines = []
    if ready:
        names = ", ".join(f"{row['name']} (dort in Community)" if row["fallback"] else row["name"] for row in ready)
        lines.append(f"Geht in „{label}“ an {len(ready)} Server: {names}.")
    missing = [row["name"] for row in drafted["servers"] if not row["ready"]]
    if missing:
        lines.append(f"Kein Kanal dafür gewählt: {', '.join(missing)} – dort kommt nichts an.")
    lines.append("Erwähnt wird niemand. „Senden“ schickt es ab." if ready else "So kommt nirgends etwas an – erst unter Verbindungen → Discord die Kanäle wählen.")
    return "\n".join(lines)


def result_text(result: dict) -> str:
    """Was geschehen ist, in einem Satz je Ausgang."""
    sent = [row["name"] for row in result["servers"] if row["ok"]]
    failed = [f"{row['name']} ({row.get('error') or row.get('reason') or 'Fehler'})" for row in result["servers"] if not row["ok"]]
    lines = []
    if sent:
        lines.append(f"Gesendet an {len(sent)} Server: {', '.join(sent)}.")
    if failed:
        lines.append("Nicht angekommen: " + "; ".join(failed))
    return "\n".join(lines) or "Nichts gesendet."


async def send(db, *, text, target: str = "community", guild_ids=None, title=None, author: str = "", origin: str = "",
               actor_id: str | None = None, via: str = "discord") -> dict:
    """Verschickt die Mitteilung - je Server eine Einbettung in den Kanal des Ziels. Ein Server ohne Kanal oder ohne
    Recht hält die anderen nicht auf; das Ergebnis nennt je Server, was geschah. Jede Sendung steht im Versand-Log,
    das Verteilen selbst in den Adminaktionen (wer, wohin, wie viele - nicht der Text)."""
    from discord_service import send_to

    drafted = await plan(db, text=text, target=target, guild_ids=guild_ids, title=title)
    footer = footer_text(author, origin)
    results = []
    for server in drafted["servers"]:
        sent = await send_to(target, drafted["title"], drafted["text"], color=COLOR, footer=footer, event_key=EVENT_KEY, guild_id=server["guild_id"])
        results.append({**server, "ok": bool(sent.get("ok")), "reason": sent.get("reason"), "error": sent.get("error")})
    done = sum(1 for row in results if row["ok"])
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "discord.distribute", "target_id": "discord", "actor_id": actor_id,
        "data": {"via": via, "target": target, "guild_ids": [row["guild_id"] for row in results], "sent": done, "failed": len(results) - done},
        "created_at": now_utc().isoformat(),
    })
    return {"ok": done > 0, "sent": done, "failed": len(results) - done, "title": drafted["title"], "text": drafted["text"],
            "target": target, "servers": results}


async def draft_from_discord(db, discord_user_id, text, target: str = "community", server: str | None = None, title=None,
                             *, author: str = "", guild_id=None) -> dict:
    """``/verteilen``: prüft, wer fragt, und baut die Vorschau - gesendet wird erst mit dem Knopf."""
    from discord_service import build_embed

    user = await staff_user(db, discord_user_id)
    if not user:
        return {"ok": False, "text": NOT_STAFF}
    try:
        drafted = await plan(db, text=text, target=target, guild_ids=[server] if server else None, title=title)
    except DistributeError as exc:
        return {"ok": False, "text": str(exc)}
    row = await db.discord_guilds.find_one({"guild_id": str(guild_id or "")}, {"_id": 0, "name": 1}) if guild_id else None
    origin = (row or {}).get("name") or "Discord"
    name = author or user.get("display_name") or user.get("username") or ""
    embed = await build_embed(drafted["title"], drafted["text"], color=COLOR, footer=footer_text(name, origin))
    return {"ok": True, "user": user, "plan": drafted, "content": preview_text(drafted), "embed": embed, "author": name, "origin": origin,
            "sendable": any(entry["ready"] for entry in drafted["servers"])}
