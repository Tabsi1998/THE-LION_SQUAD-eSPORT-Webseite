"""Turnier-Anmeldung (#1133): wer sich anmeldet oder dessen Anmeldung sich ändert, bekommt Bescheid.

Entscheidung des Betreibers (07.10.2026): Angebunden sind die drei Anmelde-Mails - eingegangen (wartet auf Freigabe
oder Warteliste), bestätigt (auch beim Nachrücken von der Warteliste) und abgelehnt mit Grund - und „Turnier beendet“.
Dazu kommt je eine Nachricht im Postfach und per Push; die Mail nur, wenn die Person „Turnier-Updates“ per Mail
zulässt.

Empfänger (#1136): die Verantwortlichen der Anmeldung - wer angemeldet hat, bei Teams Teamleitung und Co-Leitung. Wer
die Anmeldung gerade selbst abgeschickt hat, sieht das Ergebnis auf dem Bildschirm: für sie oder ihn gibt es die
Bestätigung im Postfach und per Mail, aber keinen Push. „Turnier beendet“ geht an alle Spieler.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from services.match_audience import player_user_ids, responsible_user_ids, users_for
from services.notification_preferences import send_user_template
from services.tournament_rules import self_checkin_allowed
from services.user_notifications import build_public_url, create_user_notification

logger = logging.getLogger("tls.registration_notifications")

NOTIFIED_STATUSES = {"approved", "checked_in", "pending", "waitlist", "rejected"}


def _log_safe(value, limit: int = 120) -> str:
    """Werte ins Protokoll nur ohne Zeilenumbrüche und gekürzt."""
    return str(value or "").replace("\r", " ").replace("\n", " ")[:limit]


def _when(value) -> str:
    if not value:
        return ""
    try:
        moment = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return ""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(ZoneInfo("Europe/Vienna")).strftime("%d.%m.%Y, %H:%M Uhr")


def _checkin_line(tournament: dict) -> str:
    start = _when(tournament.get("check_in_from"))
    if not start:
        return ""
    if self_checkin_allowed(tournament):
        return f"Denk an den Check-in ab {start} – auf der Turnierseite oder in der App."
    return f"Check-in vor Ort bei der Turnierleitung ab {start}."


def registration_message(tournament: dict, status: str, previous: str | None = None, reason: str | None = None) -> dict | None:
    """Titel, Text und Mail-Vorlage für einen Stand der Anmeldung - oder nichts, wenn es dazu keine Nachricht gibt."""
    title = tournament.get("title") or "Turnier"
    if status in {"approved", "checked_in"}:
        promoted = previous == "waitlist"
        detail = "Ein Platz ist frei geworden – du bist von der Warteliste nachgerückt." if promoted else ""
        checkin = _checkin_line(tournament) if status == "approved" else ""
        body = " ".join(part for part in (detail or "Deine Anmeldung ist bestätigt.", checkin) if part)
        return {"title": f"{'Nachgerückt' if promoted else 'Du bist dabei'}: {title}", "body": body,
                "template": "registration_approved", "detail": " ".join(part for part in (detail, checkin) if part)}
    if status == "waitlist":
        detail = ("Das Turnier ist voll – du stehst auf der Warteliste. Wird ein Platz frei, holt dich die "
                  "Turnierleitung nach; dann bekommst du Bescheid.")
        return {"title": f"Warteliste: {title}", "body": detail, "template": "registration_received", "detail": detail}
    if status == "pending":
        detail = "Die Turnierleitung prüft deine Anmeldung; du bekommst Bescheid, sobald sie entschieden hat."
        return {"title": f"Anmeldung eingegangen: {title}", "body": detail, "template": "registration_received", "detail": detail}
    if status == "rejected":
        clean = " ".join((reason or "").split())[:300]
        body = "Die Turnierleitung hat deine Anmeldung abgelehnt." + (f" Grund: {clean}" if clean else "")
        return {"title": f"Anmeldung abgelehnt: {title}", "body": body, "template": "registration_rejected", "reason": clean}
    return None


async def notify_registration_status(db, tournament: dict, registration: dict, status: str, *,
                                     previous: str | None = None, reason: str | None = None,
                                     actor_id: str | None = None) -> int:
    """Eine Nachricht je Stand der Anmeldung an ihre Verantwortlichen - Postfach, Push und, wenn erlaubt, Mail."""
    if status not in NOTIFIED_STATUSES or not registration or previous == status:
        return 0
    if status in {"approved", "checked_in"} and previous in {"approved", "checked_in"}:
        return 0  # Einchecken oder Auschecken ändert nichts daran, dass die Person dabei ist
    message = registration_message(tournament, status, previous, reason)
    if not message:
        return 0
    recipients = await users_for(db, await responsible_user_ids(db, [registration]))
    if not recipients:
        return 0
    path = f"/tournaments/{tournament.get('slug') or tournament.get('id')}"
    absolute_url = await build_public_url(path)
    stamp = registration.get("updated_at") or registration.get("created_at") or ""
    dedupe = f"registration:{registration.get('id')}:{status}:{stamp}"
    sent = 0
    for user in recipients:
        meta = {"category": "tournament_updates", "dedupe_key": dedupe, "tournament_id": tournament.get("id"),
                "registration_id": registration.get("id"), "status": status}
        if user["id"] == actor_id:
            meta["in_app_only"] = True  # wer gerade selbst angemeldet hat, sieht es schon auf dem Bildschirm
        if await create_user_notification(user["id"], message["title"], message["body"], url=path,
                                          kind="tournament_registration", meta=meta):
            sent += 1
        kwargs = {"tournament_title": tournament.get("title") or "Turnier"}
        if message["template"] == "registration_rejected":
            kwargs.update(reason=message.get("reason") or "", url=absolute_url)
        else:
            kwargs.update(url=absolute_url, detail=message.get("detail") or "")
        try:
            await send_user_template(
                user, message["template"], dedupe_key=f"{dedupe}:{user['id']}:mail",
                mail_meta={"kind": "tournament_registration", "tournament_id": tournament.get("id"), "user_id": user["id"]},
                **kwargs,
            )
        except Exception as exc:  # noqa: BLE001 - eine Mail hält keine Anmeldung auf
            logger.warning("Registration mail failed for tournament=%s type=%s", _log_safe(tournament.get("id")), type(exc).__name__)
    return sent


async def notify_tournament_finished(db, tournament: dict) -> int:
    """„Turnier beendet“ (#1133): einmal je Turnier und Person an alle Spieler der bestätigten Anmeldungen - im
    Postfach (ohne Push, die Ergebnisse kommen ohnehin) und, wenn die Person es zulässt, per Mail."""
    registrations = await db.tournament_registrations.find(
        {"tournament_id": tournament.get("id"), "status": {"$in": ["approved", "checked_in"]}},
        {"_id": 0, "id": 1, "user_id": 1, "team_id": 1},
    ).to_list(5000)
    if not registrations:
        return 0
    path = f"/tournaments/{tournament.get('slug') or tournament.get('id')}"
    absolute_url = await build_public_url(path)
    title = tournament.get("title") or "Turnier"
    sent = 0
    for user in await users_for(db, await player_user_ids(db, registrations)):
        dedupe = f"tournament_finished:{tournament.get('id')}:{user['id']}"
        if await create_user_notification(
            user["id"], f"Turnier beendet: {title}", "Platzierungen und Ergebnisse stehen auf der Turnierseite.",
            url=path, kind="tournament_finished",
            meta={"category": "tournament_updates", "dedupe_key": dedupe, "tournament_id": tournament.get("id"), "in_app_only": True},
        ):
            sent += 1
        try:
            await send_user_template(user, "tournament_finished", tournament_title=title, url=absolute_url, dedupe_key=f"{dedupe}:mail",
                                     mail_meta={"kind": "tournament_finished", "tournament_id": tournament.get("id"), "user_id": user["id"]})
        except Exception as exc:  # noqa: BLE001 - eine Mail hält keinen Statuswechsel auf
            logger.warning("Finished mail failed for tournament=%s type=%s", _log_safe(tournament.get("id")), type(exc).__name__)
    return sent
