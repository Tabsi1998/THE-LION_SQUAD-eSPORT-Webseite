"""Gemeinsamer Router für alle Turnierendpunkte unter /api/tournaments.

Die Fachmodule hängen ihre Endpunkte direkt an diesen einen Router. So bleibt
`router.routes` eine flache Liste wie vor der Aufteilung. Ein verschachteltes
include_router würde die Routen ab FastAPI 0.141 nur noch als Verweis auf den
Teilrouter führen.
"""
from fastapi import APIRouter

router = APIRouter(prefix="/api/tournaments", tags=["tournaments"])
