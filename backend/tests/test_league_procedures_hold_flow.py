"""Verfahren der Liga (E.2, #1619) und das gehaltene Ergebnis („Rückgängig“): Nichts geht still verloren. Erfundene Namen.

Läuft ein Verfahren schon, bekommt die Leitung die Absage sofort. Kommt es dazwischen, während das Ergebnis oder die Wertung
„nicht erschienen“ noch bereitliegt, wird beim Veröffentlichen nichts geschrieben: Die Wertung ist verworfen, die Person bekommt
einen Hinweis mit Klartext, und es steht im Protokoll.
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
from services import league_procedures, match_proofs  # noqa: E402
from services.result_hold import publish_due_holds  # noqa: E402
from test_league_procedures_flow import opened, stored  # noqa: E402

REASON = "Die Falken sind zum Termin nicht erschienen."


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(match_proofs, "PROOF_DIR", tmp_path / "proofs")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def no_show(w, **extra) -> dict:
    """Das Ergebnis-Fenster mit „nicht erschienen“ für die Falken, bereitgelegt für „Rückgängig“."""
    return {"results": [{"registration_id": w["reg_a"]["id"], "rank": 1}, {"registration_id": w["reg_h"]["id"], "rank": 2, "forfeit": True}],
            "hold": True, **extra}


async def hold(flow, w, **extra):
    flow.act_as(w["staff"])
    return await flow.post(f"/api/matches/{w['match']['id']}/result", json=no_show(w, **extra))


@pytest.mark.asyncio
async def test_a_held_forfeit_is_refused_at_once_while_a_procedure_is_open(flow):
    w = await league_world(flow)
    await opened(flow, w)
    assert (await stored(flow, w))["status"] == "disputed"
    refused = await hold(flow, w, reason="kurz")
    assert refused.status_code == 422 and "begründen" in refused.json()["detail"], refused.text
    match = await stored(flow, w)
    assert "pending_result" not in match and match["disputes"][0]["state"] == "open", "nichts liegt bereit, nichts ist entschieden"

    # Gegenprobe: Mit Begründung liegt die Wertung bereit und entscheidet das Verfahren beim Veröffentlichen mit.
    held = await hold(flow, w, reason=REASON)
    assert held.status_code == 200, held.text
    assert (await stored(flow, w))["pending_result"]["kind"] == "forfeit"
    assert await publish_due_holds(flow.db, now=now_utc() + timedelta(minutes=1)) == 1
    match = await stored(flow, w)
    assert match["status"] == "forfeit" and match["disputes"][0]["state"] == "decided" and match["disputes"][0]["decision_note"] == REASON


@pytest.mark.asyncio
async def test_a_procedure_that_arrives_while_a_forfeit_is_held_discards_it_with_a_clear_notice(flow):
    w = await league_world(flow)
    held = await hold(flow, w)
    assert held.status_code == 200, held.text
    before = await stored(flow, w)
    hold_id = before["pending_result"]["id"]

    # In den Sekunden bis zum Veröffentlichen kommt ein Einspruch gegen eine Entscheidung derselben Person dazu: Die bereitliegende
    # Wertung würde ihn mitentscheiden - das darf diese Person nicht.
    entry = {"id": "p-dazwischen", "kind": "objection", "state": "open", "user_id": user(w, "Falke1")["id"], "registration_id": w["reg_h"]["id"],
             "at": now_utc().isoformat(), "reason_key": "other", "category": "other", "reason": "Wir waren da, der Check-in hing.",
             "moss_requests": [], "additions": [], "against": {"decided_by": w["staff"]["id"]}}
    await flow.db.matches_v2.update_one({"id": before["id"]}, {"$push": {"disputes": {**entry, "kind": "appeal"}},
                                                               "$set": {"contested": True}})
    assert league_procedures.has_open(await stored(flow, w))

    assert await publish_due_holds(flow.db, now=now_utc() + timedelta(minutes=1)) == 0, "nichts veröffentlicht"
    after = await stored(flow, w)
    assert "pending_result" not in after, "die Wertung liegt nicht mehr bereit - sie ist verworfen"
    assert after["status"] == before["status"] and not after.get("results") and not after.get("forfeit_registration_id")
    assert after["disputes"][0]["state"] == "open" and not after["disputes"][0].get("decision"), "das Verfahren ist nicht entschieden"

    notice = await flow.db.notifications.find_one({"user_id": w["staff"]["id"], "meta.reason": "hold_failed"}, {"_id": 0})
    assert notice and notice["title"] == "Ergebnis nicht gespeichert" and notice["kind"] == "match_attention"
    assert "Ausgangsentscheidung" in notice["body"], "der Grund steht im Klartext da"
    assert notice["url"] == f"/matches/{before['id']}" and notice["meta"]["dedupe_key"] == f"hold-failed:{hold_id}"
    logged = await flow.db.audit_logs.find_one({"action": "match.result.hold_failed"}, {"_id": 0})
    assert logged and logged["data"]["hold_id"] == hold_id and "Ausgangsentscheidung" in logged["data"]["detail"]

    # Gegenprobe: Ohne Verfahren geht dieselbe bereitliegende Wertung durch.
    await flow.db.matches_v2.update_one({"id": before["id"]}, {"$set": {"disputes": [], "contested": False}})
    again = await hold(flow, w)
    assert again.status_code == 200, again.text
    assert await publish_due_holds(flow.db, now=now_utc() + timedelta(minutes=1)) == 1
    assert (await stored(flow, w))["status"] == "forfeit"
