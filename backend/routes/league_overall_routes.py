"""Gesamtwertung über Seasons (F.5, #2215, docs/LIGA.md „F.5 Gesamtwertung über Seasons“).

Verwaltung (``/api/admin/leagues/{league_id}/overall``):

- ``GET``: Einstellungen, Zeiträume und Belohnungen - jede Zuständigkeit der Liga. ``PUT``: speichern - „Season konfigurieren“.
- ``GET …/{period_id}``: das Cockpit je Liga N mit Vorschau bzw. Fassung, Sperrgründen, Gleichständen und Verlauf.
- ``POST …/{period_id}/levels/{level}/close`` und ``…/reopen``: abschließen bzw. wieder öffnen (wie F.1), ``PUT …/decision`` und
  ``DELETE …/decision/{id}``: Entscheid der Leitung bei Gleichstand - jeweils „Season konfigurieren“, Befangenheit wie im Abschluss.

Öffentlich: ``GET /api/leagues/{liga}/{season}/overall`` (der Zeitraum dieser Season, nach Sichtbarkeit) und ``…/overall.pdf?level=n``.
Logik in ``services/league_overall.py``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import get_optional_user
from database import get_db
from services import league_overall
from services.change_events import publish_api_change
from services.league_overall_rules import OverallProblem
from services.league_permissions import ANY, capabilities_of, require_league
from services.mutation_lock import MutationLockBusy, league_resource, mutation_lock

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])
router = APIRouter(prefix="/api/leagues", tags=["leagues"])

EDIT = league_overall.CLOSE_CAPABILITY


class PeriodBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str | None = Field(default=None, max_length=64)
    name: str = Field(max_length=200)
    season_ids: list[str] = Field(default_factory=list, max_length=100)


class SettingsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    points_mode: str | None = Field(default=None, max_length=20)
    points_table: list[int] | None = Field(default=None, max_length=40)
    champion_bonus: int | None = None
    counting: str | None = Field(default=None, max_length=20)
    best_count: int | None = None
    tiebreakers: list[str] | None = Field(default=None, max_length=10)
    reward_players: str | None = Field(default=None, max_length=20)
    rewards: list[dict] | None = Field(default=None, max_length=21)
    periods: list[PeriodBody] | None = Field(default=None, max_length=21)


class CloseBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirm: bool = False
    conflict_reason: str | None = Field(default=None, max_length=500)


class ReopenBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(max_length=500)
    emergency_reason: str | None = Field(default=None, max_length=500)
    conflict_reason: str | None = Field(default=None, max_length=500)


class DecisionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    keys: list[str] = Field(default_factory=list, max_length=50)
    reason: str = Field(max_length=500)
    method: str | None = Field(default=None, max_length=20)
    conflict_reason: str | None = Field(default=None, max_length=500)


def _refuse(problem: OverallProblem) -> HTTPException:
    return HTTPException(status_code=problem.status, detail=problem.message)


async def _league(db, league_id: str) -> dict:
    league = await db.leagues.find_one({"id": league_id}, {"_id": 0})
    if not league:
        raise HTTPException(status_code=404, detail="Liga nicht gefunden.")
    return league


async def _changed(league_id: str) -> None:
    await publish_api_change("PUT", f"/api/admin/leagues/{league_id}", 200)


@admin_router.get("/{league_id}/overall")
async def admin_overall(league_id: str, me: dict = Depends(require_league(ANY, via="league_id"))):
    db = get_db()
    league = await _league(db, league_id)
    return await league_overall.settings_view(db, league, can_edit=EDIT in await capabilities_of(db, me, league_id))


@admin_router.put("/{league_id}/overall")
async def admin_save_overall(league_id: str, body: SettingsBody, me: dict = Depends(require_league(EDIT, via="league_id"))):
    db = get_db()
    payload = body.model_dump(exclude_none=True)
    if body.periods is not None:
        payload["periods"] = [row.model_dump() for row in body.periods]
    try:
        async with mutation_lock(db, league_resource(league_id)):
            league = await league_overall.save(db, await _league(db, league_id), payload, me)
    except OverallProblem as problem:
        raise _refuse(problem) from None
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=league_overall.BUSY) from None
    await _changed(league_id)
    return await league_overall.settings_view(db, league, can_edit=True)


@admin_router.get("/{league_id}/overall/{period_id}")
async def admin_overall_cockpit(league_id: str, period_id: str, me: dict = Depends(require_league(ANY, via="league_id"))):
    db = get_db()
    try:
        return await league_overall.cockpit(db, await _league(db, league_id), period_id, me)
    except OverallProblem as problem:
        raise _refuse(problem) from None


@admin_router.post("/{league_id}/overall/{period_id}/levels/{level}/close")
async def admin_close_overall(league_id: str, period_id: str, level: int, body: CloseBody,
                              me: dict = Depends(require_league(EDIT, via="league_id"))):
    db = get_db()
    if not body.confirm:
        raise HTTPException(status_code=422, detail="Bitte den Abschluss bestätigen.")
    try:
        async with mutation_lock(db, league_resource(league_id)):
            result = await league_overall.close(db, await _league(db, league_id), period_id, level, me, conflict_reason=body.conflict_reason)
    except OverallProblem as problem:
        raise _refuse(problem) from None
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=league_overall.BUSY) from None
    await _changed(league_id)
    final = result["final"]
    return {"ok": True, "version": final["version"], "closed_at": final["closed_at"],
            "leader": next((row.get("name") for row in final.get("teams") or [] if row.get("place") == 1), None),
            "rewards": (result.get("rewards") or {}).get("granted", 0)}


@admin_router.post("/{league_id}/overall/{period_id}/levels/{level}/reopen")
async def admin_reopen_overall(league_id: str, period_id: str, level: int, body: ReopenBody,
                               me: dict = Depends(require_league(EDIT, via="league_id"))):
    db = get_db()
    try:
        async with mutation_lock(db, league_resource(league_id)):
            result = await league_overall.reopen(db, await _league(db, league_id), period_id, level, me, body.reason,
                                                 conflict_reason=body.conflict_reason, emergency_reason=body.emergency_reason)
    except OverallProblem as problem:
        raise _refuse(problem) from None
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=league_overall.BUSY) from None
    await _changed(league_id)
    return {"ok": True, "version": result["final"]["version"]}


@admin_router.put("/{league_id}/overall/{period_id}/levels/{level}/decision")
async def admin_overall_decision(league_id: str, period_id: str, level: int, body: DecisionBody,
                                 me: dict = Depends(require_league(EDIT, via="league_id"))):
    db = get_db()
    try:
        async with mutation_lock(db, league_resource(league_id)):
            decision = await league_overall.decide(db, await _league(db, league_id), period_id, level, me, body.keys, body.reason, body.method,
                                                   conflict_reason=body.conflict_reason)
    except OverallProblem as problem:
        raise _refuse(problem) from None
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=league_overall.BUSY) from None
    await _changed(league_id)
    return {"ok": True, "id": decision["id"]}


@admin_router.delete("/{league_id}/overall/{period_id}/levels/{level}/decision/{decision_id}")
async def admin_overall_undecide(league_id: str, period_id: str, level: int, decision_id: str,
                                 me: dict = Depends(require_league(EDIT, via="league_id"))):
    db = get_db()
    try:
        async with mutation_lock(db, league_resource(league_id)):
            await league_overall.undecide(db, await _league(db, league_id), period_id, level, decision_id, me)
    except OverallProblem as problem:
        raise _refuse(problem) from None
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=league_overall.BUSY) from None
    await _changed(league_id)
    return {"ok": True}


# ---------------------------------------------------------------- Öffentlich

async def _view(league_slug: str, season_slug: str, user: dict | None) -> dict:
    from routes.tournament_common import tournament_hidden_reason
    from services import league_service

    db = get_db()
    try:
        league, season = await league_service.visible_season(db, league_slug, season_slug, user)
    except league_service.LeagueProblem as problem:
        raise HTTPException(status_code=problem.status, detail=problem.message) from None
    view = await league_overall.public_view(db, league, season, user, hidden=tournament_hidden_reason)
    if not view:
        raise HTTPException(status_code=404, detail="Für diese Season gibt es keine Gesamtwertung.")
    return {**view, "league": {"name": league.get("name"), "slug": league.get("slug")}}


@router.get("/{league_slug}/{season_slug}/overall")
async def public_overall(league_slug: str, season_slug: str, user: dict | None = Depends(get_optional_user)):
    """Die Gesamtwertung des Zeitraums dieser Season - Co-Teams und Spieler je Liga N, nach der Sichtbarkeit der Person."""
    return await _view(league_slug, season_slug, user)


def _cell(cell: dict) -> str:
    if not cell.get("played"):
        return "–"
    text = str(cell.get("points") or 0)
    return text if cell.get("counted") else f"({text})"


@router.get("/{league_slug}/{season_slug}/overall.pdf")
async def public_overall_pdf(league_slug: str, season_slug: str, level: int | None = None, user: dict | None = Depends(get_optional_user)):
    """PDF der Gesamtwertung einer Liga N (ohne ``level`` die oberste) - derselbe Stand wie die Ligaseite."""
    from pdf_service import pdf_league_overall
    from routes.export_routes import _pdf_branding, _pdf_response, _pdf_sponsors

    view = await _view(league_slug, season_slug, user)
    block = next((row for row in view["levels"] if level is None or row["level"] == level), None)
    if not block:
        raise HTTPException(status_code=404, detail="Diese Liga N hat keine Gesamtwertung.")
    names = {row["id"]: row.get("name") or "Season" for row in view["seasons"]}
    headers = ["Platz", "Name", *[names.get(season_id, "Season") for season_id in block["season_ids"]], "Summe"]
    sections = [
        {"title": "Co-Teams", "headers": headers,
         "rows": [[f"{row['place']}.", row["name"], *[_cell(cell) for cell in row["seasons"]], row["total"]] for row in block["teams"]]},
        {"title": "Spieler", "headers": headers,
         "rows": [[f"{row['place']}.", row["name"], *[_cell(cell) for cell in row["seasons"]], row["total"]] for row in block["players"]]},
    ]
    # Die Zählregel der jeweiligen Wertung - bei einer abgeschlossenen die der Fassung.
    settings = block.get("settings") or view["settings"]
    note = ("Endstand" if block["closed"] else "Laufende Wertung") + f" · {block['label']}"
    if settings.get("counting") == "best" and settings.get("best_count"):
        note += f" · Es zählen die besten {settings['best_count']} Seasons, Streichergebnisse in Klammern"
    db = get_db()
    title = f"{view['league']['name']} · {view['period']['name']} · {block['label']}"
    return _pdf_response(pdf_league_overall(title, sections, pdf_sponsors=await _pdf_sponsors(db), pdf_branding=await _pdf_branding(db), note=note),
                         f"gesamtwertung-{league_slug}-{block['level']}.pdf")
