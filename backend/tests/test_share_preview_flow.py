"""Link-Vorschau beim Teilen (#347) durch die echte Anwendung: Nicht-Öffentliches bekommt eine
neutrale Karte statt gar keiner - und verrät dabei nichts, solange der Autor es nicht erlaubt."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402

SECRET_TITLE = "Geheime Weihnachtsfeier"
SECRET_PLACE = "Gasthof Beispiel"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def preview(flow, path):
    flow.act_as(None)
    return await flow.get("/api/seo/preview", params={"path": path})


async def add_event(flow, slug, **fields):
    start = now_utc() + timedelta(days=20)
    doc = {"id": f"e-{slug}", "slug": slug, "name": SECRET_TITLE, "description": "Nur für uns.", "status": "scheduled",
           "visibility": "members", "start_date": start.isoformat(), "location": SECRET_PLACE,
           "banner_url": "uploads/public/feier.webp", **fields}
    await flow.db.events.insert_one(dict(doc))
    return doc


@pytest.mark.asyncio
async def test_member_event_gets_a_neutral_card_that_reveals_nothing(flow):
    await add_event(flow, "feier")
    response = await preview(flow, "/events/feier")
    assert response.status_code == 200, "früher 404 - WhatsApp zeigte gar keine Vorschau"
    html = response.text
    assert "Vereinsevent" in html and "nur für Mitglieder" in html
    for secret in (SECRET_TITLE, SECRET_PLACE, "feier.webp", "Nur für uns."):
        assert secret not in html, secret
    assert 'property="og:image"' in html and "https://" in html
    assert response.headers["x-robots-tag"] == "noindex, nofollow"
    assert '"@type": "Event"' not in html and '"@type":"Event"' not in html, "keine strukturierten Daten zum Inhalt"


@pytest.mark.asyncio
async def test_author_may_allow_title_and_image_but_never_for_internal(flow):
    await add_event(flow, "einladung", share_preview=True)
    html = (await preview(flow, "/events/einladung")).text
    assert SECRET_TITLE in html and "feier.webp" in html and SECRET_PLACE in html
    assert "Nur für uns." not in html, "die Beschreibung bleibt hinter der Anmeldung"
    assert "noindex" in html

    await add_event(flow, "vorstand", visibility="internal", share_preview=True)
    internal = (await preview(flow, "/events/vorstand")).text
    assert SECRET_TITLE not in internal and "feier.webp" not in internal, "Internes zeigt nie mehr als die neutrale Karte"


@pytest.mark.asyncio
async def test_drafts_and_unknown_pages_have_no_preview(flow):
    await add_event(flow, "entwurf", status="draft")
    assert (await preview(flow, "/events/entwurf")).status_code == 404
    assert (await preview(flow, "/events/gibt-es-nicht")).status_code == 404


@pytest.mark.asyncio
async def test_public_event_is_unchanged(flow):
    await add_event(flow, "offen", visibility="public")
    response = await preview(flow, "/events/offen")
    assert SECRET_TITLE in response.text and "feier.webp" in response.text
    assert response.headers["x-robots-tag"] == "index, follow"


@pytest.mark.asyncio
async def test_every_restricted_page_type_gets_a_card_and_keeps_its_title_to_itself(flow):
    now = now_utc().isoformat()
    await flow.db.news_posts.insert_one({"id": "n1", "slug": "intern-news", "title": SECRET_TITLE, "content": "x", "visibility": "members",
                                         "published": True, "published_at": now, "banner_url": "uploads/public/feier.webp"})
    await flow.db.tournaments.insert_one({"id": "t1", "slug": "intern-cup", "title": SECRET_TITLE, "status": "registration_open", "visibility": "members"})
    await flow.db.f1_challenges.insert_one({"id": "f1", "slug": "intern-lap", "title": SECRET_TITLE, "status": "live", "visibility": "members"})
    await flow.db.gallery_albums.insert_one({"id": "g1", "slug": "intern-album", "title": SECRET_TITLE, "published": True, "visibility": "members"})
    table = {
        "/news/intern-news": "News für Mitglieder",
        "/tournaments/intern-cup": "Turnier für Mitglieder",
        "/fastlap/intern-lap": "Fast Lap für Mitglieder",
        "/galerie/intern-album": "Galerie für Mitglieder",
    }
    for path, label in table.items():
        response = await preview(flow, path)
        assert response.status_code == 200, path
        assert label in response.text, path
        assert SECRET_TITLE not in response.text, path
        assert response.headers["x-robots-tag"] == "noindex, nofollow", path

    await flow.db.news_posts.insert_one({"id": "n2", "slug": "morgen", "title": SECRET_TITLE, "content": "x", "visibility": "members",
                                         "published": True, "published_at": (now_utc() + timedelta(days=1)).isoformat()})
    assert (await preview(flow, "/news/morgen")).status_code == 404, "geplante News hat noch keine Vorschau"
