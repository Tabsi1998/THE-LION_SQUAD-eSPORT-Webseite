"""Liga-Erinnerungen (#1647, docs/LIGA.md E.5) mit fester Uhr: Spiel steht an (24 h / 1 h), Termin offen, Ergebnis fehlt, Map-Veto
wartet - je Art Versand zum richtigen Zeitpunkt, kein Versand bei abgesagt, gestartet, verschoben, Sperrzeit, abgemeldeter Person oder
offenem Vorfall, kein zweiter Versand bei doppeltem Joblauf (auch gleichzeitig, auf echtem MongoDB mit dem Teilindex), Einstellung je
Season über die Route. Erfundene Namen."""
import asyncio
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import database  # noqa: E402
from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import world as league_world  # noqa: E402
from models import now_utc  # noqa: E402
from services import league_reminder_rules, league_reminders, league_schedule, league_schedule_sweep, league_veto_sweep  # noqa: E402
from services.league_schedule import DEFAULTS as SCHEDULE_DEFAULTS  # noqa: E402
from services.matchday_schedule import LOCAL_TZ  # noqa: E402
from test_league_veto_live_flow import move_deadline, nudges, started_world  # noqa: E402

SIDE_A = {"Kapitaen", "Mila", "Tom", "LoeLeitung"}
SIDE_H = {"Falke1", "Falke2", "Falke3", "FalLeitung"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        if not instance.real_mongo:
            # Auf mongomock fehlen sonst alle Indizes - der Teilindex ``user_unique_dedupe`` ist hier Gegenstand der Prüfung.
            await database.init_audit_indexes(instance.db)
        yield instance
    finally:
        await shutdown()


async def reminder_world(flow, *, hours: float = 30, source: str = "accepted", rules: dict | None = None, letter: str = "A",
                         **fields) -> dict:
    """Staffel seit gestern live, Spielwoche sieben Tage, Spiel mit Termin in ``hours`` Stunden. ``now``: die feste Uhr des Tests."""
    world = await league_world(flow, letter=letter)
    now = now_utc().replace(second=0, microsecond=0)
    update = {"start_date": (now - timedelta(days=1)).isoformat(), "matchday_days": 7, "schedule_rules": dict(SCHEDULE_DEFAULTS), **fields}
    if rules is not None:
        update["reminder_rules"] = {**league_reminder_rules.defaults(), **rules}
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": update})
    start = now + timedelta(hours=hours)
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {
        "scheduled_at": start.isoformat(), "schedule_source": source, "status": "scheduled"}})
    world.update(now=now, start=start)
    return world


async def staffel(flow, world) -> dict:
    return await flow.db.tournaments.find_one({"id": world["tournament"]["id"]}, {"_id": 0})


async def run(flow, world, at) -> dict:
    return await league_reminders.sweep(flow.db, [await staffel(flow, world)], now=at)


async def notes(flow, reason: str) -> list[dict]:
    return await flow.db.notifications.find({"meta.reason": reason}, {"_id": 0}).to_list(100)


def vienna_day(moment) -> str:
    return moment.astimezone(LOCAL_TZ).date().isoformat()


def names(world, rows) -> set[str]:
    by_id = {user["id"]: name for name, user in world["users"].items()}
    return {by_id.get(row["user_id"], row["user_id"]) for row in rows}


# ---------------------------------------------------------------- Spiel steht an

@pytest.mark.asyncio
async def test_twenty_four_hours_and_one_hour_before_the_match_once_each_with_opponent_and_vienna_time(flow):
    world = await reminder_world(flow)
    start = world["start"]
    assert await run(flow, world, start - timedelta(hours=24, minutes=1)) == {"upcoming_early": 0, "upcoming_late": 0, "unscheduled": 0}, \
        "eine Minute zu früh"
    counts = await run(flow, world, start - timedelta(hours=24))
    assert counts["upcoming_early"] == 1
    early = await notes(flow, "upcoming_early")
    assert names(world, early) == SIDE_A | SIDE_H, "Kader und Captains beider Seiten, nicht Ida (anderes Co-Team) und nicht Fremd"
    when = league_schedule.when_text(start)
    captain = next(row for row in early if row["user_id"] == world["users"]["Kapitaen"]["id"])
    falke = next(row for row in early if row["user_id"] == world["users"]["Falke1"]["id"])
    assert captain["title"] == "Liga-Spiel in 24 Stunden" and captain["kind"] == "match_reminder"
    other_side = world["reg_h"].get("display_name") or world["reg_h"].get("team_name")
    assert captain["body"] == f"{world['tournament']['title']}: gegen {other_side} am {when} Uhr."
    assert "Rudel A am" in falke["body"], "die Gegenseite liest den Namen der anderen"
    assert captain["url"] == f"/matches/{world['match']['id']}" and captain["meta"]["category"] == "match_reminders"
    assert captain["meta"]["no_discord"] is True, "Discord nur, wenn die Season es einschaltet"

    # Doppelter Lauf, auch innerhalb des Nachholfensters: keine zweite Nachricht.
    assert (await run(flow, world, start - timedelta(hours=24)))["upcoming_early"] == 0
    assert (await run(flow, world, start - timedelta(hours=23, minutes=40)))["upcoming_early"] == 0
    assert len(await notes(flow, "upcoming_early")) == len(early)
    # Zwischen den beiden Erinnerungen nichts, nach dem Nachholfenster auch nicht.
    assert (await run(flow, world, start - timedelta(hours=23)))["upcoming_early"] == 0
    assert (await run(flow, world, start - timedelta(minutes=61)))["upcoming_late"] == 0

    late = await run(flow, world, start - timedelta(minutes=60))
    assert late["upcoming_late"] == 1
    rows = await notes(flow, "upcoming_late")
    assert names(world, rows) == SIDE_A | SIDE_H and rows[0]["title"] == "Liga-Spiel in 1 Stunde"
    assert (await run(flow, world, start - timedelta(minutes=45)))["upcoming_late"] == 0
    assert len(await notes(flow, "upcoming_late")) == len(rows)


@pytest.mark.asyncio
async def test_with_a_lineup_only_the_lineup_and_the_captain_hear_it(flow):
    world = await reminder_world(flow)
    await flow.db.tournament_registrations.update_one({"id": world["reg_a"]["id"]}, {"$set": {"lineup": [world["users"]["Mila"]["id"]]}})
    await run(flow, world, world["start"] - timedelta(hours=24))
    got = names(world, await notes(flow, "upcoming_early"))
    assert {"Mila", "Kapitaen"} <= got and "Tom" not in got, "aufgestellt: Mila; Captain immer"


def ban(world, name: str, **fields) -> dict:
    """Eine Spielsperre aus E.3 (``competition_sanctions``), seit gestern, bis in einer Woche."""
    now = now_utc()
    return {"id": new_id(), "league_id": "liga", "season_id": world["season_id"], "kind": "player_ban", "target_type": "player",
            "user_id": world["users"][name]["id"], "state": "final", "revoked_at": None,
            "starts_at": (now - timedelta(days=1)).isoformat(), "ends_at": (now + timedelta(days=7)).isoformat(), **fields}


@pytest.mark.asyncio
async def test_recipients_leave_out_banned_accounts_old_lineup_entries_and_players_banned_for_the_match(flow):
    """N4: gesperrte Konten nie; aus der Aufstellung nur, wer noch im Kader ist; wer laut E.3 gesperrt ist, nicht als Spieler - als
    Captain aber schon."""
    world = await reminder_world(flow)
    users = world["users"]
    await flow.db.users.update_one({"id": users["Tom"]["id"]}, {"$set": {"is_banned": True}})
    # Ida gehört zu Rudel B, nicht zu diesem Co-Team - ein alter Eintrag in der Aufstellung.
    await flow.db.tournament_registrations.update_one({"id": world["reg_a"]["id"]}, {"$set": {
        "lineup": [users["Mila"]["id"], users["Ida"]["id"], users["Tom"]["id"]]}})
    await flow.db.competition_sanctions.insert_many([ban(world, "Falke2"), ban(world, "Falke1")])
    assert (await run(flow, world, world["start"] - timedelta(hours=24)))["upcoming_early"] == 1
    got = names(world, await notes(flow, "upcoming_early"))
    assert "Tom" not in got, "gesperrtes Konto"
    assert "Ida" not in got and "Mila" in got, "Aufstellung nur, soweit noch im Kader"
    assert "Falke2" not in got, "für dieses Spiel gesperrt"
    assert "Falke1" in got, "gesperrt, aber Captain: bekommt sie als Captain"
    assert "Falke3" in got and "Kapitaen" in got, "Gegenprobe: die übrigen"


@pytest.mark.asyncio
async def test_no_reminder_for_cancelled_started_or_moved_matches(flow):
    world = await reminder_world(flow)
    at = world["start"] - timedelta(hours=24)
    mid = world["match"]["id"]
    await flow.db.matches_v2.update_one({"id": mid}, {"$set": {"status": "cancelled"}})
    assert (await run(flow, world, at))["upcoming_early"] == 0, "abgesagt"
    await flow.db.matches_v2.update_one({"id": mid}, {"$set": {"status": "scheduled", "started_at": at.isoformat()}})
    assert (await run(flow, world, at))["upcoming_early"] == 0, "schon gestartet"
    await flow.db.matches_v2.update_one({"id": mid}, {"$set": {"status": "in_progress", "started_at": None}})
    assert (await run(flow, world, at))["upcoming_early"] == 0, "läuft"
    # Verschoben: zum alten Termin nichts, zum neuen schon.
    moved = world["start"] + timedelta(hours=48)
    await flow.db.matches_v2.update_one({"id": mid}, {"$set": {"status": "scheduled", "scheduled_at": moved.isoformat()}})
    assert (await run(flow, world, at))["upcoming_early"] == 0, "verschoben"
    assert await notes(flow, "upcoming_early") == []
    assert (await run(flow, world, moved - timedelta(hours=24)))["upcoming_early"] == 1, "Gegenprobe: neuer Termin"


@pytest.mark.asyncio
async def test_no_reminder_in_a_blocked_period_and_none_for_a_person_who_turned_reminders_off(flow):
    world = await reminder_world(flow)
    start_day = vienna_day(world["start"])
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {
        "blocked_periods": [{"start_date": start_day, "end_date": start_day, "label": "Feiertag"}]}})
    at = world["start"] - timedelta(hours=24)
    assert (await run(flow, world, at))["upcoming_early"] == 0, "Sperrzeit"
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"blocked_periods": []}})
    await flow.db.users.update_one({"id": world["users"]["Mila"]["id"]}, {"$set": {"notification_preferences": {"match_reminders": False}}})
    assert (await run(flow, world, at))["upcoming_early"] == 1, "Gegenprobe ohne Sperrzeit"
    got = names(world, await notes(flow, "upcoming_early"))
    assert "Mila" not in got and "Kapitaen" in got, "Mila hat Match-Erinnerungen abgeschaltet"


@pytest.mark.asyncio
async def test_first_match_after_a_break_gets_its_reminder_although_the_reminder_falls_into_the_break(flow):
    """Nr. 151: Sperrzeit 24.–26.12., Spiel am So 27.12. um 20:00 - die 24-h-Erinnerung kommt am 26.12. um 20:00 (noch in der Pause)."""
    world = await reminder_world(flow)
    mid = world["match"]["id"]
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {
        "blocked_periods": [{"start_date": "2026-12-24", "end_date": "2026-12-26", "label": "Weihnachten"}]}})
    await flow.db.matches_v2.update_one({"id": mid}, {"$set": {"scheduled_at": "2026-12-27T19:00:00+00:00"}})
    at = datetime(2026, 12, 26, 19, 0, tzinfo=timezone.utc)
    assert (await run(flow, world, at))["upcoming_early"] == 1
    captain = next(row for row in await notes(flow, "upcoming_early") if row["user_id"] == world["users"]["Kapitaen"]["id"])
    assert captain["body"].endswith("am So 27.12. 20:00 Uhr."), "Winterzeit: 19:00 UTC ist 20:00 in Wien"
    # Gegenprobe: liegt das Spiel selbst in der Sperrzeit, kommt nichts.
    await flow.db.matches_v2.update_one({"id": mid}, {"$set": {"scheduled_at": "2026-12-26T19:00:00+00:00"}})
    assert (await run(flow, world, at - timedelta(hours=24)))["upcoming_early"] == 0


@pytest.mark.asyncio
async def test_switch_and_times_per_season(flow):
    world = await reminder_world(flow, rules={"upcoming": False})
    assert (await run(flow, world, world["start"] - timedelta(hours=24)))["upcoming_early"] == 0, "aus"
    other = await reminder_world(flow, hours=50, rules={"upcoming_early_hours": 48, "upcoming_late_minutes": 120, "discord": True},
                                 letter="B")
    assert (await run(flow, other, other["start"] - timedelta(hours=24)))["upcoming_early"] == 0, "nicht mehr nach 24 h"
    assert (await run(flow, other, other["start"] - timedelta(hours=48)))["upcoming_early"] == 1
    assert (await run(flow, other, other["start"] - timedelta(hours=2)))["upcoming_late"] == 1
    rows = await notes(flow, "upcoming_late")
    assert rows[0]["title"] == "Liga-Spiel in 2 Stunden" and rows[0]["meta"]["no_discord"] is False


@pytest.mark.asyncio
async def test_a_late_league_reminder_does_not_swallow_the_ten_minute_call(flow):
    """N3: Mit ``upcoming_late_minutes=30`` holt der Job die zweite Erinnerung auch 12 Minuten vor dem Start nach - die Nachricht
    „Match startet in 10 Minuten“ kommt trotzdem (die Abkühlzeit zählt nur Zeilen ohne eindeutigen Schlüssel)."""
    from services.match_reminder import schedule_match_reminders

    world = await reminder_world(flow, rules={"upcoming_late_minutes": 30})
    start = now_utc().replace(microsecond=0) + timedelta(minutes=10)
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {"scheduled_at": start.isoformat()}})
    assert (await run(flow, world, start - timedelta(minutes=12)))["upcoming_late"] == 1
    await schedule_match_reminders()
    calls = await flow.db.notifications.find({"title": "Match startet in 10 Minuten"}, {"_id": 0}).to_list(50)
    assert world["users"]["Kapitaen"]["id"] in {row["user_id"] for row in calls}


@pytest.mark.asyncio
async def test_two_runs_at_the_same_time_send_one_message_each(flow):
    world = await reminder_world(flow)
    at = world["start"] - timedelta(hours=24)
    tournament = await staffel(flow, world)
    await asyncio.gather(*(league_reminders.sweep(flow.db, [tournament], now=at) for _ in range(3)))
    rows = await notes(flow, "upcoming_early")
    assert len(rows) == len({row["user_id"] for row in rows}) == len(SIDE_A | SIDE_H)


@pytest.mark.asyncio
async def test_a_run_that_loses_the_race_after_its_check_writes_nothing(flow):
    """Zwei Läufe gleichzeitig: Beide prüfen, keiner findet eine Zeile - der zweite verliert dann beim Schreiben am Teilindex. Hier
    nachgestellt mit einer Zeile, die die Prüfung nicht sieht (andere Art), aber denselben eindeutigen Schlüssel trägt."""
    world = await reminder_world(flow)
    at = world["start"] - timedelta(hours=24)
    captain = world["users"]["Kapitaen"]["id"]
    key = f"league-upcoming:{world['match']['id']}:{league_schedule._iso(world['start'])}:upcoming_early"
    await flow.db.notifications.insert_one({"id": new_id(), "user_id": captain, "kind": "race", "unique_dedupe_key": key,
                                            "meta": {"dedupe_key": key}})
    assert (await run(flow, world, at))["upcoming_early"] == 1
    rows = await notes(flow, "upcoming_early")
    assert captain not in {row["user_id"] for row in rows}, "der Captain hatte seine schon"
    assert names(world, rows) == (SIDE_A | SIDE_H) - {"Kapitaen"}
    assert await flow.db.notifications.count_documents({"user_id": captain}) == 1


def count_inserts(monkeypatch, flow) -> list[str]:
    """Wem ``notifications.insert_one`` eine Zeile schreiben wollte - auch Versuche, die am Index scheitern."""
    calls: list[str] = []
    cls = type(flow.db.notifications)
    original = cls.insert_one

    async def counting(self, doc, *args, **kwargs):
        if self.name == "notifications":
            calls.append(doc.get("user_id"))
        return await original(self, doc, *args, **kwargs)

    monkeypatch.setattr(cls, "insert_one", counting)
    return calls


@pytest.mark.asyncio
async def test_the_check_before_writing_uses_the_unique_key(flow, monkeypatch):
    """N1: Steht für Person und Schlüssel schon eine Zeile (gleich welche Art), schreibt der Lauf gar nicht erst - die Prüfung fragt
    nach ``unique_dedupe_key`` und trifft damit den Teilindex."""
    world = await reminder_world(flow)
    captain = world["users"]["Kapitaen"]["id"]
    key = f"league-upcoming:{world['match']['id']}:{league_schedule._iso(world['start'])}:upcoming_early"
    await flow.db.notifications.insert_one({"id": new_id(), "user_id": captain, "kind": "anders", "unique_dedupe_key": key})
    calls = count_inserts(monkeypatch, flow)
    assert (await run(flow, world, world["start"] - timedelta(hours=24)))["upcoming_early"] == 1
    assert captain not in calls, "kein Schreibversuch für den Captain"
    assert len(calls) == len(SIDE_A | SIDE_H) - 1


@pytest.mark.asyncio
async def test_a_later_run_does_not_resolve_the_recipients_again(flow, monkeypatch):
    """N1: Nach dem Versand merkt sich das Spiel den Schlüssel - spätere Läufe im Nachholfenster lösen Anmeldungen, Teams und Kader nicht
    neu auf. Ein neuer Termin erinnert neu."""
    from services import match_audience

    world = await reminder_world(flow)
    at = world["start"] - timedelta(hours=24)
    assert (await run(flow, world, at))["upcoming_early"] == 1
    stored = await flow.reload(world["match"])
    assert stored["reminder_notes"]["upcoming_early"].endswith(":upcoming_early")
    lookups: list[str] = []
    original = match_audience.registrations_for_match

    async def counting(db, match):
        lookups.append(match.get("id"))
        return await original(db, match)

    monkeypatch.setattr(match_audience, "registrations_for_match", counting)
    for minutes in (0, 5, 20):
        assert (await run(flow, world, at + timedelta(minutes=minutes)))["upcoming_early"] == 0
    assert lookups == [], "schon gesendet: keine Auflösung der Empfänger"
    moved = world["start"] + timedelta(hours=30)
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {"scheduled_at": moved.isoformat()}})
    assert (await run(flow, world, moved - timedelta(hours=24)))["upcoming_early"] == 1, "Gegenprobe: neuer Termin"
    assert lookups == [world["match"]["id"]]


@pytest.mark.asyncio
async def test_the_partial_index_refuses_a_second_league_row_but_not_other_notifications(flow):
    user = await flow.add_user(name="Indexprobe")
    row = {"user_id": user["id"], "kind": "match_reminder", "unique_dedupe_key": "league-upcoming:m:t:upcoming_early"}
    await flow.db.notifications.insert_one({**row, "id": new_id()})
    from pymongo.errors import DuplicateKeyError

    with pytest.raises(DuplicateKeyError):
        await flow.db.notifications.insert_one({**row, "id": new_id()})
    # Gegenprobe: Nachrichten ohne Schlüssel (alle anderen Arten) bleiben frei.
    await flow.db.notifications.insert_one({"id": new_id(), "user_id": user["id"], "kind": "general"})
    await flow.db.notifications.insert_one({"id": new_id(), "user_id": user["id"], "kind": "general"})


# ---------------------------------------------------------------- Termin offen

async def week_of(flow, world):
    match = await flow.db.matches_v2.find_one({"id": world["match"]["id"]}, {"_id": 0})
    return league_schedule.window_of(await staffel(flow, world), match)


@pytest.mark.asyncio
async def test_open_date_reminds_both_captains_at_mid_week_once(flow):
    world = await reminder_world(flow, hours=100, source="default")
    window = await week_of(flow, world)
    middle = window.start + (window.end - window.start) / 2
    assert (await run(flow, world, middle - timedelta(minutes=1)))["unscheduled"] == 0, "vor der Wochenmitte"
    assert (await run(flow, world, middle))["unscheduled"] == 1
    rows = await notes(flow, "unscheduled")
    assert names(world, rows) == {"Kapitaen", "Falke1"}, "nur die Captains"
    assert rows[0]["title"] == "Termin noch offen" and rows[0]["kind"] == "match_schedule"
    assert f"gilt der Standardtermin {league_schedule.when_text(world['start'])} Uhr" in rows[0]["body"]
    assert (await run(flow, world, middle + timedelta(hours=5)))["unscheduled"] == 0, "einmal je Spielwoche"
    assert len(await notes(flow, "unscheduled")) == 2


@pytest.mark.asyncio
async def test_open_date_comes_before_an_early_default_time(flow):
    """N2: Liegt der Standardtermin vor der Wochenmitte, kommt „Termin offen“ spätestens 24 Stunden (einstellbar) vor ihm."""
    world = await reminder_world(flow, hours=100, source="default")
    window = await week_of(flow, world)
    default = window.start + timedelta(days=2, hours=20)
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {"scheduled_at": default.isoformat()}})
    assert default < window.start + (window.end - window.start) / 2, "Standardtermin vor der Wochenmitte"
    assert (await run(flow, world, default - timedelta(hours=24, minutes=1)))["unscheduled"] == 0, "noch zu früh"
    assert (await run(flow, world, default - timedelta(hours=24)))["unscheduled"] == 1
    assert names(world, await notes(flow, "unscheduled")) == {"Kapitaen", "Falke1"}
    # Einstellbar: 6 Stunden vorher.
    other = await reminder_world(flow, hours=100, source="default", rules={"unscheduled_hours_before_default": 6}, letter="B")
    other_window = await week_of(flow, other)
    other_default = other_window.start + timedelta(days=2, hours=20)
    await flow.db.matches_v2.update_one({"id": other["match"]["id"]}, {"$set": {"scheduled_at": other_default.isoformat()}})
    assert (await run(flow, other, other_default - timedelta(hours=24)))["unscheduled"] == 0
    assert (await run(flow, other, other_default - timedelta(hours=6)))["unscheduled"] == 1


@pytest.mark.asyncio
async def test_open_date_stays_quiet_with_a_fixed_time_a_past_default_a_block_or_switched_off(flow):
    world = await reminder_world(flow, hours=100, source="accepted")
    window = await week_of(flow, world)
    middle = window.start + (window.end - window.start) / 2
    assert (await run(flow, world, middle))["unscheduled"] == 0, "Termin steht fest"
    mid = world["match"]["id"]
    await flow.db.matches_v2.update_one({"id": mid}, {"$set": {"schedule_source": "default",
                                                               "scheduled_at": (middle - timedelta(hours=1)).isoformat()}})
    assert (await run(flow, world, middle))["unscheduled"] == 0, "Standardtermin schon vorbei"
    await flow.db.matches_v2.update_one({"id": mid}, {"$set": {"scheduled_at": world["start"].isoformat()}})
    day = vienna_day(middle + timedelta(hours=1))
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {
        "blocked_periods": [{"start_date": day, "end_date": day, "label": "Pause"}],
        "reminder_rules": {**league_reminder_rules.defaults(), "unscheduled_week_percent": 50}}})
    assert (await run(flow, world, middle + timedelta(hours=1)))["unscheduled"] == 0, "Sperrzeit"
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {
        "blocked_periods": [], "reminder_rules": {**league_reminder_rules.defaults(), "unscheduled": False}}})
    assert (await run(flow, world, middle + timedelta(hours=1)))["unscheduled"] == 0, "aus"
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"reminder_rules": league_reminder_rules.defaults()}})
    assert (await run(flow, world, middle + timedelta(hours=1)))["unscheduled"] == 1, "Gegenprobe"


# ---------------------------------------------------------------- Ergebnis fehlt

async def result_world(flow, **rules) -> dict:
    world = await reminder_world(flow, hours=-30, rules=rules or None)
    return world


async def schedule_sweep(flow, world) -> dict:
    return await league_schedule_sweep.sweep(flow.db, [await staffel(flow, world)], now=world["now"])


@pytest.mark.asyncio
async def test_result_missing_reminds_both_captains_and_waits_for_open_incidents_and_procedures(flow):
    world = await result_world(flow)
    mid = world["match"]["id"]
    await flow.db.matches_v2.update_one({"id": mid}, {"$set": {"incidents": [{"id": "v1", "state": "in_review", "kind": "rehost"}]}})
    assert (await schedule_sweep(flow, world))["reminded"] == 0, "Vorfall offen"
    await flow.db.matches_v2.update_one({"id": mid}, {"$set": {
        "incidents": [{"id": "v1", "state": "decided", "kind": "rehost"}],
        "disputes": [{"id": "p1", "kind": "objection", "state": "open"}]}})
    assert (await schedule_sweep(flow, world))["reminded"] == 0, "Verfahren offen"
    await flow.db.matches_v2.update_one({"id": mid}, {"$set": {"disputes": [{"id": "p1", "kind": "objection", "state": "withdrawn"}]}})
    assert (await schedule_sweep(flow, world))["reminded"] == 1, "Gegenprobe: alles geschlossen"
    rows = await notes(flow, "result_missing_reminder")
    assert names(world, rows) == {"Kapitaen", "Falke1"}
    assert rows[0]["meta"]["league_reminder"] == "result_missing" and rows[0]["unique_dedupe_key"]
    assert (await schedule_sweep(flow, world))["reminded"] == 0


@pytest.mark.asyncio
async def test_result_missing_can_be_switched_off_per_season(flow):
    world = await result_world(flow, result_missing=False)
    counts = await schedule_sweep(flow, world)
    assert counts["reminded"] == 0 and await notes(flow, "result_missing_reminder") == []


@pytest.mark.asyncio
async def test_switching_result_missing_on_again_reminds_only_matches_inside_the_window(flow):
    """N5: Wieder eingeschaltet - keine Flut für alte Spiele. Erinnert wird nur, solange das Spiel noch nicht überfällig ist."""
    world = await reminder_world(flow, hours=-100, rules={"result_missing": False})
    mid = world["match"]["id"]
    assert (await schedule_sweep(flow, world))["overdue"] == 1, "alt und nie gemeldet: überfällig bei der Leitung"
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"reminder_rules": league_reminder_rules.defaults()}})
    assert (await schedule_sweep(flow, world))["reminded"] == 0, "100 h nach dem Termin: keine Erinnerung mehr"
    # Gegenprobe: ein Spiel von vor 30 Stunden (Erinnerung nach 24 h, überfällig nach 48 h) wird erinnert.
    await flow.db.matches_v2.update_one({"id": mid}, {"$set": {"scheduled_at": (world["now"] - timedelta(hours=30)).isoformat(),
                                                               "result_overdue_at": None}})
    assert (await schedule_sweep(flow, world))["reminded"] == 1


def test_the_overdue_run_only_loads_what_can_be_due():
    """N5: Ohne Erinnerung fragt der Lauf nur nach Spielen, die noch nicht überfällig sind; künftige Termine lädt er nie."""
    now = datetime(2026, 12, 1, 12, 0, tzinfo=timezone.utc)
    on = league_schedule_sweep.overdue_filter("t1", SCHEDULE_DEFAULTS, league_reminder_rules.defaults(), now)
    off = league_schedule_sweep.overdue_filter("t1", SCHEDULE_DEFAULTS, {**league_reminder_rules.defaults(), "result_missing": False}, now)
    assert on["$or"] == [{"result_overdue_at": None}, {"result_reminded_at": None}]
    assert off["$or"] == [{"result_overdue_at": None}]
    assert on["scheduled_at"]["$lte"] == "2026-12-01T02:00:00+00:00", "24 h zurück, 14 h Spielraum für den Textvergleich"
    assert off["scheduled_at"]["$lte"] == "2026-11-30T02:00:00+00:00", "ohne Erinnerung erst ab „überfällig“ (48 h)"


# ---------------------------------------------------------------- Map-Veto wartet

async def with_rules(flow, world, **rules) -> None:
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {
        "reminder_rules": {**league_reminder_rules.defaults(), **rules}}})


@pytest.mark.asyncio
async def test_veto_waiting_uses_the_seconds_of_the_season(flow):
    world = await started_world(flow)
    await with_rules(flow, world, veto_idle_seconds=40, veto_min_left_seconds=10)
    now = await move_deadline(flow, world, 55)
    assert await league_veto_sweep.nudge(flow.db, now=now + timedelta(seconds=20)) == 0, "nicht mehr nach 20 s"
    assert await league_veto_sweep.nudge(flow.db, now=now + timedelta(seconds=46)) == 0, "nie in den letzten 10 s"
    assert await league_veto_sweep.nudge(flow.db, now=now + timedelta(seconds=40)) == 1, "nach 40 s ohne Zug"
    rows = await nudges(flow)
    assert len(rows) == 1 and rows[0]["meta"]["league_reminder"] == "veto_turn"
    assert await league_veto_sweep.nudge(flow.db, now=now + timedelta(seconds=41)) == 0


@pytest.mark.asyncio
async def test_veto_waiting_can_be_switched_off(flow):
    world = await started_world(flow)
    await with_rules(flow, world, veto_turn=False)
    now = await move_deadline(flow, world, 30)
    assert await league_veto_sweep.nudge(flow.db, now=now) == 0 and await nudges(flow) == []
    await with_rules(flow, world)
    assert await league_veto_sweep.nudge(flow.db, now=now) == 1, "Gegenprobe: wieder an, Vorgabe 20 s / 5 s"


# ---------------------------------------------------------------- Einstellung je Season

@pytest.mark.asyncio
async def test_season_rules_write_season_and_staffeln(flow):
    world = await reminder_world(flow)
    season = {"id": world["season_id"], "league_id": "liga", "number": 1, "name": "Season 1", "slug": "season-1"}
    await flow.db.league_seasons.insert_one(dict(season))
    url = f"/api/admin/leagues/seasons/{season['id']}/reminder-rules"
    flow.act_as(world["users"]["Kapitaen"])
    assert (await flow.get(url)).status_code == 403
    flow.act_as(world["staff"])
    first = (await flow.get(url)).json()
    assert first["active"] is False and first["defaults"] == league_reminder_rules.defaults()
    assert first["result_reminder_hours"] == SCHEDULE_DEFAULTS["result_reminder_hours"]
    assert (await flow.put(url, json={"veto_idle_seconds": 1})).status_code == 422
    assert (await flow.put(url, json={"upcoming_early_hours": 2, "upcoming_late_minutes": 120})).status_code == 422
    assert (await flow.put(url, json={"was": 1})).status_code == 422
    saved = await flow.put(url, json={"upcoming_early_hours": 12, "discord": True})
    assert saved.status_code == 200, saved.text
    assert saved.json()["staffeln_updated"] == 1
    stored = (await staffel(flow, world))["reminder_rules"]
    assert stored["upcoming_early_hours"] == 12 and stored["discord"] is True and stored["veto_idle_seconds"] == 20
    again = await flow.put(url, json={"veto_turn": False})
    assert again.json()["reminder_rules"]["upcoming_early_hours"] == 12, "Teil-Anfrage behält die übrigen Werte"
    assert await flow.db.audit_logs.find_one({"action": "league.season.reminder_rules"})


def test_rules_of_old_staffeln_and_other_tournaments():
    assert league_reminder_rules.rules_of({"id": "t"}) is None, "kein Liga-Turnier"
    assert league_reminder_rules.rules_of({"league_context": {}}) == league_reminder_rules.defaults(), "ältere Staffel: Vorgabe"
    bent = {"league_context": {}, "reminder_rules": {"veto_idle_seconds": "viel"}}
    assert league_reminder_rules.rules_of(bent) == league_reminder_rules.defaults()
    assert league_reminder_rules.lead_text(24 * 60) == "24 Stunden" and league_reminder_rules.lead_text(45) == "45 Minuten"
