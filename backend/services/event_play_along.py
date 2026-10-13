"""„Spielst du auch mit?“ (#1184): nach der Event-Anmeldung die Turniere des Events in einem Schritt.

- **Die Auswahl** (``options``): je Einzel-Turnier ein Haken mit Tag, Uhrzeit, Spielart, Startgeld und freien Plätzen;
  Team-Turniere nur als Hinweis (der Kapitän meldet das Team auf der Turnierseite an), Fast Laps als Hinweis ohne Haken
  - für eine Fast Lap gibt es keine Anmeldung, man fährt seine Zeit. Gezeigt wird, was gerade offen ist oder wo die
  Person schon dabei ist. Ohne Einträge gibt es den Schritt nicht.
- **Die Anmeldung** (``register_many``): je Haken die normale Selbstanmeldung (``self_register``) mit allen Regeln - Sperre,
  Frist, Vereinsmitglieder, Event-Pflicht (#875), Startgeld (#319), voll → Warteliste, Doppelanmeldung. Es gibt keine
  zweite Anmeldelogik. Je Eintrag kommt „angemeldet“, „Warteliste“, „schon dabei“ oder der Fehler mit Grund zurück; die
  Summe zählt nur, was in diesem Schritt verbindlich und kostenpflichtig wurde - genau die neuen Rechnungsaufträge.
"""
from __future__ import annotations

import logging

from fastapi import HTTPException

from models import RegistrationCreate
from services import event_days, event_facts, pricing, tournament_event_gate, tournament_fees
from services.log_safe import log_safe
from services.public_phase import TERMINAL_STATUSES, derive_public_phase
from services.visibility import lead_can_see

logger = logging.getLogger("tls.event_play_along")

MAX_PICKS = 20
ACTIVE_REGISTRATION = ("pending", "approved", "checked_in")
FASTLAP_HINT = "Keine Anmeldung nötig – du fährst einfach deine Bestzeit."
TEAM_HINT = "Dein Kapitän meldet das Team an."
CAPTAIN_HINT = "Melde dein Team auf der Turnierseite an."
STATE_LABELS = {
    "registered": "Du bist dabei",
    "waitlist": "Warteliste",
    "pending": "Wartet auf Freigabe",
    "already": "Schon angemeldet",
    "error": "Nicht angemeldet",
}


def _is_team(tournament: dict) -> bool:
    return (tournament.get("team_mode") or "solo") != "solo"


def _limit(tournament: dict) -> int | None:
    value = tournament.get("max_participants", 32)
    try:
        return int(value) if value else None
    except (TypeError, ValueError):
        return None


def _fee(tournament: dict) -> dict | None:
    """Was eine Einzelanmeldung kostet (Pflichtpositionen) - dieselbe Rechnung wie beim Anmelden."""
    offer = tournament.get("billing") or {}
    if not tournament_fees.charges(tournament, offer):
        return None
    try:
        quote = tournament_fees.quote_for({"registration_type": "solo"}, tournament, offer)
    except pricing.PricingError:
        return None
    if quote.get("free"):
        return None
    return {"total_cents": int(quote.get("total_cents") or 0), "currency": quote.get("currency") or "EUR"}


async def _visible(tournament: dict, user: dict) -> bool:
    """Dieselbe Regel wie die Turnierseite - die Route wirft 404/403, hier wird daraus ja/nein."""
    from routes.tournament_common import _get_visible_tournament

    try:
        await _get_visible_tournament(tournament["id"], user)
    except HTTPException:
        return False
    return True


async def _game_names(db, tournaments: list[dict]) -> dict[str, str]:
    ids = sorted({t.get("game_id") for t in tournaments if t.get("game_id")})
    if not ids:
        return {}
    rows = await db.games.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1, "display_name": 1}).to_list(len(ids))
    return {row["id"]: row.get("display_name") or row.get("name") or "" for row in rows}


async def _is_captain(db, user: dict) -> bool:
    from routes.tournament_registration_routes import _can_register_team

    teams = await db.teams.find({"member_ids": user["id"]}, {"_id": 0, "id": 1, "leader_id": 1, "co_leader_ids": 1}).to_list(50)
    return any(_can_register_team(team, user) for team in teams)


async def _tournament_entry(db, event: dict, tournament: dict, user: dict, *, own: dict | None, games: dict[str, str],
                            captain: bool, club_member: bool) -> dict | None:
    from routes.tournament_common import _is_tournament_locked
    from routes.tournament_registration_routes import _registration_error

    problem = _registration_error(tournament)
    if problem and not own:
        return None
    team = _is_team(tournament)
    limit = _limit(tournament)
    taken = await db.tournament_registrations.count_documents({"tournament_id": tournament["id"], "status": {"$in": list(ACTIVE_REGISTRATION)}})
    spots_left = max(limit - taken, 0) if limit else None
    reason = None
    if own:
        reason = own.get("label")
    elif team:
        reason = CAPTAIN_HINT if captain else TEAM_HINT
    elif _is_tournament_locked(tournament):
        reason = "Das Turnier wird gerade bearbeitet – versuch es gleich noch einmal."
    elif tournament.get("block_club_member_registration") and club_member:
        reason = "Dieses Turnier ist für externe Teilnehmer vorgesehen."
    else:
        gate = await tournament_event_gate.check(db, tournament, user=user)
        if gate and not gate["ok"]:
            reason = gate["text"]
    return {
        "kind": "tournament",
        "id": tournament["id"],
        "slug": tournament.get("slug"),
        "title": tournament.get("title") or "Turnier",
        "start_date": tournament.get("start_date"),
        "event_day": event_days.day_of(event, tournament.get("start_date")),
        "mode": "Team" if team else "Einzel",
        "team": team,
        "team_size": tournament.get("team_size") if team else None,
        "game": games.get(tournament.get("game_id") or "") or None,
        "fee": None if team else _fee(tournament),
        "spots_left": spots_left,
        "full": bool(limit) and spots_left == 0,
        "my_status": own,
        "captain": bool(team and captain),
        "selectable": reason is None,
        "reason": reason,
    }


def _fastlap_entry(event: dict, challenge: dict, own: dict | None) -> dict:
    return {
        "kind": "fastlap",
        "id": challenge["id"],
        "slug": challenge.get("slug"),
        "title": challenge.get("title") or "Fast Lap",
        "start_date": challenge.get("start_date"),
        "event_day": event_days.day_of(event, challenge.get("start_date")),
        "mode": "Bestzeit fahren",
        "team": False,
        "team_size": None,
        "game": None,
        "fee": None,
        "spots_left": None,
        "full": False,
        "my_status": own,
        "captain": False,
        "selectable": False,
        "reason": FASTLAP_HINT,
    }


async def options(db, event: dict, user: dict) -> dict:
    """Die Einträge für den zweiten Schritt; ``show`` sagt, ob es ihn überhaupt gibt."""
    from routes.tournament_registration_routes import _is_active_club_member

    tournaments = [t for t in await db.tournaments.find({"event_id": event["id"]}, {"_id": 0}).to_list(200) if await _visible(t, user)]
    own = await event_facts.own_tournament_states(db, user["id"], [t["id"] for t in tournaments])
    games = await _game_names(db, tournaments)
    captain = await _is_captain(db, user) if any(_is_team(t) for t in tournaments) else False
    club_member = await _is_active_club_member(db, user) if any(t.get("block_club_member_registration") for t in tournaments) else False
    entries = []
    for tournament in tournaments:
        entry = await _tournament_entry(db, event, tournament, user, own=own.get(tournament["id"]), games=games, captain=captain, club_member=club_member)
        if entry:
            entries.append(entry)
    challenges = []
    for challenge in await db.f1_challenges.find({"event_id": event["id"]}, {"_id": 0}).to_list(200):
        if challenge.get("status") == "draft" or derive_public_phase(challenge, "f1").get("state") in TERMINAL_STATUSES:
            continue
        if await lead_can_see(user, challenge.get("visibility") or "public"):
            challenges.append(challenge)
    driven = await event_facts.driven_challenge_ids(db, user["id"], [c["id"] for c in challenges])
    entries += [_fastlap_entry(event, c, dict(event_facts.DRIVEN) if c["id"] in driven else None) for c in challenges]
    entries.sort(key=lambda row: (str(row.get("start_date") or "9999"), row["title"]))
    return {"show": bool(entries), "entries": entries}


def _result(tournament_id: str, title: str | None, state: str, *, detail: str | None = None, price: dict | None = None) -> dict:
    return {"id": tournament_id, "title": title, "state": state, "label": STATE_LABELS[state], "detail": detail, "price": price}


async def _register_one(db, event: dict, tournament_id: str, user: dict, body: RegistrationCreate) -> dict:
    from routes.tournament_registration_routes import self_register

    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0})
    if not tournament or not await _visible(tournament, user):
        return _result(tournament_id, None, "error", detail="Turnier nicht gefunden.")
    title = tournament.get("title") or "Turnier"
    if tournament.get("event_id") != event["id"]:
        return _result(tournament_id, title, "error", detail="Dieses Turnier gehört nicht zu diesem Event.")
    if _is_team(tournament):
        # Team-Turniere meldet der Kapitän mit Teamwahl und Aufstellung auf der Turnierseite an - nie hier nebenbei.
        return _result(tournament_id, title, "error", detail=TEAM_HINT + " Das geht auf der Turnierseite.")
    try:
        reg = await self_register(db, tournament, body, user, None, via="event")
    except HTTPException as exc:
        return _result(tournament_id, title, "error", detail=str(exc.detail))
    if reg.get("idempotent_replay"):
        return _result(tournament_id, title, "already", detail=event_facts.OWN_STATE_LABELS.get(reg.get("status")))
    state = {"waitlist": "waitlist", "pending": "pending"}.get(reg.get("status"), "registered")
    snapshot = reg.get("price_snapshot") if state == "registered" else None
    price = {"total_cents": int(snapshot.get("total_cents") or 0), "currency": snapshot.get("currency") or "EUR"} if snapshot else None
    return _result(tournament_id, title, state, price=price)


async def register_many(db, event: dict, user: dict, tournament_ids: list[str], *, accept_rules: bool, accept_privacy: bool,
                        accept_costs: bool) -> dict:
    """Je Haken eine normale Anmeldung, nacheinander; ein Fehler hält die anderen nicht auf."""
    if not accept_rules or not accept_privacy:
        raise HTTPException(status_code=400, detail="Regeln und Datenschutz müssen akzeptiert werden.")
    wanted = list(dict.fromkeys(str(tid) for tid in tournament_ids if tid))
    if len(wanted) > MAX_PICKS:
        raise HTTPException(status_code=400, detail=f"Höchstens {MAX_PICKS} Turniere auf einmal.")
    body = RegistrationCreate(accept_rules=True, accept_privacy=True, accept_costs=bool(accept_costs))
    results = []
    for tournament_id in wanted:
        row = await _register_one(db, event, tournament_id, user, body)
        if row["state"] == "error":
            logger.info("Play-along registration refused event=%s tournament=%s", log_safe(event.get("id")), log_safe(tournament_id))
        results.append(row)
    priced = [row["price"] for row in results if row["price"]]
    return {
        "results": results,
        "total_cents": sum(price["total_cents"] for price in priced),
        "currency": priced[0]["currency"] if priced else "EUR",
    }
