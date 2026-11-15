"""Nachmeldung nach dem Season-Start (docs/LIGA.md, B.4, #2422, Entscheidungen Nr. 183 und 184): Ein Team, das nach dem Start in eine
Staffel kommt, bekommt nach Vorschau und Bestätigung Spiele in den noch offenen Spielwochen. Gespieltes bleibt, wie es ist. Dazu die
Nachmeldefrist je Season mit Verlängerung, die Tabelle mit ungleicher Spielzahl und der Abschluss. Durch die echten Routen, erfundene
Namen."""
from __future__ import annotations

import asyncio
import pathlib
import sys
from datetime import datetime, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_application_world import application_world, base_url, inbox_url, submit, submitted  # noqa: E402
from league_rules_world import ADMIN_LEAGUES  # noqa: E402
from league_start_world import ok  # noqa: E402
from models import now_utc  # noqa: E402

STAFFELN = f"{ADMIN_LEAGUES}/staffeln"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


def season_url(world: dict) -> str:
    return f"{ADMIN_LEAGUES}/seasons/{world['season']['id']}"


def late_url(world: dict, registration_id: str) -> str:
    return f"{STAFFELN}/{world['tid']}/late-entries/{registration_id}"


async def shift_start(flow, world: dict, days_ago: float) -> str:
    """Die Season (und ihre Staffeln) begann vor ``days_ago`` Tagen - so laufen Spielwochen ab, ohne auf die Uhr zu warten."""
    start = (now_utc() - timedelta(days=days_ago)).isoformat()
    await flow.db.league_seasons.update_one({"id": world["season"]["id"]}, {"$set": {"start_date": start}})
    await flow.db.tournaments.update_many({"league_context.season_id": world["season"]["id"]}, {"$set": {"start_date": start}})
    return start


async def accept(flow, world: dict, side: dict, tid: str | None = None) -> dict:
    application = await submitted(flow, world, side)
    flow.act_as(world["lead"])
    return ok(await flow.post(f"{inbox_url(world)}/{application['id']}/accept", json={"tournament_id": tid or world["tid"]}))


async def running_staffel(flow, *, teams: int, weeks: int, days_ago: float = 10, **season) -> dict:
    """``teams - 1`` Co-Teams in Staffel A, die Staffel läuft; mit ``days_ago`` 10 ist Woche 1 vorbei und Woche 2 läuft. Das letzte
    Team meldet nach. Die Staffel hat genau ``teams`` Plätze (Runden ≤ aktive Wochen)."""
    world = await application_world(flow, teams=teams, weeks_total=weeks, max_staffel_size=teams, **season)
    flow.act_as(world["lead"])
    ok(await flow.patch(season_url(world), json={"application_opens_at": (now_utc() - timedelta(hours=1)).isoformat(),
                                                 "application_closes_at": (now_utc() + timedelta(days=40)).isoformat()}))
    for side in world["teams"][:-1]:
        await accept(flow, world, side)
    flow.act_as(world["lead"])
    ok(await flow.post(f"/api/tournaments/{world['tid']}/status", json={"status": "live"}))
    await shift_start(flow, world, days_ago)
    return world


async def matches(flow, world: dict) -> list[dict]:
    return await flow.db.matches_v2.find({"tournament_id": world["tid"], "is_preview": {"$ne": True}}, {"_id": 0}).sort("id", 1).to_list(200)


def sides(match: dict) -> set[str]:
    return {slot["registration_id"] for slot in match["slots"]}


async def late_entry(flow, world: dict) -> tuple[dict, dict]:
    accepted = await accept(flow, world, world["teams"][-1])
    registration = await flow.db.tournament_registrations.find_one({"id": accepted["assignment"]["registration_id"]}, {"_id": 0})
    return accepted, registration


async def admin_assign(flow, world: dict) -> dict:
    """Der Sonderweg ohne Antrag (Turnierverwaltung): auch nach dem Ende der Anmeldung eine Nachmeldung."""
    side = world["teams"][-1]
    flow.act_as(world["lead"])
    return ok(await flow.post(f"/api/tournaments/{world['tid']}/squad-registrations",
                              json={"team_id": side["team"]["id"], "squad_id": side["squad"]["id"]}))["registration"]


@pytest.mark.asyncio
async def test_a_late_entry_gets_only_open_weeks_and_nothing_played_changes(flow):
    """Drei Teams, Woche 1 vorbei, Woche 2 läuft: Das neue Team spielt in Woche 3 gegen das Team mit Freilos und in der Reservewoche 4
    gegen ein zweites. Gegen das dritte passt keine offene Woche mehr - das steht in der Vorschau. Bestehende Spiele bleiben gleich."""
    world = await running_staffel(flow, teams=4, weeks=4)
    played = (await matches(flow, world))[0]
    await flow.db.matches_v2.update_one({"id": played["id"]}, {"$set": {"status": "completed", "results": [
        {"registration_id": played["slots"][0]["registration_id"], "rank": 1, "score": 2},
        {"registration_id": played["slots"][1]["registration_id"], "rank": 2, "score": 0}]}})
    before = await matches(flow, world)
    accepted, registration = await late_entry(flow, world)
    late_id = registration["id"]
    assert registration["late_entry"]["state"] == "open" and registration["late_entry"]["from_week"] == 3
    # Gegenprobe: Das Zuteilen allein legt kein Spiel an - keine stille Änderung.
    assert await matches(flow, world) == before

    flow.act_as(world["lead"])
    preview = ok(await flow.get(late_url(world, late_id)))
    bye_team = next(row["id"] for row in await flow.db.tournament_registrations.find(
        {"tournament_id": world["tid"], "id": {"$ne": late_id}}, {"_id": 0}).to_list(10)
        if not any(row["id"] in sides(match) for match in before if match["round"] == 3))
    assert [row["matchday"] for row in preview["pairings"]] == [3, 4]
    assert preview["pairings"][0]["opponent_id"] == bye_team and preview["pairings"][0]["kind"] == "bye"
    assert preview["pairings"][1]["kind"] == "reserve"
    assert len(preview["missing"]) == 1
    missing = preview["missing"][0]
    assert missing["text"] == f"Gegen {missing['opponent_name']} kein Spiel mehr möglich."
    assert preview["from_week"] == 3 and preview["open_weeks"] == [3, 4]

    # Falscher Fingerabdruck: nichts angelegt.
    refused = await flow.post(late_url(world, late_id), json={"fingerprint": "veraltet"})
    assert refused.status_code == 409 and "Vorschau neu laden" in refused.json()["detail"]
    assert await matches(flow, world) == before

    done = ok(await flow.post(late_url(world, late_id), json={"fingerprint": preview["fingerprint"]}))
    assert done["state"] == "done" and len(done["match_ids"]) == 2
    after = await matches(flow, world)
    assert [match for match in after if match["id"] not in done["match_ids"]] == before
    created = sorted((match for match in after if match["id"] in done["match_ids"]), key=lambda match: match["round"])
    assert [match["round"] for match in created] == [3, 4]
    assert all(late_id in sides(match) and match["generation_mode"] == "late_entry" for match in created)
    assert sides(created[0]) == {late_id, bye_team}
    # Termin nach den bestehenden Regeln: der Standardtermin der Woche (Sonntag 20:00 Wiener Zeit).
    week3 = preview["pairings"][0]
    assert created[0]["schedule_source"] == "default"
    assert week3["starts_at"] <= created[0]["scheduled_at"] < week3["ends_at"]
    assert created[0]["scheduled_at"] == datetime.fromisoformat(week3["default_at"]).isoformat()

    stored = await flow.db.tournament_registrations.find_one({"id": late_id}, {"_id": 0})
    assert stored["late_entry"]["state"] == "done" and stored["late_entry"]["created"] == 2
    assert [row["opponent_id"] for row in stored["late_entry"]["missing"]] == [missing["opponent_id"]]
    log = await flow.db.audit_logs.find_one({"action": "league.staffel.late_entry"}, {"_id": 0})
    assert log["data"]["registration_id"] == late_id and sorted(log["data"]["match_ids"]) == sorted(done["match_ids"])
    # Ein zweites Mal geht nicht.
    again = await flow.post(late_url(world, late_id), json={"fingerprint": preview["fingerprint"]})
    assert again.status_code == 409
    assert len(await matches(flow, world)) == len(after)
    # Die neuen Gegner erfahren es.
    notes = await flow.db.notifications.count_documents({"meta.dedupe_key": {"$regex": "^late-entry:"}})
    assert notes > 0

    # Die Verwaltung listet die Nachmeldung der Season.
    items = ok(await flow.get(f"{season_url(world)}/late-entries"))["items"]
    assert [(row["registration_id"], row["state"], row["created"]) for row in items] == [(late_id, "done", 2)]


@pytest.mark.asyncio
async def test_an_even_staffel_plays_every_week_and_only_reserve_weeks_are_free(flow):
    """Vier Teams spielen jede Woche (kein Freilos): Woche 3 ist für alle belegt, die Reservewochen 4 und 5 nicht - zwei Gegner passen,
    gegen zwei steht „kein Spiel mehr möglich“."""
    world = await running_staffel(flow, teams=5, weeks=5)
    _accepted, registration = await late_entry(flow, world)
    flow.act_as(world["lead"])
    preview = ok(await flow.get(late_url(world, registration["id"])))
    assert [row["matchday"] for row in preview["pairings"]] == [4, 5]
    assert {row["kind"] for row in preview["pairings"]} == {"reserve"} and len(preview["missing"]) == 2
    assert all(row["text"].endswith("kein Spiel mehr möglich.") for row in preview["missing"])


@pytest.mark.asyncio
async def test_without_an_open_week_the_lead_confirms_counting_from_now(flow):
    """Alle Wochen haben begonnen: kein Spiel passt mehr. Die Bestätigung hält das fest (nur Wertung ab jetzt), angelegt wird nichts.
    Die Zuteilung kam über die Turnierverwaltung - nach dem Ende der Anmeldung geht nur dieser Weg."""
    world = await running_staffel(flow, teams=5, weeks=5, days_ago=31)
    before = await matches(flow, world)
    registration = await admin_assign(flow, world)
    assert registration["late_entry"]["state"] == "open" and registration["late_entry"]["from_week"] is None
    preview = ok(await flow.get(late_url(world, registration["id"])))
    assert preview["pairings"] == [] and len(preview["missing"]) == 4 and preview["open_weeks"] == []
    done = ok(await flow.post(late_url(world, registration["id"]), json={"fingerprint": preview["fingerprint"]}))
    assert done["match_ids"] == [] and await matches(flow, world) == before
    standings = {row["registration_id"]: row for row in ok(await flow.get(f"/api/tournaments/{world['tid']}/standings"))}
    row = standings[registration["id"]]
    assert row["late_entry"] is True and "late_from_week" not in row and row["played"] == 0


@pytest.mark.asyncio
async def test_a_changed_plan_needs_a_new_preview(flow):
    """Zwischen Vorschau und Bestätigung wird ein Spiel in Woche 3 abgesagt: Beide Seiten sind dort frei, die Vorschau stimmt nicht mehr."""
    world = await running_staffel(flow, teams=4, weeks=4)
    _accepted, registration = await late_entry(flow, world)
    flow.act_as(world["lead"])
    first = ok(await flow.get(late_url(world, registration["id"])))
    week3 = next(match for match in await matches(flow, world) if match["round"] == 3)
    await flow.db.matches_v2.update_one({"id": week3["id"]}, {"$set": {"status": "cancelled"}})
    refused = await flow.post(late_url(world, registration["id"]), json={"fingerprint": first["fingerprint"]})
    assert refused.status_code == 409
    assert await flow.db.matches_v2.count_documents({"tournament_id": world["tid"], "generation_mode": "late_entry"}) == 0
    second = ok(await flow.get(late_url(world, registration["id"])))
    assert second["fingerprint"] != first["fingerprint"]
    assert len(second["pairings"]) == 2 and len(second["missing"]) == 1
    done = ok(await flow.post(late_url(world, registration["id"]), json={"fingerprint": second["fingerprint"]}))
    assert len(done["match_ids"]) == 2


@pytest.mark.asyncio
async def test_two_confirmations_at_once_create_the_games_once(flow):
    world = await running_staffel(flow, teams=4, weeks=4)
    _accepted, registration = await late_entry(flow, world)
    flow.act_as(world["lead"])
    preview = ok(await flow.get(late_url(world, registration["id"])))
    answers = await asyncio.gather(*(flow.post(late_url(world, registration["id"]), json={"fingerprint": preview["fingerprint"]})
                                     for _ in range(2)))
    assert sorted(answer.status_code for answer in answers) == [200, 409], [answer.text for answer in answers]
    assert await flow.db.matches_v2.count_documents({"tournament_id": world["tid"], "generation_mode": "late_entry"}) == 2


@pytest.mark.asyncio
async def test_before_the_plan_is_fixed_there_is_no_late_entry(flow):
    """Gegenprobe: Vor dem Start (nur Vorschau) kommt das Team beim Start in den Plan wie alle - keine Markierung."""
    world = await application_world(flow, teams=2, weeks_total=6, max_staffel_size=4)
    accepted = await accept(flow, world, world["teams"][0])
    registration = await flow.db.tournament_registrations.find_one({"id": accepted["assignment"]["registration_id"]}, {"_id": 0})
    assert "late_entry" not in registration
    flow.act_as(world["lead"])
    gone = await flow.get(late_url(world, registration["id"]))
    assert gone.status_code == 404


@pytest.mark.asyncio
async def test_the_table_counts_unequal_games_and_the_staffel_closes(flow):
    """Ungleiche Spielzahl ist richtig: Das neue Team hat weniger Spiele und den Hinweis. Der Abschluss hängt an offenen Spielen, nicht
    an der Spielzahl je Team."""
    world = await running_staffel(flow, teams=4, weeks=4)
    _accepted, registration = await late_entry(flow, world)
    flow.act_as(world["lead"])
    preview = ok(await flow.get(late_url(world, registration["id"])))
    ok(await flow.post(late_url(world, registration["id"]), json={"fingerprint": preview["fingerprint"]}))
    for match in await matches(flow, world):
        home, away = (slot["registration_id"] for slot in match["slots"])
        await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {
            "status": "completed", "completed_at": "2026-01-01T00:00:00+00:00",
            "results": [{"registration_id": home, "rank": 1, "score": 2}, {"registration_id": away, "rank": 2, "score": 0}]}})
    standings = {row["registration_id"]: row for row in ok(await flow.get(f"/api/tournaments/{world['tid']}/standings"))}
    assert standings[registration["id"]]["played"] == 2 and standings[registration["id"]]["late_from_week"] == 3
    assert sorted(row["played"] for key, row in standings.items() if key != registration["id"]) == [2, 3, 3]
    assert all("late_from_week" not in row for key, row in standings.items() if key != registration["id"])
    closed = await flow.post(f"{STAFFELN}/{world['tid']}/close", json={"confirm": True})
    assert closed.status_code == 200, closed.text
    frozen = {row["registration_id"]: row for row in ok(await flow.get(f"/api/tournaments/{world['tid']}/standings"))}
    assert frozen[registration["id"]]["late_from_week"] == 3


@pytest.mark.asyncio
async def test_the_deadline_closes_the_window_two_weeks_after_the_start(flow):
    """Nr. 184: Vorgabe 14 Tage nach dem Start, auch wenn das Fenster länger läuft. Einstellbar je Season."""
    world = await application_world(flow, teams=1)
    flow.act_as(world["lead"])
    closes = now_utc() + timedelta(days=60)
    ok(await flow.patch(season_url(world), json={"application_opens_at": (now_utc() - timedelta(hours=1)).isoformat(),
                                                 "application_closes_at": closes.isoformat()}))
    start = datetime.fromisoformat(world["season"]["start_date"])
    view = ok(await flow.get(season_url(world)))["late_registration"]
    assert view["days"] == 14 and view["stored_days"] is None and view["capped"]
    assert datetime.fromisoformat(view["effective_closes_at"]) == start + timedelta(days=14)
    flow.act_as(None)
    block = ok(await flow.get(base_url(world)))["application"]
    assert datetime.fromisoformat(block["closes_at"]) == start + timedelta(days=14)
    flow.act_as(world["lead"])
    readiness = ok(await flow.get(f"{season_url(world)}/readiness"))
    assert "application_late_cap" in {row["code"] for row in readiness["warnings"]}

    ok(await flow.patch(season_url(world), json={"late_registration_days": 30}))
    view = ok(await flow.get(season_url(world)))["late_registration"]
    assert view["days"] == 30 and datetime.fromisoformat(view["effective_closes_at"]) == start + timedelta(days=30)
    bad = await flow.patch(season_url(world), json={"late_registration_days": 400})
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_after_the_deadline_the_lead_extends_with_a_reason(flow):
    world = await application_world(flow, teams=1)
    flow.act_as(world["lead"])
    ok(await flow.patch(season_url(world), json={"application_opens_at": (now_utc() - timedelta(days=30)).isoformat(),
                                                 "application_closes_at": (now_utc() + timedelta(days=20)).isoformat()}))
    await shift_start(flow, world, 20)
    side = world["teams"][0]
    late = await submit(flow, world, side)
    assert late.status_code == 409 and late.json()["detail"].startswith("Die Anmeldung ist vorbei: Sie lief bis ")

    flow.act_as(world["lead"])
    url = f"{season_url(world)}/application-extension"
    until = (now_utc() + timedelta(days=5)).isoformat()
    short = await flow.post(url, json={"until": until, "reason": "kurz"})
    assert short.status_code == 422
    too_far = await flow.post(url, json={"until": (now_utc() + timedelta(days=25)).isoformat(), "reason": "Nachrücker aus Liga 2"})
    assert too_far.status_code == 422 and "Fenster" in too_far.json()["detail"]
    extended = ok(await flow.post(url, json={"until": until, "reason": "Nachrücker aus Liga 2"}))
    assert extended["late_registration"]["extension"]["reason"] == "Nachrücker aus Liga 2"
    assert datetime.fromisoformat(extended["late_registration"]["effective_closes_at"]) == datetime.fromisoformat(until)
    log = await flow.db.audit_logs.find_one({"action": "league.season.late_extension"}, {"_id": 0})
    assert log["actor_id"] == world["lead"]["id"] and log["data"]["reason"] == "Nachrücker aus Liga 2" and log["data"]["before"] is None
    flow.act_as(None)
    assert ok(await flow.get(base_url(world)))["application"]["state"] == "open"
    ok(await submit(flow, world, side))

    flow.act_as(world["lead"])
    removed = ok(await flow.post(url, json={"until": None, "reason": "Frist wieder regulär"}))
    assert removed["late_registration"]["extension"] is None
    flow.act_as(None)
    assert ok(await flow.get(base_url(world)))["application"]["state"] == "closed"
