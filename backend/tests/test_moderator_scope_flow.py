"""Moderatoren moderieren; Turnierrechte kommen aus Turnierleitung oder Helfer-Einsatz.

Durch die echte Anwendung: ohne Einsatz ändert ein Moderator in einem Turnier oder einer Fast Lap
nichts, mit Einsatz genau das, was der Einsatz erlaubt. Meldungen, Wortfilter, Bildprüfung,
Verwarnungen und Direktnachrichten bleiben seine Arbeit. Bannen braucht einen Grund, steht mit dem
Grund im Audit-Log, das eigene Konto lässt sich nicht bannen, und Konten mit Adminbereich oder
Admin-Rolle bannt (und entbannt) nur der Superadmin.
"""
import pathlib
import sys
from datetime import datetime, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
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


async def live_bracket(flow, count: int = 4) -> tuple[dict, list[dict]]:
    """Ein laufendes Turnier mit fertigem Turnierbaum - aufgebaut von der Turnierleitung."""
    lead = await flow.add_staff()
    flow.act_as(lead)
    tournament, _users, registrations = await flow.with_participants(count)
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert built.status_code == 200, built.text
    await flow.start(tournament)
    return tournament, registrations


async def assign(flow, tournament: dict, user: dict, role: str) -> None:
    await flow.db.tournament_staff_assignments.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "user_id": user["id"],
        "role": role, "scope": "tournament", "is_active": True,
    })


async def fast_lap(flow, title: str) -> tuple[str, str]:
    challenge_id, track_id = new_id(), new_id()
    await flow.db.f1_challenges.insert_one({
        "id": challenge_id, "slug": f"fastlap-{challenge_id[:8]}", "title": title,
        "status": "active", "visibility": "public",
    })
    await flow.db.f1_tracks.insert_one({"id": track_id, "challenge_id": challenge_id, "name": "Teststrecke"})
    return challenge_id, track_id


def sides(match: dict) -> tuple[str, str]:
    first, second = [slot["registration_id"] for slot in match["slots"]]
    return first, second


# ---------------------------------------------------------------- Turniere und Fast Lap

@pytest.mark.asyncio
async def test_a_moderator_without_an_assignment_changes_nothing_in_a_tournament(flow):
    tournament, registrations = await live_bracket(flow)
    match = (await flow.matches(tournament))[0]
    tid, reg_id = tournament["id"], registrations[0]["id"]
    flow.act_as(await flow.add_user(role="moderator", name="mod"))

    attempts = [
        ("post", f"/api/tournaments/{tid}/status", {"json": {"status": "paused"}}),
        ("post", f"/api/tournaments/{tid}/reset-bracket", {"params": {"force": "true"}}),
        ("post", f"/api/tournaments/{tid}/bracket/from-format", {"params": {"preview": "false", "force": "true"}}),
        ("patch", f"/api/tournaments/{tid}/registrations/{reg_id}", {"json": {"status": "rejected"}}),
        ("post", f"/api/tournaments/{tid}/registrations/{reg_id}/checkin", {"json": {"status": "checked_in"}}),
        ("post", f"/api/matches/{match['id']}/result", {"json": {"results": ranking(*sides(match))}}),
    ]
    for method, url, kwargs in attempts:
        response = await getattr(flow, method)(url, **kwargs)
        assert response.status_code == 403, (url, response.status_code, response.text)

    assert (await flow.reload(match)).get("status") != "completed"
    assert (await flow.db.tournaments.find_one({"id": tid}))["status"] == "live"
    assert (await flow.db.tournament_registrations.find_one({"id": reg_id}))["status"] == "approved"


@pytest.mark.asyncio
async def test_a_moderator_with_an_assignment_has_exactly_the_rights_of_that_assignment(flow):
    tournament, _registrations = await live_bracket(flow)
    other, _other_registrations = await live_bracket(flow)
    mod = await flow.add_user(role="moderator", name="mod")
    await assign(flow, tournament, mod, "scorekeeper")
    flow.act_as(mod)

    match = (await flow.matches(tournament))[0]
    entered = await flow.post(f"/api/matches/{match['id']}/result", json={"results": ranking(*sides(match))})
    assert entered.status_code == 200, entered.text
    assert (await flow.reload(match))["status"] == "completed"

    # Was der Einsatz als Punktezähler nicht hergibt (Status, Turnierbaum), bleibt zu - auch im eigenen Turnier.
    tid = tournament["id"]
    assert (await flow.post(f"/api/tournaments/{tid}/status", json={"status": "paused"})).status_code == 403
    assert (await flow.post(f"/api/tournaments/{tid}/reset-bracket", params={"force": "true"})).status_code == 403
    assert (await flow.post(f"/api/tournaments/{tid}/bracket/from-format", params={"preview": "false", "force": "true"})).status_code == 403

    # Im fremden Turnier gilt der Einsatz nicht.
    other_match = (await flow.matches(other))[0]
    refused = await flow.post(f"/api/matches/{other_match['id']}/result", json={"results": ranking(*sides(other_match))})
    assert refused.status_code == 403, refused.text


@pytest.mark.asyncio
async def test_fast_lap_times_need_an_assignment_in_that_challenge(flow):
    mine, my_track = await fast_lap(flow, "Fast Lap Herbst")
    other, other_track = await fast_lap(flow, "Fast Lap Winter")
    driver = await flow.add_user(name="fahrerin")
    mod = await flow.add_user(role="moderator", name="mod")
    flow.act_as(mod)

    def lap(track_id: str) -> dict:
        return {"user_id": driver["id"], "track_id": track_id, "time_ms": 81234}

    assert (await flow.post(f"/api/f1/challenges/{mine}/times", json=lap(my_track))).status_code == 403
    assert (await flow.get(f"/api/f1/challenges/{mine}/export.csv")).status_code == 403

    await flow.db.f1_staff_assignments.insert_one({
        "id": new_id(), "challenge_id": mine, "user_id": mod["id"], "role": "scorekeeper", "is_active": True,
    })
    entered = await flow.post(f"/api/f1/challenges/{mine}/times", json=lap(my_track))
    assert entered.status_code == 200, entered.text
    assert (await flow.post(f"/api/f1/challenges/{other}/times", json=lap(other_track))).status_code == 403


@pytest.mark.asyncio
async def test_drafts_exports_and_team_administration_stay_with_the_tournament_lead(flow):
    tournament = await flow.create_tournament(status="draft")
    event_id = new_id()
    await flow.db.events.insert_one({"id": event_id, "slug": "entwurf-event", "name": "Entwurf", "status": "draft", "visibility": "public"})
    leader = await flow.add_user(name="teamleitung")
    team_id = new_id()
    await flow.db.teams.insert_one({"id": team_id, "name": "Testteam", "tag": "TST", "leader_id": leader["id"],
                                    "co_leader_ids": [], "member_ids": [leader["id"]], "is_public": True})
    flow.act_as(await flow.add_user(role="moderator", name="mod"))

    assert (await flow.get(f"/api/tournaments/{tournament['id']}")).status_code == 404
    assert (await flow.get(f"/api/events/{event_id}")).status_code == 404
    assert (await flow.get(f"/api/exports/tournaments/{tournament['id']}/participants.pdf")).status_code == 403
    assert (await flow.patch(f"/api/teams/{team_id}", json={"description": "geändert"})).status_code == 403
    assert (await flow.get(f"/api/teams/{team_id}/chat")).status_code == 403
    me = (await flow.get("/api/auth/me")).json()
    assert me["areas"] == ["moderation"]


# ---------------------------------------------------------------- Moderation

@pytest.mark.asyncio
async def test_moderation_stays_the_moderators_work(flow):
    mod = await flow.add_user(role="moderator", name="mod")
    target = await flow.add_user(name="gemeldet")
    await flow.db.users.update_one({"id": target["id"]}, {"$set": {"dm_privacy": "admins_only"}})
    flow.act_as(await flow.add_user(name="meldende"))
    reported = await flow.post("/api/moderation/reports", json={
        "target_user_id": target["id"], "category": "harassment", "details": "Beleidigung im Turnier-Chat",
    })
    assert reported.status_code == 200, reported.text
    report_id = reported.json()["report"]["id"]

    mod["auth_mfa_verified"] = False  # Moderation braucht keine Zwei-Faktor-Anmeldung
    flow.act_as(mod)
    assert (await flow.get("/api/moderation/reports")).status_code == 200
    decided = await flow.patch(f"/api/moderation/reports/{report_id}", json={"status": "justified", "resolution_note": "Belegt"})
    assert decided.status_code == 200, decided.text
    assert decided.json()["strike"]
    assert (await flow.post("/api/moderation/word-filter/entries", json={"term": "testwort", "action": "flag"})).status_code == 200
    assert (await flow.get("/api/moderation/items")).status_code == 200
    assert (await flow.get("/api/moderation/media-scan/queue")).status_code == 200
    sanction = await flow.post(f"/api/moderation/people/{target['id']}/sanctions", json={
        "action": "warning", "reason": "Wiederholte Beleidigung", "chat_hours": 24,
    })
    assert sanction.status_code == 200, sanction.text
    # Auch wer nur Admins schreiben lässt, erreicht die Moderation - etwa um eine Meldung zu klären.
    contact = await flow.post(f"/api/messages/direct/{target['id']}", json={"message": "Kurze Frage zu deiner Meldung"})
    assert contact.status_code == 200, contact.text


# ---------------------------------------------------------------- Bannen

@pytest.mark.asyncio
async def test_only_the_superadmin_bans_accounts_with_an_admin_area(flow):
    chair = await flow.add_user(name="vorsitz")
    await flow.db.board_positions.insert_one({"id": new_id(), "slug": "obmann", "title_male": "Obmann", "is_active": True,
                                              "user_id": chair["id"], "deputy_user_id": None})
    deputy = await flow.add_user(name="vize")
    profile_id = new_id()
    await flow.db.club_member_profiles.insert_one({"id": profile_id, "user_id": deputy["id"], "slug": "vize"})
    await flow.db.board_positions.insert_one({"id": new_id(), "slug": "kassier", "title_male": "Kassier", "is_active": True,
                                              "user_id": None, "deputy_user_id": profile_id})
    editor = await flow.add_user(name="redaktion")
    await flow.db.users.update_one({"id": editor["id"]}, {"$set": {"areas": ["content"]}})
    mod = await flow.add_user(role="moderator", name="mod")
    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    club_admin = await flow.add_user(role="club_admin", name="clubadmin")
    root = await flow.add_user(role="superadmin", name="root")
    player = await flow.add_user(name="spieler")
    protected = [deputy, editor, mod, lead, club_admin, root]
    reason = {"reason": "Wiederholt beleidigt"}

    # Die Liste sagt vorher, wen nur der Superadmin bannt.
    flow.act_as(chair)
    listed = {row["username"]: row["ban_protected"] for row in (await flow.get("/api/users")).json()}
    assert listed["spieler"] is False
    assert all(listed[user["username"]] is True for user in protected + [chair])

    for target in protected:
        refused = await flow.post(f"/api/users/{target['id']}/ban", json=reason)
        assert refused.status_code == 403, (target["username"], refused.text)
        assert "Superadmin" in refused.json()["detail"]
    assert await flow.db.users.count_documents({"is_banned": True}) == 0

    # Nie das eigene Konto; immer mit Grund.
    assert (await flow.post(f"/api/users/{chair['id']}/ban", json=reason)).status_code == 400
    assert (await flow.post(f"/api/users/{player['id']}/ban")).status_code == 422
    assert (await flow.post(f"/api/users/{player['id']}/ban", json={"reason": " kurz "})).status_code == 422
    banned = await flow.post(f"/api/users/{player['id']}/ban", json=reason)
    assert banned.status_code == 200, banned.text
    assert (await flow.db.users.find_one({"id": player["id"]}))["is_banned"] is True
    audit = await flow.db.audit_logs.find_one({"action": "user.ban", "target_id": player["id"]}, {"_id": 0})
    assert audit["actor_id"] == chair["id"] and audit["data"]["reason"] == "Wiederholt beleidigt"
    assert (await flow.post(f"/api/users/{player['id']}/unban")).status_code == 200

    # Der Superadmin bannt auch Konten mit Adminbereich - mit Grund, nie sich selbst.
    flow.act_as(root)
    assert (await flow.post(f"/api/users/{root['id']}/ban", json=reason)).status_code == 400
    assert (await flow.post(f"/api/users/{lead['id']}/ban", json={"reason": ""})).status_code == 422
    assert (await flow.post(f"/api/users/{lead['id']}/ban", json=reason)).status_code == 200
    audit = await flow.db.audit_logs.find_one({"action": "user.ban", "target_id": lead["id"]}, {"_id": 0})
    assert audit["actor_id"] == root["id"] and audit["data"]["reason"] == "Wiederholt beleidigt"

    # Entbannen eines geschützten Kontos ist ebenfalls Sache des Superadmins.
    flow.act_as(chair)
    assert (await flow.post(f"/api/users/{lead['id']}/unban")).status_code == 403
    flow.act_as(root)
    assert (await flow.post(f"/api/users/{lead['id']}/unban")).status_code == 200
    assert (await flow.db.users.find_one({"id": lead["id"]}))["is_banned"] is False


@pytest.mark.asyncio
async def test_the_list_flag_and_the_ban_check_agree_with_dolibarr_functions(flow):
    """Ist die Funktions-Freigabe aus Dolibarr aktiv, schützt die Funktion - der lokale Posten nicht mehr."""
    from services.dolibarr_client import SETTINGS_ID
    from services.permissions import ban_protected, ban_protected_ids

    now = datetime.now(timezone.utc).isoformat()
    await flow.db.settings.insert_one({"id": SETTINGS_ID, "mode": "live",
                                       "function_policy": {"approved_at": now, "version": 1, "map": {"kassier": ["club"]}}})
    treasurer = await flow.add_user(name="kassierin")
    await flow.db.memberships.insert_one({"user_id": treasurer["id"], "source": "dolibarr", "member_status": "active",
                                          "dolibarr": {"synced_at": now, "functions": [{"code": "kassier", "label": "Kassier", "since": "2026-01-01"}]}})
    seat_only = await flow.add_user(name="posten")
    await flow.db.board_positions.insert_one({"id": new_id(), "slug": "obmann", "title_male": "Obmann", "is_active": True,
                                              "user_id": seat_only["id"], "deputy_user_id": None})
    player = await flow.add_user(name="spieler")
    mod = await flow.add_user(role="moderator", name="mod")

    users = [treasurer, seat_only, player, mod]
    batch = await ban_protected_ids(users, flow.db)
    single = {user["id"] for user in users if await ban_protected(user, flow.db)}
    assert batch == single == {treasurer["id"], mod["id"]}
