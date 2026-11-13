"""E.4 Leitstand der Season (docs/LIGA.md „E.4 Leitstand“, Nr. 152, 153): jede Aufgabenart erscheint und verschwindet nach der
Erledigung, Rechte je Zuständigkeit (auch negativ), Befangenheit, Protokoll und Rundnachricht (Empfängerkreise, Mail, kein
Doppelversand). Über die echten Routen, nur erfundene Namen.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import OLD_RULES, world as league_world  # noqa: E402
from models import now_utc  # noqa: E402
from services import league_rules  # noqa: E402

ADMIN = "/api/admin/leagues"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def at(**delta) -> str:
    return (now_utc() + timedelta(**delta)).replace(microsecond=0).isoformat()


async def lead_of(flow, name: str, *capabilities: str, league_id: str = "liga") -> dict:
    user = await flow.add_user(name=name)
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": league_id, "user_id": user["id"],
                                           "capabilities": list(capabilities), "created_at": now_utc().isoformat()})
    return user


async def desk_world(flow) -> dict:
    world = await league_world(flow)
    await flow.db.leagues.insert_one({"id": "liga", "name": "Probe-Liga", "slug": "probe-liga", "game_id": "probe-shooter", "status": "active"})
    await flow.db.league_seasons.insert_one({
        "id": world["season_id"], "league_id": "liga", "name": "Season 1", "slug": "season-1", "status": "active", "number": 1,
        "start_date": at(days=-7), "weeks_total": 10, "matchday_days": 7, **OLD_RULES})
    await flow.db.league_divisions.insert_one({"id": "liga-1", "league_id": "liga", "season_id": world["season_id"], "level": 1})
    world["desk"] = f"{ADMIN}/seasons/{world['season_id']}/desk"
    world["broadcast"] = f"{ADMIN}/seasons/{world['season_id']}/broadcast"
    return world


async def desk(flow, world, user=None) -> dict:
    flow.act_as(user or world["staff"])
    response = await flow.get(world["desk"])
    assert response.status_code == 200, response.text
    return response.json()


def group(data: dict, key: str) -> list[dict]:
    return next((row["items"] for row in data["groups"] if row["key"] == key), [])


def keys(data: dict) -> set[str]:
    return {row["key"] for row in data["groups"]}


async def set_match(flow, world, **fields):
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": fields})


# ---------------------------------------------------------------- Aufgabenarten


@pytest.mark.asyncio
async def test_empty_season_has_every_group_and_nothing_open(flow):
    world = await desk_world(flow)
    data = await desk(flow, world)
    assert [row["key"] for row in data["groups"]] == ["incidents", "no_show", "overdue", "lineups", "procedures", "sanctions",
                                                      "applications", "roster", "reschedule", "rules"]
    assert data["total"] == 0 and data["mine"] == 0 and data["can_broadcast"] is True
    assert all(row["responsible"] for row in data["groups"]), "jede Gruppe nennt, wer zuständig ist"


@pytest.mark.asyncio
async def test_overdue_match_appears_and_vanishes_with_the_result(flow):
    world = await desk_world(flow)
    await set_match(flow, world, result_overdue_at=at(hours=-2), scheduled_at=at(days=-3))
    items = group(await desk(flow, world), "overdue")
    assert [row["id"] for row in items] == [f"overdue:{world['match']['id']}"]
    item = items[0]
    assert item["url"] == f"/matches/{world['match']['id']}" and item["since"] and item["mine"] is True and item["conflict"] is False
    await set_match(flow, world, status="completed")
    assert group(await desk(flow, world), "overdue") == []


@pytest.mark.asyncio
async def test_missing_participant_list_appears_after_the_deadline_and_vanishes_once_filed(flow):
    world = await desk_world(flow)
    await set_match(flow, world, status="completed", games=[{"position": 1}], lineups_missing=[world["reg_h"]["id"]])
    assert group(await desk(flow, world), "lineups") == [], "vor der Frist ist es noch Sache der Seite"
    await set_match(flow, world, lineup_overdue_at=at(hours=-1))
    items = group(await desk(flow, world), "lineups")
    assert len(items) == 1 and "Eine Seite hat" in items[0]["text"] and items[0]["url"] == f"/matches/{world['match']['id']}"
    await set_match(flow, world, lineups_missing=[])
    assert group(await desk(flow, world), "lineups") == []


@pytest.mark.asyncio
async def test_expired_checkin_appears_until_decided(flow):
    world = await desk_world(flow)
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"checkin_rules": {"enabled": True}}})
    await set_match(flow, world, no_show_proposal={"rule": "check_in", "decision": None, "due_at": at(minutes=-5),
                                                   "missing_registration_ids": [world["reg_h"]["id"]]})
    items = group(await desk(flow, world), "no_show")
    assert len(items) == 1 and items[0]["due_at"] and items[0]["action"] == "Entscheiden"
    await set_match(flow, world, **{"no_show_proposal.decision": "extended"})
    assert group(await desk(flow, world), "no_show") == []


@pytest.mark.asyncio
async def test_incident_in_review_appears_until_decided(flow):
    world = await desk_world(flow)
    await set_match(flow, world, incidents=[{"id": new_id(), "position": 1, "kind": "disconnect", "state": "in_review", "at": at(minutes=-10)}])
    items = group(await desk(flow, world), "incidents")
    assert len(items) == 1 and items[0]["detail"] == {"code": "in_review", "position": 1}
    assert items[0]["url"] == f"/matches/{world['match']['id']}#vorfaelle"
    await set_match(flow, world, incidents=[{"id": new_id(), "position": 1, "kind": "disconnect", "state": "withdrawn", "at": at(minutes=-10)}])
    assert group(await desk(flow, world), "incidents") == []


@pytest.mark.asyncio
async def test_open_procedure_appears_with_assignee_and_vanishes_when_decided(flow):
    world = await desk_world(flow)
    second = await lead_of(flow, "Zweitleitung", "disputes")
    procedure = {"id": new_id(), "kind": "protest", "state": "open", "at": at(hours=-3), "registration_id": world["reg_a"]["id"],
                 "assignee": {"user_id": second["id"], "at": at(hours=-1)}, "target_at": at(hours=20)}
    await set_match(flow, world, disputes=[procedure])
    item = group(await desk(flow, world), "procedures")[0]
    assert item["id"] == f"procedures:{procedure['id']}" and item["due_at"] == procedure["target_at"]
    assert item["assignee"] == {"name": "Zweitleitung", "own": False}
    assert item["mine"] is False, "übernommen hat es jemand anderes"
    own = group(await desk(flow, world, second), "procedures")[0]
    assert own["assignee"]["own"] is True and own["mine"] is True
    await set_match(flow, world, disputes=[{**procedure, "state": "decided", "resolved_at": at()}])
    assert group(await desk(flow, world), "procedures") == []


@pytest.mark.asyncio
async def test_provisional_sanction_and_open_appeal_appear_until_handled(flow):
    world = await desk_world(flow)
    doc = {"id": new_id(), "season_id": world["season_id"], "league_id": "liga", "tournament_id": world["tournament"]["id"],
           "kind": "player_ban", "target_type": "player", "user_id": world["users"]["Mila"]["id"], "registration_id": world["reg_a"]["id"],
           "squad_id": world["squad_a"]["id"], "team_id": world["lions"]["id"], "state": "provisional", "revoked_at": None, "appeal": None,
           "created_by": world["staff"]["id"], "created_at": at(hours=-1)}
    await flow.db.competition_sanctions.insert_one(dict(doc))
    items = group(await desk(flow, world), "sanctions")
    assert [row["id"] for row in items] == [f"sanctions:{doc['id']}:provisional"]
    assert "Mila" not in items[0]["title"] and "Mila" not in items[0]["text"], "keine Person im Text der Aufgabe"
    appeal = {"id": new_id(), "by": world["users"]["Kapitaen"]["id"], "at": at(), "text": "Bitte noch einmal prüfen.", "state": "open"}
    await flow.db.competition_sanctions.update_one({"id": doc["id"]}, {"$set": {"state": "final", "final_by": world["staff"]["id"], "appeal": appeal}})
    items = group(await desk(flow, world), "sanctions")
    assert [row["id"] for row in items] == [f"sanctions:{doc['id']}:appeal"]
    assert items[0]["conflict"] is True and "Ausgangsentscheidung" in items[0]["conflict_text"], "wer verhängt hat, entscheidet nie"
    second = await lead_of(flow, "Zweitleitung", "sanctions")
    assert group(await desk(flow, world, second), "sanctions")[0]["mine"] is True
    await flow.db.competition_sanctions.update_one({"id": doc["id"]}, {"$set": {"appeal.state": "upheld"}})
    assert group(await desk(flow, world), "sanctions") == []


@pytest.mark.asyncio
async def test_applications_transfers_and_late_ids_appear_until_decided(flow):
    world = await desk_world(flow)
    application = {"id": new_id(), "season_id": world["season_id"], "league_id": "liga", "squad_id": world["squad_b"]["id"],
                   "team_id": world["lions"]["id"], "display_name": "Loewen · Rudel B", "status": "submitted", "created_at": at(hours=-5),
                   "applied_by": world["users"]["LoeLeitung"]["id"]}
    await flow.db.league_applications.insert_one(dict(application))
    transfer = {"id": new_id(), "season_id": world["season_id"], "league_id": "liga", "user_id": world["users"]["Ida"]["id"],
                "to_squad_id": world["squad_a"]["id"], "status": "pending", "requested_at": at(hours=-2)}
    await flow.db.league_transfers.insert_one(dict(transfer))
    data = await desk(flow, world)
    assert [row["id"] for row in group(data, "applications")] == [f"applications:{application['id']}"]
    assert group(data, "applications")[0]["url"].endswith("#anmeldungen")
    assert [row["id"] for row in group(data, "roster")] == [f"roster:transfer:{transfer['id']}"]
    assert "Ida" not in group(data, "roster")[0]["title"]

    await flow.db.league_applications.update_one({"id": application["id"]}, {"$set": {"status": "accepted"}})
    assert group(await desk(flow, world), "applications")[0]["action"] == "Zuteilen", "angenommen, aber noch keiner Staffel zugeteilt"
    await flow.db.league_applications.update_one({"id": application["id"]}, {"$set": {"assignment": {"tournament_id": world["tournament"]["id"]}}})
    await flow.db.league_transfers.update_one({"id": transfer["id"]}, {"$set": {"status": "approved"}})
    data = await desk(flow, world)
    assert group(data, "applications") == [] and group(data, "roster") == []


@pytest.mark.asyncio
async def test_reschedule_request_appears_for_the_lead_but_is_not_theirs(flow):
    world = await desk_world(flow)
    request = {"id": new_id(), "status": "pending", "from_at": at(days=2), "to_at": at(days=3), "requested_at": at(hours=-1),
               "requested_registration_id": world["reg_a"]["id"]}
    await set_match(flow, world, scheduled_at=request["from_at"], reschedule_requests=[request])
    items = group(await desk(flow, world), "reschedule")
    assert [row["id"] for row in items] == [f"reschedule:{request['id']}"]
    assert items[0]["due_at"] == request["from_at"] and items[0]["mine"] is False, "entscheiden muss die Gegenseite"
    await set_match(flow, world, reschedule_requests=[{**request, "status": "declined"}])
    assert group(await desk(flow, world), "reschedule") == []


@pytest.mark.asyncio
async def test_rules_release_appears_while_pending(flow, monkeypatch):
    world = await desk_world(flow)
    pending = {"kind": "draft", "count": 0, "label": "Fassung 1", "admin_url": f"/admin/leagues/rules/league_season/{world['season_id']}"}

    async def waiting(_db, _league, _season):
        return pending

    monkeypatch.setattr(league_rules, "pending_release", waiting)
    items = group(await desk(flow, world), "rules")
    assert len(items) == 1 and items[0]["url"] == pending["admin_url"] and items[0]["detail"]["kind"] == "draft"

    async def released(_db, _league, _season):
        return None

    monkeypatch.setattr(league_rules, "pending_release", released)
    assert group(await desk(flow, world), "rules") == []


# ---------------------------------------------------------------- Rechte und Befangenheit


@pytest.mark.asyncio
async def test_each_capability_sees_only_its_groups_and_others_are_refused(flow):
    world = await desk_world(flow)
    await set_match(flow, world, result_overdue_at=at(hours=-2))
    only_apps = await lead_of(flow, "Anmeldeleitung", "applications")
    data = await desk(flow, world, only_apps)
    assert keys(data) == {"applications"} and data["can_broadcast"] is False
    assert data["total"] == 0, "das überfällige Spiel sieht nur „Spiele betreuen“ oder „Ergebnisse korrigieren“"
    matches = await lead_of(flow, "Spielleitung", "matches")
    assert keys(await desk(flow, world, matches)) == {"no_show", "overdue", "lineups", "reschedule"}
    assert len(group(await desk(flow, world, matches), "overdue")) == 1
    season_lead = await lead_of(flow, "Seasonleitung", "season")
    data = await desk(flow, world, season_lead)
    assert keys(data) == set() and data["can_broadcast"] is True

    # Gegenproben: Zuständige einer anderen Liga, Spieler ohne Dienst und ohne Zwei-Faktor - kein Leitstand.
    foreign = await lead_of(flow, "Fremdleitung", "matches", "results", league_id="andere-liga")
    for user in (foreign, world["users"]["Kapitaen"]):
        flow.act_as(user)
        refused = await flow.get(world["desk"])
        assert refused.status_code == 403, refused.text
    unverified = {**matches, "auth_mfa_verified": False}
    flow.act_as(unverified)
    assert (await flow.get(world["desk"])).status_code == 403
    flow.act_as(matches)
    assert (await flow.get(f"{world['desk']}/log")).status_code == 200, "das Protokoll liest jede Zuständigkeit"


@pytest.mark.asyncio
async def test_own_match_stays_visible_with_the_second_person_hint(flow):
    world = await desk_world(flow)
    await set_match(flow, world, result_overdue_at=at(hours=-2))
    # Mila spielt im Co-Team Rudel A und ist zugleich in der Liga-Leitung.
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": "liga", "user_id": world["users"]["Mila"]["id"],
                                           "capabilities": ["matches", "results"], "created_at": now_utc().isoformat()})
    data = await desk(flow, world, world["users"]["Mila"])
    item = group(data, "overdue")[0]
    assert item["conflict"] is True and item["mine"] is False and "zweite berechtigte Person" in item["conflict_text"]
    assert data["mine"] == 0 and data["total"] == 1
    # Gegenprobe: Eine Leitung ohne Bezug zum Spiel darf es selbst.
    other = await lead_of(flow, "Neutral", "matches")
    neutral = group(await desk(flow, world, other), "overdue")[0]
    assert neutral["conflict"] is False and neutral["mine"] is True


@pytest.mark.asyncio
async def test_own_team_application_is_marked(flow):
    world = await desk_world(flow)
    await flow.db.league_applications.insert_one({
        "id": new_id(), "season_id": world["season_id"], "league_id": "liga", "squad_id": world["squad_b"]["id"], "team_id": world["lions"]["id"],
        "display_name": "Loewen · Rudel B", "status": "submitted", "created_at": at(hours=-5), "applied_by": world["users"]["LoeLeitung"]["id"]})
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": "liga", "user_id": world["users"]["LoeLeitung"]["id"],
                                           "capabilities": ["applications"], "created_at": now_utc().isoformat()})
    item = group(await desk(flow, world, world["users"]["LoeLeitung"]), "applications")[0]
    assert item["conflict"] is True and "eigenes Team" in item["conflict_text"]


# ---------------------------------------------------------------- „Mein Dienst“ verlinkt


@pytest.mark.asyncio
async def test_my_duty_links_into_the_desk_with_the_own_count(flow):
    world = await desk_world(flow)
    await set_match(flow, world, result_overdue_at=at(hours=-2))
    lead = await lead_of(flow, "Spielleitung", "matches")
    flow.act_as(lead)
    rows = (await flow.get("/api/users/me/duty?desks=1")).json()["league_desks"]
    assert rows == [{"season_id": world["season_id"], "league_name": "Probe-Liga", "season_name": "Season 1", "mine": 1, "total": 1,
                     "url": f"/admin/leagues/seasons/{world['season_id']}#leitstand"}]
    flow.act_as(world["users"]["Tom"])
    assert (await flow.get("/api/users/me/duty?desks=1")).json()["league_desks"] == [], "Spieler ohne Dienst"


@pytest.mark.asyncio
async def test_duty_without_the_flag_does_not_compute_any_desk(flow, monkeypatch):
    """Die Startseite der Verwaltung lädt „Mein Dienst“ ohne ``desks`` - dann rechnet der Server keinen Leitstand."""
    from services import league_desk

    world = await desk_world(flow)
    await set_match(flow, world, result_overdue_at=at(hours=-2))
    lead = await lead_of(flow, "Spielleitung", "matches")
    calls = []
    real = league_desk.season_desk

    async def counted(db, season, me):
        calls.append(season["id"])
        return await real(db, season, me)

    monkeypatch.setattr(league_desk, "season_desk", counted)
    flow.act_as(lead)
    plain = (await flow.get("/api/users/me/duty")).json()
    assert plain["league_desks"] == [] and calls == [], "ohne ?desks=1 kein Leitstand"
    assert len(plain["overdue_matches"]) == 1, "die eigene Liste bleibt"
    asked = (await flow.get("/api/users/me/duty?desks=1")).json()
    assert asked["league_desks"][0]["mine"] == 1 and calls == [world["season_id"]]


@pytest.mark.asyncio
async def test_roster_overview_is_read_only_when_late_ids_can_exist(flow, monkeypatch):
    from services import league_roster

    world = await desk_world(flow)
    calls = []
    real = league_roster.season_overview

    async def counted(db, season):
        calls.append(season["id"])
        return await real(db, season)

    monkeypatch.setattr(league_roster, "season_overview", counted)
    await desk(flow, world)
    assert calls == [], "ohne Spiel-ID nach dem Stichtag keine Kaderübersicht"
    await flow.db.league_rosters.insert_one({"id": new_id(), "season_id": world["season_id"], "user_id": world["users"]["Ida"]["id"],
                                             "late_squad_ids": [world["squad_a"]["id"]]})
    await desk(flow, world)
    assert calls == [world["season_id"]]


# ---------------------------------------------------------------- Rundnachricht


async def send(flow, world, user=None, **body):
    flow.act_as(user or world["staff"])
    payload = {"request_id": new_id(), "title": "Spieltag 3", "text": "Bitte denkt an den Check-in am Sonntag.", **body}
    return await flow.post(world["broadcast"], json=payload)


async def inbox(flow, world, name: str) -> list[dict]:
    return await flow.db.notifications.find({"user_id": world["users"][name]["id"], "kind": "league_broadcast"}, {"_id": 0}).to_list(None)


@pytest.mark.asyncio
async def test_broadcast_reaches_captains_by_default_and_all_players_on_request(flow):
    world = await desk_world(flow)
    flow.act_as(world["staff"])
    preview = await flow.post(f"{world['broadcast']}/preview", json={})
    assert preview.status_code == 200, preview.text
    assert preview.json()["recipients"] == 2 and preview.json()["audience_label"] == "Captains und Vertreter"

    sent = await send(flow, world)
    assert sent.status_code == 200, sent.text
    assert sent.json()["recipients"] == 2 and sent.json()["replay"] is False
    assert len(await inbox(flow, world, "Kapitaen")) == 1 and len(await inbox(flow, world, "Falke1")) == 1
    assert await inbox(flow, world, "Mila") == [], "Spieler ohne Captain-Rolle bekommen die Vorgabe nicht"
    note = (await inbox(flow, world, "Kapitaen"))[0]
    assert note["title"] == "Probe-Liga Season 1: Spieltag 3" and note["url"] == "/liga/probe-liga/season-1"

    players = await flow.post(f"{world['broadcast']}/preview", json={"audience": "players"})
    # Rudel A (Kapitaen, Mila, Tom) und die Leitung der Löwen, Horst (drei Falken) und die Leitung der Falken.
    assert players.json()["recipients"] == 8
    staffel = await flow.post(f"{world['broadcast']}/preview", json={"audience": "players", "scope": "staffel",
                                                                     "scope_id": world["tournament"]["id"]})
    division = await flow.post(f"{world['broadcast']}/preview", json={"audience": "players", "scope": "division", "scope_id": "liga-1"})
    assert staffel.json()["recipients"] == 8 and division.json()["recipients"] == 8 and division.json()["scope_label"] == "Liga 1"
    unknown = await flow.post(f"{world['broadcast']}/preview", json={"scope": "staffel", "scope_id": "gibt-es-nicht"})
    assert unknown.status_code == 404


@pytest.mark.asyncio
async def test_broadcast_sends_mail_only_when_chosen(flow, monkeypatch):
    world = await desk_world(flow)
    mails = []

    async def fake_mail(_db, user_id, title, text, path, dedupe_key):
        mails.append((user_id, dedupe_key))

    monkeypatch.setattr("services.league_mail.send_league_mail", fake_mail)
    assert (await send(flow, world)).status_code == 200
    assert mails == [], "ohne Wahl keine Mail"
    assert (await send(flow, world, mail=True)).status_code == 200
    assert sorted(user for user, _key in mails) == sorted([world["users"]["Kapitaen"]["id"], world["users"]["Falke1"]["id"]])


@pytest.mark.asyncio
async def test_a_broadcast_stuck_in_sending_is_continued_on_replay_without_sending_twice(flow):
    """N2: Bricht der Versand ab, bleibt der Eintrag auf „sending“. Derselbe Aufruf setzt ihn fort, sobald sich eine Weile nichts tut -
    wer die Nachricht schon hat, bekommt sie nicht noch einmal. Läuft der Versand noch, schickt der zweite Aufruf nichts."""
    world = await desk_world(flow)
    request_id = new_id()
    assert (await send(flow, world, request_id=request_id)).status_code == 200
    claim = f"league-broadcast:{world['season_id']}:{request_id}"
    # Nachgestellt: Der Versand riss nach dem Captain der Löwen ab.
    await flow.db.notifications.delete_many({"user_id": world["users"]["Falke1"]["id"], "kind": "league_broadcast"})
    await flow.db.audit_logs.update_one({"id": claim}, {"$set": {"data.state": "sending", "data.processed": 1, "data.delivered": 1,
                                                                 "data.progress_at": at(seconds=-5)}})
    busy = await send(flow, world, request_id=request_id)
    assert busy.json()["state"] == "sending" and busy.json()["replay"] is True
    assert await inbox(flow, world, "Falke1") == [], "läuft der Versand noch, schickt der zweite Aufruf nichts"

    await flow.db.audit_logs.update_one({"id": claim}, {"$set": {"data.progress_at": at(minutes=-5)}})
    resumed = await send(flow, world, request_id=request_id)
    assert resumed.status_code == 200 and resumed.json()["state"] == "sent"
    assert len(await inbox(flow, world, "Falke1")) == 1 and len(await inbox(flow, world, "Kapitaen")) == 1
    entry = await flow.db.audit_logs.find_one({"id": claim}, {"_id": 0, "data": 1})
    assert entry["data"]["state"] == "sent" and entry["data"]["delivered"] == 2 and entry["data"]["processed"] == 2
    again = await send(flow, world, request_id=request_id)
    assert again.json()["state"] == "sent" and len(await inbox(flow, world, "Falke1")) == 1


@pytest.mark.asyncio
async def test_broadcast_is_sent_once_per_request_and_logged_with_sender(flow):
    world = await desk_world(flow)
    request_id = new_id()
    first = await send(flow, world, request_id=request_id)
    again = await send(flow, world, request_id=request_id)
    assert first.status_code == 200 and again.status_code == 200
    assert again.json()["replay"] is True and again.json()["recipients"] == 2
    assert len(await inbox(flow, world, "Kapitaen")) == 1, "ein zweiter Klick schickt nichts"

    flow.act_as(world["staff"])
    log = (await flow.get(f"{ADMIN}/seasons/{world['season_id']}/desk/log")).json()
    entry = next(row for row in log["items"] if row["action"] == "league.broadcast")
    assert entry["label"] == "Rundnachricht" and entry["actor"] == world["staff"]["display_name"]
    assert entry["broadcast"] == {"audience": "Captains und Vertreter", "scope": "Ganze Season", "recipients": 2, "mail": False}
    assert "Check-in am Sonntag" not in str(log), "der Text der Nachricht steht nicht im Protokoll"


@pytest.mark.asyncio
async def test_broadcast_needs_the_right_and_a_valid_message(flow):
    world = await desk_world(flow)
    only_matches = await lead_of(flow, "Spielleitung", "matches")
    refused = await send(flow, world, only_matches)
    assert refused.status_code == 403
    assert await inbox(flow, world, "Kapitaen") == []
    season_lead = await lead_of(flow, "Seasonleitung", "season")
    assert (await send(flow, world, season_lead)).status_code == 200
    short = await send(flow, world, title="a")
    assert short.status_code == 422
    long = await send(flow, world, text="x" * 1001)
    assert long.status_code == 422


# ---------------------------------------------------------------- Protokoll


@pytest.mark.asyncio
async def test_log_shows_only_this_season_without_free_text_and_in_pages(flow):
    world = await desk_world(flow)
    base = now_utc()
    rows = [{"id": new_id(), "action": "match.reschedule.request", "actor_id": world["users"]["Kapitaen"]["id"],
             "target_id": world["tournament"]["id"], "data": {"match_id": world["match"]["id"], "reason": "Mila hat Schicht"},
             "created_at": (base - timedelta(minutes=index)).isoformat()} for index in range(30)]
    rows.append({"id": new_id(), "action": "league.application.accept", "actor_id": world["staff"]["id"], "target_id": world["season_id"],
                 "data": {"application_id": "x"}, "created_at": (base + timedelta(minutes=1)).isoformat()})
    rows.append({"id": new_id(), "action": "league.season.update", "actor_id": world["staff"]["id"], "target_id": "andere-season",
                 "data": {}, "created_at": base.isoformat()})
    rows.append({"id": new_id(), "action": "user.login", "actor_id": world["staff"]["id"], "target_id": world["season_id"],
                 "data": {}, "created_at": base.isoformat()})
    await flow.db.audit_logs.insert_many(rows)
    flow.act_as(world["staff"])
    first = (await flow.get(f"{ADMIN}/seasons/{world['season_id']}/desk/log")).json()
    assert first["total"] == 31 and first["pages"] == 2 and len(first["items"]) == 25
    assert first["items"][0]["label"] == "Anmeldung · angenommen"
    assert first["items"][1]["label"] == "Verschiebung · beantragt" and first["items"][1]["staffel"] == world["tournament"]["title"]
    assert "Schicht" not in str(first), "keine Begründung und keine Namen aus den Daten"
    second = (await flow.get(f"{ADMIN}/seasons/{world['season_id']}/desk/log?page=2")).json()
    assert second["page"] == 2 and len(second["items"]) == 6
