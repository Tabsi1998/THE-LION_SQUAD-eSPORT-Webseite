"""Gegner mischen (#1548) mit Lauf-Umbau (#1550) und Spielplaner (#1552).

Reihenfolge: erst auslosen, dann umbauen. Vor der Auslosung zählen die Plätze der Folgerunde als lieferbar, solange
ihre Quellen liefern können (offen oder schon entschieden) - kein vorzeitiges Zusammenlegen. Nach der Auslosung baut der
Umbau wie immer um, wenn Fahrer ausfallen. Der Planer plant eine gemischte Folgerunde erst nach **allen** Spielen der
Runde davor.
"""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.custom_bracket import build_matches_v2_from_schema  # noqa: E402
from services.heat_rebuild import rebuild_heats, stage_heat_rules  # noqa: E402
from services.match_scheduler import DEFAULT_BREAK_MINUTES, plan_schedule  # noqa: E402
from services.match_v2_results import build_v2_result_application  # noqa: E402

NOW = "2026-10-31T10:00:00+00:00"
SHUFFLE = {"randomize_advancement_rounds": True}

THIRTY_TWO = """[WB]
# Runde 1
A=[1,2,3,4]
B=[5,6,7,8]
C=[9,10,11,12]
D=[13,14,15,16]
E=[17,18,19,20]
F=[21,22,23,24]
G=[25,26,27,28]
H=[29,30,31,32]
# Runde 2
I=[W:A:1,W:A:2,W:B:1,W:B:2]
J=[W:C:1,W:C:2,W:D:1,W:D:2]
K=[W:E:1,W:E:2,W:F:1,W:F:2]
L=[W:G:1,W:G:2,W:H:1,W:H:2]
# Halbfinale
M=[W:I:1,W:I:2,W:J:1,W:J:2]
N=[W:K:1,W:K:2,W:L:1,W:L:2]
# Finale
O=[W:M:1,W:M:2,W:N:1,W:N:2]
"""


def registrations(count: int) -> list[dict]:
    return [{"id": f"r{i}", "user_id": f"u{i}", "status": "approved", "seed": i} for i in range(1, count + 1)]


def build_ffa(count: int = 32) -> tuple[list[dict], dict]:
    stage = {"id": "s", "number": 1, "stage_type": "ffa_custom_bracket", "match_type": "ffa",
             "settings": {"match_size": 4, "qualifiers_per_match": 2, "min_players": 2, "schema": THIRTY_TWO}}
    tournament = {"id": "t", "seeding_mode": "manual", "max_participants": count, **SHUFFLE}
    return build_matches_v2_from_schema(tournament, stage, registrations(count)), stage


def keys(matches: list[dict]) -> dict[str, dict]:
    return {m["match_key"]: m for m in matches}


def filled(match: dict) -> list[str]:
    return [s["registration_id"] for s in match["slots"] if s.get("status") == "filled" and s.get("registration_id")]


def play(matches: list[dict], match: dict) -> dict:
    ranking = sorted(filled(match), key=lambda reg: int(reg[1:]))
    raw = [{"registration_id": reg, "rank": index + 1} for index, reg in enumerate(ranking)]
    application = build_v2_result_application(match, matches, raw, actor_id="staff", now_iso=NOW)
    match.update(application["match_set"])
    rows = {row["id"]: row for row in matches}
    for target_id, update in application["target_sets"].items():
        rows[target_id].update(update)
    return application


def rebuild(matches: list[dict], stage: dict, **kwargs) -> dict:
    return rebuild_heats(matches, now_iso=NOW, **stage_heat_rules(stage, matches), **kwargs)


def withdraw(match: dict, count: int) -> None:
    """Fahrer fallen aus: ihr Platz wird frei (wie ein Austritt nach der Auslosung)."""
    for slot in [s for s in match["slots"] if s.get("status") == "filled"][:count]:
        slot.update({"registration_id": None, "user_id": None, "status": "bye"})


# ---------------------------------------------------------------------------------------------- Lauf-Umbau

def test_no_rebuild_before_the_draw_while_part_of_the_round_is_done():
    matches, stage = build_ffa()
    k = keys(matches)
    play(matches, k["A"])
    play(matches, k["B"])
    assert not filled(k["I"]), "I wartet auf die Auslosung"
    before = {key: (m["status"], [dict(s) for s in m["slots"]]) for key, m in k.items() if key in "IJKL"}
    for structural in (False, True):
        result = rebuild(matches, stage, structural=structural)
        assert result["ops"] == [], result["ops"]
        assert result.get("draws") == []
    assert {key: (k[key]["status"], k[key]["slots"]) for key in "IJKL"} == before
    assert all(k[key]["status"] == "pending" for key in "IJKL")


def test_after_the_draw_dropouts_are_rebuilt_as_usual():
    matches, stage = build_ffa()
    k = keys(matches)
    for key in "ABCDEFGH":
        play(matches, k[key])
    assert all(len(filled(k[key])) == 4 for key in "IJKL"), "ausgelost: vier je Lauf"
    withdraw(k["I"], 2)
    withdraw(k["J"], 2)
    result = rebuild(matches, stage, structural=True)
    merged = [op for op in result["ops"] if op["kind"] == "merged"]
    assert merged, result["ops"]
    survivors = [k[key] for key in "IJ" if k[key]["status"] != "cancelled"]
    assert len(survivors) == 1 and len(filled(survivors[0])) == 4
    # Danach läuft der Baum bis zum Ende durch.
    for _ in range(50):
        ready = [m for m in matches if m["status"] == "ready"]
        if not ready:
            break
        play(matches, ready[0])
        rebuild(matches, stage, structural=True)
    assert not [m["match_key"] for m in matches if m["status"] not in {"completed", "forfeit", "cancelled"}]
    # Das Finale (O oder, abgekürzt, ein Halbfinale ohne Folgespiel) ist gespielt.
    assert any(m["status"] == "completed" and not m.get("advancement") and m["round"] > 2 for m in matches)


def test_rebuild_that_closes_the_round_draws_and_reports_it():
    """Der letzte offene Lauf der Runde ist leer (alle ausgefallen): der Umbau sagt ihn ab - damit ist die Runde fertig
    und die Folgerunde wird ausgelost, mit Protokoll-Daten in ``draws``."""
    matches, stage = build_ffa()
    k = keys(matches)
    for key in "ABCDEFG":
        play(matches, k[key])
    withdraw(k["H"], 4)
    result = rebuild(matches, stage, structural=False)
    assert k["H"]["status"] == "cancelled"
    assert len(result["draws"]) == 1
    assert all(k[key].get("draw") for key in "IJKL")
    seated = [reg for key in "IJKL" for reg in filled(k[key])]
    assert len(seated) == 14 and len(set(seated)) == 14


# ---------------------------------------------------------------------------------------------- Spielplaner

T0 = datetime(2026, 10, 31, 10, 0, tzinfo=timezone.utc)


def local_duels(shuffle: bool) -> list[dict]:
    tournament = {"id": "t1", "seeding_mode": "manual", "max_participants": 8, **(SHUFFLE if shuffle else {})}
    stage = {"id": "s1", "number": 1, "stage_type": "single_elimination", "match_type": "duel", "settings": {}}
    return build_matches_v2_from_schema(tournament, stage, registrations(8))


def plan(matches: list[dict]) -> dict[str, datetime]:
    tournament = {"id": "t1", "format": "single_elim", "event_mode": "local", "schedule_mode": "fixed_by_staff",
                  "start_date": T0.isoformat(), "match_duration_minutes": 30}
    stations = [{"id": f"st-{n}", "name": f"Station {n}", "tournament_id": "t1", "status": "free", "current_match_id": None}
                for n in (1, 2, 3)]
    result = plan_schedule(tournament, matches, stations, now=T0)
    by_id = {m["id"]: m["match_key"] for m in matches}
    return {by_id[item["match_id"]]: datetime.fromisoformat(item["scheduled_at"]) for item in result["assignments"]}


def test_planner_waits_for_the_whole_round_when_shuffled():
    pause = timedelta(minutes=DEFAULT_BREAK_MINUTES)
    fixed = plan(local_duels(False))
    # Drei Stationen: A, B, C sofort, D danach. Fester Baum: E wartet nur auf A und B.
    assert fixed["D"] == T0 + timedelta(minutes=30)
    assert fixed["E"] < fixed["D"] + timedelta(minutes=30) + pause
    shuffled = plan(local_duels(True))
    end_of_round = shuffled["D"] + timedelta(minutes=30)
    assert shuffled["E"] >= end_of_round + pause, "gemischt wartet E auf die ganze Runde 1"
    assert shuffled["F"] >= end_of_round + pause


def test_no_premature_final_while_winners_wait_for_the_draw():
    """Gefunden in der Simulation: 10 Fahrer, Läufe zu 3, einer kommt weiter. Sind A, C und D fertig und B läuft noch,
    warten drei Weiterkommer auf die Auslosung - B hat nicht „alle Verbliebenen“ und wird nicht zum Finale."""
    stage = {"id": "s", "number": 1, "stage_type": "ffa_custom_bracket", "match_type": "ffa",
             "settings": {"match_size": 3, "qualifiers_per_match": 1, "min_players": 2}}
    tournament = {"id": "t", "seeding_mode": "manual", "max_participants": 10, **SHUFFLE}
    matches = build_matches_v2_from_schema(tournament, stage, registrations(10))
    k = keys(matches)
    for key in "CDA":
        play(matches, k[key])
    result = rebuild(matches, stage, structural=True)
    assert result["ops"] == [], [op.get("text") for op in result["ops"]]
    assert k["B"]["advancement"], "B bleibt ein Vorlauf"
    assert all(k[key]["status"] == "pending" and not k[key].get("draw") for key in "EF")
    play(matches, k["B"])
    assert all(len(filled(k[key])) == 2 for key in "EF")


def test_no_rebalance_of_the_next_round_before_the_draw():
    """Kleine Vorläufe schicken weniger weiter (Quote): ungleich erwartete Folgeläufe gleicht erst das Los aus - der
    Umbau rührt sie vor der Auslosung nicht an (erst auslosen, dann umbauen)."""
    matches, stage = build_ffa()
    k = keys(matches)
    withdraw(k["A"], 2)
    withdraw(k["B"], 2)
    # Nur die Automatik (Modus „Vorschlag“, nichts bestätigt): A und B schicken je einen weiter.
    rebuild(matches, stage, structural=False)
    assert k["A"]["settings"]["qualifiers_per_match"] == 1 and k["B"]["settings"]["qualifiers_per_match"] == 1
    for key in "ABCDEFG":
        play(matches, k[key])
    result = rebuild(matches, stage, structural=True)
    assert not [op for op in result["ops"] if set(op.get("heats") or []) & set("IJKLMNO")], result["ops"]
    assert all(k[key]["status"] == "pending" and not k[key].get("draw") for key in "IJKL")
    play(matches, k["H"])
    assert all(k[key].get("draw") for key in "IJKL")
    # Das Los verteilt auf die Plätze, die beliefert werden (A und B schicken je nur einen); danach gleicht der Umbau
    # die Läufe mit demselben Ziel aus - wie bei jedem anderen Ausfall.
    result = rebuild(matches, stage, structural=True)
    assert [op["kind"] for op in result["ops"]] == ["rebalanced"], result["ops"]
    seated = {key: len(filled(k[key])) for key in "IJKL"}
    assert sum(seated.values()) == 14
    assert abs(seated["I"] - seated["J"]) <= 1 and abs(seated["K"] - seated["L"]) <= 1


# ---------------------------------------------------------------------------------------------- Austritt (#1553)

def test_forfeit_on_the_winner_path_is_a_bye_in_the_draw():
    """Wer nicht erschienen ist, kommt auf dem Sieger-Weg nicht weiter - auch gemischt nicht."""
    matches, _stage = build_ffa()
    k = keys(matches)
    # Lauf A mit zwei Fahrern und Quote zwei: der Zweite ist nicht erschienen.
    withdraw(k["A"], 2)
    ranking = sorted(filled(k["A"]), key=lambda reg: int(reg[1:]))
    raw = [{"registration_id": reg, "rank": index + 1, "forfeit": index == 1} for index, reg in enumerate(ranking)]
    application = build_v2_result_application(k["A"], matches, raw, actor_id="staff", now_iso=NOW)
    k["A"].update(application["match_set"])
    for key in "BCDEFGH":
        play(matches, k[key])
    seated = {reg for key in "IJKL" for reg in filled(k[key])}
    assert ranking[1] not in seated, "nicht erschienen - nicht weiter"
    assert ranking[0] in seated and len(seated) == 15


def test_removed_winner_before_the_draw_is_not_drawn():
    from services.tournament_events import plan_removal

    stage = {"id": "s", "number": 1, "stage_type": "single_elimination", "match_type": "duel", "settings": {}}
    matches = build_matches_v2_from_schema({"id": "t", "seeding_mode": "manual", "max_participants": 8, **SHUFFLE},
                                           stage, registrations(8))
    k = keys(matches)
    for key in "ABC":
        play(matches, k[key])
    gone = k["A"]["results"][0]["registration_id"]
    plan_removal(matches, gone, kind="withdrawn", now_iso=NOW)
    assert not any(filled(k[key]) for key in "EF"), "die Runde wartet weiter auf die Auslosung"
    play(matches, k["D"])
    seated = {reg for key in "EF" for reg in filled(k[key])}
    assert gone not in seated and len(seated) == 3
    walkovers = [k[key] for key in "EF" if k[key]["status"] == "completed"]
    assert len(walkovers) == 1 and walkovers[0]["result_meta"]["source"] == "auto_bye"


def test_removed_qualifier_before_the_draw_lets_the_next_move_up():
    from services.tournament_events import plan_removal

    matches, _stage = build_ffa()
    k = keys(matches)
    for key in "ABCDEFG":
        play(matches, k[key])
    order = [row["registration_id"] for row in k["A"]["results"]]
    plan_removal(matches, order[0], kind="disqualified", now_iso=NOW)
    assert not any(filled(k[key]) for key in "IJKL")
    play(matches, k["H"])
    seated = {reg for key in "IJKL" for reg in filled(k[key])}
    assert order[0] not in seated
    assert {order[1], order[2]} <= seated, "Platz 3 aus A rückt nach"
    assert len(seated) == 16


def test_removed_qualifier_after_the_draw_hands_the_drawn_seat_to_the_next():
    from services.tournament_events import plan_removal

    matches, _stage = build_ffa()
    k = keys(matches)
    for key in "ABCDEFGH":
        play(matches, k[key])
    order = [row["registration_id"] for row in k["A"]["results"]]
    seat_of = {reg: (key, slot["slot"]) for key in "IJKL" for slot in k[key]["slots"] if (reg := slot.get("registration_id"))}
    before = dict(seat_of)
    plan_removal(matches, order[0], kind="withdrawn", now_iso=NOW)
    after = {reg: (key, slot["slot"]) for key in "IJKL" for slot in k[key]["slots"] if (reg := slot.get("registration_id"))}
    assert order[0] not in after
    assert order[2] in after, "Platz 3 aus A rückt in einen ausgelosten Platz von A"
    assert {after[order[1]], after[order[2]]} == {before[order[0]], before[order[1]]}
    for reg, seat in before.items():
        if reg not in order[:2]:
            assert after[reg] == seat, "alle anderen bleiben, wo das Los sie hingesetzt hat"


# ---------------------------------------------------------------------------------------------- Mehrere Phasen
# Zwei gemischte K.-o.-Phasen haben dieselben Gruppen-Namen (``WB:2``): eine Auslosung gehört immer zu genau einer
# Phase - ihr Topf, ihre Folgespiele und ihr Protokoll-Eintrag (``stage_id``).


def phase(stage_id: str, number: int, prefix: str, count: int = 8, stage_type: str = "single_elimination",
          *, plan: bool = False) -> list[dict]:
    """Eine gemischte Phase; ``plan``: gebaut wie im Strukturplan - ohne Los, gelost wird beim Anwenden."""
    stage = {"id": stage_id, "number": number, "stage_type": stage_type, "match_type": "duel", "settings": {}}
    regs = [{"id": f"{prefix}{i}", "user_id": f"u{prefix}{i}", "status": "approved", "seed": i}
            for i in range(1, count + 1)]
    tournament = {"id": "t", "seeding_mode": "manual", "max_participants": count, **SHUFFLE}
    return build_matches_v2_from_schema(tournament, stage, regs, defer_draws=plan)


def decided_at_build(match: dict) -> None:
    """Runde schon entschieden, wenn der Plan angewendet wird (wie eine Runde nur aus Freilosen)."""
    ranking = sorted(filled(match), key=lambda reg: int(reg[1:]))
    match["results"] = [{"registration_id": reg, "rank": index + 1} for index, reg in enumerate(ranking)]
    match["status"] = "completed"


def seated(rows: dict[str, dict], names: str) -> set[str]:
    return {reg for key in names for reg in filled(rows[key])}


def test_structure_plan_draws_each_phase_from_its_own_pot():
    from services.match_v2_results import apply_deferred_draws

    first, second = phase("s1", 1, "a", plan=True), phase("s2", 2, "b", plan=True)
    assert {m["settings"].get("draw_group") for m in first + second if m["match_key"] in "EF"} == {"WB:2"}
    for match in first + second:
        if match["round"] == 1:
            decided_at_build(match)
    draws = apply_deferred_draws(first + second, now_iso=NOW)
    assert sorted(draw["stage_id"] for draw in draws) == ["s1", "s2"], "ein Protokoll-Eintrag je Phase"
    for draw in draws:
        prefix = "a" if draw["stage_id"] == "s1" else "b"
        assert draw["group"] == "WB:2"
        assert {row["registration_id"][0] for row in draw["assignments"]} == {prefix}
    for rows in (keys(first), keys(second)):
        winners = {rows[key]["results"][0]["registration_id"] for key in "ABCD"}
        assert seated(rows, "EF") == winners, "nur die eigenen Weiterkommer"
        assert rows["E"]["draw"]["id"] == rows["F"]["draw"]["id"]
    assert keys(first)["E"]["draw"]["id"] != keys(second)["E"]["draw"]["id"]


def test_structure_plan_draws_a_finished_phase_without_waiting_for_the_other():
    from services.match_v2_results import apply_deferred_draws

    first, second = phase("s1", 1, "a", plan=True), phase("s2", 2, "b", plan=True)
    for match in first:
        if match["round"] == 1:
            decided_at_build(match)
    draws = apply_deferred_draws(first + second, now_iso=NOW)
    assert [draw["stage_id"] for draw in draws] == ["s1"]
    assert len(seated(keys(first), "EF")) == 4
    assert not seated(keys(second), "EF") and not any(keys(second)[key].get("draw") for key in "EF")


def test_structure_plan_draws_two_shuffled_leagues_apart():
    from services.match_v2_results import apply_deferred_draws

    first = phase("s1", 1, "a", count=4, stage_type="league", plan=True)
    second = phase("s2", 2, "b", count=4, stage_type="league", plan=True)
    draws = apply_deferred_draws(first + second, now_iso=NOW)
    assert sorted(draw["stage_id"] for draw in draws) == ["s1", "s2"]
    for rows in (first, second):
        assert len({m["draw"]["id"] for m in rows}) == 1
        assert {m["round"] for m in rows} == set(range(1, 7)), "Spieltage je Phase ab 1 (Hin- und Rückrunde)"


def test_group_helpers_stay_inside_their_phase():
    from services.advancement_draw import group_sources, group_targets, prerequisite_ids
    from services.match_v2_results import group_awaits_draw

    first, second = phase("s1", 1, "a"), phase("s2", 2, "b")
    both = first + second
    a, b = keys(first), keys(second)
    assert prerequisite_ids(a["E"], both) == {a[key]["id"] for key in "ABCD"}
    assert {m["id"] for m in group_targets(both, "WB:2", stage_id="s2")} == {b["E"]["id"], b["F"]["id"]}
    assert {m["id"] for m in group_sources(both, "WB:2", stage_id="s1")} == {a[key]["id"] for key in "ABCD"}
    for key in "ABCD":
        play(second, b[key])
    assert b["E"].get("draw") and not a["E"].get("draw")
    assert group_awaits_draw(both, "WB:2", stage_id="s1") is True
    assert group_awaits_draw(both, "WB:2", stage_id="s2") is False


def test_result_over_all_phases_draws_only_its_own_phase():
    """Der Ergebnis-Weg über alle Spiele des Turniers (z. B. Wertung beim Austritt): fertig ist nur Phase 1."""
    first, second = phase("s1", 1, "a"), phase("s2", 2, "b")
    both = first + second
    for key in "ABC":
        play(both, keys(first)[key])
    last = play(both, keys(first)["D"])
    assert [draw["stage_id"] for draw in last["draws"]] == ["s1"]
    assert len(seated(keys(first), "EF")) == 4 and not seated(keys(second), "EF")


def test_removed_winner_waits_for_the_draw_of_its_own_phase():
    """Austritt vor der Auslosung (#1553) - auch wenn die gleichnamige Runde der anderen Phase schon ausgelost ist."""
    from services.tournament_events import plan_removal

    first, second = phase("s1", 1, "a"), phase("s2", 2, "b")
    a, b = keys(first), keys(second)
    for key in "ABCD":
        play(second, b[key])
    for key in "ABC":
        play(first, a[key])
    gone = a["A"]["results"][0]["registration_id"]
    plan = plan_removal(first + second, gone, kind="withdrawn", now_iso=NOW)
    assert any(op["kind"] == "draw_excluded" for op in plan["ops"])
    play(first, a["D"])
    assert gone not in seated(a, "EF") and len(seated(a, "EF")) == 3
