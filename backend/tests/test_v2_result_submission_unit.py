import asyncio
from copy import deepcopy
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.v2_result_submission import submit_v2_result


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, _limit):
        return deepcopy(self.rows)


class _Matches:
    def __init__(self, rows):
        self.rows = {row["id"]: deepcopy(row) for row in rows}
        self.update_count = 0

    def find(self, query, _projection=None):
        return _Cursor([
            row for row in self.rows.values()
            if row.get("stage_id") == query.get("stage_id")
        ])

    async def update_one(self, query, update):
        self.update_count += 1
        self.rows[query["id"]].update(deepcopy(update["$set"]))

    async def find_one(self, query, _projection=None):
        row = self.rows.get(query["id"])
        return deepcopy(row) if row else None


class _Inserts:
    def __init__(self):
        self.docs = []

    async def insert_one(self, doc):
        self.docs.append(deepcopy(doc))

    async def update_one(self, query, update, upsert=False):
        existing = next((doc for doc in self.docs if all(doc.get(k) == v for k, v in query.items())), None)
        if existing is None and upsert:
            self.docs.append(deepcopy(update.get("$setOnInsert") or {}))


class _Db:
    def __init__(self, rows):
        self.matches_v2 = _Matches(rows)
        self.match_reports_v2 = _Inserts()
        self.audit_logs = _Inserts()


def _source_match():
    return {
        "id": "match-a",
        "tournament_id": "t1",
        "stage_id": "stage-1",
        "match_key": "A",
        "status": "ready",
        "settings": {"min_players": 2},
        "slots": [
            {"slot": 1, "registration_id": "reg-1", "user_id": "user-1", "status": "filled"},
            {"slot": 2, "registration_id": "reg-2", "user_id": "user-2", "status": "filled"},
        ],
        "advancement": [
            {"flow": "W", "rank": 1, "to_match_id": "match-b", "to_match_key": "B", "to_slot": 1},
        ],
    }


def _target_match():
    return {
        "id": "match-b",
        "tournament_id": "t1",
        "stage_id": "stage-1",
        "match_key": "B",
        "status": "pending",
        "settings": {"min_players": 2},
        "slots": [
            {"slot": 1, "registration_id": None, "user_id": None, "status": "pending"},
            {"slot": 2, "registration_id": None, "user_id": None, "status": "pending"},
        ],
    }


RESULTS = [
    {"registration_id": "reg-1", "score": 2},
    {"registration_id": "reg-2", "score": 0},
]


def test_submit_v2_result_replay_has_no_second_side_effect():
    async def scenario():
        db = _Db([_source_match(), _target_match()])
        first = await submit_v2_result(
            db,
            _source_match(),
            RESULTS,
            actor_id="admin-1",
            proof_url="https://example.test/proof",
            note="final",
            force=False,
            audit_action="match.result.submit",
        )
        completed = await db.matches_v2.find_one({"id": "match-a"})
        second = await submit_v2_result(
            db,
            completed,
            RESULTS,
            actor_id="admin-1",
            proof_url="https://example.test/proof",
            note="final",
            force=False,
            audit_action="match.result.submit",
        )

        assert first["idempotent_replay"] is False
        assert second["idempotent_replay"] is True
        assert second["report_id"] == first["report_id"]
        assert first["report_id"].startswith("v2-result-")
        assert second["advanced_match_ids"] == ["match-b"]
        assert len(db.match_reports_v2.docs) == 1
        assert len(db.audit_logs.docs) == 1
        assert db.matches_v2.update_count == 2
        assert db.matches_v2.rows["match-b"]["slots"][0]["registration_id"] == "reg-1"

    asyncio.run(scenario())


def test_submit_v2_result_resumes_after_interrupted_source_commit():
    async def scenario():
        db = _Db([_source_match(), _target_match()])
        original_update = db.matches_v2.update_one
        failed_once = False

        async def fail_source_once(query, update):
            nonlocal failed_once
            if query["id"] == "match-a" and not failed_once:
                failed_once = True
                raise RuntimeError("simulated worker crash")
            await original_update(query, update)

        db.matches_v2.update_one = fail_source_once
        try:
            await submit_v2_result(
                db,
                _source_match(),
                RESULTS,
                actor_id="admin-1",
                proof_url=None,
                note="final",
                force=False,
                audit_action="match.result.submit",
            )
        except RuntimeError as exc:
            assert str(exc) == "simulated worker crash"
        else:
            raise AssertionError("interruption was not simulated")

        source_after_crash = await db.matches_v2.find_one({"id": "match-a"})
        assert source_after_crash["status"] == "ready"
        assert db.matches_v2.rows["match-b"]["slots"][0]["registration_id"] == "reg-1"

        resumed = await submit_v2_result(
            db,
            source_after_crash,
            RESULTS,
            actor_id="admin-1",
            proof_url=None,
            note="final",
            force=False,
            audit_action="match.result.submit",
        )

        assert resumed["idempotent_replay"] is False
        assert resumed["match"]["status"] == "completed"
        assert len(db.match_reports_v2.docs) == 1
        assert len(db.audit_logs.docs) == 1

    asyncio.run(scenario())
