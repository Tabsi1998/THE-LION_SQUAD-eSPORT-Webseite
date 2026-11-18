"""Vereinsinterne Erfolge im Profil, Runde 2 (#2521): Teilnahmen, Fast-Lap-Bestzeiten, Zahlen und Liga-Historie nach der Regel aus #2516.

Rechte-Matrix je Bereich: Gast, angemeldetes Nicht-Mitglied, Vereinsmitglied mit Schalter an bzw. aus, die Person selbst und „So sehen
dich andere“. Gäste bekommen exakt dieselben Werte wie vor der Änderung - auch nicht indirekt einen Hinweis, dass es Internes gibt: Ihre
Antwort ist dieselbe, ob es interne Turniere, Zeiten und Seasons gibt oder nicht. Nur erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import profile_visibility  # noqa: E402
from test_profile_internal_flow import TOURNAMENTS, public_profile, seed  # noqa: E402

PUBLIC_TOURNAMENTS = {"t-offen"}
MEMBER_TOURNAMENTS = {"t-offen", "t-verein", "t-community"}
# Was ein Gast heute sieht: ein öffentliches Turnier (Sieg, Podium) und eine öffentliche Bestzeit (Pole, Podium).
GUEST_STATS = {"tournaments": 1, "wins": 1, "top3": 2, "fast_laps": 1, "pole_positions": 1}
COMPARED = ("tournaments", "f1_bests", "stats", "league_history", "league_overall")


@pytest_asyncio.fixture
async def flow():
    from services import league_overall

    league_overall.forget_extracts()
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def tournament_flags(profile) -> dict[str, bool]:
    return {row["id"]: row["internal"] for row in profile["tournaments"]}


def lap_flags(profile) -> dict[str, bool]:
    return {row["challenge"]["id"]: row["internal"] for row in profile["f1_bests"]}


def counted(profile) -> dict[str, int]:
    return {key: profile["stats"][key] for key in GUEST_STATS}


@pytest.mark.asyncio
async def test_guest_and_outsider_see_only_public_and_the_same_numbers_as_before(flow):
    owner, _member, outsider = await seed(flow)
    for viewer in (None, outsider):
        profile = await public_profile(flow, owner, viewer)
        assert tournament_flags(profile) == {"t-offen": False}
        assert lap_flags(profile) == {"c-offen": False}
        assert counted(profile) == GUEST_STATS
    # Der Schalter ändert für Gäste nichts.
    await flow.db.users.update_one({"id": owner["id"]}, {"$set": {profile_visibility.SETTING: False}})
    assert counted(await public_profile(flow, owner, None)) == GUEST_STATS


@pytest.mark.asyncio
async def test_member_sees_participations_laps_and_numbers_with_the_switch_on(flow):
    owner, member, _outsider = await seed(flow)
    profile = await public_profile(flow, owner, member)
    assert tournament_flags(profile) == {"t-offen": False, "t-verein": True, "t-community": True}, "keine Turniere der Verwaltung, keine versteckten"
    assert lap_flags(profile) == {"c-offen": False, "c-verein": True}
    assert counted(profile) == {"tournaments": 3, "wins": 3, "top3": 5, "fast_laps": 2, "pole_positions": 2}

    await flow.db.users.update_one({"id": owner["id"]}, {"$set": {profile_visibility.SETTING: False}})
    off = await public_profile(flow, owner, member)
    assert tournament_flags(off) == {"t-offen": False} and lap_flags(off) == {"c-offen": False}
    assert counted(off) == GUEST_STATS, "Schalter aus: das Mitglied zählt wie ein Gast"


@pytest.mark.asyncio
async def test_self_sees_everything_and_as_others_like_a_guest(flow):
    owner, _member, _outsider = await seed(flow)
    await flow.db.users.update_one({"id": owner["id"]}, {"$set": {profile_visibility.SETTING: False}})
    owner_now = {**owner, profile_visibility.SETTING: False}
    mine = await public_profile(flow, owner, owner_now)
    assert set(tournament_flags(mine)) == set(TOURNAMENTS), "die Person selbst sieht immer alles"
    assert tournament_flags(mine)["t-leitung"] is True and tournament_flags(mine)["t-versteckt"] is True
    assert tournament_flags(mine)["t-offen"] is False
    assert lap_flags(mine) == {"c-offen": False, "c-verein": True}
    assert counted(mine) == {"tournaments": 5, "wins": 5, "top3": 7, "fast_laps": 2, "pole_positions": 2}

    as_others = await public_profile(flow, owner, owner_now, view_as="public")
    assert tournament_flags(as_others) == {"t-offen": False} and lap_flags(as_others) == {"c-offen": False}
    assert counted(as_others) == GUEST_STATS


@pytest.mark.asyncio
async def test_guest_answer_does_not_change_when_internal_entries_exist(flow):
    """Kein indirekter Hinweis: dieselbe Gast-Antwort mit und ohne interne Einträge - keine Differenz, kein Zusatzfeld."""
    owner, _member, _outsider = await seed(flow)
    with_internal = await public_profile(flow, owner, None)
    internal_ids = [tid for tid in TOURNAMENTS if tid not in PUBLIC_TOURNAMENTS]
    await flow.db.tournament_registrations.delete_many({"tournament_id": {"$in": internal_ids}})
    await flow.db.tournaments.delete_many({"id": {"$in": internal_ids}})
    await flow.db.f1_lap_times.delete_many({"challenge_id": "c-verein"})
    await flow.db.f1_challenges.delete_many({"id": "c-verein"})
    without = await public_profile(flow, owner, None)
    for key in COMPARED:
        assert with_internal[key] == without[key], key


# ---------------------------------------------------------------- Liga-Historie und Gesamtwertung

async def league_world(flow):
    """Zwei abgeschlossene Seasons mit Gesamtwertung (Hilfen aus test_league_overall_flow); Season 2 danach „Nur Mitglieder“.
    Die Person ist ``p-2-1`` (eingesetzt, öffentliches Profil)."""
    from test_league_overall_flow import configure, two_seasons

    world = await two_seasons(flow)
    await configure(flow, world)
    member = await flow.add_user(role="player", name="nachtfalke")
    await flow.db.memberships.insert_one({"id": "m-liga", "user_id": member["id"], "member_status": "active"})
    outsider = await flow.add_user(role="player", name="turbolurch")
    await set_visibility(flow, world, "members")
    owner = await flow.db.users.find_one({"id": "p-2-1"}, {"_id": 0})
    return world, owner, member, outsider


async def set_visibility(flow, world, visibility: str) -> None:
    """Season 2 über die Verwaltung umstellen - die Staffeln ziehen mit (``league_service.STAFFEL_VISIBILITY``)."""
    from test_league_overall_flow import ADMIN, ok

    flow.act_as(world["admin"])
    ok(await flow.patch(f"{ADMIN}/seasons/{world['seasons'][1]['id']}", json={"visibility": visibility, "readiness_override_reason": "Testaufbau"}))
    from services import league_overall

    league_overall.forget_extracts()


async def legacy_league(flow, owner) -> tuple[list[dict], list[dict]]:
    """Die Liga-Bereiche, wie ein Gast sie vor #2521 bekam: Betrachter ``None`` und die Regel der Turnierseite."""
    from routes.tournament_common import tournament_hidden_reason
    from services import league_history, league_overall

    league_overall.forget_extracts()
    history = await league_history.for_player(flow.db, owner["id"], None, hidden=tournament_hidden_reason)
    overall = await league_overall.for_player(flow.db, owner["id"], None, hidden=tournament_hidden_reason)
    return history, overall


def history_flags(profile, world) -> dict[int, bool]:
    numbers = {row["id"]: index + 1 for index, row in enumerate(world["seasons"])}
    return {numbers[row["season_id"]]: row["internal"] for row in profile["league_history"]}


@pytest.mark.asyncio
async def test_league_history_follows_the_switch(flow):
    world, owner, member, outsider = await league_world(flow)
    legacy_history, legacy_overall = await legacy_league(flow, owner)
    for viewer in (None, outsider):
        profile = await public_profile(flow, owner, viewer)
        assert history_flags(profile, world) == {1: False}
        assert len(profile["league_overall"]) == 1 and profile["league_overall"][0]["internal"] is False
        # Exakt wie vorher - Platz, Punkte, „von wie vielen“, vollständig oder nicht.
        assert [{k: v for k, v in row.items() if k != "internal"} for row in profile["league_history"]] == legacy_history
        assert [{k: v for k, v in row.items() if k != "internal"} for row in profile["league_overall"]] == legacy_overall

    seen = await public_profile(flow, owner, member)
    assert history_flags(seen, world) == {1: False, 2: True}
    overall = seen["league_overall"][0]
    assert overall["internal"] is True, "die Wertung zählt die interne Season mit"
    assert overall["points"] != legacy_overall[0]["points"]

    # Schalter aus: das Mitglied sieht die Liga wie ein Gast.
    await flow.db.users.update_one({"id": owner["id"]}, {"$set": {profile_visibility.SETTING: False}})
    off = await public_profile(flow, owner, member)
    assert history_flags(off, world) == {1: False}
    assert [{k: v for k, v in row.items() if k != "internal"} for row in off["league_overall"]] == legacy_overall

    # Die Person selbst sieht beide Seasons, auch mit Schalter aus; „So sehen dich andere“ wie ein Gast.
    owner_now = {**owner, profile_visibility.SETTING: False}
    mine = await public_profile(flow, owner, owner_now)
    assert history_flags(mine, world) == {1: False, 2: True} and mine["league_overall"][0]["internal"] is True
    as_others = await public_profile(flow, owner, owner_now, view_as="public")
    assert history_flags(as_others, world) == {1: False} and as_others["league_overall"][0]["internal"] is False


@pytest.mark.asyncio
async def test_league_history_admin_season_stays_with_the_lead_and_the_person(flow):
    """„Nur Liga-Leitung“: Mitglieder sehen die Season auch mit Schalter an nicht - die Person selbst schon."""
    world, owner, member, _outsider = await league_world(flow)
    await set_visibility(flow, world, "admins")
    _legacy_history, legacy_overall = await legacy_league(flow, owner)
    seen = await public_profile(flow, owner, member)
    assert history_flags(seen, world) == {1: False}
    assert seen["league_overall"][0]["internal"] is False
    assert [{k: v for k, v in row.items() if k != "internal"} for row in seen["league_overall"]] == legacy_overall
    mine = await public_profile(flow, owner, owner)
    assert history_flags(mine, world) == {1: False, 2: True}


@pytest.mark.asyncio
async def test_guest_league_answer_does_not_change_when_an_internal_season_exists(flow):
    world, owner, _member, _outsider = await league_world(flow)
    with_internal = await public_profile(flow, owner, None)
    # Gegenstück ohne interne Season: dieselbe Season ganz aus („off“ sieht niemand außer der Leitung).
    await set_visibility(flow, world, "off")
    without = await public_profile(flow, owner, None)
    for key in ("league_history", "league_overall", "stats"):
        assert with_internal[key] == without[key], key
