"""Turnierbaum-Generator (#1549): Simulation 2 bis 40 Teilnehmer gegen den echten Generator und Ergebnis-Anwender.

Jeder Baum wird mit zufälligen Ergebnissen (fester Zufallsstart) bis zum Ende durchgespielt. Geprüft wird je Schritt:
kein Teilnehmer steht in zwei spielbereiten Spielen gleichzeitig, am Ende ist jedes Spiel entschieden (gespielt,
Freilos oder „nicht nötig“), das Finale ist erreichbar. Dazu je Format die Regeln aus dem Issue.
"""
import math
import pathlib
import random
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.competition_standings import stage_standings  # noqa: E402
from services.round_labels import round_label  # noqa: E402
from services.custom_bracket import (  # noqa: E402
    _auto_double_elim_schema,
    build_matches_v2_from_schema,
    ffa_heat_plan,
    parse_custom_bracket_schema,
)
from services.match_v2_results import build_v2_result_application  # noqa: E402

NOW = "2026-10-31T10:00:00+00:00"
TERMINAL = {"completed", "forfeit", "cancelled"}
ACTIVE = {"ready", "scheduled", "in_progress", "waiting_result"}


def registrations(count: int) -> list[dict]:
    return [{"id": f"r{i}", "user_id": f"u{i}", "status": "approved", "seed": i} for i in range(1, count + 1)]


def build(count: int, stage_type: str, match_type: str = "duel", settings: dict | None = None, tournament: dict | None = None):
    base = {"id": "t", "seeding_mode": "manual", "max_participants": count, **(tournament or {})}
    stage = {"id": "s", "number": 1, "stage_type": stage_type, "match_type": match_type, "settings": settings or {}}
    return build_matches_v2_from_schema(base, stage, registrations(count))


def filled_ids(match: dict) -> list[str]:
    return [slot["registration_id"] for slot in match["slots"] if slot.get("status") == "filled" and slot.get("registration_id")]


def apply_result(matches: list[dict], match: dict, ranking: list[str]) -> dict:
    raw = [{"registration_id": reg, "rank": index + 1} for index, reg in enumerate(ranking)]
    application = build_v2_result_application(match, matches, raw, actor_id="staff", now_iso=NOW)
    match.update(application["match_set"])
    by_id = {row["id"]: row for row in matches}
    for target_id, update in application["target_sets"].items():
        by_id[target_id].update(update)
    return application


def assert_nobody_twice_ready(matches: list[dict]) -> None:
    seen: dict[str, str] = {}
    for match in matches:
        if match["status"] not in ACTIVE:
            continue
        for reg in filled_ids(match):
            assert reg not in seen, f"{reg} ist in {seen[reg]} und {match['match_key']} gleichzeitig spielbereit"
            seen[reg] = match["match_key"]


def play_through(matches: list[dict], rng: random.Random, *, on_result=None) -> list[tuple[dict, list[str]]]:
    """Spielt alle spielbereiten Spiele in zufälliger Reihenfolge mit zufälligem Ausgang, bis nichts mehr offen ist."""
    history: list[tuple[dict, list[str]]] = []
    assert_nobody_twice_ready(matches)
    for _ in range(10_000):
        ready = [match for match in matches if match["status"] == "ready"]
        if not ready:
            break
        match = rng.choice(ready)
        ranking = filled_ids(match)
        rng.shuffle(ranking)
        apply_result(matches, match, ranking)
        history.append((match, ranking))
        if on_result:
            on_result(match, ranking)
        assert_nobody_twice_ready(matches)
    open_matches = [match["match_key"] for match in matches if match["status"] not in TERMINAL]
    assert not open_matches, f"nicht erreichbar: {open_matches}"
    return history


def section_of(match: dict) -> str:
    return str(match.get("section") or "").upper()


# ---------------------------------------------------------------------------------------------- Single Elimination

@pytest.mark.parametrize("count", range(2, 41))
@pytest.mark.parametrize("bronze", [False, True])
def test_single_elimination_plays_through_for_every_size(count: int, bronze: bool):
    matches = build(count, "single_elimination", tournament={"bronze_match": bronze, "format": "single_elim"})
    play_through(matches, random.Random(count))
    final = max((m for m in matches if section_of(m) in {"WB", "MAIN"}), key=lambda m: m["round"])
    assert final["status"] == "completed"
    rows = stage_standings(matches, registrations(count))
    assert rows[0]["registration_id"] == final["results"][0]["registration_id"]
    if bronze and count >= 4:
        bronze_match = next(m for m in matches if section_of(m) == "BRONZE")
        assert bronze_match["status"] == "completed"
        assert rows[2]["registration_id"] == next(r["registration_id"] for r in bronze_match["results"] if r["rank"] == 1)


def test_bronze_match_with_three_players_keeps_bye_winner_out_of_bronze():
    """Issue: bei 3 Spielern stand der Freilos-Sieger im Finale und im Spiel um Platz 3."""
    matches = build(3, "single_elimination", tournament={"bronze_match": True, "format": "single_elim"})
    by_key = {m["match_key"]: m for m in matches}
    bronze = next(m for m in matches if section_of(m) == "BRONZE")
    assert by_key["A"]["status"] == "completed"
    assert "r1" not in filled_ids(bronze)
    assert bronze["status"] == "pending"
    apply_result(matches, by_key["B"], ["r2", "r3"])
    # Der Verlierer des echten Halbfinales ist Dritter - kampflos, es gibt keinen Gegner.
    assert bronze["status"] == "completed"
    assert bronze["results"][0]["registration_id"] == "r3"
    assert by_key["C"]["status"] == "ready"
    assert set(filled_ids(by_key["C"])) == {"r1", "r2"}


# ---------------------------------------------------------------------------------------------- Double Elimination

def loser_round_of(match: dict) -> int:
    """Die Loser-Runde aus dem Rundennamen („Loser Runde 3“)."""
    name = str(match.get("round_name") or "")
    return int(name.rsplit(" ", 1)[-1]) if name.startswith("Loser Runde") else 0


def earliest_allowed_rematch_round(bracket_size: int) -> int:
    """Per Simulation (scratchpad lb_ordering_sim.py) belegt: Wiedersehen frühestens in Loser-Runde log2(N) -
    bei 8 das Loser-Halbfinale, bei 16 das Loser-Viertelfinale; früher ist es mathematisch nicht vermeidbar."""
    return int(math.log2(bracket_size))


@pytest.mark.parametrize("count", range(2, 41))
@pytest.mark.parametrize("grand_final", ["reset", "single", "none"])
def test_double_elimination_plays_through_for_every_size(count: int, grand_final: str):
    matches = build(count, "double_elimination", tournament={"grand_final_mode": grand_final})
    bracket_size = 2 ** math.ceil(math.log2(max(2, count)))
    met: dict[frozenset, list[dict]] = {}

    def on_result(match, _ranking):
        pair = frozenset(filled_ids(match))
        met.setdefault(pair, []).append(match)

    play_through(matches, random.Random(count * 7 + len(grand_final)), on_result=on_result)

    for pair, rows in met.items():
        for again in rows[1:]:
            if section_of(again) == "GF":
                continue
            assert section_of(again) == "LB"
            assert loser_round_of(again) >= earliest_allowed_rematch_round(bracket_size), \
                f"Wiedersehen {sorted(pair)} schon in {again['round_name']}"

    wb_final = max((m for m in matches if section_of(m) == "WB"), key=lambda m: m["round"])
    lb_matches = [m for m in matches if section_of(m) == "LB"]
    lb_final = max(lb_matches, key=lambda m: m["round"]) if lb_matches else None
    gf_matches = sorted((m for m in matches if section_of(m) == "GF"), key=lambda m: m["round"])
    rows = stage_standings(matches, registrations(count))

    if grand_final == "none":
        assert not gf_matches
        assert rows[0]["registration_id"] == wb_final["results"][0]["registration_id"]
        if lb_final:
            assert rows[1]["registration_id"] == lb_final["results"][0]["registration_id"]
        return

    first = gf_matches[0]
    assert first["status"] == "completed"
    upper = first["slots"][0]["registration_id"]
    assert upper == wb_final["results"][0]["registration_id"], "Platz 1 im Grand Final ist die Siegerrunde"
    champion_of_first = first["results"][0]["registration_id"]
    if grand_final == "single":
        assert len(gf_matches) == 1
        assert rows[0]["registration_id"] == champion_of_first
        return

    assert len(gf_matches) == 2
    reset = gf_matches[1]
    assert reset["settings"]["bracket_reset"]["of_match_key"] == first["match_key"]
    if champion_of_first == upper:
        assert reset["status"] == "cancelled", "Reset nur, wenn die Verliererrunde das erste Finale gewinnt"
        assert reset["result_meta"]["source"] == "bracket_reset"
        assert rows[0]["registration_id"] == upper
    else:
        assert reset["status"] == "completed"
        assert set(filled_ids(reset)) == set(filled_ids(first))
        assert rows[0]["registration_id"] == reset["results"][0]["registration_id"]
        assert rows[1]["registration_id"] == next(r["registration_id"] for r in reset["results"] if r["rank"] == 2)
    if lb_final:
        third = next(r["registration_id"] for r in lb_final["results"] if r["rank"] == 2)
        assert rows[2]["registration_id"] == third


def test_double_elimination_default_is_grand_final_with_reset():
    matches = build(4, "double_elimination")
    assert [m["match_key"] for m in matches if section_of(m) == "GF"] == ["GF", "GFR"]
    assert next(m for m in matches if m["match_key"] == "GFR")["round_name"] == "Grand Final Reset"


def test_reset_match_reads_as_grand_final_reset():
    matches = build(4, "double_elimination")
    by_key = {m["match_key"]: m for m in matches}
    assert round_label(by_key["GF"]) == "Grand Final"
    assert round_label(by_key["GFR"]) == "Grand Final Reset"


def test_double_elimination_stage_setting_overrides_tournament_grand_final():
    matches = build(4, "double_elimination", settings={"grand_final": "single"}, tournament={"grand_final_mode": "reset"})
    assert [m["match_key"] for m in matches if section_of(m) == "GF"] == ["GF"]


def test_double_elimination_bye_winner_does_not_enter_loser_bracket():
    """Issue: bei 5 Spielern waren r2 gegen r3 im Winner- und im Loser-Bracket gleichzeitig spielbereit; bei 6 saß
    Seed 1 im WB-Halbfinale und im LB."""
    for count in (5, 6):
        matches = build(count, "double_elimination")
        assert_nobody_twice_ready(matches)
        lb_players = {reg for m in matches if section_of(m) == "LB" for reg in filled_ids(m)}
        assert not lb_players, f"{count} Spieler: {sorted(lb_players)} sitzen vor dem ersten Spiel im Loser Bracket"
    matches = build(6, "double_elimination")
    wb_semi = [m for m in matches if section_of(m) == "WB" and m["round"] == 2]
    assert any("r1" in filled_ids(m) for m in wb_semi)


def test_double_elimination_bye_in_loser_bracket_walks_over_at_runtime():
    """5 Spieler: das Loser-Spiel neben einem Freilos hat nur einen Gegner - der kommt kampflos weiter."""
    matches = build(5, "double_elimination")
    by_key = {m["match_key"]: m for m in matches}
    apply_result(matches, by_key["B"], ["r4", "r5"])
    lb_with_r5 = [m for m in matches if section_of(m) == "LB" and any(r["registration_id"] == "r5" for r in m.get("results") or [])]
    assert lb_with_r5 and lb_with_r5[0]["status"] == "completed"
    assert lb_with_r5[0]["result_meta"]["source"] == "auto_bye"
    assert_nobody_twice_ready(matches)


def test_double_elimination_grand_final_correction_reopens_reset():
    matches = build(4, "double_elimination")
    by_key = {m["match_key"]: m for m in matches}
    apply_result(matches, by_key["A"], ["r1", "r4"])
    apply_result(matches, by_key["B"], ["r2", "r3"])
    apply_result(matches, by_key["C"], ["r1", "r2"])
    lb = [m for m in matches if section_of(m) == "LB"]
    for match in sorted(lb, key=lambda m: m["round"]):
        apply_result(matches, match, filled_ids(match))
    gf = by_key["GF"]
    assert gf["status"] == "ready"
    upper, lower = filled_ids(gf)
    apply_result(matches, gf, [upper, lower])
    assert by_key["GFR"]["status"] == "cancelled"
    raw = [{"registration_id": lower, "rank": 1}, {"registration_id": upper, "rank": 2}]
    application = build_v2_result_application(gf, matches, raw, actor_id="staff", now_iso=NOW, force=True)
    gf.update(application["match_set"])
    for target_id, update in application["target_sets"].items():
        next(m for m in matches if m["id"] == target_id).update(update)
    assert by_key["GFR"]["status"] == "ready"
    assert filled_ids(by_key["GFR"]) == [lower, upper]


def test_double_elimination_schema_orders_loser_drops_to_avoid_rematches():
    specs = parse_custom_bracket_schema(_auto_double_elim_schema(8))
    by_key = {spec.key: spec for spec in specs}
    # WB Runde 2: E=(A,B), F=(C,D). Loser Runde 2 bekommt die WB-Verlierer gespiegelt: LA (aus A/B) trifft L:F.
    assert [source["match_key"] for source in by_key["LC"].sources] == ["LA", "F"]
    assert [source["match_key"] for source in by_key["LD"].sources] == ["LB", "E"]


# ---------------------------------------------------------------------------------------------- FFA-Läufe

@pytest.mark.parametrize("match_size,qualifiers", [(3, 1), (3, 2), (4, 1), (4, 2), (8, 1), (8, 2)])
@pytest.mark.parametrize("count", range(2, 41))
def test_ffa_bracket_plays_through_balanced_for_every_size(count: int, match_size: int, qualifiers: int):
    matches = build(count, "ffa_custom_bracket", "ffa", settings={"match_size": match_size, "qualifiers_per_match": qualifiers})
    by_round: dict[int, list[dict]] = {}
    for match in matches:
        by_round.setdefault(match["round"], []).append(match)
    for rnd, heats in by_round.items():
        sizes = [len(m["slots"]) for m in heats]
        assert max(sizes) <= match_size, f"Runde {rnd}: Lauf größer als {match_size}"
        assert max(sizes) - min(sizes) <= 1, f"Runde {rnd}: Läufe {sizes} nicht ausgeglichen"
        assert min(sizes) >= 2 or count < 2, f"Runde {rnd}: Lauf unter Mindestgröße"
        for heat in heats:
            assert heat["settings"]["min_players"] <= len(heat["slots"])
    final_round = max(by_round)
    assert len(by_round[final_round]) == 1, "genau ein Finale"
    assert len(by_round[final_round][0]["slots"]) <= match_size
    if count > match_size:
        assert len(by_round[1]) == math.ceil(count / match_size)
        for heat in [m for m in matches if m["round"] < final_round]:
            quota = heat["settings"]["qualifiers_per_match"]
            assert 1 <= quota < len(heat["slots"]), f"{heat['match_key']}: Quote {quota} bei {len(heat['slots'])} Plätzen"
            assert quota == len({a["rank"] for a in heat["advancement"] if a["flow"] == "W"})
    play_through(matches, random.Random(count * 100 + match_size * 10 + qualifiers))
    assert by_round[final_round][0]["status"] == "completed"


def test_ffa_heat_plan_matches_issue_examples():
    assert ffa_heat_plan(5, 4, 2) == [[(3, 2), (2, 1)], [(3, 0)]]
    assert ffa_heat_plan(9, 4, 2) == [[(3, 2), (3, 2), (3, 2)], [(3, 2), (3, 2)], [(4, 0)]]
    assert ffa_heat_plan(4, 4, 2) == [[(4, 0)]]
    levels = ffa_heat_plan(40, 4, 2)
    assert [len(level) for level in levels] == [10, 5, 3, 2, 1]
    assert levels[-1] == [(4, 0)]


def test_ffa_bracket_no_heat_with_one_player():
    """Issue: 5 → 4 + 1 und 9 → 4 + 4 + 1; der 1er-Lauf blieb ewig „pending“."""
    for count in (5, 9, 13):
        matches = build(count, "ffa_custom_bracket", "ffa", settings={"match_size": 4, "qualifiers_per_match": 2})
        first = [m for m in matches if m["round"] == 1]
        assert all(len(filled_ids(m)) >= 2 for m in first)
        assert all(m["status"] == "ready" for m in first)


def test_ffa_bracket_final_capped_and_multi_level():
    matches = build(40, "ffa_custom_bracket", "ffa", settings={"match_size": 4, "qualifiers_per_match": 2})
    rounds = sorted({m["round"] for m in matches})
    assert len(rounds) >= 3
    final = [m for m in matches if m["round"] == rounds[-1]]
    assert len(final) == 1 and len(final[0]["slots"]) == 4
    semis = [m for m in matches if m["round"] == rounds[-2]]
    assert all(m["round_name"] == "Halbfinale" for m in semis)
    assert final[0]["round_name"] == "Finale"


def test_ffa_bracket_seeds_snake_into_heats():
    matches = build(8, "ffa_custom_bracket", "ffa", settings={"match_size": 4, "qualifiers_per_match": 2})
    by_key = {m["match_key"]: m for m in matches}
    assert [slot["source"]["seed"] for slot in by_key["A"]["slots"]] == [1, 4, 5, 8]
    assert [slot["source"]["seed"] for slot in by_key["B"]["slots"]] == [2, 3, 6, 7]


def test_correction_rebuilds_the_walkover_chain():
    """Korrektur eines Erstrundenspiels neben einem Freilos: das kampflose Loser-Spiel bekommt den neuen Verlierer,
    das Folgespiel den neuen kampflosen Sieger - nichts bleibt doppelt besetzt."""
    matches = build(5, "double_elimination")
    by_key = {m["match_key"]: m for m in matches}
    apply_result(matches, by_key["B"], ["r4", "r5"])
    walkover = next(m for m in matches if section_of(m) == "LB" and (m.get("result_meta") or {}).get("source") == "auto_bye")
    assert walkover["results"][0]["registration_id"] == "r5"
    follow_up = next(m for m in matches if any((s.get("source_result") or {}).get("from_match_id") == walkover["id"] for s in m["slots"]))
    assert "r5" in filled_ids(follow_up)
    raw = [{"registration_id": "r5", "rank": 1}, {"registration_id": "r4", "rank": 2}]
    application = build_v2_result_application(by_key["B"], matches, raw, actor_id="staff", now_iso=NOW, force=True)
    by_key["B"].update(application["match_set"])
    for target_id, update in application["target_sets"].items():
        next(m for m in matches if m["id"] == target_id).update(update)
    assert walkover["status"] == "completed"
    assert walkover["results"][0]["registration_id"] == "r4"
    assert "r4" in filled_ids(follow_up) and "r5" not in filled_ids(follow_up)
    assert_nobody_twice_ready(matches)
    play_through(matches, random.Random(5))


def test_reset_rule_follows_origin_not_slot_number_when_rounds_are_shuffled(monkeypatch):
    """Zufallsmischung der Folgerunden: der Sieger der Siegerrunde kann im Grand Final auf Platz 2 landen. Ob ein
    Reset nötig ist, entscheidet seine Herkunft, nicht die Platznummer."""
    import services.match_v2_results as results_module

    monkeypatch.setattr(results_module.random, "choice", lambda candidates: candidates[-1])
    matches = build(4, "double_elimination", tournament={"randomize_advancement_rounds": True})
    by_key = {m["match_key"]: m for m in matches}
    gf = by_key["GF"]
    # Der niedrigere Seed gewinnt immer: r1 gewinnt die Siegerrunde, r2 die Verliererrunde.
    while gf["status"] != "ready":
        match = next(m for m in matches if m["status"] == "ready")
        apply_result(matches, match, sorted(filled_ids(match), key=lambda reg: int(reg[1:])))
    assert gf["status"] == "ready"
    assert gf["slots"][1]["registration_id"] == "r1", "der Sieger der Siegerrunde sitzt gemischt auf Platz 2"
    apply_result(matches, gf, ["r1", "r2"])
    assert by_key["GFR"]["status"] == "cancelled", "Sieg der Siegerrunde: kein Reset, auch von Platz 2 aus"
    raw = [{"registration_id": "r2", "rank": 1}, {"registration_id": "r1", "rank": 2}]
    application = build_v2_result_application(gf, matches, raw, actor_id="staff", now_iso=NOW, force=True)
    gf.update(application["match_set"])
    for target_id, update in application["target_sets"].items():
        next(m for m in matches if m["id"] == target_id).update(update)
    assert by_key["GFR"]["status"] == "ready", "Sieg der Verliererrunde: Reset, auch von Platz 1 aus"


def test_walkover_chain_runs_linear_over_long_cascades():
    """Eine lange Freilos-Kette (2 Spieler in einem 64er-Baum) läuft in einem Durchgang durch."""
    matches = build(2, "single_elimination", tournament={"max_participants": 64})
    assert all(m["status"] in TERMINAL | {"ready"} for m in matches)


# ---------------------------------------------------------------------------------------------- Ausfälle (#1550)

def _rebuild(matches: list[dict], stage: dict) -> None:
    from services.heat_rebuild import rebuild_heats, stage_heat_rules
    rebuild_heats(matches, now_iso=NOW, **stage_heat_rules(stage, matches))


def _withdraw(match: dict, registration_id: str) -> None:
    """Ein Ausfall vor dem Start (#1553 ruft später dieselbe Funktion): der Platz wird frei."""
    for slot in match["slots"]:
        if slot.get("registration_id") == registration_id:
            slot.update({"registration_id": None, "user_id": None, "status": "bye"})


@pytest.mark.parametrize("match_size,qualifiers", [(3, 1), (4, 2), (8, 2)])
@pytest.mark.parametrize("count", range(3, 41))
def test_ffa_bracket_survives_random_dropouts_after_round_one(count: int, match_size: int, qualifiers: int):
    """Nach Runde 1 fallen zufällig Fahrer aus (Wertung „nicht erschienen“ und Ausfall vor dem Start): der Planer legt
    zusammen, gleicht aus und kürzt ab - das Finale ist immer erreichbar, kein gespielter Lauf hat weniger als 2,
    das Finale nie mehr als die Laufgröße."""
    rng = random.Random(count * 1000 + match_size * 10 + qualifiers)
    stage = {"id": "s", "number": 1, "stage_type": "ffa_custom_bracket", "match_type": "ffa",
             "settings": {"match_size": match_size, "qualifiers_per_match": qualifiers, "min_players": 2}}
    base = {"id": "t", "seeding_mode": "manual", "max_participants": count}
    matches = build_matches_v2_from_schema(base, stage, registrations(count))
    _rebuild(matches, stage)
    withdrawn: set[str] = set()
    for _ in range(10_000):
        ready = [match for match in matches if match["status"] == "ready"]
        if not ready:
            break
        alive = {reg for m in matches if m["status"] not in TERMINAL for reg in filled_ids(m)}
        later = [m for m in ready if m["round"] >= 2 and len(filled_ids(m)) >= 2]
        if later and len(alive) > 2 and rng.random() < 0.3:
            victim_match = rng.choice(later)
            _withdraw(victim_match, rng.choice(filled_ids(victim_match)))
            victim_match["status"] = "ready" if len(filled_ids(victim_match)) >= 2 else "pending"
            _rebuild(matches, stage)
            assert_nobody_twice_ready(matches)
            continue
        match = rng.choice(ready)
        ranking = filled_ids(match)
        rng.shuffle(ranking)
        raw = [{"registration_id": reg, "rank": index + 1, "forfeit": index == len(ranking) - 1 and rng.random() < 0.3}
               for index, reg in enumerate(ranking)]
        application = build_v2_result_application(match, matches, raw, actor_id="staff", now_iso=NOW)
        match.update(application["match_set"])
        by_id = {row["id"]: row for row in matches}
        for target_id, update in application["target_sets"].items():
            by_id[target_id].update(update)
        _rebuild(matches, stage)
        assert_nobody_twice_ready(matches)
        withdrawn |= {row["registration_id"] for row in match["results"] if row.get("forfeit")}
    assert all(m["status"] in TERMINAL for m in matches), [m["match_key"] for m in matches if m["status"] not in TERMINAL]
    finals = [m for m in matches if m["status"] == "completed" and not m.get("advancement")]
    assert len(finals) == 1, f"genau ein Finale: {[m['match_key'] for m in finals]}"
    assert len(finals[0]["results"]) <= match_size
    for match in matches:
        if match["status"] == "completed" and (match.get("result_meta") or {}).get("source") != "auto_bye":
            assert len(match["results"]) >= 2, f"{match['match_key']} wurde mit {len(match['results'])} gespielt"
        if match["status"] not in TERMINAL:
            continue
        assert len(match["slots"]) <= match_size + 2, f"{match['match_key']} hat {len(match['slots'])} Plätze"


# ---------------------------------------------------------------------------------------------- Ausscheiden (#1553)

def _remove(matches: list[dict], registration_id: str, kind: str, eliminated: set[str] | None = None) -> dict:
    from services.tournament_events import plan_removal
    return plan_removal(matches, registration_id, kind=kind, now_iso=NOW, eliminated=eliminated)


def _assert_graph_valid(matches: list[dict]) -> None:
    from services.competition_graph_validation import validate_competition_graph
    from services.competition_snapshot import build_structure_snapshot
    report = validate_competition_graph(build_structure_snapshot("t", stage_matches=matches))
    assert report["valid"], [issue for issue in report["issues"] if issue["severity"] == "error"]


def _seats_of(matches: list[dict], registration_id: str) -> frozenset:
    return frozenset((m["id"], slot["slot"]) for m in matches for slot in m["slots"] if slot.get("registration_id") == registration_id)


def _play_with_random_removals(matches: list[dict], rng: random.Random, *, stage: dict | None = None) -> set[str]:
    """Spielt durch; zwischendurch werden zufällig Teilnehmer disqualifiziert oder treten aus (auch solche, die gerade
    nicht spielbereit sind, etwa mit Freilos in der nächsten Runde). Nach jedem Schritt: niemand zweimal spielbereit,
    Graph gültig; die Person sitzt danach in keinem offenen Spiel mehr und bekommt nie wieder einen Platz; am Ende ist
    alles entschieden."""
    removed: set[str] = set()
    seats_at_removal: dict[str, frozenset] = {}
    for _ in range(10_000):
        ready = [match for match in matches if match["status"] == "ready"]
        if not ready:
            break
        alive = sorted({reg for m in matches if m["status"] not in TERMINAL for reg in filled_ids(m)} - removed)
        if len(alive) > 2 and rng.random() < 0.25:
            victim = rng.choice(alive)
            kind = rng.choice(["withdrawn", "disqualified"])
            open_before = {m["id"] for m in matches if m["status"] not in TERMINAL}
            plan = _remove(matches, victim, kind, removed)
            removed.add(victim)
            still_seated = {reg for m in matches if m["status"] not in TERMINAL and m.get("match_type") != "ffa" for reg in filled_ids(m)}
            assert victim not in still_seated
            assert all(op["kind"] != "forfeit" for op in plan["ops"]), "vor dem Start gibt es nur Freilose, keine Wertung"
            for match in matches:
                if match["id"] in open_before and match["status"] in TERMINAL:
                    assert victim not in [row["registration_id"] for row in match.get("results") or []], \
                        f"{victim} kam nach dem Ausscheiden noch weiter in {match['match_key']}"
            if stage:
                _rebuild(matches, stage)
            seats_at_removal[victim] = _seats_of(matches, victim)
            assert_nobody_twice_ready(matches)
            _assert_graph_valid(matches)
            continue
        match = rng.choice(ready)
        ranking = filled_ids(match)
        rng.shuffle(ranking)
        apply_result(matches, match, ranking)
        if stage:
            _rebuild(matches, stage)
        assert_nobody_twice_ready(matches)
    open_matches = [match["match_key"] for match in matches if match["status"] not in TERMINAL]
    assert not open_matches, f"nicht erreichbar: {open_matches}"
    _assert_graph_valid(matches)
    for victim, seats in seats_at_removal.items():
        assert _seats_of(matches, victim) == seats, f"{victim} hat nach dem Ausscheiden noch einen Platz bekommen"
    return removed


@pytest.mark.parametrize("count", range(3, 41))
def test_single_elimination_survives_random_disqualifications(count: int):
    matches = build(count, "single_elimination", tournament={"bronze_match": count % 2 == 0, "format": "single_elim"})
    removed = _play_with_random_removals(matches, random.Random(count * 11))
    final = max((m for m in matches if section_of(m) in {"WB", "MAIN"}), key=lambda m: m["round"])
    assert final["status"] == "completed"
    champion = final["results"][0]["registration_id"]
    assert champion not in removed, "ein Ausgeschiedener gewinnt nie"


@pytest.mark.parametrize("count", range(3, 41))
def test_double_elimination_survives_random_disqualifications(count: int):
    matches = build(count, "double_elimination")
    removed = _play_with_random_removals(matches, random.Random(count * 13))
    gf = sorted((m for m in matches if section_of(m) == "GF"), key=lambda m: m["round"])
    assert gf and gf[0]["status"] in TERMINAL
    rows = stage_standings(matches, registrations(count))
    assert rows[0]["registration_id"] not in removed


@pytest.mark.parametrize("match_size,qualifiers", [(3, 1), (4, 2), (8, 2)])
@pytest.mark.parametrize("count", range(3, 41))
def test_ffa_bracket_survives_random_disqualifications(count: int, match_size: int, qualifiers: int):
    stage = {"id": "s", "number": 1, "stage_type": "ffa_custom_bracket", "match_type": "ffa",
             "settings": {"match_size": match_size, "qualifiers_per_match": qualifiers, "min_players": 2}}
    base = {"id": "t", "seeding_mode": "manual", "max_participants": count}
    matches = build_matches_v2_from_schema(base, stage, registrations(count))
    _rebuild(matches, stage)
    removed = _play_with_random_removals(matches, random.Random(count * 17 + match_size), stage=stage)
    # Das Finale: der gefahrene Lauf der letzten Runde ohne Weg weiter. Ein früherer Lauf, dessen Weiterkommer alle
    # ausgeschieden sind, hat ebenfalls keinen Weg mehr - er ist aber kein Finale.
    last_round = max(m["round"] for m in matches if m["status"] == "completed")
    finals = [m for m in matches if m["status"] == "completed" and not m.get("advancement") and m["round"] == last_round]
    assert len(finals) == 1, f"genau ein Finale: {[m['match_key'] for m in finals]}"
    assert len(finals[0]["results"]) <= match_size
    for match in matches:
        if match["status"] == "completed" and (match.get("result_meta") or {}).get("source") != "auto_bye":
            assert len(match["results"]) >= 2, f"{match['match_key']} wurde mit {len(match['results'])} gespielt"
        seated = [slot.get("registration_id") for slot in match["slots"] if slot.get("status") == "filled"]
        if match["status"] not in TERMINAL:
            assert not (set(seated) & removed)
