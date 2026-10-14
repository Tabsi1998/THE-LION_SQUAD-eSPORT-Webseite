"""Turnier-Ereignisse (#1553): Disqualifikation und Austritt als Umbauplan auf den Spiel-Dokumenten - rein im
Speicher, gegen den echten Generator und Ergebnis-Anwender.

Regeln (Entscheidungen E12, E14): K.-o./Doppel-K.-o. - raus aus allen offenen Spielen, kein Loser-Bracket-Eintrag,
Gegner kampflos weiter (Freilos-Kette). Aufgabe/nicht erschienen dagegen nur dieses Spiel (Doppel-K.-o.: ins Loser
Bracket). Liga/Gruppen: 50-Prozent-Regel. Swiss: Ergebnisse bleiben, nicht mehr paaren. FFA: aus Folgeläufen raus,
Plätze rücken auf. Idempotent.
"""
import copy
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.competition_graph_validation import validate_competition_graph  # noqa: E402
from services.competition_standings import stage_standings  # noqa: E402
from services.competition_snapshot import build_structure_snapshot  # noqa: E402
from services.custom_bracket import build_matches_v2_from_schema  # noqa: E402
from services.graph_swiss import swiss_round_documents  # noqa: E402
from services.match_v2_results import MatchV2ResultError, build_v2_result_application  # noqa: E402
from services.tournament_events import REMOVAL_KINDS, describe_removal, plan_removal, removal_hash  # noqa: E402
from services.v2_match_flows import results_for_forfeit  # noqa: E402

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


def by_key_of(matches: list[dict]) -> dict[str, dict]:
    return {m["match_key"]: m for m in matches}


def apply_result(matches: list[dict], match: dict, ranking: list[str], **kwargs) -> dict:
    raw = [{"registration_id": reg, "rank": index + 1} for index, reg in enumerate(ranking)]
    application = build_v2_result_application(match, matches, raw, actor_id="staff", now_iso=NOW, **kwargs)
    match.update(application["match_set"])
    by_id = {row["id"]: row for row in matches}
    for target_id, update in application["target_sets"].items():
        by_id[target_id].update(update)
    return application


def apply_forfeit(matches: list[dict], match: dict, forfeiting: str) -> dict:
    raw = results_for_forfeit(match, forfeiting)
    application = build_v2_result_application(match, matches, raw, actor_id="staff", now_iso=NOW)
    match.update(application["match_set"])
    match["status"] = "forfeit"
    by_id = {row["id"]: row for row in matches}
    for target_id, update in application["target_sets"].items():
        by_id[target_id].update(update)
    return application


def open_matches_with(matches: list[dict], registration_id: str) -> list[str]:
    return [m["match_key"] for m in matches if m["status"] not in TERMINAL and registration_id in filled_ids(m)]


def assert_nobody_twice_ready(matches: list[dict]) -> None:
    seen: dict[str, str] = {}
    for match in matches:
        if match["status"] not in ACTIVE:
            continue
        for reg in filled_ids(match):
            assert reg not in seen, f"{reg} ist in {seen[reg]} und {match['match_key']} gleichzeitig spielbereit"
            seen[reg] = match["match_key"]


def assert_graph_valid(matches: list[dict]) -> None:
    report = validate_competition_graph(build_structure_snapshot("t", stage_matches=matches))
    assert report["valid"], [issue for issue in report["issues"] if issue["severity"] == "error"]


def section_of(match: dict) -> str:
    return str(match.get("section") or "").upper()


# ---------------------------------------------------------------------------------------------- Single Elimination

def test_removal_kinds_are_the_two_new_registration_statuses():
    assert REMOVAL_KINDS == ("withdrawn", "disqualified")


def test_single_elimination_dq_gives_the_waiting_opponent_a_walkover_and_clears_the_player_from_the_chain():
    """SE 8: r1 gewinnt A, r4 gewinnt B, E ist bereit. r1 wird disqualifiziert: r4 kommt in E kampflos weiter und
    steht im Finale, r1 steht nirgends mehr offen, kein Loser-Weg bekommt ihn."""
    matches = build(8, "single_elimination", tournament={"format": "single_elim"})
    by_key = by_key_of(matches)
    apply_result(matches, by_key["A"], ["r1", "r8"])
    apply_result(matches, by_key["B"], ["r4", "r5"])
    assert by_key["E"]["status"] == "ready" and set(filled_ids(by_key["E"])) == {"r1", "r4"}

    plan = plan_removal(matches, "r1", kind="disqualified", now_iso=NOW)

    assert plan["mode"] == "bracket"
    assert [op["kind"] for op in plan["ops"]] == ["slot_cleared", "walkover"]
    assert by_key["E"]["status"] == "completed"
    assert [row["registration_id"] for row in by_key["E"]["results"]] == ["r4"]
    assert by_key["E"]["result_meta"]["reason"] == "disqualified"
    assert by_key["E"]["result_meta"]["removed_registration_id"] == "r1"
    assert "r4" in filled_ids(by_key["G"]) and by_key["G"]["status"] == "pending"
    assert open_matches_with(matches, "r1") == []
    cleared = next(slot for slot in by_key["E"]["slots"] if slot["status"] == "bye")
    assert cleared["source_result"]["reason"] == "disqualified"
    assert cleared["source_result"]["removed_registration_id"] == "r1"
    assert by_key["E"]["id"] in plan["changed_ids"]
    assert_nobody_twice_ready(matches)
    assert_graph_valid(matches)
    # Der Plan in Worten für die Bestätigung der Turnierleitung.
    text = describe_removal(plan)
    assert "kampflos" in text and "E" in text


def test_single_elimination_chain_waits_for_the_other_source_and_then_walks_over():
    """r1 gewinnt A und sitzt in E; B ist noch offen. Nach der Disqualifikation ist der Platz in E frei; das Ergebnis
    von B schickt den Sieger kampflos weiter bis ins Finale - ohne weiteres Zutun."""
    matches = build(8, "single_elimination", tournament={"format": "single_elim"})
    by_key = by_key_of(matches)
    apply_result(matches, by_key["A"], ["r1", "r8"])
    plan = plan_removal(matches, "r1", kind="withdrawn", now_iso=NOW)
    assert [op["kind"] for op in plan["ops"]] == ["slot_cleared"]
    assert by_key["E"]["status"] == "pending" and filled_ids(by_key["E"]) == []
    apply_result(matches, by_key["B"], ["r4", "r5"])
    assert by_key["E"]["status"] == "completed" and by_key["E"]["results"][0]["registration_id"] == "r4"
    assert "r4" in filled_ids(by_key["G"])
    assert_nobody_twice_ready(matches)
    assert_graph_valid(matches)


def test_single_elimination_player_in_a_started_match_is_forfeited_not_walked_over():
    """Ein Spiel, das schon läuft, bekommt eine Wertung (Aufgebender zuletzt, Stand ``forfeit``)."""
    matches = build(4, "single_elimination", tournament={"format": "single_elim"})
    by_key = by_key_of(matches)
    by_key["A"]["status"] = "in_progress"
    by_key["A"]["started_at"] = NOW
    plan = plan_removal(matches, "r1", kind="disqualified", now_iso=NOW)
    assert [op["kind"] for op in plan["ops"]] == ["forfeit"]
    assert by_key["A"]["status"] == "forfeit"
    assert by_key["A"]["forfeit_registration_id"] == "r1"
    assert [(row["registration_id"], row["rank"], bool(row.get("forfeit"))) for row in by_key["A"]["results"]] == [("r4", 1, False), ("r1", 2, True)]
    assert "r4" in filled_ids(by_key["C"]) and "r1" not in filled_ids(by_key["C"])
    assert_graph_valid(matches)


def test_removal_is_idempotent():
    matches = build(8, "single_elimination", tournament={"format": "single_elim"})
    by_key = by_key_of(matches)
    apply_result(matches, by_key["A"], ["r1", "r8"])
    first = plan_removal(matches, "r1", kind="disqualified", now_iso=NOW)
    snapshot = copy.deepcopy(matches)
    second = plan_removal(matches, "r1", kind="disqualified", now_iso=NOW)
    assert first["ops"] and second["ops"] == [] and second["changed_ids"] == []
    assert matches == snapshot
    assert removal_hash(first) != removal_hash(second)


def test_removal_of_an_unknown_or_finished_player_changes_nothing():
    matches = build(4, "single_elimination", tournament={"format": "single_elim"})
    by_key = by_key_of(matches)
    apply_result(matches, by_key["A"], ["r1", "r4"])
    # r4 ist schon ausgeschieden: nichts mehr zu tun, der Status wird trotzdem gesetzt (Sache des Aufrufers).
    plan = plan_removal(matches, "r4", kind="withdrawn", now_iso=NOW)
    assert plan["ops"] == [] and plan["mode"] == "bracket"
    with pytest.raises(ValueError):
        plan_removal(matches, "r1", kind="gone", now_iso=NOW)


# ---------------------------------------------------------------------------------------------- Double Elimination

def test_double_elimination_forfeit_drops_into_the_loser_bracket_but_dq_does_not():
    """Aufgabe in A: r4 landet im Loser Bracket. Disqualifikation von r3 in B: r2 kommt kampflos weiter, der
    Verlierer-Platz von B im Loser Bracket bleibt ein Freilos - r3 taucht nirgends mehr auf."""
    matches = build(4, "double_elimination")
    by_key = by_key_of(matches)
    apply_forfeit(matches, by_key["A"], "r4")
    lb = [m for m in matches if section_of(m) == "LB"]
    assert any("r4" in filled_ids(m) for m in lb), "Aufgabe eines Spiels: ins Loser Bracket"

    plan = plan_removal(matches, "r3", kind="disqualified", now_iso=NOW)
    assert "walkover" in [op["kind"] for op in plan["ops"]]
    assert by_key["B"]["status"] == "completed" and by_key["B"]["results"][0]["registration_id"] == "r2"
    assert all("r3" not in filled_ids(m) for m in matches), "Disqualifikation: kein Loser-Bracket-Eintrag"
    assert_nobody_twice_ready(matches)
    assert_graph_valid(matches)
    # Weiterspielen bis zum Ende: r4 kommt im Loser Bracket kampflos weiter, das Finale ist erreichbar.
    for _ in range(50):
        ready = [m for m in matches if m["status"] == "ready"]
        if not ready:
            break
        match = ready[0]
        apply_result(matches, match, sorted(filled_ids(match)))
    assert all(m["status"] in TERMINAL for m in matches), [m["match_key"] for m in matches if m["status"] not in TERMINAL]


def test_double_elimination_dq_in_the_loser_bracket_walks_the_opponent_over():
    matches = build(8, "double_elimination")
    by_key = by_key_of(matches)
    for key in ("A", "B", "C", "D"):
        apply_result(matches, by_key[key], sorted(filled_ids(by_key[key])))
    lb_ready = [m for m in matches if section_of(m) == "LB" and m["status"] == "ready"]
    assert lb_ready
    target = lb_ready[0]
    victim, opponent = filled_ids(target)
    plan = plan_removal(matches, victim, kind="withdrawn", now_iso=NOW)
    assert "walkover" in [op["kind"] for op in plan["ops"]]
    assert target["status"] == "completed" and target["results"][0]["registration_id"] == opponent
    assert all(victim not in filled_ids(m) for m in matches if m["status"] not in TERMINAL)
    assert_nobody_twice_ready(matches)
    assert_graph_valid(matches)


@pytest.mark.parametrize("grand_final", ["reset", "single"])
@pytest.mark.parametrize("removed_side", ["upper", "lower"])
def test_double_elimination_removal_before_the_grand_final_respects_the_reset_rule(grand_final: str, removed_side: str):
    """Codex-Befund: ein kampflos entschiedenes Grand Final muss die Reset-Regel durchlaufen. Fällt der Sieger der
    Verliererrunde aus, gewinnt die Siegerrunde kampflos - das Reset-Spiel entfällt („nicht nötig“) und wird nicht
    selbst zum Freilos. Fällt der Sieger der Siegerrunde aus, gewinnt die Verliererrunde kampflos; mit Reset-Regel ist
    das Reset-Spiel dann nötig und ebenfalls kampflos entschieden."""
    matches = build(4, "double_elimination", tournament={"grand_final_mode": grand_final})
    by_key = by_key_of(matches)
    for _ in range(20):
        ready = [m for m in matches if m["status"] == "ready" and section_of(m) != "GF"]
        if not ready:
            break
        match = ready[0]
        apply_result(matches, match, sorted(filled_ids(match), key=lambda reg: int(reg[1:])))
    gf = by_key["GF"]
    assert gf["status"] == "ready"
    upper, lower = gf["slots"][0]["registration_id"], gf["slots"][1]["registration_id"]
    victim, survivor = (upper, lower) if removed_side == "upper" else (lower, upper)
    plan = plan_removal(matches, victim, kind="disqualified", now_iso=NOW)
    assert "walkover" in [op["kind"] for op in plan["ops"]]
    assert gf["status"] == "completed" and gf["results"][0]["registration_id"] == survivor
    reset = by_key.get("GFR")
    if grand_final == "single":
        assert reset is None
    elif removed_side == "lower":
        assert reset["status"] == "cancelled", "Sieg der Siegerrunde: das Reset-Spiel ist nicht nötig"
        assert reset["result_meta"]["source"] == "bracket_reset" and reset["result_meta"]["needed"] is False
    else:
        assert reset["status"] == "completed" and reset["results"][0]["registration_id"] == survivor
        assert reset["result_meta"]["source"] == "auto_bye", "die Verliererrunde gewinnt: Reset nötig, aber ohne Gegner kampflos"
    assert all(m["status"] in TERMINAL for m in matches), [m["match_key"] for m in matches if m["status"] not in TERMINAL]
    rows = stage_standings(matches, registrations(4))
    assert rows[0]["registration_id"] == survivor
    assert_nobody_twice_ready(matches)
    assert_graph_valid(matches)


# ---------------------------------------------------------------------------------------------- Liga und Gruppen

def league_of_six() -> list[dict]:
    """Jeder gegen jeden, ein Umlauf: 5 Spieltage, jeder hat 5 Spiele."""
    matches = build(6, "round_robin_groups", settings={"group_count": 1}, tournament={"format": "round_robin"})
    assert len(matches) == 15
    return matches


def matches_of(matches: list[dict], registration_id: str) -> list[dict]:
    return [m for m in matches if registration_id in [s.get("registration_id") for s in m["slots"]]]


def play(matches: list[dict], registration_id: str, count: int) -> None:
    """Die ersten ``count`` Spiele der Person nach Spieltag: die Person gewinnt."""
    mine = sorted(matches_of(matches, registration_id), key=lambda m: (int(m.get("round") or 0), int(m.get("order") or 0)))
    for match in mine[:count]:
        others = [reg for reg in filled_ids(match) if reg != registration_id]
        apply_result(matches, match, [registration_id, *others])


def test_league_withdrawal_after_two_of_five_matchdays_annuls_all_games_of_the_player():
    matches = league_of_six()
    play(matches, "r1", 2)
    plan = plan_removal(matches, "r1", kind="withdrawn", now_iso=NOW)
    assert plan["mode"] == "annulled" and plan["played"] == 2 and plan["total"] == 5
    mine = matches_of(matches, "r1")
    assert all(m["status"] == "cancelled" for m in mine)
    assert all((m.get("result_meta") or {}).get("reason") == "withdrawn" and m["result_meta"].get("annulled") for m in mine)
    played = [m for m in mine if m["results"]]
    assert len(played) == 2, "gespielte Ergebnisse bleiben als Historie am Spiel"
    assert all(m["result_meta"].get("previous_status") == "completed" for m in played)
    others = [m for m in matches if m not in mine]
    assert all(m["status"] == "ready" for m in others)
    assert [op["kind"] for op in plan["ops"]] == ["annulled"] * 5
    text = describe_removal(plan)
    assert "annulliert" in text and "2 von 5" in text


def test_league_withdrawal_after_three_of_five_matchdays_forfeits_the_rest():
    matches = league_of_six()
    play(matches, "r1", 3)
    plan = plan_removal(matches, "r1", kind="withdrawn", now_iso=NOW)
    assert plan["mode"] == "forfeit" and plan["played"] == 3
    mine = matches_of(matches, "r1")
    done = [m for m in mine if m["status"] == "completed"]
    forfeited = [m for m in mine if m["status"] == "forfeit"]
    assert len(done) == 3 and len(forfeited) == 2
    for match in forfeited:
        assert match["forfeit_registration_id"] == "r1"
        loser = next(row for row in match["results"] if row["registration_id"] == "r1")
        assert loser["forfeit"] is True and loser["rank"] == 2
    assert [op["kind"] for op in plan["ops"]] == ["forfeit", "forfeit"]
    assert "kampflos" in describe_removal(plan)


def test_league_exactly_half_played_counts_as_enough():
    """4 Spieler, 3 Spiele je Person: 1 gespielt < 1,5 → annulliert; bei 6 Spielen (Hin- und Rückrunde) 3 → Rest."""
    matches = build(4, "league", tournament={"format": "league"})
    assert len(matches_of(matches, "r1")) == 6
    play(matches, "r1", 3)
    plan = plan_removal(matches, "r1", kind="disqualified", now_iso=NOW)
    assert plan["mode"] == "forfeit"


def test_group_withdrawal_touches_only_the_own_group():
    matches = build(8, "round_robin_groups", settings={"group_count": 2}, tournament={"format": "groups"})
    group_a = [m for m in matches if m["section"] == "group_A"]
    group_b = [m for m in matches if m["section"] == "group_B"]
    assert len(group_a) == 6 and len(group_b) == 6
    victim = filled_ids(group_a[0])[0]
    play(matches, victim, 1)
    before_b = copy.deepcopy(group_b)
    plan = plan_removal(matches, victim, kind="withdrawn", now_iso=NOW)
    assert plan["mode"] == "annulled" and plan["total"] == 3
    assert group_b == before_b
    assert all(m["status"] == "cancelled" for m in matches_of(matches, victim))


# ---------------------------------------------------------------------------------------------- Swiss

def swiss(count: int) -> tuple[dict, dict, list[dict]]:
    tournament = {"id": "t", "format": "swiss", "match_duration_minutes": 30}
    stage = {"id": "s", "number": 1, "stage_type": "swiss", "match_type": "duel", "settings": {}}
    regs = registrations(count)
    return tournament, stage, regs


def test_swiss_drop_forfeits_the_open_game_and_keeps_every_result():
    tournament, stage, regs = swiss(4)
    matches = swiss_round_documents(tournament, stage, regs, [], round_number=1, seed=1)
    for match in matches:
        apply_result(matches, match, sorted(filled_ids(match)))
    round_two = swiss_round_documents(tournament, stage, regs, matches, round_number=2, seed=1)
    matches.extend(round_two)
    first_round = copy.deepcopy([m for m in matches if m["round"] == 1])
    open_match = next(m for m in round_two if "r1" in filled_ids(m))
    plan = plan_removal(matches, "r1", kind="withdrawn", now_iso=NOW)
    assert plan["mode"] == "swiss"
    assert [op["kind"] for op in plan["ops"]] == ["forfeit"]
    assert open_match["status"] == "forfeit" and open_match["forfeit_registration_id"] == "r1"
    assert [m for m in matches if m["round"] == 1] == first_round, "Ergebnisse bleiben"
    # Nicht mehr paaren: die nächste Runde kennt r1 nicht mehr (Anmeldungsstatus filtert, hier nachgestellt).
    remaining = [reg for reg in regs if reg["id"] != "r1"]
    round_three = swiss_round_documents(tournament, stage, remaining, matches, round_number=3, seed=1)
    assert all("r1" not in filled_ids(m) for m in round_three)


def test_swiss_bye_of_the_dropped_player_keeps_its_point():
    tournament, stage, regs = swiss(3)
    matches = swiss_round_documents(tournament, stage, regs, [], round_number=1, seed=1)
    bye = next(m for m in matches if len(filled_ids(m)) == 1)
    seated = filled_ids(bye)[0]
    assert bye["status"] == "completed", "ein Freilos ist im Swiss ein entschiedenes Spiel mit einem Punkt"
    plan = plan_removal(matches, seated, kind="disqualified", now_iso=NOW)
    assert plan["ops"] == [] and plan["mode"] == "swiss"
    assert bye["status"] == "completed", "der Punkt bleibt - Ergebnisse bleiben"


# ---------------------------------------------------------------------------------------------- FFA-Läufe

def ffa(count: int, *, cap: int = 4, quota: int = 2) -> tuple[list[dict], dict]:
    stage = {"id": "s", "number": 1, "stage_type": "ffa_custom_bracket", "match_type": "ffa",
             "settings": {"match_size": cap, "qualifiers_per_match": quota, "min_players": 2}}
    base = {"id": "t", "seeding_mode": "manual", "max_participants": count}
    return build_matches_v2_from_schema(base, stage, registrations(count)), stage


def rebuild(matches: list[dict], stage: dict) -> dict:
    from services.heat_rebuild import rebuild_heats, stage_heat_rules
    return rebuild_heats(matches, now_iso=NOW, **stage_heat_rules(stage, matches))


def test_ffa_removal_frees_the_seat_and_the_heat_planner_follows():
    """9 Fahrer, Läufe 3 + 3 + 3. Ein Ausfall in A: der Platz wird frei, der Lauf fährt mit 2 - der Lauf-Planer
    (#1550, dieselbe Funktion wie nach einem Ergebnis) senkt die Quote auf 1 und markiert den Folgeplatz."""
    matches, stage = ffa(9)
    by_key = by_key_of(matches)
    a_players = filled_ids(by_key["A"])
    plan = plan_removal(matches, a_players[0], kind="withdrawn", now_iso=NOW)
    assert [op["kind"] for op in plan["ops"]] == ["slot_cleared"]
    assert len(filled_ids(by_key["A"])) == 2 and by_key["A"]["status"] == "ready"
    result = rebuild(matches, stage)
    assert {op["kind"] for op in result["ops"]} == {"quota"}
    assert by_key["A"]["settings"]["qualifiers_per_match"] == 1
    assert_nobody_twice_ready(matches)
    assert_graph_valid(matches)
    for match in matches:
        if match["status"] == "ready":
            apply_result(matches, match, sorted(filled_ids(match)))
            rebuild(matches, stage)
    assert_nobody_twice_ready(matches)


def test_ffa_dq_after_a_heat_lets_the_next_place_move_up():
    """Lauf A ist gefahren (r1 Erster, r4 Zweiter, r5 Dritter), das Halbfinale noch nicht gestartet. Disqualifikation
    von r1: sein Platz im Halbfinale geht an r5 - Plätze rücken auf."""
    matches, stage = ffa(9)
    by_key = by_key_of(matches)
    first, second, third = filled_ids(by_key["A"])
    apply_result(matches, by_key["A"], [first, second, third])
    semi = next(m for m in matches if first in filled_ids(m) and m["round"] == 2)
    assert set(filled_ids(semi)) >= {first, second} and third not in filled_ids(semi)
    plan = plan_removal(matches, first, kind="disqualified", now_iso=NOW)
    assert "readvanced" in [op["kind"] for op in plan["ops"]]
    assert third in filled_ids(semi) and first not in filled_ids(semi)
    assert by_key["A"]["results"][0]["registration_id"] == first, "das gefahrene Ergebnis bleibt"
    moved = next(slot for slot in semi["slots"] if slot.get("registration_id") == third)
    assert moved["source_result"]["from_match_id"] == by_key["A"]["id"] and moved["source_result"]["rank"] == 3
    assert_nobody_twice_ready(matches)
    assert_graph_valid(matches)


@pytest.mark.parametrize("mode", [None, "instant"], ids=["fest", "sofort"])
def test_ffa_dq_never_moves_up_who_already_played_on(mode):
    """12 Fahrer (B:1 → E, B:2 → D): Lauf B ist gefahren, sein Zweiter hat in D schon gespielt und ist weiter. Fällt
    der Erste aus, rückt nicht der Zweite auf (er säße dann in zwei spielbereiten Läufen), sondern der Dritte. Fest wie
    sofort (#1590) - sofort wird so lange gebaut, bis das Los die beiden trennt."""
    stage = {"id": "s", "number": 1, "stage_type": "ffa_custom_bracket", "match_type": "ffa",
             "settings": {"match_size": 4, "qualifiers_per_match": 2, "min_players": 2}}
    base = {"id": "t", "seeding_mode": "manual", "max_participants": 12, **({"advancement_mode": mode} if mode else {})}
    for _attempt in range(40):
        matches = build_matches_v2_from_schema(base, stage, registrations(12))
        by_key = by_key_of(matches)
        first, second, third, fourth = filled_ids(by_key["B"])
        apply_result(matches, by_key["B"], [first, second, third, fourth])
        seat_of_first = next(m for m in matches if m["round"] == 2 and first in filled_ids(m))
        seat_of_second = next(m for m in matches if m["round"] == 2 and second in filled_ids(m))
        if seat_of_first["id"] != seat_of_second["id"]:
            break
    assert seat_of_first["id"] != seat_of_second["id"]
    # Die übrigen Läufe der Runde 1 fahren - dann fährt der Lauf des Zweiten, und er kommt weiter.
    for key in "AC":
        apply_result(matches, by_key[key], filled_ids(by_key[key]))
    assert seat_of_second["status"] == "ready"
    ranking = [second] + [reg for reg in filled_ids(seat_of_second) if reg != second]
    apply_result(matches, seat_of_second, ranking)
    assert any(second in filled_ids(m) for m in matches if m["round"] == 3), "der Zweite ist schon weiter"
    assert seat_of_first["status"] in {"pending", "ready"}
    plan = plan_removal(matches, first, kind="disqualified", now_iso=NOW)
    assert first not in filled_ids(seat_of_first)
    assert third in filled_ids(seat_of_first), "der Dritte rückt nach"
    assert second not in filled_ids(seat_of_first), "wer schon weitergespielt hat, bleibt, wo er ist"
    moved = next(op for op in plan["ops"] if op["kind"] == "readvanced")
    assert moved["registration_id"] == third
    assert_nobody_twice_ready(matches)
    assert_graph_valid(matches)


def test_ffa_dq_does_not_touch_a_heat_that_has_been_called_or_started():
    matches, stage = ffa(9)
    by_key = by_key_of(matches)
    first, second, third = filled_ids(by_key["A"])
    apply_result(matches, by_key["A"], [first, second, third])
    semi = next(m for m in matches if first in filled_ids(m) and m["round"] == 2)
    semi["called_at"] = NOW
    plan = plan_removal(matches, first, kind="disqualified", now_iso=NOW)
    assert "readvanced" not in [op["kind"] for op in plan["ops"]]
    assert first in filled_ids(semi), "ein aufgerufener Lauf wird nicht umgebaut - die Wertung kommt mit dem Ergebnis"


# ---------------------------------------------------------------------------------------------- Ergebnis-Vertrag

def test_forfeit_with_a_single_seated_player_is_gradable_and_sends_nobody_on():
    """Heute brauchte eine Wertung zwei belegte Plätze (v2_match_flows). Ein Spiel „1 Spieler + offener Platz“ lässt
    sich jetzt werten: der Spieler verliert kampflos, sein Sieger-Platz im Folgespiel wird ein Freilos."""
    matches = build(8, "single_elimination", tournament={"format": "single_elim"})
    by_key = by_key_of(matches)
    apply_result(matches, by_key["A"], ["r1", "r8"])
    assert filled_ids(by_key["E"]) == ["r1"]
    raw = results_for_forfeit(by_key["E"], "r1")
    assert raw == [{"registration_id": "r1", "rank": 1, "forfeit": True}]
    application = build_v2_result_application(by_key["E"], matches, raw, actor_id="staff", now_iso=NOW)
    target_slot = next(s for s in by_key["G"]["slots"] if (s.get("source") or {}).get("match_key") == "E")
    assert target_slot["status"] == "bye" and target_slot.get("registration_id") is None
    assert application["match_set"]["status"] == "completed"
    with pytest.raises(MatchV2ResultError):
        results_for_forfeit(by_key["E"], "r9")


def test_an_eliminated_player_never_fills_a_slot_again():
    """Nach der Disqualifikation gilt bei jedem späteren Ergebnis und jeder Korrektur: die Person rückt nirgends mehr
    ein - ihr Platz wird ein Freilos, im Lauf rückt der Nächste auf."""
    matches = build(4, "single_elimination", tournament={"format": "single_elim"})
    by_key = by_key_of(matches)
    apply_result(matches, by_key["A"], ["r1", "r4"], eliminated={"r1"})
    final_slot = next(s for s in by_key["C"]["slots"] if (s.get("source") or {}).get("match_key") == "A")
    assert final_slot["status"] == "bye" and final_slot.get("registration_id") is None
    assert final_slot["source_result"]["reason"] == "eliminated"

    heats, _stage = ffa(9)
    heat = by_key_of(heats)["A"]
    first, second, third = filled_ids(heat)
    apply_result(heats, heat, [first, second, third], eliminated={first})
    semi = next(m for m in heats if second in filled_ids(m) and m["round"] == 2)
    assert set(filled_ids(semi)) >= {second, third} and first not in filled_ids(semi)


def test_a_forfeiting_player_does_not_advance_on_the_winner_path():
    """Zwei Fahrer in einem Lauf mit Quote 2: wer nicht erschienen ist, kommt nicht weiter - der Platz wird frei."""
    matches, _stage = ffa(9)
    heat = by_key_of(matches)["A"]
    first, second, third = filled_ids(heat)
    plan_removal(matches, third, kind="withdrawn", now_iso=NOW)
    assert filled_ids(heat) == [first, second] and heat["settings"]["qualifiers_per_match"] == 2
    raw = [{"registration_id": first, "rank": 1}, {"registration_id": second, "rank": 2, "forfeit": True}]
    application = build_v2_result_application(heat, matches, raw, actor_id="staff", now_iso=NOW)
    heat.update(application["match_set"])
    by_id = {row["id"]: row for row in matches}
    for target_id, update in application["target_sets"].items():
        by_id[target_id].update(update)
    semi = next(m for m in matches if any((s.get("source") or {}).get("match_key") == "A" for s in m["slots"]))
    assert first in filled_ids(semi) and second not in [s.get("registration_id") for s in semi["slots"]]
    freed = next(s for s in semi["slots"] if (s.get("source") or {}).get("match_key") == "A" and s.get("source", {}).get("rank") == 2)
    assert freed["status"] == "bye" and freed["source_result"]["reason"] == "forfeit"


def test_lineups_are_closed_for_withdrawn_and_disqualified_teams():
    from services.team_lineup import CLOSED_REGISTRATIONS, lineup_open
    assert {"withdrawn", "disqualified"} <= CLOSED_REGISTRATIONS
    tournament = {"status": "check_in"}
    assert lineup_open(tournament, {"status": "approved"}) is True
    assert lineup_open(tournament, {"status": "disqualified"}) is False
