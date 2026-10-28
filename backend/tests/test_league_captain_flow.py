"""Captains bekommen Termin-Nachrichten, Aufgaben und klare Wege (#2110). Erfundene Namen.

- Jede Terminaktion (Vorschlag, Gegenvorschlag, Annehmen, Ablehnen, Zurückziehen) erreicht die Verantwortlichen der
  anderen Seite - Captain und Vertreter eines Co-Teams, ohne beide die Teamleitung. Nie die eigene Seite, nie den Kader.
- Den eigenen, offenen Vorschlag zieht die eigene Seite zurück; die andere Seite kann das nicht.
- Startseite (``/api/mobile/dashboard``): „Terminvorschlag beantworten“ und „Aufstellung nachtragen“ nur für die
  Verantwortlichen - die Aufstellung nur, solange die Nachtragsfrist läuft.
- Captain und Vertreter geben die eigene Rolle selbst ab; die Teamleitung erfährt es.
- Meldungen, die an einer Rolle scheitern, nennen den Weg auf der Website (die App zeigt den Text des Servers).
"""

import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from squad_world import ids, league_world, squad_registration  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow) -> dict:
    """Löwen spielen mit „Rudel A“ (Captain Spieler1, Vertreter Spieler2), Falken mit „Horst“ ohne Rollen - dort
    handelt die Teamleitung (FalkenLeitung)."""
    world = await league_world(flow)
    users = world["users"]
    await flow.db.team_squads.update_one(
        {"id": world["squad_a"]["id"]},
        {"$set": {"captain_id": users["Spieler1"]["id"], "vice_captain_id": users["Spieler2"]["id"]}},
    )
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"status": "live"}})
    lions_reg = await squad_registration(flow, world["tournament"], world["lions"], world["squad_a"])
    falcons_reg = await squad_registration(flow, world["tournament"], world["falcons"], world["horst"])
    match = {
        "id": new_id(),
        "tournament_id": world["tournament"]["id"],
        "stage_id": new_id(),
        "match_key": "L1",
        "match_type": "duel",
        "status": "scheduled",
        "scheduled_at": (now_utc() + timedelta(days=3)).isoformat(),
        "slots": [
            {"slot": 1, "position": 1, "status": "filled", "registration_id": lions_reg["id"]},
            {"slot": 2, "position": 2, "status": "filled", "registration_id": falcons_reg["id"]},
        ],
    }
    await flow.db.matches_v2.insert_one(dict(match))
    return {**world, "match": match, "lions_reg": lions_reg, "falcons_reg": falcons_reg}


def proposals_url(world: dict) -> str:
    return f"/api/matches/{world['match']['id']}/schedule-proposals"


def when(days: int = 2) -> str:
    return (now_utc() + timedelta(days=days)).isoformat()


async def told(flow, kind: str = "match_schedule") -> dict[str, list[dict]]:
    """Wer welche Nachricht dieser Art bekommen hat - je Ereignis (``meta.reason``)."""
    out: dict[str, list[dict]] = {}
    for row in await flow.db.notifications.find({"kind": kind}, {"_id": 0}).to_list(200):
        out.setdefault(row["meta"]["reason"], []).append(row)
    return out


def receivers(rows: list[dict]) -> set[str]:
    return {row["user_id"] for row in rows}


async def schedule_enabled(flow, world) -> bool:
    flow.act_as(world["users"]["Spieler1"])
    page = (await flow.get(f"/api/matches/{world['match']['id']}/page")).json()
    return bool(page["can_propose_schedule"])


@pytest.mark.asyncio
async def test_every_schedule_action_tells_the_other_side_only(flow):
    world = await setup(flow)
    users = world["users"]
    assert await schedule_enabled(flow, world)

    flow.act_as(users["Spieler2"])
    proposed = await flow.post(proposals_url(world), json={"scheduled_at": when(2), "note": "Sonntag passt?"})
    assert proposed.status_code == 200, proposed.text
    events = await told(flow)
    assert receivers(events["schedule_proposed"]) == ids(users, "FalkenLeitung"), "Horst ohne Rollen: die Teamleitung"
    message = events["schedule_proposed"][0]
    assert message["url"] == f"/matches/{world['match']['id']}"
    assert "Loewen · Rudel A schlägt" in message["body"] and "Sonntag passt?" in message["body"]

    # Gegenvorschlag der Falken: an Captain und Vertreter von Rudel A - nicht an Leitung, Kader oder die Falken.
    flow.act_as(users["FalkenLeitung"])
    counter = await flow.post(f"{proposals_url(world)}/{proposed.json()['id']}/decision",
                              json={"action": "counter", "scheduled_at": when(3)})
    assert counter.status_code == 200, counter.text
    events = await told(flow)
    assert receivers(events["schedule_countered"]) == ids(users, "Spieler1", "Spieler2")

    # Annehmen: an die Seite, die den Gegenvorschlag gemacht hat.
    flow.act_as(users["Spieler1"])
    accepted = await flow.post(f"{proposals_url(world)}/{counter.json()['id']}/decision", json={"action": "accept"})
    assert accepted.status_code == 200, accepted.text
    events = await told(flow)
    assert receivers(events["schedule_accepted"]) == ids(users, "FalkenLeitung")

    # Ablehnen eines neuen Vorschlags.
    flow.act_as(users["FalkenLeitung"])
    again = await flow.post(proposals_url(world), json={"scheduled_at": when(4)})
    assert again.status_code == 200, again.text
    flow.act_as(users["Spieler2"])
    declined = await flow.post(f"{proposals_url(world)}/{again.json()['id']}/decision", json={"action": "decline"})
    assert declined.status_code == 200, declined.text
    events = await told(flow)
    assert receivers(events["schedule_declined"]) == ids(users, "FalkenLeitung")

    everyone = {row["user_id"] for rows in events.values() for row in rows}
    assert not everyone & ids(users, "Leitung", "CoLeitung", "Spieler3", "Spieler4", "Falke1", "Fremd"), \
        "Kader, Hauptteam-Leitung mit Captain und Unbeteiligte bekommen nichts"
    for rows in events.values():
        for row in rows:
            assert row["meta"]["category"] == "match_reminders"


@pytest.mark.asyncio
async def test_the_proposing_side_withdraws_its_own_proposal(flow):
    world = await setup(flow)
    users = world["users"]
    flow.act_as(users["Spieler1"])
    proposed = (await flow.post(proposals_url(world), json={"scheduled_at": when(2)})).json()
    decision = f"{proposals_url(world)}/{proposed['id']}/decision"

    # Die eigene Seite kann nicht annehmen - der Text nennt das Zurückziehen.
    own_accept = await flow.post(decision, json={"action": "accept"})
    assert own_accept.status_code == 400
    assert "Zurückziehen" in own_accept.json()["detail"]

    # Die andere Seite kann nicht zurückziehen.
    flow.act_as(users["FalkenLeitung"])
    refused = await flow.post(decision, json={"action": "withdraw"})
    assert refused.status_code == 403, refused.text

    # Der Vertreter derselben Seite schon.
    flow.act_as(users["Spieler2"])
    withdrawn = await flow.post(decision, json={"action": "withdraw"})
    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["status"] == "withdrawn"
    replay = await flow.post(decision, json={"action": "withdraw"})
    assert replay.status_code == 200 and replay.json()["idempotent_replay"] is True

    stored = await flow.db.match_schedule_proposals.find_one({"id": proposed["id"]}, {"_id": 0})
    assert stored["status"] == "withdrawn"
    match = await flow.db.matches_v2.find_one({"id": world["match"]["id"]}, {"_id": 0})
    assert match.get("schedule_status") is None, "nichts mehr offen - keine Antwortfrist, keine Eskalation"
    assert match.get("schedule_deadline_at") is None
    events = await told(flow)
    assert receivers(events["schedule_withdrawn"]) == ids(users, "FalkenLeitung")

    # Ein zurückgezogener Vorschlag lässt sich nicht mehr annehmen.
    flow.act_as(users["FalkenLeitung"])
    late = await flow.post(decision, json={"action": "accept"})
    assert late.status_code == 409


@pytest.mark.asyncio
async def test_withdrawing_keeps_an_agreed_time(flow):
    world = await setup(flow)
    users = world["users"]
    flow.act_as(users["Spieler1"])
    first = (await flow.post(proposals_url(world), json={"scheduled_at": when(2)})).json()
    flow.act_as(users["FalkenLeitung"])
    assert (await flow.post(f"{proposals_url(world)}/{first['id']}/decision", json={"action": "accept"})).status_code == 200
    flow.act_as(users["Spieler1"])
    second = (await flow.post(proposals_url(world), json={"scheduled_at": when(3)})).json()
    withdrawn = await flow.post(f"{proposals_url(world)}/{second['id']}/decision", json={"action": "withdraw"})
    assert withdrawn.status_code == 200, withdrawn.text
    match = await flow.db.matches_v2.find_one({"id": world["match"]["id"]}, {"_id": 0})
    assert match["schedule_status"] == "accepted"


async def actions(flow, user: dict) -> list[dict]:
    flow.act_as(user)
    response = await flow.get("/api/mobile/dashboard")
    assert response.status_code == 200, response.text
    return response.json()["me"]["actions"]


def kinds(rows: list[dict]) -> set[str]:
    return {row["type"] for row in rows}


def roles_url(world: dict) -> str:
    return f"/api/teams/{world['lions']['id']}/squads/{world['squad_a']['id']}/roles"
