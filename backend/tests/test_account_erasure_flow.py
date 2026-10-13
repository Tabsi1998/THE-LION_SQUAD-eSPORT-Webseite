"""Konto löschen (#928): nach ``anonymize-me`` steht in keiner Sammlung mehr eine Kopie von Name, Adresse oder Text -
und die eigenen Bilder sind von der Platte. Was dem Verein gehört (Teamlogo, Eintrag aus der Mitgliederverwaltung,
Vorstandsposten) bleibt und verliert nur die Verknüpfung."""
import pathlib
import re
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import account_erasure, migrations, personal_data  # noqa: E402

UPLOADS = "/api/static/uploads/"
INTERNAL = re.compile(r"hash|secret|token$|^token|storage_key|poster_key|join_code|public_key|credential|member_key|user_handle", re.I)


def _keys(value):
    """Alle Feldnamen in einer verschachtelten Auskunft."""
    if isinstance(value, dict):
        for key, inner in value.items():
            yield key
            yield from _keys(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from _keys(inner)


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
    # Einlass bei der Generalversammlung (#845): Paula wurde eingelassen - und hat als Vorstand selbst jemanden eingelassen.
    await db.meeting_admissions.insert_one({"meeting_id": 7, "member_id": 11, "round": 0, "name": "Paula P.", "user_id": uid, "state": "present", "voting": True,
                                            "reason": "own", "arrived": "18:55", "by": "vorstand", "by_name": "Vera V.", "updated_at": "2026-03-14T17:55:00+00:00"})
    await db.meeting_admissions.insert_one({"meeting_id": 7, "member_id": 12, "round": 0, "name": "Otto O.", "user_id": "anderer", "state": "present", "voting": True,
                                            "reason": "own", "arrived": "18:57", "by": uid, "by_name": "paula", "updated_at": "2026-03-14T17:57:00+00:00"})
    await db.user_xp.insert_one({"user_id": uid, "total": 120, "level": 3, "prestige": 0})
    await db.user_xp.insert_one({"user_id": "anderer", "total": 40, "level": 1, "prestige": 0})
    for name in account_erasure.PURGED:
        if name != "user_xp":
            await getattr(db, name).insert_one({"id": f"{name}-1", "user_id": uid, "note": "nur mit Konto sinnvoll"})
    await fill_contract(flow, user)


async def fill_contract(flow, user: dict) -> None:
    """#1029/#1030: Kopien von Name und Adresse außerhalb des Kontos, interne Felder und Daten Dritter."""
    db, uid = flow.db, user["id"]
    await db.contact_messages.insert_one({"id": "kontakt-konto", "user_id": uid, "name": "Paula P.", "email": user["email"], "subject": "Frage",
                                          "message": "Ich heiße Paula und habe eine Frage", "status": "new"})
    await db.contact_messages.insert_one({"id": "kontakt-mail", "user_id": None, "name": "Paula P.", "email": user["email"], "subject": "Noch eine",
                                          "message": "ohne Anmeldung geschrieben", "status": "answered"})
    await db.contact_messages.insert_one({"id": "kontakt-fremd", "user_id": None, "name": "Gast", "email": "gast@example.test", "subject": "Hallo",
                                          "message": "bleibt", "status": "new"})
    await db.mail_jobs.insert_one({"id": "mail-paula", "to": user["email"], "subject": "Erinnerung", "html": "<p>Hallo Paula P.</p>", "status": "failed"})
    await db.mail_jobs.insert_one({"id": "mail-gast", "to": "gast@example.test", "subject": "Erinnerung", "html": "<p>Hallo</p>", "status": "pending"})
    await db.news_posts.insert_one({"id": "news-1", "title": "Saisonstart", "author_id": uid, "author_name": "Paula P.", "published": True})
    await db.achievement_events.insert_one({"id": "erfolg-fuer", "kind": "grant", "user_id": uid, "username": "paula", "user_name": "Paula P.",
                                            "actor_id": "vorstand", "actor_name": "Vera V.", "tier_code": "helfer-1", "note": "danke"})
    await db.achievement_events.insert_one({"id": "erfolg-von", "kind": "grant", "user_id": "anderer", "username": "otto", "user_name": "Otto O.",
                                            "actor_id": uid, "actor_name": "Paula P.", "tier_code": "helfer-1"})
    await db.audit_logs.insert_one({"id": "audit-selbst", "action": "club_member_profile.self_create", "actor_id": uid, "target_id": "selbst",
                                    "data": {"display_name": "Paula P."}, "created_at": "2026-05-01T10:00:00+00:00"})
    await db.audit_logs.insert_one({"id": "audit-ueber", "action": "membership.update", "actor_id": "vorstand", "target_id": uid,
                                    "data": {"first_name": "Paula", "last_name": "Probe", "notes": "zahlt bar"}, "created_at": "2026-05-02T10:00:00+00:00"})
    await db.audit_logs.insert_one({"id": "audit-andere", "action": "club_member_profile.create", "actor_id": uid, "target_id": "profil-otto",
                                    "data": {"display_name": "Otto O.", "user_id": "anderer"}, "created_at": "2026-05-03T10:00:00+00:00"})
    # Daten Dritter: wer Paula blockiert oder gemeldet hat, gehört nicht in ihre Auskunft.
    await db.user_blocks.insert_one({"id": "block-eigen", "blocker_id": uid, "blocked_id": "anderer", "created_at": "2026-05-04T10:00:00+00:00"})
    await db.user_blocks.insert_one({"id": "block-fremd", "blocker_id": "heimlich", "blocked_id": uid, "created_at": "2026-05-04T11:00:00+00:00"})
    await db.user_reports.insert_one({"id": "meldung-eigen", "reporter_id": uid, "target_user_id": "anderer", "category": "spam", "details": "schickt Links",
                                      "status": "open", "created_at": "2026-05-05T10:00:00+00:00"})
    await db.user_reports.insert_one({"id": "meldung-fremd", "reporter_id": "heimlich", "target_user_id": uid, "category": "insult",
                                      "details": "hat mich beleidigt", "reviewed_by": "moderatorin", "status": "resolved",
                                      "created_at": "2026-05-05T11:00:00+00:00"})
    await db.moderation_strikes.insert_one({"id": "strike-1", "user_id": uid, "kind": "chat", "moderator_id": "moderatorin", "note": "Beleidigung"})
    await db.moderation_sanctions.insert_one({"id": "sanktion-1", "user_id": uid, "action": "chat_block", "status": "active", "reason": "Beleidigung"})
    await db.team_chat_messages.insert_one({"id": "teamchat-1", "team_id": "team-1", "user_id": uid, "message": "bin dabei"})
    await db.team_chat_messages.insert_one({"id": "teamchat-2", "team_id": "team-1", "user_id": "anderer", "message": "Otto schreibt"})
    # Interne Werte: Prüfwerte, Schlüssel, Speicherorte und Codes gehören nicht in die Auskunft.
    await db.teams.update_one({"id": "team-1"}, {"$set": {"join_code": "JOIN-GEHEIM"}})
    await db.auth_sessions.insert_one({"id": "sitzung-1", "user_id": uid, "family_id": "GEHEIM-FAMILIE", "current_jti": "GEHEIM-JTI", "ip": "203.0.113.7",
                                       "user_agent": "Firefox", "revoked": False})
    await db.mobile_push_tokens.insert_one({"id": "geraet-1", "user_id": uid, "token": "ExponentPushToken[GEHEIM]", "platform": "android", "enabled": True})
    await db.passkeys.insert_one({"id": "passkey-1", "user_id": uid, "name": "Laptop", "public_key": "GEHEIM-SCHLUESSEL", "credential_ids": ["GEHEIM-ID"],
                                  "user_handle": "GEHEIM-HANDLE", "sign_count": 3, "created_at": "2026-05-06T10:00:00+00:00"})
    await db.access_links.update_one({"id": "link-konto"}, {"$set": {"token_hash": "GEHEIM-HASH", "title": "Turnierleitung"}})
    await db.chat_attachments.insert_one({"id": "anhang-1", "owner_id": uid, "kind": "image", "mime": "image/webp", "storage_key": "GEHEIM-ORT.webp",
                                          "poster_key": "GEHEIM-POSTER.webp", "status": "attached"})
    await db.match_proof_photos.insert_one({"id": "beweis-1", "owner_id": uid, "match_id": "m-1", "storage_key": "GEHEIM-BEWEIS.webp", "status": "attached"})
    await db.dolibarr_links.insert_one({"id": "akte-link", "user_id": uid, "instance": "verein", "status": "verified", "member_ref": "M-7",
                                        "member_key": "GEHEIM-SCHLUESSEL-AKTE"})


@pytest.mark.asyncio
async def test_the_export_names_everything_and_deleting_leaves_no_personal_copy(flow, folders):
    public, quarantine = folders
    paula = await flow.add_user(role="player", name="paula")
    uid = paula["id"]
    await fill(flow, paula, public, quarantine)
    flow.act_as(paula)

    export = (await flow.get("/api/dsgvo/export-my-data")).json()
    assert export["format_version"] == 5
    # Vollständig (#1030): jede Sammlung aus services/personal_data.py, die in die Auskunft gehört, steht drin - und nichts sonst.
    assert set(export) == {"format_version", "exported_at"} | {key for entry in personal_data.PERSONAL.values() for key in entry.export}
    # Keine internen Werte: Prüfwerte, Schlüssel, Speicherorte, Codes.
    assert "GEHEIM" not in str(export), "interne Felder in der Auskunft"
    assert not [key for key in _keys(export) if INTERNAL.search(key)], "Feldnamen interner Werte in der Auskunft"
    assert [row["name"] for row in export["passkeys"]] == ["Laptop"] and export["mobile_devices"][0]["platform"] == "android"
    assert [(row["ip"], row["user_agent"]) for row in export["sessions"]] == [("203.0.113.7", "Firefox")]
    # Keine Daten Dritter: wer Paula blockiert oder gemeldet hat, steht nicht drin; Meldungen über sie nur mit Art und Stand.
    assert "heimlich" not in str(export) and "beleidigt" not in str(export) and "moderatorin" not in str(export)
    assert [row["blocked_id"] for row in export["blocks"]] == ["anderer"]
    reports = {row["id"]: row for row in export["moderation_reports"]}
    assert reports["meldung-eigen"]["details"] == "schickt Links"
    assert reports["meldung-fremd"] == {"id": "meldung-fremd", "category": "insult", "status": "resolved", "created_at": "2026-05-05T11:00:00+00:00",
                                        "reviewed_at": None, "about_me": True}
    # Das Protokoll: was über Paula vermerkt wurde, mit Inhalt; was sie an anderen getan hat, nur als Vorgang.
    audit = {row["id"]: row for row in export["audit_trail"]}
    assert audit["audit-ueber"]["data"] == {"first_name": "Paula", "last_name": "Probe", "notes": "zahlt bar"}
    assert "data" not in audit["audit-andere"] and "target_id" not in audit["audit-andere"]
    assert [row["message"] for row in export["chat_messages"]] == ["bin dabei"]
    assert {row["id"] for row in export["contact_messages"]} == {"kontakt-konto", "kontakt-mail"}
    assert [row["tier_code"] for row in export["achievement_log"]] == ["helfer-1"]
    assert [row["id"] for row in export["moderation_strikes"]] == ["strike-1"] and len(export["moderation_sanctions"]) == 1
    # Einlass: die eigene Anwesenheit ohne den Namen der einlassenden Person; der selbst getätigte Einlass ohne den der anderen.
    assert export["meeting_admissions"] == [{"meeting_id": 7, "name": "Paula P.", "state": "present", "voting": True, "reason": "own", "arrived": "18:55",
                                             "updated_at": "2026-03-14T17:55:00+00:00"}]
    assert export["meeting_admissions_recorded"] == [{"meeting_id": 7, "state": "present", "updated_at": "2026-03-14T17:57:00+00:00"}]
    assert "Otto" not in str(export) and "Vera" not in str(export)
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

    # Einlass: die Anwesenheit bleibt beim Verein, ohne Konto; der selbst getätigte Einlass bleibt als Vorgang ohne Namen.
    own, recorded = await db.meeting_admissions.find_one({"member_id": 11}), await db.meeting_admissions.find_one({"member_id": 12})
    assert own["user_id"] is None and own["state"] == "present" and own["by"] == "vorstand"
    assert (recorded["by"], recorded["by_name"], recorded["user_id"], recorded["name"]) == (None, "Gelöschter User", "anderer", "Otto O.")

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

    # #1029: Kontaktanfragen bleiben als Vorgang, ohne Name, Adresse und Text; Mails in der Warteschlange gehen nicht mehr raus.
    for contact_id in ("kontakt-konto", "kontakt-mail"):
        contact = await db.contact_messages.find_one({"id": contact_id})
        assert (contact["name"], contact["email"], contact["user_id"], contact["message"]) == ("Gelöschter User", None, None, "[Nachricht gelöscht]")
    assert (await db.contact_messages.find_one({"id": "kontakt-fremd"}))["email"] == "gast@example.test"
    assert {row["id"] async for row in db.mail_jobs.find({}, {"_id": 0, "id": 1})} == {"mail-gast"}
    # Gespeicherte Namen: im News-Beitrag, im Protokoll der Erfolge und in den Daten des Adminprotokolls.
    assert (await db.news_posts.find_one({"id": "news-1"}))["author_name"] == "Gelöschter User"
    granted, granted_by = await db.achievement_events.find_one({"id": "erfolg-fuer"}), await db.achievement_events.find_one({"id": "erfolg-von"})
    assert (granted["username"], granted["user_name"], granted["actor_name"]) == (None, "Gelöschter User", "Vera V.")
    assert (granted_by["actor_name"], granted_by["user_name"]) == ("Gelöschter User", "Otto O.")
    audit = {row["id"]: row async for row in db.audit_logs.find({"id": {"$in": ["audit-selbst", "audit-ueber", "audit-andere"]}}, {"_id": 0})}
    assert "Paula" not in str(audit) and "Probe" not in str(audit), "Namen in den Daten des Protokolls"
    assert audit["audit-ueber"]["data"] == {"notes": "zahlt bar"} and audit["audit-ueber"]["action"] == "membership.update"
    # Nur mit Konto sinnvoll (#1029): Lesestände, Einladungen in Teams, Erfolge, Sticker, Verlauf der Saisonränge …
    for name in ("chat_reads", "document_opens", "team_invites", "user_achievements", "user_stickers", "season_rank_snapshots", "dolibarr_honours"):
        assert await getattr(db, name).count_documents({"user_id": uid}) == 0, name

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
    assert [row[0] for row in migrations.MIGRATIONS] == [1, 2, 3, 4, 5]
