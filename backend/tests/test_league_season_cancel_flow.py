"""Season absagen (#2607, Entscheidung Nr. 302; docs/LIGA.md „Season absagen“) - über die echten Routen.

Ein Knopf mit Pflichtgrund: Anmeldung zu, alle offenen Anträge abgelehnt, jede Staffel abgesagt, je Teamleitung bzw. Person genau eine
Nachricht, Season ``cancelled`` - sichtbar mit Grund und Datum. Danach kommt auf keinem Weg mehr etwas in die Season. Team- und Solo-Season,
Rechte, doppelt und gleichzeitig absagen, Startrechte des Vorgängers. Nur erfundene Namen.
"""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_application_world import application_world, base_url, decide, inbox_url, submit, submitted  # noqa: E402
from league_rules_world import ADMIN_LEAGUES  # noqa: E402
from league_solo_world import assign_person, solo_application_world, submit_person, submitted_person  # noqa: E402
from league_start_world import ok  # noqa: E402
from services import league_season_cancel, league_successor  # noqa: E402
from services.league_service import SEASON_CANCELLED, LeagueProblem  # noqa: E402

REASON = "Zu wenige Anmeldungen für einen Spielplan"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def season_url(world: dict) -> str:
    return f"{ADMIN_LEAGUES}/seasons/{world['season']['id']}"


async def cancel(flow, world: dict, *, reason: str = REASON, actor: dict | None = None):
    flow.act_as(actor or world["lead"])
    return await flow.post(f"{season_url(world)}/cancel", json={"reason": reason})


async def notes(flow, user: dict) -> list[dict]:
    return await flow.db.notifications.find({"user_id": user["id"], "meta.reason": "league_season_cancelled"}, {"_id": 0}).to_list(None)


async def holder(flow, league_id: str, capabilities: list[str]) -> dict:
    user = await flow.add_user(name=f"Zuständig {new_id()[:6]}")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": league_id, "user_id": user["id"], "capabilities": capabilities,
                                           "created_at": "2026-11-01T00:00:00+00:00"})
    return user


async def mixed_team_world(flow) -> dict:
    """Vier Co-Teams: A eingereicht, B in Prüfung, C angenommen und zugeteilt, D auf der Warteliste."""
    w = await application_world(flow, teams=4, application_waitlist=True)
    a, b, c, d = [await submitted(flow, w, side) for side in w["teams"]]
    ok(await decide(flow, w, b, "review"))
    ok(await decide(flow, w, c, "accept", tournament_id=w["tid"]))
    ok(await decide(flow, w, d, "waitlist"))
    w["apps"] = [a, b, c, d]
    return w


# ---------------------------------------------------------------- Vorschau und Absagen

@pytest.mark.asyncio
async def test_the_plan_lists_what_the_cancel_does(flow):
    w = await mixed_team_world(flow)
    flow.act_as(w["lead"])

    plan = ok(await flow.get(f"{season_url(w)}/cancel-plan"))

    assert plan["can_cancel"] is True and plan["problems"] == []
    assert plan["applications"] == 4
    assert plan["applications_by_status"] == {"submitted": 1, "in_review": 1, "waitlist": 1, "accepted": 1}
    assert plan["staffeln"] == 1
    # Captain und Vertreter je Co-Team: vier Teams, acht Personen.
    assert plan["teams"] == 4 and plan["people"] == 8
    assert await flow.db.league_seasons.find_one({"id": w["season"]["id"], "status": "cancelled"}) is None, "die Vorschau liest nur"


@pytest.mark.asyncio
async def test_cancel_rejects_every_open_application_cancels_staffeln_and_tells_each_once(flow):
    w = await mixed_team_world(flow)

    answer = ok(await cancel(flow, w))

    assert answer["already"] is False and answer["season"]["status"] == "cancelled"
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})
    assert season["status"] == "cancelled" and season["cancel_reason"] == REASON and season["cancelled_at"]
    assert season["cancelled_by"] == w["lead"]["id"]
    rows = await flow.db.league_applications.find({"season_id": w["season"]["id"]}, {"_id": 0}).to_list(None)
    assert {row["status"] for row in rows} == {"rejected"}
    assert all(row["decision_reason"] == REASON and row["season_cancelled"] is True and "active_key" not in row for row in rows)
    staffel = await flow.db.tournaments.find_one({"id": w["tid"]}, {"_id": 0})
    assert staffel["status"] == "cancelled"
    for side in w["teams"]:
        for person in (side["captain"], side["vice"]):
            got = await notes(flow, person)
            assert len(got) == 1, person["username"]
            assert REASON in got[0]["body"] and side["squad"]["name"] in got[0]["body"]
            assert got[0]["kind"] == "tournament_cancelled"
        # Nur Captain und Vertreter - weder die Hauptteam-Leitung noch der restliche Kader.
        assert await notes(flow, side["lead"]) == [] and await notes(flow, side["member"]) == []
    # Keine zweite Nachricht über den Weg „Turnier abgesagt“ der Staffel.
    assert await flow.db.notifications.count_documents({"meta.dedupe_key": {"$regex": "^tournament_cancelled:"}}) == 0
    audit = await flow.db.audit_logs.find_one({"action": "league.season.cancel"}, {"_id": 0})
    assert audit["actor_id"] == w["lead"]["id"] and audit["data"]["reason"] == REASON
    assert sorted(audit["data"]["applications"]) == sorted(row["id"] for row in w["apps"])
    assert audit["data"]["staffeln"] == [w["tid"]]
    assert await flow.db.audit_logs.count_documents({"action": "league.application.reject", "data.via": "season_cancel"}) == 4


@pytest.mark.asyncio
async def test_cancelling_twice_changes_nothing_and_tells_nobody_again(flow):
    w = await mixed_team_world(flow)
    ok(await cancel(flow, w))
    before = await flow.db.notifications.count_documents({})

    again = ok(await cancel(flow, w, reason="Noch ein anderer Grund"))

    assert again["already"] is True
    assert (await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0}))["cancel_reason"] == REASON
    assert await flow.db.notifications.count_documents({}) == before
    assert await flow.db.audit_logs.count_documents({"action": "league.season.cancel"}) == 1


@pytest.mark.asyncio
async def test_two_leads_cancelling_at_once_give_one_cancel(flow):
    w = await mixed_team_world(flow)
    second = await holder(flow, w["league"]["id"], ["manage"])
    league = await flow.db.leagues.find_one({"id": w["league"]["id"]}, {"_id": 0})
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})

    first, other = await asyncio.gather(league_season_cancel.cancel(flow.db, league, season, REASON, w["lead"]),
                                        league_season_cancel.cancel(flow.db, league, season, "Zweite Leitung sagt ab", second))

    assert sorted([first["already"], other["already"]]) == [False, True]
    assert await flow.db.audit_logs.count_documents({"action": "league.season.cancel"}) == 1
    captain = w["teams"][0]["captain"]
    assert len(await notes(flow, captain)) == 1


@pytest.mark.asyncio
async def test_an_application_during_the_cancel_is_refused_or_rejected(flow):
    """Ein Antrag, der während des Absagens kommt: Entweder ist er vorher da und wird mit abgelehnt, oder er kommt danach und bekommt 409."""
    w = await application_world(flow, teams=2)
    late = w["teams"][1]
    league = await flow.db.leagues.find_one({"id": w["league"]["id"]}, {"_id": 0})
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})

    async def apply():
        return await submit(flow, w, late)

    done, response = await asyncio.gather(league_season_cancel.cancel(flow.db, league, season, REASON, w["lead"]), apply())

    assert done["season"]["status"] == "cancelled"
    if response.status_code == 200:
        stored = await flow.db.league_applications.find_one({"id": response.json()["id"]}, {"_id": 0})
        assert stored["status"] == "rejected"
    else:
        assert response.status_code == 409, response.text
    assert await flow.db.league_applications.count_documents({"season_id": w["season"]["id"], "status": {"$ne": "rejected"}}) == 0


@pytest.mark.asyncio
async def test_the_reason_needs_five_characters(flow):
    w = await application_world(flow, teams=1)

    short = await cancel(flow, w, reason="  zu ")

    assert short.status_code == 422 and short.json()["detail"] == league_season_cancel.REASON_SHORT
    assert (await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0}))["status"] != "cancelled"


@pytest.mark.asyncio
async def test_a_started_staffel_gives_409(flow):
    w = await application_world(flow, teams=2)
    await flow.db.tournaments.update_one({"id": w["tid"]}, {"$set": {"status": "live"}})

    refused = await cancel(flow, w)

    assert refused.status_code == 409 and "läuft schon" in refused.json()["detail"]
    flow.act_as(w["lead"])
    plan = ok(await flow.get(f"{season_url(w)}/cancel-plan"))
    assert plan["can_cancel"] is False and plan["problems"]
    assert (await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0}))["status"] != "cancelled"


@pytest.mark.asyncio
async def test_a_staffel_with_results_gives_409(flow):
    w = await application_world(flow, teams=2)
    await flow.db.matches_v2.insert_one({"id": new_id(), "tournament_id": w["tid"], "status": "completed", "slots": []})

    refused = await cancel(flow, w)

    assert refused.status_code == 409 and "Ergebnisse" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_only_manage_cancels(flow):
    w = await application_world(flow, teams=1)
    season_only = await holder(flow, w["league"]["id"], ["season", "applications", "roster", "matches", "results", "rules"])
    nobody = await flow.add_user(name="Ohne Ligarecht")
    manager = await holder(flow, w["league"]["id"], ["manage"])

    for person in (season_only, nobody):
        flow.act_as(person)
        assert (await flow.get(f"{season_url(w)}/cancel-plan")).status_code == 403
        assert (await cancel(flow, w, actor=person)).status_code == 403
    assert (await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0}))["status"] != "cancelled"
    assert ok(await cancel(flow, w, actor=manager))["season"]["status"] == "cancelled"


# ---------------------------------------------------------------- Danach kommt nichts mehr hinein

@pytest.mark.asyncio
async def test_after_the_cancel_nothing_comes_into_the_season(flow):
    w = await application_world(flow, teams=3)
    first = await submitted(flow, w, w["teams"][0])
    ok(await cancel(flow, w))
    flow.act_as(w["lead"])

    # Antrag eines neuen Co-Teams.
    applied = await submit(flow, w, w["teams"][1])
    assert applied.status_code == 409 and applied.json()["detail"] == "Diese Season ist abgesagt."
    # Entscheiden über den abgelehnten Antrag.
    assert (await decide(flow, w, first, "accept", tournament_id=w["tid"])).status_code == 409
    # Zuteilen an der Staffel vorbei (Sonderweg).
    side = w["teams"][2]
    flow.act_as(w["lead"])
    assigned = await flow.post(f"/api/tournaments/{w['tid']}/squad-registrations", json={"team_id": side["team"]["id"], "squad_id": side["squad"]["id"]})
    assert assigned.status_code == 409, assigned.text
    # Staffel starten oder zurück in den Entwurf.
    for status in ("live", "draft"):
        moved = await flow.post(f"/api/tournaments/{w['tid']}/status", json={"status": status})
        assert moved.status_code == 409, (status, moved.text)
    assert (await flow.db.tournaments.find_one({"id": w["tid"]}, {"_id": 0}))["status"] == "cancelled"
    # Neue Liga N, neue Staffel, Liga N ändern.
    assert (await flow.post(f"{season_url(w)}/divisions", json={})).status_code == 409
    assert (await flow.post(f"{ADMIN_LEAGUES}/divisions/{w['division']['id']}/staffeln", json={})).status_code == 409
    assert (await flow.patch(f"{ADMIN_LEAGUES}/divisions/{w['division']['id']}", json={"nickname": "Neu"})).status_code == 409
    # Stand der Season über die Verwaltung: weder zurück noch archiviert, und „abgesagt“ setzt nur der Knopf.
    for status in ("draft", "active", "archived"):
        patched = await flow.patch(season_url(w), json={"status": status})
        assert patched.status_code == 409, (status, patched.text)
    # Unverändert „abgesagt“ mitschicken (Reiter Überblick) stört nicht.
    assert ok(await flow.patch(season_url(w), json={"status": "cancelled"}))["status"] == "cancelled"
    # Verlängern der Anmeldung, Startrechte einstellen, Los.
    for refused in (await flow.post(f"{season_url(w)}/application-extension", json={"until": "2030-01-01T00:00:00+00:00", "reason": "Noch eine Woche"}),
                    await flow.put(f"{season_url(w)}/start-rights", json={"active": True}),
                    await flow.post(f"{season_url(w)}/draws/{w['division']['id']}", json={})):
        assert refused.status_code == 409 and refused.json()["detail"] == SEASON_CANCELLED, refused.text
    # Neue Season aus der abgesagten: nicht - der Grund steht in der Vorschau.
    preview = ok(await flow.get(f"{season_url(w)}/successor"))
    assert preview["can_create"] is False and league_successor.NO_SUCCESSOR_CANCELLED in preview["problems"]
    assert await flow.db.league_applications.count_documents({"season_id": w["season"]["id"], "status": {"$ne": "rejected"}}) == 0
    assert await flow.db.tournaments.count_documents({"league_context.season_id": w["season"]["id"]}) == 1


@pytest.mark.asyncio
async def test_other_fields_of_a_cancelled_season_stay_editable(flow):
    w = await application_world(flow, teams=1)
    ok(await cancel(flow, w))
    flow.act_as(w["lead"])

    saved = ok(await flow.patch(season_url(w), json={"visibility": "admins"}))

    assert saved["status"] == "cancelled" and saved["visibility"] == "admins"


# ---------------------------------------------------------------- Anzeige

@pytest.mark.asyncio
async def test_the_league_page_shows_cancelled_with_reason_and_date(flow):
    w = await application_world(flow, teams=1)
    ok(await cancel(flow, w))
    flow.act_as(None)

    view = ok(await flow.get(base_url(w)))
    listed = ok(await flow.get("/api/leagues"))

    assert view["season"]["status"] == "cancelled"
    assert view["season"]["cancel_reason"] == REASON and view["season"]["cancelled_at"]
    assert view["application"]["state"] == "closed"
    head = next(season for league in listed["leagues"] for season in league["seasons"] if season["id"] == w["season"]["id"])
    assert head["status"] == "cancelled" and head["cancel_reason"] == REASON and head["cancelled_at"]
    assert "cancelled_by" not in view["season"] and "cancelled_by" not in head


# ---------------------------------------------------------------- Solo

@pytest.mark.asyncio
async def test_a_solo_season_cancels_the_same_way_and_tells_each_player_once(flow):
    w = await solo_application_world(flow, players=3)
    a, b, c = w["players"]
    await submitted_person(flow, w, a)
    second = await submitted_person(flow, w, b)
    ok(await decide(flow, w, second, "accept", tournament_id=w["tid"]))
    flow.act_as(w["lead"])
    ok(await assign_person(flow, {"id": w["tid"]}, c))  # Sonderweg ohne Antrag

    flow.act_as(w["lead"])
    plan = ok(await flow.get(f"{season_url(w)}/cancel-plan"))
    assert plan["kind"] == "solo" and plan["applications"] == 2 and plan["people"] == 3
    ok(await cancel(flow, w))

    for player in (a, b, c):
        got = await notes(flow, player)
        assert len(got) == 1 and "Deine Anmeldung" in got[0]["body"] and REASON in got[0]["body"]
    assert (await flow.db.tournaments.find_one({"id": w["tid"]}, {"_id": 0}))["status"] == "cancelled"
    again = await submit_person(flow, w, a)
    assert again.status_code == 409


# ---------------------------------------------------------------- Gegenprobe

@pytest.mark.asyncio
async def test_without_a_cancel_everything_stays_as_before(flow):
    w = await application_world(flow, teams=2)
    first = await submitted(flow, w, w["teams"][0])
    flow.act_as(w["lead"])

    ok(await flow.get(f"{season_url(w)}/cancel-plan"))
    accepted = ok(await decide(flow, w, first, "accept", tournament_id=w["tid"]))
    view = ok(await flow.get(base_url(w)))

    assert accepted["status"] == "accepted"
    assert view["season"]["status"] == "draft" and view["season"]["cancel_reason"] is None
    assert ok(await flow.get(inbox_url(w)))["items"]


@pytest.mark.asyncio
async def test_problems_reads_only(flow):
    w = await application_world(flow, teams=1)
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})

    assert await league_season_cancel.problems(flow.db, season) == []
    with pytest.raises(LeagueProblem):
        league_season_cancel.clean_reason("abc")


# ---------------------------------------------------------------- Startrechte (#1627): die abgesagte Season verbraucht keine

async def rights_world(flow) -> tuple[dict, dict, dict]:
    """Season 1 mit Startrechten (Zusage), abgeschlossen; Season 2 aus ihr mit den übernommenen Co-Teams."""
    from test_league_start_rights_flow import build as rights_build, ready

    world = await rights_build(flow, levels=2)
    season, rows = await ready(flow, world)
    return world, season, rows


async def cancel_season(flow, world: dict, season: dict):
    flow.act_as(world["lead"])
    return await flow.post(f"{ADMIN_LEAGUES}/seasons/{season['id']}/cancel", json={"reason": REASON})


@pytest.mark.asyncio
async def test_a_cancelled_successor_frees_the_predecessor_for_a_new_season_with_the_same_start_rights(flow):
    from test_league_start_rights_flow import carried, successor

    world, second, rows = await rights_world(flow)
    assert rows and all((row["carry_over"].get("start_right") or {}).get("status") == "offered" for row in rows.values())
    flow.act_as(world["lead"])
    blocked = ok(await flow.get(f"{ADMIN_LEAGUES}/seasons/{world['season']['id']}/successor"))
    assert blocked["can_create"] is False and blocked["successor"]["id"] == second["id"]

    ok(await cancel_season(flow, world, second))

    cancelled = await flow.db.league_seasons.find_one({"id": second["id"]}, {"_id": 0})
    assert "predecessor_id" not in cancelled and cancelled["cancelled_predecessor_id"] == world["season"]["id"]
    assert cancelled["predecessor"]["id"] == world["season"]["id"], "die Anzeige „aus Season 1“ bleibt"
    assert {row["status"] for row in (await carried(flow, second["id"])).values()} == {"rejected"}
    flow.act_as(world["lead"])
    preview = ok(await flow.get(f"{ADMIN_LEAGUES}/seasons/{world['season']['id']}/successor"))
    assert preview["can_create"] is True and preview["successor"] is None
    third = await successor(flow, world)
    again = await carried(flow, third["id"])
    # Dieselben Co-Teams, dieselben Ligen N, neue Startrechte mit neuer Frist: Die abgesagte Season hat keines verbraucht.
    assert set(again) == set(rows)
    assert all(again[key]["carry_over"]["division_level"] == rows[key]["carry_over"]["division_level"] for key in rows)
    assert all(row["status"] == "accepted" and row["carry_over"]["start_right"]["status"] == "offered" for row in again.values())
    assert third["number"] == second["number"] + 1


@pytest.mark.asyncio
async def test_a_start_right_accepted_in_the_cancelled_season_is_offered_again_in_the_next(flow):
    """Zugesagt in Season 2, dann abgesagt: In Season 3 aus Season 1 steht das Startrecht wieder offen - die Zusage galt Season 2
    (Termine, Regeln), nicht der nächsten. Die Nachricht der Absage sagt, dass die Startrechte weiter gelten."""
    from test_league_start_rights_flow import answer, carried, person, successor

    world, second, rows = await rights_world(flow)
    squad, row = next(iter(rows.items()))
    ok(await answer(flow, squad, row["id"]))
    assert (await carried(flow, second["id"]))[squad]["carry_over"]["start_right"]["status"] == "accepted"

    ok(await cancel_season(flow, world, second))
    captain = await person(flow, squad)
    told = await notes(flow, captain)
    assert len(told) == 1 and "Startrechte aus der Vorgänger-Season gelten für die nächste Season weiter" in told[0]["body"]
    third = await successor(flow, world)

    assert (await carried(flow, third["id"]))[squad]["carry_over"]["start_right"]["status"] == "offered"


# ---------------------------------------------------------------- Discord: eine Meldung, nur mit Schalter

@pytest.mark.asyncio
async def test_discord_gets_one_cancel_post_only_when_switched_on(flow, monkeypatch):
    from services import discord_runtime, league_discord

    sent = []

    async def send_embed(channel_id, embed, buttons=None, **kwargs):
        sent.append({"channel_id": channel_id, "embed": embed})
        return {"ok": True, "message_id": "900000000000000001", "channel_id": channel_id}

    monkeypatch.setattr(discord_runtime.bot, "send_embed", send_embed)
    channel = "100000000000000042"
    await flow.db.settings.update_one({"id": "discord"}, {"$set": {"enabled": True, "bot_enabled": True, "channels": {"events": channel}}},
                                      upsert=True)
    w = await application_world(flow, teams=1)
    ok(await cancel(flow, w))

    assert await league_discord.sweep(flow.db) == {"matchday": 0, "season_end": 0}, "ohne Schalter nichts"
    await flow.db.league_seasons.update_one({"id": w["season"]["id"]}, {"$set": {league_discord.FIELD: {
        **league_discord.DEFAULTS, "season_end": True, "channel_id": channel}}})
    assert await league_discord.sweep(flow.db) == {"matchday": 0, "season_end": 1}
    assert await league_discord.sweep(flow.db) == {"matchday": 0, "season_end": 0}, "nie doppelt"

    assert len(sent) == 1 and sent[0]["channel_id"] == channel
    assert sent[0]["embed"]["title"].startswith("Season abgesagt") and REASON in sent[0]["embed"]["description"]


# ---------------------------------------------------------------- Warnung ohne Mindestzahl (Nr. 302)

def closed_window() -> dict:
    from league_application_world import window

    return window(opens_in_hours=-48, closes_in_hours=-1)


@pytest.mark.asyncio
async def test_readiness_warns_once_the_entry_is_closed_and_too_few_are_in(flow):
    w = await application_world(flow, teams=2)
    first = await submitted(flow, w, w["teams"][0])
    ok(await decide(flow, w, first, "accept", tournament_id=w["tid"]))
    flow.act_as(w["lead"])
    readiness = f"{season_url(w)}/readiness"
    assert not [row for row in ok(await flow.get(readiness))["warnings"] if row["code"] == "entries_short"], "Fenster offen: noch nichts"

    await flow.db.league_seasons.update_one({"id": w["season"]["id"]}, {"$set": closed_window()})
    short = [row for row in ok(await flow.get(readiness))["warnings"] if row["code"] == "entries_short"]

    assert len(short) == 1 and "1 angenommen oder zugeteilt" in short[0]["text"] and "mindestens 2" in short[0]["text"]
    second = await flow.db.league_applications.find_one({"squad_id": w["teams"][1]["squad"]["id"]})
    assert second is None
    # Mit zwei Teilnehmern ist nichts zu warnen; der Job meldet nur, solange etwas fehlt.
    assert (await league_season_cancel.shortfall_sweep(flow.db))["told"] >= 1
    assert (await league_season_cancel.shortfall_sweep(flow.db))["told"] == 0, "einmal je Season"
    told = await flow.db.notifications.find({"meta.reason": "league_season_shortfall"}, {"_id": 0}).to_list(None)
    assert {row["user_id"] for row in told} >= {w["lead"]["id"]}
    team_people = {person["id"] for side in w["teams"] for person in side["people"]}
    assert not {row["user_id"] for row in told} & team_people, "kein Text an Teams"
    assert (await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0}))["status"] != "cancelled", "nie automatisch"


@pytest.mark.asyncio
async def test_two_staffeln_need_two_each_and_enough_entries_warn_nothing(flow):
    w = await application_world(flow, teams=4, staffeln=2)
    rows = [await submitted(flow, w, side) for side in w["teams"]]
    for row, tid in zip(rows, [w["tids"][0], w["tids"][0], w["tids"][1]]):
        ok(await decide(flow, w, row, "accept", tournament_id=tid))

    async def shortfall():
        season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})
        return await league_season_cancel.entry_shortfall(flow.db, {**season, **closed_window()})

    short = await shortfall()
    assert len(short) == 1 and short[0]["have"] == 3 and short[0]["needed"] == 4 and "2 je Staffel" in short[0]["text"]
    ok(await decide(flow, w, rows[3], "accept", tournament_id=w["tids"][1]))
    assert await shortfall() == []


# ---------------------------------------------------------------- Korrekturrunde (Prüfung #2607)

@pytest.mark.asyncio
async def test_cancel_during_open_window_shows_the_cancel_not_a_future_end(flow):
    """Abgesagt bei offenem Fenster: Die Ligaseite sagt „abgesagt am …“, nie „vorbei seit <Zukunft>“."""
    from models import now_utc

    w = await application_world(flow, teams=1)  # Fenster offen, schließt in 48 h
    ok(await cancel(flow, w))
    flow.act_as(None)

    block = ok(await flow.get(base_url(w)))["application"]

    assert block["state"] == "closed" and block["cancelled"] is True and block["cancelled_at"]
    assert block["closes_at"] <= now_utc().isoformat(), "das Ende der Anmeldung ist die Absage"


@pytest.mark.asyncio
async def test_the_share_card_says_cancelled(flow):
    from routes.seo_render_routes import league_season_meta

    w = await application_world(flow, teams=1)
    ok(await cancel(flow, w))
    base = {"site_name": "Probe", "image": "/logo.png", "title": "Probe", "description": ""}

    meta = await league_season_meta(flow.db, w["league"]["slug"], w["season"]["slug"], base, "https://example.test")

    assert "Abgesagt" in meta["title"] and "Anmeldung offen" not in meta["title"]
    assert REASON in meta["description"]


@pytest.mark.asyncio
async def test_deleting_a_cancelled_season_or_division_does_not_offer_archiving(flow):
    w = await application_world(flow, teams=1)
    first = await submitted(flow, w, w["teams"][0])
    ok(await decide(flow, w, first, "accept", tournament_id=w["tid"]))
    ok(await cancel(flow, w))
    flow.act_as(w["lead"])

    for url in (season_url(w), f"{ADMIN_LEAGUES}/divisions/{w['division']['id']}"):
        plan = ok(await flow.get(f"{url}/delete-plan"))
        assert plan["deletable"] is False and plan["cancelled"] is True, url
        refused = await flow.client.request("DELETE", url, json={"reason": "Probe löschen"})
        assert refused.status_code == 409 and "Archivieren statt löschen" not in refused.json()["detail"], refused.text
        assert "abgesagt" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_cancel_refuses_when_the_staffeln_changed_meanwhile(flow, monkeypatch):
    """Die Staffeln werden unter der Sperre neu gelesen: Kam inzwischen eine dazu, antwortet das Absagen 409."""
    w = await application_world(flow, teams=1)
    league = await flow.db.leagues.find_one({"id": w["league"]["id"]}, {"_id": 0})
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})
    original = league_season_cancel._staffeln
    calls = {"n": 0}

    async def staffeln_then_new(db, season_id):
        calls["n"] += 1
        rows = await original(db, season_id)
        if calls["n"] == 1:
            return rows
        return [*rows, {"id": "neu", "status": "draft", "league_context": {"season_id": season_id, "staffel": "B"}}]

    monkeypatch.setattr(league_season_cancel, "_staffeln", staffeln_then_new)
    with pytest.raises(LeagueProblem) as changed:
        await league_season_cancel.cancel(flow.db, league, season, REASON, w["lead"])

    assert changed.value.status == 409
    assert (await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0}))["status"] != "cancelled"


@pytest.mark.asyncio
async def test_a_staffel_cancelled_before_sends_no_second_cancel_and_the_plan_agrees(flow):
    """Wer nur in einer vorher einzeln abgesagten Staffel stand, hat die Absage schon - keine zweite Nachricht, und das Blatt zählt ihn nicht."""
    w = await application_world(flow, teams=2, staffeln=2)
    flow.act_as(w["lead"])
    side = w["teams"][0]
    ok(await flow.post(f"/api/tournaments/{w['tids'][1]}/squad-registrations", json={"team_id": side["team"]["id"], "squad_id": side["squad"]["id"]}))
    await flow.db.tournaments.update_one({"id": w["tids"][1]}, {"$set": {"status": "cancelled"}})
    other = await submitted(flow, w, w["teams"][1])
    assert other

    flow.act_as(w["lead"])
    plan = ok(await flow.get(f"{season_url(w)}/cancel-plan"))
    ok(await cancel(flow, w))

    assert await notes(flow, side["captain"]) == []
    assert len(await notes(flow, w["teams"][1]["captain"])) == 1
    assert plan["teams"] == 1 and plan["people"] == 2


@pytest.mark.asyncio
async def test_the_start_rights_sentence_only_goes_to_carried_teams(flow):
    from test_league_start_rights_flow import person

    world, second, rows = await rights_world(flow)
    squad = next(iter(rows))
    # Ein neu angemeldetes Team derselben Season: ohne Startrecht.
    new = await flow.add_user(name="Neu Kapitän")
    application = {"id": new_id(), "season_id": second["id"], "league_id": second["league_id"], "user_id": None, "team_id": None,
                   "squad_id": "neu-squad", "display_name": "Neu · Eins", "status": "submitted", "active_key": f"{second['id']}:neu-squad",
                   "history": []}
    await flow.db.team_squads.insert_one({"id": "neu-squad", "team_id": "neu-team", "name": "Eins", "captain_id": new["id"], "member_ids": [new["id"]]})
    await flow.db.teams.insert_one({"id": "neu-team", "name": "Neu", "leader_id": new["id"], "member_ids": [new["id"]]})
    await flow.db.league_applications.insert_one(dict(application))

    ok(await cancel_season(flow, world, second))

    carried_note = await notes(flow, await person(flow, squad))
    new_note = await notes(flow, new)
    assert len(carried_note) == 1 and "Startrechte" in carried_note[0]["body"]
    assert len(new_note) == 1 and "Startrechte" not in new_note[0]["body"]


@pytest.mark.asyncio
async def test_sync_and_rules_are_refused_after_the_cancel(flow):
    w = await application_world(flow, teams=1)
    ok(await cancel(flow, w))
    flow.act_as(w["lead"])

    synced = await flow.post(f"{season_url(w)}/sync")
    assert synced.status_code == 409 and synced.json()["detail"] == SEASON_CANCELLED

    from league_rules_world import publish

    with pytest.raises(AssertionError) as published:
        await publish(flow, w, reason="Neue Fassung nach der Absage")
    assert "409" in str(published.value) or SEASON_CANCELLED[:30] in str(published.value)

    from services import league_rules

    with pytest.raises(LeagueProblem) as consent:
        await league_rules._give_consent(flow.db, w["rule"]["id"], w["season"]["id"], w["teams"][0]["squad"]["id"], w["teams"][0]["captain"])
    assert consent.value.status in (404, 409)


@pytest.mark.asyncio
async def test_shortfall_checks_each_staffel_once_nobody_waits_for_a_staffel(flow):
    """3 in Staffel A, 1 in Staffel B: zusammen genug, aber Staffel B hat zu wenige - sobald niemand mehr ohne Zuteilung wartet."""
    w = await application_world(flow, teams=4, staffeln=2)
    rows = [await submitted(flow, w, side) for side in w["teams"]]
    for row, tid in zip(rows, [w["tids"][0], w["tids"][0], w["tids"][0], w["tids"][1]]):
        ok(await decide(flow, w, row, "accept", tournament_id=tid))
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})

    short = await league_season_cancel.entry_shortfall(flow.db, {**season, **closed_window()})

    assert len(short) == 1 and "Staffel B" in short[0]["text"] and "1 zugeteilt" in short[0]["text"]
