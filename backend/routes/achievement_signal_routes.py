"""Kleine Ereignisse für die Erfolge (#616): Signale vom Client, GG-Lob nach dem Match, Gelesen-Marker für
News, Zuschauer-Ping für Streams. Alles nur mit Anmeldung, alles gedeckelt, nichts davon zeigt anderen,
wer was getan hat - die Zähler sind das Einzige, was nach außen geht.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth import get_current_user
from database import get_db
from models import new_id, now_utc
from services import achievement_counters as counters
from services.rate_limit import enforce_rate_limit

router = APIRouter(tags=["achievement-signals"])
logger = logging.getLogger("tls.achievements.signals")


class SignalBody(BaseModel):
    name: str = Field(min_length=2, max_length=40)
    count: int = Field(1, ge=1, le=200)
    # Nachmelden (#678): der Tag, an dem gesammelt wurde - ohne Angabe heute.
    day: str | None = Field(None, max_length=10)


class SignalBatch(BaseModel):
    items: list[SignalBody] = Field(min_length=1, max_length=40)


@router.post("/api/achievements/signal")
async def post_signal(body: SignalBody, request: Request, me: dict = Depends(get_current_user)):
    """Ein Signal melden (Kürbis, Konami, Schneeflocken …). Unbekannte Namen sind ein Fehler, Deckel und
    Saison entscheidet der Server."""
    await enforce_rate_limit(request, "achievement_signal", 30, 60, subject=me["id"])
    if body.name not in counters.SIGNAL_RULES:
        raise HTTPException(400, "Dieses Signal gibt es nicht.")
    result = await counters.record_signal(me["id"], body.name, body.count, body.day)
    if result.get("accepted"):
        from services.achievement_queue import request_evaluation
        await request_evaluation([me["id"]], f"signal:{body.name}", sources={"signal"})
    return result


@router.post("/api/achievements/signals")
async def post_signals(body: SignalBatch, request: Request, me: dict = Depends(get_current_user)):
    """Mehrere Signale auf einmal (#678): was der Client gesammelt hat, seit er zuletzt melden konnte - auch von den
    Tagen davor. Jede Zeile bekommt ihre eigene Antwort; eine unbekannte oder abgelehnte Zeile hält die anderen nicht
    auf. Danach wird sofort ausgewertet - nur die Zähler aus Signalen, damit die neue Stufe gleich gefeiert werden
    kann (``newly_awarded``). Geht das schief, holt es die Warteschlange nach."""
    await enforce_rate_limit(request, "achievement_signal_batch", 12, 60, subject=me["id"])
    results = []
    for item in body.items:
        outcome = await counters.record_signal(me["id"], item.name, item.count, item.day)
        results.append({"name": item.name, "day": outcome.get("day") or item.day, **{k: v for k, v in outcome.items() if k != "day"}})
    accepted = sorted({row["name"] for row in results if row.get("accepted")})
    newly = 0
    if accepted:
        try:
            from badges import evaluate_user_progress
            newly = int(await evaluate_user_progress(me["id"], {"signal"}, legacy=False) or 0)
        except Exception:  # noqa: BLE001 - die Zählung steht; ausgewertet wird dann über die Warteschlange
            logger.warning("[achievements] signal evaluation failed for %s", me["id"], exc_info=True)
            from services.achievement_queue import request_evaluation
            await request_evaluation([me["id"]], f"signals:{','.join(accepted)}"[:120], sources={"signal"})
    return {"results": results, "accepted": sum(1 for row in results if row.get("accepted")), "newly_awarded": newly}


# ------------------------------------------------------------------ GG-Lob

async def _sides(db, match: dict) -> dict[str, set[str]]:
    """registration_id → Personen dahinter (direkt oder als Teammitglied)."""
    ids = [slot.get("registration_id") for slot in match.get("slots") or [] if slot.get("registration_id")]
    regs = await db.tournament_registrations.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "user_id": 1, "team_id": 1}).to_list(50)
    team_ids = [r["team_id"] for r in regs if r.get("team_id")]
    teams = {t["id"]: t async for t in db.teams.find({"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "member_ids": 1})} if team_ids else {}
    out: dict[str, set[str]] = {}
    for reg in regs:
        people = set()
        if reg.get("user_id"):
            people.add(reg["user_id"])
        if reg.get("team_id"):
            people |= set((teams.get(reg["team_id"]) or {}).get("member_ids") or [])
        out[reg["id"]] = people
    return out


async def _commend_state(db, match_id: str, user_id: str) -> dict:
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0, "id": 1, "status": 1, "slots": 1})
    if not match:
        raise HTTPException(404, "Match nicht gefunden.")
    sides = await _sides(db, match)
    mine = [reg_id for reg_id, people in sides.items() if user_id in people]
    others = [reg_id for reg_id in sides if reg_id not in mine]
    given = await db.match_commendations.find_one({"match_id": match_id, "from_registration_id": {"$in": mine}}, {"_id": 0}) if mine else None
    received = await db.match_commendations.count_documents({"match_id": match_id, "to_registration_id": {"$in": mine}}) if mine else 0
    return {
        "match": match, "mine": mine, "others": others,
        "state": {"participant": bool(mine), "completed": match.get("status") == "completed", "can_commend": bool(mine) and len(others) == 1 and match.get("status") == "completed" and given is None,
                  "given": given is not None, "received": received},
    }


@router.get("/api/matches/{match_id}/commend")
async def get_commend(match_id: str, me: dict = Depends(get_current_user)):
    return (await _commend_state(get_db(), match_id, me["id"]))["state"]


@router.post("/api/matches/{match_id}/commend")
async def post_commend(match_id: str, me: dict = Depends(get_current_user)):
    """GG: eine Seite lobt die andere - einmal je Match und Seite, nur nach dem Ende, nur Beteiligte."""
    db = get_db()
    info = await _commend_state(db, match_id, me["id"])
    if not info["state"]["participant"]:
        raise HTTPException(403, "Nur wer mitgespielt hat, kann GG geben.")
    if not info["state"]["completed"]:
        raise HTTPException(400, "GG gibt es erst nach dem Match.")
    if info["state"]["given"]:
        return {**info["state"], "already": True}
    if len(info["others"]) != 1:
        raise HTTPException(400, "Für dieses Match gibt es keinen Gegner zum Loben.")
    doc = {"id": new_id(), "match_id": match_id, "from_registration_id": info["mine"][0], "to_registration_id": info["others"][0], "from_user_id": me["id"], "created_at": now_utc().isoformat()}
    await db.match_commendations.insert_one(doc)
    sides = await _sides(db, info["match"])
    from services.achievement_queue import request_evaluation
    await request_evaluation([me["id"], *sides.get(info["others"][0], set())], "commend", sources={"match"})
    state = (await _commend_state(db, match_id, me["id"]))["state"]
    return {**state, "already": False}


# ------------------------------------------------------------------ Gelesen und gesehen

@router.post("/api/news/{slug}/read")
async def mark_news_read(slug: str, me: dict = Depends(get_current_user)):
    """Ein Aufruf mit Anmeldung zählt als gelesen - nur die Zahl, keine Liste in der API."""
    db = get_db()
    post = await db.news.find_one({"$or": [{"slug": slug}, {"id": slug}], "status": {"$nin": ["draft"]}}, {"_id": 0, "id": 1})
    if not post:
        raise HTTPException(404, "Beitrag nicht gefunden.")
    result = await db.news_reads.update_one({"user_id": me["id"], "news_id": post["id"]}, {"$setOnInsert": {"user_id": me["id"], "news_id": post["id"], "read_at": now_utc().isoformat()}}, upsert=True)
    if result.upserted_id is not None:
        from services.achievement_queue import request_evaluation
        await request_evaluation([me["id"]], "news_read", sources={"community"})
    return {"read": True, "total": await db.news_reads.count_documents({"user_id": me["id"]})}


class WatchBody(BaseModel):
    key: str = Field(min_length=2, max_length=120)


@router.post("/api/streams/watch")
async def stream_watched(body: WatchBody, me: dict = Depends(get_current_user)):
    """Zuschauer-Ping: ein eingebetteter Stream wurde geöffnet - eins je Stream und Tag."""
    db = get_db()
    day = now_utc().astimezone(counters.VIENNA).date().isoformat()
    result = await db.stream_watches.update_one({"user_id": me["id"], "key": body.key.strip(), "day": day}, {"$setOnInsert": {"user_id": me["id"], "key": body.key.strip(), "day": day, "at": now_utc().isoformat()}}, upsert=True)
    if result.upserted_id is not None:
        from services.achievement_queue import request_evaluation
        await request_evaluation([me["id"]], "stream_watch", sources={"stream"})
    return {"watched": True, "total": await db.stream_watches.count_documents({"user_id": me["id"]})}
