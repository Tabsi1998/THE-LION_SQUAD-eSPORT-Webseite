"""„Speichern & Struktur anwenden“ verwirft ein eigenes Schema nicht still (#2046, Generalprobe 31.10.).

Eine Phase kann ein eigenes Schema tragen (Phasen der Verwaltung), auch wenn das Turnierformat es nicht vorgibt - etwa
ein Cup mit eigenem Loser Bracket. Baut die Leitung den Baum aus dem Format neu und bringt dabei kein Schema mit, wäre
aus dem Cup still der Format-Baum geworden. Jetzt fragt der Server erst nach (``confirm_destruction``); erst mit der
Bestätigung (``force``) entsteht der Format-Baum. Ohne Struktur im Aufruf bleibt das Schema wie bisher.

Dazu aus derselben Probe: Ein Nachzügler ohne freien Platz im festen Baum erfährt, was noch geht - vor dem ersten
Spiel „Zurücksetzen“ und neu bauen, danach nichts mehr.
"""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402

CUP_WITH_LOSER_BRACKET = """[WB]
# Runde 1
A=[1,4]
B=[2,3]
# Finale
C=[W:A:1,W:B:1]

[LB]
# Runde 1
LA=[L:A:1,L:B:1]
# Runde 2
LB=[W:LA:1,L:C:1]

[GF]
# Grand Final
GF=[W:C:1,W:LB:1]"""

# Was das Turnierformular schickt („Speichern & Struktur anwenden“) - bei einem normalen K.-o. ohne Schema.
FORM_BODY = {"name": "Turnierbaum", "settings": {"score_type": "points", "calculation": "points"},
             "stage_type": "custom_bracket", "match_type": "duel"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def cup(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(4, format="double_elim")
    await flow.db.tournament_stages.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "number": 1, "status": "pending", "name": "Cup",
        "stage_type": "custom_bracket", "match_type": "duel",
        "settings": {"schema": CUP_WITH_LOSER_BRACKET, "match_size": 2, "qualifiers_per_match": 1, "min_players": 2},
    })
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=true")
    assert built.status_code == 200, built.text
    assert await keys(flow, tournament) == OWN_KEYS
    return tournament


OWN_KEYS = {"A", "B", "C", "LA", "LB", "GF"}


async def keys(flow, tournament) -> set[str]:
    return {match["match_key"] for match in await flow.matches(tournament)}


@pytest.mark.asyncio
async def test_rebuilding_without_a_schema_asks_before_dropping_the_own_schema(flow):
    tournament = await cup(flow)
    before = sorted(match["id"] for match in await flow.matches(tournament))

    asked = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=true", json=FORM_BODY)

    assert asked.status_code == 409, asked.text
    detail = asked.json()["detail"]
    assert detail["code"] == "confirm_destruction" and detail["own_schema"] is True
    assert "eigene Schema" in detail["message"] and "„Cup“" in detail["message"]
    assert sorted(match["id"] for match in await flow.matches(tournament)) == before, "nichts wurde ersetzt"
    stage = await flow.db.tournament_stages.find_one({"tournament_id": tournament["id"]}, {"_id": 0})
    assert stage["settings"]["schema"] == CUP_WITH_LOSER_BRACKET


@pytest.mark.asyncio
async def test_after_confirming_the_format_tree_replaces_the_own_schema(flow):
    tournament = await cup(flow)

    confirmed = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=true&force=true",
                                json=FORM_BODY)

    assert confirmed.status_code == 200, confirmed.text
    assert await keys(flow, tournament) != OWN_KEYS, "bewusst entschieden: der Baum kommt aus dem Format"


@pytest.mark.asyncio
async def test_rebuilding_with_the_schema_or_without_a_body_keeps_it_without_asking(flow):
    tournament = await cup(flow)
    with_schema = {**FORM_BODY, "settings": {**FORM_BODY["settings"], "schema": CUP_WITH_LOSER_BRACKET}}

    kept = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=true", json=with_schema)
    assert kept.status_code == 200, kept.text
    assert await keys(flow, tournament) == OWN_KEYS

    again = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=true")
    assert again.status_code == 200, again.text
    assert await keys(flow, tournament) == OWN_KEYS


# ---------------------------------------------------------------- Nachzügler ohne freien Platz

async def latecomer(flow, tournament, name):
    registration = await flow.register(tournament, await flow.add_user(name=name), status="pending")
    response = await flow.patch(f"/api/tournaments/{tournament['id']}/registrations/{registration['id']}",
                                json={"status": "approved"})
    assert response.status_code == 200, response.text
    return response.json()["placement"]


@pytest.mark.asyncio
async def test_a_latecomer_without_a_place_hears_what_still_works_before_and_after_the_first_match(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(4)
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert built.status_code == 200, built.text

    before = await latecomer(flow, tournament, "Nachzügler 1")
    assert before["ok"] is False and before["reason"] == "no_free_place"
    assert "„Zurücksetzen“" in before["detail"] and "neu bauen" in before["detail"], before["detail"]

    first = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row["id"]))[0]
    await flow.db.matches_v2.update_one({"id": first["id"]},
                                        {"$set": {"status": "in_progress", "started_at": now_utc().isoformat()}})
    after = await latecomer(flow, tournament, "Nachzügler 2")
    assert after["ok"] is False and after["reason"] == "no_free_place"
    assert "begonnen" in after["detail"] and "Zurücksetzen" not in after["detail"], after["detail"]
