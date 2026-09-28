"""Katalog B (#613): die neuen Zähler aus echten Daten - Fast Lap (Bestzeiten verbessert, Zielzeit, Streckenrekord,
Konstanz, Championship-Top-3, Grand Prix), Saison (Aufsteiger aus Schnappschüssen, volle Saison, Saisonstart,
festgeschriebene Rangliste beim Abschluss - vorher hat ``season_standings`` niemand geschrieben) und Team
(Team-Siege nach dem Beitritt, angenommene Einladungen) - dazu die Migration alt → neu."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
import achievement_catalog as catalog  # noqa: E402
import badges  # noqa: E402
from services import achievement_counters as counters  # noqa: E402
from services.fastlap_standings import championship_totals, effective_ms  # noqa: E402
from services.season_ranks import SNAPSHOTS, climbs, snapshot_ranks, write_standings  # noqa: E402

KEYS = {"pb_improvements", "sub_target_laps", "track_records_held", "consistent_sessions", "championship_top3", "grand_prix_entries",
        "season_climbs_10", "seasons_fully_played", "season_openers_played", "team_match_wins", "team_invites_accepted",
        "season_top10_finishes", "season_wins"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


def lap(i, user_id, track, ms, when, challenge="c1", **extra):
    return {"id": f"lap-{i}", "challenge_id": challenge, "track_id": track, "user_id": user_id, "time_ms": ms, "penalty_seconds": 0,
            "is_invalid": False, "score_scope": "official", "attempt_number": i, "created_at": when, **extra}


async def fastlap_world(db, me: str, other: str):
    """Eine abgeschlossene Challenge mit zwei Strecken (eine mit Zielzeit), eine laufende; Runden mit Strafe, ungültig, Referenz."""
    await db.f1_challenges.insert_many([
        {"id": "c1", "slug": "cup", "title": "Fast Lap Cup", "status": "completed", "visibility": "public", "points_per_position": [25, 18, 15]},
        {"id": "c2", "slug": "open", "title": "Offen", "status": "live", "visibility": "public"},
    ])
    await db.f1_tracks.insert_many([
        {"id": "tr1", "challenge_id": "c1", "name": "Monza", "order_index": 0, "target_time_ms": 60000},
        {"id": "tr2", "challenge_id": "c1", "name": "Spa", "order_index": 1},
        {"id": "tr3", "challenge_id": "c2", "name": "Suzuka", "order_index": 0},
    ])
    laps = [
        # tr1: 62,0 → 61,0 (besser) → 63,0 (nicht) → 59,5 (besser, unter Zielzeit) → 58,4 + 1 s Strafe = 59,4 (besser, unter Zielzeit)
        lap(1, me, "tr1", 62000, "2026-05-01T10:00:00+00:00"),
        lap(2, me, "tr1", 61000, "2026-05-01T10:05:00+00:00"),
        lap(3, me, "tr1", 63000, "2026-05-01T10:10:00+00:00"),
        lap(4, me, "tr1", 59500, "2026-05-01T10:15:00+00:00"),
        lap(5, me, "tr1", 58400, "2026-05-01T10:20:00+00:00", penalty_seconds=1.0),
        lap(6, me, "tr1", 57000, "2026-05-01T10:25:00+00:00", is_invalid=True),
        lap(7, me, "tr1", 50000, "2026-05-01T10:30:00+00:00", score_scope="club_reference"),
        lap(8, other, "tr1", 59000, "2026-05-01T11:00:00+00:00"),
        lap(40, me, "tr3", 70000, "2026-06-01T10:00:00+00:00", challenge="c2"),
    ]
    # tr2: zehn gültige Runden binnen einem Prozent der Bestzeit 80,0 - Konstanz, und der Rekord liegt bei mir
    for n in range(10):
        laps.append(lap(20 + n, me, "tr2", 80000 + n * 50, f"2026-05-02T10:{n:02d}:00+00:00"))
    await db.f1_lap_times.insert_many(laps)


async def season_world(db, me: dict, other: dict):
    """Drei Saisons: s1 abgeschlossen (zwei Turniere, eine Challenge - ich überall dabei), s2 abgeschlossen ohne mich, s3 läuft."""
    await db.seasons.insert_many([
        {"id": "s1", "name": "Saison 1", "status": "completed", "tournament_ids": ["t1", "t2"], "f1_challenge_ids": ["c1"], "start_date": "2026-03-01T00:00:00+00:00"},
        {"id": "s2", "name": "Saison 2", "status": "completed", "tournament_ids": ["t3"], "f1_challenge_ids": [], "start_date": "2026-06-01T00:00:00+00:00"},
        {"id": "s3", "name": "Saison 3", "status": "active", "tournament_ids": ["t4"], "f1_challenge_ids": [], "start_date": "2026-09-01T00:00:00+00:00"},
    ])
    await db.tournaments.insert_many([
        {"id": "t1", "title": "Auftakt", "status": "completed", "start_date": "2026-03-05T18:00:00+00:00", "format": "single_elim", "season_id": "s1"},
        {"id": "t2", "title": "Zweites", "status": "completed", "start_date": "2026-04-05T18:00:00+00:00", "format": "single_elim", "season_id": "s1"},
        {"id": "t3", "title": "Drittes", "status": "completed", "start_date": "2026-06-05T18:00:00+00:00", "format": "single_elim", "season_id": "s2"},
        {"id": "t4", "title": "Viertes", "status": "in_progress", "start_date": "2026-09-05T18:00:00+00:00", "format": "single_elim", "season_id": "s3"},
        {"id": "t-gp", "title": "Grand Prix", "status": "completed", "start_date": "2026-07-01T18:00:00+00:00", "format": "grand_prix"},
        {"id": "t-gp2", "title": "Grand Prix 2", "status": "completed", "start_date": "2026-08-01T18:00:00+00:00", "format": "grand_prix"},
    ])
    await db.tournament_registrations.insert_many([
        {"id": "r-t1", "tournament_id": "t1", "user_id": me["id"], "status": "approved"},
        {"id": "r-t2", "tournament_id": "t2", "user_id": me["id"], "status": "approved"},
        {"id": "r-gp", "tournament_id": "t-gp", "user_id": me["id"], "status": "approved"},
        {"id": "r-gp2", "tournament_id": "t-gp2", "user_id": me["id"], "status": "withdrawn"},
        {"id": "r-o-t1", "tournament_id": "t1", "user_id": other["id"], "status": "approved"},
    ])
    await db.season_points.insert_many([
        {"id": "p1", "season_id": "s1", "user_id": me["id"], "team_id": None, "source_type": "tournament", "source_id": "t1", "rank": 1, "total_points": 20.0, "raw_points": 20.0, "created_at": "2026-03-06T00:00:00+00:00"},
        {"id": "p2", "season_id": "s1", "user_id": me["id"], "team_id": None, "source_type": "tournament", "source_id": "t2", "rank": 2, "total_points": 15.0, "raw_points": 15.0, "created_at": "2026-04-06T00:00:00+00:00"},
        {"id": "p3", "season_id": "s1", "user_id": me["id"], "team_id": None, "source_type": "fastlap", "source_id": "c1:tr1", "rank": 2, "total_points": 10.0, "raw_points": 10.0, "created_at": "2026-05-06T00:00:00+00:00"},
        {"id": "p4", "season_id": "s1", "user_id": other["id"], "team_id": None, "source_type": "tournament", "source_id": "t1", "rank": 2, "total_points": 25.0, "raw_points": 25.0, "created_at": "2026-03-06T00:00:00+00:00"},
        {"id": "p5", "season_id": "s3", "user_id": me["id"], "team_id": None, "source_type": "tournament", "source_id": "t4", "rank": 1, "total_points": 30.0, "raw_points": 30.0, "created_at": "2026-09-06T00:00:00+00:00"},
    ])
    await db[SNAPSHOTS].insert_many([
        {"season_id": "s3", "user_id": me["id"], "day": "2026-09-01", "rank": 15},
        {"season_id": "s3", "user_id": me["id"], "day": "2026-09-02", "rank": 12},
        {"season_id": "s3", "user_id": me["id"], "day": "2026-09-03", "rank": 4},
        {"season_id": "s1", "user_id": me["id"], "day": "2026-03-10", "rank": 3},
        {"season_id": "s1", "user_id": me["id"], "day": "2026-04-10", "rank": 2},
    ])


async def team_world(db, me: dict, other: dict):
    """Mein Team (ich Leitung, beigetreten am 10.1.) mit Matches vor und nach dem Beitritt; ein fremdes Team; Einladungen."""
    await db.teams.insert_many([
        {"id": "T1", "name": "Lions", "member_ids": [me["id"], other["id"]], "leader_id": me["id"], "created_by": me["id"], "created_at": "2026-01-01T00:00:00+00:00"},
        {"id": "T2", "name": "Fremde", "member_ids": [other["id"]], "leader_id": other["id"], "created_by": other["id"], "created_at": "2026-01-01T00:00:00+00:00"},
    ])
    await db.team_members.insert_many([
        {"team_id": "T1", "user_id": me["id"], "role": "leader", "joined_at": "2026-01-10T00:00:00+00:00"},
        {"team_id": "T1", "user_id": other["id"], "role": "member", "joined_at": "2026-01-02T00:00:00+00:00"},
    ])
    await db.tournament_registrations.insert_many([
        {"id": "r-T1", "tournament_id": "t5", "team_id": "T1", "status": "approved"},
        {"id": "r-T2", "tournament_id": "t5", "team_id": "T2", "status": "approved"},
    ])

    def match(mid, when, winner):
        loser = "r-T2" if winner == "r-T1" else "r-T1"
        return {"id": mid, "tournament_id": "t5", "status": "completed", "completed_at": when, "updated_at": when,
                "slots": [{"slot": 1, "registration_id": "r-T1"}, {"slot": 2, "registration_id": "r-T2"}],
                "results": [{"registration_id": winner, "outcome": "winner", "score": 2}, {"registration_id": loser, "outcome": "loser", "score": 0}]}
    await db.matches_v2.insert_many([
        match("tm1", "2026-02-01T18:00:00+00:00", "r-T1"),
        match("tm2", "2026-02-02T18:00:00+00:00", "r-T2"),
        match("tm3", "2025-12-01T18:00:00+00:00", "r-T1"),
    ])
    await db.team_invites.insert_many([
        {"id": "i1", "team_id": "T1", "user_id": "u-x", "invited_by": me["id"], "status": "accepted"},
        {"id": "i2", "team_id": "T1", "user_id": "u-y", "invited_by": me["id"], "status": "accepted"},
        {"id": "i3", "team_id": "T1", "user_id": "u-z", "invited_by": me["id"], "status": "pending"},
        {"id": "i4", "team_id": "T2", "user_id": "u-w", "invited_by": other["id"], "status": "accepted"},
    ])


@pytest.mark.asyncio
async def test_fastlap_zaehler_aus_rundenzeiten(flow):
    me = await flow.add_user(name="Fahrerin")
    other = await flow.add_user(name="Gegner")
    await fastlap_world(flow.db, me["id"], other["id"])
    await season_world(flow.db, me, other)
    values = await counters.compute(me["id"], KEYS)
    assert values["pb_improvements"] == 3, "61,0 / 59,5 / 59,4 unterbieten die bisherige Bestzeit; ungültig und Referenz zählen nicht"
    assert values["sub_target_laps"] == 2, "59,5 und 59,4 (mit Strafe) unter 60,0 - nur tr1 hat eine Zielzeit"
    assert values["track_records_held"] == 2, "tr2 und tr3 halte ich, tr1 hält der Gegner mit 59,0"
    assert values["consistent_sessions"] == 1, "zehn Runden auf tr2 binnen einem Prozent"
    assert values["championship_top3"] == 1, "Cup abgeschlossen: 18 + 25 Punkte gegen 25 - die laufende Challenge zählt nicht"
    assert values["grand_prix_entries"] == 1, "eine Anmeldung zählt, die zurückgezogene nicht"
    # Referenzzeit und ungültige Runde sind auch aus der Championship draußen.
    standings, per_track = championship_totals(
        [{"id": "tr1"}, {"id": "tr2"}],
        {"tr1": [lap(1, me["id"], "tr1", 58400, "", penalty_seconds=1.0), lap(2, other["id"], "tr1", 59000, "")], "tr2": [lap(3, me["id"], "tr2", 80000, "")]},
        [25, 18, 15],
    )
    assert [(row["user_id"], row["points"], row["rank"]) for row in standings] == [(me["id"], 43, 1), (other["id"], 25, 2)]
    assert per_track["tr1"]["results"][0]["user_id"] == other["id"]
    assert effective_ms({"time_ms": 58400, "penalty_seconds": 1.0}) == 59400


@pytest.mark.asyncio
async def test_saison_zaehler_und_festgeschriebene_rangliste(flow):
    me = await flow.add_user(name="Spielerin")
    other = await flow.add_user(name="Andere")
    await fastlap_world(flow.db, me["id"], other["id"])
    await season_world(flow.db, me, other)
    before = await counters.compute(me["id"], KEYS)
    assert before["season_wins"] == 0 and before["season_top10_finishes"] == 0, "ohne festgeschriebene Rangliste nichts"
    assert before["seasons_fully_played"] == 1, "s1: t1, t2 und c1 - s2 ohne mich, s3 läuft noch"
    assert before["season_openers_played"] == 2, "s1: beim Auftakt angemeldet; s3: Punkte beim ersten Turnier; s2 nicht"
    assert before["season_climbs_10"] == 1, "s3: von Platz 15 auf 4; s1 nur von 3 auf 2"
    # Abschluss: die Rangliste von s1 wird festgeschrieben - ich mit 45 Punkten vor 25.
    result = await badges.on_season_completed("s1")
    assert result["ranked"] == 2
    rows = await flow.db.season_standings.find({"season_id": "s1"}, {"_id": 0}).sort("rank", 1).to_list(10)
    assert [(row["user_id"], row["rank"], row["total_points"]) for row in rows] == [(me["id"], 1, 45.0), (other["id"], 2, 25.0)]
    after = await counters.compute(me["id"], KEYS)
    assert after["season_wins"] == 1 and after["season_top10_finishes"] == 1
    # Ein zweiter Abschluss ersetzt den Stand statt ihn zu verdoppeln.
    await write_standings(flow.db, "s1")
    assert await flow.db.season_standings.count_documents({"season_id": "s1"}) == 2
    # Der tägliche Schnappschuss schreibt je laufender Saison, Person und Tag einen Eintrag - zweimal am Tag bleibt einer.
    assert await snapshot_ranks(flow.db, "2026-09-04") == 1
    assert await snapshot_ranks(flow.db, "2026-09-04") == 1
    snaps = await flow.db[SNAPSHOTS].find({"season_id": "s3", "day": "2026-09-04"}, {"_id": 0}).to_list(10)
    assert [(row["user_id"], row["rank"]) for row in snaps] == [(me["id"], 1)]
    assert climbs([{"season_id": "x", "day": "1", "rank": 20}, {"season_id": "x", "day": "2", "rank": 30}, {"season_id": "x", "day": "3", "rank": 20}]) == 1
    assert climbs([{"season_id": "x", "day": "1", "rank": 20}, {"season_id": "x", "day": "2", "rank": 11}]) == 0


@pytest.mark.asyncio
async def test_saisonabschluss_ueber_die_route_und_nur_einmal(flow):
    admin = await flow.add_user(role="superadmin", name="Admin")
    me = await flow.add_user(name="Spielerin")
    other = await flow.add_user(name="Andere")
    await season_world(flow.db, me, other)
    await flow.db.seasons.update_one({"id": "s1"}, {"$set": {"status": "active"}})
    flow.act_as(admin)
    response = await flow.put("/api/seasons/s1", json={"status": "completed"})
    assert response.status_code == 200, response.text
    assert await flow.db.season_standings.count_documents({"season_id": "s1"}) == 2
    values = await counters.compute(me["id"], {"season_wins"})
    assert values["season_wins"] == 1


@pytest.mark.asyncio
async def test_team_zaehler(flow):
    me = await flow.add_user(name="Kapitänin")
    other = await flow.add_user(name="Mitspieler")
    await team_world(flow.db, me, other)
    values = await counters.compute(me["id"], KEYS | {"team_size_max", "teams_founded"})
    assert values["team_match_wins"] == 1, "tm1 nach dem Beitritt gewonnen; tm2 verloren; tm3 vor dem Beitritt"
    assert values["team_invites_accepted"] == 2, "zwei angenommene, eine offene, eine fremde"
    assert values["team_size_max"] == 2
    assert values["teams_founded"] == 1
    theirs = await counters.compute(other["id"], {"team_match_wins", "team_invites_accepted"})
    assert theirs["team_match_wins"] == 2, "der Mitspieler war schon vor tm3 dabei - und T2 gewann tm2"
    assert theirs["team_invites_accepted"] == 1


@pytest.mark.asyncio
async def test_katalog_b_ersetzt_alte_gruppen(flow):
    assert catalog.GROUP_MAPPING["fastlap_volume"] == "laps_valid"
    assert catalog.GROUP_MAPPING["team_loyalty"] == "team_tenure"
    assert catalog.GROUP_MAPPING["platform_chat"] == "team_chat"
    for old in catalog.REPLACED_B:
        assert old not in catalog.GROUP_BY_CODE, old
        assert await flow.db.achievements.find_one({"group_code": old}, {"_id": 0}) is None, old
    for code in ("laps_valid_7", "pole_1", "season_climber_5", "team_founder_3", "championship_top_1", "team_recruiter_5"):
        assert await flow.db.achievements.find_one({"code": code}, {"_id": 0, "code": 1}) is not None, code
    assert await flow.db.achievements.find_one({"code": "season_climber_p"}, {"_id": 0}) is None, "die alte rangbasierte Stufe ist weg"
