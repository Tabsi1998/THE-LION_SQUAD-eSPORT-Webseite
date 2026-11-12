"""Verfahren der Liga (E.2, #1619, #2297): die Befunde der unabhängigen Prüfung als Tests. Erfundene Namen.

Jeder Test prüft das richtige Verhalten und seine Gegenprobe: Wertung kampflos und Verfahrensregeln, Zurückziehen und die
Frist-Automatik, gekürzte Verfahren in jeder Antwort mit dem rohen Spiel, Eskalation, überschriebene Entscheidung, Längen,
geänderte Paarung, Notausnahme des Superadmins, MOSS-ZIP.
"""
import io
import pathlib
import sys
import zipfile
from datetime import timedelta

import pytest
import pytest_asyncio
from fastapi import HTTPException
from pydantic import ValidationError

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import world as league_world  # noqa: E402
from match_proof_world import user  # noqa: E402
from models import MatchDisputeDecision, MatchV2ResultSubmit, now_utc  # noqa: E402
from services import league_procedure_sweep, league_procedures, match_proofs  # noqa: E402
from services.match_attention import tournament_attention  # noqa: E402
from services.match_deadlines import auto_confirm_due  # noqa: E402
from services.match_disputes import open_dispute  # noqa: E402
from services.match_v2_results import _pairing_reset_fields  # noqa: E402
from test_league_procedures_flow import NOTE, REASON, act, claim, completed, opened, page, stored  # noqa: E402

LONG_NOTE = "Die Falken sind zum Termin nicht erschienen."
PROCEDURE_ONLY = {"at", "id", "kind", "state"}
HIDDEN = {"moss_requests", "assignee", "statement", "notified_immediately", "resolved_by", "additions"}


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(match_proofs, "PROOF_DIR", tmp_path / "proofs")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def forfeit(flow, w, note: str, *, force: bool = False):
    return await flow.post(f"/api/matches/{w['match']['id']}/forfeit{'?force=true' if force else ''}",
                           json={"forfeit_registration_id": w["reg_h"]["id"], "note": note})


def row_in(payload, w) -> dict:
    match = payload if isinstance(payload, dict) else next(item for item in payload if item["id"] == w["match"]["id"])
    return match["disputes"][0]


# ---------------------------------------------------------------- H2: Zurückziehen und die Frist-Automatik

@pytest.mark.asyncio
async def test_a_withdrawn_objection_lets_the_deadline_run_again(flow):
    w = await league_world(flow)
    at = (now_utc() - timedelta(hours=1)).isoformat()
    report = {"registration_id": w["reg_a"]["id"], "user_id": user(w, "Kapitaen")["id"], "at": at,
              "results": [{"registration_id": w["reg_a"]["id"], "score": 2}, {"registration_id": w["reg_h"]["id"], "score": 0}]}
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"status": "waiting_result", "reports": [report]}})
    tournament = await flow.db.tournaments.find_one({"id": w["tournament"]["id"]}, {"_id": 0})
    before = auto_confirm_due(await stored(flow, w), tournament)
    assert before is not None

    pid = await opened(flow, w, reason_key="rule_violation", claimed=None)
    halted = await stored(flow, w)
    assert halted["status"] == "disputed" and auto_confirm_due(halted, tournament) is None, "solange es läuft, ruht die Automatik"
    assert open_dispute(halted)["id"] == pid

    assert (await act(flow, w, pid, "withdraw")).status_code == 200
    after = await stored(flow, w)
    assert after["status"] == "waiting_result" and auto_confirm_due(after, tournament) == before, "danach gilt die Frist wieder"
    assert open_dispute(after) is None, "ein zurückgezogenes Verfahren ist kein offener Streitfall mehr"


# ---------------------------------------------------------------- H1: Wertung kampflos und die Regeln des Verfahrens

@pytest.mark.asyncio
async def test_a_forfeit_cannot_decide_an_appeal_for_the_original_decider(flow):
    w = await league_world(flow)
    second = await flow.add_staff("Zweite Leitung")
    await completed(flow, w)
    pid = await opened(flow, w)
    flow.act_as(w["staff"])
    assert (await act(flow, w, pid, "decision", decision="keep", decision_note=NOTE)).status_code == 200
    flow.act_as(user(w, "Falke1"))
    appeal = await flow.post(f"/api/matches/{w['match']['id']}/appeals",
                             json={"against_type": "protest_decision", "ref_id": pid, "reason": "Die Aufzeichnung wurde nicht geprüft."})
    aid = appeal.json()["procedure_id"]

    flow.act_as(w["staff"])
    own = await forfeit(flow, w, LONG_NOTE, force=True)
    assert own.status_code == 409 and "Ausgangsentscheidung" in own.json()["detail"]
    match = await stored(flow, w)
    entry = next(row for row in match["disputes"] if row["id"] == aid)
    assert entry["state"] == "open" and match["status"] == "completed", "nichts geschrieben, der Einspruch bleibt offen"

    flow.act_as(second)
    other = await forfeit(flow, w, LONG_NOTE, force=True)
    assert other.status_code == 200, other.text
    entry = next(row for row in (await stored(flow, w))["disputes"] if row["id"] == aid)
    assert entry["state"] == "decided" and entry["resolved_by"] == second["id"] and entry["decision_note"] == LONG_NOTE


@pytest.mark.asyncio
async def test_a_forfeit_on_an_open_objection_needs_the_right_and_a_reason(flow):
    w = await league_world(flow)
    pid = await opened(flow, w)
    flow.act_as(w["staff"])
    short = await forfeit(flow, w, "nicht da")
    assert short.status_code == 422 and "begründen" in short.json()["detail"]
    entry = (await stored(flow, w))["disputes"][0]
    assert entry["state"] == "open" and not entry.get("decision"), "keine Entscheidung ohne Pflichtbegründung"

    # Ohne das Recht „Proteste“ entscheidet auch eine Wertung kein Verfahren - der Service prüft es, nicht nur die Route.
    refusal = await league_procedures.result_decision_refusal(flow.db, await stored(flow, w), actor_id=user(w, "Fremd")["id"],
                                                              note=LONG_NOTE, by_players=False)
    assert refusal and refusal[0] == 409 and "Proteste" in refusal[1]
    players = await league_procedures.result_decision_refusal(flow.db, await stored(flow, w), actor_id=None, note=None, by_players=True)
    assert players and players[0] == 409

    done = await forfeit(flow, w, LONG_NOTE)
    assert done.status_code == 200, done.text
    match = await stored(flow, w)
    entry = match["disputes"][0]
    assert entry["id"] == pid and entry["state"] == "decided" and entry["decision_note"] == LONG_NOTE and match["status"] == "forfeit"
    assert await league_procedures.result_decision_refusal(flow.db, match, actor_id=None, note=None, by_players=True) is None, \
        "Gegenprobe: ohne offenes Verfahren greift die Regel nicht"


# ---------------------------------------------------------------- H3: Verfahren nur gekürzt im rohen Spiel

@pytest.mark.asyncio
async def test_the_raw_match_never_shows_foreign_procedure_details(flow):
    w = await league_world(flow)
    await completed(flow, w)
    pid = await opened(flow, w, reason_key="cheating", claimed=None)
    flow.act_as(w["staff"])
    assert (await act(flow, w, pid, "assign")).status_code == 200
    assert (await act(flow, w, pid, "moss-requests", user_id=user(w, "Mila")["id"])).status_code == 200
    urls = (f"/api/matches/{w['match']['id']}", f"/api/tournaments/{w['tournament']['id']}/matches-v2")

    # Wer eingereicht hat, behält Grund und Text der eigenen Meldung - nicht die MOSS-Anforderung der Gegenseite.
    flow.act_as(user(w, "Falke1"))
    for url in urls:
        own = row_in((await flow.get(url)).json(), w)
        assert own["reason"] == REASON and own["reason_key"] == "cheating" and not HIDDEN & set(own), url
    # Die Gegenseite und Fremde: nur, dass es ein Verfahren gibt.
    for name in ("Mila", "Fremd"):
        flow.act_as(user(w, name))
        assert set(row_in((await flow.get(urls[0])).json(), w)) == PROCEDURE_ONLY, name

    # Liga-Personal ohne „Proteste“ und „Ergebnisse“ sieht das Spiel, aber keine Inhalte des Verfahrens.
    helper = await flow.add_user(name="Helferin")
    await flow.db.league_staff.insert_one({"id": "ls-1", "league_id": "liga", "user_id": helper["id"], "capabilities": ["matches"]})
    flow.act_as({**helper, "mfa_enabled": True, "auth_mfa_verified": True})
    for url in urls:
        seen = await flow.get(url)
        assert seen.status_code == 200, url
        assert set(row_in(seen.json(), w)) == PROCEDURE_ONLY, url

    # Gegenprobe: Die nicht befangene Leitung mit „Proteste“ sieht alles.
    flow.act_as(w["staff"])
    for url in urls:
        full = row_in((await flow.get(url)).json(), w)
        assert full["moss_requests"] and full["assignee"]["user_id"] == w["staff"]["id"], url


@pytest.mark.asyncio
async def test_a_repeated_submission_returns_the_match_without_foreign_details(flow):
    w = await league_world(flow)
    await completed(flow, w)
    other = await opened(flow, w, "Kapitaen", reason="Unser eigener Protest wegen der Ausrüstung der Falken.", reason_key="equipment",
                         notified_immediately=False, claimed=None)
    flow.act_as(w["staff"])
    assert (await act(flow, w, other, "moss-requests", user_id=user(w, "Falke2")["id"])).status_code == 200
    await opened(flow, w, "Falke1")
    again = await flow.post(f"/api/matches/{w['match']['id']}/dispute", json={"reason": REASON, "reason_key": "wrong_result", "claimed": claim(w)})
    assert again.status_code == 200 and again.json()["idempotent_replay"] is True
    theirs = next(row for row in again.json()["disputes"] if row.get("id") == other)
    assert set(theirs) == PROCEDURE_ONLY, "das Verfahren der Gegenseite nur gekürzt"
    mine = next(row for row in again.json()["disputes"] if row.get("id") != other)
    assert mine["reason"] == REASON and not HIDDEN & set(mine)


# ---------------------------------------------------------------- Eskalation, Abgleich, Längen, Paarung

@pytest.mark.asyncio
async def test_a_second_escalation_is_delivered(flow):
    w = await league_world(flow)
    await flow.add_staff("Liga-Leitung")
    await completed(flow, w)
    pid = await opened(flow, w)

    async def overdue() -> None:
        rows = (await stored(flow, w))["disputes"]
        rows[0]["escalate_at"] = (now_utc() - timedelta(hours=1)).isoformat()
        await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"disputes": rows}})

    async def sent() -> int:
        return await flow.db.notifications.count_documents({"meta.reason": "procedure_escalated"})

    assert (await stored(flow, w))["disputes"][0]["escalate_at"], "die Frist steht am Verfahren"
    assert (await league_procedure_sweep.sweep(flow.db))["escalated"] == 0 and await sent() == 0, "vor der Frist geschieht nichts"
    await overdue()
    assert (await league_procedure_sweep.sweep(flow.db))["escalated"] == 1
    first = await sent()
    assert first >= 1
    assert (await league_procedure_sweep.sweep(flow.db))["escalated"] == 0 and await sent() == first, "dieselbe Eskalation nur einmal"

    flow.act_as(w["staff"])
    assert (await act(flow, w, pid, "assign")).status_code == 200
    await overdue()
    assert (await league_procedure_sweep.sweep(flow.db))["escalated"] == 1
    assert await sent() > first, "nach einer neuen Übernahme wird die zweite Eskalation zugestellt"


@pytest.mark.asyncio
async def test_an_old_snapshot_cannot_overwrite_a_decision_made_by_a_result(flow):
    w = await league_world(flow)
    await completed(flow, w)
    await opened(flow, w)
    snapshot = await stored(flow, w)   # so liest der Zeit-Job
    await league_procedures.close_on_result(flow.db, snapshot, actor_id=w["staff"]["id"], now_iso=now_utc().isoformat(),
                                            decision="change", note="Korrektur nach Prüfung der Aufzeichnung.")
    assert (await stored(flow, w))["updated_at"] != snapshot["updated_at"]
    row = {**snapshot["disputes"][0], "escalated_at": now_utc().isoformat()}
    with pytest.raises(league_procedures.ProcedureProblem):
        await league_procedures._save_row(flow.db, snapshot, row)
    after = (await stored(flow, w))["disputes"][0]
    assert after["state"] == "decided" and after["decision"] == "change" and not after.get("escalated_at")
    # Gegenprobe: auf dem frischen Stand schreibt derselbe Weg.
    fresh = await stored(flow, w)
    saved = await league_procedures._save_row(flow.db, fresh, {**fresh["disputes"][0], "reminded_at": "x"})
    assert saved["disputes"][0]["reminded_at"] == "x"


def test_the_reason_of_a_decision_has_one_length_everywhere():
    assert league_procedures.NOTE_MAX == 2000
    long = "x" * 2000
    assert MatchV2ResultSubmit(results=[{"registration_id": "a", "score": 1}], reason=long).reason == long
    assert MatchDisputeDecision(decision="keep", note=long).note == long
    for build in (lambda: MatchV2ResultSubmit(results=[{"registration_id": "a", "score": 1}], reason=long + "x"),
                  lambda: MatchDisputeDecision(decision="keep", note=long + "x")):
        with pytest.raises(ValidationError):
            build()


def test_a_changed_pairing_closes_procedures_by_state_too():
    match = {"disputes": [
        {"id": "p1", "kind": "objection", "state": "open", "at": "2026-11-01T10:00:00+00:00"},
        {"at": "2026-11-01T11:00:00+00:00", "reason": "alt"},
        {"id": "p0", "kind": "protest", "state": "decided", "resolved_at": "2026-10-30T10:00:00+00:00", "decision": "keep"},
    ]}
    procedure, legacy, done = _pairing_reset_fields(match, "2026-11-02T10:00:00+00:00")["disputes"]
    assert procedure["state"] == "decided" and procedure["decision"] == "void" and procedure["resolved_at"]
    assert legacy["decision"] == "void" and "state" not in legacy, "Altbestand bekommt kein neues Feld"
    assert done["decision"] == "keep", "Entschiedenes bleibt, wie es war"
    assert league_procedures.open_rows({"disputes": [procedure, legacy, done]}) == []


# ---------------------------------------------------------------- Leitung: Notausnahme, Entschuldigen, Aufmerksamkeit

@pytest.mark.asyncio
async def test_an_involved_superadmin_acts_only_as_an_emergency_exception_with_a_reason(flow):
    w = await league_world(flow)
    await completed(flow, w)
    pid = await opened(flow, w)
    await flow.db.users.update_one({"id": user(w, "Mila")["id"]}, {"$set": {"role": "superadmin"}})
    flow.act_as({**user(w, "Mila"), "role": "superadmin"})
    seen = next(row for row in (await page(flow, w))["league"]["procedures"] if row["id"] == pid)
    assert seen["can_lead"] is True and "notified_immediately" not in seen and "submitted_by" not in seen, "handeln ja, sehen wie die Seite"
    without = await act(flow, w, pid, "assign")
    assert without.status_code == 403 and (await stored(flow, w))["disputes"][0]["assignee"] is None
    with_reason = await act(flow, w, pid, "assign", conflict_reason="Niemand sonst mit dem Recht ist erreichbar.")
    assert with_reason.status_code == 200, with_reason.text
    logged = await flow.db.audit_logs.find_one({"action": "league.conflict.override"}, {"_id": 0})
    assert logged and logged["data"]["action"] == "procedure_assign"

    # Gegenprobe: Ein befangenes Mitglied mit Liga-Recht, aber ohne Superadmin, bekommt die Knöpfe nicht.
    await flow.db.users.update_one({"id": user(w, "Tom")["id"]}, {"$set": {"areas": ["leagues"]}})
    flow.act_as({**user(w, "Tom"), "areas": ["leagues"]})
    assert next(row for row in (await page(flow, w))["league"]["procedures"] if row["id"] == pid)["can_lead"] is False
    assert (await act(flow, w, pid, "assign", conflict_reason="Niemand sonst mit dem Recht ist erreichbar.")).status_code == 403


@pytest.mark.asyncio
async def test_excusing_a_moss_file_needs_an_open_procedure(flow):
    w = await league_world(flow)
    await completed(flow, w)
    pid = await opened(flow, w, reason_key="cheating", claimed=None)
    flow.act_as(w["staff"])
    assert (await act(flow, w, pid, "moss-requests", user_id=user(w, "Mila")["id"])).status_code == 200
    rid = (await stored(flow, w))["disputes"][0]["moss_requests"][0]["id"]
    assert (await act(flow, w, pid, "decision", decision="keep", decision_note=NOTE)).status_code == 200
    late = await act(flow, w, pid, f"moss-requests/{rid}/excuse", reason="Der PC war nachweislich defekt.")
    assert late.status_code == 409 and (await stored(flow, w))["disputes"][0]["moss_requests"][0]["state"] == "requested"


@pytest.mark.asyncio
async def test_attention_names_the_reason_of_the_season_and_the_league_lead(flow):
    w = await league_world(flow)
    tournament = await flow.db.tournaments.find_one({"id": w["tournament"]["id"]}, {"_id": 0})

    async def case() -> dict:
        items, _matches = await tournament_attention(flow.db, tournament, now=now_utc())
        return next(item for item in items if item["match_id"] == w["match"]["id"])

    await opened(flow, w, reason_key="cheating", claimed=None)
    objection = await case()
    assert objection["kind"] == "dispute" and objection["title"] == "Beanstandung eingegangen" and "Cheat-Verdacht" in objection["detail"]
    assert "Sonstiges" not in objection["detail"], "nicht der Ersatzwert aus category"
    await completed(flow, w, disputes=[])
    await opened(flow, w, "Kapitaen", reason_key="cheating", claimed=None)
    protest = await case()
    assert protest["kind"] == "procedure" and "Cheat-Verdacht" in protest["detail"]


# ---------------------------------------------------------------- MOSS-ZIP

def _zip(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return buffer.getvalue()


def test_check_zip_accepts_a_moss_archive_and_refuses_everything_else(tmp_path):
    good = {"ok": _zip({"moss/screen1.jpg": b"\xff\xd8" + b"a" * 2000, "moss/log.txt": b"hello"})}
    bad = {
        "traversal": _zip({"../evil.txt": b"x"}), "backslash": _zip({"..\\evil.txt": b"x"}), "absolute": _zip({"/etc/passwd": b"x"}),
        "drive": _zip({"C:/x.txt": b"x"}), "exe": _zip({"a/b.EXE": b"MZ"}), "nested": _zip({"inner.zip": _zip({"a.txt": b"x"})}),
        "nested_tar": _zip({"inner.tar.gz": b"x" * 10}), "bomb": _zip({"big.txt": b"\0" * (5 * 1024 * 1024)}),
        "prefix_sfx": b"MZ" + _zip({"a.txt": b"x"}), "empty": _zip({}), "html": _zip({"index.html": b"<script>alert(1)</script>"}),
    }
    for name, data in {**good, **bad}.items():
        path = tmp_path / f"{name}.zip"
        path.write_bytes(data)
        if name in good:
            assert match_proofs.check_zip(path)["entries"] == 2
        else:
            with pytest.raises(HTTPException) as refused:
                match_proofs.check_zip(path)
            assert refused.value.status_code == 422, name


@pytest.mark.asyncio
async def test_a_moss_zip_is_always_a_download_and_only_a_zip_counts(flow):
    w = await league_world(flow)
    await completed(flow, w)
    pid = await opened(flow, w, reason_key="cheating", claimed=None)
    flow.act_as(user(w, "Mila"))
    data = _zip({"moss/screen1.jpg": b"\xff\xd8" + b"a" * 2000})

    async def upload(name: str, mime: str = "application/zip"):
        return await flow.post(f"/api/matches/{w['match']['id']}/proofs", data={"kind": "moss", "ref_id": pid}, files={"file": (name, data, mime)})

    tar = await upload("moss.tar.gz", "application/gzip")
    assert tar.status_code == 422 and tar.json()["detail"] == match_proofs.ONLY_ZIP
    disguised = await upload("moss.dat")
    assert disguised.status_code >= 400, "der angegebene Inhaltstyp macht keine ZIP"
    assert await flow.db.match_proof_photos.count_documents({}) == 0

    proof = (await upload("moss.zip")).json()
    assert proof["type"] == "file"
    for url in (proof["url"], f"/api/matches/{w['match']['id']}/proof-photos/{proof['id']}"):
        got = await flow.get(url)
        assert got.status_code == 200 and got.content == data, url
        assert got.headers["content-disposition"].startswith("attachment") and got.headers["content-type"] == "application/zip", url
        assert got.headers["x-content-type-options"] == "nosniff", url
    flow.act_as(user(w, "Falke1"))
    assert (await flow.get(f"/api/matches/{w['match']['id']}/proof-photos/{proof['id']}")).status_code == 404, "die Gegenseite nie"
