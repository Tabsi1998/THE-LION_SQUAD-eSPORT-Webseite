"""Vorfälle im Spiel (docs/LIGA.md, „D.5/E.2-Vertrag“ → „Vorfälle“, #1619; Regelwerk § 9, Anlage C). Erfundene Namen.

Mit echten Routen in einer Liga-Staffel (Löwen gegen Falken, Best of 3): melden, zustimmen, ablehnen, Fristablauf, Entscheidung
der Leitung mit „Serie feststellen“, beide Modi der Serie, Rechte je Rolle. Jede Regel mit Gegenprobe.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import ids, two_nil, world  # noqa: E402
from models import now_utc  # noqa: E402
from services import league_incidents, match_deadlines  # noqa: E402
from services.match_deadline_sweep import sweep as deadline_sweep  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def url(w: dict, tail: str = "") -> str:
    return f"/api/matches/{w['match']['id']}/incidents{tail}"


async def stored(flow, w: dict) -> dict:
    return await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})


async def page(flow, w: dict) -> dict:
    response = await flow.get(f"/api/matches/{w['match']['id']}/page")
    assert response.status_code == 200, response.text
    return response.json()


def incident(w: dict, **fields) -> dict:
    return {"position": 2, "kind": "disconnect", "proposal": "replay", "note": "Verbindung der Löwen weg",
            "score": {w["reg_a"]["id"]: 3, w["reg_h"]["id"]: 4}, "round": 8, **fields}


async def reported(flow, w: dict, who: str = "Kapitaen", **fields) -> str:
    flow.act_as(w["users"][who])
    response = await flow.post(url(w), json=incident(w, **fields))
    assert response.status_code == 200, response.text
    return response.json()["incident_id"]


async def answered(flow, w: dict, incident_id: str, accept: bool, who: str = "Falke1"):
    flow.act_as(w["users"][who])
    return await flow.post(url(w, f"/{incident_id}/answer"), json={"accept": accept})


def lions(w: dict) -> list[str]:
    return ids(w, "Kapitaen", "Mila")


def falcons(w: dict) -> list[str]:
    return ids(w, "Falke1", "Falke2")


def two_one(w: dict, lineup: list[str]) -> dict:
    """Meldung 2:1 für die Löwen: Hafen (Löwen), Turm (Falken), Nebel (Löwen)."""
    a, h = w["reg_a"]["id"], w["reg_h"]["id"]
    return {
        "results": [{"registration_id": a, "rank": 1, "score": 2}, {"registration_id": h, "rank": 2, "score": 1}],
        "games": [
            {"position": 1, "mode": "stellung", "map_id": "map-hafen", "winner_registration_id": a, "scores": {a: 250, h: 180}, "lineup": lineup},
            {"position": 2, "mode": "suchen", "map_id": "map-turm", "winner_registration_id": h, "lineup": lineup},
            {"position": 3, "mode": "stellung", "map_id": "map-nebel", "winner_registration_id": a, "lineup": lineup},
        ],
    }


async def both_report(flow, w: dict, build=two_nil) -> dict:
    """Beide Seiten melden dasselbe - gibt die Antwort auf die zweite Meldung zurück."""
    flow.act_as(w["users"]["Kapitaen"])
    first = await flow.post(f"/api/matches/{w['match']['id']}/report", json=build(w, lineup=lions(w)))
    assert first.status_code == 200, first.text
    flow.act_as(w["users"]["Falke1"])
    second = await flow.post(f"/api/matches/{w['match']['id']}/report", json=build(w, lineup=falcons(w)))
    assert second.status_code == 200, second.text
    return second.json()


async def decide(flow, w: dict, incident_id: str, outcome: str, **body):
    flow.act_as(w["staff"])
    return await flow.post(url(w, f"/{incident_id}/decision"),
                           json={"outcome": outcome, "reason": "Nachweise beider Seiten geprüft", **body})


SETTLE = {"missing_positions": [], "surplus_positions": []}


@pytest.mark.asyncio
async def test_a_replayed_map_counts_exactly_once(flow):
    w = await world(flow)
    incident_id = await reported(flow, w)
    match = await stored(flow, w)
    entry = match["incidents"][0]
    assert entry["state"] == "proposed" and entry["reported_by"] == {"registration_id": w["reg_a"]["id"], "user_id": w["users"]["Kapitaen"]["id"]}
    assert entry["counts_quota"] is False and entry["voided"] is None and match["incident_due_at"] == entry["answer_deadline"]

    agreed = await answered(flow, w, incident_id, True)
    assert agreed.status_code == 200 and agreed.json()["state"] == "agreed", agreed.text
    match = await stored(flow, w)
    entry = match["incidents"][0]
    assert entry["closed_at"] and match["incident_due_at"] is None
    assert entry["voided"]["score"] == {w["reg_a"]["id"]: 3, w["reg_h"]["id"]: 4} and entry["voided"]["round"] == 8
    assert "games" not in match, "die ungültige Erstaustragung steht nur im Vorfall"

    confirmed = await both_report(flow, w)
    assert confirmed["awaiting_confirmation"] is False
    match = await stored(flow, w)
    assert match["status"] == "completed"
    assert [game["position"] for game in match["games"]] == [1, 2], "je Position genau eine geltende Austragung"
    second = match["games"][1]
    assert second["status"] == "replayed" and second["incident_id"] == incident_id and "wiederholt" in second["replay_reason"]
    assert "status" not in match["games"][0] and "incident_id" not in match["games"][0]
    assert {row["registration_id"]: row["score"] for row in match["results"]} == {w["reg_a"]["id"]: 2, w["reg_h"]["id"]: 0}

    # Öffentlich steht nur „Map wiederholt“ - nie der Vorfall selbst.
    flow.act_as(None)
    public = await page(flow, w)
    assert public["league"]["map_state"] == [{"position": 1, "state": "played"}, {"position": 2, "state": "replayed"},
                                             {"position": 3, "state": "open"}]
    assert public["league"]["incidents"] == [] and public["league"]["incident_info"] is None
    assert "incidents" not in public["match"] and "incident_due_at" not in public["match"]
    assert "incident_id" not in public["league"]["games"][1] and public["league"]["games"][1]["status"] == "replayed"


@pytest.mark.asyncio
async def test_without_an_incident_nothing_changes(flow):
    """Gegenprobe: Dieselben Meldungen ohne Vorfall - sofort gültig, keine Markierung."""
    w = await world(flow)
    confirmed = await both_report(flow, w)
    assert confirmed["awaiting_confirmation"] is False
    match = await stored(flow, w)
    assert match["status"] == "completed" and all("status" not in game and "incident_id" not in game for game in match["games"])


@pytest.mark.asyncio
async def test_a_rejected_incident_holds_the_result_until_the_series_is_settled(flow):
    w = await world(flow)
    incident_id = await reported(flow, w)
    rejected = await answered(flow, w, incident_id, False)
    assert rejected.status_code == 200 and rejected.json()["state"] == "in_review", rejected.text
    entry = (await stored(flow, w))["incidents"][0]
    assert entry["review_cause"] == "rejected" and entry["closed_at"] is None, "abgelehnt ist kein Ruhezustand"

    # Melden bleibt möglich, Bestätigen ruht: Zwei gleiche Meldungen werden kein Ergebnis.
    held = await both_report(flow, w)
    assert held["awaiting_confirmation"] is True and held["report_status"] == "clarification"
    assert "Map 2 ist in Klärung" in held["result_hold"]
    match = await stored(flow, w)
    assert match["status"] != "completed" and "games" not in match and not match.get("results")
    standings = await flow.get(f"/api/tournaments/{w['tournament']['id']}/standings")
    assert standings.status_code == 200 and all(not row.get("played") for row in standings.json()), "nicht in der Tabelle"

    # Auch die Leitung trägt kein Ergebnis ein, solange nicht entschieden ist.
    flow.act_as(w["staff"])
    entered = await flow.post(f"/api/matches/{w['match']['id']}/result", json={
        "results": two_nil(w)["results"], "games": two_nil(w)["games"]})
    assert entered.status_code == 409 and "zuerst über den Vorfall entscheiden" in entered.json()["detail"]

    shown = await page(flow, w)
    assert shown["league"]["map_state"][1] == {"position": 2, "state": "in_clarification"}
    assert shown["league"]["incident_info"]["hold"]["code"] == "in_review"
    assert shown["league"]["incidents"][0]["can_decide"] is True

    # Entscheidung „keine Maßnahme“ mit Feststellung: Das Bestätigen hat nur geruht - jetzt gilt das Ergebnis.
    decided = await decide(flow, w, incident_id, "no_action", settle=SETTLE)
    assert decided.status_code == 200 and decided.json()["result_confirmed"] is True, decided.text
    match = await stored(flow, w)
    assert match["status"] == "completed" and len(match["games"]) == 2
    assert all("status" not in game for game in match["games"]), "ohne Wiederholung keine Markierung"
    standings = await flow.get(f"/api/tournaments/{w['tournament']['id']}/standings")
    assert sorted(row["played"] for row in standings.json()) == [1, 1], "Gegenprobe: mit gültigem Ergebnis steht das Spiel in der Tabelle"
    decision = match["incidents"][0]["decision"]
    assert decision["outcome"] == "no_action" and decision["by"] == w["staff"]["id"] and decision["settled_at"]
    actions = {row["action"] for row in await flow.db.audit_logs.find({"action": {"$regex": "^match.incident"}}, {"_id": 0}).to_list(20)}
    assert actions == {"match.incident.report", "match.incident.answer", "match.incident.decide"}
    logged = str(await flow.db.audit_logs.find({"action": {"$regex": "^match.incident"}}, {"_id": 0, "actor_id": 0}).to_list(20))
    assert "Verbindung der Löwen" not in logged and "Nachweise beider Seiten" not in logged, "kein freier Text im Protokoll"


@pytest.mark.asyncio
async def test_an_unanswered_incident_goes_to_review_once_and_tells_everyone_once(flow):
    w = await world(flow)
    incident_id = await reported(flow, w)
    now = now_utc()
    assert (await league_incidents.sweep(flow.db, now=now + timedelta(minutes=9)))["expired"] == 0, "die Antwortzeit läuft noch"
    assert (await stored(flow, w))["incidents"][0]["state"] == "proposed"

    stale = await stored(flow, w)
    assert (await league_incidents.sweep(flow.db, now=now + timedelta(minutes=11)))["expired"] == 1
    match = await stored(flow, w)
    assert match["incidents"][0]["state"] == "in_review" and match["incidents"][0]["review_cause"] == "expired"
    assert match["incident_due_at"] is None

    async def told() -> list[dict]:
        return await flow.db.notifications.find({"meta.dedupe_key": f"incident:{incident_id}:review"}, {"_id": 0}).to_list(50)

    first = await told()
    receivers = sorted(row["user_id"] for row in first)
    assert w["staff"]["id"] in receivers and w["users"]["Kapitaen"]["id"] in receivers and w["users"]["Falke1"]["id"] in receivers
    assert len(receivers) == len(set(receivers))

    # Zweiter Lauf: findet nichts mehr. Ein Lauf mit altem Stand schreibt nicht und schickt nichts.
    assert (await league_incidents.sweep(flow.db, now=now + timedelta(minutes=12)))["expired"] == 0
    assert (await deadline_sweep(flow.db, now=now + timedelta(minutes=13)))["incidents"] == {"expired": 0}
    with pytest.raises(league_incidents.IncidentProblem):
        await league_incidents.expire_due(flow.db, stale, now=now + timedelta(minutes=11))
    assert len(await told()) == len(first), "keine zweite Nachricht"
    logged = await flow.db.audit_logs.count_documents({"action": "match.incident.expire"})
    assert logged == 1

    # Nach der Frist antwortet niemand mehr.
    late = await answered(flow, w, incident_id, True)
    assert late.status_code == 409


@pytest.mark.asyncio
async def test_a_late_answer_expires_the_incident_in_the_same_step(flow):
    w = await world(flow)
    incident_id = await reported(flow, w)
    past = (now_utc() - timedelta(minutes=1)).isoformat()
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"incidents.0.answer_deadline": past, "incident_due_at": past}})
    late = await answered(flow, w, incident_id, True)
    assert late.status_code == 409 and "Antwortzeit ist vorbei" in late.json()["detail"]
    entry = (await stored(flow, w))["incidents"][0]
    assert entry["state"] == "in_review" and entry["review_cause"] == "expired" and entry["answer"] is None


@pytest.mark.asyncio
async def test_the_deadline_automatic_rests_during_clarification(flow):
    w = await world(flow)
    tournament = await flow.db.tournaments.find_one({"id": w["tournament"]["id"]}, {"_id": 0})
    flow.act_as(w["users"]["Kapitaen"])
    assert (await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=lions(w)))).status_code == 200
    before = match_deadlines.auto_confirm_due(await stored(flow, w), tournament)
    assert before is not None, "Gegenprobe: ohne Vorfall läuft die Frist"

    incident_id = await reported(flow, w, who="Falke1")
    assert match_deadlines.auto_confirm_due(await stored(flow, w), tournament) is None, "offener Vorfall: die Frist ruht"
    assert (await answered(flow, w, incident_id, False, who="Kapitaen")).status_code == 200
    assert match_deadlines.auto_confirm_due(await stored(flow, w), tournament) is None, "in Klärung: die Frist ruht"
    # Auch der Fristen-Job trägt nichts ein, selbst lange nach der Frist.
    swept = await deadline_sweep(flow.db, now=now_utc() + timedelta(days=30))
    assert swept["confirmed"] == 0 and (await stored(flow, w))["status"] != "completed"

    assert (await decide(flow, w, incident_id, "no_action")).status_code == 200
    assert match_deadlines.auto_confirm_due(await stored(flow, w), tournament) is None, "entschieden, aber die Serie ist nicht festgestellt"
    flow.act_as(w["staff"])
    settled = await flow.post(url(w, f"/{incident_id}/settle"), json={**SETTLE, "reason": "Nichts mehr zu spielen"})
    assert settled.status_code == 200 and settled.json()["result_confirmed"] is False, settled.text
    match = await stored(flow, w)
    after = match_deadlines.auto_confirm_due(match, tournament)
    assert after is not None and after > before, "die Frist läuft ab dem Ende der Klärung"
    assert after >= league_incidents.confirm_clock(match) + timedelta(hours=24)


@pytest.mark.asyncio
async def test_pause_series_refuses_later_maps_and_continue_takes_them(flow):
    w = await world(flow)
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"clarification_mode": "pause_series"}})
    incident_id = await reported(flow, w, position=1)
    assert (await answered(flow, w, incident_id, False)).status_code == 200
    flow.act_as(w["users"]["Kapitaen"])
    report = two_nil(w, lineup=lions(w))
    paused = await flow.post(f"/api/matches/{w['match']['id']}/report", json=report)
    assert paused.status_code == 409 and "Map 1 ist in Klärung und die Serie pausiert" in paused.json()["detail"]
    assert not (await stored(flow, w)).get("reports")

    # Gegenprobe im selben Spiel: „weiterspielen unter Vorbehalt“ nimmt die Meldung an - gültig wird sie nicht.
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"clarification_mode": "continue"}})
    taken = await flow.post(f"/api/matches/{w['match']['id']}/report", json=report)
    assert taken.status_code == 200 and taken.json()["report_status"] == "clarification"

    # Nach der Entscheidung hält auch „Serie pausiert“ keine Meldung mehr auf.
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"clarification_mode": "pause_series"}})
    assert (await decide(flow, w, incident_id, "no_action", settle=SETTLE)).status_code == 200
    flow.act_as(w["users"]["Falke1"])
    confirmed = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=falcons(w)))
    assert confirmed.status_code == 200 and confirmed.json()["awaiting_confirmation"] is False


@pytest.mark.asyncio
async def test_only_the_right_people_act(flow):
    w = await world(flow)
    # Fremde und einfache Mitglieder melden nicht.
    for name in ("Fremd", "Mila"):
        flow.act_as(w["users"][name])
        refused = await flow.post(url(w), json=incident(w))
        assert refused.status_code == 403, name
    incident_id = await reported(flow, w)

    # Die meldende Seite antwortet nicht selbst, die Gegenseite zieht nicht zurück, Fremde tun gar nichts.
    assert (await answered(flow, w, incident_id, True, who="Kapitaen")).status_code == 403
    flow.act_as(w["users"]["Falke1"])
    assert (await flow.post(url(w, f"/{incident_id}/withdraw"))).status_code == 403
    flow.act_as(w["users"]["Fremd"])
    assert (await flow.post(url(w, f"/{incident_id}/answer"), json={"accept": True})).status_code == 403
    assert (await flow.post(url(w, f"/{incident_id}/withdraw"))).status_code == 403
    assert (await stored(flow, w))["incidents"][0]["state"] == "proposed"

    # Was wer sieht: Fremde und Gäste nur den Stand je Map, Mitglieder beider Seiten den Vorfall.
    for viewer in (w["users"]["Fremd"], None):
        flow.act_as(viewer)
        seen = await page(flow, w)
        assert seen["league"]["incidents"] == [] and seen["league"]["incident_info"] is None and "incidents" not in seen["match"]
    flow.act_as(w["users"]["Mila"])
    seen = await page(flow, w)
    assert [row["id"] for row in seen["league"]["incidents"]] == [incident_id]
    assert seen["league"]["incident_info"]["can_report"] is False, "melden nur Captain und Vertreter"
    flow.act_as(w["users"]["Falke1"])
    own = (await page(flow, w))["league"]["incidents"][0]
    assert own["can_answer"] is True and own["can_withdraw"] is False and own["reported_by"]["name"] and "user_id" not in str(own)

    assert (await answered(flow, w, incident_id, False)).status_code == 200

    # Entscheiden: nicht die Seiten, nicht Fremde, nicht die befangene Leitung - nur eine zweite, unbeteiligte Person.
    for name in ("Kapitaen", "Falke1", "Fremd"):
        flow.act_as(w["users"][name])
        refused = await flow.post(url(w, f"/{incident_id}/decision"), json={"outcome": "no_action", "reason": "Passt schon so"})
        assert refused.status_code == 403, name
    biased = w["users"]["FalLeitung"]
    biased["areas"] = ["leagues"]
    await flow.db.users.update_one({"id": biased["id"]}, {"$set": {"areas": ["leagues"]}})
    flow.act_as(biased)
    refused = await flow.post(url(w, f"/{incident_id}/decision"), json={"outcome": "awarded", "registration_id": w["reg_h"]["id"],
                                                                        "reason": "Meine Falken haben recht"})
    assert refused.status_code == 403 and "selbst beteiligt" in refused.json()["detail"]
    assert (await flow.post(url(w, f"/{incident_id}/settle"), json={**SETTLE, "reason": "Nichts mehr zu spielen"})).status_code == 403
    seen = (await page(flow, w))["league"]
    assert seen["incidents"][0]["can_decide"] is False and seen["incident_info"]["can_decide"] is False
    assert seen["incident_info"]["conflict"]["kind"] == "involved", "die Seite sagt, warum hier nichts zu entscheiden steht"
    assert (await stored(flow, w))["incidents"][0]["state"] == "in_review"

    decided = await decide(flow, w, incident_id, "no_action")
    assert decided.status_code == 200 and decided.json()["state"] == "decided", decided.text
    # Ein entschiedener Vorfall lässt sich nicht noch einmal entscheiden, beantworten oder zurückziehen.
    assert (await decide(flow, w, incident_id, "replay")).status_code == 409
    assert (await answered(flow, w, incident_id, True)).status_code == 409


@pytest.mark.asyncio
async def test_a_biased_superadmin_decides_only_as_an_emergency_with_a_reason(flow):
    w = await world(flow)
    incident_id = await reported(flow, w)
    assert (await answered(flow, w, incident_id, False)).status_code == 200
    boss = w["users"]["LoeLeitung"]
    boss["role"] = "superadmin"
    await flow.db.users.update_one({"id": boss["id"]}, {"$set": {"role": "superadmin"}})
    flow.act_as(boss)
    seen = (await page(flow, w))["league"]
    assert seen["incident_info"]["conflict"] == {"kind": "involved", "override": True} and seen["incidents"][0]["can_decide"] is True
    body = {"outcome": "no_action", "reason": "Beide Seiten gehört"}
    plain = await flow.post(url(w, f"/{incident_id}/decision"), json=body)
    assert plain.status_code == 403 and "Notausnahme" in plain.json()["detail"]
    assert (await stored(flow, w))["incidents"][0]["state"] == "in_review"
    forced = await flow.post(url(w, f"/{incident_id}/decision"), json={**body, "conflict_reason": "Niemand sonst erreichbar"})
    assert forced.status_code == 200, forced.text
    entry = (await stored(flow, w))["incidents"][0]
    assert entry["state"] == "decided" and entry["decision"]["conflict_reason"] == "Niemand sonst erreichbar"
    logged = await flow.db.audit_logs.find({"action": "league.conflict.override"}, {"_id": 0}).to_list(5)
    assert [row["data"]["action"] for row in logged] == ["incident_decide"]
    # Den Grund der Notausnahme sieht keine Seite.
    flow.act_as(w["users"]["Falke1"])
    assert "Niemand sonst erreichbar" not in str((await page(flow, w))["league"])


@pytest.mark.asyncio
async def test_inputs_answer_with_a_german_sentence(flow):
    w = await world(flow)
    flow.act_as(w["users"]["Kapitaen"])

    async def refused(body: dict, words: str, code: int = 422):
        response = await flow.post(url(w), json=body)
        assert response.status_code == code, response.text
        assert words in str(response.json()["detail"]), response.json()["detail"]

    await refused(incident(w, kind="stromausfall"), "was passiert ist")
    await refused(incident(w, position=4), "Bitte die Map wählen (1 bis 3)")
    await refused(incident(w, proposal=None), "Vorschlag wählen")
    await refused(incident(w, score={w["reg_a"]["id"]: 3}), "Stand beider Seiten")
    await refused(incident(w, players=[w["users"]["Fremd"]["id"]]), "aus den Kadern")
    await refused(incident(w, kind="other", note="  "), "kurz beschreiben")
    await refused(incident(w, between_maps=True), "nur bei einer Pause")
    await refused(incident(w, kind="pause", between_maps=True, proposal=None, score=None), "Länge der Pause")
    assert not (await stored(flow, w)).get("incidents")

    first = await reported(flow, w, players=ids(w, "Mila"))
    await refused(incident(w), "läuft schon ein Vorfall", 409)
    flow.act_as(w["users"]["Kapitaen"])
    assert (await flow.post(url(w, "/gibt-es-nicht/withdraw"))).status_code == 404
    withdrawn = await flow.post(url(w, f"/{first}/withdraw"))
    assert withdrawn.status_code == 200 and withdrawn.json()["state"] == "withdrawn"
    match = await stored(flow, w)
    assert match["incidents"][0]["closed_at"] and match["incident_due_at"] is None
    assert league_incidents.result_block(match) is None, "zurückgezogen hält nichts mehr auf"

    # Außerhalb einer Liga-Staffel gibt es die Vorfälle nicht.
    plain = await flow.create_tournament(status="live")
    other = {"id": "kein-liga-spiel", "tournament_id": plain["id"], "stage_id": "s", "match_type": "duel", "status": "scheduled",
             "slots": [{"slot": 1, "status": "filled", "registration_id": "x"}, {"slot": 2, "status": "filled", "registration_id": "y"}]}
    await flow.db.matches_v2.insert_one(dict(other))
    flow.act_as(w["staff"])
    assert (await flow.post("/api/matches/kein-liga-spiel/incidents", json=incident(w))).status_code == 404


@pytest.mark.asyncio
async def test_quota_is_counted_and_shown_but_never_enforced(flow):
    w = await world(flow)
    # Rehost zählt, sobald man sich einig ist.
    rehost = await reported(flow, w, kind="rehost", proposal="rehost")
    assert (await stored(flow, w))["incidents"][0]["counts_quota"] is True
    shown = (await page(flow, w))["league"]["incident_info"]["quota"]
    assert shown == {"limit": 1, "used": []}, "ein offener Vorfall zählt noch nicht"
    assert (await answered(flow, w, rehost, True)).status_code == 200

    # MOSS-Absturz zählt nie, die Map-Pause wird nur dokumentiert - ohne Antwort, ohne Nachricht.
    moss = await reported(flow, w, kind="moss_crash", proposal="continue_at_score")
    assert (await answered(flow, w, moss, True)).status_code == 200
    told_before = await flow.db.notifications.count_documents({})
    flow.act_as(w["users"]["Kapitaen"])
    pause = await flow.post(url(w), json={"position": 2, "kind": "pause", "between_maps": True, "minutes": 7})
    assert pause.status_code == 200 and pause.json()["state"] == "agreed", pause.text
    assert await flow.db.notifications.count_documents({}) == told_before
    match = await stored(flow, w)
    documented = match["incidents"][2]
    assert documented["minutes"] == 7 and documented["counts_quota"] is False and documented["proposal"] is None and documented["closed_at"]
    assert match["incidents"][1]["counts_quota"] is False

    # Über dem Kontingent: weiter meldbar, nichts wird verweigert - mit Zustimmung zählt es mit.
    second = await reported(flow, w, kind="pause", proposal="continue_at_score")
    assert (await answered(flow, w, second, True)).status_code == 200
    shown = (await page(flow, w))["league"]["incident_info"]["quota"]
    assert shown == {"limit": 1, "used": [{"registration_id": w["reg_a"]["id"], "position": 2, "count": 2}]}
    assert league_incidents.result_block(await stored(flow, w)) is None


@pytest.mark.asyncio
async def test_an_awarded_map_and_maps_that_do_not_count(flow):
    w = await world(flow)
    incident_id = await reported(flow, w, proposal="continue_at_score")
    assert (await answered(flow, w, incident_id, False)).status_code == 200
    # Unter Vorbehalt weitergespielt: gemeldet wird 2:1 mit drei Maps.
    held = await both_report(flow, w, build=two_one)
    assert held["report_status"] == "clarification"

    # Die Leitung spricht Map 2 den Löwen zu - damit stand die Serie nach Map 2 fest, Map 3 zählt nicht.
    wrong = await decide(flow, w, incident_id, "awarded")
    assert wrong.status_code == 422 and "Seite wählen" in wrong.json()["detail"]
    decided = await decide(flow, w, incident_id, "awarded", registration_id=w["reg_a"]["id"],
                           settle={"missing_positions": [], "surplus_positions": [3]})
    assert decided.status_code == 200 and decided.json()["result_confirmed"] is True, decided.text
    match = await stored(flow, w)
    assert [game["position"] for game in match["games"]] == [1, 2], "die überzählige Map steht nicht in games"
    second = match["games"][1]
    assert second["winner_registration_id"] == w["reg_a"]["id"] and second["decision"] == "awarded" and second["scores"] == {}
    assert second["incident_id"] == incident_id
    assert {row["registration_id"]: row["score"] for row in match["results"]} == {w["reg_a"]["id"]: 2, w["reg_h"]["id"]: 0}
    states = (await page(flow, w))["league"]["map_state"]
    assert states == [{"position": 1, "state": "played"}, {"position": 2, "state": "awarded"},
                      {"position": 3, "state": "open", "surplus": True}]


@pytest.mark.asyncio
async def test_no_action_keeps_all_reported_maps(flow):
    """Gegenprobe zu „zugesprochen“: Ohne Maßnahme gelten alle drei gemeldeten Maps."""
    w = await world(flow)
    incident_id = await reported(flow, w, proposal="continue_at_score")
    assert (await answered(flow, w, incident_id, False)).status_code == 200
    await both_report(flow, w, build=two_one)
    decided = await decide(flow, w, incident_id, "no_action", settle=SETTLE)
    assert decided.json()["result_confirmed"] is True
    match = await stored(flow, w)
    assert [game["position"] for game in match["games"]] == [1, 2, 3]
    assert {row["registration_id"]: row["score"] for row in match["results"]} == {w["reg_a"]["id"]: 2, w["reg_h"]["id"]: 1}


@pytest.mark.asyncio
async def test_a_decided_replay_is_settled_in_two_steps(flow):
    w = await world(flow)
    incident_id = await reported(flow, w, proposal="continue_at_score")
    assert (await answered(flow, w, incident_id, False)).status_code == 200

    # Wiederholung: Die Serie lässt sich nicht im selben Schritt feststellen - die Map wird erst gespielt.
    at_once = await decide(flow, w, incident_id, "replay", settle=SETTLE)
    assert at_once.status_code == 422 and "erst gespielt" in at_once.json()["detail"]
    decided = await decide(flow, w, incident_id, "replay")
    assert decided.status_code == 200 and decided.json()["hold"]["code"] == "rereport", decided.text
    assert "Map 2 wird wiederholt – danach meldet ihr die Serie neu" in decided.json()["hold"]["text"]
    entry = (await stored(flow, w))["incidents"][0]
    assert entry["voided"]["score"] == {w["reg_a"]["id"]: 3, w["reg_h"]["id"]: 4} and entry["decision"]["settled_at"] is None

    # Die Wiederholung ist gespielt und gemeldet - gültig wird das Ergebnis erst mit der Feststellung.
    held = await both_report(flow, w)
    assert held["report_status"] == "clarification" and "stellt die Serie noch fest" in held["result_hold"]
    flow.act_as(w["staff"])
    missing = await flow.post(url(w, f"/{incident_id}/settle"), json={"missing_positions": [3], "surplus_positions": [], "reason": "Map 3 fehlt noch"})
    assert missing.status_code == 200 and missing.json()["hold"]["code"] == "missing", missing.text
    assert (await stored(flow, w))["status"] != "completed"
    both = await flow.post(url(w, f"/{incident_id}/settle"), json={"missing_positions": [3], "surplus_positions": [3], "reason": "Unklar"})
    assert both.status_code == 422
    short = await flow.post(url(w, f"/{incident_id}/settle"), json={**SETTLE, "reason": "ok"})
    assert short.status_code == 422, "die Feststellung braucht eine Begründung"

    settled = await flow.post(url(w, f"/{incident_id}/settle"), json={**SETTLE, "reason": "Serie mit 2:0 entschieden"})
    assert settled.status_code == 200 and settled.json()["result_confirmed"] is True, settled.text
    match = await stored(flow, w)
    assert match["status"] == "completed" and len(match["games"]) == 2
    assert match["games"][1]["status"] == "replayed" and match["games"][1]["incident_id"] == incident_id
    # Nach dem gültigen Ergebnis wird nichts mehr festgestellt.
    again = await flow.post(url(w, f"/{incident_id}/settle"), json={**SETTLE, "reason": "Noch einmal"})
    assert again.status_code == 409


@pytest.mark.asyncio
async def test_agreeing_to_a_replay_never_confirms_reports_made_before_it(flow):
    """Beide Seiten melden 2:0 unter Vorbehalt, danach einigen sie sich auf die Wiederholung von Map 2: Die alten Meldungen
    beschreiben die ungültige Austragung und werden nie zum Ergebnis."""
    w = await world(flow)
    incident_id = await reported(flow, w)
    held = await both_report(flow, w)
    assert held["report_status"] == "clarification"

    agreed = await answered(flow, w, incident_id, True)
    assert agreed.status_code == 200, agreed.text
    assert agreed.json()["result_confirmed"] is False and agreed.json()["hold"]["code"] == "rereport"
    match = await stored(flow, w)
    assert match["status"] != "completed" and "games" not in match and not match.get("results")
    assert len(match["reports"]) == 2, "die alten Meldungen bleiben als Verlauf stehen"
    assert league_incidents.current_reports(match) == []

    # Beide Seiten und die Leitung lesen, was jetzt gilt; die Seiten bekommen wieder das leere Meldeformular.
    for viewer in (w["users"]["Kapitaen"], w["users"]["Falke1"], w["staff"]):
        flow.act_as(viewer)
        seen = await page(flow, w)
        assert "Map 2 wird wiederholt – danach meldet ihr die Serie neu" in seen["league"]["incident_info"]["hold"]["text"]
        assert seen["league"]["incident_info"]["hold"]["code"] == "rereport"
    flow.act_as(w["users"]["Falke1"])
    seen = await page(flow, w)
    assert seen["report_state"]["status"] == "open" and seen["league"]["proposal_games"] == [] and seen["league"]["own_games"] == []
    told = await flow.db.notifications.find({"meta.dedupe_key": f"incident:{incident_id}:answered"}, {"_id": 0, "body": 1}).to_list(5)
    assert told and all("danach meldet ihr die Serie neu" in row["body"] for row in told)

    # Dieselbe Meldung noch einmal ist keine Wiederholung der alten: Sie zählt neu. Erst die zweite neue Meldung bestätigt.
    flow.act_as(w["users"]["Kapitaen"])
    first = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=lions(w)))
    assert first.status_code == 200 and first.json()["idempotent_replay"] is False and first.json()["report_status"] == "waiting"
    assert (await stored(flow, w))["status"] != "completed"
    flow.act_as(w["users"]["Falke1"])
    second = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=falcons(w)))
    assert second.status_code == 200 and second.json()["awaiting_confirmation"] is False
    match = await stored(flow, w)
    assert match["status"] == "completed" and match["games"][1]["status"] == "replayed" and match["games"][1]["incident_id"] == incident_id


@pytest.mark.asyncio
async def test_agreeing_to_continue_confirms_matching_reports_at_once(flow):
    """Gegenprobe: Ohne Neustart oder Wiederholung bleiben die Meldungen gültig - das Bestätigen hat nur geruht."""
    w = await world(flow)
    incident_id = await reported(flow, w, proposal="continue_at_score")
    await both_report(flow, w)
    agreed = await answered(flow, w, incident_id, True)
    assert agreed.status_code == 200 and agreed.json()["result_confirmed"] is True, agreed.text
    match = await stored(flow, w)
    assert match["status"] == "completed" and all("status" not in game for game in match["games"])


@pytest.mark.asyncio
async def test_a_single_report_from_before_a_replay_is_never_confirmed_by_the_deadline(flow):
    w = await world(flow)
    tournament = await flow.db.tournaments.find_one({"id": w["tournament"]["id"]}, {"_id": 0})
    flow.act_as(w["users"]["Kapitaen"])
    assert (await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=lions(w)))).status_code == 200
    incident_id = await reported(flow, w, who="Falke1")
    assert (await answered(flow, w, incident_id, True, who="Kapitaen")).status_code == 200
    match = await stored(flow, w)
    assert match_deadlines.single_report(match) is None and match_deadlines.auto_confirm_due(match, tournament) is None
    swept = await deadline_sweep(flow.db, now=now_utc() + timedelta(days=5))
    assert swept["confirmed"] == 0
    match = await stored(flow, w)
    assert match["status"] != "completed" and "games" not in match

    # Gegenprobe: Eine Meldung nach der Wiederholung läuft wieder in die Frist-Automatik und trägt die Markierung.
    flow.act_as(w["users"]["Kapitaen"])
    assert (await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=lions(w)))).status_code == 200
    match = await stored(flow, w)
    assert match_deadlines.auto_confirm_due(match, tournament) is not None
    swept = await deadline_sweep(flow.db, now=now_utc() + timedelta(days=5))
    assert swept["confirmed"] == 1
    match = await stored(flow, w)
    assert match["status"] == "completed" and match["games"][1]["status"] == "replayed"


@pytest.mark.asyncio
async def test_a_decided_replay_is_only_settled_after_it_was_reported_again(flow):
    """Beide melden 2:0, die Leitung entscheidet „wiederholen“: Feststellen geht erst, wenn danach neu gemeldet ist."""
    w = await world(flow)
    incident_id = await reported(flow, w)
    assert (await answered(flow, w, incident_id, False)).status_code == 200
    await both_report(flow, w)
    assert (await decide(flow, w, incident_id, "replay")).status_code == 200
    flow.act_as(w["staff"])
    early = await flow.post(url(w, f"/{incident_id}/settle"), json={**SETTLE, "reason": "Sofort festgestellt"})
    assert early.status_code == 409 and "Map 2 wird erst neu gespielt" in early.json()["detail"]
    match = await stored(flow, w)
    assert match["status"] != "completed" and match["incidents"][0]["decision"]["settled_at"] is None
    seen = (await page(flow, w))["league"]
    assert seen["incidents"][0]["can_settle"] is False and seen["incidents"][0]["awaits_replay"] is True
    assert seen["incident_info"]["hold"]["code"] == "rereport"

    # Eine Seite meldet neu: Jetzt lässt sich feststellen; gültig wird das Ergebnis mit der zweiten neuen Meldung.
    flow.act_as(w["users"]["Kapitaen"])
    again = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=lions(w)))
    assert again.status_code == 200 and "stellt die Serie noch fest" in again.json()["result_hold"]
    flow.act_as(w["staff"])
    assert (await page(flow, w))["league"]["incidents"][0]["can_settle"] is True
    settled = await flow.post(url(w, f"/{incident_id}/settle"), json={**SETTLE, "reason": "Wiederholung gespielt und gemeldet"})
    assert settled.status_code == 200 and settled.json()["result_confirmed"] is False, settled.text
    flow.act_as(w["users"]["Falke1"])
    confirmed = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=falcons(w)))
    assert confirmed.status_code == 200 and confirmed.json()["awaiting_confirmation"] is False
    match = await stored(flow, w)
    assert match["status"] == "completed" and match["games"][1]["status"] == "replayed"


@pytest.mark.asyncio
async def test_the_lead_records_an_incident_and_marks_a_replay_in_an_entered_result(flow):
    w = await world(flow)
    flow.act_as(w["staff"])
    taken = await flow.post(url(w), json=incident(w, proposal="replay"))
    assert taken.status_code == 200 and taken.json()["state"] == "in_review", taken.text
    entry = (await stored(flow, w))["incidents"][0]
    assert entry["reported_by"]["registration_id"] is None and entry["review_cause"] is None
    assert (await decide(flow, w, entry["id"], "replay")).status_code == 200
    # Niemand hat nach der Wiederholung gemeldet: Festzustellen gibt es noch nichts - die Leitung trägt das Ergebnis selbst ein,
    # damit steht die Serie fest.
    flow.act_as(w["staff"])
    early = await flow.post(url(w, f"/{entry['id']}/settle"), json={**SETTLE, "reason": "Wiederholung gespielt"})
    assert early.status_code == 409 and "wird erst neu gespielt" in early.json()["detail"]

    lineups = {w["reg_a"]["id"]: lions(w), w["reg_h"]["id"]: falcons(w)}
    games = [{**game, "lineups": lineups} for game in two_nil(w)["games"]]
    entered = await flow.post(f"/api/matches/{w['match']['id']}/result", json={"results": two_nil(w)["results"], "games": games})
    assert entered.status_code == 200, entered.text
    match = await stored(flow, w)
    assert match["games"][1]["status"] == "replayed" and match["games"][1]["incident_id"] == entry["id"]
    assert "status" not in match["games"][0]

    # „Mein Dienst“ ist leer, sobald nichts mehr zu entscheiden ist.
    assert await league_incidents.review_rows(flow.db, w["staff"]) == []


@pytest.mark.asyncio
async def test_my_duty_lists_open_reviews_for_an_unbiased_lead(flow):
    w = await world(flow)
    incident_id = await reported(flow, w)
    assert (await answered(flow, w, incident_id, False)).status_code == 200
    rows = await league_incidents.review_rows(flow.db, w["staff"])
    assert [(row["match_id"], row["code"], row["position"]) for row in rows] == [(w["match"]["id"], "in_review", 2)]
    biased = w["users"]["FalLeitung"]
    biased["areas"] = ["leagues"]
    await flow.db.users.update_one({"id": biased["id"]}, {"$set": {"areas": ["leagues"]}})
    assert await league_incidents.review_rows(flow.db, biased) == [], "im eigenen Spiel gibt es nichts zu entscheiden"
    assert await league_incidents.review_rows(flow.db, w["users"]["Fremd"]) == []


@pytest.mark.asyncio
async def test_settings_come_from_staffel_then_season_then_preset(flow):
    w = await world(flow)
    tournament = await flow.db.tournaments.find_one({"id": w["tournament"]["id"]}, {"_id": 0})
    assert await league_incidents.settings_for(flow.db, tournament) == {
        "map_break_after": 2, "map_break_minutes": 5, "incident_answer_minutes": 10, "incident_quota_per_map": 1,
        "clarification_mode": "continue"}
    await flow.db.league_seasons.insert_one({"id": w["season_id"], "league_id": "liga", "incident_answer_minutes": 20,
                                             "clarification_mode": "pause_series", "incident_quota_per_map": 0})
    from_season = await league_incidents.settings_for(flow.db, tournament)
    assert (from_season["incident_answer_minutes"], from_season["clarification_mode"], from_season["incident_quota_per_map"]) == (
        20, "pause_series", 0)
    own = {**tournament, "incident_answer_minutes": 5, "clarification_mode": "continue"}
    from_staffel = await league_incidents.settings_for(flow.db, own)
    assert (from_staffel["incident_answer_minutes"], from_staffel["clarification_mode"], from_staffel["incident_quota_per_map"]) == (
        5, "continue", 0)

    # Jeder Vorfall hält seine Frist fest: 20 Minuten aus der Season, eine spätere Änderung wirkt nur auf neue Fälle.
    incident_id = await reported(flow, w)
    entry = (await stored(flow, w))["incidents"][0]
    span = league_incidents.moment(entry["answer_deadline"]) - league_incidents.moment(entry["at"])
    assert span == timedelta(minutes=20)
    await flow.db.league_seasons.update_one({"id": w["season_id"]}, {"$set": {"incident_answer_minutes": 1}})
    assert (await stored(flow, w))["incidents"][0]["answer_deadline"] == entry["answer_deadline"]
    assert incident_id


@pytest.mark.asyncio
async def test_privacy_export_and_erasure(flow):
    from services import match_flow

    w = await world(flow)
    incident_id = await reported(flow, w, players=ids(w, "Mila"))
    assert (await answered(flow, w, incident_id, False)).status_code == 200
    assert (await decide(flow, w, incident_id, "no_action", settle=SETTLE)).status_code == 200

    def roles(rows: list[dict]) -> list[str]:
        return sorted(step["role"] for row in rows for step in row["steps"])

    assert roles(await match_flow.export_snapshot(flow.db, w["users"]["Kapitaen"]["id"])) == ["incident_reported"]
    assert roles(await match_flow.export_snapshot(flow.db, w["users"]["Falke1"]["id"])) == ["incident_answered"]
    assert roles(await match_flow.export_snapshot(flow.db, w["users"]["Mila"]["id"])) == ["incident_affected"]
    assert roles(await match_flow.export_snapshot(flow.db, w["staff"]["id"])) == ["incident_decided", "incident_settled"]
    assert await match_flow.export_snapshot(flow.db, w["users"]["Fremd"]["id"]) == []

    for name in ("Kapitaen", "Falke1", "Mila"):
        assert await match_flow.scrub_person(flow.db, w["users"][name]["id"]) == 1
    assert await match_flow.scrub_person(flow.db, w["staff"]["id"]) == 1
    entry = (await stored(flow, w))["incidents"][0]
    assert entry["reported_by"] == {"registration_id": w["reg_a"]["id"], "user_id": None}
    assert entry["answer"]["user_id"] is None and entry["players"] == []
    assert entry["decision"]["by"] is None and entry["decision"]["settled_by"] is None
    assert entry["note"] and entry["decision"]["reason"], "der Vorfall selbst bleibt"
