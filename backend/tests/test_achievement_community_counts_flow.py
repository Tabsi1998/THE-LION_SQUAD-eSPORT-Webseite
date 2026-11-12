"""Erfolge sauber zählen (#2338): Chat, Discord, Verein und Profil - je Fund ein Ablauf gegen die echten Zähler."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import achievement_counters as counters  # noqa: E402
from services import achievement_progress  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def stamp(day: str, hour: int, minute: int = 0) -> str:
    return f"{day}T{hour:02d}:{minute:02d}:00+00:00"


# ---------------------------------------------------------------- Chat (H3, H4)

@pytest.mark.asyncio
async def test_plauderer_has_one_definition_whatever_source_triggers_it(flow):
    """H3: früher rechnete die Registry „Turnier- und Match-Chat“, der alte Block „alle Chats“ - der Wert sprang je nach
    Auslöser. Jetzt gilt der Katalog-Text: Turnier- und Match-Chat."""
    me = await flow.add_user(name="plauderin")
    db = flow.db
    await db.direct_messages.insert_many([{"id": f"d{i}", "sender_id": me["id"], "recipient_id": "x", "message": "hi", "created_at": stamp("2026-09-01", 10)} for i in range(3)])
    await db.team_chat_messages.insert_many([{"id": f"t{i}", "team_id": "tm", "user_id": me["id"], "message": "hi", "created_at": stamp("2026-09-01", 10)} for i in range(2)])
    await db.tournament_chat_messages.insert_one({"id": "tc", "tournament_id": "t", "user_id": me["id"], "message": "hi", "created_at": stamp("2026-09-01", 10)})
    await db.match_chat_messages.insert_one({"id": "mc", "match_id": "m", "user_id": me["id"], "message": "gg", "created_at": stamp("2026-09-01", 11)})

    # Jeder Auslöser liefert dieselbe Zahl: der volle Lauf, Chat und Community rechnen sie; eine fremde Quelle (Team)
    # rechnet sie nicht und lässt den gespeicherten Stand unverändert stehen.
    full = await counters.refresh(me["id"])
    partial = await counters.refresh(me["id"], {"team"})
    community = await counters.refresh(me["id"], {"community"})
    chat = await counters.refresh(me["id"], {"chat"})
    assert full["community_messages_sent"] == partial["community_messages_sent"] == community["community_messages_sent"] == chat["community_messages_sent"] == 2
    # Nur eine Rechnung: in der Registry, nicht im alten Block (#2338) - und nur Chat und Community lösen sie aus.
    chat_keys = {"community_messages_sent", "direct_messages_sent", "team_chat_messages_sent", "match_chat_messages_sent", "tournament_chat_messages_sent"}
    assert chat_keys <= set(counters.REGISTRY) and not chat_keys & counters.LEGACY_KEYS
    assert not chat_keys & set(await achievement_progress.compute_user_progress(me["id"]))
    assert all(counters.REGISTRY[key].sources == frozenset({"chat", "community"}) for key in chat_keys)
    assert (full["direct_messages_sent"], full["team_chat_messages_sent"]) == (3, 2)

    # Eine neue Nachricht: eine fremde Quelle lässt den gespeicherten Wert stehen, Chat rechnet ihn neu.
    await db.tournament_chat_messages.insert_one({"id": "tc2", "tournament_id": "t", "user_id": me["id"], "message": "gg", "created_at": stamp("2026-09-02", 10)})
    assert (await counters.refresh(me["id"], {"team"}))["community_messages_sent"] == 2
    stored = await db[counters.STATS].find_one({"user_id": me["id"]}, {"_id": 0, "values": 1})
    assert stored["values"]["community_messages_sent"] == 2
    assert (await counters.refresh(me["id"], {"chat"}))["community_messages_sent"] == 3
    assert (await counters.refresh(me["id"]))["community_messages_sent"] == 3


@pytest.mark.asyncio
async def test_held_rejected_and_deleted_messages_never_count(flow):
    me = await flow.add_user(name="filterfall")
    db = flow.db
    rows = [
        {"id": "ok", "moderation": None},
        {"id": "flagged", "moderation": {"state": "flagged"}},
        {"id": "released", "moderation": {"state": "released"}},
        {"id": "held", "moderation": {"state": "held"}},
        {"id": "rejected", "moderation": {"state": "rejected"}},
        {"id": "gone", "deleted_at": stamp("2026-09-02", 9)},
    ]
    for collection, field in achievement_progress.CHAT_COLLECTIONS.values():
        await db[collection].insert_many([{**{k: v for k, v in row.items() if v is not None}, "id": f"{collection}-{row['id']}", field: me["id"],
                                           "message": "x", "created_at": stamp("2026-09-02", 8), "sticker": {"id": f"s-{row['id']}"}} for row in rows])
    values = await counters.compute(me["id"])
    for key in ("direct_messages_sent", "team_chat_messages_sent", "match_chat_messages_sent", "tournament_chat_messages_sent"):
        assert values[key] == 3, key
    assert values["community_messages_sent"] == 6
    assert values["stickers_collected"] == 3, "auch Sticker zählen nur aus sichtbaren Nachrichten"


@pytest.mark.asyncio
async def test_at_most_fifty_counted_messages_per_vienna_day(flow):
    me = await flow.add_user(name="vielschreiber")
    db = flow.db
    # 60 am 1.9. (Wien), dazu 3 um 22:30 UTC - in Wien schon der 2.9. - und 2 am 3.9.
    busy = [stamp("2026-09-01", 8 + i // 60, i % 60) for i in range(60)]
    late = [stamp("2026-09-01", 22, 30 + i) for i in range(3)]
    other = [stamp("2026-09-03", 12, i) for i in range(2)]
    await db.team_chat_messages.insert_many([{"id": f"tm{i}", "team_id": "tm", "user_id": me["id"], "message": "x", "created_at": when} for i, when in enumerate(busy + late + other)])
    # Offene Chats: 40 Turnier- und 40 Match-Nachrichten am selben Tag - zusammen gedeckelt, je Chat nicht.
    await db.tournament_chat_messages.insert_many([{"id": f"tc{i}", "tournament_id": "t", "user_id": me["id"], "message": "x", "created_at": stamp("2026-09-05", 10, i)} for i in range(40)])
    await db.match_chat_messages.insert_many([{"id": f"mc{i}", "match_id": "m", "user_id": me["id"], "message": "x", "created_at": stamp("2026-09-05", 11, i)} for i in range(40)])
    values = await counters.compute(me["id"])
    assert values["team_chat_messages_sent"] == 50 + 3 + 2
    assert values["tournament_chat_messages_sent"] == 40 and values["match_chat_messages_sent"] == 40
    assert values["community_messages_sent"] == 50, "Plauderer: ein Deckel für Turnier- und Match-Chat zusammen"


@pytest.mark.asyncio
async def test_the_daily_cap_follows_the_vienna_day_across_the_clock_change(flow):
    """Ende der Sommerzeit am 25.10.2026: der Tag hat 25 Stunden. 00:30 Sommerzeit (22:30 UTC am Vortag) und 23:30
    Winterzeit (22:30 UTC) sind derselbe Wiener Tag; 00:05 danach (23:05 UTC) ist schon der 26. Ein fester Versatz oder
    der UTC-Tag käme auf 65."""
    me = await flow.add_user(name="zeitumstellung")
    early = [stamp("2026-10-24", 22, 30 + i) for i in range(30)]   # 25.10., 00:30 Sommerzeit
    late = [stamp("2026-10-25", 22, i) for i in range(30)]          # 25.10., 23:00 Winterzeit
    next_day = [stamp("2026-10-25", 23, 5 + i) for i in range(5)]   # 26.10., 00:05
    await flow.db.team_chat_messages.insert_many([{"id": f"dst{i}", "team_id": "tm", "user_id": me["id"], "message": "x", "created_at": when}
                                                  for i, when in enumerate(early + late + next_day)])
    values = await counters.compute(me["id"], {"team_chat_messages_sent"}, legacy=False)
    assert values["team_chat_messages_sent"] == 50 + 5


@pytest.mark.asyncio
async def test_noted_released_and_flagged_messages_count(flow):
    """Nur zurückgehalten und abgelehnt zählen nicht - „gesehen“ (noted), freigegeben und markiert zählen."""
    me = await flow.add_user(name="gesehen")
    states = ["noted", "released", "flagged", "held", "rejected"]
    await flow.db.match_chat_messages.insert_many([{"id": f"st-{state}", "match_id": "m", "user_id": me["id"], "message": "x",
                                                    "moderation": {"state": state}, "created_at": stamp("2026-09-10", 12)} for state in states])
    values = await counters.compute(me["id"], {"match_chat_messages_sent", "community_messages_sent"}, legacy=False)
    assert values["match_chat_messages_sent"] == 3 and values["community_messages_sent"] == 3


# ---------------------------------------------------------------- Events (H12)

@pytest.mark.asyncio
async def test_club_events_are_internal_by_visibility_or_type_and_cancelled_events_never_count(flow):
    me = await flow.add_user(name="vereinsmensch")
    db = flow.db
    await db.events.insert_many([
        {"id": "e-members", "slug": "e-members", "name": "Mitgliederabend", "visibility": "members", "event_type": "general", "status": "completed"},
        {"id": "e-evening", "slug": "e-evening", "name": "Vereinsabend", "visibility": "public", "event_type": "club_evening", "status": "completed"},
        {"id": "e-internal", "slug": "e-internal", "name": "Klausur", "visibility": "community", "event_type": "internal", "status": "completed"},
        {"id": "e-public", "slug": "e-public", "name": "LAN", "visibility": "public", "event_type": "lan_party", "status": "completed"},
        {"id": "e-cancelled", "slug": "e-cancelled", "name": "Abgesagt", "visibility": "internal", "event_type": "club_evening", "status": "cancelled"},
        {"id": "e-noshow", "slug": "e-noshow", "name": "Nicht da", "visibility": "public", "event_type": "club_evening", "status": "completed"},
    ])
    await db.event_registrations.insert_many([
        {"id": "r1", "event_id": "e-members", "user_id": me["id"], "status": "checked_in"},
        {"id": "r2", "event_id": "e-evening", "user_id": me["id"], "status": "checked_in"},
        {"id": "r3", "event_id": "e-internal", "user_id": me["id"], "checked_in": True, "status": "registered"},
        {"id": "r4", "event_id": "e-public", "user_id": me["id"], "status": "checked_in"},
        {"id": "r5", "event_id": "e-cancelled", "user_id": me["id"], "status": "checked_in"},
        {"id": "r6", "event_id": "e-noshow", "user_id": me["id"], "checked_in": True, "status": "no_show"},
    ])
    values = await counters.compute(me["id"], {"club_events_attended", "events_attended"})
    assert values["club_events_attended"] == 3, "Sichtbarkeit Mitglieder, Art Vereinsabend, Art intern"
    assert values["events_attended"] == 4, "abgesagt und nicht erschienen zählen nicht"


# ---------------------------------------------------------------- Datenbewusst (H10)

async def privacy(user_id: str) -> int:
    return (await counters.compute(user_id, {"privacy_reviewed"}, legacy=False))["privacy_reviewed"]


@pytest.mark.asyncio
async def test_data_aware_needs_a_saved_privacy_setting_not_the_registration_default(flow):
    me = await flow.add_user(name="datenbewusst")
    db = flow.db
    # So legt die Registrierung das Konto an (routes/auth_routes.py).
    await db.users.update_one({"id": me["id"]}, {"$set": {"privacy_public_profile": False, "profile_visibility": {}, "dm_privacy": "everyone"}})
    assert await privacy(me["id"]) == 0, "die Voreinstellung zählt nicht"
    flow.act_as(me)
    response = await flow.patch("/api/users/me", json={"bio": "Hallo"})
    assert response.status_code == 200, response.text
    assert await privacy(me["id"]) == 0, "ein anderes Feld ist keine Privatsphäre-Einstellung"
    response = await flow.patch("/api/users/me", json={"dm_privacy": "friends"})
    assert response.status_code == 200, response.text
    assert (await db.users.find_one({"id": me["id"]}))["privacy_reviewed_at"]
    assert await privacy(me["id"]) == 1


@pytest.mark.asyncio
async def test_data_aware_also_counts_after_a_data_export(flow):
    me = await flow.add_user(name="auskunft")
    await flow.db.users.update_one({"id": me["id"]}, {"$set": {"privacy_public_profile": False, "profile_visibility": {}}})
    flow.act_as(me)
    response = await flow.get("/api/dsgvo/export-my-data")
    assert response.status_code == 200
    assert await privacy(me["id"]) == 1
    entry = await flow.db.achievement_eval_queue.find_one({"user_id": me["id"]}, {"_id": 0})
    assert entry and "profile" in entry["sources"]


@pytest.mark.asyncio
async def test_deleting_the_account_removes_the_privacy_timestamps(flow):
    """Kontolöschung (#2338): wann jemand die Privatsphäre eingestellt oder den Export geholt hat, geht mit."""
    from services import account_erasure

    me = await flow.add_user(name="loeschmich")
    flow.act_as(me)
    assert (await flow.patch("/api/users/me", json={"dm_privacy": "friends"})).status_code == 200
    assert (await flow.get("/api/dsgvo/export-my-data")).status_code == 200
    stored = await flow.db.users.find_one({"id": me["id"]})
    assert stored["privacy_reviewed_at"] and stored["data_exported_at"]
    assert {"privacy_reviewed_at", "data_exported_at"} <= account_erasure.profile_fields_to_clear()
    assert (await flow.post("/api/dsgvo/anonymize-me")).status_code == 200
    gone = await flow.db.users.find_one({"id": me["id"]})
    assert "privacy_reviewed_at" not in gone and "data_exported_at" not in gone


# ---------------------------------------------------------------- Twitch (M4)

def fake_twitch(monkeypatch, streams: list[dict]):
    from services import twitch_service

    async def token(_creds):
        return "token", ""

    class Answer:
        status_code = 200
        text = ""

        def json(self):
            return {"data": list(streams)}

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, *args, **kwargs):
            return Answer()

    monkeypatch.setattr(twitch_service, "_get_app_token", token)
    monkeypatch.setattr(twitch_service.httpx, "AsyncClient", Client)


@pytest.mark.asyncio
async def test_twitch_sessions_and_minutes_only_count_for_the_linked_channel(flow, monkeypatch):
    from datetime import timedelta

    from models import now_utc
    from services import twitch_service
    from services.secret_store import encrypt_secret

    db = flow.db
    await db.settings.update_one({"id": "branding"}, {"$set": {"id": "branding", "twitch_client_id": "cid", "twitch_client_secret": encrypt_secret("geheim")}}, upsert=True)
    typed = await flow.add_user(name="getippt")
    linked = await flow.add_user(name="verknuepft")
    await db.users.update_one({"id": typed["id"]}, {"$set": {"twitch_handle": "fremderkanal"}})
    await db.users.update_one({"id": linked["id"]}, {"$set": {"twitch_handle": "eigenerkanal", "platform_verified": {"twitch": True}}})
    await db.platform_links.insert_one({"id": "tw-l", "user_id": linked["id"], "platform": "twitch", "external_id": "9001", "handle": "eigenerkanal"})
    started = (now_utc() - timedelta(minutes=30)).isoformat()
    fake_twitch(monkeypatch, [
        {"id": "st-typed", "user_id": "8001", "user_login": "fremderkanal", "started_at": started, "viewer_count": 3},
        {"id": "st-linked", "user_id": "9001", "user_login": "eigenerkanal", "started_at": started, "viewer_count": 3},
    ])
    await twitch_service.fetch_live_streams()
    assert await db.live_streams.count_documents({}) == 2, "beide Streams stehen weiter auf der Seite"
    fake_twitch(monkeypatch, [])
    await twitch_service.fetch_live_streams()

    stored_typed = await db.users.find_one({"id": typed["id"]})
    stored_linked = await db.users.find_one({"id": linked["id"]})
    assert not stored_typed.get("twitch_live_sessions_count") and not stored_typed.get("twitch_stream_minutes")
    assert stored_linked["twitch_live_sessions_count"] == 1 and stored_linked["twitch_stream_minutes"] >= 30

    # Auch ein schon gezählter Stand zählt nur mit Verknüpfung.
    await db.users.update_one({"id": typed["id"]}, {"$set": {"twitch_live_sessions_count": 7, "twitch_stream_minutes": 600}})
    keys = {"twitch_live_sessions", "twitch_stream_minutes"}
    assert {k: v for k, v in (await counters.compute(typed["id"], keys)).items() if k in keys} == {"twitch_live_sessions": 0, "twitch_stream_minutes": 0}
    mine = await counters.compute(linked["id"], keys)
    assert mine["twitch_live_sessions"] == 1 and mine["twitch_stream_minutes"] >= 30


@pytest.mark.asyncio
async def test_a_renamed_twitch_channel_still_counts_by_its_id(flow, monkeypatch):
    """Twitch erkennt den Kanal an der Kennung, nicht am Login (#2338): nach einer Umbenennung bei Twitch zählt der Stream
    weiter für das verknüpfte Konto; ein fremder Kanal mit dem alten Namen nicht."""
    from datetime import timedelta

    from models import now_utc
    from services import twitch_service
    from services.secret_store import encrypt_secret

    db = flow.db
    await db.settings.update_one({"id": "branding"}, {"$set": {"id": "branding", "twitch_client_id": "cid", "twitch_client_secret": encrypt_secret("geheim")}}, upsert=True)
    renamed = await flow.add_user(name="umbenannt")
    await db.users.update_one({"id": renamed["id"]}, {"$set": {"twitch_handle": "neuername", "platform_verified": {"twitch": True}}})
    await db.platform_links.insert_one({"id": "tw-r", "user_id": renamed["id"], "platform": "twitch", "external_id": "9001", "handle": "altername"})
    squatter = await flow.add_user(name="altername-fremd")
    await db.users.update_one({"id": squatter["id"]}, {"$set": {"twitch_handle": "altername"}})
    await db.platform_links.insert_one({"id": "tw-s", "user_id": squatter["id"], "platform": "twitch", "external_id": "7777", "handle": "irgendwer"})
    started = (now_utc() - timedelta(minutes=20)).isoformat()
    fake_twitch(monkeypatch, [
        {"id": "st-new", "user_id": "9001", "user_login": "neuername", "started_at": started, "viewer_count": 1},
        {"id": "st-old", "user_id": "6666", "user_login": "altername", "started_at": started, "viewer_count": 1},
    ])
    await twitch_service.fetch_live_streams()
    fake_twitch(monkeypatch, [])
    await twitch_service.fetch_live_streams()
    mine = await db.users.find_one({"id": renamed["id"]})
    assert mine["twitch_live_sessions_count"] == 1 and mine["twitch_stream_minutes"] >= 20, "gleiche Kennung, neuer Name"
    theirs = await db.users.find_one({"id": squatter["id"]})
    assert not theirs.get("twitch_live_sessions_count") and not theirs.get("twitch_stream_minutes"), "fremde Kennung"


@pytest.mark.asyncio
async def test_clips_count_for_the_linked_twitch_account_not_a_typed_name(flow):
    db = flow.db
    typed = await flow.add_user(name="clipgetippt")
    linked = await flow.add_user(name="clipverknuepft")
    await db.users.update_one({"id": typed["id"]}, {"$set": {"twitch_handle": "clipper"}})
    await db.platform_links.insert_one({"id": "tw-c", "user_id": linked["id"], "platform": "twitch", "external_id": "77", "handle": "echtername"})
    await db.settings.insert_one({"id": "twitch_clips_state", "clips": [
        {"id": "c1", "creator_name": "clipper", "creator_id": "55"},
        {"id": "c2", "creator_name": "Anzeigename", "creator_id": "77"},
        {"id": "c3", "creator_name": "EchterName"},
    ]})
    assert (await counters.compute(typed["id"], {"clips_synced"}, legacy=False))["clips_synced"] == 0
    assert (await counters.compute(linked["id"], {"clips_synced"}, legacy=False))["clips_synced"] == 2, "an der Kennung, ältere am Namen"


def test_fetched_clips_keep_the_creator_id():
    from services import twitch_clips

    picked = twitch_clips.pick_clips([{"id": "a", "creator_name": "Paula", "creator_id": 123, "view_count": 1}])
    assert picked[0]["creator_id"] == "123"


# ---------------------------------------------------------------- Teamauftritt (M2) und Kapitän (M3)

async def team_values(user_id: str) -> dict:
    return await counters.compute(user_id, {"team_profile_complete", "captain_days"}, legacy=False)


@pytest.mark.asyncio
async def test_team_identity_counts_for_leader_and_co_leader_and_is_evaluated_on_save(flow):
    db = flow.db
    lead = await flow.add_user(name="teamleitung")
    co = await flow.add_user(name="coleitung")
    member = await flow.add_user(name="mitspieler")
    await db.teams.insert_one({"id": "tm-a", "name": "Auftritt", "tag": "AUF", "leader_id": lead["id"], "co_leader_ids": [co["id"]],
                               "member_ids": [lead["id"], co["id"], member["id"]], "logo_url": "/l.png", "banner_url": "/b.png", "description": "   "})
    assert (await team_values(lead["id"]))["team_profile_complete"] == 0, "nur Leerzeichen sind keine Beschreibung"
    flow.act_as(lead)
    response = await flow.patch("/api/teams/tm-a", json={"description": "Wir spielen Rocket League."})
    assert response.status_code == 200, response.text
    queued = {row["user_id"]: row async for row in db.achievement_eval_queue.find({}, {"_id": 0})}
    assert set(queued) == {lead["id"], co["id"]}, "beim Speichern vorgemerkt: Teamleitung und Co-Leitung"
    assert all("team" in row["sources"] for row in queued.values())
    assert (await team_values(lead["id"]))["team_profile_complete"] == 1
    assert (await team_values(co["id"]))["team_profile_complete"] == 1
    assert (await team_values(member["id"]))["team_profile_complete"] == 0


@pytest.mark.asyncio
async def test_captain_counts_from_the_takeover_not_from_the_founding(flow):
    from datetime import timedelta

    from models import now_utc

    db = flow.db
    old_lead = await flow.add_user(name="gruenderin")
    new_lead = await flow.add_user(name="nachfolger")
    founded = (now_utc() - timedelta(days=400)).isoformat()
    await db.teams.insert_one({"id": "tm-k", "name": "Kapitäne", "tag": "KAP", "leader_id": old_lead["id"], "co_leader_ids": [],
                               "member_ids": [old_lead["id"], new_lead["id"]], "created_at": founded})
    assert (await team_values(old_lead["id"]))["captain_days"] == 400, "Altbestand ohne Übernahme: ab der Gründung"
    flow.act_as(old_lead)
    response = await flow.post("/api/teams/tm-k/transfer-leader", json={"new_leader_id": new_lead["id"]})
    assert response.status_code == 200, response.text
    assert response.json()["leader_since"]
    assert (await team_values(new_lead["id"]))["captain_days"] == 0, "ab der Übernahme, nicht ab der Gründung"
    await db.teams.update_one({"id": "tm-k"}, {"$set": {"leader_since": (now_utc() - timedelta(days=12)).isoformat()}})
    assert (await team_values(new_lead["id"]))["captain_days"] == 12

    flow.act_as(new_lead)
    response = await flow.post("/api/teams", json={"name": "Neugruendung", "tag": "NEU"})
    assert response.status_code == 200, response.text
    assert response.json()["leader_since"] == response.json()["created_at"]


@pytest.mark.asyncio
async def test_captain_in_old_teams_falls_back_to_the_logged_handover_before_the_founding(flow):
    """Altbestand ohne ``leader_since``: die letzte protokollierte Übergabe an diese Person, erst dann die Gründung."""
    from datetime import timedelta

    from models import now_utc

    db = flow.db
    lead = await flow.add_user(name="altbestand")
    founded = (now_utc() - timedelta(days=500)).isoformat()
    await db.teams.insert_one({"id": "tm-alt", "name": "Alt", "tag": "ALT", "leader_id": lead["id"], "co_leader_ids": [],
                               "member_ids": [lead["id"]], "created_at": founded})
    await db.audit_logs.insert_many([
        {"id": "a1", "action": "team.transfer_leader", "target_id": "tm-alt", "data": {"old_leader": "x", "new_leader": lead["id"]},
         "created_at": (now_utc() - timedelta(days=200)).isoformat()},
        {"id": "a2", "action": "team.transfer_leader", "target_id": "tm-alt", "data": {"old_leader": lead["id"], "new_leader": "y"},
         "created_at": (now_utc() - timedelta(days=150)).isoformat()},
        {"id": "a3", "action": "team.transfer_leader", "target_id": "tm-alt", "data": {"old_leader": "y", "new_leader": lead["id"]},
         "created_at": (now_utc() - timedelta(days=90)).isoformat()},
        {"id": "a4", "action": "team.transfer_leader", "target_id": "anderes-team", "data": {"new_leader": lead["id"]},
         "created_at": (now_utc() - timedelta(days=5)).isoformat()},
    ])
    assert (await team_values(lead["id"]))["captain_days"] == 90, "die letzte Übergabe an sie, nicht die Gründung"
    await db.audit_logs.delete_many({"target_id": "tm-alt"})
    assert (await team_values(lead["id"]))["captain_days"] == 500, "ohne Protokoll ab der Gründung"


# ---------------------------------------------------------------- Gruselnacht (M5)

@pytest.mark.asyncio
async def test_spooky_night_is_checked_by_the_server_in_vienna_time(flow, monkeypatch):
    from datetime import datetime, timezone

    from services import seasons

    real_to_vienna = seasons.to_vienna
    me = await flow.add_user(name="kuerbis")

    def at(moment: datetime):
        monkeypatch.setattr(seasons, "to_vienna", lambda now=None: real_to_vienna(now if now is not None else moment))
        monkeypatch.setattr(counters, "now_utc", lambda: moment.astimezone(timezone.utc))

    async def pumpkin(day: str | None = None) -> dict:
        return await counters.record_signal(me["id"], "halloween_pumpkin", 1, day)

    at(datetime(2026, 10, 28, 20, 0, tzinfo=counters.VIENNA))
    assert await pumpkin() == {"accepted": False, "reason": "time"}, "Halloween-Woche, aber nicht der 31."
    at(datetime(2026, 10, 31, 16, 59, tzinfo=timezone.utc))  # 17:59 in Wien (Winterzeit)
    assert (await pumpkin())["reason"] == "time", "vor 18 Uhr Wiener Zeit"
    at(datetime(2026, 10, 31, 17, 0, tzinfo=timezone.utc))  # 18:00 in Wien
    assert (await pumpkin())["accepted"] is True
    # Nachgemeldet: nur der 31. zählt - die Uhrzeit lässt sich dann nicht mehr prüfen.
    at(datetime(2026, 11, 1, 10, 0, tzinfo=counters.VIENNA))
    assert (await pumpkin("2026-10-30"))["reason"] == "time"
    assert counters.in_signal_window({"month": 10, "day": 31, "from_hour": 18}, datetime(2026, 10, 31).date(), None)


# ---------------------------------------------------------------- Texte

def test_manual_achievements_name_their_criteria_and_who_awards_them():
    """Einzeln vergeben darf, wer in der Verwaltung den Bereich Redaktion hat (badge_routes: require_area("content")).
    Bei Ehrungen entscheidet der Vorstand, die Redaktion trägt ein; bei Teilnahmen trägt die Redaktion alle ein, die
    dabei waren. Jeder Text nennt ein Kriterium."""
    import achievement_catalog as catalog

    manual = {g["code"]: g for g in catalog.ACHIEVEMENT_GROUPS if g.get("manual_only") and not g.get("is_negative") and g.get("catalog") in ("C", "D")}
    assert len(manual) >= 10
    board = {"ehrenloewe", "hall_of_fame", "season_mvp", "volunteer", "sponsor_friend", "community_helper", "mentor", "creator_spirit"}
    for code, group in manual.items():
        how_to = group["how_to"]
        assert how_to.startswith("Von Hand vergeben: ") and "Redaktion" in how_to and "Vereinsleitung" not in how_to, code
        if code in board:
            assert how_to.startswith("Von Hand vergeben: Der Vorstand entscheidet, die Redaktion trägt ein - "), code
        else:
            assert "Vorstand" not in how_to and " bei allen ein, die " in how_to, code
        assert "–" not in how_to, "Gedankenstrich wie im Katalog: ' - '"


def test_explanations_name_the_rules():
    import achievement_catalog as catalog

    groups = catalog.GROUP_BY_CODE
    for code in ("community_chat", "team_chat", "tournament_chat"):
        assert "zurückgehaltene Nachrichten zählen nicht, höchstens 50 am Tag" in groups[code]["how_to"], code
    for code in ("twitch_sessions", "twitch_minutes", "clips"):
        assert "per Anmeldung verknüpften Twitch-Kanal" in groups[code]["how_to"], code
    steckbrief = groups["profile_completeness"]["how_to"]
    for label in ("Profilbild", "Banner", "Über mich", "Land", "Ort", "Geburtsdatum", "Plattformen", "Eingabegeräte", "Lieblingsspiele", "Discord", "Twitch", "Sichtbarkeit"):
        assert label in steckbrief, label
    assert len(achievement_progress.PROFILE_FIELDS) == 12, "kommt ein Feld dazu, gehört es in den Text"
    assert groups["team_identity"]["how_to"] == "Logo, Banner und Teambeschreibung deines Teams sind ausgefüllt - zählt für die Teamleitung und die Co-Leitung."
    # Seit #2339 sagt der Text dazu, warum er nicht für Kategorie-Meister zählt.
    assert groups["streamer_verified"]["how_to"] == ("Dein Twitch-Konto ist per Anmeldung verknüpft und der Verein führt dich als Streamer oder Creator. "
                                                     "Zählt nicht für Kategorie-Meister und Hundert Prozent, weil der Verein entscheidet.")


# ---------------------------------------------------------------- Dolibarr: Beitrittsdatum (M10)

@pytest.mark.asyncio
async def test_dolibarr_sync_never_overwrites_a_known_join_date_with_nothing(flow):
    from dolibarr_fake import member
    from services import dolibarr_sync

    me = await flow.add_user(name="mitgliedseit")
    settings = {"base_url": "https://dolibarr.example.test", "instance": "verein", "type_map": {"2": "ordinary"}}
    link = {"user_id": me["id"]}
    await dolibarr_sync.apply_summary(flow.db, settings, link, member(41, member_since="2023-01-01", updated_at="2026-09-01T00:00:00Z"))
    assert (await flow.db.memberships.find_one({"user_id": me["id"]}))["member_since"] == "2023-01-01"
    await dolibarr_sync.apply_summary(flow.db, settings, link, member(41, member_since="", updated_at="2026-09-02T00:00:00Z"))
    stored = await flow.db.memberships.find_one({"user_id": me["id"]})
    assert (stored["member_since"], stored["member_since_precision"]) == ("2023-01-01", "day"), "kein Datum heißt nicht: Datum löschen"
    await dolibarr_sync.apply_summary(flow.db, settings, link, member(41, member_since="2022-05-01", updated_at="2026-09-03T00:00:00Z"))
    assert (await flow.db.memberships.find_one({"user_id": me["id"]}))["member_since"] == "2022-05-01", "ein neues Datum gilt"


# ---------------------------------------------------------------- Verifizierter Streamer

@pytest.mark.asyncio
async def test_verified_streamer_needs_linked_twitch_and_the_creator_mark(flow):
    import badges

    await badges.seed_badges()
    db = flow.db
    streamer = await flow.add_user(name="vereinsstreamerin")
    await db.club_member_profiles.insert_one({"id": "p-s", "user_id": streamer["id"], "slug": "vereinsstreamerin", "display_name": "Vereinsstreamerin", "is_active": True})

    async def verified() -> int:
        return (await counters.compute(streamer["id"], {"streamer_verified"}, legacy=False))["streamer_verified"]

    admin = await flow.add_staff("Vereinsverwaltung")
    flow.act_as(admin)
    response = await flow.patch("/api/membership/profiles/admin/p-s", json={"creator": True})
    assert response.status_code == 200, response.text
    assert response.json()["creator"] is True
    log = await db.audit_logs.find_one({"action": "club_member_profile.update", "target_id": "p-s"}, {"_id": 0})
    assert log["data"]["creator"] is True and log["actor_id"] == admin["id"], "im Protokoll wie die übrigen Felder"
    assert await db.achievement_eval_queue.find_one({"user_id": streamer["id"]}), "gleich vorgemerkt"
    assert await verified() == 0, "ohne Twitch per Anmeldung noch nicht"
    await db.users.update_one({"id": streamer["id"]}, {"$set": {"twitch_handle": "getippt"}})
    assert await verified() == 0, "ein getippter Name reicht nicht"

    await db.platform_links.insert_one({"id": "tw-v", "user_id": streamer["id"], "platform": "twitch", "external_id": "31", "handle": "vereinsstreamerin"})
    assert await verified() == 1
    await badges.evaluate_user_progress(streamer["id"], {"club"})
    assert await db.user_achievements.find_one({"user_id": streamer["id"], "tier_code": "streamer_verified_1"})

    # Weiter von Hand vergebbar - auch ohne Kennzeichen und ohne Twitch.
    other = await flow.add_user(name="handvergabe")
    response = await flow.post("/api/admin/achievements/award", json={"user_id": other["id"], "tier_code": "streamer_verified_1", "note": "Partnerkanal"})
    assert response.status_code == 200, response.text
    assert response.json().get("newly_awarded") is True


@pytest.mark.asyncio
async def test_a_regular_member_cannot_set_the_creator_mark(flow):
    db = flow.db
    member = await flow.add_user(name="mitglied")
    await db.club_member_profiles.insert_one({"id": "p-m", "user_id": member["id"], "slug": "mitglied", "display_name": "Mitglied", "is_active": True})
    flow.act_as(member)
    response = await flow.patch("/api/membership/profiles/admin/p-m", json={"creator": True})
    assert response.status_code == 403
    assert not (await db.club_member_profiles.find_one({"id": "p-m"})).get("creator")


# ---------------------------------------------------------------- Konto verknüpfen (M14)

@pytest.mark.asyncio
async def test_linking_an_account_queues_an_evaluation(flow):
    from services import platform_links

    me = await flow.add_user(name="verknuepferin")
    await platform_links.link_account(flow.db, me["id"], "twitch", {"external_id": "4711", "handle": "kanal"})
    entry = await flow.db.achievement_eval_queue.find_one({"user_id": me["id"]}, {"_id": 0})
    assert entry and {"profile", "stream"} <= set(entry["sources"])
    values = await counters.compute(me["id"], {"twitch_linked"}, legacy=False)
    assert values["twitch_linked"] == 1


# ---------------------------------------------------------------- Discord (H11, M9)

MAIN, SUB, OFF = "700000000000000001", "700000000000000002", "700000000000000009"


async def discord_world(db):
    await db.discord_guilds.insert_many([
        {"guild_id": MAIN, "name": "Haupt", "role": "main", "enabled": True},
        {"guild_id": SUB, "name": "Rocket League", "role": "sub", "enabled": True},
        {"guild_id": OFF, "name": "Aus", "role": "sub", "enabled": False},
    ])


@pytest.fixture
def bot(monkeypatch):
    from services import discord_runtime

    class FakeBot:
        def __init__(self):
            self.members: set[tuple[str, str]] = set()
            self.online = True

        async def member_status(self, guild_ids, discord_id):
            if not self.online:
                return {guild_id: None for guild_id in guild_ids}
            return {guild_id: (guild_id, discord_id) in self.members for guild_id in guild_ids}

    fake = FakeBot()
    monkeypatch.setattr(discord_runtime.bot, "member_status", fake.member_status)
    return fake


async def stage(user_id: str) -> tuple[int, int]:
    values = await counters.compute(user_id, {"discord_guilds_joined", "discord_servers_stage"}, legacy=False)
    return values["discord_guilds_joined"], values["discord_servers_stage"]


def test_stage_targets_never_exceed_the_number_of_servers():
    for enabled in range(1, 12):
        targets = [counters.servers_for_stage(level, enabled) for level in (1, 2, 3)]
        assert targets == sorted(targets) and max(targets) <= enabled and targets[-1] == enabled, (enabled, targets)
    assert [counters.servers_for_stage(level, 1) for level in (1, 2, 3)] == [1, 1, 1]
    assert [counters.servers_for_stage(level, 2) for level in (1, 2, 3)] == [1, 2, 2]
    assert [counters.servers_for_stage(level, 5) for level in (1, 2, 3)] == [1, 3, 5]


@pytest.mark.asyncio
async def test_linking_discord_syncs_the_servers_and_unlinking_stops_counting(flow, bot):
    from services import discord_guilds, platform_links

    me = await flow.add_user(name="discordlerin")
    db = flow.db
    await discord_world(db)
    bot.members |= {(MAIN, "111"), (SUB, "111"), (OFF, "111")}
    await platform_links.link_account(db, me["id"], "discord", {"external_id": "111", "handle": "lerin"})
    result = await discord_guilds.sync_memberships(db, me["id"])
    assert result["checked"] == 2, "nur eingeschaltete Server werden gefragt"
    assert await stage(me["id"]) == (2, 3), "zwei von zwei eingeschalteten Servern: alle drei Stufen"
    assert (await db.achievement_eval_queue.find_one({"user_id": me["id"]}, {"_id": 0}))["sources"], "danach ausgewertet"

    await platform_links.unlink(db, me["id"], "discord")
    assert await stage(me["id"]) == (0, 0), "getrennt zählt nichts mehr"
    assert await db.discord_memberships.count_documents({"user_id": me["id"]}) == 0


@pytest.mark.asyncio
async def test_entries_of_a_previous_discord_account_do_not_count(flow, bot):
    from services import discord_guilds

    me = await flow.add_user(name="wechslerin")
    db = flow.db
    await discord_world(db)
    await db.discord_memberships.insert_many([
        {"user_id": me["id"], "guild_id": MAIN, "member": True, "discord_id": "old"},
        {"user_id": me["id"], "guild_id": SUB, "member": True, "discord_id": "old"},
    ])
    await db.platform_links.insert_one({"id": "l-new", "user_id": me["id"], "platform": "discord", "external_id": "new"})
    assert await stage(me["id"]) == (0, 0), "gemerkt für das alte Konto"
    bot.members.add((SUB, "new"))
    await discord_guilds.sync_memberships(db, me["id"])
    assert await stage(me["id"]) == (1, 1)
    assert await db.discord_memberships.count_documents({"user_id": me["id"], "discord_id": "old"}) == 0


@pytest.mark.asyncio
async def test_nightly_sync_covers_everyone_linked_and_drops_orphans(flow, bot):
    from services import discord_guilds

    db = flow.db
    await discord_world(db)
    anna = await flow.add_user(name="anna")
    bert = await flow.add_user(name="bert")
    await db.platform_links.insert_many([
        {"id": "l-a", "user_id": anna["id"], "platform": "discord", "external_id": "201"},
        {"id": "l-b", "user_id": bert["id"], "platform": "discord", "external_id": "202"},
    ])
    await db.discord_memberships.insert_one({"user_id": "ohne-konto", "guild_id": MAIN, "member": True, "checked_at": "2026-01-01T00:00:00+00:00"})
    # Wettlauf: ein Eintrag, der während des Laufs entsteht (jünger als der Start), bleibt stehen.
    await db.discord_memberships.insert_one({"user_id": "verknuepft-gerade", "guild_id": MAIN, "member": True, "checked_at": "2999-01-01T00:00:00+00:00"})
    bot.members |= {(MAIN, "201"), (SUB, "202")}
    result = await discord_guilds.sync_all_memberships(db, batch=1, pause=0)
    assert result == {"users": 2, "checked": 4, "changed": 4, "orphaned": 1}
    assert await stage(anna["id"]) == (1, 1) and await stage(bert["id"]) == (1, 1)
    assert await db.discord_memberships.count_documents({"user_id": "verknuepft-gerade"}) == 1
    assert await db.achievement_eval_queue.count_documents({}) == 2

    # Zweiter Lauf ohne Änderung: niemand wird vorgemerkt.
    await db.achievement_eval_queue.delete_many({})
    again = await discord_guilds.sync_all_memberships(db, pause=0)
    assert (again["checked"], again["changed"]) == (4, 0)
    assert await db.achievement_eval_queue.count_documents({}) == 0
    # Bert tritt dem Hauptserver bei: nur er wird vorgemerkt.
    bot.members.add((MAIN, "202"))
    third = await discord_guilds.sync_all_memberships(db, pause=0)
    assert third["changed"] == 1
    assert [row["user_id"] async for row in db.achievement_eval_queue.find({}, {"_id": 0, "user_id": 1})] == [bert["id"]]


@pytest.mark.asyncio
async def test_nightly_sync_with_an_api_failure_deletes_nothing(flow, bot):
    """Antwortet Discord nicht (None), bleibt jeder gemerkte Stand stehen - und niemand wird vorgemerkt."""
    from services import discord_guilds

    db = flow.db
    await discord_world(db)
    anna = await flow.add_user(name="anna-offline")
    await db.platform_links.insert_one({"id": "l-ao", "user_id": anna["id"], "platform": "discord", "external_id": "501"})
    await db.discord_memberships.insert_many([
        {"user_id": anna["id"], "guild_id": MAIN, "member": True, "discord_id": "501", "checked_at": "2026-01-01T00:00:00+00:00"},
        {"user_id": anna["id"], "guild_id": SUB, "member": True, "discord_id": "501", "checked_at": "2026-01-01T00:00:00+00:00"},
    ])
    bot.online = False
    result = await discord_guilds.sync_all_memberships(db, pause=0)
    assert (result["checked"], result["changed"], result["orphaned"]) == (0, 0, 0)
    assert await db.discord_memberships.count_documents({"user_id": anna["id"]}) == 2
    assert await stage(anna["id"]) == (2, 3)
    assert await db.achievement_eval_queue.count_documents({}) == 0


@pytest.mark.asyncio
async def test_the_discord_sync_runs_every_night(monkeypatch):
    from services import scheduler

    monkeypatch.setattr(scheduler, "_scheduler", None)
    monkeypatch.setenv("SCHEDULER_JOBS", "discord_memberships")
    try:
        jobs = {job.id: job for job in scheduler.start_scheduler().get_jobs()}
    finally:
        scheduler.stop_scheduler()
    assert set(jobs) == {"discord_memberships"}
    assert "hour='3'" in str(jobs["discord_memberships"].trigger), "nachts"


@pytest.mark.asyncio
async def test_bot_offline_changes_nothing(flow, bot):
    from services import discord_guilds

    me = await flow.add_user(name="offline")
    db = flow.db
    await discord_world(db)
    await db.platform_links.insert_one({"id": "l-o", "user_id": me["id"], "platform": "discord", "external_id": "301"})
    await db.discord_memberships.insert_one({"user_id": me["id"], "guild_id": MAIN, "member": True, "discord_id": "301"})
    bot.online = False
    assert (await discord_guilds.sync_memberships(db, me["id"]))["checked"] == 0
    assert await stage(me["id"]) == (1, 1), "unbekannt heißt nicht „nein“"


@pytest.mark.asyncio
async def test_discord_messages_on_a_switched_off_server_do_not_count(flow):
    from services import discord_bot

    me = await flow.add_user(name="schreiberin")
    db = flow.db
    await discord_world(db)
    await db.platform_links.insert_one({"id": "l-s", "user_id": me["id"], "platform": "discord", "external_id": "401"})
    view = {"count_messages": True}
    assert await discord_bot.handle_message(db, view, MAIN, "401", False) == me["id"]
    assert await discord_bot.handle_message(db, view, OFF, "401", False) is None
    assert await discord_bot.handle_message(db, view, "700000000000000077", "401", False) is None, "unbekannter Server"
    assert (await db.users.find_one({"id": me["id"]}))["discord_messages_count"] == 1
