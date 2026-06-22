import asyncio
from types import SimpleNamespace

from services import prize_service


class FakeCursor:
    def __init__(self, items):
        self.items = list(items)

    def sort(self, key, direction):
        reverse = direction < 0
        return FakeCursor(sorted(self.items, key=lambda item: item.get(key, 0), reverse=reverse))

    async def to_list(self, _limit):
        return list(self.items)


class FakeCollection:
    def __init__(self, items=None):
        self.items = list(items or [])

    def _matches(self, item, query):
        for key, expected in (query or {}).items():
            if key == "$or":
                if not any(self._matches(item, option) for option in expected):
                    return False
                continue
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
    def __init__(
        self,
        *,
        tournaments=None,
        registrations=None,
        matches=None,
        matches_v2=None,
        prize_pickups=None,
        f1_challenges=None,
        f1_tracks=None,
        f1_lap_times=None,
    ):
        self.f1_challenges = FakeCollection(f1_challenges or [])
        self.f1_tracks = FakeCollection(f1_tracks or [])
        self.f1_lap_times = FakeCollection(f1_lap_times or [])
        self.tournaments = FakeCollection(tournaments)
        self.tournament_registrations = FakeCollection(registrations or [])
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


def test_auto_create_fastlap_prizes_per_track(monkeypatch):
    db = FakeDb(
        f1_challenges=[{
            "id": "f1",
            "title": "Fast Lap Cup",
            "slug": "fast-lap-cup",
            "prize_places": [
                {"place": 1, "label": "Sieger", "value": "Pokal"},
                {"place": 2, "label": "Zweiter", "value": "Medaille"},
            ],
        }],
        f1_tracks=[{"id": "spa", "challenge_id": "f1", "name": "Spa", "order_index": 1}],
        f1_lap_times=[
            {"challenge_id": "f1", "track_id": "spa", "user_id": "u1", "time_ms": 91111, "status": "approved"},
            {"challenge_id": "f1", "track_id": "spa", "user_id": "u2", "time_ms": 92222, "status": "approved"},
            {"challenge_id": "f1", "track_id": "spa", "user_id": "u3", "time_ms": 89999, "is_invalid": True},
        ],
    )
    monkeypatch.setattr(prize_service, "get_db", lambda: db)

    created = asyncio.run(prize_service.auto_create_for_f1_challenge("f1"))
    created_again = asyncio.run(prize_service.auto_create_for_f1_challenge("f1"))

    assert created == 2
    assert created_again == 0
    assert [item["user_id"] for item in db.prize_pickups.items] == ["u1", "u2"]
    assert all(item["source_type"] == "fastlap" for item in db.prize_pickups.items)
    assert all(item["fastlap_source_key"] == "track:spa" for item in db.prize_pickups.items)


def test_auto_create_fastlap_championship_prize(monkeypatch):
    db = FakeDb(
        f1_challenges=[{
            "id": "f1-champ",
            "title": "Fast Lap Championship",
            "is_championship": True,
            "points_per_position": [10, 5],
            "prize_places": [{"place": 1, "label": "Gesamtsieger", "value": "Trophäe"}],
        }],
        f1_tracks=[
            {"id": "red-bull-ring", "challenge_id": "f1-champ", "name": "Red Bull Ring", "order_index": 1},
            {"id": "monza", "challenge_id": "f1-champ", "name": "Monza", "order_index": 2},
        ],
        f1_lap_times=[
            {"challenge_id": "f1-champ", "track_id": "red-bull-ring", "user_id": "u1", "time_ms": 70000},
            {"challenge_id": "f1-champ", "track_id": "red-bull-ring", "user_id": "u2", "time_ms": 69000},
            {"challenge_id": "f1-champ", "track_id": "monza", "user_id": "u2", "time_ms": 80000},
            {"challenge_id": "f1-champ", "track_id": "monza", "user_id": "u1", "time_ms": 82000},
            {"challenge_id": "f1-champ", "track_id": "monza", "user_id": "club-ref", "time_ms": 65000, "score_scope": "club_reference"},
        ],
    )
    monkeypatch.setattr(prize_service, "get_db", lambda: db)

    created = asyncio.run(prize_service.auto_create_for_f1_challenge("f1-champ"))

    assert created == 1
    assert db.prize_pickups.items[0]["user_id"] == "u2"
    assert db.prize_pickups.items[0]["fastlap_source_key"] == "championship"
    assert db.prize_pickups.items[0]["fastlap_source_label"] == "Gesamtwertung"
