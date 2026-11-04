"""Termin-Revision (Codex zu D.3, #1618): Check-ins und Veto binden an Termin und Revision - reine Rechnung ohne Datenbank.
Erfundene Werte."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import checkin_rules, league_veto_rules  # noqa: E402

AT = "2026-11-15T19:00:00+00:00"
HOME, AWAY = "reg-heim", "reg-gast"


def staffel(**fields) -> dict:
    return {"id": "t1", "league_context": {"league_id": "l", "season_id": "s", "staffel": "A"}, "format": "league", "status": "live",
            "checkin_rules": dict(checkin_rules.DEFAULTS), **fields}


def match(rev=None, entry_rev=None, **fields) -> dict:
    flow = {"checkin": {side: {"at": AT, "present": ["a", "b", "c"], "via": "side", "for_at": AT,
                               **({"rev": entry_rev} if entry_rev is not None else {})} for side in (HOME, AWAY)}}
    if rev is not None:
        flow["schedule_rev"] = rev
    return {"id": "m1", "tournament_id": "t1", "status": "scheduled", "scheduled_at": AT,
            "slots": [{"slot": 1, "registration_id": HOME}, {"slot": 2, "registration_id": AWAY}], "flow": flow, **fields}


def test_checkins_count_only_for_the_current_revision_and_old_entries_count_as_zero():
    assert checkin_rules.schedule_rev(match()) == 0 and checkin_rules.schedule_rev({}) == 0
    assert set(checkin_rules.checkins(match())) == {HOME, AWAY}, "Altbestand ohne Revision zählt wie 0"
    assert set(checkin_rules.checkins(match(rev=0, entry_rev=0))) == {HOME, AWAY}
    assert checkin_rules.checkins(match(rev=1)) == {}, "Termin A → B → A: alte Einträge ohne Revision zählen nicht mehr"
    assert checkin_rules.checkins(match(rev=2, entry_rev=1)) == {}
    assert set(checkin_rules.checkins(match(rev=2, entry_rev=2))) == {HOME, AWAY}
    assert checkin_rules.missing_sides(match(rev=1)) == [HOME, AWAY]


def test_the_veto_counts_only_for_time_and_revision():
    running = {"status": "running", "for_at": AT}
    assert league_veto_rules.veto_of({"scheduled_at": AT, "flow": {"veto": running}}) is running, "Altbestand: Revision 0"
    assert league_veto_rules.veto_of({"scheduled_at": AT, "flow": {"veto": {**running, "rev": 0}, "schedule_rev": 0}}) is not None
    assert league_veto_rules.veto_of({"scheduled_at": AT, "flow": {"veto": running, "schedule_rev": 1}}) is None
    assert league_veto_rules.veto_of({"scheduled_at": AT, "flow": {"veto": {**running, "rev": 1}, "schedule_rev": 1}}) is not None
    assert league_veto_rules.veto_of({"scheduled_at": AT, "flow": {"veto": {**running, "rev": 1}, "schedule_rev": 2}}) is None


def test_every_way_to_a_new_time_unsets_the_extension_and_raises_the_revision():
    change = checkin_rules.new_time_change(staffel(), {"$set": {"scheduled_at": AT}, "$unset": {"schedule_deadline_at": ""}})
    assert change == {"$set": {"scheduled_at": AT}, "$unset": {"schedule_deadline_at": "", "no_show_extended_until": ""},
                      "$inc": {"flow.schedule_rev": 1}}
    assert checkin_rules.new_time_inc(staffel()) == {"flow.schedule_rev": 1}
    # Ohne Check-in-Regeln oder ohne Liga bleibt alles, wie es ist - auch ein leeres $inc gibt es nicht.
    plain = {"$set": {"scheduled_at": AT}}
    assert checkin_rules.new_time_change({"id": "t"}, plain) == plain and "$inc" not in checkin_rules.new_time_change(staffel(checkin_rules=None), plain)
    assert checkin_rules.new_time_inc({"id": "t"}) == {}
    assert checkin_rules.new_time_change(staffel(), None) == {"$unset": {"no_show_extended_until": ""}, "$inc": {"flow.schedule_rev": 1}}


def test_undoing_the_revision_restores_exactly_the_state_before():
    """Rollback an einer gelöschten Station: Zähler herunter, ein neues Feld weg - und fehlte ``flow`` ganz (Altbestand), fällt ``flow``
    selbst weg statt eines leeren ``flow: {}``, ohne Pfadkonflikt mit anderen ``flow.*``-Einträgen."""
    from services.match_planning import undo_revision

    change = {"$inc": {"flow.schedule_rev": 1}}
    assert undo_revision({"flow": {"schedule_rev": 2}}, change, {}) == {"$inc": {"flow.schedule_rev": -1}}
    assert undo_revision({"flow": {"checkin": {}}}, change, {}) == {"$unset": {"flow.schedule_rev": ""}}
    rollback = {"$set": {"scheduled_at": AT}, "$unset": {"flow.checkin": "", "no_show_extended_until": ""}}
    assert undo_revision({"scheduled_at": AT}, change, rollback) == {"$set": {"scheduled_at": AT},
                                                                     "$unset": {"no_show_extended_until": "", "flow": ""}}
