"""Wer im Finale stand (#2337): die Grundlage für den Erfolg „Finalist“.

Früher hieß „Finalist“ Platz 1 oder 2 - das zählte im Mehrspieler-Finale nur zwei aus dem Finallauf und in Tabellen
ohne Finale trotzdem jemanden. Jetzt entscheidet der Baum: Endspiel, Grand Final oder Finallauf."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.competition_snapshot import build_structure_snapshot  # noqa: E402
from services.competition_standings import final_match, final_participants  # noqa: E402


def duel(match_id: str, first: str | None, second: str | None, *, rnd: int, section: str = "WB", stage: int = 1, status: str = "completed",
         **extra) -> dict:
    sides = [side for side in (first, second) if side]
    return {
        "id": match_id, "tournament_id": "t", "stage_id": f"s{stage}", "stage_number": stage, "round": rnd, "order": 1, "section": section,
        "match_type": "duel", "status": status,
        "slots": [{"slot": index, "registration_id": side, "status": "filled" if side else "bye"} for index, side in enumerate((first, second), start=1)],
        "results": [{"registration_id": side, "rank": index} for index, side in enumerate(sides, start=1)] if status in ("completed", "forfeit") else [],
        **extra,
    }


def heat(match_id: str, order: list[str], *, rnd: int, stage: int = 1, status: str = "completed", **extra) -> dict:
    return {
        "id": match_id, "tournament_id": "t", "stage_id": f"s{stage}", "stage_number": stage, "round": rnd, "order": 1, "section": "WB",
        "match_type": "ffa", "status": status,
        "slots": [{"slot": index, "registration_id": reg, "status": "filled"} for index, reg in enumerate(order, start=1)],
        "results": [{"registration_id": reg, "rank": index} for index, reg in enumerate(order, start=1)] if status == "completed" else [],
        **extra,
    }


def snap(matches: list[dict], stages: list[dict] = ()) -> dict:
    return build_structure_snapshot("t", stage_matches=matches, stages=stages)


def test_endspiel_beide_stehen_im_finale_das_spiel_um_platz_drei_nicht():
    snapshot = snap([
        duel("h1", "a", "b", rnd=1), duel("h2", "c", "d", rnd=1),
        duel("fin", "a", "c", rnd=2),
        duel("bronze", "b", "d", rnd=2, section="BRONZE"),
    ])
    assert final_match(snapshot)["id"] == "fin"
    assert final_participants(snapshot, tournament={"format": "single_elim"}) == {"a", "c"}


def test_grand_final_zaehlt_ohne_das_reset_spiel():
    snapshot = snap([
        duel("wf", "a", "b", rnd=2), duel("lf", "b", "c", rnd=3, section="LB"),
        duel("gf", "a", "b", rnd=4, section="GF", round_name="Grand Final"),
        duel("gfr", "b", "a", rnd=5, section="GF", round_name="Grand Final Reset"),
    ])
    assert final_match(snapshot)["id"] == "gf"
    assert final_participants(snapshot, tournament={"format": "double_elim"}) == {"a", "b"}


def test_doppel_ko_ohne_grand_final_das_winner_finale_ist_das_finale():
    snapshot = snap([
        duel("w1", "a", "c", rnd=1), duel("w2", "b", "d", rnd=1),
        duel("wf", "a", "b", rnd=2),
        duel("l1", "c", "d", rnd=2, section="LB"), duel("lf", "c", "b", rnd=3, section="LB"),
    ])
    assert final_participants(snapshot, tournament={"format": "double_elim"}) == {"a", "b"}, "der Sieger der Verliererrunde stand nicht im Finale"


def test_mehrspieler_der_ganze_finallauf_ist_finalist():
    snapshot = snap([
        heat("h1", ["a", "b", "c", "d"], rnd=1), {**heat("h2", ["e", "f", "g", "h"], rnd=1), "order": 2},
        heat("fin", ["a", "e", "b", "f"], rnd=2),
    ])
    assert final_participants(snapshot, tournament={"format": "ffa_custom_bracket"}) == {"a", "b", "e", "f"}


def test_ein_einzelner_lauf_ist_kein_finale():
    assert final_participants(snap([heat("only", ["a", "b", "c", "d"], rnd=1)]), tournament={"format": "ffa"}) == set()
    assert final_participants(snap([duel("only", "a", "b", rnd=1)]), tournament={"format": "single_elim"}) == set()


def test_finallauf_nach_einer_vorrunde_in_eigener_phase():
    """Vorläufe in Phase 1, ein Finallauf in Phase 2: Die frühere Phase macht den einen Lauf zum Finale."""
    snapshot = snap([
        heat("v1", ["a", "b", "c", "d"], rnd=1, stage=1), {**heat("v2", ["e", "f", "g", "h"], rnd=1, stage=1), "order": 2},
        heat("fin", ["a", "e", "b"], rnd=1, stage=2),
    ])
    assert final_participants(snapshot, tournament={"format": "ffa"}) == {"a", "b", "e"}


def test_nur_die_letzte_phase_zaehlt():
    """Ein K.-o.-Finale in Phase 1 ist nicht das Finale des Turniers, wenn danach eine Tabelle entscheidet."""
    stages = [{"id": "s1", "number": 1, "stage_type": "single_elimination"}, {"id": "s2", "number": 2, "stage_type": "round_robin_groups"}]
    snapshot = snap([
        duel("h1", "a", "b", rnd=1), duel("h2", "c", "d", rnd=1), duel("f1", "a", "c", rnd=2),
        duel("t1", "a", "c", rnd=1, stage=2, section="group_A"), duel("t2", "c", "a", rnd=2, stage=2, section="group_A"),
    ], stages)
    assert final_participants(snapshot, tournament={"format": "single_elim"}) == set()


def test_tabellen_haben_kein_finale():
    table = [duel("m1", "a", "b", rnd=1), duel("m2", "a", "c", rnd=2), duel("m3", "b", "c", rnd=3)]
    for fmt in ("round_robin", "league", "swiss", "time_trial", "grand_prix"):
        assert final_participants(snap(table), tournament={"format": fmt}) == set(), fmt
    # Reine Gruppenphase: die Spiele liegen in Gruppen, nicht im Hauptbaum.
    groups = [duel("g1", "a", "b", rnd=1, section="group_A"), duel("g2", "c", "d", rnd=2, section="group_B")]
    assert final_participants(snap(groups), tournament={"format": "groups"}) == set()
    # Die Phase nennt ihren Typ: der gilt, auch wenn das Turnierformat ein K.-o. wäre.
    for stage_type in ("round_robin_groups", "league", "swiss", "ffa_league"):
        stages = [{"id": "s1", "number": 1, "stage_type": stage_type}]
        assert final_participants(snap(table, stages), tournament={"format": "single_elim"}) == set(), stage_type


def test_gruppenphase_mit_ko_danach_hat_ein_finale():
    stages = [{"id": "s1", "number": 1, "stage_type": "round_robin_groups"}, {"id": "s2", "number": 2, "stage_type": "single_elimination"}]
    snapshot = snap([
        duel("g1", "a", "b", rnd=1, section="group_A"), duel("g2", "c", "d", rnd=1, section="group_B"),
        duel("fin", "a", "c", rnd=1, stage=2),
    ], stages)
    assert final_participants(snapshot, tournament={"format": "groups"}) == {"a", "c"}


def test_kampfloses_finale_zaehlt_fuer_niemanden():
    semis = [duel("h1", "a", "b", rnd=1), duel("h2", "c", "d", rnd=1)]
    walkover = duel("fin", "a", "c", rnd=2, status="forfeit", forfeit_registration_id="c")
    walkover["results"][1]["forfeit"] = True
    assert final_participants(snap([*semis, walkover])) == set(), "der Gegner ist nicht erschienen"
    assert final_participants(snap([*semis, duel("fin", "a", None, rnd=2)])) == set(), "Freilos im Finale"


def test_wer_im_finallauf_fehlt_war_nicht_dabei():
    final = heat("fin", ["a", "e", "b", "f"], rnd=2)
    final["results"][3]["forfeit"] = True
    snapshot = snap([heat("h1", ["a", "b", "c", "d"], rnd=1), {**heat("h2", ["e", "f", "g", "h"], rnd=1), "order": 2}, final])
    assert final_participants(snapshot) == {"a", "b", "e"}


def test_offenes_oder_abgesagtes_finale_hat_noch_keine_finalisten():
    semis = [duel("h1", "a", "b", rnd=1), duel("h2", "c", "d", rnd=1)]
    assert final_participants(snap([*semis, duel("fin", "a", "c", rnd=2, status="pending")])) == set()
    # Ein abgesagtes Finale ist kein Spiel: dann bleiben zwei Spiele in der höchsten Runde - kein Finale.
    assert final_participants(snap([*semis, duel("fin", "a", "c", rnd=2, status="cancelled")])) == set()
    assert final_participants(snap([])) == set()
