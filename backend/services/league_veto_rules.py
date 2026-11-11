"""Veto der Liga - die Regeln ohne Datenbank (docs/LIGA.md, „D.3 Veto“, #1618; Regelwerk § 6 und Anlage B).

Blatt-Modul: die Vorlage einer Season prüfen (deutsche Sätze, kein JSON), die Schritte gegen einen Pool simulieren, die wählbaren Maps
eines Schritts bestimmen (nur, was die Serie vervollständigbar lässt), die Zufallswahl nach Ablauf und der Vorschlag aus Modusfolge und
Poolgrößen. ``checkin_rules`` (Stand), ``league_veto`` (Datenbank), ``league_readiness`` (Prüfung) und ``league_rule_blocks`` (Baustein)
lesen nur hier. Kein Wert eines Titels steht hier.

Begriffe wie im Ergebnisblatt der Referenz-Ligen (#1931, ``team_league_sheet.ROLES``): eine Map ist ``banned``, ``picked`` oder
``decider``. Die Schrittarten der Vorlage heißen ``ban``, ``pick`` und ``decider``; das Modell bleibt offen für weitere Arten.

**Vorgabe der Woche** (``preset``, #2326, Entscheidung Nr. 122): Die Liga-Leitung legt je Spielwoche für einen Modus eine Map fest. Sie
ist vom ersten Schritt an aus ihrem Modus genommen (bei „jede Map nur einmal je Serie“ aus allen) - weder sperrbar noch wählbar -, und
das System setzt sie an ihrer Stelle der Schrittfolge auf ihre Position. Welche Map das ist, steht nicht in der Vorlage, sondern je
Spielwoche an der Season (``normalize_presets``, ``week_problems``, ``rotate``).
"""
from __future__ import annotations

import secrets
from datetime import datetime, timezone

from services.league_scope import is_league_staffel

BAN, PICK, DECIDER, PRESET = "ban", "pick", "decider", "preset"
KINDS = (BAN, PICK, DECIDER, PRESET)
# Schritte, die das System setzt - ohne Team und ohne Frist.
SYSTEM_KINDS = frozenset({DECIDER, PRESET})
TEAMS = ("A", "B")
HOME, DRAW = "home", "draw"
TEAM_A_CHOICES = (HOME, DRAW)
ROLE_OF = {BAN: "banned", PICK: "picked", DECIDER: "decider", PRESET: "preset"}
NEVER, OTHER_MODE, ALWAYS = "never", "other_mode", "always"
STEPS_MAX = 60
POSITION_MAX = 9
# Vorgaben je Spielwoche (#2326): so viele Wochen höchstens.
WEEKS_MAX = 60
SECONDS = (10, 600)
# Stände eines Vetos am Spiel (``flow.veto.status``).
RUNNING, PAUSED, DONE, SKIPPED = "running", "paused", "done", "skipped"
OPEN_STATUSES = frozenset({RUNNING, PAUSED})
# Suche bei „jede Map nur einmal je Serie“: so viele Zustände höchstens, danach gilt die Vorlage als nicht prüfbar.
SEARCH_BUDGET = 50_000


def defaults() -> dict:
    """Die Vorgabe einer neuen Season: Veto aus, Team A = Heim, 60 Sekunden, keine Schritte."""
    return {"enabled": False, "team_a": HOME, "step_seconds": 60, "steps": []}


# Merker „unberührt“ (Fabian Nr. 108): neue Seasons tragen ihn, das erste Speichern von Hand nimmt ihn weg. Solange er steht, zieht die
# Vorlage beim Speichern des Pools nach (``league_veto.follow_pool``). ``normalize`` übergeht ihn - er ist kein Teil der Vorlage.
AUTO = "auto"


def is_auto(raw) -> bool:
    return isinstance(raw, dict) and raw.get(AUTO) is True


class VetoProblem(Exception):
    """Etwas an der Vorlage oder einem Zug passt nicht - mit deutscher Meldung und HTTP-Status (Vorgabe 422)."""

    def __init__(self, detail: str, status_code: int = 422):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


# ---------------------------------------------------------------- Vorlage: Form

def _int(value, label: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise VetoProblem(f"{label}: bitte eine ganze Zahl.")
    if not low <= value <= high:
        raise VetoProblem(f"{label}: erlaubt sind {low} bis {high}.")
    return value


def normalize(raw) -> dict:
    """Die Vorlage aus einer Eingabe der Verwaltung - die Form (Felder, Arten, Teams, Positionen als Zahl). Ob sie zu Pool, Best of und
    Modusfolge passt, sagt ``template_problems``."""
    if not isinstance(raw, dict):
        raise VetoProblem("Die Veto-Vorlage fehlt.")
    if set(raw) - set(defaults()) - {AUTO}:
        raise VetoProblem("Die Veto-Vorlage enthält ein unbekanntes Feld.")
    enabled = raw.get("enabled", False)
    if not isinstance(enabled, bool):
        raise VetoProblem("Veto an/aus: bitte ja oder nein.")
    team_a = raw.get("team_a") or HOME
    if team_a not in TEAM_A_CHOICES:
        raise VetoProblem("Team A: bitte „Heimteam“ oder „Los“ wählen.")
    seconds = _int(raw.get("step_seconds", 60), "Zeit je Schritt (Sekunden)", *SECONDS)
    steps_raw = raw.get("steps") or []
    if not isinstance(steps_raw, list):
        raise VetoProblem("Die Schritte der Vorlage sind keine Liste.")
    if len(steps_raw) > STEPS_MAX:
        raise VetoProblem(f"Höchstens {STEPS_MAX} Schritte je Vorlage.")
    steps = []
    for number, item in enumerate(steps_raw, 1):
        if not isinstance(item, dict) or set(item) - {"kind", "mode", "team", "position"}:
            raise VetoProblem(f"Schritt {number}: unbekannte Angaben.")
        kind = item.get("kind")
        if kind not in KINDS:
            raise VetoProblem(f"Schritt {number}: bitte Sperren, Wählen, Decider oder Vorgabe der Woche wählen.")
        mode = " ".join(str(item.get("mode") or "").split())
        if not mode or len(mode) > 40:
            raise VetoProblem(f"Schritt {number}: bitte den Modus wählen.")
        team = item.get("team")
        position = item.get("position")
        if kind in SYSTEM_KINDS:
            if team not in (None, ""):
                what = "Den Decider" if kind == DECIDER else "Die Vorgabe der Woche"
                raise VetoProblem(f"Schritt {number}: {what} setzt das System - kein Team.")
            team = None
        elif team not in TEAMS:
            raise VetoProblem(f"Schritt {number}: bitte Team A oder Team B wählen.")
        if kind == BAN:
            if position not in (None, ""):
                raise VetoProblem(f"Schritt {number}: Eine Sperre hat keine Position in der Serie.")
            position = None
        else:
            position = _int(position, f"Schritt {number}: Position", 1, POSITION_MAX)
        steps.append({"kind": kind, "mode": mode, "team": team, "position": position})
    return {"enabled": enabled, "team_a": team_a, "step_seconds": seconds, "steps": steps}


def rules_of(tournament: dict | None) -> dict | None:
    """Die aktive Vorlage einer Staffel - ``None`` für Turniere ohne Liga, ohne Feld, mit Veto aus oder ohne Schritte. Ein von Hand
    verbogener Wert schaltet das Veto aus, er sperrt nichts."""
    if not is_league_staffel(tournament):
        return None
    raw = tournament.get("veto_rules")
    if not isinstance(raw, dict) or not raw.get("enabled"):
        return None
    try:
        rules = normalize(raw)
    except VetoProblem:
        return None
    return rules if rules["steps"] else None


# ---------------------------------------------------------------- Simulation

def pool_maps(pool: dict | None) -> dict[str, list[dict]]:
    """Je Modus die Maps des Pools (Schnappschuss) in Pool-Reihenfolge - nur Modi mit Kennung."""
    return {group["mode"]: [item for item in group.get("maps") or [] if item.get("map_id")]
            for group in (pool or {}).get("modes") or [] if group.get("mode")}


def pool_labels(pool: dict | None) -> dict[str, str]:
    return {group["mode"]: group.get("label") or group["mode"] for group in (pool or {}).get("modes") or [] if group.get("mode")}


def pool_ids(pool: dict | None) -> dict[str, list[str]]:
    return {mode: [item["map_id"] for item in maps] for mode, maps in pool_maps(pool).items()}


def _without(remaining: dict[str, list[str]], mode: str, map_id: str, *, everywhere: bool) -> dict[str, list[str]]:
    out = {}
    for key, ids in remaining.items():
        out[key] = [item for item in ids if item != map_id] if everywhere or key == mode else list(ids)
    return out


def apply_step(remaining: dict[str, list[str]], step: dict, map_id: str, repeat: str) -> dict[str, list[str]]:
    """Der Stand nach einem Schritt: eine Sperre nimmt die Map aus ihrem Modus; Wahl, Decider und Vorgabe der Woche ebenso - bei „jede
    Map nur einmal je Serie“ aus allen Modi (die Map wird gespielt)."""
    everywhere = step["kind"] != BAN and repeat == NEVER
    return _without(remaining, step["mode"], map_id, everywhere=everywhere)


def remaining_after(done: list[dict], pool: dict | None, repeat: str) -> dict[str, list[str]]:
    remaining = pool_ids(pool)
    for step in done:
        if step.get("map_id"):
            remaining = apply_step(remaining, step, step["map_id"], repeat)
    return remaining


def _counts(steps: list[dict]) -> dict[str, list[int]]:
    """Je Modus [Sperren, Wahlen, Decider, Vorgaben der Woche] der genannten Schritte."""
    out: dict[str, list[int]] = {}
    for step in steps:
        row = out.setdefault(step["mode"], [0, 0, 0, 0])
        row[KINDS.index(step["kind"])] += 1
    return out


def preset_steps(steps: list[dict] | None) -> list[dict]:
    """Die Schritte „Vorgabe der Woche“ einer Vorlage, in ihrer Reihenfolge."""
    return [step for step in steps or [] if step.get("kind") == PRESET]


def _without_presets(steps: list[dict]) -> list[dict]:
    return [step for step in steps if step["kind"] != PRESET]


def reserve(remaining: dict[str, list[str]], steps: list[dict] | None, presets: dict[str, str] | None, repeat: str) -> dict[str, list[str]]:
    """Die Vorgaben der Woche aus dem Stand nehmen - vom ersten Schritt an, damit sie niemand sperrt oder wählt. Mehrfach anwenden
    ändert nichts; ein Modus ohne Vorgabe bleibt, wie er ist."""
    for step in preset_steps(steps):
        map_id = (presets or {}).get(step["mode"])
        if map_id:
            remaining = apply_step(remaining, step, map_id, repeat)
    return remaining


def _countable(remaining: dict[str, list[str]], steps: list[dict], *, exact_decider: bool) -> bool:
    """Reicht der Pool je Modus noch? Mit ``exact_decider`` muss vor einem Decider genau eine Map übrig bleiben (Modi unabhängig,
    ``other_mode``/``always``); ohne gilt nur die Untergrenze (Vorprüfung der Suche bei ``never``). Vorgaben der Woche zählen hier
    nicht: Ihre Maps sind schon aus dem Stand genommen (``reserve``)."""
    for mode, (bans, picks, deciders, _presets) in _counts(steps).items():
        have = len(remaining.get(mode) or [])
        if deciders > 1 or have < bans + picks + deciders:
            return False
        if exact_decider and deciders == 1 and have != bans + picks + 1:
            return False
    return True


def _search(remaining: dict[str, list[str]], steps: list[dict], index: int, memo: dict, budget: list[int]) -> bool | None:
    """Gibt es einen vollständigen Durchlauf bei „jede Map nur einmal je Serie“? ``None``: Suchbudget verbraucht."""
    if index >= len(steps):
        return True
    key = (index, tuple((mode, tuple(remaining[mode])) for mode in sorted(remaining)))
    if key in memo:
        return memo[key]
    if budget[0] <= 0:
        return None
    budget[0] -= 1
    if not _countable(remaining, steps[index:], exact_decider=False):
        memo[key] = False
        return False
    step = steps[index]
    options = list(remaining.get(step["mode"]) or [])
    if step["kind"] == DECIDER and len(options) != 1:
        memo[key] = False
        return False
    found = False
    for map_id in options:
        result = _search(apply_step(remaining, step, map_id, NEVER), steps, index + 1, memo, budget)
        if result is None:
            return None
        if result:
            found = True
            break
    memo[key] = found
    return found


def completable(remaining: dict[str, list[str]], steps: list[dict], repeat: str) -> bool | None:
    """Lassen sich die Schritte mit den übrigen Maps noch zu Ende spielen? Bei ``other_mode`` und ``always`` sind die Modi unabhängig,
    das ist eine Zählung; bei ``never`` eine Suche mit Merkliste. ``None``: zu groß zum Prüfen. ``remaining`` ist der Stand ohne die
    Vorgaben der Woche (``reserve``) - ihre Schritte brauchen keine Map mehr."""
    steps = _without_presets(steps)
    if not steps:
        return True
    if repeat != NEVER:
        return _countable(remaining, steps, exact_decider=True)
    return _search(remaining, steps, 0, {}, [SEARCH_BUDGET])


def allowed_options(remaining: dict[str, list[str]], steps: list[dict], repeat: str) -> list[str]:
    """Die Maps, die der erste der offenen Schritte wählen darf: im Modus noch offen und danach bleibt die Serie vervollständigbar.
    Ist die Suche zu groß, gilt die Zählung als Untergrenze - lieber eine Wahl zu viel als ein Veto, das steht."""
    if not steps:
        return []
    step = steps[0]
    if step["kind"] == PRESET:
        # Die Map steht mit der Spielwoche fest - hier gibt es nichts zu wählen (``league_veto`` setzt sie).
        return []
    candidates = list(remaining.get(step["mode"]) or [])
    if step["kind"] == DECIDER:
        return candidates if len(candidates) == 1 else []
    out = []
    for map_id in candidates:
        verdict = completable(apply_step(remaining, step, map_id, repeat), steps[1:], repeat)
        if verdict is None:
            verdict = _countable(apply_step(remaining, step, map_id, repeat), _without_presets(steps[1:]), exact_decider=False)
        if verdict:
            out.append(map_id)
    return out


def auto_choice(options: list[str], rng=None) -> str:
    """Nach Ablauf der Zeit: zufällig und gleichverteilt aus den wählbaren Maps (``secrets.SystemRandom``)."""
    if not options:
        raise VetoProblem("Für diesen Schritt ist keine Map mehr wählbar.", 409)
    return (rng or secrets.SystemRandom()).choice(options)


# ---------------------------------------------------------------- Vorlage: Inhalt

def _plural(count: int, one: str, many: str) -> str:
    return f"{count} {one if count == 1 else many}"


def template_problems(rules: dict, *, pool: dict | None, best_of: int, order: list | None, repeat: str,
                      labels: dict[str, str] | None = None) -> list[str]:
    """Was an der Vorlage nicht passt - deutsche Sätze, leer heißt: sie geht auf. Ohne Pool wird nur gegen Positionen und Modusfolge
    geprüft (die Poolgrößen fehlen dann)."""
    steps = rules.get("steps") or []
    if not steps:
        return ["Die Vorlage hat noch keine Schritte."]
    names = {**pool_labels(pool), **(labels or {})}
    label = lambda mode: names.get(mode) or mode  # noqa: E731 - kurz und lesbar
    ids = pool_ids(pool)
    order = [mode for mode in order or [] if mode]
    best_of = max(1, int(best_of or 1))
    out: list[str] = []
    for number, step in enumerate(steps, 1):
        if pool is not None and step["mode"] not in ids:
            out.append(f"Schritt {number}: Der Modus „{label(step['mode'])}“ hat keine Maps im Pool.")
    taken: dict[int, list[int]] = {}
    for number, step in enumerate(steps, 1):
        if step["kind"] == BAN:
            continue
        position = int(step["position"])
        if position > best_of:
            out.append(f"Schritt {number}: Position {position} gibt es bei Best of {best_of} nicht.")
            continue
        taken.setdefault(position, []).append(number)
        if order:
            expected = order[(position - 1) % len(order)]
            if step["mode"] != expected:
                out.append(f"Schritt {number}: Auf Position {position} wird laut „Modus je Map“ {label(expected)} gespielt, "
                           f"nicht {label(step['mode'])}.")
    for position, numbers in sorted(taken.items()):
        if len(numbers) > 1:
            out.append(f"Position {position} ist mehrfach belegt (Schritt {' und '.join(str(n) for n in numbers)}).")
    for position in range(1, best_of + 1):
        if position not in taken:
            out.append(f"Position {position} ist nicht belegt – ohne Wahl oder Decider bleibt sie offen.")
    for mode, (bans, picks, deciders, presets) in _counts(steps).items():
        if deciders > 1:
            out.append(f"{label(mode)}: höchstens ein Decider je Modus.")
        if presets > 1:
            out.append(f"{label(mode)}: höchstens eine Vorgabe der Woche je Modus.")
        # Die Vorgabe der Woche ist von Anfang an aus dem Modus genommen - wo ihr Schritt steht, ändert am Decider nichts.
        own = [step for step in steps if step["mode"] == mode and step["kind"] != PRESET]
        if deciders == 1 and own[-1]["kind"] != DECIDER:
            out.append(f"{label(mode)}: Der Decider muss der letzte Schritt seines Modus sein.")
        have = len(ids.get(mode) or [])
        if not have:
            continue
        needed = bans + picks + deciders + presets
        if have < needed:
            out.append(f"{label(mode)}: {_plural(bans, 'Sperre', 'Sperren')} und {_plural(picks, 'Wahl', 'Wahlen')}"
                       f"{' und ein Decider' if deciders else ''}{' und die Vorgabe der Woche' if presets else ''} brauchen {needed} Maps "
                       f"– der Pool hat {have}.")
        elif deciders == 1 and repeat != NEVER and have != bans + picks + presets + 1:
            out.append(f"{label(mode)}: Der Decider braucht genau eine übrige Map – nach {_plural(bans, 'Sperre', 'Sperren')} und "
                       f"{_plural(picks, 'Wahl', 'Wahlen')}{' und der Vorgabe der Woche' if presets else ''} bleiben "
                       f"{have - bans - picks - presets}.")
    if not out and pool is not None and repeat == NEVER:
        # Ohne die Maps einer Spielwoche (die stehen an der Season, ``week_problems``): Gibt es überhaupt eine Vorgabe, mit der die
        # Vorlage aufgeht? Dafür zählt die Vorgabe wie eine freie Wahl vor allen anderen Schritten.
        free = [{**step, "kind": PICK} for step in preset_steps(steps)]
        verdict = completable(pool_ids(pool), [*free, *_without_presets(steps)], NEVER)
        if verdict is None:
            out.append("Die Vorlage ist zu groß, um sie bei „jede Map nur einmal je Serie“ zu prüfen – bitte weniger Schritte oder Maps.")
        elif not verdict:
            out.append("Mit „jede Map nur einmal je Serie“ lässt sich die Vorlage mit diesem Pool nicht zu Ende spielen – bitte Sperren "
                       "oder Pool anpassen.")
    return out


def fits_problem(rules: dict, *, pool: dict | None, best_of: int, order: list | None, repeat: str) -> str | None:
    """Warum die Vorlage für dieses Spiel nicht läuft (``skipped``) - ``None``: sie passt."""
    if pool is None:
        return "Für dieses Spiel gilt kein Map-Pool."
    problems = template_problems(rules, pool=pool, best_of=best_of, order=order, repeat=repeat)
    return problems[0] if problems else None


# ---------------------------------------------------------------- Vorgabe der Woche (#2326)

def normalize_presets(raw) -> list[dict]:
    """Die Vorgaben einer Season aus einer Eingabe: ``[{week, mode, map_id}]`` - je Spielwoche und Modus höchstens eine Map, sortiert.
    Eine Zeile ohne Map heißt „noch nicht gewählt“ und fällt weg. Ob die Map im Pool steht, sagt ``week_problems``."""
    if raw in (None, ""):
        return []
    if not isinstance(raw, list):
        raise VetoProblem("Die Vorgaben der Woche sind keine Liste.")
    if len(raw) > WEEKS_MAX * POSITION_MAX:
        raise VetoProblem("Zu viele Vorgaben der Woche.")
    seen: dict[tuple[int, str], str] = {}
    for item in raw:
        if not isinstance(item, dict) or set(item) - {"week", "mode", "map_id"}:
            raise VetoProblem("Vorgabe der Woche: unbekannte Angaben.")
        week = _int(item.get("week"), "Spielwoche", 1, WEEKS_MAX)
        mode = " ".join(str(item.get("mode") or "").split())
        if not mode or len(mode) > 40:
            raise VetoProblem(f"Spielwoche {week}: bitte den Modus wählen.")
        map_id = str(item.get("map_id") or "").strip()
        if len(map_id) > 120:
            raise VetoProblem(f"Spielwoche {week}: Die Map ist unbekannt.")
        if (week, mode) in seen:
            raise VetoProblem(f"Spielwoche {week}: je Modus nur eine Vorgabe.")
        seen[(week, mode)] = map_id
    return [{"week": week, "mode": mode, "map_id": map_id} for (week, mode), map_id in sorted(seen.items()) if map_id]


def presets_of(raw) -> list[dict]:
    """Die gespeicherten Vorgaben einer Season - ein von Hand verbogener Wert zählt wie keine Vorgabe."""
    try:
        return normalize_presets(raw)
    except VetoProblem:
        return []


def presets_of_week(presets: list[dict] | None, week: int | None) -> dict[str, str]:
    """Je Modus die vorgegebene Map einer Spielwoche."""
    return {row["mode"]: row["map_id"] for row in presets or [] if week is not None and row.get("week") == week and row.get("map_id")}


def week_problems(rules: dict, presets: dict[str, str] | None, *, pool: dict | None, repeat: str,
                  labels: dict[str, str] | None = None) -> list[str]:
    """Was an den Vorgaben **einer** Spielwoche fehlt oder nicht passt - deutsche Sätze, leer heißt: das Veto kann beginnen. Geprüft wird
    je Schritt „Vorgabe der Woche“: Ist eine Map gewählt, steht sie im Pool ihres Modus, und geht die Vorlage damit auf?"""
    steps = rules.get("steps") or []
    wanted = preset_steps(steps)
    if not wanted:
        return []
    names = {**pool_labels(pool), **(labels or {})}
    ids = pool_ids(pool)
    maps = {mode: {item["map_id"]: item.get("name") or "Die Map" for item in rows} for mode, rows in pool_maps(pool).items()}
    out: list[str] = []
    for step in wanted:
        mode = step["mode"]
        label = names.get(mode) or mode
        map_id = (presets or {}).get(mode)
        if not map_id:
            out.append(f"{label}: Die Vorgabe der Woche fehlt.")
        elif pool is not None and map_id not in (ids.get(mode) or []):
            out.append(f"{label}: Die vorgegebene Map steht nicht im Pool des Modus.")
    if out or pool is None:
        return out
    if repeat == NEVER:
        chosen: dict[str, str] = {}
        for step in wanted:
            map_id = presets[step["mode"]]
            if map_id in chosen:
                out.append(f"{maps[step['mode']][map_id]} ist für {names.get(chosen[map_id]) or chosen[map_id]} und "
                           f"{names.get(step['mode']) or step['mode']} vorgegeben – in dieser Season jede Map nur einmal je Serie.")
            chosen.setdefault(map_id, step["mode"])
        if out:
            return out
    verdict = completable(reserve(ids, steps, presets, repeat), steps, repeat)
    if verdict is False:
        out.append("Mit diesen Vorgaben lässt sich die Vorlage nicht zu Ende spielen – bitte eine andere Map vorgeben.")
    return out


def rotate(rules: dict, *, pool: dict | None, weeks: int, repeat: str) -> list[dict]:
    """Der Vorschlag „rotiert automatisch durch den Pool“: je Modus mit Vorgabe Woche für Woche die nächste Map in Pool-Reihenfolge,
    nach der letzten wieder die erste. Bei „jede Map nur einmal je Serie“ weicht ein zweiter Modus derselben Woche auf die nächste freie
    Map aus. Nur ein Vorschlag - gespeichert wird, was die Leitung danach stehen lässt."""
    ids = pool_ids(pool)
    out: list[dict] = []
    for week in range(1, max(0, min(int(weeks or 0), WEEKS_MAX)) + 1):
        used: set[str] = set()
        for step in preset_steps(rules.get("steps")):
            maps = ids.get(step["mode"]) or []
            if not maps or any(row["week"] == week and row["mode"] == step["mode"] for row in out):
                continue
            order = [maps[(week - 1 + shift) % len(maps)] for shift in range(len(maps))]
            map_id = next((item for item in order if repeat != NEVER or item not in used), order[0])
            used.add(map_id)
            out.append({"week": week, "mode": step["mode"], "map_id": map_id})
    return out


# ---------------------------------------------------------------- Vorschlag

def _other(team: str) -> str:
    return "B" if team == "A" else "A"


def propose(*, order: list | None, pool: dict | None, best_of: int) -> list[dict]:
    """Eine passende Folge wie Anlage B, ohne Werte eines Titels: Modi in der Reihenfolge ihres ersten Auftretens, je Modus beginnt
    abwechselnd Team A, B, A …; ein Modus mit einer Position sperrt bis eine Map bleibt und endet mit dem Decider, ein Modus mit mehreren
    sperrt bis so viele bleiben wie Positionen und wählt dann abwechselnd (jede Wahl die nächste Position des Modus)."""
    ids = pool_ids(pool)
    order = [mode for mode in order or [] if mode]
    modes = order or [mode for mode, maps in ids.items() if maps]
    best_of = max(1, int(best_of or 1))
    if not modes:
        return []
    positions: dict[str, list[int]] = {}
    for position in range(1, best_of + 1):
        positions.setdefault(modes[(position - 1) % len(modes)], []).append(position)
    steps: list[dict] = []
    starter = "A"
    for mode, wanted in positions.items():
        have = len(ids.get(mode) or [])
        team = starter
        if len(wanted) == 1:
            for _ in range(max(0, have - 1)):
                steps.append({"kind": BAN, "mode": mode, "team": team, "position": None})
                team = _other(team)
            steps.append({"kind": DECIDER, "mode": mode, "team": None, "position": wanted[0]})
        else:
            for _ in range(max(0, have - len(wanted))):
                steps.append({"kind": BAN, "mode": mode, "team": team, "position": None})
                team = _other(team)
            for position in wanted:
                steps.append({"kind": PICK, "mode": mode, "team": team, "position": position})
                team = _other(team)
        starter = _other(starter)
    return steps


# ---------------------------------------------------------------- Stand am Spiel

def _iso(value) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    parsed = parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def veto_of(match: dict | None) -> dict | None:
    """Das Veto zum geltenden Termin und seiner Revision - ein neuer Termin macht ein altes ungültig (wie ``flow.ready_for``, D.2),
    auch Termin A → B → wieder A (Codex zu D.3: ``flow.schedule_rev``; Altbestand ohne Revision zählt als 0)."""
    flow = (match or {}).get("flow") or {}
    veto = flow.get("veto")
    if not isinstance(veto, dict):
        return None
    same_time = veto.get("for_at") == _iso((match or {}).get("scheduled_at"))
    return veto if same_time and int(veto.get("rev") or 0) == int(flow.get("schedule_rev") or 0) else None


def veto_pending(match: dict | None, tournament: dict | None) -> bool:
    """Ist zwischen „beide eingecheckt“ und dem Start ein Veto offen? Ohne Vorlage nie; mit Vorlage, solange keins zum Termin da ist
    (es beginnt beim nächsten Lesen oder Zug) oder es läuft bzw. pausiert."""
    if not rules_of(tournament):
        return False
    veto = veto_of(match)
    return veto is None or veto.get("status") in OPEN_STATUSES


def step_sentence(step: dict, label: str) -> str:
    """„Team A sperrt eine Map (Stellung)“, „Team B wählt Map 4 (Suchen)“, „Die übrige Map wird Map 3 (Kontrolle)“ - für Baustein und
    Verwaltung."""
    if step["kind"] == DECIDER:
        return f"Die übrige Map wird Map {step['position']} ({label})"
    if step["kind"] == PRESET:
        return f"Die Liga-Leitung gibt Map {step['position']} je Spielwoche vor ({label})"
    who = f"Team {step['team']}"
    if step["kind"] == BAN:
        return f"{who} sperrt eine Map ({label})"
    return f"{who} wählt Map {step['position']} ({label})"


__all__ = ["BAN", "PICK", "DECIDER", "PRESET", "KINDS", "SYSTEM_KINDS", "TEAMS", "HOME", "DRAW", "ROLE_OF", "RUNNING", "PAUSED", "DONE",
           "SKIPPED", "WEEKS_MAX", "VetoProblem", "allowed_options", "apply_step", "auto_choice", "completable", "defaults", "fits_problem",
           "normalize", "normalize_presets", "pool_ids", "pool_labels", "pool_maps", "preset_steps", "presets_of", "presets_of_week",
           "propose", "remaining_after", "reserve", "rotate", "rules_of", "step_sentence", "template_problems", "veto_of", "veto_pending",
           "week_problems"]
