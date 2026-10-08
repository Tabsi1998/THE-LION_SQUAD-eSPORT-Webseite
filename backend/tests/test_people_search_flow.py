"""Personen, Teams und Sponsoren wählen (#1354): ein schmaler Weg je Zweck statt der ganzen Kontoliste.

Durch die echte Anwendung: wer welchen Zweck abfragen darf, dass Treffer nur Kennung, Name, Bild und Zusammenhang tragen
(nie E-Mail oder Rolle), höchstens zehn sind und dass eine E-Mail-Adresse nichts findet.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402

ALLOWED_KEYS = {"id", "name", "avatar_url", "context", "is_club_member", "has_account", "invited_at"}


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def granted(flow, name: str, *areas: str) -> dict:
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": list(areas)}})
    user["areas"] = list(areas)
    return user


async def helper(flow, tournament: dict, name: str, role: str) -> dict:
    user = await flow.add_user(name=name)
    await flow.db.tournament_staff_assignments.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "user_id": user["id"], "role": role, "scope": "tournament", "is_active": True,
    })
    return user


async def search(flow, purpose: str, q: str, context_id: str | None = None):
    params = {"purpose": purpose, "q": q}
    if context_id:
        params["context_id"] = context_id
    return await flow.get("/api/admin/people/search", params=params)


def assert_minimal(rows: list[dict]) -> None:
    for row in rows:
        assert set(row) <= ALLOWED_KEYS, row
        assert "email" not in row and "role" not in row and "username" not in row


@pytest.mark.asyncio
async def test_tournament_search_for_the_lead_and_the_helpers_of_this_tournament_only(flow):
    tournament = await flow.create_tournament(team_mode="solo")
    other = await flow.create_tournament(team_mode="solo")
    erika = await flow.add_user(name="Erika Beispiel")
    await flow.register(tournament, erika)
    await flow.db.memberships.insert_one({"user_id": erika["id"], "member_status": "active"})
    await flow.db.teams.insert_one({"id": new_id(), "name": "Lions Rocket", "tag": "LRK", "member_ids": [erika["id"]], "leader_id": erika["id"]})
    for index in range(14):
        await flow.add_user(name=f"Erika Klon {index:02d}")

    allowed = [
        await flow.add_user(role="tournament_admin", name="turnierleitung"),
        await granted(flow, "freigabe", "tournaments"),
        await helper(flow, tournament, "organisation", "organizer"),
        await helper(flow, tournament, "schiedsrichter", "referee"),
        await helper(flow, tournament, "ergebnisdienst", "scorekeeper"),
    ]
    rows: list[dict] = []
    for actor in allowed:
        flow.act_as(actor)
        found = await search(flow, "tournament", "Erika", tournament["id"])
        assert found.status_code == 200, (actor["username"], found.text)
        rows = found.json()
        assert len(rows) == 10, "höchstens zehn Treffer"
        assert_minimal(rows)
    first = next(row for row in rows if row["id"] == erika["id"])
    assert first["name"] == "Erika Beispiel"
    assert first["context"] == "angemeldet · Mitglied · Team Lions Rocket"

    refused = [
        await helper(flow, tournament, "stationsleitung", "station_manager"),
        await helper(flow, tournament, "stream", "stream_operator"),
        await helper(flow, other, "fremder-helfer", "organizer"),
        await flow.add_user(role="moderator", name="moderation"),
        await granted(flow, "vorstand", "club"),
        await flow.add_user(name="spieler"),
    ]
    for actor in refused:
        flow.act_as(actor)
        answer = await search(flow, "tournament", "Erika", tournament["id"])
        assert answer.status_code == 403, (actor["username"], answer.status_code)
        assert "Dafür fehlt dir das Recht" in answer.json()["detail"]


@pytest.mark.asyncio
async def test_an_email_address_finds_nothing(flow):
    tournament = await flow.create_tournament()
    target = await flow.add_user(name="Max Muster")
    flow.act_as(await flow.add_user(role="tournament_admin", name="turnierleitung"))
    by_address = await search(flow, "tournament", target["email"], tournament["id"])
    assert by_address.json() == []
    by_domain = await search(flow, "tournament", "example.test", tournament["id"])
    assert by_domain.json() == []
    by_name = await search(flow, "tournament", "Max", tournament["id"])
    assert [row["name"] for row in by_name.json()] == ["Max Muster"]


@pytest.mark.asyncio
async def test_fast_lap_access_links_board_and_invitations_have_their_own_rules(flow):
    challenge_id = new_id()
    await flow.db.f1_challenges.insert_one({"id": challenge_id, "slug": "fl-test", "title": "Fast Lap", "status": "live"})
    member = await flow.add_user(name="Mitglied Mia")
    await flow.db.memberships.insert_one({"user_id": member["id"], "member_status": "active"})
    community = await flow.add_user(name="Mitspieler Mo")
    await flow.db.club_member_profiles.insert_one({"id": new_id(), "display_name": "Mitgliedsprofil Mara", "is_active": True})

    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    f1_helper = await flow.add_user(name="zeitnehmer")
    await flow.db.f1_staff_assignments.insert_one({"id": new_id(), "challenge_id": challenge_id, "user_id": f1_helper["id"], "role": "scorekeeper", "is_active": True})
    chair = await granted(flow, "vorstand", "club")
    editor = await granted(flow, "redaktion", "content")

    for actor in (lead, f1_helper):
        flow.act_as(actor)
        found = await search(flow, "fastlap", "Mit", challenge_id)
        rows = found.json()
        assert_minimal(rows)
        by_name = {row["name"]: row for row in rows}
        assert by_name["Mitglied Mia"]["is_club_member"] is True and by_name["Mitspieler Mo"]["is_club_member"] is False
    flow.act_as(editor)
    editor_answer = await search(flow, "fastlap", "Mit", challenge_id)
    assert editor_answer.status_code == 403

    flow.act_as(lead)
    lead_links = await search(flow, "access_links", "Mit")
    assert lead_links.status_code == 200
    for actor in (f1_helper, chair):
        flow.act_as(actor)
        refused_links = await search(flow, "access_links", "Mit")
        assert refused_links.status_code == 403

    # Vorstand: nur Vereinsmitglieder - Konten mit Mitgliedschaft und gepflegte Mitgliederprofile ohne Konto.
    flow.act_as(chair)
    board_answer = await search(flow, "board", "Mit")
    board = board_answer.json()
    assert_minimal(board)
    assert {row["name"] for row in board} == {"Mitglied Mia", "Mitgliedsprofil Mara"}
    # Einladungen: nur Konten ohne Mitgliedschaft; wer schon eingeladen ist, steht mit Datum da.
    await flow.db.membership_invitations.insert_one({"id": new_id(), "user_id": community["id"], "status": "open",
                                                     "created_at": "2026-10-01T10:00:00+00:00", "expires_at": "2099-01-01T00:00:00+00:00"})
    invite_answer = await search(flow, "invite", "Mit")
    invite = invite_answer.json()
    assert_minimal(invite)
    assert [row["name"] for row in invite] == ["Mitspieler Mo"]
    assert invite[0]["context"] == "ist schon eingeladen" and invite[0]["invited_at"].startswith("2026-10-01")
    for actor in (lead, editor):
        flow.act_as(actor)
        board_refused = await search(flow, "board", "Mit")
        invite_refused = await search(flow, "invite", "Mit")
        assert board_refused.status_code == 403 and invite_refused.status_code == 403

    flow.act_as(lead)
    unknown = await search(flow, "unbekannt", "Mit")
    assert unknown.status_code == 400


@pytest.mark.asyncio
async def test_team_and_sponsor_choices_for_the_people_who_need_them(flow):
    tournament = await flow.create_tournament(team_mode="team")
    await flow.db.teams.insert_one({"id": "team-a", "name": "Lions Rocket", "tag": "LRK", "member_ids": ["x", "y"], "is_public": True})
    await flow.db.teams.insert_one({"id": "team-b", "name": "Die Flipper", "tag": "FLP", "member_ids": ["z"], "is_public": False})
    await flow.db.sponsors.insert_one({"id": "sp-1", "name": "Pixelbäckerei", "logo_url": "/logo.webp", "is_active": True, "show_on_events": True, "contact_email": "kontakt@example.test"})
    await flow.db.sponsors.insert_one({"id": "sp-2", "name": "Nur Startseite", "is_active": True, "show_on_events": False})

    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    organizer = await helper(flow, tournament, "organisation", "organizer")
    for actor in (lead, organizer):
        flow.act_as(actor)
        teams = await flow.get("/api/admin/choices/teams", params={"tournament_id": tournament["id"]})
        assert teams.status_code == 200, teams.text
        assert [row["name"] for row in teams.json()] == ["Die Flipper", "Lions Rocket"], "auch nicht öffentliche Teams"
        assert teams.json()[1] == {"id": "team-a", "name": "Lions Rocket", "tag": "LRK", "logo_url": None, "member_count": 2}
    flow.act_as(await flow.add_user(role="moderator", name="moderation"))
    moderator_teams = await flow.get("/api/admin/choices/teams", params={"tournament_id": tournament["id"]})
    assert moderator_teams.status_code == 403

    for actor in (lead, await granted(flow, "redaktion", "content")):
        flow.act_as(actor)
        sponsors = await flow.get("/api/admin/choices/sponsors")
        assert sponsors.status_code == 200, sponsors.text
        assert sponsors.json() == [{"id": "sp-1", "name": "Pixelbäckerei", "logo_url": "/logo.webp"}]
    for actor in (organizer, await granted(flow, "vorstand", "club")):
        flow.act_as(actor)
        refused = await flow.get("/api/admin/choices/sponsors")
        assert refused.status_code == 403
