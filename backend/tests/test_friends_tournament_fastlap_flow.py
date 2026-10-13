"""Freunde auf Turnier- und Fast-Lap-Seiten (#1188 Teil 2, Datenschutz): dieselben Regeln wie auf der Event-Seite -
nur bestätigte Freunde, keine Blockierten, Gesperrten, Deaktivierten oder Gelöschten, die Einstellung „Freunde sehen, wo
ich angemeldet bin“ (unter 14 Standard aus), Teams nach gespeicherter Aufstellung bzw. Beitritt vor dem Turnier, nie
zwischengespeichert. Bei Fast Laps zählt eine gültige Zeit als „angemeldet“. Jede Absage hat ihre Gegenprobe.

Dazu der einmalige Hinweis direkt nach der ersten Anmeldung (``GET /api/users/me/friends-hint``)."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402
from services import event_friends  # noqa: E402
from test_access_link_limits_flow import access_link  # noqa: E402
from test_event_friends_flow import befriend  # noqa: E402

PRIVATE = "private, no-store"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def seed(flow):
    viewer = await flow.add_user(role="player", name="vera")
    friend = await flow.add_user(role="player", name="finn")
    await flow.db.events.insert_one({"id": "e-lan", "slug": "herbst-lan", "name": "Herbst-LAN", "status": "scheduled", "visibility": "public",
                                     "has_registration": True, "start_date": "2099-11-13T16:00:00+00:00"})
    await flow.db.tournaments.insert_many([
        {"id": "t-mk", "slug": "mk", "title": "Mario Kart Cup", "event_id": "e-lan", "status": "registration_open", "visibility": "public", "is_public": True,
         "team_mode": "solo", "start_date": "2099-11-14T10:00:00+00:00"},
        {"id": "t-rl", "slug": "rl", "title": "Rocket League 2v2", "status": "registration_open", "visibility": "public", "is_public": True, "team_mode": "team",
         "start_date": "2099-11-14T15:00:00+00:00"},
        {"id": "t-intern", "slug": "intern", "title": "Vereinsturnier", "status": "registration_open", "visibility": "members", "is_public": True, "team_mode": "solo"},
        {"id": "t-draft", "slug": "geheim", "title": "Geheim", "status": "draft", "visibility": "public", "team_mode": "solo"},
        {"id": "t-off", "slug": "abgesagt", "title": "Abgesagt", "status": "cancelled", "visibility": "public", "is_public": True, "team_mode": "solo"},
    ])
    await flow.db.tournament_registrations.insert_many([
        {"id": new_id(), "tournament_id": tid, "user_id": friend["id"], "display_name": "Finn", "status": "approved"}
        for tid in ("t-mk", "t-intern", "t-draft", "t-off")
    ])
    await flow.db.f1_challenges.insert_many([
        {"id": "c-monza", "slug": "monza", "title": "Monza-Hotlap", "event_id": "e-lan", "status": "active", "visibility": "public"},
        {"id": "c-intern", "slug": "intern-lap", "title": "Vereins-Hotlap", "status": "active", "visibility": "members"},
        {"id": "c-draft", "slug": "lap-entwurf", "title": "Entwurf", "status": "draft", "visibility": "public"},
    ])
    await flow.db.f1_lap_times.insert_many([
        {"id": new_id(), "challenge_id": cid, "user_id": friend["id"], "time_ms": 91234}
        for cid in ("c-monza", "c-intern", "c-draft")
    ])
    return viewer, friend


async def tournament_friends(flow, viewer, key="mk") -> list[dict]:
    flow.act_as(viewer)
    res = await flow.get(f"/api/tournaments/{key}/friends")
    assert res.status_code == 200, res.text
    assert res.headers["cache-control"] == PRIVATE
    return res.json()["friends"]


async def lap_friends(flow, viewer, key="monza") -> list[dict]:
    flow.act_as(viewer)
    res = await flow.get(f"/api/f1/challenges/{key}/friends")
    assert res.status_code == 200, res.text
    assert res.headers["cache-control"] == PRIVATE
    return res.json()["friends"]


async def both(flow, viewer) -> tuple[list[str], list[str]]:
    return ([f["id"] for f in await tournament_friends(flow, viewer)], [f["id"] for f in await lap_friends(flow, viewer)])


@pytest.mark.asyncio
async def test_confirmed_friend_shows_on_tournament_and_fastlap_pages(flow):
    viewer, friend = await seed(flow)
    await befriend(flow, viewer, friend)
    friends = await tournament_friends(flow, viewer)
    assert [f["id"] for f in friends] == [friend["id"]]
    assert friends[0]["where"] == [{"kind": "tournament", "id": "t-mk", "slug": "mk", "title": "Mario Kart Cup", "team_name": None}]
    assert set(friends[0]) == {"id", "display_name", "avatar_url", "username", "where"}, "keine weiteren Profildaten"
    assert friends[0]["username"] is None, "Profil nicht öffentlich: trotzdem sichtbar, nur ohne Link"
    laps = await lap_friends(flow, viewer)
    assert laps[0]["where"] == [{"kind": "fastlap", "id": "c-monza", "slug": "monza", "title": "Monza-Hotlap"}]
    await flow.db.users.update_one({"id": friend["id"]}, {"$set": {"privacy_public_profile": True}})
    assert (await tournament_friends(flow, viewer))[0]["username"] == "finn", "Gegenprobe: öffentliches Profil mit Link"


@pytest.mark.asyncio
async def test_strangers_guests_and_unconfirmed_requests_see_nothing(flow):
    viewer, friend = await seed(flow)
    assert await both(flow, viewer) == ([], []), "Fremde sehen nichts"
    flow.act_as(None)
    assert (await flow.get("/api/tournaments/mk/friends")).status_code == 401
    assert (await flow.get("/api/f1/challenges/monza/friends")).status_code == 401
    assert (await flow.get("/api/users/me/friends-hint")).status_code == 401
    for status in ("pending", "declined", "cancelled", "removed"):
        await befriend(flow, viewer, friend, status=status)
        assert await both(flow, viewer) == ([], []), status
        assert await both(flow, friend) == ([], []), f"{status}: auch nicht in die andere Richtung"
    await befriend(flow, viewer, friend)
    assert await both(flow, viewer) == ([friend["id"]], [friend["id"]]), "Gegenprobe: bestätigt"


@pytest.mark.asyncio
async def test_setting_and_under_14_default(flow):
    viewer, friend = await seed(flow)
    await befriend(flow, viewer, friend)
    flow.act_as(friend)
    assert (await flow.put("/api/users/me", json={"privacy_friends_see_registrations": False})).status_code == 200
    assert await both(flow, viewer) == ([], []), "ausgeschaltet sieht es niemand"
    flow.act_as(friend)
    assert (await flow.put("/api/users/me", json={"privacy_friends_see_registrations": True})).status_code == 200
    assert await both(flow, viewer) == ([friend["id"]], [friend["id"]]), "Gegenprobe: wieder an"

    today = event_friends._today()
    await flow.db.users.update_one({"id": friend["id"]}, {"$set": {"birth_date": f"{today.year - 13}-01-01"}, "$unset": {event_friends.SETTING: ""}})
    assert await both(flow, viewer) == ([], []), "unter 14: Standard aus"
    await flow.db.users.update_one({"id": friend["id"]}, {"$set": {event_friends.SETTING: True}})
    assert await both(flow, viewer) == ([friend["id"]], [friend["id"]]), "selbst eingeschaltet: sichtbar"


@pytest.mark.asyncio
async def test_blocked_banned_inactive_and_deleted_accounts_are_left_out(flow):
    viewer, friend = await seed(flow)
    await befriend(flow, viewer, friend)
    await flow.db.user_blocks.insert_one({"id": new_id(), "blocker_id": viewer["id"], "blocked_id": friend["id"]})
    assert await both(flow, viewer) == ([], []), "blockiert"
    await flow.db.user_blocks.delete_many({})
    assert await both(flow, viewer) == ([friend["id"]], [friend["id"]]), "Gegenprobe ohne Blockierung"
    for change in ({"is_banned": True}, {"is_active": False}, {"anonymized_at": "2026-10-01T00:00:00+00:00"}):
        await flow.db.users.update_one({"id": friend["id"]}, {"$set": change})
        assert await both(flow, viewer) == ([], []), change
        await flow.db.users.update_one({"id": friend["id"]}, {"$set": {"is_banned": False, "is_active": True}, "$unset": {"anonymized_at": ""}})
    assert await both(flow, viewer) == ([friend["id"]], [friend["id"]])


@pytest.mark.asyncio
async def test_team_counts_the_saved_lineup_or_who_joined_before_the_tournament(flow):
    viewer, friend = await seed(flow)
    await befriend(flow, viewer, friend)
    await flow.db.teams.insert_one({"id": "team-rocket", "name": "Lions Rocket", "member_ids": ["leader-x", friend["id"]]})
    await flow.db.tournament_registrations.insert_one({"id": "r-rocket", "tournament_id": "t-rl", "user_id": "leader-x", "team_id": "team-rocket",
                                                       "display_name": "Lions Rocket", "status": "approved"})
    assert await tournament_friends(flow, viewer, "rl") == [], "nur im heutigen Team, ohne Beitrittsdatum"
    await flow.db.team_members.insert_one({"team_id": "team-rocket", "user_id": friend["id"], "joined_at": "2099-12-01T10:00:00+00:00"})
    assert await tournament_friends(flow, viewer, "rl") == [], "erst nach dem Turnier beigetreten"
    await flow.db.team_members.update_one({"team_id": "team-rocket"}, {"$set": {"joined_at": "2026-01-10T10:00:00+00:00"}})
    friends = await tournament_friends(flow, viewer, "rl")
    assert friends[0]["where"][0]["team_name"] == "Lions Rocket", "Gegenprobe: vor dem Turnier beigetreten, mit Teamname"
    await flow.db.tournament_registrations.update_one({"id": "r-rocket"}, {"$set": {"lineup": ["leader-x"], "substitutes": []}})
    assert await tournament_friends(flow, viewer, "rl") == [], "gespeicherte Aufstellung ohne Finn"
    await flow.db.tournament_registrations.update_one({"id": "r-rocket"}, {"$set": {"substitutes": [friend["id"]]}})
    assert [f["id"] for f in await tournament_friends(flow, viewer, "rl")] == [friend["id"]], "Gegenprobe: als Ersatz gespeichert"


@pytest.mark.asyncio
async def test_only_valid_registrations_and_times_count(flow):
    viewer, friend = await seed(flow)
    await befriend(flow, viewer, friend)
    await flow.db.tournament_registrations.update_many({"tournament_id": "t-mk"}, {"$set": {"status": "waitlist"}})
    await flow.db.f1_lap_times.update_many({"challenge_id": "c-monza"}, {"$set": {"is_invalid": True}})
    assert await both(flow, viewer) == ([], []), "Warteliste bzw. ungültige Zeit"
    await flow.db.tournament_registrations.update_many({"tournament_id": "t-mk"}, {"$set": {"status": "cancelled"}})
    await flow.db.f1_lap_times.update_many({"challenge_id": "c-monza"}, {"$set": {"is_invalid": False, "score_scope": "club_reference"}})
    assert await both(flow, viewer) == ([], []), "Storno bzw. Vereins-Referenzzeit"
    await flow.db.tournament_registrations.update_many({"tournament_id": "t-mk"}, {"$set": {"status": "checked_in"}})
    await flow.db.f1_lap_times.update_many({"challenge_id": "c-monza"}, {"$unset": {"score_scope": ""}})
    assert await both(flow, viewer) == ([friend["id"]], [friend["id"]]), "Gegenprobe: eingecheckt bzw. gültige Zeit"


@pytest.mark.asyncio
async def test_hidden_pages_give_no_names(flow):
    viewer, friend = await seed(flow)
    await befriend(flow, viewer, friend)
    flow.act_as(viewer)
    for url, status in (("/api/tournaments/intern/friends", 403), ("/api/tournaments/geheim/friends", 404),
                        ("/api/f1/challenges/intern-lap/friends", 403), ("/api/f1/challenges/lap-entwurf/friends", 404),
                        ("/api/tournaments/gibts-nicht/friends", 404)):
        res = await flow.get(url)
        assert res.status_code == status and "Finn" not in res.text and res.headers["cache-control"] == PRIVATE, url
    assert await tournament_friends(flow, viewer, "abgesagt") == [], "abgesagtes Turnier: keine Freunde"
    # Gegenprobe: die Turnierleitung sieht „Nur Mitglieder“ - und dort den Freund.
    lead = await flow.add_staff("Leitung")
    await befriend(flow, lead, friend)
    assert [f["id"] for f in await tournament_friends(flow, lead, "intern")] == [friend["id"]]
    assert [f["id"] for f in await lap_friends(flow, lead, "intern-lap")] == [friend["id"]]
    assert await lap_friends(flow, lead, "lap-entwurf") == [], "Entwurf: auch für die Leitung keine Freunde"


@pytest.mark.asyncio
async def test_event_page_counts_a_valid_fast_lap_time(flow):
    viewer, friend = await seed(flow)
    await befriend(flow, viewer, friend)
    await flow.db.tournament_registrations.delete_many({})
    flow.act_as(viewer)
    friends = (await flow.get("/api/events/herbst-lan/friends")).json()["friends"]
    assert friends[0]["where"] == [{"kind": "fastlap", "id": "c-monza", "slug": "monza", "title": "Monza-Hotlap"}]
    await flow.db.f1_lap_times.update_many({}, {"$set": {"is_invalid": True}})
    assert (await flow.get("/api/events/herbst-lan/friends")).json()["friends"] == [], "Gegenprobe: ungültige Zeit zählt nicht"


@pytest.mark.asyncio
async def test_hint_is_due_right_after_the_first_registration(flow):
    viewer, friend = await seed(flow)
    flow.act_as(viewer)

    async def due():
        res = await flow.get("/api/users/me/friends-hint")
        assert res.status_code == 200 and res.headers["cache-control"] == PRIVATE
        return res.json()["due"]

    assert await due() is False, "noch nirgends angemeldet"
    await flow.db.tournament_registrations.insert_one({"id": "r-v", "tournament_id": "t-mk", "user_id": viewer["id"], "status": "pending"})
    assert await due() is False, "offene Anmeldung sehen Freunde nicht"
    await flow.db.tournament_registrations.update_one({"id": "r-v"}, {"$set": {"status": "approved"}})
    assert await due() is True, "erste Turnier-Anmeldung: Hinweis fällig"
    assert (await flow.get("/api/tournaments/mk/friends")).json()["hint"] is True, "auch auf der Turnierseite"
    assert (await flow.get("/api/f1/challenges/monza/friends")).json()["hint"] is False, "ohne eigene Zeit nicht auf der Fast-Lap-Seite"
    assert (await flow.post("/api/users/me/friends-hint", json={})).json() == {"sharing": True}
    assert await due() is False, "genau einmal"
    assert (await flow.get("/api/tournaments/mk/friends")).json()["hint"] is False

    # Event-Anmeldung und Aufstellung zählen ebenso; ausgeschaltet ist nie etwas fällig.
    await flow.db.users.update_one({"id": viewer["id"]}, {"$unset": {event_friends.HINT_FIELD: ""}})
    await flow.db.tournament_registrations.delete_many({"id": "r-v"})
    await flow.db.event_registrations.insert_one({"id": new_id(), "event_id": "e-lan", "user_id": viewer["id"], "status": "waitlist"})
    assert await due() is False, "Warteliste"
    await flow.db.event_registrations.update_many({"user_id": viewer["id"]}, {"$set": {"status": "registered"}})
    assert await due() is True, "Event-Anmeldung"
    await flow.db.event_registrations.delete_many({"user_id": viewer["id"]})
    await flow.db.tournament_registrations.insert_one({"id": "r-team", "tournament_id": "t-rl", "user_id": "leader-x", "team_id": "team-x",
                                                       "lineup": ["leader-x"], "substitutes": [viewer["id"]], "status": "approved"})
    assert await due() is True, "in der gespeicherten Aufstellung"
    res = await flow.post("/api/users/me/friends-hint", json={"turn_off": True})
    assert res.json() == {"sharing": False}
    await flow.db.users.update_one({"id": viewer["id"]}, {"$unset": {event_friends.HINT_FIELD: ""}})
    assert await due() is False, "ausgeschaltet"
    await flow.db.users.update_one({"id": viewer["id"]}, {"$set": {event_friends.SETTING: True}})
    await flow.db.f1_lap_times.insert_one({"id": new_id(), "challenge_id": "c-monza", "user_id": viewer["id"], "time_ms": 92000})
    assert (await flow.get("/api/f1/challenges/monza/friends")).json()["hint"] is True, "eigene gültige Zeit: Hinweis auf der Fast-Lap-Seite"


@pytest.mark.asyncio
async def test_hint_never_due_for_under_14_without_own_choice(flow):
    viewer, _friend = await seed(flow)
    today = event_friends._today()
    await flow.db.users.update_one({"id": viewer["id"]}, {"$set": {"birth_date": f"{today.year - 12}-05-05"}})
    await flow.db.event_registrations.insert_one({"id": new_id(), "event_id": "e-lan", "user_id": viewer["id"], "status": "registered"})
    flow.act_as(viewer)
    assert (await flow.get("/api/users/me/friends-hint")).json() == {"due": False, "sharing": False}
    await flow.db.users.update_one({"id": viewer["id"]}, {"$set": {event_friends.SETTING: True}})
    assert (await flow.get("/api/users/me/friends-hint")).json() == {"due": True, "sharing": True}, "Gegenprobe: selbst eingeschaltet"


@pytest.mark.asyncio
async def test_refusals_before_the_handler_are_private_too(flow):
    """Codex-Prüfung #1500: auch die 401 ohne Konto (vor dem Handler) und Absagen der Seiten-Wächter tragen
    „private, no-store“. Gegenprobe: der Rückblick ohne Konto bleibt beim gewöhnlichen „no-store“."""
    await seed(flow)
    flow.act_as(None)
    for url in ("/api/events/herbst-lan/friends", "/api/tournaments/mk/friends", "/api/f1/challenges/monza/friends", "/api/users/me/friends-hint"):
        res = await flow.get(url)
        assert res.status_code == 401 and res.headers["cache-control"] == PRIVATE, url
    viewer = await flow.add_user(role="player", name="gustav")
    flow.act_as(viewer)
    for url, status in (("/api/tournaments/gibts-nicht/friends", 404), ("/api/f1/challenges/intern-lap/friends", 403)):
        res = await flow.get(url)
        assert res.status_code == status and res.headers["cache-control"] == PRIVATE, url
    flow.act_as(None)
    assert (await flow.get("/api/events/herbst-lan/recap")).headers["cache-control"] == "no-store"
    assert (await flow.get("/api/tournaments/mk")).headers["cache-control"] == "no-store"


@pytest.mark.asyncio
async def test_access_link_opens_the_friends_row_like_the_page(flow):
    """Codex-Prüfung #1500 (2): mit gültigem Zugangslink lädt die Seite das private Turnier bzw. die private Fast Lap -
    die Freunde-Abfrage nimmt denselben Link und prüft ihn wie die Seite. Gegenproben: ohne Link, mit falschem Link und
    mit dem Link eines anderen Ziels bleibt es bei 403 ohne Namen."""
    viewer, friend = await seed(flow)
    await befriend(flow, viewer, friend)
    await flow.db.events.update_one({"id": "e-lan"}, {"$set": {"visibility": "members"}})
    t_token, _ = await access_link(flow, "tournament", "t-intern", max_uses=None)
    c_token, _ = await access_link(flow, "fastlap", "c-intern", max_uses=None)
    e_token, _ = await access_link(flow, "event", "e-lan", max_uses=None)
    flow.act_as(viewer)
    for url, token in (("/api/tournaments/intern/friends", t_token), ("/api/f1/challenges/intern-lap/friends", c_token),
                       ("/api/events/herbst-lan/friends", e_token)):
        assert (await flow.get(url)).status_code == 403, url
        refused = await flow.get(url, params={"access": "falsch"})
        assert refused.status_code == 403 and "Finn" not in refused.text, url
        res = await flow.get(url, params={"access": token})
        assert res.status_code == 200 and res.headers["cache-control"] == PRIVATE, (url, res.text)
        assert [f["id"] for f in res.json()["friends"]] == [friend["id"]], url
    assert (await flow.get("/api/tournaments/intern/friends", params={"access": c_token})).status_code == 403, "Link eines anderen Ziels"
