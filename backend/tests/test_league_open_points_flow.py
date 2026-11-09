"""Fehlende Angaben sperren erst beim Spielen (docs/LIGA.md B.3, B.4, D.2, #2313) über die echten Routen: Anmeldung mit fehlenden
Angaben geht durch, die Leitung lässt zu, der Check-in lehnt die Person ab, nach dem Nachtragen geht er. Dazu die Erinnerungen beim
Einreichen und vor dem ersten Spiel, je nur einmal. Erfundene Namen."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_application_world import application_world, base_url, decide, inbox_url, submit, submitted  # noqa: E402
from league_match_world import duel  # noqa: E402
from league_start_world import ok  # noqa: E402
from models import now_utc  # noqa: E402
from services import league_open_points, match_flow  # noqa: E402

ID_FIELD = {"key": "probe_id", "label": "Probe-ID", "required": True}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def ready_world(flow, *, min_age: int = 18, **season) -> dict:
    """Zwei Teams, alle mit Geburtsdatum und Spiel-ID - nur, was ein Test wegnimmt, fehlt."""
    w = await application_world(flow, teams=2, min_age=min_age, **{"min_squad_size": 3, "team_size": 3, **season})
    await flow.db.games.update_one({"id": w["game"]["id"]}, {"$set": {"player_id_fields": [ID_FIELD]}})
    for side in w["teams"]:
        for user in side["people"]:
            await flow.db.users.update_one({"id": user["id"]}, {"$set": {"birth_date": "1990-01-01",
                                                                         f"game_ids.{w['game']['slug']}.probe_id": f"Probe#{user['id'][:6]}"}})
    return w


async def without_birth_date(flow, user: dict) -> None:
    await flow.db.users.update_one({"id": user["id"]}, {"$unset": {"birth_date": ""}})


async def row_of(flow, w: dict, side: dict) -> dict:
    flow.act_as(side["captain"])
    view = ok(await flow.get(f"{base_url(w)}/application"))
    return next(row for row in view["squads"] if row["squad_id"] == side["squad"]["id"])


async def open_point_notes(flow) -> list[dict]:
    return await flow.db.notifications.find({"meta.reason": "league_open_points"}, {"_id": 0}).to_list(50)


async def accepted_registration(flow, w: dict, side: dict) -> dict:
    application = await submitted(flow, w, side)
    ok(await decide(flow, w, application, "accept", tournament_id=w["tid"]))
    return await flow.db.tournament_registrations.find_one({"application_id": application["id"]}, {"_id": 0})


# ---------------------------------------------------------------- Anmeldung: nur Hinweis


@pytest.mark.asyncio
async def test_a_missing_birth_date_is_a_hint_and_the_registration_goes_through(flow):
    w = await ready_world(flow)
    side = w["teams"][0]
    await without_birth_date(flow, side["member"])

    row = await row_of(flow, w, side)

    assert row["problems"] == [] and row["can_submit"] is True, row
    assert any("TeamA S3" in text and "Geburtsdatum fehlt" in text for text in row["warnings"]), row
    assert row["shortfall"] is None
    assert "1990" not in str(row) and "birth_date" not in str(row)
    answer = await submit(flow, w, side)
    assert answer.status_code == 200, answer.text

    status = await row_of(flow, w, side)
    assert status["state"] == "submitted" and status["problems"] == [] and status["can_submit"] is False
    assert any("Geburtsdatum fehlt" in text for text in status["warnings"]), "der Stand auf der Ligaseite nennt die offenen Punkte weiter"


@pytest.mark.asyncio
async def test_too_few_eligible_players_are_a_hint_and_the_registration_goes_through(flow):
    w = await ready_world(flow, min_squad_size=4, team_size=4)
    side = w["teams"][0]
    slug = w["game"]["slug"]
    # Zum Einchecken reichen 3 (Check-in-Regeln der Season, 4 gegen 4), der Mindestkader von 4 zählt dafür nicht (#2322).
    await flow.db.league_seasons.update_one({"id": w["season"]["id"]}, {"$set": {"checkin_rules.min_present": 3}})
    unready = [user for user in side["people"] if user["id"] != side["captain"]["id"]][:2]
    await flow.db.users.update_one({"id": unready[0]["id"]}, {"$unset": {f"game_ids.{slug}.probe_id": ""}})

    row = await row_of(flow, w, side)
    assert row["problems"] == [], row
    assert row["shortfall"] is None, "3 Spielberechtigte reichen zum Einchecken, auch wenn der Mindestkader 4 ist"
    assert any("Probe-ID" in text for text in row["warnings"]), row

    await flow.db.users.update_one({"id": unready[1]["id"]}, {"$unset": {f"game_ids.{slug}.probe_id": ""}})
    row = await row_of(flow, w, side)
    assert row["problems"] == [], row
    assert row["shortfall"].startswith(f"Nur 2 von {len(side['people'])} Spielern sind spielberechtigt, für ein Spiel braucht ein Team mindestens 3.")
    answer = await submit(flow, w, side)
    assert answer.status_code == 200, answer.text


@pytest.mark.asyncio
async def test_too_young_counts_like_missing_and_only_the_captain_hears_it(flow):
    w = await ready_world(flow)
    side = w["teams"][0]
    await flow.db.users.update_one({"id": side["member"]["id"]}, {"$set": {"birth_date": "2015-01-01"}})

    row = await row_of(flow, w, side)
    assert row["problems"] == [] and any("Altersvorgabe" in text for text in row["warnings"]), row
    answer = await submit(flow, w, side)
    assert answer.status_code == 200, answer.text

    notes = await open_point_notes(flow)
    assert {note["user_id"] for note in notes} == {side["captain"]["id"], side["vice"]["id"]}, "nichts zu beheben: keine Nachricht an die Person"
    assert "TeamA S3 (Altersvorgabe nicht erfüllt)" in notes[0]["body"]
    assert "2015" not in str(notes)


@pytest.mark.asyncio
async def test_content_rules_still_block(flow):
    w = await ready_world(flow, entry_policy="members")
    side = w["teams"][0]

    row = await row_of(flow, w, side)

    assert any("nur für Mitglieder" in text for text in row["problems"])
    refused = await submit(flow, w, side)
    assert refused.status_code == 400
    refused = await submit(flow, w, side, accept_rules=False)
    assert refused.status_code in (400, 422) and "zu" in refused.json()["detail"]


# ---------------------------------------------------------------- Erinnerung beim Einreichen


@pytest.mark.asyncio
async def test_submitting_reminds_the_person_and_the_captain_once(flow):
    w = await ready_world(flow)
    side = w["teams"][0]
    await without_birth_date(flow, side["member"])

    await submitted(flow, w, side)

    notes = await open_point_notes(flow)
    by_user = {note["user_id"]: note for note in notes}
    assert set(by_user) == {side["member"]["id"], side["captain"]["id"], side["vice"]["id"]}
    person = by_user[side["member"]["id"]]
    assert person["url"] == "/profile?tab=basic" and "Dein Geburtsdatum fehlt im Profil." in person["body"] and "nicht einchecken" in person["body"]
    assert "Die Person" not in person["body"], "die Person selbst wird direkt angesprochen"
    assert "TeamA S3 (Geburtsdatum fehlt)" in by_user[side["captain"]["id"]]["body"]
    assert person["meta"]["dedupe_key"].endswith(f":submit:player:{side['member']['id']}")
    assert by_user[side["captain"]["id"]]["meta"]["dedupe_key"].endswith(f":submit:team:{side['captain']['id']}")


@pytest.mark.asyncio
async def test_a_captain_with_an_own_open_point_gets_both_messages(flow):
    """Eigene Angabe und Kader-Übersicht haben getrennte Schlüssel - die eine verdrängt die andere nicht."""
    w = await ready_world(flow)
    side = w["teams"][0]
    await without_birth_date(flow, side["member"])
    await without_birth_date(flow, side["captain"])

    await submitted(flow, w, side)

    titles = sorted(note["title"] for note in await open_point_notes(flow) if note["user_id"] == side["captain"]["id"])
    assert titles == ["Angabe für die Liga fehlt", "Offene Punkte im Kader"]


@pytest.mark.asyncio
async def test_a_failing_reminder_never_fails_the_submission(flow, monkeypatch):
    """Der ganze Erinnerungs-Schritt samt Mindestkader und Verantwortlichen steht im ``try`` - der Antrag ist dann schon gespeichert."""
    async def broken(*_args, **_kwargs):
        raise RuntimeError("Probe: Erinnerung nicht möglich")

    w = await ready_world(flow)
    side = w["teams"][0]
    await without_birth_date(flow, side["member"])
    monkeypatch.setattr(league_open_points, "after_submit", broken)

    answer = await submit(flow, w, side)

    assert answer.status_code == 200, answer.text
    assert await flow.db.league_applications.count_documents({"squad_id": side["squad"]["id"]}) == 1


@pytest.mark.asyncio
async def test_a_complete_squad_gets_no_reminder(flow):
    w = await ready_world(flow)

    await submitted(flow, w, w["teams"][0])

    assert await open_point_notes(flow) == []


# ---------------------------------------------------------------- Eingang der Leitung


@pytest.mark.asyncio
async def test_the_inbox_shows_the_open_points_and_the_lead_admits_anyway(flow):
    w = await ready_world(flow)
    side = w["teams"][0]
    await without_birth_date(flow, side["member"])
    application = await submitted(flow, w, side)
    flow.act_as(w["lead"])

    inbox = ok(await flow.get(inbox_url(w)))
    item = next(row for row in inbox["items"] if row["id"] == application["id"])

    assert item["problems"] == [] and any("Geburtsdatum fehlt" in text for text in item["warnings"])
    accepted = ok(await decide(flow, w, application, "accept", tournament_id=w["tid"]))
    assert accepted["status"] == "accepted"
    assert await flow.db.tournament_registrations.count_documents({"application_id": application["id"]}) == 1


# ---------------------------------------------------------------- Ablauf bis zum Check-in


@pytest.mark.asyncio
async def test_missing_entry_registers_is_admitted_blocks_check_in_and_then_checks_in(flow):
    w = await ready_world(flow)
    home, away = w["teams"]
    await without_birth_date(flow, home["member"])
    reg_home = await accepted_registration(flow, w, home)
    reg_away = await accepted_registration(flow, w, away)
    tournament = await flow.db.tournaments.find_one({"id": w["tid"]}, {"_id": 0})
    await flow.db.tournaments.update_one({"id": w["tid"]}, {"$set": {"status": "live", "checkin_rules": {**match_flow.DEFAULTS, "min_present": 4}}})
    match = await duel(flow, tournament, reg_home, reg_away)
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"scheduled_at": now_utc().replace(microsecond=0).isoformat()}})
    everyone = [user["id"] for user in home["people"]]

    flow.act_as(home["member"])
    mine = ok(await flow.get(f"/api/matches/{match['id']}/page"))["checkin"]
    assert mine["me"] == {"reason": "Dein Geburtsdatum fehlt im Profil.", "state": "age_missing", "fix_url": "/profile?tab=basic"}
    flow.act_as(home["captain"])
    block = ok(await flow.get(f"/api/matches/{match['id']}/page"))["checkin"]
    assert block["eligible_count"] == 3 and block["can_checkin"] is False
    assert block["roster_hint"].startswith("Nur 3 Spieler dürfen aus eurem Kader gerade spielen, mindestens 4")
    blocked = next(row for row in block["roster"] if row["id"] == home["member"]["id"])
    assert "Geburtsdatum fehlt" in blocked["blocked"]
    refused = await flow.post(f"/api/matches/{match['id']}/checkin", json={"present": everyone})
    assert refused.status_code == 422 and "TeamA S3 kann nicht eingetragen werden" in refused.json()["detail"]

    await flow.db.users.update_one({"id": home["member"]["id"]}, {"$set": {"birth_date": "1990-01-01"}})

    block = ok(await flow.get(f"/api/matches/{match['id']}/page"))["checkin"]
    assert block["can_checkin"] is True and block["roster_hint"] is None and block["eligible_count"] == 4
    checked = await flow.post(f"/api/matches/{match['id']}/checkin", json={"present": everyone})
    assert checked.status_code == 200, checked.text
    flow.act_as(home["member"])
    assert ok(await flow.get(f"/api/matches/{match['id']}/page"))["checkin"]["me"] is None


# ---------------------------------------------------------------- Erinnerung vor dem ersten Spiel


async def first_match_world(flow, *, hours: float) -> tuple[dict, dict, dict]:
    w = await ready_world(flow)
    home, away = w["teams"]
    reg_home = await accepted_registration(flow, w, home)
    reg_away = await accepted_registration(flow, w, away)
    await without_birth_date(flow, home["member"])
    tournament = await flow.db.tournaments.find_one({"id": w["tid"]}, {"_id": 0})
    match = await duel(flow, tournament, reg_home, reg_away)
    when = (now_utc() + timedelta(hours=hours)).replace(microsecond=0).isoformat()
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"scheduled_at": when}})
    await flow.db.notifications.delete_many({})
    return w, match, reg_home


@pytest.mark.asyncio
async def test_before_the_first_match_the_job_reminds_once_even_when_it_runs_twice(flow):
    w, match, reg_home = await first_match_world(flow, hours=30)
    home = w["teams"][0]

    first = await league_open_points.remind_before_first_match(flow.db)
    second = await league_open_points.remind_before_first_match(flow.db)

    notes = await open_point_notes(flow)
    assert first == 3 and second == 0
    assert {note["user_id"] for note in notes} == {home["member"]["id"], home["captain"]["id"], home["vice"]["id"]}
    assert sorted(note["meta"]["dedupe_key"] for note in notes) == sorted([
        f"league-open-points:{reg_home['id']}:first-match:player:{home['member']['id']}",
        f"league-open-points:{reg_home['id']}:first-match:team:{home['captain']['id']}",
        f"league-open-points:{reg_home['id']}:first-match:team:{home['vice']['id']}"])
    captain = next(note for note in notes if note["user_id"] == home["captain"]["id"])
    assert captain["url"] == f"/matches/{match['id']}"


@pytest.mark.asyncio
async def test_the_job_waits_until_the_lead_time_and_follows_the_setting(flow):
    w, match, _reg = await first_match_world(flow, hours=60)

    too_early = await league_open_points.remind_before_first_match(flow.db)
    assert too_early == 0
    await flow.db.tournaments.update_one({"id": w["tid"]}, {"$set": {"checkin_rules": {**match_flow.DEFAULTS, "open_points_remind_hours": 72}}})
    longer = await league_open_points.remind_before_first_match(flow.db)
    assert longer == 3
    await flow.db.notifications.delete_many({})
    await flow.db.tournaments.update_one({"id": w["tid"]}, {"$set": {"checkin_rules": {**match_flow.DEFAULTS, "open_points_remind_hours": 0}}})
    off = await league_open_points.remind_before_first_match(flow.db)
    assert off == 0


@pytest.mark.asyncio
async def test_after_a_played_match_the_job_stays_quiet(flow):
    w, match, reg_home = await first_match_world(flow, hours=30)
    tournament = await flow.db.tournaments.find_one({"id": w["tid"]}, {"_id": 0})
    played = await duel(flow, tournament, reg_home, {"id": "reg-probe-andere"})
    await flow.db.matches_v2.update_one({"id": played["id"]}, {"$set": {"status": "completed"}})

    sent = await league_open_points.remind_before_first_match(flow.db)
    assert sent == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["withdrawn", "disqualified"])
async def test_a_side_that_left_hears_nothing_before_the_first_match(flow, status):
    w, match, reg_home = await first_match_world(flow, hours=30)
    await flow.db.tournament_registrations.update_one({"id": reg_home["id"]}, {"$set": {"status": status}})

    sent = await league_open_points.remind_before_first_match(flow.db)

    assert sent == 0
    assert await open_point_notes(flow) == []
