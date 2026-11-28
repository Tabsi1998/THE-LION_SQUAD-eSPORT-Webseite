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
from services import discord_bot, discord_bracket, discord_bracket_state  # noqa: E402

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

    async def send_embed(self, channel_id, embed, buttons=None, files=None):
        self.files = getattr(self, 'files', []) + [(channel_id, name, len(data)) for name, data in files or []]
        self.counter += 1
        self.sent.append({"channel_id": channel_id, "embed": embed})
        return {"ok": True, "message_id": f"m{self.counter}", "channel_id": channel_id}

    async def edit_embed(self, channel_id, message_id, embed, buttons=None, files=None):
        self.files = getattr(self, 'files', []) + [(channel_id, name, len(data)) for name, data in files or []]
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
    discord_bracket_state._revise.clear()
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
    assert embed["fields"][2]["value"] == "offen – offen · Sa 3. Oktober · 21:00"
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


@pytest.mark.asyncio
async def test_the_whole_tree_hangs_on_the_message_as_an_image(flow, bot):
    """#575: Das Bracket kommt als Bild an die Nachricht (``attachment://bracket.png``); gleicher Baum, kein neues Bild -
    eine korrigierte frühere Runde bringt eins, auch wenn die Felder (nur die aktuelle Runde) gleich bleiben."""
    await configure(flow)
    await flow.db.matches_v2.update_one({"id": "a"}, {"$set": match("a", 1, 1, "r1", "r2", status="completed", score=(2, 1))})
    await flow.db.matches_v2.update_one({"id": "b"}, {"$set": match("b", 1, 2, "r3", "r4", status="completed", score=(0, 2))})
    t0 = now_utc()
    posted = await discord_bracket.refresh(flow.db, "t1", now=t0)
    assert posted["reason"] == "posted" and bot.sent[-1]["embed"]["image"] == {"url": "attachment://bracket.png"}
    assert len(bot.files) == 1 and bot.files[0][:2] == (EVENTS_CHANNEL, "bracket.png") and bot.files[0][2] > 1000
    assert (await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(minutes=2)))["reason"] == "unchanged" and len(bot.files) == 1

    # Ergebnis in Runde 1 korrigiert: die Felder zeigen schon Runde 2, das Bild aber den ganzen Baum - also neu.
    await flow.db.matches_v2.update_one({"id": "a"}, {"$set": match("a", 1, 1, "r1", "r2", status="completed", score=(3, 1))})
    corrected = await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(minutes=4))
    assert corrected["reason"] == "edited" and len(bot.files) == 2

    # Nur Tabellen: kein Bild, die Einbettung bleibt Text.
    raw, image = await discord_bracket.build_with_image(flow.db, {"id": "leer", "title": "Leer"})
    assert image is None and "image_signature" not in raw


NAMES = {"r1": "Paula", "r2": "Leon", "r3": "Mira", "r4": "Kai"}


def test_in_clarification_reads_like_the_league_page():
    """#2363: Ein angefochtenes Ergebnis (E.2, ``contested``) und eine Map in Klärung (D.5, offener Vorfall ``in_review``)
    stehen in der Einbettung „in Klärung“ - aus derselben Quelle wie die Ligaseite. Ohne Verfahren wie bisher."""
    from services.competition_snapshot import adapt_stage_matches

    done = match("a", 1, 1, "r1", "r2", status="completed", score=(2, 1))
    assert discord_bracket.match_line(adapt_stage_matches([done])[0], NAMES) == "**Paula** 2 : 1 Leon"
    assert discord_bracket.match_line(adapt_stage_matches([{**done, "contested": True}])[0], NAMES) == "**Paula** 2 : 1 Leon · in Klärung"

    live = match("c", 2, 1, "r1", "r4", status="live")
    review = {**live, "incidents": [{"id": "v1", "position": 2, "state": "in_review"}]}
    decided = {**live, "incidents": [{"id": "v1", "position": 2, "state": "decided"}]}
    for raw, line in ((live, "Paula – Kai · live"), (review, "Paula – Kai · in Klärung"), (decided, "Paula – Kai · live")):
        marked = discord_bracket.mark_clarification(adapt_stage_matches([raw]), [raw])
        assert discord_bracket.match_line(marked[0], NAMES) == line, raw.get("incidents")

    # Liga-Tabelle: wie die Zeile auf der Website und im PDF „1 Spiel in Klärung“.
    league = {"id": "t1", "title": "Liga", "scoring_rules": {"match_points": {"win": 3, "draw": 1, "loss": 0}}}
    stage = [{"id": "s2", "tournament_id": "t1", "number": 1, "name": "Staffel A", "stage_type": "league"}]
    games = [match("l1", 1, 1, "r1", "r2", status="completed", score=(2, 0), stage="s2", section="main"),
             match("l2", 1, 2, "r3", "r4", status="completed", score=(1, 2), stage="s2", section="main")]
    plain = discord_bracket.bracket_fields(adapt_stage_matches(games), stage, REGS, {}, tournament=league)[0]["value"]
    assert "Klärung" not in plain
    games[0] = {**games[0], "contested": True}
    contested = discord_bracket.bracket_fields(adapt_stage_matches(games), stage, REGS, {}, tournament=league)[0]["value"]
    lines = dict(line.split(" · ", 1) for line in contested.split("\n"))
    assert lines["1. Paula"].endswith(" · 1 Spiel in Klärung") and lines[next(key for key in lines if key.endswith("Leon"))].endswith(" · 1 Spiel in Klärung")
    assert not lines[next(key for key in lines if key.endswith("Kai"))].endswith("Klärung"), "nur die beiden Seiten des Spiels"
    assert discord_bracket.content_hash({"fields": [{"value": plain}]}) != discord_bracket.content_hash({"fields": [{"value": contested}]})


@pytest.mark.asyncio
async def test_a_contested_result_brings_a_new_image_and_the_decision_another(flow, bot):
    """#2363: Protest eingelegt - die nächste Bearbeitung zeigt „in Klärung“ mit neuem Bild; nach dem Entscheid wieder
    ohne Hinweis, ebenfalls mit neuem Bild (der Stand steht in Prüfsumme und Bild-Signatur). Eine Map in Klärung kommt aus
    den Vorfällen am Spiel."""
    await configure(flow)
    await flow.db.matches_v2.update_one({"id": "a"}, {"$set": match("a", 1, 1, "r1", "r2", status="completed", score=(2, 1))})
    await flow.db.matches_v2.update_one({"id": "b"}, {"$set": match("b", 1, 2, "r3", "r4", status="completed", score=(0, 2))})
    await flow.db.matches_v2.update_one({"id": "c"}, {"$set": {"slots": match("c", 2, 1, "r1", "r4")["slots"], "status": "live"}})
    t0 = now_utc()
    assert (await discord_bracket.refresh(flow.db, "t1", now=t0))["reason"] == "posted"
    assert "Klärung" not in str(bot.sent[-1]["embed"]["fields"])

    await flow.db.matches_v2.update_one({"id": "c"}, {"$set": {"incidents": [{"id": "v1", "position": 1, "state": "in_review"}]}})
    clarifying = await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(minutes=2))
    assert clarifying["reason"] == "edited" and "Paula – Kai · in Klärung" in bot.edited[-1]["embed"]["fields"][-1]["value"]
    assert len(bot.files) == 2, "neues Bild mit der Map in Klärung"

    await flow.db.matches_v2.update_one({"id": "c"}, {"$set": {"incidents": [], "status": "completed", "results": match("c", 2, 1, "r1", "r4", score=(2, 1))["results"]}})
    assert (await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(minutes=4)))["reason"] == "edited" and len(bot.files) == 3
    assert "Klärung" not in str(bot.edited[-1]["embed"]["fields"])

    # Protest gegen Runde 1: Die Felder zeigen sie nur zusammengefasst, das Bild aber den ganzen Baum - also ein neues.
    await flow.db.matches_v2.update_one({"id": "a"}, {"$set": {"contested": True}})
    contested = await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(minutes=6))
    assert contested["reason"] == "edited" and len(bot.files) == 4
    assert (await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(minutes=8)))["reason"] == "unchanged" and len(bot.files) == 4

    # Entscheid: das Ergebnis bleibt, „in Klärung“ fällt weg - wieder ein neues Bild, jetzt ohne Hinweis.
    await flow.db.matches_v2.update_one({"id": "a"}, {"$set": {"contested": False}})
    decided = await discord_bracket.refresh(flow.db, "t1", now=t0 + timedelta(minutes=10))
    assert decided["reason"] == "edited" and len(bot.files) == 5


@pytest.mark.asyncio
async def test_a_procedure_after_the_end_revises_the_final_bracket_in_place(flow, bot):
    """#2375: Verfahren und Vorfälle merken das Bracket mit ``revise`` vor. Auch ein stehender Endstand wird dann bearbeitet -
    an seinem Platz, ohne neue Nachricht; doppelt vorgemerkt heißt eine Bearbeitung. Ohne ``revise`` bleibt er wie bisher."""
    await configure(flow)
    await flow.db.matches_v2.update_one({"id": "a"}, {"$set": match("a", 1, 1, "r1", "r2", status="completed", score=(2, 1))})
    await flow.db.matches_v2.update_one({"id": "b"}, {"$set": match("b", 1, 2, "r3", "r4", status="completed", score=(0, 2))})
    await flow.db.matches_v2.update_one({"id": "c"}, {"$set": match("c", 2, 1, "r1", "r4", status="completed", score=(2, 1))})
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"status": "completed"}})
    final = await discord_bracket.refresh(flow.db, "t1", now=now_utc() - timedelta(minutes=5))
    assert final["reason"] == "posted" and final["final"] is True, final
    sent, files = len(bot.sent), len(bot.files)

    # Protest gegen das Finale nach dem Ende.
    await flow.db.matches_v2.update_one({"id": "c"}, {"$set": {"contested": True}})
    discord_bracket.request_refresh("t1")
    plain = await discord_bracket.sweep(flow.db)
    assert plain["checked"] == 1 and plain["edited"] == 0 and bot.edited == [], "ohne revise bleibt der Endstand wie er ist"

    discord_bracket.request_refresh("t1", revise=True)
    discord_bracket.request_refresh("t1", revise=True)
    assert list(discord_bracket.pending()) == ["t1"], "doppelt vorgemerkt ist einmal vorgemerkt"
    revised = await discord_bracket.sweep(flow.db)
    assert revised["checked"] == 1 and revised["edited"] == 1 and len(bot.sent) == sent, revised
    assert bot.edited[-1]["message_id"] == final["message_id"] and bot.edited[-1]["embed"]["title"] == "🏆 Sommer-Cup – Endstand"
    assert len(bot.files) == files + 1, "neues Bild mit „in Klärung“"
    state = (await flow.db.tournaments.find_one({"id": "t1"}, {"_id": 0}))["discord_bracket_embed"]
    assert state["final"] is True and state["message_id"] == final["message_id"]
    assert "t1" not in discord_bracket.pending() and not discord_bracket.revising("t1")

    # Nichts geändert: keine Bearbeitung.
    again = await discord_bracket.refresh(flow.db, "t1", revise=True, now=now_utc() + timedelta(minutes=2))
    assert again["reason"] == "unchanged" and len(bot.edited) == 1


async def ended_with_final(flow, bot) -> dict:
    """Das Turnier ist zu Ende, der Endstand steht (vor fünf Minuten, also ohne Bremse); danach wird das Finale angefochten."""
    await configure(flow)
    await flow.db.matches_v2.update_one({"id": "a"}, {"$set": match("a", 1, 1, "r1", "r2", status="completed", score=(2, 1))})
    await flow.db.matches_v2.update_one({"id": "b"}, {"$set": match("b", 1, 2, "r3", "r4", status="completed", score=(0, 2))})
    await flow.db.matches_v2.update_one({"id": "c"}, {"$set": match("c", 2, 1, "r1", "r4", status="completed", score=(2, 1))})
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"status": "completed"}})
    final = await discord_bracket.refresh(flow.db, "t1", now=now_utc() - timedelta(minutes=5))
    assert final["reason"] == "posted" and final["final"] is True, final
    await flow.db.matches_v2.update_one({"id": "c"}, {"$set": {"contested": True}})
    return final


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["unknown_channel", "http", "forbidden", "unknown_message"])
async def test_a_failed_revision_of_the_final_bracket_is_noted_once_and_never_reposts(flow, bot, monkeypatch, reason):
    """#2375: Scheitert das Nachziehen eines Endstands (Thread gelöscht, Rechte weg, Nachricht gelöscht), wird der Fehler
    notiert und die Vormerkung abgeräumt - der Endstand bleibt mit seiner Nachricht stehen, nichts wird neu gepostet."""
    final = await ended_with_final(flow, bot)
    sent = len(bot.sent)

    async def failing(channel_id, message_id, embed, buttons=None, files=None):
        return {"ok": False, "reason": reason}

    monkeypatch.setattr(discord_bot.bot, "edit_embed", failing)
    discord_bracket.request_refresh("t1", revise=True)
    outcome = await discord_bracket.sweep(flow.db)
    assert outcome["checked"] == 1 and outcome["posted"] == 0 and len(bot.sent) == sent, outcome
    assert "t1" not in discord_bracket.pending() and not discord_bracket.revising("t1"), "keine Wiederholung jede Minute"
    state = (await flow.db.tournaments.find_one({"id": "t1"}, {"_id": 0}))["discord_bracket_embed"]
    assert state["final"] is True and state["message_id"] == final["message_id"] and state["error"], state
    assert (await discord_bracket.sweep(flow.db))["checked"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [{"reason": "http", "status": 400, "error": "Discord 400: Bad Request"},
                                     {"reason": "http", "error": "Discord 404: Not Found"}])
async def test_a_lasting_http_refusal_is_given_up_after_one_attempt(flow, bot, monkeypatch, failure):
    """#2494: Ein HTTP-Fehler, der kein 5xx und kein 429 ist, kommt beim nächsten Mal genauso - einmal notieren, aufgeben."""
    await ended_with_final(flow, bot)
    tries: list[str] = []

    async def refused(channel_id, message_id, embed, buttons=None, files=None):
        tries.append(message_id)
        return dict(failure)

    monkeypatch.setattr(discord_bot.bot, "edit_embed", refused)
    discord_bracket.request_refresh("t1", revise=True)
    await discord_bracket.sweep(flow.db)
    assert tries == ["m1"] and "t1" not in discord_bracket.pending() and not discord_bracket.revising("t1")


TRANSIENT = [{"reason": "bot_offline"}, {"reason": "error", "error": "TimeoutError: "},
             {"reason": "http", "status": 503, "error": "Discord 503: Service Unavailable"},
             {"reason": "http", "error": "Discord 429: Too Many Requests"}]


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", TRANSIENT)
async def test_a_transient_failure_is_retried_and_the_next_run_revises_in_place(flow, bot, monkeypatch, failure):
    """#2494: Ein kurzer Discord-Ausfall (Bot offline, 5xx, 429, Zeitüberschreitung) beim Nachziehen bleibt vorgemerkt - der nächste
    Lauf bearbeitet den Endstand an seinem Platz. Kein Neu-Post, kein Rückfall, der Zähler steht danach wieder auf null."""
    final = await ended_with_final(flow, bot)
    sent = len(bot.sent)
    working = bot.edit_embed
    tries: list[str] = []

    async def flaky(channel_id, message_id, embed, buttons=None, files=None):
        tries.append(message_id)
        if len(tries) == 1:
            return dict(failure)
        return await working(channel_id, message_id, embed, buttons=buttons, files=files)

    monkeypatch.setattr(discord_bot.bot, "edit_embed", flaky)
    discord_bracket.request_refresh("t1", revise=True)
    first = await discord_bracket.sweep(flow.db)
    assert first["edited"] == 0 and len(bot.sent) == sent, first
    assert "t1" in discord_bracket.pending() and discord_bracket.revising("t1"), "vorübergehend: bleibt für den nächsten Lauf"
    state = (await flow.db.tournaments.find_one({"id": "t1"}, {"_id": 0}))["discord_bracket_embed"]
    assert state["final"] is True and state["message_id"] == final["message_id"] and state["revise_failures"] == 1, state

    second = await discord_bracket.sweep(flow.db)
    assert second["edited"] == 1 and second["posted"] == 0 and len(bot.sent) == sent, second
    assert tries == [final["message_id"]] * 2 and bot.edited[-1]["channel_id"] == EVENTS_CHANNEL
    state = (await flow.db.tournaments.find_one({"id": "t1"}, {"_id": 0}))["discord_bracket_embed"]
    assert state["message_id"] == final["message_id"] and state["channel_id"] == EVENTS_CHANNEL and state["final"] is True
    assert not state.get("revise_failures") and not state.get("error"), state
    assert "t1" not in discord_bracket.pending() and not discord_bracket.revising("t1")


@pytest.mark.asyncio
async def test_a_lasting_outage_gives_up_after_a_few_attempts(flow, bot, monkeypatch):
    """#2494: Bleibt Discord weg, ist nach ``REVISE_ATTEMPTS`` Läufen Schluss - Fehler notiert, keine Endlosschleife, kein
    Neu-Post. Eine neue Korrektur danach bekommt wieder alle Versuche."""
    final = await ended_with_final(flow, bot)
    sent = len(bot.sent)
    tries: list[str] = []

    async def offline(channel_id, message_id, embed, buttons=None, files=None):
        tries.append(message_id)
        return {"ok": False, "reason": "bot_offline"}

    monkeypatch.setattr(discord_bot.bot, "edit_embed", offline)
    discord_bracket.request_refresh("t1", revise=True)
    for _ in range(discord_bracket.REVISE_ATTEMPTS + 3):
        await discord_bracket.sweep(flow.db)
    assert len(tries) == discord_bracket.REVISE_ATTEMPTS and len(bot.sent) == sent
    assert "t1" not in discord_bracket.pending() and not discord_bracket.revising("t1"), "keine Endlosschleife"
    state = (await flow.db.tournaments.find_one({"id": "t1"}, {"_id": 0}))["discord_bracket_embed"]
    assert state["final"] is True and state["message_id"] == final["message_id"] and state["error"], state
    assert not state.get("revise_failures"), "aufgegeben: der Zähler steht für die nächste Korrektur wieder auf null"

    discord_bracket.request_refresh("t1", revise=True)
    for _ in range(discord_bracket.REVISE_ATTEMPTS + 1):
        await discord_bracket.sweep(flow.db)
    assert len(tries) == 2 * discord_bracket.REVISE_ATTEMPTS


@pytest.mark.asyncio
async def test_a_failed_revision_on_the_game_server_does_not_fall_back_to_a_second_final(flow, bot, monkeypatch):
    """#2375: Steht der Endstand auf dem Spielserver und scheitert dort das Nachziehen, kommt kein zweiter Endstand an den
    Hauptserver (der Rückfall gilt nur, wenn das Bracket dort gar nicht steht)."""
    await ended_with_final(flow, bot)
    game_channel = "200000000000000001"
    field = "discord_bracket_by_guild.g1"
    game = {"key": "g1", "guild_id": "g1", "field": field, "thread_field": "discord_threads_by_guild.g1", "channel": game_channel,
            "thread_id": None}
    main = {"key": "main", "guild_id": None, "field": discord_bracket.FIELD, "thread_field": "discord_thread", "channel": EVENTS_CHANNEL,
            "thread_id": None}

    async def lanes(db, cfg, tournament, members):
        return [game], main

    monkeypatch.setattr(discord_bracket, "_lanes", lanes)
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {field: {
        "channel_id": game_channel, "message_id": "g1m", "hash": "alt", "final": True,
        "updated_at": (now_utc() - timedelta(minutes=5)).isoformat()}}, "$unset": {discord_bracket.FIELD: ""}})

    async def refused(channel_id, message_id, embed, buttons=None, files=None):
        return {"ok": False, "reason": "http", "error": "HTTP 503"}

    monkeypatch.setattr(discord_bot.bot, "edit_embed", refused)
    sent = len(bot.sent)
    discord_bracket.request_refresh("t1", revise=True)
    # 503 ist vorübergehend (#2494): wiederholt bis zur Grenze - auch dabei nie ein zweiter Endstand.
    for _ in range(discord_bracket.REVISE_ATTEMPTS):
        outcome = await discord_bracket.sweep(flow.db)
        assert outcome["posted"] == 0 and len(bot.sent) == sent, "kein zweiter Endstand am Hauptserver"
    stored = await flow.db.tournaments.find_one({"id": "t1"}, {"_id": 0})
    assert discord_bracket.FIELD not in stored and stored["discord_bracket_by_guild"]["g1"]["final"] is True
    assert stored["discord_bracket_by_guild"]["g1"]["message_id"] == "g1m" and "t1" not in discord_bracket.pending()


@pytest.mark.asyncio
async def test_a_request_during_the_discord_call_is_kept_for_the_next_run(flow, bot, monkeypatch):
    """#2375: Kommt während des Discord-Aufrufs eine neue Vormerkung (etwa ein zweites Verfahren), bleibt sie stehen."""
    await configure(flow)
    t0 = now_utc() - timedelta(minutes=5)
    assert (await discord_bracket.refresh(flow.db, "t1", now=t0))["reason"] == "posted"
    edit = bot.edit_embed

    async def edit_and_meanwhile(channel_id, message_id, embed, buttons=None, files=None):
        discord_bracket.request_refresh("t1", revise=True)
        return await edit(channel_id, message_id, embed, buttons=buttons, files=files)

    monkeypatch.setattr(discord_bot.bot, "edit_embed", edit_and_meanwhile)
    await flow.db.matches_v2.update_one({"id": "a"}, {"$set": match("a", 1, 1, "r1", "r2", status="completed", score=(2, 0))})
    discord_bracket.request_refresh("t1")
    outcome = await discord_bracket.sweep(flow.db)
    assert outcome["edited"] == 1, outcome
    assert "t1" in discord_bracket.pending() and discord_bracket.revising("t1"), "die neue Vormerkung ging nicht verloren"

    # Ohne neue Vormerkung räumt der nächste Lauf sie ab.
    monkeypatch.setattr(discord_bot.bot, "edit_embed", edit)
    await discord_bracket.refresh(flow.db, "t1", revise=True, now=now_utc() + timedelta(minutes=2))
    assert "t1" not in discord_bracket.pending()
