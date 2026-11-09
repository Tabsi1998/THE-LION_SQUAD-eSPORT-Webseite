"""Liga auf der Startseite (#2324): sichtbare Seasons in „Nächste Termine“ und als Hinweis bei offener Anmeldung, dazu die
Teilen-Karte der Ligaseite. Sichtbar wie die Ligaseite, nicht nach dem Stand. Erfundene Namen."""
import pathlib
import sys
from datetime import datetime, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_application_world import application_world, submitted  # noqa: E402
from league_rules_world import ADMIN_LEAGUES  # noqa: E402
from league_start_world import ok  # noqa: E402

from services.league_home import season_state  # noqa: E402

BASE = {"site_name": "Probe", "image": "/logo.png", "title": "Probe", "description": ""}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def home_leagues(flow) -> list[dict]:
    return ok(await flow.get("/api/home/state"))["leagues"]


async def patch_season(flow, w: dict, **body) -> None:
    flow.act_as(w["lead"])
    ok(await flow.patch(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}", json=body))


# ---------------------------------------------------------------- Startseite

@pytest.mark.asyncio
async def test_open_window_shows_on_home_even_while_the_season_is_a_draft(flow):
    w = await application_world(flow, teams=1, application_slots=16)
    await submitted(flow, w, w["teams"][0])
    stored = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})
    assert stored["status"] == "draft" and stored["visibility"] == "public"

    flow.act_as(None)
    [row] = await home_leagues(flow)
    path = f"/liga/{w['league']['slug']}/{w['season']['slug']}"
    assert row["kind"] == "league" and row["url"] == path and row["apply_url"] == f"{path}/anmelden"
    assert row["title"] == f"Anmelde-Liga · {w['season']['name']}"
    assert row["public_phase"]["state"] == "registration_open"
    assert row["public_phase"]["countdown_kind"] == "registration_closes"
    assert row["public_phase"]["target_at"] == row["application"]["closes_at"] == row["sort_at"]
    # Angenommen ist niemand - ein eingereichter Antrag belegt keinen Platz.
    assert row["application"]["slots"] == 16 and row["application"]["slots_free"] == 16
    assert row["end_date"] and row["start_date"]
    assert "emblem_url" in row and "banner" in row
    # Keine Personen, keine Anträge.
    assert "applications" not in row and "squads" not in row


@pytest.mark.asyncio
async def test_hidden_seasons_never_show_on_home(flow):
    w = await application_world(flow, teams=0)
    for visibility in ("off", "admins"):
        await patch_season(flow, w, visibility=visibility)
        flow.act_as(None)
        assert await home_leagues(flow) == [], visibility


@pytest.mark.asyncio
async def test_the_switch_takes_a_season_off_the_home_page(flow):
    w = await application_world(flow, teams=0)
    stored = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})
    assert stored["promote_on_home"] is True  # Vorgabe an

    await patch_season(flow, w, promote_on_home=False)
    flow.act_as(None)
    assert await home_leagues(flow) == []
    # Die Ligaseite bleibt, wie sie ist.
    assert ok(await flow.get(f"/api/leagues/{w['league']['slug']}/{w['season']['slug']}"))["application"]["state"] == "open"

    await patch_season(flow, w, promote_on_home=True)
    flow.act_as(None)
    assert len(await home_leagues(flow)) == 1

    # Seasons von vor #2324 tragen das Feld nicht: Sie werden beworben.
    await flow.db.league_seasons.update_one({"id": w["season"]["id"]}, {"$unset": {"promote_on_home": ""}})
    assert len(await home_leagues(flow)) == 1


# ---------------------------------------------------------------- Stand je Season

def _season(**fields) -> dict:
    # Montag, 16.11.2026 (Wien) - zehn Spielwochen.
    return {"start_date": "2026-11-15T23:00:00+00:00", "weeks_total": 10, "matchday_days": 7, "status": "draft", **fields}


def _at(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


WINDOW = {"application_opens_at": "2026-11-01T00:00:00+00:00", "application_closes_at": "2026-11-12T22:59:00+00:00"}


def test_state_before_during_and_after_the_window():
    pending, sort_at = season_state(_season(**WINDOW), _at("2026-10-20T10:00:00"))
    assert pending["state"] == "registration_pending" and pending["countdown_kind"] == "registration_opens"
    assert sort_at == pending["target_at"] == WINDOW["application_opens_at"]

    open_, sort_at = season_state(_season(**WINDOW), _at("2026-11-05T10:00:00"))
    assert open_["state"] == "registration_open" and open_["label"] == "Anmeldung offen"
    assert sort_at == WINDOW["application_closes_at"]

    closed, sort_at = season_state(_season(**WINDOW), _at("2026-11-14T10:00:00"))
    assert closed["state"] == "registration_closed" and closed["countdown_kind"] == "starts"
    assert sort_at == closed["target_at"] == "2026-11-15T23:00:00+00:00"


def test_state_without_a_window_is_announced_until_the_start():
    announced, sort_at = season_state(_season(), _at("2026-11-01T10:00:00"))
    assert announced["state"] == "announced" and announced["label"] == "Angekündigt"
    assert announced["countdown_kind"] == "starts" and sort_at == "2026-11-15T23:00:00+00:00"


def test_state_during_the_season_counts_match_weeks_and_skips_breaks():
    running, sort_at = season_state(_season(), _at("2026-11-25T12:00:00"))
    assert running["label"] == "Spielwoche 2 von 10" and running["target_at"] is None
    assert sort_at == "2026-11-29T23:00:00+00:00"  # Montag der dritten Woche

    # Woche 2 gesperrt: in Woche 2 Spielpause, Woche 3 ist die zweite Spielwoche von neun.
    blocked = _season(blocked_periods=[{"start_date": "2026-11-23", "end_date": "2026-11-29"}])
    pause, _ = season_state(blocked, _at("2026-11-25T12:00:00"))
    assert pause["state"] == "season_break" and pause["label"] == "Spielpause"
    week, _ = season_state(blocked, _at("2026-12-02T12:00:00"))
    assert week["label"] == "Spielwoche 2 von 9"


def test_finished_seasons_are_gone():
    assert season_state(_season(), _at("2027-02-01T10:00:00")) is None
    assert season_state(_season(status="completed"), _at("2026-11-01T10:00:00")) is None


# ---------------------------------------------------------------- Teilen-Karte

@pytest.mark.asyncio
async def test_share_card_tells_the_deadline_and_free_seats_while_the_window_is_open(flow):
    from routes.seo_render_routes import league_season_meta

    w = await application_world(flow, teams=0, application_slots=16)
    league_slug, season_slug = w["league"]["slug"], w["season"]["slug"]
    meta = await league_season_meta(flow.db, league_slug, season_slug, BASE, "https://example.test")
    assert "Anmeldung offen" in meta["title"]
    assert "Anmeldung bis" in meta["description"] and "16 von 16 Startplätzen frei" in meta["description"]

    await patch_season(flow, w, application_opens_at=None, application_closes_at=None)
    plain = await league_season_meta(flow.db, league_slug, season_slug, BASE, "https://example.test")
    assert "Anmeldung" not in plain["title"] and "Anmeldung bis" not in plain["description"]
