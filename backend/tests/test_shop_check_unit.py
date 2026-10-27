"""Betrieb → Checks zeigt den Shop (#1706): Stufe, Notschalter, ob der Printful-Schlüssel hinterlegt ist, und die
Ursache, wenn der letzte Verbindungstest scheiterte. Gegen mongomock, ohne echten Schlüssel."""
import pytest
from mongomock_motor import AsyncMongoMockClient

from services import ops_checks
from services.secret_store import encrypt_secret


@pytest.fixture
def db():
    return AsyncMongoMockClient()["shop_check"]


async def settle(db, **fields) -> None:
    await db.settings.update_one({"id": "shop"}, {"$set": {"id": "shop", **fields}}, upsert=True)


@pytest.mark.asyncio
async def test_the_shop_check_shows_stage_switch_and_key(db):
    check = await ops_checks.check_shop(db)
    assert check["key"] == "shop" and check["label"] == "Shop" and check["status"] == "ok"
    assert check["value"] == "Aus · Notschalter aus · kein Schlüssel"

    await settle(db, stage="admins", orders_to_printful=True, printful_api_key=encrypt_secret("pf-test-nicht-echt"))
    check = await ops_checks.check_shop(db)
    assert check["status"] == "ok"
    assert check["value"] == "Nur Admins (Test) · Bestellungen an Printful an · Schlüssel hinterlegt"
    assert "pf-test-nicht-echt" not in str(check)


@pytest.mark.asyncio
async def test_a_failed_connection_test_shows_its_cause(db):
    await settle(db, printful_api_key=encrypt_secret("pf-test-nicht-echt"),
                 printful_last_test={"at": "2026-10-27T10:00:00+00:00", "ok": False,
                                     "detail": "Printful hat den Schlüssel abgelehnt (401)."})
    check = await ops_checks.check_shop(db)
    assert check["status"] == "warn" and "abgelehnt" in check["detail"]


@pytest.mark.asyncio
async def test_the_shop_check_turns_red_when_orders_go_out_without_a_readable_key(db):
    await settle(db, orders_to_printful=True, printful_api_key="enc:v1:kaputt")
    check = await ops_checks.check_shop(db)
    assert check["status"] == "crit" and "SETTINGS_ENCRYPTION_KEY" in check["detail"]
    await settle(db, orders_to_printful=False)
    assert (await ops_checks.check_shop(db))["status"] == "warn"
