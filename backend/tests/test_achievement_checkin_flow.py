"""„Pünktlich“ braucht den Zeitpunkt des Check-ins (#2337).

Der Zähler las ``checked_in_at`` - geschrieben hat das Feld aber kein Check-in-Weg, nur ``status`` und ``updated_at``. Der
Erfolg konnte deshalb nie zählen; die alten Tests legten das Feld von Hand an und merkten es nicht. Jetzt schreibt jeder
Weg zum Check-in den Zeitpunkt (selbst, Turnierleitung, Statusänderung, von der Leitung eingetragen), und älterer Bestand
ohne das Feld fällt auf ``updated_at`` zurück, solange die Anmeldung eingecheckt ist.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import achievement_play as play  # noqa: E402
from flow_harness import make_flow  # noqa: E402
import badges  # noqa: E402
from models import now_utc  # noqa: E402
from services import achievement_counters as counters  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


async def punctual(user: dict) -> int:
    return (await counters.compute(user["id"], {"matches_ready_on_time"}))["matches_ready_on_time"]


async def stored(flow, registration: dict) -> dict:
    return await flow.db.tournament_registrations.find_one({"id": registration["id"]}, {"_id": 0})


async def duel_after_checkin(flow, checkin):
    """Zwei Angemeldete, Check-in über ``checkin(registration, user)``, dann das Spiel mit Startzeit nach dem Check-in."""
    staff = await flow.add_staff()
    players = [await flow.add_user(name=name) for name in ("Anna", "Bert")]
    tournament = await flow.create_tournament(max_participants=2, status="check_in")
    regs = [await flow.register(tournament, player, seed=seed) for seed, player in enumerate(players, start=1)]
    for registration, player in zip(regs, players):
        await checkin(tournament, registration, player, staff)
    flow.act_as(staff)
    await play.draw(flow, tournament)
    [match] = await play.open_matches(flow, tournament)
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"scheduled_at": (now_utc() + timedelta(minutes=5)).isoformat()}})
    await play.decide(flow, staff, match, regs[0]["id"])
    return players, regs


@pytest.mark.asyncio
async def test_selbst_eingecheckt_zaehlt_als_puenktlich(flow):
    async def self_checkin(tournament, _registration, player, _staff):
        flow.act_as(player)
        response = await flow.post(f"/api/tournaments/{tournament['id']}/checkin")
        assert response.status_code == 200, response.text

    players, regs = await duel_after_checkin(flow, self_checkin)
    for registration in regs:
        doc = await stored(flow, registration)
        assert doc["status"] == "checked_in" and doc["checked_in_at"], "der Check-in hält seinen Zeitpunkt fest"
    assert [await punctual(player) for player in players] == [1, 1]

    # Eine spätere Änderung an der Anmeldung (Aufstellung, Zahlung …) verschiebt ``updated_at`` - nicht den Check-in.
    later = (now_utc() + timedelta(days=1)).isoformat()
    await flow.db.tournament_registrations.update_many({"id": {"$in": [reg["id"] for reg in regs]}}, {"$set": {"updated_at": later}})
    assert [await punctual(player) for player in players] == [1, 1]


@pytest.mark.asyncio
async def test_check_in_durch_die_turnierleitung_zaehlt_ebenso(flow):
    async def staff_checkin(tournament, registration, _player, staff):
        flow.act_as(staff)
        response = await flow.post(f"/api/tournaments/{tournament['id']}/registrations/{registration['id']}/checkin", json={"status": "checked_in"})
        assert response.status_code == 200, response.text

    players, regs = await duel_after_checkin(flow, staff_checkin)
    assert all([(await stored(flow, registration)).get("checked_in_at") for registration in regs])
    assert [await punctual(player) for player in players] == [1, 1]


@pytest.mark.asyncio
async def test_jeder_weg_zum_check_in_schreibt_den_zeitpunkt_und_das_zuruecknehmen_loescht_ihn(flow):
    staff = await flow.add_staff()
    anna, bert, cora = [await flow.add_user(name=name) for name in ("Anna", "Bert", "Cora")]
    tournament = await flow.create_tournament(max_participants=8, status="check_in")
    first, second = await flow.register(tournament, anna), await flow.register(tournament, bert)
    flow.act_as(staff)
    base = f"/api/tournaments/{tournament['id']}/registrations"

    # Turnierleitung checkt ein und wieder aus.
    response = await flow.post(f"{base}/{first['id']}/checkin", json={"status": "checked_in"})
    assert response.status_code == 200, response.text
    stamp = (await stored(flow, first))["checked_in_at"]
    assert stamp
    response = await flow.post(f"{base}/{first['id']}/checkin", json={"status": "approved"})
    assert response.status_code == 200, response.text
    assert "checked_in_at" not in await stored(flow, first), "ausgecheckt: kein Zeitpunkt mehr"

    # Statusänderung in der Teilnehmerliste.
    response = await flow.patch(f"{base}/{second['id']}", json={"status": "checked_in"})
    assert response.status_code == 200, response.text
    assert (await stored(flow, second))["checked_in_at"]
    response = await flow.patch(f"{base}/{second['id']}", json={"notes": "Sitzt an Platz 4"})
    assert response.status_code == 200, response.text
    kept = await stored(flow, second)
    assert kept["checked_in_at"] and kept["checked_in_at"] <= kept["updated_at"], "eine andere Änderung lässt den Check-in stehen"
    response = await flow.patch(f"{base}/{second['id']}", json={"status": "approved"})
    assert response.status_code == 200, response.text
    assert "checked_in_at" not in await stored(flow, second)

    # Von der Leitung gleich als eingecheckt eingetragen.
    response = await flow.post(base, json={"user_id": cora["id"], "status": "checked_in"})
    assert response.status_code == 200, response.text
    added = await flow.db.tournament_registrations.find_one({"tournament_id": tournament["id"], "user_id": cora["id"]}, {"_id": 0})
    assert added["status"] == "checked_in" and added["checked_in_at"] == added["created_at"]


@pytest.mark.asyncio
async def test_aelterer_bestand_ohne_zeitpunkt_faellt_auf_den_letzten_stand_zurueck(flow):
    """Vor #2337 eingecheckt: Es gibt nur ``status`` und ``updated_at``. Eingecheckt zählt der letzte Stand als Check-in;
    wer nur angenommen ist, hat nie eingecheckt - egal wie alt sein Stand ist."""
    anna, bert = await flow.add_user(name="Anna"), await flow.add_user(name="Bert")
    await flow.db.tournaments.insert_one({"id": "alt", "title": "Alt-Cup", "status": "completed", "is_public": True})
    await flow.db.tournament_registrations.insert_many([
        {"id": "ra", "tournament_id": "alt", "user_id": anna["id"], "status": "checked_in", "updated_at": "2026-09-01T17:40:00+00:00"},
        {"id": "rb", "tournament_id": "alt", "user_id": bert["id"], "status": "checked_in", "updated_at": "2026-09-01T17:50:00+00:00"},
    ])
    await flow.db.matches_v2.insert_one({
        "id": "m-alt", "tournament_id": "alt", "status": "completed", "stage_number": 1, "round": 1, "order": 1,
        "scheduled_at": "2026-09-01T18:00:00+00:00", "completed_at": "2026-09-01T18:30:00+00:00", "updated_at": "2026-09-01T18:30:00+00:00",
        "slots": [{"slot": 1, "registration_id": "ra", "status": "filled"}, {"slot": 2, "registration_id": "rb", "status": "filled"}],
        "results": [{"registration_id": "ra", "rank": 1}, {"registration_id": "rb", "rank": 2}],
    })
    assert [await punctual(anna), await punctual(bert)] == [1, 1]

    # Der Stand des Gegners ist jünger als der Start: zu spät eingecheckt (oder später geändert) - dann zählt es nicht.
    await flow.db.tournament_registrations.update_one({"id": "rb"}, {"$set": {"updated_at": "2026-09-01T18:10:00+00:00"}})
    assert [await punctual(anna), await punctual(bert)] == [0, 0]
    # Nur angenommen, nie eingecheckt: kein Zeitpunkt, auch wenn der Stand vor dem Start liegt.
    await flow.db.tournament_registrations.update_one({"id": "rb"}, {"$set": {"status": "approved", "updated_at": "2026-09-01T17:00:00+00:00"}})
    assert [await punctual(anna), await punctual(bert)] == [0, 0]
