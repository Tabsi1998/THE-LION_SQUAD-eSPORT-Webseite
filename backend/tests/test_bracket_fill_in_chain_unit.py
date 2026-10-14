"""Nachrücker auf einen Freilos-Platz, wenn das Freilos schon über mehrere Runden weitergereicht ist (#1551, Codex-Prüfung
zu #1574). Mit der Freilos-Kette aus #1549 trägt jeder Zielplatz seine Herkunft (``source_result``); das Öffnen des
Freiloses setzt die ganze Kette über die Korrektur-Kaskade zurück - Plätze, Ergebnisse, Metadaten, Status.
"""
import copy
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.bracket_fill_in import free_bye_place, reopened_bye  # noqa: E402

NOW = "2026-10-31T17:00:00+00:00"
NEW = {"id": "late", "user_id": "u-late"}


def _bye_result(reg):
    return [{"registration_id": reg, "rank": 1, "note": "Auto-Advance durch Bye", "reported_by": "system"}]


def chain() -> list[dict]:
    """A: r1 gegen leeren Platz (Freilos) → C. B: ohne Teilnehmer (entfällt) → C. C: r1 kampflos weiter → E.
    D: r3 gegen r4 → E. E wartet auf D."""
    a = {"id": "A", "match_key": "A", "round": 1, "order": 1, "match_type": "duel", "status": "completed",
         "slots": [{"slot": 1, "registration_id": "r1", "status": "filled", "source": {"type": "seed", "seed": 1}},
                   {"slot": 2, "registration_id": None, "status": "bye", "source": {"type": "seed", "seed": 8}}],
         "results": _bye_result("r1"), "result_meta": {"source": "auto_bye"},
         "advancement": [{"flow": "W", "rank": 1, "to_match_id": "C", "to_slot": 1}]}
    b = {"id": "B", "match_key": "B", "round": 1, "order": 2, "match_type": "duel", "status": "cancelled",
         "slots": [{"slot": 1, "status": "bye", "source": {"type": "seed", "seed": 5}},
                   {"slot": 2, "status": "bye", "source": {"type": "seed", "seed": 6}}],
         "results": [], "result_meta": {"source": "auto_bye", "reason": "no_participants"},
         "advancement": [{"flow": "W", "rank": 1, "to_match_id": "C", "to_slot": 2}]}
    c = {"id": "C", "match_key": "C", "round": 2, "order": 1, "match_type": "duel", "status": "completed",
         "slots": [{"slot": 1, "registration_id": "r1", "status": "filled", "source_result": {"from_match_id": "A", "rank": 1}},
                   {"slot": 2, "registration_id": None, "status": "bye",
                    "source_result": {"from_match_id": "B", "rank": 1, "skipped": True, "reason": "bye"}}],
         "results": _bye_result("r1"), "result_meta": {"source": "auto_bye"}, "completed_at": NOW, "completed_by": "system",
         "advancement": [{"flow": "W", "rank": 1, "to_match_id": "E", "to_slot": 1}]}
    d = {"id": "D", "match_key": "D", "round": 2, "order": 2, "match_type": "duel", "status": "ready",
         "slots": [{"slot": 1, "registration_id": "r3", "status": "filled"}, {"slot": 2, "registration_id": "r4", "status": "filled"}],
         "results": [], "advancement": [{"flow": "W", "rank": 1, "to_match_id": "E", "to_slot": 2}]}
    e = {"id": "E", "match_key": "E", "round": 3, "order": 1, "match_type": "duel", "status": "pending",
         "slots": [{"slot": 1, "registration_id": "r1", "status": "filled", "source_result": {"from_match_id": "C", "rank": 1}},
                   {"slot": 2, "registration_id": None, "status": "pending"}],
         "results": [], "advancement": []}
    return [a, b, c, d, e]


def test_a_bye_passed_on_through_a_walkover_is_still_a_free_place():
    place = free_bye_place(chain())
    assert place and place["match"]["id"] == "A" and place["slot"] == 2


def test_opening_the_bye_resets_the_whole_chain():
    matches = chain()
    before = copy.deepcopy(matches)
    sets = reopened_bye(free_bye_place(matches), matches, NEW, NOW)
    assert matches == before, "die Rechnung verändert die gelesenen Spiele nicht"

    assert sets["A"]["status"] == "ready" and sets["A"]["results"] == [] and sets["A"]["result_meta"] is None
    assert [slot.get("registration_id") for slot in sets["A"]["slots"]] == ["r1", "late"]

    c_slots = {slot["slot"]: slot for slot in sets["C"]["slots"]}
    assert c_slots[1]["registration_id"] is None and c_slots[1]["status"] == "pending"
    assert c_slots[2]["status"] == "bye", "das Freilos aus dem leeren Spiel B bleibt"
    assert sets["C"]["results"] == [] and sets["C"]["result_meta"] is None and sets["C"]["completed_at"] is None
    assert sets["C"]["status"] == "pending"

    e_slots = {slot["slot"]: slot for slot in sets["E"]["slots"]}
    assert e_slots[1]["registration_id"] is None and sets["E"]["status"] == "pending"
    assert "D" not in sets, "unbeteiligte Spiele bleiben unberührt"


def test_no_free_place_once_the_first_real_match_down_the_chain_started():
    matches = chain()
    matches[4]["started_at"] = NOW
    assert free_bye_place(matches) is None
