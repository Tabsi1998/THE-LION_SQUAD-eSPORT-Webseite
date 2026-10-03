"""Katalog D (#615): die neuen Zähler aus echten Daten - Gründungsmitglied, Pionier, Grand Slam, Hundert Prozent,
Geisterstunde, Glückliche Sieben, Spiegelbild, Echo, Nachtschicht, Vollmond, Zeitreisender - und die Form der
Gruppen (Verein nur für Mitglieder, Besonders legendär, Geheim versteckt)."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
import achievement_catalog as catalog  # noqa: E402
import badges  # noqa: E402
from services import achievement_counters as counters  # noqa: E402

KEYS = {"member_since_founding_year", "pioneer_account", "distinct_game_wins_one_season", "all_visible_achievements",
        "witching_hour_matches", "lucky_seven_days", "palindrome_laps", "echo_results", "night_shift_nights", "full_moon_wins",
        "leap_day_logins"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


def match(mid, when, won, my_score, their_score):
    return {"id": mid, "tournament_id": "t1", "status": "completed", "completed_at": when, "updated_at": when,
            "slots": [{"slot": 1, "registration_id": "r1"}, {"slot": 2, "registration_id": "r-ot"}],
            "results": [{"registration_id": "r1", "outcome": "winner" if won else "loser", "score": my_score},
                        {"registration_id": "r-ot", "outcome": "loser" if won else "winner", "score": their_score}]}


def full_moon_near(year_month_start: datetime) -> datetime:
    """Der erste rechnerische Vollmond ab dem Datum - aus derselben Formel wie der Zähler."""
    k = 0
    while True:
        at = counters.REFERENCE_NEW_MOON + timedelta(days=(k + 0.5) * counters.SYNODIC_DAYS)
        if at >= year_month_start:
            return at
        k += 1


async def world(db, me: dict, other: dict):
    await db.settings.insert_one({"id": "about_page", "founded_on": "2021-06-15"})
    await db.memberships.insert_many([
        {"user_id": me["id"], "member_status": "active", "member_since": "2021-03-01"},
        {"user_id": other["id"], "member_status": "active", "member_since": "2023-03-01"},
    ])
    await db.users.update_one({"id": me["id"]}, {"$set": {"is_club_member": True, "created_at": datetime(2026, 1, 5, tzinfo=timezone.utc)}})
    await db.tournaments.insert_many([
        {"id": "t1", "title": "Eins", "status": "completed", "game_id": "g1", "season_id": "s1"},
        {"id": "t2", "title": "Zwei", "status": "completed", "game_id": "g2", "season_id": "s1"},
        {"id": "t3", "title": "Drei", "status": "completed", "game_id": "g3", "season_id": "s1"},
        {"id": "t4", "title": "Vier", "status": "completed", "game_id": "g1", "season_id": "s2"},
    ])
    await db.tournament_registrations.insert_many([
        {"id": "r1", "tournament_id": "t1", "user_id": me["id"], "status": "approved"},
        {"id": "r2", "tournament_id": "t2", "user_id": me["id"], "status": "approved"},
        {"id": "r3", "tournament_id": "t3", "user_id": me["id"], "status": "approved"},
        {"id": "r4", "tournament_id": "t4", "user_id": me["id"], "status": "approved"},
        {"id": "r-ot", "tournament_id": "t1", "user_id": other["id"], "status": "approved"},
    ])
    await db.tournament_awards.insert_many([
        {"id": "a1", "tournament_id": "t1", "registration_id": "r1", "place": 1},
        {"id": "a2", "tournament_id": "t2", "registration_id": "r2", "place": 1},
        {"id": "a3", "tournament_id": "t3", "registration_id": "r3", "place": 1},
        {"id": "a4", "tournament_id": "t4", "registration_id": "r4", "place": 1},
    ])
    full = full_moon_near(datetime(2026, 10, 1, tzinfo=timezone.utc))
    matches = [
        # Geisterstunde: 23:05 UTC = 00:05 Wien (Winterzeit)
        match("w1", "2026-11-01T23:05:00+00:00", True, 2, 0),
        # Nachtschicht: fünf Matches in einer Nacht (22:30 bis 04:00 Wien)
        match("n1", "2026-11-06T21:30:00+00:00", True, 2, 1),
        match("n2", "2026-11-06T22:00:00+00:00", False, 1, 2),
        match("n3", "2026-11-06T22:30:00+00:00", True, 2, 0),
        match("n4", "2026-11-06T23:30:00+00:00", True, 3, 2),
        match("n5", "2026-11-07T03:00:00+00:00", False, 1, 2),
        # Glückliche Sieben: sieben Siege am 7.11. (Wien) - die ersten drei mit demselben Stand (Echo)
        match("s1", "2026-11-07T10:00:00+00:00", True, 2, 0),
        match("s2", "2026-11-07T11:00:00+00:00", True, 2, 0),
        match("s3", "2026-11-07T12:00:00+00:00", True, 2, 0),
        match("s4", "2026-11-07T13:00:00+00:00", True, 2, 1),
        match("s5", "2026-11-07T14:00:00+00:00", True, 3, 0),
        match("s6", "2026-11-07T15:00:00+00:00", True, 2, 1),
        match("s7", "2026-11-07T16:00:00+00:00", True, 3, 1),
        # Vollmond: ein Sieg und eine Niederlage genau bei Vollmond, ein Sieg drei Tage danach
        match("f1", full.isoformat(), True, 2, 1),
        match("f2", (full + timedelta(hours=3)).isoformat(), False, 0, 2),
        match("f3", (full + timedelta(days=3)).isoformat(), True, 2, 1),
    ]
    await db.matches_v2.insert_many(matches)
    lap = lambda i, ms, **extra: {"id": f"lap-{i}", "challenge_id": "c1", "track_id": "tr1", "user_id": me["id"], "time_ms": ms, "penalty_seconds": 0, "is_invalid": False, "score_scope": "official", "attempt_number": i, "created_at": f"2026-05-0{i}T10:00:00+00:00", **extra}  # noqa: E731
    await db.f1_lap_times.insert_many([lap(1, 83380), lap(2, 83321), lap(3, 59950), lap(4, 61016, is_invalid=True), lap(5, 65056)])
    await db.xp_events.insert_many([
        {"id": "x1", "user_id": me["id"], "source": "daily_login", "ref": "2028-02-29", "amount": 10, "day": "2028-02-29", "at": "2028-02-29T08:00:00+00:00"},
        {"id": "x2", "user_id": me["id"], "source": "daily_login", "ref": "2026-02-28", "amount": 10, "day": "2026-02-28", "at": "2026-02-28T08:00:00+00:00"},
        {"id": "x3", "user_id": me["id"], "source": "achievement", "ref": "z", "amount": 50, "day": "2028-02-29", "at": "2028-02-29T09:00:00+00:00"},
    ])


@pytest.mark.asyncio
async def test_vereins_und_sonder_zaehler(flow):
    me = await flow.add_user(name="Gründerin")
    other = await flow.add_user(name="Später")
    await world(flow.db, me, other)
    values = await counters.compute(me["id"], KEYS)
    assert values["member_since_founding_year"] == 1, "seit 2021 dabei, Verein gegründet 2021"
    assert (await counters.compute(other["id"], {"member_since_founding_year"}))["member_since_founding_year"] == 0
    assert values["pioneer_account"] == 1, "eines der ersten Konten in dieser Datenbank"
    assert values["distinct_game_wins_one_season"] == 3, "drei Spiele in Saison s1, eines in s2"
    assert values["all_visible_achievements"] == 0
    # Hundert Prozent: jede messbare sichtbare Stufe vergeben (Verein zählt mit, weil Mitglied).
    groups = {g["code"]: g async for g in flow.db.achievement_groups.find({"public": True, "is_negative": {"$ne": True}, "hidden": {"$ne": True}}, {"_id": 0, "code": 1})}
    tiers = [t async for t in flow.db.achievements.find({"group_code": {"$in": list(groups)}, "manual_only": {"$ne": True}}, {"_id": 0, "code": 1, "group_code": 1})]
    assert len(tiers) > 300
    await flow.db.user_achievements.insert_many([{"id": f"aw-{t['code']}", "user_id": me["id"], "tier_code": t["code"], "group_code": t["group_code"], "earned_at": "2026-01-01T00:00:00+00:00"} for t in tiers if t["code"] != "completionist_1"])
    assert (await counters.compute(me["id"], {"all_visible_achievements"}))["all_visible_achievements"] == 1


@pytest.mark.asyncio
async def test_pionier_nur_die_ersten_hundert(flow):
    early = datetime(2020, 1, 1, tzinfo=timezone.utc)
    await flow.db.users.insert_many([{"id": f"alt-{n}", "username": f"alt{n}", "email": f"alt{n}@example.com", "created_at": early + timedelta(minutes=n)} for n in range(100)])
    me = await flow.add_user(name="Spät dran")
    await flow.db.users.update_one({"id": me["id"]}, {"$set": {"created_at": datetime(2026, 1, 5, tzinfo=timezone.utc)}})
    assert (await counters.compute(me["id"], {"pioneer_account"}))["pioneer_account"] == 0
    # Ohne Datum kein Pionier - lieber keiner als ein falscher.
    await flow.db.users.update_one({"id": me["id"]}, {"$unset": {"created_at": ""}})
    assert (await counters.compute(me["id"], {"pioneer_account"}))["pioneer_account"] == 0


@pytest.mark.asyncio
async def test_geheime_zaehler_aus_matches_runden_und_logins(flow):
    me = await flow.add_user(name="Nachteule")
    other = await flow.add_user(name="Gegner")
    await world(flow.db, me, other)
    values = await counters.compute(me["id"], KEYS)
    assert values["witching_hour_matches"] == 1, "00:05 Wien"
    assert values["night_shift_nights"] == 1, "fünf Matches zwischen 22:30 und 04:00"
    assert values["lucky_seven_days"] == 1, "sieben Siege am 7.11."
    assert values["echo_results"] == 1, "dreimal 2:0 in Folge am 7.11."
    assert values["full_moon_wins"] == 1, "der Sieg bei Vollmond; die Niederlage und der Sieg drei Tage später zählen nicht"
    assert values["palindrome_laps"] == 2, "1:23.321 und 0:59.950 - die ungültige 1:01.016 nicht"
    assert values["leap_day_logins"] == 1
    assert abs(counters.moon_phase(counters.REFERENCE_NEW_MOON)) < 1e-9
    assert abs(counters.moon_phase(counters.REFERENCE_NEW_MOON + timedelta(days=counters.SYNODIC_DAYS / 2)) - 0.5) < 1e-9


def test_katalog_d_form():
    club = [g for g in catalog.GROUPS_D if g["category"] == "club"]
    special = [g for g in catalog.GROUPS_D if g["category"] == "special"]
    hidden = [g for g in catalog.GROUPS_D if g["category"] == "hidden"]
    assert (len(club), len(special), len(hidden)) == (7, 16, 14)
    assert all(g["member_only"] for g in club)
    club_tiers = [t for t in catalog.TIERS_D if t["group_code"] in {g["code"] for g in club}]
    assert all(t["member_only"] for t in club_tiers)
    special_tiers = [t for t in catalog.TIERS_D if t["group_code"] in {g["code"] for g in special}]
    assert len(special_tiers) == 16 and all(t["material"] == "legendary" and t["level"] == 5 for t in special_tiers)
    hidden_tiers = [t for t in catalog.TIERS_D if t["group_code"] in {g["code"] for g in hidden}]
    assert len(hidden_tiers) == 14 and all(t["material"] == "hidden" and t["points"] == 40 for t in hidden_tiers)
    assert all(catalog.annotate_group(g).get("hidden") for g in hidden), "Geheim ist versteckt (Kennzeichen kommt aus der Kategorie beim Seed)"
    assert not any(catalog.annotate_group(g).get("hidden") for g in club + special)
    manual = {g["code"] for g in catalog.GROUPS_D if g["manual_only"]}
    assert manual == {"volunteer", "ehrenloewe", "gamers_heaven", "lan_founder", "beta_tester", "streamer_verified", "sponsor_friend", "hall_of_fame", "season_mvp"}
    assert "ehrenloewe_p" in catalog.REDEFINED_OLD_TIERS["ehrenloewe"]
    assert catalog.GROUP_BY_CODE["membership_tenure"]["catalog"] == "D"
