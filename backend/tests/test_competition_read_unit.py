import asyncio

from services.competition_read import (
    canonical_match_for_source,
    count_matches_by_status,
    find_match_source,
    load_competition_read_model,
    load_registration_matches,
    observe_structure_read,
)


class FakeCursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_args):
        return self

    async def to_list(self, limit):
        return self.rows[:limit]


class FakeCollection:
    def __init__(self, rows=()):
        self.rows = list(rows)

    @staticmethod
    def _values(row, key):
        values = [row]
        for part in key.split("."):
            values = [
                child
                for value in values
                for child in (
                    [item.get(part) for item in value if isinstance(item, dict)]
                    if isinstance(value, list)
                    else [value.get(part)] if isinstance(value, dict)
                    else []
                )
            ]
        return values

    def _matches(self, row, query):
        for key, expected in query.items():
            if key == "$or":
                if not any(self._matches(row, option) for option in expected):
                    return False
                continue
            values = self._values(row, key)
            if isinstance(expected, dict) and "$in" in expected:
                if not any(value in expected["$in"] for value in values):
                    return False
            elif expected not in values:
                return False
        return True

    def find(self, query, _projection=None):
        rows = [row for row in self.rows if self._matches(row, query)]
        return FakeCursor(rows)

    async def find_one(self, query, _projection=None):
        return next((row for row in self.rows if self._matches(row, query)), None)

    async def count_documents(self, query):
        return sum(1 for row in self.rows if self._matches(row, query))


class FakeDb:
    def __init__(self):
        self.matches = FakeCollection([{
            "id": "legacy-1",
            "tournament_id": "t1",
            "participant_a_id": "r1",
            "participant_b_id": "r2",
            "status": "ready",
        }])
        self.matches_v2 = FakeCollection([{
            "id": "stage-1",
            "tournament_id": "t1",
            "stage_id": "s1",
            "match_key": "A",
            "slots": [{"slot": 1, "registration_id": "r1", "status": "filled"}],
            "results": [],
            "advancement": [],
            "status": "pending",
        }])
        self.tournament_stages = FakeCollection([{
            "id": "s1",
            "tournament_id": "t1",
            "number": 1,
            "stage_type": "single_elimination",
        }])


def test_read_model_loads_both_stores_into_one_snapshot():
    model = asyncio.run(load_competition_read_model(FakeDb(), "t1"))
    snapshot = model.structure_snapshot()

    assert [match["id"] for match in snapshot["matches"]] == ["legacy-1", "stage-1"]
    assert snapshot["source_engines"] == ["legacy", "stage"]
    assert snapshot["mixed_source"] is True


def test_match_source_prefers_stage_and_canonical_detail_keeps_collection():
    db = FakeDb()
    source = asyncio.run(find_match_source(db, "stage-1"))
    canonical = asyncio.run(canonical_match_for_source(db, source.match, source.collection))

    assert source.collection == "matches_v2"
    assert canonical["id"] == "stage-1"
    assert canonical["source"] == {"engine": "stage", "collection": "matches_v2"}


def test_missing_match_source_returns_none():
    assert asyncio.run(find_match_source(FakeDb(), "missing")) is None


def test_structure_read_observation_emits_bounded_metrics(caplog):
    caplog.set_level("INFO", logger="tls.competition_read")
    model = asyncio.run(load_competition_read_model(FakeDb(), "t1"))

    metrics = observe_structure_read(model.structure_snapshot(), surface="unit")

    assert metrics["match_count"] == 2
    assert metrics["source_counts"] == {"legacy": 1, "stage": 1}
    assert metrics["integrity_issue_count"] == 0
    assert "surface=unit" in caplog.text


def test_registration_read_and_status_counts_cover_both_stores():
    db = FakeDb()

    matches = asyncio.run(load_registration_matches(db, {"r1"}))

    assert {match["id"] for match in matches} == {"legacy-1", "stage-1"}
    assert asyncio.run(count_matches_by_status(db, {"ready", "pending"})) == 2
    assert asyncio.run(count_matches_by_status(db, {"disputed"})) == 0
