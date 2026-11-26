"""Saisonende-Moment (#1639, docs/LIGA.md „F.8 Saisonende-Moment“) - nur eigene.

- ``GET  /api/me/league-moments/unseen``: Aufstieg, Abstieg und Meister, die die Person noch nicht gesehen hat - aus dem bestätigten
  Endstand der ganzen Season, nur aus Seasons, die sie sieht (nie „Aus“).
- ``POST /api/me/league-moments/seen`` ``{ids, token}``: für dieses Gerät holen (``token``: Schlüssel des Geräts). Antwortet mit
  ``claimed``: nur diese werden gezeigt - ein zweites Gerät bekommt denselben Moment nicht, dasselbe Gerät nach einer verlorenen
  Antwort schon wieder.
- ``POST /api/me/league-moments/done`` ``{ids}``: gezeigt und geschlossen - danach kommt der Moment nirgends mehr.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from auth import get_current_user
from database import get_db
from services import league_moments

router = APIRouter(prefix="/api", tags=["league-moments"])


class SeenBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ids: list[str] = Field(default_factory=list, max_length=20)
    token: str = Field(min_length=8, max_length=80)


class DoneBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ids: list[str] = Field(default_factory=list, max_length=20)


@router.get("/me/league-moments/unseen")
async def my_unseen_league_moments(user: dict = Depends(get_current_user)):
    return {"moments": await league_moments.unseen_for(get_db(), user)}


@router.post("/me/league-moments/seen")
async def my_league_moments_seen(body: SeenBody, user: dict = Depends(get_current_user)):
    return {"ok": True, "claimed": await league_moments.claim(get_db(), user["id"], body.ids, body.token)}


@router.post("/me/league-moments/done")
async def my_league_moments_done(body: DoneBody, user: dict = Depends(get_current_user)):
    return {"ok": True, "done": await league_moments.done(get_db(), user["id"], body.ids)}
