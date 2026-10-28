"""Ergebnis je Map mit Aufstellung (docs/LIGA.md, Abschnitte 2, 5 und 6; #1650).

Melden mit Maps und eigener Aufstellung, Bestätigen mit eigener Aufstellung (oder aus der App ohne Maps → Aufstellung
fehlt noch), alle Prüfungen des Vertrags mit deutschem Satz, Nachtrag in und nach der Frist. Erfundene Namen."""

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

APP_DETAIL = "Bitte im Web mit Maps und Aufstellung melden."


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def report_url(w: dict) -> str:
    return f"/api/matches/{w['match']['id']}/report"


async def stored(flow, w: dict) -> dict:
    return await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_the_captain_reports_maps_winners_and_the_own_lineup(flow):
    w = await world(flow)
    flow.act_as(w["users"]["Kapitaen"])

    response = await flow.post(report_url(w), json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))

    assert response.status_code == 200, response.text
    assert response.json()["report_status"] == "waiting"
    match = await stored(flow, w)
    games = match["reports"][-1]["games"]
    assert [(g["position"], g["mode"], g["map_id"], g["map_name"]) for g in games] == [
        (1, "stellung", "map-hafen", "Hafen"),
        (2, "suchen", "map-turm", "Turm"),
    ]
    assert games[0]["map_image_url"] == "/uploads/maps/hafen.webp", "Name und Bild als Schnappschuss vom Server"
    assert games[0]["scores"] == {w["reg_a"]["id"]: 250, w["reg_h"]["id"]: 180}
    assert games[0]["lineups"] == {w["reg_a"]["id"]: ids(w, "Kapitaen", "Mila")}
    assert match["lineup_user_ids"] == sorted(ids(w, "Kapitaen", "Mila"))
    assert match["map_pool_id"], "das Spiel hält den Pool fest, aus dem gemeldet wurde"
    assert "games" not in match, "erst die Bestätigung schreibt die Maps ans Spiel"
    logged = await flow.db.audit_logs.find({"action": "match.games.report"}, {"_id": 0}).to_list(5)
    assert len(logged) == 1


@pytest.mark.asyncio
async def test_every_rule_answers_with_a_german_sentence(flow):
    w = await world(flow)
    flow.act_as(w["users"]["Kapitaen"])
    lineup = ids(w, "Kapitaen", "Mila")

    async def refused(body: dict, code: int, words: str):
        response = await flow.post(report_url(w), json=body)
        assert response.status_code == code, response.text
        assert words in response.json()["detail"], response.json()["detail"]

    base = two_nil(w, lineup=lineup)
    # Best of 3: nach 2:0 keine dritte Map, mit nur einer Map fehlt der Sieger.
    third = {
        "position": 3,
        "mode": "stellung",
        "map_id": "map-nebel",
        "winner_registration_id": w["reg_h"]["id"],
        "lineup": lineup,
    }
    await refused({**base, "games": base["games"] + [third]}, 422, "keine weitere Map")
    await refused({**base, "games": base["games"][:1]}, 422, "braucht 2 gewonnene Maps")
    # Map nicht im Pool für diesen Modus, Modus passt nicht zur Reihenfolge.
    await refused(
        {**base, "games": [{**base["games"][0], "map_id": "map-turm"}, base["games"][1]]}, 422, "nicht freigegeben"
    )
    await refused(
        {**base, "games": [{**base["games"][0], "mode": "suchen", "map_id": "map-turm"}, base["games"][1]]},
        422,
        "gespielt wird hier Stellung",
    )
    # Aufstellung: falsche Größe, fremde Person, doppelt, fehlt.
    await refused(two_nil(w, lineup=ids(w, "Kapitaen")), 422, "genau 2 Spieler")
    await refused(two_nil(w, lineup=ids(w, "Kapitaen", "Ida")), 422, "nur Spieler aus dem Kader")
    await refused(two_nil(w, lineup=ids(w, "Kapitaen", "Kapitaen")), 422, "nur einmal")
    await refused(two_nil(w), 422, "eigene Aufstellung")
    # Positionen mit Lücke, Sieger fremd, Spielstand passt nicht zu den Maps.
    await refused({**base, "games": [base["games"][0], {**base["games"][1], "position": 3}]}, 422, "ohne Lücke")
    await refused(
        {**base, "games": [{**base["games"][0], "winner_registration_id": "fremd"}, base["games"][1]]},
        422,
        "Sieger der Map",
    )
    wrong = {
        **base,
        "results": [
            {"registration_id": w["reg_a"]["id"], "rank": 1, "score": 2},
            {"registration_id": w["reg_h"]["id"], "rank": 2, "score": 1},
        ],
    }
    response = await flow.post(report_url(w), json=wrong)
    assert response.status_code == 422
    # Ohne Maps meldet die erste Seite nie.
    response = await flow.post(report_url(w), json={"results": base["results"]})
    assert response.status_code == 422
    assert response.json()["detail"] == APP_DETAIL
    assert (await stored(flow, w)).get("reports") in (None, []), "nichts gespeichert"


@pytest.mark.asyncio
async def test_confirming_in_the_web_adds_the_own_lineup_and_decides_the_match(flow):
    w = await world(flow)
    flow.act_as(w["users"]["Kapitaen"])
    first = await flow.post(report_url(w), json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))
    assert first.status_code == 200, first.text

    flow.act_as(w["users"]["Falke1"])
    page = (await flow.get(f"/api/matches/{w['match']['id']}/page")).json()
    league = page["league"]
    assert [g["map_name"] for g in league["proposal_games"]] == ["Hafen", "Turm"]
    assert [p["id"] for p in league["roster"]] == sorted(ids(w, "Falke1", "Falke2", "Falke3"))
    confirm = two_nil(w, lineup=ids(w, "Falke2", "Falke3"))
    confirm["games"] = [{**game, "scores": None} for game in confirm["games"]]
    response = await flow.post(report_url(w), json=confirm)

    assert response.status_code == 200, response.text
    match = await stored(flow, w)
    assert match["status"] == "completed"
    assert [g["lineups"] for g in match["games"]] == [
        {w["reg_a"]["id"]: ids(w, "Kapitaen", "Mila"), w["reg_h"]["id"]: ids(w, "Falke2", "Falke3")}
    ] * 2
    assert match["games"][0]["scores"] == {w["reg_a"]["id"]: 250, w["reg_h"]["id"]: 180}, "Punkte der Erstmeldung"
    assert match["lineups_missing"] == []
    assert sorted(match["lineup_user_ids"]) == sorted(ids(w, "Kapitaen", "Mila", "Falke2", "Falke3"))
    assert [row["score"] for row in sorted(match["results"], key=lambda r: r["rank"])] == [2, 0]


@pytest.mark.asyncio
async def test_the_app_confirms_without_maps_and_the_side_is_asked_for_its_lineup(flow):
    w = await world(flow)
    flow.act_as(w["users"]["Kapitaen"])
    await flow.post(report_url(w), json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))

    flow.act_as(w["users"]["Falke1"])
    different = {
        "results": [
            {"registration_id": w["reg_a"]["id"], "rank": 2, "score": 1},
            {"registration_id": w["reg_h"]["id"], "rank": 1, "score": 2},
        ]
    }
    refused = await flow.post(report_url(w), json=different)
    assert refused.status_code == 422
    assert refused.json()["detail"] == APP_DETAIL
    response = await flow.post(report_url(w), json={"results": two_nil(w)["results"]})

    assert response.status_code == 200, response.text
    match = await stored(flow, w)
    assert match["status"] == "completed"
    assert match["lineups_missing"] == [w["reg_h"]["id"]]
    assert [g["map_id"] for g in match["games"]] == ["map-hafen", "map-turm"]
    asked = await flow.db.notifications.find({"meta.reason": "lineup_missing"}, {"_id": 0}).to_list(10)
    assert {row["user_id"] for row in asked} == set(ids(w, "Falke1"))
    assert all(row["body"].endswith("Bitte Aufstellung im Web nachtragen.") for row in asked)
    page = (await flow.get(f"/api/matches/{w['match']['id']}/page")).json()
    assert page["league"]["lineups_missing"] == [w["reg_h"]["id"]]
    assert page["league"]["can_amend_lineup"] is True


@pytest.mark.asyncio
async def test_confirming_with_other_maps_points_to_the_dispute(flow):
    w = await world(flow)
    flow.act_as(w["users"]["Kapitaen"])
    await flow.post(report_url(w), json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))

    flow.act_as(w["users"]["Falke1"])
    other = two_nil(w, lineup=ids(w, "Falke2", "Falke3"))
    other["games"][0]["map_id"] = "map-nebel"
    response = await flow.post(report_url(w), json=other)

    assert response.status_code == 409
    assert "Einspruch" in response.json()["detail"]
    assert (await stored(flow, w))["status"] != "completed"
    disputed = await flow.post(f"/api/matches/{w['match']['id']}/dispute", json={"reason": "Andere Map gespielt"})
    assert disputed.status_code == 200, disputed.text


@pytest.mark.asyncio
async def test_a_missing_lineup_is_amended_within_the_window_and_later_only_by_staff(flow):
    w = await world(flow)
    flow.act_as(w["users"]["Kapitaen"])
    await flow.post(report_url(w), json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))
    flow.act_as(w["users"]["Falke1"])
    await flow.post(report_url(w), json={"results": two_nil(w)["results"]})
    url = f"/api/matches/{w['match']['id']}/lineups"
    body = {
        "games": [
            {"position": 1, "lineup": ids(w, "Falke1", "Falke2")},
            {"position": 2, "lineup": ids(w, "Falke2", "Falke3")},
        ]
    }

    flow.act_as(w["users"]["Falke2"])
    member = await flow.put(url, json=body)
    assert member.status_code == 403, "nur Captain und Vertreter"
    flow.act_as(w["users"]["Falke1"])
    partial = await flow.put(url, json={"games": body["games"][:1]})
    assert partial.status_code == 422
    amended = await flow.put(url, json=body)
    assert amended.status_code == 200, amended.text
    match = await stored(flow, w)
    assert match["lineups_missing"] == []
    assert match["games"][1]["lineups"][w["reg_h"]["id"]] == ids(w, "Falke2", "Falke3")
    assert set(ids(w, "Falke1", "Falke3")) <= set(match["lineup_user_ids"])
    assert await flow.db.audit_logs.count_documents({"action": "match.lineup.amend"}) == 1

    # Nach der Frist (48 h nach dem Ergebnis) nur noch die Turnierleitung - mit Grund.
    late = (now_utc() - timedelta(hours=49)).isoformat()
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"completed_at": late}})
    closed = await flow.put(url, json=body)
    assert closed.status_code == 409
    assert "Frist" in closed.json()["detail"]
    flow.act_as(w["staff"])
    no_reason = await flow.put(url, json={**body, "registration_id": w["reg_h"]["id"]})
    assert no_reason.status_code == 422
    by_staff = await flow.put(url, json={**body, "registration_id": w["reg_h"]["id"], "reason": "Nachtrag per Discord"})
    assert by_staff.status_code == 200, by_staff.text


@pytest.mark.asyncio
async def test_nobody_plays_for_two_teams_on_the_same_matchday_of_a_season(flow):
    from league_match_world import duel, staffel
    from squad_world import squad_registration

    w = await world(flow)
    users = w["users"]
    staffel_b = await staffel(flow, w["season_id"], "B")
    reg_b = await squad_registration(flow, staffel_b, w["lions"], w["squad_b"])
    rivals = await squad_registration(flow, staffel_b, w["falcons"], w["horst"])
    other = await duel(flow, staffel_b, reg_b, rivals, matchday=1)
    flow.act_as(users["LoeLeitung"])  # Rudel B hat keinen Captain - die Teamleitung handelt dort
    body_b = {
        "results": [
            {"registration_id": reg_b["id"], "rank": 1, "score": 2},
            {"registration_id": rivals["id"], "rank": 2, "score": 0},
        ],
        "games": [
            {
                "position": 1,
                "mode": "stellung",
                "map_id": "map-hafen",
                "winner_registration_id": reg_b["id"],
                "lineup": ids(w, "Tom", "Ida"),
            },
            {
                "position": 2,
                "mode": "suchen",
                "map_id": "map-turm",
                "winner_registration_id": reg_b["id"],
                "lineup": ids(w, "Tom", "Ida"),
            },
        ],
    }
    placed = await flow.post(f"/api/matches/{other['id']}/report", json=body_b)
    assert placed.status_code == 200, placed.text

    flow.act_as(users["Kapitaen"])
    twice = await flow.post(report_url(w), json=two_nil(w, lineup=ids(w, "Kapitaen", "Tom")))
    assert twice.status_code == 409
    assert "Tom" in twice.json()["detail"] and "Spieltag" in twice.json()["detail"]

    # An einem anderen Spieltag darf Tom für beide Co-Teams spielen.
    await flow.db.matches_v2.update_one({"id": other["id"]}, {"$set": {"matchday_number": 2, "round": 2}})
    allowed = await flow.post(report_url(w), json=two_nil(w, lineup=ids(w, "Kapitaen", "Tom")))
    assert allowed.status_code == 200, allowed.text
