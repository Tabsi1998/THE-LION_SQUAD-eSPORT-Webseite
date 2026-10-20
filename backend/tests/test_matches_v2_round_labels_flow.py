"""Die Spiele-Liste der Verwaltung nennt die Runden wie der Baum (#1860).

Der Kasten „Auslosung“ im Reiter Spiele liest ``/matches-v2``. Ohne ``round_label`` sagte er für Winner Runde 2 und
Loser Runde 1 (nach der Uhr beide „Runde 2“) zweimal „Runde 2“.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def heat(tid: str, key: str, round_number: int, section: str) -> dict:
    return {"id": f"{tid}-{key}", "tournament_id": tid, "stage_id": f"{tid}-s", "match_key": key, "round": round_number,
            "round_name": f"Runde {round_number}", "section": section, "match_type": "ffa", "status": "pending",
            "slots": [{"slot": index} for index in range(1, 5)]}


@pytest.mark.asyncio
async def test_staff_list_carries_the_round_names_of_the_tree(flow):
    tournament = await flow.create_tournament(format="ffa_custom_bracket", status="live")
    tid = tournament["id"]
    await flow.db.tournament_stages.insert_one({"id": f"{tid}-s", "tournament_id": tid, "number": 1,
                                                "stage_type": "ffa_custom_bracket", "name": "Läufe"})
    await flow.db.matches_v2.insert_many([heat(tid, "A", 1, "main"), heat(tid, "E", 2, "main"), heat(tid, "G", 3, "main"),
                                          heat(tid, "LA", 2, "loser"), heat(tid, "LC", 3, "loser")])
    flow.act_as(await flow.add_user(role="admin"))

    response = await flow.client.get(f"/api/tournaments/{tid}/matches-v2")

    assert response.status_code == 200, response.text
    labels = {row["match_key"]: row.get("round_label") for row in response.json()}
    assert labels["E"] == "Runde 2" and labels["LA"] == "Loser Runde 1" and labels["LC"] == "Loser Runde 2"
