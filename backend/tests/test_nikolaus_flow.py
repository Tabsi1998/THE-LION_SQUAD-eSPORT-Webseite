"""Der Nikolausstiefel (X3, #736) - durch die echte Anwendung geschickt.

Am 6. Dezember liegt für jede angemeldete Person ein Sticker aus „Vom Nikolaus“ im Stiefel, einer je Person und Jahr;
ein zweiter Klick bringt denselben noch einmal. Im Chat steht das Paket nur mit den eigenen Stickern, senden kann einen
geschenkten Sticker nur, wer ihn hat. Im nächsten Jahr kommt einer, den man noch nicht hat. Außerhalb des Tages, ohne
Anmeldung oder wenn der Admin die Saison abschaltet, gibt es nichts; ist das Paket abgeschaltet, bleibt der Stiefel leer.
"""
import pathlib
import sys
from datetime import datetime

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import nikolaus, seasons, stickers  # noqa: E402

PACK = "fluent-nikolaus"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def clock(monkeypatch, *moment):
    """Die Saison-Uhr auf einen Zeitpunkt in Wien stellen (wie in test_seasons_flow)."""
    real = seasons.to_vienna
    fixed = datetime(*moment, tzinfo=seasons.VIENNA)
    monkeypatch.setattr(seasons, "to_vienna", lambda now=None: real(now if now is not None else fixed))


def pack_of(packs: list[dict]) -> dict | None:
    return next((pack for pack in packs if pack["id"] == PACK), None)


def test_the_pack_has_eight_pictures_of_its_own_and_only_the_nikolaus_gives_from_it():
    pack = stickers.seasonal_pack("nikolaus")
    assert pack["id"] == PACK and pack["name"] == "Vom Nikolaus" and len(pack["stickers"]) == 8
    others = {sticker["url"] for entry in stickers.builtin_catalog()["packs"] if entry["id"] != PACK for sticker in entry["stickers"]}
    assert not others & {sticker["url"] for sticker in pack["stickers"]}
    assert {sticker["name"] for sticker in pack["stickers"]} >= {"Nikolaus", "Krampus", "Mandarine", "Nüsse", "Schokolade"}
    # Hinten im Katalog: die Auswahl im Chat öffnet beim ersten Paket - das soll nicht das ganze Jahr ein Saison-Paket
    # sein („Vom Nikolaus“, „Zum Vereinsgeburtstag“). Erst alle anderen, dann die Saison-Pakete.
    order = [bool(entry.get("seasonal")) for entry in stickers.builtin_catalog()["packs"]]
    assert order == sorted(order) and order[-1]


def test_the_sticker_is_fixed_by_person_and_year_and_new_ones_come_first():
    pack = stickers.seasonal_pack("nikolaus")["stickers"]
    first = nikolaus.pick_sticker(pack, "alice", 2026, set())
    assert nikolaus.pick_sticker(pack, "alice", 2026, set()) == first
    later = nikolaus.pick_sticker(pack, "alice", 2027, {first["id"]})
    assert later["id"] != first["id"]
    owned = {sticker["id"] for sticker in pack[:-1]}
    assert nikolaus.pick_sticker(pack, "alice", 2033, owned)["id"] == pack[-1]["id"]
    # Wer schon alle hat, bekommt trotzdem einen - doppelt.
    assert nikolaus.pick_sticker(pack, "alice", 2034, {sticker["id"] for sticker in pack}) in pack


@pytest.mark.asyncio
async def test_on_december_6_the_boot_gives_one_sticker_per_person_and_year(flow, monkeypatch):
    clock(monkeypatch, 2026, 12, 6, 9, 30)
    alice = await flow.add_user(name="alice")
    bob = await flow.add_user(name="bob")
    flow.act_as(alice)
    assert pack_of((await flow.get("/api/stickers")).json()["packs"]) is None

    before = await flow.get("/api/seasonal/nikolaus")
    assert before.status_code == 200
    assert before.json() == {"active": True, "year": 2026, "opened": False, "sticker": None}
    assert before.headers["cache-control"] == "private, no-store"

    opened = await flow.post("/api/seasonal/nikolaus/open")
    assert opened.status_code == 200, opened.text
    gift = opened.json()
    assert gift["new"] is True and gift["year"] == 2026
    assert gift["sticker"]["pack_id"] == PACK and gift["sticker"]["pack_name"] == "Vom Nikolaus"
    assert gift["sticker"]["url"].startswith("/api/stickers/files/fluent/")

    again = (await flow.post("/api/seasonal/nikolaus/open")).json()
    assert again["new"] is False and again["sticker"] == gift["sticker"]
    assert (await flow.get("/api/seasonal/nikolaus")).json() == {"active": True, "year": 2026, "opened": True, "sticker": gift["sticker"]}
    assert await flow.db.user_stickers.count_documents({"user_id": alice["id"]}) == 1

    # Im Chat: das Paket mit genau diesem Sticker - nur für sie.
    mine = pack_of((await flow.get("/api/stickers")).json()["packs"])
    assert mine["seasonal"] == "nikolaus" and [sticker["id"] for sticker in mine["stickers"]] == [gift["sticker"]["id"]]
    flow.act_as(bob)
    assert pack_of((await flow.get("/api/stickers")).json()["packs"]) is None
    assert (await flow.get("/api/seasonal/nikolaus")).json()["opened"] is False


@pytest.mark.asyncio
async def test_only_the_owner_can_send_a_gifted_sticker(flow, monkeypatch):
    clock(monkeypatch, 2026, 12, 6, 18, 0)
    alice = await flow.add_user(name="alice")
    bob = await flow.add_user(name="bob")
    flow.act_as(alice)
    sticker_id = (await flow.post("/api/seasonal/nikolaus/open")).json()["sticker"]["id"]

    sent = await flow.post(f"/api/messages/direct/{bob['id']}", json={"sticker_id": sticker_id})
    assert sent.status_code == 200, sent.text
    assert sent.json()["sticker"]["pack_id"] == PACK

    flow.act_as(bob)
    foreign = await flow.post(f"/api/messages/direct/{alice['id']}", json={"sticker_id": sticker_id})
    assert foreign.status_code == 400
    # Lesen darf er die Nachricht mit dem Sticker natürlich.
    thread = await flow.get(f"/api/messages/direct/{alice['id']}")
    assert thread.status_code == 200
    assert any((message.get("sticker") or {}).get("id") == sticker_id for message in thread.json()["messages"])


@pytest.mark.asyncio
async def test_next_year_brings_one_she_does_not_have_yet(flow, monkeypatch):
    clock(monkeypatch, 2026, 12, 6, 9, 0)
    alice = await flow.add_user(name="alice")
    flow.act_as(alice)
    first = (await flow.post("/api/seasonal/nikolaus/open")).json()["sticker"]["id"]
    clock(monkeypatch, 2027, 12, 6, 9, 0)
    state = (await flow.get("/api/seasonal/nikolaus")).json()
    assert state["year"] == 2027 and state["opened"] is False
    second = (await flow.post("/api/seasonal/nikolaus/open")).json()
    assert second["new"] is True and second["sticker"]["id"] != first
    mine = pack_of((await flow.get("/api/stickers")).json()["packs"])
    assert {sticker["id"] for sticker in mine["stickers"]} == {first, second["sticker"]["id"]}


@pytest.mark.asyncio
async def test_no_boot_on_another_day_and_none_without_signing_in(flow, monkeypatch):
    clock(monkeypatch, 2026, 12, 5, 20, 0)
    alice = await flow.add_user(name="alice")
    flow.act_as(alice)
    assert (await flow.get("/api/seasonal/nikolaus")).json() == {"active": False, "opened": False, "sticker": None}
    closed = await flow.post("/api/seasonal/nikolaus/open")
    assert closed.status_code == 409
    assert "6. Dezember" in closed.json()["detail"]
    clock(monkeypatch, 2026, 12, 6, 12, 0)
    flow.act_as(None)
    assert (await flow.get("/api/seasonal/nikolaus")).status_code == 401
    assert (await flow.post("/api/seasonal/nikolaus/open")).status_code == 401
    assert await flow.db.user_stickers.count_documents({}) == 0


@pytest.mark.asyncio
async def test_the_admin_decides_season_off_forced_on_or_an_empty_boot(flow, monkeypatch):
    clock(monkeypatch, 2026, 12, 6, 10, 0)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    alice = await flow.add_user(name="alice")
    flow.act_as(admin)
    assert (await flow.put("/api/settings/seasons", json={"seasons": {"nikolaus": {"enabled": False}}})).status_code == 200
    flow.act_as(alice)
    assert (await flow.post("/api/seasonal/nikolaus/open")).status_code == 409

    # Erzwungen an einem anderen Tag: der Stiefel des kommenden 6. Dezember.
    clock(monkeypatch, 2026, 11, 20, 10, 0)
    flow.act_as(admin)
    assert (await flow.put("/api/settings/seasons", json={"seasons": {"nikolaus": {"enabled": True, "mode": "force_on"}}})).status_code == 200
    flow.act_as(alice)
    forced = await flow.post("/api/seasonal/nikolaus/open")
    assert forced.status_code == 200, forced.text
    assert forced.json()["year"] == 2026 and forced.json()["new"] is True
    owned = forced.json()["sticker"]["id"]

    # Paket im Admin abgeschaltet: kein neuer Sticker, der geschenkte steht nicht mehr zur Auswahl und geht nicht mehr raus.
    flow.act_as(admin)
    admin_packs = (await flow.get("/api/stickers/admin")).json()["packs"]
    assert pack_of(admin_packs)["seasonal"] == "nikolaus" and len(pack_of(admin_packs)["stickers"]) == 8
    assert (await flow.patch(f"/api/stickers/admin/packs/{PACK}", json={"active": False})).status_code == 200
    bob = await flow.add_user(name="bob")
    flow.act_as(bob)
    empty = await flow.post("/api/seasonal/nikolaus/open")
    assert empty.status_code == 200 and empty.json() == {"year": 2026, "sticker": None, "new": False}
    flow.act_as(alice)
    assert pack_of((await flow.get("/api/stickers")).json()["packs"]) is None
    assert (await flow.post(f"/api/messages/direct/{bob['id']}", json={"sticker_id": owned})).status_code == 400


@pytest.mark.asyncio
async def test_other_places_never_offer_the_gift_pack(flow):
    # Ohne Person (Türchen-Editor des Adventkalenders, alte Aufrufe) gibt es das Saison-Paket nicht.
    packs = await stickers.list_sticker_packs(flow.db)
    assert pack_of(packs) is None
    assert await stickers.resolve_sticker(flow.db, "fluent-santa-claus") is None


@pytest.mark.asyncio
async def test_the_preview_opens_the_boot_as_often_as_you_like_and_gives_nothing(flow, monkeypatch):
    """Rückmeldung des Betreibers (02.10.2026): in der Vorschau stand der Stiefel da, ließ sich aber nicht öffnen
    („kommt am 6. Dezember“). Mit dem Vorschau-Token geht er auf und zeigt den Sticker - vergeben wird nichts."""
    clock(monkeypatch, 2026, 10, 2, 20, 0)
    alice = await flow.add_user(name="alice")
    flow.act_as(alice)
    token = seasons.preview_token("nikolaus")
    state = (await flow.get("/api/seasonal/nikolaus", params={"preview": token})).json()
    assert state == {"active": True, "year": 2026, "opened": False, "sticker": None, "preview": True}
    for _ in range(2):
        opened = (await flow.post("/api/seasonal/nikolaus/open", params={"preview": token})).json()
        assert opened["preview"] is True and opened["new"] is True and opened["sticker"]["pack_id"] == PACK
    assert await flow.db.user_stickers.count_documents({}) == 0
    # Ein Token einer anderen Saison öffnet den Stiefel nicht.
    other = seasons.preview_token("snow")
    assert (await flow.post("/api/seasonal/nikolaus/open", params={"preview": other})).status_code == 409
