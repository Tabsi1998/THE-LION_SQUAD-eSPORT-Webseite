"""Eigene Daten und Austritt (#329 Teil 2): nur mit Bindung und Fähigkeit „profile“; Änderungen nennen den
gesehenen Stand (sonst 409), sofort übernommene Felder stehen gleich im Profil, der Rest liegt beim Vorstand;
derselbe Inhalt noch einmal ist derselbe Auftrag; den letzten Tag des Austritts rechnet der Verein."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import dolibarr_client, dolibarr_identity, dolibarr_sync  # noqa: E402
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
    dolibarr_identity.reset_cache()
    return instance


async def connect(flow, mode="live"):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": mode, "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1, "type_map": {"2": "ordinary"},
    }}, upsert=True)


async def paula_bound(flow, fake, capabilities=("documents", "profile")):
    fake.add(member(12), email="paula@example.test")
    fake.invite("CODE", 12, capabilities=capabilities)
    paula = await flow.add_user(role="player", name="paula")
    paula["is_club_member"] = True
    flow.act_as(paula)
    assert (await flow.post("/api/membership/me/identity", json={"code": "CODE"})).json()["status"] == "bound"
    return paula


@pytest.mark.asyncio
async def test_own_data_change_and_exit_run_through_the_binding(flow, fake):
    await connect(flow)
    fake.add(member(12), email="paula@example.test")
    paula = await flow.add_user(role="player", name="paula")
    paula["is_club_member"] = True
    flow.act_as(paula)
    assert (await flow.get("/api/membership/me/self-service")).json()["reason"] == "not_bound"
    denied = await flow.post("/api/membership/me/self-service/changes", json={"version": "v1", "changes": {"phone": "1"}})
    assert denied.status_code == 403 and "Einladungscode" in denied.json()["detail"]

    # Nur Dokumente erlaubt: der Grund steht da, nichts geht raus.
    fake.invite("DOCS", 12, capabilities=("documents",))
    assert (await flow.post("/api/membership/me/identity", json={"code": "DOCS"})).json()["status"] == "bound"
    assert (await flow.get("/api/membership/me/self-service")).json()["reason"] == "no_capability"
    assert (await flow.post("/api/membership/me/self-service/changes", json={"version": "v1", "changes": {"phone": "1"}})).status_code == 409

    # Neue Bindung mit „profile“: die eigenen Daten, Geburtsdatum nur lesend, noch keine Einreichung.
    fake.revoke_identity(paula["id"])
    fake.invite("ALL", 12, capabilities=("documents", "profile"))
    assert (await flow.post("/api/membership/me/identity", json={"code": "ALL"})).json()["capabilities"] == ["documents", "profile"]
    view = (await flow.get("/api/membership/me/self-service")).json()
    assert view["available"] is True and view["profile"]["firstname"] == "Paula" and view["profile"]["birth"] == "1990-05-04"
    assert view["profile"]["version"] == "v1" and view["profile"]["exit"] is None and view["profile"]["direct"] == ["phone", "phone_mobile"]
    assert view["changeable"] == ["address", "zip", "town", "country_code", "phone", "phone_mobile", "email"] and view["requests"] == []
    assert "birth" not in view["changeable"]

    # Mobilnummer: übernimmt der Verein sofort - Profil neu, Stand neu.
    applied = (await flow.post("/api/membership/me/self-service/changes", json={"version": "v1", "changes": {"phone_mobile": " +43 660 1234567 "}})).json()
    assert applied["status"] == "applied" and applied["status_label"] == "übernommen" and applied["kind"] == "change"
    view = (await flow.get("/api/membership/me/self-service")).json()
    assert view["profile"]["phone_mobile"] == "+43 660 1234567" and view["profile"]["version"] == "v2" and len(view["requests"]) == 1

    # Adresse: mit altem Stand 409, mit neuem Stand beim Vorstand; derselbe Inhalt noch einmal = derselbe Auftrag.
    stale = await flow.post("/api/membership/me/self-service/changes", json={"version": "v1", "changes": {"address": "Neue Gasse 2"}})
    assert stale.status_code == 409 and "inzwischen geändert" in stale.json()["detail"]
    change = {"version": "v2", "changes": {"address": "Neue Gasse 2", "zip": "6020", "town": "Innsbruck"}}
    received = (await flow.post("/api/membership/me/self-service/changes", json=change)).json()
    assert received["status"] == "received" and received["status_label"] == "beim Vorstand" and received["changes"]["town"] == "Innsbruck"
    again = (await flow.post("/api/membership/me/self-service/changes", json=change)).json()
    assert again["external_id"] == received["external_id"]
    view = (await flow.get("/api/membership/me/self-service")).json()
    assert len(view["requests"]) == 2 and view["profile"]["address"] == "Teststraße 1", "beim Vorstand heißt: noch nicht übernommen"

    # Was nicht geht: fremde Felder, nichts, kein Stand.
    assert (await flow.post("/api/membership/me/self-service/changes", json={"version": "v2", "changes": {"lastname": "X"}})).status_code == 400
    assert (await flow.post("/api/membership/me/self-service/changes", json={"version": "v2", "changes": {}})).status_code == 400
    assert (await flow.post("/api/membership/me/self-service/changes", json={"version": "", "changes": {"phone": "1"}})).status_code == 400

    # Austritt: Wunsch vor der Frist wird nicht übernommen, der Verein rechnet den letzten Tag; zweimal geht nicht.
    assert (await flow.post("/api/membership/me/self-service/exit", json={"wished_last_day": "1.10.2026"})).status_code == 400
    exit_row = (await flow.post("/api/membership/me/self-service/exit", json={"wished_last_day": "2026-10-01"})).json()
    assert exit_row["kind"] == "exit" and exit_row["last_day"] == "2026-12-31" and exit_row["wished_too_early"] is True and exit_row["notice_day"] == "2026-09-24"
    view = (await flow.get("/api/membership/me/self-service")).json()
    assert view["profile"]["exit"] == {"status": "planned", "reason": "", "notice_day": "2026-09-24", "last_day": "2026-12-31"}
    twice = await flow.post("/api/membership/me/self-service/exit", json={})
    assert twice.status_code == 409 and "schon geplant" in twice.json()["detail"]
    assert [row["kind"] for row in view["requests"]] == ["change", "change", "exit"]


@pytest.mark.asyncio
async def test_a_revoked_binding_closes_the_self_service(flow, fake):
    await connect(flow)
    paula = await paula_bound(flow, fake)
    assert (await flow.get("/api/membership/me/self-service")).json()["available"] is True
    fake.revoke_identity(paula["id"])
    view = (await flow.get("/api/membership/me/self-service")).json()
    assert view["available"] is False and view["reason"] == "not_bound"
    assert (await flow.get("/api/membership/me/identity")).json()["status"] == "revoked"
    assert (await flow.post("/api/membership/me/self-service/exit", json={})).status_code == 403


FIELDS = [
    {"code": "gamertag", "label": "Gamertag", "type": "text", "editable": True, "value": None, "max_length": 40},
    {"code": "bio", "label": "Kurztext", "type": "textarea", "editable": True, "value": None, "max_length": 2000},
    {"code": "games", "label": "Spiele", "type": "text", "editable": True, "value": None, "max_length": 255},
    {"code": "hauptspiel", "label": "Hauptspiel", "type": "select", "editable": True, "value": None, "options": [{"code": "tft", "label": "TFT"}, {"code": "rl", "label": "Rocket League"}]},
    {"code": "streamer", "label": "Streamt", "type": "boolean", "editable": True, "value": None},
    {"code": "dabei_seit", "label": "Dabei seit", "type": "date", "editable": False, "value": "2023-01-01"},
]


@pytest.mark.asyncio
async def test_member_keeps_own_website_profile_and_the_directory_follows(flow, fake, monkeypatch, tmp_path):
    """Eigenes Website-Profil (#260, Vereine 1.2): die Felder, die der Verein gewählt hat - nur mit Bindung und
    Fähigkeit „profile“; nur änderbare Felder, nur gesendete ändern sich, Werte je Art geprüft, 400 mit Feldname;
    nach dem Speichern liest die Website das Mitglied nach: zugeordnete Felder landen in den Spalten des
    Verzeichnisses, der Rest als „Weitere Angaben“."""
    monkeypatch.setattr(dolibarr_sync, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(dolibarr_sync, "PENDING_DELAY_SECONDS", 0)
    await connect(flow)
    fake.consent_texts.append({"code": "profil", "label": "Nennung auf der Website", "version": 1, "text": "…"})
    fake.website_profile_consent = "profil"
    fake.member_profiles[12] = {"fields": [dict(f) for f in FIELDS]}
    paula = await paula_bound(flow, fake)
    paula["is_club_member"] = True
    settings = await dolibarr_client.load_settings(flow.db)
    await verify_link(flow.db, settings, user_id=paula["id"], member_id=12, member_ref="12", source="admin", actor_id="admin")

    view = (await flow.get("/api/membership/me/website-profile")).json()
    assert view["available"] is True and view["consent"] == "profil" and view["given"] is False
    assert [(f["code"], f["type"], f["editable"]) for f in view["fields"]] == [("gamertag", "text", True), ("bio", "textarea", True), ("games", "text", True), ("hauptspiel", "select", True), ("streamer", "boolean", True), ("dabei_seit", "date", False)]
    assert view["fields"][3]["options"] == [{"code": "tft", "label": "TFT"}, {"code": "rl", "label": "Rocket League"}] and view["fields"][0]["max_length"] == 40

    saved = (await flow.put("/api/membership/me/website-profile", json={"fields": {"gamertag": " LionKing ", "hauptspiel": "rl", "streamer": True}})).json()
    values = {f["code"]: f["value"] for f in saved["fields"]}
    assert values["gamertag"] == "LionKing" and values["hauptspiel"] == "rl" and values["streamer"] is True and values["bio"] is None and values["dabei_seit"] == "2023-01-01"
    saved = (await flow.put("/api/membership/me/website-profile", json={"fields": {"bio": "Spielt TFT.", "games": "TFT, Rocket League"}})).json()
    values = {f["code"]: f["value"] for f in saved["fields"]}
    assert values["gamertag"] == "LionKing" and values["bio"] == "Spielt TFT." and values["games"] == "TFT, Rocket League", "nicht gesendete Felder bleiben"
    too_long = await flow.put("/api/membership/me/website-profile", json={"fields": {"gamertag": "x" * 41}})
    assert too_long.status_code == 400 and too_long.json()["detail"] == "Gamertag: höchstens 40 Zeichen."
    assert (await flow.put("/api/membership/me/website-profile", json={"fields": {"hauptspiel": "lol"}})).json()["detail"] == "Hauptspiel: keine gültige Auswahl."
    assert (await flow.put("/api/membership/me/website-profile", json={"fields": {"dabei_seit": "2024-01-01"}})).status_code == 400, "nicht änderbar"
    assert "unbekannt" in (await flow.put("/api/membership/me/website-profile", json={"fields": {"unbekannt": "x"}})).json()["detail"]
    assert (await flow.put("/api/membership/me/website-profile", json={"fields": {}})).status_code == 400
    assert {f["code"]: f["value"] for f in fake.member_profiles[12]["fields"]}["gamertag"] == "LionKing", "dieselbe Ablage wie die Mitgliedskarte"

    # Einwilligung erteilt: „given“, und nach dem nächsten Speichern zeigt das Verzeichnis die zugeordneten Felder.
    fake.member_consents.setdefault(12, {})["profil"] = {"state": "given", "version": 1, "moment": "2026-09-25T09:00:00+00:00"}
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["ok"] is True
    assert (await flow.get("/api/membership/me/website-profile")).json()["given"] is True
    await flow.put("/api/membership/me/website-profile", json={"fields": {"gamertag": "LionQueen"}})
    assert (await dolibarr_sync.process_pending(flow.db))["processed"] == 1
    profile = await flow.db.club_member_profiles.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert profile["gamertag"] == "LionQueen" and profile["bio"] == "Spielt TFT." and profile["games"] == ["TFT", "Rocket League"]
    assert profile["extra_fields"] == [{"code": "hauptspiel", "label": "Hauptspiel", "value": "Rocket League"}, {"code": "streamer", "label": "Streamt", "value": "Ja"},
                                       {"code": "dabei_seit", "label": "Dabei seit", "value": "2023-01-01"}]
    flow.act_as(None)
    public = (await flow.get(f"/api/membership/profiles/{profile['slug']}")).json()
    assert public["extra_fields"][0] == {"code": "hauptspiel", "label": "Hauptspiel", "value": "Rocket League"}
    assert (await dolibarr_sync.sync_state(flow.db))["website_profile_fields"][3] == {"code": "hauptspiel", "label": "Hauptspiel", "type": "select"}

    # Der Vorstand ordnet die Spalte Gamertag einem anderen Feld zu - der Abgleich folgt.
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    assert (await flow.put("/api/admin/dolibarr/settings", json={"directory_field_map": {"gamertag": "hauptspiel"}})).status_code == 200
    status = (await flow.get("/api/admin/dolibarr/status")).json()
    assert status["directory_field_map"] == {"gamertag": "hauptspiel", "bio": "bio", "games": "games", "platforms": "platforms"}
    assert status["website_profile_fields"][3]["code"] == "hauptspiel"
    assert (await flow.put("/api/admin/dolibarr/settings", json={"directory_field_map": {"gamertag": "Groß"}})).status_code == 400
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["directory"] == 1
    profile = await flow.db.club_member_profiles.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert profile["gamertag"] == "Rocket League" and [row["code"] for row in profile["extra_fields"]] == ["gamertag", "streamer", "dabei_seit"]

    # Ohne Bindung: Grund statt Formular.
    flow.act_as(paula)
    fake.revoke_identity(paula["id"])
    view = (await flow.get("/api/membership/me/website-profile")).json()
    assert view["available"] is False and view["reason"] == "not_bound"
    assert (await flow.put("/api/membership/me/website-profile", json={"fields": {"gamertag": "x"}})).status_code == 403
