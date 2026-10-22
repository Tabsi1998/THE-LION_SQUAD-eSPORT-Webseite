"""Referenzen bündeln (#1751) - nur der Vorstand (Bereich Redaktion „content“); Captains einer Serie dürfen es nicht.

- ``GET  /api/reference-series/admin/bundles/proposals``: Gruppen aus Referenzen ohne Saison mit Vorschau - Spur
  (vorhanden oder neu), je Referenz eine Saison (vorhanden oder neu), Liga-Weg und Hinweise aus den Altdaten
  (``services/reference_bundles.py``).
- ``POST /api/reference-series/admin/bundles``: bestätigen. Die Gruppe wird neu gerechnet; jede gewählte Referenz muss
  noch offen in ihr stehen, sonst 409 (nie doppelt gebündelt). Spur und Saisons werden angelegt bzw. gewählt - neue
  leer, nur mit dem, was die Referenzen haben -, ``series_id`` an der Referenz (bei einer neuen Saison mit genau einer
  Referenz auch ``reference_id`` der Saison) unter den Sperren der Saisons (#1970); danach gilt die strengere
  Sichtbarkeit (``season_close.tighten_references``), geöffnet wird nichts. Protokoll mit der Zahl.
- ``GET  /api/reference-series/admin/bundles``: die letzten Bündelungen zum Zurücknehmen.
- ``POST /api/reference-series/admin/bundles/<id>/undo``: rückgängig. Verknüpfung lösen (nur, wo die Referenz noch auf
  die Saison der Bündelung zeigt) und neu angelegte Saisons bzw. die Spur entfernen, wenn sie seitdem unverändert und
  leer sind; geänderte bleiben stehen. Eine dabei strenger gestellte Sichtbarkeit bleibt (wie #1970: nichts öffnet sich
  von selbst) - die Antwort nennt je Referenz die alte (``visibility_kept``). Protokoll mit der Zahl.

Bündeln und Zurücknehmen laufen nacheinander (eine Sperre für alle Bündelungen), die Adressen der Referenzen
(``/references/<id>``) bleiben unverändert.
"""
from __future__ import annotations

import hashlib
import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_area
from database import get_db
from models import ReferenceLineageCreate, ReferenceSeriesCreate, ReferenceSeriesKind, new_id, now_utc
from routes.reference_series_routes import SLUG_FALLBACK, _rules, _season_slug, _stamp, _teams
from services import reference_bundles, reference_running_cache, reference_series, season_close, series_partners
from services.mutation_lock import MutationLockBusy, mutation_lock
from services.slug_utils import unique_slug

router = APIRouter(prefix="/api/reference-series", tags=["reference-series"],
                   dependencies=[Depends(reference_running_cache.reset_after_write)])

BUNDLE_LOCK = "reference-bundles"
BUSY = "Gerade wird schon gebündelt. Bitte gleich noch einmal versuchen."
GROUP_GONE = ("Diese Referenzen stehen nicht mehr offen in der Gruppe - etwa schon gebündelt oder geändert. Bitte den "
              "Vorschlag neu laden.")
LINK_CHANGED = "Eine Referenz wurde gerade einer Saison zugeordnet. Bitte den Vorschlag neu laden."
ALREADY_UNDONE = "Diese Bündelung ist schon zurückgenommen."
NOT_FOUND = "Bündelung nicht gefunden."
LIST_LIMIT = 50


def _season_data(db) -> tuple:
    """Sammlungen mit ``series_id``, in die jemand eine Saison seit der Bündelung befüllt haben kann - Termine,
    Teilnehmer, Ergebnisblätter samt Entwürfen und Revisionen, Stände, Captains, Original-Bilder, Aliase. Steht dort
    etwas, bleibt die Saison beim Zurücknehmen stehen."""
    return (db.reference_rounds, db.reference_participants, db.reference_round_results,
            db.reference_round_result_revisions, db.reference_standings, db.reference_series_staff,
            db.reference_round_originals, db.reference_aliases)


def fingerprint(doc: dict) -> str:
    """Fingerabdruck eines Dokuments, wie die Bündelung es angelegt hat: alle Felder (ohne ``_id``). Schreibt seither
    jemand etwas hinein - auch ohne ``updated_at`` (Partner-Quelle, Teamfarben, Anpassungen, Partner der Saison) -,
    stimmt er nicht mehr."""
    clean = {key: value for key, value in doc.items() if key != "_id"}
    return hashlib.sha256(json.dumps(clean, sort_keys=True, default=str).encode("utf-8")).hexdigest()


class ReferenceBundleCreate(BaseModel):
    """Bestätigen einer Gruppe: welche Referenzen (Teilmenge der Gruppe), dazu Titel und Art einer neuen Spur."""
    group_key: str = Field(min_length=1, max_length=600)
    reference_ids: List[str] = Field(min_length=1, max_length=200)
    lineage_title: Optional[str] = Field(default=None, max_length=160)
    lineage_kind: Optional[ReferenceSeriesKind] = None


async def _locked(db, action):
    try:
        async with mutation_lock(db, BUNDLE_LOCK, wait_seconds=reference_series.SERIES_WAIT_SECONDS):
            return await action()
    except MutationLockBusy:
        raise HTTPException(409, BUSY) from None


@router.get("/admin/bundles/proposals")
async def bundle_proposals(me: dict = Depends(require_area("content"))):
    return await reference_bundles.proposals(get_db())


@router.get("/admin/bundles")
async def list_bundles(me: dict = Depends(require_area("content"))):
    items = await get_db().reference_bundles.find({}, {"_id": 0}).sort("created_at", -1).to_list(LIST_LIMIT)
    return {"items": [_view(item) for item in items]}


def _view(bundle: dict) -> dict:
    return {key: bundle.get(key) for key in ("id", "status", "linked", "lineage_id", "lineage_title", "lineage_created",
                                             "created_at", "undone_at", "result")} | {
        "series_created": [item["id"] for item in bundle.get("series_created") or []],
        "reference_ids": [link["reference_id"] for link in bundle.get("links") or []],
        "tightened": bundle.get("tightened") or []}


@router.post("/admin/bundles")
async def create_bundle(body: ReferenceBundleCreate, me: dict = Depends(require_area("content"))):
    db = get_db()
    return await _locked(db, lambda: _bundle(db, body, me))


async def _create_lineage(db, view: dict, body: ReferenceBundleCreate, me: dict, bundle_id: str,
                          lineage_id: str) -> dict:
    title = reference_bundles.text(body.lineage_title) or view["title"] or "Serie"
    game_id = view.get("game_id")
    if game_id and not await db.games.find_one({"id": game_id}, {"_id": 1}):
        game_id = None
    doc = ReferenceLineageCreate(
        title=title[:160], kind=body.lineage_kind or view["kind"], organizer=view.get("organizer"),
        label=view.get("label"), game_id=game_id, game_name=view.get("game_name"),
        partner_ids=view.get("partner_ids") or [], visibility=view["visibility"]).model_dump()
    await series_partners.clean(db, doc)
    doc["slug"] = await unique_slug(db.reference_lineages, title, fallback=SLUG_FALLBACK)
    now = now_utc().isoformat()
    doc.update({"id": lineage_id, "slug_history": [], "is_archived": False, "archived_at": None, "created_at": now,
                "created_by": me["id"], **_stamp(me), "bundle_id": bundle_id})
    await db.reference_lineages.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def _create_season(db, lineage_id: str, season: dict, me: dict, bundle_id: str, series_id: str) -> dict:
    """Neue Saison - leer: Standard-Regeln, keine Termine, keine Ergebnisse; nur Status, Sichtbarkeit und eigene Teams
    aus den Referenzen. Mit genau einer Referenz ist sie deren Saison-Referenz."""
    refs = season["reference_ids"]
    doc = ReferenceSeriesCreate(
        lineage_id=lineage_id, season=season["season"][:reference_bundles.SEASON_MAX], tier=season.get("tier"),
        status=season["status"] if season["status"] in reference_bundles.OPEN_STATUSES else "completed",
        visibility=season["visibility"], own_teams=[{"name": name} for name in season.get("own_teams") or []] or None,
        reference_id=refs[0] if len(refs) == 1 else None).model_dump()
    doc["rules"] = _rules({})
    doc.update(_teams(doc.get("own_teams"), doc.get("team_name")))
    now = now_utc().isoformat()
    doc.update({
        "id": series_id, "lineage_id": lineage_id,
        "season_slug": await _season_slug(db, lineage_id, doc["season"], doc.get("tier")), "season_slug_history": [],
        "rules_version": 1, "rules_note": None, "rules_changed_at": None, "rules_changed_by": None, "rules_history": [],
        "archived_at": None, "archived_from": None, "created_at": now, "created_by": me["id"], **_stamp(me),
        "bundle_id": bundle_id,
    })
    await db.reference_series.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def _bundle(db, body: ReferenceBundleCreate, me: dict) -> dict:
    wanted = list(dict.fromkeys(rid.strip() for rid in body.reference_ids if rid and rid.strip()))
    group = await reference_bundles.group_for(db, body.group_key, wanted)
    if group is None:
        raise HTTPException(409, GROUP_GONE)
    bundle_id = new_id()
    view = group["lineage"]
    lineage_id = view["id"] or new_id()
    # Kennungen neuer Saisons vorab: erst alle Sperren holen, dann anlegen - ist eine Saison besetzt (409), ist noch
    # nichts geschrieben.
    plan = [(season, season["id"] or new_id()) for season in group["seasons"]]
    targets = {rid: series_id for season, series_id in plan for rid in season["reference_ids"]}
    lock_ids = sorted(set(targets.values()))
    created_lineage = None
    created: list[dict] = []
    linked: list[str] = []
    tightened: list[str] = []
    before: dict[str, str] = {}
    now = now_utc().isoformat()
    async with reference_series.series_write_all(db, lock_ids):
        try:
            if not view["id"]:
                created_lineage = await _create_lineage(db, view, body, me, bundle_id, lineage_id)
            for season, series_id in plan:
                if not season["id"]:
                    doc = await _create_season(db, lineage_id, season, me, bundle_id, series_id)
                    created.append({"id": series_id, "updated_at": doc["updated_at"], "fingerprint": fingerprint(doc)})
            before = {item["id"]: item.get("visibility") or "public" async for item in db.references.find(
                {"id": {"$in": list(targets)}}, {"_id": 0, "id": 1, "visibility": 1})}
            for rid, series_id in targets.items():
                written = await db.references.update_one({"id": rid, "series_id": {"$in": [None, ""]}},
                                                         {"$set": {"series_id": series_id, "updated_at": now}})
                if not written.modified_count:
                    raise HTTPException(409, LINK_CHANGED)  # inzwischen anders zugeordnet
                linked.append(rid)
            for series_id in lock_ids:
                _, ids = await season_close.tighten_references(db, series_id)
                tightened += [rid for rid in ids if rid not in tightened]
        except BaseException:
            # Nichts halb gebündelt: Zuordnung und Sichtbarkeit zurück, Angelegtes wieder weg.
            for rid in linked:
                await db.references.update_one({"id": rid, "series_id": targets[rid]}, {"$set": {
                    "series_id": None, "visibility": before.get(rid, "public")}})
            if created:
                await db.reference_series.delete_many({"id": {"$in": [item["id"] for item in created]}})
            if created_lineage:
                await db.reference_lineages.delete_one({"id": lineage_id})
            raise
    after = {item["id"]: item.get("visibility") or "public"
             async for item in db.references.find({"id": {"$in": linked}}, {"_id": 0, "id": 1, "visibility": 1})}
    links = [{"reference_id": rid, "series_id": targets[rid], "visibility_before": before.get(rid),
              "visibility_after": after.get(rid)} for rid in linked]
    doc = {
        "id": bundle_id, "status": "active", "group_key": body.group_key, "lineage_id": lineage_id,
        "lineage_title": (created_lineage or view).get("title"), "lineage_created": bool(created_lineage),
        "lineage_updated_at": (created_lineage or {}).get("updated_at"),
        "lineage_fingerprint": fingerprint(created_lineage) if created_lineage else None,
        "series_created": created, "links": links,
        "linked": len(links), "tightened": tightened, "created_at": now, "created_by": me["id"],
        "undone_at": None, "undone_by": None, "result": None,
    }
    await db.reference_bundles.insert_one(doc)
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "reference_series.bundle", "actor_id": me["id"], "target_id": bundle_id,
        "data": {"count": len(links), "lineage_id": lineage_id, "lineage_created": bool(created_lineage),
                 "series_created": [item["id"] for item in created], "reference_ids": linked,
                 "tightened": tightened, "hints": len(group["hints"])},
        "created_at": now,
    })
    reference_running_cache.reset()
    doc.pop("_id", None)
    return _view(doc)


@router.post("/admin/bundles/{bundle_id}/undo")
async def undo_bundle(bundle_id: str, me: dict = Depends(require_area("content"))):
    db = get_db()
    return await _locked(db, lambda: _undo(db, bundle_id, me))


async def _touched_elsewhere(db, target_id: str, since: str | None) -> bool:
    """Hat seit der Bündelung jemand etwas an Saison bzw. Spur protokolliert (Partner-Quelle, Map-Pool, Anpassung …)?"""
    return bool(await db.audit_logs.count_documents(
        {"target_id": target_id, "created_at": {"$gte": since or ""}}, limit=1))


async def _untouched(db, item: dict, bundled: set[str], since: str | None) -> bool:
    """Neu angelegte Saison seit der Bündelung unverändert und leer - im Zweifel nicht: derselbe Fingerabdruck (kein
    Feld dazu oder geändert), nichts in den Sammlungen der Saison, kein Map-Pool, kein Nachfolger-Verweis, kein Eintrag
    im Protokoll, keine andere Referenz."""
    series = await db.reference_series.find_one({"id": item["id"]}, {"_id": 0})
    if not series or not item.get("fingerprint") or fingerprint(series) != item["fingerprint"]:
        return False
    for collection in _season_data(db):
        if await collection.count_documents({"series_id": item["id"]}, limit=1):
            return False
    if await db.map_pools.count_documents({"scope": "reference_series", "scope_id": item["id"]}, limit=1):
        return False
    if await db.reference_series.count_documents({"successor_id": item["id"]}, limit=1):
        return False
    if await _touched_elsewhere(db, item["id"], since):
        return False
    others = await db.references.count_documents({"series_id": item["id"], "id": {"$nin": list(bundled)}}, limit=1)
    owned = series.get("reference_id")
    return not others and (not owned or owned in bundled)


def _visibility_notice(ref: dict, link: dict) -> dict | None:
    """Hinweis, wenn die Referenz noch strenger ist als vor der Bündelung (weil die Bündelung sie strenger gestellt hat)."""
    before, now = link.get("visibility_before") or "public", ref.get("visibility") or "public"
    order = season_close.VISIBILITY_ORDER
    if before == link.get("visibility_after") or before not in order or now not in order:
        return None
    if order.index(now) <= order.index(before):
        return None
    label = reference_bundles.VISIBILITY_LABELS.get(before, before)
    return {"reference_id": ref["id"], "title": ref.get("title"), "visibility": now, "previous_visibility": before,
            "text": f"Sichtbarkeit war vorher ‚{label}‘ - bei Bedarf in der Referenz wieder öffnen."}


async def _undo(db, bundle_id: str, me: dict) -> dict:
    bundle = await db.reference_bundles.find_one({"id": bundle_id}, {"_id": 0})
    if not bundle:
        raise HTTPException(404, NOT_FOUND)
    if bundle.get("status") != "active":
        raise HTTPException(409, ALREADY_UNDONE)
    links = bundle.get("links") or []
    created = bundle.get("series_created") or []
    bundled = {link["reference_id"] for link in links}
    lock_ids = {link["series_id"] for link in links} | {item["id"] for item in created}
    now = now_utc().isoformat()
    removed, kept, unlinked, stricter = [], [], [], []
    async with reference_series.series_write_all(db, lock_ids):
        for item in created:
            if await _untouched(db, item, bundled, bundle.get("created_at")):
                await db.reference_series.delete_one({"id": item["id"]})
                removed.append(item["id"])
            elif await db.reference_series.find_one({"id": item["id"]}, {"_id": 1}):
                kept.append(item["id"])
                await db.reference_series.update_one({"id": item["id"], "reference_id": {"$in": list(bundled)}},
                                                     {"$set": {"reference_id": None}})
        for link in links:
            rid = link["reference_id"]
            ref = await db.references.find_one({"id": rid}, {"_id": 0, "id": 1, "series_id": 1, "visibility": 1,
                                                             "title": 1})
            if not ref or ref.get("series_id") != link["series_id"]:
                continue  # seither von Hand anders zugeordnet - bleibt
            await db.references.update_one({"id": rid, "series_id": link["series_id"]},
                                           {"$set": {"series_id": None, "updated_at": now}})
            unlinked.append(rid)
            # Wie #1970 beim Lockern: nichts öffnet sich von selbst. Hat die Bündelung die Referenz strenger gestellt,
            # bleibt sie so - die Antwort nennt die alte Sichtbarkeit, geöffnet wird bei Bedarf in der Referenz.
            notice = _visibility_notice(ref, link)
            if notice:
                stricter.append(notice)
    lineage_removed = False
    if bundle.get("lineage_created"):
        lineage = await db.reference_lineages.find_one({"id": bundle["lineage_id"]}, {"_id": 0})
        if lineage and bundle.get("lineage_fingerprint") and fingerprint(lineage) == bundle["lineage_fingerprint"] \
                and not await db.reference_series.count_documents({"lineage_id": bundle["lineage_id"]}, limit=1) \
                and not await db.reference_aliases.count_documents({"lineage_id": bundle["lineage_id"]}, limit=1) \
                and not await _touched_elsewhere(db, bundle["lineage_id"], bundle.get("created_at")):
            await db.reference_lineages.delete_one({"id": bundle["lineage_id"]})
            lineage_removed = True
    result = {"unlinked": len(unlinked), "series_removed": len(removed), "series_kept": kept,
              "lineage_removed": lineage_removed, "visibility_kept": stricter}
    await db.reference_bundles.update_one({"id": bundle_id}, {"$set": {
        "status": "undone", "undone_at": now, "undone_by": me["id"], "result": result}})
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "reference_series.bundle_undo", "actor_id": me["id"], "target_id": bundle_id,
        "data": {"count": len(unlinked), "reference_ids": unlinked, "series_removed": removed, "series_kept": kept,
                 "lineage_removed": lineage_removed,
                 "visibility_kept": [item["reference_id"] for item in stricter]},
        "created_at": now,
    })
    reference_running_cache.reset()
    return result
