"""„Sofort zufällig“ in FFA-Läufen über die Route (Generalprobe 31.10., #2033).

Läufe zu viert, die zwei Besten weiter. Das Ergebnis eines Laufs zieht für jeden Weiterkommer sofort einen freien Platz
der nächsten Runde und biegt das Schema um (``_rewire_instant``). Zwei Fehler, die nur über die Route auftraten (die
Simulation arbeitet auf einer einzigen Liste):

- Der Ergebnis-Weg liest den Lauf zweimal (das Spiel und die Spiele der Phase). Das Umbiegen traf die zweite Kopie,
  Platz 2 zeigte noch auf den eben an Platz 1 vergebenen Platz: „Zielslot … ist bereits belegt“ (409) - das Ergebnis
  ließ sich nicht eintragen.
- Tauschte ein Lauf nur zwei eigene Plätze im selben Zielspiel, wurden seine Weiterleitungen nicht gespeichert: Plätze
  und Graph passten nicht mehr zusammen (``target_slot_contract_mismatch``).
"""
import pathlib
import random
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def seed_draw(monkeypatch, seed: int) -> None:
    """Das Los mit Startwert - an jeder Importstelle von ``DRAW_RNG`` (wie test_bracket_generator_sim_unit)."""
    rng = random.Random(seed)
    for name, module in list(sys.modules.items()):
        if name.startswith("services.") and hasattr(module, "DRAW_RNG"):
            monkeypatch.setattr(module, "DRAW_RNG", rng)


def seated(match: dict) -> list[str]:
    ordered = sorted(match.get("slots") or [], key=lambda slot: slot.get("slot") or 0)
    return [slot["registration_id"] for slot in ordered if slot.get("registration_id")]


def assert_graph_valid(rows: list[dict], where: str) -> None:
    from services.competition_graph_validation import validate_competition_graph
    from services.competition_snapshot import build_structure_snapshot

    report = validate_competition_graph(build_structure_snapshot("t", stage_matches=rows))
    errors = [issue for issue in report["issues"] if issue.get("severity") == "error"]
    assert report["valid"] and not errors, f"{where}: Graph ungültig: {errors}"


@pytest.mark.asyncio
async def test_each_heat_sends_both_qualifiers_to_distinct_seats_and_the_graph_stays_valid(flow, monkeypatch):
    """10 Fahrer (Läufe 3, 3, 4), 16 Startwerte für das Los, abwechselnd direkt und mit „Rückgängig“-Fenster: jedes
    Ergebnis geht durch, jeder Weiterkommer sitzt genau einmal, der Graph bleibt nach jedem Ergebnis gültig."""
    from services.result_hold import publish_due_holds

    for seed in range(16):
        seed_draw(monkeypatch, seed)
        hold = bool(seed % 2)
        tournament, _users, _regs = await flow.with_participants(
            10, format="ffa_custom_bracket", advancement_mode="instant", event_mode="local",
            result_entry_mode="staff_only", status="registration_open")
        flow.act_as(await flow.add_staff())
        built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false", json={
            "name": "Läufe", "stage_type": "ffa_custom_bracket", "match_type": "ffa",
            "settings": {"match_size": 4, "qualifiers_per_match": 2, "min_players": 2}})
        assert built.status_code == 200, built.text
        await flow.start(tournament)
        heats = sorted((m for m in await flow.matches(tournament) if m.get("round") == 1), key=lambda m: m["match_key"])
        for heat in heats:
            order = seated(heat)
            response = await flow.post(f"/api/matches/{heat['id']}/result", json={
                "hold": hold,
                "results": [{"registration_id": reg, "rank": index + 1} for index, reg in enumerate(order)]})
            assert response.status_code == 200, (seed, heat["match_key"], response.text)
            if hold:
                assert await publish_due_holds(flow.db, now=now_utc() + timedelta(seconds=30)) == 1
            assert (await flow.reload(heat))["status"] == "completed"
            assert_graph_valid(await flow.matches(tournament), f"Startwert {seed}, nach {heat['match_key']}")
        second = [m for m in await flow.matches(tournament) if m.get("round") == 2]
        placed = [reg for m in second for reg in seated(m)]
        assert len(placed) == len(set(placed)) == 2 * len(heats), "jeder Weiterkommer sitzt genau einmal"
