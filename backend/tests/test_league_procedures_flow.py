"""Verfahren der Liga (E.2, #1619, #2297): Beanstandung, Protest, Einspruch, Stellungnahme, Zuständige und MOSS-Datei. Erfundene Namen.

Geprüft wird mit echten Routen in einer Liga-Staffel (Löwen gegen Falken, ``league_match_world``): wer was darf und sieht, dass Fristen
in Sperrzeiten ruhen, dass nichts automatisch gewertet wird - und dass Turniere ohne Liga bleiben, wie sie sind. Jede Regel hat ihre
Gegenprobe.
"""
import io
import pathlib
import sys
import zipfile
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import world as league_world  # noqa: E402
from match_proof_world import add_image, ids_seen, listed, season, user  # noqa: E402
from models import now_utc  # noqa: E402
from services import league_procedure_sweep, league_procedures, league_protest_settings, match_proofs  # noqa: E402
from services.league_service import SYNC_GROUPS  # noqa: E402
from services.match_proof_refs import parse  # noqa: E402
from services.match_proof_retention import purge  # noqa: E402

REASON = "Die zweite Map wurde falsch gemeldet, wir haben sie gewonnen."
NOTE = "Die Aufzeichnung zeigt das gemeldete Ergebnis."


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(match_proofs, "PROOF_DIR", tmp_path / "proofs")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def stored(flow, w) -> dict:
    return await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})


async def completed(flow, w, *, hours_ago: float = 1, **extra) -> None:
    """Das Spiel ist bestätigt: Löwen 2:0."""
    at = (now_utc() - timedelta(hours=hours_ago)).isoformat()
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {
        "status": "completed", "completed_at": at, "completed_by": w["staff"]["id"], "updated_at": at,
        "result_meta": {"confirmed_at": at},
        "results": [{"registration_id": w["reg_a"]["id"], "rank": 1, "score": 2, "outcome": "winner"},
                    {"registration_id": w["reg_h"]["id"], "rank": 2, "score": 0, "outcome": "loser"}], **extra}})


def claim(w, a: int = 1, h: int = 2) -> dict:
    return {"results": [{"registration_id": w["reg_a"]["id"], "score": a}, {"registration_id": w["reg_h"]["id"], "score": h}]}


def body(w, **extra) -> dict:
    return {"reason": REASON, "reason_key": "wrong_result", "claimed": claim(w), **extra}


async def dispute(flow, w, **extra):
    return await flow.post(f"/api/matches/{w['match']['id']}/dispute", json=body(w, **extra))


async def opened(flow, w, who: str = "Falke1", **extra) -> str:
    flow.act_as(user(w, who))
    response = await dispute(flow, w, **extra)
    assert response.status_code == 200, response.text
    return response.json()["procedure_id"]


async def act(flow, w, pid: str, action: str, **json):
    return await flow.post(f"/api/matches/{w['match']['id']}/procedures/{pid}/{action}", json=json)


async def page(flow, w) -> dict:
    response = await flow.get(f"/api/matches/{w['match']['id']}/page")
    assert response.status_code == 200, response.text
    return response.json()


async def procedure_seen(flow, w, pid: str) -> dict | None:
    return next((row for row in (await page(flow, w))["league"]["procedures"] if row["id"] == pid), None)


async def actions(flow, name: str) -> list[dict]:
    return await flow.db.audit_logs.find({"action": name}, {"_id": 0}).to_list(50)


# ---------------------------------------------------------------- Einstellungen

@pytest.mark.asyncio
async def test_settings_have_presets_validate_and_reach_unlocked_staffeln(flow):
    w = await league_world(flow)
    await season(flow, w)
    locked = await flow.create_tournament(league_context={"league_id": "liga", "season_id": w["season_id"], "division_id": "liga-1",
                                                           "staffel": "B"}, locked_at=now_utc().isoformat())
    flow.act_as(w["staff"])
    url = f"/api/admin/leagues/seasons/{w['season_id']}/protest-settings"
    start = (await flow.get(url)).json()
    assert start["active"] is False and start["settings"] == league_protest_settings.defaults()
    assert start["settings"]["protest_hours"] == 48 and start["settings"]["contested_result_mode"] == "counts"
    assert start["settings"]["protest_escalate_hours"] == 24
    assert (await flow.put(url, json={"protest_escalate_hours": 0})).status_code == 422
    assert [row["key"] for row in start["settings"]["protest_reasons"] if row["ask_notified"]] == ["equipment", "lobby", "player"]

    too_long = await flow.put(url, json={"protest_hours": 337})
    assert too_long.status_code == 422 and "Protestfrist" in too_long.json()["detail"]
    wrong_mode = await flow.put(url, json={"contested_result_mode": "vielleicht"})
    assert wrong_mode.status_code == 422
    without_fixed = await flow.put(url, json={"protest_reasons": [{"key": "other", "label": "Sonstiges"}]})
    assert without_fixed.status_code == 422 and "Falsches Ergebnis" in without_fixed.json()["detail"]

    reasons = [*start["settings"]["protest_reasons"], {"key": "stream", "label": "Stream-Verzögerung", "ask_notified": True}]
    saved = await flow.put(url, json={"protest_hours": 72, "contested_result_mode": "excluded", "protest_reasons": reasons})
    assert saved.status_code == 200, saved.text
    assert saved.json()["active"] is True and saved.json()["staffeln_updated"] == 1
    staffel = await flow.db.tournaments.find_one({"id": w["tournament"]["id"]}, {"_id": 0})
    assert staffel["protest_hours"] == 72 and staffel["contested_result_mode"] == "excluded"
    assert staffel["protest_reasons"][-1] == {"key": "stream", "label": "Stream-Verzögerung", "ask_notified": True}
    untouched = await flow.db.tournaments.find_one({"id": locked["id"]}, {"_id": 0})
    assert "protest_hours" not in untouched, "eine gesperrte Staffel bleibt, wie sie ist"
    assert set(SYNC_GROUPS["protests"]) == set(league_protest_settings.FIELDS)
    logged = await actions(flow, "league.season.protest_settings")
    assert logged[0]["data"]["changed"] and "Stream" not in str(logged[0]["data"]), "kein Inhalt im Protokoll"

    flow.act_as(user(w, "Fremd"))
    assert (await flow.get(url)).status_code == 403 and (await flow.put(url, json={"protest_hours": 24})).status_code == 403


# ---------------------------------------------------------------- Einreichen

@pytest.mark.asyncio
async def test_objection_before_confirmation_halts_the_match_and_needs_the_guided_fields(flow):
    w = await league_world(flow)
    flow.act_as(user(w, "Falke1"))
    short = await dispute(flow, w, reason="zu kurz")
    assert short.status_code == 422
    no_claim = await flow.post(f"/api/matches/{w['match']['id']}/dispute", json={"reason": REASON, "reason_key": "wrong_result"})
    assert no_claim.status_code == 422 and "Ergebnis" in no_claim.json()["detail"]
    not_asked = await flow.post(f"/api/matches/{w['match']['id']}/dispute", json={"reason": REASON, "reason_key": "equipment"})
    assert not_asked.status_code == 422 and "sofort" in not_asked.json()["detail"]
    unknown = await flow.post(f"/api/matches/{w['match']['id']}/dispute", json={"reason": REASON, "reason_key": "erfunden"})
    assert unknown.status_code == 422
    assert not (await stored(flow, w)).get("disputes"), "nichts davon wurde gespeichert"

    pid = await opened(flow, w, reason_key="equipment", notified_immediately=True, claimed=None)
    match = await stored(flow, w)
    entry = match["disputes"][0]
    assert entry["id"] == pid and entry["kind"] == "objection" and entry["state"] == "open"
    assert entry["reason_key"] == "equipment" and entry["category"] == "other" and entry["notified_immediately"] is True
    assert match["status"] == "disputed" and match["status_before_dispute"] == "scheduled" and not match.get("contested")
    assert entry["statement"]["registration_id"] == w["reg_a"]["id"] and entry["evidence_until"]
    logged = (await actions(flow, "match.procedure.open"))[0]["data"]
    assert logged == {"match_id": w["match"]["id"], "procedure_id": pid, "kind": "objection", "reason_key": "equipment",
                      "reason_length": len(REASON)}, "Kennungen und Längen, kein Text"


@pytest.mark.asyncio
async def test_a_call_without_the_new_fields_is_stored_with_the_reason_from_category(flow):
    w = await league_world(flow)
    flow.act_as(user(w, "Falke1"))
    old = await flow.post(f"/api/matches/{w['match']['id']}/dispute", json={"reason": "Stimmt nicht", "category": "technical"})
    assert old.status_code == 200, old.text
    entry = (await stored(flow, w))["disputes"][0]
    assert entry["kind"] == "objection" and entry["reason_key"] == "technical" and entry["category"] == "technical" and entry["id"]


@pytest.mark.asyncio
async def test_one_open_procedure_per_side_and_the_other_side_may_open_its_own(flow):
    w = await league_world(flow)
    await completed(flow, w)
    pid = await opened(flow, w)
    second = await dispute(flow, w, reason=REASON + " Noch einmal.", reason_key="rule_violation", claimed=None)
    assert second.status_code == 409 and "Ergänzt" in second.json()["detail"]
    added = await flow.patch(f"/api/matches/{w['match']['id']}/procedures/{pid}", json={"addition": "Dazu kommt die Aufzeichnung ab Minute zwölf."})
    assert added.status_code == 200, added.text
    assert len((await stored(flow, w))["disputes"][0]["additions"]) == 1

    other = await opened(flow, w, "Kapitaen", reason_key="rule_violation", claimed=None)
    rows = (await stored(flow, w))["disputes"]
    assert [row["id"] for row in rows] == [pid, other] and all(row["state"] == "open" for row in rows)

    # Ergänzen nur die eigene Seite und nur bis zur Frist.
    flow.act_as(user(w, "Kapitaen"))
    foreign = await flow.patch(f"/api/matches/{w['match']['id']}/procedures/{pid}", json={"addition": "Das stimmt so alles nicht, wirklich."})
    assert foreign.status_code == 403
    rows[0]["evidence_until"] = (now_utc() - timedelta(minutes=1)).isoformat()
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"disputes": rows}})
    flow.act_as(user(w, "Falke1"))
    late = await flow.patch(f"/api/matches/{w['match']['id']}/procedures/{pid}", json={"addition": "Noch eine späte Ergänzung dazu."})
    assert late.status_code == 409


@pytest.mark.asyncio
async def test_withdrawing_is_logged_and_blocks_a_new_one_with_the_same_reason(flow):
    w = await league_world(flow)
    pid = await opened(flow, w)
    assert (await stored(flow, w))["status"] == "disputed"
    flow.act_as(user(w, "Kapitaen"))
    not_mine = await act(flow, w, pid, "withdraw")
    assert not_mine.status_code == 403, "nur die einreichende Seite"
    flow.act_as(user(w, "Falke1"))
    gone = await act(flow, w, pid, "withdraw")
    assert gone.status_code == 200, gone.text
    match = await stored(flow, w)
    entry = match["disputes"][0]
    assert entry["state"] == "withdrawn" and entry["withdrawn_by"] == user(w, "Falke1")["id"] and entry["withdrawn_at"]
    assert match["status"] == "scheduled" and "status_before_dispute" not in match, "das Spiel läuft weiter wie vorher"
    assert (await actions(flow, "match.procedure.withdraw"))[0]["data"]["reason_key"] == "wrong_result"
    again = await act(flow, w, pid, "withdraw")
    assert again.status_code == 409

    same = await dispute(flow, w)
    assert same.status_code == 409 and "zurückgezogen" in same.json()["detail"]
    different = await dispute(flow, w, reason_key="rule_violation", claimed=None)
    assert different.status_code == 200, "ein anderer Grund bleibt möglich"


@pytest.mark.asyncio
async def test_incident_must_belong_to_the_same_match(flow):
    w = await league_world(flow)
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"incidents": [{"id": "vorfall-1", "position": 2, "kind": "disconnect"}]}})
    flow.act_as(user(w, "Falke1"))
    foreign = await dispute(flow, w, incident_id="vorfall-eines-anderen-spiels")
    assert foreign.status_code == 422 and foreign.json()["detail"] == league_procedures.INCIDENT_DETAIL
    assert not (await stored(flow, w)).get("disputes")
    pid = await opened(flow, w, incident_id="vorfall-1")
    assert (await stored(flow, w))["disputes"][0]["incident_id"] == "vorfall-1"

    # Die Leitung trägt nach oder ändert - nie auf einen Vorfall, den es hier nicht gibt.
    flow.act_as(w["staff"])
    url = f"/api/matches/{w['match']['id']}/procedures/{pid}"
    assert (await flow.patch(url, json={"incident_id": "fremd"})).status_code == 422
    cleared = await flow.patch(url, json={"incident_id": None})
    assert cleared.status_code == 200, cleared.text
    assert (await stored(flow, w))["disputes"][0]["incident_id"] is None
    logged = (await actions(flow, "match.procedure.amend"))[0]["data"]
    assert logged["incident_from"] == "vorfall-1" and logged["incident_to"] is None and logged["by"] == "lead"


# ---------------------------------------------------------------- Protest: Fristen, Tabelle, Entscheidung

@pytest.mark.asyncio
async def test_protest_window_runs_from_confirmation_and_rests_in_blocked_periods(flow):
    w = await league_world(flow)
    await completed(flow, w, hours_ago=47)
    flow.act_as(user(w, "Falke1"))
    assert (await page(flow, w))["can_dispute"] is True, "in der Liga 48 Stunden, nicht 30 Minuten"
    await completed(flow, w, hours_ago=49)
    info = await page(flow, w)
    assert info["can_dispute"] is False and info["league"]["procedure_form"]["open"] is False
    late = await dispute(flow, w)
    assert late.status_code == 409 and late.json()["detail"] == league_procedures.WINDOW_CLOSED_DETAIL

    # Sperrzeit: Die zwei Tage seit der Bestätigung zählen nicht mit - die Frist läuft erst danach.
    day = now_utc().date()
    blocked = [{"start_date": (day - timedelta(days=3)).isoformat(), "end_date": (day + timedelta(days=1)).isoformat(), "label": "Pause"}]
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"blocked_periods": blocked}})
    pid = await opened(flow, w)
    entry = (await stored(flow, w))["disputes"][0]
    assert entry["id"] == pid and entry["kind"] == "protest"
    resumes = now_utc() + timedelta(hours=24)
    assert parse(entry["evidence_until"]) > resumes + timedelta(hours=40), "48 Stunden ab dem Ende der Sperrzeit"
    assert parse(entry["statement"]["due_at"]) > resumes + timedelta(hours=40), "auch die Stellungnahme ruht"


@pytest.mark.asyncio
async def test_contested_result_counts_or_is_excluded_in_the_table(flow):
    from services.scoring_rules import LEAGUE_TABLE_DEFAULTS

    w = await league_world(flow)
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"scoring_rules": dict(LEAGUE_TABLE_DEFAULTS)}})
    await completed(flow, w)

    async def table() -> dict:
        response = await flow.get(f"/api/tournaments/{w['tournament']['id']}/standings")
        assert response.status_code == 200, response.text
        payload = response.json()
        rows = payload if isinstance(payload, list) else payload.get("standings") or payload.get("rows") or []
        return {row["registration_id"]: row for row in rows}

    flow.act_as(user(w, "Falke1"))
    before = await table()
    assert before[w["reg_a"]["id"]]["played"] == 1 and before[w["reg_a"]["id"]]["contested"] == 0

    pid = await opened(flow, w)
    match = await stored(flow, w)
    assert match["status"] == "completed" and match["contested"] is True, "counts: das Ergebnis bleibt stehen"
    counted = await table()
    assert counted[w["reg_a"]["id"]]["played"] == 1 and counted[w["reg_a"]["id"]]["won"] == 1
    assert counted[w["reg_a"]["id"]]["contested"] == 1 and counted[w["reg_h"]["id"]]["contested"] == 1
    assert (await act(flow, w, pid, "withdraw")).status_code == 200
    assert (await stored(flow, w))["contested"] is False and (await table())[w["reg_a"]["id"]]["contested"] == 0

    # excluded: Das Spiel zählt bis zur Entscheidung nicht.
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"contested_result_mode": "excluded"}})
    flow.act_as(user(w, "Kapitaen"))
    other = await dispute(flow, w, reason_key="rule_violation", claimed=None)
    assert other.status_code == 200, other.text
    match = await stored(flow, w)
    assert match["status"] == "disputed" and match["status_before_dispute"] == "completed" and not match.get("contested")
    excluded = await table()
    assert excluded[w["reg_a"]["id"]]["played"] == 0 and excluded[w["reg_a"]["id"]]["contested"] == 0

    flow.act_as(w["staff"])
    kept = await act(flow, w, other.json()["procedure_id"], "decision", decision="keep", decision_note=NOTE)
    assert kept.status_code == 200, kept.text
    match = await stored(flow, w)
    assert match["status"] == "completed" and (await table())[w["reg_a"]["id"]]["played"] == 1, "nach der Entscheidung zählt es wieder"


@pytest.mark.asyncio
async def test_statement_assignee_and_decision_with_a_mandatory_note(flow):
    w = await league_world(flow)
    await completed(flow, w)
    pid = await opened(flow, w)

    # Stellungnahme: nur die Gegenseite, nur in der Frist - die Leitung kann verlängern.
    wrong_side = await act(flow, w, pid, "statement", text="Wir sehen das naturgemäß ganz anders.")
    assert wrong_side.status_code == 403
    flow.act_as(user(w, "Kapitaen"))
    said = await act(flow, w, pid, "statement", text="Die Map wurde korrekt gemeldet, siehe Aufzeichnung.")
    assert said.status_code == 200, said.text
    rows = (await stored(flow, w))["disputes"]
    rows[0]["statement"]["due_at"] = (now_utc() - timedelta(minutes=1)).isoformat()
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"disputes": rows}})
    assert (await act(flow, w, pid, "statement", text="Eine zweite Fassung nach Ablauf der Frist.")).status_code == 409
    assert (await act(flow, w, pid, "statement/extend", hours=24)).status_code == 403, "verlängern kann nur die Leitung"
    flow.act_as(w["staff"])
    longer = await act(flow, w, pid, "statement/extend", hours=24)
    assert longer.status_code == 200, longer.text
    slot = (await stored(flow, w))["disputes"][0]["statement"]
    assert parse(slot["due_at"]) > now_utc() + timedelta(hours=23) and slot["extended_by"] == w["staff"]["id"]

    # Übernehmen: sichtbar für beide Seiten, mit Zielfrist.
    taken = await act(flow, w, pid, "assign")
    assert taken.status_code == 200, taken.text
    entry = (await stored(flow, w))["disputes"][0]
    assert entry["assignee"]["user_id"] == w["staff"]["id"]
    assert timedelta(hours=71) < parse(entry["target_at"]) - now_utc() < timedelta(hours=73)
    for name in ("Falke1", "Kapitaen"):
        flow.act_as(user(w, name))
        assert (await procedure_seen(flow, w, pid))["assignee"]["name"] == w["staff"]["display_name"]
        assert (await act(flow, w, pid, "assign")).status_code == 403, "übernehmen kann nur die Leitung"

    # Entscheiden: nie ohne Begründung, nie durch eine Seite.
    assert (await act(flow, w, pid, "decision", decision="keep", decision_note=NOTE)).status_code == 403
    flow.act_as(w["staff"])
    bare = await act(flow, w, pid, "decision", decision="keep", decision_note="ok")
    assert bare.status_code == 422 and (await stored(flow, w))["disputes"][0]["state"] == "open"
    done = await act(flow, w, pid, "decision", decision="keep", decision_note=NOTE)
    assert done.status_code == 200, done.text
    match = await stored(flow, w)
    entry = match["disputes"][0]
    assert entry["state"] == "decided" and entry["decision"] == "keep" and entry["decision_note"] == NOTE
    assert entry["resolved_by"] == w["staff"]["id"] and parse(entry["appeal_until"]) > now_utc() + timedelta(hours=47)
    assert match["status"] == "completed" and match["contested"] is False
    logged = (await actions(flow, "match.procedure.decide"))[0]["data"]
    assert logged["decision"] == "keep" and logged["note_length"] == len(NOTE) and NOTE not in str(logged)
    assert (await act(flow, w, pid, "decision", decision="keep", decision_note=NOTE)).status_code == 409, "nur einmal"


@pytest.mark.asyncio
async def test_a_whole_protest_ends_with_a_corrected_result(flow):
    """Ganzer Protest: einreichen, Stellung nehmen, übernehmen, Ergebnis korrigieren - die Korrektur mit Grund entscheidet ihn."""
    from league_match_world import two_nil

    w = await league_world(flow)
    await completed(flow, w)
    pid = await opened(flow, w)
    flow.act_as(user(w, "Kapitaen"))
    assert (await act(flow, w, pid, "statement", text="Aus unserer Sicht stimmt die Meldung so.")).status_code == 200
    flow.act_as(w["staff"])
    assert (await act(flow, w, pid, "assign")).status_code == 200
    correction = {**two_nil(w, winner="reg_h"), "lineups_missing": True}
    url = f"/api/matches/{w['match']['id']}/result?force=true"
    without_reason = await flow.post(url, json={**correction, "reason": "kurz"})
    assert without_reason.status_code == 422 and "begründen" in without_reason.json()["detail"]
    assert (await stored(flow, w))["disputes"][0]["state"] == "open"
    reason = "Die Aufzeichnung zeigt zwei Siege der Falken."
    fixed = await flow.post(url, json={**correction, "reason": reason})
    assert fixed.status_code == 200, fixed.text
    match = await stored(flow, w)
    entry = match["disputes"][0]
    assert entry["state"] == "decided" and entry["decision"] == "change" and entry["decision_note"] == reason
    assert entry["resolved_by"] == w["staff"]["id"] and entry["appeal_until"]
    assert match["status"] == "completed" and match["contested"] is False
    winner = next(row for row in match["results"] if row["rank"] == 1)
    assert winner["registration_id"] == w["reg_h"]["id"], "das Ergebnis ist korrigiert"
    table = await flow.get(f"/api/tournaments/{w['tournament']['id']}/standings")
    assert table.status_code == 200


# ---------------------------------------------------------------- Einspruch

@pytest.mark.asyncio
async def test_an_appeal_is_decided_by_another_person_and_only_once(flow):
    w = await league_world(flow)
    second = await flow.add_staff("Zweite Leitung")
    await completed(flow, w)
    pid = await opened(flow, w)
    flow.act_as(w["staff"])
    assert (await act(flow, w, pid, "decision", decision="keep", decision_note=NOTE)).status_code == 200

    flow.act_as(user(w, "Falke1"))
    seen = await procedure_seen(flow, w, pid)
    assert seen["can_appeal"] is True and seen["decision_note"] == NOTE
    appeal_url = f"/api/matches/{w['match']['id']}/appeals"
    appeal = await flow.post(appeal_url, json={"against_type": "protest_decision", "ref_id": pid, "reason": "Die Aufzeichnung wurde nicht geprüft."})
    assert appeal.status_code == 200, appeal.text
    aid = appeal.json()["procedure_id"]
    match = await stored(flow, w)
    entry = match["disputes"][1]
    assert entry["kind"] == "appeal" and entry["against"]["ref_id"] == pid and entry["against"]["decided_by"] == w["staff"]["id"]
    assert match["status"] == "completed" and match["contested"] is True, "die Ausgangsentscheidung gilt weiter, das Spiel ist in Klärung"
    twice = await flow.post(appeal_url, json={"against_type": "protest_decision", "ref_id": pid, "reason": "Noch ein zweiter Einspruch dazu."})
    assert twice.status_code == 409 and "einmal" in twice.json()["detail"]

    # Wer die Ausgangsentscheidung traf, entscheidet nicht - auch nicht über den Umweg einer Korrektur.
    flow.act_as(w["staff"])
    for action, payload in (("assign", {}), ("decision", {"decision": "keep", "decision_note": NOTE})):
        own = await act(flow, w, aid, action, **payload)
        assert own.status_code == 403 and "Ausgangsentscheidung" in own.json()["detail"], action
    old_way = await flow.post(f"/api/matches/{w['match']['id']}/dispute/decision", json={"decision": "keep", "note": NOTE})
    assert old_way.status_code == 403
    assert (await stored(flow, w))["disputes"][1]["state"] == "open"

    flow.act_as(second)
    final = await act(flow, w, aid, "decision", decision="keep", decision_note="Die Prüfung der Aufzeichnung bestätigt die Entscheidung.")
    assert final.status_code == 200, final.text
    match = await stored(flow, w)
    assert match["disputes"][1]["state"] == "decided" and "appeal_until" not in match["disputes"][1], "endgültig"
    assert match["contested"] is False
    flow.act_as(user(w, "Falke1"))
    again = await flow.post(appeal_url, json={"against_type": "protest_decision", "ref_id": aid, "reason": "Einspruch gegen den Einspruch."})
    assert again.status_code == 409


@pytest.mark.asyncio
async def test_an_appeal_needs_an_open_period_and_a_decision(flow):
    w = await league_world(flow)
    await completed(flow, w)
    pid = await opened(flow, w)
    flow.act_as(user(w, "Kapitaen"))
    url = f"/api/matches/{w['match']['id']}/appeals"
    early = await flow.post(url, json={"against_type": "protest_decision", "ref_id": pid, "reason": "Einspruch vor der Entscheidung."})
    assert early.status_code == 409
    flow.act_as(w["staff"])
    assert (await act(flow, w, pid, "decision", decision="keep", decision_note=NOTE)).status_code == 200
    rows = (await stored(flow, w))["disputes"]
    rows[0]["appeal_until"] = (now_utc() - timedelta(minutes=1)).isoformat()
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"disputes": rows}})
    flow.act_as(user(w, "Kapitaen"))
    late = await flow.post(url, json={"against_type": "protest_decision", "ref_id": pid, "reason": "Einspruch nach Ablauf der Frist."})
    assert late.status_code == 409 and "Einspruchsfrist" in late.json()["detail"]
    no_forfeit = await flow.post(url, json={"against_type": "forfeit", "ref_id": w["match"]["id"], "reason": "Es gab hier gar keine Wertung."})
    assert no_forfeit.status_code == 409


# ---------------------------------------------------------------- Sichtbarkeit

@pytest.mark.asyncio
async def test_who_sees_what_of_a_procedure(flow):
    w = await league_world(flow)
    await completed(flow, w)
    pid = await opened(flow, w, reason_key="equipment", notified_immediately=False, claimed=claim(w))
    flow.act_as(w["staff"])
    assert (await act(flow, w, pid, "moss-requests", user_id=user(w, "Falke2")["id"])).status_code == 200

    # Die eigene Seite: alles; die MOSS-Anforderung nur die Person selbst, Captain und Vertreter.
    flow.act_as(user(w, "Falke1"))
    own = await procedure_seen(flow, w, pid)
    assert own["own"] is True and own["claimed"] == {**claim(w), "games": []} and own["notified_immediately"] is False
    assert [row["name"] for row in own["moss_requests"]] == ["Falke2"]
    flow.act_as(user(w, "Falke3"))
    assert (await procedure_seen(flow, w, pid))["moss_requests"] == [], "die übrigen Spieler sehen die Anforderung nicht"

    # Die Gegenseite: Grund, Text, Stand und das abweichende Ergebnis - ohne „sofort hingewiesen?“ und MOSS.
    flow.act_as(user(w, "Mila"))
    info = await page(flow, w)
    other = info["league"]["procedures"][0]
    assert other["reason"] == REASON and other["reason_label"] == "Ausrüstung" and other["opponent"] is True
    assert other["claimed"] == {**claim(w), "games": []}, "die Stellungnahme braucht den Bezug"
    assert "notified_immediately" not in other and other["moss_requests"] == []
    raw = info["match"]["disputes"][0]
    assert "reason" not in raw and "claimed" not in raw and "moss_requests" not in raw

    # Die nicht befangene Leitung: alles.
    flow.act_as(w["staff"])
    lead = await procedure_seen(flow, w, pid)
    assert lead["claimed"] and lead["can_lead"] is True and lead["moss_requests"][0]["state"] == "requested"

    # Fremde: nur „in Klärung“ - und 404 auf jedem Weg zum Verfahren.
    flow.act_as(user(w, "Fremd"))
    outside = await page(flow, w)
    assert outside["league"]["procedures"] == [] and outside["league"]["contested"] is True
    assert outside["league"]["procedure_form"] is None
    assert "reason" not in str(outside["match"]["disputes"]) and "claimed" not in str(outside["match"]["disputes"])
    for action, payload in (("withdraw", {}), ("statement", {"text": "Ich bin gar nicht beteiligt."}), ("assign", {})):
        assert (await act(flow, w, pid, action, **payload)).status_code == 404, action
    assert (await flow.post(f"/api/matches/{w['match']['id']}/appeals",
                            json={"against_type": "protest_decision", "ref_id": pid, "reason": "Fremder Einspruch dazu."})).status_code == 404


@pytest.mark.asyncio
async def test_a_biased_lead_is_treated_like_their_side(flow):
    w = await league_world(flow)
    await completed(flow, w)
    pid = await opened(flow, w)
    await flow.db.users.update_one({"id": user(w, "Mila")["id"]}, {"$set": {"areas": ["leagues"]}})
    user(w, "Mila")["areas"] = ["leagues"]
    flow.act_as(user(w, "Mila"))
    seen = await procedure_seen(flow, w, pid)
    assert "notified_immediately" not in seen and "submitted_by" not in seen and seen["can_lead"] is False, "wie ihre Seite, nie als Leitung"
    for action, payload in (("assign", {}), ("decision", {"decision": "keep", "decision_note": NOTE}),
                            ("moss-requests", {"user_id": user(w, "Falke2")["id"]})):
        assert (await act(flow, w, pid, action, **payload)).status_code == 403, action
    assert (await stored(flow, w))["disputes"][0]["state"] == "open"
    inbox = await flow.get(f"/api/admin/leagues/seasons/{w['season_id']}/procedures")
    if inbox.status_code == 200:
        assert all(item["conflict"] and "reason" not in item for item in inbox.json()["items"])


@pytest.mark.asyncio
async def test_the_inbox_lists_procedures_for_the_lead(flow):
    w = await league_world(flow)
    await season(flow, w)
    await completed(flow, w)
    pid = await opened(flow, w)
    flow.act_as(w["staff"])
    inbox = await flow.get(f"/api/admin/leagues/seasons/{w['season_id']}/procedures")
    assert inbox.status_code == 200, inbox.text
    item = inbox.json()["items"][0]
    assert inbox.json()["open"] == 1 and item["id"] == pid and item["match_id"] == w["match"]["id"]
    assert item["kind_label"] == "Protest" and item["reason_label"] == "Falsches Ergebnis" and item["conflict"] is False
    flow.act_as(user(w, "Falke1"))
    assert (await flow.get(f"/api/admin/leagues/seasons/{w['season_id']}/procedures")).status_code == 403


# ---------------------------------------------------------------- MOSS

def moss_zip(names=("screenshot_001.jpg", "moss.log"), *, payload: bytes = b"x" * 64, method=zipfile.ZIP_DEFLATED) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", method) as archive:
        for name in names:
            archive.writestr(name, payload)
    return buffer.getvalue()


async def upload(flow, w, pid: str, data: bytes, name: str = "moss.zip", mime: str = "application/zip"):
    return await flow.post(f"/api/matches/{w['match']['id']}/proofs", data={"kind": "moss", "ref_id": pid}, files={"file": (name, data, mime)})


@pytest.mark.asyncio
async def test_moss_zip_is_checked_without_unpacking(flow, monkeypatch):
    w = await league_world(flow)
    await completed(flow, w)
    pid = await opened(flow, w, reason_key="cheating", claimed=None)
    flow.act_as(user(w, "Falke2"))
    bomb = moss_zip(payload=b"\0" * (30 * 1024 * 1024))
    encrypted = bytearray(moss_zip())
    for marker in (b"PK\x03\x04", b"PK\x01\x02"):
        at = encrypted.find(marker)
        offset = at + (6 if marker == b"PK\x03\x04" else 8)
        encrypted[offset] |= 0x1
    refused = {
        "kein ZIP": b"Das ist nur Text mit der Endung zip.",
        "Programm": moss_zip(("screenshot.jpg", "helper.exe")),
        "Archiv im Archiv": moss_zip(("innen.zip",)),
        "Pfad nach außen": moss_zip(("../../etc/passwd",)),
        "Zip-Bombe": bomb,
        "Kennwort": bytes(encrypted),
        "leer": moss_zip(()),
    }
    for label, data in refused.items():
        response = await upload(flow, w, pid, data)
        assert response.status_code == 422, label
    assert await flow.db.match_proof_photos.count_documents({}) == 0, "nichts davon liegt auf dem Server"
    assert not list(match_proofs.PROOF_DIR.glob("*.zip")), "auch keine abgelehnte Datei auf der Platte"

    # Eigene Grenze nur für MOSS (MAX_MOSS_UPLOAD_MB, Vorgabe 200): darüber 413, die Datei wird nicht behalten.
    assert match_proofs.moss_max_mb() == 200
    monkeypatch.setenv("MAX_MOSS_UPLOAD_MB", "1")
    too_big = await upload(flow, w, pid, moss_zip(payload=bytes(range(256)) * 8192, method=zipfile.ZIP_STORED))
    assert too_big.status_code == 413 and "1 MB" in too_big.json()["detail"]
    assert not list(match_proofs.PROOF_DIR.glob("*.zip"))
    monkeypatch.delenv("MAX_MOSS_UPLOAD_MB")

    good = moss_zip()
    done = await upload(flow, w, pid, good)
    assert done.status_code == 200, done.text
    item = done.json()
    assert item["type"] == "file" and item["size"] == len(good) and len(item["sha256"]) == 64
    assert item["url"] == f"/api/matches/{w['match']['id']}/proofs/{item['id']}/file"
    saved = await flow.get(item["url"])
    assert saved.status_code == 200 and saved.content == good, "unverändert, wie hochgeladen"
    assert "attachment" in saved.headers["content-disposition"] and saved.headers["x-content-type-options"] == "nosniff"
    # Eine ZIP gibt es nur am Bezug MOSS - zur Meldung bleibt es bei Bildern.
    elsewhere = await flow.post(f"/api/matches/{w['match']['id']}/proofs", data={"kind": "protest", "ref_id": pid},
                                files={"file": ("moss.zip", good, "application/zip")})
    assert elsewhere.status_code in (400, 403, 415, 422)


@pytest.mark.asyncio
async def test_moss_file_goes_only_to_uploader_captain_and_an_unbiased_lead(flow):
    w = await league_world(flow)
    await completed(flow, w)
    pid = await opened(flow, w, reason_key="cheating", claimed=None)
    flow.act_as(user(w, "Mila"))
    item = (await upload(flow, w, pid, moss_zip())).json()
    for name, sees in (("Mila", True), ("Kapitaen", True), ("Tom", False), ("Falke1", False), ("Fremd", False)):
        flow.act_as(user(w, name))
        assert (await flow.get(item["url"])).status_code == (200 if sees else 404), name
        if name != "Fremd":
            assert (item["id"] in await ids_seen(flow, w["match"], "moss", pid)) is sees, name
    flow.act_as(w["staff"])
    assert (await flow.get(item["url"])).status_code == 200
    # Ein Bild ist über diesen Weg nie abrufbar.
    flow.act_as(user(w, "Kapitaen"))
    image = (await add_image(flow, w["match"], "moss", pid)).json()
    assert (await flow.get(f"/api/matches/{w['match']['id']}/proofs/{image['id']}/file")).status_code == 404


@pytest.mark.asyncio
async def test_a_requested_moss_file_is_tracked_and_never_judged_automatically(flow):
    w = await league_world(flow)
    await completed(flow, w)
    pid = await opened(flow, w, reason_key="cheating", claimed=None)
    mila, tom = user(w, "Mila")["id"], user(w, "Tom")["id"]
    assert (await act(flow, w, pid, "moss-requests", user_id=mila)).status_code == 403, "anfordern kann nur die Leitung"
    flow.act_as(w["staff"])
    for player in (mila, tom):
        assert (await act(flow, w, pid, "moss-requests", user_id=player)).status_code == 200
    assert (await act(flow, w, pid, "moss-requests", user_id=mila)).status_code == 409, "nicht doppelt"
    assert (await act(flow, w, pid, "moss-requests", user_id=user(w, "Fremd")["id"])).status_code == 422
    requests = (await stored(flow, w))["disputes"][0]["moss_requests"]
    assert [row["state"] for row in requests] == ["requested", "requested"]
    assert timedelta(hours=23) < parse(requests[0]["due_at"]) - now_utc() < timedelta(hours=25)

    flow.act_as(user(w, "Mila"))
    assert (await upload(flow, w, pid, moss_zip())).status_code == 200
    requests = (await stored(flow, w))["disputes"][0]["moss_requests"]
    assert [row["state"] for row in requests] == ["uploaded", "requested"]

    # Vor Fristablauf geschieht nichts, danach bekommt die Leitung einen Hinweis - gewertet wird nichts.
    before = await stored(flow, w)
    assert (await league_procedure_sweep.sweep(flow.db, now=now_utc() + timedelta(hours=23)))["moss_missing"] == 0
    counts = await league_procedure_sweep.sweep(flow.db, now=now_utc() + timedelta(hours=25))
    assert counts["moss_missing"] == 1
    after = await stored(flow, w)
    assert [row["state"] for row in after["disputes"][0]["moss_requests"]] == ["uploaded", "missing"]
    assert after["status"] == before["status"] and after["results"] == before["results"] and after["disputes"][0]["state"] == "open"
    hint = await flow.db.notifications.find_one({"user_id": w["staff"]["id"], "meta.reason": "procedure_moss_missing"}, {"_id": 0})
    assert hint and hint["meta"]["dedupe_key"].startswith(f"procedure:{pid}:")
    assert (await league_procedure_sweep.sweep(flow.db, now=now_utc() + timedelta(hours=26)))["moss_missing"] == 0, "nur einmal"

    flow.act_as(w["staff"])
    missing = after["disputes"][0]["moss_requests"][1]["id"]
    excused = await act(flow, w, pid, f"moss-requests/{missing}/excuse", reason="Der PC war nachweislich defekt.")
    assert excused.status_code == 200, excused.text
    assert (await stored(flow, w))["disputes"][0]["moss_requests"][1]["state"] == "excused"


# ---------------------------------------------------------------- Zeit-Job und Aufbewahrung

@pytest.mark.asyncio
async def test_the_sweep_reminds_and_escalates_but_never_decides(flow):
    w = await league_world(flow)
    manager = await flow.add_staff("Liga-Leitung")
    await completed(flow, w)
    pid = await opened(flow, w)
    start = now_utc()

    # Niemand übernimmt: nach der Zielfrist geht es an die Leitung mit „manage“.
    assert (await league_procedure_sweep.sweep(flow.db, now=start + timedelta(hours=47))) == {
        "reminded": 0, "escalated": 0, "statement_expired": 0, "moss_missing": 0}, "vor Ablauf jeder Frist geschieht nichts"
    early = await league_procedure_sweep.sweep(flow.db, now=start + timedelta(hours=71))
    assert early["escalated"] == 0 and early["statement_expired"] == 1, "die abgelaufene Stellungnahme erfährt die Leitung"
    assert (await league_procedure_sweep.sweep(flow.db, now=start + timedelta(hours=73)))["escalated"] == 1
    told = await flow.db.notifications.find_one({"user_id": manager["id"], "meta.reason": "procedure_escalated"}, {"_id": 0})
    assert told and "übernommen" in told["body"] and REASON not in told["body"]

    # Eskalation je Season einstellbar (``protest_escalate_hours``, Vorgabe 24): hier sechs Stunden nach der Zielfrist. Die Frist
    # wird beim Übernehmen am Verfahren gespeichert (``escalate_at``).
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"protest_escalate_hours": 6}})
    flow.act_as(w["staff"])
    assert (await act(flow, w, pid, "assign")).status_code == 200
    taken = now_utc()
    saved = (await stored(flow, w))["disputes"][0]
    assert timedelta(hours=77) < parse(saved["escalate_at"]) - taken < timedelta(hours=79) and saved["escalated_at"] is None
    assert (await league_procedure_sweep.sweep(flow.db, now=taken + timedelta(hours=71)))["reminded"] == 0
    counts = await league_procedure_sweep.sweep(flow.db, now=taken + timedelta(hours=73))
    assert counts["reminded"] == 1 and counts["escalated"] == 0 and counts["statement_expired"] == 0
    reminder = await flow.db.notifications.find_one({"user_id": w["staff"]["id"], "meta.reason": "procedure_target"}, {"_id": 0})
    assert reminder and reminder["kind"] == "match_attention"
    assert (await league_procedure_sweep.sweep(flow.db, now=taken + timedelta(hours=77)))["escalated"] == 0
    counts = await league_procedure_sweep.sweep(flow.db, now=taken + timedelta(hours=79))
    assert counts["reminded"] == 0 and counts["escalated"] == 1 and counts["statement_expired"] == 0
    match = await stored(flow, w)
    entry = match["disputes"][0]
    assert entry["state"] == "open" and "decision" not in entry and match["status"] == "completed", "keine automatische Entscheidung"
    assert entry["reminded_at"] and entry["escalated_at"] and entry["statement"]["expired_at"]


@pytest.mark.asyncio
async def test_proofs_stay_while_a_procedure_is_open(flow):
    w = await league_world(flow)
    await season(flow, w, weeks_total=1, start_date=(now_utc() - timedelta(weeks=30)).isoformat())
    flow.act_as(user(w, "Kapitaen"))
    image = (await add_image(flow, w["match"])).json()
    await completed(flow, w)
    pid = await opened(flow, w)
    flow.act_as(user(w, "Falke1"))
    proof = await flow.post(f"/api/matches/{w['match']['id']}/proofs", data={"kind": "protest", "ref_id": pid, "link": "https://video.example/beleg"})
    assert proof.status_code == 200, proof.text
    later = now_utc() + timedelta(days=400)
    await purge(flow.db, now=later)
    kept = {row["id"] for row in await flow.db.match_proof_photos.find({}, {"_id": 0, "id": 1}).to_list(10)}
    assert kept == {image["id"], proof.json()["id"]}, "solange das Verfahren läuft, bleibt jeder Nachweis"

    assert (await act(flow, w, pid, "withdraw")).status_code == 200
    await purge(flow.db, now=later)
    assert await flow.db.match_proof_photos.count_documents({}) == 0, "Gegenprobe: ohne offenes Verfahren greift die Aufbewahrung"


# ---------------------------------------------------------------- Turniere bleiben, wie sie sind

@pytest.mark.asyncio
async def test_tournaments_outside_a_league_stay_unchanged(flow):
    w = await league_world(flow)
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$unset": {"league_context": ""}})
    at = (now_utc() - timedelta(minutes=29)).isoformat()
    await completed(flow, w, completed_at=at, result_meta={"confirmed_at": at})
    flow.act_as(user(w, "Falke1"))
    info = await page(flow, w)
    assert info["can_dispute"] is True and parse(info["dispute_until"]) - now_utc() < timedelta(minutes=2), "30 Minuten"
    old = await flow.post(f"/api/matches/{w['match']['id']}/dispute", json={"reason": "Stimmt nicht", "category": "wrong_result"})
    assert old.status_code == 200, old.text
    match = await stored(flow, w)
    entry = match["disputes"][0]
    assert "kind" not in entry and "id" not in entry and entry["category"] == "wrong_result"
    assert match["status"] == "disputed" and not match.get("contested")
    assert (await act(flow, w, "irgendwas", "withdraw")).status_code == 404
    assert (await flow.post(f"/api/matches/{w['match']['id']}/appeals",
                            json={"against_type": "forfeit", "ref_id": w["match"]["id"], "reason": "Im Turnier gibt es das nicht."})).status_code == 404
    flow.act_as(w["staff"])
    kept = await flow.post(f"/api/matches/{w['match']['id']}/dispute/decision", json={"decision": "keep"})
    assert kept.status_code == 200 and kept.json()["status"] == "completed", "ohne Pflichtbegründung wie bisher"
    assert (await listed(flow, w["match"], "moss", "x")).status_code == 404

    late = (now_utc() - timedelta(minutes=31)).isoformat()
    await completed(flow, w, completed_at=late, result_meta={"confirmed_at": late}, disputes=[])
    flow.act_as(user(w, "Kapitaen"))
    too_late = await flow.post(f"/api/matches/{w['match']['id']}/dispute", json={"reason": "Zu spät gemeldet", "category": "other"})
    assert too_late.status_code == 409
