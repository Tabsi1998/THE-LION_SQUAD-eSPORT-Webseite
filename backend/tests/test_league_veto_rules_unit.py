"""Veto der Liga (#1618, docs/LIGA.md D.3) ohne Datenbank: Form der Vorlage, Prüfung gegen Pool, Best of und Modusfolge, Simulation
mit vervollständigbaren Zügen (auch bei „jede Map nur einmal je Serie“), Zufallswahl, Vorschlag nach Anlage B, Stand am Spiel.
Erfundene Modi und Maps."""
import pathlib
import random
import sys
from collections import Counter

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_veto_rules as veto  # noqa: E402

HP, SND, CTL = "stellung", "suchen", "kontrolle"
ORDER = [HP, SND, CTL, HP, SND]


def pool(hp=4, snd=4, ctl=3, shared=False):
    """Ein Pool mit erfundenen Maps - ``shared``: dieselbe Map „nebel“ in allen Modi (für „jede Map nur einmal je Serie“)."""
    def maps(prefix, count):
        rows = [{"map_id": f"{prefix}-{index}", "name": f"{prefix.title()} {index}", "image_url": None} for index in range(1, count + 1)]
        if shared:
            rows[0] = {"map_id": "nebel", "name": "Nebel", "image_url": None}
        return rows
    return {"id": "pool-1", "modes": [
        {"mode": HP, "label": "Stellung", "maps": maps("hp", hp)},
        {"mode": SND, "label": "Suchen", "maps": maps("snd", snd)},
        {"mode": CTL, "label": "Kontrolle", "maps": maps("ctl", ctl)},
    ]}


def step(kind, mode, team=None, position=None):
    return {"kind": kind, "mode": mode, "team": team, "position": position}


# Anlage B (BO5, ohne Seitenwahl): HP ban A, ban B, pick A → 1, pick B → 4; S&D ban B, ban A, pick B → 2, pick A → 5;
# Modus 3 ban A, ban B, decider → 3.
ANLAGE_B = [
    step("ban", HP, "A"), step("ban", HP, "B"), step("pick", HP, "A", 1), step("pick", HP, "B", 4),
    step("ban", SND, "B"), step("ban", SND, "A"), step("pick", SND, "B", 2), step("pick", SND, "A", 5),
    step("ban", CTL, "A"), step("ban", CTL, "B"), step("decider", CTL, None, 3),
]


def rules(steps=ANLAGE_B, **extra):
    return {"enabled": True, "team_a": "home", "step_seconds": 60, "steps": steps, **extra}


def problems(steps, *, best_of=5, order=ORDER, repeat="other_mode", the_pool=None):
    return veto.template_problems(rules(steps), pool=pool() if the_pool is None else the_pool, best_of=best_of, order=order, repeat=repeat)


# ---------------------------------------------------------------- Form

def test_normalize_fills_defaults_and_rejects_bad_forms():
    assert veto.normalize({}) == {"enabled": False, "team_a": "home", "step_seconds": 60, "steps": []}
    clean = veto.normalize(rules([{"kind": "ban", "mode": " Stellung ", "team": "A"}, {"kind": "decider", "mode": HP, "position": 1}]))
    assert clean["steps"] == [step("ban", "Stellung", "A"), step("decider", HP, None, 1)]
    for bad, text in (
        ({"enabled": "ja"}, "ja oder nein"), ({"team_a": "gast"}, "Team A"), ({"step_seconds": 5}, "10 bis 600"),
        ({"step_seconds": True}, "ganze Zahl"), ({"unbekannt": 1}, "unbekanntes Feld"), ({"steps": "x"}, "keine Liste"),
        ({"steps": [{"kind": "side"}]}, "Sperren, Wählen oder Decider"), ({"steps": [{"kind": "ban", "mode": ""}]}, "Modus"),
        ({"steps": [{"kind": "ban", "mode": HP, "team": "C"}]}, "Team A oder Team B"),
        ({"steps": [{"kind": "ban", "mode": HP, "team": "A", "position": 1}]}, "keine Position"),
        ({"steps": [{"kind": "pick", "mode": HP, "team": "A"}]}, "Position"),
        ({"steps": [{"kind": "decider", "mode": HP, "team": "A", "position": 1}]}, "kein Team"),
        ({"steps": [{"kind": "pick", "mode": HP, "team": "A", "position": 10}]}, "1 bis 9"),
        ({"steps": [step("ban", HP, "A")] * 61}, "Höchstens 60"),
    ):
        with pytest.raises(veto.VetoProblem) as problem:
            veto.normalize({**rules(), **bad})
        assert text in problem.value.detail and problem.value.status_code == 422


def test_rules_only_for_staffeln_with_an_active_template():
    staffel = {"id": "t", "league_context": {"league_id": "l", "season_id": "s", "staffel": "A"}}
    assert veto.rules_of({"id": "t", "veto_rules": rules()}) is None, "kein Liga-Turnier"
    assert veto.rules_of(staffel) is None
    assert veto.rules_of({**staffel, "veto_rules": rules(enabled=False)}) is None
    assert veto.rules_of({**staffel, "veto_rules": rules([])}) is None, "ohne Schritte kein Veto"
    assert veto.rules_of({**staffel, "veto_rules": {"enabled": True, "steps": "kaputt"}}) is None, "verbogen = aus, keine Sperre"
    assert veto.rules_of({**staffel, "veto_rules": rules()})["steps"] == ANLAGE_B


# ---------------------------------------------------------------- Vorlage gegen Pool, Best of und Modusfolge

def test_anlage_b_is_valid_and_the_problems_are_german_sentences():
    assert problems(ANLAGE_B) == []
    table = {
        "zu kleiner Pool": (problems(ANLAGE_B, the_pool=pool(hp=3)), "Stellung: 2 Sperren und 2 Wahlen brauchen 4 Maps – der Pool hat 3."),
        "doppelte Position": (problems([*ANLAGE_B[:3], step("pick", HP, "B", 1), *ANLAGE_B[4:]]),
                              "Position 1 ist mehrfach belegt (Schritt 3 und 4)."),
        "fehlende Position": (problems([*ANLAGE_B[:3], step("pick", HP, "B", 1), *ANLAGE_B[4:]]),
                              "Position 4 ist nicht belegt – ohne Wahl oder Decider bleibt sie offen."),
        "falscher Modus": (problems([*ANLAGE_B[:2], step("pick", HP, "A", 2), step("pick", HP, "B", 4), *ANLAGE_B[4:]]),
                           "Schritt 3: Auf Position 2 wird laut „Modus je Map“ Suchen gespielt, nicht Stellung."),
        "Decider nicht eindeutig": (problems([*ANLAGE_B[:8], step("ban", CTL, "A"), step("decider", CTL, None, 3)]),
                                    "Kontrolle: Der Decider braucht genau eine übrige Map – nach 1 Sperre und 0 Wahlen bleiben 2."),
        "Position über Best of": (problems([*ANLAGE_B[:7], step("pick", SND, "A", 6), *ANLAGE_B[8:]]),
                                  "Schritt 8: Position 6 gibt es bei Best of 5 nicht."),
        "Modus ohne Maps": (problems([step("ban", "nachtmodus", "A"), *ANLAGE_B]),
                            "Schritt 1: Der Modus „nachtmodus“ hat keine Maps im Pool."),
        "Decider nicht zuletzt": (problems([*ANLAGE_B[:8], step("ban", CTL, "A"), step("decider", CTL, None, 3), step("ban", CTL, "B")]),
                                  "Kontrolle: Der Decider muss der letzte Schritt seines Modus sein."),
        "zwei Decider": (problems([*ANLAGE_B[:8], step("decider", CTL, None, 3), step("decider", CTL, None, 3)]),
                         "Kontrolle: höchstens ein Decider je Modus."),
        "leer": (problems([]), "Die Vorlage hat noch keine Schritte."),
    }
    for name, (found, expected) in table.items():
        assert expected in found, (name, found)
        assert all("{" not in text for text in found), name
    # Ohne Modusfolge zählt jede Position frei; ohne Pool nur Positionen und Form.
    free = problems([*ANLAGE_B[:2], step("pick", HP, "A", 2), step("pick", HP, "B", 4), *ANLAGE_B[4:]], order=[])
    assert sorted(free) == ["Position 1 ist nicht belegt – ohne Wahl oder Decider bleibt sie offen.", "Position 2 ist mehrfach belegt (Schritt 3 und 7)."]
    assert veto.template_problems(rules(), pool=None, best_of=5, order=ORDER, repeat="other_mode") == []
    assert veto.fits_problem(rules(), pool=None, best_of=5, order=ORDER, repeat="other_mode") == "Für dieses Spiel gilt kein Map-Pool."
    assert veto.fits_problem(rules(), pool=pool(), best_of=3, order=ORDER[:3], repeat="other_mode").startswith("Schritt 4: Position 4")


def test_never_needs_a_complete_run_through_the_search():
    # Jede Map nur einmal je Serie: „nebel“ steht in allen drei Modi, der Rest reicht - ein Durchlauf existiert.
    shared = pool(hp=4, snd=4, ctl=3, shared=True)
    assert problems(ANLAGE_B, repeat="never", the_pool=shared) == []
    # Kontrolle hat nur „nebel“ und zwei weitere; wird „nebel“ vorher in Stellung gespielt, bleiben für Kontrolle zwei Sperren und
    # ein Decider auf zwei Maps - die Suche findet trotzdem einen Weg (nebel wird nicht in Stellung gewählt). Ohne Weg: zu klein.
    tiny = pool(hp=2, snd=2, ctl=1, shared=True)
    steps = [step("pick", HP, "A", 1), step("pick", HP, "B", 4), step("pick", SND, "B", 2), step("pick", SND, "A", 5),
             step("decider", CTL, None, 3)]
    found = problems(steps, repeat="never", the_pool=tiny)
    assert found == ["Mit „jede Map nur einmal je Serie“ lässt sich die Vorlage mit diesem Pool nicht zu Ende spielen – bitte Sperren "
                     "oder Pool anpassen."]
    assert problems(steps, repeat="other_mode", the_pool=tiny) == [], "bei anderem Modus darf Nebel mehrfach laufen"


# ---------------------------------------------------------------- Simulation und Züge

def test_allowed_options_follow_the_pool_the_bans_and_the_completability():
    remaining = veto.remaining_after([], pool(), "other_mode")
    assert veto.allowed_options(remaining, ANLAGE_B, "other_mode") == ["hp-1", "hp-2", "hp-3", "hp-4"]
    done = [{**ANLAGE_B[0], "map_id": "hp-1"}, {**ANLAGE_B[1], "map_id": "hp-2"}]
    remaining = veto.remaining_after(done, pool(), "other_mode")
    assert remaining[HP] == ["hp-3", "hp-4"] and remaining[SND] == ["snd-1", "snd-2", "snd-3", "snd-4"]
    assert veto.allowed_options(remaining, ANLAGE_B[2:], "other_mode") == ["hp-3", "hp-4"]
    # Nur die Vervollständigbarkeit schränkt ein (jede Map nur einmal je Serie): „nebel“ in Stellung zu wählen ließe Kontrolle
    # (nebel, ctl-2, ctl-3 mit zwei Sperren und Decider) noch aufgehen - aber bei einem Pool, wo Kontrolle nur nebel und eine
    # weitere Map hat, nicht mehr.
    shared = pool(hp=4, snd=4, ctl=2, shared=True)
    steps = [step("pick", HP, "A", 1), step("pick", HP, "B", 4), step("pick", SND, "B", 2), step("pick", SND, "A", 5),
             step("ban", CTL, "A"), step("decider", CTL, None, 3)]
    remaining = veto.remaining_after([], shared, "never")
    options = veto.allowed_options(remaining, steps, "never")
    assert "nebel" not in options and options == ["hp-2", "hp-3", "hp-4"]
    assert veto.allowed_options(remaining, steps, "other_mode") == ["nebel", "hp-2", "hp-3", "hp-4"]
    # Ein Decider hat genau eine Wahl - oder keine.
    assert veto.allowed_options({CTL: ["ctl-3"]}, [step("decider", CTL, None, 3)], "other_mode") == ["ctl-3"]
    assert veto.allowed_options({CTL: ["ctl-2", "ctl-3"]}, [step("decider", CTL, None, 3)], "other_mode") == []


def test_auto_choice_is_uniform_over_the_allowed_options():
    rng = random.Random(7)
    counts = Counter(veto.auto_choice(["a", "b", "c"], rng) for _ in range(3000))
    assert set(counts) == {"a", "b", "c"} and all(850 < count < 1150 for count in counts.values()), counts
    with pytest.raises(veto.VetoProblem):
        veto.auto_choice([])


def test_a_full_run_through_anlage_b_lands_every_pick_in_its_slot():
    remaining = veto.remaining_after([], pool(), "other_mode")
    done = []
    rng = random.Random(1)
    for index, item in enumerate(ANLAGE_B):
        options = veto.allowed_options(remaining, ANLAGE_B[index:], "other_mode")
        assert options, (index, remaining)
        chosen = options[0] if item["kind"] == "decider" else veto.auto_choice(options, rng)
        done.append({**item, "map_id": chosen})
        remaining = veto.apply_step(remaining, item, chosen, "other_mode")
    planned = sorted(((row["position"], row["mode"], row["kind"]) for row in done if row["kind"] != "ban"))
    assert planned == [(1, HP, "pick"), (2, SND, "pick"), (3, CTL, "decider"), (4, HP, "pick"), (5, SND, "pick")]
    assert len({row["map_id"] for row in done if row["mode"] == HP}) == 4, "in einem Modus jede Map einmal"
    assert remaining == {HP: [], SND: [], CTL: []}


# ---------------------------------------------------------------- Vorschlag

def test_the_proposal_follows_anlage_b_from_order_pool_sizes_and_best_of():
    proposed = veto.propose(order=ORDER, pool=pool(), best_of=5)
    assert proposed == ANLAGE_B
    assert veto.template_problems(rules(proposed), pool=pool(), best_of=5, order=ORDER, repeat="other_mode") == []
    # Best of 3 mit zwei Modi und frei gewähltem Modus: die Modi des Pools zyklisch, Position 3 wieder Stellung.
    three = veto.propose(order=[], pool=pool(hp=3, snd=2, ctl=0), best_of=3)
    assert three == [step("ban", HP, "A"), step("pick", HP, "B", 1), step("pick", HP, "A", 3), step("ban", SND, "B"),
                     step("decider", SND, None, 2)]
    assert veto.propose(order=[], pool=None, best_of=3) == []
    big = veto.propose(order=[HP], pool=pool(hp=6), best_of=1)
    assert [row["kind"] for row in big] == ["ban"] * 5 + ["decider"] and [row["team"] for row in big[:5]] == ["A", "B", "A", "B", "A"]


# ---------------------------------------------------------------- Stand am Spiel, Sätze

def test_veto_pending_and_veto_of_follow_the_template_and_the_time():
    staffel = {"id": "t", "league_context": {"league_id": "l", "season_id": "s", "staffel": "A"}, "veto_rules": rules()}
    at = "2026-11-15T19:00:00+00:00"
    match = {"id": "m", "scheduled_at": at}
    assert veto.veto_pending(match, {"id": "t"}) is False, "kein Liga-Turnier"
    assert veto.veto_pending(match, {**staffel, "veto_rules": rules(enabled=False)}) is False
    assert veto.veto_pending(match, staffel) is True, "es beginnt beim nächsten Lesen"
    running = {**match, "flow": {"veto": {"status": "running", "for_at": at}}}
    assert veto.veto_of(running)["status"] == "running" and veto.veto_pending(running, staffel) is True
    assert veto.veto_pending({**running, "flow": {"veto": {"status": "paused", "for_at": at}}}, staffel) is True
    assert veto.veto_pending({**running, "flow": {"veto": {"status": "done", "for_at": at}}}, staffel) is False
    assert veto.veto_pending({**running, "flow": {"veto": {"status": "skipped", "for_at": at}}}, staffel) is False
    stale = {**running, "scheduled_at": "2026-11-16T19:00:00+00:00"}
    assert veto.veto_of(stale) is None and veto.veto_pending(stale, staffel) is True, "neuer Termin: das alte Veto zählt nicht"
    assert veto.veto_of({**running, "scheduled_at": "2026-11-15T20:00:00+01:00"})["status"] == "running", "gleiche Zeit, andere Schreibweise"


def test_step_sentences_are_german():
    assert veto.step_sentence(step("ban", HP, "A"), "Stellung") == "Team A sperrt eine Map (Stellung)"
    assert veto.step_sentence(step("pick", SND, "B", 4), "Suchen") == "Team B wählt Map 4 (Suchen)"
    assert veto.step_sentence(step("decider", CTL, None, 3), "Kontrolle") == "Die übrige Map wird Map 3 (Kontrolle)"
    assert veto.ROLE_OF == {"ban": "banned", "pick": "picked", "decider": "decider"}
