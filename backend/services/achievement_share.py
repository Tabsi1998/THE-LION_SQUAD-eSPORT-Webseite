"""Erfolge II (#619): die Teilen-Karte - ein 1200×630-PNG je Vergabe, serverseitig mit Pillow gezeichnet,
ohne Browser. Dazu die Daten für die Seite /achievements/a/<award_id> und die Open-Graph-Vorschau.

Geteilt wird nur, was das Profil auch öffentlich zeigt: das Profil ist öffentlich, die Erfolge sind
öffentlich, die Gruppe ist weder negativ noch nur für Mitglieder (die Verein-Kategorie sehen fremde
Besucher nicht, also gehört sie auch auf keine Karte).
"""
from __future__ import annotations

import logging

from PIL import Image, ImageDraw, ImageFilter

from achievement_catalog import MATERIALS, category_v2
from services import share_image
from services.achievement_visibility import _group_is_member_only, achievements_public, rarity

logger = logging.getLogger("tls.achievements.share")

WIDTH, HEIGHT = share_image.WIDE
BACKGROUND = share_image.BACKGROUND
ROMAN = {1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI", 7: "VII", 9: "?"}  # Rang 8 (Legendär) = gezeichneter Stern


# ------------------------------------------------------------------ Daten

def shareable(group: dict | None, user: dict | None) -> bool:
    if not group or not user:
        return False
    if group.get("is_negative") or _group_is_member_only(group):
        return False
    if not user.get("privacy_public_profile") or user.get("is_active") is False or user.get("is_banned"):
        return False
    return achievements_public(user)


async def share_payload(db, award_id: str) -> dict | None:
    """Die Karte als Daten - None, wenn es die Vergabe nicht gibt oder sie nicht geteilt werden darf."""
    award = await db.user_achievements.find_one({"id": award_id}, {"_id": 0})
    if not award:
        return None
    tier = await db.achievements.find_one({"code": award.get("tier_code")}, {"_id": 0})
    group = await db.achievement_groups.find_one({"code": tier.get("group_code")}, {"_id": 0}) if tier else None
    user = await db.users.find_one({"id": award.get("user_id")}, {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1,
                                                                   "privacy_public_profile": 1, "privacy_achievements_public": 1, "is_active": 1, "is_banned": 1})
    if not tier or not shareable(group, user):
        return None
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "club_name": 1}) or {}
    rare = (await rarity(db))["tiers"].get(tier["code"], {"holders": 0, "percent": 0.0})
    material = tier.get("material") or "bronze"
    return {
        "award_id": award_id, "tier_code": tier["code"], "name": tier.get("name"), "description": tier.get("description"),
        "group_code": group["code"], "group_name": group.get("name"), "category": category_v2(group.get("category")),
        "hidden": bool(group.get("hidden")), "icon": tier.get("icon") or group.get("icon"), "art": tier.get("art"),
        "material": material, "material_name": tier.get("material_name") or MATERIALS.get(material, {}).get("name"),
        "material_color": tier.get("material_color") or MATERIALS.get(material, {}).get("color", "#FFD700"),
        "rank": int(tier.get("rank") or 0), "level": tier.get("level"), "points": int(tier.get("points") or 0),
        "earned_at": award.get("earned_at"), "holders": rare["holders"], "percent": rare["percent"],
        "user": {"id": user["id"], "username": user.get("username"), "display_name": user.get("display_name") or user.get("username") or "Spieler", "avatar_url": user.get("avatar_url")},
        "club_name": branding.get("club_name") or "THE LION SQUAD",
        "path": f"/achievements/a/{award_id}", "image_path": f"/api/achievements/share/{award_id}.png",
    }


# ------------------------------------------------------------------ Zeichnen
# Die Werkzeuge stehen im gemeinsamen Bild-Baustein (#1194) - Ergebnis-Bild, Jahresrückblick und Vorschaubilder
# zeichnen mit denselben. Die alten Namen bleiben, damit Turnierbaum-Bild und Tests weiter funktionieren.
_font = share_image.font
_hex = share_image.hex_color
_blend = share_image.blend
_wrap = share_image.wrap
_star = share_image.star
_fit = share_image.fit
_ellipsis = share_image.ellipsis
_date_label = share_image.date_label


def render_card(payload: dict) -> bytes:
    """Die Karte: dunkler Grund mit Schein in der Materialfarbe, links das Emblem mit Rangzeichen, rechts
    Gruppe, Name, Material, Person und Datum, unten Verein und Seltenheit."""
    color = _hex(payload.get("material_color"))
    image = Image.new("RGBA", (WIDTH, HEIGHT), BACKGROUND + (255,))

    glow = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((-160, -220, 620, 520), fill=color[:3] + (70,))
    glow_draw.ellipse((760, 300, 1400, 900), fill=color[:3] + (28,))
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    image.alpha_composite(glow)

    draw = ImageDraw.Draw(image)
    # Rahmen mit doppelter Linie in der Materialfarbe
    draw.rounded_rectangle((24, 24, WIDTH - 24, HEIGHT - 24), radius=8, outline=_blend(color, 150), width=3)
    draw.rounded_rectangle((36, 36, WIDTH - 36, HEIGHT - 36), radius=6, outline=_blend(color, 60), width=1)

    # Emblem links: drei Ringe (außen zart, innen satt), dunkle Fläche mit Materialschimmer, Rangzeichen
    cx, cy, radius = 250, 300, 150
    for offset, alpha in ((22, 40), (12, 90), (0, 255)):
        draw.ellipse((cx - radius - offset, cy - radius - offset, cx + radius + offset, cy + radius + offset), outline=_blend(color, alpha), width=4)
    draw.ellipse((cx - radius + 10, cy - radius + 10, cx + radius - 10, cy + radius - 10), fill=_blend(color, 34))
    draw.ellipse((cx - radius + 26, cy - radius + 26, cx + radius - 26, cy + radius - 26), outline=_blend(color, 70), width=1)
    rank = int(payload.get("rank") or 0)
    if rank == 8:
        draw.polygon(_star(cx, cy + 4, 78, 34), fill=color)
        draw.polygon(_star(cx, cy + 4, 46, 20), fill=_blend(color, 60))
    else:
        glyph = ROMAN.get(rank, str(rank or "•"))
        glyph_font = _font(120 if len(glyph) < 3 else 92)
        box = draw.textbbox((0, 0), glyph, font=glyph_font)
        draw.text((cx - (box[2] - box[0]) / 2 - box[0], cy - (box[3] - box[1]) / 2 - box[1] - 6), glyph, font=glyph_font, fill=color)
    material_font = _font(26)
    material = str(payload.get("material_name") or "").upper()
    mbox = draw.textbbox((0, 0), material, font=material_font)
    draw.text((cx - (mbox[2] - mbox[0]) / 2, cy + radius + 26), material, font=material_font, fill=color)

    # Text rechts
    left, right = 470, WIDTH - 70
    max_width = right - left
    kicker_font = _font(24)
    draw.text((left, 96), "ACHIEVEMENT FREIGESCHALTET", font=kicker_font, fill=color)
    group_font = _font(30, bold=False)
    draw.text((left, 140), _ellipsis(draw, str(payload.get("group_name") or ""), group_font, max_width), font=group_font, fill=(255, 255, 255, 170))
    name = str(payload.get("name") or "")
    name_font = _fit(draw, name, 84, max_width, min_size=44)
    draw.text((left, 186), _ellipsis(draw, name, name_font, max_width), font=name_font, fill=(255, 255, 255, 255))
    name_height = draw.textbbox((0, 0), name, font=name_font)[3]
    y = 186 + name_height + 30
    description = str(payload.get("description") or "")
    if description:
        body_font = _font(28, bold=False)
        for line in _wrap(draw, description, body_font, max_width, max_lines=2):
            draw.text((left, y), line, font=body_font, fill=(255, 255, 255, 150))
            y += 40
        y += 12
    user = payload.get("user") or {}
    person_font = _font(36)
    person = _ellipsis(draw, str(user.get("display_name") or "Spieler"), person_font, max_width - 260)
    draw.text((left, y + 12), person, font=person_font, fill=(255, 255, 255, 235))
    date_label = _date_label(payload.get("earned_at"))
    if date_label:
        date_font = _font(26, bold=False)
        draw.text((left + draw.textlength(person, font=person_font) + 24, y + 22), date_label, font=date_font, fill=(255, 255, 255, 120))

    # Fußzeile: Verein links, Punkte und Seltenheit rechts
    foot_font = _font(24)
    draw.text((70, HEIGHT - 92), str(payload.get("club_name") or "THE LION SQUAD").upper(), font=foot_font, fill=(255, 255, 255, 160))
    percent = float(payload.get("percent") or 0.0)
    holders = int(payload.get("holders") or 0)
    rare_text = f"+{int(payload.get('points') or 0)} Punkte · {('%.1f' % percent).replace('.', ',')} % haben das" if holders else f"+{int(payload.get('points') or 0)} Punkte"
    rare_font = _font(24, bold=False)
    draw.text((right - draw.textlength(rare_text, font=rare_font), HEIGHT - 92), rare_text, font=rare_font, fill=_blend(color, 220))

    return share_image.png(image)
