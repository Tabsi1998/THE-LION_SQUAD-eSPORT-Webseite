"""Mitgliederverzeichnis aus der Dolibarr-Einwilligung (#410 Nachtrag): stimmt ein Mitglied in Dolibarr der Nennung
zu, legt der Abgleich den Eintrag an (Name aus der Mitgliederverwaltung); was der Vorstand ergänzt, bleibt beim
nächsten Abgleich stehen; ein Widerruf nimmt den Eintrag offline - auch einen vom Mitglied selbst angelegten."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import hashlib

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

    # Der Vorstand setzt den Klarnamen selbst (nur Vorname): der Abgleich lässt ihn stehen; leer heißt wieder aus Dolibarr.
    await flow.db.club_member_profiles.update_one({"id": profile["id"]}, {"$set": {"real_name": "Paula"}})
    fake.members[12]["lastname"] = "Beispiel"
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 0
    profile = await profile_of(flow, paula)
    assert profile["real_name"] == "Paula" and profile["dolibarr_name"] == "Paula Beispiel"
    await flow.db.club_member_profiles.update_one({"id": profile["id"]}, {"$set": {"real_name": None}})
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 0
    assert (await profile_of(flow, paula))["real_name"] == "Paula Beispiel"

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
    features = {row["key"]: row for row in (await flow.get("/api/admin/dolibarr/status")).json()["features"]}
    assert features["directory"]["enabled"] is True and features["directory"]["state"] == "Einwilligung „verzeichnis“ · 1 Einträge aus Dolibarr"
    assert features["directory"]["where"] == "/admin/dolibarr?tab=connection"


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


PNG = b"%PNG-fake-" + bytes(range(32))


@pytest.mark.asyncio
async def test_profile_fields_and_photo_come_from_dolibarr_when_the_club_keeps_them(flow, fake, monkeypatch, tmp_path):
    """Website-Profil aus Dolibarr (#255): was der Verein dort pflegt, führt - Gamertag, Kurztext, Spiele, Plattformen
    und das Foto der Mitgliedskarte; was dort leer ist, bleibt Sache der Website. Ohne eigenen Code nimmt das
    Verzeichnis die Einwilligung, die das Modul dafür nennt."""
    monkeypatch.setattr(dolibarr_sync, "UPLOAD_DIR", tmp_path)
    await connect(flow)
    fake.consent_texts.append({"code": "profil", "label": "Nennung auf der Website", "version": 1, "text": "…"})
    fake.website_profile_consent = "profil"   # im Modul gewählt; auf der Website kein eigener Code
    fake.member_profiles[12] = {"gamertag": "LionKing", "bio": "Spielt TFT für den Verein.", "games": ["TFT", "Rocket League"], "platforms": ["PC"],
                                "photo": PNG, "photo_type": "image/png", "photo_name": "paula.png"}
    fake.member_consents[12] = {"profil": {"state": "given", "version": 1, "moment": "2026-09-25T09:00:00+00:00"}}
    paula = await linked_member(flow, fake, "paula", 12)

    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 1
    profile = await profile_of(flow, paula)
    assert profile["gamertag"] == "LionKing" and profile["bio"] == "Spielt TFT für den Verein." and profile["games"] == ["TFT", "Rocket League"] and profile["platforms"] == ["PC"]
    assert profile["photo_url"].startswith("/api/static/uploads/member-photo-") and profile["dolibarr_photo_sha"] == hashlib.sha256(PNG).hexdigest()
    stored = tmp_path / profile["photo_url"].rsplit("/", 1)[-1]
    assert stored.read_bytes() == PNG and stored.suffix == ".png"
    assert (await dolibarr_sync.sync_state(flow.db))["website_profile_consent"] == "profil"
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    features = {row["key"]: row for row in (await flow.get("/api/admin/dolibarr/status")).json()["features"]}
    assert features["directory"]["state"] == "Einwilligung „profil“ (aus dem Modul) · 1 Einträge aus Dolibarr"
    flow.act_as(paula)

    # Zweiter Lauf: nichts neu, das Foto wird nicht noch einmal geholt.
    photo_calls = len([call for call in fake.calls if call[0].endswith("/photo")])
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 0
    assert len([call for call in fake.calls if call[0].endswith("/photo")]) == photo_calls

    # Leer in Dolibarr: die Website behält ihren Stand. Gefüllt in Dolibarr: Dolibarr führt, auch über eine Änderung des Vorstands hinweg.
    fake.member_profiles[12]["bio"] = ""
    await flow.db.club_member_profiles.update_one({"id": profile["id"]}, {"$set": {"bio": "Von der Website gepflegt."}})
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 0
    assert (await profile_of(flow, paula))["bio"] == "Von der Website gepflegt."
    fake.member_profiles[12]["bio"] = "Neu aus Dolibarr."
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 1
    assert (await profile_of(flow, paula))["bio"] == "Neu aus Dolibarr."

    # Ein neues Foto auf der Mitgliedskarte: neue Datei, neue Adresse; ohne Foto in Dolibarr bleibt das alte stehen.
    fake.member_profiles[12]["photo"] = PNG + b"-neu"
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 1
    profile = await profile_of(flow, paula)
    assert profile["dolibarr_photo_sha"] == hashlib.sha256(PNG + b"-neu").hexdigest() and (tmp_path / profile["photo_url"].rsplit("/", 1)[-1]).read_bytes() == PNG + b"-neu"
    fake.member_profiles[12]["photo"] = None
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 0
    assert (await profile_of(flow, paula))["photo_url"] == profile["photo_url"]

    # Widerruf: der Eintrag geht offline, das Modul gibt das Profil nicht mehr heraus.
    fake.member_consents[12]["profil"]["state"] = "withdrawn"
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 1
    assert (await profile_of(flow, paula))["is_active"] is False
    admin = await flow.add_user(role="superadmin", name="admin2")
    flow.act_as(admin)
    row = next(r for r in (await flow.get("/api/membership/profiles/admin/all")).json() if r["user_id"] == paula["id"])
    assert row["dolibarr_profile_at"], "der Admin sieht, dass das Profil aus Dolibarr kam"
