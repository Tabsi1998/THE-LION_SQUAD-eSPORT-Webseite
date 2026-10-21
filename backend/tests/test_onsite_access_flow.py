"""Vor-Ort-Zugang (#1592): Begleitpersonen melden sich über den QR-Code auch bei Mitglieder-Turnieren an.

Der Zugang öffnet genau ein Turnier, nur im Zeitfenster des Events und nur, solange die Leitung ihn nicht erneuert oder
abgeschaltet hat. Wer sich darüber anmeldet, ist danach Teilnehmer und sieht sein Turnier - und sonst nichts aus dem
Mitgliederbereich.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402

PASS_COOKIE = "tls_onsite"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    # Token und Freigabe hängen am Server-Geheimnis - wie bei der Anmeldung.
    monkeypatch.setenv("JWT_SECRET", "onsite-tests-secret-with-at-least-32-characters")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def _iso(delta_hours: float) -> str:
    return (now_utc() + timedelta(hours=delta_hours)).isoformat()


async def members_tournament(flow, **overrides) -> dict:
    """Ein Mitglieder-Turnier vor Ort mit offener Anmeldung - das Fenster läuft."""
    fields = {
        "visibility": "members",
        "event_mode": "local",
        "status": "registration_open",
        "registration_open_from": _iso(-1),
        "start_date": _iso(2),
        "end_date": _iso(8),
        "rules": "Nur fair spielen.",
        "description": "Interne Beschreibung",
    }
    fields.update(overrides)
    return await flow.create_tournament(**fields)


async def onsite_token(flow, tournament: dict) -> str:
    """Den Zugang holt die Leitung (Aushang, TV) - der Token steht nach dem Rautezeichen."""
    previous = flow.user
    flow.act_as(await flow.add_staff())
    response = await flow.get(f"/api/tournaments/{tournament['id']}/onsite-access")
    flow.act_as(previous)
    assert response.status_code == 200, response.text
    path = response.json()["path"]
    assert path.startswith("/vor-ort#")
    return path.split("#", 1)[1]


async def redeem(flow, token: str):
    return await flow.post("/api/tournaments/onsite/redeem", json={"token": token})


async def guest(flow) -> dict:
    """Begleitperson: Konto ohne Mitgliedschaft."""
    user = await flow.add_user(name=f"Gast {new_id()[:4]}")
    flow.act_as(user)
    return user


def registration_body() -> dict:
    return {"accept_rules": True, "accept_privacy": True}


# ------------------------------------------------------------------ Ausgangslage


@pytest.mark.asyncio
async def test_without_access_a_guest_does_not_see_a_members_tournament(flow):
    tournament = await members_tournament(flow)
    await guest(flow)
    assert (await flow.get(f"/api/tournaments/{tournament['slug']}")).status_code == 403


# ------------------------------------------------------------------ Einlösen und schlanke Ansicht


@pytest.mark.asyncio
async def test_redeemed_access_shows_the_slim_view_and_nothing_more(flow):
    event = {"id": new_id(), "slug": "lan", "name": "Interne LAN", "status": "published", "visibility": "members"}
    await flow.db.events.insert_one(dict(event))
    tournament = await members_tournament(flow, event_id=event["id"])
    token = await onsite_token(flow, tournament)
    await guest(flow)

    redeemed = await redeem(flow, token)
    assert redeemed.status_code == 200, redeemed.text
    assert redeemed.json()["tournament"]["slug"] == tournament["slug"]
    assert token not in redeemed.text
    cookie = redeemed.headers.get("set-cookie", "")
    assert PASS_COOKIE in cookie and "httponly" in cookie.lower() and "path=/api" in cookie.lower()

    page = await flow.get(f"/api/tournaments/{tournament['slug']}")
    assert page.status_code == 200, page.text
    body = page.json()
    assert body["onsite_view"] is True
    assert body["title"] == tournament["title"]
    assert body["max_participants"] == tournament["max_participants"]
    assert "participant_count" in body
    for hidden in ("rules", "description", "event_id", "event", "visibility", "related_f1_challenges"):
        assert hidden not in body
    # Mehr als die schlanke Ansicht öffnet der Zugang nicht.
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/registrations")).status_code == 403
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/bracket")).status_code == 403


@pytest.mark.asyncio
async def test_anonymous_visitor_can_redeem_and_keeps_the_access_for_login(flow):
    tournament = await members_tournament(flow)
    token = await onsite_token(flow, tournament)
    flow.act_as(None)
    assert (await redeem(flow, token)).status_code == 200
    assert (await flow.get(f"/api/tournaments/{tournament['slug']}")).json()["onsite_view"] is True
    # Nach Login/Registrierung im selben Browser gilt die Freigabe weiter.
    await guest(flow)
    assert (await flow.get(f"/api/tournaments/{tournament['slug']}")).json()["onsite_view"] is True


@pytest.mark.asyncio
async def test_members_see_the_full_page_even_with_access(flow):
    tournament = await members_tournament(flow)
    token = await onsite_token(flow, tournament)
    member = await flow.add_user(name="Mitglied")
    member["is_club_member"] = True
    flow.act_as(member)
    assert (await redeem(flow, token)).status_code == 200
    body = (await flow.get(f"/api/tournaments/{tournament['slug']}")).json()
    assert body.get("onsite_view") is not True
    assert body["rules"] == "Nur fair spielen."


# ------------------------------------------------------------------ Anmelden über den Zugang


@pytest.mark.asyncio
async def test_registration_through_access_is_marked_on_site_and_opens_the_tournament(flow):
    tournament = await members_tournament(flow)
    token = await onsite_token(flow, tournament)
    user = await guest(flow)
    assert (await flow.post(f"/api/tournaments/{tournament['id']}/register", json=registration_body())).status_code == 403
    assert (await redeem(flow, token)).status_code == 200

    response = await flow.post(f"/api/tournaments/{tournament['id']}/register", json=registration_body())
    assert response.status_code == 200, response.text
    stored = await flow.db.tournament_registrations.find_one({"tournament_id": tournament["id"], "user_id": user["id"]})
    assert stored["registered_via"] == "onsite"
    assert stored["status"] == "approved"

    # Ab jetzt Teilnehmer: das ganze Turnier, auch ohne die Freigabe im Browser.
    flow.client.cookies.clear()
    body = (await flow.get(f"/api/tournaments/{tournament['slug']}")).json()
    assert body.get("onsite_view") is not True
    assert body["rules"] == "Nur fair spielen."
    for path in ("bracket", "matches-v2", "registrations", "stages", "matchdays", "standings"):
        assert (await flow.get(f"/api/tournaments/{tournament['id']}/{path}")).status_code == 200, path


@pytest.mark.asyncio
async def test_seats_and_waitlist_apply_as_always(flow):
    tournament = await members_tournament(flow, max_participants=1)
    await flow.register(tournament, await flow.add_user(name="Erster"))
    token = await onsite_token(flow, tournament)
    user = await guest(flow)
    await redeem(flow, token)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/register", json=registration_body())
    assert response.status_code == 200, response.text
    stored = await flow.db.tournament_registrations.find_one({"tournament_id": tournament["id"], "user_id": user["id"]})
    assert stored["status"] == "waitlist"


@pytest.mark.asyncio
async def test_a_full_cup_says_how_long_the_waitlist_is(flow):
    """#1941 (F4): Das Bestätigungs-Blatt nennt bei vollem Cup den Wartelistenplatz - schlanke und volle Ansicht
    tragen die Länge der Warteliste (nur die Zahl, keine Namen)."""
    tournament = await members_tournament(flow, max_participants=1)
    await flow.register(tournament, await flow.add_user(name="Erster"))
    await flow.register(tournament, await flow.add_user(name="Wartender"), status="waitlist")
    token = await onsite_token(flow, tournament)
    await guest(flow)
    await redeem(flow, token)
    slim = (await flow.get(f"/api/tournaments/{tournament['slug']}")).json()
    assert slim["onsite_view"] is True
    assert slim["participant_count"] == 1 and slim["waitlist_count"] == 1

    flow.act_as(await flow.add_staff())
    full = (await flow.get(f"/api/tournaments/{tournament['slug']}")).json()
    assert full.get("onsite_view") is not True and full["waitlist_count"] == 1


@pytest.mark.asyncio
async def test_closed_registration_stays_closed_with_access(flow):
    tournament = await members_tournament(flow, status="check_in")
    token = await onsite_token(flow, tournament)
    await guest(flow)
    assert (await redeem(flow, token)).status_code == 200
    response = await flow.post(f"/api/tournaments/{tournament['id']}/register", json=registration_body())
    assert response.status_code == 400


# ------------------------------------------------------------------ Missbrauch


@pytest.mark.asyncio
async def test_access_opens_only_its_own_tournament(flow):
    first = await members_tournament(flow)
    second = await members_tournament(flow)
    token = await onsite_token(flow, first)
    await guest(flow)
    assert (await redeem(flow, token)).status_code == 200
    assert (await flow.get(f"/api/tournaments/{second['slug']}")).status_code == 403
    assert (await flow.post(f"/api/tournaments/{second['id']}/register", json=registration_body())).status_code == 403


@pytest.mark.asyncio
async def test_token_of_another_tournament_does_not_open_this_one(flow):
    first = await members_tournament(flow)
    second = await members_tournament(flow)
    token_second = await onsite_token(flow, second)
    await guest(flow)
    redeemed = await redeem(flow, token_second)
    assert redeemed.json()["tournament"]["id"] == second["id"]
    assert (await flow.get(f"/api/tournaments/{first['slug']}")).status_code == 403


@pytest.mark.asyncio
async def test_unknown_or_empty_token_is_refused_the_same_way(flow):
    await members_tournament(flow)
    await guest(flow)
    unknown = await redeem(flow, "x" * 43)
    empty = await redeem(flow, "")
    assert unknown.status_code == 404
    assert empty.status_code in {404, 422}
    assert PASS_COOKIE not in unknown.headers.get("set-cookie", "")
    # Der Token gehört in den Rumpf, nie in die Adresse.
    in_url = await flow.post(f"/api/tournaments/onsite/redeem?token={'x' * 43}")
    assert in_url.status_code == 422


@pytest.mark.asyncio
async def test_forged_pass_cookie_opens_nothing(flow):
    tournament = await members_tournament(flow)
    token = await onsite_token(flow, tournament)
    await guest(flow)
    await redeem(flow, token)
    real = flow.client.cookies.get(PASS_COOKIE, path="/api")
    flow.client.cookies.clear()
    forged = real[:-4] + ("AAAA" if not real.endswith("AAAA") else "BBBB")
    flow.client.cookies.set(PASS_COOKIE, forged, path="/api")
    assert (await flow.get(f"/api/tournaments/{tournament['slug']}")).status_code == 403
    flow.client.cookies.clear()
    flow.client.cookies.set(PASS_COOKIE, "kaputt", path="/api")
    assert (await flow.get(f"/api/tournaments/{tournament['slug']}")).status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("overrides", [
    {"status": "completed"},
    {"status": "scheduled"},
    {"status": "draft"},
    {"registration_open_from": _iso(3), "start_date": _iso(5)},
    {"start_date": _iso(-30), "end_date": _iso(-1)},
])
async def test_access_only_works_inside_the_event_window(flow, overrides):
    tournament = await members_tournament(flow)
    token = await onsite_token(flow, tournament)
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": overrides})
    await guest(flow)
    assert (await redeem(flow, token)).status_code == 404
    assert (await flow.get(f"/api/tournaments/{tournament['slug']}")).status_code in {403, 404}


@pytest.mark.asyncio
async def test_a_redeemed_access_ends_with_the_tournament(flow):
    tournament = await members_tournament(flow)
    token = await onsite_token(flow, tournament)
    await guest(flow)
    assert (await redeem(flow, token)).status_code == 200
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "completed"}})
    assert (await flow.get(f"/api/tournaments/{tournament['slug']}")).status_code == 403


@pytest.mark.asyncio
async def test_switched_off_access_stops_working_also_for_redeemed_passes(flow):
    tournament = await members_tournament(flow)
    token = await onsite_token(flow, tournament)
    await guest(flow)
    assert (await redeem(flow, token)).status_code == 200

    flow.act_as(await flow.add_staff())
    off = await flow.put(f"/api/tournaments/{tournament['id']}/onsite-access", json={"enabled": False})
    assert off.status_code == 200, off.text
    assert off.json()["enabled"] is False
    await guest(flow)
    assert (await flow.get(f"/api/tournaments/{tournament['slug']}")).status_code == 403
    assert (await redeem(flow, token)).status_code == 404
    assert (await flow.post(f"/api/tournaments/{tournament['id']}/register", json=registration_body())).status_code == 403


@pytest.mark.asyncio
async def test_renewed_access_invalidates_old_qr_and_old_passes(flow):
    tournament = await members_tournament(flow)
    old_token = await onsite_token(flow, tournament)
    await guest(flow)
    assert (await redeem(flow, old_token)).status_code == 200

    flow.act_as(await flow.add_staff())
    renewed = await flow.post(f"/api/tournaments/{tournament['id']}/onsite-access/renew")
    assert renewed.status_code == 200, renewed.text
    new_token = renewed.json()["path"].split("#", 1)[1]
    assert new_token != old_token

    await guest(flow)
    assert (await flow.get(f"/api/tournaments/{tournament['slug']}")).status_code == 403
    assert (await redeem(flow, old_token)).status_code == 404
    assert (await redeem(flow, new_token)).status_code == 200


@pytest.mark.asyncio
async def test_online_tournaments_have_no_on_site_access_unless_switched_on(flow):
    tournament = await members_tournament(flow, event_mode="online")
    token = await onsite_token(flow, tournament)
    await guest(flow)
    assert (await redeem(flow, token)).status_code == 404

    flow.act_as(await flow.add_staff())
    state = (await flow.get(f"/api/tournaments/{tournament['id']}/onsite-access")).json()
    assert state["enabled"] is False and state["default"] is False
    on = await flow.put(f"/api/tournaments/{tournament['id']}/onsite-access", json={"enabled": True})
    assert on.json()["enabled"] is True
    await guest(flow)
    assert (await redeem(flow, token)).status_code == 200


@pytest.mark.asyncio
async def test_guessing_tokens_is_rate_limited(flow):
    await members_tournament(flow)
    flow.act_as(None)
    codes = [(await redeem(flow, f"falsch-{index:040d}")).status_code for index in range(25)]
    assert codes[0] == 404
    assert codes[-1] == 429


@pytest.mark.asyncio
async def test_only_the_tournament_lead_manages_the_access(flow):
    tournament = await members_tournament(flow)
    await guest(flow)
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/onsite-access")).status_code == 403
    assert (await flow.post(f"/api/tournaments/{tournament['id']}/onsite-access/renew")).status_code == 403
    assert (await flow.put(f"/api/tournaments/{tournament['id']}/onsite-access", json={"enabled": True})).status_code == 403


@pytest.mark.asyncio
async def test_the_secret_never_appears_in_tournament_payloads(flow):
    tournament = await members_tournament(flow)
    token = await onsite_token(flow, tournament)
    stored = await flow.db.tournament_onsite_access.find_one({"tournament_id": tournament["id"]}, {"_id": 0})
    assert stored and token not in str(stored)
    flow.act_as(await flow.add_staff())
    for url in (f"/api/tournaments/{tournament['slug']}", f"/api/tournaments/{tournament['id']}/bracket", "/api/tournaments"):
        text = (await flow.get(url)).text
        assert token not in text and stored["token_hash"] not in text and stored["nonce"] not in text, url


# ------------------------------------------------------------------ TV


@pytest.mark.asyncio
async def test_tv_registration_screen_gets_the_access_path_only_while_open(flow):
    tournament = await members_tournament(flow)
    flow.act_as(await flow.add_staff())
    payload = (await flow.get(f"/api/tournaments/{tournament['id']}/bracket/display")).json()
    assert payload["onsite_path"].startswith("/vor-ort#")

    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"event_mode": "online"}})
    payload = (await flow.get(f"/api/tournaments/{tournament['id']}/bracket/display")).json()
    assert payload.get("onsite_path") is None


# ------------------------------------------------------------------ Teilnehmende sehen ihr Turnier


@pytest.mark.asyncio
async def test_participants_see_every_match_of_their_tournament_but_no_other_members_tournament(flow):
    tournament, users, registrations = await flow.with_participants(4, visibility="members")
    other, _, _ = await flow.with_participants(2, visibility="members")
    matches = [
        {"id": new_id(), "tournament_id": tournament["id"], "round": 1, "status": "ready",
         "slots": [{"slot": 1, "registration_id": registrations[0]["id"]}, {"slot": 2, "registration_id": registrations[1]["id"]}]},
        {"id": new_id(), "tournament_id": tournament["id"], "round": 1, "status": "ready",
         "slots": [{"slot": 1, "registration_id": registrations[2]["id"]}, {"slot": 2, "registration_id": registrations[3]["id"]}]},
        {"id": new_id(), "tournament_id": other["id"], "round": 1, "status": "ready", "slots": []},
    ]
    for match in matches:
        await flow.db.matches_v2.insert_one(dict(match))
    flow.act_as(users[0])
    assert (await flow.get(f"/api/matches/{matches[0]['id']}")).status_code == 200
    assert (await flow.get(f"/api/matches/{matches[1]['id']}")).status_code == 200
    assert (await flow.get(f"/api/matches/{matches[2]['id']}")).status_code == 403
    assert (await flow.get(f"/api/tournaments/{other['slug']}")).status_code == 403
    listed = {row["id"] for row in (await flow.get("/api/tournaments")).json()}
    assert tournament["id"] in listed and other["id"] not in listed


@pytest.mark.asyncio
async def test_withdrawn_participant_loses_the_view(flow):
    tournament = await members_tournament(flow)
    token = await onsite_token(flow, tournament)
    await guest(flow)
    await redeem(flow, token)
    registered = (await flow.post(f"/api/tournaments/{tournament['id']}/register", json=registration_body())).json()
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/bracket")).status_code == 200
    gone = await flow.delete(f"/api/tournaments/{tournament['id']}/registrations/{registered['id']}")
    assert gone.status_code == 200, gone.text
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/bracket")).status_code == 403
    # Mit der Freigabe bleibt nur die schlanke Ansicht.
    assert (await flow.get(f"/api/tournaments/{tournament['slug']}")).json()["onsite_view"] is True


@pytest.mark.asyncio
async def test_participant_does_not_learn_the_hidden_event(flow):
    event = {"id": new_id(), "slug": "lan", "name": "Interne LAN", "status": "published", "visibility": "internal"}
    await flow.db.events.insert_one(dict(event))
    tournament, users, _ = await flow.with_participants(2, visibility="members", event_id=event["id"])
    flow.act_as(users[0])
    body = (await flow.get(f"/api/tournaments/{tournament['slug']}")).json()
    assert body.get("event_id") is None and "event" not in body
    bracket = (await flow.get(f"/api/tournaments/{tournament['id']}/bracket")).json()
    assert bracket["tournament"].get("event_id") is None


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["rejected", "no_show", "withdrawn", "disqualified", "cancelled", "irgendwas"])
async def test_only_active_registrations_count_as_participant(flow, status):
    """Ausgetreten, disqualifiziert, abgelehnt, nicht erschienen, storniert oder unbekannt: keine Sicht mehr (Codex #1597)."""
    tournament = await members_tournament(flow)
    user = await guest(flow)
    await flow.register(tournament, user, status=status)
    match = {"id": new_id(), "tournament_id": tournament["id"], "round": 1, "status": "ready", "slots": []}
    await flow.db.matches_v2.insert_one(dict(match))
    assert (await flow.get(f"/api/tournaments/{tournament['slug']}")).status_code == 403
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/bracket")).status_code == 403
    assert (await flow.get(f"/api/matches/{match['id']}")).status_code == 403
    listed = {row["id"] for row in (await flow.get("/api/tournaments")).json()}
    assert tournament["id"] not in listed


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["pending", "approved", "waitlist", "checked_in"])
async def test_active_registrations_see_their_tournament(flow, status):
    tournament = await members_tournament(flow)
    user = await guest(flow)
    await flow.register(tournament, user, status=status)
    assert (await flow.get(f"/api/tournaments/{tournament['slug']}")).status_code == 200
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/bracket")).status_code == 200
