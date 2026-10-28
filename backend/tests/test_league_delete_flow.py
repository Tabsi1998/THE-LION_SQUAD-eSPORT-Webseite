"""Liga korrigieren, archivieren, löschen (#2106) und die Antwortfrist als Season-Wert (F3).

- Liga bearbeiten: Name, Beschreibung, Stand; das Spiel nur ohne Staffel, die Adresse nur vor der ersten
  Veröffentlichung.
- Liga, Season und Liga N löschen nur, solange darunter keine Staffel Co-Teams, Spiele oder Ergebnisse hat - leere
  Entwurfs-Staffeln gehen mit, die Season muss ein Entwurf sein. Sonst 409 „Archivieren statt löschen“. Immer mit
  Grund im Protokoll.
- Staffel löschen auf der Season-Seite mit derselben Sperre wie in der Turnierverwaltung (#2109).
Nur erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import league_service  # noqa: E402
from services.staffel_guard import STAFFEL_DELETE_REFUSED  # noqa: E402
from test_league_admin_flow import ADMIN, setup_league  # noqa: E402

REASON = {"reason": "Falsch angelegt beim Probelauf"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _staffel(flow, division) -> dict:
    created = await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})
    assert created.status_code == 200, created.text
    return await flow.db.tournaments.find_one({"id": created.json()["tournament_id"]}, {"_id": 0})


async def _delete(flow, url, body=None):
    return await flow.client.request("DELETE", url, json=REASON if body is None else body)


async def _audit(flow, action) -> list[dict]:
    return await flow.db.audit_logs.find({"action": action}, {"_id": 0}).to_list(None)


async def _assign_co_team(flow, staffel) -> None:
    """Ein zugeteiltes Co-Team - für die Sperre reicht die Anmeldung selbst."""
    await flow.db.tournament_registrations.insert_one({
        "id": "reg-probe", "tournament_id": staffel["id"], "status": "approved", "squad_id": "squad-probe",
        "display_name": "Probewölfe · Rudel"})


# ---------------------------------------------------------------- Liga bearbeiten

@pytest.mark.asyncio
async def test_a_league_can_be_corrected_and_its_address_stays_once_a_season_was_visible(flow):
    _admin, _game, league, season, _division, _maps = await setup_league(flow)
    url = f"{ADMIN}/{league['id']}"

    edited = await flow.patch(url, json={"name": "Probe-Liga Nord", "description": "Nur zum Testen",
                                         "slug": "probe-nord"})
    assert edited.status_code == 200, edited.text
    body = edited.json()
    assert (body["name"], body["description"], body["slug"]) == ("Probe-Liga Nord", "Nur zum Testen", "probe-nord")
    assert body["changed"] == ["description", "name", "slug"]
    assert body["slug_locked"] is False and body["game_locked"] is False

    archived = (await flow.patch(url, json={"status": "archived"})).json()
    assert archived["status"] == "archived"
    assert (await flow.patch(url, json={"status": "active"})).json()["status"] == "active"

    # Einmal sichtbar, bleibt die Adresse - auch wenn die Season danach wieder „aus“ ist.
    assert (await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"visibility": "admins"})).status_code == 200
    assert (await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"visibility": "off"})).status_code == 200
    refused = await flow.patch(url, json={"slug": "probe-sued"})
    assert refused.status_code == 409
    assert refused.json()["detail"] == league_service.SLUG_LOCKED
    assert (await flow.patch(url, json={"slug": "probe-nord", "name": "Probe-Liga"})).status_code == 200
    listing = (await flow.get(ADMIN)).json()["leagues"][0]
    assert (listing["slug"], listing["slug_locked"]) == ("probe-nord", True)

    actions = [row["data"]["fields"] for row in await _audit(flow, "league.update")]
    assert actions == [["description", "name", "slug"], ["status"], ["status"], ["name"]]


@pytest.mark.asyncio
async def test_the_game_changes_only_while_no_season_has_a_staffel(flow):
    _admin, game, league, season, division, _maps = await setup_league(flow)
    other = (await flow.post("/api/games", json={"name": "Probe Rennen", "slug": "probe-rennen"})).json()
    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"best_of": 1, "game_mode_order": ["stellung"]})

    changed = await flow.patch(f"{ADMIN}/{league['id']}", json={"game_id": other["id"]})
    assert changed.status_code == 200, changed.text
    assert changed.json()["game_id"] == other["id"]
    stored = await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})
    assert stored["game_mode_order"] == []  # die Modi gehörten zum alten Spiel

    await flow.patch(f"{ADMIN}/{league['id']}", json={"game_id": game["id"]})
    await _staffel(flow, division)
    refused = await flow.patch(f"{ADMIN}/{league['id']}", json={"game_id": other["id"]})
    assert refused.status_code == 409
    assert refused.json()["detail"] == league_service.GAME_LOCKED
    assert (await flow.get(ADMIN)).json()["leagues"][0]["game_locked"] is True


# ---------------------------------------------------------------- Löschen mit leeren Entwürfen

@pytest.mark.asyncio
async def test_deleting_a_division_takes_its_empty_draft_staffel_and_logs_the_reason(flow):
    _admin, _game, league, season, division, _maps = await setup_league(flow)
    staffel = await _staffel(flow, division)
    assert await flow.db.map_pools.count_documents({"scope": "tournament", "scope_id": staffel["id"]}) == 1

    plan = (await flow.get(f"{ADMIN}/divisions/{division['id']}/delete-plan")).json()
    assert plan["deletable"] is True and plan["blockers"] == []
    assert plan["name"] == "Liga 1"
    assert [row["staffel"] for row in plan["staffeln"]] == ["A"]

    missing = await _delete(flow, f"{ADMIN}/divisions/{division['id']}", {"reason": "weg"})
    assert missing.status_code == 422
    assert missing.json()["detail"] == league_service.DELETE_REASON_MISSING
    assert await flow.db.league_divisions.count_documents({"id": division["id"]}) == 1

    deleted = await _delete(flow, f"{ADMIN}/divisions/{division['id']}")
    assert deleted.status_code == 200, deleted.text
    assert await flow.db.league_divisions.count_documents({"id": division["id"]}) == 0
    assert await flow.db.tournaments.count_documents({"id": staffel["id"]}) == 0
    assert await flow.db.tournament_stages.count_documents({"tournament_id": staffel["id"]}) == 0
    assert await flow.db.matches_v2.count_documents({"tournament_id": staffel["id"]}) == 0
    assert await flow.db.map_pools.count_documents({"scope": "tournament", "scope_id": staffel["id"]}) == 0
    # Season und Liga bleiben.
    assert await flow.db.league_seasons.count_documents({"id": season["id"]}) == 1
    assert await flow.db.leagues.count_documents({"id": league["id"]}) == 1

    [entry] = await _audit(flow, "league.division.delete")
    assert entry["target_id"] == division["id"]
    assert entry["data"]["reason"] == REASON["reason"]
    assert entry["data"]["staffeln"] == [staffel["id"]]
    assert entry["data"]["league_id"] == league["id"]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["co_team", "started", "fixed_schedule"])
async def test_a_staffel_with_co_teams_or_games_blocks_deleting_archive_instead(flow, kind):
    _admin, _game, league, season, division, _maps = await setup_league(flow)
    staffel = await _staffel(flow, division)
    if kind == "co_team":
        await _assign_co_team(flow, staffel)
        reason = "hat schon Co-Teams zugeteilt"
    elif kind == "started":
        await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"status": "live"}})
        reason = "hat schon begonnen oder Spiele"
    else:
        await flow.db.matches_v2.insert_one({"id": "match-probe", "tournament_id": staffel["id"], "status": "pending"})
        reason = "hat schon begonnen oder Spiele"

    for url in (f"{ADMIN}/divisions/{division['id']}", f"{ADMIN}/seasons/{season['id']}", f"{ADMIN}/{league['id']}"):
        plan = (await flow.get(f"{url}/delete-plan")).json()
        assert plan["deletable"] is False, url
        assert plan["blockers"] == [f"{staffel['title']} {reason}"], url
        refused = await _delete(flow, url)
        assert refused.status_code == 409, url
        expected = (f"Löschen geht nicht: {staffel['title']} {reason}. "
                    "Archivieren statt löschen – dann bleibt alles erhalten.")
        assert refused.json()["detail"] == expected
    assert await flow.db.tournaments.count_documents({"id": staffel["id"]}) == 1
    assert await flow.db.league_divisions.count_documents({"id": division["id"]}) == 1
    assert await _audit(flow, "league.division.delete") == []

    # Archivieren statt löschen: Liga N über den Stand - die API kannte ihn, die Oberfläche schickt ihn jetzt.
    archived = await flow.patch(f"{ADMIN}/divisions/{division['id']}", json={"status": "archived"})
    assert archived.status_code == 200 and archived.json()["status"] == "archived"
    assert (await flow.get(f"{url}/delete-plan")).json()["archived"] is False  # die Liga selbst ist noch aktiv
    assert (await flow.get(f"{ADMIN}/divisions/{division['id']}/delete-plan")).json()["archived"] is True


@pytest.mark.asyncio
async def test_a_season_is_deleted_only_as_a_draft(flow):
    _admin, _game, league, season, division, _maps = await setup_league(flow)
    staffel = await _staffel(flow, division)
    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"status": "active"})

    plan = (await flow.get(f"{ADMIN}/seasons/{season['id']}/delete-plan")).json()
    assert plan["blockers"] == ["Season 1 ist kein Entwurf mehr (läuft)"]
    assert (await _delete(flow, f"{ADMIN}/seasons/{season['id']}")).status_code == 409

    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"status": "draft"})
    plan = (await flow.get(f"{ADMIN}/seasons/{season['id']}/delete-plan")).json()
    assert plan["deletable"] is True
    assert [row["label"] for row in plan["divisions"]] == ["Liga 1"]
    # Liga-Kader (#2108): die festgehaltene Spiel-ID gehört zur Season.
    await flow.db.league_rosters.insert_one({"id": "roster-probe", "season_id": season["id"], "user_id": "u-probe"})
    deleted = await _delete(flow, f"{ADMIN}/seasons/{season['id']}")
    assert deleted.status_code == 200, deleted.text
    assert await flow.db.league_rosters.count_documents({"season_id": season["id"]}) == 0
    assert await flow.db.league_seasons.count_documents({"id": season["id"]}) == 0
    assert await flow.db.league_divisions.count_documents({"season_id": season["id"]}) == 0
    assert await flow.db.tournaments.count_documents({"id": staffel["id"]}) == 0
    assert await flow.db.map_pools.count_documents({"scope": "league_season", "scope_id": season["id"]}) == 0
    assert await flow.db.leagues.count_documents({"id": league["id"]}) == 1
    [entry] = await _audit(flow, "league.season.delete")
    assert (entry["data"]["divisions"], entry["data"]["staffeln"]) == ([division["id"]], [staffel["id"]])


@pytest.mark.asyncio
async def test_a_wrong_league_is_deleted_with_everything_below_it(flow):
    _admin, _game, league, season, division, _maps = await setup_league(flow)
    staffel = await _staffel(flow, division)
    second = (await flow.post(f"{ADMIN}/{league['id']}/seasons", json={"start_date": "2027-03-02T00:00:00"})).json()

    plan = (await flow.get(f"{ADMIN}/{league['id']}/delete-plan")).json()
    assert [row["name"] for row in plan["seasons"]] == ["Season 1", "Season 2"]
    assert [row["label"] for row in plan["divisions"]] == ["Season 1 · Liga 1"]
    assert [row["tournament_id"] for row in plan["staffeln"]] == [staffel["id"]]

    deleted = await _delete(flow, f"{ADMIN}/{league['id']}")
    assert deleted.status_code == 200, deleted.text
    assert await flow.db.leagues.count_documents({}) == 0
    assert await flow.db.league_seasons.count_documents({"id": {"$in": [season["id"], second["id"]]}}) == 0
    assert await flow.db.league_divisions.count_documents({}) == 0
    assert await flow.db.tournaments.count_documents({"league_context": {"$exists": True}}) == 0
    assert (await flow.get(ADMIN)).json()["leagues"] == []
    [entry] = await _audit(flow, "league.delete")
    assert entry["data"]["seasons"] == [season["id"], second["id"]]
    assert entry["data"]["reason"] == REASON["reason"]


# ---------------------------------------------------------------- Staffel auf der Season-Seite löschen

@pytest.mark.asyncio
async def test_a_staffel_is_deleted_on_the_season_page_with_the_same_guard_as_the_tournament_admin(flow):
    _admin, _game, _league, season, division, _maps = await setup_league(flow)
    staffel = await _staffel(flow, division)
    started = await _staffel(flow, division)
    await flow.db.tournaments.update_one({"id": started["id"]}, {"$set": {"status": "live"}})

    refused = await _delete(flow, f"{ADMIN}/staffeln/{started['id']}")
    assert refused.status_code == 409
    assert refused.json()["detail"] == STAFFEL_DELETE_REFUSED
    no_reason = await _delete(flow, f"{ADMIN}/staffeln/{staffel['id']}", {})
    assert no_reason.status_code == 422

    # Vor dem Start darf sie gehen - auch mit zugeteiltem Co-Team, wie in der Turnierverwaltung.
    await _assign_co_team(flow, staffel)
    deleted = await _delete(flow, f"{ADMIN}/staffeln/{staffel['id']}")
    assert deleted.status_code == 200, deleted.text
    assert await flow.db.tournaments.count_documents({"id": staffel["id"]}) == 0
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": staffel["id"]}) == 0
    view = (await flow.get(f"{ADMIN}/seasons/{season['id']}")).json()
    assert [row["staffel"] for row in view["divisions"][0]["staffeln"]] == ["B"]
    [entry] = await _audit(flow, "league.staffel.delete")
    assert (entry["target_id"], entry["data"]["staffel"], entry["data"]["reason"]) == (staffel["id"], "A",
                                                                                       REASON["reason"])

    # Ein gewöhnliches Turnier ist keine Staffel.
    plain = await flow.create_tournament()
    assert (await _delete(flow, f"{ADMIN}/staffeln/{plain['id']}")).status_code == 404


@pytest.mark.asyncio
async def test_only_the_tournament_staff_may_delete(flow):
    _admin, _game, league, season, division, _maps = await setup_league(flow)
    staffel = await _staffel(flow, division)
    flow.act_as(await flow.add_user())
    for url in (f"{ADMIN}/{league['id']}", f"{ADMIN}/seasons/{season['id']}", f"{ADMIN}/divisions/{division['id']}"):
        assert (await flow.get(f"{url}/delete-plan")).status_code == 403, url
        assert (await _delete(flow, url)).status_code == 403, url
    assert (await _delete(flow, f"{ADMIN}/staffeln/{staffel['id']}")).status_code == 403
    assert await flow.db.leagues.count_documents({"id": league["id"]}) == 1


# ---------------------------------------------------------------- Antwortfrist als Season-Wert (F3)

@pytest.mark.asyncio
async def test_the_response_time_comes_from_the_season_and_liga_n_may_override_it(flow):
    _admin, _game, _league, season, division, _maps = await setup_league(flow)
    assert season["match_schedule_response_hours"] == 72
    staffel = await _staffel(flow, division)
    assert staffel["match_schedule_response_hours"] == 72

    changed = (await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"match_schedule_response_hours": 24})).json()
    assert changed["changed"] == ["match_schedule_response_hours"] and changed["staffeln_to_sync"] == 1
    # Auch nach dem Start und nach dem ersten Ergebnis: die Frist gilt nur für neue Vorschläge.
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"status": "live"}})
    [row] = (await flow.post(f"{ADMIN}/seasons/{season['id']}/sync")).json()["staffeln"]
    assert "running" in row["applied"] and "match_schedule_response_hours" in row["changed"]
    stored = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0})
    assert stored["match_schedule_response_hours"] == 24

    # Liga N weicht ab.
    second = (await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions",
                              json={"overrides": {"match_schedule_response_hours": 12}})).json()
    assert second["overrides"] == {"match_schedule_response_hours": 12}
    other = await _staffel(flow, second)
    assert other["match_schedule_response_hours"] == 12

    # Eine gesperrte Staffel behält ihre Frist.
    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"match_schedule_response_hours": 48})
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"locked_at": "2026-12-01T10:00:00+00:00"}})
    rows = (await flow.post(f"{ADMIN}/seasons/{season['id']}/sync")).json()["staffeln"]
    locked = next(row for row in rows if row["tournament_id"] == staffel["id"])
    assert {"group": "running", "label": "Antwortfrist auf Terminvorschläge",
            "reason": league_service.LOCKED_REASON} in locked["skipped"]
    assert (await flow.db.tournaments.find_one({"id": staffel["id"]}))["match_schedule_response_hours"] == 24


@pytest.mark.asyncio
async def test_an_older_season_without_a_response_time_leaves_the_staffel_value_alone(flow):
    _admin, _game, _league, season, division, _maps = await setup_league(flow)
    staffel = await _staffel(flow, division)
    # Stand vor #2106: die Season kennt die Frist nicht, die Staffel hat ihre eigene.
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$unset": {"match_schedule_response_hours": ""}})
    await flow.db.tournaments.update_one({"id": staffel["id"]}, {"$set": {"match_schedule_response_hours": 36}})

    # Leer gespeichert bleibt sie leer.
    saved = (await flow.patch(f"{ADMIN}/seasons/{season['id']}",
                              json={"match_schedule_response_hours": None, "rules_text": "Neu"})).json()
    assert "match_schedule_response_hours" not in saved
    rows = (await flow.post(f"{ADMIN}/seasons/{season['id']}/sync")).json()["staffeln"]
    assert "running" not in rows[0]["applied"]
    stored = await flow.db.tournaments.find_one({"id": staffel["id"]}, {"_id": 0})
    assert (stored["match_schedule_response_hours"], stored["rules"]) == (36, "Neu")


# ---------------------------------------------------------------- Review #2106: alles oder nichts

@pytest.mark.asyncio
async def test_a_busy_staffel_stops_the_whole_deletion_before_anything_is_gone(flow):
    from services.mutation_lock import mutation_lock, tournament_write_resource

    await flow.db.mutation_locks.create_index("resource", unique=True)
    _admin, _game, _league, _season, division, _maps = await setup_league(flow)
    first = await _staffel(flow, division)
    second = await _staffel(flow, division)
    async with mutation_lock(flow.db, tournament_write_resource(second["id"])):
        refused = await _delete(flow, f"{ADMIN}/divisions/{division['id']}")
    assert refused.status_code == 409
    assert refused.json()["detail"] == league_service.STAFFEL_BUSY
    assert await flow.db.tournaments.count_documents({"id": {"$in": [first["id"], second["id"]]}}) == 2
    assert await flow.db.league_divisions.count_documents({"id": division["id"]}) == 1
    assert await flow.db.audit_logs.count_documents({"action": {"$regex": r"\.delete$"}}) == 0


@pytest.mark.asyncio
async def test_each_deleted_staffel_is_logged_on_its_own(flow):
    _admin, _game, league, season, division, _maps = await setup_league(flow)
    first = await _staffel(flow, division)
    second = await _staffel(flow, division)
    assert (await _delete(flow, f"{ADMIN}/seasons/{season['id']}")).status_code == 200
    rows = await _audit(flow, "league.staffel.delete")
    assert sorted(row["target_id"] for row in rows) == sorted([first["id"], second["id"]])
    assert {(row["data"]["with"], row["data"]["with_id"], row["data"]["reason"]) for row in rows} == {
        ("league.season.delete", season["id"], REASON["reason"])}


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["division", "season", "league"])
async def test_something_added_meanwhile_stops_before_the_parents_go(flow, monkeypatch, kind):
    _admin, _game, league, season, division, _maps = await setup_league(flow)
    staffel = await _staffel(flow, division)
    real_purge = league_service._purge_staffel

    async def purge_while_someone_adds(db, tournament_id):
        await real_purge(db, tournament_id)
        # Gleichzeitig legt jemand etwas an - eine Staffel, eine Liga N oder eine Season.
        if kind == "division":
            await db.tournaments.insert_one({"id": "neu", "title": "Neu", "league_context": {
                "league_id": league["id"], "season_id": season["id"], "division_id": division["id"], "staffel": "B"}})
        elif kind == "season":
            await db.league_divisions.insert_one({"id": "neu", "league_id": league["id"], "season_id": season["id"],
                                                  "level": 2})
        else:
            await db.league_seasons.insert_one({"id": "neu", "league_id": league["id"], "number": 2,
                                                "name": "Season 2", "status": "draft"})

    monkeypatch.setattr(league_service, "_purge_staffel", purge_while_someone_adds)
    url = {"division": f"{ADMIN}/divisions/{division['id']}", "season": f"{ADMIN}/seasons/{season['id']}",
           "league": f"{ADMIN}/{league['id']}"}[kind]
    refused = await _delete(flow, url)
    assert refused.status_code == 409
    assert refused.json()["detail"] == league_service.CHANGED_MEANWHILE
    # Die leere Staffel ist weg und protokolliert, alles darüber bleibt.
    assert await flow.db.tournaments.count_documents({"id": staffel["id"]}) == 0
    assert [row["target_id"] for row in await _audit(flow, "league.staffel.delete")] == [staffel["id"]]
    assert await flow.db.league_divisions.count_documents({"id": division["id"]}) == 1
    assert await flow.db.league_seasons.count_documents({"id": season["id"]}) == 1
    assert await flow.db.leagues.count_documents({"id": league["id"]}) == 1
    parent_action = "league.delete" if kind == "league" else f"league.{kind}.delete"
    assert await flow.db.audit_logs.count_documents({"action": parent_action}) == 0


@pytest.mark.asyncio
async def test_older_leagues_get_published_at_by_migration(flow):
    from services import migrations

    await flow.db.leagues.insert_many([{"id": "shown", "slug": "a"}, {"id": "ran", "slug": "b"},
                                       {"id": "draft", "slug": "c"}, {"id": "known", "slug": "d", "published_at": "x"}])
    await flow.db.league_seasons.insert_many([
        {"id": "s1", "league_id": "shown", "visibility": "public", "status": "draft"},
        {"id": "s2", "league_id": "ran", "visibility": "off", "status": "completed"},
        {"id": "s3", "league_id": "draft", "visibility": "off", "status": "draft"},
        {"id": "s4", "league_id": "known", "visibility": "public", "status": "active"}])
    entry = next(run for version, name, run in migrations.MIGRATIONS if name == "league_published_at")
    assert await entry(flow.db) == "2 leagues marked as published"
    stored = {row["id"]: row.get("published_at") for row in await flow.db.leagues.find({}, {"_id": 0}).to_list(None)}
    assert stored["shown"] and stored["ran"] and stored["draft"] is None and stored["known"] == "x"
    assert await league_service.slug_locked(flow.db, {"id": "ran", "published_at": stored["ran"]})


def test_an_older_season_does_not_pretend_the_default_response_time():
    assert league_service.effective_settings({"best_of": 3}, None)["match_schedule_response_hours"] is None
    assert league_service.effective_settings({"match_schedule_response_hours": 48}, None)[
        "match_schedule_response_hours"] == 48
    assert league_service.effective_settings({}, {"overrides": {"match_schedule_response_hours": 12}})[
        "match_schedule_response_hours"] == 12
