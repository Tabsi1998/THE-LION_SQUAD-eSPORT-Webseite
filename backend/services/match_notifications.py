"""User-facing notifications for match lifecycle events."""
from __future__ import annotations

import logging

from match_rules import participant_source_ids
from services.competition_snapshot import adapt_stage_matches
from services.match_audience import player_user_ids, playing_user_ids, registrations_for_match, responsible_user_ids, users_for
from services.notification_preferences import send_user_template
from services.tournament_permissions import result_staff_user_ids
from services.user_notifications import build_public_url, create_user_notification

logger = logging.getLogger("tls.match_notifications")


def _log_safe(value, limit: int = 120) -> str:
    """Werte ins Protokoll nur ohne Zeilenumbrüche und gekürzt."""
    return str(value or "").replace("\r", " ").replace("\n", " ")[:limit]


def _registration_name(reg: dict | None, fallback: str = "Offen") -> str:
    if not reg:
        return fallback
    return (
        reg.get("display_name")
        or reg.get("ingame_name")
        or reg.get("team_name")
        or reg.get("id")
        or fallback
    )


async def _participant_user_ids(db, registrations: list[dict]) -> set[str]:
    # Ergebnis (#1136, #1192): wer im Spiel antritt - bei Teams die Aufgestellten, ohne Aufstellung jedes Mitglied
    # samt Leitung.
    return await playing_user_ids(db, registrations)


def _canonical_match(match: dict, collection_name: str) -> dict:
    return adapt_stage_matches([match])[0]


def _rank_sort_key(result: dict) -> tuple[int, str]:
    try:
        rank = int(result.get("rank") or 999)
    except (TypeError, ValueError):
        rank = 999
    return rank, str(result.get("registration_id") or "")


def _ranking_result_summary(match: dict, regs_by_id: dict[str, dict]) -> str:
    results = sorted(match.get("results") or [], key=_rank_sort_key)
    if not results:
        return "Das Ergebnis wurde bestätigt."
    parts = []
    for result in results[:4]:
        name = _registration_name(regs_by_id.get(result.get("registration_id")), "Teilnehmer")
        parts.append(f"{result.get('rank')}. {name}")
    suffix = f" (+{len(results) - 4} weitere)" if len(results) > 4 else ""
    return "Ergebnis bestätigt: " + ", ".join(parts) + suffix + "."


def _duel_result_summary(match: dict, regs_by_id: dict[str, dict]) -> str:
    results = match.get("results") or []
    if not results:
        return "Das Ergebnis wurde bestätigt."
    slots = sorted(match.get("slots") or [], key=lambda slot: int(slot.get("position") or 999))
    participants = [slot.get("registration_id") for slot in slots[:2]]
    while len(participants) < 2:
        participants.append(None)
    a_id, b_id = participants
    a = _registration_name(regs_by_id.get(a_id), "Teilnehmer A")
    b = _registration_name(regs_by_id.get(b_id), "Teilnehmer B")
    results_by_id = {result.get("registration_id"): result for result in results}
    score_a = results_by_id.get(a_id, {}).get("score")
    score_b = results_by_id.get(b_id, {}).get("score")
    score = f"{score_a if score_a is not None else 0}:{score_b if score_b is not None else 0}"
    winner_results = [result for result in results if result.get("outcome") == "winner"]
    winner_result = winner_results[0] if len(winner_results) == 1 else None
    winner = _registration_name(
        regs_by_id.get((winner_result or {}).get("registration_id")),
        "Unentschieden",
    )
    if match.get("status") == "forfeit" or any(result.get("forfeit") for result in results):
        return f"{a} gegen {b} wurde per Forfeit gewertet. Gewinner: {winner}."
    return f"{a} gegen {b} ist bestätigt: {score}. Gewinner: {winner}."


def _result_summary(match: dict, regs_by_id: dict[str, dict]) -> str:
    if match.get("match_type") == "duel" and len(match.get("slots") or []) <= 2:
        return _duel_result_summary(match, regs_by_id)
    return _ranking_result_summary(match, regs_by_id)


async def notify_match_result_confirmed(db, match: dict, collection_name: str = "matches_v2", force: bool = False,
                                        dispute_resolved: bool = False) -> int:
    """Create in-app notifications for all users involved in a confirmed match result."""
    source_match = match
    match = _canonical_match(source_match, collection_name)
    reg_ids = participant_source_ids(match)
    if not reg_ids:
        return 0
    registrations = await db.tournament_registrations.find(
        {"id": {"$in": reg_ids}},
        {"_id": 0},
    ).to_list(100)
    user_ids = await _participant_user_ids(db, registrations)
    if not user_ids:
        return 0
    # Ein bestätigtes Ergebnis kann für alle Beteiligten Erfolge auslösen (#301).
    try:
        from services.achievement_queue import request_evaluation
        await request_evaluation(user_ids, "match_result")
    except Exception:  # noqa: BLE001
        pass

    regs_by_id = {reg["id"]: reg for reg in registrations if reg.get("id")}
    tournament = await db.tournaments.find_one(
        {"id": match.get("tournament_id")},
        {"_id": 0, "id": 1, "slug": 1, "title": 1},
    ) or {}
    title = "Ergebnis korrigiert" if force else "Ergebnis bestätigt"
    tournament_title = tournament.get("title") or "Turnier"
    summary = _result_summary(match, regs_by_id)
    body = f"{tournament_title}: {summary}"
    if dispute_resolved:
        # Dispute entschieden (#1134): dieselbe Nachricht für alle Spieler - mit Bezug zum Dispute. Wie beim Eröffnen
        # erfährt es das ganze Team, auch wer neben der Aufstellung steht (#1136).
        title = "Dispute entschieden"
        body = f"{tournament_title}: Die Turnierleitung hat den Dispute entschieden. {summary}"
        user_ids = user_ids | await player_user_ids(db, registrations)
    meta = {
        "match_id": match.get("id"),
        "tournament_id": match.get("tournament_id"),
        "collection": collection_name,
        "force": bool(force),
        **({"dispute_resolved": True} if dispute_resolved else {}),
    }
    result_token = (
        (source_match.get("result_meta") or {}).get("report_id")
        or source_match.get("admin_decision_at")
        or source_match.get("updated_at")
    )
    if result_token:
        meta["dedupe_key"] = f"match-result:{match.get('id')}:{result_token}"
    sent = 0
    for user_id in user_ids:
        await create_user_notification(
            user_id,
            title,
            body,
            url=f"/matches/{match.get('id')}",
            kind="match_result",
            meta=meta,
        )
        sent += 1
    if dispute_resolved:
        absolute_url = await build_public_url(f"/matches/{match.get('id')}")
        for user in await users_for(db, user_ids):
            try:
                await send_user_template(
                    user, "dispute_resolved", tournament_title=tournament_title, decision=summary, url=absolute_url,
                    dedupe_key=f"{meta.get('dedupe_key') or match.get('id')}:{user['id']}:dispute-mail",
                    mail_meta={"kind": "dispute_resolved", "match_id": match.get("id"), "user_id": user["id"]},
                )
            except Exception as exc:  # noqa: BLE001 - eine Mail hält keine Entscheidung auf
                logger.warning("Dispute mail failed for match=%s type=%s", _log_safe(match.get("id")), type(exc).__name__)
    return sent


# ---------------------------------------------------------------- Ergebnis melden (#1132)

def _name(reg: dict | None, fallback: str = "Teilnehmer") -> str:
    """Der Name einer Anmeldung für eine Nachricht - nie eine interne Kennung."""
    return (reg or {}).get("display_name") or (reg or {}).get("ingame_name") or (reg or {}).get("team_name") or fallback


def _time_text(milliseconds: float) -> str:
    total = int(round(milliseconds))
    minutes, rest = divmod(total, 60000)
    seconds, millis = divmod(rest, 1000)
    return f"{minutes}:{seconds:02d}.{millis:03d}" if minutes else f"{seconds}.{millis:03d} s"


def _value_text(entry: dict) -> str | None:
    for key in ("score", "points"):
        value = entry.get(key)
        if value is not None:
            return str(int(value)) if float(value).is_integer() else str(value).replace(".", ",")
    if entry.get("time_ms") is not None:
        return _time_text(float(entry["time_ms"]))
    return None


def results_summary(results: list[dict] | None, regs_by_id: dict[str, dict]) -> str:
    """Ein Ergebnis oder eine Meldung als Satz: „NeonFalke gewinnt 2:1.“, „Unentschieden 1:1.“ oder bei
    Durchgängen „1. NeonFalke, 2. LunaByte, 3. KartKönigin.“"""
    ordered = sorted(results or [], key=_rank_sort_key)
    if not ordered:
        return "Noch kein Ergebnis."
    if len(ordered) == 2:
        first, second = ordered
        first_value, second_value = _value_text(first), _value_text(second)
        score = f" {first_value}:{second_value}" if first_value is not None and second_value is not None else ""
        if second.get("forfeit") and not first.get("forfeit"):
            return f"{_name(regs_by_id.get(first.get('registration_id')))} gewinnt durch Wertung."
        if int(first.get("rank") or 0) == int(second.get("rank") or 0):
            return f"Unentschieden{score}."
        return f"{_name(regs_by_id.get(first.get('registration_id')))} gewinnt{score}."
    parts = [f"{entry.get('rank')}. {_name(regs_by_id.get(entry.get('registration_id')))}" for entry in ordered[:4]]
    suffix = f" (+{len(ordered) - 4} weitere)" if len(ordered) > 4 else ""
    return ", ".join(parts) + suffix + "."


def match_title(match: dict, regs_by_id: dict[str, dict]) -> str:
    """„NeonFalke gegen LunaByte“ - bei Durchgängen das Kürzel des Spiels."""
    ids = participant_source_ids(match)
    if len(ids) == 2:
        return f"{_name(regs_by_id.get(ids[0]))} gegen {_name(regs_by_id.get(ids[1]))}"
    return f"Durchgang {match.get('match_key')}" if match.get("match_key") else "Durchgang"


async def _match_context(db, match: dict) -> tuple[dict, list[dict], dict[str, dict]]:
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "id": 1, "slug": 1, "title": 1}) or {}
    registrations = await registrations_for_match(db, match)
    return tournament, registrations, {reg["id"]: reg for reg in registrations if reg.get("id")}


async def notify_result_reported(db, match: dict, report: dict, actor_id: str | None) -> int:
    """Die erste Meldung ist da (#1132): die Verantwortlichen der Gegenseite sollen bestätigen oder anders melden -
    im Postfach, per Push und, wenn die Person es zulässt, per Mail (``score_reported``). Nur die Gegenseite, nie
    Unbeteiligte; wer gemeldet hat, bekommt nichts."""
    tournament, registrations, regs_by_id = await _match_context(db, match)
    reporter_id = report.get("registration_id")
    others = [reg for reg in registrations if reg.get("id") != reporter_id]
    recipient_ids = await responsible_user_ids(db, others) - {actor_id}
    if not recipient_ids:
        return 0
    tournament_title = tournament.get("title") or "Turnier"
    summary = results_summary(report.get("results"), regs_by_id)
    path = f"/matches/{match.get('id')}"
    absolute_url = await build_public_url(path)
    dedupe = f"match-report:{match.get('id')}:{reporter_id}:{report.get('at')}"
    sent = 0
    for user in await users_for(db, recipient_ids):
        created = await create_user_notification(
            user["id"],
            "Ergebnis gemeldet – bitte bestätigen",
            f"{tournament_title}: {_name(regs_by_id.get(reporter_id), 'Die Gegenseite')} meldet „{summary}“ "
            "Stimmt das? Bestätige es auf der Matchseite – sonst melde dein Ergebnis.",
            url=path,
            kind="match_report",
            meta={"category": "match_reminders", "dedupe_key": dedupe, "match_id": match.get("id"),
                  "tournament_id": match.get("tournament_id")},
        )
        if created:
            sent += 1
        try:
            await send_user_template(
                user, "score_reported", tournament_title=tournament_title, url=absolute_url, summary=summary,
                dedupe_key=f"{dedupe}:{user['id']}:mail",
                mail_meta={"kind": "score_reported", "match_id": match.get("id"), "user_id": user["id"]},
            )
        except Exception as exc:  # noqa: BLE001 - eine Mail hält keine Meldung auf
            logger.warning("Score report mail failed for match=%s type=%s", _log_safe(match.get("id")), type(exc).__name__)
    return sent


async def notify_report_conflict(db, match: dict, actor_registration_id: str | None, actor_id: str | None) -> int:
    """Zwei Meldungen passen nicht zusammen (#1132): die Turnierleitung mit Ergebnis-Recht für dieses Spiel bekommt
    sofort Bescheid und trägt ein; die Gegenseite erfährt, dass die Turnierleitung entscheidet."""
    tournament, registrations, regs_by_id = await _match_context(db, match)
    tournament_title = tournament.get("title") or "Turnier"
    path = f"/matches/{match.get('id')}"
    latest = max((report.get("at") or "" for report in match.get("reports") or []), default="")
    dedupe = f"match-conflict:{match.get('id')}:{latest}"
    sent = 0
    for user_id in sorted(await result_staff_user_ids(db, match) - {actor_id}):
        if await create_user_notification(
            user_id,
            "Ergebnis-Meldungen weichen ab",
            f"{tournament_title} · {match_title(match, regs_by_id)}: Die Meldungen passen nicht zusammen. "
            "Bitte prüfen und das Ergebnis eintragen.",
            url=path,
            kind="match_attention",
            meta={"category": "tournament_updates", "dedupe_key": dedupe, "match_id": match.get("id"),
                  "tournament_id": match.get("tournament_id"), "reason": "report_conflict"},
        ):
            sent += 1
    others = [reg for reg in registrations if reg.get("id") != actor_registration_id]
    for user_id in sorted(await responsible_user_ids(db, others) - {actor_id}):
        if await create_user_notification(
            user_id,
            "Ergebnis in Klärung",
            f"{tournament_title}: Die Gegenseite meldet ein anderes Ergebnis. Die Turnierleitung entscheidet.",
            url=path,
            kind="match_report",
            meta={"category": "match_reminders", "dedupe_key": dedupe, "match_id": match.get("id"),
                  "tournament_id": match.get("tournament_id")},
        ):
            sent += 1
    return sent


# ---------------------------------------------------------------- Dispute (#1134)

def _short(text: str, limit: int = 120) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


async def notify_dispute_opened(db, match: dict, dispute: dict, actor_id: str | None,
                                actor_registration_id: str | None) -> int:
    """Ein Dispute ist da (#1134): die Turnierleitung mit Ergebnis-Recht für dieses Spiel bekommt sofort Bescheid -
    mit dem Grund, den nur sie sieht. Alle anderen Spieler des Spiels (#1136: bei Teams jedes Mitglied) erfahren, dass
    geprüft wird - ohne den Grund, im Postfach, per Push und, wenn sie es zulassen, per Mail. Niemand sonst."""
    tournament, registrations, regs_by_id = await _match_context(db, match)
    tournament_title = tournament.get("title") or "Turnier"
    title_text = match_title(match, regs_by_id)
    who = _name(regs_by_id.get(actor_registration_id), "Eine Seite") if actor_registration_id else "Die Turnierleitung"
    path = f"/matches/{match.get('id')}"
    dedupe = f"match-dispute:{match.get('id')}:{dispute.get('at')}"
    sent = 0
    for user_id in sorted(await result_staff_user_ids(db, match) - {actor_id}):
        if await create_user_notification(
            user_id,
            "Dispute: bitte prüfen",
            f"{tournament_title} · {title_text}: {who} widerspricht – „{_short(dispute.get('reason') or '')}“ "
            "Bitte prüfen und entscheiden.",
            url=path,
            kind="match_attention",
            meta={"category": "tournament_updates", "dedupe_key": dedupe, "match_id": match.get("id"),
                  "tournament_id": match.get("tournament_id"), "reason": "dispute"},
        ):
            sent += 1
    absolute_url = await build_public_url(path)
    for user in await users_for(db, await player_user_ids(db, registrations) - {actor_id}):
        if await create_user_notification(
            user["id"],
            "Dispute zu deinem Spiel",
            f"{tournament_title} · {title_text}: Es wurde ein Dispute gemeldet. Die Turnierleitung prüft und entscheidet.",
            url=path,
            kind="match_dispute",
            meta={"category": "match_reminders", "dedupe_key": dedupe, "match_id": match.get("id"),
                  "tournament_id": match.get("tournament_id")},
        ):
            sent += 1
        try:
            await send_user_template(
                user, "dispute_opened", tournament_title=tournament_title, url=absolute_url,
                dedupe_key=f"{dedupe}:{user['id']}:mail",
                mail_meta={"kind": "dispute_opened", "match_id": match.get("id"), "user_id": user["id"]},
            )
        except Exception as exc:  # noqa: BLE001 - eine Mail hält keinen Dispute auf
            logger.warning("Dispute mail failed for match=%s type=%s", _log_safe(match.get("id")), type(exc).__name__)
    return sent
