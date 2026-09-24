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


async def manual_profile(flow, **fields):
    """Ein vom Vorstand angelegtes Profil - so wie die Karten, die vor dem Abgleich schon da waren."""
    doc = {"id": f"p-{fields.get('slug', 'x')}", "display_name": "KillerKetchup_2000", "gamertag": "KillerKetchup_2000", "real_name": "Paula Beispiel",
           "slug": "killerketchup_2000", "photo_url": "/api/static/uploads/paula.png", "bio": "Farmt seit 2019.", "games": ["LS22"], "platforms": ["PC"],
           "user_id": None, "order_index": 0, "is_active": True, "source": "editorial", "created_at": "2026-01-01T00:00:00+00:00", "created_by": "admin",
           "updated_at": "2026-01-01T00:00:00+00:00", "updated_by": "admin"}
    doc.update(fields)
    await flow.db.club_member_profiles.insert_one(doc)
    return doc


@pytest.mark.asyncio
async def test_sync_matches_the_manual_profile_by_name_instead_of_creating_a_second(flow, fake):
    """#504: Paula steht schon von Hand im Verzeichnis (anderer Gamertag, kein Konto). Der Abgleich findet sie
    über den Klarnamen, hängt Mitgliedsnummer, Konto und Einwilligung an und legt keine zweite Karte an."""
    await connect(flow)
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {"directory_consent_code": "verzeichnis"}})
    fake.consent_texts.append({"code": "verzeichnis", "label": "Nennung", "version": 1, "text": "…"})
    manual = await manual_profile(flow, slug="killerketchup_2000")
    paula = await linked_member(flow, fake, "paula", 12)
    fake.member_consents[12] = {"verzeichnis": {"state": "given", "version": 1, "moment": "2026-09-25T09:00:00+00:00"}}

    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 1
    rows = await flow.db.club_member_profiles.find({}, {"_id": 0}).to_list(10)
    assert [r["id"] for r in rows] == [manual["id"]], "keine zweite Karte"
    row = rows[0]
    assert row["dolibarr_member_id"] == 12 and row["user_id"] == paula["id"] and row["consent"]["state"] == "given"
    assert row["photo_url"] == "/api/static/uploads/paula.png" and row["gamertag"] == "KillerKetchup_2000" and row["bio"] == "Farmt seit 2019."
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 0, "zweiter Lauf: über die Mitgliedsnummer gefunden"
    flow.act_as(None)
    listing = (await flow.get("/api/membership/profiles")).json()
    assert [p["gamertag"] for p in listing] == ["KillerKetchup_2000"]
    flow.act_as(await flow.add_user(role="club_admin", name="vorstand"))
    admin_rows = (await flow.get("/api/membership/profiles/admin/all")).json()
    assert admin_rows[0]["dolibarr_member_id"] == 12


@pytest.mark.asyncio
async def test_an_automatic_duplicate_is_merged_into_the_manual_profile(flow, fake):
    """#504: Vor dem Fix hat der Abgleich eine zweite Karte angelegt. Beim nächsten Lauf geht sie in der
    gepflegten Karte auf: Einwilligung und Nummer ziehen um, Foto/Bio bleiben, das Doppel verschwindet,
    Verweise (Vorstand, Referenzen) hängen um."""
    await connect(flow)
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {"directory_consent_code": "verzeichnis"}})
    fake.consent_texts.append({"code": "verzeichnis", "label": "Nennung", "version": 1, "text": "…"})
    manual = await manual_profile(flow, slug="killerketchup_2000")
    paula = await linked_member(flow, fake, "paula", 12)
    fake.member_consents[12] = {"verzeichnis": {"state": "given", "version": 1, "moment": "2026-09-25T09:00:00+00:00"}}
    auto = await manual_profile(flow, id="p-auto", slug="paula", display_name="Paula Beispiel", gamertag="paula", photo_url=None, bio="", games=[],
                                user_id=paula["id"], source="dolibarr", created_by="dolibarr", updated_by="dolibarr",
                                consent={"code": "verzeichnis", "state": "given", "version": 1, "moment": "2026-09-18T09:00:00+00:00"}, dolibarr_name="Paula Beispiel")
    await flow.db.board_positions.insert_one({"id": "pos-1", "user_id": auto["id"], "title": "Kassier", "is_active": True, "order_index": 1})
    await flow.db.references.insert_one({"id": "ref-1", "title": "Cup", "member_profile_ids": [auto["id"]], "is_active": True})

    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 1
    rows = await flow.db.club_member_profiles.find({}, {"_id": 0}).to_list(10)
    assert [r["id"] for r in rows] == [manual["id"]], "das Doppel ist weg"
    row = rows[0]
    assert row["dolibarr_member_id"] == 12 and row["user_id"] == paula["id"] and row["consent"]["state"] == "given"
    assert row["photo_url"] == "/api/static/uploads/paula.png" and row["bio"] == "Farmt seit 2019." and row["games"] == ["LS22"]
    assert (await flow.db.board_positions.find_one({"id": "pos-1"}))["user_id"] == manual["id"]
    assert (await flow.db.references.find_one({"id": "ref-1"}))["member_profile_ids"] == [manual["id"]]
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 0


@pytest.mark.asyncio
async def test_a_member_without_website_account_gets_a_profile(flow, fake):
    """#505: Die Einwilligung allein zählt - auch ohne zugeordnetes Konto entsteht die Karte aus der
    Vereinsakte (Name, Gamertag vom Website-Profil des Moduls); öffentlich sichtbar, ohne Konto-Link. Der
    Webhook-Weg (Nachlesen eines Mitglieds) macht dasselbe."""
    await connect(flow)
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {"directory_consent_code": "verzeichnis"}})
    fake.consent_texts.append({"code": "verzeichnis", "label": "Nennung", "version": 1, "text": "…"})
    fake.add(member(13, firstname="Max", lastname="Muster"))
    fake.member_consents[13] = {"verzeichnis": {"state": "given", "version": 1, "moment": "2026-09-25T09:00:00+00:00"}}
    fake.member_profiles[13] = {"gamertag": "MaxPower", "bio": "Fährt F1.", "games": ["F1 25"], "platforms": ["PC"]}
    fake.website_profile_consent = "verzeichnis"

    result = await dolibarr_sync.run_sync(flow.db, full=True)
    assert result["directory"] == 1 and result["unlinked"] == 1
    row = await flow.db.club_member_profiles.find_one({"dolibarr_member_id": 13}, {"_id": 0})
    assert row["user_id"] is None and row["display_name"] == "Max Muster" and row["gamertag"] == "MaxPower" and row["bio"] == "Fährt F1." and row["slug"] == "maxpower"
    flow.act_as(None)
    listing = (await flow.get("/api/membership/profiles")).json()
    assert [(p["gamertag"], p.get("linked_account")) for p in listing] == [("MaxPower", None)]
    assert (await flow.get("/api/membership/profiles/maxpower")).status_code == 200

    # Webhook-Weg: ein weiteres Mitglied ohne Konto kommt über das Nachlesen.
    fake.add(member(14, firstname="Mia", lastname="Muster"))
    fake.member_consents[14] = {"verzeichnis": {"state": "given", "version": 1, "moment": "2026-09-25T09:00:00+00:00"}}
    settings = await dolibarr_client.load_settings(flow.db)
    monkeypatch_delay = dolibarr_sync.PENDING_DELAY_SECONDS
    dolibarr_sync.PENDING_DELAY_SECONDS = 0
    try:
        await dolibarr_sync.queue_member(flow.db, settings, 14)
        assert (await dolibarr_sync.process_pending(flow.db))["processed"] == 1
    finally:
        dolibarr_sync.PENDING_DELAY_SECONDS = monkeypatch_delay
    assert (await flow.db.club_member_profiles.find_one({"dolibarr_member_id": 14}, {"_id": 0}))["display_name"] == "Mia Muster"

    # Widerruf nimmt die Karte ohne Konto genauso offline.
    fake.member_consents[13]["verzeichnis"]["state"] = "withdrawn"
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 1
    assert (await flow.db.club_member_profiles.find_one({"dolibarr_member_id": 13}, {"_id": 0}))["is_active"] is False
