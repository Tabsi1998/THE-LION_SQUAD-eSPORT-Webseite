"""Shop-Einstellungen im Admin (#1706): Stufe, Freigabe „Steuer geklärt“, Notschalter, Preise und Printful-Zugang.

Durch die echte Anwendung (flow_harness). Geprüft wird, wer was darf, was im Protokoll der Adminaktionen steht (Aktion
``shop.config``, immer mit Grund) und dass der Printful-Schlüssel nie in einer Antwort, einem Protokoll oder einem Log
auftaucht. Kein echter Schlüssel, keine echten Personen; Printful wird nie angerufen (httpx-Mock)."""
import logging
import pathlib
import sys

import httpx
import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

CONFIG = "/api/admin/shop/config"
FAKE_KEY = "pf-testschluessel-nicht-echt-0123456789"
CONFIG_LOG = {"action": "shop.config"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def people(flow) -> dict:
    player = await flow.add_user(role="player", name="spieler")
    member = await flow.add_user(role="player", name="mitglied")
    await flow.db.memberships.insert_one({"user_id": member["id"], "member_status": "active"})
    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    finance = await flow.add_user(role="player", name="kassier")
    await flow.db.users.update_one({"id": finance["id"]}, {"$set": {"areas": ["finance"]}})
    finance["areas"] = ["finance"]
    club_admin = await flow.add_user(role="club_admin", name="clubadmin")
    root = await flow.add_user(role="superadmin", name="root")
    return {"spieler": player, "mitglied": member, "turnierleitung": lead, "finanzen": finance,
            "club-admin": club_admin, "superadmin": root}


async def config_log(flow) -> list[dict]:
    return await flow.db.audit_logs.find(CONFIG_LOG, {"_id": 0}).sort("created_at", 1).to_list(50)


# ---------------------------------------------------------------- Lesen und Vorgaben

@pytest.mark.asyncio
async def test_the_defaults_are_safe_off_no_printful_no_markup_austria_only(flow):
    who = await people(flow)
    flow.act_as(who["finanzen"])
    answer = await flow.get(CONFIG)
    assert answer.status_code == 200, answer.text
    body = answer.json()
    config = body["config"]
    assert config["stage"] == "off" and config["orders_to_printful"] is False
    assert config["public_markup_cents"] == 0 and config["member_markup_cents"] == 0
    assert config["fallback_shipping_cents"] is None
    assert config["shipping_countries"] == ["AT"]
    assert config["tax_cleared"] is None
    assert config["printful_key"]["state"] == "missing"
    assert [stage["key"] for stage in body["stages"]] == ["off", "admins", "members", "public"]
    public = body["stages"][-1]
    assert public["locked"] is True and "Steuer" in public["lock_reason"]
    assert body["rights"] == {"can_set_public": False, "can_set_tax": False, "can_edit_access": False}
    # Lesen ist keine Adminaktion.
    assert await config_log(flow) == []


@pytest.mark.asyncio
async def test_only_finance_reaches_the_shop_settings(flow):
    who = await people(flow)
    for name in ("spieler", "mitglied", "turnierleitung"):
        flow.act_as(who[name])
        for answer in (await flow.get(CONFIG),
                       await flow.patch(CONFIG, json={"stage": "admins", "reason": "Test"}),
                       await flow.put(f"{CONFIG}/tax-clearance", json={"cleared": True, "reason": "Test"}),
                       await flow.put(f"{CONFIG}/printful-key", json={"api_key": FAKE_KEY, "reason": "Test"}),
                       await flow.post(f"{CONFIG}/printful-key/remove", json={"reason": "Test"}),
                       await flow.post(f"{CONFIG}/printful-test")):
            assert answer.status_code == 403, (name, answer.text)
    flow.act_as({**who["superadmin"], "auth_mfa_verified": False})
    assert (await flow.get(CONFIG)).status_code == 403
    flow.act_as(None)
    assert (await flow.get(CONFIG)).status_code == 401
    assert await config_log(flow) == []


# ---------------------------------------------------------------- Stufen

@pytest.mark.asyncio
async def test_finance_switches_between_off_admins_and_members_and_each_change_is_logged(flow):
    who = await people(flow)
    flow.act_as(who["finanzen"])
    for stage in ("admins", "members", "off"):
        answer = await flow.patch(CONFIG, json={"stage": stage, "reason": f"Umstellen auf {stage}"})
        assert answer.status_code == 200, answer.text
        assert answer.json()["config"]["stage"] == stage
    rows = await config_log(flow)
    assert [(row["data"]["before"], row["data"]["after"]) for row in rows] == [
        ({"stage": "off"}, {"stage": "admins"}), ({"stage": "admins"}, {"stage": "members"}),
        ({"stage": "members"}, {"stage": "off"})]
    assert all(row["actor_id"] == who["finanzen"]["id"] and row["target_id"] == "shop" for row in rows)
    assert rows[0]["data"]["reason"] == "Umstellen auf admins"


@pytest.mark.asyncio
async def test_a_change_needs_a_reason_and_unknown_values_are_refused(flow):
    who = await people(flow)
    flow.act_as(who["finanzen"])
    answers = [await flow.patch(CONFIG, json={"stage": "admins"}),
               await flow.patch(CONFIG, json={"stage": "admins", "reason": "  "}),
               await flow.patch(CONFIG, json={"stage": "live", "reason": "Test"}),
               await flow.patch(CONFIG, json={"public_markup_cents": -1, "reason": "Test"}),
               await flow.patch(CONFIG, json={"public_markup_cents": 10_001, "reason": "Test"}),
               await flow.patch(CONFIG, json={"fallback_shipping_cents": 0, "reason": "Test"}),
               await flow.patch(CONFIG, json={"shipping_countries": ["DE"], "reason": "Test"}),
               await flow.patch(CONFIG, json={"member_markup_cents": 100, "reason": "Test"}),
               await flow.patch(CONFIG, json={"orders_to_printful": "ja", "reason": "Test"})]
    assert [answer.status_code for answer in answers] == [422] * len(answers)
    assert await config_log(flow) == []


@pytest.mark.asyncio
async def test_an_unchanged_save_writes_nothing(flow):
    who = await people(flow)
    flow.act_as(who["finanzen"])
    answer = await flow.patch(CONFIG, json={"stage": "off", "public_markup_cents": 0, "reason": "Nur gespeichert"})
    assert answer.status_code == 200 and answer.json()["changed"] == []
    assert await config_log(flow) == []


@pytest.mark.asyncio
async def test_public_needs_the_superadmin_and_the_tax_clearance(flow):
    who = await people(flow)
    for name in ("finanzen", "club-admin"):
        flow.act_as(who[name])
        refused = await flow.patch(CONFIG, json={"stage": "public", "reason": "Alle sollen kaufen"})
        assert refused.status_code == 403, (name, refused.text)
        assert "Superadmin" in refused.json()["detail"]

    flow.act_as(who["superadmin"])
    without_tax = await flow.patch(CONFIG, json={"stage": "public", "reason": "Alle sollen kaufen"})
    assert without_tax.status_code == 409, without_tax.text
    assert "Steuer" in without_tax.json()["detail"]
    assert (await flow.get(CONFIG)).json()["config"]["stage"] == "off"
    assert await config_log(flow) == []

    cleared = await flow.put(f"{CONFIG}/tax-clearance", json={"cleared": True, "reason": "Steuerberatung bestätigt"})
    assert cleared.status_code == 200, cleared.text
    view = cleared.json()
    assert view["config"]["tax_cleared"]["by"] == "root" and view["config"]["tax_cleared"]["reason"]
    assert view["stages"][-1]["locked"] is False
    assert view["rights"]["can_set_public"] is True

    public = await flow.patch(CONFIG, json={"stage": "public", "reason": "Freigabe Obmann"})
    assert public.status_code == 200, public.text
    assert public.json()["config"]["stage"] == "public"

    # Zurück geht es für die Finanzen jederzeit - Abschalten ist nie gesperrt.
    flow.act_as(who["finanzen"])
    view = (await flow.get(CONFIG)).json()
    assert view["stages"][-1]["locked"] is True and "Superadmin" in view["stages"][-1]["lock_reason"]
    down = await flow.patch(CONFIG, json={"stage": "members", "reason": "Rückfrage Steuer"})
    assert down.status_code == 200, down.text

    rows = await config_log(flow)
    assert [row["data"].get("after") for row in rows] == [{"tax_cleared": True}, {"stage": "public"},
                                                          {"stage": "members"}]


@pytest.mark.asyncio
async def test_only_the_superadmin_sets_the_tax_clearance_and_never_without_reason(flow):
    who = await people(flow)
    for name in ("finanzen", "club-admin"):
        flow.act_as(who[name])
        answer = await flow.put(f"{CONFIG}/tax-clearance", json={"cleared": True, "reason": "Passt schon"})
        assert answer.status_code == 403, (name, answer.text)
    flow.act_as(who["superadmin"])
    assert (await flow.put(f"{CONFIG}/tax-clearance", json={"cleared": True})).status_code == 422
    assert (await flow.put(f"{CONFIG}/tax-clearance", json={"cleared": True, "reason": " "})).status_code == 422
    assert await config_log(flow) == []


@pytest.mark.asyncio
async def test_the_tax_clearance_cannot_be_withdrawn_while_the_shop_is_public(flow):
    who = await people(flow)
    flow.act_as(who["superadmin"])
    await flow.put(f"{CONFIG}/tax-clearance", json={"cleared": True, "reason": "Steuerberatung bestätigt"})
    await flow.patch(CONFIG, json={"stage": "public", "reason": "Freigabe Obmann"})
    refused = await flow.put(f"{CONFIG}/tax-clearance", json={"cleared": False, "reason": "Neue Rückfrage"})
    assert refused.status_code == 409 and "Stufe" in refused.json()["detail"]
    await flow.patch(CONFIG, json={"stage": "members", "reason": "Rückfrage"})
    withdrawn = await flow.put(f"{CONFIG}/tax-clearance", json={"cleared": False, "reason": "Neue Rückfrage"})
    assert withdrawn.status_code == 200 and withdrawn.json()["config"]["tax_cleared"] is None


# ---------------------------------------------------------------- Preise

@pytest.mark.asyncio
async def test_prices_markup_and_fallback_shipping_are_saved_with_before_and_after(flow):
    who = await people(flow)
    flow.act_as(who["finanzen"])
    answer = await flow.patch(CONFIG, json={"public_markup_cents": 300, "fallback_shipping_cents": 690,
                                            "reason": "Vorstandsbeschluss Aufschlag"})
    assert answer.status_code == 200, answer.text
    config = answer.json()["config"]
    assert config["public_markup_cents"] == 300 and config["fallback_shipping_cents"] == 690
    assert config["member_markup_cents"] == 0
    rows = await config_log(flow)
    assert len(rows) == 1
    assert rows[0]["data"]["before"] == {"public_markup_cents": 0, "fallback_shipping_cents": None}
    assert rows[0]["data"]["after"] == {"public_markup_cents": 300, "fallback_shipping_cents": 690}
    cleared = await flow.patch(CONFIG, json={"fallback_shipping_cents": None, "reason": "Keine Pauschale"})
    assert cleared.json()["config"]["fallback_shipping_cents"] is None


# ---------------------------------------------------------------- Printful-Zugang und Notschalter

@pytest.mark.asyncio
async def test_the_printful_key_is_stored_encrypted_and_never_shown_again(flow, caplog):
    caplog.set_level(logging.DEBUG)
    who = await people(flow)
    flow.act_as(who["finanzen"])
    refused = await flow.put(f"{CONFIG}/printful-key", json={"api_key": FAKE_KEY, "reason": "Zugang hinterlegen"})
    assert refused.status_code == 403 and "System" in refused.json()["detail"]

    flow.act_as(who["club-admin"])
    short = await flow.put(f"{CONFIG}/printful-key", json={"api_key": "kurz", "reason": "Zugang hinterlegen"})
    assert short.status_code == 422
    saved = await flow.put(f"{CONFIG}/printful-key", json={"api_key": f"  {FAKE_KEY} ", "reason": "Zugang hinterlegen"})
    assert saved.status_code == 200, saved.text
    key = saved.json()["config"]["printful_key"]
    assert key["state"] == "ok" and key["saved_at"] and key["saved_by"] == "clubadmin"

    stored = await flow.db.settings.find_one({"id": "shop"}, {"_id": 0})
    assert FAKE_KEY not in str(stored) and stored["printful_api_key"].startswith("enc:v1:")
    from services import shop_config

    assert await shop_config.printful_api_key(flow.db) == FAKE_KEY

    flow.act_as(who["finanzen"])
    seen = await flow.get(CONFIG)
    assert FAKE_KEY not in seen.text and "enc:v1" not in seen.text
    rows = await config_log(flow)
    assert [row["data"]["after"] for row in rows] == [{"printful_key": "hinterlegt"}]
    assert FAKE_KEY not in str(rows) and "enc:v1" not in str(rows)
    assert FAKE_KEY not in caplog.text


@pytest.mark.asyncio
async def test_the_emergency_switch_needs_a_key_and_removing_the_key_turns_it_off(flow):
    who = await people(flow)
    flow.act_as(who["finanzen"])
    without_key = await flow.patch(CONFIG, json={"orders_to_printful": True, "reason": "Produktion starten"})
    assert without_key.status_code == 409 and "Schlüssel" in without_key.json()["detail"]

    flow.act_as(who["superadmin"])
    await flow.put(f"{CONFIG}/printful-key", json={"api_key": FAKE_KEY, "reason": "Zugang hinterlegen"})
    flow.act_as(who["finanzen"])
    on = await flow.patch(CONFIG, json={"orders_to_printful": True, "reason": "Produktion starten"})
    assert on.status_code == 200 and on.json()["config"]["orders_to_printful"] is True
    # Der Notschalter hängt nicht an der Stufe: der Shop bleibt aus.
    assert on.json()["config"]["stage"] == "off"

    flow.act_as(who["superadmin"])
    removed = await flow.post(f"{CONFIG}/printful-key/remove", json={"reason": "Schlüssel ausgetauscht"})
    assert removed.status_code == 200, removed.text
    config = removed.json()["config"]
    assert config["printful_key"]["state"] == "missing" and config["orders_to_printful"] is False
    last = (await config_log(flow))[-1]
    assert last["data"]["before"] == {"printful_key": "hinterlegt", "orders_to_printful": True}
    assert last["data"]["after"] == {"printful_key": "entfernt", "orders_to_printful": False}


@pytest.mark.asyncio
async def test_the_connection_test_reads_once_and_never_shows_the_key(flow, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    from services import printful_client

    seen: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"data": [{"id": 1, "type": "native", "name": "Teststore"}]})

    monkeypatch.setattr(printful_client, "TRANSPORT", httpx.MockTransport(answer))
    who = await people(flow)
    flow.act_as(who["finanzen"])
    missing = await flow.post(f"{CONFIG}/printful-test")
    assert missing.status_code == 409 and seen == []

    flow.act_as(who["superadmin"])
    await flow.put(f"{CONFIG}/printful-key", json={"api_key": FAKE_KEY, "reason": "Zugang hinterlegen"})
    flow.act_as(who["finanzen"])
    tested = await flow.post(f"{CONFIG}/printful-test")
    assert tested.status_code == 200, tested.text
    result = tested.json()["result"]
    assert result["ok"] is True and "1 Store" in result["detail"]
    assert [request.method for request in seen] == ["GET"]
    assert str(seen[0].url) == "https://api.printful.com/v2/stores"
    assert seen[0].headers["authorization"] == f"Bearer {FAKE_KEY}"
    assert FAKE_KEY not in tested.text and FAKE_KEY not in caplog.text
    assert tested.json()["config"]["printful_last_test"]["ok"] is True


@pytest.mark.asyncio
async def test_a_refused_key_shows_up_as_the_cause(flow, monkeypatch):
    from services import printful_client

    monkeypatch.setattr(printful_client, "TRANSPORT",
                        httpx.MockTransport(lambda request: httpx.Response(401, json={"code": 401})))
    who = await people(flow)
    flow.act_as(who["superadmin"])
    await flow.put(f"{CONFIG}/printful-key", json={"api_key": FAKE_KEY, "reason": "Zugang hinterlegen"})
    tested = await flow.post(f"{CONFIG}/printful-test")
    assert tested.status_code == 200
    assert tested.json()["result"] == {**tested.json()["result"], "ok": False}
    assert "abgelehnt" in tested.json()["result"]["detail"]
    assert tested.json()["config"]["printful_last_test"]["ok"] is False
