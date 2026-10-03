"""Gestaltung der Discord-Meldungen und Stream-Meldungen je Stream (#866): Vorlagen mit Platzhaltern werden geprüft
(Fehler in Worten), gerendert (optionale Teile, Grenzen, entschärfte Werte), gespeichert und zurückgesetzt; Vorschau und
Testnachricht gehen auch für Entwürfe; je Stream eine Meldung mit Erwähnung nur der gewählten Rolle, alle zehn Minuten
aktualisiert und am Ende abgeschlossen - alles mit nachgestelltem Bot."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import discord_bot, discord_design, discord_embeds, discord_streams  # noqa: E402

CHANNEL = "100000000000000011"
TEST_CHANNEL = "100000000000000099"
ROLE = "300000000000000001"
TOKEN = "test" * 6 + ".fake." + "token" * 8
ORIGIN = "https://lionsquad.at"


class FakeBot:
    def __init__(self):
        self.sent: list[dict] = []
        self.edited: list[dict] = []
        self.deleted: list[str] = []
        self.pinned: list[str] = []
        self.counter = 0

    async def send_embed(self, channel_id, embed, buttons=None, *, content=None, mention_role_ids=None):
        self.counter += 1
        self.sent.append({"channel_id": channel_id, "embed": embed, "buttons": buttons, "content": content, "mentions": mention_role_ids})
        return {"ok": True, "message_id": f"m{self.counter}", "channel_id": channel_id}

    async def edit_embed(self, channel_id, message_id, embed, buttons=None, *, content=None):
        self.edited.append({"channel_id": channel_id, "message_id": message_id, "embed": embed, "buttons": buttons, "content": content})
        return {"ok": True, "message_id": message_id}

    async def delete_message(self, channel_id, message_id):
        self.deleted.append(message_id)
        return {"ok": True}

    async def pin_message(self, channel_id, message_id):
        self.pinned.append(message_id)
        return {"ok": True}

    async def list_roles(self):
        return {"ok": True, "roles": [{"id": ROLE, "name": "Stream-Ping", "color": 0}]}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def bot(monkeypatch):
    fake = FakeBot()
    for name in ("send_embed", "edit_embed", "delete_message", "pin_message", "list_roles"):
        monkeypatch.setattr(discord_bot.bot, name, getattr(fake, name))

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    discord_embeds._dirty.clear()
    return fake


# ---------------------------------------------------------------- Prüfen und Rendern

def test_every_default_is_valid_and_problems_come_in_words():
    for kind in discord_design.KINDS:
        assert discord_design.validate(kind, discord_design.default_template(kind), origin=ORIGIN) == [], kind

    def problems(kind, **patch):
        return " ".join(discord_design.validate(kind, {**discord_design.default_template(kind), **patch}, origin=ORIGIN))

    assert "Unbekannter Platzhalter {zuschauer}" in problems("stream_live", title="{zuschauer}")
    assert "gibt es nur je Eintrag" in problems("live", title="{streamer}"), "Werte je Stream nur in der Zeile oder im Feld je Eintrag"
    assert "@everyone und @here gehen nicht" in problems("stream_live", content="@everyone {streamer} ist live")
    assert "{role} pingt nur im Text über dem Kasten" in problems("stream_live", description="{role}")
    assert "volle Adresse mit https://" in problems("events", url="calendar")
    assert "Farbcode" in problems("events", color="lila")
    assert "Unbekannter Eintrag: buttons" in problems("events", buttons=[])
    assert "nur bei Listen" in problems("stream_live", row="{streamer}")
    empty = {"color": "#123456", "footer": {"text": "nur Fußzeile"}}
    assert "wäre leer" in " ".join(discord_design.validate("stream_live", empty, origin=ORIGIN))
    assert discord_design.validate("stream_live", "kein JSON", origin=ORIGIN) == ["Die Vorlage muss ein JSON-Objekt sein – in geschweiften Klammern."]


def test_render_drops_optional_parts_keeps_limits_and_never_trusts_values():
    template = {"title": "{title}", "description": "**{streamer}**[[ spielt {game}]][[ seit {started}]]", "url": "{url}",
                "image": {"url": "{preview}"}, "fields": [{"name": "Zuschauer", "value": "{viewers}"}, {"name": "Leer", "value": "{game}"}]}
    values = {"title": "Finale", "streamer": "Paula", "game": "", "started": "19:15 Uhr", "url": "javascript:alert(1)", "preview": "/lokal.png", "viewers": "12"}
    rendered = discord_design.render("stream_live", template, values)
    embed = rendered["embed"]
    assert embed["description"] == "**Paula** seit 19:15 Uhr", "ohne Spiel fällt „spielt …“ ganz weg"
    assert "url" not in embed and "image" not in embed, "nur volle http(s)-Adressen"
    assert embed["fields"] == [{"name": "Zuschauer", "value": "12", "inline": True}], "leere Felder fallen weg"
    long = {"title": "x", "description": "{title}", "fields": [{"name": f"Feld {n}", "value": "{title}"} for n in range(25)]}
    huge = discord_design.render("stream_live", long, {"title": "y" * 1500})["embed"]
    assert discord_design.embed_length(huge) <= 6000 and len(huge["fields"]) < 25, "lieber gekürzt als abgelehnt"
    color = discord_design.render("achievement_week", {"title": "x", "color": "{material_color}"}, {"material_color": "#FFD700"})["embed"]["color"]
    assert color == 0xFFD700


# ---------------------------------------------------------------- Admin: Gestaltung

async def admin_with_bot(flow, **extra):
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    response = await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_enabled": True, **extra})
    assert response.status_code == 200, response.text
    return admin


@pytest.mark.asyncio
async def test_design_api_saves_previews_tests_and_resets(flow, bot):
    admin = await admin_with_bot(flow)
    listing = (await flow.get("/api/settings/discord/design")).json()
    assert [kind["key"] for kind in listing["kinds"]] == ["stream_live", "stream_ended", "live", "events", "ranking", "achievement_week"]
    assert listing["groups"] == ["Streams", "Angeheftete Einbettungen"] and listing["limits"]["total"] == 6000
    live = listing["kinds"][0]
    assert live["customized"] is False and live["preview"]["embed"]["author"]["name"] == "TheLostFriday"
    assert any(row["name"] == "role" for row in live["placeholders"]) and live["preview"]["content"].startswith("🔴 **TheLostFriday**")

    refused = await flow.put("/api/settings/discord/design/stream_live", json={"template": {**live["template"], "title": "{gibtsnicht}"}})
    assert refused.status_code == 400 and "Unbekannter Platzhalter {gibtsnicht}" in refused.json()["detail"]
    mine = {**live["template"], "title": "🎮 {streamer} streamt {game}", "color": "#FF0000"}
    saved = (await flow.put("/api/settings/discord/design/stream_live", json={"template": mine})).json()
    assert saved["customized"] is True and saved["template"]["title"] == "🎮 {streamer} streamt {game}" and saved["changed"]["by"] == admin["id"]
    assert saved["preview"]["embed"]["title"] == "🎮 TheLostFriday streamt Aniimo" and saved["preview"]["embed"]["color"] == 0xFF0000
    assert await flow.db.audit_logs.count_documents({"action": "settings.discord.design", "actor_id": admin["id"]}) == 1

    # Entwurf in der Vorschau - auch mit Fehlern, die dann daneben stehen.
    draft = await flow.post("/api/settings/discord/design/stream_live/preview", json={"template": {**mine, "content": "@here {streamer}"}})
    assert draft.status_code == 200 and "@here" in " ".join(draft.json()["errors"]) and draft.json()["data"] == "sample"
    nobody = (await flow.post("/api/settings/discord/design/stream_live/preview", json={"template": mine, "data": "live"})).json()
    assert nobody["data"] == "sample" and "Gerade streamt niemand" in nobody["note"]
    await flow.db.events.insert_one({"id": "e1", "slug": "lan", "name": "LAN-Party", "status": "scheduled", "visibility": "public",
                                     "start_date": (now_utc() + timedelta(days=3)).isoformat()})
    real = (await flow.post("/api/settings/discord/design/events/preview", json={"template": listing["kinds"][3]["template"], "data": "live"})).json()
    assert real["data"] == "live" and real["embed"]["fields"][0]["value"].startswith("**[LAN-Party](")

    # Testnachricht: nur in den Testkanal, ohne jemanden zu erwähnen.
    missing = await flow.post("/api/settings/discord/design/stream_live/test", json={})
    assert missing.status_code == 409 and "Testkanal" in missing.json()["detail"]
    assert (await flow.put("/api/settings/discord", json={"channels": {"test": TEST_CHANNEL}})).status_code == 200
    sent = await flow.post("/api/settings/discord/design/stream_live/test", json={})
    assert sent.status_code == 200 and bot.sent[-1]["channel_id"] == TEST_CHANNEL
    assert bot.sent[-1]["mentions"] is None and "@Rolle" in bot.sent[-1]["content"] and bot.sent[-1]["embed"]["title"] == "🎮 TheLostFriday streamt Aniimo"

    reset = (await flow.delete("/api/settings/discord/design/stream_live")).json()
    assert reset["customized"] is False and reset["template"]["title"] == "{title}"
    assert (await flow.put("/api/settings/discord/design/gibtsnicht", json={"template": {}})).status_code == 404
    flow.act_as(await flow.add_user(role="player", name="paula"))
    assert (await flow.get("/api/settings/discord/design")).status_code in (401, 403)


@pytest.mark.asyncio
async def test_pinned_embed_follows_the_saved_design(flow, bot):
    await admin_with_bot(flow, embeds={"ranking": {"enabled": True, "channel_id": CHANNEL}})
    template = {**discord_design.default_template("ranking"), "title": "Unsere Besten", "row": "{rank}. {name} ({points})", "rows": "lines"}
    assert (await flow.put("/api/settings/discord/design/ranking", json={"template": template})).status_code == 200
    assert "ranking" in discord_embeds.pending(), "eine neue Gestaltung zeigt sich bei der nächsten Bearbeitung"
    result = await discord_embeds.refresh(flow.db, "ranking")
    assert result["reason"] == "posted" and bot.sent[-1]["embed"]["title"] == "Unsere Besten"


# ---------------------------------------------------------------- Stream-Meldungen

async def streamer(flow, name, *, member=True, stream_id="s1", viewers=4, started=None):
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"is_active": True, "twitch_handle": name}})
    if member:
        await flow.db.memberships.insert_one({"user_id": user["id"], "member_status": "active"})
        await flow.db.club_member_profiles.insert_one({"id": f"p-{name}", "user_id": user["id"], "slug": name, "gamertag": name.capitalize(),
                                                       "display_name": name.capitalize(), "photo_url": f"{ORIGIN}/api/static/uploads/{name}.png"})
    started = started or (now_utc() - timedelta(minutes=30)).isoformat()
    stream = {"user_id": user["id"], "username": name, "display_name": name.capitalize(), "twitch_login": name, "stream_id": stream_id,
              "title": f"{name} spielt", "game_name": "Aniimo", "viewer_count": viewers, "started_at": started,
              "thumbnail_url": f"https://static-cdn.jtvnw.net/previews-ttv/live_user_{name}-640x360.jpg", "stream_url": f"https://twitch.tv/{name}"}
    await flow.db.live_streams.insert_one(dict(stream))
    await flow.db.twitch_stream_sessions.insert_one({**stream, "viewer_count_peak": viewers, "is_live": True})
    return user


async def streams_on(flow, **extra):
    admin = await admin_with_bot(flow)
    response = await flow.put("/api/settings/discord/streams", json={"enabled": True, "channel_id": CHANNEL, "role_id": ROLE, **extra})
    assert response.status_code == 200, response.text
    return admin


@pytest.mark.asyncio
async def test_one_message_per_stream_updated_every_ten_minutes_and_finished(flow, bot):
    await streams_on(flow)
    await streamer(flow, "paula", stream_id="s1", viewers=4)
    await streamer(flow, "gast", member=False, stream_id="s2")
    t0 = now_utc()

    counts = await discord_streams.sync(flow.db, now=t0)
    assert counts["posted"] == 1 and len(bot.sent) == 1, "nur wer auch auf der Startseite steht"
    post = bot.sent[0]
    assert post["channel_id"] == CHANNEL and post["mentions"] == [ROLE] and post["content"] == f"🔴 **Paula** ist jetzt live auf Twitch! <@&{ROLE}>"
    embed = post["embed"]
    assert embed["author"]["name"] == "Paula" and embed["author"]["url"] == f"{ORIGIN}/members/paula" and embed["title"] == "paula spielt"
    assert embed["url"] == "https://twitch.tv/paula" and {f["name"]: f["value"] for f in embed["fields"]} == {"Spiel": "Aniimo", "Zuschauer": "4"}
    assert embed["image"]["url"].startswith("https://static-cdn.jtvnw.net/previews-ttv/live_user_paula-640x360.jpg?t=")
    assert embed["thumbnail"]["url"] == f"{ORIGIN}/api/static/uploads/paula.png" and embed["timestamp"]
    assert post["buttons"] == [{"label": "Zuschauen", "url": "https://twitch.tv/paula"}]

    # Fünf Minuten später: nichts. Nach zehn: bearbeitet - ohne neue Erwähnung.
    await flow.db.live_streams.update_one({"stream_id": "s1"}, {"$set": {"viewer_count": 9}})
    assert (await discord_streams.sync(flow.db, now=t0 + timedelta(minutes=5)))["updated"] == 0 and bot.edited == []
    assert (await discord_streams.sync(flow.db, now=t0 + timedelta(minutes=11)))["updated"] == 1
    edit = bot.edited[-1]
    assert edit["message_id"] == "m1" and "<@&" not in edit["content"] and {f["name"]: f["value"] for f in edit["embed"]["fields"]}["Zuschauer"] == "9"
    assert len(bot.sent) == 1, "kein zweites Posten für denselben Stream"

    # Stream vorbei: die Meldung wird zu „war live“ mit Dauer und Höchstzahl.
    started = (t0 - timedelta(minutes=30)).isoformat()
    await flow.db.live_streams.delete_one({"stream_id": "s1"})
    await flow.db.twitch_stream_sessions.update_one({"stream_id": "s1"}, {"$set": {"is_live": False, "viewer_count_peak": 12, "started_at": started,
                                                                                    "ended_at": (t0 + timedelta(minutes=60)).isoformat()}})
    assert (await discord_streams.sync(flow.db, now=t0 + timedelta(minutes=61)))["ended"] == 1
    end = bot.edited[-1]
    assert end["content"] == "⚫ **Paula** war live auf Twitch." and end["embed"]["description"] == "War 1 Std. 30 Min. live · bis zu 12 Zuschauer"
    assert "image" not in end["embed"] and end["embed"]["color"] == 0x4E5058
    stored = await flow.db.discord_stream_posts.find_one({"stream_id": "s1"}, {"_id": 0})
    assert stored["ended_at"] and stored["end"] == "edit"
    assert (await discord_streams.sync(flow.db, now=t0 + timedelta(minutes=62)))["ended"] == 0, "einmal abgeschlossen bleibt abgeschlossen"


@pytest.mark.asyncio
async def test_switches_delete_mode_and_flood_cap(flow, bot):
    admin = await admin_with_bot(flow)
    await streamer(flow, "paula", stream_id="s1")
    assert (await discord_streams.sync(flow.db))["reason"] == "disabled" and bot.sent == []
    assert (await flow.put("/api/settings/discord/streams", json={"enabled": True})).status_code == 200
    assert (await discord_streams.sync(flow.db))["reason"] == "channel_missing"
    assert (await flow.put("/api/settings/discord/streams", json={"channel_id": "abc"})).status_code == 400
    assert (await flow.put("/api/settings/discord/streams", json={"on_end": "irgendwas"})).status_code == 400
    assert (await flow.put("/api/settings/discord/streams", json={"role_id": "@rolle"})).status_code == 400
    assert (await flow.put("/api/settings/discord/streams", json={"channel_id": CHANNEL, "on_end": "delete"})).status_code == 200
    status = (await flow.get("/api/settings/discord/streams")).json()
    assert status["enabled"] is True and status["on_end"] == "delete" and status["roles"][0]["name"] == "Stream-Ping" and status["reason"] is None
    assert await flow.db.audit_logs.count_documents({"action": "settings.discord.streams", "actor_id": admin["id"]}) >= 2

    # Bot aus: keine Meldung und kein Rückfall.
    assert (await flow.put("/api/settings/discord", json={"bot_enabled": False})).status_code == 200
    assert (await discord_streams.sync(flow.db))["reason"] == "bot_off" and bot.sent == []
    assert (await flow.put("/api/settings/discord", json={"bot_enabled": True})).status_code == 200

    # Nach einem Ausfall höchstens fünf auf einmal - der Rest folgt beim nächsten Abruf.
    for index in range(2, 8):
        await streamer(flow, f"s{index}name", stream_id=f"s{index}")
    first = await discord_streams.sync(flow.db)
    assert first["posted"] == 5 and bot.sent[0]["content"].endswith("Twitch!"), "ohne Rolle keine Erwähnung"
    assert (await discord_streams.sync(flow.db))["posted"] == 2

    # Stream vorbei, Einstellung „löschen“: die Meldung verschwindet.
    await flow.db.live_streams.delete_one({"stream_id": "s1"})
    assert (await discord_streams.sync(flow.db))["ended"] == 1 and bot.deleted == [next(p["message_id"] for p in [await flow.db.discord_stream_posts.find_one({"stream_id": "s1"})])]
