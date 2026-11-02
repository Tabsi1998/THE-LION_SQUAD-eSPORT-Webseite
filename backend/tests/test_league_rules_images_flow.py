"""Regelwerk der Liga (#2230): Bilder im Text gegen den Upload-Eintrag. Speichern und Vorschau schauen auf Eintrag und Besitz, Veröffentlichen
auf den Eintrag. Erfundene Namen und Dateien."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_rules_world import make_bare_world, season_scope, today  # noqa: E402
from league_start_world import ok  # noqa: E402
from models import now_utc  # noqa: E402

UPLOADS = "/api/static/uploads/"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def duty(flow, world: dict, name: str = "Zuständig", **fields) -> dict:
    user = await flow.add_user(name=f"{name} {new_id()[:6]}", **fields)
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": world["league"]["id"], "user_id": user["id"], "capabilities": ["rules"],
                                           "created_at": now_utc().isoformat(), "created_by": "test"})
    return user


async def upload(flow, name: str, owner: dict | None, scope: str | None = "user", **fields) -> str:
    row = {"id": name, "filename": name, "url": UPLOADS + name, "media_type": "image", "owner_id": (owner or {}).get("id"), **fields}
    await flow.db.media_uploads.insert_one({**row, **({"media_scope": scope} if scope else {})})
    return UPLOADS + name


def picture(address: str) -> str:
    return f"# A\n![Plan]({address})"


async def save(flow, world: dict, body_md: str = "# A", annexes: list | None = None, revision: int | None = None):
    payload = {"title": "A", "body_md": body_md, "annexes": annexes or [], **({"revision": revision} if revision else {})}
    return await flow.put(f"{season_scope(world)}/draft", json=payload)


async def preview(flow, world: dict, body_md: str) -> list[str]:
    return ok(await flow.post(f"{season_scope(world)}/preview", json={"title": "A", "body_md": body_md, "annexes": []}))["foreign_images"]


async def publish_draft(flow, world: dict, revision: int):
    return await flow.post(f"{season_scope(world)}/publish", json={"revision": revision, "valid_from": today(), "change_reason": "Ein Grund"})


# ---------------------------------------------------------------- Eintragung

@pytest.mark.asyncio
async def test_a_file_without_an_entry_is_refused_in_text_and_annex(flow):
    w = await make_bare_world(flow)
    address = UPLOADS + "ohne-eintrag.webp"
    for answer in (await save(flow, w, picture(address)), await save(flow, w, annexes=[{"title": "B", "body_md": picture(address)}])):
        assert answer.status_code == 422 and "Upload" in answer.json()["detail"]
    assert await flow.db.league_rules.count_documents({}) == 0
    assert await preview(flow, w, picture(address)) == [address]


@pytest.mark.asyncio
async def test_the_media_role_takes_any_entry_of_the_library(flow):
    w = await make_bare_world(flow)
    other = await flow.add_user(name="Jemand")
    club = await upload(flow, "verein.webp", other, scope="admin")
    theirs = await upload(flow, "fremd.webp", other)
    saved = ok(await save(flow, w, f"# A\n![V]({club})\n\n![F]({theirs}?v=2)"))
    assert club in saved["body_md"]
    assert await preview(flow, w, picture(club)) == []


@pytest.mark.asyncio
async def test_the_png_of_a_registered_svg_logo_counts_as_registered(flow):
    w = await make_bare_world(flow)
    await upload(flow, "logo.svg", w["lead"], scope="branding", raster_filename="logo.png")
    ok(await save(flow, w, picture(UPLOADS + "logo.png")))


# ---------------------------------------------------------------- Besitz

@pytest.mark.asyncio
async def test_a_duty_puts_in_own_images_with_version_marks(flow):
    w = await make_bare_world(flow)
    person = await duty(flow, w)
    own = await upload(flow, "eigen.webp", person)
    flow.act_as(person)
    assert await preview(flow, w, picture(f"{own}?v=3")) == []
    saved = ok(await save(flow, w, f"{picture(own + '?v=3')}\n\n[Quelle](https://bilder.example.test/plan.png)"))
    assert own in saved["body_md"]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["fremd", "fremd_verein", "eigen_verein", "eigen_ohne_art", "ohne_besitzer"])
async def test_a_duty_gets_nothing_else_in(flow, kind):
    w = await make_bare_world(flow)
    person = await duty(flow, w)
    other = await flow.add_user(name="Jemand")
    address = await {
        "fremd": lambda: upload(flow, "bild.webp", other),
        "fremd_verein": lambda: upload(flow, "bild.webp", other, scope="admin"),
        "eigen_verein": lambda: upload(flow, "bild.webp", person, scope="admin"),
        "eigen_ohne_art": lambda: upload(flow, "bild.webp", person, scope=None),
        "ohne_besitzer": lambda: upload(flow, "bild.webp", None),
    }[kind]()
    flow.act_as(person)
    refused = await save(flow, w, picture(address))
    assert refused.status_code == 422 and "Upload" in refused.json()["detail"]
    assert await flow.db.league_rules.count_documents({}) == 0
    assert await preview(flow, w, picture(address)) == [address]


@pytest.mark.asyncio
@pytest.mark.parametrize("text", ["[Plan]({address})", "Siehe {address} im Plan", '<img src="{address}">', "[Plan](https://liga.example.test{address})",
                                  "[Plan](https://liga.example.test/uploads/bild-400.webp)"],
                         ids=["Link", "nackt", "html", "Link absolut", "kleinere Fassung"])
async def test_links_and_plain_addresses_count_like_images(flow, text):
    """Dieselbe Sicht wie die Verwendungssuche der Mediathek."""
    w = await make_bare_world(flow)
    person = await duty(flow, w)
    address = await upload(flow, "bild.webp", await flow.add_user(name="Jemand"))
    flow.act_as(person)
    body = text.format(address=address)
    refused = await save(flow, w, body)
    assert refused.status_code == 422
    assert await preview(flow, w, body)


@pytest.mark.asyncio
async def test_a_link_to_an_unregistered_upload_is_refused_a_link_elsewhere_is_not(flow):
    w = await make_bare_world(flow)
    refused = await save(flow, w, f"[Plan]({UPLOADS}ohne-eintrag.pdf)")
    assert refused.status_code == 422
    ok(await save(flow, w, "[Plan](https://bilder.example.test/wp-content/uploads/2026/plan.pdf)\n\nMehr: https://bilder.example.test/uploads/plan.png"))


# ---------------------------------------------------------------- Was schon im Entwurf steht

@pytest.mark.asyncio
async def test_another_editor_keeps_what_is_in_the_draft_and_adds_only_own_images(flow):
    w = await make_bare_world(flow)
    first, second = await duty(flow, w, "Erste"), await duty(flow, w, "Zweite")
    hers = await upload(flow, "ihres.webp", first)
    mine = await upload(flow, "meines.webp", second)
    third = await upload(flow, "drittes.webp", first)
    flow.act_as(first)
    draft = ok(await save(flow, w, f"# A\n![Ihres]({hers})"))
    flow.act_as(second)
    assert await preview(flow, w, f"# A\n![Ihres]({hers}?v=2)\n\n![Meines]({mine})") == []
    saved = ok(await save(flow, w, f"# A\n![Ihres]({hers}?v=2)\n\n![Meines]({mine})", revision=draft["revision"]))
    assert hers in saved["body_md"] and mine in saved["body_md"]
    refused = await save(flow, w, f"# A\n![Ihres]({hers})\n\n![Drittes]({third})", revision=saved["revision"])
    assert refused.status_code == 422 and third.rsplit("/", 1)[1] in refused.json()["detail"]
    assert await preview(flow, w, f"# A\n![Drittes]({third})") == [third]


@pytest.mark.asyncio
async def test_what_left_the_draft_does_not_come_back_through_another_editor(flow):
    w = await make_bare_world(flow)
    first, second = await duty(flow, w, "Erste"), await duty(flow, w, "Zweite")
    hers = await upload(flow, "ihres.webp", first)
    flow.act_as(first)
    draft = ok(await save(flow, w, picture(hers)))
    gone = ok(await save(flow, w, "# A\nOhne Bild", revision=draft["revision"]))
    flow.act_as(second)
    refused = await save(flow, w, picture(hers), revision=gone["revision"])
    assert refused.status_code == 422


@pytest.mark.asyncio
async def test_an_entry_that_is_gone_stops_also_what_was_in_the_draft(flow):
    w = await make_bare_world(flow)
    person = await duty(flow, w)
    own = await upload(flow, "eigen.webp", person)
    flow.act_as(person)
    draft = ok(await save(flow, w, picture(own)))
    await flow.db.media_uploads.delete_many({"filename": "eigen.webp"})
    refused = await save(flow, w, picture(own), revision=draft["revision"])
    assert refused.status_code == 422


@pytest.mark.asyncio
async def test_a_stale_editor_hears_about_the_revision_first(flow):
    w = await make_bare_world(flow)
    person = await duty(flow, w)
    foreign = await upload(flow, "fremd.webp", await flow.add_user(name="Jemand"))
    flow.act_as(person)
    first = ok(await save(flow, w, "# A\nEins"))
    ok(await save(flow, w, "# A\nZwei", revision=first["revision"]))
    stale = await save(flow, w, picture(foreign), revision=first["revision"])
    assert stale.status_code == 409


@pytest.mark.asyncio
async def test_a_draft_from_a_version_keeps_its_images_for_another_editor(flow):
    w = await make_bare_world(flow)
    first, second = await duty(flow, w, "Erste"), await duty(flow, w, "Zweite")
    hers = await upload(flow, "ihres.webp", first)
    flow.act_as(first)
    draft = ok(await save(flow, w, picture(hers)))
    version = ok(await publish_draft(flow, w, draft["revision"]))
    flow.act_as(second)
    again = ok(await flow.post(f"{season_scope(w)}/draft/from-version", json={"version_id": version["id"]}))
    assert hers in again["body_md"]
    ok(await save(flow, w, f"{again['body_md']}\n\nNoch ein Satz", revision=again["revision"]))


# ---------------------------------------------------------------- Veröffentlichen

@pytest.mark.asyncio
async def test_publishing_asks_for_the_entry_not_for_the_owner(flow):
    w = await make_bare_world(flow)
    first, second = await duty(flow, w, "Erste"), await duty(flow, w, "Zweite")
    hers = await upload(flow, "ihres.webp", first)
    flow.act_as(first)
    draft = ok(await save(flow, w, picture(hers)))
    flow.act_as(second)
    version = ok(await publish_draft(flow, w, draft["revision"]))
    assert version["status"] == "published" and hers in version["body_md"]


@pytest.mark.asyncio
async def test_publishing_stops_when_an_entry_is_gone(flow):
    w = await make_bare_world(flow)
    own = await upload(flow, "bild.webp", w["lead"], scope="admin")
    draft = ok(await save(flow, w, "# A", annexes=[{"title": "B", "body_md": picture(own)}]))
    await flow.db.media_uploads.delete_many({"filename": "bild.webp"})
    refused = await publish_draft(flow, w, draft["revision"])
    assert refused.status_code == 422 and "Upload" in refused.json()["detail"]
    assert await flow.db.league_rules.count_documents({"status": "published"}) == 0
