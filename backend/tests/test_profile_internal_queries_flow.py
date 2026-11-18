"""Vereinsinterne Erfolge (#2516): die Mitglieder-Ansicht eines Profils fragt nicht je Eintrag neu nach.

Die Sichtbarkeit wird je Aufruf einmal je Stufe, je Season und je Liga entschieden (wie ``visibility.filter_visible``), und die
Anmeldungen für die Plätze der Referenzen kommen in einer Abfrage für alle Turniere. Gemessen wird die Zahl der Datenbank-Abfragen
auf ``/api/users/public/{name}`` - mit 4 und mit 16 internen Turnieren muss sie gleich bleiben. Dazu höchstens ein Aufruf von
``areas_for`` bzw. ``capabilities_of`` je Stufe bzw. Liga statt einer je Eintrag. Nur erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import awards  # noqa: E402

READS = ("find", "find_one", "aggregate", "count_documents", "distinct")


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


class CountingCollection:
    def __init__(self, collection, counter):
        self._collection = collection
        self._counter = counter

    def __getattr__(self, name):
        target = getattr(self._collection, name)
        if name in READS:
            def counted(*args, **kwargs):
                self._counter["reads"] += 1
                return target(*args, **kwargs)
            return counted
        return target


class CountingDb:
    def __init__(self, db, counter):
        self._db = db
        self._counter = counter

    def __getattr__(self, name):
        return CountingCollection(getattr(self._db, name), self._counter)

    def __getitem__(self, name):
        return CountingCollection(self._db[name], self._counter)


async def seed(flow, internal_count: int):
    owner = await flow.add_user(role="player", name="pixelfuchs")
    await flow.db.users.update_one({"id": owner["id"]}, {"$set": {"privacy_public_profile": True}})
    member = await flow.add_user(role="player", name="nachtfalke")
    await flow.db.memberships.insert_one({"id": "m-1", "user_id": member["id"], "member_status": "active"})
    rows = [("t-offen", "public")] + [(f"t-verein-{n}", "members") for n in range(internal_count)] \
        + [(f"t-leitung-{n}", "internal") for n in range(internal_count)]
    for index, (tid, visibility) in enumerate(rows):
        await flow.db.tournaments.insert_one({"id": tid, "slug": tid, "title": tid, "status": "results_published", "visibility": visibility,
                                              "is_public": True, "format": "single_elim", "start_date": f"2026-10-{index % 28 + 1:02d}T18:00:00+02:00"})
        await flow.db.tournament_registrations.insert_one({"id": f"r-{tid}", "tournament_id": tid, "user_id": owner["id"], "status": "approved",
                                                           "final_position": index % 3 + 1})
    await awards.rebuild_all_awards(flow.db)
    # Liga-Titel aus einer Season „Nur Mitglieder“ - je Titel eine eigene Staffel, alle in derselben Liga.
    await flow.db.league_seasons.insert_one({"id": "s-verein", "league_id": "liga-1", "status": "active", "visibility": "members"})
    for n in range(internal_count):
        await flow.db.tournament_awards.insert_one({
            "id": f"aw-liga-{n}", "tournament_id": f"st-{n}", "registration_id": f"rr-{n}", "player_ids": [owner["id"]], "rank": 1,
            "kind": "trophy", "participants": 6, "matches": {"played": 5, "won": 5},
            "tournament": {"id": f"st-{n}", "slug": f"st-{n}", "title": "Staffel", "start_date": "2026-11-01T18:00:00+01:00",
                           "visibility": "public", "is_public": True, "status": "results_published"},
            "league": {"season_id": "s-verein", "title": "Meister", "division_label": "Liga 1", "staffel": "A", "display_name": "Probe"},
        })
    return owner, member


async def measure(flow, monkeypatch, internal_count: int) -> dict:
    owner, member = await seed(flow, internal_count)
    import database
    from services import league_permissions, permissions

    calls = {"reads": 0, "areas_for": 0, "capabilities_of": 0}
    real_areas, real_caps = permissions.areas_for, league_permissions.capabilities_of

    async def areas_for(*args, **kwargs):
        calls["areas_for"] += 1
        return await real_areas(*args, **kwargs)

    async def capabilities_of(*args, **kwargs):
        calls["capabilities_of"] += 1
        return await real_caps(*args, **kwargs)

    monkeypatch.setattr(permissions, "areas_for", areas_for)
    monkeypatch.setattr(league_permissions, "capabilities_of", capabilities_of)
    plain = database._db
    database._db = CountingDb(plain, calls)
    try:
        flow.act_as(member)
        res = await flow.get(f"/api/users/public/{owner['username']}")
    finally:
        database._db = plain
    assert res.status_code == 200, res.text
    body = res.json()
    assert sum(1 for item in body["references"]["items"] if item["internal"]) == internal_count, "Mitglied sieht die Turniere „Nur Mitglieder“"
    assert sum(1 for row in body["awards"] if row["internal"]) == 2 * internal_count, "dazu ihre Trophäen und die Liga-Titel"
    return calls


@pytest.mark.asyncio
async def test_member_view_asks_once_per_level_and_league_not_per_entry(flow, monkeypatch):
    calls = await measure(flow, monkeypatch, 6)
    # scope_for (ist das Mitglied eines?), die Stufe „members“ und die Stufe „internal“ - je einmal, nicht je Turnier.
    assert calls["areas_for"] <= 3, calls
    assert calls["capabilities_of"] <= 1, calls


@pytest.mark.asyncio
async def test_member_view_reads_do_not_grow_with_the_entries(monkeypatch):
    counts = []
    for internal_count in (4, 16):
        instance, shutdown = make_flow()
        try:
            counts.append((await measure(instance, monkeypatch, internal_count))["reads"])
        finally:
            await shutdown()
            monkeypatch.undo()
    assert counts[0] == counts[1], f"Abfragen mit 4 bzw. 16 internen Turnieren: {counts}"
