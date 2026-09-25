"""Bracket als Einbettung (#571): Rechnung aus dem Graph-Speicher (Runden als Felder, Ergebniszeilen, Tabelle,
Grenzen), eine Nachricht je Turnier (posten, pinnen, bearbeiten), Bremse, „Endstand“ nach dem Ende."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import discord_bot, discord_bracket  # noqa: E402

EVENTS_CHANNEL = "100000000000000003"
TOKEN = "test" * 6 + ".fake." + "token" * 8

REGS = [{"id": "r1", "display_name": "Paula"}, {"id": "r2", "display_name": "Leon"}, {"id": "r3", "display_name": "Mira"}, {"id": "r4", "ingame_name": "Kai"}]


def match(mid, rnd, order, a, b, *, status="pending", score=None, section="wb", scheduled=None, stage="s1"):
    slots = [{"slot": 1, "registration_id": a, "status": "filled" if a else "pending"}, {"slot": 2, "registration_id": b, "status": "filled" if b else "pending"}]
    results = []
    if score:
        results = [{"registration_id": a, "rank": 1 if score[0] > score[1] else 2, "score": score[0]}, {"registration_id": b, "rank": 1 if score[1] > score[0] else 2, "score": score[1]}]
    return {"id": mid, "tournament_id": "t1", "stage_id": stage, "stage_number": 1, "round": rnd, "order": order, "section": section, "match_key": mid.upper(),
            "slots": slots, "results": results, "advancement": [], "status": status, "scheduled_at": scheduled}


STAGES = [{"id": "s1", "tournament_id": "t1", "number": 1, "name": "Playoffs", "stage_type": "single_elimination"}]


class FakeBot:
    def __init__(self):
        self.sent, self.edited, self.pinned = [], [], []
        self.deleted: set[str] = set()
        self.counter = 0

    async def send_embed(self, channel_id, embed):
        self.counter += 1
        self.sent.append({"channel_id": channel_id, "embed": embed})
        return {"ok": True, "message_id": f"m{self.counter}", "channel_id": channel_id}

    async def edit_embed(self, channel_id, message_id, embed):
        if message_id in self.deleted:
            return {"ok": False, "reason": "unknown_message"}
        self.edited.append({"channel_id": channel_id, "message_id": message_id, "embed": embed})
        return {"ok": True, "message_id": message_id}

    async def pin_message(self, channel_id, message_id):
        self.pinned.append(message_id)
        return {"ok": True}


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
    for name in ("send_embed", "edit_embed", "pin_message"):
        monkeypatch.setattr(discord_bot.bot, name, getattr(fake, name))

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    discord_bracket._dirty.clear()
    return fake


def test_bracket_embed_is_a_pure_function():
    from services.competition_snapshot import adapt_stage_matches

    raw = [
        match("a", 1, 1, "r1", "r2", status="completed", score=(2, 1)),
        match("b", 1, 2, "r3", "r4", status="completed", score=(0, 2)),
        match("c", 2, 1, "r1", "r4", status="live", scheduled="2026-10-03T16:00:00+00:00"),
        match("d", 3, 1, None, None, scheduled="2026-10-03T19:00:00+00:00"),
    ]
    matches = adapt_stage_matches(raw)
    embed = discord_bracket.bracket_embed({"id": "t1", "slug": "cup", "title": "Sommer-Cup"}, matches, STAGES, REGS, "https://lionsquad.at", now_utc())
    assert embed["title"] == "🏆 Sommer-Cup – Bracket" and embed["url"] == "https://lionsquad.at/tournaments/cup/bracket"
    assert embed["description"].startswith("2 von 4 Partien gespielt")
    names = [field["name"] for field in embed["fields"]]
    assert names == ["Winner Bracket · Runde 1", "Winner Bracket · Runde 2", "Winner Bracket · Runde 3"]
    assert embed["fields"][0]["value"] == "2 von 2 Partien gespielt", "frühere Runden zusammengefasst"
    assert embed["fields"][1]["value"] == "Paula – Kai · live"
    assert embed["fields"][2]["value"] == "offen – offen · 03.10., 21:00 Uhr"
    assert embed["footer"].startswith("Stand: ")

    # Vor dem Start: Runde 1 vollständig mit Ergebniszeilen, sobald sie die aktuelle ist.
    first_round = adapt_stage_matches([match("a", 1, 1, "r1", "r2", status="completed", score=(2, 1)), match("b", 1, 2, "r3", "r4")])
    lines = discord_bracket.bracket_fields(first_round, STAGES, REGS, {"r1": "Paula", "r2": "Leon", "r3": "Mira", "r4": "Kai"})
    assert lines[0]["value"] == "**Paula** 2 : 1 Leon\nMira – Kai"

    final = discord_bracket.bracket_embed({"id": "t1", "slug": "cup", "title": "Sommer-Cup"}, matches, STAGES, REGS, "https://lionsquad.at", final=True)
    assert final["title"] == "🏆 Sommer-Cup – Endstand" and final["description"].startswith("🥇 ") and final["footer"].startswith("Endstand: ")
    assert discord_bracket.content_hash(embed) != discord_bracket.content_hash(final)
    assert discord_bracket.content_hash({"title": "x", "footer": "a"}) == discord_bracket.content_hash({"title": "x", "footer": "b"})

    table_stage = [{"id": "s2", "tournament_id": "t1", "number": 1, "name": "Gruppe A", "stage_type": "round_robin_groups"}]
    table_matches = adapt_stage_matches([match("g1", 1, 1, "r1", "r2", status="completed", score=(3, 1), stage="s2", section="group_a"), match("g2", 1, 2, "r3", "r4", stage="s2", section="group_a")])
    fields = discord_bracket.bracket_fields(table_matches, table_stage, REGS, {})
    assert fields[0]["name"] == "Gruppe A (Top 8)" and fields[0]["value"].startswith("1. Paula")

    many = adapt_stage_matches([match(f"m{i}", i, 1, "r1", "r2") for i in range(1, 30)])
    assert len(discord_bracket.bracket_fields(many, STAGES, REGS, {"r1": "A", "r2": "B"})) <= discord_bracket.MAX_FIELDS


async def configure(flow):
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    response = await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_enabled": True, "channels": {"events": EVENTS_CHANNEL}})
    assert response.status_code == 200, response.text
    await flow.db.tournaments.insert_one({"id": "t1", "slug": "cup", "title": "Sommer-Cup", "status": "live", "is_public": True, "visibility": "public"})
    await flow.db.tournament_registrations.insert_many([{**reg, "tournament_id": "t1"} for reg in REGS])
    await flow.db.tournament_stages.insert_many(STAGES)
    await flow.db.matches_v2.insert_many([match("a", 1, 1, "r1", "r2"), match("b", 1, 2, "r3", "r4"), match("c", 2, 1, None, None)])
    return admin


@pytest.mark.asyncio
async def test_one_message_per_tournament_edited_on_results_and_final_after_the_end(flow, bot):
    await configure(flow)
    t0 = now_utc()
    first = await discord_bracket.refresh(flow.db, "t1", now=t0)
    assert first["reason"] == "posted" and first["message_id"] == "m1" and bot.pinned == ["m1"], first
    assert bot.sent[0]["channel_id"] == EVENTS_CHANNEL and "Paula – Leon" in bot.sent[0]["embed"]["fields"][0]["value"]
    assert (await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(seconds=61)))["reason"] == "unchanged" and bot.edited == []

    await flow.db.matches_v2.update_one({"id": "a"}, {"$set": {"status": "completed", "results": [{"registration_id": "r1", "rank": 1, "score": 2}, {"registration_id": "r2", "rank": 2, "score": 0}]}})
    discord_bracket.request_refresh("t1")
    throttled = await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(seconds=20))
    assert throttled["reason"] == "throttled" and "t1" in discord_bracket.pending()
    edited = await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(seconds=90))
    assert edited["reason"] == "edited" and bot.edited[-1]["message_id"] == "m1" and "**Paula** 2 : 0 Leon" in bot.edited[-1]["embed"]["fields"][0]["value"]
    assert "t1" not in discord_bracket.pending()

    # Turnierende: ein letztes Mal als Endstand, danach keine Bearbeitung mehr.
    await flow.db.matches_v2.update_one({"id": "b"}, {"$set": {"status": "completed", "results": [{"registration_id": "r3", "rank": 2, "score": 1}, {"registration_id": "r4", "rank": 1, "score": 3}]}})
    await flow.db.matches_v2.update_one({"id": "c"}, {"$set": {"slots": [{"slot": 1, "registration_id": "r1", "status": "filled"}, {"slot": 2, "registration_id": "r4", "status": "filled"}],
                                                          "status": "completed", "results": [{"registration_id": "r1", "rank": 1, "score": 2}, {"registration_id": "r4", "rank": 2, "score": 1}]}})
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"status": "completed"}})
    final = await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(seconds=100))
    assert final["reason"] == "edited" and final["final"] is True, "das Ende überstimmt die Bremse"
    assert bot.edited[-1]["embed"]["title"] == "🏆 Sommer-Cup – Endstand" and bot.edited[-1]["embed"]["description"].startswith("🥇 Paula")
    assert (await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(seconds=400)))["reason"] == "final"
    state = (await flow.db.tournaments.find_one({"id": "t1"}, {"_id": 0}))["discord_bracket_embed"]
    assert state["final"] is True and state["message_id"] == "m1" and state["last_action"] == "edited"

    # Gelöschte Nachricht bei einem laufenden Turnier: neu posten und pinnen.
    await flow.db.tournaments.insert_one({"id": "t2", "slug": "cup2", "title": "Herbst-Cup", "status": "live", "is_public": True, "visibility": "public"})
    assert (await discord_bracket.refresh(flow.db, "t2", now=t0))["reason"] == "posted"
    bot.deleted.add("m2")
    reposted = await discord_bracket.refresh(flow.db, "t2", force=True, now=t0 + timedelta(seconds=120))
    assert reposted["reason"] == "posted" and reposted["message_id"] == "m3" and bot.pinned == ["m1", "m2", "m3"]


@pytest.mark.asyncio
async def test_sweep_full_covers_live_and_ended_and_private_tournaments_stay_out(flow, bot):
    await configure(flow)
    await flow.db.tournaments.insert_one({"id": "t9", "slug": "geheim", "title": "Geheim", "status": "live", "is_public": False})
    outcome = await discord_bracket.sweep(flow.db, full=True)
    assert outcome["posted"] == 1 and outcome["checked"] == 1, outcome
    assert (await discord_bracket.refresh(flow.db, "t9"))["reason"] == "private_visibility" and len(bot.sent) == 1

    await flow.db.settings.update_one({"id": "discord"}, {"$unset": {"channels.events": ""}})
    await flow.db.tournaments.insert_one({"id": "t3", "slug": "cup3", "title": "Ohne Kanal", "status": "live", "is_public": True, "visibility": "public"})
    missing = await discord_bracket.refresh(flow.db, "t3")
    assert missing["reason"] == "channel_missing" and "Kanal" in missing["error"]
