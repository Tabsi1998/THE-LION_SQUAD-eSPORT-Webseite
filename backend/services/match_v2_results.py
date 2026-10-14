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
from services.advancement_draw import DRAW_RNG, assign_balanced, draw_group_of, group_sources, group_targets
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
                and (math.isinf(stated) or stated == previous_stated):
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


def normalize_v2_results(match: dict, raw_results: list[dict], *, best_of: int | None = None) -> list[dict]:
    """Ein Ergebnis nach dem Vertrag prüfen und in die gespeicherte Form bringen (siehe Modulbeschreibung).

    ``best_of``: nur angeben, wo das Spiel bekannt ist (``checked_results``); ohne Angabe keine Best-of-Prüfung - so
    rechnet das Neuberechnen gespeicherter Ergebnisse weiter wie bisher."""
    participants = _slot_participant_map(match)
    if not participants:
        raise MatchV2ResultError("Match hat keine belegten Slots")
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
    normalized = sorted(normalized, key=lambda item: item["rank"])
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


def _mark_slot_bye(slot: dict, source_match: dict, rank: int, flow: str | None, now_iso: str) -> None:
    slot["registration_id"] = None
    slot["user_id"] = None
    slot["source_result"] = {
        "from_match_id": source_match["id"],
        "from_match_key": source_match.get("match_key"),
        "rank": rank,
        "flow": flow,
        "skipped": True,
        "reason": "bye",
        "confirmed_at": now_iso,
    }
    slot["status"] = "bye"


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


def _draw_open_targets(by_id: dict[str, dict], group: str) -> list[dict]:
    return [target for target in group_targets(by_id.values(), group) if target.get("status") != "cancelled"]


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


def _locate_target_slot(advancement: dict, target: dict, by_id: dict[str, dict], source_id: str,
                        result_rank: int, rng=None) -> tuple[dict, dict | None, str | None]:
    """Wohin ein Weiterkommer geht: fester Baum - der Platz aus dem Schema; gemischt - vor der Auslosung noch nirgends
    (Rückgabe mit Gruppe), danach sein ausgeloster Platz."""
    group = draw_group_of(target)
    if not group or target.get("status") == "cancelled":
        return target, _find_slot(target, int(advancement.get("to_slot") or 0)), None
    targets = _draw_open_targets(by_id, group)
    if not _group_is_drawn(targets):
        return target, None, group
    ranks = {int(result_rank), int(advancement.get("rank") or 0)}
    found = _drawn_slot(targets, source_id, advancement.get("flow"), ranks) or _free_draw_slot(targets, rng)
    if not found:
        return target, None, None
    return found[0], found[1], None


def run_draw(group: str, by_id: dict[str, dict], target_sets: dict[str, dict], now_iso: str, *,
             decided_results: dict[str, list[dict]] | None = None, rng=None, draws: list[dict] | None = None,
             trigger: str = "result") -> list[str]:
    """Die Auslosung einer Gruppe, sobald **alle** Quellspiele entschieden sind (gespielt, gewertet, kampflos oder
    abgesagt). Der Topf: je Weiterleitung in die Gruppe der Teilnehmer auf diesem Platz - oder ein Freilos, wo es ihn
    nicht gibt. ``assign_balanced`` verteilt gleichmäßig. ``decided_results``: Ergebnisse, die noch nicht am Spiel
    stehen (das gerade eingetragene). Rückgabe: die Folgespiele, die jetzt besetzt sind."""
    decided_results = decided_results or {}
    targets = _draw_open_targets(by_id, group)
    if not targets or _group_is_drawn(targets):
        return []
    sources = sorted(group_sources(by_id.values(), group), key=lambda row: (row.get("round") or 0, row.get("order") or 0))
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
        by_rank = {int(row.get("rank") or 0): row for row in results}
        for advancement in source.get("advancement") or []:
            target = by_id.get(advancement.get("to_match_id"))
            if not target or target["id"] not in target_ids:
                continue
            slot = _find_slot(target, int(advancement.get("to_slot") or 0))
            if not slot or (slot.get("source") or {}).get("type") != "rank":
                continue
            slots_by_target[target["id"]].append(int(slot.get("slot") or 0))
            rank = _advancement_result_rank(source, advancement)
            result = by_rank.get(rank)
            entries.append({
                "registration_id": (result or {}).get("registration_id"),
                "user_id": (result or {}).get("user_id"),
                "rank": int(result["rank"]) if result else rank,
                "flow": advancement.get("flow"),
                "source": source,
            })
    if not entries:
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
            _mark_slot_bye(slot, source, entry["rank"], entry["flow"], now_iso)
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
    for target in targets:
        target["draw"] = dict(marker)
        target["status"] = _status_after_slot_fill({**target, "status": _effective_status(target, target_sets)})
        target["updated_at"] = now_iso
        target_sets.setdefault(target["id"], {}).update({
            "slots": target.get("slots") or [],
            "status": target["status"],
            "draw": dict(marker),
            "updated_at": now_iso,
        })
    if draws is not None:
        draws.append({**marker, "kind": "advancement", "stage_id": targets[0].get("stage_id"),
                      "tournament_id": targets[0].get("tournament_id"), "assignments": assignments})
    return [target["id"] for target in targets]


def group_awaits_draw(matches, group: str | None) -> bool:
    """Ist die Gruppe noch nicht ausgelost? Dann sind ihre Plätze offen, obwohl Quellen schon entschieden sein können -
    für den Lauf-Umbau (#1550) heißt das: nicht anfassen, die Plätze kommen mit der Auslosung."""
    if not group:
        return False
    targets = [row for row in group_targets(matches, group) if row.get("status") != "cancelled"]
    return bool(targets) and not _group_is_drawn(targets)


def run_ready_draws(by_id: dict[str, dict], target_sets: dict[str, dict], now_iso: str, *, rng=None,
                    draws: list[dict] | None = None, trigger: str = "walkover") -> list[str]:
    """Jede noch offene Auslosung, deren Runde inzwischen ganz entschieden ist - etwa weil der Lauf-Umbau den letzten
    offenen Lauf abgesagt hat. Rückgabe: die jetzt besetzten Folgespiele."""
    groups = sorted({group for row in by_id.values() if (group := draw_group_of(row))})
    drawn: list[str] = []
    for group in groups:
        drawn.extend(run_draw(group, by_id, target_sets, now_iso, rng=rng, draws=draws, trigger=trigger))
    return drawn


def resolve_walkovers(start_ids: list[str], by_id: dict[str, dict], target_sets: dict[str, dict], now_iso: str,
                      *, rng=None, draws: list[dict] | None = None) -> None:
    """Die Freilos-Kette (#1549): ein Spiel ohne offenen Zufluss und mit höchstens einem Teilnehmer ist entschieden.

    Genau ein Teilnehmer: er kommt kampflos weiter - nur den Sieger-Weg (``W`` Platz 1); jeder andere Weg (Verlierer
    ins Loser Bracket, Spiel um Platz 3, weitere Plätze) bekommt ein Freilos, denn es gibt niemanden, der verloren
    hätte. Kein Teilnehmer (nur Freilose): das Spiel entfällt und gibt alle Wege als Freilos weiter. Beides läuft
    rekursiv in die Folgespiele - beim Bau des Baums und nach jedem Ergebnis. Was sich ändert, steht danach in
    ``target_sets`` und in den Spielen selbst."""
    queue = deque(start_ids)
    seen: set[str] = set()
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
        change = {
            "results": [_auto_bye_result(winner, now_iso)] if winner else [],
            "status": "completed" if winner else "cancelled",
            "result_meta": {"source": "auto_bye", "updated_at": now_iso, **({} if winner else {"reason": "no_participants"})},
            "completed_at": now_iso if winner else None,
            "completed_by": "system" if winner else None,
            "updated_at": now_iso,
        }
        match.update(change)
        target_sets.setdefault(match_id, {}).update(change)
        waiting_groups: list[str] = []
        for advancement in match.get("advancement") or []:
            target = by_id.get(advancement.get("to_match_id"))
            if not target:
                continue
            rank = int(advancement.get("rank") or 0)
            target, target_slot, group = _locate_target_slot(advancement, target, by_id, match_id, rank, rng)
            if group:
                # Gemischt (#1548): ausgelost wird erst, wenn die ganze Runde entschieden ist.
                if group not in waiting_groups:
                    waiting_groups.append(group)
                continue
            if not target_slot:
                continue
            if winner and advancement.get("flow") == "W" and rank == 1:
                target_slot["registration_id"] = winner.get("registration_id")
                target_slot["user_id"] = winner.get("user_id")
                target_slot["source_result"] = {
                    "from_match_id": match_id,
                    "from_match_key": match.get("match_key"),
                    "rank": 1,
                    "flow": "W",
                    "confirmed_at": now_iso,
                }
                target_slot["status"] = "filled"
            else:
                _mark_slot_bye(target_slot, match, rank, advancement.get("flow"), now_iso)
            target["status"] = _effective_status(target, target_sets)
            target["status"] = _status_after_slot_fill(target)
            target["updated_at"] = now_iso
            target_sets.setdefault(target["id"], {}).update({
                "slots": target.get("slots") or [],
                "status": target["status"],
                "updated_at": now_iso,
            })
            queue.append(target["id"])
        for group in waiting_groups:
            for drawn_id in run_draw(group, by_id, target_sets, now_iso, rng=rng, draws=draws, trigger="walkover"):
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
) -> dict:
    """Ein Ergebnis anwenden: Weiterkommer in die Folgespiele, Freilos-Kette, Reset-Regel. Gemischt (#1548) wartet die
    Folgerunde, bis die ganze Runde entschieden ist; dann wird gelost (``draws`` in der Antwort). ``rng``: nur Tests."""
    if match.get("status") in {"cancelled"}:
        raise MatchV2ResultError("Abgebrochene Matches können kein Ergebnis erhalten")
    if match.get("status") in {"completed", "forfeit"} and not force:
        raise MatchV2ResultError("Match ist bereits abgeschlossen. Für Korrektur force=true nutzen.", 409)

    results = normalize_v2_results(match, raw_results)
    result_by_rank = {entry["rank"]: entry for entry in results}
    by_id, by_key = _target_lookup(stage_matches)
    downstream = _downstream_links(stage_matches)
    target_sets: dict[str, dict] = {}
    overwritten_targets: set[str] = set()
    advanced_registration_ids: set[str] = set()
    waiting_groups: list[str] = []
    draws: list[dict] = []

    for advancement in match.get("advancement") or []:
        target = by_id.get(advancement.get("to_match_id")) or by_key.get(advancement.get("to_match_key"))
        if not target:
            raise MatchV2ResultError(f"Zielmatch {advancement.get('to_match_key')} nicht gefunden")
        result_rank = _advancement_result_rank(match, advancement)
        result = result_by_rank.get(result_rank)
        if not result and not _rank_can_be_missing_because_of_bye(match, result_rank):
            raise MatchV2ResultError(f"Rank {result_rank} fehlt für Advancement")
        if result:
            if result["registration_id"] in advanced_registration_ids:
                raise MatchV2ResultError(
                    "Teilnehmer darf aus demselben Match nicht mehrfach weitergeleitet werden",
                    409,
                )
            advanced_registration_ids.add(result["registration_id"])
        target, target_slot, group = _locate_target_slot(advancement, target, by_id, match["id"], result_rank, rng)
        if group:
            # Gemischt (#1548): noch nicht ausgelost - der Platz ergibt sich, wenn die ganze Runde fertig ist.
            if group not in waiting_groups:
                waiting_groups.append(group)
            continue
        if not target_slot:
            raise MatchV2ResultError(f"Zielslot {advancement.get('to_slot')} in {target.get('match_key')} nicht gefunden")
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
            }
            target_slot["status"] = "bye"
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

        draw_id = (target_slot.get("source_result") or {}).get("draw_id")
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
        target_sets.setdefault(target["id"], {}).update({
            "slots": target.get("slots") or [],
            "status": _status_after_slot_fill(target),
            "updated_at": now_iso,
        })

    for group in waiting_groups:
        run_draw(group, by_id, target_sets, now_iso, decided_results={match["id"]: results}, rng=rng, draws=draws)

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
    }
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


def build_redraw_application(stage_matches: list[dict], group: str, *, now_iso: str, rng=None) -> dict:
    """„Neu auslosen“ durch die Turnierleitung: dieselben Weiterkommer, neues Los - bis eines der Spiele der Gruppe
    beginnt (aufgerufen, gestartet, Meldung, Ergebnis oder kampflos entschieden), dann 409."""
    by_id, _by_key = _target_lookup(stage_matches)
    targets = _draw_open_targets(by_id, group)
    if not targets:
        raise MatchV2ResultError("Diese Auslosung gibt es nicht.", 404)
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
    drawn = run_draw(group, by_id, target_sets, now_iso, rng=rng, draws=draws, trigger="redraw")
    if not drawn:
        raise MatchV2ResultError("Neu auslosen geht gerade nicht – die Runde davor ist nicht mehr fertig.", 409)
    resolve_walkovers(drawn, by_id, target_sets, now_iso, rng=rng, draws=draws)
    return {"target_sets": target_sets, "draw": draws[0], "draws": draws}


def _pair(match: dict) -> frozenset:
    return frozenset(slot.get("registration_id") or f"slot-{slot.get('slot')}" for slot in match.get("slots") or [])


def build_league_redraw_application(stage_matches: list[dict], *, now_iso: str, rng=None) -> dict:
    """Liga „Neu auslosen“ vor Spieltag 1 (#1548): Reihenfolge der Spieltage und Heimrecht neu, die Paarungen bleiben
    (Kreismethode), jede Partie behält ihre Kennung. Die Rückrunde spiegelt die Hinrunde."""
    rng = rng or DRAW_RNG
    matches = [match for match in stage_matches if match.get("status") != "cancelled"]
    if not matches:
        raise MatchV2ResultError("Diese Phase hat keine Spieltage.", 404)
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
            "trigger": "redraw", "drawn_at": now_iso}
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
