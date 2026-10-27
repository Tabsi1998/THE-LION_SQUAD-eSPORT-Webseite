"""Wunschnummer je Mitglied (#2034): einmal selbst wählen, danach nur über den Vorstand.

Entscheidungen des Obmanns (26.10.2026): Bereich 0 bis 99 (einstellbar, dazu reservierte Nummern), alle Mitglieder
dürfen wählen, die Nummer ist **nicht öffentlich** (nur das Mitglied, der Vorstand und später der Trikotdruck mit
Einwilligung). Bei Austritt, Kontolöschung und Wechsel wird die alte Nummer **sofort** frei, ohne Sperrfrist.

Wie es läuft:

- Die Website führt einen eigenen Spiegel (``jersey_numbers``, eine Zeile je Konto). ``number_key`` steht nur, solange
  die Nummer vergeben ist; der eindeutige Index darauf (``database.ensure_jersey_number_indexes``) ist die Sperre gegen
  gleichzeitige Wahl derselben Nummer, der auf ``user_id`` die gegen den Doppelklick.
- Dolibarr hält die Nummer als ergänzendes Attribut beim Mitglied (Feldname per Einstellung, Vorgabe ``trikotnummer``).
  Dolibarr erzwingt dort keine Eindeutigkeit - vor dem Festlegen prüft die Website deshalb gegen alle aktiven Mitglieder
  in Dolibarr **und** gegen den eigenen Spiegel.
- Geht das Schreiben nach Dolibarr nicht (nicht angebunden, keine Zuordnung, Schreiben aus, Feld fehlt, nicht
  erreichbar), bleibt die Nummer im Spiegel gesichert, der Zustand steht mit klarem Satz dabei, und der Abgleich
  (``sync_pending``, alle zehn Minuten) trägt nach. Nichts geht still verloren.
- Nach dem Festlegen ist die Nummer gesperrt wie die Vereinsdaten: das Mitglied stellt einen Änderungsantrag
  (``jersey_number_requests``, Zustände wie bei den eigenen Daten: beim Vorstand, übernommen, abgelehnt), der Vorstand
  gibt frei, vergibt selbst oder fordert eine Neuwahl an (das Mitglied darf dann wieder einmal wählen).
- Jede Änderung steht im Verlauf der Zeile (``log``). Die Nummer selbst kommt nie ins Server-Protokoll und nie ins
  Adminprotokoll - dort steht nur, dass etwas geschah.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import timedelta

from models import new_id, now_utc
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from services import dolibarr_client as erp
from services.dolibarr_links import on_link_change, verified_link
from services.log_safe import log_safe

logger = logging.getLogger("tls.jersey_numbers")

SETTINGS_ID = "jersey_numbers"
DEFAULTS = {"min": 0, "max": 99, "reserved": [], "dolibarr_field": "trikotnummer"}
HIGHEST = 9999
FIELD_PATTERN = r"[a-z][a-z0-9_]{0,63}"
# Wer wählen darf: alle Mitglieder - auch ruhende. Austritt (ehemalig) gibt die Nummer frei.
ELIGIBLE_STATUSES = ("active", "honorary", "inactive")
RELEASE_STATUSES = ("former", "none")
OPEN = "received"
DECIDING = "deciding"  # kurz, während der Vorstand entscheidet
DECIDING_STALE_MINUTES = (
    5  # länger „in Entscheidung“ heißt: abgebrochen, der Antrag ist wieder offen
)
REQUEST_LABELS = {
    "received": "beim Vorstand",
    "deciding": "beim Vorstand",
    "applied": "übernommen",
    "reopened": "Neuwahl freigegeben",
    "rejected": "abgelehnt",
}
DECISIONS = {"approve": "applied", "reopen": "reopened", "reject": "rejected"}
SCAN_SECONDS = 60.0
FAILED_SCAN_SECONDS = 15.0
MAX_SCAN_PAGES = 50
GRID_MAX = 200  # bis zu so vielen Nummern zeigt die Seite das Raster der freien
LOG_KEEP = 60
REASON_MIN, REASON_MAX = 3, 500
# Ausgetreten (0) und ausgeschlossen (-2) in Dolibarr: deren Nummer zählt nicht mehr.
GONE_STATUTS = ("0", "-2")

TAKEN_TEXT = "Diese Nummer hat schon jemand."
LOCKED_TEXT = (
    "Deine Nummer steht fest. Ändern geht nur über einen Antrag an den Vorstand."
)
RACE_TEXT = "Diese Nummer hat sich gerade jemand anderes gesichert – such dir bitte eine andere aus."

# Was der Abgleich mit Dolibarr sagt - einmal aus Sicht des Mitglieds, einmal für den Vorstand.
SYNC_TEXTS = {
    "off": (
        "Die Mitgliederverwaltung ist nicht angebunden – deine Nummer gilt auf der Website.",
        "Dolibarr ist nicht angebunden – die Nummer steht nur auf der Website.",
    ),
    "ok": ("Steht auch in der Mitgliederverwaltung.", "Steht in Dolibarr."),
    "pending": (
        "Wird gerade in die Mitgliederverwaltung übertragen.",
        "Wird nach Dolibarr übertragen.",
    ),
    "no_member": (
        "Dein Konto ist noch keinem Mitglied in der Mitgliederverwaltung zugeordnet. Deine Nummer ist hier gesichert "
        "und wird nachgetragen, sobald die Zuordnung steht.",
        "Konto ist keinem Dolibarr-Mitglied zugeordnet – die Nummer wird nachgetragen, sobald die Zuordnung steht.",
    ),
    "read_only": (
        "Deine Nummer ist hier gesichert; in die Mitgliederverwaltung trägt sie der Abgleich nach.",
        "Die Website darf nicht nach Dolibarr schreiben (Dolibarr → Verbindung: Schreiben erlauben). Die Nummer ist "
        "hier gesichert und wird nachgetragen.",
    ),
    "field_missing": (
        "Deine Nummer ist hier gesichert; in die Mitgliederverwaltung trägt sie der Abgleich nach.",
        "In Dolibarr fehlt beim Mitglied das ergänzende Attribut „{field}“. Die Nummer ist hier gesichert und wird "
        "nachgetragen, sobald es angelegt ist.",
    ),
    "failed": (
        "Die Mitgliederverwaltung war gerade nicht erreichbar. Deine Nummer ist hier gesichert und wird nachgetragen.",
        "Dolibarr war nicht erreichbar ({error}). Die Nummer ist hier gesichert und wird nachgetragen.",
    ),
    "conflict": (
        "Der Vorstand klärt gerade noch etwas zu deiner Nummer – sie bleibt dir.",
        "In Dolibarr steht diese Nummer schon bei einem anderen aktiven Mitglied – bitte dort oder hier klären.",
    ),
}

# Schreiben bzw. Nachlesen beim Mitglied verweigert: ein Recht im Mitgliedermodul fehlt - nicht im Modul Vereine.
MEMBERS_FORBIDDEN = "members_forbidden"
MEMBERS_FORBIDDEN_TEXTS = (
    "Deine Nummer ist hier gesichert; in die Mitgliederverwaltung trägt sie der Abgleich nach.",
    "Dem API-Benutzer fehlt in Dolibarr das Recht „Mitglieder erstellen/bearbeiten“ (Modul Mitglieder, 403). Die "
    "Nummer ist hier gesichert und wird nachgetragen.",
)

_scan_cache: dict[tuple, tuple[float, dict]] = {}


class JerseyError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def reset_cache() -> None:
    _scan_cache.clear()


# ---------------------------------------------------------------- Einstellungen


async def load_settings(db) -> dict:
    doc = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}
    out = {key: doc.get(key, value) for key, value in DEFAULTS.items()}
    out["reserved"] = sorted(
        {
            int(n)
            for n in out.get("reserved") or []
            if isinstance(n, int) and not isinstance(n, bool)
        }
    )
    return out


def _int_in(value, label: str) -> int:
    if isinstance(value, bool):
        raise JerseyError(400, f"{label}: bitte eine ganze Zahl.")
    if isinstance(value, int):
        number = value
    elif re.fullmatch(r"\s*\d{1,4}\s*", str(value or "")):
        number = int(str(value).strip())
    else:
        raise JerseyError(400, f"{label}: bitte eine ganze Zahl von 0 bis {HIGHEST}.")
    if not 0 <= number <= HIGHEST:
        raise JerseyError(400, f"{label}: bitte eine ganze Zahl von 0 bis {HIGHEST}.")
    return number


def clean_settings(body: dict, current: dict) -> dict:
    """Bereich, reservierte Nummern und Feldname in Dolibarr - geprüft, nie still abgeschnitten."""
    out = dict(current)
    if "min" in body:
        out["min"] = _int_in(body["min"], "Kleinste Nummer")
    if "max" in body:
        out["max"] = _int_in(body["max"], "Größte Nummer")
    if out["min"] > out["max"]:
        raise JerseyError(400, "Die kleinste Nummer muss unter der größten liegen.")
    if "reserved" in body:
        raw = body["reserved"]
        items = raw if isinstance(raw, list) else re.split(r"[\s,;]+", str(raw or ""))
        out["reserved"] = sorted(
            {
                _int_in(item, "Reservierte Nummer")
                for item in items
                if str(item).strip() != ""
            }
        )
    if "dolibarr_field" in body:
        field = (
            str(body["dolibarr_field"] or "").strip().lower().removeprefix("options_")
        )
        if not re.fullmatch(FIELD_PATTERN, field):
            raise JerseyError(
                400,
                "Feldname in Dolibarr: nur Kleinbuchstaben, Ziffern und _, "
                "am Anfang ein Buchstabe (z. B. trikotnummer).",
            )
        out["dolibarr_field"] = field
    return out


async def save_settings(db, body: dict, actor_id: str) -> dict:
    clean = clean_settings(body or {}, await load_settings(db))
    await db.settings.update_one(
        {"id": SETTINGS_ID},
        {
            "$set": {
                "id": SETTINGS_ID,
                **clean,
                "updated_at": now_utc().isoformat(),
                "updated_by": actor_id,
            }
        },
        upsert=True,
    )
    reset_cache()
    await _audit(db, actor_id, "jersey_number.settings", "")
    return clean


def parse_number(raw) -> int:
    if isinstance(raw, bool):
        raise JerseyError(400, "Bitte eine ganze Zahl eingeben.")
    if isinstance(raw, int):
        return raw
    text = str(raw if raw is not None else "").strip()
    if not re.fullmatch(r"\d{1,4}", text):
        raise JerseyError(400, "Bitte eine ganze Zahl eingeben.")
    return int(text)


def _rule_text(settings: dict, number: int) -> str | None:
    if not settings["min"] <= number <= settings["max"]:
        return f"Nur Nummern von {settings['min']} bis {settings['max']}."
    if number in settings["reserved"]:
        return "Diese Nummer hält der Verein frei."
    return None


def _as_number(value) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    text = str(value).strip()
    if re.fullmatch(r"-?\d+(\.0+)?", text):
        return int(float(text))
    return None


# ---------------------------------------------------------------- Dolibarr


async def _connection(db):
    settings = await erp.load_settings(db)
    if settings.get("mode") != "live":
        return settings, None, "off"
    try:
        return settings, erp.DolibarrClient(settings), None
    except erp.DolibarrError as exc:
        return settings, None, exc.kind


async def member_id_of(
    db, user_id: str | None, settings: dict | None = None
) -> int | None:
    if not user_id:
        return None
    settings = settings or await erp.load_settings(db)
    if settings.get("mode") == "off":
        return None
    link = await verified_link(db, settings, user_id)
    return int(link["member_id"]) if link and link.get("member_id") else None


async def dolibarr_numbers(db, field: str, *, fresh: bool = False) -> dict:
    """Welche Nummern in Dolibarr bei aktiven Mitgliedern stehen: ``{"state", "numbers": {Nummer: [Mitglieds-IDs]}}``.
    ``state`` ist ``off`` (nicht angebunden), ``ok`` oder ``failed`` (mit ``error``). Kurz zwischengespeichert, damit
    die Live-Prüfung beim Tippen Dolibarr nicht bei jedem Zeichen ganz liest; vor dem Festlegen immer frisch.
    """
    settings, client, reason = await _connection(db)
    if reason == "off":
        return {"state": "off", "numbers": {}}
    if client is None:
        return {"state": "failed", "error": reason, "numbers": {}}
    key = (erp.instance_key(settings), field)
    cached = _scan_cache.get(key)
    if cached and not fresh:
        age = time.monotonic() - cached[0]
        if age < (SCAN_SECONDS if cached[1]["state"] == "ok" else FAILED_SCAN_SECONDS):
            return cached[1]
    numbers: dict[int, list[int]] = {}
    try:
        for page in range(MAX_SCAN_PAGES):
            rows = await client.core_members_page(page)
            for row in rows:
                if str(row.get("statut", row.get("status", "1"))) in GONE_STATUTS:
                    continue
                value = _as_number(
                    (row.get("array_options") or {}).get(f"options_{field}")
                )
                if value is not None and row.get("id") is not None:
                    numbers.setdefault(value, []).append(int(row["id"]))
            if len(rows) < erp.PAGE_LIMIT:
                break
        result = {"state": "ok", "numbers": numbers}
    except erp.DolibarrError as exc:
        logger.warning("[jersey] Dolibarr-Mitglieder nicht gelesen: %s", exc.kind)
        result = {"state": "failed", "error": exc.kind, "numbers": {}}
    _scan_cache[key] = (time.monotonic(), result)
    return result


async def _stale_members(db) -> set[int]:
    """Mitglieder, deren Wert in Dolibarr gerade nicht gilt: die Website hat für sie etwas anderes festgehalten, das
    noch nicht übertragen ist (etwa eine freigegebene Nummer nach Austritt, Kontolöschung oder einer gelösten
    Zuordnung) - frei ist frei, sofort.
    """
    rows = await db.jersey_numbers.find(
        {
            "$or": [
                {"dolibarr.state": {"$ne": "ok"}, "dolibarr.member_id": {"$ne": None}},
                {"pending_clears.0": {"$exists": True}},
            ]
        },
        {"_id": 0, "dolibarr.member_id": 1, "pending_clears": 1},
    ).to_list(5000)
    stale: set[int] = set()
    for row in rows:
        if (row.get("dolibarr") or {}).get("member_id"):
            stale.add(int(row["dolibarr"]["member_id"]))
        stale.update(_clear_map(row.get("pending_clears")))
    return stale


async def availability(
    db,
    number: int,
    *,
    user_id: str | None = None,
    fresh: bool = False,
    settings: dict | None = None,
) -> dict:
    """Ist die Nummer frei? Regeln (Bereich, reserviert), eigener Spiegel, dann alle aktiven Mitglieder in Dolibarr."""
    settings = settings or await load_settings(db)
    view = {"number": number, "free": False, "reason": None, "text": ""}
    rule = _rule_text(settings, number)
    if rule:
        return {**view, "reason": "rule", "text": rule}
    holder = await db.jersey_numbers.find_one(
        {"number_key": str(number)}, {"_id": 0, "user_id": 1}
    )
    if holder:
        if user_id and holder.get("user_id") == user_id:
            return {**view, "reason": "own", "text": "Das ist schon deine Nummer."}
        return {**view, "reason": "taken", "text": TAKEN_TEXT}
    scan = await dolibarr_numbers(db, settings["dolibarr_field"], fresh=fresh)
    own = await member_id_of(db, user_id)
    stale = await _stale_members(db) if scan["numbers"].get(number) else set()
    others = [m for m in scan["numbers"].get(number, []) if m != own and m not in stale]
    if others:
        return {**view, "reason": "taken", "text": TAKEN_TEXT}
    return {
        **view,
        "free": True,
        "text": "Frei.",
        "dolibarr_checked": scan["state"] == "ok",
    }


def _clear_map(raw) -> dict[int, int | None]:
    """``pending_clears`` als {Mitglieds-ID: Wert, der dort gelöscht werden soll}."""
    out: dict[int, int | None] = {}
    for item in raw or []:
        if isinstance(item, dict) and item.get("member_id"):
            out[int(item["member_id"])] = item.get("value")
        elif isinstance(item, int) and not isinstance(item, bool):
            out[item] = None
    return out


def _clear_list(clears: dict) -> list[dict]:
    return [
        {"member_id": member, "value": value}
        for member, value in sorted(clears.items())
    ]


async def _clear_old(client, field: str, member_id: int, value, notes: list) -> None:
    """Beim bisherigen Mitglied nur löschen, was die Website dort eingetragen hat. Steht inzwischen etwas anderes da
    (der Vorstand hat in Dolibarr eine neue Nummer vergeben), bleibt es stehen - mit Eintrag im Verlauf.
    """
    row = await client.core_member(member_id)
    there = _as_number((row.get("array_options") or {}).get(f"options_{field}"))
    if there is None:
        return
    if value is not None and there == value:
        await client.set_member_extrafield(member_id, field, None)
        return
    notes.append(
        _log(
            "clear_skipped",
            "system",
            value,
            there,
            "beim bisherigen Mitglied steht in Dolibarr inzwischen ein anderer Wert - nicht gelöscht",
        )
    )
    logger.info(
        "[jersey] Beim bisherigen Mitglied steht ein anderer Wert - nicht gelöscht"
    )


def _rev_filter(doc: dict) -> dict:
    """Bedingung „der Spiegel steht noch auf dem Stand, den ich gelesen habe“."""
    if "rev" in doc:
        return {"id": doc["id"], "rev": doc["rev"]}
    return {"id": doc["id"], "rev": {"$exists": False}}


async def _push(db, doc: dict, *, scan: dict | None = None, _round: int = 0) -> str:
    """Den aktuellen Stand einer Zeile nach Dolibarr schreiben und nachlesen. Liefert den neuen Zustand; wirft nie.

    Geschrieben wird immer, was **jetzt** im Spiegel steht - nie ein Stand, den der Aufrufer früher gelesen hat. ``ok``
    gilt nur, wenn sich der Spiegel währenddessen nicht geändert hat (Zähler ``rev``); hat er sich geändert, schreibt
    die Website gleich noch einmal, damit kein älterer Wert in Dolibarr stehen bleibt. Wechselt oder fällt die
    Zuordnung weg, wird der Wert beim bisherigen Mitglied gelöscht (``pending_clears``, bis es geklappt hat).
    """
    doc = await db.jersey_numbers.find_one({"id": doc["id"]}, {"_id": 0})
    if doc is None:
        return "gone"
    settings = await load_settings(db)
    field = settings["dolibarr_field"]
    want = doc.get("number")
    previous = doc.get("dolibarr") or {}
    clears = _clear_map(doc.get("pending_clears"))
    notes: list[dict] = []
    state, error = "ok", ""
    member_id = previous.get("member_id") if not doc.get("user_id") else None
    try:
        d_settings, client, reason = await _connection(db)
        if doc.get("user_id") and reason == "off":
            member_id = previous.get("member_id")  # ohne Anbindung nichts vergessen
        elif doc.get("user_id"):
            member_id = await member_id_of(db, doc["user_id"], d_settings)
            old = previous.get("member_id")
            if old and old != member_id and previous.get("value") is not None:
                clears.setdefault(int(old), previous.get("value"))
        clears.pop(member_id, None)
        if reason == "off":
            state = "off"
        elif client is None:
            state, error = "failed", reason
        else:
            writable = erp.write_capable(d_settings)
            for old, value in sorted(clears.items()) if writable else []:
                try:
                    await _clear_old(client, field, old, value, notes)
                    clears.pop(old, None)
                except erp.DolibarrError as exc:
                    if exc.kind == "not_found":
                        clears.pop(old, None)  # das Mitglied gibt es dort nicht mehr
                    else:
                        error = exc.kind
            if not member_id:
                state = "ok" if want is None else "no_member"
            elif not writable:
                state = "read_only"
            elif (
                want is not None
                and scan
                and scan.get("state") == "ok"
                and [m for m in scan["numbers"].get(want, []) if m != member_id]
            ):
                state = "conflict"
            else:
                try:
                    await client.set_member_extrafield(member_id, field, want)
                    row = await client.core_member(member_id)
                except erp.DolibarrError as exc:
                    # 403 kommt hier aus dem Mitgliedermodul, nicht aus dem Modul Vereine.
                    if exc.kind == "forbidden":
                        raise erp.DolibarrError(MEMBERS_FORBIDDEN, 403) from exc
                    raise
                got = _as_number(
                    (row.get("array_options") or {}).get(f"options_{field}")
                )
                state = "ok" if got == want else "field_missing"
            if clears and state == "ok":
                state = "failed" if writable else "read_only"
    except erp.DolibarrError as exc:
        state, error = "failed", exc.kind
    # Der Abgleich darf nie die Wahl oder eine Löschung scheitern lassen.
    except Exception:  # noqa: BLE001
        logger.warning("[jersey] Abgleich mit Dolibarr fehlgeschlagen", exc_info=True)
        state, error = "failed", "unavailable"
    if state not in ("ok", "off"):
        logger.info(
            "[jersey] Nummer von %s nicht in Dolibarr: %s",
            log_safe(doc.get("user_id") or "gelöscht"),
            state,
        )
    sync = {
        "state": state,
        "value": want,
        "member_id": member_id,
        "error": error,
        "field": field,
        "at": now_utc().isoformat(),
    }
    update: dict = {"$set": {"dolibarr": sync, "pending_clears": _clear_list(clears)}}
    if notes:
        update["$push"] = {"log": {"$each": notes, "$slice": -LOG_KEEP}}
    done = await db.jersey_numbers.update_one(_rev_filter(doc), update)
    reset_cache()
    if done.matched_count:
        return state
    # Während des Schreibens hat sich der Spiegel geändert: mit dem neuen Stand noch einmal - sonst bleibt der
    # Nachtrag offen, und der Job holt ihn nach.
    if clears or notes:
        late: dict = {"$addToSet": {"pending_clears": {"$each": _clear_list(clears)}}}
        if notes:
            late["$push"] = {"log": {"$each": notes, "$slice": -LOG_KEEP}}
        await db.jersey_numbers.update_one({"id": doc["id"]}, late)
    if _round < 2:
        return await _push(db, doc, scan=scan, _round=_round + 1)
    await db.jersey_numbers.update_one(
        {"id": doc["id"]}, {"$set": {"dolibarr.state": "pending"}}
    )
    return "pending"


async def link_changed(db, user_id: str) -> None:
    """Die Zuordnung zum Dolibarr-Mitglied wurde bestätigt oder gelöst. Das Konto behält seine Nummer; beim bisherigen
    Mitglied wird sie gelöscht, beim neuen eingetragen (sofort, sonst über den Nachtrag).
    """
    doc = await _doc(db, user_id)
    if not doc:
        return
    await db.jersey_numbers.update_one(
        {"id": doc["id"]}, {"$inc": {"rev": 1}, "$set": {"dolibarr.state": "pending"}}
    )
    await _push(db, doc)


# Bei jeder bestätigten oder gelösten Zuordnung nachziehen (ohne Import-Kreis über dolibarr_links).
on_link_change(link_changed)


def sync_view(doc: dict | None, field: str, *, board: bool = False) -> dict:
    sync = (doc or {}).get("dolibarr") or {}
    state = sync.get("state") or "pending"
    texts = SYNC_TEXTS.get(state, SYNC_TEXTS["pending"])
    if state == "failed" and sync.get("error") == MEMBERS_FORBIDDEN:
        texts = MEMBERS_FORBIDDEN_TEXTS
    text = texts[1 if board else 0].format(
        field=sync.get("field") or field,
        error=erp.ERROR_TEXTS.get(sync.get("error") or "", "unbekannt"),
    )
    return {"state": state, "text": text, "at": sync.get("at")}


# ---------------------------------------------------------------- Spiegel


async def _after(collection, query: dict, update: dict, **kwargs) -> dict | None:
    """Ändern und den neuen Stand ohne ``_id`` zurückgeben."""
    doc = await collection.find_one_and_update(
        query, update, return_document=ReturnDocument.AFTER, **kwargs
    )
    if doc:
        doc.pop("_id", None)
    return doc


async def _doc(db, user_id: str) -> dict | None:
    return await db.jersey_numbers.find_one({"user_id": user_id}, {"_id": 0})


async def _membership_status(db, user_id: str) -> str:
    row = await db.memberships.find_one(
        {"user_id": user_id}, {"_id": 0, "member_status": 1}
    )
    return str((row or {}).get("member_status") or "none")


async def is_eligible(db, user_id: str) -> bool:
    return await _membership_status(db, user_id) in ELIGIBLE_STATUSES


def _log(
    action: str, actor: str, before: int | None, after: int | None, note: str = ""
) -> dict:
    return {
        "at": now_utc().isoformat(),
        "action": action,
        "actor": actor,
        "from": before,
        "to": after,
        "note": str(note or "")[:300],
    }


async def _audit(db, actor_id: str, action: str, target_id: str) -> None:
    """Adminprotokoll: was geschah, nie welche Nummer."""
    await db.audit_logs.insert_one(
        {
            "id": new_id(),
            "action": action,
            "actor_id": actor_id,
            "target_id": target_id,
            "data": {},
            "created_at": now_utc().isoformat(),
        }
    )


async def _claim(
    db,
    user_id: str,
    number: int,
    *,
    actor: str,
    action: str,
    note: str = "",
    only_if_open: bool = False,
) -> dict:
    """Die Nummer atomar an das Konto binden; eine alte Nummer wird im selben Schritt frei. Ist die Nummer schon
    vergeben (eindeutiger Index), 409 - außer es ist schon die eigene (Doppelklick)."""
    now = now_utc().isoformat()
    current = await _doc(db, user_id)
    before = (current or {}).get("number")
    if current and before == number and not current.get("can_choose", True):
        return current
    query: dict = {"user_id": user_id}
    if only_if_open:
        query["can_choose"] = {"$ne": False}
    update = {
        "$set": {
            "number": number,
            "number_key": str(number),
            "can_choose": False,
            "chosen_at": now,
            "set_by": actor,
            "updated_at": now,
            "dolibarr.state": "pending",
            "dolibarr.value": number,
        },
        "$inc": {"rev": 1},
        "$setOnInsert": {"id": new_id(), "created_at": now},
        "$push": {
            "log": {
                "$each": [_log(action, actor, before, number, note)],
                "$slice": -LOG_KEEP,
            }
        },
    }
    try:
        return await _after(db.jersey_numbers, query, update, upsert=True)
    except DuplicateKeyError as exc:
        mine = await _doc(db, user_id)
        if mine and mine.get("number") == number:
            return mine
        holder = await db.jersey_numbers.find_one(
            {"number_key": str(number)}, {"_id": 0, "user_id": 1}
        )
        if holder and holder.get("user_id") != user_id:
            raise JerseyError(409, RACE_TEXT if only_if_open else TAKEN_TEXT) from exc
        raise JerseyError(409, LOCKED_TEXT) from exc


async def _free(
    db, user_id: str, *, actor: str, action: str, note: str = ""
) -> dict | None:
    """Nummer freigeben; danach darf das Konto wieder einmal wählen."""
    now = now_utc().isoformat()
    current = await _doc(db, user_id)
    update = {
        "$set": {
            "number": None,
            "can_choose": True,
            "updated_at": now,
            "dolibarr.state": "pending",
            "dolibarr.value": None,
        },
        "$unset": {"number_key": ""},
        "$inc": {"rev": 1},
        "$setOnInsert": {"id": new_id(), "created_at": now},
        "$push": {
            "log": {
                "$each": [
                    _log(action, actor, (current or {}).get("number"), None, note)
                ],
                "$slice": -LOG_KEEP,
            }
        },
    }
    return await _after(db.jersey_numbers, {"user_id": user_id}, update, upsert=True)


async def _adopt_from_dolibarr(db, user_id: str, settings: dict) -> None:
    """Steht beim eigenen Mitglied in Dolibarr schon eine Nummer (der Vorstand hat sie dort eingetragen), übernimmt die
    Website sie einmal - sofern sie im Spiegel frei ist. Sonst bleibt alles, wie es ist.
    """
    d_settings, client, reason = await _connection(db)
    if client is None:
        return
    member_id = await member_id_of(db, user_id, d_settings)
    if not member_id:
        return
    try:
        row = await client.core_member(member_id)
    except erp.DolibarrError:
        return
    value = _as_number(
        (row.get("array_options") or {}).get(f"options_{settings['dolibarr_field']}")
    )
    if value is None or value < 0:
        return
    now = now_utc().isoformat()
    try:
        await db.jersey_numbers.update_one(
            {
                "user_id": user_id,
                "number_key": {"$exists": False},
                "can_choose": {"$ne": False},
                "log": {"$size": 0},
            },
            {
                "$set": {
                    "number": value,
                    "number_key": str(value),
                    "can_choose": False,
                    "chosen_at": now,
                    "set_by": "dolibarr",
                    "updated_at": now,
                    "dolibarr": {
                        "state": "ok",
                        "value": value,
                        "member_id": member_id,
                        "error": "",
                        "field": settings["dolibarr_field"],
                        "at": now,
                    },
                },
                "$inc": {"rev": 1},
                "$setOnInsert": {"id": new_id(), "created_at": now},
                "$push": {
                    "log": _log(
                        "adopted",
                        "dolibarr",
                        None,
                        value,
                        "aus der Mitgliederverwaltung übernommen",
                    )
                },
            },
            upsert=True,
        )
    except DuplicateKeyError:
        return


# ---------------------------------------------------------------- Mitglied


def _request_view(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "current": row.get("current"),
        "wished": row.get("wished"),
        "reason": row.get("reason") or "",
        "status": row.get("status"),
        "status_label": REQUEST_LABELS.get(
            str(row.get("status")), row.get("status") or ""
        ),
        "decision_reason": row.get("decision_reason") or "",
        "received_at": row.get("received_at"),
        "decided_at": row.get("decided_at"),
    }


async def overview(db, user: dict) -> dict:
    """Die eigene Nummer, ob gewählt werden darf, der Bereich, der Stand in Dolibarr und die eigenen Anträge."""
    settings = await load_settings(db)
    user_id = user["id"]
    if not await is_eligible(db, user_id):
        return {
            "available": False,
            "reason": "not_member",
            "text": "Eine eigene Nummer gibt es für Vereinsmitglieder.",
        }
    doc = await _doc(db, user_id)
    if not doc or (
        doc.get("number") is None and doc.get("can_choose", True) and not doc.get("log")
    ):
        await _adopt_from_dolibarr(db, user_id, settings)
        doc = await _doc(db, user_id)
    rows = (
        await db.jersey_number_requests.find({"user_id": user_id}, {"_id": 0})
        .sort("received_at", -1)
        .to_list(10)
    )
    open_row = next(
        (row for row in rows if row.get("status") in (OPEN, DECIDING)), None
    )
    number = (doc or {}).get("number")
    can_choose = bool((doc or {}).get("can_choose", True))
    return {
        "available": True,
        "number": number,
        "can_choose": can_choose,
        # Schon einmal gewählt und vom Vorstand freigegeben: „such dir einmal eine neue aus“.
        "again": can_choose and bool((doc or {}).get("log")),
        # Freie Nummern auch nach dem Festlegen - für den Wunsch im Antrag.
        **(await _free_view(db, settings)),
        "chosen_at": (doc or {}).get("chosen_at") if number is not None else None,
        "set_by": (doc or {}).get("set_by") if number is not None else None,
        "range": {"min": settings["min"], "max": settings["max"]},
        "reserved": settings["reserved"],
        "dolibarr": (
            sync_view(doc, settings["dolibarr_field"]) if number is not None else None
        ),
        "open_request": _request_view(open_row) if open_row else None,
        "requests": [_request_view(row) for row in rows],
        "status_labels": dict(REQUEST_LABELS),
    }


async def _free_view(db, settings: dict) -> dict:
    """Welche Nummern im Bereich noch frei sind - als Raster zum Antippen, damit niemand durchprobieren muss und
    „alle vergeben“ gleich dasteht. Nur Nummern, nie wer eine hat. Bei sehr großen Bereichen nur die Zahl.
    """
    low, high = settings["min"], settings["max"]
    held = {
        int(row["number_key"])
        for row in await db.jersey_numbers.find(
            {"number_key": {"$exists": True}}, {"_id": 0, "number_key": 1}
        ).to_list(20000)
    }
    scan = await dolibarr_numbers(db, settings["dolibarr_field"])
    stale = await _stale_members(db) if scan["numbers"] else set()
    held |= {
        value
        for value, members in scan["numbers"].items()
        if any(m not in stale for m in members)
    }
    blocked = {n for n in set(settings["reserved"]) | held if low <= n <= high}
    size = high - low + 1
    free = (
        [n for n in range(low, high + 1) if n not in blocked]
        if size <= GRID_MAX
        else None
    )
    return {"free_count": max(size - len(blocked), 0), "free_numbers": free}


async def check(db, user: dict, raw) -> dict:
    if not await is_eligible(db, user["id"]):
        raise JerseyError(403, "Eine eigene Nummer gibt es für Vereinsmitglieder.")
    return await availability(db, parse_number(raw), user_id=user["id"])


async def choose(db, user: dict, raw, confirmed: bool) -> dict:
    """Einmal frei wählen - mit Bestätigung, gegen Spiegel und Dolibarr geprüft, atomar gesperrt."""
    user_id = user["id"]
    if not await is_eligible(db, user_id):
        raise JerseyError(403, "Eine eigene Nummer gibt es für Vereinsmitglieder.")
    number = parse_number(raw)
    if not confirmed:
        raise JerseyError(
            400,
            "Bitte bestätige zuerst: Danach ändert nur noch der Vorstand deine Nummer.",
        )
    doc = await _doc(db, user_id)
    if doc and not doc.get("can_choose", True):
        if doc.get("number") == number:
            return await overview(db, user)
        raise JerseyError(409, LOCKED_TEXT)
    settings = await load_settings(db)
    free = await availability(
        db, number, user_id=user_id, fresh=True, settings=settings
    )
    if not free["free"]:
        raise JerseyError(409, free["text"])
    fresh = await _claim(
        db, user_id, number, actor="member", action="chosen", only_if_open=True
    )
    if (fresh.get("dolibarr") or {}).get("state") == "pending":
        await _push(db, fresh)
    await _audit(db, user_id, "jersey_number.chosen", user_id)
    return await overview(db, user)


async def request_change(db, user: dict, wished_raw, reason: str) -> dict:
    """Änderungsantrag wie bei den Vereinsdaten: mit Begründung, optional mit Wunsch; der Vorstand entscheidet."""
    user_id = user["id"]
    if not await is_eligible(db, user_id):
        raise JerseyError(403, "Eine eigene Nummer gibt es für Vereinsmitglieder.")
    doc = await _doc(db, user_id)
    if not doc or doc.get("number") is None or doc.get("can_choose", True):
        raise JerseyError(
            409,
            "Du kannst deine Nummer gerade selbst wählen – dafür braucht es keinen Antrag.",
        )
    text = str(reason or "").strip()
    if len(text) < REASON_MIN:
        raise JerseyError(
            400, "Schreib kurz dazu, warum du eine andere Nummer möchtest."
        )
    if len(text) > REASON_MAX:
        raise JerseyError(400, f"Die Begründung hat höchstens {REASON_MAX} Zeichen.")
    wished = None if wished_raw in (None, "") else parse_number(wished_raw)
    if wished is not None:
        if wished == doc["number"]:
            raise JerseyError(400, "Das ist schon deine Nummer.")
        free = await availability(db, wished, user_id=user_id, fresh=True)
        if not free["free"]:
            raise JerseyError(409, free["text"])
    now = now_utc().isoformat()
    row = {
        "id": new_id(),
        "user_id": user_id,
        "current": doc["number"],
        "wished": wished,
        "reason": text,
        "status": OPEN,
        "received_at": now,
        "decided_at": None,
        "decided_by": None,
        "decision_reason": "",
    }
    result = await db.jersey_number_requests.update_one(
        {"user_id": user_id, "status": {"$in": [OPEN, DECIDING]}},
        {"$setOnInsert": row},
        upsert=True,
    )
    if result.upserted_id is None:
        raise JerseyError(409, "Dein Antrag liegt schon beim Vorstand.")
    await db.jersey_numbers.update_one(
        {"user_id": user_id},
        {
            "$push": {
                "log": {
                    "$each": [_log("requested", "member", doc["number"], wished, text)],
                    "$slice": -LOG_KEEP,
                }
            }
        },
    )
    await _audit(db, user_id, "jersey_number.requested", user_id)
    await _notify_board(db, user)
    return _request_view(row)


async def _notify_board(db, user: dict) -> None:
    """Wie beim Mitgliedsantrag: ein Hinweis in den Vorstandskanal (ohne Namen) und eine Mail an den Vorstand."""
    from services.discord_announcements import notify_board

    await notify_board(
        "membership.jersey_number", "Ein Mitglied möchte eine andere Nummer."
    )
    try:
        from routes.phase_ef_routes import render_template
        from services.mail_queue import enqueue_mail

        admins = await db.users.find(
            {"role": {"$in": ["club_admin", "superadmin"]}}, {"_id": 0, "email": 1}
        ).to_list(20)
        subject, html = await render_template(
            "jersey_number_request_admin",
            {
                "member": user.get("display_name")
                or user.get("username")
                or "Ein Mitglied"
            },
            fallback_subject="Antrag auf eine andere Nummer",
            fallback_html="<p>{{member}} möchte eine andere Nummer. "
            "Du findest den Antrag im Admin unter Mitglieder → Nummern.</p>",
        )
        for admin in admins:
            if admin.get("email"):
                await enqueue_mail(to=admin["email"], subject=subject, html=html)
    except Exception:  # noqa: BLE001 - ein Antrag darf nie an der Mail scheitern
        logger.warning(
            "[jersey] Mail an den Vorstand zum Antrag fehlgeschlagen", exc_info=True
        )


async def _tell_member(user_id: str, title: str, body: str) -> None:
    try:
        from services.user_notifications import create_user_notification

        await create_user_notification(
            user_id,
            title,
            body,
            url="/members/membership",
            kind="jersey_number",
            meta={"category": "membership_updates"},
        )
    except Exception:  # noqa: BLE001 - die Entscheidung gilt auch ohne Hinweis
        logger.warning("[jersey] Hinweis an das Mitglied fehlgeschlagen", exc_info=True)


# ---------------------------------------------------------------- Vorstand


async def set_number(db, actor: dict, user_id: str, raw, note: str = "") -> dict:
    """Der Vorstand vergibt oder ändert die Nummer; die alte wird sofort frei."""
    if not await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1}):
        raise JerseyError(404, "Dieses Konto gibt es nicht.")
    number = parse_number(raw)
    settings = await load_settings(db)
    current = await _doc(db, user_id)
    if not (current and current.get("number") == number):
        free = await availability(
            db, number, user_id=user_id, fresh=True, settings=settings
        )
        if not free["free"] and free["reason"] != "own":
            raise JerseyError(409, free["text"])
    fresh = await _claim(
        db, user_id, number, actor="board", action="set_by_board", note=note
    )
    if (fresh.get("dolibarr") or {}).get("state") == "pending":
        await _push(db, fresh)
    await _audit(db, actor["id"], "jersey_number.set", user_id)
    if not current or current.get("number") != number:
        await _tell_member(
            user_id,
            "Deine Nummer wurde geändert",
            "Der Vorstand hat dir eine Nummer eingetragen. Du siehst sie unter Meine Mitgliedschaft.",
        )
    return await admin_row(db, user_id)


async def reopen(
    db, actor: dict, user_id: str, note: str = "", *, tell: bool = True
) -> dict:
    """Neuwahl anfordern: die alte Nummer wird sofort frei, das Mitglied darf wieder einmal wählen."""
    if not await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1}):
        raise JerseyError(404, "Dieses Konto gibt es nicht.")
    doc = await _free(db, user_id, actor="board", action="reopened", note=note)
    await _push(db, doc)
    await _audit(db, actor["id"], "jersey_number.reopened", user_id)
    if tell:
        await _tell_member(
            user_id,
            "Such dir eine neue Nummer aus",
            "Der Vorstand hat deine Nummer freigegeben – du kannst jetzt einmal neu wählen.",
        )
    return await admin_row(db, user_id)


async def decide(
    db, actor: dict, request_id: str, decision: str, reason: str = ""
) -> dict:
    """Über einen Antrag entscheiden. Zuerst wird der Antrag atomar beansprucht (offen → in Entscheidung); erst dann
    ändert sich die Nummer. Eine zweite, gleichzeitige Entscheidung bekommt 409 und ändert nichts.
    """
    if decision not in DECISIONS:
        raise JerseyError(400, "Freigeben, Neuwahl oder Ablehnen.")
    claim = new_id()
    # Offen - oder in Entscheidung, aber verwaist (der Prozess ist dabei abgestürzt): dann darf neu entschieden werden.
    row = await _after(
        db.jersey_number_requests,
        {
            "id": request_id,
            "$or": [
                {"status": OPEN},
                {"status": DECIDING, "claimed_at": {"$lt": _stale_cutoff()}},
            ],
        },
        {
            "$set": {
                "status": DECIDING,
                "claim": claim,
                "claimed_at": now_utc().isoformat(),
            }
        },
    )
    if not row:
        if not await db.jersey_number_requests.find_one(
            {"id": request_id}, {"_id": 0, "id": 1}
        ):
            raise JerseyError(404, "Diesen Antrag gibt es nicht.")
        raise JerseyError(409, "Über diesen Antrag ist schon entschieden.")
    text = str(reason or "").strip()[:REASON_MAX]
    if decision == "approve" and row.get("wished") is None:
        decision = "reopen"
    try:
        if decision == "approve":
            await set_number(
                db, actor, row["user_id"], row["wished"], note="Antrag freigegeben"
            )
        elif decision == "reopen":
            await reopen(db, actor, row["user_id"], note="Antrag: Neuwahl", tell=False)
    except BaseException:
        # Hat es nicht geklappt (etwa: Wunschnummer inzwischen vergeben), bleibt der Antrag offen.
        await db.jersey_number_requests.update_one(
            {"id": request_id, "claim": claim},
            {"$set": {"status": OPEN}, "$unset": {"claim": "", "claimed_at": ""}},
        )
        raise
    status = DECISIONS[decision]
    now = now_utc().isoformat()
    done = await _after(
        db.jersey_number_requests,
        {"id": request_id, "claim": claim},
        {
            "$set": {
                "status": status,
                "decided_at": now,
                "decided_by": actor["id"],
                "decision_reason": text,
            },
            "$unset": {"claim": "", "claimed_at": ""},
        },
    )
    if not done:
        raise JerseyError(409, "Über diesen Antrag ist schon entschieden.")
    if decision == "reject":
        await db.jersey_numbers.update_one(
            {"user_id": row["user_id"]},
            {
                "$push": {
                    "log": {
                        "$each": [
                            _log(
                                "rejected",
                                "board",
                                row.get("current"),
                                row.get("current"),
                                text,
                            )
                        ],
                        "$slice": -LOG_KEEP,
                    }
                }
            },
        )
    await _audit(db, actor["id"], f"jersey_number.request_{status}", row["user_id"])
    messages = {
        "applied": (
            "Deine neue Nummer steht",
            "Der Vorstand hat deinen Antrag freigegeben.",
        ),
        "reopened": (
            "Such dir eine neue Nummer aus",
            "Der Vorstand hat deinen Antrag freigegeben – du kannst jetzt einmal neu wählen.",
        ),
        "rejected": (
            "Dein Antrag zur Nummer",
            "Der Vorstand hat deinen Antrag abgelehnt."
            + (f" Begründung: {text}" if text else ""),
        ),
    }
    await _tell_member(row["user_id"], *messages[status])
    return _request_view(done)


def _admin_view(
    doc: dict | None, user: dict | None, status: str, settings: dict, scan: dict
) -> dict:
    number = (doc or {}).get("number")
    member_id = ((doc or {}).get("dolibarr") or {}).get("member_id")
    in_dolibarr = [
        value
        for value, members in scan.get("numbers", {}).items()
        if member_id and member_id in members
    ]
    return {
        "user_id": (user or {}).get("id") or (doc or {}).get("user_id"),
        "name": (user or {}).get("display_name")
        or (user or {}).get("username")
        or "Gelöschter User",
        "username": (user or {}).get("username") or "",
        "member_status": status,
        "number": number,
        "can_choose": bool((doc or {}).get("can_choose", True)),
        "set_by": (doc or {}).get("set_by") if number is not None else None,
        "chosen_at": (doc or {}).get("chosen_at") if number is not None else None,
        "outside_rules": number is not None
        and _rule_text(settings, number) is not None,
        "dolibarr": (
            sync_view(doc, settings["dolibarr_field"], board=True) if doc else None
        ),
        "dolibarr_value": in_dolibarr[0] if in_dolibarr else None,
        "log": list(reversed((doc or {}).get("log") or []))[:20],
    }


async def admin_row(db, user_id: str) -> dict:
    settings = await load_settings(db)
    user = await db.users.find_one(
        {"id": user_id}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}
    )
    return _admin_view(
        await _doc(db, user_id),
        user,
        await _membership_status(db, user_id),
        settings,
        {"numbers": {}},
    )


async def admin_overview(db) -> dict:
    """Alle Mitglieder mit Nummer und Zustand, Nummern nur in Dolibarr, Anträge und Einstellungen."""
    settings = await load_settings(db)
    memberships = await db.memberships.find(
        {"member_status": {"$in": list(ELIGIBLE_STATUSES)}},
        {"_id": 0, "user_id": 1, "member_status": 1},
    ).to_list(5000)
    docs = await db.jersey_numbers.find(
        {"user_id": {"$exists": True}}, {"_id": 0}
    ).to_list(5000)
    by_user = {doc["user_id"]: doc for doc in docs if doc.get("user_id")}
    status_of = {row["user_id"]: row.get("member_status") for row in memberships}
    user_ids = sorted(
        set(status_of)
        | {uid for uid, doc in by_user.items() if doc.get("number") is not None}
    )
    users = {
        u["id"]: u
        for u in await db.users.find(
            {"id": {"$in": user_ids}},
            {"_id": 0, "id": 1, "display_name": 1, "username": 1},
        ).to_list(5000)
    }
    scan = await dolibarr_numbers(db, settings["dolibarr_field"])
    rows = [
        _admin_view(
            by_user.get(uid),
            users.get(uid),
            status_of.get(uid) or await _membership_status(db, uid),
            settings,
            scan,
        )
        for uid in user_ids
        if uid in users
    ]
    rows.sort(
        key=lambda row: (
            row["number"] is None,
            row["number"] if row["number"] is not None else 0,
            row["name"].casefold(),
        )
    )
    known = {
        member
        for doc in docs
        for member in [(doc.get("dolibarr") or {}).get("member_id")]
        if member
    }
    held = {row["number"] for row in rows if row["number"] is not None}
    dolibarr_only = sorted(
        (
            {"number": value, "member_id": member}
            for value, members in scan.get("numbers", {}).items()
            for member in members
            if member not in known
        ),
        key=lambda row: (row["number"], row["member_id"]),
    )
    duplicates = sorted(
        value for value, members in scan.get("numbers", {}).items() if len(members) > 1
    )
    requests = (
        await db.jersey_number_requests.find({}, {"_id": 0})
        .sort("received_at", -1)
        .to_list(200)
    )
    names = {
        u["id"]: u
        for u in await db.users.find(
            {"id": {"$in": list({r["user_id"] for r in requests})}},
            {"_id": 0, "id": 1, "display_name": 1, "username": 1},
        ).to_list(500)
    }
    request_rows = [
        {
            **_request_view(r),
            "user_id": r["user_id"],
            "name": (names.get(r["user_id"]) or {}).get("display_name")
            or (names.get(r["user_id"]) or {}).get("username")
            or "Gelöschter User",
        }
        for r in requests
    ]
    size = settings["max"] - settings["min"] + 1
    blocked = {
        n for n in settings["reserved"] if settings["min"] <= n <= settings["max"]
    }
    taken = {
        n
        for n in held | {row["number"] for row in dolibarr_only}
        if settings["min"] <= n <= settings["max"]
    } - blocked
    return {
        "settings": settings,
        "rows": rows,
        "dolibarr_only": dolibarr_only,
        "duplicates": duplicates,
        "dolibarr": {
            "state": scan["state"],
            "text": (
                ""
                if scan["state"] != "failed"
                else f"Dolibarr war nicht lesbar ({scan.get('error')}) – die Liste zeigt nur den Stand der Website."
            ),
        },
        "requests": [row for row in request_rows if row["status"] in (OPEN, DECIDING)]
        + [row for row in request_rows if row["status"] not in (OPEN, DECIDING)][:50],
        "open_requests": sum(
            1 for row in request_rows if row["status"] in (OPEN, DECIDING)
        ),
        "counts": {
            "size": size,
            "reserved": len(blocked),
            "taken": len(taken),
            "free": max(size - len(blocked) - len(taken), 0),
        },
        "status_labels": dict(REQUEST_LABELS),
    }


# ---------------------------------------------------------------- Austritt, Kontolöschung, Abgleich


async def release_for_status(db, user_id: str, status: str | None) -> bool:
    """Austritt: endet die Mitgliedschaft (ehemalig), ist die Nummer sofort frei. Ruhend oder gesperrt bleibt sie."""
    if status not in RELEASE_STATUSES:
        return False
    doc = await _doc(db, user_id)
    if not doc or doc.get("number") is None:
        return False
    fresh = await _free(
        db,
        user_id,
        actor="system",
        action="released_exit",
        note="Mitgliedschaft beendet",
    )
    await db.jersey_number_requests.update_many(
        {"user_id": user_id, "status": OPEN},
        {
            "$set": {
                "status": "rejected",
                "decided_at": now_utc().isoformat(),
                "decision_reason": "Mitgliedschaft beendet",
            }
        },
    )
    await _push(db, fresh)
    return True


async def release_for_erasure(db, user_id: str) -> None:
    """Kontolöschung: Anträge und Verlauf weg, die Nummer sofort frei. Steht sie noch in Dolibarr, bleibt nur die
    Mitglieds-ID ohne Konto stehen, bis der Wert dort gelöscht ist - danach verschwindet auch sie.
    """
    await db.jersey_number_requests.delete_many({"user_id": user_id})
    doc = await _doc(db, user_id)
    if not doc:
        return
    sync = doc.get("dolibarr") or {}
    clean_in_dolibarr = not sync.get("member_id") or (
        sync.get("value") is None and sync.get("state") == "ok"
    )
    if clean_in_dolibarr and not doc.get("pending_clears"):
        await db.jersey_numbers.delete_one({"id": doc["id"]})
        return
    orphan = await _after(
        db.jersey_numbers,
        {"id": doc["id"]},
        {
            "$unset": {"user_id": "", "number_key": "", "chosen_at": "", "set_by": ""},
            "$set": {
                "number": None,
                "log": [],
                "orphan": True,
                "dolibarr.state": "pending",
                "dolibarr.value": None,
                "updated_at": now_utc().isoformat(),
            },
            "$inc": {"rev": 1},
        },
    )
    if orphan:
        await _push(db, orphan)
        await _drop_cleared_orphan(db, doc["id"])


async def _drop_cleared_orphan(db, doc_id: str) -> None:
    """Eine Zeile ohne Konto verschwindet, sobald in Dolibarr nichts mehr von ihr steht."""
    await db.jersey_numbers.delete_one(
        {
            "id": doc_id,
            "orphan": True,
            "dolibarr.state": "ok",
            "pending_clears.0": {"$exists": False},
        }
    )


def _stale_cutoff() -> str:
    return (now_utc() - timedelta(minutes=DECIDING_STALE_MINUTES)).isoformat()


async def release_stale_decisions(db) -> int:
    """Eine Entscheidung, die nach dem Beanspruchen nie fertig wurde (Absturz), gibt den Antrag nach ein paar Minuten
    wieder frei - mit Eintrag im Verlauf und im Adminprotokoll."""
    count = 0
    for row in await db.jersey_number_requests.find(
        {"status": DECIDING, "claimed_at": {"$lt": _stale_cutoff()}}, {"_id": 0}
    ).to_list(200):
        reset = await db.jersey_number_requests.update_one(
            {"id": row["id"], "status": DECIDING, "claim": row.get("claim")},
            {"$set": {"status": OPEN}, "$unset": {"claim": "", "claimed_at": ""}},
        )
        if not reset.modified_count:
            continue
        count += 1
        note = "Entscheidung des Vorstands nicht abgeschlossen - Antrag wieder offen"
        await db.jersey_numbers.update_one(
            {"user_id": row["user_id"]},
            {
                "$push": {
                    "log": {
                        "$each": [
                            _log(
                                "decision_reset",
                                "system",
                                row.get("current"),
                                row.get("current"),
                                note,
                            )
                        ],
                        "$slice": -LOG_KEEP,
                    }
                }
            },
        )
        await _audit(db, "system", "jersey_number.request_reset", row["user_id"])
        logger.warning("[jersey] Verwaiste Entscheidung zu einem Antrag zurückgesetzt")
    return count


async def sync_pending(db=None, limit: int = 200) -> dict:
    """Verwaiste Entscheidungen freigeben; nachtragen, was noch nicht in Dolibarr steht (oder nach einem neuen
    Feldnamen dort fehlt)."""
    if db is None:
        from database import get_db

        db = get_db()
    await release_stale_decisions(db)
    d_settings = await erp.load_settings(db)
    if d_settings.get("mode") != "live":
        return {"skipped": "off"}
    field = (await load_settings(db))["dolibarr_field"]
    rows = await db.jersey_numbers.find(
        {
            "$or": [
                {"dolibarr.state": {"$ne": "ok"}},
                {"dolibarr.field": {"$ne": field}},
                {"pending_clears.0": {"$exists": True}},
            ]
        },
        {"_id": 0},
    ).to_list(limit)
    counts: dict[str, int] = {}
    if not rows:
        return counts
    scan = await dolibarr_numbers(db, field, fresh=True)
    for doc in rows:
        state = await _push(db, doc, scan=scan)
        counts[state] = counts.get(state, 0) + 1
        if doc.get("orphan"):
            await _drop_cleared_orphan(db, doc["id"])
    return counts
