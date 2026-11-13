"""Turniere: die noch gültigen Fälle der alten Live-Tests, jetzt durch die echten Routen (#932).

Anlegen speichert Gewinne und Twitch; der Status lässt sich auf „geplant“ setzen, ein unbekannter nicht; ein Entwurf
bleibt für Gäste unsichtbar - auf der Turnierseite und auf der Startseite; Stream-Felder und Saison-Gewicht werden
gespeichert; Schweizer Runden und Gruppen gibt es nur im passenden Format; das Bracket-Widget verrät keine Notizen oder
Discord-Namen; die PDF-Exporte liefern der Leitung echte PDFs, das Ergebnis-PDF Gästen erst nach dem Ende; Spiele legt
nur die Turnierleitung an.

Ersetzt:
- test_phase4_features.py::test_create_tournament_with_prize_and_twitch
- test_phase567.py::test_set_status_to_scheduled
- test_phase567.py::test_set_status_invalid
- test_phase567.py::test_get_draft_anon_404
- test_phase567.py::test_get_draft_admin_200
- test_phase567.py::test_patch_stream_fields
- test_phase567.py::test_patch_season_weight
- test_phase567.py::test_home_state_hides_drafts
- test_phase2_3.py::TestSwissGroups (beide Fälle)
- test_phase2_3.py::TestWidgets::test_tournament_bracket_widget_no_sensitive_fields
- test_phase2_3.py::TestPDFExports (checkin, matches, stations, stations quer, standings)
- test_tls_arena_api.py::TestGames::test_create_game_unauthenticated_401
- test_tls_arena_api.py::TestGames::test_create_game_player_403
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id, now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_creating_a_tournament_stores_prizes_and_twitch(flow):
    flow.act_as(await flow.add_staff())
    await flow.db.games.insert_one({"id": "g1", "name": "Rocket League", "slug": "rocket-league"})
    prizes = [{"group": "overall", "place": place, "label": f"{place}. Platz", "value": value}
              for place, value in ((1, "Pokal"), (2, "Kappe"), (3, "Sticker"))]
    created = await flow.post("/api/tournaments", json={
        "title": "Herbst-Cup", "game_id": "g1", "format": "single_elim", "team_mode": "solo", "max_participants": 8,
        "prize_places": prizes, "twitch_channel": "vereinskanal", "twitch_enabled": True,
    })
    assert created.status_code == 200, created.text
    assert created.json()["status"] == "draft"

    stored = await flow.get(f"/api/tournaments/{created.json()['id']}")
    assert stored.status_code == 200, stored.text
    data = stored.json()
    assert data["prize_places"] == prizes
    assert data["twitch_channel"] == "vereinskanal" and data["twitch_enabled"] is True


@pytest.mark.asyncio
async def test_status_can_be_set_to_scheduled_but_not_to_an_unknown_value(flow):
    tournament = await flow.create_tournament(status="draft")
    flow.act_as(await flow.add_staff())

    scheduled = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "scheduled"})
    assert scheduled.status_code == 200, scheduled.text
    assert (await flow.db.tournaments.find_one({"id": tournament["id"]}))["status"] == "scheduled"

    unknown = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "foo"})
    assert unknown.status_code == 400, unknown.text
    assert (await flow.db.tournaments.find_one({"id": tournament["id"]}))["status"] == "scheduled"


@pytest.mark.asyncio
async def test_a_draft_is_hidden_from_guests_and_open_to_the_lead(flow):
    draft = await flow.create_tournament(status="draft")
    flow.act_as(None)
    hidden = await flow.get(f"/api/tournaments/{draft['id']}")
    assert hidden.status_code == 404, hidden.text

    flow.act_as(await flow.add_staff())
    shown = await flow.get(f"/api/tournaments/{draft['id']}")
    assert shown.status_code == 200, shown.text
    assert shown.json()["id"] == draft["id"]


@pytest.mark.asyncio
async def test_stream_fields_and_season_weight_are_saved(flow):
    tournament = await flow.create_tournament(status="registration_open")
    flow.act_as(await flow.add_staff())

    patched = await flow.patch(f"/api/tournaments/{tournament['id']}", json={
        "has_live_stream": True, "stream_platform": "twitch", "stream_url": "https://www.twitch.tv/vereinskanal",
        "season_weight": 3.0,
    })
    assert patched.status_code == 200, patched.text
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    assert stored["has_live_stream"] is True
    assert stored["stream_platform"] == "twitch"
    assert stored["stream_url"] == "https://www.twitch.tv/vereinskanal"
    assert stored["season_weight"] == 3.0


@pytest.mark.asyncio
async def test_home_state_hides_drafts_but_shows_the_same_public_tournament(flow):
    from routes.home_routes import _today_window

    window_start, window_end = _today_window()
    today = (window_start + (window_end - window_start) / 2).isoformat()
    in_three_days = (now_utc() + timedelta(days=3)).isoformat()
    drafts = [await flow.create_tournament(title="Entwurf heute", status="draft", start_date=today),
              await flow.create_tournament(title="Entwurf bald", status="draft", start_date=in_three_days)]
    public_today = await flow.create_tournament(title="Offen heute", status="scheduled", start_date=today)
    public_soon = await flow.create_tournament(title="Offen bald", status="scheduled", start_date=in_three_days)

    flow.act_as(None)
    state = await flow.get("/api/home/state")
    assert state.status_code == 200, state.text
    data = state.json()
    shown = {block: {row["id"] for row in data[block]["tournaments"]} for block in ("live", "today", "soon", "upcoming")}
    for draft in drafts:
        assert all(draft["id"] not in ids for ids in shown.values()), shown
    assert public_today["id"] in shown["today"]
    assert public_soon["id"] in shown["soon"] and public_soon["id"] in shown["upcoming"]


@pytest.mark.asyncio
async def test_swiss_rounds_and_groups_only_in_their_format(flow):
    tournament = await flow.create_tournament(format="single_elim")
    flow.act_as(await flow.add_staff())

    swiss = await flow.post(f"/api/tournaments/{tournament['id']}/swiss/next-round")
    assert swiss.status_code == 400, swiss.text
    groups = await flow.post(f"/api/tournaments/{tournament['id']}/groups/generate", json={})
    assert groups.status_code == 400, groups.text
    assert await flow.db.matches_v2.count_documents({"tournament_id": tournament["id"]}) == 0


@pytest.mark.asyncio
async def test_bracket_widget_hides_notes_and_discord_and_unpublished_tournaments(flow):
    tournament = await flow.create_tournament(status="registration_open")
    anna = await flow.add_user(name="anna")
    registration = await flow.register(tournament, anna)
    await flow.db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {
        "notes": "Kommt eine Stunde später", "discord_username": "anna#0001", "discord_id": "123456789",
        "ingame_name": "AnnaRL",
    }})

    widget = await flow.get(f"/api/widgets/tournament/{tournament['slug']}/bracket")
    assert widget.status_code == 200, widget.text
    rows = widget.json()["registrations"]
    assert [row["id"] for row in rows] == [registration["id"]]
    assert rows[0]["ingame_name"] == "AnnaRL"
    assert not any(key == "notes" or "discord" in key for key in rows[0])
    assert "Kommt eine Stunde" not in widget.text and "anna#0001" not in widget.text and "123456789" not in widget.text

    draft = await flow.create_tournament(status="draft")
    assert (await flow.get(f"/api/widgets/tournament/{draft['slug']}/bracket")).status_code == 404
    hidden = await flow.create_tournament(is_public=False)
    assert (await flow.get(f"/api/widgets/tournament/{hidden['slug']}/bracket")).status_code == 404


def assert_pdf(response):
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")


@pytest.mark.asyncio
async def test_pdf_exports_for_the_lead_and_results_for_guests_only_after_the_end(flow):
    tournament, _users, _registrations = await flow.with_participants(4)
    await flow.db.stations.insert_one({"id": new_id(), "tournament_id": tournament["id"], "name": "Station 1"})
    flow.act_as(await flow.add_staff())
    base = f"/api/exports/tournaments/{tournament['id']}"
    for path in ("checkin.pdf", "matches.pdf", "stations.pdf", "stations.pdf?orientation=landscape", "standings.pdf"):
        assert_pdf(await flow.get(f"{base}/{path}"))

    flow.act_as(None)
    early = await flow.get(f"{base}/standings.pdf")
    assert early.status_code == 403, early.text

    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "completed"}})
    assert_pdf(await flow.get(f"{base}/standings.pdf"))


@pytest.mark.asyncio
async def test_only_the_tournament_lead_creates_games(flow):
    flow.act_as(None)
    guest = await flow.post("/api/games", json={"name": "Neues Spiel"})
    assert guest.status_code == 401, guest.text

    flow.act_as(await flow.add_user(role="player", name="spielerin"))
    player = await flow.post("/api/games", json={"name": "Neues Spiel"})
    assert player.status_code == 403, player.text
    assert await flow.db.games.count_documents({}) == 0
