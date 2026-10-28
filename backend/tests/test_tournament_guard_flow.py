"""Folgenschwere Turnier-Aktionen absichern (#2120).

Formatwechsel (TA9), Gruppen generieren (TA10), Schweizer Runde (TA11), Vorschau über echten Spielen (TA12), Anmeldung
entfernen (TA13), Zurücksetzen (TA16), Struktur anwenden (TA17) und Absage mit Nachricht (TA24) - jeweils mit echter
Datenbank-Semantik in der Reihenfolge, in der die Turnierleitung klickt.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def ranking(winner: str, loser: str) -> list[dict]:
    return [
        {"registration_id": winner, "rank": 1, "score": 2},
        {"registration_id": loser, "rank": 2, "score": 0},
    ]


def sides(match: dict) -> list[str]:
    return [slot["registration_id"] for slot in match["slots"]]


async def fixed_bracket(flow, count=4, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(count, **fields)
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert built.status_code == 200, built.text
    await flow.start(tournament)
    return staff, tournament, users, registrations


async def play_first(flow, tournament) -> dict:
    playable = [m for m in await flow.matches(tournament)
                if len([s for s in m.get("slots") or [] if s.get("registration_id")]) == 2
                and m.get("status") != "completed"]
    match = sorted(playable, key=lambda m: (m.get("round") or 0, m.get("match_key") or ""))[0]
    played = await flow.post(f"/api/matches/{match['id']}/result", json={"results": ranking(*sides(match))})
    assert played.status_code == 200, played.text
    # Rückgängig-Fenster (#1158): das Ergebnis gilt erst danach - für die Zählung reicht der gespeicherte Stand.
    return await flow.reload(match)


async def stored(flow, tournament) -> dict:
    return await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})


# ---------------------------------------------------------------- TA9 Formatwechsel

@pytest.mark.asyncio
async def test_a_format_change_before_the_check_in_ends_rebuilds_the_preview(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(4)
    preview = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=true")
    assert preview.status_code == 200, preview.text
    single_count = len(await flow.matches(tournament))

    changed = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"format": "double_elim"})

    assert changed.status_code == 200, changed.text
    stages = await flow.db.tournament_stages.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(10)
    assert [stage["stage_type"] for stage in stages] == ["double_elimination"]
    matches = await flow.matches(tournament)
    assert matches and all(match.get("is_preview") for match in matches)
    assert len(matches) > single_count, "Doppel-K.-o. hat ein Loser Bracket"


@pytest.mark.asyncio
async def test_a_team_change_before_the_check_in_ends_rebuilds_the_preview_too(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(4)
    await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=true")
    before = {match["id"] for match in await flow.matches(tournament)}

    changed = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"team_mode": "team", "team_size": 2})

    assert changed.status_code == 200, changed.text
    after = {match["id"] for match in await flow.matches(tournament)}
    assert after and not (after & before), "die Vorschau ist neu gebaut"


@pytest.mark.asyncio
async def test_after_the_check_in_ends_format_team_and_game_stay_fixed(flow):
    staff, tournament, _users, _regs = await fixed_bracket(flow)
    game_id = "spiel-neu"
    await flow.db.games.insert_one({"id": game_id, "name": "Erfundenes Spiel"})
    before = await flow.matches(tournament)

    for change in ({"format": "double_elim"}, {"team_mode": "team", "team_size": 3}, {"game_id": game_id}):
        refused = await flow.patch(f"/api/tournaments/{tournament['id']}", json=change)
        assert refused.status_code == 409, (change, refused.text)
        assert "steht seit dem Ende des Check-ins fest" in refused.json()["detail"]

    # Derselbe Wert und alles andere bleiben änderbar.
    same = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"format": "single_elim", "title": "Neuer Titel"})
    assert same.status_code == 200, same.text
    assert len(await flow.matches(tournament)) == len(before)


@pytest.mark.asyncio
async def test_a_closed_check_in_fixes_the_structure_before_the_start(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(4, status="check_in")
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"check_in_closed_at": "2026-10-28T10:00:00+00:00"}})

    refused = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"format": "round_robin"})

    assert refused.status_code == 409, refused.text


# ---------------------------------------------------------------- TA10 Gruppen generieren

@pytest.mark.asyncio
async def test_generating_groups_keeps_the_status(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(8, format="groups")

    generated = await flow.post(f"/api/tournaments/{tournament['id']}/groups/generate", json={"group_count": 2})

    assert generated.status_code == 200, generated.text
    assert (await stored(flow, tournament))["status"] == "registration_open"


@pytest.mark.asyncio
async def test_regenerating_groups_with_results_needs_a_confirmation_with_the_numbers(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(8, format="groups")
    url = f"/api/tournaments/{tournament['id']}/groups/generate"
    assert (await flow.post(url, json={"group_count": 2})).status_code == 200
    await flow.start(tournament)
    await play_first(flow, tournament)

    refused = await flow.post(url, json={"group_count": 2})

    assert refused.status_code == 409, refused.text
    detail = refused.json()["detail"]
    assert detail["code"] == "confirm_destruction"
    assert detail["match_count"] == 12 and detail["played_count"] == 1
    assert "12 Spiele, davon 1 begonnen oder gewertet" in detail["message"]
    assert any(m.get("status") == "completed" for m in await flow.matches(tournament)), "nichts gelöscht"

    confirmed = await flow.post(f"{url}?force=true", json={"group_count": 2})
    assert confirmed.status_code == 200, confirmed.text
    assert not any(m.get("status") == "completed" for m in await flow.matches(tournament))
    assert (await stored(flow, tournament))["status"] == "live"


@pytest.mark.asyncio
async def test_groups_respect_the_lock_and_the_end(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(8, format="groups")
    url = f"/api/tournaments/{tournament['id']}/groups/generate"

    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"locked_at": "2026-10-28T10:00:00+00:00"}})
    assert (await flow.post(url, json={"group_count": 2})).status_code == 423

    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "completed"}, "$unset": {"locked_at": ""}})
    finished = await flow.post(f"{url}?force=true", json={"group_count": 2})
    assert finished.status_code == 409
    assert "vorbei" in finished.json()["detail"]


@pytest.mark.asyncio
async def test_recalculating_the_advancement_respects_the_lock(flow):
    staff, tournament, _users, _regs = await fixed_bracket(flow)
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"locked_at": "2026-10-28T10:00:00+00:00"}})

    refused = await flow.post(f"/api/tournaments/{tournament['id']}/matches-v2/recalculate-advancement")

    assert refused.status_code == 423
