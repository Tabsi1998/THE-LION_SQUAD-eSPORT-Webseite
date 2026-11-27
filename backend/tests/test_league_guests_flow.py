"""Gastteams (#1665, Entscheidung Nr. 286): Teamleitung gibt Verein bzw. Schule an, die Liga-Leitung setzt und bestätigt das Kennzeichen,
die Plakette steht auf allen Flächen der Liga - TV und Discord nur „Gast“. Ohne Kennzeichen ändert sich nichts. Erfundene Namen."""

import json
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_application_world import application_world, base_url, inbox_url, submit, submitted  # noqa: E402
from league_match_world import world  # noqa: E402
from league_start_world import ok  # noqa: E402
from models import now_utc  # noqa: E402

from services import league_guests  # noqa: E402
from services.league_applications import PRIVACY_PLACEHOLDER  # noqa: E402
from services.league_permissions import SIDE_CONFLICT_DETAIL  # noqa: E402

ORG_URL = "/api/teams/{team}/guest-team"
MARK_URL = "/api/admin/leagues/teams/{team}/guest-team"
SCHOOL = "Probeschule Nord"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def league_lead(flow, league_id: str, capabilities=("applications",), **fields) -> dict:
    user = await flow.add_user(name=f"Liga-Leitung {new_id()[:5]}")
    if fields:
        user.update(fields)
        await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": league_id, "user_id": user["id"],
                                           "capabilities": list(capabilities), "created_at": now_utc().isoformat(), "created_by": "test"})
    return user


async def set_org(flow, actor, team_id, **body):
    flow.act_as(actor)
    return await flow.put(ORG_URL.format(team=team_id), json={"kind": None, "name": None, "school_name_public": False, **body})


async def set_mark(flow, actor, team_id, confirmed=True, **body):
    flow.act_as(actor)
    return await flow.put(MARK_URL.format(team=team_id), json={"confirmed": confirmed, **body})


async def notes_of(flow, user_id: str) -> list[dict]:
    return await flow.db.notifications.find({"user_id": user_id}, {"_id": 0}).to_list(100)


# ---------------------------------------------------------------- Angabe und Kennzeichen


@pytest.mark.asyncio
async def test_team_lead_gives_the_school_and_only_the_league_lead_makes_it_a_guest_team(flow):
    w = await application_world(flow, teams=2)
    side = w["teams"][0]
    team_id = side["team"]["id"]
    application = await submitted(flow, w, side)

    # Captain und Spieler sind nicht die Teamleitung.
    refused = await set_org(flow, side["captain"], team_id, kind="school", name=SCHOOL)
    assert refused.status_code == 403 and refused.json()["detail"] == league_guests.NOT_TEAM_LEAD
    given = ok(await set_org(flow, side["lead"], team_id, kind="school", name=SCHOOL))
    assert given["guest_badge"] is None, "ohne Liga-Leitung kein Kennzeichen"
    assert given["guest_team"]["pending"] is True and given["guest_team"]["name"] == SCHOOL
    # Die Teamleitung setzt das Kennzeichen nicht selbst.
    assert (await set_mark(flow, side["lead"], team_id)).status_code == 403

    flow.act_as(w["lead"])
    item = next(row for row in ok(await flow.get(inbox_url(w)))["items"] if row["id"] == application["id"])
    assert item["guest_team"]["pending"] is True and item["guest_team"]["kind"] == "school"
    assert item["guest_team"]["name"] == SCHOOL, "die Liga-Leitung sieht den Namen auch ohne Freigabe"

    lead = await league_lead(flow, w["league"]["id"])
    marked = ok(await set_mark(flow, lead, team_id, season_id=w["season"]["id"]))
    assert marked["guest_badge"] == {"label": "Gast", "org": None}, "Schulname erst mit Freigabe der Teamleitung"
    assert marked["guest_team"]["pending"] is False

    audit = await flow.db.audit_logs.find_one({"action": "league.guest_team.confirm", "target_id": team_id}, {"_id": 0})
    assert audit["actor_id"] == lead["id"] and audit["data"]["season_id"] == w["season"]["id"]
    flow.act_as(lead)
    log = ok(await flow.get(f"/api/admin/leagues/seasons/{w['season']['id']}/desk/log"))
    assert any(row.get("label") == "Gastteam · bestätigt" for row in log.get("items") or log.get("entries") or []), log
    told = [row for row in await notes_of(flow, side["lead"]["id"]) if (row.get("meta") or {}).get("reason") == "league_guest_team_confirmed"]
    assert len(told) == 1 and "als Gastteam bestätigt" in told[0]["body"] and SCHOOL not in told[0]["body"]

    released = ok(await set_org(flow, side["lead"], team_id, kind="school", name=SCHOOL, school_name_public=True))
    assert released["guest_badge"] == {"label": "Gast", "org": SCHOOL}

    flow.act_as(None)
    public = ok(await flow.get(f"/api/teams/{team_id}"))
    assert public["guest_badge"] == {"label": "Gast", "org": SCHOOL}
    assert "guest_team" not in public, "die Angaben dahinter sehen nur Team und Verwaltung"
    flow.act_as(side["lead"])
    own = ok(await flow.get(f"/api/teams/{team_id}"))
    assert own["guest_team"]["school_name_public"] is True and own["can_edit_guest_team"] is True
    flow.act_as(side["captain"])
    assert ok(await flow.get(f"/api/teams/{team_id}"))["can_edit_guest_team"] is False


@pytest.mark.asyncio
async def test_a_change_after_the_confirmation_waits_for_the_league_lead_and_revoking_drops_the_badge(flow):
    w = await application_world(flow, teams=1)
    side = w["teams"][0]
    team_id = side["team"]["id"]
    await submitted(flow, w, side)
    ok(await set_org(flow, side["lead"], team_id, kind="club", name="SV Probedorf"))
    lead = await league_lead(flow, w["league"]["id"])
    assert ok(await set_mark(flow, lead, team_id))["guest_badge"] == {"label": "Gast", "org": "SV Probedorf"}

    changed = ok(await set_org(flow, side["lead"], team_id, kind="club", name="Ganz anderer Name"))
    assert changed["guest_badge"] == {"label": "Gast", "org": None}, "öffentlich nur, was die Liga-Leitung gesehen hat"
    assert changed["guest_team"]["pending"] is True
    flow.act_as(lead)
    desk = ok(await flow.get(f"/api/admin/leagues/seasons/{w['season']['id']}/desk"))
    task = next(item for group in desk["groups"] for item in group["items"] if item["kind"] == "applications")
    assert task["guest_pending"] is True and task["guest_badge"] == {"label": "Gast", "org": None}

    again = ok(await set_mark(flow, lead, team_id))
    assert again["guest_badge"] == {"label": "Gast", "org": "Ganz anderer Name"}

    revoked = ok(await set_mark(flow, lead, team_id, confirmed=False))
    assert revoked["guest_badge"] is None and revoked["guest_team"]["name"] == "Ganz anderer Name"
    told = [row for row in await notes_of(flow, side["lead"]["id"]) if (row.get("meta") or {}).get("reason") == "league_guest_team_revoked"]
    assert len(told) == 1
    # Alles weg: Das Team ist wieder wie vor dem Feld.
    ok(await set_org(flow, side["lead"], team_id))
    assert "guest_team" not in await flow.db.teams.find_one({"id": team_id}, {"_id": 0})


@pytest.mark.asyncio
async def test_the_mark_needs_the_applications_right_in_a_league_of_the_team(flow):
    w = await application_world(flow, teams=2)
    side = w["teams"][0]
    team_id = side["team"]["id"]
    flow.act_as(w["lead"])
    other_league = ok(await flow.post("/api/admin/leagues", json={"name": "Andere Liga", "game_id": w["game"]["id"]}))

    # Noch kein Antrag und keine Staffel: auch die Zuständigen dieser Liga nicht.
    lead = await league_lead(flow, w["league"]["id"])
    refused = await set_mark(flow, lead, team_id)
    assert refused.status_code == 403 and refused.json()["detail"] == league_guests.NO_LEAGUE_TEAM
    await submitted(flow, w, side)
    assert (await set_mark(flow, lead, team_id)).status_code == 200
    for person in (await league_lead(flow, other_league["id"]), await league_lead(flow, w["league"]["id"], capabilities=("results",))):
        assert (await set_mark(flow, person, team_id)).status_code == 403
    no_mfa = await league_lead(flow, w["league"]["id"], auth_mfa_verified=False)
    assert "Zwei-Faktor" in (await set_mark(flow, no_mfa, team_id)).json()["detail"]
    area = await flow.add_user(name="Bereich Ligen")
    area["areas"] = ["leagues"]
    assert (await set_mark(flow, area, w["teams"][1]["team"]["id"])).status_code == 200, "der Bereich darf alle Ligen"


@pytest.mark.asyncio
async def test_own_team_needs_a_second_person_and_the_superadmin_needs_a_reason(flow):
    w = await application_world(flow, teams=1)
    side = w["teams"][0]
    team_id = side["team"]["id"]
    await submitted(flow, w, side)
    insider = await league_lead(flow, w["league"]["id"])
    await flow.db.teams.update_one({"id": team_id}, {"$addToSet": {"member_ids": insider["id"]}})
    refused = await set_mark(flow, insider, team_id)
    assert refused.status_code == 403 and refused.json()["detail"] == SIDE_CONFLICT_DETAIL

    boss = await flow.add_staff(name="Superadmin im Team")
    await flow.db.teams.update_one({"id": team_id}, {"$addToSet": {"member_ids": boss["id"]}})
    assert (await set_mark(flow, boss, team_id)).status_code == 403
    assert ok(await set_mark(flow, boss, team_id, conflict_reason="Nur ich bin heute erreichbar"))["guest_badge"]["label"] == "Gast"
    override = await flow.db.audit_logs.find_one({"action": "league.conflict.override", "actor_id": boss["id"]}, {"_id": 0})
    assert override["data"]["action"] == "guest_team_confirm"


@pytest.mark.asyncio
async def test_the_team_lead_data_is_checked_and_screened(flow):
    w = await application_world(flow, teams=1)
    side = w["teams"][0]
    team_id = side["team"]["id"]
    await submitted(flow, w, side)
    assert (await set_org(flow, side["lead"], team_id, name="Ohne Art")).status_code == 422
    assert (await set_org(flow, side["lead"], team_id, kind="club", name="S")).status_code == 422
    assert (await set_org(flow, side["lead"], team_id, kind="verein", name="SV Probedorf")).status_code == 422
    long_name = "Höhere Technische Bundeslehranstalt für Probeberufe am Probeberg Nord"
    saved = ok(await set_org(flow, side["lead"], team_id, kind="school", name=long_name))
    assert saved["guest_team"]["name"] == long_name
    audit = await flow.db.audit_logs.find_one({"action": "team.guest_team.update", "target_id": team_id}, {"_id": 0})
    assert audit["data"]["fields"] == ["kind", "name"] and long_name not in json.dumps(audit), "der Name steht am Team, nicht im Protokoll"


# ---------------------------------------------------------------- Plakette auf den Flächen


async def surface_world(flow) -> dict:
    """Die Spielwelt (Staffel live, ein Spiel Löwen gegen Falken) mit Liga und Season für die öffentlichen Seiten. Löwen sind Gastteam
    einer Schule mit freigegebenem Namen."""
    w = await world(flow)
    league_id = w["tournament"]["league_context"]["league_id"]
    now = now_utc().isoformat()
    await flow.db.leagues.insert_one({"id": league_id, "name": "Probeliga", "slug": "probeliga", "game_id": "probe-shooter",
                                      "status": "active", "created_at": now})
    await flow.db.league_seasons.insert_one({"id": w["season_id"], "league_id": league_id, "number": 1, "name": "Season 1",
                                             "slug": "season-1", "status": "active", "visibility": "public", "created_at": now})
    await flow.db.league_divisions.insert_one({"id": "liga-1", "season_id": w["season_id"], "league_id": league_id, "level": 1,
                                               "status": "active", "overrides": {}, "created_at": now})
    ok(await set_org(flow, w["users"]["LoeLeitung"], w["lions"]["id"], kind="school", name=SCHOOL, school_name_public=True))
    ok(await set_mark(flow, w["staff"], w["lions"]["id"]))
    w["league_id"] = league_id
    return w


def rows_named(rows, registration_id):
    return [row for row in rows if (row.get("registration_id") or row.get("id")) == registration_id]


FULL = {"label": "Gast", "org": SCHOOL}


@pytest.mark.asyncio
async def test_the_badge_stands_on_table_staffel_match_team_and_profile_and_tv_only_says_gast(flow):
    w = await surface_world(flow)
    lions, falcons, tid = w["reg_a"]["id"], w["reg_h"]["id"], w["tournament"]["id"]
    flow.act_as(None)

    table = ok(await flow.get(f"/api/tournaments/{tid}/standings"))
    assert rows_named(table, lions)[0]["guest_badge"] == FULL
    assert "guest_badge" not in rows_named(table, falcons)[0]

    staffel = ok(await flow.get(f"/api/leagues/probeliga/season-1/staffeln/{tid}"))
    assert rows_named(staffel["standings"], lions)[0]["guest_badge"] == FULL
    assert rows_named(staffel["teams"], lions)[0]["guest_badge"] == FULL
    assert "guest_badge" not in rows_named(staffel["teams"], falcons)[0]
    sides = [side for week in staffel["weeks"] for match in week["matches"] for side in (match["home"], match["away"])]
    assert all(side.get("guest_badge") == FULL for side in sides if side["registration_id"] == lions)

    page = ok(await flow.get(f"/api/matches/{w['match']['id']}/page"))
    by_reg = {row["registration_id"]: row for row in page["participants"]}
    assert by_reg[lions]["guest_badge"] == FULL and "guest_badge" not in by_reg[falcons]

    assert ok(await flow.get(f"/api/teams/{w['lions']['id']}"))["guest_badge"] == FULL
    assert "guest_badge" not in ok(await flow.get(f"/api/teams/{w['falcons']['id']}"))

    flow.act_as(w["staff"])
    tv = ok(await flow.get(f"/api/tournaments/{tid}/bracket/display?table=1"))
    assert rows_named(tv["standings"], lions)[0]["guest_badge"] == {"label": "Gast"}, "TV nur „Gast“ (Nr. 286)"
    assert SCHOOL not in json.dumps(tv)
    admin = ok(await flow.get(f"/api/admin/leagues/staffeln/{tid}/table"))
    assert rows_named(admin["standings"], lions)[0]["guest_badge"] == FULL


@pytest.mark.asyncio
async def test_discord_says_only_gast_behind_the_name(flow):
    from services import league_discord, league_page

    w = await surface_world(flow)
    names = await league_discord._names(flow.db, w["tournament"]["id"])
    match = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    line = league_discord.result_line(league_page.public_match(match, names))
    assert "(Gast)" in line and SCHOOL not in line
    table = await league_discord._table(flow.db, w["tournament"])
    lines = league_discord.table_lines(table, 10)
    assert any("(Gast)" in row for row in lines) and not any(SCHOOL in row for row in lines)
    assert sum("(Gast)" in row for row in lines) == 1, "nur die Löwen"


@pytest.mark.asyncio
async def test_without_any_guest_team_no_answer_gets_a_new_field(flow):
    w = await world(flow)
    flow.act_as(None)
    tid = w["tournament"]["id"]
    for url in (f"/api/tournaments/{tid}/standings", f"/api/matches/{w['match']['id']}/page", f"/api/teams/{w['lions']['id']}"):
        text = (await flow.get(url)).text
        assert '"guest_badge"' not in text and '"guest_team"' not in text, url


@pytest.mark.asyncio
async def test_a_school_name_without_release_never_leaves_team_and_league_lead(flow):
    w = await surface_world(flow)
    ok(await set_org(flow, w["users"]["LoeLeitung"], w["lions"]["id"], kind="school", name=SCHOOL, school_name_public=False))
    tid = w["tournament"]["id"]
    for viewer in (None, w["users"]["Fremd"], w["users"]["Falke1"]):
        flow.act_as(viewer)
        for url in (f"/api/tournaments/{tid}/standings", f"/api/leagues/probeliga/season-1/staffeln/{tid}",
                    f"/api/matches/{w['match']['id']}/page", f"/api/teams/{w['lions']['id']}"):
            response = await flow.get(url)
            assert response.status_code == 200, url
            assert SCHOOL not in response.text and '"label": "Gast"' in json.dumps(response.json()), url
    flow.act_as(w["users"]["LoeLeitung"])
    assert SCHOOL in (await flow.get(f"/api/teams/{w['lions']['id']}")).text


# ---------------------------------------------------------------- Auskunft und Kontolöschung


@pytest.mark.asyncio
async def test_export_shows_the_guest_data_and_erasure_leaves_no_person_at_the_team(flow):
    from routes import dsgvo_routes
    from services import account_erasure

    w = await surface_world(flow)
    lead = w["users"]["LoeLeitung"]
    export = await dsgvo_routes._user_data_export(flow.db, lead["id"])
    team = next(row for row in export["teams"] if row["id"] == w["lions"]["id"])
    assert team["guest_team"]["name"] == SCHOOL and team["guest_team"]["school_name_public"] is True
    assert "confirmed_at" in team["guest_team"]

    await account_erasure.erase_related(flow.db, lead, now_utc().isoformat())
    stored = await flow.db.teams.find_one({"id": w["lions"]["id"]}, {"_id": 0})
    assert lead["id"] not in json.dumps(stored["guest_team"]), "am Feld steht nie eine Person"
    assert league_guests.badge(stored) == FULL, "das Kennzeichen gehört dem Team und bleibt"


@pytest.mark.asyncio
async def test_the_profile_shows_the_badge_at_the_current_league(flow):
    w = await surface_world(flow)
    await flow.db.users.update_many({"id": {"$in": [w["users"]["Kapitaen"]["id"], w["users"]["Falke1"]["id"]]}},
                                    {"$set": {"privacy_public_profile": True}})
    flow.act_as(None)
    profile = ok(await flow.get(f"/api/users/public/{w['users']['Kapitaen']['username']}"))
    rows = profile.get("league_current") or []
    assert rows, "die laufende Staffel steht am Profil"
    assert all(row["guest_badge"] == FULL for row in rows if row.get("team_id") == w["lions"]["id"])
    falcon = ok(await flow.get(f"/api/users/public/{w['users']['Falke1']['username']}"))
    assert all("guest_badge" not in row for row in falcon.get("league_current") or [])


# ---------------------------------------------------------------- Datenschutzhinweis für Gäste (Nr. 1)

PRIVACY = "Eigener Hinweis der Liga-Leitung zum Datenschutz."


@pytest.mark.asyncio
async def test_guests_see_the_placeholder_until_the_superadmin_releases_exactly_this_text(flow):
    w = await application_world(flow, teams=2, application_privacy_text=PRIVACY)
    guest, member = w["teams"][0], w["teams"][1]
    member["captain"]["is_club_member"] = True

    flow.act_as(guest["captain"])
    assert ok(await flow.get(f"{base_url(w)}/application"))["privacy"]["text"] == PRIVACY_PLACEHOLDER
    flow.act_as(member["captain"])
    assert ok(await flow.get(f"{base_url(w)}/application"))["privacy"]["text"] == PRIVACY, "Mitglieder sehen den Text der Season"
    application = await submitted(flow, w, guest)
    stored = await flow.db.league_applications.find_one({"id": application["id"]}, {"_id": 0})
    assert stored["privacy_consent"]["text"] == PRIVACY_PLACEHOLDER, "zugestimmt wird dem, was die Person sah"

    release = f"/api/admin/leagues/seasons/{w['season']['id']}/privacy-release"
    lead = await league_lead(flow, w["league"]["id"], capabilities=("season", "applications", "rules"))
    flow.act_as(lead)
    refused = await flow.put(release, json={"released": True})
    assert refused.status_code == 403 and "Superadmin" in refused.json()["detail"]
    flow.act_as(w["lead"])
    ok(await flow.put(release, json={"released": True}))
    audit = await flow.db.audit_logs.find_one({"action": "league.season.privacy_release"}, {"_id": 0})
    assert audit["data"] == {"season_id": w["season"]["id"], "released": True}
    flow.act_as(guest["captain"])
    assert ok(await flow.get(f"{base_url(w)}/application"))["privacy"]["text"] == PRIVACY

    # Ändert die Leitung den Text, gilt die Freigabe nicht mehr.
    flow.act_as(w["lead"])
    ok(await flow.patch(f"/api/admin/leagues/seasons/{w['season']['id']}", json={"application_privacy_text": PRIVACY + " Neu."}))
    flow.act_as(guest["captain"])
    assert ok(await flow.get(f"{base_url(w)}/application"))["privacy"]["text"] == PRIVACY_PLACEHOLDER

    flow.act_as(w["lead"])
    ok(await flow.put(release, json={"released": False}))
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})
    assert "application_privacy_release" not in season


@pytest.mark.asyncio
async def test_without_a_season_text_everybody_sees_the_placeholder_and_release_needs_a_text(flow):
    w = await application_world(flow, teams=1)
    flow.act_as(w["teams"][0]["captain"])
    assert ok(await flow.get(f"{base_url(w)}/application"))["privacy"]["text"] == PRIVACY_PLACEHOLDER
    flow.act_as(w["lead"])
    refused = await flow.put(f"/api/admin/leagues/seasons/{w['season']['id']}/privacy-release", json={"released": True})
    assert refused.status_code == 422
    assert (await submit(flow, w, w["teams"][0])).status_code == 200


# ---------------------------------------------------------------- Nachbesserung nach der Prüfung (27.11.)


@pytest.mark.asyncio
async def test_only_the_lead_of_a_league_where_the_team_plays_now_sets_or_removes_the_mark(flow):
    """Entscheidung B (27.11.): offener oder angenommener Antrag in einer laufenden oder kommenden Season - ein abgelehnter oder
    zurückgezogener Antrag und eine beendete Season geben kein Recht. Der Bereich Ligen darf immer."""
    from league_application_world import decide

    w = await application_world(flow, teams=3)
    lead = await league_lead(flow, w["league"]["id"])
    rejected, withdrawn, playing = w["teams"]
    application = await submitted(flow, w, rejected)
    assert (await decide(flow, w, application, "reject", reason="Kader passt nicht")).status_code == 200
    gone = await submitted(flow, w, withdrawn)
    flow.act_as(withdrawn["captain"])
    assert (await flow.post(f"/api/leagues/{w['league']['slug']}/{w['season']['slug']}/applications/{gone['id']}/withdraw", json={})).status_code == 200
    for side in (rejected, withdrawn):
        refused = await set_mark(flow, lead, side["team"]["id"])
        assert refused.status_code == 403 and refused.json()["detail"] == league_guests.NO_LEAGUE_TEAM, side["team"]["name"]
    await submitted(flow, w, playing)
    assert (await set_mark(flow, lead, playing["team"]["id"])).status_code == 200
    # Season beendet: auch der offene Antrag gibt kein Recht mehr - entfernen auch nicht.
    await flow.db.league_seasons.update_one({"id": w["season"]["id"]}, {"$set": {"status": "completed"}})
    assert (await set_mark(flow, lead, playing["team"]["id"], confirmed=False)).status_code == 403
    area = await flow.add_user(name="Bereich Ligen")
    area["areas"] = ["leagues"]
    assert (await set_mark(flow, area, playing["team"]["id"], confirmed=False)).status_code == 200


@pytest.mark.asyncio
async def test_a_team_assigned_to_a_running_staffel_counts_and_a_finished_staffel_does_not(flow):
    w = await surface_world(flow)
    lead = await league_lead(flow, w["league_id"])
    assert (await set_mark(flow, lead, w["falcons"]["id"])).status_code == 200, "zugeteilt in einer laufenden Staffel"
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"status": "completed"}})
    assert (await set_mark(flow, lead, w["falcons"]["id"], confirmed=False)).status_code == 403


@pytest.mark.asyncio
async def test_the_guest_section_belongs_to_league_teams_only(flow):
    """Entscheidung C (27.11.): Verein oder Schule gibt es nur für Teams mit Liga-Antrag oder schon gekennzeichnete; ``can_edit_guest_team``
    steht nur in den Antworten des eigenen Teams."""
    w = await application_world(flow, teams=1)
    side = w["teams"][0]
    team_id = side["team"]["id"]
    flow.act_as(side["lead"])
    assert ok(await flow.get(f"/api/teams/{team_id}"))["can_edit_guest_team"] is False
    refused = await set_org(flow, side["lead"], team_id, kind="club", name="SV Probedorf")
    assert refused.status_code == 409 and refused.json()["detail"] == league_guests.NOT_A_LEAGUE_TEAM
    await submitted(flow, w, side)
    flow.act_as(side["lead"])
    assert ok(await flow.get(f"/api/teams/{team_id}"))["can_edit_guest_team"] is True
    mine = next(row for row in ok(await flow.get("/api/teams/my")) if row["id"] == team_id)
    assert mine["can_edit_guest_team"] is True
    ok(await set_org(flow, side["lead"], team_id, kind="club", name="SV Probedorf"))
    flow.act_as(side["captain"])
    assert ok(await flow.get(f"/api/teams/{team_id}"))["can_edit_guest_team"] is False, "Mitglied, nicht Teamleitung"
    flow.act_as(None)
    assert "can_edit_guest_team" not in ok(await flow.get(f"/api/teams/{team_id}"))


@pytest.mark.asyncio
async def test_saving_the_team_data_never_drops_the_mark_and_confirming_never_drops_the_data(flow, monkeypatch):
    """Gleichzeitig gespeichert: Die Teamleitung liest das Team, die Liga-Leitung bestätigt dazwischen - die Bestätigung bleibt stehen, und
    umgekehrt bleibt die Angabe der Teamleitung. Jede Seite schreibt nur ihre Teilfelder."""
    from routes import league_guest_routes

    w = await application_world(flow, teams=1)
    side = w["teams"][0]
    team_id = side["team"]["id"]
    await submitted(flow, w, side)
    lead = await league_lead(flow, w["league"]["id"])
    stale = await flow.db.teams.find_one({"id": team_id}, {"_id": 0})
    ok(await set_mark(flow, lead, team_id))
    real_team = league_guest_routes._team

    async def first_stale(db, wanted):
        monkeypatch.setattr(league_guest_routes, "_team", real_team)
        return dict(stale)

    monkeypatch.setattr(league_guest_routes, "_team", first_stale)
    ok(await set_org(flow, side["lead"], team_id, kind="club", name="SV Probedorf"))
    state = (await flow.db.teams.find_one({"id": team_id}, {"_id": 0}))["guest_team"]
    assert state.get("confirmed_at"), "die Bestätigung der Liga-Leitung bleibt"
    assert state["name"] == "SV Probedorf"

    stale = await flow.db.teams.find_one({"id": team_id}, {"_id": 0})
    ok(await set_org(flow, side["lead"], team_id, kind="club", name="SV Probedorf Nord"))
    monkeypatch.setattr(league_guest_routes, "_team", first_stale)
    ok(await set_mark(flow, lead, team_id, confirmed=False))
    state = (await flow.db.teams.find_one({"id": team_id}, {"_id": 0}))["guest_team"]
    assert state["name"] == "SV Probedorf Nord", "die Angabe der Teamleitung bleibt"
    assert not state.get("confirmed_at")


@pytest.mark.asyncio
async def test_a_guest_team_is_not_named_as_member_of_the_club_in_the_link_preview(flow):
    w = await surface_world(flow)
    flow.act_as(None)
    guest = ok(await flow.get("/api/seo/meta", params={"path": f"/teams/{w['lions']['id']}"}))
    assert "SportsTeam" in json.dumps(guest["json_ld"]) and "memberOf" not in json.dumps(guest["json_ld"])
    club = ok(await flow.get("/api/seo/meta", params={"path": f"/teams/{w['falcons']['id']}"}))
    assert "memberOf" in json.dumps(club["json_ld"]), "Vereinsteams bleiben, wie sie sind"

