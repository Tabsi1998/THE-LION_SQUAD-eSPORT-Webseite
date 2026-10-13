"""Rückblick nach dem Event (#1187): vorher nie, danach Sieger, Zahlen und Bericht - nur aus veröffentlichten Ergebnissen
und nur, was die Person auf der Event-Seite sähe. „Du warst dabei“ bekommt nur, wer wirklich dabei war."""
import pathlib
import sys
from datetime import datetime, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402
from services import event_recap  # noqa: E402

PAST = {"start_date": "2026-06-20T08:00:00+00:00", "end_date": "2026-06-21T18:00:00+00:00"}
FUTURE = {"start_date": "2099-06-20T08:00:00+00:00", "end_date": "2099-06-21T18:00:00+00:00"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def _duel(match_id: str, tournament_id: str, first: str, second: str, *, status: str = "completed", round_: int = 1) -> dict:
    return {
        "id": match_id, "tournament_id": tournament_id, "stage_id": f"stage-{tournament_id}", "stage_number": 1, "round": round_,
        "match_type": "duel", "status": status,
        "slots": [{"slot": 1, "registration_id": first, "status": "filled"}, {"slot": 2, "registration_id": second, "status": "filled"}],
        "results": [{"registration_id": first, "rank": 1, "score": 3}, {"registration_id": second, "rank": 2, "score": 1}] if status == "completed" else [],
    }


async def seed(flow, *, dates=PAST, status="scheduled"):
    """Ein Event mit einem fertigen Einzel-Turnier, einem fertigen Team-Turnier, einem laufenden, einem Entwurf, einem
    nur für Mitglieder und einer Fast Lap; dazu Anmeldungen, Fotos und News."""
    lena = await flow.add_user(role="player", name="lena")
    noah = await flow.add_user(role="player", name="noah")
    mia = await flow.add_user(role="player", name="mia")
    await flow.db.events.insert_one({"id": "e-lan", "slug": "sommer-lan", "name": "Sommer-LAN", "status": status, "visibility": "public",
                                     "has_registration": True, **dates})
    await flow.db.event_registrations.insert_many([
        {"id": new_id(), "event_id": "e-lan", "user_id": lena["id"], "status": "checked_in"},
        {"id": new_id(), "event_id": "e-lan", "user_id": mia["id"], "status": "waitlist"},
    ])
    # Team ohne gespeicherte Aufstellung: es zählt, wer vor dem Turniertag beigetreten ist (team_members.joined_at).
    await flow.db.teams.insert_one({"id": "team-rocket", "name": "Lions Rocket", "member_ids": [noah["id"], mia["id"]]})
    await flow.db.team_members.insert_many([
        {"team_id": "team-rocket", "user_id": noah["id"], "joined_at": "2026-01-10T10:00:00+00:00"},
        {"team_id": "team-rocket", "user_id": mia["id"], "joined_at": "2026-06-01T10:00:00+00:00"},
    ])
    await flow.db.tournaments.insert_many([
        {"id": "t-mk", "slug": "mk", "title": "Mario Kart Cup", "event_id": "e-lan", "status": "results_published", "visibility": "public",
         "is_public": True, "format": "single_elim", "team_mode": "solo", "start_date": "2026-06-20T10:00:00+00:00"},
        {"id": "t-rl", "slug": "rl", "title": "Rocket League 2v2", "event_id": "e-lan", "status": "completed", "visibility": "public",
         "is_public": True, "format": "single_elim", "team_mode": "team", "start_date": "2026-06-20T12:00:00+00:00"},
        {"id": "t-live", "slug": "fc", "title": "FC Cup", "event_id": "e-lan", "status": "live", "visibility": "public",
         "is_public": True, "format": "single_elim", "team_mode": "solo"},
        {"id": "t-draft", "slug": "geheim", "title": "Geheimes Turnier", "event_id": "e-lan", "status": "draft", "visibility": "public",
         "format": "single_elim", "team_mode": "solo"},
        {"id": "t-members", "slug": "intern", "title": "Vereinsturnier", "event_id": "e-lan", "status": "completed", "visibility": "members",
         "is_public": True, "format": "single_elim", "team_mode": "solo"},
    ])
    await flow.db.tournament_stages.insert_many([
        {"id": f"stage-{tid}", "tournament_id": tid, "number": 1, "stage_type": "single_elimination"} for tid in ("t-mk", "t-rl", "t-live", "t-members")
    ])
    await flow.db.tournament_registrations.insert_many([
        {"id": "r-lena", "tournament_id": "t-mk", "user_id": lena["id"], "display_name": "Lena", "status": "checked_in"},
        {"id": "r-gast", "tournament_id": "t-mk", "user_id": "fremd-1", "display_name": "Gast Eins", "status": "approved"},
        {"id": "r-rocket", "tournament_id": "t-rl", "user_id": noah["id"], "team_id": "team-rocket", "display_name": "Lions Rocket", "status": "approved"},
        {"id": "r-other", "tournament_id": "t-rl", "user_id": "fremd-2", "team_id": "team-x", "display_name": "Team X", "status": "approved"},
        {"id": "r-live-a", "tournament_id": "t-live", "user_id": "fremd-3", "display_name": "Live A", "status": "approved"},
        {"id": "r-live-b", "tournament_id": "t-live", "user_id": "fremd-4", "display_name": "Live B", "status": "approved"},
        {"id": "r-int-a", "tournament_id": "t-members", "user_id": "fremd-5", "display_name": "Intern A", "status": "approved"},
        {"id": "r-int-b", "tournament_id": "t-members", "user_id": "fremd-6", "display_name": "Intern B", "status": "approved"},
    ])
    await flow.db.matches_v2.insert_many([
        _duel("m-mk", "t-mk", "r-gast", "r-lena"),
        _duel("m-rl", "t-rl", "r-rocket", "r-other"),
        _duel("m-live", "t-live", "r-live-a", "r-live-b"),
        _duel("m-live-2", "t-live", "r-live-a", "r-live-b", status="pending", round_=2),
        _duel("m-int", "t-members", "r-int-a", "r-int-b"),
    ])
    await flow.db.f1_challenges.insert_one({"id": "f-spa", "slug": "spa", "title": "Fast Lap Spa", "event_id": "e-lan", "status": "completed", "visibility": "public"})
    await flow.db.f1_tracks.insert_one({"id": "trk-spa", "challenge_id": "f-spa", "name": "Spa", "order_index": 0})
    await flow.db.f1_lap_times.insert_many([
        {"id": new_id(), "challenge_id": "f-spa", "track_id": "trk-spa", "user_id": lena["id"], "time_ms": 91234},
        {"id": new_id(), "challenge_id": "f-spa", "track_id": "trk-spa", "user_id": noah["id"], "time_ms": 90100, "penalty_seconds": 2},
        {"id": new_id(), "challenge_id": "f-spa", "track_id": "trk-spa", "user_id": "fremd-7", "time_ms": 80000, "is_invalid": True},
    ])
    await flow.db.users.insert_one({"id": "fremd-7", "username": "schummler", "display_name": "Schummler", "is_active": True})
    await flow.db.gallery_albums.insert_many([
        {"id": "a-1", "event_id": "e-lan", "published": True, "visibility": "public", "slug": "fotos"},
        {"id": "a-2", "event_id": "e-lan", "published": False, "visibility": "public", "slug": "entwurf"},
    ])
    await flow.db.gallery_photos.insert_many([{"id": f"p-{n}", "album_id": "a-1"} for n in range(3)] + [{"id": "p-x", "album_id": "a-2"}])
    await flow.db.news_posts.insert_many([
        {"id": "n-recap", "slug": "rueckblick-sommer-lan", "title": "Rückblick: Sommer-LAN", "linked_event_ids": ["e-lan"], "category": "recap",
         "published": True, "visibility": "public", "published_at": "2026-06-25T10:00:00+00:00"},
        {"id": "n-draft", "slug": "entwurf", "title": "Entwurf", "linked_event_ids": ["e-lan"], "category": "recap", "published": False, "visibility": "public"},
    ])
    return lena, noah, mia


@pytest.mark.asyncio
async def test_before_the_end_there_is_no_recap(flow):
    await seed(flow, dates=FUTURE)
    flow.act_as(None)
    res = await flow.get("/api/events/sommer-lan/recap")
    assert res.status_code == 200
    assert res.json() == {"available": False, "reason": "not_over"}, "vorher nie - auch nicht mit fertigen Turnieren"


@pytest.mark.asyncio
async def test_cancelled_event_gets_no_recap(flow):
    await seed(flow, status="cancelled")
    assert (await flow.get("/api/events/sommer-lan/recap")).json() == {"available": False, "reason": "cancelled"}


@pytest.mark.asyncio
async def test_recap_counts_only_published_results_and_what_guests_may_see(flow):
    await seed(flow)
    flow.act_as(None)
    res = await flow.get("/api/events/sommer-lan/recap")
    assert res.status_code == 200, res.text
    assert res.headers["cache-control"] == "no-store"
    recap = res.json()
    assert recap["available"] is True and recap["mine"] is None
    assert [w["id"] for w in recap["winners"]] == ["t-mk", "t-rl"], "laufend, Entwurf und „Nur Mitglieder“ fehlen"
    assert recap["winners"][0]["podium"][0] == {"rank": 1, "name": "Gast Eins", "team": False, "detail": "1 Sieg, 3 Punkte"}
    assert recap["winners"][1]["team"] is True and recap["winners"][1]["podium"][0]["name"] == "Lions Rocket"
    assert recap["fastlaps"][0]["podium"] == [
        {"rank": 1, "name": "lena", "time_ms": 91234, "detail": "1:31.234"},
        {"rank": 2, "name": "noah", "time_ms": 92100, "detail": "1:32.100"},
    ], "Strafsekunden zählen, ungültige Zeiten nicht"
    # Teilnehmer: Lena (Event + Turnier + Fast Lap), Gast Eins, Lions Rocket (Noah, Mia), Team X (fremd-2) - nicht die
    # Warteliste allein, nicht das laufende und nicht das versteckte Turnier.
    assert recap["numbers"] == {"participants": 5, "matches": 2, "tournaments": 2, "fastlaps": 1, "photos": 3}
    assert recap["report"]["slug"] == "rueckblick-sommer-lan"
    assert "Live A" not in res.text and "Intern A" not in res.text and "Geheimes Turnier" not in res.text


@pytest.mark.asyncio
async def test_members_see_members_only_results(flow):
    await seed(flow)
    lead = await flow.add_staff()
    flow.act_as(lead)
    recap = (await flow.get("/api/events/sommer-lan/recap")).json()
    assert "t-members" in [w["id"] for w in recap["winners"]]
    assert "t-live" not in [w["id"] for w in recap["winners"]] and "t-draft" not in [w["id"] for w in recap["winners"]]


@pytest.mark.asyncio
async def test_you_were_there_only_for_participants(flow):
    lena, noah, mia = await seed(flow)
    flow.act_as(lena)
    res = await flow.get("/api/events/sommer-lan/recap")
    assert res.headers["cache-control"] == "private, no-store", "persönliche Antwort bleibt in keinem Zwischenspeicher"
    mine = res.json()["mine"]
    assert mine["was_there"] is True
    by_id = {row["id"]: row for row in mine["results"]}
    assert by_id["t-mk"]["rank"] == 2 and by_id["t-mk"]["of"] == 2 and by_id["t-mk"]["team_name"] is None
    assert by_id["f-spa"]["best_lap"] == "1:31.234" and by_id["f-spa"]["rank"] == 1

    flow.act_as(noah)
    mine = (await flow.get("/api/events/sommer-lan/recap")).json()["mine"]
    assert {row["id"]: row.get("team_name") for row in mine["results"]}["t-rl"] == "Lions Rocket", "mit dem eigenen Team"

    flow.act_as(mia)
    mine = (await flow.get("/api/events/sommer-lan/recap")).json()["mine"]
    assert mine["was_there"] is True and [row["id"] for row in mine["results"]] == ["t-rl"], "im Team gespielt - Warteliste allein zählt nicht"

    stranger = await flow.add_user(role="player", name="fremd")
    await flow.db.event_registrations.insert_one({"id": new_id(), "event_id": "e-lan", "user_id": stranger["id"], "status": "no_show"})
    flow.act_as(stranger)
    assert (await flow.get("/api/events/sommer-lan/recap")).json()["mine"] is None, "nicht erschienen ist nicht dabei"


@pytest.mark.asyncio
async def test_team_counts_who_was_in_it_then_not_today(flow):
    """Codex-Prüfung: wer einem Team erst nach dem Event beitritt, war nicht dabei - weder „Du warst dabei“ noch Zahl."""
    lena, noah, mia = await seed(flow)
    late = await flow.add_user(role="player", name="lars")
    await flow.db.teams.update_one({"id": "team-rocket"}, {"$push": {"member_ids": late["id"]}})
    await flow.db.team_members.insert_one({"team_id": "team-rocket", "user_id": late["id"], "joined_at": "2026-08-01T10:00:00+00:00"})
    flow.act_as(late)
    recap = (await flow.get("/api/events/sommer-lan/recap")).json()
    assert recap["mine"] is None, "erst nach dem Turnier beigetreten"
    assert recap["numbers"]["participants"] == 5, "die Zahl bleibt beim damaligen Team"
    # Ohne Beitrittsdatum zählt niemand aus dem heutigen Team - nur wer angemeldet hat (Kapitän).
    await flow.db.team_members.delete_many({"user_id": late["id"]})
    assert (await flow.get("/api/events/sommer-lan/recap")).json()["mine"] is None, "nur in member_ids: nicht dabei"
    # Gegenprobe: vor dem Turnier beigetreten - dabei.
    await flow.db.team_members.insert_one({"team_id": "team-rocket", "user_id": late["id"], "joined_at": "2026-06-10T10:00:00+00:00"})
    assert [row["id"] for row in (await flow.get("/api/events/sommer-lan/recap")).json()["mine"]["results"]] == ["t-rl"]


@pytest.mark.asyncio
async def test_stored_lineup_decides_for_team_registrations(flow):
    lena, noah, mia = await seed(flow)
    await flow.db.tournament_registrations.update_one({"id": "r-rocket"}, {"$set": {"lineup": [noah["id"]], "substitutes": []}})
    flow.act_as(mia)
    recap = (await flow.get("/api/events/sommer-lan/recap")).json()
    assert recap["mine"] is None, "nicht in der gespeicherten Aufstellung"
    assert recap["numbers"]["participants"] == 4
    # Gegenprobe: als Ersatz gespeichert - dabei.
    await flow.db.tournament_registrations.update_one({"id": "r-rocket"}, {"$set": {"substitutes": [mia["id"]]}})
    assert [row["id"] for row in (await flow.get("/api/events/sommer-lan/recap")).json()["mine"]["results"]] == ["t-rl"]


@pytest.mark.asyncio
@pytest.mark.parametrize("change", [{"is_banned": True}, {"is_active": False}, {"anonymized_at": "2026-09-01T00:00:00+00:00"}])
async def test_names_of_blocked_or_deleted_accounts_are_neutral(flow, change):
    lena, noah, mia = await seed(flow)
    await flow.db.users.update_one({"id": lena["id"]}, {"$set": change})
    flow.act_as(None)
    recap = (await flow.get("/api/events/sommer-lan/recap")).json()
    assert recap["winners"][0]["podium"][1] == {"rank": 2, "name": "Teilnehmer", "team": False, "detail": "1 Punkt"}, "Rang bleibt, Name neutral"
    assert recap["fastlaps"][0]["podium"][0]["name"] == "Teilnehmer" and recap["fastlaps"][0]["podium"][0]["detail"] == "1:31.234"
    assert "Lena" not in str(recap["winners"]) and "lena" not in str(recap["fastlaps"])
    # Gegenprobe: aktives Konto mit Namen.
    await flow.db.users.update_one({"id": lena["id"]}, {"$set": {"is_banned": False, "is_active": True}, "$unset": {"anonymized_at": ""}})
    recap = (await flow.get("/api/events/sommer-lan/recap")).json()
    assert recap["winners"][0]["podium"][1]["name"] == "Lena" and recap["fastlaps"][0]["podium"][0]["name"] == "lena"


@pytest.mark.asyncio
async def test_hidden_events_stay_hidden(flow):
    await seed(flow)
    await flow.db.events.update_one({"id": "e-lan"}, {"$set": {"visibility": "members"}})
    flow.act_as(None)
    assert (await flow.get("/api/events/sommer-lan/recap")).status_code == 403
    await flow.db.events.update_one({"id": "e-lan"}, {"$set": {"visibility": "public", "status": "draft"}})
    assert (await flow.get("/api/events/sommer-lan/recap")).status_code == 404


def test_over_follows_the_vienna_day():
    event = {"status": "scheduled", "start_date": "2026-10-10T08:00:00+00:00", "end_date": "2026-10-10T21:30:00+00:00"}
    # 23:30 Wiener Zeit am letzten Tag: noch nicht vorbei; ab Mitternacht in Wien schon.
    assert event_recap.is_over(event, datetime(2026, 10, 10, 21, 30, tzinfo=timezone.utc)) is False
    assert event_recap.is_over(event, datetime(2026, 10, 10, 22, 5, tzinfo=timezone.utc)) is True
    assert event_recap.is_over({**event, "status": "completed", "end_date": "2099-01-01T00:00:00+00:00"}) is True
    assert event_recap.is_over({**event, "status": "cancelled"}, datetime(2027, 1, 1, tzinfo=timezone.utc)) is False
    multi = {"status": "scheduled", "days": [
        {"date": "2026-10-10", "start_at": "2026-10-10T08:00:00+00:00", "end_at": "2026-10-10T20:00:00+00:00"},
        {"date": "2026-10-11", "start_at": "2026-10-11T08:00:00+00:00", "end_at": "2026-10-11T20:00:00+00:00"},
    ], "start_date": "2026-10-10T08:00:00+00:00"}
    assert event_recap.is_over(multi, datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc)) is False
    assert event_recap.is_over(multi, datetime(2026, 10, 12, 8, 0, tzinfo=timezone.utc)) is True
