"""Dolibarr I durch die echte Anwendung (#316, #295, #297, #330): bestätigte Zuordnung,
automatische Übernahme von Mitgliedschaft und Beitragsstand, Vereinsrechte aus
Funktionen nach einmaliger Freigabe - und alles, was dabei nie passieren darf."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import dolibarr_client, dolibarr_policy, dolibarr_sync, ops_checks  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402

KASSIER = [{"code": "kassier", "label": "Kassier:in", "since": "2026-03-01"}]


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


async def connect(flow, mode="live", **extra):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": mode, "environment": "production", "base_url": BASE_URL,
        "api_key": encrypt_secret(API_KEY), "instance": "verein", "entity": 1, "type_map": {"2": "ordinary"}, **extra,
    }}, upsert=True)


async def person(flow, name, *, role="player", **fields):
    user = await flow.add_user(role=role, name=name)
    fields.setdefault("email", f"{name}@example.test")
    fields.setdefault("email_verified", True)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    user.update(fields)
    return user


async def link(flow, user, member_id, *, admin=None):
    flow.act_as(admin or await flow.add_user(role="club_admin"))
    return await flow.post("/api/admin/dolibarr/links", json={"user_id": user["id"], "member_id": member_id})


async def membership_of(flow, user):
    return await flow.db.memberships.find_one({"user_id": user["id"]}, {"_id": 0})


# ---------------------------------------------------------------- Wer was sieht

@pytest.mark.asyncio
async def test_connection_is_system_only_and_the_key_never_comes_back(flow, fake):
    flow.act_as(await flow.add_user(role="club_admin"))
    saved = await flow.put("/api/admin/dolibarr/settings", json={
        "base_url": BASE_URL + "/api/index.php", "api_key": API_KEY, "instance": "verein", "mode": "preview",
    })
    assert saved.status_code == 200, saved.text
    assert (await flow.post("/api/admin/dolibarr/test")).json()["ok"] is True
    status = await flow.get("/api/admin/dolibarr/status")
    assert status.json()["api_key_configured"] is True and status.json()["base_url"] == BASE_URL
    assert API_KEY not in status.text
    # Die Übersicht „was läuft, wo es steht“: jede Funktion mit Schalterort - hier ist noch nichts an.
    features = {row["key"]: row for row in status.json()["features"]}
    assert set(features) == {"members", "club_facts", "sponsors", "applications", "consents", "invoices", "webhook"}
    assert features["club_facts"]["enabled"] is False and features["club_facts"]["where"] == "/admin/settings?tab=legal"
    assert features["members"]["state"].startswith("Modus Vorschau") and features["sponsors"]["where"] == "/admin/sponsors"
    assert all(row["where_label"] and row["hint"] for row in features.values())
    stored = await flow.db.settings.find_one({"id": "dolibarr"})
    assert stored["api_key"].startswith("enc:v1:")
    assert await flow.db.audit_logs.count_documents({"action": "dolibarr.settings"}) == 1

    for value in ("http://erp.example.test", "https://user:pw@erp.example.test"):
        assert (await flow.put("/api/admin/dolibarr/settings", json={"base_url": value})).status_code == 400

    vorstand = await person(flow, "nurclub", areas=["club"])
    flow.act_as(vorstand)
    assert (await flow.get("/api/admin/dolibarr/status")).status_code == 200
    assert (await flow.put("/api/admin/dolibarr/settings", json={"mode": "off"})).status_code == 403
    assert (await flow.post("/api/admin/dolibarr/webhook-token")).status_code == 403

    for outsider in (await person(flow, "redaktion", areas=["content"]), await person(flow, "turnier", role="tournament_admin"),
                     await person(flow, "mod", role="moderator"), await person(flow, "spieler")):
        flow.act_as(outsider)
        for url in ("/api/admin/dolibarr/status", "/api/admin/dolibarr/links", "/api/admin/dolibarr/preview"):
            assert (await flow.get(url)).status_code == 403, (outsider["username"], url)


@pytest.mark.asyncio
async def test_live_needs_a_clean_preview_run_first(flow, fake):
    await connect(flow, mode="off")
    flow.act_as(await flow.add_user(role="club_admin"))
    assert (await flow.put("/api/admin/dolibarr/settings", json={"mode": "live"})).status_code == 409
    assert (await flow.put("/api/admin/dolibarr/settings", json={"mode": "preview"})).status_code == 200
    assert (await flow.put("/api/admin/dolibarr/settings", json={"mode": "live"})).status_code == 409
    assert (await flow.post("/api/admin/dolibarr/sync")).json()["ok"] is True
    assert (await flow.put("/api/admin/dolibarr/settings", json={"mode": "live"})).status_code == 200


# ---------------------------------------------------------------- Zuordnung

@pytest.mark.asyncio
async def test_confirmed_link_gives_membership_and_the_member_sees_the_fee_card(flow, fake):
    await connect(flow)
    fake.add(member(12, functions=KASSIER), email="paula@example.test")
    paula = await person(flow, "paula")
    response = await link(flow, paula, 12)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "verified" and response.json()["thirdparty_id"] is None

    stored = await membership_of(flow, paula)
    assert stored["member_status"] == "active" and stored["membership_type"] == "ordinary"
    assert stored["member_number"] == "12" and stored["source"] == "dolibarr"
    assert (await flow.db.users.find_one({"id": paula["id"]}))["is_club_member"] is True

    flow.act_as(paula)
    me = (await flow.get("/api/membership/me")).json()
    assert me["is_active_member"] is True
    assert "dolibarr" not in me["membership"]
    view = me["dolibarr"]
    assert view["led_by_dolibarr"] is True and view["stale"] is False
    assert view["fee"]["status"] == "paid" and view["paid_until"] == "2026-12-31"
    assert view["functions"] == [{"label": "Kassier:in", "since": "2026-03-01"}]
    assert "payment_url" not in view["fee"]
    assert await flow.db.audit_logs.count_documents({"action": "dolibarr.link_verified", "target_id": paula["id"]}) == 1


@pytest.mark.asyncio
async def test_draft_and_stranger_get_no_access_and_preview_mode_writes_nothing(flow, fake):
    await connect(flow)
    fake.add(member(20, status="draft"))
    entwurf = await person(flow, "entwurf")
    assert (await link(flow, entwurf, 20)).status_code == 200
    assert (await membership_of(flow, entwurf))["member_status"] == "pending"
    flow.act_as(entwurf)
    assert (await flow.get("/api/membership/me")).json()["is_active_member"] is False

    fremd = await person(flow, "fremd")
    flow.act_as(fremd)
    me = (await flow.get("/api/membership/me")).json()
    assert me["is_active_member"] is False and me["dolibarr"]["link"] is None
    assert (await link(flow, fremd, 999)).status_code == 404

    await connect(flow, mode="preview")
    fake.add(member(21))
    vorschau = await person(flow, "vorschau")
    assert (await link(flow, vorschau, 21)).status_code == 200
    assert await membership_of(flow, vorschau) is None
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["applied"] == 0
    assert await membership_of(flow, vorschau) is None


@pytest.mark.asyncio
async def test_one_member_one_account_and_numbers_prove_nothing(flow, fake):
    await connect(flow)
    fake.add(member(12))
    erste, zweite = await person(flow, "erste"), await person(flow, "zweite")
    assert (await link(flow, erste, 12)).status_code == 200
    doppelt = await link(flow, zweite, 12)
    assert doppelt.status_code == 409 and "anderen Konto" in doppelt.json()["detail"]
    assert await membership_of(flow, zweite) is None

    flow.act_as(zweite)
    asked = await flow.post("/api/membership/dolibarr/link-request", json={"member_ref": "12"})
    assert asked.json() == {"status": "requested"}
    me = (await flow.get("/api/membership/me")).json()
    assert me["is_active_member"] is False
    assert me["dolibarr"]["link"] == {"status": "requested", "member_ref": None, "verified_at": None, "requested_at": me["dolibarr"]["link"]["requested_at"]}

    fake.add(member(13))
    flow.act_as(await flow.add_user(role="club_admin"))
    umzug = await flow.post("/api/admin/dolibarr/links", json={"user_id": erste["id"], "member_id": 13})
    assert umzug.status_code == 409 and "zuerst lösen" in umzug.json()["detail"]


@pytest.mark.asyncio
async def test_email_links_only_when_switched_on_verified_and_unambiguous(flow, fake):
    await connect(flow)
    fake.add(member(12), email="paula@example.test")
    paula = await person(flow, "paula")
    flow.act_as(paula)
    assert (await flow.get("/api/membership/me")).json()["dolibarr"]["link"] is None, "ohne Schalter keine stille Zuordnung"

    await connect(flow, auto_link_verified_email=True)
    unbestaetigt = await person(flow, "unbestaetigt", email="kind@example.test", email_verified=False)
    fake.add(member(14), email="kind@example.test")
    flow.act_as(unbestaetigt)
    assert (await flow.get("/api/membership/me")).json()["is_active_member"] is False

    fake.add(member(15), email="familie@example.test")
    fake.add(member(16), email="familie@example.test")
    familie = await person(flow, "familie")
    flow.act_as(familie)
    shared = (await flow.get("/api/membership/me")).json()
    assert shared["is_active_member"] is False and shared["dolibarr"]["link"]["status"] == "conflict"

    flow.act_as(paula)
    linked = (await flow.get("/api/membership/me")).json()
    assert linked["is_active_member"] is True and linked["dolibarr"]["link"]["status"] == "verified"
    calls = len(fake.calls)
    await flow.get("/api/membership/me")
    assert len(fake.calls) == calls, "eine bestätigte Zuordnung fragt nicht bei jedem Aufruf neu"


# ---------------------------------------------------------------- Übernahme

@pytest.mark.asyncio
async def test_overdue_fee_and_future_exit_keep_the_membership(flow, fake):
    await connect(flow)
    in_a_month = (now_utc() + timedelta(days=30)).date().isoformat()
    fake.add(member(12, fee_status="due", paid_until="2025-12-31", membership_ends=in_a_month))
    paula = await person(flow, "paula")
    await link(flow, paula, 12)
    stored = await membership_of(flow, paula)
    assert stored["member_status"] == "active"
    assert stored["dolibarr"]["fee"]["status"] == "due" and stored["dolibarr"]["membership_ends"] == in_a_month


@pytest.mark.asyncio
async def test_exit_is_taken_over_and_local_editing_cannot_undo_it(flow, fake):
    await connect(flow)
    fake.add(member(12))
    paula = await person(flow, "paula")
    admin = await flow.add_user(role="club_admin")
    await link(flow, paula, 12, admin=admin)
    fake.members[12] = member(12, status="terminated", fee_status="inactive", updated_at="2026-09-20T08:00:00Z")
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["applied"] == 1
    assert (await membership_of(flow, paula))["member_status"] == "former"
    assert (await flow.db.users.find_one({"id": paula["id"]}))["is_club_member"] is False

    flow.act_as(admin)
    created = await flow.post("/api/membership/profiles/admin", json={"display_name": "Paula", "user_id": paula["id"]})
    assert created.status_code in (200, 201), created.text
    assert (await membership_of(flow, paula))["member_status"] == "former", "Profilpflege reaktiviert keinen Austritt"

    blocked = await flow.put(f"/api/membership/user/{paula['id']}", json={"member_status": "active"})
    assert blocked.status_code == 409 and "Dolibarr" in blocked.json()["detail"]
    assert (await flow.put(f"/api/membership/user/{paula['id']}", json={"notes": "bleibt erlaubt"})).status_code == 200
    assert (await membership_of(flow, paula))["member_status"] == "former"

    lokal = await person(flow, "lokal")
    assert (await flow.put(f"/api/membership/user/{lokal['id']}", json={"member_status": "active"})).status_code == 200


@pytest.mark.asyncio
async def test_unknown_member_type_is_not_silently_ordinary(flow, fake):
    await connect(flow)
    fake.add(member(12, type_id=7, type_label="Fördermitglied Firma"))
    paula = await person(flow, "paula")
    await link(flow, paula, 12)
    stored = await membership_of(flow, paula)
    assert stored["member_status"] == "active" and stored["membership_type"] is None
    assert stored["dolibarr"]["type_unmapped"] is True
    flow.act_as(await flow.add_user(role="club_admin"))
    assert (await flow.get("/api/admin/dolibarr/status")).json()["unmapped_types"] == 1


@pytest.mark.asyncio
async def test_incomplete_run_removes_nobody_and_keeps_the_cursor(flow, fake):
    await connect(flow)
    fake.add(member(12))
    paula = await person(flow, "paula")
    await link(flow, paula, 12)
    assert (await dolibarr_sync.run_sync(flow.db, full=True))["ok"] is True
    cursor = (await dolibarr_sync.sync_state(flow.db))["cursor"]
    assert cursor == fake.server_time

    fake.server_time = "2026-09-22T10:00:00Z"
    fake.break_after_pages = 0
    broken = await dolibarr_sync.run_sync(flow.db, full=True)
    assert broken["ok"] is False and broken["error"] == "unavailable"
    state = await dolibarr_sync.sync_state(flow.db)
    assert state["ok"] is False and state["cursor"] == cursor and state["last_error"]["kind"] == "unavailable"
    assert (await membership_of(flow, paula))["member_status"] == "active"
    assert (await flow.db.dolibarr_links.find_one({"user_id": paula["id"]}))["status"] == "verified"


@pytest.mark.asyncio
async def test_changed_since_pages_and_a_deleted_member(flow, fake, monkeypatch):
    monkeypatch.setattr(dolibarr_client, "PAGE_LIMIT", 2)
    await connect(flow)
    people = []
    for number in range(10, 15):
        fake.add(member(number, updated_at="2026-09-01T00:00:00Z"))
        people.append(await person(flow, f"m{number}"))
        await link(flow, people[-1], number)
    fake.calls.clear()
    first = await dolibarr_sync.run_sync(flow.db, full=True)
    assert first["seen"] == 5 and [params.get("page") for path, params in fake.calls if path == "/vereine/members"] == ["0", "1", "2", "3"]

    fake.members[11] = member(11, status="excluded", fee_status="inactive", updated_at="2026-09-21T11:00:00Z")
    fake.calls.clear()
    second = await dolibarr_sync.run_sync(flow.db, full=False)
    assert second["seen"] == 1 and second["applied"] == 1
    assert all(params.get("changed_since") == "2026-09-21T10:00:00Z" for path, params in fake.calls if path == "/vereine/members")
    assert (await membership_of(flow, people[1]))["member_status"] == "former"

    del fake.members[12]
    third = await dolibarr_sync.run_sync(flow.db, full=True)
    assert third["gone"] == 1
    assert (await membership_of(flow, people[2]))["member_status"] == "former"
    assert (await flow.db.dolibarr_links.find_one({"user_id": people[2]["id"]}))["status"] == "gone"
    assert (await membership_of(flow, people[0]))["member_status"] == "active"


@pytest.mark.asyncio
async def test_sync_sends_no_mails(flow, fake):
    await connect(flow)
    fake.add(member(12))
    paula = await person(flow, "paula")
    await link(flow, paula, 12)
    fake.members[12] = member(12, status="terminated", fee_status="inactive", updated_at="2026-09-20T08:00:00Z")
    await dolibarr_sync.run_sync(flow.db, full=True)
    assert await flow.db.mail_queue.count_documents({}) == 0


# ---------------------------------------------------------------- Webhook

@pytest.mark.asyncio
async def test_webhook_is_only_a_reason_to_read_again(flow, fake, monkeypatch):
    await connect(flow)
    fake.add(member(12))
    paula = await person(flow, "paula")
    await link(flow, paula, 12)
    flow.act_as(await flow.add_user(role="club_admin"))
    path = (await flow.post("/api/admin/dolibarr/webhook-token")).json()["path"]
    event = {"triggercode": "VEREINE_MEMBER_CHANGED", "object": {"id": 12, "member_id": 12, "cause": "MEMBER_RESILIATE",
                                                                   "status": "terminated", "occurred_at": "2026-09-21T08:00:00Z"}}
    flow.act_as(None)
    assert (await flow.post("/api/integrations/dolibarr/webhook/falsch", json=event)).status_code == 404
    assert (await flow.post(path, json={"triggercode": "MEMBER_MODIFY", "object": {"member_id": 12}})).status_code == 400
    assert (await flow.post(path, json=event)).status_code == 202
    assert (await flow.post(path, json=event)).status_code == 202
    assert await flow.db.dolibarr_pending.count_documents({}) == 1, "doppeltes Ereignis, ein Nachlesen"
    assert (await membership_of(flow, paula))["member_status"] == "active", "das Ereignis selbst ändert nichts"

    assert (await dolibarr_sync.process_pending(flow.db))["processed"] == 0, "erst ein paar Sekunden später lesen"
    monkeypatch.setattr(dolibarr_sync, "PENDING_DELAY_SECONDS", -1)
    fake.members[12] = member(12, status="terminated", fee_status="inactive", updated_at="2026-09-21T08:00:01Z")
    await flow.post(path, json=event)
    assert (await dolibarr_sync.process_pending(flow.db))["processed"] == 1
    assert (await membership_of(flow, paula))["member_status"] == "former"
    assert await flow.db.dolibarr_pending.count_documents({}) == 0


@pytest.mark.asyncio
async def test_older_state_never_overwrites_a_newer_one(flow, fake):
    await connect(flow)
    fake.add(member(12, status="terminated", fee_status="inactive", updated_at="2026-09-21T09:00:00Z"))
    paula = await person(flow, "paula")
    await link(flow, paula, 12)
    settings = await dolibarr_client.load_settings(flow.db)
    stored_link = await flow.db.dolibarr_links.find_one({"user_id": paula["id"]}, {"_id": 0})
    verdict = await dolibarr_sync.apply_summary(flow.db, settings, stored_link, member(12, updated_at="2026-09-01T00:00:00Z"))
    assert verdict == "stale"
    assert (await membership_of(flow, paula))["member_status"] == "former"


# ---------------------------------------------------------------- Vereinsrechte aus Funktionen (#297)

async def approve(flow, mapping):
    flow.act_as(await flow.add_user(role="superadmin"))
    return await flow.put("/api/admin/dolibarr/function-policy", json={"map": mapping, "confirm": True})


@pytest.mark.asyncio
async def test_function_opens_the_club_area_and_its_end_closes_it_without_new_login(flow, fake):
    await connect(flow)
    fake.add(member(12, functions=KASSIER))
    paula = await person(flow, "paula", areas=["content"])
    await link(flow, paula, 12)

    flow.act_as(paula)
    assert (await flow.get("/api/membership")).status_code == 403, "ohne Freigabe verleiht eine Funktion nichts"

    flow.act_as(await flow.add_user(role="club_admin"))
    assert (await flow.put("/api/admin/dolibarr/function-policy", json={"map": {"kassier": ["club"]}, "confirm": True})).status_code == 403
    flow.act_as(await flow.add_user(role="superadmin"))
    preview = (await flow.put("/api/admin/dolibarr/function-policy", json={"map": {"kassier": ["club", "system"]}})).json()
    assert preview["preview"] is True and preview["map"] == {"kassier": ["club"]}, "System ist nie ableitbar"
    assert [row["username"] for row in preview["affected"]] == ["paula"]
    assert (await dolibarr_client.load_settings(flow.db)).get("function_policy") is None

    approved = await approve(flow, {"kassier": ["club", "system"], "rechnungspruefung": []})
    assert approved.json()["policy"]["version"] == 1 and approved.json()["policy"]["map"] == {"kassier": ["club"]}
    assert await flow.db.audit_logs.count_documents({"action": "dolibarr.function_policy"}) == 1

    flow.act_as(paula)
    assert (await flow.get("/api/membership")).status_code == 200
    assert set((await flow.get("/api/auth/me")).json()["areas"]) == {"content", "club"}
    assert (await flow.get("/api/admin/dolibarr/status")).status_code == 200
    assert (await flow.put("/api/admin/dolibarr/settings", json={"mode": "off"})).status_code == 403, "System bleibt zu"

    fake.members[12] = member(12, functions=[], updated_at="2026-09-21T12:00:00Z")
    await dolibarr_sync.run_sync(flow.db, full=True)
    assert (await flow.get("/api/membership")).status_code == 403, "Funktionsende greift ohne neues Anmelden"
    assert (await flow.get("/api/auth/me")).json()["areas"] == ["content"], "die ausdrückliche Freigabe bleibt"


@pytest.mark.asyncio
async def test_what_never_grants_rights(flow, fake):
    await connect(flow)
    # „Morgen“ am Ort des Vereins - der Servertag (UTC) liegt um Mitternacht daneben (#355).
    tomorrow = (now_utc().astimezone(dolibarr_policy.CLUB_TZ) + timedelta(days=1)).date().isoformat()
    fake.add(member(12, functions=[{"code": "rechnungspruefung", "label": "Rechnungsprüfer:in", "since": "2026-01-01"},
                                   {"code": "beirat_neu", "label": "Beirat", "since": "2026-01-01"}]))
    fake.add(member(13, functions=[{"code": "kassier", "label": "Kassier:in", "since": tomorrow}]))
    fake.add(member(14, status="terminated", fee_status="inactive", functions=KASSIER))
    pruefer, morgen, ehemalig = await person(flow, "pruefer"), await person(flow, "morgen"), await person(flow, "ehemalig")
    for user, number in ((pruefer, 12), (morgen, 13), (ehemalig, 14)):
        await link(flow, user, number)
    namensvetter = await person(flow, "namensvetter", display_name="Paula Beispiel")
    posten = await person(flow, "posten")
    await flow.db.board_positions.insert_one({"id": "bp1", "slug": "kassier", "title": "Kassier", "user_id": posten["id"], "is_active": True})

    flow.act_as(posten)
    assert (await flow.get("/api/membership")).status_code == 200, "ohne Freigabe zählt der lokale Posten wie bisher"
    await approve(flow, {"kassier": ["club"]})
    for user in (pruefer, morgen, ehemalig, namensvetter, posten):
        flow.act_as(user)
        assert (await flow.get("/api/membership")).status_code == 403, user["username"]


@pytest.mark.asyncio
async def test_rights_rest_when_the_state_is_too_old_but_membership_stays(flow, fake):
    await connect(flow)
    fake.add(member(12, functions=KASSIER))
    paula = await person(flow, "paula")
    await link(flow, paula, 12)
    await approve(flow, {"kassier": ["club"]})
    flow.act_as(paula)
    assert (await flow.get("/api/membership")).status_code == 200

    old = (now_utc() - timedelta(hours=72)).isoformat()
    await flow.db.memberships.update_one({"user_id": paula["id"]}, {"$set": {"dolibarr.synced_at": old}})
    assert (await flow.get("/api/membership")).status_code == 403
    me = (await flow.get("/api/membership/me")).json()
    assert me["is_active_member"] is True and me["dolibarr"]["stale"] is True


@pytest.mark.asyncio
async def test_unlinking_ends_derived_rights_and_hands_the_record_back(flow, fake):
    await connect(flow)
    fake.add(member(12, functions=KASSIER))
    paula = await person(flow, "paula")
    admin = await flow.add_user(role="club_admin")
    await link(flow, paula, 12, admin=admin)
    await approve(flow, {"kassier": ["club"]})
    flow.act_as(admin)
    assert (await flow.client.delete(f"/api/admin/dolibarr/links/{paula['id']}")).status_code == 200
    flow.act_as(paula)
    assert (await flow.get("/api/membership")).status_code == 403
    stored = await membership_of(flow, paula)
    assert stored["source"] == "local" and stored["member_status"] == "active"
    flow.act_as(admin)
    assert (await flow.put(f"/api/membership/user/{paula['id']}", json={"member_status": "inactive"})).status_code == 200


# ---------------------------------------------------------------- Umstellung und Betrieb (#330)

@pytest.mark.asyncio
async def test_migration_preview_lists_matches_and_conflicts_and_writes_nothing(flow, fake):
    await connect(flow, mode="preview")
    fake.add(member(12), email="paula@example.test")
    fake.add(member(13, status="terminated", fee_status="inactive"), email="alt@example.test")
    fake.add(member(15), email="familie@example.test")
    fake.add(member(16), email="familie@example.test")
    fake.add(member(17, firstname="Ohne", lastname="Konto"))
    fake.add(member(18), email="unbestaetigt@example.test")
    fake.add(member(19, status="terminated", fee_status="inactive", firstname="Ehe", lastname="Malig"))
    await person(flow, "unbestaetigt", email_verified=False)
    await person(flow, "paula")
    alt = await person(flow, "alt")
    await person(flow, "familie")
    nur_lokal = await person(flow, "nurlokal")
    for user in (alt, nur_lokal):
        await flow.db.memberships.insert_one({"id": f"m-{user['id']}", "user_id": user["id"], "member_status": "active"})
    await person(flow, "gast")

    flow.act_as(await flow.add_user(role="club_admin"))
    response = await flow.get("/api/admin/dolibarr/preview")
    assert response.status_code == 200, response.text
    preview = response.json()
    rows = {row["username"]: row for row in preview["rows"]}
    assert rows["paula"]["state"] == "match" and rows["paula"]["member_id"] == 12 and rows["paula"]["would_change_status"] is True
    assert rows["alt"]["state"] == "match" and rows["alt"]["dolibarr_status"] == "terminated" and rows["alt"]["would_change_status"] is True
    assert rows["familie"]["state"] == "shared_email" and rows["familie"]["member_id"] is None
    assert rows["nurlokal"]["state"] == "not_in_dolibarr"
    assert "gast" not in rows
    # Konto mit unbestätigter E-Mail: Der Treffer wird gezeigt (ein Mensch bestätigt), aber gekennzeichnet.
    assert rows["unbestaetigt"]["state"] == "match_unverified_email" and rows["unbestaetigt"]["member_id"] == 18
    # Beendete Mitgliedschaften stehen getrennt - Ehemalige sind keine Mitglieder.
    ended = {m["member_id"]: m["ended"] for m in preview["members_without_account"]}
    assert ended[19] is True and ended[17] is False
    assert "Ohne Konto" in [m["name"] for m in preview["members_without_account"]]
    assert {m["member_id"] for m in preview["members_without_account"]} == {15, 16, 17, 19}
    assert preview["types"][0]["mapped_to"] == "ordinary"

    assert await flow.db.dolibarr_links.count_documents({}) == 0
    assert (await membership_of(flow, alt))["member_status"] == "active"
    assert await flow.db.memberships.count_documents({"source": "dolibarr"}) == 0


def test_rate_dolibarr():
    assert ops_checks.rate_dolibarr("off", {"ok": False}, None) == "ok"
    assert ops_checks.rate_dolibarr("live", None, None) == "ok"
    assert ops_checks.rate_dolibarr("live", {"ok": True}, 5) == "ok"
    assert ops_checks.rate_dolibarr("live", {"ok": True}, 600) == "warn"
    assert ops_checks.rate_dolibarr("preview", {"ok": False}, 5000) == "warn"
    assert ops_checks.rate_dolibarr("live", {"ok": False}, 30) == "warn"
    assert ops_checks.rate_dolibarr("live", {"ok": False}, 25 * 60) == "crit"


@pytest.mark.asyncio
async def test_ops_check_names_the_problem_without_the_key(flow, fake):
    assert (await ops_checks.check_dolibarr_sync(flow.db))["value"] == "aus"
    await connect(flow)
    fake.fail_with = 403
    await dolibarr_sync.run_sync(flow.db, full=True)
    check = await ops_checks.check_dolibarr_sync(flow.db)
    assert check["status"] in ("warn", "crit") and check["value"] == "liefert nichts"
    assert "Recht im Modul Vereine" in check["detail"] and API_KEY not in check["detail"]
    fake.fail_with = None
    await dolibarr_sync.run_sync(flow.db, full=True)
    assert (await ops_checks.check_dolibarr_sync(flow.db))["status"] == "ok"


# ---------------------------------------------------------------- #345: von Hand zuordnen, interne Notiz

@pytest.mark.asyncio
async def test_unverified_email_is_never_linked_by_itself_but_by_hand_it_works(flow, fake):
    await connect(flow, auto_link_verified_email=True)
    fake.add(member(18), email="unbestaetigt@example.test")
    konto = await person(flow, "unbestaetigt", email_verified=False)
    flow.act_as(konto)
    assert (await flow.get("/api/membership/me")).json()["dolibarr"]["link"] is None
    assert (await link(flow, konto, 18)).status_code == 200
    assert (await membership_of(flow, konto))["member_status"] == "active"


@pytest.mark.asyncio
async def test_internal_notes_stay_internal(flow):
    paula = await person(flow, "paula")
    flow.act_as(await flow.add_user(role="club_admin"))
    saved = await flow.put(f"/api/membership/user/{paula['id']}", json={"member_status": "active", "notes": "zahlt immer zu spät"})
    assert saved.status_code == 200
    flow.act_as(paula)
    me = await flow.get("/api/membership/me")
    assert "zahlt immer zu spät" not in me.text
    membership = me.json()["membership"]
    assert "notes" not in membership and "updated_by" not in membership
    assert membership["history"] and set(membership["history"][0]) == {"at", "from_status", "to_status", "source"}


def test_a_function_starts_on_the_clubs_day_not_the_servers(monkeypatch):
    """Um 00:30 Wiener Zeit ist es am Server (UTC) noch gestern - die Funktion gilt trotzdem ab heute (#355)."""
    from datetime import datetime, timezone

    monkeypatch.setattr(dolibarr_policy, "now_utc", lambda: datetime(2026, 9, 30, 22, 30, tzinfo=timezone.utc))
    assert dolibarr_policy.club_today() == "2026-10-01"
    starts_today = [{"code": "kassier", "label": "Kassier:in", "since": "2026-10-01"}]
    starts_tomorrow = [{"code": "kassier", "label": "Kassier:in", "since": "2026-10-02"}]
    assert [g["area"] for g in dolibarr_policy.areas_from_functions(starts_today, {"kassier": ["club"]})] == ["club"]
    assert dolibarr_policy.areas_from_functions(starts_tomorrow, {"kassier": ["club"]}) == []
