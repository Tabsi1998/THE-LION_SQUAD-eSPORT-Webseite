"""Vorstand besetzen (#1355): nur Vereinsverwaltung und System, nur Vereinsmitglieder, jede Besetzung im Protokoll -
und führt Dolibarr den Vorstand, lässt sich hier nichts ändern."""
import pathlib
import sys
from datetime import datetime, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def granted(flow, name: str, *areas: str) -> dict:
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": list(areas)}})
    user["areas"] = list(areas)
    return user


async def member(flow, name: str) -> dict:
    user = await flow.add_user(name=name)
    await flow.db.memberships.insert_one({"user_id": user["id"], "member_status": "active", "source": "website"})
    return user


async def position(flow, slug: str = "kassier") -> str:
    pid = new_id()
    await flow.db.board_positions.insert_one({"id": pid, "slug": slug, "title_male": "Kassier", "title_female": "Kassierin", "is_active": True,
                                              "is_default": True, "allow_deputy": True, "user_id": None, "deputy_user_id": None, "order_index": 2})
    return pid


@pytest.mark.asyncio
async def test_only_the_club_area_fills_a_post_and_only_with_club_members(flow):
    pid = await position(flow)
    erika = await member(flow, "erika")
    community = await flow.add_user(name="community")
    profile_id = new_id()
    await flow.db.club_member_profiles.insert_one({"id": profile_id, "display_name": "Mara ohne Konto", "is_active": True})

    for actor in (await flow.add_user(role="tournament_admin", name="turnierleitung"), await granted(flow, "redaktion", "content")):
        flow.act_as(actor)
        patched = await flow.patch(f"/api/board/{pid}", json={"user_id": erika["id"]})
        assert patched.status_code == 403, patched.text
        state = await flow.get("/api/board/admin/state")
        assert state.status_code == 403

    chair = await granted(flow, "vorstand", "club")
    flow.act_as(chair)
    refused = await flow.patch(f"/api/board/{pid}", json={"user_id": community["id"]})
    assert refused.status_code == 400 and "Vereinsmitglieder" in refused.json()["detail"]
    stored = await flow.db.board_positions.find_one({"id": pid})
    assert stored["user_id"] is None

    filled = await flow.patch(f"/api/board/{pid}", json={"user_id": erika["id"]})
    assert filled.status_code == 200, filled.text
    deputy = await flow.patch(f"/api/board/{pid}", json={"deputy_user_id": profile_id})
    assert deputy.status_code == 200, deputy.text
    audits = [row async for row in flow.db.audit_logs.find({"action": "board.assign", "target_id": pid}, {"_id": 0})]
    assert [(row["data"]["field"], row["data"]["to"], row["actor_id"]) for row in audits] == [("holder", erika["id"], chair["id"]), ("deputy", profile_id, chair["id"])]

    # Mit dem Posten kommt die Vereinsverwaltung - erst nach der Besetzung.
    flow.act_as(erika)
    me = await flow.get("/api/auth/me")
    assert "club" in me.json()["areas"]
    flow.act_as(chair)
    state = await flow.get("/api/board/admin/state")
    assert state.json() == {"dolibarr_leads": False, "rights_from_dolibarr": False}


@pytest.mark.asyncio
async def test_when_dolibarr_leads_the_board_nothing_changes_here(flow):
    from services.club_facts import COLLECTION, STATE_ID

    pid = await position(flow)
    erika = await member(flow, "erika")
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"id": "branding", "legal_from_dolibarr": True}}, upsert=True)
    await flow.db[COLLECTION].insert_one({"id": STATE_ID, "fetched_at": datetime.now(timezone.utc).isoformat(), "organization": {"name": "Verein"},
                                         "board": [{"code": "kassier", "label": "Kassier", "board": True}]})
    flow.act_as(await granted(flow, "vorstand", "club"))
    state = await flow.get("/api/board/admin/state")
    assert state.json()["dolibarr_leads"] is True
    for method, url, kwargs in (
        ("patch", f"/api/board/{pid}", {"json": {"user_id": erika["id"]}}),
        ("patch", f"/api/board/{pid}", {"json": {"is_active": False}}),
        ("post", "/api/board", {"json": {"title_male": "Schriftführer"}}),
        ("delete", f"/api/board/{pid}", {}),
    ):
        answer = await getattr(flow, method)(url, **kwargs)
        assert answer.status_code == 409, (method, url, answer.text)
        assert "Dolibarr" in answer.json()["detail"]
    stored = await flow.db.board_positions.find_one({"id": pid})
    assert stored["user_id"] is None


@pytest.mark.asyncio
async def test_with_dolibarr_functions_a_post_is_only_for_display(flow):
    from services.dolibarr_client import SETTINGS_ID

    await flow.db.settings.insert_one({"id": SETTINGS_ID, "mode": "live",
                                       "function_policy": {"approved_at": datetime.now(timezone.utc).isoformat(), "version": 1, "map": {"kassier": ["club"]}}})
    flow.act_as(await flow.add_user(role="superadmin", name="root"))
    state = await flow.get("/api/board/admin/state")
    assert state.json() == {"dolibarr_leads": False, "rights_from_dolibarr": True}
