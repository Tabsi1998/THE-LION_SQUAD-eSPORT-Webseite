"""Ergebnisregeln beim Melden, Bestätigen und Korrigieren (docs/LIGA.md, C.3, #1617). Erfundene Namen und Werte.

Die Staffel trägt ``result_rules`` je Modus und ``scores_required``. Ohne die Felder bleibt alles wie vorher (Regressionstest).
"""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import ids, world  # noqa: E402

RULES = {
    "stellung": {"kind": "score", "target": 250, "time_limit_seconds": 600, "draw_allowed": False, "overtime": False},
    "suchen": {"kind": "rounds", "target": 6, "round_limit": 11, "draw_allowed": False, "overtime": False},
}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def ruled(flow, **fields):
    w = await world(flow)
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"result_rules": RULES, **fields}})
    return w


def body(w: dict, maps: list[tuple], *, lineup: list[str] | None = None, side_of=None) -> dict:
    """Je Map ``(Modus, Map, Sieger "a"/"h", (Punkte Sieger, Punkte Verlierer) oder None, Zusatzfelder)``."""
    reg = {"a": w["reg_a"]["id"], "h": w["reg_h"]["id"]}
    wins = {"a": 0, "h": 0}
    games = []
    for position, (mode, map_id, winner, scores, *extra) in enumerate(maps, start=1):
        wins[winner] += 1
        loser = "h" if winner == "a" else "a"
        game = {"position": position, "mode": mode, "map_id": map_id, "winner_registration_id": reg[winner],
                **(extra[0] if extra else {})}
        if scores is not None:
            game["scores"] = {reg[winner]: scores[0], reg[loser]: scores[1]}
        if lineup is not None:
            game["lineup"] = lineup
        games.append(game)
    first = "a" if wins["a"] > wins["h"] else "h"
    second = "h" if first == "a" else "a"
    return {"results": [{"registration_id": reg[first], "rank": 1, "score": wins[first]},
                        {"registration_id": reg[second], "rank": 2, "score": wins[second]}], "games": games}


async def report(flow, w: dict, maps: list[tuple]):
    flow.act_as(w["users"]["Kapitaen"])
    return await flow.post(f"/api/matches/{w['match']['id']}/report", json=body(w, maps, lineup=ids(w, "Kapitaen", "Mila")))


GOOD = [("stellung", "map-hafen", "a", (250, 180)), ("suchen", "map-turm", "a", (6, 5))]


@pytest.mark.asyncio
async def test_a_score_that_contradicts_the_winner_is_refused(flow):
    w = await ruled(flow)

    refused = await report(flow, w, [("stellung", "map-hafen", "a", (100, 250)), ("suchen", "map-turm", "a", (6, 5))])

    assert refused.status_code == 422
    assert refused.json()["detail"].startswith("Map 1: Der Endstand 100:250 passt nicht zum Sieger – mehr Punkte hat ")
    assert (await report(flow, w, GOOD)).status_code == 200


@pytest.mark.asyncio
async def test_above_the_target_without_overtime_is_refused(flow):
    w = await ruled(flow)

    refused = await report(flow, w, [("stellung", "map-hafen", "a", (251, 240)), ("suchen", "map-turm", "a", (6, 5))])

    assert refused.status_code == 422
    assert refused.json()["detail"] == "Map 1: höchstens 250 Punkte – die Map endet beim Ziel (Endstand 251:240)."


@pytest.mark.asyncio
async def test_rounds_respect_the_round_limit(flow):
    w = await ruled(flow)

    refused = await report(flow, w, [("stellung", "map-hafen", "a", (250, 180)), ("suchen", "map-turm", "a", (7, 5))])

    assert refused.status_code == 422
    assert refused.json()["detail"] == "Map 2: höchstens 11 Runden – 7:5 sind 12."
    assert (await report(flow, w, GOOD)).status_code == 200


@pytest.mark.asyncio
async def test_without_rules_everything_stays_as_before(flow):
    w = await world(flow)

    answer = await report(flow, w, [("stellung", "map-hafen", "a", (100, 250)), ("suchen", "map-turm", "a", None)])

    assert answer.status_code == 200, answer.text
    stored = (await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0}))["reports"][-1]["games"]
    # Keine neuen Felder ohne Eingabe: die Maps sehen aus wie vor C.3.
    assert set(stored[0]) == {"position", "mode", "mode_label", "map_id", "map_name", "map_image_url", "winner_registration_id",
                              "scores", "lineups"}


@pytest.mark.asyncio
async def test_scores_required_and_the_web_confirmation_takes_the_first_report(flow):
    w = await ruled(flow, scores_required=True)

    missing = await report(flow, w, [("stellung", "map-hafen", "a", (250, 180)), ("suchen", "map-turm", "a", None)])
    assert missing.status_code == 422
    assert missing.json()["detail"] == "Map 2: bitte die Punkte beider Seiten eintragen – in dieser Liga sind sie Pflicht."
    assert (await report(flow, w, GOOD)).status_code == 200

    # Die Gegenseite bestätigt im Web ohne Punkte (das Formular schickt keine): Es gelten die der ersten Meldung.
    flow.act_as(w["users"]["Falke1"])
    confirm = body(w, [(mode, map_id, winner, None) for mode, map_id, winner, _scores in GOOD], lineup=ids(w, "Falke1", "Falke2"))
    confirmed = await flow.post(f"/api/matches/{w['match']['id']}/report", json=confirm)

    assert confirmed.status_code == 200, confirmed.text
    match = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert match["status"] == "completed"
    assert [game["scores"] for game in match["games"]] == [{w["reg_a"]["id"]: 250, w["reg_h"]["id"]: 180},
                                                           {w["reg_a"]["id"]: 6, w["reg_h"]["id"]: 5}]


@pytest.mark.asyncio
async def test_app_confirmation_without_maps_is_unchanged(flow):
    w = await ruled(flow, scores_required=True)
    assert (await report(flow, w, GOOD)).status_code == 200

    flow.act_as(w["users"]["Falke1"])
    app = await flow.post(f"/api/matches/{w['match']['id']}/report", json={"results": body(w, [g + () for g in GOOD])["results"]})

    assert app.status_code == 200, app.text
    match = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert match["status"] == "completed" and match["lineups_missing"] == [w["reg_h"]["id"]]


@pytest.mark.asyncio
async def test_staff_correction_follows_the_same_rules_and_the_league_lead_overrides_with_a_reason(flow):
    w = await ruled(flow)
    wrong = body(w, [("stellung", "map-hafen", "a", (251, 240)), ("suchen", "map-turm", "a", (6, 5))])
    url = f"/api/matches/{w['match']['id']}/result?force=true"

    # Liga-Leitung mit Zuständigkeit „Ergebnisse“ (Entscheidung des Obmanns): dieselbe Prüfung, übergehen nur mit Grund.
    lead = await flow.add_user(role="club_admin", name="Ligaleitung")
    flow.act_as(lead)
    refused = await flow.post(url, json={**wrong, "reason": "Stand korrigiert"})
    assert refused.status_code == 422 and "höchstens 250 Punkte" in refused.json()["detail"]
    short = await flow.post(url, json={**wrong, "reason": "Stand korrigiert", "rule_override_reason": "ab"})
    assert short.status_code == 422
    assert short.json()["detail"] == "Bitte einen Grund angeben, warum die Regel übergangen wird (mindestens 5 Zeichen)."
    passed = await flow.post(url, json={**wrong, "reason": "Stand korrigiert", "rule_override_reason": "Server stürzte ab"})
    assert passed.status_code == 200, passed.text
    log = await flow.db.audit_logs.find_one({"action": "match.games.rule_override"}, {"_id": 0})
    assert log["actor_id"] == lead["id"]
    assert log["data"]["match_id"] == w["match"]["id"] and log["data"]["reason"] == "Server stürzte ab"


@pytest.mark.asyncio
async def test_no_override_for_captains_or_a_lead_in_their_own_match(flow):
    w = await ruled(flow)
    wrong = {**body(w, [("stellung", "map-hafen", "a", (251, 240)), ("suchen", "map-turm", "a", (6, 5))]),
             "reason": "Stand korrigiert", "rule_override_reason": "Server stürzte ab"}
    url = f"/api/matches/{w['match']['id']}/result?force=true"

    flow.act_as(w["users"]["Kapitaen"])
    assert (await flow.post(url, json=wrong)).status_code == 403
    # Befangen (B.1): Wer im Spiel steht, entscheidet nicht - auch mit Liga-Recht.
    flow.act_as({**w["users"]["Kapitaen"], "areas": ["leagues"]})
    assert (await flow.post(url, json=wrong)).status_code == 403
    # Der Superadmin bleibt Notausnahme mit Grund.
    flow.act_as({**w["users"]["Kapitaen"], "role": "superadmin"})
    assert (await flow.post(url, json=wrong)).status_code == 403
    passed = await flow.post(url, json={**wrong, "conflict_reason": "Sonst niemand erreichbar"})
    assert passed.status_code == 200, passed.text
    assert await flow.db.audit_logs.find_one({"action": "match.games.rule_override"}, {"_id": 0})


@pytest.mark.asyncio
async def test_the_override_never_skips_best_of(flow):
    w = await ruled(flow)
    flow.act_as(w["staff"])
    one = body(w, [("stellung", "map-hafen", "a", (251, 240))])

    refused = await flow.post(f"/api/matches/{w['match']['id']}/result?force=true",
                              json={**one, "results": [{**one["results"][0], "score": 1}, one["results"][1]],
                                    "reason": "Stand korrigiert", "rule_override_reason": "Server stürzte ab"})

    assert refused.status_code == 422


# ---------------------------------------------------------------- Best of je Länge (Fall-Tabelle)

BEST_OF_CASES = [
    (1, "a", True), (1, "ah", False),
    (3, "aa", True), (3, "aha", True), (3, "ah", False), (3, "aaa", False),
    (5, "aaa", True), (5, "ahaa", True), (5, "ahaha", True), (5, "ahah", False), (5, "aaah", False),
    (7, "aaaa", True), (7, "ahahaha", True), (7, "ahahah", False),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("best_of,winners,ok", BEST_OF_CASES, ids=[f"BO{c[0]}-{c[1]}" for c in BEST_OF_CASES])
async def test_best_of_threshold_and_no_map_after_the_decision(flow, best_of, winners, ok):
    w = await world(flow)
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]},
                                         {"$set": {"best_of": best_of, "map_repeat": "always", "game_mode_order": []}})
    maps = [("stellung", "map-hafen", winner, None) for winner in winners]

    answer = await report(flow, w, maps)

    assert (answer.status_code == 200) is ok, answer.text


# ---------------------------------------------------------------- Zusatzfelder je Map


@pytest.mark.asyncio
async def test_extras_are_checked_and_stored_only_when_given(flow):
    w = await ruled(flow)
    a = w["reg_a"]["id"]

    no_reason = await report(flow, w, [("stellung", "map-hafen", "a", (250, 180), {"status": "replayed"}), GOOD[1]])
    assert no_reason.status_code == 422
    assert no_reason.json()["detail"] == "Map 1: bitte kurz angeben, warum die Map wiederholt wurde (5 bis 200 Zeichen)."
    unknown = await report(flow, w, [("stellung", "map-hafen", "a", (250, 180), {"status": "not_played"}), GOOD[1]])
    assert unknown.status_code == 422
    assert unknown.json()["detail"] == "Map 1: Als Stand gibt es nur „gespielt“ oder „wiederholt“."
    awarded = await report(flow, w, [("stellung", "map-hafen", "a", None, {"decision": "awarded"}), GOOD[1]])
    assert awarded.status_code == 422
    assert awarded.json()["detail"] == "Map 1: Eine Map zusprechen kann nur die Liga-Leitung."
    foreign = await report(flow, w, [("stellung", "map-hafen", "a", (250, 180), {"host_registration_id": "fremd"}), GOOD[1]])
    assert foreign.status_code == 422 and foreign.json()["detail"] == "Map 1: Die Seite gehört zu keinem der beiden Teams."
    no_proof = await report(flow, w, [("stellung", "map-hafen", "a", (250, 180), {"proof_id": "fehlt"}), GOOD[1]])
    assert no_proof.status_code == 422 and no_proof.json()["detail"] == "Map 1: Diesen Nachweis gibt es an diesem Spiel nicht."

    await flow.db.match_proof_photos.insert_one({"id": "foto-1", "match_id": w["match"]["id"], "status": "attached"})
    good = await report(flow, w, [("stellung", "map-hafen", "a", (250, 180),
                                   {"status": "replayed", "replay_reason": "Verbindung brach ab", "host_registration_id": a,
                                    "proof_id": "foto-1"}), GOOD[1]])
    assert good.status_code == 200, good.text
    stored = (await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0}))["reports"][-1]["games"]
    assert {key: stored[0][key] for key in ("status", "replay_reason", "host_registration_id", "proof_id")} == {
        "status": "replayed", "replay_reason": "Verbindung brach ab", "host_registration_id": a, "proof_id": "foto-1"}
    assert "status" not in stored[1] and "decision" not in stored[1]


@pytest.mark.asyncio
async def test_staff_awards_a_map_without_scores_and_without_the_rule(flow):
    w = await ruled(flow, scores_required=True)
    flow.act_as(w["staff"])
    url = f"/api/matches/{w['match']['id']}/result"
    with_scores = body(w, [("stellung", "map-hafen", "a", (250, 180), {"decision": "awarded"}), GOOD[1]])

    refused = await flow.post(url, json=with_scores)
    assert refused.status_code == 422 and refused.json()["detail"] == "Map 1: Eine zugesprochene Map hat keine Punkte."

    answer = await flow.post(url, json=body(w, [("stellung", "map-hafen", "a", None, {"decision": "awarded"}), GOOD[1]]))
    assert answer.status_code == 200, answer.text
    games = (await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0}))["games"]
    assert games[0]["decision"] == "awarded" and games[0]["scores"] == {}


@pytest.mark.asyncio
async def test_page_shows_rules_and_the_positions_not_played(flow):
    w = await ruled(flow, scores_required=True)
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"best_of": 5}})
    maps = [("stellung", "map-hafen", "a", (250, 1)), ("suchen", "map-turm", "a", (6, 0)), ("stellung", "map-nebel", "a", (250, 2))]
    flow.act_as(w["staff"])
    saved = await flow.post(f"/api/matches/{w['match']['id']}/result", json=body(w, maps))
    assert saved.status_code == 200, saved.text

    page = (await flow.get(f"/api/matches/{w['match']['id']}/page")).json()["league"]

    assert page["not_played"] == [4, 5]
    assert page["scores_required"] is True
    assert page["result_rules"] == RULES
    assert page["can_override_rules"] is True
