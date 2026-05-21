import asyncio
import pathlib
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.access_links import access_path, hash_access_token, new_access_token, validate_access_link


class FakeCollection:
    def __init__(self, row):
        self.row = row

    async def find_one(self, query, projection=None):
        if (
            self.row
            and query.get("token_hash") == self.row.get("token_hash")
            and query.get("target_type") == self.row.get("target_type")
            and query.get("target_id") == self.row.get("target_id")
            and self.row.get("is_active") is not False
        ):
            return dict(self.row)
        return None


class FakeDb:
    def __init__(self, link):
        self.access_links = FakeCollection(link)


def test_access_token_is_hashed_and_link_path_contains_token_once():
    token = new_access_token()
    digest = hash_access_token(token)

    assert token not in digest
    assert len(digest) == 64
    assert access_path("tournament", {"slug": "winter-cup"}, token) == f"/tournaments/winter-cup?access={token}"


def test_validate_access_link_accepts_grant_and_user_binding():
    token = "secret-token"
    link = {
        "id": "al_1",
        "target_type": "event",
        "target_id": "ev_1",
        "token_hash": hash_access_token(token),
        "grants": ["view", "register"],
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "max_uses": 2,
        "use_count": 1,
        "user_id": "user_1",
        "is_active": True,
    }

    result = asyncio.run(validate_access_link(FakeDb(link), token, "event", "ev_1", {"id": "user_1"}, "register"))

    assert result["id"] == "al_1"


def test_validate_access_link_rejects_wrong_grant_or_user():
    token = "secret-token"
    link = {
        "id": "al_1",
        "target_type": "event",
        "target_id": "ev_1",
        "token_hash": hash_access_token(token),
        "grants": ["view"],
        "user_id": "user_1",
        "is_active": True,
    }

    wrong_grant = asyncio.run(validate_access_link(FakeDb(link), token, "event", "ev_1", {"id": "user_1"}, "register"))
    wrong_user = asyncio.run(validate_access_link(FakeDb(link), token, "event", "ev_1", {"id": "user_2"}, "view"))

    assert wrong_grant is None
    assert wrong_user is None
