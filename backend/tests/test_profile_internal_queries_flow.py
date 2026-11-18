"""Vereinsinterne Erfolge (#2516, #2521): die Mitglieder-Ansicht eines Profils fragt nicht je Eintrag neu nach.

Die Sichtbarkeit wird je Aufruf einmal je Stufe, je Season und je Liga entschieden (wie ``visibility.filter_visible``), und die
Anmeldungen für die Plätze der Referenzen kommen in einer Abfrage für alle Turniere. Gemessen wird die Zahl der Datenbank-Abfragen
auf ``/api/users/public/{name}`` - mit 4 und mit 16 internen Turnieren, Bestzeiten (je eine eigene Strecke) und Seasons der
Liga-Historie muss sie gleich bleiben. Dazu höchstens ein Aufruf von
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
    await seed_round_two(flow, owner, internal_count)
    return owner, member


async def seed_round_two(flow, owner: dict, internal_count: int) -> None:
    """#2521: je interner Eintrag eine Fast-Lap-Challenge „Nur Mitglieder“ mit eigener Strecke und eine Season „Nur Mitglieder“ mit
    abgeschlossener Staffel (Liga-Historie) - nach den Trophäen angelegt, damit deren Zahl gleich bleibt."""
    for n in range(internal_count):
        cid = f"c-verein-{n}"
        await flow.db.f1_challenges.insert_one({"id": cid, "slug": cid, "title": f"Hotlap {n}", "status": "active", "visibility": "members"})
        await flow.db.f1_tracks.insert_one({"id": f"tr-{n}", "name": f"Strecke {n}", "challenge_id": cid})
        await flow.db.f1_lap_times.insert_one({"id": f"lap-{n}", "challenge_id": cid, "track_id": f"tr-{n}", "user_id": owner["id"],
                                               "time_ms": 80000 + n, "is_invalid": False, "created_at": "2026-09-02T18:00:00+00:00"})
        season_id, staffel = f"s-hist-{n}", f"st-hist-{n}"
        await flow.db.league_seasons.insert_one({"id": season_id, "league_id": "liga-1", "status": "completed", "visibility": "members",
                                                 "name": f"Season {n}", "slug": season_id})
        await flow.db.tournaments.insert_one({"id": staffel, "slug": staffel, "title": "Staffel A", "status": "completed",
                                              "visibility": "members", "is_public": True, "format": "round_robin",
                                              "league_context": {"season_id": season_id, "staffel": "A"}})
        await flow.db.league_final_tables.insert_one({
            "id": f"ft-{n}", "active": True, "season_id": season_id, "league_id": "liga-1", "tournament_id": staffel, "staffel": "A",
            "player_ids": [owner["id"]], "participants": 4, "closed_at": f"2026-10-{n % 28 + 1:02d}T20:00:00+00:00",
            "rows": [{"registration_id": f"rh-{n}", "rank": 1, "display_name": "Probe"}],
            "sides": {f"rh-{n}": {"player_ids": [owner["id"]]}}})


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
    refs = body["references"]["items"]
    assert sum(1 for item in refs if item["internal"] and item["kind"] == "tournament") == internal_count, "Mitglied sieht die Turniere „Nur Mitglieder“"
    assert sum(1 for item in refs if item["internal"] and item["kind"] == "fastlap") == internal_count, "und die Fast Laps „Nur Mitglieder“"
    assert sum(1 for row in body["awards"] if row["internal"]) == 2 * internal_count, "dazu ihre Trophäen und die Liga-Titel"
    # #2521: Teilnahmen, Bestzeiten und Liga-Historie nach derselben Regel - ebenso ohne Abfrage je Eintrag.
    assert sum(1 for row in body["tournaments"] if row["internal"]) == internal_count, "Teilnahmen „Nur Mitglieder“"
    assert sum(1 for row in body["f1_bests"] if row["internal"]) == internal_count, "Bestzeiten „Nur Mitglieder“"
    assert sum(1 for row in body["league_history"] if row["internal"]) == internal_count, "Seasons „Nur Mitglieder“"
    return calls


@pytest.mark.asyncio
async def test_member_view_asks_once_per_level_and_league_not_per_entry(flow, monkeypatch):
    calls = await measure(flow, monkeypatch, 6)
    # scope_for (ist das Mitglied eines?), die Stufe „members“ und die Stufe „internal“ - je einmal, nicht je Turnier.
    assert calls["areas_for"] <= 3, calls
    assert calls["capabilities_of"] <= 1, calls


@pytest.mark.asyncio
async def test_member_view_reads_do_not_grow_with_the_entries(monkeypatch):
    # Je Messung ein eigener MonkeyPatch: ``monkeypatch.undo()`` höbe auch die autouse-Patches der conftest auf.
    from services.profile_visibility import PUBLIC, SELF

    counts = []
    for internal_count in (4, 16):
        instance, shutdown = make_flow()
        try:
            with pytest.MonkeyPatch.context() as patch:
                counts.append((await measure(instance, patch, internal_count))["reads"])
        finally:
            await shutdown()
    assert counts[0] == counts[1], f"Abfragen mit 4 bzw. 16 internen Turnieren: {counts}"
    # SELF und PUBLIC gelten prozessweit - ein Merker darin teilte Entscheidungen zwischen Betrachtern.
    assert SELF.memo == {} and PUBLIC.memo == {}


# ---------------------------------------------------------------- Gesamtwertung (#2521)

async def league_reads(seasons: int) -> dict:
    """Liga mit ``seasons`` gespielten Seasons in einem Zeitraum der Gesamtwertung (echte Routen, Hilfen aus test_league_overall_flow);
    ab Season 2 „Nur Mitglieder“. Gemessen wird das Profil von ``p-2-1`` für ein Mitglied und für die Person selbst - je einmal mit kaltem
    und einmal mit warmem Zwischenspeicher der Endstände (``league_overall._extract``, 60 s)."""
    import database
    from services import league_overall
    from test_league_overall_flow import ADMIN, add_season, configure, ok, played_staffel, setup

    league_overall.forget_extracts()
    flow, shutdown = make_flow()
    try:
        world = await setup(flow)
        for index in range(seasons):
            season = await add_season(flow, world)
            await played_staffel(flow, world, season, 1, [1, 2, 3, 4])
            if index:
                flow.act_as(world["admin"])
                ok(await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"visibility": "members", "readiness_override_reason": "Testaufbau"}))
        await configure(flow, world)
        member = await flow.add_user(role="player", name="nachtfalke")
        await flow.db.memberships.insert_one({"id": "m-liga", "user_id": member["id"], "member_status": "active"})
        owner = await flow.db.users.find_one({"id": "p-2-1"}, {"_id": 0})
        out = {}
        for label, viewer in (("mitglied", member), ("selbst", owner)):
            league_overall.forget_extracts()
            for state in ("kalt", "warm"):
                calls = {"reads": 0}
                plain = database._db
                database._db = CountingDb(plain, calls)
                try:
                    flow.act_as(viewer)
                    res = await flow.get(f"/api/users/public/{owner['username']}")
                finally:
                    database._db = plain
                assert res.status_code == 200, res.text
                body = res.json()
                assert sum(1 for row in body["league_history"] if row["internal"]) == seasons - 1, (label, "Seasons „Nur Mitglieder“")
                assert body["league_overall"] and body["league_overall"][0]["internal"] is True, (label, "die Wertung zählt sie mit")
                out[(label, state)] = calls["reads"]
        return out
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_league_overall_reads_do_not_grow_with_seasons_while_the_cache_is_warm():
    """Mitglied und Person selbst: Mit warmem Zwischenspeicher fragt das Profil bei 2 und bei 4 Seasons gleich oft. Kalt liest
    ``league_overall._extract`` je Endstand (Anmeldungen, Teams, Spiele) - das wächst mit den Staffeln wie auf main (vor #2521) und wie
    auf der Ligaseite; für Gäste ändert sich daran nichts."""
    small, large = await league_reads(2), await league_reads(4)
    for label in ("mitglied", "selbst"):
        assert small[(label, "warm")] == large[(label, "warm")], (label, small, large)
        assert large[(label, "kalt")] >= small[(label, "kalt")], (label, small, large)
