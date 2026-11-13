"""Profilfelder, die Web und App über PATCH /api/users/me speichern, und was das öffentliche Profil davon zeigt (#932) -
durch die echte Anwendung statt gegen einen laufenden Server.

- Mehrfachauswahl (Eingabegeräte, Plattformen, Abos) und der Twitch-Einbau kommen gespeichert zurück.
- Ein öffentliches Profil zeigt Twitch-Name, den Einbau-Schalter, Eingabegeräte und Plattformen.
- Instagram, Newsletter-Abmeldung, Sichtbarkeit je Feld und die Lieblingsspiele werden gespeichert.

Ersetzt test_phase_a_quickwins.py::test_profile_multiselect_fields, ::test_public_profile_exposes_twitch_embed;
test_phase_membership.py::test_patch_extended_fields, ::test_patch_favorite_games_list. Erfundene Daten, keine echten Personen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_mehrfachauswahl_und_twitch_einbau_kommen_gespeichert_zurueck(flow):
    lena = await flow.add_user(name="lena")
    flow.act_as(lena)
    res = await flow.patch("/api/users/me", json={
        "input_devices": ["controller", "wheel"],
        "main_platforms": ["PC", "Switch2"],
        "gaming_subscriptions": ["nintendo_online_expansion", "xbox_game_pass"],
        "twitch_handle": "lena_streamt",
        "show_twitch_embed": True,
    })
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["input_devices"] == ["controller", "wheel"]
    assert data["main_platforms"] == ["PC", "Switch2"]
    assert data["gaming_subscriptions"] == ["nintendo_online_expansion", "xbox_game_pass"]
    assert data["show_twitch_embed"] is True and data["twitch_handle"] == "lena_streamt"
    stored = await flow.db.users.find_one({"id": lena["id"]}, {"_id": 0})
    assert stored["input_devices"] == ["controller", "wheel"] and stored["show_twitch_embed"] is True


@pytest.mark.asyncio
async def test_oeffentliches_profil_zeigt_twitch_einbau_geraete_und_plattformen(flow):
    lena = await flow.add_user(name="lena")
    flow.act_as(lena)
    saved = await flow.patch("/api/users/me", json={
        "privacy_public_profile": True, "twitch_handle": "lena_streamt", "show_twitch_embed": True,
        "input_devices": ["keyboard_mouse"], "main_platforms": ["PC"],
    })
    assert saved.status_code == 200, saved.text

    flow.act_as(None)
    res = await flow.get("/api/users/public/lena")
    assert res.status_code == 200, res.text
    profile = res.json()
    assert profile["twitch_handle"] == "lena_streamt"
    assert profile["show_twitch_embed"] is True
    assert profile["input_devices"] == ["keyboard_mouse"]
    assert profile["main_platforms"] == ["PC"]


@pytest.mark.asyncio
async def test_instagram_newsletter_sichtbarkeit_und_lieblingsspiele_werden_gespeichert(flow):
    mara = await flow.add_user(name="mara")
    await flow.db.users.update_one({"id": mara["id"]}, {"$set": {"newsletter_consent": True}})
    flow.act_as(mara)
    res = await flow.patch("/api/users/me", json={
        "instagram_handle": "mara_insta",
        "newsletter_consent": False,
        "profile_visibility": {"discord": "members"},
    })
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["instagram_handle"] == "mara_insta"
    assert data["newsletter_consent"] is False
    assert data["profile_visibility"] == {"discord": "members"}

    games = await flow.patch("/api/users/me", json={"favorite_games": ["F1 25", "Mario Kart", "Rocket League"]})
    assert games.status_code == 200, games.text
    assert games.json()["favorite_games"] == ["F1 25", "Mario Kart", "Rocket League"]
    stored = await flow.db.users.find_one({"id": mara["id"]}, {"_id": 0})
    assert stored["instagram_handle"] == "mara_insta" and stored["newsletter_consent"] is False
    assert stored["profile_visibility"] == {"discord": "members"}
    assert stored["favorite_games"] == ["F1 25", "Mario Kart", "Rocket League"]
