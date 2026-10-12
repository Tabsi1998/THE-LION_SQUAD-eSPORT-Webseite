"""Das Event als Klammer (#1182): die kurzen Listen von Turnieren und Fast Laps sagen, zu welchem Event sie gehören und
wann sie enden - die Event-Liste im Web stellt sie damit unter ihr Event, statt sie ein zweites Mal zu zeigen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_compact_lists_name_their_event(flow):
    await flow.db.events.insert_one({"id": "e-lan", "slug": "herbst-lan", "name": "Herbst-LAN", "status": "scheduled", "visibility": "public"})
    await flow.create_tournament(id="t-lan", slug="lan-cup", event_id="e-lan", start_date="2099-10-10T12:00:00+00:00",
                                 end_date="2099-10-10T18:00:00+00:00", team_mode="team")
    await flow.create_tournament(id="t-solo", slug="solo-cup")
    await flow.db.f1_challenges.insert_many([
        {"id": "f-lan", "slug": "lan-lap", "title": "LAN Fast Lap", "status": "live", "visibility": "public", "event_id": "e-lan",
         "start_date": "2099-10-10T10:00:00+00:00", "end_date": "2099-10-11T20:00:00+00:00"},
        {"id": "f-solo", "slug": "solo-lap", "title": "Fast Lap", "status": "live", "visibility": "public"},
    ])
    flow.act_as(None)

    tournaments = {row["id"]: row for row in (await flow.get("/api/tournaments", params={"compact": "true"})).json()}
    assert tournaments["t-lan"]["event_id"] == "e-lan" and tournaments["t-lan"]["end_date"] and tournaments["t-lan"]["team_mode"] == "team"
    assert tournaments["t-solo"]["event_id"] is None

    challenges = {row["id"]: row for row in (await flow.get("/api/f1/challenges", params={"compact": "true"})).json()}
    assert challenges["f-lan"]["event_id"] == "e-lan" and challenges["f-lan"]["end_date"].startswith("2099-10-11")
    assert challenges["f-solo"]["event_id"] is None


@pytest.mark.asyncio
async def test_lists_do_not_reveal_an_event_the_viewer_cannot_see(flow):
    """Codex-Prüfung #1473: ein öffentliches Turnier an einem internen Event verrät dessen Kennung nicht - in der kurzen
    und in der vollen Liste. Wer das Event sehen darf, bekommt sie."""
    await flow.db.events.insert_many([
        {"id": "e-intern", "slug": "klausur", "name": "Vorstandsklausur", "status": "scheduled", "visibility": "internal"},
        {"id": "e-public", "slug": "lan", "name": "Herbst-LAN", "status": "scheduled", "visibility": "public"},
        {"id": "e-draft", "slug": "entwurf", "name": "Entwurf", "status": "draft", "visibility": "public"},
    ])
    await flow.create_tournament(id="t-intern", slug="geheim-cup", event_id="e-intern")
    await flow.create_tournament(id="t-public", slug="lan-cup", event_id="e-public")
    await flow.create_tournament(id="t-draft", slug="entwurf-cup", event_id="e-draft")
    await flow.db.f1_challenges.insert_one({"id": "f-intern", "slug": "geheim-lap", "title": "Geheime Lap", "status": "live",
                                            "visibility": "public", "event_id": "e-intern"})

    async def links(params=None):
        tournaments = {row["id"]: row.get("event_id") for row in (await flow.get("/api/tournaments", params=params)).json()}
        laps = {row["id"]: row.get("event_id") for row in (await flow.get("/api/f1/challenges", params=params)).json()}
        return tournaments, laps

    flow.act_as(None)
    for params in ({"compact": "true"}, None):
        tournaments, laps = await links(params)
        assert tournaments["t-intern"] is None and laps["f-intern"] is None, f"keine interne Kennung ({params})"
        assert tournaments["t-draft"] is None, "auch kein Entwurf"
        assert tournaments["t-public"] == "e-public", "Gegenprobe: das öffentliche Event bleibt verknüpft"

    admin = await flow.add_user(role="club_admin", name="verwaltung")
    flow.act_as(admin)
    tournaments, laps = await links({"compact": "true"})
    assert tournaments["t-intern"] == "e-intern" and laps["f-intern"] == "e-intern", "die Verwaltung sieht das interne Event"
