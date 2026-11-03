"""Befangenheit im Eingang der Selbstanmeldung (docs/LIGA.md, B.4 und Abschnitt 12, #2245, Entscheidung Nr. 73).

Über die Anmeldung des eigenen Teams entscheidet eine zweite Person: Kader, Captain, Vertreter, Leitung und Co-Leitung des Hauptteams bekommen bei jeder
Entscheidung 403, auch mit Liga-Recht oder dem Bereich „Ligen“. Der Superadmin geht nur als Notausnahme mit Grund durch, das steht im Protokoll.
Erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_application_world import application_world, decide, inbox_url, submitted  # noqa: E402
from league_start_world import ok  # noqa: E402
from models import now_utc  # noqa: E402

ACTIONS = ("review", "accept", "reject", "waitlist", "assign")
OWN_TEAM = "Über dein eigenes Team entscheidet eine andere Person"
REASON = "Niemand sonst erreichbar, Saisonstart morgen"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def body_for(w: dict, action: str, **extra) -> dict:
    if action == "reject":
        return {"reason": "Grund genug", **extra}
    if action in ("accept", "assign"):
        return {"tournament_id": w["tid"], **extra}
    return dict(extra)


async def co_lead(flow, side: dict) -> dict:
    person = await flow.add_user(name=f"{side['team']['name']} Co-Leitung")
    await flow.db.teams.update_one({"id": side["team"]["id"]}, {"$push": {"co_leader_ids": person["id"], "member_ids": person["id"]}})
    await flow.db.team_members.insert_one({"id": new_id(), "team_id": side["team"]["id"], "user_id": person["id"], "role": "co_leader"})
    return person


async def person_of(flow, side: dict, who: str) -> dict:
    return await co_lead(flow, side) if who == "co_lead" else side[who]


async def with_right(flow, w: dict, person: dict, grant: str) -> dict:
    """Die Person bekommt das Recht im Eingang: die Zuständigkeit ``applications`` dieser Liga oder den Bereich „Ligen“."""
    if grant == "area":
        return {**person, "areas": ["leagues"]}
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": w["league"]["id"], "user_id": person["id"], "capabilities": ["applications"],
                                           "created_at": now_utc().isoformat(), "created_by": "test"})
    return person


async def stored(flow, application: dict) -> dict:
    return await flow.db.league_applications.find_one({"id": application["id"]}, {"_id": 0})


async def accepted_without_staffel(flow, w: dict, application: dict) -> dict:
    return ok(await decide(flow, w, application, "accept"))


# ---------------------------------------------------------------- Befangen: nichts geht

@pytest.mark.asyncio
@pytest.mark.parametrize("grant", ["staff", "area"])
@pytest.mark.parametrize("who", ["captain", "vice", "member", "lead", "co_lead"])
async def test_a_person_of_the_own_team_is_refused_at_every_decision(flow, who, grant):
    w = await application_world(flow, teams=2)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    person = await with_right(flow, w, await person_of(flow, side, who), grant)
    before = await stored(flow, application)

    for action in ACTIONS:
        answer = await decide(flow, w, application, action, actor=person, **body_for(w, action))
        assert answer.status_code == 403, (action, answer.text)
        assert OWN_TEAM in answer.json()["detail"], answer.text

    assert await stored(flow, application) == before, "der Antrag bleibt, wie er war"
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": w["tid"]}) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("grant", ["staff", "area"])
async def test_assigning_an_accepted_own_team_is_refused(flow, grant):
    w = await application_world(flow, teams=1)
    side = w["teams"][0]
    application = await accepted_without_staffel(flow, w, await submitted(flow, w, side))
    person = await with_right(flow, w, side["captain"], grant)

    answer = await decide(flow, w, application, "assign", actor=person, tournament_id=w["tid"])

    assert answer.status_code == 403, answer.text
    assert "assignment" not in await stored(flow, application)


@pytest.mark.asyncio
async def test_a_second_person_without_relation_decides(flow):
    w = await application_world(flow, teams=1)
    application = await submitted(flow, w, w["teams"][0])
    second = await with_right(flow, w, await flow.add_user(name="Zweite Person"), "staff")

    assert ok(await decide(flow, w, application, "review", actor=second))["status"] == "in_review"
    assert ok(await decide(flow, w, application, "accept", actor=second, tournament_id=w["tid"]))["status"] == "accepted"
    entry = await flow.db.audit_logs.find_one({"action": "league.application.accept"}, {"_id": 0})
    assert "conflict_override" not in entry["data"]


@pytest.mark.asyncio
async def test_other_teams_of_the_same_season_stay_open_to_the_conflicted_person(flow):
    w = await application_world(flow, teams=2, application_waitlist=True)
    own, other = w["teams"]
    await submitted(flow, w, own)
    foreign = await submitted(flow, w, other)
    person = await with_right(flow, w, own["captain"], "staff")

    assert ok(await decide(flow, w, foreign, "review", actor=person))["status"] == "in_review"
    assert ok(await decide(flow, w, foreign, "waitlist", actor=person))["status"] == "waitlist"
    assert ok(await decide(flow, w, foreign, "accept", actor=person, tournament_id=w["tid"]))["status"] == "accepted"


# ---------------------------------------------------------------- Superadmin: nur mit Grund

@pytest.mark.asyncio
@pytest.mark.parametrize("action", ACTIONS)
async def test_a_conflicted_superadmin_needs_a_reason(flow, action):
    w = await application_world(flow, teams=1)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    if action == "assign":
        application = await accepted_without_staffel(flow, w, application)
    before = await stored(flow, application)
    boss = {**side["lead"], "role": "superadmin"}

    missing = await decide(flow, w, application, action, actor=boss, **body_for(w, action))
    short = await decide(flow, w, application, action, actor=boss, **body_for(w, action, conflict_reason=" kurz "))

    assert missing.status_code == 403, missing.text
    assert "Notausnahme" in missing.json()["detail"]
    assert 400 <= short.status_code < 500, short.text
    assert await stored(flow, application) == before


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ACTIONS)
async def test_a_conflicted_superadmin_with_reason_passes_and_is_logged(flow, action):
    w = await application_world(flow, teams=1, application_waitlist=True)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    if action == "assign":
        application = await accepted_without_staffel(flow, w, application)
    boss = {**side["lead"], "role": "superadmin"}

    ok(await decide(flow, w, application, action, actor=boss, **body_for(w, action, conflict_reason=f"  {REASON} ")))

    entry = await flow.db.audit_logs.find_one({"action": f"league.application.{action}"}, {"_id": 0})
    assert entry["actor_id"] == boss["id"] and entry["data"]["conflict_override"] == REASON
    step = (await stored(flow, application))["history"][-1]
    assert step["by"] == boss["id"] and step["conflict_reason"] == REASON
    override = await flow.db.audit_logs.find_one({"action": "league.conflict.override"}, {"_id": 0})
    assert override["data"] == {"application_id": application["id"], "action": f"application_{action}", "reason": REASON}


@pytest.mark.asyncio
async def test_an_unconflicted_superadmin_needs_no_reason(flow):
    w = await application_world(flow, teams=1)
    application = await submitted(flow, w, w["teams"][0])

    ok(await decide(flow, w, application, "accept"))

    entry = await flow.db.audit_logs.find_one({"action": "league.application.accept"}, {"_id": 0})
    assert "conflict_override" not in entry["data"]
    assert await flow.db.audit_logs.count_documents({"action": "league.conflict.override"}) == 0


# ---------------------------------------------------------------- Eingang: was die Person sieht

@pytest.mark.asyncio
@pytest.mark.parametrize("who", ["captain", "vice", "member", "lead", "co_lead"])
async def test_the_inbox_marks_the_own_team_with_the_same_rule(flow, who):
    w = await application_world(flow, teams=2)
    own, other = w["teams"]
    await submitted(flow, w, own)
    await submitted(flow, w, other)
    person = await with_right(flow, w, await person_of(flow, own, who), "staff")
    flow.act_as(person)

    page = ok(await flow.get(inbox_url(w)))

    marks = {row["squad_id"]: row["own_team"] for row in page["items"]}
    assert marks == {own["squad"]["id"]: True, other["squad"]["id"]: False}
    assert page["superadmin"] is False


@pytest.mark.asyncio
async def test_the_inbox_tells_the_superadmin(flow):
    w = await application_world(flow, teams=1)
    await submitted(flow, w, w["teams"][0])
    flow.act_as(w["lead"])

    page = ok(await flow.get(inbox_url(w)))

    assert page["superadmin"] is True and page["items"][0]["own_team"] is False


@pytest.mark.asyncio
async def test_the_inbox_shows_the_override_reason_in_the_history(flow):
    w = await application_world(flow, teams=1)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    ok(await decide(flow, w, application, "review", actor={**side["lead"], "role": "superadmin"}, conflict_reason=REASON))
    flow.act_as(w["lead"])

    history = ok(await flow.get(inbox_url(w)))["items"][0]["history"]

    assert history[-1]["conflict_reason"] == REASON and history[0].get("conflict_reason") is None


# ---------------------------------------------------------------- Sonderweg „Co-Team zuteilen“

def squad_url(w: dict) -> str:
    return f"/api/tournaments/{w['tid']}/squad-registrations"


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["submitted", "accepted"])
async def test_the_admin_way_refuses_the_own_team_with_an_open_application(flow, status):
    w = await application_world(flow, teams=1)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    if status == "accepted":
        application = await accepted_without_staffel(flow, w, application)
    before = await stored(flow, application)
    flow.act_as(await with_right(flow, w, side["vice"], "staff"))

    answer = await flow.post(squad_url(w), json={"team_id": side["team"]["id"], "squad_id": side["squad"]["id"]})

    assert answer.status_code == 403, answer.text
    assert await stored(flow, application) == before
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": w["tid"]}) == 0


@pytest.mark.asyncio
async def test_the_admin_way_without_application_knows_no_conflict(flow):
    """B.1: Zuteilen ohne Antrag ist keine Entscheidung über die Anmeldung."""
    w = await application_world(flow, teams=1)
    side = w["teams"][0]
    flow.act_as(await with_right(flow, w, side["vice"], "staff"))

    ok(await flow.post(squad_url(w), json={"team_id": side["team"]["id"], "squad_id": side["squad"]["id"]}))


@pytest.mark.asyncio
async def test_the_admin_way_lets_the_superadmin_through_with_reason(flow):
    w = await application_world(flow, teams=1)
    side = w["teams"][0]
    application = await submitted(flow, w, side)
    flow.act_as({**side["lead"], "role": "superadmin"})
    body = {"team_id": side["team"]["id"], "squad_id": side["squad"]["id"]}

    assert (await flow.post(squad_url(w), json=body)).status_code == 403
    ok(await flow.post(squad_url(w), json={**body, "conflict_reason": REASON}))

    linked = await stored(flow, application)
    assert linked["status"] == "accepted" and linked["history"][-1]["conflict_reason"] == REASON
    entry = await flow.db.audit_logs.find_one({"action": "league.application.accept"}, {"_id": 0})
    assert entry["data"]["conflict_override"] == REASON and entry["data"]["via"] == "squad_assign"
