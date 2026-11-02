"""Aufbau über die echten Routen für die Tests zum Regelwerk (docs/LIGA.md, #1646). Erfundene Namen und Regeln.

Liga, Season (öffentlich) mit Map-Pool und Modusfolge, Liga 1, Staffel A im Entwurf mit zwei zugeteilten Co-Teams.
"""
from __future__ import annotations

from datetime import date, timedelta

from league_start_world import add_staffel, ok, season_body
from services.dolibarr_policy import club_today

ADMIN_LEAGUES = "/api/admin/leagues"
ADMIN = "/api/admin/league-rules"
PUBLIC = "/api/league-rules"
GAME = {"name": "Regel-Shooter", "slug": "regel-shooter", "match_modes": [
    {"mode": "stellung", "label": "Stellung"}, {"mode": "suchen", "label": "Suchen"}]}
BODY = ("Vorwort der Probe-Liga.\n\n# § 1 Fairplay\nFair spielen, immer.\n\n# § 2 Spielbetrieb\nEine Runde dauert zwanzig Minuten.\n\n"
        "## Maps\n[[baustein:map_pool]]\n\n## Modi\n[[baustein:mode_order]]\n")
ANNEXES = [{"title": "Strafen", "body_md": "Verwarnung, dann Punktabzug."}]


def today() -> str:
    return club_today()


def in_days(days: int) -> str:
    return (date.fromisoformat(club_today()) + timedelta(days=days)).isoformat()


async def make_bare_world(flow, **season) -> dict:
    """Nur Liga und Season, ohne Staffel: Das lässt sich löschen, solange die Regeln es zulassen."""
    lead = await flow.add_staff()
    flow.act_as(lead)
    game = ok(await flow.post("/api/games", json=GAME))
    league = ok(await flow.post(ADMIN_LEAGUES, json={"name": "Regel-Liga", "game_id": game["id"]}))
    row = ok(await flow.post(f"{ADMIN_LEAGUES}/{league['id']}/seasons", json=season_body(**season)))
    return {"lead": lead, "game": game, "league": league, "season": row}


async def make_world(flow, *, visibility: str = "public", teams: int = 2, **season) -> dict:
    lead = await flow.add_staff()
    flow.act_as(lead)
    game = ok(await flow.post("/api/games", json=GAME))
    maps = {}
    for name, modes in (("Hafenkante", ["stellung", "suchen"]), ("Nebelwerk", ["suchen"]), ("Turmblick", ["stellung"])):
        maps[name] = ok(await flow.post(f"/api/games/{game['id']}/maps", json={"name": name, "modes": modes}))
    league = ok(await flow.post(ADMIN_LEAGUES, json={"name": "Regel-Liga", "game_id": game["id"]}))
    row = ok(await flow.post(f"{ADMIN_LEAGUES}/{league['id']}/seasons", json=season_body(
        visibility=visibility, game_mode_order=["stellung", "suchen", "stellung"], **season)))
    world = {"lead": lead, "game": game, "maps": maps, "league": league, "season": row}
    await save_pool(flow, world, {"stellung": ["Hafenkante"], "suchen": ["Nebelwerk"]})
    division = ok(await flow.post(f"{ADMIN_LEAGUES}/seasons/{row['id']}/divisions", json={}))
    tid = await add_staffel(flow, lead, division["id"], teams, game=game, prefix="A")
    regs = await flow.db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0}).to_list(None)
    squads = [await flow.db.team_squads.find_one({"id": reg["squad_id"]}, {"_id": 0}) for reg in regs]
    world.update(division=division, tid=tid, regs=regs, squads=squads)
    world["captain"] = await flow.db.users.find_one({"id": squads[0]["captain_id"]}, {"_id": 0})
    world["vice"] = await flow.db.users.find_one({"id": squads[0]["vice_captain_id"]}, {"_id": 0})
    world["other_captain"] = await flow.db.users.find_one({"id": squads[1]["captain_id"]}, {"_id": 0}) if teams > 1 else None
    world["member"] = await flow.db.users.find_one(
        {"id": next(uid for uid in squads[0]["member_ids"]
                    if uid not in (squads[0]["captain_id"], squads[0]["vice_captain_id"]))}, {"_id": 0})
    return world


async def save_pool(flow, world: dict, modes: dict[str, list[str]]) -> None:
    flow.act_as(world["lead"])
    ok(await flow.put(f"{ADMIN_LEAGUES}/seasons/{world['season']['id']}/map-pool", json={"modes": [
        {"mode": mode, "map_ids": [world["maps"][name]["id"] for name in names]} for mode, names in modes.items()]}))


def season_scope(world: dict) -> str:
    return f"{ADMIN}/league_season/{world['season']['id']}"


def league_scope(world: dict) -> str:
    return f"{ADMIN}/league/{world['league']['id']}"


def season_page(world: dict) -> str:
    return f"{PUBLIC}/seasons/{world['league']['slug']}/{world['season']['slug']}"


def league_page(world: dict) -> str:
    return f"{PUBLIC}/leagues/{world['league']['slug']}"


async def publish(flow, world: dict, *, scope: str | None = None, body: str = BODY, annexes=None, title: str = "Regelwerk",
                  valid_from: str | None = None, reason: str = "Fassung für die Season", requires_consent: bool = False) -> dict:
    """Entwurf speichern und veröffentlichen - gibt die Fassung zurück."""
    target = scope or season_scope(world)
    flow.act_as(world["lead"])
    current = ok(await flow.get(target)).get("draft")
    draft = ok(await flow.put(f"{target}/draft", json={
        "title": title, "body_md": body, "annexes": ANNEXES if annexes is None else annexes,
        **({"revision": current["revision"]} if current else {})}))
    return ok(await flow.post(f"{target}/publish", json={
        "revision": draft["revision"], "valid_from": valid_from or today(), "change_reason": reason,
        "requires_consent": requires_consent}))
