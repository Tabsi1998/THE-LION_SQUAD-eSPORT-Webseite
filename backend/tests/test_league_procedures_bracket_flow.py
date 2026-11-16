"""Verfahren und Vorfälle merken das Discord-Bracket sofort vor (#2375). Erfundene Namen.

Jede Änderung von ``contested`` - Öffnen, Zurückziehen, Entscheiden (auch über ein Ergebnis), Einspruch - und jeder geschriebene
Vorfall ruft ``discord_bracket_state.request_refresh(tournament_id, revise=True)``. Eine Liga-Staffel (``discord_skip``) postet
trotzdem nichts.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import two_nil  # noqa: E402
from league_match_world import world as league_world  # noqa: E402
from match_proof_world import user  # noqa: E402
from services import discord_bot, discord_bracket, discord_bracket_state, match_proofs  # noqa: E402
from test_league_procedures_flow import NOTE, act, completed, dispute, opened, stored  # noqa: E402

TOKEN = "test" * 6 + ".fake." + "token" * 8
EVENTS_CHANNEL = "100000000000000003"


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(match_proofs, "PROOF_DIR", tmp_path / "proofs")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def asked(monkeypatch):
    """Zähler vor der echten Vormerkung: jede Anfrage als (Turnier, revise)."""
    calls: list[tuple[str, bool]] = []
    real = discord_bracket_state.request_refresh

    def counting(tournament_id: str, *, final: bool = False, revise: bool = False) -> None:
        calls.append((tournament_id, revise))
        real(tournament_id, final=final, revise=revise)

    monkeypatch.setattr(discord_bracket_state, "request_refresh", counting)
    discord_bracket_state._dirty.clear()
    discord_bracket_state._revise.clear()
    yield calls
    discord_bracket_state._dirty.clear()
    discord_bracket_state._revise.clear()


@pytest.mark.asyncio
async def test_every_change_of_contested_asks_for_the_bracket(flow, asked):
    w = await league_world(flow)
    second = await flow.add_staff("Zweite Leitung")
    tid = w["tournament"]["id"]
    await completed(flow, w)

    def grew(before: int, step: str) -> int:
        assert len(asked) > before, f"{step}: kein request_refresh"
        assert asked[-1] == (tid, True), step
        return len(asked)

    seen = 0
    pid = await opened(flow, w)
    assert (await stored(flow, w))["contested"] is True
    seen = grew(seen, "Protest geöffnet")
    flow.act_as(user(w, "Falke1"))
    assert (await act(flow, w, pid, "withdraw")).status_code == 200
    seen = grew(seen, "zurückgezogen")

    other = await dispute(flow, w, reason_key="rule_violation", claimed=None)
    assert other.status_code == 200, other.text
    seen = grew(seen, "zweiter Protest")
    flow.act_as(w["staff"])
    kept = await act(flow, w, other.json()["procedure_id"], "decision", decision="keep", decision_note=NOTE)
    assert kept.status_code == 200, kept.text
    seen = grew(seen, "Ergebnis bleibt")

    flow.act_as(user(w, "Falke1"))
    appeal = await flow.post(f"/api/matches/{w['match']['id']}/appeals",
                             json={"against_type": "protest_decision", "ref_id": other.json()["procedure_id"],
                                   "reason": "Die Aufzeichnung wurde nicht geprüft."})
    assert appeal.status_code == 200, appeal.text
    seen = grew(seen, "Einspruch")

    # Die Leitung (nicht die der Ausgangsentscheidung) korrigiert das Ergebnis mit Grund: Das entscheidet den Einspruch mit.
    flow.act_as(second)
    fixed = await flow.post(f"/api/matches/{w['match']['id']}/result?force=true",
                            json={**two_nil(w, winner="reg_h"), "lineups_missing": True, "reason": "Die Aufzeichnung zeigt zwei Siege der Falken."})
    assert fixed.status_code == 200, fixed.text
    assert (await stored(flow, w))["contested"] is False
    grew(seen, "über das Ergebnis entschieden")
    assert list(discord_bracket_state.pending()) == [tid], "eine Vormerkung, egal wie oft"


@pytest.mark.asyncio
async def test_an_incident_asks_for_the_bracket(flow, asked):
    w = await league_world(flow)
    flow.act_as(w["users"]["Kapitaen"])
    response = await flow.post(f"/api/matches/{w['match']['id']}/incidents", json={
        "position": 2, "kind": "disconnect", "proposal": "replay", "note": "Verbindung der Löwen weg",
        "score": {w["reg_a"]["id"]: 3, w["reg_h"]["id"]: 4}, "round": 8})
    assert response.status_code == 200, response.text
    assert asked == [(w["tournament"]["id"], True)]
    flow.act_as(w["users"]["Falke1"])
    answered = await flow.post(f"/api/matches/{w['match']['id']}/incidents/{response.json()['incident_id']}/answer", json={"accept": False})
    assert answered.status_code == 200, answered.text
    assert len(asked) == 2 and asked[-1] == (w["tournament"]["id"], True)


@pytest.mark.asyncio
async def test_a_staffel_with_discord_skip_posts_nothing(flow, asked, monkeypatch):
    """Liga-Staffeln stehen auf ``discord_skip`` (league_service): Die Vormerkung kommt an, der Job postet nichts und räumt sie ab."""
    posted: list = []

    async def send_embed(*args, **kwargs):
        posted.append(args)
        return {"ok": True, "message_id": "m1"}

    for name in ("send_embed", "edit_embed", "pin_message"):
        monkeypatch.setattr(discord_bot.bot, name, send_embed)
    w = await league_world(flow)
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    saved = await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_enabled": True, "channels": {"events": EVENTS_CHANNEL}})
    assert saved.status_code == 200, saved.text
    tid = w["tournament"]["id"]
    await flow.db.tournaments.update_one({"id": tid}, {"$set": {"discord_skip": True, "is_public": True, "visibility": "public"}})
    await completed(flow, w)
    await opened(flow, w)
    assert asked == [(tid, True)] and tid in discord_bracket_state.pending()

    outcome = await discord_bracket.sweep(flow.db)
    assert outcome["checked"] == 1 and outcome["posted"] == 0 and outcome["edited"] == 0 and posted == []
    assert (await discord_bracket.refresh(flow.db, tid, revise=True))["reason"] == "author_opt_out"
    assert tid not in discord_bracket_state.pending() and not discord_bracket_state.revising(tid)


@pytest.mark.asyncio
async def test_a_failing_discord_never_holds_up_a_procedure_or_an_incident(flow, monkeypatch):
    """Discord darf ein Verfahren nie aufhalten: Wirft die Vormerkung, gelingt der Schritt trotzdem."""
    def broken(*args, **kwargs):
        raise RuntimeError("discord kaputt")

    monkeypatch.setattr(discord_bracket_state, "request_refresh", broken)
    w = await league_world(flow)
    flow.act_as(w["users"]["Kapitaen"])
    response = await flow.post(f"/api/matches/{w['match']['id']}/incidents", json={
        "position": 2, "kind": "disconnect", "proposal": "replay", "note": "Verbindung der Löwen weg",
        "score": {w["reg_a"]["id"]: 3, w["reg_h"]["id"]: 4}, "round": 8})
    assert response.status_code == 200, response.text
    await opened(flow, w)
    assert (await stored(flow, w))["status"] == "disputed"
