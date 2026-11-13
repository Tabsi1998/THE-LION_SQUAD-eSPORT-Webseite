"""Erfolge, Randfälle im Admin und in der öffentlichen Sicht (#932) - durch die echte Anwendung statt gegen einen laufenden Server.

- Der öffentliche Katalog zeigt Gästen keine negative Gruppe, die Stufen hängen an ihrer Gruppe.
- Rechte und Fehler im Admin: Gast 401, Seed-Gruppe nicht löschbar, unbekannte Stufe/Saison/Person 404, unbekannter Vorfall 400.
- Ein Dispute vergibt „neg_dispute“ - über den Vorfall-Trigger und über den echten Hook beim Öffnen eines Disputes.
- Die Personensuche für die Einzelvergabe findet über Benutzername und E-Mail.
- Der Discord-Zähler im Admin: hochzählen mit Protokoll, Liste, 404, und die Stufe „Discord-Stimme“ folgt.
- Die öffentliche Spielerliste trägt Vollständigkeit, Zahl der Erfolge und den Top-Erfolg.

Ersetzt test_phase_b_v4_achievements.py::test_groups_anonymous_excludes_negative, ::test_delete_system_group_blocked,
::test_award_unknown_tier, ::test_user_404_unknown, ::test_admin_groups_unauthorized, ::test_search_admin;
test_phase_c_iter16.py::test_trigger_incident_invalid_type, ::test_unknown_season,
::test_public_list_has_completeness_and_top_achievement; test_phase_ef_iter17.py::test_dispute_hook_creates_neg_dispute und
TestDiscordCounter (test_bump_counter_persists_and_audit, test_counters_list_contains_user, test_discord_active_b_auto_awarded,
test_bump_unknown_user_404). Erfundene Daten, keine echten Personen.
"""
import pathlib
import sys

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


async def _negative_awards_of(flow, user_id):
    res = await flow.get("/api/admin/achievements/negative/awards")
    assert res.status_code == 200, res.text
    return [row for row in res.json() if row["user_id"] == user_id]


@pytest.mark.asyncio
async def test_gast_sieht_keine_negative_gruppe_und_die_stufen_haengen_an_der_gruppe(flow):
    assert await flow.db.achievement_groups.count_documents({"is_negative": True}) > 0, "der Katalog hat negative Gruppen"
    flow.act_as(None)
    res = await flow.get("/api/achievements/groups")
    assert res.status_code == 200, res.text
    groups = res.json()
    assert len(groups) > 30
    assert [g["code"] for g in groups if g.get("is_negative")] == []
    assert not any(g["code"].startswith("neg_") for g in groups)
    played = next(g for g in groups if g["code"] == "matches_played")
    assert played["tiers"] and all(t["group_code"] == "matches_played" for t in played["tiers"])

    unknown = await flow.get("/api/achievements/user/gibt-es-nicht")
    assert unknown.status_code == 404


@pytest.mark.asyncio
async def test_admin_rechte_und_fehlerfaelle(flow):
    admin = await _superadmin(flow)
    anna = await flow.add_user(name="anna")

    flow.act_as(None)
    guest = await flow.get("/api/admin/achievements/groups")
    assert guest.status_code == 401

    flow.act_as(admin)
    seeded = await flow.db.achievement_groups.find_one({"code": "matches_played"}, {"_id": 0})
    assert seeded and not seeded.get("is_admin_created")
    blocked = await flow.delete("/api/admin/achievements/groups/matches_played")
    assert blocked.status_code == 400 and "System-Group" in blocked.json()["detail"]
    assert await flow.db.achievement_groups.find_one({"code": "matches_played"}) is not None
    assert await flow.db.achievements.count_documents({"group_code": "matches_played"}) > 0, "die Stufen bleiben"

    unknown_tier = await flow.post("/api/admin/achievements/award", json={"user_id": anna["id"], "tier_code": "gibt_es_nicht_1"})
    assert unknown_tier.status_code == 404

    unknown_incident = await flow.post("/api/admin/achievements/trigger-incident", json={"user_id": anna["id"], "incident_type": "does_not_exist"})
    assert unknown_incident.status_code == 400 and "Unbekannter Vorfall-Typ" in unknown_incident.json()["detail"]
    assert await flow.db.user_achievements.count_documents({"user_id": anna["id"]}) == 0

    unknown_season = await flow.post("/api/admin/achievements/season/gibt-es-nicht/award")
    assert unknown_season.status_code == 404


@pytest.mark.asyncio
async def test_vorfall_dispute_open_vergibt_neg_dispute(flow):
    admin = await _superadmin(flow)
    anna = await flow.add_user(name="anna")
    flow.act_as(admin)
    assert await _negative_awards_of(flow, anna["id"]) == []
    res = await flow.post("/api/admin/achievements/trigger-incident", json={"user_id": anna["id"], "incident_type": "dispute_open", "note": "Testvorfall"})
    assert res.status_code == 200, res.text
    assert res.json() == {"ok": True, "tier_code": "neg_dispute", "newly_awarded": True}
    rows = await _negative_awards_of(flow, anna["id"])
    assert [r["tier_code"] for r in rows] == ["neg_dispute"]
    assert rows[0]["username"] == "anna" and rows[0]["context"]["note"] == "Testvorfall"


@pytest.mark.asyncio
async def test_ein_echter_dispute_vergibt_neg_dispute_ueber_den_hook(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(4)
    drawn = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert drawn.status_code == 200, drawn.text
    await flow.start(tournament)
    match = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))[0]
    first = match["slots"][0]["registration_id"]
    player = next(users[i] for i, reg in enumerate(registrations) if reg["id"] == first)

    flow.act_as(player)
    opened = await flow.post(f"/api/matches/{match['id']}/dispute", json={"reason": "Ergebnis stimmt nicht"})
    assert opened.status_code == 200, opened.text

    flow.act_as(staff)
    rows = await _negative_awards_of(flow, player["id"])
    assert [r["tier_code"] for r in rows] == ["neg_dispute"]
    assert rows[0]["context"]["match_id"] == match["id"]


@pytest.mark.asyncio
async def test_personensuche_findet_ueber_benutzername_und_email(flow):
    admin = await _superadmin(flow)
    lena = await flow.add_user(name="lena-sucht")
    await flow.add_user(name="ganz-anders")
    flow.act_as(admin)
    by_name = await flow.get("/api/admin/achievements/users/search?q=LENA-such")
    assert by_name.status_code == 200, by_name.text
    assert [u["id"] for u in by_name.json()] == [lena["id"]]
    assert by_name.json()[0]["email"] == lena["email"]
    by_mail = await flow.get("/api/admin/achievements/users/search", params={"q": lena["email"].split("@")[0]})
    assert [u["id"] for u in by_mail.json()] == [lena["id"]]


@pytest.mark.asyncio
async def test_discord_zaehler_im_admin_mit_protokoll_liste_und_stufe(flow):
    admin = await _superadmin(flow)
    paula = await flow.add_user(name="paula")
    flow.act_as(admin)

    bumped = await flow.post(f"/api/admin/discord/counter/{paula['id']}", json={"delta": 1})
    assert bumped.status_code == 200, bumped.text
    assert bumped.json()["discord_messages_count"] == 1
    again = await flow.post(f"/api/admin/discord/counter/{paula['id']}", json={"delta": 2})
    assert again.json()["discord_messages_count"] == 3
    assert (await flow.db.users.find_one({"id": paula["id"]}))["discord_messages_count"] == 3
    logs = await flow.db.audit_logs.find({"action": "discord.counter_bump", "target_id": paula["id"]}, {"_id": 0}).to_list(10)
    assert sorted(row["data"]["new_total"] for row in logs) == [1, 3]
    assert all(row["actor_id"] == admin["id"] for row in logs)

    listed = await flow.get("/api/admin/discord/counters")
    assert listed.status_code == 200
    assert {row["id"]: row["discord_messages_count"] for row in listed.json()} == {paula["id"]: 3}

    held = await flow.db.user_achievements.distinct("tier_code", {"user_id": paula["id"], "group_code": "discord_messages"})
    assert held and all(code.startswith("discord_messages_") for code in held), "die erste Stufe „Discord-Stimme“ folgt dem Zähler"

    unknown = await flow.post("/api/admin/discord/counter/gibt-es-nicht", json={"delta": 1})
    assert unknown.status_code == 404


@pytest.mark.asyncio
async def test_spielerliste_traegt_vollstaendigkeit_zahl_und_top_erfolg(flow):
    anna = await flow.add_user(name="anna")
    await flow.db.users.update_one({"id": anna["id"]}, {"$set": {"privacy_public_profile": True}})
    for code in ("matches_played_1", "matches_played_2", "neg_dispute"):
        awarded = await badges.award_achievement(anna["id"], code)
        assert awarded, code
    flow.act_as(None)
    res = await flow.get("/api/users/public-list")
    assert res.status_code == 200, res.text
    row = next(r for r in res.json() if r["id"] == anna["id"])
    assert isinstance(row["profile_completeness"], int) and 0 <= row["profile_completeness"] <= 100
    assert row["achievements_count"] == 2, "ohne die negative Stufe"
    top = row["top_achievement"]
    tier = await flow.db.achievements.find_one({"code": "matches_played_2"}, {"_id": 0})
    assert top["code"] == "matches_played_2" and top["name"] == tier["name"] and top["level"] == tier["level"]
    assert top["level_name"] and top["level_color"].startswith("#")
