"""Turnier-Ereignisse an einer Stelle (#1553): Disqualifikation und Austritt als Umbauplan.

Bisher bewegte nur ein Ergebnis den Baum. Hier läuft jedes Ereignis denselben Weg wie ein Ergebnis: Ereignis →
Umbauplan (Format × Ereignis, rein im Speicher auf den Spiel-Dokumenten) → Vorschlag am Turnier
(``participant_removal_plan``, wie ``heat_rebuild_plan``) → Bestätigung der Turnierleitung → anwenden mit
Graph-Validierung → zentral Protokoll, Stationen frei, Benachrichtigungen, Lauf-Planer (``heat_rebuild``),
Spielplaner-Aufrufpunkt, Anzeige-Ereignis für Web und TV.

Regeln (Entscheidungen E12, E14, Regeltabelle in der Turnier-Dynamik-Notiz):

- **Aufgabe / nicht erschienen** bleibt die Wertung eines einzelnen Spiels (``services.match_forfeit``); im
  Doppel-K.-o. geht es ins Loser Bracket. Das ändert sich hier nicht.
- **Disqualifikation / Austritt** im K.-o. und Doppel-K.-o.: raus aus allen offenen Spielen. Ein Spiel, das noch nicht
  begonnen hat, verliert den Platz der Person; der Gegner kommt kampflos weiter (Freilos-Kette ``resolve_walkovers``,
  die nur den Sieger-Weg bedient - also **kein** Loser-Bracket-Eintrag). Ein Spiel, das schon läuft, bekommt eine
  Wertung (Person zuletzt, Stand ``forfeit``), ebenfalls ohne Loser-Weg.
- **Liga / Gruppen** (50-Prozent-Regel): weniger als die Hälfte der eigenen Spiele gespielt → alle eigenen Spiele
  annulliert (``cancelled``, Ergebnis bleibt als Historie am Spiel, die Tabelle nimmt die Person heraus); sonst werden
  die offenen Spiele kampflos verloren gewertet und die Person bleibt in der Tabelle.
- **Swiss**: Ergebnisse bleiben, das offene Spiel wird kampflos gewertet, ein Freilos entfällt; gepaart wird die Person
  nicht mehr (Anmeldungsstatus).
- **FFA-Läufe**: aus allen noch nicht aufgerufenen Läufen raus; hat die Person einen Lauf gefahren und ist weiter,
  rückt der Nächstplatzierte in den Folgelauf nach („Plätze rücken auf“), solange der Folgelauf nicht aufgerufen ist.
  Mit Loser Bracket rücken beide Wege gemeinsam auf (#1839): wer in den Sieger-Weg nachrückt, verlässt das Loser
  Bracket, dort rückt der Nächste auf - niemand steht in zwei Läufen derselben Runde.
  Die Freilos-Kette läuft nicht in Läufe hinein - ein Lauf mit einem Fahrer wird vom Lauf-Planer zusammengelegt.
- Danach gilt überall: die Person rückt nie mehr ein (``eliminated`` im Ergebnis-Anwender).

Der Planer (``plan_removal``) ist idempotent: ein zweiter Lauf für dieselbe Person findet nichts mehr. Die
Anmeldung bekommt den Status ``withdrawn`` bzw. ``disqualified`` und ``removal`` (Art, Modus, gespielt/gesamt).
"""
from __future__ import annotations

import copy
import hashlib
import json
import logging
import uuid
from collections import defaultdict

from models import now_utc
from services.change_events import publish_api_change, publish_tournament_event
from services.competition_graph_validation import validate_competition_graph
from services.competition_snapshot import build_structure_snapshot
from services.competition_usage import GRAPH, record_write
from services.competition_versions import persist_competition_versions
from services.heat_rebuild import STALE_DETAIL, _doc_fields, _replan_schedule, _unchanged_filter, evaluate_after_write
from services.match_notifications import notify_match_result_confirmed
from services.advancement_draw import draw_group_of, match_mode
from services.match_v2_results import (
    _advancement_result_rank,
    _status_after_slot_fill,
    build_v2_result_application,
    group_awaits_draw,
    has_result,
    moved_up_seating,
    resolve_walkovers,
)
from services.station_runtime import release_station_for_match
from services.v2_match_flows import results_for_forfeit

logger = logging.getLogger("tls.tournament_events")

REMOVAL_KINDS = ("withdrawn", "disqualified")
REMOVAL_LABELS = {"withdrawn": "Austritt", "disqualified": "Disqualifikation"}
DISPLAY_EVENTS = {"withdrawn": "player_withdrawn", "disqualified": "player_disqualified"}
TABLE_STAGE_TYPES = {"league", "round_robin_groups"}
TERMINAL_STATUSES = {"completed", "forfeit", "cancelled"}
STARTED_STATUSES = {"in_progress", "running", "waiting_result", "disputed"}
REBUILDABLE_STATUSES = {"pending", "ready", "scheduled"}
# Mindestanteil der eigenen Spiele, der gespielt sein muss, damit der Rest kampflos gewertet wird (sonst annulliert).
TABLE_PLAYED_SHARE = 0.5
AUDIT_ACTIONS = {
    "walkover": "match.walkover",
    "slot_cleared": "match.slot_cleared",
    "forfeit": "match.forfeit",
    "annulled": "match.annulled",
    "cancelled": "match.cancelled",
    "readvanced": "match.readvanced",
}
DISPLAY_BY_OP = {
    "walkover": "walkover",
    "slot_cleared": "slot_cleared",
    "forfeit": "walkover",
    "annulled": "slot_cleared",
    "cancelled": "slot_cleared",
    "readvanced": "slot_filled",
    "draw_excluded": "slot_cleared",
}


class TournamentEventError(Exception):
    def __init__(self, detail: str, status_code: int = 409):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


# ---------------------------------------------------------------------------------------------- Lesen

def _filled(match: dict) -> list[str]:
    return [slot["registration_id"] for slot in match.get("slots") or []
            if slot.get("status") == "filled" and slot.get("registration_id")]


def _seats(match: dict, registration_id: str) -> list[dict]:
    return [slot for slot in match.get("slots") or [] if slot.get("registration_id") == registration_id]


def _is_live(match: dict) -> bool:
    return not match.get("is_preview") and str(match.get("status") or "pending") not in TERMINAL_STATUSES


def _started(match: dict) -> bool:
    return str(match.get("status") or "") in STARTED_STATUSES or bool(match.get("started_at"))


def _rebuildable(match: dict) -> bool:
    return (str(match.get("status") or "pending") in REBUILDABLE_STATUSES
            and not match.get("called_at") and not match.get("started_at"))


def _fingerprint(match: dict) -> str:
    return json.dumps(match, sort_keys=True, default=str, separators=(",", ":"))


def _sort_key(match: dict) -> tuple:
    return (int(match.get("stage_number") or 0), int(match.get("round") or 0), int(match.get("order") or 0),
            str(match.get("match_key") or ""))


def _stage_kind(matches: list[dict]) -> str:
    stage_type = str((matches[0] if matches else {}).get("stage_type") or "")
    if stage_type in TABLE_STAGE_TYPES:
        return "table"
    if stage_type == "swiss":
        return "swiss"
    return "bracket"


# ---------------------------------------------------------------------------------------------- Umbauen

def _clear_seat(slot: dict, registration_id: str, kind: str, now_iso: str) -> None:
    """Der Platz wird frei - ein Freilos mit Grund, damit Kette, Anzeige und Protokoll wissen, warum."""
    source_result = dict(slot.get("source_result") or {})
    source_result.update({"skipped": True, "reason": kind, "removed_registration_id": registration_id, "confirmed_at": now_iso})
    slot["registration_id"] = None
    slot["user_id"] = None
    slot["source_result"] = source_result
    slot["status"] = "bye"


def _apply_application(match: dict, by_id: dict[str, dict], application: dict) -> None:
    match.update(application["match_set"])
    for target_id, update in application["target_sets"].items():
        if target_id in by_id:
            by_id[target_id].update(update)


def _forfeit(match: dict, matches: list[dict], by_id: dict[str, dict], registration_id: str, kind: str,
             now_iso: str, ops: list[dict], eliminated: set[str], draws: list[dict] | None = None) -> None:
    """Die Wertung über den Ergebnis-Anwender: Person zuletzt, kein Weg führt sie weiter (``eliminated``)."""
    application = build_v2_result_application(
        match, matches, results_for_forfeit(match, registration_id), actor_id="system", now_iso=now_iso,
        note=REMOVAL_LABELS[kind], force=has_result(match), eliminated=eliminated | {registration_id},
    )
    _apply_application(match, by_id, application)
    if draws is not None:
        # Gemischt (#1548): entscheidet die Wertung die Runde, ist die Folgerunde ausgelost - fürs Protokoll.
        draws.extend(application.get("draws") or [])
    match.update({
        "status": "forfeit",
        "forfeit_registration_id": registration_id,
        "admin_decision_note": REMOVAL_LABELS[kind],
        "admin_decision_by": "system",
        "admin_decision_at": now_iso,
        "pending_result": None,
        "updated_at": now_iso,
    })
    match["result_meta"] = {**(match.get("result_meta") or {}), "reason": kind, "removed_registration_id": registration_id}
    opponents = [reg for reg in _filled(match) if reg != registration_id]
    ops.append({"kind": "forfeit", "match_id": match["id"], "match_key": match.get("match_key"),
                "round_name": match.get("round_name"), "opponents": opponents})


def _cancel(match: dict, kind: str, registration_id: str, now_iso: str, *, annulled: bool, ops: list[dict]) -> None:
    previous = str(match.get("status") or "pending")
    match.update({
        "status": "cancelled",
        "result_meta": {**(match.get("result_meta") or {}), "source": "participant_removed", "reason": kind,
                        "annulled": annulled, "previous_status": previous, "removed_registration_id": registration_id,
                        "updated_at": now_iso},
        "station_id": None,
        "called_at": None,
        "pending_result": None,
        "updated_at": now_iso,
    })
    ops.append({"kind": "annulled" if annulled else "cancelled", "match_id": match["id"], "match_key": match.get("match_key"),
                "round_name": match.get("round_name"), "previous_status": previous, "played": previous in {"completed", "forfeit"}})


def _plan_table(stage_matches: list[dict], matches: list[dict], by_id: dict[str, dict], registration_id: str,
                kind: str, now_iso: str, ops: list[dict], eliminated: set[str], draws: list[dict] | None = None) -> dict:
    """50-Prozent-Regel (E12): gespielt sind entschiedene Spiele, gesamt alle noch gültigen der Person."""
    mine = [m for m in stage_matches if _seats(m, registration_id) and str(m.get("status") or "") != "cancelled"
            and not m.get("is_preview")]
    played = [m for m in mine if str(m.get("status") or "") in {"completed", "forfeit"}]
    total = len(mine)
    if not mine:
        return {"mode": "table", "played": 0, "total": 0}
    if len(played) < total * TABLE_PLAYED_SHARE:
        for match in sorted(mine, key=_sort_key):
            _cancel(match, kind, registration_id, now_iso, annulled=True, ops=ops)
        return {"mode": "annulled", "played": len(played), "total": total}
    for match in sorted(mine, key=_sort_key):
        if _is_live(match):
            if len(_filled(match)) < 2:
                _cancel(match, kind, registration_id, now_iso, annulled=False, ops=ops)
            else:
                _forfeit(match, matches, by_id, registration_id, kind, now_iso, ops, eliminated, draws)
    return {"mode": "forfeit", "played": len(played), "total": total}


def _plan_swiss(stage_matches: list[dict], matches: list[dict], by_id: dict[str, dict], registration_id: str,
                kind: str, now_iso: str, ops: list[dict], eliminated: set[str], draws: list[dict] | None = None) -> dict:
    for match in sorted((m for m in stage_matches if _seats(m, registration_id) and _is_live(m)), key=_sort_key):
        if len(_filled(match)) < 2:
            _cancel(match, kind, registration_id, now_iso, annulled=False, ops=ops)
        else:
            _forfeit(match, matches, by_id, registration_id, kind, now_iso, ops, eliminated, draws)
    return {"mode": "swiss"}


def _feeds_undrawn_draw(match: dict, by_id: dict[str, dict]) -> bool:
    """Gemischt (#1548): leitet dieses Spiel in eine Runde weiter, die noch nicht ausgelost ist? ``by_id`` enthält alle
    Phasen - die Gruppe zählt nur in der Phase des Folgespiels."""
    for entry in match.get("advancement") or []:
        target = by_id.get(entry.get("to_match_id"))
        if target and group_awaits_draw(by_id.values(), draw_group_of(target), target.get("stage_id")):
            return True
    return False


def _exclude_from_draw(match: dict, registration_id: str, now_iso: str, ops: list[dict]) -> None:
    """Vor der Auslosung sitzt die Person noch nirgends: ihre Zeile im Ergebnis wird als ausgeschieden vermerkt, die
    Auslosung lässt sie aus (im Lauf rückt der Nächste auf, im Duell wird ihr Platz ein Freilos)."""
    rows = [row for row in match.get("results") or []
            if row.get("registration_id") == registration_id and not row.get("eliminated")]
    if not rows:
        return
    for row in rows:
        row["eliminated"] = True
    match["updated_at"] = now_iso
    ops.append({"kind": "draw_excluded", "match_id": match["id"], "match_key": match.get("match_key"),
                "round_name": match.get("round_name"), "registration_id": registration_id})


def _readvance(heat: dict, by_id: dict[str, dict], registration_id: str, now_iso: str, ops: list[dict],
               eliminated: set[str]) -> None:
    """Plätze rücken auf: die Wege eines gefahrenen Laufs zählen nur noch, wer im Turnier bleibt - auch wer früher
    schon ausgeschieden ist, kommt nicht zurück. Erst werden alle Plätze dieses Laufs in den Folgeläufen frei, dann
    neu besetzt (wer von Platz 2 auf Platz 1 rückt, wechselt den Sitz).

    Sieger- und Verlierer-Weg rücken gemeinsam auf (#1839), nach derselben Regel wie beim Eintragen und im Topf
    (``moved_up_seating`` auf ``_advancement_paths``): wer ins Finale nachrückt, verlässt dafür seinen Platz im Loser
    Bracket; dort rückt der Nächste auf, der letzte Platz wird ein Freilos. Ein Platz in einem Folgelauf, der nicht mehr
    umbaubar ist, bleibt, wie er ist, und zählt mit; wer dort schon sitzt, rückt nicht nach. Wartet ein Weg noch aufs
    Los (Show-Auslosung je Gruppe), schreibt das hier nichts - der Topf rechnet später dieselbe Regel (``run_draw``)."""
    gone = eliminated | {registration_id}
    entries = [(row["entry"], row["target"], row["slot"], row["wanted"])
               for row in moved_up_seating(heat, by_id, gone) if not row["fixed"] and not row["awaiting"]]
    if all(slot.get("registration_id") == (wanted or {}).get("registration_id") for _e, _t, slot, wanted in entries):
        return
    touched: dict[str, dict] = {}
    for _entry, target, slot, _wanted in entries:
        if slot.get("registration_id"):
            _clear_seat(slot, slot["registration_id"], "bye", now_iso)
        touched[target["id"]] = target
    for entry, target, slot, wanted in entries:
        current = (slot.get("source_result") or {}).get("removed_registration_id")
        if wanted and any(s.get("registration_id") == wanted["registration_id"] for s in target.get("slots") or []):
            wanted = None  # sitzt dort schon auf einem anderen Weg
        if wanted:
            position = _advancement_result_rank(heat, entry)
            slot.update({
                "registration_id": wanted["registration_id"],
                "user_id": wanted.get("user_id"),
                "source_result": {"from_match_id": heat["id"], "from_match_key": heat.get("match_key"),
                                  "rank": int(wanted.get("rank") or position or 0), "flow": entry["flow"],
                                  "confirmed_at": now_iso, "moved_up": int(wanted.get("rank") or 0) != int(position or 0)},
                "status": "filled",
            })
            if current != wanted["registration_id"]:
                ops.append({"kind": "readvanced", "match_id": target["id"], "match_key": target.get("match_key"),
                            "round_name": target.get("round_name"), "from_match_key": heat.get("match_key"),
                            "registration_id": wanted["registration_id"], "rank": int(wanted.get("rank") or 0),
                            "replaced": current})
            continue
        if draw_group_of(target) and match_mode(target) != "instant":
            # Ausgelost: der Platz bleibt ein Freilos. Quelle und Weiterleitung aus dem Schema bleiben, wie sie sind -
            # ein ausgeloster Platz gehört nicht zu der Weiterleitung, die im Schema auf ihn zeigt. (Sofort zufällig,
            # #1590: dort folgt das Schema dem Los - der Eintrag gehört zum Platz und wird wie im festen Baum gestrichen.)
            continue
        # Niemand rückt nach: der Platz bleibt ein Freilos, Quelle und Weiterleitung des gefahrenen Laufs bleiben aber
        # stehen (#1596). Strich der Austritt die Weiterleitung, war der Lauf ohne Weg weiter - und neben dem echten
        # Finale, das der Umbau später abkürzt, blieb ein zweites „Finale“. Seine Weiterleitung verliert ein Lauf nur
        # über das Abkürzen zum Finale (heat_rebuild._shorten).
        if current:
            slot["source_result"] = {**(slot.get("source_result") or {}),
                                     "reason": "eliminated" if current == registration_id else "bye"}
        heat["updated_at"] = now_iso
    for target in touched.values():
        target["status"] = _status_after_slot_fill(target, preserve_terminal=False)
        if target["status"] == "ready" and target.get("scheduled_at"):
            target["status"] = "scheduled"
        target["updated_at"] = now_iso


def _plan_bracket(stage_matches: list[dict], matches: list[dict], by_id: dict[str, dict], registration_id: str,
                  kind: str, now_iso: str, ops: list[dict], eliminated: set[str], draws: list[dict] | None = None) -> dict:
    # Erst die gefahrenen Läufe: wer dort weitergekommen ist, macht seinen Platz im Folgelauf für den Nächsten frei.
    for heat in sorted(stage_matches, key=_sort_key):
        if str(heat.get("status") or "") not in {"completed", "forfeit"} \
                or not any(row.get("registration_id") == registration_id for row in heat.get("results") or []):
            continue
        if _feeds_undrawn_draw(heat, by_id):
            # Gemischt (#1548): die Folgerunde ist noch nicht ausgelost - die Auslosung lässt die Person aus.
            _exclude_from_draw(heat, registration_id, now_iso, ops)
        if heat.get("match_type") == "ffa":
            # Show-Auslosung je Gruppe (#1839): ist ein Weg schon gelost, der andere noch nicht, rückt der geloste auf;
            # der andere folgt mit dem Los derselben Reihe.
            _readvance(heat, by_id, registration_id, now_iso, ops, eliminated)
    chain: list[str] = []
    for match in sorted(stage_matches, key=_sort_key):
        if not _is_live(match) or not _seats(match, registration_id):
            continue
        if match.get("match_type") == "ffa":
            if not _rebuildable(match):
                continue  # aufgerufen oder gestartet: die Wertung kommt mit dem Ergebnis, die Person kommt nicht weiter
            for slot in _seats(match, registration_id):
                _clear_seat(slot, registration_id, kind, now_iso)
            match["status"] = _status_after_slot_fill(match, preserve_terminal=False)
            if match["status"] == "ready" and match.get("scheduled_at"):
                match["status"] = "scheduled"
            match["updated_at"] = now_iso
            ops.append({"kind": "slot_cleared", "match_id": match["id"], "match_key": match.get("match_key"),
                        "round_name": match.get("round_name"), "remaining": _filled(match)})
            continue
        if _started(match) and len(_filled(match)) >= 2:
            _forfeit(match, matches, by_id, registration_id, kind, now_iso, ops, eliminated, draws)
            continue
        for slot in _seats(match, registration_id):
            _clear_seat(slot, registration_id, kind, now_iso)
        match["status"] = _status_after_slot_fill(match, preserve_terminal=False)
        match["updated_at"] = now_iso
        ops.append({"kind": "slot_cleared", "match_id": match["id"], "match_key": match.get("match_key"),
                    "round_name": match.get("round_name"), "remaining": _filled(match)})
        chain.append(match["id"])
    if chain:
        before = {match_id: str(by_id[match_id].get("status") or "") for match_id in by_id}
        target_sets: dict[str, dict] = {}
        drawn_before = len(draws) if draws is not None else 0
        resolve_walkovers(chain, by_id, target_sets, now_iso, draws=draws)
        # Was das Los entschieden hat (kampflose Spiele der neu ausgelosten Runde), steht in der Auslosung - nicht als
        # Umbauschritt: sonst hinge der Vorschlag am Zufall und wäre beim Bestätigen „nicht mehr aktuell“.
        drawn_ids = {row.get("match_id") for draw in (draws or [])[drawn_before:] for row in draw.get("assignments") or []}
        for match_id in target_sets:
            match = by_id.get(match_id)
            if not match or before.get(match_id) == match.get("status") or match_id in drawn_ids:
                continue
            if match.get("status") == "completed":
                ops.append({"kind": "walkover", "match_id": match_id, "match_key": match.get("match_key"),
                            "round_name": match.get("round_name"),
                            "winner": (match.get("results") or [{}])[0].get("registration_id")})
            elif match.get("status") == "cancelled":
                ops.append({"kind": "cancelled", "match_id": match_id, "match_key": match.get("match_key"),
                            "round_name": match.get("round_name"), "previous_status": before.get(match_id), "played": False})
    return {"mode": "bracket"}


def plan_removal(matches: list[dict], registration_id: str, *, kind: str, now_iso: str | None = None,
                 eliminated: set[str] | None = None) -> dict:
    """Der Umbauplan für Disqualifikation oder Austritt - rechnet im Speicher auf den übergebenen Spielen.

    ``eliminated``: wer vorher schon ausgeschieden ist (rückt beim Aufrücken nie nach). Antwort: ``ops`` (je Umbau ein
    Eintrag mit ``kind``), ``changed_ids``, ``mode`` (``bracket`` / ``annulled`` / ``forfeit`` / ``swiss``), bei
    Tabellen ``played`` und ``total``. Zweimal aufgerufen ändert der zweite Lauf nichts."""
    if kind not in REMOVAL_KINDS:
        raise ValueError(f"Unbekannte Art: {kind}")
    eliminated = set(eliminated or ()) - {registration_id}
    now_iso = now_iso or now_utc().isoformat()
    live = [m for m in matches if not m.get("is_preview") and m.get("id")]
    by_id = {m["id"]: m for m in live}
    before = {m["id"]: _fingerprint(m) for m in live}
    stages: dict[str, list[dict]] = defaultdict(list)
    for match in live:
        stages[str(match.get("stage_id") or "")].append(match)
    ops: list[dict] = []
    draws: list[dict] = []
    outcomes: list[tuple[dict, bool]] = []
    for _stage_id, stage_matches in sorted(stages.items(), key=lambda item: int((item[1][0]).get("stage_number") or 0)):
        involved = [m for m in stage_matches if _seats(m, registration_id)
                    or any(r.get("registration_id") == registration_id for r in m.get("results") or [])]
        if not involved:
            continue
        had_live = any(_is_live(m) for m in involved)
        stage_kind = _stage_kind(stage_matches)
        if stage_kind == "table":
            outcome = _plan_table(stage_matches, live, by_id, registration_id, kind, now_iso, ops, eliminated, draws)
        elif stage_kind == "swiss":
            outcome = _plan_swiss(stage_matches, live, by_id, registration_id, kind, now_iso, ops, eliminated, draws)
        else:
            outcome = _plan_bracket(stage_matches, live, by_id, registration_id, kind, now_iso, ops, eliminated, draws)
        outcomes.append((outcome, had_live))
    # Mehrere Phasen (Gruppen, dann K.-o.): der Modus der Phase, in der die Person noch offene Spiele hatte.
    summary = next((outcome for outcome, had_live in outcomes if had_live), outcomes[-1][0] if outcomes else {"mode": "bracket"})
    if summary.get("mode") == "table":
        summary["mode"] = "forfeit"
    # Ein offener Vorschlag „nicht erschienen“ (#1551) samt Verlängerung gehörte zur alten Besetzung - wie beim
    # Paarungswechsel einer Korrektur (_pairing_reset_fields).
    for match in live:
        if _fingerprint(match) != before[match["id"]] and (match.get("no_show_proposal") or match.get("no_show_extended_until")):
            match.update({"no_show_proposal": None, "no_show_extended_until": None})
    changed = [m["id"] for m in live if _fingerprint(m) != before[m["id"]]]
    for op in ops:
        op["display_event"] = DISPLAY_BY_OP.get(op.get("kind"), "slot_cleared")
    return {"registration_id": registration_id, "kind": kind, "ops": ops, "changed_ids": changed,
            "mode": summary.get("mode") or "bracket", "played": summary.get("played"), "total": summary.get("total"),
            # Auslosungen, die der Umbau auslöst (#1548) - geschrieben werden sie erst mit der Bestätigung.
            "draws": draws}


# ---------------------------------------------------------------------------------------------- Texte und Hash

def removal_hash(plan: dict) -> str:
    rows = {
        "registration_id": plan.get("registration_id"), "kind": plan.get("kind"), "mode": plan.get("mode"),
        "played": plan.get("played"), "total": plan.get("total"),
        "ops": [{k: v for k, v in op.items() if k not in {"text", "display_event"}} for op in plan.get("ops") or []],
    }
    return hashlib.sha256(json.dumps(rows, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")).hexdigest()


def _name(names: dict[str, str] | None, registration_id: str | None) -> str:
    if not registration_id:
        return "niemand"
    return (names or {}).get(registration_id) or registration_id


def describe_op(op: dict, names: dict[str, str] | None = None) -> str:
    where = op.get("match_key") or op.get("round_name") or "Spiel"
    kind = op.get("kind")
    if kind == "walkover":
        return f"{where}: {_name(names, op.get('winner'))} kommt kampflos weiter."
    if kind == "forfeit":
        opponents = ", ".join(_name(names, reg) for reg in op.get("opponents") or []) or "den Gegner"
        return f"{where}: wird kampflos verloren gewertet (für {opponents})."
    if kind == "slot_cleared":
        remaining = op.get("remaining") or []
        if not remaining:
            return f"{where}: der Platz wird frei, das Spiel wartet auf den Gegner."
        return f"{where}: der Platz wird frei, {len(remaining)} bleiben."
    if kind == "annulled":
        return f"{where}: wird annulliert" + (" (gespielt, zählt nicht mehr)." if op.get("played") else ".")
    if kind == "cancelled":
        return f"{where}: entfällt."
    if kind == "readvanced":
        return f"{where}: {_name(names, op.get('registration_id'))} rückt nach (Platz {op.get('rank')} aus {op.get('from_match_key')})."
    if kind == "draw_excluded":
        return f"{where}: {_name(names, op.get('registration_id'))} kommt nicht in die Auslosung der nächsten Runde."
    return f"{where}: {kind}"


def describe_removal(plan: dict, names: dict[str, str] | None = None) -> str:
    """Der Plan in Worten für die Bestätigung: Kopfzeile nach Modus, dann ein Satz je Umbau."""
    label = REMOVAL_LABELS.get(plan.get("kind"), "Ausscheiden")
    mode = plan.get("mode")
    ops = plan.get("ops") or []
    if mode == "annulled":
        head = (f"{label}: {plan.get('played')} von {plan.get('total')} Spielen gespielt, weniger als die Hälfte - "
                f"alle Spiele werden annulliert und die Person aus der Tabelle genommen.")
    elif mode == "forfeit":
        rest = len([op for op in ops if op.get("kind") == "forfeit"])
        # Einzahl und Mehrzahl (#1793): „1 offenes wird“, „2 offene werden“.
        open_text = {0: "keines wird", 1: "1 offenes wird"}.get(rest, f"{rest} offene werden")
        head = (f"{label}: {plan.get('played')} von {plan.get('total')} Spielen gespielt - "
                f"{open_text} kampflos verloren gewertet, die Person bleibt in der Tabelle.")
    elif mode == "swiss":
        head = f"{label}: die Ergebnisse bleiben, die Person wird nicht mehr gepaart."
    elif not ops:
        head = f"{label}: kein offenes Spiel betroffen."
    else:
        walkovers = len([op for op in ops if op.get("kind") in {"walkover", "forfeit"}])
        # Einzahl und Mehrzahl (#1793): „1 Spiel betroffen“, „2 Spiele betroffen“; „1 wird“, „2 werden“.
        games = "1 Spiel" if len(ops) == 1 else f"{len(ops)} Spiele"
        scored = {0: "keines wird", 1: "1 wird"}.get(walkovers, f"{walkovers} werden")
        head = f"{label}: {games} betroffen, {scored} kampflos gewertet."
    return " ".join([head, *(op.get("text") or describe_op(op, names) for op in ops)]).strip()


# ---------------------------------------------------------------------------------------------- Datenbank

async def _audit(db, action: str, tournament_id: str, actor_id: str | None, data: dict) -> None:
    await record_write(GRAPH, action, tournament_id=tournament_id)
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()), "action": action, "target_id": tournament_id, "actor_id": actor_id,
        "data": data, "created_at": now_utc().isoformat(),
    })


async def _load_matches(db, tournament_id: str) -> list[dict]:
    rows = await db.matches_v2.find({"tournament_id": tournament_id, "is_preview": {"$ne": True}}, {"_id": 0}).to_list(5000)
    return sorted(rows, key=_sort_key)


async def _names(db, tournament_id: str) -> dict[str, str]:
    rows = await db.tournament_registrations.find({"tournament_id": tournament_id}, {"_id": 0, "id": 1, "display_name": 1, "ingame_name": 1}).to_list(5000)
    return {row["id"]: row.get("display_name") or row.get("ingame_name") or row["id"] for row in rows if row.get("id")}


async def _eliminated(db, tournament_id: str) -> set[str]:
    rows = await db.tournament_registrations.find(
        {"tournament_id": tournament_id, "status": {"$in": list(REMOVAL_KINDS)}}, {"_id": 0, "id": 1}).to_list(1000)
    return {row["id"] for row in rows if row.get("id")}


def _plan_view(plan: dict | None) -> dict | None:
    return plan if isinstance(plan, dict) else None


async def propose_removal(db, tournament: dict, registration: dict, *, kind: str, reason: str | None,
                          actor_id: str | None) -> dict:
    """Schritt 1: der Umbauplan als Vorschlag am Turnier. Dieselbe Person, dieselbe Art, derselbe Stand → derselbe
    Vorschlag (kein zweiter Protokolleintrag). Ist die Person schon so eingetragen, gibt es nichts zu tun."""
    if kind not in REMOVAL_KINDS:
        raise TournamentEventError("Unbekannte Art des Ausscheidens.", 422)
    tid = tournament["id"]
    if registration.get("status") == kind:
        return {"ok": True, "idempotent_replay": True, "registration": registration, "plan": None}
    matches = copy.deepcopy(await _load_matches(db, tid))
    plan = plan_removal(matches, registration["id"], kind=kind, now_iso=now_utc().isoformat(),
                        eliminated=await _eliminated(db, tid))
    names = await _names(db, tid)
    for op in plan["ops"]:
        op["text"] = describe_op(op, names)
    digest = removal_hash(plan)
    existing = _plan_view(tournament.get("participant_removal_plan"))
    if existing and existing.get("hash") == digest and existing.get("registration_id") == registration["id"] \
            and existing.get("kind") == kind:
        return {"ok": True, "idempotent_replay": True, "plan": existing, "requires_confirmation": True}
    proposal = {
        "id": str(uuid.uuid4()), "hash": digest, "registration_id": registration["id"],
        "display_name": names.get(registration["id"]), "kind": kind, "reason": (reason or "").strip() or None,
        "mode": plan["mode"], "played": plan["played"], "total": plan["total"], "ops": plan["ops"],
        "summary": describe_removal(plan, names), "created_at": now_utc().isoformat(), "actor_id": actor_id,
    }
    await db.tournaments.update_one({"id": tid}, {"$set": {"participant_removal_plan": proposal}})
    tournament["participant_removal_plan"] = proposal
    await _audit(db, "tournament.participant.removal_proposed", tid, actor_id, {
        "engine": GRAPH, "plan_id": proposal["id"], "registration_id": registration["id"], "kind": kind,
        "mode": plan["mode"], "summary": proposal["summary"], "op_count": len(plan["ops"]),
    })
    return {"ok": True, "idempotent_replay": False, "plan": proposal, "requires_confirmation": True}


async def reject_removal(db, tournament: dict, plan_id: str | None, *, actor_id: str | None) -> dict:
    plan = _plan_view(tournament.get("participant_removal_plan"))
    if not plan or (plan_id and plan.get("id") != plan_id):
        raise TournamentEventError("Es liegt kein offener Vorschlag mit dieser Kennung vor.", 409)
    tid = tournament["id"]
    await db.tournaments.update_one({"id": tid}, {"$set": {"participant_removal_plan": None}})
    tournament["participant_removal_plan"] = None
    await _audit(db, "tournament.participant.removal_rejected", tid, actor_id, {
        "engine": GRAPH, "plan_id": plan["id"], "registration_id": plan.get("registration_id"), "kind": plan.get("kind"),
    })
    return {"ok": True, "rejected": plan["id"]}


async def confirm_removal(db, tournament: dict, registration: dict, plan_id: str | None, *, kind: str,
                          actor_id: str | None, reason: str | None = None) -> dict:
    """Schritt 2: die Turnierleitung bestätigt. Der Plan wird aus dem aktuellen Stand neu gerechnet und nur angewendet,
    wenn er noch derselbe ist - sonst 409 mit dem neuen Vorschlag. Doppelt gesendet = einmal ausgeführt: ist die Person
    schon so eingetragen, gibt es nichts mehr zu tun."""
    tid = tournament["id"]
    plan = _plan_view(tournament.get("participant_removal_plan"))
    if registration.get("status") == kind:
        if plan and plan.get("registration_id") == registration["id"]:
            await db.tournaments.update_one({"id": tid}, {"$set": {"participant_removal_plan": None}})
        return {"ok": True, "idempotent_replay": True, "registration": registration, "applied": []}
    if not plan or (plan_id and plan.get("id") != plan_id) or plan.get("registration_id") != registration["id"] \
            or plan.get("kind") != kind:
        raise TournamentEventError("Es liegt kein offener Vorschlag mit dieser Kennung vor.", 409)
    now_iso = now_utc().isoformat()
    matches = await _load_matches(db, tid)
    original = {m["id"]: copy.deepcopy(m) for m in matches}
    fresh = plan_removal(matches, registration["id"], kind=kind, now_iso=now_iso, eliminated=await _eliminated(db, tid))
    if removal_hash(fresh) != plan.get("hash"):
        await db.tournaments.update_one({"id": tid}, {"$set": {"participant_removal_plan": None}})
        tournament["participant_removal_plan"] = None
        await propose_removal(db, tournament, registration, kind=kind, reason=plan.get("reason"), actor_id=actor_id)
        raise TournamentEventError("Der Vorschlag ist nicht mehr aktuell - inzwischen hat sich etwas geändert. Bitte neu prüfen.", 409)
    names = await _names(db, tid)
    for op in fresh["ops"]:
        op["text"] = describe_op(op, names)
    if (reason or "").strip():
        plan = {**plan, "reason": reason.strip()}
    applied = await _apply(db, tournament, registration, fresh, matches, original, plan=plan, now_iso=now_iso, actor_id=actor_id)
    await db.tournaments.update_one({"id": tid}, {"$set": {"participant_removal_plan": None}})
    tournament["participant_removal_plan"] = None
    return {"ok": True, "idempotent_replay": False, "registration": applied["registration"], "applied": fresh["ops"],
            "changed_match_ids": applied["changed"], "summary": describe_removal(fresh, names)}


async def _apply(db, tournament: dict, registration: dict, fresh: dict, matches: list[dict], original: dict[str, dict],
                 *, plan: dict, now_iso: str, actor_id: str | None) -> dict:
    tid = tournament["id"]
    kind = fresh["kind"]
    stages = await db.tournament_stages.find({"tournament_id": tid}, {"_id": 0}).sort("number", 1).to_list(200)
    report = validate_competition_graph(build_structure_snapshot(tid, stage_matches=matches, stages=stages))
    if not report.get("valid"):
        codes = sorted({issue.get("code") for issue in report.get("issues") or [] if issue.get("severity") == "error"})
        logger.error("Ausscheiden abgelehnt: Graph ungültig tournament=%s codes=%s", tid, codes)
        raise TournamentEventError("Der Umbau ergäbe keinen gültigen Turnierbaum und wurde nicht gespeichert.", 409)
    changed = [m for m in matches if _fingerprint(original.get(m["id"]) or {}) != _fingerprint(m)]
    # Compare-and-Set wie beim Lauf-Umbau: nichts überschreiben, was inzwischen aufgerufen, gestartet oder entschieden ist.
    for match in changed:
        if await db.matches_v2.count_documents(_unchanged_filter(original[match["id"]])) != 1:
            raise TournamentEventError(STALE_DETAIL, 409)
    # Zuerst die Anmeldung: ab jetzt rückt die Person bei keinem Ergebnis mehr ein (``eliminated`` im Ergebnis-Weg).
    removal = {"kind": kind, "mode": fresh["mode"], "played": fresh.get("played"), "total": fresh.get("total"),
               "at": now_iso, "reason": plan.get("reason"), "actor_id": actor_id, "plan_id": plan.get("id"),
               "previous_status": registration.get("status")}
    await db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {
        "status": kind, "removal": removal, "updated_at": now_iso,
    }})
    written: list[dict] = []
    for match in changed:
        result = await db.matches_v2.update_one(_unchanged_filter(original[match["id"]]), {"$set": _doc_fields(match)})
        if result.matched_count != 1:
            for row in written:
                await db.matches_v2.update_one({"id": row["id"]}, {"$set": _doc_fields(row)})
            await db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {
                "status": registration.get("status"), "updated_at": now_iso}, "$unset": {"removal": ""}})
            raise TournamentEventError(STALE_DETAIL, 409)
        written.append(original[match["id"]])
    # Liga (#1649): ein ausgeschiedenes Co-Team gibt seinen Platz in der Season frei (``league_squad_key``) - erst
    # jetzt, wo der Umbau geschrieben ist; ein Abbruch oben muss so keinen Schlüssel zurückholen.
    if registration.get("league_squad_key"):
        await db.tournament_registrations.update_one({"id": registration["id"]}, {"$unset": {"league_squad_key": ""}})
    # Stationen und Aufrufe frei: jedes geänderte Spiel, das nicht mehr spielbereit ist oder entschieden wurde.
    for match in changed:
        before = original[match["id"]]
        if (before.get("station_id") or before.get("called_at")) and (
                match.get("status") in TERMINAL_STATUSES or match.get("status") == "pending"):
            try:
                await release_station_for_match(db, before, "matches_v2")
            except Exception as exc:  # noqa: BLE001 - die Station darf später frei werden, der Umbau ist geschrieben
                logger.warning("Station release failed for match=%s type=%s", match.get("id"), type(exc).__name__)
    by_id = {m["id"]: m for m in matches}
    for op in fresh["ops"]:
        match = by_id.get(op.get("match_id")) or {}
        await _audit(db, AUDIT_ACTIONS.get(op.get("kind"), "match.slot_cleared"), tid, actor_id, {
            "engine": GRAPH, "stage_id": match.get("stage_id"), "plan_id": plan.get("id"),
            "registration_id": registration["id"], "removal": kind, **op,
        })
        if op.get("kind") == "forfeit":
            await db.match_reports_v2.update_one({"id": f"removal-{plan.get('id')}-{match.get('id')}"}, {"$setOnInsert": {
                "id": f"removal-{plan.get('id')}-{match.get('id')}", "match_id": match.get("id"), "tournament_id": tid,
                "stage_id": match.get("stage_id"), "reporter_user_id": actor_id, "source": "staff",
                "results": match.get("results") or [], "note": REMOVAL_LABELS[kind], "reason": plan.get("reason"),
                "force": False, "created_at": now_iso,
            }}, upsert=True)
    await _audit(db, f"tournament.participant.{kind}", tid, actor_id, {
        "engine": GRAPH, "plan_id": plan.get("id"), "registration_id": registration["id"], "kind": kind,
        "mode": fresh["mode"], "played": fresh.get("played"), "total": fresh.get("total"), "reason": plan.get("reason"),
        "match_ids": [m["id"] for m in changed], "summary": plan.get("summary"), "display_event": DISPLAY_EVENTS[kind],
    })
    await _notify(db, tournament, registration, kind, plan.get("reason"), changed, original)
    try:
        from services import tournament_fees
        await tournament_fees.close_price(db, registration, f"Anmeldung: {kind}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Fee close failed for registration=%s type=%s", registration.get("id"), type(exc).__name__)
    await persist_competition_versions(db, tournament, "graph")
    try:
        from services.discord_bracket import request_refresh
        request_refresh(tid)
    except Exception:  # noqa: BLE001
        logger.debug("Discord-Baum für Turnier %s nicht vorgemerkt", tid, exc_info=True)
    await publish_tournament_event(tid, DISPLAY_EVENTS[kind], match_ids=[m["id"] for m in changed],
                                   registration_id=registration["id"])
    for op in fresh["ops"]:
        if op.get("kind") in {"walkover", "forfeit", "readvanced"}:
            await publish_tournament_event(tid, op["display_event"], match_ids=[op.get("match_id")])
    # Gemischt (#1548): hat der Umbau eine Runde entschieden, steht die Auslosung im Protokoll (Person: wer bestätigt
    # hat) und geht als Anzeige-Ereignis ``draw_done`` raus - wie beim Ergebnis.
    if fresh.get("draws"):
        from services.draw_records import record_draws
        await record_draws(db, fresh["draws"], actor_id=actor_id, tournament_id=tid)
    await publish_api_change("POST", f"/api/matches-v2/{tid}/removal", 200)
    await publish_api_change("POST", f"/api/tournaments/{tid}/registrations/{registration['id']}/removal", 200)
    # Ein 409 im Lauf-Planer wird dort abgefangen; der nächste Auslöser prüft neu.
    await evaluate_after_write(db, tid, actor_id=actor_id, trigger="removal")
    for stage in stages:
        if any(m.get("stage_id") == stage.get("id") for m in changed):
            await _replan_schedule(db, tournament, stage)
    updated = await db.tournament_registrations.find_one({"id": registration["id"]}, {"_id": 0}) or registration
    return {"registration": updated, "changed": [m["id"] for m in changed]}


async def _notify(db, tournament: dict, registration: dict, kind: str, reason: str | None,
                  changed: list[dict], original: dict[str, dict]) -> None:
    """Die Person erfährt es; wer kampflos weiterkommt oder gewertet wurde, bekommt „Ergebnis bestätigt“."""
    from services.match_audience import responsible_user_ids, users_for
    from services.user_notifications import create_user_notification

    title = tournament.get("title") or "Turnier"
    label = REMOVAL_LABELS[kind]
    body = (f"{title}: Die Turnierleitung hat deinen Austritt eingetragen." if kind == "withdrawn"
            else f"{title}: Die Turnierleitung hat dich disqualifiziert.")
    if reason:
        body += f" Grund: {reason}"
    try:
        for user in await users_for(db, await responsible_user_ids(db, [registration])):
            await create_user_notification(
                user["id"], label, body, url=f"/tournaments/{tournament.get('slug') or tournament.get('id')}",
                kind="tournament_registration",
                meta={"category": "tournament_updates", "tournament_id": tournament.get("id"),
                      "registration_id": registration.get("id"), "status": kind,
                      "dedupe_key": f"removal:{registration.get('id')}:{kind}"},
            )
    except Exception as exc:  # noqa: BLE001 - eine Nachricht hält kein Ausscheiden auf
        logger.warning("Removal notice failed for registration=%s type=%s", registration.get("id"), type(exc).__name__)
    for match in changed:
        before = original.get(match["id"]) or {}
        if match.get("status") in {"completed", "forfeit"} and before.get("status") not in {"completed", "forfeit"}:
            try:
                await notify_match_result_confirmed(db, match, "matches_v2")
            except Exception as exc:  # noqa: BLE001
                logger.warning("Walkover notice failed for match=%s type=%s", match.get("id"), type(exc).__name__)
