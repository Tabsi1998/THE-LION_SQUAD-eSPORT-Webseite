"""Persisted version contract for competition write models and rulesets."""

from __future__ import annotations

from typing import Literal

from services.competition_formats import find_format_capability


CompetitionWriteModel = Literal["classic", "graph", "external"]

ENGINE_VERSION_BY_WRITE_MODEL = {
    "classic": "competition.classic.v1",
    "graph": "competition.graph.v1",
    "external": "competition.external.v1",
}
CURRENT_RULESET_VERSION = "competition.ruleset.v1"
UNVERSIONED_ENGINE_VERSION = "competition.unversioned"
UNVERSIONED_RULESET_VERSION = "competition.ruleset.unversioned"


def new_competition_version_fields(format_key: str | None) -> dict[str, str]:
    """Return explicit versions for a newly created competition."""

    capability = find_format_capability(format_key)
    engine_version = (
        ENGINE_VERSION_BY_WRITE_MODEL[capability.current_write_model]
        if capability
        else UNVERSIONED_ENGINE_VERSION
    )
    return {
        "engine_version": engine_version,
        "ruleset_version": CURRENT_RULESET_VERSION,
    }


def competition_version_fields_for_write(
    tournament: dict,
    write_model: CompetitionWriteModel,
) -> dict[str, str]:
    """Resolve versions after a concrete write model successfully produced data."""

    return {
        "engine_version": ENGINE_VERSION_BY_WRITE_MODEL[write_model],
        "ruleset_version": tournament.get("ruleset_version") or CURRENT_RULESET_VERSION,
    }


def apply_competition_version_read_defaults(tournament: dict) -> dict:
    """Expose missing historical versions without pretending that they were inferred."""

    inferred = not tournament.get("engine_version") or not tournament.get("ruleset_version")
    if not tournament.get("engine_version"):
        tournament["engine_version"] = UNVERSIONED_ENGINE_VERSION
    if not tournament.get("ruleset_version"):
        tournament["ruleset_version"] = UNVERSIONED_RULESET_VERSION
    tournament["version_inferred"] = inferred
    return tournament


async def persist_competition_versions(
    db,
    tournament: dict,
    write_model: CompetitionWriteModel,
) -> dict[str, str]:
    """Pin the actual write model after a successful structure write."""

    fields = competition_version_fields_for_write(tournament, write_model)
    changes = {key: value for key, value in fields.items() if tournament.get(key) != value}
    if changes:
        await db.tournaments.update_one({"id": tournament["id"]}, {"$set": changes})
        tournament.update(changes)
    return fields
