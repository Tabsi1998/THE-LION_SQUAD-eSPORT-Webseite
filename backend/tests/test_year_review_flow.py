"""Jahresrückblick (#1195): Zusammenfassung aus Turnieren (Einzel und Team), Events, Fast Laps, Erfolgen und
Jahreswertung; Zeitraum aus dem Admin (Standard 15.12. bis 31.01.); ohne Aktivität kein Rückblick und keine Meldung.
Die Uhr steht fest - die Tests hängen nicht vom heutigen Tag ab. Erfundene Daten, keine echten Personen."""
import io
import pathlib
import sys
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from services import year_review  # noqa: E402

DECEMBER = datetime(2026, 12, 20, 9, 0, tzinfo=timezone.utc)
OCTOBER = datetime(2026, 10, 8, 9, 0, tzinfo=timezone.utc)


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def freeze(monkeypatch, when):
    monkeypatch.setattr(year_review, "now_utc", lambda: when)


def png_size(content: bytes) -> tuple[int, int]:
    image = Image.open(io.BytesIO(content))
    assert image.format == "PNG"
    return image.size


async def finished(flow, title, start, **fields):
    return await flow.create_tournament(**{"title": title, "status": "results_published", "start_date": start, "game_name": "EA SPORTS FC 26", **fields})


async def duel(flow, tournament, own, other, own_score, other_score, round_no=1):
    await flow.db.matches_v2.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "stage_id": "s1", "round": round_no, "round_name": f"Runde {round_no}", "section": "WB",
        "match_type": "duel", "status": "completed",
        "slots": [{"position": 1, "registration_id": own["id"]}, {"position": 2, "registration_id": other["id"]}],
        "results": [{"registration_id": own["id"], "rank": 1 if own_score > other_score else 2, "score": own_score},
                    {"registration_id": other["id"], "rank": 1 if other_score > own_score else 2, "score": other_score}],
    })


async def active_year(flow):
    """Ein Jahr voller Sachen für „neonfalke“ - und ein paar andere, die auch gespielt haben."""
    me = await flow.add_user(role="player", name="neonfalke")
    rivals = [await flow.add_user(role="player", name=f"spieler{i}") for i in range(11)]

    cup = await finished(flow, "FC 26 Frühlings-Cup", "2026-03-14T15:00:00+00:00")
    mine = await flow.register(cup, me)
    await flow.db.tournament_registrations.update_one({"id": mine["id"]}, {"$set": {"final_position": 1}})
    regs = [await flow.register(cup, rival) for rival in rivals]
    await duel(flow, cup, mine, regs[0], 2, 0, round_no=1)
    await duel(flow, cup, mine, regs[1], 3, 1, round_no=2)

    team = {"id": new_id(), "name": "Lions Rocket", "tag": "LRK", "leader_id": rivals[0]["id"], "is_public": True}
    await flow.db.teams.insert_one(dict(team))
    for user in (rivals[0], me):
        await flow.db.team_members.insert_one({"team_id": team["id"], "user_id": user["id"], "role": "member"})
    race = await finished(flow, "Rocket Sommer-Cup", "2026-07-04T15:00:00+00:00", team_mode="team", team_size=2, game_name="Rocket League")
    ours = {"id": new_id(), "tournament_id": race["id"], "team_id": team["id"], "user_id": rivals[0]["id"], "display_name": "[LRK] Lions Rocket",
            "status": "approved", "final_position": 3}
    await flow.db.tournament_registrations.insert_one(dict(ours))
    other = {"id": new_id(), "tournament_id": race["id"], "team_id": new_id(), "display_name": "Nordlicht", "status": "approved"}
    await flow.db.tournament_registrations.insert_one(dict(other))
    await duel(flow, race, ours, other, 1, 2)

    # Voriges Jahr zählt nicht.
    old = await finished(flow, "FC 25 Winter-Cup", "2025-12-30T18:00:00+00:00")
    await flow.register(old, me)

    lan = {"id": new_id(), "name": "LAN-Wochenende Herbst", "start_date": "2026-10-03T08:00:00+00:00"}
    skipped = {"id": new_id(), "name": "Vereinsabend", "start_date": "2026-11-12T17:00:00+00:00"}
    await flow.db.events.insert_many([dict(lan), dict(skipped)])
    await flow.db.event_registrations.insert_many([
        {"id": new_id(), "event_id": lan["id"], "user_id": me["id"], "status": "checked_in"},
        {"id": new_id(), "event_id": skipped["id"], "user_id": me["id"], "status": "registered"},
    ])

    challenge = {"id": new_id(), "slug": "spa-challenge", "title": "Spa Challenge", "status": "completed", "start_date": "2026-05-01T10:00:00+00:00", "visibility": "public"}
    track = {"id": new_id(), "challenge_id": challenge["id"], "name": "Spa"}
    await flow.db.f1_challenges.insert_one(dict(challenge))
    await flow.db.f1_tracks.insert_one(dict(track))
    await flow.db.f1_lap_times.insert_many([
        {"id": new_id(), "challenge_id": challenge["id"], "track_id": track["id"], "user_id": me["id"], "time_ms": 121300, "created_at": "2026-05-02T10:00:00+00:00"},
        {"id": new_id(), "challenge_id": challenge["id"], "track_id": track["id"], "user_id": rivals[2]["id"], "time_ms": 122900, "created_at": "2026-05-02T11:00:00+00:00"},
    ])

    await flow.db.achievement_groups.insert_many([
        {"code": "spielmacher", "name": "Spielmacher", "category": "match"},
        {"code": "rote_karte", "name": "Rote Karte", "category": "match", "is_negative": True},
    ])
    await flow.db.achievements.insert_many([
        {"code": "spielmacher_3", "group_code": "spielmacher", "name": "Spielmacher III", "material": "gold", "rank": 3, "points": 40},
        {"code": "rote_karte_1", "group_code": "rote_karte", "name": "Rote Karte I", "material": "bronze", "rank": 1, "points": 0},
        {"code": "spielmacher_2", "group_code": "spielmacher", "name": "Spielmacher II", "material": "silver", "rank": 2, "points": 20},
    ])
    await flow.db.user_achievements.insert_many([
        {"id": new_id(), "user_id": me["id"], "tier_code": "spielmacher_3", "earned_at": "2026-08-01T10:00:00+00:00"},
        {"id": new_id(), "user_id": me["id"], "tier_code": "rote_karte_1", "earned_at": "2026-08-02T10:00:00+00:00"},
        {"id": new_id(), "user_id": me["id"], "tier_code": "spielmacher_2", "earned_at": "2025-06-01T10:00:00+00:00"},
    ])

    season = {"id": new_id(), "name": "Jahreswertung 2026", "kind": "season", "status": "active", "start_date": "2026-01-01T00:00:00+00:00"}
    await flow.db.seasons.insert_one(dict(season))
    for user, points in ((rivals[3], 300), (me, 210), (rivals[4], 90)):
        await flow.db.season_points.insert_one({"id": new_id(), "season_id": season["id"], "user_id": user["id"], "team_id": None, "total_points": points,
                                                "raw_points": points, "rank": None, "source_type": "tournament", "source_id": new_id()})
    return me, rivals


@pytest.mark.asyncio
async def test_review_sums_up_the_year_like_profile_references_and_ranking(flow, monkeypatch):
    freeze(monkeypatch, DECEMBER)
    me, _ = await active_year(flow)
    flow.act_as(me)
    assert (await flow.get("/api/year-review/status")).json() == {"available": True, "year": 2026, "path": "/dein-jahr"}
    res = await flow.get("/api/year-review/me")
    assert res.status_code == 200, res.text
    data = res.json()
    t = data["tournaments"]
    assert data["year"] == 2026 and data["user"]["display_name"] == "neonfalke"
    assert (t["count"], t["wins"], t["podiums"], t["games"], t["games_won"]) == (2, 1, 2, 3, 2)
    assert t["best"]["title"] == "FC 26 Frühlings-Cup" and t["best"]["rank"] == 1
    # 12 Spieler im Jahr; einer spielte auch im Team mit (gleich viele), zehn haben weniger: „mehr als 8 von 10“.
    assert t["more_than_of_ten"] == 8
    assert data["favorite_game"] == {"name": "EA SPORTS FC 26", "tournaments": 1, "games": 2}
    assert data["events"] == {"count": 1, "items": [{"name": "LAN-Wochenende Herbst", "date": "03.10.2026"}]}
    assert data["fastlap"]["count"] == 1
    assert data["fastlap"]["best"] == {"time": "2:01,300", "track": "Spa", "title": "Spa Challenge", "rank": 1, "participant_count": 2}
    # Negatives und Erfolge aus dem Vorjahr zählen nicht.
    assert data["achievements"]["count"] == 1 and data["achievements"]["top"][0]["name"] == "Spielmacher III"
    assert data["season"] == {"name": "Jahreswertung 2026", "rank": 2, "points": 210.0, "participants": 3}
    assert [row["label"] for row in data["rows"]] == ["Turniersiege", "Podestplätze", "Spiele", "Events besucht", "Bestzeit Spa", "Lieblingsspiel", "Jahreswertung", "Neue Erfolge"]
    card = await flow.get("/api/year-review/me/card.png")
    assert card.status_code == 200 and png_size(card.content) == (1080, 1920)
    assert "mein-jahr-2026.png" in card.headers["content-disposition"]

    # Im Jänner zeigt er noch das alte Jahr; im Februar ist er weg.
    freeze(monkeypatch, datetime(2027, 1, 31, 20, 0, tzinfo=timezone.utc))
    assert (await flow.get("/api/year-review/me")).json()["year"] == 2026
    freeze(monkeypatch, datetime(2027, 2, 1, 9, 0, tzinfo=timezone.utc))
    assert (await flow.get("/api/year-review/status")).json()["available"] is False
    assert (await flow.get("/api/year-review/me")).status_code == 404


@pytest.mark.asyncio
async def test_without_activity_no_review_and_no_notice_and_notices_come_once(flow, monkeypatch):
    freeze(monkeypatch, DECEMBER)
    me, rivals = await active_year(flow)
    idle = await flow.add_user(role="player", name="ruhepol")
    last_year = await finished(flow, "FC 25 Herbst-Cup", "2025-10-04T15:00:00+00:00")
    await flow.register(last_year, idle)
    flow.act_as(idle)
    assert (await flow.get("/api/year-review/status")).json() == {"available": False, "year": 2026}
    assert (await flow.get("/api/year-review/me")).status_code == 404
    assert (await flow.get("/api/year-review/me/card.png")).status_code == 404

    result = await year_review.send_notices(flow.db, now=DECEMBER)
    notified = {row["user_id"] for row in await flow.db.notifications.find({"kind": "year_review"}, {"_id": 0, "user_id": 1}).to_list(100)}
    assert result["year"] == 2026 and me["id"] in notified and idle["id"] not in notified
    # Wer im Team gespielt hat oder nur eine Fast Lap gefahren ist, bekommt die Meldung auch.
    assert rivals[0]["id"] in notified and rivals[2]["id"] in notified
    note = await flow.db.notifications.find_one({"kind": "year_review", "user_id": me["id"]}, {"_id": 0})
    assert note["title"] == "Dein Jahr 2026 ist da" and note["url"] == "/dein-jahr"
    # Ein zweiter Lauf schickt nichts mehr - auch wenn die Meldung inzwischen gelöscht ist.
    await flow.db.notifications.delete_many({"kind": "year_review", "user_id": me["id"]})
    assert (await year_review.send_notices(flow.db, now=datetime(2026, 12, 21, 9, 15, tzinfo=timezone.utc)))["sent"] == 0
    assert (await year_review.send_notices(flow.db, now=OCTOBER)) == {"sent": 0, "year": None}


@pytest.mark.asyncio
async def test_window_settings_and_preview_for_the_content_team(flow, monkeypatch):
    freeze(monkeypatch, OCTOBER)
    me, _ = await active_year(flow)
    admin = await flow.add_user(role="superadmin", name="vorstand")
    flow.act_as(me)
    assert (await flow.get("/api/year-review/me")).status_code == 404
    assert (await flow.get("/api/year-review/me?vorschau=true")).status_code == 404
    assert (await flow.get("/api/admin/year-review")).status_code == 403

    flow.act_as(admin)
    view = (await flow.get("/api/admin/year-review")).json()
    assert (view["start"], view["end"], view["open"], view["year"], view["notified"]) == ("12-15", "01-31", False, 2026, 0)
    assert (view["from_label"], view["until_label"]) == ("15.12.2026", "31.1.2027")
    res = await flow.put("/api/admin/year-review", json={"start": "1.12.", "end": "15.1"})
    assert res.status_code == 200 and (res.json()["start"], res.json()["end"]) == ("12-01", "01-15")
    assert (await flow.put("/api/admin/year-review", json={"start": "15.06.", "end": "31.01."})).status_code == 422
    assert (await flow.put("/api/admin/year-review", json={"start": "31.11.", "end": "31.01."})).status_code == 422
    # Die Verwaltung sieht ihren eigenen Rückblick als Vorschau schon vor dem Start - hier ohne Aktivität: nichts.
    assert (await flow.get("/api/year-review/me?vorschau=true")).status_code == 404
    await flow.register(await finished(flow, "Probe-Cup", "2026-09-01T15:00:00+00:00"), admin)
    preview = await flow.get("/api/year-review/me?vorschau=true")
    assert preview.status_code == 200 and preview.json()["preview"] is True and preview.json()["tournaments"]["count"] == 1


def test_window_follows_vienna_days_and_the_settings():
    settings = dict(year_review.DEFAULTS)
    vienna = lambda *args: datetime(*args, tzinfo=year_review.VIENNA)  # noqa: E731
    assert year_review.window_year(settings, vienna(2026, 12, 14, 23, 59)) is None
    assert year_review.window_year(settings, vienna(2026, 12, 15, 0, 1)) == 2026
    assert year_review.window_year(settings, vienna(2027, 1, 31, 23, 59)) == 2026
    assert year_review.window_year(settings, vienna(2027, 2, 1, 0, 1)) is None
    # 23:30 UTC am 14.12. ist in Wien schon der 15.
    assert year_review.window_year(settings, datetime(2026, 12, 14, 23, 30, tzinfo=timezone.utc)) == 2026
    custom = {"start": "12-01", "end": "01-15"}
    assert year_review.window_year(custom, vienna(2026, 12, 1, 8, 0)) == 2026
    assert year_review.window_year(custom, vienna(2027, 1, 16, 8, 0)) is None
    assert year_review.clean_day("15.12.", year_review.START_MONTHS) == "12-15"
    assert year_review.clean_day("12-15", year_review.START_MONTHS) == "12-15"
    assert year_review.clean_day("1.2", year_review.END_MONTHS) == "02-01"
    for bad, months in (("abc", year_review.START_MONTHS), ("15.06.", year_review.START_MONTHS), ("31.11.", year_review.START_MONTHS), ("15.12.", year_review.END_MONTHS)):
        with pytest.raises(ValueError):
            year_review.clean_day(bad, months)


def test_card_stays_whole_with_little_or_long_data():
    review = {
        "year": 2026, "user": {"username": "x", "display_name": "Ein ausgesprochen langer Anzeigename, der nicht in eine Zeile passt"},
        "club_name": "THE LION SQUAD", "domain": "verein.example",
        "tournaments": {"count": 0, "wins": 0, "podiums": 0, "games": 0, "games_won": 0, "best": None, "more_than_of_ten": None},
        "favorite_game": None, "events": {"count": 2, "items": []}, "fastlap": {"count": 0, "best": None},
        "achievements": {"count": 0, "points": 0, "top": []}, "season": None,
    }
    assert png_size(year_review.render(review)) == (1080, 1920)
    assert year_review.summary_rows(review) == [("Events besucht", "2")]
