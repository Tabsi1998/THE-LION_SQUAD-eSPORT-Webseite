"""Fast-Lap-Zeiten: dieselbe Prüfung beim Eintragen und beim Korrigieren (#1038).

Website und App tragen über ``POST /api/f1/challenges/{id}/times`` ein, Korrekturen laufen über
``PATCH /api/f1/times/{id}``. Beide rufen ``check_lap_time``: Zeit größer als null und höchstens eine Stunde,
Strafsekunden zwischen 0 und einer Stunde (keine Gutschrift, keine NaN), Nachweis-Link nur mit http(s), Begründung
bei Strafe oder ungültiger Runde, Vereins-Referenz nur wenn erlaubt, und die Versuchsgrenze auch dann, wenn eine
Korrektur die Zeit in die offizielle Wertung verschiebt."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402

NOTE = "Track Limits in Kurve 4"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup_challenge(flow, **extra):
    staff = await flow.add_staff()
    flow.act_as(staff)
    challenge_id, track_id = new_id(), new_id()
    await flow.db.f1_challenges.insert_one({"id": challenge_id, "slug": f"fl-{challenge_id[:8]}", "title": "Fast Lap",
                                            "status": "live", "visibility": "public", **extra})
    await flow.db.f1_tracks.insert_one({"id": track_id, "challenge_id": challenge_id, "name": "Teststrecke"})
    driver = await flow.add_user(name="fahrerin")
    return challenge_id, track_id, driver


async def enter(flow, challenge_id, track_id, driver, **fields):
    payload = {"user_id": driver["id"], "track_id": track_id, "time_ms": 81234, **fields}
    return await flow.post(f"/api/f1/challenges/{challenge_id}/times", json=payload)


async def correct(flow, time_id, **fields):
    return await flow.client.patch(f"/api/f1/times/{time_id}", json=fields)


async def stored(flow, time_id):
    return await flow.db.f1_lap_times.find_one({"id": time_id}, {"_id": 0})


BAD_VALUES = [
    pytest.param({"time_ms": 0}, id="zeit-null"),
    pytest.param({"time_ms": 60 * 60 * 1000 + 1}, id="zeit-ueber-einer-stunde"),
    pytest.param({"penalty_seconds": -5}, id="strafe-negativ"),
    pytest.param({"penalty_seconds": 3601, "admin_note": NOTE}, id="strafe-zu-gross"),
    pytest.param({"proof_url": "javascript:alert(1)"}, id="nachweis-ohne-http"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("fields", BAD_VALUES)
async def test_entering_and_correcting_refuse_the_same_values(flow, fields):
    challenge_id, track_id, driver = await setup_challenge(flow)

    refused = await enter(flow, challenge_id, track_id, driver, **fields)
    assert refused.status_code == 400, refused.text
    assert await flow.db.f1_lap_times.count_documents({}) == 0

    lap = await enter(flow, challenge_id, track_id, driver)
    assert lap.status_code == 200, lap.text
    before = await stored(flow, lap.json()["id"])
    corrected = await correct(flow, lap.json()["id"], **fields)
    assert corrected.status_code == 400, corrected.text
    assert corrected.json()["detail"] == refused.json()["detail"]
    assert await stored(flow, lap.json()["id"]) == before


@pytest.mark.asyncio
async def test_a_negative_time_is_refused_on_correction_too(flow):
    challenge_id, track_id, driver = await setup_challenge(flow)
    assert (await enter(flow, challenge_id, track_id, driver, time_ms=-1)).status_code in (400, 422)
    lap = (await enter(flow, challenge_id, track_id, driver)).json()
    corrected = await correct(flow, lap["id"], time_ms=-1)
    assert corrected.status_code == 400, corrected.text
    assert (await stored(flow, lap["id"]))["time_ms"] == 81234


@pytest.mark.asyncio
async def test_penalty_that_is_not_a_number_is_refused_and_the_leaderboard_keeps_working(flow):
    challenge_id, track_id, driver = await setup_challenge(flow)
    raw = '{"user_id": "%s", "track_id": "%s", "time_ms": 81234, "penalty_seconds": NaN, "admin_note": "%s"}' % (driver["id"], track_id, NOTE)
    refused = await flow.post(f"/api/f1/challenges/{challenge_id}/times", content=raw, headers={"content-type": "application/json"})
    assert refused.status_code in (400, 422), refused.text
    lap = (await enter(flow, challenge_id, track_id, driver)).json()
    corrected = await flow.client.patch(f"/api/f1/times/{lap['id']}", content='{"penalty_seconds": Infinity, "admin_note": "%s"}' % NOTE,
                                        headers={"content-type": "application/json"})
    assert corrected.status_code in (400, 422), corrected.text
    board = await flow.get(f"/api/f1/challenges/{challenge_id}/leaderboard?track_id={track_id}")
    assert board.status_code == 200, board.text
    assert board.json()["entries"][0]["time_ms"] == 81234


@pytest.mark.asyncio
async def test_penalty_needs_a_reason_on_both_ways_and_taking_it_back_needs_none(flow):
    challenge_id, track_id, driver = await setup_challenge(flow)
    assert (await enter(flow, challenge_id, track_id, driver, penalty_seconds=5)).status_code == 422
    lap = (await enter(flow, challenge_id, track_id, driver)).json()
    assert (await correct(flow, lap["id"], penalty_seconds=5)).status_code == 422
    assert (await correct(flow, lap["id"], is_invalid=True)).status_code == 422

    punished = await correct(flow, lap["id"], penalty_seconds=5, admin_note=NOTE)
    assert punished.status_code == 200, punished.text
    # Zurücknehmen (wie aus der Strafen-Liste, #1388): Strafe auf 0, die Begründung darf bleiben.
    taken_back = await correct(flow, lap["id"], penalty_seconds=0)
    assert taken_back.status_code == 200, taken_back.text
    assert (await stored(flow, lap["id"]))["penalty_seconds"] == 0


@pytest.mark.asyncio
async def test_a_correction_into_the_official_ranking_respects_the_attempt_limit(flow):
    challenge_id, track_id, driver = await setup_challenge(flow, unlimited_attempts=False, max_attempts=1)
    official = await enter(flow, challenge_id, track_id, driver)
    assert official.status_code == 200, official.text
    assert (await enter(flow, challenge_id, track_id, driver, time_ms=80000)).status_code == 400

    reference = await enter(flow, challenge_id, track_id, driver, time_ms=80000, score_scope="club_reference")
    assert reference.status_code == 200, reference.text
    moved = await correct(flow, reference.json()["id"], score_scope="official")
    assert moved.status_code == 400, moved.text
    assert "Versuche" in moved.json()["detail"]
    assert (await stored(flow, reference.json()["id"]))["score_scope"] == "club_reference"

    # Eine Korrektur innerhalb derselben Wertung zählt keinen neuen Versuch.
    fixed = await correct(flow, official.json()["id"], time_ms=81000)
    assert fixed.status_code == 200, fixed.text


@pytest.mark.asyncio
async def test_valid_values_pass_on_both_ways(flow):
    challenge_id, track_id, driver = await setup_challenge(flow)
    lap = await enter(flow, challenge_id, track_id, driver, penalty_seconds=2.5, admin_note=NOTE, proof_url="https://example.test/clip")
    assert lap.status_code == 200, lap.text
    corrected = await correct(flow, lap.json()["id"], time_ms=60 * 60 * 1000, proof_url=None, penalty_seconds=3600)
    assert corrected.status_code == 200, corrected.text
    saved = await stored(flow, lap.json()["id"])
    assert saved["time_ms"] == 60 * 60 * 1000 and saved["proof_url"] is None and saved["penalty_seconds"] == 3600


@pytest.mark.asyncio
async def test_correcting_needs_the_same_fast_lap_rights_as_entering(flow):
    challenge_id, track_id, driver = await setup_challenge(flow)
    lap = (await enter(flow, challenge_id, track_id, driver)).json()
    flow.act_as(await flow.add_user(role="player", name="mitspieler"))
    assert (await enter(flow, challenge_id, track_id, driver)).status_code == 403
    assert (await correct(flow, lap["id"], time_ms=1000)).status_code == 403
    assert (await stored(flow, lap["id"]))["time_ms"] == 81234
