"""Gegenproben zu #2404 (docs/LIGA.md „F.6 … Darf nicht kaputtgehen“): Was ohne ``league_context.kind`` und ohne ``postseason`` gilt,
bleibt unverändert - andere Turnierformate, reguläre Staffeln, alte Seasons. Dazu die Plätze aus dem Baum, rein gerechnet."""
import pathlib
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_calendar, league_veto, matchday_schedule, squad_registration  # noqa: E402
from services import league_postseason_final as final  # noqa: E402

REGULAR = {"id": "t1", "format": "league", "league_context": {"season_id": "s1", "division_id": "d1", "staffel": "A"}}
PLAYOFF = {"id": "t2", "format": "single_elim", "league_context": {"season_id": "s1", "division_id": "d1", "staffel": "PO", "kind": "playoff"}}
CUP = {"id": "t3", "format": "single_elim"}


# ---------------------------------------------------------------- andere Formate und reguläre Staffeln

def test_only_a_league_postseason_staffel_plays_knockout_rounds_as_weeks():
    assert matchday_schedule.plays_in_matchdays(PLAYOFF)
    assert matchday_schedule.plays_in_matchdays(PLAYOFF, {"stage_type": "single_elimination"})
    # Ein K.-o.-Turnier ohne Liga hat weiter keine Spielwochen - auch nicht eine reguläre Staffel mit K.-o.-Phase.
    assert not matchday_schedule.plays_in_matchdays(CUP)
    assert not matchday_schedule.plays_in_matchdays(CUP, {"stage_type": "single_elimination"})
    assert not matchday_schedule.plays_in_matchdays(REGULAR, {"stage_type": "single_elimination"})
    assert matchday_schedule.plays_in_matchdays(REGULAR)
    assert not matchday_schedule.plays_in_matchdays({**PLAYOFF, "event_mode": "local"})


def test_home_is_the_upper_slot_unless_a_playoff_game_carries_its_seeds():
    slots = [{"registration_id": "low"}, {"registration_id": "top"}]
    assert matchday_schedule.duel_sides({"slots": slots}) == ("low", "top")
    marked = {"slots": slots, "postseason": {"home": "better_seed", "seeds": {"low": 4, "top": 1}}}
    assert matchday_schedule.duel_sides(marked) == ("top", "low") and matchday_schedule.home_registration_id(marked) == "top"
    # Los statt Setzplatz, ein fehlender Setzplatz oder ein freier Platz: Es bleibt bei der Reihenfolge im Baum.
    assert matchday_schedule.duel_sides({"slots": slots, "postseason": {"home": "draw", "seeds": {"low": 4, "top": 1}}}) == ("low", "top")
    assert matchday_schedule.duel_sides({"slots": slots, "postseason": {"home": "better_seed", "seeds": {"low": 4}}}) == ("low", "top")
    assert matchday_schedule.duel_sides({"slots": [{"registration_id": "low"}, {}], "postseason": {"home": "better_seed", "seeds": {}}}) == ("low", None)


def test_the_season_key_stays_for_regular_staffeln_only():
    assert squad_registration.league_squad_key(REGULAR, "sq") == "s1:sq"
    assert squad_registration.league_squad_key(PLAYOFF, "sq") is None
    assert squad_registration.league_squad_key(CUP, "sq") is None


def test_the_veto_template_follows_the_best_of_only_where_the_staffel_carries_one():
    base = {"enabled": True, "team_a": "home", "step_seconds": 60, "steps": [{"kind": "decider", "mode": "flagge", "team": None, "position": 1}]}
    own = {"enabled": True, "team_a": "home", "step_seconds": 45, "steps": [{"kind": "decider", "mode": "flagge", "team": None, "position": 3}]}
    assert league_veto.rules_for_best_of(REGULAR, base, 5) is base
    assert league_veto.rules_for_best_of({**PLAYOFF, "veto_by_best_of": {"5": own}}, base, 5)["step_seconds"] == 45
    assert league_veto.rules_for_best_of({**PLAYOFF, "veto_by_best_of": {"5": own}}, base, 3) is base
    # Ein verbogener Eintrag gilt nicht.
    assert league_veto.rules_for_best_of({**PLAYOFF, "veto_by_best_of": {"5": {"steps": "kaputt"}}}, base, 5) is base


def test_the_season_end_only_moves_with_the_postseason_field():
    season = {"start_date": "2031-03-03T00:00:00", "weeks_total": 4, "matchday_days": 7}
    regular = league_calendar.season_end_at(season)
    assert regular == datetime(2031, 3, 30, 22, 0, tzinfo=timezone.utc)
    assert league_calendar.season_end_at({**season, "postseason_end": "2031-04-20T21:59:59+00:00"}).isoformat() == "2031-04-20T21:59:59+00:00"
    # Ein Wert vor dem Ende der regulären Season zählt nicht, der Abschluss durch die Leitung schlägt alles.
    assert league_calendar.season_end_at({**season, "postseason_end": "2031-03-01T00:00:00+00:00"}) == regular
    closed = league_calendar.season_end_at({**season, "postseason_end": "2031-04-20T21:59:59+00:00", "closed_at": "2031-04-01T10:00:00+00:00"})
    assert closed.isoformat() == "2031-04-01T10:00:00+00:00"


# ---------------------------------------------------------------- Plätze aus dem Baum

def match(key: str, round_number: int, a: str | None, b: str | None, winner: str | None = None, *, section: str = "WB", **extra) -> dict:
    slots = [{"registration_id": side, "status": "filled" if side else "bye"} for side in (a, b)]
    results = [{"registration_id": winner, "rank": 1}, {"registration_id": b if winner == a else a, "rank": 2}] if winner else []
    return {"id": key, "round": round_number, "section": section, "slots": slots, "results": results,
            "status": "completed" if winner else "ready", **extra}


def regs(*names: str) -> list[dict]:
    return [{"id": name, "display_name": name.upper(), "seed": index + 1, "status": "approved"} for index, name in enumerate(names)]


def ranks(rows: list[dict]) -> dict[str, int]:
    return {row["registration_id"]: row["rank"] for row in rows}


def test_eight_teams_share_place_five_and_three():
    matches = [match("q1", 1, "a", "h", "a"), match("q2", 1, "d", "e", "d"), match("q3", 1, "b", "g", "b"), match("q4", 1, "c", "f", "c"),
               match("s1", 2, "a", "d", "a"), match("s2", 2, "b", "c", "b"), match("f", 3, "a", "b", "a")]
    rows = final.playoff_rows(matches, regs("a", "b", "c", "d", "e", "f", "g", "h"))
    assert ranks(rows) == {"a": 1, "b": 2, "c": 3, "d": 3, "e": 5, "f": 5, "g": 5, "h": 5}
    assert [row["reached"] for row in rows[:4]] == ["Finale", "Finale", "Halbfinale", "Halbfinale"] and rows[4]["reached"] == "Viertelfinale"
    assert final.final_match_id(matches) == "f"


def test_the_game_for_third_place_splits_three_and_four():
    matches = [match("s1", 1, "a", "d", "a"), match("s2", 1, "b", "c", "b"), match("f", 2, "a", "b", "b"),
               match("p3", 2, "d", "c", "d", section="BRONZE")]
    assert ranks(final.playoff_rows(matches, regs("a", "b", "c", "d"))) == {"b": 1, "a": 2, "d": 3, "c": 4}


def test_a_bye_counts_as_reaching_the_next_round_but_not_as_a_played_game():
    matches = [match("q1", 1, "a", None, "a", result_meta={"source": "auto_bye"}), match("q2", 1, "b", "c", "b"), match("f", 2, "a", "b", "b")]
    rows = final.playoff_rows(matches, regs("a", "b", "c"))
    assert ranks(rows) == {"b": 1, "a": 2, "c": 3}
    assert {row["registration_id"]: row["played"] for row in rows} == {"b": 2, "a": 1, "c": 1}


def test_an_open_bracket_gives_no_champion():
    matches = [match("s1", 1, "a", "d", "a"), match("s2", 1, "b", "c"), match("f", 2, "a", None)]
    rows = final.playoff_rows(matches, regs("a", "b", "c", "d"))
    assert all(row["rank"] != 1 for row in rows)


def test_relegation_rows_follow_the_winner():
    registrations = [
        {"id": "u", "display_name": "Oben", "squad_id": "su", "status": "approved", "postseason": {"pair": 1, "side": "upper"}},
        {"id": "l", "display_name": "Unten", "squad_id": "sl", "status": "approved", "postseason": {"pair": 1, "side": "lower"}}]
    rows, outcome = final.relegation_rows([match("r", 1, "u", "l", "l")], registrations)
    assert outcome == {"su": "down", "sl": "up"} and [row["result"] for row in rows] == ["lost", "won"]
    _rows, stay = final.relegation_rows([match("r", 1, "u", "l", "u")], registrations)
    assert stay == {"su": "stay", "sl": "stay"}
    # Noch nicht gespielt: Niemand bewegt sich.
    _rows, pending = final.relegation_rows([match("r", 1, "u", "l")], registrations)
    assert pending == {"su": "stay", "sl": "stay"}
