"""Der Vereinsgeburtstag (Jahreszeiten III S13 #644, B3 #751).

Am Gründungstag (``founding.py``: Dolibarr oder Verein → Über uns) feiern Web und App „X Jahre THE LION SQUAD“. Für
Vereinsmitglieder liegt ein Jahres-Sticker aus „Zum Vereinsgeburtstag“ bereit - einer je Person und Jahr, abzuholen im
Gruß (``season_stickers``). Ab 10:00 grüßt der Bot einmal im Jahr im Community-Kanal, wenn das Ereignis
„Vereinsgeburtstag“ unter Verbindungen → Discord eingeschaltet ist (Vorgabe aus) - nur am echten Gründungstag, nicht
wenn die Saison im Admin erzwungen ist.
"""
from __future__ import annotations

from datetime import datetime

from services import season_stickers

SEASON = "club_birthday"
DISCORD_EVENT = "club.birthday"
DISCORD_HOUR = 10
MARKER_ID = "club_birthday_discord"


def years_of(season: dict | None) -> int | None:
    years = ((season or {}).get("data") or {}).get("years")
    return int(years) if isinstance(years, int) and years > 0 else None


async def sticker_state(db, user: dict, season: dict | None) -> dict:
    """Was der Geburtstag für diese Person gerade ist: läuft er, ist sie Mitglied, hat sie ihren Sticker schon."""
    member = bool(user.get("is_club_member"))
    if not season:
        return {"active": False, "member": member, "claimed": False, "sticker": None}
    year = season_stickers.season_year(season)
    state = await season_stickers.gift_state(db, SEASON, user["id"], year) if member else {"given": False, "sticker": None}
    return {"active": True, "year": year, "years": years_of(season), "member": member, "claimed": state["given"], "sticker": state["sticker"]}


def preview_state(season: dict) -> dict:
    """Vorschau: der Gruß, wie ihn ein Mitglied sieht - Sticker noch nicht abgeholt."""
    return {"active": True, "year": season_stickers.season_year(season), "years": years_of(season), "member": True, "claimed": False, "sticker": None, "preview": True}


def preview_sticker(user: dict, season: dict) -> dict:
    """Vorschau: der Sticker, den diese Person bekäme - nichts wird vergeben."""
    return season_stickers.preview_gift(SEASON, user["id"], season_stickers.season_year(season))


async def claim_sticker(db, user: dict, season: dict) -> dict:
    """Den Jahres-Sticker abholen: einmal je Mitglied und Jahr, danach derselbe noch einmal."""
    return await season_stickers.give(db, SEASON, user["id"], season_stickers.season_year(season))


def discord_message(season: dict, club_name: str) -> tuple[str, str]:
    """Titel und Text des Grußes - der Text aus dem Admin (Saison-Texte), die Jahre eingesetzt."""
    years = years_of(season)
    title = f"🎂 {years} Jahre {club_name}" if years else f"🎂 Vereinsgeburtstag – {club_name}"
    greeting = str((season.get("texts") or {}).get("greeting") or "").strip()
    return title, greeting or "Danke, dass ihr dabei seid!"


async def greet_on_discord(db, season: dict | None, now: datetime) -> dict:
    """Einmal im Jahr ab 10:00 (Wien) am Gründungstag: der Gruß im Community-Kanal. Nie bei einer erzwungenen Saison
    oder in der Vorschau, nie zweimal im Jahr (Merker in den Einstellungen) - auch nicht nach einem Neustart."""
    import discord_service

    if not season or season.get("key") != SEASON or season.get("forced"):
        return {"sent": False, "reason": "no_birthday"}
    if now.hour < DISCORD_HOUR:
        return {"sent": False, "reason": "too_early"}
    year = season_stickers.season_year(season)
    marker = await db.settings.find_one({"id": MARKER_ID}, {"_id": 0, "year": 1}) or {}
    if marker.get("year") == year:
        return {"sent": False, "reason": "already_sent"}
    cfg = await discord_service._get_discord_config()
    if not discord_service.event_enabled(cfg, DISCORD_EVENT):
        return {"sent": False, "reason": "event_disabled"}
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "club_name": 1}) or {}
    title, text = discord_message(season, branding.get("club_name") or "THE LION SQUAD")
    result = await discord_service.send_event(DISCORD_EVENT, title, text, color=0xFFD700)
    if result.get("ok"):
        await db.settings.update_one({"id": MARKER_ID}, {"$set": {"id": MARKER_ID, "year": year, "sent_at": now.isoformat()}}, upsert=True)
    return {"sent": bool(result.get("ok")), "reason": result.get("reason")}
