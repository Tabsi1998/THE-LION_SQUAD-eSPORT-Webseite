"""Kopf der Startseite (#2122 NW9): zwei Zeilen Überschrift und der Satz darunter - pflegbar, leer heißt Vorgabe."""
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
async def test_home_hero_has_defaults_and_follows_the_editor(flow):
    flow.act_as(None)
    hero = (await flow.get("/api/home/state")).json()["home_hero"]
    assert (hero["title"], hero["highlight"]) == ("Ein Rudel.", "Eine Familie.")
    assert hero["text"].startswith("Gaming- und eSports-Verein aus Tirol.")

    flow.act_as(await flow.add_user(role="club_admin", name="redaktion"))
    saved = await flow.put("/api/home/about/admin", json={"home_title": "Ein Verein.", "home_highlight": "Viele Spiele.", "home_text": "Komm vorbei."})
    assert saved.status_code == 200 and saved.json()["texts"]["home_title"] == "Ein Verein."

    flow.act_as(None)
    hero = (await flow.get("/api/home/state")).json()["home_hero"]
    assert hero == {"title": "Ein Verein.", "highlight": "Viele Spiele.", "text": "Komm vorbei."}
    about = (await flow.get("/api/home/about")).json()["texts"]
    assert "home_title" not in about, "die Seite „Über uns“ bekommt den Startseiten-Kopf nicht mit"


@pytest.mark.asyncio
async def test_empty_home_hero_fields_fall_back_to_the_default(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="redaktion"))
    await flow.put("/api/home/about/admin", json={"home_title": "", "home_highlight": "  ", "home_text": ""})
    flow.act_as(None)
    hero = (await flow.get("/api/home/state")).json()["home_hero"]
    assert (hero["title"], hero["highlight"]) == ("Ein Rudel.", "Eine Familie.")


@pytest.mark.asyncio
async def test_home_hero_has_length_limits(flow):
    flow.act_as(await flow.add_user(role="club_admin", name="redaktion"))
    assert (await flow.put("/api/home/about/admin", json={"home_title": "x" * 61})).status_code == 422
