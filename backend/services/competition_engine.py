"""Which store a tournament writes into, and when that may change.

Rebuilding a bracket used to be able to move a tournament from one engine to the
other without anyone asking for it: a single-elimination tournament started in
the classic store, and the first rebuild deleted those matches and recreated them
as graph matches. Every match id changed with them, and with the ids went the
links, the reports and the chat that pointed at them.

The rule here is that the tournament decides, not the format. A tournament that
already has real matches keeps its store. Only when the holding store genuinely
cannot rebuild the format does a move become necessary - and then it has to be
asked for, because it is a migration and not a redraw.
"""
from __future__ import annotations

from dataclasses import dataclass

from services.competition_formats import find_format_capability


CLASSIC = "classic"
GRAPH = "graph"

# Was der klassische Generator aus dem Format heraus neu bauen kann. Alles
# andere entsteht dort über eigene Endpunkte und nicht über den Neuaufbau.
CLASSIC_REBUILDABLE_FORMATS = frozenset({"single_elim", "double_elim", "round_robin", "league"})


class EngineSwitchRequired(Exception):
    """A rebuild would move the tournament to the other store."""

    def __init__(self, from_engine: str, to_engine: str, reason: str):
        super().__init__(reason)
        self.from_engine = from_engine
        self.to_engine = to_engine
        self.reason = reason


@dataclass(frozen=True)
class EngineDecision:
    engine: str
    switched: bool
    pinned: str | None

    @property
    def is_graph(self) -> bool:
        return self.engine == GRAPH


def _has_real(matches) -> bool:
    return any(not match.get("is_preview") for match in matches or [])


def engine_of_record(legacy_matches=(), stage_matches=()) -> str | None:
    """The store holding this tournament's real matches, if it has any.

    Draft previews deliberately do not count. They carry no result and no
    history, so redrawing them in the other engine costs nothing - unlike a
    played match, whose id other records point at.
    """
    if _has_real(legacy_matches):
        return CLASSIC
    if _has_real(stage_matches):
        return GRAPH
    return None


def preferred_engine(format_key: str | None) -> str:
    """The store this format would choose for a tournament that has none yet.

    Read from the write model, not from whether a schema generator exists. The
    Swiss system has no schema on purpose - its rounds are computed one at a
    time - but it writes into the graph store like everything else. Confusing
    the two would send new Swiss tournaments back into the store being retired.
    """
    capability = find_format_capability(format_key)
    if capability is None:
        return CLASSIC
    # Formate ohne Turnierbaum (Zeitfahren, Grand Prix) schreiben gar keine
    # Matches. Sie bekommen trotzdem den Graph genannt, damit nichts mehr im
    # abzuschaltenden Speicher landet.
    return CLASSIC if capability.current_write_model == CLASSIC else GRAPH


def classic_can_rebuild(format_key: str | None) -> bool:
    return (format_key or "single_elim") in CLASSIC_REBUILDABLE_FORMATS


def decide_rebuild_engine(
    format_key: str | None,
    *,
    preferred: str,
    legacy_matches=(),
    stage_matches=(),
    allow_switch: bool = False,
) -> EngineDecision:
    """Pick the store a rebuild writes into.

    Raises :class:`EngineSwitchRequired` instead of moving a tournament that has
    already been played - the caller has to say yes to that explicitly, because
    it replaces every match id the tournament ever handed out.
    """
    pinned = engine_of_record(legacy_matches, stage_matches)
    if pinned is None or pinned == preferred:
        return EngineDecision(engine=pinned or preferred, switched=False, pinned=pinned)

    if pinned == CLASSIC and classic_can_rebuild(format_key):
        # Der haeufige Fall: Einzel- und Doppelausscheidung. Der klassische
        # Generator kann das Format, also bleibt alles, wo es ist.
        return EngineDecision(engine=CLASSIC, switched=False, pinned=pinned)

    if not allow_switch:
        raise EngineSwitchRequired(
            pinned,
            preferred,
            "Dieses Turnier liegt im "
            f"{'klassischen Speicher' if pinned == CLASSIC else 'Graph-Speicher'}"
            " und hat bereits echte Spiele. Ein Neuaufbau würde es in den anderen "
            "Speicher verschieben und dabei alle Match-IDs ersetzen. Das ist eine "
            "Migration und muss ausdrücklich bestätigt werden.",
        )
    return EngineDecision(engine=preferred, switched=True, pinned=pinned)
