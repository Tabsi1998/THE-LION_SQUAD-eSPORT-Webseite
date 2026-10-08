"""Turnier-Team und Turnierleitung (#1294, #291): die Liste der Helfer zeigt Name und Bild, keine E-Mail-Adressen und
keine Kontorollen. Die Turnierleitung über alle Turniere, Events und Fast Laps (aus Rolle oder Freigabe) braucht, wie
jeder Adminbereich, eine bestätigte Zwei-Faktor-Anmeldung; Helfer eines einzelnen Turniers brauchen sie nicht."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services.permissions import MFA_MESSAGE  # noqa: E402

USER_FIELDS = {"id", "username", "display_name", "avatar_url"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def tournament_with_helper(flow) -> dict:
    tournament = await flow.create_tournament()
    helper = await flow.add_user(role="player", name="Turnierhelfer")
    await flow.db.users.update_one({"id": helper["id"]}, {"$set": {"mfa_enabled": False, "auth_mfa_verified": False}})
    helper.update({"mfa_enabled": False, "auth_mfa_verified": False})
    await flow.db.tournament_staff_assignments.insert_one({
        "id": "ts-1", "tournament_id": tournament["id"], "user_id": helper["id"], "role": "organizer", "scope": "tournament",
        "is_active": True, "created_at": "2026-10-08T10:00:00+00:00",
    })
    return {"tournament": tournament, "helper": helper, "staff": f"/api/tournaments/{tournament['id']}/staff"}


@pytest.mark.asyncio
async def test_the_staff_list_shows_name_and_picture_but_no_address_or_account_role(flow):
    setup = await tournament_with_helper(flow)
    for viewer in (setup["helper"], await flow.add_user(role="tournament_admin", name="Leitung"),
                   await flow.add_user(role="superadmin", name="Vorstand")):
        flow.act_as(viewer)
        listed = await flow.get(setup["staff"])
        assert listed.status_code == 200, listed.text
        rows = listed.json()
        assert len(rows) == 1 and rows[0]["role"] == "organizer", "die Rolle im Turnier steht in der Zuweisung"
        assert set(rows[0]["user"]) == USER_FIELDS and rows[0]["user"]["display_name"] == "Turnierhelfer"


@pytest.mark.asyncio
async def test_the_tournament_lead_needs_a_confirmed_second_factor_helpers_do_not(flow):
    setup = await tournament_with_helper(flow)
    lead = await flow.add_user(role="tournament_admin", name="Leitung")
    flow.act_as({**lead, "auth_mfa_verified": False})
    refused = await flow.get(setup["staff"])
    assert refused.status_code == 403 and refused.json()["detail"] == MFA_MESSAGE

    flow.act_as(lead)
    allowed = await flow.get(setup["staff"])
    assert allowed.status_code == 200, allowed.text

    # Der Helfer dieses Turniers bleibt, wie er war: ohne Zwei-Faktor, nur in seinem Turnier.
    flow.act_as(setup["helper"])
    helper_view = await flow.get(setup["staff"])
    other = await flow.create_tournament()
    elsewhere = await flow.get(f"/api/tournaments/{other['id']}/staff")
    assert helper_view.status_code == 200 and elsewhere.status_code == 403
    assert elsewhere.json()["detail"] != MFA_MESSAGE, "Helfer bekommen keine Zwei-Faktor-Meldung"


@pytest.mark.asyncio
async def test_drafts_need_the_second_factor_too(flow):
    draft = await flow.create_tournament(status="draft")
    lead = await flow.add_user(role="tournament_admin", name="Leitung")
    flow.act_as({**lead, "auth_mfa_verified": False})
    hidden = await flow.get(f"/api/tournaments/{draft['id']}")
    listed_hidden = await flow.get("/api/tournaments", params={"include_drafts": True})
    flow.act_as(lead)
    shown = await flow.get(f"/api/tournaments/{draft['id']}")
    listed = await flow.get("/api/tournaments", params={"include_drafts": True})
    assert hidden.status_code == 404 and shown.status_code == 200, "Entwürfe sieht die Turnierleitung erst mit Zwei-Faktor"
    assert draft["id"] not in {t["id"] for t in listed_hidden.json()} and draft["id"] in {t["id"] for t in listed.json()}
    assert shown.json()["can_manage_results"] is True


@pytest.mark.asyncio
async def test_events_and_fast_laps_follow_the_same_rule(flow):
    await flow.db.events.insert_one({"id": "ev-entwurf", "slug": "ev-entwurf", "name": "Entwurf", "status": "draft", "visibility": "public"})
    await flow.db.f1_challenges.insert_one({"id": "fl-spa", "slug": "spa-test", "title": "Fast Lap Spa", "status": "live"})
    lead = await flow.add_user(role="tournament_admin", name="Leitung")
    flow.act_as({**lead, "auth_mfa_verified": False})
    hidden_event = await flow.get("/api/events/ev-entwurf")
    refused_fast_lap = await flow.get("/api/f1/challenges/fl-spa/staff")
    flow.act_as(lead)
    shown_event = await flow.get("/api/events/ev-entwurf")
    fast_lap_staff = await flow.get("/api/f1/challenges/fl-spa/staff")
    assert hidden_event.status_code == 404 and shown_event.status_code == 200, shown_event.text
    assert refused_fast_lap.status_code == 403 and refused_fast_lap.json()["detail"] == MFA_MESSAGE
    assert fast_lap_staff.status_code == 200, fast_lap_staff.text


def test_team_registration_and_match_checks_follow_the_same_rule():
    from routes import match_routes, tournament_common, tournament_registration_routes

    confirmed = {"id": "lead", "role": "tournament_admin", "mfa_enabled": True, "auth_mfa_verified": True}
    unconfirmed = {**confirmed, "auth_mfa_verified": False}
    foreign_team = {"leader_id": "jemand", "co_leader_ids": []}
    checks = (tournament_common._is_staff, match_routes._is_staff,
              lambda user: tournament_registration_routes._can_register_team(foreign_team, user))
    assert [check(confirmed) for check in checks] == [True, True, True]
    assert [check(unconfirmed) for check in checks] == [False, False, False]
    own_team = {"leader_id": "lead", "co_leader_ids": []}
    assert tournament_registration_routes._can_register_team(own_team, unconfirmed), "das eigene Team ohne Adminrechte"


@pytest.mark.asyncio
async def test_a_lead_who_is_also_a_helper_keeps_the_helper_rights_without_a_second_factor(flow):
    setup = await tournament_with_helper(flow)
    lead = await flow.add_user(role="tournament_admin", name="Leitung und Helfer")
    await flow.db.tournament_staff_assignments.insert_one({
        "id": "ts-2", "tournament_id": setup["tournament"]["id"], "user_id": lead["id"], "role": "referee", "scope": "tournament",
        "is_active": True, "created_at": "2026-10-08T10:05:00+00:00",
    })
    flow.act_as({**lead, "auth_mfa_verified": False})
    own = await flow.get(setup["staff"])
    other = await flow.create_tournament()
    elsewhere = await flow.get(f"/api/tournaments/{other['id']}/staff")
    assert own.status_code == 200, "der Einsatz als Helfer gilt weiter"
    assert elsewhere.status_code == 403 and elsewhere.json()["detail"] == MFA_MESSAGE, "für alle Turniere braucht es Zwei-Faktor"
