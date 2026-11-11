"""Fehlende Angaben sperren erst beim Spielen (docs/LIGA.md B.3, #2313): Die Anmeldung zeigt sie nur, Check-in und Aufstellung
halten sie auf. Ohne Datenbank, erfundene Namen."""
import pathlib
import sys
import re

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_eligibility as le  # noqa: E402
from services import league_roster  # noqa: E402

FIELD = {"key": "probe_id", "label": "Probe-ID", "required": True}
SQUAD = {"id": "sq1", "name": "Probe Eins", "member_ids": ["u1", "u2", "u3", "u4"]}


def person(uid: str, name: str, probe_id: str | None) -> dict:
    return {"id": uid, "display_name": name, "game_ids": {"probe": {"probe_id": probe_id} if probe_id else {}}}


def context(*, ages: dict[str, str], ids: dict[str, str | None]) -> le.EligibilityContext:
    names = {"u1": "Probe Anna", "u2": "Probe Ben", "u3": "Probe Cleo", "u4": "Probe Dino"}
    people = {uid: person(uid, names[uid], ids.get(uid, f"P#{uid}")) for uid in names}
    roster = league_roster.RosterContext(season_id="s1", league_id="l1", season={"id": "s1", "min_age": 18},
                                         game={"id": "g1", "slug": "probe"}, fields=[FIELD], people=people)
    return le.EligibilityContext(roster=roster, ages={uid: ages.get(uid, le.AGE_MET) for uid in names})


CASES = {
    "fehlendes Geburtsdatum": ({"u4": le.AGE_NO_DATE}, {}, le.AGE_MISSING, "/profile?tab=basic"),
    "fehlende ID": ({}, {"u4": None}, league_roster.MISSING, "/profile?tab=gaming"),
    "zu jung": ({"u4": le.AGE_NOT_MET_STATE}, {}, le.AGE_NOT_MET_STATE, None),
}


@pytest.mark.parametrize("case", sorted(CASES))
def test_a_missing_entry_never_blocks_the_registration(case):
    ages, ids, state, _url = CASES[case]

    assert le.registration_problems(context(ages=ages, ids=ids), SQUAD) == []


@pytest.mark.parametrize("case", sorted(CASES))
def test_a_missing_entry_is_an_open_point_with_the_way_into_the_own_profile(case):
    ages, ids, state, url = CASES[case]

    points = le.open_points(context(ages=ages, ids=ids), SQUAD, minimum=3)

    assert [(row["id"], row["state"], row["fix_url"]) for row in points["players"]] == [("u4", state, url)]
    assert points["shortfall"] is None
    assert not re.search(r"2015-\d\d-\d\d|\d\d\.\d\d\.2015", str(points)) and "birth" not in str(points)


@pytest.mark.parametrize("case", sorted(CASES))
def test_a_missing_entry_blocks_check_in_and_lineup(case):
    ages, ids, _state, _url = CASES[case]
    rows = le.statuses(context(ages=ages, ids=ids), SQUAD["member_ids"], "sq1")

    with pytest.raises(le.EligibilityError) as refused:
        le.check_participants(rows, ["u1", "u2", "u4"], minimum=3, roster=set(SQUAD["member_ids"]), side="Probe Eins",
                              action="anwesend sind")

    assert "Probe Dino kann nicht eingetragen werden" in refused.value.detail
    assert le.check_participants(rows, ["u1", "u2", "u3"], minimum=3, roster=set(SQUAD["member_ids"]), side="Probe Eins") == ["u1", "u2", "u3"]


def test_too_few_eligible_players_are_a_hint_at_registration_and_block_the_start():
    ctx = context(ages={"u3": le.AGE_NO_DATE}, ids={"u4": None})

    assert le.registration_problems(ctx, SQUAD) == []
    points = le.open_points(ctx, SQUAD, minimum=3)
    assert points["shortfall"] == ("Nur 2 von 4 Spielern sind spielberechtigt, für ein Spiel braucht ein Team mindestens 3. Bis zum ersten Spiel im Profil "
                                   "nachtragen. Sonst kann das Team nicht einchecken und gilt als nicht "
                                   "angetreten – die Liga-Leitung kann das Spiel dann kampflos werten.")
    assert [row["id"] for row in points["players"]] == ["u3", "u4"]
    rows = le.statuses(ctx, SQUAD["member_ids"], "sq1")
    with pytest.raises(le.EligibilityError):
        le.check_participants(rows, ["u1", "u2"], minimum=3, roster=set(SQUAD["member_ids"]), side="Probe Eins", action="anwesend sind")


def test_a_person_with_two_open_entries_hears_both():
    ctx = context(ages={"u4": le.AGE_NO_DATE}, ids={"u4": None})

    row = le.open_points(ctx, SQUAD, minimum=3)["players"][0]

    assert row["reasons"] == ["Geburtsdatum fehlt. Die Person trägt es im eigenen Profil ein.", "Probe-ID fehlt im Profil."]
    assert row["fixable"] is True


@pytest.mark.parametrize("hours", [None, 0, 48, 72])
def test_the_reminder_setting_never_changes_the_checkin_block_of_the_rulebook(hours):
    """Der Baustein ``[[baustein:checkin]]`` friert seine Quelle ein - die Erinnerung (#2313) darf keine Fassung veraltet machen."""
    import asyncio

    from services import league_rule_blocks

    base = {"opens_minutes_before": 15, "closes_minutes_after": 15, "min_present": 3, "remind_minutes_before_close": 5}
    rules = base if hours is None else {**base, "open_points_remind_hours": hours}

    with_value = asyncio.run(league_rule_blocks._checkin(None, {}, {"checkin_rules": rules}))
    without = asyncio.run(league_rule_blocks._checkin(None, {}, {"checkin_rules": base}))

    assert with_value == without
    assert "open_points_remind_hours" not in str(with_value)


def test_other_rules_stay_blockers():
    ctx = context(ages={}, ids={})
    ctx.memberships = {"u2": {"sq-other"}}
    season = {**ctx.roster.season, "max_squad_size": 3}
    ctx.roster.season = season

    texts = [text for _code, text in le.registration_problems(ctx, SQUAD)]

    assert any("höchstens 3" in text for text in texts)
    assert any("anderen Co-Team" in text for text in texts)
