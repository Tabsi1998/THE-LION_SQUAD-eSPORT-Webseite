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
        initial_preview_engine="legacy",
        rebuild_engine="stage",
        stage_generator_available=True,
        auto_match_limit="legacy_estimate",
        canonical_write_ready=False,
        migration_note="Stage graph exists; reporting and downstream-consumer parity are still required.",
    ),
    "double_elim": TournamentFormatCapability(
        key="double_elim",
        label="Double Elimination",
        canonical_stage_type="double_elimination",
        canonical_match_type="duel",
        result_model="duel_score",
        pairing_mode="static_graph",
        initial_preview_engine="legacy",
        rebuild_engine="stage",
        stage_generator_available=True,
        auto_match_limit="legacy_estimate",
        canonical_write_ready=False,
        migration_note="Grand-final reset and bye/loser-flow parity are not complete.",
    ),
    "round_robin": TournamentFormatCapability(
        key="round_robin",
        label="Round Robin",
        canonical_stage_type="round_robin_groups",
        canonical_match_type="duel",
        result_model="standings",
        pairing_mode="scheduled_rounds",
        initial_preview_engine="legacy",
        rebuild_engine="legacy",
        stage_generator_available=False,
        auto_match_limit="legacy_estimate",
        canonical_write_ready=False,
        migration_note="Current generation and standings still use the legacy engine.",
    ),
    "swiss": TournamentFormatCapability(
        key="swiss",
        label="Swiss",
        canonical_stage_type="swiss",
        canonical_match_type="duel",
        result_model="standings",
        pairing_mode="dynamic_rounds",
        initial_preview_engine="none",
        rebuild_engine="none",
        stage_generator_available=False,
        auto_match_limit="none",
        canonical_write_ready=False,
        migration_note="Swiss currently uses separate round-generation routes and needs a versioned pairing strategy.",
    ),
    "groups": TournamentFormatCapability(
        key="groups",
        label="Gruppen",
        canonical_stage_type="round_robin_groups",
        canonical_match_type="duel",
        result_model="standings",
        pairing_mode="scheduled_rounds",
        initial_preview_engine="none",
        rebuild_engine="none",
        stage_generator_available=False,
        auto_match_limit="none",
        canonical_write_ready=False,
        migration_note="Groups currently use separate generation and standings routes.",
    ),
    "ffa": TournamentFormatCapability(
        key="ffa",
        label="Free for All",
        canonical_stage_type="simple",
        canonical_match_type="ffa",
        result_model="ranking",
        pairing_mode="ranking_series",
        initial_preview_engine="stage",
        rebuild_engine="stage",
        stage_generator_available=True,
        auto_match_limit="none",
        canonical_write_ready=False,
        migration_note="Stage-native format; canonical read/API naming is still pending.",
    ),
    "battle_royale": TournamentFormatCapability(
        key="battle_royale",
        label="Battle Royale",
        canonical_stage_type="simple",
        canonical_match_type="ffa",
        result_model="ranking",
        pairing_mode="ranking_series",
        initial_preview_engine="stage",
        rebuild_engine="stage",
        stage_generator_available=True,
        auto_match_limit="none",
        canonical_write_ready=False,
        migration_note="Stage-native simple ranking match; series scoring remains a future strategy.",
    ),
    "league": TournamentFormatCapability(
        key="league",
        label="Liga",
        canonical_stage_type="league",
        canonical_match_type="duel",
        result_model="standings",
        pairing_mode="scheduled_rounds",
        initial_preview_engine="legacy",
        rebuild_engine="legacy",
        stage_generator_available=False,
        auto_match_limit="legacy_estimate",
        canonical_write_ready=False,
        migration_note="Current double round-robin generation and standings use the legacy engine.",
    ),
    "time_trial": TournamentFormatCapability(
        key="time_trial",
        label="Time Trial",
        canonical_stage_type="simple",
        canonical_match_type="ffa",
        result_model="time",
        pairing_mode="ranking_series",
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
        initial_preview_engine="stage",
        rebuild_engine="stage",
        stage_generator_available=True,
        auto_match_limit="none",
        canonical_write_ready=False,
        migration_note="Stage-native graph; player reporting/forfeit parity and richer graph validation remain open.",
    ),
    "ffa_custom_bracket": TournamentFormatCapability(
        key="ffa_custom_bracket",
        label="Freier FFA-Turnierbaum",
        canonical_stage_type="ffa_custom_bracket",
        canonical_match_type="ffa",
        result_model="ranking",
        pairing_mode="static_graph",
        initial_preview_engine="stage",
        rebuild_engine="stage",
        stage_generator_available=True,
        auto_match_limit="none",
        canonical_write_ready=False,
        migration_note="Stage-native graph; canonical API naming and consumer consolidation remain open.",
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
