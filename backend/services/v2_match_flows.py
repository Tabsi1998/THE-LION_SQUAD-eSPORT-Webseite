"""Report, dispute and forfeit for graph matches.

These three existed only for classic matches. A tournament running on the graph
engine could be played but not contested: no way to report a result together,
no way to object to one, no way to record a walkover. That gap is why no format
could move over, so it is closed here before anything migrates.

The flows deliberately produce the same shapes the classic ones do - a
``reports`` list, a ``disputes`` list, a decided result - so the read model and
the interface do not have to tell the two apart. Forfeits do not write a result
themselves: they build the ranking and hand it to the one existing result
writer, which owns the advancement cascade.
"""
from __future__ import annotations

from models import now_utc
from services.match_v2_results import MatchV2ResultError


FORFEIT_NOTE_MIN_LENGTH = 5
# Ein Spiel in diesen Zuständen nimmt keine Meldungen mehr an: entschieden, abgesagt oder in Klärung (#1132).
REPORT_CLOSED_STATUSES = {"completed", "forfeit", "cancelled", "disputed", "bye", "archived"}


def filled_slots(match: dict) -> list[dict]:
    return [slot for slot in (match.get("slots") or []) if slot.get("registration_id")]


def participant_ids(match: dict) -> list[str]:
    return [slot["registration_id"] for slot in filled_slots(match)]


def results_for_forfeit(match: dict, forfeiting_registration_id: str) -> list[dict]:
    """Rank a walkover: whoever gave up comes last, the rest keep their order.

    Expressing a forfeit as an ordinary ranking means the advancement cascade,
    the standings and the exports need no special case for it - a forfeited
    match looks like any other decided match, just with a note attached.
    """
    participants = participant_ids(match)
    if not participants:
        raise MatchV2ResultError("Match hat keine belegten Slots")
    if forfeiting_registration_id not in participants:
        raise MatchV2ResultError("Der angegebene Teilnehmer gehört nicht zu diesem Match")
    if len(participants) < 2:
        raise MatchV2ResultError("Ein Forfeit braucht mindestens zwei Teilnehmer")

    remaining = [item for item in participants if item != forfeiting_registration_id]
    results = [{"registration_id": item, "rank": index + 1} for index, item in enumerate(remaining)]
    # Ausdrücklich als Aufgabe gekennzeichnet: sonst sähe die Platzierung aus wie
    # ein normales Ergebnis ohne Punktstand - und wäre dort, wo Unentschieden
    # erlaubt sind, von einem geteilten Platz nicht zu unterscheiden.
    results.append({
        "registration_id": forfeiting_registration_id,
        "rank": len(participants),
        "forfeit": True,
    })
    return results


def is_duplicate_dispute(match: dict, user_id: str, reason: str) -> bool:
    """Same person, same reason - already recorded."""
    needle = (reason or "").strip()
    return any(
        item.get("user_id") == user_id and (item.get("reason") or "").strip() == needle
        for item in match.get("disputes") or []
    )


def dispute_entry(user_id: str, reason: str) -> dict:
    return {"user_id": user_id, "reason": (reason or "").strip(), "at": now_utc().isoformat()}


def report_entry(user_id: str, registration_id: str | None, results: list[dict],
                 proof_url: str | None = None, note: str | None = None) -> dict:
    entry = {
        "user_id": user_id,
        "registration_id": registration_id,
        "results": results,
        "at": now_utc().isoformat(),
    }
    # Beweis-Link und Notiz der Meldung sieht nur, wer gemeldet hat, und die Turnierleitung (match_public_view).
    if (proof_url or "").strip():
        entry["proof_url"] = proof_url.strip()
    if (note or "").strip():
        entry["note"] = note.strip()
    return entry


# Was von einer Meldung zählt und was die Gegenseite davon sieht: Plätze und Spielstand - keine Notiz, kein Link.
REPORT_RESULT_FIELDS = ("registration_id", "rank", "score", "points", "time_ms", "dnf", "forfeit")


def _number(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _ranking_signature(results: list[dict]) -> tuple:
    """Zwei Meldungen sind gleich, wenn dieselben Teilnehmer auf denselben Plätzen stehen - und, wo einer gemeldet
    ist, mit demselben Spielstand (#1132: „melden beide Seiten dasselbe“). Reihenfolge und Notizen zählen nicht."""
    return tuple(sorted(
        (
            str(entry.get("registration_id") or ""),
            int(entry.get("rank") or 0),
            _number(entry.get("score")),
            _number(entry.get("points")),
            _number(entry.get("time_ms")),
            bool(entry.get("dnf")),
            bool(entry.get("forfeit")),
        )
        for entry in results or []
    ))


def public_report_results(results: list[dict] | None) -> list[dict]:
    """Eine Meldung so, wie die Gegenseite sie zum Bestätigen sieht: Plätze und Spielstand."""
    rows = []
    for entry in results or []:
        row = {"registration_id": entry.get("registration_id"), "rank": entry.get("rank")}
        for key in ("score", "points", "time_ms"):
            if entry.get(key) is not None:
                row[key] = entry[key]
        for key in ("dnf", "forfeit"):
            if entry.get(key):
                row[key] = True
        rows.append(row)
    return rows


def latest_reports(reports: list[dict] | None) -> dict[str, dict]:
    """Je meldender Seite die letzte Meldung - wer sich korrigiert, dessen letzte zählt."""
    latest: dict[str, dict] = {}
    for report in reports or []:
        key = report.get("registration_id") or report.get("user_id")
        if key:
            latest[key] = report
    return latest


def reports_conflict(reports: list[dict] | None) -> bool:
    """Zwei Seiten haben gemeldet, und die Meldungen passen nicht zusammen."""
    latest = latest_reports(reports)
    return len(latest) >= 2 and len({_ranking_signature(item.get("results")) for item in latest.values()}) > 1


def report_state(reports: list[dict] | None, registration_id: str | None) -> dict:
    """Wo die Meldungen für eine Seite stehen (#1132):

    - ``open``: noch niemand hat gemeldet,
    - ``waiting``: die eigene Meldung ist da, die Gegenseite fehlt noch,
    - ``confirm``: die Gegenseite hat gemeldet, die eigene fehlt - bitte bestätigen oder anders melden,
    - ``conflict``: beide haben gemeldet, aber verschieden - die Turnierleitung entscheidet.
    """
    latest = latest_reports(reports)
    mine = latest.get(registration_id) if registration_id else None
    others = [item for key, item in latest.items() if key != registration_id]
    if mine and others:
        own = _ranking_signature(mine.get("results"))
        status = "conflict" if any(_ranking_signature(item.get("results")) != own for item in others) else "agreed"
    elif mine:
        status = "waiting"
    elif others:
        status = "confirm"
    else:
        status = "open"
    return {"status": status, "own": mine, "proposal": others[-1] if others and not mine else None}


def is_duplicate_report(match: dict, user_id: str, results: list[dict]) -> bool:
    signature = _ranking_signature(results)
    return any(
        item.get("user_id") == user_id and _ranking_signature(item.get("results")) == signature
        for item in match.get("reports") or []
    )


def report_consensus(reports: list[dict]) -> list[dict] | None:
    """Decide whether the reports agree, using each reporter's latest one.

    Consensus needs two different reporters saying the same thing. Anything
    else - a single report, or two that differ - waits for staff instead of
    guessing, which is the same rule the classic flow follows.
    """
    latest_by_reporter: dict[str, dict] = {}
    for report in reports or []:
        key = report.get("registration_id") or report.get("user_id")
        if key:
            latest_by_reporter[key] = report
    if len(latest_by_reporter) < 2:
        return None

    recent = list(latest_by_reporter.values())[-2:]
    first, second = recent[0], recent[1]
    if _ranking_signature(first.get("results")) != _ranking_signature(second.get("results")):
        return None
    return second.get("results") or None


def validate_forfeit_note(note: str | None) -> str:
    """A walkover is a penalty; the affected player is entitled to a reason."""
    text = (note or "").strip()
    if len(text) < FORFEIT_NOTE_MIN_LENGTH:
        raise MatchV2ResultError(
            f"Bei einem Forfeit ist eine Begründung (mind. {FORFEIT_NOTE_MIN_LENGTH} Zeichen) Pflicht."
        )
    return text
