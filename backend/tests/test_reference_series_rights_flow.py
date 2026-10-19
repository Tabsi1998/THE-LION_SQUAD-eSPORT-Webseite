"""Rechte externer Serien (#1749): der Vorstand (Bereich Redaktion) darf jede Serie, ein Captain nur seine - mit
Zwei-Faktor, bis einschließlich ``valid_until`` und nicht in archivierten Serien. Kennungen unterhalb der Serie
(Termine, Ergebnisse, Teilnehmer) gehören zur Serie aus dem Pfad, sonst 404. Captains verwaltet nur der Vorstand, jede
Änderung steht im Protokoll. Nur erfundene Namen."""
import pathlib
import sys
from datetime import date, timedelta

import pytest
import pytest_asyncio
from fastapi import HTTPException

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import migrations, reference_series_access  # noqa: E402
from services.dolibarr_policy import club_today  # noqa: E402
from services.reference_series_access import series_access  # noqa: E402

ADMIN = "/api/reference-series/admin"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def _day(offset: int) -> str:
    return (date.fromisoformat(club_today()) + timedelta(days=offset)).isoformat()


async def _setup(flow):
    """Vorstand, zwei Serien (eine fremde), ein Captain für die erste."""
    await migrations.migrate_points_scheme_templates(flow.db)
    board = await flow.add_user(role="user", name="vorstand-vera")
    await flow.db.users.update_one({"id": board["id"]}, {"$set": {"areas": ["content"]}})
    board["areas"] = ["content"]
    flow.act_as(board)
    lineage = (await flow.post(f"{ADMIN}/lineages", json={"title": "Probe Racing F1", "kind": "racing"})).json()
    own = (await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2026"})).json()
    other = (await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2027"})).json()
    captain = await flow.add_user(name="captain-carla")
    added = await flow.post(f"{ADMIN}/series/{own['id']}/staff",
                            json={"user_id": captain["id"], "valid_until": _day(30)})
    assert added.status_code == 200, added.text
    return board, captain, own, other, added.json()


# ---------------------------------------------------------------- Captain verwalten
@pytest.mark.asyncio
async def test_the_board_adds_changes_and_removes_a_captain_and_every_step_is_logged(flow):
    board, captain, own, _, staff = await _setup(flow)
    assert (staff["name"], staff["can_publish"], staff["is_valid"], staff["valid_until"]) == (
        "captain-carla", False, True, _day(30))
    assert "email" not in staff

    listed = (await flow.get(f"{ADMIN}/series/{own['id']}/staff")).json()
    assert [row["id"] for row in listed["staff"]] == [staff["id"]] and listed["publish_mode"] == "review"

    twice = await flow.post(f"{ADMIN}/series/{own['id']}/staff", json={"user_id": captain["id"], "valid_until": _day(3)})
    assert twice.status_code == 409

    changed = await flow.patch(f"{ADMIN}/series/{own['id']}/staff/{staff['id']}",
                               json={"can_publish": True, "valid_until": _day(60)})
    assert changed.status_code == 200, changed.text
    assert (changed.json()["can_publish"], changed.json()["valid_until"]) == (True, _day(60))

    removed = await flow.delete(f"{ADMIN}/series/{own['id']}/staff/{staff['id']}")
    assert removed.status_code == 200
    assert await flow.db.reference_series_staff.count_documents({}) == 0

    actions = [row["action"] async for row in flow.db.audit_logs.find({"target_id": own["id"]}).sort("created_at", 1)]
    assert actions == ["reference_series.staff_add", "reference_series.staff_update", "reference_series.staff_remove"]
    update = await flow.db.audit_logs.find_one({"action": "reference_series.staff_update"})
    assert update["actor_id"] == board["id"]
    assert update["data"]["before"] == {"can_publish": False, "valid_until": _day(30)}


@pytest.mark.asyncio
async def test_a_captain_right_needs_an_end_that_is_not_in_the_past(flow):
    _, captain, own, _, staff = await _setup(flow)
    other = await flow.add_user(name="ohne-ende")
    missing = await flow.post(f"{ADMIN}/series/{own['id']}/staff", json={"user_id": other["id"]})
    assert missing.status_code == 422
    past = await flow.post(f"{ADMIN}/series/{own['id']}/staff", json={"user_id": other["id"], "valid_until": _day(-1)})
    assert past.status_code == 422
    cleared = await flow.patch(f"{ADMIN}/series/{own['id']}/staff/{staff['id']}", json={"valid_until": None})
    assert cleared.status_code == 422
    nonsense = await flow.patch(f"{ADMIN}/series/{own['id']}/staff/{staff['id']}", json={"valid_until": "bald"})
    assert nonsense.status_code == 422
    unknown = await flow.post(f"{ADMIN}/series/{own['id']}/staff", json={"user_id": "gibt-es-nicht", "valid_until": _day(1)})
    assert unknown.status_code == 404


@pytest.mark.asyncio
async def test_only_the_board_manages_captains_and_staff_ids_belong_to_the_series(flow):
    _, captain, own, other, staff = await _setup(flow)
    # Über die fremde Serie im Pfad kommt man nicht an den Captain der eigenen.
    assert (await flow.patch(f"{ADMIN}/series/{other['id']}/staff/{staff['id']}", json={"can_publish": True})).status_code == 404
    foreign_delete = await flow.delete(f"{ADMIN}/series/{other['id']}/staff/{staff['id']}")
    assert foreign_delete.status_code == 404

    flow.act_as(captain)
    assert (await flow.get(f"{ADMIN}/series/{own['id']}/staff")).status_code == 403
    assert (await flow.post(f"{ADMIN}/series/{own['id']}/staff",
                            json={"user_id": captain["id"], "valid_until": _day(99)})).status_code == 403
    assert (await flow.patch(f"{ADMIN}/series/{own['id']}/staff/{staff['id']}", json={"can_publish": True})).status_code == 403
    # Die Saison selbst bearbeiten oder archivieren bleibt beim Vorstand.
    assert (await flow.patch(f"{ADMIN}/series/{own['id']}", json={"publish_mode": "direct"})).status_code == 403
    assert (await flow.post(f"{ADMIN}/series/{own['id']}/archive")).status_code == 403


# ---------------------------------------------------------------- Prüfung je Aufruf
@pytest.mark.asyncio
async def test_a_captain_opens_only_the_own_series(flow):
    _, captain, own, other, _ = await _setup(flow)
    flow.act_as(captain)
    mine = await flow.get(f"{ADMIN}/series/{own['id']}")
    assert mine.status_code == 200, mine.text
    assert mine.json()["access"] == {"role": "captain", "can_publish": False, "valid_until": _day(30)}
    assert (await flow.get(f"{ADMIN}/series/{other['id']}")).status_code == 403
    # Eine Serie, die es nicht gibt, sieht für Captains aus wie eine fremde - kein Hinweis, ob es sie gibt.
    assert (await flow.get(f"{ADMIN}/series/gibt-es-nicht")).status_code == 403
    assert (await flow.get(f"{ADMIN}")).status_code == 403


@pytest.mark.asyncio
async def test_the_right_ends_after_valid_until_and_is_checked_on_every_call(flow, monkeypatch):
    _, captain, own, _, _ = await _setup(flow)
    flow.act_as(captain)
    assert (await flow.get(f"{ADMIN}/series/{own['id']}")).status_code == 200
    # Der letzte Tag zählt noch mit, der Tag danach nicht mehr - ohne neu anzumelden.
    monkeypatch.setattr(reference_series_access, "club_today", lambda: _day(30))
    assert (await flow.get(f"{ADMIN}/series/{own['id']}")).status_code == 200
    monkeypatch.setattr(reference_series_access, "club_today", lambda: _day(31))
    expired = await flow.get(f"{ADMIN}/series/{own['id']}")
    assert expired.status_code == 403 and "abgelaufen" in expired.json()["detail"]
    assert (await flow.get("/api/users/me/duty")).json()["series"] == []


@pytest.mark.asyncio
async def test_a_stored_right_without_a_valid_end_never_counts(flow):
    _, captain, own, _, staff = await _setup(flow)
    for broken in (None, "", "irgendwann", 20991231):
        await flow.db.reference_series_staff.update_one({"id": staff["id"]}, {"$set": {"valid_until": broken}})
        with pytest.raises(HTTPException) as refused:
            await series_access(captain, own["id"])
        assert refused.value.status_code == 403


@pytest.mark.asyncio
async def test_without_two_factor_neither_captain_nor_board_gets_in(flow):
    board, captain, own, _, _ = await _setup(flow)
    for person in (captain, board):
        flow.act_as({**person, "auth_mfa_verified": False})
        refused = await flow.get(f"{ADMIN}/series/{own['id']}")
        assert refused.status_code == 403 and "Zwei-Faktor" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_an_archived_series_is_closed_for_captains(flow):
    board, captain, own, _, _ = await _setup(flow)
    assert (await flow.post(f"{ADMIN}/series/{own['id']}/archive")).status_code == 200
    flow.act_as(captain)
    assert (await flow.get(f"{ADMIN}/series/{own['id']}")).status_code == 403
    assert (await flow.get("/api/users/me/duty")).json()["series"] == []


# ---------------------------------------------------------------- Entwurf oder direkt
@pytest.mark.asyncio
async def test_captain_entries_are_drafts_unless_the_series_or_the_captain_publishes_directly(flow):
    board, captain, own, _, staff = await _setup(flow)
    access = await series_access(captain, own["id"])
    assert access.can_publish is False and access.result_status(None) == "draft"
    assert access.result_status("draft") == "draft"
    with pytest.raises(HTTPException) as refused:
        access.result_status("published")
    assert refused.value.status_code == 403

    flow.act_as(board)
    await flow.patch(f"{ADMIN}/series/{own['id']}", json={"publish_mode": "direct"})
    assert (await series_access(captain, own["id"])).result_status("published") == "published"

    await flow.patch(f"{ADMIN}/series/{own['id']}", json={"publish_mode": "review"})
    await flow.patch(f"{ADMIN}/series/{own['id']}/staff/{staff['id']}", json={"can_publish": True})
    assert (await series_access(captain, own["id"])).can_publish is True

    board_access = await series_access(board, own["id"])
    assert board_access.is_board and board_access.result_status("published") == "published"
    board_access.require_board()
    with pytest.raises(HTTPException):
        (await series_access(captain, own["id"])).require_board()


# ---------------------------------------------------------------- Kennungen fremder Serien
@pytest.mark.asyncio
async def test_round_result_and_participant_ids_of_another_series_answer_404(flow):
    board, captain, own, other, _ = await _setup(flow)
    await flow.db.reference_rounds.insert_many([
        {"id": "runde-eigen", "series_id": own["id"]}, {"id": "runde-fremd", "series_id": other["id"]}])
    await flow.db.reference_round_results.insert_one({"id": "blatt-fremd", "series_id": other["id"]})
    await flow.db.reference_participants.insert_one({"id": "fahrer-fremd", "series_id": other["id"]})
    for person in (captain, board):
        access = await series_access(person, own["id"])
        assert (await access.round("runde-eigen"))["id"] == "runde-eigen"
        for load, item_id in ((access.round, "runde-fremd"), (access.result, "blatt-fremd"),
                              (access.participant, "fahrer-fremd")):
            with pytest.raises(HTTPException) as missing:
                await load(item_id)
            assert missing.value.status_code == 404


# ---------------------------------------------------------------- Meine Serien
@pytest.mark.asyncio
async def test_my_series_lists_only_own_valid_series_and_flags_the_account(flow):
    board, captain, own, other, _ = await _setup(flow)
    flow.act_as(captain)
    duty = (await flow.get("/api/users/me/duty")).json()
    assert [(row["id"], row["lineage_title"], row["season"], row["url"]) for row in duty["series"]] == [
        (own["id"], "Probe Racing F1", "2026", f"/admin/reference-series/{own['id']}")]
    me = (await flow.get("/api/auth/me")).json()
    assert me["has_series_captain"] is True

    flow.act_as(board)
    assert (await flow.get("/api/users/me/duty")).json()["series"] == []
    assert (await flow.get("/api/auth/me")).json()["has_series_captain"] is False


@pytest.mark.asyncio
async def test_the_person_search_for_captains_is_for_the_board_only(flow):
    board, captain, *_ = await _setup(flow)
    found = await flow.get("/api/admin/people/search", params={"purpose": "reference_series", "q": "captain"})
    assert found.status_code == 200 and [hit["name"] for hit in found.json()] == ["captain-carla"]
    flow.act_as(captain)
    assert (await flow.get("/api/admin/people/search",
                           params={"purpose": "reference_series", "q": "vorstand"})).status_code == 403
