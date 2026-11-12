"""Verfahren der Liga (E.2, #1619, Nr. 133/137): Kein Weg liefert interne Inhalte eines Verfahrens an die einreichende Seite, die
Gegenseite oder an Liga-Personal ohne das Recht „Proteste“ bzw. „Ergebnisse“. Erfundene Namen.

Ein zurückgezogenes Verfahren mit MOSS-Anforderung, Entschuldigung, Zuständiger und Fristen bleibt am Spiel stehen. Danach läuft das
Spiel normal weiter - und jede Antwort, die das Spiel enthält, wird nach diesen Inhalten durchsucht.
"""
import json
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import checked_in, ids, two_nil, world as league_world  # noqa: E402
from match_proof_world import user  # noqa: E402
from services import league_procedures, match_proofs  # noqa: E402
from test_league_procedures_flow import act, opened, stored  # noqa: E402

SECRET = "INTERN-GEHEIM-Vermerk der Leitung"
# Was nur die nicht befangene Leitung sehen darf. ``assignee`` und ``statement`` stehen für Beteiligte im Block
# ``league.procedures`` der Matchseite (mit Namen statt Konten) - dort wird der Spiel-Datensatz geprüft, nicht der Block.
FORBIDDEN = ("moss_requests", "excuse_reason", SECRET, "escalate_at", "escalated_at", "notified_immediately", "withdrawn_by", "requested_by")


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(match_proofs, "PROOF_DIR", tmp_path / "proofs")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def scene(flow) -> dict:
    """Löwen gegen Falken, das Spiel steht noch aus; an ihm hängt ein zurückgezogenes Verfahren der Falken mit allem Internen."""
    w = await league_world(flow)
    pid = await opened(flow, w, reason_key="equipment", notified_immediately=False, claimed=None)
    flow.act_as(w["staff"])
    assert (await act(flow, w, pid, "assign")).status_code == 200
    assert (await act(flow, w, pid, "moss-requests", user_id=user(w, "Falke2")["id"])).status_code == 200
    rid = (await stored(flow, w))["disputes"][0]["moss_requests"][0]["id"]
    assert (await act(flow, w, pid, f"moss-requests/{rid}/excuse", reason=SECRET)).status_code == 200
    flow.act_as(user(w, "Falke1"))
    assert (await act(flow, w, pid, "withdraw")).status_code == 200
    match = await stored(flow, w)
    assert match["status"] == "scheduled" and all(key in json.dumps(match) for key in FORBIDDEN[:5]), "der Datensatz trägt das Interne"
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"admin_note": "nur für die Leitung"}})
    helper = await flow.add_user(name="Helferin")
    await flow.db.league_staff.insert_one({"id": "ls-1", "league_id": "liga", "user_id": helper["id"], "capabilities": ["matches"]})
    return {**w, "pid": pid, "helper": {**helper, "mfa_enabled": True, "auth_mfa_verified": True}}


def leaks(response, *, page: bool = False) -> list[str]:
    """Welche internen Inhalte in der Antwort stehen. Auf der Matchseite zählt der Spiel-Datensatz - der Block ``league.procedures``
    ist je Rolle gefiltert und hat eigene Tests."""
    if response.status_code != 200:
        return []
    body = response.json() if "json" in response.headers.get("content-type", "") else response.text
    if page:
        body = {"match": body.get("match"), "canonical_match": body.get("canonical_match")}
    text = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)
    return [key for key in FORBIDDEN if key in text]


async def probe(flow, w, viewer: dict, calls: list[tuple[str, str, dict | None]]) -> dict[str, tuple[int, list[str]]]:
    flow.act_as(viewer)
    seen = {}
    for method, url, body in calls:
        response = await (flow.get(url) if method == "GET" else getattr(flow, method.lower())(url, json=body))
        seen[f"{method} {url.replace(w['match']['id'], '{id}').replace(w['tournament']['id'], '{tid}')}"] = (
            response.status_code, leaks(response, page=url.endswith("/page")))
    return seen


def reads(w) -> list[tuple[str, str, None]]:
    mid, tid = w["match"]["id"], w["tournament"]["id"]
    return [("GET", url, None) for url in (
        f"/api/matches/{mid}", f"/api/matches/{mid}/page", "/api/matches/upcoming", f"/api/matches/{mid}/schedule-proposals",
        f"/api/matches/{mid}/chat", f"/api/matches/{mid}/veto", f"/api/tournaments/{tid}/matches-v2", f"/api/tournaments/{tid}/bracket",
        f"/api/tournaments/{tid}/matchdays", f"/api/tournaments/{tid}/standings", f"/api/tournaments/{tid}/live-queue",
        f"/api/tournaments/{tid}/live-queue/me", f"/api/tournaments/{tid}/lead", f"/api/tournaments/{tid}/match-plan.csv",
        f"/api/tournaments/{tid}", "/api/home/state", "/api/users/me/duty")]


# Diese Wege müssen für die jeweilige Rolle wirklich antworten - sonst prüfte der Test nichts.
MUST_ANSWER = ("GET /api/matches/{id}", "GET /api/matches/{id}/page", "GET /api/matches/upcoming", "GET /api/tournaments/{tid}/matches-v2",
               "GET /api/tournaments/{tid}/bracket", "GET /api/tournaments/{tid}/matchdays", "GET /api/tournaments/{tid}/standings")
STAFF_ONLY = ("GET /api/tournaments/{tid}/lead", "GET /api/tournaments/{tid}/match-plan.csv")


@pytest.mark.asyncio
async def test_no_read_shows_internal_procedure_content_to_sides_or_staff_without_the_right(flow):
    w = await scene(flow)
    for name, viewer in (("Falke1", user(w, "Falke1")), ("Kapitaen", user(w, "Kapitaen")), ("Helferin", w["helper"])):
        seen = await probe(flow, w, viewer, reads(w))
        assert {key: found for key, (_status, found) in seen.items() if found} == {}, name
        assert [key for key in MUST_ANSWER if seen[key][0] != 200] == [], name
        if name == "Helferin":
            assert [seen[key][0] for key in STAFF_ONLY] == [200, 200], "sie ist Liga-Personal und sieht die Leitungsansicht"
        else:
            assert [seen[key][0] for key in STAFF_ONLY] == [403, 403], name

    # Gegenprobe: Die nicht befangene Leitung mit „Proteste“ bekommt den Datensatz vollständig - der Test findet die Inhalte also.
    lead = await probe(flow, w, w["staff"], reads(w))
    for key in ("GET /api/matches/{id}", "GET /api/matches/{id}/page", "GET /api/tournaments/{tid}/matches-v2", "GET /api/tournaments/{tid}/bracket"):
        assert set(FORBIDDEN) <= set(lead[key][1]), key


@pytest.mark.asyncio
async def test_staff_without_the_right_is_really_staff_and_still_gets_no_procedure_content(flow, monkeypatch):
    w = await scene(flow)
    mid, tid = w["match"]["id"], w["tournament"]["id"]
    flow.act_as(w["helper"])
    single = await flow.get(f"/api/matches/{mid}")
    listing = await flow.get(f"/api/tournaments/{tid}/matches-v2")
    assert single.status_code == 200 and listing.status_code == 200
    # Beleg, dass das Konto als Personal behandelt wird: interne Felder und die Kennzeichen der Leitungs-Liste kommen an.
    assert single.json()["admin_note"] == "nur für die Leitung", "Internes sieht nur, wer das Turnier leitet"
    row = next(match for match in listing.json() if match["id"] == mid)
    assert row["viewer_involved"] is False and row["admin_note"] == "nur für die Leitung"
    for response in (single, listing):
        assert leaks(response) == []
    assert set(single.json()["disputes"][0]) == {"at", "id", "kind", "state"} == set(row["disputes"][0])

    # Fremde ohne Liga-Zuständigkeit bekommen dieselben Wege gar nicht als Personal (kein Internes).
    flow.act_as(user(w, "Fremd"))
    assert "admin_note" not in (await flow.get(f"/api/matches/{mid}")).json()

    # Gegenprobe: Ohne die Kürzung wird genau dieser Test rot - dieselben Antworten tragen dann das Interne.
    async def unchanged(_db, match, _user):
        return match

    async def unchanged_list(_db, _user, matches, _involved):
        return matches

    monkeypatch.setattr(league_procedures, "for_viewer", unchanged)
    monkeypatch.setattr(league_procedures, "for_viewer_list", unchanged_list)
    flow.act_as(w["helper"])
    for url in (f"/api/matches/{mid}", f"/api/tournaments/{tid}/matches-v2"):
        assert set(FORBIDDEN) <= set(leaks(await flow.get(url))), url


@pytest.mark.asyncio
async def test_answers_to_actions_carry_no_internal_procedure_content(flow, monkeypatch):
    w = await scene(flow)
    mid = w["match"]["id"]
    await checked_in(flow, mid)
    plays = [
        ("POST", f"/api/matches/{mid}/checkin", {"present": ids(w, "Kapitaen", "Mila")}),
        ("PUT", f"/api/matches/{mid}/lineups", {"lineup": ids(w, "Kapitaen", "Mila")}),
        ("POST", f"/api/matches/{mid}/schedule-proposals", {"proposed_at": "2099-01-01T18:00:00+00:00"}),
        ("POST", f"/api/matches/{mid}/reschedule", {"reason": "Wir können an dem Tag nicht."}),
        ("POST", f"/api/matches/{mid}/checkin/start", {}),
        ("POST", f"/api/matches/{mid}/report", two_nil(w, lineup=ids(w, "Kapitaen", "Mila"))),
    ]
    captain = await probe(flow, w, user(w, "Kapitaen"), plays)
    assert {key: found for key, (_status, found) in captain.items() if found} == {}
    assert captain["POST /api/matches/{id}/report"][0] == 200, "die Meldung antwortet mit dem ganzen Spiel"
    confirm = [("POST", f"/api/matches/{mid}/report", two_nil(w, lineup=ids(w, "Falke1", "Falke2"), side="reg_h"))]
    falcon = await probe(flow, w, user(w, "Falke1"), confirm)
    assert falcon["POST /api/matches/{id}/report"] == (200, []), "auch die Bestätigung"
    done = await stored(flow, w)
    assert done["status"] == "completed" and all(key in json.dumps(done) for key in FORBIDDEN[:5]), "am Spiel steht es weiter"

    # Die eine Stelle für solche Antworten: Seiten und Personal ohne Recht bekommen gekürzt, die Leitung nicht.
    payload = {"ok": True, "match": done, "other": [{"match": done}]}
    for viewer in (user(w, "Falke1"), user(w, "Kapitaen"), w["helper"]):
        cut = await league_procedures.guard(flow.db, payload, viewer)
        assert not [key for key in FORBIDDEN if key in json.dumps(cut, ensure_ascii=False)], viewer["display_name"]
        assert cut["match"]["results"] == done["results"], "alles andere bleibt, wie es ist"
    assert await league_procedures.guard(flow.db, payload, w["staff"]) == payload
    assert await league_procedures.guard(flow.db, {"ok": True, "rows": [1, 2]}, user(w, "Fremd")) == {"ok": True, "rows": [1, 2]}

    # Gegenprobe: Ohne den Wächter trüge die Antwort auf eine wiederholte Meldung das Interne.
    async def unchanged(_db, body, _user):
        return body

    monkeypatch.setattr(league_procedures, "guard", unchanged)
    again = await probe(flow, w, user(w, "Falke1"), confirm)
    status, found = again["POST /api/matches/{id}/report"]
    assert status != 200 or set(FORBIDDEN) <= set(found), "antwortet der Weg, dann nur mit Wächter ohne Internes"
