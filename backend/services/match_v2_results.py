"""Result validation and advancement for matches_v2.

Der Ergebnis-Vertrag (#1035) steht hier an einer Stelle. Jeder Weg zu einem Ergebnis - Ergebnis-Fenster mit
„Rückgängig“, direktes Eintragen, Meldung der Spieler, Wertung „nicht erschienen“ - prüft mit ``checked_results``
bzw. ``normalize_v2_results`` und schreibt über ``submit_v2_result`` (services/v2_result_submission):

- Alle belegten Teilnehmer genau einmal. Werte (Stand, Punkte, Zeit) sind endliche Zahlen ab 0 bis zur Obergrenze
  (``RESULT_MAX_SCORE``, ``RESULT_MAX_TIME_MS``); was keine Zahl ist, ist ein Eingabefehler.
- Der Platz folgt aus dem Stand; ein angegebener Platz zählt nur, wo kein Stand da ist oder der Stand gleich ist.
- Gleichstand nur, wo das Format ihn erlaubt (Tabelle, Gruppe). Im K.-o. braucht gleicher Stand einen Platz, der
  entscheidet - die Reihenfolge der Liste entscheidet nie.
- Best-of (Duell): der Sieger hat genau die nötigen Siege, die Gegenseite weniger; mit „aufgegeben“ oder „nicht
  erschienen“ höchstens so viele, wie gespielt werden konnten. Web und App rechnen gleich (resultEntry).
- Hat ein Spiel schon ein Ergebnis (auch in Klärung), ist jede Änderung eine Korrektur: ``force`` und ein Grund
  (``ensure_correction_allowed``). Setzt sie ein Folgespiel zurück, steht das in der Antwort und in der Historie.
- Fehler sind Eingabefehler (422) oder Konflikte (409); Schreiben ist pro Turnier serialisiert (mutation_lock).
"""
from __future__ import annotations

import math
import uuid
from typing import Any
from collections import defaultdict, deque

from match_rules import RESULT_MAX_SCORE, RESULT_MAX_TIME_MS, match_allows_draw
from services.advancement_draw import (
    ANY_STAGE,
    DRAW_RNG,
    assign_balanced,
    draw_group_of,
    group_sources,
    group_targets,
    match_mode,
)
from services.match_result_errors import MatchResultError
from services.round_labels import section_kind

# Derselbe Fehler, unter dem Namen, unter dem ihn der Graph-Zweig eingeführt hat.
# Beide Engines werfen jetzt dieselbe Klasse, damit ein Aufrufer nicht wissen
# muss, welcher Speicher gerade abgelehnt hat.
MatchV2ResultError = MatchResultError


LOCKED_DOWNSTREAM_STATUSES = {"in_progress", "waiting_result", "disputed", "completed", "forfeit"}
# Ein Spiel in diesem Stand hat ein Ergebnis - es zu ändern ist eine Korrektur.
DECIDED_STATUSES = {"completed", "forfeit"}
CORRECTION_REASON_MIN_LENGTH = 5
CORRECTION_REASON_DETAIL = f"Bitte einen Grund für die Korrektur angeben (mindestens {CORRECTION_REASON_MIN_LENGTH} Zeichen)."
CORRECTION_FORCE_DETAIL = "Dieses Spiel hat schon ein Ergebnis. Zum Korrigieren bitte einen Grund angeben."


def has_result(match: dict) -> bool:
    """Hat das Spiel schon ein Ergebnis - fertig oder in Klärung mit Ergebnis?"""
    return str(match.get("status") or "") in DECIDED_STATUSES or bool(match.get("results"))


def ensure_correction_allowed(match: dict, *, force: bool, reason: str | None) -> None:
    """Ein Spiel mit Ergebnis ändert sich nur als Korrektur: mit ``force`` und Grund - auf jedem Weg gleich."""
    if not has_result(match):
        return
    if not force:
        raise MatchV2ResultError(CORRECTION_FORCE_DETAIL, 409)
    if len((reason or "").strip()) < CORRECTION_REASON_MIN_LENGTH:
        raise MatchV2ResultError(CORRECTION_REASON_DETAIL, 422)


def resolve_best_of(match: dict, stage: dict | None, tournament: dict | None) -> int:
    """Best-of eines Spiels: am Spiel, in seinen Einstellungen, an der Phase oder am Turnier - sonst 1."""
    value = match.get("best_of") or (match.get("settings") or {}).get("best_of") \
        or ((stage or {}).get("settings") or {}).get("best_of") or (tournament or {}).get("best_of") or 1
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return 1


async def result_best_of(db, match: dict) -> int:
    """Best-of für die Prüfung: nur Duelle haben eins."""
    if len(_filled_slots(match)) != 2:
        return 1
    stage = await db.tournament_stages.find_one({"id": match["stage_id"]}, {"_id": 0, "settings": 1}) \
        if match.get("stage_id") else None
    tournament = await db.tournaments.find_one({"id": match["tournament_id"]}, {"_id": 0, "best_of": 1}) \
        if match.get("tournament_id") else None
    return resolve_best_of(match, stage, tournament)


async def checked_results(db, match: dict, raw_results: list[dict]) -> list[dict]:
    """Der Eingang für jedes neue Ergebnis und jede Meldung: der ganze Vertrag samt Best-of des Spiels."""
    return normalize_v2_results(match, raw_results, best_of=await result_best_of(db, match))


def public_recalculation_error(match: dict) -> dict:
    """Return a stable client error without exposing validation internals."""
    return {
        "match_id": match.get("id"),
        "match_key": match.get("match_key"),
        "code": "invalid_result",
        "detail": "Ergebnis konnte nicht sicher neu berechnet werden.",
    }


def _filled_slots(match: dict) -> list[dict]:
    return [
        slot for slot in match.get("slots") or []
        if slot.get("status") == "filled" and slot.get("registration_id")
    ]


def _slot_participant_map(match: dict) -> dict[str, dict]:
    return {slot["registration_id"]: slot for slot in _filled_slots(match)}


def _finite(value: Any, label: str) -> float | None:
    """Eine Zahl aus der Eingabe - endlich und nicht negativ, sonst ein Eingabefehler (nie ein Serverfehler)."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise MatchV2ResultError(f"{label} darf kein Wahrheitswert sein", 422)
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        raise MatchV2ResultError(f"{label} muss eine Zahl sein", 422)
    if not math.isfinite(number):
        raise MatchV2ResultError(f"{label} muss eine endliche Zahl sein", 422)
    if number < 0:
        raise MatchV2ResultError(f"{label} darf nicht negativ sein", 422)
    return number


def _as_number(value: Any) -> int | float | None:
    number = _finite(value, "Stand/Punkte")
    if number is None:
        return None
    if number > RESULT_MAX_SCORE:
        raise MatchV2ResultError(f"Stand/Punkte dürfen höchstens {RESULT_MAX_SCORE} sein", 422)
    if isinstance(value, (int, float)):
        return value
    return int(number) if number.is_integer() else number


def _as_time_ms(value: Any) -> int | None:
    number = _finite(value, "Zeit (time_ms)")
    if number is None:
        return None
    if number > RESULT_MAX_TIME_MS:
        raise MatchV2ResultError(f"Zeit (time_ms) darf höchstens {RESULT_MAX_TIME_MS} sein", 422)
    return int(number)


def _result_score_for_ranking(entry: dict) -> int | float:
    score = _as_number(entry.get("points"))
    if score is None:
        score = _as_number(entry.get("score"))
    if score is None:
        score = 0
    return score


def _time_for_ranking(entry: dict) -> int | float | None:
    return _as_time_ms(entry.get("time_ms"))


def _ranking_mode(match: dict) -> str:
    settings = match.get("settings") or {}
    raw = (settings.get("calculation") or settings.get("score_type") or "points")
    mode = str(raw).strip().lower().replace("-", "_").replace(" ", "_")
    if mode in {"time", "time_ms", "fastest", "fastest_lap", "lowest_time", "best_time"}:
        return "time"
    if mode in {"lower_score", "lowest_score", "low_score", "strokes", "penalty_points"}:
        return "lower_score"
    return "higher_score"


def _placement_key(mode: str, entry: dict) -> tuple:
    """How good this entry is, without any tiebreaker.

    Deliberately without the list position: two entries with the same key are
    genuinely level, and the caller decides whether that is a draw or has to be
    broken.
    """
    if mode == "time":
        time_ms = _time_for_ranking(entry)
        return (
            bool(entry.get("forfeit")),
            bool(entry.get("dnf")),
            time_ms is None,
            time_ms if time_ms is not None else float("inf"),
            -_result_score_for_ranking(entry),
        )
    if mode == "lower_score":
        return (
            bool(entry.get("forfeit")),
            bool(entry.get("dnf")),
            _result_score_for_ranking(entry),
        )
    return (
        bool(entry.get("forfeit")),
        bool(entry.get("dnf")),
        -_result_score_for_ranking(entry),
    )


def _is_measured(entry: dict) -> bool:
    return (
        entry.get("points") is not None
        or entry.get("score") is not None
        or entry.get("time_ms") not in (None, "")
        or bool(entry.get("forfeit"))
        or bool(entry.get("dnf"))
    )


def _has_value(entry: dict) -> bool:
    return entry.get("points") is not None or entry.get("score") is not None or entry.get("time_ms") not in (None, "")


def _rank_by_reported_places(match: dict, raw_results: list[dict]) -> list[dict]:
    """Nur Plätze und „Nicht erschienen“/„Aufgegeben“ (#1156, Zielreihenfolge antippen): die gemeldete Reihenfolge
    zählt, wer nicht erschienen ist oder aufgegeben hat, rückt nach hinten. Ohne diese Regel würden alle anderen
    gleich bewertet - in Gruppen, wo Gleichstand erlaubt ist, stünden dann alle auf Platz 1."""
    allow_draw = match_allows_draw(match)

    def key(item: tuple[int, dict]) -> tuple:
        entry = item[1]
        return (bool(entry.get("forfeit")), bool(entry.get("dnf")), int(entry.get("rank") or 0))

    ordered = sorted(enumerate(raw_results), key=lambda item: (key(item), item[0]))
    next_rows = [dict(entry) for entry in raw_results]
    rank = 0
    previous = None
    for position, item in enumerate(ordered, start=1):
        current = key(item)
        if not (allow_draw and previous is not None and current == previous):
            rank = position
        next_rows[item[0]]["rank"] = rank
        previous = current
    return next_rows


def _auto_rank_results(match: dict, raw_results: list[dict]) -> list[dict]:
    """Derive placements from what was measured.

    The score decides wherever there is one - a reported placement that
    contradicts its own score must not stand, otherwise anyone could rank
    themselves first. But when nothing was measured at all, the reported
    placement is the only information there is; without this a walkover, which
    names the ranking and carries no scores, would come back out as a draw.
    """
    if raw_results and not any(_is_measured(entry) for entry in raw_results) \
            and all(entry.get("rank") is not None for entry in raw_results):
        return [dict(entry) for entry in raw_results]
    if raw_results and all(entry.get("rank") is not None for entry in raw_results) \
            and not any(_has_value(entry) for entry in raw_results):
        return _rank_by_reported_places(match, raw_results)

    mode = _ranking_mode(match)
    allow_draw = match_allows_draw(match)
    ordered = sorted(
        enumerate(raw_results),
        key=lambda item: (_placement_key(mode, item[1]), _stated_rank(item[1]), item[0]),
    )

    next_rows = [dict(entry) for entry in raw_results]
    rank = 0
    previous_key = None
    previous_stated = None
    for position, (index, entry) in enumerate(ordered, start=1):
        key = _placement_key(mode, entry)
        stated = _stated_rank(entry)
        if previous_key is not None and key == previous_key and not allow_draw \
                and (math.isinf(stated) or stated == previous_stated) and not entry.get("forfeit"):
            # Im K.-o. muss jemand weiterkommen - bei gleichem Stand sagt das nur ein angegebener Platz, nie die
            # Reihenfolge der Liste.
            raise MatchV2ResultError(
                "Gleichstand geht in diesem Spiel nicht – eine Seite muss gewinnen. "
                "Bei gleichem Stand bitte den Platz angeben, der entscheidet.", 422)
        # Gleichstand teilt sich den Platz, der nächste rückt entsprechend nach
        # hinten - 1, 1, 3 und nicht 1, 1, 2.
        if not (allow_draw and previous_key is not None and key == previous_key):
            rank = position
        next_rows[index]["rank"] = rank
        previous_key = key
        previous_stated = stated
    return next_rows


def _stated_rank(entry: dict) -> float:
    """Der angegebene Platz - nur zum Entscheiden bei gleichem Stand; ohne Angabe ganz hinten."""
    try:
        return float(int(entry.get("rank")))
    except (TypeError, ValueError):
        return math.inf


# Begründung einer Zeile „nicht erschienen“ im Lauf ohne eigene (#1823) - wie im Ergebnis-Fenster (result_hold).
HEAT_NO_SHOW_NOTE = "Nicht erschienen"


def _with_marked_no_shows(match: dict, raw_results: list[dict], participants: dict[str, dict]) -> list[dict]:
    """„Nicht erschienen“ im Lauf (#1823): wer markiert ist und im Ergebnis fehlt, kommt als nicht erschienen dazu - die
    Rangfolge stellt ihn nach hinten. Eine Zeile „nicht erschienen“ ohne Begründung bekommt die der Markierung (sonst
    „Nicht erschienen“ - die Person sieht sie unter ihren Strafen). Wer markiert ist und doch mit Platz im Ergebnis
    steht, ist gefahren: seine Zeile gilt, wie sie eingetragen ist."""
    marked = [item for item in match.get("no_show_registration_ids") or [] if item in participants]
    if not marked and len(participants) <= 2:
        return raw_results
    notes = match.get("no_show_notes") or {}
    rows = []
    for entry in raw_results:
        registration_id = str(entry.get("registration_id") or "").strip()
        if entry.get("forfeit") and not (entry.get("note") or "").strip():
            entry = {**entry, "note": (notes.get(registration_id) if registration_id in marked else None) or HEAT_NO_SHOW_NOTE}
        rows.append(entry)
    listed = {str(entry.get("registration_id") or "").strip() for entry in raw_results}
    missing = [item for item in marked if item not in listed]
    rows.extend({"registration_id": item, "rank": len(raw_results) + index, "forfeit": True, "note": notes.get(item)}
                for index, item in enumerate(missing, start=1))
    return rows


def _no_show_order(slot: dict) -> tuple:
    """Die Reihenfolge unter mehreren Fehlenden: der Setzplatz, ohne ihn der Sitzplatz im Lauf."""
    source = slot.get("source") or {}
    seed = slot.get("seed") if slot.get("seed") is not None else (source.get("seed") if source.get("type") == "seed" else None)
    try:
        seed = int(seed)
    except (TypeError, ValueError):
        seed = None
    return (seed is None, seed or 0, int(slot.get("slot") or 0))


def _share_last_place(results: list[dict], participants: dict[str, dict]) -> list[dict]:
    """Fehlen mehrere (#1823), teilen sie sich gleichrangig den letzten Platz - nicht nach der Reihenfolge, in der sie
    markiert oder eingetragen wurden. Für das Weiterkommen (Sieger-Weg bzw. Freilos oder Loser Bracket) stehen sie nach
    Setzplatz, sonst nach Sitzplatz (``_placement_positions``)."""
    missing = [row for row in results if row["forfeit"]]
    if len(missing) < 2:
        return results
    shared = len(results) - len(missing) + 1
    for row in missing:
        row["rank"] = shared
    present = [row for row in results if not row["forfeit"]]
    return present + sorted(missing, key=lambda row: _no_show_order(participants.get(row["registration_id"]) or {}))


def _placement_positions(results: list[dict]) -> dict[int, dict]:
    """Platz → Zeile fürs Weiterkommen. Teilen sich mehrere Fehlende den letzten Platz (#1823), zählt ihre Reihenfolge
    im Ergebnis (Setzplatz, sonst Sitzplatz); ein echter Gleichstand (Gruppe, Liga) bleibt beim Platz."""
    by_rank = {int(row.get("rank") or 0): row for row in results}
    if len(by_rank) == len(results):
        return by_rank
    present = [int(row.get("rank") or 0) for row in results if not row.get("forfeit")]
    if len(set(present)) < len(present):
        return by_rank
    ordered = sorted(results, key=lambda row: int(row.get("rank") or 0))
    return {index: row for index, row in enumerate(ordered, start=1)}


def normalize_v2_results(match: dict, raw_results: list[dict], *, best_of: int | None = None) -> list[dict]:
    """Ein Ergebnis nach dem Vertrag prüfen und in die gespeicherte Form bringen (siehe Modulbeschreibung).

    ``best_of``: nur angeben, wo das Spiel bekannt ist (``checked_results``); ohne Angabe keine Best-of-Prüfung - so
    rechnet das Neuberechnen gespeicherter Ergebnisse weiter wie bisher."""
    participants = _slot_participant_map(match)
    if not participants:
        raise MatchV2ResultError("Match hat keine belegten Slots")
    raw_results = _with_marked_no_shows(match, raw_results, participants)
    if len(raw_results) != len(participants):
        raise MatchV2ResultError("Ergebnisliste muss alle belegten Teilnehmer enthalten")
    raw_results = _auto_rank_results(match, raw_results)

    allow_draw = match_allows_draw(match)
    seen_regs: set[str] = set()
    seen_ranks: list[int] = []
    normalized: list[dict] = []
    for entry in raw_results:
        registration_id = (entry.get("registration_id") or "").strip()
        if not registration_id:
            raise MatchV2ResultError("registration_id fehlt in einem Ergebnis")
        if registration_id not in participants:
            raise MatchV2ResultError(f"Teilnehmer {registration_id} ist kein Slot dieses Matches")
        if registration_id in seen_regs:
            raise MatchV2ResultError(f"Teilnehmer {registration_id} kommt mehrfach im Ergebnis vor")
        seen_regs.add(registration_id)
        try:
            rank = int(entry.get("rank"))
        except (TypeError, ValueError):
            raise MatchV2ResultError("Rank muss eine Zahl sein")
        if rank < 1:
            raise MatchV2ResultError("Rank muss größer 0 sein")
        if rank in seen_ranks and not allow_draw:
            raise MatchV2ResultError(f"Rank {rank} ist mehrfach vergeben")
        seen_ranks.append(rank)
        time_ms = _as_time_ms(entry.get("time_ms"))
        normalized.append({
            "registration_id": registration_id,
            "user_id": participants[registration_id].get("user_id"),
            "slot": participants[registration_id].get("slot"),
            "rank": rank,
            "score": _as_number(entry.get("score")),
            "points": _as_number(entry.get("points")),
            "time_ms": time_ms,
            "dnf": bool(entry.get("dnf")),
            "forfeit": bool(entry.get("forfeit")),
            "note": (entry.get("note") or "").strip() or None,
        })

    _validate_placements(seen_ranks, len(participants), allow_draw)
    normalized = _share_last_place(sorted(normalized, key=lambda item: item["rank"]), participants)
    if _ranking_mode(match) == "higher_score":
        _check_best_of(normalized, best_of)
    return normalized


def _check_best_of(results: list[dict], best_of: int | None) -> None:
    """Best-of im Duell, wie Web und App es eingeben (resultEntry.bestOfResults): der Stand sind gewonnene Spiele.
    Nur wo der höhere Stand gewinnt - nach Zeit oder niedrigstem Stand geben Web und App kein Best-of ein (inputKind)."""
    if not best_of or best_of <= 1 or len(results) != 2:
        return
    values = [row["score"] if row.get("score") is not None else row.get("points") for row in results]
    if all(value is None for value in values):
        return
    needed = best_of // 2 + 1
    prefix = f"Best of {best_of}: "
    if any(value is None or float(value) != int(value) for value in values):
        raise MatchV2ResultError(prefix + "bitte je Seite die gewonnenen Spiele als ganze Zahl angeben.", 422)
    winner, loser = (int(value) for value in values)
    if max(winner, loser) > needed or winner + loser > best_of:
        raise MatchV2ResultError(
            prefix + f"höchstens {needed} gewonnene Spiele je Seite und {best_of} Spiele insgesamt.", 422)
    flagged = any(row.get("dnf") or row.get("forfeit") for row in results)
    if not flagged and (winner != needed or loser >= needed):
        raise MatchV2ResultError(prefix + f"der Sieger braucht genau {needed} gewonnene Spiele.", 422)


def _validate_placements(ranks: list[int], participant_count: int, allow_draw: bool) -> None:
    """Check the placements form a ranking, with or without shared places.

    Without draws that means exactly 1..n. With draws it means the usual
    convention: whoever ties shares a place and the next one skips ahead, so
    1, 1, 3 is a ranking and 1, 1, 2 is not.
    """
    if not allow_draw:
        expected = set(range(1, participant_count + 1))
        missing = ", ".join(str(rank) for rank in sorted(expected - set(ranks)))
        if set(ranks) != expected:
            raise MatchV2ResultError(
                f"Ranks müssen fortlaufend 1-{participant_count} sein; fehlt: {missing}")
        return

    previous = None
    for position, rank in enumerate(sorted(ranks), start=1):
        if previous is not None and rank == previous:
            continue
        if rank != position:
            raise MatchV2ResultError(
                f"Platz {rank} passt nicht: bei Gleichstand teilen sich die Beteiligten "
                "den Platz und der nächste rückt entsprechend nach hinten."
            )
        previous = rank


def is_v2_result_replay(
    match: dict,
    raw_results: list[dict],
    *,
    proof_url: str | None = None,
    note: str | None = None,
) -> bool:
    """Return whether a completed match already contains this exact result.

    This comparison is intentionally independent of the actor and ``force``:
    permissions are checked by the route first, while an exact retry must not
    create another report, audit entry, notification, or advancement update.
    """
    if match.get("status") != "completed":
        return False
    try:
        normalized = normalize_v2_results(match, raw_results)
    except MatchV2ResultError:
        return False
    meta = match.get("result_meta") or {}
    return (
        normalized == (match.get("results") or [])
        and ((proof_url or "").strip() or None) == meta.get("proof_url")
        and ((note or "").strip() or None) == meta.get("note")
    )


def _target_lookup(stage_matches: list[dict]) -> tuple[dict[str, dict], dict[str, dict]]:
    by_id = {match["id"]: match for match in stage_matches if match.get("id")}
    by_key = {match["match_key"]: match for match in stage_matches if match.get("match_key")}
    return by_id, by_key


def _find_slot(match: dict, slot_number: int) -> dict | None:
    for slot in match.get("slots") or []:
        if int(slot.get("slot") or 0) == int(slot_number):
            return slot
    return None


def _advancement_result_rank(match: dict, advancement: dict) -> int:
    rank = int(advancement.get("rank") or 0)
    if advancement.get("flow") != "L":
        return rank

    settings = match.get("settings") or {}
    if "qualifiers_per_match" not in settings:
        return rank

    match_size = int(settings.get("match_size") or len(match.get("slots") or []) or 0)
    if match_size <= 0:
        return rank
    qualifiers = max(0, min(int(settings.get("qualifiers_per_match") or 0), match_size))
    loser_count = max(0, match_size - qualifiers)
    if 1 <= rank <= loser_count:
        return qualifiers + rank

    # Backward compatibility for old schemas that used L:<match>:<absolute rank>.
    return rank


def _rank_can_be_missing_because_of_bye(match: dict, result_rank: int) -> bool:
    settings = match.get("settings") or {}
    match_size = int(settings.get("match_size") or len(match.get("slots") or []) or 0)
    return 1 <= result_rank <= match_size


def _downstream_links(stage_matches: list[dict]) -> dict[str, list[tuple[str, int]]]:
    links: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for match in stage_matches:
        match_id = match.get("id")
        if not match_id:
            continue
        for slot in match.get("slots") or []:
            source = slot.get("source_result") or {}
            source_match_id = source.get("from_match_id")
            if source_match_id:
                links[source_match_id].append((match_id, int(slot.get("slot") or 0)))
    return links


def _clear_slot(slot: dict) -> bool:
    had_value = bool(slot.get("registration_id") or slot.get("user_id") or slot.get("source_result"))
    slot["registration_id"] = None
    slot["user_id"] = None
    slot["source_result"] = None
    slot["status"] = "pending"
    return had_value


def _status_after_slot_fill(match: dict, preserve_terminal: bool = True) -> str:
    current = match.get("status") or "pending"
    if preserve_terminal and current in {"completed", "forfeit", "cancelled"}:
        return current
    slots = match.get("slots") or []
    filled = [slot for slot in slots if slot.get("status") == "filled" and slot.get("registration_id")]
    pending = [slot for slot in slots if slot.get("status") == "pending"]
    min_players = int((match.get("settings") or {}).get("min_players") or 2)
    if not pending and len(filled) >= min_players:
        return "ready"
    return "pending"


AUTO_BYE_NOTE = "Auto-Advance durch Bye"
RESET_NOT_NEEDED_NOTE = "Kein Reset nötig – der Sieger der Siegerrunde hat das Grand Final gewonnen."


def _effective_status(match: dict, target_sets: dict[str, dict]) -> str:
    """Der Stand, der nach dem Schreiben gilt: was ``target_sets`` schon vorsieht, sonst der gespeicherte."""
    return str(target_sets.get(match.get("id") or "", {}).get("status") or match.get("status") or "pending")


def _mark_slot_bye(slot: dict, source_match: dict, rank: int, flow: str | None, now_iso: str,
                   reason: str = "bye") -> None:
    slot["registration_id"] = None
    slot["user_id"] = None
    slot["source_result"] = {
        "from_match_id": source_match["id"],
        "from_match_key": source_match.get("match_key"),
        "rank": rank,
        "flow": flow,
        "skipped": True,
        "reason": reason,
        "confirmed_at": now_iso,
    }
    slot["status"] = "bye"


# Ein Platz, den eine Disqualifikation oder ein Austritt (#1553) geleert hat, trägt den Grund und die Person.
REMOVAL_REASONS = {"withdrawn", "disqualified"}


def _removal_marker(match: dict) -> dict | None:
    """Der Freilos-Platz dieses Spiels, der durch Disqualifikation oder Austritt frei wurde - wenn es einen gibt."""
    for slot in match.get("slots") or []:
        source_result = slot.get("source_result") or {}
        if slot.get("status") == "bye" and source_result.get("reason") in REMOVAL_REASONS:
            return source_result
    return None


def _auto_bye_result(winner: dict, now_iso: str) -> dict:
    return {
        "registration_id": winner.get("registration_id"),
        "user_id": winner.get("user_id"),
        "slot": winner.get("slot"),
        "rank": 1,
        "score": None,
        "points": None,
        "time_ms": None,
        "dnf": False,
        "forfeit": False,
        "note": AUTO_BYE_NOTE,
        "reported_by": "system",
        "reported_at": now_iso,
    }


# ---------------------------------------------------------------------------------------------- Auslosung (#1548)

DECIDED_OR_VOID = DECIDED_STATUSES | {"cancelled"}


def _draw_open_targets(by_id: dict[str, dict], group: str, stage_id=ANY_STAGE) -> list[dict]:
    return [target for target in group_targets(by_id.values(), group, stage_id) if target.get("status") != "cancelled"]


def _group_is_drawn(targets: list[dict]) -> bool:
    return any(isinstance(target.get("draw"), dict) for target in targets)


def _draw_started(target: dict) -> bool:
    """Hat ein Spiel der Gruppe begonnen (oder ist entschieden)? Dann gilt das Los - neu auslosen geht nicht mehr."""
    return (
        str(target.get("status") or "") in LOCKED_DOWNSTREAM_STATUSES
        or bool(target.get("results"))
        or bool(target.get("started_at"))
        or bool(target.get("called_at"))
        or bool(target.get("reports"))
        or isinstance(target.get("pending_result"), dict)
    )


def _drawn_slot(targets: list[dict], source_id: str, flow: str | None, ranks: set[int]) -> tuple[dict, dict] | None:
    """Der ausgeloste Platz eines Weiterkommers (Quelle, Weg, Platz) - für Korrekturen nach der Auslosung."""
    for target in targets:
        for slot in target.get("slots") or []:
            origin = slot.get("source_result") or {}
            if origin.get("from_match_id") == source_id and origin.get("flow") == flow \
                    and int(origin.get("rank") or 0) in ranks:
                return target, slot
    return None


def _free_draw_slot(targets: list[dict], rng=None) -> tuple[dict, dict] | None:
    """Nach Rückgängig oder Korrektur-Kaskade fehlt die Herkunft eines Platzes: ein freier Platz der Gruppe."""
    free = [
        (target, slot) for target in targets for slot in target.get("slots") or []
        if (slot.get("source") or {}).get("type") == "rank" and slot.get("status") == "pending"
        and not slot.get("registration_id") and not slot.get("source_result")
    ]
    return (rng or DRAW_RNG).choice(free) if free else None


def _is_instant(target: dict | None) -> bool:
    """Sofort zufällig (#1590): die Gruppe kennt kein Los je Runde, jeder Platz wird für sich gezogen."""
    return match_mode(target) == "instant"


def _locate_target_slot(advancement: dict, target: dict, by_id: dict[str, dict], source_id: str,
                        result_rank: int, rng=None, rewired: list[dict] | None = None) -> tuple[dict, dict | None, tuple | None]:
    """Wohin ein Weiterkommer geht: fester Baum - der Platz aus dem Schema; gemischt - vor der Auslosung noch nirgends
    (Rückgabe mit Phase und Gruppe), danach sein ausgeloster Platz. Sofort zufällig (#1590): sein schon gezogener
    Platz (Korrektur: der Platz bleibt, die Person wechselt), sonst gleich ein zufälliger freier Platz der Gruppe -
    das Schema folgt dem Los (``_rewire_instant``; die dabei geänderten Spiele kommen in ``rewired``)."""
    group = draw_group_of(target)
    if not group or (target.get("status") == "cancelled" and not _is_instant(target)):
        return target, _find_slot(target, int(advancement.get("to_slot") or 0)), None
    targets = _draw_open_targets(by_id, group, target.get("stage_id"))
    ranks = {int(result_rank), int(advancement.get("rank") or 0)}
    if _is_instant(target):
        found = _drawn_slot(targets, source_id, advancement.get("flow"), ranks) or _free_draw_slot(targets, rng)
        if not found:
            return target, None, None
        source = by_id.get(source_id) or {}
        for row in _rewire_instant(source, advancement, found[0], found[1], by_id):
            if rewired is not None:
                rewired.append(row)
        return found[0], found[1], None
    if not _group_is_drawn(targets):
        return target, None, (target.get("stage_id"), group)
    found = _drawn_slot(targets, source_id, advancement.get("flow"), ranks) or _free_draw_slot(targets, rng)
    if not found:
        return target, None, None
    return found[0], found[1], None


def _feeder_of(target: dict, slot: dict, by_id: dict[str, dict]) -> tuple[dict, dict] | None:
    """Der Weiterleitungs-Eintrag (Quelle, Eintrag), der im Schema auf diesen Platz zeigt - der, dessen Identität
    (Spiel, Weg, Rang) zur Quelle des Platzes passt. Ein veralteter Eintrag eines längst entschiedenen Spiels, der
    nach einem Umbau zufällig auf dieselbe Platznummer zeigt, zählt nicht."""
    identity = slot.get("source") or {}
    found: list[tuple[dict, dict]] = []
    for source in by_id.values():
        for entry in source.get("advancement") or []:
            if entry.get("to_match_id") == target.get("id") and int(entry.get("to_slot") or 0) == int(slot.get("slot") or 0):
                if (source.get("match_key") == identity.get("match_key") and entry.get("flow") == identity.get("flow")
                        and int(entry.get("rank") or 0) == int(identity.get("rank") or 0)):
                    return source, entry
                found.append((source, entry))
    live = [pair for pair in found if str(pair[0].get("status") or "") not in DECIDED_OR_VOID]
    return (live or found or [None])[0]


def _rewire_instant(source: dict, advancement: dict, target: dict, slot: dict, by_id: dict[str, dict]) -> list[dict]:
    """Sofort zufällig (#1590): **das Schema folgt dem Los.** Landet der Weiterkommer auf Platz Y statt auf seinem
    Schema-Platz X, tauschen die beiden Einträge die Ziele (seiner zeigt auf Y, der von Y auf X) und die Plätze ihre
    Quellen (``source``, der Klartext „Platz aus Runde 1“ bleibt). Danach ist der Baum wieder ein stimmiger fester
    Baum: Lauf-Umbau, Quote, Freilos-Kette und Graph-Prüfung brauchen keinen Sonderfall. Rückgabe: die Spiele, deren
    ``advancement`` oder Plätze sich geändert haben (außer ``target`` und ``source`` selbst)."""
    old_target = by_id.get(advancement.get("to_match_id"))
    old_slot = _find_slot(old_target, int(advancement.get("to_slot") or 0)) if old_target else None
    if old_target is None or old_slot is None or (old_target is target and old_slot is slot):
        return []
    changed: list[dict] = []
    feeder = _feeder_of(target, slot, by_id)
    advancement.update({"to_match_id": target["id"], "to_match_key": target.get("match_key"), "to_slot": int(slot.get("slot") or 0)})
    if feeder:
        other_source, other_entry = feeder
        other_entry.update({"to_match_id": old_target["id"], "to_match_key": old_target.get("match_key"),
                            "to_slot": int(old_slot.get("slot") or 0)})
        if other_source is not source:
            changed.append(other_source)
    mine, theirs = dict(slot.get("source") or {}), dict(old_slot.get("source") or {})
    draw_mark = mine.get("draw") or theirs.get("draw")
    slot["source"] = {**theirs, **({"draw": draw_mark} if draw_mark else {})}
    old_slot["source"] = {**mine, **({"draw": draw_mark} if draw_mark else {})}
    if old_target is not target:
        changed.append(old_target)
    return changed


def _record_rewired(source: dict, rewired: list[dict], target_sets: dict[str, dict], now_iso: str) -> None:
    """Was ``_rewire_instant`` geändert hat, kommt mit: Weiterleitungen fremder Quellen, Plätze des alten Zielspiels -
    und die eigene Weiterleitung (unter der eigenen Kennung, die Aufrufer übernehmen sie in ``match_set``)."""
    if not rewired:
        return
    for row in rewired:
        target_sets.setdefault(row["id"], {}).update({
            **({"advancement": row.get("advancement") or []} if row.get("advancement") is not None else {}),
            "slots": row.get("slots") or [],
            "updated_at": now_iso,
        })
    target_sets.setdefault(source["id"], {}).update({"advancement": source.get("advancement") or [], "updated_at": now_iso})


def _note_instant_assignment(target: dict, slot: dict, source: dict, now_iso: str, draws: list[dict] | None,
                             trigger: str = "result") -> None:
    """Sofort zufällig (#1590): ein frisch gezogener Platz bekommt seine Los-Kennung; je Zuweisung ein Eintrag für
    Protokoll und Live-Ereignis (``kind: instant``). Eine Korrektur auf demselben Platz behält die Kennung - kein
    neues Los."""
    if not _is_instant(target) or not draw_group_of(target):
        return
    origin = slot.get("source_result") or {}
    if origin.get("draw_id"):
        return
    draw_id = str(uuid.uuid4())
    origin["draw_id"] = draw_id
    origin["drawn_at"] = now_iso
    slot["source_result"] = origin
    if draws is not None:
        draws.append({
            "id": draw_id, "group": draw_group_of(target), "kind": "instant", "trigger": trigger, "drawn_at": now_iso,
            "stage_id": target.get("stage_id"), "tournament_id": target.get("tournament_id"),
            "assignments": [{
                "match_id": target["id"], "match_key": target.get("match_key"), "slot": int(slot.get("slot") or 0),
                "registration_id": slot.get("registration_id"), "from_match_key": source.get("match_key"),
                "rank": origin.get("rank"), "flow": origin.get("flow"),
            }],
        })


def _pot_ranks(source: dict, results: list[dict], gone: set[str]) -> tuple[dict[int, dict], dict[int, dict]]:
    """Wer auf welchem Platz steht - für Verlierer- und Sieger-Weg; im Lauf ohne Ausgeschiedene (#1553: die Nächsten
    rücken auf, wie in ``build_v2_result_application``; wer auf dem Sieger-Weg aufrückt, kommt nicht zugleich in den
    Topf des Loser Bracket, #1823)."""
    by_rank = _placement_positions(results)
    if not gone or source.get("match_type") != "ffa":
        return by_rank, by_rank
    staying = [row for row in sorted(results, key=lambda row: int(row.get("rank") or 0))
               if row.get("registration_id") not in gone]
    moved_up = {index: row for index, row in enumerate(staying, start=1)}
    return moved_up, moved_up


def _group_is_ready(targets: list[dict]) -> bool:
    """Show-Auslosung (#1590): die Runde ist fertig, der Topf steht - die Turnierleitung lost per Tipp."""
    return any(isinstance(target.get("draw_ready"), dict) for target in targets)


def _mark_group_ready(group: str, targets: list[dict], target_sets: dict[str, dict], now_iso: str, pot_size: int,
                      draws: list[dict] | None, trigger: str) -> None:
    marker = {"group": group, "since": now_iso, "pot_size": pot_size}
    for target in targets:
        target["draw_ready"] = dict(marker)
        target["updated_at"] = now_iso
        target_sets.setdefault(target["id"], {}).update({"draw_ready": dict(marker), "updated_at": now_iso})
    if draws is not None:
        draws.append({"id": str(uuid.uuid4()), "group": group, "kind": "ready", "trigger": trigger, "drawn_at": now_iso,
                      "stage_id": targets[0].get("stage_id"), "tournament_id": targets[0].get("tournament_id"),
                      "pot_size": pot_size, "match_ids": [target["id"] for target in targets], "assignments": []})


def run_draw(group: str, by_id: dict[str, dict], target_sets: dict[str, dict], now_iso: str, *,
             stage_id=ANY_STAGE, decided_results: dict[str, list[dict]] | None = None, rng=None,
             draws: list[dict] | None = None, trigger: str = "result", eliminated: set[str] | None = None,
             force: bool = False) -> list[str]:
    """Die Auslosung einer Gruppe, sobald **alle** Quellspiele entschieden sind (gespielt, gewertet, kampflos oder
    abgesagt). Der Topf: je Weiterleitung in die Gruppe der Teilnehmer auf diesem Platz - oder ein Freilos, wo es ihn
    nicht gibt. ``assign_balanced`` verteilt gleichmäßig. ``decided_results``: Ergebnisse, die noch nicht am Spiel
    stehen (das gerade eingetragene). ``stage_id``: die Phase der Gruppe - ``by_id`` darf mehrere Phasen enthalten,
    gelost wird nur in dieser. Rückgabe: die Folgespiele, die jetzt besetzt sind.

    Wie im festen Baum (#1553): wer ausgeschieden ist (``eliminated`` oder am Ergebnis als ``eliminated`` vermerkt)
    oder auf dem Sieger-Weg nicht erschienen ist, kommt nicht in den Topf - sein Platz wird ein Freilos.

    Modi (#1590): ``instant`` lost nie je Runde (jeder Platz für sich, ``_locate_target_slot``). ``draw_show`` legt
    ohne ``force`` kein Los, sondern merkt die Runde als „bereit“ (``draw_ready``, Eintrag ``kind: ready``); mit
    ``force`` („Jetzt auslosen“, Zeitablauf) wird gelost und die Marke geht weg."""
    decided_results = decided_results or {}
    targets = _draw_open_targets(by_id, group, stage_id)
    if not targets or _group_is_drawn(targets) or _is_instant(targets[0]):
        return []
    sources = sorted(group_sources(by_id.values(), group, stage_id),
                     key=lambda row: (row.get("round") or 0, row.get("order") or 0))
    if not all(row["id"] in decided_results or str(row.get("status") or "") in DECIDED_OR_VOID for row in sources):
        return []
    target_ids = {target["id"] for target in targets}
    entries: list[dict] = []
    slots_by_target: dict[str, list[int]] = defaultdict(list)
    for source in sources:
        if source["id"] in decided_results:
            results = decided_results[source["id"]]
        else:
            results = [] if source.get("status") == "cancelled" else source.get("results") or []
        gone = set(eliminated or ()) | {row.get("registration_id") for row in results if row.get("eliminated")}
        by_rank, winner_path = _pot_ranks(source, results, gone)
        for advancement in source.get("advancement") or []:
            target = by_id.get(advancement.get("to_match_id"))
            if not target or target["id"] not in target_ids:
                continue
            slot = _find_slot(target, int(advancement.get("to_slot") or 0))
            if not slot or (slot.get("source") or {}).get("type") != "rank":
                continue
            slots_by_target[target["id"]].append(int(slot.get("slot") or 0))
            rank = _advancement_result_rank(source, advancement)
            flow = advancement.get("flow")
            result = (winner_path if flow == "W" else by_rank).get(rank)
            reason = "bye"
            if result and result.get("registration_id") in gone:
                result, reason = None, "eliminated"
            elif result and flow == "W" and result.get("forfeit"):
                result, reason = None, "forfeit"
            entries.append({
                "registration_id": (result or {}).get("registration_id"),
                "user_id": (result or {}).get("user_id"),
                "rank": int(result["rank"]) if result else rank,
                "flow": flow,
                "source": source,
                "reason": reason,
            })
    if not entries:
        return []
    if match_mode(targets[0]) == "draw_show" and not force:
        if not _group_is_ready(targets):
            _mark_group_ready(group, targets, target_sets, now_iso, sum(1 for entry in entries if entry.get("registration_id")),
                              draws, trigger)
        return []
    draw_id = str(uuid.uuid4())
    ordered_targets = sorted(targets, key=lambda row: (row.get("order") or 0, row.get("match_key") or ""))
    placed = assign_balanced(entries, [(target["id"], slots_by_target[target["id"]]) for target in ordered_targets
                                       if slots_by_target.get(target["id"])], rng)
    assignments = []
    for target_id, slot_no, entry in placed:
        target = by_id[target_id]
        slot = _find_slot(target, slot_no)
        source = entry["source"] if entry else None
        if entry and entry.get("registration_id"):
            slot["registration_id"] = entry["registration_id"]
            slot["user_id"] = entry.get("user_id")
            slot["source_result"] = {
                "from_match_id": source["id"],
                "from_match_key": source.get("match_key"),
                "rank": entry["rank"],
                "flow": entry["flow"],
                "confirmed_at": now_iso,
                "draw_id": draw_id,
            }
            slot["status"] = "filled"
        elif entry:
            _mark_slot_bye(slot, source, entry["rank"], entry["flow"], now_iso, reason=entry.get("reason") or "bye")
            slot["source_result"]["draw_id"] = draw_id
        assignments.append({
            "match_id": target_id,
            "match_key": target.get("match_key"),
            "slot": slot_no,
            "registration_id": (entry or {}).get("registration_id"),
            "from_match_key": source.get("match_key") if source else None,
            "rank": (entry or {}).get("rank"),
            "flow": (entry or {}).get("flow"),
        })
    marker = {"id": draw_id, "group": group, "drawn_at": now_iso, "trigger": trigger}
    was_ready = _group_is_ready(targets)
    for target in targets:
        target["draw"] = dict(marker)
        target["status"] = _status_after_slot_fill({**target, "status": _effective_status(target, target_sets)})
        target["updated_at"] = now_iso
        if was_ready:
            target["draw_ready"] = None
        target_sets.setdefault(target["id"], {}).update({
            "slots": target.get("slots") or [],
            "status": target["status"],
            "draw": dict(marker),
            "updated_at": now_iso,
            **({"draw_ready": None} if was_ready else {}),
        })
    if draws is not None:
        draws.append({**marker, "kind": "advancement", "stage_id": targets[0].get("stage_id"),
                      "tournament_id": targets[0].get("tournament_id"), "assignments": assignments})
    return [target["id"] for target in targets]


def group_awaits_draw(matches, group: str | None, stage_id=ANY_STAGE) -> bool:
    """Ist die Gruppe (in dieser Phase) noch nicht ausgelost? Dann sind ihre Plätze offen, obwohl Quellen schon
    entschieden sein können - für den Lauf-Umbau (#1550) heißt das: nicht anfassen, die Plätze kommen mit der
    Auslosung."""
    if not group:
        return False
    targets = [row for row in group_targets(matches, group, stage_id) if row.get("status") != "cancelled"]
    # Sofort zufällig (#1590): die Plätze füllen sich einzeln, nichts wartet auf ein Los je Runde.
    return bool(targets) and not _is_instant(targets[0]) and not _group_is_drawn(targets)


def run_ready_draws(by_id: dict[str, dict], target_sets: dict[str, dict], now_iso: str, *, rng=None,
                    draws: list[dict] | None = None, trigger: str = "walkover") -> list[str]:
    """Jede noch offene Auslosung, deren Runde inzwischen ganz entschieden ist - etwa weil der Lauf-Umbau den letzten
    offenen Lauf abgesagt hat. Je Phase und Gruppe eine eigene Auslosung. Rückgabe: die jetzt besetzten Folgespiele."""
    scopes = {(row.get("stage_id"), group) for row in by_id.values() if (group := draw_group_of(row))}
    drawn: list[str] = []
    for stage_id, group in sorted(scopes, key=lambda scope: (str(scope[0] or ""), scope[1])):
        drawn.extend(run_draw(group, by_id, target_sets, now_iso, stage_id=stage_id, rng=rng, draws=draws,
                              trigger=trigger))
    return drawn


def resolve_walkovers(start_ids: list[str], by_id: dict[str, dict], target_sets: dict[str, dict], now_iso: str,
                      *, rng=None, draws: list[dict] | None = None, draw_now: bool = True) -> None:
    """Die Freilos-Kette (#1549): ein Spiel ohne offenen Zufluss und mit höchstens einem Teilnehmer ist entschieden.

    Genau ein Teilnehmer: er kommt kampflos weiter - nur den Sieger-Weg (``W`` Platz 1); jeder andere Weg (Verlierer
    ins Loser Bracket, Spiel um Platz 3, weitere Plätze) bekommt ein Freilos, denn es gibt niemanden, der verloren
    hätte. Kein Teilnehmer (nur Freilose): das Spiel entfällt und gibt alle Wege als Freilos weiter. Beides läuft
    rekursiv in die Folgespiele - beim Bau des Baums und nach jedem Ergebnis. Was sich ändert, steht danach in
    ``target_sets`` und in den Spielen selbst."""
    queue = deque(start_ids)
    seen: set[str] = set()
    by_key = {row.get("match_key"): row for row in by_id.values() if row.get("match_key")}
    while queue:
        match_id = queue.popleft()
        match = by_id.get(match_id)
        if not match or match_id in seen:
            continue
        seen.add(match_id)
        status = _effective_status(match, target_sets)
        if match.get("is_preview") or status in LOCKED_DOWNSTREAM_STATUSES or status == "cancelled":
            continue
        slots = match.get("slots") or []
        if not slots or any(slot.get("status") == "pending" for slot in slots):
            continue
        filled = _filled_slots(match)
        if len(filled) > 1 or not any(slot.get("status") == "bye" for slot in slots):
            continue
        winner = filled[0] if filled else None
        # Kampflos nach Disqualifikation oder Austritt (#1553): der Grund und die entfernte Person stehen am Ergebnis.
        marker = _removal_marker(match) if winner else None
        change = {
            "results": [_auto_bye_result(winner, now_iso)] if winner else [],
            "status": "completed" if winner else "cancelled",
            "result_meta": {"source": "auto_bye", "updated_at": now_iso,
                            **({} if winner else {"reason": "no_participants"}),
                            **({"reason": marker["reason"], "removed_registration_id": marker.get("removed_registration_id")}
                               if marker else {})},
            "completed_at": now_iso if winner else None,
            "completed_by": "system" if winner else None,
            "updated_at": now_iso,
        }
        match.update(change)
        target_sets.setdefault(match_id, {}).update(change)
        waiting_groups: list[tuple] = []
        for advancement in match.get("advancement") or []:
            target = by_id.get(advancement.get("to_match_id"))
            if not target:
                continue
            rank = int(advancement.get("rank") or 0)
            rewired: list[dict] = []
            target, target_slot, waiting = _locate_target_slot(advancement, target, by_id, match_id, rank, rng, rewired)
            _record_rewired(match, rewired, target_sets, now_iso)
            if waiting:
                # Gemischt (#1548): ausgelost wird erst, wenn die ganze Runde entschieden ist.
                if waiting not in waiting_groups:
                    waiting_groups.append(waiting)
                continue
            if not target_slot:
                continue
            kept_draw_id = (target_slot.get("source_result") or {}).get("draw_id")
            if winner and advancement.get("flow") == "W" and rank == 1:
                target_slot["registration_id"] = winner.get("registration_id")
                target_slot["user_id"] = winner.get("user_id")
                target_slot["source_result"] = {
                    "from_match_id": match_id,
                    "from_match_key": match.get("match_key"),
                    "rank": 1,
                    "flow": "W",
                    "confirmed_at": now_iso,
                    **({"draw_id": kept_draw_id} if kept_draw_id else {}),
                }
                target_slot["status"] = "filled"
            else:
                _mark_slot_bye(target_slot, match, rank, advancement.get("flow"), now_iso)
                if kept_draw_id:
                    target_slot["source_result"]["draw_id"] = kept_draw_id
            _note_instant_assignment(target, target_slot, match, now_iso, draws, trigger="walkover")
            target["status"] = _effective_status(target, target_sets)
            target["status"] = _status_after_slot_fill(target)
            target["updated_at"] = now_iso
            target_sets.setdefault(target["id"], {}).update({
                "slots": target.get("slots") or [],
                "status": target["status"],
                "updated_at": now_iso,
            })
            # Ein Folgespiel, das in dieser Kette schon einmal besucht wurde (damals mit offenem Platz), wird mit dem
            # neuen Platz noch einmal angesehen - sonst bliebe ein Spiel mit einem Teilnehmer und einem Freilos offen.
            seen.discard(target["id"])
            queue.append(target["id"])
        if winner:
            # Ein kampflos entschiedenes Grand Final (#1553) durchläuft die Reset-Regel wie ein gespieltes: gewinnt die
            # Siegerrunde, entfällt das Reset-Spiel („nicht nötig“) statt selbst zum Freilos zu werden; gewinnt die
            # Verliererrunde, ist es nötig und wird in der Kette ebenfalls kampflos entschieden.
            _apply_bracket_reset_rule(match, change["results"], by_id, by_key, target_sets, now_iso)
        for stage_id, group in waiting_groups if draw_now else []:
            for drawn_id in run_draw(group, by_id, target_sets, now_iso, stage_id=stage_id, rng=rng, draws=draws,
                                     trigger="walkover"):
                seen.discard(drawn_id)
                queue.append(drawn_id)


def _came_from_lower_side(slot: dict | None, by_key: dict[str, dict], upper_slot: int) -> bool:
    """Kam der Finalist aus der Verliererrunde? Die Herkunft des Platzes zählt (mit Zufallsmischung kann der Sieger
    der Siegerrunde auf jedem Platz sitzen): ein ``L``-Weg oder ein Quellspiel im Loser Bracket. Ohne Herkunft gilt
    die Platznummer aus dem Schema."""
    if not slot:
        return False
    for origin in (slot.get("source_result") or {}, slot.get("source") or {}):
        flow = origin.get("flow")
        source = by_key.get(str(origin.get("from_match_key") or origin.get("match_key") or ""))
        if flow in ("W", "L", "R"):
            return flow == "L" or (source is not None and section_kind(source.get("section")) == "loser")
    return int(slot.get("slot") or 0) != upper_slot


def _apply_bracket_reset_rule(match: dict, results: list[dict], by_id: dict[str, dict], by_key: dict[str, dict],
                              target_sets: dict[str, dict], now_iso: str) -> None:
    """Grand Final Reset (#1549): das Reset-Spiel zu diesem Spiel wird nur gespielt, wenn der Spieler aus der
    Verliererrunde gewinnt - sonst entfällt es, sauber abgeschlossen für Tabelle und Platzierungen."""
    winner_slot = next((int(row.get("slot") or 0) for row in results if int(row.get("rank") or 0) == 1), None)
    for advancement in match.get("advancement") or []:
        target = by_id.get(advancement.get("to_match_id"))
        rule = ((target or {}).get("settings") or {}).get("bracket_reset") or {}
        if not target or rule.get("of_match_key") != match.get("match_key"):
            continue
        needed = winner_slot is not None and _came_from_lower_side(
            _find_slot(match, winner_slot), by_key, int(rule.get("upper_slot") or 1))
        change = {
            "status": _status_after_slot_fill(target, preserve_terminal=False) if needed else "cancelled",
            "results": [] if not needed else target.get("results") or [],
            "result_meta": {"source": "bracket_reset", "needed": needed, "updated_at": now_iso,
                            **({} if needed else {"note": RESET_NOT_NEEDED_NOTE})},
            "updated_at": now_iso,
        }
        target.update(change)
        target_sets.setdefault(target["id"], {}).update(change)


def _ensure_no_pending_result(match: dict) -> None:
    """Liegt im Folgespiel gerade ein Ergebnis für „Rückgängig“ bereit, wartet die Korrektur - sonst ginge es ins Leere."""
    if isinstance(match.get("pending_result"), dict):
        name = match.get("round_name") or match.get("match_key") or "Im Folgespiel"
        raise MatchV2ResultError(f"{name}: dort wird gerade ein Ergebnis eingetragen. Bitte kurz warten.", 409)


PAIRING_CHANGED_REASON = "Paarung geändert"


def _pairing_reset_fields(match: dict, now_iso: str) -> dict:
    """Was zur alten Paarung eines Folgespiels gehörte (#1035): Meldungen, Beginn, Aufruf, Wertung und Einsprüche.
    Einsprüche verschwinden nicht - sie bleiben als erledigt mit Grund „Paarung geändert“ in der Historie."""
    disputes = [
        row if not isinstance(row, dict) or row.get("resolved_at") else {
            **row, "resolved_at": now_iso, "decision": "void", "decision_note": PAIRING_CHANGED_REASON,
        }
        for row in match.get("disputes") or []
    ]
    return {
        "reports": [],
        "started_at": None,
        "called_at": None,
        # Frist „nicht erschienen“ (#1551): Vorschlag und Verlängerung gehörten zur alten Paarung.
        "no_show_proposal": None,
        "no_show_extended_until": None,
        "forfeit_registration_id": None,
        "admin_decision_note": None,
        "admin_decision_by": None,
        "admin_decision_at": None,
        "status_before_dispute": None,
        **({"disputes": disputes} if match.get("disputes") else {}),
    }


def _reset_match_result_state(match: dict, target_sets: dict[str, dict], now_iso: str,
                              reset_log: list[dict] | None = None) -> None:
    """Ein Folgespiel verliert sein Ergebnis, weil sich seine Paarung geändert hat. Was es vorher hatte, kommt in
    ``reset_log`` - für die Antwort und die Historie (#1035). Was zur alten Paarung gehörte, fällt weg
    (``_pairing_reset_fields``)."""
    if reset_log is not None and (match.get("results") or str(match.get("status") or "") in LOCKED_DOWNSTREAM_STATUSES) \
            and all(row["id"] != match["id"] for row in reset_log):
        reset_log.append({
            "id": match["id"],
            "match_key": match.get("match_key"),
            "status": match.get("status"),
            "results": match.get("results") or [],
            **({"forfeit_registration_id": match["forfeit_registration_id"]} if match.get("forfeit_registration_id") else {}),
        })
    target_sets.setdefault(match["id"], {})
    target_sets[match["id"]].update({
        "results": [],
        "result_meta": None,
        "completed_at": None,
        "completed_by": None,
        **_pairing_reset_fields(match, now_iso),
        "status": _status_after_slot_fill(match, preserve_terminal=False),
        "updated_at": now_iso,
    })


def _cascade_clear_downstream(
    source_match_id: str,
    by_id: dict[str, dict],
    downstream: dict[str, list[tuple[str, int]]],
    target_sets: dict[str, dict],
    now_iso: str,
    visited: set[str] | None = None,
    reset_log: list[dict] | None = None,
) -> None:
    visited = visited or set()
    if source_match_id in visited:
        return
    visited.add(source_match_id)

    for child_id, slot_number in downstream.get(source_match_id, []):
        child = by_id.get(child_id)
        if not child:
            continue
        slots = target_sets.get(child_id, {}).get("slots") or child.get("slots") or []
        slot = _find_slot({"slots": slots}, slot_number)
        if not slot:
            continue
        source = slot.get("source_result") or {}
        if source.get("from_match_id") != source_match_id:
            continue
        _ensure_no_pending_result(child)
        if not _clear_slot(slot):
            continue
        child["slots"] = slots
        target_sets.setdefault(child_id, {})
        target_sets[child_id].update({
            "slots": slots,
            "status": _status_after_slot_fill(child, preserve_terminal=False),
            "updated_at": now_iso,
        })
        _reset_match_result_state(child, target_sets, now_iso, reset_log)
        _cascade_clear_downstream(child_id, by_id, downstream, target_sets, now_iso, visited, reset_log)


def build_v2_result_application(
    match: dict,
    stage_matches: list[dict],
    raw_results: list[dict],
    actor_id: str,
    now_iso: str,
    proof_url: str | None = None,
    note: str | None = None,
    force: bool = False,
    rng=None,
    eliminated: set[str] | None = None,
) -> dict:
    """Ein Ergebnis anwenden: was am Spiel selbst steht (``match_set``) und was in den Folgespielen (``target_sets``).

    Gemischt (#1548) wartet die Folgerunde, bis die ganze Runde entschieden ist; dann wird gelost (``draws`` in der
    Antwort). ``rng``: nur Tests.

    ``eliminated`` (#1553): Anmeldungen, die disqualifiziert oder ausgetreten sind. Sie rücken nirgends mehr ein - ihr
    Zielplatz wird ein Freilos; in einem Lauf rückt auf dem Sieger-Weg der Nächstplatzierte auf. Wer nicht erschienen
    ist (``forfeit``), kommt auf dem Sieger-Weg ebenfalls nicht weiter (ein Lauf mit zwei Fahrern und Quote zwei
    schickte ihn sonst weiter); der Verlierer-Weg (Doppel-K.-o., Spiel um Platz 3) bleibt ihm offen."""
    if match.get("status") in {"cancelled"}:
        raise MatchV2ResultError("Abgebrochene Matches können kein Ergebnis erhalten")
    if match.get("status") in {"completed", "forfeit"} and not force:
        raise MatchV2ResultError("Match ist bereits abgeschlossen. Für Korrektur force=true nutzen.", 409)

    results = normalize_v2_results(match, raw_results)
    eliminated = set(eliminated or ())
    path_by_rank = _placement_positions(results)
    if eliminated and match.get("match_type") == "ffa":
        # Plätze rücken auf: Sieger- und Verlierer-Weg zählen nur, wer noch im Turnier ist - wer auf dem Sieger-Weg
        # aufrückt, steht nicht zugleich im Loser Bracket (#1823).
        path_by_rank = {index: entry for index, entry in enumerate(
            (entry for entry in results if entry["registration_id"] not in eliminated), start=1)}
    by_id, by_key = _target_lookup(stage_matches)
    downstream = _downstream_links(stage_matches)
    target_sets: dict[str, dict] = {}
    overwritten_targets: set[str] = set()
    advanced_registration_ids: set[str] = set()
    waiting_groups: list[tuple] = []
    draws: list[dict] = []

    for advancement in match.get("advancement") or []:
        target = by_id.get(advancement.get("to_match_id")) or by_key.get(advancement.get("to_match_key"))
        if not target:
            raise MatchV2ResultError(f"Zielmatch {advancement.get('to_match_key')} nicht gefunden")
        result_rank = _advancement_result_rank(match, advancement)
        flow = advancement.get("flow")
        result = path_by_rank.get(result_rank)
        skip_reason = None
        if result and result["registration_id"] in eliminated:
            skip_reason = "eliminated"
        elif result and flow == "W" and result.get("forfeit"):
            skip_reason = "forfeit"
        if not result and not skip_reason and not _rank_can_be_missing_because_of_bye(match, result_rank):
            raise MatchV2ResultError(f"Rank {result_rank} fehlt für Advancement")
        if result and not skip_reason:
            if result["registration_id"] in advanced_registration_ids:
                raise MatchV2ResultError(
                    "Teilnehmer darf aus demselben Match nicht mehrfach weitergeleitet werden",
                    409,
                )
            advanced_registration_ids.add(result["registration_id"])
        rewired: list[dict] = []
        target, target_slot, waiting = _locate_target_slot(advancement, target, by_id, match["id"], result_rank, rng, rewired)
        _record_rewired(match, rewired, target_sets, now_iso)
        if waiting:
            # Gemischt (#1548): noch nicht ausgelost - der Platz ergibt sich, wenn die ganze Runde fertig ist.
            if waiting not in waiting_groups:
                waiting_groups.append(waiting)
            continue
        if not target_slot:
            raise MatchV2ResultError(f"Zielslot {advancement.get('to_slot')} in {target.get('match_key')} nicht gefunden")
        draw_id = (target_slot.get("source_result") or {}).get("draw_id")
        if skip_reason:
            existing_reg = target_slot.get("registration_id")
            if existing_reg and existing_reg != result["registration_id"]:
                if not force:
                    raise MatchV2ResultError(
                        f"Zielslot {target.get('match_key')}:{target_slot.get('slot')} ist bereits belegt. Für Korrektur force=true nutzen.",
                        409,
                    )
                _ensure_no_pending_result(target)
                overwritten_targets.add(target["id"])
            _mark_slot_bye(target_slot, match, result_rank, flow, now_iso, reason=skip_reason)
            if draw_id:
                target_slot["source_result"]["draw_id"] = draw_id
            _note_instant_assignment(target, target_slot, match, now_iso, draws)
            target_sets.setdefault(target["id"], {}).update({
                "slots": target.get("slots") or [],
                "status": _status_after_slot_fill(target),
                "updated_at": now_iso,
            })
            continue
        if not result:
            target_slot["registration_id"] = None
            target_slot["user_id"] = None
            target_slot["source_result"] = {
                "from_match_id": match["id"],
                "from_match_key": match.get("match_key"),
                "rank": result_rank,
                "flow": advancement.get("flow"),
                "skipped": True,
                "reason": "bye",
                "confirmed_at": now_iso,
                **({"draw_id": draw_id} if draw_id else {}),
            }
            target_slot["status"] = "bye"
            _note_instant_assignment(target, target_slot, match, now_iso, draws)
            target_sets.setdefault(target["id"], {}).update({
                "slots": target.get("slots") or [],
                "status": _status_after_slot_fill(target),
                "updated_at": now_iso,
            })
            continue

        existing_reg = target_slot.get("registration_id")
        if existing_reg and existing_reg != result["registration_id"]:
            if not force:
                raise MatchV2ResultError(
                    f"Zielslot {target.get('match_key')}:{target_slot.get('slot')} ist bereits belegt. Für Korrektur force=true nutzen.",
                    409,
                )
            _ensure_no_pending_result(target)
            overwritten_targets.add(target["id"])

        target_slot["registration_id"] = result["registration_id"]
        target_slot["user_id"] = result.get("user_id")
        target_slot["source_result"] = {
            "from_match_id": match["id"],
            "from_match_key": match.get("match_key"),
            "rank": result["rank"],
            "flow": advancement.get("flow"),
            "confirmed_at": now_iso,
            **({"draw_id": draw_id} if draw_id else {}),
        }
        target_slot["status"] = "filled"
        _note_instant_assignment(target, target_slot, match, now_iso, draws)
        target_sets.setdefault(target["id"], {}).update({
            "slots": target.get("slots") or [],
            "status": _status_after_slot_fill(target),
            "updated_at": now_iso,
        })

    for stage_id, group in waiting_groups:
        run_draw(group, by_id, target_sets, now_iso, stage_id=stage_id, decided_results={match["id"]: results},
                 rng=rng, draws=draws, eliminated=eliminated)

    reset_matches: list[dict] = []
    if force:
        for target_id in overwritten_targets:
            target = by_id[target_id]
            if target.get("status") in LOCKED_DOWNSTREAM_STATUSES or target.get("results"):
                _reset_match_result_state(target, target_sets, now_iso, reset_matches)
            else:
                # Neue Paarung ohne Ergebnis: was zur alten gehörte, gilt nicht mehr.
                target_sets[target_id].update(_pairing_reset_fields(target, now_iso))
            _cascade_clear_downstream(target_id, by_id, downstream, target_sets, now_iso, reset_log=reset_matches)

    # Freilos-Kette und Reset-Regel erst jetzt - nach Korrektur und Kaskade steht fest, was in den Zielen gilt.
    resolve_walkovers(list(target_sets), by_id, target_sets, now_iso, rng=rng, draws=draws)
    _apply_bracket_reset_rule(match, results, by_id, by_key, target_sets, now_iso)

    match_set = {
        "results": results,
        "result_meta": {
            "proof_url": (proof_url or "").strip() or None,
            "note": (note or "").strip() or None,
            "confirmed_by": actor_id,
            "confirmed_at": now_iso,
            "force": force,
        },
        "status": "completed",
        "completed_at": now_iso,
        "completed_by": actor_id,
        "updated_at": now_iso,
        # Sofort zufällig (#1590): das Schema folgt dem Los - die eigenen Weiterleitungen zeigen auf die gezogenen Plätze.
        **({"advancement": match.get("advancement") or []} if match["id"] in target_sets and "advancement" in target_sets[match["id"]] else {}),
    }
    target_sets.pop(match["id"], None)
    return {
        "match_set": match_set,
        "target_sets": target_sets,
        "results": results,
        "advanced": len(target_sets),
        # Folgespiele, die diese Korrektur zurücksetzt - mit dem Ergebnis, das sie vorher hatten (#1035).
        "reset_matches": reset_matches,
        # Auslosungen, die dieses Ergebnis ausgelöst hat (#1548) - für Protokoll und Live-Ereignis.
        "draws": draws,
    }


# ---------------------------------------------------------------------------------------------- Neu auslosen (#1548)

REDRAW_STARTED_DETAIL = "{name} hat schon begonnen – neu auslosen geht nicht mehr."


def _match_name(match: dict) -> str:
    return str(match.get("round_name") or match.get("match_key") or "Ein Spiel dieser Runde")


SHOW_NOT_READY_DETAIL = "Noch nicht bereit – die Runde davor ist noch nicht fertig."
SHOW_ALREADY_DRAWN_DETAIL = "Diese Runde ist schon ausgelost."


def build_show_draw_application(stage_matches: list[dict], group: str, *, now_iso: str, rng=None,
                                trigger: str = "show") -> dict:
    """„Jetzt auslosen“ (Show-Auslosung, #1590): die Runde ist bereit (``draw_ready``), die Turnierleitung - oder
    nach der Frist der Server (``trigger="timeout"``) - legt das Los. Vorher 409, zweimal 409, unbekannt 404."""
    by_id, _by_key = _target_lookup(stage_matches)
    targets = _draw_open_targets(by_id, group)
    if not targets:
        raise MatchV2ResultError("Diese Auslosung gibt es nicht.", 404)
    if _group_is_drawn(targets):
        raise MatchV2ResultError(SHOW_ALREADY_DRAWN_DETAIL, 409)
    if not _group_is_ready(targets):
        raise MatchV2ResultError(SHOW_NOT_READY_DETAIL, 409)
    target_sets: dict[str, dict] = {}
    draws: list[dict] = []
    drawn = run_draw(group, by_id, target_sets, now_iso, stage_id=targets[0].get("stage_id"), rng=rng, draws=draws,
                     trigger=trigger, force=True)
    if not drawn:
        raise MatchV2ResultError("Auslosen geht gerade nicht – die Runde davor ist nicht mehr fertig.", 409)
    resolve_walkovers(drawn, by_id, target_sets, now_iso, rng=rng, draws=draws)
    return {"target_sets": target_sets, "draw": draws[0], "draws": draws}


def _instant_redraw(targets: list[dict], by_id: dict[str, dict], group: str, now_iso: str, rng=None) -> dict:
    """Sofort zufällig (#1590): neu gemischt werden nur die Zielspiele, die noch nicht begonnen haben - ihre bisher
    gezogenen Plätze (Personen und Freilose) werden untereinander neu verteilt; begonnene Spiele bleiben."""
    rng = rng or DRAW_RNG
    open_targets = [target for target in targets if not _draw_started(target)]
    if not open_targets:
        raise MatchV2ResultError("Alle Spiele dieser Runde haben schon begonnen – neu auslosen geht nicht mehr.", 409)
    entries: list[dict] = []
    seats: dict[str, list[int]] = defaultdict(list)
    for target in open_targets:
        for slot in target.get("slots") or []:
            origin = slot.get("source_result") or {}
            if (slot.get("source") or {}).get("type") != "rank" or not origin.get("from_match_id"):
                continue
            # Das Schema folgt dem Los (wie ``_rewire_instant``): Zubringer-Eintrag und Platz-Identität wandern mit dem
            # Weiterkommer auf seinen neuen Platz - sonst zeigt der Graph danach auf die alten Plätze, und ein späteres
            # Nachrücken leert einen fremden Platz.
            feeder = _feeder_of(target, slot, by_id)
            entries.append({
                "registration_id": slot.get("registration_id"), "user_id": slot.get("user_id"),
                "rank": int(origin.get("rank") or 0), "flow": origin.get("flow"),
                "source": by_id.get(origin.get("from_match_id")) or {"id": origin.get("from_match_id"), "match_key": origin.get("from_match_key")},
                "reason": origin.get("reason") or "bye",
                "identity": {key: value for key, value in (slot.get("source") or {}).items() if key != "draw"},
                "feeder": feeder,
            })
            seats[target["id"]].append(int(slot.get("slot") or 0))
            _clear_slot(slot)
    if not entries:
        raise MatchV2ResultError("Noch nicht ausgelost – hier sitzt noch niemand.", 409)
    draw_id = str(uuid.uuid4())
    ordered = sorted(open_targets, key=lambda row: (row.get("order") or 0, row.get("match_key") or ""))
    placed = assign_balanced(entries, [(target["id"], seats[target["id"]]) for target in ordered if seats.get(target["id"])], rng)
    assignments = []
    rewired_sources: dict[str, dict] = {}
    for target_id, slot_no, entry in placed:
        target = by_id[target_id]
        slot = _find_slot(target, slot_no)
        source = entry["source"] if entry else None
        if entry:
            draw_mark = (slot.get("source") or {}).get("draw")
            slot["source"] = {**entry["identity"], **({"draw": draw_mark} if draw_mark else {})}
            if entry.get("feeder"):
                feeder_source, feeder_entry = entry["feeder"]
                feeder_entry.update({"to_match_id": target_id, "to_match_key": target.get("match_key"), "to_slot": slot_no})
                rewired_sources[feeder_source["id"]] = feeder_source
        if entry and entry.get("registration_id"):
            slot["registration_id"] = entry["registration_id"]
            slot["user_id"] = entry.get("user_id")
            slot["source_result"] = {"from_match_id": source["id"], "from_match_key": source.get("match_key"),
                                     "rank": entry["rank"], "flow": entry["flow"], "confirmed_at": now_iso,
                                     "draw_id": draw_id, "drawn_at": now_iso}
            slot["status"] = "filled"
        elif entry:
            _mark_slot_bye(slot, source, entry["rank"], entry["flow"], now_iso, reason=entry.get("reason") or "bye")
            slot["source_result"].update({"draw_id": draw_id, "drawn_at": now_iso})
        assignments.append({"match_id": target_id, "match_key": target.get("match_key"), "slot": slot_no,
                            "registration_id": (entry or {}).get("registration_id"),
                            "from_match_key": source.get("match_key") if source else None,
                            "rank": (entry or {}).get("rank"), "flow": (entry or {}).get("flow")})
    target_sets: dict[str, dict] = {}
    for target in open_targets:
        target["status"] = _status_after_slot_fill(target, preserve_terminal=False)
        target["updated_at"] = now_iso
        target_sets[target["id"]] = {"slots": target.get("slots") or [], "status": target["status"], "updated_at": now_iso,
                                     **_pairing_reset_fields(target, now_iso)}
    for source in rewired_sources.values():
        # Die Quellen schreiben ihre umgehängten Weiterleitungen mit - alles oder nichts, zusammen mit den Zielspielen.
        source["updated_at"] = now_iso
        target_sets.setdefault(source["id"], {}).update({"advancement": source.get("advancement") or [], "updated_at": now_iso})
    draw = {"id": draw_id, "group": group, "kind": "instant", "trigger": "redraw", "drawn_at": now_iso,
            "stage_id": open_targets[0].get("stage_id"), "tournament_id": open_targets[0].get("tournament_id"),
            "assignments": assignments}
    resolve_walkovers([target["id"] for target in open_targets], by_id, target_sets, now_iso, rng=rng, draws=None)
    return {"target_sets": target_sets, "draw": draw, "draws": [draw]}


def build_redraw_application(stage_matches: list[dict], group: str, *, now_iso: str, rng=None) -> dict:
    """„Neu auslosen“ durch die Turnierleitung: dieselben Weiterkommer, neues Los - bis eines der Spiele der Gruppe
    beginnt (aufgerufen, gestartet, Meldung, Ergebnis oder kampflos entschieden), dann 409. Sofort zufällig (#1590):
    nur die Zielspiele, die noch nicht begonnen haben (``_instant_redraw``)."""
    by_id, _by_key = _target_lookup(stage_matches)
    targets = _draw_open_targets(by_id, group)
    if not targets:
        raise MatchV2ResultError("Diese Auslosung gibt es nicht.", 404)
    if _is_instant(targets[0]):
        return _instant_redraw(targets, by_id, group, now_iso, rng)
    if not _group_is_drawn(targets):
        raise MatchV2ResultError("Noch nicht ausgelost – die Runde davor ist noch nicht fertig.", 409)
    for target in targets:
        if _draw_started(target):
            raise MatchV2ResultError(REDRAW_STARTED_DETAIL.format(name=_match_name(target)), 409)
    for target in targets:
        for slot in target.get("slots") or []:
            if (slot.get("source") or {}).get("type") == "rank" and slot.get("source_result"):
                _clear_slot(slot)
        target.pop("draw", None)
        target["status"] = _status_after_slot_fill(target, preserve_terminal=False)
    target_sets: dict[str, dict] = {}
    draws: list[dict] = []
    drawn = run_draw(group, by_id, target_sets, now_iso, stage_id=targets[0].get("stage_id"), rng=rng, draws=draws,
                     trigger="redraw")
    if not drawn:
        raise MatchV2ResultError("Neu auslosen geht gerade nicht – die Runde davor ist nicht mehr fertig.", 409)
    resolve_walkovers(drawn, by_id, target_sets, now_iso, rng=rng, draws=draws)
    return {"target_sets": target_sets, "draw": draws[0], "draws": draws}


def _pair(match: dict) -> frozenset:
    return frozenset(slot.get("registration_id") or f"slot-{slot.get('slot')}" for slot in match.get("slots") or [])


LEAGUE_NOT_SHUFFLED_DETAIL = "Diese Liga ist nicht auf „Zufällig mischen“ gestellt – die Spieltage bleiben, wie sie sind."


def _league_shuffled(matches: list[dict]) -> bool:
    """Gemischt gebaut: das Ja an den Partien (beim Bau aus Turnier und Phase) oder schon eine Liga-Auslosung."""
    return any((match.get("settings") or {}).get("randomize_advancement_rounds") is True
               or (match.get("draw") or {}).get("kind") == "league" for match in matches)


def build_league_redraw_application(stage_matches: list[dict], *, now_iso: str, rng=None, trigger: str = "redraw") -> dict:
    """Liga „Neu auslosen“ vor Spieltag 1 (#1548): Reihenfolge der Spieltage und Heimrecht neu, die Paarungen bleiben
    (Kreismethode), jede Partie behält ihre Kennung. Die Rückrunde spiegelt die Hinrunde. Nur für gemischte Ligen - eine
    Liga mit festem Baum bleibt unverändert (409)."""
    rng = rng or DRAW_RNG
    matches = [match for match in stage_matches if match.get("status") != "cancelled"]
    if not matches:
        raise MatchV2ResultError("Diese Phase hat keine Spieltage.", 404)
    if not _league_shuffled(matches):
        raise MatchV2ResultError(LEAGUE_NOT_SHUFFLED_DETAIL, 409)
    for match in matches:
        if _draw_started(match):
            raise MatchV2ResultError("Die Liga hat schon begonnen – neu auslosen geht nur vor Spieltag 1.", 409)
    days: dict[int, list[dict]] = defaultdict(list)
    for match in matches:
        days[int(match.get("round") or 0)].append(match)
    numbers = sorted(days)
    half = len(numbers) // 2
    mirrored = len(numbers) % 2 == 0 and half > 0 and all(
        sorted(map(sorted, map(list, (_pair(m) for m in days[numbers[i]])))) ==
        sorted(map(sorted, map(list, (_pair(m) for m in days[numbers[i + half]]))))
        for i in range(half)
    )
    legs = [numbers[:half], numbers[half:]] if mirrored else [numbers]
    order = list(range(len(legs[0])))
    rng.shuffle(order)
    new_round: dict[int, int] = {}
    for leg_index, leg in enumerate(legs):
        for position, old_index in enumerate(order):
            new_round[leg[old_index]] = numbers[0] + leg_index * len(leg) + position
    swap = {pair: rng.random() < 0.5 for pair in {_pair(match) for match in matches}}
    draw = {"id": str(uuid.uuid4()), "group": str(matches[0].get("section") or "LIGA"), "kind": "league",
            "trigger": trigger, "drawn_at": now_iso}
    target_sets: dict[str, dict] = {}
    assignments = []
    for match in sorted(matches, key=lambda row: (row.get("round") or 0, row.get("order") or 0)):
        slots = [dict(slot) for slot in match.get("slots") or []]
        if swap[_pair(match)] and len(slots) == 2:
            first, second = slots
            slots = [{**second, "slot": first.get("slot")}, {**first, "slot": second.get("slot")}]
        number = new_round[int(match.get("round") or 0)]
        update = {"round": number, "round_name": f"Spieltag {number}", "slots": slots, "draw": dict(draw),
                  "updated_at": now_iso}
        match.update(update)
        target_sets[match["id"]] = update
        assignments.append({"match_id": match["id"], "match_key": match.get("match_key"), "round": number,
                            "home": slots[0].get("registration_id") if slots else None,
                            "away": slots[1].get("registration_id") if len(slots) > 1 else None})
    full = {**draw, "stage_id": matches[0].get("stage_id"), "tournament_id": matches[0].get("tournament_id"),
            "assignments": assignments}
    return {"target_sets": target_sets, "draw": full, "draws": [full]}


def apply_deferred_draws(matches: list[dict], *, now_iso: str, rng=None) -> list[dict]:
    """Das Los für einen ohne Auslosung gebauten Plan (Strukturplan „Anwenden“, #1548): der Plan selbst bleibt
    reproduzierbar und legt nichts fest; gelost wird erst beim Anwenden - mit ``secrets``. Liga: Spieltage und Heimrecht;
    K.-o./Läufe: jede Runde, die schon beim Bau ganz entschieden ist (Freilose). Ändert ``matches`` und gibt die
    Auslosungen zurück."""
    rng = rng or DRAW_RNG
    draws: list[dict] = []
    leagues: dict[str, list[dict]] = defaultdict(list)
    for match in matches:
        if match.get("stage_type") == "league" and not match.get("is_preview"):
            leagues[str(match.get("stage_id") or "")].append(match)
    for _stage_id, league in sorted(leagues.items()):
        # Je Liga-Phase ein eigenes Los - Spieltage und Heimrecht gehören zu genau einer Phase.
        if _league_shuffled(league) and not any(match.get("draw") for match in league):
            draws.extend(build_league_redraw_application(league, now_iso=now_iso, rng=rng, trigger="build")["draws"])
    by_id = {match["id"]: match for match in matches if match.get("id") and not match.get("is_preview")}
    drawn = run_ready_draws(by_id, {}, now_iso, rng=rng, draws=draws, trigger="walkover")
    if drawn:
        resolve_walkovers(drawn, by_id, {}, now_iso, rng=rng, draws=draws)
    return draws
