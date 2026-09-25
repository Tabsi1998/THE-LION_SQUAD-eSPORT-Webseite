"""„Gerade in Steam“ (#584): nur verknüpfte Konten mit Opt-in werden abgefragt, private Profile bleiben
still, der Stand ist gebündelt und gecacht, nach zehn Minuten leer, und wer die Verknüpfung löst, ist
sofort draußen. Nichts davon für Nicht-Mitglieder."""
import pathlib
import sys
from datetime import timedelta

import httpx
import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id, now_utc  # noqa: E402
from services import steam_presence  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402

KEY = "STEAMKEY" * 4


class FakeSteam:
    def __init__(self):
        self.calls: list[list[str]] = []
        self.players: dict[str, dict] = {}
        self.status = 200

    def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.url.params.get("key") == KEY, "der Schlüssel aus den Einstellungen"
        ids = request.url.params.get("steamids", "").split(",")
        self.calls.append(ids)
        if self.status != 200:
            return httpx.Response(self.status, json={})
        return httpx.Response(200, json={"response": {"players": [dict(self.players[i], steamid=i) for i in ids if i in self.players]}})


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def steam(monkeypatch):
    fake = FakeSteam()
    monkeypatch.setattr(steam_presence, "_transport", httpx.MockTransport(fake.handle))
    return fake


async def member_with_steam(flow, name: str, steam_id: str, *, opt_in: bool = True, member: bool = True) -> dict:
    user = await flow.add_user(role="player", name=name)
    fields = {"is_club_member": member, "show_steam_status": opt_in, "display_name": name.capitalize()}
    await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    user.update(fields)   # der Test-Login liest die Person nicht neu aus der Datenbank
    await flow.db.platform_links.insert_one({"id": new_id(), "user_id": user["id"], "platform": "steam", "external_id": steam_id, "handle": steam_id, "display_name": name})
    return user


async def with_key(flow):
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"id": "branding", "steam_api_key": encrypt_secret(KEY)}}, upsert=True)


def test_rows_only_for_online_people_playing_first():
    accounts = [{"user_id": "u1", "steam_id": "1", "display_name": "Zoe"}, {"user_id": "u2", "steam_id": "2", "display_name": "Anna"},
                {"user_id": "u3", "steam_id": "3", "display_name": "Privat"}, {"user_id": "u4", "steam_id": "4", "display_name": "Bea"}]
    players = {"1": {"personastate": 1, "gameextrainfo": "Rocket League", "gameid": "252950"}, "2": {"personastate": 3}, "3": {"personastate": 0}, "4": {"personastate": 1}}
    rows = steam_presence.presence_rows(players, accounts)
    assert [row["display_name"] for row in rows] == ["Zoe", "Anna", "Bea"], "spielt zuerst, dann nach Namen; offline/privat fehlt"
    assert rows[0]["state_text"] == "spielt gerade Rocket League" and rows[0]["game_id"] == "252950"
    assert rows[1]["state"] == "online" and rows[1]["state_text"] == "abwesend" and rows[1]["game"] is None


@pytest.mark.asyncio
async def test_only_opted_in_linked_members_are_asked_and_private_profiles_stay_quiet(flow, steam):
    paula = await member_with_steam(flow, "paula", "76561198000000001")
    await member_with_steam(flow, "leon", "76561198000000002", opt_in=False)
    await member_with_steam(flow, "mira", "76561198000000003")   # privates Steam-Profil: Steam meldet offline
    steam.players = {"76561198000000001": {"personastate": 1, "gameextrainfo": "Rocket League"}, "76561198000000002": {"personastate": 1}, "76561198000000003": {"personastate": 0}}

    flow.act_as(paula)
    without_key = (await flow.get("/api/membership/steam-presence")).json()
    assert without_key["available"] is False and without_key["me"] == {"linked": True, "opted_in": True}
    assert (await steam_presence.poll(flow.db))["error"] == "no_api_key" and steam.calls == []

    await with_key(flow)
    result = await steam_presence.poll(flow.db)
    assert result == {"checked": 2, "online": 1, "error": None}
    assert steam.calls == [["76561198000000001", "76561198000000003"]], "Leon ohne Opt-in wird nie abgefragt"

    data = (await flow.get("/api/membership/steam-presence")).json()
    assert data["available"] is True and data["stale"] is False and data["online_count"] == 1
    assert data["players"][0]["display_name"] == "Paula" and data["players"][0]["state_text"] == "spielt gerade Rocket League"
    assert "steam_id" not in data["players"][0] and "76561198000000001" not in str(data)
    assert all(row["display_name"] != "Mira" for row in data["players"]), "privates Profil bleibt still"


@pytest.mark.asyncio
async def test_stale_cache_and_unlinking_take_people_out_immediately(flow, steam):
    paula = await member_with_steam(flow, "paula", "76561198000000001")
    leon = await member_with_steam(flow, "leon", "76561198000000002")
    await with_key(flow)
    steam.players = {"76561198000000001": {"personastate": 1}, "76561198000000002": {"personastate": 2, "gameextrainfo": "Counter-Strike 2"}}
    await steam_presence.poll(flow.db)
    flow.act_as(paula)
    assert (await flow.get("/api/membership/steam-presence")).json()["online_count"] == 2

    await flow.db.platform_links.delete_one({"user_id": leon["id"], "platform": "steam"})
    after_unlink = (await flow.get("/api/membership/steam-presence")).json()
    assert [row["display_name"] for row in after_unlink["players"]] == ["Paula"], "gelöst = sofort draußen, ohne neuen Abruf"

    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"show_steam_status": False}})
    assert (await flow.get("/api/membership/steam-presence")).json()["players"] == [], "Schalter aus = sofort draußen"
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"show_steam_status": True}})

    old = (now_utc() - timedelta(seconds=steam_presence.STALE_AFTER_SECONDS + 5)).isoformat()
    await flow.db.settings.update_one({"id": steam_presence.STATE_ID}, {"$set": {"fetched_at": old}})
    stale = (await flow.get("/api/membership/steam-presence")).json()
    assert stale["stale"] is True and stale["players"] == [] and stale["online_count"] == 0

    steam.status = 500
    broken = await steam_presence.poll(flow.db)
    assert broken["error"] == "Steam antwortet 500" and broken["online"] == 0
    assert (await flow.get("/api/membership/steam-presence")).json()["players"] == []


@pytest.mark.asyncio
async def test_more_than_hundred_accounts_are_batched_and_non_members_get_403(flow, steam):
    await with_key(flow)
    users = [{"id": f"u{i}", "username": f"spieler{i}", "display_name": f"Spieler {i}", "is_active": True, "is_club_member": True, "show_steam_status": True,
              "email": f"s{i}@lionsquad-test.at", "role": "player", "password_hash": "x", "created_at": now_utc().isoformat()} for i in range(101)]
    await flow.db.users.insert_many(users)
    await flow.db.platform_links.insert_many([{"id": new_id(), "user_id": f"u{i}", "platform": "steam", "external_id": f"7656119800000{i:04d}"} for i in range(101)])
    steam.players = {f"7656119800000{i:04d}": {"personastate": 1} for i in range(0, 101, 10)}
    result = await steam_presence.poll(flow.db)
    assert result["checked"] == 101 and result["online"] == 11
    assert [len(call) for call in steam.calls] == [100, 1], "gebündelt in Hunderter-Paketen"

    guest = await flow.add_user(role="player", name="gast")
    await flow.db.users.update_one({"id": guest["id"]}, {"$set": {"is_club_member": False}})
    flow.act_as(guest)
    assert (await flow.get("/api/membership/steam-presence")).status_code == 403

    member = await member_with_steam(flow, "paula", "76561198000000001")
    flow.act_as(member)
    data = (await flow.get("/api/membership/steam-presence")).json()
    assert data["online_count"] == 11 and len(data["players"]) == steam_presence.MAX_SHOWN, "Zähler ganz, Liste höchstens acht"
