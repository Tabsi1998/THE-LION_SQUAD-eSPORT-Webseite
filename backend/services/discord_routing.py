"""Versand-Routing (#627, Discord VI): wohin eine Meldung mit Spielbezug geht.

Jede Ereignisart hat eine Regel, einstellbar unter Verbindungen → Discord → Meldungen:

- ``game_server_plus_crossref`` (Vorgabe mit Spielbezug): voll auf den Spielserver, am Hauptserver ein kurzer
  **Querverweis** - Titel, ein Satz, Knopf zur Nachricht und zum Beitreten, nie der volle Inhalt.
- ``both_full``: voll auf beide Server.
- ``game_server_only``: nur der Spielserver.
- ``main_only`` (Vorgabe ohne Spielbezug und für alles Private): nur der Hauptserver.

Spielbezug: Turnier → Spiel, Live-Stream → Turnier → Spiel, Fast-Lap-Challenge → Spiel; Events und News, sobald
sie ein Spiel tragen. Der Spielserver kommt aus ``discord_guild_store.guild_for_game`` (eigener Server, der des
Hauptspiels, sonst der Hauptserver). Ist er aus, verlassen oder ohne Kanal für das Ziel, geht die Meldung voll an
den Hauptserver - Server → Server in derselben Sichtbarkeit, nie privat → öffentlich. Scheitert bei „+ Querverweis“
der Versand am Spielserver, geht die Meldung ebenfalls voll an den Hauptserver statt eines Verweises ins Leere.
Private Ziele kennen nur den Hauptserver.
"""
from __future__ import annotations

RULES = ("game_server_plus_crossref", "both_full", "game_server_only", "main_only")
RULE_LABELS = {
    "game_server_plus_crossref": "Spielserver + Querverweis am Hauptserver",
    "both_full": "Spielserver und Hauptserver (beide voll)",
    "game_server_only": "nur Spielserver",
    "main_only": "nur Hauptserver",
}
# Scheitert der Versand am Spielserver so, bekommt der Hauptserver die volle Meldung statt des Querverweises.
FALLBACK_REASONS = ("forbidden", "unknown_channel", "channel_missing", "http", "error", "thread_forbidden")
CROSSREF_TEXT_MAX = 200


def routable(event_key: str) -> bool:
    """Kann diese Ereignisart einen Spielbezug haben (und ist sie öffentlich)?"""
    from discord_service import EVENTS, PRIVATE_TARGETS

    spec = EVENTS.get(event_key) or {}
    return bool(spec.get("game")) and spec.get("target") not in PRIVATE_TARGETS


def default_rule(event_key: str) -> str:
    return "game_server_plus_crossref" if routable(event_key) else "main_only"


def rule_for(cfg: dict, event_key: str) -> str:
    """Die eingestellte Regel - ohne Spielbezug und für Privates immer „nur Hauptserver“."""
    if not routable(event_key):
        return "main_only"
    stored = (cfg.get("routing") or {}).get(event_key)
    return stored if stored in RULES else default_rule(event_key)


async def game_of(db, item: dict | None) -> dict | None:
    game_id = (item or {}).get("game_id")
    if not game_id:
        return None
    from services.discord_guild_store import GAME_FIELDS

    return await db.games.find_one({"id": game_id}, GAME_FIELDS)


async def plan(db, cfg: dict, event_key: str, item: dict | None, target: str) -> dict:
    """Wohin diese Meldung geht. ``game``: der Spielserver (Eintrag), der sie voll bekommt, oder None; ``main``:
    "full", "crossref" oder None; ``reason``: warum es beim Hauptserver bleibt."""
    from discord_service import PRIVATE_TARGETS, resolve_target
    from services.discord_guild_store import guild_for_game

    rule = rule_for(cfg, event_key)
    out = {"rule": rule, "game": None, "main": "full", "game_name": None, "reason": None}
    if target in PRIVATE_TARGETS or rule == "main_only":
        out["reason"] = "rule"
        return out
    game = await game_of(db, item)
    if not game:
        out["reason"] = "no_game"
        return out
    out["game_name"] = game.get("display_name") or game.get("name")
    row = await guild_for_game(db, game)
    if not row or row.get("role") == "main":
        out["reason"] = "no_game_server"
        return out
    if not resolve_target(cfg, target, row).get("channel_id"):
        out["reason"] = "game_server_without_channel"
        return out
    out["game"] = row
    out["main"] = {"game_server_plus_crossref": "crossref", "both_full": "full", "game_server_only": None}[rule]
    return out


def message_link(guild_id, channel_id, message_id) -> str | None:
    """Ein Link auf genau diese Nachricht - öffnet nur, wer auf dem Server ist."""
    if not (guild_id and channel_id and message_id):
        return None
    return f"https://discord.com/channels/{guild_id}/{channel_id}/{message_id}"


def crossref_message(title: str, *, url: str | None, server: dict, game_name: str | None, sent: dict | None, color: int = 0x29B6E8) -> dict:
    """Der Querverweis am Hauptserver: Titel, ein Satz, „Zum Server …“ und „Beitreten“ - nie der volle Inhalt (keine
    Beschreibung der Meldung, keine Felder, kein Bild). Der Nachrichtenlink öffnet nur, wer auf beiden Servern ist -
    darum immer zusätzlich die Einladung."""
    name = str(server.get("name") or "Spielserver")
    link = message_link(server.get("guild_id"), (sent or {}).get("channel_id"), (sent or {}).get("message_id"))
    invite = server.get("invite_url") or None
    buttons = []
    if link or invite:
        buttons.append({"label": f"Zum Server „{name}“"[:80], "url": link or invite})
    if link and invite:
        buttons.append({"label": "Beitreten", "url": invite})
    footer = f"aus dem {game_name}-Server" if game_name else f"aus dem Server „{name}“"
    return {"title": str(title or "")[:256], "description": f"Alles dazu steht auf unserem Discord-Server „{name}“."[:CROSSREF_TEXT_MAX],
            "url": url, "buttons": buttons, "footer": footer[:200], "color": color, "fields": None, "image_url": None}


def preview_text(rule: str, target_label: str, example: dict | None) -> str:
    """„geht an: …“ für das Admin - mit einem Spielserver als Beispiel, wenn es einen gibt."""
    server = (example or {}).get("server_name") or "Spielserver"
    if rule == "main_only":
        return f"geht an: Hauptserver ({target_label})"
    if rule == "game_server_only":
        return f"geht an: {server} ({target_label})"
    if rule == "both_full":
        return f"geht an: {server} ({target_label}), Hauptserver ({target_label})"
    return f"geht an: {server} ({target_label}), Hauptserver (Querverweis)"


async def routing_example(db) -> dict | None:
    """Ein Spiel mit eigenem, eingeschaltetem Server - für die Vorschau „geht an: …“."""
    from services.discord_guild_store import GAME_FIELDS, guild_for_game

    async for game in db.games.find({"discord_guild_id": {"$nin": [None, ""]}}, GAME_FIELDS):
        row = await guild_for_game(db, game)
        if row and row.get("role") != "main":
            return {"game_name": game.get("display_name") or game.get("name"), "server_name": row.get("name")}
    return None
