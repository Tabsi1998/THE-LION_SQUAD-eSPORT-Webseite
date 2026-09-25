"""Generalversammlung und Abstimmungen (#327, Vereine 1.4): nur mit Weg zur Akte und den Fähigkeiten
„meetings“ bzw. „votes“; Sitzungen nur mit Einladung; Zu-/Absage, Anträge genau einmal je Inhalt (spät nach
der Frist); Stimmen nur offen und anwesend, jedes Stimmrecht einmal, eine andere Antwort ändert nichts;
Ergebnis erst nach Bestätigung; welche Antwort jemand gab, steht nirgends in den Logs der Website."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, ballot_right, member  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import dolibarr_client, dolibarr_identity  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch):
    instance = FakeDolibarr()
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    dolibarr_identity.reset_cache()
    return instance


async def connect(flow, mode="live"):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": mode, "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1, "type_map": {"2": "ordinary"},
    }}, upsert=True)


async def bind(flow, code: str) -> dict:
    response = await flow.post("/api/membership/me/identity", json={"code": code})
    assert response.status_code == 200 and response.json()["status"] == "bound", response.text
    return response.json()


def seed_assembly(fake: FakeDolibarr) -> None:
    fake.add(member(12), email="paula@example.test")
    fake.add_meeting(7, invited=[(12, True)], agenda=("Begrüßung", "Bericht des Vorstands", "Entlastung des Vorstands"))
    fake.add_meeting(8, kind="board", title="Vorstandssitzung Oktober", day="2026-10-01", format="virtual", invited=[(99, True)])
    fake.add_ballot(3, 7, item=3, question="Entlastung des Vorstands", status="released")


@pytest.mark.asyncio
async def test_meetings_and_ballots_run_through_the_binding(flow, fake):
    await connect(flow)
    seed_assembly(fake)
    paula = await flow.add_user(role="player", name="paula")
    paula["is_club_member"] = True
    flow.act_as(paula)

    # Ohne Weg zur Akte: der Grund, und nichts geht raus.
    view = (await flow.get("/api/membership/me/meetings")).json()
    assert view["available"] is False and view["reason"] == "not_bound" and "Einladungscode" in view["text"]
    assert (await flow.put("/api/membership/me/meetings/7/response", json={"response": "yes"})).status_code == 403
    assert (await flow.post("/api/membership/me/ballots/3/votes", json={"right_id": 1012, "option": "yes"})).status_code == 403

    # Bindung nur mit Dokumenten: je Teil der Grund, Schreiben 409.
    fake.invite("DOCS", 12, capabilities=("documents",))
    await bind(flow, "DOCS")
    view = (await flow.get("/api/membership/me/meetings")).json()
    assert view["available"] is True and view["meetings"] == [] and view["ballots"] == []
    assert view["meetings_reason"] == "no_capability_meetings" and "Versammlungen" in view["meetings_text"]
    assert view["ballots_reason"] == "no_capability_votes" and "Abstimmungen" in view["ballots_text"]
    assert (await flow.put("/api/membership/me/meetings/7/response", json={"response": "yes"})).status_code == 409
    assert fake.meeting_responses == {}

    # Bindung mit Sitzungen und Abstimmungen: nur die Versammlung mit Einladung, nie die fremde Vorstandssitzung.
    fake.revoke_identity(paula["id"])
    fake.invite("ALL", 12, capabilities=("documents", "meetings", "votes"))
    await bind(flow, "ALL")
    view = (await flow.get("/api/membership/me/meetings")).json()
    assert view["meetings_reason"] is None and view["ballots_reason"] is None
    assert [row["id"] for row in view["meetings"]] == [7]
    gv = view["meetings"][0]
    assert gv["kind_label"] == "Generalversammlung" and gv["format_label"] == "vor Ort und online" and gv["place"] == "Vereinsheim"
    assert gv["access"].startswith("https://") and gv["agenda"][0] == "Begrüßung" and gv["voting"] is True
    assert gv["response"] == "" and gv["response_label"] == "noch keine Antwort" and gv["status_label"] == "eingeladen"
    assert gv["upcoming"] is True and gv["can_respond"] is True and gv["can_motion"] is True and gv["motion_late"] is False
    assert gv["motion_deadline"] == "2026-10-21" and gv["motions"] == []
    assert len(view["ballots"]) == 1
    ballot = view["ballots"][0]
    assert ballot["question"] == "Entlastung des Vorstands" and ballot["meeting"] == "Generalversammlung 2026" and ballot["kind_label"] == "Beschluss"
    assert ballot["status"] == "released" and ballot["status_label"] == "angekündigt" and ballot["can_vote"] is False and ballot["result"] is None
    assert ballot["rights"] == [{"right_id": 1012, "for": "self", "name": "", "state": "open", "reason": "own", "reason_text": "dein eigenes Stimmrecht",
                                 "option": "", "option_label": "", "can_use": True}]
    assert [option["label"] for option in ballot["options"]] == ["Ja", "Nein", "Enthaltung"]

    # Zusage: die Sitzung danach; fremde Sitzung 404; kaputte Antwort abgewiesen.
    responded = (await flow.put("/api/membership/me/meetings/7/response", json={"response": "yes"})).json()
    assert responded["response"] == "yes" and responded["response_label"] == "zugesagt" and responded["responded_at"]
    assert (await flow.put("/api/membership/me/meetings/8/response", json={"response": "yes"})).status_code == 404
    assert (await flow.put("/api/membership/me/meetings/7/response", json={"response": "later"})).status_code in (400, 422)
    later = (await flow.put("/api/membership/me/meetings/7/response", json={"response": "maybe"})).json()
    assert later["response_label"] == "vielleicht"

    # Antrag: Titel Pflicht, genau einmal je Inhalt, nach der Frist als verspätet.
    assert (await flow.post("/api/membership/me/meetings/7/motions", json={"title": "ab", "text": ""})).status_code == 400
    motion = (await flow.post("/api/membership/me/meetings/7/motions", json={"title": "Neue Trikots", "text": "Bitte Budget für neue Trikots."})).json()
    assert motion["status"] == "received" and motion["status_label"] == "eingegangen" and motion["late"] is False and motion["received_at"]
    again = (await flow.post("/api/membership/me/meetings/7/motions", json={"title": "Neue Trikots", "text": "Bitte Budget für neue Trikots."})).json()
    assert again["external_id"] == motion["external_id"] and len(fake.motions[7]) == 1
    assert (await flow.post("/api/membership/me/meetings/8/motions", json={"title": "Fremd", "text": ""})).status_code == 404
    fake.today = "2026-10-22"
    late = (await flow.post("/api/membership/me/meetings/7/motions", json={"title": "Spät dran", "text": ""})).json()
    assert late["late"] is True
    fake.today = "2026-09-25"
    view = (await flow.get("/api/membership/me/meetings")).json()
    assert [row["title"] for row in view["meetings"][0]["motions"]] == ["Neue Trikots", "Spät dran"]

    # Abstimmung: angekündigt → nicht offen; offen, aber nicht anwesend → der Satz; unbekannte Antwort 400.
    async def vote(option: str, right: int = 1012):
        return await flow.post("/api/membership/me/ballots/3/votes", json={"right_id": right, "option": option})

    blocked = await vote("yes")
    assert blocked.status_code == 409 and "noch nicht offen" in blocked.json()["detail"]
    fake.set_ballot_status(3, "open")
    absent = await vote("yes")
    assert absent.status_code == 409 and "Anwesenheitsliste" in absent.json()["detail"]
    fake.present.setdefault(7, set()).add(12)
    assert (await vote("vielleicht")).status_code == 400
    assert (await vote("yes", right=4711)).status_code == 404

    # Die Stimme: genutzt; dieselbe noch einmal ist dieselbe; eine andere Antwort ändert nichts.
    voted = (await vote("yes")).json()
    own = voted["rights"][0]
    assert own["state"] == "used" and own["option"] == "yes" and own["option_label"] == "Ja" and own["can_use"] is False and voted["can_vote"] is False
    same = (await vote("yes")).json()
    assert same["rights"][0]["state"] == "used" and len(fake.votes) == 1
    other = await vote("no")
    assert other.status_code == 409 and "andere Stimme" in other.json()["detail"] and len(fake.votes) == 1
    repeat = await vote("yes")
    assert repeat.status_code == 200

    # Vollmacht: ein zweites Stimmrecht, eigener Stand je Recht.
    fake.ballot_rights[3][12].append(ballot_right(2020, for_="proxy", name="Anna Muster", reason="proxy"))
    view = (await flow.get("/api/membership/me/meetings")).json()
    ballot = view["ballots"][0]
    assert ballot["can_vote"] is True and [row["for"] for row in ballot["rights"]] == ["self", "proxy"] and ballot["rights"][1]["reason_text"] == "Vollmacht"
    proxy = (await vote("no", right=2020)).json()
    assert proxy["rights"][1]["option"] == "no" and proxy["rights"][1]["name"] == "Anna Muster" and proxy["can_vote"] is False

    # Geschlossen: keine Stimme mehr; das Ergebnis erst nach der Bestätigung durch die Versammlungsleitung.
    fake.set_ballot_status(3, "closed")
    closed = await vote("yes", right=2020)
    assert closed.status_code == 409 and "geschlossen" in closed.json()["detail"]
    view = (await flow.get("/api/membership/me/meetings")).json()
    assert view["ballots"][0]["status_label"] == "geschlossen" and view["ballots"][0]["result"] is None
    fake.confirm_result(3, outcome="passed", passed=True, counts={"yes": 41, "no": 3, "abstain": 2}, valid=44, abstain=2)
    view = (await flow.get("/api/membership/me/meetings")).json()
    result = view["ballots"][0]["result"]
    assert result["outcome_label"] == "angenommen" and result["passed"] is True and result["valid"] == 44
    assert result["counts"] == [{"code": "yes", "label": "Ja", "count": 41}, {"code": "no", "label": "Nein", "count": 3}, {"code": "abstain", "label": "Enthaltung", "count": 2}]

    # Welche Antwort jemand gab, schreibt die Website nirgends hin.
    assert await flow.db.audit_logs.count_documents({"action": {"$regex": "vote|ballot|meeting"}}) == 0

    # Widerruf der Bindung: alles zu, Schreiben 403.
    fake.revoke_identity(paula["id"])
    view = (await flow.get("/api/membership/me/meetings")).json()
    assert view["meetings_reason"] == "not_bound" and view["meetings"] == []
    assert (await flow.put("/api/membership/me/meetings/7/response", json={"response": "no"})).status_code == 403


@pytest.mark.asyncio
async def test_an_uninvited_or_non_voting_member_gets_the_reason_not_a_form(flow, fake):
    await connect(flow)
    fake.add(member(12), email="paula@example.test")
    fake.add_meeting(7, invited=[(12, False)])                 # eingeladen, aber laut Einladung nicht stimmberechtigt
    fake.add_ballot(3, 7, status="open")
    fake.present.setdefault(7, set()).add(12)
    fake.invite("ALL", 12, capabilities=("meetings", "votes"))
    paula = await flow.add_user(role="player", name="paula")
    paula["is_club_member"] = True
    flow.act_as(paula)
    await bind(flow, "ALL")
    view = (await flow.get("/api/membership/me/meetings")).json()
    assert view["meetings"][0]["voting"] is False
    ballot = view["ballots"][0]
    assert ballot["status"] == "open" and ballot["can_vote"] is False
    assert ballot["rights"] == [{"right_id": 0, "for": "self", "name": "", "state": "none", "reason": "no_voting_right",
                                 "reason_text": "laut Einladung nicht stimmberechtigt", "option": "", "option_label": "", "can_use": False}]
    assert (await flow.post("/api/membership/me/ballots/3/votes", json={"right_id": 0, "option": "yes"})).status_code == 400
    assert (await flow.post("/api/membership/me/ballots/3/votes", json={"right_id": 1012, "option": "yes"})).status_code == 404

    # Ohne live: nichts, aber ein Grund.
    await connect(flow, mode="preview")
    view = (await flow.get("/api/membership/me/meetings")).json()
    assert view["available"] is False and view["reason"] == "not_connected"
