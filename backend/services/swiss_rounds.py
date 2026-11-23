"""Schweizer Runden schreiben (#1559): die nächste Runde von Hand („Schweizer Runde“) oder von selbst, sobald das letzte
Spiel der laufenden gewertet ist. Gerechnet wird in ``services/graph_swiss.py`` - hier stehen nur die Schreibwege.

Doppelte Auslösung ist auf zwei Ebenen ausgeschlossen:

- Jeder Aufrufer hält die Schreibsperre des Turniers (``mutation_lock``): die Route über ``_serialized_tournament_write``,
  der Auslöser nach einem Ergebnis über den Schreibweg des Ergebnisses. Innerhalb der Sperre wird der Stand neu gelesen -
  steht die Runde schon, ist ihre letzte Runde offen und es entsteht nichts.
- Die Kennung jedes Spiels entsteht aus Phase, Runde und Reihenfolge. Dieselbe Runde ergibt dieselben Kennungen; ein
  zweites Schreiben fügt nichts hinzu (``insert_round``), auch ohne Sperre.
"""
from __future__ import annotations

import logging

from pymongo.errors import BulkWriteError, DuplicateKeyError

from models import REGISTRATION_LIMIT, now_utc
from services import tournament_guard
from services.competition_versions import persist_competition_versions
from services.graph_swiss import (
    complete_text,
    next_round_number,
    open_matches,
    swiss_round_documents,
    swiss_settings,
    swiss_state,
    winner_ids,
)
from services.log_safe import log_safe

logger = logging.getLogger("tls.swiss_rounds")

PARTICIPANT_STATUSES = ("approved", "checked_in")
MATCH_LIMIT = 3000
DUPLICATE_KEY = 11000


class SwissRoundProblem(Exception):
    """Eine Runde, die es jetzt nicht geben kann - mit deutscher Meldung und HTTP-Status."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


async def swiss_stage(db, tournament_id: str) -> dict | None:
    return await db.tournament_stages.find_one({"tournament_id": tournament_id, "stage_type": "swiss"}, {"_id": 0})


async def participants(db, tournament_id: str) -> list[dict]:
    return await db.tournament_registrations.find(
        {"tournament_id": tournament_id, "status": {"$in": list(PARTICIPANT_STATUSES)}}, {"_id": 0},
    ).to_list(REGISTRATION_LIMIT)


async def insert_round(db, documents: list[dict]) -> bool:
    """Schreibt die Spiele einer Runde - ``False``, wenn es sie schon gibt (gleiche Kennungen), ohne etwas zu ändern."""
    ids = [document["id"] for document in documents]
    if await db.matches_v2.find_one({"id": {"$in": ids}}, {"_id": 0, "id": 1}):
        return False
    try:
        await db.matches_v2.insert_many([dict(document) for document in documents])
    except DuplicateKeyError:
        return False
    except BulkWriteError as exc:
        errors = (exc.details or {}).get("writeErrors") or []
        if errors and all(error.get("code") == DUPLICATE_KEY for error in errors):
            return False
        raise
    return True


async def round_untouched(db, round_matches: list[dict]) -> bool:
    """Lässt sich eine Runde noch herausnehmen? Ja, solange keines ihrer Spiele aufgerufen, gestartet, gemeldet oder
    gewertet ist (ein Freilos zählt nicht) und keines an einer Station hängt - eine eingeplante Station hält die Runde
    wie ein Aufruf (#2120, TA11). Dieselbe Regel für „Runde zurücknehmen“ und für „Rückgängig“ eines Ergebnisses der
    Runde davor."""
    if any(tournament_guard.match_begun(match) or match.get("station_id") for match in round_matches):
        return False
    match_ids = [match["id"] for match in round_matches if match.get("id")]
    if await db.match_reports_v2.count_documents({"match_id": {"$in": match_ids}}):
        return False
    return not await db.stations.count_documents({"current_match_id": {"$in": match_ids}})


def stale_pairing_notice(match: dict, stage_matches: list[dict], results: list[dict] | None) -> str | None:
    """Korrektur in einer Runde, nach der die nächste schon steht: Deren Paarung kam aus dem alten Ergebnis und ändert
    sich nicht von selbst. Der Satz für die Turnierleitung - oder ``None``, wenn es keine spätere Runde gibt oder die
    Korrektur den Ausgang nicht dreht (gleicher Sieger, gleiche Punkte: die Paarung stimmt weiter)."""
    if match.get("stage_type") != "swiss" or not match.get("results"):
        return None
    own_round = int(match.get("round") or 0)
    later = [int(row.get("round") or 0) for row in stage_matches
             if int(row.get("round") or 0) > own_round and not row.get("is_preview")]
    if not later or sorted(winner_ids(match.get("results"))) == sorted(winner_ids(results)):
        return None
    return (f"Runde {min(later)} ist schon gepaart – nach dem alten Ergebnis. Die Paarung ändert sich nicht von selbst. "
            "Hat dort noch niemand gespielt, kannst du die Runde zurücknehmen und neu erzeugen.")


def overview(tournament: dict, registrations: list[dict], matches: list[dict]) -> dict:
    """Wo das Schweizer System steht - für Verwaltung und TV: nur Zahlen, keine Namen."""
    settings = swiss_settings(tournament)
    field = [row["id"] for row in registrations if row.get("id") and (row.get("status") or "approved") in PARTICIPANT_STATUSES]
    state = swiss_state(settings, field, [match for match in matches if not match.get("is_preview")])
    return {
        "end_rule": state["end_rule"],
        "rounds_played": state["rounds_played"],
        "rounds_total": state["rounds_total"],
        "round_open": state["round_open"],
        "complete": state["complete"],
        "auto_next_round": settings["auto_next_round"],
        "advanced": len(state["advanced"]),
        "eliminated": len(state["eliminated"]),
        "active": len(state["active"]),
        "wins_to_advance": settings["wins_to_advance"],
        "losses_to_exit": settings["losses_to_exit"],
        "top_n": settings["top_n"],
    }


async def create_round(db, tournament: dict, stage: dict, *, actor_id: str | None, automatic: bool = False) -> dict:
    """Die nächste Runde paaren und schreiben. Der Aufrufer hält die Schreibsperre des Turniers.

    ``SwissRoundProblem``: die letzte Runde ist noch offen (400), das System ist nach seiner Abschlussregel fertig (409),
    es gibt zu wenige Teilnehmer (400) oder die Runde steht schon (409)."""
    from routes.tournament_common import _audit_tournament_action

    tid = tournament["id"]
    played = await db.matches_v2.find({"stage_id": stage["id"]}, {"_id": 0}).to_list(MATCH_LIMIT)
    round_number = next_round_number(played)
    still_open = open_matches(played, round_number - 1)
    if still_open:
        # Wie die anderen Meldungen (#2111, TA28): auf Deutsch und mit dem, was zu tun ist.
        raise SwissRoundProblem(
            f"{len(still_open)} Spiele der letzten Runde sind noch offen – die nächste Runde entsteht, wenn alle "
            "gewertet sind.")
    registrations = await participants(db, tid)
    settings = swiss_settings(tournament)
    state = swiss_state(settings, [row["id"] for row in registrations if row.get("id")], played)
    if state["complete"]:
        raise SwissRoundProblem(complete_text(state), 409)
    documents = swiss_round_documents(
        tournament, stage, registrations, played, round_number=round_number, participants=state["active"])
    if not documents:
        raise SwissRoundProblem("Mindestens 2 Teilnehmer benötigt")
    if not await insert_round(db, documents):
        raise SwissRoundProblem(f"Runde {round_number} gibt es schon.", 409)
    await db.tournament_stages.update_one(
        {"id": stage["id"]},
        {"$set": {"status": "ready", "updated_at": now_utc().isoformat()}},
    )
    await persist_competition_versions(db, tournament, "graph")
    # Der Status bleibt (#2120, TA11): live geht es über „Turnier starten“ - mit Check-in-Ende und Planungsprüfung.
    await _audit_tournament_action(
        db, "tournament.swiss.next_round", actor_id, tid,
        {"engine": "graph", "stage_id": stage["id"], "round": round_number,
         "match_count": len(documents), "automatic": automatic},
    )
    return {
        "ok": True,
        "engine": "graph",
        "stage_id": stage["id"],
        "round": round_number,
        "match_count": len(documents),
        "match_ids": [document["id"] for document in documents],
    }


async def advance_after_write(db, tournament_id: str | None, *, actor_id: str | None) -> dict | None:
    """Nach einem gewerteten Spiel: Ist die Runde damit fertig und die Einstellung „nächste Runde automatisch“ an, entsteht
    die nächste. Der Aufrufer hält die Schreibsperre des Turniers. Eine Störung hier darf das Ergebnis nicht verlieren -
    die Leitung kann die Runde jederzeit von Hand erzeugen."""
    if not tournament_id:
        return None
    try:
        tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0})
        if not tournament or tournament.get("format") != "swiss" or not swiss_settings(tournament)["auto_next_round"]:
            return None
        # Nur im laufenden Turnier: vor dem Start, nach dem Ende, abgesagt oder gesperrt paart nichts von selbst.
        if tournament.get("status") != "live" or tournament.get("locked_at") or tournament_guard.finished_problem(tournament):
            return None
        stage = await swiss_stage(db, tournament_id)
        if not stage:
            return None
        created = await create_round(db, tournament, stage, actor_id=actor_id, automatic=True)
    except SwissRoundProblem:
        # Runde noch offen, System abgeschlossen oder Runde steht schon: nichts zu tun.
        return None
    except Exception as exc:  # Das Ergebnis ist gespeichert, die Runde geht auch von Hand.
        logger.warning("Schweizer Runde nicht automatisch erzeugt tournament=%s type=%s",
                       log_safe(tournament_id), type(exc).__name__)
        return None
    try:
        from services.change_events import publish_tournament_event

        await publish_tournament_event(str(tournament_id), "round_started", match_ids=created["match_ids"])
    except Exception:  # Die Runde steht - nur die Anzeige lädt dann erst beim nächsten Takt.
        logger.debug("Anzeige-Ereignis für die neue Schweizer Runde nicht verschickt", exc_info=True)
    return created
