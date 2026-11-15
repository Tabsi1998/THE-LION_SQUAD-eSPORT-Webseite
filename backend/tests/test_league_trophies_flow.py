"""Belohnungen II (#2425, Nr. 34c, 59, 60) über die echten Routen: bis zu drei Embleme neben dem Namen (nur eigene, keine ruhenden,
höchstens drei, Teamleitung fürs Team), Sichtbarkeit für Gäste, Kontolöschung und das Rankingbanner (öffentlich und nicht öffentlich,
Zwischenspeicher, keine Personendaten) - jede Regel mit Gegenprobe. Nur erfundene Namen.
"""
import io
import pathlib
import sys

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from test_league_rewards_flow import GOLD, PODIUM, lead, must_close, must_reopen, play_all, rewards_of  # noqa: E402
from test_league_rewards_flow import setup as league_setup  # noqa: E402

PAGE = "/api/leagues/probe-shooter/season-1"
BANNER = {"kind": "banner", "name": "Season-Banner", "places": {"mode": "all"}, "recipients": ["players"]}
EMBLEMS = [{"kind": "emblem", "name": f"Emblem {index}", "places": {"mode": "all"}, "recipients": ["players", "team"]} for index in (1, 2, 3)]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def closed_season(flow, rewards):
    admin, league, season, division, staffel = await league_setup(flow, rewards=rewards)
    await play_all(flow, staffel)
    await must_close(flow, staffel)
    return admin, league, season, division, staffel


def ids_of(docs, *names, registration="reg-1"):
    by_name = {doc["reward"]["name"]: doc["id"] for doc in docs if doc["registration_id"] == registration}
    return [by_name[name] for name in names]


# ---------------------------------------------------------------- Embleme neben dem Namen

@pytest.mark.asyncio
async def test_a_player_picks_up_to_three_own_emblems_in_order_and_guests_see_them(flow):
    _admin, _league, _season, _division, staffel = await closed_season(flow, [GOLD, BANNER, *EMBLEMS])
    docs = await rewards_of(flow, staffel)
    gold, banner, first, second, third = ids_of(docs, "Goldmedaille", "Season-Banner", "Emblem 1", "Emblem 2", "Emblem 3")
    flow.act_as({"id": "p-1-1", "role": "user"})

    too_many = await flow.put("/api/me/awards/emblems", json={"award_ids": [gold, first, second, third]})
    assert too_many.status_code == 400 and "Höchstens 3" in too_many.json()["detail"]
    not_an_emblem = await flow.put("/api/me/awards/emblems", json={"award_ids": [banner]})
    assert not_an_emblem.status_code == 404
    # Nur eigene: das Emblem von Team 2 gehört p-1-1 nicht.
    foreign = ids_of(docs, "Emblem 1", registration="reg-2")
    assert (await flow.put("/api/me/awards/emblems", json={"award_ids": foreign})).status_code == 404
    stored = await flow.db.users.find_one({"id": "p-1-1"}, {"_id": 0, "featured_emblem_award_ids": 1})
    assert "featured_emblem_award_ids" not in stored

    chosen = await flow.put("/api/me/awards/emblems", json={"award_ids": [second, gold, second]})
    assert chosen.status_code == 200, chosen.text
    assert [row["id"] for row in chosen.json()["featured_emblems"]] == [second, gold]
    assert (await flow.get("/api/me/awards")).json()["featured_emblem_award_ids"] == [second, gold]

    flow.act_as(None)
    profile = (await flow.get("/api/users/public/p-1-1")).json()
    assert [row["reward"]["name"] for row in profile["featured_emblems"]] == ["Emblem 2", "Goldmedaille"]
    # Gegenprobe: Ist die Season nicht mehr öffentlich, sehen Gäste kein Emblem - die Wahl bleibt gespeichert.
    await flow.db.league_seasons.update_one({"id": staffel["league_context"]["season_id"]}, {"$set": {"visibility": "members"}})
    assert (await flow.get("/api/users/public/p-1-1")).json()["featured_emblems"] == []
    await flow.db.league_seasons.update_one({"id": staffel["league_context"]["season_id"]}, {"$set": {"visibility": "public"}})

    flow.act_as({"id": "p-1-1", "role": "user"})
    cleared = await flow.put("/api/me/awards/emblems", json={"award_ids": []})
    assert cleared.json() == {"ok": True, "featured_emblems": []}
    assert "featured_emblem_award_ids" not in await flow.db.users.find_one({"id": "p-1-1"}, {"_id": 0})


@pytest.mark.asyncio
async def test_resting_emblems_are_neither_chosen_nor_shown(flow):
    _admin, league, _season, _division, staffel = await closed_season(flow, [GOLD, *EMBLEMS])
    gold, first = ids_of(await rewards_of(flow, staffel), "Goldmedaille", "Emblem 1")
    flow.act_as({"id": "p-1-1", "role": "user"})
    assert (await flow.put("/api/me/awards/emblems", json={"award_ids": [gold, first]})).status_code == 200

    flow.act_as(await lead(flow, league, "Zweite Leitung", "season"))
    await must_reopen(flow, staffel)
    flow.act_as(None)
    assert (await flow.get("/api/users/public/p-1-1")).json()["featured_emblems"] == []
    flow.act_as({"id": "p-1-1", "role": "user"})
    assert (await flow.get("/api/me/awards")).json()["featured_emblem_award_ids"] == []
    resting = await flow.put("/api/me/awards/emblems", json={"award_ids": [gold]})
    assert resting.status_code == 404


@pytest.mark.asyncio
async def test_only_the_team_lead_picks_the_team_emblems(flow):
    _admin, _league, _season, _division, staffel = await closed_season(flow, [GOLD, PODIUM, *EMBLEMS])
    docs = [doc for doc in await rewards_of(flow, staffel) if doc.get("team_id") == "team-2"]
    podium = next(doc["id"] for doc in docs if doc["reward"]["name"] == "Podest-Emblem")
    first = next(doc["id"] for doc in docs if doc["reward"]["name"] == "Emblem 1")

    flow.act_as({"id": "p-2-1", "role": "user"})
    refused = await flow.put("/api/teams/team-2/awards/emblems", json={"award_ids": [podium]})
    assert refused.status_code == 403
    flow.act_as({"id": "captain-1", "role": "user"})
    assert (await flow.put("/api/teams/team-2/awards/emblems", json={"award_ids": [podium]})).status_code == 403
    # Ein Emblem eines anderen Teams geht auch für die eigene Teamleitung nicht.
    assert (await flow.put("/api/teams/team-1/awards/emblems", json={"award_ids": [podium]})).status_code == 404

    flow.act_as({"id": "captain-2", "role": "user"})
    saved = await flow.put("/api/teams/team-2/awards/emblems", json={"award_ids": [first, podium]})
    assert saved.status_code == 200, saved.text
    flow.act_as(None)
    team = (await flow.get("/api/teams/team-2")).json()
    assert [row["reward"]["name"] for row in team["featured_emblems"]] == ["Emblem 1", "Podest-Emblem"]
    assert "featured_emblem_award_ids" not in team


@pytest.mark.asyncio
async def test_the_emblem_choice_disappears_with_the_account(flow):
    from routes import dsgvo_routes

    _admin, _league, _season, _division, staffel = await closed_season(flow, [GOLD])
    (gold,) = ids_of(await rewards_of(flow, staffel), "Goldmedaille")
    flow.act_as({"id": "p-1-1", "role": "user"})
    assert (await flow.put("/api/me/awards/emblems", json={"award_ids": [gold]})).status_code == 200
    await dsgvo_routes._anonymize_user_data(flow.db, "p-1-1", "p-1-1", "user.self_anonymize")
    stored = await flow.db.users.find_one({"id": "p-1-1"}, {"_id": 0})
    assert not stored.get("featured_emblem_award_ids")


# ---------------------------------------------------------------- Rankingbanner

@pytest.mark.asyncio
async def test_the_rank_banner_is_public_cached_and_without_people(flow, monkeypatch):
    from services import league_rank_banner
    from services.share_image_cache import is_public_share_image, share_images

    await league_setup(flow, rewards=[GOLD])
    url = f"{PAGE}/teams/squad-2/banner.png"
    share_images.clear()
    drawn = []
    original = league_rank_banner.render
    monkeypatch.setattr(league_rank_banner, "render", lambda data: drawn.append(data) or original(data))
    flow.act_as(None)
    first = await flow.get(url)
    second = await flow.get(url)
    assert first.status_code == second.status_code == 200, first.text
    assert first.headers["content-type"] == "image/png" and first.headers.get("cache-control") == "public, max-age=300"
    assert first.content == second.content and len(drawn) == 1
    assert Image.open(io.BytesIO(first.content)).size == (1200, 300)
    assert is_public_share_image(url) and not is_public_share_image(f"{PAGE}/teams/squad-2/banner.png/mehr")
    data = drawn[0]
    assert (data["team"], data["division"], data["staffel"], data["rank"], data["record"]["played"]) == ("Probe 2", "Liga 1", "A", None, 0)
    # Keine Personen: weder Kennungen noch Namen aus dem Kader.
    text = repr(data)
    assert not any(person in text for person in ("p-2-1", "captain-2", "P-2-1", "Captain-2", "example.test"))

    # Nach den Spielen: Platz und Bilanz - und weil sich die Daten ändern, sofort ein neues Bild.
    await play_all(flow, (await flow.db.tournaments.find_one({"league_context.staffel": "A"}, {"_id": 0})))
    third = await flow.get(url)
    assert third.status_code == 200 and len(drawn) == 2
    assert (drawn[1]["rank"], drawn[1]["record"]["won"], drawn[1]["record"]["lost"], drawn[1]["record"]["points"]) == (2, 2, 1, 6)
    # Das Hauptteam im Link findet sein Co-Team.
    assert (await flow.get(f"{PAGE}/teams/team-2/banner.png")).status_code == 200

    # Die Teamseite nennt den festen Link.
    team = (await flow.get("/api/teams/team-2")).json()
    assert [row["image_url"] for row in team["rank_banners"]] == ["/api/leagues/probe-shooter/season-1/teams/squad-2/banner.png"]
    assert team["rank_banners"][0]["page_url"] == "/liga/probe-shooter/season-1"


@pytest.mark.asyncio
async def test_a_hidden_season_or_an_unknown_team_has_no_rank_banner(flow):
    _admin, _league, season, _division, staffel = await league_setup(flow, rewards=[GOLD])
    flow.act_as(None)
    assert (await flow.get(f"{PAGE}/teams/squad-1/banner.png")).status_code == 200
    assert (await flow.get(f"{PAGE}/teams/kein-team/banner.png")).status_code == 404
    assert (await flow.get("/api/leagues/probe-shooter/season-9/teams/squad-1/banner.png")).status_code == 404

    for visibility in ("members", "admins", "off"):
        await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"visibility": visibility}})
        hidden = await flow.get(f"{PAGE}/teams/squad-1/banner.png")
        assert hidden.status_code == 404, visibility
        assert hidden.headers.get("cache-control") != "public, max-age=300"
        assert (await flow.get("/api/teams/team-1")).json()["rank_banners"] == []
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"visibility": "public"}})
    # Eine Staffel im Entwurf sehen Gäste nicht - dann auch kein Bild.
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"status": "draft"}})
    assert (await flow.get(f"{PAGE}/teams/squad-1/banner.png")).status_code == 404
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"status": "live"}})
    # Eine abgemeldete Anmeldung hat kein Bild mehr.
    await flow.db.tournament_registrations.update_one({"id": "reg-1"}, {"$set": {"status": "withdrawn"}})
    assert (await flow.get(f"{PAGE}/teams/squad-1/banner.png")).status_code == 404
