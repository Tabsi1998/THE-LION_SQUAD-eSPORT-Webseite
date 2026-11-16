"""Erfolge, Kronen und Team-Level: die noch gültigen Fälle der alten Live-Tests (#2395), jetzt durch die echten Routen.

Vertrag:
- Die Erfolge-Rangliste nennt nur öffentliche Profile, zählt die Plätze ab 1 lückenlos und liefert nie mehr als 100 und
  nie keine Zeile, egal was ``limit`` sagt; jedes gelistete Profil ist öffentlich erreichbar.
- Die Kronen sind für Gäste lesbar: Onyx ab Level 30, Gold, Silber und Bronze für die besten drei ohne Onyx, sonst keine.
- Eigene Erfolge und „Erfolge prüfen“ verlangen eine Anmeldung; ein zweites „Erfolge prüfen“ vergibt nichts mehr.
- Zwei gleichzeitige Vergaben derselben Stufe enden in genau einer, ohne Fehler.
- Das Team-Level zählt die Erfolgspunkte der Mitglieder und je Turnier und Sieg einen festen Zuschlag; die Team-Erfolge
  folgen diesen Zahlen; Übersicht und Einzelansicht nennen dasselbe.
- Gruppen- und Stufennamen des Katalogs tragen kein Emoji (Bild und Farbe kommen aus Material und Symbol).
Erfundene Personen und Teams.

Ersetzt:
- test_iter3_achievements_bracket.py::TestAchievementsLeaderboard::test_leaderboard_limit_respected
- test_iter3_achievements_bracket.py::TestAchievementsLeaderboard::test_leaderboard_limit_capped_and_sanitised
- test_iter3_achievements_bracket.py::TestAchievementsLeaderboard::test_leaderboard_entries_have_public_profiles
- test_iter3_achievements_bracket.py::TestAchievementsCatalog::test_me_requires_auth
- test_iter3_achievements_bracket.py::TestAchievementsCatalog::test_evaluate_converges_to_zero
- test_iter3_achievements_bracket.py::TestAchievementsCatalog::test_evaluate_requires_auth
- test_iter4_achievement_taxonomy_nav.py::TestAchievementTaxonomy::test_no_emoji_in_group_or_tier_names
- test_iter4_achievement_taxonomy_nav.py::TestAchievementTaxonomy::test_me_requires_auth
- test_iter5_taxonomy_premium.py::TestTaxonomy::test_no_emoji_in_group_metadata
- test_iter5_taxonomy_premium.py::TestAnonymousAccess::test_me_requires_auth
- test_iter13_crowns.py::TestCrowns (alle fünf Fälle)
- test_iter13_crowns.py::TestRegression::test_leaderboard_limit
- test_iter13_crowns.py::TestRegression::test_public_profile_top_players
- test_iter14_team_levels_crowns.py::TestTeamLevels::test_levels_all_teams
- test_iter14_team_levels_crowns.py::TestTeamLevels::test_level_detail_matches_summary
- test_iter14_team_levels_crowns.py::TestCrownsRegression::test_crowns_shape
- test_iter14_team_levels_crowns.py::TestConcurrentEvaluate::test_parallel_evaluate_and_profile_completeness
"""
import asyncio
import pathlib
import re
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import InterleavedReads, make_flow, new_id  # noqa: E402

import achievement_catalog as catalog  # noqa: E402
import badges  # noqa: E402
from services import crown_events, team_levels  # noqa: E402

EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿⭐]")


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    # Kronen und Team-Level merken sich ihr Ergebnis eine Weile - jeder Test rechnet frisch.
    monkeypatch.setitem(crown_events._cache, "at", None)
    team_levels.forget_cached_levels()
    try:
        yield instance
    finally:
        team_levels.forget_cached_levels()
        await shutdown()


async def probe_tiers(flow, **points: int) -> None:
    """Eine eigene Gruppe mit Stufen fester Punktzahl - unabhängig davon, was der Katalog gerade vergibt."""
    await flow.db.achievement_groups.insert_one({"code": "probe", "id": "probe", "name": "Probe", "category": "match",
                                                 "public": True, "is_negative": False, "sort_order": 1})
    await flow.db.achievements.insert_many([
        {"code": code, "id": code, "group_code": "probe", "name": code, "level": 1, "points": value}
        for code, value in points.items()])


async def person(flow, name: str, *tiers: str, public: bool = True) -> dict:
    user = {"id": new_id(), "username": name, "display_name": name, "email": f"{name}@example.test", "role": "player",
            "is_active": True, "privacy_public_profile": public}
    await flow.db.users.insert_one(dict(user))
    if tiers:
        await flow.db.user_achievements.insert_many([
            {"id": new_id(), "user_id": user["id"], "tier_code": code, "group_code": "probe",
             "earned_at": "2026-10-01T10:00:00+00:00"} for code in tiers])
    return user


# ---------------------------------------------------------------- Rangliste

@pytest.mark.asyncio
async def test_the_leaderboard_lists_public_profiles_ranked_and_never_more_than_100(flow):
    await probe_tiers(flow, probe_a=50, probe_b=30, probe_c=10)
    await person(flow, "anna", "probe_a", "probe_b", "probe_c")
    await person(flow, "ben", "probe_a", "probe_b")
    await person(flow, "cara", "probe_a")
    await person(flow, "geheim", "probe_a", "probe_b", "probe_c", public=False)
    for index in range(100):
        await person(flow, f"rudel{index:03d}", "probe_c")
    flow.act_as(None)

    top = (await flow.get("/api/achievements/leaderboard", params={"limit": 3})).json()
    assert [(row["username"], row["points"], row["rank"]) for row in top] == [("anna", 90, 1), ("ben", 80, 2), ("cara", 50, 3)]
    for row in top:
        assert (await flow.get(f"/api/users/public/{row['username']}")).status_code == 200, row["username"]

    everyone = (await flow.get("/api/achievements/leaderboard", params={"limit": 5000})).json()
    assert len(everyone) == 100, "höchstens 100 Zeilen"
    assert [row["rank"] for row in everyone] == list(range(1, 101))
    assert [row["points"] for row in everyone] == sorted((row["points"] for row in everyone), reverse=True)
    assert "geheim" not in {row["username"] for row in everyone}, "ein privates Profil steht auf keiner Rangliste"
    for limit in (0, -5):
        rows = (await flow.get("/api/achievements/leaderboard", params={"limit": limit})).json()
        assert 1 <= len(rows) <= 100, limit


@pytest.mark.asyncio
async def test_guests_see_onyx_and_the_podium_and_nobody_else_wears_a_crown(flow):
    await probe_tiers(flow, probe_onyx=crown_events.ONYX_FLOOR, probe_a=50, probe_b=30, probe_c=10)
    onyx = await person(flow, "onyx", "probe_onyx")
    gold = await person(flow, "gold", "probe_a", "probe_b")
    silver = await person(flow, "silber", "probe_a")
    bronze = await person(flow, "bronze", "probe_b")
    fourth = await person(flow, "vierte", "probe_c")
    hidden = await person(flow, "versteckt", "probe_onyx", "probe_a", public=False)
    flow.act_as(None)

    response = await flow.get("/api/achievements/crowns")
    assert response.status_code == 200
    crowns = response.json()["crowns"]
    assert crowns == {onyx["id"]: "onyx", gold["id"]: "gold", silver["id"]: "silver", bronze["id"]: "bronze"}
    assert fourth["id"] not in crowns and hidden["id"] not in crowns
    board = (await flow.get("/api/achievements/leaderboard")).json()
    podium = [row["user_id"] for row in board if row["points"] < crown_events.ONYX_FLOOR][:3]
    assert [crowns[uid] for uid in podium] == ["gold", "silver", "bronze"], "die Krone folgt der Rangliste"
    assert (await flow.get("/api/achievements/crowns")).json()["crowns"] == crowns


# ---------------------------------------------------------------- Eigene Erfolge

@pytest.mark.asyncio
async def test_own_achievements_need_a_login_and_a_second_check_awards_nothing(flow):
    await badges.seed_badges()
    flow.act_as(None)
    assert (await flow.get("/api/achievements/me")).status_code == 401
    assert (await flow.post("/api/achievements/evaluate")).status_code == 401

    user = await flow.add_user(name="pruefer")
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {
        "privacy_public_profile": True, "bio": "Spielt gern", "avatar_url": "/api/static/uploads/a.png",
        "discord_name": "pruefer", "favorite_games": ["Rocket League"]}})
    flow.act_as(user)
    first = await flow.post("/api/achievements/evaluate")
    assert first.status_code == 200, first.text
    assert first.json()["newly_awarded"] >= 1, "ein frisches Konto erreicht etwas (z. B. Pionier, Profil)"
    awarded = await flow.db.user_achievements.count_documents({"user_id": user["id"]})
    second = await flow.post("/api/achievements/evaluate")
    assert second.status_code == 200 and second.json()["newly_awarded"] == 0
    assert await flow.db.user_achievements.count_documents({"user_id": user["id"]}) == awarded


@pytest.mark.asyncio
async def test_two_awards_of_the_same_tier_at_once_leave_exactly_one(flow, monkeypatch):
    await probe_tiers(flow, probe_a=50)
    await flow.db.user_achievements.create_index([("user_id", 1), ("tier_code", 1)], unique=True)
    user = await person(flow, "doppelt")
    # Beide Vergaben lesen „noch nicht vergeben“, bevor eine schreibt - wie zwei Worker auf echtem MongoDB.
    gate = InterleavedReads(flow.db, "user_achievements")
    monkeypatch.setattr(badges, "get_db", lambda: gate)

    results = await asyncio.gather(badges.award_achievement(user["id"], "probe_a"),
                                   badges.award_achievement(user["id"], "probe_a"))

    assert sorted(results) == [False, True]
    assert await flow.db.user_achievements.count_documents({"user_id": user["id"], "tier_code": "probe_a"}) == 1


# ---------------------------------------------------------------- Team-Level

@pytest.mark.asyncio
async def test_the_team_level_adds_member_points_and_tournament_bonus_and_earns_team_achievements(flow):
    await probe_tiers(flow, probe_a=300, probe_b=200)
    members = [await person(flow, "kapitaen", "probe_a", "probe_b"), await person(flow, "mitte", "probe_a"),
               await person(flow, "neu")]
    team = {"id": new_id(), "name": "Rudel", "tag": "RDL", "leader_id": members[0]["id"], "co_leader_ids": [],
            "member_ids": [m["id"] for m in members], "is_public": True}
    small = {"id": new_id(), "name": "Klein", "tag": "KLN", "leader_id": new_id(), "co_leader_ids": [],
             "member_ids": [], "is_public": True}
    await flow.db.teams.insert_many([dict(team), dict(small)])
    won, played = new_id(), new_id()
    await flow.db.tournaments.insert_many([
        {"id": won, "slug": f"herbst-{won[:8]}", "title": "Herbst-Cup", "status": "completed", "winner_team_id": team["id"]},
        {"id": played, "slug": f"winter-{played[:8]}", "title": "Winter-Cup", "status": "completed", "winner_team_id": None}])
    await flow.db.tournament_registrations.insert_many([
        {"id": new_id(), "tournament_id": tid, "team_id": team["id"], "status": "approved"} for tid in (won, played)])
    flow.act_as(None)

    detail = (await flow.get(f"/api/teams/{team['id']}/level")).json()
    member_points = 300 + 200 + 300
    bonus = 2 * team_levels.PARTICIPATION_BONUS + team_levels.WIN_BONUS
    assert (detail["member_points"], detail["tournament_points"]) == (member_points, bonus)
    assert detail["points"] == member_points + bonus and (detail["tournaments"], detail["wins"]) == (2, 1)
    assert detail["member_count"] == 3
    level = detail["level"]
    assert (level - 1) ** 2 * 100 <= detail["points"] < level ** 2 * 100, "Quadratkurve: Level L ab (L-1)² × 100 Punkten"
    assert 0 <= detail["progress"] <= 100
    earned = {row["code"]: row["earned"] for row in detail["achievements"]}
    assert [row["code"] for row in detail["achievements"]] == [row["code"] for row in team_levels.TEAM_ACHIEVEMENTS]
    assert earned["team_founded"] and earned["team_roster_3"] and not earned["team_roster_5"]
    assert earned["team_points_500"] and not earned["team_points_2500"]
    assert earned["team_tournament_1"] and not earned["team_tournament_3"] and earned["team_champion"]
    assert earned["team_level_5"] is (level >= 5) and not earned["team_level_10"]

    overview = (await flow.get("/api/teams/levels")).json()["levels"]
    assert set(overview) == {team["id"], small["id"]}
    assert overview[team["id"]] == {"level": level, "points": detail["points"], "progress": detail["progress"]}
    assert overview[small["id"]] == {"level": 1, "points": 0, "progress": 0}
    small_detail = (await flow.get(f"/api/teams/{small['id']}/level")).json()
    assert {row["code"] for row in small_detail["achievements"] if row["earned"]} == {"team_founded"}


# ---------------------------------------------------------------- Katalog

def test_catalog_names_carry_no_emoji():
    for group in catalog.ACHIEVEMENT_GROUPS:
        assert not EMOJI.search(f"{group.get('name', '')}{group.get('description') or ''}"), group["code"]
    for tier in catalog.ACHIEVEMENT_TIERS:
        assert not EMOJI.search(f"{tier.get('name', '')}{tier.get('level_name') or ''}"), tier["code"]
