import asyncio

from routes import extras_routes


class FakeCursor:
    def __init__(self, rows):
        self.rows = list(rows)

    async def to_list(self, limit):
        return self.rows[:limit]


class FakeCollection:
    def __init__(self, rows=()):
        self.rows = list(rows)

    def find(self, query=None, _projection=None):
        if query and "user_id" in query:
            rows = [row for row in self.rows if row.get("user_id") == query["user_id"]]
        elif query and "to" in query:
            rows = [row for row in self.rows if row.get("to") == query["to"]]
        elif query and "member_ids" in query:
            rows = [row for row in self.rows if query["member_ids"] in (row.get("member_ids") or [])]
        else:
            rows = self.rows
        return FakeCursor(rows)

    async def find_one(self, query, _projection=None):
        return next((row for row in self.rows if row.get("id") == query.get("id")), None)


class FakeDb:
    def __init__(self):
        self.users = FakeCollection([{"id": "u1", "email": "lion@example.at", "display_name": "Lion"}])
        self.tournament_registrations = FakeCollection([{
            "id": "r1",
            "tournament_id": "t1",
            "user_id": "u1",
            "display_name": "Lion",
        }])
        self.matches = FakeCollection([{
            "id": "legacy-1",
            "tournament_id": "t1",
            "participant_a_id": "r1",
            "participant_b_id": "r2",
            "winner_id": "r1",
            "loser_id": "r2",
            "status": "completed",
        }])
        self.matches_v2 = FakeCollection([{
            "id": "stage-1",
            "tournament_id": "t1",
            "stage_id": "s1",
            "slots": [{"slot": 1, "registration_id": "r1", "status": "filled"}],
            "results": [{"registration_id": "r1", "rank": 1}],
            "advancement": [],
            "status": "completed",
        }])
        self.f1_lap_times = FakeCollection()
        self.teams = FakeCollection()
        self.email_logs = FakeCollection([{"id": "mail-1", "to": "lion@example.at"}])


def test_dsgvo_export_includes_canonical_legacy_and_stage_match_references(monkeypatch):
    monkeypatch.setattr(extras_routes, "get_db", FakeDb)

    payload = asyncio.run(extras_routes.export_my_data({"id": "u1"}))

    assert payload["user"]["id"] == "u1"
    assert [registration["id"] for registration in payload["tournament_registrations"]] == ["r1"]
    assert {match["source"]["engine"] for match in payload["competition_matches"]} == {"legacy", "stage"}
    assert payload["email_logs"][0]["id"] == "mail-1"
