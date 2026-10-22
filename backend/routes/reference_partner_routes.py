"""Externe Serien - Partner-Plattform anbinden (#1964): Turniertage samt Runden, Lobbys und Punkten von der Plattform
des Partners holen und als **Entwurf** übernehmen. Nur der Vorstand (Bereich Redaktion), je Saison.

Alle Pfade unter ``/api/reference-series/admin/series/{series_id}/partner-source``:

- ``GET`` - die Quelle der Saison (``source`` oder ``null``), die Plattformen mit ihren erlaubten Adressen
  (``choices``, feste Positivliste in ``services/partner_platforms.py``) und die Partner der Saison (#1934) für den
  Hinweis „Daten von …“ auf der Serienseite.
- ``PUT`` - Quelle setzen: ``{platform, base_url, series_ref, series_name?, partner_id?}``; ``platform: null`` schaltet
  ab. Eine Adresse außerhalb der Liste, eine Kennung, die nicht nur aus Ziffern besteht, oder ein Partner, der nicht zur
  Saison gehört: 422. Protokoll ``reference_series.partner_source``.
- ``GET …/series?platform=&base_url=`` - die Serien beim Partner zur Auswahl.
- ``POST …/preview`` - „Jetzt holen“: holt die Turniere der Serie und rechnet je Turnier, was Übernehmen täte -
  **schreibt nichts**. Je Turnier ``ref``, ``name``, ``club_day``, ``double_up``, ``finished``, ``fingerprint``,
  ``action`` (``linked`` = schon verknüpfter Termin, ``assign`` = Termin am selben Tag, ``new`` = neuer Termin),
  ``round``, ``sheet`` (Status, Version, Entwurf daneben), ``expected_version``, ``target`` (``sheet`` = neues Blatt,
  ``draft`` = Entwurf ersetzen, ``pending_draft`` = Entwurf neben dem veröffentlichten Blatt), ``state``
  (``new``, ``changed``, ``same``, ``new_round``, ``link``, ``waiting``, ``error``), ``changes`` (Abweichungen je
  Person), ``counts`` (Spieler, Runden, Lobbys, Bots, Gäste), ``unknown_names`` (wie in der Vorschau des Blatts),
  ``errors``, ``warnings`` und ``error`` (Abruf dieses Turniers gescheitert).
- ``POST …/apply`` - ``{items: [{ref, fingerprint, expected_version, round_id}]}``: übernimmt genau, was die Vorschau
  gezeigt hat. Je Turnier ``status``: ``saved`` (Entwurf geschrieben), ``round`` (nur Termin angelegt bzw. verknüpft),
  ``same`` (nichts zu tun), ``conflict`` (Daten beim Partner, Termin oder Blatt haben sich seit der Vorschau geändert -
  nichts geschrieben) oder ``error``.

**Regeln:** Ergebnisse werden nie veröffentlicht. Ein neues Blatt ist ein Entwurf, ein vorhandener Entwurf wird nur mit
der Version aus der Vorschau ersetzt (Revision bleibt), neben einem veröffentlichten Blatt entsteht ein Entwurf daneben,
den der Vorstand wie gewohnt freigibt. Sonderboni, Notizen und Punkte von Hand bleiben (``partner_import.carry_over``).
Unbekannte Namen werden offene Teilnehmer (Dialog „Unbekannte Namen“, #1743). Geholt wird vor der Sperre der Saison,
geschrieben darunter (``reference_series.series_write``) - ein langsamer Partner hält keine andere Änderung auf.

**Fehler** der Quelle stoppen nur den Abruf: 502 mit fester Meldung (steht damit im Betriebsprotokoll); ein einzelnes
kaputtes Turnier nur seine eigene Zeile. Abrufe zählen je Konto (``rate_limit``, ``FETCH_LIMIT`` je ``FETCH_WINDOW``).
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, ValidationError

from database import get_db
from models import new_id, now_utc
from routes import reference_result_routes as results
from routes.reference_round_routes import _brief, _claim, _country, _new_round, _when
from services import (
    partner_import, partner_platforms, race_weekend, reference_running_cache, reference_series, series_partners,
    series_results, tft_dashboard,
)
from services.rate_limit import enforce_rate_limit, keyed_subject
from services.reference_series_access import SeriesAccess, require_series_editor
from services.series_participants import remove_unused_new
from services.series_standings import ordered_rounds

router = APIRouter(prefix="/api/reference-series", tags=["reference-series"],
                   dependencies=[Depends(reference_running_cache.reset_after_write)])

BASE = "/admin/series/{series_id}/partner-source"
FETCH_LIMIT = 30
FETCH_WINDOW = 600
MAX_TOURNAMENTS = 40
NO_SOURCE = "Für diese Saison ist keine Partner-Plattform eingestellt."
NO_PLATFORM = "Diese Partner-Plattform gibt es nicht."
NO_SERIES = "Bitte die Serie beim Partner wählen."
NO_PARTNER = "Dieser Partner gehört nicht zur Saison - bitte erst unter Partner der Saison verknüpfen."
TOO_MANY = "Zu viele Abrufe bei der Partner-Plattform. Bitte warte noch {wait}."
CHANGED = "Seit der Vorschau hat sich etwas geändert – bitte neu holen."
SELECTABLE = ("new", "changed", "new_round", "link")


# ---------------------------------------------------------------- Vertrag
class PartnerSourceBody(BaseModel):
    platform: Optional[str] = Field(default=None, max_length=40)
    base_url: Optional[str] = Field(default=None, max_length=200)
    series_ref: Optional[str] = Field(default=None, max_length=20)
    series_name: Optional[str] = Field(default=None, max_length=160)
    partner_id: Optional[str] = Field(default=None, max_length=80)


class PartnerApplyItem(BaseModel):
    ref: str = Field(min_length=1, max_length=20)
    fingerprint: str = Field(min_length=1, max_length=32)
    expected_version: int = Field(default=0, ge=0)
    round_id: Optional[str] = Field(default=None, max_length=80)


class PartnerApplyBody(BaseModel):
    items: List[PartnerApplyItem] = Field(min_length=1, max_length=MAX_TOURNAMENTS)


# ---------------------------------------------------------------- Hilfen
def _source(access: SeriesAccess) -> dict:
    source = access.series.get("partner_source")
    if not isinstance(source, dict) or not partner_platforms.platform(source.get("platform")):
        raise HTTPException(409, NO_SOURCE)
    return source


async def _limit(request: Request, access: SeriesAccess) -> None:
    await enforce_rate_limit(request, "partner_fetch", FETCH_LIMIT, FETCH_WINDOW,
                             subject=keyed_subject(access.user["id"]), message=TOO_MANY)


async def _season_partners(db, series: dict) -> list[dict]:
    lineage = await db.reference_lineages.find_one({"id": series.get("lineage_id")}, {"_id": 0}) or {}
    pairs = series_partners.effective(lineage, series)
    badges = await series_partners.badges(db, [pid for pid, _ in pairs])
    return [{"id": pid, "name": badges[pid].get("name"), "role": role} for pid, role in pairs if pid in badges]


def _round_view(round_doc: dict | None, positions: dict[str, int]) -> dict | None:
    if not round_doc:
        return None
    return {**{key: round_doc.get(key) for key in ("id", "code", "title", "club_day", "status")},
            "position": positions.get(round_doc["id"])}


def _positions(rounds: list[dict]) -> dict[str, int]:
    active = [item for item in rounds if not item.get("archived_at")]
    return {item["id"]: index for index, item in enumerate(ordered_rounds(active), start=1)}


def _provisional(series_id: str, summary: dict) -> dict:
    """Ein Termin, den es noch nicht gibt - nur zum Prüfen in der Vorschau."""
    return {"id": f"partner:{summary['ref']}", "series_id": series_id, "club_day": summary.get("club_day"),
            "status": "planned", "kind": "regular", "counts": True, "archived_at": None, "order": 10 ** 6,
            "code": None, "session": None, "title": summary.get("name")}


def _sheet_input(detail: dict) -> results.ResultSheetInput:
    try:
        return results.ResultSheetInput(rows=detail["rows"], double_up=detail["double_up"])
    except ValidationError:
        raise partner_platforms.SourceError(partner_platforms.FORMAT_MESSAGE) from None


def _base_content(existing: dict | None) -> dict | None:
    """Womit die Übernahme verglichen wird: ein Entwurf daneben, sonst das Blatt."""
    if not existing:
        return None
    return existing.get("pending_draft") or existing


def _target(existing: dict | None) -> str:
    if not existing:
        return "sheet"
    return "pending_draft" if existing.get("status") == "published" else "draft"


async def _tournaments(source: dict) -> list[dict]:
    try:
        days = await partner_platforms.series_tournaments(source["platform"], source.get("base_url"),
                                                          source.get("series_ref"))
    except partner_platforms.SourceError as error:
        raise HTTPException(502, str(error)) from None
    return days[:MAX_TOURNAMENTS]


async def _details(source: dict, days: list[dict], wanted: set[str] | None = None) -> dict[str, dict | str]:
    """Je fertigem Turnier der Turniertag - oder die Meldung, warum er nicht kam."""
    out: dict[str, dict | str] = {}
    for day in days:
        if not day["finished"] or (wanted is not None and day["ref"] not in wanted):
            continue
        try:
            out[day["ref"]] = await partner_platforms.tournament(source["platform"], source.get("base_url"),
                                                                 day["ref"])
        except partner_platforms.SourceError as error:
            out[day["ref"]] = str(error)
    return out


async def _resolve(db, access: SeriesAccess, round_doc: dict, detail: dict, existing: dict | None):
    """Zuordnen und prüfen wie beim Eintragen - dazu der Inhalt mit dem, was von Hand ergänzt war."""
    rules, participants, resolution = await results._prepare(db, access, round_doc, _sheet_input(detail))
    content = partner_import.carry_over(resolution.content(), _base_content(existing))
    return participants, resolution, content


def _names(participants: list[dict], resolution) -> dict[str, str]:
    names = {person["id"]: person.get("name") or "" for person in participants}
    names.update({row["participant_id"]: row["name"] for row in resolution.rows if row["participant_id"]})
    return names


def _sheet_summary(existing: dict | None) -> dict | None:
    if not existing:
        return None
    return {"status": existing.get("status"), "version": results._version(existing),
            "has_pending_draft": bool(existing.get("pending_draft"))}


# ---------------------------------------------------------------- Einstellung
@router.get(BASE)
async def get_partner_source(series_id: str, access: SeriesAccess = Depends(require_series_editor)):
    access.require_board()
    db = get_db()
    return {"source": access.series.get("partner_source"), "choices": partner_platforms.choices(),
            "partners": await _season_partners(db, access.series)}


@router.put(BASE)
async def set_partner_source(series_id: str, body: PartnerSourceBody,
                             access: SeriesAccess = Depends(require_series_editor)):
    access.require_board()
    db = get_db()
    before = access.series.get("partner_source")
    if body.platform is None:
        source = None
    else:
        if not partner_platforms.platform(body.platform):
            raise HTTPException(422, NO_PLATFORM)
        base = partner_platforms.allowed_base_url(body.platform, body.base_url)
        if base is None:
            raise HTTPException(422, partner_platforms.NOT_ALLOWED)
        if not tft_dashboard.valid_ref(body.series_ref):
            raise HTTPException(422, NO_SERIES)
        partners = {item["id"] for item in await _season_partners(db, access.series)}
        if body.partner_id and body.partner_id not in partners:
            raise HTTPException(422, NO_PARTNER)
        source = {"platform": body.platform, "base_url": base, "series_ref": body.series_ref,
                  "series_name": series_results.clean(body.series_name)[:160] or None,
                  "partner_id": body.partner_id or None,
                  "updated_at": now_utc().isoformat(), "updated_by": access.user["id"]}
    await db.reference_series.update_one({"id": series_id}, {"$set": {"partner_source": source}})
    brief = ("platform", "base_url", "series_ref", "series_name", "partner_id")
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "reference_series.partner_source", "actor_id": access.user["id"],
        "target_id": series_id, "created_at": now_utc().isoformat(),
        "data": {"before": {key: (before or {}).get(key) for key in brief} if before else None,
                 "after": {key: source.get(key) for key in brief} if source else None}})
    return {"source": source}


@router.get(BASE + "/series")
async def partner_series(series_id: str, request: Request,
                         platform: str = Query(..., max_length=40), base_url: str = Query(..., max_length=200),
                         access: SeriesAccess = Depends(require_series_editor)):
    """Die Serien beim Partner zur Auswahl - nur von einer Adresse der Liste."""
    access.require_board()
    if partner_platforms.allowed_base_url(platform, base_url) is None:
        raise HTTPException(422, partner_platforms.NOT_ALLOWED)
    await _limit(request, access)
    try:
        return {"items": await partner_platforms.series_list(platform, base_url)}
    except partner_platforms.SourceError as error:
        raise HTTPException(502, str(error)) from None


# ---------------------------------------------------------------- Vorschau
async def _preview_item(db, access: SeriesAccess, day: dict, match: dict, detail, positions) -> dict:
    round_doc = match["round"]
    item = {**{key: day[key] for key in ("ref", "name", "club_day", "double_up", "finished")},
            "action": match["action"], "round": _round_view(round_doc, positions), "sheet": None,
            "expected_version": 0, "target": None, "state": None, "changes": [], "unknown_names": [],
            "counts": None, "errors": [], "warnings": [], "error": None,
            "fingerprint": partner_import.fingerprint(day)}
    if not day["finished"]:
        item["state"] = {"new": "new_round", "assign": "link"}.get(match["action"], "waiting")
        return item
    if isinstance(detail, str):
        item.update(state="error", error=detail)
        return item
    item["fingerprint"] = partner_import.fingerprint(detail)
    item["counts"] = {"players": len(detail["rows"]), **{key: detail[key] for key in (
        "rounds", "lobbies", "bots", "guests")}}
    existing = await results._sheet(db, access.series_id, round_doc["id"]) if round_doc else None
    item.update(sheet=_sheet_summary(existing), expected_version=results._version(existing), target=_target(existing))
    try:
        participants, resolution, content = await _resolve(
            db, access, round_doc or _provisional(access.series_id, day), detail, existing)
    except partner_platforms.SourceError as error:
        item.update(state="error", error=str(error))
        return item
    item["errors"], item["warnings"] = resolution.errors, resolution.warnings
    if resolution.errors:
        item["state"] = "error"
        return item
    diff = partner_import.sheet_diff(_base_content(existing), content, _names(participants, resolution))
    item.update(state=diff["state"], changes=diff["changes"])
    item["unknown_names"], _ = await results._unknown_names(db, access, resolution)
    return item


@router.post(BASE + "/preview")
async def preview_partner_import(series_id: str, request: Request,
                                 access: SeriesAccess = Depends(require_series_editor)):
    """„Jetzt holen“: was Übernehmen je Turnier täte - speichert nichts."""
    access.require_board()
    source = _source(access)
    await _limit(request, access)
    db = get_db()
    days = await _tournaments(source)
    details = await _details(source, days)
    rounds = await db.reference_rounds.find({"series_id": series_id}, {"_id": 0}).to_list(None)
    matches = partner_import.round_matches(days, rounds, source["platform"])
    positions = _positions(rounds)
    items = [await _preview_item(db, access, day, matches[day["ref"]], details.get(day["ref"]), positions)
             for day in days]
    return {"source": {key: source.get(key) for key in ("platform", "base_url", "series_ref", "series_name")},
            "fetched_at": now_utc().isoformat(), "items": items,
            "selectable": [item["ref"] for item in items if item["state"] in SELECTABLE]}


# ---------------------------------------------------------------- Übernehmen
async def _create_round(db, access: SeriesAccess, series: dict, day: dict, ref: dict) -> dict:
    first = await _claim(db, access.series_id, None, orders=1)
    existing = await db.reference_rounds.find({"series_id": access.series_id}, {"_id": 0}).to_list(None)
    counts = race_weekend.planned_config(series.get("weekend"), existing, None, None)["counts"]
    title = series_results.clean(day.get("name"))[:160] or None
    doc = _new_round(access.series_id, access.user, order=first, title=title, code=partner_import.next_code(existing),
                     **_when(day.get("club_day"), series.get("default_time")), counts=counts, source="partner",
                     partner_ref=ref, **_country(True, None, None, title))
    await db.reference_rounds.insert_one(doc)
    doc.pop("_id", None)
    await db.audit_logs.insert_one({"id": new_id(), "action": "reference_round.create", "actor_id": access.user["id"],
                                    "target_id": access.series_id, "created_at": now_utc().isoformat(),
                                    "data": {"round_id": doc["id"], "after": _brief(doc), "source": "partner"}})
    return doc


async def _link_round(db, access: SeriesAccess, round_doc: dict, ref: dict) -> dict:
    stamp = {"updated_at": now_utc().isoformat(), "updated_by": access.user["id"]}
    await db.reference_rounds.update_one({"id": round_doc["id"], "series_id": access.series_id},
                                         {"$set": {"partner_ref": ref, **stamp}})
    await db.reference_series.update_one({"id": access.series_id}, {"$inc": {"calendar_version": 1}})
    await db.audit_logs.insert_one({"id": new_id(), "action": "reference_round.partner_link",
                                    "actor_id": access.user["id"], "target_id": access.series_id,
                                    "created_at": now_utc().isoformat(),
                                    "data": {"round_id": round_doc["id"], "partner_ref": ref}})
    return {**round_doc, "partner_ref": ref}


async def _write(db, access: SeriesAccess, round_doc: dict, existing: dict | None, resolution, content: dict,
                 expected: int, ref: dict) -> dict:
    """Den Entwurf schreiben - wie ``save_results``, nur nie veröffentlicht und nie aufs veröffentlichte Blatt."""
    created = await results._create_people(db, access, resolution)
    own = [doc["id"] for doc in created.values()]
    content = series_results.replace_new_ids(content, {key: doc["id"] for key, doc in created.items()})
    target = _target(existing)
    if target == "pending_draft":
        saved = await results._write_pending(db, access, existing, content, expected, own)
    else:
        saved = await results._write_sheet(db, access, round_doc, existing, content, "draft", expected)
    if saved is None:
        await remove_unused_new(db, access.series_id, own)
        return {"status": "conflict", "message": CHANGED}
    revision_id = None
    if target == "pending_draft" and existing.get("pending_draft"):
        revision_id = await results._revision(db, existing, kind="pending_draft", reason="replace", access=access)
    elif existing:
        revision_id = await results._revision(db, existing, kind="sheet", reason="save", access=access)
    await results._log(db, "reference_result.pending_draft" if target == "pending_draft" else "reference_result.save",
                       access, saved, {"version": saved["version"], "previous_version": results._version(existing),
                                       "status": "draft", "previous_status": (existing or {}).get("status"),
                                       "revision_id": revision_id, **results._counts(content),
                                       "created_participants": own, "source": "partner", "partner_ref": ref})
    return {"status": "saved", "target": target, "version": saved["version"],
            "created_participants": [{"id": doc["id"], "name": doc.get("name")} for doc in created.values()]}


async def _apply_item(db, access: SeriesAccess, series: dict, platform: str, wish: PartnerApplyItem, day: dict | None,
                      detail, match: dict | None) -> tuple[dict, bool]:
    """Ein Turnier übernehmen. Liefert das Ergebnis und ob ein Termin angelegt oder verknüpft wurde."""
    out = {"ref": wish.ref, "status": "same", "round_id": None}
    if day is None or match is None:
        return {**out, "status": "conflict", "message": CHANGED}, False
    round_doc = match["round"]
    if wish.round_id != (round_doc or {}).get("id"):
        return {**out, "status": "conflict", "message": CHANGED}, False
    if isinstance(detail, str):
        return {**out, "status": "error", "message": detail}, False
    expected_print = partner_import.fingerprint(detail if day["finished"] else day)
    if wish.fingerprint != expected_print:
        return {**out, "status": "conflict", "message": CHANGED}, False
    ref = {"platform": platform, "ref": day["ref"]}
    existing = await results._sheet(db, access.series_id, round_doc["id"]) if round_doc else None
    if day["finished"]:
        if results._version(existing) != wish.expected_version:
            return {**out, "status": "conflict", "message": CHANGED, "round_id": round_doc["id"]}, False
        try:
            participants, resolution, content = await _resolve(
                db, access, round_doc or _provisional(access.series_id, day), detail, existing)
        except partner_platforms.SourceError as error:
            return {**out, "status": "error", "message": str(error)}, False
        if resolution.errors:
            return {**out, "status": "error", "message": resolution.errors[0]["message"],
                    "errors": resolution.errors}, False
        if partner_import.sheet_diff(_base_content(existing), content, {})["state"] == "same":
            return {**out, "round_id": round_doc["id"]}, False
    changed_round = match["action"] != "linked"
    if match["action"] == "new":
        round_doc = await _create_round(db, access, series, day, ref)
    elif match["action"] == "assign":
        round_doc = await _link_round(db, access, round_doc, ref)
    out["round_id"] = round_doc["id"]
    if not day["finished"]:
        return {**out, "status": "round" if changed_round else "same"}, changed_round
    if changed_round:
        # Mit dem echten Termin noch einmal zuordnen und prüfen - wie beim Eintragen.
        participants, resolution, content = await _resolve(db, access, round_doc, detail, existing)
    written = await _write(db, access, round_doc, existing, resolution, content, wish.expected_version, ref)
    return {**out, **written}, changed_round


@router.post(BASE + "/apply")
async def apply_partner_import(series_id: str, body: PartnerApplyBody, request: Request,
                               access: SeriesAccess = Depends(require_series_editor)):
    """Übernehmen, was die Vorschau gezeigt hat - als Entwurf. Holen vor der Sperre, schreiben darunter."""
    access.require_board()
    source = _source(access)
    await _limit(request, access)
    db = get_db()
    wishes = list({item.ref: item for item in body.items}.values())
    days = await _tournaments(source)
    by_ref = {day["ref"]: day for day in days}
    details = await _details(source, days, {wish.ref for wish in wishes})
    results_out, touched = [], False
    async with reference_series.series_write(db, series_id):
        series = await db.reference_series.find_one({"id": series_id}, {"_id": 0}) or access.series
        access.series = series
        rounds = await db.reference_rounds.find({"series_id": series_id}, {"_id": 0}).to_list(None)
        matches = partner_import.round_matches(days, rounds, source["platform"])
        for wish in wishes:
            day = by_ref.get(wish.ref)
            outcome, changed = await _apply_item(db, access, series, source["platform"], wish, day,
                                                 details.get(wish.ref), matches.get(wish.ref))
            results_out.append(outcome)
            touched = touched or changed
            if changed and outcome.get("round_id"):
                # Ein neu verknüpfter Termin ist für die übrigen Turniere vergeben.
                rounds = await db.reference_rounds.find({"series_id": series_id}, {"_id": 0}).to_list(None)
                matches = partner_import.round_matches(days, rounds, source["platform"])
        if touched:
            await reference_series.recompute_standings(db, await db.reference_series.find_one(
                {"id": series_id}, {"_id": 0}))
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "reference_partner.import", "actor_id": access.user["id"],
            "target_id": series_id, "created_at": now_utc().isoformat(),
            "data": {"platform": source["platform"], "series_ref": source.get("series_ref"),
                     "items": [{key: item.get(key) for key in ("ref", "status", "round_id", "target")}
                               for item in results_out]}})
    created = [person for item in results_out for person in item.get("created_participants") or []]
    return {"items": results_out, "created_participants": created, "open_unknown": bool(created)}
