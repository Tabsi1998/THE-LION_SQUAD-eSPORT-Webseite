"""Gelesen und gesehen (#616): der Gelesen-Marker zählt genau das, was die Person auf der Seite lesen kann -
angelegt über die echte Verwaltung, damit Test und Seite dieselbe Sammlung meinen. Der Zuschauer-Ping nimmt
nur Kennungen echter Streams und ist je Tag gedeckelt."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from routes import achievement_signal_routes as signal_routes  # noqa: E402
from services import achievement_counters as counters  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def publish(flow, staff, **fields) -> dict:
    flow.act_as(staff)
    res = await flow.post("/api/news", json={"content": "Text des Beitrags.", **fields})
    assert res.status_code == 200, res.text
    return res.json()


@pytest.mark.asyncio
async def test_gelesen_zaehlt_was_die_seite_auch_zeigt(flow):
    staff = await flow.add_staff("Redaktion")
    reader = await flow.add_user(name="Leserin")
    post = await publish(flow, staff, title="Sommer-Cup", slug="sommer-cup")
    await publish(flow, staff, title="Entwurf", slug="entwurf", published=False)
    await publish(flow, staff, title="Morgen", slug="morgen", published_at=(now_utc() + timedelta(days=1)).isoformat())
    await publish(flow, staff, title="Nur Mitglieder", slug="nur-mitglieder", visibility="members")
    await publish(flow, staff, title="Intern", slug="intern", visibility="internal")

    flow.act_as(reader)
    # Die Seite holt den Beitrag und meldet ihn gelesen - beides muss denselben Beitrag finden.
    assert (await flow.get("/api/news/sommer-cup")).json()["id"] == post["id"]
    assert (await flow.post("/api/news/sommer-cup/read")).json() == {"read": True, "total": 1}
    assert (await flow.post(f"/api/news/{post['id']}/read")).json()["total"] == 1
    for hidden in ("entwurf", "morgen", "nur-mitglieder", "intern", "gibt-es-nicht"):
        assert (await flow.post(f"/api/news/{hidden}/read")).status_code == 404, hidden
    assert await flow.db.news_reads.count_documents({"user_id": reader["id"]}) == 1
    assert (await counters.compute(reader["id"]))["news_read"] == 1
    queued = await flow.db.achievement_eval_queue.find_one({"user_id": reader["id"]}, {"_id": 0})
    assert queued and "community" in queued["sources"]

    # Auch die Verwaltung zählt einen Entwurf nicht als gelesen.
    flow.act_as(staff)
    assert (await flow.post("/api/news/entwurf/read")).status_code == 404
    assert (await flow.post("/api/news/nur-mitglieder/read")).json()["total"] == 1


@pytest.mark.asyncio
async def test_gelesen_findet_den_beitrag_auch_unter_der_alten_adresse(flow):
    staff = await flow.add_staff("Redaktion")
    reader = await flow.add_user(name="Leserin")
    post = await publish(flow, staff, title="Wintercup", slug="wintercup")
    assert (await flow.patch(f"/api/news/{post['id']}", json={"slug": "wintercup-2026"})).status_code == 200
    flow.act_as(reader)
    assert (await flow.post("/api/news/wintercup/read")).json() == {"read": True, "total": 1}
    assert (await flow.post("/api/news/wintercup-2026/read")).json()["total"] == 1


def test_kennung_eines_streams():
    assert signal_routes.watch_key(" Twitch:The_Lion_Squad ") == "twitch:the_lion_squad"
    assert signal_routes.watch_key("youtube:dQw4w9WgXcQ") == "youtube:dqw4w9wgxcq"
    assert signal_routes.watch_key("kick:lion.squad") == "kick:lion.squad"
    assert signal_routes.watch_key("twitch:" + "x" * 64) == "twitch:" + "x" * 64
    for broken in ("", "twitch", "twitch:", "twitch:a", "twitch:a b", "twitch:löwe", "vimeo:kanal", "twitch:" + "x" * 65, "twitch:a:b", "https://twitch.tv/lion", None):
        assert signal_routes.watch_key(broken) == "", broken


@pytest.mark.asyncio
async def test_zuschauer_ping_nimmt_nur_echte_streams_und_ist_gedeckelt(flow):
    viewer = await flow.add_user(name="Zuschauerin")
    flow.act_as(viewer)
    assert (await flow.post("/api/streams/watch", json={"key": "Twitch:The_Lion_Squad"})).json() == {"watched": True, "total": 1}
    assert (await flow.post("/api/streams/watch", json={"key": "twitch:the_lion_squad"})).json()["total"] == 1
    assert (await flow.db.stream_watches.find_one({"user_id": viewer["id"]}, {"_id": 0}))["key"] == "twitch:the_lion_squad"
    for broken in ("irgendwas", "twitch:", "twitch:a b", "vimeo:kanal", "twitch:" + "x" * 80, "https://twitch.tv/lion"):
        assert (await flow.post("/api/streams/watch", json={"key": broken})).status_code in (400, 422), broken
    assert (await flow.post("/api/streams/watch", json={"key": "youtube:dQw4w9WgXcQ"})).json()["total"] == 2
    assert (await flow.post("/api/streams/watch", json={"key": "kick:lion.squad"})).json()["total"] == 3

    # Den Tag direkt in der Sammlung füllen, damit die Bremse für zu viele Anfragen nicht mitspielt.
    day = now_utc().astimezone(counters.VIENNA).date().isoformat()
    for index in range(signal_routes.WATCHES_PER_DAY - 3):
        await flow.db.stream_watches.insert_one({"user_id": viewer["id"], "key": f"twitch:kanal_{index}", "day": day, "at": now_utc().isoformat()})
    full = await flow.post("/api/streams/watch", json={"key": "twitch:noch_einer"})
    assert full.json() == {"watched": False, "reason": "cap", "total": signal_routes.WATCHES_PER_DAY}
    # Ein Stream, der heute schon zählt, bleibt auch nach dem Deckel ein Treffer - ohne neue Zeile.
    assert (await flow.post("/api/streams/watch", json={"key": "kick:lion.squad"})).json() == {"watched": True, "total": signal_routes.WATCHES_PER_DAY}
    assert (await counters.compute(viewer["id"]))["streams_watched"] == signal_routes.WATCHES_PER_DAY

    flow.act_as(None)
    assert (await flow.post("/api/streams/watch", json={"key": "twitch:the_lion_squad"})).status_code == 401
