"""Ehrungen aus der Mitgliederakte (#848, Vereine 1.8.0): Das Mitglied sieht im eigenen Profil alle eigenen Ehrungen
samt Hinweis, welche der Verein veröffentlichen lässt. Öffentlich erscheint eine Ehrung nur mit beidem - Haken des
Vereins und Schalter des Mitglieds; zieht der Verein den Haken zurück oder schaltet das Mitglied aus, ist sie weg.
Ohne Verbindung, mit altem Modul oder ohne Fähigkeit „Mitgliederakte“ steht der Grund da. Jubiläen 5, 10 und 25 Jahre
kommen aus dem Mitgliedsbeginn."""
import pathlib
import sys
from datetime import datetime, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import achievement_counters as counters, dolibarr_client, dolibarr_honours, dolibarr_identity  # noqa: E402
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


async def connect(flow, module="1.9.0"):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": "live", "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1,
    }}, upsert=True)
    await flow.db.settings.update_one({"id": "dolibarr_sync_state"}, {"$set": {"id": "dolibarr_sync_state", "module_version": module}}, upsert=True)


async def paula_with_honours(flow, fake) -> dict:
    """Paula: Mitglied 12, zugeordnet; Ehrenmitglied (darf öffentlich) und Verdienstnadel (bleibt intern)."""
    await connect(flow)
    fake.add(member(12))
    fake.add_honour(12, kind="honorary", kind_label="Ehrenmitgliedschaft", title="Ehrenmitglied", label="Aufbau der Jugendarbeit", given_on="2026-05-01")
    fake.add_honour(12, kind="merit", kind_label="Verdienstnadel", title="Verdienstnadel in Silber", given_on="2026-03-14", publishable=False)
    paula = await flow.add_user(role="player", name="paula")
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"privacy_public_profile": True}})
    await flow.db.dolibarr_links.insert_one({"id": "l-paula", "user_id": paula["id"], "instance": "verein:1", "member_key": "verein:1:12",
                                             "member_id": 12, "member_ref": "12", "status": "verified"})
    flow.act_as(paula)
    return paula


async def public_honours(flow, username="paula") -> list:
    response = await flow.get(f"/api/users/public/{username}")
    assert response.status_code == 200, response.text
    return response.json()["honours"]


@pytest.mark.asyncio
async def test_own_honours_all_public_only_with_both_switches(flow, fake):
    await paula_with_honours(flow, fake)
    mine = (await flow.get("/api/me/honours")).json()
    assert mine["available"] is True and mine["public"] is False
    assert [(h["title"], h["publishable"]) for h in mine["honours"]] == [("Ehrenmitglied", True), ("Verdienstnadel in Silber", False)]
    assert await public_honours(flow) == []

    # Erst mit dem eigenen Schalter - und dann nur, was der Verein freigibt, ohne den Merker.
    switched = await flow.put("/api/me/honours/public", json={"on": True})
    assert switched.status_code == 200 and switched.json()["public"] is True and switched.json()["shown"] == 1
    assert await public_honours(flow) == [{"kind": "honorary", "kind_label": "Ehrenmitgliedschaft", "title": "Ehrenmitglied", "years": 0,
                                           "label": "Aufbau der Jugendarbeit", "given_on": "2026-05-01"}]

    # Der Verein zieht den Haken zurück: nach dem stündlichen Lauf ist sie weg; das Mitglied schaltet aus: sofort weg.
    fake.honours[12][0]["publishable"] = False
    assert (await dolibarr_honours.refresh_due())["refreshed"] == 1
    assert await public_honours(flow) == []
    fake.honours[12][0]["publishable"] = True
    await dolibarr_honours.refresh_due()
    assert len(await public_honours(flow)) == 1
    assert (await flow.put("/api/me/honours/public", json={"on": False})).json()["public"] is False
    assert await public_honours(flow) == []


@pytest.mark.asyncio
async def test_reasons_instead_of_a_list(flow, fake):
    paula = await paula_with_honours(flow, fake)
    # Modul vor 1.8.0
    await connect(flow, module="1.7.0")
    assert (await flow.get("/api/me/honours")).json()["reason"] == "module_version"
    await connect(flow)
    # Recht „im Namen jedes Mitglieds handeln“ fehlt
    fake.members_act_right = False
    missing = (await flow.get("/api/me/honours")).json()
    assert missing["reason"] == "right_missing" and "im Namen jedes Mitglieds" in missing["text"]
    fake.members_act_right = True
    # Bindung per Einladungscode ohne Fähigkeit „Mitgliederakte“
    await flow.db.dolibarr_links.delete_one({"user_id": paula["id"]})
    dolibarr_identity.reset_cache()
    fake.invite("OHNE", 12, capabilities=("documents",))
    assert (await flow.post("/api/membership/me/identity", json={"code": "OHNE"})).json()["status"] == "bound"
    assert (await flow.get("/api/me/honours")).json()["reason"] == "no_capability"
    # Ohne jede Verbindung
    other = await flow.add_user(role="player", name="gast")
    flow.act_as(other)
    assert (await flow.get("/api/me/honours")).json()["reason"] == "not_bound"


@pytest.mark.asyncio
async def test_jubilee_years_from_the_start_of_membership(flow, monkeypatch):
    me = await flow.add_user(name="treu")
    await flow.db.memberships.insert_one({"user_id": me["id"], "member_status": "active", "member_since": "2016-10-04"})
    monkeypatch.setattr(counters, "now_utc", lambda: datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc))
    assert (await counters.compute(me["id"], {"membership_years"}))["membership_years"] == 9, "der zehnte Jahrestag ist erst morgen"
    monkeypatch.setattr(counters, "now_utc", lambda: datetime(2026, 10, 4, 12, 0, tzinfo=timezone.utc))
    assert (await counters.compute(me["id"], {"membership_years"}))["membership_years"] == 10
    await flow.db.memberships.update_one({"user_id": me["id"]}, {"$set": {"member_status": "former"}})
    assert (await counters.compute(me["id"], {"membership_years"}))["membership_years"] == 0, "nur aktive Mitglieder feiern"
