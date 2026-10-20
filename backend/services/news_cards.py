"""Angaben für News-Karten, die mehr brauchen als der Beitrag selbst.

* Ergebnis-News (#1343): Ist ein verknüpftes Turnier mit veröffentlichten Ergebnissen dabei, trägt die News den
  Sieger (``result``) - die Text-Karte zeigt dann Pokal und „1. Name“ statt eines Satzes.
"""
from __future__ import annotations

from services import event_registration
from services.public_phase import derive_public_phase, parse_dt
from services.tournament_path import visible_names
from services.visibility import filter_visible

RESULT_STATUSES = {"results_published", "archived"}
COUNTED_TOURNAMENT_REGISTRATIONS = ["approved", "checked_in"]
LIVE_STATES = {"live", "paused", "day_break", "check_in"}


async def visible_tournaments(tournaments: list[dict], user: dict | None) -> list[dict]:
    """Turniere, die der Besucher sehen darf - je Sichtbarkeit einmal entschieden, nicht je Turnier."""
    return await filter_visible([t for t in tournaments if t.get("is_public") is not False], user)


async def attach_result_winners(db, posts: list[dict], user: dict | None) -> None:
    """Setzt ``result = {"winner", "tournament"}`` je Beitrag mit verknüpftem, abgeschlossenem Turnier - mit einer
    festen Zahl Abfragen für die ganze Liste. Nur Turniere, die der Besucher sehen darf. Der Name folgt derselben Regel
    wie öffentliche Ergebnisse (``tournament_path.visible_names``): Einzelne nur mit öffentlichem Profil, Teams nur,
    wenn das Team öffentlich ist - sonst keine Sieger-Karte."""
    ids = {tid for post in posts for tid in (post.get("linked_tournament_ids") or []) if tid}
    if not ids:
        return
    tournaments = await db.tournaments.find(
        {"id": {"$in": list(ids)}, "status": {"$in": list(RESULT_STATUSES)}},
        {"_id": 0, "id": 1, "title": 1, "visibility": 1, "is_public": 1},
    ).to_list(len(ids))
    visible = {t["id"]: t for t in await visible_tournaments(tournaments, user)}
    if not visible:
        return
    awards = await db.tournament_awards.find(
        {"tournament_id": {"$in": list(visible)}, "rank": 1}, {"_id": 0, "tournament_id": 1, "registration_id": 1},
    ).to_list(len(visible) * 4)
    first_award = {}
    for award in awards:
        if award.get("registration_id"):
            first_award.setdefault(award["tournament_id"], award["registration_id"])
    names = await visible_names(db, list(first_award.values()), public=True)
    winners = {
        tid: {"winner": names[rid], "tournament": visible[tid].get("title") or "Turnier"}
        for tid, rid in first_award.items() if names.get(rid)
    }
    for post in posts:
        for tid in post.get("linked_tournament_ids") or []:
            if tid in winners:
                post["result"] = winners[tid]
                break


# ---------------------------------------------------------------- Weg zur Anmeldung (#1266)
#
# Je verknüpftem Turnier oder Event der Stand für die Karte unter dem ersten Absatz: ``state`` ist
# open (anmelden), full (ausgebucht), soon (öffnet später), closed (Anmeldung zu), live (läuft), results
# (Ergebnisse da), finished (vorbei), cancelled (abgesagt) oder none (Event ohne Anmeldung). Dazu Beginn
# und Plätze. Web und App lesen dieselben Angaben.

def _signup(state: str, start_date, *, taken: int | None = None, maximum=None, opens_at=None) -> dict:
    maximum = int(maximum) if maximum else None
    spots_left = max(maximum - (taken or 0), 0) if maximum else None
    return {"state": state, "start_date": start_date, "taken": taken, "max": maximum, "spots_left": spots_left, "opens_at": opens_at}


def _window_open(doc: dict, open_from_key: str, open_until_key: str, now) -> bool:
    opens = parse_dt(doc.get(open_from_key))
    closes = parse_dt(doc.get(open_until_key))
    return not (opens and now < opens) and not (closes and now > closes)


async def tournament_signup(db, tournament: dict, now=None) -> dict:
    status = tournament.get("status") or "draft"
    phase = derive_public_phase(tournament, "tournament", now)
    now = parse_dt(phase["now"])
    taken = await db.tournament_registrations.count_documents(
        {"tournament_id": tournament.get("id"), "status": {"$in": COUNTED_TOURNAMENT_REGISTRATIONS}},
    )
    args = {"taken": taken, "maximum": tournament.get("max_participants")}
    start = tournament.get("start_date")
    if status in RESULT_STATUSES:
        return _signup("results", start, **args)
    if status == "cancelled":
        return _signup("cancelled", start, **args)
    if status == "completed" or phase["state"] == "completed":
        return _signup("finished", start, **args)
    if phase["state"] in LIVE_STATES:
        return _signup("live", start, **args)
    if tournament.get("registration_enabled") is False or tournament.get("is_invite_only"):
        return _signup("closed", start, **args)
    opens_at = tournament.get("registration_open_from")
    if status == "registration_open" and _window_open(tournament, "registration_open_from", "registration_open_until", now):
        maximum = args["maximum"]
        return _signup("full" if maximum and taken >= int(maximum) else "open", start, **args)
    opens = parse_dt(opens_at)
    if status in {"scheduled", "announced", "draft"} or (status == "registration_open" and opens and now < opens):
        return _signup("soon", start, opens_at=opens_at, **args)
    return _signup("closed", start, **args)


async def event_signup(db, event: dict, now=None) -> dict:
    phase = derive_public_phase(event, "event", now)
    state = phase["state"]
    start = event.get("start_date")
    if state == "cancelled":
        return _signup("cancelled", start)
    if state in {"completed", "results_published", "archived"}:
        return _signup("finished", start)
    if state in LIVE_STATES:
        return _signup("live", start)
    if not event.get("has_registration"):
        return _signup("none", start)
    summary = await event_registration.summary(db, event)
    args = {"taken": summary.get("reserved_seats") or 0, "maximum": event.get("max_participants")}
    if state == "registration_open":
        full = summary.get("spots_left") is not None and summary["spots_left"] <= 0
        return _signup("full" if full else "open", start, **args)
    if state in {"announced", "registration_pending", "draft"}:
        return _signup("soon", start, opens_at=event.get("registration_opens_at"), **args)
    return _signup("closed", start, **args)
