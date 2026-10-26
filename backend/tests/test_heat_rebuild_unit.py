"""FFA-Läufe zusammenlegen, ausgleichen und abkürzen (#1550) - der reine Planer auf echten Bäumen.

Die Läufe einer Runde mit demselben Ziel bilden eine Lauf-Gruppe. Passen alle Verbliebenen in weniger Läufe, werden
sie zusammengelegt (Sammellauf = kleinste ``order``, die anderen ``cancelled`` mit ``merged_into``); ist der
Unterschied größer als 1, wird in Schlangenlinie ausgeglichen; sind im Sammellauf alle Verbliebenen, ist er das
Finale und spätere Runden entfallen. Läufe, die laufen oder aufgerufen sind, bleiben unangetastet.
"""
import pathlib
import random
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.competition_graph_validation import validate_competition_graph  # noqa: E402
from services.competition_snapshot import build_structure_snapshot  # noqa: E402
from services.custom_bracket import build_matches_v2_from_schema  # noqa: E402
from services.heat_rebuild import rebuild_heats, stage_heat_rules  # noqa: E402
from services.match_v2_results import build_v2_result_application  # noqa: E402

NOW = "2026-10-31T10:00:00+00:00"

SIXTEEN = """[WB]
# Runde 1
A=[1,2,3,4]
B=[5,6,7,8]
C=[9,10,11,12]
D=[13,14,15,16]
# Halbfinale
E=[W:A:1,W:A:2,W:B:1,W:B:2]
F=[W:C:1,W:C:2,W:D:1,W:D:2]
# Finale
G=[W:E:1,W:E:2,W:F:1,W:F:2]
"""

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


def stage_for(schema: str | None, match_size: int = 4, qualifiers: int = 2) -> dict:
    settings = {"match_size": match_size, "qualifiers_per_match": qualifiers, "min_players": 2}
    if schema:
        settings["schema"] = schema
    return {"id": "s", "number": 1, "stage_type": "ffa_custom_bracket", "match_type": "ffa", "settings": settings}


def build(count: int, schema: str | None = None, match_size: int = 4, qualifiers: int = 2) -> tuple[list[dict], dict]:
    stage = stage_for(schema, match_size, qualifiers)
    tournament = {"id": "t", "seeding_mode": "manual", "max_participants": count}
    return build_matches_v2_from_schema(tournament, stage, registrations(count)), stage


def rebuild(matches: list[dict], stage: dict, **kwargs) -> dict:
    return rebuild_heats(matches, now_iso=NOW, **stage_heat_rules(stage, matches), **kwargs)


def by_key(matches: list[dict]) -> dict[str, dict]:
    return {m["match_key"]: m for m in matches}


def filled_ids(match: dict) -> list[str]:
    return [s["registration_id"] for s in match["slots"] if s.get("status") == "filled" and s.get("registration_id")]


def apply_result(matches: list[dict], match: dict, ranking: list[str], force: bool = False) -> dict:
    raw = [{"registration_id": reg, "rank": index + 1} for index, reg in enumerate(ranking)]
    application = build_v2_result_application(match, matches, raw, actor_id="staff", now_iso=NOW, force=force)
    match.update(application["match_set"])
    by_id = {row["id"]: row for row in matches}
    for target_id, update in application["target_sets"].items():
        by_id[target_id].update(update)
    return application


def play_through(matches: list[dict], stage: dict, rng: random.Random) -> None:
    for _ in range(1000):
        ready = [m for m in matches if m["status"] == "ready"]
        if not ready:
            break
        match = rng.choice(ready)
        ranking = filled_ids(match)
        rng.shuffle(ranking)
        apply_result(matches, match, ranking)
        rebuild(matches, stage)
    assert all(m["status"] in {"completed", "forfeit", "cancelled"} for m in matches), "nicht alles entschieden"


def played_heats(matches: list[dict]) -> list[dict]:
    return [m for m in matches if m["status"] == "completed" and (m.get("result_meta") or {}).get("source") != "auto_bye"]


def final_of(matches: list[dict]) -> dict:
    finals = [m for m in matches if m["status"] == "completed" and not m.get("advancement")]
    assert len(finals) == 1, f"genau ein Finale erwartet, gefunden: {[m['match_key'] for m in finals]}"
    return finals[0]


def kinds(result: dict) -> list[str]:
    return [op["kind"] for op in result["ops"]]


# ---------------------------------------------------------------------------------------------- Automatik-Bäume

@pytest.mark.parametrize("count", [5, 9, 13])
def test_auto_ffa_tree_has_nothing_to_rebuild(count: int):
    """Der Generator (#1549) baut schon ausgeglichen - der Planer findet nichts."""
    matches, stage = build(count)
    before = [(m["match_key"], m["status"], len(m["slots"])) for m in matches]
    result = rebuild(matches, stage)
    assert result["ops"] == []
    assert [(m["match_key"], m["status"], len(m["slots"])) for m in matches] == before


def test_duel_brackets_are_never_touched():
    stage = {"id": "s", "number": 1, "stage_type": "single_elimination", "match_type": "duel", "settings": {}}
    matches = build_matches_v2_from_schema({"id": "t", "seeding_mode": "manual", "max_participants": 5}, stage, registrations(5))
    result = rebuild(matches, stage)
    assert result["ops"] == [] and result["changed_ids"] == []


# ---------------------------------------------------------------------------------------------- 16er-Schema

@pytest.mark.parametrize("count", [6, 7])
def test_sixteen_scheme_shortens_to_the_semifinal_as_final(count: int):
    """6 oder 7 Eingecheckte: C und D bleiben leer, F entfällt - und weil E alle Verbliebenen hat, ist E das Finale."""
    matches, stage = build(count, SIXTEEN)
    result = rebuild(matches, stage)
    heats = by_key(matches)
    assert "shortened" in kinds(result)
    assert heats["E"]["advancement"] == []
    assert heats["E"]["round_name"] == "Finale"
    assert heats["G"]["status"] == "cancelled"
    assert (heats["G"]["result_meta"] or {}).get("reason") == "shortened"
    snapshot = build_structure_snapshot("t", stage_matches=matches, stages=[stage])
    assert validate_competition_graph(snapshot)["valid"], validate_competition_graph(snapshot)["issues"]
    play_through(matches, stage, random.Random(count))
    final = final_of(matches)
    assert final["match_key"] == "E" and len(final["results"]) == 4


def test_sixteen_scheme_with_ten_merges_two_plus_two_and_rebalances():
    """10 Eingecheckte: A 3, B 3, C 2, D 2 → C und D werden ein Lauf mit 4 (2 kommen weiter); das Halbfinale wird 3 + 3."""
    matches, stage = build(10, SIXTEEN)
    result = rebuild(matches, stage)
    heats = by_key(matches)
    assert kinds(result).count("merged") == 1
    assert "rebalanced" in kinds(result)
    assert heats["D"]["status"] == "cancelled" and heats["D"]["merged_into"] == heats["C"]["id"]
    assert len(filled_ids(heats["C"])) == 4
    assert heats["C"]["settings"]["qualifiers_per_match"] == 2 and heats["C"]["qualifiers_effective"] == 2
    assert heats["C"]["status"] == "ready"
    assert heats["D"].get("station_id") is None
    semis = sorted(len([s for s in heats[k]["slots"] if s["status"] == "pending"]) for k in ("E", "F"))
    assert semis == [3, 3]
    # Jeder Zufluss hängt genau einmal im Halbfinale.
    sources = sorted((s["source"]["match_key"], s["source"]["rank"]) for k in ("E", "F") for s in heats[k]["slots"] if s["status"] == "pending")
    assert sources == [("A", 1), ("A", 2), ("B", 1), ("B", 2), ("C", 1), ("C", 2)]
    for source_key in ("A", "B", "C"):
        for entry in heats[source_key]["advancement"]:
            target = next(m for m in matches if m["id"] == entry["to_match_id"])
            slot = next(s for s in target["slots"] if s["slot"] == entry["to_slot"])
            assert (slot["source"]["match_key"], slot["source"]["rank"]) == (source_key, entry["rank"])
    snapshot = build_structure_snapshot("t", stage_matches=matches, stages=[stage])
    assert validate_competition_graph(snapshot)["valid"]
    play_through(matches, stage, random.Random(10))
    assert len(final_of(matches)["results"]) == 4
    assert all(len(m["results"]) >= 2 for m in played_heats(matches))


def test_sixteen_scheme_with_twelve_needs_nothing():
    matches, stage = build(12, SIXTEEN)
    result = rebuild(matches, stage)
    assert result["ops"] == []
    play_through(matches, stage, random.Random(12))
    assert len(final_of(matches)["results"]) == 4


def test_rebuild_is_idempotent():
    matches, stage = build(10, SIXTEEN)
    first = rebuild(matches, stage)
    assert first["ops"]
    snapshot = [(m["match_key"], m["status"], [s.get("registration_id") for s in m["slots"]], m["settings"]["qualifiers_per_match"]) for m in matches]
    second = rebuild(matches, stage)
    assert second["ops"] == [] and second["changed_ids"] == []
    assert [(m["match_key"], m["status"], [s.get("registration_id") for s in m["slots"]], m["settings"]["qualifiers_per_match"]) for m in matches] == snapshot


# ---------------------------------------------------------------------------------------------- 2 + 2 → 4, Korrektur

def test_two_plus_two_becomes_four_with_quota_two_and_a_correction_updates_in_place():
    """32er-Schema mit 20: E und F (2 + 2) werden E mit 4 und Quote 2, K und L ebenso; eine Korrektur in E danach
    tauscht die Plätze im Sammellauf K, statt ihn doppelt zu belegen - und der Planer findet nichts Neues."""
    matches, stage = build(20, THIRTY_TWO)
    result = rebuild(matches, stage)
    heats = by_key(matches)
    assert kinds(result).count("merged") == 3, kinds(result)
    assert heats["F"]["status"] == "cancelled" and heats["F"]["merged_into"] == heats["E"]["id"]
    assert len(filled_ids(heats["E"])) == 4 and heats["E"]["settings"]["qualifiers_per_match"] == 2
    assert heats["L"]["status"] == "cancelled" and heats["L"]["merged_into"] == heats["K"]["id"]
    assert sorted((s["source"]["match_key"], s["source"]["rank"]) for s in heats["K"]["slots"] if s["status"] == "pending") \
        == [("E", 1), ("E", 2), ("G", 1), ("G", 2)]
    assert [len([s for s in heats[k]["slots"] if s["status"] == "pending"]) for k in ("M", "N")] == [3, 3]

    first, second, third, fourth = filled_ids(heats["E"])
    apply_result(matches, heats["E"], [first, second, third, fourth])
    assert filled_ids(heats["K"])[:2] == [first, second]
    assert rebuild(matches, stage)["ops"] == []
    apply_result(matches, heats["E"], [second, first, third, fourth], force=True)
    assert filled_ids(heats["K"])[:2] == [second, first]
    assert len(filled_ids(heats["K"])) == 2
    assert rebuild(matches, stage)["ops"] == []
    play_through(matches, stage, random.Random(20))
    assert len(final_of(matches)["results"]) == 4
    assert all(len(m["results"]) >= 2 for m in played_heats(matches))


# ---------------------------------------------------------------------------------------------- Sperren und Modus

def test_running_or_called_heats_block_their_group():
    matches, stage = build(10, SIXTEEN)
    heats = by_key(matches)
    heats["C"]["status"] = "in_progress"
    heats["E"]["called_at"] = NOW
    result = rebuild(matches, stage)
    touched = {key for op in result["ops"] if op["kind"] in {"merged", "rebalanced", "shortened"} for key in op.get("heats", [])}
    assert not {"C", "D", "E", "F"} & touched, result["ops"]
    assert heats["C"]["status"] == "in_progress" and heats["E"]["called_at"] == NOW
    assert heats["D"]["status"] == "ready" and heats["D"].get("merged_into") is None
    # Was keiner Bestätigung braucht, läuft trotzdem: D hat 2, einer kommt weiter.
    assert heats["D"]["settings"]["qualifiers_per_match"] == 1
    assert len(heats["E"]["slots"]) == 4 and len(heats["F"]["slots"]) == 4


def test_non_structural_pass_only_adjusts_quota_and_marks_unfulfillable_sources():
    """Im Modus „Vorschlag“ läuft vor der Bestätigung nur, was keiner Bestätigung braucht: ein Lauf mit 2 schickt
    einen weiter, der Platz für den zweiten im Folgelauf ist als „Quelle unerfüllbar“ markiert."""
    matches, stage = build(10, SIXTEEN)
    result = rebuild(matches, stage, structural=False)
    heats = by_key(matches)
    assert not {"merged", "rebalanced", "shortened"} & set(kinds(result))
    assert heats["C"]["settings"]["qualifiers_per_match"] == 1 and heats["D"]["settings"]["qualifiers_per_match"] == 1
    assert [a["rank"] for a in heats["C"]["advancement"]] == [1]
    unfulfillable = [s for s in heats["F"]["slots"] if (s.get("source_result") or {}).get("reason") == "source_unfulfillable"]
    assert sorted((s["source_result"]["from_match_key"], s["source_result"]["rank"]) for s in unfulfillable) == [("C", 2), ("D", 2)]
    assert all(s["status"] == "bye" and s["source"]["type"] == "bye" and s["source"]["was"]["rank"] == 2 for s in unfulfillable)
    snapshot = build_structure_snapshot("t", stage_matches=matches, stages=[stage])
    assert validate_competition_graph(snapshot)["valid"], validate_competition_graph(snapshot)["issues"]
    assert heats["D"]["status"] == "ready"


# -------------------------------------------------------------------------------------------- Ziel schon belegt (#2033)

# Wie der Generator verteilt (Schlangenlinie): O schickt beide Weiterkommer nach R, Q beide nach S, P je einen.
NINETEEN = """[WB]
# Runde 1
X=[1,2,3,4]
Y=[5,6,7,8]
Z=[9,10,11,12]
V=[13,14,15,16]
P=[17,18,19]
# Runde 2
O=[W:X:1,W:Y:1,W:X:2,W:Y:2]
Q=[W:Z:1,W:V:1,W:Z:2,W:V:2]
# Halbfinale
R=[W:O:1,W:O:2,W:P:2]
S=[W:P:1,W:Q:1,W:Q:2]
# Finale
T=[W:R:1,W:S:1,W:R:2,W:S:2]
"""


def remove(matches: list[dict], registration_id: str, kind: str, removed: set[str]) -> None:
    from services.tournament_events import plan_removal
    plan_removal(matches, registration_id, kind=kind, now_iso=NOW, eliminated=removed)
    removed.add(registration_id)


def expected_entries(match: dict, heats: dict[str, dict]) -> int:
    """Belegte Plätze plus offene Plätze, deren Quelle den Rang noch weiterschickt - wie der Planer rechnet."""
    count = len(filled_ids(match))
    for slot in match["slots"]:
        source = slot.get("source") or {}
        origin = heats.get(source.get("match_key")) if source.get("type") == "rank" else None
        live = origin and origin["status"] not in {"completed", "forfeit", "cancelled"}
        quota = origin["settings"]["qualifiers_per_match"] if origin else 0
        if slot.get("status") == "pending" and live and int(source.get("rank") or 0) <= quota:
            count += 1
    return count


def test_quota_regrowth_counts_what_a_driven_heat_already_delivered():
    """#2033, fester Baum: X und Y verlieren je zwei Fahrer und werden zu X mit 4 - O erwartet nur noch 2, Quote 1,
    schickt also nur noch nach R; Q (voll) schickt nur nach S. P ist gefahren und verliert danach zwei seiner drei
    Fahrer, liefert nur noch r18 nach S. R und S erwarten zusammen 4 und werden zu R zusammengelegt - damit haben O und
    Q dasselbe Ziel, werden ausgeglichen (2 + 4 → 3 + 3), und O's Quote wächst wieder auf 2. Die Kappung der Gruppe
    zählte nur die umbaubaren Läufe O und Q (2 + 2 = 4), nicht den gefahrenen P, der in R schon einen Platz belegt:
    R erwartete 5 bei Laufgröße 4."""
    matches, stage = build(19, NINETEEN)
    heats = by_key(matches)
    removed: set[str] = set()
    for registration_id in ("r2", "r3", "r6", "r7"):
        remove(matches, registration_id, "withdrawn", removed)
    result = rebuild(matches, stage)
    assert "merged" in kinds(result) and heats["Y"]["status"] == "cancelled"
    assert heats["O"]["settings"]["qualifiers_per_match"] == 1
    assert [entry["to_match_key"] for entry in heats["O"]["advancement"]] == ["R"]
    apply_result(matches, heats["P"], ["r17", "r18", "r19"])
    rebuild(matches, stage)
    remove(matches, "r17", "disqualified", removed)
    rebuild(matches, stage)
    remove(matches, "r19", "withdrawn", removed)
    result = rebuild(matches, stage)
    assert "merged" in kinds(result) and heats["S"]["status"] == "cancelled"
    assert filled_ids(heats["R"]) == ["r18"]
    assert expected_entries(heats["R"], heats) <= 4, f"R erwartet {expected_entries(heats['R'], heats)} bei Laufgröße 4"
    assert {heats[key]["settings"]["qualifiers_per_match"] for key in ("O", "Q")} == {1, 2}
    # Die Quote von O wuchs und wurde gleich wieder gekappt: das Protokoll behauptet nicht, dass 2 weiterkommen.
    assert not [op for op in result["ops"] if op["kind"] == "quota" and op["heats"] == ["O"]], result["ops"]
    play_through(matches, stage, random.Random(19))
    assert len(final_of(matches)["results"]) <= 4
    assert all(len(m["results"]) <= 4 for m in played_heats(matches))
