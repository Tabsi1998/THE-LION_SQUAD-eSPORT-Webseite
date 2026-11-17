"""Ergebnis-Korrekturen nach dem Ende ziehen den Discord-Endstand nach (#2494, Folge aus #2375). Erfundene Namen.

Eine Korrektur über die echte Ergebnis-Route, eine Disqualifikation nach dem Ende und die Liga-Wertung merken das Bracket mit
``revise`` vor. Ein stehender Endstand wird dann genau einmal an seinem Platz bearbeitet - kein Neu-Post, gleicher Kanal,
gleiche Nachricht. Im laufenden Turnier ändert ``revise`` nichts. Eine Liga-Staffel (``discord_skip``) postet nie.
"""
import functools
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import discord_bot, discord_bracket, discord_bracket_state, discord_runtime  # noqa: E402

TOKEN = "test" * 6 + ".fake." + "token" * 8
EVENTS_CHANNEL = "100000000000000003"


class FakeBot:
    def __init__(self):
        self.sent, self.edited, self.pinned = [], [], []
        self.counter = 0

    async def send_embed(self, channel_id, embed, buttons=None, files=None, **kwargs):
        self.counter += 1
        self.sent.append({"channel_id": channel_id, "embed": embed})
        # Kennungen wie bei Discord (Zahlen) - die echte ``BotRunner.edit_embed`` liest sie als ``int``.
        return {"ok": True, "message_id": str(900000000000000000 + self.counter), "channel_id": channel_id}

    async def edit_embed(self, channel_id, message_id, embed, buttons=None, files=None, **kwargs):
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
    discord_bracket_state._dirty.clear()
    discord_bracket_state._revise.clear()
    yield fake
    discord_bracket_state._dirty.clear()
    discord_bracket_state._revise.clear()


def duel(winner, loser, **extra):
    return {"results": [{"registration_id": winner, "score": 1}, {"registration_id": loser, "score": 0}], **extra}


def slots_of(match: dict) -> list[str]:
    return [slot.get("registration_id") for slot in sorted(match.get("slots") or [], key=lambda slot: slot.get("slot") or 0)]


async def discord_on(flow):
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    saved = await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_enabled": True, "channels": {"events": EVENTS_CHANNEL}})
    assert saved.status_code == 200, saved.text


async def live_cup(flow):
    """Vier Spieler im K.-o., Bracket gezogen, gestartet - die Turnierleitung trägt ein."""
    await discord_on(flow)
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(4, result_entry_mode="staff_only", title="Herbst-Cup", is_public=True)
    drawn = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert drawn.status_code == 200, drawn.text
    await flow.start(tournament)
    return tournament, {reg["id"]: reg["display_name"] for reg in registrations}


async def by_round(flow, tournament) -> dict[int, list[dict]]:
    rounds: dict[int, list[dict]] = {}
    for row in await flow.matches(tournament):
        rounds.setdefault(int(row.get("round") or 0), []).append(row)
    return rounds


async def play_round(flow, tournament, number: int) -> list[dict]:
    played = []
    for row in (await by_round(flow, tournament))[number]:
        first, second = slots_of(row)
        response = await flow.post(f"/api/matches/{row['id']}/result", json=duel(first, second))
        assert response.status_code == 200, response.text
        played.append(row)
    return played


async def ended_with_final(flow, bot, *, play_final: bool = True):
    """Das Turnier ist zu Ende, der Endstand steht im Kanal (vor fünf Minuten, also ohne Bremse). ``play_final=False``: vorzeitig
    beendet, das Finale blieb offen."""
    tournament, names = await live_cup(flow)
    await play_round(flow, tournament, 1)
    final_match = (await play_round(flow, tournament, 2))[0] if play_final else (await by_round(flow, tournament))[2][0]
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "completed"}})
    discord_bracket_state._dirty.clear()
    discord_bracket_state._revise.clear()
    posted = await discord_bracket.refresh(flow.db, tournament["id"], now=now_utc() - timedelta(minutes=5))
    assert posted["reason"] == "posted" and posted["final"] is True, posted
    return tournament, names, final_match, posted


async def stored_state(flow, tournament) -> dict:
    return (await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0}))["discord_bracket_embed"]


def brackets(rows: list[dict]) -> list[dict]:
    """Nur die Bracket-Nachrichten - die Statusmeldungen („Beendet“) gehen über denselben Bot."""
    return [row for row in rows if str(row["embed"].get("title") or "").endswith(("– Endstand", "– Bracket"))]


async def set_status(flow, tournament, status: str):
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": status})
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_a_corrected_final_after_the_end_edits_the_final_bracket_once_in_place(flow, bot):
    """Ergebnisse nimmt nur ein laufendes oder pausiertes Turnier an: Die Leitung öffnet es wieder (pausiert), korrigiert das
    Finale und beendet es erneut.
    Der stehende Endstand wird dann genau einmal an seinem Platz bearbeitet - kein Neu-Post, gleicher Kanal, gleiche Nachricht."""
    tournament, names, final_match, posted = await ended_with_final(flow, bot)
    winner, loser = slots_of(await flow.reload(final_match))
    assert bot.sent[-1]["embed"]["description"].startswith(f"🥇 {names[winner]}")
    sent, edited = len(brackets(bot.sent)), len(bot.edited)

    await set_status(flow, tournament, "paused")
    corrected = await flow.post(f"/api/matches/{final_match['id']}/result?force=true",
                                json=duel(loser, winner, reason="Stand vertauscht"))
    assert corrected.status_code == 200, corrected.text
    assert discord_bracket_state.revising(tournament["id"]), "die Korrektur merkt das Bracket mit revise vor"
    meanwhile = await discord_bracket.sweep(flow.db)
    assert meanwhile["edited"] == 0 and meanwhile["posted"] == 0 and len(bot.edited) == edited, "wieder offen: der Endstand wartet"
    await set_status(flow, tournament, "completed")
    outcome = await discord_bracket.sweep(flow.db)
    assert outcome["edited"] == 1 and outcome["posted"] == 0, outcome
    assert len(brackets(bot.sent)) == sent and len(bot.edited) == edited + 1, "genau eine Bearbeitung, kein Neu-Post"
    last = bot.edited[-1]
    assert last["message_id"] == posted["message_id"] and last["channel_id"] == EVENTS_CHANNEL
    assert last["embed"]["title"].endswith("– Endstand") and last["embed"]["description"].startswith(f"🥇 {names[loser]}")
    state = await stored_state(flow, tournament)
    assert state["final"] is True and state["message_id"] == posted["message_id"] and state["channel_id"] == EVENTS_CHANNEL

    # Ein zweiter Lauf ohne neue Korrektur bearbeitet nichts mehr.
    assert (await discord_bracket.sweep(flow.db))["checked"] == 0 and len(bot.edited) == edited + 1


@pytest.mark.asyncio
async def test_a_correction_while_the_tournament_runs_is_an_ordinary_edit(flow, bot):
    """Gegenprobe: Im laufenden Turnier ändert ``revise`` nichts - die Bracket-Nachricht wird wie bisher bearbeitet, kein Endstand."""
    tournament, names = await live_cup(flow)
    semi = (await play_round(flow, tournament, 1))[0]
    discord_bracket_state._dirty.clear()
    posted = await discord_bracket.refresh(flow.db, tournament["id"], now=now_utc() - timedelta(minutes=5))
    assert posted["reason"] == "posted" and posted["final"] is False, posted
    sent = len(bot.sent)

    first, second = slots_of(await flow.reload(semi))
    corrected = await flow.post(f"/api/matches/{semi['id']}/result?force=true", json=duel(second, first, reason="Stand vertauscht"))
    assert corrected.status_code == 200, corrected.text
    outcome = await discord_bracket.sweep(flow.db)
    assert outcome["edited"] == 1 and len(bot.sent) == sent, outcome
    assert bot.edited[-1]["message_id"] == posted["message_id"] and bot.edited[-1]["embed"]["title"].endswith("– Bracket")
    assert (await stored_state(flow, tournament))["final"] is False


@pytest.mark.asyncio
async def test_a_disqualification_after_the_end_revises_the_final_bracket(flow, bot):
    """Vorzeitig beendet, das Finale blieb offen; danach disqualifiziert die Leitung einen Finalisten (etwa Betrug nachträglich
    bewiesen). Der Umbau wertet das Finale kampflos, der Endstand zieht nach. Sind alle Spiele gespielt, ändert eine
    Disqualifikation am Baum nichts - dann bleibt auch der Endstand unberührt (gleiche Prüfsumme, kein Discord-Aufruf)."""
    tournament, names, final_match, posted = await ended_with_final(flow, bot, play_final=False)
    winner, loser = slots_of(await flow.reload(final_match))
    sent = len(bot.sent)
    url = f"/api/tournaments/{tournament['id']}/registrations/{winner}/removal"
    proposed = await flow.post(url, json={"kind": "disqualified", "reason": "Betrug nachgewiesen"})
    assert proposed.status_code == 200, proposed.text
    confirmed = await flow.post(url, json={"kind": "disqualified", "plan_id": proposed.json()["plan"]["id"]})
    assert confirmed.status_code == 200, confirmed.text
    assert discord_bracket_state.revising(tournament["id"])
    outcome = await discord_bracket.sweep(flow.db)
    assert outcome["edited"] == 1 and outcome["posted"] == 0 and len(bot.sent) == sent, outcome
    assert bot.edited[-1]["message_id"] == posted["message_id"]
    assert bot.edited[-1]["embed"]["description"].startswith(f"🥇 {names[loser]}"), "das Finale kampflos für den Gegner"


class FakeThread:
    """Ein Turnier-Thread wie in discord.py: Im Archiv nimmt Discord keine Bearbeitung an (nur Löschen) - ein Bearbeiten ohne
    vorheriges Öffnen scheitert hier wie dort."""

    def __init__(self, *, archived: bool, locked: bool = False, message_gone: bool = False):
        self.id, self.name = int(EVENTS_CHANNEL), "herbst-cup"
        self.archived, self.locked, self.message_gone = archived, locked, message_gone
        self.calls: list = []

    async def edit(self, **changes):
        self.calls.append(("thread", changes))
        self.archived = changes.get("archived", self.archived)

    async def fetch_message(self, message_id):
        if self.message_gone:
            raise ValueError("Nachricht weg")
        thread = self

        class Message:
            id = message_id

            async def edit(self, **changes):
                if thread.archived:
                    raise RuntimeError("Operation cannot be performed on an archived thread")
                thread.calls.append(("message", sorted(changes)))

        return Message()


class FakeClient:
    def __init__(self, channel):
        self.channel = channel

    def get_channel(self, channel_id):
        return self.channel if channel_id == self.channel.id else None


async def revise_in(flow, bot, monkeypatch, thread: FakeThread) -> dict:
    """Endstand steht, dann ein Vorfall am Finale (``revise``) - bearbeitet über die echte ``BotRunner.edit_embed``."""
    tournament, names, final_match, posted = await ended_with_final(flow, bot)
    runner = discord_bot.bot
    monkeypatch.setattr(runner, "edit_embed", functools.partial(discord_runtime.BotRunner.edit_embed, runner))
    monkeypatch.setattr(runner, "_client", FakeClient(thread))
    monkeypatch.setattr(runner, "connected", True)
    await flow.db.matches_v2.update_one({"id": final_match["id"]}, {"$set": {"contested": True}})
    discord_bracket_state.request_refresh(tournament["id"], revise=True)
    return await discord_bracket.sweep(flow.db)


@pytest.mark.asyncio
async def test_an_archived_thread_is_opened_for_the_edit_and_archived_again(flow, bot, monkeypatch):
    """Discord bearbeitet im Archiv nichts: Der Bot öffnet den Thread, bearbeitet den Endstand und archiviert ihn sofort wieder -
    er taucht nicht dauerhaft wieder in der Liste auf."""
    thread = FakeThread(archived=True)
    outcome = await revise_in(flow, bot, monkeypatch, thread)
    assert outcome["edited"] == 1, outcome
    assert [call[0] for call in thread.calls] == ["thread", "message", "thread"], thread.calls
    assert thread.calls[0][1] == {"archived": False} and thread.calls[2][1] == {"archived": True}
    assert thread.archived is True


@pytest.mark.asyncio
async def test_an_open_thread_is_only_edited_and_stays_open(flow, bot, monkeypatch):
    """Gegenprobe: Ein offener Thread wird nur bearbeitet - nie archiviert."""
    open_thread = FakeThread(archived=False)
    assert (await revise_in(flow, bot, monkeypatch, open_thread))["edited"] == 1
    assert [call[0] for call in open_thread.calls] == ["message"] and open_thread.archived is False


@pytest.mark.asyncio
async def test_a_failed_edit_in_an_archived_thread_archives_it_again(flow, bot, monkeypatch):
    """Scheitert die Bearbeitung nach dem Öffnen (Nachricht gelöscht), kommt der Thread trotzdem zurück ins Archiv - und es
    wird nichts neu gepostet (#2375)."""
    gone = FakeThread(archived=True, message_gone=True)
    outcome = await revise_in(flow, bot, monkeypatch, gone)
    assert outcome["edited"] == 0 and outcome["posted"] == 0, outcome
    assert gone.calls == [("thread", {"archived": False}), ("thread", {"archived": True})] and gone.archived is True


@pytest.mark.asyncio
async def test_a_league_table_change_asks_for_a_revision_but_a_staffel_posts_nothing(flow, bot):
    """Liga-Wertung (``league_table.after_change``) merkt mit ``revise`` vor; eine Staffel steht auf ``discord_skip`` und postet nie."""
    from services import league_table

    tournament, names = await live_cup(flow)
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"discord_skip": True, "status": "completed"}})
    match = (await by_round(flow, tournament))[1][0]
    await league_table.after_change(flow.db, {**tournament, "discord_skip": True}, match, scored=True)
    assert discord_bracket_state.revising(tournament["id"])
    outcome = await discord_bracket.sweep(flow.db)
    assert outcome["checked"] == 1 and outcome["posted"] == 0 and outcome["edited"] == 0 and bot.sent == [] and bot.edited == []
    assert tournament["id"] not in discord_bracket_state.pending() and not discord_bracket_state.revising(tournament["id"])
