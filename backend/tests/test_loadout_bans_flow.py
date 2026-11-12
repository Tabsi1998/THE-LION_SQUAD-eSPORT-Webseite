"""Sperrliste der Season (docs/LIGA.md, C.4 #2218) - durch die echten Routen.

Alles ist erlaubt außer der Sperrliste, auch je Modus; an einer Waffe gelten alle Aufsätze oder einzelne sind ausgenommen. Jede
Speicherung ist eine unveränderliche Version, die Season ist Vorlage, Staffel und Spiel halten ihre Version fest. Rechte über den Bereich
Ligen bzw. die Zuständigkeit ``season``. Erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import GAME_ID, duel, ids, two_nil, world as match_world  # noqa: E402
from league_rules_world import ADMIN_LEAGUES, make_bare_world, make_world  # noqa: E402
from league_start_world import ok  # noqa: E402
from loadout_world import IMAGE, add_library, attachments, bans_url, item, save_bans, standard  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def ready(flow, **season) -> dict:
    w = await make_world(flow, **season)
    await add_library(flow, w)
    return w


# ---------------------------------------------------------------- Speichern und Versionen

@pytest.mark.asyncio
async def test_a_saved_list_is_a_snapshot_in_versions(flow):
    w = await ready(flow)
    saved = ok(await save_bans(flow, w, standard(w), note="Erste Fassung", expected_version=0))
    assert saved["version"] == 1 and saved["staffeln_to_sync"] == 1 and saved["note"] == "Erste Fassung"
    rows = [(row["kind"], row["name"], row["category_label"], row["mode_labels"], [a["name"] for a in row["attachments"]])
            for row in saved["entries"]]
    assert rows == [("item", "Blitz 9", "Waffen", [], []), ("item", "Leise Sohlen", "Perks", ["Suchen"], []),
                    ("attachments", "Donner 4", "Waffen", [], ["Griff", "Lauf"])]
    assert saved["entries"][0]["image_url"] == IMAGE

    # Umbenennen in der Bibliothek ändert die Version nicht - die Verwaltung sieht es als „geändert“.
    ok(await flow.patch(f"{w['library_url']}/{w['items']['Blitz 9']['id']}", json={"name": "Blitz Neu"}))
    view = ok(await flow.get(bans_url(w)))
    assert view["list"]["entries"][0]["name"] == "Blitz 9"
    assert view["list"]["outdated_item_ids"] == [w["items"]["Blitz 9"]["id"]]
    assert [row["version"] for row in view["versions"]] == [1]
    assert {row["label"] for row in view["categories"]} == {"Waffen", "Aufsätze", "Perks"}

    second = ok(await save_bans(flow, w, standard(w)[:1], expected_version=1))
    assert second["version"] == 2 and second["entries"][0]["name"] == "Blitz Neu"
    stale = await save_bans(flow, w, standard(w), expected_version=1)
    assert stale.status_code == 409 and "neu laden" in stale.json()["detail"]
    first = await flow.db.loadout_bans.find_one({"scope": "league_season", "version": 1}, {"_id": 0})
    assert len(first["entries"]) == 3 and first["entries"][0]["name"] == "Blitz 9"
    audit = await flow.db.audit_logs.find_one({"action": "league.season.loadout_bans.save", "data.version": 2}, {"_id": 0})
    assert audit["target_id"] == w["season"]["id"] and audit["data"]["entries"] == 1


@pytest.mark.asyncio
async def test_each_entry_is_checked_with_a_german_sentence(flow):
    w = await ready(flow)
    cases = [
        ([], "mindestens einen Eintrag"),
        ([item(w, "Blitz 9"), item(w, "Blitz 9", ["suchen"])], "zweimal"),
        ([item(w, "Blitz 9", ["gibt-es-nicht"])], "Unbekannter Modus"),
        ([attachments(w, "Leise Sohlen", ["Griff"])], "keine Waffe"),
        ([attachments(w, "Donner 4", ["Rotpunkt"])], "passt nicht zu „Donner 4“"),
        # Ohne zugeordnete Waffe passt ein Aufsatz zu keiner (Obmann, 03.11.).
        ([attachments(w, "Donner 4", ["Kompensator"])], "keiner Waffe zugeordnet"),
        ([attachments(w, "Donner 4", [])], "mindestens einen Aufsatz"),
        ([attachments(w, "Donner 4", ["Blitz 9"])], "kein Aufsatz"),
        ([item(w, "Donner 4"), attachments(w, "Donner 4", ["Lauf"])], "in allen Modi gesperrt"),
        ([item(w, "Blitz 9", attachment_ids=[w["items"]["Griff"]["id"]])], "nur an einer Waffe"),
        ([{"item_id": "fremd", "kind": "item"}], "gehört nicht zu diesem Spiel"),
    ]
    for entries, words in cases:
        answer = await save_bans(flow, w, entries)
        assert answer.status_code == 422 and words in answer.json()["detail"], (entries, answer.text)
    # Ganz gesperrt nur in einem Modus: Aufsätze in den anderen dürfen einzeln dazu.
    ok(await save_bans(flow, w, [item(w, "Donner 4", ["stellung"]), attachments(w, "Donner 4", ["Lauf"], ["suchen"])]))
    assert await flow.db.loadout_bans.count_documents({}) == 1


@pytest.mark.asyncio
async def test_inactive_entries_stay_where_they_are_and_archived_ones_never_come_back(flow):
    w = await ready(flow)
    ok(await save_bans(flow, w, [item(w, "Blitz 9"), attachments(w, "Donner 4", ["Lauf"])]))
    for name in ("Blitz 9", "Lauf", "Leise Sohlen"):
        ok(await flow.patch(f"{w['library_url']}/{w['items'][name]['id']}", json={"status": "inactive"}))
    # Schon auf der Liste: bleibt beim nächsten Speichern erlaubt.
    ok(await save_bans(flow, w, [item(w, "Blitz 9"), attachments(w, "Donner 4", ["Lauf"])]))
    new = await save_bans(flow, w, [item(w, "Blitz 9"), item(w, "Leise Sohlen")])
    assert new.status_code == 422 and "inaktiv" in new.json()["detail"]
    ok(await flow.patch(f"{w['library_url']}/{w['items']['Blitz 9']['id']}", json={"status": "archived"}))
    gone = await save_bans(flow, w, [item(w, "Blitz 9")])
    assert gone.status_code == 422 and "archiviert" in gone.json()["detail"]
    library = ok(await flow.get(bans_url(w)))["library"]
    assert "Blitz 9" not in {row["name"] for row in library}
    assert {row["name"]: row["status"] for row in library}["Leise Sohlen"] == "inactive"


@pytest.mark.asyncio
async def test_an_inactive_mode_stays_on_an_entry_that_had_it(flow):
    w = await ready(flow)
    ok(await save_bans(flow, w, [item(w, "Blitz 9", ["suchen"])]))
    game = ok(await flow.get(f"/api/games/{w['game']['id']}"))
    modes = [{**mode, "status": "inactive"} if mode["mode"] == "suchen" else mode for mode in game["match_modes"]]
    ok(await flow.patch(f"/api/games/{w['game']['id']}", json={"match_modes": modes}))
    ok(await save_bans(flow, w, [item(w, "Blitz 9", ["suchen"]), item(w, "Leise Sohlen", ["suchen"])]))
    ok(await save_bans(flow, w, [item(w, "Leise Sohlen")]))
    refused = await save_bans(flow, w, [item(w, "Leise Sohlen", ["suchen"])])
    assert refused.status_code == 422


# ---------------------------------------------------------------- Rechte

async def holder(flow, w: dict, *capabilities: str) -> dict:
    person = await flow.add_user(name=f"Zuständig {new_id()[:6]}")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": w["league"]["id"], "user_id": person["id"],
                                           "capabilities": list(capabilities), "created_at": now_utc().isoformat()})
    return person


@pytest.mark.asyncio
async def test_reading_needs_any_duty_and_writing_needs_season(flow):
    w = await ready(flow)
    entries = standard(w)
    reader, writer = await holder(flow, w, "roster"), await holder(flow, w, "season")
    flow.act_as(reader)
    assert (await flow.get(bans_url(w))).status_code == 200
    saved, cleared = await flow.put(bans_url(w), json={"entries": entries}), await flow.delete(bans_url(w))
    assert (saved.status_code, cleared.status_code) == (403, 403)
    flow.act_as(writer)
    saved = await flow.put(bans_url(w), json={"entries": entries})
    assert ok(saved)["version"] == 1
    assert (await flow.get(f"{bans_url(w)}/compare?base=1&target=1")).status_code == 200
    for person in (await flow.add_user(name="Spieler"), await flow.add_user(role="tournament_admin", name="Turnierleitung")):
        flow.act_as(person)
        saved = await flow.put(bans_url(w), json={"entries": entries})
        assert (await flow.get(bans_url(w))).status_code == 403 and saved.status_code == 403


# ---------------------------------------------------------------- Vergleich und Entfernen

@pytest.mark.asyncio
async def test_two_versions_are_compared_row_by_row(flow):
    w = await ready(flow)
    ok(await save_bans(flow, w, standard(w)))
    ok(await save_bans(flow, w, [item(w, "Blitz 9", ["stellung"]), attachments(w, "Donner 4", ["Lauf"]), item(w, "Rotpunkt")]))
    diff = ok(await flow.get(f"{bans_url(w)}/compare?base=1&target=2"))
    assert [row["name"] for row in diff["added"]] == ["Rotpunkt"]
    assert [row["name"] for row in diff["removed"]] == ["Leise Sohlen"]
    changed = {row["name"]: row for row in diff["changed"]}
    assert changed["Blitz 9"]["modes"] == ["Stellung"] and changed["Blitz 9"]["before"]["modes"] == ["alle Modi"]
    assert changed["Donner 4"]["attachments"] == ["Lauf"] and changed["Donner 4"]["before"]["attachments"] == ["Griff", "Lauf"]
    assert diff["same"] is False and ok(await flow.get(f"{bans_url(w)}/compare?base=2&target=2"))["same"] is True
    assert (await flow.get(f"{bans_url(w)}/compare?base=1&target=9")).status_code == 404


@pytest.mark.asyncio
async def test_clearing_is_a_version_and_the_history_stays(flow):
    w = await ready(flow)
    ok(await save_bans(flow, w, standard(w)))
    flow.act_as(w["lead"])
    first = ok(await flow.delete(bans_url(w)))
    assert first["staffeln_to_sync"] == 1
    view = ok(await flow.get(bans_url(w)))
    assert view["list"] is None and [row["cleared"] for row in view["versions"]] == [True, False]
    again = ok(await flow.delete(bans_url(w)))
    assert again["staffeln_to_sync"] == 0, "ohne Liste passiert nichts"
    assert await flow.db.audit_logs.count_documents({"action": "league.season.loadout_bans.clear"}) == 1


# ---------------------------------------------------------------- Season → Staffel

async def staffel_list(flow, tid: str) -> dict | None:
    from services import loadout_bans

    return await loadout_bans.current(flow.db, "tournament", tid)


async def sync(flow, w: dict) -> list[dict]:
    flow.act_as(w["lead"])
    return ok(await flow.post(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}/sync"))["staffeln"]


@pytest.mark.asyncio
async def test_staffeln_get_the_list_on_transfer_and_on_creation(flow):
    w = await ready(flow)
    ok(await save_bans(flow, w, standard(w)))
    assert await staffel_list(flow, w["tid"]) is None, "erst beim Übertragen"
    rows = await sync(flow, w)
    assert "loadout_bans" in rows[0]["applied"] and "loadout_bans" in rows[0]["changed"]
    copied = await staffel_list(flow, w["tid"])
    assert copied["game_id"] == w["game"]["id"] and [row["name"] for row in copied["entries"]] == ["Blitz 9", "Leise Sohlen", "Donner 4"]
    again = await sync(flow, w)
    assert "loadout_bans" not in again[0]["changed"], "gleiche Liste: keine neue Version"

    flow.act_as(w["lead"])
    created = ok(await flow.post(f"{ADMIN_LEAGUES}/divisions/{w['division']['id']}/staffeln", json={}))
    fresh = await staffel_list(flow, created["tournament_id"])
    assert fresh and fresh["version"] == 1 and len(fresh["entries"]) == 3


@pytest.mark.asyncio
async def test_a_locked_staffel_still_gets_a_new_list_but_keeps_it_when_the_season_drops_it(flow):
    w = await ready(flow)
    ok(await save_bans(flow, w, standard(w)))
    await flow.db.tournaments.update_one({"id": w["tid"]}, {"$set": {"locked_at": now_utc().isoformat()}})
    await sync(flow, w)
    assert await staffel_list(flow, w["tid"])
    flow.act_as(w["lead"])
    ok(await flow.delete(bans_url(w)))
    rows = await sync(flow, w)
    assert any(row["group"] == "loadout_bans" and "behält" in row["reason"] for row in rows[0]["skipped"])
    assert await staffel_list(flow, w["tid"])
    await flow.db.tournaments.update_one({"id": w["tid"]}, {"$unset": {"locked_at": ""}})
    await sync(flow, w)
    assert await staffel_list(flow, w["tid"]) is None, "ohne Ergebnis und ungesperrt fällt die Kopie weg"


@pytest.mark.asyncio
async def test_deleting_a_season_takes_its_lists_along(flow):
    w = await make_bare_world(flow)
    await add_library(flow, w)
    ok(await save_bans(flow, w, standard(w)))
    flow.act_as(w["lead"])
    ok(await flow.client.request("DELETE", f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}", json={"reason": "Probe-Season entfernen"}))
    assert await flow.db.loadout_bans.count_documents({}) == 0


# ---------------------------------------------------------------- Öffentlich

@pytest.mark.asyncio
async def test_the_public_season_shows_the_list_without_internals(flow):
    w = await ready(flow)
    url = f"/api/leagues/{w['league']['slug']}/{w['season']['slug']}"
    flow.act_as(None)
    assert ok(await flow.get(url))["loadout_bans"] is None
    ok(await save_bans(flow, w, standard(w), note="intern"))
    flow.act_as(None)
    public = ok(await flow.get(url))["loadout_bans"]
    assert [row["name"] for row in public["entries"]] == ["Blitz 9", "Leise Sohlen", "Donner 4"]
    assert "note" not in public and "saved_by" not in public and "outdated_item_ids" not in public
    await flow.db.league_seasons.update_one({"id": w["season"]["id"]}, {"$set": {"visibility": "admins"}})
    assert (await flow.get(url)).status_code == 404


@pytest.mark.asyncio
async def test_the_note_of_an_entry_shows_only_in_the_admin_editor(flow):
    # #2302: Die Notiz der Bibliothek erscheint im Editor der Sperrliste, nie in Schnappschuss, Ligaseite oder erlaubter Ausrüstung.
    w = await ready(flow)
    flow.act_as(w["lead"])
    ok(await flow.patch(f"{w['library_url']}/{w['items']['Blitz 9']['id']}", json={"note": "Nur im Ranked-Modus"}))
    ok(await flow.patch(f"{w['library_url']}/{w['items']['Griff']['id']}", json={"note": "Schwer zu bekommen"}))
    ok(await save_bans(flow, w, standard(w)))
    library = {row["name"]: row for row in ok(await flow.get(bans_url(w)))["library"]}
    assert library["Blitz 9"]["note"] == "Nur im Ranked-Modus" and library["Griff"]["note"] == "Schwer zu bekommen"
    assert library["Donner 4"]["note"] is None
    stored = await flow.db.loadout_bans.find_one({"scope": "league_season"}, {"_id": 0})
    assert "Ranked" not in str(stored) and "Schwer" not in str(stored)
    flow.act_as(None)
    public = ok(await flow.get(f"/api/leagues/{w['league']['slug']}/{w['season']['slug']}"))
    assert "Ranked" not in str(public["loadout_bans"]) and "Schwer" not in str(public["loadout_bans"])
    assert "Ranked" not in str(public["allowed_equipment"]) and "Schwer" not in str(public["allowed_equipment"])


# ---------------------------------------------------------------- Das Spiel hält seine Version fest

async def bans_version(flow, tournament: dict, version: int, name: str) -> dict:
    doc = {"id": new_id(), "scope": "tournament", "scope_id": tournament["id"], "tournament_id": tournament["id"], "game_id": GAME_ID,
           "version": version, "cleared": False, "note": None, "created_at": now_utc().isoformat(), "created_by": "test",
           "entries": [{"kind": "item", "item_id": f"id-{name}", "name": name, "category": "waffen", "category_label": "Waffen",
                        "role": "weapon", "image_url": None, "modes": [], "mode_labels": [], "attachments": []}]}
    await flow.db.loadout_bans.insert_one(dict(doc))
    return doc


async def confirm_result(flow, w: dict) -> None:
    flow.act_as(w["users"]["Kapitaen"])
    ok(await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila"))))
    flow.act_as(w["users"]["Falke1"])
    ok(await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Falke1", "Falke2"), side="reg_h")))


@pytest.mark.asyncio
async def test_a_finished_match_keeps_its_version_when_the_staffel_gets_a_new_one(flow):
    from services import loadout_bans

    w = await match_world(flow)
    first = await bans_version(flow, w["tournament"], 1, "Blitz 9")
    await confirm_result(flow, w)
    match = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert match["status"] == "completed" and match["loadout_ban_id"] == first["id"]

    second = await bans_version(flow, w["tournament"], 2, "Donner 4")
    match = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert match["loadout_ban_id"] == first["id"]
    held = await loadout_bans.effective(flow.db, w["tournament"], match)
    assert (held["id"], held["origin"], held["entries"][0]["name"]) == (first["id"], "match", "Blitz 9")
    later = await duel(flow, w["tournament"], w["reg_a"], w["reg_h"], matchday=2)
    assert (await loadout_bans.effective(flow.db, w["tournament"], later))["id"] == second["id"]

    # Eine Korrektur lässt die Version stehen.
    from services.v2_result_submission import submit_v2_result

    await submit_v2_result(flow.db, match, [{"registration_id": w["reg_a"]["id"], "rank": 1, "score": 2},
                                            {"registration_id": w["reg_h"]["id"], "rank": 2, "score": 1}],
                           actor_id=w["staff"]["id"], proof_url=None, note=None, force=True, audit_action="match.result.force",
                           reason="Korrektur im Test")
    assert (await flow.db.matches_v2.find_one({"id": w["match"]["id"]}))["loadout_ban_id"] == first["id"]


@pytest.mark.asyncio
async def test_undoing_the_result_forgets_the_list_version(flow):
    w = await match_world(flow)
    await bans_version(flow, w["tournament"], 1, "Blitz 9")
    await confirm_result(flow, w)
    flow.act_as(w["staff"])
    ok(await flow.post(f"/api/matches/{w['match']['id']}/result/undo", json={}))
    undone = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    # Mit dem Ergebnis geht auch die erlaubte Ausrüstung (#2287) wieder weg.
    assert "loadout_ban_id" not in undone and "loadout_allowed_id" not in undone


@pytest.mark.asyncio
async def test_a_finished_match_without_a_list_keeps_having_none(flow):
    """Ohne Liste beim Ergebnis hält das Spiel ausdrücklich „keine“ fest - eine später übertragene Liste gilt dafür nicht (Review C.4)."""
    from services import loadout_bans

    w = await match_world(flow)
    await confirm_result(flow, w)
    stored = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert "loadout_ban_id" in stored and stored["loadout_ban_id"] is None

    await bans_version(flow, w["tournament"], 1, "Blitz 9")
    assert await loadout_bans.effective(flow.db, w["tournament"], stored) is None
    later = await duel(flow, w["tournament"], w["reg_a"], w["reg_h"], matchday=2)
    assert (await loadout_bans.effective(flow.db, w["tournament"], later))["entries"][0]["name"] == "Blitz 9"
    # Altbestand: ein fertiges Spiel von vor C.4 (ohne Vermerk) zeigt keine Liste.
    old = {**later, "id": "alt", "status": "completed"}
    assert await loadout_bans.effective(flow.db, w["tournament"], old) is None


@pytest.mark.asyncio
async def test_a_failing_stamp_is_not_swallowed(flow, monkeypatch):
    from services import loadout_bans

    w = await match_world(flow)

    async def broken(*_args, **_kwargs):
        raise RuntimeError("Datenbank weg")

    monkeypatch.setattr(loadout_bans, "current", broken)
    with pytest.raises(RuntimeError):
        await loadout_bans.match_stamp(flow.db, w["match"])


@pytest.mark.asyncio
async def test_other_formats_never_get_the_field(flow):
    w = await match_world(flow)
    tournament, _users, regs = await flow.with_participants(2, game_id=GAME_ID)
    await flow.start(tournament)
    await bans_version(flow, tournament, 1, "Blitz 9")
    match = await duel(flow, tournament, regs[0], regs[1])
    from services.v2_result_submission import submit_v2_result

    rows = [{"registration_id": regs[0]["id"], "rank": 1, "score": 2}, {"registration_id": regs[1]["id"], "rank": 2, "score": 0}]
    await submit_v2_result(flow.db, match, rows, actor_id=w["staff"]["id"], proof_url=None, note=None, force=False,
                           audit_action="match.result.submit")
    stored = await flow.db.matches_v2.find_one({"id": match["id"]}, {"_id": 0})
    assert stored["status"] == "completed" and "loadout_ban_id" not in stored


# ---------------------------------------------------------------- Stempel vor dem ersten Schreiben (Review C.4)

@pytest.mark.asyncio
async def test_the_app_confirmation_stamps_the_list(flow):
    w = await match_world(flow)
    first = await bans_version(flow, w["tournament"], 1, "Blitz 9")
    flow.act_as(w["users"]["Kapitaen"])
    ok(await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila"))))
    flow.act_as(w["users"]["Falke1"])
    ok(await flow.post(f"/api/matches/{w['match']['id']}/report", json={"results": two_nil(w)["results"]}))
    stored = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert stored["status"] == "completed" and stored["loadout_ban_id"] == first["id"]


@pytest.mark.asyncio
async def test_the_48_hour_rule_stamps_the_list(flow):
    from datetime import timedelta

    from services.match_deadline_sweep import _auto_confirm

    w = await match_world(flow)
    first = await bans_version(flow, w["tournament"], 1, "Blitz 9")
    flow.act_as(w["users"]["Kapitaen"])
    ok(await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila"))))
    assert await _auto_confirm(flow.db, w["tournament"], w["match"]["id"], None, now_utc() + timedelta(days=8)) == 1
    stored = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert stored["status"] == "completed" and stored["loadout_ban_id"] == first["id"]


@pytest.mark.asyncio
async def test_a_failing_stamp_writes_nothing(flow, monkeypatch):
    """Scheitert das Ermitteln, bleibt das Spiel, wie es war - kein Bericht, kein Folgespiel, kein halbes Ergebnis."""
    from services import loadout_bans
    from services.v2_result_submission import submit_v2_result

    w = await match_world(flow)
    await bans_version(flow, w["tournament"], 1, "Blitz 9")
    before = await flow.db.matches_v2.find({}, {"_id": 0}).sort("id", 1).to_list(None)

    async def broken(*_args, **_kwargs):
        raise RuntimeError("Datenbank weg")

    monkeypatch.setattr(loadout_bans, "current", broken)
    rows = two_nil(w)["results"]
    with pytest.raises(RuntimeError):
        await submit_v2_result(flow.db, w["match"], rows, actor_id=w["staff"]["id"], proof_url=None, note=None, force=False,
                               audit_action="match.result.submit")
    assert await flow.db.match_reports_v2.count_documents({}) == 0
    assert await flow.db.matches_v2.find({}, {"_id": 0}).sort("id", 1).to_list(None) == before
