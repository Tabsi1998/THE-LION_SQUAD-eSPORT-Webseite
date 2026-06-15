import asyncio
from types import SimpleNamespace

from services import prize_service


class FakeCursor:
    def __init__(self, items):
        self.items = list(items)

    async def to_list(self, _limit):
        return list(self.items)


class FakeCollection:
    def __init__(self, items=None):
        self.items = list(items or [])

    def _matches(self, item, query):
        for key, expected in (query or {}).items():
            actual = item.get(key)
            if isinstance(expected, dict):
                if "$ne" in expected and actual == expected["$ne"]:
                    return False
                if "$in" in expected and actual not in expected["$in"]:
                    return False
                continue
            if actual != expected:
                return False
        return True

    async def find_one(self, query, *_args, **_kwargs):
        return next((item for item in self.items if self._matches(item, query)), None)

    def find(self, query=None, *_args, **_kwargs):
        return FakeCursor([item for item in self.items if self._matches(item, query or {})])

    async def insert_one(self, doc):
        self.items.append(dict(doc))
        return SimpleNamespace(inserted_id=doc.get("id"))


class FakeDb:
    def __init__(self, *, tournaments, registrations, matches=None, matches_v2=None, prize_pickups=None):
        self.tournaments = FakeCollection(tournaments)
        self.tournament_registrations = FakeCollection(registrations)
        self.matches = FakeCollection(matches or [])
        self.matches_v2 = FakeCollection(matches_v2 or [])
        self.prize_pickups = FakeCollection(prize_pickups or [])


def test_auto_create_tournament_prizes_from_stage_standings(monkeypatch):
    db = FakeDb(
        tournaments=[{
            "id": "t1",
            "title": "Stage Cup",
            "slug": "stage-cup",
            "prize_places": [{"group": "overall", "place": 1, "label": "Sieger", "value": "Pokal"}],
        }],
        registrations=[
            {"id": "reg-a", "tournament_id": "t1", "team_id": "team-a"},
            {"id": "reg-b", "tournament_id": "t1", "team_id": "team-b"},
        ],
        matches_v2=[{
            "id": "m1",
            "tournament_id": "t1",
            "status": "completed",
            "round": 1,
            "section": "MAIN",
            "results": [
                {"registration_id": "reg-a", "rank": 1, "points": 10},
                {"registration_id": "reg-b", "rank": 2, "points": 7},
            ],
        }],
    )
    monkeypatch.setattr(prize_service, "get_db", lambda: db)

    created = asyncio.run(prize_service.auto_create_for_tournament("t1"))
    created_again = asyncio.run(prize_service.auto_create_for_tournament("t1"))

    assert created == 1
    assert created_again == 0
    assert db.prize_pickups.items[0]["team_id"] == "team-a"
    assert db.prize_pickups.items[0]["prize_value"] == "Pokal"
    assert db.prize_pickups.items[0]["prize_group"] == "overall"


def test_auto_create_tournament_prizes_supports_grouped_stage_prizes(monkeypatch):
    db = FakeDb(
        tournaments=[{
            "id": "t2",
            "title": "Bracket Cup",
            "slug": "bracket-cup",
            "prize_places": [
                {"group": "winner", "place": 1, "label": "Winner Bracket", "value": "Gold"},
                {"group": "loser", "place": 1, "label": "Loser Bracket", "value": "Bronze"},
                {"group": "special", "place": 1, "label": "Sonderpreis", "value": "Skip"},
            ],
        }],
        registrations=[
            {"id": "reg-a", "tournament_id": "t2", "team_id": "team-a"},
            {"id": "reg-b", "tournament_id": "t2", "team_id": "team-b"},
            {"id": "reg-c", "tournament_id": "t2", "team_id": "team-c"},
        ],
        matches_v2=[
            {
                "id": "m-wb",
                "tournament_id": "t2",
                "status": "completed",
                "round": 2,
                "section": "WB",
                "results": [
                    {"registration_id": "reg-a", "rank": 1},
                    {"registration_id": "reg-b", "rank": 2},
                ],
            },
            {
                "id": "m-lb",
                "tournament_id": "t2",
                "status": "completed",
                "round": 1,
                "section": "LB",
                "results": [
                    {"registration_id": "reg-c", "rank": 1},
                    {"registration_id": "reg-b", "rank": 2},
                ],
            },
        ],
    )
    monkeypatch.setattr(prize_service, "get_db", lambda: db)

    created = asyncio.run(prize_service.auto_create_for_tournament("t2"))

    assert created == 2
    by_group = {item["prize_group"]: item for item in db.prize_pickups.items}
    assert by_group["winner"]["team_id"] == "team-a"
    assert by_group["loser"]["team_id"] == "team-c"
    assert "special" not in by_group
