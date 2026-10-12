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


@pytest.mark.asyncio
async def test_the_management_list_shows_a_helper_only_his_tournament(flow):
    # Die Verwaltungsliste (#1028): Helfer sehen dort nur das Turnier ihres Einsatzes, die Turnierleitung alle - und
    # ohne Zwei-Faktor keines. Die öffentliche Liste bleibt, wie sie ist.
    setup = await tournament_with_helper(flow)
    other = await flow.create_tournament()
    own_id, other_id = setup["tournament"]["id"], other["id"]
    params = {"include_drafts": True, "managed": True}

    flow.act_as(setup["helper"])
    managed = await flow.get("/api/tournaments", params=params)
    public = await flow.get("/api/tournaments", params={"include_drafts": True})
    assert managed.status_code == 200, managed.text
    assert [t["id"] for t in managed.json()] == [own_id], "nur das eigene Turnier"
    assert {own_id, other_id} <= {t["id"] for t in public.json()}, "die öffentliche Liste ändert sich nicht"

    lead = await flow.add_user(role="tournament_admin", name="Leitung")
    flow.act_as({**lead, "auth_mfa_verified": False})
    unconfirmed = await flow.get("/api/tournaments", params=params)
    flow.act_as(lead)
    confirmed = await flow.get("/api/tournaments", params=params)
    assert unconfirmed.json() == [], "ohne Zwei-Faktor nichts zu verwalten"
    assert {own_id, other_id} <= {t["id"] for t in confirmed.json()}


async def _profile(monkeypatch, account: dict, tournament_assignments: int = 0, fast_lap_assignments: int = 0) -> dict:
    """Das Auth-Profil (/auth/me) aus get_current_user - mit einer Datenbank, die nur die Zählungen kennt."""
    from datetime import datetime, timedelta, timezone
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from auth import create_access_token, get_current_user

    monkeypatch.setenv("JWT_SECRET", "profile-tests-secret-with-at-least-32-characters")
    session = {"revoked": False, "expires_at": datetime.now(timezone.utc) + timedelta(days=1)}
    db = SimpleNamespace(
        users=SimpleNamespace(find_one=AsyncMock(return_value={"is_active": True, **account})),
        memberships=SimpleNamespace(find_one=AsyncMock(return_value=None)),
        tournament_staff_assignments=SimpleNamespace(count_documents=AsyncMock(return_value=tournament_assignments)),
        f1_staff_assignments=SimpleNamespace(count_documents=AsyncMock(return_value=fast_lap_assignments)),
        auth_sessions=SimpleNamespace(find_one=AsyncMock(return_value=session), update_one=AsyncMock()),
    )
    monkeypatch.setattr("auth.get_db", lambda: db)
    token = create_access_token(account["id"], "x@example.test", account["role"], "jti-1", "fam-1")
    return await get_current_user(SimpleNamespace(cookies={}, headers={"Authorization": f"Bearer {token}"}))


@pytest.mark.asyncio
async def test_the_profile_shows_the_helper_assignment_apart_from_the_lead(monkeypatch):
    # Der Einsatz steht im Profil getrennt von der Turnierleitung (#1028): die Webseite lässt eine Turnierleitung ohne
    # Zwei-Faktor in ihren Einsatz, aber nicht in die Rechte über alle Turniere.
    lead = {"id": "lead", "role": "tournament_admin"}
    lead_only = await _profile(monkeypatch, lead)
    lead_and_helper = await _profile(monkeypatch, lead, tournament_assignments=1)
    fast_lap_helper = await _profile(monkeypatch, {"id": "fahrer", "role": "player"}, fast_lap_assignments=1)
    nobody = await _profile(monkeypatch, {"id": "spieler", "role": "player"})
    assert (lead_only["is_tournament_staff"], lead_only["has_staff_assignment"]) == (True, False)
    assert (lead_and_helper["is_tournament_staff"], lead_and_helper["has_staff_assignment"]) == (True, True)
    assert (fast_lap_helper["is_tournament_staff"], fast_lap_helper["has_staff_assignment"]) == (True, True)
    assert (nobody["is_tournament_staff"], nobody["has_staff_assignment"]) == (False, False)


@pytest.mark.asyncio
async def test_the_fast_lap_management_list_follows_the_same_rule(flow):
    # Fast-Lap-Verwaltung (#1028): Helfer sehen nur ihre Fast Lap - auch als Entwurf -, keine fremde; eine Turnierleitung
    # aus einer Freigabe ohne Zwei-Faktor sieht nichts zu verwalten, mit Zwei-Faktor alles.
    await flow.db.f1_challenges.insert_many([
        {"id": "fl-eigen", "slug": "eigen", "title": "Eigene Fast Lap", "status": "draft", "visibility": "public", "created_at": "2026-10-01"},
        {"id": "fl-fremd", "slug": "fremd", "title": "Fremde Fast Lap", "status": "live", "visibility": "public", "created_at": "2026-10-02"},
        {"id": "fl-fremd-entwurf", "slug": "fremd-entwurf", "title": "Fremder Entwurf", "status": "draft", "visibility": "public", "created_at": "2026-10-03"},
    ])
    helper = await flow.add_user(role="player", name="Fast-Lap-Helfer")
    helper.update({"mfa_enabled": False, "auth_mfa_verified": False})
    await flow.db.f1_staff_assignments.insert_one({
        "id": "fs-1", "challenge_id": "fl-eigen", "user_id": helper["id"], "role": "scorekeeper", "is_active": True,
    })
    managed = {"include_drafts": True, "managed": True}
    ids = lambda response: {row["id"] for row in response.json()}  # noqa: E731

    flow.act_as(helper)
    helper_managed = await flow.get("/api/f1/challenges", params=managed)
    helper_public = await flow.get("/api/f1/challenges", params={"include_drafts": True})
    assert helper_managed.status_code == 200, helper_managed.text
    assert ids(helper_managed) == {"fl-eigen"}, "nur die eigene Fast Lap, auch als Entwurf"
    assert ids(helper_public) == {"fl-eigen", "fl-fremd"}, "fremde Entwürfe nie, die öffentliche Liste bleibt"

    granted = await flow.add_user(role="player", name="Freigabe")
    granted.update({"areas": ["tournaments"]})
    flow.act_as({**granted, "auth_mfa_verified": False})
    unconfirmed = await flow.get("/api/f1/challenges", params=managed)
    flow.act_as(granted)
    confirmed = await flow.get("/api/f1/challenges", params=managed)
    assert unconfirmed.json() == [], "ohne Zwei-Faktor nichts zu verwalten"
    assert ids(confirmed) == {"fl-eigen", "fl-fremd", "fl-fremd-entwurf"}
