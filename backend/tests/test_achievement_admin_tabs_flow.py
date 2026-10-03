"""Erfolge II (E10, #620), zweiter Teil: was die acht Reiter im Admin brauchen - durch die echte Anwendung.

- Vergabe „ohne Zeremonie“ mit Benachrichtigung wahlweise (ohne → keine Meldung im Postfach).
- Massenvergabe: Namen aus einer CSV-Liste, Vorschau je Person, 500 Personen in einem Zug unter zehn Sekunden,
  XP/Schlange/Meldung wie bei der Einzelvergabe, das Protokoll findet sie auch über die Person.
- Saison: die Vorschau zeigt je Platz, was der Abschluss vergibt (Saisonmeister, Saisonspitze, Volle Saison) -
  und der Abschluss vergibt genau das; mitten in der Saison gibt es keinen Abschluss von Hand.
- Katalog: Änderungen landen im Protokoll, das Material wechselt nur zwischen den Nachbarstufen, die Prüfung
  nennt Namen statt Schlüssel; Vorfälle und „alle auswerten“ stehen ebenfalls im Protokoll.
"""
import pathlib
import sys
import time

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
import badges  # noqa: E402
from models import new_id  # noqa: E402
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


@pytest.mark.asyncio
async def test_ohne_zeremonie_und_die_benachrichtigung_wahlweise(flow):
    admin = await _superadmin(flow)
    anna = await flow.add_user(name="anna")
    flow.act_as(admin)
    quiet = await flow.post("/api/admin/achievements/award", json={"user_id": anna["id"], "tier_code": "matches_played_1", "silent": True, "notify": False})
    assert quiet.status_code == 200, quiet.text
    assert quiet.json()["silent"] is True and quiet.json()["notify"] is False
    assert await flow.db.achievement_outbox.count_documents({"user_id": anna["id"]}) == 0, "ohne Benachrichtigung keine Meldung"
    assert await flow.db.user_achievements.count_documents({"user_id": anna["id"], "silent": True}) == 1
    told = await flow.post("/api/admin/achievements/award", json={"user_id": anna["id"], "tier_code": "matches_played_2", "silent": True})
    assert told.status_code == 200 and told.json()["notify"] is True
    assert await flow.db.achievement_outbox.count_documents({"user_id": anna["id"], "tier_code": "matches_played_2"}) == 1, "ohne Zeremonie, aber mit Meldung"
    events = (await flow.get(f"/api/admin/achievements/events?user_id={anna['id']}")).json()
    assert [e["data"]["notify"] for e in events] == [True, False]


@pytest.mark.asyncio
async def test_massenvergabe_500_personen_aus_einer_csv_unter_zehn_sekunden(flow):
    admin = await _superadmin(flow)
    people = [{"id": new_id(), "username": f"spieler{i:03d}", "display_name": f"Spieler {i}", "email": f"s{i:03d}@example.test", "role": "user", "is_active": True} for i in range(500)]
    await flow.db.users.insert_many([dict(p) for p in people])
    # Halb Benutzernamen (Groß/Klein egal, mit @), halb E-Mails - dazu ein Doppelter und zwei Unbekannte.
    people[1]["username"] = "SpIeLeR001"
    await flow.db.users.update_one({"id": people[1]["id"]}, {"$set": {"username": "SpIeLeR001"}})
    names = [f"@Spieler{i:03d}" for i in range(250)] + [f"S{i:03d}@EXAMPLE.test" for i in range(250, 500)] + ["spieler000", "niemand"]
    for early in people[:3]:
        assert await badges.award_achievement(early["id"], "matches_played_1")
    flow.act_as(admin)
    body = {"tier_code": "matches_played_1", "names": names, "user_ids": ["gibt-es-nicht"], "note": "LAN 2026"}
    dry_res = await flow.post("/api/admin/achievements/award/bulk", json={**body, "dry_run": True})
    assert dry_res.status_code == 200, dry_res.text
    dry = dry_res.json()
    assert dry["recipients"] == 500 and dry["would_award"] == 497 and dry["already"] == 3 and dry["awarded"] == 0
    assert sorted(dry["unknown"]) == ["gibt-es-nicht", "niemand"]
    assert len(dry["people"]) == 500 and dry["people"][0]["state"] == "already" and dry["people"][3] == {"id": people[3]["id"], "username": "spieler003", "display_name": "Spieler 3", "state": "new"}
    assert await flow.db.user_achievements.count_documents({"tier_code": "matches_played_1"}) == 3, "die Vorschau schreibt nichts"

    started = time.perf_counter()
    res = await flow.post("/api/admin/achievements/award/bulk", json=body)
    elapsed = time.perf_counter() - started
    assert res.status_code == 200, res.text
    assert res.json()["awarded"] == 497 and res.json()["already"] == 3
    assert elapsed < 10, f"500 Personen brauchten {elapsed:.1f} s"
    assert await flow.db.user_achievements.count_documents({"tier_code": "matches_played_1"}) == 500
    # Wie bei der Einzelvergabe: XP je Person, die Schlange für Sammler und Co., die gebündelte Meldung.
    assert await flow.db.xp_events.count_documents({"source": "achievement", "ref": "matches_played_1"}) == 500
    assert await flow.db.achievement_eval_queue.count_documents({}) == 500
    assert await flow.db.achievement_outbox.count_documents({"tier_code": "matches_played_1"}) == 500
    # Das Protokoll findet die Massenvergabe auch über eine Person.
    mine = (await flow.get(f"/api/admin/achievements/events?user_id={people[42]['id']}")).json()
    assert [e["kind"] for e in mine] == ["bulk_award"] and mine[0]["data"]["awarded"] == 497 and mine[0]["note"] == "LAN 2026"
    again = (await flow.post("/api/admin/achievements/award/bulk", json=body)).json()
    assert again["awarded"] == 0 and again["already"] == 500


@pytest.mark.asyncio
async def test_massenvergabe_ohne_benachrichtigung_und_mit_datum(flow):
    admin = await _superadmin(flow)
    users = [await flow.add_user(name=f"p{i}") for i in range(3)]
    flow.act_as(admin)
    res = await flow.post("/api/admin/achievements/award/bulk", json={"tier_code": "matches_played_1", "user_ids": [u["id"] for u in users], "silent": True, "notify": False, "earned_at": "2026-09-01T18:00:00+00:00"})
    assert res.status_code == 200 and res.json()["awarded"] == 3
    assert await flow.db.achievement_outbox.count_documents({}) == 0
    docs = await flow.db.user_achievements.find({"tier_code": "matches_played_1"}, {"_id": 0}).to_list(10)
    assert all(d["silent"] is True and d["earned_at"].startswith("2026-09-01") and d["context"]["bulk"] is True for d in docs)
    assert (await flow.post("/api/admin/achievements/award/bulk", json={"tier_code": "matches_played_2", "user_ids": [users[0]["id"]], "earned_at": "2099-01-01T00:00:00+00:00"})).status_code == 400


async def _season_world(flow, count=12):
    """Eine laufende Saison mit einem Turnier; jede Person hat dort Punkte - die erste die meisten."""
    users = [await flow.add_user(name=f"fahrer{i:02d}") for i in range(count)]
    await flow.db.seasons.insert_one({"id": "s1", "name": "Herbst", "status": "active", "start_date": "2026-09-01T00:00:00+00:00", "tournament_ids": ["t1"], "f1_challenge_ids": []})
    await flow.db.season_points.insert_many([
        {"id": new_id(), "season_id": "s1", "user_id": u["id"], "total_points": float(100 - i), "raw_points": float(100 - i), "rank": i + 1, "source_type": "tournament", "source_id": "t1"}
        for i, u in enumerate(users)
    ])
    return users


@pytest.mark.asyncio
async def test_saison_vorschau_zeigt_je_platz_was_der_abschluss_vergibt(flow):
    admin = await _superadmin(flow)
    users = await _season_world(flow)
    flow.act_as(admin)
    preview = (await flow.get("/api/admin/achievements/season/s1/preview")).json()
    assert preview["finished"] is False and preview["ranked"] == 12
    by_rank = {row["rank"]: {a["code"] for a in row["awards"]} for row in preview["standings"]}
    assert {"season_champion_1", "season_top10_1", "season_complete_1"} <= by_rank[1]
    assert "season_champion_1" not in by_rank[2] and "season_top10_1" in by_rank[10]
    assert by_rank[11] == {"season_complete_1"}, "Platz 11: nur die volle Saison"
    assert preview["awards_total"] == sum(len(v) for v in by_rank.values())
    assert preview["mvp"]["code"] == "season_mvp_1" and preview["mvp"]["holders"] == []
    assert await flow.db.season_standings.count_documents({}) == 0 and await flow.db.user_achievements.count_documents({}) == 0, "die Vorschau schreibt nichts"

    # Mitten in der Saison kein Abschluss von Hand - der wird in der Jahreswertung gemacht.
    res = await flow.post("/api/admin/achievements/season/s1/award")
    assert res.status_code == 400 and "Jahreswertung" in res.json()["detail"]
    await flow.db.seasons.update_one({"id": "s1"}, {"$set": {"status": "completed"}})
    res = await flow.post("/api/admin/achievements/season/s1/award")
    assert res.status_code == 200, res.text
    for row in preview["standings"]:
        held = set(await flow.db.user_achievements.distinct("tier_code", {"user_id": row["user_id"], "tier_code": {"$regex": "^season_(champion|top10|complete)_"}}))
        expected = {a["code"] for a in row["awards"]}
        assert held == expected, f"Platz {row['rank']}: vergeben {held}, angekündigt {expected}"
    after = (await flow.get("/api/admin/achievements/season/s1/preview")).json()
    assert after["finished"] is True and after["already_written"] is True and after["awards_total"] == 0, "nach dem Abschluss ist nichts mehr offen"
    assert users


@pytest.mark.asyncio
async def test_katalog_aenderungen_im_protokoll_und_material_nur_zwischen_den_nachbarn(flow):
    admin = await _superadmin(flow)
    anna = await flow.add_user(name="anna")
    flow.act_as(admin)
    res = await flow.post("/api/admin/achievements/groups", json={"code": "lan_helfer", "name": "LAN-Helfer", "category": "special", "description": "Hilft bei der LAN.", "how_to": "Mit anpacken.", "art": "toolbox"})
    assert res.status_code == 200 and res.json()["art"] == "toolbox"
    assert (await flow.patch("/api/admin/achievements/groups/lan_helfer", json={"art": "wrench", "how_to": "Auf- und Abbau."})).json()["art"] == "wrench"
    assert (await flow.post("/api/admin/achievements/tiers", json={"code": "lan_helfer_1", "group_code": "lan_helfer", "material": "legendary", "name": "LAN-Helfer I", "description": "Dabei.", "manual_only": True})).status_code == 200
    assert (await flow.patch("/api/admin/achievements/tiers/lan_helfer_1", json={"material": "gold"})).status_code == 400, "Legendär wechselt nicht in die Leiter"

    # Spielmacher hat Holz bis Diamant: Bronze darf nicht über Silber springen und nicht auf Legendär.
    assert (await flow.patch("/api/admin/achievements/tiers/matches_played_3", json={"material": "gold"})).status_code == 400
    assert (await flow.patch("/api/admin/achievements/tiers/matches_played_3", json={"material": "legendary"})).status_code == 400
    # Saisonstart hat Silber, Gold, Diamant: Gold darf auf Platin (zwischen den Nachbarn), nicht auf Diamant.
    moved = await flow.patch("/api/admin/achievements/tiers/season_opener_2", json={"material": "platinum"})
    assert moved.status_code == 200, moved.text
    assert moved.json()["rank"] == 6 and moved.json()["material_name"] == "Platin"
    clash = await flow.patch("/api/admin/achievements/tiers/season_opener_2", json={"material": "diamond"})
    assert clash.status_code == 400 and "Nachbarstufen" in clash.json()["detail"]

    assert (await flow.delete("/api/admin/achievements/tiers/lan_helfer_1")).status_code == 200
    assert (await flow.delete("/api/admin/achievements/groups/lan_helfer")).status_code == 200
    types = (await flow.get("/api/admin/achievements/incident-types")).json()
    incident = await flow.post("/api/admin/achievements/trigger-incident", json={"user_id": anna["id"], "incident_type": types[0]["key"], "note": "Testvorfall"})
    assert incident.status_code == 200 and incident.json()["newly_awarded"] is True
    assert (await flow.post("/api/admin/achievements/evaluation/all")).status_code == 200
    kinds = [e["kind"] for e in (await flow.get("/api/admin/achievements/events")).json()]
    assert kinds == ["evaluate_all", "incident", "group_delete", "tier_delete", "tier_update", "tier_create", "group_update", "group_create"], kinds
    group_update = next(e for e in (await flow.get("/api/admin/achievements/events?kind=group_update")).json())
    assert group_update["actor_name"] == "chef" and group_update["data"]["fields"] == ["art", "how_to"]


@pytest.mark.asyncio
async def test_pruefung_nennt_namen_und_die_uebersicht_sagt_wer_vorstand_ist(flow):
    admin = await _superadmin(flow)
    staff = await flow.add_user(role="club_admin", name="turnierleitung")
    await flow.db.achievement_groups.insert_one({"code": "ohne_text", "id": "ohne_text", "name": "Stille Gruppe", "category": "special", "public": True})
    await flow.db.achievements.insert_one({"code": "ohne_text_1", "id": "ohne_text_1", "group_code": "ohne_text", "name": "Stille Stufe", "points": 10, "material": "gold", "rank": 5, "manual_only": True})
    flow.act_as(admin)
    check = (await flow.get("/api/admin/achievements/catalog/check")).json()
    messages = {f["code"]: f["message"] for f in check["errors"] if f.get("group") == "ohne_text"}
    assert messages["group_description_missing"] == "Gruppe „Stille Gruppe“ hat keine Beschreibung."
    assert messages["tier_description_missing"] == "Stufe „Stille Stufe“ hat keine Beschreibung."
    assert all("ohne_text" not in m for m in messages.values()), "Namen statt Schlüssel"
    assert (await flow.get("/api/admin/achievements/me")).json() == {"board": True}
    flow.act_as(staff)
    assert (await flow.get("/api/admin/achievements/me")).json() == {"board": False}


@pytest.mark.asyncio
async def test_erfolge_einer_person_fuer_die_ruecknahme(flow):
    admin = await _superadmin(flow)
    anna = await flow.add_user(name="anna")
    flow.act_as(admin)
    await flow.post("/api/admin/achievements/award", json={"user_id": anna["id"], "tier_code": "matches_played_1", "note": "LAN", "silent": True})
    types = (await flow.get("/api/admin/achievements/incident-types")).json()
    await flow.post("/api/admin/achievements/trigger-incident", json={"user_id": anna["id"], "incident_type": types[0]["key"]})
    rows = (await flow.get(f"/api/admin/achievements/users/{anna['id']}/awards")).json()
    by_code = {r["tier_code"]: r for r in rows}
    played = by_code["matches_played_1"]
    assert played["tier_name"] and played["group_name"] == "Spielmacher" and played["material"] == "wood" and played["silent"] is True and played["note"] == "LAN"
    assert by_code[types[0]["tier_code"]]["is_negative"] is True
    negative = (await flow.get("/api/admin/achievements/negative/awards")).json()
    assert negative[0]["material"] and "art" in negative[0]
    assert (await flow.get("/api/admin/achievements/users/niemand/awards")).status_code == 404
