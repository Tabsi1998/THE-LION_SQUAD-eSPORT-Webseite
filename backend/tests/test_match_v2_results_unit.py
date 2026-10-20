import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.match_v2_results import (
    MatchV2ResultError,
    _pot_ranks,
    build_v2_result_application,
    is_v2_result_replay,
    normalize_v2_results,
    public_recalculation_error,
)


def _source_match():
    return {
        "id": "m-a",
        "tournament_id": "t1",
        "stage_id": "s1",
        "match_key": "A",
        "status": "ready",
        "slots": [
            {"slot": 1, "registration_id": "r1", "user_id": "u1", "status": "filled"},
            {"slot": 2, "registration_id": "r2", "user_id": "u2", "status": "filled"},
            {"slot": 3, "registration_id": "r3", "user_id": "u3", "status": "filled"},
            {"slot": 4, "registration_id": "r4", "user_id": "u4", "status": "filled"},
        ],
        "advancement": [
            {"flow": "W", "rank": 1, "to_match_id": "m-b", "to_match_key": "B", "to_slot": 1},
            {"flow": "W", "rank": 2, "to_match_id": "m-b", "to_match_key": "B", "to_slot": 2},
            {"flow": "L", "rank": 3, "to_match_id": "m-l", "to_match_key": "L", "to_slot": 1},
            {"flow": "L", "rank": 4, "to_match_id": "m-l", "to_match_key": "L", "to_slot": 2},
        ],
    }


def _target(match_id, key):
    return {
        "id": match_id,
        "stage_id": "s1",
        "match_key": key,
        "status": "pending",
        "settings": {"min_players": 2},
        "slots": [
            {"slot": 1, "registration_id": None, "status": "pending"},
            {"slot": 2, "registration_id": None, "status": "pending"},
        ],
    }


RESULTS = [
    {"registration_id": "r2", "rank": 1, "score": 40},
    {"registration_id": "r1", "rank": 2, "score": 35},
    {"registration_id": "r4", "rank": 3, "score": 20},
    {"registration_id": "r3", "rank": 4, "score": 12},
]


def test_public_recalculation_error_does_not_expose_internal_detail():
    error = public_recalculation_error({"id": "m-secret", "match_key": "A"})

    assert error == {
        "match_id": "m-secret",
        "match_key": "A",
        "code": "invalid_result",
        "detail": "Ergebnis konnte nicht sicher neu berechnet werden.",
    }


def test_normalize_v2_results_requires_all_filled_slots():
    with pytest.raises(MatchV2ResultError, match="alle belegten Teilnehmer"):
        normalize_v2_results(_source_match(), RESULTS[:3])


def _heat_with_no_show(registration_id="r3", note="Nicht erschienen – Frist von 10 Minuten abgelaufen"):
    match = _source_match()
    match["no_show_registration_ids"] = [registration_id]
    match["no_show_notes"] = {registration_id: note}
    return match


def test_a_heat_without_the_missing_person_gets_them_last_as_no_show():
    """#1823: im Lauf reicht das Ergebnis der Anwesenden - wer als nicht erschienen markiert ist, steht danach hinten."""
    results = normalize_v2_results(_heat_with_no_show(), [
        {"registration_id": "r4", "rank": 1}, {"registration_id": "r1", "rank": 2}, {"registration_id": "r2", "rank": 3},
    ])

    assert [(row["registration_id"], row["rank"], row["forfeit"]) for row in results] == [
        ("r4", 1, False), ("r1", 2, False), ("r2", 3, False), ("r3", 4, True)]
    assert results[-1]["note"] == "Nicht erschienen – Frist von 10 Minuten abgelaufen"


def test_a_heat_with_points_puts_the_missing_person_last_too():
    results = normalize_v2_results(_heat_with_no_show(), [
        {"registration_id": "r1", "score": 4}, {"registration_id": "r2", "score": 9}, {"registration_id": "r4", "score": 7},
    ])

    assert [row["registration_id"] for row in results] == ["r2", "r4", "r1", "r3"]
    assert results[-1]["forfeit"] is True


def test_the_window_flag_keeps_the_reason_of_the_mark():
    results = normalize_v2_results(_heat_with_no_show(), [
        {"registration_id": "r4", "rank": 1}, {"registration_id": "r1", "rank": 2},
        {"registration_id": "r2", "rank": 3}, {"registration_id": "r3", "rank": 4, "forfeit": True},
    ])

    assert results[-1]["note"] == "Nicht erschienen – Frist von 10 Minuten abgelaufen"


def test_a_marked_person_who_raced_after_all_keeps_the_entered_place():
    results = normalize_v2_results(_heat_with_no_show(), [
        {"registration_id": "r3", "rank": 1}, {"registration_id": "r4", "rank": 2},
        {"registration_id": "r1", "rank": 3}, {"registration_id": "r2", "rank": 4},
    ])

    assert [(row["registration_id"], row["forfeit"]) for row in results][0] == ("r3", False)


def test_without_a_mark_a_missing_participant_is_still_an_error():
    match = _heat_with_no_show()
    with pytest.raises(MatchV2ResultError, match="alle belegten Teilnehmer"):
        normalize_v2_results(match, [{"registration_id": "r4", "rank": 1}, {"registration_id": "r1", "rank": 2}])


@pytest.mark.parametrize(("ranking", "winners", "losers"), [
    # Ausgetreten unter den Weiterkommern: der Dritte rückt ins Sieger-Ziel, ins Loser Bracket nur noch der Vierte.
    (["r1", "r2", "r3", "r4"], ["r2", "r3"], ["r4", None]),
    # Ausgetreten unter den Verlierern: auf dem Verlierer-Weg rückt der Nächste auf.
    (["r2", "r3", "r1", "r4"], ["r2", "r3"], ["r4", None]),
])
def test_a_withdrawn_heat_player_moves_the_others_up_on_both_paths(ranking, winners, losers):
    """#1823 (Austritt während des Laufs, Läufe-Cup mit Loser Bracket): steht eine ausgetretene Person im Ergebnis,
    rücken die anderen auf dem Sieger- und dem Verlierer-Weg auf - niemand wird zweimal weitergeleitet."""
    source = {**_source_match(), "match_type": "ffa"}

    application = build_v2_result_application(
        source,
        [source, _target("m-b", "B"), _target("m-l", "L")],
        [{"registration_id": registration_id, "rank": rank} for rank, registration_id in enumerate(ranking, start=1)],
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
        eliminated={"r1"},
    )

    assert [slot["registration_id"] for slot in application["target_sets"]["m-b"]["slots"]] == winners
    assert [slot["registration_id"] for slot in application["target_sets"]["m-l"]["slots"]] == losers


def _seeded_heat():
    """Lauf A mit Setzplätzen, die nicht der Sitzreihenfolge folgen: r1=4, r2=2, r3=1, r4=3."""
    source = {**_source_match(), "match_type": "ffa"}
    source["slots"] = [{**slot, "seed": seed} for slot, seed in zip(source["slots"], (4, 2, 1, 3))]
    return source


NO_SHOWS = [  # r4 vor r2 eingetragen - die Reihenfolge der Eingabe zählt nicht
    {"registration_id": "r3", "rank": 1}, {"registration_id": "r1", "rank": 2},
    {"registration_id": "r4", "rank": 3, "forfeit": True}, {"registration_id": "r2", "rank": 4, "forfeit": True},
]


def test_two_no_shows_share_the_last_place_ordered_by_seed():
    """#1823: fehlen mehrere, teilen sie sich den letzten Platz - in der Reihenfolge ihrer Setzplätze."""
    results = normalize_v2_results(_seeded_heat(), NO_SHOWS)

    assert [(row["registration_id"], row["rank"], row["forfeit"]) for row in results] == [
        ("r3", 1, False), ("r1", 2, False), ("r2", 3, True), ("r4", 3, True)]


def test_without_seeds_the_seat_decides():
    results = normalize_v2_results({**_source_match(), "match_type": "ffa"}, NO_SHOWS)

    assert [row["registration_id"] for row in results if row["forfeit"]] == ["r2", "r4"]


def test_no_shows_sharing_the_last_place_advance_in_seed_order():
    """Weiterkommen nach Position: zwei Beste weiter, die Fehlenden nach Setzplatz ins Loser Bracket."""
    source = _seeded_heat()

    application = build_v2_result_application(
        source, [source, _target("m-b", "B"), _target("m-l", "L")], NO_SHOWS,
        actor_id="admin", now_iso="2026-05-08T12:00:00+00:00",
    )

    assert [slot["registration_id"] for slot in application["target_sets"]["m-b"]["slots"]] == ["r3", "r1"]
    assert [slot["registration_id"] for slot in application["target_sets"]["m-l"]["slots"]] == ["r2", "r4"]


def test_the_draw_pot_takes_no_shows_sharing_a_place_in_order():
    source = _seeded_heat()
    results = normalize_v2_results(source, NO_SHOWS)

    loser_path, winner_path = _pot_ranks(source, results, set())

    assert [loser_path[rank]["registration_id"] for rank in (3, 4)] == ["r2", "r4"]
    assert [winner_path[rank]["registration_id"] for rank in (1, 2)] == ["r3", "r1"]


THREE_MISSING = [  # nur r3 ist da; Setzplätze r1=4, r2=2, r4=3
    {"registration_id": "r3", "rank": 1},
    {"registration_id": "r1", "rank": 2, "forfeit": True}, {"registration_id": "r2", "rank": 3, "forfeit": True},
    {"registration_id": "r4", "rank": 4, "forfeit": True},
]


def test_no_show_never_takes_a_winner_place_and_all_go_the_loser_path_by_seed():
    """#1823 (3 von 4 fehlen, Quote 2): der zweite Sieger-Platz wird ein Freilos; die Nicht-Erschienenen gehen auf den
    Verlierer-Weg, so weit Plätze da sind - nach Setzplatz (r2, dann r4); r1 (Setzplatz 4) bleibt draußen."""
    source = _seeded_heat()

    application = build_v2_result_application(
        source, [source, _target("m-b", "B"), _target("m-l", "L")], THREE_MISSING,
        actor_id="admin", now_iso="2026-05-08T12:00:00+00:00",
    )

    winners = application["target_sets"]["m-b"]["slots"]
    assert [slot["registration_id"] for slot in winners] == ["r3", None]
    assert winners[1]["status"] == "bye" and winners[1]["source_result"]["reason"] == "forfeit"
    assert [slot["registration_id"] for slot in application["target_sets"]["m-l"]["slots"]] == ["r2", "r4"]


def test_without_a_loser_path_the_no_shows_are_out():
    source = {**_seeded_heat(), "advancement": [entry for entry in _seeded_heat()["advancement"] if entry["flow"] == "W"]}

    application = build_v2_result_application(
        source, [source, _target("m-b", "B")], THREE_MISSING, actor_id="admin", now_iso="2026-05-08T12:00:00+00:00",
    )

    assert [slot["registration_id"] for slot in application["target_sets"]["m-b"]["slots"]] == ["r3", None]


def test_the_draw_pot_sends_every_no_show_to_the_loser_path_too():
    source = _seeded_heat()
    results = normalize_v2_results(source, THREE_MISSING)

    loser_path, winner_path = _pot_ranks(source, results, set())

    assert winner_path[1]["registration_id"] == "r3" and winner_path[2]["forfeit"] is True
    assert [loser_path[rank]["registration_id"] for rank in (3, 4)] == ["r2", "r4"]


def test_the_draw_pot_moves_the_others_up_on_both_paths_too():
    """Gemischte Runden (#1548) losen aus demselben Stand: wer im Lauf auf den Sieger-Weg aufrückt, kommt nicht
    zugleich in den Topf des Loser Bracket (#1823)."""
    source = {**_source_match(), "match_type": "ffa"}
    results = [{"registration_id": f"r{rank}", "rank": rank} for rank in range(1, 5)]

    loser_path, winner_path = _pot_ranks(source, results, {"r1"})

    assert [winner_path[rank]["registration_id"] for rank in (1, 2)] == ["r2", "r3"]
    assert loser_path[3]["registration_id"] == "r4" and 4 not in loser_path


def test_normalize_v2_results_auto_ranks_fastest_time_when_configured():
    match = _source_match()
    match["settings"] = {"calculation": "time"}

    results = normalize_v2_results(match, [
        {"registration_id": "r1", "time_ms": 65500},
        {"registration_id": "r2", "time_ms": 61200},
        {"registration_id": "r3", "time_ms": 70000},
        {"registration_id": "r4", "time_ms": 64000},
    ])

    assert [row["registration_id"] for row in results] == ["r2", "r4", "r1", "r3"]
    assert [row["rank"] for row in results] == [1, 2, 3, 4]


def test_normalize_v2_results_auto_ranks_lower_score_when_configured():
    match = _source_match()
    match["settings"] = {"calculation": "lower_score"}

    results = normalize_v2_results(match, [
        {"registration_id": "r1", "score": 9},
        {"registration_id": "r2", "score": 4},
        {"registration_id": "r3", "score": 12},
        {"registration_id": "r4", "score": 6},
    ])

    assert [row["registration_id"] for row in results] == ["r2", "r4", "r1", "r3"]


def test_normalize_v2_results_recalculates_supplied_ranks_from_score():
    results = normalize_v2_results(_source_match(), [
        {"registration_id": "r1", "rank": 1, "score": 10},
        {"registration_id": "r2", "rank": 2, "score": 15},
        {"registration_id": "r3", "rank": 3, "score": 4},
        {"registration_id": "r4", "rank": 4, "score": 8},
    ])

    assert [row["registration_id"] for row in results] == ["r2", "r1", "r4", "r3"]
    assert [row["rank"] for row in results] == [1, 2, 3, 4]


def test_v2_result_application_fills_advancement_slots():
    source = _source_match()
    winner_target = _target("m-b", "B")
    loser_target = _target("m-l", "L")

    application = build_v2_result_application(
        source,
        [source, winner_target, loser_target],
        RESULTS,
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
    )

    assert application["match_set"]["status"] == "completed"
    assert application["results"][0]["registration_id"] == "r2"
    assert application["target_sets"]["m-b"]["status"] == "ready"
    assert application["target_sets"]["m-b"]["slots"][0]["registration_id"] == "r2"
    assert application["target_sets"]["m-b"]["slots"][1]["registration_id"] == "r1"
    assert application["target_sets"]["m-l"]["slots"][0]["registration_id"] == "r4"
    assert application["target_sets"]["m-l"]["slots"][1]["registration_id"] == "r3"


def test_completed_v2_result_detects_exact_idempotent_replay():
    source = _source_match()
    application = build_v2_result_application(
        source,
        [source, _target("m-b", "B"), _target("m-l", "L")],
        RESULTS,
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
        proof_url=" https://example.test/proof ",
        note=" final ",
    )
    completed = {**source, **application["match_set"]}

    assert is_v2_result_replay(
        completed,
        RESULTS,
        proof_url="https://example.test/proof",
        note="final",
    )


def test_completed_v2_result_replay_requires_same_payload_and_metadata():
    source = _source_match()
    application = build_v2_result_application(
        source,
        [source, _target("m-b", "B"), _target("m-l", "L")],
        RESULTS,
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
        note="final",
    )
    completed = {**source, **application["match_set"]}
    changed = [dict(entry) for entry in RESULTS]
    changed[0]["score"] = 999

    assert not is_v2_result_replay(completed, changed, note="final")
    assert not is_v2_result_replay(completed, RESULTS, note="korrigiert")


def test_l_flow_rank_is_loser_index_after_qualifiers():
    source = {
        "id": "m-a",
        "tournament_id": "t1",
        "stage_id": "s1",
        "match_key": "A",
        "status": "ready",
        "settings": {"match_size": 2, "qualifiers_per_match": 1, "calculation": "points"},
        "slots": [
            {"slot": 1, "registration_id": "winner", "user_id": "u1", "status": "filled"},
            {"slot": 2, "registration_id": "loser", "user_id": "u2", "status": "filled"},
        ],
        "advancement": [
            {"flow": "W", "rank": 1, "to_match_id": "m-w", "to_match_key": "W", "to_slot": 1},
            {"flow": "L", "rank": 1, "to_match_id": "m-l", "to_match_key": "L", "to_slot": 1},
        ],
    }
    winner_target = _target("m-w", "W")
    loser_target = _target("m-l", "L")

    application = build_v2_result_application(
        source,
        [source, winner_target, loser_target],
        [
            {"registration_id": "winner", "score": 2},
            {"registration_id": "loser", "score": 0},
        ],
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
    )

    assert application["target_sets"]["m-w"]["slots"][0]["registration_id"] == "winner"
    assert application["target_sets"]["m-l"]["slots"][0]["registration_id"] == "loser"


def test_result_application_rejects_same_participant_advanced_twice():
    source = {
        "id": "m-a",
        "tournament_id": "t1",
        "stage_id": "s1",
        "match_key": "A",
        "status": "ready",
        "settings": {"calculation": "points"},
        "slots": [
            {"slot": 1, "registration_id": "winner", "user_id": "u1", "status": "filled"},
            {"slot": 2, "registration_id": "loser", "user_id": "u2", "status": "filled"},
        ],
        "advancement": [
            {"flow": "W", "rank": 1, "to_match_id": "m-w", "to_match_key": "W", "to_slot": 1},
            {"flow": "L", "rank": 1, "to_match_id": "m-l", "to_match_key": "L", "to_slot": 1},
        ],
    }

    with pytest.raises(MatchV2ResultError, match="nicht mehrfach weitergeleitet"):
        build_v2_result_application(
            source,
            [source, _target("m-w", "W"), _target("m-l", "L")],
            [
                {"registration_id": "winner", "score": 2},
                {"registration_id": "loser", "score": 0},
            ],
            actor_id="admin",
            now_iso="2026-05-08T12:00:00+00:00",
        )


def test_missing_loser_rank_from_bye_clears_loser_target_slot():
    source = {
        "id": "m-a",
        "tournament_id": "t1",
        "stage_id": "s1",
        "match_key": "A",
        "status": "ready",
        "settings": {"match_size": 2, "qualifiers_per_match": 1, "calculation": "points"},
        "slots": [
            {"slot": 1, "registration_id": "winner", "user_id": "u1", "status": "filled"},
            {"slot": 2, "registration_id": None, "user_id": None, "status": "bye"},
        ],
        "advancement": [
            {"flow": "W", "rank": 1, "to_match_id": "m-w", "to_match_key": "W", "to_slot": 1},
            {"flow": "L", "rank": 1, "to_match_id": "m-l", "to_match_key": "L", "to_slot": 1},
        ],
    }

    application = build_v2_result_application(
        source,
        [source, _target("m-w", "W"), _target("m-l", "L")],
        [{"registration_id": "winner", "score": 1}],
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
    )

    assert application["target_sets"]["m-w"]["slots"][0]["registration_id"] == "winner"
    loser_slot = application["target_sets"]["m-l"]["slots"][0]
    assert loser_slot["registration_id"] is None
    assert loser_slot["status"] == "bye"
    assert loser_slot["source_result"]["reason"] == "bye"


def test_l_flow_can_address_multiple_non_qualifiers():
    source = _source_match()
    source["settings"] = {"match_size": 4, "qualifiers_per_match": 2, "calculation": "points"}
    source["advancement"] = [
        {"flow": "W", "rank": 1, "to_match_id": "m-b", "to_match_key": "B", "to_slot": 1},
        {"flow": "W", "rank": 2, "to_match_id": "m-b", "to_match_key": "B", "to_slot": 2},
        {"flow": "L", "rank": 1, "to_match_id": "m-l", "to_match_key": "L", "to_slot": 1},
        {"flow": "L", "rank": 2, "to_match_id": "m-l", "to_match_key": "L", "to_slot": 2},
    ]

    application = build_v2_result_application(
        source,
        [source, _target("m-b", "B"), _target("m-l", "L")],
        RESULTS,
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
    )

    assert application["target_sets"]["m-b"]["slots"][0]["registration_id"] == "r2"
    assert application["target_sets"]["m-b"]["slots"][1]["registration_id"] == "r1"
    assert application["target_sets"]["m-l"]["slots"][0]["registration_id"] == "r4"
    assert application["target_sets"]["m-l"]["slots"][1]["registration_id"] == "r3"


def test_legacy_l_flow_absolute_rank_still_works_without_stage_settings():
    source = _source_match()
    source.pop("settings", None)

    application = build_v2_result_application(
        source,
        [source, _target("m-b", "B"), _target("m-l", "L")],
        RESULTS,
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
    )

    assert application["target_sets"]["m-l"]["slots"][0]["registration_id"] == "r4"
    assert application["target_sets"]["m-l"]["slots"][1]["registration_id"] == "r3"


def test_v2_result_application_blocks_downstream_overwrite_without_force():
    source = _source_match()
    winner_target = _target("m-b", "B")
    winner_target["slots"][0]["registration_id"] = "old-reg"
    winner_target["slots"][0]["status"] = "filled"

    with pytest.raises(MatchV2ResultError, match="force=true"):
        build_v2_result_application(
            source,
            [source, winner_target, _target("m-l", "L")],
            RESULTS,
            actor_id="admin",
            now_iso="2026-05-08T12:00:00+00:00",
        )


def test_v2_result_application_allows_forced_downstream_correction():
    source = _source_match()
    winner_target = _target("m-b", "B")
    winner_target["status"] = "completed"
    winner_target["results"] = [{"registration_id": "old-reg", "rank": 1}]
    winner_target["slots"][0]["registration_id"] = "old-reg"
    winner_target["slots"][0]["status"] = "filled"

    application = build_v2_result_application(
        source,
        [source, winner_target, _target("m-l", "L")],
        RESULTS,
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
        force=True,
    )

    assert application["target_sets"]["m-b"]["slots"][0]["registration_id"] == "r2"
    assert application["target_sets"]["m-b"]["results"] == []
    assert application["target_sets"]["m-b"]["status"] == "ready"
    assert application["match_set"]["result_meta"]["force"] is True


def test_v2_result_application_force_clears_dependent_downstream_slots():
    source = _source_match()
    winner_target = _target("m-b", "B")
    winner_target["status"] = "completed"
    winner_target["results"] = [{"registration_id": "old-reg", "rank": 1}]
    winner_target["slots"][0]["registration_id"] = "old-reg"
    winner_target["slots"][0]["status"] = "filled"

    downstream_target = _target("m-c", "C")
    downstream_target["status"] = "completed"
    downstream_target["results"] = [{"registration_id": "old-reg", "rank": 1}]
    downstream_target["slots"][0].update({
        "registration_id": "old-reg",
        "user_id": "old-user",
        "status": "filled",
        "source_result": {"from_match_id": "m-b", "rank": 1},
    })

    application = build_v2_result_application(
        source,
        [source, winner_target, _target("m-l", "L"), downstream_target],
        RESULTS,
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
        force=True,
    )

    assert application["target_sets"]["m-b"]["slots"][0]["registration_id"] == "r2"
    assert application["target_sets"]["m-b"]["results"] == []
    assert application["target_sets"]["m-c"]["slots"][0]["registration_id"] is None
    assert application["target_sets"]["m-c"]["slots"][0]["source_result"] is None
    assert application["target_sets"]["m-c"]["results"] == []
    assert application["target_sets"]["m-c"]["status"] == "pending"


def test_v2_old_shuffle_flag_without_draw_group_keeps_the_fixed_slots():
    """Gemischt wird seit #1548 per Auslosung der ganzen Runde (``settings.draw_group`` am Folgespiel, beim Bau
    gesetzt). Ältere Spiele mit nur dem Haken am Spiel und ohne Gruppe bleiben beim Platz aus dem Schema."""
    source = _source_match()
    source["settings"] = {"randomize_advancement_rounds": True}
    winner_target = _target("m-b", "B")
    loser_target = _target("m-l", "L")

    application = build_v2_result_application(
        source,
        [source, winner_target, loser_target],
        RESULTS,
        actor_id="admin",
        now_iso="2026-05-08T12:00:00+00:00",
    )

    slots = application["target_sets"]["m-b"]["slots"]
    assert [slot["registration_id"] for slot in slots] == ["r2", "r1"]
    assert application["draws"] == []


# ---------------------------------------------------------------- Unentschieden

def duel(section, first="a", second="b"):
    return {
        "section": section,
        "settings": {"match_size": 2},
        "slots": [
            {"slot": 1, "registration_id": first, "status": "filled", "user_id": "u1"},
            {"slot": 2, "registration_id": second, "status": "filled", "user_id": "u2"},
        ],
    }


def places(results):
    return {entry["registration_id"]: entry["rank"] for entry in results}


@pytest.mark.parametrize("section", ["LIGA", "round_robin", "swiss", "group_A", "group_b"])
def test_a_table_format_may_end_level(section):
    """Vor diesem Fund wurde jedes Unentschieden zum Sieg des Erstgenannten."""
    results = normalize_v2_results(duel(section), [
        {"registration_id": "a", "rank": 1},
        {"registration_id": "b", "rank": 1},
    ])

    assert places(results) == {"a": 1, "b": 1}


@pytest.mark.parametrize("section", ["WB", "LB", "GF", "MAIN", "BRONZE"])
def test_a_knockout_match_may_not(section):
    """Irgendwer muss weiterkommen - sonst bleibt der Folgeplatz für immer leer."""
    with pytest.raises(MatchV2ResultError):
        normalize_v2_results(duel(section), [
            {"registration_id": "a", "rank": 1},
            {"registration_id": "b", "rank": 1},
        ])


def test_equal_scores_become_a_shared_place_where_that_is_allowed():
    results = normalize_v2_results(duel("LIGA"), [
        {"registration_id": "a", "score": 2},
        {"registration_id": "b", "score": 2},
    ])

    assert places(results) == {"a": 1, "b": 1}


def test_equal_scores_in_a_knockout_need_a_place_that_decides():
    """#1035: nicht mehr die Reihenfolge der Liste - ohne angegebenen Platz ist es ein Eingabefehler."""
    with pytest.raises(MatchV2ResultError, match="Gleichstand"):
        normalize_v2_results(duel("WB"), [
            {"registration_id": "a", "score": 2},
            {"registration_id": "b", "score": 2},
        ])
    results = normalize_v2_results(duel("WB"), [
        {"registration_id": "a", "score": 2, "rank": 2},
        {"registration_id": "b", "score": 2, "rank": 1},
    ])

    assert places(results) == {"a": 2, "b": 1}


def test_a_clear_win_stays_a_clear_win():
    results = normalize_v2_results(duel("LIGA"), [
        {"registration_id": "a", "score": 1},
        {"registration_id": "b", "score": 3},
    ])

    assert places(results) == {"a": 2, "b": 1}


def test_a_reported_placement_is_not_overwritten_by_the_scores():
    """Ein Forfeit nennt die Platzierung und hat keine Punkte - die muss halten."""
    results = normalize_v2_results(duel("LIGA"), [
        {"registration_id": "a", "rank": 1},
        {"registration_id": "b", "rank": 2},
    ])

    assert places(results) == {"a": 1, "b": 2}


def test_a_tie_pushes_the_next_place_back():
    """Übliche Zählweise: 1, 1, 3 - nicht 1, 1, 2."""
    heat = {
        "section": "group_A",
        "settings": {"match_size": 3},
        "slots": [
            {"slot": index, "registration_id": item, "status": "filled"}
            for index, item in enumerate(["a", "b", "c"], start=1)
        ],
    }

    results = normalize_v2_results(heat, [
        {"registration_id": "a", "score": 5},
        {"registration_id": "b", "score": 5},
        {"registration_id": "c", "score": 1},
    ])

    assert places(results) == {"a": 1, "b": 1, "c": 3}


def test_a_ranking_that_skips_wrongly_is_refused():
    heat = {
        "section": "group_A",
        "settings": {"match_size": 3},
        "slots": [
            {"slot": index, "registration_id": item, "status": "filled"}
            for index, item in enumerate(["a", "b", "c"], start=1)
        ],
    }

    with pytest.raises(MatchV2ResultError, match="Gleichstand"):
        normalize_v2_results(heat, [
            {"registration_id": "a", "rank": 1},
            {"registration_id": "b", "rank": 1},
            {"registration_id": "c", "rank": 2},
        ])
