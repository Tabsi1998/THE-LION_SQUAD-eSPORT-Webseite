"""The Swiss and group generators as the endpoints actually run them.

The pairing rules are pinned next door in ``test_graph_swiss_groups_unit``. What
is checked here is the step after: that the endpoints write documents the rest of
the platform can read, that they pick the engine a tournament already lives in
instead of moving it, and that a second call does not quietly duplicate a round.
"""
import asyncio
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from routes.tournament_routes import (
    _competition_engine,
    _groups_generate_graph,
    _swiss_next_round_graph,
)
from services.competition_read import load_competition_read_model
from services.competition_standings import standings_for_structure


class FakeCursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_args):
        return self

    async def to_list(self, limit):
        return self.rows[:limit]


class FakeCollection:
    def __init__(self, rows=()):
        self.rows = [dict(row) for row in rows]

    def _matches(self, row, query):
        for key, expected in query.items():
            value = row.get(key)
            if isinstance(expected, dict):
                if "$in" in expected and value not in expected["$in"]:
                    return False
                if "$ne" in expected and value == expected["$ne"]:
                    return False
            elif value != expected:
                return False
        return True

    def find(self, query, _projection=None):
        return FakeCursor([dict(row) for row in self.rows if self._matches(row, query)])

    async def find_one(self, query, _projection=None):
        return next((dict(row) for row in self.rows if self._matches(row, query)), None)

    async def count_documents(self, query):
        return sum(1 for row in self.rows if self._matches(row, query))

    async def distinct(self, field, query=None):
        return sorted({row.get(field) for row in self.rows if self._matches(row, query or {})})

    async def insert_one(self, document):
        self.rows.append(dict(document))

    async def insert_many(self, documents):
        self.rows.extend(dict(document) for document in documents)

    async def delete_many(self, query):
        self.rows = [row for row in self.rows if not self._matches(row, query)]

    async def update_one(self, query, update):
        for row in self.rows:
            if self._matches(row, query):
                row.update(update.get("$set") or {})
                return


class FakeDb:
    def __init__(self, **collections):
        for name in ("tournaments", "tournament_stages", "tournament_registrations",
                     "tournament_groups", "matches", "matches_v2", "match_reports_v2",
                     "audit_logs", "competition_write_events"):
            setattr(self, name, FakeCollection(collections.get(name, ())))


def run(coroutine):
    return asyncio.run(coroutine)


def registrations(tid, count):
    return [
        {"id": f"reg{index}", "tournament_id": tid, "user_id": f"user{index}",
         "status": "approved", "seed": index, "display_name": f"Spieler {index}"}
        for index in range(1, count + 1)
    ]


def swiss_db(participant_count=6, stages=(), matches_v2=()):
    tournament = {"id": "t1", "format": "swiss", "status": "draft", "match_duration_minutes": 25}
    return FakeDb(
        tournaments=[tournament],
        tournament_registrations=registrations("t1", participant_count),
        tournament_stages=stages,
        matches_v2=matches_v2,
    ), tournament


def groups_db(participant_count=8):
    tournament = {"id": "t1", "format": "groups", "status": "draft",
                  "max_participants": participant_count, "seeding_mode": "manual"}
    return FakeDb(
        tournaments=[tournament],
        tournament_registrations=registrations("t1", participant_count),
    ), tournament


# ---------------------------------------------------------------- Enginewahl

def test_a_tournament_without_structure_follows_its_format():
    """Neue Turniere starten im Graph-Speicher - sonst fuellt sich der alte wieder."""
    db = FakeDb(tournaments=[{"id": "t1"}])

    assert run(_competition_engine(db, "t1", {"format": "swiss"})) == "graph"
    assert run(_competition_engine(db, "t1", {"format": "groups"})) == "graph"


def test_an_existing_stage_decides_for_the_graph():
    db = FakeDb(tournament_stages=[{"id": "s1", "tournament_id": "t1"}])

    assert run(_competition_engine(db, "t1")) == "graph"


def test_existing_graph_matches_decide_even_without_a_stage():
    db = FakeDb(matches_v2=[{"id": "m1", "tournament_id": "t1"}])

    assert run(_competition_engine(db, "t1")) == "graph"


def test_classic_matches_do_not_pull_a_tournament_into_the_graph():
    """Ein laufendes Turnier darf nicht den Speicher wechseln - auch jetzt nicht,
    wo jedes Format auf den Graph zeigt."""
    db = FakeDb(matches=[{"id": "m1", "tournament_id": "t1"}])

    assert run(_competition_engine(db, "t1", {"format": "single_elim"})) == "classic"


# ---------------------------------------------------------------- Schweizer Runden

def test_the_first_round_creates_its_stage_and_pairs_everyone():
    db, tournament = swiss_db(6)

    response = run(_swiss_next_round_graph(db, tournament, "admin"))

    assert response["round"] == 1
    assert response["match_count"] == 3
    assert len(db.tournament_stages.rows) == 1
    assert db.tournament_stages.rows[0]["stage_type"] == "swiss"
    assert all(match["stage_id"] == response["stage_id"] for match in db.matches_v2.rows)


def test_the_tournament_goes_live_with_its_first_round():
    db, tournament = swiss_db(4)

    run(_swiss_next_round_graph(db, tournament, "admin"))

    assert db.tournaments.rows[0]["status"] == "live"


def test_the_write_model_is_pinned_to_the_graph():
    db, tournament = swiss_db(4)

    run(_swiss_next_round_graph(db, tournament, "admin"))

    assert db.tournaments.rows[0]["engine_version"] == "competition.graph.v1"


def test_an_odd_field_gets_a_bye_match():
    db, tournament = swiss_db(5)

    response = run(_swiss_next_round_graph(db, tournament, "admin"))

    assert response["match_count"] == 3
    byes = [match for match in db.matches_v2.rows if match["status"] == "completed"]
    assert len(byes) == 1


def test_an_open_round_blocks_the_next_one():
    """Sonst spielt jemand zwei Runden gleichzeitig."""
    db, tournament = swiss_db(4)
    run(_swiss_next_round_graph(db, tournament, "admin"))

    with pytest.raises(Exception) as error:
        run(_swiss_next_round_graph(db, tournament, "admin"))

    assert "offen" in str(getattr(error.value, "detail", error.value))


def test_a_finished_round_opens_the_next_one():
    db, tournament = swiss_db(4)
    run(_swiss_next_round_graph(db, tournament, "admin"))
    for match in db.matches_v2.rows:
        first, second = [slot["registration_id"] for slot in match["slots"]]
        match["status"] = "completed"
        match["results"] = [
            {"registration_id": first, "rank": 1},
            {"registration_id": second, "rank": 2},
        ]

    response = run(_swiss_next_round_graph(db, tournament, "admin"))

    assert response["round"] == 2
    assert len([match for match in db.matches_v2.rows if match["round"] == 2]) == 2


def test_too_few_participants_are_refused_instead_of_writing_nothing():
    db, tournament = swiss_db(0)

    with pytest.raises(Exception) as error:
        run(_swiss_next_round_graph(db, tournament, "admin"))

    assert "Teilnehmer" in str(getattr(error.value, "detail", error.value))


def test_the_swiss_round_is_readable_through_the_shared_read_model():
    """Was hier geschrieben wird, muss die Turnieransicht auch lesen koennen."""
    db, tournament = swiss_db(4)
    run(_swiss_next_round_graph(db, tournament, "admin"))

    snapshot = run(load_competition_read_model(db, "t1")).structure_snapshot()

    assert snapshot["source_engines"] == ["stage"]
    assert snapshot["mixed_source"] is False
    assert len(snapshot["matches"]) == 2


# ---------------------------------------------------------------- Gruppenphase

def test_the_group_stage_writes_fixtures_groups_and_a_stage():
    db, tournament = groups_db(8)

    response = run(_groups_generate_graph(db, tournament, 2, "admin"))

    assert response["group_count"] == 2
    assert response["match_count"] == 12
    assert len(db.tournament_groups.rows) == 2
    assert len(db.tournament_stages.rows) == 1
    assert db.tournament_stages.rows[0]["settings"]["group_count"] == 2


def test_every_participant_lands_in_exactly_one_group():
    db, tournament = groups_db(8)

    run(_groups_generate_graph(db, tournament, 2, "admin"))

    everyone = [
        registration_id
        for group in db.tournament_groups.rows
        for registration_id in group["participant_ids"]
    ]
    assert sorted(everyone) == sorted(row["id"] for row in db.tournament_registrations.rows)


def test_the_strongest_two_seeds_are_kept_apart():
    db, tournament = groups_db(8)

    run(_groups_generate_graph(db, tournament, 2, "admin"))

    home = {
        group["group_key"]: group["participant_ids"]
        for group in db.tournament_groups.rows
    }
    assert not any("reg1" in members and "reg2" in members for members in home.values())


def test_every_fixture_knows_its_group():
    """Ohne group_id findet die Gruppentabelle ihre Spiele nur ueber den Namen."""
    db, tournament = groups_db(8)

    run(_groups_generate_graph(db, tournament, 2, "admin"))

    group_ids = {group["id"] for group in db.tournament_groups.rows}
    assert all(match.get("group_id") in group_ids for match in db.matches_v2.rows)


def test_regenerating_replaces_instead_of_adding():
    db, tournament = groups_db(8)
    run(_groups_generate_graph(db, tournament, 2, "admin"))

    run(_groups_generate_graph(db, tournament, 2, "admin"))

    assert len(db.matches_v2.rows) == 12
    assert len(db.tournament_groups.rows) == 2


def test_the_group_table_finds_its_matches_after_generation():
    db, tournament = groups_db(8)
    run(_groups_generate_graph(db, tournament, 2, "admin"))
    for match in db.matches_v2.rows:
        winner, loser = [slot["registration_id"] for slot in match["slots"]]
        match["status"] = "completed"
        match["results"] = [
            {"registration_id": winner, "rank": 1},
            {"registration_id": loser, "rank": 2},
        ]

    snapshot = run(load_competition_read_model(db, "t1")).structure_snapshot()
    tables = standings_for_structure(
        tournament,
        snapshot,
        db.tournament_registrations.rows,
        groups=db.tournament_groups.rows,
    )

    assert [entry["group"]["group_key"] for entry in tables] == ["A", "B"]
    for entry in tables:
        assert sum(row["played"] for row in entry["standings"]) == 12
