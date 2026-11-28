"""Plan A/B/C beim Ort (#2613): Am Event liegen vorab mehrere Orte als Alternativen, einer davon gilt.

**Daten** am Event - keine Migration, ein Event ohne Pläne ist eines mit genau dem einen Ort aus den bisherigen Feldern:

- ``place_plans``: die Pläne in fester Reihenfolge (A, B, C …), je ``key``, ``name``, ``address``, ``postal_code``,
  ``city``, ``country`` und ``note`` (Hinweis, etwa „Treffpunkt Parkplatz“). Mindestens zwei, höchstens fünf.
- ``active_place_plan``: der Schlüssel des Plans, der gerade gilt.
- ``place_plan_round``: zählt jede Umschaltung. Daraus entsteht der Schlüssel, unter dem jede Person je Umschaltung
  genau eine Nachricht bekommt, und an ihm erkennt der Server eine gleichzeitige zweite Umschaltung.

**Ein Ort für alle**: Der aktive Plan steht in den bisherigen Ortsfeldern (``location``, ``address``, ``postal_code``,
``city``, ``country``) - wie ``event_locations.mirror_primary`` den ersten Standort spiegelt. Listen, Kalender, ICS-Datei,
Erinnerungen, Mails und die App lesen so ohne Änderung den Ort, der gerade gilt. Pläne und eine Liste mehrerer
Standorte (#203) schließen sich aus: Ein Event an mehreren Orten zugleich hat keinen „Plan B“ für einen davon.

**Umschalten** ist ein eigener, bedingter Schritt: Er gilt nur, wenn noch der Plan aktiv ist, von dem aus umgeschaltet
wird. Von zwei gleichzeitigen Umschaltungen auf denselben Plan löst nur eine Nachricht und Protokoll aus; auf
verschiedene Pläne bekommt die zweite 409, statt die erste still zu überschreiben. Die Nachricht (Frage „Angemeldete
informieren?“) geht an Angemeldete samt Warteliste - wie beim Verschieben (``event_changes``). Protokoll
``event.place_plan`` mit von, nach, wer und wie viele benachrichtigt wurden.
"""
from __future__ import annotations

from models import new_id, now_utc
from services.event_locations import address_line, map_query

MAX_PLANS = 5
MIN_PLANS = 2
TEXT_FIELDS = {"name": 120, "address": 120, "postal_code": 20, "city": 120, "country": 120, "note": 300}
MIRRORED = ("address", "postal_code", "city", "country")
QUIET_STATUSES = ("draft", "archived", "cancelled")


class PlanError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def letter(index: int) -> str:
    return chr(ord("A") + index)


def plan_label(index: int) -> str:
    return f"Plan {letter(index)}"


def normalize_plans(raw_list) -> list[dict]:
    """Die Pläne aus der Maske prüfen: Reihenfolge = A, B, C; leer heißt „keine Pläne“."""
    if raw_list in (None, []):
        return []
    if not isinstance(raw_list, list):
        raise PlanError(400, "Die Ort-Pläne müssen eine Liste sein.")
    if len(raw_list) > MAX_PLANS:
        raise PlanError(400, f"Höchstens {MAX_PLANS} Ort-Pläne je Event (A bis {letter(MAX_PLANS - 1)}).")
    if len(raw_list) < MIN_PLANS:
        raise PlanError(400, "Ort-Pläne brauchen mindestens zwei Orte (Plan A und B) – sonst reicht der Ort allein.")
    plans = []
    for index, raw in enumerate(raw_list):
        raw = raw if isinstance(raw, dict) else {}
        plan = {"key": str(raw.get("key") or "").strip().lower()[:40] or f"plan-{letter(index).lower()}"}
        for field, limit in TEXT_FIELDS.items():
            plan[field] = " ".join(str(raw.get(field) or "").split())[:limit]
        if not (plan["name"] or address_line(plan)):
            raise PlanError(400, f"{plan_label(index)}: Name oder Adresse fehlt.")
        plans.append(plan)
    keys = [plan["key"] for plan in plans]
    if len(set(keys)) != len(keys):
        raise PlanError(400, "Die Ort-Pläne brauchen eindeutige Schlüssel.")
    return plans


def stored_plans(event: dict) -> list[dict]:
    plans = event.get("place_plans")
    return [plan for plan in plans if isinstance(plan, dict) and plan.get("key")] if isinstance(plans, list) else []


def active_index(event: dict) -> int | None:
    plans = stored_plans(event)
    if not plans:
        return None
    keys = [plan["key"] for plan in plans]
    key = event.get("active_place_plan")
    return keys.index(key) if key in keys else 0


def mirror(plan: dict, target: dict) -> dict:
    """Den Plan in die bisherigen Ortsfelder schreiben - dort lesen Listen, Kalender, ICS, Mails und die App."""
    target["location"] = plan.get("name") or ""
    for field in MIRRORED:
        target[field] = plan.get(field) or ""
    return target


def apply_on_save(target: dict, raw: dict, existing: dict | None) -> None:
    """Beim Speichern des Events: Pläne prüfen, den aktiven aus der Datenbank behalten und ihn in die Ortsfelder spiegeln.
    Die Maske setzt den aktiven Plan nie - das tut nur das Umschalten."""
    if "place_plans" not in raw:
        target.pop("place_plans", None)
        return
    plans = normalize_plans(raw.get("place_plans"))
    target["place_plans"] = plans
    if not plans:
        target["active_place_plan"] = None
        return
    places = target.get("locations") if "locations" in target else (existing or {}).get("locations")
    if places:
        raise PlanError(400, "Ort-Pläne gibt es nur bei einem Ort – bitte zuerst die Liste der Standorte leeren.")
    keys = [plan["key"] for plan in plans]
    current = (existing or {}).get("active_place_plan")
    active = current if current in keys else keys[0]
    target["active_place_plan"] = active
    mirror(plans[keys.index(active)], target)


def _plan_entry(plan: dict, index: int, active: int | None) -> dict:
    return {
        "key": plan["key"], "label": plan_label(index), "letter": letter(index), "index": index,
        "name": plan.get("name") or "", "address": plan.get("address") or "", "postal_code": plan.get("postal_code") or "",
        "city": plan.get("city") or "", "country": plan.get("country") or "", "note": plan.get("note") or "",
        "address_line": address_line(plan), "map_query": map_query(plan), "active": index == active,
    }


def plans_view(event: dict) -> list[dict]:
    """Alle Pläne für Seite, App und Verwaltung - der aktive mit ``active``."""
    active = active_index(event)
    return [_plan_entry(plan, index, active) for index, plan in enumerate(stored_plans(event))]


def plan_view(event: dict) -> dict | None:
    """Der Plan, der gerade gilt - ``alternative`` heißt: nicht mehr Plan A („Plan B aktiv“)."""
    index = active_index(event)
    if index is None:
        return None
    plans = stored_plans(event)
    return {**_plan_entry(plans[index], index, index), "total": len(plans), "alternative": index > 0}


def active_label(event: dict) -> str | None:
    """„Plan B“ für Kalender und ICS - nur, wenn es Pläne gibt."""
    index = active_index(event)
    return plan_label(index) if index is not None else None


def _message(plan: dict, label: str) -> str:
    where = ", ".join(part for part in (plan.get("name"), address_line(plan)) if part)
    text = f"{label} gilt: {where}." if where else f"{label} gilt."
    if plan.get("note"):
        text += f" Hinweis: {plan['note']}"
    return text + " Wenn du nicht mehr kannst, melde dich bitte auf der Event-Seite ab."


async def switch(db, event: dict, key: str, me: dict, *, notify: bool = False, expected: str | None = None) -> dict:
    """Auf den Plan ``key`` umschalten - bedingt, mit Protokoll, auf Wunsch mit Nachricht."""
    from services.event_changes import change_starts_at, inform_registrants

    plans = stored_plans(event)
    if not plans:
        raise PlanError(409, "Dieses Event hat keine Ort-Pläne – erst Plan A und B beim Ort hinterlegen.")
    keys = [plan["key"] for plan in plans]
    if key not in keys:
        raise PlanError(404, "Diesen Ort-Plan gibt es bei diesem Event nicht.")
    current = event.get("active_place_plan") if event.get("active_place_plan") in keys else keys[0]
    if expected and expected != current and current != key:
        raise PlanError(409, f"Inzwischen ist {plan_label(keys.index(current))} aktiv – bitte die Seite neu laden.")
    if key == current:
        return {"changed": False, "place_plan": plan_view(event), "place_plans": plans_view(event), "notice": None}
    index = keys.index(key)
    now = now_utc().isoformat()
    updates = mirror(plans[index], {"active_place_plan": key, "updated_at": now, "place_plan_switched_at": now})
    stored_key = event.get("active_place_plan")
    result = await db.events.update_one(
        {"id": event["id"], "active_place_plan": stored_key, "place_plan_round": event.get("place_plan_round")},
        {"$set": updates, "$inc": {"place_plan_round": 1}},
    )
    after = await db.events.find_one({"id": event["id"]}, {"_id": 0}) or {}
    if result.modified_count != 1:
        # Jemand anderer war schneller: auf denselben Plan ist das kein Fehler, auf einen anderen schon.
        if after.get("active_place_plan") == key:
            return {"changed": False, "place_plan": plan_view(after), "place_plans": plans_view(after), "notice": None}
        winner = after.get("active_place_plan")
        label = plan_label(keys.index(winner)) if winner in keys else "ein anderer Plan"
        raise PlanError(409, f"Inzwischen ist {label} aktiv – bitte die Seite neu laden.")
    round_no = int(after.get("place_plan_round") or 1)
    label = plan_label(index)
    notice = None
    if notify and after.get("status") not in QUIET_STATUSES:
        notice = await inform_registrants(
            db, after, title=f"{label} gilt – neuer Ort", message=_message(plans[index], label),
            dedupe=f"event-place:{event['id']}:{round_no}", starts_at=change_starts_at(after, after, now_utc()),
        )
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "event.place_plan", "actor_id": me["id"], "target_id": event["id"], "created_at": now,
        "data": {"from": current, "to": key, "from_label": plan_label(keys.index(current)), "to_label": label,
                 "round": round_no, "notified": (notice or {}).get("notified", 0)},
    })
    from services.change_events import reset_scope_cache

    reset_scope_cache()
    return {"changed": True, "place_plan": plan_view(after), "place_plans": plans_view(after), "notice": notice}


async def history(db, event_id: str, limit: int = 10) -> list[dict]:
    """Wer wann umgeschaltet hat - für die Verwaltung am Event (aus dem Protokoll)."""
    rows = await db.audit_logs.find({"action": "event.place_plan", "target_id": event_id}, {"_id": 0}) \
        .sort("created_at", -1).to_list(limit)
    ids = sorted({row.get("actor_id") for row in rows if row.get("actor_id")})
    names = {user["id"]: user.get("display_name") or user.get("username") or "" async for user in
             db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1})}
    return [{"at": row.get("created_at"), "from_label": (row.get("data") or {}).get("from_label"),
             "to_label": (row.get("data") or {}).get("to_label"), "notified": (row.get("data") or {}).get("notified", 0),
             "actor_name": names.get(row.get("actor_id")) or "Gelöschter User"} for row in rows]
