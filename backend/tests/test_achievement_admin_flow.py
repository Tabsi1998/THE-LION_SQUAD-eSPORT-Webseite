"""Erfolge II (E10, #620): der Admin-Bereich - Übersicht, Katalog-Prüfung/Export/Import, Protokoll,
Einzelvergabe mit Datum und ohne Zeremonie, Massenvergabe (Rechte, Idempotenz, Auswahl), Saison-Vorschau,
XP-Deckel und Prestige-Rücksetzung, Statistik mit CSV."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
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


async def _superadmin(flow):
    return await flow.add_user(role="superadmin", name="chef")


async def _board_member(flow):
    user = await flow.add_user(role="club_admin", name="vorstand")
    await flow.db.board_positions.insert_one({"id": "pos-1", "title": "Obmann", "user_id": user["id"], "is_active": True})
    return user


@pytest.mark.asyncio
async def test_uebersicht_katalogpruefung_export_und_protokoll(flow):
    admin = await _superadmin(flow)
    anna = await flow.add_user(name="anna")
    await flow.db.users.update_one({"id": anna["id"]}, {"$set": {"privacy_public_profile": True}})
    assert await badges.award_achievement(anna["id"], "matches_played_1")
    await flow.db.user_xp.update_one({"user_id": anna["id"]}, {"$set": {"total": 900, "prestige": 1, "level": 4}}, upsert=True)
    await flow.db.settings.insert_one({"id": "achievements_reconcile_last", "at": "2026-09-29T02:10:00+00:00", "checked": 12, "drift": 1, "awarded": 3})
    visibility.reset_rarity_cache()
    flow.act_as(admin)
    res = await flow.get("/api/admin/achievements/overview")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["unlocks_7d"] == 1 and data["unlocks_30d"] == 1
    assert data["rarest"]["code"] == "matches_played_1" and data["rarest"]["holders"] == 1
    assert data["most_active_category"]["key"] == "match" and data["most_active_category"]["label"] == "Spielen"
    assert data["levels"]["1-9"] == 1 and data["prestige_holders"] == 1
    assert data["users_total"] == 2 and data["users_without_award"] == 1
    assert data["reconcile"]["checked"] == 12 and "waiting" in data["queue"]

    check = (await flow.get("/api/admin/achievements/catalog/check")).json()
    assert check["ok"] is True and check["errors"] == [] and check["counts"]["tiers"] > 300
    # Ein kaputter Eintrag in der Datenbank wird gefunden - mit Code, Gruppe und Satz.
    await flow.db.achievements.insert_one({"code": "kaputt_1", "id": "kaputt_1", "group_code": "gibt_es_nicht", "name": "", "points": 0, "material": "gold", "rank": 5, "level": 3})
    check = (await flow.get("/api/admin/achievements/catalog/check")).json()
    assert check["ok"] is False
    codes = {e["code"] for e in check["errors"]}
    assert {"tier_group_missing"} <= codes
    await flow.db.achievements.delete_one({"code": "kaputt_1"})

    export = (await flow.get("/api/admin/achievements/catalog/export")).json()
    assert export["format"] == "tls-achievements/1" and len(export["groups"]) > 100 and len(export["tiers"]) > 300

    events = (await flow.get("/api/admin/achievements/events")).json()
    assert isinstance(events, list)


@pytest.mark.asyncio
async def test_einzelvergabe_mit_datum_ohne_zeremonie_und_ruecknahme_mit_grund(flow):
    admin = await _superadmin(flow)
    anna = await flow.add_user(name="anna")
    flow.act_as(admin)
    res = await flow.post("/api/admin/achievements/award", json={"user_id": anna["id"], "tier_code": "matches_played_1", "note": "LAN-Abend", "earned_at": "2026-09-01T18:00:00+00:00", "silent": True})
    assert res.status_code == 200, res.text
    assert res.json()["newly_awarded"] is True and res.json()["silent"] is True and res.json()["earned_at"].startswith("2026-09-01")
    doc = await flow.db.user_achievements.find_one({"user_id": anna["id"], "tier_code": "matches_played_1"}, {"_id": 0})
    assert doc["silent"] is True and doc["earned_at"].startswith("2026-09-01") and doc["context"]["note"] == "LAN-Abend"
    # Zweite Vergabe ändert nichts (idempotent), Zukunftsdatum wird abgelehnt.
    assert (await flow.post("/api/admin/achievements/award", json={"user_id": anna["id"], "tier_code": "matches_played_1"})).json()["already_awarded"] is True
    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    assert (await flow.post("/api/admin/achievements/award", json={"user_id": anna["id"], "tier_code": "matches_played_2", "earned_at": future})).status_code == 400
    assert (await flow.post("/api/admin/achievements/award", json={"user_id": anna["id"], "tier_code": "matches_played_2", "earned_at": "gestern"})).status_code == 400
    assert (await flow.post("/api/admin/achievements/award", json={"user_id": "niemand", "tier_code": "matches_played_2"})).status_code == 404
    # Die eigene Sicht zeigt „silent“, das Nachholen kann es überspringen.
    flow.act_as(anna)
    mine = (await flow.get("/api/achievements/me")).json()
    tier = next(t for g in mine["groups"] for t in g["tiers"] if t["code"] == "matches_played_1")
    assert tier["earned"] is True and tier["silent"] is True
    assert next(a for a in mine["awards"] if a["code"] == "matches_played_1")["silent"] is True
    flow.act_as(admin)
    res = await flow.client.request("DELETE", "/api/admin/achievements/award", json={"user_id": anna["id"], "tier_code": "matches_played_1", "note": "versehentlich"})
    assert res.status_code == 200
    events = (await flow.get(f"/api/admin/achievements/events?user_id={anna['id']}")).json()
    assert [e["kind"] for e in events] == ["revoke", "award"]
    assert events[0]["note"] == "versehentlich" and events[0]["actor_name"] == "chef" and events[1]["tier_name"] and events[1]["data"]["silent"] is True


@pytest.mark.asyncio
async def test_massenvergabe_nur_vorstand_auswahl_und_idempotenz(flow):
    staff = await flow.add_user(role="club_admin", name="turnierleitung")
    board = await _board_member(flow)
    users = [await flow.add_user(name=f"p{i}") for i in range(4)]
    await flow.db.tournament_registrations.insert_many([
        {"tournament_id": "t1", "user_id": users[0]["id"], "status": "approved"},
        {"tournament_id": "t1", "user_id": users[1]["id"], "status": "checked_in"},
        {"tournament_id": "t1", "user_id": users[2]["id"], "status": "pending"},
    ])
    await flow.db.memberships.insert_many([{"user_id": users[2]["id"], "member_status": "active"}, {"user_id": users[3]["id"], "member_status": "ended"}])
    flow.act_as(staff)
    assert (await flow.post("/api/admin/achievements/award/bulk", json={"tier_code": "matches_played_1", "tournament_id": "t1"})).status_code == 403, "Turnierleitung darf keine Massenvergabe"
    flow.act_as(board)
    dry = (await flow.post("/api/admin/achievements/award/bulk", json={"tier_code": "matches_played_1", "tournament_id": "t1", "members": True, "user_ids": [users[3]["id"], users[3]["id"]], "dry_run": True})).json()
    assert dry["dry_run"] is True and dry["recipients"] == 4 and dry["awarded"] == 0
    assert set(dry["user_ids"]) == {u["id"] for u in users}, "Liste, Turnier (nur approved/checked_in) und Mitglieder - ohne Doppelte"
    res = await flow.post("/api/admin/achievements/award/bulk", json={"tier_code": "matches_played_1", "tournament_id": "t1", "members": True, "user_ids": [users[3]["id"]], "note": "Saisonstart", "silent": True})
    assert res.status_code == 200, res.text
    assert res.json()["awarded"] == 4 and res.json()["already"] == 0
    again = (await flow.post("/api/admin/achievements/award/bulk", json={"tier_code": "matches_played_1", "tournament_id": "t1", "members": True, "user_ids": [users[3]["id"]]})).json()
    assert again["awarded"] == 0 and again["already"] == 4, "zweiter Lauf vergibt nichts doppelt"
    assert await flow.db.user_achievements.count_documents({"tier_code": "matches_played_1", "silent": True}) == 4
    events = (await flow.get("/api/admin/achievements/events?kind=bulk_award")).json()
    assert len(events) == 2 and events[1]["data"]["awarded"] == 4 and events[1]["note"] == "Saisonstart" and events[1]["actor_name"] == "vorstand"
    assert (await flow.post("/api/admin/achievements/award/bulk", json={"tier_code": "gibt_es_nicht", "members": True})).status_code == 404
    # Vereins-Stufen überspringen Nicht-Mitglieder.
    club = await flow.db.achievement_groups.find_one({"category": "club", "public": True, "manual_only": {"$ne": True}}, {"_id": 0, "code": 1}, sort=[("sort_order", 1)])
    club_tier = await flow.db.achievements.find_one({"group_code": club["code"]}, {"_id": 0, "code": 1}, sort=[("rank", 1)])
    res = (await flow.post("/api/admin/achievements/award/bulk", json={"tier_code": club_tier["code"], "user_ids": [u["id"] for u in users]})).json()
    assert res["awarded"] == 1 and res["skipped"] == 3


@pytest.mark.asyncio
async def test_saison_vorschau_xp_deckel_und_prestige_ruecksetzung(flow):
    admin = await _superadmin(flow)
    staff = await flow.add_user(role="club_admin", name="turnierleitung")
    anna = await flow.add_user(name="anna")
    await flow.db.seasons.insert_one({"id": "s1", "name": "Herbst", "status": "active", "start_date": "2026-09-01T00:00:00+00:00"})
    flow.act_as(admin)
    res = await flow.get("/api/admin/achievements/season/s1/preview")
    assert res.status_code == 200, res.text
    preview = res.json()
    assert preview["season"]["name"] == "Herbst" and isinstance(preview["standings"], list) and preview["already_written"] is False
    assert any(g["code"] for g in preview["season_groups"])
    assert (await flow.get("/api/admin/achievements/season/nope/preview")).status_code == 404

    await flow.db.user_xp.update_one({"user_id": anna["id"]}, {"$set": {"total": 500, "prestige": 2, "level": 3}}, upsert=True)
    from services import xp
    await flow.db.xp_events.insert_one({"id": "e1", "user_id": anna["id"], "source": "daily_login", "ref": "x", "amount": 10, "bonus": 0, "day": xp.today_key(), "at": "2026-09-29T06:00:00+00:00"})
    caps = (await flow.get(f"/api/admin/achievements/xp/caps?user_id={anna['id']}")).json()
    login = next(r for r in caps["rows"] if r["source"] == "daily_login")
    assert login["used"] == 1 and login["cap"] == 1 and login["full"] is True
    assert caps["view"]["prestige"] == 2
    assert (await flow.get("/api/admin/achievements/xp/caps?user_id=niemand")).status_code == 404

    flow.act_as(staff)
    assert (await flow.post("/api/admin/achievements/xp/prestige-reset", json={"user_id": anna["id"], "reason": "Testkonto"})).status_code == 403
    assert (await flow.post("/api/admin/achievements/xp", json={"user_id": anna["id"], "amount": 50, "reason": "Nachtrag"})).status_code == 403, "XP-Korrektur nur Vorstand/Systemverwaltung"
    flow.act_as(admin)
    res = await flow.post("/api/admin/achievements/xp/prestige-reset", json={"user_id": anna["id"], "reason": "Testkonto zurückgesetzt"})
    assert res.status_code == 200 and res.json()["prestige"] == 0 and res.json()["xp"] == 500
    res = await flow.post("/api/admin/achievements/xp", json={"user_id": anna["id"], "amount": 50, "reason": "Nachtrag"})
    assert res.status_code == 200
    kinds = [e["kind"] for e in (await flow.get(f"/api/admin/achievements/events?user_id={anna['id']}")).json()]
    assert kinds == ["xp", "prestige_reset"]


@pytest.mark.asyncio
async def test_statistik_und_csv_und_import(flow):
    admin = await _superadmin(flow)
    anna = await flow.add_user(name="anna")
    await flow.db.users.update_one({"id": anna["id"]}, {"$set": {"privacy_public_profile": True}})
    assert await badges.award_achievement(anna["id"], "matches_played_1")
    visibility.reset_rarity_cache()
    flow.act_as(admin)
    stats = (await flow.get("/api/admin/achievements/stats")).json()
    row = next(r for r in stats["rarity"] if r["code"] == "matches_played_1")
    assert row["holders"] == 1 and row["percent"] == 50.0 and row["group_name"] and row["material_name"] == "Holz"
    assert len(stats["weekly"]) == 12 and sum(w["unlocks"] for w in stats["weekly"]) == 1
    assert stats["top"][0]["username"] == "anna"
    csv_res = await flow.get("/api/admin/achievements/stats.csv")
    assert csv_res.status_code == 200 and csv_res.headers["content-type"].startswith("text/csv")
    assert "matches_played_1;" in csv_res.text and "Woche;Freischaltungen" in csv_res.text
    # Import: Prüfung zuerst (Fehler → nichts geschrieben), dann Übernahme; dry_run schreibt nie.
    bad = {"groups": [{"code": "creator_x", "name": "Creator X", "category": "creator", "description": "X", "how_to": "X", "public": True}], "tiers": [{"code": "creator_x_1", "group_code": "creator_x", "material": "gold", "name": "", "points": 0}]}
    res = await flow.post("/api/admin/achievements/catalog/import", json=bad)
    assert res.status_code == 200 and res.json()["applied"] is False and res.json()["check"]["errors"]
    assert await flow.db.achievement_groups.find_one({"code": "creator_x"}) is None
    good = {"groups": bad["groups"], "tiers": [{"code": "creator_x_1", "group_code": "creator_x", "material": "gold", "name": "Creator X I", "description": "Ein Anfang.", "how_to": "Streamen.", "manual_only": True, "points": 60}]}
    res = await flow.post("/api/admin/achievements/catalog/import", json={**good, "dry_run": True})
    assert res.json()["applied"] is False and res.json()["check"]["ok"] is True
    assert await flow.db.achievements.find_one({"code": "creator_x_1"}) is None
    res = await flow.post("/api/admin/achievements/catalog/import", json=good)
    assert res.json()["applied"] is True
    stored = await flow.db.achievements.find_one({"code": "creator_x_1"}, {"_id": 0})
    assert stored["rank"] == 5 and stored["material_name"] == "Gold" and stored["points"] == 60
    assert (await flow.db.achievement_groups.find_one({"code": "creator_x"}, {"_id": 0}))["is_admin_created"] is True
    assert [e["kind"] for e in (await flow.get("/api/admin/achievements/events?kind=import")).json()] == ["import"]
    staff = await flow.add_user(role="club_admin", name="turnierleitung")
    flow.act_as(staff)
    assert (await flow.post("/api/admin/achievements/catalog/import", json=good)).status_code == 403
