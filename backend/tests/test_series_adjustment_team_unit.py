"""Fahrer-Anpassung auch in der Teamwertung (#2000) - ohne Datenbank, nur erfundene Namen.

- Haken ``counts_for_team`` an jeder Fahrer-Anpassung, Vorgabe je Saison ``team_scoring.adjustments_count_for_team``.
- ``per_race``: mit Haken zählt sie für das Team, für das der Fahrer im Termin gefahren ist (ohne Termin: die letzte
  Fahrt mit Team bis zum Tag); als Ersatz bzw. ohne Team für keines - mit Hinweis (``team_note``).
- ``current_lineup``: sie steckt in den Saisonpunkten des Fahrers - mit Haken bleibt sie drin, ohne wird sie für die
  Teamsumme herausgerechnet. Nie doppelt.
- Altdaten ohne Haken rechnen wie bisher: ``per_race`` ohne, ``current_lineup`` mit.
"""
import pytest

from services import series_adjustments
from services.scoring_rules import normalize_rules
from services.series_standings import compute_standings

SCHEME = [10, 6, 4, 3, 2, 1]
PEOPLE = [
    {"id": "anna", "name": "Anna Probe", "default_team": "Team Adler"},
    {"id": "bert", "name": "Bert Probe", "default_team": "Team Adler"},
    {"id": "carl", "name": "Carl Probe", "default_team": "Team Biber"},
    {"id": "dora", "name": "Dora Probe", "default_team": "Team Biber"},
]


def _rules(**team):
    return normalize_rules({"points_by_place": SCHEME, "tiebreakers": ["countback"],
                            "team_scoring": {"enabled": True, **team}})


def _round(number):
    return {"id": f"r{number}", "order": number, "status": "scored", "counts": True,
            "club_day": f"2026-03-{number:02d}"}


def _sheet(*rows, **extra):
    return {"rows": [{"participant_id": pid, "place": place, "team": team, "marks": []}
                     for place, (pid, team) in enumerate(rows, start=1)], **extra}


def _regular(**extra):
    """Anna 10, Carl 6, Bert 4, Dora 3 - Adler 14, Biber 9 je Rennen."""
    return _sheet(("anna", "Team Adler"), ("carl", "Team Biber"), ("bert", "Team Adler"), ("dora", "Team Biber"),
                  **extra)


def _minus_five(**extra):
    return {"id": "m1", "kind": "participant", "participant_id": "anna", "points": -5,
            "reason": "Nichtteilnahme nach Anmeldung", "day": "2026-03-02", "round_id": None, **extra}


def _scope(snapshots, scope, round_id=None):
    chosen = [snap for snap in snapshots
              if snap["scope"] == scope and (round_id is None or snap["round_id"] == round_id)]
    return {row.get("team") or row.get("participant_id"): row for row in chosen[-1]["rows"]}


def _run(rules, sheets, adjustments, rounds=None):
    rounds = rounds or [_round(number) for number in range(1, len(sheets) + 1)]
    return compute_standings(rules=rules, rounds=rounds, sheets=sheets, participants=PEOPLE, adjustments=adjustments)


# ---------------------------------------------------------------- Einstellung und Haken
def test_the_season_default_is_a_setting_and_off_by_default():
    assert normalize_rules({})["team_scoring"]["adjustments_count_for_team"] is False
    assert normalize_rules({"team_scoring": {"adjustments_count_for_team": True}})[
        "team_scoring"]["adjustments_count_for_team"] is True


def test_the_flag_is_stored_for_drivers_only_and_old_data_reads_by_mode():
    clean = series_adjustments.normalize({**_minus_five(), "counts_for_team": True})
    assert clean["counts_for_team"] is True
    team = series_adjustments.normalize({"kind": "team", "team": "Team Adler", "points": -2, "reason": "Korrektur",
                                         "day": "2026-03-02", "counts_for_team": True})
    assert team["counts_for_team"] is None
    legacy = _minus_five()
    assert series_adjustments.counts_for_team(legacy, _rules()) is False
    assert series_adjustments.counts_for_team(legacy, _rules(mode="current_lineup")) is True
    off = {**legacy, "counts_for_team": False}
    assert series_adjustments.counts_for_team(off, _rules(mode="current_lineup")) is False
    assert series_adjustments.counts_for_team({**legacy, "counts_for_team": True}, _rules()) is True
    assert series_adjustments.counts_for_team({**legacy, "counts_for_team": True}, normalize_rules({})) is False


# ---------------------------------------------------------------- je Rennen
def test_per_race_minus_five_with_and_without_the_flag():
    sheets = {"r1": _regular(), "r2": _regular()}
    without = _scope(_run(_rules(), sheets, [_minus_five(round_id="r2", counts_for_team=False)]), "teams")
    assert (without["Team Adler"]["points"], without["Team Adler"]["driver_adjustments"]) == (28, [])
    flagged = _run(_rules(), sheets, [_minus_five(round_id="r2", counts_for_team=True)])
    teams = _scope(flagged, "teams")
    assert (teams["Team Adler"]["points"], teams["Team Adler"]["driver_adjustment_points"]) == (23, -5)
    assert teams["Team Adler"]["adjustment_points"] == 0
    assert teams["Team Adler"]["driver_adjustments"] == [{
        "id": "m1", "points": -5, "reason": "Nichtteilnahme nach Anmeldung", "day": "2026-03-02", "round_id": "r2",
        "counts_for_team": True, "credited_team": "Team Adler", "participant_id": "anna"}]
    assert teams["Team Biber"]["points"] == 18
    # Die Fahrerwertung zählt die −5 genau einmal; das Detail sagt, dass sie auch fürs Team zählt.
    anna = _scope(flagged, "drivers")["anna"]
    assert anna["points"] == 15
    assert anna["adjustments"][0]["counts_for_team"] is True and anna["adjustments"][0]["credited_team"] == "Team Adler"


def test_per_race_the_team_of_the_round_counts_and_a_substitute_ride_counts_for_none():
    sheets = {"r1": _regular(),
              "r2": _sheet(("anna", "Team Biber"), ("carl", "Team Biber"), ("bert", "Team Adler"))}
    biber = _scope(_run(_rules(), sheets, [_minus_five(round_id="r2", counts_for_team=True)]), "teams")
    assert (biber["Team Adler"]["points"], biber["Team Biber"]["points"]) == (14 + 4, 9 + 16 - 5)

    sheets["r2"] = _sheet(("anna", "Ersatzfahrer"), ("carl", "Team Biber"), ("bert", "Team Adler"))
    snaps = _run(_rules(), sheets, [_minus_five(round_id="r2", counts_for_team=True)])
    teams = _scope(snaps, "teams")
    assert (teams["Team Adler"]["points"], teams["Team Biber"]["points"]) == (18, 15)
    assert all(not row["driver_adjustments"] for row in teams.values())
    note = _scope(snaps, "drivers")["anna"]["adjustments"][0]
    assert (note["counts_for_team"], note.get("credited_team"), note["team_note"]) == (True, None, "substitute")

    # Ohne Team in der Zeile: ebenso kein Team.
    sheets["r2"] = _sheet(("anna", None), ("carl", "Team Biber"), ("bert", "Team Adler"))
    note = _scope(_run(_rules(), sheets, [_minus_five(round_id="r2", counts_for_team=True)]), "drivers")["anna"]
    assert note["adjustments"][0]["team_note"] == "no_team"


def test_per_race_without_a_round_the_last_team_ride_up_to_the_day_counts():
    """Ohne Termin: die letzte Fahrt mit Team bis zum Tag - eine Ersatzfahrt davor überspringt sie, eine Fahrt danach
    (Teamwechsel nach der Anpassung) ändert nichts."""
    sheets = {"r1": _regular(),
              "r2": _sheet(("anna", "Ersatzfahrer"), ("carl", "Team Biber"), ("bert", "Team Adler")),
              "r3": _sheet(("anna", "Team Biber"), ("carl", "Team Biber"), ("bert", "Team Adler"))}
    snaps = _run(_rules(), sheets, [_minus_five(day="2026-03-02", counts_for_team=True)])
    after_change = _scope(snaps, "teams", "r3")
    assert after_change["Team Adler"]["driver_adjustment_points"] == -5
    assert after_change["Team Biber"]["driver_adjustment_points"] == 0
    assert after_change["Team Adler"]["points"] == 14 + 4 + 4 - 5
    # Vor jeder Fahrt mit Team: für keines.
    early = _run(_rules(), sheets, [_minus_five(day="2026-02-01", counts_for_team=True)])
    assert _scope(early, "drivers")["anna"]["adjustments"][0]["team_note"] == "no_ride"
    assert all(not row["driver_adjustments"] for row in _scope(early, "teams").values())


def test_per_race_a_guest_counts_only_when_guests_count():
    people = [{**person, "link": "guest"} if person["id"] == "anna" else person for person in PEOPLE]
    sheets = {"r1": _regular()}
    snaps = compute_standings(rules=_rules(guests_count=False), rounds=[_round(1)], sheets=sheets, participants=people,
                              adjustments=[_minus_five(round_id="r1", counts_for_team=True)])
    assert _scope(snaps, "teams")["Team Adler"]["points"] == 4
    assert _scope(snaps, "drivers")["anna"]["adjustments"][0]["team_note"] == "guest"


# ---------------------------------------------------------------- aktuelle Besetzung
def test_current_lineup_never_counts_twice_and_takes_it_out_without_the_flag():
    sheets = {"r1": _regular(), "r2": _regular()}
    lineup = _rules(mode="current_lineup")
    flagged = _scope(_run(lineup, sheets, [_minus_five(counts_for_team=True)]), "teams")
    # Anna 20 − 5 + Bert 8: die −5 stecken schon in Annas Saisonpunkten - nicht noch einmal abgezogen.
    assert flagged["Team Adler"]["points"] == 23
    assert flagged["Team Adler"]["driver_adjustment_points"] == -5
    assert flagged["Team Adler"]["driver_adjustments"][0]["participant_id"] == "anna"
    without = _scope(_run(lineup, sheets, [_minus_five(counts_for_team=False)]), "teams")
    # Ohne Haken herausgerechnet: Anna 20 + Bert 8.
    assert (without["Team Adler"]["points"], without["Team Adler"]["driver_adjustments"]) == (28, [])


def test_current_lineup_the_adjustment_follows_the_driver_into_the_new_team():
    sheets = {"r1": _regular(), "r2": _regular(),
              "r3": _sheet(("anna", "Team Biber"), ("carl", "Team Biber"), ("bert", "Team Adler"))}
    snaps = _run(_rules(mode="current_lineup"), sheets, [_minus_five(counts_for_team=True)])
    teams = _scope(snaps, "teams", "r3")
    # Anna (30 − 5) gehört jetzt zu Biber (mit Carl 18 und Dora 6), samt Abzug; Adler nur noch Bert (12).
    assert (teams["Team Biber"]["points"], teams["Team Adler"]["points"]) == (25 + 18 + 6, 12)
    assert teams["Team Biber"]["driver_adjustment_points"] == -5
    assert _scope(snaps, "drivers")["anna"]["adjustments"][0]["credited_team"] == "Team Biber"


# ---------------------------------------------------------------- Altdaten und offizielle Teamwertung
@pytest.mark.parametrize("mode, adler", [("per_race", 28), ("current_lineup", 23)])
def test_old_adjustments_without_the_flag_keep_their_totals(mode, adler):
    """So rechneten beide Modi vor #2000: je Rennen ohne die −5, aktuelle Besetzung mit."""
    sheets = {"r1": _regular(), "r2": _regular()}
    teams = _scope(_run(_rules(mode=mode), sheets, [_minus_five()]), "teams")
    assert (teams["Team Adler"]["points"], teams["Team Biber"]["points"]) == (adler, 18)


def test_the_official_team_standings_still_lead_and_the_check_sees_the_adjustment():
    sheets = {"r1": _regular(), "r2": _regular(official_team_totals={"Team Adler": 23, "Team Biber": 18})}
    teams = _scope(_run(_rules(), sheets, [_minus_five(round_id="r2", counts_for_team=True)]), "teams")
    assert (teams["Team Adler"]["points"], teams["Team Adler"]["computed_points"],
            teams["Team Adler"]["deviation"]) == (23, 23, 0)
    sheets["r2"]["official_team_totals"] = {"Team Adler": 30}
    teams = _scope(_run(_rules(), sheets, [_minus_five(round_id="r2", counts_for_team=True)]), "teams")
    assert (teams["Team Adler"]["points"], teams["Team Adler"]["deviation"]) == (30, 7)


def test_without_team_scoring_the_flag_changes_nothing():
    rules = normalize_rules({"points_by_place": SCHEME, "tiebreakers": ["countback"]})
    snaps = _run(rules, {"r1": _regular()}, [_minus_five(round_id="r1", counts_for_team=True)])
    assert not [snap for snap in snaps if snap["scope"] == "teams"]
    assert "counts_for_team" not in _scope(snaps, "drivers")["anna"]["adjustments"][0]
