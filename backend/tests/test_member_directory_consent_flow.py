"""Mitgliederverzeichnis aus der Dolibarr-Einwilligung (#410 Nachtrag): stimmt ein Mitglied in Dolibarr der Nennung
zu, legt der Abgleich den Eintrag an (Name aus der Mitgliederverwaltung); was der Vorstand ergänzt, bleibt beim
nächsten Abgleich stehen; ein Widerruf nimmt den Eintrag offline - auch einen vom Mitglied selbst angelegten."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import dolibarr_client, dolibarr_sync  # noqa: E402
from services.dolibarr_links import verify_link  # noqa: E402
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
    return instance


async def connect(flow, mode="live"):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": mode, "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1, "type_map": {"2": "ordinary"},
    }}, upsert=True)


async def linked_member(flow, fake, name, member_id, **fields):
    fake.add(member(member_id, **fields), email=f"{name}@example.test")
    user = await flow.add_user(role="player", name=name)
    settings = await dolibarr_client.load_settings(flow.db)
    await verify_link(flow.db, settings, user_id=user["id"], member_id=member_id, member_ref=str(member_id), source="admin", actor_id="admin")
    return user


async def profile_of(flow, user):
    return await flow.db.club_member_profiles.find_one({"user_id": user["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_directory_entry_follows_the_consent_in_dolibarr(flow, fake):
    await connect(flow)
    fake.consent_texts.append({"code": "verzeichnis", "label": "Nennung im Mitgliederverzeichnis", "version": 1, "text": "Mein Name darf im Mitgliederverzeichnis stehen."})
    paula = await linked_member(flow, fake, "paula", 12)

    # Ohne eingestellten Code und ohne Einwilligung: nichts passiert.
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 0
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {"directory_consent_code": "verzeichnis"}})
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 0
    assert await profile_of(flow, paula) is None

    # Einwilligung gegeben: Eintrag angelegt - Name aus Dolibarr, öffentlich sichtbar, ohne Zutun des Mitglieds.
    fake.member_consents[12] = {"verzeichnis": {"state": "given", "version": 1, "moment": "2026-09-25T09:00:00+00:00"}}
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 1
    profile = await profile_of(flow, paula)
    assert profile["source"] == "dolibarr" and profile["display_name"] == "Paula Beispiel" and profile["real_name"] == "Paula Beispiel"
    assert profile["is_active"] is True and profile["gamertag"] == "paula" and profile["slug"] == "paula" and profile["consent"]["code"] == "verzeichnis"
    flow.act_as(None)
    assert [p["display_name"] for p in (await flow.get("/api/membership/profiles")).json()] == ["Paula Beispiel"]
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 0, "zweiter Lauf ändert nichts"

    # Der Vorstand ergänzt Bio, Foto und Anzeigename - der nächste Abgleich lässt das stehen.
    await flow.db.club_member_profiles.update_one({"id": profile["id"]}, {"$set": {"bio": "Spielt TFT.", "photo_url": "/api/static/uploads/paula.png", "display_name": "Paula B."}})
    fake.members[12]["lastname"] = "Beispiel-Neu"
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 0
    profile = await profile_of(flow, paula)
    assert profile["bio"] == "Spielt TFT." and profile["display_name"] == "Paula B." and profile["photo_url"].endswith("paula.png")
    assert profile["real_name"] == "Paula Beispiel-Neu", "der Klarname folgt der Mitgliederverwaltung"

    # Widerruf in Dolibarr: offline mit Grund; wieder gegeben: wieder online, die Pflege bleibt.
    fake.member_consents[12]["verzeichnis"]["state"] = "withdrawn"
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 1
    profile = await profile_of(flow, paula)
    assert profile["is_active"] is False and profile["deactivated_reason"] == "consent_withdrawn"
    assert (await flow.get("/api/membership/profiles")).json() == []
    fake.member_consents[12]["verzeichnis"]["state"] = "given"
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 1
    profile = await profile_of(flow, paula)
    assert profile["is_active"] is True and profile["bio"] == "Spielt TFT." and profile["deactivated_reason"] is None

    # Vom Vorstand gesperrt: die Einwilligung schaltet nichts frei.
    await flow.db.club_member_profiles.update_one({"id": profile["id"]}, {"$set": {"is_active": False, "directory_blocked": True}})
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 0
    assert (await profile_of(flow, paula))["is_active"] is False

    # Ein vom Mitglied selbst angelegter Eintrag geht bei Widerruf ebenfalls offline; ohne Einwilligung bleibt er, wie er ist.
    max_ = await linked_member(flow, fake, "max", 13, firstname="Max", lastname="Muster")
    await flow.db.club_member_profiles.insert_one({"id": "cp-max", "user_id": max_["id"], "slug": "max", "display_name": "Max", "gamertag": "max", "is_active": True, "source": "member"})
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 0
    assert (await profile_of(flow, max_))["is_active"] is True
    fake.member_consents[13] = {"verzeichnis": {"state": "withdrawn", "version": 1, "moment": "2026-09-25T10:00:00+00:00"}}
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 1
    assert (await profile_of(flow, max_))["deactivated_reason"] == "consent_withdrawn"

    # Der Admin sieht Herkunft, Einwilligung und Grund.
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    rows = {row["user_id"]: row for row in (await flow.get("/api/membership/profiles/admin/all")).json()}
    assert rows[paula["id"]]["source"] == "dolibarr" and rows[paula["id"]]["consent"]["state"] == "given"
    assert rows[max_["id"]]["deactivated_reason"] == "consent_withdrawn"


@pytest.mark.asyncio
async def test_consent_texts_and_the_code_are_set_in_the_admin(flow, fake):
    await connect(flow)
    fake.consent_texts.append({"code": "verzeichnis", "label": "Nennung im Mitgliederverzeichnis", "version": 1, "text": "…"})
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    texts = (await flow.get("/api/admin/dolibarr/consent-texts")).json()
    assert [t["code"] for t in texts] == ["fotos", "verzeichnis"]
    assert (await flow.put("/api/admin/dolibarr/settings", json={"directory_consent_code": "kein code"})).status_code == 400
    assert (await flow.put("/api/admin/dolibarr/settings", json={"directory_consent_code": "verzeichnis"})).status_code == 200
    assert (await flow.get("/api/admin/dolibarr/status")).json()["directory_consent_code"] == "verzeichnis"
    assert (await flow.put("/api/admin/dolibarr/settings", json={"directory_consent_code": ""})).status_code == 200
    assert (await flow.get("/api/admin/dolibarr/status")).json()["directory_consent_code"] == ""
    player = await flow.add_user(role="player", name="spieler")
    flow.act_as(player)
    assert (await flow.get("/api/admin/dolibarr/consent-texts")).status_code == 403
