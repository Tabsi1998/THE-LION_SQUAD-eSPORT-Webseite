"""Profil (#1193): Turnierweg je Referenz und Bilanz gegen Gegner.

- ``GET /api/profile/{name}/tournaments/{turnier}/path``  der Weg durch ein Turnier (Runden, Gegner, Endplatz)
- ``GET /api/profile/{name}/record``                      die fünf häufigsten Gegner mit Siegen und Niederlagen

Ohne Anmeldung oder für andere: nur bei öffentlichem Profil, öffentliche Turniere und Gegner mit öffentlichem Profil.
Die Person selbst sieht alles - außer sie schaut mit ``view_as=public`` („So sehen dich andere“).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from auth import get_optional_user
from database import get_db
from services import profile_record

router = APIRouter(prefix="/api/profile", tags=["profile"])


async def _owner_and_view(username: str, viewer: dict | None, view_as: str | None) -> tuple[dict, bool]:
    db = get_db()
    owner = await profile_record.owner_by_username(db, username)
    if not owner:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    public = not profile_record.is_self(viewer, owner, view_as)
    if public and not owner.get("privacy_public_profile"):
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    return owner, public


@router.get("/{username}/record")
async def opponent_record(username: str, view_as: str | None = None, viewer: dict | None = Depends(get_optional_user)):
    owner, public = await _owner_and_view(username, viewer, view_as)
    return {"opponents": await profile_record.record_for(get_db(), owner, public=public), "public": public}


@router.get("/{username}/tournaments/{tournament}/path")
async def tournament_path(username: str, tournament: str, view_as: str | None = None, viewer: dict | None = Depends(get_optional_user)):
    owner, public = await _owner_and_view(username, viewer, view_as)
    path = await profile_record.path_for(get_db(), owner, tournament, public=public)
    if not path:
        raise HTTPException(status_code=404, detail="Diesen Turnierweg gibt es nicht oder er ist nicht öffentlich.")
    return {**path, "public": public}
