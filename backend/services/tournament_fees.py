"""Startgelder für Turniere (#319): dasselbe Preismodell wie Events, derselbe Rechnungsweg.

Ein Turnier kann ein Angebot tragen (``billing`` wie beim Event, #315). Preisbasen:
- ``per_registration``  ein Betrag je Anmeldung - Solo oder Team, egal wie groß
- ``per_team``          ein Betrag je Team-Anmeldung (Solo zählt als ein Team)
- ``per_person``        je abrechenbarem Spieler des Turnier-Rosters - Ersatzspieler nur, wenn
                        ``count_substitutes`` gesetzt ist; nie die Mitgliederzahl des Community-Teams

**Zahlungspflichtig** ist in der ersten Ausbaustufe die anmeldende Person - bei Teams die
Teamleitung, die die Kostenübernahme ausdrücklich bestätigt (``accept_costs``). Teamname und
Roster sind Referenz auf der Rechnung, nicht der Empfänger. Einzelrechnungen je Spieler kommen
später als eigene Stufe.

Abgerechnet wird erst mit der **verbindlichen Teilnahme** (Status ``approved``): Warteliste und
offene Freigabe zahlen nichts; Ablehnung oder Abmeldung vor dem Beleg schließt den Auftrag.
Hängt das Turnier an einem Event, dessen Beitrag das Startgeld schon enthält, setzt der Admin
``included_in_event`` - dann entsteht keine zweite Rechnung.
"""
from __future__ import annotations

from fastapi import HTTPException

from models import now_utc
from services import billing_orders, pricing
from services.permissions import user_has_area

BILLABLE_STATUSES = ("approved", "checked_in")
CLOSED_STATUSES = ("rejected", "no_show", "withdrawn", "cancelled")


async def billing_updates(raw: dict, existing: dict | None, me: dict) -> dict | None:
    """Kosten pflegt nur der Bereich Finanzen (#322) - für Events wie für Turniere."""
    if "billing" not in raw:
        return None
    if not await user_has_area(me, "finance"):
        raise HTTPException(status_code=403, detail="Kosten und Abrechnung pflegt der Bereich „Finanzen“.")
    try:
        offer = pricing.normalize_offer(raw.get("billing") or {})
    except pricing.PricingError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    extras = raw.get("billing") or {}
    offer["count_substitutes"] = bool(extras.get("count_substitutes"))
    offer["included_in_event"] = bool(extras.get("included_in_event"))
    return pricing.bump_version((existing or {}).get("billing"), offer)


def roster_size(registration: dict, tournament: dict, offer: dict) -> int:
    """Wie viele Personen zählen: Solo eins; Team der bestätigte Roster, sonst die Teamgröße."""
    if registration.get("registration_type") != "team":
        return 1
    roster = registration.get("roster") or registration.get("lineup") or []
    if isinstance(roster, list) and roster:
        players = [entry for entry in roster if isinstance(entry, dict)]
        if not offer.get("count_substitutes"):
            players = [entry for entry in players if not entry.get("substitute") and str(entry.get("role") or "") != "substitute"]
        return max(1, len(players) if players else len(roster))
    return max(1, int(tournament.get("team_size") or 1))


def charges(tournament: dict, offer: dict | None) -> bool:
    """Kostet die Teilnahme etwas - und ist sie nicht schon im Event enthalten?"""
    if not pricing.is_paid(offer):
        return False
    if offer.get("included_in_event") and tournament.get("event_id"):
        return False
    return True


def quote_for(registration: dict, tournament: dict, offer: dict, selected: list[str] | None = None) -> dict:
    seats = roster_size(registration, tournament, offer)
    return pricing.quote(offer, seats=seats, teams=1, selected=selected)


async def freeze_price(db, registration: dict, tournament: dict, *, payer: dict, selected: list[str] | None = None) -> dict | None:
    """Preis einfrieren und Auftrag anlegen - nur bei verbindlicher Teilnahme und nur einmal."""
    offer = tournament.get("billing") or {}
    if not charges(tournament, offer) or registration.get("status") not in BILLABLE_STATUSES:
        return None
    if registration.get("price_snapshot") and registration.get("billing_status") not in (None, "cancelled"):
        return registration["price_snapshot"]
    try:
        price = quote_for(registration, tournament, offer, selected or registration.get("selected_positions") or [])
    except pricing.PricingError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if price.get("free"):
        return None
    snapshot = pricing.snapshot(price, recipient=payer, source={
        "kind": "tournament", "id": tournament["id"], "slug": tournament.get("slug"), "registration_id": registration["id"],
        "team_id": registration.get("team_id"), "display_name": registration.get("display_name"),
    })
    await db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {"price_snapshot": snapshot, "billing_status": "pending", "updated_at": now_utc().isoformat()}})
    await billing_orders.create_order(db, kind="tournament", source_id=tournament["id"], registration_id=registration["id"], user_id=payer["id"],
                                      snapshot=snapshot, timing=offer.get("invoice_timing") or "on_confirm")
    return snapshot


async def close_price(db, registration: dict, reason: str) -> None:
    """Abgelehnt oder abgemeldet, bevor ein Beleg entstand: Auftrag zu, Snapshot bleibt als Verlauf."""
    await billing_orders.cancel_orders_for(db, kind="tournament", registration_id=registration["id"], reason=reason)
    if registration.get("price_snapshot") and registration.get("billing_status") in (None, "pending"):
        await db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {"billing_status": "cancelled"}})


def public_price(registration: dict) -> dict | None:
    """Was die anmeldende Person über ihren Preis sieht - keine Dolibarr-Nummern."""
    snapshot = registration.get("price_snapshot")
    if not snapshot:
        return None
    return {
        "total_cents": snapshot.get("total_cents"), "currency": snapshot.get("currency"),
        "positions": [{k: line.get(k) for k in ("key", "label", "quantity", "unit_cents", "total_cents", "optional")} for line in snapshot.get("positions") or []],
        "accepted_at": snapshot.get("accepted_at"), "billing_status": registration.get("billing_status") or "pending",
        "invoice_ref": registration.get("invoice_ref"), "invoice_status": registration.get("invoice_status"),
        "payer_user_id": (snapshot.get("recipient") or {}).get("user_id"),
    }
