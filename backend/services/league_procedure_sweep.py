"""Der Zeit-Job der Verfahren (E.2, #1619; docs/LIGA.md, „Wer baut was“) - läuft im Fristen-Job (``match_deadline_sweep``).

Er erinnert und eskaliert, **er entscheidet nie**:

- **Zielfrist** (Nr. 135): Ist ``target_at`` erreicht, bekommt die zuständige Person eine Erinnerung (``reminded_at``). Bleibt das
  Verfahren ``protest_escalate_hours`` Stunden länger offen (Season-Feld, Vorgabe 24), geht es an die Leitung mit „manage“ (``escalated_at``). Hat nach
  ``protest_target_hours`` noch niemand übernommen, geht es ebenfalls an „manage“.
- **Stellungnahme**: Läuft ``statement.due_at`` ohne Text ab, erfährt es die Leitung (``statement.expired_at``).
- **MOSS**: Fehlt eine angeforderte Datei nach ``due_at``, steht die Anforderung auf ``missing`` und die Leitung bekommt einen Hinweis.

Jeder Schritt setzt erst seinen Merker (mit Bedingung auf den gelesenen Stand) und schickt dann die Nachricht - ein zweiter Lauf
findet nichts mehr. Alle Fristen ruhen in Sperrzeiten, weil sie mit ``response_deadline`` gerechnet und gespeichert sind.
"""
from __future__ import annotations

import logging
from datetime import datetime

from models import now_utc
from services import league_procedure_notify as notify
from services import league_procedures as procedures
from services.log_safe import log_safe
from services.match_proof_refs import parse

logger = logging.getLogger("tls.league_procedures")


async def _step(db, match: dict, league, row: dict, now: datetime) -> tuple[dict, list]:
    """Was an diesem Verfahren fällig ist: der geänderte Eintrag und die Nachrichten dazu."""
    row = dict(row)
    todo: list = []
    assignee, target = row.get("assignee"), parse(row.get("target_at"))
    if assignee and target and now >= target:
        if not row.get("reminded_at"):
            row["reminded_at"] = now.isoformat()
            todo.append((notify.target_reached, ()))
        late = procedures.response_deadline(league.tournament, target, league.settings["protest_escalate_hours"])
        if not row.get("escalated_at") and late and now >= late:
            row["escalated_at"] = now.isoformat()
            todo.append((notify.escalated, ()))
    elif not assignee and not row.get("escalated_at"):
        waited = procedures.response_deadline(league.tournament, row.get("at"), league.settings["protest_target_hours"])
        if waited and now >= waited:
            row["escalated_at"] = now.isoformat()
            todo.append((notify.escalated, ()))
    slot = row.get("statement") or {}
    due = parse(slot.get("due_at"))
    if slot.get("registration_id") and due and now > due and not slot.get("text") and not slot.get("expired_at"):
        row["statement"] = {**slot, "expired_at": now.isoformat()}
        todo.append((notify.statement_expired, ()))
    requests = [dict(item) for item in row.get("moss_requests") or []]
    for item in requests:
        if item.get("state") == "requested" and (parse(item.get("due_at")) or now) < now:
            item.update({"state": "missing", "missing_at": now.isoformat()})
            todo.append((notify.moss_missing, (dict(item),)))
    row["moss_requests"] = requests
    return row, todo


async def sweep(db, *, now: datetime | None = None) -> dict:
    """Ein Lauf über alle Spiele mit offenem Verfahren - unabhängig vom Stand des Turniers: Ein Protest läuft auch, wenn die Staffel
    schon zu Ende gespielt ist."""
    now = now or now_utc()
    counts = {"reminded": 0, "escalated": 0, "statement_expired": 0, "moss_missing": 0}
    matches = await db.matches_v2.find(
        {"disputes": {"$elemMatch": {"kind": {"$in": list(procedures.KINDS)}, "state": procedures.OPEN}}}, {"_id": 0}).to_list(500)
    for match in matches:
        try:
            league = await procedures.context(db, match)
            if league is None:
                continue
            for original in procedures.open_rows(match):
                row, todo = await _step(db, match, league, original, now)
                if not todo:
                    continue
                try:
                    match = await procedures._save_row(db, match, row)
                except procedures.ProcedureProblem:
                    break  # gerade geändert - der nächste Lauf rechnet auf dem neuen Stand
                for send, args in todo:
                    await send(db, match, league, row, *args)
                    key = {notify.target_reached: "reminded", notify.escalated: "escalated",
                           notify.statement_expired: "statement_expired", notify.moss_missing: "moss_missing"}[send]
                    counts[key] += 1
        except Exception:  # noqa: BLE001 - ein Spiel hält die anderen nicht auf
            logger.warning("[procedures] Spiel %s nicht geprüft", log_safe(match.get("id")), exc_info=True)
    return counts
