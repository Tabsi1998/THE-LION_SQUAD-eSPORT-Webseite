"""Katalog A (#612): die neuen Zähler aus echten Daten - Kartenstände (Zu Null, volle Distanz, Clutch, Comeback),
Karten, Pünktlichkeit, Ergebnismeldungen aus dem Protokoll, Dispute-Serie, Turniere ohne Forfeit, Check-in-Serie,
Lower-Bracket-Lauf, ungeschlagen, Gruppensieg, Stream, Schiedsrichter, Bracket Reset - und die Migration alt → neu."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
import achievement_catalog as catalog  # noqa: E402
import badges  # noqa: E402
from services import achievement_counters as counters  # noqa: E402

KEYS = {"win_rate_qualified", "clean_sheets", "full_distance_series", "deciders_won", "comebacks", "distinct_maps", "matches_ready_on_time",
        "results_reported_accepted", "dispute_free_streak", "bracket_resets_won", "streamed_matches", "tournaments_completed_no_forfeit",
        "checkin_streak", "lower_bracket_top4", "tournaments_won_undefeated", "group_stage_firsts", "disputes_resolved_as_staff"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


async def world(flow, me: dict, other: dict):
    """Ein Turnier mit Stream, zwei Anmeldungen, sechs Matches mit Kartenständen, dazu ein zweites Turnier ohne Forfeit."""
    db = flow.db
    await db.tournaments.insert_many([
        {"id": "t1", "title": "Cup", "status": "completed", "is_public": True, "stream_url": "https://twitch.tv/lions", "format": "double_elimination"},
        {"id": "t2", "title": "Liga", "status": "completed", "is_public": True},
        {"id": "t3", "title": "Offen", "status": "in_progress", "is_public": True},
    ])
    await db.tournament_registrations.insert_many([
        {"id": "r-me-1", "tournament_id": "t1", "user_id": me["id"], "seed": 2, "status": "checked_in", "checked_in_at": "2026-09-01T17:50:00+00:00", "created_at": "2026-08-30T10:00:00+00:00", "updated_at": "2026-09-01T17:50:00+00:00"},
        {"id": "r-ot-1", "tournament_id": "t1", "user_id": other["id"], "seed": 1, "status": "checked_in", "checked_in_at": "2026-09-01T17:55:00+00:00", "created_at": "2026-08-30T11:00:00+00:00", "updated_at": "2026-09-01T17:55:00+00:00"},
        {"id": "r-me-2", "tournament_id": "t2", "user_id": me["id"], "status": "checked_in", "checked_in_at": "2026-09-08T17:50:00+00:00", "created_at": "2026-09-05T10:00:00+00:00", "updated_at": "2026-09-08T17:50:00+00:00"},
        {"id": "r-ot-2", "tournament_id": "t2", "user_id": other["id"], "status": "checked_in", "checked_in_at": "2026-09-08T18:20:00+00:00", "created_at": "2026-09-05T11:00:00+00:00", "updated_at": "2026-09-08T18:20:00+00:00"},
        {"id": "r-me-3", "tournament_id": "t3", "user_id": me["id"], "status": "approved", "created_at": "2026-09-12T10:00:00+00:00", "updated_at": "2026-09-12T10:00:00+00:00"},
    ])
    await db.tournament_awards.insert_many([
        {"id": "aw1", "tournament_id": "t1", "registration_id": "r-me-1", "place": 1},
        {"id": "aw2", "tournament_id": "t2", "registration_id": "r-me-2", "place": 3},
    ])

    def match(mid, tournament, when, winner, my_score, their_score, **extra):
        return {
            "id": mid, "tournament_id": tournament, "status": "completed", "stage_number": 1, "round": 1, "order": 1, "completed_at": when, "updated_at": when,
            "slots": [{"slot": 1, "registration_id": f"r-me-{tournament[-1]}", "seed": 2}, {"slot": 2, "registration_id": f"r-ot-{tournament[-1]}", "seed": 1}],
            "results": [{"registration_id": f"r-me-{tournament[-1]}", "outcome": "winner" if winner else "loser", "score": my_score},
                        {"registration_id": f"r-ot-{tournament[-1]}", "outcome": "loser" if winner else "winner", "score": their_score}],
            **extra,
        }
    await db.matches_v2.insert_many([
        # Zu Null im Bo3, pünktlich (beide vor 18:00 eingecheckt), auf einer Karte
        match("m1", "t1", "2026-09-01T18:30:00+00:00", True, 2, 0, best_of=3, map="Dust", scheduled_at="2026-09-01T18:00:00+00:00", section="winners"),
        # Volle Distanz gewonnen (Clutch) - nach 0:1 (Comeback über die Kartenreihenfolge), im Lower Bracket
        match("m2", "t1", "2026-09-01T19:30:00+00:00", True, 2, 1, best_of=3, map="Mirage", scheduled_at="2026-09-01T19:00:00+00:00", section="lower",
              maps=[{"winner_registration_id": "r-ot-1"}, {"winner_registration_id": "r-me-1"}, {"winner_registration_id": "r-me-1"}]),
        # Grand Final mit Reset gewonnen, mit Dispute
        match("m3", "t1", "2026-09-01T20:30:00+00:00", True, 3, 2, best_of=5, map="Inferno", round_name="Grand Final Reset", scheduled_at="2026-09-01T20:00:00+00:00",
              disputes=[{"user_id": other["id"], "reason": "Ping", "created_at": "2026-09-01T20:20:00+00:00"}]),
        # Liga: verloren über die volle Distanz (Marathoner, kein Clutch), Gegner zu spät eingecheckt
        match("m4", "t2", "2026-09-08T18:30:00+00:00", False, 1, 2, best_of=3, map="Dust", scheduled_at="2026-09-08T18:00:00+00:00", group_id="g1"),
        match("m5", "t2", "2026-09-09T18:30:00+00:00", True, 2, 0, best_of=3, map="Nuke", group_id="g1"),
        match("m6", "t2", "2026-09-10T18:30:00+00:00", True, 2, 1, best_of=3, map="Nuke", group_id="g1"),
    ])
    await db.audit_logs.insert_many([
        {"id": "a1", "action": "match.result.submit", "actor_id": me["id"], "data": {"match_id": "m1"}, "created_at": "2026-09-01T18:31:00+00:00"},
        {"id": "a2", "action": "match.result.submit", "actor_id": me["id"], "data": {"match_id": "m5"}, "created_at": "2026-09-09T18:31:00+00:00"},
        {"id": "a3", "action": "match.result.submit", "actor_id": me["id"], "data": {"match_id": "nicht-da"}, "created_at": "2026-09-09T18:32:00+00:00"},
    ])


@pytest.mark.asyncio
async def test_zaehler_aus_kartenstaenden_karten_puenktlichkeit_und_protokoll(flow):
    me = await flow.add_user(name="Spielerin")
    other = await flow.add_user(name="Gegner")
    await world(flow, me, other)
    values = await counters.compute(me["id"], KEYS | {"matches_played", "matches_won"})
    assert values["clean_sheets"] == 2, "m1 und m5: 2:0"
    assert values["full_distance_series"] == 4, "m2, m3, m4, m6"
    assert values["deciders_won"] == 3, "m2, m3, m6 gewonnen über die volle Distanz"
    assert values["comebacks"] == 1, "nur m2 hat eine Kartenreihenfolge mit 0:1-Rückstand"
    assert values["distinct_maps"] == 4, "Dust, Mirage, Inferno, Nuke"
    assert values["matches_ready_on_time"] == 3, "m1, m2, m3: beide Seiten vor dem Start eingecheckt; in der Liga fehlt der Gegner-Check-in vor 18:00 und m5/m6 haben keinen Start"
    assert values["results_reported_accepted"] == 2, "m1 und m5 gemeldet, das dritte Protokoll zeigt auf kein Match"
    assert values["dispute_free_streak"] == 3, "m4, m5, m6 nach dem Dispute in m3"
    assert values["bracket_resets_won"] == 1
    assert values["streamed_matches"] == 3, "alle drei Matches im Cup mit Stream"
    assert values["win_rate_qualified"] == 0, "unter 30 Matches zählt die Quote nicht"


@pytest.mark.asyncio
async def test_zaehler_aus_turnierlaeufen(flow):
    me = await flow.add_user(name="Spielerin")
    other = await flow.add_user(name="Gegner")
    await world(flow, me, other)
    values = await counters.compute(me["id"], KEYS)
    assert values["tournaments_completed_no_forfeit"] == 2, "t1 und t2 abgeschlossen, t3 läuft noch"
    assert values["checkin_streak"] == 2, "t1, t2 eingecheckt, t3 nicht"
    assert values["lower_bracket_top4"] == 1, "Platz 1 im Cup mit einem Match im Lower Bracket"
    assert values["tournaments_won_undefeated"] == 1, "Cup gewonnen ohne Niederlage; die Liga (Platz 3) zählt nicht"
    assert values["group_stage_firsts"] == 1, "Gruppe g1: zwei Siege gegen einen des Gegners"
    assert values["disputes_resolved_as_staff"] == 0, "als Beteiligte zählt die eigene Meldung nicht"
    # Ein eigenes Forfeit nimmt dem Turnier den Durchzieher-Zähler.
    await flow.db.matches_v2.update_one({"id": "m5"}, {"$set": {"forfeit_registration_id": "r-me-2"}})
    assert (await counters.compute(me["id"], {"tournaments_completed_no_forfeit"}))["tournaments_completed_no_forfeit"] == 1


@pytest.mark.asyncio
async def test_schiedsrichter_zaehlt_nur_fremde_disputierte_matches(flow):
    staff = await flow.add_user(role="admin", name="Leitung")
    me = await flow.add_user(name="Spielerin")
    other = await flow.add_user(name="Gegner")
    await world(flow, me, other)
    await flow.db.audit_logs.insert_many([
        {"id": "s1", "action": "match.result.submit", "actor_id": staff["id"], "data": {"match_id": "m3"}, "created_at": "2026-09-01T20:40:00+00:00"},
        {"id": "s2", "action": "match.result.submit", "actor_id": staff["id"], "data": {"match_id": "m1"}, "created_at": "2026-09-01T18:40:00+00:00"},
    ])
    values = await counters.compute(staff["id"], {"disputes_resolved_as_staff", "results_reported_accepted"})
    assert values["disputes_resolved_as_staff"] == 1, "nur m3 war disputiert"
    assert values["results_reported_accepted"] == 0, "die Leitung spielt nicht mit"


@pytest.mark.asyncio
async def test_siegquote_ab_dreissig_matches_und_migration_alter_gruppen(flow):
    me = await flow.add_user(name="Vielspielerin")
    other = await flow.add_user(name="Gegner")
    await flow.db.tournaments.insert_one({"id": "t9", "title": "Marathon", "status": "completed", "is_public": True})
    await flow.db.tournament_registrations.insert_many([
        {"id": "r-me-9", "tournament_id": "t9", "user_id": me["id"], "status": "checked_in", "created_at": "2026-08-01T10:00:00+00:00", "updated_at": "2026-08-01T10:00:00+00:00"},
        {"id": "r-ot-9", "tournament_id": "t9", "user_id": other["id"], "status": "checked_in", "created_at": "2026-08-01T10:00:00+00:00", "updated_at": "2026-08-01T10:00:00+00:00"},
    ])
    docs = []
    for n in range(32):
        won = n % 4 != 0  # 24 von 32 gewonnen = 75 %
        docs.append({
            "id": f"x{n}", "tournament_id": "t9", "status": "completed", "completed_at": f"2026-08-{2 + n // 4:02d}T{10 + n % 4:02d}:00:00+00:00",
            "slots": [{"slot": 1, "registration_id": "r-me-9"}, {"slot": 2, "registration_id": "r-ot-9"}],
            "results": [{"registration_id": "r-me-9", "outcome": "winner" if won else "loser"}, {"registration_id": "r-ot-9", "outcome": "loser" if won else "winner"}],
        })
    await flow.db.matches_v2.insert_many(docs)
    values = await counters.compute(me["id"], {"win_rate_qualified", "matches_played"})
    assert values["matches_played"] == 32 and values["win_rate_qualified"] == 75
    # Migration: eine alte Vergabe in „match_master“ wird über den neuen Zähler zu „Spielmacher“ - hier bis Stufe II (25 Matches).
    assert "match_master" in catalog.REPLACED and catalog.GROUP_MAPPING["match_master"] == "matches_played"
    assert await flow.db.achievement_groups.find_one({"code": "match_master"}) is None, "die alte Gruppe wird beim Start nicht mehr angelegt"
    tiers = await flow.db.achievements.find({"group_code": "matches_played"}, {"_id": 0, "code": 1, "progress_target": 1, "material": 1}).to_list(10)
    assert [t["material"] for t in sorted(tiers, key=lambda t: t["progress_target"])] == ["wood", "iron", "bronze", "silver", "gold", "platinum", "diamond"]
    awarded = await badges.evaluate_user_progress(me["id"])
    mine = {a["tier_code"] async for a in flow.db.user_achievements.find({"user_id": me["id"]}, {"_id": 0, "tier_code": 1})}
    assert {"matches_played_1", "matches_played_2"} <= mine and "matches_played_3" not in mine and awarded >= 2
    assert "win_rate_5" in mine, "75 % ab 30 Matches ist Effizienz V"
