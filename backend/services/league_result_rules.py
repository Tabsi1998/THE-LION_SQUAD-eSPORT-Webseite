"""Ergebnisregeln in der Liga (docs/LIGA.md, Abschnitt „C.3 Ergebnisregeln“, #1617).

- Die **Season** hält die Regeln der Modi (C.1, ``games.match_modes[].result_rule``) als Kopie fest (``result_rules``), je Modus
  abweichend einstellbar, dazu ``scores_required`` (Punkte je Map Pflicht). Eine spätere Änderung am Modus ändert die Season nicht.
- Die **Staffel** trägt beides (``staffel_fields``), ``league_games.normalize_games`` prüft je Map mit ``check_map``.
- Dazu die optionalen Zusatzfelder einer Map (``game_extras``): Status, Wiederholung, Wertung, Seite, Nachweis.

Bewusst ohne Importe aus ``league_games``: das Modul ruft diese Funktionen. Keine Werte eines Titels - Ziel und Grenzen stehen am
Modus bzw. an der Season.
"""
from __future__ import annotations

import math

SCORE, ROUNDS, HIGHEST = "score", "rounds", "highest"
REQUIRED_DETAIL = "{label}: bitte die Punkte beider Seiten eintragen – in dieser Liga sind sie Pflicht."
PARTIAL_DETAIL = "{label}: bitte die Punkte beider Seiten eintragen."
REASON_MIN, REASON_MAX = 5, 200
OVERRIDE_REASON_MIN = 5


class RuleProblem(ValueError):
    """Etwas passt nicht zur Regel - mit dem deutschen Satz für die Seite."""

    def __init__(self, detail: str, status_code: int = 422):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def _number(value) -> str:
    """Eine Zahl, wie Menschen sie lesen: 250 statt 250.0, 12,5 statt 12.5."""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).replace(".", ",")


# ---------------------------------------------------------------- Regeln der Season


def _modes(game: dict | None) -> list[dict]:
    modes = (game or {}).get("match_modes")
    return [mode for mode in modes if isinstance(mode, dict) and mode.get("mode")] if isinstance(modes, list) else []


def rules_of_game(game: dict | None) -> dict[str, dict]:
    """Die Regeln aller Modi des Spiels, die eine haben - in jedem Zustand (auch ein inaktiver Modus kann im Pool stehen)."""
    return {mode["mode"]: dict(mode["result_rule"]) for mode in _modes(game) if isinstance(mode.get("result_rule"), dict)}


def new_season_fields(game: dict | None) -> dict:
    """Was eine **neue** Season bekommt: die Kopie der Regeln und die Punktepflicht. Ältere Seasons tragen beides nicht."""
    return {"result_rules": rules_of_game(game), "scores_required": True}


def _rule_problem_text(error) -> str:
    """Der deutsche Satz aus einer Prüfung von ``GameModeResultRule`` - nie die englische Meldung von pydantic."""
    for item in error.errors():
        if item.get("type") == "value_error":
            message = str(item.get("msg") or "")
            return message.split("Value error, ", 1)[-1]
    return ("Ergebnisregel: bitte die Art (Punkte bis zum Ziel, Runden gewinnen, höherer Endstand) und Zahlen im erlaubten "
            "Bereich angeben.")


def clean_rule(raw, label: str) -> dict:
    from pydantic import ValidationError

    from models import GameModeResultRule

    try:
        return GameModeResultRule.model_validate(raw).model_dump()
    except ValidationError as error:
        raise RuleProblem(f"Modus „{label}“: {_rule_problem_text(error)}") from None


def clean_rules(raw, game: dict | None, saved: dict | None) -> dict[str, dict]:
    """Die Regeln einer Season aus der Eingabe ``{mode: rule | None}``. Neu nur für Modi des Spiels; was die Season schon hat,
    bleibt speicherbar (auch wenn das Spiel den Modus inzwischen nicht mehr kennt). ``None`` heißt: keine Regel."""
    if not isinstance(raw, dict):
        raise RuleProblem("Ergebnisregeln: bitte je Modus eine Regel oder nichts angeben.")
    labels = {mode["mode"]: mode.get("label") or mode["mode"] for mode in _modes(game)}
    known = set(labels) | set(saved or {})
    out: dict[str, dict] = {}
    for key, value in raw.items():
        mode = str(key or "").strip()
        if mode not in known:
            raise RuleProblem(f"Ergebnisregeln: Den Modus „{mode[:40]}“ hat das Spiel nicht.")
        if value is None:
            continue
        out[mode] = clean_rule(value, labels.get(mode, mode))
    return out


def overview(season: dict, game: dict | None) -> list[dict]:
    """Je Modus die Regel der Season neben der des Spiels - für die Verwaltung. Modi des Spiels zuerst, dann die, die nur noch
    die Season kennt."""
    season_rules = season.get("result_rules") or {}
    game_rules = rules_of_game(game)
    rows = []
    for mode in _modes(game):
        key = mode["mode"]
        own, theirs = season_rules.get(key), game_rules.get(key)
        rows.append({"mode": key, "label": mode.get("label") or key, "status": mode.get("status") or "active",
                     "season_rule": own, "game_rule": theirs, "differs": _same(own) != _same(theirs)})
    for key, own in season_rules.items():
        if key not in {row["mode"] for row in rows}:
            rows.append({"mode": key, "label": key, "status": "removed", "season_rule": own, "game_rule": None, "differs": True})
    return rows


def _same(rule: dict | None) -> dict | None:
    """Zum Vergleichen: ``draw_allowed``/``overtime`` fehlen = falsch."""
    if not rule:
        return None
    return {**{"draw_allowed": False, "overtime": False}, **{key: value for key, value in rule.items() if value is not None}}


# ---------------------------------------------------------------- Prüfen je Map


def rule_for(tournament: dict | None, mode: str | None) -> dict | None:
    """Die geltende Regel einer Map: die der Staffel für diesen Modus - ohne Feld oder Modus keine."""
    rules = (tournament or {}).get("result_rules")
    if not mode or not isinstance(rules, dict):
        return None
    rule = rules.get(mode)
    return rule if isinstance(rule, dict) and rule.get("kind") else None


def scores_required(tournament: dict | None) -> bool:
    return bool((tournament or {}).get("scores_required"))


def override_reason(user: dict | None, raw) -> str | None:
    """Ergebnisregel übergehen (Korrektur der Leitung): nur der Superadmin, mit Grund. ``None``: nichts übergehen."""
    from services.permissions import is_superadmin

    reason = " ".join(str(raw or "").split())
    if not reason:
        return None
    if not is_superadmin(user):
        raise RuleProblem("Eine Ergebnisregel übergehen darf nur der Superadmin.", 403)
    if len(reason) < OVERRIDE_REASON_MIN:
        raise RuleProblem(f"Bitte einen Grund angeben, warum die Regel übergangen wird (mindestens {OVERRIDE_REASON_MIN} Zeichen).")
    return reason[:500]


# ---------------------------------------------------------------- Zusatzfelder einer Map

PLAYED, REPLAYED, AWARDED = "played", "replayed", "awarded"
EXTRA_KEYS = ("status", "replay_reason", "decision", "host_registration_id", "proof_id")


def game_extras(item: dict, *, label: str, sides, staff: bool, proof_ids) -> dict:
    """Die freiwilligen Zusatzfelder einer Map geprüft - nur was gesetzt ist, kommt zurück (``played`` wird nicht geschrieben)."""
    out: dict = {}
    status = str(item.get("status") or "").strip() or None
    if status not in (None, PLAYED, REPLAYED):
        raise RuleProblem(f"{label}: Als Stand gibt es nur „gespielt“ oder „wiederholt“.")
    reason = " ".join(str(item.get("replay_reason") or "").split())
    if status == REPLAYED:
        if not REASON_MIN <= len(reason) <= REASON_MAX:
            raise RuleProblem(f"{label}: bitte kurz angeben, warum die Map wiederholt wurde ({REASON_MIN} bis {REASON_MAX} Zeichen).")
        out.update(status=REPLAYED, replay_reason=reason)
    elif reason:
        raise RuleProblem(f"{label}: Einen Grund für eine Wiederholung gibt es nur bei einer wiederholten Map.")
    decision = str(item.get("decision") or "").strip() or None
    if decision not in (None, AWARDED):
        raise RuleProblem(f"{label}: Als Wertung gibt es nur „zugesprochen“.")
    if decision == AWARDED:
        if not staff:
            raise RuleProblem(f"{label}: Eine Map zusprechen kann nur die Liga-Leitung.")
        out["decision"] = AWARDED
    host = str(item.get("host_registration_id") or "").strip() or None
    if host:
        if host not in set(sides):
            raise RuleProblem(f"{label}: Die Seite gehört zu keinem der beiden Teams.")
        out["host_registration_id"] = host
    proof = str(item.get("proof_id") or "").strip() or None
    if proof:
        if proof not in set(proof_ids or ()):
            raise RuleProblem(f"{label}: Diesen Nachweis gibt es an diesem Spiel nicht.")
        out["proof_id"] = proof
    return out


async def attached_proofs(db, match_id: str | None) -> set[str]:
    """Die Fotos, die an diesem Spiel schon hängen (Meldung, Problem) - nur auf sie darf eine Map verweisen."""
    if not match_id:
        return set()
    rows = await db.match_proof_photos.find({"match_id": match_id, "status": "attached"}, {"_id": 0, "id": 1}).to_list(200)
    return {row["id"] for row in rows if row.get("id")}


def not_played(games: list[dict] | None, best_of: int) -> list[int]:
    """Die Positionen nach dem Serienende (``not_played``) - nur, wenn die Maps die Serie entschieden haben."""
    games = games or []
    wins: dict[str, int] = {}
    for game in games:
        winner = game.get("winner_registration_id")
        if winner:
            wins[winner] = wins.get(winner, 0) + 1
    if not games or max(wins.values() or [0]) < best_of // 2 + 1:
        return []
    return list(range(len(games) + 1, best_of + 1))


def check_map(rule: dict | None, scores: dict, winner: str, loser: str, *, label: str, names: dict, required: bool) -> None:
    """Endstand einer Map gegen Sieger und Regel (docs/LIGA.md, C.3). ``scores``: ``{registration_id: Zahl}``, schon als Zahl
    geprüft. Ohne Regel und ohne Pflicht prüft es nichts - so bleibt alles wie vorher."""
    have = [side for side in (winner, loser) if scores.get(side) is not None]
    if required and len(have) < 2:
        raise RuleProblem(REQUIRED_DETAIL.format(label=label))
    if not rule:
        return
    if not have:
        return
    if len(have) < 2:
        raise RuleProblem(PARTIAL_DETAIL.format(label=label))
    won, lost = scores[winner], scores[loser]
    kind = rule.get("kind")
    if kind in (SCORE, ROUNDS) and any(not float(value).is_integer() for value in (won, lost)):
        raise RuleProblem(f"{label}: Punkte bitte als ganze Zahl angeben.")
    stand = f"{_number(won)}:{_number(lost)}"
    if won < lost:
        raise RuleProblem(f"{label}: Der Endstand {stand} passt nicht zum Sieger – mehr Punkte hat {names.get(loser, 'die Gegenseite')}.")
    tie = math.isclose(float(won), float(lost))
    if tie and not rule.get("draw_allowed"):
        raise RuleProblem(f"{label}: Gleichstand ({stand}) gibt es in diesem Modus nicht – bitte Endstand und Sieger prüfen.")
    if kind == HIGHEST:
        return
    target = int(rule.get("target") or 0)
    overtime = bool(rule.get("overtime"))
    if kind == ROUNDS and not overtime and rule.get("round_limit") and won + lost > int(rule["round_limit"]):
        raise RuleProblem(f"{label}: höchstens {rule['round_limit']} Runden – {stand} sind {_number(won + lost)}.")
    if not overtime and target and won > target:
        what = f"{target} Punkte" if kind == SCORE else f"{target} Rundensiege"
        raise RuleProblem(f"{label}: höchstens {what} – die Map endet beim Ziel (Endstand {stand}).")
    if not rule.get("time_limit_minutes") and not tie and target and won < target:
        what = f"{target} Punkten" if kind == SCORE else f"{target} gewonnenen Runden"
        raise RuleProblem(f"{label}: Die Map endet erst bei {what} – der Sieger hat {_number(won)}.")
