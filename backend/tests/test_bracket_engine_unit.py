import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from bracket_engine import generate_bracket, generate_single_elimination


def test_legacy_preview_bracket_uses_seed_placeholders():
    tournament = {
        "id": "t1",
        "format": "single_elim",
        "best_of": 1,
        "bronze_match": False,
        "seeding_mode": "manual",
        "match_duration_minutes": 12,
    }
    registrations = [
        {"id": f"preview-seed-{seed}", "status": "approved", "seed": seed}
        for seed in range(1, 9)
    ]

    matches = generate_bracket(tournament, registrations, preview=True)

    assert len(matches) == 7
    assert {match["status"] for match in matches} == {"preview"}
    assert all(match["is_preview"] for match in matches)
    assert all(match["duration_minutes"] == 12 for match in matches)
    assert matches[0]["participant_a_id"].startswith("preview-seed-")


def test_single_elimination_bronze_match_receives_semifinal_losers():
    registrations = [
        {"id": f"r{i}", "status": "approved", "seed": i}
        for i in range(1, 5)
    ]

    matches = generate_single_elimination("t1", registrations, bronze_match=True, seeding_mode="manual")
    bronze = next(match for match in matches if match["bracket"] == "bronze")
    semifinals = [match for match in matches if match["round_name"] == "Halbfinale"]

    assert len(matches) == 4
    assert {match["next_loser_match_id"] for match in semifinals} == {bronze["id"]}
    assert {match["next_loser_slot"] for match in semifinals} == {"a", "b"}
