"""Aufbau für die Tests zu Playoffs und Relegation (#2404, docs/LIGA.md „F.6“) - über die echten Routen, mit erfundenen Namen.

Eine Liga mit ``levels`` Liga N; je Liga N Staffeln mit den Größen aus ``staffeln`` (Vorgabe: eine mit vier Co-Teams). Jede Staffel
ist gespielt: Das Team mit dem kleineren Namen gewinnt, die Tabelle steht also 1, 2, 3 … in der Reihenfolge der Namen.
"""
from __future__ import annotations

from datetime import timedelta

from league_start_world import ADMIN, GAME, add_staffel, ok, season_body
from models import now_utc

STAFFELN = f"{ADMIN}/staffeln"
LONG_AGO = (now_utc() - timedelta(days=90)).isoformat()


async def regs_of(flow, tid: str) -> list[dict]:
    rows = await flow.db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0}).to_list(None)
    return sorted(rows, key=lambda row: row["display_name"])


async def play(flow, tid: str, *, score: int = 2) -> list[dict]:
    regs = await regs_of(flow, tid)
    strength = {row["id"]: index for index, row in enumerate(regs)}
    for match in await flow.db.matches_v2.find({"tournament_id": tid, "is_preview": {"$ne": True}}, {"_id": 0}).to_list(None):
        sides = [slot["registration_id"] for slot in match.get("slots") or [] if slot.get("registration_id")]
        if len(sides) != 2:
            continue
        winner, loser = sorted(sides, key=lambda value: strength[value])
        await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {
            "status": "completed", "completed_at": LONG_AGO,
            "results": [{"registration_id": winner, "rank": 1, "score": score}, {"registration_id": loser, "rank": 2, "score": 0}]}})
    return regs


async def build(flow, *, levels: int = 1, staffeln: dict | None = None, zones: dict | None = None, season: dict | None = None,
                postseason: dict | None = None, division_postseason: dict | None = None) -> dict:
    """``staffeln``: {level: [Größe, …]}; ``zones``: {level: {...}}; ``postseason``: die Vorlage der Season;
    ``division_postseason``: {level: Abweichung}. Alles vor dem ersten Abschluss gesetzt."""
    lead = await flow.add_staff()
    flow.act_as(lead)
    game = ok(await flow.post("/api/games", json=GAME))
    league = ok(await flow.post(ADMIN, json={"name": "Playoff-Liga", "game_id": game["id"]}))
    row = ok(await flow.post(f"{ADMIN}/{league['id']}/seasons", json=season_body(application_slots=40, best_of=3, team_size=4,
                                                                                  **(season or {}))))
    world = {"lead": lead, "game": game, "league": league, "season": row, "divisions": {}, "tids": {}, "regs": {}}
    for level in range(1, levels + 1):
        body = {"zones": zones[level]} if zones and zones.get(level) else {}
        division = ok(await flow.post(f"{ADMIN}/seasons/{row['id']}/divisions", json=body))
        world["divisions"][level] = division
        world["tids"][level] = []
        for index, size in enumerate((staffeln or {}).get(level, [4])):
            letter = "ABCDEFGH"[index]
            tid = await add_staffel(flow, lead, division["id"], size, game=game, prefix=f"L{level}{letter}")
            flow.act_as(lead)
            ok(await flow.post(f"/api/tournaments/{tid}/status", json={"status": "live"}))
            world["tids"][level].append(tid)
            world["regs"][tid] = await play(flow, tid)
    flow.act_as(lead)
    if postseason is not None:
        ok(await flow.put(f"{ADMIN}/seasons/{row['id']}/postseason", json=postseason))
    for level, own in (division_postseason or {}).items():
        ok(await flow.put(f"{ADMIN}/divisions/{world['divisions'][level]['id']}/postseason", json=own))
    return world


async def close(flow, world: dict, *tids: str) -> None:
    flow.act_as(world["lead"])
    for tid in tids or [tid for rows in world["tids"].values() for tid in rows]:
        ok(await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}))


async def cockpit(flow, world: dict) -> dict:
    flow.act_as(world["lead"])
    return ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/postseason"))


def division_of(view: dict, level: int) -> dict:
    return next(row for row in view["divisions"] if row["level"] == level)


async def create(flow, world: dict, kind: str, level: int = 1, **extra):
    """Legt die Playoffs (``playoffs``) bzw. die Relegation (``relegation``) der Liga ``level`` an - mit dem Fingerabdruck der Vorschau."""
    view = await cockpit(flow, world)
    part = division_of(view, level)[kind]
    flow.act_as(extra.pop("actor", None) or world["lead"])
    return await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/postseason/{kind}", json={
        "division_id": world["divisions"][level]["id"], "stamp": part["stamp"], "confirm": True, **extra})


async def matches_of(flow, tid: str) -> list[dict]:
    rows = await flow.db.matches_v2.find({"tournament_id": tid, "is_preview": {"$ne": True}}, {"_id": 0}).to_list(None)
    return sorted(rows, key=lambda row: (row.get("round") or 0, row.get("order") or 0))


def sides(match: dict) -> list[str]:
    return [slot["registration_id"] for slot in match.get("slots") or [] if slot.get("registration_id")]


async def names_of(flow, tid: str) -> dict[str, str]:
    return {row["id"]: row["display_name"] async for row in flow.db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0})}


async def win(flow, match: dict, winner: str, *, score: tuple[int, int] = (2, 0)) -> None:
    """Ein Ergebnis über die echte Route der Turnierleitung - der Baum zieht den Sieger weiter."""
    loser = next(side for side in sides(match) if side != winner)
    answer = await flow.post(f"/api/matches/{match['id']}/result", json={"results": [
        {"registration_id": winner, "rank": 1, "score": score[0]}, {"registration_id": loser, "rank": 2, "score": score[1]}]})
    assert answer.status_code == 200, answer.text


async def play_round(flow, world: dict, tid: str, *, favourite: bool = True, score: tuple[int, int] = (2, 0)) -> list[dict]:
    """Spielt alle spielbereiten Duelle der Staffel: Es gewinnt der besser Gesetzte (``favourite``) bzw. der schlechter Gesetzte."""
    flow.act_as(world["lead"])
    seeds = {row["id"]: row.get("seed") or 0 async for row in flow.db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0})}
    done = []
    for match in await matches_of(flow, tid):
        both = sides(match)
        if len(both) != 2 or match.get("status") in ("completed", "forfeit", "cancelled"):
            continue
        ordered = sorted(both, key=lambda value: seeds[value])
        await win(flow, match, ordered[0] if favourite else ordered[1], score=score)
        done.append(match)
    return done


async def settle(flow, tid: str) -> None:
    """Fristen vorbei: Die gespielten Spiele liegen weit zurück, damit der Abschluss keine laufende Protestfrist sieht."""
    await flow.db.matches_v2.update_many({"tournament_id": tid, "status": {"$in": ["completed", "forfeit"]}},
                                         {"$set": {"completed_at": LONG_AGO, "confirmed_at": LONG_AGO, "updated_at": LONG_AGO}})
