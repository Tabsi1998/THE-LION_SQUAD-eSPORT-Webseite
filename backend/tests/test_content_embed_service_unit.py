import pathlib
import sys
import asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.content_embed_service import resolve_content_embeds


class FakeCursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, field, direction):
        reverse = direction < 0
        self.docs = sorted(self.docs, key=lambda doc: doc.get(field, 0), reverse=reverse)
        return self

    async def to_list(self, limit):
        return self.docs[:limit]


class FakeCollection:
    def __init__(self, docs):
        self.docs = docs

    def find(self, *_args, **_kwargs):
        return FakeCursor(self.docs)


class FakeDb:
    def __init__(self):
        self.f1_challenges = FakeCollection([
            {
                "id": "challenge-1",
                "slug": "monza-night",
                "title": "Monza Night",
                "description": "Hotlap Event",
                "status": "published",
                "banner_url": "/media/challenge.jpg",
                "visibility": "public",
            }
        ])
        self.f1_tracks = FakeCollection([
            {
                "id": "track-2",
                "challenge_id": "challenge-1",
                "name": "Second Track",
                "image_url": "/media/second-track.jpg",
                "order_index": 2,
            },
            {
                "id": "track-1",
                "challenge_id": "challenge-1",
                "name": "Monza",
                "image_url": "/media/monza.jpg",
                "order_index": 1,
            },
        ])


def test_fastlap_embed_uses_first_track_image():
    embeds = asyncio.run(resolve_content_embeds(FakeDb(), "Racing [[fastlap:monza-night]]", None))

    assert len(embeds) == 1
    item = embeds[0]["item"]
    assert item["track_image_url"] == "/media/monza.jpg"
    assert item["banner_url"] == "/media/monza.jpg"
    assert item["track"]["name"] == "Monza"
