"""Vergleichstest Referenzen (#1741): Serien kommen als neues Eltern-Objekt dazu, die bestehenden Referenzen bleiben
unangetastet. ``/api/references`` (Liste der Website und der App) und die Detailseite liefern für feste Referenzen genau
das, was sie vor den Serien geliefert haben - festgehalten in ``golden/references_api.json``.

Die Datei entstand auf dem Stand vor #1741. Schlägt der Test an, hat sich die Antwort verändert: Ist das gewollt (nur
neue Felder sind erlaubt, die App liest die Form), die Datei bewusst neu schreiben - nie einfach überschreiben."""
import json
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

GOLDEN = pathlib.Path(__file__).resolve().parent / "golden" / "references_api.json"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def fill_references(db) -> None:
    """Referenzen in allen Formen, die es gibt: alter Titel mit einer Platzierung, Einträge (Team und Einzel), Partner,
    Spiel-Edition, nicht öffentlich, abgeschaltet. Nur erfundene Namen."""
    await db.games.insert_many([
        {"id": "g-rl", "name": "Rocket League", "slug": "rocket-league", "short_name": "RL", "logo_url": "/logos/rl.webp"},
        {"id": "g-cod", "name": "Call of Duty", "slug": "call-of-duty", "short_name": "CoD"},
        {"id": "g-bo", "name": "Black Ops", "slug": "black-ops", "kind": "edition", "parent_game_id": "g-cod"},
    ])
    await db.partners.insert_one({"id": "partner-1", "slug": "probe-verein", "name": "Probe Verein", "kind": "verein",
                                  "logo_url": "/logos/probe.webp", "is_active": True})
    await db.club_member_profiles.insert_many([
        {"id": "p-anna", "display_name": "Anna Probe", "gamertag": "Anni", "slug": "anni", "photo_url": "/a.webp", "is_active": True},
        {"id": "p-ben", "display_name": "Ben Beispiel", "gamertag": "Benny", "slug": "benny", "is_active": True},
    ])
    await db.references.insert_many([
        {"id": "ref-alt", "title": "[PS] HC | Liga X | Herbst Cup Season 3", "organizer": "Probe Liga", "game_id": "g-rl",
         "team_name": "Löwen Probe", "lineup": ["Max Muster"], "member_profile_ids": ["p-anna"],
         "lineup_members": [{"profile_id": "p-anna", "display_name": "Anni"}], "placement": 2, "participant_count": 16,
         "start_date": "2025-11-02", "mode": "online", "visibility": "public", "status": "completed", "is_active": True,
         "order_index": 0},
        {"id": "ref-eintraege", "title": "Winter Open", "organizer": "Probe Verein", "partner_ids": ["partner-1"],
         "league": "Liga A", "season": "Season 5", "format": "CORE", "platforms": ["PC"], "game_id": "g-bo",
         "entries": [
             {"id": "e1", "kind": "solo", "member_profile_ids": ["p-anna"], "lineup": [],
              "lineup_members": [{"profile_id": "p-anna", "display_name": "Anni"}], "placement": 1, "participant_count": 32},
             {"id": "e2", "kind": "team", "team_name": "Löwen Zwei", "member_profile_ids": ["p-ben"], "lineup": ["Gast Gustav"],
              "lineup_members": [{"profile_id": "p-ben", "display_name": "Benny"}], "placement": 5, "team_count": 8},
         ],
         "placement": 1, "start_date": "2026-01-10", "end_date": "2026-01-11", "mode": "hybrid", "visibility": "public",
         "status": "active", "is_active": True, "order_index": 1, "external_url": "https://example.test/winter"},
        {"id": "ref-ohne-platz", "title": "Sommer Liga", "game_name": "Mario Kart", "lineup": ["Lea Leer"], "visibility": "public",
         "status": "planned", "is_active": True, "start_date": "2026-07-01"},
        {"id": "ref-intern", "title": "Interner Test", "visibility": "internal", "status": "completed", "is_active": True},
        {"id": "ref-aus", "title": "Abgeschaltet", "visibility": "public", "status": "completed", "is_active": False},
    ])


async def snapshot(flow) -> dict:
    flow.act_as(None)
    listing = await flow.get("/api/references")
    detail = await flow.get("/api/references/ref-eintraege")
    by_game = await flow.get("/api/references", params={"game_id": "g-rl"})
    assert listing.status_code == detail.status_code == by_game.status_code == 200
    return {"list": listing.json(), "detail": detail.json(), "by_game": by_game.json()}


@pytest.mark.asyncio
async def test_references_answer_exactly_as_before_series_existed(flow):
    await fill_references(flow.db)
    current = await snapshot(flow)
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert current == golden
