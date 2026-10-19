"""Wer hat gewonnen (#1796): eine Regel für alle Sieg-Erfolge - egal, auf welchem Weg das Ergebnis kam.

Eingetragene Ergebnisse (Leitung, Helfer, Spielermeldung, Wertung) speichern in ``matches_v2.results`` nur den Platz,
kein ``outcome``. Ältere Daten und der Turnierbaum kennen ``outcome``, die alte Engine ``winner_id``."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.match_winner import is_duel, match_winner_id, won_by  # noqa: E402


def duel(first: dict, second: dict, **extra) -> dict:
    return {"status": "completed", "slots": [{"slot": 1, "registration_id": "a"}, {"slot": 2, "registration_id": "b"}],
            "results": [{"registration_id": "a", **first}, {"registration_id": "b", **second}], **extra}


def test_platz_eins_ohne_outcome_ist_sieg():
    match = duel({"rank": 1, "score": 3}, {"rank": 2, "score": 0})
    assert match_winner_id(match) == "a"
    assert won_by(match, {"a"}) and not won_by(match, {"b"})


def test_outcome_geht_vor_platz():
    match = duel({"rank": 2, "outcome": "winner"}, {"rank": 1, "outcome": "loser"})
    assert match_winner_id(match) == "a"


def test_nur_winner_id_der_alten_engine():
    match = {"status": "completed", "winner_id": "b", "slots": [{"registration_id": "a"}, {"registration_id": "b"}], "results": []}
    assert match_winner_id(match) == "b"
    assert won_by(match, {"b"}) and not won_by(match, {"a"})


def test_unentschieden_hat_keinen_sieger():
    assert match_winner_id(duel({"rank": 1, "score": 1}, {"rank": 1, "score": 1})) is None
    assert match_winner_id(duel({"outcome": "draw"}, {"outcome": "draw"})) is None
    # Der Turnierbaum schreibt ein Unentschieden auch als zwei Sieger mit Platz 1.
    assert match_winner_id(duel({"rank": 1, "outcome": "winner"}, {"rank": 1, "outcome": "winner"})) is None


def test_aufgabe_und_nicht_beendet_gewinnen_nie():
    # Wertung „nicht erschienen“: der Gegner gewinnt.
    assert match_winner_id(duel({"rank": 1}, {"rank": 2, "forfeit": True})) == "a"
    # Ein Platz 1 mit Aufgabe ist kein Sieg - auch wenn er so gespeichert wäre.
    assert match_winner_id(duel({"rank": 1, "forfeit": True}, {"rank": 2})) is None
    assert match_winner_id(duel({"rank": 1, "dnf": True}, {"rank": 2})) is None
    assert match_winner_id(duel({"outcome": "forfeit", "rank": 2}, {"outcome": "winner", "rank": 1})) == "b"


def test_ffa_lauf_platz_eins_gewinnt():
    heat = {"status": "completed", "slots": [{"registration_id": reg} for reg in "abcd"],
            "results": [{"registration_id": "c", "rank": 1, "time_ms": 61000}, {"registration_id": "a", "rank": 2},
                        {"registration_id": "d", "rank": 3}, {"registration_id": "b", "rank": 4, "dnf": True}]}
    assert match_winner_id(heat) == "c"
    assert won_by(heat, {"c"}) and not won_by(heat, {"a", "b", "d"})
    shared = {**heat, "results": [{"registration_id": "a", "rank": 1}, {"registration_id": "b", "rank": 1}, {"registration_id": "c", "rank": 3}]}
    assert match_winner_id(shared) is None, "geteilter Platz 1 ist kein Sieg"


def test_freilos_ist_kein_sieg():
    bye = {"status": "completed", "slots": [{"registration_id": "a"}, {"registration_id": None}],
           "results": [{"registration_id": "a", "rank": 1, "note": "Freilos", "reported_by": "system"}]}
    assert match_winner_id(bye) is None
    # Auch wo ein älterer Stand oder der Turnierbaum den Freilos-Sieger ausdrücklich nennt.
    assert match_winner_id({**bye, "results": [{**bye["results"][0], "outcome": "winner"}]}) is None
    assert match_winner_id({"status": "completed", "winner_id": "a", "slots": [{"registration_id": "a"}], "results": []}) is None
    assert match_winner_id({"status": "completed", "winner_id": "a", "slots": [], "results": []}) is None


def test_duell_heisst_genau_zwei_seiten():
    assert is_duel(duel({"rank": 1}, {"rank": 2}))
    assert not is_duel({"slots": [{"registration_id": reg} for reg in "abc"], "results": []})
    assert not is_duel({"slots": [{"registration_id": "a"}, {"registration_id": None}], "results": []})


def test_ohne_ergebnis_kein_sieger():
    assert match_winner_id({"status": "completed", "results": []}) is None
    assert match_winner_id({}) is None
    assert not won_by({}, {"a"})
