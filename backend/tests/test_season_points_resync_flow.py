"""Jahreswertung (#2123): Punkte nach einer Korrektur nachziehen, keine Doppelpunkte, eine aktive Wertung.

- TA22: erneutes Veröffentlichen gleicht die Jahrespunkte eines Turniers an die neue Rangfolge an - auch nach einem
  Wechsel von Mini/Normal/Major bleibt je Person bzw. Team ein Eintrag; Gewicht 0 nimmt die Punkte zurück.
- Migration 18 entfernt vorhandene Doppel-Einträge (Trockenlauf zählt, Anwenden ist wiederholbar).
- ER7–ER11: eine aktive Wertung, Abschließen nur über den Knopf, Löschen nur als Entwurf ohne Punkte, Korrekturen mit
  Grund, die Startseite zeigt ohne aktive Wertung keine.
"""
import io
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


class Placements:
    """Stellt die Rangfolge des Turniers nach - die Rechnung dahinter ist hier nicht Thema."""

    def __init__(self):
        self.rows: list[dict] = []

    def __call__(self, _snapshot, _regs, tournament=None):
        return [dict(row) for row in self.rows]


async def setup(flow, monkeypatch, *, people=3, **fields):
    from routes import tournament_lifecycle_routes

    placements = Placements()
    monkeypatch.setattr(tournament_lifecycle_routes, "placement_rows_for_structure", placements)
    await flow.db.seasons.insert_one({"id": "s-1", "slug": "saison-1", "name": "Saison 1", "status": "active",
                                      "start_date": "2026-01-01T00:00:00"})
    tournament = await flow.create_tournament(title="Herbst-Cup", status="completed", **fields)
    users, regs = [], []
    for index in range(people):
        user = await flow.add_user(name=f"spieler{index + 1}")
        users.append(user)
        regs.append(await flow.register(tournament, user))
    flow.act_as(await flow.add_staff())
    return tournament, users, regs, placements


async def set_status(flow, tournament, status):
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": status, "force": True})
    assert response.status_code == 200, response.text


async def rows(flow, tid):
    found = await flow.db.season_points.find({"source_id": tid}, {"_id": 0}).to_list(50)
    return sorted((row["user_id"], row["source_type"], row["rank"], row["season_id"]) for row in found)


@pytest.mark.asyncio
async def test_a_republish_after_a_correction_follows_the_new_ranking(flow, monkeypatch):
    tournament, (anna, bert, cleo), regs, placements = await setup(flow, monkeypatch)
    placements.rows = [{"registration_id": regs[0]["id"], "user_id": anna["id"], "rank": 1},
                       {"registration_id": regs[1]["id"], "user_id": bert["id"], "rank": 2}]
    await set_status(flow, tournament, "results_published")
    assert await rows(flow, tournament["id"]) == sorted([
        (anna["id"], "tournament", 1, "s-1"), (bert["id"], "tournament", 2, "s-1"), (cleo["id"], "tournament", None, "s-1")])
    first = await flow.db.season_points.find_one({"user_id": anna["id"]}, {"_id": 0})

    # Korrektur: Bert hat gewonnen, Cleo wird Zweite, Anna nur Teilnahme.
    await set_status(flow, tournament, "completed")
    placements.rows = [{"registration_id": regs[1]["id"], "user_id": bert["id"], "rank": 1},
                       {"registration_id": regs[2]["id"], "user_id": cleo["id"], "rank": 2}]
    await set_status(flow, tournament, "results_published")

    assert await rows(flow, tournament["id"]) == sorted([
        (anna["id"], "tournament", None, "s-1"), (bert["id"], "tournament", 1, "s-1"), (cleo["id"], "tournament", 2, "s-1")])
    again = await flow.db.season_points.find_one({"user_id": anna["id"]}, {"_id": 0})
    assert again["id"] == first["id"] and again["total_points"] < first["total_points"]
    log = await flow.db.audit_logs.find({"action": "tournament.season_points.resync"}, {"_id": 0}).to_list(5)
    assert len(log) == 1 and log[0]["data"]["updated"] == 3


@pytest.mark.asyncio
async def test_a_weight_change_between_two_publishes_leaves_one_entry_per_person(flow, monkeypatch):
    tournament, (anna, _bert), regs, placements = await setup(flow, monkeypatch, people=2, season_weight=1.25)
    placements.rows = [{"registration_id": regs[0]["id"], "user_id": anna["id"], "rank": 1}]
    await set_status(flow, tournament, "results_published")
    assert {row[1] for row in await rows(flow, tournament["id"])} == {"mini"}

    await set_status(flow, tournament, "completed")
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"season_weight": 3.0}})
    await set_status(flow, tournament, "results_published")

    found = await rows(flow, tournament["id"])
    assert len(found) == 2 and {row[1] for row in found} == {"major"}
    major = await flow.db.season_points.find_one({"user_id": anna["id"]}, {"_id": 0})
    assert major["weight"] == 3.0 and major["total_points"] == round(100 * 3.0 * 0.75, 1)


@pytest.mark.asyncio
async def test_weight_zero_on_republish_takes_the_points_back(flow, monkeypatch):
    tournament, (anna, _bert), regs, placements = await setup(flow, monkeypatch, people=2)
    placements.rows = [{"registration_id": regs[0]["id"], "user_id": anna["id"], "rank": 1}]
    await set_status(flow, tournament, "results_published")
    assert len(await rows(flow, tournament["id"])) == 2

    await set_status(flow, tournament, "completed")
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"season_weight": 0}})
    await set_status(flow, tournament, "results_published")
    assert await rows(flow, tournament["id"]) == []


@pytest.mark.asyncio
async def test_points_stay_in_their_season_when_another_one_is_active_by_now(flow, monkeypatch):
    tournament, (anna,), regs, placements = await setup(flow, monkeypatch, people=1)
    placements.rows = [{"registration_id": regs[0]["id"], "user_id": anna["id"], "rank": 1}]
    await set_status(flow, tournament, "results_published")
    await flow.db.seasons.update_one({"id": "s-1"}, {"$set": {"status": "completed"}})
    await flow.db.seasons.insert_one({"id": "s-2", "slug": "saison-2", "name": "Saison 2", "status": "active"})
    await set_status(flow, tournament, "completed")
    # Korrektur nach dem Abschluss: die abgeschlossene Wertung bleibt unverändert, die Leitung bekommt den Hinweis.
    placements.rows = []
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "results_published", "force": True})
    assert response.status_code == 200, response.text
    assert "abgeschlossenen Jahreswertung" in response.json()["season_points_note"]
    assert await rows(flow, tournament["id"]) == [(anna["id"], "tournament", 1, "s-1")]
    log = await flow.db.audit_logs.find_one({"action": "tournament.season_points.resync_skipped"}, {"_id": 0})
    assert log["target_id"] == tournament["id"] and log["data"]["closed_seasons"] == ["s-1"]


@pytest.mark.asyncio
async def test_team_entries_are_synced_by_team(flow, monkeypatch):
    from services import season_service

    await flow.db.seasons.insert_one({"id": "s-1", "slug": "s", "name": "S", "status": "active"})
    first = await season_service.sync_tournament_points(tournament_id="t-1", source_name="Team-Cup", weight=2.0,
                                                        wanted=[(None, "team-a", 1), (None, "team-b", 2)], num_participants=2)
    assert first["added"] == 2
    second = await season_service.sync_tournament_points(tournament_id="t-1", source_name="Team-Cup", weight=2.0,
                                                         wanted=[(None, "team-b", 1), (None, "team-a", 2)], num_participants=2)
    assert (second["added"], second["updated"], second["removed"]) == (0, 2, 0)
    found = {row["team_id"]: row["rank"] for row in await flow.db.season_points.find({"source_id": "t-1"}, {"_id": 0}).to_list(10)}
    assert found == {"team-a": 2, "team-b": 1}


@pytest.mark.asyncio
async def test_the_migration_removes_duplicate_tournament_points_once(flow):
    from scripts import season_points_duplicates
    from services import migrations, season_points_cleanup

    await flow.db.tournaments.insert_one({"id": "t-1", "title": "Cup", "season_weight": 3.0})
    base = {"season_id": "s-1", "source_id": "t-1", "team_id": None}
    await flow.db.season_points.insert_many([
        {**base, "id": "p-mini", "user_id": "anna", "source_type": "mini", "rank": 1, "total_points": 75.0, "created_at": "2026-09-01"},
        {**base, "id": "p-major", "user_id": "anna", "source_type": "major", "rank": 1, "total_points": 225.0, "created_at": "2026-09-02"},
        {**base, "id": "p-bert", "user_id": "bert", "source_type": "mini", "rank": 2, "total_points": 60.0, "created_at": "2026-09-01"},
        # eine andere Quelle derselben Person bleibt unberührt
        {**base, "id": "p-other", "user_id": "anna", "source_id": "t-2", "source_type": "tournament", "rank": 1,
         "total_points": 150.0, "created_at": "2026-09-01"},
    ])
    out = io.StringIO()
    assert await season_points_duplicates.main([], db=flow.db, out=out) == 0
    assert "1 Einträge zu entfernen (75.0 Punkte) bei 1 Personen/Teams in 1 Turnieren" in out.getvalue()
    assert await flow.db.season_points.count_documents({}) == 4  # Trockenlauf schreibt nichts

    entry = next(run for version, name, run in migrations.MIGRATIONS if version == 18)
    result = await entry(flow.db)
    assert result == "1 duplicate season points removed in 1 tournaments, 0 groups in 0 tournaments only reported"
    left = sorted(row["id"] for row in await flow.db.season_points.find({}, {"_id": 0}).to_list(10))
    assert left == ["p-bert", "p-major", "p-other"]
    log = await flow.db.audit_logs.find_one({"action": "season_points.duplicates_removed"}, {"_id": 0})
    assert log["target_id"] == "t-1" and [row["id"] for row in log["data"]["removed"]] == ["p-mini"]
    # wiederholbar
    result = await entry(flow.db)
    assert result == "0 duplicate season points removed in 0 tournaments, 0 groups in 0 tournaments only reported"
    assert (await season_points_cleanup.plan(flow.db))["rows_to_remove"] == 0


@pytest.mark.asyncio
async def test_without_the_tournament_the_original_entry_stays(flow):
    from services import season_points_cleanup

    base = {"season_id": "s-1", "source_id": "weg", "team_id": None, "user_id": "anna", "rank": 1}
    await flow.db.season_points.insert_many([
        {**base, "id": "alt", "source_type": "mini", "total_points": 75.0, "created_at": "2026-09-01"},
        {**base, "id": "neu", "source_type": "tournament", "total_points": 150.0, "created_at": "2026-09-05"},
    ])
    await season_points_cleanup.apply(flow.db)
    assert [row["id"] for row in await flow.db.season_points.find({}, {"_id": 0}).to_list(5)] == ["alt"]


@pytest.mark.asyncio
async def test_duplicates_over_two_seasons_or_in_a_closed_one_are_only_reported(flow):
    """Repro (Review): Punkte in Saison A, nach Saisonwechsel erneut veröffentlicht mit anderem Gewicht - Eintrag in B.
    Früher blieb der jüngste (B) und der ursprüngliche (A) verschwand. Jetzt wird nichts gelöscht, nur gemeldet."""
    from scripts import season_points_duplicates
    from services import season_points_cleanup

    await flow.db.seasons.insert_many([
        {"id": "s-a", "name": "Saison A", "status": "completed"},
        {"id": "s-b", "name": "Saison B", "status": "active"},
    ])
    await flow.db.tournaments.insert_many([{"id": "t-1", "season_weight": 3.0}, {"id": "t-2", "season_weight": 2.0}])
    await flow.db.season_points.insert_many([
        # über zwei Saisons
        {"id": "a-1", "season_id": "s-a", "source_id": "t-1", "user_id": "anna", "team_id": None, "source_type": "mini",
         "total_points": 75.0, "created_at": "2026-03-01"},
        {"id": "b-1", "season_id": "s-b", "source_id": "t-1", "user_id": "anna", "team_id": None, "source_type": "major",
         "total_points": 225.0, "created_at": "2026-10-01"},
        # beide in der abgeschlossenen Saison
        {"id": "a-2", "season_id": "s-a", "source_id": "t-2", "user_id": "bert", "team_id": None, "source_type": "mini",
         "total_points": 60.0, "created_at": "2026-03-01"},
        {"id": "a-3", "season_id": "s-a", "source_id": "t-2", "user_id": "bert", "team_id": None, "source_type": "tournament",
         "total_points": 120.0, "created_at": "2026-03-02"},
    ])
    out = io.StringIO()
    await season_points_duplicates.main([], db=flow.db, out=out)
    text = out.getvalue()
    assert "0 Einträge zu entfernen" in text
    assert "Nur gemeldet (mehrere oder abgeschlossene Wertungen, nichts gelöscht): 2 Personen/Teams in 2 Turnieren." in text
    assert "Saison A (completed – abgeschlossen, bleibt unverändert): 0 zu entfernen (0.0 Punkte), 2 gemeldet" in text
    assert "Saison B (active): 0 zu entfernen (0.0 Punkte), 1 gemeldet" in text

    result = await season_points_cleanup.apply(flow.db)
    assert result == "0 duplicate season points removed in 0 tournaments, 2 groups in 2 tournaments only reported"
    assert await flow.db.season_points.count_documents({}) == 4
    reported = await flow.db.audit_logs.find({"action": "season_points.duplicates_reported"}, {"_id": 0}).to_list(5)
    assert sorted(row["target_id"] for row in reported) == ["t-1", "t-2"]


@pytest.mark.asyncio
async def test_the_protocol_is_written_before_deleting_and_a_rerun_finishes(flow, monkeypatch):
    from services import season_points_cleanup

    base = {"season_id": "s-1", "source_id": "t-1", "team_id": None, "rank": 1}
    await flow.db.season_points.insert_many([
        {**base, "id": "anna-1", "user_id": "anna", "source_type": "mini", "total_points": 75.0, "created_at": "2026-09-01"},
        {**base, "id": "anna-2", "user_id": "anna", "source_type": "mini", "total_points": 75.0, "created_at": "2026-09-02"},
        {**base, "id": "bert-1", "user_id": "bert", "source_type": "mini", "total_points": 60.0, "created_at": "2026-09-01"},
        {**base, "id": "bert-2", "user_id": "bert", "source_type": "mini", "total_points": 60.0, "created_at": "2026-09-02"},
    ])

    class Abort(RuntimeError):
        pass

    real_db = flow.db
    deleted = []

    class Points:
        def __getattr__(self, name):
            return getattr(real_db.season_points, name)

        async def delete_one(self, query):
            if deleted:
                raise Abort("Verbindung weg")
            deleted.append(query["id"])
            return await real_db.season_points.delete_one(query)

    class Db:
        season_points = Points()

        def __getattr__(self, name):
            return getattr(real_db, name)

    with pytest.raises(Abort):
        await season_points_cleanup.apply(Db())
    log = await real_db.audit_logs.find_one({"action": "season_points.duplicates_removed"}, {"_id": 0})
    assert sorted(row["id"] for row in log["data"]["removed"]) == ["anna-2", "bert-2"]  # stand vor dem Abbruch fest
    assert await real_db.season_points.count_documents({}) == 3

    await season_points_cleanup.apply(real_db)
    assert sorted(row["id"] for row in await real_db.season_points.find({}, {"_id": 0}).to_list(5)) == ["anna-1", "bert-1"]


@pytest.mark.asyncio
async def test_corrections_are_never_dropped_and_no_rating(flow):
    from services import season_service

    await flow.db.seasons.insert_one({"id": "s-1", "slug": "s", "name": "S", "status": "active", "drop_worst": 1})
    anna = await flow.add_user(name="anna")
    base = {"season_id": "s-1", "user_id": anna["id"], "team_id": None}
    await flow.db.season_points.insert_many([
        {**base, "id": "t1", "source_type": "tournament", "source_id": "t-1", "rank": 1, "total_points": 100.0, "raw_points": 100.0},
        {**base, "id": "t2", "source_type": "tournament", "source_id": "t-2", "rank": 3, "total_points": 50.0, "raw_points": 50.0},
        {**base, "id": "k1", "source_type": "custom", "source_id": "adjustment:k1", "rank": None, "total_points": -15.0,
         "raw_points": -15.0},
    ])
    (row,) = await season_service.aggregate_leaderboard(season_id="s-1")
    # gestrichen wird die schwächste Wertung (50), nie der Abzug; der Abzug ist keine Wertung
    assert row["total_points"] == 85.0 and row["events"] == 2
    assert row["dropped_events"] == 1 and row["dropped_points"] == 50.0
    assert {item["source_type"]: item["total_points"] for item in row["source_breakdown"]} == {"tournament": 100.0, "custom": -15.0}


# ---------------------------------------------------------------- Jahreswertung verwalten (ER7–ER11)

async def seasons(flow, *docs):
    flow.act_as(await flow.add_staff())
    for doc in docs:
        await flow.db.seasons.insert_one({"slug": doc["id"], "name": doc["id"].upper(), **doc})


@pytest.mark.asyncio
async def test_only_one_season_can_be_active(flow):
    await seasons(flow, {"id": "a", "status": "active"}, {"id": "b", "status": "draft"})
    response = await flow.patch("/api/seasons/b", json={"status": "active"})
    assert response.status_code == 409 and "schon aktiv" in response.json()["detail"]
    await flow.patch("/api/seasons/a", json={"status": "draft"})
    response = await flow.patch("/api/seasons/b", json={"status": "active"})
    assert response.status_code == 200
    log = await flow.db.audit_logs.find({"action": "season.status.change"}, {"_id": 0}).to_list(5)
    assert [(row["target_id"], row["data"]["status"]) for row in log] == [("a", "draft"), ("b", "active")]


@pytest.mark.asyncio
async def test_completing_needs_its_own_button_with_preview(flow, monkeypatch):
    import badges

    done = []

    async def on_season_completed(season_id):
        done.append(season_id)

    monkeypatch.setattr(badges, "on_season_completed", on_season_completed)
    await seasons(flow, {"id": "a", "status": "active"}, {"id": "d", "status": "draft"})
    response = await flow.patch("/api/seasons/a", json={"status": "completed"})
    assert response.status_code == 409
    preview = await flow.get("/api/seasons/a/completion-preview")
    assert preview.status_code == 200, preview.text
    assert preview.json()["season"]["id"] == "a" and preview.json()["finished"] is False
    response = await flow.post("/api/seasons/d/complete")
    assert response.status_code == 409
    response = await flow.post("/api/seasons/a/complete")
    assert response.status_code == 200 and response.json()["status"] == "completed"
    assert done == ["a"]
    response = await flow.post("/api/seasons/a/complete")
    assert response.status_code == 409
    assert await flow.db.audit_logs.count_documents({"action": "season.complete", "target_id": "a"}) == 1


@pytest.mark.asyncio
async def test_only_an_empty_draft_can_be_deleted(flow):
    await seasons(flow, {"id": "a", "status": "active"}, {"id": "d", "status": "draft"}, {"id": "e", "status": "draft"})
    await flow.db.season_points.insert_one({"id": "p", "season_id": "d", "user_id": "u", "total_points": 10})
    response = await flow.delete("/api/seasons/a")
    assert response.status_code == 409
    response = await flow.delete("/api/seasons/d")
    assert response.status_code == 409
    response = await flow.delete("/api/seasons/e")
    assert response.status_code == 200
    assert sorted(s["id"] for s in await flow.db.seasons.find({}, {"_id": 0}).to_list(5)) == ["a", "d"]
    assert await flow.db.audit_logs.count_documents({"action": "season.delete", "target_id": "e"}) == 1


@pytest.mark.asyncio
async def test_points_can_be_corrected_by_hand_with_a_reason(flow):
    await seasons(flow, {"id": "a", "status": "active"}, {"id": "c", "status": "completed"})
    anna = await flow.add_user(name="anna")
    response = await flow.post("/api/seasons/a/adjustments", json={"user_id": anna["id"], "points": 15, "reason": ""})
    assert response.status_code == 400
    response = await flow.post("/api/seasons/a/adjustments", json={"user_id": anna["id"], "points": 0, "reason": "Fair Play"})
    assert response.status_code == 400
    response = await flow.post("/api/seasons/c/adjustments", json={"user_id": anna["id"], "points": 5, "reason": "zu spät"})
    assert response.status_code == 409
    response = await flow.post("/api/seasons/a/adjustments", json={"user_id": anna["id"], "points": -12.5, "reason": "Regelverstoß beim Cup"})
    assert response.status_code == 200, response.text
    entry = response.json()
    assert (entry["source_type"], entry["total_points"], entry["bonus_reason"]) == ("custom", -12.5, "Regelverstoß beim Cup")
    listed = (await flow.get("/api/seasons/a/adjustments")).json()
    assert [(row["recipient_label"], row["total_points"]) for row in listed] == [("anna", -12.5)]
    standings = (await flow.get("/api/seasons/a/standings")).json()["standings"]
    assert [(row["user_id"], row["points"]) for row in standings] == [(anna["id"], -12.5)]
    response = await flow.delete(f"/api/seasons/a/adjustments/{entry['id']}")
    assert response.status_code == 200
    assert await flow.db.season_points.count_documents({}) == 0
    actions = [row["action"] for row in await flow.db.audit_logs.find({}, {"_id": 0}).to_list(5)]
    assert actions == ["season.points.adjust", "season.points.adjust_delete"]


@pytest.mark.asyncio
async def test_the_start_page_shows_no_season_without_an_active_one(flow):
    await seasons(flow, {"id": "d", "status": "draft", "start_date": "2026-05-01"})
    assert (await flow.get("/api/seasons/active/featured")).json() == {"season": None, "standings": []}


@pytest.mark.asyncio
async def test_with_two_active_seasons_points_keep_going_where_they_went_before(flow):
    """Altbestand mit zwei aktiven Wertungen: dieselbe Auswahl wie vor #2123 (die erste, die die Datenbank liefert) -
    nach dem Update wandern keine Punkte in eine andere Saison."""
    from services import season_service

    await flow.db.seasons.insert_many([
        {"id": "alt", "status": "active", "start_date": "2025-01-01"},
        {"id": "neu", "status": "active", "start_date": "2026-01-01"},
    ])
    entry = await season_service.award_points(user_id="anna", source_type="event", source_id="e-1", rank=None)
    assert entry["season_id"] == "alt"


@pytest.mark.asyncio
async def test_the_person_search_for_corrections_is_for_the_tournament_lead(flow):
    await seasons(flow, {"id": "a", "status": "active"})
    anna = await flow.add_user(name="anna-korrektur")
    response = await flow.get("/api/admin/people/search", params={"purpose": "season", "q": "anna-korr"})
    assert response.status_code == 200, response.text
    assert [hit["id"] for hit in response.json()] == [anna["id"]]
    flow.act_as(await flow.add_user(name="niemand"))
    assert (await flow.get("/api/admin/people/search", params={"purpose": "season", "q": "anna"})).status_code == 403