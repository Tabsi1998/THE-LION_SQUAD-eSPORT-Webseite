"""Übernahme von der Partner-Plattform (#1964) ohne Datenbank: Turnier → Termin (verknüpft, gleicher Tag oder neu),
Abweichungen zu einem vorhandenen Blatt, was der Verein von Hand ergänzt hat (Sonderboni, Notiz) und der Fingerabdruck
eines Turniertags. Nur erfundene Namen."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import partner_import  # noqa: E402

KEY = "tft_dashboard"


def _day(ref, club_day):
    return {"ref": ref, "club_day": club_day, "name": f"Turnier {ref}"}


def _round(rid, club_day, order, **extra):
    return {"id": rid, "club_day": club_day, "order": order, "status": "planned", "archived_at": None, **extra}


def test_a_linked_round_wins_then_the_same_day_then_a_new_round():
    days = [_day("901", "2026-09-25"), _day("902", "2026-10-16"), _day("903", "2026-12-11")]
    rounds = [_round("r1", "2026-10-16", 1), _round("r2", "2026-09-01", 2, partner_ref={"platform": KEY, "ref": "901"}),
              _round("r3", "2026-12-11", 3, status="cancelled")]
    found = partner_import.round_matches(days, rounds, KEY)
    assert {ref: (item["action"], (item["round"] or {}).get("id")) for ref, item in found.items()} == {
        "901": ("linked", "r2"), "902": ("assign", "r1"), "903": ("new", None)}


def test_a_round_is_used_once_and_never_taken_from_another_platform_link_or_archive():
    days = [_day("901", "2026-09-25"), _day("902", "2026-09-25")]
    rounds = [_round("r1", "2026-09-25", 1), _round("r2", "2026-09-25", 2, partner_ref={"platform": KEY, "ref": "77"}),
              _round("r3", "2026-09-25", 3, archived_at="2026-10-01T00:00:00+00:00")]
    found = partner_import.round_matches(days, rounds, KEY)
    assert (found["901"]["action"], found["901"]["round"]["id"]) == ("assign", "r1")
    assert (found["902"]["action"], found["902"]["round"]) == ("new", None)


def _row(pid, place, day, **extra):
    return {"participant_id": pid, "place": place, "points": None, "points_source": "scheme", "marks": [],
            "penalty_points": 0, "note": None, "day_points": day,
            "day_rounds": [{"place": place, "points": day, "lobby": "1"}], **extra}


def test_without_a_sheet_everything_is_new_and_the_same_content_is_unchanged():
    content = {"rows": [_row("p-a", 1, 8)], "double_up": False}
    assert partner_import.sheet_diff(None, content, {}) == {"state": "new", "changes": []}
    assert partner_import.sheet_diff(content, content, {}) == {"state": "same", "changes": []}


def test_differences_name_added_removed_and_changed_fields():
    old = {"rows": [_row("p-a", 1, 8), _row("p-b", 2, 7), _row("p-c", 3, 6)]}
    new = {"rows": [_row("p-b", 1, 8), _row("p-a", 2, 7, marks=["left"]), _row("neu:dario", 3, 6)],
           "double_up": True}
    names = {"p-a": "Ada Ausgedacht", "p-b": "Bruno Beispiel", "p-c": "Cleo Muster", "neu:dario": "Dario Demo#1234"}
    diff = partner_import.sheet_diff(old, new, names)
    assert diff["state"] == "changed"
    # In der Reihenfolge der neuen Liste, Entfallene danach, Angaben zum ganzen Blatt zuletzt.
    assert diff["changes"] == [
        {"participant_id": "p-b", "name": "Bruno Beispiel", "kind": "changed", "fields": {
            "place": [2, 1], "day_points": [7, 8], "day_rounds": [[{"place": 2, "points": 7, "lobby": "1"}],
                                                                  [{"place": 1, "points": 8, "lobby": "1"}]]}},
        {"participant_id": "p-a", "name": "Ada Ausgedacht", "kind": "changed", "fields": {
            "place": [1, 2], "day_points": [8, 7], "day_rounds": [[{"place": 1, "points": 8, "lobby": "1"}],
                                                                  [{"place": 2, "points": 7, "lobby": "1"}]],
            "marks": [[], ["left"]]}},
        {"participant_id": "neu:dario", "name": "Dario Demo#1234", "kind": "added", "fields": {}},
        {"participant_id": "p-c", "name": "Cleo Muster", "kind": "removed", "fields": {}},
        {"participant_id": None, "name": "", "kind": "sheet", "fields": {"double_up": [False, True]}},
    ]


def test_what_the_club_added_by_hand_is_kept_and_not_counted_as_a_difference():
    old = {"rows": [_row("p-a", 1, 8, bonus_keys=["bingo"], note="Bingo im Stream", penalty_points=2,
                         points=40, points_source="manual")], "note": "Von Hand nachgetragen"}
    new = {"rows": [_row("p-a", 1, 8), _row("p-b", 2, 7)], "note": None}
    kept = partner_import.carry_over(new, old)
    assert kept["rows"][0] == {**_row("p-a", 1, 8), "bonus_keys": ["bingo"], "note": "Bingo im Stream",
                               "penalty_points": 2, "points": 40, "points_source": "manual"}
    assert kept["rows"][1] == _row("p-b", 2, 7) and kept["note"] == "Von Hand nachgetragen"
    assert partner_import.sheet_diff(old, kept, {})["changes"] == [
        {"participant_id": "p-b", "name": "", "kind": "added", "fields": {}}]
    assert new["rows"][0].get("bonus_keys") is None  # das Original bleibt unberührt


def test_a_new_round_gets_the_next_free_code_like_t1_t2():
    """Ein neuer Termin bekommt ein Kürzel wie „T3“ - sonst hieße er nur „Termin 3“. Gezählt wird ab dem höchsten
    „T<Zahl>“ der Saison, archivierte zählen mit; ohne solche Kürzel nach der Zahl der Termine."""
    assert partner_import.next_code([]) == "T1"
    assert partner_import.next_code([{"code": "T1"}, {"code": "t4", "archived_at": "x"}, {"code": "Finale"}]) == "T5"
    assert partner_import.next_code([{"code": "R1"}, {"code": None}]) == "T3"
    assert partner_import.next_code([{"code": "T2"}], taken={"T3"}) == "T4"


def test_the_fingerprint_changes_with_the_content_only():
    day = {"ref": "901", "rows": [{"name": "Ada Ausgedacht#AAA", "place": 1}]}
    same = {"rows": [{"place": 1, "name": "Ada Ausgedacht#AAA"}], "ref": "901"}
    other = {"ref": "901", "rows": [{"name": "Ada Ausgedacht#AAA", "place": 2}]}
    assert partner_import.fingerprint(day) == partner_import.fingerprint(same)
    assert partner_import.fingerprint(day) != partner_import.fingerprint(other)
    assert len(partner_import.fingerprint(day)) == 16
