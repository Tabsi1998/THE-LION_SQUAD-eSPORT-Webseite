"""„Turnier live“ (#579): streamt ein Teilnehmer, während sein Turnier läuft, sagt die Website es.

Die Live-Erkennung (``twitch_service``) weiß, welche verknüpften Konten gerade streamen. Läuft ein
öffentliches Turnier (Status ``live``) und einer seiner Teilnehmer streamt, dann

- zeigt die Turnierseite einen Kasten „Live“ mit den Streams (``GET /api/tournaments/{id}/streams``),
- meldet der Bot es **einmal je Stream-Start** in den Kanal „Events und Turniere“
  („🔴 Paula streamt den Sommer-Cup – zuschauen“) - festgehalten je Turnier und Stream-ID.

Nur öffentliche Turniere, nur Teilnehmer mit öffentlichem Profil (und Twitch nicht auf „privat“).
"""
from __future__ import annotations

import logging

from models import new_id, now_utc

logger = logging.getLogger("tls.tournament.streams")

ANNOUNCEMENTS = "tournament_stream_announcements"
STREAM_FIELDS = ("user_id", "username", "display_name", "avatar_url", "twitch_login", "stream_id", "title", "game_name",
                 "viewer_count", "thumbnail_url", "started_at", "stream_url")


def _twitch_visible(user: dict) -> bool:
    return bool(user.get("privacy_public_profile")) and (user.get("profile_visibility") or {}).get("twitch", "public") == "public"


def public_tournament(tournament: dict | None) -> bool:
    return bool(tournament) and tournament.get("status") != "draft" and tournament.get("is_public") is not False \
        and (tournament.get("visibility") or "public") == "public"


async def live_streams_for_tournament(db, tournament: dict) -> list[dict]:
    """Die laufenden Streams der Teilnehmer - nur Personen mit öffentlichem Profil."""
    from services.match_notifications import _participant_user_ids

    if not public_tournament(tournament):
        return []
    registrations = await db.tournament_registrations.find(
        {"tournament_id": tournament["id"], "status": {"$nin": ["cancelled", "rejected", "withdrawn", "no_show"]}},
        {"_id": 0, "user_id": 1, "team_id": 1},
    ).to_list(2000)
    participants = await _participant_user_ids(db, registrations)
    if not participants:
        return []
    streams = await db.live_streams.find({"user_id": {"$in": list(participants)}}, {"_id": 0}).sort("viewer_count", -1).to_list(100)
    if not streams:
        return []
    users = await db.users.find(
        {"id": {"$in": [stream["user_id"] for stream in streams]}, "is_active": True, "is_banned": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "privacy_public_profile": 1, "profile_visibility": 1},
    ).to_list(100)
    visible = {user["id"]: user for user in users if _twitch_visible(user)}
    rows = []
    for stream in streams:
        user = visible.get(stream.get("user_id"))
        if not user:
            continue
        row = {key: stream.get(key) for key in STREAM_FIELDS}
        row["public_profile_url"] = f"/u/{user.get('username')}" if user.get("username") else None
        rows.append(row)
    return rows


async def sync(db) -> dict:
    """Nach jeder Live-Abfrage: je laufendem öffentlichen Turnier und neuem Stream genau eine Meldung."""
    from discord_service import send_event
    from services.discord_announcements import stream_live_message

    announced = 0
    tournaments = await db.tournaments.find({"status": "live", "is_public": {"$ne": False}}, {"_id": 0}).to_list(200)
    for tournament in tournaments:
        if not public_tournament(tournament):
            continue
        for stream in await live_streams_for_tournament(db, tournament):
            key = {"tournament_id": tournament["id"], "stream_id": stream.get("stream_id")}
            if not stream.get("stream_id") or await db[ANNOUNCEMENTS].find_one(key, {"_id": 0, "id": 1}):
                continue
            message = stream_live_message(tournament, stream)
            result = await send_event(message["event_key"], message["title"], message["description"], item=tournament, color=message["color"],
                                      url=message["url"], fields=message["fields"], image_url=message["image_url"])
            await db[ANNOUNCEMENTS].insert_one({"id": new_id(), **key, "user_id": stream.get("user_id"), "announced_at": now_utc().isoformat(),
                                                "outcome": "sent" if result.get("ok") else (result.get("reason") or "failed")})
            announced += 1
    return {"tournaments": len(tournaments), "announced": announced}
