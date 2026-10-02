"""Der Vereinsgeburtstag (S13 #644, B3 #751) - durch die echte Anwendung geschickt.

Ohne Gründungstag kein Geburtstag; mit ihm genau an dem Tag, mit den richtigen Jahren. Das Datum steht unter Verein →
Über uns (oder kommt aus Dolibarr), das Gründungsjahr folgt daraus. Vereinsmitglieder holen sich einen Jahres-Sticker
aus „Zum Vereinsgeburtstag“, einen je Jahr; andere bekommen keinen. Der Bot grüßt ab 10:00 einmal im Jahr - nur mit
eingeschaltetem Ereignis, nie bei einer erzwungenen Saison.
"""
import pathlib
import sys
from datetime import date, datetime

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import club_birthday, founding, seasons, stickers  # noqa: E402

PACK = "fluent-vereinsgeburtstag"


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


async def founded(flow, day: str | None = "2019-03-01", year: int | None = None):
    await flow.db.settings.update_one({"id": founding.ABOUT_SETTINGS_ID}, {"$set": {"id": founding.ABOUT_SETTINGS_ID, "founded_on": day, "founded_year": year}}, upsert=True)


async def member(flow, name="mitglied"):
    user = await flow.add_user(name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"is_club_member": True}})
    user["is_club_member"] = True
    return user


def test_founding_date_from_the_hand_field_or_dolibarr():
    assert founding.resolve("2019-03-01", None) == {"founded_on": "2019-03-01", "founded_year": 2019, "source": "manual"}
    # Nur ein Jahr: reicht für „Jahre aktiv“, nicht für einen Geburtstag.
    assert founding.resolve(None, 2019) == {"founded_on": None, "founded_year": 2019, "source": "manual"}
    assert founding.resolve("kein Datum", "x") == {"founded_on": None, "founded_year": None, "source": "manual"}
    # Mit dem Schalter gewinnt Dolibarr; kennt es nur das Jahr, bleibt der Tag aus dem Handfeld, wenn er passt.
    assert founding.resolve("2018-05-05", 2018, "2019-03-01", True)["founded_on"] == "2019-03-01"
    assert founding.resolve("2019-07-01", None, "2019", True) == {"founded_on": "2019-07-01", "founded_year": 2019, "source": "dolibarr"}
    assert founding.resolve("2018-07-01", None, "2019", True)["founded_on"] is None
    assert founding.resolve("2019-03-01", None, None, True)["source"] == "manual"
    assert founding.years_on("2019-03-01", date(2027, 3, 1)) == 8
    assert founding.years_on("2019-03-01", date(2027, 2, 28)) == 7
    assert founding.years_on(None, date(2027, 3, 1)) is None


@pytest.mark.asyncio
async def test_the_date_is_kept_under_about_and_the_year_follows(flow):
    admin = await flow.add_user(role="superadmin", name="vorstand")
    flow.act_as(admin)
    saved = await flow.put("/api/home/about/admin", json={"founded_on": "2019-03-01", "founded_year": None})
    assert saved.status_code == 200, saved.text
    assert saved.json()["texts"]["founded_on"] == "2019-03-01"
    assert saved.json()["texts"]["founded_year"] == 2019
    # Ein anderes Jahr daneben gibt es nicht: der Tag bestimmt das Jahr.
    assert (await flow.put("/api/home/about/admin", json={"founded_on": "2019-03-01", "founded_year": 2015})).json()["texts"]["founded_year"] == 2019
    public = (await flow.get("/api/home/about")).json()
    assert public["organization"]["founded_on"] == "2019-03-01" and public["organization"]["founded_year"] == 2019
    assert "founded_on" not in public["texts"]
    for wrong in ("2019-02-30", "01.03.2019", "2999-01-01"):
        assert (await flow.put("/api/home/about/admin", json={"founded_on": wrong})).status_code == 422, wrong
    cleared = await flow.put("/api/home/about/admin", json={"founded_on": ""})
    assert cleared.json()["texts"]["founded_on"] is None


@pytest.mark.asyncio
async def test_no_birthday_without_a_date_and_exactly_on_the_day_with_it(flow, monkeypatch):
    clock(monkeypatch, 2027, 3, 1, 9, 0)
    keys = lambda payload: {season["key"]: season for season in payload["seasons"]}  # noqa: E731
    assert "club_birthday" not in keys((await flow.get("/api/seasonal/active")).json())
    await founded(flow, None, 2019)
    assert "club_birthday" not in keys((await flow.get("/api/seasonal/active")).json())
    await founded(flow, "2019-03-01")
    birthday = keys((await flow.get("/api/seasonal/active")).json())["club_birthday"]
    assert birthday["data"] == {"years": 8, "founded_on": "2019-03-01"}
    assert birthday["texts"]["greeting"].startswith("8 Jahre ")
    clock(monkeypatch, 2027, 3, 2, 0, 1)
    assert "club_birthday" not in keys((await flow.get("/api/seasonal/active")).json())


@pytest.mark.asyncio
async def test_members_get_one_sticker_a_year_others_none(flow, monkeypatch):
    clock(monkeypatch, 2027, 3, 1, 11, 0)
    await founded(flow)
    mia = await member(flow, "mia")
    flow.act_as(mia)
    state = await flow.get("/api/seasonal/birthday")
    assert state.status_code == 200 and state.headers["cache-control"] == "private, no-store"
    assert state.json() == {"active": True, "year": 2027, "years": 8, "member": True, "claimed": False, "sticker": None}
    gift = (await flow.post("/api/seasonal/birthday/sticker")).json()
    assert gift["new"] is True and gift["sticker"]["pack_id"] == PACK and gift["sticker"]["pack_name"] == "Zum Vereinsgeburtstag"
    again = (await flow.post("/api/seasonal/birthday/sticker")).json()
    assert again["new"] is False and again["sticker"] == gift["sticker"]
    assert (await flow.get("/api/seasonal/birthday")).json()["claimed"] is True
    packs = (await flow.get("/api/stickers")).json()["packs"]
    mine = next(pack for pack in packs if pack["id"] == PACK)
    assert [sticker["id"] for sticker in mine["stickers"]] == [gift["sticker"]["id"]]

    guest = await flow.add_user(name="gast")
    flow.act_as(guest)
    assert (await flow.get("/api/seasonal/birthday")).json()["member"] is False
    assert (await flow.post("/api/seasonal/birthday/sticker")).status_code == 403
    clock(monkeypatch, 2027, 3, 2, 11, 0)
    flow.act_as(mia)
    assert (await flow.get("/api/seasonal/birthday")).json()["active"] is False
    assert (await flow.post("/api/seasonal/birthday/sticker")).status_code == 409


def test_the_birthday_pack_has_eight_pictures_of_its_own():
    pack = stickers.seasonal_pack("club_birthday")
    assert pack["id"] == PACK and len(pack["stickers"]) == 8
    others = {sticker["url"] for entry in stickers.builtin_catalog()["packs"] if entry["id"] != PACK for sticker in entry["stickers"]}
    assert not others & {sticker["url"] for sticker in pack["stickers"]}
    root = pathlib.Path(__file__).resolve().parents[1] / "static" / "stickers" / "fluent"
    assert all((root / sticker["url"].rsplit("/", 1)[-1]).is_file() for sticker in pack["stickers"])


@pytest.mark.asyncio
async def test_discord_greets_once_a_year_from_ten_only_when_switched_on(flow, monkeypatch):
    import discord_service

    sent = []

    async def fake_send(event_key, title, description="", **kwargs):
        sent.append((event_key, title, description))
        return {"ok": True}

    monkeypatch.setattr(discord_service, "send_event", fake_send)
    season = {"key": "club_birthday", "forced": False, "starts_at": "2027-03-01T00:00:00+01:00", "data": {"years": 8}, "texts": {"greeting": "8 Jahre THE LION SQUAD – danke, dass ihr dabei seid"}}
    morning = datetime(2027, 3, 1, 9, 50, tzinfo=seasons.VIENNA)
    ten = datetime(2027, 3, 1, 10, 0, tzinfo=seasons.VIENNA)
    assert (await club_birthday.greet_on_discord(flow.db, season, ten))["reason"] == "event_disabled"
    await flow.db.settings.update_one({"id": "discord"}, {"$set": {"id": "discord", "events": {discord_service.event_field("club.birthday"): True}}}, upsert=True)
    assert (await club_birthday.greet_on_discord(flow.db, season, morning))["reason"] == "too_early"
    assert (await club_birthday.greet_on_discord(flow.db, {**season, "forced": True}, ten))["reason"] == "no_birthday"
    assert (await club_birthday.greet_on_discord(flow.db, season, ten))["sent"] is True
    assert sent == [("club.birthday", "🎂 8 Jahre THE LION SQUAD", "8 Jahre THE LION SQUAD – danke, dass ihr dabei seid")]
    assert (await club_birthday.greet_on_discord(flow.db, season, ten))["reason"] == "already_sent"
    assert len(sent) == 1
    assert discord_service.EVENTS["club.birthday"] == {"target": "community", "label": "Vereinsgeburtstag", "default": False}
