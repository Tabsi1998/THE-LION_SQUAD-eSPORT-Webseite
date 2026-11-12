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
            "status": "completed", "source": SRC,
            "slots": [{"registration_id": player}, {"registration_id": None, "status": "bye"}],
            "results": [{"registration_id": player, "rank": 1}]}


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


# ---------------------------------------------------------------- Review #2336: Reihenfolge, kampflos, Doppel-K.-o.

def test_a_bye_keeps_the_order_exactly_as_before():
    # c und d verlieren beide im Halbfinale; c kam per Freilos hin, d stand direkt in Runde 2. Vor #2336 lag c vorn
    # (ein Sieg mehr) - und so bleibt es, auch wenn c jetzt „kein Spiel gewonnen“ zeigt.
    regs = [{"id": key, "display_name": key.upper()} for key in ("a", "b", "d", "c")]
    matches = [bye("b1", 1, "c"), duel("h1", 2, "a", "c"), duel("h2", 2, "b", "d"), duel("f", 3, "a", "b")]
    rows = stage_standings(matches, regs)
    assert [row["registration_id"] for row in rows] == ["a", "b", "c", "d"]
    third = rows[2]
    assert (third["won"], third["played"], third["byes"]) == (0, 1, 1)


def test_only_byes_still_have_a_placement():
    from services.competition_standings import placements_for_structure

    # x rückt zweimal per Freilos vor und gewinnt das Finale kampflos: kein Spiel, aber Platz 1.
    regs = [{"id": key, "status": "approved", "user_id": f"u-{key}"} for key in ("x", "y", "z")]
    matches = [bye("b1", 1, "x"), duel("h1", 1, "y", "z"), bye("b2", 2, "x")]
    places = placements_for_structure({"matches": matches}, regs, tournament=DONE)
    assert [entry["registration_id"] for entry in places.get(1, [])] == ["x"]


def test_walkover_final_after_disqualification():
    # Finalist b wird vor dem Finale ausgeschlossen: der Platz wird geleert, das Finale kampflos entschieden.
    regs = [{"id": "a", "status": "approved"}, {"id": "b", "status": "disqualified"},
            {"id": "c", "status": "approved"}, {"id": "d", "status": "checked_in"}]
    final = {"id": "f", "stage_id": "s1", "stage_number": 1, "round": 2, "section": "main", "status": "completed", "source": SRC,
             "slots": [{"registration_id": "a"}, {"registration_id": None, "state": "bye"}],
             "results": [{"registration_id": "a", "rank": 1}]}
    paths = place_paths([duel("h1", 1, "a", "c"), duel("h2", 1, "b", "d"), final], SE_STAGE, DONE, regs)
    assert paths["a"] == "Finale kampflos gewonnen"
    assert "b" not in paths, "wer ausgeschlossen ist, bekommt keinen Weg"
    assert paths["c"] == "im Halbfinale raus"


def _generated(count, stage_type, tournament, seed):
    import random

    import test_bracket_generator_sim_unit as sim

    matches = sim.build(count, stage_type, tournament=tournament)
    sim.play_through(matches, random.Random(seed))
    for match in matches:
        match["source"] = {"engine": "stage"}
        match.setdefault("stage_number", 1)
        match.setdefault("stage_id", "s")
    stages = [{"id": "s", "number": 1, "stage_type": stage_type, "name": "Phase"}]
    rows = stage_standings(matches, sim.registrations(count))
    paths = place_paths(matches, stages, {**tournament, "status": "completed"}, sim.registrations(count))
    return [(row["rank"], paths.get(row["registration_id"])) for row in rows[:3]]


def test_double_elim_with_nine_from_the_real_generator():
    # Im echten Baum heißt das letzte Loser-Spiel „Loser Runde 6“ (round 7) - der Weg erkennt es an seiner Stelle.
    for mode in ("single", "reset"):
        top = _generated(9, "double_elimination", {"grand_final_mode": mode, "format": "double_elim"}, 63)
        assert top[0][1].startswith("Grand Final") and top[0][1].endswith("gewonnen")
        assert top[1][1].startswith("im Grand Final")
        assert top[2] == (3, "im Loser Final raus")
    top = _generated(9, "double_elimination", {"grand_final_mode": "none", "format": "double_elim"}, 63)
    assert top == [(1, "Winner Final gewonnen"), (2, "Loser Final gewonnen"), (3, "im Loser Final raus")]
    two = _generated(2, "double_elimination", {"grand_final_mode": "none", "format": "double_elim"}, 14)
    assert two[:2] == [(1, "Finale gewonnen"), (2, "im Finale")]


def test_groups_then_knockout():
    stages = [{"id": "g", "stage_type": "round_robin_groups", "name": "Gruppen"},
              {"id": "s1", "stage_type": "single_elimination", "name": "Finalrunde"}]
    groups = []
    for index, (winner, loser) in enumerate([("a", "e"), ("b", "f"), ("c", "e"), ("d", "f")]):
        match = duel(f"g{index}", 1, winner, loser, section="group_A", stage_id="g")
        groups.append(match)
    knockout = [duel("h1", 1, "a", "c"), duel("h2", 1, "b", "d"), duel("f", 2, "a", "b")]
    for match in knockout:
        match["stage_number"] = 2
    paths = place_paths(groups + knockout, stages, {"format": "single_elim", "status": "completed"})
    assert paths == {"a": "Finale gewonnen", "b": "im Finale", "c": "im Halbfinale raus", "d": "im Halbfinale raus"}, \
        "wer nur in der Gruppe spielte, hat keinen Weg"


def test_team_tournament_carries_the_path_per_team():
    regs = [{"id": key, "team_id": f"team-{key}", "display_name": f"Team {key.upper()}", "status": "approved"} for key in "abcd"]
    rows = public_standings({**DONE, "team_mode": "team"}, {"matches": se_with_bronze()}, regs, stages=SE_STAGE)
    by_id = {row["registration_id"]: row for row in rows}
    assert by_id["a"]["team_id"] == "team-a" and by_id["a"]["place_path"] == "Finale gewonnen"
    assert by_id["c"]["place_path"] == "Spiel um Platz 3 gewonnen"
