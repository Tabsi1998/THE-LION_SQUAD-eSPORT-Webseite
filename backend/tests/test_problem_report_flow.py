"""Problem melden (#1158): Grund antippen, kurz beschreiben, auf Wunsch ein Foto - die Turnierleitung entscheidet am
Handy mit einem Tipp („Ergebnis bleibt“ oder „Ergebnis ändern“), beide Seiten bekommen die Entscheidung.

Geprüft mit echten Routen und erfundenen Konten: Gründe, Foto nur für Beteiligte und Turnierleitung, die Karte in der
Ansicht „Turnierleitung“, „bleibt“ und „ändern“ mit Nachricht, Rechte.
"""
import io
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import match_proofs  # noqa: E402
from services.result_hold import publish_due_holds  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(match_proofs, "PROOF_DIR", tmp_path / "proofs")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 40, 40)).save(buffer, format="PNG")
    return buffer.getvalue()


async def bracket(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(4, result_entry_mode="staff_only")
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    matches = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))
    match = matches[0]
    first, second = [slot["registration_id"] for slot in match["slots"]]
    player = {reg["id"]: users[index] for index, reg in enumerate(registrations)}
    others = [users[index] for index, reg in enumerate(registrations) if reg["id"] not in {first, second}]
    return staff, tournament, match, first, second, player, others


def ranking(winner: str, loser: str, score=(2, 1)) -> dict:
    return {"results": [{"registration_id": winner, "rank": 1, "score": score[0]}, {"registration_id": loser, "rank": 2, "score": score[1]}]}


async def notes(flow, kind: str) -> list[dict]:
    return await flow.db.notifications.find({"kind": kind}, {"_id": 0}).to_list(200)


async def entered(flow, staff, match, winner, loser):
    flow.act_as(staff)
    saved = await flow.post(f"/api/matches/{match['id']}/result", json=ranking(winner, loser))
    assert saved.status_code == 200, saved.text


@pytest.mark.asyncio
async def test_problem_with_reason_text_and_photo_reaches_staff_with_a_link_to_the_case(flow):
    staff, tournament, match, first, second, player, others = await bracket(flow)
    await entered(flow, staff, match, second, first)
    flow.act_as(player[first])
    photo = (await flow.post(f"/api/matches/{match['id']}/proof-photos", files={"file": ("stand.png", png(), "image/png")})).json()
    wrong = await flow.post(f"/api/matches/{match['id']}/dispute", json={"reason": "Es stand 2:1 für mich", "category": "erfunden"})
    assert wrong.status_code == 422
    sent = await flow.post(f"/api/matches/{match['id']}/dispute",
                           json={"reason": "Es stand 2:1 für mich, nicht 1:2.", "category": "wrong_result", "photo_id": photo["id"]})
    assert sent.status_code == 200, sent.text
    stored = await flow.reload(match)
    assert stored["status"] == "disputed" and stored["status_before_dispute"] == "completed"
    assert stored["disputes"][-1]["category"] == "wrong_result" and stored["disputes"][-1]["photo_id"] == photo["id"]

    alert = [row for row in await notes(flow, "match_attention") if row["user_id"] == staff["id"]]
    assert alert and "Falsches Ergebnis: „Es stand 2:1 für mich, nicht 1:2.“" in alert[0]["body"]
    assert alert[0]["url"] == f"/tournaments/{tournament['slug']}/leitung?fall=ds-{match['id']}"
    told = [row for row in await notes(flow, "match_dispute") if row["user_id"] == player[second]["id"]]
    assert told and "Es stand" not in told[0]["body"], "der Grund bleibt bei der Turnierleitung"

    # Das Foto sehen Gegenseite und Turnierleitung, sonst niemand.
    for viewer, status in ((player[second], 200), (staff, 200), (others[0], 404)):
        flow.act_as(viewer)
        assert (await flow.get(photo["url"])).status_code == status

    # Die Karte in der Ansicht „Turnierleitung“.
    flow.act_as(staff)
    view = (await flow.get(f"/api/tournaments/{tournament['id']}/lead")).json()
    card = next(row for row in view["matches"] if row["id"] == match["id"])
    assert view["matches"][0]["id"] == match["id"], "Streitfälle stehen oben"
    assert card["dispute"]["category_label"] == "Falsches Ergebnis"
    assert card["dispute"]["text"] == "Es stand 2:1 für mich, nicht 1:2."
    assert card["dispute"]["photo"]["id"] == photo["id"]
    assert card["dispute"]["result_by"] == staff["display_name"] and card["has_result"] is True
    assert view["counts"]["disputes"] == 1


@pytest.mark.asyncio
async def test_staff_keeps_the_result_with_one_tap_and_both_sides_hear_it(flow):
    staff, tournament, match, first, second, player, others = await bracket(flow)
    await entered(flow, staff, match, second, first)
    flow.act_as(player[first])
    await flow.post(f"/api/matches/{match['id']}/dispute", json={"reason": "Lag im zweiten Spiel", "category": "technical"})

    assert (await flow.post(f"/api/matches/{match['id']}/dispute/decision", json={"decision": "keep"})).status_code == 403
    flow.act_as(staff)
    kept = await flow.post(f"/api/matches/{match['id']}/dispute/decision", json={"decision": "keep", "note": "Lag war auf beiden Seiten"})
    assert kept.status_code == 200, kept.text
    stored = await flow.reload(match)
    assert stored["status"] == "completed" and "status_before_dispute" not in stored
    assert all(row.get("resolved_at") and row.get("decision") == "keep" for row in stored["disputes"])
    decided = [row for row in await notes(flow, "match_result") if row["title"] == "Dispute entschieden"]
    assert {row["user_id"] for row in decided} == {player[first]["id"], player[second]["id"]}
    assert "Das Ergebnis bleibt" in decided[0]["body"] and "Lag war auf beiden Seiten" in decided[0]["body"]
    mails = await flow.db.mail_jobs.find({"template_key": "dispute_resolved"}, {"_id": 0}).to_list(10)
    assert len(mails) == 2
    audit = await flow.db.audit_logs.find({"action": "match.dispute.keep"}, {"_id": 0}).to_list(5)
    assert audit and audit[0]["actor_id"] == staff["id"]
    again = await flow.post(f"/api/matches/{match['id']}/dispute/decision", json={"decision": "keep"})
    assert again.status_code == 409, "kein Dispute mehr offen"


@pytest.mark.asyncio
async def test_staff_changes_the_result_through_the_window_and_the_dispute_closes(flow):
    staff, tournament, match, first, second, player, others = await bracket(flow)
    await entered(flow, staff, match, second, first)
    flow.act_as(player[first])
    await flow.post(f"/api/matches/{match['id']}/dispute", json={"reason": "Stand vertauscht", "category": "wrong_result"})
    flow.act_as(staff)
    changed = await flow.post(f"/api/matches/{match['id']}/result?force=true",
                              json={**ranking(first, second), "hold": True, "reason": "Foto zeigt 2:1"})
    assert changed.status_code == 200, changed.text
    assert (await flow.reload(match))["status"] == "disputed", "10 Sekunden Rückgängig - noch nichts entschieden"
    assert await publish_due_holds(flow.db, now=now_utc() + timedelta(seconds=13)) == 1
    stored = await flow.reload(match)
    assert stored["status"] == "completed" and stored["dispute_resolved_at"]
    assert {row["registration_id"]: row["rank"] for row in stored["results"]} == {first: 1, second: 2}
    decided = [row for row in await notes(flow, "match_result") if row["title"] == "Dispute entschieden"]
    assert {row["user_id"] for row in decided} == {player[first]["id"], player[second]["id"]}
    assert stored["result_meta"]["correction_reason"] == "Foto zeigt 2:1"


@pytest.mark.asyncio
async def test_problem_before_the_result_goes_back_to_the_open_match(flow):
    staff, tournament, match, first, second, player, others = await bracket(flow)
    flow.act_as(player[first])
    sent = await flow.post(f"/api/matches/{match['id']}/dispute", json={"reason": "Gegner ist nicht da", "category": "other"})
    assert sent.status_code == 200
    flow.act_as(staff)
    kept = await flow.post(f"/api/matches/{match['id']}/dispute/decision", json={"decision": "keep"})
    assert kept.status_code == 200
    stored = await flow.reload(match)
    assert stored["status"] not in {"disputed", "completed"} and not stored.get("results")
    decided = [row for row in await notes(flow, "match_result") if row["title"] == "Dispute entschieden"]
    assert decided and "Das Spiel geht weiter wie geplant." in decided[0]["body"]
