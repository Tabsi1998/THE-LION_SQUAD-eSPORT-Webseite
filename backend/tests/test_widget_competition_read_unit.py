import asyncio

from routes import extras_routes


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
        return FakeCursor([
            row
            for row in self.rows
            if all(row.get(key) == value for key, value in query.items())
        ])


class FakeDb:
    def __init__(self):
        self.matches = FakeCollection()
        self.matches_v2 = FakeCollection([{
            "id": "ffa-1",
            "tournament_id": "t1",
            "stage_id": "s1",
            "stage_number": 1,
            "match_key": "A",
            "round": 1,
            "match_type": "ffa",
            "slots": [
                {"slot": 1, "registration_id": "r1", "status": "filled", "source": {"type": "seed", "seed": 1}},
                {"slot": 2, "registration_id": "r2", "status": "filled", "source": {"type": "seed", "seed": 2}},
                {"slot": 3, "registration_id": "r3", "status": "filled", "source": {"type": "seed", "seed": 3}},
            ],
            "results": [],
            "advancement": [],
            "status": "ready",
            "admin_note": "internal",
            "result_meta": {"proof_url": "internal"},
        }])
        self.tournament_stages = FakeCollection([{
            "id": "s1",
            "tournament_id": "t1",
            "number": 1,
            "stage_type": "ffa_custom_bracket",
            "match_type": "ffa",
        }])
        self.tournament_registrations = FakeCollection([
            {"id": "r1", "tournament_id": "t1", "display_name": "Alpha", "status": "approved"},
            {"id": "r2", "tournament_id": "t1", "display_name": "Bravo", "status": "approved"},
            {"id": "r3", "tournament_id": "t1", "display_name": "Charlie", "status": "approved"},
        ])


def test_widget_bracket_exposes_stage_data_and_keeps_legacy_fields(monkeypatch):
    tournament = {
        "id": "t1",
        "title": "FFA Cup",
        "format": "ffa_custom_bracket",
        "status": "live",
    }

    async def visible_tournament(_slug_or_id):
        return tournament

    monkeypatch.setattr(extras_routes, "get_db", lambda: FakeDb())
    monkeypatch.setattr(extras_routes, "_public_tournament_or_404", visible_tournament)

    payload = asyncio.run(extras_routes.widget_bracket("ffa-cup"))

    assert payload["matches"] == []
    assert [match["id"] for match in payload["matches_v2"]] == ["ffa-1"]
    assert "admin_note" not in payload["matches_v2"][0]
    assert "result_meta" not in payload["matches_v2"][0]
    assert payload["engine"] == "stage"
    assert payload["structure"]["schema_version"] == "competition.structure.v1"
    assert len(payload["structure"]["matches"][0]["slots"]) == 3
    assert [registration["display_name"] for registration in payload["registrations"]] == [
        "Alpha",
        "Bravo",
        "Charlie",
    ]
