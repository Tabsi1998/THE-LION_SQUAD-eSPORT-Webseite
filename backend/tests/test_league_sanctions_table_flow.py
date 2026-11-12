"""E.3 Strafen mit Wirkung auf die Tabelle (docs/LIGA.md „E.3 Strafen“): Punktabzug und Disqualifikation über die echten Routen,
gelesen auf Ligaseite und Turnierseite - und der Widerruf, der beides zurücknimmt. Nur erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402

ADMIN = "/api/admin/leagues"
PAGE = "/api/leagues/probe-shooter/season-1"
SEASON = {"start_date": "2026-11-10T00:00:00", "visibility": "public", "readiness_override_reason": "Testaufbau ohne Prüfung"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow, teams: int = 4) -> dict:
    """Liga, Season, Liga N und eine laufende Staffel mit vier Co-Teams - angelegt wie in der Verwaltung."""
    admin = await flow.add_staff()
    flow.act_as(admin)
    game = (await flow.post("/api/games", json={"name": "Probe Shooter", "slug": "probe-shooter"})).json()
    league = (await flow.post(ADMIN, json={"name": "Probe-Liga", "game_id": game["id"]})).json()
    season = (await flow.post(f"{ADMIN}/{league['id']}/seasons", json=SEASON)).json()
    division = (await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json={})).json()
    created = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()
    staffel = await flow.db.tournaments.find_one({"id": created["tournament_id"]}, {"_id": 0})
    for index in range(1, teams + 1):
        captain = await flow.add_user(name=f"Captain {index}")
        await flow.db.teams.insert_one({"id": f"team-{index}", "name": f"Probe {index}", "leader_id": captain["id"], "member_ids": [captain["id"]]})
        await flow.db.team_squads.insert_one({"id": f"squad-{index}", "team_id": f"team-{index}", "name": f"Probe {index}", "status": "active",
                                              "captain_id": captain["id"], "member_ids": [captain["id"]]})
        await flow.db.tournament_registrations.insert_one({
            "id": f"reg-{index}", "tournament_id": staffel["id"], "team_id": f"team-{index}", "squad_id": f"squad-{index}", "status": "approved",
            "registration_type": "team", "display_name": f"Probe {index}", "identity_key": f"{staffel['id']}:team:team-{index}",
            "league_squad_key": f"{season['id']}:squad-{index}"})
    started = await flow.post(f"/api/tournaments/{staffel['id']}/status", json={"status": "live"})
    assert started.status_code == 200, started.text
    second = await flow.add_staff(name="Zweitleitung")
    return {"admin": admin, "second": second, "league": league, "season": season, "staffel": staffel,
            "url": f"{ADMIN}/seasons/{season['id']}/sanctions"}


async def matches_of(flow, staffel, round_number=None):
    query = {"tournament_id": staffel["id"], "is_preview": {"$ne": True}}
    if round_number is not None:
        query["round"] = round_number
    return await flow.db.matches_v2.find(query, {"_id": 0}).sort("order", 1).to_list(100)


async def play_round(flow, staffel, round_number: int = 1) -> None:
    """Jedes Spiel des Spieltags 2:1 für die Heimseite."""
    for match in await matches_of(flow, staffel, round_number):
        home, away = [slot["registration_id"] for slot in match["slots"]]
        await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {
            "status": "completed", "completed_at": now_utc().isoformat(),
            "results": [{"registration_id": home, "rank": 1, "score": 2}, {"registration_id": away, "rank": 2, "score": 1}]}})


async def rows(flow, staffel) -> dict:
    flow.act_as(None)
    response = await flow.get(f"{PAGE}/staffeln/{staffel['slug']}")
    assert response.status_code == 200, response.text
    return {row["registration_id"]: row for row in response.json()["standings"]}


async def issue(flow, world, actor: str = "admin", **body):
    flow.act_as(world[actor])
    return await flow.post(world["url"], json={"rule_ref": "Anlage C.4", "reason": "Die Leitung hat den Fall geprüft.", **body})


@pytest.mark.asyncio
async def test_a_point_deduction_shows_in_the_table_everywhere_and_the_revoke_takes_it_back(flow):
    world = await setup(flow)
    staffel = world["staffel"]
    await play_round(flow, staffel)
    before = await rows(flow, staffel)
    winner = next(reg_id for reg_id, row in before.items() if row["won"] == 1)
    assert before[winner]["deducted_points"] == 0

    assert (await issue(flow, world, kind="point_deduction", target_type="squad", registration_id=winner)).status_code == 422, "ohne Höhe"
    assert (await issue(flow, world, kind="point_deduction", target_type="squad", registration_id=winner, points=0)).status_code == 422
    issued = await issue(flow, world, kind="point_deduction", target_type="squad", registration_id=winner, points=2)
    assert issued.status_code == 200, issued.text
    sanction = issued.json()
    assert sanction["period"] == "2 Punkte Abzug"

    after = await rows(flow, staffel)
    assert after[winner]["deducted_points"] == 2 and after[winner]["points"] == before[winner]["points"] - 2
    # Gegenprobe: Die anderen Zeilen ändern ihre Punkte nicht.
    assert all(after[reg_id]["points"] == row["points"] for reg_id, row in before.items() if reg_id != winner)
    # Web (Ligaseite), Turnierseite und TV lesen dieselbe Tabelle.
    turnier = {row["registration_id"]: row for row in (await flow.get(f"/api/tournaments/{staffel['id']}/standings")).json()}
    assert turnier[winner]["deducted_points"] == 2 and turnier[winner]["points"] == after[winner]["points"]
    # Den Grund zeigt die Tabelle nicht öffentlich.
    assert "geprüft" not in str(after[winner]) and "Anlage" not in str(after[winner])

    flow.act_as(world["admin"])
    revoked = await flow.post(f"{world['url']}/{sanction['id']}/revoke", json={"reason": "Abzug war ein Irrtum."})
    assert revoked.status_code == 200, revoked.text
    back = await rows(flow, staffel)
    assert back[winner]["deducted_points"] == 0 and back[winner]["points"] == before[winner]["points"]
    stored = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0, "point_deductions": 1})
    assert stored.get("point_deductions") == []


@pytest.mark.asyncio
async def test_a_disqualification_follows_the_exit_rule_and_the_revoke_restores_the_team(flow):
    """Nr. 11c, 43: alle Spiele zählen für die Gegner, das Team steht am Tabellenende - der Widerruf nimmt es zurück."""
    world = await setup(flow)
    staffel = world["staffel"]
    await play_round(flow, staffel)
    before = await rows(flow, staffel)
    winner = next(reg_id for reg_id, row in before.items() if row["won"] == 1)
    open_before = [m["id"] for m in await matches_of(flow, staffel) if winner in [s["registration_id"] for s in m["slots"]] and m["status"] != "completed"]
    assert open_before

    issued = await issue(flow, world, kind="disqualification", target_type="squad", registration_id=winner)
    assert issued.status_code == 200, issued.text
    sanction = issued.json()
    registration = await flow.db.tournament_registrations.find_one({"id": winner}, {"_id": 0})
    assert registration["status"] == "disqualified" and "league_squad_key" not in registration
    after = await rows(flow, staffel)
    assert after[winner]["exit"]["kind"] == "disqualified" and after[winner]["rank"] == len(after), "Tabellenende"
    assert after[winner]["points"] == 0, "auch das gespielte Spiel zählt für den Gegner"
    forfeited = await flow.db.matches_v2.find({"id": {"$in": open_before}}, {"_id": 0}).to_list(20)
    assert {m["status"] for m in forfeited} == {"forfeit"}
    assert (await issue(flow, world, kind="disqualification", target_type="squad", registration_id=winner)).status_code == 409, "nur einmal"

    flow.act_as(world["admin"])
    revoked = await flow.post(f"{world['url']}/{sanction['id']}/revoke", json={"reason": "Vorwurf hat sich nicht bestätigt."})
    assert revoked.status_code == 200, revoked.text
    registration = await flow.db.tournament_registrations.find_one({"id": winner}, {"_id": 0})
    assert registration["status"] == "approved" and "removal" not in registration
    assert registration["league_squad_key"] == f"{world['season']['id']}:{registration['squad_id']}"
    reopened = await flow.db.matches_v2.find({"id": {"$in": open_before}}, {"_id": 0}).to_list(20)
    assert {m["status"] for m in reopened} <= {"ready", "scheduled"} and all(not m.get("results") for m in reopened)
    assert all(not m.get("forfeit_registration_id") for m in reopened)
    back = await rows(flow, staffel)
    assert "exit" not in back[winner] or not back[winner]["exit"]
    assert back[winner]["points"] == before[winner]["points"] and back[winner]["rank"] == before[winner]["rank"]
    assert {reg_id: row["points"] for reg_id, row in back.items()} == {reg_id: row["points"] for reg_id, row in before.items()}


@pytest.mark.asyncio
async def test_a_granted_appeal_takes_the_deduction_back_and_a_locked_staffel_refuses(flow):
    world = await setup(flow)
    staffel = world["staffel"]
    await play_round(flow, staffel)
    issued = await issue(flow, world, kind="point_deduction", target_type="squad", registration_id="reg-1", points=3)
    sanction = issued.json()
    captain = await flow.db.users.find_one({"display_name": "Captain 1"}, {"_id": 0})
    flow.act_as(captain)
    filed = await flow.post(f"/api/penalties/sanctions/{sanction['id']}/appeal", json={"text": "Der Abzug trifft das falsche Team."})
    assert filed.status_code == 200, filed.text
    assert (await rows(flow, staffel))["reg-1"]["deducted_points"] == 3, "die Strafe gilt bis zur Entscheidung"

    flow.act_as(world["admin"])
    own = await flow.post(f"{world['url']}/{sanction['id']}/appeal/decision", json={"decision": "granted", "note": "Ich nehme es zurück."})
    assert own.status_code == 403
    flow.act_as(world["second"])
    granted = await flow.post(f"{world['url']}/{sanction['id']}/appeal/decision", json={"decision": "granted", "note": "Verwechslung belegt."})
    assert granted.status_code == 200, granted.text
    assert (await rows(flow, staffel))["reg-1"]["deducted_points"] == 0

    # Eine gesperrte Staffel nimmt keinen Punktabzug an.
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"locked_at": now_utc().isoformat()}})
    locked = await issue(flow, world, kind="point_deduction", target_type="squad", registration_id="reg-2", points=1)
    assert locked.status_code == 423, locked.text
    assert await flow.db.competition_sanctions.count_documents({"registration_id": "reg-2"}) == 0


@pytest.mark.asyncio
async def test_reason_and_issuer_of_a_sanction_never_reach_public_tournament_views(flow):
    """Das Turnier-Dokument ist öffentlich lesbar: Grund, Regelverstoß und wer verhängt hat, stehen dort nicht."""
    world = await setup(flow)
    staffel = world["staffel"]
    await play_round(flow, staffel)
    deduction = await issue(flow, world, kind="point_deduction", target_type="squad", registration_id="reg-1", points=2,
                            rule_ref="Paragraf 13 Beleidigung im Chat")
    assert deduction.status_code == 200, deduction.text
    banned = await issue(flow, world, kind="disqualification", target_type="squad", registration_id="reg-2",
                         rule_ref="Matchabsprache Spieltag 1")
    assert banned.status_code == 200, banned.text
    captain = await flow.db.users.find_one({"display_name": "Captain 1"}, {"_id": 0})
    secrets = ("Beleidigung", "Matchabsprache", "geprüft", deduction.json()["id"])
    for viewer in (None, captain):
        flow.act_as(viewer)
        for url in (f"/api/tournaments/{staffel['id']}", "/api/tournaments", f"/api/tournaments/{staffel['id']}/registrations",
                    f"/api/tournaments/{staffel['id']}/standings", f"{PAGE}/staffeln/{staffel['slug']}"):
            answer = await flow.get(url)
            assert answer.status_code == 200, (url, answer.text)
            for secret in secrets:
                assert secret not in answer.text, (url, secret)
        single = (await flow.get(f"/api/tournaments/{staffel['id']}")).json()
        assert "point_deductions" not in single and "table_decisions" not in single
    # Die Tabelle zeigt den Abzug weiter, und das Ausscheiden nennt öffentlich nur, dass es eine Strafe ist.
    assert (await rows(flow, staffel))["reg-1"]["deducted_points"] == 2
    removal = (await flow.db.tournament_registrations.find_one({"id": "reg-2"}, {"_id": 0}))["removal"]
    assert removal["reason"] == "Strafe der Liga-Leitung"
    # Gegenprobe: Die Leitung liest die Einträge am Turnier weiter - ohne Grund und ohne Person.
    flow.act_as(world["admin"])
    lead = (await flow.get(f"/api/tournaments/{staffel['id']}")).json()
    assert [sorted(row) for row in lead["point_deductions"]] == [["created_at", "id", "points", "registration_id", "sanction_id", "source"]]
