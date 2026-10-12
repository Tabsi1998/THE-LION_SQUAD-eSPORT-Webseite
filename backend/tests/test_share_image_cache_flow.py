"""Teilen-Bilder schonen den Server (#1412): die öffentlichen Bilder (Ergebnis hoch und breit, Erfolgs-Karte) dürfen
fünf Minuten zwischengespeichert werden und werden bei gleichen Daten nur einmal gezeichnet; ändert sich das Ergebnis,
wird neu gezeichnet. Private Bilder (Jahresrückblick) und alles andere unter /api bleiben „no-store“."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
import badges  # noqa: E402
from services import achievement_share, result_share  # noqa: E402
from services import achievement_visibility as visibility  # noqa: E402
from services.share_image_cache import ImageCache, is_public_share_image, share_images  # noqa: E402

PUBLIC = "public, max-age=300"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    share_images.clear()
    try:
        yield instance
    finally:
        share_images.clear()
        await shutdown()


def count_draws(monkeypatch, module, name: str) -> list:
    """Zählt, wie oft ein Bild wirklich gezeichnet wird (je Aufruf das Format, falls es eins gibt)."""
    calls = []
    original = getattr(module, name)

    def drawing(*args, **kwargs):
        calls.append(args[1] if len(args) > 1 else name)
        return original(*args, **kwargs)

    monkeypatch.setattr(module, name, drawing)
    return calls


async def shared_result(flow) -> dict:
    """Ein öffentliches Profil mit Platz 2 in einem beendeten, öffentlichen Turnier."""
    me = await flow.add_user(role="player", name="neonfalke")
    await flow.db.users.update_one({"id": me["id"]}, {"$set": {"privacy_public_profile": True}})
    cup = await flow.create_tournament(title="FC 26 Herbst-Cup", status="results_published", start_date="2026-09-20T16:00:00+00:00")
    mine = await flow.register(cup, me)
    await flow.db.tournament_registrations.update_one({"id": mine["id"]}, {"$set": {"final_position": 2}})
    await flow.register(cup, await flow.add_user(role="player", name="lunabyte"))
    flow.act_as(None)
    return {"me": me, "registration": mine, "story": f"/api/share/result/{cup['slug']}/neonfalke/story.png",
            "wide": f"/api/share/result/{cup['slug']}/neonfalke/wide.png", "page": f"/api/share/result/{cup['slug']}/neonfalke",
            "missing": f"/api/share/result/{cup['slug']}/gibt-es-nicht/story.png"}


def test_exactly_the_public_share_images_may_be_cached():
    allowed = ["/api/share/result/fc-26-cup/neonfalke/story.png", "/api/share/result/t-1/neonfalke/wide.png",
               "/api/achievements/share/a1b2c3.png"]
    refused = ["/api/share/result/fc-26-cup/neonfalke", "/api/share/result-options/fc-26-cup",
               "/api/share/result/fc-26-cup/neonfalke/quadrat.png", "/api/share/result/a/b/c/story.png",
               "/api/share/result/fc-26-cup/neonfalke/story.png/x", "/api/achievements/share/a/b.png",
               "/api/year-review/me/card.png", "/x/api/achievements/share/a1.png", ""]
    assert [path for path in allowed if not is_public_share_image(path)] == []
    assert [path for path in refused if is_public_share_image(path)] == []


@pytest.mark.asyncio
async def test_result_images_are_cacheable_drawn_once_and_redrawn_after_a_change(flow, monkeypatch):
    draws = count_draws(monkeypatch, result_share, "render")
    shared = await shared_result(flow)

    first = await flow.get(shared["story"])
    second = await flow.get(shared["story"])
    assert first.status_code == 200 and second.status_code == 200
    assert first.headers["cache-control"] == PUBLIC and "pragma" not in first.headers and "expires" not in first.headers
    assert second.content == first.content and draws == ["story"], "gleiche Daten: einmal gezeichnet"

    wide = await flow.get(shared["wide"])
    assert wide.status_code == 200 and wide.headers["cache-control"] == PUBLIC
    assert draws == ["story", "wide"], "jedes Format ist ein eigenes Bild"

    # Das Ergebnis ändert sich: sofort neu gezeichnet.
    await flow.db.tournament_registrations.update_one({"id": shared["registration"]["id"]}, {"$set": {"final_position": 1}})
    changed = await flow.get(shared["story"])
    assert changed.status_code == 200 and changed.content != first.content
    assert draws == ["story", "wide", "story"]

    # Die Daten der Teilen-Seite bleiben no-store, ebenso jede Absage.
    page = await flow.get(shared["page"])
    missing = await flow.get(shared["missing"])
    assert page.status_code == 200 and page.headers["cache-control"] == "no-store"
    assert missing.status_code == 404 and missing.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
async def test_a_profile_turned_private_gets_no_image_from_the_cache(flow, monkeypatch):
    draws = count_draws(monkeypatch, result_share, "render")
    shared = await shared_result(flow)
    shown = await flow.get(shared["story"])
    assert shown.status_code == 200 and draws == ["story"]
    await flow.db.users.update_one({"id": shared["me"]["id"]}, {"$set": {"privacy_public_profile": False}})
    hidden = await flow.get(shared["story"])
    assert hidden.status_code == 404 and hidden.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
async def test_the_achievement_card_is_cacheable_and_drawn_once(flow, monkeypatch):
    await badges.seed_badges()
    visibility.reset_rarity_cache()
    draws = count_draws(monkeypatch, achievement_share, "render_card")
    anna = await flow.add_user(role="player", name="anna")
    await flow.db.users.update_one({"id": anna["id"]}, {"$set": {"privacy_public_profile": True}})
    awarded = await badges.award_achievement(anna["id"], "matches_played_1")
    assert awarded
    award = await flow.db.user_achievements.find_one({"user_id": anna["id"], "tier_code": "matches_played_1"}, {"_id": 0, "id": 1})
    visibility.reset_rarity_cache()
    flow.act_as(None)

    first = await flow.get(f"/api/achievements/share/{award['id']}.png")
    second = await flow.get(f"/api/achievements/share/{award['id']}.png")
    assert first.status_code == 200 and first.headers["cache-control"] == PUBLIC
    assert second.content == first.content and draws == ["render_card"], "gleiche Daten: einmal gezeichnet"
    missing = await flow.get("/api/achievements/share/gibt-es-nicht.png")
    assert missing.status_code == 404 and missing.headers["cache-control"] == "no-store"
    visibility.reset_rarity_cache()


@pytest.mark.asyncio
async def test_the_private_year_review_image_is_never_cached(flow, monkeypatch):
    from routes import year_review_routes

    async def year_for(_db, _me, _preview):
        return 2026

    async def build_review(_db, _me, year):
        return {"year": year}

    monkeypatch.setattr(year_review_routes, "_year_for", year_for)
    monkeypatch.setattr(year_review_routes.year_review, "build_review", build_review)
    monkeypatch.setattr(year_review_routes.year_review, "render", lambda _review: b"\x89PNG-jahr")
    me = await flow.add_user(role="player", name="jahr")
    flow.act_as(me)
    card = await flow.get("/api/year-review/me/card.png")
    assert card.status_code == 200 and card.headers["cache-control"] == "no-store" and card.headers["pragma"] == "no-cache"


def test_the_cache_forgets_after_five_minutes_and_stays_small():
    now = [1000.0]
    cache = ImageCache(max_entries=2, max_bytes=10, max_age=300, clock=lambda: now[0])
    drawn = []

    def draw(label: str):
        def make() -> bytes:
            drawn.append(label)
            return label.encode()
        return make

    cache.get_or_draw(("a",), {"rang": 1}, draw("aaa"))
    cache.get_or_draw(("a",), {"rang": 1}, draw("aaa"))
    now[0] += 299
    cache.get_or_draw(("a",), {"rang": 1}, draw("aaa"))
    assert drawn == ["aaa"], "innerhalb von fünf Minuten nur einmal"
    now[0] += 2
    cache.get_or_draw(("a",), {"rang": 1}, draw("aaa"))
    assert drawn == ["aaa", "aaa"], "nach fünf Minuten neu"
    cache.get_or_draw(("a",), {"rang": 2}, draw("aaa"))
    assert drawn == ["aaa", "aaa", "aaa"], "andere Daten: neu"

    # Höchstens zwei Bilder: das am längsten nicht abgerufene fällt heraus.
    cache.get_or_draw(("b",), {}, draw("bbb"))
    cache.get_or_draw(("a",), {"rang": 2}, draw("aaa"))   # a frisch abgerufen
    cache.get_or_draw(("c",), {}, draw("ccc"))            # b fällt heraus
    cache.get_or_draw(("a",), {"rang": 2}, draw("aaa"))
    cache.get_or_draw(("b",), {}, draw("bbb"))
    assert len(cache) == 2 and drawn == ["aaa", "aaa", "aaa", "bbb", "ccc", "bbb"]

    # Höchstens 10 Bytes: ein großes Bild verdrängt die anderen, ein zu großes wird gar nicht gemerkt.
    cache.get_or_draw(("d",), {}, draw("dddddddd"))
    assert len(cache) == 1
    cache.get_or_draw(("e",), {}, draw("eeeeeeeeeeee"))
    cache.get_or_draw(("e",), {}, draw("eeeeeeeeeeee"))
    assert drawn[-2:] == ["eeeeeeeeeeee", "eeeeeeeeeeee"] and len(cache) == 1
