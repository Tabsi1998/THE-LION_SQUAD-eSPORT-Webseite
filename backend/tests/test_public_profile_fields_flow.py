"""Öffentliche Profile und Listen (#2118) liefern nur freigegebene Felder.

- Die interne Vereinsrolle steht in keiner öffentlichen Antwort (Profil, Spielerliste, Mitgliederverzeichnis).
- Land und Lieblingsspiele folgen in den öffentlichen Listen der Stufe aus „Privatsphäre“ - Listen sieht jede:r, also nur
  bei der Stufe „öffentlich“.
- „Erfolge öffentlich“ aus: Fremde sehen auf dem Profil keine Erfolge (auch keine Zahl); die Person selbst schon.

Namen und Werte sind erfunden.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def member(flow, name, **fields):
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {
        "privacy_public_profile": True, "is_active": True, "country": "AT", "favorite_games": ["Rocket League"], **fields,
    }})
    await flow.db.memberships.insert_one({"id": f"m-{name}", "user_id": user["id"], "member_status": "active",
                                          "membership_type": "ordinary", "internal_role": "Kassa-Prüfung"})
    user.update(fields)
    return user


async def with_badge(flow, user):
    await flow.db.achievements.insert_one({"code": "test-tier", "name": "Test-Erfolg", "level": 1, "points": 10})
    await flow.db.user_achievements.insert_one({"user_id": user["id"], "tier_code": "test-tier", "level": 1,
                                                "earned_at": "2026-10-01T10:00:00+00:00"})


def _row(rows, username):
    return next(row for row in rows if row["username"] == username)


@pytest.mark.asyncio
async def test_lists_follow_the_privacy_levels_and_never_show_the_internal_role(flow):
    await member(flow, "offen")
    await member(flow, "vorsichtig", profile_visibility={"country": "members", "favorite_games": "private"})
    flow.act_as(None)

    players = (await flow.get("/api/users/public-list")).json()
    assert _row(players, "offen")["country"] == "AT" and _row(players, "offen")["favorite_games"] == ["Rocket League"]
    assert _row(players, "vorsichtig")["country"] is None and _row(players, "vorsichtig")["favorite_games"] == []

    directory = (await flow.get("/api/membership/public")).json()
    assert all("internal_role" not in row for row in directory)
    assert _row(directory, "offen")["country"] == "AT"
    assert _row(directory, "vorsichtig")["country"] is None and _row(directory, "vorsichtig")["favorite_games"] == []

    profile = (await flow.get("/api/users/public/offen")).json()
    assert profile["membership"] and "internal_role" not in profile["membership"]


@pytest.mark.asyncio
async def test_achievements_off_hides_them_from_others_but_not_from_the_person(flow):
    shy = await member(flow, "zurueckhaltend", privacy_achievements_public=False)
    await with_badge(flow, shy)

    flow.act_as(None)
    seen = (await flow.get("/api/users/public/zurueckhaltend")).json()
    assert seen["badges"] == [] and seen["stats"]["badges"] == 0 and seen["stats"]["points"] == 0
    assert seen["achievements_hidden"] is True
    listed = _row((await flow.get("/api/users/public-list")).json(), "zurueckhaltend")
    assert listed["achievements_count"] == 0 and listed["top_achievement"] is None

    flow.act_as(shy)
    own = (await flow.get("/api/users/public/zurueckhaltend")).json()
    assert [badge["code"] for badge in own["badges"]] == ["test-tier"] and own["achievements_hidden"] is False


@pytest.mark.asyncio
async def test_achievements_on_stay_visible(flow):
    proud = await member(flow, "stolz")
    await with_badge(flow, proud)
    flow.act_as(None)
    seen = (await flow.get("/api/users/public/stolz")).json()
    assert [badge["code"] for badge in seen["badges"]] == ["test-tier"] and seen["stats"]["points"] == 10
