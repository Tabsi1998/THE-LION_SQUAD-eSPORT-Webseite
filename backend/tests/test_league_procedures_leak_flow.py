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
from league_match_world import ids, world as league_world  # noqa: E402
from match_proof_world import user  # noqa: E402
from services import league_procedures, match_proofs  # noqa: E402
from test_league_procedures_flow import act, opened, stored  # noqa: E402

SECRET = "INTERN-GEHEIM-Vermerk der Leitung"
# Was nur die nicht befangene Leitung sehen darf. ``assignee`` und ``statement`` stehen für Beteiligte im Block
# ``league.procedures`` der Matchseite (mit Namen statt Konten) - dort wird der Spiel-Datensatz geprüft, nicht der Block.
FORBIDDEN = ("moss_requests", "excuse_reason", SECRET, "escalate_at", "escalated_at", "notified_immediately", "withdrawn_by")


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

    async def unchanged_any(_db, payload, _user):
        return payload

    monkeypatch.setattr(league_procedures, "guard", unchanged_any)
    monkeypatch.setattr(league_procedures, "for_viewer", unchanged)
    monkeypatch.setattr(league_procedures, "for_viewer_list", unchanged_list)
    flow.act_as(w["helper"])
    for url in (f"/api/matches/{mid}", f"/api/tournaments/{tid}/matches-v2"):
        assert set(FORBIDDEN) <= set(leaks(await flow.get(url))), url


# ---------------------------------------------------------------- Aktionen: jeder Weg antwortet und trägt nichts Internes

WHY = "Niemand sonst mit dem Recht ist erreichbar."
VETO_CHOICES = {0: "map-glut", 1: "map-turm", 2: "map-hafen", 3: "map-nebel", 4: "map-werk", 5: "map-kai", 6: "map-turm", 7: "map-nebel",
                8: "map-ruine", 9: "map-kai"}
ACTIONS = ("Matchplan wiederholt", "Verschiebung beantragen", "Verschiebung entscheiden", "Check-in Löwen", "Check-in Falken", "Veto bereit",
           "Veto erster Zug", "Veto letzter Zug", "Spiel starten", "Melden", "Bestätigen", "Ergebnis bereitlegen", "Rückgängig",
           "Ergebnis korrigieren", "Wertung kampflos", "Beide nicht erschienen", "Neu ansetzen")
# Diese Wege geben das ganze Spiel zurück - ohne Wächter stünde in ihrer Antwort das Interne (Gegenprobe).
RAW_WAYS = {"Matchplan wiederholt", "Melden", "Bestätigen", "Ergebnis korrigieren", "Wertung kampflos", "Beide nicht erschienen",
            "Neu ansetzen"}


async def play_everything(flow) -> dict[str, tuple[int, list[str]]]:
    """Ein ganzes Spiel mit Check-in, Veto, Meldung und den Eingriffen der Leitung - an einem Spiel, an dem ein zurückgezogenes
    Verfahren mit allem Internen hängt. Je Weg: Status und was an Internem in der Antwort steht."""
    from datetime import timedelta

    from models import now_utc
    from services.league_schedule import DEFAULTS as SCHEDULE_DEFAULTS
    from test_league_veto_flow import captain_of, stored_veto, veto_rules, veto_world

    w = await veto_world(flow, rules=veto_rules(),
                         schedule_rules={**SCHEDULE_DEFAULTS, "reschedule_notice_hours": 0, "reschedule_same_week": False})
    mid, tid = w["match"]["id"], w["tournament"]["id"]
    base = f"/api/matches/{mid}"
    pid = await opened(flow, w, reason_key="equipment", notified_immediately=False, claimed=None)
    flow.act_as(w["staff"])
    assert (await act(flow, w, pid, "assign")).status_code == 200
    assert (await act(flow, w, pid, "moss-requests", user_id=user(w, "Falke2")["id"])).status_code == 200
    rid = (await stored(flow, w))["disputes"][0]["moss_requests"][0]["id"]
    assert (await act(flow, w, pid, f"moss-requests/{rid}/excuse", reason=SECRET)).status_code == 200
    flow.act_as(user(w, "Falke1"))
    assert (await act(flow, w, pid, "withdraw")).status_code == 200
    seen: dict[str, tuple[int, list[str]]] = {}

    async def note(label: str, response):
        seen[label] = (response.status_code, leaks(response))
        return response

    # Liga-Personal nur mit „Spiele“: derselbe Matchplan noch einmal - die Wiederholung antwortet mit dem ganzen Spiel.
    helper = await flow.add_user(name="Helferin")
    await flow.db.league_staff.insert_one({"id": "ls-1", "league_id": "liga", "user_id": helper["id"], "capabilities": ["matches"]})
    flow.act_as({**helper, "mfa_enabled": True, "auth_mfa_verified": True})
    now_at = (await stored(flow, w))["scheduled_at"]
    await note("Matchplan wiederholt", await flow.patch(base, json={"scheduled_at": now_at}))

    # Verschiebung: geht nur vor dem Termin - dafür liegt er kurz in der Zukunft, danach wieder jetzt (Check-in-Fenster offen).
    soon = (now_utc() + timedelta(days=2)).replace(microsecond=0).isoformat()
    await flow.db.matches_v2.update_one({"id": mid}, {"$set": {"scheduled_at": soon}})
    flow.act_as(user(w, "Kapitaen"))
    later = (now_utc() + timedelta(days=3)).replace(microsecond=0).isoformat()
    await note("Verschiebung beantragen", await flow.post(f"{base}/reschedule", json={"scheduled_at": later, "reason": "Spieler im Nachtdienst"}))
    request_id = ((await stored(flow, w)).get("reschedule_requests") or [{}])[-1].get("id")
    flow.act_as(user(w, "Falke1"))
    await note("Verschiebung entscheiden", await flow.post(f"{base}/reschedule/{request_id}/decision", json={"action": "decline"}))
    await flow.db.matches_v2.update_one({"id": mid}, {"$set": {"scheduled_at": now_at}})

    flow.act_as(user(w, "Kapitaen"))
    await note("Check-in Löwen", await flow.post(f"{base}/checkin", json={"present": ids(w, "Kapitaen", "Mila")}))
    flow.act_as(user(w, "Falke1"))
    await note("Check-in Falken", await flow.post(f"{base}/checkin", json={"present": ids(w, "Falke1", "Falke2")}))
    await note("Veto bereit", await flow.post(f"{base}/veto/ready", json={"ready": True}))
    for index, map_id in VETO_CHOICES.items():
        veto = await stored_veto(flow, w)
        step = veto["template"]["steps"][index]
        flow.act_as(user(w, captain_of(w, veto["team_a"] if step["team"] == "A" else veto["team_b"])))
        answer = await flow.post(f"{base}/veto/pick", json={"map_id": map_id, "version": veto["version"]})
        assert answer.status_code == 200, (index, answer.text)
        if index in (0, 9):
            await note("Veto erster Zug" if index == 0 else "Veto letzter Zug", answer)
    flow.act_as(user(w, "Kapitaen"))
    await note("Spiel starten", await flow.post(f"{base}/checkin/start", json={}))

    planned = (await stored(flow, w))["planned_games"]
    lions, falcons = w["reg_a"]["id"], w["reg_h"]["id"]

    def result(winner: str, loser: str, lineup: list[str]) -> dict:
        return {"results": [{"registration_id": winner, "rank": 1, "score": 3}, {"registration_id": loser, "rank": 2, "score": 0}],
                "games": [{"position": game["position"], "mode": game["mode"], "map_id": game["map_id"], "winner_registration_id": winner,
                           "scores": {winner: 250, loser: 100}, "lineup": lineup} for game in planned[:3]]}

    await note("Melden", await flow.post(f"{base}/report", json=result(lions, falcons, ids(w, "Kapitaen", "Mila"))))
    flow.act_as(user(w, "Falke1"))
    await note("Bestätigen", await flow.post(f"{base}/report", json=result(lions, falcons, ids(w, "Falke1", "Falke2"))))

    # Die Leitung greift ein - hier als befangener Superadmin mit Grund (Notausnahme): Er sieht dabei nur, was seine Seite sieht.
    await flow.db.users.update_one({"id": user(w, "Mila")["id"]}, {"$set": {"role": "superadmin"}})
    flow.act_as({**user(w, "Mila"), "role": "superadmin", "mfa_enabled": True, "auth_mfa_verified": True})
    correction = {**result(falcons, lions, ids(w, "Kapitaen", "Mila")), "reason": "Korrektur nach Prüfung der Aufzeichnung.", "conflict_reason": WHY}
    held = await note("Ergebnis bereitlegen", await flow.post(f"{base}/result?force=true", json={**correction, "hold": True}))
    hold_id = (held.json().get("hold") or {}).get("id") if held.status_code == 200 else None
    await note("Rückgängig", await flow.post(f"{base}/result/undo", json={"hold_id": hold_id, "conflict_reason": WHY}))
    await note("Ergebnis korrigieren", await flow.post(f"{base}/result?force=true", json=correction))
    await note("Wertung kampflos", await flow.post(f"{base}/forfeit?force=true", json={
        "forfeit_registration_id": lions, "note": "Die Löwen haben einen gesperrten Spieler eingesetzt.", "conflict_reason": WHY}))
    # „Beide nicht erschienen“ gibt es nur für ein offenes Spiel - derselbe Datensatz, zurück auf Anfang.
    await flow.db.matches_v2.update_one({"id": mid}, {
        "$set": {"status": "scheduled", "results": [], "games": [], "reports": [], "started_at": None},
        "$unset": {"completed_at": "", "forfeit_registration_id": "", "result_meta": "", "flow": ""}})
    both = f"/api/admin/leagues/staffeln/{tid}/matches/{mid}/double-no-show"
    await note("Beide nicht erschienen", await flow.post(both, json={"note": "Beide Teams fehlten zum Termin.", "conflict_reason": WHY}))
    await note("Neu ansetzen", await flow.client.request("DELETE", both, json={"reason": "Neu angesetzt nach Rücksprache.", "conflict_reason": WHY}))
    final = await stored(flow, w)
    assert all(key in json.dumps(final) for key in FORBIDDEN[:5]), "am Spiel selbst steht das Interne die ganze Zeit"
    return seen


@pytest.mark.asyncio
async def test_every_action_answers_and_carries_no_internal_procedure_content(flow):
    seen = await play_everything(flow)
    assert set(seen) == set(ACTIONS)
    assert {label: status for label, (status, _found) in seen.items() if status != 200} == {}, "jeder Weg muss wirklich antworten"
    assert {label: found for label, (_status, found) in seen.items() if found} == {}


@pytest.mark.asyncio
async def test_without_the_guards_the_same_actions_leak(flow, monkeypatch):
    """Gegenprobe: Ohne den Wächter der Antworten (Middleware) und die Kürzung in den Routen wird der Test darüber rot."""
    async def unchanged(_db, payload, _user):
        return payload

    async def unchanged_list(_db, _user, matches, _involved):
        return matches

    monkeypatch.setattr(league_procedures, "guard", unchanged)
    monkeypatch.setattr(league_procedures, "for_viewer", unchanged)
    monkeypatch.setattr(league_procedures, "for_viewer_list", unchanged_list)
    seen = await play_everything(flow)
    leaking = {label for label, (_status, found) in seen.items() if set(FORBIDDEN) <= set(found)}
    assert leaking == RAW_WAYS, "genau diese Wege trügen ohne Wächter das Interne - an die Seiten und an Befangene"


@pytest.mark.asyncio
async def test_the_guard_cuts_in_any_depth_and_in_doubt(flow):
    w = await scene(flow)
    raw = await stored(flow, w)
    deep = {"ok": True, "a": [{"b": {"c": [{"d": {"e": {"f": {"g": {"h": [{"match": raw}]}}}}}]}}]}
    without_id = {"entry": {"disputes": raw["disputes"], "label": "ohne Kennung"}}
    by_match_id = {"row": {"match_id": raw["id"], "disputes": raw["disputes"]}}

    def internal(payload) -> list[str]:
        return [key for key in FORBIDDEN if key in json.dumps(payload, ensure_ascii=False)]

    for viewer in (user(w, "Falke1"), user(w, "Kapitaen"), w["helper"], None):
        for payload in (deep, without_id, by_match_id):
            assert internal(await league_procedures.guard(flow.db, payload, viewer)) == [], "für alle anderen im Zweifel kürzen"
    # Die nicht befangene Leitung: nichts gekürzt, wo das Spiel bestimmbar ist - auch tief in der Antwort und über ``match_id``.
    assert await league_procedures.guard(flow.db, deep, w["staff"]) == deep
    assert await league_procedures.guard(flow.db, by_match_id, w["staff"]) == by_match_id
    # Ein Knoten ohne jede Kennung lässt sich keinem Spiel zuordnen: im Zweifel gekürzt, auch für sie.
    assert internal(await league_procedures.guard(flow.db, without_id, w["staff"])) == []
    # Alles andere bleibt unberührt.
    cut = await league_procedures.guard(flow.db, deep, user(w, "Kapitaen"))
    assert cut["a"][0]["b"]["c"][0]["d"]["e"]["f"]["g"]["h"][0]["match"]["slots"] == raw["slots"]


@pytest.mark.asyncio
async def test_every_json_answer_of_the_api_passes_the_guard(flow, monkeypatch):
    """Strukturell: Der Wächter hängt an der Anwendung, nicht an einzelnen Routen - auch eine Route, die niemand angefasst hat, und
    eine, die es noch gar nicht gab, liefern Verfahren nur gekürzt."""
    from fastapi import APIRouter

    import server

    w = await scene(flow)
    raw = await stored(flow, w)
    router = APIRouter(prefix="/api/probe-neue-route")

    @router.get("/spiel")
    async def brand_new_route():
        return {"tief": [{"noch": {"tiefer": {"match": raw}}}]}

    server.app.include_router(router)
    try:
        for viewer in (user(w, "Falke1"), user(w, "Kapitaen"), w["helper"], None):
            flow.act_as(viewer)
            answer = await flow.get("/api/probe-neue-route/spiel")
            assert answer.status_code == 200 and leaks(answer) == []
            assert set(answer.json()["tief"][0]["noch"]["tiefer"]["match"]["disputes"][0]) <= {"at", "id", "kind", "state", "reason", "reason_key",
                                                                                                "category", "registration_id", "user_id",
                                                                                                "evidence_until", "claimed", "incident_id",
                                                                                                "withdrawn_at", "contested_mode"}
        flow.act_as(w["staff"])
        assert set(FORBIDDEN) <= set(leaks(await flow.get("/api/probe-neue-route/spiel"))), "die Leitung bekommt es vollständig"
        # Gegenprobe: Ohne die Middleware ist dieselbe neue Route offen.
        async def unchanged(_db, payload, _user):
            return payload

        monkeypatch.setattr(league_procedures, "guard", unchanged)
        flow.act_as(user(w, "Kapitaen"))
        assert set(FORBIDDEN) <= set(leaks(await flow.get("/api/probe-neue-route/spiel")))
    finally:
        server.app.router.routes[:] = [route for route in server.app.router.routes if getattr(route, "path", "") != "/api/probe-neue-route/spiel"]


# ---------------------------------------------------------------- Leistung, Inhaltstyp, Reihenfolge, Auskunft nach DSGVO

@pytest.mark.asyncio
async def test_answers_without_procedure_details_cost_no_user_lookup(flow, monkeypatch):
    """Ein Zähler (``"disputes": 3``, Leitungsseite) oder schon gekürzte Zeilen: weder die Person der Anfrage noch eine Kürzung."""
    from fastapi import APIRouter

    import server
    from services import procedure_response_guard

    w = await scene(flow)
    raw = await stored(flow, w)
    cut = {"at": raw["disputes"][0]["at"], "id": raw["disputes"][0]["id"], "kind": "objection", "state": "withdrawn"}
    router = APIRouter(prefix="/api/probe-zaehler")

    @router.get("/zahl")
    async def only_a_counter():
        return {"matches": [{"id": raw["id"], "disputes": 3}], "rows": [{"id": raw["id"], "disputes": [cut, {"at": "2026-11-01T10:00:00+00:00"}]}]}

    @router.get("/roh")
    async def raw_match():
        return {"match": raw}

    calls = []
    real = procedure_response_guard._user_of

    async def counted(request):
        calls.append(request.url.path)
        return await real(request)

    monkeypatch.setattr(procedure_response_guard, "_user_of", counted)
    server.app.include_router(router)
    try:
        flow.act_as(user(w, "Kapitaen"))
        plain = await flow.get("/api/probe-zaehler/zahl")
        assert plain.status_code == 200 and plain.json()["matches"][0]["disputes"] == 3 and plain.json()["rows"][0]["disputes"][0] == cut
        assert calls == [], "keine Benutzerabfrage ohne Verfahren mit Inhalt"
        assert leaks(await flow.get("/api/probe-zaehler/roh")) == [] and calls == ["/api/probe-zaehler/roh"], "Gegenprobe: mit Inhalt wird geprüft"
    finally:
        server.app.router.routes[:] = [route for route in server.app.router.routes if not getattr(route, "path", "").startswith("/api/probe-zaehler")]


@pytest.mark.asyncio
async def test_many_matches_with_procedures_cost_one_decision_per_staffel(flow, monkeypatch):
    from services import league_permissions

    w = await scene(flow)
    raw = await stored(flow, w)
    payload = {"matches": [{**raw, "id": f"spiel-{index}"} for index in range(40)] + [raw]}
    seen = {"viewer_for": 0, "involved": 0}
    real_viewer, real_involved = league_procedures.viewer_for, league_permissions.involved_match_ids

    async def viewer(*args, **kwargs):
        seen["viewer_for"] += 1
        return await real_viewer(*args, **kwargs)

    async def involved(*args, **kwargs):
        seen["involved"] += 1
        return await real_involved(*args, **kwargs)

    monkeypatch.setattr(league_procedures, "viewer_for", viewer)
    monkeypatch.setattr(league_permissions, "involved_match_ids", involved)
    for viewer_user, full in ((w["staff"], True), (user(w, "Kapitaen"), False), (w["helper"], False)):
        seen.update(viewer_for=0, involved=0)
        out = await league_procedures.guard(flow.db, payload, viewer_user)
        assert (out == payload) is full, viewer_user["display_name"]
        assert all(set(match["disputes"][0]) == {"at", "id", "kind", "state"} for match in out["matches"]) is (not full)
        assert seen["viewer_for"] == 0 and seen["involved"] <= 1, f"je Staffel eine Entscheidung, nicht je Spiel: {seen}"
        # Schon gekürzt: ein zweiter Durchgang (Route und Middleware hintereinander) kostet nichts mehr.
        seen.update(viewer_for=0, involved=0)
        again = await league_procedures.guard(flow.db, out, viewer_user)
        assert again == out and (full or seen == {"viewer_for": 0, "involved": 0})
