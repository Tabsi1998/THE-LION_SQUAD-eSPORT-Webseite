"""Der Zeit-Job des Liga-Check-ins (docs/LIGA.md, „D.2 Check-in und Start“, #1652) - läuft im Fristen-Job (``match_deadline_sweep``)
mit denselben laufenden Turnieren, nur für Staffeln mit ``checkin_rules``.

- **Fenster offen:** „Check-in offen bis …“ an die Verantwortlichen der Seiten, die noch nicht eingecheckt sind - als Aufruf
  (Art ``match_call``: Push mit Vibration wie „Du bist dran“).
- **Vor Schluss:** ``remind_minutes_before_close`` Minuten vor dem Ende noch einmal an die Seiten ohne Check-in.

Der Vorschlag „nicht erschienen“ nach Fensterende entsteht im Fristen-Job selbst (``match_deadlines.no_show_deadline``, Regel
``check_in``). Jeder Schritt merkt sich den Termin, für den er ging (``flow.notices``), und schreibt nur mit Bedingung darauf - ein
zweiter Lauf findet nichts mehr, ein neuer Termin erinnert neu.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from models import now_utc
from services import match_flow
from services.league_schedule import when_text
from services.matchday_schedule import blocked_period_at

logger = logging.getLogger("tls.league_checkin_sweep")

OPEN, CLOSING = "open", "closing"


async def _tell(db, tournament: dict, match: dict, setup: match_flow.Sides, targets: list[str], title: str, text: str,
                reason: str, dedupe: str, *, kind: str) -> int:
    from services.match_audience import responsible_user_ids
    from services.match_notifications import match_title
    from services.user_notifications import create_user_notification

    try:
        regs = [reg for reg in setup.registrations if reg.get("id") in targets]
        body = f"{tournament.get('title') or 'Liga'} · {match_title(match, setup.by_id)}: {text}"
        sent = 0
        for user_id in sorted(await responsible_user_ids(db, regs)):
            if await create_user_notification(
                user_id, title, body, url=f"/matches/{match.get('id')}", kind=kind,
                meta={"category": "match_reminders", "match_id": match.get("id"), "tournament_id": match.get("tournament_id"),
                      "reason": reason, "dedupe_key": dedupe}):
                sent += 1
        return sent
    except Exception:  # noqa: BLE001 - der Merker ist schon gesetzt, die Nachricht holt niemand nach
        logger.warning("[league_checkin_sweep] Nachricht zu %s nicht verschickt", match.get("id"), exc_info=True)
        return 0


async def _mark(db, match: dict, kind: str) -> bool:
    """Den Merker setzen - genau einmal je Termin (Bedingung auf den alten Merker)."""
    key = f"flow.notices.{kind}"
    previous = ((match.get("flow") or {}).get("notices") or {}).get(kind)
    done = await db.matches_v2.update_one({"id": match["id"], key: previous}, {"$set": {key: match.get("scheduled_at")}})
    return bool(getattr(done, "modified_count", 0))


async def remind(db, tournament: dict, rules: dict, now: datetime) -> dict:
    reach = timedelta(minutes=int(rules["opens_minutes_before"]) + int(rules["closes_minutes_after"]) + 1)
    matches = await db.matches_v2.find(
        {"tournament_id": tournament["id"], "status": {"$in": sorted(match_flow.OPEN_MATCH_STATUSES)}, "started_at": None,
         "is_preview": {"$ne": True}, "reports.0": {"$exists": False},
         "scheduled_at": {"$gte": (now - reach).isoformat(), "$lte": (now + reach).isoformat()}},
        {"_id": 0}).to_list(500)
    counts = {OPEN: 0, CLOSING: 0}
    for match in matches:
        if match_flow.state(match, tournament, now) != match_flow.OPEN:
            continue
        window = match_flow.window_of(match, rules)
        missing = match_flow.missing_sides(match)
        notices = (match.get("flow") or {}).get("notices") or {}
        scheduled = match.get("scheduled_at")
        setup = None
        if notices.get(OPEN) != scheduled:
            if await _mark(db, match, OPEN):
                setup = setup or await match_flow.sides(db, match, tournament)
                counts[OPEN] += await _tell(
                    db, tournament, match, setup, missing, "Check-in offen",
                    f"Bitte jetzt einchecken – bis {when_text(window[1])}. Mindestens {int(rules['min_present'])} Spieler aus dem Kader "
                    "anhaken, die da sind.", "checkin_open", f"checkin-open:{match['id']}:{scheduled}", kind="match_call")
        remind_minutes = int(rules["remind_minutes_before_close"])
        if remind_minutes and notices.get(CLOSING) != scheduled and now >= window[1] - timedelta(minutes=remind_minutes):
            if await _mark(db, match, CLOSING):
                setup = setup or await match_flow.sides(db, match, tournament)
                counts[CLOSING] += await _tell(
                    db, tournament, match, setup, missing, "Check-in schließt gleich",
                    f"Nur noch bis {when_text(window[1])} – sonst geht das Spiel als Vorschlag „nicht erschienen“ an die Liga-Leitung.",
                    "checkin_closing", f"checkin-closing:{match['id']}:{scheduled}", kind="match_call")
    return counts


async def sweep(db, tournaments: list[dict], *, now: datetime | None = None) -> dict:
    """Ein Lauf über die laufenden Turniere des Fristen-Jobs - nur Staffeln mit Check-in-Regeln."""
    now = now or now_utc()
    counts = {OPEN: 0, CLOSING: 0}
    for tournament in tournaments:
        rules = match_flow.rules_of(tournament)
        if not rules or blocked_period_at(tournament, now):
            continue
        try:
            done = await remind(db, tournament, rules, now)
            counts[OPEN] += done[OPEN]
            counts[CLOSING] += done[CLOSING]
        except Exception:  # noqa: BLE001 - eine Staffel hält die anderen nicht auf
            logger.warning("[league_checkin_sweep] Staffel %s nicht geprüft", tournament.get("id"), exc_info=True)
    return counts
