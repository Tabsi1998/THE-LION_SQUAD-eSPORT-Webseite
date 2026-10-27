"""Läufe-Cup mit Loser Bracket bei kleinem Feld (#2044, #2045): der Planer und der Ergebnis-Anwender auf dem Schema des
Probelauf-Cups (16 Plätze, Läufe zu viert, die zwei Besten weiter, Winner und Loser Bracket, Finale).

- #2044: ein Loser-Lauf, dessen Vorläufe mit je zwei Fahrern beide weiterschicken, wartet, statt als „ohne Teilnehmer“
  abgesagt zu werden - legt der Umbau die Vorläufe zusammen, hat der Sammellauf Verlierer, und die fahren dort.
- #2045: gleicht der Umbau Läufe auf 3 oder 2 Plätze aus, passen die Verlierer-Weiterleitungen dazu (bei 3 Plätzen und
  Quote 2 nur L1, bei 2 Plätzen keiner); das Ergebnis lässt sich eintragen, die Verlierer kommen ins Loser Bracket.
- Breite (wie ``test_bracket_generator_sim_unit``, Los mit Startwert): Feldgrößen 5-16 in den Modi fest, gemischt und
  sofort, je mit Ausfall-Reihenfolgen (Austritt, Disqualifikation, nicht erschienen, Korrektur) und mehreren zugleich
  aufgerufenen Vorläufen - nach jedem Schritt Graph gültig, niemand zweimal spielbereit, kein Lauf über der Laufgröße
  (auch nicht in den sichtbaren Plätzen und ``match_size``), kein spielbereiter Lauf mit einem Fahrer; am Ende alles
  entschieden, genau ein Finale, und jede/r Verlierer:in der Winner-Seite hat die zweite Chance bekommen.

Der Umbau läuft hier wie im Betrieb in zwei Schritten: erst die Automatik (Quoten, Freilose, Absagen), dann der
bestätigte strukturelle Umbau (Zusammenlegen, Ausgleichen, Abkürzen) - #2044 lag genau zwischen den beiden.
"""
import copy
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
from services.heat_rebuild import HeatRebuildError, rebuild_heats, stage_heat_rules  # noqa: E402
from services.match_v2_results import MatchV2ResultError, build_v2_result_application  # noqa: E402
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
    """Wie ``evaluate_heat_rebuild`` mit Bestätigung: erst die Automatik, dann der strukturelle Umbau - jeder Schritt
    auf einer Kopie, die nur bei Erfolg übernommen wird (wie ``_persist``). Ein Konflikt (#2033: ein aufgerufener Lauf
    würde überlaufen) lässt den Stand, wie er ist - der Umbau wird mit dem nächsten Schritt nachgeholt."""
    rules = stage_heat_rules(stage, matches)
    ops: list[dict] = []
    for structural in (False, True):
        trial = copy.deepcopy(matches)
        try:
            ops += rebuild_heats(trial, now_iso=NOW, structural=structural, **rules)["ops"]
        except HeatRebuildError:
            continue
        for match, fresh in zip(matches, trial):
            match.clear()
            match.update(fresh)
    return ops


def call(match: dict, station: str) -> None:
    """Wie die Stationsverwaltung: aufgerufen, Station zugeteilt - der Lauf wird nicht mehr umgebaut."""
    match["called_at"] = NOW
    match["station_id"] = station


def memory_of(match: dict) -> list[tuple[str, str, int]]:
    return sorted((item["flow"], item["match_key"], int(item["rank"])) for item in match.get("dormant_slots") or [])


def collector_of(matches: list[dict], sources: set[str]) -> dict:
    """Der Loser-Lauf, der offene Plätze aus allen ``sources`` hat - der Sammellauf nach dem Zusammenlegen."""
    return next(m for m in matches if m.get("section") == "LB" and m["status"] != "cancelled"
                and {s["source"].get("match_key") for s in m["slots"] if s.get("status") == "pending"} >= sources)


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
            # Sichtbar (TV, Baum, App: jeder Platz, ``match_size`` als „N Spieler“) bleibt die Laufgröße; ruhende
            # Plätze aus einem Zusammenlegen sind Merkposten (``dormant_slots``), keine Plätze.
            assert len(match["slots"]) <= HEAT_SIZE, f"{where}: {key} zeigt {len(match['slots'])} Plätze"
            assert int((match.get("settings") or {}).get("match_size") or 0) <= HEAT_SIZE, \
                f"{where}: {key} hat Laufgröße {match['settings'].get('match_size')}"
            if match["status"] in OPEN:
                assert len(expected(match)) != 1, f"{where}: {key} wartet mit einem einzigen Fahrer"
            # Ausgeschiedene sitzen in keinem Lauf, der noch nicht aufgerufen ist (aufgerufen: die Wertung kommt mit
            # dem Ergebnis, die Person kommt nicht weiter - wie in der Generalprobe).
            if not match.get("called_at") and not match.get("started_at"):
                assert not set(people) & removed, f"{where}: Ausgeschiedene in {key}"
        else:
            assert len(match.get("results") or []) <= HEAT_SIZE, f"{where}: {key} zu groß gewertet"
        # Wer noch weiterkommen kann: Ausgeschiedene nicht, auf dem Sieger-Weg auch nicht, wer nicht erschienen ist.
        present = [row for row in match.get("results") or [] if row["registration_id"] not in removed]
        drivers = len(present) if match["status"] in TERMINAL else len(expected(match))
        winners = len([row for row in present if not row.get("forfeit")]) if match["status"] in TERMINAL else drivers
        quota = quota_of(match)
        for forward in match.get("advancement") or []:
            target = by_id.get(forward.get("to_match_id"))
            assert target, f"{where}: {key} leitet ins Leere ({forward})"
            rank = int(forward.get("rank") or 0)
            if target["status"] == "cancelled":
                winner = forward.get("flow") == "W"
                reachable = rank <= min(quota, winners) if winner else quota + rank <= drivers
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


def check_end(matches: list[dict], removed: set[str], unseated: set[str] = frozenset(), *,
              capped_allowed: bool = True) -> dict:
    """Ende: alles entschieden, genau ein Finale, kein gefahrener Lauf mit einem Fahrer, jede/r Verlierer:in der
    Winner-Seite sitzt (oder saß, bis zum eigenen Ausscheiden) im Loser Bracket - oder der Umbau hat sichtbar
    gemeldet, dass es keinen Platz mehr gab (``unseated``), nie still. Gekappt (``capped_allowed``): ein
    Verlierer-Platz, den der Umbau strich, weil der Loser-Lauf voll war (#2033: kein Lauf über der Laufgröße) - nur
    mit Störungen erlaubt, nie in einem Abend ohne Ausfälle."""
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
        places = len([entry for entry in match.get("advancement") or [] if entry.get("flow") == "L"])
        assert capped_allowed or len(losers) <= places, \
            f"{match['match_key']}: {len(losers)} Verlierer, aber nur {places} Verlierer-Wege - ohne Störung gekappt"
        for index, loser in enumerate(losers):
            if loser in removed:
                continue
            seated = (match["id"], loser) in seated_from
            if index < places:
                assert seated, \
                    f"{loser} (Platz > {quota} in {match['match_key']}) hat keine zweite Chance im Loser Bracket"
            else:
                assert seated or loser in unseated, \
                    f"{loser} (Platz > {quota} in {match['match_key']}) blieb still ohne Platz im Loser Bracket"
    return finals[0]


# ---------------------------------------------------------------------------------------------- Der Abend


def play(matches: list[dict], stage: dict, rng: random.Random, *, removals: bool,
         forfeits: bool) -> tuple[set[str], set[str]]:
    """Spielt durch - mit Störungen nach ``rng``: Austritt, Disqualifikation, nicht erschienen im Lauf und eine
    Korrektur (Platz 2 und 3 getauscht) in einem schon gefahrenen Lauf, dessen Folgeläufe noch offen sind. Rückgabe:
    (Ausgeschiedene, Fahrer, für die der Umbau „kein Platz mehr“ gemeldet hat)."""
    removed: set[str] = set()
    unseated: set[str] = set()

    def rebuild(matches: list[dict], stage: dict) -> list[dict]:
        ops = globals()["rebuild"](matches, stage)
        unseated.update(op["registration_id"] for op in ops if op.get("kind") == "unseated")
        return ops
    # Mehrere Vorläufe zugleich an Stationen aufgerufen - auch schon, bevor der Umbau zum ersten Mal läuft (die
    # Auswertung war eingereiht, #2033): aufgerufene Läufe werden nicht mehr umgebaut, ihre Weiterleitungen können
    # auf Plätze zeigen, die es bei ihrer Belegung nicht gibt.
    if removals and rng.random() < 0.5:
        for index, match in enumerate(rng.sample([m for m in matches if m["status"] == "ready"], k=min(3, sum(
                1 for m in matches if m["status"] == "ready")))):
            call(match, f"st-{index + 1}")
    rebuild(matches, stage)
    check(matches, removed, "Aufbau")
    for step in range(10_000):
        ready = [m for m in matches if m["status"] == "ready"]
        if not ready:
            break
        waiting = [m for m in ready if not m.get("called_at")]
        if removals and len(waiting) >= 2 and rng.random() < 0.2:
            for index, match in enumerate(rng.sample(waiting, k=min(3, len(waiting)))):
                call(match, f"st-{index + 1}")
            rebuild(matches, stage)
            check(matches, removed, f"Schritt {step}: Aufrufe")
            continue
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
        match.pop("called_at", None)
        rebuild(matches, stage)
        check(matches, removed, f"Schritt {step}: Ergebnis {match['match_key']}")
    return removed, unseated


def test_called_heats_with_stale_loser_links_keep_the_collector_at_heat_size():
    """Die Auswertung war eingereiht (#2033), derweil sind A und B mit je drei Fahrern an Stationen aufgerufen - ihre
    L2-Weiterleitungen zeigen noch auf Plätze, die es bei drei Fahrern nicht gibt (aufgerufene Läufe werden nicht
    mehr angepasst). C hat zwei Fahrer, D keinen. Der erste Umbau legt LC und LD, dann LA und LB zusammen: die
    wartenden Plätze der aufgerufenen Läufe, die nicht mehr hineinpassen, werden Merkposten statt Plätze - der
    Sammellauf zeigt höchstens vier Plätze, und der Abend läuft bis zum Finale."""
    matches, stage = build(12)
    heats = by_key(matches)
    for key, keep in (("A", 3), ("B", 3), ("C", 2), ("D", 0)):
        for slot in heats[key]["slots"][keep:]:
            slot.update({"registration_id": None, "user_id": None, "status": "bye"})
        heats[key]["status"] = "ready" if keep >= 2 else "pending"
    call(heats["A"], "st-1")
    call(heats["B"], "st-2")
    rebuild(matches, stage)
    check(matches, set(), "erster Umbau mit aufgerufenen Vorläufen")
    collector = collector_of(matches, {"A", "B", "C"})
    assert len(collector["slots"]) <= HEAT_SIZE and collector["settings"]["match_size"] <= HEAT_SIZE
    stale = [item for item in memory_of(collector) if item[0] == "L" and item[2] == 2]
    assert stale, "der L2-Platz eines aufgerufenen Vorlaufs, der nicht mehr hineinpasst, ist ein Merkposten"
    for key in ("A", "B"):
        assert heats[key].get("called_at") and len(filled_ids(heats[key])) == 3
    removed, unseated = play(matches, stage, random.Random(12), removals=False, forfeits=False)
    check_end(matches, removed, unseated)


def test_a_returning_place_never_grows_a_full_collector():
    """Wie oben, nur A ist aufgerufen; B hat drei Fahrer und ist noch umbaubar - sein L2 ruht nach dem Zusammenlegen
    als Merkposten im Sammellauf, der mit vier Plätzen voll ist. Kommt B auf vier Fahrer (ein Nachzügler auf dem
    freien Platz - genauso nach einem „Rückgängig“ oder einer Korrektur, die einen Platz zurückbringt), hätte B wieder
    zwei Verlierer. Der Sammellauf ist aber voll: der Platz bleibt Merkposten, B wird auf L1 gekappt, der Sammellauf
    zeigt weiter vier Plätze - kein Lauf über der Laufgröße. Wird dort ein Platz frei (A ist gefahren, sein L2-Platz
    ein totes Freilos), kommt der Platz zurück."""
    matches, stage = build(12)
    heats = by_key(matches)
    for key, keep in (("A", 3), ("B", 3), ("C", 2), ("D", 0)):
        for slot in heats[key]["slots"][keep:]:
            slot.update({"registration_id": None, "user_id": None, "status": "bye"})
        heats[key]["status"] = "ready" if keep >= 2 else "pending"
    call(heats["A"], "st-1")
    rebuild(matches, stage)
    check(matches, set(), "erster Umbau")
    collector = collector_of(matches, {"A", "B", "C"})
    assert len(collector["slots"]) == 4 and ("L", "B", 2) in memory_of(collector)
    free = next(slot for slot in heats["B"]["slots"] if slot["status"] == "bye")
    free.update({"registration_id": "r13", "user_id": "u13", "status": "filled"})
    rebuild(matches, stage)
    check(matches, set(), "Nachzügler in B")
    assert len(filled_ids(heats["B"])) == 4
    assert len(collector["slots"]) == 4 and collector["settings"]["match_size"] == 4
    assert [e["rank"] for e in heats["B"]["advancement"] if e["flow"] == "L"] == [1], "B wird auf L1 gekappt"
    assert ("L", "B", 2) in memory_of(collector), "der Platz bleibt Merkposten, bis im Sammellauf etwas frei wird"
    # A fährt: sein L2-Platz im Sammellauf wird ein Freilos ohne Zukunft - B bekommt seinen L2-Platz dorthin zurück.
    order = filled_ids(heats["A"])
    apply_result(matches, heats["A"], order)
    heats["A"].pop("called_at", None)
    rebuild(matches, stage)
    check(matches, set(), "A gefahren")
    assert len(collector["slots"]) == 4 and collector["settings"]["match_size"] == 4
    assert [e["rank"] for e in heats["B"]["advancement"] if e["flow"] == "L"] == [1, 2], "L2 von B kommt zurück"
    assert ("L", "B", 2) not in memory_of(collector)
    removed, unseated = play(matches, stage, random.Random(11), removals=False, forfeits=False)
    check_end(matches, removed, unseated)


def capped_collector() -> tuple[list[dict], dict, dict, dict]:
    """Wie oben: A aufgerufen, B mit vier Fahrern auf L1 gekappt, der Sammellauf voll - B fährt, und der Vierte aus B
    hat keinen Platz: sein Merkposten wartet mit ihm dahinter."""
    matches, stage = build(12)
    heats = by_key(matches)
    for key, keep in (("A", 3), ("B", 3), ("C", 2), ("D", 0)):
        for slot in heats[key]["slots"][keep:]:
            slot.update({"registration_id": None, "user_id": None, "status": "bye"})
        heats[key]["status"] = "ready" if keep >= 2 else "pending"
    call(heats["A"], "st-1")
    rebuild(matches, stage)
    free = next(slot for slot in heats["B"]["slots"] if slot["status"] == "bye")
    free.update({"registration_id": "r13", "user_id": "u13", "status": "filled"})
    rebuild(matches, stage)
    collector = collector_of(matches, {"A", "B", "C"})
    assert [e["rank"] for e in heats["B"]["advancement"] if e["flow"] == "L"] == [1]
    order = filled_ids(heats["B"])
    apply_result(matches, heats["B"], order)
    rebuild(matches, stage)
    check(matches, set(), "B gefahren")
    fourth = order[3]
    assert not any(fourth in filled_ids(m) for m in matches if m["status"] not in TERMINAL), "noch ohne Platz"
    assert ("L", "B", 2) in memory_of(collector), "der Merkposten bleibt - ein echter Fahrer steht dahinter"
    return matches, stage, collector, heats["B"]


def test_a_waiting_loser_gets_the_next_free_place():
    """#2044: der Vierte aus B hat keinen Platz bekommen, weil der Sammellauf voll war. Fährt A, wird sein L2-Platz
    im Sammellauf ein totes Freilos - der Wartende bekommt ihn, mit Herkunft aus B."""
    matches, stage, collector, heat_b = capped_collector()
    heats = by_key(matches)
    fourth = heat_b["results"][3]["registration_id"]
    apply_result(matches, heats["A"], filled_ids(heats["A"]))
    heats["A"].pop("called_at", None)
    rebuild(matches, stage)
    check(matches, set(), "A gefahren")
    seat = next((s for s in collector["slots"] if s.get("registration_id") == fourth), None)
    assert seat, "der Wartende sitzt im Sammellauf"
    assert seat["source_result"]["from_match_key"] == "B" and seat["source_result"]["flow"] == "L"
    assert [e["rank"] for e in heat_b["advancement"] if e["flow"] == "L"] == [1, 2]
    assert ("L", "B", 2) not in memory_of(collector)
    assert len(collector["slots"]) == 4 and collector["settings"]["match_size"] == 4
    removed, unseated = play(matches, stage, random.Random(13), removals=False, forfeits=False)
    check_end(matches, removed, unseated)


def test_a_waiting_loser_without_a_place_is_reported_not_silent():
    """#2044: wird im vollen Sammellauf nie ein Platz frei, bevor er aufgerufen wird, meldet der Umbau sichtbar, dass
    der Vierte aus B keinen Platz mehr bekommt (``unseated``), statt ihn still zu vergessen."""
    matches, stage, collector, heat_b = capped_collector()
    fourth = heat_b["results"][3]["registration_id"]
    call(collector, "st-2")
    ops = rebuild(matches, stage)
    reported = [op for op in ops if op.get("kind") == "unseated"]
    assert [op["registration_id"] for op in reported] == [fourth]
    assert reported[0]["from"] == "B" and reported[0]["heats"] == [collector["match_key"]]
    assert "keinen Platz mehr bekommen" in reported[0]["text"]
    assert ("L", "B", 2) not in memory_of(collector), "gemeldet ist gemeldet - kein zweites Mal"
    assert rebuild(matches, stage) == []
    removed, unseated = play(matches, stage, random.Random(14), removals=False, forfeits=False)
    check_end(matches, removed, unseated | {fourth})


def test_the_last_way_of_a_played_heat_never_grows_the_collector():
    """#1596 trifft #2044: LB ist kampflos entschieden (nur der eine Verlierer aus C), sein einziger Weg führt zu LD;
    dieser Fahrer tritt aus, niemand rückt nach - der Freilos-Platz behält die Weiterleitung. Legt der Umbau LC und
    LD zusammen, hat dieser Platz Vorrang, zählt zur Laufgröße und sprengt sie nie: statt eines Sammellaufs mit fünf
    Plätzen bleiben zwei Läufe."""
    matches, stage = build(16)
    heats = by_key(matches)
    for key, keep in (("B", 2), ("C", 3), ("D", 0)):
        for slot in heats[key]["slots"][keep:]:
            slot.update({"registration_id": None, "user_id": None, "status": "bye"})
        heats[key]["status"] = "ready" if keep >= 2 else "pending"
    rebuild(matches, stage)
    check(matches, set(), "Aufbau")
    apply_result(matches, heats["C"], filled_ids(heats["C"]))
    rebuild(matches, stage)
    assert heats["LB"]["status"] == "completed" and auto_bye(heats["LB"]), "LB: nur der Verlierer aus C, kampflos"
    loser = heats["LB"]["results"][0]["registration_id"]
    assert len(heats["LB"]["advancement"]) == 1, "LB hat nur den einen Weg nach LD"
    remove(matches, loser, "withdrawn", set())
    rebuild(matches, stage)
    check(matches, {loser}, "der Verlierer aus C ausgetreten")
    assert len(heats["LB"]["advancement"]) == 1, "der gefahrene Lauf behält seinen Weg (#1596)"
    target = next(m for m in matches if m["id"] == heats["LB"]["advancement"][0]["to_match_id"])
    assert target["status"] != "cancelled" and len(target["slots"]) <= HEAT_SIZE
    assert target["settings"]["match_size"] <= HEAT_SIZE
    removed, unseated = play(matches, stage, random.Random(15), removals=False, forfeits=False)
    check_end(matches, removed | {loser}, unseated)


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
    removed, unseated = play(matches, stage, random.Random(10), removals=False, forfeits=False)
    check_end(matches, removed, unseated, capped_allowed=False)


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
    more, unseated = play(matches, stage, random.Random(16), removals=False, forfeits=False)
    check_end(matches, removed | more, unseated, capped_allowed=False)


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
    removed, unseated = play(matches, stage, random.Random(count), removals=False, forfeits=False)
    assert not unseated, "ohne Störung bekommt jeder Verlierer seinen Platz"
    check_end(matches, removed, unseated, capped_allowed=False)


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
                removed, unseated = play(matches, stage, random.Random(draw_seed + 1), removals=True, forfeits=True)
                check_end(matches, removed, unseated)
            except (AssertionError, MatchV2ResultError) as exc:
                failures.append((count, draw_seed, str(exc).splitlines()[0]))
    assert not failures, failures
