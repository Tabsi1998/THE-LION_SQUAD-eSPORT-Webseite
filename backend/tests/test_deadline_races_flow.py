"""Nebenläufigkeit rund um Check-in-Ende und Fristen (#1551, Codex-Prüfung zu #1574).

Wer zu spät kommt, darf nicht durchrutschen: Selbst-Check-in prüft das Ende erst unter der Turniersperre; ein Vorschlag
„nicht erschienen“ entsteht nur für ein Spiel, das wirklich noch offen und ohne Meldung ist, und lässt sich nur so
bestätigen; die Auto-Bestätigung rechnet mit dem Turnier, wie es beim Schreiben ist.
"""
import contextlib
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import routes.tournament_registration_routes as registration_routes  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import match_deadline_sweep  # noqa: E402
from services.match_deadline_sweep import sweep  # noqa: E402
from services.match_deadlines import no_show_deadline  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def ago(minutes: float) -> str:
    return (now_utc() - timedelta(minutes=minutes)).isoformat()


async def bracket(flow, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(4, **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    match = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))[0]
    first, second = [slot["registration_id"] for slot in match["slots"]]
    player = {reg["id"]: users[index] for index, reg in enumerate(registrations)}
    return staff, tournament, match, first, second, player


def duel(winner, loser):
    return {"results": [{"registration_id": winner, "rank": 1}, {"registration_id": loser, "rank": 2}]}


async def check_in_tournament(flow, *, until_minutes: float):
    tournament = await flow.create_tournament(status="check_in", event_mode="online", max_participants=8,
                                              check_in_from=ago(30), check_in_until=(now_utc() + timedelta(minutes=until_minutes)).isoformat())
    user = await flow.add_user(name="Spät")
    await flow.register(tournament, user)
    flow.act_as(user)
    return tournament, user


@pytest.mark.asyncio
async def test_self_check_in_after_the_end_time_is_refused_before_the_job_ran(flow):
    tournament, _user = await check_in_tournament(flow, until_minutes=-1)
    refused = await flow.post(f"/api/tournaments/{tournament['id']}/checkin")
    assert refused.status_code == 409, "„Check-in endet“ ist vorbei - auch wenn der Baum noch nicht gebaut ist"


@pytest.mark.asyncio
async def test_self_check_in_checks_the_end_under_the_tournament_lock(flow, monkeypatch):
    tournament, user = await check_in_tournament(flow, until_minutes=20)
    real_lock = registration_routes.mutation_lock

    @contextlib.asynccontextmanager
    async def lock_after_close(db, resource, *args, **kwargs):
        # Während die Anfrage auf die Sperre wartet, endet der Check-in (der Job hält dieselbe Sperre).
        await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"check_in_closed_at": now_utc().isoformat()}})
        async with real_lock(db, resource, *args, **kwargs):
            yield

    monkeypatch.setattr(registration_routes, "mutation_lock", lock_after_close)
    refused = await flow.post(f"/api/tournaments/{tournament['id']}/checkin")
    assert refused.status_code == 409
    stored = await flow.db.tournament_registrations.find_one({"tournament_id": tournament["id"], "user_id": user["id"]}, {"_id": 0})
    assert stored["status"] == "approved", "nichts eingecheckt, was im festen Baum fehlen würde"


async def proposed(flow, tournament, match):
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"scheduled_at": ago(20)}})
    assert (await sweep(flow.db))["proposed"] == 1


@pytest.mark.asyncio
async def test_a_report_after_the_proposal_blocks_the_walkover(flow):
    staff, tournament, match, first, second, player = await bracket(flow, event_mode="online")
    await proposed(flow, tournament, match)
    flow.act_as(player[first])
    assert (await flow.post(f"/api/matches/{match['id']}/report", json=duel(first, second))).status_code == 200
    flow.act_as(staff)
    refused = await flow.post(f"/api/tournaments/{tournament['id']}/lead/no-show/{match['id']}",
                              json={"action": "confirm", "registration_id": second})
    assert refused.status_code == 409, "wer gemeldet hat, ist erschienen"
    assert (await flow.reload(match))["status"] != "forfeit"


@pytest.mark.asyncio
async def test_a_started_match_blocks_the_walkover(flow):
    staff, tournament, match, _first, second, _player = await bracket(flow, event_mode="online")
    await proposed(flow, tournament, match)
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"status": "in_progress", "started_at": ago(1)}})
    refused = await flow.post(f"/api/tournaments/{tournament['id']}/lead/no-show/{match['id']}",
                              json={"action": "confirm", "registration_id": second})
    assert refused.status_code == 409


@pytest.mark.asyncio
async def test_the_proposal_is_written_only_for_a_match_still_open_and_unreported(flow):
    _staff, tournament, match, first, second, player = await bracket(flow, event_mode="online")
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"scheduled_at": ago(20)}})
    stale = await flow.reload(match)
    info = no_show_deadline(stale, tournament)
    # Zwischen Lesen und Schreiben meldet eine Seite.
    flow.act_as(player[first])
    assert (await flow.post(f"/api/matches/{match['id']}/report", json=duel(first, second))).status_code == 200
    stored_tournament = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    assert await match_deadline_sweep._propose_no_show(flow.db, stored_tournament, stale, info, now_utc()) == 0
    assert not (await flow.reload(match)).get("no_show_proposal")
    assert await flow.db.audit_logs.count_documents({"action": "match.no_show.proposed"}) == 0


@pytest.mark.asyncio
async def test_auto_confirm_uses_the_tournament_as_it_is_when_writing(flow):
    _staff, tournament, match, first, second, player = await bracket(flow, event_mode="online")
    flow.act_as(player[first])
    assert (await flow.post(f"/api/matches/{match['id']}/report", json=duel(first, second))).status_code == 200
    stale_tournament = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    # Die Turnierleitung stellt inzwischen auf „vor Ort“ um - dort bestätigt sie selbst.
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"event_mode": "local"}})
    later = now_utc() + timedelta(minutes=30)
    assert await match_deadline_sweep._auto_confirm(flow.db, stale_tournament, match["id"], None, later) == 0
    assert (await flow.reload(match))["status"] != "completed"

    # Und eine längere Frist der Phase gilt, auch wenn der Lauf noch die alte kannte.
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"event_mode": "online"}})
    await flow.db.tournament_stages.update_one({"id": match["stage_id"]}, {"$set": {"settings.result_confirm_minutes_online": 60}})
    assert await match_deadline_sweep._auto_confirm(flow.db, stale_tournament, match["id"], None, later) == 0
