"""Rollen je Server (#629, Discord VI D6) mit nachgestelltem Discord: die drei Vereinsrollen auf dem Hauptserver und jedem
eingeschalteten Unterserver, Spiel-Rollen aus Spielprofil und Team-Kader (Editionen zählen fürs Hauptspiel) auf dem
Server des Spiels und am Hauptserver, Abwahl im Profil, „Fehlende Rollen anlegen“ je Server, höchstens SYNC_LIMIT
Änderungen je Lauf - und der Bot fasst nie eine fremde Rolle an."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import discord_bot, discord_guilds, discord_roles  # noqa: E402

MAIN, COD, OFF = "810000000000000001", "810000000000000002", "810000000000000003"
PAULA, OTTO, LEON = "210000000000000001", "210000000000000002", "210000000000000003"
ALL = {key: True for key, _, _ in discord_guilds.PERMISSIONS}


class FakeRole:
    def __init__(self, name, mentionable=False):
        self.name = name
        self.mentionable = mentionable

    def __repr__(self):
        return f"<Rolle {self.name}>"


class FakeMember:
    def __init__(self, member_id, roles=()):
        self.id = int(member_id)
        self.roles = list(roles)

    async def add_roles(self, *roles, reason=None):
        self.roles.extend(role for role in roles if role not in self.roles)

    async def remove_roles(self, *roles, reason=None):
        self.roles = [role for role in self.roles if role not in roles]

    def names(self):
        return sorted(role.name for role in self.roles)


class FakeGuild:
    def __init__(self, guild_id, name, roles, member_ids, *, chunked=True):
        self.id = int(guild_id)
        self.name = name
        self.roles = [FakeRole(role) for role in roles]
        self.members = {int(member_id): FakeMember(member_id) for member_id in member_ids}
        self.chunked = chunked
        self.fetches = 0
        self.refuse_create = False

    def role(self, name):
        return next(role for role in self.roles if role.name == name)

    def member(self, member_id):
        return self.members[int(member_id)]

    def get_member(self, member_id):
        return self.members.get(int(member_id))

    async def fetch_member(self, member_id):
        self.fetches += 1
        raise RuntimeError("404 Not Found (error code: 10007): Unknown Member")

    async def create_role(self, *, name, mentionable=False, reason=None):
        if self.refuse_create:
            raise RuntimeError("403 Forbidden (error code: 50013): Missing Permissions")
        role = FakeRole(name, mentionable)
        self.roles.append(role)
        return role


class FakeClient:
    def __init__(self, guilds):
        self.guilds = guilds


def seen(guild_id, name):
    return {"guild_id": guild_id, "name": name, "icon_url": None, "member_count": 10, "bot_permissions": dict(ALL)}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow):
    """Paula: Mitglied mit MW3-Profil (zählt für Call of Duty). Otto: im RL-Kader. Leon: CoD-Profil, Spiel-Rollen aus."""
    db = flow.db
    await discord_guilds.reconcile(db, [seen(MAIN, "LION"), seen(COD, "CoD-Server"), seen(OFF, "Alt")], configured_main=MAIN)
    await discord_guilds.update_guild(db, COD, {"enabled": True})
    await db.games.insert_many([
        {"id": "g-cod", "name": "Call of Duty", "short_name": "CoD", "slug": "cod", "discord_guild_id": COD},
        {"id": "g-mw3", "name": "MW3", "slug": "mw3", "kind": "edition", "parent_game_id": "g-cod"},
        {"id": "g-rl", "name": "Rocket League", "slug": "rl"},
    ])
    people = {}
    for name, discord_id, fields in (("paula", PAULA, {"game_ids": {"mw3": {"activision_id": "Paula#1"}}}),
                                     ("otto", OTTO, {"game_ids": {"rl": {"epic_id": " "}}}),
                                     ("leon", LEON, {"game_ids": {"cod": {"activision_id": "Leon#7"}}, "discord_game_roles": False})):
        user = await flow.add_user(role="player", name=name)
        await db.users.update_one({"id": user["id"]}, {"$set": fields})
        await db.platform_links.insert_one({"id": f"link-{name}", "user_id": user["id"], "platform": "discord", "external_id": discord_id, "handle": name})
        people[name] = user
    await db.memberships.insert_one({"user_id": people["paula"]["id"], "member_status": "active"})
    await db.team_squads.insert_many([
        {"id": "sq-rl", "team_id": "t1", "name": "RL A", "game_id": "g-rl", "member_ids": [people["otto"]["id"]], "status": "active"},
        {"id": "sq-old", "team_id": "t1", "name": "CoD alt", "game_id": "g-cod", "member_ids": [people["otto"]["id"]], "status": "archived"},
    ])
    main = FakeGuild(MAIN, "LION", ["Mitglied", "Vorstand", "Turnierleitung", "CoD-Spieler", "Rocket League-Spieler", "Booster"], [PAULA, OTTO, LEON])
    cod = FakeGuild(COD, "CoD-Server", ["Mitglied", "CoD-Spieler"], [PAULA, LEON])
    off = FakeGuild(OFF, "Alt", ["Mitglied"], [PAULA])
    main.member(LEON).roles = [main.role("CoD-Spieler"), main.role("Booster")]
    runner = discord_bot.BotRunner()
    runner._client, runner.connected = FakeClient([main, cod, off]), True
    return runner, main, cod, off, people


def test_role_names_and_the_plan_stay_inside_the_managed_roles():
    assert discord_roles.game_role_name({"name": "Call of Duty", "short_name": "CoD"}) == "CoD-Spieler"
    assert discord_roles.game_role_name({"name": "Rocket League"}) == "Rocket League-Spieler"
    assert discord_roles.game_role_name({"name": "Warzone", "discord_role_name": "  Warzone-Squad "}) == "Warzone-Squad"
    add, remove = discord_roles.member_plan({("club", "member"), ("game", "g1")}, {("club", "member"), ("game", "g2")}, {("club", "member"), ("game", "g1")})
    assert add == set() and remove == {("game", "g1")}, "g2 gibt es auf dem Server nicht - nichts anzulegen ohne Schalter"


@pytest.mark.asyncio
async def test_every_switched_on_server_gets_club_and_game_roles_and_opting_out_removes_them(flow):
    runner, main, cod, off, _ = await setup(flow)
    result = await runner.sync_roles()
    assert result["ok"] is True and set(result["servers"]) == {MAIN, COD}, "der ausgeschaltete Server bleibt unberührt"
    assert main.member(PAULA).names() == ["CoD-Spieler", "Mitglied"], "MW3 zählt fürs Hauptspiel Call of Duty"
    assert main.member(OTTO).names() == ["Rocket League-Spieler"], "aktiver Kader zählt, archivierter nicht; ein leeres Profil auch nicht"
    assert main.member(LEON).names() == ["Booster"], "Spiel-Rollen aus: weg - eine fremde Rolle bleibt"
    assert cod.member(PAULA).names() == ["CoD-Spieler", "Mitglied"] and cod.member(LEON).names() == []
    assert off.member(PAULA).names() == []
    assert main.fetches == 0 and cod.fetches == 0, "vollständige Mitgliederliste: keine Nachfrage für Leute, die nicht dort sind"

    row = await flow.db.discord_guilds.find_one({"guild_id": COD}, {"_id": 0, "roles_sync": 1})
    assert row["roles_sync"]["missing"] == ["Vorstand", "Turnierleitung"] and row["roles_sync"]["changes"] == 2 and row["roles_sync"]["missing_games"] == []
    state = await discord_bot.read_state(flow.db)
    assert state["missing_roles"] == [] and state["last_sync_changes"] == result["changes"] == 6
    assert (await runner.sync_roles())["changes"] == 0, "nichts zu tun: kein Aufruf"


@pytest.mark.asyncio
async def test_missing_roles_are_only_created_with_the_switch_and_the_limit_carries_over(flow, monkeypatch):
    runner, main, cod, _, _ = await setup(flow)
    await discord_guilds.update_guild(flow.db, COD, {"create_roles": True})
    cod.roles = [role for role in cod.roles if role.name != "CoD-Spieler"]
    monkeypatch.setattr(discord_bot, "SYNC_LIMIT", 3)
    first = await runner.sync_roles()
    assert first["changes"] == 3 and first["servers"][MAIN]["limited"] is True, "höchstens drei Änderungen - der Rest kommt im nächsten Lauf"
    created = (await flow.db.discord_guilds.find_one({"guild_id": COD}, {"_id": 0, "roles_sync": 1}))["roles_sync"]["created"]
    assert sorted(created) == ["CoD-Spieler", "Turnierleitung", "Vorstand"] and cod.role("CoD-Spieler").mentionable is True and cod.role("Vorstand").mentionable is False
    second = await runner.sync_roles()
    assert second["changes"] == 3 and cod.member(PAULA).names() == ["CoD-Spieler", "Mitglied"]
    assert main.member(OTTO).names() == ["Rocket League-Spieler"]

    # Ohne „Rollen verwalten“: der Grund steht am Server, die anderen Server laufen weiter.
    cod.refuse_create = True
    cod.roles = [role for role in cod.roles if role.name != "Vorstand"]
    third = await runner.sync_roles()
    sync = (await flow.db.discord_guilds.find_one({"guild_id": COD}, {"_id": 0, "roles_sync": 1}))["roles_sync"]
    assert "Missing Permissions" in sync["error"] and sync["missing"] == ["Vorstand"] and third["ok"] is True
    assert runner.last_error.startswith("Rollen: CoD-Server: Rolle „Vorstand“ nicht angelegt")


@pytest.mark.asyncio
async def test_without_a_full_member_list_the_bot_asks_and_the_settings_reach_the_api(flow):
    runner, main, cod, _, people = await setup(flow)
    cod.chunked = False
    del cod.members[int(LEON)]
    await runner.sync_roles()
    assert cod.fetches == 2, "Otto und Leon sind nicht dort, die Liste ist unvollständig: je einmal nachgefragt"

    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    assert (await flow.patch("/api/games/g-cod", json={"discord_role_name": "CoD-Gang"})).status_code == 200
    assert (await flow.db.games.find_one({"id": "g-cod"}, {"_id": 0}))["discord_role_name"] == "CoD-Gang"
    assert (await flow.patch("/api/games/g-cod", json={"discord_role_name": None})).status_code == 200
    assert (await flow.db.games.find_one({"id": "g-cod"}, {"_id": 0})).get("discord_role_name") is None, "leer: wieder die Vorgabe"
    response = await flow.patch(f"/api/settings/discord/guilds/{COD}", json={"create_roles": True})
    assert response.status_code == 200 and response.json()["create_roles"] is True
    flow.act_as(people["paula"])
    assert (await flow.put("/api/users/me", json={"discord_game_roles": False})).status_code == 200
    assert (await flow.db.users.find_one({"id": people["paula"]["id"]}, {"_id": 0}))["discord_game_roles"] is False
    await runner.sync_roles()
    assert main.member(PAULA).names() == ["Mitglied"], "abgewählt: Spiel-Rolle weg, Vereinsrolle bleibt"
