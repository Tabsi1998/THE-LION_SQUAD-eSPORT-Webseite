"""Die Test-Mongo beachtet ``to_list(length)`` wie Motor (#2357).

mongomock_motor gab bei ``to_list(n)`` alle Treffer zurück. Eine zu knappe Begrenzung ohne passende Sortierung fiel
lokal deshalb nie auf. ``conftest`` setzt die Hülle aus ``mongomock_to_list`` für jeden Testprozess.
"""
import pytest
import pytest_asyncio
from mongomock_motor import AsyncMongoMockClient

import mongomock_to_list


@pytest_asyncio.fixture
async def rows():
    collection = AsyncMongoMockClient()["to_list_hülle"]["eintraege"]
    await collection.insert_many([{"id": index, "gruppe": index % 2} for index in range(5)])
    return collection


def ids(documents):
    return [document["id"] for document in documents]


def test_conftest_installs_the_wrapper_for_every_cursor():
    assert mongomock_to_list.installed()


def test_installing_twice_keeps_one_layer(monkeypatch):
    import mongomock_motor

    for cursor in (mongomock_motor.AsyncCursor, mongomock_motor.AsyncCommandCursor,
                   mongomock_motor.AsyncLatentCommandCursor):
        monkeypatch.setattr(cursor, "to_list", cursor.to_list)  # nach dem Test wieder wie vorher
    before = mongomock_motor.AsyncCursor.to_list
    mongomock_to_list.install()
    assert mongomock_motor.AsyncCursor.to_list is before


@pytest.mark.asyncio
async def test_length_caps_the_result_positional_and_keyword(rows):
    positional = await rows.find({}, {"_id": 0}).sort("id", 1).to_list(2)
    keyword = await rows.find({}, {"_id": 0}).sort("id", 1).to_list(length=3)

    assert ids(positional) == [0, 1]
    assert ids(keyword) == [0, 1, 2]


@pytest.mark.asyncio
async def test_length_takes_the_first_after_sorting(rows):
    newest = await rows.find({}, {"_id": 0}).sort("id", -1).to_list(2)

    assert ids(newest) == [4, 3]


@pytest.mark.asyncio
async def test_none_or_nothing_returns_everything(rows):
    assert len(await rows.find().to_list(None)) == 5
    assert len(await rows.find().to_list(length=None)) == 5
    assert len(await rows.find().to_list()) == 5


@pytest.mark.asyncio
async def test_zero_returns_an_empty_list_like_motor(rows):
    """Motor 3.7 (``core.py``, ``_to_list``): ``n = min(0 - 0, …)``, die Länge gilt sofort als erreicht."""
    assert await rows.find().to_list(0) == []
    assert await rows.find().to_list(length=0) == []


@pytest.mark.asyncio
async def test_next_call_continues_where_the_last_one_stopped(rows):
    cursor = rows.find({}, {"_id": 0}).sort("id", 1)

    pages = [ids(await cursor.to_list(2)) for _ in range(4)]

    assert pages == [[0, 1], [2, 3], [4], []]


@pytest.mark.asyncio
async def test_invalid_length_is_rejected_like_motor(rows):
    with pytest.raises(ValueError):
        await rows.find().to_list(-1)
    with pytest.raises(TypeError):
        await rows.find().to_list(2.0)
    with pytest.raises(TypeError):
        await rows.find().to_list("2")


@pytest.mark.asyncio
async def test_aggregation_cursor_respects_length(rows):
    pipeline = [{"$match": {"gruppe": 0}}, {"$sort": {"id": -1}}, {"$project": {"_id": 0, "id": 1}}]

    capped = await rows.aggregate(pipeline).to_list(2)
    everything = await rows.aggregate(pipeline).to_list(None)
    empty = await rows.aggregate(pipeline).to_list(0)

    assert ids(capped) == [4, 2]
    assert ids(everything) == [4, 2, 0]
    assert empty == []


@pytest.mark.asyncio
async def test_aggregation_cursor_continues_like_motor(rows):
    cursor = rows.aggregate([{"$sort": {"id": 1}}, {"$project": {"_id": 0, "id": 1}}])

    assert ids(await cursor.to_list(3)) == [0, 1, 2]
    assert ids(await cursor.to_list(3)) == [3, 4]


@pytest.mark.asyncio
async def test_index_list_respects_length(rows):
    await rows.create_index("id")

    assert len(await rows.list_indexes().to_list(None)) == 2
    assert len(await rows.list_indexes().to_list(1)) == 1
