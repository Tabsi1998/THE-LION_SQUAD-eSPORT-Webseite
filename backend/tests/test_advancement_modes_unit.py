"""Weiterkommen in vier Modi (#1590): fester Baum, Auslosung nach der Runde, Show-Auslosung, sofort zufällig.

Die Einstellung ``advancement_mode`` ersetzt den Schalter ``randomize_advancement_rounds`` (aus → ``fixed``, an →
``draw_round``). ``draw_show`` wartet nach der Runde auf „Jetzt auslosen“; ``instant`` setzt jeden Weiterkommer sofort
auf einen zufälligen freien Platz der Zielgruppe.
"""
import pathlib
import random
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.advancement_draw import (  # noqa: E402
    advancement_mode_of,
    advancement_shuffle_enabled,
    match_mode,
    prerequisite_ids,
    show_minutes_of,
    sync_advancement_fields,
)
from services.custom_bracket import build_matches_v2_from_schema  # noqa: E402
from services.match_scheduler import DEFAULT_BREAK_MINUTES, plan_schedule  # noqa: E402
from services.match_v2_results import (  # noqa: E402
    MatchV2ResultError,
    build_redraw_application,
    build_show_draw_application,
    build_v2_result_application,
    group_awaits_draw,
    run_ready_draws,
)

NOW = "2026-10-14T10:00:00+00:00"
SHOW = {"advancement_mode": "draw_show"}
INSTANT = {"advancement_mode": "instant"}


def registrations(count: int) -> list[dict]:
    return [{"id": f"r{i}", "user_id": f"u{i}", "status": "approved", "seed": i} for i in range(1, count + 1)]


def build(count: int, stage_type: str, match_type: str = "duel", settings: dict | None = None,
          tournament: dict | None = None) -> list[dict]:
    base = {"id": "t", "seeding_mode": "manual", "max_participants": count, **(tournament or {})}
    stage = {"id": "s", "number": 1, "stage_type": stage_type, "match_type": match_type, "settings": settings or {}}
    return build_matches_v2_from_schema(base, stage, registrations(count))


def by_key(matches: list[dict]) -> dict[str, dict]:
    return {m["match_key"]: m for m in matches}


def filled_ids(match: dict) -> list[str]:
    return [s["registration_id"] for s in match["slots"] if s.get("status") == "filled" and s.get("registration_id")]


def apply(matches: list[dict], match: dict, ranking: list[str], *, force: bool = False, rng=None, forfeit_last=False) -> dict:
    raw = [{"registration_id": reg, "rank": index + 1, "forfeit": forfeit_last and index == len(ranking) - 1}
           for index, reg in enumerate(ranking)]
    application = build_v2_result_application(match, matches, raw, actor_id="staff", now_iso=NOW, force=force, rng=rng)
    match.update(application["match_set"])
    rows = {row["id"]: row for row in matches}
    for target_id, update in application["target_sets"].items():
        rows[target_id].update(update)
    return application


def apply_sets(matches: list[dict], application: dict) -> None:
    rows = {row["id"]: row for row in matches}
    for target_id, update in application["target_sets"].items():
        rows[target_id].update(update)


def lower_seed_wins(match: dict) -> list[str]:
    return sorted(filled_ids(match), key=lambda reg: int(reg[1:]))


def seat_of(matches: list[dict], registration_id: str, round_no: int) -> tuple[str, int] | None:
    for match in matches:
        if match.get("round") != round_no:
            continue
        for slot in match["slots"]:
            if slot.get("registration_id") == registration_id:
                return match["match_key"], int(slot["slot"])
    return None


# ---------------------------------------------------------------------------------------------- Einstellung

def test_mode_old_flag_migrates_and_new_field_wins():
    assert advancement_mode_of({}, {}) == "fixed"
    assert advancement_mode_of({"randomize_advancement_rounds": True}, {}) == "draw_round"
    assert advancement_mode_of({"randomize_advancement_rounds": False}, {}) == "fixed"
    assert advancement_mode_of({"advancement_mode": "instant", "randomize_advancement_rounds": False}, {}) == "instant"
    assert advancement_mode_of({"advancement_mode": "unsinn"}, {}) == "fixed"
    # Phase vor Turnier - neu wie alt; leer erbt.
    assert advancement_mode_of({"advancement_mode": "instant"}, {"advancement_mode": "draw_show"}) == "draw_show"
    assert advancement_mode_of({"advancement_mode": "instant"}, {"randomize_advancement_rounds": False}) == "fixed"
    assert advancement_mode_of({"advancement_mode": "instant"}, {"advancement_mode": None}) == "instant"
    assert advancement_mode_of({"advancement_mode": "instant"}, {"advancement_mode": ""}) == "instant"
    assert advancement_shuffle_enabled({"advancement_mode": "draw_show"}, {}) is True
    assert advancement_shuffle_enabled({"advancement_mode": "fixed", "randomize_advancement_rounds": True}, {}) is False


def test_sync_keeps_old_flag_as_mirror_of_the_mode():
    doc = {"advancement_mode": "instant"}
    sync_advancement_fields(doc)
    assert doc == {"advancement_mode": "instant", "randomize_advancement_rounds": True}
    old = {"randomize_advancement_rounds": True}
    sync_advancement_fields(old)
    assert old == {"advancement_mode": "draw_round", "randomize_advancement_rounds": True}
    # Phase: leer bleibt leer (erbt), ein Nein wird „fixed“.
    stage = {"randomize_advancement_rounds": None}
    sync_advancement_fields(stage, stage=True)
    assert stage == {"advancement_mode": None, "randomize_advancement_rounds": None}
    stage = {"advancement_mode": "fixed"}
    sync_advancement_fields(stage, stage=True)
    assert stage == {"advancement_mode": "fixed", "randomize_advancement_rounds": False}


def test_show_minutes_default_and_override():
    assert show_minutes_of({}, {}) == 10
    assert show_minutes_of({"draw_show_minutes": 25}, {}) == 25
    assert show_minutes_of({"draw_show_minutes": 25}, {"draw_show_minutes": 3}) == 3
    assert show_minutes_of({"draw_show_minutes": 0}, {}) == 10


def test_build_marks_groups_and_mode_for_every_mixed_mode():
    for mode in ("draw_round", "draw_show", "instant"):
        matches = build(8, "single_elimination", tournament={"advancement_mode": mode})
        keys = by_key(matches)
        assert keys["E"]["settings"]["draw_group"] == keys["F"]["settings"]["draw_group"]
        assert all(m["settings"]["advancement_mode"] == mode for m in matches)
        assert all(m["settings"]["randomize_advancement_rounds"] is True for m in matches)
        assert match_mode(keys["E"]) == mode
    fixed = build(8, "single_elimination")
    assert all(match_mode(m) == "fixed" for m in fixed)
    old = build(8, "single_elimination", tournament={"randomize_advancement_rounds": True})
    assert all(match_mode(m) == "draw_round" for m in old)


# ---------------------------------------------------------------------------------------------- Show-Auslosung

def test_show_round_complete_marks_ready_without_filling():
    matches = build(8, "single_elimination", tournament=SHOW)
    keys = by_key(matches)
    for key in "ABC":
        application = apply(matches, keys[key], lower_seed_wins(keys[key]))
        assert application["draws"] == []
    assert not keys["E"].get("draw_ready")
    last = apply(matches, keys["D"], lower_seed_wins(keys["D"]))
    assert not filled_ids(keys["E"]) and not filled_ids(keys["F"])
    assert keys["E"]["status"] == "pending" and not keys["E"].get("draw")
    ready = keys["E"]["draw_ready"]
    assert ready["since"] == NOW and ready["group"] == keys["E"]["settings"]["draw_group"]
    assert keys["F"]["draw_ready"] == ready
    assert [row["kind"] for row in last["draws"]] == ["ready"]
    assert last["draws"][0]["group"] == ready["group"] and last["draws"][0]["pot_size"] == 4
    assert group_awaits_draw(matches, ready["group"], "s") is True
    # Noch ein Ergebnis (Korrektur) macht die Runde nicht zweimal „bereit“.
    again = apply(matches, keys["D"], list(reversed(lower_seed_wins(keys["D"]))), force=True)
    assert again["draws"] == []
    assert keys["E"]["draw_ready"] == ready


def test_show_draw_application_draws_and_clears_ready():
    matches = build(8, "single_elimination", tournament=SHOW)
    keys = by_key(matches)
    for key in "ABCD":
        apply(matches, keys[key], lower_seed_wins(keys[key]))
    group = keys["E"]["settings"]["draw_group"]
    application = build_show_draw_application(matches, group, now_iso=NOW, trigger="show")
    apply_sets(matches, application)
    winners = {keys[k]["results"][0]["registration_id"] for k in "ABCD"}
    assert set(filled_ids(keys["E"])) | set(filled_ids(keys["F"])) == winners
    assert keys["E"]["status"] == "ready" and keys["F"]["status"] == "ready"
    assert keys["E"]["draw"]["trigger"] == "show" and keys["E"]["draw_ready"] is None
    assert application["draw"]["kind"] == "advancement" and application["draw"]["trigger"] == "show"
    assert {row["registration_id"] for row in application["draw"]["assignments"]} == winners


def test_show_draw_needs_a_ready_round():
    matches = build(8, "single_elimination", tournament=SHOW)
    keys = by_key(matches)
    group = keys["E"]["settings"]["draw_group"]
    with pytest.raises(MatchV2ResultError) as too_early:
        build_show_draw_application(matches, group, now_iso=NOW)
    assert too_early.value.status_code == 409
    for key in "ABCD":
        apply(matches, keys[key], lower_seed_wins(keys[key]))
    apply_sets(matches, build_show_draw_application(matches, group, now_iso=NOW))
    with pytest.raises(MatchV2ResultError) as twice:
        build_show_draw_application(matches, group, now_iso=NOW)
    assert twice.value.status_code == 409
    with pytest.raises(MatchV2ResultError) as unknown:
        build_show_draw_application(matches, "XX:9", now_iso=NOW)
    assert unknown.value.status_code == 404


def test_show_draw_round_does_not_draw_on_its_own():
    """``run_ready_draws`` (Lauf-Umbau, Bau) legt bei Show kein Los - die Runde wird nur „bereit“."""
    matches = build(8, "single_elimination", tournament=SHOW)
    keys = by_key(matches)
    for key in "ABCD":
        apply(matches, keys[key], lower_seed_wins(keys[key]))
    by_id = {m["id"]: m for m in matches}
    draws: list[dict] = []
    assert run_ready_draws(by_id, {}, NOW, draws=draws) == []
    assert draws == []
    assert not filled_ids(keys["E"])


# ---------------------------------------------------------------------------------------------- Sofort zufällig

def test_instant_first_result_lands_immediately_in_the_next_round():
    matches = build(8, "single_elimination", tournament=INSTANT)
    keys = by_key(matches)
    application = apply(matches, keys["A"], ["r1", "r8"])
    seat = seat_of(matches, "r1", 2)
    assert seat and seat[0] in {"E", "F"}
    target = keys[seat[0]]
    slot = next(s for s in target["slots"] if s["registration_id"] == "r1")
    assert slot["source_result"]["from_match_key"] == "A" and slot["source_result"]["draw_id"]
    assert target["status"] == "pending", "halb voll ist nicht spielbereit"
    assert not target.get("draw"), "sofort zufällig kennt kein Los je Gruppe - jeder Platz für sich"
    assert [row["kind"] for row in application["draws"]] == ["instant"]
    draw = application["draws"][0]
    assert draw["assignments"] == [{"match_id": target["id"], "match_key": seat[0], "slot": seat[1], "registration_id": "r1",
                                    "from_match_key": "A", "rank": 1, "flow": "W"}]
    assert draw["id"] == slot["source_result"]["draw_id"] and draw["trigger"] == "result"
    assert group_awaits_draw(matches, keys["E"]["settings"]["draw_group"], "s") is False


def test_instant_assignment_is_uniform_over_the_free_seats():
    landed: Counter = Counter()
    for _ in range(300):
        matches = build(8, "single_elimination", tournament=INSTANT)
        keys = by_key(matches)
        apply(matches, keys["A"], ["r1", "r8"])
        landed[seat_of(matches, "r1", 2)] += 1
    assert set(landed) == {("E", 1), ("E", 2), ("F", 1), ("F", 2)}
    assert min(landed.values()) >= 40, landed


def test_instant_target_is_ready_once_full_and_nobody_sits_twice():
    for seed in range(20):
        matches = build(8, "single_elimination", tournament=INSTANT)
        keys = by_key(matches)
        rng = random.Random(seed)
        for key in "ABCD":
            apply(matches, keys[key], lower_seed_wins(keys[key]), rng=rng)
        winners = {keys[k]["results"][0]["registration_id"] for k in "ABCD"}
        seated = [s["registration_id"] for k in "EF" for s in keys[k]["slots"] if s.get("registration_id")]
        assert sorted(seated) == sorted(winners)
        assert keys["E"]["status"] == "ready" and keys["F"]["status"] == "ready"
        assert all(not keys[k].get("draw") for k in "EF")
        # Das Finale G hat nur zwei Quellen: fester Baum.
        apply(matches, keys["E"], lower_seed_wins(keys["E"]), rng=rng)
        assert filled_ids(keys["G"]) == [keys["E"]["results"][0]["registration_id"]]


def test_instant_target_ready_as_soon_as_its_two_seats_are_taken():
    """Spiel E kann starten, sobald es voll ist - auch wenn in F noch Plätze offen sind."""
    seen_ready_early = False
    for _ in range(60):
        matches = build(8, "single_elimination", tournament=INSTANT)
        keys = by_key(matches)
        apply(matches, keys["A"], lower_seed_wins(keys["A"]))
        apply(matches, keys["B"], lower_seed_wins(keys["B"]))
        statuses = {k: keys[k]["status"] for k in "EF"}
        if "ready" in statuses.values():
            seen_ready_early = True
            full = next(k for k, s in statuses.items() if s == "ready")
            assert len(filled_ids(keys[full])) == 2
            other = "F" if full == "E" else "E"
            assert keys[other]["status"] == "pending" and not filled_ids(keys[other])
    assert seen_ready_early


def test_instant_forfeit_on_winner_path_takes_a_seat_as_bye():
    matches = build(8, "single_elimination", tournament=INSTANT)
    keys = by_key(matches)
    # r8 gewinnt kampflos: r1 nicht erschienen - niemand kommt aus A weiter, der Platz ist ein Freilos.
    apply(matches, keys["A"], ["r8", "r1"], forfeit_last=False)
    assert seat_of(matches, "r8", 2)
    matches = build(8, "single_elimination", tournament=INSTANT)
    keys = by_key(matches)
    apply(matches, keys["A"], ["r1", "r8"], forfeit_last=True)
    assert seat_of(matches, "r1", 2), "der Sieger kommt weiter, der Verlierer hat aufgegeben"
    # Ausgeschieden (#1553): der Sieger ist disqualifiziert - niemand kommt aus A weiter, der gezogene Platz ist ein
    # Freilos mit Los-Kennung.
    matches = build(8, "single_elimination", tournament=INSTANT)
    keys = by_key(matches)
    raw = [{"registration_id": "r1", "rank": 1}, {"registration_id": "r8", "rank": 2}]
    application = build_v2_result_application(keys["A"], matches, raw, actor_id="staff", now_iso=NOW, eliminated={"r1"})
    keys["A"].update(application["match_set"])
    apply_sets(matches, application)
    byes = [(k, s["slot"]) for k in "EF" for s in keys[k]["slots"] if s["status"] == "bye"]
    assert len(byes) == 1
    assert byes[0][0] in {"E", "F"}
    bye = next(s for k in "EF" for s in keys[k]["slots"] if s["status"] == "bye")
    assert bye["source_result"]["from_match_key"] == "A" and bye["source_result"]["reason"] == "eliminated"
    assert bye["source_result"]["draw_id"]
    assert [row["kind"] for row in application["draws"]] == ["instant"]
    assert application["draws"][0]["assignments"][0]["registration_id"] is None


def test_instant_correction_keeps_the_seat_and_swaps_the_person():
    matches = build(8, "single_elimination", tournament=INSTANT)
    keys = by_key(matches)
    apply(matches, keys["A"], ["r1", "r8"])
    before = seat_of(matches, "r1", 2)
    draw_id = next(s for k in "EF" for s in keys[k]["slots"] if s.get("registration_id") == "r1")["source_result"]["draw_id"]
    correction = apply(matches, keys["A"], ["r8", "r1"], force=True)
    assert seat_of(matches, "r8", 2) == before
    assert seat_of(matches, "r1", 2) is None
    slot = next(s for k in "EF" for s in keys[k]["slots"] if s.get("registration_id") == "r8")
    assert slot["source_result"]["draw_id"] == draw_id, "Platz bleibt, Person wird getauscht - kein neues Los"
    assert correction["draws"] == []


def test_instant_redraw_touches_only_targets_that_have_not_started():
    matches = build(16, "single_elimination", tournament=INSTANT)
    keys = by_key(matches)
    rng = random.Random(7)
    for key in "ABCDEFGH":
        apply(matches, keys[key], lower_seed_wins(keys[key]), rng=rng)
    group = keys["I"]["settings"]["draw_group"]
    round2 = [m for m in matches if m["round"] == 2]
    assert all(m["status"] == "ready" for m in round2)
    started = round2[0]
    started["status"] = "in_progress"
    started["started_at"] = NOW
    before = {m["match_key"]: filled_ids(m) for m in round2}
    seen_change = False
    for attempt in range(30):
        snapshot = [dict(m, slots=[dict(s) for s in m["slots"]]) for m in matches]
        application = build_redraw_application(snapshot, group, now_iso=NOW, rng=random.Random(attempt))
        rows = {m["match_key"]: m for m in snapshot}
        assert started["id"] not in application["target_sets"]
        assert filled_ids(rows[started["match_key"]]) == before[started["match_key"]]
        others = [m for m in round2 if m is not started]
        pool = sorted(reg for m in others for reg in before[m["match_key"]])
        assert sorted(reg for m in others for reg in filled_ids(rows[m["match_key"]])) == pool
        assert all(rows[m["match_key"]]["status"] == "ready" for m in others)
        assert application["draw"]["kind"] == "instant" and application["draw"]["trigger"] == "redraw"
        assert len(application["draw"]["assignments"]) == 6
        if any(filled_ids(rows[m["match_key"]]) != before[m["match_key"]] for m in others):
            seen_change = True
    assert seen_change
    for match in round2:
        match["status"] = "in_progress"
    with pytest.raises(MatchV2ResultError) as refused:
        build_redraw_application(matches, group, now_iso=NOW)
    assert refused.value.status_code == 409


def test_instant_run_ready_draws_never_draws_a_group():
    matches = build(8, "single_elimination", tournament=INSTANT)
    keys = by_key(matches)
    for key in "ABC":
        apply(matches, keys[key], lower_seed_wins(keys[key]))
    by_id = {m["id"]: m for m in matches}
    draws: list[dict] = []
    assert run_ready_draws(by_id, {}, NOW, draws=draws) == []
    assert draws == []


# ---------------------------------------------------------------------------------------------- Planer

def test_prerequisites_instant_fill_targets_in_key_order_with_sources_in_key_order():
    """Prognose, keine Festlegung: Zielspiele in Schlüssel-Reihenfolge füllen sich mit den Quellen in
    Schlüssel-Reihenfolge - E wartet auf A und B, F auf C und D. Schon besetzte Plätze und entschiedene Quellen zählen
    nicht mehr mit."""
    matches = build(8, "single_elimination", tournament=INSTANT)
    keys = by_key(matches)
    ids = {k: keys[k]["id"] for k in keys}
    assert prerequisite_ids(keys["E"], matches) == {ids["A"], ids["B"]}
    assert prerequisite_ids(keys["F"], matches) == {ids["C"], ids["D"]}
    # Das Finale G hat keine Gruppe: fester Baum wie immer.
    assert prerequisite_ids(keys["G"], matches) == {ids["E"], ids["F"]}
    apply(matches, keys["C"], lower_seed_wins(keys["C"]))
    landed = seat_of(matches, keys["C"]["results"][0]["registration_id"], 2)[0]
    # Offen sind noch A, B, D (in dieser Reihenfolge); E füllt sich zuerst, F mit dem Rest.
    if landed == "E":
        assert prerequisite_ids(keys["E"], matches) == {ids["A"]}
        assert prerequisite_ids(keys["F"], matches) == {ids["B"], ids["D"]}
    else:
        assert prerequisite_ids(keys["E"], matches) == {ids["A"], ids["B"]}
        assert prerequisite_ids(keys["F"], matches) == {ids["D"]}


def test_prerequisites_show_and_round_wait_for_all_sources():
    for mode in ("draw_round", "draw_show"):
        matches = build(8, "single_elimination", tournament={"advancement_mode": mode})
        keys = by_key(matches)
        assert prerequisite_ids(keys["E"], matches) == {keys[k]["id"] for k in "ABCD"}


T0 = datetime(2026, 10, 31, 10, 0, tzinfo=timezone.utc)


def plan_for(matches: list[dict]) -> dict:
    tournament = {"id": "t", "format": "single_elim", "event_mode": "local", "schedule_mode": "fixed_by_staff",
                  "start_date": T0.isoformat(), "match_duration_minutes": 30}
    stations = [{"id": f"st-{n}", "name": f"Station {n}", "tournament_id": "t", "status": "free", "current_match_id": None}
                for n in (1, 2, 3)]
    result = plan_schedule(tournament, matches, stations, now=T0)
    by_id = {m["id"]: m["match_key"] for m in matches}
    return {by_id[item["match_id"]]: item for item in result["assignments"]}


def test_planner_instant_schedules_each_target_after_its_forecast_sources():
    """Drei Stationen: A, B, C sofort, D danach. Sofort zufällig: E wartet laut Prognose nur auf A und B, F auf C
    und D - E kann vor dem Ende von D beginnen."""
    pause = timedelta(minutes=DEFAULT_BREAK_MINUTES)
    got = plan_for(build(8, "single_elimination", tournament=INSTANT))
    at = {key: datetime.fromisoformat(item["scheduled_at"]) for key, item in got.items()}
    assert at["D"] == T0 + timedelta(minutes=30)
    assert at["E"] < at["D"] + timedelta(minutes=30) + pause
    assert at["F"] >= at["D"] + timedelta(minutes=30) + pause
    assert got["E"]["forecast"] is True and got["E"]["waiting_for_draw"] is False


def test_planner_marks_show_round_as_waiting_for_the_draw():
    matches = build(8, "single_elimination", tournament=SHOW)
    got = plan_for(matches)
    assert got["E"]["waiting_for_draw"] is True and got["E"]["draw_ready"] is False
    assert got["A"]["waiting_for_draw"] is False
    keys = by_key(matches)
    for key in "ABCD":
        apply(matches, keys[key], lower_seed_wins(keys[key]))
    got = plan_for(matches)
    assert got["E"]["waiting_for_draw"] is True and got["E"]["draw_ready"] is True
    group = keys["E"]["settings"]["draw_group"]
    apply_sets(matches, build_show_draw_application(matches, group, now_iso=NOW))
    got = plan_for(matches)
    assert got["E"]["waiting_for_draw"] is False and got["E"]["draw_ready"] is False
    fixed = plan_for(build(8, "single_elimination"))
    assert fixed["E"]["waiting_for_draw"] is False


# ---------------------------------------------------------------------------------------------- Codex-Prüfung (PR #1600)

def _assert_schema_follows_the_draw(matches: list[dict]) -> None:
    """Sofort zufällig: jeder gezogene Platz trägt die Identität seines Zubringers, und dessen Weiterleitung zeigt genau
    auf diesen Platz - sonst leert ein späteres Nachrücken einen fremden Platz."""
    by_id = {m["id"]: m for m in matches}
    for target in matches:
        if not (target.get("settings") or {}).get("draw_group"):
            continue
        for slot in target["slots"]:
            origin = slot.get("source_result") or {}
            if not origin.get("from_match_id"):
                continue
            source = by_id[origin["from_match_id"]]
            identity = slot["source"]
            assert identity["match_key"] == source["match_key"] and identity["flow"] == origin["flow"], (target["match_key"], slot["slot"])
            entry = next((e for e in source["advancement"] if e["flow"] == origin["flow"] and int(e["rank"]) == int(identity["rank"])), None)
            assert entry and entry["to_match_id"] == target["id"] and int(entry["to_slot"]) == int(slot["slot"]), (target["match_key"], slot["slot"])


@pytest.mark.parametrize("kind", ["duel", "ffa"])
def test_instant_redraw_rewires_schema_and_a_later_dq_frees_the_right_seat(kind):
    """Codex-Befund: „Neu auslosen“ bei sofort zufällig muss Weiterleitungen und Platz-Quellen mitziehen. Danach
    Disqualifikation eines Weiterkommers aus Runde 1: genau sein Platz wird frei (Duell: der Wartende kommt kampflos
    weiter; Lauf: der Nächste rückt auf diesen Platz), niemand geht verloren, der Graph bleibt gültig."""
    from services.competition_graph_validation import validate_competition_graph
    from services.competition_snapshot import build_structure_snapshot
    from services.tournament_events import plan_removal

    def valid(rows):
        report = validate_competition_graph(build_structure_snapshot("t", stage_matches=rows))
        assert report["valid"], [i for i in report["issues"] if i["severity"] == "error"]

    for attempt in range(6):
        if kind == "duel":
            matches = build(16, "single_elimination", tournament=INSTANT)
            first_round = "ABCDEFGH"
        else:
            matches = build(12, "ffa_custom_bracket", "ffa", settings={"match_size": 4, "qualifiers_per_match": 2, "min_players": 2},
                            tournament=INSTANT)
            first_round = "ABC"
        keys = by_key(matches)
        rng = random.Random(attempt)
        for key in first_round:
            apply(matches, keys[key], lower_seed_wins(keys[key]), rng=rng)
        group = next(m for m in matches if m["round"] == 2)["settings"]["draw_group"]
        before = {m["match_key"]: filled_ids(m) for m in matches if m["round"] == 2}
        application = build_redraw_application(matches, group, now_iso=NOW, rng=random.Random(100 + attempt))
        apply_sets(matches, application)
        _assert_schema_follows_the_draw(matches)
        # Die Quellen schreiben ihre umgehängten Weiterleitungen mit - sonst zeigt die Datenbank auf alte Plätze.
        rewired = [m for m in matches if m["round"] == 1 and m["id"] in application["target_sets"]]
        assert rewired and all("advancement" in application["target_sets"][m["id"]] for m in rewired)
        if any(filled_ids(m) != before[m["match_key"]] for m in matches if m["round"] == 2):
            break
    else:
        pytest.fail("sechs Neuauslosungen ohne Änderung - das Los steht")
    valid(matches)
    ranked = [row["registration_id"] for row in keys["A"]["results"]]
    winner, second, third = ranked[0], ranked[1], (ranked[2] if len(ranked) > 2 else None)
    seat_before = seat_of(matches, winner, 2)
    second_seat_before = seat_of(matches, second, 2)
    assert seat_before
    others = {s["registration_id"] for m in matches if m["round"] == 2 for s in m["slots"] if s.get("registration_id")} - {winner}
    plan_removal(matches, winner, kind="disqualified", now_iso=NOW)
    assert seat_of(matches, winner, 2) is None
    target = keys[seat_before[0]]
    freed = next(s for s in target["slots"] if int(s["slot"]) == seat_before[1])
    if kind == "duel":
        # K.-o.: der Platz ist ein Freilos mit Grund, der Wartende kommt kampflos weiter.
        assert freed["status"] == "bye" and freed["source_result"]["removed_registration_id"] == winner
        assert target["status"] == "completed" and (target.get("result_meta") or {}).get("source") == "auto_bye"
    else:
        # Lauf: Plätze rücken auf - der Zweite aus A übernimmt genau diesen Platz, der Dritte den Platz des Zweiten.
        assert freed["registration_id"] == second and seat_of(matches, second, 2) == seat_before
        assert seat_of(matches, third, 2) == second_seat_before
    seated = [s["registration_id"] for m in matches if m["round"] == 2 for s in m["slots"] if s.get("registration_id")]
    assert others <= set(seated) and len(seated) == len(set(seated)), "niemand geht verloren, niemand sitzt doppelt"
    _assert_schema_follows_the_draw(matches)
    valid(matches)


def test_structure_plan_hash_stays_the_same_for_old_tournaments():
    """Vor dem Deploy erzeugte Pläne: fehlender Modus, None oder ``fixed`` ergeben denselben Eingabe-Hash wie vorher;
    der alte Schalter zählt wie bisher. Erst ein neuer Modus (Show, sofort) ändert den Hash."""
    from services.competition_structure_plan import structure_plan_seed

    def seed(**fields):
        return structure_plan_seed({"id": "t", "format": "single_elim", "max_participants": 8, **fields}, {"preview": False}, [], {})["input_hash"]

    assert seed() == seed(advancement_mode=None) == seed(advancement_mode="fixed")
    assert seed(randomize_advancement_rounds=True) == seed(randomize_advancement_rounds=True, advancement_mode="draw_round")
    assert seed(advancement_mode="instant", randomize_advancement_rounds=True) != seed(randomize_advancement_rounds=True)
    assert seed(advancement_mode="draw_show", randomize_advancement_rounds=True) != seed(advancement_mode="instant", randomize_advancement_rounds=True)
    # Der feste Baum schreibt keinen Modus an die Spiele - ein alter Plan bleibt beim Anwenden gleich.
    fixed = build(8, "single_elimination")
    assert all("advancement_mode" not in m["settings"] for m in fixed)
    assert all(match_mode(m) == "fixed" for m in fixed)
