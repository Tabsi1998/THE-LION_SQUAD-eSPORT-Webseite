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

from models import normalize_rule, rule_time_limit_seconds
from services.markdown_text import strip_protected

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
    """Die Regeln aller Modi des Spiels, die eine haben - in jedem Zustand (auch ein inaktiver Modus kann im Pool stehen). Ein
    Zeitlimit in Minuten (Altbestand) kommt in Sekunden (#2271)."""
    return {mode["mode"]: dict(normalize_rule(mode["result_rule"])) for mode in _modes(game) if isinstance(mode.get("result_rule"), dict)}


def _clean_setting(row: dict) -> dict:
    """Eine gespeicherte Einstellung ohne Zeichen des Zwischenformats der Bausteine (Altbestand, Prüfung Codex) - beim Lesen bereinigt."""
    out = dict(row)
    for key in ("label", "group"):
        if isinstance(out.get(key), str):
            out[key] = strip_protected(out[key])
    if isinstance(out.get("value"), str):
        out["value"] = strip_protected(out["value"])
    return out


def settings_entry(mode: dict | None) -> dict | None:
    """Einstellungen und Regeltext eines Modus (#2271) als ``{settings, rules_text}`` - ``None``, wenn er keines von beiden hat. Gelesen
    ohne Zeichen des Zwischenformats (``markdown_text.strip_protected``), auch aus Altbestand."""
    settings = [_clean_setting(row) for row in (mode or {}).get("settings") or [] if isinstance(row, dict)]
    text = strip_protected((mode or {}).get("rules_text") or "").strip()
    if not settings and not text:
        return None
    return {"settings": settings, **({"rules_text": text} if text else {})}


def held_settings(season: dict | None) -> dict[str, dict] | None:
    """Die Kopie der Season (``mode_settings``) bereinigt wie ``settings_entry`` - ``None``: die Season hat keine (ältere Seasons)."""
    held = (season or {}).get("mode_settings")
    if not isinstance(held, dict):
        return None
    return {key: entry for key, value in held.items() if (entry := settings_entry(value if isinstance(value, dict) else None))}


def settings_of_game(game: dict | None) -> dict[str, dict]:
    """Einstellungen und Regeltext aller Modi des Spiels, die etwas davon haben (#2271)."""
    return {mode["mode"]: entry for mode in _modes(game) if (entry := settings_entry(mode))}


def new_season_fields(game: dict | None) -> dict:
    """Was eine **neue** Season bekommt: die Kopie der Regeln, der Einstellungen samt Regeltext je Modus (#2271) und die
    Punktepflicht. Ältere Seasons tragen das nicht."""
    return {"result_rules": rules_of_game(game), "mode_settings": settings_of_game(game), "scores_required": True}


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


def _settings_problem_text(error) -> str:
    for item in error.errors():
        if item.get("type") == "value_error":
            return str(item.get("msg") or "").split("Value error, ", 1)[-1]
        if item.get("loc") and item["loc"][-1] == "label":
            return "Jede Einstellung braucht eine Bezeichnung (höchstens 60 Zeichen)."
    return "Einstellungen: bitte Bezeichnung, Wert, Einheit und Gruppe im erlaubten Rahmen angeben."


def clean_settings_entry(raw, label: str) -> dict | None:
    """``{settings: [...], rules_text}`` einer Season für einen Modus - geprüft wie am Modus (#2271). Leer: ``None``."""
    from pydantic import ValidationError

    from models import MODE_RULES_TEXT_MAX, GameModeSetting, clean_mode_settings

    if raw is None:
        return None
    if not isinstance(raw, dict) or any(key not in ("settings", "rules_text") for key in raw):
        raise RuleProblem(f"Modus „{label}“: Einstellungen bitte als Liste mit Regeltext angeben.")
    try:
        settings = clean_mode_settings([GameModeSetting.model_validate(row) for row in raw.get("settings") or []]) or []
    except (ValidationError, ValueError) as error:
        text = _settings_problem_text(error) if isinstance(error, ValidationError) else str(error)
        raise RuleProblem(f"Modus „{label}“: {text}") from None
    text = strip_protected(raw.get("rules_text") or "").strip()
    if len(text) > MODE_RULES_TEXT_MAX:
        raise RuleProblem(f"Modus „{label}“: Regeltext höchstens {MODE_RULES_TEXT_MAX} Zeichen.")
    return settings_entry({"settings": [row.model_dump() for row in settings], "rules_text": text})


def clean_settings(raw, game: dict | None, saved: dict | None) -> dict[str, dict]:
    """Einstellungen der Season je Modus aus ``{mode: {settings, rules_text} | None}`` - wie ``clean_rules``."""
    if not isinstance(raw, dict):
        raise RuleProblem("Einstellungen: bitte je Modus eine Liste oder nichts angeben.")
    labels = {mode["mode"]: mode.get("label") or mode["mode"] for mode in _modes(game)}
    known = set(labels) | set(saved or {})
    out: dict[str, dict] = {}
    for key, value in raw.items():
        mode = str(key or "").strip()
        if mode not in known:
            raise RuleProblem(f"Einstellungen: Den Modus „{mode[:40]}“ hat das Spiel nicht.")
        entry = clean_settings_entry(value, labels.get(mode, mode))
        if entry:
            out[mode] = entry
    return out


def overview(season: dict, game: dict | None) -> list[dict]:
    """Je Modus die Regel der Season neben der des Spiels - für die Verwaltung. Modi des Spiels zuerst, dann die, die nur noch
    die Season kennt. Dazu Einstellungen und Regeltext (#2271): ``season_settings`` (``None``: die Season hat sie nie übernommen,
    ältere Seasons) neben ``game_settings`` und ``settings_differ``."""
    season_rules = season.get("result_rules") or {}
    held = held_settings(season)
    game_rules = rules_of_game(game)
    game_settings = settings_of_game(game)
    rows = []

    def settings_fields(key: str) -> dict:
        own = (held or {}).get(key) if held is not None else None
        theirs = game_settings.get(key)
        return {"season_settings": own, "game_settings": theirs,
                "settings_differ": held is not None and _same_settings(own) != _same_settings(theirs)}

    for mode in _modes(game):
        key = mode["mode"]
        own, theirs = normalize_rule(season_rules.get(key)), game_rules.get(key)
        rows.append({"mode": key, "label": mode.get("label") or key, "status": mode.get("status") or "active",
                     **({"icon_url": mode["icon_url"]} if mode.get("icon_url") else {}),
                     "season_rule": own, "game_rule": theirs, "differs": _same(own) != _same(theirs), **settings_fields(key)})
    for key in [*season_rules, *(held or {})]:
        if key not in {row["mode"] for row in rows}:
            rows.append({"mode": key, "label": key, "status": "removed", "season_rule": normalize_rule(season_rules.get(key)),
                         "game_rule": None, "differs": True, **settings_fields(key)})
    return rows


def _same(rule: dict | None) -> dict | None:
    """Zum Vergleichen: ``draw_allowed``/``overtime`` fehlen = falsch, Minuten (Altbestand) zählen als Sekunden."""
    if not rule:
        return None
    rule = normalize_rule(rule)
    return {**{"draw_allowed": False, "overtime": False}, **{key: value for key, value in rule.items() if value is not None}}


def _same_settings(entry: dict | None) -> dict | None:
    if not entry:
        return None
    return {"settings": [{key: row.get(key) for key in ("key", "label", "value", "unit", "group")} for row in entry.get("settings") or []],
            "rules_text": str(entry.get("rules_text") or "").strip()}


# ---------------------------------------------------------------- Prüfen je Map


def rule_for(rules: dict | None, mode: str | None) -> dict | None:
    """Die geltende Regel einer Map aus einem Regelstand ``{mode: rule}`` - ohne Stand oder Modus keine."""
    if not mode or not isinstance(rules, dict):
        return None
    rule = rules.get(mode)
    # Altbestand (#2271): ein Zeitlimit in Minuten kommt in Sekunden - beim Lesen, ohne Migration.
    return normalize_rule(rule) if isinstance(rule, dict) and rule.get("kind") else None


def scores_required(tournament: dict | None) -> bool:
    return bool((tournament or {}).get("scores_required"))


SNAPSHOT_KEY = "result_rule_snapshot"
# Meldung ohne Schnappschuss (vor C.3): prüft nichts Neues.
EMPTY_SNAPSHOT = {"result_rules": {}, "scores_required": False}


def snapshot(tournament: dict | None) -> dict:
    """Der Regelstand der Staffel jetzt - eine Meldung hält ihn fest (``result_rule_snapshot``)."""
    rules = (tournament or {}).get("result_rules")
    return {"result_rules": dict(rules) if isinstance(rules, dict) else {}, "scores_required": scores_required(tournament)}


def snapshot_of(report: dict | None) -> dict:
    """Der Regelstand, mit dem eine Meldung geprüft wurde - Altbestand ohne Feld: keiner."""
    held = (report or {}).get(SNAPSHOT_KEY)
    if not isinstance(held, dict):
        return dict(EMPTY_SNAPSHOT)
    rules = held.get("result_rules")
    return {"result_rules": dict(rules) if isinstance(rules, dict) else {}, "scores_required": bool(held.get("scores_required"))}


OVERRIDE_RIGHT_DETAIL = "Eine Ergebnisregel übergehen darf nur die Liga-Leitung mit der Zuständigkeit „Ergebnisse“."


async def override_reason(db, user: dict | None, match: dict, raw) -> str | None:
    """Ergebnisregel übergehen (Korrektur der Leitung, Entscheidung des Obmanns): die Liga-Leitung mit der Zuständigkeit
    „Ergebnisse“ (Bereich Ligen oder Zuständigkeit dieser Liga), immer mit Grund. Befangenheit prüft die Route wie bei jedem
    Ergebnis (``require_no_conflict``) - im eigenen Spiel entscheidet eine zweite Person, der Superadmin nur als Notausnahme.
    ``None``: nichts übergehen (auch außerhalb einer Liga-Staffel)."""
    from services.league_permissions import capabilities_of

    reason = " ".join(str(raw or "").split())
    if not reason:
        return None
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "league_context": 1}) or {}
    league_id = (tournament.get("league_context") or {}).get("league_id")
    if not tournament.get("league_context"):
        return None
    if "results" not in await capabilities_of(db, user, league_id):
        raise RuleProblem(OVERRIDE_RIGHT_DETAIL, 403)
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
    rows = await db.match_proof_photos.find(
        {"match_id": match_id, "status": "attached"}, {"_id": 0, "id": 1, "type": 1, "context": 1}).to_list(200)
    # Nur Fotos (#2360): Video-Links und MOSS-Nachweise hängen in derselben Sammlung, sind aber kein Foto einer Map.
    return {row["id"] for row in rows
            if row.get("id") and row.get("type") != "link" and (row.get("context") or {}).get("kind") != "moss"}


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
    if not rule_time_limit_seconds(rule) and not tie and target and won < target:
        what = f"{target} Punkten" if kind == SCORE else f"{target} gewonnenen Runden"
        raise RuleProblem(f"{label}: Die Map endet erst bei {what} – der Sieger hat {_number(won)}.")
