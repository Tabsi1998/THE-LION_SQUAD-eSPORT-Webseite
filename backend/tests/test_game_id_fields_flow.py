"""Schlüssel der Spiel-ID-Felder (#2249, Codex-Prüfung Fund 3) - durch die echten Routen.

An einem Schlüssel hängen die IDs der Spieler (``users.game_ids.<spiel>.<schlüssel>``). Zwei Felder mit demselben Schlüssel
oder eines ohne Schlüssel lehnt der Server mit 422 ab. Altbestand bleibt speicherbar: Was schon doppelt oder leer gespeichert
ist, hält ein anderes Speichern nicht auf, nur Neues wird abgelehnt. Ein nicht kanonischer Schlüssel („PSN-ID“) bleibt, wie er
ist, und fremde Angaben am Feld auch. Erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def admin(flow):
    flow.act_as(await flow.add_user(role="superadmin", name="admin"))


def field(key, label=None, **extra):
    return {"key": key, "label": label or key or "Feld", "required": True, **extra}


@pytest.mark.asyncio
async def test_a_duplicate_or_empty_key_is_refused_when_creating_and_changing(flow):
    await admin(flow)
    twice = await flow.post("/api/games", json={"name": "Probe Shooter", "player_id_fields": [field("psn_id", "PSN-ID"), field("psn_id", "PSN ID")]})
    assert twice.status_code == 422
    assert "„psn_id“" in twice.json()["detail"]
    empty = await flow.post("/api/games", json={"name": "Probe Shooter", "player_id_fields": [field("  ", "ゲームID")]})
    assert empty.status_code == 422
    assert "Schlüssel" in empty.json()["detail"]

    created = await flow.post("/api/games", json={"name": "Probe Shooter", "player_id_fields": [field("psn_id", "PSN-ID")]})
    assert created.status_code == 200, created.text
    game = created.json()
    refused = await flow.patch(f"/api/games/{game['id']}", json={"player_id_fields": [field("psn_id", "PSN-ID"), field("psn_id", "PSN ID")]})
    assert refused.status_code == 422
    assert (await flow.get(f"/api/games/{game['id']}")).json()["player_id_fields"] == [field("psn_id", "PSN-ID")]


@pytest.mark.asyncio
async def test_old_doubles_and_empty_keys_stay_saveable_but_nothing_new_of_that_kind(flow):
    await admin(flow)
    await flow.db.games.insert_one({"id": "alt", "slug": "altspiel", "name": "Altspiel",
                                    "player_id_fields": [field("riot"), field("riot", "Riot 2"), field("", "Ohne")]})
    same = [field("riot", "Riot-Konto"), field("riot", "Riot 2"), field("", "Ohne")]
    kept = await flow.patch("/api/games/alt", json={"player_id_fields": same, "short_name": "ALT"})
    assert kept.status_code == 200, kept.text
    third = await flow.patch("/api/games/alt", json={"player_id_fields": [*same, field("riot", "Riot 3")]})
    assert third.status_code == 422
    another_empty = await flow.patch("/api/games/alt", json={"player_id_fields": [*same, field("", "Noch eins")]})
    assert another_empty.status_code == 422
    assert (await flow.patch("/api/games/alt", json={"short_name": "A"})).status_code == 200, "ohne ID-Felder prüft nichts"


@pytest.mark.asyncio
async def test_a_non_canonical_key_and_unknown_details_come_back_unchanged(flow):
    await admin(flow)
    created = await flow.post("/api/games", json={"name": "Probe Konsole", "player_id_fields": [field("PSN-ID", source="import")]})
    assert created.status_code == 200, created.text
    game = created.json()
    renamed = await flow.patch(f"/api/games/{game['id']}", json={"player_id_fields": [field("PSN-ID", "PlayStation-Konto", source="import")]})
    assert renamed.status_code == 200, renamed.text
    assert (await flow.get(f"/api/games/{game['id']}")).json()["player_id_fields"] == [field("PSN-ID", "PlayStation-Konto", source="import")]


# Codex-Nachprüfung #2249: Ein Schlüssel, unter dem schon IDs stehen, verschwindet nicht still - weder per Schlüsselwechsel noch
# per Löschen und Neuanlegen. Gezählt wird jede Person mit einem Wert: im Profil (auch unter einer Spielversion, die die IDs
# erbt) und im Liga-Kader.
async def game_with_psn(flow, **extra) -> dict:
    created = await flow.post("/api/games", json={"name": "Probe Konsole", "player_id_fields": [field("PSN-ID", "PSN-ID")], **extra})
    assert created.status_code == 200, created.text
    return created.json()


async def player_with(flow, name: str, game_ids: dict) -> dict:
    user = await flow.add_user(role="user", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"game_ids": game_ids}})
    return user


@pytest.mark.asyncio
async def test_a_key_with_stored_ids_needs_a_confirmation_to_go_and_is_logged(flow):
    await admin(flow)
    game = await game_with_psn(flow)
    await player_with(flow, "Probe Eins", {game["slug"]: {"PSN-ID": "probe_eins"}})
    await player_with(flow, "Probe Leer", {game["slug"]: {"PSN-ID": "  "}})

    usage = (await flow.get(f"/api/games/{game['id']}/usage")).json()
    assert usage["id_fields"] == {"PSN-ID": 1}

    renamed = [field("psn_id", "PSN-ID")]
    refused = await flow.patch(f"/api/games/{game['id']}", json={"player_id_fields": renamed})
    assert refused.status_code == 409
    detail = refused.json()["detail"]
    assert detail["code"] == "id_keys_in_use" and detail["keys"] == {"PSN-ID": 1}
    assert "„PSN-ID“" in detail["message"] and "1 Person" in detail["message"]
    removed = await flow.patch(f"/api/games/{game['id']}", json={"player_id_fields": []})
    assert removed.status_code == 409, "Löschen ist dasselbe wie Wechseln"
    assert (await flow.get(f"/api/games/{game['id']}")).json()["player_id_fields"] == [field("PSN-ID", "PSN-ID")]

    confirmed = await flow.patch(f"/api/games/{game['id']}", json={"player_id_fields": renamed, "confirm_removed_keys": ["PSN-ID"]})
    assert confirmed.status_code == 200, confirmed.text
    assert "confirm_removed_keys" not in confirmed.json()
    stored = await flow.db.games.find_one({"id": game["id"]}, {"_id": 0})
    assert stored["player_id_fields"] == renamed and "confirm_removed_keys" not in stored
    log = await flow.db.audit_logs.find_one({"action": "game.player_id_fields.remove"}, {"_id": 0})
    assert log["target_id"] == game["id"] and log["data"] == {"keys": {"PSN-ID": 1}}


@pytest.mark.asyncio
async def test_a_key_without_stored_ids_goes_without_question(flow):
    await admin(flow)
    game = await game_with_psn(flow)
    await player_with(flow, "Probe Andere", {game["slug"]: {"andere": "x"}, "fremdes-spiel": {"PSN-ID": "y"}})
    removed = await flow.patch(f"/api/games/{game['id']}", json={"player_id_fields": [field("psn_id", "PSN-ID")]})
    assert removed.status_code == 200, removed.text
    assert await flow.db.audit_logs.count_documents({"action": "game.player_id_fields.remove"}) == 0


# Codex-Prüfung zu fix/2249-id-schluessel: Das Profil speichert alle Felder einer Version unter dem Slug ihrer effektiven ID-Quelle
# (ProfilePage gruppiert nach identity_game_slug) - genau so ist es beim echten Aufbau „Call Of Duty: Modern Warfare 4“ mit
# ID-Quelle „Call Of Duty“.
async def shooter_world(flow) -> dict:
    main = (await flow.post("/api/games", json={"name": "Probe Shooter", "player_id_fields": [field("activision_id", "Activision ID")]})).json()
    other = (await flow.post("/api/games", json={"name": "Probe Anderes", "player_id_fields": [field("activision_id", "Activision ID")]})).json()
    version = (await flow.post("/api/games", json={"name": "Probe Shooter 4", "kind": "edition", "parent_game_id": main["id"],
                                                   "identity_source_game_id": main["id"], "player_id_fields": [field("plattform", "Plattform")]})).json()
    return {"main": main, "other": other, "version": version}


@pytest.mark.asyncio
async def test_a_version_field_stored_under_its_id_source_counts(flow):
    await admin(flow)
    world = await shooter_world(flow)
    main, version = world["main"], world["version"]
    await player_with(flow, "Probe Quelle", {main["slug"]: {"activision_id": "probe#1", "plattform": "PC"}})
    assert (await flow.get(f"/api/games/{version['id']}/usage")).json()["id_fields"] == {"plattform": 1}
    refused = await flow.patch(f"/api/games/{version['id']}", json={"player_id_fields": []})
    assert refused.status_code == 409
    assert refused.json()["detail"]["keys"] == {"plattform": 1}


@pytest.mark.asyncio
async def test_inherited_profiles_and_league_rosters_count_once_per_person(flow):
    await admin(flow)
    game = await game_with_psn(flow)
    edition = (await flow.post("/api/games", json={"name": "Probe Konsole 2", "kind": "edition", "parent_game_id": game["id"]})).json()
    own = (await flow.post("/api/games", json={"name": "Probe Konsole 3", "kind": "edition", "parent_game_id": game["id"],
                                               "inherit_player_ids": False})).json()
    # Wer über die Version eingetragen hat, steht unter dem Slug der Quelle - die Version ohne Erbe speichert unter ihrem eigenen.
    first = await player_with(flow, "Probe Erbe", {game["slug"]: {"PSN-ID": "erbe"}})
    await player_with(flow, "Probe Eigen", {own["slug"]: {"PSN-ID": "eigen"}})
    second = await flow.add_user(role="user", name="Probe Kader")
    await flow.db.league_rosters.insert_many([
        {"id": "r1", "season_id": "s1", "user_id": second["id"], "game_id": edition["id"], "player_ids": {"PSN-ID": "kader"}},
        {"id": "r2", "season_id": "s1", "user_id": first["id"], "game_id": edition["id"], "player_ids": {"PSN-ID": "erbe"}},
    ])
    refused = await flow.patch(f"/api/games/{game['id']}", json={"player_id_fields": []})
    assert refused.status_code == 409
    assert refused.json()["detail"]["keys"] == {"PSN-ID": 2}, "die Version ohne Erbe zählt nicht, Erbe und Kader je Person einmal"


@pytest.mark.asyncio
@pytest.mark.parametrize("change", [
    {"identity_source_game_id": "other"},
    {"inherit_player_ids": False, "identity_source_game_id": None},
    {"kind": "standalone", "parent_game_id": None, "identity_source_game_id": None},
])
async def test_changing_the_id_source_asks_before_ids_get_lost(flow, change):
    await admin(flow)
    world = await shooter_world(flow)
    main, version = world["main"], world["version"]
    await player_with(flow, "Probe Quelle", {main["slug"]: {"activision_id": "probe#1", "plattform": "PC"}})
    body = {key: (world["other"]["id"] if value == "other" else value) for key, value in change.items()}
    refused = await flow.patch(f"/api/games/{version['id']}", json=body)
    assert refused.status_code == 409, refused.text
    keys = refused.json()["detail"]["keys"]
    assert keys["plattform"] == 1 and set(keys) <= {"plattform", "activision_id"}
    assert (await flow.get(f"/api/games/{version['id']}")).json()["identity_source_game_id"] == main["id"]
    done = await flow.patch(f"/api/games/{version['id']}", json={**body, "confirm_removed_keys": list(keys)})
    assert done.status_code == 200, done.text
    log = await flow.db.audit_logs.find_one({"action": "game.player_id_fields.remove", "target_id": version["id"]}, {"_id": 0})
    assert log["data"] == {"keys": keys}


@pytest.mark.asyncio
async def test_a_version_whose_ids_live_under_its_source_or_in_a_roster_is_not_deleted(flow):
    await admin(flow)
    world = await shooter_world(flow)
    main, version = world["main"], world["version"]
    await player_with(flow, "Probe Quelle", {main["slug"]: {"plattform": "PC"}})
    refused = await flow.delete(f"/api/games/{version['id']}")
    assert refused.status_code == 409
    assert "Person mit Spieler-ID" in refused.json()["detail"]

    empty = (await flow.post("/api/games", json={"name": "Probe Shooter 5", "kind": "edition", "parent_game_id": main["id"]})).json()
    member = await flow.add_user(role="user", name="Probe Kader 5")
    await flow.db.league_rosters.insert_one({"id": "r5", "season_id": "s5", "user_id": member["id"], "game_id": empty["id"],
                                             "player_ids": {"activision_id": "probe#5"}})
    second = await flow.delete(f"/api/games/{empty['id']}")
    assert second.status_code == 409


@pytest.mark.asyncio
async def test_anonymized_accounts_never_count_and_odd_keys_still_work(flow):
    await admin(flow)
    created = await flow.post("/api/games", json={"name": "Probe Alt", "player_id_fields": [field("probe"), field("alt.id", "Alt")]})
    game = created.json()
    gone = await player_with(flow, "Probe Weg", {game["slug"]: {"probe": "weg"}})
    await flow.db.users.update_one({"id": gone["id"]}, {"$set": {"anonymized_at": "2026-11-01T10:00:00+00:00"}})
    await flow.db.league_rosters.insert_one({"id": "rx", "season_id": "sx", "user_id": gone["id"], "game_id": game["id"],
                                             "player_ids": {"probe": "weg"}})
    assert (await flow.get(f"/api/games/{game['id']}/usage")).json()["id_fields"] == {"probe": 0, "alt.id": 0}
    one = await flow.patch(f"/api/games/{game['id']}", json={"player_id_fields": [field("probe")]})
    assert one.status_code == 200
    none = await flow.patch(f"/api/games/{game['id']}", json={"player_id_fields": []})
    assert none.status_code == 200


# Codex-Nachprüfung: der echte Weg - das Profil speichert per HTTP unter dem Slug der effektiven ID-Quelle, die Anmeldung liest
# über ``_profile_player_ids``. Ein neuer Name ändert die Adresse (den Slug) nicht mehr von selbst; ein ausdrücklich geänderter Slug,
# unter dem schon IDs stehen, braucht eine Bestätigung. Gezählt wird nur, was danach unter keinem lesbaren Pfad mehr liegt.
async def read_ids(flow, user_id: str, game_id: str) -> dict:
    from routes.tournament_common import _enrich_game_identity, _profile_player_ids

    user = await flow.db.users.find_one({"id": user_id}, {"_id": 0})
    game = await _enrich_game_identity(flow.db, await flow.db.games.find_one({"id": game_id}, {"_id": 0}))
    return _profile_player_ids(user, game)


async def save_profile_ids(flow, user: dict, game_ids: dict) -> None:
    flow.act_as(user)
    saved = await flow.patch("/api/users/me", json={"game_ids": game_ids})
    assert saved.status_code == 200, saved.text


@pytest.mark.asyncio
async def test_real_path_a_source_change_keeps_quiet_when_the_value_is_readable_afterwards(flow):
    admin_user = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin_user)
    world = await shooter_world(flow)
    main, other = world["main"], world["other"]
    plain = (await flow.post("/api/games", json={"name": "Probe Shooter 6", "kind": "edition", "parent_game_id": main["id"],
                                                 "identity_source_game_id": main["id"]})).json()
    player = await flow.add_user(role="user", name="Probe Beide")
    await save_profile_ids(flow, player, {main["slug"]: {"activision_id": "probe#1"}, other["slug"]: {"activision_id": "probe#1"}})
    assert (await read_ids(flow, player["id"], plain["id"]))["activision_id"] == "probe#1"

    flow.act_as(admin_user)
    moved = await flow.patch(f"/api/games/{plain['id']}", json={"identity_source_game_id": other["id"]})
    assert moved.status_code == 200, moved.text
    assert (await read_ids(flow, player["id"], plain["id"]))["activision_id"] == "probe#1"
    assert await flow.db.audit_logs.count_documents({"action": "game.player_id_fields.remove"}) == 0


@pytest.mark.asyncio
async def test_real_path_a_new_name_keeps_the_slug_and_the_ids(flow):
    admin_user = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin_user)
    world = await shooter_world(flow)
    main, version = world["main"], world["version"]
    player = await flow.add_user(role="user", name="Probe Spieler")
    await save_profile_ids(flow, player, {main["slug"]: {"activision_id": "probe#2", "plattform": "PC"}})
    assert await read_ids(flow, player["id"], version["id"]) == {"activision_id": "probe#2", "plattform": "PC"}

    flow.act_as(admin_user)
    # So schickt das Formular „Allgemein“: neuer Name, die Adresse unverändert - und einmal nur der Name.
    for body in ({"name": "Probe Shooter Neu", "slug": main["slug"]}, {"name": "Probe Shooter Neuer"}):
        renamed = await flow.patch(f"/api/games/{main['id']}", json=body)
        assert renamed.status_code == 200, renamed.text
        assert renamed.json()["slug"] == main["slug"]
    assert await read_ids(flow, player["id"], version["id"]) == {"activision_id": "probe#2", "plattform": "PC"}


@pytest.mark.asyncio
async def test_real_path_an_explicit_slug_change_with_stored_ids_needs_a_confirmation(flow):
    admin_user = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin_user)
    world = await shooter_world(flow)
    main, version = world["main"], world["version"]
    player = await flow.add_user(role="user", name="Probe Spieler")
    await save_profile_ids(flow, player, {main["slug"]: {"activision_id": "probe#3", "plattform": "Konsole"}})

    flow.act_as(admin_user)
    refused = await flow.patch(f"/api/games/{main['id']}", json={"slug": "probe-shooter-neu"})
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"]["keys"] == {"activision_id": 1, "plattform": 1}
    assert (await flow.get(f"/api/games/{main['id']}")).json()["slug"] == main["slug"]
    done = await flow.patch(f"/api/games/{main['id']}", json={"slug": "probe-shooter-neu", "confirm_removed_keys": ["activision_id", "plattform"]})
    assert done.status_code == 200, done.text
    assert done.json()["slug"] == "probe-shooter-neu"
    assert await read_ids(flow, player["id"], version["id"]) == {}, "genau das hat die Rückfrage angekündigt"
    log = await flow.db.audit_logs.find_one({"action": "game.player_id_fields.remove", "target_id": main["id"]}, {"_id": 0})
    assert log["data"] == {"keys": {"activision_id": 1, "plattform": 1}}
    # Ohne gespeicherte IDs unter der Adresse geht ein Slugwechsel ohne Frage.
    other = world["other"]
    quiet = await flow.patch(f"/api/games/{other['id']}", json={"slug": "probe-anderes-neu"})
    assert quiet.status_code == 200, quiet.text


@pytest.mark.asyncio
async def test_a_legacy_slug_survives_the_form_sending_it_back_normalized(flow):
    await admin(flow)
    await flow.db.games.insert_one({"id": "legacy", "slug": "Probe_Alt", "name": "Probe Alt", "player_id_fields": [field("probe")]})
    await player_with(flow, "Probe Alt", {"Probe_Alt": {"probe": "alt#1"}})
    saved = await flow.patch("/api/games/legacy", json={"name": "Probe Alt Neu", "slug": "probe-alt"})
    assert saved.status_code == 200, saved.text
    assert saved.json()["slug"] == "Probe_Alt"
