"""Zähler (#616): Registry mit Quellen, Cache mit Ablauf, Auffrischen nur der betroffenen Zähler, Signale mit
Deckel und Saison, GG-Lob nur für Beteiligte nach dem Ende, Gelesen-Marker und Zuschauer-Ping je einmal,
Zeit- und Gegner-Zähler aus Matches, Turnier-, Team-, Profil- und Saison-Zähler aus echten Daten, der
nächtliche Abgleich - und die Auswertung, die mit Quelle nur die passenden Stufen ansieht.

Saison-Signale (#678): je Aktion gezählt mit Tagesdeckel, nachgemeldet je Tag (höchstens eine Woche zurück, nur
für Tage, an denen die Saison lief), mehrere auf einmal. Die Uhr steht in diesen Tests fest - sonst hingen sie am
Datum des Laufs."""
import pathlib
import sys
from datetime import date, datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
import achievement_catalog as catalog  # noqa: E402
import badges  # noqa: E402
from services import achievement_counters as counters  # noqa: E402
from services import achievement_queue  # noqa: E402
from services import seasons  # noqa: E402

REAL_TO_VIENNA = seasons.to_vienna
QUIET_DAY = datetime(2026, 9, 15, 12, 0, tzinfo=counters.VIENNA)
HALLOWEEN_EVE = datetime(2026, 10, 30, 20, 0, tzinfo=counters.VIENNA)


def set_clock(monkeypatch, moment: datetime):
    """Saison- und Signal-Uhr auf einen festen Augenblick stellen (der Test hängt sonst am Datum des Laufs)."""
    monkeypatch.setattr(seasons, "to_vienna", lambda now=None: REAL_TO_VIENNA(now if now is not None else moment))
    monkeypatch.setattr(counters, "now_utc", lambda: moment.astimezone(timezone.utc))


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


def test_registry_kennt_quellen_und_der_katalog_die_schluessel():
    assert set(counters.REGISTRY) <= set(catalog.CONDITION_KEY_STATUS)
    assert all(catalog.CONDITION_KEY_STATUS[key] == "live" for key in counters.REGISTRY)
    assert counters.keys_for_sources({"signal"}) >= {"halloween_pumpkin", "konami_found", "app_days"}
    assert "prizes_received" in counters.keys_for_sources({"tournament"}) and "prizes_received" not in counters.keys_for_sources({"signal"})
    with pytest.raises(ValueError):
        counters.counter("x", "mond")(lambda ctx: 0)


@pytest.mark.asyncio
async def test_cache_und_auffrischen_nur_der_betroffenen(flow):
    user = await flow.add_user(name="Spielerin")
    first = await counters.stats(user["id"])
    assert first["prizes_received"] == 0 and first["matches_played"] == 0
    doc = await flow.db[counters.STATS].find_one({"user_id": user["id"]}, {"_id": 0})
    assert doc["full_at"] and doc["values"]["level"] == 1
    await flow.db.prize_pickups.insert_one({"id": "p1", "user_id": user["id"], "tournament_id": "t1", "place": 1, "prize_value": "Pokal"})
    await flow.db[counters.SIGNALS].insert_one({"user_id": user["id"], "name": "logo_clicks", "count": 7, "days": {}})
    # Nur die Quelle „signal“: der Logo-Zähler kommt, der Preis nicht.
    values = await counters.refresh(user["id"], {"signal"})
    assert values["logo_clicks"] == 7 and values["prizes_received"] == 0
    # Frischer Cache bleibt stehen; abgelaufen wird alles neu gerechnet.
    assert (await counters.stats(user["id"]))["prizes_received"] == 0
    await flow.db[counters.STATS].update_one({"user_id": user["id"]}, {"$set": {"full_at": (now_utc() - timedelta(hours=1)).isoformat()}})
    assert (await counters.stats(user["id"]))["prizes_received"] == 1


@pytest.mark.asyncio
async def test_signale_mit_deckel_und_saison(flow, monkeypatch):
    set_clock(monkeypatch, QUIET_DAY)
    user = await flow.add_user(name="Klickerin")
    flow.act_as(user)
    assert (await flow.post("/api/achievements/signal", json={"name": "unsinn"})).status_code == 400
    res = await flow.post("/api/achievements/signal", json={"name": "konami"})
    assert res.status_code == 200 and res.json() == {"accepted": True, "count": 1, "day_count": 1, "day": "2026-09-15"}
    assert (await flow.post("/api/achievements/signal", json={"name": "konami"})).json()["accepted"] is False, "einmal am Tag"
    res = await flow.post("/api/achievements/signal", json={"name": "logo_clicks", "count": 150})
    assert res.json()["count"] == 100, "Deckel 100 am Tag"
    # Saisongebunden: Halloween läuft im Test nicht → abgelehnt; erzwungen im Admin → angenommen.
    assert (await flow.post("/api/achievements/signal", json={"name": "halloween_pumpkin"})).json() == {"accepted": False, "reason": "season"}
    await flow.db.settings.insert_one({"id": "seasons", "seasons": {"halloween": {"mode": "force_on"}}})
    assert (await flow.post("/api/achievements/signal", json={"name": "halloween_pumpkin"})).json()["accepted"] is True
    queued = await flow.db.achievement_eval_queue.find_one({"user_id": user["id"]}, {"_id": 0})
    assert "signal" in queued["sources"] and not queued.get("full")
    values = await counters.refresh(user["id"], {"signal"})
    assert values["konami_found"] == 1 and values["logo_clicks"] == 100 and values["halloween_pumpkin"] == 1


async def seed_match(flow, a: dict, b: dict, *, when: str, winner: str, seed_a: int = 2, seed_b: int = 1, match_id: str = "m1"):
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"id": "t1", "title": "Cup", "status": "completed", "is_public": True}}, upsert=True)
    for user, reg_id, seed in ((a, f"ra-{match_id}", seed_a), (b, f"rb-{match_id}", seed_b)):
        await flow.db.tournament_registrations.insert_one({"id": reg_id, "tournament_id": "t1", "user_id": user["id"], "seed": seed, "status": "checked_in", "created_at": when, "updated_at": when})
    await flow.db.matches_v2.insert_one({
        "id": match_id, "tournament_id": "t1", "status": "completed", "stage_number": 1, "round": 1, "order": 1, "completed_at": when, "updated_at": when,
        "slots": [{"slot": 1, "registration_id": f"ra-{match_id}", "seed": seed_a}, {"slot": 2, "registration_id": f"rb-{match_id}", "seed": seed_b}],
        "results": [{"registration_id": f"ra-{match_id}", "outcome": "winner" if winner == "a" else "loser"}, {"registration_id": f"rb-{match_id}", "outcome": "winner" if winner == "b" else "loser"}],
    })


@pytest.mark.asyncio
async def test_match_zaehler_zeit_gegner_setzliste(flow):
    a = await flow.add_user(name="Anna")
    b = await flow.add_user(name="Bernd")
    # Samstag 23:30 Wien (= 21:30 UTC im Sommer): spät, Wochenende, Sieg gegen besser gesetzten Gegner.
    await seed_match(flow, a, b, when="2026-08-01T21:30:00+00:00", winner="a", match_id="m1")
    # Dienstag 08:15 Wien: früh.
    await seed_match(flow, a, b, when="2026-08-04T06:15:00+00:00", winner="b", match_id="m2")
    values = await counters.compute(a["id"])
    assert values["matches_played"] == 2 and values["matches_after_23"] == 1 and values["matches_before_9"] == 1 and values["weekend_matches"] == 1
    assert values["same_opponent_max"] == 2 and values["upsets"] == 1 and values["seed_one_count"] == 0 and values["tournaments_completed"] == 1
    theirs = await counters.compute(b["id"])
    assert theirs["upsets"] == 0 and theirs["seed_one_count"] == 1


@pytest.mark.asyncio
async def test_gg_lob_nur_beteiligte_nach_dem_ende_einmal_je_seite(flow):
    a = await flow.add_user(name="Anna")
    b = await flow.add_user(name="Bernd")
    stranger = await flow.add_user(name="Fremd")
    await seed_match(flow, a, b, when="2026-08-01T21:30:00+00:00", winner="a", match_id="m1")
    flow.act_as(stranger)
    assert (await flow.get("/api/matches/m1/commend")).json()["participant"] is False
    assert (await flow.post("/api/matches/m1/commend")).status_code == 403
    flow.act_as(a)
    state = (await flow.get("/api/matches/m1/commend")).json()
    assert state == {"participant": True, "completed": True, "can_commend": True, "given": False, "received": 0}
    res = await flow.post("/api/matches/m1/commend")
    assert res.status_code == 200 and res.json()["given"] is True and res.json()["already"] is False
    assert (await flow.post("/api/matches/m1/commend")).json()["already"] is True
    assert await flow.db.match_commendations.count_documents({"match_id": "m1"}) == 1
    flow.act_as(b)
    assert (await flow.get("/api/matches/m1/commend")).json()["received"] == 1
    assert (await flow.post("/api/matches/m1/commend")).status_code == 200
    assert (await counters.compute(a["id"]))["commendations_given"] == 1 and (await counters.compute(a["id"]))["commendations_received"] == 1
    assert (await counters.compute(b["id"]))["commendations_received"] == 1
    # Laufendes Match: kein GG.
    await flow.db.matches_v2.update_one({"id": "m1"}, {"$set": {"status": "live"}})
    assert (await flow.post("/api/matches/m1/commend")).status_code == 400


@pytest.mark.asyncio
async def test_gelesen_und_gesehen_je_einmal(flow):
    user = await flow.add_user(name="Leserin")
    # Über die echte Verwaltung angelegt - so liegt der Beitrag dort, wo die Seite ihn auch findet.
    flow.act_as(await flow.add_staff("Redaktion"))
    assert (await flow.post("/api/news", json={"title": "Sommer-Cup", "slug": "sommer-cup", "content": "Bald geht es los."})).status_code == 200
    assert (await flow.post("/api/news", json={"title": "Entwurf", "slug": "entwurf", "content": "Noch nicht fertig.", "published": False})).status_code == 200
    flow.act_as(user)
    assert (await flow.post("/api/news/sommer-cup/read")).json() == {"read": True, "total": 1}
    assert (await flow.post("/api/news/sommer-cup/read")).json()["total"] == 1
    assert (await flow.post("/api/news/entwurf/read")).status_code == 404
    assert (await flow.post("/api/streams/watch", json={"key": "twitch:lion"})).json()["total"] == 1
    assert (await flow.post("/api/streams/watch", json={"key": "twitch:lion"})).json()["total"] == 1
    values = await counters.compute(user["id"])
    assert values["news_read"] == 1 and values["streams_watched"] == 1
    flow.act_as(None)
    assert (await flow.post("/api/news/sommer-cup/read")).status_code == 401


@pytest.mark.asyncio
async def test_profil_team_saison_und_turnier_zaehler(flow):
    user = await flow.add_user(name="Vielseitig")
    db = flow.db
    await db.users.update_one({"id": user["id"]}, {"$set": {"avatar_url": "/a.png", "banner_url": "/b.png", "bio": "Hallo", "website": "https://x.at", "email_verified": True, "notification_preferences": {"push": True}, "privacy_public_profile": True, "newsletter_consent": True, "created_at": (now_utc() - timedelta(days=800)).isoformat()}})
    await db.platform_links.insert_many([{"id": "l1", "user_id": user["id"], "platform": "discord", "external_id": "1"}, {"id": "l2", "user_id": user["id"], "platform": "youtube", "external_id": "2"}])
    await db.passkeys.insert_one({"user_id": user["id"], "rp_id": "lionsquad.at"})
    await db.mobile_push_tokens.insert_one({"user_id": user["id"], "token": "t"})
    await db.user_xp.insert_one({"user_id": user["id"], "total": 9000, "level": 10, "prestige": 1, "login_streak_max": 12, "birthday_logins": 2})
    await db.teams.insert_many([
        {"id": "team1", "name": "Löwen", "leader_id": user["id"], "member_ids": [user["id"], "u2", "u3"], "logo_url": "/l.png", "banner_url": "/b.png", "description": "Wir.", "created_at": (now_utc() - timedelta(days=40)).isoformat()},
        {"id": "team2", "name": "Zweit", "leader_id": "u9", "member_ids": [user["id"]], "created_at": now_utc().isoformat()},
    ])
    await db.tournament_registrations.insert_one({"id": "rt", "tournament_id": "t9", "team_id": "team1", "created_at": now_utc().isoformat()})
    await db.season_standings.insert_many([{"season_id": "s1", "user_id": user["id"], "rank": 1}, {"season_id": "s2", "user_id": user["id"], "rank": 7}, {"season_id": "s3", "user_id": user["id"], "rank": 30}])
    await db.events.insert_many([{"id": "e1", "created_by": user["id"], "status": "completed", "visibility": "public"}, {"id": "e2", "created_by": "x", "status": "completed", "visibility": "members"}])
    await db.event_registrations.insert_one({"id": "er1", "event_id": "e2", "user_id": user["id"], "status": "checked_in"})
    await db.tournament_staff_assignments.insert_one({"id": "sa1", "tournament_id": "t9", "user_id": user["id"], "role": "referee"})
    await db.tournaments.insert_one({"id": "t9", "title": "Staffed", "status": "completed", "is_public": True, "registration_opens_at": "2026-05-01T18:00:00+00:00"})
    await db.tournament_registrations.insert_one({"id": "rf", "tournament_id": "t9", "user_id": user["id"], "created_at": "2026-05-01T18:04:00+00:00", "status": "checked_in", "updated_at": "2026-05-02T10:00:00+00:00"})
    await db.tournament_awards.insert_many([{"tournament_id": "t9", "registration_id": "rf", "place": 2}, {"tournament_id": "t8", "registration_id": "rf", "place": 6}])
    await db.user_reports.insert_many([{"id": "r1", "reporter_id": user["id"], "status": "removed"}, {"id": "r2", "reporter_id": user["id"], "status": "open"}])
    values = await counters.compute(user["id"])
    expected = {
        "avatar_and_banner": 1, "bio_and_socials": 1, "email_verified": 1, "passkey_registered": 1, "notification_prefs_saved": 1, "privacy_reviewed": 1,
        "newsletter_subscribed": 1, "push_enabled": 1, "account_years": 2, "discord_linked": 1, "youtube_linked": 1, "twitch_linked": 0, "linked_accounts": 2,
        "login_streak_max": 12, "level": 10, "prestige_stars": 1, "birthday_logins": 2,
        "team_size_max": 3, "team_profile_complete": 1, "captain_days": 40, "team_tournaments_played": 1,
        "season_top10_finishes": 2, "season_wins": 1, "events_hosted_completed": 1, "club_events_attended": 1,
        "tournaments_staffed_completed": 1, "fast_registrations": 1, "first_checkins": 1, "top8_finishes": 2, "finals_played": 1, "reports_actioned": 1,
    }
    assert {key: values[key] for key in expected} == expected


@pytest.mark.asyncio
async def test_auswertung_mit_quelle_sieht_nur_passende_stufen(flow):
    user = await flow.add_user(name="Sammlerin")
    await flow.db.prize_pickups.insert_one({"id": "p1", "user_id": user["id"], "tournament_id": "t1", "place": 1})
    await flow.db.achievement_groups.insert_one({"code": "prize_test", "id": "prize_test", "name": "Preise", "category": "tournament", "public": True, "is_special": False, "is_negative": False, "icon": "gift", "accent_color": "#fff", "description": "", "sort_order": 5})
    await flow.db.achievements.insert_one(catalog.tier("prize_test_1", "prize_test", "bronze", "Preis I", "Ein Preis.", condition_key="prizes_received", progress_target=1) | {"id": "prize_test_1"})
    # Mit der falschen Quelle passiert nichts, mit der richtigen wird vergeben.
    assert await badges.evaluate_user_progress(user["id"], {"signal"}) == 0
    assert await flow.db.user_achievements.count_documents({"user_id": user["id"], "tier_code": "prize_test_1"}) == 0
    assert await badges.evaluate_user_progress(user["id"], {"tournament"}) >= 1
    assert await flow.db.user_achievements.count_documents({"user_id": user["id"], "tier_code": "prize_test_1"}) == 1
    # Die Schlange merkt sich Quellen und rechnet danach nur diese - oder alles, wenn jemand ohne Quelle kam.
    await flow.db.achievement_eval_queue.delete_many({})
    await achievement_queue.request_evaluation([user["id"]], "a", sources={"signal"})
    await achievement_queue.request_evaluation([user["id"]], "b", sources={"team"})
    entry = await flow.db.achievement_eval_queue.find_one({"user_id": user["id"]}, {"_id": 0})
    assert entry["sources"] == ["signal", "team"] and not entry.get("full")
    await achievement_queue.request_evaluation([user["id"]], "c")
    assert (await flow.db.achievement_eval_queue.find_one({"user_id": user["id"]}, {"_id": 0}))["full"] is True


@pytest.mark.asyncio
async def test_naechtlicher_abgleich_findet_abweichungen(flow):
    user = await flow.add_user(name="Nachtaktiv")
    await counters.stats(user["id"])
    await flow.db.xp_events.insert_one({"id": "x1", "user_id": user["id"], "source": "match_won", "ref": "m", "amount": 40, "bonus": 0, "day": "2026-09-28", "at": now_utc().isoformat()})
    await flow.db.prize_pickups.insert_one({"id": "p1", "user_id": user["id"], "tournament_id": "t1", "place": 1})
    result = await counters.reconcile(days=7)
    assert result["checked"] == 1 and result["drift"] == 1
    assert (await flow.db[counters.STATS].find_one({"user_id": user["id"]}, {"_id": 0}))["values"]["prizes_received"] == 1


def test_tag_einer_meldung_heute_bis_eine_woche_zurueck():
    today = date(2026, 10, 30)
    assert counters.signal_day(None, today) == (today, None)
    assert counters.signal_day("", today) == (today, None)
    assert counters.signal_day("2026-10-30", today) == (today, None)
    assert counters.signal_day("2026-10-23", today) == (date(2026, 10, 23), None), "genau eine Woche zurück zählt noch"
    assert counters.signal_day("2026-10-22", today) == (None, "old")
    assert counters.signal_day("2026-10-31", today) == (None, "day"), "nichts aus der Zukunft"
    assert counters.signal_day("kaputt", today) == (None, "day")
    assert counters.signal_day("2026-02-30", today) == (None, "day")
    assert counters.REPLAY_DAYS == 7
    # Jede Regel hat einen Deckel; was nur im Augenblick zählt, ist gekennzeichnet.
    assert all(int(rule["per_day"]) >= 1 for rule in counters.SIGNAL_RULES.values())
    assert {name for name, rule in counters.SIGNAL_RULES.items() if rule.get("live")} == {"online_at_new_year", "app_open"}
    assert {name for name, rule in counters.SIGNAL_RULES.items() if rule.get("season") == "halloween"} == {
        "halloween_pumpkin", "halloween_bats_scared", "halloween_ghosts_freed", "halloween_cat_petted"}


@pytest.mark.asyncio
async def test_saison_signale_zaehlen_je_aktion_mit_tagesdeckel(flow, monkeypatch):
    """Fledermäuse, Geister und Katze (#678): jede Aktion zählt, der Deckel gilt je Tag, außerhalb der Saison nichts."""
    set_clock(monkeypatch, QUIET_DAY)
    user = await flow.add_user(name="Sammlerin")
    flow.act_as(user)
    for name in ("halloween_bats_scared", "halloween_ghosts_freed", "halloween_cat_petted", "halloween_pumpkin"):
        assert (await flow.post("/api/achievements/signal", json={"name": name})).json() == {"accepted": False, "reason": "season"}, name
    set_clock(monkeypatch, HALLOWEEN_EVE)
    res = await flow.post("/api/achievements/signal", json={"name": "halloween_bats_scared", "count": 12})
    assert res.json() == {"accepted": True, "count": 12, "day_count": 12, "day": "2026-10-30"}
    res = await flow.post("/api/achievements/signal", json={"name": "halloween_bats_scared", "count": 25})
    assert res.json() == {"accepted": True, "count": 30, "day_count": 30, "day": "2026-10-30"}, "dreißig am Tag"
    res = await flow.post("/api/achievements/signal", json={"name": "halloween_bats_scared"})
    assert res.json() == {"accepted": False, "reason": "cap", "count": 30, "day_count": 30, "day": "2026-10-30"}
    assert (await flow.post("/api/achievements/signal", json={"name": "halloween_ghosts_freed", "count": 50})).json()["count"] == 20
    assert (await flow.post("/api/achievements/signal", json={"name": "halloween_cat_petted", "count": 50})).json()["count"] == 10
    # Am nächsten Tag ist wieder Platz.
    set_clock(monkeypatch, HALLOWEEN_EVE + timedelta(days=1))
    res = await flow.post("/api/achievements/signal", json={"name": "halloween_bats_scared", "count": 4})
    assert res.json() == {"accepted": True, "count": 34, "day_count": 4, "day": "2026-10-31"}
    # Gespeichert wird nur Person, Signal, Tag und Anzahl.
    doc = await flow.db[counters.SIGNALS].find_one({"user_id": user["id"], "name": "halloween_bats_scared"}, {"_id": 0})
    assert set(doc) == {"user_id", "name", "count", "days", "first_at", "last_at"}
    assert doc["days"] == {"2026-10-30": 30, "2026-10-31": 4} and doc["count"] == 34


@pytest.mark.asyncio
async def test_nachmelden_je_tag_und_mehrere_auf_einmal(flow, monkeypatch):
    """Wer ohne Anmeldung gesammelt hat, meldet nach dem Login nach (#678): je Tag mit demselben Deckel, höchstens eine
    Woche zurück, nur für Tage, an denen die Saison lief, nie für die Zukunft - und was nur im Augenblick zählt, gar nicht."""
    set_clock(monkeypatch, HALLOWEEN_EVE)
    user = await flow.add_user(name="Nachzüglerin")
    flow.act_as(None)
    assert (await flow.post("/api/achievements/signals", json={"items": [{"name": "halloween_bats_scared"}]})).status_code == 401
    flow.act_as(user)
    assert (await flow.post("/api/achievements/signals", json={"items": []})).status_code == 422
    assert (await flow.post("/api/achievements/signals", json={"items": [{"name": "konami"}] * 41})).status_code == 422
    items = [
        {"name": "halloween_bats_scared", "count": 40, "day": "2026-10-27"},
        {"name": "halloween_ghosts_freed", "count": 3, "day": "2026-10-29"},
        {"name": "halloween_bats_scared", "count": 7},
        {"name": "unsinn", "count": 1},
        {"name": "halloween_bats_scared", "count": 5, "day": "2026-10-20"},
        {"name": "halloween_bats_scared", "count": 5, "day": "2026-10-24"},
        {"name": "halloween_bats_scared", "count": 1, "day": "2026-10-31"},
        {"name": "snowflakes_clicked", "count": 5},
        {"name": "online_at_new_year", "count": 1, "day": "2026-10-29"},
        {"name": "halloween_cat_petted", "count": 2, "day": "kaputt"},
    ]
    res = await flow.post("/api/achievements/signals", json={"items": items})
    assert res.status_code == 200, res.text
    body = res.json()
    # 37 Fledermäuse und 3 Geister: Fledermausflüsterer I und II, dazu der erste Jahreszeiten-Sammler (40 Fundstücke).
    assert body["accepted"] == 3 and body["newly_awarded"] == 3
    awards = await flow.db.user_achievements.find({"user_id": user["id"]}, {"_id": 0, "tier_code": 1}).to_list(10)
    assert sorted(a["tier_code"] for a in awards) == ["bat_whisperer_1", "bat_whisperer_2", "season_collector_1"]
    assert body["results"] == [
        {"name": "halloween_bats_scared", "day": "2026-10-27", "accepted": True, "count": 30, "day_count": 30},
        {"name": "halloween_ghosts_freed", "day": "2026-10-29", "accepted": True, "count": 3, "day_count": 3},
        {"name": "halloween_bats_scared", "day": "2026-10-30", "accepted": True, "count": 37, "day_count": 7},
        {"name": "unsinn", "day": None, "accepted": False, "reason": "unknown"},
        {"name": "halloween_bats_scared", "day": "2026-10-20", "accepted": False, "reason": "old"},
        {"name": "halloween_bats_scared", "day": "2026-10-24", "accepted": False, "reason": "season"},
        {"name": "halloween_bats_scared", "day": "2026-10-31", "accepted": False, "reason": "day"},
        {"name": "snowflakes_clicked", "day": None, "accepted": False, "reason": "season"},
        {"name": "online_at_new_year", "day": "2026-10-29", "accepted": False, "reason": "live"},
        {"name": "halloween_cat_petted", "day": "kaputt", "accepted": False, "reason": "day"},
    ]
    # Noch einmal dasselbe: der nachgemeldete Tag ist voll, nichts zählt doppelt.
    again = await flow.post("/api/achievements/signals", json={"items": items[:1]})
    assert again.json() == {"accepted": 0, "newly_awarded": 0, "results": [{"name": "halloween_bats_scared", "day": "2026-10-27", "accepted": False, "reason": "cap", "count": 37, "day_count": 30}]}
    doc = await flow.db[counters.SIGNALS].find_one({"user_id": user["id"], "name": "halloween_bats_scared"}, {"_id": 0})
    assert doc["days"] == {"2026-10-27": 30, "2026-10-30": 7} and doc["count"] == 37
    # Ausgewertet wurde sofort: für die Signale steht nichts in der Warteschlange - nur die neuen Stufen selbst
    # merken vor, dass die Zähler über Erfolge (Anzahl, Punkte) nachgerechnet werden.
    queued = await flow.db.achievement_eval_queue.find({"user_id": user["id"]}, {"_id": 0}).to_list(10)
    assert all("signal" not in (entry.get("sources") or []) and not entry.get("full") for entry in queued), queued
    # Nach der Saison lässt sich die letzte Woche noch nachmelden - der Tag zählt, nicht der Augenblick der Meldung.
    set_clock(monkeypatch, datetime(2026, 11, 3, 9, 0, tzinfo=counters.VIENNA))
    late = await flow.post("/api/achievements/signals", json={"items": [
        {"name": "halloween_bats_scared", "count": 2, "day": "2026-11-01"},
        {"name": "halloween_bats_scared", "count": 2, "day": "2026-11-02"},
        {"name": "halloween_bats_scared", "count": 2},
    ]})
    assert [(row["accepted"], row.get("reason")) for row in late.json()["results"]] == [(True, None), (False, "season"), (False, "season")]


@pytest.mark.asyncio
async def test_meldung_wertet_sofort_aus_und_nur_die_signal_zaehler(flow, monkeypatch):
    """Nach einer Meldung wird sofort ausgewertet (#678): die neue Stufe steht in der Antwort, damit sie gleich gefeiert
    wird. Gerechnet werden nur die Zähler aus Signalen - der alte Block bleibt liegen. Geht die Auswertung schief, zählt
    das Signal trotzdem, und die Warteschlange holt sie nach."""
    set_clock(monkeypatch, datetime(2026, 10, 31, 20, 0, tzinfo=counters.VIENNA))
    user = await flow.add_user(name="Gruselgast")
    flow.act_as(user)
    legacy_runs = []
    real_legacy = badges.compute_user_progress

    async def watched(user_id):
        legacy_runs.append(user_id)
        return await real_legacy(user_id)

    monkeypatch.setattr(badges, "compute_user_progress", watched)
    res = await flow.post("/api/achievements/signals", json={"items": [{"name": "halloween_pumpkin"}, {"name": "halloween_bats_scared", "count": 3}]})
    assert res.status_code == 200, res.text
    assert res.json()["accepted"] == 2 and res.json()["newly_awarded"] == 1, res.json()
    assert legacy_runs == [], "der alte Block läuft bei Signalen nicht mit"
    awards = await flow.db.user_achievements.find({"user_id": user["id"]}, {"_id": 0, "tier_code": 1}).to_list(10)
    assert [a["tier_code"] for a in awards] == ["halloween_1"], "Gruselnacht"
    stats = await flow.db[counters.STATS].find_one({"user_id": user["id"]}, {"_id": 0})
    assert stats["values"]["halloween_pumpkin"] == 1 and "full_at" not in stats
    # Zwei Fledermäuse dazu machen fünf: Fledermausflüsterer I. Noch einmal melden: nichts Neues, nichts doppelt.
    res = await flow.post("/api/achievements/signals", json={"items": [{"name": "halloween_bats_scared", "count": 2}]})
    assert res.json()["accepted"] == 1 and res.json()["newly_awarded"] == 1
    res = await flow.post("/api/achievements/signals", json={"items": [{"name": "halloween_bats_scared", "count": 1}]})
    assert res.json()["accepted"] == 1 and res.json()["newly_awarded"] == 0
    awards = await flow.db.user_achievements.find({"user_id": user["id"]}, {"_id": 0, "tier_code": 1}).to_list(10)
    assert sorted(a["tier_code"] for a in awards) == ["bat_whisperer_1", "halloween_1"]
    # Die volle Auswertung rechnet weiterhin alles - auch den alten Block.
    assert await badges.evaluate_user_progress(user["id"], {"signal"}) == 0
    assert legacy_runs == [user["id"]]

    async def broken(*_args, **_kwargs):
        raise RuntimeError("Auswertung kaputt")

    monkeypatch.setattr(badges, "evaluate_user_progress", broken)
    res = await flow.post("/api/achievements/signals", json={"items": [{"name": "halloween_ghosts_freed", "count": 1}]})
    assert res.status_code == 200 and res.json()["accepted"] == 1 and res.json()["newly_awarded"] == 0
    queued = await flow.db.achievement_eval_queue.find_one({"user_id": user["id"]}, {"_id": 0})
    assert queued and "signal" in queued["sources"]


@pytest.mark.asyncio
async def test_auskunft_nennt_die_signale_und_konto_loeschen_nimmt_sie_mit(flow, monkeypatch):
    """Datenschutz (#678): was für die Erfolge gezählt wurde, steht in der Auskunft - und verschwindet mit dem Konto.
    Die Zahlen einer anderen Person bleiben unberührt."""
    set_clock(monkeypatch, HALLOWEEN_EVE)
    user = await flow.add_user(name="Auskunft")
    other = await flow.add_user(name="Andere")
    for person in (user, other):
        flow.act_as(person)
        sent = [{"name": "halloween_bats_scared", "count": 4}, {"name": "logo_clicks", "count": 3}]
        assert (await flow.post("/api/achievements/signals", json={"items": sent})).json()["accepted"] == 2
        # Gelesen und gesehen direkt in der Sammlung: hier geht es um Auskunft und Löschen, nicht um die Meldewege.
        await flow.db.news_reads.insert_one({"user_id": person["id"], "news_id": "n1", "read_at": HALLOWEEN_EVE.isoformat()})
        await flow.db.stream_watches.insert_one({"user_id": person["id"], "key": "twitch:lionsquad", "day": "2026-10-30", "at": HALLOWEEN_EVE.isoformat()})
    flow.act_as(user)
    export = (await flow.get("/api/dsgvo/export-my-data")).json()
    signals = sorted((row["name"], row["count"], row["days"]) for row in export["achievement_signals"])
    assert signals == [("halloween_bats_scared", 4, {"2026-10-30": 4}), ("logo_clicks", 3, {"2026-10-30": 3})]
    assert [row["news_id"] for row in export["news_reads"]] == ["n1"]
    assert [row["key"] for row in export["stream_watches"]] == ["twitch:lionsquad"]
    assert all(row["user_id"] == user["id"] for key in ("achievement_signals", "news_reads", "stream_watches") for row in export[key])
    assert export["achievement_counters"]["user_id"] == user["id"] and export["achievement_counters"]["values"]["logo_clicks"] == 3
    assert export["commendations_given"] == []
    assert (await flow.post("/api/dsgvo/anonymize-me")).status_code == 200
    for collection in (counters.SIGNALS, "news_reads", "stream_watches", counters.STATS):
        assert await flow.db[collection].count_documents({"user_id": user["id"]}) == 0, collection
        assert await flow.db[collection].count_documents({"user_id": other["id"]}) == (2 if collection == counters.SIGNALS else 1), collection


@pytest.mark.asyncio
async def test_fundstuecke_zaehler_und_uebersicht_fuer_das_eigene_profil(flow, monkeypatch):
    """Saison-Fundstücke (#678): die Zähler für die Erfolge und die Übersicht im Profil - je Saison, was gesammelt
    wurde: insgesamt, in dieser Saison, heute, mit Tagesdeckel und nächstem Termin. Nur für die Person selbst."""
    from services import collectibles

    assert collectibles.SEASON_ORDER == ("halloween", "snow", "advent_calendar", "new_year", "easter_hunt")
    assert set(collectibles.COLLECTIBLE_SIGNALS) <= set(counters.SIGNAL_RULES)
    assert {item["icon"] for item in collectibles.COLLECTIBLES} == {"bat", "ghost", "cat", "pumpkin", "snowflake", "door", "rocket", "egg"}
    assert collectibles.total_of({"halloween_bats_scared": {"count": 4}, "logo_clicks": {"count": 90}, "easter_egg": {"count": 2}}) == 6
    assert collectibles.total_of({}) == 0

    set_clock(monkeypatch, HALLOWEEN_EVE)
    user = await flow.add_user(name="Sammlerin")
    other = await flow.add_user(name="Andere")
    flow.act_as(None)
    assert (await flow.get("/api/achievements/collectibles")).status_code == 401
    flow.act_as(user)
    empty = (await flow.get("/api/achievements/collectibles")).json()
    assert empty["total"] == 0 and [season["key"] for season in empty["seasons"]] == list(collectibles.SEASON_ORDER)
    halloween = empty["seasons"][0]
    assert halloween["active"] is True and halloween["label"] == "Halloween" and halloween["ends_at"].startswith("2026-11-01T23:59:59") and halloween["next_start"] is None
    assert [item["signal"] for item in halloween["items"]] == ["halloween_bats_scared", "halloween_ghosts_freed", "halloween_cat_petted", "halloween_pumpkin"]
    assert halloween["items"][0] == {"signal": "halloween_bats_scared", "label": "Fledermäuse verscheucht", "icon": "bat", "count": 0, "season_count": 0, "today": 0,
                                     "per_day": 30, "first_at": None, "last_at": None}
    winter = empty["seasons"][1]
    assert winter["active"] is False and winter["label"] == "Winter" and winter["next_start"].startswith("2026-11-29T00:00:00") and winter["ends_at"] is None

    # Gesammelt: letztes Jahr (in den Daten), vorgestern (nachgemeldet) und heute.
    await flow.db[counters.SIGNALS].insert_one({"user_id": user["id"], "name": "halloween_bats_scared", "count": 20, "days": {"2025-10-31": 20}, "first_at": "2025-10-31T19:00:00+00:00", "last_at": "2025-10-31T19:30:00+00:00"})
    await flow.db[counters.SIGNALS].insert_one({"user_id": user["id"], "name": "snowflakes_clicked", "count": 60, "days": {"2025-12-24": 60}})
    await flow.db[counters.SIGNALS].insert_one({"user_id": other["id"], "name": "halloween_bats_scared", "count": 99, "days": {"2026-10-30": 99}})
    res = await flow.post("/api/achievements/signals", json={"items": [
        {"name": "halloween_bats_scared", "count": 8, "day": "2026-10-28"}, {"name": "halloween_bats_scared", "count": 4},
        {"name": "halloween_ghosts_freed", "count": 2}, {"name": "halloween_pumpkin"},
    ]})
    assert res.json()["accepted"] == 4
    view = (await flow.get("/api/achievements/collectibles")).json()
    assert view["total"] == 20 + 8 + 4 + 2 + 1 + 60
    by_signal = {item["signal"]: item for season in view["seasons"] for item in season["items"]}
    bats = by_signal["halloween_bats_scared"]
    assert (bats["count"], bats["season_count"], bats["today"], bats["per_day"]) == (32, 12, 4, 30)
    assert by_signal["halloween_ghosts_freed"]["count"] == 2 and by_signal["halloween_pumpkin"]["today"] == 1
    flakes = by_signal["snowflakes_clicked"]
    assert (flakes["count"], flakes["season_count"], flakes["today"]) == (60, 60, 0), "die letzte Schnee-Saison zählt als „zuletzt“"
    assert view["seasons"][0]["count"] == 35 and view["seasons"][1]["count"] == 60
    # Die Zähler für die Erfolge: Fledermäuse, Flocken, alles zusammen - und die Stufen dazu.
    values = await counters.refresh(user["id"], {"signal"})
    assert values["halloween_bats_scared"] == 32 and values["snowflakes_clicked"] == 60 and values["season_collectibles_total"] == 95
    awards = {a["tier_code"] async for a in flow.db.user_achievements.find({"user_id": user["id"]}, {"_id": 0, "tier_code": 1})}
    assert {"bat_whisperer_1", "bat_whisperer_2", "snow_catcher_1", "snow_catcher_2", "season_collector_1", "snow_king_1", "halloween_1"} <= awards
    assert "bat_whisperer_3" not in awards and "season_collector_2" not in awards
    # Die andere Person sieht ihre eigenen Zahlen, nicht diese.
    flow.act_as(other)
    assert (await flow.get("/api/achievements/collectibles")).json()["total"] == 99
    # Nach der Saison: Halloween ist vorbei, der Stand bleibt, der nächste Termin steht da.
    set_clock(monkeypatch, datetime(2026, 11, 10, 12, 0, tzinfo=counters.VIENNA))
    flow.act_as(user)
    later = (await flow.get("/api/achievements/collectibles")).json()
    halloween = later["seasons"][0]
    assert halloween["active"] is False and halloween["next_start"].startswith("2027-10-25") and halloween["ends_at"] is None
    assert {item["signal"]: (item["count"], item["season_count"], item["today"]) for item in halloween["items"]}["halloween_bats_scared"] == (32, 12, 0)


@pytest.mark.asyncio
async def test_fundstuecke_auf_dem_oeffentlichen_profil_nur_mit_schalter_und_nur_die_summen(flow, monkeypatch):
    """#678 (Rest): andere sehen die Saison-Fundstücke nur, wenn das Profil öffentlich ist UND der eigene Schalter
    „Saison-Fundstücke öffentlich“ an ist (Vorgabe aus) - und dann nur Summen je Saison und Fundstück, kein „heute“,
    kein Datum, keine Saison ohne Fund. Die Person selbst und das Admin-Team sehen sie immer."""
    set_clock(monkeypatch, HALLOWEEN_EVE)
    owner = await flow.add_user(name="Sammlerin")
    viewer = await flow.add_user(name="Gast")
    await flow.db[counters.SIGNALS].insert_one({"user_id": owner["id"], "name": "halloween_bats_scared", "count": 12, "days": {"2026-10-30": 5, "2025-10-31": 7}, "first_at": "2025-10-31T19:00:00+00:00", "last_at": "2026-10-30T19:30:00+00:00"})
    url = f"/api/achievements/collectibles/user/{owner['id']}"
    # Profil nicht öffentlich: für andere gibt es die Person nicht.
    await flow.db.users.update_one({"id": owner["id"]}, {"$set": {"privacy_public_profile": False}})
    flow.act_as(viewer)
    assert (await flow.get(url)).status_code == 404
    # Öffentlich, Schalter noch nicht gesetzt (Vorgabe aus): versteckt.
    await flow.db.users.update_one({"id": owner["id"]}, {"$set": {"privacy_public_profile": True}})
    assert (await flow.get(url)).json() == {"hidden": True, "total": 0, "seasons": []}
    # Die Person selbst sieht ihre Summen auch ohne Schalter - so, wie andere sie sehen würden.
    flow.act_as(owner)
    mine = (await flow.get(url)).json()
    assert mine["hidden"] is False and mine["public"] is False and mine["total"] == 12
    # Schalter an (über das eigene Profil gespeichert): andere sehen nur die Summen.
    assert (await flow.patch("/api/users/me", json={"privacy_season_finds_public": True})).status_code == 200
    flow.act_as(viewer)
    seen = (await flow.get(url)).json()
    assert seen["hidden"] is False and seen["public"] is True and seen["total"] == 12
    assert [season["key"] for season in seen["seasons"]] == ["halloween"]
    assert seen["seasons"][0]["items"] == [{"signal": "halloween_bats_scared", "label": seen["seasons"][0]["items"][0]["label"], "icon": "bat", "count": 12}]
    flat = str(seen)
    for private in ("today", "first_at", "last_at", "per_day", "season_count", "next_start", "ends_at"):
        assert private not in flat
    # Ohne Anmeldung genauso (öffentliches Profil).
    flow.act_as(None)
    assert (await flow.get(url)).json()["total"] == 12
    assert (await flow.get("/api/achievements/collectibles/user/gibt-es-nicht")).status_code == 404
