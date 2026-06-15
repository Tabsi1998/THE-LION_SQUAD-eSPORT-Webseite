import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import routes.setup_routes as setup_routes


class _AsyncCursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    async def to_list(self, *args, **kwargs):
        return self.rows

    def __aiter__(self):
        self._iter = iter(self.rows)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class _Collection:
    def __init__(self, rows=None, one=None):
        self.rows = rows or []
        self.one = one

    async def find_one(self, *args, **kwargs):
        return self.one

    def find(self, *args, **kwargs):
        return _AsyncCursor(self.rows)


class _SitemapDb:
    settings = _Collection(one={"domain": "https://example.test", "club_name": "THE LION SQUAD"})
    tournaments = _Collection(rows=[{"slug": "summer-cup", "updated_at": "2026-05-20T12:00:00Z"}])
    f1_challenges = _Collection()
    seasons = _Collection()
    events = _Collection()
    news_posts = _Collection()
    club_member_profiles = _Collection()
    teams = _Collection()
    references = _Collection()
    gallery_albums = _Collection()


def test_sitemap_lists_public_tournament_subpages(monkeypatch):
    monkeypatch.setattr(setup_routes, "get_db", lambda: _SitemapDb())

    response = asyncio.run(setup_routes.sitemap())
    body = response.body.decode("utf-8")

    assert "<loc>https://example.test/esports</loc>" in body
    assert "<loc>https://example.test/tournaments/summer-cup</loc>" in body
    assert "<loc>https://example.test/tournaments/summer-cup/bracket</loc>" in body
    assert "<loc>https://example.test/tournaments/summer-cup/matches</loc>" in body
    assert "<loc>https://example.test/tournaments/summer-cup/standings</loc>" in body
    assert "<lastmod>2026-05-20</lastmod>" in body
