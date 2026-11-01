"""Profil und öffentliche Daten (#2126): was Fremde nicht sehen, was die Person selbst pflegt - und dass alte Konten erreichbar bleiben.

Namen und Werte sind erfunden.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def player(flow, name, **fields):
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"privacy_public_profile": True, "is_active": True, **fields}})
    user.update(fields)
    return user


async def club_admin(flow, name="vereinsleitung"):
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": ["club"]}})
    return {**user, "areas": ["club"]}


def no_role_anywhere(value, path="antwort"):
    """Sucht in der ganzen Antwort: `role` an einer Person darf nirgends mehr stehen."""
    if isinstance(value, dict):
        assert "role" not in value and "roles" not in value and "internal_role" not in value, path
        for key, item in value.items():
            no_role_anywhere(item, f"{path}.{key}")
    elif isinstance(value, list):
        for item in value:
            no_role_anywhere(item, path)


# ---------------------------------------------------------------- PR5, MG10: keine Rollen nach außen
@pytest.mark.asyncio
async def test_public_views_name_no_system_or_internal_role(flow):
    boss = await player(flow, "chefin")
    await flow.db.users.update_one({"id": boss["id"]}, {"$set": {"role": "superadmin"}})
    await flow.db.memberships.insert_one({"id": "m-1", "user_id": boss["id"], "member_status": "active", "membership_type": "ordinary", "internal_role": "Kassa-Prüfung"})
    await flow.db.teams.insert_one({"id": "t-1", "name": "Rudel", "tag": "RDL", "member_ids": [boss["id"]], "leader_id": boss["id"], "join_code": "geheim-123", "description": "Wir"})
    flow.act_as(None)
    profile = await flow.get("/api/users/public/chefin")
    assert profile.status_code == 200
    no_role_anywhere(profile.json())
    assert "geheim-123" not in profile.text and profile.json()["teams"] == [{"id": "t-1", "name": "Rudel", "tag": "RDL", "description": "Wir"}]
    no_role_anywhere((await flow.get("/api/users/public-list")).json())
    no_role_anywhere((await flow.get("/api/membership/public")).json())


@pytest.mark.asyncio
async def test_friends_and_direct_messages_name_no_system_role(flow):
    boss = await player(flow, "chefin")
    await flow.db.users.update_one({"id": boss["id"]}, {"$set": {"role": "superadmin"}})
    fan = await player(flow, "fan")
    flow.act_as(fan)
    asked = await flow.post(f"/api/friends/{boss['id']}/request")
    assert asked.status_code == 200, asked.text
    no_role_anywhere(asked.json())
    no_role_anywhere((await flow.get("/api/friends")).json())
    sent = await flow.post(f"/api/messages/direct/{boss['id']}", json={"message": "Servus"})
    assert sent.status_code == 200, sent.text
    no_role_anywhere(sent.json())
    no_role_anywhere((await flow.get("/api/messages/conversations")).json())


# ---------------------------------------------------------------- PR2, PR3: Felder und ihre Stufen
@pytest.mark.asyncio
async def test_preferred_role_shows_only_with_a_chosen_level(flow):
    hidden = await player(flow, "ohne-stufe", preferred_role="IGL")
    await player(flow, "mit-stufe", preferred_role="Support", profile_visibility={"preferred_role": "public"})
    await player(flow, "nur-community", preferred_role="Driver", profile_visibility={"preferred_role": "community"})
    flow.act_as(None)
    assert (await flow.get("/api/users/public/ohne-stufe")).json()["preferred_role"] is None
    assert (await flow.get("/api/users/public/mit-stufe")).json()["preferred_role"] == "Support"
    assert (await flow.get("/api/users/public/nur-community")).json()["preferred_role"] is None
    flow.act_as(hidden)
    assert (await flow.get("/api/users/public/ohne-stufe")).json()["preferred_role"] == "IGL"
    assert (await flow.get("/api/users/public/ohne-stufe", params={"view_as": "public"})).json()["preferred_role"] is None
    assert (await flow.get("/api/users/public/nur-community")).json()["preferred_role"] == "Driver"


@pytest.mark.asyncio
async def test_website_subscriptions_and_platforms_follow_their_level(flow):
    await player(flow, "verschlossen", website="https://example.org", gaming_subscriptions=["ea_play"], main_platform="PC", main_platforms=["PC"],
                 profile_visibility={"website": "private", "gaming_subscriptions": "members", "main_platforms": "private"})
    await player(flow, "offen", website="https://example.org", gaming_subscriptions=["ea_play"], main_platform="PC", main_platforms=["PC"])
    flow.act_as(None)
    closed = (await flow.get("/api/users/public/verschlossen")).json()
    assert closed["website"] is None and closed["gaming_subscriptions"] is None
    assert closed["main_platforms"] == [] and closed["main_platform"] is None
    shown = (await flow.get("/api/users/public/offen")).json()
    assert shown["website"] == "https://example.org" and shown["gaming_subscriptions"] == ["ea_play"] and shown["main_platform"] == "PC"


# ---------------------------------------------------------------- PR4: „Erfolge öffentlich“ aus, auch auf anderen Wegen
@pytest.mark.asyncio
async def test_hidden_achievements_also_leave_season_table_and_crowns(flow):
    from services import crown_events, season_service

    shy = await player(flow, "zurueckhaltend", privacy_achievements_public=False)
    proud = await player(flow, "stolz")
    await flow.db.achievements.insert_one({"code": "tier-1", "name": "Erfolg", "level": 1, "points": 500})
    for user in (shy, proud):
        await flow.db.user_achievements.insert_one({"user_id": user["id"], "tier_code": "tier-1", "level": 1, "earned_at": "2026-10-01T10:00:00+00:00"})

    summaries = await season_service._achievement_summaries(flow.db, [shy["id"], proud["id"]])
    assert summaries[shy["id"]] == {"achievement_count": 0, "achievement_points": 0}
    assert summaries[proud["id"]] == {"achievement_count": 1, "achievement_points": 500}

    crowns = await crown_events.get_crowns(force=True)
    assert shy["id"] not in crowns and crowns[proud["id"]] == "gold"


# ---------------------------------------------------------------- PR6: Längen und leerer Name
@pytest.mark.asyncio
async def test_new_profile_texts_have_limits_and_a_name_stays_filled(flow):
    user = await player(flow, "schreiber", display_name="Schreiber", bio="kurz")
    flow.act_as(user)
    empty = await flow.patch("/api/users/me", json={"display_name": "   "})
    assert empty.status_code == 422 and "Anzeigenamen" in empty.json()["detail"]
    assert (await flow.patch("/api/users/me", json={"display_name": None})).status_code == 422
    too_long = await flow.patch("/api/users/me", json={"display_name": "x" * 51})
    assert too_long.status_code == 422 and too_long.json()["detail"] == "Anzeigename: höchstens 50 Zeichen."
    assert (await flow.patch("/api/users/me", json={"bio": "x" * 1001})).json()["detail"] == "Bio: höchstens 1000 Zeichen."
    saved = await flow.patch("/api/users/me", json={"display_name": "  Neuer Name ", "bio": "x" * 1000})
    assert saved.status_code == 200 and saved.json()["display_name"] == "Neuer Name"
    assert (await flow.patch("/api/users/me", json={"bio": ""})).status_code == 200


@pytest.mark.asyncio
async def test_old_long_or_empty_values_can_be_saved_unchanged(flow):
    long_name, long_bio = "n" * 80, "b" * 3000
    user = await player(flow, "altkonto", display_name=long_name, bio=long_bio)
    flow.act_as({**user, "display_name": long_name, "bio": long_bio})
    same = await flow.patch("/api/users/me", json={"display_name": long_name, "bio": long_bio, "city": "Innsbruck"})
    assert same.status_code == 200 and same.json()["display_name"] == long_name and same.json()["city"] == "Innsbruck"
    assert (await flow.patch("/api/users/me", json={"bio": long_bio + "!"})).status_code == 422

    # Vom Verein zurückgesetzt (#2118): der leere Name hindert nicht am Speichern anderer Felder.
    reset = await player(flow, "zurueckgesetzt", display_name=None)
    flow.act_as({**reset, "display_name": None})
    assert (await flow.patch("/api/users/me", json={"display_name": "", "city": "Wien"})).status_code == 200


# ---------------------------------------------------------------- PR12: Benutzername
@pytest.mark.parametrize("name", ["ab", "x" * 33, "mit leerzeichen", "a/b", "a#b", "Jörg", "a?b", "a%b"])
def test_new_usernames_follow_the_rule(name):
    from pydantic import ValidationError
    from models import AdminUserCreate, UserRegister

    with pytest.raises(ValidationError) as admin:
        AdminUserCreate(username=name, email="neu@verein-beispiel.at")
    assert [error["loc"] for error in admin.value.errors()] == [("username",)]
    with pytest.raises(ValidationError) as public:
        UserRegister(username=name, email="neu@verein-beispiel.at", password="Lange-Passphrase-2026!", accept_privacy=True, accept_terms=True)
    assert [error["loc"] for error in public.value.errors()] == [("username",)]


@pytest.mark.parametrize("name", ["abc", "x" * 32, "Max_Mustermann", "a.b-c_1"])
def test_good_usernames_pass_and_are_trimmed(name):
    from models import AdminUserCreate

    assert AdminUserCreate(username=f"  {name} ", email="neu@verein-beispiel.at").username == name


@pytest.mark.asyncio
async def test_refused_username_says_why_in_german(flow):
    flow.act_as(await flow.add_user(role="superadmin", name="chefin"))
    refused = await flow.post("/api/users", json={"username": "mit leerzeichen", "email": "neu@verein-beispiel.at"})
    assert refused.status_code == 422
    assert refused.json()["detail"][0]["msg"] == "Benutzername: 3 bis 32 Zeichen, nur Buchstaben ohne Umlaute, Ziffern und _ . - (keine Leerzeichen)."


@pytest.mark.asyncio
async def test_a_name_counts_as_taken_in_any_spelling(flow):
    await player(flow, "MaxMuster")
    flow.act_as(await flow.add_user(role="superadmin", name="chefin"))
    taken = await flow.post("/api/users", json={"username": "maxmuster", "email": "neu@verein-beispiel.at"})
    assert taken.status_code == 409 and taken.json()["detail"] == "Benutzername oder E-Mail bereits vergeben"


@pytest.mark.asyncio
async def test_old_names_stay_reachable_in_every_spelling(flow):
    for name in ("Max", "max", "Alte Schule", "a/b", "wer#da", "was?nun", "100%"):
        await player(flow, name)
    flow.act_as(None)
    # Exakt gewinnt: beide Doppelten behalten ihr eigenes Profil.
    assert (await flow.get("/api/users/public/Max")).json()["username"] == "Max"
    assert (await flow.get("/api/users/public/max")).json()["username"] == "max"
    assert (await flow.get("/api/users/public/MAX")).status_code == 200
    # Andere Schreibweise eines Einzelnen und kodierte Sonderzeichen.
    assert (await flow.get("/api/users/public/alte%20schule")).json()["username"] == "Alte Schule"
    for name, encoded in (("a/b", "a%2Fb"), ("wer#da", "wer%23da"), ("was?nun", "was%3Fnun"), ("100%", "100%25")):
        shown = await flow.get(f"/api/users/public/{encoded}")
        assert shown.status_code == 200 and shown.json()["username"] == name, name
    assert (await flow.get("/api/users/public/gibt-es-nicht")).status_code == 404


@pytest.mark.asyncio
async def test_case_lookup_treats_a_name_as_text_not_as_a_pattern(flow):
    await player(flow, "abc")
    flow.act_as(None)
    assert (await flow.get("/api/users/public/a.c")).status_code == 404
    assert (await flow.get("/api/users/public/.*")).status_code == 404


def test_google_names_become_valid_usernames():
    from services.usernames import username_from_name, username_problem

    assert username_from_name("Jörg Müller") == "Jorg_Muller"
    assert username_from_name("Straße") == "Strasse"
    assert username_from_name("李") == "player" and username_from_name(None) == "player" and username_from_name("Al") == "player"
    for name in ("Jörg Müller", "x" * 90, "a/b#c d", "   ", "__..__"):
        assert username_problem(username_from_name(name)) is None, name


@pytest.mark.asyncio
async def test_google_login_finds_a_free_name_in_any_spelling(flow):
    from routes.auth_routes import _unique_username

    await player(flow, "Paula_Pixel")
    assert await _unique_username(flow.db, "paula pixel") == "paula_pixel1"


def test_profile_links_are_encoded_only_where_needed():
    from services.usernames import profile_path

    assert profile_path("Max_M.-1") == "/u/Max_M.-1"
    assert profile_path("a/b c#") == "/u/a%2Fb%20c%23"


# ---------------------------------------------------------------- Review: Teams
@pytest.mark.asyncio
async def test_private_team_stays_off_the_public_profile(flow):
    user = await player(flow, "spielerin")
    await flow.db.teams.insert_many([
        {"id": "t-geheim", "name": "Geheimteam", "tag": "GEH", "member_ids": [user["id"]], "leader_id": user["id"], "is_public": False},
        {"id": "t-offen", "name": "Offenes Team", "tag": "OFF", "member_ids": [user["id"]], "leader_id": user["id"]},
    ])
    flow.act_as(None)
    assert [team["id"] for team in (await flow.get("/api/users/public/spielerin")).json()["teams"]] == ["t-offen"]


@pytest.mark.asyncio
async def test_my_teams_shows_the_code_only_to_those_who_manage(flow):
    boss = await player(flow, "chefin")
    member = await player(flow, "mitglied")
    await flow.db.teams.insert_one({"id": "t-1", "name": "Rudel", "tag": "RDL", "member_ids": [boss["id"], member["id"]], "leader_id": boss["id"], "join_code": "geheim-123"})
    flow.act_as(member)
    assert "join_code" not in (await flow.get("/api/teams/my")).json()[0]
    flow.act_as(boss)
    assert (await flow.get("/api/teams/my")).json()[0]["join_code"] == "geheim-123"


@pytest.mark.asyncio
async def test_joining_needs_a_real_code(flow):
    boss = await player(flow, "chefin")
    guest = await player(flow, "gast")
    await flow.db.teams.insert_many([
        {"id": "t-ohne", "name": "Ohne Code", "tag": "OHN", "member_ids": [boss["id"]], "leader_id": boss["id"]},
        {"id": "t-mit", "name": "Mit Code", "tag": "MIT", "member_ids": [boss["id"]], "leader_id": boss["id"], "join_code": "richtig-1"},
    ])
    flow.act_as(guest)
    for body in ({}, {"join_code": None}, {"join_code": ""}):
        assert (await flow.post("/api/teams/t-ohne/join", json=body)).status_code == 403, body
    assert (await flow.post("/api/teams/t-mit/join", json={})).status_code == 403
    assert (await flow.post("/api/teams/t-mit/join", json={"join_code": "falsch"})).status_code == 403
    assert (await flow.post("/api/teams/t-mit/join", json={"join_code": "richtig-1"})).status_code == 200


@pytest.mark.asyncio
async def test_search_links_players_to_their_encoded_profile(flow):
    from routes import search_routes

    await player(flow, "alte schule")
    await player(flow, "neonfalke")
    rows = await search_routes._search_players(flow.db, "(alte|neon)", 5)
    assert {row["url"] for row in rows} == {"/u/alte%20schule", "/u/neonfalke"}


# ---------------------------------------------------------------- Review: Wortfilter beim Anlegen
async def block_word(flow, word="schimpfwort"):
    from services import word_filter

    await word_filter.save_config(flow.db, enabled=True, entries=[word_filter.clean_entry(word, "hold")])


@pytest.mark.asyncio
async def test_app_registration_uses_the_word_filter(flow, monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "nur-fuer-tests-" + "x" * 40)
    await block_word(flow)
    flow.act_as(None)
    body = {"email": "neu@verein-beispiel.at", "password": "Lange-Passphrase-2026!", "accept_privacy": True, "accept_terms": True}
    refused = await flow.post("/api/auth/mobile/register", json={**body, "username": "schimpfwort"})
    assert refused.status_code == 400 and "Benutzername" in refused.json()["detail"]
    assert await flow.db.users.find_one({"email": "neu@verein-beispiel.at"}) is None
    assert (await flow.db.moderation_items.find_one({"kind": "username"}))["state"] == "rejected"
    fine = await flow.post("/api/auth/mobile/register", json={**body, "username": "neonfalke"})
    assert fine.status_code == 200, fine.text
    assert (await flow.db.users.find_one({"username": "neonfalke"}))["id"]


@pytest.mark.asyncio
async def test_google_name_with_a_blocked_word_gets_a_neutral_name(flow):
    from routes.auth_routes import _google_names

    await block_word(flow)
    assert await _google_names(flow.db, "Paula Pixel", "p@verein-beispiel.at") == ("Paula_Pixel", "Paula Pixel")
    assert await _google_names(flow.db, "Schimpfwort Meier", "p@verein-beispiel.at") == ("player", "player")
    assert await _google_names(flow.db, None, "schimpfwort@verein-beispiel.at") == ("player", "player")


# ---------------------------------------------------------------- Review: Vollständigkeit nur für sich selbst
@pytest.mark.asyncio
async def test_profile_completeness_is_only_for_the_person(flow):
    user = await player(flow, "versteckt", privacy_public_profile=False)
    flow.act_as(None)
    assert (await flow.get(f"/api/users/{user['id']}/profile-completeness")).status_code == 404
    flow.act_as(user)
    assert (await flow.get("/api/users/me/profile-completeness")).status_code == 200


# ---------------------------------------------------------------- Review: Kronen-Meldungen
@pytest.mark.asyncio
async def test_switching_achievements_back_and_forth_does_not_flood_with_crown_notices(flow):
    from services import crown_events

    people = [await player(flow, f"krone{i}") for i in range(4)]
    await flow.db.achievements.insert_many([{"code": f"t{i}", "name": "E", "level": 1, "points": 1000 - i * 100} for i in range(4)])
    for i, user in enumerate(people):
        await flow.db.user_achievements.insert_one({"user_id": user["id"], "tier_code": f"t{i}", "level": 1, "earned_at": "2026-10-01T10:00:00+00:00"})
    await crown_events.get_crowns(force=True)
    for _ in range(3):
        await flow.db.users.update_one({"id": people[0]["id"]}, {"$set": {"privacy_achievements_public": False}})
        await crown_events.get_crowns(force=True)
        await flow.db.users.update_one({"id": people[0]["id"]}, {"$set": {"privacy_achievements_public": True}})
        await crown_events.get_crowns(force=True)
    rows = await flow.db.notifications.find({"kind": {"$regex": "^crown"}}, {"_id": 0, "user_id": 1, "kind": 1, "body": 1}).to_list(200)
    seen = [(row["user_id"], row["kind"]) for row in rows]
    assert len(seen) == len(set(seen)), "höchstens eine Meldung je Person und Art"
    assert (people[0]["id"], "crown_lost") not in seen, "wer selbst ausschaltet, hat nichts verloren"
    displaced = next(row for row in rows if row["kind"] == "crown_lost")
    assert displaced["user_id"] == people[3]["id"] and "anderen Spieler" not in displaced["body"]


# ---------------------------------------------------------------- Review: Leerzeichen, bevorzugte Rolle
@pytest.mark.asyncio
async def test_spaces_around_changed_texts_are_removed(flow):
    user = await player(flow, "polster", display_name="Polster", bio="kurz")
    flow.act_as(user)
    saved = await flow.patch("/api/users/me", json={"bio": "x" + " " * 200000, "display_name": "  Neu  "})
    assert saved.status_code == 200 and saved.json()["bio"] == "x" and saved.json()["display_name"] == "Neu"

    # Ein gespeicherter alter Wert bleibt, wie er ist, solange er sich nicht ändert.
    old = await player(flow, "altpolster", bio="  alt  ")
    flow.act_as(old)
    assert (await flow.patch("/api/users/me", json={"bio": "  alt  "})).json()["bio"] == "  alt  "


@pytest.mark.asyncio
async def test_preferred_role_has_a_limit_and_passes_the_word_filter(flow):
    from services import word_filter

    await word_filter.save_config(flow.db, enabled=True, entries=[word_filter.clean_entry("schimpfwort", "hold")])
    user = await player(flow, "freitext", display_name="Freitext")
    flow.act_as(user)
    too_long = await flow.patch("/api/users/me", json={"preferred_role": "y" * 41})
    assert too_long.status_code == 422 and too_long.json()["detail"] == "Bevorzugte Rolle: höchstens 40 Zeichen."
    assert (await flow.patch("/api/users/me", json={"preferred_role": "y" * 40})).status_code == 200
    blocked = await flow.patch("/api/users/me", json={"preferred_role": "schimpfwort"})
    assert blocked.status_code == 400 and "Bevorzugte Rolle" in blocked.json()["detail"]

    old = await player(flow, "altrolle", display_name="Alt", preferred_role="z" * 60)
    flow.act_as(old)
    assert (await flow.patch("/api/users/me", json={"preferred_role": "z" * 60, "city": "Wien"})).status_code == 200


# ---------------------------------------------------------------- Zusatz: Dokumente
@pytest.mark.asyncio
async def test_members_never_see_where_a_document_is_stored(flow):
    await flow.db.documents.insert_one({"id": "d-1", "title": "Statuten", "category": "statutes", "visibility": "members",
                                        "storage_key": "ablage-1.pdf", "created_at": "2026-09-01T10:00:00+00:00"})
    member = await player(flow, "mitglied", is_club_member=True)
    flow.act_as(member)
    for url in ("/api/documents", "/api/documents?scope=club"):
        rows = (await flow.get(url)).json()
        assert [row["id"] for row in rows] == ["d-1"]
        assert "storage_key" not in rows[0] and rows[0]["view_url"] == "/api/documents/d-1/view"

    flow.act_as(await club_admin(flow))
    assert (await flow.get("/api/documents/admin")).json()[0]["storage_key"] == "ablage-1.pdf"
    changed = await flow.patch("/api/documents/d-1", json={"title": "Statuten 2026"})
    assert changed.status_code == 200 and changed.json()["storage_key"] == "ablage-1.pdf"
