"""Regressions for scoped and replayable API change events."""
import asyncio
import json

import pytest
from mongomock_motor import AsyncMongoMockClient

import database
from services import change_events


@pytest.fixture(autouse=True)
def reset_change_event_state():
    change_events._subscribers.clear()
    change_events._event_buffer.clear()
    change_events._version = 0
    yield
    change_events._subscribers.clear()
    change_events._event_buffer.clear()


@pytest.fixture(autouse=True)
def scope_db(monkeypatch):
    """Turniere, Spiele und Events für die Turnier-Kennung der Meldungen (#1801) - eine Datenbank im Speicher."""
    db = AsyncMongoMockClient()["change_events_unit"]
    monkeypatch.setattr(database, "_db", db)
    return db


def test_public_event_redacts_raw_path_and_identifiers():
    event = change_events._build_api_change_event(
        "PATCH",
        "/api/tournaments/tournament-secret/stages/stage-secret",
        200,
    )

    public_event = change_events._event_for_scope(event, "public")
    staff_event = change_events._event_for_scope(event, "staff")

    assert public_event["visibility_scope"] == "public"
    assert public_event["path"] == "/api/tournaments"
    assert public_event["resource"] == "tournaments"
    assert public_event["entity_id"] is None
    assert "tournament-secret" not in json.dumps(public_event)
    assert staff_event["path"].endswith("/tournament-secret/stages/stage-secret")


def test_only_global_staff_roles_receive_internal_stream_scope():
    assert change_events.visibility_scope_for_user(None) == "public"
    assert change_events.visibility_scope_for_user({"role": "player"}) == "public"
    assert change_events.visibility_scope_for_user({
        "role": "player",
        "is_tournament_staff": True,
    }) == "public"
    # Moderatoren moderieren; die vollen Pfade interner Änderungen braucht die Moderationsseite nicht.
    assert change_events.visibility_scope_for_user({"role": "moderator"}) == "public"
    confirmed = {"mfa_enabled": True, "auth_mfa_verified": True}
    assert change_events.visibility_scope_for_user({"role": "tournament_admin", **confirmed}) == "staff"
    assert change_events.visibility_scope_for_user({"role": "superadmin", **confirmed}) == "staff"


def test_staff_stream_needs_the_confirmed_second_factor():
    # #1469: die vollen Pfade interner Änderungen gehören zur Verwaltung - wie jeder Adminbereich nur mit bestätigter
    # Zwei-Faktor-Anmeldung. Ohne bleibt der öffentliche Strom, mit denselben Ereignissen wie für Besucher.
    for role in ("tournament_admin", "club_admin", "superadmin"):
        assert change_events.visibility_scope_for_user({"role": role}) == "public"
        assert change_events.visibility_scope_for_user({"role": role, "mfa_enabled": True}) == "public"
        assert change_events.visibility_scope_for_user({"role": role, "mfa_enabled": True, "auth_mfa_verified": True}) == "staff"


def test_staff_stream_follows_the_confirmed_tournament_lead_from_role_or_grant():
    # Turnierleitung aus Rolle oder Freigabe (#1350) - beide nur mit bestätigter Zwei-Faktor-Anmeldung.
    confirmed = {"mfa_enabled": True, "auth_mfa_verified": True}
    role_lead = {"role": "tournament_admin"}
    granted_lead = {"role": "player", "areas": ["tournaments"]}
    for lead in (role_lead, granted_lead):
        assert change_events.visibility_scope_for_user({**lead, **confirmed}) == "staff"
        assert change_events.visibility_scope_for_user(lead) == "public"
        assert change_events.visibility_scope_for_user({**lead, "mfa_enabled": True}) == "public"
    # Andere Freigaben öffnen den Strom nicht; Moderation auch mit Zwei-Faktor nicht.
    assert change_events.visibility_scope_for_user({"role": "player", "areas": ["content"], **confirmed}) == "public"
    assert change_events.visibility_scope_for_user({"role": "moderator", **confirmed}) == "public"


def test_private_mutation_is_visible_to_staff_only():
    async def scenario():
        public_queue = asyncio.Queue()
        staff_queue = asyncio.Queue()
        change_events._subscribers.update({
            (public_queue, "public", "member-1"),
            (staff_queue, "staff", "moderator-1"),
        })

        await change_events.publish_api_change(
            "PATCH",
            "/api/users/private-user-id/role",
            200,
        )

        assert public_queue.empty()
        event_name, staff_event = staff_queue.get_nowait()
        assert event_name == "change"
        assert staff_event["visibility_scope"] == "staff"
        assert staff_event["path"] == "/api/users/private-user-id/role"

    asyncio.run(scenario())


def test_event_envelope_and_sse_id_are_stable_for_replay():
    event = change_events._build_api_change_event("POST", "/api/matches/match-1/result", 201)
    rendered = change_events._format_sse("change", event)

    assert event["event_type"] == "api.changed"
    assert event["entity_type"] == "matches"
    assert event["version"] == 1
    assert event["occurred_at"].endswith("Z")
    assert event["dedupe_key"].endswith(event["event_id"])
    assert rendered.startswith(f"id: {event['event_id']}\nevent: change\n")


def test_replay_returns_only_events_after_cursor_and_for_requested_scope():
    async def scenario():
        await change_events.publish_api_change("PATCH", "/api/tournaments/one", 200)
        cursor = change_events._event_buffer[-1]["event_id"]
        await change_events.publish_api_change("PATCH", "/api/matches/two", 200)
        await change_events.publish_api_change("PATCH", "/api/users/private", 200)

        public_replay, public_reset = change_events._replay_after(cursor, "public")
        staff_replay, staff_reset = change_events._replay_after(cursor, "staff")

        assert public_reset is False
        assert [event["resource"] for event in public_replay] == ["matches"]
        assert public_replay[0]["path"] == "/api/matches"
        assert staff_reset is False
        assert [event["resource"] for event in staff_replay] == ["matches", "users"]

    asyncio.run(scenario())


def test_unknown_replay_cursor_requires_snapshot_reset():
    replay, reset_required = change_events._replay_after("expired-event-id", "public")

    assert replay == []
    assert reset_required is True
    reset = change_events._reset_event("public", "replay_unavailable")
    assert reset["event_type"] == "stream.reset"
    assert reset["reset"] is True
    assert reset["visibility_scope"] == "public"


def test_stream_replays_change_after_last_event_id():
    class DisconnectedRequest:
        def __init__(self, last_event_id):
            self.headers = {"last-event-id": last_event_id}

        async def is_disconnected(self):
            return True

    async def scenario():
        await change_events.publish_api_change("PATCH", "/api/tournaments/one", 200)
        cursor = change_events._event_buffer[-1]["event_id"]
        await change_events.publish_api_change("PATCH", "/api/matches/two", 200)
        stream = change_events.change_event_stream(DisconnectedRequest(cursor), "public")
        return [chunk async for chunk in stream]

    chunks = asyncio.run(scenario())

    assert len(chunks) == 2
    assert "event: connected" in chunks[0]
    assert '"replayed":1' in chunks[0]
    assert "event: change" in chunks[1]
    assert '"resource":"matches"' in chunks[1]
    assert "/api/matches/two" not in chunks[1]


def test_stream_emits_exactly_one_reset_for_unknown_cursor():
    class DisconnectedRequest:
        headers = {"last-event-id": "cursor-from-an-old-process"}

        async def is_disconnected(self):
            return True

    async def scenario():
        stream = change_events.change_event_stream(DisconnectedRequest(), "public")
        return [chunk async for chunk in stream]

    chunks = asyncio.run(scenario())

    assert len(chunks) == 2
    assert sum("event: reset" in chunk for chunk in chunks) == 1
    assert '"reason":"replay_unavailable"' in chunks[1]
    assert "\nid: " not in chunks[1]


def test_queue_overflow_replaces_stale_changes_with_snapshot_reset():
    async def scenario():
        queue = asyncio.Queue(maxsize=1)
        change_events._subscribers.add((queue, "public", None))

        await change_events.publish_api_change("PATCH", "/api/tournaments/one", 200)
        await change_events.publish_api_change("PATCH", "/api/tournaments/two", 200)

        event_name, event = queue.get_nowait()
        assert event_name == "reset"
        assert event["reason"] == "queue_overflow"
        assert event["reset"] is True
        assert queue.empty()

    asyncio.run(scenario())


def test_refresh_and_stream_endpoints_do_not_publish_changes():
    async def scenario():
        await change_events.publish_api_change("POST", "/api/auth/refresh", 200)
        await change_events.publish_api_change("POST", "/api/changes/stream", 200)

    asyncio.run(scenario())
    assert list(change_events._event_buffer) == []


# Private Ressourcen: Direktnachrichten, Team-Chat und Benachrichtigungen sind
# nicht öffentlich. Ohne gezielte Ereignisse erfuhr ein normales Mitglied nie
# von seinen eigenen neuen Nachrichten und musste abfragen.

def test_private_user_change_reaches_only_its_targets():
    async def scenario():
        alice = asyncio.Queue()
        bob = asyncio.Queue()
        staff = asyncio.Queue()
        guest = asyncio.Queue()
        change_events._subscribers.update({
            (alice, "public", "alice-id"),
            (bob, "public", "bob-id"),
            (staff, "staff", "moderator-id"),
            (guest, "public", None),
        })

        await change_events.publish_user_change(["alice-id"], "messages")

        event_name, event = alice.get_nowait()
        assert event_name == "change"
        assert event["resource"] == "messages"
        assert event["path"] == "/api/messages"
        assert event["visibility_scope"] == "user"
        # Staff bekommt fremde private Ereignisse nicht, Gäste und andere Mitglieder erst recht nicht.
        assert bob.empty()
        assert staff.empty()
        assert guest.empty()
        return event

    event = asyncio.run(scenario())
    rendered = change_events._format_sse("change", event)
    assert change_events.TARGETS_KEY not in rendered
    assert "alice-id" not in rendered


def test_private_user_change_ignores_missing_targets():
    asyncio.run(change_events.publish_user_change([None, ""], "notifications"))
    asyncio.run(change_events.publish_user_change(["alice-id"], ""))

    assert list(change_events._event_buffer) == []


def test_replay_of_private_change_only_for_its_target():
    async def scenario():
        await change_events.publish_api_change("PATCH", "/api/tournaments/one", 200)
        cursor = change_events._event_buffer[-1]["event_id"]
        await change_events.publish_user_change(["alice-id", "bob-id"], "teams")
        return (
            change_events._replay_after(cursor, "public", "alice-id"),
            change_events._replay_after(cursor, "public", "carol-id"),
            change_events._replay_after(cursor, "staff", "moderator-id"),
            change_events._replay_after(cursor, "public", None),
        )

    (alice, _), (carol, _), (staff, _), (guest, _) = asyncio.run(scenario())

    assert [event["resource"] for event in alice] == ["teams"]
    assert change_events.TARGETS_KEY not in alice[0]
    assert carol == []
    assert staff == []
    assert guest == []


def test_signed_in_stream_replays_own_private_change_only():
    class DisconnectedRequest:
        def __init__(self, last_event_id):
            self.headers = {"last-event-id": last_event_id}

        async def is_disconnected(self):
            return True

    async def scenario(user_id):
        change_events._event_buffer.clear()
        await change_events.publish_api_change("PATCH", "/api/tournaments/one", 200)
        cursor = change_events._event_buffer[-1]["event_id"]
        await change_events.publish_user_change(["alice-id"], "notifications")
        stream = change_events.change_event_stream(DisconnectedRequest(cursor), "public", user_id)
        return [chunk async for chunk in stream]

    own = asyncio.run(scenario("alice-id"))
    other = asyncio.run(scenario("bob-id"))

    assert '"replayed":1' in own[0]
    assert '"resource":"notifications"' in own[1]
    assert '"replayed":0' in other[0]
    assert len(other) == 1


# Live-Nachladen je Turnier (#1801): Jede Änderung war eine öffentliche Meldung „tournaments“ ohne Turnier - alle offenen
# Turnierseiten, auch die anderer Turniere, luden nach. Die Meldung nennt jetzt das Turnier (und sein Event, weil sich
# die Turniere eines Events Stationen teilen) - aber nur, wenn beides öffentlich ist. Sonst bleibt sie ohne Kennung und
# lädt wie bisher überall.

async def add_tournament(db, tid="t-1", **fields):
    doc = {"id": tid, "slug": f"cup-{tid}", "status": "live", "visibility": "public", "event_id": None, **fields}
    await db.tournaments.insert_one(dict(doc))
    return doc


def publish(method, path):
    asyncio.run(change_events.publish_api_change(method, path, 200))
    return change_events._event_buffer[-1]


def public_view(event):
    return change_events._event_for_scope(event, "public")


def test_public_tournament_change_names_its_tournament(scope_db):
    asyncio.run(add_tournament(scope_db, "t-1"))

    by_id = public_view(publish("POST", "/api/tournaments/t-1/live-queue/call"))
    by_slug = public_view(publish("POST", "/api/tournaments/cup-t-1/register"))

    for event in (by_id, by_slug):
        assert event["tournament_id"] == "t-1"
        assert event["parent_event_id"] is None
        assert event["path"] == "/api/tournaments"
        assert "cup-t-1" not in json.dumps(event)


def test_match_changes_name_the_tournament_of_the_match(scope_db):
    async def seed():
        await add_tournament(scope_db, "t-1")
        await scope_db.matches_v2.insert_one({"id": "m-1", "tournament_id": "t-1"})

    asyncio.run(seed())

    result = public_view(publish("POST", "/api/matches/m-1/result"))
    removal = public_view(publish("POST", "/api/matches-v2/t-1/removal"))

    assert result["tournament_id"] == "t-1" and result["resource"] == "matches"
    assert removal["tournament_id"] == "t-1" and removal["resource"] == "matches-v2"
    assert "m-1" not in json.dumps(result)


@pytest.mark.parametrize("fields", [
    {"status": "draft"},
    {"is_public": False},
    {"visibility": "members"},
    {"visibility": "internal"},
    {"visibility": "community"},
])
def test_hidden_tournament_change_stays_without_identifiers(scope_db, fields):
    asyncio.run(add_tournament(scope_db, "t-hidden", **fields))

    event = publish("POST", "/api/tournaments/t-hidden/register")
    public = public_view(event)
    staff = change_events._event_for_scope(event, "staff")

    assert public.get("tournament_id") is None
    assert public.get("parent_event_id") is None
    assert "t-hidden" not in json.dumps(public)
    # Die Verwaltung sieht den rohen Pfad ohnehin - dort darf die Kennung stehen.
    assert staff["tournament_id"] == "t-hidden"
    assert not [key for key in (*public, *staff) if key.startswith("_")]


def test_tournament_of_a_public_event_also_names_the_event(scope_db):
    async def seed():
        await scope_db.events.insert_one({"id": "e-1", "status": "live", "visibility": "public"})
        await add_tournament(scope_db, "t-1", event_id="e-1")

    asyncio.run(seed())

    event = public_view(publish("POST", "/api/tournaments/t-1/live-queue/start"))

    assert event["tournament_id"] == "t-1"
    assert event["parent_event_id"] == "e-1"


@pytest.mark.parametrize("event_fields", [{"visibility": "members"}, {"status": "draft"}, None])
def test_public_tournament_of_a_hidden_event_stays_without_identifiers(scope_db, event_fields):
    # Ohne die Kennung des Events wüssten Seiten mit geteilten Stationen nicht, ob die Änderung sie betrifft - und die
    # Kennung eines internen Events gehört nicht in eine öffentliche Meldung. Also gar keine Kennung: alle laden nach.
    async def seed():
        if event_fields is not None:
            await scope_db.events.insert_one({"id": "e-1", "status": "live", "visibility": "public", **event_fields})
        await add_tournament(scope_db, "t-1", event_id="e-1")

    asyncio.run(seed())

    event = publish("POST", "/api/tournaments/t-1/live-queue/start")
    public = public_view(event)

    assert public.get("tournament_id") is None
    assert public.get("parent_event_id") is None
    assert "e-1" not in json.dumps(public)
    assert change_events._event_for_scope(event, "staff")["parent_event_id"] == "e-1"


@pytest.mark.parametrize("method, path", [
    ("POST", "/api/stations/s-1/assign/m-1"),  # Stationen teilen sich die Turniere eines Events
    ("POST", "/api/tournaments/onsite/redeem"),  # gehört zu keinem Turnier
    ("POST", "/api/tournaments"),  # neues Turnier: die Übersichten laden ohnehin
    ("PATCH", "/api/tournaments/t-1"),  # das Turnier selbst (Event, Sichtbarkeit): alle laden nach
    ("POST", "/api/tournaments/unknown/register"),
    ("POST", "/api/matches/unknown/result"),
    ("PATCH", "/api/events/e-1"),
])
def test_changes_without_a_single_tournament_stay_without_identifiers(scope_db, method, path):
    async def seed():
        await add_tournament(scope_db, "t-1")
        await scope_db.matches_v2.insert_one({"id": "m-1", "tournament_id": "t-1"})

    asyncio.run(seed())

    public = public_view(publish(method, path))

    assert public.get("tournament_id") is None


def test_display_event_names_only_a_visible_tournament(scope_db):
    # Anzeige-Ereignisse (#1553) folgen derselben Regel: Turnier und Spiele nur, wenn das Turnier öffentlich ist.
    async def scenario():
        await add_tournament(scope_db, "t-open")
        await add_tournament(scope_db, "t-closed", visibility="members")
        await change_events.publish_tournament_event("t-open", "walkover", match_ids=["m-open"])
        await change_events.publish_tournament_event("t-closed", "walkover", match_ids=["m-closed"])

    asyncio.run(scenario())
    shown, hidden = change_events._event_buffer

    public_shown = public_view(shown)
    assert public_shown["tournament_id"] == "t-open"
    assert public_shown["tournament_event"] == {"type": "walkover", "tournament_id": "t-open", "match_ids": ["m-open"]}

    public_hidden = public_view(hidden)
    assert public_hidden["tournament_event"] == {"type": "walkover", "tournament_id": None, "match_ids": []}
    assert "t-closed" not in json.dumps(public_hidden)
    assert "m-closed" not in json.dumps(public_hidden)
    staff_hidden = change_events._event_for_scope(hidden, "staff")
    assert staff_hidden["tournament_event"]["tournament_id"] == "t-closed"
    assert staff_hidden["tournament_event"]["match_ids"] == ["m-closed"]


def test_change_is_published_even_if_the_tournament_lookup_fails(monkeypatch):
    def broken():
        raise RuntimeError("Datenbank weg")

    monkeypatch.setattr(database, "get_db", broken)

    event = public_view(publish("POST", "/api/tournaments/t-1/register"))

    assert event["resource"] == "tournaments"
    assert event.get("tournament_id") is None
