"""FFA-Läufe zusammenlegen, ausgleichen und abkürzen (#1550).

Ist ein Turnier nicht voll oder fallen Fahrer aus, bleiben Läufe unterbesetzt. Dieser Dienst prüft bei jeder Änderung
der erwarteten Belegung (Baubau beim Check-in, Ergebnis samt Korrektur, Wertung, Freilos-Kette - Ausfall und Austritt
rufen ab #1553 dieselbe Funktion) jede **Lauf-Gruppe**: die Läufe derselben Runde und Sektion mit demselben Ziel.

Regeln (Issue #1550, Entscheidung E13):

- **Erwartete Belegung** eines Laufs = belegte Plätze + offene Plätze, deren Quelle noch liefern kann (die Quelle lebt,
  hat genug Teilnehmer und schickt diesen Platz weiter). Ein leerer Lauf liefert 0 - das ist früh erkennbar.
- **Zusammenlegen / Ausgleichen:** die Verbliebenen der Gruppe werden so auf so wenige Läufe verteilt, wie die
  Laufgröße erlaubt (dieselbe Regel wie der Generator aus #1549, ``ffa_heat_plan``): in Schlangenlinie nach Platz im
  Vorlauf bzw. Setzplatz, Unterschied höchstens 1, nie ein Lauf mit einem Teilnehmer. Passt alles in einen Lauf, ist das
  der Sammellauf (kleinste ``order``); die anderen werden ``cancelled`` mit ``merged_into``. 2 + 2 wird ein Lauf mit 4.
- **Quote:** ein umgebauter Lauf mit n Teilnehmern schickt ``heat_quota(n)`` weiter (anteilig, mindestens einer kommt
  weiter, mindestens einer scheidet aus), die Summe der Gruppe höchstens so viele, wie das Ziel fassen kann. Sie steht
  vor dem Start fest in ``settings.qualifiers_per_match`` (TV und App rechnen damit) und in ``qualifiers_effective``.
  Plätze im Folgelauf, die so nicht mehr beliefert werden, sind als „Quelle unerfüllbar“ markiert
  (Freilos-Platz mit ``source_result.reason = source_unfulfillable``; die alte Quelle steht in ``source.was``).
  Es gilt durchgehend: ein Platz hat genau dann eine Lauf-Quelle (``source.type = rank``), wenn ein
  ``advancement``-Eintrag dieses Laufs auf ihn zeigt - das prüft die Graph-Validierung.
- **Abkürzen:** sind im Sammellauf alle Verbliebenen, ist er das Finale - spätere Runden entfallen (``shortened``).
- **Nie umbauen:** Läufe, die laufen (``in_progress``) oder aufgerufen sind (``called_at``), und alles, was entschieden
  ist. Vorschauen ebenso.
- **Bestätigung:** je Turnier ``heat_rebuild_mode``: ``suggest`` (Vorgabe) - Auffüllen, Freilos und Quote laufen von
  selbst, Zusammenlegen, Ausgleichen und Abkürzen werden als Plan am Turnier gespeichert (``heat_rebuild_plan``) und
  von der Turnierleitung bestätigt oder abgelehnt; ``auto`` - alles sofort. Ein abgelehnter Plan kommt nicht wieder,
  solange derselbe Umbau vorgeschlagen würde.

Der reine Planer (``rebuild_heats``) arbeitet wie ``resolve_walkovers`` im Speicher auf den Spiel-Dokumenten; der
Graph wird vor dem Schreiben geprüft (``competition_graph_validation``). Protokoll: ``tournament.heats.merged``,
``tournament.heats.rebalanced``, ``tournament.round.shortened`` (dazu ``adjusted``, ``proposed``, ``confirmed``,
``rejected``). Nach jedem Umbau geht ein öffentliches Änderungsereignis raus, damit TV und Web neu laden; die Animation
im Baum und am TV kommt mit #1561/#1564.
"""
from __future__ import annotations

import copy
import hashlib
import json
import logging
import math
import uuid
from collections import defaultdict

from datetime import timedelta

from models import now_utc
from services.change_events import publish_api_change
from services.competition_graph_validation import validate_competition_graph
from services.competition_snapshot import build_structure_snapshot
from services.competition_usage import GRAPH, record_write
from services.competition_versions import persist_competition_versions
from services.custom_bracket import _snake_split, heat_quota
from services.match_v2_results import _status_after_slot_fill, group_awaits_draw, resolve_walkovers, run_ready_draws
from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource
from services.station_runtime import release_station_for_match
from services.tournament_permissions import STRUCTURE_STAFF_ROLES
from services.user_notifications import create_user_notification

logger = logging.getLogger("tls.heat_rebuild")

HEAT_REBUILD_MODES = ("suggest", "auto")
DEFAULT_HEAT_REBUILD_MODE = "suggest"
REBUILDABLE_STATUSES = {"pending", "ready", "scheduled"}
DECIDED_STATUSES = {"completed", "forfeit"}
TERMINAL_STATUSES = {"completed", "forfeit", "cancelled"}
SOURCE_UNFULFILLABLE = "source_unfulfillable"
STRUCTURAL_KINDS = {"merged", "rebalanced", "shortened"}
AUDIT_ACTIONS = {
    "merged": "tournament.heats.merged",
    "rebalanced": "tournament.heats.rebalanced",
    "shortened": "tournament.round.shortened",
    "quota": "tournament.heats.adjusted",
    "cancelled": "tournament.heats.adjusted",
}
MAX_PASSES = 8


class HeatRebuildError(Exception):
    def __init__(self, detail: str, status_code: int = 409):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def heat_rebuild_mode(tournament: dict | None) -> str:
    value = (tournament or {}).get("heat_rebuild_mode")
    return value if value in HEAT_REBUILD_MODES else DEFAULT_HEAT_REBUILD_MODE


# ---------------------------------------------------------------------------------------------- Lesen

def _rebuildable(match: dict) -> bool:
    return (
        not match.get("is_preview")
        and str(match.get("status") or "pending") in REBUILDABLE_STATUSES
        and not match.get("called_at")
    )


def _live(match: dict) -> bool:
    return not match.get("is_preview") and str(match.get("status") or "pending") not in TERMINAL_STATUSES


def _is_ffa_bracket(matches: list[dict]) -> bool:
    """Nur Läufe eines FFA-Baums: ein Lauf mit Zufluss aus einem anderen Lauf. Liga und Einzel-Lauf haben keinen."""
    return any(
        match.get("match_type") == "ffa"
        and any((slot.get("source") or {}).get("type") == "rank" for slot in match.get("slots") or [])
        for match in matches
    )


def stage_heat_rules(stage: dict, matches: list[dict]) -> dict:
    """Laufgröße, Quote und Mindestgröße einer Phase - aus den Einstellungen, sonst aus den gebauten Läufen."""
    settings = (stage or {}).get("settings") or {}
    sizes = [len(match.get("slots") or []) for match in matches if match.get("match_type") == "ffa"]
    quotas = [int((match.get("settings") or {}).get("qualifiers_per_match") or 0) for match in matches if match.get("advancement")]
    cap = int(settings.get("match_size") or 0) or (max(sizes) if sizes else 4)
    quota = int(settings.get("qualifiers_per_match") or 0) or (max(quotas) if quotas else 1)
    return {
        "cap": max(2, cap),
        "quota": max(1, min(quota, max(2, cap) - 1)),
        "min_players": max(1, int(settings.get("min_players") or 2)),
    }


def _slot_no(slot: dict) -> int:
    return int(slot.get("slot") or 0)


def _find_slot(match: dict | None, slot_no: int) -> dict | None:
    for slot in (match or {}).get("slots") or []:
        if _slot_no(slot) == int(slot_no):
            return slot
    return None


def _quota_of(match: dict) -> int:
    ranks = [int(entry.get("rank") or 0) for entry in match.get("advancement") or [] if entry.get("flow") == "W"]
    stored = int((match.get("settings") or {}).get("qualifiers_per_match") or 0)
    if ranks:
        return min(stored, max(ranks)) if stored else max(ranks)
    return stored


class _Graph:
    """Die Läufe einer Phase mit der erwarteten Belegung - neu berechnet nach jeder Änderung (``invalidate``)."""

    def __init__(self, matches: list[dict]):
        self.matches = matches
        self.by_id = {match["id"]: match for match in matches if match.get("id")}
        self.by_key = {match.get("match_key"): match for match in matches if match.get("match_key")}
        self._entries: dict[str, list[dict]] = {}

    def invalidate(self) -> None:
        self._entries = {}

    def entries(self, match: dict) -> list[dict]:
        """Belegte Plätze und offene Plätze, deren Quelle noch liefern kann."""
        cached = self._entries.get(match["id"])
        if cached is not None:
            return cached
        rows: list[dict] = []
        for slot in match.get("slots") or []:
            if slot.get("status") == "filled" and slot.get("registration_id"):
                rows.append(slot)
            elif slot.get("status") == "pending" and (slot.get("source") or {}).get("type") == "rank" and self.deliverable(slot):
                rows.append(slot)
        self._entries[match["id"]] = rows
        return rows

    def awaits_draw(self, match: dict) -> bool:
        """Folgespiel einer gemischten Runde, die noch nicht ausgelost ist (#1548)."""
        return group_awaits_draw(self.matches, ((match.get("settings") or {}).get("draw_group")), match.get("stage_id"))

    def deliverable(self, slot: dict) -> bool:
        source = slot.get("source") or {}
        origin = self.by_key.get(source.get("match_key"))
        if not origin:
            return False
        if _live(origin):
            count = len(self.entries(origin))
        elif (str(origin.get("status") or "") in DECIDED_STATUSES
              and group_awaits_draw(self.matches, (source.get("draw") or {}).get("group"), origin.get("stage_id"))):
            # Gemischt (#1548): die Quelle ist entschieden, ihr Weiterkommer wartet nur noch auf die Auslosung.
            count = len(origin.get("results") or [])
        else:
            return False
        rank = int(source.get("rank") or 0)
        flow = source.get("flow")
        if flow == "W":
            return 1 <= rank <= min(_quota_of(origin), count)
        if flow == "L":
            return 1 <= rank and _quota_of(origin) + rank <= count
        return 1 <= rank <= count

    def alive_from_round(self, round_no: int) -> int:
        """Wie viele Teilnehmer ab dieser Runde noch im Rennen sind: wer in einem offenen Lauf ab der Runde steht, plus
        alle, die aus offenen Läufen davor noch weitergeschickt werden."""
        total = 0
        for match in self.matches:
            if match.get("match_type") != "ffa":
                continue
            if not _live(match):
                # Gemischt (#1548): die Weiterkommer eines entschiedenen Laufs, die noch auf die Auslosung warten, sitzen
                # noch nirgends - sie sind im Rennen, gleich welche Runde (``deliverable`` lässt nur solche Plätze durch).
                if str(match.get("status") or "") not in DECIDED_STATUSES:
                    continue
            elif int(match.get("round") or 0) >= round_no:
                total += sum(1 for slot in match.get("slots") or [] if slot.get("status") == "filled" and slot.get("registration_id"))
                continue
            for entry in match.get("advancement") or []:
                target_slot = _find_slot(self.by_id.get(entry.get("to_match_id")), int(entry.get("to_slot") or 0))
                if target_slot and target_slot.get("status") == "pending" and self.deliverable(target_slot):
                    total += 1
        return total

    def downstream(self, match: dict) -> list[dict]:
        seen: set[str] = set()
        queue = [match]
        found: list[dict] = []
        while queue:
            current = queue.pop(0)
            for entry in current.get("advancement") or []:
                target = self.by_id.get(entry.get("to_match_id"))
                if not target or target["id"] in seen:
                    continue
                seen.add(target["id"])
                found.append(target)
                queue.append(target)
        return found


# ---------------------------------------------------------------------------------------------- Umbauen

def _bye_slot(slot_no: int) -> dict:
    return {"slot": slot_no, "source": {"type": "bye", "raw": "bye"}, "registration_id": None, "user_id": None,
            "seed": None, "status": "bye"}


def _mark_unfulfillable(slot: dict, origin: dict, rank: int, flow: str | None, reason: str, now_iso: str) -> None:
    slot["registration_id"] = None
    slot["user_id"] = None
    slot["source_result"] = {
        "from_match_id": origin.get("id"),
        "from_match_key": origin.get("match_key"),
        "rank": rank,
        "flow": flow,
        "skipped": True,
        "reason": reason,
        "confirmed_at": now_iso,
    }
    slot["status"] = "bye"


def _cancel(match: dict, reason: str, now_iso: str, merged_into: dict | None = None) -> None:
    for slot in match.get("slots") or []:
        if slot.get("registration_id") or slot.get("status") in {"filled", "pending"}:
            slot["registration_id"] = None
            slot["user_id"] = None
            slot["status"] = "bye"
            if merged_into:
                slot["moved_to"] = merged_into["id"]
    match.update({
        "status": "cancelled",
        "results": [],
        "result_meta": {"source": "heat_rebuild", "reason": reason, "updated_at": now_iso,
                        **({"merged_into": merged_into["id"]} if merged_into else {})},
        "completed_at": None,
        "completed_by": None,
        "station_id": None,
        "scheduled_at": None,
        "called_at": None,
        "updated_at": now_iso,
    })
    if merged_into:
        match["merged_into"] = merged_into["id"]
        match["merged_into_key"] = merged_into.get("match_key")


def _void_targets(graph: _Graph, match: dict, reason: str, now_iso: str) -> None:
    """Die Zielplätze eines entfallenen Laufs: Freilos, wie es die Freilos-Kette täte."""
    for entry in match.get("advancement") or []:
        target = graph.by_id.get(entry.get("to_match_id"))
        slot = _find_slot(target, int(entry.get("to_slot") or 0))
        if not target or not slot or not _rebuildable(target):
            continue
        if slot.get("status") == "pending" or (slot.get("source_result") or {}).get("from_match_id") == match["id"]:
            _mark_unfulfillable(slot, match, int(entry.get("rank") or 0), entry.get("flow"), reason, now_iso)
            target["status"] = _status_after_slot_fill(target, preserve_terminal=False)
            target["updated_at"] = now_iso


def _entry_key(slot: dict, graph: _Graph) -> tuple:
    source = slot.get("source") or {}
    if source.get("type") == "rank":
        origin = graph.by_key.get(source.get("match_key")) or {}
        return (0, int(source.get("rank") or 0), int(origin.get("order") or 0), _slot_no(slot))
    return (1, int(source.get("seed") or slot.get("seed") or 0), 0, _slot_no(slot))


def _feeding_entry(graph: _Graph, slot: dict, match_id: str) -> dict | None:
    """Der ``advancement``-Eintrag der Quelle, der diesen Platz beliefert - gesucht, bevor der Umbau Plätze verschiebt,
    damit zwei Einträge nicht denselben Platz treffen."""
    source = slot.get("source") or {}
    if source.get("type") != "rank":
        return None
    origin = graph.by_key.get(source.get("match_key"))
    for entry in (origin or {}).get("advancement") or []:
        if entry.get("to_match_id") == match_id and int(entry.get("to_slot") or 0) == _slot_no(slot):
            return entry
    return None


def _status_for(match: dict, previous_status: str) -> str:
    status = _status_after_slot_fill(match, preserve_terminal=False)
    if status == "ready" and previous_status == "scheduled" and match.get("scheduled_at"):
        return "scheduled"
    return status


def _dormant(graph: _Graph, slot: dict) -> bool:
    """Ein Freilos-Platz „Quelle unerfüllbar“, dessen Quelle noch lebt: bleibt stehen, damit die Quote der Quelle
    wieder wachsen kann (2 + 2 werden 4, und der zweite Platz kommt zurück)."""
    was = (slot.get("source") or {}).get("was") or {}
    origin = graph.by_key.get(was.get("match_key"))
    return slot.get("status") == "bye" and bool(origin) and _live(origin)


def _rebuild_group(graph: _Graph, heats: list[dict], buckets: list[list[tuple]],
                   min_players: int, now_iso: str) -> tuple[list[dict], dict[str, dict]]:
    """Verteilt die Einträge der Gruppe auf die ersten ``len(buckets)`` Läufe (nach ``order``); der Rest entfällt."""
    survivors = heats[: len(buckets)]
    dormant = [copy.deepcopy(slot) for heat in heats for slot in heat.get("slots") or [] if _dormant(graph, slot)]
    # Leere Plätze aus einem Ausscheiden ohne Nachrücker (#1596), auf die noch eine Weiterleitung zeigt: sie ziehen mit
    # in den Sammellauf, samt Weiterleitung - sonst bekäme ein anderer Lauf denselben Platz (zwei Quellen auf einem
    # Platz). Ein Ausfall vor dem Start (ohne `removed_registration_id`) braucht keinen zusätzlichen Freilos-Platz.
    linked_byes = [(copy.deepcopy(slot), entry) for heat in heats for slot in heat.get("slots") or []
                   if slot.get("status") == "bye" and (slot.get("source_result") or {}).get("removed_registration_id")
                   and (entry := _feeding_entry(graph, slot, heat["id"])) is not None]
    linked = {id(entry) for _slot, entry in linked_byes}
    # Ein bleibender Lauf bekommt neue Platznummern. Ein Freilos-Platz, für den der entschiedene Vorlauf niemanden
    # geschickt hat (#1596, gemischt: das Los gab dem Vorlauf weniger Fahrer, als er weiterschicken durfte), behält
    # seinen Platz samt Weiterleitung - sonst zeigte sie auf eine Nummer, die jetzt ein anderer Lauf beliefert (zwei
    # Quellen auf einem Platz) oder die es nicht mehr gibt.
    kept_byes = {heat["id"]: [(copy.deepcopy(slot), entry) for slot in heat.get("slots") or []
                              if slot.get("status") == "bye" and (slot.get("source_result") or {}).get("skipped")
                              and (entry := _feeding_entry(graph, slot, heat["id"])) is not None and id(entry) not in linked]
                 for heat in survivors}
    merged: dict[str, dict] = {}
    scheduled = sorted(str(heat.get("scheduled_at")) for heat in heats if heat.get("scheduled_at"))
    received: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    feeding = [[_feeding_entry(graph, slot, origin_heat["id"]) for _key, slot, origin_heat in bucket] for bucket in buckets]
    for survivor, bucket, entries in zip(survivors, buckets, feeding):
        previous_status = str(survivor.get("status") or "pending")
        new_slots: list[dict] = []
        for index, ((_key, slot, origin_heat), entry) in enumerate(zip(bucket, entries), start=1):
            moved = copy.deepcopy(slot)
            moved.pop("moved_to", None)
            moved["slot"] = index
            if entry is not None:
                entry.update({"to_match_id": survivor["id"], "to_match_key": survivor.get("match_key"), "to_slot": index})
            new_slots.append(moved)
            if origin_heat["id"] != survivor["id"]:
                received[origin_heat["id"]][survivor["id"]] += 1
        if survivor is survivors[0]:
            for slot in dormant:
                slot["slot"] = len(new_slots) + 1
                new_slots.append(slot)
            for slot, entry in linked_byes:
                slot["slot"] = len(new_slots) + 1
                new_slots.append(slot)
                entry.update({"to_match_id": survivor["id"], "to_match_key": survivor.get("match_key"), "to_slot": slot["slot"]})
        for slot, entry in kept_byes.get(survivor["id"]) or []:
            slot.pop("moved_to", None)
            slot["slot"] = len(new_slots) + 1
            new_slots.append(slot)
            entry.update({"to_match_id": survivor["id"], "to_match_key": survivor.get("match_key"), "to_slot": slot["slot"]})
        while len(new_slots) < 2:
            new_slots.append(_bye_slot(len(new_slots) + 1))
        survivor["slots"] = new_slots
        survivor["settings"] = {**(survivor.get("settings") or {}),
                                "match_size": len(new_slots),
                                "min_players": max(1, min(min_players, len(bucket)))}
        survivor["status"] = _status_for(survivor, previous_status)
        survivor["rebuilt_at"] = now_iso
        survivor["updated_at"] = now_iso
        if scheduled and survivor is survivors[0] and not survivor.get("scheduled_at"):
            survivor["scheduled_at"] = scheduled[0]
    for heat in heats[len(buckets):]:
        targets = received.get(heat["id"]) or {}
        into = max(survivors, key=lambda s: (targets.get(s["id"], 0), -int(s.get("order") or 0))) if targets else survivors[0]
        _void_targets(graph, heat, "merged", now_iso)
        _cancel(heat, "merged", now_iso, merged_into=into)
        # Seine Plätze im Folgelauf gehören jetzt dem Sammellauf - der Pfeil von hier aus wäre falsch.
        heat["advancement"] = []
        merged[heat["id"]] = into
    graph.invalidate()
    return survivors, merged


def _revive(graph: _Graph, heat: dict, rank: int, now_iso: str) -> bool:
    """Der Platz „Quelle unerfüllbar“ für diesen Rang kommt zurück, wenn es ihn in einem umbaubaren Lauf noch gibt."""
    wanted = {"flow": "W", "match_key": heat.get("match_key"), "rank": rank}
    for target in graph.matches:
        if not _rebuildable(target):
            continue
        for slot in target.get("slots") or []:
            source = slot.get("source") or {}
            if source.get("type") != "bye" or (source.get("was") or {}) != wanted:
                continue
            slot["source"] = {"type": "rank", **wanted, "raw": source.get("raw") or f"W:{heat.get('match_key')}:{rank}",
                              **({"draw": source["draw"]} if source.get("draw") else {})}
            slot["source_result"] = None
            slot["registration_id"] = None
            slot["user_id"] = None
            slot["status"] = "pending"
            heat.setdefault("advancement", []).append({
                "flow": "W", "rank": rank, "to_match_key": target.get("match_key"), "to_match_id": target["id"],
                "to_slot": _slot_no(slot),
            })
            target["status"] = _status_after_slot_fill(target, preserve_terminal=False)
            target["updated_at"] = now_iso
            return True
    return False


def _apply_quota(graph: _Graph, heat: dict, cap: int, quota: int, now_iso: str, ops: list[dict]) -> None:
    """Die Quote eines Laufs folgt seiner Belegung: weniger Teilnehmer, weniger Weiterkommer - die Plätze im Folgelauf
    werden „Quelle unerfüllbar“; wächst der Lauf wieder (Zusammenlegen), kommen sie zurück."""
    advancement = heat.get("advancement") or []
    if not advancement or any(entry.get("flow") != "W" for entry in advancement):
        return
    count = len(graph.entries(heat))
    if count == 0:
        return
    current = _quota_of(heat)
    wanted = heat_quota(count, cap, quota)
    if wanted > current:
        for rank in range(current + 1, wanted + 1):
            if not _revive(graph, heat, rank, now_iso):
                wanted = rank - 1
                break
        graph.invalidate()
    advancement = heat.get("advancement") or []
    if wanted == current:
        if heat.get("qualifiers_effective") != current and heat.get("rebuilt_at"):
            heat["qualifiers_effective"] = current
        return
    dropped = [entry for entry in advancement if entry.get("flow") == "W" and int(entry.get("rank") or 0) > wanted]
    for entry in dropped:
        target = graph.by_id.get(entry.get("to_match_id"))
        slot = _find_slot(target, int(entry.get("to_slot") or 0))
        if target and slot and not _rebuildable(target) and slot.get("status") == "pending":
            return
    for entry in dropped:
        target = graph.by_id.get(entry.get("to_match_id"))
        slot = _find_slot(target, int(entry.get("to_slot") or 0))
        if target and slot and slot.get("status") == "pending":
            _mark_unfulfillable(slot, heat, int(entry.get("rank") or 0), "W", SOURCE_UNFULFILLABLE, now_iso)
            target["status"] = _status_after_slot_fill(target, preserve_terminal=False)
            target["updated_at"] = now_iso
    heat["advancement"] = [entry for entry in advancement if entry not in dropped]
    heat["settings"] = {**(heat.get("settings") or {}), "qualifiers_per_match": wanted}
    heat["qualifiers_effective"] = wanted
    heat["updated_at"] = now_iso
    ops.append({"kind": "quota", "round": heat.get("round"), "round_name": heat.get("round_name"),
                "heats": [heat.get("match_key")], "size": count, "quota": wanted, "quota_before": current})
    graph.invalidate()


def _trim_quotas(graph: _Graph, heats: list[dict], capacity: int, now_iso: str) -> None:
    """Die Summe der Weiterkommer einer Gruppe darf das Ziel nicht überfüllen."""
    while heats:
        total = sum(_quota_of(heat) for heat in heats)
        if total <= capacity:
            return
        heat = max((h for h in heats if _quota_of(h) > 1), key=lambda h: (_quota_of(h), -int(h.get("order") or 0)), default=None)
        if not heat:
            return
        wanted = _quota_of(heat) - 1
        for entry in list(heat.get("advancement") or []):
            if entry.get("flow") == "W" and int(entry.get("rank") or 0) > wanted:
                target = graph.by_id.get(entry.get("to_match_id"))
                slot = _find_slot(target, int(entry.get("to_slot") or 0))
                if target and slot and slot.get("status") == "pending":
                    _mark_unfulfillable(slot, heat, int(entry.get("rank") or 0), "W", SOURCE_UNFULFILLABLE, now_iso)
                    target["status"] = _status_after_slot_fill(target, preserve_terminal=False)
                heat["advancement"].remove(entry)
        heat["settings"] = {**(heat.get("settings") or {}), "qualifiers_per_match": wanted}
        heat["qualifiers_effective"] = wanted
        heat["updated_at"] = now_iso
        graph.invalidate()


def _shorten(graph: _Graph, final: dict, now_iso: str, ops: list[dict]) -> None:
    """Sind im Sammellauf alle Verbliebenen, ist er das Finale: spätere Runden entfallen."""
    if not final.get("advancement") or not _rebuildable(final):
        return
    expected = len(graph.entries(final))
    if expected == 0 or expected != graph.alive_from_round(int(final.get("round") or 0)):
        return
    cut = [match for match in graph.downstream(final) if _live(match)]
    if any(not _rebuildable(match) for match in cut):
        return
    for match in cut:
        _cancel(match, "shortened", now_iso)
    final["advancement"] = []
    final["round_name"] = "Finale"
    final["shortened_at"] = now_iso
    final["updated_at"] = now_iso
    ops.append({"kind": "shortened", "round": final.get("round"), "round_name": final.get("round_name"),
                "final": final.get("match_key"), "heats": [match.get("match_key") for match in cut], "size": expected})
    graph.invalidate()


def _group_key(match: dict) -> tuple:
    return (str(match.get("section") or ""), int(match.get("round") or 0),
            frozenset(str(entry.get("to_match_id")) for entry in match.get("advancement") or []))


def _pass(graph: _Graph, *, cap: int, quota: int, min_players: int, structural: bool, now_iso: str, ops: list[dict],
          draws: list[dict] | None = None) -> None:
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for match in graph.matches:
        # Gemischt (#1548): erst auslosen, dann umbauen - wer in diesen Läufen fährt, entscheidet erst das Los.
        if match.get("match_type") == "ffa" and _rebuildable(match) and not graph.awaits_draw(match):
            groups[_group_key(match)].append(match)
    ordered = sorted(groups.items(), key=lambda item: (item[0][1], min(int(h.get("order") or 0) for h in item[1])))
    for (_section, round_no, targets), heats in ordered:
        # Ein Abkürzen weiter vorn kann Läufe dieser Gruppe schon haben entfallen lassen.
        heats = sorted((h for h in heats if _rebuildable(h)), key=lambda h: (int(h.get("order") or 0), str(h.get("match_key") or "")))
        if not heats:
            continue
        entries: list[tuple] = []
        for heat in heats:
            live = graph.entries(heat)
            entries.extend((_entry_key(slot, graph), slot, heat) for slot in heat.get("slots") or [] if slot in live)
        entries.sort(key=lambda item: item[0])
        if not entries:
            for heat in heats:
                _void_targets(graph, heat, "bye", now_iso)
                _cancel(heat, "no_participants", now_iso)
            graph.invalidate()
            ops.append({"kind": "cancelled", "round": round_no, "round_name": heats[0].get("round_name"),
                        "heats": [heat.get("match_key") for heat in heats]})
            continue
        sizes_before = [sum(1 for _k, _s, h in entries if h is heat) for heat in heats]
        live_heats = [heat for heat, size in zip(heats, sizes_before) if size > 0]
        empty = [heat for heat, size in zip(heats, sizes_before) if size == 0]
        count = len(entries)
        wanted = max(1, min(math.ceil(count / cap), count // 2))
        live_sizes = [size for size in sizes_before if size > 0]
        if structural and targets and (wanted < len(live_heats) or max(live_sizes) - min(live_sizes) > 1):
            buckets = _snake_split(entries, wanted)
            survivors, merged = _rebuild_group(graph, live_heats + empty, buckets, min_players, now_iso)
            kind = "merged" if merged else "rebalanced"
            ops.append({
                "kind": kind, "round": round_no, "round_name": heats[0].get("round_name"),
                "heats": [heat.get("match_key") for heat in heats],
                "into": [heat.get("match_key") for heat in survivors],
                "sizes_before": sizes_before, "sizes_after": [len(bucket) for bucket in buckets],
                "merged": {graph.by_id[source]["match_key"]: target["match_key"] for source, target in merged.items()},
            })
            heats = survivors
        elif empty:
            for heat in empty:
                _void_targets(graph, heat, "bye", now_iso)
                _cancel(heat, "no_participants", now_iso)
            graph.invalidate()
            ops.append({"kind": "cancelled", "round": round_no, "round_name": heats[0].get("round_name"),
                        "heats": [heat.get("match_key") for heat in empty]})
            heats = live_heats
        for heat in heats:
            _apply_quota(graph, heat, cap, quota, now_iso, ops)
        if targets:
            _trim_quotas(graph, heats, cap * len(targets), now_iso)
            if structural and len(heats) == 1:
                _shorten(graph, heats[0], now_iso, ops)
    live_ids = [match["id"] for match in graph.matches if _live(match)]
    resolve_walkovers(live_ids, graph.by_id, {}, now_iso, draws=draws)
    # Hat der Umbau den letzten offenen Lauf einer gemischten Runde abgesagt, ist die Runde fertig: auslosen (#1548).
    drawn = run_ready_draws(graph.by_id, {}, now_iso, draws=draws)
    if drawn:
        resolve_walkovers(drawn, graph.by_id, {}, now_iso, draws=draws)
    _normalize_sources(graph)
    graph.invalidate()


def _normalize_sources(graph: _Graph) -> None:
    """Ein Platz hat genau dann eine Lauf-Quelle, wenn ein ``advancement``-Eintrag auf ihn zeigt. Wurde der Eintrag
    umgehängt oder gestrichen (Quote, Zusammenlegen, Abkürzen), bleibt ein Freilos-Platz mit ``source.was``."""
    fed: set[tuple[str, int]] = set()
    for match in graph.matches:
        for entry in match.get("advancement") or []:
            fed.add((str(entry.get("to_match_id")), int(entry.get("to_slot") or 0)))
    for match in graph.matches:
        for slot in match.get("slots") or []:
            source = slot.get("source") or {}
            if source.get("type") != "rank" or (match["id"], _slot_no(slot)) in fed:
                continue
            slot["source"] = {"type": "bye", "raw": source.get("raw"),
                              "was": {key: source.get(key) for key in ("flow", "match_key", "rank")},
                              **({"draw": source["draw"]} if source.get("draw") else {})}
            if slot.get("status") == "pending":
                slot["status"] = "bye"


def _fingerprint(match: dict) -> str:
    return json.dumps(match, sort_keys=True, default=str, separators=(",", ":"))


STALE_DETAIL = "Ein Lauf hat sich inzwischen geändert (aufgerufen, gestartet oder entschieden). Bitte neu prüfen."
INCOMPLETE_KIND = "tournament_heat_rebuild"


async def _roll_back(db, tournament: dict, stage: dict, written: list[tuple[dict, dict]], token: str, stamp: str, *,
                     actor_id: str | None) -> None:
    """Das schon Geschriebene zurück - als inverses Update (alte Felder zurück, neue Felder weg) und nur, solange noch
    der eigene Stand drinsteht (Kennung und Zeitstempel des Umbaus). Hat inzwischen jemand anderes geschrieben, bleibt
    dessen Stand; der Lauf gilt als „Umbau unvollständig“ - am Turnier vermerkt, im Protokoll, Nachricht an die
    Turnierleitung. Mit der Turnier-Schreibsperre in den Stationsrouten (#1569) ist das nur noch der Notfall."""
    incomplete: list[dict] = []
    stage_id = stage.get("id")
    for before, after in written:
        inverse = {"$set": _doc_fields(before)}
        gone = {key: "" for key in after if key not in before and key not in {"id", "_id"}}
        if gone:
            inverse["$unset"] = gone
        result = await db.matches_v2.update_one({"id": before["id"], "rebuild_token": token, "updated_at": stamp}, inverse)
        if result.matched_count != 1:
            incomplete.append(before)
    if not incomplete:
        return
    keys = [str(row.get("match_key") or row.get("id")) for row in incomplete]
    await _mark_incomplete(db, tournament, stage_id=stage_id, keys=keys, reason="foreign_change", actor_id=actor_id,
                           token=token, match_ids=[row["id"] for row in incomplete])


async def _mark_incomplete(db, tournament: dict, *, stage_id: str | None, keys: list[str], reason: str,
                           actor_id: str | None, **extra) -> None:
    """„Umbau unvollständig“: Vermerk am Turnier, Protokoll, Nachricht an die Turnierleitung."""
    tid = tournament["id"]
    mark = {"at": now_utc().isoformat(), "reason": reason, "stage_id": stage_id, "match_keys": keys, **extra}
    await db.tournaments.update_one({"id": tid}, {"$set": {"heat_rebuild_incomplete": mark}})
    await _audit(db, "tournament.heats.incomplete", tid, actor_id, {"engine": GRAPH, **mark})
    logger.error("Lauf-Umbau unvollständig tournament=%s reason=%s heats=%s", tid, reason, keys)
    await _notify_incomplete(db, tournament, stage_id=stage_id, keys=keys, reason=reason)


INCOMPLETE_TEXTS = {
    "foreign_change": "Beim Umbau der Läufe wurde {heats} gleichzeitig von jemand anderem geändert.",
    "retries_exhausted": "Der Umbau der Läufe ({heats}) ist mehrfach an einer gleichzeitigen Änderung gescheitert und wartet nun.",
}
# Eine Nachricht je Turnier, Phase und Vorfall - und frühestens nach einer Stunde noch einmal, falls es wieder passiert.
INCOMPLETE_COOLDOWN_SECONDS = 3600


async def _notify_incomplete(db, tournament: dict, *, stage_id: str | None, keys: list[str], reason: str) -> int:
    tid = tournament["id"]
    text = INCOMPLETE_TEXTS.get(reason) or INCOMPLETE_TEXTS["foreign_change"]
    body = f"{tournament.get('title') or 'Turnier'}: {text.format(heats=_join(keys) or 'ein Lauf')} Bitte den Turnierbaum prüfen."
    sent = 0
    for user_id in sorted(await _structure_staff_user_ids(db, tid)):
        created = await create_user_notification(
            user_id, "Lauf-Umbau unvollständig", body, f"/admin/tournaments/{tid}?tab=bracket", INCOMPLETE_KIND,
            {"tournament_id": tid, "dedupe_key": f"{INCOMPLETE_KIND}:{tid}:{stage_id or '-'}:{reason}",
             "cooldown_seconds": INCOMPLETE_COOLDOWN_SECONDS})
        sent += 1 if created else 0
    return sent


async def _structure_staff_user_ids(db, tournament_id: str) -> set[str]:
    """Wer den Umbau entscheiden darf (wie ``can_manage_structure``): Turnierleitung als Rolle oder Freigabe und die
    Helfer mit Strukturrolle für das ganze Turnier."""
    from services.permissions import tournament_lead_filter

    users = await db.users.find(
        {**tournament_lead_filter(), "is_active": {"$ne": False}, "is_banned": {"$ne": True}},
        {"_id": 0, "id": 1},
    ).to_list(200)
    ids = {row["id"] for row in users if row.get("id")}
    assignments = await db.tournament_staff_assignments.find(
        {"tournament_id": tournament_id, "is_active": {"$ne": False}, "role": {"$in": sorted(STRUCTURE_STAFF_ROLES)},
         "$or": [{"scope": "tournament"}, {"scope": None}, {"scope_id": None}]},
        {"_id": 0, "user_id": 1},
    ).to_list(500)
    ids.update(row["user_id"] for row in assignments if row.get("user_id"))
    return ids


def _doc_fields(match: dict) -> dict:
    return {key: value for key, value in match.items() if key not in {"id", "_id"}}


def _unchanged_filter(before: dict) -> dict:
    """Der Lauf steht noch so da wie gelesen: Stand, Aufruf, Beginn, Zeitstempel (``None`` trifft auch „fehlt“)."""
    return {
        "id": before["id"],
        "status": before.get("status") or "pending",
        "called_at": before.get("called_at"),
        "started_at": before.get("started_at"),
        "updated_at": before.get("updated_at"),
    }


def rebuild_heats(matches: list[dict], *, cap: int, quota: int, min_players: int = 2, structural: bool = True,
                  now_iso: str | None = None) -> dict:
    """Der Planer: baut die Läufe einer Phase im Speicher um (siehe Modulbeschreibung) und sagt, was er getan hat.

    ``structural=False`` macht nur, was keine Bestätigung braucht: leere Läufe entfallen, Quoten folgen der Belegung,
    unerfüllbare Quellen werden markiert. Antwort: ``ops`` (je Umbau ein Eintrag mit ``kind``) und ``changed_ids``.
    Zweimal aufgerufen ändert der zweite Lauf nichts mehr."""
    if not _is_ffa_bracket(matches):
        return {"ops": [], "changed_ids": [], "draws": []}
    now_iso = now_iso or now_utc().isoformat()
    before = {match["id"]: _fingerprint(match) for match in matches}
    graph = _Graph(matches)
    ops: list[dict] = []
    draws: list[dict] = []
    for _ in range(MAX_PASSES):
        snapshot = {match["id"]: _fingerprint(match) for match in matches}
        _pass(graph, cap=cap, quota=quota, min_players=min_players, structural=structural, now_iso=now_iso, ops=ops,
              draws=draws)
        if all(_fingerprint(match) == snapshot[match["id"]] for match in matches):
            break
    for op in ops:
        op["text"] = describe_op(op)
    changed = [match["id"] for match in matches if _fingerprint(match) != before[match["id"]]]
    # Auslosungen, die der Umbau ausgelöst hat (#1548) - ``_persist`` schreibt sie ins Protokoll.
    return {"ops": ops, "changed_ids": changed, "draws": draws}


# ---------------------------------------------------------------------------------------------- Texte und Plan

def _join(keys: list[str]) -> str:
    keys = [str(key) for key in keys]
    if len(keys) <= 1:
        return "".join(keys)
    return ", ".join(keys[:-1]) + " und " + keys[-1]


def describe_op(op: dict) -> str:
    """Ein Satz je Umbau für die Hinweisleiste und das Protokoll."""
    where = op.get("round_name") or f"Runde {op.get('round')}"
    kind = op.get("kind")
    if kind == "merged":
        sizes = " + ".join(str(size) for size in op.get("sizes_before") or [])
        after = ", ".join(f"{key} mit {size}" for key, size in zip(op.get("into") or [], op.get("sizes_after") or []))
        return f"{where}: Läufe {_join(op.get('heats') or [])} ({sizes}) werden zusammengelegt zu {after}."
    if kind == "rebalanced":
        before = " + ".join(str(size) for size in op.get("sizes_before") or [])
        after = " + ".join(str(size) for size in op.get("sizes_after") or [])
        return f"{where}: Läufe {_join(op.get('heats') or [])} werden ausgeglichen ({after} statt {before})."
    if kind == "shortened":
        return (f"{where}: Lauf {op.get('final')} hat mit {op.get('size')} alle Verbliebenen und wird das Finale; "
                f"{_join(op.get('heats') or [])} entfallen.")
    if kind == "quota":
        return f"{where}: Lauf {_join(op.get('heats') or [])} hat {op.get('size')} Teilnehmer, {op.get('quota')} kommen weiter (statt {op.get('quota_before')})."
    if kind == "cancelled":
        return f"{where}: {_join(op.get('heats') or [])} entfallen ohne Teilnehmer."
    return f"{where}: {kind}"


def plan_hash(ops: list[dict]) -> str:
    rows = [{key: value for key, value in op.items() if key != "text"} for op in ops]
    return hashlib.sha256(json.dumps(rows, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")).hexdigest()


def describe_plan(ops: list[dict]) -> str:
    return " ".join(op.get("text") or describe_op(op) for op in ops)


# ---------------------------------------------------------------------------------------------- Schreiben

async def _audit(db, action: str, tournament_id: str, actor_id: str | None, data: dict) -> None:
    await record_write(GRAPH, action, tournament_id=tournament_id)
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "action": action,
        "target_id": tournament_id,
        "actor_id": actor_id,
        "data": data,
        "created_at": now_utc().isoformat(),
    })


async def _replan_schedule(db, tournament: dict, stage: dict) -> None:
    """Aufrufpunkt für den Planer (#1552/#1569): Stationen und Termine nach einem Umbau neu rechnen, sobald es ihn gibt."""
    try:
        from services.match_scheduler import replan_after_heat_rebuild  # type: ignore[import-not-found]
    except ImportError:
        return
    try:
        await replan_after_heat_rebuild(db, tournament, stage)
    except Exception as exc:  # noqa: BLE001 - der Umbau ist geschrieben, der Plan darf später folgen
        logger.warning("Spielplaner nach Lauf-Umbau fehlgeschlagen tournament=%s type=%s", tournament.get("id"), type(exc).__name__)


async def _persist(db, tournament: dict, stage: dict, matches: list[dict], original: dict[str, dict],
                   ops: list[dict], *, actor_id: str | None, trigger: str, plan_id: str | None = None,
                   draws: list[dict] | None = None) -> list[str]:
    tid = tournament["id"]
    snapshot = build_structure_snapshot(tid, stage_matches=matches, stages=[stage])
    report = validate_competition_graph(snapshot)
    if not report.get("valid"):
        codes = sorted({issue.get("code") for issue in report.get("issues") or [] if issue.get("severity") == "error"})
        logger.error("Lauf-Umbau abgelehnt: Graph ungültig tournament=%s codes=%s", tid, codes)
        raise HeatRebuildError("Der Umbau ergäbe keinen gültigen Turnierbaum und wurde nicht gespeichert.", 409)
    changed = [match for match in matches if _fingerprint(original.get(match["id"]) or {}) != _fingerprint(match)]
    # Compare-and-Set (Codex-Prüfung zu #1575): jeder Lauf wird nur geschrieben, wenn er noch so dasteht wie gelesen -
    # Stand, Aufruf, Beginn und Zeitstempel. Die Stationsrouten laufen heute ohne die Turnier-Schreibsperre; ein
    # dazwischen aufgerufener oder gestarteter Lauf darf nicht mit dem alten Bild überschrieben werden.
    for match in changed:
        if await db.matches_v2.count_documents(_unchanged_filter(original[match["id"]])) != 1:
            raise HeatRebuildError(STALE_DETAIL, 409)
    # Jeder geschriebene Lauf trägt die Kennung dieses Umbaus und denselben Zeitstempel - daran erkennt ein Rollback,
    # dass noch der eigene Stand drinsteht und nicht schon eine fremde Änderung.
    token = str(uuid.uuid4())
    stamp = now_utc().isoformat()
    for match in changed:
        match["rebuild_token"] = token
        match["updated_at"] = stamp
    written: list[tuple[dict, dict]] = []
    for match in changed:
        before = original[match["id"]]
        result = await db.matches_v2.update_one(_unchanged_filter(before), {"$set": _doc_fields(match)})
        if result.matched_count != 1:
            # Ein Lauf hat sich zwischen Prüfung und Schreiben geändert: das Geschriebene zurück, nichts bleibt halb.
            await _roll_back(db, tournament, stage, written, token, stamp, actor_id=actor_id)
            raise HeatRebuildError(STALE_DETAIL, 409)
        written.append((before, match))
    for match in changed:
        before = original[match["id"]]
        if before.get("station_id") and match.get("status") == "cancelled":
            await release_station_for_match(db, before, "matches_v2")
    changed = [match["id"] for match in changed]
    for op in ops:
        await _audit(db, AUDIT_ACTIONS.get(op.get("kind"), "tournament.heats.adjusted"), tid, actor_id, {
            "engine": GRAPH, "stage_id": stage.get("id"), "trigger": trigger, **({"plan_id": plan_id} if plan_id else {}), **op,
        })
    if draws:
        from services.draw_records import record_draws
        await record_draws(db, draws, actor_id=actor_id, tournament_id=tid)
    await persist_competition_versions(db, tournament, "graph")
    await publish_api_change("POST", f"/api/tournaments/{tid}/heat-rebuild", 200)
    await _replan_schedule(db, tournament, stage)
    return changed


async def _store_plan(db, tournament: dict, stage: dict, ops: list[dict], *, actor_id: str | None, trigger: str) -> dict | None:
    tid = tournament["id"]
    existing = tournament.get("heat_rebuild_plan") if isinstance(tournament.get("heat_rebuild_plan"), dict) else None
    structural = [op for op in ops if op.get("kind") in STRUCTURAL_KINDS]
    if not structural:
        if existing and existing.get("stage_id") == stage.get("id"):
            await db.tournaments.update_one({"id": tid}, {"$set": {"heat_rebuild_plan": None}})
            tournament["heat_rebuild_plan"] = None
        return None
    digest = plan_hash(ops)
    if tournament.get("heat_rebuild_dismissed") == digest:
        if existing:
            await db.tournaments.update_one({"id": tid}, {"$set": {"heat_rebuild_plan": None}})
            tournament["heat_rebuild_plan"] = None
        return None
    if existing and existing.get("hash") == digest:
        return existing
    plan = {
        "id": str(uuid.uuid4()),
        "hash": digest,
        "stage_id": stage.get("id"),
        "ops": ops,
        "summary": describe_plan(ops),
        "created_at": now_utc().isoformat(),
        "trigger": trigger,
    }
    await db.tournaments.update_one({"id": tid}, {"$set": {"heat_rebuild_plan": plan}, "$unset": {"heat_rebuild_dismissed": ""}})
    tournament["heat_rebuild_plan"] = plan
    tournament.pop("heat_rebuild_dismissed", None)
    await _audit(db, "tournament.heats.proposed", tid, actor_id, {
        "engine": GRAPH, "stage_id": stage.get("id"), "plan_id": plan["id"], "trigger": trigger,
        "summary": plan["summary"], "ops": [{k: v for k, v in op.items() if k != "text"} for op in ops],
    })
    await publish_api_change("POST", f"/api/tournaments/{tid}/heat-rebuild", 200)
    return plan


async def _ffa_stages(db, tournament_id: str) -> list[tuple[dict, list[dict]]]:
    stages = await db.tournament_stages.find({"tournament_id": tournament_id}, {"_id": 0}).sort("number", 1).to_list(200)
    rows: list[tuple[dict, list[dict]]] = []
    for stage in stages:
        matches = await db.matches_v2.find({"stage_id": stage["id"]}, {"_id": 0}).sort([("round", 1), ("order", 1)]).to_list(3000)
        if matches and _is_ffa_bracket(matches) and not all(match.get("is_preview") for match in matches):
            rows.append((stage, matches))
    return rows


async def evaluate_heat_rebuild(db, tournament_id: str, *, actor_id: str | None = None, trigger: str = "result") -> dict:
    """Die Prüfung nach jeder Änderung der erwarteten Belegung: Automatik anwenden, Umbau anwenden (``auto``) oder
    vorschlagen (``suggest``). Der Aufrufer hält die Turnier-Schreibsperre."""
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0})
    if not tournament:
        return {"ok": False, "applied": [], "plan": None}
    if trigger == "manual" and (tournament.get("heat_rebuild_pending") or tournament.get("heat_rebuild_incomplete")):
        # „Neu prüfen“ von Hand: Warteschlange und Vermerk zurück - was jetzt gilt, entscheidet diese Prüfung.
        await db.tournaments.update_one({"id": tournament_id}, {"$unset": {"heat_rebuild_pending": "", "heat_rebuild_incomplete": ""}})
        tournament.pop("heat_rebuild_pending", None)
        tournament.pop("heat_rebuild_incomplete", None)
    mode = heat_rebuild_mode(tournament)
    applied: list[dict] = []
    plan = None
    for stage, matches in await _ffa_stages(db, tournament_id):
        rules = stage_heat_rules(stage, matches)
        now_iso = now_utc().isoformat()
        original = {match["id"]: copy.deepcopy(match) for match in matches}
        automatic = rebuild_heats(matches, now_iso=now_iso, structural=False, **rules)
        if automatic["changed_ids"]:
            await _persist(db, tournament, stage, matches, original, automatic["ops"], actor_id=actor_id, trigger=trigger,
                           draws=automatic["draws"])
            applied.extend(automatic["ops"])
            original = {match["id"]: copy.deepcopy(match) for match in matches}
        if mode == "auto":
            full = rebuild_heats(matches, now_iso=now_iso, structural=True, **rules)
            if full["changed_ids"]:
                await _persist(db, tournament, stage, matches, original, full["ops"], actor_id=actor_id, trigger=trigger,
                               draws=full["draws"])
                applied.extend(full["ops"])
            continue
        trial = copy.deepcopy(matches)
        full = rebuild_heats(trial, now_iso=now_iso, structural=True, **rules)
        plan = plan or await _store_plan(db, tournament, stage, full["ops"], actor_id=actor_id, trigger=trigger)
    if tournament.get("heat_rebuild_pending"):
        await db.tournaments.update_one({"id": tournament_id}, {"$unset": {"heat_rebuild_pending": ""}})
    return {"ok": True, "mode": mode, "applied": applied, "plan": plan}


async def confirm_heat_rebuild(db, tournament: dict, plan_id: str | None, *, actor_id: str | None) -> dict:
    """Die Turnierleitung bestätigt den Vorschlag: er wird aus dem aktuellen Stand neu gerechnet und nur angewendet,
    wenn er noch derselbe ist - sonst 409 und der neue Stand liegt als Vorschlag bereit."""
    plan = tournament.get("heat_rebuild_plan") if isinstance(tournament.get("heat_rebuild_plan"), dict) else None
    if not plan or (plan_id and plan.get("id") != plan_id):
        raise HeatRebuildError("Es liegt kein offener Vorschlag mit dieser Kennung vor.", 409)
    tid = tournament["id"]
    for stage, matches in await _ffa_stages(db, tid):
        if stage.get("id") != plan.get("stage_id"):
            continue
        rules = stage_heat_rules(stage, matches)
        original = {match["id"]: copy.deepcopy(match) for match in matches}
        full = rebuild_heats(matches, now_iso=now_utc().isoformat(), structural=True, **rules)
        if plan_hash(full["ops"]) != plan.get("hash"):
            await db.tournaments.update_one({"id": tid}, {"$set": {"heat_rebuild_plan": None}})
            tournament["heat_rebuild_plan"] = None
            fresh = {**tournament, "heat_rebuild_plan": None}
            await _store_plan(db, fresh, stage, full["ops"], actor_id=actor_id, trigger="confirm")
            raise HeatRebuildError("Der Vorschlag ist nicht mehr aktuell - inzwischen hat sich etwas geändert. Bitte neu prüfen.", 409)
        changed = await _persist(db, tournament, stage, matches, original, full["ops"], actor_id=actor_id, trigger="confirm",
                                 plan_id=plan["id"], draws=full["draws"])
        await db.tournaments.update_one({"id": tid}, {"$set": {"heat_rebuild_plan": None}, "$unset": {"heat_rebuild_dismissed": ""}})
        await _audit(db, "tournament.heats.confirmed", tid, actor_id, {"engine": GRAPH, "stage_id": stage.get("id"), "plan_id": plan["id"], "summary": plan.get("summary")})
        return {"ok": True, "applied": full["ops"], "changed_match_ids": changed}
    await db.tournaments.update_one({"id": tid}, {"$set": {"heat_rebuild_plan": None}})
    raise HeatRebuildError("Die Phase des Vorschlags gibt es nicht mehr.", 409)


async def reject_heat_rebuild(db, tournament: dict, plan_id: str | None, *, actor_id: str | None) -> dict:
    """Abgelehnt: die Läufe bleiben, derselbe Vorschlag kommt nicht wieder, solange sich nichts ändert."""
    plan = tournament.get("heat_rebuild_plan") if isinstance(tournament.get("heat_rebuild_plan"), dict) else None
    if not plan or (plan_id and plan.get("id") != plan_id):
        raise HeatRebuildError("Es liegt kein offener Vorschlag mit dieser Kennung vor.", 409)
    tid = tournament["id"]
    await db.tournaments.update_one({"id": tid}, {"$set": {"heat_rebuild_plan": None, "heat_rebuild_dismissed": plan.get("hash")}})
    await _audit(db, "tournament.heats.rejected", tid, actor_id, {"engine": GRAPH, "stage_id": plan.get("stage_id"), "plan_id": plan["id"], "summary": plan.get("summary")})
    await publish_api_change("POST", f"/api/tournaments/{tid}/heat-rebuild", 200)
    return {"ok": True, "rejected": plan["id"]}


async def evaluate_after_write(db, tournament_id: str | None, *, actor_id: str | None, trigger: str) -> dict | None:
    """Für die Schreibwege (Ergebnis, Wertung, Baubau): eine Störung hier darf den Schreibvorgang nicht verlieren.

    Ein Konflikt (ein Lauf hat sich zwischen Lesen und Schreiben geändert) wird einmal frisch wiederholt; bleibt er,
    wird die Auswertung eingereiht (``heat_rebuild_pending`` am Turnier) - der Minuten-Job und die nächste Auswertung
    arbeiten sie ab. Ohne das bliebe ein Umbau nach einer Stationsaktion dauerhaft aus, weil Stationsänderungen keine
    Auswertung auslösen."""
    if not tournament_id:
        return None
    for attempt in (1, 2):
        try:
            return await evaluate_heat_rebuild(db, tournament_id, actor_id=actor_id, trigger=trigger)
        except HeatRebuildError as exc:
            logger.warning("Lauf-Umbau nicht angewendet tournament=%s trigger=%s versuch=%s detail=%s",
                           tournament_id, trigger, attempt, exc.detail)
            detail = exc.detail
        except Exception as exc:  # noqa: BLE001
            logger.exception("Lauf-Umbau fehlgeschlagen tournament=%s trigger=%s type=%s", tournament_id, trigger, type(exc).__name__)
            return None
    current = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "heat_rebuild_pending": 1}) or {}
    pending = current.get("heat_rebuild_pending") if isinstance(current.get("heat_rebuild_pending"), dict) else {}
    if trigger == "pending":
        # Der Takt hat es wieder nicht geschafft: zählen, warten (1, 2, 5, 10 Minuten), nach der Grenze aufhören.
        attempts = int(pending.get("attempts") or 0) + 1
        if attempts >= PENDING_MAX_ATTEMPTS:
            tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0}) or {"id": tournament_id}
            await db.tournaments.update_one({"id": tournament_id}, {"$unset": {"heat_rebuild_pending": ""}})
            await _mark_incomplete(db, tournament, stage_id=None, keys=[], reason="retries_exhausted", actor_id=actor_id,
                                   attempts=attempts, detail=detail)
            return None
        wait = PENDING_BACKOFF_MINUTES[min(attempts, len(PENDING_BACKOFF_MINUTES)) - 1]
        next_at = (now_utc() + timedelta(minutes=wait)).isoformat()
    else:
        attempts = int(pending.get("attempts") or 0)
        next_at = pending.get("next_at") or now_utc().isoformat()
    await db.tournaments.update_one({"id": tournament_id}, {"$set": {"heat_rebuild_pending": {
        "at": pending.get("at") or now_utc().isoformat(), "trigger": pending.get("trigger") or trigger, "detail": detail,
        "attempts": attempts, "next_at": next_at,
    }}})
    return None


PENDING_MAX_ATTEMPTS = 5
PENDING_BACKOFF_MINUTES = (1, 2, 5, 10)


async def process_pending_heat_rebuilds(db) -> int:
    """Eingereihte Auswertungen abarbeiten (Minuten-Job im Scheduler): je Turnier unter der Turnier-Schreibsperre;
    ist sie belegt, kommt das Turnier beim nächsten Lauf dran. Liefert, wie viele Turniere ausgewertet wurden."""
    now_iso = now_utc().isoformat()
    rows = await db.tournaments.find({"heat_rebuild_pending": {"$exists": True}}, {"_id": 0, "id": 1, "heat_rebuild_pending": 1}).to_list(200)
    processed = 0
    for row in rows:
        pending = row.get("heat_rebuild_pending") if isinstance(row.get("heat_rebuild_pending"), dict) else {}
        if str(pending.get("next_at") or "") > now_iso:
            continue
        try:
            async with mutation_lock(db, tournament_write_resource(row["id"])):
                await evaluate_after_write(db, row["id"], actor_id=None, trigger="pending")
                processed += 1
        except MutationLockBusy:
            continue
    return processed
