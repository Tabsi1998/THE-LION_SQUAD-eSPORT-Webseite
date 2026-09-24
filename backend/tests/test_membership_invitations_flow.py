"""Einladung zum Mitgliedsantrag (#507): Vorstand lädt ein, das Konto sieht es, stellt den Antrag, die Einladung
ist erledigt; zurückziehen, ablaufen, Grenzen."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import membership_invitations as invitations  # noqa: E402
from services.notification_preferences import preference_key  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


APPLICATION = {"motivation": "Ich möchte mitspielen und mich beim Verein einbringen.", "contribution_pref": "full", "accept_statutes": True, "accept_privacy": True}


@pytest.mark.asyncio
async def test_invite_apply_and_withdraw(flow):
    board = await flow.add_user(role="club_admin", name="vorstand")
    paula = await flow.add_user(role="player", name="paula")
    flow.act_as(paula)
    assert (await flow.get("/api/membership/invitation/me")).json() == {"open": False}
    assert (await flow.post("/api/admin/membership-invitations", json={"user_id": paula["id"]})).status_code == 403, "nur der Bereich Verein lädt ein"

    flow.act_as(board)
    created = (await flow.post("/api/admin/membership-invitations", json={"user_id": paula["id"], "note": "Wir freuen uns auf dich!"})).json()
    assert created["status"] == "open" and created["note"] == "Wir freuen uns auf dich!" and created["invited_by"] == board["id"]
    again = (await flow.post("/api/admin/membership-invitations", json={"user_id": paula["id"]})).json()
    assert again["id"] == created["id"] and again["existing"] is True, "eine offene Einladung je Konto"
    note = await flow.db.notifications.find_one({"user_id": paula["id"], "kind": "membership_invited"}, {"_id": 0})
    assert note and note["url"] == "/membership/apply"
    mail = await flow.db.mail_jobs.find_one({"template_key": "membership_invited"}, {"_id": 0})
    assert mail and mail["to"] == paula["email"] and "freigeschaltet" in mail["html"] and "Wir freuen uns" in mail["html"]
    assert (await flow.db.audit_logs.find_one({"action": "membership.invite", "target_id": paula["id"]})) is not None
    listing = (await flow.get("/api/admin/membership-invitations?status=open")).json()
    assert [row["user"]["username"] for row in listing] == [paula["username"]] and listing[0]["invited_by_name"]

    # Das Konto sieht die Einladung, stellt den Antrag - die Einladung ist damit erledigt.
    flow.act_as(paula)
    mine = (await flow.get("/api/membership/invitation/me")).json()
    assert mine["open"] is True and mine["note"] == "Wir freuen uns auf dich!" and "invited_by" not in mine
    sent = await flow.post("/api/membership/apply", json=APPLICATION)
    assert sent.status_code == 200, sent.text
    assert (await flow.get("/api/membership/invitation/me")).json() == {"open": False}
    flow.act_as(board)
    applied = (await flow.get("/api/admin/membership-invitations?status=applied")).json()
    assert applied[0]["id"] == created["id"] and applied[0]["application_id"]

    # Zurückziehen einer offenen Einladung; erledigte bleiben, wie sie sind.
    max_ = await flow.add_user(role="player", name="max")
    second = (await flow.post("/api/admin/membership-invitations", json={"user_id": max_["id"]})).json()
    gone = (await flow.post(f"/api/admin/membership-invitations/{second['id']}/withdraw")).json()
    assert gone["status"] == "withdrawn" and gone["withdrawn_by"] == board["id"]
    flow.act_as(max_)
    assert (await flow.get("/api/membership/invitation/me")).json() == {"open": False}
    flow.act_as(board)
    assert (await flow.post(f"/api/admin/membership-invitations/{created['id']}/withdraw")).json()["status"] == "applied"
    assert (await flow.post("/api/admin/membership-invitations/nope/withdraw")).status_code == 404
    assert (await flow.get("/api/admin/membership-invitations?status=unsinn")).status_code == 400


@pytest.mark.asyncio
async def test_limits_and_expiry(flow):
    board = await flow.add_user(role="club_admin", name="vorstand")
    member = await flow.add_user(role="player", name="mitglied")
    await flow.db.memberships.insert_one({"id": "m1", "user_id": member["id"], "member_status": "active"})
    banned = await flow.add_user(role="player", name="gesperrt")
    await flow.db.users.update_one({"id": banned["id"]}, {"$set": {"is_banned": True}})
    flow.act_as(board)
    assert (await flow.post("/api/admin/membership-invitations", json={"user_id": member["id"]})).status_code == 409
    assert (await flow.post("/api/admin/membership-invitations", json={"user_id": banned["id"]})).status_code == 400
    assert (await flow.post("/api/admin/membership-invitations", json={"user_id": "gibt-es-nicht"})).status_code == 404

    paula = await flow.add_user(role="player", name="paula")
    created = (await flow.post("/api/admin/membership-invitations", json={"user_id": paula["id"]})).json()
    await flow.db.membership_invitations.update_one({"id": created["id"]}, {"$set": {"expires_at": (now_utc() - timedelta(days=1)).isoformat()}})
    flow.act_as(paula)
    assert (await flow.get("/api/membership/invitation/me")).json() == {"open": False}
    flow.act_as(board)
    assert (await flow.get("/api/admin/membership-invitations?status=expired")).json()[0]["id"] == created["id"]
    fresh = (await flow.post("/api/admin/membership-invitations", json={"user_id": paula["id"]})).json()
    assert fresh["id"] != created["id"] and fresh["status"] == "open", "nach dem Ablauf geht eine neue"

    # Wer Mitgliedschafts-Mails abbestellt hat, bekommt nur den Hinweis im Konto.
    quiet = await flow.add_user(role="player", name="leise")
    await flow.db.users.update_one({"id": quiet["id"]}, {"$set": {"notification_preferences": {preference_key("email", "membership_updates"): False}}})
    before = await flow.db.mail_jobs.count_documents({"template_key": "membership_invited"})
    assert (await flow.post("/api/admin/membership-invitations", json={"user_id": quiet["id"]})).status_code == 200
    assert await flow.db.notifications.count_documents({"user_id": quiet["id"], "kind": "membership_invited"}) == 1
    assert await flow.db.mail_jobs.count_documents({"template_key": "membership_invited"}) == before
