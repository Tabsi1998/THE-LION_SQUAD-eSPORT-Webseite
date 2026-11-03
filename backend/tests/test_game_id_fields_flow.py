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
    assert "„PSN-ID“" in refused.json()["detail"] and "1 Person" in refused.json()["detail"]
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


@pytest.mark.asyncio
async def test_inherited_profiles_and_league_rosters_count_once_per_person(flow):
    await admin(flow)
    game = await game_with_psn(flow)
    edition = (await flow.post("/api/games", json={"name": "Probe Konsole 2", "kind": "edition", "parent_game_id": game["id"]})).json()
    own = (await flow.post("/api/games", json={"name": "Probe Konsole 3", "kind": "edition", "parent_game_id": game["id"],
                                               "inherit_player_ids": False})).json()
    first = await player_with(flow, "Probe Erbe", {edition["slug"]: {"PSN-ID": "erbe"}})
    await player_with(flow, "Probe Eigen", {own["slug"]: {"PSN-ID": "eigen"}})
    second = await flow.add_user(role="user", name="Probe Kader")
    await flow.db.league_rosters.insert_many([
        {"id": "r1", "season_id": "s1", "user_id": second["id"], "game_id": edition["id"], "player_ids": {"PSN-ID": "kader"}},
        {"id": "r2", "season_id": "s1", "user_id": first["id"], "game_id": edition["id"], "player_ids": {"PSN-ID": "erbe"}},
    ])
    refused = await flow.patch(f"/api/games/{game['id']}", json={"player_id_fields": []})
    assert refused.status_code == 409
    assert "2 Personen" in refused.json()["detail"], "die Version ohne Erbe zählt nicht, Erbe und Kader je Person einmal"