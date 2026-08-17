import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from services.competition_versions import (
    CURRENT_RULESET_VERSION,
    ENGINE_VERSION_BY_WRITE_MODEL,
    UNVERSIONED_ENGINE_VERSION,
    UNVERSIONED_RULESET_VERSION,
    apply_competition_version_read_defaults,
    new_competition_version_fields,
    persist_competition_versions,
)


def test_new_competitions_pin_the_catalog_write_model():
    assert new_competition_version_fields("single_elim") == {
        "engine_version": ENGINE_VERSION_BY_WRITE_MODEL["classic"],
        "ruleset_version": CURRENT_RULESET_VERSION,
    }
    assert new_competition_version_fields("ffa_custom_bracket")["engine_version"] == (
        ENGINE_VERSION_BY_WRITE_MODEL["graph"]
    )
    assert new_competition_version_fields("time_trial")["engine_version"] == (
        ENGINE_VERSION_BY_WRITE_MODEL["external"]
    )


def test_historical_missing_versions_are_marked_unversioned_without_guessing():
    tournament = {
        "id": "historical",
        "format": "single_elim",
        "engine_version": None,
        "ruleset_version": "",
    }

    assert apply_competition_version_read_defaults(tournament) == {
        "id": "historical",
        "format": "single_elim",
        "engine_version": UNVERSIONED_ENGINE_VERSION,
        "ruleset_version": UNVERSIONED_RULESET_VERSION,
        "version_inferred": True,
    }


def test_explicit_versions_are_not_reported_as_inferred():
    tournament = {
        "engine_version": ENGINE_VERSION_BY_WRITE_MODEL["graph"],
        "ruleset_version": CURRENT_RULESET_VERSION,
    }

    apply_competition_version_read_defaults(tournament)

    assert tournament["version_inferred"] is False


def test_successful_write_pins_actual_engine_and_preserves_ruleset_version():
    update_one = AsyncMock()
    db = SimpleNamespace(tournaments=SimpleNamespace(update_one=update_one))
    tournament = {
        "id": "t1",
        "engine_version": ENGINE_VERSION_BY_WRITE_MODEL["classic"],
        "ruleset_version": "competition.ruleset.custom-v7",
    }

    fields = asyncio.run(persist_competition_versions(db, tournament, "graph"))

    assert fields == {
        "engine_version": ENGINE_VERSION_BY_WRITE_MODEL["graph"],
        "ruleset_version": "competition.ruleset.custom-v7",
    }
    update_one.assert_awaited_once_with(
        {"id": "t1"},
        {"$set": {"engine_version": ENGINE_VERSION_BY_WRITE_MODEL["graph"]}},
    )
