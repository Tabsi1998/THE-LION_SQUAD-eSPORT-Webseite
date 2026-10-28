"""Gewinne (#2123): erst nach dem Ergebnis, Abholfrist ab „Bereit“, Meldungen auch in der Glocke, Protokoll.

- TA23: „Gewinne erzeugen“ erst ab „Beendet“ (409 vorher); nach einer Korrektur werden Gewinne, deren Platz nicht mehr
  stimmt, als „nach Korrektur prüfen“ markiert - nie entzogen; von Hand angelegte (Sonderpreise) bleiben unberührt.
- ER1: die Frist läuft erst ab „Bereit“, „Offen“ verfällt nie, ein verfallener Gewinn lässt sich wieder öffnen.
- ER2: „Zurück“ aus „Abgeholt“ schickt keine zweite „abholbereit“-Meldung.
- ER3: Bereit/Abgeholt/Verfallen auch per Glocke; Team-Gewinne gehen an die Teamleitung.
- ER4: Bereit, Abgeholt, Zurück und Löschen stehen im Protokoll.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def mails(monkeypatch):
    from services import notification_preferences

    sent = []

    async def send_user_template(user, template_key, category=None, **kwargs):
        sent.append((user.get("id"), template_key))
        return {"ok": True}

    monkeypatch.setattr(notification_preferences, "send_user_template", send_user_template)
    return sent


class Standing:
    def __init__(self):
        self.by_rank: dict[int, list[dict]] = {}

    def __call__(self, _snapshot, _regs, sections=None, tournament=None):
        return {} if sections and "lb" in sections else {rank: list(rows) for rank, rows in self.by_rank.items()}


async def tournament_with_prizes(flow, monkeypatch, status="live"):
    from services import prize_service

    standing = Standing()
    monkeypatch.setattr(prize_service, "placements_for_structure", standing)
    tournament = await flow.create_tournament(title="Winter-Cup", status=status, prize_places=[
        {"group": "overall", "place": 1, "label": "1. Platz", "value": "Pokal"},
        {"group": "special", "place": 1, "label": "Fair-Play-Preis", "value": "Kappe"},
    ])
    flow.act_as(await flow.add_staff())
    return tournament, standing


async def pickups(flow, tid):
    rows = await flow.db.prize_pickups.find({"tournament_id": tid}, {"_id": 0}).to_list(20)
    return sorted((row["place"], row.get("user_id"), bool(row.get("needs_review"))) for row in rows)


@pytest.mark.asyncio
async def test_prizes_come_only_after_the_end_and_stale_ones_are_marked(flow, monkeypatch):
    tournament, standing = await tournament_with_prizes(flow, monkeypatch)
    anna, bert = await flow.add_user(name="anna"), await flow.add_user(name="bert")
    standing.by_rank = {1: [{"user_id": anna["id"]}]}
    response = await flow.post(f"/api/prizes/auto-create/{tournament['id']}")
    assert response.status_code == 409 and "beendet" in response.json()["detail"]
    assert await flow.db.prize_pickups.count_documents({}) == 0
    assert await flow.db.notifications.count_documents({}) == 0

    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "completed"}})
    response = await flow.post(f"/api/prizes/auto-create/{tournament['id']}")
    assert response.json() == {"created": 1}
    pickup = await flow.db.prize_pickups.find_one({"user_id": anna["id"]}, {"_id": 0})
    assert pickup["pickup_deadline"] is None and pickup["prize_value"] == "Pokal"
    # Sonderpreis von Hand - die Korrektur fasst ihn nicht an.
    manual = await flow.post("/api/prizes", json={"tournament_id": tournament["id"], "user_id": bert["id"], "place": 7,
                                                  "prize_label": "Fair-Play-Preis"})
    assert manual.status_code == 200, manual.text
    assert manual.json()["pickup_deadline"] is None

    standing.by_rank = {1: [{"user_id": bert["id"]}]}
    response = await flow.post(f"/api/prizes/auto-create/{tournament['id']}")
    assert response.json() == {"created": 1}
    assert await pickups(flow, tournament["id"]) == sorted([(1, anna["id"], True), (1, bert["id"], False), (7, bert["id"], False)])
    assert await flow.db.notifications.count_documents({"kind": "prize_pending"}) == 2


@pytest.mark.asyncio
async def test_a_republish_marks_prizes_whose_place_changed(flow, monkeypatch):
    from services import prize_service

    tournament, standing = await tournament_with_prizes(flow, monkeypatch, status="completed")
    anna, bert = await flow.add_user(name="anna"), await flow.add_user(name="bert")
    standing.by_rank = {1: [{"user_id": anna["id"]}]}
    await prize_service.auto_create_for_tournament(tournament["id"])
    standing.by_rank = {1: [{"user_id": bert["id"]}]}
    assert await prize_service.auto_create_for_tournament(tournament["id"]) == 1
    assert await pickups(flow, tournament["id"]) == sorted([(1, anna["id"], True), (1, bert["id"], False)])
    standing.by_rank = {1: [{"user_id": anna["id"]}]}
    await prize_service.auto_create_for_tournament(tournament["id"])
    assert await pickups(flow, tournament["id"]) == sorted([(1, anna["id"], False), (1, bert["id"], True)])


async def pickup(flow, **fields):
    from models import new_id

    doc = {"id": new_id(), "tournament_id": "t-1", "tournament_title": "Cup", "user_id": None, "team_id": None,
           "place": 1, "prize_group": "overall", "prize_label": "1. Platz", "prize_value": "Pokal", "status": "pending",
           "pickup_deadline": None, "created_at": now_utc().isoformat(), **fields}
    await flow.db.prize_pickups.insert_one(dict(doc))
    return doc


@pytest.mark.asyncio
async def test_the_deadline_starts_with_ready_and_open_prizes_never_expire(flow, mails):
    from services import prize_service

    flow.act_as(await flow.add_staff())
    anna = await flow.add_user(name="anna")
    past = (now_utc() - timedelta(days=1)).isoformat()
    # Altbestand: „Offen“ mit einer Frist ab Anlegen, die vorbei ist - verfällt nicht mehr.
    old_open = await pickup(flow, user_id=anna["id"], pickup_deadline=past)
    assert await prize_service.expire_overdue() == 0

    response = await flow.patch(f"/api/prizes/{old_open['id']}", json={"status": "ready"})
    assert response.status_code == 200, response.text
    deadline = response.json()["pickup_deadline"]
    assert deadline > (now_utc() + timedelta(days=89)).isoformat()
    assert mails == [(anna["id"], "prize_ready")]
    bell = await flow.db.notifications.find_one({"user_id": anna["id"], "kind": "prize_status"}, {"_id": 0})
    assert bell["title"] == "Gewinn abholbereit" and bell["url"] == "/me/prizes"

    await flow.db.prize_pickups.update_one({"id": old_open["id"]}, {"$set": {"pickup_deadline": past}})
    assert await prize_service.expire_overdue() == 1
    expired = await flow.db.prize_pickups.find_one({"id": old_open["id"]}, {"_id": 0})
    assert expired["status"] == "expired" and mails[-1] == (anna["id"], "prize_expired")
    assert await flow.db.notifications.count_documents({"user_id": anna["id"], "title": "Gewinn verfallen"}) == 1

    # Wieder öffnen: neue Frist, Meldung „wieder abholbereit“.
    reopened = await flow.patch(f"/api/prizes/{old_open['id']}", json={"status": "ready"})
    assert reopened.json()["status"] == "ready" and reopened.json()["pickup_deadline"] > now_utc().isoformat()
    assert await flow.db.notifications.count_documents({"title": "Gewinn wieder abholbereit"}) == 1
    actions = [row["action"] for row in await flow.db.audit_logs.find({}, {"_id": 0}).to_list(10)]
    assert actions == ["prizes.ready", "prizes.reopen"]


@pytest.mark.asyncio
async def test_a_custom_deadline_survives_ready(flow, mails):
    flow.act_as(await flow.add_staff())
    later = (now_utc() + timedelta(days=10)).isoformat()
    item = await pickup(flow, user_id=(await flow.add_user())["id"])
    response = await flow.patch(f"/api/prizes/{item['id']}", json={"pickup_deadline": later})
    assert response.status_code == 200
    response = await flow.patch(f"/api/prizes/{item['id']}", json={"status": "ready"})
    assert response.json()["pickup_deadline"] == later


@pytest.mark.asyncio
async def test_undoing_picked_up_sends_nothing_and_everything_is_logged(flow, mails):
    flow.act_as(await flow.add_staff())
    anna = await flow.add_user(name="anna")
    item = await pickup(flow, user_id=anna["id"])
    await flow.patch(f"/api/prizes/{item['id']}", json={"status": "ready"})
    await flow.patch(f"/api/prizes/{item['id']}", json={"status": "picked_up", "notes": "persönlich"})
    assert mails == [(anna["id"], "prize_ready"), (anna["id"], "prize_picked_up")]
    bells = await flow.db.notifications.count_documents({"user_id": anna["id"]})

    response = await flow.patch(f"/api/prizes/{item['id']}", json={"status": "ready"})
    assert response.json()["status"] == "ready" and response.json()["picked_up_at"] is None
    assert len(mails) == 2 and await flow.db.notifications.count_documents({"user_id": anna["id"]}) == bells

    response = await flow.delete(f"/api/prizes/{item['id']}")
    assert response.status_code == 200
    log = await flow.db.audit_logs.find({}, {"_id": 0}).to_list(10)
    assert [row["action"] for row in log] == ["prizes.ready", "prizes.picked_up", "prizes.revert_picked_up", "prizes.delete"]
    assert log[-1]["target_id"] == item["id"] and log[-1]["data"]["prize_value"] == "Pokal"


@pytest.mark.asyncio
async def test_team_prizes_reach_the_team_leader(flow, mails):
    flow.act_as(await flow.add_staff())
    leader = await flow.add_user(name="kapitaen")
    await flow.db.teams.insert_one({"id": "team-1", "name": "Löwen", "leader_id": leader["id"], "member_ids": [leader["id"]]})
    item = await pickup(flow, team_id="team-1")
    await flow.patch(f"/api/prizes/{item['id']}", json={"status": "ready"})
    assert mails == [(leader["id"], "prize_ready")]
    assert await flow.db.notifications.count_documents({"user_id": leader["id"], "kind": "prize_status"}) == 1


@pytest.mark.asyncio
async def test_revoking_an_achievement_needs_a_reason_on_the_server(flow):
    flow.act_as(await flow.add_staff())
    anna = await flow.add_user(name="anna")
    response = await flow.client.request("DELETE", "/api/admin/achievements/award",
                                         json={"user_id": anna["id"], "tier_code": "matches_played_1", "note": "  "})
    assert response.status_code == 400 and response.json()["detail"] == "Bitte einen Grund angeben."

@pytest.mark.asyncio
async def test_undoing_picked_up_after_the_deadline_gives_a_new_one(flow, mails):
    flow.act_as(await flow.add_staff())
    past = (now_utc() - timedelta(days=3)).isoformat()
    item = await pickup(flow, user_id=(await flow.add_user())["id"], status="picked_up", pickup_deadline=past,
                        ready_at=past, picked_up_at=past)
    response = await flow.patch(f"/api/prizes/{item['id']}", json={"status": "ready"})
    assert response.status_code == 200, response.text
    assert response.json()["pickup_deadline"] > (now_utc() + timedelta(days=89)).isoformat()
    assert mails == []


@pytest.mark.asyncio
async def test_expiry_counts_and_reports_only_what_it_really_changed(flow, mails, monkeypatch):
    """Zwischen Lesen und Schreiben holt jemand den Gewinn ab - dann kein Verfall und keine Meldung."""
    from services import prize_service

    anna = await flow.add_user(name="anna")
    past = (now_utc() - timedelta(days=1)).isoformat()
    raced = await pickup(flow, user_id=anna["id"], status="ready", pickup_deadline=past)
    due = await pickup(flow, user_id=anna["id"], status="ready", pickup_deadline=past)
    real_db = flow.db

    class Pickups:
        def __getattr__(self, name):
            return getattr(real_db.prize_pickups, name)

        async def update_one(self, query, change, *args, **kwargs):
            if query.get("id") == raced["id"]:
                await real_db.prize_pickups.update_one({"id": raced["id"]}, {"$set": {"status": "picked_up"}})
            return await real_db.prize_pickups.update_one(query, change, *args, **kwargs)

    class Db:
        prize_pickups = Pickups()

        def __getattr__(self, name):
            return getattr(real_db, name)

    monkeypatch.setattr(prize_service, "get_db", lambda: Db())
    assert await prize_service.expire_overdue() == 1
    assert (await real_db.prize_pickups.find_one({"id": raced["id"]}, {"_id": 0}))["status"] == "picked_up"
    assert (await real_db.prize_pickups.find_one({"id": due["id"]}, {"_id": 0}))["status"] == "expired"
    assert mails == [(anna["id"], "prize_expired")]


def test_prize_status_has_its_category_and_discord_look():
    from services import discord_dm
    from services.notification_preferences import NOTIFICATION_KIND_CATEGORY

    assert NOTIFICATION_KIND_CATEGORY["prize_status"] == "prize_updates"
    assert discord_dm.BUTTON_LABELS["prize_status"] == "Zum Gewinn" and "prize_status" in discord_dm.COLORS
