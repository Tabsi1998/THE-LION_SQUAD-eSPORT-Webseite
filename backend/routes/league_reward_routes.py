"""Belohnungen der Liga (F.4, #2214, docs/LIGA.md „F.4 Belohnungen“).

- ``GET  /api/admin/leagues/seasons/{season_id}/rewards``: Zusammenstellung der Season, je Liga N eigene oder geerbte, Stand der Vergabe
  je Staffel - jede Zuständigkeit der Liga.
- ``PUT  /api/admin/leagues/seasons/{season_id}/rewards``: speichern - Zuständigkeit „Season konfigurieren“. Die Vergabe läuft über den
  Abschluss (F.1), der seine Rechte schon hat; eine Änderung wirkt erst beim nächsten Abschluss einer Staffel.
- ``GET  /api/me/rewards/unseen`` und ``POST /api/me/rewards/seen``: die Zeremonie beim nächsten Besuch (Nr. 165) - nur eigene.
- ``GET  /api/rewards/{award_id}/share.png``: das Teilen-Bild - nur, was öffentlich sichtbar ist.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from auth import get_current_user
from database import get_db
from services import league_rewards
from services.change_events import publish_api_change
from services.league_permissions import ANY, capabilities_of, require_league
from services.mutation_lock import MutationLockBusy, league_season_resource, mutation_lock

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])
router = APIRouter(prefix="/api", tags=["rewards"])

EDIT_CAPABILITY = "season"


class PlacesBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: str = Field(max_length=20)
    rank: int | None = None
    from_: int | None = Field(default=None, alias="from")
    to: int | None = None

    def plain(self) -> dict:
        return {"mode": self.mode, "rank": self.rank, "from": self.from_, "to": self.to}


class RewardBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | None = Field(default=None, max_length=64)
    kind: str = Field(max_length=20)
    name: str = Field(max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    places: PlacesBody
    recipients: list[str] = Field(default_factory=list, max_length=4)
    image_url: str | None = Field(default=None, max_length=600)
    prize: str | None = Field(default=None, max_length=600)

    def plain(self) -> dict:
        return {**self.model_dump(exclude={"places"}), "places": self.places.plain()}


class RewardsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reward_players: str | None = Field(default=None, max_length=20)
    items: list[RewardBody] | None = Field(default=None, max_length=league_rewards.ITEM_LIMIT + 1)
    # Je Liga N: ``null`` übernimmt die Belohnungen der Season, eine Liste ist die eigene Zusammenstellung.
    divisions: dict[str, list[RewardBody] | None] | None = None


class SeenBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ids: list[str] = Field(default_factory=list, max_length=50)


async def _season(db, season_id: str) -> dict:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        raise HTTPException(status_code=404, detail="Season nicht gefunden.")
    return season


@admin_router.get("/seasons/{season_id}/rewards")
async def admin_season_rewards(season_id: str, me: dict = Depends(require_league(ANY, via="season_id"))):
    db = get_db()
    season = await _season(db, season_id)
    can_edit = EDIT_CAPABILITY in await capabilities_of(db, me, season.get("league_id"))
    return await league_rewards.admin_view(db, season, can_edit=can_edit)


@admin_router.put("/seasons/{season_id}/rewards")
async def admin_save_season_rewards(season_id: str, body: RewardsBody,
                                    me: dict = Depends(require_league(EDIT_CAPABILITY, via="season_id"))):
    db = get_db()
    payload: dict = {}
    if body.reward_players is not None:
        payload["reward_players"] = body.reward_players
    if body.items is not None:
        payload["items"] = [row.plain() for row in body.items]
    if body.divisions is not None:
        payload["divisions"] = {key: None if rows is None else [row.plain() for row in rows] for key, rows in body.divisions.items()}
    try:
        async with mutation_lock(db, league_season_resource(season_id)):
            season = await league_rewards.save(db, await _season(db, season_id), payload, me)
    except league_rewards.RewardProblem as problem:
        raise HTTPException(status_code=problem.status, detail=problem.message) from None
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail="Die Season wird gerade bearbeitet. Bitte gleich noch einmal.") from None
    await publish_api_change("PUT", f"/api/admin/leagues/seasons/{season_id}", 200)
    return await league_rewards.admin_view(db, season, can_edit=True)


@router.get("/me/rewards/unseen")
async def my_unseen_rewards(user: dict = Depends(get_current_user)):
    return {"rewards": await league_rewards.unseen_for(get_db(), user["id"])}


@router.post("/me/rewards/seen")
async def my_rewards_seen(body: SeenBody, user: dict = Depends(get_current_user)):
    return {"ok": True, "seen": await league_rewards.mark_seen(get_db(), user["id"], body.ids)}


@router.get("/rewards/{award_id}/share.png")
async def reward_share_image(award_id: str):
    """Das Teilen-Bild einer Belohnung. Sichtbarkeit und Ruhen werden bei jedem Abruf geprüft, erst dann kommt das gemerkte Bild
    (services/share_image_cache, fünf Minuten; der Fingerabdruck trägt die Fassung des Endstands). ``Cache-Control`` setzt server.py."""
    from services import reward_share
    from services.share_image_cache import share_images

    payload = await reward_share.share_payload(get_db(), award_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Belohnung nicht gefunden.")
    png = share_images.get_or_draw(("reward", award_id), payload, lambda: reward_share.render_card(payload))
    return Response(content=png, media_type="image/png", headers={"Content-Disposition": f'inline; filename="belohnung-{award_id}.png"'})
