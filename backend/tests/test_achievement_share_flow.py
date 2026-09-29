"""Erfolge II (#619): die Teilen-Karte - PNG 1200×630 je öffentlicher Vergabe, die Daten für die Seite und
die Open-Graph-Vorschau; nichts davon für private Profile, verborgene Erfolge, Negatives oder Verein."""
import io
import pathlib
import sys

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
import badges  # noqa: E402
from services import achievement_share as share  # noqa: E402
from services import achievement_visibility as visibility  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        visibility.reset_rarity_cache()
        yield instance
    finally:
        visibility.reset_rarity_cache()
        await shutdown()


async def _award_id(flow, user_id: str, code: str) -> str:
    assert await badges.award_achievement(user_id, code)
    doc = await flow.db.user_achievements.find_one({"user_id": user_id, "tier_code": code}, {"_id": 0, "id": 1})
    return doc["id"]


async def _club_tier(flow) -> dict:
    group = await flow.db.achievement_groups.find_one({"category": "club", "is_negative": {"$ne": True}, "public": True, "manual_only": {"$ne": True}}, {"_id": 0}, sort=[("sort_order", 1)])
    return await flow.db.achievements.find_one({"group_code": group["code"]}, {"_id": 0}, sort=[("rank", 1)])


def test_karte_ist_ein_png_in_1200_mal_630():
    payload = {"award_id": "x", "name": "Spielmacher VII", "description": "2500 Matches gespielt.", "group_name": "Spielmacher", "material": "diamond",
               "material_name": "Diamant", "material_color": "#B9F2FF", "rank": 7, "points": 160, "earned_at": "2026-09-26T18:00:00+00:00",
               "holders": 3, "percent": 4.2, "user": {"display_name": "Anna Beispiel"}, "club_name": "THE LION SQUAD"}
    png = share.render_card(payload)
    image = Image.open(io.BytesIO(png))
    assert image.format == "PNG" and image.size == (1200, 630)
    # Ohne Datum, ohne Beschreibung, mit sehr langem Namen und unbekannter Farbe bleibt die Karte heil.
    long_name = "Ein außerordentlich langer Erfolgsname, der niemals in eine Zeile passen wird, egal wie klein die Schrift"
    png = share.render_card({**payload, "name": long_name, "description": "", "earned_at": None, "material_color": "kaputt", "holders": 0, "rank": 9})
    assert Image.open(io.BytesIO(png)).size == (1200, 630)
    assert share._hex("kaputt") == (255, 215, 0, 255)
    assert share._blend((255, 255, 255, 255), 255) == (255, 255, 255, 255) and share._blend((255, 255, 255, 255), 0) == (10, 10, 10, 255)
    # Die Fläche im Emblem ist dunkel (vorgemischt), das Rangzeichen darauf hell - sonst wäre es unsichtbar.
    def bright_in_emblem(png: bytes) -> int:
        image = Image.open(io.BytesIO(png)).convert("RGB")
        assert max(image.getpixel((250, 300 - 120))) < 90, "Emblemfläche bleibt dunkel"
        return sum(1 for x in range(170, 331, 2) for y in range(230, 371, 2) if max(image.getpixel((x, y))) > 150)

    assert bright_in_emblem(share.render_card(payload)) > 300, "VII ist zu sehen"
    assert bright_in_emblem(share.render_card({**payload, "rank": 8, "material": "legendary", "material_color": "#FF3B30"})) > 300, "der Stern für Legendär ist gezeichnet, kein Schrift-Kästchen"
    assert bright_in_emblem(share.render_card({**payload, "rank": 9, "material": "hidden", "material_color": "#A855F7"})) > 100, "das ? für Geheim"
    assert [len(line) > 0 for line in share._wrap(share.ImageDraw.Draw(image), "ein zwei drei vier fünf sechs sieben acht neun zehn elf zwölf dreizehn vierzehn fünfzehn sechzehn siebzehn achtzehn neunzehn zwanzig einundzwanzig", share._font(28, False), 300, 2)] == [True, True]


@pytest.mark.asyncio
async def test_teilen_nur_was_das_profil_oeffentlich_zeigt(flow):
    anna = await flow.add_user(name="anna")
    await flow.db.users.update_one({"id": anna["id"]}, {"$set": {"privacy_public_profile": True}})
    await flow.db.memberships.insert_one({"user_id": anna["id"], "member_status": "active"})
    ok_id = await _award_id(flow, anna["id"], "matches_played_1")
    neg_id = await _award_id(flow, anna["id"], "neg_dispute")
    club_id = await _award_id(flow, anna["id"], (await _club_tier(flow))["code"])
    visibility.reset_rarity_cache()

    flow.act_as(None)
    res = await flow.get(f"/api/achievements/award/{ok_id}")
    assert res.status_code == 200, res.text
    card = res.json()
    assert card["name"] and card["material"] == "wood" and card["user"]["display_name"] == "anna" and "email" not in card["user"]
    assert card["path"] == f"/achievements/a/{ok_id}" and card["image_path"] == f"/api/achievements/share/{ok_id}.png"
    assert card["holders"] == 1 and card["percent"] == 100.0 and card["club_name"]

    res = await flow.get(f"/api/achievements/share/{ok_id}.png")
    assert res.status_code == 200 and res.headers["content-type"] == "image/png"
    assert res.headers["content-disposition"].startswith("inline")
    assert Image.open(io.BytesIO(res.content)).size == (1200, 630)

    assert (await flow.get(f"/api/achievements/award/{neg_id}")).status_code == 404, "Negatives nie"
    assert (await flow.get(f"/api/achievements/share/{neg_id}.png")).status_code == 404
    assert (await flow.get(f"/api/achievements/award/{club_id}")).status_code == 404, "Verein sehen Fremde nicht, also auch keine Karte"
    assert (await flow.get("/api/achievements/award/gibt-es-nicht")).status_code == 404

    # Erfolge privat → keine Karte; Profil privat → keine Karte.
    await flow.db.users.update_one({"id": anna["id"]}, {"$set": {"privacy_achievements_public": False}})
    assert (await flow.get(f"/api/achievements/award/{ok_id}")).status_code == 404
    await flow.db.users.update_one({"id": anna["id"]}, {"$set": {"privacy_achievements_public": True, "privacy_public_profile": False}})
    assert (await flow.get(f"/api/achievements/share/{ok_id}.png")).status_code == 404


@pytest.mark.asyncio
async def test_open_graph_vorschau_zeigt_die_karte(flow):
    anna = await flow.add_user(name="anna")
    await flow.db.users.update_one({"id": anna["id"]}, {"$set": {"privacy_public_profile": True, "display_name": "Anna B."}})
    ok_id = await _award_id(flow, anna["id"], "matches_played_1")
    flow.act_as(None)
    res = await flow.get(f"/api/seo/meta?path=/achievements/a/{ok_id}")
    assert res.status_code == 200, res.text
    meta = res.json()
    assert meta["image"].endswith(f"/api/achievements/share/{ok_id}.png")
    assert "Anna B." in meta["title"] and "Holz" in meta["title"]
    assert meta["canonical"].endswith(f"/achievements/a/{ok_id}") and meta["robots"] == "noindex, follow"
    assert "Anna B. hat" in meta["description"]
    html = (await flow.get(f"/api/seo/preview?path=/achievements/a/{ok_id}")).text
    assert f'/api/achievements/share/{ok_id}.png' in html and 'property="og:image"' in html
    assert (await flow.get("/api/seo/meta?path=/achievements/a/unbekannt")).status_code == 404
