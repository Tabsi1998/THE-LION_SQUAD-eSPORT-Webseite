"""Laufende Ligen an Profil und Teamseite (#1630) und die Daten des Liga-Abzeichens (#1638) über die echten Routen.

- Teamseite: Co-Teams mit Abzeichen (Liga N, Beiname), Platz von N, Zone und nächstem Spiel - beste Liga N oben.
- Personenprofil „Aktuelle Ligen“: dieselben Angaben je Co-Team der Person, nach der Regel des Profils (#2516, #2521): Gast und
  angemeldetes Nicht-Mitglied nur Öffentliches, ein Mitglied bei eingeschaltetem Schalter dazu Internes mit ``internal``, bei
  ausgeschaltetem nicht, die Person selbst alles - mit Gegenprobe über eine öffentliche Season.
- Season-Historie: Abzeichen mit Gold nur für den Meister.
- Kein N+1: Profil und Teamseite fragen mit einer und mit vier laufenden Staffeln gleich oft.

Nur erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from test_league_overall_flow import ADMIN, LONG_AGO, add_season, close_staffel, ok, play, setup, staffel, team  # noqa: E402
from test_profile_internal_queries_flow import CountingDb  # noqa: E402

PERSON = "p-1-1"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def extra_squad(flow, tournament: dict, team_index: int, suffix: str, members: list[str]) -> str:
    """Ein zweites Co-Team ``squad-<n><suffix>`` des Teams ``team-<n>``, angemeldet in ``tournament``."""
    squad_id = f"squad-{team_index}{suffix}"
    await flow.db.team_squads.insert_one({"id": squad_id, "team_id": f"team-{team_index}", "name": f"Kader {team_index}{suffix}",
                                          "status": "active", "member_ids": members})
    registration_id = f"{tournament['id']}-reg-{team_index}{suffix}"
    await flow.db.tournament_registrations.insert_one({
        "id": registration_id, "tournament_id": tournament["id"], "team_id": f"team-{team_index}", "squad_id": squad_id,
        "squad_name": f"Kader {team_index}{suffix}", "status": "approved", "registration_type": "team",
        "display_name": f"Probe {team_index} · Kader {team_index}{suffix}", "identity_key": f"{tournament['id']}:squad:{squad_id}"})
    return registration_id


async def play_first_matchday(flow, tournament: dict, order: list[str]) -> None:
    """Nur Spieltag 1 gewertet - wer in ``order`` (Anmeldungen) weiter vorn steht, gewinnt; der Rest steht noch an."""
    from services.matchday_schedule import matchday_number_of

    strength = {rid: at for at, rid in enumerate(order)}
    for match in await flow.db.matches_v2.find({"tournament_id": tournament["id"], "is_preview": {"$ne": True}}, {"_id": 0}).to_list(None):
        sides = [slot["registration_id"] for slot in match.get("slots") or [] if slot.get("registration_id")]
        if len(sides) != 2 or matchday_number_of(match) != 1:
            continue
        winner, loser = sorted(sides, key=lambda side: strength[side])
        await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {
            "status": "completed", "completed_at": LONG_AGO,
            "results": [{"registration_id": winner, "rank": 1, "score": 2}, {"registration_id": loser, "rank": 2, "score": 0}]}})


async def two_levels(flow, visibility: str = "public") -> dict:
    """Season mit Liga 1 „Elite“ und Liga 2: Team 1 spielt mit ``squad-1`` in Liga 2 (Staffel mit 1-4) und mit ``squad-1b`` in Liga 1
    (Staffel mit 5-7). ``p-1-1`` ist in beiden Kadern. Spieltag 1 ist gespielt, Team 1 und ``squad-1b`` haben gewonnen."""
    world = await setup(flow)
    season = await add_season(flow, world, levels=2)
    top, second = world["divisions"][season["id"]]
    flow.act_as(world["admin"])
    ok(await flow.patch(f"{ADMIN}/divisions/{top['id']}", json={"nickname": "Elite"}))
    lower = await staffel(flow, world, season, 2, [1, 2, 3, 4], start=False)
    upper = await staffel(flow, world, season, 1, [5, 6, 7], start=False)
    extra = await extra_squad(flow, upper, 1, "b", [PERSON, "p-1-2"])
    for tournament in (lower, upper):
        ok(await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "live"}))
    await play_first_matchday(flow, lower, [f"{lower['id']}-reg-{n}" for n in (1, 2, 3, 4)])
    await play_first_matchday(flow, upper, [extra] + [f"{upper['id']}-reg-{n}" for n in (5, 6, 7)])
    if visibility != "public":
        ok(await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"visibility": visibility, "readiness_override_reason": "Testaufbau"}))
    return {**world, "season": season, "lower": lower, "upper": upper, "extra": extra}


async def profile(flow, viewer, name: str = PERSON) -> dict:
    flow.act_as(viewer)
    res = await flow.get(f"/api/users/public/{name}")
    assert res.status_code == 200, res.text
    return res.json()


# ---------------------------------------------------------------- Teamseite

@pytest.mark.asyncio
async def test_team_page_lists_co_teams_best_level_first_with_badge_place_zone_and_next_match(flow):
    world = await two_levels(flow)
    flow.act_as(None)
    rows = ok(await flow.get("/api/teams/team-1/overview"))["league"]
    assert [row["badge"] for row in rows] == [{"level": 1, "nickname": "Elite", "champion": False},
                                             {"level": 2, "nickname": None, "champion": False}], "Liga 1 oben, Beiname am Abzeichen"
    upper, lower = rows
    assert upper["registration_id"] == world["extra"] and upper["squad_name"] == "Kader 1b"
    assert (upper["rank"], upper["of"]) == (1, 4), "Platz von N aus der laufenden Tabelle"
    assert upper["zone"] is None, "die oberste Liga N hat keinen Aufstieg"
    assert (lower["rank"], lower["of"], lower["zone"], lower["zone_label"]) == (1, 4, "promotion", "Aufstieg")
    assert lower["next_match"]["matchday"] == 2 and lower["next_match"]["opponent"].startswith("Probe "), lower["next_match"]
    assert lower["next_match"]["link"] == f"/matches/{lower['next_match']['match_id']}"


@pytest.mark.asyncio
async def test_team_page_order_follows_the_level_not_the_name(flow):
    """Gegenprobe zur Sortierung: Steht das Co-Team in Liga 2 alphabetisch vorn, bleibt Liga 1 trotzdem oben."""
    await two_levels(flow)
    await flow.db.leagues.update_many({}, {"$set": {"name": "Zuletzt-Liga"}})
    flow.act_as(None)
    rows = ok(await flow.get("/api/teams/team-1/overview"))["league"]
    assert [row["badge"]["level"] for row in rows] == [1, 2]


@pytest.mark.asyncio
async def test_place_waits_for_the_first_scored_match(flow):
    world = await setup(flow)
    season = await add_season(flow, world)
    await staffel(flow, world, season, 1, [1, 2, 3])
    flow.act_as(None)
    row = ok(await flow.get("/api/teams/team-1/overview"))["league"][0]
    assert (row["rank"], row["of"], row["zone"]) == (None, 3, None), "vor dem ersten Ergebnis stünden alle gleich"
    assert row["next_match"] is not None


@pytest.mark.asyncio
async def test_a_bye_does_not_hide_the_place_once_the_table_has_started(flow):
    """Review #1638: „Noch ohne Platz“ gilt für die ganze Tabelle, nicht je Zeile - wer am ersten Spieltag ein Freilos hat, steht trotzdem
    auf dem Platz der Tabelle, mit Zone."""
    from services.matchday_schedule import matchday_number_of

    world = await setup(flow)
    season = await add_season(flow, world, levels=2)
    tournament = await staffel(flow, world, season, 2, [1, 2, 3])
    first_day = [match for match in await flow.db.matches_v2.find({"tournament_id": tournament["id"], "is_preview": {"$ne": True}}, {"_id": 0}).to_list(None)
                 if matchday_number_of(match) == 1]
    playing = {slot["registration_id"] for match in first_day for slot in match.get("slots") or [] if slot.get("registration_id")}
    rested = next(f"{tournament['id']}-reg-{n}" for n in (1, 2, 3) if f"{tournament['id']}-reg-{n}" not in playing)
    await play_first_matchday(flow, tournament, sorted(playing))
    flow.act_as(None)
    table = {row["registration_id"]: row for row in ok(await flow.get(f"/api/tournaments/{tournament['id']}/standings"))}
    assert int(table[rested]["played"] or 0) == 0, "Gegenprobe: das Team hatte wirklich ein Freilos"
    team = f"team-{rested.rsplit('-', 1)[1]}"
    row = ok(await flow.get(f"/api/teams/{team}/overview"))["league"][0]
    assert row["rank"] == table[rested]["rank"] and row["rank"] is not None, (row, table[rested])
    assert row["zone"] == table[rested].get("zone")


@pytest.mark.asyncio
async def test_waitlist_and_open_registration_say_so_instead_of_no_result(flow):
    world = await two_levels(flow)
    await flow.db.tournament_registrations.update_one({"id": world["extra"]}, {"$set": {"status": "waitlist"}})
    flow.act_as(None)
    rows = {row["registration_id"]: row for row in ok(await flow.get("/api/teams/team-1/overview"))["league"]}
    assert rows[world["extra"]]["status_note"] == "Warteliste"
    assert rows[f"{world['lower']['id']}-reg-1"]["status_note"] is None
    await flow.db.tournament_registrations.update_one({"id": world["extra"]}, {"$set": {"status": "pending"}})
    profile_rows = {row["registration_id"]: row for row in (await profile(flow, None))["league_current"]}
    assert profile_rows[world["extra"]]["status_note"] == "Anmeldung offen"


# ---------------------------------------------------------------- Personenprofil

@pytest.mark.asyncio
async def test_profile_shows_current_leagues_of_the_person(flow):
    world = await two_levels(flow)
    body = await profile(flow, None)
    rows = body["league_current"]
    assert [(row["badge"]["level"], row["squad_name"], row["staffel"]) for row in rows] == [(1, "Kader 1b", "A"), (2, "Kader 1", "A")]
    first = rows[0]
    assert first["division_label"] == "Liga 1 · Elite" and first["league"]["name"] == "Probe-Liga"
    assert (first["rank"], first["of"]) == (1, 4) and first["internal"] is False
    assert first["link"].startswith(f"/liga/{world['league']['slug']}/{world['season']['slug']}#staffel-")
    assert first["next_match"]["matchday"] == 2
    # Gegenprobe: Wer in keinem Kader steht, hat keine aktuellen Ligen - auch nicht über das Hauptteam, wenn ein Co-Team spielt.
    assert (await profile(flow, None, "captain-1"))["league_current"] == []
    # Nach dem Abschluss ist die Staffel keine aktuelle Liga mehr.
    await play(flow, world["lower"], [1, 2, 3, 4])
    await close_staffel(flow, world, world["lower"])
    assert [row["badge"]["level"] for row in (await profile(flow, None))["league_current"]] == [1]


@pytest.mark.asyncio
async def test_profile_current_leagues_follow_the_visibility_matrix(flow):
    from services import profile_visibility

    await two_levels(flow, visibility="members")
    owner = await flow.db.users.find_one({"id": PERSON}, {"_id": 0})
    outsider = await flow.add_user(role="player", name="sturmvogel")
    member = await flow.add_user(role="player", name="nachtfalke")
    await flow.db.memberships.insert_one({"id": "m-1", "user_id": member["id"], "member_status": "active"})

    assert (await profile(flow, None))["league_current"] == [], "Gast: nur Öffentliches"
    assert (await profile(flow, outsider))["league_current"] == [], "angemeldet, aber kein Mitglied: nur Öffentliches"
    seen = (await profile(flow, member))["league_current"]
    assert [row["internal"] for row in seen] == [True, True], "Mitglied mit Schalter an: Internes mit Etikett"
    own = (await profile(flow, owner))["league_current"]
    assert [row["internal"] for row in own] == [True, True], "die Person selbst sieht alles"
    await flow.db.users.update_one({"id": PERSON}, {"$set": {profile_visibility.SETTING: False}})
    assert (await profile(flow, member))["league_current"] == [], "Mitglied mit Schalter aus: nur Öffentliches"
    owner = await flow.db.users.find_one({"id": PERSON}, {"_id": 0})
    assert len((await profile(flow, owner))["league_current"]) == 2, "der Schalter gilt nicht für die Person selbst"


@pytest.mark.asyncio
async def test_public_season_is_not_internal_for_anyone(flow):
    """Gegenprobe zur Matrix: Eine öffentliche Season sehen alle, ohne Etikett."""
    await two_levels(flow)
    member = await flow.add_user(role="player", name="nachtfalke")
    await flow.db.memberships.insert_one({"id": "m-1", "user_id": member["id"], "member_status": "active"})
    for viewer in (None, member):
        assert [row["internal"] for row in (await profile(flow, viewer))["league_current"]] == [False, False]


# ---------------------------------------------------------------- Season-Historie

@pytest.mark.asyncio
async def test_history_badge_is_gold_only_for_the_champion(flow):
    world = await setup(flow)
    season = await add_season(flow, world)
    flow.act_as(world["admin"])
    ok(await flow.patch(f"{ADMIN}/divisions/{world['divisions'][season['id']][0]['id']}", json={"nickname": "Elite"}))
    tournament = await staffel(flow, world, season, 1, [1, 2, 3])
    await play(flow, tournament, [1, 2, 3])
    await close_staffel(flow, world, tournament)
    flow.act_as(None)
    rows = {row["display_name"]: row["badge"] for row in ok(await flow.get("/api/teams/team-1"))["league_history"]}
    assert rows == {"Probe 1": {"level": 1, "nickname": "Elite", "champion": True}}
    second = ok(await flow.get("/api/teams/team-2"))["league_history"][0]["badge"]
    assert second == {"level": 1, "nickname": "Elite", "champion": False}, "Platz 2 bleibt Cyan"
    assert (await profile(flow, None, "p-1-1"))["league_history"][0]["badge"]["champion"] is True


# ---------------------------------------------------------------- Kein N+1

async def reads(count: int) -> dict:
    """``count`` laufende Staffeln, in jeder ein eigenes Co-Team von Team 1 mit ``p-1-1`` im Kader; gemessen werden Profil (Mitglied
    und Person selbst) und Teamseite (Gast)."""
    import database

    flow, shutdown = make_flow()
    try:
        world = await setup(flow)
        season = await add_season(flow, world)
        await team(flow, 1)
        for index in range(count):
            tournament = await staffel(flow, world, season, 1, [10 * index + 2, 10 * index + 3, 10 * index + 4], start=False)
            extra = await extra_squad(flow, tournament, 1, f"x{index}", [PERSON])
            ok(await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "live"}))
            await play_first_matchday(flow, tournament, [extra] + [f"{tournament['id']}-reg-{10 * index + n}" for n in (2, 3, 4)])
        member = await flow.add_user(role="player", name="nachtfalke")
        await flow.db.memberships.insert_one({"id": "m-1", "user_id": member["id"], "member_status": "active"})
        owner = await flow.db.users.find_one({"id": PERSON}, {"_id": 0})
        out = {}
        for label, viewer, url, field in (("mitglied", member, f"/api/users/public/{PERSON}", "league_current"),
                                          ("selbst", owner, f"/api/users/public/{PERSON}", "league_current"),
                                          ("team", None, "/api/teams/team-1/overview", "league")):
            calls = {"reads": 0}
            plain = database._db
            database._db = CountingDb(plain, calls)
            try:
                flow.act_as(viewer)
                res = await flow.get(url)
            finally:
                database._db = plain
            assert res.status_code == 200, res.text
            rows = res.json()[field]
            assert len(rows) == count, (label, rows)
            assert all(row["rank"] == 1 and row["next_match"] for row in rows), (label, rows)
            out[label] = calls["reads"]
        return out
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_reads_do_not_grow_with_the_running_leagues():
    small, large = await reads(1), await reads(4)
    assert small == large, f"Abfragen mit 1 bzw. 4 laufenden Staffeln: {small} / {large}"


# ---------------------------------------------------------------- Datenschutz und Zugehörigkeit (Review #1638)

async def viewers(flow) -> dict:
    owner = await flow.db.users.find_one({"id": PERSON}, {"_id": 0})
    outsider = await flow.add_user(role="player", name="sturmvogel")
    member = await flow.add_user(role="player", name="nachtfalke")
    await flow.db.memberships.insert_one({"id": "m-1", "user_id": member["id"], "member_status": "active"})
    return {"gast": None, "nicht-mitglied": outsider, "mitglied": member, "selbst": owner}


@pytest.mark.asyncio
async def test_private_team_shows_current_leagues_only_to_the_person(flow):
    await two_levels(flow)
    people = await viewers(flow)
    for label, viewer in people.items():
        assert len((await profile(flow, viewer))["league_current"]) == 2, ("Gegenprobe: öffentliches Team", label)
    await flow.db.teams.update_one({"id": "team-1"}, {"$set": {"is_public": False}})
    seen = {label: (await profile(flow, viewer))["league_current"] for label, viewer in people.items()}
    assert seen["gast"] == [] and seen["nicht-mitglied"] == [] and seen["mitglied"] == [], seen
    assert len(seen["selbst"]) == 2, "die Person selbst sieht ihre Ligen"


@pytest.mark.asyncio
async def test_private_team_shows_the_season_history_only_to_the_person(flow):
    world = await setup(flow)
    season = await add_season(flow, world)
    tournament = await staffel(flow, world, season, 1, [1, 2, 3])
    await play(flow, tournament, [1, 2, 3])
    await close_staffel(flow, world, tournament)
    people = await viewers(flow)
    for label, viewer in people.items():
        assert len((await profile(flow, viewer))["league_history"]) == 1, ("Gegenprobe: öffentliches Team", label)
    await flow.db.teams.update_one({"id": "team-1"}, {"$set": {"is_public": False}})
    seen = {label: (await profile(flow, viewer))["league_history"] for label, viewer in people.items()}
    assert seen["gast"] == [] and seen["nicht-mitglied"] == [] and seen["mitglied"] == [], seen
    assert len(seen["selbst"]) == 1
    # Ein anderes, öffentliches Team derselben Staffel bleibt sichtbar.
    assert len((await profile(flow, None, "p-2-1"))["league_history"]) == 1


@pytest.mark.asyncio
async def test_registering_a_co_team_alone_does_not_make_it_the_persons_league(flow):
    """Wer ein Co-Team nur angemeldet hat (``user_id`` der Anmeldung), ohne im Kader zu stehen, hat dort keine aktuelle Liga - als Captain
    bzw. Vertreter des Co-Teams schon."""
    world = await two_levels(flow)
    await flow.db.tournament_registrations.update_many({"team_id": "team-1"}, {"$set": {"user_id": "captain-1"}})
    assert (await profile(flow, None, "captain-1"))["league_current"] == []
    await flow.db.team_squads.update_one({"id": "squad-1b"}, {"$set": {"captain_id": "captain-1"}})
    rows = (await profile(flow, None, "captain-1"))["league_current"]
    assert [row["registration_id"] for row in rows] == [world["extra"]]
    await flow.db.team_squads.update_one({"id": "squad-1b"}, {"$set": {"captain_id": None, "vice_captain_id": "captain-1"}})
    assert len((await profile(flow, None, "captain-1"))["league_current"]) == 1
