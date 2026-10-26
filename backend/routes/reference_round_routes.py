"""Externe Serien - Kalender (#1742): Termine anlegen, einfügen, verschieben und absagen, „Ergebnis fehlt“.

Bereich Redaktion („content“). Ein Termin hat einen Wiener Tag (``club_day``) und, mit Uhrzeit, einen Zeitpunkt in UTC
(``starts_at``); ohne eigene Uhrzeit gilt die Standard-Uhrzeit der Serie. Gespeichert sind nur geplant, gewertet,
abgesagt und verschoben - „heute“ und „Ergebnis fehlt“ rechnet ``services/reference_calendar.py`` beim Lesen aus dem
Wiener Tag (``club_today()``). Verschieben hält den ursprünglichen Termin fest (``original_starts_at`` und
``original_club_day``, beim ersten Verschieben gesetzt und danach behalten), Absagen merkt sich den Status davor.
Gelöscht wird nichts: Termine werden archiviert. Nach jeder Änderung rechnet der Server die Stände der Serie neu
(abgesagte Runden zählen nicht zur Rundenzahl, ``counts`` nimmt eine Runde aus der Wertung). Jede Änderung läuft unter
der Sperre der Saison, wie das Eintragen der Ergebnisse (``reference_series.series_locked``, #1744).

Runde mit Läufen (#1930): Ein Termin trägt seinen Lauf (``session``, leer heißt Rennen); mit Läufen sind Termine mit
gleichem Kürzel eine Runde (``weekend``, ``services/race_weekend.py``). Die Wertung (``counts``) folgt der Vorgabe des
Laufs, bis sie jemand am Termin von Hand setzt (``counts_manual``; ``counts: null`` gibt sie zurück). Eine eingefügte
Zeile ohne Lauf legt alle Läufe an, die die Saison für diese Runde vorgibt („Ablauf je Runde“).

Öffentlich: ``/api/reference-series/public/<spur>/<saison>/calendar`` - nur, wenn Spur und Serie sichtbar und nicht
archiviert sind, ohne Notizen. Die Felder (Titel, Ort, Tag, Zeitpunkt, Status) sind so gewählt, dass der Vereinskalender
(``calendar_items``, Stufe 2, #1752) sie später übernehmen kann.

Team-Liga (#1931): ein Termin nennt den Gegner (``opponent``), ob das eigene Team daheim spielt (``at_home``: wahr,
falsch oder offen) und optional das Ende des Spieltags (``club_day_end``, Wiener Tag, nicht vor dem Tag) - die
eingefügte Liste liest beides aus „vs Team X“, „@ Team X“ und „13.05.–17.05.“. Verschieben nimmt den Zeitraum weg:
der neue Tag ist ein fester Termin.
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
from services import race_weekend, race_weekend_paste, reference_running_cache, reference_series, series_kinds
from services.dolibarr_policy import club_today
from services.round_countries import detect_country
from services.series_standings import ordered_rounds
from services.reference_calendar import (
    ClockError, calendar_view, clock_gap_message, club_day_of, missing_codes, parse_round_lines, planned_status,
    vienna_clock, vienna_start,
)
from services.reference_series_access import SeriesAccess, require_series_editor
from services.visibility import user_can_see

# Jeder schreibende Aufruf leert den Cache der laufenden Saisons (#1753, Startseite).
router = APIRouter(prefix="/api/reference-series", tags=["reference-series"],
                   dependencies=[Depends(reference_running_cache.reset_after_write)])

PUBLIC_FIELDS = ("id", "position", "code", "title", "venue", "starts_at", "club_day", "time", "state", "status",
                 "original_starts_at", "original_club_day", "kind", "counts", "opponent", "country_code",
                 "session", "session_kind", "weekend", "at_home", "club_day_end", "no_score_reason",
                 "no_score_note")


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

    @field_validator("day_end", check_fields=False)
    @classmethod
    def _check_day_end(cls, value):
        return _day(value)


class _Versioned(BaseModel):
    """``expected_version``: der Stand des Kalenders, den die Seite kennt (``version`` aus dem Kalender). Hat ihn
    inzwischen jemand anderes geändert, gibt es 409 statt eines stillen Überschreibens."""
    expected_version: Optional[int] = Field(default=None, ge=0)


class RoundCreateBody(_DayTime, _Versioned, ReferenceRoundCreate):
    """Termin anlegen: Wiener Tag und Uhrzeit. Ohne ``time`` gilt die Standard-Uhrzeit der Serie, ``time: null`` heißt
    ausdrücklich „ohne Uhrzeit“."""
    day: Optional[str] = None
    time: Optional[str] = None
    at_home: Optional[bool] = None  # Team-Liga (#1931): daheim, auswärts oder offen
    day_end: Optional[str] = None  # letzter Tag des Spieltags (#1931)


class RoundUpdateBody(_DayTime, _Versioned, ReferenceRoundUpdate):
    day: Optional[str] = None
    time: Optional[str] = None
    at_home: Optional[bool] = None
    day_end: Optional[str] = None


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


class RoundDateItem(_DayTime):
    """Ein Termin ohne Datum bekommt seinen Tag (#2024) - ohne Uhrzeit gilt die gemerkte."""
    id: str = Field(max_length=80)
    day: str
    time: Optional[str] = None


class RoundDatesBody(_Versioned):
    """Datum nachtragen für mehrere offene Termine auf einmal (#2024, Sammelansicht)."""
    items: List[RoundDateItem] = Field(min_length=1, max_length=200)


class RoundFillBody(_Versioned):
    """Fehlende Termine anlegen (#2015): ohne ``apply`` nur, was angelegt würde."""
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


async def _kind(db, series: dict) -> str | None:
    lineage = await db.reference_lineages.find_one({"id": series.get("lineage_id")}, {"_id": 0, "kind": 1}) or {}
    return lineage.get("kind")


# Art-Profil (#2024): Felder eines Termins, die es nur bei manchen Arten gibt - samt ihrem Schalter im Profil.
KIND_ROUND_FIELDS = (("venue", "venue"), ("country_code", "country"), ("session", "session"),
                     ("opponent", "opponent"))


def _without_kind_fields(kind: str | None, raw: dict) -> dict:
    """Was die Art nicht kennt, nimmt der Server nicht an (#2024): bei einer Turnierserie kein Ort, kein Land, kein Lauf
    und kein Gegner. Still übergangen statt 422 - ältere Formulare und die heutige App schicken die Felder noch mit
    (leer oder mit altem Wert), und dafür soll niemand eine Fehlermeldung sehen. Gespeichert wird so nichts davon."""
    out = dict(raw)
    for key, field in KIND_ROUND_FIELDS:
        if not series_kinds.shows(kind, field):
            out.pop(key, None)
            if field == "country":
                out.pop("country_auto", None)
    return out


def public_round(item: dict, kind: str | None, fields=PUBLIC_FIELDS) -> dict:
    """Ein Termin für öffentliche Seiten: ``fields`` - was die Art nicht kennt (#2024), ist leer. So zeigt auch eine
    ältere Oberfläche (die heutige App) bei einer Turnierserie keinen alten Ort und keine Flagge mehr; die Schlüssel
    bleiben."""
    out = {key: item.get(key) for key in fields}
    for key, field in KIND_ROUND_FIELDS:
        if key in out and not series_kinds.shows(kind, field):
            out[key] = None
    return out


def _text(value) -> Optional[str]:
    return (value or "").strip() or None


def _when(day: Optional[str], clock: Optional[str]) -> dict:
    try:
        return {"club_day": day, "starts_at": vienna_start(day, clock)}
    except ClockError:
        raise HTTPException(422, clock_gap_message(day, clock)) from None


def _country(auto: bool, code: Optional[str], venue: Optional[str], title: Optional[str]) -> dict:
    """Land des Termins (#1925): automatisch aus Ort bzw. Strecke, sonst aus dem Titel - oder wie von Hand gewählt."""
    return {"country_code": detect_country(venue, title) if auto else code, "country_auto": bool(auto)}


WINDOW_BEFORE = "Der Spieltag kann nicht vor seinem ersten Tag enden."


def _window(day: Optional[str], end: Optional[str]) -> Optional[str]:
    """Ende des Spieltags (#1931): nie vor dem Tag; ohne Tag oder gleich dem Tag gibt es keinen Zeitraum."""
    if not end or not day or end == day:
        return None
    if end < day:
        raise HTTPException(422, WINDOW_BEFORE)
    return end


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
    out = {key: doc.get(key) for key in ("code", "session", "title", "venue", "club_day", "starts_at", "order",
                                         "opponent", "country_code", "at_home", "club_day_end")
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
        # #1930: ``counts`` folgt der Vorgabe des Laufs, bis jemand sie am Termin von Hand setzt.
        "counts_manual": False,
        "opponent": None, "note": None, "country_code": None, "country_auto": True, "session": None,
        # #1960: Termin ohne Wertung mit Grund - öffentlich, unterschieden von „abgesagt“.
        "no_score_reason": None, "no_score_note": None,
        "source": "manual",
        "archived_at": None, "at_home": None, "club_day_end": None,
        # #2015: Termin offen - die Uhrzeit, bis das Datum nachgetragen ist (dann gilt ``starts_at``).
        "open_time": None,
        "created_at": now, "created_by": me["id"], **_stamp(me), **fields,
    }


async def _calendar(db, series_id: str) -> dict:
    series = await db.reference_series.find_one(
        {"id": series_id}, {"_id": 0, "calendar_version": 1, "weekend": 1, "planned_rounds": 1}) or {}
    rounds = await db.reference_rounds.find({"series_id": series_id}, {"_id": 0}).to_list(None)
    published = [row["round_id"] async for row in db.reference_round_results.find(
        {"series_id": series_id, "status": "published"}, {"_id": 0, "round_id": 1})]
    today = club_today()
    view = calendar_view(rounds, published, today)
    archived = sorted((item for item in rounds if item.get("archived_at")),
                      key=lambda item: (item.get("order") or 0, str(item.get("id"))))
    # Runde und Art des Laufs (#1930): Termine mit gleichem Kürzel sind eine Runde mit Läufen.
    race_weekend.annotate([*view["rounds"], *archived], series.get("weekend"))
    for item in [*view["rounds"], *archived]:
        # Termin offen (#2015): ohne Tag die gemerkte Uhrzeit.
        item["time"] = vienna_clock(item.get("starts_at")) or (None if item.get("club_day") else item.get("open_time"))
    return {"today": today, "version": int(series.get("calendar_version") or 0), **view, "archived": archived,
            # #2015: geplante Termine gegen den Kalender - für „fehlende Termine anlegen“.
            "planned": planned_status(rounds, series.get("planned_rounds"), series.get("weekend"))}


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
    clock = body.time if "time" in body.model_fields_set else series.get("default_time")
    if body.day:
        when = _when(body.day, clock)
    else:
        when = _when_from_instant(body.starts_at)
    window_end = _window(when["club_day"], body.day_end)
    first = await _claim(db, series_id, body.expected_version, orders=1)
    # Ohne ausdrückliche Angabe gilt die Vorgabe des Laufs (#1930): ein Qualifying zählt nicht - außer es hat Punkte.
    # Ein Grund „ohne Wertung“ (#1960) nimmt den Termin aus der Wertung.
    manual = "counts" in body.model_fields_set or bool(body.no_score_reason)
    if body.no_score_reason:
        counts = False
    elif manual:
        counts = body.counts
    else:
        existing = await db.reference_rounds.find({"series_id": series_id}, {"_id": 0}).to_list(None)
        counts = race_weekend.planned_config(series.get("weekend"), existing, body.code, body.session)["counts"]
    # Was die Art nicht kennt (#2024), bleibt leer - eine Turnierserie hat weder Ort noch Flagge.
    kind = await _kind(db, series)
    given = _without_kind_fields(kind, {"venue": _text(body.venue), "session": body.session,
                                        "opponent": _text(body.opponent), "country_code": body.country_code})
    country = (_country(body.country_auto, body.country_code, given.get("venue"), _text(body.title))
               if "country_code" in given else {"country_code": None, "country_auto": True})
    # Die Nummer vergibt immer die Folge - ein mitgeschicktes ``order`` zählt nicht (Reihenfolge nur über Ordnen).
    doc = _new_round(series_id, me, order=first, code=_text(body.code), session=given.get("session"),
                     title=_text(body.title), venue=given.get("venue"), **when, kind=body.kind, counts=counts,
                     counts_manual=manual, no_score_reason=body.no_score_reason,
                     no_score_note=_text(body.no_score_note) if body.no_score_reason else None,
                     opponent=given.get("opponent"), note=_text(body.note), at_home=body.at_home,
                     club_day_end=window_end, open_time=None if when["club_day"] else clock, **country)
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
    series = await _series(db, series_id)
    existing = await _round(db, series_id, round_id)
    kind = await _kind(db, series)
    raw = _without_kind_fields(kind, body.model_dump(exclude_unset=True))
    if "order" in raw:
        raise HTTPException(422, "Die Reihenfolge ändern „Ordnen“ und „Nach Datum ordnen“.")
    if "status" in raw or "original_starts_at" in raw:
        raise HTTPException(422, "Den Status ändern Verschieben, Absagen und das Ergebnis.")
    updates: dict = {key: _text(raw[key]) for key in ("code", "session", "title", "venue", "opponent", "note")
                     if key in raw}
    updates.update({key: raw[key] for key in ("kind",) if raw.get(key) is not None})
    # Wertung (#1930): von Hand gesetzt bleibt sie; ``counts: null`` gibt sie an die Vorgabe des Laufs zurück (das
    # Neurechnen gleicht sie dann an).
    if "counts" in raw:
        updates.update({"counts": raw["counts"], "counts_manual": True} if raw["counts"] is not None
                       else {"counts_manual": False})
        if raw["counts"] is not False:
            updates.update({"no_score_reason": None, "no_score_note": None})
    # Ohne Wertung mit Grund (#1960): der Grund nimmt den Termin aus der Wertung; ohne Grund kein Text.
    if "no_score_reason" in raw:
        updates["no_score_reason"] = raw["no_score_reason"]
        if raw["no_score_reason"]:
            updates.update({"counts": False, "counts_manual": True})
        else:
            updates["no_score_note"] = None
    reason = updates["no_score_reason"] if "no_score_reason" in updates else existing.get("no_score_reason")
    if "no_score_note" in raw and reason:
        updates["no_score_note"] = _text(raw["no_score_note"])
    if "day" in raw or "time" in raw:
        day = raw["day"] if "day" in raw else existing.get("club_day")
        clock = raw["time"] if "time" in raw else (vienna_clock(existing.get("starts_at")) or existing.get("open_time"))
        updates.update(_when(day, clock))
        # Termin offen (#2015): ohne Tag bleibt die Uhrzeit gemerkt, mit Tag gilt der Zeitpunkt.
        if not day or existing.get("open_time"):
            updates["open_time"] = None if day else clock
    elif "starts_at" in raw:
        updates.update(_when_from_instant(raw["starts_at"]))
    # Datum nachgetragen (#2015): ein offener Termin rückt vor den ersten offenen bzw. späteren Termin.
    reorder = (await _dated_order(db, series_id, round_id, updates["club_day"])
               if not existing.get("club_day") and updates.get("club_day") else None)
    if "at_home" in raw:
        updates["at_home"] = raw["at_home"]
    if "day_end" in raw or ("club_day" in updates and existing.get("club_day_end")):
        # Spieltag-Zeitraum (#1931): ein neuer Tag nach dem Ende passt nicht - erst das Ende ändern.
        day = updates["club_day"] if "club_day" in updates else existing.get("club_day")
        updates["club_day_end"] = _window(day, raw["day_end"] if "day_end" in raw else existing.get("club_day_end"))
    # Land (#1925): eine Wahl im Termin gilt; ohne Wahl folgt ein automatisches Land einer neuen Strecke bzw. einem neuen
    # Titel - ein von Hand gewähltes bleibt.
    venue = updates["venue"] if "venue" in updates else existing.get("venue")
    title = updates["title"] if "title" in updates else existing.get("title")
    country = None
    if "country_auto" in raw or "country_code" in raw:
        auto = raw.get("country_auto")
        if auto is None:
            auto = "country_code" not in raw and existing.get("country_auto") is not False
        code = raw["country_code"] if "country_code" in raw else existing.get("country_code")
        country = _country(auto, code, venue, title)
    elif (("venue" in updates or "title" in updates) and existing.get("country_auto") is not False
          and series_kinds.shows(kind, "country")):
        country = _country(True, None, venue, title)
    current = {"country_code": existing.get("country_code"), "country_auto": existing.get("country_auto") is not False}
    updates.update({key: value for key, value in (country or {}).items() if value != current[key]})
    await _claim(db, series_id, body.expected_version)
    await db.reference_rounds.update_one({"id": round_id}, {"$set": {**updates, **_stamp(me)}})
    if reorder:
        await _write_order(db, series_id, reorder, me)
    await _log(db, "reference_round.update", me, series_id, {
        "round_id": round_id, "before": {key: existing.get(key) for key in updates}, "after": updates,
        **({"order": reorder} if reorder else {})})
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
        "club_day_end": None,  # verschoben ist ein fester Tag, kein Zeitraum mehr (#1931)
        "open_time": None,  # mit Tag gilt der Zeitpunkt (#2015)
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


async def _dated_order(db, series_id: str, round_id: str, day: str) -> list[str] | None:
    """Reihenfolge, wenn ein offener Termin sein Datum bekommt (#2015): er rückt vor den ersten Termin, der offen ist
    oder später liegt - Termine ohne Datum stehen hinten. ``None``, wenn er schon richtig steht."""
    rounds = await db.reference_rounds.find({"series_id": series_id, "archived_at": None}, {"_id": 0}).to_list(None)
    ids = [item["id"] for item in ordered_rounds(rounds)]
    by_id = {item["id"]: item for item in rounds}
    rest = [rid for rid in ids if rid != round_id]
    at = next((index for index, rid in enumerate(rest)
               if not by_id[rid].get("club_day") or by_id[rid]["club_day"] > day), len(rest))
    after = [*rest[:at], round_id, *rest[at:]]
    return after if after != ids else None


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
    # Art-Profil (#2024): bei der Turnierserie ohne Ort, Land und Gegner, eine Zeile ohne Datum ist ein offener Termin.
    parsed = parse_round_lines(body.text, season=series.get("season"), today=club_today(),
                               default_weekday=series.get("default_weekday"),
                               default_time=series.get("default_time"), kind=await _kind(db, series))
    # Ablauf je Runde (#1930): eine Zeile ohne Lauf legt alle Läufe an, die die Saison für ihre Runde vorgibt.
    existing = await db.reference_rounds.find({"series_id": series_id}, {"_id": 0}).to_list(None)
    parsed = race_weekend_paste.expand_paste(parsed, series.get("weekend"), existing)
    if not body.apply:
        return parsed
    if parsed["errors"] or not parsed["rows"]:
        raise HTTPException(422, {"message": "Die Liste hat Fehler." if parsed["errors"] else "Die Liste ist leer.",
                                  "errors": parsed["errors"]})
    order = await _claim(db, series_id, body.expected_version, orders=parsed["count"])
    planned = [(row, item) for row in parsed["rows"] for item in row["sessions"]]
    # Team-Liga (#1931): Gegner, Heim/Auswärts und Spieltag-Zeitraum aus der Zeile - der Zeitraum nur, wenn er nicht
    # vor dem Tag des Laufs endet.
    # Termin offen (#2015): ohne Tag kein Zeitpunkt - die Uhrzeit bleibt als ``open_time`` für das spätere Datum.
    docs = [_new_round(series_id, me, order=order + offset, code=row["code"], session=item["session"],
                       venue=row["venue"], club_day=item["day"], starts_at=item["starts_at"], counts=item["counts"],
                       source="paste", country_code=row["country_code"], country_auto=True,
                       opponent=row.get("opponent"), at_home=row.get("at_home"),
                       club_day_end=row["day_end"] if item["day"] and (row.get("day_end") or "") >= item["day"]
                       else None,
                       open_time=None if item["day"] else item.get("time"))
            for offset, (row, item) in enumerate(planned)]
    await db.reference_rounds.insert_many(docs)
    await _log(db, "reference_round.paste", me, series_id, {"count": len(docs), "round_ids": [doc["id"] for doc in docs],
                                                         "codes": [doc["code"] for doc in docs]})
    await _recompute(db, series_id)
    return {"created": len(docs), **await _calendar(db, series_id)}


HAS_DAY = "{code} hat schon ein Datum – einen festen Termin ändert „Verschieben“."


@router.post("/admin/series/{series_id}/rounds/dates")
@reference_series.series_locked
async def fill_round_dates(series_id: str, body: RoundDatesBody, me: dict = Depends(require_area("content"))):
    """Datum nachtragen (#2024): mehrere Termine ohne Datum bekommen ihren Tag in einem Vorgang - mit Uhrzeit oder der
    gemerkten (``open_time``). Jeder rückt vor die offenen bzw. späteren Termine wie beim einzelnen Nachtragen. Nur für
    Termine ohne Datum - ein fester Termin wird verschoben, nicht hier geändert (422). Ein Stand, ein Protokolleintrag,
    einmal neu rechnen."""
    db = get_db()
    await _series(db, series_id)
    ids = [item.id for item in body.items]
    if len(set(ids)) != len(ids):
        raise HTTPException(422, "Jeder Termin nur einmal.")
    found = {item["id"]: item async for item in db.reference_rounds.find(
        {"series_id": series_id, "id": {"$in": ids}, "archived_at": None}, {"_id": 0})}
    changes = []
    for item in body.items:
        existing = found.get(item.id)
        if not existing:
            raise HTTPException(404, "Termin nicht gefunden.")
        if existing.get("club_day"):
            raise HTTPException(422, HAS_DAY.format(code=existing.get("code") or "Der Termin"))
        clock = item.time if item.time else existing.get("open_time")
        changes.append((existing, {**_when(item.day, clock), "open_time": None}))
    await _claim(db, series_id, body.expected_version)
    for existing, update in changes:
        await db.reference_rounds.update_one({"id": existing["id"]}, {"$set": {**update, **_stamp(me)}})
    # Einsortieren in der Reihenfolge der Tage: so stehen mehrere neue Termine auch untereinander richtig.
    for existing, update in sorted(changes, key=lambda pair: (pair[1]["club_day"], pair[1]["starts_at"] or "")):
        order = await _dated_order(db, series_id, existing["id"], update["club_day"])
        if order:
            await _write_order(db, series_id, order, me)
    await _log(db, "reference_round.dates", me, series_id, {"items": [
        {"round_id": existing["id"], "code": existing.get("code"), "club_day": update["club_day"],
         "starts_at": update["starts_at"]} for existing, update in changes]})
    await _recompute(db, series_id)
    return await _calendar(db, series_id)


@router.post("/admin/series/{series_id}/rounds/fill-planned")
@reference_series.series_locked
async def fill_planned_rounds(series_id: str, body: Optional[RoundFillBody] = None,
                              me: dict = Depends(require_area("content"))):
    """Fehlende Termine anlegen (#2015): bis zur Zahl der geplanten Termine (``planned_rounds``) kommen Termine ohne
    Datum („Termin offen“) mit den nächsten Kürzeln dazu - nach „T4“ also T5 … T9, ohne Kürzel mit Zahl „T“ bzw. bei
    der Rennliga „R“. Uhrzeit: die Standard-Uhrzeit, bis das Datum nachgetragen ist. Ohne ``apply`` nur die Vorschau."""
    db = get_db()
    series = await _series(db, series_id)
    rounds = await db.reference_rounds.find({"series_id": series_id}, {"_id": 0}).to_list(None)
    status = planned_status(rounds, series.get("planned_rounds"), series.get("weekend"))
    if status is None:
        raise HTTPException(422, "Die Saison hat keine geplante Zahl an Terminen – erst in der Saison eintragen.")
    # Vorsatz der Kürzel aus dem Art-Profil (#2024): „R“ bei der Rennliga, sonst „T“.
    codes = missing_codes(rounds, status["missing"], series_kinds.word(await _kind(db, series), "code_prefix"))
    if not (body and body.apply):
        return {**status, "codes": codes}
    if not codes:
        return {"created": 0, "codes": [], **await _calendar(db, series_id)}
    first = await _claim(db, series_id, body.expected_version, orders=len(codes))
    docs = [_new_round(series_id, me, order=first + offset, code=code, source="planned",
                       open_time=series.get("default_time"))
            for offset, code in enumerate(codes)]
    await db.reference_rounds.insert_many(docs)
    await _log(db, "reference_round.fill_planned", me, series_id, {
        "count": len(docs), "round_ids": [doc["id"] for doc in docs], "codes": codes,
        "planned": status["planned"]})
    await _recompute(db, series_id)
    return {"created": len(docs), "codes": codes, **await _calendar(db, series_id)}


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
        "rounds": [public_round(item, lineage.get("kind")) for item in calendar["rounds"]],
    }
