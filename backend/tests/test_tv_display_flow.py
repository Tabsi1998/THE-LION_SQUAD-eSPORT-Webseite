"""TV & Beamer (#1110-#1114): Grundwerte für alle Bildschirme und der Anzeige-Schlüssel des Turnierbaum-TVs.

Grundwerte: lesen ohne Anmeldung, speichern nur mit dem Bereich Turniere, falsche Werte abgelehnt, fehlende Werte
sind der Standard. Schlüssel: ein gültiger öffnet den TV ohne Anmeldung, ein widerrufener nichts mehr, einer für
Turnier A nie Turnier B, und mit keinem lässt sich etwas schreiben.
"""
import json
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import change_events, tv_display  # noqa: E402
from services.access_links import hash_access_token  # noqa: E402

DEFAULTS = {"text_size": "normal", "contrast": False, "safe_area": 0, "pixel_shift": True, "season_header": True, "reduce_motion": False,
            "result_sound": False}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def bracket_of(flow, count=4, **fields):
    """Ein Turnier mit Turnierbaum, angelegt von der Turnierleitung."""
    staff = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(count, **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    return staff, tournament, users, registrations


async def new_key(flow, tournament, label="Beamer Halle"):
    response = await flow.post("/api/tv/keys", json={"tournament_id": tournament["id"], "label": label})
    assert response.status_code == 200, response.text
    return response.json()


async def show_tv(flow, tournament_ref, key):
    return await flow.get(f"/api/tournaments/{tournament_ref}/bracket/display", params={"key": key})


# ---------------------------------------------------------------- Grundwerte

@pytest.mark.asyncio
async def test_settings_read_without_login_and_without_stored_values_are_the_defaults(flow):
    flow.act_as(None)
    response = await flow.get("/api/tv/settings")
    assert response.status_code == 200
    body = response.json()
    assert body["settings"] == DEFAULTS
    assert body["defaults"] == DEFAULTS
    assert body["choices"] == {"text_size": ["normal", "large"], "safe_area": [0, 3, 5]}
    assert tv_display.DEFAULTS == DEFAULTS, "Fabians Wahl aus der TV-Vorschau ist der Standard"


@pytest.mark.asyncio
async def test_only_admins_with_the_tournaments_area_may_save(flow):
    flow.act_as(None)
    assert (await flow.put("/api/tv/settings", json={"contrast": True})).status_code == 401
    for role in ("player", "moderator"):
        flow.act_as(await flow.add_user(role=role))
        assert (await flow.put("/api/tv/settings", json={"contrast": True})).status_code == 403, role
        assert (await flow.delete("/api/tv/settings")).status_code == 403, role
    editor = await flow.add_user(role="player", name="Redaktion")
    flow.act_as({**editor, "areas": ["content"]})
    assert (await flow.put("/api/tv/settings", json={"contrast": True})).status_code == 403, "Redaktion ist nicht Turniere"
    without_mfa = await flow.add_user(role="tournament_admin")
    flow.act_as({**without_mfa, "auth_mfa_verified": False})
    assert (await flow.put("/api/tv/settings", json={"contrast": True})).status_code == 403, "Adminbereich nur mit Zwei-Faktor"
    flow.act_as(None)
    assert (await flow.get("/api/tv/settings")).json()["settings"] == DEFAULTS

    leader = await flow.add_user(role="tournament_admin")
    flow.act_as(leader)
    saved = await flow.put("/api/tv/settings", json={"text_size": "large", "contrast": True, "safe_area": 5, "pixel_shift": False,
                                                     "season_header": False, "reduce_motion": True, "result_sound": True})
    assert saved.status_code == 200, saved.text
    expected = {"text_size": "large", "contrast": True, "safe_area": 5, "pixel_shift": False, "season_header": False, "reduce_motion": True,
                "result_sound": True}
    assert saved.json()["settings"] == expected
    flow.act_as(None)
    assert (await flow.get("/api/tv/settings")).json()["settings"] == expected, "die Bildschirme lesen ohne Anmeldung"
    audit = await flow.db.audit_logs.find_one({"action": "settings.tv.update"}, {"_id": 0})
    assert audit["actor_id"] == leader["id"] and audit["data"]["changed_fields"] == sorted(expected)

    granted = await flow.add_user(role="player", name="Freigabe Turniere")
    flow.act_as({**granted, "areas": ["tournaments"]})
    assert (await flow.put("/api/tv/settings", json={"text_size": "normal"})).status_code == 200, "Freigabe für den Bereich Turniere reicht"


@pytest.mark.asyncio
async def test_wrong_values_are_refused_and_change_nothing(flow):
    flow.act_as(await flow.add_user(role="tournament_admin"))
    for body in ({"safe_area": 4}, {"safe_area": "3"}, {"safe_area": True}, {"text_size": "huge"}, {"contrast": "ja"},
                 {"pixel_shift": 1}, {"result_sound": "an"}, {"result_sound": 1}, {"blinken": True}, {"settings": {"contrast": True}}):
        response = await flow.put("/api/tv/settings", json=body)
        assert response.status_code == 422, (body, response.text)
    assert (await flow.get("/api/tv/settings")).json()["settings"] == DEFAULTS
    assert await flow.db.settings.find_one({"id": tv_display.SETTINGS_ID}) is None


@pytest.mark.asyncio
async def test_missing_or_broken_stored_values_count_as_the_default(flow):
    await flow.db.settings.insert_one({"id": tv_display.SETTINGS_ID, "text_size": "large", "safe_area": "5", "contrast": 1,
                                       "pixel_shift": None, "season_header": False, "unbekannt": "x"})
    flow.act_as(None)
    settings = (await flow.get("/api/tv/settings")).json()["settings"]
    assert settings == {**DEFAULTS, "text_size": "large", "season_header": False}


@pytest.mark.asyncio
async def test_sound_at_the_result_is_off_by_default_and_only_on_when_switched_on(flow):
    """Ton beim Ergebnis (#1118): Fabians Wahl ist „ohne Ton“ - nur ein ausdrückliches An schaltet den Gong ein."""
    assert tv_display.DEFAULTS["result_sound"] is False
    flow.act_as(None)
    assert (await flow.get("/api/tv/settings")).json()["settings"]["result_sound"] is False
    await flow.db.settings.insert_one({"id": tv_display.SETTINGS_ID, "result_sound": "ja"})
    assert (await flow.get("/api/tv/settings")).json()["settings"]["result_sound"] is False, "nur ein echtes An zählt"
    await flow.db.settings.delete_one({"id": tv_display.SETTINGS_ID})

    flow.act_as(await flow.add_user(role="tournament_admin"))
    turned_on = await flow.put("/api/tv/settings", json={"result_sound": True})
    assert turned_on.status_code == 200, turned_on.text
    assert turned_on.json()["settings"] == {**DEFAULTS, "result_sound": True}
    flow.act_as(None)
    assert (await flow.get("/api/tv/settings")).json()["settings"]["result_sound"] is True, "die Bildschirme lesen es ohne Anmeldung"
    flow.act_as(await flow.add_user(role="tournament_admin"))
    assert (await flow.put("/api/tv/settings", json={"result_sound": None})).json()["settings"]["result_sound"] is False, "null = Standard"


@pytest.mark.asyncio
async def test_null_resets_one_value_and_delete_resets_everything(flow):
    flow.act_as(await flow.add_user(role="club_admin"))
    await flow.put("/api/tv/settings", json={"contrast": True, "safe_area": 3})
    assert (await flow.put("/api/tv/settings", json={"contrast": None})).json()["settings"] == {**DEFAULTS, "safe_area": 3}
    stored = await flow.db.settings.find_one({"id": tv_display.SETTINGS_ID}, {"_id": 0})
    assert "contrast" not in stored
    reset = await flow.delete("/api/tv/settings")
    assert reset.status_code == 200 and reset.json()["settings"] == DEFAULTS
    assert await flow.db.settings.find_one({"id": tv_display.SETTINGS_ID}) is None


def test_a_change_under_tv_reaches_screens_without_login_and_names_nothing_else():
    for path in ("/api/tv/settings", "/api/tv/keys/key-secret-id"):
        event = change_events._build_api_change_event("PUT", path, 200)
        public = change_events._event_for_scope(event, "public")
        assert public["resource"] == "tv" and public["path"] == "/api/tv"
        assert "key-secret-id" not in json.dumps(public)


# ---------------------------------------------------------------- Anzeige-Schlüssel

@pytest.mark.asyncio
async def test_a_display_key_opens_the_tv_without_login_and_only_with_tv_data(flow):
    _staff, tournament, users, _registrations = await bracket_of(flow, 4, is_public=False, visibility="members")
    created = await new_key(flow, tournament, "  Beamer   Halle  ")
    token = created["token"]
    assert created["path"] == f"/display/bracket/{tournament['id']}?key={token}"
    assert created["label"] == "Beamer Halle" and created["tournament_title"] == tournament["title"]
    stored = await flow.db.access_links.find_one({"id": created["id"]}, {"_id": 0})
    assert stored["token_hash"] == hash_access_token(token) and token not in json.dumps(stored), "gespeichert wird nur der Hash"
    assert stored["grants"] == ["display"] and stored["target_id"] == tournament["id"]

    flow.act_as(None)
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/bracket/display")).status_code == 401, "ohne Schlüssel nur mit Anmeldung"
    response = await show_tv(flow, tournament["id"], token)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["tournament"]["id"] == tournament["id"] and body["tournament"]["title"] == tournament["title"]
    assert len(body["matches_v2"]) == 3
    assert {reg["display_name"] for reg in body["registrations"]} == {f"Spieler {index}" for index in range(1, 5)}
    text = json.dumps(body)
    assert token not in text, "der Schlüssel steht in keiner Antwort"
    assert "user_id" not in text and "email" not in text and '"user"' not in text, "keine Konten am TV"
    for user in users:
        assert user["id"] not in text and user["email"] not in text
    # Über den Slug geht es genauso - es zählt das Turnier, nicht die Schreibweise.
    assert (await show_tv(flow, tournament["slug"], token)).status_code == 200
    seen = await flow.db.access_links.find_one({"id": created["id"]}, {"_id": 0})
    assert seen.get("last_used_at"), "der Admin sieht, wann der Bildschirm zuletzt da war"

    # Live-Spotlight und Ergebnis-Moment (#1116, #1118): Startzeit und Zeit des Ergebnisses kommen mit - sonst nichts Neues.
    started = "2026-10-10T12:20:00+00:00"
    await flow.db.matches_v2.update_one({"id": body["matches_v2"][0]["id"]}, {"$set": {"status": "running", "started_at": started, "internal_note": "geheim"}})
    shown = (await show_tv(flow, tournament["id"], token)).json()["matches_v2"]
    live = next(row for row in shown if row["id"] == body["matches_v2"][0]["id"])
    assert live["started_at"] == started and live["status"] == "running"
    assert "internal_note" not in live

    # Der Schlüssel ist kein Speziallink zum Ansehen: die Turnierseite und der öffentliche Baum bleiben zu.
    assert (await flow.get(f"/api/tournaments/{tournament['slug']}", params={"access": token})).status_code in {403, 404}
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/bracket", params={"access": token})).status_code in {403, 404}


@pytest.mark.asyncio
async def test_a_revoked_key_opens_nothing_any_more(flow):
    staff, tournament, _users, _registrations = await bracket_of(flow, 4)
    created = await new_key(flow, tournament)
    flow.act_as(None)
    assert (await show_tv(flow, tournament["id"], created["token"])).status_code == 200

    flow.act_as(staff)
    assert (await flow.delete(f"/api/tv/keys/{created['id']}")).status_code == 200
    assert (await flow.get("/api/tv/keys")).json() == [], "widerrufene Schlüssel stehen nicht mehr in der Liste"
    flow.act_as(None)
    refused = await show_tv(flow, tournament["id"], created["token"])
    assert refused.status_code == 403 and refused.json()["detail"] == tv_display.KEY_INVALID
    flow.act_as(staff)
    assert (await show_tv(flow, tournament["id"], created["token"])).status_code == 403, "steht ein Schlüssel im Link, zählt nur er"
    assert (await show_tv(flow, tournament["id"], "erfunden")).status_code == 403
    assert (await flow.delete("/api/tv/keys/gibt-es-nicht")).status_code == 404


def test_a_key_ends_one_week_after_the_end_or_else_the_start():
    end = {"start_date": "2026-10-09T10:00:00+00:00", "end_date": "2026-10-10T18:00:00+00:00"}
    assert tv_display.key_expires_at(end).isoformat() == "2026-10-17T18:00:00+00:00"
    assert tv_display.key_expires_at({"start_date": "2026-10-09T10:00:00+00:00"}).isoformat() == "2026-10-16T10:00:00+00:00"
    assert tv_display.key_expires_at({}) is None, "ohne Termin gilt der Schlüssel bis zum Widerruf"
    assert tv_display.key_expired(end, datetime(2026, 10, 17, 18, 1, tzinfo=timezone.utc))
    assert not tv_display.key_expired(end, datetime(2026, 10, 17, 17, 59, tzinfo=timezone.utc))


@pytest.mark.asyncio
async def test_an_expired_key_opens_nothing_and_the_list_says_so(flow):
    staff, tournament, _users, _registrations = await bracket_of(flow, 4)
    created = await new_key(flow, tournament)
    flow.act_as(None)
    # Turnier vor sechs Tagen zu Ende: der Schlüssel gilt noch. Vor acht Tagen: abgelaufen.
    for days, status in ((6, 200), (8, 403)):
        end = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"end_date": end}})
        response = await show_tv(flow, tournament["id"], created["token"])
        assert response.status_code == status, (days, response.text)
    assert response.json()["detail"] == tv_display.KEY_EXPIRED
    flow.act_as(staff)
    row = (await flow.get("/api/tv/keys")).json()[0]
    assert row["expired"] is True and row["expires_at"]
    # Wird das Turnier verschoben, wandert das Ende mit - der Schlüssel gilt wieder.
    later = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"end_date": later}})
    flow.act_as(None)
    assert (await show_tv(flow, tournament["id"], created["token"])).status_code == 200


@pytest.mark.asyncio
async def test_a_key_for_one_tournament_never_opens_another(flow):
    staff, first, _users, _registrations = await bracket_of(flow, 4)
    second, _more_users, _more = await flow.with_participants(4)
    assert (await flow.post(f"/api/tournaments/{second['id']}/bracket/from-format?preview=false")).status_code == 200
    key_first = await new_key(flow, first)
    flow.act_as(None)
    assert (await show_tv(flow, first["id"], key_first["token"])).status_code == 200
    assert (await show_tv(flow, second["id"], key_first["token"])).status_code == 403
    assert (await show_tv(flow, second["slug"], key_first["token"])).status_code == 403


@pytest.mark.asyncio
async def test_a_display_key_allows_no_write_anywhere(flow):
    staff, tournament, users, registrations = await bracket_of(flow, 4, is_public=False)
    created = await new_key(flow, tournament)
    token = created["token"]
    match = next(row for row in await flow.matches(tournament) if all(slot.get("registration_id") for slot in row["slots"]))
    before_matches = await flow.matches(tournament)
    before_registrations = await flow.db.tournament_registrations.count_documents({"tournament_id": tournament["id"]})
    ranking = [{"registration_id": match["slots"][0]["registration_id"], "rank": 1, "score": 2},
               {"registration_id": match["slots"][1]["registration_id"], "rank": 2, "score": 0}]

    flow.act_as(None)
    with_key = {"key": token, "access": token}
    attempts = [
        ("post", f"/api/tournaments/{tournament['id']}/bracket/from-format", {"params": {**with_key, "preview": "false"}}),
        ("post", f"/api/tournaments/{tournament['id']}/register", {"params": with_key, "json": {"accept_rules": True, "accept_privacy": True}}),
        ("post", f"/api/matches/{match['id']}/result", {"params": with_key, "json": {"results": ranking}}),
        ("put", "/api/tv/settings", {"params": with_key, "json": {"contrast": True}}),
        ("post", "/api/tv/keys", {"params": with_key, "json": {"tournament_id": tournament["id"]}}),
        ("delete", f"/api/tv/keys/{created['id']}", {"params": with_key}),
        ("get", "/api/tv/keys", {"params": with_key}),
    ]
    for method, url, kwargs in attempts:
        response = await getattr(flow, method)(url, **kwargs)
        assert response.status_code == 401, (method, url, response.status_code)

    # Angemeldet, aber ohne Rechte: der Schlüssel als Speziallink hilft beim Anmelden und Melden nicht.
    stranger = await flow.add_user(role="player", name="Spieler Fremd")
    flow.act_as(stranger)
    register = await flow.post(f"/api/tournaments/{tournament['id']}/register", params={"access": token},
                               json={"accept_rules": True, "accept_privacy": True})
    assert register.status_code in {403, 404}, register.text
    report = await flow.post(f"/api/matches/{match['id']}/result", params=with_key, json={"results": ranking})
    assert report.status_code in {403, 404}, report.text
    assert (await flow.put("/api/tv/settings", params=with_key, json={"contrast": True})).status_code == 403

    assert await flow.matches(tournament) == before_matches, "kein Spiel hat sich verändert"
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": tournament["id"]}) == before_registrations
    assert (await flow.db.access_links.find_one({"id": created["id"]}, {"_id": 0}))["is_active"] is True
    assert await flow.db.settings.find_one({"id": tv_display.SETTINGS_ID}) is None


@pytest.mark.asyncio
async def test_keys_are_listed_without_the_secret_and_only_under_tv(flow):
    staff, tournament, _users, _registrations = await bracket_of(flow, 4)
    created = await new_key(flow, tournament, "Fernseher Bar")
    view_link = await flow.post("/api/access-links", json={"target_type": "tournament", "target_id": tournament["id"], "grants": ["view"]})
    assert view_link.status_code == 200, view_link.text

    listed = (await flow.get("/api/tv/keys", params={"tournament_id": tournament["id"]})).json()
    assert [row["id"] for row in listed] == [created["id"]]
    assert listed[0]["label"] == "Fernseher Bar" and listed[0]["tournament_title"] == tournament["title"]
    assert "token" not in json.dumps(listed) and created["token"] not in json.dumps(listed)
    general = (await flow.get("/api/access-links", params={"target_type": "tournament", "target_id": tournament["id"]})).json()
    assert [row["id"] for row in general] == [view_link.json()["id"]], "TV-Schlüssel wohnen nur unter TV & Beamer"
    # Die allgemeinen Speziallinks können keinen TV-Schlüssel anlegen, und TV & Beamer widerruft keinen anderen Link.
    refused = await flow.post("/api/access-links", json={"target_type": "tournament", "target_id": tournament["id"], "grants": ["display"]})
    assert refused.status_code == 422
    assert (await flow.delete(f"/api/tv/keys/{view_link.json()['id']}")).status_code == 404
    assert (await flow.post("/api/tv/keys", json={"tournament_id": "gibt-es-nicht"})).status_code == 404

    for role in ("player", "moderator"):
        flow.act_as(await flow.add_user(role=role))
        assert (await flow.get("/api/tv/keys")).status_code == 403, role
        assert (await flow.post("/api/tv/keys", json={"tournament_id": tournament["id"]})).status_code == 403, role
        assert (await flow.delete(f"/api/tv/keys/{created['id']}")).status_code == 403, role
