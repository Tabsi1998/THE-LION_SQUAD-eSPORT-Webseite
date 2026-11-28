"""Ein Baustein für Abstimmungen (#2612): Antworten und Ergebnis in derselben Form für Versammlungen und Events.

Die Versammlungen (#327) holen ihr Ergebnis aus der Vereinsakte, die Abstimmungen am Event zählen selbst. Beide geben
dieselbe Form an Web und App weiter (``services/ballot_views.py``). Der erste Test hält die Form der Versammlungen fest,
damit der Umbau ihr Verhalten nicht ändert.
"""
from services import ballot_views, dolibarr_meetings

OPTIONS = [{"code": "yes", "label": "Ja"}, {"code": "no", "label": "Nein"}, {"code": "abstain", "label": "Enthaltung"}]


def test_meeting_result_keeps_its_exact_shape():
    labels = {option["code"]: option["label"] for option in OPTIONS}
    result = {"revision": 2, "outcome": "passed", "passed": True, "valid": 44, "abstain": 2,
              "counts": {"yes": 41, "no": 3, "abstain": 2}, "winner": "yes"}
    assert dolibarr_meetings._result_view(result, OPTIONS, labels) == {
        "revision": 2, "outcome": "passed", "outcome_label": "angenommen", "passed": True, "valid": 44, "abstain": 2,
        "counts": [{"code": "yes", "label": "Ja", "count": 41}, {"code": "no", "label": "Nein", "count": 3},
                   {"code": "abstain", "label": "Enthaltung", "count": 2}],
        "winner": "yes", "winner_label": "Ja",
    }
    assert dolibarr_meetings._result_view(None, OPTIONS, labels) is None
    # Unvollständige Antworten bleiben ruhig: fehlende Zahlen sind 0, unbekannte Ergebnisse stehen roh da.
    sparse = dolibarr_meetings._result_view({"outcome": "neu", "counts": "kaputt"}, OPTIONS, labels)
    assert sparse["outcome_label"] == "neu" and [row["count"] for row in sparse["counts"]] == [0, 0, 0]
    assert sparse["winner"] == "" and sparse["winner_label"] == ""


def test_options_view_keeps_only_real_options():
    raw = [{"code": "a", "label": "Rodelbahn A"}, None, "x", {"code": 7, "label": 8}]
    assert ballot_views.options_view(raw) == [{"code": "a", "label": "Rodelbahn A"}, {"code": "7", "label": "8"}]
    assert ballot_views.options_view("kaputt") == []


def test_tally_counts_each_choice_and_names_a_clear_winner():
    options = [{"code": "a", "label": "Garage"}, {"code": "b", "label": "Garten"}]
    tally = ballot_views.tally([["a"], ["b"], ["a"], ["a", "b"]], options)
    assert tally["counts"] == {"a": 3, "b": 2}
    assert tally["valid"] == 4 and tally["winner"] == "a" and tally["outcome"] == "winner"
    view = ballot_views.result_view(counts=tally["counts"], options=options, outcome=tally["outcome"],
                                    outcome_label="Mehrheit", valid=tally["valid"], winner=tally["winner"])
    assert view["counts"] == [{"code": "a", "label": "Garage", "count": 3}, {"code": "b", "label": "Garten", "count": 2}]
    assert view["winner_label"] == "Garage" and view["valid"] == 4 and view["passed"] is False


def test_tally_without_votes_or_with_a_tie_has_no_winner():
    options = [{"code": "a", "label": "Garage"}, {"code": "b", "label": "Garten"}]
    assert ballot_views.tally([], options) == {"counts": {"a": 0, "b": 0}, "valid": 0, "winner": "", "outcome": "none"}
    tie = ballot_views.tally([["a"], ["b"]], options)
    assert tie["winner"] == "" and tie["outcome"] == "tie"
    # Unbekannte Antworten (etwa eine gelöschte Option) zählen nicht mit.
    assert ballot_views.tally([["z"], ["a"]], options)["counts"] == {"a": 1, "b": 0}
