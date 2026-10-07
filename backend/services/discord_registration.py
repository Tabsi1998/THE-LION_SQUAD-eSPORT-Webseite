"""Anmeldung im Discord (#885): wer sein Discord-Konto mit der Website verknüpft hat, meldet sich privat (nur die Person
sieht die Antwort) zu einem Event oder Turnier an - über denselben Dienst wie das Website-Formular, mit allen Prüfungen
(Frist, Plätze, Warteliste, Sichtbarkeit, Event-Pflicht #875, Kosten und Rechnung, Doppelanmeldung). Im Kanal steht nie,
wer sich angemeldet hat; die Bestätigung kommt wie gewohnt über die Website-Meldungen. Was Discord nicht gut kann
(Begleitpersonen, Team-Aufstellungen, externe Links, Zusatzangaben), bleibt auf der Website - mit Knopf dorthin.

Knöpfe tragen eine Kennung ``tls:<aktion>:<art>:<id>[:<weiter>]``: ``show`` zeigt die private Zusammenfassung, ``reg``
meldet verbindlich an (der zweite Klick), ``unreg`` meldet ab; ``weiter`` ist das Turnier, zu dem es nach der
Event-Anmeldung geht. Discord schickt die Kennung mit jedem Klick, darum überleben die Knöpfe einen Neustart des Bots.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException

from models import RegistrationCreate
from services import event_days, event_registration, pricing, tournament_event_gate, tournament_fees
from services.discord_registration_rules import CUSTOM_ID_PATTERN, custom_id, enabled, event_blocker, tournament_blocker
from services.discord_texts import LINK_PATH, NOT_LINKED, answer
from services.event_registration import RegistrationError
from services.visibility import user_can_see

OFF = "Die Anmeldung über Discord ist gerade ausgeschaltet – auf der Website geht es weiter."
DOUBLE = "Du bist schon angemeldet – ein zweiter Klick ändert nichts."
LINK_BUTTON = {"label": "Konto verknüpfen", "url": LINK_PATH}
EVENT_STATUS_TEXT = {"registered": "angemeldet", "checked_in": "eingecheckt", "waitlist": "auf der Warteliste"}
TOURNAMENT_STATUS_TEXT = {"approved": "angemeldet", "pending": "wartet auf Freigabe", "checked_in": "eingecheckt", "waitlist": "auf der Warteliste"}
OPEN_EVENT_STATUSES = ("scheduled", "registration_open")


# ---------------------------------------------------------------- Schalter

async def status(db) -> dict:
    """Für die Einstellungen: Schalter und wie viele Anmeldungen bisher über Discord kamen."""
    return {"enabled": await enabled(db),
            "events": await db.event_registrations.count_documents({"registered_via": "discord"}),
            "tournaments": await db.tournament_registrations.count_documents({"registered_via": "discord"})}


# ---------------------------------------------------------------- Person und Auswahl

async def linked_user(db, discord_user_id) -> dict | None:
    """Die Person hinter dem Discord-Konto - nur mit Verknüpfung (#260), dieselbe Tabelle wie ``discord_bot.linked_discord_ids``."""
    link = await db.platform_links.find_one({"platform": "discord", "external_id": str(discord_user_id)}, {"_id": 0, "user_id": 1})
    if not link or not link.get("user_id"):
        return None
    return await db.users.find_one({"id": link["user_id"]}, {"_id": 0, "password_hash": 0, "mfa_secret": 0, "mfa_pending_secret": 0, "mfa_recovery_code_hashes": 0})


def vienna(value) -> str:
    """Zeit wie in den Ankündigungen: „16.10.2026, 18:00 Uhr“ in Wiener Zeit."""
    if not value:
        return ""
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return ""
    return parsed.astimezone(event_days.VIENNA).strftime("%d.%m.%Y, %H:%M Uhr")


def _event_url(event: dict) -> str:
    return f"/events/{event.get('slug') or event.get('id')}"


def _tournament_url(tournament: dict) -> str:
    return f"/tournaments/{tournament.get('slug') or tournament.get('id')}"


async def _open_events(db, user: dict) -> list[dict]:
    rows = await db.events.find({"status": {"$in": list(OPEN_EVENT_STATUSES)}, "has_registration": True}, {"_id": 0}).sort("start_date", 1).to_list(200)
    out = []
    for event in rows:
        if event_blocker(event) or not event_registration.registration_open(event):
            continue
        if not await user_can_see(user, event.get("visibility") or "public"):
            continue
        out.append(event)
    return out


async def _visible_tournament(db, tournament: dict, user: dict) -> bool:
    """Dieselbe Regel wie die Turnierseite - die Route wirft 404/403, hier wird daraus ja/nein."""
    from routes.tournament_common import _get_visible_tournament

    try:
        await _get_visible_tournament(tournament["id"], user)
    except HTTPException:
        return False
    return True


async def _open_tournaments(db, user: dict, games=None) -> list[dict]:
    """Offene Turniere, die die Person sehen darf - ``games`` ist der Spielfilter des Servers (#630, None = alle)."""
    from routes.tournament_registration_routes import _registration_error

    query: dict = {"status": "registration_open"}
    if games is not None:
        query["game_id"] = {"$in": sorted(games)}
    rows = await db.tournaments.find(query, {"_id": 0}).sort("start_date", 1).to_list(200)
    out = []
    for tournament in rows:
        if tournament_blocker(tournament) or _registration_error(tournament):
            continue
        if not await _visible_tournament(db, tournament, user):
            continue
        out.append(tournament)
    return out


async def choices(db, discord_user_id, games=None, typed: str = "", limit: int = 25) -> list[dict]:
    """Die Auswahl für ``/anmelden``: nur, was die verknüpfte Person sehen darf und was offen ist; auf einem Spielserver
    nur Turniere seiner Spiele (#630, ``games`` vom Bot). Discord zeigt höchstens 25."""
    user = await linked_user(db, discord_user_id)
    if not user or not await enabled(db):
        return []
    needle = (typed or "").strip().lower()
    rows = []
    for event in await _open_events(db, user):
        name = f"📅 {event.get('name') or 'Event'}"
        name += f" · {event_days.summary_text(event)}" if event_days.is_multi_day(event) else ""
        rows.append({"name": name[:100], "value": f"event:{event['id']}"})
    for tournament in await _open_tournaments(db, user, games):
        rows.append({"name": f"🏆 {tournament.get('title') or 'Turnier'}"[:100], "value": f"tournament:{tournament['id']}"})
    if needle:
        rows = [row for row in rows if needle in row["name"].lower()]
    return rows[:limit]


async def own_choices(db, discord_user_id, typed: str = "", limit: int = 25) -> list[dict]:
    """Für ``/abmelden``: die eigenen Event-Anmeldungen, die noch gelten."""
    user = await linked_user(db, discord_user_id)
    if not user:
        return []
    regs = await db.event_registrations.find({"user_id": user["id"], "status": {"$in": ["registered", "waitlist", "checked_in"]}},
                                             {"_id": 0, "event_id": 1, "status": 1}).to_list(200)
    events = {event["id"]: event for event in await db.events.find({"id": {"$in": [reg["event_id"] for reg in regs]}, "status": {"$nin": ["completed", "archived", "cancelled"]}}, {"_id": 0}).to_list(200)}
    rows = [{"name": f"📅 {events[reg['event_id']].get('name') or 'Event'} · {EVENT_STATUS_TEXT.get(reg['status'], reg['status'])}"[:100], "value": f"event:{reg['event_id']}"}
            for reg in regs if reg["event_id"] in events]
    needle = (typed or "").strip().lower()
    if needle:
        rows = [row for row in rows if needle in row["name"].lower()]
    return rows[:limit]


# ---------------------------------------------------------------- Zusammenfassungen (privat)

def _when(event: dict) -> str:
    if event_days.is_multi_day(event):
        return event_days.summary_text(event) + "\n" + "\n".join(event_days.lines(event))
    return vienna(event["start_date"]) if event.get("start_date") else "steht noch nicht fest"


def _cost_line(quote: dict) -> str:
    if quote.get("free"):
        return "kostenlos"
    return f"{pricing.describe(quote)} – die Rechnung kommt über die Website."


async def event_summary(db, user: dict, event: dict, then: str | None = None) -> dict:
    """Die private Zusammenfassung vor dem zweiten Klick - oder der Grund, warum es nicht geht."""
    link = [{"label": "Auf der Website", "url": _event_url(event)}]
    name = event.get("name") or "Event"
    blocker = event_blocker(event)
    if blocker:
        return answer(blocker, buttons=link)
    try:
        await event_registration.ensure_can_register(db, event, user)
    except RegistrationError as exc:
        return answer(exc.detail + ".", buttons=link) if not exc.detail.endswith(".") else answer(exc.detail, buttons=link)
    existing = await event_registration.existing_registration(db, event, user)
    if existing and existing.get("status") not in {"cancelled", "no_show"}:
        return answer(f"Du bist bei „{name}“ schon {EVENT_STATUS_TEXT.get(existing['status'], existing['status'])}.",
                      buttons=[{"label": "Abmelden", "custom_id": custom_id("unreg", "event", event["id"]), "style": "danger"}, *link])
    try:
        quote = pricing.quote(event.get("billing") or {}, seats=1)
    except pricing.PricingError as exc:
        return answer(str(exc), buttons=link)
    counts = await event_registration.summary(db, event)
    full = counts["spots_left"] is not None and counts["spots_left"] < 1
    places = "ohne Limit" if counts["spots_left"] is None else (f"{counts['spots_left']} frei" if not full else "voll – du kämst auf die Warteliste")
    fields = [{"name": "Wann", "value": _when(event), "inline": False}]
    place = ", ".join(part for part in (event.get("location"), event.get("city")) if part)
    if place:
        fields.append({"name": "Wo", "value": place, "inline": True})
    fields.append({"name": "Kosten", "value": _cost_line(quote), "inline": True})
    fields.append({"name": "Plätze", "value": places, "inline": True})
    embed = {"title": f"📅 {name}", "description": "Mit „Verbindlich anmelden“ meldest du dich so an wie auf der Website – die Bestätigung kommt über deine Website-Meldungen.",
             "fields": fields, "url": _event_url(event)}
    buttons = [{"label": "Auf die Warteliste" if full else "Verbindlich anmelden", "custom_id": custom_id("reg", "event", event["id"], then), "style": "success"}, *link]
    return answer(embed=embed, buttons=buttons)


async def _captain_team(db, user: dict, tournament: dict) -> tuple[dict | None, str | None]:
    """Das Team, das die Person anmelden darf (Leader oder Co-Leader, selbst Mitglied, noch nicht angemeldet) - oder der Grund."""
    from routes.tournament_registration_routes import _can_register_team

    teams = await db.teams.find({"member_ids": user["id"]}, {"_id": 0}).to_list(50)
    if not teams:
        return None, "Für dieses Turnier brauchst du ein Team – anlegen oder beitreten geht auf der Website."
    allowed = [team for team in teams if _can_register_team(team, user)]
    if not allowed:
        return None, "Das macht dein Kapitän – nur Team-Leader oder Co-Leader melden ein Team an."
    registered = {row["team_id"] for row in await db.tournament_registrations.find({"tournament_id": tournament["id"], "team_id": {"$in": [team["id"] for team in allowed]}}, {"_id": 0, "team_id": 1}).to_list(50)}
    free = [team for team in allowed if team["id"] not in registered]
    if not free:
        return None, "Dein Team ist bei diesem Turnier schon angemeldet."
    return free[0], None


async def _tournament_counts(db, tournament: dict) -> tuple[int, int | None]:
    count = await db.tournament_registrations.count_documents({"tournament_id": tournament["id"], "status": {"$in": ["pending", "approved", "checked_in"]}})
    limit = tournament.get("max_participants")
    return count, (int(limit) if limit else None)


async def tournament_summary(db, user: dict, tournament: dict) -> dict:
    from routes.tournament_registration_routes import _is_active_club_member, _is_team_tournament, _registration_error

    link = [{"label": "Auf der Website", "url": _tournament_url(tournament)}]
    title = tournament.get("title") or "Turnier"
    blocker = tournament_blocker(tournament)
    if blocker:
        return answer(blocker, buttons=link)
    if not await _visible_tournament(db, tournament, user):
        return answer("Dieses Turnier ist für dich nicht sichtbar.", buttons=link)
    problem = _registration_error(tournament)
    if problem:
        return answer(problem + ".", buttons=link)
    if tournament.get("block_club_member_registration") and await _is_active_club_member(db, user):
        return answer("Dieses Turnier ist für externe Teilnehmer vorgesehen – Vereinsmitglieder können sich hier nicht selbst anmelden.", buttons=link)
    own = await db.tournament_registrations.find_one({"tournament_id": tournament["id"], "user_id": user["id"]}, {"_id": 0, "status": 1})
    if own:
        return answer(f"Du bist bei „{title}“ schon {TOURNAMENT_STATUS_TEXT.get(own.get('status'), own.get('status'))}. Abmelden geht auf der Website.", buttons=link)
    team = None
    if _is_team_tournament(tournament):
        team, reason = await _captain_team(db, user, tournament)
        if reason:
            return answer(reason, buttons=link)
    gate = await tournament_event_gate.check(db, tournament, user=None if team else user, team=team)
    if gate and not gate["ok"]:
        event = await db.events.find_one({"id": tournament.get("event_id")}, {"_id": 0})
        buttons = list(link)
        if event:
            if not event_blocker(event):
                buttons.insert(0, {"label": "Beim Event anmelden", "custom_id": custom_id("show", "event", event["id"], tournament["id"]), "style": "primary"})
            else:
                buttons.insert(0, {"label": "Zum Event", "url": _event_url(event)})
        return answer(gate["text"], buttons=buttons)
    offer = tournament.get("billing") or {}
    cost = "kostenlos"
    if tournament_fees.charges(tournament, offer):
        try:
            cost = _cost_line(tournament_fees.quote_for({"registration_type": "team" if team else "solo", "team_id": team.get("id") if team else None}, tournament, offer))
        except pricing.PricingError as exc:
            return answer(str(exc), buttons=link)
    count, limit = await _tournament_counts(db, tournament)
    full = limit is not None and count >= limit
    places = "ohne Limit" if limit is None else (f"{max(limit - count, 0)} frei" if not full else "voll – du kämst auf die Warteliste")
    fields = []
    if tournament.get("start_date"):
        fields.append({"name": "Wann", "value": vienna(tournament["start_date"]), "inline": True})
    if team:
        fields.append({"name": "Team", "value": str(team.get("name") or ""), "inline": True})
    fields.append({"name": "Kosten", "value": cost, "inline": True})
    fields.append({"name": "Plätze", "value": places, "inline": True})
    embed = {"title": f"🏆 {title}", "fields": fields, "url": _tournament_url(tournament),
             "description": "Mit „Verbindlich anmelden“ akzeptierst du die Regeln und den Datenschutz des Turniers" + (" und übernimmst das Startgeld" if cost != "kostenlos" else "") + " – wie im Formular auf der Website."}
    buttons = [{"label": "Auf die Warteliste" if full else "Verbindlich anmelden", "custom_id": custom_id("reg", "tournament", tournament["id"]), "style": "success"}, *link]
    return answer(embed=embed, buttons=buttons)


# ---------------------------------------------------------------- Befehle und Knöpfe

async def _find_event(db, wanted: str) -> dict | None:
    return await db.events.find_one({"$or": [{"id": wanted}, {"slug": wanted}]}, {"_id": 0})


async def _find_tournament(db, wanted: str) -> dict | None:
    return await db.tournaments.find_one({"$or": [{"id": wanted}, {"slug": wanted}]}, {"_id": 0})


async def answer_anmelden(db, discord_user_id, wanted: str | None = None, games=None, then: str | None = None) -> dict:
    """``/anmelden`` und der Knopf „Anmelden“ unter einer Ankündigung: die private Zusammenfassung. ``games`` ist der
    Spielfilter des Servers für die Auswahl (vom Bot, #630)."""
    user = await linked_user(db, discord_user_id)
    if not user:
        return answer(NOT_LINKED, buttons=[LINK_BUTTON])
    if not await enabled(db):
        return answer(OFF)
    if not wanted:
        rows = await choices(db, discord_user_id, games)
        if not rows:
            return answer("Gerade ist keine Anmeldung offen, die du im Discord erledigen kannst.")
        if len(rows) > 1:
            return answer("Wofür? Wähle beim Befehl `/anmelden` aus der Liste:\n" + "\n".join(f"• {row['name']}" for row in rows[:15]))
        wanted = rows[0]["value"]
    kind, _, item_id = str(wanted).partition(":")
    if kind == "event":
        event = await _find_event(db, item_id)
        return await event_summary(db, user, event, then) if event else answer("Dieses Event gibt es nicht mehr.")
    if kind == "tournament":
        tournament = await _find_tournament(db, item_id)
        return await tournament_summary(db, user, tournament) if tournament else answer("Dieses Turnier gibt es nicht mehr.")
    return answer("Das kenne ich nicht – wähle beim Befehl `/anmelden` aus der Liste.")


async def confirm(db, discord_user_id, kind: str, item_id: str, then: str | None = None) -> dict:
    """Der zweite Klick: anmelden über denselben Dienst wie das Formular, mit ``via='discord'`` im Audit."""
    user = await linked_user(db, discord_user_id)
    if not user:
        return answer(NOT_LINKED, buttons=[LINK_BUTTON])
    if not await enabled(db):
        return answer(OFF)
    if kind == "event":
        event = await _find_event(db, item_id)
        if not event:
            return answer("Dieses Event gibt es nicht mehr.")
        link = [{"label": "Deine Anmeldung", "url": _event_url(event)}]
        blocker = event_blocker(event)
        if blocker:
            return answer(blocker, buttons=link)
        try:
            await event_registration.ensure_can_register(db, event, user)
            doc = await event_registration.register(db, event, user, via="discord")
        except RegistrationError as exc:
            return answer(DOUBLE if exc.status == 409 else exc.detail, buttons=link)
        name = event.get("name") or "Event"
        if doc.get("status") == "waitlist":
            counts = await event_registration.summary(db, event)
            text = f"🕐 Du stehst auf der Warteliste für „{name}“ (Platz {counts['waitlist_count']})."
        else:
            text = f"✅ Du bist angemeldet: „{name}“."
        if doc.get("price_snapshot"):
            text += f"\nKosten: {pricing.describe(doc['price_snapshot'])} – die Rechnung kommt über die Website."
        buttons = list(link)
        if then:
            tournament = await _find_tournament(db, then)
            if tournament:
                buttons.insert(0, {"label": "Jetzt fürs Turnier anmelden", "custom_id": custom_id("show", "tournament", tournament["id"]), "style": "primary"})
        return answer(text, buttons=buttons)
    if kind == "tournament":
        from routes.tournament_registration_routes import _is_team_tournament, self_register

        tournament = await _find_tournament(db, item_id)
        if not tournament:
            return answer("Dieses Turnier gibt es nicht mehr.")
        link = [{"label": "Deine Anmeldung", "url": _tournament_url(tournament)}]
        blocker = tournament_blocker(tournament)
        if blocker:
            return answer(blocker, buttons=link)
        if not await _visible_tournament(db, tournament, user):
            return answer("Dieses Turnier ist für dich nicht sichtbar.", buttons=link)
        team = None
        if _is_team_tournament(tournament):
            team, reason = await _captain_team(db, user, tournament)
            if reason:
                return answer(reason, buttons=link)
        body = RegistrationCreate(team_id=team.get("id") if team else None, accept_rules=True, accept_privacy=True, accept_costs=True)
        try:
            reg = await self_register(db, tournament, body, user, None, via="discord")
        except HTTPException as exc:
            return answer(str(exc.detail), buttons=link)
        if reg.get("idempotent_replay"):
            return answer(DOUBLE, buttons=link)
        title = tournament.get("title") or "Turnier"
        if reg.get("status") == "waitlist":
            text = f"🕐 Du stehst auf der Warteliste für „{title}“."
        elif reg.get("status") == "pending":
            text = f"Deine Anmeldung für „{title}“ wartet auf die Freigabe der Turnierleitung."
        else:
            text = f"✅ Du bist angemeldet: „{title}“" + (f" mit „{team.get('name')}“" if team else "") + "."
        if reg.get("price_snapshot"):
            text += f"\nStartgeld: {pricing.describe(reg['price_snapshot'])} – die Rechnung kommt über die Website."
        return answer(text, buttons=link)
    return answer("Diesen Knopf kenne ich nicht mehr.")


async def answer_abmelden(db, discord_user_id, wanted: str | None = None) -> dict:
    """``/abmelden``: erst die Rückfrage mit Knopf, der Klick meldet ab (wie der Bestätigungsdialog der Website)."""
    user = await linked_user(db, discord_user_id)
    if not user:
        return answer(NOT_LINKED, buttons=[LINK_BUTTON])
    if not wanted:
        rows = await own_choices(db, discord_user_id)
        if not rows:
            return answer("Du hast gerade keine Event-Anmeldung, die du hier zurückziehen könntest. Turnier-Anmeldungen ziehst du auf der Website zurück.")
        if len(rows) > 1:
            return answer("Welche? Wähle beim Befehl `/abmelden` aus der Liste:\n" + "\n".join(f"• {row['name']}" for row in rows[:15]))
        wanted = rows[0]["value"]
    kind, _, item_id = str(wanted).partition(":")
    if kind != "event":
        return answer("Vom Turnier abmelden geht auf der Website – dort siehst du auch, was mit dem Startgeld passiert.")
    event = await _find_event(db, item_id)
    if not event:
        return answer("Dieses Event gibt es nicht mehr.")
    existing = await event_registration.existing_registration(db, event, user)
    if not existing or existing.get("status") in {"cancelled", "no_show"}:
        return answer(f"Du bist bei „{event.get('name') or 'Event'}“ nicht angemeldet.")
    text = f"Du bist bei „{event.get('name') or 'Event'}“ {EVENT_STATUS_TEXT.get(existing['status'], existing['status'])}."
    if existing.get("price_snapshot"):
        text += " Eine schon gestellte Rechnung regelt der Verein wie bei einer Abmeldung auf der Website."
    return answer(text + " Wirklich abmelden?", buttons=[{"label": "Abmelden", "custom_id": custom_id("unreg", "event", event["id"]), "style": "danger"},
                                                      {"label": "Auf der Website", "url": _event_url(event)}])


async def withdraw(db, discord_user_id, kind: str, item_id: str) -> dict:
    user = await linked_user(db, discord_user_id)
    if not user:
        return answer(NOT_LINKED, buttons=[LINK_BUTTON])
    if kind != "event":
        return answer("Vom Turnier abmelden geht auf der Website.")
    event = await _find_event(db, item_id)
    if not event:
        return answer("Dieses Event gibt es nicht mehr.")
    try:
        await event_registration.cancel(db, event, user, via="discord")
    except RegistrationError:
        return answer(f"Du warst bei „{event.get('name') or 'Event'}“ nicht angemeldet.")
    return answer(f"Du bist von „{event.get('name') or 'Event'}“ abgemeldet.", buttons=[{"label": "Zum Event", "url": _event_url(event)}])


async def handle_button(db, discord_user_id, button_id: str) -> dict:
    """Ein Klick auf einen Anmelde-Knopf - die Kennung sagt, was zu tun ist."""
    match = CUSTOM_ID_PATTERN.match(button_id or "")
    if not match:
        return answer("Diesen Knopf kenne ich nicht mehr.")
    action, kind, item_id, then = match["action"], match["kind"], match["id"], match["then"]
    if action == "show":
        return await answer_anmelden(db, discord_user_id, f"{kind}:{item_id}", then=then)
    if action == "reg":
        return await confirm(db, discord_user_id, kind, item_id, then)
    return await withdraw(db, discord_user_id, kind, item_id)

