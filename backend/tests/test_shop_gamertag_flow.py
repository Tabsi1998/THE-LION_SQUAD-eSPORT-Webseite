"""Gamertag-Druckdatei im Shop-Admin (#1711): Regeln einstellen, Vorschau, Testdatei mit öffentlicher Adresse, Wortfilter,
kein Name im Log, Rechte und Protokoll, Vorbelegung aus der Mitgliederakte mit Dolibarr-Ausfall.

Durch die echte Anwendung (flow_harness). Alle Namen sind erfunden - keine echten Gamertags."""
import base64
import logging
import pathlib
import sys
from io import BytesIO

import httpx
import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member  # noqa: E402
from flow_harness import make_flow  # noqa: E402

BASE = "/api/admin/shop/gamertag"
SECRET_NAME = "Geheimtag77"


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    import storage
    from services import shop_schema

    monkeypatch.setattr(storage, "SHOP_DESIGN_DIR", tmp_path / "shop-designs")
    instance, shutdown = make_flow()
    try:
        await shop_schema.apply(instance.db)
        instance.design_dir = tmp_path / "shop-designs"
        yield instance
    finally:
        await shutdown()


async def finance(flow) -> dict:
    user = await flow.add_user(role="player", name="kassier")
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": ["finance"]}})
    user["areas"] = ["finance"]
    flow.act_as(user)
    return user


def image_of(data_url: str) -> Image.Image:
    head, _, body = data_url.partition(",")
    assert head == "data:image/png;base64"
    img = Image.open(BytesIO(base64.b64decode(body)))
    img.load()
    return img


def stored_files(flow) -> list[pathlib.Path]:
    return sorted(flow.design_dir.glob("*")) if flow.design_dir.exists() else []


async def word_filter(flow, term: str, action: str = "hold") -> None:
    await flow.db.settings.update_one({"id": "word_filter"}, {"$set": {
        "id": "word_filter", "enabled": True, "entries": [{"id": "w1", "term": term, "action": action}]}}, upsert=True)


# ---------------------------------------------------------------- Vorschau

@pytest.mark.asyncio
async def test_the_preview_shows_the_print_file_with_measures_and_stores_nothing(flow):
    await finance(flow)
    view = (await flow.get(BASE)).json()
    assert view["rules"]["text_height_in"] == 0.5 and view["rules"]["max_width_in"] == 3.5
    assert view["rules"]["dpi"] == 300 and view["rules"]["default_color"] == "vereinsblau"
    assert {font["key"] for font in view["fonts"]} >= {"rajdhani-700", "outfit-800"}
    assert all(font["license"].startswith("SIL Open Font License") for font in view["fonts"])

    answer = await flow.post(f"{BASE}/preview", json={"text": "  Testname "})
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["text"] == "Testname" and body["meta"]["scaled"] is False
    assert body["meta"]["measures"]["text_height"] == "0,5 Zoll (1,3 cm)"
    assert body["meta"]["measures"]["max_width"] == "3,5 Zoll (8,9 cm)"
    img = image_of(body["image"])
    assert img.size == (1050, body["meta"]["height_px"]) and img.info["dpi"] == pytest.approx((300, 300), abs=0.01)
    assert len(body["sha256"]) == 64

    shrunk = (await flow.post(f"{BASE}/preview", json={"text": "TestnameAB"})).json()
    assert shrunk["meta"]["scaled"] is True and "verkleinert" in shrunk["meta"]["notice"]
    wide = await flow.post(f"{BASE}/preview", json={"text": "WWWWWWWWWW"})
    assert wide.status_code == 400 and "zu breit" in wide.json()["detail"]
    emoji = await flow.post(f"{BASE}/preview", json={"text": "Test\U0001F981"})
    assert emoji.status_code == 400 and "Emojis" in emoji.json()["detail"]
    white = (await flow.post(f"{BASE}/preview", json={"text": "Testname", "color": "weiss"})).json()
    assert white["sha256"] != body["sha256"] and white["meta"]["color_hex"] == "#FFFFFF"

    assert await flow.db.shop_gamertag_files.count_documents({}) == 0 and stored_files(flow) == []
    assert await flow.db.audit_logs.count_documents({}) == 0


# ---------------------------------------------------------------- Testdatei als Version

@pytest.mark.asyncio
async def test_a_test_file_gets_a_checksum_and_a_secret_public_address_and_is_deterministic(flow):
    staff = await finance(flow)
    answer = await flow.post(f"{BASE}/test-files", json={"text": "Testname", "reason": "Testentwurf vorbereiten"})
    assert answer.status_code == 200, answer.text
    file = answer.json()["file"]
    assert file["origin"] == "gamertag" and file["purpose"] == "test"
    assert len(file["sha256"]) == 64 and file["public_path"].startswith("/api/shop/print-files/")
    assert file["anchor_y_in"] == pytest.approx(file["height_px"] / 2 / 300, abs=0.001)

    flow.act_as(None)  # Printful holt die Datei ohne Anmeldung
    fetched = await flow.get(file["public_path"])
    assert fetched.status_code == 200 and fetched.headers["content-type"] == "image/png"
    assert fetched.headers["x-content-type-options"] == "nosniff"
    import hashlib
    assert hashlib.sha256(fetched.content).hexdigest() == file["sha256"]
    public_id = file["public_path"].split("/")[4]
    assert (await flow.get(f"/api/shop/print-files/{public_id}/falsch.png")).status_code == 404
    assert (await flow.get(f"/api/shop/print-files/{'x' * 43}/{file['file_name']}")).status_code == 404

    flow.act_as(staff)
    again = (await flow.post(f"{BASE}/test-files", json={"text": " Testname", "reason": "Nochmal"})).json()["file"]
    assert again["sha256"] == file["sha256"] and again["public_path"] == file["public_path"]
    assert await flow.db.shop_gamertag_files.count_documents({}) == 1 and len(stored_files(flow)) == 1

    row = await flow.db.shop_gamertag_files.find_one({}, {"_id": 0})
    assert row["origin"] == "gamertag" and row["purpose"] == "test" and row["rules_hash"]
    assert "Testname" not in str(row)  # der Name steht nur in der Datei
    listed = (await flow.get(BASE)).json()["test_files"]
    assert [item["sha256"] for item in listed] == [file["sha256"]]


@pytest.mark.asyncio
async def test_an_order_can_freeze_file_and_name(flow):
    from services import shop_gamertag

    await finance(flow)
    rendered = await shop_gamertag.store(flow.db, "Testname", purpose="order")
    frozen = shop_gamertag.frozen_for_order(rendered["row"], rendered["text"])
    assert frozen["gamertag"] == "Testname"
    assert frozen["gamertag_file"]["sha256"] == rendered["row"]["sha256"]
    assert set(frozen["gamertag_file"]) >= {"file_id", "sha256", "rules_hash", "anchor_y_in", "color_key"}
    # Neue Regeln ändern die eingefrorene Datei nicht: dieselbe Zeile bleibt mit ihrer Prüfsumme liegen.
    await flow.put(BASE + "/rules", json={"dpi": 360, "reason": "Feiner drucken"})
    newer = await shop_gamertag.store(flow.db, "Testname", purpose="order")
    assert newer["row"]["sha256"] != rendered["row"]["sha256"]
    assert await flow.db.shop_gamertag_files.find_one({"sha256": rendered["row"]["sha256"]})
    # Eine Testdatei, die eine Bestellung braucht, ist keine Testdatei mehr.
    await flow.post(f"{BASE}/test-files", json={"text": "Testname", "reason": "Test"})
    row = await flow.db.shop_gamertag_files.find_one({"sha256": newer["row"]["sha256"]}, {"_id": 0})
    assert row["purpose"] == "order"


@pytest.mark.asyncio
async def test_retention_only_reports_unused_test_files(flow):
    from datetime import timedelta

    from models import now_utc
    from services import shop_gamertag

    await finance(flow)
    await flow.post(f"{BASE}/test-files", json={"text": "Testname", "reason": "Test"})
    await shop_gamertag.store(flow.db, "Testspieler", purpose="order")
    plan = await shop_gamertag.retention_plan(flow.db, now=now_utc() + timedelta(days=31))
    assert plan["may_delete"] and all(item["purpose"] == "test" for item in plan["may_delete"])
    assert len(plan["may_delete"]) == 1 and plan["kept"] == 1
    assert len(stored_files(flow)) == 2  # nur ein Bericht


# ---------------------------------------------------------------- Wortfilter und Log

@pytest.mark.asyncio
async def test_the_word_filter_of_the_moderation_runs_before_rendering(flow):
    await finance(flow)
    await word_filter(flow, "Schimpfwort")
    held = await flow.post(f"{BASE}/preview", json={"text": "Sch1mpfwort"})
    assert held.status_code == 400 and "nicht erlaubt" in held.json()["detail"]
    stored = await flow.post(f"{BASE}/test-files", json={"text": "Schimpfwort", "reason": "Test"})
    assert stored.status_code == 400 and stored_files(flow) == []

    await word_filter(flow, "Schimpfwort", action="flag")
    assert (await flow.post(f"{BASE}/preview", json={"text": "Schimpfwort"})).status_code == 400
    await flow.put(f"{BASE}/rules", json={"block_flagged": False, "reason": "Nur markieren"})
    flagged = await flow.post(f"{BASE}/preview", json={"text": "Schimpfwort"})
    assert flagged.status_code == 200 and flagged.json()["warnings"]
    assert await flow.db.moderation_items.count_documents({}) == 0  # der Admin-Test ist kein Fund


@pytest.mark.asyncio
async def test_the_name_never_appears_in_the_log_or_the_audit_trail(flow, caplog):
    from services import shop_gamertag

    await finance(flow)
    caplog.set_level(logging.DEBUG)
    await flow.post(f"{BASE}/preview", json={"text": SECRET_NAME})
    await flow.post(f"{BASE}/test-files", json={"text": SECRET_NAME, "reason": "Test"})
    await flow.post(f"{BASE}/preview", json={"text": SECRET_NAME + "$"})
    await shop_gamertag.store(flow.db, SECRET_NAME, purpose="order")
    assert SECRET_NAME not in caplog.text
    audit = await flow.db.audit_logs.find({}, {"_id": 0}).to_list(50)
    assert audit and SECRET_NAME not in str(audit)
    assert SECRET_NAME not in str(await flow.db.shop_gamertag_files.find({}, {"_id": 0}).to_list(50))


# ---------------------------------------------------------------- Regeln, Rechte, Protokoll

@pytest.mark.asyncio
async def test_rules_are_settings_with_reason_and_protocol(flow):
    staff = await finance(flow)
    no_reason = await flow.put(f"{BASE}/rules", json={"max_length": 12})
    blank = await flow.put(f"{BASE}/rules", json={"max_length": 12, "reason": "   "})
    assert (no_reason.status_code, blank.status_code) == (422, 400)

    changed = await flow.put(f"{BASE}/rules", json={"max_length": 12, "min_text_height_in": 0.45,
                                                     "reason": "Obmann bestätigt"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["changed"] == ["max_length", "min_text_height_in"]
    assert changed.json()["rules"]["max_length"] == 12
    same = await flow.put(f"{BASE}/rules", json={"max_length": 12, "reason": "Nochmal"})
    assert same.json()["changed"] == []

    too_wide = await flow.put(f"{BASE}/rules", json={"max_width_in": 6, "reason": "Breiter"})
    assert too_wide.status_code == 400 and "Druckbereich" in too_wide.json()["detail"]
    bad = await flow.put(f"{BASE}/rules", json={"min_text_height_in": 0.9, "reason": "Unsinn"})
    assert bad.status_code == 400 and "Mindesthöhe" in bad.json()["detail"]

    colors = [{"key": "weiss", "label": "Weiß", "hex": "#ffffff", "garment_colors": ["Schwarz"]},
              {"key": "vereinsblau", "label": "Vereinsblau", "hex": "#29B6E8", "garment_colors": ["Schwarz", "Weiß"]}]
    saved = await flow.put(f"{BASE}/rules", json={"colors": colors, "reason": "Farben je Shirt"})
    assert saved.status_code == 200 and saved.json()["rules"]["colors"][0]["hex"] == "#FFFFFF"

    rows = await flow.db.audit_logs.find({"action": "shop.gamertag.rules"}, {"_id": 0}).sort("created_at", 1).to_list(9)
    assert [row["data"]["reason"] for row in rows] == ["Obmann bestätigt", "Farben je Shirt"]
    assert rows[0]["actor_id"] == staff["id"]
    assert rows[0]["data"]["before"] == {"max_length": 16, "min_text_height_in": 0.4}
    assert rows[0]["data"]["after"] == {"max_length": 12, "min_text_height_in": 0.45}

    stored = await flow.post(f"{BASE}/test-files", json={"text": "Testname", "reason": "Für den Testentwurf"})
    logged = await flow.db.audit_logs.find_one({"action": "shop.gamertag.file"}, {"_id": 0})
    assert logged["data"]["sha256"] == stored.json()["file"]["sha256"] and logged["data"]["reason"] == "Für den Testentwurf"
    assert "public_id" not in str(logged)


@pytest.mark.asyncio
async def test_only_finance_with_a_second_factor_may_use_the_gamertag_routes(flow):
    staff = await finance(flow)

    async def every_route():
        return {
            "view": await flow.get(BASE),
            "preview": await flow.post(f"{BASE}/preview", json={"text": "Testname"}),
            "file": await flow.post(f"{BASE}/test-files", json={"text": "Testname", "reason": "Test"}),
            "rules": await flow.put(f"{BASE}/rules", json={"max_length": 10, "reason": "Test"}),
        }

    for role in ("player", "moderator", "tournament_admin"):
        flow.act_as(await flow.add_user(role=role))
        for route, answer in (await every_route()).items():
            assert answer.status_code == 403, (role, route, answer.text)
    flow.act_as({**staff, "auth_mfa_verified": False})
    for route, answer in (await every_route()).items():
        assert answer.status_code == 403 and "Zwei-Faktor" in answer.json()["detail"], (route, answer.text)
    flow.act_as(None)
    for route, answer in (await every_route()).items():
        assert answer.status_code == 401, (route, answer.text)
    assert await flow.db.shop_gamertag_files.count_documents({}) == 0
    assert await flow.db.audit_logs.count_documents({}) == 0
    for role in ("club_admin", "superadmin"):
        flow.act_as(await flow.add_user(role=role))
        assert (await flow.get(BASE)).status_code == 200


# ---------------------------------------------------------------- Vorbelegung aus der Mitgliederakte

@pytest.fixture
def fake(monkeypatch):
    from services import dolibarr_client, dolibarr_identity

    instance = FakeDolibarr()
    instance.methods = []

    def handle(request):
        instance.methods.append(request.method)
        return instance._handle(request)

    monkeypatch.setattr(dolibarr_client, "_transport", httpx.MockTransport(handle))
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    dolibarr_identity.reset_cache()
    return instance


async def connect(flow) -> None:
    from services.secret_store import encrypt_secret

    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": "live", "environment": "production", "base_url": BASE_URL,
        "api_key": encrypt_secret(API_KEY), "instance": "verein", "entity": 1, "type_map": {"2": "ordinary"},
    }}, upsert=True)


async def bound_member(flow, fake) -> dict:
    fake.add(member(12), email="testperson@example.test")
    fake.invite("CODE", 12, capabilities=("documents", "profile"))
    person = await flow.add_user(role="player", name="testperson")
    person["is_club_member"] = True
    flow.act_as(person)
    assert (await flow.post("/api/membership/me/identity", json={"code": "CODE"})).json()["status"] == "bound"
    return person


@pytest.mark.asyncio
async def test_the_gamertag_is_prefilled_from_the_member_file_and_never_written_back(flow, fake):
    from services import shop_gamertag

    await connect(flow)
    person = await bound_member(flow, fake)
    fake.member_profiles[12] = {"fields": [
        {"code": "gamertag", "label": "Gamertag", "type": "text", "editable": True, "value": " Testspieler ",
         "max_length": 40}]}
    fake.methods.clear()
    prefill = await shop_gamertag.prefill_from_member_file(flow.db, person)
    assert prefill["gamertag"] == "Testspieler" and prefill["source"] == "dolibarr"
    assert prefill["valid"] is True and prefill["as_of"]
    assert fake.methods and set(fake.methods) == {"GET"}  # der Shop schreibt nie zurück

    fake.member_profiles[12]["fields"][0]["value"] = "Test$piel"
    invalid = await shop_gamertag.prefill_from_member_file(flow.db, person)
    assert invalid["gamertag"] == "Test$piel" and invalid["valid"] is False and "„$“" in invalid["problem"]


@pytest.mark.asyncio
async def test_without_dolibarr_the_last_known_gamertag_with_its_date_is_used(flow, fake):
    from services import shop_gamertag

    await connect(flow)
    person = await bound_member(flow, fake)
    await flow.db.club_member_profiles.insert_one({
        "id": "p1", "user_id": person["id"], "dolibarr_member_id": 12, "gamertag": "Altname",
        "dolibarr_profile_at": "2026-10-01T08:00:00+00:00"})
    fake.fail_with = 503
    prefill = await shop_gamertag.prefill_from_member_file(flow.db, person)
    assert prefill["gamertag"] == "Altname" and prefill["source"] == "last_known"
    assert prefill["as_of"] == "2026-10-01T08:00:00+00:00" and "zuletzt bekannte" in prefill["text"]

    await flow.db.club_member_profiles.delete_many({})
    nothing = await shop_gamertag.prefill_from_member_file(flow.db, person)
    assert nothing["gamertag"] is None and nothing["source"] == "none"


@pytest.mark.asyncio
async def test_without_confirmed_link_there_is_no_prefill(flow, fake):
    from services import shop_gamertag

    await connect(flow)
    stranger = await flow.add_user(role="player", name="gast")
    await flow.db.club_member_profiles.insert_one({"id": "p2", "user_id": stranger["id"], "gamertag": "Fremdname"})
    prefill = await shop_gamertag.prefill_from_member_file(flow.db, stranger)
    assert prefill == {"gamertag": None, "source": "none", "as_of": None, "valid": False, "problem": None,
                       "text": prefill["text"]}
    assert "verbunden" in prefill["text"]
