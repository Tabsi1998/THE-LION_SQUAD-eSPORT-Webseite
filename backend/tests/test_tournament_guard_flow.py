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
async def test_a_team_change_keeps_an_own_stage_and_its_planned_times(flow):
    """Review #2120: die eigene Phase (Name, Best of) bleibt, nur ihre Vorschau-Spiele werden neu gebaut."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(4, team_mode="team", team_size=2)
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=true",
                            json={"name": "Hauptrunde", "settings": {"best_of": 3}})
    assert built.status_code == 200, built.text
    stage_before = await flow.db.tournament_stages.find_one({"tournament_id": tournament["id"]}, {"_id": 0})
    planned = "2026-11-01T10:00:00+00:00"
    await flow.db.matches_v2.update_many({"tournament_id": tournament["id"]}, {"$set": {"scheduled_at": planned}})

    changed = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"team_size": 3})

    assert changed.status_code == 200, changed.text
    stage = await flow.db.tournament_stages.find_one({"tournament_id": tournament["id"]}, {"_id": 0})
    assert stage["id"] == stage_before["id"] and stage["name"] == "Hauptrunde"
    assert stage["settings"].get("best_of") == 3
    matches = await flow.matches(tournament)
    assert matches and all(match.get("is_preview") for match in matches)
    assert all(match.get("scheduled_at") == planned for match in matches)


@pytest.mark.asyncio
async def test_a_format_change_leaves_an_own_stage_alone(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(4)
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=true",
                            json={"name": "Hauptrunde", "settings": {"best_of": 3}})
    assert built.status_code == 200, built.text
    before = sorted(match["id"] for match in await flow.matches(tournament))

    changed = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"format": "double_elim"})

    assert changed.status_code == 200, changed.text
    assert changed.json()["auto_generated_bracket"]["reason"] == "custom_stages"
    stage = await flow.db.tournament_stages.find_one({"tournament_id": tournament["id"]}, {"_id": 0})
    assert stage["name"] == "Hauptrunde" and stage["stage_type"] == "single_elimination"
    assert sorted(match["id"] for match in await flow.matches(tournament)) == before


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


# ---------------------------------------------------------------- TA11 Schweizer Runde

@pytest.mark.asyncio
async def test_a_swiss_round_does_not_start_the_tournament(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(4, format="swiss", status="draft")

    created = await flow.post(f"/api/tournaments/{tournament['id']}/swiss/next-round")

    assert created.status_code == 200, created.text
    assert (await stored(flow, tournament))["status"] == "draft"


@pytest.mark.asyncio
async def test_a_swiss_round_respects_the_lock_and_the_end(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(4, format="swiss")
    url = f"/api/tournaments/{tournament['id']}/swiss/next-round"
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"locked_at": "2026-10-28T10:00:00+00:00"}})
    assert (await flow.post(url)).status_code == 423
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "results_published"}, "$unset": {"locked_at": ""}})
    assert (await flow.post(url)).status_code == 409


@pytest.mark.asyncio
async def test_the_last_swiss_round_can_be_taken_back_until_a_match_begins(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(5, format="swiss")
    await flow.start(tournament)
    base = f"/api/tournaments/{tournament['id']}/swiss"
    assert (await flow.post(f"{base}/next-round")).status_code == 200

    undone = await flow.post(f"{base}/undo-round")

    assert undone.status_code == 200, undone.text
    assert undone.json()["round"] == 1 and undone.json()["match_count"] == 3
    assert await flow.matches(tournament) == []

    # Neu erzeugen geht wieder mit Runde 1; nach einem Ergebnis bleibt die Runde.
    again = await flow.post(f"{base}/next-round")
    assert again.status_code == 200 and again.json()["round"] == 1
    await play_first(flow, tournament)
    refused = await flow.post(f"{base}/undo-round")
    assert refused.status_code == 409, refused.text
    assert "begonnen" in refused.json()["detail"]
    assert len(await flow.matches(tournament)) == 3


@pytest.mark.asyncio
async def test_a_called_swiss_match_holds_its_round(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(4, format="swiss")
    base = f"/api/tournaments/{tournament['id']}/swiss"
    assert (await flow.post(f"{base}/next-round")).status_code == 200
    first = (await flow.matches(tournament))[0]
    await flow.db.matches_v2.update_one({"id": first["id"]}, {"$set": {"called_at": "2026-10-28T10:00:00+00:00"}})

    assert (await flow.post(f"{base}/undo-round")).status_code == 409


@pytest.mark.asyncio
async def test_without_a_round_there_is_nothing_to_take_back(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(4, format="swiss")

    refused = await flow.post(f"/api/tournaments/{tournament['id']}/swiss/undo-round")

    assert refused.status_code == 409
    assert "keine Runde" in refused.json()["detail"]


# ---------------------------------------------------------------- TA12 / TA17 Vorschau über echten Spielen

@pytest.mark.asyncio
async def test_a_preview_never_replaces_real_matches(flow):
    staff, tournament, _users, _regs = await fixed_bracket(flow)
    stage = await flow.db.tournament_stages.find_one({"tournament_id": tournament["id"]}, {"_id": 0})
    before = sorted(match["id"] for match in await flow.matches(tournament))

    for url in (f"/api/tournaments/{tournament['id']}/stages/{stage['id']}/generate?preview=true&force=true",
                f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=true&force=true"):
        refused = await flow.post(url, json={} if "from-format" in url else None)
        assert refused.status_code == 409, (url, refused.text)
        detail = refused.json()["detail"]
        assert detail["code"] == "bracket_fixed"
        assert "Eine Vorschau ersetzt keine echten Spiele" in detail["message"]

    assert sorted(match["id"] for match in await flow.matches(tournament)) == before


@pytest.mark.asyncio
async def test_rebuilding_real_matches_names_the_numbers_before_force(flow):
    staff, tournament, _users, _regs = await fixed_bracket(flow)
    await play_first(flow, tournament)
    stage = await flow.db.tournament_stages.find_one({"tournament_id": tournament["id"]}, {"_id": 0})

    for url in (f"/api/tournaments/{tournament['id']}/stages/{stage['id']}/generate",
                f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false"):
        refused = await flow.post(url)
        assert refused.status_code == 409, (url, refused.text)
        detail = refused.json()["detail"]
        assert detail["code"] == "confirm_destruction", url
        assert detail["match_count"] == 3 and detail["played_count"] == 1, url


@pytest.mark.asyncio
async def test_after_the_end_the_structure_is_not_rebuilt(flow):
    staff, tournament, _users, _regs = await fixed_bracket(flow)
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "completed"}})

    refused = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false&force=true")

    assert refused.status_code == 409
    assert "vorbei" in refused.json()["detail"]


# ---------------------------------------------------------------- TA13 Anmeldung entfernen

@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["live", "paused", "completed"])
async def test_a_registration_in_the_fixed_bracket_is_not_deleted(flow, status):
    staff, tournament, _users, registrations = await fixed_bracket(flow)
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": status}})
    target = registrations[0]["id"]

    refused = await flow.delete(f"/api/tournaments/{tournament['id']}/registrations/{target}")

    assert refused.status_code == 409, refused.text
    assert await flow.db.tournament_registrations.find_one({"id": target})
    if status in {"live", "paused"}:
        assert "Austritt eintragen" in refused.json()["detail"]


@pytest.mark.asyncio
@pytest.mark.parametrize("new_status", ["rejected", "waitlist", "pending"])
async def test_a_registration_in_the_fixed_bracket_keeps_its_place(flow, new_status):
    staff, tournament, _users, registrations = await fixed_bracket(flow)
    target = registrations[0]["id"]

    refused = await flow.patch(f"/api/tournaments/{tournament['id']}/registrations/{target}", json={"status": new_status})

    assert refused.status_code == 409, refused.text
    assert (await flow.db.tournament_registrations.find_one({"id": target}))["status"] == "approved"


@pytest.mark.asyncio
async def test_a_registration_outside_the_bracket_can_still_go(flow):
    staff, tournament, _users, _registrations = await fixed_bracket(flow)
    late = await flow.register(tournament, await flow.add_user(name="Wartend"), status="waitlist")

    removed = await flow.delete(f"/api/tournaments/{tournament['id']}/registrations/{late['id']}")

    assert removed.status_code == 200, removed.text
    assert not await flow.db.tournament_registrations.find_one({"id": late["id"]})


@pytest.mark.asyncio
async def test_a_player_cannot_leave_fixed_groups_before_the_start(flow):
    """Review #2120: auch die eigene Abmeldung ließ feste Gruppenspiele mit einer fehlenden Anmeldung zurück."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(8, format="groups")
    assert (await flow.post(f"/api/tournaments/{tournament['id']}/groups/generate", json={"group_count": 2})).status_code == 200
    target = registrations[0]["id"]

    flow.act_as(users[0])
    refused = await flow.delete(f"/api/tournaments/{tournament['id']}/registrations/{target}")

    assert refused.status_code == 409, refused.text
    assert "Turnierleitung" in refused.json()["detail"]
    assert await flow.db.tournament_registrations.find_one({"id": target})

    # Die Turnierleitung bekommt vor dem Check-in den passenden Weg genannt.
    flow.act_as(staff)
    by_staff = await flow.delete(f"/api/tournaments/{tournament['id']}/registrations/{target}")
    assert by_staff.status_code == 409
    assert "neu generieren" in by_staff.json()["detail"]


@pytest.mark.asyncio
async def test_before_the_check_in_ends_a_registration_still_leaves_the_preview(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, registrations = await flow.with_participants(4)
    await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=true")

    removed = await flow.delete(f"/api/tournaments/{tournament['id']}/registrations/{registrations[0]['id']}")

    assert removed.status_code == 200, removed.text


# ---------------------------------------------------------------- TA16 Zurücksetzen

@pytest.mark.asyncio
async def test_reset_keeps_the_status_before_the_start(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(4)
    await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=true")

    reset = await flow.post(f"/api/tournaments/{tournament['id']}/reset-bracket")

    assert reset.status_code == 200, reset.text
    assert (await stored(flow, tournament))["status"] == "registration_open"
    assert await flow.matches(tournament) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["live", "paused", "cancelled", "check_in"])
async def test_reset_of_real_matches_needs_force_and_names_the_numbers(flow, status):
    staff, tournament, _users, _regs = await fixed_bracket(flow)
    if status == "live":
        await play_first(flow, tournament)
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": status}})

    refused = await flow.post(f"/api/tournaments/{tournament['id']}/reset-bracket")

    assert refused.status_code == 409, refused.text
    detail = refused.json()["detail"]
    assert detail["code"] == "confirm_destruction"
    assert detail["match_count"] == 3
    assert detail["played_count"] == (1 if status == "live" else 0)
    assert len(await flow.matches(tournament)) == 3

    confirmed = await flow.post(f"/api/tournaments/{tournament['id']}/reset-bracket?force=true")
    assert confirmed.status_code == 200, confirmed.text
    assert await flow.matches(tournament) == []
    assert (await stored(flow, tournament))["status"] == status, "Zurücksetzen ändert den Status nicht mehr"


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["completed", "results_published", "archived"])
async def test_after_the_end_reset_is_refused_even_with_force(flow, status):
    staff, tournament, _users, _regs = await fixed_bracket(flow)
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": status}})

    refused = await flow.post(f"/api/tournaments/{tournament['id']}/reset-bracket?force=true")

    assert refused.status_code == 409
    assert "vorbei" in refused.json()["detail"]
    assert len(await flow.matches(tournament)) == 3


# ---------------------------------------------------------------- TA24 Absage mit Nachricht

@pytest.mark.asyncio
async def test_a_cancellation_tells_everyone_registered_with_the_reason(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, _regs = await flow.with_participants(3)
    waiting = await flow.add_user(name="Warteliste")
    await flow.register(tournament, waiting, status="waitlist")
    rejected = await flow.add_user(name="Abgelehnt")
    await flow.register(tournament, rejected, status="rejected")

    cancelled = await flow.post(f"/api/tournaments/{tournament['id']}/status",
                                json={"status": "cancelled", "reason": "Halle nicht verfügbar"})

    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["notified"] == 4
    notes = await flow.db.notifications.find({"kind": "tournament_cancelled"}, {"_id": 0}).to_list(20)
    assert {note["user_id"] for note in notes} == {user["id"] for user in users} | {waiting["id"]}
    assert all("Halle nicht verfügbar" in note["body"] for note in notes)
    assert all("Testturnier" in note["title"] for note in notes)

    # Ein zweites „Abgesagt“ schickt nichts noch einmal.
    again = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "cancelled"})
    assert again.status_code == 200
    assert await flow.db.notifications.count_documents({"kind": "tournament_cancelled"}) == 4


@pytest.mark.asyncio
async def test_a_cancellation_without_reason_still_tells_them(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, _regs = await flow.with_participants(2)

    cancelled = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "cancelled"})

    assert cancelled.status_code == 200, cancelled.text
    notes = await flow.db.notifications.find({"kind": "tournament_cancelled"}, {"_id": 0}).to_list(20)
    assert len(notes) == 2
    assert all("Grund" not in note["body"] for note in notes)
