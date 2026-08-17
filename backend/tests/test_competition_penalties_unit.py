import asyncio
from types import SimpleNamespace

from services.competition_penalties import load_forfeit_penalties


class FakeCursor:
    def __init__(self, rows):
        self.rows = list(rows)

    async def to_list(self, limit):
        return self.rows[:limit]


class FakeCollection:
    def __init__(self, rows):
        self.rows = list(rows)

    @staticmethod
    def _values(row, path):
        values = [row]
        for part in path.split("."):
            next_values = []
            for value in values:
                if isinstance(value, list):
                    next_values.extend(item.get(part) for item in value if isinstance(item, dict))
                elif isinstance(value, dict):
                    next_values.append(value.get(part))
            values = next_values
        return values

    def _matches(self, row, query):
        for key, expected in query.items():
            values = self._values(row, key)
            if isinstance(expected, dict):
                if expected.get("$exists") is True and not values:
                    return False
                if "$ne" in expected and any(value == expected["$ne"] for value in values):
                    return False
                if "$in" in expected and not any(value in expected["$in"] for value in values):
                    return False
            elif expected not in values:
                return False
        return True

    def find(self, query, _projection=None):
        return FakeCursor(row for row in self.rows if self._matches(row, query))


def _db():
    return SimpleNamespace(
        matches=FakeCollection([{
            "id": "legacy-forfeit",
            "tournament_id": "t1",
            "loser_id": "r2",
            "status": "forfeit",
            "admin_decision_note": "Legacy no-show",
            "admin_decision_by": "admin-1",
            "admin_decision_at": "2026-08-17T10:00:00+00:00",
        }]),
        matches_v2=FakeCollection([{
            "id": "stage-forfeit",
            "tournament_id": "t2",
            "match_key": "FFA-1",
            "status": "completed",
            "results": [
                {"registration_id": "r1", "rank": 1, "forfeit": False},
                {"registration_id": "r2", "rank": 2, "forfeit": True, "note": "Stage no-show"},
            ],
            "result_meta": {
                "note": "Staff decision",
                "confirmed_by": "admin-2",
                "confirmed_at": "2026-08-17T11:00:00+00:00",
            },
        }]),
    )


def test_forfeit_penalties_normalize_legacy_and_stage_results():
    penalties = asyncio.run(load_forfeit_penalties(_db(), {"r2"}))

    assert [item["match_id"] for item in penalties] == ["stage-forfeit", "legacy-forfeit"]
    assert penalties[0]["reason"] == "Stage no-show"
    assert penalties[0]["issued_by"] == "admin-2"
    assert penalties[0]["source"] == {"engine": "stage", "collection": "matches_v2"}
    assert penalties[1]["reason"] == "Legacy no-show"
    assert penalties[1]["source"] == {"engine": "legacy", "collection": "matches"}


def test_forfeit_penalties_filter_the_exact_forfeiting_result():
    assert asyncio.run(load_forfeit_penalties(_db(), {"r1"})) == []
    assert asyncio.run(load_forfeit_penalties(_db(), [])) == []
    assert len(asyncio.run(load_forfeit_penalties(_db()))) == 2
