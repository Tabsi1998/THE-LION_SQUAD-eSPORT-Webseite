"""Fälle der Turnierleitung nennen die Runde wie der Baum (#1860).

Im Läufe-Cup (Winner und Loser Bracket) heißt der Lauf LA im Baum „Loser Runde 1 · Durchgang LA“ - auch wenn die
Turnierleitung ihn nach der Uhr „Runde 2“ genannt hat. Der Fall „Nicht erschienen?“ sagte bisher nur „Runde 2“.
"""
import pathlib
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.match_attention import attention_items  # noqa: E402

NOW = datetime(2026, 10, 20, 19, 30, tzinfo=timezone.utc)
STAGE = {"id": "s1", "stage_type": "ffa_custom_bracket"}


def heat(key: str, round_number: int, section: str, *, names=(), **extra) -> dict:
    slots = [{"slot": index + 1, "registration_id": name} for index, name in enumerate(names)]
    slots += [{"slot": len(slots) + index + 1} for index in range(4 - len(slots))]
    return {"id": key, "match_key": key, "stage_id": "s1", "round": round_number, "round_name": f"Runde {round_number}",
            "section": section, "match_type": "ffa", "status": "completed", "slots": slots, **extra}


def cup(**la) -> list[dict]:
    return [
        heat("A", 1, "main", names=("a1", "a2", "a3", "a4")),
        heat("B", 1, "main", names=("b1", "b2", "b3", "b4")),
        heat("E", 2, "main", names=("a1", "a2", "b1", "b2"), status="ready"),
        heat("LA", 2, "loser", names=("a3", "a4", "b3"), status="ready", **la),
        heat("G", 3, "main"),
        heat("LC", 3, "loser"),
    ]


def regs(matches) -> dict:
    return {slot["registration_id"]: {"id": slot["registration_id"], "display_name": slot["registration_id"].upper()}
            for match in matches for slot in match["slots"] if slot.get("registration_id")}


def test_no_show_in_a_loser_heat_names_side_round_and_heat():
    matches = cup(no_show_proposal={"due_at": "2026-10-20T19:20:00+00:00", "rule": "called", "minutes": 3})

    items = attention_items({"id": "t1", "format": "ffa_custom_bracket"}, matches, [], regs(matches), NOW,
                            stages={"s1": STAGE})

    case = next(item for item in items if item["kind"] == "no_show")
    assert case["label"] == "Loser Runde 1 · Durchgang LA"


def test_a_winner_heat_says_winner_round():
    matches = cup()
    matches[2]["status"] = "disputed"

    items = attention_items({"id": "t1", "format": "ffa_custom_bracket"}, matches, [], regs(matches), NOW,
                            stages={"s1": STAGE})

    assert next(item for item in items if item["kind"] == "dispute")["label"] == "Winner Runde 2 · Durchgang E"


def test_a_duel_keeps_its_round_name_and_names():
    matches = [
        {"id": "m1", "match_key": "A", "stage_id": "s2", "round": 1, "round_name": "Runde 1", "section": "main",
         "status": "disputed", "slots": [{"slot": 1, "registration_id": "x"}, {"slot": 2, "registration_id": "y"}]},
        {"id": "m2", "match_key": "B", "stage_id": "s2", "round": 2, "round_name": "Runde 2", "section": "main",
         "status": "pending", "slots": [{"slot": 1}, {"slot": 2}]},
    ]

    items = attention_items({"id": "t1", "format": "single_elim"}, matches, [], regs(matches), NOW,
                            stages={"s2": {"id": "s2", "stage_type": "single_elimination"}})

    assert [(item["label"], item["names"]) for item in items] == [("Halbfinale", "X gegen Y")]
