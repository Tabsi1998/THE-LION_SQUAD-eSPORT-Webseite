"""Wie der Platz im Baum zustande kam (#2336): ``place_paths`` und Freilose in ``stage_standings``."""
from services.competition_standings import games_won_text, place_paths, public_standings, stage_standings

SRC = {"engine": "stage"}
SE_STAGE = [{"id": "s1", "stage_type": "single_elimination", "name": "K.-o."}]
DONE = {"format": "single_elim", "status": "completed"}


def duel(mid, round_number, winner, loser, *, section="main", round_name=None, stage_id="s1"):
    return {"id": mid, "stage_id": stage_id, "stage_number": 1, "round": round_number, "section": section,
            "round_name": round_name, "status": "completed", "source": SRC,
            "slots": [{"registration_id": winner}, {"registration_id": loser}],
            "results": [{"registration_id": winner, "rank": 1}, {"registration_id": loser, "rank": 2}]}


def bye(mid, round_number, player, stage_id="s1"):
    return {"id": mid, "stage_id": stage_id, "stage_number": 1, "round": round_number, "section": "main",
            "status": "completed", "source": SRC, "result_meta": {"source": "auto_bye"},
            "slots": [{"registration_id": player}, {"status": "bye"}], "results": [{"registration_id": player, "rank": 1}]}


def se_with_bronze():
    return [duel("h1", 1, "a", "c"), duel("h2", 1, "b", "d"), duel("f", 2, "a", "b"),
            duel("p3", 2, "c", "d", section="bronze")]


def test_single_elim_paths_name_final_and_bronze():
    assert place_paths(se_with_bronze(), SE_STAGE, DONE) == {
        "a": "Finale gewonnen", "b": "im Finale", "c": "Spiel um Platz 3 gewonnen", "d": "im Spiel um Platz 3"}


def test_without_bronze_the_semifinal_loser_is_out():
    matches = [duel("h1", 1, "a", "c"), duel("h2", 1, "b", "d"), duel("f", 2, "a", "b")]
    paths = place_paths(matches, SE_STAGE, DONE)
    assert paths["c"] == "im Halbfinale raus"
    assert paths["d"] == "im Halbfinale raus"


def test_generic_rounds_take_in_not_im():
    # Acht Runden vor dem Finale gibt es keinen Alltagsnamen mehr - „in Runde 1 raus“.
    matches = [duel(f"r1-{i}", 1, f"w{i}", f"l{i}") for i in range(16)]
    matches += [duel(f"r2-{i}", 2, f"w{i * 2}", f"w{i * 2 + 1}") for i in range(8)]
    matches += [duel(f"r3-{i}", 3, f"w{i * 4}", f"w{i * 4 + 2}") for i in range(4)]
    matches += [duel(f"r4-{i}", 4, f"w{i * 8}", f"w{i * 8 + 4}") for i in range(2)]
    matches += [duel("r5", 5, "w0", "w8")]
    assert place_paths(matches, SE_STAGE, DONE)["l0"] == "in Runde 1 raus"


def test_running_tournament_has_no_paths():
    assert place_paths(se_with_bronze(), SE_STAGE, {**DONE, "status": "live"}) == {}


def test_heats_have_no_paths():
    stages = [{"id": "s1", "stage_type": "ffa_single_elimination"}]
    assert place_paths(se_with_bronze(), stages, {"format": "ffa", "status": "completed"}) == {}


def test_double_elim_grand_final_and_loser_final():
    stages = [{"id": "s1", "stage_type": "double_elimination"}]
    matches = [
        duel("w1", 1, "a", "c"), duel("w2", 1, "b", "d"), duel("wf", 2, "a", "b"),
        duel("l1", 2, "c", "d", section="lb", round_name="Loser Runde 2"),
        duel("lf", 3, "b", "c", section="lb", round_name="Loser Runde 3"),
        duel("gf", 4, "a", "b", section="gf"),
    ]
    paths = place_paths(matches, stages, {"format": "double_elim", "status": "results_published"})
    assert paths["a"] == "Grand Final gewonnen"
    assert paths["b"] == "im Grand Final"
    assert paths["c"] == "im Loser Final raus"
    assert paths["d"] == "in Loser Runde 1 raus"


def test_a_bye_is_neither_a_game_nor_a_win():
    regs = [{"id": "a", "display_name": "A"}, {"id": "b", "display_name": "B"}, {"id": "c", "display_name": "C"}]
    matches = [bye("b1", 1, "a"), duel("h1", 1, "b", "c"), duel("f", 2, "a", "b")]
    rows = {row["registration_id"]: row for row in stage_standings(matches, regs)}
    assert (rows["a"]["won"], rows["a"]["played"], rows["a"]["rank"]) == (1, 1, 1)
    assert (rows["b"]["won"], rows["b"]["played"], rows["b"]["rank"]) == (1, 2, 2)
    # Der Weg schaut am Freilos vorbei auf das letzte echte Spiel.
    assert place_paths(matches, SE_STAGE, DONE)["a"] == "Finale gewonnen"


def test_public_standings_carry_the_path_only_for_trees():
    regs = [{"id": key, "display_name": key.upper(), "status": "approved"} for key in "abcd"]
    rows = public_standings(DONE, {"matches": se_with_bronze()}, regs, stages=SE_STAGE)
    assert {row["registration_id"]: row.get("place_path") for row in rows}["b"] == "im Finale"
    league = public_standings({"format": "league", "status": "completed"}, {"matches": se_with_bronze()}, regs,
                              stages=SE_STAGE)
    assert all("place_path" not in row for row in league)


def test_games_won_text():
    assert games_won_text(4) == "4 Spiele gewonnen"
    assert games_won_text(1) == "1 Spiel gewonnen"
    assert games_won_text(0) == "kein Spiel gewonnen"
