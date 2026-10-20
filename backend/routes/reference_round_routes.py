"""Externe Serien - Kalender (#1742): Termine anlegen, einfügen, verschieben und absagen, „Ergebnis fehlt“.

Bereich Redaktion („content“). Ein Termin hat einen Wiener Tag (``club_day``) und, mit Uhrzeit, einen Zeitpunkt in UTC
(``starts_at``); ohne eigene Uhrzeit gilt die Standard-Uhrzeit der Serie. Gespeichert sind nur geplant, gewertet,
abgesagt und verschoben - „heute“ und „Ergebnis fehlt“ rechnet ``services/reference_calendar.py`` beim Lesen aus dem
Wiener Tag (``club_today()``). Verschieben hält den ursprünglichen Termin fest (``original_starts_at`` und
``original_club_day``, beim ersten Verschieben gesetzt und danach behalten), Absagen merkt sich den Status davor.
Gelöscht wird nichts: Termine werden archiviert. Nach jeder Änderung rechnet der Server die Stände der Serie neu
(abgesagte Runden zählen nicht zur Rundenzahl, ``counts`` nimmt eine Runde aus der Wertung). Jede Änderung läuft unter
der Sperre der Saison, wie das Eintragen der Ergebnisse (``reference_series.series_locked``, #1744).

Öffentlich: ``/api/reference-series/public/<spur>/<saison>/calendar`` - nur, wenn Spur und Serie sichtbar und nicht
archiviert sind, ohne Notizen. Die Felder (Titel, Ort, Tag, Zeitpunkt, Status) sind so gewählt, dass der Vereinskalender
(``calendar_items``, Stufe 2, #1752) sie später übernehmen kann.
"""
from __future__ import annotations

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from pymongo import ReturnDocument

from auth import get_optional_user, require_area
from database import get_db
from models import ReferenceRoundCreate, ReferenceRoundUpdate, _clock, new_id, now_utc
from services import reference_series
from services.dolibarr_policy import club_today
from services.series_standings import ordered_rounds
from services.reference_calendar import (
    ClockError, calendar_view, clock_gap_message, club_day_of, parse_round_lines, vienna_clock, vienna_start,
)
from services.reference_series_access import SeriesAccess, require_series_editor
from services.visibility import user_can_see

router = APIRouter(prefix="/api/reference-series", tags=["reference-series"])

PUBLIC_FIELDS = ("id", "position", "code", "title", "venue", "starts_at", "club_day", "time", "state", "status",
                 "original_starts_at", "original_club_day", "kind", "counts", "opponent")


def _day(value: Optional[str]) -> Optional[str]:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError as exc:
        raise ValueError("Datum als JJJJ-MM-TT, etwa 2026-11-05.") from exc


class _DayTime(BaseModel):
    @field_validator("day", check_fields=False)
    @classmethod
    def _check_day(cls, value):
        return _day(value)

    @field_validator("time", check_fields=False)
    @classmethod
    def _check_time(cls, value):
        return _clock(value)


class _Versioned(BaseModel):
    """``expected_version``: der Stand des Kalenders, den die Seite kennt (``version`` aus dem Kalender). Hat ihn
    inzwischen jemand anderes geändert, gibt es 409 statt eines stillen Überschreibens."""
    expected_version: Optional[int] = Field(default=None, ge=0)


class RoundCreateBody(_DayTime, _Versioned, ReferenceRoundCreate):
    """Termin anlegen: Wiener Tag und Uhrzeit. Ohne ``time`` gilt die Standard-Uhrzeit der Serie, ``time: null`` heißt
    ausdrücklich „ohne Uhrzeit“."""
    day: Optional[str] = None
    time: Optional[str] = None


class RoundUpdateBody(_DayTime, _Versioned, ReferenceRoundUpdate):
    day: Optional[str] = None
    time: Optional[str] = None


class RoundPostponeBody(_DayTime, _Versioned):
    day: str
    time: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=300)


class RoundActionBody(_Versioned):
    """Wiederansetzen, Archivieren, Zurückholen: nur der Stand des Kalenders."""


class RoundCancelBody(_Versioned):
    note: Optional[str] = Field(default=None, max_length=300)


class RoundOrderBody(_Versioned):
    ids: List[str] = Field(default_factory=list, max_length=500)


class RoundSortBody(_Versioned):
    pass


class RoundPasteBody(_Versioned):
    text: str = Field(max_length=20000)
    apply: bool = False


# ---------------------------------------------------------------- Hilfen
async def _series(db, series_id: str) -> dict:
    found = await db.reference_series.find_one({"id": series_id}, {"_id": 0})
    if not found:
        raise HTTPException(404, "Serie nicht gefunden.")
    return found


async def _round(db, series_id: str, round_id: str) -> dict:
    # Die Termin-Kennung muss zur Serie aus dem Pfad gehören.
    found = await db.reference_rounds.find_one({"id": round_id, "series_id": series_id}, {"_id": 0})
    if not found:
        raise HTTPException(404, "Termin nicht gefunden.")
    return found


def _stamp(me: dict) -> dict:
    return {"updated_at": now_utc().isoformat(), "updated_by": me["id"]}


def _text(value) -> Optional[str]:
    return (value or "").strip() or None


def _when(day: Optional[str], clock: Optional[str]) -> dict:
    try:
        return {"club_day": day, "starts_at": vienna_start(day, clock)}
    except ClockError:
        raise HTTPException(422, clock_gap_message(day, clock)) from None


def _when_from_instant(value) -> dict:
    if value is None:
        return {"club_day": None, "starts_at": None}
    return {"club_day": club_day_of(value), "starts_at": value.isoformat()}


STALE = "Der Kalender wurde inzwischen geändert – bitte neu laden."


async def _claim(db, series_id: str, expected: Optional[int] = None, *, orders: int = 0) -> int:
    """Jede Änderung am Kalender zählt ``calendar_version`` der Serie atomar hoch - mit ``expected`` nur, wenn der
    Stand noch stimmt (sonst 409). ``orders`` vergibt so viele neue Reihenfolge-Nummern über den Zähler
    ``round_order_seq``: auch zwei gleichzeitige Anlagen bekommen nie dieselbe. Liefert die erste neue Nummer."""
    if orders:
        rows = await db.reference_rounds.find({"series_id": series_id}, {"_id": 0, "order": 1}).to_list(None)
        highest = max([int(row.get("order") or 0) for row in rows] or [0])
        # $max ist atomar: der Zähler fängt nie unter der höchsten vorhandenen Nummer an.
        await db.reference_series.update_one({"id": series_id}, {"$max": {"round_order_seq": highest}})
    query: dict = {"id": series_id}
    if expected is not None:
        query["calendar_version"] = expected if expected else {"$in": [0, None]}
    before = await db.reference_series.find_one_and_update(
        query, {"$inc": {"calendar_version": 1, "round_order_seq": orders}},
        projection={"_id": 0, "round_order_seq": 1}, return_document=ReturnDocument.BEFORE)
    if before is None:
        raise HTTPException(409, STALE)
    return int(before.get("round_order_seq") or 0) + 1


async def _log(db, action: str, me: dict, series_id: str, data: dict) -> None:
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": me["id"], "target_id": series_id,
                                    "data": data, "created_at": now_utc().isoformat()})


def _brief(doc: dict) -> dict:
    """Knapper Stand eines neuen Termins fürs Protokoll: gesetzte Felder, Art und Wertung nur, wenn abweichend."""
    out = {key: doc.get(key) for key in ("code", "title", "venue", "club_day", "starts_at", "order", "opponent")
           if doc.get(key) is not None}
    if doc.get("kind", "regular") != "regular":
        out["kind"] = doc["kind"]
    if doc.get("counts") is False:
        out["counts"] = False
    return out


async def _active_ids(db, series_id: str) -> list[str]:
    rounds = await db.reference_rounds.find({"series_id": series_id, "archived_at": None}, {"_id": 0}).to_list(None)
    return [item["id"] for item in ordered_rounds(rounds)]


async def _recompute(db, series_id: str) -> None:
    await reference_series.recompute_standings(db, await _series(db, series_id))


def _new_round(series_id: str, me: dict, **fields) -> dict:
    now = now_utc().isoformat()
    return {
        "id": new_id(), "series_id": series_id, "order": 0, "code": None, "title": None, "venue": None,
        "club_day": None, "starts_at": None, "status": "planned", "original_starts_at": None,
        "original_club_day": None, "cancelled_from": None, "status_note": None, "kind": "regular", "counts": True,
        "opponent": None, "note": None, "source": "manual", "archived_at": None,
        "created_at": now, "created_by": me["id"], **_stamp(me), **fields,
    }


async def _calendar(db, series_id: str) -> dict:
    series = await db.reference_series.find_one({"id": series_id}, {"_id": 0, "calendar_version": 1}) or {}
    rounds = await db.reference_rounds.find({"series_id": series_id}, {"_id": 0}).to_list(None)
    published = [row["round_id"] async for row in db.reference_round_results.find(
        {"series_id": series_id, "status": "published"}, {"_id": 0, "round_id": 1})]
    today = club_today()
    view = calendar_view(rounds, published, today)
    archived = sorted((item for item in rounds if item.get("archived_at")),
                      key=lambda item: (item.get("order") or 0, str(item.get("id"))))
    for item in [*view["rounds"], *archived]:
        item["time"] = vienna_clock(item.get("starts_at"))
    return {"today": today, "version": int(series.get("calendar_version") or 0), **view, "archived": archived}


# ---------------------------------------------------------------- Verwaltung
@router.get("/admin/series/{series_id}/calendar")
async def admin_calendar(series_id: str, access: SeriesAccess = Depends(require_series_editor)):
    """Kalender der Serie: Termine in Reihenfolge mit Status, Zähler je Status, Hinweise auf Lücken, archivierte
    Termine extra. Lesen dürfen Vorstand und gültige Captains dieser Saison (#1749) - sie tragen zu diesen Terminen
    Ergebnisse ein; ändern darf den Kalender nur der Vorstand (Bereich Redaktion)."""
    return await _calendar(get_db(), series_id)


@router.post("/admin/series/{series_id}/rounds")
@reference_series.series_locked
async def create_round(series_id: str, body: RoundCreateBody, me: dict = Depends(require_area("content"))):
    db = get_db()
    series = await _series(db, series_id)
    if body.status != "planned":
        raise HTTPException(422, "Ein neuer Termin ist geplant - Absagen und Verschieben gibt es danach.")
    if body.day:
        clock = body.time if "time" in body.model_fields_set else series.get("default_time")
        when = _when(body.day, clock)
    else:
        when = _when_from_instant(body.starts_at)
    first = await _claim(db, series_id, body.expected_version, orders=1)
    # Die Nummer vergibt immer die Folge - ein mitgeschicktes ``order`` zählt nicht (Reihenfolge nur über Ordnen).
    doc = _new_round(series_id, me, order=first, code=_text(body.code),
                     title=_text(body.title), venue=_text(body.venue), **when, kind=body.kind, counts=body.counts,
                     opponent=_text(body.opponent), note=_text(body.note))
    await db.reference_rounds.insert_one(doc)
    await _log(db, "reference_round.create", me, series_id, {"round_id": doc["id"], "after": _brief(doc)})
    await _recompute(db, series_id)
    doc.pop("_id", None)
    return doc


@router.patch("/admin/series/{series_id}/rounds/{round_id}")
@reference_series.series_locked
async def update_round(series_id: str, round_id: str, body: RoundUpdateBody,
                       me: dict = Depends(require_area("content"))):
    db = get_db()
    await _series(db, series_id)
    existing = await _round(db, series_id, round_id)
    raw = body.model_dump(exclude_unset=True)
    if "order" in raw:
        raise HTTPException(422, "Die Reihenfolge ändern „Ordnen“ und „Nach Datum ordnen“.")
    if "status" in raw or "original_starts_at" in raw:
        raise HTTPException(422, "Den Status ändern Verschieben, Absagen und das Ergebnis.")
    updates: dict = {key: _text(raw[key]) for key in ("code", "title", "venue", "opponent", "note") if key in raw}
    updates.update({key: raw[key] for key in ("kind", "counts") if raw.get(key) is not None})
    if "day" in raw or "time" in raw:
        day = raw["day"] if "day" in raw else existing.get("club_day")
        clock = raw["time"] if "time" in raw else vienna_clock(existing.get("starts_at"))
        updates.update(_when(day, clock))
    elif "starts_at" in raw:
        updates.update(_when_from_instant(raw["starts_at"]))
    await _claim(db, series_id, body.expected_version)
    await db.reference_rounds.update_one({"id": round_id}, {"$set": {**updates, **_stamp(me)}})
    await _log(db, "reference_round.update", me, series_id, {
        "round_id": round_id, "before": {key: existing.get(key) for key in updates}, "after": updates})
    await _recompute(db, series_id)
    return await _round(db, series_id, round_id)


@router.post("/admin/series/{series_id}/rounds/{round_id}/postpone")
@reference_series.series_locked
async def postpone_round(series_id: str, round_id: str, body: RoundPostponeBody,
                         me: dict = Depends(require_area("content"))):
    """Neuer Tag (und Uhrzeit); der ursprüngliche Termin bleibt vom ersten Verschieben an stehen."""
    db = get_db()
    series = await _series(db, series_id)
    existing = await _round(db, series_id, round_id)
    if existing.get("status") == "scored":
        raise HTTPException(409, "Der Termin ist schon gewertet.")
    if "time" in body.model_fields_set:
        clock = body.time
    else:
        clock = vienna_clock(existing.get("starts_at")) or series.get("default_time")
    keep = existing.get("original_club_day") is not None
    updates = {
        **_when(body.day, clock), "status": "postponed", "cancelled_from": None,
        "original_starts_at": existing.get("original_starts_at") if keep else existing.get("starts_at"),
        "original_club_day": existing.get("original_club_day") if keep else existing.get("club_day"),
        "status_note": _text(body.note),
    }
    await _claim(db, series_id, body.expected_version)
    await db.reference_rounds.update_one({"id": round_id}, {"$set": {**updates, **_stamp(me)}})
    await _log(db, "reference_round.postpone", me, series_id, {
        "round_id": round_id, "from": existing.get("club_day"), "to": body.day, "note": updates["status_note"]})
    await _recompute(db, series_id)
    return await _round(db, series_id, round_id)


@router.post("/admin/series/{series_id}/rounds/{round_id}/cancel")
@reference_series.series_locked
async def cancel_round(series_id: str, round_id: str, body: RoundCancelBody,
                       me: dict = Depends(require_area("content"))):
    """Abgesagt: zählt nie als „Ergebnis fehlt“ und nicht zur Rundenzahl der Wertung."""
    db = get_db()
    await _series(db, series_id)
    existing = await _round(db, series_id, round_id)
    if existing.get("status") == "scored":
        raise HTTPException(409, "Der Termin ist schon gewertet.")
    if existing.get("status") != "cancelled":
        await _claim(db, series_id, body.expected_version)
        await db.reference_rounds.update_one({"id": round_id}, {"$set": {
            "status": "cancelled", "cancelled_from": existing.get("status") or "planned",
            "status_note": _text(body.note), **_stamp(me)}})
        await _log(db, "reference_round.cancel", me, series_id, {"round_id": round_id, "note": _text(body.note)})
        await _recompute(db, series_id)
    return await _round(db, series_id, round_id)


@router.post("/admin/series/{series_id}/rounds/{round_id}/reinstate")
@reference_series.series_locked
async def reinstate_round(series_id: str, round_id: str, body: Optional[RoundActionBody] = None,
                          me: dict = Depends(require_area("content"))):
    """Absage zurücknehmen: der Status davor (geplant oder verschoben) gilt wieder."""
    db = get_db()
    await _series(db, series_id)
    existing = await _round(db, series_id, round_id)
    if existing.get("status") == "cancelled":
        await _claim(db, series_id, body.expected_version if body else None)
        await db.reference_rounds.update_one({"id": round_id}, {"$set": {
            "status": existing.get("cancelled_from") or "planned", "cancelled_from": None, "status_note": None,
            **_stamp(me)}})
        await _log(db, "reference_round.reinstate", me, series_id, {"round_id": round_id})
        await _recompute(db, series_id)
    return await _round(db, series_id, round_id)


async def _set_archived(series_id: str, round_id: str, archived: bool, me: dict,
                        body: Optional[RoundActionBody]) -> dict:
    db = get_db()
    await _series(db, series_id)
    existing = await _round(db, series_id, round_id)
    if archived and existing.get("status") == "scored":
        raise HTTPException(409, "Der Termin ist schon gewertet.")
    await _claim(db, series_id, body.expected_version if body else None)
    await db.reference_rounds.update_one({"id": round_id}, {"$set": {
        "archived_at": now_utc().isoformat() if archived else None, **_stamp(me)}})
    await _log(db, "reference_round.archive" if archived else "reference_round.restore", me, series_id,
               {"round_id": round_id})
    await _recompute(db, series_id)
    return await _round(db, series_id, round_id)


@router.post("/admin/series/{series_id}/rounds/{round_id}/archive")
@reference_series.series_locked
async def archive_round(series_id: str, round_id: str, body: Optional[RoundActionBody] = None,
                        me: dict = Depends(require_area("content"))):
    return await _set_archived(series_id, round_id, True, me, body)


@router.post("/admin/series/{series_id}/rounds/{round_id}/restore")
@reference_series.series_locked
async def restore_round(series_id: str, round_id: str, body: Optional[RoundActionBody] = None,
                        me: dict = Depends(require_area("content"))):
    return await _set_archived(series_id, round_id, False, me, body)


async def _write_order(db, series_id: str, ids: list[str], me: dict) -> None:
    for index, round_id in enumerate(ids, start=1):
        await db.reference_rounds.update_one({"id": round_id, "series_id": series_id},
                                             {"$set": {"order": index, **_stamp(me)}})


@router.post("/admin/series/{series_id}/rounds/order")
@reference_series.series_locked
async def order_rounds(series_id: str, body: RoundOrderBody, me: dict = Depends(require_area("content"))):
    """Neue Reihenfolge: genau die nicht archivierten Termine der Serie, jeder einmal."""
    db = get_db()
    await _series(db, series_id)
    active = {row["id"] async for row in db.reference_rounds.find(
        {"series_id": series_id, "archived_at": None}, {"_id": 0, "id": 1})}
    if len(body.ids) != len(set(body.ids)) or set(body.ids) != active:
        raise HTTPException(422, "Die Reihenfolge muss jeden Termin der Serie genau einmal nennen.")
    before = await _active_ids(db, series_id)
    await _claim(db, series_id, body.expected_version)
    await _write_order(db, series_id, body.ids, me)
    await _log(db, "reference_round.order", me, series_id, {"before": before, "after": body.ids})
    await _recompute(db, series_id)
    return await _calendar(db, series_id)


@router.post("/admin/series/{series_id}/rounds/sort-by-date")
@reference_series.series_locked
async def sort_rounds_by_date(series_id: str, body: Optional[RoundSortBody] = None,
                              me: dict = Depends(require_area("content"))):
    """Reihenfolge nach Tag und Uhrzeit; Termine ohne Tag ans Ende, sonst bleibt die bisherige Reihenfolge."""
    db = get_db()
    await _series(db, series_id)
    rounds = await db.reference_rounds.find({"series_id": series_id, "archived_at": None}, {"_id": 0}).to_list(None)
    rounds.sort(key=lambda item: (item.get("club_day") is None, item.get("club_day") or "",
                                  item.get("starts_at") or "", item.get("order") or 0, str(item.get("id"))))
    before = [item["id"] for item in ordered_rounds(rounds)]
    after = [item["id"] for item in rounds]
    await _claim(db, series_id, body.expected_version if body else None)
    await _write_order(db, series_id, after, me)
    await _log(db, "reference_round.sort", me, series_id, {"before": before, "after": after})
    await _recompute(db, series_id)
    return await _calendar(db, series_id)


@router.post("/admin/series/{series_id}/rounds/paste")
@reference_series.series_locked
async def paste_rounds(series_id: str, body: RoundPasteBody, me: dict = Depends(require_area("content"))):
    """Eingefügte Terminliste: ohne ``apply`` nur die Vorschau, mit ``apply`` werden die Termine angehängt - nur, wenn
    keine Zeile einen Fehler hat (sonst 422 mit den Fehlern je Zeile)."""
    db = get_db()
    series = await _series(db, series_id)
    parsed = parse_round_lines(body.text, season=series.get("season"), today=club_today(),
                               default_weekday=series.get("default_weekday"),
                               default_time=series.get("default_time"))
    if not body.apply:
        return parsed
    if parsed["errors"] or not parsed["rows"]:
        raise HTTPException(422, {"message": "Die Liste hat Fehler." if parsed["errors"] else "Die Liste ist leer.",
                                  "errors": parsed["errors"]})
    order = await _claim(db, series_id, body.expected_version, orders=len(parsed["rows"]))
    docs = [_new_round(series_id, me, order=order + offset, code=row["code"], venue=row["venue"],
                       club_day=row["day"], starts_at=row["starts_at"], source="paste")
            for offset, row in enumerate(parsed["rows"])]
    await db.reference_rounds.insert_many(docs)
    await _log(db, "reference_round.paste", me, series_id, {"count": len(docs), "round_ids": [doc["id"] for doc in docs],
                                                         "codes": [doc["code"] for doc in docs]})
    await _recompute(db, series_id)
    return {"created": len(docs), **await _calendar(db, series_id)}


# ---------------------------------------------------------------- Öffentlich
async def visible_series(db, user: dict | None, lineage_slug: str, season_slug: str) -> tuple[dict, dict]:
    """Spur und Serie zu einer öffentlichen Adresse (auch alte Adressen) - 404, wenn eine von beiden archiviert oder für
    ``user`` nicht sichtbar ist. Die Sichtbarkeit der Serie gilt auch für Termine und Tabellen."""
    lineage = await db.reference_lineages.find_one(
        {"$or": [{"slug": lineage_slug}, {"slug_history": lineage_slug}]}, {"_id": 0})
    if not lineage or lineage.get("is_archived") or not await user_can_see(user, lineage.get("visibility")):
        raise HTTPException(404, "Serie nicht gefunden.")
    series = await db.reference_series.find_one(
        {"lineage_id": lineage["id"], "$or": [{"season_slug": season_slug}, {"season_slug_history": season_slug}]},
        {"_id": 0})
    if not series or series.get("status") == "archived" or not await user_can_see(user, series.get("visibility")):
        raise HTTPException(404, "Serie nicht gefunden.")
    return lineage, series


@router.get("/public/{lineage_slug}/{season_slug}/calendar")
async def public_calendar(lineage_slug: str, season_slug: str, user: dict | None = Depends(get_optional_user)):
    """Termine einer Saison für die Serienseite: ohne Notizen, ohne archivierte Termine."""
    db = get_db()
    lineage, series = await visible_series(db, user, lineage_slug, season_slug)
    calendar = await _calendar(db, series["id"])
    return {
        "lineage": {key: lineage.get(key) for key in ("title", "slug", "kind", "label", "organizer")},
        "series": {key: series.get(key) for key in ("season", "tier", "title", "season_slug", "status",
                                                    "default_weekday", "default_time")},
        "today": calendar["today"],
        "counts": calendar["counts"],
        "rounds": [{key: item.get(key) for key in PUBLIC_FIELDS} for item in calendar["rounds"]],
    }
