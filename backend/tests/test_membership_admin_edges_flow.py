"""Mitgliedschaft in der Vereinsverwaltung, Randfälle (#932) - durch die echte Anwendung statt gegen einen laufenden Server.

- Die Antragsliste nennt Benutzername und E-Mail der antragstellenden Person.
- Ohne Mitgliedschaft meldet /auth/me „community_user“ (echte Anmeldung, nicht das Testgerüst).
- Ruhend gestellt ist niemand mehr Vereinsmitglied; ohne Bereich „Verein“ gibt es dafür 403.
- Mitgliedervorteile: sichtbar für die passende Mitgliedsart, deaktiviert nur noch in der Gesamtliste der Verwaltung.
- Vorstand: zuweisbar sind nur Mitgliederprofile, Standardposten lassen sich nicht löschen.

Ersetzt test_phase_c_iter16.py::test_admin_lists_pending; test_phase_membership.py::test_me_community_user,
::test_demote_to_inactive, ::test_authz_community_cannot_update_membership und TestBenefits
(test_admin_create_visible_to_member, test_patch_deactivate_hides, test_admin_all_includes_inactive,
test_authz_community_cannot_create); test_phase_d_v3.py::test_assignable_users, ::test_delete_default_blocked.
Erfundene Daten, keine echten Personen.
"""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import load_application, make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "membership-edges-secret-with-at-least-32-characters")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def chair_of(flow) -> dict:
    user = await flow.add_user(role="player", name="vorstand")
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": ["club"]}})
    user["areas"] = ["club"]
    return user


async def _auth_me(flow, user: dict) -> dict:
    """/auth/me mit echter Anmeldung - user_type und is_club_member setzt auth.get_current_user, nicht das Testgerüst."""
    from auth import create_access_token

    _database, server, _current, optional = load_application()
    family = new_id()
    await flow.db.auth_sessions.insert_one({
        "family_id": family, "user_id": user["id"], "revoked": False,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
    })
    token = create_access_token(user["id"], user["email"], user["role"], new_id(), family)
    override = server.app.dependency_overrides.pop(optional)
    try:
        response = await flow.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    finally:
        server.app.dependency_overrides[optional] = override
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_antragsliste_nennt_benutzername_und_email(flow):
    chair = await chair_of(flow)
    erika = await flow.add_user(name="erika")
    mara = await flow.add_user(name="mara")
    await flow.db.membership_applications.insert_many([
        {"id": new_id(), "user_id": erika["id"], "status": "pending", "motivation": "Ich spiele gern mit.", "created_at": "2026-10-02T10:00:00+00:00"},
        {"id": new_id(), "user_id": mara["id"], "status": "approved", "motivation": "Schon dabei.", "created_at": "2026-10-01T10:00:00+00:00"},
    ])
    flow.act_as(chair)
    res = await flow.get("/api/membership/applications", params={"status": "pending"})
    assert res.status_code == 200, res.text
    rows = res.json()
    assert [row["user_id"] for row in rows] == [erika["id"]]
    assert rows[0]["user_username"] == "erika" and rows[0]["user_email"] == erika["email"]


@pytest.mark.asyncio
async def test_ohne_mitgliedschaft_ist_man_community_user(flow):
    paula = await flow.add_user(name="paula")
    me = await _auth_me(flow, paula)
    assert me["id"] == paula["id"]
    assert me["user_type"] == "community_user" and me["is_club_member"] is False and me["membership"] is None


@pytest.mark.asyncio
async def test_ruhend_gestellt_und_ohne_bereich_verboten(flow):
    chair = await chair_of(flow)
    erika = await flow.add_user(name="erika")
    await flow.db.memberships.insert_one({"user_id": erika["id"], "member_status": "active", "membership_type": "ordinary", "member_number": "TLS-2026-0007"})

    flow.act_as(await flow.add_user(name="community"))
    refused = await flow.put(f"/api/membership/user/{erika['id']}", json={"member_status": "inactive"})
    assert refused.status_code == 403
    assert (await flow.db.memberships.find_one({"user_id": erika["id"]}))["member_status"] == "active"

    flow.act_as(chair)
    res = await flow.put(f"/api/membership/user/{erika['id']}", json={"member_status": "inactive"})
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["membership"]["member_status"] == "inactive"
    assert data["is_club_member"] is False and data["user_type"] == "community_user"


@pytest.mark.asyncio
async def test_mitgliedervorteile_anlegen_deaktivieren_und_rechte(flow):
    chair = await chair_of(flow)
    erika = await flow.add_user(name="erika")
    await flow.db.memberships.insert_one({"user_id": erika["id"], "member_status": "active", "membership_type": "ordinary"})
    supporter = await flow.add_user(name="foerderer")
    await flow.db.memberships.insert_one({"user_id": supporter["id"], "member_status": "active", "membership_type": "supporting"})
    community = await flow.add_user(name="community")

    flow.act_as(community)
    refused = await flow.post("/api/membership/benefits", json={"title": "Nein", "is_active": True})
    assert refused.status_code == 403
    assert await flow.db.member_benefits.count_documents({}) == 0

    flow.act_as(chair)
    created = await flow.post("/api/membership/benefits", json={
        "title": "Rabatt beim Testsponsor", "description": "Zehn Prozent auf alles.", "category": "Sponsor",
        "visible_for_membership_types": ["ordinary", "honorary"], "is_active": True, "order_index": 1,
    })
    assert created.status_code == 200, created.text
    benefit_id = created.json()["id"]

    flow.act_as(erika)
    assert [b["id"] for b in (await flow.get("/api/membership/benefits")).json()] == [benefit_id]
    flow.act_as(supporter)
    assert (await flow.get("/api/membership/benefits")).json() == [], "nur für die genannten Mitgliedsarten"

    flow.act_as(chair)
    off = await flow.patch(f"/api/membership/benefits/{benefit_id}", json={"is_active": False})
    assert off.status_code == 200 and off.json()["is_active"] is False
    flow.act_as(erika)
    assert (await flow.get("/api/membership/benefits")).json() == []
    flow.act_as(chair)
    everything = await flow.get("/api/membership/benefits/all")
    assert everything.status_code == 200
    assert [(b["id"], b["is_active"]) for b in everything.json()] == [(benefit_id, False)]


@pytest.mark.asyncio
async def test_vorstand_zuweisbar_nur_mitgliederprofile_und_standardposten_bleiben(flow):
    chair = await chair_of(flow)
    await flow.add_user(name="ohne-profil")
    await flow.db.club_member_profiles.insert_many([
        {"id": new_id(), "slug": "erika-profil", "display_name": "Erika Beispiel", "gamertag": "Erika", "is_active": True, "order_index": 1},
        {"id": new_id(), "slug": "mara-profil", "display_name": "Mara Muster", "is_active": True, "order_index": 2},
        {"id": new_id(), "slug": "alt-profil", "display_name": "Alt", "is_active": False, "order_index": 3},
    ])
    pid = new_id()
    await flow.db.board_positions.insert_one({"id": pid, "slug": "kassier", "title_male": "Kassier", "title_female": "Kassierin", "is_active": True,
                                              "is_default": True, "allow_deputy": True, "user_id": None, "deputy_user_id": None, "order_index": 2})
    flow.act_as(chair)
    res = await flow.get("/api/board/assignable-users")
    assert res.status_code == 200, res.text
    rows = res.json()
    assert [row["slug"] for row in rows] == ["erika-profil", "mara-profil"]
    assert all(row["source"] == "member_profile" for row in rows)

    blocked = await flow.delete(f"/api/board/{pid}")
    assert blocked.status_code == 400 and "Standard-Positionen" in blocked.json()["detail"]
    assert await flow.db.board_positions.find_one({"id": pid}) is not None
