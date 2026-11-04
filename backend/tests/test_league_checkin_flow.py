"""Liga-Check-in und Start (#1652, docs/LIGA.md D.2) über die echten Routen: Anwesende mit Eignung, Fenster, Regelwerks-Sperre,
beide Seiten gleichzeitig, doppelte Klicks, Start genau einmal, Vorschlag an die Leitung statt Wertung, Erinnerungen, Aufgabe,
Mein Dienst, Datenschutz und die Einstellung je Season. Erfundene Namen."""
import asyncio
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import ids, two_nil, world as league_world  # noqa: E402
from models import now_utc  # noqa: E402
from services import league_checkin_sweep, league_schedule, league_schedule_sweep, match_deadline_sweep, match_flow  # noqa: E402
from services.match_flow import DEFAULTS  # noqa: E402
from services.match_public_view import public_match_view  # noqa: E402

RULES = {**DEFAULTS, "min_present": 2}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def at(minutes: float) -> str:
    return (now_utc() + timedelta(minutes=minutes)).replace(microsecond=0).isoformat()


async def checkin_world(flow, *, minutes: float = 0, rules: dict | None = RULES, letter: str = "A", **fields) -> dict:
    """Die Spielwelt mit Check-in: Termin ``minutes`` ab jetzt (Fenster 15 Minuten davor bis 15 danach), dazu eine Liga-Leitung mit
    „Spiele betreuen“ und „Ergebnisse“. Eine zweite Welt im selben Test bekommt einen anderen Staffel-Buchstaben (``letter``)."""
    world = await league_world(flow, letter=letter)
    update = {"checkin_rules": dict(rules)} if rules is not None else {}
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {**update, **fields}})
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {"scheduled_at": at(minutes), "status": "scheduled"}})
    lead = await flow.add_user(name="Ligaleitung")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": "liga", "user_id": lead["id"], "capabilities": ["matches", "results"],
                                           "created_at": now_utc().isoformat()})
    world["lead"] = lead
    return world


def mid(world) -> str:
    return world["match"]["id"]


async def checkin(flow, world, user: str, *names: str, **extra):
    flow.act_as(world["users"][user])
    return await flow.post(f"/api/matches/{mid(world)}/checkin", json={"present": ids(world, *names), **extra})


async def start(flow, world, user):
    flow.act_as(user if isinstance(user, dict) else world["users"][user])
    return await flow.post(f"/api/matches/{mid(world)}/checkin/start", json={})


async def page(flow, world, user) -> dict:
    flow.act_as(user if isinstance(user, dict) or user is None else world["users"][user])
    answer = await flow.get(f"/api/matches/{mid(world)}/page")
    assert answer.status_code == 200, answer.text
    return answer.json()


async def tournament_of(flow, world) -> dict:
    return await flow.db.tournaments.find_one({"id": world["tournament"]["id"]}, {"_id": 0})


async def sweep(flow, world, minutes: float):
    return await match_deadline_sweep.sweep(flow.db, now=now_utc() + timedelta(minutes=minutes))


async def shift(flow, world, minutes: float) -> None:
    """Die Zeit „vorspulen“: Termin verschieben, die Check-ins gehören weiter zu ihm (``for_at``) - anders als ein neuer Termin der
    Leitung, der sie aufhebt (eigener Test)."""
    stored = await flow.reload(world["match"])
    when = at(minutes)
    update = {"scheduled_at": when}
    for registration_id in ((stored.get("flow") or {}).get("checkin") or {}):
        update[f"flow.checkin.{registration_id}.for_at"] = when
    if (stored.get("flow") or {}).get("ready_for"):
        update["flow.ready_for"] = when
    await flow.db.matches_v2.update_one({"id": mid(world)}, {"$set": update})


# ---------------------------------------------------------------- Check-in einer Seite

@pytest.mark.asyncio
async def test_captain_checks_in_and_the_page_guides_both_sides(flow):
    world = await checkin_world(flow)
    first = await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")
    assert first.status_code == 200, first.text
    assert first.json()["ready"] is False and first.json()["idempotent_replay"] is False
    stored = await flow.reload(world["match"])
    entry = stored["flow"]["checkin"][world["reg_a"]["id"]]
    assert entry["present"] == ids(world, "Kapitaen", "Mila") and entry["via"] == "side" and entry["user_id"] == world["users"]["Kapitaen"]["id"]
    assert stored["flow"].get("ready_at") is None and not stored.get("started_at") and stored["status"] == "scheduled"
    assert "flow" not in public_match_view(stored), "Konto-Kennungen bleiben intern"

    own = (await page(flow, world, "Kapitaen"))["checkin"]
    assert own["state"] == "open" and own["can_checkin"] is True and own["min_present"] == 2
    assert [side["checked_in"] for side in own["sides"]] == [True, False] and own["sides"][0]["own"] is True
    assert [row["name"] for row in own["sides"][0]["present"]] == ["Kapitaen", "Mila"]
    assert {row["name"] for row in own["roster"]} == {"Kapitaen", "Mila", "Tom"}
    assert own["can_start"] is False and "beide Seiten" in own["start_hint"]
    other = (await page(flow, world, "Falke1"))["checkin"]
    assert other["sides"][0]["present_count"] == 2 and other["sides"][1]["own"] is True and other["can_checkin"] is True
    assert (await page(flow, world, "Fremd"))["checkin"] is None, "Unbeteiligte bekommen keinen Block"
    assert (await page(flow, world, None))["checkin"] is None

    notes = await flow.db.notifications.find({"meta.reason": "checkin_side"}, {"_id": 0}).to_list(10)
    assert {row["user_id"] for row in notes} == {world["users"]["Falke1"]["id"]} and "2 Spieler" in notes[0]["body"]

    replay = await checkin(flow, world, "Kapitaen", "Mila", "Kapitaen")
    assert replay.json()["idempotent_replay"] is True
    amended = await checkin(flow, world, "Kapitaen", "Kapitaen", "Tom", "Mila")
    assert amended.status_code == 200 and amended.json()["idempotent_replay"] is False
    again = (await flow.reload(world["match"]))["flow"]["checkin"][world["reg_a"]["id"]]
    assert again["at"] == entry["at"] and again["updated_at"] >= entry["updated_at"] and len(again["present"]) == 3
    audit = await flow.db.audit_logs.find({"action": "match.checkin"}, {"_id": 0}).to_list(10)
    assert [row["data"]["count"] for row in audit] == [2, 3] and audit[1]["data"]["amended"] is True


@pytest.mark.asyncio
async def test_present_players_need_the_roster_the_minimum_and_the_eligibility(flow):
    world = await checkin_world(flow)
    few = await checkin(flow, world, "Kapitaen", "Kapitaen")
    assert few.status_code == 422 and "mindestens 2" in few.json()["detail"] and "anwesend" in few.json()["detail"]
    outsider = await checkin(flow, world, "Kapitaen", "Kapitaen", "Ida")
    assert outsider.status_code == 422 and "Kader" in outsider.json()["detail"]
    twice = await checkin(flow, world, "Kapitaen", "Kapitaen", "Kapitaen")
    assert twice.status_code == 422 and "nur einmal" in twice.json()["detail"]
    await flow.db.users.update_one({"id": world["users"]["Mila"]["id"]}, {"$set": {"is_banned": True}})
    banned = await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")
    assert banned.status_code == 422 and "Mila" in banned.json()["detail"] and "gesperrt" in banned.json()["detail"]
    block = (await page(flow, world, "Kapitaen"))["checkin"]
    assert next(row for row in block["roster"] if row["name"] == "Mila")["blocked"]
    member = await checkin(flow, world, "Tom", "Kapitaen", "Tom")
    assert member.status_code == 403, "nur Captain oder Vertreter"
    stranger = await checkin(flow, world, "Fremd", "Fremd")
    assert stranger.status_code == 403
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Tom")).status_code == 200


@pytest.mark.asyncio
async def test_the_window_opens_and_closes_around_the_time(flow):
    world = await checkin_world(flow, minutes=60)
    early = await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")
    assert early.status_code == 409 and "öffnet erst" in early.json()["detail"]
    block = (await page(flow, world, "Kapitaen"))["checkin"]
    assert block["state"] == "waiting" and block["can_checkin"] is False and "öffnet erst" in block["checkin_hint"]
    assert block["window"]["opens_at"] < block["scheduled_at"] < block["window"]["closes_at"]

    await flow.db.matches_v2.update_one({"id": mid(world)}, {"$set": {"scheduled_at": at(-30)}})
    late = await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")
    assert late.status_code == 409 and "geschlossen" in late.json()["detail"] and "@leitung" in late.json()["detail"]
    assert (await page(flow, world, "Kapitaen"))["checkin"]["state"] == "closed"

    # Die Leitung trägt die Seite nach - mit Grund, auch nach Fensterende.
    flow.act_as(world["lead"])
    no_reason = await flow.post(f"/api/matches/{mid(world)}/checkin", json={"present": ids(world, "Kapitaen", "Mila"),
                                                                           "registration_id": world["reg_a"]["id"]})
    assert no_reason.status_code == 422 and "Grund" in no_reason.json()["detail"]
    entered = await flow.post(f"/api/matches/{mid(world)}/checkin", json={"present": ids(world, "Kapitaen", "Mila"),
                                                                         "registration_id": world["reg_a"]["id"], "reason": "Captain ohne Netz, per Telefon"})
    assert entered.status_code == 200, entered.text
    stored = (await flow.reload(world["match"]))["flow"]["checkin"][world["reg_a"]["id"]]
    assert stored["via"] == "lead" and stored["by"] == world["lead"]["id"] and stored["reason"] == "Captain ohne Netz, per Telefon"
    audit = await flow.db.audit_logs.find_one({"action": "match.checkin.lead"}, {"_id": 0})
    assert audit["actor_id"] == world["lead"]["id"] and audit["data"]["reason"] == "Captain ohne Netz, per Telefon"
    lead_page = (await page(flow, world, world["lead"]))["checkin"]
    assert lead_page["lead"]["can_enter"] is True and set(lead_page["lead"]["rosters"]) == {world["reg_a"]["id"], world["reg_h"]["id"]}
    assert lead_page["sides"][0]["lead_reason"] == "Captain ohne Netz, per Telefon" and lead_page["sides"][0]["via"] == "lead"
    assert (await page(flow, world, "Falke1"))["checkin"]["sides"][0]["lead_reason"] is None, "der Grund gehört der Seite und der Leitung"

    # Ein Captain trägt keine fremde Seite ein, die Leitung ohne „Spiele betreuen“ auch nicht.
    foreign = await checkin(flow, world, "Falke1", "Kapitaen", "Mila", registration_id=world["reg_a"]["id"])
    assert foreign.status_code == 403
    await flow.db.league_staff.update_one({"user_id": world["lead"]["id"]}, {"$set": {"capabilities": ["results"]}})
    flow.act_as(world["lead"])
    refused = await flow.post(f"/api/matches/{mid(world)}/checkin", json={"present": ids(world, "Falke1", "Falke2"),
                                                                         "registration_id": world["reg_h"]["id"], "reason": "Grund genug"})
    assert refused.status_code == 403


@pytest.mark.asyncio
async def test_the_lead_is_biased_in_the_own_match(flow):
    world = await checkin_world(flow)
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": "liga", "user_id": world["users"]["Kapitaen"]["id"],
                                           "capabilities": ["matches"], "created_at": now_utc().isoformat()})
    biased = await checkin(flow, world, "Kapitaen", "Falke1", "Falke2", registration_id=world["reg_h"]["id"], reason="Grund genug")
    assert biased.status_code == 403 and "beteiligt" in biased.json()["detail"]
    flow.act_as(world["staff"])
    superadmin = await flow.post(f"/api/matches/{mid(world)}/checkin", json={"present": ids(world, "Falke1", "Falke2"),
                                                                            "registration_id": world["reg_h"]["id"], "reason": "Grund genug"})
    assert superadmin.status_code == 200, "nicht befangen"
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")).status_code == 200, "als Captain die eigene Seite wie immer"


# ---------------------------------------------------------------- Beide bereit, Start

@pytest.mark.asyncio
async def test_both_sides_ready_then_the_start_counts_once(flow):
    world = await checkin_world(flow, minutes=10)
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")).status_code == 200
    second = await checkin(flow, world, "Falke1", "Falke1", "Falke3")
    assert second.status_code == 200 and second.json()["ready"] is True
    stored = await flow.reload(world["match"])
    assert stored["flow"]["ready_at"] and not stored.get("started_at")
    ready = await flow.db.notifications.find({"meta.reason": "checkin_ready"}, {"_id": 0}).to_list(10)
    assert {row["user_id"] for row in ready} == {world["users"]["Kapitaen"]["id"], world["users"]["Falke1"]["id"]}
    block = (await page(flow, world, "Falke1"))["checkin"]
    assert block["state"] == "ready" and block["can_start"] is True and block["start_hint"] is None
    assert (await sweep(flow, world, 30))["proposed"] == 0, "beide da: kein Vorschlag nach dem Fenster"

    assert (await start(flow, world, "Fremd")).status_code == 403
    assert (await start(flow, world, "Tom")).status_code == 403
    went = await start(flow, world, "Falke1")
    assert went.status_code == 200 and went.json()["idempotent_replay"] is False
    stored = await flow.reload(world["match"])
    assert stored["started_at"] == went.json()["started_at"] and stored["status"] == "in_progress"
    assert stored["flow"]["start"]["registration_id"] == world["reg_h"]["id"] and stored["flow"]["start"]["via"] == "side"
    again = await start(flow, world, "Kapitaen")
    assert again.json()["idempotent_replay"] is True and again.json()["started_at"] == stored["started_at"]
    assert await flow.db.audit_logs.count_documents({"action": "match.checkin.start"}) == 1
    started = await flow.db.notifications.find({"meta.reason": "checkin_started"}, {"_id": 0}).to_list(10)
    assert {row["user_id"] for row in started} == {world["users"]["Kapitaen"]["id"], world["users"]["Falke1"]["id"]}
    running = (await page(flow, world, "Kapitaen"))["checkin"]
    assert running["state"] == "running" and running["can_checkin"] is False and running["can_start"] is False
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Tom")).status_code == 409, "nach dem Start kein Check-in mehr"
    # Ein laufendes Spiel ist kein Nichtantritt - auch lange nach dem Fenster nicht.
    assert (await sweep(flow, world, 60 * 5))["proposed"] == 0
    assert not (await flow.reload(world["match"])).get("no_show_proposal")


@pytest.mark.asyncio
async def test_start_needs_both_sides_and_the_lead_may_start(flow):
    world = await checkin_world(flow)
    too_early = await start(flow, world, "Kapitaen")
    assert too_early.status_code == 409 and "beide Seiten" in too_early.json()["detail"]
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")).status_code == 200
    assert (await start(flow, world, "Kapitaen")).status_code == 409
    assert (await checkin(flow, world, "Falke1", "Falke1", "Falke2")).status_code == 200
    went = await start(flow, world, world["lead"])
    assert went.status_code == 200, went.text
    assert (await flow.reload(world["match"]))["flow"]["start"] == {**(await flow.reload(world["match"]))["flow"]["start"], "via": "lead",
                                                                   "registration_id": None}


@pytest.mark.asyncio
async def test_simultaneous_clicks_of_both_sides_and_double_clicks_are_safe(flow):
    """Zwei Worker lesen denselben alten Stand und schreiben gleichzeitig (``asyncio.gather`` auf dem Dienst, mit demselben gelesenen
    Spiel): beide Seiten gehen durch, „beide da“ setzt genau einmal; ein doppelter Klick derselben Seite schreibt einmal, der zweite
    bekommt „bitte neu laden“; von zwei Starts zählt genau einer."""
    world = await checkin_world(flow)
    tournament = await tournament_of(flow, world)
    captain, falcon = world["users"]["Kapitaen"], world["users"]["Falke1"]
    stale = await flow.reload(world["match"])
    setup = await match_flow.sides(flow.db, stale, tournament)

    async def attempt(coroutine):
        try:
            return await coroutine
        except match_flow.FlowProblem as problem:
            return problem

    both = await asyncio.gather(
        attempt(match_flow.check_in(flow.db, stale, tournament, setup, registration_id=world["reg_a"]["id"], present=ids(world, "Kapitaen", "Mila"), user=captain)),
        attempt(match_flow.check_in(flow.db, stale, tournament, setup, registration_id=world["reg_h"]["id"], present=ids(world, "Falke1", "Falke2"), user=falcon)))
    assert all(isinstance(answer, dict) for answer in both), both
    assert any(answer["ready"] for answer in both)
    stored = await flow.reload(world["match"])
    assert set(stored["flow"]["checkin"]) == {world["reg_a"]["id"], world["reg_h"]["id"]} and stored["flow"]["ready_at"]
    assert await flow.db.notifications.count_documents({"meta.reason": "checkin_ready"}) == 2, "„beide da“ genau einmal je Seite"

    stale = await flow.reload(world["match"])
    twice = await asyncio.gather(
        attempt(match_flow.check_in(flow.db, stale, tournament, setup, registration_id=world["reg_a"]["id"], present=ids(world, "Kapitaen", "Tom"), user=captain)),
        attempt(match_flow.check_in(flow.db, stale, tournament, setup, registration_id=world["reg_a"]["id"], present=ids(world, "Kapitaen", "Tom"), user=captain)))
    assert sorted(type(answer).__name__ for answer in twice) == ["FlowProblem", "dict"], twice
    assert next(answer for answer in twice if isinstance(answer, match_flow.FlowProblem)).detail == match_flow.CHANGED_DETAIL
    assert (await flow.reload(world["match"]))["flow"]["checkin"][world["reg_a"]["id"]]["present"] == ids(world, "Kapitaen", "Tom")
    assert await flow.db.audit_logs.count_documents({"action": "match.checkin", "data.amended": True}) == 1

    stale = await flow.reload(world["match"])
    starts = await asyncio.gather(
        attempt(match_flow.start(flow.db, stale, tournament, setup, user=captain, registration_id=world["reg_a"]["id"])),
        attempt(match_flow.start(flow.db, stale, tournament, setup, user=falcon, registration_id=world["reg_h"]["id"])))
    assert all(isinstance(answer, dict) for answer in starts), starts
    assert sorted(answer["idempotent_replay"] for answer in starts) == [False, True]
    assert len({answer["started_at"] for answer in starts}) == 1
    assert await flow.db.audit_logs.count_documents({"action": "match.checkin.start"}) == 1
    assert await flow.db.notifications.count_documents({"meta.reason": "checkin_started"}) == 2

    # Über die Routen hält die Turniersperre nacheinander: der zweite Klick ist eine Wiederholung, nie ein zweiter Start.
    assert (await start(flow, world, "Kapitaen")).json()["idempotent_replay"] is True


# ---------------------------------------------------------------- Regelwerks-Sperre

async def with_rules(flow, world, *, version: int = 1, valid_from: str = "2020-01-01") -> None:
    """Liga und Season mit einem Regelwerk, dem zugestimmt werden muss."""
    now = now_utc().isoformat()
    if not await flow.db.leagues.find_one({"id": "liga"}):
        await flow.db.leagues.insert_one({"id": "liga", "name": "Probeliga", "slug": "probeliga", "status": "active", "game_id": "probe-shooter",
                                          "created_at": now})
        await flow.db.league_seasons.insert_one({"id": world["season_id"], "league_id": "liga", "name": "Season 1", "slug": "season-1",
                                                 "status": "active", "visibility": "public", "number": 1, "created_at": now})
    await flow.db.league_rules.insert_one({"id": f"rv{version}", "scope": "league", "scope_id": "liga", "status": "published", "version": version,
                                           "valid_from": valid_from, "published_at": now, "requires_consent": True, "title": "Regelwerk",
                                           "body_md": "# Fairplay\nText", "frozen": {}})


async def consent(flow, world, squad: str, version: int = 1) -> None:
    await flow.db.league_rule_consents.insert_one({"id": new_id(), "rule_version_id": f"rv{version}", "version": version, "season_id": world["season_id"],
                                                   "squad_id": world[squad]["id"], "user_id": "jemand", "league_id": "liga", "created_at": now_utc().isoformat()})


@pytest.mark.asyncio
async def test_without_consent_there_is_no_checkin_and_no_start(flow):
    world = await checkin_world(flow)
    await with_rules(flow, world)
    refused = await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")
    assert refused.status_code == 409 and "Regelwerk hat sich geändert" in refused.json()["detail"]
    assert "/liga/probeliga/season-1/regeln" in refused.json()["detail"]
    block = (await page(flow, world, "Kapitaen"))["checkin"]
    assert block["can_checkin"] is False and "Regelwerk" in block["checkin_hint"]
    assert block["sides"][0]["consent_open"] is True and block["sides"][0]["rules_url"] == "/liga/probeliga/season-1/regeln"
    # Auch die Leitung trägt die Seite nicht ein - das Team muss erst zustimmen.
    flow.act_as(world["lead"])
    lead = await flow.post(f"/api/matches/{mid(world)}/checkin", json={"present": ids(world, "Kapitaen", "Mila"),
                                                                      "registration_id": world["reg_a"]["id"], "reason": "Grund genug"})
    assert lead.status_code == 409 and "Regelwerk" in lead.json()["detail"]

    await consent(flow, world, "squad_a")
    agreed = await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")
    assert agreed.status_code == 200, agreed.text
    assert (await flow.reload(world["match"]))["flow"]["checkin"][world["reg_a"]["id"]]["rule_version_id"] == "rv1"
    await consent(flow, world, "horst")
    assert (await checkin(flow, world, "Falke1", "Falke1", "Falke2")).status_code == 200
    assert (await page(flow, world, "Kapitaen"))["checkin"]["can_start"] is True

    # Zwischen Check-in und Start kommt eine neue Fassung: ohne Zustimmung kein Start.
    await with_rules(flow, world, version=2)
    blocked = await start(flow, world, "Kapitaen")
    assert blocked.status_code == 409 and "Regelwerk" in blocked.json()["detail"] and "Rudel A" in blocked.json()["detail"]
    hint = (await page(flow, world, "Falke1"))["checkin"]
    assert hint["can_start"] is False and "Regelwerk" in hint["start_hint"]
    assert hint["sides"][0]["consent_open"] is True and hint["sides"][1]["consent_open"] is True
    await consent(flow, world, "squad_a", version=2)
    still = await start(flow, world, "Kapitaen")
    assert still.status_code == 409 and "Horst" in still.json()["detail"]
    await consent(flow, world, "horst", version=2)
    assert (await start(flow, world, "Kapitaen")).status_code == 200


# ---------------------------------------------------------------- Meldung erst nach dem Check-in (Codex zu D.2)

async def report(flow, world, user: str, side: str = "reg_a", *names: str):
    flow.act_as(world["users"][user])
    return await flow.post(f"/api/matches/{mid(world)}/report", json=two_nil(world, lineup=ids(world, *names), side=side))


@pytest.mark.asyncio
async def test_captains_report_only_after_both_checked_in_and_the_first_report_sets_the_start(flow):
    """Codex zu D.2 (4): In einer Staffel mit Check-in melden die Captains erst, wenn beide Seiten für diesen Termin eingecheckt sind -
    der Satz sagt, wer fehlt. Fehlt nur der Start-Klick, setzt die erste gültige Meldung den Start einmal nach."""
    world = await checkin_world(flow)
    refused = await report(flow, world, "Kapitaen", "reg_a", "Kapitaen", "Mila")
    assert refused.status_code == 409, refused.text
    assert "eingecheckt" in refused.json()["detail"] and "eure Seite" in refused.json()["detail"]
    own = await page(flow, world, "Kapitaen")
    assert own["can_player_report_result"] is True and "eure Seite" in own["report_hint"], "die Seite zeigt den Satz statt des Formulars"
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")).status_code == 200
    still = await report(flow, world, "Kapitaen", "reg_a", "Kapitaen", "Mila")
    assert still.status_code == 409 and "Horst" in still.json()["detail"], still.text
    assert "Horst" in (await page(flow, world, "Kapitaen"))["report_hint"]
    assert (await checkin(flow, world, "Falke1", "Falke1", "Falke2")).status_code == 200
    assert (await page(flow, world, "Kapitaen"))["report_hint"] is None
    assert not (await flow.reload(world["match"])).get("started_at"), "niemand hat auf Starten getippt"
    first = await report(flow, world, "Kapitaen", "reg_a", "Kapitaen", "Mila")
    assert first.status_code == 200, first.text
    stored = await flow.reload(world["match"])
    assert stored["started_at"] and stored["status"] == "in_progress"
    assert stored["flow"]["start"]["via"] == "report" and stored["flow"]["start"]["registration_id"] == world["reg_a"]["id"]
    assert await flow.db.audit_logs.count_documents({"action": "match.checkin.start"}) == 1
    assert (await page(flow, world, "Falke1"))["checkin"]["state"] == "running"
    second = await report(flow, world, "Falke1", "reg_h", "Falke1", "Falke2")
    assert second.status_code == 200, second.text
    done = await flow.reload(world["match"])
    assert done["status"] == "completed" and done["flow"]["start"] == stored["flow"]["start"], "der Start bleibt, wie er war"
    assert await flow.db.audit_logs.count_documents({"action": "match.checkin.start"}) == 1


@pytest.mark.asyncio
async def test_the_lead_enters_results_without_check_in_and_other_seasons_stay_as_before(flow):
    world = await checkin_world(flow)
    flow.act_as(world["lead"])
    entered = await flow.post(f"/api/matches/{mid(world)}/result", json={"results": [
        {"registration_id": world["reg_a"]["id"], "rank": 1, "score": 2}, {"registration_id": world["reg_h"]["id"], "rank": 2, "score": 0}]})
    assert entered.status_code == 200, entered.text
    other = await checkin_world(flow, rules=None, letter="B")
    reported = await report(flow, other, "Kapitaen", "reg_a", "Kapitaen", "Mila")
    assert reported.status_code == 200, reported.text
    assert (await page(flow, other, "Kapitaen")).get("report_hint") is None
    assert not (await flow.reload(other["match"])).get("started_at"), "ohne Check-in setzt die Meldung keinen Start"


@pytest.mark.asyncio
async def test_a_report_waits_for_the_consent_like_the_start(flow):
    """Zwischen Check-in und Meldung kommt eine neue Regelfassung: ohne Zustimmung beider Seiten keine Meldung - wie beim Start."""
    world = await checkin_world(flow)
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")).status_code == 200
    assert (await checkin(flow, world, "Falke1", "Falke1", "Falke2")).status_code == 200
    await with_rules(flow, world)
    blocked = await report(flow, world, "Kapitaen", "reg_a", "Kapitaen", "Mila")
    assert blocked.status_code == 409 and "Regelwerk" in blocked.json()["detail"], blocked.text
    assert "Regelwerk" in (await page(flow, world, "Kapitaen"))["report_hint"]
    await consent(flow, world, "squad_a")
    await consent(flow, world, "horst")
    assert (await report(flow, world, "Kapitaen", "reg_a", "Kapitaen", "Mila")).status_code == 200


@pytest.mark.asyncio
async def test_reporting_edge_cases_around_the_check_in(flow):
    """Codex-Nachprüfung zu D.2: vergangener Termin ohne Check-in, Altmeldung mit Gegenbestätigung, 48-h-Automatik nach dem Start durch
    die Meldung, schon gestartetes Spiel - und genau ein ``match.checkin.start`` bei der ersten gültigen Meldung."""
    started_audits = {"action": "match.checkin.start"}
    # Vergangener Termin, niemand eingecheckt: keine Meldung - der Satz nennt beide Seiten, die Seite zeigt ihn statt des Formulars.
    past = await checkin_world(flow, minutes=-60)
    refused = await report(flow, past, "Kapitaen", "reg_a", "Kapitaen", "Mila")
    assert refused.status_code == 409 and "haben noch nicht eingecheckt" in refused.json()["detail"], refused.text
    assert "haben noch nicht eingecheckt" in (await page(flow, past, "Kapitaen"))["report_hint"]
    assert not (await flow.reload(past["match"])).get("reports")
    # Altmeldung: die Meldung kam, bevor die Season den Check-in bekam - die Gegenseite bestätigt ohne Check-in, kein Start.
    old = await checkin_world(flow, rules=None, letter="B")
    assert (await report(flow, old, "Kapitaen", "reg_a", "Kapitaen", "Mila")).status_code == 200
    await flow.db.tournaments.update_one({"id": old["tournament"]["id"]}, {"$set": {"checkin_rules": dict(RULES)}})
    assert (await page(flow, old, "Falke1"))["report_hint"] is None, "die Bestätigung bleibt frei"
    confirmed = await report(flow, old, "Falke1", "reg_h", "Falke1", "Falke2")
    assert confirmed.status_code == 200, confirmed.text
    stored = await flow.reload(old["match"])
    assert stored["status"] == "completed" and not stored.get("started_at") and "start" not in (stored.get("flow") or {})
    assert await flow.db.audit_logs.count_documents(started_audits) == 0
    # 48-h-Automatik: der Start kam durch die Meldung, die Gegenseite schweigt - nach 48 Stunden gilt die Meldung trotzdem.
    silent = await checkin_world(flow, letter="C")
    assert (await checkin(flow, silent, "Kapitaen", "Kapitaen", "Mila")).status_code == 200
    assert (await checkin(flow, silent, "Falke1", "Falke1", "Falke2")).status_code == 200
    assert (await report(flow, silent, "Kapitaen", "reg_a", "Kapitaen", "Mila")).status_code == 200
    running = await flow.reload(silent["match"])
    assert running["status"] == "in_progress" and running["flow"]["start"]["via"] == "report"
    assert (await sweep(flow, silent, 47 * 60))["confirmed"] == 0
    assert (await sweep(flow, silent, 49 * 60))["confirmed"] == 1
    done = await flow.reload(silent["match"])
    assert done["status"] == "completed" and done["result_meta"]["auto_confirmed"] is True
    assert await flow.db.audit_logs.count_documents({**started_audits, "data.match_id": mid(silent)}) == 1
    # Schon gestartet (Klick auf „Spiel starten“): melden geht, der Start bleibt der eine vom Klick.
    started = await checkin_world(flow, letter="D")
    assert (await checkin(flow, started, "Kapitaen", "Kapitaen", "Mila")).status_code == 200
    assert (await checkin(flow, started, "Falke1", "Falke1", "Falke2")).status_code == 200
    assert (await start(flow, started, "Kapitaen")).status_code == 200
    assert (await page(flow, started, "Kapitaen"))["report_hint"] is None
    assert (await report(flow, started, "Kapitaen", "reg_a", "Kapitaen", "Mila")).status_code == 200
    assert (await flow.reload(started["match"]))["flow"]["start"]["via"] == "side"
    assert await flow.db.audit_logs.count_documents({**started_audits, "data.match_id": mid(started)}) == 1
    # Genau ein Start bei der ersten gültigen Meldung: eine abgelehnte Meldung setzt nichts, die Bestätigung nichts Neues.
    once = await checkin_world(flow, letter="E")
    assert (await checkin(flow, once, "Kapitaen", "Kapitaen", "Mila")).status_code == 200
    assert (await checkin(flow, once, "Falke1", "Falke1", "Falke2")).status_code == 200
    invalid = await report(flow, once, "Kapitaen", "reg_a")
    assert invalid.status_code == 422, invalid.text
    assert not (await flow.reload(once["match"])).get("started_at"), "eine abgelehnte Meldung startet nichts"
    assert (await report(flow, once, "Kapitaen", "reg_a", "Kapitaen", "Mila")).status_code == 200
    assert (await report(flow, once, "Falke1", "reg_h", "Falke1", "Falke2")).status_code == 200
    assert (await flow.reload(once["match"]))["status"] == "completed"
    assert await flow.db.audit_logs.count_documents({**started_audits, "data.match_id": mid(once)}) == 1


# ---------------------------------------------------------------- Nach dem Fenster: Vorschlag, nie eine Wertung

@pytest.mark.asyncio
async def test_after_the_window_the_job_proposes_and_the_lead_decides(flow):
    world = await checkin_world(flow)
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")).status_code == 200
    assert (await sweep(flow, world, 14))["proposed"] == 0, "das Fenster ist noch offen"
    # Das Fenster ist seit einer Minute zu - für Job und Seite gleichermaßen.
    await shift(flow, world, -16)
    first = await sweep(flow, world, 0)
    assert first["proposed"] == 1
    stored = await flow.reload(world["match"])
    proposal = stored["no_show_proposal"]
    assert proposal["rule"] == "check_in" and proposal["missing_registration_ids"] == [world["reg_h"]["id"]]
    assert stored["status"] == "scheduled" and not stored.get("forfeit_registration_id"), "nie eine Wertung von selbst"
    assert (await sweep(flow, world, 17))["proposed"] == 0, "genau ein Vorschlag"
    notes = await flow.db.notifications.find({"meta.reason": "no_show"}, {"_id": 0}).to_list(10)
    assert world["lead"]["id"] in {row["user_id"] for row in notes}
    assert "Horst" in notes[0]["body"] and "nicht eingecheckt" in notes[0]["body"] and "/leitung?fall=ns-" in notes[0]["url"]
    assert await flow.db.audit_logs.count_documents({"action": "match.no_show.proposed"}) == 1

    flow.act_as(world["lead"])
    duty = (await flow.get("/api/users/me/duty")).json()
    assert [row["match_id"] for row in duty["checkin_proposals"]] == [mid(world)]
    assert duty["checkin_proposals"][0]["missing"] == ["Falken · Horst"] and duty["checkin_proposals"][0]["lead_url"].endswith(f"?fall=ns-{mid(world)}")
    lead_block = (await page(flow, world, world["lead"]))["checkin"]
    assert lead_block["state"] == "closed" and lead_block["proposal"]["missing"] == ["Falken · Horst"]
    attention = (await flow.get(f"/api/tournaments/{world['tournament']['id']}/lead")).json()["attention"]
    card = next(row for row in attention if row["kind"] == "no_show")
    assert [side["registration_id"] for side in card["participants"]] == [world["reg_h"]["id"]] and "Check-in bis" in card["detail"]

    decided = await flow.post(f"/api/tournaments/{world['tournament']['id']}/lead/no-show/{mid(world)}",
                              json={"action": "confirm", "registration_id": world["reg_h"]["id"]})
    assert decided.status_code == 200, decided.text
    stored = await flow.reload(world["match"])
    assert stored["status"] == "forfeit" and stored["forfeit_registration_id"] == world["reg_h"]["id"]
    assert "Check-in bis" in str(stored.get("result_meta") or stored.get("admin_note") or stored)
    assert stored["no_show_proposal"]["decision"] == "confirmed"


@pytest.mark.asyncio
async def test_the_lead_enters_the_missing_side_and_the_proposal_goes_away(flow):
    world = await checkin_world(flow)
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")).status_code == 200
    await sweep(flow, world, 16)
    assert (await flow.reload(world["match"]))["no_show_proposal"]
    flow.act_as(world["lead"])
    entered = await flow.post(f"/api/matches/{mid(world)}/checkin", json={"present": ids(world, "Falke1", "Falke2"),
                                                                         "registration_id": world["reg_h"]["id"], "reason": "per Discord bestätigt"})
    assert entered.status_code == 200, entered.text
    assert (await page(flow, world, world["lead"]))["checkin"]["state"] == "ready"
    await sweep(flow, world, 20)
    stored = await flow.reload(world["match"])
    assert stored.get("no_show_proposal") is None
    cleared = await flow.db.audit_logs.find_one({"action": "match.no_show.cleared"}, {"_id": 0})
    assert cleared["data"]["reason"] == "checked_in"
    assert (await page(flow, world, world["lead"]))["checkin"]["proposal"] is None


@pytest.mark.asyncio
async def test_the_lead_extends_the_window_and_the_side_can_still_check_in(flow):
    world = await checkin_world(flow, minutes=-20)
    assert (await checkin(flow, world, "Falke1", "Falke1", "Falke2")).status_code == 409, "schon zu"
    await sweep(flow, world, 0)
    assert (await flow.reload(world["match"]))["no_show_proposal"]["rule"] == "check_in"
    flow.act_as(world["lead"])
    extended = await flow.post(f"/api/tournaments/{world['tournament']['id']}/lead/no-show/{mid(world)}", json={"action": "extend", "minutes": 30})
    assert extended.status_code == 200, extended.text
    assert (await flow.reload(world["match"])).get("no_show_proposal") is None
    block = (await page(flow, world, "Falke1"))["checkin"]
    assert block["state"] == "open" and block["window"]["closes_at"] == extended.json()["extended_until"]
    assert (await checkin(flow, world, "Falke1", "Falke1", "Falke2")).status_code == 200
    assert (await sweep(flow, world, 40))["proposed"] == 1, "nach der Verlängerung fehlt die andere Seite weiter"
    assert (await flow.reload(world["match"]))["no_show_proposal"]["missing_registration_ids"] == [world["reg_a"]["id"]]


async def decide(flow, world, **body):
    flow.act_as(world["lead"])
    return await flow.post(f"/api/tournaments/{world['tournament']['id']}/lead/no-show/{mid(world)}", json=body)


@pytest.mark.asyncio
async def test_with_check_in_the_lead_scores_a_no_show_only_after_the_window_and_only_with_a_proposal(flow):
    """Codex zu D.2 (1): In einer Staffel mit Check-in wertet die Leitung nicht vor Fensterende und nicht ohne aktuellen, abgelaufenen
    Vorschlag - die Ausnahme „ohne Vorschlag werten“ gilt nur für Staffeln ohne Check-in (#2201)."""
    world = await checkin_world(flow)
    early = await decide(flow, world, action="confirm", registration_id=world["reg_h"]["id"])
    assert early.status_code == 409, early.text
    assert (await flow.reload(world["match"]))["status"] == "scheduled", "nichts gewertet"
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")).status_code == 200
    await shift(flow, world, -16)
    still = await decide(flow, world, action="confirm", registration_id=world["reg_h"]["id"])
    assert still.status_code == 409, "Fenster zu, aber noch kein Vorschlag des Jobs"
    assert (await sweep(flow, world, 0))["proposed"] == 1
    scored = await decide(flow, world, action="confirm", registration_id=world["reg_h"]["id"])
    assert scored.status_code == 200, scored.text
    assert (await flow.reload(world["match"]))["forfeit_registration_id"] == world["reg_h"]["id"]
    # Ohne Check-in bleibt es wie seit #2201: Die Leitung wertet auch ohne Vorschlag.
    other = await checkin_world(flow, rules=None, letter="B")
    without = await decide(flow, other, action="confirm", registration_id=other["reg_h"]["id"])
    assert without.status_code == 200, without.text


@pytest.mark.asyncio
async def test_the_proposal_binds_the_decision_to_the_missing_side_and_the_current_window(flow):
    """Codex zu D.2 (2): Gewertet wird nur die Seite, die nicht eingecheckt hat; nach einem neuen Termin gilt der alte Vorschlag nicht."""
    world = await checkin_world(flow)
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")).status_code == 200
    await shift(flow, world, -16)
    assert (await sweep(flow, world, 0))["proposed"] == 1
    wrong = await decide(flow, world, action="confirm", registration_id=world["reg_a"]["id"])
    assert wrong.status_code == 422, wrong.text
    assert "eingecheckt" in wrong.json()["detail"]
    assert (await flow.reload(world["match"]))["status"] == "scheduled"
    flow.act_as(world["lead"])
    moved = await flow.patch(f"/api/matches/{mid(world)}", json={"scheduled_at": at(60), "schedule_reason": "Nachholtermin"})
    assert moved.status_code == 200, moved.text
    assert (await flow.reload(world["match"]))["no_show_proposal"], "der alte Vorschlag steht noch, bis der Job läuft"
    stale = await decide(flow, world, action="confirm", registration_id=world["reg_h"]["id"])
    assert stale.status_code == 409, stale.text
    assert (await flow.reload(world["match"]))["status"] == "scheduled"
    # Auch „verlängern“ prüft den Vorschlag: Aus einem alten Vorschlag entsteht keine Verlängerung für den neuen Termin.
    no_extension = await decide(flow, world, action="extend", minutes=10)
    assert no_extension.status_code == 409, no_extension.text
    assert not (await flow.reload(world["match"])).get("no_show_extended_until"), "keine Verlängerung aus einem alten Vorschlag"


WEEK = {"schedule_rules": dict(league_schedule.DEFAULTS), "matchday_days": 7}


@pytest.mark.asyncio
async def test_every_new_time_drops_the_extension_of_the_old_window(flow):
    """Codex zu D.2 (3): Eine Verlängerung der Leitung gehört zum alten Fenster. Jeder neue Termin - Einigung, Verschiebung, Leitung,
    „Neu ansetzen“, 72-h-Regel - lässt sie fallen; sonst bliebe das neue Fenster bis zur alten Verlängerung offen."""
    world = await checkin_world(flow, start_date=(now_utc() - timedelta(days=1)).isoformat(), **WEEK)
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")).status_code == 200
    await shift(flow, world, -16)
    assert (await sweep(flow, world, 0))["proposed"] == 1
    extended = await decide(flow, world, action="extend", minutes=30)
    assert extended.status_code == 200, extended.text
    assert (await flow.reload(world["match"])).get("no_show_extended_until")

    async def extension_gone(step: str) -> None:
        stored = await flow.reload(world["match"])
        assert not stored.get("no_show_extended_until"), step
        window = match_flow.window_of(stored, RULES)
        assert window and window[1] == match_flow._moment(stored["scheduled_at"]) + timedelta(minutes=15), step

    async def extend_by_hand() -> None:
        await flow.db.matches_v2.update_one({"id": mid(world)}, {"$set": {"no_show_extended_until": at(6 * 60)}})

    # Einigung: Heimseite schlägt vor, Gastseite nimmt an.
    flow.act_as(world["users"]["Kapitaen"])
    offer = await flow.post(f"/api/matches/{mid(world)}/schedule-proposals", json={"scheduled_at": at(48 * 60)})
    assert offer.status_code == 200, offer.text
    flow.act_as(world["users"]["Falke1"])
    agreed = await flow.post(f"/api/matches/{mid(world)}/schedule-proposals/{offer.json()['id']}/decision", json={"action": "accept"})
    assert agreed.status_code == 200, agreed.text
    await extension_gone("Einigung")
    # Verschiebung: Antrag der einen, Zustimmung der anderen Seite.
    await extend_by_hand()
    flow.act_as(world["users"]["Kapitaen"])
    asked = await flow.post(f"/api/matches/{mid(world)}/reschedule", json={"scheduled_at": at(72 * 60), "reason": "Spieler im Nachtdienst"})
    assert asked.status_code == 200, asked.text
    flow.act_as(world["users"]["Falke1"])
    moved = await flow.post(f"/api/matches/{mid(world)}/reschedule/{asked.json()['id']}/decision", json={"action": "accept"})
    assert moved.status_code == 200, moved.text
    await extension_gone("Verschiebung")
    # Leitung setzt den Termin.
    await extend_by_hand()
    flow.act_as(world["lead"])
    set_by_lead = await flow.patch(f"/api/matches/{mid(world)}", json={"scheduled_at": at(96 * 60), "schedule_reason": "Nachholtermin"})
    assert set_by_lead.status_code == 200, set_by_lead.text
    await extension_gone("Leitung")
    # „Neu ansetzen“ (E.1): beide nicht erschienen, dann zurück in den offenen Stand.
    url = f"/api/admin/leagues/staffeln/{world['tournament']['id']}/matches/{mid(world)}/double-no-show"
    scored = await flow.post(url, json={"note": "Beide Teams nicht in der Lobby"})
    assert scored.status_code == 200, scored.text
    await extend_by_hand()
    undone = await flow.client.request("DELETE", url, json={"reason": "Neuer Termin vereinbart"})
    assert undone.status_code == 200, undone.text
    await extension_gone("Neu ansetzen")
    # 72-h-Regel: ohne festen Termin gilt der Vorschlag der Heimseite nach 72 Stunden ohne Antwort.
    other = await checkin_world(flow, start_date=(now_utc() - timedelta(days=1)).isoformat(), letter="B", **WEEK)
    await flow.db.matches_v2.update_one({"id": mid(other)}, {"$set": {"scheduled_at": None, "status": "ready", "no_show_extended_until": at(90)}})
    flow.act_as(other["users"]["Kapitaen"])
    assert (await flow.post(f"/api/matches/{mid(other)}/schedule-proposals", json={"scheduled_at": at(100 * 60)})).status_code == 200
    counts = await league_schedule_sweep.sweep(flow.db, [await tournament_of(flow, other)], now=now_utc() + timedelta(hours=73))
    assert counts["home_rule"] == 1
    assert not (await flow.reload(other["match"])).get("no_show_extended_until"), "72-h-Regel"
    # Spieltag-Plan (Standardtermin) und Stationsplan schreiben den Termin ebenfalls (Codex-Nachprüfung).
    from services.match_scheduler import apply_plan
    from services.matchday_schedule import persist_matchday_schedule

    third = await checkin_world(flow, start_date=(now_utc() - timedelta(days=1)).isoformat(), letter="C", **WEEK)
    await flow.db.matches_v2.update_one({"id": mid(third)}, {"$set": {"no_show_extended_until": at(90)}})
    written = await persist_matchday_schedule(flow.db, await tournament_of(flow, third))
    stored = await flow.reload(third["match"])
    assert written["written"] == 1 and stored["schedule_source"] == "default", "der Standardtermin steht"
    assert not stored.get("no_show_extended_until"), "Spieltag-Plan"
    await flow.db.matches_v2.update_one({"id": mid(third)}, {"$set": {"no_show_extended_until": at(90), "schedule_source": None}})
    stored = await flow.reload(third["match"])
    plan = {"assignments": [{"match_id": mid(third), "changed": True, "scheduled_at": at(3 * 60), "schedule_source": "planner",
                             "station_id": None, "forecast": False,
                             "previous": {"scheduled_at": stored["scheduled_at"], "schedule_source": None, "status": stored["status"],
                                          "station_id": None}}]}
    assert (await apply_plan(flow.db, await tournament_of(flow, third), plan))["written"] == 1
    assert not (await flow.reload(third["match"])).get("no_show_extended_until"), "Stationsplan"


@pytest.mark.asyncio
async def test_without_check_in_rules_a_new_time_keeps_the_extension(flow):
    """Die Verlängerung fällt nur in Staffeln mit Check-in-Regeln: in einer Staffel ohne Regeln und in einem anderen Format bleibt
    ``no_show_extended_until`` bei jedem neuen Termin stehen - Spieltag-Plan, Einigung und Termin der Leitung."""
    from services.matchday_schedule import persist_matchday_schedule

    start_date = (now_utc() - timedelta(days=1)).isoformat()
    plain = await checkin_world(flow, rules=None, start_date=start_date, **WEEK)
    other = await checkin_world(flow, rules=None, letter="B", start_date=start_date, **WEEK)
    await flow.db.tournaments.update_one({"id": other["tournament"]["id"]}, {"$unset": {"league_context": ""}})
    kept = at(6 * 60)
    for label, world, lead in (("Staffel ohne Check-in", plain, plain["lead"]), ("kein Ligaformat", other, other["staff"])):
        await flow.db.matches_v2.update_one({"id": mid(world)}, {"$set": {"no_show_extended_until": kept}})
        assert (await persist_matchday_schedule(flow.db, await tournament_of(flow, world)))["written"] == 1, label
        stored = await flow.reload(world["match"])
        assert stored["schedule_source"] == "default" and stored.get("no_show_extended_until") == kept, f"{label}: Spieltag-Plan"
        flow.act_as(world["users"]["Kapitaen"])
        offer = await flow.post(f"/api/matches/{mid(world)}/schedule-proposals", json={"scheduled_at": at(48 * 60)})
        assert offer.status_code == 200, f"{label}: {offer.text}"
        flow.act_as(world["users"]["Falke1"])
        agreed = await flow.post(f"/api/matches/{mid(world)}/schedule-proposals/{offer.json()['id']}/decision", json={"action": "accept"})
        assert agreed.status_code == 200, f"{label}: {agreed.text}"
        assert (await flow.reload(world["match"])).get("no_show_extended_until") == kept, f"{label}: Einigung"
        flow.act_as(lead)
        moved = await flow.patch(f"/api/matches/{mid(world)}", json={"scheduled_at": at(96 * 60), "schedule_reason": "Nachholtermin"})
        assert moved.status_code == 200, f"{label}: {moved.text}"
        assert (await flow.reload(world["match"])).get("no_show_extended_until") == kept, f"{label}: Leitung"


@pytest.mark.asyncio
async def test_a_new_time_from_the_lead_voids_old_checkins_and_the_proposal(flow):
    """E.1 „Neu ansetzen“ und jeder neue Termin der Leitung: alte Check-ins zählen nicht mehr, der alte Vorschlag fällt weg, „beide da“
    gilt für den neuen Termin wieder einmal."""
    world = await checkin_world(flow)
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")).status_code == 200
    await flow.db.matches_v2.update_one({"id": mid(world)}, {"$set": {"scheduled_at": at(-16)}})
    assert (await sweep(flow, world, 0))["proposed"] == 1
    flow.act_as(world["lead"])
    assert "no_show" in {row["kind"] for row in (await flow.get(f"/api/tournaments/{world['tournament']['id']}/lead")).json()["attention"]}
    moved = await flow.patch(f"/api/matches/{mid(world)}", json={"scheduled_at": at(60), "schedule_reason": "Nachholtermin"})
    assert moved.status_code == 200, moved.text
    assert (await flow.reload(world["match"]))["no_show_proposal"], "noch da - aber ohne Wirkung"
    assert "no_show" not in {row["kind"] for row in (await flow.get(f"/api/tournaments/{world['tournament']['id']}/lead")).json()["attention"]}
    block = (await page(flow, world, "Kapitaen"))["checkin"]
    assert block["state"] == "waiting" and block["sides"][0]["checked_in"] is False and block["proposal"] is None
    assert (await sweep(flow, world, 0))["proposed"] == 0
    cleared = await flow.db.audit_logs.find_one({"action": "match.no_show.cleared"}, {"_id": 0})
    assert cleared["data"]["reason"] == "rescheduled" and (await flow.reload(world["match"])).get("no_show_proposal") is None
    # Zum neuen Termin checken beide neu ein - „beide da“ meldet sich wieder.
    await flow.db.matches_v2.update_one({"id": mid(world)}, {"$set": {"scheduled_at": at(0)}})
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Tom")).status_code == 200
    second = await checkin(flow, world, "Falke1", "Falke1", "Falke2")
    assert second.status_code == 200 and second.json()["ready"] is True
    assert await flow.db.notifications.count_documents({"meta.reason": "checkin_ready"}) == 2
    assert (await sweep(flow, world, 30))["proposed"] == 0, "beide da zum neuen Termin"


@pytest.mark.asyncio
async def test_old_proposals_without_check_in_are_still_cleared(flow):
    world = await checkin_world(flow, rules=None)
    await flow.db.matches_v2.update_one({"id": mid(world)}, {"$set": {"scheduled_at": at(-24 * 60), "no_show_proposal": {
        "id": "alt", "rule": "online", "minutes": 15, "registration_ids": [world["reg_a"]["id"], world["reg_h"]["id"]],
        "due_at": at(-60), "created_at": at(-60)}}})
    await sweep(flow, world, 0)
    assert (await flow.reload(world["match"])).get("no_show_proposal") is None
    cleared = await flow.db.audit_logs.find_one({"action": "match.no_show.cleared"}, {"_id": 0})
    assert cleared["data"]["reason"] == "league_without_check_in"
    assert (await page(flow, world, "Kapitaen"))["checkin"] is None, "ohne Regeln kein Block"
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")).status_code == 409


# ---------------------------------------------------------------- Erinnerungen

@pytest.mark.asyncio
async def test_reminders_go_once_per_time_at_opening_and_before_the_end(flow):
    world = await checkin_world(flow)  # Termin jetzt: das Fenster ging vor 15 Minuten auf und schließt in 15
    tournament = await tournament_of(flow, world)
    nothing = await league_checkin_sweep.sweep(flow.db, [tournament], now=now_utc() - timedelta(minutes=16))
    assert nothing == {"open": 0, "closing": 0}, "das Fenster war noch zu"
    opened = await league_checkin_sweep.sweep(flow.db, [tournament], now=now_utc() - timedelta(minutes=14))
    assert opened["open"] == 2 and opened["closing"] == 0
    notes = await flow.db.notifications.find({"meta.reason": "checkin_open"}, {"_id": 0}).to_list(10)
    assert {row["user_id"] for row in notes} == {world["users"]["Kapitaen"]["id"], world["users"]["Falke1"]["id"]}
    assert all(row["kind"] == "match_call" for row in notes) and "Mindestens 2" in notes[0]["body"]
    assert (await league_checkin_sweep.sweep(flow.db, [tournament], now=now_utc() - timedelta(minutes=13)))["open"] == 0, "einmal je Termin"

    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")).status_code == 200
    closing = await league_checkin_sweep.sweep(flow.db, [tournament], now=now_utc() + timedelta(minutes=11))
    assert closing == {"open": 0, "closing": 1}, "nur die Seite ohne Check-in"
    late = await flow.db.notifications.find({"meta.reason": "checkin_closing"}, {"_id": 0}).to_list(10)
    assert [row["user_id"] for row in late] == [world["users"]["Falke1"]["id"]]
    assert (await league_checkin_sweep.sweep(flow.db, [tournament], now=now_utc() + timedelta(minutes=12)))["closing"] == 0

    # Ein neuer Termin erinnert neu (die Zeit „vorgespult“, der Check-in gehört weiter dazu).
    await shift(flow, world, 120)
    moved = await league_checkin_sweep.sweep(flow.db, [tournament], now=now_utc() + timedelta(minutes=106))
    assert moved["open"] == 1, "die eingecheckte Seite braucht keine Erinnerung mehr"
    full = await sweep(flow, world, 106)
    assert full["checkin"] == {"open": 0, "closing": 0}, "der Fristen-Job nimmt denselben Lauf mit"


# ---------------------------------------------------------------- Aufgabe, App, andere Formate

@pytest.mark.asyncio
async def test_the_task_on_the_start_page_and_the_app_fields(flow):
    world = await checkin_world(flow)
    flow.act_as(world["users"]["Kapitaen"])
    actions = (await flow.get("/api/mobile/dashboard")).json()["me"]["actions"]
    task = next(row for row in actions if row["type"] == "match_checkin")
    assert task["label"] == "Jetzt einchecken" and task["target_type"] == "match" and task["target_id"] == mid(world)
    assert "bis" in task["detail"] and "im Web" in task["detail"]
    flow.act_as(world["users"]["Tom"])
    assert not [row for row in (await flow.get("/api/mobile/dashboard")).json()["me"]["actions"] if row["type"] == "match_checkin"]
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")).status_code == 200
    flow.act_as(world["users"]["Kapitaen"])
    assert not [row for row in (await flow.get("/api/mobile/dashboard")).json()["me"]["actions"] if row["type"] == "match_checkin"]
    flow.act_as(world["users"]["Falke1"])
    assert [row["type"] for row in (await flow.get("/api/mobile/dashboard")).json()["me"]["actions"] if row["type"] == "match_checkin"] == ["match_checkin"]


@pytest.mark.asyncio
async def test_other_tournaments_keep_their_deadline_rule(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _registrations = await flow.with_participants(2, event_mode="online", status="live")
    match = {"id": new_id(), "tournament_id": tournament["id"], "status": "scheduled", "scheduled_at": at(-30),
             "slots": [{"slot": 1, "registration_id": _registrations[0]["id"]}, {"slot": 2, "registration_id": _registrations[1]["id"]}]}
    await flow.db.matches_v2.insert_one(dict(match))
    from services.match_deadlines import no_show_deadline

    info = no_show_deadline(match, tournament)
    assert info and info["rule"] == "online" and "missing" not in info
    assert match_flow.state(match, tournament) == "none"
    assert (await flow.get(f"/api/matches/{match['id']}/page")).json()["checkin"] is None


# ---------------------------------------------------------------- Datenschutz

@pytest.mark.asyncio
async def test_export_and_erasure(flow):
    from routes import dsgvo_routes
    from services import account_erasure

    world = await checkin_world(flow)
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")).status_code == 200
    flow.act_as(world["lead"])
    await flow.post(f"/api/matches/{mid(world)}/checkin", json={"present": ids(world, "Falke1", "Falke2"), "registration_id": world["reg_h"]["id"],
                                                               "reason": "telefonisch"})
    assert (await start(flow, world, "Kapitaen")).status_code == 200

    captain = (await dsgvo_routes._user_data_export(flow.db, world["users"]["Kapitaen"]["id"]))["league_checkin"]
    roles = {step["role"] for step in captain[0]["steps"]}
    assert roles == {"checked_in", "present", "started"} and captain[0]["match_id"] == mid(world)
    mila = (await dsgvo_routes._user_data_export(flow.db, world["users"]["Mila"]["id"]))["league_checkin"]
    assert [step["role"] for step in mila[0]["steps"]] == ["present"]
    lead = (await dsgvo_routes._user_data_export(flow.db, world["lead"]["id"]))["league_checkin"]
    assert lead[0]["steps"] == [{"role": "lead", "at": lead[0]["steps"][0]["at"]}], "als Leitung nur der Vorgang"
    assert "telefonisch" not in str(lead)

    await account_erasure.erase_related(flow.db, world["users"]["Kapitaen"], now_utc().isoformat())
    stored = await flow.reload(world["match"])
    own = stored["flow"]["checkin"][world["reg_a"]["id"]]
    assert own["user_id"] is None and stored["flow"]["start"]["by"] is None
    assert world["users"]["Kapitaen"]["id"] in own["present"], "die Anwesenheit bleibt wie eine Aufstellung"
    assert stored["flow"]["checkin"][world["reg_h"]["id"]]["by"] == world["lead"]["id"]


# ---------------------------------------------------------------- Einstellung je Season

@pytest.mark.asyncio
async def test_checkin_rules_per_season_write_through_to_the_staffeln(flow):
    world = await checkin_world(flow, rules=None)
    now = now_utc().isoformat()
    await flow.db.leagues.insert_one({"id": "liga", "name": "Probeliga", "slug": "probeliga", "status": "active", "created_at": now})
    await flow.db.league_seasons.insert_one({"id": world["season_id"], "league_id": "liga", "name": "Season 1", "slug": "season-1",
                                             "status": "active", "visibility": "public", "number": 1, "team_size": 4, "created_at": now})
    url = f"/api/admin/leagues/seasons/{world['season_id']}/checkin-rules"
    flow.act_as(world["users"]["Kapitaen"])
    assert (await flow.get(url)).status_code == 403
    flow.act_as(world["staff"])
    before = (await flow.get(url)).json()
    assert before["active"] is False and before["checkin_rules"] is None and before["defaults"]["min_present"] == 3 and before["staffeln"] == 1
    bad = await flow.put(url, json={"min_present": 0})
    assert bad.status_code == 422
    saved = await flow.put(url, json={"min_present": 2, "closes_minutes_after": 10})
    assert saved.status_code == 200, saved.text
    assert saved.json()["checkin_rules"] == {**DEFAULTS, "min_present": 2, "closes_minutes_after": 10} and saved.json()["staffeln_updated"] == 1
    assert (await tournament_of(flow, world))["checkin_rules"]["closes_minutes_after"] == 10
    audit = await flow.db.audit_logs.find_one({"action": "league.season.checkin_rules"}, {"_id": 0})
    assert audit["data"]["from"] is None and audit["data"]["to"]["min_present"] == 2
    assert (await flow.put(url, json={"min_present": 2, "closes_minutes_after": 10})).json()["staffeln_updated"] == 0
    assert (await flow.get(url)).json()["active"] is True
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")).status_code == 200, "die Staffel hat jetzt einen Check-in"
