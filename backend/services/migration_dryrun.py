"""Measuring a tournament so a migration can be proven not to have changed it.

Before the stored tournaments move to one engine, two questions need answers
that are numbers rather than opinions: what is actually in there, and would
anything a member can see come out differently afterwards.

The second question decides how the measurement has to work. A migration writes
new match documents, so **match ids do not survive it** - a fingerprint built on
ids would report every tournament as changed and prove nothing. What survives is
the content: who played whom in which round, who won, what the table says and who
placed where. Those are also exactly the things a member would notice, which is
why they are the right thing to compare.

Everything here reads; nothing writes. The projections come from the canonical
read contract, which is engine-independent by design - with one exception that
building this turned up: placements are still answered differently by the two
engines, and since they feed prizes, profile history, badges and season points,
that is reported as a notice before anything moves rather than discovered after.
"""
from __future__ import annotations

import hashlib
import json

from services.competition_engine import CLASSIC, GRAPH, engine_of_record
from services.competition_formats import find_format_capability
from services.competition_graph_validation import validate_competition_graph
from services.competition_standings import placements_for_structure, standings_for_structure


TERMINAL = {"completed", "forfeit"}
OPEN_STATUSES = {"disputed", "waiting_result", "in_progress"}
KNOCKOUT_FORMATS = {"single_elim", "double_elim"}


def _participants(match: dict) -> list[str]:
    return sorted(
        slot.get("registration_id")
        for slot in match.get("slots") or []
        if slot.get("registration_id")
    )


def _winner(match: dict) -> str | None:
    winners = [
        result.get("registration_id")
        for result in match.get("results") or []
        if result.get("outcome") == "winner"
    ]
    return winners[0] if len(winners) == 1 else None


def match_identity(match: dict) -> str:
    """Name a match by what happened in it, not by its id.

    A migration writes new documents with new ids. Identifying a match by round
    and participants is what makes a before/after comparison possible at all.
    """
    return "{}|{}|{}".format(
        match.get("round") or 0,
        match.get("section") or "",
        ",".join(_participants(match)),
    )


def standings_order(rows: list) -> list[str]:
    """The table as a plain ranked list of registration ids.

    Group tournaments return one table per group; they are flattened in group
    order so the comparison stays a simple list either way.
    """
    order: list[str] = []
    for row in rows or []:
        if isinstance(row, dict) and "standings" in row:
            order.extend(
                entry.get("registration_id")
                for entry in row.get("standings") or []
                if entry.get("registration_id")
            )
        elif isinstance(row, dict) and row.get("registration_id"):
            order.append(row["registration_id"])
    return order


def tournament_fingerprint(
    tournament: dict,
    snapshot: dict,
    registrations: list[dict],
    *,
    groups: list[dict] = (),
) -> dict:
    """What a member can see about this tournament, as comparable values."""
    matches = snapshot.get("matches") or []
    decided = [match for match in matches if match.get("status") in TERMINAL]
    results = {}
    for match in decided:
        identity = match_identity(match)
        # Ein wiederholter Schlüssel wäre selbst schon ein Befund: zwei Matches
        # mit derselben Runde und denselben Teilnehmern.
        results.setdefault(identity, []).append(_winner(match))

    standings = standings_for_structure(tournament, snapshot, registrations, groups=list(groups))
    placements = placements_for_structure(snapshot, registrations)

    return {
        "participants": sorted(
            registration["id"] for registration in registrations if registration.get("id")
        ),
        "match_count": len(matches),
        "decided_count": len(decided),
        "results": {key: sorted(filter(None, value)) for key, value in sorted(results.items())},
        "standings": standings_order(standings),
        # Ein Platz mit einem Halter bleibt eine Kennung (gleiche Prüfsumme wie bisher), ein geteilter wird eine Liste.
        "placements": {str(rank): group[0].get("registration_id") if len(group) == 1
                       else sorted(entry.get("registration_id") or "" for entry in group)
                       for rank, group in sorted(placements.items())},
    }


def fingerprint_digest(fingerprint: dict) -> str:
    payload = json.dumps(fingerprint, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def placement_risk(snapshot: dict, registrations: list[dict]) -> dict | None:
    """Whether this tournament's placements would be answered differently afterwards.

    Placements are the one projection that is *not* engine-independent today.
    For a classic tournament they come from the historical ``final_position``
    field, and from nothing at all when that field is empty. For a graph
    tournament they are always derived from the standings.

    That matters far beyond the bracket: placements feed prize awards, the
    tournament history on member profiles, the winner/podium badges and the
    season points. A migration that quietly switches the source would rewrite
    all four for tournaments that are long finished.
    """
    matches = snapshot.get("matches") or []
    legacy = [match for match in matches if match.get("source", {}).get("engine") == "legacy"]
    if not legacy:
        return None

    explicit = [match for match in legacy if match.get("final_position")]
    decided = [match for match in legacy if match.get("status") in TERMINAL]
    if explicit:
        return {
            "code": "explicit_placements_would_be_replaced",
            "detail": f"{len(explicit)} Spiele tragen eine feste Platzierung (final_position).",
            "action": "Diese Platzierungen vor der Migration festschreiben - sonst werden sie "
                      "danach aus der Tabelle abgeleitet und können abweichen. Betrifft Preise, "
                      "Profil-Historie, Abzeichen und Saisonpunkte.",
        }
    if decided and not placements_for_structure(snapshot, registrations):
        return {
            "code": "placements_would_appear",
            "detail": "Das Turnier hat heute keine Platzierungen.",
            "action": "Nach der Migration würde es welche aus der Tabelle bekommen. Prüfen, ob "
                      "das für Preise und Saisonpunkte gewollt ist.",
        }
    return None


def migration_notices(snapshot: dict, registrations: list[dict] = ()) -> list[dict]:
    """Things that will change on migration but are systemic, not broken.

    Kept apart from the blockers on purpose. A blocker is a defect in one
    tournament that somebody has to go and fix; a notice applies to nearly every
    classic tournament and needs one decision, taken once. Mixing the two would
    bury three real defects under fifty routine lines.
    """
    notices = []
    risk = placement_risk(snapshot, list(registrations))
    if risk:
        notices.append(risk)
    return notices


def migration_blockers(tournament: dict, snapshot: dict, registrations: list[dict] = ()) -> list[dict]:
    """Reasons this tournament cannot move yet, each with what to do about it.

    Deliberately reported per tournament instead of aborting the whole run: the
    point of a dry run is to see the full picture once, not to stop at the first
    surprise.
    """
    blockers: list[dict] = []
    matches = snapshot.get("matches") or []
    format_key = tournament.get("format")
    capability = find_format_capability(format_key)

    if snapshot.get("mixed_source"):
        blockers.append({
            "code": "mixed_source",
            "detail": "Das Turnier hat echte Spiele in beiden Speichern.",
            "action": "Vor der Migration klären, welcher Speicher gilt.",
        })

    if capability and capability.current_write_model == "external":
        blockers.append({
            "code": "external_format",
            "detail": f"Format {format_key} wird nicht über die Turnier-Engines geführt.",
            "action": "Bleibt außerhalb der Migration.",
        })

    open_matches = [match for match in matches if match.get("status") in OPEN_STATUSES]
    if open_matches:
        blockers.append({
            "code": "open_matches",
            "detail": f"{len(open_matches)} Spiele sind offen oder angefochten.",
            "action": "Erst entscheiden lassen, dann migrieren.",
        })

    if format_key in KNOCKOUT_FORMATS:
        drawn = [
            match for match in matches
            if match.get("status") == "completed" and not _winner(match)
        ]
        if drawn:
            blockers.append({
                "code": "decided_without_winner",
                "detail": f"{len(drawn)} abgeschlossene K.-o.-Spiele haben keinen eindeutigen Sieger.",
                "action": "Sieger nachtragen - der Turnierbaum kann sie sonst nicht weiterleiten.",
            })

    orphaned = [
        match for match in matches
        if match.get("status") in TERMINAL and not _participants(match)
    ]
    if orphaned:
        blockers.append({
            "code": "result_without_participants",
            "detail": f"{len(orphaned)} entschiedene Spiele haben keine Teilnehmer mehr.",
            "action": "Vermutlich Altlast - vor der Migration prüfen.",
        })

    issues = validate_competition_graph(snapshot).get("issues") or []
    if issues:
        counted: dict[str, int] = {}
        for issue in issues:
            counted[issue.get("type") or "unknown"] = counted.get(issue.get("type") or "unknown", 0) + 1
        blockers.append({
            "code": "graph_issues",
            "detail": "Strukturprüfung meldet: " + ", ".join(
                f"{name} ({count}x)" for name, count in sorted(counted.items())),
            "action": "Struktur reparieren oder neu aufbauen.",
        })

    return blockers


def tournament_report(
    tournament: dict,
    snapshot: dict,
    registrations: list[dict],
    *,
    groups: list[dict] = (),
) -> dict:
    """One tournament's row in the dry-run report. Contains no member names."""
    legacy = [m for m in snapshot.get("matches") or []
              if m.get("source", {}).get("engine") == "legacy"]
    stage = [m for m in snapshot.get("matches") or []
             if m.get("source", {}).get("engine") == "stage"]
    engine = engine_of_record(legacy, stage)
    capability = find_format_capability(tournament.get("format"))
    fingerprint = tournament_fingerprint(tournament, snapshot, registrations, groups=groups)
    blockers = migration_blockers(tournament, snapshot, registrations)

    return {
        "id": tournament.get("id"),
        "slug": tournament.get("slug"),
        "title": tournament.get("title"),
        "format": tournament.get("format"),
        "status": tournament.get("status"),
        "engine": engine,
        "needs_migration": engine == CLASSIC,
        "target_engine": GRAPH if capability and capability.stage_generator_available else None,
        "participant_count": len(fingerprint["participants"]),
        "match_count": fingerprint["match_count"],
        "decided_count": fingerprint["decided_count"],
        "digest": fingerprint_digest(fingerprint),
        "fingerprint": fingerprint,
        "blockers": blockers,
        "notices": migration_notices(snapshot, registrations),
        "ready": not blockers and engine is not None,
    }


def compare_reports(before: dict, after: dict) -> dict:
    """Diff two dry-run baselines, tournament by tournament."""
    before_by_id = {row["id"]: row for row in before.get("tournaments") or []}
    after_by_id = {row["id"]: row for row in after.get("tournaments") or []}

    changed: list[dict] = []
    for tournament_id, previous in before_by_id.items():
        current = after_by_id.get(tournament_id)
        if current is None:
            changed.append({"id": tournament_id, "title": previous.get("title"),
                            "problem": "fehlt jetzt", "differences": []})
            continue
        if previous["digest"] == current["digest"]:
            continue
        changed.append({
            "id": tournament_id,
            "title": previous.get("title"),
            "problem": "Fingerabdruck weicht ab",
            "differences": fingerprint_differences(previous["fingerprint"], current["fingerprint"]),
        })

    return {
        "compared": len(before_by_id),
        "unchanged": len(before_by_id) - len(changed),
        "changed": changed,
        "new": sorted(set(after_by_id) - set(before_by_id)),
        "equivalent": not changed,
    }


def fingerprint_differences(previous: dict, current: dict) -> list[str]:
    """Say what moved, in words a person can act on."""
    differences: list[str] = []
    for field, label in (
        ("participants", "Teilnehmer"),
        ("standings", "Tabellenreihenfolge"),
        ("match_count", "Anzahl Spiele"),
        ("decided_count", "Anzahl entschiedener Spiele"),
    ):
        if previous.get(field) != current.get(field):
            differences.append(f"{label}: vorher {_short(previous.get(field))}, jetzt {_short(current.get(field))}")

    previous_results = previous.get("results") or {}
    current_results = current.get("results") or {}
    for key in sorted(set(previous_results) | set(current_results)):
        if previous_results.get(key) != current_results.get(key):
            differences.append(
                f"Spiel [{key}]: Sieger vorher {previous_results.get(key)}, jetzt {current_results.get(key)}")

    previous_places = previous.get("placements") or {}
    current_places = current.get("placements") or {}
    for rank in sorted(set(previous_places) | set(current_places), key=lambda value: int(value)):
        if previous_places.get(rank) != current_places.get(rank):
            differences.append(
                f"Platz {rank}: vorher {previous_places.get(rank)}, jetzt {current_places.get(rank)}")
    return differences


def _short(value) -> str:
    if isinstance(value, list):
        return f"{len(value)} Einträge"
    return str(value)


def census_verdict(census: dict) -> dict:
    """Read a store census: is the classic store still holding anything?

    The per-tournament survey only counts matches that belong to a tournament
    that still exists and has really been played. This looks at the raw
    collections instead, because the question for retiring the old store is a
    different one: is there *anything* left in it - drafts and orphans included.
    """
    classic_total = int(census.get("matches") or 0)
    orphans = int(census.get("orphaned_matches") or 0)
    drafts = int(census.get("preview_matches") or 0)
    real = max(0, classic_total - drafts)

    if classic_total == 0:
        state = "empty"
        summary = "Der klassische Speicher ist leer."
    elif real == 0:
        state = "drafts_only"
        summary = f"Im klassischen Speicher liegen nur {drafts} Entwürfe, keine gespielten Partien."
    else:
        state = "in_use"
        summary = f"Im klassischen Speicher liegen {real} echte Partien."

    return {
        "state": state,
        "summary": summary,
        "classic_total": classic_total,
        "classic_real": real,
        "classic_drafts": drafts,
        "orphaned_matches": orphans,
        "graph_total": int(census.get("matches_v2") or 0),
        "retirable": state in {"empty", "drafts_only"} and orphans == 0,
    }


def summarize(rows: list[dict]) -> dict:
    """The headline numbers of one dry run."""
    by_engine: dict[str, int] = {}
    blockers: dict[str, int] = {}
    notices: dict[str, int] = {}
    for row in rows:
        key = row.get("engine") or "leer"
        by_engine[key] = by_engine.get(key, 0) + 1
        for blocker in row.get("blockers") or []:
            blockers[blocker["code"]] = blockers.get(blocker["code"], 0) + 1
        for notice in row.get("notices") or []:
            notices[notice["code"]] = notices.get(notice["code"], 0) + 1
    return {
        "tournaments": len(rows),
        "by_engine": dict(sorted(by_engine.items())),
        "needs_migration": sum(1 for row in rows if row.get("needs_migration")),
        "ready": sum(1 for row in rows if row.get("ready")),
        "blocked": sum(1 for row in rows if row.get("blockers")),
        "blockers": dict(sorted(blockers.items())),
        "notices": dict(sorted(notices.items())),
    }
