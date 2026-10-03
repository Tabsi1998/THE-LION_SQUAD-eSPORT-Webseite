"""Konten in der Mitgliederakte (#846, Vereine me/accounts): ein auf der Website geprüftes Konto (Discord, Twitch …) geht
nur auf Wunsch des Mitglieds in die Akte und steht dort als „bestätigt durch Anwendung“; Trennen nimmt es heraus, ein neu
verknüpftes Konto bringt seinen Namen mit; ein ungeprüftes geht nie hinein; ohne Fähigkeit „Konten“ steht der Grund da;
wünscht der Verein ein Konto, das fehlt, zeigt der Mitgliederbereich den Weg zum Verknüpfen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import dolibarr_client, dolibarr_identity, platform_links  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch):
    instance = FakeDolibarr()
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    dolibarr_identity.reset_cache()
    return instance


async def connect(flow, mode="live"):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": mode, "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1, "type_map": {"2": "ordinary"},
    }}, upsert=True)


async def setup(flow, fake, capabilities=("accounts",)) -> dict:
    """Paula: Mitglied 12, mit der Akte verbunden, Discord auf der Website geprüft."""
    await connect(flow)
    fake.add(member(12), email="paula@example.test")
    fake.invite("ALL", 12, capabilities=capabilities)
    paula = await flow.add_user(role="player", name="paula")
    paula["is_club_member"] = True
    flow.act_as(paula)
    bound = await flow.post("/api/membership/me/identity", json={"code": "ALL"})
    assert bound.status_code == 200 and bound.json()["status"] == "bound", bound.text
    await platform_links.link_account(flow.db, paula["id"], "discord", {"external_id": "4711", "handle": "paula", "display_name": "Paula B."})
    return paula


def rows(view: dict) -> dict:
    return {row["network"]: row for row in view["accounts"]}


@pytest.mark.asyncio
async def test_only_a_checked_account_goes_into_the_file_and_only_on_request(flow, fake):
    paula = await setup(flow, fake)
    view = (await flow.get("/api/membership/me/accounts")).json()
    assert view["available"] is True and view["wishes"] == []
    discord, steam = rows(view)["discord"], rows(view)["steam"]
    assert discord["asked"] == "required" and discord["asked_label"] == "Der Verein wünscht" and discord["website"] == {"linked": True, "handle": "paula"}
    assert discord["shared"] is False and discord["can_share"] is True and discord["in_file"]["handle"] == ""
    assert steam["asked"] == "optional" and steam["website"]["linked"] is False and steam["can_share"] is False
    assert fake.member_accounts == {}, "ohne Wunsch geht nichts in die Akte"

    shared = await flow.put("/api/membership/me/accounts/discord", json={"share": True})
    assert shared.status_code == 200, shared.text
    assert fake.member_accounts[12]["discord"] == {"handle": "paula", "external_id": "4711", "confirmed": True, "confirmed_at": fake.server_time, "client": "Website"}
    after = rows(shared.json())["discord"]
    assert after["shared"] is True and after["in_file"]["confirmed"] is True and after["in_file"]["handle"] == "paula"
    assert await flow.db.audit_logs.count_documents({"action": "dolibarr.accounts.share", "actor_id": paula["id"]}) == 1

    # Nicht geprüft (Steam nur getippt): nie in die Akte.
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"steam_id": "paula_steam"}})
    refused = await flow.put("/api/membership/me/accounts/steam", json={"share": True})
    assert refused.status_code == 409 and "verknüpfen" in refused.json()["detail"] and "steam" not in fake.member_accounts[12]
    assert (await flow.put("/api/membership/me/accounts/myspace", json={"share": True})).status_code == 404

    off = await flow.put("/api/membership/me/accounts/discord", json={"share": False})
    assert off.status_code == 200 and "discord" not in fake.member_accounts[12] and rows(off.json())["discord"]["shared"] is False
    assert await flow.db.audit_logs.count_documents({"action": "dolibarr.accounts.unshare", "actor_id": paula["id"]}) == 1


@pytest.mark.asyncio
async def test_unlinking_takes_it_out_and_a_new_link_brings_its_name(flow, fake):
    paula = await setup(flow, fake)
    await flow.put("/api/membership/me/accounts/discord", json={"share": True})

    await platform_links.link_account(flow.db, paula["id"], "discord", {"external_id": "4711", "handle": "paula_neu", "display_name": "Paula B."})
    assert fake.member_accounts[12]["discord"]["handle"] == "paula_neu", "der neue Name folgt in die Akte"

    await platform_links.unlink(flow.db, paula["id"], "discord")
    assert "discord" not in fake.member_accounts[12], "getrennt heißt: auch aus der Akte"
    user = await flow.db.users.find_one({"id": paula["id"]}, {"_id": 0, "dolibarr_accounts_shared": 1})
    assert not (user.get("dolibarr_accounts_shared") or {}).get("discord")

    # Der Verein wünscht Discord, es fehlt jetzt: der Weg zum Verknüpfen.
    view = (await flow.get("/api/membership/me/accounts")).json()
    assert view["wishes"] == [{"network": "discord", "platform": "discord", "label": "Discord", "asked": "required"}]

    # Wieder verknüpft: nicht von selbst in der Akte - der Wunsch gilt neu.
    await platform_links.link_account(flow.db, paula["id"], "discord", {"external_id": "4711", "handle": "paula", "display_name": "Paula B."})
    assert "discord" not in fake.member_accounts[12]


@pytest.mark.asyncio
async def test_reasons_instead_of_a_switch(flow, fake):
    paula = await setup(flow, fake, capabilities=("documents",))
    view = (await flow.get("/api/membership/me/accounts")).json()
    assert view["available"] is False and view["reason"] == "no_capability" and "Konten" in view["text"]
    assert (await flow.put("/api/membership/me/accounts/discord", json={"share": True})).status_code == 409
    assert fake.member_accounts == {}

    # Ein Netzwerk, das die Akte nicht kennt: der Vorstand nimmt es ins Wörterbuch auf.
    fake.revoke_identity(paula["id"])
    fake.invite("ACC", 12, capabilities=("accounts",))
    assert (await flow.post("/api/membership/me/identity", json={"code": "ACC"})).json()["status"] == "bound"
    await platform_links.link_account(flow.db, paula["id"], "twitch", {"external_id": "99", "handle": "paula_tv", "display_name": "Paula"})
    fake.account_networks.pop("twitch")
    unknown = await flow.put("/api/membership/me/accounts/twitch", json={"share": True})
    assert unknown.status_code == 400 and "Wörterbuch" in unknown.json()["detail"]

    await connect(flow, mode="preview")
    view = (await flow.get("/api/membership/me/accounts")).json()
    assert view["available"] is False and view["reason"] == "not_connected"
