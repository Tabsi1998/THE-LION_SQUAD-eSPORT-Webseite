"""Turnier-Meldungen (#1209): „Du bist weiter!“, „Ausgeschieden“, „Der Turnierbaum ist da“, „Pause bis 14:30“.

Alle unter dem Thema „Turnier-Updates“ (abschaltbar), nur an Beteiligte - bei Teams an jedes Mitglied (#1136) - und je
Ereignis höchstens einmal (``meta.dedupe_key``):

- **Weiter / Loser Bracket / ausgeschieden** nach einem bestätigten Ergebnis (``notify_match_progress``). Gelesen wird aus
  den Weiterleitungen des Spiels: Wer über einen Sieger- oder Platz-Weg (``W``/``R``) weiterkommt, ist weiter; wer nur
  einen Verlierer-Weg (``L``) hat, spielt im Loser Bracket weiter; wer keinen Weg hat, ist ausgeschieden. Wer nicht
  erschienen ist, kommt nie über den Sieger-Weg weiter (#1823). Spiele ohne Weiterleitung (Finale, Gruppe, Liga-Spieltag)
  melden nichts - dafür gibt es „Turnier beendet“ bzw. die Tabelle. Bei Durchgängen steht der Platz dabei („Platz 2 im
  Durchgang C: weiter“, „Ausgeschieden: Platz 5 von 8“).
- **Turnierbaum da** beim Start (``notify_bracket_ready``): einmal je Turnier, mit dem eigenen ersten Spiel als Ziel - nicht
  bei Liga-Staffeln (eigene Meldungen der Liga).
- **Pause** beim Pausieren und wenn sich „Pause bis“ ändert (``notify_pause``): einmal je Pause und Uhrzeit.
- Alle Startwege (Leitung, Zeitplan, erstes Spiel an einer Station) rufen ``status_changed``.
- Eine Korrektur erzeugt die passende neue Meldung (Schlüssel mit Ergebnis-Stand), die überholte wird als überholt markiert.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from models import now_utc
from services.log_safe import log_safe

logger = logging.getLogger("tls.tournament_progress")

VIENNA = ZoneInfo("Europe/Vienna")
KIND_PROGRESS = "tournament_progress"
KIND_BRACKET = "tournament_bracket"
KIND_PAUSE = "tournament_pause"
DONE_STATUSES = frozenset({"completed", "forfeit"})
ACTIVE_REGISTRATIONS = ("approved", "checked_in")
OPEN_MATCH_STATUSES = ("pending", "scheduled", "ready", "live", "called", "in_progress")
# So lange nach einem Hinweis der Turnierleitung an das Turnier gilt eine Pause als schon angesagt.
NOTICE_COVERS_MINUTES = 5


def _rank(match: dict, edge: dict, qualifiers: int) -> int:
    """Der Platz im Spiel, den eine Weiterleitung meint. ``W`` und ``R`` nennen ihn direkt; ``L`` zählt ab den
    Weiterkommenden (services/custom_bracket.py: „L picks non-qualified ranks after the configured qualifiers“) - im Duell
    ist ``L:A:1`` Platz 2. Mit ``qualifiers_per_match`` rechnet die Engine selbst (auch alte absolute Schemata)."""
    flow = str(edge.get("flow") or "R").upper()
    rank = int(edge.get("rank") or 0)
    if flow != "L":
        return rank
    if "qualifiers_per_match" in (match.get("settings") or {}):
        from services.match_v2_results import _advancement_result_rank

        return _advancement_result_rank(match, edge)
    return qualifiers + rank


def outcomes(match: dict) -> dict[str, tuple[str, int]]:
    """Je Anmeldung ``(Ausgang, Platz)`` - ``advanced``, ``lower`` oder ``eliminated``. Leer, wenn das Spiel nichts sagt."""
    if str(match.get("status") or "") not in DONE_STATUSES:
        return {}
    edges = match.get("advancement") or []
    if edges:
        results = [row for row in match.get("results") or [] if row.get("registration_id") and row.get("rank")]
        winner_ranks = {_rank(match, edge, 0) for edge in edges if str(edge.get("flow") or "R").upper() != "L"}
        loser_ranks = {_rank(match, edge, len(winner_ranks)) for edge in edges if str(edge.get("flow") or "").upper() == "L"}
    elif match.get("next_match_id") and match.get("winner_id") and match.get("loser_id"):
        # Alte Spiele: Sieger über ``next_match_id``, Verlierer über ``next_loser_match_id`` (Double Elimination).
        results = [{"registration_id": match["winner_id"], "rank": 1}, {"registration_id": match["loser_id"], "rank": 2}]
        winner_ranks = {1}
        loser_ranks = {2} if match.get("next_loser_match_id") else set()
    else:
        return {}
    if len(results) < 2:
        return {}  # Freilos: niemand hat gespielt
    if is_grand_final_with_decider(match):
        # Grand Final mit Entscheidungsspiel (#1549): beide Wege führen ins Reset-Spiel - ob es kommt, entscheidet das Zielspiel.
        return {row["registration_id"]: ("decider_won" if int(row["rank"]) == 1 else "decider_lost", int(row["rank"])) for row in results}
    found: dict[str, tuple[str, int]] = {}
    for row in results:
        rank = int(row["rank"])
        if rank in winner_ranks and not row.get("forfeit"):
            found[row["registration_id"]] = ("advanced", rank)
        elif rank in loser_ranks or (row.get("forfeit") and loser_ranks and rank in winner_ranks):
            found[row["registration_id"]] = ("lower", rank)
        else:
            found[row["registration_id"]] = ("eliminated", rank)
    return found


# Runden, vor denen „in“ steht („in Runde 1“, „in Gruppe B“) - sonst „im“ („im Viertelfinale“, „im Durchgang C“).
IN_WORDS = frozenset({"Runde", "Gruppe", "Phase", "Vorrunde", "Zwischenrunde", "Hauptrunde", "Finalrunde", "Qualifikation", "Staffel"})


def is_grand_final_with_decider(match: dict) -> bool:
    """Das Grand Final mit Reset (#1549, services/custom_bracket.py): ein **Duell**, dessen Plätze 1 und 2 beide als Sieger-Weg
    in dasselbe Spiel gehen (``W:X:1`` und ``W:X:2``). Ein Lauf (``ffa``) mit ``W1→C, W2→C`` ist das nicht - dort gehen die
    ersten zwei weiter und die übrigen scheiden aus (Prüfung 26.11.). Erkannt wird am Aufbau, nicht am Namen: Eigene Schemata
    dürfen das Grand Final anders nennen."""
    if str(match.get("match_type") or "duel") == "ffa":
        return False
    if len([row for row in match.get("results") or [] if row.get("registration_id")]) != 2:
        return False
    edges = match.get("advancement") or []
    if len(edges) != 2 or any(str(edge.get("flow") or "").upper() != "W" for edge in edges):
        return False
    targets = {edge.get("to_match_id") or edge.get("to_match_key") for edge in edges}
    return len(targets) == 1 and {int(edge.get("rank") or 0) for edge in edges} == {1, 2}


def _round(match: dict) -> str:
    """Der Name der Runde - ohne Namen „Runde N“, ohne beides leer."""
    return str(match.get("round_name") or (f"Runde {match['round']}" if match.get("round") else ""))


def _in(where: str) -> str:
    first = where.split(" ", 1)[0]
    return f"in {where}" if first in IN_WORDS or first.endswith("runde") else f"im {where}"


def message(tournament_title: str, match: dict, outcome: str, rank: int, size: int) -> tuple[str, str]:
    title = tournament_title or "Turnier"
    where = _round(match)
    prefix = f"{title} · {where}" if where else title
    heat = match.get("match_type") == "ffa"
    if outcome == "advanced":
        if heat:
            return (f"Platz {rank} {_in(where)}: weiter" if where else f"Platz {rank}: weiter"), f"{title}: Du bist in der nächsten Runde."
        return "Du bist weiter!", f"{prefix}: gewonnen – du bist in der nächsten Runde."
    if outcome == "lower":
        return "Weiter im Loser Bracket", f"{prefix}: verloren – du spielst im Loser Bracket weiter."
    if outcome == "decider_won":
        return "Entscheidungsspiel", f"{prefix}: gewonnen – jetzt kommt das Entscheidungsspiel."
    if outcome == "decider_lost":
        return "Entscheidungsspiel", f"{prefix}: verloren – es gibt ein Entscheidungsspiel, du bist noch dabei."
    if heat:
        return f"Ausgeschieden: Platz {rank} von {size}", f"{prefix}: leider nicht weiter. Danke fürs Mitspielen!"
    return "Ausgeschieden", f"{prefix}: leider raus. Danke fürs Mitspielen!"


def _clock(value: str | None) -> str | None:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment.astimezone(VIENNA).strftime("%H:%M")


def pause_message(tournament_title: str, until: str | None) -> tuple[str, str]:
    title = tournament_title or "Turnier"
    clock = _clock(until)
    if clock:
        return f"Pause bis {clock}", f"{title}: Es geht um {clock} Uhr weiter."
    return "Kurze Pause", f"{title}: Kurze Pause – es geht gleich weiter."


def _tournament_url(tournament: dict) -> str:
    return f"/tournaments/{tournament.get('slug') or tournament.get('id')}"


async def _next_match_url(db, tournament: dict, registration_id: str, after: dict | None = None) -> str:
    """Das nächste offene Spiel der Anmeldung - sonst die Turnierseite."""
    query = {"tournament_id": tournament["id"], "slots.registration_id": registration_id,
             "status": {"$in": list(OPEN_MATCH_STATUSES)}}
    if after and after.get("id"):
        query["id"] = {"$ne": after["id"]}
    rows = await db.matches_v2.find(query, {"_id": 0, "id": 1, "round": 1}).sort([("round", 1), ("id", 1)]).to_list(1)
    return f"/matches/{rows[0]['id']}" if rows else _tournament_url(tournament)


async def _people(db, registration: dict) -> set[str]:
    from services.match_audience import player_user_ids

    return set(await player_user_ids(db, [registration]))


async def _tell(user_ids, title: str, body: str, url: str, kind: str, meta: dict) -> int:
    from services.user_notifications import create_user_notification

    sent = 0
    for user_id in sorted(user_ids):
        try:
            if await create_user_notification(user_id, title, body, url=url, kind=kind, meta=dict(meta)):
                sent += 1
        except Exception:  # noqa: BLE001 - eine Meldung hält das Turnier nicht auf
            logger.warning("[turnier] Meldung %s an %s nicht verschickt", log_safe(kind), log_safe(user_id), exc_info=True)
    return sent


def result_token(match: dict) -> str:
    """Der Stand des Ergebnisses - dieselbe Kennung wie bei „Ergebnis bestätigt“ (services/match_notifications.py). Eine
    Korrektur hat einen neuen Stand und damit eine neue Meldung."""
    return str((match.get("result_meta") or {}).get("report_id") or match.get("admin_decision_at") or match.get("updated_at") or "")


async def _targets(db, match: dict) -> list[dict]:
    """Die Spiele, in die dieses Spiel weiterleitet - nach Kennung oder Schlüssel in derselben Phase."""
    ids = {edge.get("to_match_id") for edge in match.get("advancement") or [] if edge.get("to_match_id")}
    keys = {edge.get("to_match_key") for edge in match.get("advancement") or [] if edge.get("to_match_key")}
    ids |= {match.get(field) for field in ("next_match_id", "next_loser_match_id") if match.get(field)}
    if not ids and not keys:
        return []
    ors: list[dict] = []
    if ids:
        ors.append({"id": {"$in": sorted(ids)}})
    if keys:
        ors.append({"match_key": {"$in": sorted(keys)}, "stage_id": match.get("stage_id")})
    return await db.matches_v2.find({"tournament_id": match.get("tournament_id"), "$or": ors},
                                    {"_id": 0, "id": 1, "status": 1, "slots": 1}).to_list(50)


def checked_against_targets(found: dict[str, tuple[str, int]], targets: list[dict]) -> dict[str, tuple[str, int]]:
    """Weiter ist nur, wer im tatsächlichen, nicht abgesagten Zielspiel steht (Prüfung 26.11.): Ist jedes Zielspiel abgesagt
    (Reset des Grand Finals entfällt), war dieses Spiel das letzte - keine Meldung. Wer in keinem Zielspiel sitzt, obwohl
    dort kein Platz mehr frei ist, ist ausgeschieden. Ein noch freier Platz (Auslosung steht aus) lässt die Rechnung nach Platz."""
    if not targets:
        return found
    live = [target for target in targets if target.get("status") != "cancelled"]
    if not live:
        return {}
    seated = {slot.get("registration_id") for target in live for slot in target.get("slots") or [] if slot.get("registration_id")}
    open_seat = any(not slot.get("registration_id") and slot.get("status") != "bye" for target in live for slot in target.get("slots") or [])
    checked: dict[str, tuple[str, int]] = {}
    for registration_id, (outcome, rank) in found.items():
        if outcome in ("advanced", "lower", "decider_won", "decider_lost") and registration_id not in seated and not open_seat:
            outcome = "eliminated"
        checked[registration_id] = (outcome, rank)
    return checked


async def _last_valid(db, match_id: str, registration_id: str) -> dict | None:
    """Die letzte gültige (nicht überholte) Meldung zu diesem Spiel und dieser Anmeldung."""
    rows = await db.notifications.find(
        {"kind": KIND_PROGRESS, "meta.source_match_id": match_id, "meta.registration_id": registration_id,
         "meta.superseded": {"$ne": True}}, {"_id": 0, "id": 1, "meta": 1, "created_at": 1},
    ).sort([("created_at", -1), ("id", -1)]).to_list(1)
    return rows[0] if rows else None


async def _supersede(db, match_id: str, registration_id: str, token: str) -> None:
    """Ältere Meldungen zu diesem Spiel und dieser Anmeldung gelten als überholt - gelesen und markiert."""
    await db.notifications.update_many(
        {"kind": KIND_PROGRESS, "meta.source_match_id": match_id, "meta.registration_id": registration_id,
         "meta.result_token": {"$ne": token}, "meta.superseded": {"$ne": True}},
        {"$set": {"meta.superseded": True, "read": True}},
    )


async def notify_match_progress(db, match: dict) -> int:
    """Nach einem bestätigten Ergebnis: weiter, Loser Bracket oder ausgeschieden - je Anmeldung, Ausgang und Ergebnis-Stand
    einmal. Nach einer Korrektur kommt die passende neue Meldung, die überholte wird als überholt markiert."""
    found = outcomes(match)
    if not found:
        return 0
    found = checked_against_targets(found, await _targets(db, match))
    if not found:
        return 0
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "id": 1, "slug": 1, "title": 1}) or {}
    if not tournament:
        return 0
    token = result_token(match)
    registrations = await db.tournament_registrations.find(
        {"id": {"$in": sorted(found)}, "status": {"$in": list(ACTIVE_REGISTRATIONS)}}, {"_id": 0}).to_list(len(found))
    size = len([row for row in match.get("results") or [] if row.get("registration_id")])
    sent = 0
    for registration in registrations:
        outcome, rank = found[registration["id"]]
        # Nur ein geänderter Ausgang ist eine neue Meldung (Prüfung 26.11.): Eine reine Korrektur des Spielstands oder ein neues
        # ``updated_at`` ohne report_id meldet nichts noch einmal.
        last = await _last_valid(db, match.get("id"), registration["id"])
        if last and (last.get("meta") or {}).get("reason") == outcome:
            continue
        title, body = message(tournament.get("title") or "", match, outcome, rank, size)
        url = _tournament_url(tournament) if outcome == "eliminated" else await _next_match_url(db, tournament, registration["id"], match)
        meta = {"tournament_id": tournament["id"], "registration_id": registration["id"], "source_match_id": match.get("id"),
                "reason": outcome, "rank": rank, "result_token": token,
                "dedupe_key": f"progress:{match.get('id')}:{registration['id']}:{outcome}:after:{(last or {}).get('id') or 'none'}"}
        added = await _tell(await _people(db, registration), title, body, url, KIND_PROGRESS, meta)
        if added:
            await _supersede(db, match.get("id"), registration["id"], token)
        sent += added
    return sent


async def _active_registrations(db, tournament_id: str) -> list[dict]:
    return await db.tournament_registrations.find(
        {"tournament_id": tournament_id, "status": {"$in": list(ACTIVE_REGISTRATIONS)}}, {"_id": 0}).to_list(5000)


async def notify_bracket_ready(db, tournament: dict) -> int:
    """Beim Start: „Der Turnierbaum ist da“ - einmal je Turnier. Liga-Staffeln nicht: Die Liga hat eigene Meldungen
    (docs/LIGA.md); ob dort „Der Spielplan ist da“ dazukommt, entscheidet Fabian (Fachfrage #1662)."""
    if tournament.get("matchday_weeks_total") or isinstance(tournament.get("league_context"), dict):
        return 0
    if not await db.matches_v2.find_one({"tournament_id": tournament["id"], "slots.registration_id": {"$type": "string"}}, {"_id": 1}):
        return 0
    title = "Der Turnierbaum ist da"
    body = f"{tournament.get('title') or 'Turnier'}: Schau nach, gegen wen du spielst."
    sent = 0
    for registration in await _active_registrations(db, tournament["id"]):
        url = await _next_match_url(db, tournament, registration["id"])
        meta = {"tournament_id": tournament["id"], "registration_id": registration["id"],
                "dedupe_key": f"bracket:{tournament['id']}:{registration['id']}"}
        sent += await _tell(await _people(db, registration), title, body, url, KIND_BRACKET, meta)
    return sent


async def notify_pause(db, tournament: dict) -> int:
    """Pause mit oder ohne Uhrzeit (#1123) an alle Angemeldeten - einmal je Pause und Uhrzeit."""
    fresh = await db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0}) or tournament
    if fresh.get("status") != "paused":
        return 0
    # Hat die Turnierleitung eben selbst „Pause bis 14:30“ an dieses Turnier geschickt (mit „Turnier gleich pausieren“, #1166),
    # sagt die automatische Meldung dasselbe nicht noch einmal. Andere Hinweise und solche ans ganze Event zählen nicht.
    recent = (now_utc() - timedelta(minutes=NOTICE_COVERS_MINUTES)).isoformat()
    notices = await db.tournament_notices.find(
        {"target": "tournament", "tournament_id": fresh["id"], "created_at": {"$gte": recent}}, {"_id": 0, "text": 1}).to_list(20)
    if any("pause" in str(notice.get("text") or "").lower() for notice in notices):
        return 0
    until = fresh.get("paused_until")
    title, body = pause_message(fresh.get("title") or "", until)
    stamp = f"{fresh.get('paused_at') or ''}:{until or 'kurz'}"
    people: set[str] = set()
    for registration in await _active_registrations(db, fresh["id"]):
        people |= await _people(db, registration)
    meta = {"tournament_id": fresh["id"], "paused_until": until, "dedupe_key": f"pause:{fresh['id']}:{stamp}"}
    return await _tell(people, title, body, _tournament_url(fresh), KIND_PAUSE, meta)


async def status_changed(db, tournament_id: str, prev: str | None, status: str | None) -> None:
    """Die eine Stelle für alle Statuswechsel (Leitung, Zeitplan, erstes Spiel an einer Station): Beim ersten Start „Der
    Turnierbaum ist da“, beim Pausieren die Pause. Doppeltes hält der ``dedupe_key`` auf. Ein Fehler hält nichts auf."""
    try:
        fresh = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0})
        if not fresh:
            return
        if status == "live" and prev not in ("paused", "live"):
            await notify_bracket_ready(db, fresh)
        if status == "paused":
            await notify_pause(db, fresh)
    except Exception:  # noqa: BLE001
        logger.warning("[turnier] Meldung zum Statuswechsel nicht verschickt: %s", log_safe(tournament_id), exc_info=True)
