"""Turnierleitung am Handy (#1156): was die Ansicht „Turnierleitung“ und das Ergebnis-Fenster (#1370) brauchen.

Je offenem Spiel steht hier alles, um ohne Zahlentastatur einzutragen: wer spielt, welches Format (Duell, Best-of oder
Durchgang), wie gewertet wird, ob Gleichstand erlaubt ist und wohin der Sieger weiterrückt („weiter ins Halbfinale“) -
damit das Fenster vor dem Speichern einen Satz in Worten zeigen kann. Dieselbe Beschreibung bekommt die Matchseite
für die Turnierleitung (``entry_info``), damit Matchplan, Stationen, Matchseite und Turnierleitung dasselbe Fenster
öffnen.

Sortiert wird wie gewünscht: zuerst, wo ein Ergebnis fehlt, dann nach Station.
"""
from __future__ import annotations

import re
from datetime import datetime

from match_rules import match_allows_draw
from models import now_utc
from services.match_attention import attention_items
from services.match_disputes import category_label, open_dispute
from services.match_duration import load_duration_game
from services.match_notifications import results_summary
from services.match_proofs import visible_proofs
from services.match_timing import MISSING_AFTER_MINUTES, OPEN_STATUSES, RUNNING_STATUSES, filled_slots, registration_name, timing
from services.match_v2_results import _advancement_result_rank, _ranking_mode, has_result, resolve_best_of
from services.result_hold import hold_view
from services.round_labels import round_label, rounds_by_section, stage_kind
from services.station_labels import attach_station_info
from services.draw_show import lead_cards
from services.tournament_permissions import (
    RESULT_STAFF_ROLES,
    STRUCTURE_STAFF_ROLES,
    has_tournament_staff_permission,
    is_global_tournament_staff,
)
from services.v2_match_flows import latest_reports
from services.v2_result_submission import eliminated_registration_ids

RECENT_LIMIT = 6


def best_of(match: dict, stage: dict | None, tournament: dict | None) -> int:
    # Dieselbe Stelle wie die Prüfung des Ergebnisses (#1035): das Fenster zeigt, was der Server annimmt.
    return resolve_best_of(match, stage, tournament)


def into(label: str) -> str:
    """„ins Halbfinale“, „in Runde 3“, „in die Loser Runde 2“ - wohin es weitergeht, als halber Satz."""
    text = (label or "").strip()
    if not text:
        return ""
    if re.match(r"^Runde\b", text):
        return f"in {text}"
    if re.match(r"^(Loser|Winner) Runde\b", text):
        return f"in die {text}"
    return f"ins {text}"


def advance_texts(match: dict, stage_matches: list[dict], stage: dict | None, tournament: dict | None) -> dict:
    """Je Platz, wohin es weitergeht: {"1": {"text": "ins Halbfinale", "flow": "W"}}."""
    by_id = {row.get("id"): row for row in stage_matches if row.get("id")}
    by_key = {row.get("match_key"): row for row in stage_matches if row.get("match_key")}
    max_rounds = rounds_by_section(stage_matches)
    out: dict = {}
    for advancement in match.get("advancement") or []:
        target = by_id.get(advancement.get("to_match_id")) or by_key.get(advancement.get("to_match_key"))
        if not target:
            continue
        kind = stage_kind((stage or {}).get("stage_type"), (tournament or {}).get("format"), target.get("match_type"))
        rank = _advancement_result_rank(match, advancement)
        if rank < 1:
            continue
        out[str(rank)] = {"text": into(round_label(target, max_rounds=max_rounds, kind=kind)), "flow": advancement.get("flow") or "W"}
    return out


def _result_rows(match: dict) -> list[dict]:
    rows = []
    for row in match.get("results") or []:
        clean = {"registration_id": row.get("registration_id"), "rank": row.get("rank")}
        for key in ("score", "points", "time_ms"):
            if row.get(key) is not None:
                clean[key] = row[key]
        for key in ("dnf", "forfeit"):
            if row.get(key):
                clean[key] = True
        rows.append(clean)
    return rows


def entry_info(match: dict, *, tournament: dict | None, stage: dict | None, stage_matches: list[dict],
               regs_by_id: dict[str, dict], viewer_id: str | None = None) -> dict:
    """Alles, was das Ergebnis-Fenster für ein Spiel braucht - gleich für Turnierleitung, Matchplan, Stationen und
    Matchseite (#1370)."""
    slots = filled_slots(match)
    participants = [
        {"registration_id": slot["registration_id"], "name": registration_name(regs_by_id.get(slot["registration_id"])),
         "slot": slot.get("slot")}
        for slot in slots
    ]
    kind = "duel" if len(participants) == 2 else "heat"
    rows = _result_rows(match)
    return {
        "id": match.get("id"),
        "match_key": match.get("match_key"),
        "label": match.get("round_name") or match.get("matchday_label") or match.get("match_key") or "Spiel",
        "stage_name": (stage or {}).get("name") or (stage or {}).get("title"),
        "status": match.get("status"),
        "kind": kind,
        "best_of": best_of(match, stage, tournament) if kind == "duel" else 1,
        "ranking_mode": _ranking_mode(match),
        "allows_draw": match_allows_draw(match),
        "participants": participants,
        "advance": advance_texts(match, stage_matches, stage, tournament),
        "has_result": has_result(match),
        "result": rows,
        "result_summary": results_summary(rows, regs_by_id) if rows else None,
        "result_note": (match.get("result_meta") or {}).get("note"),
        "hold": hold_view(match, viewer_id),
        "station_id": match.get("station_id"),
        "station_text": match.get("station_text") or "",
        "scheduled_at": match.get("scheduled_at"),
        "started_at": match.get("started_at"),
        "duration_minutes": match.get("duration_minutes"),
    }


def dispute_card(match: dict, regs_by_id: dict[str, dict], photos: dict[str, dict], names: dict[str, str]) -> dict | None:
    """Ein Streitfall für die Turnierleitung (#1158): wer was meldet, Foto, das eingetragene Ergebnis und die
    Meldungen der Spieler - alles, um mit einem Tipp zu entscheiden."""
    row = open_dispute(match)
    if not row:
        return None
    reports = [
        {"by": registration_name(regs_by_id.get(key)), "summary": results_summary(report.get("results"), regs_by_id),
         "at": report.get("at"), "photo": photos.get(report.get("photo_id") or "")}
        for key, report in latest_reports(match.get("reports") or []).items()
    ]
    return {
        "at": row.get("at"),
        "by": registration_name(regs_by_id.get(row.get("registration_id"))) if row.get("registration_id") else "Turnierleitung",
        "category": row.get("category") or "other",
        "category_label": category_label(row.get("category")),
        "text": row.get("reason") or "",
        "photo": photos.get(row.get("photo_id") or ""),
        "result_at": match.get("completed_at"),
        "result_by": names.get(match.get("completed_by") or ""),
        "reports": reports,
    }


def _photo_ids(match: dict) -> list[str]:
    ids = [row.get("photo_id") for row in match.get("disputes") or [] if isinstance(row, dict)]
    ids += [row.get("photo_id") for row in match.get("reports") or [] if isinstance(row, dict)]
    return [photo_id for photo_id in ids if photo_id]


async def _result_scope(db, user: dict, tournament_id: str):
    """Darf diese Person für ein Spiel eintragen? Einmal laden, je Spiel nur noch nachsehen - dieselbe Regel wie
    ``has_match_result_permission`` (ganzes Turnier, Phase, Gruppe, Station oder genau dieses Spiel)."""
    if is_global_tournament_staff(user):
        return lambda match: True
    assignments = await db.tournament_staff_assignments.find(
        {"tournament_id": tournament_id, "user_id": user.get("id"), "is_active": {"$ne": False},
         "role": {"$in": sorted(RESULT_STAFF_ROLES)}},
        {"_id": 0, "scope": 1, "scope_id": 1},
    ).to_list(100)
    fields = {"match": "id", "stage": "stage_id", "group": "group_id", "station": "station_id"}

    def allowed(match: dict) -> bool:
        for row in assignments:
            scope = row.get("scope") or "tournament"
            if scope == "tournament" or not row.get("scope_id"):
                return True
            field = fields.get(scope)
            if field and match.get(field) == row.get("scope_id"):
                return True
        return False

    return allowed


def _station_sort_key(text: str) -> tuple:
    """„PC 2“ vor „PC 10“: Zahlen in Stationsnamen zählen als Zahlen."""
    parts = re.split(r"(\d+)", (text or "").lower())
    return tuple(int(part) if part.isdigit() else part for part in parts)


def lead_sort_key(item: dict) -> tuple:
    timing_info = item.get("timing") or {}
    missing = bool(timing_info.get("missing")) or item.get("status") == "disputed"
    station = item.get("station_text") or ""
    return (
        0 if missing else 1,
        -(timing_info.get("overdue_minutes") or 0) if missing else 0,
        0 if station else 1,
        _station_sort_key(station),
        item.get("scheduled_at") or "9999",
        str(item.get("match_key") or ""),
    )


async def lead_view(db, tournament: dict, user: dict, *, now: datetime | None = None) -> dict:
    """Die Ansicht „Turnierleitung“ eines Turniers: offene Spiele (zuerst, was fehlt), zuletzt Eingetragenes."""
    now = now or now_utc()
    tournament_id = tournament["id"]
    matches = await db.matches_v2.find({"tournament_id": tournament_id}, {"_id": 0}).to_list(3000)
    await attach_station_info(db, matches)
    stages = {
        row["id"]: row for row in await db.tournament_stages.find(
            {"tournament_id": tournament_id}, {"_id": 0, "creation_key": 0}).to_list(50) if row.get("id")
    }
    registrations = await db.tournament_registrations.find(
        {"tournament_id": tournament_id}, {"_id": 0, "id": 1, "display_name": 1, "ingame_name": 1, "team_name": 1}).to_list(2000)
    regs_by_id = {row["id"]: row for row in registrations if row.get("id")}
    by_stage: dict[str, list[dict]] = {}
    for match in matches:
        by_stage.setdefault(match.get("stage_id") or "", []).append(match)
    may_enter = await _result_scope(db, user, tournament_id)
    # Streitfälle (#1158): Fotos (nur nach der Bildprüfung) und wer das Ergebnis eingetragen hat.
    disputed = [match for match in matches if str(match.get("status") or "") == "disputed"]
    photos = await visible_proofs(db, [photo_id for match in disputed for photo_id in _photo_ids(match)])
    actor_ids = sorted({match.get("completed_by") for match in disputed if match.get("completed_by")})
    names = {
        row["id"]: row.get("display_name") or row.get("username") or "Turnierleitung"
        for row in await db.users.find({"id": {"$in": actor_ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(len(actor_ids) + 1)
    } if actor_ids else {}

    game = await load_duration_game(db, tournament)

    def describe(match: dict) -> dict:
        info = entry_info(match, tournament=tournament, stage=stages.get(match.get("stage_id") or ""),
                          stage_matches=by_stage.get(match.get("stage_id") or "", []), regs_by_id=regs_by_id,
                          viewer_id=user.get("id"))
        info["timing"] = timing(match, tournament, now, stage=stages.get(match.get("stage_id") or ""), game=game)
        info["can_enter"] = may_enter(match)
        if str(match.get("status") or "") == "disputed":
            info["dispute"] = dispute_card(match, regs_by_id, photos, names)
        return info

    open_items = [
        describe(match) for match in matches
        if str(match.get("status") or "pending") in OPEN_STATUSES and len(filled_slots(match)) >= 2
        and not match.get("is_preview")
    ]
    open_items.sort(key=lead_sort_key)
    # „Braucht Aufmerksamkeit“ (#1160): dieselben Spiele, als Fälle mit Knopf; dazu die Stationen zum Umlegen.

    stations = await db.stations.find({"tournament_id": tournament_id}, {"_id": 0}).to_list(500)
    attention = attention_items(tournament, matches, stations, regs_by_id, now, stages=stages, game=game)
    # Show-Auslosung (#1590): „Auslosung bereit · N Namen“ mit „Jetzt auslosen“ für die Leitung mit Aufbau-Recht.
    can_draw = await has_tournament_staff_permission(user, tournament_id, STRUCTURE_STAFF_ROLES)
    draws = lead_cards(matches, tournament, stages, regs_by_id, can_draw=can_draw,
                       eliminated=await eliminated_registration_ids(db, tournament_id))
    recent = sorted(
        [match for match in matches if str(match.get("status") or "") in {"completed", "forfeit"} and match.get("completed_at")],
        key=lambda match: str(match.get("completed_at") or ""), reverse=True,
    )[:RECENT_LIMIT]
    return {
        "tournament": {
            "id": tournament_id, "slug": tournament.get("slug"), "title": tournament.get("title"),
            "status": tournament.get("status"), "event_mode": tournament.get("event_mode"),
        },
        "now": now.isoformat(),
        "missing_after_minutes": MISSING_AFTER_MINUTES,
        "matches": open_items,
        "attention": attention,
        "draws": draws,
        "stations": [
            {"id": row.get("id"), "name": row.get("name") or row.get("label") or "Station", "status": row.get("status") or "free",
             "busy": bool(row.get("current_match_id"))}
            for row in sorted(stations, key=lambda row: _station_sort_key(row.get("name") or ""))
        ],
        "recent": [describe(match) for match in recent],
        "counts": {
            "disputes": sum(1 for item in open_items if item.get("dispute")),
            "attention": len(attention),
            "open": len(open_items),
            "running": sum(1 for item in open_items if item["status"] in RUNNING_STATUSES or item.get("started_at")),
            "missing": sum(1 for item in open_items if (item.get("timing") or {}).get("missing")),
        },
    }
