"""Konto löschen (#928): nach ``anonymize-me`` steht in keiner Sammlung mehr eine Kopie von Name, Adresse oder Text -
und die eigenen Bilder sind von der Platte. Was dem Verein gehört (Teamlogo, Eintrag aus der Mitgliederverwaltung,
Vorstandsposten) bleibt und verliert nur die Verknüpfung."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import account_erasure, migrations  # noqa: E402

UPLOADS = "/api/static/uploads/"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def folders(tmp_path, monkeypatch):
    public, quarantine = tmp_path / "public", tmp_path / "quarantine"
    (public / "variants").mkdir(parents=True)
    quarantine.mkdir()
    monkeypatch.setattr(account_erasure, "PUBLIC_UPLOAD_DIR", public)
    monkeypatch.setattr(account_erasure, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(account_erasure, "QUARANTINE_DIR", quarantine)
    return public, quarantine


async def fill(flow, user: dict, public: pathlib.Path, quarantine: pathlib.Path) -> None:
    """Je Sammlung aus #928 mindestens eine Zeile dieser Person - so, wie die Routen sie schreiben."""
    db, uid = flow.db, user["id"]
    for name in ("avatar.webp", "alt.webp", "teamlogo.webp", "news.webp"):
        (public / name).write_bytes(b"bild")
    (public / "variants" / "avatar-400.webp").write_bytes(b"klein")
    (quarantine / "scan-1.webp").write_bytes(b"gehalten")
    await db.users.update_one({"id": uid}, {"$set": {"avatar_url": UPLOADS + "avatar.webp", "privacy_public_profile": True}})
    for name, scope in (("avatar.webp", "user"), ("alt.webp", "user"), ("teamlogo.webp", "user"), ("gehalten.webp", "user"), ("news.webp", "admin")):
        await db.media_uploads.insert_one({"id": f"up-{name}", "filename": name, "url": UPLOADS + name, "owner_id": uid, "media_scope": scope})
    await db.media_scans.insert_one({"id": "scan-1", "kind": "upload", "owner_id": uid, "url": UPLOADS + "gehalten.webp",
                                     "quarantine_key": "scan-1.webp", "state": "removed"})
    await db.teams.insert_one({"id": "team-1", "name": "Löwen", "logo_url": UPLOADS + "teamlogo.webp", "member_ids": [uid]})
    await db.club_member_profiles.insert_one({"id": "selbst", "user_id": uid, "source": "member", "display_name": "Paula", "gamertag": "paula",
                                              "bio": "Rocket League seit 2019", "photo_url": UPLOADS + "avatar.webp", "is_active": True})
    await db.club_member_profiles.insert_one({"id": "akte", "user_id": uid, "source": "dolibarr", "display_name": "Paula P.", "is_active": True})
    await db.board_positions.insert_one({"id": "kassier", "slug": "kassier", "title_male": "Kassier", "user_id": uid, "deputy_user_id": None})
    await db.board_positions.insert_one({"id": "obmann", "slug": "obmann", "title_male": "Obmann", "user_id": "anderer", "deputy_user_id": uid})
    await db.membership_applications.insert_one({"id": "antrag-alt", "user_id": uid, "status": "approved", "motivation": "Ich will dabei sein, weil …",
                                                 "notes": "bitte per Mail", "decision_note": "kennt den Obmann"})
    await db.membership_applications.insert_one({"id": "antrag-neu", "user_id": uid, "status": "submitting", "source": "dolibarr", "external_id": "ext-1",
                                                 "motivation": "noch einmal", "person": {"firstname": "Paula", "lastname": "Probe", "email": user["email"]},
                                                 "fields": {"gamertag": "paula"}, "consents": [{"code": "verzeichnis"}]})
    await db.event_registrations.insert_one({"id": "ev-reg", "event_id": "ev-1", "user_id": uid, "display_name": "paula", "email": user["email"],
                                             "note": "komme später", "status": "registered", "seat_count": 2})
    await db.tournament_registrations.insert_one({"id": "solo", "tournament_id": "t-1", "user_id": uid, "registration_type": "solo", "display_name": "paula",
                                                  "ingame_name": "paula_rl", "discord": "paula#1", "platform_id": "steam-123", "notes": "nur abends",
                                                  "status": "approved"})
    await db.tournament_registrations.insert_one({"id": "team", "tournament_id": "t-2", "user_id": uid, "registration_type": "team", "team_id": "team-1",
                                                  "display_name": "[LW] Löwen", "ingame_name": "paula_rl", "discord": "paula#1", "notes": "", "status": "approved"})
    await db.f1_lap_times.insert_one({"id": "lap", "user_id": uid, "time_ms": 83456, "proof_url": "https://clips.example.test/paula", "admin_note": "Paula vor Ort"})
    await db.prize_pickups.insert_one({"id": "preis", "user_id": uid, "tournament_id": "t-1", "place": 1, "status": "picked_up", "notes": "an Paula übergeben"})
    await db.moderation_items.insert_one({"id": "mod", "kind": "team_chat", "user_id": uid, "excerpt": "ein gehaltener Satz", "state": "pending"})
    await db.access_links.insert_one({"id": "link-konto", "user_id": uid, "email": None, "note": "für Paula", "is_active": True})
    await db.access_links.insert_one({"id": "link-mail", "user_id": None, "email": user["email"], "note": None, "is_active": True})
    await db.access_links.insert_one({"id": "link-fremd", "user_id": "anderer", "email": "gast@example.test", "is_active": True})
    await db.user_xp.insert_one({"user_id": uid, "total": 120, "level": 3, "prestige": 0})
    await db.user_xp.insert_one({"user_id": "anderer", "total": 40, "level": 1, "prestige": 0})
    for name in account_erasure.PURGED:
        if name != "user_xp":
            await getattr(db, name).insert_one({"id": f"{name}-1", "user_id": uid, "note": "nur mit Konto sinnvoll"})


@pytest.mark.asyncio
async def test_the_export_names_everything_and_deleting_leaves_no_personal_copy(flow, folders):
    public, quarantine = folders
    paula = await flow.add_user(role="player", name="paula")
    uid = paula["id"]
    await fill(flow, paula, public, quarantine)
    flow.act_as(paula)

    export = (await flow.get("/api/dsgvo/export-my-data")).json()
    assert export["format_version"] == 3
    assert export["xp"]["total"] == 120 and len(export["xp_events"]) == 1
    assert {row["id"] for row in export["directory_profiles"]} == {"selbst", "akte"}
    assert {row["id"] for row in export["membership_applications"]} == {"antrag-alt", "antrag-neu"}
    assert {row["id"] for row in export["board_positions"]} == {"kassier", "obmann"}
    assert len(export["uploads"]) == 5 and len(export["membership_invitations"]) == 1 and len(export["tournament_staff"]) == 1
    assert [row["excerpt"] for row in export["moderation_items"]] == ["ein gehaltener Satz"]

    assert (await flow.post("/api/dsgvo/anonymize-me")).status_code == 200
    db = flow.db

    # Gelöscht: nur mit Konto sinnvoll.
    for name in account_erasure.PURGED:
        assert await getattr(db, name).count_documents({"user_id": uid}) == 0, name
    assert await db.user_xp.count_documents({}) == 1, "die XP der anderen bleiben"

    # Verzeichnis: der eigene Eintrag ist weg, der aus der Mitgliederverwaltung gehört dem Verein - ohne Konto.
    assert await db.club_member_profiles.find_one({"id": "selbst"}) is None
    assert (await db.club_member_profiles.find_one({"id": "akte"}))["user_id"] is None
    assert (await db.board_positions.find_one({"id": "kassier"}))["user_id"] is None
    obmann = await db.board_positions.find_one({"id": "obmann"})
    assert obmann["user_id"] == "anderer" and obmann["deputy_user_id"] is None

    # Anträge: ohne Text und Person; der laufende gilt als zurückgezogen, der entschiedene behält seinen Stand.
    old, new = await db.membership_applications.find_one({"id": "antrag-alt"}), await db.membership_applications.find_one({"id": "antrag-neu"})
    assert old["status"] == "approved" and old["motivation"] is None and old["notes"] is None and old["decision_note"] is None
    assert new["status"] == "withdrawn" and new["motivation"] is None and not {"person", "fields", "consents"} & set(new)

    # Anmeldungen bleiben als Zählung - ohne Kopien.
    event = await db.event_registrations.find_one({"id": "ev-reg"})
    assert (event["display_name"], event["email"], event["note"], event["seat_count"]) == ("Gelöschter User", None, None, 2)
    solo, team = await db.tournament_registrations.find_one({"id": "solo"}), await db.tournament_registrations.find_one({"id": "team"})
    assert (solo["display_name"], solo["ingame_name"], solo["discord"], solo["platform_id"], solo["notes"]) == ("Gelöschter User", None, None, None, None)
    assert team["display_name"] == "[LW] Löwen" and team["ingame_name"] is None and team["discord"] is None, "das Team behält seinen Namen"

    # Ergebnisse und Nachweise bleiben, die Notizen nicht.
    lap, prize, held = await db.f1_lap_times.find_one({"id": "lap"}), await db.prize_pickups.find_one({"id": "preis"}), await db.moderation_items.find_one({"id": "mod"})
    assert lap["time_ms"] == 83456 and lap["proof_url"] is None and lap["admin_note"] is None
    assert prize["status"] == "picked_up" and prize["notes"] == ""
    assert held["excerpt"] == "[Nachricht gelöscht]" and held["state"] == "pending"

    # Zugangslinks dieser Person sind aus - über das Konto wie über die E-Mail-Adresse.
    for link_id in ("link-konto", "link-mail"):
        link = await db.access_links.find_one({"id": link_id})
        assert link["is_active"] is False and link["email"] is None and link["note"] is None
    assert (await db.access_links.find_one({"id": "link-fremd"}))["is_active"] is True

    # Bilder: Avatar samt kleiner Fassung, das alte Profilbild und die Kopie in der Quarantäne sind weg.
    assert not (public / "avatar.webp").exists() and not (public / "variants" / "avatar-400.webp").exists()
    assert not (public / "alt.webp").exists() and not (quarantine / "scan-1.webp").exists()
    assert await db.media_scans.count_documents({"owner_id": uid}) == 0
    # Das Teamlogo gehört dem Team, das News-Bild der Redaktion.
    assert (public / "teamlogo.webp").exists() and (public / "news.webp").exists()
    assert {row["filename"] async for row in db.media_uploads.find({"owner_id": uid}, {"_id": 0, "filename": 1})} == {"teamlogo.webp", "news.webp"}

    # Und im ganzen Bestand steht die alte E-Mail-Adresse nirgends mehr.
    for name in await db.list_collection_names():
        async for row in getattr(db, name).find({}, {"_id": 0}):
            assert paula["email"] not in str(row), f"{name} trägt noch die E-Mail-Adresse"


@pytest.mark.asyncio
async def test_an_admin_deletion_takes_the_same_way(flow, folders):
    public, quarantine = folders
    paula = await flow.add_user(role="player", name="paula")
    await fill(flow, paula, public, quarantine)
    chef = await flow.add_user(role="superadmin", name="chef")
    flow.act_as(chef)
    assert (await flow.post(f"/api/dsgvo/admin/anonymize/{paula['id']}")).status_code == 200
    assert await flow.db.user_xp.count_documents({"user_id": paula["id"]}) == 0
    assert await flow.db.club_member_profiles.find_one({"id": "selbst"}) is None
    assert not (public / "avatar.webp").exists()


@pytest.mark.asyncio
async def test_accounts_deleted_before_this_fix_are_cleaned_once(flow, folders):
    """Der Nachzug (Migration 4): wer sein Konto früher gelöscht hat, hat dieselben Reste - sie gehen auf demselben Weg."""
    public, quarantine = folders
    paula = await flow.add_user(role="player", name="paula")
    bleibt = await flow.add_user(role="player", name="bleibt")
    await fill(flow, paula, public, quarantine)
    await flow.db.user_xp.insert_one({"user_id": bleibt["id"], "total": 7, "level": 1, "prestige": 0})
    await flow.db.event_registrations.insert_one({"id": "ev-bleibt", "event_id": "ev-1", "user_id": bleibt["id"], "display_name": "bleibt", "status": "registered"})
    # So sah ein gelöschtes Konto vor dem Fix aus: überschrieben, aber mit allem drumherum.
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {
        "email": "deleted_x@deleted.invalid", "display_name": "Gelöschter User", "avatar_url": None, "anonymized_at": "2026-09-30T10:00:00+00:00",
    }})

    result = await migrations.migrate_deleted_account_leftovers(flow.db)
    assert result == "1 deleted accounts cleaned, 3 images removed"
    assert await flow.db.user_xp.count_documents({"user_id": paula["id"]}) == 0
    assert await flow.db.club_member_profiles.find_one({"id": "selbst"}) is None
    assert (await flow.db.event_registrations.find_one({"id": "ev-reg"}))["display_name"] == "Gelöschter User"
    assert not (public / "avatar.webp").exists() and (public / "teamlogo.webp").exists()
    # Wer sein Konto hat, behält alles.
    assert (await flow.db.user_xp.find_one({"user_id": bleibt["id"]}))["total"] == 7
    assert (await flow.db.event_registrations.find_one({"id": "ev-bleibt"}))["display_name"] == "bleibt"
    assert [row[0] for row in migrations.MIGRATIONS] == [1, 2, 3, 4]
