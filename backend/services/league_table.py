"""Tabelle der Liga-Staffel (E.1, #1625, docs/LIGA.md): Entscheid der Leitung bei echtem Gleichstand und „beide nicht
erschienen“. Gerechnet wird die Tabelle in ``services/competition_standings.py`` (``_league_rows``); hier stehen nur
die Schreibwege und was die Verwaltung dazu sieht.

- **Entscheid der Leitung** (Nr. 25): nur für einen echten Gleichstand nach allen Kriterien, nur wenn die Season
  ``lead_decision`` in ``table_tiebreakers`` führt, mit Grund. Gespeichert am Turnier (``table_decisions``); er gilt, solange
  genau diese Teams gleich stehen.
- **Beide nicht erschienen** (Nr. 27): beide verlieren, keine Punkte, keine Maps. Die Leitung kann das Spiel neu ansetzen.
"""
from __future__ import annotations

import copy

from models import new_id, now_utc
from services.competition_standings import table_rules
from services.league_scope import is_league_staffel
from services.v2_match_flows import FORFEIT_NOTE_MIN_LENGTH, filled_slots

REASON_MIN = 5
REASON_MAX = 500
DECISION_LIMIT = 50
OPEN_STATUSES = frozenset({"pending", "ready", "scheduled", "waiting_result", "in_progress"})


class TableProblem(Exception):
    """Eine Anfrage, die nicht passt - mit deutscher Meldung und HTTP-Status."""

    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


def reason_text(value, *, minimum: int = REASON_MIN) -> str:
    text = " ".join(str(value or "").split())
    if len(text) < minimum:
        raise TableProblem(f"Bitte einen Grund mit mindestens {minimum} Zeichen angeben.")
    return text[:REASON_MAX]


def public_rules(tournament: dict | None) -> dict | None:
    """Was die Ligaseite über die Regeln der Tabelle wissen muss - ``None`` ohne ``scoring_rules``."""
    rules = table_rules(tournament)
    if not rules:
        return None
    return {"allow_draws": rules["allow_draws"], "tiebreakers": list(rules["table_tiebreakers"]),
            "head_to_head_criteria": list(rules["head_to_head_criteria"]), "forfeit_score": rules["forfeit_score"],
            "exit_rule": rules["exit_rule"], "match_points": dict(rules["match_points"])}


def ties(rows: list[dict]) -> list[dict]:
    """Gruppen mit geteiltem Platz unter den Teams, die noch in der Wertung stehen - die kann die Leitung ordnen."""
    # Ausgeschiedene am Tabellenende (Nr. 43) haben immer eigene Plätze und stehen nie in einer solchen Gruppe.
    groups: dict[int, list[dict]] = {}
    for row in rows:
        groups.setdefault(int(row.get("rank") or 0), []).append(row)
    return [{"rank": rank, "registration_ids": [row["registration_id"] for row in group],
             "names": [row.get("display_name") for row in group], "points": group[0].get("points")}
            for rank, group in sorted(groups.items()) if len(group) > 1]


async def table_rows(db, tournament: dict) -> list[dict]:
    """Die Tabelle wie öffentlich (dieselbe Rechnung für Web, App, TV, PDF), mit allen Feldern für die Leitung."""
    from routes.tournament_view_routes import _standing_rows

    return await _standing_rows(db, tournament, None, True)


def decisions_view(tournament: dict, rows: list[dict]) -> list[dict]:
    applied = {(row.get("lead_decision") or {}).get("id") for row in rows if row.get("lead_decision")}
    names = {row["registration_id"]: row.get("display_name") for row in rows}
    return [{"id": decision.get("id"), "registration_ids": list(decision.get("registration_ids") or []),
             "names": [names.get(item) or "Team" for item in decision.get("registration_ids") or []],
             "reason": decision.get("reason"), "decided_at": decision.get("decided_at"),
             "decided_by": decision.get("decided_by"), "applies": decision.get("id") in applied}
            for decision in tournament.get("table_decisions") or [] if isinstance(decision, dict)]


def can_decide(tournament: dict) -> bool:
    return "lead_decision" in ((table_rules(tournament) or {}).get("table_tiebreakers") or [])


async def overview(db, tournament: dict) -> dict:
    rows = await table_rows(db, tournament)
    return {"standings": rows, "ties": ties(rows), "decisions": decisions_view(tournament, rows),
            "can_decide": can_decide(tournament), "rules": public_rules(tournament)}


async def set_decision(db, tournament: dict, registration_ids: list[str], reason: str, actor_id: str) -> dict:
    """Die Reihenfolge der Leitung für genau eine Gruppe mit geteiltem Platz. Ein früherer Entscheid für dieselbe Menge
    zählt beim Prüfen nicht und wird ersetzt."""
    if not is_league_staffel(tournament):
        raise TableProblem("Das gibt es nur in einer Liga-Staffel.", 404)
    if not can_decide(tournament):
        raise TableProblem("In dieser Season entscheidet die Leitung keinen Gleichstand - die Teams teilen sich den Platz.", 409)
    order = [str(item) for item in registration_ids or [] if str(item or "").strip()]
    if len(order) < 2 or len(set(order)) != len(order):
        raise TableProblem("Bitte mindestens zwei verschiedene Teams in der gewünschten Reihenfolge angeben.")
    wanted = set(order)
    others = [decision for decision in tournament.get("table_decisions") or []
              if isinstance(decision, dict) and set(decision.get("registration_ids") or []) != wanted]
    probe = {**tournament, "table_decisions": others}
    open_ties = ties(await table_rows(db, probe))
    if not any(set(tie["registration_ids"]) == wanted for tie in open_ties):
        raise TableProblem("Diese Teams stehen nicht gleich - entscheiden geht nur bei einem echten Gleichstand nach allen "
                           "Kriterien, und dann für alle Teams auf diesem Platz.", 409)
    if len(others) >= DECISION_LIMIT:
        raise TableProblem("Zu viele Entscheide an dieser Staffel.", 409)
    decision = {"id": new_id(), "registration_ids": order, "reason": reason, "decided_by": actor_id,
                "decided_at": now_utc().isoformat()}
    # Die Route hält die Schreibsperre des Turniers - gelesen und geschrieben wird unter ihr.
    await db.tournaments.update_one({"id": tournament["id"]},
                                    {"$set": {"table_decisions": [*others, decision], "updated_at": decision["decided_at"]}})
    return decision


async def remove_decision(db, tournament: dict, decision_id: str) -> dict:
    decisions = [decision for decision in tournament.get("table_decisions") or [] if isinstance(decision, dict)]
    found = next((decision for decision in decisions if decision.get("id") == decision_id), None)
    if not found:
        raise TableProblem("Diesen Entscheid gibt es nicht.", 404)
    await db.tournaments.update_one(
        {"id": tournament["id"]},
        {"$set": {"table_decisions": [decision for decision in decisions if decision.get("id") != decision_id],
                  "updated_at": now_utc().isoformat()}})
    return found


# ---------------------------------------------------------------- Beide nicht erschienen (Nr. 27)

def double_no_show_fields(match: dict, note: str, actor_id: str, now_iso: str) -> dict:
    sides = [slot["registration_id"] for slot in filled_slots(match)]
    return {
        "status": "forfeit",
        "double_forfeit": True,
        "results": [{"registration_id": side, "rank": 2, "forfeit": True} for side in sides],
        "games": [],
        "lineups_missing": [],
        "pending_result": None,
        "admin_decision_note": note,
        "admin_decision_by": actor_id,
        "admin_decision_at": now_iso,
        "completed_at": now_iso,
        "updated_at": now_iso,
        "double_forfeit_before": {key: copy.deepcopy(match.get(key)) for key in ("status", "results", "games", "completed_at")},
    }


def check_double_no_show(tournament: dict | None, match: dict) -> list[str]:
    """Die beiden Seiten - oder ``TableProblem``, wenn es hier nicht geht."""
    if not is_league_staffel(tournament):
        raise TableProblem("„Beide nicht erschienen“ gibt es nur in einer Liga-Staffel.", 404)
    if match.get("tournament_id") != (tournament or {}).get("id") or match.get("is_preview"):
        raise TableProblem("Spiel nicht gefunden.", 404)
    sides = [slot["registration_id"] for slot in filled_slots(match)]
    if len(sides) != 2:
        raise TableProblem("Das geht nur in einem Spiel mit zwei Seiten.")
    if match.get("double_forfeit") and match.get("status") == "forfeit":
        raise TableProblem("Das Spiel ist schon so gewertet.", 409)
    if str(match.get("status") or "pending") not in OPEN_STATUSES or match.get("results"):
        raise TableProblem("Das Spiel hat schon ein Ergebnis - erst zurücknehmen, dann neu werten.", 409)
    return sides


def note_text(value) -> str:
    return reason_text(value, minimum=FORFEIT_NOTE_MIN_LENGTH)


def undo_fields(match: dict, now_iso: str) -> dict:
    """Neu ansetzen: ohne Ergebnis zurück in den offenen Stand - mit Termin ``scheduled``, sonst ``ready``."""
    return {
        "status": "scheduled" if match.get("scheduled_at") else "ready",
        "results": [],
        "games": [],
        "completed_at": None,
        "pending_result": None,
        "updated_at": now_iso,
    }
