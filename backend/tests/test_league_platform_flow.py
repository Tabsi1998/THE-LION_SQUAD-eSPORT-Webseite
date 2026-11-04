"""Plattform je Season (docs/LIGA.md, B.3 „Plattform je Season“, #2270): erlaubte Plattformen, Crossplay und Eingabegerät, Liga N
weicht ab. Erlaubt, nicht erlaubt, fehlend, Liga N, Anmeldung mit Mindestkader, Zuteilen, Teilnehmerliste und Altbestand. Erfundene
Namen; die Plattformen sind Auswahlwerte am Spiel, kein Titel steht im Code."""
import json
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_application_world import application_world, base_url, submit  # noqa: E402
from league_rules_world import ADMIN_LEAGUES  # noqa: E402
from league_start_world import ok  # noqa: E402
from services import league_eligibility, league_platform  # noqa: E402
from test_league_roster_flow import MAIN_SLUG, id_world  # noqa: E402

PLATFORM = {"key": "platform", "label": "Plattform", "options": ["PC", "PlayStation", "Xbox"]}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def platform_world(flow, *, required: bool = False, **season) -> dict:
    """Die Kader-Welt (Rudel A: Kapitaen, Mila, Tom) mit einem Plattform-Feld am Hauptspiel. Alle spielen auf PC, außer es wird geändert."""
    w = await id_world(flow)
    await flow.db.games.update_one({"id": "probe-main"}, {"$push": {"player_id_fields": {**PLATFORM, "required": required}}})
    await flow.db.leagues.update_one({"id": "liga"}, {"$set": {"status": "active"}})
    for user in w["users"].values():
        await flow.db.users.update_one({"id": user["id"]}, {"$set": {f"game_ids.{MAIN_SLUG}.platform": "PC"}})
    if season:
        await flow.db.league_seasons.update_one({"id": w["season_id"]}, {"$set": season})
    return w


async def plays_on(flow, w: dict, name: str, value: str | None) -> None:
    change = {"$set": {f"game_ids.{MAIN_SLUG}.platform": value}} if value else {"$unset": {f"game_ids.{MAIN_SLUG}.platform": ""}}
    await flow.db.users.update_one({"id": w["users"][name]["id"]}, change)


async def division(flow, w: dict, **overrides) -> None:
    await flow.db.league_divisions.update_one(
        {"id": "liga-1"},
        {"$set": {"id": "liga-1", "season_id": w["season_id"], "league_id": "liga", "level": 1, "status": "active", "overrides": overrides}},
        upsert=True)


async def state_of(flow, w: dict, name: str) -> dict:
    tournament = await flow.db.tournaments.find_one({"id": w["tournament"]["id"]}, {"_id": 0})
    user_id = w["users"][name]["id"]
    ctx = await league_eligibility.context_for_tournament(flow.db, tournament, [user_id])
    return league_eligibility.status(ctx, user_id, w["squad_a"]["id"])


def settings_url(w: dict) -> str:
    return f"{ADMIN_LEAGUES}/seasons/{w['season_id']}/platform"


def season_url(w: dict) -> str:
    return f"{ADMIN_LEAGUES}/seasons/{w['season_id']}"


# ---------------------------------------------------------------- Altbestand


@pytest.mark.asyncio
async def test_a_season_without_the_fields_checks_nothing_new(flow):
    w = await platform_world(flow)
    await plays_on(flow, w, "Mila", "PlayStation")
    await plays_on(flow, w, "Tom", None)
    await division(flow, w, best_of=5)

    for name in ("Kapitaen", "Mila", "Tom"):
        row = await state_of(flow, w, name)
        assert (row["state"], row["ok"]) == ("pending", True), (name, row)
    flow.act_as(None)
    assert ok(await flow.get("/api/leagues/testliga/season-1"))["platform"] is None


@pytest.mark.asyncio
async def test_nothing_ticked_means_every_platform(flow):
    w = await platform_world(flow, platform_field="platform", allowed_platforms=[], crossplay=True)
    await plays_on(flow, w, "Mila", "PlayStation")
    await plays_on(flow, w, "Tom", None)

    assert (await state_of(flow, w, "Mila"))["ok"] is True
    assert (await state_of(flow, w, "Tom"))["ok"] is True


# ---------------------------------------------------------------- Erlaubt, nicht erlaubt, fehlend


@pytest.mark.asyncio
async def test_only_pc_lets_pc_play_and_names_the_other_platform(flow):
    w = await platform_world(flow, platform_field="platform", allowed_platforms=["PC"])
    await plays_on(flow, w, "Mila", "PlayStation")

    pc = await state_of(flow, w, "Kapitaen")
    other = await state_of(flow, w, "Mila")

    assert (pc["state"], pc["ok"]) == ("pending", True)
    assert (other["state"], other["ok"]) == ("platform_not_allowed", False)
    assert other["reason"] == "Diese Season ist nur für PC – angegeben ist PlayStation."
    assert other["id_ok"] is True, "die Spiel-ID selbst passt"


@pytest.mark.asyncio
async def test_two_allowed_platforms_read_naturally(flow):
    w = await platform_world(flow, platform_field="platform", allowed_platforms=["PC", "Xbox"])
    await plays_on(flow, w, "Mila", "PlayStation")
    await plays_on(flow, w, "Tom", "Xbox")

    assert (await state_of(flow, w, "Mila"))["reason"] == "Diese Season ist nur für PC und Xbox – angegeben ist PlayStation."
    assert (await state_of(flow, w, "Tom"))["ok"] is True


@pytest.mark.asyncio
async def test_a_missing_platform_is_missing_like_a_missing_id(flow):
    w = await platform_world(flow, platform_field="platform", allowed_platforms=["PC"])
    await plays_on(flow, w, "Mila", None)

    row = await state_of(flow, w, "Mila")

    assert (row["state"], row["ok"]) == ("platform_missing", False)
    assert row["reason"] == "Plattform fehlt im Profil."


@pytest.mark.asyncio
async def test_a_required_platform_field_leaves_the_missing_text_to_the_id(flow):
    w = await platform_world(flow, required=True, platform_field="platform", allowed_platforms=["PC"])
    await plays_on(flow, w, "Mila", None)

    row = await state_of(flow, w, "Mila")

    assert (row["state"], row["ok"]) == ("missing", False)
    assert "Plattform fehlt im Profil" in row["reason"]


async def faulty_id(flow, *, state: str, season_id: str, user_id: str, squad_id: str, game: dict, key: str) -> None:
    """Macht den ID-Stand einer Person fehlerhaft: ``missing``, ``late``, ``format`` oder ``taken``."""
    if state == "missing":
        await flow.db.users.update_one({"id": user_id}, {"$unset": {f"game_ids.{game['slug']}.{key}": ""}})
    elif state == "late":
        await flow.db.league_rosters.insert_one({"season_id": season_id, "user_id": user_id, "game_id": game["id"],
                                                "squad_ids": [squad_id], "late_squad_ids": [squad_id]})
    elif state == "format":
        fields = (await flow.db.games.find_one({"id": game["id"]}))["player_id_fields"]
        fields = [{**item, "pattern": "^[0-9]+$"} if item["key"] == key else item for item in fields]
        await flow.db.games.update_one({"id": game["id"]}, {"$set": {"player_id_fields": fields}})
    elif state == "taken":
        mine = (await flow.db.users.find_one({"id": user_id}))["game_ids"][game["slug"]][key]
        await flow.db.league_seasons.update_one({"id": season_id}, {"$set": {"unique_game_ids": True}})
        await flow.db.league_rosters.insert_one({"season_id": season_id, "user_id": "fremde-person", "game_id": game["id"],
                                                "squad_ids": [], "player_ids": {key: mine}, "locked_at": "2026-11-01T10:00:00+00:00"})


FAULTY_ID_STATES = ("missing", "late", "format", "taken")


@pytest.mark.asyncio
@pytest.mark.parametrize("faulty", FAULTY_ID_STATES)
async def test_a_faulty_id_comes_before_the_platform(flow, faulty):
    """Ein fehlerhafter ID-Stand bleibt stehen - auch wenn die Plattform nicht erlaubt ist (Codex #2270)."""
    w = await platform_world(flow, platform_field="platform", allowed_platforms=["PC"])
    await plays_on(flow, w, "Mila", "PlayStation")
    await faulty_id(flow, state=faulty, season_id=w["season_id"], user_id=w["users"]["Mila"]["id"], squad_id=w["squad_a"]["id"],
                    game={"id": "probe-main", "slug": MAIN_SLUG}, key="activision_id")

    row = await state_of(flow, w, "Mila")

    assert (row["state"], row["ok"]) == (faulty, False), row
    assert row["state"] == row["id_state"]
    assert "PlayStation" not in (row["reason"] or "")
    if faulty == "missing":
        assert row["reason"] == "Activision-ID fehlt im Profil."


@pytest.mark.asyncio
async def test_the_locked_platform_counts_not_a_later_profile_change(flow):
    w = await platform_world(flow, required=True, platform_field="platform", allowed_platforms=["PC"])
    mila = w["users"]["Mila"]["id"]
    await flow.db.league_rosters.insert_one({
        "season_id": w["season_id"], "user_id": mila, "league_id": "liga", "game_id": "probe-shooter", "squad_ids": [w["squad_a"]["id"]],
        "player_ids": {"activision_id": "TestloeweMila#1000002", "platform": "PlayStation"}, "locked_at": "2026-11-01T10:00:00+00:00"})

    assert (await state_of(flow, w, "Mila"))["state"] == "platform_not_allowed", "festgehalten ist PlayStation, auch wenn das Profil PC sagt"


@pytest.mark.asyncio
async def test_the_platform_rule_comes_after_age_and_before_waiting(flow):
    w = await platform_world(flow, platform_field="platform", allowed_platforms=["PC"], min_age=18)
    await plays_on(flow, w, "Mila", "PlayStation")

    assert (await state_of(flow, w, "Mila"))["state"] == "age_missing"
    await flow.db.users.update_one({"id": w["users"]["Mila"]["id"]}, {"$set": {"birth_date": "1990-01-01"}})
    assert (await state_of(flow, w, "Mila"))["state"] == "platform_not_allowed"


@pytest.mark.asyncio
async def test_a_field_the_game_no_longer_has_checks_nothing(flow):
    w = await platform_world(flow, platform_field="gibt-es-nicht", allowed_platforms=["PC"])
    await plays_on(flow, w, "Mila", "PlayStation")

    assert (await state_of(flow, w, "Mila"))["ok"] is True


# ---------------------------------------------------------------- Liga N


@pytest.mark.asyncio
async def test_liga_n_opens_what_the_season_limits(flow):
    w = await platform_world(flow, platform_field="platform", allowed_platforms=["PC"])
    await plays_on(flow, w, "Mila", "PlayStation")
    await division(flow, w, allowed_platforms=[])

    assert (await state_of(flow, w, "Mila"))["ok"] is True


@pytest.mark.asyncio
async def test_liga_n_limits_on_its_own_and_says_so(flow):
    w = await platform_world(flow, platform_field="platform", allowed_platforms=[])
    await division(flow, w, allowed_platforms=["PlayStation"])

    row = await state_of(flow, w, "Kapitaen")

    assert row["state"] == "platform_not_allowed"
    assert row["reason"] == "Liga 1 ist nur für PlayStation – angegeben ist PC."


@pytest.mark.asyncio
async def test_liga_n_without_platform_override_follows_the_season(flow):
    w = await platform_world(flow, platform_field="platform", allowed_platforms=["PC"])
    await plays_on(flow, w, "Mila", "PlayStation")
    await division(flow, w, best_of=5, crossplay=False)

    assert (await state_of(flow, w, "Mila"))["state"] == "platform_not_allowed"


def test_before_a_liga_n_is_known_the_widest_rule_counts():
    game = {"effective_player_id_fields": [PLATFORM]}
    season = {"platform_field": "platform", "allowed_platforms": ["PC"]}
    one = {"level": 1, "status": "active", "overrides": {"allowed_platforms": ["PC"]}}
    two = {"level": 2, "status": "active", "overrides": {"allowed_platforms": ["Xbox"]}}
    open_ = {"level": 3, "status": "active", "overrides": {"allowed_platforms": []}}
    archived = {"level": 4, "status": "archived", "overrides": {"allowed_platforms": []}}

    assert league_platform.lenient_rule(season, [one, two], game).allowed == ("PC", "Xbox"), "in der Reihenfolge des Spiels"
    assert league_platform.lenient_rule(season, [one, two, open_], game) is None, "eine Liga N ohne Grenze hebt die Prüfung auf"
    assert league_platform.lenient_rule(season, [one, archived], game).allowed == ("PC",), "archivierte Liga N zählt nicht"
    assert league_platform.lenient_rule(season, [], game).allowed == ("PC",), "ohne Liga N gilt die Season"


# ---------------------------------------------------------------- Kaderübersicht und Team-Seite


@pytest.mark.asyncio
async def test_the_roster_overview_checks_each_squad_with_its_liga_n(flow):
    w = await platform_world(flow, platform_field="platform", allowed_platforms=["PC"])
    await plays_on(flow, w, "Mila", "PlayStation")
    await plays_on(flow, w, "Falke2", "Xbox")
    flow.act_as(w["staff"])

    before = ok(await flow.get(f"{ADMIN_LEAGUES}/seasons/{w['season_id']}/roster"))
    players = {player["name"]: player["eligibility"] for row in before["squads"] for player in row["players"]}
    assert players["Mila"]["state"] == "platform_not_allowed" and players["Falke2"]["state"] == "platform_not_allowed"
    assert before["rules"]["platform"]["values"]["platforms"] == "PC"

    await division(flow, w, allowed_platforms=["PC", "PlayStation"])
    after = ok(await flow.get(f"{ADMIN_LEAGUES}/seasons/{w['season_id']}/roster"))
    players = {player["name"]: player["eligibility"] for row in after["squads"] for player in row["players"]}
    assert players["Mila"]["ok"] is True, "Liga 1 lässt PlayStation zu"
    assert players["Falke2"]["reason"] == "Liga 1 ist nur für PC und PlayStation – angegeben ist Xbox."


@pytest.mark.asyncio
async def test_the_team_page_shows_the_rule_of_its_staffel(flow):
    w = await platform_world(flow, platform_field="platform", allowed_platforms=["PC"], input_device="both")
    await division(flow, w, crossplay=False)
    await plays_on(flow, w, "Mila", "PlayStation")
    flow.act_as(w["users"]["Kapitaen"])

    view = ok(await flow.get(f"/api/teams/{w['lions']['id']}/squads/{w['squad_a']['id']}/eligibility"))

    season = view["seasons"][0]
    assert season["rules"]["platform"]["values"] == {"platforms": "PC", "crossplay": "aus", "input_device": "Controller oder Maus und Tastatur"}
    mila = next(row for row in season["players"] if row["name"] == "Mila")
    assert mila["state"] == "platform_not_allowed" and "PlayStation" in mila["reason"]


# ---------------------------------------------------------------- Teilnehmerliste


@pytest.mark.asyncio
async def test_the_participant_list_refuses_a_player_on_another_platform(flow):
    w = await platform_world(flow, platform_field="platform", allowed_platforms=["PC"])
    await plays_on(flow, w, "Mila", "PlayStation")
    tournament = await flow.db.tournaments.find_one({"id": w["tournament"]["id"]}, {"_id": 0})
    roster = set(w["squad_a"]["member_ids"])
    ctx = await league_eligibility.context_for_tournament(flow.db, tournament, roster)
    rows = league_eligibility.statuses(ctx, roster, w["squad_a"]["id"])

    with pytest.raises(league_eligibility.EligibilityError) as refused:
        league_eligibility.check_participants(rows, [w["users"]["Kapitaen"]["id"], w["users"]["Mila"]["id"]], minimum=2,
                                              roster=roster, side="Rudel A")

    assert "Mila kann nicht eingetragen werden – Diese Season ist nur für PC" in refused.value.detail


# ---------------------------------------------------------------- Verwaltung


@pytest.mark.asyncio
async def test_staff_saves_the_settings_and_the_protocol_keeps_before_and_after(flow):
    w = await platform_world(flow)
    flow.act_as(w["staff"])

    view = ok(await flow.get(settings_url(w)))
    assert view["settings"] == {"platform_field": None, "allowed_platforms": [], "crossplay": None, "input_device": None}
    assert [row["key"] for row in view["fields"]] == ["platform"], "nur Felder mit Auswahl"
    assert view["fields"][0]["options"] == ["PC", "PlayStation", "Xbox"]

    saved = ok(await flow.patch(season_url(w), json={"platform_field": "platform", "allowed_platforms": ["Xbox", "PC"],
                                                     "crossplay": False, "input_device": "mouse_keyboard"}))

    assert sorted(saved["changed"]) == ["allowed_platforms", "crossplay", "input_device", "platform_field"]
    assert ok(await flow.get(settings_url(w)))["settings"] == {"platform_field": "platform", "allowed_platforms": ["PC", "Xbox"],
                                                               "crossplay": False, "input_device": "mouse_keyboard"}, "Reihenfolge wie am Spiel"
    stored = await flow.db.league_seasons.find_one({"id": w["season_id"]}, {"_id": 0})
    assert stored["allowed_platforms"] == ["PC", "Xbox"] and stored["input_device"] == "mouse_keyboard"
    audit = await flow.db.audit_logs.find_one({"action": "league.season.platform"}, {"_id": 0})
    assert audit["target_id"] == w["season_id"]
    assert audit["data"]["before"]["allowed_platforms"] == [] and audit["data"]["after"]["allowed_platforms"] == ["PC", "Xbox"]

    again = ok(await flow.patch(season_url(w), json={"platform_field": "platform", "allowed_platforms": ["PC", "Xbox"],
                                                     "crossplay": False, "input_device": "mouse_keyboard", "min_age": 18}))
    assert again["changed"] == ["min_age"]
    assert await flow.db.audit_logs.count_documents({"action": "league.season.platform"}) == 1, "ohne Änderung kein Eintrag"


@pytest.mark.asyncio
async def test_saving_the_tab_unchanged_never_stops_on_a_vanished_field(flow):
    w = await platform_world(flow, platform_field="gibt-es-nicht", allowed_platforms=["PC"])
    flow.act_as(w["staff"])

    saved = ok(await flow.patch(season_url(w), json={"platform_field": "gibt-es-nicht", "allowed_platforms": ["PC"], "crossplay": None,
                                                     "input_device": None, "min_age": 16}))

    assert saved["changed"] == ["min_age"]


@pytest.mark.asyncio
async def test_an_old_season_saved_without_platform_stays_without(flow):
    w = await platform_world(flow)
    flow.act_as(w["staff"])

    saved = ok(await flow.patch(season_url(w), json={"platform_field": None, "allowed_platforms": [], "crossplay": None, "input_device": None,
                                                     "min_age": 16}))

    assert saved["changed"] == ["min_age"]
    assert await flow.db.audit_logs.count_documents({"action": "league.season.platform"}) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(("body", "text"), [
    ({"platform_field": "activision_id", "allowed_platforms": []}, "keine Auswahl"),
    ({"platform_field": "gibt-es-nicht", "allowed_platforms": []}, "keine Auswahl"),
    ({"platform_field": None, "allowed_platforms": ["PC"]}, "Feld"),
    ({"platform_field": "platform", "allowed_platforms": ["Handheld"]}, "Handheld"),
    ({"platform_field": "platform", "input_device": "joystick"}, None),
])
async def test_wrong_settings_are_refused_with_a_sentence(flow, body, text):
    w = await platform_world(flow)
    flow.act_as(w["staff"])

    refused = await flow.patch(season_url(w), json=body)

    assert refused.status_code == 422, refused.text
    if text:
        assert text in refused.json()["detail"]
    assert "allowed_platforms" not in await flow.db.league_seasons.find_one({"id": w["season_id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_a_saved_platform_stays_selectable_after_the_game_drops_it(flow):
    w = await platform_world(flow, platform_field="platform", allowed_platforms=["PC", "Xbox"])
    await flow.db.games.update_one({"id": "probe-main", "player_id_fields.key": "platform"},
                                   {"$set": {"player_id_fields.$.options": ["PC", "PlayStation"]}})
    flow.act_as(w["staff"])

    kept = await flow.patch(season_url(w), json={"platform_field": "platform", "allowed_platforms": ["Xbox", "PC"], "crossplay": True})

    assert kept.status_code == 200, kept.text
    assert ok(await flow.get(settings_url(w)))["fields"][0]["options"] == ["PC", "PlayStation", "Xbox"], "gespeichert bleibt wählbar"


@pytest.mark.asyncio
async def test_the_view_warns_when_the_chosen_field_is_gone(flow):
    w = await platform_world(flow, platform_field="gibt-es-nicht", allowed_platforms=["PC"])
    flow.act_as(w["staff"])

    assert ok(await flow.get(settings_url(w)))["field_missing"] is True


@pytest.mark.asyncio
async def test_liga_n_overrides_go_through_the_division_sheet_and_are_checked(flow):
    w = await application_world(flow, teams=0, rules=False, open_window=False)
    await flow.db.games.update_one({"id": w["game"]["id"]}, {"$set": {"player_id_fields": [{**PLATFORM, "required": False}]}})
    flow.act_as(w["lead"])
    url = f"{ADMIN_LEAGUES}/divisions/{w['division']['id']}"

    without_field = await flow.patch(url, json={"overrides": {"allowed_platforms": ["PC"]}})
    assert without_field.status_code == 422 and "Feld" in without_field.json()["detail"]

    ok(await flow.patch(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}", json={"platform_field": "platform", "allowed_platforms": ["PC"]}))
    unknown = await flow.patch(url, json={"overrides": {"allowed_platforms": ["Handheld"]}})
    assert unknown.status_code == 422 and "Handheld" in unknown.json()["detail"]

    saved = ok(await flow.patch(url, json={"overrides": {"best_of": 5, "allowed_platforms": ["Xbox", "PlayStation"], "crossplay": True,
                                                         "input_device": "controller"}}))
    assert saved["overrides"] == {"best_of": 5, "allowed_platforms": ["PlayStation", "Xbox"], "crossplay": True, "input_device": "controller"}
    opened = ok(await flow.patch(url, json={"overrides": {"allowed_platforms": []}}))
    assert opened["overrides"] == {"allowed_platforms": []}, "leer heißt in Liga N: alle erlaubt"

    ok(await flow.patch(url, json={"overrides": {"allowed_platforms": ["Xbox"]}}))
    cleared = await flow.patch(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}", json={"platform_field": None, "allowed_platforms": []})
    assert cleared.status_code == 422 and "Liga 1" in cleared.json()["detail"], "das Feld bleibt, solange Liga N eigene Plattformen trägt"

    view = ok(await flow.get(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}/platform"))
    assert view["divisions"][0]["overrides"] == {"allowed_platforms": ["Xbox"]}
    assert view["divisions"][0]["effective"]["allowed"] == ["Xbox"]


# ---------------------------------------------------------------- Öffentlich


@pytest.mark.asyncio
async def test_the_season_answer_carries_the_settings_and_the_rule_texts(flow):
    w = await platform_world(flow, platform_field="platform", allowed_platforms=["PC"], crossplay=False, input_device="controller")
    await division(flow, w, allowed_platforms=[], crossplay=True)
    flow.act_as(None)

    block = ok(await flow.get("/api/leagues/testliga/season-1"))["platform"]

    assert block["field_label"] == "Plattform"
    assert block["allowed"] == ["PC"] and block["crossplay"] is False
    assert block["input_device"] == "controller" and block["input_device_label"] == "Controller"
    assert block["values"] == {"platforms": "PC", "crossplay": "aus", "input_device": "Controller"}
    liga = block["divisions"][0]
    assert liga["label"] == "Liga 1" and liga["differs"] is True
    assert liga["values"] == {"platforms": "alle Plattformen", "crossplay": "an", "input_device": "Controller"}
    assert "platform_field" not in json.dumps(block), "kein interner Schlüssel"


def test_rule_values_name_every_case():
    assert league_platform.rule_values({"allowed": ["PC", "PlayStation", "Xbox"], "crossplay": None, "input_device": "both"}) == {
        "platforms": "PC, PlayStation und Xbox", "crossplay": None, "input_device": "Controller oder Maus und Tastatur"}
    assert league_platform.rule_values({"allowed": [], "crossplay": True, "input_device": None}) == {
        "platforms": "alle Plattformen", "crossplay": "an", "input_device": None}


# ---------------------------------------------------------------- Anmeldung (B.4) mit Mindestkader


async def apply_world(flow, *, min_squad_size: int) -> dict:
    w = await application_world(flow, teams=1, min_squad_size=min_squad_size, team_size=min_squad_size)
    game = w["game"]
    await flow.db.games.update_one({"id": game["id"]}, {"$set": {"player_id_fields": [{**PLATFORM, "required": False}]}})
    for user in w["teams"][0]["people"]:
        await flow.db.users.update_one({"id": user["id"]}, {"$set": {f"game_ids.{game['slug']}.platform": "PC"}})
    flow.act_as(w["lead"])
    ok(await flow.patch(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}", json={"platform_field": "platform", "allowed_platforms": ["PC"]}))
    return w


async def check_of(flow, w: dict) -> dict:
    side = w["teams"][0]
    flow.act_as(side["captain"])
    view = ok(await flow.get(f"{base_url(w)}/application"))
    return next(row for row in view["squads"] if row["squad_id"] == side["squad"]["id"])


@pytest.mark.asyncio
async def test_registration_with_pc_players_goes_through(flow):
    w = await apply_world(flow, min_squad_size=4)

    row = await check_of(flow, w)

    assert row["problems"] == [] and row["warnings"] == []
    assert (await submit(flow, w, w["teams"][0])).status_code == 200


@pytest.mark.asyncio
async def test_a_playstation_player_below_the_minimum_blocks_and_is_named(flow):
    w = await apply_world(flow, min_squad_size=4)
    side = w["teams"][0]
    await flow.db.users.update_one({"id": side["member"]["id"]}, {"$set": {f"game_ids.{w['game']['slug']}.platform": "PlayStation"}})

    row = await check_of(flow, w)

    assert any("Nur 3 Spieler sind spielberechtigt" in text and "anderen Plattform" in text and "Spiel-ID" not in text
               for text in row["problems"]), row
    assert "TeamA S3: Diese Season ist nur für PC – angegeben ist PlayStation." in row["warnings"]
    refused = await submit(flow, w, side)
    assert refused.status_code == 400 and "spielberechtigt" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_a_playstation_player_beyond_the_minimum_only_warns(flow):
    w = await apply_world(flow, min_squad_size=3)
    side = w["teams"][0]
    await flow.db.users.update_one({"id": side["member"]["id"]}, {"$set": {f"game_ids.{w['game']['slug']}.platform": "PlayStation"}})

    row = await check_of(flow, w)

    assert row["problems"] == []
    assert row["warnings"] == ["TeamA S3: Diese Season ist nur für PC – angegeben ist PlayStation."]
    assert (await submit(flow, w, side)).status_code == 200


@pytest.mark.asyncio
async def test_the_application_view_names_the_platform(flow):
    w = await apply_world(flow, min_squad_size=4)
    flow.act_as(w["teams"][0]["captain"])

    view = ok(await flow.get(f"{base_url(w)}/application"))

    assert view["platform"]["values"]["platforms"] == "PC"


# ---------------------------------------------------------------- Zuteilen


@pytest.mark.asyncio
async def test_assigning_warns_beyond_and_refuses_below_the_minimum(flow):
    w = await apply_world(flow, min_squad_size=3)
    side = w["teams"][0]
    slug = w["game"]["slug"]
    await flow.db.users.update_one({"id": side["member"]["id"]}, {"$set": {f"game_ids.{slug}.platform": "PlayStation"}})
    flow.act_as(w["lead"])

    candidates = ok(await flow.get(f"/api/tournaments/{w['tid']}/squad-candidates"))
    squad = next(row for team in candidates["teams"] for row in team["squads"] if row["id"] == side["squad"]["id"])
    assert squad["problems"] == []
    assert squad["notes"] == ["TeamA S3: Diese Season ist nur für PC – angegeben ist PlayStation."]

    await flow.db.users.update_one({"id": side["people"][2]["id"]}, {"$set": {f"game_ids.{slug}.platform": "Xbox"}})
    candidates = ok(await flow.get(f"/api/tournaments/{w['tid']}/squad-candidates"))
    squad = next(row for team in candidates["teams"] for row in team["squads"] if row["id"] == side["squad"]["id"])
    assert any("Nur 2 Spieler" in text and "TeamA S3 (PlayStation)" in text and "TeamA S2 (Xbox)" in text for text in squad["problems"]), squad

    refused = await flow.post(f"/api/tournaments/{w['tid']}/squad-registrations", json={"team_id": side["team"]["id"], "squad_id": side["squad"]["id"]})
    assert refused.status_code == 400 and "erlaubten Plattform" in refused.json()["detail"]


@pytest.mark.asyncio
@pytest.mark.parametrize("faulty", FAULTY_ID_STATES)
async def test_assigning_a_faulty_id_does_not_count_as_another_platform(flow, faulty):
    """Fehlerhafte Pflicht-ID plus PlayStation: Es zählt der ID-Stand, nicht die Plattform - kein Halt wegen der Plattform unter dem
    Mindestkader (Codex #2270)."""
    w = await apply_world(flow, min_squad_size=4)
    side = w["teams"][0]
    slug = w["game"]["slug"]
    await flow.db.games.update_one({"id": w["game"]["id"]}, {"$set": {"player_id_fields": [
        {"key": "probe_id", "label": "Probe-ID", "required": True}, {**PLATFORM, "required": False}]}})
    for user in side["people"]:
        await flow.db.users.update_one({"id": user["id"]}, {"$set": {f"game_ids.{slug}.probe_id": f"Probe#{user['id'][:6]}"}})
    await flow.db.users.update_one({"id": side["member"]["id"]}, {"$set": {f"game_ids.{slug}.platform": "PlayStation"}})
    await faulty_id(flow, state=faulty, season_id=w["season"]["id"], user_id=side["member"]["id"], squad_id=side["squad"]["id"],
                    game=w["game"], key="probe_id")
    flow.act_as(w["lead"])

    candidates = ok(await flow.get(f"/api/tournaments/{w['tid']}/squad-candidates"))
    squad = next(row for team in candidates["teams"] for row in team["squads"] if row["id"] == side["squad"]["id"])

    player = next(row for row in squad["players"] if row["name"] == "TeamA S3")
    assert player["state"] == faulty, player
    assert not [text for text in squad["problems"] + squad["notes"] if "Plattform" in text or "PlayStation" in text], squad
    assigned = await flow.post(f"/api/tournaments/{w['tid']}/squad-registrations", json={"team_id": side["team"]["id"], "squad_id": side["squad"]["id"]})
    assert "Plattform" not in assigned.text, assigned.text
    if faulty == "missing":
        assert squad["problems"] == [] and squad["notes"] == [], squad
        assert assigned.status_code == 200, assigned.text
