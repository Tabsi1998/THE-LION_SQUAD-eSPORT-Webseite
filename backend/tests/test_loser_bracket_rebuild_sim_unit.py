"""Läufe-Cup mit Loser Bracket bei kleinem Feld (#2044, #2045): der Planer und der Ergebnis-Anwender auf dem Schema des
Probelauf-Cups (16 Plätze, Läufe zu viert, die zwei Besten weiter, Winner und Loser Bracket, Finale).

- #2044: ein Loser-Lauf, dessen Vorläufe mit je zwei Fahrern beide weiterschicken, wartet, statt als „ohne Teilnehmer“
  abgesagt zu werden - legt der Umbau die Vorläufe zusammen, hat der Sammellauf Verlierer, und die fahren dort.
- #2045: gleicht der Umbau Läufe auf 3 oder 2 Plätze aus, passen die Verlierer-Weiterleitungen dazu (bei 3 Plätzen und
  Quote 2 nur L1, bei 2 Plätzen keiner); das Ergebnis lässt sich eintragen, die Verlierer kommen ins Loser Bracket.
- Breite (wie ``test_bracket_generator_sim_unit``, Los mit Startwert): Feldgrößen 5-16 in den Modi fest, gemischt und
  sofort, je mit Ausfall-Reihenfolgen (Austritt, Disqualifikation, nicht erschienen) - nach jedem Schritt Graph gültig,
  niemand zweimal spielbereit, kein Lauf über der Laufgröße, kein spielbereiter Lauf mit einem Fahrer; am Ende alles
  entschieden, genau ein Finale, und jede/r Verlierer:in der Winner-Seite hat die zweite Chance bekommen.

Der Umbau läuft hier wie im Betrieb in zwei Schritten: erst die Automatik (Quoten, Freilose, Absagen), dann der
bestätigte strukturelle Umbau (Zusammenlegen, Ausgleichen, Abkürzen) - #2044 lag genau zwischen den beiden.
"""
import pathlib
import random
import sys
import zlib
from collections import Counter

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import advancement_draw, custom_bracket, match_v2_results  # noqa: E402
from services.competition_graph_validation import validate_competition_graph  # noqa: E402
from services.competition_snapshot import build_structure_snapshot  # noqa: E402
from services.custom_bracket import build_matches_v2_from_schema  # noqa: E402
from services.heat_rebuild import rebuild_heats, stage_heat_rules  # noqa: E402
from services.match_v2_results import build_v2_result_application  # noqa: E402
from services.tournament_events import plan_removal  # noqa: E402

NOW = "2026-10-31T18:00:00+00:00"
PLACES = 16
HEAT_SIZE = 4
QUOTA = 2
TERMINAL = {"completed", "forfeit", "cancelled"}
OPEN = {"ready", "scheduled", "in_progress", "waiting_result"}
SHUFFLE = {"randomize_advancement_rounds": True}
INSTANT = {"advancement_mode": "instant"}
MODES = [None, SHUFFLE, INSTANT]
MODE_IDS = ["fest", "gemischt", "sofort"]

# Der Probelauf-Cup (scripts/probelauf_mitspieler.py): 16 Plätze, Läufe zu viert, Winner und Loser Bracket, Finale.
LB_CUP = """[WB]
A=[1,2,3,4]
B=[5,6,7,8]
C=[9,10,11,12]
D=[13,14,15,16]
E=[W:A:1,W:A:2,W:B:1,W:B:2]
F=[W:C:1,W:C:2,W:D:1,W:D:2]
G=[W:E:1,W:E:2,W:F:1,W:F:2]

[LB]
LA=[L:A:1,L:A:2,L:B:1,L:B:2]
LB=[L:C:1,L:C:2,L:D:1,L:D:2]
LC=[W:LA:1,W:LA:2,L:E:1,L:E:2]
LD=[W:LB:1,W:LB:2,L:F:1,L:F:2]
LE=[W:LC:1,W:LC:2,W:LD:1,W:LD:2]
LF=[W:LE:1,W:LE:2,L:G:1,L:G:2]

[FINAL]
FINAL=[W:G:1,W:G:2,W:LF:1,W:LF:2]"""


def seed_draw(monkeypatch, seed: int) -> random.Random:
    """Das Los (``DRAW_RNG``) an jeder Importstelle mit Startwert - wie in ``test_bracket_generator_sim_unit``."""
    rng = random.Random(seed)
    for module in (advancement_draw, custom_bracket, match_v2_results):
        monkeypatch.setattr(module, "DRAW_RNG", rng)
    for name, module in list(sys.modules.items()):
        if name.startswith("services.") and hasattr(module, "DRAW_RNG"):
            monkeypatch.setattr(module, "DRAW_RNG", rng)
    return rng


@pytest.fixture(autouse=True)
def seeded_draw(request, monkeypatch) -> random.Random:
    return seed_draw(monkeypatch, zlib.crc32(request.node.nodeid.encode("utf-8")))


# ---------------------------------------------------------------------------------------------- Bauen und spielen


def registrations(count: int) -> list[dict]:
    return [{"id": f"r{i}", "user_id": f"u{i}", "status": "approved", "seed": i} for i in range(1, count + 1)]


def build(count: int, mode: dict | None = None) -> tuple[list[dict], dict]:
    stage = {"id": "s", "number": 1, "stage_type": "ffa_custom_bracket", "match_type": "ffa",
             "settings": {"schema": LB_CUP, "match_size": HEAT_SIZE, "qualifiers_per_match": QUOTA, "min_players": 2}}
    tournament = {"id": "t", "seeding_mode": "manual", "max_participants": PLACES, **(mode or {})}
    return build_matches_v2_from_schema(tournament, stage, registrations(count)), stage


def rebuild(matches: list[dict], stage: dict) -> list[dict]:
    """Wie ``evaluate_heat_rebuild`` mit Bestätigung: erst die Automatik, dann der strukturelle Umbau."""
    rules = stage_heat_rules(stage, matches)
    ops = rebuild_heats(matches, now_iso=NOW, structural=False, **rules)["ops"]
    ops += rebuild_heats(matches, now_iso=NOW, structural=True, **rules)["ops"]
    return ops


def by_key(matches: list[dict]) -> dict[str, dict]:
    return {m["match_key"]: m for m in matches}


def filled_ids(match: dict) -> list[str]:
    return [s["registration_id"] for s in match["slots"] if s.get("status") == "filled" and s.get("registration_id")]


def expected(match: dict) -> list[dict]:
    return [s for s in match["slots"] if s.get("status") in {"filled", "pending"}]


def auto_bye(match: dict) -> bool:
    return (match.get("result_meta") or {}).get("source") == "auto_bye"


def apply_result(matches: list[dict], match: dict, ranking: list[str], *, forfeit: set[str] = frozenset(),
                 eliminated: set[str] = frozenset(), force: bool = False) -> dict:
    raw = [{"registration_id": reg, "rank": index + 1, "forfeit": reg in forfeit} for index, reg in enumerate(ranking)]
    application = build_v2_result_application(match, matches, raw, actor_id="staff", now_iso=NOW,
                                              eliminated=eliminated, force=force)
    match.update(application["match_set"])
    by_id = {row["id"]: row for row in matches}
    for target_id, update in application["target_sets"].items():
        by_id[target_id].update(update)
    return application


def remove(matches: list[dict], registration_id: str, kind: str, removed: set[str]) -> dict:
    return plan_removal(matches, registration_id, kind=kind, now_iso=NOW, eliminated=removed)


# ---------------------------------------------------------------------------------------------- Invarianten


def quota_of(match: dict) -> int:
    settings = match.get("settings") or {}
    return int(match.get("qualifiers_effective") or settings.get("qualifiers_per_match") or 0)


def check(matches: list[dict], removed: set[str], where: str) -> None:
    """Nach jedem Schritt: was am Abend nie passieren darf (wie ``Abend.check`` in der Generalprobe)."""
    by_id = {m["id"]: m for m in matches}
    for match in matches:
        key = match["match_key"]
        if match["status"] == "cancelled":
            continue
        people = filled_ids(match)
        assert len(people) == len(set(people)), f"{where}: {key} hat jemanden doppelt"
        if match["status"] not in TERMINAL:
            assert len(expected(match)) <= HEAT_SIZE, f"{where}: {key} erwartet {len(expected(match))} Fahrer"
            if match["status"] in OPEN:
                assert len(expected(match)) != 1, f"{where}: {key} wartet mit einem einzigen Fahrer"
            assert not set(people) & removed, f"{where}: Ausgeschiedene in {key}"
        else:
            assert len(match.get("results") or []) <= HEAT_SIZE, f"{where}: {key} zu groß gewertet"
        drivers = len(match.get("results") or []) if match["status"] in TERMINAL else len(expected(match))
        quota = quota_of(match)
        for forward in match.get("advancement") or []:
            target = by_id.get(forward.get("to_match_id"))
            assert target, f"{where}: {key} leitet ins Leere ({forward})"
            rank = int(forward.get("rank") or 0)
            if target["status"] == "cancelled":
                winner = forward.get("flow") == "W"
                reachable = rank <= min(quota, drivers) if winner else quota + rank <= drivers
                assert not reachable, \
                    f"{where}: {key} schickt {forward.get('flow')}{rank} in den abgesagten Lauf {target['match_key']}"
                continue
            assert any(s.get("slot") == forward.get("to_slot") for s in target["slots"]), \
                f"{where}: {key} leitet auf einen Platz in {target['match_key']}, den es nicht gibt"
    seats = Counter(reg for row in matches if row["status"] in OPEN for reg in filled_ids(row))
    assert not [reg for reg, count in seats.items() if count > 1], f"{where}: zugleich in zwei offenen Läufen"
    report = validate_competition_graph(build_structure_snapshot("t", stage_matches=matches))
    errors = [issue for issue in report["issues"] if issue.get("severity") == "error"]
    assert report["valid"] and not errors, f"{where}: Graph ungültig: {errors}"


def check_end(matches: list[dict], removed: set[str]) -> dict:
    """Ende: alles entschieden, genau ein Finale, kein gefahrener Lauf mit einem Fahrer, jede/r Verlierer:in der
    Winner-Seite sitzt (oder saß, bis zum eigenen Ausscheiden) im Loser Bracket."""
    open_rows = [m["match_key"] for m in matches if m["status"] not in TERMINAL]
    assert not open_rows, f"am Ende noch offen: {open_rows}"
    finals = [m for m in matches if m["status"] == "completed" and not m.get("advancement") and not auto_bye(m)]
    assert len(finals) == 1, f"genau ein Finale: {[m['match_key'] for m in finals]}"
    assert 2 <= len(finals[0]["results"]) <= HEAT_SIZE
    assert finals[0]["results"][0]["registration_id"] not in removed, "ein Ausgeschiedener gewinnt nie"
    for match in matches:
        if match["status"] == "completed" and not auto_bye(match):
            assert 2 <= len(match["results"]) <= HEAT_SIZE, f"{match['match_key']} mit {len(match['results'])} gefahren"
    # Wo jemand aus einem Lauf hingekommen ist - auch auf dem Sieger-Weg: wer nach einem Ausscheiden im Finale
    # nachrückt, verlässt dafür das Loser Bracket (#1839).
    seated_from: dict[tuple[str, str], str] = {}
    for match in matches:
        for slot in match["slots"]:
            origin = slot.get("source_result") or {}
            if slot.get("registration_id") and origin.get("from_match_id"):
                seated_from[(origin.get("from_match_id"), slot["registration_id"])] = match["match_key"]
    for match in matches:
        if match.get("section") != "WB" or match["status"] != "completed" or auto_bye(match):
            continue
        quota = quota_of(match)
        if not any(entry.get("flow") == "L" for entry in match.get("advancement") or []):
            continue
        losers = [row["registration_id"] for row in match["results"]
                  if int(row.get("rank") or 0) > quota and not row.get("forfeit") and not row.get("eliminated")]
        for loser in losers:
            if loser in removed:
                continue
            assert (match["id"], loser) in seated_from, \
                f"{loser} (Platz > {quota} in {match['match_key']}) hat keine zweite Chance im Loser Bracket bekommen"
    return finals[0]


# ---------------------------------------------------------------------------------------------- Der Abend


def play(matches: list[dict], stage: dict, rng: random.Random, *, removals: bool, forfeits: bool) -> set[str]:
    """Spielt durch - mit Störungen nach ``rng``: Austritt, Disqualifikation, nicht erschienen im Lauf und eine
    Korrektur (Platz 2 und 3 getauscht) in einem schon gefahrenen Lauf, dessen Folgeläufe noch offen sind."""
    removed: set[str] = set()
    rebuild(matches, stage)
    check(matches, removed, "Aufbau")
    for step in range(10_000):
        ready = [m for m in matches if m["status"] == "ready"]
        if not ready:
            break
        alive = sorted({reg for m in matches if m["status"] not in TERMINAL for reg in filled_ids(m)} - removed)
        if removals and len(alive) > 3 and rng.random() < 0.2:
            victim = rng.choice(alive)
            remove(matches, victim, rng.choice(["withdrawn", "disqualified"]), removed)
            removed.add(victim)
            rebuild(matches, stage)
            check(matches, removed, f"Schritt {step}: Ausscheiden {victim}")
            continue
        by_id = {m["id"]: m for m in matches}
        fixable = [m for m in matches if m["status"] == "completed" and not auto_bye(m) and len(m["results"]) >= 3
                   and not any(row.get("forfeit") or row["registration_id"] in removed for row in m["results"])
                   and all(by_id[e["to_match_id"]]["status"] in {"pending", "ready", "cancelled"}
                           for e in m.get("advancement") or [])]
        if forfeits and fixable and rng.random() < 0.1:
            heat = rng.choice(fixable)
            order = [row["registration_id"] for row in heat["results"]]
            swapped = [order[0], order[2], order[1], *order[3:]]
            apply_result(matches, heat, swapped, eliminated=removed, force=True)
            rebuild(matches, stage)
            check(matches, removed, f"Schritt {step}: Korrektur {heat['match_key']}")
            continue
        match = rng.choice(ready)
        ranking = filled_ids(match)
        rng.shuffle(ranking)
        forfeit = {ranking[-1]} if forfeits and len(ranking) >= 3 and rng.random() < 0.2 else set()
        apply_result(matches, match, ranking, forfeit=forfeit, eliminated=removed)
        rebuild(matches, stage)
        check(matches, removed, f"Schritt {step}: Ergebnis {match['match_key']}")
    return removed


# ---------------------------------------------------------------------------------------------- #2044, #2045


def test_waiting_loser_heat_gets_the_losers_of_the_merged_heat():
    """#2044: 10 Fahrer auf 16 Plätzen - C und D haben je 2. Die Automatik sagt LB nicht ab (die Quellen leben noch);
    der bestätigte Umbau legt C und D zusammen, und die beiden Verlierer des Sammellaufs fahren in LB."""
    matches, stage = build(10)
    heats = by_key(matches)
    assert [len(filled_ids(heats[k])) for k in "ABCD"] == [3, 3, 2, 2]
    rules = stage_heat_rules(stage, matches)
    automatic = rebuild_heats(matches, now_iso=NOW, structural=False, **rules)
    assert heats["LB"]["status"] == "pending", "LB wartet auf C und D statt abgesagt zu werden"
    assert "cancelled" not in [op["kind"] for op in automatic["ops"]]
    structural = rebuild_heats(matches, now_iso=NOW, structural=True, **rules)
    assert any(op["kind"] == "merged" and op["heats"] == ["C", "D"] for op in structural["ops"])
    assert heats["D"]["status"] == "cancelled" and len(filled_ids(heats["C"])) == 4
    assert heats["C"]["settings"]["qualifiers_per_match"] == 2
    assert sorted((e["flow"], e["rank"], e["to_match_key"]) for e in heats["C"]["advancement"]) == \
        [("L", 1, "LA"), ("L", 2, "LA"), ("W", 1, "F"), ("W", 2, "F")] or \
        sorted((e["flow"], e["rank"], e["to_match_key"]) for e in heats["C"]["advancement"]) == \
        [("L", 1, "LB"), ("L", 2, "LB"), ("W", 1, "F"), ("W", 2, "F")]
    check(matches, set(), "nach dem Umbau")
    order = filled_ids(heats["C"])
    apply_result(matches, heats["C"], order)
    rebuild(matches, stage)
    second_chance = [m for m in matches if m.get("section") == "LB" and m["status"] != "cancelled"
                     and set(order[2:]) <= set(filled_ids(m))]
    assert second_chance, "die Verlierer von C fahren im Loser Bracket weiter"
    removed = play(matches, stage, random.Random(10), removals=False, forfeits=False)
    check_end(matches, removed)


def test_rebalanced_heats_accept_results_and_send_losers_to_the_loser_bracket():
    """#2045: Baum mit 16 fest, aus B treten drei aus - A und B werden auf 3 und 2 ausgeglichen: der Dreier-Lauf
    schickt 2 weiter und einen ins Loser Bracket (nur L1), der Zweier-Lauf 1 weiter und einen ins Loser Bracket; beide
    Ergebnisse gehen durch, der Dritte aus dem Dreier-Lauf sitzt im Loser Bracket."""
    matches, stage = build(16)
    heats = by_key(matches)
    removed: set[str] = set()
    for reg in filled_ids(heats["B"])[1:]:
        remove(matches, reg, "withdrawn", removed)
        removed.add(reg)
        rebuild(matches, stage)
        check(matches, removed, f"Austritt {reg}")
    sizes = sorted(len(filled_ids(heats[k])) for k in "AB")
    assert sizes == [2, 3], sizes
    three = heats["A"] if len(filled_ids(heats["A"])) == 3 else heats["B"]
    two = heats["B"] if three is heats["A"] else heats["A"]
    assert three["settings"]["qualifiers_per_match"] == 2 and two["settings"]["qualifiers_per_match"] == 1
    assert [e["rank"] for e in three["advancement"] if e["flow"] == "L"] == [1]
    assert [e["rank"] for e in two["advancement"] if e["flow"] == "L"] == [1]
    for heat in (three, two):
        application = apply_result(matches, heat, filled_ids(heat), eliminated=removed)
        assert application["match_set"]["status"] == "completed"
        rebuild(matches, stage)
        check(matches, removed, f"Ergebnis {heat['match_key']}")
    third = three["results"][2]["registration_id"]
    assert third in filled_ids(heats["LA"]), "der Dritte aus dem Dreier-Lauf sitzt im Loser Bracket"
    removed |= play(matches, stage, random.Random(16), removals=False, forfeits=False)
    check_end(matches, removed)


def test_rebuild_is_idempotent_on_the_loser_bracket_cup():
    for count in (7, 9, 10, 12):
        matches, stage = build(count)
        rebuild(matches, stage)
        fingerprint = [(m["match_key"], m["status"], [s.get("registration_id") for s in m["slots"]],
                        m["settings"].get("qualifiers_per_match"), m.get("advancement")) for m in matches]
        assert rebuild(matches, stage) == [], f"{count}: der zweite Umbau ändert noch etwas"
        assert [(m["match_key"], m["status"], [s.get("registration_id") for s in m["slots"]],
                 m["settings"].get("qualifiers_per_match"), m.get("advancement")) for m in matches] == fingerprint


# ---------------------------------------------------------------------------------------------- Breite


@pytest.mark.parametrize("mode", MODES, ids=MODE_IDS)
@pytest.mark.parametrize("count", range(5, 17))
def test_loser_bracket_cup_plays_through_for_every_field_size(count: int, mode):
    """5-16 Fahrer auf 16 Plätzen ohne Ausfälle: der Abend endet mit genau einem Finale, jede/r Verlierer:in der
    Winner-Seite bekommt die zweite Chance."""
    matches, stage = build(count, mode)
    removed = play(matches, stage, random.Random(count), removals=False, forfeits=False)
    check_end(matches, removed)


@pytest.mark.parametrize("mode", MODES, ids=MODE_IDS)
def test_loser_bracket_cup_over_many_draws_and_dropout_orders(seeded_draw, mode):
    """Breite statt Zufall: Feldgrößen 5-16 mit je drei Losen und Ausfall-Reihenfolgen (Austritt, Disqualifikation,
    nicht erschienen) - alle Verstöße auf einmal, damit ein roter Fall mit seinen Startwerten nachstellbar ist."""
    failures: list[tuple] = []
    for count in range(5, 17):
        for seed in range(3):
            draw_seed = seed * 7919 + count * 17
            seeded_draw.seed(draw_seed)
            try:
                matches, stage = build(count, mode)
                removed = play(matches, stage, random.Random(draw_seed + 1), removals=True, forfeits=True)
                check_end(matches, removed)
            except AssertionError as exc:
                failures.append((count, draw_seed, str(exc).splitlines()[0]))
    assert not failures, failures
