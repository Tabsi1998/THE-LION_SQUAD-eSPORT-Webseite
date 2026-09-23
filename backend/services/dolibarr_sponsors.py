"""Sponsoren und Partner aus Dolibarr (#405): eine Quelle für Firma, Stufe und Laufzeit.

In Dolibarr sind Sponsoren und Partner Geschäftspartner in einer Kategorie „Sponsor“ bzw.
„Partner“ (Kategorie-Typ Kunde; die Namen sind einstellbar). Unterkategorien von „Sponsor“ geben die
Stufe (Hauptsponsor, Platin, Gold, Silber, Bronze), Unterkategorien von „Partner“ die Art (Verein,
Messe, Community …). Die Laufzeit steht in den Zusatzfeldern ``sponsor_start`` / ``sponsor_end``
(Datum) am Geschäftspartner, wenn es sie gibt; ohne Zusatzfelder gilt ein Sponsor, solange er in
der Kategorie steht. Die Website liest das stündlich (Job ``dolibarr_public``, wie die Vereinsdaten)
und auf Knopfdruck und schreibt es in ihre eigenen Listen ``sponsors`` und ``partners``: je Firma
ein Eintrag mit ``source: "dolibarr"`` und ``dolibarr_id``. Ein von Hand angelegter Eintrag mit
demselben Namen wird übernommen statt verdoppelt und behält sein Logo.

Was von Dolibarr kommt (und im Admin gesperrt ist, solange der Schalter an ist): Name, Stufe bzw.
Art, Laufzeit, E-Mail und Telefon der Firma. Was auf der Website bleibt: Logo, Link (Dolibarr füllt
ihn nur, wenn er leer ist), Platzierungen, Reihenfolge, Beschreibung, Ansprechpartner, Notizen.

Ein Ausfall ändert nichts: der letzte Stand bleibt, der Fehler steht daneben. Verschwindet eine
Firma aus der Kategorie oder wird sie in Dolibarr geschlossen, endet ihr Sponsoring zum Stichtag
und sie rutscht zu den ehemaligen Unterstützern statt zu verschwinden. Schalter aus: alle Einträge
bleiben stehen und sind wieder von Hand pflegbar.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from models import new_id, now_utc
from services.dolibarr_client import DolibarrClient, DolibarrError

SETTINGS_ID = "sponsor_source"
COLLECTION = "dolibarr_public"
STATE_ID = "sponsors"
DEFAULT_SPONSOR_CATEGORY = "Sponsor"
DEFAULT_PARTNER_CATEGORY = "Partner"
SOURCE = "dolibarr"
# Wie die Unterkategorie heißen darf, damit die Website die Stufe erkennt.
TIER_BY_LABEL = {
    "hauptsponsor": "main", "main": "main", "main sponsor": "main",
    "platin": "platinum", "platinum": "platinum",
    "gold": "gold", "silber": "silver", "silver": "silver", "bronze": "bronze",
}
START_FIELDS = ("options_sponsor_start", "options_sponsoring_start")
END_FIELDS = ("options_sponsor_end", "options_sponsoring_end")
# Diese Felder kommen aus Dolibarr - der Admin kann sie nicht überschreiben, solange der Schalter an ist.
SPONSOR_LOCKED_FIELDS = ("name", "tier", "contract_start", "contract_end", "contact_email", "contact_phone")
PARTNER_LOCKED_FIELDS = ("name", "kind")


def _as_int(value) -> int | None:
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _text(value) -> str:
    return str(value or "").strip()


def _date_text(value) -> str | None:
    """Dolibarr liefert Datums-Zusatzfelder als `YYYY-MM-DD`, `YYYY-MM-DD HH:MM:SS` oder Unix-Sekunden."""
    if value in (None, "", 0, "0"):
        return None
    raw = _text(value)
    if raw.isdigit():
        try:
            return datetime.fromtimestamp(int(raw), tz=timezone.utc).date().isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    head = raw[:10]
    try:
        date.fromisoformat(head)
    except ValueError:
        return None
    return head


def _first(options: dict | None, keys: tuple[str, ...]):
    for key in keys:
        if isinstance(options, dict) and options.get(key) not in (None, ""):
            return options.get(key)
    return None


def normalize_settings(doc: dict | None) -> dict:
    doc = dict(doc or {})
    return {
        "from_dolibarr": bool(doc.get("from_dolibarr")),
        "sponsor_category": _text(doc.get("sponsor_category")) or DEFAULT_SPONSOR_CATEGORY,
        "partner_category": _text(doc.get("partner_category")) or DEFAULT_PARTNER_CATEGORY,
    }


async def load_source_settings(db) -> dict:
    return normalize_settings(await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}))


def find_category(categories: list[dict], label: str) -> dict | None:
    wanted = _text(label).casefold()
    if not wanted:
        return None
    for row in categories:
        if _text(row.get("label")).casefold() == wanted and _as_int(row.get("id")):
            return row
    return None


def children_of(categories: list[dict], parent: dict) -> list[dict]:
    parent_id = _as_int(parent.get("id"))
    return [row for row in categories if _as_int(row.get("fk_parent")) == parent_id and _as_int(row.get("id"))]


def company_from_row(row: dict, *, kind: str, sub_label: str | None) -> dict | None:
    """Ein Geschäftspartner als Sponsor oder Partner; `sub_label` ist die Unterkategorie (Stufe bzw. Art)."""
    dolibarr_id = _as_int(row.get("id"))
    name = _text(row.get("name") or row.get("nom"))
    if not dolibarr_id or not name:
        return None
    options = row.get("array_options") if isinstance(row.get("array_options"), dict) else {}
    company = {
        "dolibarr_id": dolibarr_id, "name": name, "kind": kind,
        "link": _text(row.get("url")) or None,
        "email": _text(row.get("email")) or None,
        "phone": _text(row.get("phone") or row.get("phone_pro")) or None,
        "closed": str(row.get("status") if row.get("status") is not None else "1").strip() == "0",
        "tier": None, "partner_kind": None,
        "contract_start": _date_text(_first(options, START_FIELDS)),
        "contract_end": _date_text(_first(options, END_FIELDS)),
    }
    if kind == "sponsor":
        company["tier"] = TIER_BY_LABEL.get(_text(sub_label).casefold()) if sub_label else None
    elif sub_label:
        company["partner_kind"] = _text(sub_label)
    return company


def plan(categories: list[dict], rows_by_category: dict[int, list[dict]], settings: dict) -> dict:
    """Aus Kategorien und ihren Geschäftspartnern die Liste der Firmen - rein, ohne Datenbank.
    Eine Firma in Ober- und Unterkategorie zählt einmal; die Unterkategorie gewinnt bei Stufe/Art."""
    result = {"sponsors": {}, "partners": {}, "categories": {}}
    for kind, key, bucket in (("sponsor", "sponsor_category", "sponsors"), ("partner", "partner_category", "partners")):
        parent = find_category(categories, settings[key])
        if not parent:
            result["categories"][kind] = {"label": settings[key], "found": False, "sub": []}
            continue
        subs = children_of(categories, parent)
        result["categories"][kind] = {"label": settings[key], "found": True, "sub": [_text(sub.get("label")) for sub in subs]}
        for source in [parent, *subs]:
            sub_label = _text(source.get("label")) if source is not parent else None
            for row in rows_by_category.get(_as_int(source.get("id")) or 0, []):
                company = company_from_row(row, kind=kind, sub_label=sub_label)
                if not company:
                    continue
                existing = result[bucket].get(company["dolibarr_id"])
                if existing:
                    # Ober- und Unterkategorie: Stufe bzw. Art aus der Unterkategorie behalten.
                    if company["tier"] or company["partner_kind"]:
                        existing.update({"tier": company["tier"] or existing["tier"], "partner_kind": company["partner_kind"] or existing["partner_kind"]})
                    continue
                result[bucket][company["dolibarr_id"]] = company
    return result


def _today() -> str:
    return now_utc().date().isoformat()


def _ended_by(company: dict, today: str) -> str | None:
    """Geschlossen in Dolibarr: das Sponsoring endet heute, wenn kein früheres Ende eingetragen ist."""
    end = company.get("contract_end")
    if not company.get("closed"):
        return end
    return end if end and end < today else today


async def _find_existing(collection, company: dict) -> dict | None:
    doc = await collection.find_one({"dolibarr_id": company["dolibarr_id"]}, {"_id": 0})
    if doc:
        return doc
    # Ein von Hand angelegter Eintrag mit demselben Namen wird übernommen - kein Duplikat, Logo bleibt.
    rows = await collection.find({"dolibarr_id": {"$exists": False}}, {"_id": 0}).to_list(1000)
    wanted = company["name"].casefold()
    return next((row for row in rows if _text(row.get("name")).casefold() == wanted), None)


async def apply_sponsors(db, companies: dict[int, dict], *, today: str | None = None) -> dict:
    today = today or _today()
    stamp = now_utc().isoformat()
    seen: set[int] = set()
    created = updated = 0
    for company in companies.values():
        seen.add(company["dolibarr_id"])
        existing = await _find_existing(db.sponsors, company)
        values = {
            "name": company["name"], "source": SOURCE, "dolibarr_id": company["dolibarr_id"], "dolibarr_seen_at": stamp,
            "contract_start": company.get("contract_start"), "contract_end": _ended_by(company, today),
            "contact_email": company.get("email"), "contact_phone": company.get("phone"),
        }
        if company.get("tier"):
            values["tier"] = company["tier"]
        if company.get("link") and not (existing or {}).get("link"):
            values["link"] = company["link"]
        if existing:
            values["updated_at"] = stamp
            unset = {"dolibarr_gone_at": ""} if existing.get("dolibarr_gone_at") else {}
            await db.sponsors.update_one({"id": existing["id"]}, {"$set": values, **({"$unset": unset} if unset else {})})
            updated += 1
        else:
            doc = {"id": new_id(), "created_at": stamp, "updated_at": stamp, "tier": company.get("tier") or "bronze", "is_active": True,
                   "contract_status": "active", "order_index": 0, "event_ids": [], "logo_url": None, "description": None, **values}
            await db.sponsors.insert_one(doc)
            created += 1
    # Nicht mehr in der Kategorie: Sponsoring endet heute - der Eintrag bleibt (ehemalige Unterstützer).
    gone = 0
    async for doc in db.sponsors.find({"source": SOURCE, "dolibarr_id": {"$nin": list(seen)}, "dolibarr_gone_at": {"$exists": False}}, {"_id": 0, "id": 1, "contract_end": 1}):
        end = doc.get("contract_end")
        await db.sponsors.update_one({"id": doc["id"]}, {"$set": {"dolibarr_gone_at": stamp, "contract_end": end if end and end < today else today, "updated_at": stamp}})
        gone += 1
    return {"created": created, "updated": updated, "gone": gone, "total": len(seen)}


async def apply_partners(db, companies: dict[int, dict]) -> dict:
    stamp = now_utc().isoformat()
    seen: set[int] = set()
    created = updated = 0
    for company in companies.values():
        seen.add(company["dolibarr_id"])
        existing = await _find_existing(db.partners, company)
        values = {"name": company["name"], "source": SOURCE, "dolibarr_id": company["dolibarr_id"], "dolibarr_seen_at": stamp, "is_active": not company.get("closed")}
        if company.get("partner_kind"):
            values["kind"] = company["partner_kind"]
        if company.get("link") and not (existing or {}).get("link"):
            values["link"] = company["link"]
        if existing:
            values["updated_at"] = stamp
            unset = {"dolibarr_gone_at": ""} if existing.get("dolibarr_gone_at") else {}
            await db.partners.update_one({"id": existing["id"]}, {"$set": values, **({"$unset": unset} if unset else {})})
            updated += 1
        else:
            doc = {"id": new_id(), "created_at": stamp, "updated_at": stamp, "kind": company.get("partner_kind") or "verein", "order_index": 0,
                   "logo_url": None, "description": None, "link": company.get("link"), **values}
            await db.partners.insert_one(doc)
            created += 1
    gone = 0
    async for doc in db.partners.find({"source": SOURCE, "dolibarr_id": {"$nin": list(seen)}, "dolibarr_gone_at": {"$exists": False}}, {"_id": 0, "id": 1}):
        await db.partners.update_one({"id": doc["id"]}, {"$set": {"dolibarr_gone_at": stamp, "is_active": False, "updated_at": stamp}})
        gone += 1
    return {"created": created, "updated": updated, "gone": gone, "total": len(seen)}


async def refresh(db, client: DolibarrClient, *, source: dict | None = None) -> dict:
    """Kategorien und Geschäftspartner lesen und in die Listen schreiben. Ein Fehler lässt alles
    stehen und wird im Stand vermerkt."""
    source = normalize_settings(source if source is not None else await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}))
    now = now_utc().isoformat()
    try:
        categories = await client.categories("customer")
        wanted: list[dict] = []
        for key in ("sponsor_category", "partner_category"):
            parent = find_category(categories, source[key])
            if parent:
                wanted.extend([parent, *children_of(categories, parent)])
        rows_by_category: dict[int, list[dict]] = {}
        for category in wanted:
            category_id = _as_int(category.get("id"))
            if category_id and category_id not in rows_by_category:
                rows_by_category[category_id] = await client.thirdparties_in_category(category_id)
    except DolibarrError as exc:
        await db[COLLECTION].update_one({"id": STATE_ID}, {"$set": {"error": exc.kind, "error_text": exc.text, "error_at": now}, "$setOnInsert": {"id": STATE_ID}}, upsert=True)
        return {"ok": False, "kind": exc.kind, "text": exc.text}
    planned = plan(categories, rows_by_category, source)
    sponsors = await apply_sponsors(db, planned["sponsors"])
    partners = await apply_partners(db, planned["partners"])
    await db[COLLECTION].update_one({"id": STATE_ID}, {
        "$set": {"fetched_at": now, "categories": planned["categories"], "sponsors": sponsors, "partners": partners},
        "$unset": {"error": "", "error_text": "", "error_at": ""},
        "$setOnInsert": {"id": STATE_ID},
    }, upsert=True)
    return {"ok": True, "fetched_at": now, "sponsors": sponsors, "partners": partners, "categories": planned["categories"]}


async def refresh_due() -> dict:
    """Der stündliche Job: nur mit Anbindung und gesetztem Schalter."""
    from database import get_db
    from services.dolibarr_client import load_settings

    db = get_db()
    source = await load_source_settings(db)
    if not source["from_dolibarr"]:
        return {"ok": False, "kind": "switched_off"}
    settings = await load_settings(db)
    if settings.get("mode") == "off":
        return {"ok": False, "kind": "not_configured"}
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        return {"ok": False, "kind": exc.kind}
    return await refresh(db, client, source=source)


async def snapshot(db) -> dict:
    return await db[COLLECTION].find_one({"id": STATE_ID}, {"_id": 0}) or {}


async def locked_fields(db, doc: dict | None, fields: tuple[str, ...]) -> tuple[str, ...]:
    """Welche Felder eines Eintrags Dolibarr führt - leer, wenn der Eintrag von Hand ist oder der Schalter aus."""
    if not doc or doc.get("source") != SOURCE:
        return ()
    source = await load_source_settings(db)
    return fields if source["from_dolibarr"] else ()


async def admin_view(db) -> dict:
    from services.dolibarr_client import load_settings

    source = await load_source_settings(db)
    settings = await load_settings(db)
    state = await snapshot(db)
    return {
        **source,
        "connected": settings.get("mode") != "off",
        "fetched_at": state.get("fetched_at"),
        "error": state.get("error"), "error_text": state.get("error_text"), "error_at": state.get("error_at"),
        "categories": state.get("categories") or {},
        "counts": {
            "sponsors": await db.sponsors.count_documents({"source": SOURCE}),
            "partners": await db.partners.count_documents({"source": SOURCE}),
        },
        "last_run": {"sponsors": state.get("sponsors"), "partners": state.get("partners")},
        "locked": {"sponsors": list(SPONSOR_LOCKED_FIELDS), "partners": list(PARTNER_LOCKED_FIELDS)},
    }
