"""Wer hat gewonnen (#1796): eine Regel für alle Sieg-Erfolge - egal, auf welchem Weg das Ergebnis kam.

Eingetragene Ergebnisse (Leitung, Helfer, Spielermeldung, Wertung) speichern in ``matches_v2.results`` nur den Platz,
kein ``outcome``. Ältere Daten und der Turnierbaum kennen ``outcome``, die alte Engine ``winner_id``."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.competition_standings import TERMINAL_MATCH_STATUSES  # noqa: E402
from services.match_winner import DECIDED_STATUSES, is_bye, is_duel, is_real_match, lost_by, match_winner_id, no_show_ids, won_by  # noqa: E402


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


# ---------------------------------------------------------------- Was als Spiel zählt (#2337)

BYE = {"status": "completed", "slots": [{"registration_id": "a"}, {"registration_id": None, "status": "bye"}],
       "results": [{"registration_id": "a", "rank": 1}], "result_meta": {"source": "auto_bye"}}


def test_freilos_ist_kein_spiel():
    assert not is_real_match(BYE)
    # Zwei Plätze belegt, aber nur ein einziges Ergebnis: auch das ist kein Spiel gegen einen Gegner.
    lonely = {"status": "completed", "slots": [{"registration_id": "a"}, {"registration_id": "b"}], "results": [{"registration_id": "a", "rank": 1}]}
    assert not is_real_match(lonely)
    assert not lost_by(BYE, {"b"}) and not won_by(BYE, {"a"})


def test_eine_freilos_definition_fuer_rangliste_podest_und_erfolge():
    """#2336 und #2337 teilen sich ``is_bye``: Was die Rangliste nicht als Spiel zeigt, zählt auch für keinen Erfolg."""
    from services import competition_standings, match_winner

    assert competition_standings.is_bye is match_winner.is_bye
    assert is_bye(BYE) and not is_real_match(BYE)
    # Nach Ausschluss oder Rückzug ist der Platz geräumt: ein Freilos, auch wenn ein altes Ergebnis beide noch nennt.
    vacated = {"status": "completed", "slots": [{"registration_id": "a"}, {"registration_id": None}],
               "results": [{"registration_id": "a", "rank": 1}, {"registration_id": "b", "rank": 2}]}
    assert is_bye(vacated) and not is_real_match(vacated) and match_winner_id(vacated) is None
    # Älterer Bestand ohne Plätze ist kein Freilos - dort zählen die Seiten aus dem Ergebnis.
    old = {"status": "completed", "results": [{"registration_id": "a", "rank": 1}, {"registration_id": "b", "rank": 2}]}
    assert not is_bye(old) and is_real_match(old) and match_winner_id(old) == "a"
    assert not is_bye(duel({"rank": 1}, {"rank": 2, "forfeit": True}, status="forfeit")), "Nichtantreten mit zwei Anmeldungen ist kein Freilos"


def test_gespielt_heisst_abgeschlossen_oder_kampflos_gewertet():
    assert DECIDED_STATUSES == TERMINAL_MATCH_STATUSES, "eine Liste entschiedener Stände - hier und in der Rangliste"
    assert is_real_match(duel({"rank": 1}, {"rank": 2}))
    assert is_real_match(duel({"rank": 1}, {"rank": 2, "forfeit": True}, status="forfeit"))
    for status in ("pending", "running", "waiting_result", "disputed", "cancelled"):
        assert not is_real_match(duel({"rank": 1}, {"rank": 2}, status=status)), status
    # Ältere Spiele nennen nur den Sieger - sie bleiben Spiele.
    assert is_real_match({"status": "completed", "winner_id": "b", "slots": [{"registration_id": "a"}, {"registration_id": "b"}], "results": []})


def test_kampflos_gewinnt_der_sieger_und_der_fehlende_bekommt_nichts():
    walkover = duel({"rank": 1}, {"rank": 2, "forfeit": True}, status="forfeit", forfeit_registration_id="b")
    assert won_by(walkover, {"a"}) and lost_by(walkover, {"b"})
    assert no_show_ids(walkover) == {"b"}
    # Der Turnierbaum schreibt die Aufgabe als ``outcome``; in der Liga können beide fehlen.
    assert no_show_ids(duel({"outcome": "winner", "rank": 1}, {"outcome": "forfeit", "rank": 2})) == {"b"}
    both = duel({"rank": 2, "forfeit": True}, {"rank": 2, "forfeit": True}, status="forfeit", double_forfeit=True)
    assert no_show_ids(both) == {"a", "b"} and match_winner_id(both) is None
    assert no_show_ids(duel({"rank": 1}, {"rank": 2})) == set()


def test_niederlage_nur_gegen_einen_anderen_sieger():
    assert lost_by(duel({"rank": 1}, {"rank": 2}), {"b"}) and not lost_by(duel({"rank": 1}, {"rank": 2}), {"a"})
    assert not lost_by(duel({"rank": 1}, {"rank": 1}), {"a"}), "ein Unentschieden ist keine Niederlage"
    assert not lost_by({"status": "completed", "results": []}, {"a"})
