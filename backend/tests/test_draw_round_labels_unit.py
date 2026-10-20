"""Auslosung im Doppel-K.-o. (#1829): die Karte der Turnierleitung nennt die Zielrunde wie der Baum - „Winner Runde 2“
und „Loser Runde 1“ statt beides „Runde 2“."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.draw_show import lead_cards  # noqa: E402
from services.round_labels import rounds_by_section, side_round_label  # noqa: E402

SINCE = "2026-10-19T21:00:00+00:00"


def heat(mid: str, key: str, section: str, round_no: int, *, group: str | None = None, to: list[str] = ()) -> dict:
    row = {"id": mid, "match_key": key, "stage_id": "s", "section": section, "round": round_no,
           "round_name": f"Runde {round_no}", "match_type": "ffa", "status": "completed" if not group else "pending",
           "slots": [], "advancement": [{"to_match_id": target, "flow": "W"} for target in to]}
    if group:
        row["settings"] = {"draw_group": group}
        row["draw_ready"] = {"group": group, "since": SINCE}
    return row


def cup() -> list[dict]:
    return [
        heat("a", "A", "WB", 1, to=["c", "d", "la", "lb"]),
        heat("b", "B", "WB", 1, to=["c", "d", "la", "lb"]),
        heat("c", "C", "WB", 2, group="WB:2"),
        heat("d", "D", "WB", 2, group="WB:2"),
        heat("la", "LA", "LB", 2, group="LB:2"),
        heat("lb", "LB", "LB", 2, group="LB:2"),
        heat("e", "E", "WB", 3),
    ]


def test_lead_cards_name_the_target_round_like_the_tree():
    matches = cup()
    stages = {"s": {"id": "s", "name": "Läufe", "stage_type": "ffa_custom_bracket"}}
    cards = {card["group"]: card for card in lead_cards(matches, {"format": "ffa"}, stages, {}, can_draw=True)}
    assert cards["WB:2"]["round_label"] == "Winner Runde 2"
    assert cards["LB:2"]["round_label"] == "Loser Runde 1"


def test_without_loser_bracket_the_round_keeps_its_name():
    matches = [row for row in cup() if row["section"] == "WB"]
    rounds = rounds_by_section(matches)
    assert side_round_label(matches[-1], matches, rounds=rounds, kind="heats") == "Finale"
    assert side_round_label(matches[0], matches, rounds=rounds, kind="heats") == "Runde 1"
    assert side_round_label(cup()[0], cup(), rounds=rounds, kind="heats") == "Winner Runde 1"
