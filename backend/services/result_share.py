"""Ergebnis als Bild teilen (#1194): Platz, Turnier, Datum und dein Weg - hoch für WhatsApp-Status und
Instagram-Story (1080×1920), breit als Link-Vorschau (1200×630). Gezeichnet mit dem gemeinsamen Bild-Baustein.

Geteilt wird nur, was öffentlich ist: das Profil der Person ist öffentlich, das Turnier ist öffentlich und hat
Ergebnisse. Bei Teams steht der Teamname drauf (jedes Mitglied kann teilen), bei Durchgängen die Plätze je Runde.
Gegner stehen nicht auf dem Bild - nur Runde und Ergebnis.

Die Seite zum Teilen ist /tournaments/<turnier>/ergebnis/<benutzername>; Discord, WhatsApp & Co. bekommen dort das
breite Bild als Vorschau (seo_render_routes).
"""
from __future__ import annotations

from PIL import ImageDraw

from services import share_image
from services.profile_references import (
    REFERENCE_REGISTRATION_STATUSES,
    RESULT_TOURNAMENT_STATUSES,
    _team_ids_for_user,
    _tournament_rank_for_user,
    _visible_tournament,
)
from services.tournament_path import chip_text, path_kind, tournament_path

async def _tournament(db, ref: str) -> dict | None:
    return await db.tournaments.find_one({"$or": [{"id": ref}, {"slug": ref}]}, {"_id": 0})


async def own_registrations(db, tournament: dict, user: dict) -> tuple[list[dict], dict | None]:
    """Die Anmeldungen dieser Person: einzeln oder über ihr Team - beim Team darf jedes Mitglied teilen,
    auch wer an dem Tag nicht in der Aufstellung stand (es ist das Ergebnis des Teams)."""
    team_ids = await _team_ids_for_user(user["id"])
    query = {"tournament_id": tournament["id"], "status": {"$in": sorted(REFERENCE_REGISTRATION_STATUSES)},
             "$or": [{"user_id": user["id"], "team_id": {"$in": [None, ""]}}, *([{"team_id": {"$in": team_ids}}] if team_ids else [])]}
    regs = await db.tournament_registrations.find(query, {"_id": 0}).to_list(20)
    team = None
    for reg in regs:
        if reg.get("team_id") and not team:
            team = await db.teams.find_one({"id": reg["team_id"]}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "is_public": 1})
    return regs, team


async def share_payload(db, tournament_ref: str, username: str) -> dict | None:
    """Das Ergebnis als Daten - None, wenn es das nicht gibt oder es nicht öffentlich geteilt werden darf."""
    user = await db.users.find_one({"username": username}, {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1,
                                                          "privacy_public_profile": 1, "is_active": 1, "is_banned": 1})
    if not user or not user.get("privacy_public_profile") or user.get("is_active") is False or user.get("is_banned"):
        return None
    tournament = await _tournament(db, tournament_ref)
    if not tournament or tournament.get("status") not in RESULT_TOURNAMENT_STATUSES or not await _visible_tournament(tournament):
        return None
    regs, team = await own_registrations(db, tournament, user)
    if not regs:
        return None
    if team and team.get("is_public") is False:
        team = {**team, "name": None}
    rank, participant_count = await _tournament_rank_for_user(tournament["id"], user["id"], await _team_ids_for_user(user["id"]))
    steps = await tournament_path(db, tournament, {reg["id"] for reg in regs}, public=True)
    event = await db.events.find_one({"id": tournament.get("event_id")}, {"_id": 0, "name": 1}) if tournament.get("event_id") else None
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "club_name": 1, "domain": 1}) or {}
    slug = tournament.get("slug") or tournament["id"]
    team_mode = (tournament.get("team_mode") or "solo") != "solo"
    return {
        "tournament": {"id": tournament["id"], "slug": slug, "title": tournament.get("title") or "Turnier", "game_name": tournament.get("game_name")},
        "event_name": (event or {}).get("name"),
        "date": share_image.date_label(tournament.get("start_date"), vienna=True),
        "user": {"username": user["username"], "display_name": user.get("display_name") or user["username"]},
        "team_name": (team or {}).get("name"),
        "rank": rank,
        "participant_count": participant_count,
        "participant_word": "Teams" if team_mode else "Spieler",
        "kind": path_kind(steps),
        "steps": [{"label": step["label"], "result": step["result"], "outcome": step["outcome"], "kind": step["kind"]} for step in steps],
        "chips": [chip_text(step) for step in steps][:8],
        "club_name": branding.get("club_name") or "THE LION SQUAD",
        "domain": str(branding.get("domain") or "lionsquad.at").replace("https://", "").replace("http://", "").strip("/"),
        "path": f"/tournaments/{slug}/ergebnis/{user['username']}",
        "image_paths": {
            "story": f"/api/share/result/{slug}/{user['username']}/story.png",
            "wide": f"/api/share/result/{slug}/{user['username']}/wide.png",
        },
    }


def headline(payload: dict) -> str:
    """„Platz 2 im FC 26 Cup“ - ohne Platz „Dabei beim …“."""
    title = payload["tournament"]["title"]
    return f"Platz {payload['rank']} im {title}" if payload.get("rank") else f"Dabei beim {title}"


def share_text(payload: dict) -> str:
    who = payload.get("team_name") or "Ich"
    verb = "hat" if payload.get("team_name") else "habe"
    if payload.get("rank"):
        return f"{who} {verb} Platz {payload['rank']} im {payload['tournament']['title']} geholt – bei {payload['club_name']}."
    return f"{who} {verb} beim {payload['tournament']['title']} mitgespielt – bei {payload['club_name']}."


def _step_colors(step: dict, accent: tuple) -> tuple[tuple, tuple]:
    """Sieg in Cyan, Unentschieden und Platzierung weiß, Niederlage grau - Farbe für Strich und Ergebnis."""
    outcome = step.get("outcome")
    if outcome == "win":
        return accent, accent
    if outcome == "loss":
        return (110, 116, 124, 255), (170, 176, 184, 255)
    return (220, 224, 230, 255), (255, 255, 255, 255)


def _rank_color(rank) -> tuple:
    return share_image.hex_color(share_image.RANK_COLORS.get(int(rank or 0), "#FFFFFF"))


def render(payload: dict, fmt: str = "story") -> bytes:
    """Das Bild im Vereinslook: oben der Verein, groß der Platz, darunter Turnier, Datum, Person oder Team und der Weg."""
    size = share_image.STORY if fmt == "story" else share_image.WIDE
    accent = share_image.hex_color(share_image.CYAN)
    image = share_image.canvas(size, accent)
    draw = ImageDraw.Draw(image)
    share_image.frame(draw, size, accent)
    width, height = size
    rank = payload.get("rank")
    rank_color = _rank_color(rank)
    title_line = headline(payload)
    sub = " · ".join(part for part in (payload.get("event_name"), payload.get("date")) if part)
    person = payload.get("team_name") or payload["user"]["display_name"]
    shared_by = f"geteilt von {payload['user']['display_name']}" if payload.get("team_name") else ""
    count = f"{payload['participant_count']} {payload['participant_word']}".upper() if payload.get("participant_count") else ""

    if fmt == "story":
        left, right = 96, width - 96
        draw.text((left, 150), f"{payload['club_name']} · ESPORTS".upper(), font=share_image.font(34), fill=accent)
        big = f"{rank}." if rank else "Dabei"
        big_font = share_image.fit(draw, big, 380 if rank else 200, right - left, min_size=120)
        draw.text((left - 10, 230), big, font=big_font, fill=rank_color)
        y = 230 + draw.textbbox((0, 0), big, font=big_font)[3] + 40
        for line in share_image.wrap(draw, title_line, share_image.font(64), right - left, 3):
            draw.text((left, y), line, font=share_image.font(64), fill=(255, 255, 255, 255))
            y += 80
        if sub:
            draw.text((left, y + 10), sub, font=share_image.font(38, bold=False), fill=(255, 255, 255, 170))
            y += 80
        y += 40
        draw.ellipse((left, y, left + 110, y + 110), fill=share_image.blend(accent, 90), outline=accent, width=3)
        initials_font = share_image.font(40)
        mark = share_image.initials(person)
        box = draw.textbbox((0, 0), mark, font=initials_font)
        draw.text((left + 55 - (box[2] - box[0]) / 2 - box[0], y + 55 - (box[3] - box[1]) / 2 - box[1]), mark, font=initials_font, fill=(255, 255, 255, 255))
        name_font = share_image.fit(draw, person, 52, right - left - 140, min_size=30)
        draw.text((left + 140, y + 14), share_image.ellipsis(draw, person, name_font, right - left - 140), font=name_font, fill=(255, 255, 255, 240))
        if shared_by:
            draw.text((left + 140, y + 74), share_image.ellipsis(draw, shared_by, share_image.font(30, bold=False), right - left - 140), font=share_image.font(30, bold=False), fill=(255, 255, 255, 150))
        y += 190
        rows = payload.get("steps") or []
        if rows:
            draw.text((left, y), "UNSER WEG" if payload.get("team_name") else "MEIN WEG", font=share_image.font(30), fill=(255, 255, 255, 140))
            y += 56
            room = max(1, (height - 260 - y) // 92)
            if len(rows) > room:
                # Zu viele Runden: die letzten zählen (Finale, Halbfinale …), davor ein Hinweis.
                earlier = len(rows) - room + 1
                draw.text((left, y + 18), f"+ {earlier} {'frühere Runde' if earlier == 1 else 'frühere Runden'}", font=share_image.font(30, bold=False), fill=(255, 255, 255, 130))
                y += 92
                rows = rows[earlier:]
            row_font = share_image.font(38)
            for step in rows:
                mark, value_color = _step_colors(step, accent)
                share_image.row(draw, left, y, right - left, step.get("label") or "", step.get("result") or "", row_font, mark=mark, value_color=value_color)
                y += 92
        foot_font = share_image.font(34)
        draw.text((left, height - 170), payload["domain"].upper(), font=foot_font, fill=accent)
        if count:
            draw.text((right - draw.textlength(count, font=foot_font), height - 170), count, font=foot_font, fill=accent)
        return share_image.png(image)

    # Breit: links der Platz, rechts Turnier, Datum, Person und Weg.
    draw.text((70, 64), f"{payload['club_name']} · ESPORTS".upper(), font=share_image.font(24), fill=accent)
    big = f"{rank}." if rank else "–"
    big_font = share_image.fit(draw, big, 260, 330, min_size=120)
    draw.text((60, 120), big, font=big_font, fill=rank_color)
    left, right = 420, width - 70
    y = 130
    for line in share_image.wrap(draw, title_line, share_image.font(50), right - left, 2):
        draw.text((left, y), line, font=share_image.font(50), fill=(255, 255, 255, 255))
        y += 62
    if sub:
        draw.text((left, y + 6), sub, font=share_image.font(28, bold=False), fill=(255, 255, 255, 160))
        y += 50
    name_font = share_image.font(34)
    draw.text((left, y + 16), share_image.ellipsis(draw, person, name_font, right - left), font=name_font, fill=(255, 255, 255, 235))
    y += 76
    chip_font = share_image.font(24)
    x = left
    for text in payload.get("chips") or []:
        text = share_image.ellipsis(draw, text, chip_font, right - left - 20)
        chip_width = draw.textlength(text, font=chip_font) + 28
        if x + chip_width > right:
            x = left
            y += 52
        if y > height - 140:
            break
        x += share_image.chip(draw, x, y, text, chip_font, color=accent) + 10
    foot_font = share_image.font(24)
    draw.text((70, height - 92), payload["domain"].upper(), font=foot_font, fill=(255, 255, 255, 160))
    if count:
        draw.text((right - draw.textlength(count, font=foot_font), height - 92), count, font=foot_font, fill=accent)
    return share_image.png(image)
