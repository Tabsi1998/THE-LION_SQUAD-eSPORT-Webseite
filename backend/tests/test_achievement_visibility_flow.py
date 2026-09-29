"""Erfolge II (#619): Seltenheit je Stufe und Gruppe, Fortschritt der Community je Kategorie, die Zahl der
geheimen Gruppen, „Als Nächstes“, Ranglisten je Kategorie und Zeitraum, der Erfolg der Woche, das Laufband,
Anheften und die Sichtbarkeit fremder Erfolge (Schalter und Verein-Kategorie)."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
import achievement_catalog as catalog  # noqa: E402
import badges  # noqa: E402
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


async def _public(flow, user, **extra):
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"privacy_public_profile": True, **extra}})


async def _member(flow, user):
    await flow.db.memberships.insert_one({"user_id": user["id"], "member_status": "active", "membership_type": "ordinary"})


async def _tier_of_category(flow, category: str) -> dict:
    group = await flow.db.achievement_groups.find_one({"category": category, "is_negative": {"$ne": True}, "public": True, "manual_only": {"$ne": True}}, {"_id": 0}, sort=[("sort_order", 1)])
    assert group, category
    tier = await flow.db.achievements.find_one({"group_code": group["code"]}, {"_id": 0}, sort=[("rank", 1)])
    assert tier
    return tier


async def _hidden_group(flow):
    await flow.db.achievement_groups.insert_one({"code": "secret_x", "id": "secret_x", "name": "Geheim: X", "category": "hidden", "hidden": True, "public": True,
                                                 "is_special": False, "is_negative": False, "icon": "eye-off", "accent_color": "#A855F7", "description": "Psst.", "sort_order": 950})
    await flow.db.achievements.insert_one(catalog.tier("secret_x_1", "secret_x", "hidden", "X", "Gefunden.", manual_only=True) | {"id": "secret_x_1"})


# ------------------------------------------------------------------ Seltenheit und Kategorien

@pytest.mark.asyncio
async def test_seltenheit_kategorien_und_geheim_zaehler(flow):
    users = [await flow.add_user(name=f"p{i}") for i in range(4)]
    for u in users:
        await _public(flow, u)
    await _member(flow, users[0])
    await _member(flow, users[1])
    await _hidden_group(flow)
    assert await badges.award_achievement(users[0]["id"], "matches_played_1")
    assert await badges.award_achievement(users[1]["id"], "matches_played_1")
    assert await badges.award_achievement(users[1]["id"], "matches_played_4")
    assert await badges.award_achievement(users[0]["id"], "secret_x_1")
    club_tier = await _tier_of_category(flow, "club")
    assert await badges.award_achievement(users[0]["id"], club_tier["code"])
    visibility.reset_rarity_cache()

    flow.act_as(None)
    res = await flow.get("/api/achievements/overview")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["rarity"]["base"] == 4 and data["rarity"]["members_base"] == 2
    # Zwei von vier haben Holz, eine von vier Silber; die Karte zeigt die höchste Stufe (Diamant, niemand).
    assert data["rarity"]["tiers"]["matches_played_1"] == 50.0 and data["rarity"]["tiers"]["matches_played_4"] == 25.0
    played = data["rarity"]["groups"]["matches_played"]
    assert played["holders"] == 2 and played["percent"] == 50.0
    assert played["top"]["material"] == "diamond" and played["top"]["percent"] == 0.0 and played["top"]["holders"] == 0
    # Vereins-Stufen rechnen mit den Mitgliedern als Grundlage: eine von zwei, nicht eine von vier.
    assert data["rarity"]["tiers"][club_tier["code"]] == 50.0
    assert not any(code.startswith("neg_") for code in data["rarity"]["tiers"]), "Negatives hat keine Seltenheit"
    # Kategorien: Spielen hat zwei Leute mit etwas, drei Vergaben - Fortschritt = Vergaben / (Konten × Stufen).
    match = next(c for c in data["categories"] if c["key"] == "match")
    assert match["label"] == "Spielen" and match["holders"] == 2 and match["awards"] == 3 and match["link"] == "/tournaments"
    assert match["community_percent"] == round(100 * 3 / (4 * match["tiers"]), 1)
    club = next(c for c in data["categories"] if c["key"] == "club")
    assert club["member_only"] is True and club["holders"] == 1 and club["community_percent"] == round(100 * 1 / (2 * club["tiers"]), 1)
    hidden = next(c for c in data["categories"] if c["key"] == "hidden")
    assert hidden["hidden"] is True and hidden["groups"] >= 1
    assert "negative" not in {c["key"] for c in data["categories"]}
    # Die Zahl der geheimen Gruppen haengt vom Katalog ab (Katalog D bringt 13 mit) - gezaehlt wird gegen die Datenbank.
    hidden_total = await flow.db.achievement_groups.count_documents({"hidden": True, "is_negative": {"$ne": True}})
    assert hidden_total >= 1
    assert data["hidden"] == {"total": hidden_total, "earned": 0}, "anonym: nur die Zahl"
    assert isinstance(data["week"], dict) and "week_key" in data["week"] and isinstance(data["recent"], list)

    flow.act_as(users[0])
    data = (await flow.get("/api/achievements/overview")).json()
    assert data["hidden"] == {"total": hidden_total, "earned": 1}
    mine = (await flow.get("/api/achievements/me")).json()
    assert mine["hidden"] == {"total": hidden_total, "earned": 1} and mine["privacy_achievements_public"] is True
    assert mine["level"]["level"] >= 1 and "title" in mine["level"]
    assert mine["pinned"] == [] and mine["pinned_codes"] == []


# ------------------------------------------------------------------ Als Nächstes

def _tier(code, rank, *, earned=False, percent=0, current=0, target=10, manual=False, status=None, points=5):
    return {"code": code, "name": code, "rank": rank, "level": 1, "earned": earned, "percent": percent, "current": current, "target": target,
            "manual_only": manual, "condition_status": status, "points": points, "material": "wood", "material_name": "Holz", "how_to": f"Mach {code}."}


def test_als_naechstes_je_gruppe_die_naechste_offene_stufe():
    groups = [
        {"code": "a", "name": "A", "category": "fastlap", "tiers": [_tier("a1", 1, earned=True), _tier("a2", 2, percent=80, current=8), _tier("a3", 3, percent=10, current=1)]},
        {"code": "b", "name": "B", "category": "match", "tiers": [_tier("b1", 1, percent=90, current=9)]},
        {"code": "c", "name": "C", "category": "special", "tiers": [_tier("c1", 1, manual=True)]},
        {"code": "d", "name": "D", "category": "hidden", "hidden": True, "tiers": [_tier("d1", 1, percent=99)]},
        {"code": "e", "name": "E", "category": "negative", "is_negative": True, "tiers": [_tier("e1", 1, percent=99)]},
        {"code": "f", "name": "F", "category": "team", "tiers": [_tier("f1", 1, status="planned", percent=99)]},
        {"code": "g", "name": "G", "category": "community", "tiers": [_tier("g1", 1, percent=80, current=80, target=100, points=60)]},
        {"code": "h", "name": "H", "category": "profile", "tiers": [_tier("h1", 1, percent=20, current=2)]},
    ]
    picked = visibility.next_up(groups)
    assert [c["code"] for c in picked] == ["b1", "a2", "g1"], "nach Prozent, bei Gleichstand nach dem, was fehlt"
    assert picked[0]["link"] == "/tournaments" and picked[1]["link"] == "/fastlap" and picked[1]["missing"] == 2
    assert picked[1]["how_to"] == "Mach a2." and picked[1]["group_name"] == "A"
    assert [c["code"] for c in visibility.next_up(groups, limit=10)] == ["b1", "a2", "g1", "h1"], "von Hand, geplant, geheim und negativ bleiben draußen"
    assert visibility.next_up([], 3) == []


@pytest.mark.asyncio
async def test_als_naechstes_ueber_die_api(flow):
    user = await flow.add_user(name="Spielerin")
    flow.act_as(user)
    mine = (await flow.get("/api/achievements/me")).json()
    assert 1 <= len(mine["next_up"]) <= 3
    first = mine["next_up"][0]
    assert {"code", "percent", "current", "target", "missing", "how_to", "link", "material", "group_name"} <= set(first)
    assert first["link"].startswith("/")


# ------------------------------------------------------------------ Ranglisten

@pytest.mark.asyncio
async def test_rangliste_je_kategorie_und_zeitraum(flow):
    anna = await flow.add_user(name="anna")
    ben = await flow.add_user(name="ben")
    cara = await flow.add_user(name="cara")
    for u in (anna, ben, cara):
        await _public(flow, u)
    tournament_tier = await _tier_of_category(flow, "tournament")
    assert await badges.award_achievement(anna["id"], "matches_played_1")
    assert await badges.award_achievement(anna["id"], tournament_tier["code"])
    assert await badges.award_achievement(ben["id"], "matches_played_1")
    assert await badges.award_achievement(cara["id"], "matches_played_1")
    long_ago = (datetime.now(timezone.utc) - timedelta(days=400)).isoformat()
    await flow.db.user_achievements.update_one({"user_id": ben["id"], "tier_code": "matches_played_1"}, {"$set": {"earned_at": long_ago}})
    await flow.db.user_xp.insert_one({"user_id": anna["id"], "total": 900, "prestige": 1, "level": 4})
    wood = catalog.MATERIALS["wood"]["points"]

    flow.act_as(None)
    rows = (await flow.get("/api/achievements/leaderboard")).json()
    assert [r["username"] for r in rows] == ["anna", "ben", "cara"]
    assert rows[0]["points"] == wood + int(tournament_tier["points"]) and rows[0]["count"] == 2 and rows[0]["rank"] == 1
    assert rows[0]["level"] == 4 and rows[0]["prestige"] == 1 and rows[1]["level"] == 1
    rows = (await flow.get("/api/achievements/leaderboard?period=year")).json()
    assert [r["username"] for r in rows] == ["anna", "cara"], "Bens Vergabe ist vom Vorjahr"
    rows = (await flow.get("/api/achievements/leaderboard?period=month")).json()
    assert [r["username"] for r in rows] == ["anna", "cara"]
    rows = (await flow.get("/api/achievements/leaderboard?category=match")).json()
    assert [(r["username"], r["points"]) for r in rows] == [("anna", wood), ("ben", wood), ("cara", wood)]
    rows = (await flow.get("/api/achievements/leaderboard?category=tournament")).json()
    assert [r["username"] for r in rows] == ["anna"]
    # Saison: ohne laufende Saison zählt alles, mit einer Saison nur ab ihrem Start.
    rows = (await flow.get("/api/achievements/leaderboard?period=season")).json()
    assert len(rows) == 3
    await flow.db.seasons.insert_one({"id": "s1", "name": "Herbst", "status": "active", "start_date": (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()})
    rows = (await flow.get("/api/achievements/leaderboard?period=season")).json()
    assert [r["username"] for r in rows] == ["anna", "cara"]
    assert (await flow.get("/api/achievements/leaderboard?category=unsinn")).status_code == 422
    assert (await flow.get("/api/achievements/leaderboard?period=gestern")).status_code == 422
    assert isinstance((await flow.get("/api/achievements/leaderboard?by=level")).json(), list)
    # Wer die Erfolge verbirgt, steht auf keiner Rangliste.
    await flow.db.users.update_one({"id": cara["id"]}, {"$set": {"privacy_achievements_public": False}})
    rows = (await flow.get("/api/achievements/leaderboard")).json()
    assert "cara" not in {r["username"] for r in rows}


def test_zeitraum_start():
    now = datetime(2026, 9, 29, 10, 0, tzinfo=timezone.utc)
    assert visibility.period_start("all", now=now) is None
    assert visibility.period_start("year", now=now).isoformat() == "2026-01-01T00:00:00+02:00" or visibility.period_start("year", now=now).month == 1
    month = visibility.period_start("month", now=now)
    assert (month.year, month.month, month.day, month.hour) == (2026, 9, 1, 0)
    assert visibility.period_start("season", now=now, season={"start_date": "2026-09-01T00:00:00+00:00"}).day == 1
    assert visibility.period_start("season", now=now, season=None) is None


# ------------------------------------------------------------------ Erfolg der Woche und Laufband

def test_wochenfenster_endet_montag_acht_uhr():
    tuesday = datetime(2026, 9, 29, 12, 0, tzinfo=visibility.VIENNA)
    start, end, key = visibility.week_window(tuesday)
    assert (end.weekday(), end.hour, end.day) == (0, 8, 28) and (end - start).days == 7 and key == "2026-W40"
    early_monday = datetime(2026, 9, 28, 7, 30, tzinfo=visibility.VIENNA)
    assert visibility.week_window(early_monday)[1].day == 21, "vor 08:00 zählt noch die Vorwoche"


@pytest.mark.asyncio
async def test_erfolg_der_woche_und_laufband(flow):
    anna = await flow.add_user(name="anna")
    ben = await flow.add_user(name="ben")
    dora = await flow.add_user(name="dora")
    for u in (anna, ben):
        await _public(flow, u)
    start, end, key = visibility.week_window()
    inside = (end - timedelta(hours=20)).isoformat()
    tournament_tier = await _tier_of_category(flow, "tournament")
    assert await badges.award_achievement(anna["id"], "matches_played_1")
    assert await badges.award_achievement(ben["id"], "matches_played_1")
    assert await badges.award_achievement(ben["id"], tournament_tier["code"])
    assert await badges.award_achievement(dora["id"], "matches_played_4"), "privates Profil"
    assert await badges.award_achievement(anna["id"], "neg_dispute"), "eine negative Vergabe, die nirgends auftauchen darf"
    await flow.db.user_achievements.update_many({"tier_code": {"$in": ["matches_played_1", tournament_tier["code"]]}}, {"$set": {"earned_at": inside}})
    visibility.reset_rarity_cache()

    flow.act_as(None)
    week = (await flow.get("/api/achievements/week")).json()
    assert week["week_key"] == key and week["from"] == start.isoformat() and week["to"] == end.isoformat()
    assert week["award"]["tier_code"] == tournament_tier["code"] and week["award"]["user"]["username"] == "ben", "am wenigsten Leute haben es"
    assert week["award"]["holders"] == 1 and week["award"]["percent"] == round(100 / 3, 1)
    assert "id" in week["award"]["user"] and "email" not in week["award"]["user"]
    # Festgelegt bleibt festgelegt - auch wenn Ben sein Profil danach schließt; erst force rechnet neu.
    await flow.db.users.update_one({"id": ben["id"]}, {"$set": {"privacy_public_profile": False}})
    assert (await flow.get("/api/achievements/week")).json()["award"]["user"]["username"] == "ben"
    fresh = await visibility.achievement_of_week(flow.db, force=True)
    assert fresh["award"]["user"]["username"] == "anna" and fresh["award"]["tier_code"] == "matches_played_1"
    stored = await flow.db.settings.find_one({"id": "achievement_of_week"}, {"_id": 0})
    assert stored["week_key"] == key and stored["award"]["tier_code"] == "matches_played_1"

    recent = (await flow.get("/api/achievements/recent?limit=10")).json()
    names = {(r["user"]["username"], r["tier_code"]) for r in recent}
    assert ("anna", "matches_played_1") in names
    assert not any(r["user"]["username"] in ("ben", "dora") for r in recent), "nur öffentliche Profile"
    assert not any(r["tier_code"].startswith("neg_") for r in recent), "Negatives läuft nie mit"
    assert all({"material", "material_color", "group_name", "earned_at", "category"} <= set(r) for r in recent)
    assert recent == sorted(recent, key=lambda r: r["earned_at"], reverse=True)


# ------------------------------------------------------------------ Anheften und fremde Profile

@pytest.mark.asyncio
async def test_anheften_nur_eigene_und_hoechstens_sechs(flow):
    anna = await flow.add_user(name="anna")
    ben = await flow.add_user(name="ben")
    await _public(flow, anna)
    for code in ("matches_played_1", "matches_played_2", "matches_played_3"):
        assert await badges.award_achievement(anna["id"], code)
    assert await badges.award_achievement(ben["id"], "matches_played_4")
    flow.act_as(anna)
    res = await flow.put("/api/achievements/me/pins", json={"tier_codes": ["matches_played_3", "matches_played_1", "matches_played_3"]})
    assert res.status_code == 200, res.text
    assert res.json()["pinned_codes"] == ["matches_played_3", "matches_played_1"], "Reihenfolge bleibt, Doppelte fallen weg"
    assert [a["code"] for a in res.json()["pinned"]] == ["matches_played_3", "matches_played_1"]
    assert (await flow.put("/api/achievements/me/pins", json={"tier_codes": ["matches_played_4"]})).status_code == 422, "fremde Vergabe"
    assert (await flow.put("/api/achievements/me/pins", json={"tier_codes": [f"x{i}" for i in range(7)]})).status_code == 422
    mine = (await flow.get("/api/achievements/me")).json()
    assert mine["pinned_codes"] == ["matches_played_3", "matches_played_1"] and [a["code"] for a in mine["pinned"]] == ["matches_played_3", "matches_played_1"]
    flow.act_as(ben)
    theirs = (await flow.get(f"/api/achievements/user/{anna['id']}")).json()
    assert [a["code"] for a in theirs["pinned"]] == ["matches_played_3", "matches_played_1"] and theirs["achievements_hidden"] is False
    # Eine Vergabe weniger: der Anker zeigt nur, was noch da ist.
    await flow.db.user_achievements.delete_one({"user_id": anna["id"], "tier_code": "matches_played_3"})
    assert [a["code"] for a in (await flow.get(f"/api/achievements/user/{anna['id']}")).json()["pinned"]] == ["matches_played_1"]
    flow.act_as(anna)
    assert (await flow.put("/api/achievements/me/pins", json={"tier_codes": []})).json()["pinned_codes"] == []


@pytest.mark.asyncio
async def test_fremde_erfolge_schalter_und_verein_nur_fuer_mitglieder(flow):
    anna = await flow.add_user(name="anna")
    ben = await flow.add_user(name="ben")
    carl = await flow.add_user(name="carl")
    staff = await flow.add_staff()
    await _public(flow, anna)
    await _member(flow, anna)
    await _member(flow, carl)
    club_tier = await _tier_of_category(flow, "club")
    assert await badges.award_achievement(anna["id"], "matches_played_1")
    assert await badges.award_achievement(anna["id"], club_tier["code"])

    def club_groups(payload):
        return [g["code"] for g in payload["groups"] if g["category"] == "club"]

    flow.act_as(ben)
    seen = (await flow.get(f"/api/achievements/user/{anna['id']}")).json()
    assert club_groups(seen) == [] and not any(a["group_category"] == "club" for a in seen["awards"]), "kein Mitglied: kein Verein"
    assert any(a["code"] == "matches_played_1" for a in seen["awards"])
    flow.act_as(None)
    seen = (await flow.get(f"/api/achievements/user/{anna['id']}")).json()
    assert club_groups(seen) == []
    flow.act_as(carl)
    seen = (await flow.get(f"/api/achievements/user/{anna['id']}")).json()
    assert club_tier["group_code"] in club_groups(seen) and any(a["code"] == club_tier["code"] for a in seen["awards"])
    flow.act_as(staff)
    assert club_tier["group_code"] in club_groups((await flow.get(f"/api/achievements/user/{anna['id']}")).json())
    flow.act_as(anna)
    assert club_tier["group_code"] in club_groups((await flow.get(f"/api/achievements/user/{anna['id']}")).json())

    # Der Schalter „Erfolge öffentlich“ über das Profil: aus → fremde sehen nichts, die Person und das Team schon.
    res = await flow.put("/api/users/me", json={"privacy_achievements_public": False})
    assert res.status_code == 200, res.text
    assert (await flow.get("/api/achievements/me")).json()["privacy_achievements_public"] is False
    flow.act_as(ben)
    seen = (await flow.get(f"/api/achievements/user/{anna['id']}")).json()
    assert seen == {"groups": [], "awards": [], "pinned": [], "hidden": {"total": 0, "earned": 0}, "achievements_hidden": True}
    flow.act_as(staff)
    assert (await flow.get(f"/api/achievements/user/{anna['id']}")).json()["achievements_hidden"] is False
    flow.act_as(anna)
    assert len((await flow.get(f"/api/achievements/user/{anna['id']}")).json()["awards"]) == 2
    flow.act_as(anna)
    assert (await flow.put("/api/users/me", json={"privacy_achievements_public": True})).status_code == 200
    flow.act_as(ben)
    assert (await flow.get(f"/api/achievements/user/{anna['id']}")).json()["achievements_hidden"] is False


# ------------------------------------------------------------------ Dashboard-Kachel

@pytest.mark.asyncio
async def test_dashboard_kachel_liefert_level_naechstes_und_letzte_freischaltung(flow):
    anna = await flow.add_user(name="anna")
    flow.act_as(anna)
    empty = (await flow.get("/api/achievements/me/summary")).json()
    assert empty["count"] == 0 and empty["points"] == 0 and empty["last_award"] is None
    assert empty["level"]["level"] >= 1 and empty["next_up"] and empty["next_up"]["link"].startswith("/")
    assert await badges.award_achievement(anna["id"], "matches_played_1")
    assert await badges.award_achievement(anna["id"], "matches_played_2")
    assert await badges.award_achievement(anna["id"], "neg_dispute")
    summary = (await flow.get("/api/achievements/me/summary")).json()
    assert summary["count"] == 2 and summary["points"] == catalog.MATERIALS["wood"]["points"] + catalog.MATERIALS["iron"]["points"]
    assert summary["last_award"]["code"] == "matches_played_2" and summary["last_award"]["material"] == "iron" and summary["last_award"]["award_id"]
    assert summary["hidden"] == {"total": 0, "earned": 0}
    mine = (await flow.get("/api/achievements/me")).json()
    assert all(a.get("award_id") for a in mine["awards"]), "jede Vergabe trägt ihre Kennung"
