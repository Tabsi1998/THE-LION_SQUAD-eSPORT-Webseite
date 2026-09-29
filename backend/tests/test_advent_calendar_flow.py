"""Adventkalender (#641): ein Türchen geht an seinem Tag um 6 Uhr auf und verrät vorher nichts; angemeldet zählt
es einmal je Person, Jahr und Tag; beim Quiz wird nie die Antwort gespeichert; nachholen geht bis Dreikönig; die
Verwaltung pflegt, kopiert, sieht Zahlen und eine Vorschau - und „Alle Türchen“ heißt 24 von 24 im selben Jahr."""
import json
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import badges  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import achievement_counters as counters  # noqa: E402
from services import advent_calendar as advent  # noqa: E402
from services import seasons  # noqa: E402
from services.stickers import builtin_catalog  # noqa: E402

REAL_TO_VIENNA = seasons.to_vienna
VIENNA = seasons.VIENNA


def vienna(year, month, day, hour=12, minute=0, second=0) -> datetime:
    return datetime(year, month, day, hour, minute, second, tzinfo=VIENNA)


def set_clock(monkeypatch, moment: datetime):
    """Saison, Signale und Kalender auf einen festen Augenblick stellen."""
    monkeypatch.setattr(seasons, "to_vienna", lambda now=None: REAL_TO_VIENNA(now if now is not None else moment))
    monkeypatch.setattr(counters, "now_utc", lambda: moment.astimezone(timezone.utc))
    monkeypatch.setattr(advent, "now_utc", lambda: moment.astimezone(timezone.utc))


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


async def save(flow, staff, day, year=2026, **fields):
    flow.act_as(staff)
    res = await flow.put(f"/api/seasonal/advent/admin/{year}/{day}", json={"kind": "text", "title": f"Titel {day}", "body": f"Geheimer Text {day}", **fields})
    assert res.status_code == 200, res.text
    return res.json()


QUIZ = {"question": "Wie viele Kerzen hat der Adventkranz?", "answers": ["Drei", "Vier", "Fünf"], "correct": 1, "explanation": "Eine je Adventsonntag."}


# ------------------------------------------------------------------ Zeitregel

def test_ein_tuerchen_geht_um_sechs_uhr_auf():
    assert advent.opens_at(2026, 5).isoformat() == "2026-12-05T06:00:00+01:00"
    assert seasons.advent_doors_open(2026, vienna(2026, 11, 30, 23, 59)) == 0
    assert seasons.advent_doors_open(2026, vienna(2026, 12, 1, 5, 59, 59)) == 0
    assert seasons.advent_doors_open(2026, vienna(2026, 12, 1, 6)) == 1
    assert seasons.advent_doors_open(2026, vienna(2026, 12, 5, 5, 59, 59)) == 4
    assert seasons.advent_doors_open(2026, vienna(2026, 12, 24, 6)) == 24
    assert seasons.advent_doors_open(2026, vienna(2027, 1, 6, 23)) == 24
    # 05:30 in Wien ist 04:30 UTC - die Regel gilt nach der Uhr in Wien, egal in welcher Zone gefragt wird.
    assert seasons.advent_doors_open(2026, datetime(2026, 12, 5, 4, 59, tzinfo=timezone.utc)) == 4
    assert seasons.advent_doors_open(2026, datetime(2026, 12, 5, 5, 0, tzinfo=timezone.utc)) == 5

    def data(moment):
        return {s["key"]: s for s in seasons.active(moment, {})["seasons"]}["advent_calendar"]["data"]

    assert data(vienna(2026, 12, 1, 3)) == {"today_door": 0, "catch_up": False, "door_hour": 6}
    assert data(vienna(2026, 12, 3, 9))["today_door"] == 3 and data(vienna(2026, 12, 3, 5))["today_door"] == 2
    assert data(vienna(2026, 12, 24, 18)) == {"today_door": 24, "catch_up": False, "door_hour": 6}
    assert data(vienna(2026, 12, 25, 0, 0, 1))["catch_up"] is True and data(vienna(2027, 1, 6, 12)) == {"today_door": 24, "catch_up": True, "door_hour": 6}


def test_anordnung_und_saat_sind_je_jahr_fest_und_jedes_jahr_anders():
    assert sorted(advent.door_order(2026)) == list(range(1, 25))
    assert advent.door_order(2026) == advent.door_order(2026) and advent.door_order(2026) != advent.door_order(2027)
    assert advent.door_order(2026) != list(range(1, 25))
    seeds = {advent.door_seed(2026, day) for day in advent.DOOR_DAYS}
    assert len(seeds) == 24 and advent.door_seed(2026, 7) == advent.door_seed(2026, 7) != advent.door_seed(2027, 7)


def test_adressen_von_video_und_clip():
    for good in ("https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3", "youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"):
        assert advent.youtube_id(good) == "dQw4w9WgXcQ", good
    for bad in ("", "https://example.com/watch?v=dQw4w9WgXcQ", "https://youtube.com.evil.at/watch?v=dQw4w9WgXcQ", "https://youtu.be/kurz", "javascript:alert(1)"):
        assert advent.youtube_id(bad) == "", bad
    assert advent.clip_id("https://clips.twitch.tv/FunnyClip-abc_123") == "FunnyClip-abc_123"
    assert advent.clip_id("https://www.twitch.tv/the_lion_squad/clip/GoodOne-xyz?filter=clips") == "GoodOne-xyz"
    for bad in ("", "https://clips.twitch.tv/", "https://clips.twitch.tv.evil.at/abc", "https://www.twitch.tv/the_lion_squad", "https://example.com/clip/abcd"):
        assert advent.clip_id(bad) == "", bad


# ------------------------------------------------------------------ Kalender und Öffnen

@pytest.mark.asyncio
async def test_kalender_nur_in_der_zeit_und_nur_mit_angelegten_tuerchen(flow, monkeypatch):
    staff = await flow.add_staff("Redaktion")
    set_clock(monkeypatch, vienna(2026, 11, 30, 23, 59))
    await save(flow, staff, 1)
    flow.act_as(None)
    before = await flow.get("/api/seasonal/advent")
    assert before.json() == {"active": False, "next_start": "2026-12-01T00:00:00+01:00"}
    assert before.headers["cache-control"] == "private, no-store"
    assert (await flow.post("/api/seasonal/advent/1/open")).status_code == 404

    # Ab Mitternacht steht der Kalender da - das erste Türchen geht um 6 Uhr auf.
    set_clock(monkeypatch, vienna(2026, 12, 1, 0, 0, 1))
    early = (await flow.get("/api/seasonal/advent")).json()
    assert early["active"] is True and early["year"] == 2026 and early["newest_door"] is None and early["door_hour"] == 6
    assert {door["state"] for door in early["doors"]} == {"locked"}
    res = await flow.post("/api/seasonal/advent/1/open")
    assert res.status_code == 409 and res.json()["detail"] == "Dieses Türchen öffnet sich am 1. Dezember um 6 Uhr."

    # Ein Jahr ohne ein einziges Türchen zeigt keinen leeren Kalender.
    set_clock(monkeypatch, vienna(2027, 12, 5, 10))
    assert (await flow.get("/api/seasonal/advent")).json() == {"active": False, "next_start": "2027-12-01T00:00:00+01:00", "reason": "empty"}
    assert (await flow.post("/api/seasonal/advent/1/open")).status_code == 404

    # Ausgeschaltet in der Verwaltung: kein Kalender.
    set_clock(monkeypatch, vienna(2026, 12, 5, 10))
    assert (await flow.get("/api/seasonal/advent")).json()["active"] is True
    await flow.db.settings.insert_one({"id": "seasons", "seasons": {"advent_calendar": {"enabled": False}}})
    assert (await flow.get("/api/seasonal/advent")).json()["active"] is False
    assert (await flow.post("/api/seasonal/advent/1/open")).status_code == 404


@pytest.mark.asyncio
async def test_oeffnen_zaehlt_einmal_und_vorher_verraet_der_kalender_nichts(flow, monkeypatch):
    staff = await flow.add_staff("Redaktion")
    user = await flow.add_user(name="Paula")
    await save(flow, staff, 1, title="Erster Gruß", body="Willkommen im Advent", link_url="/news", link_label="Zu den News")
    await save(flow, staff, 2, kind="quiz", title="Kranz-Quiz", body="", quiz=QUIZ)
    await save(flow, staff, 5, kind="video", title="Überraschungsvideo", body="Film ab", video_url="https://youtu.be/dQw4w9WgXcQ")
    set_clock(monkeypatch, vienna(2026, 12, 2, 10))

    flow.act_as(user)
    res = await flow.get("/api/seasonal/advent")
    view = res.json()
    assert view["active"] and view["signed_in"] is True and view["opened"] == 0 and view["total"] == 24 and view["newest_door"] == 2 and view["catch_up"] is False
    assert view["order"] == advent.door_order(2026) and view["ends_at"] == "2027-01-06T23:59:59+01:00"
    states = {door["day"]: door["state"] for door in view["doors"]}
    assert states[1] == "available" and states[2] == "available" and all(states[day] == "locked" for day in range(3, 25))
    assert all(set(door) == {"day", "opens_at", "seed", "state"} for door in view["doors"]), "ungeöffnet: weder Titel noch Art"
    for secret in ("Erster Gruß", "Kranz-Quiz", "Überraschungsvideo", "Film ab", "quiz", "video"):
        assert secret not in res.text, secret

    first = (await flow.post("/api/seasonal/advent/1/open")).json()
    assert first["counted"] is True and first["first"] is True and first["opened"] == 1 and first["total"] == 24 and first["state"] == "opened"
    assert first["content"] == {"kind": "text", "title": "Erster Gruß", "body": "Willkommen im Advent", "media_url": None, "link": {"url": "/news", "label": "Zu den News"}}
    again = (await flow.post("/api/seasonal/advent/1/open")).json()
    assert again["first"] is False and again["opened"] == 1 and again["opened_at"] == first["opened_at"]
    assert await flow.db.advent_openings.count_documents({"user_id": user["id"]}) == 1
    signal = await flow.db.user_signals.find_one({"user_id": user["id"], "name": "advent_door"}, {"_id": 0})
    assert signal["count"] == 1 and signal["days"] == {"2026-12-02": 1}

    locked = await flow.post("/api/seasonal/advent/5/open")
    assert locked.status_code == 409 and locked.json()["detail"] == "Dieses Türchen öffnet sich am 5. Dezember um 6 Uhr."
    assert "Überraschungsvideo" not in locked.text
    for missing in (0, 25, 99):
        assert (await flow.post(f"/api/seasonal/advent/{missing}/open")).status_code == 404

    view = (await flow.get("/api/seasonal/advent")).json()
    door = next(item for item in view["doors"] if item["day"] == 1)
    assert view["opened"] == 1 and door["state"] == "opened" and door["content"]["title"] == "Erster Gruß" and door["opened_at"] == first["opened_at"]

    # Gäste sehen den Inhalt, gezählt wird nichts. Was ihr Browser als geöffnet nennt, kommt nur, wenn es offen sein darf.
    flow.act_as(None)
    guest = (await flow.post("/api/seasonal/advent/1/open")).json()
    assert guest["counted"] is False and guest["first"] is False and guest["opened"] is None and guest["content"]["title"] == "Erster Gruß"
    assert await flow.db.advent_openings.count_documents({}) == 1
    res = await flow.get("/api/seasonal/advent?opened=1,5,abc,77")
    shown = {door["day"]: door for door in res.json()["doors"]}
    assert res.json()["signed_in"] is False and res.json()["opened"] == 1
    assert shown[1]["state"] == "opened" and shown[1]["content"]["title"] == "Erster Gruß"
    assert shown[5]["state"] == "locked" and "content" not in shown[5] and "Überraschungsvideo" not in res.text
    assert shown[2]["state"] == "available" and "content" not in shown[2]

    # Ein Tag ohne Eintrag grüßt - der Kalender bleibt ganz.
    set_clock(monkeypatch, vienna(2026, 12, 3, 6))
    empty = (await flow.post("/api/seasonal/advent/3/open")).json()
    assert empty["content"] == {"kind": "text", "title": "Türchen 3", "body": advent.DEFAULT_BODY, "media_url": None, "link": None, "fallback": True}


@pytest.mark.asyncio
async def test_quiz_speichert_nie_die_antwort(flow, monkeypatch):
    staff = await flow.add_staff("Redaktion")
    user = await flow.add_user(name="Paula")
    await save(flow, staff, 1)
    await save(flow, staff, 2, kind="quiz", title="Kranz-Quiz", body="Eine Frage zum Advent", quiz=QUIZ)
    set_clock(monkeypatch, vienna(2026, 12, 2, 10))

    flow.act_as(user)
    early = await flow.post("/api/seasonal/advent/2/quiz", json={"answer": 1})
    assert early.status_code == 409 and early.json()["detail"] == "Öffne zuerst das Türchen."
    opened = await flow.post("/api/seasonal/advent/2/open")
    assert opened.json()["content"]["quiz"] == {"question": QUIZ["question"], "answers": QUIZ["answers"], "done": False}
    assert "correct" not in opened.text and "Eine je Adventsonntag" not in opened.text
    listing = await flow.get("/api/seasonal/advent")
    assert "correct" not in listing.text and "Eine je Adventsonntag" not in listing.text

    wrong = (await flow.post("/api/seasonal/advent/2/quiz", json={"answer": 0})).json()
    assert wrong == {"day": 2, "correct": False, "correct_index": 1, "correct_answer": "Vier", "explanation": "Eine je Adventsonntag.", "done": True}
    stored = await flow.db.advent_openings.find_one({"user_id": user["id"], "day": 2}, {"_id": 0})
    assert set(stored) == {"id", "user_id", "year", "day", "opened_at", "quiz_done"} and stored["quiz_done"] is True
    assert (await flow.post("/api/seasonal/advent/2/quiz", json={"answer": 1})).json()["correct"] is True
    assert set(await flow.db.advent_openings.find_one({"user_id": user["id"], "day": 2}, {"_id": 0})) == set(stored)
    assert next(door for door in (await flow.get("/api/seasonal/advent")).json()["doors"] if door["day"] == 2)["content"]["quiz"]["done"] is True
    for broken in (3, -1, "zwei"):
        assert (await flow.post("/api/seasonal/advent/2/quiz", json={"answer": broken})).status_code == 422
    assert (await flow.post("/api/seasonal/advent/1/quiz", json={"answer": 1})).status_code == 404
    assert (await flow.post("/api/seasonal/advent/5/quiz", json={"answer": 1})).status_code == 409

    # Gäste raten mit - gespeichert wird für sie nichts.
    flow.act_as(None)
    before = await flow.db.advent_openings.count_documents({})
    assert (await flow.post("/api/seasonal/advent/2/quiz", json={"answer": 1})).json()["correct"] is True
    assert await flow.db.advent_openings.count_documents({}) == before
    # Nirgends in der Datenbank steht, was geantwortet wurde.
    dump = json.dumps([row async for row in flow.db.advent_openings.find({}, {"_id": 0})])
    assert "answer" not in dump


@pytest.mark.asyncio
async def test_nachholen_bis_dreikoenig_und_alle_tuerchen_heisst_ein_jahr(flow, monkeypatch):
    staff = await flow.add_staff("Redaktion")
    user = await flow.add_user(name="Paula")
    for year in (2026, 2027):
        await save(flow, staff, 1, year=year)

    set_clock(monkeypatch, vienna(2027, 1, 6, 20))
    flow.act_as(user)
    view = (await flow.get("/api/seasonal/advent")).json()
    assert view["year"] == 2026 and view["catch_up"] is True and {door["state"] for door in view["doors"]} == {"available"}
    awarded = 0
    for day in range(1, 25):
        res = (await flow.post(f"/api/seasonal/advent/{day}/open")).json()
        assert res["first"] is True and res["opened"] == day, day
        awarded += res["newly_awarded"]
        if day < 24:
            assert not await flow.db.user_achievements.find_one({"user_id": user["id"], "tier_code": {"$regex": "^advent_all"}}), day
    assert awarded >= 1, "das 24. Türchen bringt den Erfolg sofort"
    assert await flow.db.user_achievements.find_one({"user_id": user["id"], "tier_code": {"$regex": "^advent_all"}})
    assert (await counters.compute(user["id"]))["advent_doors_opened"] == 24
    assert (await flow.db.user_signals.find_one({"user_id": user["id"], "name": "advent_door"}, {"_id": 0}))["days"] == {"2027-01-06": 24}

    set_clock(monkeypatch, vienna(2027, 1, 7, 0, 0, 1))
    assert (await flow.get("/api/seasonal/advent")).json() == {"active": False, "next_start": "2027-12-01T00:00:00+01:00"}
    assert (await flow.post("/api/seasonal/advent/24/open")).status_code == 404

    # Im nächsten Advent zwölf Türchen: der Zähler bleibt beim besten Jahr, er wird nicht über die Jahre addiert.
    set_clock(monkeypatch, vienna(2027, 12, 12, 9))
    for day in range(1, 13):
        assert (await flow.post(f"/api/seasonal/advent/{day}/open")).json()["opened"] == day
    assert (await counters.compute(user["id"]))["advent_doors_opened"] == 24
    other = await flow.add_user(name="Kai")
    flow.act_as(other)
    for day in range(1, 13):
        await flow.post(f"/api/seasonal/advent/{day}/open")
    set_clock(monkeypatch, vienna(2028, 12, 12, 9))
    await save(flow, staff, 1, year=2028)
    flow.act_as(other)
    for day in range(1, 13):
        await flow.post(f"/api/seasonal/advent/{day}/open")
    assert (await counters.compute(other["id"]))["advent_doors_opened"] == 12
    assert not await flow.db.user_achievements.find_one({"user_id": other["id"], "tier_code": {"$regex": "^advent_all"}})


@pytest.mark.asyncio
async def test_ein_client_kann_kein_tuerchen_melden(flow, monkeypatch):
    user = await flow.add_user(name="Schlau")
    set_clock(monkeypatch, vienna(2026, 12, 10, 10))
    flow.act_as(user)
    single = (await flow.post("/api/achievements/signal", json={"name": "advent_door", "count": 24})).json()
    assert single == {"accepted": False, "reason": "unknown"}
    batch = (await flow.post("/api/achievements/signals", json={"items": [{"name": "advent_door", "count": 24}]})).json()
    assert batch["accepted"] == 0 and batch["results"][0]["reason"] == "unknown"
    assert await flow.db.user_signals.count_documents({"user_id": user["id"]}) == 0
    assert (await counters.compute(user["id"]))["advent_doors_opened"] == 0


@pytest.mark.asyncio
async def test_die_aktive_saison_sagt_ob_tuerchen_angelegt_sind(flow, monkeypatch):
    """Web und App zeigen den Einstieg in den Kalender nur, wenn es ihn gibt (``ready``)."""
    staff = await flow.add_staff("Redaktion")
    set_clock(monkeypatch, vienna(2026, 12, 5, 10))
    flow.act_as(None)

    async def calendar():
        res = await flow.get("/api/seasonal/active")
        assert res.status_code == 200
        return next(season for season in res.json()["seasons"] if season["key"] == "advent_calendar"), res.headers["etag"]

    before, tag = await calendar()
    assert before["data"] == {"today_door": 5, "catch_up": False, "door_hour": 6, "ready": False}
    await save(flow, staff, 1, year=2027)
    flow.act_as(None)
    assert (await calendar())[0]["data"]["ready"] is False, "Türchen eines anderen Jahres zählen nicht"
    await save(flow, staff, 1)
    flow.act_as(None)
    after, changed = await calendar()
    assert after["data"] == {"today_door": 5, "catch_up": False, "door_hour": 6, "ready": True}
    assert changed != tag, "die Kennung der Antwort ändert sich mit"
    assert (await flow.get("/api/seasonal/active", headers={"If-None-Match": changed})).status_code == 304


# ------------------------------------------------------------------ Verweise

@pytest.mark.asyncio
async def test_verweise_richten_sich_nach_der_person_die_schaut(flow, monkeypatch):
    staff = await flow.add_staff("Redaktion")
    member = await flow.add_user(name="Mitglied")
    member["is_club_member"] = True
    flow.act_as(staff)
    public_news = (await flow.post("/api/news", json={"title": "Wintercup", "slug": "wintercup", "content": "Text", "excerpt": "Bald geht es los"})).json()
    member_news = (await flow.post("/api/news", json={"title": "Nur für Mitglieder", "slug": "intern-feier", "content": "Text", "visibility": "members"})).json()
    await flow.db.events.insert_one({"id": "e1", "slug": "weihnachtsfeier", "name": "Weihnachtsfeier", "status": "published", "visibility": "public", "start_date": "2026-12-19T18:00:00+01:00", "location": "Vereinsheim"})
    await flow.db.events.insert_one({"id": "e2", "slug": "entwurf", "name": "Geheimes Event", "status": "draft", "visibility": "public"})
    await flow.db.club_member_profiles.insert_one({"id": "p1", "slug": "paula", "display_name": "Paula P.", "gamertag": "Pauli", "role_title": "Kapitänin", "photo_url": "/api/static/uploads/paula.webp", "is_active": True})
    await save(flow, staff, 1, kind="news", title="News des Tages", body="Lies nach", ref_id=public_news["id"])
    await save(flow, staff, 2, kind="news", title="Für uns", body="Nur im Verein", ref_id=member_news["id"])
    await save(flow, staff, 3, kind="event", title="Komm vorbei", body="", ref_id="e1")
    await save(flow, staff, 4, kind="event", title="Bald mehr", body="", ref_id="e2")
    await save(flow, staff, 5, kind="member_spotlight", title="Mitglied der Woche", body="Danke für deinen Einsatz", ref_id="p1", consent_confirmed=True)
    set_clock(monkeypatch, vienna(2026, 12, 6, 10))

    async def content(day, who):
        flow.act_as(who)
        res = await flow.post(f"/api/seasonal/advent/{day}/open")
        assert res.status_code == 200, res.text
        return res.json()["content"], res.text

    card, _ = await content(1, None)
    assert card["kind"] == "news" and card["card"] == {"title": "Wintercup", "excerpt": "Bald geht es los", "image_url": None, "url": "/news/wintercup", "date": public_news["published_at"]}
    hidden, text = await content(2, None)
    assert hidden == {"kind": "text", "title": "Für uns", "body": "Nur im Verein", "media_url": None, "link": None} and "Nur für Mitglieder" not in text and "intern-feier" not in text
    seen, _ = await content(2, member)
    assert seen["kind"] == "news" and seen["card"]["title"] == "Nur für Mitglieder"
    event, _ = await content(3, None)
    assert event["card"] == {"title": "Weihnachtsfeier", "image_url": None, "url": "/events/weihnachtsfeier", "date": "2026-12-19T18:00:00+01:00", "location": "Vereinsheim"}
    draft, text = await content(4, staff)
    assert draft["kind"] == "text" and draft["body"] == advent.DEFAULT_BODY and "Geheimes Event" not in text
    person, _ = await content(5, None)
    assert person["kind"] == "member_spotlight" and person["card"] == {"name": "Pauli", "role": "Kapitänin", "image_url": "/api/static/uploads/paula.webp", "url": "/members/paula"}

    # Das Mitglied ist nicht mehr dabei: das Türchen zeigt nur noch den Text.
    await flow.db.club_member_profiles.update_one({"id": "p1"}, {"$set": {"is_active": False}})
    gone, text = await content(5, None)
    assert gone["kind"] == "text" and "card" not in gone and "Pauli" not in text and "paula" not in text


# ------------------------------------------------------------------ Verwaltung

@pytest.mark.asyncio
async def test_verwaltung_prueft_jede_art_und_nur_die_redaktion_darf(flow):
    staff = await flow.add_staff("Redaktion")
    user = await flow.add_user(name="Paula")
    sticker_id = builtin_catalog()["packs"][0]["stickers"][0]["id"]
    await flow.db.club_member_profiles.insert_one({"id": "p1", "slug": "paula", "display_name": "Paula"})

    for who, status in ((None, 401), (user, 403)):
        flow.act_as(who)
        assert (await flow.get("/api/seasonal/advent/admin/2026")).status_code == status
        assert (await flow.get("/api/seasonal/advent/admin/2026/preview")).status_code == status
        assert (await flow.put("/api/seasonal/advent/admin/2026/1", json={"kind": "text", "title": "x", "body": "y"})).status_code == status
        assert (await flow.delete("/api/seasonal/advent/admin/2026/1")).status_code == status
        assert (await flow.post("/api/seasonal/advent/admin/2027/copy", json={"source_year": 2026})).status_code == status
    assert await flow.db.advent_doors.count_documents({}) == 0

    flow.act_as(staff)
    wrong = [
        ({"kind": "raetsel", "title": "x"}, "Diese Art von Türchen gibt es nicht."),
        ({"kind": "text", "title": "  ", "body": "y"}, "Das Türchen braucht einen Titel."),
        ({"kind": "text", "title": "x", "body": " "}, "Ein Text-Türchen braucht einen Text."),
        ({"kind": "image", "title": "x"}, "Ein Bild-Türchen braucht ein Bild."),
        ({"kind": "image", "title": "x", "media_url": "https://example.com/bild.png"}, "Das Bild muss aus dem eigenen Upload kommen (Medien → Hochladen)."),
        ({"kind": "text", "title": "x", "body": "y", "link_url": "javascript:alert(1)"}, "Der Link muss mit / (eigene Seite) oder https:// beginnen."),
        ({"kind": "text", "title": "x", "body": "y", "link_url": "//example.com"}, "Der Link muss mit / (eigene Seite) oder https:// beginnen."),
        ({"kind": "video", "title": "x", "video_url": "https://vimeo.com/123"}, "Das Video muss eine YouTube-Adresse sein."),
        ({"kind": "clip", "title": "x", "clip_url": "https://www.twitch.tv/the_lion_squad"}, "Der Clip muss eine Adresse von Twitch sein (clips.twitch.tv/… oder twitch.tv/kanal/clip/…)."),
        ({"kind": "news", "title": "x", "ref_id": "gibt-es-nicht"}, "Diesen News-Beitrag gibt es nicht."),
        ({"kind": "event", "title": "x"}, "Dieses Event gibt es nicht."),
        ({"kind": "member_spotlight", "title": "x", "ref_id": "p2", "consent_confirmed": True}, "Dieses Mitglied gibt es nicht."),
        ({"kind": "member_spotlight", "title": "x", "ref_id": "p1"}, "Mitglied der Woche gibt es nur mit Einwilligung: bitte bestätigen, dass das Mitglied einverstanden ist."),
        ({"kind": "sticker", "title": "x", "sticker_id": "gibt-es-nicht"}, "Diesen Sticker gibt es nicht (mehr)."),
        ({"kind": "quiz", "title": "x", "quiz": {"answers": ["a", "b", "c"], "correct": 0}}, "Das Quiz braucht eine Frage."),
        ({"kind": "quiz", "title": "x", "quiz": {"question": "?", "answers": ["a", "b"], "correct": 0}}, "Das Quiz braucht genau drei Antworten."),
        ({"kind": "quiz", "title": "x", "quiz": {"question": "?", "answers": ["a", "A ", "c"], "correct": 0}}, "Die drei Antworten müssen sich unterscheiden."),
        ({"kind": "quiz", "title": "x", "quiz": {"question": "?", "answers": ["a", "b", "c"], "correct": 3}}, "Beim Quiz fehlt, welche Antwort richtig ist."),
        ({"kind": "quiz", "title": "x", "quiz": {"question": "?", "answers": ["a", "b", "c"]}}, "Beim Quiz fehlt, welche Antwort richtig ist."),
    ]
    for payload, message in wrong:
        res = await flow.put("/api/seasonal/advent/admin/2026/1", json=payload)
        assert res.status_code == 400 and res.json()["detail"] == message, (payload, res.text)
    assert (await flow.put("/api/seasonal/advent/admin/2026/25", json={"kind": "text", "title": "x", "body": "y"})).status_code == 404
    assert (await flow.put("/api/seasonal/advent/admin/1999/1", json={"kind": "text", "title": "x", "body": "y"})).status_code == 400
    assert await flow.db.advent_doors.count_documents({}) == 0

    good = [
        (1, {"kind": "image", "title": "Bild", "media_url": "/api/static/uploads/advent-1.webp"}),
        (2, {"kind": "video", "title": "Video", "video_url": "youtube.com/watch?v=dQw4w9WgXcQ"}),
        (3, {"kind": "clip", "title": "Clip", "clip_url": "https://www.twitch.tv/the_lion_squad/clip/GoodOne-xyz"}),
        (4, {"kind": "sticker", "title": "Sticker", "sticker_id": sticker_id}),
        (5, {"kind": "quiz", "title": "Quiz", "quiz": QUIZ}),
        (6, {"kind": "member_spotlight", "title": "Mitglied", "ref_id": "p1", "consent_confirmed": True}),
    ]
    for day, payload in good:
        res = await flow.put(f"/api/seasonal/advent/admin/2026/{day}", json=payload)
        assert res.status_code == 200, (payload, res.text)
    saved = {row["day"]: row async for row in flow.db.advent_doors.find({}, {"_id": 0})}
    assert saved[2]["video_id"] == "dQw4w9WgXcQ" and saved[2]["video_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert saved[3]["clip_id"] == "GoodOne-xyz" and saved[3]["clip_url"] == "https://clips.twitch.tv/GoodOne-xyz"
    assert saved[4]["sticker"]["id"] == sticker_id and saved[4]["sticker"]["url"]
    assert saved[5]["quiz"] == QUIZ and saved[6]["consent_confirmed"] is True and saved[6]["updated_by"] == staff["id"]

    # Überschreiben behält Kennung und Anlagedatum; Löschen macht den Tag wieder leer.
    first = saved[1]
    res = await flow.put("/api/seasonal/advent/admin/2026/1", json={"kind": "text", "title": "Neu\x00 gefasst", "body": "Zeile eins\r\nZeile zwei"})
    assert res.json()["id"] == first["id"] and res.json()["created_at"] == first["created_at"] and res.json()["media_url"] is None
    assert res.json()["title"] == "Neu gefasst" and res.json()["body"] == "Zeile eins\nZeile zwei"
    assert (await flow.delete("/api/seasonal/advent/admin/2026/1")).json() == {"ok": True}
    assert (await flow.delete("/api/seasonal/advent/admin/2026/1")).status_code == 404
    actions = [row["action"] async for row in flow.db.audit_logs.find({"entity_id": "advent:2026"}, {"_id": 0})]
    assert actions.count("advent.door.save") == 7 and actions.count("advent.door.delete") == 1


@pytest.mark.asyncio
async def test_kopieren_zahlen_und_vorschau(flow, monkeypatch):
    staff = await flow.add_staff("Redaktion")
    paula = await flow.add_user(name="Paula")
    kai = await flow.add_user(name="Kai")
    await flow.db.club_member_profiles.insert_one({"id": "p1", "slug": "paula", "display_name": "Paula", "is_active": True})
    await save(flow, staff, 1, title="Gruß")
    await save(flow, staff, 2, kind="quiz", title="Quiz", body="", quiz=QUIZ)
    await save(flow, staff, 3, kind="member_spotlight", title="Mitglied der Woche", body="Danke", ref_id="p1", consent_confirmed=True)
    await save(flow, staff, 2, year=2027, title="Schon da")

    set_clock(monkeypatch, vienna(2026, 12, 1, 9))
    flow.act_as(paula)
    await flow.post("/api/seasonal/advent/1/open")
    set_clock(monkeypatch, vienna(2026, 12, 3, 9))
    await flow.post("/api/seasonal/advent/2/open")
    await flow.post("/api/seasonal/advent/2/quiz", json={"answer": 2})
    flow.act_as(kai)
    await flow.post("/api/seasonal/advent/1/open")
    flow.act_as(None)
    await flow.post("/api/seasonal/advent/1/open")

    flow.act_as(staff)
    res = await flow.get("/api/seasonal/advent/admin/2026")
    view = res.json()
    assert res.headers["cache-control"] == "private, no-store"
    assert view["filled"] == 3 and view["total"] == 24 and view["people"] == 2 and view["running"] is True and view["years"] == [2027, 2026]
    assert [kind["key"] for kind in view["kinds"]] == list(advent.KINDS) and view["starts_at"] == "2026-12-01T00:00:00+01:00"
    doors = {item["day"]: item for item in view["doors"]}
    assert doors[1]["stats"] == {"opened": 2, "same_day": 1, "later": 1, "views": 3, "quiz_done": 0}
    assert doors[2]["stats"] == {"opened": 1, "same_day": 0, "later": 1, "views": 1, "quiz_done": 1}
    assert doors[2]["door"]["quiz"]["correct"] == 1 and doors[1]["problem"] is None and doors[3]["is_open"] is True and doors[4]["is_open"] is False
    assert doors[4]["door"] is None and doors[4]["problem"] == "Noch nichts eingetragen – an diesem Tag grüßt nur der Löwe."
    # Die Zahlen nennen keine Personen.
    assert paula["id"] not in res.text and kai["id"] not in res.text

    copied = (await flow.post("/api/seasonal/advent/admin/2027/copy", json={"source_year": 2026})).json()
    assert copied == {"source": 2026, "target": 2027, "copied": [1, 3], "skipped": [2], "reconfirm": [3]}
    next_year = {item["day"]: item for item in (await flow.get("/api/seasonal/advent/admin/2027")).json()["doors"]}
    assert next_year[1]["door"]["title"] == "Gruß" and next_year[1]["door"]["copied_from"] == 2026 and next_year[1]["stats"]["opened"] == 0
    assert next_year[2]["door"]["title"] == "Schon da"
    assert next_year[3]["door"]["consent_confirmed"] is False and next_year[3]["problem"] == "Die Einwilligung des Mitglieds ist für dieses Jahr noch nicht bestätigt."
    assert (await flow.post("/api/seasonal/advent/admin/2027/copy", json={"source_year": 2027})).status_code == 400
    assert (await flow.post("/api/seasonal/advent/admin/2027/copy", json={"source_year": 2025})).status_code == 404
    # Ohne neue Einwilligung zeigt das kopierte Türchen die Person nicht.
    preview = (await flow.get("/api/seasonal/advent/admin/2027/preview")).json()
    shown = {door["day"]: door for door in preview["doors"]}
    assert shown[3]["content"]["kind"] == "text" and "card" not in shown[3]["content"]
    saved = await flow.put("/api/seasonal/advent/admin/2027/3", json={"kind": "member_spotlight", "title": "Mitglied der Woche", "body": "Danke", "ref_id": "p1", "consent_confirmed": True})
    assert saved.json()["consent_confirmed"] is True and saved.json()["copied_from"] is None

    # Vorschau: ohne Zeitpunkt alles offen, mit Zeitpunkt nur bis dahin - und nichts davon wird gezählt.
    before = (await flow.db.advent_openings.count_documents({}), [row async for row in flow.db.advent_views.find({}, {"_id": 0})])
    preview = (await flow.get("/api/seasonal/advent/admin/2026/preview")).json()
    assert preview["preview"] is True and preview["active"] is True and preview["signed_in"] is False and {door["state"] for door in preview["doors"]} == {"opened"}
    assert {door["day"]: door for door in preview["doors"]}[2]["content"]["quiz"] == {"question": QUIZ["question"], "answers": QUIZ["answers"], "done": False}
    partly = (await flow.get("/api/seasonal/advent/admin/2026/preview", params={"at": "2026-12-02T05:59:00+01:00"})).json()
    assert [door["state"] for door in partly["doors"]][:3] == ["opened", "locked", "locked"] and partly["newest_door"] == 1
    assert (await flow.get("/api/seasonal/advent/admin/2026/preview", params={"at": "irgendwann"})).status_code == 400
    assert (await flow.db.advent_openings.count_documents({}), [row async for row in flow.db.advent_views.find({}, {"_id": 0})]) == before


# ------------------------------------------------------------------ Datenschutz

@pytest.mark.asyncio
async def test_auskunft_nennt_die_tuerchen_und_konto_loeschen_nimmt_sie_mit(flow, monkeypatch):
    staff = await flow.add_staff("Redaktion")
    paula = await flow.add_user(name="Paula")
    kai = await flow.add_user(name="Kai")
    await save(flow, staff, 1)
    set_clock(monkeypatch, vienna(2026, 12, 2, 9))
    for person in (paula, kai):
        flow.act_as(person)
        for day in (1, 2):
            assert (await flow.post(f"/api/seasonal/advent/{day}/open")).status_code == 200
    flow.act_as(paula)
    export = (await flow.get("/api/dsgvo/export-my-data")).json()
    assert sorted((row["year"], row["day"], row["quiz_done"]) for row in export["advent_openings"]) == [(2026, 1, False), (2026, 2, False)]
    assert all(row["user_id"] == paula["id"] for row in export["advent_openings"])
    assert (await flow.post("/api/dsgvo/anonymize-me")).status_code == 200
    assert await flow.db.advent_openings.count_documents({"user_id": paula["id"]}) == 0
    assert await flow.db.advent_openings.count_documents({"user_id": kai["id"]}) == 2
    assert await flow.db.user_signals.count_documents({"user_id": paula["id"]}) == 0
