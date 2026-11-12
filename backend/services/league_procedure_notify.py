"""Nachrichten zu den Verfahren der Liga (E.2, #1619): Postfach und Push (Art ``match_attention`` für die Leitung, ``match_dispute``
bzw. ``match_result`` für die Seiten), dazu die Mails „Dispute gemeldet“ und „Dispute entschieden“ wie bei Turnieren.

Jede Nachricht trägt ``procedure:<id>:<anlass>`` als Schlüssel gegen doppelte Meldungen. Texte nennen Art und Grund zum Antippen -
nie die Begründung, das abweichende Ergebnis oder etwas aus einer MOSS-Datei. Eine ausgefallene Nachricht hält kein Verfahren auf.
"""
from __future__ import annotations

import logging

from services import league_protest_settings as protest_settings
from services.log_safe import log_safe
from services.match_audience import player_user_ids, registrations_for_match, responsible_user_ids, users_for
from services.user_notifications import build_public_url, create_user_notification

logger = logging.getLogger("tls.league_procedures")

KIND_WORDS = {"objection": "Beanstandung", "protest": "Protest", "appeal": "Einspruch"}


def _guarded(func):
    async def wrapper(db, match, league, row, *args, **kwargs):
        try:
            return await func(db, match, league, row, *args, **kwargs)
        except Exception as exc:  # noqa: BLE001 - eine Nachricht hält kein Verfahren auf
            logger.warning("[procedures] Nachricht zu Spiel %s nicht verschickt: %s", log_safe(match.get("id")), type(exc).__name__)
            return 0
    return wrapper


async def _frame(db, match: dict, league) -> tuple[list[dict], str]:
    from services.match_notifications import match_title

    registrations = await registrations_for_match(db, match)
    by_id = {reg["id"]: reg for reg in registrations if reg.get("id")}
    return registrations, f"{league.tournament.get('title') or 'Liga'} · {match_title(match, by_id)}"


async def lead_ids(db, match: dict, league, capability: str = "disputes") -> set[str]:
    """Die Leitung mit diesem Recht - ohne alle, die an dem Spiel beteiligt sind (befangen wie B.1)."""
    from services.league_permissions import involved_user_ids, staff_user_ids

    return await staff_user_ids(db, league.league_id, (capability,)) - await involved_user_ids(db, match)


async def _send(user_ids, title: str, body: str, match: dict, row: dict, event: str, *, kind: str, reason: str,
                category: str = "match_reminders", extra: dict | None = None) -> int:
    sent = 0
    for user_id in sorted(set(user_ids)):
        if await create_user_notification(
            user_id, title, body, url=f"/matches/{match.get('id')}", kind=kind,
            meta={"category": category, "dedupe_key": f"procedure:{row['id']}:{event}", "match_id": match.get("id"),
                  "tournament_id": match.get("tournament_id"), "reason": reason, **(extra or {})}):
            sent += 1
    return sent


async def _mail(db, user_ids, template: str, match: dict, league, row: dict, event: str, **fields) -> None:
    from services.notification_preferences import send_user_template

    url = await build_public_url(f"/matches/{match.get('id')}")
    for user in await users_for(db, user_ids):
        try:
            await send_user_template(
                user, template, tournament_title=league.tournament.get("title") or "Liga", url=url, **fields,
                dedupe_key=f"procedure:{row['id']}:{event}:{user['id']}:mail",
                mail_meta={"kind": template, "match_id": match.get("id"), "user_id": user["id"]})
        except Exception as exc:  # noqa: BLE001 - eine Mail hält kein Verfahren auf
            logger.warning("[procedures] Mail zu Spiel %s nicht verschickt: %s", log_safe(match.get("id")), type(exc).__name__)


def _word(row: dict) -> str:
    return KIND_WORDS.get(row.get("kind"), "Verfahren")


@_guarded
async def opened(db, match: dict, league, row: dict) -> int:
    registrations, frame = await _frame(db, match, league)
    label = protest_settings.reason_label(league.settings, row.get("reason_key"))
    actor = row.get("user_id")
    sent = await _send(await lead_ids(db, match, league) - {actor}, f"{_word(row)}: bitte übernehmen",
                       f"{frame}: Ein {_word(row)} ist eingegangen ({label}). Bitte übernehmen und prüfen.", match, row, "open",
                       kind="match_attention", reason="procedure_open", category="tournament_updates")
    players = await player_user_ids(db, registrations) - {actor}
    until = (row.get("statement") or {}).get("due_at")
    sent += await _send(players, f"{_word(row)} zu deinem Spiel",
                        f"{frame}: Es läuft ein {_word(row)} ({label}). Die Liga-Leitung prüft und entscheidet."
                        + (" Die Gegenseite kann Stellung nehmen." if until else ""), match, row, "open",
                        kind="match_dispute", reason="procedure_open")
    await _mail(db, players, "dispute_opened", match, league, row, "open")
    return sent


@_guarded
async def withdrawn(db, match: dict, league, row: dict) -> int:
    registrations, frame = await _frame(db, match, league)
    people = (await player_user_ids(db, registrations) | await lead_ids(db, match, league)) - {row.get("withdrawn_by")}
    return await _send(people, f"{_word(row)} zurückgezogen", f"{frame}: Der {_word(row)} wurde zurückgezogen.", match, row, "withdrawn",
                       kind="match_dispute", reason="procedure_withdrawn")


@_guarded
async def statement_given(db, match: dict, league, row: dict) -> int:
    registrations, frame = await _frame(db, match, league)
    assignee = (row.get("assignee") or {}).get("user_id")
    leads = {assignee} if assignee else await lead_ids(db, match, league)
    own = [reg for reg in registrations if reg.get("id") == row.get("registration_id")]
    at = (row.get("statement") or {}).get("at")
    sent = await _send(leads, "Stellungnahme eingegangen", f"{frame}: Die Gegenseite hat Stellung genommen.", match, row,
                       f"statement:{at}", kind="match_attention", reason="procedure_statement", category="tournament_updates")
    return sent + await _send(await responsible_user_ids(db, own), "Stellungnahme eingegangen",
                              f"{frame}: Die Gegenseite hat zu eurem {_word(row)} Stellung genommen.", match, row, f"statement:{at}",
                              kind="match_dispute", reason="procedure_statement")


@_guarded
async def statement_extended(db, match: dict, league, row: dict) -> int:
    from services.league_schedule import when_text
    from services.match_proof_refs import parse

    registrations, frame = await _frame(db, match, league)
    slot = row.get("statement") or {}
    side = [reg for reg in registrations if reg.get("id") == slot.get("registration_id")]
    return await _send(await responsible_user_ids(db, side), "Stellungnahme: Frist verlängert",
                       f"{frame}: Die Liga-Leitung hat die Frist für eure Stellungnahme verlängert - bis {when_text(parse(slot.get('due_at')))}.",
                       match, row, f"statement-extended:{slot.get('due_at')}", kind="match_dispute", reason="procedure_statement_extended")


@_guarded
async def assigned(db, match: dict, league, row: dict) -> int:
    registrations, frame = await _frame(db, match, league)
    at = (row.get("assignee") or {}).get("at")
    return await _send(await responsible_user_ids(db, registrations) - {(row.get("assignee") or {}).get("user_id")},
                       f"{_word(row)} wird bearbeitet", f"{frame}: Die Liga-Leitung hat den {_word(row)} übernommen.", match, row,
                       f"assigned:{at}", kind="match_dispute", reason="procedure_assigned")


@_guarded
async def moss_requested(db, match: dict, league, row: dict, request: dict) -> int:
    from services.league_schedule import when_text
    from services.match_proof_refs import parse

    registrations, frame = await _frame(db, match, league)
    side = [reg for reg in registrations if reg.get("id") == request.get("registration_id")]
    until = when_text(parse(request.get("due_at")))
    sent = await _send({request.get("user_id")}, "MOSS-Datei angefordert",
                       f"{frame}: Die Liga-Leitung fordert deine MOSS-Datei an. Bitte lade die ZIP-Datei unverändert hoch - bis {until}.",
                       match, row, f"moss:{request['id']}", kind="match_attention", reason="procedure_moss_request")
    return sent + await _send(await responsible_user_ids(db, side) - {request.get("user_id")}, "MOSS-Datei angefordert",
                              f"{frame}: Die Liga-Leitung fordert die MOSS-Datei eines Spielers eurer Seite an - bis {until}.",
                              match, row, f"moss:{request['id']}", kind="match_dispute", reason="procedure_moss_request")


@_guarded
async def decided(db, match: dict, league, row: dict) -> int:
    registrations, frame = await _frame(db, match, league)
    if row.get("kind") == "appeal":
        outcome = "Der Einspruch wurde abgewiesen, die Entscheidung bleibt." if row.get("decision") == "keep" else "Dem Einspruch wurde stattgegeben."
    else:
        outcome = "Das Ergebnis bleibt." if row.get("decision") == "keep" else "Das Ergebnis wurde geändert."
    note = " ".join(str(row.get("decision_note") or "").split())
    text = f"{outcome} Begründung: {note[:200]}" if note else outcome
    players = await player_user_ids(db, registrations) - {row.get("resolved_by")}
    sent = await _send(players, f"{_word(row)} entschieden", f"{frame}: Die Liga-Leitung hat entschieden. {text}", match, row, "decided",
                       kind="match_result", reason="procedure_decided", extra={"dispute_resolved": True, "decision": row.get("decision")})
    await _mail(db, players, "dispute_resolved", match, league, row, "decided", decision=text)
    return sent


# ---------------------------------------------------------------- Zeit-Job

@_guarded
async def target_reached(db, match: dict, league, row: dict) -> int:
    _, frame = await _frame(db, match, league)
    return await _send({(row.get("assignee") or {}).get("user_id")}, f"{_word(row)}: Zielfrist erreicht",
                       f"{frame}: Die Zielfrist für deine Entscheidung ist erreicht. Bitte entscheiden oder abgeben.", match, row,
                       f"target:{row.get('target_at')}", kind="match_attention", reason="procedure_target", category="tournament_updates")


@_guarded
async def escalated(db, match: dict, league, row: dict) -> int:
    _, frame = await _frame(db, match, league)
    why = "ist über der Zielfrist" if row.get("assignee") else "hat noch niemand übernommen"
    return await _send(await lead_ids(db, match, league, "manage"), f"{_word(row)} wartet",
                       f"{frame}: Den {_word(row)} {why}. Bitte klären, wer entscheidet.", match, row, f"escalated:{row.get('escalated_at')}",
                       kind="match_attention", reason="procedure_escalated", category="tournament_updates")


@_guarded
async def statement_expired(db, match: dict, league, row: dict) -> int:
    _, frame = await _frame(db, match, league)
    assignee = (row.get("assignee") or {}).get("user_id")
    return await _send({assignee} if assignee else await lead_ids(db, match, league), "Keine Stellungnahme",
                       f"{frame}: Die Frist für die Stellungnahme ist abgelaufen, ohne dass eine einging.", match, row,
                       f"statement-expired:{(row.get('statement') or {}).get('due_at')}", kind="match_attention",
                       reason="procedure_statement_expired", category="tournament_updates")


@_guarded
async def moss_missing(db, match: dict, league, row: dict, request: dict) -> int:
    _, frame = await _frame(db, match, league)
    assignee = (row.get("assignee") or {}).get("user_id")
    return await _send({assignee} if assignee else await lead_ids(db, match, league), "MOSS-Datei fehlt",
                       f"{frame}: Eine angeforderte MOSS-Datei ist nach Ablauf der Frist nicht da. Gewertet wird nichts automatisch.",
                       match, row, f"moss-missing:{request.get('id')}", kind="match_attention", reason="procedure_moss_missing",
                       category="tournament_updates")
