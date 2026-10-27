"""Migration des Shop-Datenmodells (#1703): Trockenlauf, Anlegen, Rückweg.

Die Indizes stehen in ``database.AUDIT_UNIQUE_INDEXES`` bzw. ``AUDIT_INDEXES`` - so kennt sie die Prüfung „Eindeutige
Indizes“ unter Betrieb → Checks. Der Trockenlauf liest nur; der Rückweg entfernt die Shop-Indizes nur, solange keine
Shop-Sammlung Daten hat, und trägt die Migration aus, damit sie beim nächsten Start wieder läuft."""
import pytest
from mongomock_motor import AsyncMongoMockClient

import database
from services import migrations, shop_schema, unique_duplicates


@pytest.fixture
def db():
    return AsyncMongoMockClient()["shop_migration"]


def test_the_shop_indexes_are_part_of_the_audit_lists_and_known_to_the_checks():
    unique = {f"{collection}.{name}" for collection, _keys, name, _options in shop_schema.unique_indexes()}
    assert {"shop_orders.idempotency_key", "shop_orders.printful_external_id", "shop_order_events.order_event",
            "shop_order_items.order_position", "shop_products.slug", "shop_variants.sku",
            "shop_designs.design_version", "shop_designs.public_id", "shop_design_profiles.design_key",
            "shop_design_colors.placement_color", "shop_printful_variants.provider_variant", "shop_carts.user",
            "shop_printful_drafts.external_id", "shop_printful_confirmations.order",
            "shop_printful_confirmations.idempotency_key", "shop_gamertag_files.test_sha256",
            "shop_gamertag_files.public_id"} == unique
    assert unique <= set(unique_duplicates.known_indexes())
    # Claims belegen, dass etwas an Printful ging: auch sie bereinigt nie das Werkzeug.
    for index in ("shop_printful_drafts.external_id", "shop_printful_confirmations.order",
                  "shop_printful_confirmations.idempotency_key"):
        assert index in unique_duplicates.MANUAL
    # Bestellungen, Positionen und Ereignisse sind Nachweise: Dubletten bereinigt nie das Werkzeug.
    for index in ("shop_orders.idempotency_key", "shop_orders.printful_external_id", "shop_order_events.order_event",
                  "shop_order_items.order_position"):
        assert index in unique_duplicates.MANUAL
    assert all(collection.startswith("shop_") for collection, *_ in shop_schema.unique_indexes())


def test_the_migration_is_registered_once_after_the_existing_ones():
    versions = [version for version, _name, _run in migrations.MIGRATIONS]
    assert versions == sorted(versions) and len(versions) == len(set(versions))
    entry = [row for row in migrations.MIGRATIONS if row[1] == "shop_data_model"]
    assert entry and entry[0][0] == shop_schema.MIGRATION_VERSION == max(versions)


@pytest.mark.asyncio
async def test_the_dry_run_only_reads_and_names_what_is_missing(db):
    report = await shop_schema.plan(db)
    assert report["missing_unique"] == sorted(f"{c}.{n}" for c, _k, n, _o in shop_schema.unique_indexes())
    assert report["missing_plain"] and report["documents"] == {}
    assert await db.list_collection_names() == []


@pytest.mark.asyncio
async def test_there_and_back_again(db):
    result = await migrations.MIGRATIONS[-1][2](db)
    assert "shop indexes ready" in result
    report = await shop_schema.plan(db)
    assert report["missing_unique"] == [] and report["missing_plain"] == []
    assert await database.blocked_unique_indexes(db) == [
        f"{c}.{n}" for c, _k, n, _o in database.AUDIT_UNIQUE_INDEXES if not c.startswith("shop_")]
    # Ein zweiter Lauf ändert nichts.
    assert "shop indexes ready" in await shop_schema.apply(db)
    await db.schema_migrations.insert_one({"version": shop_schema.MIGRATION_VERSION, "name": "shop_data_model"})

    # Rückweg im Trockenlauf: nichts passiert.
    preview = await shop_schema.rollback(db)
    assert preview["applied"] is False and preview["blocked_by"] == {} and preview["drop"]
    assert (await shop_schema.plan(db))["missing_unique"] == []

    # Rückweg ausgeführt: Indizes weg, Migration ausgetragen.
    done = await shop_schema.rollback(db, apply=True)
    assert done["applied"] is True
    report = await shop_schema.plan(db)
    assert report["missing_unique"] and report["missing_plain"]
    assert await db.schema_migrations.count_documents({"version": shop_schema.MIGRATION_VERSION}) == 0

    # Und wieder hin.
    await shop_schema.apply(db)
    assert (await shop_schema.plan(db))["missing_unique"] == []


@pytest.mark.asyncio
async def test_the_way_back_refuses_while_shop_data_exists(db):
    await shop_schema.apply(db)
    await db.shop_products.insert_one({"id": "p1", "slug": "test", "title": "Test"})
    preview = await shop_schema.rollback(db, apply=True)
    assert preview["applied"] is False and preview["blocked_by"] == {"shop_products": 1}
    assert (await shop_schema.plan(db))["missing_unique"] == []
    assert (await shop_schema.plan(db))["documents"] == {"shop_products": 1}


@pytest.mark.asyncio
async def test_the_command_line_tool_reads_by_default(db, capsys):
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "scripts" / "shop_schema.py"
    spec = importlib.util.spec_from_file_location("shop_schema_cli", path)
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    assert await cli.main([], db=db) == 0
    assert "fehlt" in capsys.readouterr().out
    assert await db.list_collection_names() == []
    assert await cli.main(["--anwenden"], db=db) == 0
    assert (await shop_schema.plan(db))["missing_unique"] == []
    assert await cli.main(["--abbauen"], db=db) == 0
    assert (await shop_schema.plan(db))["missing_unique"] == [], "--abbauen ohne --anwenden ist ein Trockenlauf"
    assert await cli.main(["--abbauen", "--anwenden"], db=db) == 0
    assert (await shop_schema.plan(db))["missing_unique"]
