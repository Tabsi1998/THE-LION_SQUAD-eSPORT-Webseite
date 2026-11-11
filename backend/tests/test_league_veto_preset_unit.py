"""Veto-Schrittart „Vorgabe der Woche“ (#2326, Entscheidung Nr. 122; docs/LIGA.md D.3) ohne Datenbank: Form der Vorlage, Prüfung gegen
Pool, Best of und Map-Wiederholung, Simulation (die vorgegebene Map ist weder sperrbar noch wählbar), die Vorgaben je Spielwoche und der
Vorschlag „rotiert durch den Pool“. Erfundene Modi und Maps."""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_veto_rules as veto  # noqa: E402

HP, SND, CTL = "stellung", "suchen", "kontrolle"
ORDER = [HP, SND, CTL, HP, SND]


def pool(hp=4, snd=4, ctl=3, shared=False):
    """Ein Pool mit erfundenen Maps - ``shared``: dieselbe Map „nebel“ steht in allen Modi an erster Stelle."""
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


# Wie Anlage B, nur Map 3 (Kontrolle) gibt die Leitung je Spielwoche vor - ohne Sperren in diesem Modus.
WITH_PRESET = [
    step("ban", HP, "A"), step("ban", HP, "B"), step("pick", HP, "A", 1), step("pick", HP, "B", 4),
    step("ban", SND, "B"), step("ban", SND, "A"), step("pick", SND, "B", 2), step("pick", SND, "A", 5),
    step("preset", CTL, None, 3),
]


def rules(steps=WITH_PRESET, **extra):
    return {"enabled": True, "team_a": "home", "step_seconds": 60, "steps": steps, **extra}


def problems(steps, *, best_of=5, order=ORDER, repeat="other_mode", the_pool=None):
    return veto.template_problems(rules(steps), pool=pool() if the_pool is None else the_pool, best_of=best_of, order=order, repeat=repeat)


# ---------------------------------------------------------------- Form

def test_the_preset_is_a_kind_of_its_own_set_by_the_system():
    assert veto.PRESET in veto.KINDS and veto.ROLE_OF[veto.PRESET] == "preset" and veto.PRESET in veto.SYSTEM_KINDS
    clean = veto.normalize(rules([{"kind": "preset", "mode": " Kontrolle ", "position": 3}]))
    assert clean["steps"] == [step("preset", "Kontrolle", None, 3)]
    for bad, text in (
        ({"kind": "preset", "mode": CTL, "team": "A", "position": 3}, "Die Vorgabe der Woche setzt das System - kein Team."),
        ({"kind": "preset", "mode": CTL}, "Position"),
        ({"kind": "preset", "mode": "", "position": 3}, "Modus"),
    ):
        with pytest.raises(veto.VetoProblem) as problem:
            veto.normalize(rules([bad]))
        assert text in problem.value.detail and problem.value.status_code == 422
    assert veto.step_sentence(step("preset", CTL, None, 3), "Kontrolle") == "Die Liga-Leitung gibt Map 3 je Spielwoche vor (Kontrolle)"


# ---------------------------------------------------------------- Vorlage gegen Pool, Best of und Modusfolge

def test_the_template_check_counts_the_preset_map():
    assert problems(WITH_PRESET) == [], "die Vorgabe belegt Position 3 - keine Lücke, kein Decider nötig"
    # Gegenprobe: ohne den Schritt bleibt Position 3 offen.
    assert problems(WITH_PRESET[:-1]) == ["Position 3 ist nicht belegt – ohne Wahl oder Decider bleibt sie offen."]
    table = {
        # Poolgröße: zwei Sperren und die Vorgabe brauchen drei Maps.
        "zu kleiner Pool": (problems([*WITH_PRESET[:8], step("ban", CTL, "A"), step("ban", CTL, "B"), step("preset", CTL, None, 3)],
                                     the_pool=pool(ctl=2)),
                            "Kontrolle: 2 Sperren und 0 Wahlen und die Vorgabe der Woche brauchen 3 Maps – der Pool hat 2."),
        # Länge gegen Best of.
        "Position über Best of": (problems([*WITH_PRESET[:8], step("preset", CTL, None, 6)]), "Schritt 9: Position 6 gibt es bei Best of 5 nicht."),
        "doppelte Position": (problems([*WITH_PRESET, step("decider", CTL, None, 3)], the_pool=pool(ctl=2)),
                              "Position 3 ist mehrfach belegt (Schritt 9 und 10)."),
        "falscher Modus": (problems([*WITH_PRESET[:8], step("preset", HP, None, 3)]),
                           "Schritt 9: Auf Position 3 wird laut „Modus je Map“ Kontrolle gespielt, nicht Stellung."),
        "zwei Vorgaben": (problems([*WITH_PRESET, step("preset", CTL, None, 3)]), "Kontrolle: höchstens eine Vorgabe der Woche je Modus."),
        "Modus ohne Maps": (problems([*WITH_PRESET[:8], step("preset", "nachtmodus", None, 3)], order=[]),
                            "Schritt 9: Der Modus „nachtmodus“ hat keine Maps im Pool."),
    }
    for name, (found, expected) in table.items():
        assert expected in found, (name, found)
    # Vorgabe und Decider im selben Modus: Stellung hat vier Maps - zwei Sperren, die Vorgabe (Map 1) und die übrige wird Map 4.
    mixed = [step("ban", HP, "A"), step("ban", HP, "B"), step("preset", HP, None, 1), step("decider", HP, None, 4), *WITH_PRESET[4:]]
    assert problems(mixed) == []
    assert problems(mixed, the_pool=pool(hp=5)) == [
        "Stellung: Der Decider braucht genau eine übrige Map – nach 2 Sperren und 0 Wahlen und der Vorgabe der Woche bleiben 2."]
    # Wo der Schritt der Vorgabe steht, ändert nichts - die Map ist von Anfang an aus dem Modus genommen.
    late = [step("ban", HP, "A"), step("ban", HP, "B"), step("decider", HP, None, 4), step("preset", HP, None, 1), *WITH_PRESET[4:]]
    assert problems(late) == []


def test_never_counts_the_preset_as_a_played_map():
    # Jede Map nur einmal je Serie: Kontrolle hat nur „nebel“, Stellung und Suchen haben „nebel“ und je eine weitere. Mit Nebel als
    # Vorgabe für Kontrolle bleibt für die Wahl in Stellung und Suchen je eine Map - das geht auf.
    tiny = pool(hp=2, snd=2, ctl=1, shared=True)
    steps = [step("pick", HP, "A", 1), step("pick", SND, "B", 2), step("preset", CTL, None, 3)]
    assert problems(steps, best_of=3, order=ORDER[:3], repeat="never", the_pool=tiny) == []
    # Gegenprobe: zwei Wahlen je Modus brauchen Nebel selbst - dann bleibt für die Vorgabe keine Map.
    full = [step("pick", HP, "A", 1), step("pick", HP, "B", 4), step("pick", SND, "B", 2), step("pick", SND, "A", 5), step("preset", CTL, None, 3)]
    assert problems(full, repeat="never", the_pool=tiny) == [
        "Mit „jede Map nur einmal je Serie“ lässt sich die Vorlage mit diesem Pool nicht zu Ende spielen – bitte Sperren oder Pool anpassen."]
    assert problems(full, repeat="other_mode", the_pool=tiny) == [], "in einem anderen Modus darf Nebel noch einmal laufen"


# ---------------------------------------------------------------- Simulation

def test_the_preset_map_can_neither_be_banned_nor_picked():
    the_pool = pool(shared=True)
    steps = [step("ban", CTL, "A"), step("ban", CTL, "B"), step("preset", CTL, None, 3), step("pick", HP, "A", 1)]
    start = veto.reserve(veto.pool_ids(the_pool), steps, {CTL: "ctl-2"}, "other_mode")
    assert start[CTL] == ["nebel", "ctl-3"] and start[HP] == veto.pool_ids(the_pool)[HP], "nur im eigenen Modus genommen"
    assert veto.allowed_options(start, steps, "other_mode") == ["nebel", "ctl-3"], "die Vorgabe steht nicht zur Sperre"
    # Gegenprobe: ohne Vorgabe sind alle drei Maps sperrbar.
    assert veto.allowed_options(veto.pool_ids(the_pool), steps[:2], "other_mode") == ["nebel", "ctl-2", "ctl-3"]
    # Jede Map nur einmal je Serie: Nebel als Vorgabe für Kontrolle fällt auch in Stellung weg.
    never = veto.reserve(veto.pool_ids(the_pool), steps, {CTL: "nebel"}, "never")
    assert "nebel" not in never[HP] and "nebel" not in never[SND] and never[CTL] == ["ctl-2", "ctl-3"]
    assert veto.allowed_options(never, [steps[3]], "never") == ["hp-2", "hp-3", "hp-4"]
    assert veto.reserve(never, steps, {CTL: "nebel"}, "never") == never, "zweimal anwenden ändert nichts"
    assert veto.reserve(veto.pool_ids(the_pool), steps, {}, "never") == veto.pool_ids(the_pool), "ohne Vorgabe bleibt der Stand"
    # Der Schritt selbst hat nichts zu wählen - die Map steht fest.
    assert veto.allowed_options(start, [steps[2]], "other_mode") == []
    assert veto.completable(start, steps, "other_mode") is True
    assert veto.remaining_after([{**steps[2], "map_id": "ctl-2"}], the_pool, "other_mode")[CTL] == ["nebel", "ctl-3"]


# ---------------------------------------------------------------- Vorgaben je Spielwoche

def test_the_presets_of_a_season_keep_one_map_per_week_and_mode():
    raw = [{"week": 2, "mode": CTL, "map_id": "ctl-2"}, {"week": 1, "mode": " Kontrolle ", "map_id": "ctl-1"}, {"week": 3, "mode": CTL, "map_id": ""}]
    clean = veto.normalize_presets(raw)
    assert clean == [{"week": 1, "mode": "Kontrolle", "map_id": "ctl-1"}, {"week": 2, "mode": CTL, "map_id": "ctl-2"}], "leer = noch nicht gewählt"
    assert veto.normalize_presets(None) == [] and veto.presets_of("kaputt") == [], "verbogen zählt wie keine Vorgabe"
    assert veto.presets_of_week(clean, 2) == {CTL: "ctl-2"} and veto.presets_of_week(clean, 4) == {} and veto.presets_of_week(clean, None) == {}
    for bad, text in (
        ("x", "keine Liste"), ([{"week": 0, "mode": CTL, "map_id": "a"}], "1 bis 60"), ([{"week": "1", "mode": CTL, "map_id": "a"}], "ganze Zahl"),
        ([{"week": 1, "mode": "", "map_id": "a"}], "Modus"), ([{"week": 1, "mode": CTL, "map_id": "a", "name": "x"}], "unbekannte Angaben"),
        ([{"week": 1, "mode": CTL, "map_id": "a"}, {"week": 1, "mode": CTL, "map_id": "b"}], "je Modus nur eine Vorgabe"),
    ):
        with pytest.raises(veto.VetoProblem) as problem:
            veto.normalize_presets(bad)
        assert text in problem.value.detail


def test_a_week_says_what_is_missing_or_does_not_fit():
    the_pool = pool()

    def check(presets, **extra):
        return veto.week_problems(rules(), presets, pool=the_pool, repeat="other_mode", **extra)

    assert check({CTL: "ctl-2"}) == []
    assert check({}) == ["Kontrolle: Die Vorgabe der Woche fehlt."] and check(None) == ["Kontrolle: Die Vorgabe der Woche fehlt."]
    assert check({CTL: "hp-1"}) == ["Kontrolle: Die vorgegebene Map steht nicht im Pool des Modus."]
    assert check({}, labels={CTL: "Kapern"}) == ["Kapern: Die Vorgabe der Woche fehlt."]
    assert veto.week_problems(rules(WITH_PRESET[:8]), {}, pool=the_pool, repeat="other_mode") == [], "ohne Schritt keine Vorgabe nötig"
    # Jede Map nur einmal je Serie: dieselbe Map für zwei Modi geht nicht, und die Vorgabe darf die Wahlen nicht aushungern.
    shared = pool(hp=2, snd=2, ctl=1, shared=True)
    two = rules([step("preset", HP, None, 1), step("pick", SND, "B", 2), step("preset", CTL, None, 3)])
    assert veto.week_problems(two, {HP: "nebel", CTL: "nebel"}, pool=shared, repeat="never") == [
        "Nebel ist für Stellung und Kontrolle vorgegeben – in dieser Season jede Map nur einmal je Serie."]
    assert veto.week_problems(two, {HP: "hp-2", CTL: "nebel"}, pool=shared, repeat="never") == []
    assert veto.week_problems(two, {HP: "nebel", CTL: "nebel"}, pool=shared, repeat="other_mode") == [], "in anderem Modus erlaubt"
    starved = rules([step("pick", HP, "A", 1), step("pick", HP, "B", 4), step("preset", CTL, None, 3)])
    assert veto.week_problems(starved, {CTL: "nebel"}, pool=shared, repeat="never") == [
        "Mit diesen Vorgaben lässt sich die Vorlage nicht zu Ende spielen – bitte eine andere Map vorgeben."]


def test_the_rotation_walks_through_the_pool_week_by_week():
    the_pool = pool()
    rows = veto.rotate(rules(), pool=the_pool, weeks=5, repeat="other_mode")
    assert [(row["week"], row["mode"], row["map_id"]) for row in rows] == [
        (1, CTL, "ctl-1"), (2, CTL, "ctl-2"), (3, CTL, "ctl-3"), (4, CTL, "ctl-1"), (5, CTL, "ctl-2")]
    assert veto.rotate(rules(WITH_PRESET[:8]), pool=the_pool, weeks=5, repeat="other_mode") == [], "ohne Schritt nichts vorzuschlagen"
    assert veto.rotate(rules(), pool=None, weeks=5, repeat="other_mode") == [] and veto.rotate(rules(), pool=the_pool, weeks=0, repeat="never") == []
    # Jede Map nur einmal je Serie: Zwei Modi mit derselben ersten Map weichen in derselben Woche aus.
    shared = pool(hp=3, snd=3, ctl=3, shared=True)
    two = rules([step("preset", HP, None, 1), step("pick", SND, "B", 2), step("preset", CTL, None, 3)])
    never = veto.rotate(two, pool=shared, weeks=2, repeat="never")
    assert [(row["week"], row["mode"], row["map_id"]) for row in never] == [(1, HP, "nebel"), (1, CTL, "ctl-2"), (2, HP, "hp-2"), (2, CTL, "ctl-2")]
    for week in (1, 2):
        assert veto.week_problems(two, veto.presets_of_week(never, week), pool=shared, repeat="never") == []
    free = veto.rotate(two, pool=shared, weeks=1, repeat="other_mode")
    assert [(row["mode"], row["map_id"]) for row in free] == [(HP, "nebel"), (CTL, "nebel")], "ohne die Regel rotiert jeder Modus für sich"
