"""Single source of truth for tournament-format capabilities.

This catalog intentionally describes both the current execution path and the
canonical target.  Keeping those concerns separate lets us consolidate the two
active match engines without silently moving existing tournaments to another
write model.
"""

from dataclasses import asdict, dataclass
from types import MappingProxyType
from typing import Literal


InitialPreviewEngine = Literal["legacy", "stage", "none"]
RebuildEngine = Literal["legacy", "stage", "none"]
CanonicalMatchType = Literal["duel", "ffa"]
ResultModel = Literal["duel_score", "ranking", "standings", "time"]
PairingMode = Literal["static_graph", "scheduled_rounds", "dynamic_rounds", "ranking_series"]
AutoMatchLimit = Literal["legacy_estimate", "none"]
CurrentWriteModel = Literal["classic", "graph", "external"]


@dataclass(frozen=True, slots=True)
class TournamentFormatCapability:
    """Current and target capabilities of one public tournament format.

    ``canonical_write_ready`` is deliberately stricter than "a generator
    exists".  It may only become true after result reporting, forfeit/dispute,
    standings and downstream consumers have parity on the canonical path.
    """

    key: str
    label: str
    canonical_stage_type: str
    canonical_match_type: CanonicalMatchType
    result_model: ResultModel
    pairing_mode: PairingMode
    current_write_model: CurrentWriteModel
    initial_preview_engine: InitialPreviewEngine
    rebuild_engine: RebuildEngine
    stage_generator_available: bool
    auto_match_limit: AutoMatchLimit
    canonical_write_ready: bool
    migration_note: str

    def public_dict(self) -> dict:
        return asdict(self)


_FORMAT_CAPABILITIES = {
    "single_elim": TournamentFormatCapability(
        key="single_elim",
        label="Single Elimination",
        canonical_stage_type="single_elimination",
        canonical_match_type="duel",
        result_model="duel_score",
        pairing_mode="static_graph",
        current_write_model="graph",
        initial_preview_engine="stage",
        rebuild_engine="stage",
        stage_generator_available=True,
        auto_match_limit="legacy_estimate",
        canonical_write_ready=True,
        migration_note="Starts and stays in the stage graph; the classic store no longer sees this format.",
    ),
    "double_elim": TournamentFormatCapability(
        key="double_elim",
        label="Double Elimination",
        canonical_stage_type="double_elimination",
        canonical_match_type="duel",
        result_model="duel_score",
        pairing_mode="static_graph",
        current_write_model="graph",
        initial_preview_engine="stage",
        rebuild_engine="stage",
        stage_generator_available=True,
        auto_match_limit="legacy_estimate",
        canonical_write_ready=True,
        migration_note="Starts and stays in the stage graph; the classic store no longer sees this format.",
    ),
    "round_robin": TournamentFormatCapability(
        key="round_robin",
        label="Round Robin",
        canonical_stage_type="round_robin_groups",
        canonical_match_type="duel",
        result_model="standings",
        pairing_mode="scheduled_rounds",
        current_write_model="graph",
        initial_preview_engine="stage",
        rebuild_engine="stage",
        stage_generator_available=True,
        auto_match_limit="legacy_estimate",
        canonical_write_ready=True,
        migration_note="One group of the group-stage generator; the classic store no longer sees this format.",
    ),
    "swiss": TournamentFormatCapability(
        key="swiss",
        label="Swiss",
        canonical_stage_type="swiss",
        canonical_match_type="duel",
        result_model="standings",
        pairing_mode="dynamic_rounds",
        current_write_model="graph",
        initial_preview_engine="none",
        rebuild_engine="none",
        stage_generator_available=False,
        auto_match_limit="none",
        canonical_write_ready=True,
        migration_note=(
            "No declarative schema on purpose - each round depends on the previous one, so the "
            "structure grows round by round and there is nothing to preview before round one."
        ),
    ),
    "groups": TournamentFormatCapability(
        key="groups",
        label="Gruppen",
        canonical_stage_type="round_robin_groups",
        canonical_match_type="duel",
        result_model="standings",
        pairing_mode="scheduled_rounds",
        current_write_model="graph",
        initial_preview_engine="stage",
        rebuild_engine="stage",
        stage_generator_available=True,
        auto_match_limit="none",
        canonical_write_ready=True,
        migration_note="Group stage as a schema, seeded in snake order across the groups.",
    ),
    "ffa": TournamentFormatCapability(
        key="ffa",
        label="Free for All",
        canonical_stage_type="simple",
        canonical_match_type="ffa",
        result_model="ranking",
        pairing_mode="ranking_series",
        current_write_model="graph",
        initial_preview_engine="stage",
        rebuild_engine="stage",
        stage_generator_available=True,
        auto_match_limit="none",
        canonical_write_ready=True,
        migration_note="Stage-native from the start; never touched the classic store.",
    ),
    "battle_royale": TournamentFormatCapability(
        key="battle_royale",
        label="Battle Royale",
        canonical_stage_type="simple",
        canonical_match_type="ffa",
        result_model="ranking",
        pairing_mode="ranking_series",
        current_write_model="graph",
        initial_preview_engine="stage",
        rebuild_engine="stage",
        stage_generator_available=True,
        auto_match_limit="none",
        canonical_write_ready=True,
        migration_note="Stage-native from the start; never touched the classic store.",
    ),
    "league": TournamentFormatCapability(
        key="league",
        label="Liga",
        canonical_stage_type="league",
        canonical_match_type="duel",
        result_model="standings",
        pairing_mode="scheduled_rounds",
        current_write_model="graph",
        initial_preview_engine="stage",
        rebuild_engine="stage",
        stage_generator_available=True,
        auto_match_limit="legacy_estimate",
        canonical_write_ready=True,
        migration_note="Double round robin as a schema; the classic store no longer sees this format.",
    ),
    "time_trial": TournamentFormatCapability(
        key="time_trial",
        label="Time Trial",
        canonical_stage_type="simple",
        canonical_match_type="ffa",
        result_model="time",
        pairing_mode="ranking_series",
        current_write_model="external",
        initial_preview_engine="none",
        rebuild_engine="none",
        stage_generator_available=False,
        auto_match_limit="none",
        canonical_write_ready=False,
        migration_note="No tournament bracket generator is wired for this format yet.",
    ),
    "grand_prix": TournamentFormatCapability(
        key="grand_prix",
        label="Grand Prix",
        canonical_stage_type="ffa_league",
        canonical_match_type="ffa",
        result_model="ranking",
        pairing_mode="ranking_series",
        current_write_model="external",
        initial_preview_engine="none",
        rebuild_engine="none",
        stage_generator_available=False,
        auto_match_limit="none",
        canonical_write_ready=False,
        migration_note="A multi-round ranking-series strategy is still required.",
    ),
    "custom_bracket": TournamentFormatCapability(
        key="custom_bracket",
        label="Freier Turnierbaum",
        canonical_stage_type="custom_bracket",
        canonical_match_type="duel",
        result_model="duel_score",
        pairing_mode="static_graph",
        current_write_model="graph",
        initial_preview_engine="stage",
        rebuild_engine="stage",
        stage_generator_available=True,
        auto_match_limit="none",
        canonical_write_ready=True,
        migration_note="Stage-native from the start; never touched the classic store.",
    ),
    "ffa_custom_bracket": TournamentFormatCapability(
        key="ffa_custom_bracket",
        label="Freier FFA-Turnierbaum",
        canonical_stage_type="ffa_custom_bracket",
        canonical_match_type="ffa",
        result_model="ranking",
        pairing_mode="static_graph",
        current_write_model="graph",
        initial_preview_engine="stage",
        rebuild_engine="stage",
        stage_generator_available=True,
        auto_match_limit="none",
        canonical_write_ready=True,
        migration_note="Stage-native from the start; never touched the classic store.",
    ),
}


FORMAT_CAPABILITIES = MappingProxyType(_FORMAT_CAPABILITIES)


def find_format_capability(format_key: str | None) -> TournamentFormatCapability | None:
    """Return a catalog entry without failing on historical unknown values."""

    return FORMAT_CAPABILITIES.get(format_key or "single_elim")


def get_format_capability(format_key: str | None) -> TournamentFormatCapability:
    """Return the catalog entry, using the model's historical default."""

    key = format_key or "single_elim"
    capability = find_format_capability(key)
    if capability is None:
        raise ValueError(f"Unknown tournament format: {key}")
    return capability


def list_format_capabilities() -> tuple[TournamentFormatCapability, ...]:
    return tuple(FORMAT_CAPABILITIES.values())
