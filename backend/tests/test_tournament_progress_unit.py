"""Turnier-Meldungen (#1209) ohne Datenbank: Wer ist nach einem Spiel weiter, wer im Loser Bracket, wer ausgeschieden?"""
from services import tournament_progress as progress


def _duel(*, edges, results, **extra):
    return {"id": "m1", "match_type": "duel", "round_name": "Halbfinale", "advancement": edges,
            "results": results, "status": "completed", **extra}


WIN_LOSE = [{"registration_id": "a", "rank": 1}, {"registration_id": "b", "rank": 2}]


def test_single_elimination_winner_goes_on_and_loser_is_out():
    match = _duel(edges=[{"flow": "W", "rank": 1, "to_match_key": "F"}], results=WIN_LOSE)
    assert progress.outcomes(match) == {"a": ("advanced", 1), "b": ("eliminated", 2)}


def test_double_elimination_loser_plays_on_in_the_lower_bracket():
    match = _duel(edges=[{"flow": "W", "rank": 1, "to_match_key": "W2"}, {"flow": "L", "rank": 1, "to_match_key": "L1"}],
                  results=WIN_LOSE)
    assert progress.outcomes(match) == {"a": ("advanced", 1), "b": ("lower", 2)}


def test_a_heat_takes_the_first_places_on():
    results = [{"registration_id": rid, "rank": rank} for rank, rid in enumerate("abcd", start=1)]
    match = {"id": "h1", "match_type": "ffa", "round_name": "Durchgang C", "status": "completed", "results": results,
             "advancement": [{"flow": "R", "rank": 1, "to_match_key": "F"}, {"flow": "R", "rank": 2, "to_match_key": "F"}]}
    assert progress.outcomes(match) == {"a": ("advanced", 1), "b": ("advanced", 2), "c": ("eliminated", 3), "d": ("eliminated", 4)}


def test_no_show_never_advances_on_the_winner_path():
    match = _duel(edges=[{"flow": "W", "rank": 1, "to_match_key": "F"}],
                  results=[{"registration_id": "a", "rank": 1, "forfeit": True}, {"registration_id": "b", "rank": 2}])
    assert progress.outcomes(match)["a"] == ("eliminated", 1)


def test_final_group_and_league_games_say_nothing():
    """Ohne Weiterleitung: Finale (dafür gibt es „Turnier beendet“), Gruppe, Liga-Spieltag."""
    assert progress.outcomes(_duel(edges=[], results=WIN_LOSE)) == {}
    assert progress.outcomes(_duel(edges=[{"flow": "W", "rank": 1}], results=WIN_LOSE, status="pending")) == {}


def test_the_old_engine_with_next_match_fields():
    match = {"id": "m1", "status": "completed", "winner_id": "a", "loser_id": "b", "next_match_id": "m9"}
    assert progress.outcomes(match) == {"a": ("advanced", 1), "b": ("eliminated", 2)}
    match["next_loser_match_id"] = "m8"
    assert progress.outcomes(match) == {"a": ("advanced", 1), "b": ("lower", 2)}


def test_the_texts():
    duel = {"round_name": "Halbfinale", "match_type": "duel"}
    assert progress.message("Winter Cup", duel, "advanced", 1, 2) == ("Du bist weiter!", "Winter Cup · Halbfinale: gewonnen – du bist in der nächsten Runde.")
    assert progress.message("Winter Cup", duel, "lower", 2, 2) == ("Weiter im Loser Bracket", "Winter Cup · Halbfinale: verloren – du spielst im Loser Bracket weiter.")
    assert progress.message("Winter Cup", duel, "eliminated", 2, 2) == ("Ausgeschieden", "Winter Cup · Halbfinale: leider raus. Danke fürs Mitspielen!")
    heat = {"round_name": "Durchgang C", "match_type": "ffa"}
    assert progress.message("Winter Cup", heat, "advanced", 2, 8) == ("Platz 2 im Durchgang C: weiter", "Winter Cup: Du bist in der nächsten Runde.")
    assert progress.message("Winter Cup", heat, "eliminated", 5, 8) == ("Ausgeschieden: Platz 5 von 8", "Winter Cup · Durchgang C: leider nicht weiter. Danke fürs Mitspielen!")


def test_pause_texts():
    assert progress.pause_message("Winter Cup", "2026-11-26T13:30:00+00:00") == ("Pause bis 14:30", "Winter Cup: Es geht um 14:30 Uhr weiter.")
    assert progress.pause_message("Winter Cup", None) == ("Kurze Pause", "Winter Cup: Kurze Pause – es geht gleich weiter.")


def test_round_names_read_as_german():
    """„Platz 1 im Runde 1“ war falsch (Prüfung 26.11.): in Runde 1, im Durchgang C, ohne Namen nur der Platz."""
    assert progress.message("Cup", {"match_type": "ffa", "round": 1}, "advanced", 1, 4)[0] == "Platz 1 in Runde 1: weiter"
    assert progress.message("Cup", {"match_type": "ffa", "round_name": "Durchgang C"}, "advanced", 2, 8)[0] == "Platz 2 im Durchgang C: weiter"
    assert progress.message("Cup", {"match_type": "ffa", "round_name": "Gruppe B"}, "advanced", 2, 8)[0] == "Platz 2 in Gruppe B: weiter"
    assert progress.message("Cup", {"match_type": "ffa", "round_name": "Viertelfinale"}, "advanced", 1, 4)[0] == "Platz 1 im Viertelfinale: weiter"
    assert progress.message("Cup", {"match_type": "ffa"}, "advanced", 2, 8) == ("Platz 2: weiter", "Cup: Du bist in der nächsten Runde.")
    assert progress.message("Cup", {"match_type": "duel"}, "eliminated", 2, 2) == ("Ausgeschieden", "Cup: leider raus. Danke fürs Mitspielen!")
