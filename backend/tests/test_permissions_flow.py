"""Rollen und Rechte (#287–#291) durch die echte Anwendung: eine Turnierleitung kommt
nicht an News, eine Freigabe öffnet genau einen Bereich, ein Vorstandsposten öffnet die
Vereinsverwaltung, Club-Admins brauchen Zwei-Faktor auch für Mitgliederdaten, und ein
Organisator verwaltet die Gewinne seines Turniers - sonst nichts."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from services.migrations import migrate_team_leader_role  # noqa: E402

NEWS_ADMIN = "/api/admin/news"
MEMBERS = "/api/membership"
BRANDING = "/api/settings/branding"
PRIZES = "/api/prizes"
REPORTS = "/api/moderation/reports"
EXPORT = "/api/exports/qr/sign.pdf"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def status(flow, url):
    return (await flow.get(url)).status_code


async def detail(flow, url):
    return (await flow.get(url)).json().get("detail", "")


@pytest.mark.asyncio
async def test_a_tournament_admin_runs_tournaments_but_not_the_newsroom(flow):
    tl = await flow.add_user(role="tournament_admin", name="turnierleitung")
    flow.act_as(tl)
    assert await status(flow, PRIZES) == 200
    assert await status(flow, NEWS_ADMIN) == 403
    assert "Redaktion" in await detail(flow, NEWS_ADMIN)
    assert await status(flow, MEMBERS) == 403
    assert await status(flow, BRANDING) == 403
    assert "System" in await detail(flow, BRANDING)


@pytest.mark.asyncio
async def test_a_grant_opens_exactly_one_area(flow):
    writer = await flow.add_user(role="player", name="redakteurin")
    await flow.db.users.update_one({"id": writer["id"]}, {"$set": {"areas": ["content"]}})
    writer["areas"] = ["content"]
    flow.act_as(writer)
    assert await status(flow, NEWS_ADMIN) == 200
    assert await status(flow, PRIZES) == 403
    assert await status(flow, MEMBERS) == 403

    me = (await flow.get("/api/auth/me")).json()
    assert me["areas"] == ["content"]


@pytest.mark.asyncio
async def test_a_board_seat_opens_the_club_administration(flow):
    chair = await flow.add_user(role="player", name="obfrau")
    await flow.db.board_positions.insert_one({"id": new_id(), "slug": "obmann", "title_male": "Obmann", "is_active": True, "user_id": chair["id"], "deputy_user_id": None})
    flow.act_as(chair)
    assert await status(flow, MEMBERS) == 200
    assert await status(flow, BRANDING) == 403, "System bleibt an Club-Admin und Superadmin gebunden"
    assert await status(flow, NEWS_ADMIN) == 403
    assert (await flow.get("/api/auth/me")).json()["areas"] == ["club"]

    # Über das Mitgliederprofil zugeordnet zählt genauso; ein ruhender Posten nicht.
    deputy = await flow.add_user(role="player", name="vize")
    profile_id = new_id()
    await flow.db.club_member_profiles.insert_one({"id": profile_id, "user_id": deputy["id"], "slug": "vize"})
    await flow.db.board_positions.insert_one({"id": new_id(), "slug": "kassier", "title_male": "Kassier", "is_active": True, "user_id": None, "deputy_user_id": profile_id})
    flow.act_as(deputy)
    assert await status(flow, MEMBERS) == 200
    await flow.db.board_positions.update_one({"slug": "kassier"}, {"$set": {"is_active": False}})
    assert await status(flow, MEMBERS) == 403


@pytest.mark.asyncio
async def test_club_admins_need_a_second_factor_for_member_data_too(flow):
    admin = await flow.add_user(role="club_admin", name="clubadmin")
    await flow.db.users.update_one({"id": admin["id"]}, {"$set": {"auth_mfa_verified": False}})
    admin["auth_mfa_verified"] = False
    flow.act_as(admin)
    assert await status(flow, MEMBERS) == 403
    assert "Zwei-Faktor" in await detail(flow, MEMBERS)
    assert await status(flow, BRANDING) == 403
    admin["auth_mfa_verified"] = True
    assert await status(flow, MEMBERS) == 200
    assert await status(flow, BRANDING) == 200


@pytest.mark.asyncio
async def test_moderators_moderate_without_a_second_factor_but_exports_need_one(flow):
    mod = await flow.add_user(role="moderator", name="moderator")
    mod["auth_mfa_verified"] = False
    flow.act_as(mod)
    assert await status(flow, REPORTS) == 200
    assert await status(flow, EXPORT) == 403
    assert "Zwei-Faktor" in await detail(flow, EXPORT)
    assert await status(flow, NEWS_ADMIN) == 403


@pytest.mark.asyncio
async def test_only_the_superadmin_grants_areas_and_only_known_ones(flow):
    superadmin = await flow.add_user(role="superadmin", name="root")
    target = await flow.add_user(role="player", name="helfer")
    flow.act_as(superadmin)
    changed = await flow.put(f"/api/users/{target['id']}/areas", json={"areas": ["club", "content", "club"]})
    assert changed.status_code == 200, changed.text
    assert changed.json()["areas"] == ["content", "club"]
    audit = await flow.db.audit_logs.find_one({"action": "user.areas_change", "target_id": target["id"]}, {"_id": 0})
    assert audit and audit["data"]["areas"] == ["content", "club"]

    bad = await flow.put(f"/api/users/{target['id']}/areas", json={"areas": ["system"]})
    assert bad.status_code == 400

    club_admin = await flow.add_user(role="club_admin", name="clubadmin")
    flow.act_as(club_admin)
    assert (await flow.put(f"/api/users/{target['id']}/areas", json={"areas": ["content"]})).status_code == 403


@pytest.mark.asyncio
async def test_an_organizer_manages_the_prizes_of_his_tournament_only(flow):
    organizer = await flow.add_user(role="player", name="orga")
    organizer["auth_mfa_verified"] = False
    mine, other = new_id(), new_id()
    await flow.db.tournaments.insert_many([
        {"id": mine, "name": "Mein Cup", "slug": "mein-cup", "status": "completed"},
        {"id": other, "name": "Fremder Cup", "slug": "fremder-cup", "status": "completed"},
    ])
    await flow.db.tournament_staff_assignments.insert_one({"id": new_id(), "tournament_id": mine, "user_id": organizer["id"], "role": "organizer", "is_active": True})
    await flow.db.prize_pickups.insert_many([
        {"id": "p-mine", "tournament_id": mine, "user_id": organizer["id"], "place": 1, "prize_label": "Pokal", "status": "pending", "created_at": "2026-09-16T10:00:00+00:00"},
        {"id": "p-other", "tournament_id": other, "user_id": organizer["id"], "place": 1, "prize_label": "Pokal", "status": "pending", "created_at": "2026-09-16T10:00:00+00:00"},
    ])
    flow.act_as(organizer)
    assert (await flow.get(f"{PRIZES}?tournament_id={mine}")).status_code == 200
    assert (await flow.get(f"{PRIZES}?tournament_id={other}")).status_code == 403
    assert (await flow.get(PRIZES)).status_code == 403, "ohne Turnier-Bezug bleibt es die Turnierleitung"
    assert (await flow.patch(f"{PRIZES}/p-mine", json={"notes": "abgeholt am Stand"})).status_code == 200
    assert (await flow.patch(f"{PRIZES}/p-other", json={"notes": "x"})).status_code == 403
    assert (await flow.client.delete(f"{PRIZES}/p-other")).status_code == 403
    assert (await flow.client.delete(f"{PRIZES}/p-mine")).status_code == 200


@pytest.mark.asyncio
async def test_team_leader_accounts_become_players_once(flow):
    await flow.db.users.insert_many([
        {"id": "u-tl", "username": "alt", "role": "team_leader", "is_active": True},
        {"id": "u-pl", "username": "neu", "role": "player", "is_active": True},
    ])
    assert await migrate_team_leader_role(flow.db) == "1 team_leader accounts set to player"
    assert (await flow.db.users.find_one({"id": "u-tl"}, {"_id": 0, "role": 1}))["role"] == "player"
    assert await flow.db.audit_logs.count_documents({"action": "user.role_change", "target_id": "u-tl"}) == 1
    assert await migrate_team_leader_role(flow.db) == "no team_leader accounts"
