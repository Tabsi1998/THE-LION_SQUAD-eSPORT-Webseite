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
from services.billing_amounts import public_payment_state
from services.permissions import user_has_area

BILLABLE_STATUSES = ("approved", "checked_in")
CLOSED_STATUSES = ("rejected", "no_show", "withdrawn", "disqualified", "cancelled")


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


def same_payer(order: dict, payer: dict, registration: dict) -> bool:
    """Gehört der Auftrag zu dieser zahlenden Person und diesem Team (#2368)? Nur dann bucht eine Rückkehr auf seinen Beleg
    zurück. Altaufträge ohne Preis-Kennung vergleichen nur die Person."""
    source = (order.get("snapshot") or {}).get("source") or {}
    same_team = "team_id" not in source or (source.get("team_id") or None) == (registration.get("team_id") or None)
    return order.get("user_id") == payer.get("id") and same_team


def rebook_reason_for(registration: dict, order: dict) -> str:
    """Der Grund im Prüffall, wenn die Leitung eine zurückgekehrte Anmeldung bestätigt (#2368): Entstand die Anmeldung erst nach
    dem Storno, hat sich die Person selbst neu angemeldet (etwa auf die Warteliste) - „Nach Storno selbst neu angemeldet“.
    Sonst hat die Leitung eine beendete Anmeldung wieder aktiviert."""
    created, cancelled = str(registration.get("created_at") or ""), str(order.get("booking_cancelled_at") or "")
    return billing_orders.REBOOKED_SELF if created and cancelled and created > cancelled else billing_orders.REBOOKED_BY_LEAD


async def freeze_price(db, registration: dict, tournament: dict, *, payer: dict, selected: list[str] | None = None,
                       rebook_reason: str | None = None) -> dict | None:
    """Preis einfrieren und Auftrag anlegen - nur bei verbindlicher Teilnahme und nur einmal.

    Zurück nach einem Storno, obwohl es zur Anmeldung schon einen Beleg gibt (#2368, wie bei Events #2184): kein neuer Preis
    und kein zweiter Auftrag. Die Buchung gilt am Auftrag wieder (``billing_orders.rebook_after_invoice``), die Anmeldung trägt
    wieder Preis und Stand des Belegs, die Finanzverwaltung bekommt den Prüffall mit alt und neu (Grund ``rebook_reason``, ohne
    ihn ``rebook_reason_for``). Gilt der Beleg nicht mehr (voll gutgeschrieben, aufgegeben, Entwurf gelöscht) oder gehört er
    einer anderen zahlenden Person (``same_payer``), gilt der aktuelle Preis mit eigenem Auftrag.

    Was hier an die Anmeldung geht, steht danach auch in ``registration`` - nach einer Rückbuchung dazu ``invoice_kept`` (nur
    für Nachricht und Antwort, nie gespeichert, ``event_notifications.kept_invoice_line``)."""
    offer = tournament.get("billing") or {}
    if not charges(tournament, offer) or registration.get("status") not in BILLABLE_STATUSES:
        return None
    # Entscheidend ist der Auftrag, nicht der Stand der Anmeldung: Der Abgleich setzt eine beendete Anmeldung wieder auf den
    # Stand ihres Belegs (``billing_status`` „invoiced“), die Buchung am Auftrag bleibt storniert.
    returning = await billing_orders.booking_cancelled_with_invoice(db, kind="tournament", registration=registration)
    if registration.get("price_snapshot") and registration.get("billing_status") not in (None, "cancelled") and not returning:
        return registration["price_snapshot"]
    try:
        price = quote_for(registration, tournament, offer, selected or registration.get("selected_positions") or [])
    except pricing.PricingError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if price.get("free"):
        return None
    now = now_utc().isoformat()
    invoiced = await billing_orders.invoiced_order(db, kind="tournament", registration_id=registration["id"]) if returning else None
    if invoiced and not same_payer(invoiced, payer, registration):
        # Ein anderes Teammitglied hat die Anmeldung übernommen (#2368, etwa nach weggenommener Ablehnung): Die Rechnung gehört
        # der bisherigen Person - die neue zahlt mit eigenem Auftrag, die alte Rechnung bleibt storniert.
        invoiced = None
    if invoiced and await billing_orders.rebook_after_invoice(db, invoiced, reason=rebook_reason or rebook_reason_for(registration, invoiced),
                                                              new_total_cents=int(price.get("total_cents") or 0)):
        fields = billing_orders.rebooked_fields(invoiced)
        await db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {**fields, "updated_at": now}})
        registration.update(fields, invoice_kept=True)
        return registration.get("price_snapshot")
    snapshot = pricing.snapshot(price, recipient=payer, source={
        "kind": "tournament", "id": tournament["id"], "slug": tournament.get("slug"), "registration_id": registration["id"],
        "team_id": registration.get("team_id"), "display_name": registration.get("display_name"),
    }, invoice_timing=offer.get("invoice_timing") or "on_confirm")
    fields = {"price_snapshot": snapshot, "billing_status": "pending"}
    if registration.get("invoice_id") or registration.get("invoice_ref"):
        fields.update(billing_orders.INVOICE_LINK_CLEARED)   # der alte Beleg gilt nicht mehr - die Anmeldung zeigt ihn nicht weiter
    await db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {**fields, "updated_at": now}})
    registration.update(fields)
    await billing_orders.create_order(db, kind="tournament", source_id=tournament["id"], registration_id=registration["id"], user_id=payer["id"],
                                      snapshot=snapshot, timing=pricing.order_timing(snapshot, offer))
    return snapshot


async def returning_registration_id(db, tournament: dict, *, payer_id: str, team_id: str | None) -> str | None:
    """Abgemeldet und neu angemeldet (#2368): Die Abmeldung löscht die Turnier-Anmeldung, ihr Auftrag mit Beleg bleibt
    „storniert“. Gilt der Beleg noch, kommt dieselbe Anmeldung zurück - mit ihrer Kennung, damit ``freeze_price`` den Auftrag
    findet, statt einen zweiten anzulegen (auch erst beim Nachrücken von der Warteliste oder bei der Freigabe).

    Dieselbe Anmeldung heißt: dasselbe Turnier, dieselbe zahlende Person und dasselbe Team (Solo: keins). Meldet ein anderes
    Mitglied das Team neu an, übernimmt es die Kosten selbst: eigener Auftrag, die alte Rechnung bleibt beim alten Auftrag
    (Gutschrift über den Storno). Lebt die Anmeldung zum Auftrag noch, ist es keine Rückkehr über diesen Weg."""
    order = await db.billing_orders.find_one(
        {"kind": "tournament", "source_id": tournament["id"], "user_id": payer_id, "snapshot.source.team_id": team_id,
         "status": "invoiced", "booking_state": "cancelled", **billing_orders.INVOICE_STILL_VALID},
        {"_id": 0, "registration_id": 1}, sort=[("created_at", -1)])
    if not order or await db.tournament_registrations.find_one({"id": order["registration_id"]}, {"_id": 0, "id": 1}):
        return None
    return order["registration_id"]


async def repair_order(db, registration: dict, tournament: dict, *, actor: dict | None) -> dict | None:
    """Nachholen (#1184): eine verbindliche, kostenpflichtige Anmeldung ohne Auftrag bekommt ihn bei der Wiederholung.

    Scheitert der Auftrag nach gespeicherter Anmeldung (oder nach gespeichertem Preis), antwortet die Wiederholung sonst
    nur „schon angemeldet“, und es entstünde nie eine Rechnung. Ohne Preis friert die Wiederholung ihn ein - aber nur für
    die Person, die die Kosten übernommen hat. Gibt den Preis zurück, wenn jetzt ein Auftrag entstand.

    Mit eingefrorenem Preis zählt nur dieser, nicht die heutige Abrechnung des Turniers (Codex-Prüfung #1500): wurde
    das Startgeld nach dem Abbruch abgeschaltet, gilt der vereinbarte Preis trotzdem. Nur das Einfrieren selbst fragt
    das heutige Angebot."""
    offer = tournament.get("billing") or {}
    if registration.get("status") not in BILLABLE_STATUSES:
        return None
    snapshot = registration.get("price_snapshot")
    if not snapshot:
        if not charges(tournament, offer) or not actor or registration.get("costs_accepted_by") != actor.get("id"):
            return None
        return await freeze_price(db, registration, tournament, payer=actor)
    if int(snapshot.get("total_cents") or 0) <= 0 or registration.get("billing_status") not in (None, "pending"):
        return None
    key = billing_orders.booking_key("tournament", registration["id"], snapshot)
    known = {"booking_key": key} if key else {"kind": "tournament", "registration_id": registration["id"], "status": {"$nin": ["cancelled", "failed"]}}
    if await db.billing_orders.find_one(known, {"_id": 0, "id": 1}):
        return None
    payer_id = (snapshot.get("recipient") or {}).get("user_id") or registration.get("costs_accepted_by")
    if not payer_id:
        return None
    await billing_orders.create_order(db, kind="tournament", source_id=tournament["id"], registration_id=registration["id"], user_id=payer_id,
                                      snapshot=snapshot, timing=pricing.order_timing(snapshot, offer))
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
        "payment_state": public_payment_state(registration.get("payment_state")),
        "payer_user_id": (snapshot.get("recipient") or {}).get("user_id"),
    }
