"""Die eine Rangfunktion der Fast Lap (#1584): Strafe eingerechnet (gerundet, nicht abgeschnitten), ungültige und
Vereins-Referenzzeiten raus, bei Gleichstand liegt die früher gefahrene Zeit vorn. Versuche zählen alle Zeiten der
Wertung, auch ungültige."""
from services.fastlap_standings import championship_totals, effective_ms, rank_laps, track_ranking


def lap(user, ms, at, **extra):
    return {"id": f"{user}-{ms}-{at}", "user_id": user, "time_ms": ms, "created_at": f"2026-10-31T{at}:00+00:00", **extra}


def test_equal_times_the_earlier_one_leads_whatever_the_order():
    early, late = lap("anna", 80000, "10:00"), lap("bert", 80000, "11:00")
    assert [row["user_id"] for row in rank_laps([late, early])] == ["anna", "bert"]
    assert [row["user_id"] for row in rank_laps([early, late])] == ["anna", "bert"]
    assert [row["rank"] for row in rank_laps([late, early])] == [1, 2]


def test_a_tie_in_effective_time_counts_after_the_penalty():
    clean = lap("anna", 80000, "11:00")
    punished = lap("bert", 78000, "10:00", penalty_seconds=2)
    assert [row["user_id"] for row in rank_laps([clean, punished])] == ["bert", "anna"]


def test_the_own_best_is_the_earlier_of_two_equal_laps():
    first, second = lap("anna", 80000, "10:00"), lap("anna", 80000, "12:00")
    rival = lap("bert", 80000, "11:00")
    ranked = rank_laps([second, rival, first])
    assert [row["user_id"] for row in ranked] == ["anna", "bert"]
    assert ranked[0]["id"] == first["id"]


def test_invalid_and_reference_times_do_not_rank_but_invalid_counts_as_attempt():
    rows = [
        lap("anna", 80000, "10:00"),
        lap("anna", 70000, "10:05", is_invalid=True),
        lap("bert", 60000, "10:10", score_scope="club_reference"),
        lap("carl", 50000, "10:15", is_invalid=True),
    ]
    ranked = rank_laps(rows)
    assert [(row["user_id"], row["effective_ms"], row["attempts"]) for row in ranked] == [("anna", 80000, 2)]
    reference = rank_laps(rows, scope="club_reference")
    assert [(row["user_id"], row["attempts"]) for row in reference] == [("bert", 1)]


def test_penalty_is_rounded_and_none_is_no_penalty():
    assert effective_ms({"time_ms": 80000, "penalty_seconds": 2.01}) == 82010
    assert effective_ms({"time_ms": 80000, "penalty_seconds": 0.3}) == 80300
    assert effective_ms({"time_ms": 80000, "penalty_seconds": None}) == 80000
    assert rank_laps([lap("anna", 80000, "10:00", penalty_seconds=None)])[0]["effective_ms"] == 80000


def test_track_ranking_and_championship_use_the_same_tie_rule():
    rows = [lap("bert", 80000, "11:00"), lap("anna", 80000, "10:00")]
    assert track_ranking(rows) == [("anna", 80000), ("bert", 80000)]
    standings, per_track = championship_totals([{"id": "t1"}], {"t1": rows})
    assert [entry["user_id"] for entry in per_track["t1"]["results"]] == ["anna", "bert"]
    assert standings[0]["user_id"] == "anna" and standings[0]["wins"] == 1


def test_unknown_drive_time_goes_behind_a_known_one():
    known = lap("bert", 80000, "11:00")
    unknown = {"id": "x", "user_id": "anna", "time_ms": 80000}
    assert [row["user_id"] for row in rank_laps([unknown, known])] == ["bert", "anna"]
