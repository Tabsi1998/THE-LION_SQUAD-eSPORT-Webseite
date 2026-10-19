"""Serien als neues Eltern-Objekt der Referenzen (#1741): Spur (Klammer, z. B. eine Rennliga) mit je einer Serie pro
Saison und Stufe. Der Vorstand (Bereich Redaktion) legt an, bearbeitet und archiviert - gelöscht wird nichts. Regeln
kommen als Kopie einer Punkteschema-Vorlage; ändert sich eine Regel, steigt die Version, das Protokoll hält es fest und
die gespeicherten Stände werden neu gerechnet. Nur erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import change_events, dolibarr_sync, migrations, reference_series  # noqa: E402

ADMIN = "/api/reference-series/admin"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _board(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    return admin


async def _lineage(flow, **fields) -> dict:
    body = {"title": "Probe Racing F1", "kind": "racing", "organizer": "Probe Liga", "label": "F1", **fields}
    response = await flow.post(f"{ADMIN}/lineages", json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def _series(flow, lineage_id: str, **fields) -> dict:
    body = {"lineage_id": lineage_id, "season": "2026", **fields}
    response = await flow.post(f"{ADMIN}/series", json=body)
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------- Anlegen
@pytest.mark.asyncio
async def test_the_board_creates_all_three_kinds_with_rules_copied_from_a_template(flow):
    await _board(flow)
    schemes = (await flow.get(f"{ADMIN}/points-schemes")).json()["schemes"]
    by_id = {scheme["id"]: scheme for scheme in schemes}
    assert {"organizer", "formula_1", "team_league_3_1_0"} <= set(by_id)
    # Vollständig, damit das Formular keine eigenen Standards kennen muss.
    assert by_id["organizer"]["rules"]["tiebreakers"] == ["countback", "latest_result"]
    assert by_id["team_league_3_1_0"]["rules"]["count_mode"] == "all"

    racing = await _lineage(flow)
    tour = await _lineage(flow, title="Probe Monatscup", kind="series", label="4vs4")
    league = await _lineage(flow, title="Probe Team-Liga", kind="team_league", label="5vs5")
    assert (racing["slug"], tour["slug"], league["slug"]) == ("probe-racing-f1", "probe-monatscup", "probe-team-liga")

    f1 = await _series(flow, racing["id"], tier="Division 1", points_scheme_id="formula_1", default_weekday=2,
                       default_time="20:30")
    cup = await _series(flow, tour["id"], points_scheme_id="organizer")
    table = await _series(flow, league["id"], season="Saison 3", points_scheme_id="team_league_3_1_0",
                          team_name="Löwen Probe")
    assert (f1["season_slug"], cup["season_slug"], table["season_slug"]) == ("2026-division-1", "2026", "saison-3")
    assert f1["rules"]["points_by_place"] == [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] and f1["rules_version"] == 1
    assert cup["rules"]["points_mode"] == "organizer"
    assert table["rules"]["match_points"] == {"win": 3, "draw": 1, "loss": 0}
    # Standard: Einträge eines Captains sind Entwürfe, der Vorstand gibt frei (Entscheidung 7).
    assert (f1["status"], f1["publish_mode"], f1["visibility"]) == ("planned", "review", "public")
    assert (f1["default_weekday"], f1["default_time"]) == (2, "20:30")

    # Die Vorlage ist kopiert, nicht verknüpft: eine geänderte Vorlage ändert die Serie nicht.
    await flow.db.settings.update_one({"id": "points_schemes", "schemes.id": "formula_1"},
                                      {"$set": {"schemes.$.rules.points_by_place": [1]}})
    stored = await flow.db.reference_series.find_one({"id": f1["id"]})
    assert stored["rules"]["points_by_place"][:2] == [25, 18]

    overview = (await flow.get(ADMIN)).json()
    assert [(item["title"], [series["season_slug"] for series in item["series"]]) for item in overview["lineages"]] == [
        ("Probe Monatscup", ["2026"]), ("Probe Racing F1", ["2026-division-1"]), ("Probe Team-Liga", ["saison-3"])]
    assert overview["default_rules"]["count_mode"] == "all" and overview["default_rules"]["dnf_points"] == 0
    assert overview["points_schemes"][0]["rules"]["bonuses"]["fastest_lap"] == {"points": 0, "max_place": None}


@pytest.mark.asyncio
async def test_a_second_season_of_the_same_name_gets_its_own_address(flow):
    await _board(flow)
    lineage = await _lineage(flow)
    first = await _series(flow, lineage["id"])
    second = await _series(flow, lineage["id"])
    other = await _series(flow, (await _lineage(flow, title="Probe Racing GT"))["id"])
    assert (first["season_slug"], second["season_slug"], other["season_slug"]) == ("2026", "2026-2", "2026")


@pytest.mark.asyncio
async def test_invalid_input_is_refused_in_plain_words(flow):
    await _board(flow)
    lineage = await _lineage(flow)
    unknown = await flow.post(f"{ADMIN}/series", json={"lineage_id": "fehlt", "season": "2026"})
    assert unknown.status_code == 404
    broken = await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2026",
                                                      "rules": {"count_mode": "best_n", "count_n": 0}})
    assert broken.status_code == 422 and "count_n" in broken.text
    late = await flow.post(f"{ADMIN}/series", json={"lineage_id": lineage["id"], "season": "2026", "default_time": "25:00"})
    assert late.status_code == 422
    no_game = await flow.post(f"{ADMIN}/lineages", json={"title": "Ohne Spiel", "kind": "racing", "game_id": "gibt-es-nicht"})
    assert no_game.status_code == 404


# ---------------------------------------------------------------- Bearbeiten und Regeländerung
@pytest.mark.asyncio
async def test_editing_keeps_the_rules_version_until_a_rule_changes(flow):
    admin = await _board(flow)
    lineage = await _lineage(flow)
    series = await _series(flow, lineage["id"], points_scheme_id="formula_1")

    renamed = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"tier": "Division 2", "status": "active"})
    assert renamed.status_code == 200, renamed.text
    assert (renamed.json()["rules_version"], renamed.json()["status"], renamed.json()["season_slug"]) == (1, "active", "2026-division-2")
    same = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"rules": series["rules"]})
    assert same.json()["rules_version"] == 1

    rules = {**series["rules"], "count_mode": "drop_n", "count_n": 1}
    changed = await flow.patch(f"{ADMIN}/series/{series['id']}", json={"rules": rules, "rules_note": "Ein Streichergebnis"})
    body = changed.json()
    assert (body["rules_version"], body["rules"]["count_mode"], body["rules_note"]) == (2, "drop_n", "Ein Streichergebnis")
    assert body["rules_changed_at"]
    log = await flow.db.audit_logs.find_one({"action": "reference_series.rules_change", "target_id": series["id"]})
    assert log["actor_id"] == admin["id"] and log["data"]["version"] == 2

    lineage_edit = await flow.patch(f"{ADMIN}/lineages/{lineage['id']}", json={"title": "Probe Racing Liga"})
    assert lineage_edit.json()["slug"] == "probe-racing-liga" and lineage_edit.json()["slug_history"] == ["probe-racing-f1"]


@pytest.mark.asyncio
async def test_a_rule_change_recalculates_the_stored_standings(flow):
    await _board(flow)
    lineage = await _lineage(flow)
    series = await _series(flow, lineage["id"], points_scheme_id="formula_1")
    sid = series["id"]
    await flow.db.reference_rounds.insert_many([
        {"id": "lauf-1", "series_id": sid, "order": 1, "status": "scored", "counts": True},
        {"id": "lauf-2", "series_id": sid, "order": 2, "status": "scored", "counts": True},
    ])
    await flow.db.reference_participants.insert_many([
        {"id": "anna", "series_id": sid, "name": "Anna Probe", "link": "member"},
        {"id": "bert", "series_id": sid, "name": "Bert Beispiel", "link": "external"},
    ])
    await flow.db.reference_round_results.insert_many([
        {"id": "blatt-1", "series_id": sid, "round_id": "lauf-1", "status": "published", "version": 1,
         "rows": [{"participant_id": "anna", "place": 1}, {"participant_id": "bert", "place": 2}]},
        {"id": "blatt-2", "series_id": sid, "round_id": "lauf-2", "status": "published", "version": 1,
         "rows": [{"participant_id": "bert", "place": 1}, {"participant_id": "anna", "place": 10}]},
    ])
    assert await reference_series.recompute_standings(flow.db, await flow.db.reference_series.find_one({"id": sid})) == 2

    async def latest() -> list[tuple]:
        row = await flow.db.reference_standings.find_one({"series_id": sid, "round_id": "lauf-2", "scope": "drivers"})
        return [(item["participant_id"], item["points"]) for item in row["rows"]], row["rules_version"]

    # Anna 25 + 1, Bert 18 + 25.
    assert await latest() == ([("bert", 43), ("anna", 26)], 1)
    rules = {**series["rules"], "count_mode": "best_n", "count_n": 1}
    await flow.patch(f"{ADMIN}/series/{sid}", json={"rules": rules})
    # Nur das beste Ergebnis zählt: beide 25 - Gleichstand, Bert hat dazu einen zweiten Platz (Vorrang nach Plätzen).
    assert await latest() == ([("bert", 25), ("anna", 25)], 2)


# ---------------------------------------------------------------- Archivieren statt Löschen
@pytest.mark.asyncio
async def test_archiving_keeps_everything_and_can_be_undone(flow):
    await _board(flow)
    lineage = await _lineage(flow)
    series = await _series(flow, lineage["id"], status="active")

    archived = await flow.post(f"{ADMIN}/series/{series['id']}/archive")
    assert archived.status_code == 200 and archived.json()["status"] == "archived" and archived.json()["archived_at"]
    restored = await flow.post(f"{ADMIN}/series/{series['id']}/restore")
    assert (restored.json()["status"], restored.json()["archived_at"]) == ("active", None)

    gone = await flow.post(f"{ADMIN}/lineages/{lineage['id']}/archive")
    assert gone.json()["is_archived"] is True
    overview = (await flow.get(ADMIN)).json()
    assert [item["id"] for item in overview["lineages"]] == [lineage["id"]], "archiviert bleibt sichtbar in der Verwaltung"
    back = await flow.post(f"{ADMIN}/lineages/{lineage['id']}/restore")
    assert back.json()["is_archived"] is False

    removal = await flow.delete(f"{ADMIN}/series/{series['id']}")
    assert removal.status_code == 405
    assert await flow.db.reference_series.count_documents({}) == 1


# ---------------------------------------------------------------- Rechte
@pytest.mark.asyncio
async def test_only_the_content_area_manages_series(flow):
    await migrations.migrate_points_scheme_templates(flow.db)
    for role in ("player", "tournament_admin"):
        flow.act_as(await flow.add_user(role=role))
        assert (await flow.get(ADMIN)).status_code == 403
        created = await flow.post(f"{ADMIN}/lineages", json={"title": "x", "kind": "racing"})
        assert created.status_code == 403
    flow.act_as(None)
    assert (await flow.get(ADMIN)).status_code == 401


# ---------------------------------------------------------------- Referenz zeigt auf eine Serie
@pytest.mark.asyncio
async def test_a_reference_can_belong_to_a_series(flow):
    await _board(flow)
    series = await _series(flow, (await _lineage(flow))["id"])
    created = await flow.post("/api/references", json={"title": "Probe Finale", "series_id": series["id"]})
    assert created.status_code == 200 and created.json()["series_id"] == series["id"]
    wrong = await flow.post("/api/references", json={"title": "Irgendwo", "series_id": "gibt-es-nicht"})
    assert wrong.status_code == 404
    cleared = await flow.patch(f"/api/references/{created.json()['id']}", json={"series_id": None})
    assert cleared.json()["series_id"] is None


# ---------------------------------------------------------------- Vorlagen
@pytest.mark.asyncio
async def test_the_migration_adds_only_missing_templates_and_never_results(flow):
    db = flow.db
    await db.settings.insert_one({"id": "points_schemes", "schemes": [
        {"id": "formula_1", "name": "Eigene Fassung", "kinds": ["racing"], "rules": {"points_by_place": [9]}}]})
    await migrations.migrate_points_scheme_templates(db)
    await migrations.migrate_points_scheme_templates(db)
    schemes = (await db.settings.find_one({"id": "points_schemes"}))["schemes"]
    assert [scheme["id"] for scheme in schemes].count("formula_1") == 1
    assert next(scheme for scheme in schemes if scheme["id"] == "formula_1")["name"] == "Eigene Fassung"
    assert {"organizer", "team_league_3_1_0"} <= {scheme["id"] for scheme in schemes}
    for name in ("reference_series", "reference_rounds", "reference_round_results", "reference_standings"):
        assert await getattr(db, name).count_documents({}) == 0, name
    assert migrations.MIGRATIONS[-1][1] == "reference_points_schemes"


# ---------------------------------------------------------------- Nebenstellen
@pytest.mark.asyncio
async def test_merging_duplicate_profiles_moves_series_links(flow):
    db = flow.db
    await db.club_member_profiles.insert_many([
        {"id": "gepflegt", "display_name": "Anna Probe", "source": "editorial", "created_at": "2026-01-01"},
        {"id": "doppel", "display_name": "Anna Probe", "source": "dolibarr", "created_by": "dolibarr-sync",
         "updated_by": "dolibarr-sync", "created_at": "2026-02-01"},
    ])
    await db.reference_participants.insert_one({"id": "t1", "series_id": "s1", "name": "Anni", "link": "member", "profile_id": "doppel"})
    await db.reference_aliases.insert_one({"id": "a1", "name_normalized": "anni", "target": "member", "profile_id": "doppel"})
    primary = await db.club_member_profiles.find_one({"id": "gepflegt"}, {"_id": 0})
    dup = await db.club_member_profiles.find_one({"id": "doppel"}, {"_id": 0})
    await dolibarr_sync._merge_duplicate_profile(db, primary, dup)
    assert (await db.reference_participants.find_one({"id": "t1"}))["profile_id"] == "gepflegt"
    assert (await db.reference_aliases.find_one({"id": "a1"}))["profile_id"] == "gepflegt"


@pytest.mark.asyncio
async def test_deleting_an_account_cuts_the_series_links_of_its_own_profile(flow):
    db = flow.db
    paula = await flow.add_user(role="player", name="paula")
    await db.club_member_profiles.insert_many([
        {"id": "selbst", "user_id": paula["id"], "source": "member", "display_name": "Paula", "is_active": True},
        {"id": "akte", "user_id": paula["id"], "source": "dolibarr", "display_name": "Paula P.", "is_active": True},
    ])
    await db.reference_participants.insert_many([
        {"id": "eigen", "series_id": "s1", "name": "PaulaRacing", "link": "member", "profile_id": "selbst", "name_hidden": False},
        {"id": "verein", "series_id": "s1", "name": "Paula P.", "link": "member", "profile_id": "akte", "name_hidden": False},
        {"id": "fremd", "series_id": "s1", "name": "Otto O.", "link": "member", "profile_id": "profil-otto", "name_hidden": False},
    ])
    await db.reference_aliases.insert_many([
        {"id": "alias-eigen", "name_normalized": "paularacing", "target": "member", "profile_id": "selbst"},
        {"id": "alias-verein", "name_normalized": "paula p", "target": "member", "profile_id": "akte",
         "confirmed_by": "vorstand-vera"},
        {"id": "alias-fremd", "name_normalized": "otto o", "target": "member", "profile_id": "profil-otto"},
    ])
    await db.reference_series_staff.insert_one({"id": "captain", "series_id": "s1", "user_id": paula["id"], "role": "captain"})
    flow.act_as(paula)
    export = (await flow.get("/api/dsgvo/export-my-data")).json()
    assert [row["id"] for row in export["reference_series_staff"]] == ["captain"]
    # Teilnahmen und Aliase über die eigenen Vereinsprofile (#1741) - fremde nicht, und nicht, wer bestätigt hat.
    assert sorted(row["id"] for row in export["reference_participations"]) == ["eigen", "verein"]
    assert sorted(row["id"] for row in export["reference_aliases"]) == ["alias-eigen", "alias-verein"]
    assert "Otto" not in str(export) and "vorstand-vera" not in str(export)

    erased = await flow.post("/api/dsgvo/anonymize-me")
    assert erased.status_code == 200
    own = await db.reference_participants.find_one({"id": "eigen"})
    assert (own["profile_id"], own["link"], own["name_hidden"]) == (None, "external", True)
    kept = await db.reference_participants.find_one({"id": "verein"})
    assert (kept["profile_id"], kept["link"]) == ("akte", "member"), "der Eintrag aus der Mitgliederverwaltung gehört dem Verein"
    assert {row["id"] async for row in db.reference_aliases.find({}, {"_id": 0, "id": 1})} == {"alias-verein", "alias-fremd"}
    assert await db.reference_series_staff.count_documents({}) == 0


def test_the_development_reset_clears_every_series_collection():
    from reset_data import RESET_COLLECTIONS
    from services import personal_data

    series = {name for name in set(personal_data.PERSONAL) | personal_data.CLUB_CONTENT if name.startswith("reference_")}
    assert len(series) == 9 and not sorted(series - set(RESET_COLLECTIONS))


def test_series_changes_reach_public_pages_as_their_own_resource():
    assert change_events._public_resource_from_path("/api/reference-series/admin/series/s1") == "reference-series"
