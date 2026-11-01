"""Altdaten ``user_socials`` in die Profilfelder überführen (#2113, L-A12).

Früher lagen Socials in einer eigenen Sammlung. Heute pflegen Website und App die Felder am Konto (``twitch_handle`` …)
mit der Sichtbarkeit je Feld (``profile_visibility``); für die alte Sammlung gibt es keinen Aufrufer mehr. Das öffentliche
Profil las sie aber noch aus - was dort stand, war sichtbar und ließ sich nicht löschen.

Je Eintrag: Ist das Profilfeld leer, zieht der Wert samt seiner Sichtbarkeit um (das Feld war leer, die Stufe des Eintrags
gilt also genau für diesen Wert). Steht derselbe Wert schon da, ist der Eintrag überflüssig. Beide verschwinden danach.
Steht dort ein **anderer** Wert, gewinnt das Profilfeld - die Person pflegt es heute -, und der Eintrag bleibt liegen:
unsichtbar, aber nichts geht verloren; er steht weiter in der Datenauskunft und geht mit dem Konto. Mehrfach ausführbar.
"""
from __future__ import annotations

from typing import Awaitable, Callable

from services.private_fields import private_projection

PROFILE_FIELDS = {
    "discord": "discord_name", "twitch": "twitch_handle", "youtube": "youtube_handle", "tiktok": "tiktok_handle",
    "instagram": "instagram_handle", "x": "x_handle", "steam": "steam_id", "epic": "epic_id", "psn": "psn_id",
    "xbox": "xbox_id", "nintendo": "nintendo_fc", "ea": "ea_id", "riot": "riot_id", "battlenet": "battlenet_id",
    "website": "website", "faceit": "faceit_handle", "startgg": "startgg_handle", "roblox": "roblox_handle",
    "osu": "osu_handle", "lichess": "lichess_handle", "github": "github_handle", "kick": "kick_handle",
    "reddit": "reddit_handle", "spotify": "spotify_handle", "threads": "threads_handle", "facebook": "facebook_handle",
    "linkedin": "linkedin_handle", "snapchat": "snapchat_handle", "pinterest": "pinterest_handle",
    "telegram": "telegram_handle", "wargaming": "wargaming_handle", "bungie": "bungie_handle",
    "mastodon": "mastodon_handle", "bluesky": "bluesky_handle",
}
LEVELS = {"public", "community", "members", "admins", "private"}
LEASE_EVERY = 200


def _same(left, right) -> bool:
    return str(left or "").strip().casefold() == str(right or "").strip().casefold()


async def migrate(db, keep_lease: Callable[[], Awaitable[bool]] | None = None) -> str:
    """Liefert die Zählung fürs Protokoll. ``keep_lease`` verlängert die Sperre des Migrationslaufs; ``False`` beendet den
    Lauf (der nächste Start macht weiter - fertige Einträge sind dann schon weg)."""
    moved = same = kept = dropped = seen = 0
    async for row in db.user_socials.find({}, {"_id": 1, "user_id": 1, "platform": 1, "value": 1, "url": 1, "visibility": 1}):
        seen += 1
        if keep_lease and seen % LEASE_EVERY == 0 and not await keep_lease():
            raise RuntimeError("lease lost")
        user = await db.users.find_one({"id": row.get("user_id")}, private_projection()) if row.get("user_id") else None
        value = str(row.get("value") or row.get("url") or "").strip()
        platform = str(row.get("platform") or "").strip().lower()
        field = PROFILE_FIELDS.get(platform)
        # Ohne Konto, mit gelöschtem Konto oder ohne Wert hat der Eintrag keinen Zweck mehr.
        if not user or user.get("anonymized_at") or (field and not value):
            await db.user_socials.delete_one({"_id": row["_id"]})
            dropped += 1
            continue
        if not field:
            kept += 1
            continue
        current = user.get(field)
        if str(current or "").strip():
            if not _same(current, value):
                kept += 1
                continue
            same += 1
            # TikTok ist ohne Stufe privat (user_routes.FIELD_DEFAULT_LEVELS, #2113): Dieser Eintrag war schon mit seiner
            # Stufe sichtbar, und sie zieht mit um - beim Verschwinden des Eintrags ginge sie sonst verloren.
            levels = user.get("profile_visibility") if isinstance(user.get("profile_visibility"), dict) else {}
            if platform == "tiktok" and row.get("visibility") in LEVELS and not {"tiktok", "tiktok_handle"} & set(levels):
                await db.users.update_one({"id": user["id"]}, {"$set": {"profile_visibility": {**levels, "tiktok": row["visibility"]}}})
        else:
            # Ohne gültige Stufe war der Eintrag unsichtbar (das Profil las nur „public“) - das bleibt so.
            level = row.get("visibility") if row.get("visibility") in LEVELS else "private"
            # Die ganze Karte schreiben: ``profile_visibility.x`` bricht bei ``null`` im Feld mit einem Datenbankfehler ab.
            visibility = user.get("profile_visibility")
            visibility = {**(visibility if isinstance(visibility, dict) else {}), platform: level}
            await db.users.update_one({"id": user["id"]}, {"$set": {field: value, "profile_visibility": visibility}})
            moved += 1
        await db.user_socials.delete_one({"_id": row["_id"]})
    linked = await _keep_linked_tiktok_public(db)
    return (f"{moved} moved, {same} already in the profile, {kept} kept, {dropped} empty or without account removed, "
            f"{linked} linked TikTok kept public")


async def _keep_linked_tiktok_public(db) -> int:
    """Was öffentlich war, bleibt es (#2113): Ein verknüpftes TikTok stand mit Häkchen im Profil, auch ohne wählbare Stufe.
    Da TikTok ohne Stufe jetzt privat ist, bekommen diese Konten einmalig ``public``. Eine gewählte Stufe bleibt; wer erst
    nach dieser Migration verknüpft, folgt der Vorgabe „privat“, bis die Person wählt."""
    count = 0
    query = {"platform_verified.tiktok": True, "anonymized_at": {"$in": [None, ""]}}
    async for user in db.users.find(query, {"_id": 0, "id": 1, "profile_visibility": 1}):
        levels = user.get("profile_visibility") if isinstance(user.get("profile_visibility"), dict) else {}
        if {"tiktok", "tiktok_handle"} & set(levels):
            continue
        await db.users.update_one({"id": user["id"]}, {"$set": {"profile_visibility": {**levels, "tiktok": "public"}}})
        count += 1
    return count
