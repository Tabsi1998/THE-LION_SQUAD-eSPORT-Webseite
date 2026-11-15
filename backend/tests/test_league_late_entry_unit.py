"""Nachmeldung (#2422): die reine Rechnung - welche Woche eine Paarung bekommt, Heimrecht, was entfällt, und das wirksame Ende der
Anmeldung mit Nachmeldefrist (Nr. 183, 184). Ohne Datenbank, erfundene Namen."""
from __future__ import annotations

import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_late  # noqa: E402
from services.league_late_entry import late_mark, match_docs, open_matchdays, plan  # noqa: E402

NOW = datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc)


def staffel(*, weeks: int, legs: int = 1, days_ago: int = 10, **extra) -> dict:
    return {"id": "t1", "title": "Staffel A", "format": "league", "start_date": (NOW - timedelta(days=days_ago)).isoformat(),
            "matchday_weeks_total": weeks, "round_robin_legs": legs, "league_context": {"season_id": "s1"}, **extra}


def reg(name: str, **extra) -> dict:
    return {"id": name, "display_name": f"Team {name}", "status": "approved", **extra}


def duel(day: int, home: str, away: str, **extra) -> dict:
    return {"id": f"m{day}{home}{away}", "tournament_id": "t1", "stage_id": "st", "stage_type": "league", "match_type": "duel",
            "match_key": f"K{day}{home}{away}", "section": "LIGA", "round": day, "order": day, "status": "ready",
            "settings": {"min_players": 2}, "slots": [{"slot": 1, "registration_id": home}, {"slot": 2, "registration_id": away}], **extra}


# Drei Teams, Hin- und Rückrunde (Kreisverfahren): je Spieltag hat ein Team spielfrei.
DOUBLE = [duel(1, "A", "B"), duel(2, "C", "A"), duel(3, "B", "C"), duel(4, "B", "A"), duel(5, "A", "C"), duel(6, "C", "B")]
TEAMS = [reg("A"), reg("B"), reg("C"), reg("L")]


def test_only_weeks_that_have_not_begun_are_open():
    # Woche 1 ist vorbei, Woche 2 läuft: offen ab Spieltag 3 bis zur letzten aktiven Woche.
    assert open_matchdays(staffel(weeks=8), DOUBLE, NOW) == [3, 4, 5, 6, 7, 8]
    # Sperrwoche 4: Spieltag 3 in Woche 3, Spieltag 4 in Woche 5 - aktive Wochen ohne die Sperrwoche.
    assert open_matchdays(staffel(weeks=8, matchday_blocked_weeks=[4]), DOUBLE, NOW) == [3, 4, 5, 6, 7]


def test_both_legs_find_a_week_and_the_sides_swap():
    out = plan(staffel(weeks=8, legs=2), reg("L"), TEAMS, DOUBLE, NOW)
    assert out["missing"] == []
    by_opponent: dict[str, list[dict]] = {}
    for row in out["pairings"]:
        by_opponent.setdefault(row["opponent_id"], []).append(row)
    days = {key: [row["matchday"] for row in rows] for key, rows in by_opponent.items()}
    # Das Freilos zuerst (A in 3 und 6, B in 5, C in 4), die zweiten Spiele von B und C in den Reservewochen 7 und 8.
    assert days["A"] == [3, 6] and days["B"][0] == 5 and days["C"][0] == 4 and {days["B"][1], days["C"][1]} == {7, 8}
    for rows in by_opponent.values():
        assert rows[0]["home_registration_id"] == rows[1]["away_registration_id"]
    # Je Woche höchstens ein Spiel des neuen Teams, nie in einer Woche, in der der Gegner schon spielt.
    assert len({row["matchday"] for row in out["pairings"]}) == len(out["pairings"])
    busy = {(match["round"], side["registration_id"]) for match in DOUBLE for side in match["slots"]}
    assert not [row for row in out["pairings"] if (row["matchday"], row["opponent_id"]) in busy]


def test_what_does_not_fit_is_named():
    out = plan(staffel(weeks=6, legs=2), reg("L"), TEAMS, DOUBLE, NOW)
    assert sorted(row["opponent_id"] for row in out["pairings"]) == ["A", "A", "B", "C"]
    assert [(row["opponent_id"], row["text"]) for row in out["missing"]] == [
        ("B", "Gegen Team B kein zweites Spiel mehr möglich."), ("C", "Gegen Team C kein zweites Spiel mehr möglich.")]
    single = plan(staffel(weeks=3), reg("L"), TEAMS, DOUBLE[:3], NOW)
    assert [row["opponent_id"] for row in single["pairings"]] == ["A"] and single["pairings"][0]["kind"] == "bye"
    assert [row["text"] for row in single["missing"]] == ["Gegen Team B kein Spiel mehr möglich.", "Gegen Team C kein Spiel mehr möglich."]


def test_home_right_stays_balanced_in_one_leg():
    teams = [reg(name) for name in "ABCDE"] + [reg("L")]
    out = plan(staffel(weeks=12), reg("L"), teams, [duel(1, "A", "B"), duel(1, "C", "D")], NOW)
    homes = sum(1 for row in out["pairings"] if row["home_registration_id"] == "L")
    assert len(out["pairings"]) == 5 and abs(homes - (5 - homes)) <= 1


def test_a_left_team_and_a_cancelled_game():
    teams = [reg("A"), reg("B", removal={"mode": "forfeit"}), reg("C"), reg("D"), reg("L")]
    games = [duel(1, "A", "B"), duel(1, "C", "D"), duel(2, "A", "C"), duel(2, "B", "D"), duel(3, "A", "D"), duel(3, "B", "C", status="cancelled")]
    out = plan(staffel(weeks=3), reg("L"), teams, games, NOW)
    # Wer ausgetreten ist (B), bekommt kein Spiel; das abgesagte Spiel macht C in Woche 3 frei, A und D spielen dort.
    assert [(row["opponent_id"], row["kind"]) for row in out["pairings"]] == [("C", "free")]
    assert [row["opponent_id"] for row in out["missing"]] == ["A", "D"]


def test_the_fingerprint_follows_the_situation():
    first = plan(staffel(weeks=4), reg("L"), TEAMS, DOUBLE[:3], NOW)
    assert plan(staffel(weeks=4), reg("L"), TEAMS, DOUBLE[:3], NOW)["fingerprint"] == first["fingerprint"]
    changed = [*DOUBLE[:2], duel(3, "B", "C", status="cancelled")]
    assert plan(staffel(weeks=4), reg("L"), TEAMS, changed, NOW)["fingerprint"] != first["fingerprint"]


def test_only_a_fixed_plan_marks_a_late_entry():
    assert late_mark(staffel(weeks=4), [], NOW) is None
    assert late_mark(staffel(weeks=4), [{**DOUBLE[0], "is_preview": True}], NOW) is None
    assert late_mark(staffel(weeks=4), DOUBLE[:3], NOW) == {"state": "open", "from_matchday": 3, "from_week": 3, "marked_at": NOW.isoformat()}
    assert late_mark(staffel(weeks=3, days_ago=30), DOUBLE[:3], NOW)["from_week"] is None


def test_new_games_look_like_the_generated_ones():
    tournament = staffel(weeks=4)
    out = plan(tournament, reg("L"), TEAMS, DOUBLE[:3], NOW)
    docs = match_docs(tournament, out, DOUBLE[:3], TEAMS, NOW)
    assert [doc["round"] for doc in docs] == [3, 4]
    assert all(doc["stage_id"] == "st" and doc["section"] == "LIGA" and doc["match_type"] == "duel" and doc["status"] == "ready"
               and doc["round_name"] == f"Spieltag {doc['round']}" and not doc["is_preview"] for doc in docs)
    assert len({doc["match_key"] for doc in docs} | {match["match_key"] for match in DOUBLE[:3]}) == 5
    assert docs[0]["order"] > max(match["order"] for match in DOUBLE[:3])


def season(**extra) -> dict:
    return {"start_date": "2026-11-01T00:00:00+00:00", "application_opens_at": "2026-10-01T00:00:00+00:00",
            "application_closes_at": "2026-12-31T00:00:00+00:00", **extra}


def test_the_window_closes_two_weeks_after_the_start_by_default():
    assert league_late.effective_closes_iso(season()) == "2026-11-15T00:00:00+00:00"
    assert league_late.capped(season())
    assert league_late.effective_closes_iso(season(late_registration_days=30)) == "2026-12-01T00:00:00+00:00"
    assert league_late.effective_closes_iso(season(late_registration_days=0)) == "2026-11-01T00:00:00+00:00"
    # Endet das Fenster vor dem Start oder vor der Frist, bleibt es beim Fenster.
    early = season(application_closes_at="2026-11-05T00:00:00+00:00")
    assert league_late.effective_closes_iso(early) == "2026-11-05T00:00:00+00:00" and not league_late.capped(early)
    assert league_late.effective_closes_iso({"start_date": "2026-11-01T00:00:00+00:00"}) is None
    # Ein kaputter Wert gilt als Vorgabe.
    assert league_late.late_days(season(late_registration_days="viel")) == 14


def test_an_extension_with_reason_moves_the_end():
    row = season(application_late_extension={"until": "2026-11-25T00:00:00+00:00", "reason": "Nachrücker"})
    assert league_late.effective_closes_iso(row) == "2026-11-25T00:00:00+00:00"
    now = datetime(2026, 11, 10, tzinfo=timezone.utc)
    value, reason = league_late.clean_extension(season(), "2026-11-20T00:00:00+00:00", "  Nachrücker   aus Liga 2 ", now)
    assert value == {"until": "2026-11-20T00:00:00+00:00", "reason": "Nachrücker aus Liga 2", "at": now.isoformat()}
    assert reason == "Nachrücker aus Liga 2"
    for until, why in (("2026-11-20T00:00:00+00:00", "kurz"), ("2026-11-10T00:00:00+00:00", "Nachrücker"),
                       ("2027-01-10T00:00:00+00:00", "Nachrücker"), ("kaputt", "Nachrücker")):
        with pytest.raises(ValueError):
            league_late.clean_extension(season(), until, why, now)
    with pytest.raises(ValueError):
        league_late.clean_extension(season(), None, "Zurück auf regulär", now)
    assert league_late.clean_extension(row, None, "Zurück auf regulär", now) == (None, "Zurück auf regulär")


def test_the_pdf_names_a_late_entry():
    from pdf_service import _standing_name

    assert _standing_name({"display_name": "Rudel A", "late_entry": True, "late_from_week": 3}) == "Rudel A (nachgemeldet ab Woche 3)"
    assert _standing_name({"display_name": "Rudel A", "late_entry": True}) == "Rudel A (nachgemeldet)"
    assert _standing_name({"display_name": "Rudel A"}) == "Rudel A"


def test_the_note_is_the_same_everywhere():
    from services.bracket_common import late_entry_note

    assert late_entry_note({"state": "done", "from_week": 4}) == "nachgemeldet ab Woche 4"
    assert late_entry_note(True, 3) == "nachgemeldet ab Woche 3"
    assert late_entry_note({"state": "open", "from_week": None}) == "nachgemeldet"
    assert late_entry_note(None) == "" and late_entry_note({}) == ""


def test_the_rulebook_names_the_late_registration_only_with_a_window_past_the_start():
    from services.league_rule_facts import eligibility_data, render_eligibility

    text = render_eligibility(eligibility_data(season(), []))
    assert "- Nachmeldung: bis 14 Tage nach dem Season-Start. Wer nach dem Start einer laufenden Staffel zugeteilt wird, spielt nur die " \
           "noch offenen Spielwochen, ohne Nachholspiele für vergangene Wochen." in text
    assert "- Nachmeldung: nur bis zum Season-Start." in render_eligibility(eligibility_data(season(late_registration_days=0), []))
    assert "Nachmeldung" not in render_eligibility(eligibility_data(season(application_closes_at="2026-10-20T00:00:00+00:00"), []))
    assert "Nachmeldung" not in render_eligibility(eligibility_data({"start_date": "2026-11-01T00:00:00+00:00"}, []))


def test_the_second_leg_swaps_the_sides_of_the_existing_game():
    """Review #2422: X hatte schon zu Hause gegen das neue Team - das zweite Spiel hat getauschte Seiten, auch wenn X sonst
    mehr Auswärtsspiele hat."""
    teams = [reg("X"), reg("Y"), reg("Z"), reg("L")]
    games = [duel(1, "X", "L"), duel(1, "Y", "Z"), duel(2, "Y", "X"), duel(2, "Z", "X")]
    out = plan(staffel(weeks=6, legs=2), reg("L"), teams, games, NOW)
    against_x = [row for row in out["pairings"] if row["opponent_id"] == "X"]
    assert len(against_x) == 1 and against_x[0]["home_registration_id"] == "L"


def test_an_old_extension_never_shortens_a_longer_deadline():
    """Review #2422: Frist später auf 30 Tage, die alte Verlängerung lag davor - es gilt die Frist, begrenzt aufs Fensterende."""
    row = season(late_registration_days=30, application_late_extension={"until": "2026-11-20T00:00:00+00:00", "reason": "Nachrücker"})
    assert league_late.effective_closes_iso(row) == "2026-12-01T00:00:00+00:00"
    short = season(application_closes_at="2026-11-25T00:00:00+00:00", application_late_extension={"until": "2026-12-10T00:00:00+00:00"})
    assert league_late.effective_closes_iso(short) == "2026-11-25T00:00:00+00:00"
