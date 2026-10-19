"""„Braucht Aufmerksamkeit“ für die Turnierleitung (#1160): was hängt, mit dem passenden Knopf.

Je Turnier eine Liste, die der Server jedes Mal frisch rechnet - Erledigtes verschwindet von selbst:

- „Ergebnis fehlt“ (``rm-<spiel>``): geplante Zeit plus Dauer plus 5 Minuten vorbei - oder, ohne geplante Zeit, so lange
  an einer Station gestartet. Ohne Zeit und ohne Station gibt es diesen Fall nicht. Knopf „Eintragen“.
- „Streitfall offen“ (``ds-<spiel>``): ein Dispute wartet auf Entscheidung (#1134, #1158). Knopf „Ansehen“.
- „Meldungen weichen ab“ (``rc-<spiel>``): zwei Spieler-Meldungen passen nicht zusammen (#1132). Knopf „Eintragen“.
- „Station defekt“ (``st-<station>``): eine defekte Station, auf die noch Spiele warten. Knopf „Umlegen“.
- „Nicht erschienen?“ (``ns-<spiel>``): die Frist ist um, der Server schlägt „kampflos verloren“ vor (#1551; im Lauf
  mit mehr als zwei Spielern: nur markieren, der Lauf bleibt offen, #1823). Knöpfe „<Name> nicht erschienen“ und
  „Verlängern“; die Nachricht dazu schickt der Fristen-Job (match_deadline_sweep).

Jeder Fall hat eine eigene Adresse: /tournaments/<slug>/leitung?fall=<id> - die Startseite der Verwaltung und die
Benachrichtigungen verlinken genau dorthin.

Benachrichtigung: je neuem Fall genau eine, an die Turnierleitung mit Ergebnis-Recht für dieses Spiel (bei Stationen
auch die Stationsleitung der Station) - im wichtigen Android-Kanal („Aufrufe & Spielstart“, Art ``match_attention``).
Streitfälle und abweichende Meldungen melden sich schon beim Eintreffen (match_notifications); der Sammler hier
schickt nur „Ergebnis fehlt“ und „Station defekt“, weil die ohne eigenes Ereignis entstehen. Spieler und Unbeteiligte
bekommen nichts.
"""
from __future__ import annotations

import logging
from datetime import datetime

from models import now_utc
from services.match_deadlines import NO_SHOW_RULE_TEXT, no_show_action
from services.match_disputes import category_label, open_dispute
from services.match_duration import load_duration_game
from services.match_timing import OPEN_STATUSES, filled_slots, registration_name, timing
from services.station_labels import attach_station_info, station_text
from services.tournament_permissions import result_staff_user_ids
from services.user_notifications import create_user_notification
from services.v2_match_flows import reports_conflict

logger = logging.getLogger("tls.match_attention")

ACTIVE_TOURNAMENT_STATUSES = {"check_in", "live", "paused"}
WAITING_STATUSES = {"pending", "ready", "scheduled", "in_progress", "running", "waiting_result"}
NO_SHOW_STATUSES = {"ready", "scheduled"}


def _names(match: dict, regs_by_id: dict[str, dict]) -> str:
    names = [registration_name(regs_by_id.get(slot["registration_id"])) for slot in filled_slots(match)]
    return " gegen ".join(names) if len(names) == 2 else f"{len(names)} Teilnehmer"


def _label(match: dict) -> str:
    return match.get("round_name") or match.get("matchday_label") or match.get("match_key") or "Spiel"


def attention_items(tournament: dict, matches: list[dict], stations: list[dict], regs_by_id: dict[str, dict],
                    now: datetime, *, stages: dict[str, dict] | None = None, game: dict | None = None) -> list[dict]:
    """Die Fälle eines Turniers - ``matches`` mit Stationstext (attach_station_info)."""
    items: list[dict] = []
    for match in matches:
        status = str(match.get("status") or "pending")
        if status not in OPEN_STATUSES or len(filled_slots(match)) < 2 or match.get("is_preview"):
            continue
        base = {"match_id": match.get("id"), "station_text": match.get("station_text") or "", "label": _label(match),
                "names": _names(match, regs_by_id)}
        if status == "disputed":
            row = open_dispute(match) or {}
            by = registration_name(regs_by_id.get(row.get("registration_id"))) if row.get("registration_id") else "Turnierleitung"
            items.append({**base, "id": f"ds-{match.get('id')}", "kind": "dispute", "title": "Streitfall gemeldet",
                          "detail": f"{by}: „{category_label(row.get('category'))}“", "action": "view", "since": row.get("at")})
            continue
        if isinstance(match.get("pending_result"), dict):
            continue
        proposal = match.get("no_show_proposal")
        if isinstance(proposal, dict) and not proposal.get("decision") and status in NO_SHOW_STATUSES and not match.get("started_at"):
            items.append({**base, "id": f"ns-{match.get('id')}", "kind": "no_show", "title": "Nicht erschienen?",
                          "detail": f"{proposal.get('minutes') or 0} Min. {NO_SHOW_RULE_TEXT.get(proposal.get('rule'), '')} um – "
                                    f"{no_show_action(match)}.",
                          "action": "no_show", "since": proposal.get("due_at"),
                          "participants": [{"registration_id": slot["registration_id"],
                                            "name": registration_name(regs_by_id.get(slot["registration_id"]))}
                                           for slot in filled_slots(match)]})
            continue
        if reports_conflict(match.get("reports") or []):
            items.append({**base, "id": f"rc-{match.get('id')}", "kind": "report_conflict", "title": "Meldungen weichen ab",
                          "detail": "Die Spieler melden verschiedene Ergebnisse.", "action": "enter", "since": None})
            continue
        info = timing(match, tournament, now, stage=(stages or {}).get(match.get("stage_id") or ""), game=game)
        if info.get("missing"):
            items.append({**base, "id": f"rm-{match.get('id')}", "kind": "result_missing", "title": "Ergebnis fehlt",
                          "detail": f"{info.get('overdue_minutes') or 0} Min. über der Zeit", "action": "enter",
                          "since": info.get("due_at"), "overdue_minutes": info.get("overdue_minutes")})
    by_station: dict[str, list[dict]] = {}
    for match in matches:
        if match.get("station_id") and str(match.get("status") or "pending") in WAITING_STATUSES and len(filled_slots(match)) >= 2:
            by_station.setdefault(match["station_id"], []).append(match)
    for station in stations:
        waiting = by_station.get(station.get("id") or "", [])
        if station.get("status") != "broken" or not waiting:
            continue
        count = len(waiting)
        items.append({
            "id": f"st-{station['id']}", "kind": "station_broken", "title": "Station defekt", "action": "move",
            "station_id": station["id"], "station_text": station_text(station.get("name") or station.get("label"), station.get("device_type")) or station.get("name") or "Station",
            "label": _label(waiting[0]), "names": _names(waiting[0], regs_by_id),
            "detail": f"{count} Spiel wartet darauf" if count == 1 else f"{count} Spiele warten darauf",
            "match_ids": [match.get("id") for match in waiting], "since": station.get("broken_at") or station.get("updated_at"),
        })
    order = {"dispute": 0, "no_show": 1, "station_broken": 2, "result_missing": 3, "report_conflict": 4}
    items.sort(key=lambda item: (order.get(item["kind"], 9), -(item.get("overdue_minutes") or 0), item.get("station_text") or ""))
    return items


async def tournament_attention(db, tournament: dict, *, now: datetime | None = None) -> tuple[list[dict], dict[str, dict]]:
    """Die Fälle eines Turniers aus der Datenbank - und die Spiele dazu (für die Empfänger)."""
    now = now or now_utc()
    matches = await db.matches_v2.find({"tournament_id": tournament["id"], "status": {"$in": sorted(OPEN_STATUSES)}}, {"_id": 0}).to_list(3000)
    await attach_station_info(db, matches)
    stations = await db.stations.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(500)
    registrations = await db.tournament_registrations.find(
        {"tournament_id": tournament["id"]}, {"_id": 0, "id": 1, "display_name": 1, "ingame_name": 1, "team_name": 1}).to_list(2000)
    regs_by_id = {row["id"]: row for row in registrations if row.get("id")}
    stages = {row["id"]: row for row in await db.tournament_stages.find(
        {"tournament_id": tournament["id"]}, {"_id": 0, "id": 1, "settings": 1}).to_list(200) if row.get("id")}
    items = attention_items(tournament, matches, stations, regs_by_id, now, stages=stages, game=await load_duration_game(db, tournament))
    return items, {match["id"]: match for match in matches if match.get("id")}


async def sweep(db, *, now: datetime | None = None) -> int:
    """Je neuem Fall „Ergebnis fehlt“ oder „Station defekt“ genau eine Benachrichtigung an die Turnierleitung."""
    now = now or now_utc()
    sent = 0
    tournaments = await db.tournaments.find({"status": {"$in": sorted(ACTIVE_TOURNAMENT_STATUSES)}}, {"_id": 0, "creation_key": 0}).to_list(100)
    for tournament in tournaments:
        items, matches = await tournament_attention(db, tournament, now=now)
        for item in items:
            if item["kind"] not in {"result_missing", "station_broken"}:
                continue
            related = [matches[match_id] for match_id in (item.get("match_ids") or [item.get("match_id")]) if match_id in matches]
            recipients: set[str] = set()
            for match in related:
                recipients |= await result_staff_user_ids(db, match)
            key = tournament.get("slug") or tournament["id"]
            where = f"{item['station_text']} · " if item.get("station_text") else ""
            title = f"Ergebnis fehlt: {item['station_text']}" if item["kind"] == "result_missing" and item.get("station_text") else (
                "Ergebnis fehlt" if item["kind"] == "result_missing" else f"Station defekt: {item['station_text']}")
            body = (f"{tournament.get('title') or 'Turnier'} · {item['label']}: {where}{item['names']} ist {item.get('overdue_minutes') or 0} "
                    "Minuten über der Zeit.") if item["kind"] == "result_missing" else (
                f"{tournament.get('title') or 'Turnier'}: {item['station_text']} ist defekt - {item['detail']}. Bitte umlegen.")
            for user_id in sorted(recipients):
                if await create_user_notification(
                    user_id, title, body, url=f"/tournaments/{key}/leitung?fall={item['id']}", kind="match_attention",
                    meta={"category": "tournament_updates", "tournament_id": tournament["id"], "match_id": item.get("match_id"),
                          "station_id": item.get("station_id"), "reason": item["kind"],
                          # Ein Fall, eine Nachricht: neu nur, wenn sich Zeitpunkt (Plan) oder Defekt ändern.
                          "dedupe_key": f"attention:{item['id']}:{item.get('since') or ''}"},
                ):
                    sent += 1
    return sent
