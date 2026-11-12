"""Verfahren der Liga (E.2, #1619) an den übrigen Stellen: „Braucht Aufmerksamkeit“, Listen der Leitung, Tabelle als PDF, TV,
Einspruch gegen Kampflos-Wertung und Korrektur. Erfundene Namen, jede Regel mit Gegenprobe.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import world as league_world  # noqa: E402
from match_proof_world import user  # noqa: E402
from models import now_utc  # noqa: E402
from pdf_service import _standing_name  # noqa: E402
from services import match_proofs  # noqa: E402
from services.competition_snapshot import adapt_stage_matches  # noqa: E402
from services.match_attention import tournament_attention  # noqa: E402
from services.tv_display import display_standings  # noqa: E402
from test_league_procedures_flow import NOTE, act, completed, opened, page, stored  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(match_proofs, "PROOF_DIR", tmp_path / "proofs")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def attention(flow, w) -> list[dict]:
    tournament = await flow.db.tournaments.find_one({"id": w["tournament"]["id"]}, {"_id": 0})
    items, _matches = await tournament_attention(flow.db, tournament, now=now_utc())
    return [item for item in items if item["match_id"] == w["match"]["id"]]


@pytest.mark.asyncio
async def test_a_protest_that_counts_still_needs_attention(flow):
    w = await league_world(flow)
    await completed(flow, w)
    assert await attention(flow, w) == [], "ein bestätigtes Spiel ohne Verfahren ist kein Fall"
    pid = await opened(flow, w)
    assert (await stored(flow, w))["status"] == "completed"
    items = await attention(flow, w)
    assert [(item["kind"], item["action"], item["title"]) for item in items] == [("procedure", "open", "Protest eingegangen")]
    assert "Falsches Ergebnis" in items[0]["detail"] and "vorläufig" in items[0]["detail"]
    flow.act_as(w["staff"])
    assert (await act(flow, w, pid, "decision", decision="keep", decision_note=NOTE)).status_code == 200
    assert await attention(flow, w) == [], "entschieden: kein Fall mehr"


@pytest.mark.asyncio
async def test_lists_for_the_lead_hide_procedure_details_from_someone_involved(flow):
    w = await league_world(flow)
    await completed(flow, w)
    pid = await opened(flow, w, reason_key="equipment", notified_immediately=False, claimed=None)
    flow.act_as(w["staff"])
    assert (await act(flow, w, pid, "moss-requests", user_id=user(w, "Falke2")["id"])).status_code == 200
    urls = (f"/api/matches/{w['match']['id']}", f"/api/tournaments/{w['tournament']['id']}/matches-v2")

    def row_of(payload) -> dict:
        match = payload if isinstance(payload, dict) else next(item for item in payload if item["id"] == w["match"]["id"])
        return match["disputes"][0]

    # Die nicht befangene Leitung sieht den Eintrag vollständig.
    for url in urls:
        full = row_of((await flow.get(url)).json())
        assert full["moss_requests"] and full["notified_immediately"] is False and full["reason"], url

    # Mila gehört zu den Löwen und hat Liga-Recht: nur Kennung, Art und Stand - keine MOSS-Anforderung, kein Konto.
    await flow.db.users.update_one({"id": user(w, "Mila")["id"]}, {"$set": {"role": w["staff"]["role"]}})
    flow.act_as({**user(w, "Mila"), "role": w["staff"]["role"]})
    for url in urls:
        response = await flow.get(url)
        assert response.status_code == 200, response.text
        assert row_of(response.json()) == {"at": row_of(response.json())["at"], "id": pid, "kind": "protest", "state": "open"}, url


@pytest.mark.asyncio
async def test_appeal_against_a_forfeit_is_offered_once_and_decided_by_someone_else(flow):
    w = await league_world(flow)
    second = await flow.add_staff("Zweite Leitung")
    await completed(flow, w)
    flow.act_as(user(w, "Falke1"))
    assert (await page(flow, w))["league"]["procedure_form"]["appealable"] is None, "ein gespieltes Ergebnis ohne Korrektur"
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"status": "forfeit", "forfeit_registration_id": w["reg_h"]["id"]}})
    offer = (await page(flow, w))["league"]["procedure_form"]["appealable"]
    assert offer["type"] == "forfeit" and offer["ref_id"] == w["match"]["id"] and offer["until"] > now_utc().isoformat()
    url = f"/api/matches/{w['match']['id']}/appeals"
    sent = await flow.post(url, json={"against_type": "forfeit", "ref_id": w["match"]["id"], "reason": "Wir waren da, der Check-in hing."})
    assert sent.status_code == 200, sent.text
    aid = sent.json()["procedure_id"]
    assert (await page(flow, w))["league"]["procedure_form"]["appealable"] is None, "nur einmal je Entscheidung"
    again = await flow.post(url, json={"against_type": "forfeit", "ref_id": w["match"]["id"], "reason": "Noch einmal derselbe Einspruch."})
    assert again.status_code == 409
    match = await stored(flow, w)
    assert match["status"] == "forfeit" and match["contested"] is True, "die Wertung gilt bis zur Entscheidung weiter"

    flow.act_as(w["staff"])  # hat die Wertung eingetragen (completed_by)
    assert (await act(flow, w, aid, "decision", decision="keep", decision_note=NOTE)).status_code == 403
    flow.act_as(second)
    assert (await act(flow, w, aid, "decision", decision="keep", decision_note=NOTE)).status_code == 200

    # Nach Ablauf der Einspruchsfrist gibt es kein Angebot mehr.
    late = (now_utc() - timedelta(hours=49)).isoformat()
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"completed_at": late, "result_meta": {"confirmed_at": late}, "disputes": []}})
    flow.act_as(user(w, "Falke1"))
    assert (await page(flow, w))["league"]["procedure_form"]["appealable"] is None


def test_contested_reaches_tree_tv_and_pdf_and_only_when_set():
    base = {"id": "m1", "tournament_id": "t", "stage_id": "s", "status": "completed", "slots": [], "results": []}
    assert adapt_stage_matches([{**base, "contested": True}])[0]["contested"] is True
    assert "contested" not in adapt_stage_matches([base])[0], "alle anderen Spiele sehen aus wie bisher"
    row = {"registration_id": "a", "display_name": "Rudel A", "rank": 1, "contested": 2, "user_id": "geheim"}
    assert display_standings([row]) == [{"registration_id": "a", "display_name": "Rudel A", "rank": 1, "contested": 2}]
    assert _standing_name({"display_name": "Rudel A", "contested": 1}) == "Rudel A (1 Spiel in Klärung)"
    assert _standing_name({"display_name": "Rudel A", "contested": 2, "exit": {"kind": "withdrawn"}}) == "Rudel A (ausgetreten, 2 Spiele in Klärung)"
    assert _standing_name({"display_name": "Rudel A", "contested": 0}) == "Rudel A"
