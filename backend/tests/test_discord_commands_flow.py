"""Discord V Teil 2 (#573) durch die echte Anwendung: Link-Knöpfe unter den Meldungen (Anmeldung, Check-in,
Bracket, Event, News, Stream mit Profil, Fast Lap, Vorstand, Direktnachricht „Profil“) - mit voller Adresse,
auch beim erneuten Senden, in der Vorschau und in den Beispielen; dazu die Antworten der fünf neuen Befehle:
nur verknüpft, was die eigene Person betrifft, nie Beitrags- oder Zahlungsdaten, nie Daten anderer."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import discord_announcements, discord_bot, discord_bracket, discord_commands, discord_threads  # noqa: E402

COMMUNITY = "100000000000000001"
EVENTS = "100000000000000003"
BOARD = "100000000000000005"
DISCORD_ID = "200000000000000001"
TOKEN = "test" * 6 + ".fake." + "token" * 8


class FakeDiscord:
    def __init__(self):
        self.sent: list[dict] = []
        self.edited: list[dict] = []
        self.dms: list[dict] = []

    async def send_embed(self, channel_id, embed, buttons=None, files=None):
        self.sent.append({"channel_id": channel_id, "embed": embed, "buttons": buttons})
        return {"ok": True, "message_id": f"m{len(self.sent)}", "channel_id": channel_id}

    async def edit_embed(self, channel_id, message_id, embed, buttons=None, files=None):
        self.edited.append({"channel_id": channel_id, "message_id": message_id, "embed": embed, "buttons": buttons})
        return {"ok": True, "message_id": message_id}

    async def pin_message(self, channel_id, message_id):
        return {"ok": True}

    async def create_thread(self, channel_id, message_id, name):
        return {"ok": True, "thread_id": f"th-{message_id}"}

    async def delete_message(self, channel_id, message_id):
        return {"ok": True}

    async def send_dm(self, discord_user_id, embed, buttons=None):
        self.dms.append({"to": discord_user_id, "embed": embed, "buttons": buttons})
        return {"ok": True, "message_id": f"d{len(self.dms)}"}


def labels(row):
    """Link-Knöpfe als Pfad, Rückruf-Knöpfe (#885) als ihre Kennung."""
    return [(button["label"], button["url"].split("://", 1)[-1].split("/", 1)[-1] if button.get("url") else f"id:{button['custom_id']}")
            for button in row["buttons"] or []]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def discord(monkeypatch):
    fake = FakeDiscord()
    for name in ("send_embed", "edit_embed", "pin_message", "create_thread", "delete_message", "send_dm"):
        monkeypatch.setattr(discord_bot.bot, name, getattr(fake, name))

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    discord_bracket._dirty.clear()
    return fake


async def configure(flow, **body):
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    response = await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_enabled": True, "channels": {"community": COMMUNITY, "events": EVENTS, "board": BOARD}, **body})
    assert response.status_code == 200, response.text
    return admin


async def linked(flow, name="paula"):
    user = await flow.add_user(role="player", name=name)
    await flow.db.platform_links.insert_one({"id": f"l-{name}", "user_id": user["id"], "platform": "discord", "external_id": DISCORD_ID, "handle": name})
    return user


# ---------------------------------------------------------------- Knöpfe

@pytest.mark.asyncio
async def test_tournament_messages_carry_the_button_for_their_moment(flow, discord):
    await configure(flow)
    await flow.db.tournaments.insert_one({"id": "t1", "slug": "sommer-cup", "title": "Sommer-Cup", "status": "scheduled", "is_public": True, "visibility": "public"})
    for prev, status in ((None, "registration_open"), ("registration_open", "check_in"), ("check_in", "live")):
        await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"status": status}})
        await discord_threads.status_written(flow.db, "t1", prev)
    # Zur offenen Anmeldung steht „Anmelden“ (#885) vorne - er öffnet die private Anmeldung im Discord.
    assert [labels(row) for row in discord.sent] == [[("Anmelden", "id:tls:show:tournament:t1"), ("Zur Anmeldung", "tournaments/sommer-cup")],
                                                     [("Zum Check-in", "tournaments/sommer-cup")], [("Bracket ansehen", "tournaments/sommer-cup/bracket")]]
    assert all(button["url"].startswith("http") for row in discord.sent for button in row["buttons"] if button.get("url")), "volle Adressen"

    # Das Bracket hat seinen Knopf beim Posten und beim Bearbeiten.
    posted = await discord_bracket.refresh(flow.db, "t1")
    assert posted["reason"] == "posted" and labels(discord.sent[-1]) == [("Bracket ansehen", "tournaments/sommer-cup/bracket")]
    await flow.db.matches_v2.insert_one({"id": "a", "tournament_id": "t1", "stage_number": 1, "round": 1, "order": 1, "section": "wb", "status": "pending",
                                         "slots": [], "results": []})
    edited = await discord_bracket.refresh(flow.db, "t1", force=True, now=now_utc() + timedelta(minutes=2))
    assert edited["reason"] == "edited" and labels(discord.edited[-1]) == [("Bracket ansehen", "tournaments/sommer-cup/bracket")]

    # Ein Stream: „Zuschauen“ und das öffentliche Profil.
    message = discord_announcements.stream_live_message({"id": "t1", "slug": "sommer-cup", "title": "Sommer-Cup"},
                                                        {"display_name": "Paula", "stream_url": "https://twitch.tv/paula", "public_profile_url": "/u/paula"})
    assert message["buttons"] == [{"label": "Zuschauen", "url": "https://twitch.tv/paula"}, {"label": "Profil", "url": "/u/paula"}]
    hidden = discord_announcements.stream_live_message({"id": "t1", "title": "Sommer-Cup"}, {"display_name": "Leon", "stream_url": "https://twitch.tv/leon"})
    assert [button["label"] for button in hidden["buttons"]] == ["Zuschauen"], "ohne öffentliches Profil kein Profil-Knopf"


@pytest.mark.asyncio
async def test_news_event_board_and_resend_keep_their_buttons(flow, discord):
    await configure(flow, events={"news.published": True, "event.announced": True, "membership.application": True})
    await flow.db.news_posts.insert_one({"id": "n1", "slug": "saisonstart", "title": "Saisonstart", "excerpt": "Es geht los.", "published": True,
                                         "published_at": now_utc().isoformat(), "visibility": "public"})
    await flow.db.events.insert_one({"id": "e1", "slug": "lan", "name": "LAN-Party", "status": "scheduled", "visibility": "public",
                                     "created_at": now_utc().isoformat(), "start_date": (now_utc() + timedelta(days=5)).isoformat()})
    await discord_announcements.announce_due()
    await discord_announcements.notify_board("membership.application", "Ein neuer Antrag wartet.")
    assert [labels(row) for row in discord.sent] == [[("Weiterlesen", "news/saisonstart")], [("Event ansehen", "events/lan")],
                                                     [("Im Admin öffnen", "admin/membership-applications")]]
    assert discord.sent[2]["channel_id"] == BOARD

    # Vorschau im Formular und Beispiele unter Verbindungen → Discord zeigen dieselben Knöpfe.
    preview = (await flow.post("/api/settings/discord/preview", json={"kind": "event", "item": {"name": "LAN-Party", "slug": "lan"}})).json()
    assert [(b["label"], b["url"].endswith("/events/lan")) for b in preview["buttons"]] == [("Event ansehen", True)]
    samples = {entry["key"]: entry for entry in (await flow.get("/api/settings/discord/samples")).json()["entries"]}
    assert [b["label"] for b in samples["tournament.registration_open"]["buttons"]] == ["Anmelden", "Zur Anmeldung"]
    assert [b["label"] for b in samples["notify.achievement"]["buttons"]] == ["Profil"]

    # Erneut senden: mit den Knöpfen von damals.
    failed = {"id": "log-1", "channel": "discord", "target": "events", "event_key": "event.announced", "status": "failed", "title": "📅 LAN-Party",
              "created_at": now_utc().isoformat(), "payload": {"title": "📅 LAN-Party", "description": "", "color": 1, "url": "/events/lan", "fields": [],
                                                               "image_url": None, "buttons": [{"label": "Event ansehen", "url": "/events/lan"}]}}
    await flow.db.email_logs.insert_one(failed)
    assert (await flow.post("/api/settings/discord/resend/log-1")).json()["ok"] is True
    assert labels(discord.sent[-1]) == [("Event ansehen", "events/lan")]


@pytest.mark.asyncio
async def test_a_direct_message_has_its_button(flow, discord):
    from services.discord_dm import send_discord_dm_for_notification

    await configure(flow)
    paula = await linked(flow)
    sent = await send_discord_dm_for_notification({"id": "n1", "user_id": paula["id"], "kind": "achievement", "title": "Erfolg", "body": "Erste Bestzeit",
                                                   "url": "/profile?tab=achievements", "meta": {"awards": [{"name": "Erste Bestzeit", "points": 25}]}}, "achievements")
    assert sent == 1 and labels(discord.dms[0]) == [("Profil", "profile?tab=achievements")]
    await send_discord_dm_for_notification({"id": "n2", "user_id": paula["id"], "kind": "match_reminder", "title": "Gleich geht's los", "body": "Runde 2",
                                            "url": "/tournaments/sommer-cup"}, "tournaments")
    assert labels(discord.dms[1]) == [("Zum Match", "tournaments/sommer-cup")]


# ---------------------------------------------------------------- Befehle

@pytest.mark.asyncio
async def test_bracket_command_picks_from_running_public_tournaments(flow):
    assert (await discord_commands.answer_bracket(flow.db))["content"].startswith("Gerade läuft kein Turnier")
    await flow.db.tournaments.insert_many([
        {"id": "t1", "slug": "sommer-cup", "title": "Sommer-Cup", "status": "live", "is_public": True, "visibility": "public", "start_date": "2027-06-01T10:00:00+00:00"},
        {"id": "t2", "slug": "geheim", "title": "Geheim-Cup", "status": "live", "is_public": False, "start_date": "2027-06-02T10:00:00+00:00"},
        {"id": "t3", "slug": "intern", "title": "Intern-Cup", "status": "live", "visibility": "members", "start_date": "2027-06-03T10:00:00+00:00"},
        {"id": "t4", "slug": "leise", "title": "Leise-Cup", "status": "live", "discord_skip": True, "start_date": "2027-06-04T10:00:00+00:00"},
        {"id": "t5", "slug": "vorbei", "title": "Vorbei-Cup", "status": "completed", "start_date": "2027-05-01T10:00:00+00:00"},
    ])
    assert await discord_commands.bracket_choices(flow.db) == [{"name": "Sommer-Cup", "value": "t1"}], "nur laufend, öffentlich, nicht „Ohne Discord“"
    single = await discord_commands.answer_bracket(flow.db)
    assert single["embed"]["title"] == "🏆 Sommer-Cup – Bracket" and single["buttons"][0]["label"] == "Bracket ansehen"

    await flow.db.tournaments.insert_one({"id": "t6", "slug": "herbst-cup", "title": "Herbst-Cup", "status": "paused", "is_public": True, "start_date": "2027-06-05T10:00:00+00:00"})
    assert [c["name"] for c in await discord_commands.bracket_choices(flow.db)] == ["Herbst-Cup", "Sommer-Cup"]
    assert [c["value"] for c in await discord_commands.bracket_choices(flow.db, "herb")] == ["t6"]
    asked = await discord_commands.answer_bracket(flow.db)
    assert asked["embed"] is None and "„Herbst-Cup“" in asked["content"] and "„Sommer-Cup“" in asked["content"]
    assert (await discord_commands.answer_bracket(flow.db, "t6"))["embed"]["title"].startswith("🏆 Herbst-Cup")
    assert (await discord_commands.answer_bracket(flow.db, "sommer"))["embed"]["title"].startswith("🏆 Sommer-Cup"), "getippt statt gewählt"
    assert (await discord_commands.answer_bracket(flow.db, "t2"))["embed"] is None, "ein privates Turnier nie, auch nicht per ID"


@pytest.mark.asyncio
async def test_ranking_and_streams_answer_like_the_pinned_embeds(flow):
    empty = await discord_commands.answer_rangliste(flow.db)
    assert "keine laufende Saison" in empty["embed"]["title"] and empty["buttons"][0]["label"] == "Rangliste ansehen"
    await flow.db.seasons.insert_one({"id": "s1", "slug": "2027", "title": "Saison 2027", "status": "active"})
    ranking = await discord_commands.answer_rangliste(flow.db)
    assert ranking["embed"]["title"] == "🏆 Rangliste – Saison 2027" and ranking["embed"]["url"].endswith("/seasons/2027")
    assert "Gerade streamt niemand" in (await discord_commands.answer_wer_streamt(flow.db))["embed"]["description"]


@pytest.mark.asyncio
async def test_member_and_link_answers_need_a_linked_account_and_never_name_fees(flow):
    assert (await discord_commands.answer_mitglied(flow.db, DISCORD_ID, "https://lionsquad.at"))["content"] == discord_commands.NOT_LINKED
    unlinked = await discord_commands.answer_verknuepfen(flow.db, DISCORD_ID, "https://lionsquad.at")
    assert "Profil → Socials" in unlinked["content"] and unlinked["buttons"] == [{"label": "Konto verknüpfen", "url": "/profile?tab=socials"}]

    paula = await linked(flow)
    assert "kein Vereinsmitglied" in (await discord_commands.answer_mitglied(flow.db, DISCORD_ID, "https://lionsquad.at"))["content"]
    await flow.db.memberships.insert_one({"user_id": paula["id"], "member_status": "active", "membership_type": "ordinary", "member_number": "TLS-2024-0042",
                                          "member_since": "2024-03-01", "member_since_precision": "month",
                                          "dolibarr": {"paid_until": "2027-12-31", "fee": {"amount": 30}}})
    member = await discord_commands.answer_mitglied(flow.db, DISCORD_ID, "https://lionsquad.at")
    assert member["content"] == "✅ Du bist aktives Vereinsmitglied (Ordentliches Mitglied, seit 03/2024). Mitgliederbereich: https://lionsquad.at/member-area"
    assert "2027" not in member["content"] and "TLS-2024" not in member["content"], "kein Beitrag, keine Nummer im fremden Dienst"
    assert member["buttons"] == [{"label": "Mitgliederbereich", "url": "/member-area"}]
    assert (await discord_commands.answer_verknuepfen(flow.db, DISCORD_ID))["content"].startswith("✅ Dein Discord-Konto ist schon")
    assert await discord_commands.answer_mitglied(flow.db, "999999999999999999") == await discord_commands.answer_mitglied(flow.db, "999999999999999999")


@pytest.mark.asyncio
async def test_an_answer_becomes_a_reply_only_for_the_asking_person(flow):
    raw = {"title": "🏆 Rangliste", "description": "1. Paula", "color": 1, "url": "https://lionsquad.at/seasons/2027", "fields": [], "footer": "Stand: jetzt"}
    kwargs = await discord_bot.answer_kwargs(discord_commands.answer("Hallo", embed=raw, buttons=[{"label": "Rangliste ansehen", "url": "/seasons/2027"}]))
    assert kwargs["ephemeral"] is True and kwargs["content"] == "Hallo"
    assert kwargs["embed"].title == "🏆 Rangliste" and kwargs["embed"].footer.text == "Stand: jetzt"
    [button] = kwargs["view"].children
    assert button.url.startswith("http") and button.url.endswith("/seasons/2027")
    assert await discord_bot.answer_kwargs(discord_commands.answer("Nur Text")) == {"ephemeral": True, "content": "Nur Text"}


def test_membership_text_covers_every_state():
    text = discord_commands.membership_text
    assert text({"member_status": "pending"}) == "Dein Mitgliedsantrag ist eingegangen und wartet auf den Vorstand."
    assert text({"member_status": "blocked"}).startswith("Zu deiner Mitgliedschaft wende dich")
    assert text({"member_status": "honorary", "membership_type": "honorary", "member_since": "2019-05-04", "member_since_precision": "year"}, "x").startswith("✅ Du bist aktives Vereinsmitglied (Ehrenmitglied, seit 2019)")
    assert "seit 04.05.2019" in text({"member_status": "active", "member_since": "2019-05-04"})
    ended = text({"member_status": "active", "dolibarr": {"membership_ends": "2026-01-31"}}, "https://x", today="2026-10-03")
    assert ended == "Deine Mitgliedschaft ist am 31.01.2026 ausgelaufen. Wieder Mitglied werden: https://x/membership/apply"
    assert text(None, "https://x") == "Du bist (noch) kein Vereinsmitglied. Mitglied werden: https://x/membership/apply"
