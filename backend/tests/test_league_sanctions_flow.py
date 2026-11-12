"""E.3 Strafen (docs/LIGA.md „E.3 Strafen“): Sperre, Punktabzug, Disqualifikation, Widerruf, Einspruch und Befangenheit - über
die echten Routen. Jede Regel mit Gegenprobe. Nur erfundene Namen.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import OLD_RULES, ids, world as league_world  # noqa: E402
from models import now_utc  # noqa: E402
from services import league_eligibility, league_sanction_bans, league_sanctions, match_proof_retention  # noqa: E402
from services.match_flow import DEFAULTS  # noqa: E402

ADMIN = "/api/admin/leagues"
RULES = {**DEFAULTS, "min_present": 2}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def at(minutes: float = 0, **delta) -> str:
    return (now_utc() + timedelta(minutes=minutes, **delta)).replace(microsecond=0).isoformat()


async def lead_of(flow, name: str, *capabilities: str) -> dict:
    user = await flow.add_user(name=name)
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": "liga", "user_id": user["id"],
                                           "capabilities": list(capabilities), "created_at": now_utc().isoformat()})
    return user


async def sanction_world(flow) -> dict:
    """Die Spielwelt (zwei Co-Teams, ein Spiel jetzt, Check-in-Regeln) mit Season-Zeile und zwei Personen mit „Strafen“."""
    world = await league_world(flow)
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"checkin_rules": dict(RULES)}})
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {"scheduled_at": at(0), "status": "scheduled"}})
    await flow.db.leagues.insert_one({"id": "liga", "name": "Probe-Liga", "slug": "probe-liga", "game_id": "probe-shooter"})
    await flow.db.league_seasons.insert_one({
        "id": world["season_id"], "league_id": "liga", "name": "Season 1", "slug": "season-1", "status": "running",
        "start_date": (now_utc() - timedelta(days=7)).date().isoformat() + "T00:00:00", "weeks_total": 10, "matchday_days": 7, **OLD_RULES})
    world["lead"] = await lead_of(flow, "Strafleitung", "sanctions", "matches", "results")
    world["second"] = await lead_of(flow, "Zweitleitung", "sanctions")
    world["url"] = f"{ADMIN}/seasons/{world['season_id']}/sanctions"
    return world


def uid(world, name: str) -> str:
    return world["users"][name]["id"]


async def issue(flow, world, actor: str = "lead", **body):
    flow.act_as(world[actor] if actor in world else world["users"][actor])
    payload = {"rule_ref": "Anlage C.4", "reason": "Nachweis liegt der Leitung vor.", **body}
    return await flow.post(world["url"], json=payload)


async def ban(flow, world, name: str = "Mila", **body):
    return await issue(flow, world, kind="player_ban", target_type="player", user_id=uid(world, name), **body)


async def checkin(flow, world, user: str, *names: str):
    flow.act_as(world["users"][user])
    return await flow.post(f"/api/matches/{world['match']['id']}/checkin", json={"present": ids(world, *names)})


async def revoke(flow, world, sanction_id: str, actor: str = "lead", reason: str = "Irrtum der Leitung, Fall geprüft."):
    flow.act_as(world[actor])
    return await flow.post(f"{world['url']}/{sanction_id}/revoke", json={"reason": reason})


async def eligibility(flow, world, name: str, squad: str = "squad_a", match: dict | None = None) -> dict:
    tournament = await flow.db.tournaments.find_one({"id": world["tournament"]["id"]}, {"_id": 0})
    ctx = await league_eligibility.context_for_tournament(flow.db, tournament, [uid(world, name)], match=match)
    return league_eligibility.status(ctx, uid(world, name), world[squad]["id"])


# ---------------------------------------------------------------- Sperre


@pytest.mark.asyncio
async def test_a_ban_blocks_checkin_and_lineup_and_the_revoke_gives_both_back(flow):
    world = await sanction_world(flow)
    # Gegenprobe: ohne Strafe ist Mila spielberechtigt.
    assert (await eligibility(flow, world, "Mila"))["ok"] is True

    issued = await ban(flow, world, ends_at=at(days=14))
    assert issued.status_code == 200, issued.text
    sanction = issued.json()
    assert sanction["status"] == "active" and sanction["state"] == "final" and sanction["kind_label"] == "Spielsperre"

    state = await eligibility(flow, world, "Mila")
    assert state["state"] == "sanctioned" and state["ok"] is False and "Gesperrt durch die Liga-Leitung bis" in state["reason"]
    assert "Nachweis" not in state["reason"] and "Anlage" not in state["reason"], "der Satz nennt weder Verstoß noch Begründung"
    refused = await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")
    assert refused.status_code == 422 and "Mila" in refused.json()["detail"] and "Gesperrt" in refused.json()["detail"]
    # Die Aufstellung (Teilnehmerliste) läuft über dieselbe Prüfung des Spiels.
    lineup = await eligibility(flow, world, "Mila", match=await flow.reload(world["match"]))
    assert lineup["ok"] is False
    # Die anderen bleiben spielberechtigt.
    assert (await eligibility(flow, world, "Tom"))["ok"] is True

    short = await revoke(flow, world, sanction["id"], reason="nö")
    assert short.status_code == 422
    revoked = await revoke(flow, world, sanction["id"])
    assert revoked.status_code == 200 and revoked.json()["status"] == "revoked", revoked.text
    assert (await eligibility(flow, world, "Mila"))["ok"] is True
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")).status_code == 200
    again = await revoke(flow, world, sanction["id"])
    assert again.status_code == 409


@pytest.mark.asyncio
async def test_a_ban_needs_a_reason_a_rule_and_exactly_one_kind_of_period(flow):
    world = await sanction_world(flow)
    assert (await ban(flow, world, ends_at=at(days=3), reason="kurz")).status_code == 422
    assert (await ban(flow, world, ends_at=at(days=3), rule_ref=" ")).status_code == 422
    assert (await ban(flow, world)).status_code == 422, "weder Spiele noch Ende"
    assert (await ban(flow, world, matches=1, ends_at=at(days=3))).status_code == 422, "beides"
    assert (await ban(flow, world, matches=0)).status_code == 422, "mindestens ein Liga-Spiel (Nr. 101)"
    # Nr. 101: höchstens bis zum Ende der laufenden Season (10 Wochen ab Start).
    beyond = await ban(flow, world, ends_at=at(days=200))
    assert beyond.status_code == 422 and "Teamsperre" in beyond.json()["detail"]
    assert (await issue(flow, world, kind="player_ban", target_type="squad", registration_id=world["reg_a"]["id"], matches=1)).status_code == 422
    assert (await issue(flow, world, kind="erfunden", target_type="player", user_id=uid(world, "Mila"))).status_code == 422
    assert await flow.db.competition_sanctions.count_documents({}) == 0
    assert (await ban(flow, world, matches=1)).status_code == 200


@pytest.mark.asyncio
async def test_a_ban_by_matches_ends_after_the_team_played_them_and_keeps_the_banned_match_closed(flow):
    world = await sanction_world(flow)
    issued = await ban(flow, world, matches=1)
    assert issued.status_code == 200, issued.text
    assert issued.json()["period"] == "1 Liga-Spiel, noch 1"
    assert "für noch 1 Liga-Spiel" in (await eligibility(flow, world, "Mila"))["reason"]

    # Das Team spielt sein nächstes Liga-Spiel ohne Mila.
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {"status": "completed", "completed_at": at(1)}})
    played = await flow.reload(world["match"])
    assert (await eligibility(flow, world, "Mila"))["ok"] is True, "die Sperre ist abgesessen"
    # Gegenprobe: Im gesperrten Spiel selbst bleibt sie gesperrt - auch beim Nachtrag der Teilnehmerliste.
    assert (await eligibility(flow, world, "Mila", match=played))["ok"] is False
    flow.act_as(world["lead"])
    listed = (await flow.get(world["url"])).json()["items"][0]
    assert listed["status"] == "served" and listed["period"].endswith("abgesessen")


@pytest.mark.asyncio
async def test_a_provisional_ban_works_at_once_and_is_confirmed_with_a_period(flow):
    """Nr. 44: Die vorläufige Sperre wirkt sofort auf die Spielberechtigung und wird geprüft."""
    world = await sanction_world(flow)
    assert (await issue(flow, world, kind="warning", target_type="player", user_id=uid(world, "Mila"), state="provisional")).status_code == 422
    issued = await ban(flow, world, state="provisional")
    assert issued.status_code == 200, issued.text
    sanction = issued.json()
    assert sanction["status"] == "provisional" and sanction["can_appeal"] is False and sanction["appeal_until"] is None
    assert "Vorläufig gesperrt" in (await eligibility(flow, world, "Mila"))["reason"]

    flow.act_as(world["users"]["Mila"])
    early = await flow.post(f"/api/penalties/sanctions/{sanction['id']}/appeal", json={"text": "Ich war das nicht, bitte prüfen."})
    assert early.status_code == 409, "Einspruch erst gegen die endgültige Entscheidung"

    flow.act_as(world["lead"])
    assert (await flow.post(f"{world['url']}/{sanction['id']}/confirm", json={})).status_code == 422, "endgültig braucht einen Zeitraum"
    confirmed = await flow.post(f"{world['url']}/{sanction['id']}/confirm", json={"matches": 2})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["state"] == "final" and confirmed.json()["can_appeal"] is True and confirmed.json()["matches"] == 2
    assert (await flow.post(f"{world['url']}/{sanction['id']}/confirm", json={"matches": 2})).status_code == 409


@pytest.mark.asyncio
async def test_team_ban_exclusion_and_external_ban_block_the_squad_the_person_and_the_registration(flow):
    world = await sanction_world(flow)
    tournament = await flow.db.tournaments.find_one({"id": world["tournament"]["id"]}, {"_id": 0})
    members = world["squad_a"]["member_ids"]

    async def problems():
        ctx = await league_eligibility.context_for_tournament(flow.db, tournament, members)
        return league_eligibility.registration_problems(ctx, world["squad_a"])

    assert await problems() == [], "Gegenprobe: ohne Strafe spricht nichts gegen die Anmeldung"
    assert (await issue(flow, world, kind="team_ban", target_type="squad", registration_id=world["reg_a"]["id"])).status_code == 422, "braucht ein Ende"
    team = await issue(flow, world, kind="team_ban", target_type="squad", registration_id=world["reg_a"]["id"], ends_at=at(days=400))
    assert team.status_code == 200, team.text
    assert [code for code, _text in await problems()] == [403]
    assert (await eligibility(flow, world, "Tom"))["state"] == "sanctioned", "jede Person des Co-Teams"
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Tom")).status_code == 422
    # Die Gegenseite ist nicht betroffen.
    assert (await eligibility(flow, world, "Falke1", "horst"))["ok"] is True
    assert (await revoke(flow, world, team.json()["id"])).status_code == 200
    assert await problems() == [] and (await eligibility(flow, world, "Tom"))["ok"] is True

    # Externe Sperre (Nr. 104) und Ligaausschluss gelten in jeder Season der Liga.
    external = await issue(flow, world, kind="external", target_type="player", user_id=uid(world, "Tom"), rule_ref="Anlage C.6")
    assert external.status_code == 200, external.text
    other_season = await league_sanction_bans.bans(flow.db, "liga", "andere-season", [uid(world, "Tom"), uid(world, "Mila")])
    assert "Extern gesperrt" in other_season.users[uid(world, "Tom")]["reason"] and uid(world, "Mila") not in other_season.users
    other_league = await league_sanction_bans.bans(flow.db, "andere-liga", world["season_id"], [uid(world, "Tom")])
    assert other_league.users == {}
    # Gegenprobe: Eine Spielsperre gilt nur in ihrer Season.
    assert (await ban(flow, world, "Mila", matches=1)).status_code == 200
    assert uid(world, "Mila") not in (await league_sanction_bans.bans(flow.db, "liga", "andere-season", [uid(world, "Mila")])).users
    excluded = await issue(flow, world, kind="league_exclusion", target_type="player", user_id=uid(world, "Kapitaen"))
    assert excluded.status_code == 200 and "ausgeschlossen" in (await eligibility(flow, world, "Kapitaen"))["reason"]


@pytest.mark.asyncio
async def test_a_warning_is_recorded_without_any_effect(flow):
    world = await sanction_world(flow)
    for kind in ("warning", "yellow_card", "red_card"):
        answer = await issue(flow, world, kind=kind, target_type="player", user_id=uid(world, "Mila"))
        assert answer.status_code == 200, answer.text
    assert (await eligibility(flow, world, "Mila"))["ok"] is True
    lost = await issue(flow, world, kind="map_loss", target_type="squad", registration_id=world["reg_a"]["id"])
    assert lost.status_code == 422, "Map- und Spielverlust nennen das Spiel"
    lost = await issue(flow, world, kind="map_loss", target_type="squad", registration_id=world["reg_a"]["id"], match_id=world["match"]["id"])
    assert lost.status_code == 200 and lost.json()["match_id"] == world["match"]["id"]
    assert (await flow.reload(world["match"]))["status"] == "scheduled", "das Ergebnis ändert nur die Ergebniskorrektur"


# ---------------------------------------------------------------- Rechte und Befangenheit


@pytest.mark.asyncio
async def test_only_the_sanctions_right_may_read_and_issue(flow):
    world = await sanction_world(flow)
    other = await lead_of(flow, "Ergebnisleitung", "results", "disputes", "matches")
    for person in (other, world["users"]["Kapitaen"]):
        flow.act_as(person)
        assert (await flow.get(world["url"])).status_code == 403
        answer = await flow.post(world["url"], json={"kind": "warning", "target_type": "player", "user_id": uid(world, "Mila"),
                                                     "rule_ref": "§ 13", "reason": "Begründung der Leitung"})
        assert answer.status_code == 403
    flow.act_as(None)
    assert (await flow.get(world["url"])).status_code == 401
    assert await flow.db.competition_sanctions.count_documents({}) == 0


@pytest.mark.asyncio
async def test_the_own_side_cannot_issue_or_revoke_and_the_superadmin_only_with_a_reason(flow):
    world = await sanction_world(flow)
    # Tom steht im Kader von Rudel A und hat „Strafen“.
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": "liga", "user_id": uid(world, "Tom"), "capabilities": ["sanctions"]})
    world["tom"] = world["users"]["Tom"]
    team = await issue(flow, world, "tom", kind="warning", target_type="squad", registration_id=world["reg_a"]["id"])
    assert team.status_code == 403 and "eigenes Team" in team.json()["detail"]
    mate = await issue(flow, world, "tom", kind="player_ban", target_type="player", user_id=uid(world, "Mila"), matches=1)
    assert mate.status_code == 403
    himself = await issue(flow, world, "tom", kind="warning", target_type="player", user_id=uid(world, "Tom"))
    assert himself.status_code == 403
    # Gegenprobe: Die Gegenseite darf er strafen - außer die Strafe nennt ein Spiel, an dem er beteiligt ist.
    own_match = await issue(flow, world, "tom", kind="match_loss", target_type="squad", registration_id=world["reg_h"]["id"],
                            match_id=world["match"]["id"])
    assert own_match.status_code == 403
    foreign = await issue(flow, world, "tom", kind="warning", target_type="squad", registration_id=world["reg_h"]["id"])
    assert foreign.status_code == 200, foreign.text
    assert await flow.db.competition_sanctions.count_documents({}) == 1

    issued = await ban(flow, world, matches=1)
    flow.act_as(world["tom"])
    assert (await flow.post(f"{world['url']}/{issued.json()['id']}/revoke", json={"reason": "Mila ist unschuldig, sagt Tom."})).status_code == 403
    assert (await flow.get(world["url"])).json()["items"][0]["own_side"] is True

    # Superadmin im eigenen Team: nur als Notausnahme mit Grund, mit Protokoll.
    await flow.db.users.update_one({"id": uid(world, "Tom")}, {"$set": {"role": "superadmin"}})
    world["tom"] = {**world["users"]["Tom"], "role": "superadmin"}
    assert (await issue(flow, world, "tom", kind="warning", target_type="squad", registration_id=world["reg_a"]["id"])).status_code == 403
    forced = await issue(flow, world, "tom", kind="warning", target_type="squad", registration_id=world["reg_a"]["id"],
                         conflict_reason="Niemand sonst erreichbar")
    assert forced.status_code == 200, forced.text
    assert await flow.db.audit_logs.count_documents({"action": "league.conflict.override", "data.action": "sanction"}) == 1


# ---------------------------------------------------------------- Einspruch


async def appeal(flow, world, sanction_id: str, user: str, text: str = "Die Sperre trifft die falsche Person, siehe Clip."):
    flow.act_as(world["users"][user])
    return await flow.post(f"/api/penalties/sanctions/{sanction_id}/appeal", json={"text": text})


async def decide(flow, world, sanction_id: str, actor: str, decision: str, note: str = "Nach Prüfung der Nachweise entschieden."):
    flow.act_as(world[actor])
    return await flow.post(f"{world['url']}/{sanction_id}/appeal/decision", json={"decision": decision, "note": note})


@pytest.mark.asyncio
async def test_the_appeal_is_once_in_time_for_the_affected_and_another_person_decides(flow):
    world = await sanction_world(flow)
    sanction = (await ban(flow, world, matches=2)).json()
    assert sanction["can_appeal"] is True and sanction["appeal_until"]

    stranger = await appeal(flow, world, sanction["id"], "Fremd")
    assert stranger.status_code == 404, "für Unbeteiligte gibt es die Strafe nicht"
    captain = await appeal(flow, world, sanction["id"], "Kapitaen")
    assert captain.status_code == 404, "die Sperre einer Person ficht nur sie selbst an"
    assert (await appeal(flow, world, sanction["id"], "Mila", "zu kurz")).status_code == 422
    filed = await appeal(flow, world, sanction["id"], "Mila")
    assert filed.status_code == 200 and filed.json()["appeal"]["state"] == "open", filed.text
    assert (await appeal(flow, world, sanction["id"], "Mila")).status_code == 409, "einmal je Entscheidung"
    # Nr. 41: Die Strafe gilt bis zur Entscheidung weiter.
    assert (await eligibility(flow, world, "Mila"))["ok"] is False

    own = await decide(flow, world, sanction["id"], "lead", "granted")
    assert own.status_code == 403 and "Ausgangsentscheidung" in own.json()["detail"]
    # Auch der Superadmin entscheidet nicht über die eigene Strafe.
    await flow.db.users.update_one({"id": world["lead"]["id"]}, {"$set": {"role": "superadmin"}})
    world["lead"] = {**world["lead"], "role": "superadmin"}
    assert (await decide(flow, world, sanction["id"], "lead", "granted")).status_code == 403
    assert (await eligibility(flow, world, "Mila"))["ok"] is False

    assert (await decide(flow, world, sanction["id"], "second", "granted", "ok")).status_code == 422, "Pflichtbegründung"
    granted = await decide(flow, world, sanction["id"], "second", "granted")
    assert granted.status_code == 200, granted.text
    assert granted.json()["status"] == "revoked" and granted.json()["revoked_via"] == "appeal" and granted.json()["appeal"]["state"] == "granted"
    assert (await eligibility(flow, world, "Mila"))["ok"] is True
    assert (await decide(flow, world, sanction["id"], "second", "upheld")).status_code == 409, "endgültig"


@pytest.mark.asyncio
async def test_an_upheld_appeal_keeps_the_ban_and_a_late_appeal_is_refused(flow):
    world = await sanction_world(flow)
    sanction = (await ban(flow, world, matches=2)).json()
    assert (await appeal(flow, world, sanction["id"], "Mila")).status_code == 200
    kept = await decide(flow, world, sanction["id"], "second", "upheld")
    assert kept.status_code == 200 and kept.json()["status"] == "active" and kept.json()["appeal"]["state"] == "upheld"
    assert (await eligibility(flow, world, "Mila"))["ok"] is False
    assert (await appeal(flow, world, sanction["id"], "Mila")).status_code == 409

    late = (await ban(flow, world, "Tom", matches=1)).json()
    await flow.db.competition_sanctions.update_one({"id": late["id"]}, {"$set": {"appeal_until": at(-1)}})
    refused = await appeal(flow, world, late["id"], "Tom")
    assert refused.status_code == 409 and "abgelaufen" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_a_team_sanction_is_appealed_by_captain_or_team_lead_and_everyone_sees_their_own(flow):
    world = await sanction_world(flow)
    team = (await issue(flow, world, kind="yellow_card", target_type="squad", registration_id=world["reg_a"]["id"])).json()
    own = (await ban(flow, world, "Mila", matches=1)).json()

    async def mine(user: str) -> list[dict]:
        flow.act_as(world["users"][user])
        return [row for row in (await flow.get("/api/penalties/me")).json()["items"] if row["kind"] == "league_sanction"]

    captain = await mine("Kapitaen")
    assert [row["ref_id"] for row in captain] == [team["id"]] and captain[0]["team_penalty"] is True
    assert captain[0]["team_name"] and captain[0]["sanction"]["can_appeal"] is True and "admin_url" not in captain[0]
    assert captain[0]["context_title"] == "Probe-Liga · Season 1"
    assert [row["ref_id"] for row in await mine("LoeLeitung")] == [team["id"]], "die Hauptteam-Leitung trägt das Team"
    mila = await mine("Mila")
    assert [row["ref_id"] for row in mila] == [own["id"]] and mila[0]["reason"] == "Nachweis liegt der Leitung vor."
    assert await mine("Tom") == [] and await mine("Falke1") == [] and await mine("Fremd") == []

    assert (await appeal(flow, world, team["id"], "Mila")).status_code == 404
    assert (await appeal(flow, world, team["id"], "LoeLeitung")).status_code == 200
    assert (await appeal(flow, world, team["id"], "Kapitaen")).status_code == 409


@pytest.mark.asyncio
async def test_the_inbox_shows_league_sanctions_only_to_who_leads_that_league(flow):
    world = await sanction_world(flow)
    (await ban(flow, world, "Mila", matches=1)).json()
    await issue(flow, world, kind="warning", target_type="squad", registration_id=world["reg_a"]["id"])
    area = await flow.add_staff()
    flow.act_as(area)
    rows = [row for row in (await flow.get("/api/admin/penalties")).json()["items"] if row["kind"] == "league_sanction"]
    assert len(rows) == 2 and {bool(row.get("team_penalty")) for row in rows} == {True, False}
    assert all(row["admin_url"].endswith("#strafen") for row in rows)
    # Wer nur Turniere leitet, sieht die Strafen der Liga nicht.
    await flow.db.users.update_one({"id": area["id"]}, {"$set": {"role": "user", "areas": ["tournaments"]}})
    flow.act_as({**area, "role": "user", "areas": ["tournaments"]})
    listed = await flow.get("/api/admin/penalties")
    assert listed.status_code == 200 and [row for row in listed.json()["items"] if row["kind"] == "league_sanction"] == []


# ---------------------------------------------------------------- Nachrichten, Protokoll, Nachweise


@pytest.mark.asyncio
async def test_messages_reach_the_affected_once_and_the_log_carries_no_text(flow):
    world = await sanction_world(flow)
    sanction = (await ban(flow, world, matches=1, reason="Mila hat nachweislich einen Makro benutzt.")).json()

    async def keys(user_id: str) -> list[str]:
        rows = await flow.db.notifications.find({"user_id": user_id}, {"_id": 0}).to_list(50)
        return sorted((row.get("meta") or {}).get("dedupe_key") or "" for row in rows if (row.get("meta") or {}).get("sanction_id"))

    assert await keys(uid(world, "Mila")) == [f"sanction:{sanction['id']}:issued:{uid(world, 'Mila')}"]
    # Captain und Hauptteam-Leitung erfahren die Sperre (sie stellen auf) - ohne Verstoß und Begründung.
    captain = await flow.db.notifications.find_one({"user_id": uid(world, "Kapitaen"), "meta.sanction_id": sanction["id"]}, {"_id": 0})
    assert captain and "gesperrt" in captain["body"] and "Makro" not in captain["body"] and "Anlage" not in captain["body"]
    assert await keys(uid(world, "Fremd")) == [] and await keys(uid(world, "Falke1")) == []

    assert (await appeal(flow, world, sanction["id"], "Mila")).status_code == 200
    # Der Einspruch geht an die Leitung mit „Strafen“ - nicht an die Person der Ausgangsentscheidung.
    assert await keys(world["second"]["id"]) == [f"sanction:{sanction['id']}:appeal:{world['second']['id']}"]
    assert await keys(world["lead"]["id"]) == []
    assert (await decide(flow, world, sanction["id"], "second", "upheld")).status_code == 200
    assert f"sanction:{sanction['id']}:appeal_decided:{uid(world, 'Mila')}" in await keys(uid(world, "Mila"))

    logs = await flow.db.audit_logs.find({"action": {"$regex": "^league.sanction"}}, {"_id": 0}).to_list(20)
    assert sorted(row["action"] for row in logs) == ["league.sanction.appeal", "league.sanction.appeal.decide", "league.sanction.create"]
    assert "Makro" not in str(logs) and "Mila" not in str(logs)


@pytest.mark.asyncio
async def test_proofs_of_a_running_sanction_are_kept_and_released_afterwards(flow):
    """Nr. 31, 136: Der Nachweis bleibt, solange die Strafe läuft oder die Einspruchsfrist offen ist."""
    world = await sanction_world(flow)
    match_id, tid = world["match"]["id"], world["tournament"]["id"]
    old = (now_utc() - timedelta(days=400)).isoformat()
    for proof_id in ("beweis-1", "beweis-2"):
        await flow.db.match_proof_photos.insert_one({"id": proof_id, "match_id": match_id, "tournament_id": tid, "status": "attached",
                                                     "created_at": old, "context": {"kind": "report"}, "owner_id": uid(world, "Falke1")})
    # Season lange vorbei: ohne Strafe wäre beides fällig.
    await flow.db.league_seasons.update_one({"id": world["season_id"]}, {"$set": {"start_date": "2025-01-06T00:00:00", "weeks_total": 2}})
    foreign = await issue(flow, world, kind="warning", target_type="squad", registration_id=world["reg_a"]["id"], proof_ids=["beweis-1"])
    assert foreign.status_code == 422, "Nachweise gehören zu einem Spiel"
    # Zur Auswahl steht, was die Person am Spiel sehen darf: die Leitung mit Ergebnis-Recht alles, „Strafen“ allein nichts.
    flow.act_as(world["lead"])
    offered = (await flow.get(f"{world['url']}/proofs", params={"match_id": match_id})).json()["items"]
    assert [row["id"] for row in offered] == ["beweis-1", "beweis-2"]
    flow.act_as(world["second"])
    assert (await flow.get(f"{world['url']}/proofs", params={"match_id": match_id})).json()["items"] == []
    blind = await issue(flow, world, "second", kind="team_ban", target_type="squad", registration_id=world["reg_a"]["id"],
                        match_id=match_id, proof_ids=["beweis-1"], ends_at=at(days=30))
    assert blind.status_code == 403
    issued = await issue(flow, world, kind="team_ban", target_type="squad", registration_id=world["reg_a"]["id"],
                         match_id=match_id, proof_ids=["beweis-1"], ends_at=at(days=30))
    assert issued.status_code == 200, issued.text
    assert [row["id"] for row in issued.json()["proofs"]] == ["beweis-1"] and issued.json()["proof_count"] == 1
    held = await flow.db.match_proof_photos.find_one({"id": "beweis-1"}, {"_id": 0})
    assert held["keep_until"] >= at(days=29)

    await match_proof_retention.purge(flow.db)
    left = sorted(row["id"] for row in await flow.db.match_proof_photos.find({}, {"_id": 0, "id": 1}).to_list(10))
    assert left == ["beweis-1"], "Gegenprobe: der Nachweis ohne Strafe ist weg"

    # Nach dem Widerruf hält nichts mehr.
    assert (await revoke(flow, world, issued.json()["id"])).status_code == 200
    assert "keep_until" not in await flow.db.match_proof_photos.find_one({"id": "beweis-1"}, {"_id": 0})
    await match_proof_retention.purge(flow.db)
    assert await flow.db.match_proof_photos.count_documents({}) == 0


# ---------------------------------------------------------------- Gleichzeitige Schritte (Review R1, M1)


async def stored(flow, sanction_id: str) -> dict:
    return await flow.db.competition_sanctions.find_one({"id": sanction_id}, {"_id": 0})


async def refused(step) -> int | None:
    """Der Status, mit dem ein Schritt abgelehnt wird - ``None``: Er ging durch."""
    try:
        await step
    except league_sanctions.SanctionProblem as problem:
        return problem.status
    return None


@pytest.mark.asyncio
async def test_two_revokes_on_the_same_reading_happen_once(flow):
    """Zwei Personen lesen dieselbe Strafe und widerrufen beide: Die zweite bekommt 409, Protokoll und Wirkung gibt es einmal."""
    world = await sanction_world(flow)
    sanction = (await ban(flow, world, matches=2)).json()
    first, second = await stored(flow, sanction["id"]), await stored(flow, sanction["id"])
    assert await refused(league_sanctions.revoke(flow.db, first, "Irrtum der Leitung eins.", world["lead"]["id"])) is None
    assert await refused(league_sanctions.revoke(flow.db, second, "Irrtum der Leitung zwei.", world["second"]["id"])) == 409
    final = await stored(flow, sanction["id"])
    assert final["revoked_by"] == world["lead"]["id"] and final["revoke_reason"] == "Irrtum der Leitung eins."
    assert await flow.db.audit_logs.count_documents({"action": "league.sanction.revoke"}) == 1
    # Über die Route: genau eine Nachricht an die betroffene Person.
    other = (await ban(flow, world, "Tom", matches=1)).json()
    assert (await revoke(flow, world, other["id"])).status_code == 200
    assert (await revoke(flow, world, other["id"], "second")).status_code == 409
    assert await flow.db.notifications.count_documents({"meta.sanction_id": other["id"], "meta.dedupe_key": {"$regex": ":revoked:"},
                                                        "user_id": uid(world, "Tom")}) == 1


@pytest.mark.asyncio
async def test_two_appeal_decisions_on_the_same_reading_leave_one_consistent_result(flow):
    """„Aufgehoben“ gegen „bleibt“: Es gilt, wer zuerst schreibt - nie eine aufgehobene Strafe mit dem Vermerk „bleibt“."""
    world = await sanction_world(flow)
    third = await lead_of(flow, "Drittleitung", "sanctions")
    sanction = (await ban(flow, world, matches=2)).json()
    assert (await appeal(flow, world, sanction["id"], "Mila")).status_code == 200
    first, second = await stored(flow, sanction["id"]), await stored(flow, sanction["id"])
    assert await refused(league_sanctions.decide_appeal(flow.db, first, world["second"], "granted", "Verwechslung belegt.")) is None
    assert await refused(league_sanctions.decide_appeal(flow.db, second, third, "upheld", "Strafe bleibt bestehen.")) == 409
    final = await stored(flow, sanction["id"])
    assert final["appeal"]["state"] == "granted" and final["appeal"]["decided_by"] == world["second"]["id"]
    assert final["revoked_via"] == "appeal" and final["revoke_reason"] == "Verwechslung belegt."
    assert await flow.db.audit_logs.count_documents({"action": "league.sanction.appeal.decide"}) == 1
    assert await flow.db.audit_logs.count_documents({"action": "league.sanction.revoke"}) == 1
    assert (await eligibility(flow, world, "Mila"))["ok"] is True

    # Umgekehrt: „bleibt“ zuerst - die Strafe gilt weiter, das spätere „aufgehoben“ ändert nichts.
    kept = (await ban(flow, world, "Tom", matches=1)).json()
    assert (await appeal(flow, world, kept["id"], "Tom")).status_code == 200
    first, second = await stored(flow, kept["id"]), await stored(flow, kept["id"])
    assert await refused(league_sanctions.decide_appeal(flow.db, first, world["second"], "upheld", "Strafe bleibt bestehen.")) is None
    assert await refused(league_sanctions.decide_appeal(flow.db, second, third, "granted", "Verwechslung belegt.")) == 409
    final = await stored(flow, kept["id"])
    assert final["appeal"]["state"] == "upheld" and final["revoked_at"] is None
    assert (await eligibility(flow, world, "Tom"))["ok"] is False


@pytest.mark.asyncio
async def test_confirming_next_to_a_revoke_does_not_revive_the_ban(flow):
    world = await sanction_world(flow)
    sanction = (await ban(flow, world, state="provisional")).json()
    first, second = await stored(flow, sanction["id"]), await stored(flow, sanction["id"])
    assert await refused(league_sanctions.revoke(flow.db, first, "Verdacht hat sich nicht bestätigt.", world["lead"]["id"])) is None
    assert await refused(league_sanctions.confirm(flow.db, second, {"matches": 2}, world["second"])) == 409
    final = await stored(flow, sanction["id"])
    assert final["state"] == "provisional" and final["final_at"] is None and final["revoked_at"] and final["appeal_until"] is None
    assert await flow.db.audit_logs.count_documents({"action": "league.sanction.confirm"}) == 0
    # Gegenprobe: Zweimal bestätigen auf demselben Stand geht einmal.
    again = (await ban(flow, world, "Tom", state="provisional")).json()
    first, second = await stored(flow, again["id"]), await stored(flow, again["id"])
    assert await refused(league_sanctions.confirm(flow.db, first, {"matches": 1}, world["lead"])) is None
    assert await refused(league_sanctions.confirm(flow.db, second, {"matches": 3}, world["second"])) == 409
    assert (await stored(flow, again["id"]))["matches"] == 1
    assert await flow.db.audit_logs.count_documents({"action": "league.sanction.confirm"}) == 1


@pytest.mark.asyncio
async def test_a_revoke_closes_an_open_appeal_and_releases_the_proofs(flow):
    """Review R1, N1: Nach dem Widerruf gibt es nichts mehr zu entscheiden - der Einspruch ist erledigt."""
    world = await sanction_world(flow)
    sanction = (await ban(flow, world, matches=2)).json()
    assert (await appeal(flow, world, sanction["id"], "Mila")).status_code == 200
    assert await league_sanction_bans.hold_until(flow.db, await stored(flow, sanction["id"])) == league_sanction_bans.OPEN_END
    revoked = await revoke(flow, world, sanction["id"])
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["appeal"]["state"] == "moot" and revoked.json()["appeal"]["note"] == "Strafe widerrufen"
    assert (await decide(flow, world, sanction["id"], "second", "upheld")).status_code == 409
    assert (await decide(flow, world, sanction["id"], "second", "granted")).status_code == 409
    final = await stored(flow, sanction["id"])
    assert final["appeal"]["state"] == "moot" and final["appeal"]["text"], "der Text des Einspruchs bleibt stehen"
    assert await league_sanction_bans.hold_until(flow.db, final) is None
    # Gegenprobe: Ein entschiedener Einspruch bleibt beim späteren Widerruf, wie er entschieden wurde.
    kept = (await ban(flow, world, "Tom", matches=1)).json()
    assert (await appeal(flow, world, kept["id"], "Tom")).status_code == 200
    assert (await decide(flow, world, kept["id"], "second", "upheld")).status_code == 200
    assert (await revoke(flow, world, kept["id"])).json()["appeal"]["state"] == "upheld"
