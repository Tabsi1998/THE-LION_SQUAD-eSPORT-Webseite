import asyncio

from routes.event_routes import _tournament_recap_podium


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

    def find(self, query, _projection=None):
        rows = [
            row for row in self.rows
            if all(row.get(key) == value for key, value in query.items())
        ]
        return FakeCursor(rows)


class FakeDb:
    def __init__(self):
        self.tournament_registrations = FakeCollection([
            {"id": "r1", "tournament_id": "t1", "display_name": "Alice"},
            {"id": "r2", "tournament_id": "t1", "display_name": "Bob"},
        ])
        self.matches = FakeCollection()
        self.matches_v2 = FakeCollection([{
            "id": "stage-final",
            "tournament_id": "t1",
            "stage_id": "s1",
            "stage_number": 1,
            "round": 1,
            "match_type": "duel",
            "status": "completed",
            "slots": [
                {"slot": 1, "registration_id": "r1", "status": "filled"},
                {"slot": 2, "registration_id": "r2", "status": "filled"},
            ],
            "results": [
                {"registration_id": "r1", "rank": 1, "score": 3},
                {"registration_id": "r2", "rank": 2, "score": 1},
            ],
        }])
        self.tournament_stages = FakeCollection([{
            "id": "s1",
            "tournament_id": "t1",
            "number": 1,
            "stage_type": "single_elimination",
        }])


def test_event_recap_uses_canonical_stage_standings():
    podium = asyncio.run(_tournament_recap_podium(FakeDb(), {
        "id": "t1",
        "format": "single_elim",
    }))

    assert podium == [
        {"rank": 1, "name": "Alice", "detail": "1 Sieg, 3 Punkte"},
        {"rank": 2, "name": "Bob", "detail": "1 Punkt"},
    ]
