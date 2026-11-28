"""Ein Baustein für Abstimmungen (#2612): Antworten, Auszählung und Ergebnis in einer Form.

Zwei Stellen stimmen ab, beide zeigen dasselbe:

- **Versammlungen** (#327, ``dolibarr_meetings``): Stimmrechte und Ergebnis kommen aus der Vereinsakte, die Website zählt
  nicht selbst. Sie nimmt von hier nur die Form der Antworten und des Ergebnisses.
- **Abstimmungen am Event** (#2612, ``event_polls``): Die Website zählt selbst - mit ``tally`` - und gibt das Ergebnis in
  derselben Form weiter.

Web und App lesen so bei beiden dieselben Felder: ``options`` (Code und Beschriftung), ``rights`` (wer mit welchem
Stimmrecht abstimmt) und ``result`` (Zahl je Antwort, gültige Stimmen, Gewinner). Welche Person wie gestimmt hat, steht
in keiner dieser Formen.
"""
from __future__ import annotations


def options_view(raw) -> list[dict]:
    """Die Antworten einer Abstimmung: nur echte Einträge, Code und Beschriftung als Text."""
    if not isinstance(raw, list):
        return []
    return [{"code": str(item.get("code") or ""), "label": str(item.get("label") or "")} for item in raw if isinstance(item, dict)]


def labels_of(options: list[dict]) -> dict[str, str]:
    return {option["code"]: option["label"] for option in options}


def result_view(*, counts: dict, options: list[dict], outcome: str, outcome_label: str, valid: int, winner: str,
                passed: bool = False, abstain: int = 0, revision: int = 0) -> dict:
    """Das Ergebnis, wie Web und App es zeigen: je Antwort die Zahl, in der Reihenfolge der Antworten."""
    labels = labels_of(options)
    return {
        "revision": int(revision or 0), "outcome": outcome, "outcome_label": outcome_label,
        "passed": bool(passed), "valid": int(valid or 0), "abstain": int(abstain or 0),
        "counts": [{"code": option["code"], "label": option["label"], "count": int(counts.get(option["code"]) or 0)} for option in options],
        "winner": winner, "winner_label": labels.get(winner, winner),
    }


def tally(choices: list[list[str]], options: list[dict]) -> dict:
    """Zählen, wenn die Website selbst zählt: je Stimme die gewählten Antworten. Gewinner ist die eine Antwort mit den
    meisten Stimmen - bei Gleichstand keine (``tie``), ohne Stimmen auch keine (``none``). Antworten, die es nicht (mehr)
    gibt, zählen nicht; eine Stimme nur mit solchen zählt nicht als gültig."""
    known = [option["code"] for option in options]
    counts = {code: 0 for code in known}
    valid = 0
    for chosen in choices:
        hits = {code for code in chosen or [] if code in counts}
        if not hits:
            continue
        valid += 1
        for code in hits:
            counts[code] += 1
    best = max(counts.values(), default=0)
    leaders = [code for code in known if counts[code] == best]
    if not valid:
        return {"counts": counts, "valid": 0, "winner": "", "outcome": "none"}
    if len(leaders) > 1:
        return {"counts": counts, "valid": valid, "winner": "", "outcome": "tie"}
    return {"counts": counts, "valid": valid, "winner": leaders[0], "outcome": "winner"}
