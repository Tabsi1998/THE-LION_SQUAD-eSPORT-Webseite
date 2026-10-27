"""Shop-Einstellungen (#1706): Sichtbarkeitsstufe, Freigabe „Steuer geklärt“, Notschalter für Printful, Preise und der
Printful-Zugang. Ein Dokument ``settings`` mit ``id = "shop"``; geschrieben wird nur hier.

Stufen statt „Aus/Vorschau/Live“ (Entscheidung des Obmanns vom 27.10.2026, Kommentar in #1706):

- ``off`` Aus - niemand sieht den Shop (Vorgabe).
- ``admins`` Nur Admins (Test) - Finanzen und Superadmin, zum Testen.
- ``members`` Vereinsmitglieder - aktive Mitgliedschaft.
- ``public`` Öffentlich - alle. Einschalten nur Superadmin und nur mit der Freigabe „Steuer geklärt“ (#1701).

Wer den Shop sehen darf, entscheidet ``services/shop_access.py``. Der Notschalter „Bestellungen an Printful senden“
(Vorgabe aus) hängt nicht an der Stufe: jeder Aufruf bei Printful, der Geld kostet (Bestätigen), fragt vorher
``require_printful_writes``. Entwürfe kosten nichts und fragen ``require_printful_drafts`` (Stufe ab „Nur Admins“ und
Schlüssel) - so der Adapter aus #1705 (``services/printful_client.py``).

Sicher bei Unsinn in der Datenbank: eine unbekannte Stufe gilt als „Aus“, „Öffentlich“ ohne Freigabe ebenso, der
Notschalter ist nur bei genau ``True`` an, ungültige Beträge fallen auf die Vorgabe. Der Printful-Schlüssel liegt mit
``SETTINGS_ENCRYPTION_KEY`` verschlüsselt (``secret_store``) und verlässt dieses Modul nur über ``printful_api_key``.
"""
from __future__ import annotations

from typing import Any

from models import now_utc
from services import shop_common
from services.secret_store import decrypt_secret, encrypt_secret, secret_is_configured
from services.shop_common import ShopConflict, ShopError

SETTINGS_ID = "shop"
STAGES = ("off", "admins", "members", "public")
STAGE_LABELS = {"off": "Aus", "admins": "Nur Admins (Test)", "members": "Vereinsmitglieder", "public": "Öffentlich"}
STAGE_HINTS = {
    "off": "Niemand sieht den Shop.",
    "admins": "Nur Finanzen und Superadmin – zum Testen und für Entwürfe.",
    "members": "Angemeldete Mitglieder mit aktiver Mitgliedschaft.",
    "public": "Alle Besucherinnen und Besucher.",
}
# Zum Start nur Österreich; die EU-Öffnung folgt erst nach der steuerlichen Klärung (#1699, #1701).
SHIPPING_COUNTRIES = ("AT",)
# Mitglieder zahlen den Selbstkostenpreis (Einkauf plus Versand) - der Verein macht kein Geschäft.
MEMBER_MARKUP_CENTS = 0
MAX_PUBLIC_MARKUP_CENTS = 10_000
MAX_FALLBACK_SHIPPING_CENTS = 10_000
MIN_KEY_LENGTH = 20
MAX_KEY_LENGTH = 300
UNREADABLE_KEY = "gespeichert, aber nicht lesbar – SETTINGS_ENCRYPTION_KEY in der .env prüfen"
NO_TAX_CLEARANCE = "Erst wenn die Steuer geklärt ist (#1701) – die Freigabe setzt der Superadmin."
ONLY_SUPERADMIN = "„Öffentlich“ schaltet nur der Superadmin ein."
UPDATE_FIELDS = ("stage", "orders_to_printful", "public_markup_cents", "fallback_shipping_cents")


class ShopForbidden(ShopError):
    """Die Person darf diese Einstellung nicht ändern (Antwort 403)."""


class PrintfulWritesBlocked(ShopError):
    """Der Notschalter „Bestellungen an Printful senden“ ist aus - nichts, was Geld kostet, geht zu Printful."""


class PrintfulDraftsBlocked(ShopError):
    """Entwürfe an Printful sind gesperrt: Shop steht auf „Aus“ oder kein lesbarer Schlüssel."""


def _cents(value: Any, *, maximum: int, minimum: int = 0) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        return None
    return value


def _tax_cleared(value: Any) -> dict | None:
    if not isinstance(value, dict) or not value.get("at"):
        return None
    return {"at": str(value["at"]), "by": value.get("by"), "reason": value.get("reason")}


def normalized(raw: dict | None) -> dict:
    """Die gespeicherten Einstellungen mit sicheren Vorgaben - Unsinn wird zu „aus“, nie zu „an“."""
    raw = raw or {}
    stage = raw.get("stage") if raw.get("stage") in STAGES else "off"
    return {
        "stage": stage,
        "orders_to_printful": raw.get("orders_to_printful") is True,
        "public_markup_cents": _cents(raw.get("public_markup_cents"), maximum=MAX_PUBLIC_MARKUP_CENTS) or 0,
        "fallback_shipping_cents": _cents(raw.get("fallback_shipping_cents"), minimum=1,
                                          maximum=MAX_FALLBACK_SHIPPING_CENTS),
        "tax_cleared": _tax_cleared(raw.get("tax_cleared")),
        "printful_api_key": raw.get("printful_api_key") or "",
        "printful_key_saved_at": raw.get("printful_key_saved_at"),
        "printful_key_saved_by": raw.get("printful_key_saved_by"),
        "printful_last_test": raw.get("printful_last_test") if isinstance(raw.get("printful_last_test"), dict) else None,
        "updated_at": raw.get("updated_at"),
        "updated_by": raw.get("updated_by"),
    }


async def load(db) -> dict:
    return normalized(await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}))


def effective_stage(config: dict) -> str:
    """Die Stufe, die wirklich gilt: „Öffentlich“ ohne Freigabe „Steuer geklärt“ (etwa von Hand in der Datenbank) gilt
    als „Aus“ - nie als offener Shop."""
    stage = config.get("stage") if config.get("stage") in STAGES else "off"
    if stage == "public" and not config.get("tax_cleared"):
        return "off"
    return stage


def key_state(config: dict) -> str:
    """„missing“, „ok“ oder „unreadable“ - ohne den Schlüssel herauszugeben."""
    stored = config.get("printful_api_key")
    if not secret_is_configured(stored):
        return "missing"
    try:
        decrypt_secret(stored)
    except RuntimeError:
        return "unreadable"
    return "ok"


async def printful_api_key(db) -> str | None:
    """Der entschlüsselte Schlüssel - nur für den Aufruf bei Printful, nie für eine Antwort oder ein Log."""
    config = await load(db)
    if key_state(config) != "ok":
        return None
    return decrypt_secret(config["printful_api_key"])


# ---------------------------------------------------------------- Preise und Versand

def markup_cents(config: dict, buyer_kind: str, product: dict) -> int:
    """Aufschlag je Artikel: Mitglieder zahlen den Selbstkostenpreis (0). Öffentlich der Aufschlag des Shops plus ein
    eigener Aufschlag des Produkts, falls die Finanzen einem Produkt einen geben."""
    if buyer_kind != "public":
        return MEMBER_MARKUP_CENTS
    return int(config.get("public_markup_cents") or 0) + int(product.get("markup_cents") or 0)


def check_shipping_country(country: str) -> None:
    if country not in SHIPPING_COUNTRIES:
        raise ShopError("Lieferung derzeit nur nach Österreich (AT).")


def shipping_cents(config: dict, estimate: Any) -> int:
    """Versand: die Schätzung von Printful, sonst die Ersatzpauschale. Fehlt beides, wird nicht bestellt - lieber eine
    klare Absage als ein Versand zum Nulltarif."""
    usable = _cents(estimate, maximum=MAX_FALLBACK_SHIPPING_CENTS)
    if usable is not None:
        return usable
    if config.get("fallback_shipping_cents"):
        return int(config["fallback_shipping_cents"])
    raise ShopError("Versand lässt sich gerade nicht berechnen. Bitte später noch einmal versuchen.")


# ---------------------------------------------------------------- Notschalter

async def printful_writes_allowed(db) -> bool:
    """Nur mit Schalter an **und** lesbarem Schlüssel - steht der Schalter (etwa nach einem Rennen mit „Schlüssel
    entfernen“) ohne Schlüssel an, bleibt alles zu."""
    config = await load(db)
    return config["orders_to_printful"] and key_state(config) == "ok"


async def require_printful_writes(db) -> None:
    """Pflicht vor jedem Aufruf bei Printful, der Geld kostet (Bestätigung, Storno einer bestätigten Bestellung): ist
    der Notschalter aus oder fehlt ein lesbarer Schlüssel, geht nichts hinaus - unabhängig von der Stufe."""
    if not await printful_writes_allowed(db):
        raise PrintfulWritesBlocked("Bestellungen an Printful senden ist ausgeschaltet.")


# Entwürfe (#1705, #2062): ein Entwurf bei Printful wird nie produziert und nie bezahlt. Darum gehen Entwurf anlegen,
# Entwurf löschen und Druckdateien hinterlegen auch bei ausgeschaltetem Notschalter - aber nur, wenn der Shop
# mindestens in der Stufe „Nur Admins (Test)“ steht und ein lesbarer Schlüssel da ist.
DRAFT_STAGES = ("admins", "members", "public")


async def printful_drafts_allowed(db) -> bool:
    config = await load(db)
    return effective_stage(config) in DRAFT_STAGES and key_state(config) == "ok"


async def require_printful_drafts(db) -> None:
    """Pflicht vor jedem Entwurfs-Aufruf bei Printful. Der Notschalter spielt hier keine Rolle (siehe oben)."""
    if not await printful_drafts_allowed(db):
        raise PrintfulDraftsBlocked("Entwürfe an Printful erst ab der Stufe „Nur Admins (Test)“ und mit "
                                    "hinterlegtem Schlüssel.")


# ---------------------------------------------------------------- Schreiben (immer mit Grund und Protokoll)

KEY_PRESENT = {"printful_api_key": {"$exists": True, "$nin": ["", None]}}
NO_KEY = "Erst den Printful-Schlüssel hinterlegen – ohne Schlüssel kann nichts gesendet werden."


async def _save(db, fields: dict, *, actor_id: str, only_if: dict | None = None) -> bool:
    """Ein einziges Update. Mit ``only_if`` bedingt und ohne Anlegen: ``False``, wenn die Bedingung nicht mehr gilt."""
    now = now_utc().isoformat()
    result = await db.settings.update_one({"id": SETTINGS_ID, **(only_if or {})},
                                          {"$set": {"id": SETTINGS_ID, **fields, "updated_at": now,
                                                    "updated_by": actor_id}},
                                          upsert=only_if is None)
    return only_if is None or result.matched_count == 1


async def update(db, changes: dict, *, actor: dict, is_superadmin: bool, reason: Any) -> tuple[dict, list[str]]:
    """Stufe, Notschalter, Aufschlag und Ersatzpauschale ändern. Liefert (Einstellungen, geänderte Felder)."""
    unknown = sorted(set(changes) - set(UPDATE_FIELDS))
    if unknown:
        raise ShopError(f"Unbekannte Einstellungen ({', '.join(unknown)}).")
    current = await load(db)
    after: dict = {}
    for field, value in changes.items():
        if field == "stage" and value not in STAGES:
            raise ShopError("Unbekannte Stufe.")
        if field == "orders_to_printful" and not isinstance(value, bool):
            raise ShopError("Der Notschalter ist an oder aus.")
        if field == "public_markup_cents" and _cents(value, maximum=MAX_PUBLIC_MARKUP_CENTS) is None:
            raise ShopError("Aufschlag: ganze Cent, 0 bis 100 €.")
        if field == "fallback_shipping_cents" and value is not None and _cents(
                value, minimum=1, maximum=MAX_FALLBACK_SHIPPING_CENTS) is None:
            raise ShopError("Ersatzpauschale: ganze Cent, 0,01 bis 100 € - oder leer für keine.")
        if current[field] != value:
            after[field] = value
    if not after:
        return current, []
    if after.get("stage") == "public":
        if not is_superadmin:
            raise ShopForbidden(ONLY_SUPERADMIN)
        if not current["tax_cleared"]:
            raise ShopConflict("„Öffentlich“ ist gesperrt, bis die Steuer geklärt ist (#1701).")
    switching_on = after.get("orders_to_printful") is True
    # Kritisch und deshalb mit Pflicht-Grund: „Öffentlich“ und Notschalter einschalten.
    shop_common.clean_reason(reason, required=after.get("stage") == "public" or switching_on)
    if switching_on and key_state(current) != "ok":
        raise ShopConflict(NO_KEY)
    # Einschalten nur, solange der Schlüssel noch da ist - als ein bedingtes Update, damit ein gleichzeitiges
    # „Schlüssel entfernen“ nie mit Schalter an ohne Schlüssel endet. Erst schreiben, dann protokollieren.
    if not await _save(db, after, actor_id=actor["id"], only_if=KEY_PRESENT if switching_on else None):
        raise ShopConflict(NO_KEY)
    await shop_common.record_admin_action(
        db, "shop.config", actor_id=actor["id"], target_id=SETTINGS_ID, reason=reason,
        data={"before": {field: current[field] for field in after}, "after": after})
    return await load(db), sorted(after)


async def set_tax_clearance(db, cleared: bool, *, actor: dict, reason: Any) -> dict:
    """Freigabe „Steuer geklärt“ (#1701) - nur Superadmin (prüft die Route), Pflicht-Grund. Zurücknehmen geht nur, wenn
    der Shop nicht öffentlich ist."""
    text = shop_common.clean_reason(reason, required=True)
    current = await load(db)
    if bool(current["tax_cleared"]) == cleared:
        return current
    if not cleared and current["stage"] == "public":
        raise ShopConflict("Erst die Stufe unter „Öffentlich“ setzen, dann die Freigabe zurücknehmen.")
    value = {"at": now_utc().isoformat(), "by": actor["id"], "reason": text} if cleared else None
    await shop_common.record_admin_action(db, "shop.config", actor_id=actor["id"], target_id=SETTINGS_ID,
                                          reason=reason, data={"before": {"tax_cleared": not cleared},
                                                               "after": {"tax_cleared": cleared}})
    await _save(db, {"tax_cleared": value}, actor_id=actor["id"])
    return await load(db)


def clean_key(raw: Any) -> str:
    key = str(raw or "").strip()
    if not MIN_KEY_LENGTH <= len(key) <= MAX_KEY_LENGTH or any(char.isspace() for char in key):
        raise ShopError(f"Der Schlüssel hat {MIN_KEY_LENGTH} bis {MAX_KEY_LENGTH} Zeichen ohne Leerzeichen.")
    return key


async def set_printful_key(db, raw_key: Any, *, actor: dict, reason: Any) -> dict:
    """Schlüssel verschlüsselt speichern. Ins Protokoll kommt nur „hinterlegt“, nie der Wert."""
    key = clean_key(raw_key)
    current = await load(db)
    before = "hinterlegt" if key_state(current) != "missing" else "fehlt"
    await shop_common.record_admin_action(db, "shop.config", actor_id=actor["id"], target_id=SETTINGS_ID,
                                          reason=reason, data={"before": {"printful_key": before},
                                                               "after": {"printful_key": "hinterlegt"}})
    await _save(db, {"printful_api_key": encrypt_secret(key), "printful_key_saved_at": now_utc().isoformat(),
                     "printful_key_saved_by": actor["id"], "printful_last_test": None}, actor_id=actor["id"])
    return await load(db)


async def remove_printful_key(db, *, actor: dict, reason: Any) -> dict:
    """Schlüssel entfernen - der Notschalter geht dabei mit aus: ohne Schlüssel kann nichts gesendet werden."""
    shop_common.clean_reason(reason, required=True)
    current = await load(db)
    if key_state(current) == "missing":
        return current
    before, after = {"printful_key": "hinterlegt"}, {"printful_key": "entfernt"}
    if current["orders_to_printful"]:
        before["orders_to_printful"], after["orders_to_printful"] = True, False
    # Schlüssel leer und Schalter aus in einem Update - nie ein Zwischenstand mit Schalter an ohne Schlüssel.
    await _save(db, {"printful_api_key": "", "printful_key_saved_at": None, "printful_key_saved_by": None,
                     "printful_last_test": None, "orders_to_printful": False}, actor_id=actor["id"])
    await shop_common.record_admin_action(db, "shop.config", actor_id=actor["id"], target_id=SETTINGS_ID,
                                          reason=reason, data={"before": before, "after": after})
    return await load(db)


async def record_test(db, result: dict) -> None:
    """Ergebnis des Verbindungstests merken (Status und Betrieb → Checks) - nur Zeitpunkt, ja/nein und Ursache."""
    await db.settings.update_one(
        {"id": SETTINGS_ID},
        {"$set": {"id": SETTINGS_ID, "printful_last_test": {"at": now_utc().isoformat(), "ok": bool(result.get("ok")),
                                                             "detail": str(result.get("detail") or "")[:200]}}},
        upsert=True)


# ---------------------------------------------------------------- Ansicht für den Admin

async def _names(db, ids: set) -> dict:
    wanted = sorted(user_id for user_id in ids if user_id)
    if not wanted:
        return {}
    rows = await db.users.find({"id": {"$in": wanted}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(10)
    return {row["id"]: row.get("display_name") or row.get("username") or "unbekannt" for row in rows}


async def admin_view(db, config: dict, *, is_superadmin: bool, can_edit_access: bool) -> dict:
    """Was die Admin-Seite zeigt - ohne Schlüssel, ohne verschlüsselten Wert."""
    tax = config["tax_cleared"]
    names = await _names(db, {(tax or {}).get("by"), config.get("printful_key_saved_by")})
    state = key_state(config)
    public_lock = None
    if not tax:
        public_lock = NO_TAX_CLEARANCE
    elif not is_superadmin:
        public_lock = ONLY_SUPERADMIN
    stages = [{"key": key, "label": STAGE_LABELS[key], "hint": STAGE_HINTS[key],
               "locked": key == "public" and public_lock is not None,
               "lock_reason": public_lock if key == "public" else None} for key in STAGES]
    return {
        "config": {
            "stage": config["stage"], "stage_label": STAGE_LABELS[config["stage"]],
            "effective_stage": effective_stage(config),
            "orders_to_printful": config["orders_to_printful"],
            "public_markup_cents": config["public_markup_cents"], "member_markup_cents": MEMBER_MARKUP_CENTS,
            "fallback_shipping_cents": config["fallback_shipping_cents"],
            "shipping_countries": list(SHIPPING_COUNTRIES),
            "tax_cleared": ({"at": tax["at"], "by": names.get(tax.get("by"), "unbekannt"), "reason": tax.get("reason")}
                            if tax else None),
            "printful_key": {"state": state, "saved_at": config["printful_key_saved_at"] if state != "missing" else None,
                             "saved_by": (names.get(config["printful_key_saved_by"], "unbekannt")
                                          if state != "missing" and config["printful_key_saved_by"] else None),
                             "detail": UNREADABLE_KEY if state == "unreadable" else None},
            "printful_last_test": config["printful_last_test"],
            "updated_at": config["updated_at"],
        },
        "stages": stages,
        "rights": {"can_set_public": bool(is_superadmin and tax), "can_set_tax": is_superadmin,
                   "can_edit_access": can_edit_access},
        "limits": {"public_markup_cents": MAX_PUBLIC_MARKUP_CENTS, "fallback_shipping_cents": MAX_FALLBACK_SHIPPING_CENTS},
    }
