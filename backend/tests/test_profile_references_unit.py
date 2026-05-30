import asyncio
import pathlib
import sys
import types

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

database_stub = types.ModuleType("database")
database_stub.get_db = lambda: None
sys.modules.setdefault("database", database_stub)

visibility_stub = types.ModuleType("services.visibility")


async def _user_can_see(_user, _visibility):
    return True


visibility_stub.user_can_see = _user_can_see
sys.modules.setdefault("services.visibility", visibility_stub)

from services import profile_references


def _matches(doc, query):
    for key, expected in (query or {}).items():
        if key == "$or":
            if not any(_matches(doc, branch) for branch in expected):
                return False
            continue
        value = doc.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and value not in expected["$in"]:
                return False
            if "$ne" in expected and value == expected["$ne"]:
                return False
            if "$exists" in expected and (key in doc) is not bool(expected["$exists"]):
                return False
            continue
        if value != expected:
            return False
    return True


class FakeCursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, field, direction):
        reverse = direction < 0
        self.docs = sorted(self.docs, key=lambda doc: doc.get(field) or "", reverse=reverse)
        return self

    async def to_list(self, limit):
        return self.docs[:limit]


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, _projection=None):
        return FakeCursor([doc for doc in self.docs if _matches(doc, query)])

    async def find_one(self, query=None, _projection=None):
        for doc in self.docs:
            if _matches(doc, query):
                return doc
        return None


class FakeDb:
    def __init__(self, **collections):
        names = [
            "team_members",
            "season_points",
            "tournaments",
            "f1_challenges",
            "f1_tracks",
            "tournament_registrations",
            "matches",
            "matches_v2",
            "tournament_groups",
            "f1_lap_times",
        ]
        for name in names:
            setattr(self, name, FakeCollection(collections.get(name, [])))


def test_tournament_reference_backfills_rank_for_mini_season_points(monkeypatch):
    db = FakeDb(
        season_points=[
            {
                "user_id": "user-1",
                "source_type": "mini",
                "source_id": "tour-1",
                "source_name": "Mini Cup",
                "rank": None,
                "total_points": 20,
                "created_at": "2026-05-28T10:00:00Z",
            }
        ],
        tournaments=[
            {
                "id": "tour-1",
                "slug": "mini-cup",
                "title": "Mini Cup",
                "status": "results_published",
                "game_name": "Rocket League",
                "start_date": "2026-05-28T09:00:00Z",
            }
        ],
        tournament_registrations=[
            {"id": "reg-1", "tournament_id": "tour-1", "user_id": "user-1", "status": "approved"},
            {"id": "reg-2", "tournament_id": "tour-1", "user_id": "user-2", "status": "approved"},
        ],
        matches=[
            {
                "tournament_id": "tour-1",
                "winner_id": "reg-1",
                "final_position": 2,
                "status": "completed",
            }
        ],
    )
    monkeypatch.setattr(profile_references, "get_db", lambda: db)

    result = asyncio.run(profile_references.personal_profile_references({"id": "user-1"}))

    assert result["items"][0]["rank"] == 2
    assert result["items"][0]["participant_count"] == 2
    assert result["stats"]["podiums"] == 1


def test_registration_reference_gets_rank_from_v2_results(monkeypatch):
    db = FakeDb(
        tournaments=[
            {
                "id": "tour-2",
                "slug": "heat-cup",
                "title": "Heat Cup",
                "status": "results_published",
                "format": "heat",
                "game_name": "F1",
                "start_date": "2026-05-29T09:00:00Z",
            }
        ],
        tournament_registrations=[
            {"id": "reg-1", "tournament_id": "tour-2", "user_id": "user-1", "status": "approved"},
            {"id": "reg-2", "tournament_id": "tour-2", "user_id": "user-2", "status": "approved"},
        ],
        matches_v2=[
            {
                "tournament_id": "tour-2",
                "status": "completed",
                "round": 1,
                "results": [
                    {"registration_id": "reg-1", "rank": 1, "points": 25},
                    {"registration_id": "reg-2", "rank": 2, "points": 18},
                ],
            }
        ],
    )
    monkeypatch.setattr(profile_references, "get_db", lambda: db)

    result = asyncio.run(profile_references.personal_profile_references({"id": "user-1"}))

    assert result["items"][0]["kind"] == "tournament"
    assert result["items"][0]["rank"] == 1
    assert result["items"][0]["participant_count"] == 2
    assert result["stats"]["wins"] == 1
