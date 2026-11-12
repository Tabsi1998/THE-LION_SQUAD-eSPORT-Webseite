"""Spielberechtigung (docs/LIGA.md, B.3, #2204): die eine Prüfung, Fall für Fall je Einstellung, auch negativ. Erfundene Namen."""
import json
import pathlib
import sys
import re
from datetime import date, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import league_eligibility, league_roster  # noqa: E402
from test_league_roster_flow import id_world, set_id  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def rules(flow, w: dict, **fields) -> None:
    await flow.db.league_seasons.update_one({"id": w["season_id"]}, {"$set": fields})


async def state_of(flow, w: dict, name: str, squad: str = "squad_a") -> dict:
    tournament = await flow.db.tournaments.find_one({"id": w["tournament"]["id"]}, {"_id": 0})
    user_id = w["users"][name]["id"]
    ctx = await league_eligibility.context_for_tournament(flow.db, tournament, [user_id])
    return league_eligibility.status(ctx, user_id, w[squad]["id"])


async def born(flow, w: dict, name: str, value: str | None) -> None:
    await flow.db.users.update_one({"id": w["users"][name]["id"]}, {"$set": {"birth_date": value}})


def years_ago(years: int, days: int = 0) -> str:
    today = now_utc().date()
    return (date(today.year - years, today.month, min(today.day, 28)) - timedelta(days=days)).isoformat()


# ---------------------------------------------------------------- Ohne Regeln


@pytest.mark.asyncio
async def test_without_rules_only_the_id_decides(flow):
    w = await id_world(flow, without=("Mila",))
    await born(flow, w, "Kapitaen", years_ago(10))

    ok = await state_of(flow, w, "Kapitaen")
    missing = await state_of(flow, w, "Mila")

    assert (ok["state"], ok["ok"]) == ("pending", True)
    assert ok["age"] is None and ok["until"] is None
    assert (missing["state"], missing["ok"]) == ("missing", False)


# ---------------------------------------------------------------- Mindestalter


@pytest.mark.asyncio
@pytest.mark.parametrize(("birth", "min_age", "state", "age", "allowed"), [
    (years_ago(18), 18, "pending", "met", True),
    (years_ago(30), 18, "pending", "met", True),
    (years_ago(17, days=-1), 18, "age_not_met", None, False),
    (None, 18, "age_missing", "missing", False),
    ("kein-datum", 18, "age_missing", "missing", False),
    (years_ago(16), 16, "pending", "met", True),
    (years_ago(10), 0, "pending", None, True),
    (None, 0, "pending", None, True),
])
async def test_minimum_age_per_season(flow, birth, min_age, state, age, allowed):
    w = await id_world(flow)
    await rules(flow, w, min_age=min_age)
    await born(flow, w, "Mila", birth)

    row = await state_of(flow, w, "Mila")

    assert row["state"] == state
    assert row["ok"] is allowed
    assert row["age"] == age


@pytest.mark.asyncio
async def test_the_birth_date_never_leaves_the_check(flow):
    w = await id_world(flow)
    await rules(flow, w, min_age=18)
    await born(flow, w, "Mila", "2001-02-03")
    await born(flow, w, "Tom", "2020-02-03")

    for name in ("Mila", "Tom"):
        text = json.dumps(await state_of(flow, w, name), ensure_ascii=False)
        assert not re.search(r"2001-\d\d-\d\d|\d\d\.\d\d\.2001", text) and not re.search(r"2020-\d\d-\d\d|\d\d\.\d\d\.2020", text) and "birth" not in text
    assert (await state_of(flow, w, "Tom"))["reason"] == league_eligibility.AGE_NOT_MET


# ---------------------------------------------------------------- Ein Team je Season


@pytest.mark.asyncio
async def test_one_team_per_season_blocks_a_person_in_two_squads(flow):
    w = await id_world(flow)
    await flow.db.tournament_registrations.insert_one({
        "id": "reg-b", "tournament_id": w["tournament"]["id"], "team_id": w["lions"]["id"], "squad_id": w["squad_b"]["id"],
        "status": "approved"})
    await rules(flow, w, one_team_per_season=True)

    both = await state_of(flow, w, "Tom")
    assert (both["state"], both["ok"]) == ("other_team", False)
    assert w["squad_b"]["name"] not in both["reason"], "die Meldung nennt kein anderes Team"
    assert (await state_of(flow, w, "Mila"))["ok"] is True

    await rules(flow, w, one_team_per_season=False)
    assert (await state_of(flow, w, "Tom"))["ok"] is True


@pytest.mark.asyncio
async def test_another_season_does_not_count(flow):
    w = await id_world(flow)
    other = await flow.create_tournament(team_mode="team", format="league", game_id="probe-shooter",
                                         league_context={"league_id": "andere", "season_id": "s-andere", "division_id": "d", "staffel": "A"})
    await flow.db.tournament_registrations.insert_one({
        "id": "reg-b", "tournament_id": other["id"], "team_id": w["lions"]["id"], "squad_id": w["squad_b"]["id"],
        "status": "approved"})
    await rules(flow, w, one_team_per_season=True)

    assert (await state_of(flow, w, "Tom"))["ok"] is True


# ---------------------------------------------------------------- Wartezeit


async def joined(flow, w: dict, name: str, *, days_ago: float, squad: str = "squad_a", waivers: list | None = None) -> None:
    moment = (now_utc() - timedelta(days=days_ago)).isoformat()
    await flow.db.league_rosters.update_one(
        {"season_id": w["season_id"], "user_id": w["users"][name]["id"]},
        {"$set": {f"squad_joined_at.{w[squad]['id']}": moment, f"wait_from.{w[squad]['id']}": moment,
                  "wait_waivers": waivers or []}},
        upsert=True)


@pytest.mark.asyncio
@pytest.mark.parametrize(("days", "ago", "waiting"), [(7, 1, True), (7, 6.9, True), (7, 7.1, False), (0, 1, False), (3, 1, True), (3, 4, False)])
async def test_waiting_time_per_setting(flow, days, ago, waiting):
    w = await id_world(flow)
    await rules(flow, w, new_player_wait_days=days)
    await joined(flow, w, "Mila", days_ago=ago)

    row = await state_of(flow, w, "Mila")

    assert (row["state"] == "waiting") is waiting
    assert row["ok"] is (not waiting)
    assert bool(row["until"]) is waiting


@pytest.mark.asyncio
async def test_the_waiting_time_holds_only_in_its_squad_and_a_waiver_lifts_it(flow):
    w = await id_world(flow)
    await rules(flow, w, new_player_wait_days=7)
    await joined(flow, w, "Tom", days_ago=1, squad="squad_b")
    assert (await state_of(flow, w, "Tom", "squad_a"))["ok"] is True

    await joined(flow, w, "Mila", days_ago=1, waivers=[{"squad_id": w["squad_a"]["id"], "at": now_utc().isoformat(), "by": "y", "reason": "Ausnahme"}])
    assert (await state_of(flow, w, "Mila"))["ok"] is True


@pytest.mark.asyncio
async def test_an_old_season_ignores_stored_waiting_times(flow):
    w = await id_world(flow)
    await joined(flow, w, "Mila", days_ago=1)

    assert (await state_of(flow, w, "Mila"))["ok"] is True


# ---------------------------------------------------------------- Format und Eindeutigkeit


async def id_field(flow, **extra) -> None:
    await flow.db.games.update_one({"id": "probe-main"}, {"$set": {"player_id_fields": [
        {"key": "activision_id", "label": "Activision-ID", "required": True, **extra}]}})


@pytest.mark.asyncio
@pytest.mark.parametrize(("value", "state"), [("Testloewe#1234567", "pending"), ("Testloewe", "format"), ("#1", "format")])
async def test_id_format_comes_from_the_game(flow, value, state):
    w = await id_world(flow)
    await id_field(flow, pattern=r"[^#]+#\d{5,}", format_hint="Name#1234567")
    await set_id(flow, w["users"]["Mila"], value)

    row = await state_of(flow, w, "Mila")

    assert row["state"] == state
    if state == "format":
        assert row["ok"] is False
        assert "Name#1234567" in row["reason"]


@pytest.mark.asyncio
async def test_a_locked_id_stays_valid_when_the_format_comes_later(flow):
    w = await id_world(flow)
    await set_id(flow, w["users"]["Mila"], "AlteId")
    tournament = await flow.db.tournaments.find_one({"id": w["tournament"]["id"]}, {"_id": 0})
    ctx = await league_roster.context_for_tournament(flow.db, tournament, [w["users"]["Mila"]["id"]])
    await league_roster.record_members(flow.db, ctx, [w["users"]["Mila"]["id"]], via="assign", actor_id=None, squad_id=w["squad_a"]["id"])
    await id_field(flow, pattern=r"\d+", format_hint="nur Ziffern")

    assert (await state_of(flow, w, "Mila"))["state"] == "locked"


@pytest.mark.asyncio
async def test_an_options_field_accepts_only_its_options(flow):
    w = await id_world(flow)
    await id_field(flow, options=["Plattform A", "Plattform B"])
    await set_id(flow, w["users"]["Mila"], "Plattform A")
    await set_id(flow, w["users"]["Tom"], "Etwas anderes")

    assert (await state_of(flow, w, "Mila"))["state"] == "pending"
    assert (await state_of(flow, w, "Tom"))["state"] == "format"


@pytest.mark.asyncio
async def test_a_taken_id_is_refused_without_naming_the_owner(flow):
    w = await id_world(flow)
    await rules(flow, w, unique_game_ids=True)
    await set_id(flow, w["users"]["Mila"], "Gleiche#1234567")
    await set_id(flow, w["users"]["Tom"], "gleiche#1234567")
    tournament = await flow.db.tournaments.find_one({"id": w["tournament"]["id"]}, {"_id": 0})
    ctx = await league_roster.context_for_tournament(flow.db, tournament, [w["users"]["Mila"]["id"]])
    await league_roster.record_members(flow.db, ctx, [w["users"]["Mila"]["id"]], via="assign", actor_id=None, squad_id=w["squad_a"]["id"])

    row = await state_of(flow, w, "Tom")

    assert (row["state"], row["ok"]) == ("taken", False)
    assert "Mila" not in row["reason"] and "Mila" not in json.dumps(row, ensure_ascii=False).replace(w["users"]["Tom"]["id"], "")
    assert (await state_of(flow, w, "Mila"))["state"] == "locked"

    await rules(flow, w, unique_game_ids=False)
    assert (await state_of(flow, w, "Tom"))["state"] == "pending"


@pytest.mark.asyncio
async def test_a_field_can_be_left_out_of_the_uniqueness(flow):
    w = await id_world(flow)
    await rules(flow, w, unique_game_ids=True)
    await id_field(flow, unique_in_season=False)
    await set_id(flow, w["users"]["Mila"], "Gleich")
    await set_id(flow, w["users"]["Tom"], "Gleich")
    tournament = await flow.db.tournaments.find_one({"id": w["tournament"]["id"]}, {"_id": 0})
    ctx = await league_roster.context_for_tournament(flow.db, tournament, [w["users"]["Mila"]["id"]])
    await league_roster.record_members(flow.db, ctx, [w["users"]["Mila"]["id"]], via="assign", actor_id=None, squad_id=w["squad_a"]["id"])

    assert (await state_of(flow, w, "Tom"))["state"] == "pending"


# ---------------------------------------------------------------- Vorrang und Teilnehmerliste


@pytest.mark.asyncio
async def test_a_ban_goes_before_every_other_state(flow):
    w = await id_world(flow, without=("Mila",))
    await rules(flow, w, min_age=18)
    await flow.db.users.update_one({"id": w["users"]["Mila"]["id"]}, {"$set": {"is_banned": True}})

    assert (await state_of(flow, w, "Mila"))["state"] == "banned"


@pytest.mark.asyncio
async def test_the_id_state_stays_readable_beside_the_eligibility(flow):
    w = await id_world(flow)
    await rules(flow, w, min_age=18)

    row = await state_of(flow, w, "Mila")

    assert (row["state"], row["id_state"], row["id_ok"]) == ("age_missing", "pending", True)


@pytest.mark.asyncio
async def test_check_participants_uses_every_rule(flow):
    w = await id_world(flow, without=("Ida",))
    await rules(flow, w, min_age=18)
    for name in ("Kapitaen", "Mila", "Tom"):
        await born(flow, w, name, years_ago(30))
    tournament = await flow.db.tournaments.find_one({"id": w["tournament"]["id"]}, {"_id": 0})
    members = [w["users"][name]["id"] for name in ("Kapitaen", "Mila", "Tom")]
    ctx = await league_eligibility.context_for_tournament(flow.db, tournament, members)
    rows = league_eligibility.statuses(ctx, members, w["squad_a"]["id"])

    league_eligibility.check_participants(rows, members, minimum=3, roster=set(members), side="Rudel A")
    with pytest.raises(league_eligibility.EligibilityError, match="mindestens 3"):
        league_eligibility.check_participants(rows, members[:2], minimum=3, roster=set(members), side="Rudel A")
    with pytest.raises(league_eligibility.EligibilityError, match="nur einmal"):
        league_eligibility.check_participants(rows, [members[0], *members], minimum=3, roster=set(members), side="Rudel A")
    with pytest.raises(league_eligibility.EligibilityError, match="Kader"):
        league_eligibility.check_participants(rows, [*members, "fremd"], minimum=3, roster=set(members), side="Rudel A")

    await born(flow, w, "Tom", None)
    ctx = await league_eligibility.context_for_tournament(flow.db, tournament, members)
    rows = league_eligibility.statuses(ctx, members, w["squad_a"]["id"])
    with pytest.raises(league_eligibility.EligibilityError, match="Tom"):
        league_eligibility.check_participants(rows, members, minimum=3, roster=set(members), side="Rudel A")
    # Wer schon auf der Liste steht, hält keine Korrektur auf.
    league_eligibility.check_participants(rows, members, minimum=3, roster=set(members), side="Rudel A", kept={w["users"]["Tom"]["id"]})
    # Mehr als die Teamgröße geht: Auswechslungen sind erlaubt.
    assert len(members) > w["tournament"]["team_size"]
