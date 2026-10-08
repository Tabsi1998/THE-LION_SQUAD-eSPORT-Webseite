"""Was ein Rechnungsauftrag über seinen Vorgang erzählt (#370): Name und Datum des Events oder Turniers,
Person, Begleitpersonen, Team - und die Kurzform für Postfach und Mail.

Ein Blatt ohne Importe aus ``services`` außer der Vereinszeitzone - der Abgleich mit Dolibarr
(``dolibarr_billing``, Rechnungstexte) und die Meldung „Deine Rechnung ist da“ (``invoice_notice``) nutzen es
beide, ohne einander dafür zu importieren (sonst entstünde ein Import-Zyklus, #1408).
"""
from __future__ import annotations

from datetime import datetime

from services.dolibarr_policy import CLUB_TZ


def _club_date(value) -> str:
    """„31.10.2026“ am Wiener Tag - oder leer."""
    if not value:
        return ""
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return ""
    if moment.tzinfo is not None:
        moment = moment.astimezone(CLUB_TZ)
    return moment.strftime("%d.%m.%Y")


async def booking_facts(db, order: dict) -> dict:
    """Was vom Vorgang auf die Rechnung gehört: Name und Datum des Events oder Turniers, die Person,
    Personen und Begleitpersonen (Event), Team und Spielerzahl (Turnier)."""
    snapshot = order.get("snapshot") or {}
    recipient = snapshot.get("recipient") or {}
    facts = {"kind": order.get("kind"), "name": "", "date": "", "person": recipient.get("display_name") or "",
             "seats": 1, "companions": 0, "team": "", "players": 0}
    if order.get("kind") == "event":
        event = await db.events.find_one({"id": order.get("source_id")}, {"_id": 0, "name": 1, "start_date": 1})
        registration = await db.event_registrations.find_one({"id": order.get("registration_id")}, {"_id": 0, "companion_count": 1, "seat_count": 1})
        facts["name"] = (event or {}).get("name") or "Event"
        facts["date"] = _club_date((event or {}).get("start_date"))
        companions = max(0, int((registration or {}).get("companion_count") or 0))
        facts["companions"] = companions
        facts["seats"] = max(1, int((registration or {}).get("seat_count") or (1 + companions)))
    elif order.get("kind") == "tournament":
        tournament = await db.tournaments.find_one({"id": order.get("source_id")}, {"_id": 0, "title": 1, "start_date": 1})
        facts["name"] = (tournament or {}).get("title") or "Turnier"
        facts["date"] = _club_date((tournament or {}).get("start_date"))
        facts["team"] = (snapshot.get("source") or {}).get("display_name") or ""
        per_person = [int(line.get("quantity") or 1) for line in snapshot.get("positions") or [] if line.get("basis") == "per_person"]
        facts["players"] = max(per_person) if per_person else 0
    return facts


def source_label(facts: dict) -> str:
    """„Startgeld Herbst-Cup – Team Lions“ oder „Vereinsausflug“ - der Vorgang in einem Wort."""
    if facts.get("kind") == "tournament":
        return f"Startgeld {facts.get('name') or 'Turnier'}" + (f" – {facts['team']}" if facts.get("team") else "")
    return facts.get("name") or "Event"
