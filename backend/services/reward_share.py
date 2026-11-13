"""Teilen-Bild einer Liga-Belohnung (F.4, #2214, Nr. 165): ein 1200×630-PNG je Eintrag, serverseitig mit Pillow wie die Karte
der Erfolge (``achievement_share``) - dunkler Grund mit Schein in der Farbe der Vorlage, links das Zeichen der Art (Banner,
Emblem, Medaille, Titel) mit dem Platz, rechts Name, Season, Liga N und Team.

Geteilt wird nur, was Profil und Teamseite auch öffentlich zeigen (``awards._visible``: Season für Gäste sichtbar, Staffel als
Turnier sichtbar) und was nicht ruht.
"""
from __future__ import annotations

from PIL import ImageDraw

from services import share_image

WIDTH, HEIGHT = share_image.WIDE
COLORS = {"gold": "#FFD700", "silver": "#D9DEE5", "bronze": "#E0A06A", "lion": share_image.CYAN}


async def share_payload(db, award_id: str) -> dict | None:
    from services.awards import _visible

    doc = await db.tournament_awards.find_one({"id": award_id, "reward_key": {"$type": "string"}}, {"_id": 0})
    if not doc or doc.get("suspended") or not doc.get("reward"):
        return None
    season_id = (doc.get("league") or {}).get("season_id")
    if doc.get("overall"):
        # Gesamtwertung (F.5): kein Turnier dahinter - sichtbar nach den Seasons des Zeitraums.
        live = {}
        ids = list(doc["overall"].get("season_ids") or [])
        seasons = {row["id"]: row for row in await db.league_seasons.find({"id": {"$in": ids}}, {"_id": 0}).to_list(len(ids) + 1)}
    else:
        live = await db.tournaments.find_one({"id": doc["tournament_id"]}, {"_id": 0, "status": 1, "visibility": 1, "is_public": 1})
        season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0}) if season_id else None
        seasons = {season_id: season} if season else {}
    if live is None or not await _visible(doc, live, seasons):
        return None
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "club_name": 1}) or {}
    reward = doc["reward"]
    art = reward.get("art") or {}
    league = doc.get("league") or {}
    return {
        "award_id": award_id, "kind": reward.get("kind"), "name": reward.get("name"), "description": reward.get("description") or "",
        "place": art.get("place") or reward.get("place_label"), "metal": art.get("metal") or "lion",
        "league": art.get("league"), "season": art.get("season"), "division": art.get("division") or league.get("division_label"),
        "holder": (doc.get("team") or {}).get("name") or league.get("display_name") or "",
        # Fassung des Endstands: Nach einem neuen Abschluss ist es ein neues Bild, auch wenn sonst alles gleich aussieht.
        "version": league.get("version"), "final_table_id": league.get("final_table_id"),
        "club_name": branding.get("club_name") or "THE LION SQUAD",
    }


def _mark(draw, kind: str, cx: int, cy: int, color: tuple) -> None:
    """Das Zeichen der Art - dieselben Formen wie die Web-Vorlage (``RewardArt``), vereinfacht."""
    dark = share_image.blend(color, 70)
    if kind == "banner":
        draw.polygon([(cx - 92, cy - 150), (cx + 92, cy - 150), (cx + 92, cy + 120), (cx, cy + 70), (cx - 92, cy + 120)],
                     fill=dark, outline=color)
        draw.rectangle((cx - 110, cy - 162, cx + 110, cy - 146), fill=color)
    elif kind == "emblem":
        draw.polygon([(cx, cy - 150), (cx + 120, cy - 100), (cx + 105, cy + 60), (cx, cy + 150), (cx - 105, cy + 60), (cx - 120, cy - 100)],
                     fill=dark, outline=color)
    elif kind == "title":
        draw.rounded_rectangle((cx - 150, cy - 60, cx + 150, cy + 60), radius=14, fill=dark, outline=color, width=4)
    else:
        draw.polygon([(cx - 60, cy - 170), (cx - 20, cy - 170), (cx + 10, cy - 70), (cx - 30, cy - 70)], fill=share_image.blend(color, 120))
        draw.polygon([(cx + 60, cy - 170), (cx + 20, cy - 170), (cx - 10, cy - 70), (cx + 30, cy - 70)], fill=share_image.blend(color, 90))
        draw.ellipse((cx - 110, cy - 80, cx + 110, cy + 140), fill=dark, outline=color, width=6)
        draw.ellipse((cx - 88, cy - 58, cx + 88, cy + 118), outline=share_image.blend(color, 120), width=2)


def render_card(payload: dict) -> bytes:
    color = share_image.hex_color(COLORS.get(payload.get("metal") or "lion", share_image.CYAN))
    image = share_image.canvas((WIDTH, HEIGHT), color)
    draw = ImageDraw.Draw(image)
    share_image.frame(draw, (WIDTH, HEIGHT), color)
    kind = payload.get("kind") or "medal"
    cx, cy = 250, 320 if kind != "medal" else 300
    _mark(draw, kind, cx, cy, color)
    place = str(payload.get("place") or "")
    place_font = share_image.fit(draw, place, 40, 200 if kind != "title" else 270, min_size=22)
    box = draw.textbbox((0, 0), place, font=place_font)
    text_y = cy - (box[3] - box[1]) / 2 - box[1] + (30 if kind == "medal" else 0)
    draw.text((cx - (box[2] - box[0]) / 2 - box[0], text_y), place, font=place_font, fill=color)

    left, right = 470, WIDTH - 70
    max_width = right - left
    kicker = "BELOHNUNG · " + str(payload.get("league") or "LIGA").upper()
    draw.text((left, 96), share_image.ellipsis(draw, kicker, share_image.font(24), max_width), font=share_image.font(24), fill=color)
    sub = " · ".join(part for part in (payload.get("season"), payload.get("division")) if part)
    draw.text((left, 140), share_image.ellipsis(draw, sub, share_image.font(30, bold=False), max_width), font=share_image.font(30, bold=False),
              fill=(255, 255, 255, 170))
    name = str(payload.get("name") or "Belohnung")
    name_font = share_image.fit(draw, name, 84, max_width, min_size=44)
    draw.text((left, 186), share_image.ellipsis(draw, name, name_font, max_width), font=name_font, fill=(255, 255, 255, 255))
    y = 186 + draw.textbbox((0, 0), name, font=name_font)[3] + 30
    description = str(payload.get("description") or "")
    if description:
        body_font = share_image.font(28, bold=False)
        for line in share_image.wrap(draw, description, body_font, max_width, max_lines=2):
            draw.text((left, y), line, font=body_font, fill=(255, 255, 255, 150))
            y += 40
        y += 12
    holder = str(payload.get("holder") or "")
    if holder:
        draw.text((left, y + 12), share_image.ellipsis(draw, holder, share_image.font(36), max_width), font=share_image.font(36),
                  fill=(255, 255, 255, 235))
    draw.text((70, HEIGHT - 92), str(payload.get("club_name") or "THE LION SQUAD").upper(), font=share_image.font(24), fill=(255, 255, 255, 160))
    return share_image.png(image)
