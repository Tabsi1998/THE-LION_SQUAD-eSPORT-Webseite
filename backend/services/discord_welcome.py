"""Willkommensnachricht im Discord (#574): wer neu auf den Server kommt, bekommt vom Bot eine Direktnachricht.

Kurz, was der Verein ist, wo man sich auf der Website anmeldet und wie man das Discord-Konto verknüpft - je
mehr Konten verknüpft sind, desto mehr bringen Rollen, Direktnachrichten und ``/meine-erfolge``. Der Text
steht im Admin (Verbindungen → Discord → Willkommensnachricht) mit Vorschau; ``{name}`` wird der Name im
Discord, ``{verein}`` der Vereinsname. Standard **aus**, bis der Betreiber den Text geprüft hat.

Einmal je Person: gemerkt wird nur ein Hash der Discord-Kennung (``discord_welcomes``), nie Name oder
Kennung selbst. Lässt die Person keine Direktnachrichten zu, passiert nichts weiter - nur der Zähler
„Direktnachrichten zu“ steigt. Ein vorübergehender Fehler darf beim nächsten Beitritt noch einmal.
"""
from __future__ import annotations

import hashlib

from models import now_utc

COLLECTION = "discord_welcomes"
MAX_TEXT = 1500
DEFAULT_TEXT = (
    "Hallo {name}, schön, dass du da bist! 🦁\n\n"
    "Wir sind {verein} – ein eSports-Verein mit Turnieren, Events und einer Community, die gemeinsam zockt. "
    "Alle Termine, Turniere und Ergebnisse stehen auf unserer Website.\n\n"
    "Tipp: Verknüpfe dein Discord-Konto mit der Website (Profil → Socials). Dann bekommst du deine Vereinsrollen, "
    "deine Nachrichten zählen für Erfolge, und auf Wunsch kommen Benachrichtigungen als Direktnachricht."
)
BUTTONS = [{"label": "Auf der Website anmelden", "url": "/register"}, {"label": "Konto verknüpfen", "url": "/profile?tab=socials"}]
# Ein Ergebnis, nach dem dieselbe Person nie wieder eine Willkommensnachricht bekommt.
FINAL_OUTCOMES = ("pending", "sent", "dm_closed")
OUTCOME_LABELS = {"sent": "gesendet", "dm_closed": "Direktnachrichten zu", "error": "Fehler"}


def welcome_settings(settings: dict | None) -> dict:
    stored = (settings or {}).get("welcome") or {}
    text = str(stored.get("text") or "").strip()
    return {"enabled": bool(stored.get("enabled")), "text": text or DEFAULT_TEXT, "custom": bool(text)}


def person_key(discord_user_id) -> str:
    """Nur ein Hash - die Website merkt sich weder Name noch Kennung von Leuten, die nur auf dem Server sind."""
    return hashlib.sha256(f"lion-discord-welcome:{discord_user_id}".encode("utf-8")).hexdigest()


def welcome_message(text: str, *, name: str = "", club: str = "THE LION SQUAD") -> dict:
    """Die Nachricht, wie sie ankommt - die Vorschau im Admin baut sie hiermit."""
    body = str(text or DEFAULT_TEXT).replace("{name}", (name or "").strip() or "du").replace("{verein}", club)
    return {"title": f"Willkommen bei {club}!"[:256], "description": body[:4000], "color": 0x29B6E8, "url": "/", "buttons": [dict(b) for b in BUTTONS]}


async def _club_name(db) -> str:
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "club_name": 1, "site_name": 1}) or {}
    return str(branding.get("club_name") or branding.get("site_name") or "THE LION SQUAD")


async def render(db, text: str, name: str = "") -> dict:
    """Embed und Knöpfe für Discord - Vorschau, Test und Versand gehen alle hier durch."""
    from discord_service import build_embed, resolve_buttons

    message = welcome_message(text, name=name, club=await _club_name(db))
    embed = await build_embed(message["title"], message["description"], color=message["color"], url=message["url"])
    return {"embed": embed, "buttons": await resolve_buttons(message["buttons"])}


async def greet(db, discord_user_id, name: str = "", *, is_bot: bool = False) -> dict:
    """Beitritt zum Server: einmal je Person die Willkommensnachricht - ohne Erlaubnis still."""
    from services.discord_bot import bot

    if is_bot:
        return {"ok": False, "reason": "bot_account"}
    cfg = welcome_settings(await db.settings.find_one({"id": "discord"}, {"_id": 0, "welcome": 1}))
    if not cfg["enabled"]:
        return {"ok": False, "reason": "disabled"}
    key = person_key(discord_user_id)
    known = await db[COLLECTION].find_one({"key": key}, {"_id": 0, "outcome": 1})
    if known and known.get("outcome") in FINAL_OUTCOMES:
        return {"ok": False, "reason": "already_greeted"}
    stamp = now_utc().isoformat()
    await db[COLLECTION].update_one({"key": key}, {"$set": {"outcome": "pending", "updated_at": stamp}, "$setOnInsert": {"created_at": stamp}}, upsert=True)
    rendered = await render(db, cfg["text"], name)
    try:
        result = await bot.send_dm(str(discord_user_id), rendered["embed"], buttons=rendered["buttons"])
    except Exception as exc:  # noqa: BLE001 - ein Beitritt darf nie an Discord scheitern
        result = {"ok": False, "reason": "error", "error": type(exc).__name__}
    outcome = "sent" if result.get("ok") else ("dm_closed" if result.get("reason") == "forbidden" else "error")
    await db[COLLECTION].update_one({"key": key}, {"$set": {"outcome": outcome, "updated_at": now_utc().isoformat()}})
    return {"ok": outcome == "sent", "reason": None if outcome == "sent" else outcome}


async def welcome_status(db, settings: dict | None = None) -> dict:
    """Für den Kasten im Admin: Schalter, Text, Vorschau und Zähler."""
    settings = settings if settings is not None else await db.settings.find_one({"id": "discord"}, {"_id": 0, "welcome": 1})
    cfg = welcome_settings(settings)
    counts = {key: await db[COLLECTION].count_documents({"outcome": key}) for key in OUTCOME_LABELS}
    last = await db[COLLECTION].find_one({"outcome": {"$in": list(OUTCOME_LABELS)}}, {"_id": 0, "updated_at": 1}, sort=[("updated_at", -1)])
    return {**cfg, "default_text": DEFAULT_TEXT, "max_length": MAX_TEXT, "preview": await render(db, cfg["text"], "Paula"),
            "stats": {**counts, "last_at": (last or {}).get("updated_at")}}


async def send_test(db, admin: dict, text: str | None = None) -> dict:
    """„An mich senden“: die Nachricht als Direktnachricht an das eigene verknüpfte Konto - zählt nicht, merkt nichts."""
    from discord_service import REASON_TEXTS
    from services.discord_bot import bot
    from services.discord_dm_basics import discord_link_id

    discord_id = await discord_link_id(db, admin["id"])
    if not discord_id:
        return {"ok": False, "reason": "not_linked", "error": REASON_TEXTS["not_linked"]}
    cfg = welcome_settings(await db.settings.find_one({"id": "discord"}, {"_id": 0, "welcome": 1}))
    rendered = await render(db, (text or "").strip() or cfg["text"], str(admin.get("display_name") or admin.get("username") or ""))
    try:
        result = await bot.send_dm(discord_id, rendered["embed"], buttons=rendered["buttons"])
    except Exception as exc:  # noqa: BLE001
        result = {"ok": False, "reason": "error", "error": type(exc).__name__}
    if not result.get("ok"):
        reason = "dm_forbidden" if result.get("reason") == "forbidden" else (result.get("reason") or "error")
        return {"ok": False, "reason": reason, "error": result.get("error") or REASON_TEXTS.get(reason) or reason}
    return {"ok": True}
