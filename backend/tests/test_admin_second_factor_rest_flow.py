"""Verwaltung nur mit bestätigter Zwei-Faktor-Anmeldung - die restlichen Stellen (#1479, Nachzug zu #1469).

Kostenangaben an Events und Turnieren, leere Alben in Galerie und Event-Seite, die Vorschau des Jahresrückblicks und
Banner für das Admin-Team fragten noch den Bereich bzw. die Rolle ohne die Bestätigung. Die Team-Antwort sagt jetzt
selbst, was die Person darf (``can_remove_members``, ``can_dissolve``) und ob nur die Zwei-Faktor-Anmeldung fehlt
(``admin_needs_second_factor``) - Web und App lesen das, statt Rollen zu deuten. Je Stelle: mit Zwei-Faktor erlaubt,
ohne abgelehnt bzw. ausgeblendet, öffentlich unverändert. Erfundene Daten, keine echten Personen."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def without_second_factor(user: dict) -> dict:
    """Dasselbe Konto, aber die Anmeldung ist (noch) nicht mit dem zweiten Faktor bestätigt."""
    return {**user, "auth_mfa_verified": False}


OFFER = {
    "enabled": True,
    "positions": [
        {"key": "beitrag", "label": "Kostenbeitrag", "amount": "20", "basis": "per_person"},
        {"key": "shirt", "label": "Event-Shirt", "amount": "15", "basis": "per_registration", "optional": True, "dolibarr_product_id": 17},
    ],
}


# ------------------------------------------------------------------ Der Vertrag

@pytest.mark.asyncio
async def test_can_use_area_follows_require_area(flow):
    from services.permissions import can_use_area

    admin = await flow.add_user(role="club_admin", name="clubadmin")
    moderator = await flow.add_user(role="moderator", name="moderation")
    granted = await flow.add_user(role="player", name="kassier")
    granted["areas"] = ["finance"]

    assert await can_use_area(admin, "finance") is True
    assert await can_use_area(without_second_factor(admin), "finance") is False
    assert await can_use_area(without_second_factor(admin), "finance", "moderation") is True, "Moderation geht ohne"
    assert await can_use_area(without_second_factor(moderator), "moderation") is True
    assert await can_use_area(granted, "finance") is True
    assert await can_use_area(without_second_factor(granted), "finance") is False
    assert await can_use_area(granted, "content") is False
    assert await can_use_area(None, "finance") is False


# ------------------------------------------------------------------ Kostenangaben (Bereich Finanzen)

async def make_event(flow, admin):
    flow.act_as(admin)
    response = await flow.post("/api/events", json={
        "name": "Herbst-LAN", "status": "registration_open", "visibility": "public", "has_registration": True,
        "start_date": (now_utc() + timedelta(days=20)).isoformat(), "billing": OFFER,
    })
    assert response.status_code == 200, response.text
    return response.json()


async def event_views(flow, event):
    detail = (await flow.get(f"/api/events/{event['slug']}")).json()
    listed = next(ev for ev in (await flow.get("/api/events")).json() if ev["id"] == event["id"])
    return detail, listed


@pytest.mark.asyncio
async def test_event_cost_configuration_needs_the_second_factor(flow):
    kassier = await flow.add_user(role="club_admin", name="kassier")
    event = await make_event(flow, kassier)

    flow.act_as(without_second_factor(kassier))
    for view in await event_views(flow, event):
        assert "billing" not in view
        assert view["offer"]["positions"][0]["amount_cents"] == 2000, "die Preisangabe bleibt für alle"

    flow.act_as(kassier)
    for view in await event_views(flow, event):
        assert view["billing"]["positions"][1]["dolibarr_product_id"] == 17

    # Öffentlich unverändert.
    flow.act_as(None)
    for view in await event_views(flow, event):
        assert "billing" not in view and view["offer"]["enabled"] is True


async def make_tournament(flow, admin):
    flow.act_as(admin)
    await flow.db.games.insert_one({"id": "g1", "name": "Rocket League", "slug": "rocket-league"})
    response = await flow.post("/api/tournaments", json={
        "title": "Herbst-Cup", "game_id": "g1", "status": "registration_open", "visibility": "public", "is_public": True,
        "format": "single_elim", "team_mode": "solo", "team_size": 1, "max_participants": 16,
        "start_date": (now_utc() + timedelta(days=10)).isoformat(), "billing": OFFER,
    })
    assert response.status_code == 200, response.text
    return response.json()


async def tournament_views(flow, tournament):
    detail = (await flow.get(f"/api/tournaments/{tournament['slug']}")).json()
    listed = next(t for t in (await flow.get("/api/tournaments")).json() if t["id"] == tournament["id"])
    return detail, listed


@pytest.mark.asyncio
async def test_tournament_cost_configuration_needs_the_second_factor(flow):
    kassier = await flow.add_user(role="club_admin", name="kassier")
    tournament = await make_tournament(flow, kassier)

    flow.act_as(without_second_factor(kassier))
    for view in await tournament_views(flow, tournament):
        assert "billing" not in view
        assert view["offer"]["enabled"] is True, "die Preisangabe bleibt für alle"

    flow.act_as(kassier)
    for view in await tournament_views(flow, tournament):
        assert view["billing"]["positions"][1]["dolibarr_product_id"] == 17

    flow.act_as(None)
    for view in await tournament_views(flow, tournament):
        assert "billing" not in view and view["offer"]["enabled"] is True


# ------------------------------------------------------------------ Leere Alben (Bereich Redaktion)

async def albums_setup(flow):
    event = {"id": new_id(), "slug": "sommer-lan", "name": "Sommer-LAN", "status": "scheduled", "visibility": "public",
             "start_date": (now_utc() - timedelta(days=3)).isoformat(), "end_date": (now_utc() - timedelta(days=2)).isoformat()}
    await flow.db.events.insert_one(dict(event))
    await flow.db.gallery_albums.insert_many([
        {"id": "a-voll", "slug": "sommer-lan-fotos", "title": "Fotos", "published": True, "visibility": "public", "event_id": event["id"], "order_index": 1},
        {"id": "a-leer", "slug": "sommer-lan-tag-2", "title": "Tag 2", "published": True, "visibility": "public", "event_id": event["id"], "order_index": 2},
    ])
    await flow.db.gallery_photos.insert_one({"id": "p1", "album_id": "a-voll", "url": "/uploads/eins.jpg", "media_type": "image", "order_index": 1})
    editor = await flow.add_user(role="player", name="redaktion")
    editor["areas"] = ["content"]
    return event, editor


async def album_ids(flow, event):
    gallery = {album["id"] for album in (await flow.get("/api/gallery")).json()}
    on_event = {album["id"] for album in (await flow.get(f"/api/events/{event['slug']}")).json()["albums"]}
    return gallery, on_event


@pytest.mark.asyncio
async def test_empty_albums_show_to_editors_only_with_the_second_factor(flow):
    event, editor = await albums_setup(flow)

    flow.act_as(without_second_factor(editor))
    gallery, on_event = await album_ids(flow, event)
    assert gallery == {"a-voll"} and on_event == {"a-voll"}

    flow.act_as(editor)
    gallery, on_event = await album_ids(flow, event)
    assert gallery == {"a-voll", "a-leer"} and on_event == {"a-voll", "a-leer"}

    flow.act_as(None)
    gallery, on_event = await album_ids(flow, event)
    assert gallery == {"a-voll"} and on_event == {"a-voll"}


# ------------------------------------------------------------------ Vorschau des Jahresrückblicks (Redaktion)

@pytest.mark.asyncio
async def test_year_review_preview_needs_the_second_factor(flow, monkeypatch):
    from routes import year_review_routes
    from services import year_review

    monkeypatch.setattr(year_review, "window_year", lambda settings, now=None: None)
    editor = await flow.add_user(role="player", name="redaktion")
    editor["areas"] = ["content"]
    player = await flow.add_user(role="player", name="spieler")

    assert await year_review_routes._year_for(flow.db, without_second_factor(editor), True) is None
    assert await year_review_routes._year_for(flow.db, editor, True) is not None
    assert await year_review_routes._year_for(flow.db, player, True) is None


# ------------------------------------------------------------------ Banner für das Admin-Team

def test_admin_banner_needs_the_second_factor_except_for_moderation():
    from routes.settings_routes import _banner_active

    banner = {"text": "Bitte die Turnierplanung prüfen", "audience": "admins"}
    admin = {"id": "u1", "role": "club_admin", "mfa_enabled": True, "auth_mfa_verified": True}
    moderator = {"id": "u2", "role": "moderator"}
    assert _banner_active(banner, admin) is True
    assert _banner_active(banner, without_second_factor(admin)) is False
    assert _banner_active(banner, moderator) is True, "Moderation braucht keine Zwei-Faktor-Anmeldung"
    assert _banner_active(banner, {"id": "u3", "role": "player"}) is False
    assert _banner_active(banner, None) is False
    assert _banner_active({"text": "Willkommen", "audience": "all"}, None) is True


# ------------------------------------------------------------------ Team: was die Person darf

async def make_team(flow, captain, co_leader, *members):
    team = {
        "id": new_id(), "name": "Lions Rocket", "tag": "LRK", "leader_id": captain["id"], "co_leader_ids": [co_leader["id"]],
        "member_ids": [captain["id"], co_leader["id"], *[m["id"] for m in members]], "join_code": "Kx7pQ2", "is_public": True,
        "created_at": "2026-01-10T10:00:00+00:00",
    }
    await flow.db.teams.insert_one(dict(team))
    for user in (captain, co_leader, *members):
        await flow.db.team_members.insert_one({"team_id": team["id"], "user_id": user["id"], "role": "member"})
    return team


RIGHTS = ("can_manage", "can_remove_members", "can_dissolve", "admin_needs_second_factor")


async def rights(flow, team, user):
    flow.act_as(user)
    response = await flow.get(f"/api/teams/{team['id']}")
    assert response.status_code == 200, response.text
    body = response.json()
    return tuple(body.get(key) for key in RIGHTS)


@pytest.mark.asyncio
async def test_team_response_says_what_the_viewer_may_do(flow):
    captain = await flow.add_user(role="player", name="neonfalke")
    co_leader = await flow.add_user(role="player", name="lunabyte")
    mate = await flow.add_user(role="player", name="pixelkatze")
    club_admin = await flow.add_user(role="club_admin", name="clubadmin")
    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    moderator = await flow.add_user(role="moderator", name="moderation")
    team = await make_team(flow, captain, co_leader, mate)

    # Die Teamleitung braucht für ihr eigenes Team keine Zwei-Faktor-Anmeldung.
    assert await rights(flow, team, without_second_factor(captain)) == (True, True, True, False)
    assert await rights(flow, team, without_second_factor(co_leader)) == (True, True, False, False)
    assert await rights(flow, team, mate) == (False, False, False, False)

    # Club-Admin: alles mit Zwei-Faktor, ohne nur der Hinweis.
    assert await rights(flow, team, club_admin) == (True, True, True, False)
    assert await rights(flow, team, without_second_factor(club_admin)) == (False, False, False, True)

    # Turnierleitung: bearbeiten mit Zwei-Faktor, Mitglieder entfernen und auflösen nie.
    assert await rights(flow, team, lead) == (True, False, False, False)
    assert await rights(flow, team, without_second_factor(lead)) == (False, False, False, True)

    # Moderation verwaltet keine Teams und bekommt keinen Hinweis; öffentlich unverändert.
    assert await rights(flow, team, moderator) == (False, False, False, False)
    assert await rights(flow, team, None) == (False, False, False, False)
