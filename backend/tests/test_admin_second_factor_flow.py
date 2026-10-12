"""Verwaltung außerhalb der Turniere nur mit bestätigter Zwei-Faktor-Anmeldung (#1469).

Teams, News-Entwürfe, Suche, Erfolge, Saison-Fundstücke, gesperrte Dokument-Downloads und das Upload-Protokoll fragten
nur die Rolle. Jetzt gilt derselbe Vertrag wie in ``require_area``: eine Rolle mit Adminbereich zählt erst mit
bestätigter Zwei-Faktor-Anmeldung. Je Bereich: mit Zwei-Faktor erlaubt, ohne abgelehnt, öffentlich unverändert.
Erfundene Daten, keine echten Personen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402

from services.permissions import MFA_MESSAGE  # noqa: E402


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


async def make_team(flow, captain, *members, is_public=True):
    team = {
        "id": new_id(), "name": "Lions Rocket", "tag": "LRK", "leader_id": captain["id"], "co_leader_ids": [],
        "member_ids": [captain["id"], *[m["id"] for m in members]], "join_code": "Kx7pQ2", "is_public": is_public,
        "created_at": "2026-01-10T10:00:00+00:00",
    }
    await flow.db.teams.insert_one(dict(team))
    for user in (captain, *members):
        await flow.db.team_members.insert_one({"team_id": team["id"], "user_id": user["id"], "role": "member"})
    return team


# ------------------------------------------------------------------ Teams

@pytest.mark.asyncio
async def test_team_admin_edits_need_the_second_factor(flow):
    captain = await flow.add_user(role="player", name="neonfalke")
    mate = await flow.add_user(role="player", name="lunabyte")
    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    team = await make_team(flow, captain, mate)

    flow.act_as(without_second_factor(lead))
    refused = await flow.patch(f"/api/teams/{team['id']}", json={"description": "Neu"})
    assert refused.status_code == 403
    assert refused.json()["detail"] == MFA_MESSAGE
    mine = (await flow.get(f"/api/teams/{team['id']}")).json()
    assert mine["can_manage"] is False

    flow.act_as(lead)
    assert (await flow.patch(f"/api/teams/{team['id']}", json={"description": "Neu"})).status_code == 200
    assert (await flow.get(f"/api/teams/{team['id']}")).json()["can_manage"] is True

    # Die Teamleitung selbst braucht keinen Adminbereich und keine Zwei-Faktor-Anmeldung.
    flow.act_as(without_second_factor(captain))
    assert (await flow.patch(f"/api/teams/{team['id']}", json={"description": "Vom Kapitän"})).status_code == 200


@pytest.mark.asyncio
async def test_club_admin_team_actions_need_the_second_factor(flow):
    captain = await flow.add_user(role="player", name="neonfalke")
    mate = await flow.add_user(role="player", name="lunabyte")
    other = await flow.add_user(role="player", name="pixelkatze")
    admin = await flow.add_user(role="club_admin", name="clubadmin")
    team = await make_team(flow, captain, mate, other)

    flow.act_as(without_second_factor(admin))
    for response in (
        await flow.post(f"/api/teams/{team['id']}/members/{mate['id']}/role", json={"role": "co_leader"}),
        await flow.delete(f"/api/teams/{team['id']}/members/{other['id']}"),
        await flow.post(f"/api/teams/{team['id']}/transfer-leader", json={"new_leader_id": mate["id"]}),
        await flow.delete(f"/api/teams/{team['id']}", params={"confirm": "falsch"}),
        await flow.get(f"/api/teams/{team['id']}/dissolve-preview"),
    ):
        assert response.status_code == 403, response.text
        assert response.json()["detail"] == MFA_MESSAGE
    stored = await flow.db.teams.find_one({"id": team["id"]})
    assert stored["leader_id"] == captain["id"] and other["id"] in stored["member_ids"] and not stored["co_leader_ids"]

    flow.act_as(admin)
    promoted = await flow.post(f"/api/teams/{team['id']}/members/{mate['id']}/role", json={"role": "co_leader"})
    assert promoted.status_code == 200
    removed = await flow.delete(f"/api/teams/{team['id']}/members/{other['id']}")
    assert removed.status_code == 200
    preview = await flow.get(f"/api/teams/{team['id']}/dissolve-preview")
    assert preview.status_code == 200
    # Die Berechtigung greift; aufgelöst wird nur mit dem richtigen Teamnamen.
    dissolve = await flow.delete(f"/api/teams/{team['id']}", params={"confirm": "falsch"})
    assert dissolve.status_code == 400
    handed_over = await flow.post(f"/api/teams/{team['id']}/transfer-leader", json={"new_leader_id": mate["id"]})
    assert handed_over.status_code == 200


@pytest.mark.asyncio
async def test_private_team_shows_to_admins_only_with_the_second_factor(flow):
    captain = await flow.add_user(role="player", name="neonfalke")
    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    hidden = await make_team(flow, captain, is_public=False)
    public = await make_team(flow, captain)

    flow.act_as(without_second_factor(lead))
    assert (await flow.get(f"/api/teams/{hidden['id']}")).status_code == 404
    flow.act_as(lead)
    assert (await flow.get(f"/api/teams/{hidden['id']}")).status_code == 200

    # Öffentlich unverändert.
    flow.act_as(None)
    assert (await flow.get(f"/api/teams/{hidden['id']}")).status_code == 404
    assert (await flow.get(f"/api/teams/{public['id']}")).status_code == 200


# ------------------------------------------------------------------ News und Suche

async def make_news(flow, title, *, published):
    post = {
        "id": new_id(), "slug": title.lower().replace(" ", "-"), "title": title, "excerpt": "", "content": "Text",
        "category": "Verein", "visibility": "public", "published": published,
        "published_at": "2026-09-01T10:00:00+00:00" if published else None, "created_at": "2026-09-01T10:00:00+00:00",
    }
    await flow.db.news_posts.insert_one(dict(post))
    return post


@pytest.mark.asyncio
async def test_news_drafts_need_the_second_factor(flow):
    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    draft = await make_news(flow, "Herbstplan Entwurf", published=False)
    live = await make_news(flow, "Herbstplan Termine", published=True)

    def titles(response):
        return {item["title"] for item in response.json()}

    flow.act_as(lead)
    assert draft["title"] in titles(await flow.get("/api/news"))
    assert (await flow.get(f"/api/news/{draft['slug']}")).status_code == 200

    flow.act_as(without_second_factor(lead))
    assert titles(await flow.get("/api/news")) == {live["title"]}
    assert (await flow.get(f"/api/news/{draft['slug']}")).status_code == 404

    # Öffentlich unverändert.
    flow.act_as(None)
    assert titles(await flow.get("/api/news")) == {live["title"]}
    assert (await flow.get(f"/api/news/{draft['slug']}")).status_code == 404
    assert (await flow.get(f"/api/news/{live['slug']}")).status_code == 200


@pytest.mark.asyncio
async def test_search_finds_news_drafts_only_with_the_second_factor(flow):
    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    draft = await make_news(flow, "Herbstplan Entwurf", published=False)
    live = await make_news(flow, "Herbstplan Termine", published=True)

    async def news_titles():
        response = await flow.get("/api/search", params={"q": "Herbstplan"})
        assert response.status_code == 200
        return {item["title"] for item in response.json()["items"] if item.get("kind") == "news"}

    flow.act_as(lead)
    assert await news_titles() == {draft["title"], live["title"]}
    flow.act_as(without_second_factor(lead))
    assert await news_titles() == {live["title"]}
    flow.act_as(None)
    assert await news_titles() == {live["title"]}


# ------------------------------------------------------------------ Erfolge und Saison-Fundstücke

@pytest.mark.asyncio
async def test_private_profile_achievements_need_the_second_factor(flow):
    target = await flow.add_user(role="player", name="leisespielerin")
    await flow.db.users.update_one({"id": target["id"]}, {"$set": {"privacy_public_profile": False}})
    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")

    for url in (f"/api/achievements/user/{target['id']}", f"/api/achievements/collectibles/user/{target['id']}"):
        flow.act_as(lead)
        assert (await flow.get(url)).status_code == 200, url
        flow.act_as(without_second_factor(lead))
        assert (await flow.get(url)).status_code == 404, url
        flow.act_as(None)
        assert (await flow.get(url)).status_code == 404, url


@pytest.mark.asyncio
async def test_public_profile_achievements_stay_public(flow):
    target = await flow.add_user(role="player", name="offenespielerin")
    await flow.db.users.update_one({"id": target["id"]}, {"$set": {"privacy_public_profile": True}})
    flow.act_as(None)
    assert (await flow.get(f"/api/achievements/user/{target['id']}")).status_code == 200


@pytest.mark.asyncio
async def test_hidden_achievement_groups_show_to_admins_only_with_the_second_factor(flow):
    admin = await flow.add_user(role="club_admin", name="clubadmin")
    await flow.db.achievement_groups.insert_many([
        {"code": "geheim-kiste", "name": "Geheime Kiste", "hidden": True, "public": True, "sort_order": 1, "category": "community"},
        {"code": "offen-start", "name": "Erste Schritte", "public": True, "sort_order": 2, "category": "community"},
    ])

    async def codes():
        response = await flow.get("/api/achievements/groups")
        assert response.status_code == 200
        return {group["code"] for group in response.json()}

    flow.act_as(admin)
    assert await codes() == {"geheim-kiste", "offen-start"}
    flow.act_as(without_second_factor(admin))
    assert await codes() == {"offen-start"}
    flow.act_as(None)
    assert await codes() == {"offen-start"}


@pytest.mark.asyncio
async def test_club_category_of_other_profiles_needs_the_second_factor_or_a_membership(flow):
    from services.achievement_visibility import viewer_sees_club

    target = await flow.add_user(role="player", name="vereinsspielerin")
    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    assert await viewer_sees_club(flow.db, lead, target["id"]) is True
    assert await viewer_sees_club(flow.db, without_second_factor(lead), target["id"]) is False
    # Als Mitglied sieht man sie weiter - ohne Adminbereich und ohne Zwei-Faktor.
    await flow.db.memberships.insert_one({"user_id": lead["id"], "member_status": "active"})
    assert await viewer_sees_club(flow.db, without_second_factor(lead), target["id"]) is True


# ------------------------------------------------------------------ Dokumente und Uploads

@pytest.mark.asyncio
async def test_locked_document_downloads_need_the_second_factor(flow):
    admin = await flow.add_user(role="club_admin", name="clubadmin")
    doc = {"id": new_id(), "title": "Protokoll Vorstandssitzung", "visibility": "members", "allow_download": False,
           "filename": "protokoll.pdf", "created_at": "2026-09-01T10:00:00+00:00"}
    await flow.db.documents.insert_one(dict(doc))

    flow.act_as(admin)
    assert (await flow.post(f"/api/documents/{doc['id']}/track-download")).status_code == 200
    flow.act_as(without_second_factor(admin))
    assert (await flow.post(f"/api/documents/{doc['id']}/track-download")).status_code == 403


@pytest.mark.asyncio
async def test_admin_media_needs_the_second_factor(flow):
    from routes.upload_routes import _clean_media_scope, _is_admin_media_user
    from fastapi import HTTPException

    lead = await flow.add_user(role="tournament_admin", name="turnierleitung")
    flow.act_as(lead)
    assert (await flow.get("/api/uploads/events")).status_code == 200
    assert _clean_media_scope("gallery", lead) == "gallery"
    assert _is_admin_media_user(lead) is True

    flow.act_as(without_second_factor(lead))
    assert (await flow.get("/api/uploads/events")).status_code == 403
    assert _is_admin_media_user(without_second_factor(lead)) is False
    with pytest.raises(HTTPException) as refused:
        _clean_media_scope("gallery", without_second_factor(lead))
    assert refused.value.status_code == 403
    assert refused.value.detail == MFA_MESSAGE
    # Eigene Bilder lädt jedes Konto weiter hoch.
    assert _clean_media_scope("user", without_second_factor(lead)) == "user"
