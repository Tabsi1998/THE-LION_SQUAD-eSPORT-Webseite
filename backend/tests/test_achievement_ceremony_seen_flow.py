"""Zeremonie einmal je Konto (#2450): „gesehen“ steht am Server, nicht mehr nur im Gerät.

Vorher kam dieselbe Zeremonie in der App, am PC und im Handy-Browser je einmal. Jetzt gilt: gesehen setzen und lesen,
mehrfach ohne Wirkung; nur die eigenen Vergaben; zwei Geräte gleichzeitig - schließt das eine, zeigt das andere bei der
Prüfung vor dem Anzeigen nichts mehr. Der Altbestand flutet nach dem Deploy nicht: ältere Vergaben ohne Wissen eines
Geräts bleiben still, was ein Gerät einmalig meldet, gilt am Konto. Nur lesen legt nichts an.
"""
import asyncio
import os
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from bson import ObjectId

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

from services import achievement_ceremony  # noqa: E402

STATE = "/api/achievements/me/ceremony"
SEEN = "/api/achievements/me/ceremony/seen"
IMPORT = "/api/achievements/me/ceremony/import"
LEVEL = {"level": 12, "title": "Rudelführer", "prestige": 0}


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    levels = {}

    async def current_level(db, user_id):
        return dict(levels.get(user_id) or LEVEL)

    monkeypatch.setattr(achievement_ceremony, "_current_level", current_level)
    instance.levels = levels
    try:
        yield instance
    finally:
        await shutdown()


async def award(flow, user, code, *, age=timedelta(0), created_age=None, **extra):
    """Eine Vergabe - ``age`` verschiebt ``earned_at``, ``created_age`` den Zeitpunkt des Anlegens (``_id``)."""
    now = datetime.now(timezone.utc)
    created = now - (created_age if created_age is not None else age)
    # Zeitstempel der _id wie beim Anlegen, der Rest zufällig - sonst gleichen sich zwei Kennungen derselben Sekunde.
    oid = ObjectId(ObjectId.from_datetime(created).binary[:4] + os.urandom(8))
    doc = {"_id": oid, "id": f"{user['id']}-{code}", "user_id": user["id"], "tier_code": code,
           "group_code": code.split("_")[0], "earned_at": (now - age).isoformat(), **extra}
    await flow.db.user_achievements.insert_one(doc)
    return doc


async def state(flow, user):
    flow.act_as(user)
    res = await flow.get(STATE)
    assert res.status_code == 200, res.text
    return res.json()


async def start(flow, user, **body):
    """Die erste Meldung eines Geräts - erst sie legt die Zeile an (wie Website und App beim ersten Laden)."""
    flow.act_as(user)
    res = await flow.post(IMPORT, json=body)
    assert res.status_code == 200, res.text
    return res.json()


async def seen(flow, user, **body):
    flow.act_as(user)
    res = await flow.post(SEEN, json=body)
    assert res.status_code == 200, res.text
    return res.json()


@pytest.mark.asyncio
async def test_seen_is_set_read_and_idempotent(flow):
    person = await flow.add_user()
    # Nur lesen legt nichts an: ohne Meldung eines Geräts ist alles Altbestand.
    before = await state(flow, person)
    assert before == {"since": None, "unseen": [], "level": LEVEL, "recount_seen": []}
    assert await flow.db.ceremony_seen.count_documents({}) == 0
    first = await start(flow, person)
    assert first["since"] and first["unseen"] == [] and first["level"] == LEVEL and first["recount_seen"] == []
    await award(flow, person, "sieger_1")
    await award(flow, person, "sieger_2")
    assert sorted((await state(flow, person))["unseen"]) == ["sieger_1", "sieger_2"]

    once = await seen(flow, person, codes=["sieger_1", "sieger_2"])
    twice = await seen(flow, person, codes=["sieger_1", "sieger_2"])
    assert (once["seen"], twice["seen"]) == (2, 0)
    assert (await state(flow, person))["unseen"] == []
    stored = await flow.db.user_achievements.find_one({"user_id": person["id"], "tier_code": "sieger_1"})
    assert stored["ceremony_seen_at"]
    # Der Beginn steht fest - weitere Abrufe und Meldungen verschieben ihn nicht.
    assert (await start(flow, person))["since"] == first["since"]
    assert await flow.db.ceremony_seen.count_documents({"user_id": person["id"]}) == 1


@pytest.mark.asyncio
async def test_only_the_own_awards_count(flow):
    owner, other = await flow.add_user(), await flow.add_user()
    await start(flow, owner)
    await start(flow, other)
    await award(flow, owner, "sieger_1")

    # Fremde Kennungen: nichts gesetzt, beim Eigentümer weiter ungesehen.
    assert (await seen(flow, other, codes=["sieger_1"]))["seen"] == 0
    assert (await state(flow, owner))["unseen"] == ["sieger_1"]
    assert (await state(flow, other))["unseen"] == []
    stored = await flow.db.user_achievements.find_one({"user_id": owner["id"]})
    assert "ceremony_seen_at" not in stored
    # Ein fremder Level-Stand oder eine fremde Neuberechnung landet nur in der eigenen Zeile.
    await seen(flow, other, recount_marker="lauf-1")
    assert (await state(flow, owner))["recount_seen"] == []
    assert (await state(flow, other))["recount_seen"] == ["lauf-1"]

    flow.act_as(None)
    assert (await flow.get(STATE)).status_code == 401
    assert (await flow.post(SEEN, json={"codes": ["sieger_1"]})).status_code == 401
    assert (await flow.post(IMPORT, json={"seen_until": "2026-01-01T00:00:00+00:00"})).status_code == 401


@pytest.mark.asyncio
async def test_two_devices_at_once(flow):
    person = await flow.add_user()
    await start(flow, person)
    await award(flow, person, "sieger_1")
    # Beide Geräte laden gleichzeitig und kennen dieselbe ungesehene Stufe.
    phone, desktop = await asyncio.gather(state(flow, person), state(flow, person))
    assert phone["unseen"] == desktop["unseen"] == ["sieger_1"]
    # Das Handy schließt die Zeremonie, der PC prüft vor dem Anzeigen noch einmal: nichts mehr da.
    await seen(flow, person, codes=["sieger_1"])
    assert (await state(flow, person))["unseen"] == []
    # Schließen beide fast gleichzeitig, bleibt es bei einem Vermerk.
    await award(flow, person, "sieger_2")
    results = await asyncio.gather(seen(flow, person, codes=["sieger_2"]), seen(flow, person, codes=["sieger_2"]))
    assert sorted(row["seen"] for row in results) == [0, 1]


@pytest.mark.asyncio
async def test_no_flood_after_the_deploy(flow):
    person = await flow.add_user()
    # Altbestand: vor dem ersten Abruf am Server angelegt, ohne ceremony_seen_at.
    await award(flow, person, "alt_1", age=timedelta(days=40))
    await award(flow, person, "alt_2", age=timedelta(days=3))
    # Ein Gerät ohne Merker meldet sich zum ersten Mal: nichts Altes kommt.
    assert (await start(flow, person))["unseen"] == []
    assert (await state(flow, person))["unseen"] == []
    # Neu nach der ersten Meldung - auch mit zurückdatiertem earned_at (Vergabe in der Verwaltung) - zählt.
    await award(flow, person, "neu_1", age=timedelta(days=10), created_age=timedelta(0))
    assert (await state(flow, person))["unseen"] == ["neu_1"]
    # Stille und nachgerechnete Stufen feiert die Einzel-Zeremonie nie.
    await award(flow, person, "still_1", silent=True)
    await award(flow, person, "nach_1", recount=True)
    assert (await state(flow, person))["unseen"] == ["neu_1"]


@pytest.mark.asyncio
async def test_device_report_is_idempotent_and_keeps_its_catch_up(flow):
    person = await flow.add_user()
    flow.act_as(person)
    await award(flow, person, "alt_1", age=timedelta(days=40))
    await award(flow, person, "alt_2", age=timedelta(days=3))
    # Ein Gerät kannte alles bis vor zehn Tagen als gesehen: alt_1 gilt am Konto als gesehen, alt_2 holt die
    # Sammel-Zeremonie wie bisher nach.
    body = {"seen_until": (datetime.now(timezone.utc) - timedelta(days=10)).isoformat(),
            "level": {"level": 10, "title": "Jäger", "prestige": 0}, "recount_markers": ["lauf-1"]}
    first = (await flow.post(IMPORT, json=body)).json()
    again = (await flow.post(IMPORT, json=body)).json()
    assert first["unseen"] == again["unseen"] == ["alt_2"]
    assert first["level"] == again["level"] == {"level": 10, "title": "Jäger", "prestige": 0}
    assert first["recount_seen"] == again["recount_seen"] == ["lauf-1"]
    assert (await flow.db.user_achievements.find_one({"tier_code": "alt_1"}))["ceremony_seen_at"]
    # Ein zweites Gerät, das alles bis gestern gesehen hatte, meldet sich: alt_2 ist damit am Konto gesehen.
    later = {"seen_until": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(), "level": {"level": 11, "title": "", "prestige": 0}}
    after = (await flow.post(IMPORT, json=later)).json()
    assert after["unseen"] == [] and after["level"]["level"] == 11
    # Ein älterer Stand senkt den gesehenen Level nicht.
    assert (await flow.post(IMPORT, json={"level": {"level": 3, "title": "", "prestige": 0}})).json()["level"]["level"] == 11
    # Ein Zeitpunkt in der Zukunft gilt höchstens als jetzt; Unsinn wird übergangen.
    assert (await flow.post(IMPORT, json={"seen_until": "kein Datum"})).status_code == 200


@pytest.mark.asyncio
async def test_level_seen_is_raised_never_past_the_real_level(flow):
    person = await flow.add_user()
    flow.levels[person["id"]] = {"level": 5, "title": "Welpe", "prestige": 0}
    assert (await start(flow, person))["level"]["level"] == 5
    flow.levels[person["id"]] = {"level": 6, "title": "Welpe", "prestige": 0}
    # Noch nicht geschlossen: der gesehene Stand bleibt 5 - jedes Gerät kann den Aufstieg zeigen.
    assert (await state(flow, person))["level"]["level"] == 5
    await seen(flow, person, level={"level": 6, "title": "Welpe", "prestige": 0})
    assert (await state(flow, person))["level"]["level"] == 6
    # Mehr als den echten Stand nimmt der Server nicht an, weniger senkt nichts.
    await seen(flow, person, level={"level": 50, "title": "", "prestige": 3})
    assert (await state(flow, person))["level"] == {"level": 6, "title": "Welpe", "prestige": 0}
    await seen(flow, person, level={"level": 2, "title": "", "prestige": 0})
    assert (await state(flow, person))["level"]["level"] == 6
    # Prestige gemacht und gesehen, dann zurückgenommen: der Stand rückt mit, ein neues Prestige wird wieder gefeiert.
    flow.levels[person["id"]] = {"level": 1, "title": "", "prestige": 1}
    await seen(flow, person, level={"level": 1, "title": "", "prestige": 1})
    flow.levels[person["id"]] = {"level": 60, "title": "Legende", "prestige": 0}
    assert (await state(flow, person))["level"] == {"level": 60, "title": "Legende", "prestige": 0}


@pytest.mark.asyncio
async def test_bad_bodies_are_refused(flow):
    person = await flow.add_user()
    flow.act_as(person)
    res = await flow.post(SEEN, json={"codes": [f"c{n}" for n in range(201)]})
    assert res.status_code == 422
    res = await flow.post(SEEN, json={"level": {"level": 0}})
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_a_catalog_migration_does_not_flood(flow):
    """Eine Katalog-Migration legt Vergaben mit neuer _id neu an - das sind alte Erfolge, keine neuen."""
    from services import achievement_migration

    person = await flow.add_user()
    await flow.db.achievements.insert_many([
        {"code": "mentor_alt_1", "group_code": "mentor", "name": "Mentor alt", "level": 1},
        {"code": "mentor_1", "group_code": "mentor", "name": "Mentor I", "level": 1, "manual_only": True},
    ])
    await award(flow, person, "mentor_alt_1", age=timedelta(days=90), level=1)
    assert (await start(flow, person))["unseen"] == []

    async def no_counters(_user_id):
        return {}

    await achievement_migration.apply_redefined(flow.db, {"mentor": ["mentor_alt_1"]}, compute_progress=no_counters)
    moved = await flow.db.user_achievements.find_one({"user_id": person["id"], "tier_code": "mentor_1"})
    assert moved and moved.get("migrated_at")
    assert (await state(flow, person))["unseen"] == []
