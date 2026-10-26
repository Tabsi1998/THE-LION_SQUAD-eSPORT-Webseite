"""Turnierbaum-Generator (#1549): Simulation 2 bis 40 Teilnehmer gegen den echten Generator und Ergebnis-Anwender.

Jeder Baum wird mit zufälligen Ergebnissen (fester Zufallsstart) bis zum Ende durchgespielt. Geprüft wird je Schritt:
kein Teilnehmer steht in zwei spielbereiten Spielen gleichzeitig, am Ende ist jedes Spiel entschieden (gespielt,
Freilos oder „nicht nötig“), das Finale ist erreichbar. Dazu je Format die Regeln aus dem Issue.

Gemischt (#1548, „Zufällig mischen“): dieselben Bäume mit Auslosung nach jeder Runde. Im Betrieb lost ``secrets``
(ohne Startwert); hier lost jeder Testfall mit festem Startwert aus seiner Kennung (``seeded_draw``), damit ein roter
Lauf nachstellbar ist (#2033) - die Breite über viele Lose und Ausfall-Reihenfolgen liefert
``test_ffa_removals_over_many_draws_and_dropout_orders``. Zusätzlich je Schritt: eine Folgerunde ist erst besetzt, wenn
alle Spiele der Runde davor entschieden sind, und jeder Weiterkommer steht genau einmal in der Folgerunde.
"""
import math
import pathlib
import random
import sys
import zlib

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import advancement_draw, custom_bracket, match_v2_results  # noqa: E402
from services.competition_standings import stage_standings  # noqa: E402
from services.round_labels import round_label  # noqa: E402
from services.custom_bracket import (  # noqa: E402
    _auto_double_elim_schema,
    build_matches_v2_from_schema,
    ffa_heat_plan,
    parse_custom_bracket_schema,
)
from services.advancement_draw import group_sources, group_targets  # noqa: E402
from services.match_v2_results import build_v2_result_application  # noqa: E402

NOW = "2026-10-31T10:00:00+00:00"


def seed_draw(monkeypatch, seed: int) -> random.Random:
    """Das Los (``advancement_draw.DRAW_RNG``, ``secrets.SystemRandom``) an jeder Importstelle durch einen Zufall mit
    Startwert ersetzen - auch in Modulen, die ``DRAW_RNG`` direkt importiert haben (``custom_bracket``,
    ``match_v2_results``), sonst losen die weiter ohne Startwert (#2033)."""
    rng = random.Random(seed)
    for module in (advancement_draw, custom_bracket, match_v2_results):
        monkeypatch.setattr(module, "DRAW_RNG", rng)
    for name, module in list(sys.modules.items()):
        if name.startswith("services.") and hasattr(module, "DRAW_RNG"):
            monkeypatch.setattr(module, "DRAW_RNG", rng)
    return rng


@pytest.fixture(autouse=True)
def seeded_draw(request, monkeypatch) -> random.Random:
    """Jeder Testfall lost mit festem Startwert aus seiner Kennung: derselbe Fall gibt immer dasselbe Los."""
    return seed_draw(monkeypatch, zlib.crc32(request.node.nodeid.encode("utf-8")))


TERMINAL = {"completed", "forfeit", "cancelled"}
ACTIVE = {"ready", "scheduled", "in_progress", "waiting_result"}
SHUFFLE = {"randomize_advancement_rounds": True}
INSTANT = {"advancement_mode": "instant"}
# Weiterkommen in vier Modi (#1590): fest, Auslosung nach der Runde („gemischt“) und sofort zufällig („sofort“).
MODES = [None, SHUFFLE, INSTANT]
MODE_IDS = ["fest", "gemischt", "sofort"]


def mode_fields(mode) -> dict:
    return dict(mode or {})


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


def assert_draws_wait_for_whole_round(matches: list[dict]) -> None:
    """Gemischt: solange ein Quellspiel einer Gruppe offen ist, ist dort niemand ausgelost; danach steht jeder
    Weiterkommer genau einmal in der Folgerunde."""
    groups = {m["settings"]["draw_group"] for m in matches if (m.get("settings") or {}).get("draw_group")}
    by_id = {m["id"]: m for m in matches}
    for group in groups:
        targets = group_targets(matches, group)
        sources = group_sources(matches, group)
        if targets and (targets[0].get("settings") or {}).get("advancement_mode") == "instant":
            # Sofort zufällig (#1590): kein Los je Runde; jeder besetzte Platz kommt aus einem entschiedenen Spiel, und
            # jeder Weiterkommer sitzt genau einmal.
            assert not any(t.get("draw") for t in targets), f"{group}: sofort zufällig kennt kein Los je Runde"
            for target in targets:
                for slot in target["slots"]:
                    origin = (slot.get("source_result") or {}).get("from_match_id")
                    if slot.get("registration_id") and origin in by_id:
                        assert by_id[origin]["status"] in TERMINAL, f"{group}: {slot['registration_id']} sitzt, bevor die Quelle fertig ist"
            seated = [reg for t in targets for reg in filled_ids(t)]
            assert len(seated) == len(set(seated)), f"{group}: jemand sitzt doppelt"
            continue
        if any(m["status"] not in TERMINAL for m in sources):
            assert not any(t.get("draw") for t in targets), f"{group} ausgelost, obwohl die Runde noch läuft"
            assert not any(filled_ids(t) for t in targets), f"{group} besetzt, obwohl die Runde noch läuft"
            continue
        seated = [reg for t in targets for reg in filled_ids(t)]
        assert len(seated) == len(set(seated)), f"{group}: jemand sitzt doppelt"


def play_through(matches: list[dict], rng: random.Random, *, on_result=None) -> list[tuple[dict, list[str]]]:
    """Spielt alle spielbereiten Spiele in zufälliger Reihenfolge mit zufälligem Ausgang, bis nichts mehr offen ist."""
    history: list[tuple[dict, list[str]]] = []
    assert_nobody_twice_ready(matches)
    assert_draws_wait_for_whole_round(matches)
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
        assert_draws_wait_for_whole_round(matches)
    open_matches = [match["match_key"] for match in matches if match["status"] not in TERMINAL]
    assert not open_matches, f"nicht erreichbar: {open_matches}"
    return history


def section_of(match: dict) -> str:
    return str(match.get("section") or "").upper()


# ---------------------------------------------------------------------------------------------- Single Elimination

@pytest.mark.parametrize("mode", MODES, ids=MODE_IDS)
@pytest.mark.parametrize("count", range(2, 41))
@pytest.mark.parametrize("bronze", [False, True])
def test_single_elimination_plays_through_for_every_size(count: int, bronze: bool, mode):
    matches = build(count, "single_elimination",
                    tournament={"bronze_match": bronze, "format": "single_elim", **mode_fields(mode)})
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


@pytest.mark.parametrize("mode", MODES, ids=MODE_IDS)
@pytest.mark.parametrize("count", range(2, 41))
@pytest.mark.parametrize("grand_final", ["reset", "single", "none"])
def test_double_elimination_plays_through_for_every_size(count: int, grand_final: str, mode):
    shuffle = mode is not None
    matches = build(count, "double_elimination",
                    tournament={"grand_final_mode": grand_final, **mode_fields(mode)})
    bracket_size = 2 ** math.ceil(math.log2(max(2, count)))
    met: dict[frozenset, list[dict]] = {}
    losses: dict[str, int] = {}

    def on_result(match, ranking):
        pair = frozenset(filled_ids(match))
        met.setdefault(pair, []).append(match)
        # Doppel-K.-o.: wer zweimal verloren hat, spielt nicht mehr - fest wie gemischt.
        if len(ranking) == 2:
            losses[ranking[1]] = losses.get(ranking[1], 0) + 1
        for row in matches:
            if row["status"] in ACTIVE:
                assert all(losses.get(reg, 0) < 2 for reg in filled_ids(row)), f"{row['match_key']}: zwei Niederlagen"

    play_through(matches, random.Random(count * 7 + len(grand_final)), on_result=on_result)

    for pair, rows in met.items():
        for again in rows[1:]:
            if section_of(again) == "GF":
                continue
            assert section_of(again) == "LB"
            # Gemischt ist ein Wiedersehen im Loser Bracket jederzeit möglich - echtes Los (#1548).
            if not shuffle:
                assert loser_round_of(again) >= earliest_allowed_rematch_round(bracket_size), \
                    f"Wiedersehen {sorted(pair)} schon in {again['round_name']}"
    for match in matches:
        group = (match.get("settings") or {}).get("draw_group")
        if group:
            # Im Loser Bracket nur zwischen Spielen derselben Loser-Runde gemischt (#1548).
            assert {section_of(m) for m in group_targets(matches, group)} == {section_of(match)}
            assert {m["round"] for m in group_targets(matches, group)} == {match["round"]}

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

@pytest.mark.parametrize("mode", MODES, ids=MODE_IDS)
@pytest.mark.parametrize("match_size,qualifiers", [(3, 1), (3, 2), (4, 1), (4, 2), (8, 1), (8, 2)])
@pytest.mark.parametrize("count", range(2, 41))
def test_ffa_bracket_plays_through_balanced_for_every_size(count: int, match_size: int, qualifiers: int, mode):
    matches = build(count, "ffa_custom_bracket", "ffa", settings={"match_size": match_size, "qualifiers_per_match": qualifiers},
                    tournament=mode)
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


def test_reset_rule_follows_origin_not_slot_number_when_rounds_are_shuffled():
    """Gemischt (#1548): ob ein Reset nötig ist, entscheidet die Herkunft des Finalisten, nicht die Platznummer -
    auch wenn der Sieger der Siegerrunde im Grand Final auf Platz 2 sitzt."""
    matches = build(4, "double_elimination", tournament={"randomize_advancement_rounds": True})
    by_key = {m["match_key"]: m for m in matches}
    gf = by_key["GF"]
    # Der niedrigere Seed gewinnt immer: r1 gewinnt die Siegerrunde, r2 die Verliererrunde.
    while gf["status"] != "ready":
        match = next(m for m in matches if m["status"] == "ready")
        apply_result(matches, match, sorted(filled_ids(match), key=lambda reg: int(reg[1:])))
    upper, lower = gf["slots"]
    gf["slots"] = [{**lower, "slot": 1}, {**upper, "slot": 2}]
    assert gf["slots"][1]["registration_id"] == "r1", "der Sieger der Siegerrunde sitzt auf Platz 2"
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


@pytest.mark.parametrize("mode", MODES, ids=MODE_IDS)
@pytest.mark.parametrize("match_size,qualifiers", [(3, 1), (4, 2), (8, 2)])
@pytest.mark.parametrize("count", range(3, 41))
def test_ffa_bracket_survives_random_dropouts_after_round_one(count: int, match_size: int, qualifiers: int, mode):
    """Nach Runde 1 fallen zufällig Fahrer aus (Wertung „nicht erschienen“ und Ausfall vor dem Start): der Planer legt
    zusammen, gleicht aus und kürzt ab - das Finale ist immer erreichbar, kein gespielter Lauf hat weniger als 2,
    das Finale nie mehr als die Laufgröße. Gemischt (#1548): erst wird ausgelost, dann umgebaut."""
    rng = random.Random(count * 1000 + match_size * 10 + qualifiers)
    stage = {"id": "s", "number": 1, "stage_type": "ffa_custom_bracket", "match_type": "ffa",
             "settings": {"match_size": match_size, "qualifiers_per_match": qualifiers, "min_players": 2}}
    base = {"id": "t", "seeding_mode": "manual", "max_participants": count, **mode_fields(mode)}
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
            assert_draws_wait_for_whole_round(matches)
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
        assert_draws_wait_for_whole_round(matches)
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


# Ausscheiden fest und sofort zufällig (#1590). „Auslosung nach der Runde“ fehlt bei K.-o. und Doppel-K.-o. bewusst.
# FFA-Läufe in allen drei Modi (#1596): ein Austritt streicht die Weiterleitung eines gefahrenen Laufs nicht mehr (keine
# zwei „Finals“), leere Plätze aus einem Ausscheiden ziehen beim Zusammenlegen mit (keine doppelte Quelle). Gemischt kam
# die doppelte Quelle noch selten vor (1 von 1.200 Läufen): ein Freilos-Platz, für den der Vorlauf nach dem Los niemanden
# schickte, fiel beim Zusammenlegen weg. Er zieht jetzt samt Weiterleitung mit - 0 von 18.240 Läufen mit festem Los.
REMOVAL_MODES = [None, INSTANT]
REMOVAL_MODE_IDS = ["fest", "sofort"]
FFA_REMOVAL_MODES = [None, SHUFFLE, INSTANT]
FFA_REMOVAL_MODE_IDS = ["fest", "gemischt", "sofort"]


@pytest.mark.parametrize("mode", REMOVAL_MODES, ids=REMOVAL_MODE_IDS)
@pytest.mark.parametrize("count", range(3, 41))
def test_single_elimination_survives_random_disqualifications(count: int, mode):
    matches = build(count, "single_elimination", tournament={"bronze_match": count % 2 == 0, "format": "single_elim", **mode_fields(mode)})
    removed = _play_with_random_removals(matches, random.Random(count * 11))
    final = max((m for m in matches if section_of(m) in {"WB", "MAIN"}), key=lambda m: m["round"])
    assert final["status"] == "completed"
    champion = final["results"][0]["registration_id"]
    assert champion not in removed, "ein Ausgeschiedener gewinnt nie"


@pytest.mark.parametrize("mode", REMOVAL_MODES, ids=REMOVAL_MODE_IDS)
@pytest.mark.parametrize("count", range(3, 41))
def test_double_elimination_survives_random_disqualifications(count: int, mode):
    matches = build(count, "double_elimination", tournament=mode)
    removed = _play_with_random_removals(matches, random.Random(count * 13))
    gf = sorted((m for m in matches if section_of(m) == "GF"), key=lambda m: m["round"])
    assert gf and gf[0]["status"] in TERMINAL
    rows = stage_standings(matches, registrations(count))
    assert rows[0]["registration_id"] not in removed
    # Reset-Regel auch nach einem kampflosen Grand Final: gewinnt die Siegerrunde, entfällt das Reset-Spiel.
    if gf[0]["status"] == "completed" and len(gf) == 2:
        champion = gf[0]["results"][0]["registration_id"]
        upper = gf[0]["slots"][0].get("registration_id")
        if champion == upper:
            assert gf[1]["status"] == "cancelled" and gf[1]["result_meta"]["source"] == "bracket_reset", \
                "Sieg der Siegerrunde (auch kampflos): das Reset-Spiel ist nicht nötig"
        else:
            assert gf[1]["status"] == "completed"


def ffa_with_removals(count: int, match_size: int, qualifiers: int, mode,
                      removal_seed: int) -> tuple[list[dict], set[str]]:
    """Ein FFA-Baum, mit zufälligen Ausfällen (Startwert ``removal_seed``) zu Ende gespielt; das Los kommt aus
    ``seeded_draw`` bzw. ``seed_draw``."""
    stage = {"id": "s", "number": 1, "stage_type": "ffa_custom_bracket", "match_type": "ffa",
             "settings": {"match_size": match_size, "qualifiers_per_match": qualifiers, "min_players": 2}}
    base = {"id": "t", "seeding_mode": "manual", "max_participants": count, **mode_fields(mode)}
    matches = build_matches_v2_from_schema(base, stage, registrations(count))
    _rebuild(matches, stage)
    removed = _play_with_random_removals(matches, random.Random(removal_seed), stage=stage)
    return matches, removed


def finals_of(matches: list[dict]) -> list[dict]:
    """Das Finale: der gefahrene Lauf ohne Weg weiter - das gebaute oder das abgekürzte (#1550). Ein gefahrener Lauf
    behält seinen Weg, auch wenn seine Weiterkommer danach alle ausgeschieden sind (#1596) - selbst wenn er in einer
    späteren Runde liegt als das Finale, weil davor abgekürzt wurde (#2033): er ist kein zweites Finale."""
    return [m for m in matches if m["status"] == "completed" and not m.get("advancement")]


def assert_ffa_outcome(matches: list[dict], match_size: int, removed: set[str]) -> None:
    """Nach dem Durchspielen mit Ausfällen: genau ein Finale, kein gefahrener Lauf über der Laufgröße oder unter 2,
    kein Ausgeschiedener in einem offenen Lauf."""
    finals = finals_of(matches)
    assert len(finals) == 1, f"genau ein Finale: {[m['match_key'] for m in finals]}"
    for match in matches:
        if match["status"] == "completed" and (match.get("result_meta") or {}).get("source") != "auto_bye":
            assert 2 <= len(match["results"]) <= match_size, \
                f"{match['match_key']} wurde mit {len(match['results'])} gefahren (Laufgröße {match_size})"
        seated = [slot.get("registration_id") for slot in match["slots"] if slot.get("status") == "filled"]
        if match["status"] not in TERMINAL:
            assert not (set(seated) & removed)


@pytest.mark.parametrize("mode", FFA_REMOVAL_MODES, ids=FFA_REMOVAL_MODE_IDS)
@pytest.mark.parametrize("match_size,qualifiers", [(3, 1), (4, 2), (8, 2)])
@pytest.mark.parametrize("count", range(3, 41))
def test_ffa_bracket_survives_random_disqualifications(count: int, match_size: int, qualifiers: int, mode):
    matches, removed = ffa_with_removals(count, match_size, qualifiers, mode, count * 17 + match_size)
    assert_ffa_outcome(matches, match_size, removed)


@pytest.mark.parametrize("mode", FFA_REMOVAL_MODES, ids=FFA_REMOVAL_MODE_IDS)
def test_ffa_removals_over_many_draws_and_dropout_orders(seeded_draw, mode):
    """Breite statt Zufall (#2033): ein Raster über Größen, Laufgrößen und Quoten mit je zwei Losen und
    Ausfall-Reihenfolgen - alle Verstöße auf einmal, damit ein roter Fall mit seinen Startwerten nachstellbar ist."""
    failures: list[tuple] = []
    for count in range(3, 41, 2):
        for match_size, qualifiers in [(3, 1), (3, 2), (4, 1), (4, 2), (8, 1), (8, 2)]:
            for seed in range(2):
                draw_seed = seed * 7919 + count * 17 + match_size * 10 + qualifiers
                seeded_draw.seed(draw_seed)
                try:
                    matches, removed = ffa_with_removals(count, match_size, qualifiers, mode, draw_seed + 1)
                    assert_ffa_outcome(matches, match_size, removed)
                except AssertionError as exc:
                    failures.append((count, match_size, qualifiers, draw_seed, str(exc).splitlines()[0]))
    assert not failures, failures


@pytest.mark.parametrize("mode,count,match_size,qualifiers,draw_seed,removal_seed", [
    # Das Finale erwartete 5 bei Laufgröße 4: 34 Fahrer, Laufgröße 4, Quote 2 - fester Baum (Ausfall-Startwerte aus
    # der Suche über 3.000) wie sofort zufällig (Los 989, Ausfälle wie im Test).
    pytest.param(None, 34, 4, 2, 0, 244, id="fest-34-244"),
    pytest.param(None, 34, 4, 2, 0, 2054, id="fest-34-2054"),
    pytest.param(INSTANT, 34, 4, 2, 989, 34 * 17 + 4, id="sofort-34-989"),
    # Die gewachsene Quote zeigte in einen Lauf, den die Gruppe vorher nicht belieferte - der war mit 3 schon voll,
    # und sein Nachbar in der Folgerunde gleicht ihn nicht aus (anderes Ziel): ein Lauf mit 4 bei Laufgröße 3.
    pytest.param(None, 25, 3, 2, 8376, 8377, id="fest-25-8377"),
    # Dieselbe Lücke, mit Nachbar: die Folgerunde hätte 7 auf zwei Läufe zu 3 verteilt und einen Teil verloren.
    pytest.param(INSTANT, 21, 3, 2, 15, 15 * 7919 + 21 * 17 + 3, id="sofort-21-15"),
    pytest.param(INSTANT, 34, 3, 2, 5, 5 * 7919 + 34 * 17 + 3, id="sofort-34-5"),
    # Fester Baum, Suche über alle Größen mit 300 Ausfall-Reihenfolgen (15 rot von 68.400): Finale mit 5 bei
    # Laufgröße 4 bzw. 4 bei 3, zwei Quellen auf einem Platz (Einträge beim Verteilen verloren), ein spät gefahrener
    # Lauf ohne Verbliebene neben dem abgekürzten Finale.
    pytest.param(None, 17, 4, 2, 0, 260, id="fest-17-260"),
    pytest.param(None, 29, 3, 2, 0, 108, id="fest-29-108"),
    pytest.param(None, 40, 3, 2, 0, 93, id="fest-40-93"),
    pytest.param(None, 23, 3, 2, 0, 79, id="fest-23-79"),
    pytest.param(None, 33, 3, 2, 0, 284, id="fest-33-284"),
    pytest.param(None, 13, 3, 2, 0, 110, id="fest-13-110"),
])
def test_quota_regrowth_counts_what_the_targets_already_hold(monkeypatch, mode, count, match_size, qualifiers,
                                                             draw_seed, removal_seed):
    """#2033: ein gefahrener Lauf verliert danach Fahrer und liefert weniger; Zielläufe werden zusammengelegt, damit
    haben Vorläufe (einer nur noch mit Quote 1) dasselbe Ziel, werden ausgeglichen, und die Quote wächst wieder. Die
    Kappung der Gruppe zählte nur die Quoten der umbaubaren Läufe - nicht, was im Ziel schon saß oder von einem
    gefahrenen Lauf noch kam, und nicht das Ziel, in das die gewachsene Quote neu zeigte."""
    seed_draw(monkeypatch, draw_seed)
    matches, removed = ffa_with_removals(count, match_size, qualifiers, mode, removal_seed)
    assert_ffa_outcome(matches, match_size, removed)


def test_a_later_driven_heat_whose_drivers_all_left_is_no_second_final(monkeypatch):
    """#2033, sofort zufällig, Los 728: ein Halbfinale ist gefahren, danach scheiden alle drei Fahrer aus. Die drei
    Verbliebenen stehen in einem Lauf der Runde davor - er wird zum Finale abgekürzt, die späteren Läufe entfallen. Der
    gefahrene Lauf behält seinen Weg (#1596), auch wenn der ins Leere führt: genau ein Finale, eine Runde davor."""
    seed_draw(monkeypatch, 728)
    matches, removed = ffa_with_removals(34, 4, 2, INSTANT, 34 * 17 + 4)
    assert_ffa_outcome(matches, 4, removed)
    final = finals_of(matches)[0]
    later = [m for m in matches if m["status"] == "completed" and m["round"] > final["round"]]
    assert final.get("shortened_at") and later
    assert all(m.get("advancement") for m in later)
    assert all(row["registration_id"] in removed for m in later for row in m["results"])


def test_a_withdrawal_without_replacement_keeps_the_way_of_a_driven_heat():
    """#1596, fester Baum: 31 Fahrer, Laufgröße 3, Quote 1, Ausfälle mit Startwert 11. Der Austritt aus einem schon
    gefahrenen Lauf ohne Nachrücker strich dessen Weiterleitung - am Ende standen zwei gefahrene Läufe ohne Weg weiter
    („Finals“ P und Q). Jetzt verliert ein Lauf seine Weiterleitung nur, wenn er zum Finale abgekürzt wird."""
    matches, removed = ffa_with_removals(31, 3, 1, None, 11)
    assert_ffa_outcome(matches, 3, removed)


def test_merging_after_a_draw_keeps_one_source_per_slot(monkeypatch):
    """#1596, gemischt: 33 Fahrer, Laufgröße 4, Quote 2, Ausfälle mit Startwert 10565, Los mit Startwert 261461. Das Los
    gab Lauf O nur einen Fahrer, O kam kampflos weiter; dessen zweiter Platz im Folgelauf R blieb ein Freilos. Als R nach
    einem Ausscheiden mit S zusammengelegt wurde, fiel dieser Freilos-Platz weg, die Weiterleitung von O zeigte aber
    weiter auf seine Nummer - die bekam P: zwei Quellen auf einem Platz. Jetzt zieht jeder Freilos-Platz, auf den noch
    eine Weiterleitung zeigt, mit in den Sammellauf."""
    seed_draw(monkeypatch, 261461)
    matches, removed = ffa_with_removals(33, 4, 2, SHUFFLE, 10565)
    assert_ffa_outcome(matches, 4, removed)
