"""Ergebnis je Map: 48-h-Automatik, Korrektur und „Rückgängig“ der Turnierleitung (docs/LIGA.md, Schritte 8 und 10;
#1650) - plus Regression: Turniere ohne Liga-Rahmen melden genau wie bisher. Erfundene Namen."""

import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import ids, two_nil, world  # noqa: E402
from models import now_utc  # noqa: E402
from squad_world import make_team  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def stored(flow, match_id: str) -> dict:
    return await flow.db.matches_v2.find_one({"id": match_id}, {"_id": 0})


def admin_body(w: dict, *, lineups: bool = True, reason: str | None = None) -> dict:
    a, h = w["reg_a"]["id"], w["reg_h"]["id"]
    games = [
        {"position": 1, "mode": "stellung", "map_id": "map-nebel", "winner_registration_id": h},
        {"position": 2, "mode": "suchen", "map_id": "map-nebel", "winner_registration_id": a},
        {"position": 3, "mode": "stellung", "map_id": "map-hafen", "winner_registration_id": h},
    ]
    if lineups:
        games = [{**game, "lineups": {a: ids(w, "Kapitaen", "Mila"), h: ids(w, "Falke1", "Falke2")}} for game in games]
    return {
        "results": [{"registration_id": h, "rank": 1, "score": 2}, {"registration_id": a, "rank": 2, "score": 1}],
        "games": games,
        **({"reason": reason} if reason else {}),
    }


@pytest.mark.asyncio
async def test_after_48_hours_the_first_report_counts_with_its_maps(flow):
    from services.match_deadline_sweep import _auto_confirm

    w = await world(flow)
    flow.act_as(w["users"]["Kapitaen"])
    reported = await flow.post(
        f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila"))
    )
    assert reported.status_code == 200, reported.text

    confirmed = await _auto_confirm(flow.db, w["tournament"], w["match"]["id"], None, now_utc() + timedelta(days=8))

    assert confirmed == 1
    match = await stored(flow, w["match"]["id"])
    assert match["status"] == "completed"
    assert [g["map_id"] for g in match["games"]] == ["map-hafen", "map-turm"]
    assert match["lineups_missing"] == [w["reg_h"]["id"]], "die Gegenseite trägt nach"
    assert await flow.db.notifications.count_documents({"meta.reason": "lineup_missing"}) == 1


@pytest.mark.asyncio
async def test_staff_enters_and_corrects_maps_with_both_lineups(flow):
    w = await world(flow)
    flow.act_as(w["staff"])
    url = f"/api/matches/{w['match']['id']}/result"

    entered = await flow.post(url, json=admin_body(w, lineups=False))
    assert entered.status_code == 200, entered.text
    match = await stored(flow, w["match"]["id"])
    assert [g["winner_registration_id"] for g in match["games"]] == [
        w["reg_h"]["id"],
        w["reg_a"]["id"],
        w["reg_h"]["id"],
    ]
    assert sorted(match["lineups_missing"]) == sorted([w["reg_a"]["id"], w["reg_h"]["id"]])

    unchanged = await flow.post(f"{url}?force=true", json=admin_body(w, reason="Aufstellungen ergänzt"))
    assert unchanged.status_code == 200, unchanged.text
    match = await stored(flow, w["match"]["id"])
    assert match["lineups_missing"] == []
    assert match["games"][0]["lineups"][w["reg_h"]["id"]] == ids(w, "Falke1", "Falke2")
    assert await flow.db.audit_logs.count_documents({"action": "match.games.correct"}) == 1

    # Ein Stand, der nicht zu den Maps passt, wird abgelehnt; eine Korrektur des Stands ohne Maps nimmt sie weg.
    wrong = admin_body(w, reason="Tippfehler")
    wrong["results"][1]["score"] = 0  # laut Maps 2:1, gemeldet 2:0
    refused = await flow.post(f"{url}?force=true", json=wrong)
    assert refused.status_code == 422
    assert "2:1" in refused.json()["detail"]
    flipped = {
        "results": [
            {"registration_id": w["reg_a"]["id"], "rank": 1, "score": 2},
            {"registration_id": w["reg_h"]["id"], "rank": 2, "score": 0},
        ],
        "reason": "Falsch eingetragen",
    }
    corrected = await flow.post(f"{url}?force=true", json=flipped)
    assert corrected.status_code == 200, corrected.text
    assert (await stored(flow, w["match"]["id"]))["games"] == []


@pytest.mark.asyncio
async def test_undo_takes_the_maps_back_with_the_result(flow):
    w = await world(flow)
    flow.act_as(w["users"]["Kapitaen"])
    await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))
    flow.act_as(w["staff"])
    entered = await flow.post(f"/api/matches/{w['match']['id']}/result", json=admin_body(w))
    assert entered.status_code == 200, entered.text

    undone = await flow.post(f"/api/matches/{w['match']['id']}/result/undo", json={})

    assert undone.status_code == 200, undone.text
    match = await stored(flow, w["match"]["id"])
    assert "games" not in match and "lineups_missing" not in match
    assert match["status"] != "completed"
    assert match["lineup_user_ids"] == sorted(ids(w, "Kapitaen", "Mila")), "nur noch die offene Meldung zählt"


@pytest.mark.asyncio
async def test_a_held_result_publishes_its_maps(flow):
    from services.result_hold import publish_due_holds

    w = await world(flow)
    flow.act_as(w["staff"])
    held = await flow.post(f"/api/matches/{w['match']['id']}/result", json={**admin_body(w), "hold": True})
    assert held.status_code == 200, held.text
    assert "games" not in await stored(flow, w["match"]["id"])

    published = await publish_due_holds(flow.db, now=now_utc() + timedelta(minutes=1))

    assert published == 1
    match = await stored(flow, w["match"]["id"])
    assert match["status"] == "completed" and len(match["games"]) == 3


# ---------------------------------------------------------------- Regression: ohne Liga-Rahmen wie bisher


async def plain_duel(flow, **fields) -> dict:
    users = {name: await flow.add_user(name=name) for name in ("Eins", "Zwei", "EinsMit", "ZweiMit")}
    tournament = await flow.create_tournament(status="live", event_mode="online", best_of=3, **fields)
    if tournament.get("team_mode") == "team":
        one = await make_team(flow, "Eins", leader=users["Eins"], members=[users["EinsMit"]])
        two = await make_team(flow, "Zwei", leader=users["Zwei"], members=[users["ZweiMit"]])
        regs = []
        for team in (one, two):
            reg = {
                "id": new_id(),
                "tournament_id": tournament["id"],
                "team_id": team["id"],
                "status": "approved",
                "display_name": team["name"],
                "registration_type": "team",
            }
            await flow.db.tournament_registrations.insert_one(dict(reg))
            regs.append(reg)
    else:
        regs = [await flow.register(tournament, users["Eins"]), await flow.register(tournament, users["Zwei"])]
    match = {
        "id": new_id(),
        "tournament_id": tournament["id"],
        "stage_id": new_id(),
        "match_type": "duel",
        "status": "scheduled",
        "round": 1,
        "slots": [
            {"slot": 1, "status": "filled", "registration_id": regs[0]["id"]},
            {"slot": 2, "status": "filled", "registration_id": regs[1]["id"]},
        ],
    }
    await flow.db.matches_v2.insert_one(dict(match))
    return {"users": users, "tournament": tournament, "regs": regs, "match": match}


PLAIN = [
    pytest.param({"team_mode": "solo", "format": "single_elim"}, id="solo-cup"),
    pytest.param({"team_mode": "team", "team_size": 2, "format": "single_elim"}, id="team-cup"),
    pytest.param({"team_mode": "team", "team_size": 2, "format": "groups"}, id="team-groups"),
    pytest.param(
        {"team_mode": "team", "team_size": 2, "format": "league", "round_robin_legs": 2}, id="league-without-frame"
    ),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("fields", PLAIN)
async def test_without_league_frame_reports_stay_as_today(flow, fields):
    p = await plain_duel(flow, **fields)
    results = [
        {"registration_id": p["regs"][0]["id"], "rank": 1, "score": 2},
        {"registration_id": p["regs"][1]["id"], "rank": 2, "score": 1},
    ]
    url = f"/api/matches/{p['match']['id']}/report"

    flow.act_as(p["users"]["Eins"])
    first = await flow.post(
        url,
        json={
            "results": results,
            "games": [{"position": 1, "map_id": "egal", "winner_registration_id": p["regs"][0]["id"]}],
        },
    )
    assert first.status_code == 200, first.text
    assert first.json()["report_status"] == "waiting"
    flow.act_as(p["users"]["Zwei"])
    second = await flow.post(url, json={"results": results})
    assert second.status_code == 200, second.text

    match = await stored(flow, p["match"]["id"])
    assert match["status"] == "completed"
    assert "games" not in match and "lineups_missing" not in match and "lineup_user_ids" not in match
    assert all("games" not in report for report in match["reports"]), "Maps werden ohne Liga nicht gespeichert"
    page = (await flow.get(f"/api/matches/{p['match']['id']}/page")).json()
    assert page["league"] is None


@pytest.mark.asyncio
async def test_without_league_frame_staff_results_ignore_maps(flow):
    p = await plain_duel(flow, team_mode="solo", format="single_elim")
    staff = await flow.add_staff()
    flow.act_as(staff)
    body = {
        "results": [
            {"registration_id": p["regs"][0]["id"], "rank": 1, "score": 2},
            {"registration_id": p["regs"][1]["id"], "rank": 2, "score": 0},
        ],
        "games": [{"position": 1, "map_id": "egal", "winner_registration_id": p["regs"][0]["id"]}],
    }

    entered = await flow.post(f"/api/matches/{p['match']['id']}/result", json=body)

    assert entered.status_code == 200, entered.text
    match = await stored(flow, p["match"]["id"])
    assert match["status"] == "completed" and "games" not in match
    lineup = await flow.put(
        f"/api/matches/{p['match']['id']}/lineups", json={"games": [{"position": 1, "lineup": ["x"]}]}
    )
    assert lineup.status_code == 404
