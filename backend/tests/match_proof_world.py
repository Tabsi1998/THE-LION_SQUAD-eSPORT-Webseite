"""Helfer für die Tests des Nachweis-Bausteins (#2360). Erfundene Namen.

Baut auf der Liga-Welt (``league_match_world.world``: Löwen gegen Falken) auf. Vorfälle und Verfahren werden in der Form des
Vertrags (docs/LIGA.md, „D.5/E.2-Vertrag“) direkt ans Spiel geschrieben - die Abläufe dazu bauen D.5 und E.2.
"""
from __future__ import annotations

import io
from datetime import timedelta

from PIL import Image

from models import now_utc

VIDEO = "https://video.example/clip?v=abc123"


def picture() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (80, 60), (30, 120, 200)).save(buffer, format="JPEG")
    return buffer.getvalue()


async def add_image(flow, match, kind="report", ref_id=""):
    return await flow.post(f"/api/matches/{match['id']}/proofs", data={"kind": kind, "ref_id": ref_id},
                           files={"file": ("beleg.jpg", picture(), "image/jpeg")})


async def add_link(flow, match, kind="report", ref_id="", link=VIDEO):
    return await flow.post(f"/api/matches/{match['id']}/proofs", data={"kind": kind, "ref_id": ref_id, "link": link})


async def listed(flow, match, kind="report", ref_id=""):
    return await flow.get(f"/api/matches/{match['id']}/proofs", params={"kind": kind, "ref_id": ref_id})


async def ids_seen(flow, match, kind="report", ref_id="") -> set[str]:
    response = await listed(flow, match, kind, ref_id)
    assert response.status_code == 200, response.text
    return {item["id"] for item in response.json()["items"]}


async def set_match(flow, w, **fields) -> None:
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": fields})


def protest(w, **extra) -> dict:
    """Ein Verfahren der Falken nach dem Vertrag (``disputes[]`` mit ``id`` und ``kind``)."""
    return {"id": "verfahren-1", "kind": "protest", "registration_id": w["reg_h"]["id"], "user_id": w["users"]["Falke1"]["id"],
            "reason": "Verdacht auf unerlaubte Hilfsmittel", "at": now_utc().isoformat(), **extra}


async def season(flow, w, **fields) -> dict:
    """Die Season der Staffel: begann vor drei Wochen und hat vier Spielwochen - sie endet also in etwa einer Woche."""
    doc = {"id": w["season_id"], "league_id": "liga", "number": 1, "name": "Season 1", "matchday_days": 7, "weeks_total": 4,
           "start_date": (now_utc() - timedelta(weeks=3)).isoformat(), **fields}
    await flow.db.league_seasons.insert_one(dict(doc))
    return doc


def user(w, name: str) -> dict:
    return w["users"][name]
