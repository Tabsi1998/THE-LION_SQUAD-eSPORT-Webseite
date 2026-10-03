"""XP und Level (#617): Gutschriften sind je Bezug einmalig, Tagesdeckel greifen, Mitglieder bekommen zehn
Prozent mehr, ein Erfolg bringt Punkte mal zehn, der Aufstieg meldet sich, Prestige ab 60 mit Rücknahme,
der Level-Stand und die Rangliste kommen aus einer Quelle, der Admin berichtigt mit Grund und Protokoll."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
import badges  # noqa: E402
from services import levels, xp  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        xp._daily_seen.clear()
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_gutschrift_einmal_je_bezug_und_tagesdeckel(flow):
    user = await flow.add_user(name="Spielerin")
    first = await xp.grant(user["id"], "match_won", "m1")
    assert first["amount"] == 40 and first["bonus"] == 0 and first["total"] == 40 and first["level"] == 1
    assert await xp.grant(user["id"], "match_won", "m1") is None, "dasselbe Match zählt nicht zweimal"
    assert await xp.grant(user["id"], "unbekannt", "x") is None
    # 200 Chat-Nachrichten am Tag bringen 30 XP.
    for i in range(200):
        await xp.grant(user["id"], "community_chat", f"msg{i}")
    state = await xp.state(user["id"])
    assert state["total"] == 40 + 30
    assert await flow.db.xp_events.count_documents({"user_id": user["id"], "source": "community_chat"}) == 30


@pytest.mark.asyncio
async def test_mitglieder_bekommen_zehn_prozent_mehr(flow):
    member = await flow.add_user(name="Mitglied")
    await flow.db.memberships.insert_one({"id": "ms1", "user_id": member["id"], "member_status": "active"})
    result = await xp.grant(member["id"], "event_attended", "e1")
    assert result["amount"] == 60 and result["bonus"] == 6 and result["total"] == 66
    view = await xp.view(member["id"])
    assert view["member_bonus"] == 0.1 and view["xp"] == 66


@pytest.mark.asyncio
async def test_erfolg_bringt_punkte_mal_zehn_und_aufstieg_meldet_sich(flow):
    user = await flow.add_user(name="Sammler")
    assert await badges.award_achievement(user["id"], "profile_completeness_2")  # Silber: 35 Punkte (Katalog C)
    state = await xp.state(user["id"])
    assert state["total"] == 350 and state["level"] == 2
    note = await flow.db.notifications.find_one({"user_id": user["id"], "kind": "level"}, {"_id": 0})
    assert note and note["title"] == "Level 2 erreicht" and note["meta"]["previous"] == 1
    assert await badges.award_achievement(user["id"], "profile_completeness_2") is False
    assert await flow.db.xp_events.count_documents({"user_id": user["id"], "source": "achievement"}) == 1
    # Negative Gruppen bringen nichts.
    neg = await flow.db.achievements.find_one({"group_code": {"$regex": "^neg_"}}, {"_id": 0, "code": 1})
    await badges.award_achievement(user["id"], neg["code"])
    assert (await xp.state(user["id"]))["total"] == 350


@pytest.mark.asyncio
async def test_tages_login_mit_serie(flow):
    user = await flow.add_user(name="Treu")
    first = await xp.daily_login_once(user["id"])
    assert first["amount"] == 10
    assert await xp.daily_login_once(user["id"]) is None, "am selben Tag nur einmal"
    assert await xp.grant_daily_login(user["id"]) is None
    # Gestern angemeldet → heute Serie 2 → 15 XP.
    from datetime import timedelta
    from models import now_utc
    yesterday = (now_utc().astimezone(xp.VIENNA).date() - timedelta(days=1)).isoformat()
    await flow.db.user_xp.update_one({"user_id": user["id"]}, {"$set": {"last_login_day": yesterday, "login_streak": 1}})
    await flow.db.xp_events.delete_many({"user_id": user["id"]})
    second = await xp.grant_daily_login(user["id"])
    assert second["amount"] == 15
    assert (await xp.view(user["id"]))["login_streak"] == 2


@pytest.mark.asyncio
async def test_level_stand_prestige_und_ruecknahme(flow):
    user = await flow.add_user(name="Legende")
    flow.act_as(user)
    res = await flow.get("/api/users/me/level")
    assert res.status_code == 200
    body = res.json()
    assert body["level"] == 1 and body["xp"] == 0 and body["points"] == 0 and body["title"] == "Rookie" and body["max_level"] == 60
    assert {"current_level_points", "next_level_points", "progress", "prestige", "prestige_available", "member_bonus", "login_streak"} <= set(body)
    assert body["prestige_undo_until"] is None
    assert (await flow.post("/api/users/me/prestige")).status_code == 400, "erst ab Level 60"
    await xp.grant(user["id"], "correction", "boost", amount=levels.xp_for_level(60))
    body = (await flow.get("/api/users/me/level")).json()
    assert body["level"] == 60 and body["title"] == "Legende" and body["prestige_available"] is True
    res = await flow.post("/api/users/me/prestige")
    assert res.status_code == 200 and res.json()["prestige"] == 1 and res.json()["level"] == 1
    assert res.json()["prestige_undo_until"], "die App und das Web zeigen, bis wann die Rücknahme geht"
    assert (await flow.get("/api/achievements/me")).json()["level"]["prestige_undo_until"]
    other = await flow.add_user(name="Gast")
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"privacy_public_profile": True}})
    flow.act_as(other)
    username = (await flow.db.users.find_one({"id": user["id"]}, {"_id": 0, "username": 1}))["username"]
    res = await flow.get(f"/api/users/public/{username}")
    assert res.status_code == 200 and "achievement_level" in res.json()
    assert "prestige_undo_until" not in res.text, "das öffentliche Profil verrät nicht, wann jemand Prestige gemacht hat"
    flow.act_as(user)
    assert await flow.db.audit_logs.find_one({"action": "xp.prestige", "target_id": user["id"]})
    # XP aus den Stunden nach dem Prestige gehen bei der Rücknahme nicht verloren.
    await xp.grant(user["id"], "correction", "after-prestige", amount=40)
    res = await flow.post("/api/users/me/prestige/undo")
    assert res.status_code == 200 and res.json()["prestige"] == 0 and res.json()["level"] == 60
    assert res.json()["xp"] == levels.xp_for_level(60) + 40 and res.json()["prestige_undo_until"] is None
    assert (await flow.post("/api/users/me/prestige/undo")).status_code == 400
    # Nach Ablauf der Frist meldet der Stand keine Rücknahme mehr.
    await flow.post("/api/users/me/prestige")
    await flow.db.user_xp.update_one({"user_id": user["id"]}, {"$set": {"prestige_undo.until": "2000-01-01T00:00:00+00:00"}})
    assert (await flow.get("/api/users/me/level")).json()["prestige_undo_until"] is None
    assert (await flow.post("/api/users/me/prestige/undo")).status_code == 400
    await flow.db.user_xp.update_one({"user_id": user["id"]}, {"$set": {"prestige": 0, "total": levels.xp_for_level(60)}, "$unset": {"prestige_undo": ""}})
    # Mit Stern ist die Kurve länger: 170 XP reichen nicht mehr für Level 2.
    await flow.post("/api/users/me/prestige")
    await xp.grant(user["id"], "match_won", "m1", amount=170)
    assert (await flow.get("/api/users/me/level")).json()["level"] == 1


@pytest.mark.asyncio
async def test_rangliste_nach_level_und_admin_korrektur(flow):
    a = await flow.add_user(name="Anna")
    b = await flow.add_user(name="Bernd")
    hidden = await flow.add_user(name="Privat")
    await flow.db.users.update_many({"id": {"$in": [a["id"], b["id"]]}}, {"$set": {"privacy_public_profile": True}})
    await xp.grant(a["id"], "correction", "seed", amount=2000)
    await xp.grant(b["id"], "correction", "seed", amount=500)
    await xp.grant(hidden["id"], "correction", "seed", amount=9000)
    flow.act_as(None)
    rows = (await flow.get("/api/achievements/leaderboard?by=level")).json()
    assert [r["display_name"] for r in rows] == ["Anna", "Bernd"] and rows[0]["rank"] == 1 and rows[0]["level"] == levels.level_for_xp(2000)
    assert rows[0]["title"] == levels.title_for_level(rows[0]["level"])
    # XP-Korrektur (E10, #620): nur Vorstand oder Systemverwaltung.
    admin = await flow.add_user(role="superadmin", name="Admin")
    flow.act_as(admin)
    res = await flow.post("/api/admin/achievements/xp", json={"user_id": b["id"], "amount": -100, "reason": "Doppelt gezählt"})
    assert res.status_code == 200 and res.json()["xp"] == 400
    assert (await flow.post("/api/admin/achievements/xp", json={"user_id": b["id"], "amount": 0, "reason": "nichts"})).status_code == 400
    log = await flow.db.audit_logs.find_one({"action": "xp.correction", "target_id": b["id"]}, {"_id": 0})
    assert log["data"] == {"amount": -100, "reason": "Doppelt gezählt"} and log["actor_id"] == admin["id"]


@pytest.mark.asyncio
async def test_erstberechnung_aus_der_historie_nur_einmal(flow):
    user = await flow.add_user(name="Veteran")
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"privacy_public_profile": True}})
    await badges.award_achievement(user["id"], "matches_played_2")  # Eisen, 10 Punkte → 100 XP als Ereignis
    await flow.db.user_xp.delete_many({"user_id": user["id"]})
    await flow.db.xp_events.delete_many({"user_id": user["id"]})
    state = await xp.rebuild(user["id"])
    assert state["total"] == 100 and state.get("baseline_at")
    await xp.grant(user["id"], "match_won", "m1")
    again = await xp.rebuild(user["id"])
    assert again["total"] == 140, "die Erstberechnung läuft nur einmal"
    assert await xp.rebuild_missing(10) == 0
    fresh = await flow.add_user(name="Neu")
    assert await xp.rebuild_missing(10) == 1
    assert (await xp.state(fresh["id"])).get("baseline_at")


@pytest.mark.asyncio
async def test_hooks_schreiben_xp(flow):
    user = await flow.add_user(name="Spieler")
    other = await flow.add_user(name="Gegner")
    await badges.on_tournament_registered(user["id"], "t1")
    await badges.on_checked_in(user["id"], "t1")
    await badges.on_match_completed(user["id"], other["id"], "t1", "m1")
    await badges.on_tournament_completed("t1", [{"user_id": user["id"], "rank": 1}, {"user_id": other["id"], "rank": 2}])
    await badges.on_team_joined(user["id"], "team1")
    mine = {row["source"]: row["amount"] async for row in flow.db.xp_events.find({"user_id": user["id"]}, {"_id": 0})}
    assert mine == {"tournament_registered": 30, "checked_in": 10, "match_played": 20, "match_won": 40, "tournament_completed": 50, "podium_1": 150, "team_joined": 30}
    theirs = {row["source"]: row["amount"] async for row in flow.db.xp_events.find({"user_id": other["id"]}, {"_id": 0})}
    assert theirs == {"match_played": 20, "tournament_completed": 50, "podium_2": 100}
    assert (await xp.state(user["id"]))["total"] == 330
