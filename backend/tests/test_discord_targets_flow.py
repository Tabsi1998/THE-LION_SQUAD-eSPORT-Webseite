"""Discord I–III (#300, #301, #303, #566) durch die echte Anwendung: der Bot schickt alles, je Ziel
ein Kanal, Schalter je Ereignis, Ankündigungen genau einmal - und die eine Regel über allem: Was
privat ist, landet nie in einem öffentlichen Kanal, ein privates Ziel fällt nie auf ein
öffentliches zurück, und ohne Bot wird nichts gesendet (kein Webhook-Rückfall)."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import discord_service  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import achievement_queue, discord_announcements, discord_bot  # noqa: E402

COMMUNITY = "100000000000000001"
NEWS = "100000000000000002"
BOARD = "100000000000000003"
OPS = "100000000000000004"
# Erfundener Wert in Token-Form (lang genug, ohne Leerzeichen) - bewusst ohne Zufall, damit kein Scanner anschlägt.
TOKEN = "test" * 6 + ".fake." + "token" * 8


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def posted(monkeypatch):
    """Der Bot gilt als verbunden: jedes Embed wird festgehalten statt an Discord geschickt; Einstellungen starten ihn nicht wirklich."""
    calls = []

    async def fake_send(channel_id, embed):
        calls.append({"channel_id": channel_id, "title": embed.get("title"), "description": embed.get("description"),
                      "url": embed.get("url"), "fields": embed.get("fields"), "image": (embed.get("image") or {}).get("url")})
        return {"ok": True, "message_id": f"m{len(calls)}", "channel_id": channel_id}

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "send_embed", fake_send)
    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    return calls


async def admin(flow):
    user = await flow.add_user(role="club_admin")
    flow.act_as(user)
    return user


async def configure(flow, **body):
    await admin(flow)
    response = await flow.put("/api/settings/discord", json={"channels": {"community": COMMUNITY}, "enabled": True,
                                                              "bot_token": TOKEN, "bot_enabled": True, **body})
    assert response.status_code == 200, response.text


# ---------------------------------------------------------------- Ziele und Schalter

@pytest.mark.asyncio
async def test_public_targets_fall_back_to_community_private_targets_never(flow, posted):
    await configure(flow, events={"news.published": True, "membership.application": True})

    assert (await discord_service.send_event("news.published", "News", "Text", item={"visibility": "public"}))["ok"] is True
    assert posted[-1]["channel_id"] == COMMUNITY, "ohne eigenen Kanal geht News an Community"

    board = await discord_service.send_event("membership.application", "Antrag", "neu")
    assert board["ok"] is False and board["reason"] == "board_channel_missing" and "Kein Kanal" in board["error"]
    assert all(call["channel_id"] == COMMUNITY for call in posted) and len(posted) == 1, "der Vorstand fällt nie auf Community zurück"

    await flow.put("/api/settings/discord", json={"channels": {"news": NEWS, "board": BOARD}})
    await discord_service.send_event("news.published", "News 2", "Text", item={"visibility": "public"})
    assert posted[-1]["channel_id"] == NEWS
    await discord_service.send_event("membership.application", "Antrag", "neu")
    assert posted[-1]["channel_id"] == BOARD

    await flow.put("/api/settings/discord", json={"channels": {"community": ""}})
    await discord_service.send_event("membership.application", "Antrag 2", "neu")
    assert posted[-1]["channel_id"] == BOARD, "privat braucht die Community nicht"
    assert (await discord_service.send_event("tournament.live", "Turnier", item={"visibility": "public"}))["reason"] == "channel_missing"

    log = await flow.db.email_logs.find_one({"channel": "discord", "status": "sent", "target": "board"}, {"_id": 0}, sort=[("created_at", -1)])
    assert log["channel_id"] == BOARD and log["message_id"], "Kanal und Nachrichten-ID stehen im Versand-Log - die Grundlage fürs Bearbeiten"


@pytest.mark.asyncio
@pytest.mark.parametrize("visibility", ["members", "internal"])
async def test_private_content_never_reaches_a_public_target(flow, posted, visibility):
    await configure(flow, events={"news.published": True, "event.announced": True})
    for key in ("news.published", "event.announced", "tournament.live", "f1.new_leader"):
        result = await discord_service.send_event(key, "Geheim", "nur intern", item={"visibility": visibility})
        assert result == {"ok": False, "reason": "private_visibility"}
    assert (await discord_service.send_public_discord({"is_public": False}, "x", event_key="tournament.live"))["reason"] == "private_visibility"
    assert posted == []


@pytest.mark.asyncio
async def test_switches_new_events_are_off_until_the_operator_turns_them_on(flow, posted):
    await configure(flow)
    assert (await discord_service.send_event("news.published", "News", item={"visibility": "public"}))["reason"] == "event_disabled"
    assert (await discord_service.send_event("event.announced", "Event", item={"visibility": "public"}))["reason"] == "event_disabled"
    assert (await discord_service.send_event("tournament.live", "Turnier", item={"visibility": "public"}))["ok"] is True, "was es schon gab, bleibt an"

    await flow.put("/api/settings/discord", json={"events": {"tournament.live": False, "news.published": True}})
    assert (await discord_service.send_event("tournament.live", "Turnier", item={"visibility": "public"}))["reason"] == "event_disabled"
    assert (await discord_service.send_event("news.published", "News", item={"visibility": "public"}))["ok"] is True
    assert len(posted) == 2

    await flow.put("/api/settings/discord", json={"enabled": False})
    assert (await discord_service.send_event("news.published", "News", item={"visibility": "public"}))["reason"] == "disabled"


@pytest.mark.asyncio
async def test_without_the_bot_nothing_is_sent_and_the_log_says_why(flow, posted):
    """Bot aus = keine Meldung (#566) - kein Rückfall, aber der Grund steht in Worten im Versand-Log."""
    await configure(flow, events={"news.published": True})
    await flow.put("/api/settings/discord", json={"bot_enabled": False})
    result = await discord_service.send_event("news.published", "News", item={"visibility": "public"})
    assert result["ok"] is False and result["reason"] == "bot_off" and "Bot verbinden" in result["error"]
    assert posted == []
    log = await flow.db.email_logs.find_one({"channel": "discord"}, {"_id": 0})
    assert log["status"] == "skipped" and log["reason"] == "bot_off" and log["payload"]["title"] == "News"
    # Eingeschaltet, aber nicht verbunden: der echte Bot sagt es genauso, ohne Netz.
    assert await discord_bot.BotRunner().send_embed(COMMUNITY, {"title": "x"}) == {"ok": False, "reason": "bot_offline"}


@pytest.mark.asyncio
async def test_a_channel_the_bot_may_not_write_to_is_a_failed_attempt_with_a_click_path(flow, posted, monkeypatch):
    await configure(flow, events={"news.published": True})

    async def refused(channel_id, embed):
        return {"ok": False, "reason": "forbidden"}

    monkeypatch.setattr(discord_bot.bot, "send_embed", refused)
    result = await discord_service.send_event("news.published", "News", item={"visibility": "public"})
    assert result["ok"] is False and result["reason"] == "forbidden" and "Berechtigungen" in result["error"]
    log = await flow.db.email_logs.find_one({"channel": "discord"}, {"_id": 0})
    assert log["status"] == "failed" and log["reason"] == "forbidden" and log["channel_id"] == COMMUNITY

    dashboard = (await flow.get("/api/admin/dashboard")).json()
    assert [entry["target"] for entry in dashboard["discord_broken"]] == ["community"]
    assert "Berechtigungen" in dashboard["discord_broken"][0]["text"]
    status = (await flow.get("/api/settings/discord")).json()["target_status"]["community"]
    assert status["last"]["reason"] == "forbidden"
    flow.act_as(await flow.add_user(role="tournament_admin"))
    assert (await flow.get("/api/admin/dashboard")).json()["discord_broken"] == []


@pytest.mark.asyncio
async def test_settings_are_admin_only_validated_and_never_carry_the_token(flow, posted):
    await configure(flow, channels={"community": COMMUNITY, "news": NEWS})
    shown = await flow.get("/api/settings/discord")
    assert TOKEN not in shown.text and "bot_token" not in shown.text
    data = shown.json()
    assert data["channels"] == {"community": COMMUNITY, "news": NEWS, "events": "", "board": "", "ops": "", "test": ""}
    assert data["configured"] is True
    assert data["target_status"]["news"]["delivers_to"] == "news" and data["target_status"]["news"]["configured"] is True
    assert data["target_status"]["events"]["delivers_to"] == "community" and data["target_status"]["events"]["configured"] is False
    assert data["target_status"]["board"]["private"] is True and data["target_status"]["board"]["delivers_to"] is None
    keys = {event["key"] for event in data["events"]}
    assert keys == set(discord_service.EVENTS) and "achievement.awarded" not in keys, "Erfolge gehen in keinen Kanal mehr (#566)"
    assert {event["key"]: event["enabled"] for event in data["events"]}["news.published"] is False

    assert (await flow.put("/api/settings/discord", json={"channels": {"presse": NEWS}})).status_code == 400
    assert (await flow.put("/api/settings/discord", json={"channels": {"news": "abc"}})).status_code == 400
    assert (await flow.put("/api/settings/discord", json={"events": {"alles.senden": True}})).status_code == 400
    # Alte Webhook-Felder werden ignoriert, nicht gespeichert.
    ignored = await flow.put("/api/settings/discord", json={"webhook_url": "https://discord.com/api/webhooks/1/x"})
    assert ignored.status_code == 200 and ignored.json()["changed"] is False
    assert "webhook_url" not in await flow.db.settings.find_one({"id": "discord"}, {"_id": 0})

    test = await flow.post("/api/settings/discord/test?target=events")
    assert test.json()["ok"] is True and test.json()["target"] == "community" and posted[-1]["channel_id"] == COMMUNITY
    assert (await flow.post("/api/settings/discord/test?target=board")).json()["reason"] == "board_channel_missing"
    assert (await flow.post("/api/settings/discord/test?target=achievements")).status_code == 422

    channels = (await flow.get("/api/settings/discord/channels")).json()
    assert channels["ok"] is False and channels["reason"] == "offline" and "Kanal-ID" in channels["text"] and channels["channels"] == []

    flow.act_as(await flow.add_user(role="tournament_admin"))
    assert (await flow.get("/api/settings/discord")).status_code == 403
    assert (await flow.get("/api/settings/discord/channels")).status_code == 403


@pytest.mark.asyncio
async def test_old_webhook_fields_are_removed_by_the_migration(flow):
    await flow.db.settings.update_one({"id": "discord"}, {"$set": {
        "id": "discord", "webhook_url": "enc:v1:x", "ops_webhook_url": "enc:v1:y", "username": "Bot", "avatar_url": "a.png",
        "targets": {"news": {"webhook_url": "enc:v1:z", "username": "News"}}, "bot_enabled": True, "events": {"news__published": True},
    }}, upsert=True)
    from services.migrations import migrate_discord_webhooks_to_bot

    assert "webhook_url" in await migrate_discord_webhooks_to_bot(flow.db)
    stored = await flow.db.settings.find_one({"id": "discord"}, {"_id": 0})
    assert not any(key in stored for key in ("webhook_url", "ops_webhook_url", "username", "avatar_url", "targets"))
    assert stored["bot_enabled"] is True and stored["events"] == {"news__published": True}, "Bot und Schalter bleiben"
    assert await migrate_discord_webhooks_to_bot(flow.db) == "nothing to remove"


# ---------------------------------------------------------------- Ankündigungen

async def add_news(flow, **fields):
    doc = {"id": fields.pop("id", "n1"), "title": "Saisonstart", "slug": "saisonstart", "excerpt": "Es geht **los**.", "content": "<p>lang</p>",
           "banner_url": "uploads/public/banner.webp", "visibility": "public", "published": True,
           "published_at": now_utc().isoformat(), **fields}
    await flow.db.news_posts.insert_one(dict(doc))
    return doc


@pytest.mark.asyncio
async def test_news_is_announced_once_with_image_and_link(flow, posted):
    await configure(flow, events={"news.published": True})
    await add_news(flow)
    await add_news(flow, id="n2", slug="morgen", published_at=(now_utc() + timedelta(hours=3)).isoformat())
    await add_news(flow, id="n3", slug="intern", visibility="members")
    await add_news(flow, id="n4", slug="leise", discord_skip=True)
    await add_news(flow, id="n5", slug="alt", published_at=(now_utc() - timedelta(days=3)).isoformat())
    await add_news(flow, id="n6", slug="entwurf", published=False)

    result = await discord_announcements.announce_due()
    assert result["outcomes"] == {"sent": 1, "private_visibility": 1, "author_opt_out": 1, "too_old": 1}
    assert len(posted) == 1
    message = posted[0]
    assert message["title"] == "📰 Saisonstart" and message["description"] == "Es geht los."
    assert message["url"].endswith("/news/saisonstart") and message["image"].endswith("/api/static/uploads/public/banner.webp")

    assert (await discord_announcements.announce_due())["news"] == 0, "jede News wird genau einmal geprüft"
    assert len(posted) == 1
    assert (await flow.db.news_posts.find_one({"id": "n2"})).get("discord_checked_at") is None, "geplante News wartet auf ihre Zeit"


@pytest.mark.asyncio
async def test_switch_off_marks_as_checked_so_nothing_is_posted_later(flow, posted):
    await configure(flow)
    await add_news(flow)
    assert (await discord_announcements.announce_due())["outcomes"] == {"event_disabled": 1}
    await flow.put("/api/settings/discord", json={"events": {"news.published": True}})
    assert (await discord_announcements.announce_due())["news"] == 0
    assert posted == [], "wer den Schalter später einschaltet, bekommt nicht das Archiv in den Kanal"


@pytest.mark.asyncio
async def test_event_announcement_names_time_in_vienna_place_and_deadline(flow, posted):
    await configure(flow, events={"event.announced": True})
    base = {"visibility": "public", "status": "scheduled", "created_at": now_utc().isoformat()}
    start = (now_utc() + timedelta(days=10)).replace(hour=17, minute=0, second=0, microsecond=0)
    await flow.db.events.insert_one({**base, "id": "e1", "name": "LAN-Party", "slug": "lan", "description": "Zwei Tage zocken.",
                                     "start_date": start.isoformat(), "end_date": (start + timedelta(days=1)).isoformat(),
                                     "location": "Vereinsheim", "city": "Telfs", "has_registration": True, "max_participants": 40,
                                     "registration_closes_at": (start - timedelta(days=2)).isoformat(), "banner_url": "uploads/public/lan.webp"})
    await flow.db.events.insert_one({**base, "id": "e2", "name": "Vorstandssitzung", "visibility": "internal", "start_date": start.isoformat()})
    await flow.db.events.insert_one({**base, "id": "e3", "name": "Entwurf", "status": "draft", "start_date": start.isoformat()})
    await flow.db.events.insert_one({**base, "id": "e4", "name": "Vorbei", "start_date": (now_utc() - timedelta(days=1)).isoformat()})

    result = await discord_announcements.announce_due()
    assert result["outcomes"] == {"sent": 1, "private_visibility": 1, "past_event": 1}
    message = posted[0]
    assert message["title"] == "📅 LAN-Party" and message["url"].endswith("/events/lan") and message["image"].endswith("/uploads/public/lan.webp")
    fields = {field["name"]: field["value"] for field in message["fields"]}
    assert fields["Wo"] == "Vereinsheim, Telfs" and fields["Plätze"] == "40"
    assert fields["Wann"].endswith("Uhr – " + discord_announcements.vienna(start + timedelta(days=1), with_time=False)) or "Uhr" in fields["Wann"]
    assert "Uhr" in fields["Anmeldung bis"]
    assert (await flow.db.events.find_one({"id": "e3"})).get("discord_checked_at") is None


def test_times_are_vienna_time():
    assert discord_announcements.vienna("2026-07-01T16:00:00+00:00") == "01.07.2026, 18:00 Uhr"
    assert discord_announcements.vienna("2026-12-01T16:00:00+00:00") == "01.12.2026, 17:00 Uhr"
    assert discord_announcements.plain_text("<p>Hallo **Welt**</p>\n\n# Titel") == "Hallo Welt Titel"


@pytest.mark.asyncio
async def test_preview_shows_the_same_embed_and_the_honest_verdict(flow, posted):
    await configure(flow, events={"news.published": True})
    item = {"title": "Saisonstart", "slug": "saisonstart", "excerpt": "Es geht los.", "banner_url": "uploads/public/banner.webp", "visibility": "public"}
    flow.act_as(await flow.add_user(role="club_admin"))
    preview = (await flow.post("/api/settings/discord/preview", json={"kind": "news", "item": item})).json()
    assert preview["would_send"] is True and preview["target"] == "community"
    assert preview["embed"]["title"] == "📰 Saisonstart" and preview["embed"]["url"].endswith("/news/saisonstart")
    assert preview["embed"]["image"]["url"].endswith("/api/static/uploads/public/banner.webp")

    private = (await flow.post("/api/settings/discord/preview", json={"kind": "news", "item": {**item, "visibility": "members"}})).json()
    assert private["would_send"] is False and private["reason"] == "private_visibility"
    skipped = (await flow.post("/api/settings/discord/preview", json={"kind": "news", "item": {**item, "discord_skip": True}})).json()
    assert skipped["reason"] == "author_opt_out"
    # Ohne Bot und ohne Kanal sagt die Vorschau genau das.
    await flow.put("/api/settings/discord", json={"bot_enabled": False})
    assert (await flow.post("/api/settings/discord/preview", json={"kind": "news", "item": item})).json()["reason"] == "bot_off"
    await flow.put("/api/settings/discord", json={"bot_enabled": True, "channels": {"community": ""}})
    assert (await flow.post("/api/settings/discord/preview", json={"kind": "news", "item": item})).json()["reason"] == "no_channel"
    assert posted == [], "die Vorschau sendet nie"

    flow.act_as(await flow.add_user(role="player"))
    assert (await flow.post("/api/settings/discord/preview", json={"kind": "news", "item": item})).status_code == 403


@pytest.mark.asyncio
async def test_board_gets_a_hint_without_names(flow, posted):
    await configure(flow, channels={"community": COMMUNITY, "board": BOARD}, events={"membership.application": True, "contact.request": True})
    flow.act_as(None)
    sent = await flow.post("/api/contact/submit", json={"name": "Paula Beispiel", "email": "paula@lionsquad-test.at", "topic": "sponsorship",
                                                          "subject": "Sponsoring-Anfrage von Paula",
                                                          "message": "Ich möchte euch unterstützen, ruft mich an: 0660 1234567", "accept_privacy": True})
    assert sent.status_code in (200, 201), sent.text
    message = posted[-1]
    assert message["channel_id"] == BOARD and message["url"].endswith("/admin/contact")
    blob = f"{message['title']} {message['description']} {message['fields']}"
    for secret in ("Paula", "paula@lionsquad-test.at", "0660", "unterstützen"):
        assert secret not in blob


@pytest.mark.asyncio
async def test_failed_message_can_be_resent_to_the_same_target_only(flow, posted):
    await configure(flow, channels={"community": COMMUNITY, "board": BOARD})
    await flow.db.email_logs.insert_one({"id": "log1", "channel": "discord", "target": "board", "event_key": "membership.application",
                                         "status": "failed", "reason": "forbidden", "title": "Antrag",
                                         "payload": {"title": "Antrag", "description": "neu", "color": 1, "url": "/admin/membership-applications"}})
    await flow.db.email_logs.insert_one({"id": "log2", "channel": "discord", "target": "community", "status": "sent", "payload": {"title": "x"}})
    again = await flow.post("/api/settings/discord/resend/log1")
    assert again.json()["ok"] is True and posted[-1]["channel_id"] == BOARD
    assert (await flow.db.email_logs.find_one({"id": "log1"}))["status"] == "resent"
    assert (await flow.post("/api/settings/discord/resend/log2")).status_code == 409
    assert (await flow.post("/api/settings/discord/resend/gibtsnicht")).status_code == 404


# ---------------------------------------------------------------- Erfolge sofort und gebündelt (#301) - nur noch an die Person (#566)

GROUP = {"code": "g_pub", "name": "Turniersiege", "public": True}
TIERS = [
    {"code": "t1", "name": "Erster Sieg", "description": "Ein Turnier gewonnen", "points": 50, "level": 1, "group_code": "g_pub"},
    {"code": "t2", "name": "Seriensieger", "description": "Drei Turniere", "points": 150, "level": 3, "group_code": "g_pub"},
]


async def player(flow, name, **fields):
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    return user


@pytest.mark.asyncio
async def test_queue_holds_each_person_once_and_a_result_queues_everyone(flow, monkeypatch):
    monkeypatch.setattr(achievement_queue, "EVAL_DELAY_SECONDS", -1)
    assert await achievement_queue.request_evaluation(["u1", "u2", "u1", None], "match_result") == 2
    await achievement_queue.request_evaluation(["u1"], "again")
    assert await flow.db.achievement_eval_queue.count_documents({}) == 2

    evaluated = []

    async def fake_eval(user_id):
        evaluated.append(user_id)
        return 1

    import badges
    monkeypatch.setattr(badges, "evaluate_user_progress", fake_eval)
    result = await achievement_queue.process_queue()
    assert result == {"evaluated": 2, "awarded": 2} and sorted(evaluated) == ["u1", "u2"]
    assert await flow.db.achievement_eval_queue.count_documents({}) == 0
    assert (await achievement_queue.process_queue())["evaluated"] == 0, "idempotent"


@pytest.mark.asyncio
async def test_sweep_queues_recently_active_and_once_a_day_everyone(flow):
    active, sleepy = await player(flow, "aktiv"), await player(flow, "ruhig")
    await flow.db.auth_sessions.insert_one({"user_id": active["id"], "last_active": now_utc()})
    await flow.db.auth_sessions.insert_one({"user_id": sleepy["id"], "last_active": now_utc() - timedelta(days=2)})
    assert (await achievement_queue.sweep())["queued"] == 1
    first = await achievement_queue.scheduled_sweep()
    assert first["everyone"] is True and first["queued"] >= 2
    assert (await achievement_queue.scheduled_sweep())["everyone"] is False


@pytest.mark.asyncio
async def test_awards_are_bundled_into_one_notification_and_never_into_a_channel(flow, posted, monkeypatch):
    await configure(flow)
    paula = await player(flow, "paula", privacy_public_profile=True)
    for tier in TIERS:
        await achievement_queue.note_award(paula["id"], tier, GROUP)
    assert (await achievement_queue.flush_awards())["users"] == 0, "erst nach einer Minute - der Turnierabschluss soll nicht zehn Meldungen erzeugen"

    monkeypatch.setattr(achievement_queue, "BUNDLE_WINDOW_SECONDS", -1)
    result = await achievement_queue.flush_awards()
    assert result == {"users": 1, "notified": 1}
    assert posted == [], "seit #566 erfährt der Kanal nichts mehr - die Gratulation geht an die Person (#568)"
    notes = await flow.db.notifications.find({"user_id": paula["id"], "kind": "achievement"}).to_list(10)
    assert len(notes) == 1 and notes[0]["title"] == "2 Erfolge freigeschaltet"
    assert await flow.db.achievement_outbox.count_documents({}) == 0


@pytest.mark.asyncio
async def test_the_person_always_learns_about_it_public_profile_or_not(flow, posted, monkeypatch):
    await configure(flow)
    monkeypatch.setattr(achievement_queue, "BUNDLE_WINDOW_SECONDS", -1)
    privat = await player(flow, "privat", privacy_public_profile=False)
    offen = await player(flow, "offen", privacy_public_profile=True)
    await achievement_queue.note_award(privat["id"], TIERS[0], GROUP)
    await achievement_queue.note_award(offen["id"], TIERS[0], {**GROUP, "public": False, "name": "Vereinsmitglied"})
    await achievement_queue.note_award(offen["id"], TIERS[1], {**GROUP, "is_negative": True})
    result = await achievement_queue.flush_awards()
    assert result["notified"] == 2 and posted == []
    assert await flow.db.notifications.count_documents({"kind": "achievement"}) == 2


@pytest.mark.asyncio
async def test_every_automatic_achievement_can_actually_be_reached(flow):
    from achievement_catalog import ACHIEVEMENT_TIERS
    from badges import compute_user_progress

    counters = await compute_user_progress((await flow.add_user(role="player"))["id"])
    automatic = [tier for tier in ACHIEVEMENT_TIERS if not tier.get("manual_only")]
    assert automatic, "der Katalog ist leer"
    unreachable = [tier["code"] for tier in automatic if not tier.get("condition_key") or not tier.get("progress_target") or tier["condition_key"] not in counters]
    assert unreachable == [], f"Stufen ohne Zähler, die nie jemand bekommt: {unreachable}"
