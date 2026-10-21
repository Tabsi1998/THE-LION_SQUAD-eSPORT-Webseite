"""Externe Serien (#1741): Spur und Serie anlegen, bearbeiten und archivieren - Bereich Redaktion („content“).

Eine **Spur** ist die Klammer (etwa eine Rennliga mit ihrer Bezeichnung „F1“), eine **Serie** eine Saison dieser Spur
in einer Stufe. Gelöscht wird nichts: Spur und Serie werden archiviert und lassen sich zurückholen. Regeln kommen als
Kopie einer Punkteschema-Vorlage (``services/reference_series.py``); ändert sich eine Regel, steigt ``rules_version``,
das Adminprotokoll hält Alt- und Neu-Stand fest, der abgelöste Stand bleibt je Version in ``rules_history``, und die
gespeicherten Stände werden neu gerechnet (Entscheidung 4).

Öffentliche Seiten (``/references/series/<spur>/<saison>``) und Termine, Teilnehmer, Ergebnisse und Captains kommen in
eigenen Paketen dazu (#1742 ff.); sie hängen ihre Routen an diesen Router.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from auth import require_area
from database import get_db
from models import (
    ReferenceLineageCreate,
    ReferenceLineageUpdate,
    ReferenceSeriesCreate,
    ReferenceSeriesUpdate,
    new_id,
    now_utc,
)
from services import partner_pages, reference_running_cache, reference_series
from services.own_teams import clean_teams, own_teams
from services.series_identity import normalize_name
from services.reference_series_access import SeriesAccess, require_series_editor
from services.scoring_rules import normalize_rules
from services.slug_utils import apply_slug_history, slug_source_for_update, slugify, unique_slug

# Jeder schreibende Aufruf leert den Cache der laufenden Saisons (#1753, Startseite).
router = APIRouter(prefix="/api/reference-series", tags=["reference-series"],
                   dependencies=[Depends(reference_running_cache.reset_after_write)])

LINEAGE_NULLABLE = {"organizer", "label", "game_id", "game_name", "external_url", "description", "tier_order"}
SERIES_NULLABLE = {"tier", "title", "default_weekday", "default_time", "team_name", "official_table_url",
                   "external_url", "description", "reference_id", "season_result"}
SLUG_FALLBACK = "serie"


def _rules(raw: dict) -> dict:
    try:
        return normalize_rules(raw)
    except ValueError as exc:
        raise HTTPException(422, f"Regeln: {exc}") from exc


async def _check_game(db, game_id: str | None) -> None:
    if game_id and not await db.games.find_one({"id": game_id}, {"_id": 1}):
        raise HTTPException(404, "Spiel nicht gefunden.")


async def _check_reference(db, reference_id: str | None) -> None:
    if reference_id and not await db.references.find_one({"id": reference_id}, {"_id": 1}):
        raise HTTPException(404, "Referenz nicht gefunden.")


async def _lineage(db, lineage_id: str) -> dict:
    found = await db.reference_lineages.find_one({"id": lineage_id}, {"_id": 0})
    if not found:
        raise HTTPException(404, "Spur nicht gefunden.")
    return found


async def _series(db, series_id: str) -> dict:
    found = await db.reference_series.find_one({"id": series_id}, {"_id": 0})
    if not found:
        raise HTTPException(404, "Serie nicht gefunden.")
    return found


async def _season_slug(db, lineage_id: str, season: str, tier: str | None, current_id: str | None = None) -> str:
    """Adresse der Saison innerhalb der Spur: aus Saison und Stufe, bei Gleichheit mit Zähler (2026, 2026-2 …)."""
    base = slugify(" ".join(part for part in (season, tier) if part), fallback="saison", max_length=60)
    candidate, suffix = base, 2
    while True:
        query = {"lineage_id": lineage_id, "season_slug": candidate}
        if current_id:
            query["id"] = {"$ne": current_id}
        if not await db.reference_series.find_one(query, {"_id": 1}):
            return candidate
        candidate, suffix = f"{base}-{suffix}", suffix + 1


def _stamp(me: dict) -> dict:
    return {"updated_at": now_utc().isoformat(), "updated_by": me["id"]}


# ---------------------------------------------------------------- Übersicht und Vorlagen
@router.get("/admin")
async def admin_overview(me: dict = Depends(require_area("content"))):
    """Alle Spuren mit ihren Serien (auch archivierte), die Punkteschema-Vorlagen und die Standard-Regeln - eine Abfrage
    für die Seite."""
    db = get_db()
    lineages = await db.reference_lineages.find({}, {"_id": 0}).to_list(None)
    series = await db.reference_series.find({}, {"_id": 0}).to_list(None)
    by_lineage: dict[str, list[dict]] = {}
    for item in sorted(series, key=lambda row: (row.get("season_slug") or ""), reverse=True):
        by_lineage.setdefault(item.get("lineage_id"), []).append(item)
    for lineage in lineages:
        lineage["series"] = sorted(by_lineage.get(lineage["id"], []), key=lambda row: row.get("status") == "archived")
    lineages.sort(key=lambda row: (bool(row.get("is_archived")), row.get("order_index") or 0,
                                   str(row.get("title") or "").casefold()))
    return {"lineages": lineages, "points_schemes": await reference_series.complete_schemes(db),
            "default_rules": normalize_rules({})}


@router.get("/admin/points-schemes")
async def admin_points_schemes(me: dict = Depends(require_area("content"))):
    return {"schemes": await reference_series.complete_schemes(get_db())}


# ---------------------------------------------------------------- Spur
@router.post("/admin/lineages")
async def create_lineage(body: ReferenceLineageCreate, me: dict = Depends(require_area("content"))):
    db = get_db()
    doc = body.model_dump()
    await _check_game(db, doc.get("game_id"))
    doc["partner_ids"] = await partner_pages.clean_partner_ids(db, doc.get("partner_ids"))
    doc["slug"] = await unique_slug(db.reference_lineages, doc.get("slug") or doc["title"], fallback=SLUG_FALLBACK)
    now = now_utc().isoformat()
    doc.update({"id": new_id(), "slug_history": [], "is_archived": False, "archived_at": None,
                "created_at": now, "created_by": me["id"], **_stamp(me)})
    await db.reference_lineages.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/admin/lineages/{lineage_id}")
async def update_lineage(lineage_id: str, body: ReferenceLineageUpdate, me: dict = Depends(require_area("content"))):
    db = get_db()
    existing = await _lineage(db, lineage_id)
    raw = body.model_dump(exclude_unset=True)
    updates = {key: value for key, value in raw.items() if value is not None or key in LINEAGE_NULLABLE}
    await _check_game(db, updates.get("game_id"))
    if "partner_ids" in updates:
        updates["partner_ids"] = await partner_pages.clean_partner_ids(db, updates["partner_ids"])
    updates.pop("slug", None)
    source = slug_source_for_update(raw, existing, "title", fallback=SLUG_FALLBACK)
    if source is not None:
        updates["slug"] = await unique_slug(db.reference_lineages, source, current_id=lineage_id,
                                            fallback=SLUG_FALLBACK)
        apply_slug_history(existing, updates)
    await db.reference_lineages.update_one({"id": lineage_id}, {"$set": {**updates, **_stamp(me)}})
    return await _lineage(db, lineage_id)


async def _set_lineage_archived(lineage_id: str, archived: bool, me: dict) -> dict:
    db = get_db()
    await _lineage(db, lineage_id)
    await db.reference_lineages.update_one({"id": lineage_id}, {"$set": {
        "is_archived": archived, "archived_at": now_utc().isoformat() if archived else None, **_stamp(me)}})
    return await _lineage(db, lineage_id)


@router.post("/admin/lineages/{lineage_id}/archive")
async def archive_lineage(lineage_id: str, me: dict = Depends(require_area("content"))):
    return await _set_lineage_archived(lineage_id, True, me)


@router.post("/admin/lineages/{lineage_id}/restore")
async def restore_lineage(lineage_id: str, me: dict = Depends(require_area("content"))):
    return await _set_lineage_archived(lineage_id, False, me)


# ---------------------------------------------------------------- Serie
@router.post("/admin/series")
async def create_series(body: ReferenceSeriesCreate, me: dict = Depends(require_area("content"))):
    db = get_db()
    lineage = await _lineage(db, body.lineage_id)
    doc = body.model_dump()
    template: dict = {}
    if doc.get("points_scheme_id"):
        template = next((scheme for scheme in await reference_series.points_schemes(db)
                         if scheme["id"] == doc["points_scheme_id"]), None)
        if template is None:
            raise HTTPException(404, "Punkteschema-Vorlage nicht gefunden.")
    doc["rules"] = _rules({**(template.get("rules") or {}), **(doc.get("rules") or {})})
    doc.update(_teams(doc.get("own_teams"), doc.get("team_name")))
    await _check_reference(db, doc.get("reference_id"))
    now = now_utc().isoformat()
    doc.update({
        "id": new_id(), "lineage_id": lineage["id"],
        "season_slug": await _season_slug(db, lineage["id"], doc["season"], doc.get("tier")), "season_slug_history": [],
        "rules_version": 1, "rules_note": None, "rules_changed_at": None, "rules_changed_by": None, "rules_history": [],
        "archived_at": None, "archived_from": None,
        "created_at": now, "created_by": me["id"], **_stamp(me),
    })
    await db.reference_series.insert_one(doc)
    doc.pop("_id", None)
    return doc


def _teams(teams, team_name, existing: dict | None = None) -> dict:
    """Eigene Teams (#1926) und - für ältere Leser - ``team_name`` als das erste davon. Schickt ein älterer Aufruf nur
    ``team_name``, wird es das einzige eigene Team; die Schreibweisen eines gleichnamigen Teams bleiben."""
    if teams is None:
        name = " ".join(str(team_name or "").split())
        same = [team for team in own_teams(existing) if normalize_name(team["name"]) == normalize_name(name)]
        teams = (same or [{"name": name}]) if name else []
    cleaned = clean_teams(teams)
    return {"own_teams": cleaned, "team_name": cleaned[0]["name"] if cleaned else None}


@router.get("/admin/series/{series_id}")
async def get_series(series_id: str, access: SeriesAccess = Depends(require_series_editor)):
    """Vorstand und gültige Captains dieser Serie (#1749); ``access`` sagt der Seite, was die Person hier darf. Captains
    bekommen nur die Felder zum Eintragen (``SeriesAccess.series_view``)."""
    lineage = await get_db().reference_lineages.find_one({"id": access.series["lineage_id"]}, {"_id": 0})
    return access.series_view(lineage)


@router.patch("/admin/series/{series_id}")
@reference_series.series_locked
async def update_series(series_id: str, body: ReferenceSeriesUpdate, me: dict = Depends(require_area("content"))):
    db = get_db()
    existing = await _series(db, series_id)
    raw = body.model_dump(exclude_unset=True)
    note = raw.pop("rules_note", None)
    updates = {key: value for key, value in raw.items() if value is not None or key in SERIES_NULLABLE}
    await _check_reference(db, updates.get("reference_id"))
    teams_changed = False
    if "own_teams" in updates or "team_name" in updates:
        updates.update(_teams(updates.get("own_teams"), updates.get("team_name"), existing))
        teams_changed = updates["own_teams"] != own_teams(existing)
    rules_changed = False
    if "rules" in updates:
        rules = _rules(updates["rules"])
        if rules == existing.get("rules"):
            updates.pop("rules")
        else:
            rules_changed = True
            version = int(existing.get("rules_version") or 1)
            changed_at = now_utc().isoformat()
            # Regel-Historie je Version: der abgelöste Stand bleibt vollständig, damit ein früher gerechneter Stand
            # (``reference_standings.rules_version``) nachvollziehbar bleibt.
            replaced = {"version": version, "rules": existing.get("rules"), "note": existing.get("rules_note"),
                        "replaced_at": changed_at, "replaced_by": me["id"]}
            updates.update({"rules": rules, "rules_version": version + 1,
                            "rules_note": (note or "").strip() or None, "rules_changed_at": changed_at,
                            "rules_changed_by": me["id"],
                            "rules_history": [*(existing.get("rules_history") or []), replaced]})
    if "season" in updates or "tier" in updates:
        season = updates.get("season", existing.get("season"))
        tier = updates.get("tier", existing.get("tier"))
        slug = await _season_slug(db, existing["lineage_id"], season, tier, current_id=series_id)
        if slug != existing.get("season_slug"):
            history = [existing.get("season_slug"), *(existing.get("season_slug_history") or [])]
            kept = [item for item in dict.fromkeys(history) if item and item != slug][:25]
            updates.update({"season_slug": slug, "season_slug_history": kept})
    status = updates.get("status")
    if status == "archived" and existing.get("status") != "archived":
        updates.update({"archived_at": now_utc().isoformat(), "archived_from": existing.get("status")})
    elif status and status != "archived":
        updates.update({"archived_at": None, "archived_from": None})
    await db.reference_series.update_one({"id": series_id}, {"$set": {**updates, **_stamp(me)}})
    saved = await _series(db, series_id)
    if rules_changed:
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "reference_series.rules_change", "actor_id": me["id"], "target_id": series_id,
            "data": {"version": saved["rules_version"], "note": saved.get("rules_note"),
                     "previous_version": existing.get("rules_version") or 1, "previous_rules": existing.get("rules"),
                     "rules": saved["rules"]},
            "created_at": now_utc().isoformat(),
        })
    if rules_changed or teams_changed:
        # Andere Schreibweisen eines eigenen Teams zählen erst nach dem Neurechnen als dieses Team (#1926).
        await reference_series.recompute_standings(db, saved)
    return saved


@router.post("/admin/series/{series_id}/archive")
@reference_series.series_locked
async def archive_series(series_id: str, me: dict = Depends(require_area("content"))):
    db = get_db()
    existing = await _series(db, series_id)
    if existing.get("status") != "archived":
        await db.reference_series.update_one({"id": series_id}, {"$set": {
            "status": "archived", "archived_at": now_utc().isoformat(), "archived_from": existing.get("status"),
            **_stamp(me)}})
    return await _series(db, series_id)


@router.post("/admin/series/{series_id}/restore")
@reference_series.series_locked
async def restore_series(series_id: str, me: dict = Depends(require_area("content"))):
    db = get_db()
    existing = await _series(db, series_id)
    if existing.get("status") == "archived":
        await db.reference_series.update_one({"id": series_id}, {"$set": {
            "status": existing.get("archived_from") or "completed", "archived_at": None, "archived_from": None,
            **_stamp(me)}})
    return await _series(db, series_id)
