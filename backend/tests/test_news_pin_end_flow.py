"""Angeheftete News laufen ab (#1263): ``pinned`` gilt bis zum Ende des Wiener Tages ``pinned_until`` - auf der
News-Seite, der Startseite und in der App, ohne dass jemand etwas tut. Beim Anheften ohne Ende gibt es 14 Tage ab dem
Erscheinen (heute oder der Termin). Altbestand ohne Ende rechnet beim Lesen, ohne Migration (Fabian, 16.11.): erschienen
+ 14 Tage, nie vor dem Tag der Umstellung + 14. Ohne angehefteten Beitrag bleibt die neueste News der Aufmacher."""
import pathlib
import sys
from datetime import date, datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import migrations, news_publish  # noqa: E402
from services.news_publish import PIN_RULE_SINCE, default_pinned_until, pin_active, pin_end, vienna_today  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def day(offset: int) -> str:
    return (vienna_today() + timedelta(days=offset)).isoformat()


async def news(flow, slug, *, days_ago=1, **fields):
    doc = {
        "id": f"n-{slug}", "slug": slug, "title": slug.title(), "content": "Text", "category": "club",
        "visibility": "public", "published": True,
        "published_at": (now_utc() - timedelta(days=days_ago)).isoformat(), "created_at": now_utc().isoformat(),
        **fields,
    }
    await flow.db.news_posts.insert_one(dict(doc))
    return doc


# ---------------------------------------------------------------- Regel

def test_pin_holds_until_vienna_midnight_of_the_last_day():
    post = {"pinned": True, "pinned_until": "2026-10-21"}
    # 21.10. 23:59 in Wien (Sommerzeit, UTC+2) - noch angeheftet; 22.10. 00:00 - nicht mehr.
    assert pin_active(post, datetime(2026, 10, 21, 21, 59, tzinfo=timezone.utc)) is True
    assert pin_active(post, datetime(2026, 10, 21, 22, 0, tzinfo=timezone.utc)) is False
    # Winterzeit (UTC+1): 15.12. 23:30 in Wien ist 22:30 UTC.
    winter = {"pinned": True, "pinned_until": "2026-12-15"}
    assert pin_active(winter, datetime(2026, 12, 15, 22, 30, tzinfo=timezone.utc)) is True
    assert pin_active(winter, datetime(2026, 12, 15, 23, 0, tzinfo=timezone.utc)) is False


def test_pin_without_end_and_unpinned_posts():
    assert pin_active({"pinned": True}) is True, "Altbestand ohne Ende bis zur Migration wie bisher"
    assert pin_active({"pinned": False, "pinned_until": day(5)}) is False
    assert pin_active({}) is False
    assert default_pinned_until(datetime(2026, 10, 7, 23, 30, tzinfo=timezone.utc)) == "2026-10-22", "Wiener Tag, nicht UTC"


# ---------------------------------------------------------------- Öffentlich: Website und App

@pytest.mark.asyncio
async def test_an_expired_pin_drops_into_the_list_everywhere(flow):
    await news(flow, "abgelaufen", pinned=True, pinned_until=day(-1), days_ago=30)
    await news(flow, "laeuft", pinned=True, pinned_until=day(0), days_ago=20)
    await news(flow, "neu", days_ago=1)
    flow.act_as(None)

    listed = (await flow.get("/api/news")).json()
    assert [row["slug"] for row in listed] == ["laeuft", "neu", "abgelaufen"]
    assert {row["slug"]: row["pinned"] for row in listed} == {"laeuft": True, "neu": False, "abgelaufen": False}
    compact = (await flow.get("/api/news?compact=true")).json()
    assert [row["slug"] for row in compact if row["pinned"]] == ["laeuft"]
    only = (await flow.get("/api/news?pinned_only=true")).json()
    assert [row["slug"] for row in only] == ["laeuft"]
    assert (await flow.get("/api/news/abgelaufen")).json()["pinned"] is False

    home = (await flow.get("/api/home/state")).json()
    assert [row["slug"] for row in home["featured_news"]] == ["laeuft"]

    app = (await flow.get("/api/mobile/dashboard")).json()
    app_news = app["news"]
    assert app_news and app_news[0]["slug"] == "laeuft"
    assert {row["slug"]: row["pinned"] for row in app_news}["abgelaufen"] is False


@pytest.mark.asyncio
async def test_home_without_pinned_news_leads_with_the_newest(flow):
    """Startseite wie bisher (Fabian, 16.11.): Ist die Anheftung abgelaufen, ist die neueste News der Aufmacher."""
    await news(flow, "abgelaufen", pinned=True, pinned_until=day(-3), days_ago=10)
    await news(flow, "gestern", days_ago=1)
    flow.act_as(None)
    home = (await flow.get("/api/home/state")).json()
    assert [row["slug"] for row in home["featured_news"]] == ["gestern"]


# ---------------------------------------------------------------- Redaktion

@pytest.mark.asyncio
async def test_pinning_without_end_gets_fourteen_days_and_unpinning_clears_it(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="redaktion"))
    created = await flow.post("/api/news", json={"title": "Absage", "content": "Text", "published": True, "pinned": True})
    assert created.status_code == 200, created.text
    post = created.json()
    assert post["pinned_until"] == default_pinned_until()

    chosen = await flow.patch(f"/api/news/{post['id']}", json={"pinned_until": day(3)})
    assert chosen.status_code == 200, chosen.text
    assert (await flow.db.news_posts.find_one({"id": post["id"]}))["pinned_until"] == day(3)

    loosened = await flow.patch(f"/api/news/{post['id']}", json={"pinned": False})
    assert loosened.status_code == 200, loosened.text
    stored = await flow.db.news_posts.find_one({"id": post["id"]})
    assert stored["pinned"] is False and stored["pinned_until"] is None

    plain = await flow.post("/api/news", json={"title": "Normal", "content": "Text", "published": True})
    assert plain.json().get("pinned_until") is None


@pytest.mark.asyncio
async def test_an_end_in_the_past_is_refused_and_an_expired_pin_can_be_renewed(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="redaktion"))
    past = await flow.post("/api/news", json={"title": "Alt", "content": "Text", "pinned": True, "pinned_until": day(-1)})
    assert past.status_code == 400, past.text
    broken = await flow.post("/api/news", json={"title": "Kaputt", "content": "Text", "pinned": True, "pinned_until": "2026-13-40"})
    assert broken.status_code == 400, broken.text

    await news(flow, "vorbei", pinned=True, pinned_until=day(-2))
    admin_row = next(row for row in (await flow.get("/api/admin/news")).json() if row["slug"] == "vorbei")
    assert admin_row["pin_active"] is False and admin_row["pinned_until"] == day(-2), "die Redaktion sieht das Ende"
    assert (await flow.get("/api/admin/news/n-vorbei")).json()["pin_active"] is False
    renewed = await flow.patch("/api/news/n-vorbei", json={"pinned": True})
    assert renewed.status_code == 200, renewed.text
    assert (await flow.db.news_posts.find_one({"id": "n-vorbei"}))["pinned_until"] == default_pinned_until()


# ---------------------------------------------------------------- Geplante Beiträge

@pytest.mark.asyncio
async def test_a_post_planned_in_three_weeks_counts_from_its_publish_day(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="redaktion"))
    later = (now_utc() + timedelta(days=21)).replace(hour=10, minute=0, second=0, microsecond=0)
    publish_day = news_publish.vienna_day(later)
    created = await flow.post("/api/news", json={"title": "Turnier im Dezember", "content": "Text", "published": True,
                                                 "published_at": later.isoformat(), "pinned": True})
    assert created.status_code == 200, created.text
    assert created.json()["pinned_until"] == (publish_day + timedelta(days=14)).isoformat(), "14 Tage ab dem Erscheinen"

    too_early = await flow.post("/api/news", json={"title": "Zu früh", "content": "Text", "published": True,
                                                   "published_at": later.isoformat(), "pinned": True, "pinned_until": day(5)})
    assert too_early.status_code == 400, too_early.text
    assert publish_day.strftime("%d.%m.%Y") in too_early.json()["detail"]
    moved = await flow.patch(f"/api/news/{created.json()['id']}", json={"pinned_until": day(3)})
    assert moved.status_code == 400, "auch beim Ändern nie vor dem Erscheinen"


# ---------------------------------------------------------------- Altbestand ohne Ende - beim Lesen, fester Stichtag

def _legacy(published: datetime) -> dict:
    stamp = published.isoformat()
    return {"pinned": True, "published_at": stamp, "created_at": stamp}


def _at(day, hour=10):
    return datetime(day.year, day.month, day.day, hour, tzinfo=timezone.utc)


def test_the_cutoff_is_a_fixed_vienna_day():
    assert PIN_RULE_SINCE == date(2026, 11, 20)


def test_old_pins_before_the_cutoff_last_until_cutoff_plus_fourteen():
    old = _legacy(_at(date(2026, 9, 1)))
    end = PIN_RULE_SINCE + timedelta(days=14)
    assert pin_end(old) == end
    # Am Stichtag und bis zu seinem 14. Tag danach bleibt auch eine sehr alte angeheftete News oben ...
    assert pin_active(old, _at(PIN_RULE_SINCE)) is True
    assert pin_active(old, datetime(end.year, end.month, end.day, 22, 59, tzinfo=timezone.utc)) is True  # 23:59 in Wien
    # ... danach rutscht sie in die Liste.
    assert pin_active(old, datetime(end.year, end.month, end.day, 23, 0, tzinfo=timezone.utc)) is False


def test_old_pins_after_the_cutoff_count_fourteen_days_from_publishing():
    published = PIN_RULE_SINCE + timedelta(days=10)
    post = _legacy(_at(published))
    assert pin_end(post) == published + timedelta(days=14)
    assert pin_active(post, _at(published + timedelta(days=14))) is True
    assert pin_active(post, _at(published + timedelta(days=15))) is False
    # Angelegt nach dem Erscheinen (Altbestand): das spätere zählt.
    later = {**post, "created_at": _at(published + timedelta(days=3)).isoformat()}
    assert pin_end(later) == published + timedelta(days=17)


@pytest.mark.asyncio
async def test_old_pins_without_end_follow_the_rule_on_every_surface(flow, monkeypatch):
    monkeypatch.setattr(news_publish, "PIN_RULE_SINCE", vienna_today() - timedelta(days=30))
    old = (now_utc() - timedelta(days=60)).isoformat()
    recent = (now_utc() - timedelta(days=2)).isoformat()
    await news(flow, "lange-her", pinned=True, published_at=old, created_at=old)
    await news(flow, "frisch", pinned=True, published_at=recent, created_at=recent)
    flow.act_as(None)
    listed = {row["slug"]: row["pinned"] for row in (await flow.get("/api/news?compact=true")).json()}
    assert listed == {"lange-her": False, "frisch": True}
    assert [row["slug"] for row in (await flow.get("/api/home/state")).json()["featured_news"]] == ["frisch"]
    app = {row["slug"]: row["pinned"] for row in (await flow.get("/api/mobile/dashboard")).json()["news"]}
    assert app == {"lange-her": False, "frisch": True}
    stored = await flow.db.news_posts.find_one({"slug": "lange-her"}, {"_id": 0})
    assert "pinned_until" not in stored, "nichts wird umgeschrieben"
    flow.act_as(await flow.add_user(role="club_admin", name="redaktion"))
    row = next(row for row in (await flow.get("/api/admin/news")).json() if row["slug"] == "frisch")
    assert row["pin_active"] is True and row["pin_until"] == (vienna_today() - timedelta(days=2) + timedelta(days=14)).isoformat()
    assert await flow.db.settings.count_documents({}) == 0, "Lesen schreibt nichts in die Datenbank"


def test_nothing_is_written_at_startup_for_pins():
    """Wächter (Fabian, 16.11.): der Start legt für angeheftete News keine Einstellungszeile an - der Stichtag ist eine
    Konstante, keine Datenbank-Angabe."""
    backend = pathlib.Path(__file__).resolve().parents[1]
    server = (backend / "server.py").read_text(encoding="utf-8")
    source = (backend / "services" / "news_publish.py").read_text(encoding="utf-8")
    assert "news_pin_rule" not in server and "pin_rule" not in server.lower()
    assert "news_pin_rule" not in source and "db.settings" not in source
    assert not hasattr(news_publish, "load_pin_rule_since")


def test_there_is_no_pin_migration():
    assert "news_pinned_until" not in [name for _version, name, _migration in migrations.MIGRATIONS]
    assert not hasattr(migrations, "migrate_news_pinned_until")
