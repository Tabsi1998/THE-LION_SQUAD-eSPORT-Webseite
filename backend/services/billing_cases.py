"""Prüffälle der Abrechnung (#321, #322): was Website und Dolibarr nicht von selbst auflösen dürfen.

Ein Prüffall entsteht, wenn Buchung und Beleg auseinanderlaufen: die Anmeldung wird storniert,
obwohl der Beleg schon existiert; Begleitpersonen ändern sich nach dem Beleg; jemand zahlt mehr als
den Betrag oder zahlt auf eine stornierte Buchung; der Beleg in Dolibarr weicht vom Auftrag ab oder
ist verschwunden. Die Website ändert dann nichts still - weder in Dolibarr noch am eingefrorenen
Preis. Sie hält den Fall fest, sagt der Finanzverwaltung, was zu tun ist, und liest weiter nach.

Ein offener Fall je Auftrag und Art. Erledigt wird er mit Grund durch die Finanzverwaltung - oder
von selbst, wenn der Abgleich sieht, dass Dolibarr ihn aufgelöst hat (Gutschrift da, Beleg
aufgegeben, Beträge stimmen wieder). Ein Fall ist nie ein Zahlungsnachweis und löst nie eine
Rückzahlung aus: Erstattungen erfasst die Finanzverwaltung am Auftrag, nachdem das Geld weg ist.
"""
from __future__ import annotations

from models import new_id, now_utc

KINDS = {
    "cancelled_after_invoice": {
        "label": "Storniert, Beleg existiert",
        "todo": "In Dolibarr entscheiden: einen Entwurf löschen, einen freigegebenen Beleg mit einer Gutschrift (Bezug auf das Original) ausgleichen und bezahltes Geld erstatten. Die Website legt keine Gutschrift an und zahlt nichts aus.",
    },
    "changed_after_invoice": {
        "label": "Buchung nach dem Beleg geändert",
        "todo": "Der Beleg passt nicht mehr zur Buchung. In Dolibarr korrigieren (Gutschrift und neuer Beleg oder Nachberechnung); der eingefrorene Preis auf der Website bleibt, bis das erledigt ist.",
    },
    "overpaid": {
        "label": "Überzahlung",
        "todo": "Es kam mehr Geld als der Beleg verlangt. Differenz erstatten oder mit der Person als Spende vereinbaren – in Dolibarr buchen, hier die Erstattung erfassen.",
    },
    "paid_after_cancel": {
        "label": "Zahlung auf stornierte Buchung",
        "todo": "Die Buchung war storniert, trotzdem kam Geld. Nicht reaktivieren: erstatten oder mit der Person klären, dann hier erfassen.",
    },
    "amount_mismatch": {
        "label": "Betrag weicht ab",
        "todo": "Der Beleg in Dolibarr lautet auf einen anderen Betrag als der eingefrorene Preis. Beleg prüfen – die Website schreibt nichts zurück und ändert den Preis nicht.",
    },
    "recipient_mismatch": {
        "label": "Empfänger weicht ab",
        "todo": "Der Beleg hängt in Dolibarr an einem anderen Geschäftspartner als erwartet. Zuordnung in Dolibarr prüfen; wenn es so richtig ist, den Fall mit Grund erledigen.",
    },
    "invoice_gone": {
        "label": "Beleg nicht mehr in Dolibarr",
        "todo": "Dolibarr kennt den Beleg nicht mehr (gelöscht?). Nachsehen. Die Website legt keinen zweiten an, solange der Fall offen ist.",
    },
}


def case_view(case: dict) -> dict:
    kind = KINDS.get(case.get("kind") or "", {})
    return {**case, "label": kind.get("label") or case.get("kind"), "todo": kind.get("todo") or ""}


async def open_case(db, order: dict, kind: str, detail: dict | None = None) -> dict:
    """Ein offener Fall je Auftrag und Art - ein zweiter Anlauf ergänzt nur die Angaben."""
    assert kind in KINDS, kind
    now = now_utc().isoformat()
    existing = await db.billing_cases.find_one({"order_id": order["id"], "kind": kind, "status": "open"}, {"_id": 0})
    if existing:
        if detail:
            await db.billing_cases.update_one({"id": existing["id"]}, {"$set": {"detail": {**(existing.get("detail") or {}), **detail}, "updated_at": now}})
            existing["detail"] = {**(existing.get("detail") or {}), **detail}
        return existing
    case = {
        "id": new_id(), "order_id": order["id"], "kind": kind, "status": "open",
        "user_id": order.get("user_id"), "source_kind": order.get("kind"), "source_id": order.get("source_id"), "registration_id": order.get("registration_id"),
        "invoice_ref": order.get("invoice_ref") or "", "total_cents": int(order.get("total_cents") or 0),
        "detail": detail or {}, "opened_at": now, "updated_at": now,
    }
    await db.billing_cases.insert_one(case)
    case.pop("_id", None)
    return case


async def resolve_case(db, case_id: str, actor_id: str | None, reason: str, *, auto: bool = False) -> dict | None:
    """Erledigt mit Grund - durch die Finanzverwaltung oder durch den Abgleich (auto)."""
    now = now_utc().isoformat()
    await db.billing_cases.update_one({"id": case_id, "status": "open"}, {"$set": {
        "status": "resolved", "resolved_at": now, "resolved_by": actor_id, "resolution": reason.strip(), "auto": auto, "updated_at": now,
    }})
    return await db.billing_cases.find_one({"id": case_id}, {"_id": 0})


async def auto_resolve(db, order_id: str, kind: str, note: str) -> int:
    """Der Abgleich sieht, dass Dolibarr den Fall aufgelöst hat."""
    count = 0
    async for case in db.billing_cases.find({"order_id": order_id, "kind": kind, "status": "open"}, {"_id": 0, "id": 1}):
        await resolve_case(db, case["id"], None, note, auto=True)
        count += 1
    return count


async def cases_for_order(db, order_id: str) -> list[dict]:
    rows = await db.billing_cases.find({"order_id": order_id}, {"_id": 0}).sort("opened_at", 1).to_list(50)
    return [case_view(row) for row in rows]


async def list_cases(db, status: str = "open", limit: int = 200) -> list[dict]:
    query = {} if status == "all" else {"status": status}
    rows = await db.billing_cases.find(query, {"_id": 0}).sort("opened_at", -1 if status == "resolved" else 1).to_list(limit)
    return [case_view(row) for row in rows]


async def open_count(db) -> int:
    return int(await db.billing_cases.count_documents({"status": "open"}))
