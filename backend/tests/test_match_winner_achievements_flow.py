"""Sieg-Erfolge aus eingetragenen Ergebnissen (#1796): ein 3:0, eingetragen über ``POST /api/matches/{id}/result``,
schaltet „Zu Null I“ frei. Das Ergebnis trägt dort nur Plätze, kein ``outcome`` - die Erfolge zählen es trotzdem."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
import badges  # noqa: E402
from services import achievement_counters as counters  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


async def first_match(flow, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(4, **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    matches = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))
    match = matches[0]
    first, second = [slot["registration_id"] for slot in match["slots"]]
    player = {reg["id"]: users[index] for index, reg in enumerate(registrations)}
    return match, first, second, player


async def unlocked(flow, user: dict) -> set[str]:
    return {row["tier_code"] async for row in flow.db.user_achievements.find({"user_id": user["id"]}, {"_id": 0, "tier_code": 1})}


@pytest.mark.asyncio
async def test_eingetragener_zu_null_sieg_schaltet_zu_null_frei(flow):
    match, first, second, player = await first_match(flow, best_of=5)
    response = await flow.post(f"/api/matches/{match['id']}/result", json={"results": [
        {"registration_id": first, "rank": 1, "score": 3}, {"registration_id": second, "rank": 2, "score": 0}]})
    assert response.status_code == 200, response.text
    stored = await flow.reload(match)
    assert stored["status"] == "completed"
    assert all("outcome" not in row for row in stored["results"]), "der Ergebnis-Weg schreibt nur Plätze - genau der Fall aus #1796"

    winner, loser = player[first], player[second]
    assert (await counters.compute(winner["id"], {"clean_sheets"}))["clean_sheets"] == 1
    assert (await counters.compute(loser["id"], {"clean_sheets"}))["clean_sheets"] == 0

    await badges.evaluate_user_progress(winner["id"], {"match"})
    await badges.evaluate_user_progress(loser["id"], {"match"})
    assert "clean_sheet_1" in await unlocked(flow, winner)
    assert "clean_sheet_1" not in await unlocked(flow, loser)


@pytest.mark.asyncio
async def test_nur_plaetze_ohne_stand_zaehlen_als_sieg(flow):
    """Zielreihenfolge antippen: kein Stand, nur Plätze - der Außenseiter gewinnt; das ist ein Sieg (Favoritenschreck),
    „Zu Null“ ohne Stand aber nicht."""
    match, first, second, player = await first_match(flow)
    seeds = {slot["registration_id"]: slot.get("seed") for slot in match["slots"]}
    assert seeds[first] < seeds[second], "Platz 1 im Baum ist der besser Gesetzte"
    response = await flow.post(f"/api/matches/{match['id']}/result", json={"results": [
        {"registration_id": second, "rank": 1}, {"registration_id": first, "rank": 2}]})
    assert response.status_code == 200, response.text
    underdog, favourite = player[second], player[first]
    values = await counters.compute(underdog["id"], {"upsets", "clean_sheets"})
    assert (values["upsets"], values["clean_sheets"]) == (1, 0)
    assert (await counters.compute(favourite["id"], {"upsets"}))["upsets"] == 0


@pytest.mark.asyncio
async def test_gespeicherte_gruppenspiele_nur_mit_plaetzen_zaehlen_fuer_den_gruppensieg(flow):
    """Bestehende Daten ohne ``outcome`` zählen ohne Umschreiben mit - hier der Gruppensieg; ein Unentschieden
    (geteilter Platz 1) ist für niemanden ein Sieg."""
    me = await flow.add_user(name="Spielerin")
    other = await flow.add_user(name="Gegner")
    await flow.db.tournaments.insert_one({"id": "t1", "title": "Liga", "status": "completed", "is_public": True})
    await flow.db.tournament_registrations.insert_many([
        {"id": "r-me", "tournament_id": "t1", "user_id": me["id"], "status": "checked_in"},
        {"id": "r-ot", "tournament_id": "t1", "user_id": other["id"], "status": "checked_in"},
    ])

    def played(mid: str, my_rank: int, their_rank: int) -> dict:
        return {"id": mid, "tournament_id": "t1", "group_id": "g1", "status": "completed", "completed_at": "2026-09-01T18:00:00+00:00",
                "slots": [{"slot": 1, "registration_id": "r-me"}, {"slot": 2, "registration_id": "r-ot"}],
                "results": [{"registration_id": "r-me", "rank": my_rank, "score": 2 if my_rank == 1 else 1},
                            {"registration_id": "r-ot", "rank": their_rank, "score": 2 if their_rank == 1 else 1}]}
    await flow.db.matches_v2.insert_many([played("g-1", 1, 2), played("g-2", 1, 1), played("g-3", 2, 1), played("g-4", 1, 2)])
    mine = await counters.compute(me["id"], {"group_stage_firsts"})
    theirs = await counters.compute(other["id"], {"group_stage_firsts"})
    assert mine["group_stage_firsts"] == 1, "zwei Siege gegen einen"
    assert theirs["group_stage_firsts"] == 0


@pytest.mark.asyncio
async def test_sieger_nur_als_winner_id_kommt_durch_die_projektionen(flow):
    """Ältere Spiele der alten Engine nennen den Sieger nur als ``winner_id``. Die Zähler laden ihn aus ``matches_v2``
    mit - Spiele, Gruppenspiele und Teamspiele haben je eine eigene Projektion."""
    me = await flow.add_user(name="Spielerin")
    other = await flow.add_user(name="Gegner")
    await flow.db.tournaments.insert_one({"id": "t1", "title": "Alt", "status": "completed", "is_public": True})
    await flow.db.teams.insert_one({"id": "T1", "name": "Lions", "member_ids": [me["id"]], "leader_id": me["id"], "created_by": me["id"],
                                    "created_at": "2026-01-01T00:00:00+00:00"})
    await flow.db.team_members.insert_one({"team_id": "T1", "user_id": me["id"], "role": "leader", "joined_at": "2026-01-02T00:00:00+00:00"})
    await flow.db.tournament_registrations.insert_many([
        {"id": "r-me", "tournament_id": "t1", "user_id": me["id"], "team_id": "T1", "seed": 4, "status": "checked_in"},
        {"id": "r-ot", "tournament_id": "t1", "user_id": other["id"], "seed": 1, "status": "checked_in"},
    ])

    def legacy(mid: str, winner: str) -> dict:
        return {"id": mid, "tournament_id": "t1", "group_id": "g1", "status": "completed", "winner_id": winner,
                "completed_at": "2026-09-01T18:00:00+00:00",
                "slots": [{"slot": 1, "registration_id": "r-me", "seed": 4}, {"slot": 2, "registration_id": "r-ot", "seed": 1}],
                "results": []}
    await flow.db.matches_v2.insert_many([legacy("w-1", "r-me"), legacy("w-2", "r-me"), legacy("w-3", "r-ot")])
    values = await counters.compute(me["id"], {"upsets", "group_stage_firsts", "team_match_wins"})
    assert values["upsets"] == 2, "zwei Siege gegen den besser Gesetzten"
    assert values["group_stage_firsts"] == 1
    assert values["team_match_wins"] == 2


@pytest.mark.asyncio
async def test_sieger_und_siegesserie_aus_reinen_platz_ergebnissen(flow):
    """Sieger und Siegesserie (matches_won, match_streak_max) über den Turnierbaum: reine Platz-Ergebnisse zählen,
    ein Unentschieden (zweimal Platz 1) und ein Freilos nicht - für beide Seiten."""
    me = await flow.add_user(name="Spielerin")
    other = await flow.add_user(name="Gegner")
    await flow.db.tournaments.insert_one({"id": "t1", "title": "Liga", "status": "completed", "is_public": True})
    await flow.db.tournament_registrations.insert_many([
        {"id": "r-me", "tournament_id": "t1", "user_id": me["id"], "status": "checked_in"},
        {"id": "r-ot", "tournament_id": "t1", "user_id": other["id"], "status": "checked_in"},
    ])

    def played(mid: str, when: str, my_rank: int, their_rank: int) -> dict:
        return {"id": mid, "tournament_id": "t1", "status": "completed", "stage_number": 1, "round": 1, "order": 1,
                "completed_at": when, "updated_at": when,
                "slots": [{"slot": 1, "registration_id": "r-me"}, {"slot": 2, "registration_id": "r-ot"}],
                "results": [{"registration_id": "r-me", "rank": my_rank}, {"registration_id": "r-ot", "rank": their_rank}]}
    bye = {"id": "s-0", "tournament_id": "t1", "status": "completed", "stage_number": 1, "round": 1, "order": 1,
           "completed_at": "2026-09-01T17:00:00+00:00", "updated_at": "2026-09-01T17:00:00+00:00",
           "slots": [{"slot": 1, "registration_id": "r-ot"}, {"slot": 2, "registration_id": None, "status": "bye"}],
           "results": [{"registration_id": "r-ot", "rank": 1, "note": "Freilos", "reported_by": "system"}]}
    await flow.db.matches_v2.insert_many([
        bye,
        played("s-1", "2026-09-01T18:00:00+00:00", 1, 2),
        played("s-2", "2026-09-02T18:00:00+00:00", 1, 2),
        played("s-3", "2026-09-03T18:00:00+00:00", 1, 1),
        played("s-4", "2026-09-04T18:00:00+00:00", 2, 1),
    ])
    mine = await counters.compute(me["id"], {"matches_won", "match_streak_max"})
    theirs = await counters.compute(other["id"], {"matches_won", "match_streak_max"})
    assert (mine["matches_won"], mine["match_streak_max"]) == (2, 2)
    assert (theirs["matches_won"], theirs["match_streak_max"]) == (1, 1), "nur s-4 - Freilos und Unentschieden nicht"
