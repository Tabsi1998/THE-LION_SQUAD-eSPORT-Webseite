"""Zahlen der automatischen Hinweisbanner in der Verwaltung (#2352): die Liste unter Einstellungen → Banner und die
Zahlen am Turnier bzw. an der Fast-Lap-Challenge. Nur für die jeweilige Verwaltung, nicht öffentlich."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def open_tournament(flow, tid="t-auto", status="registration_open") -> str:
    await flow.db.tournaments.insert_one({
        "id": tid, "slug": f"{tid}-slug", "title": "Herbst-Cup", "status": status, "site_banner_enabled": True,
        "is_public": True, "start_date": now_utc() + timedelta(days=3),
        "registration_open_from": now_utc() - timedelta(days=1), "registration_open_until": now_utc() + timedelta(days=2),
    })
    return tid


async def count(flow, banner_id: str, impressions: int, clicks: int) -> None:
    for _ in range(impressions):
        res = await flow.post("/api/settings/site-banners/impression", json={"banner_id": banner_id})
        assert res.status_code == 200
    for _ in range(clicks):
        res = await flow.post("/api/settings/site-banners/click", json={"banner_id": banner_id})
        assert res.status_code == 200


@pytest.mark.asyncio
async def test_settings_lists_the_running_automatic_banners_with_numbers(flow):
    tid = await open_tournament(flow)
    await flow.db.f1_challenges.insert_one({"id": "c-auto", "slug": "c-auto", "title": "Monza-Hotlap", "status": "registration_open",
                                            "site_banner_enabled": True, "visibility": "public", "start_date": now_utc() + timedelta(days=5)})
    await count(flow, f"auto-tournament-registration-{tid}", impressions=3, clicks=1)
    redaktion = await flow.add_user(role="club_admin", name="redaktion")
    flow.act_as(redaktion)
    res = await flow.get("/api/settings/site-banners/admin/auto")
    assert res.status_code == 200, res.text
    items = {row["id"]: row for row in res.json()["items"]}
    tour = items[f"auto-tournament-registration-{tid}"]
    assert tour["kind"] == "tournament" and tour["template"] == "registration"
    assert tour["title"] == "Herbst-Cup" and tour["text"] == "Anmeldung offen: Herbst-Cup"
    assert tour["period_start"] and tour["period_end"]
    assert tour["manage_url"] == f"/admin/tournaments/{tid}?tab=edit"
    assert tour["stats"]["impressions"] == 3 and tour["stats"]["clicks"] == 1 and tour["stats"]["last_impression_at"]
    fast = items["auto-fastlap-registration-c-auto"]
    assert fast["kind"] == "fastlap" and fast["manage_url"] == "/admin/f1/c-auto"
    assert fast["stats"] == {"impressions": 0, "clicks": 0, "last_impression_at": "", "last_click_at": ""}
    # Die von Hand angelegten Banner bleiben in ihrer Liste wie bisher (Antwortform unverändert).
    manual = await flow.get("/api/settings/site-banners/admin")
    assert manual.status_code == 200 and manual.json() == []


@pytest.mark.asyncio
async def test_the_settings_list_needs_the_content_area(flow):
    await open_tournament(flow)
    for role in ("user", "tournament_admin"):
        flow.act_as(await flow.add_user(role=role))
        res = await flow.get("/api/settings/site-banners/admin/auto")
        assert res.status_code == 403, role
    flow.act_as(None)
    res = await flow.get("/api/settings/site-banners/admin/auto")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_tournament_numbers_per_template_stay_after_the_banner_ends(flow):
    tid = await open_tournament(flow)
    await count(flow, f"auto-tournament-registration-{tid}", impressions=4, clicks=2)
    # Vorlage „startet bald“ lief vorher schon einmal; danach ist der Banner aus.
    await flow.db.site_banner_stats.insert_one({"id": f"auto-tournament-event-{tid}", "impressions": 5, "clicks": 1,
                                                "last_impression_at": "2026-11-01T10:00:00+00:00"})
    await flow.db.tournaments.update_one({"id": tid}, {"$set": {"status": "completed", "site_banner_enabled": False}})
    flow.act_as(await flow.add_staff())
    res = await flow.get(f"/api/settings/site-banners/admin/stats/tournament/{tid}-slug")
    assert res.status_code == 200, res.text
    body = res.json()
    assert [row["template"] for row in body["items"]] == ["registration", "event"]
    assert body["items"][0]["stats"]["impressions"] == 4 and body["items"][0]["stats"]["clicks"] == 2
    assert body["total"]["impressions"] == 9 and body["total"]["clicks"] == 3
    assert body["total"]["last_impression_at"] == body["items"][0]["stats"]["last_impression_at"]


@pytest.mark.asyncio
async def test_a_tournament_without_numbers_and_the_rights(flow):
    await open_tournament(flow, tid="t-leer")
    await open_tournament(flow, tid="t-voll")
    await flow.db.site_banner_stats.insert_one({"id": "auto-tournament-registration-t-voll", "impressions": 7, "clicks": 0})
    flow.act_as(await flow.add_staff())
    empty = await flow.get("/api/settings/site-banners/admin/stats/tournament/t-leer")
    assert empty.status_code == 200
    assert empty.json() == {"items": [], "total": {"impressions": 0, "clicks": 0, "last_impression_at": ""}}
    missing = await flow.get("/api/settings/site-banners/admin/stats/tournament/gibt-es-nicht")
    assert missing.status_code == 404
    flow.act_as(await flow.add_user(role="user"))
    denied = await flow.get("/api/settings/site-banners/admin/stats/tournament/t-voll")
    assert denied.status_code == 403
    flow.act_as(None)
    anonymous = await flow.get("/api/settings/site-banners/admin/stats/tournament/t-voll")
    assert anonymous.status_code == 401


@pytest.mark.asyncio
async def test_fastlap_numbers_and_rights(flow):
    await flow.db.f1_challenges.insert_one({"id": "c-1", "slug": "monza", "title": "Monza", "status": "completed"})
    await flow.db.site_banner_stats.insert_one({"id": "auto-fastlap-registration-c-1", "impressions": 2, "clicks": 1})
    flow.act_as(await flow.add_staff())
    res = await flow.get("/api/settings/site-banners/admin/stats/fastlap/monza")
    assert res.status_code == 200, res.text
    assert res.json()["total"]["impressions"] == 2 and res.json()["items"][0]["id"] == "auto-fastlap-registration-c-1"
    flow.act_as(await flow.add_user(role="user"))
    denied = await flow.get("/api/settings/site-banners/admin/stats/fastlap/monza")
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_the_public_answer_carries_no_admin_fields(flow):
    await open_tournament(flow)
    rows = (await flow.get("/api/settings/site-banners")).json()["items"]
    auto = next(row for row in rows if row["id"].startswith("auto-tournament-"))
    await flow.db.site_banner_stats.insert_one({"id": auto["id"], "impressions": 5, "clicks": 2})
    for channel in ("", "?channel=app"):
        rows = (await flow.get(f"/api/settings/site-banners{channel}")).json()["items"]
        auto = next(row for row in rows if row["id"].startswith("auto-tournament-"))
        for field in ("ref_kind", "ref_id", "ref_title", "period_start", "period_end", "manage_url", "stats"):
            assert field not in auto, f"{field} ist intern"
