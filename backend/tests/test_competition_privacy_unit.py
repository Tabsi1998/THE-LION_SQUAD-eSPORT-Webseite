import asyncio

from services.competition_privacy import (
    anonymize_registration_match_references,
    anonymized_legacy_match,
    anonymized_stage_match,
    registration_match_snapshot,
)


LEGACY = {
    "id": "legacy-1",
    "tournament_id": "t1",
    "participant_a_id": "r-delete",
    "participant_b_id": "r-keep",
    "winner_id": "r-delete",
    "loser_id": "r-keep",
    "status": "completed",
}

STAGE = {
    "id": "stage-1",
    "tournament_id": "t1",
    "stage_id": "s1",
    "round": 1,
    "slots": [
        {"slot": 1, "registration_id": "r-delete", "user_id": "u-delete", "status": "filled"},
        {"slot": 2, "registration_id": "r-keep", "user_id": "u-keep", "status": "filled"},
    ],
    "results": [
        {"registration_id": "r-delete", "rank": 1, "score": 2, "note": "private"},
        {"registration_id": "r-keep", "rank": 2, "score": 1},
    ],
    "advancement": [],
    "status": "in_progress",
}


class FakeCursor:
    def __init__(self, rows):
        self.rows = list(rows)

    async def to_list(self, limit):
        return self.rows[:limit]


class FakeCollection:
    def __init__(self, rows):
        self.rows = list(rows)
        self.updates = []

    def find(self, *_args, **_kwargs):
        return FakeCursor(self.rows)

    async def update_one(self, query, update):
        self.updates.append((query, update))


class FakeDb:
    def __init__(self):
        self.matches = FakeCollection([LEGACY])
        self.matches_v2 = FakeCollection([STAGE])


def test_privacy_projection_preserves_terminal_history_and_anonymizes_open_stage():
    legacy = anonymized_legacy_match(LEGACY, {"r-delete"}, "now")
    stage = anonymized_stage_match(STAGE, {"r-delete"}, "now")

    assert legacy == {
        "participant_a_id": None,
        "winner_id": None,
        "updated_at": "now",
    }
    assert stage["status"] == "waiting_result"
    assert stage["slots"][0]["registration_id"] is None
    assert stage["slots"][0]["user_id"] is None
    assert stage["slots"][0]["status"] == "anonymized"
    assert stage["slots"][1]["registration_id"] == "r-keep"
    assert stage["results"][0]["registration_id"] is None
    assert stage["results"][0]["note"] is None


def test_registration_export_and_database_anonymization_cover_both_stores():
    db = FakeDb()

    snapshot = asyncio.run(registration_match_snapshot(db, ["r-delete"]))
    counts = asyncio.run(anonymize_registration_match_references(
        db,
        ["r-delete"],
        updated_at="now",
    ))

    assert {match["source"]["engine"] for match in snapshot} == {"legacy", "stage"}
    exported_stage = next(match for match in snapshot if match["source"]["engine"] == "stage")
    assert all(slot["user_id"] is None for slot in exported_stage["slots"])
    assert all(result["note"] is None for result in exported_stage["results"])
    assert counts == {"legacy_matches": 1, "stage_matches": 1}
    assert db.matches.updates[0][1]["$set"]["participant_a_id"] is None
    assert db.matches_v2.updates[0][1]["$set"]["slots"][0]["status"] == "anonymized"
