"""Profil (#1193): Turnierweg je Format und Bilanz gegen Gegner - im eigenen Profil alles, öffentlich nur öffentliche
Turniere und Gegner mit öffentlichem Profil bzw. öffentliche Teams. Erfundene Daten, keine echten Personen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def person(flow, name, *, public=True):
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"privacy_public_profile": public}})
    return {**user, "privacy_public_profile": public}


async def finished(flow, title, **fields):
    return await flow.create_tournament(**{"title": title, "status": "results_published", "start_date": "2026-10-17T13:00:00+00:00", **fields})


async def duel(flow, tournament, a, b, a_score, b_score, *, round_no=1, section="WB"):
    await flow.db.matches_v2.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "stage_id": "s1", "round": round_no, "round_name": f"Runde {round_no}", "section": section,
        "match_type": "duel", "status": "completed",
        "slots": [{"slot": 1, "registration_id": a["id"]}, {"slot": 2, "registration_id": b["id"]}],
        "results": [{"registration_id": a["id"], "rank": 1 if a_score >= b_score else 2, "score": a_score},
                    {"registration_id": b["id"], "rank": 1 if b_score >= a_score else 2, "score": b_score}],
    })


async def knockout(flow, me, *, title="FC 26 Cup", blitz="blitzbirne", **fields):
    """Viertelfinale 2:0, Halbfinale 2:1, Finale 1:2 - Platz 2 von 8."""
    cup = await finished(flow, title, **fields)
    mine = await flow.register(cup, me)
    await flow.db.tournament_registrations.update_one({"id": mine["id"]}, {"$set": {"final_position": 2}})
    blitz = await flow.register(cup, await person(flow, blitz))
    panther = await flow.register(cup, await flow.db.users.find_one({"username": "pixelpanther"}, {"_id": 0}))
    tina = await flow.register(cup, await flow.db.users.find_one({"username": "turbotina"}, {"_id": 0}))
    for _ in range(4):
        await flow.register(cup, await person(flow, f"spieler-{new_id()[:6]}"))
    await duel(flow, cup, mine, blitz, 2, 0, round_no=1)
    await duel(flow, cup, mine, panther, 2, 1, round_no=2)
    await duel(flow, cup, mine, tina, 1, 2, round_no=3)
    return cup


@pytest.mark.asyncio
async def test_path_shows_rounds_results_and_final_place_only_public_names_for_others(flow):
    me = await person(flow, "neonfalke")
    await person(flow, "pixelpanther")
    await person(flow, "turbotina", public=False)
    cup = await knockout(flow, me)

    flow.act_as(me)
    own = (await flow.get(f"/api/profile/neonfalke/tournaments/{cup['slug']}/path")).json()
    assert own["public"] is False and own["kind"] == "knockout"
    assert [(s["label"], s["result"], s["outcome"]) for s in own["steps"]] == [("Viertelfinale", "2:0", "win"), ("Halbfinale", "2:1", "win"), ("Finale", "1:2", "loss")]
    assert [s["opponent"] for s in own["steps"]] == ["blitzbirne", "pixelpanther", "turbotina"]
    assert own["final"] == {"rank": 2, "participant_count": 8}
    assert own["share"]["path"] == f"/tournaments/{cup['slug']}/ergebnis/neonfalke"

    # Andere (und „So sehen dich andere“): der private Gegner steht ohne Namen da, das Ergebnis bleibt.
    for viewer, query in ((None, ""), (me, "?view_as=public")):
        flow.act_as(viewer)
        seen = (await flow.get(f"/api/profile/neonfalke/tournaments/{cup['id']}/path{query}")).json()
        assert seen["public"] is True and seen["share"] is None
        assert [s["opponent"] for s in seen["steps"]] == ["blitzbirne", "pixelpanther", None]
        assert [s["result"] for s in seen["steps"]] == ["2:0", "2:1", "1:2"]

    # Nur für Mitglieder: öffentlich gibt es den Weg nicht, im eigenen Profil schon.
    members = await knockout(flow, me, title="Vereinsabend-Cup", blitz="donnerkeil", visibility="members")
    flow.act_as(None)
    assert (await flow.get(f"/api/profile/neonfalke/tournaments/{members['slug']}/path")).status_code == 404
    flow.act_as(me)
    assert (await flow.get(f"/api/profile/neonfalke/tournaments/{members['slug']}/path")).status_code == 200
    # Ein Turnier ohne Teilnahme oder ohne Ergebnis: kein Weg.
    running = await flow.create_tournament(title="Mittwochs-Cup", status="live")
    await flow.register(running, me)
    assert (await flow.get(f"/api/profile/neonfalke/tournaments/{running['slug']}/path")).status_code == 404


@pytest.mark.asyncio
async def test_path_for_teams_heats_and_groups(flow):
    me = await person(flow, "neonfalke")
    team = {"id": new_id(), "name": "Lions Rocket", "tag": "LRK", "is_public": True}
    await flow.db.teams.insert_one(dict(team))
    await flow.db.team_members.insert_one({"team_id": team["id"], "user_id": me["id"], "role": "member"})
    race = await finished(flow, "Rocket Rennen", team_mode="team", team_size=2, format="ffa")
    ours = {"id": new_id(), "tournament_id": race["id"], "team_id": team["id"], "display_name": "[LRK] Lions Rocket", "status": "approved", "final_position": 1}
    others = [{"id": new_id(), "tournament_id": race["id"], "team_id": new_id(), "display_name": n, "status": "approved"} for n in ("Nordlicht", "Sturmvogel", "Eisbären")]
    await flow.db.tournament_registrations.insert_many([dict(ours), *[dict(o) for o in others]])
    for round_no, ranking in ((1, [others[0], ours, others[1], others[2]]), (2, [ours, others[0], others[1]])):
        await flow.db.matches_v2.insert_one({
            "id": new_id(), "tournament_id": race["id"], "stage_id": "s1", "round": round_no, "round_name": f"Runde {round_no}", "section": "WB", "match_type": "ffa",
            "status": "completed", "slots": [{"slot": i, "registration_id": r["id"]} for i, r in enumerate(ranking, start=1)],
            "results": [{"registration_id": r["id"], "rank": i} for i, r in enumerate(ranking, start=1)],
        })
    flow.act_as(None)
    data = (await flow.get(f"/api/profile/neonfalke/tournaments/{race['slug']}/path")).json()
    assert data["team_name"] == "Lions Rocket" and data["kind"] == "heats"
    assert [(s["label"], s["result"]) for s in data["steps"]] == [("Runde 1", "Platz 2 von 4"), ("Finale", "Platz 1 von 3")]

    league = await finished(flow, "Herbst-Liga", format="round_robin")
    mine = await flow.register(league, me)
    a, b = [await flow.register(league, await person(flow, n)) for n in ("lunabyte", "sternfeuer")]
    await duel(flow, league, mine, a, 2, 0, round_no=1, section="round_robin")
    await duel(flow, league, mine, b, 1, 1, round_no=2, section="round_robin")
    data = (await flow.get(f"/api/profile/neonfalke/tournaments/{league['slug']}/path")).json()
    assert data["kind"] == "table" and [(s["label"], s["result"]) for s in data["steps"]] == [("Liga", "1 Sieg, 1 Unentschieden, 0 Niederlagen")]


@pytest.mark.asyncio
async def test_record_counts_frequent_opponents_and_hides_private_ones_publicly(flow):
    me = await person(flow, "neonfalke")
    panther = await person(flow, "pixelpanther")
    tina = await person(flow, "turbotina", public=False)
    once = await person(flow, "einmalig")
    regs_against = {}
    for index in range(4):
        cup = await finished(flow, f"Cup {index}")
        mine = await flow.register(cup, me)
        regs_against[index] = (cup, mine)
        await duel(flow, cup, mine, await flow.register(cup, panther), *((2, 1) if index < 3 else (0, 2)))
        if index < 2:
            await duel(flow, cup, mine, await flow.register(cup, tina), 1, 1 if index == 0 else 3, round_no=2)
    cup, mine = regs_against[0]
    await duel(flow, cup, mine, await flow.register(cup, once), 3, 0, round_no=3)

    # Team gegen Team zählt gegen das Team.
    team = {"id": new_id(), "name": "Lions Rocket", "tag": "LRK", "is_public": True}
    rivals = {"id": new_id(), "name": "Pixelpiraten", "tag": "PXP", "is_public": True}
    hidden_team = {"id": new_id(), "name": "Schattenclan", "tag": "SHD", "is_public": False}
    await flow.db.teams.insert_many([dict(team), dict(rivals), dict(hidden_team)])
    await flow.db.team_members.insert_one({"team_id": team["id"], "user_id": me["id"], "role": "member"})
    for index in range(2):
        cup = await finished(flow, f"Team-Cup {index}", team_mode="team", team_size=2)
        ours = {"id": new_id(), "tournament_id": cup["id"], "team_id": team["id"], "display_name": "Lions Rocket", "status": "approved"}
        theirs = {"id": new_id(), "tournament_id": cup["id"], "team_id": rivals["id"], "display_name": "Pixelpiraten", "status": "approved"}
        shadow = {"id": new_id(), "tournament_id": cup["id"], "team_id": hidden_team["id"], "display_name": "Schattenclan", "status": "approved"}
        await flow.db.tournament_registrations.insert_many([dict(ours), dict(theirs), dict(shadow)])
        await duel(flow, cup, ours, theirs, 2, 0)
        await duel(flow, cup, ours, shadow, 2, 0, round_no=2)
    # Nur für Mitglieder: zählt im eigenen Profil, öffentlich nicht.
    members = await finished(flow, "Vereinsabend", visibility="members")
    await duel(flow, members, await flow.register(members, me), await flow.register(members, panther), 2, 0)

    flow.act_as(me)
    own = (await flow.get("/api/profile/neonfalke/record")).json()
    assert own["public"] is False
    rows = {row["name"]: row for row in own["opponents"]}
    assert (rows["pixelpanther"]["wins"], rows["pixelpanther"]["losses"], rows["pixelpanther"]["games"]) == (4, 1, 5)
    assert (rows["turbotina"]["wins"], rows["turbotina"]["draws"], rows["turbotina"]["losses"]) == (0, 1, 1)
    assert rows["turbotina"]["username"] is None  # privat: kein Link zum Profil
    assert rows["Pixelpiraten"]["kind"] == "team" and rows["Pixelpiraten"]["wins"] == 2
    assert "einmalig" not in rows  # nur ein Spiel - nicht „öfter getroffen“
    assert [row["name"] for row in own["opponents"]][0] == "pixelpanther"

    flow.act_as(None)
    seen = (await flow.get("/api/profile/neonfalke/record")).json()
    names = [row["name"] for row in seen["opponents"]]
    assert "turbotina" not in names and "Schattenclan" not in names
    panther_row = next(row for row in seen["opponents"] if row["name"] == "pixelpanther")
    assert (panther_row["wins"], panther_row["losses"], panther_row["username"]) == (3, 1, "pixelpanther")

    # Privates Profil: öffentlich nichts, selbst alles.
    await flow.db.users.update_one({"id": me["id"]}, {"$set": {"privacy_public_profile": False}})
    assert (await flow.get("/api/profile/neonfalke/record")).status_code == 404
    flow.act_as(me)
    assert (await flow.get("/api/profile/neonfalke/record")).status_code == 200
    assert (await flow.get("/api/profile/neonfalke/record?view_as=public")).status_code == 404
    assert (await flow.get("/api/profile/unbekannt/record")).status_code == 404
