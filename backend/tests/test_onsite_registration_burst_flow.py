"""Vor-Ort-Anmeldung im Schwall (#1826): Am Einlass scannen Gruppen den QR-Code am TV im selben Moment.

Alle Anmeldungen eines Turniers laufen unter derselben Turnier-Sperre. Wartet eine Anmeldung zu kurz auf sie, bekommt
die Person „Eine Turnieraktion wird bereits verarbeitet“ - obwohl nur andere Anmeldungen vor ihr dran sind. Diese
Tests machen jede Anmeldung künstlich langsam (wie Mails, Vorschau und Rechnung auf dem echten Server), schicken viele
gleichzeitig ab und verlangen: alle kommen an, die Platzgrenze bleibt exakt, der Rest steht auf der Warteliste. Dasselbe
für gleichzeitige Abmeldungen samt Nachrücken.
"""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio
from fastapi import HTTPException, Request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import load_application, make_flow  # noqa: E402
from models import RegistrationCreate  # noqa: E402

# So lange hält eine Anmeldung die Sperre in diesen Tests. 16 davon brauchen zusammen deutlich mehr als die frühere
# Wartezeit von 2 Sekunden.
SLOW_SECONDS = 0.3


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    # Wie auf echtem MongoDB: eine Sperre je Ressource (sonst serialisiert mongomock nichts).
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


def slow_inside_the_lock(monkeypatch, module, name: str) -> None:
    real = getattr(module, name)

    async def slow(*args, **kwargs):
        await asyncio.sleep(SLOW_SECONDS)
        return await real(*args, **kwargs)

    monkeypatch.setattr(module, name, slow)


async def outcome(call):
    try:
        return 200, await call
    except HTTPException as exc:
        return exc.status_code, exc.detail


async def statuses(flow, tournament: dict) -> list[str]:
    rows = await flow.db.tournament_registrations.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(100)
    return sorted(row["status"] for row in rows)


@pytest.mark.asyncio
async def test_sixteen_people_scanning_at_once_all_get_in(flow, monkeypatch):
    from routes import tournament_registration_routes as routes

    slow_inside_the_lock(monkeypatch, routes, "_create_self_registration")
    tournament = await flow.create_tournament(max_participants=32)
    people = [await flow.add_user(name=f"Gast {index}") for index in range(16)]
    body = RegistrationCreate(accept_rules=True, accept_privacy=True)

    results = await asyncio.gather(*(outcome(routes.self_register(flow.db, tournament, body, who, None, via="onsite"))
                                     for who in people))

    assert [status for status, _ in results] == [200] * 16, [detail for status, detail in results if status != 200]
    assert await statuses(flow, tournament) == ["approved"] * 16


@pytest.mark.asyncio
async def test_ten_at_once_for_eight_places_fill_exactly_eight_and_wait_list_two(flow, monkeypatch):
    from routes import tournament_registration_routes as routes

    slow_inside_the_lock(monkeypatch, routes, "_create_self_registration")
    tournament = await flow.create_tournament(max_participants=8)
    people = [await flow.add_user(name=f"Gast {index}") for index in range(10)]
    body = RegistrationCreate(accept_rules=True, accept_privacy=True)

    results = await asyncio.gather(*(outcome(routes.self_register(flow.db, tournament, body, who, None, via="onsite"))
                                     for who in people))

    assert [status for status, _ in results] == [200] * 10, [detail for status, detail in results if status != 200]
    assert await statuses(flow, tournament) == ["approved"] * 8 + ["waitlist"] * 2
    replies = sorted(reply["status"] for _, reply in results)
    assert replies == ["approved"] * 8 + ["waitlist"] * 2


@pytest.mark.asyncio
async def test_many_signing_off_at_once_all_get_out_and_the_wait_list_moves_up(flow, monkeypatch):
    from routes import tournament_registration_routes as routes

    _, _, get_current_user, _ = load_application()
    import server

    tournament = await flow.create_tournament(max_participants=8)
    people = [await flow.add_user(name=f"Gast {index}") for index in range(10)]
    by_id = {who["id"]: who for who in people}
    registrations = [await flow.register(tournament, who, status="approved" if index < 8 else "waitlist")
                     for index, who in enumerate(people)]

    async def header_user(request: Request) -> dict:
        return by_id[request.headers["x-test-user"]]

    server.app.dependency_overrides[get_current_user] = header_user
    slow_inside_the_lock(monkeypatch, routes, "_move_up_from_waitlist")
    leaving = registrations[:8]

    responses = await asyncio.gather(*(
        flow.client.delete(f"/api/tournaments/{tournament['id']}/registrations/{reg['id']}",
                           headers={"x-test-user": reg["user_id"]})
        for reg in leaving
    ))

    assert [response.status_code for response in responses] == [200] * 8, [r.text for r in responses if r.status_code != 200]
    assert await statuses(flow, tournament) == ["approved"] * 2


@pytest.mark.asyncio
async def test_the_confirmation_is_sent_after_the_lock_is_released(flow, monkeypatch):
    """Bestätigung (Postfach, Mail) und Erfolge halten die Sperre nicht - die nächste Anmeldung kommt früher dran."""
    from routes import tournament_registration_routes as routes
    from services.mutation_lock import tournament_write_resource

    tournament = await flow.create_tournament(max_participants=8)
    anna = await flow.add_user(name="Anna")
    seen = []

    async def notify(db, tid, registration, status, **kwargs):
        held = await flow.db.mutation_locks.count_documents({"resource": tournament_write_resource(tid)})
        seen.append((registration["user_id"], status, held, "auto_bracket_update" in registration))

    monkeypatch.setattr(routes, "_notify_registration", notify)
    body = RegistrationCreate(accept_rules=True, accept_privacy=True)

    first = await routes.self_register(flow.db, tournament, body, anna, None, via="onsite")
    again = await routes.self_register(flow.db, tournament, body, anna, None, via="onsite")

    assert first["idempotent_replay"] is False and again["idempotent_replay"] is True
    assert seen == [(anna["id"], "approved", 0, False)], "genau eine Bestätigung, ohne gehaltene Sperre"


@pytest.mark.asyncio
async def test_a_late_wait_list_confirmation_is_dropped_once_the_person_moved_up(flow, monkeypatch):
    """Warteliste → jemand meldet sich ab, die Person rückt nach („nachgerückt“) → erst dann käme die verspätete
    Bestätigung „Warteliste“. Sie entfällt: nur die Nachricht zum jetzigen Stand geht hinaus."""
    from routes import tournament_registration_routes as routes

    tournament = await flow.create_tournament(max_participants=1)
    ben, anna = await flow.add_user(name="Ben"), await flow.add_user(name="Anna")
    ben_reg = await flow.register(tournament, ben)
    sent = []

    async def notify(db, tid, registration, status, *, previous=None, **kwargs):
        sent.append((registration["user_id"], status, previous))

    monkeypatch.setattr(routes, "_notify_registration", notify)
    real_after = routes._confirm_self_registration

    async def ben_signs_off_first(db, tid, reg, me):
        flow.act_as(ben)
        response = await flow.client.delete(f"/api/tournaments/{tid}/registrations/{ben_reg['id']}")
        assert response.status_code == 200, response.text
        await real_after(db, tid, reg, me)

    monkeypatch.setattr(routes, "_confirm_self_registration", ben_signs_off_first)
    body = RegistrationCreate(accept_rules=True, accept_privacy=True)

    reply = await routes.self_register(flow.db, tournament, body, anna, None, via="onsite")

    assert reply["status"] == "waitlist"
    stored = await flow.db.tournament_registrations.find_one({"id": reply["id"]}, {"_id": 0})
    assert stored["status"] == "approved"
    assert sent == [(anna["id"], "approved", "waitlist")], "nur „nachgerückt“, keine verspätete Warteliste-Nachricht"


@pytest.mark.asyncio
async def test_the_confirmation_goes_out_once_per_registration(flow, monkeypatch):
    from routes import tournament_registration_routes as routes

    tournament = await flow.create_tournament(max_participants=8)
    anna = await flow.add_user(name="Anna")
    sent = []

    async def notify(db, tid, registration, status, **kwargs):
        sent.append(status)

    monkeypatch.setattr(routes, "_notify_registration", notify)
    reply = await routes.self_register(flow.db, tournament, RegistrationCreate(accept_rules=True, accept_privacy=True),
                                       anna, None, via="onsite")
    await routes._after_self_registration(flow.db, tournament["id"], reply, anna)

    assert sent == ["approved"]



def count_preview_refreshes(monkeypatch, routes, seen: list) -> None:
    """Den Vorschau-Baum künstlich langsam machen (wie auf dem echten Server) und mitschreiben, wie viele Anmeldungen
    er bei jedem Neubau sieht."""
    real = routes._refresh_tournament_previews_after_registration

    async def slow(db, tournament, actor_id):
        count = await db.tournament_registrations.count_documents(
            {"tournament_id": tournament["id"], "status": {"$in": ["approved", "checked_in"]}})
        seen.append(count)
        await asyncio.sleep(SLOW_SECONDS)
        return await real(db, tournament, actor_id)

    monkeypatch.setattr(routes, "_refresh_tournament_previews_after_registration", slow)


@pytest.mark.asyncio
async def test_sixteen_at_once_do_not_wait_for_sixteen_bracket_rebuilds(flow, monkeypatch):
    """#1859: Früher baute jede Anmeldung den Vorschau-Baum in der Sperre neu - 16 gleichzeitige warteten 16 Neubauten
    ab (im Probelauf bis 20 s). Jetzt vergibt die Sperre nur den Platz; der Baum wird danach einmal für alle gebaut und
    enthält am Ende alle 16."""
    from routes import tournament_registration_routes as routes

    seen: list[int] = []
    count_preview_refreshes(monkeypatch, routes, seen)
    tournament = await flow.create_tournament(max_participants=32)
    people = [await flow.add_user(name=f"Gast {index}") for index in range(16)]
    body = RegistrationCreate(accept_rules=True, accept_privacy=True)
    loop = asyncio.get_running_loop()

    started = loop.time()
    results = await asyncio.gather(*(outcome(routes.self_register(flow.db, tournament, body, who, None, via="onsite"))
                                     for who in people))
    elapsed = loop.time() - started

    assert [status for status, _ in results] == [200] * 16, [detail for status, detail in results if status != 200]
    assert await statuses(flow, tournament) == ["approved"] * 16
    assert seen and seen[-1] == 16, f"der letzte Neubau muss alle 16 enthalten: {seen}"
    assert len(seen) <= 3, f"ein Neubau für alle statt einer je Anmeldung: {seen}"
    assert elapsed < 12 * SLOW_SECONDS, f"16 Anmeldungen brauchten {elapsed:.2f} s"


@pytest.mark.asyncio
async def test_a_failing_bracket_rebuild_does_not_cost_the_place(flow, monkeypatch):
    """#1859: Der Baum folgt nach der Platzvergabe. Scheitert er, bleibt die Anmeldung bestätigt, und die Bestätigung
    geht trotzdem genau einmal hinaus."""
    from routes import tournament_registration_routes as routes

    async def broken(db, tournament, actor_id):
        raise RuntimeError("Baum kaputt")

    sent = []

    async def notify(db, tid, registration, status, **kwargs):
        sent.append(status)

    monkeypatch.setattr(routes, "_refresh_tournament_previews_after_registration", broken)
    monkeypatch.setattr(routes, "_notify_registration", notify)
    tournament = await flow.create_tournament(max_participants=8)
    anna = await flow.add_user(name="Anna")

    reply = await routes.self_register(flow.db, tournament, RegistrationCreate(accept_rules=True, accept_privacy=True),
                                       anna, None, via="onsite")

    assert reply["status"] == "approved"
    assert await statuses(flow, tournament) == ["approved"]
    assert sent == ["approved"]



@pytest.mark.asyncio
async def test_the_confirmation_is_out_before_the_answer_only_achievements_follow(flow, monkeypatch):
    """#1859: Die Abzeichen-Auswertung kostet bei 16 gleichzeitigen Anmeldungen am meisten - sie läuft nach der Antwort.
    Die Bestätigung nicht: ein Hintergrund-Auftrag überlebt keinen Neustart, und eine Wiederholung der Anmeldung
    schickt sie nicht nach (#1846, genau eine Bestätigung). Sie ist also erstellt, wenn die Antwort zurückkommt."""
    from fastapi import BackgroundTasks
    from routes import tournament_registration_routes as routes

    sent, awarded = [], []

    async def notify(db, tid, registration, status, **kwargs):
        sent.append(status)

    async def badges(user_id, tid):
        awarded.append(user_id)

    monkeypatch.setattr(routes, "_notify_registration", notify)
    monkeypatch.setattr(routes, "_award_registration_badges", badges)
    tournament = await flow.create_tournament(max_participants=8)
    anna = await flow.add_user(name="Anna")
    later = BackgroundTasks()

    reply = await routes.self_register(flow.db, tournament, RegistrationCreate(accept_rules=True, accept_privacy=True),
                                       anna, None, via="onsite", followups=later)

    assert reply["status"] == "approved"
    assert sent == ["approved"], "die Bestätigung ist vor der Antwort draußen"
    stored = await flow.db.tournament_registrations.find_one({"id": reply["id"]}, {"_id": 0})
    assert stored["notified_status"] == "approved"
    assert awarded == [], "die Abzeichen folgen erst nach der Antwort"
    await later()
    assert awarded == [anna["id"]]

    # Neustart nach der Antwort, die Abzeichen gingen verloren - die Wiederholung schickt keine zweite Bestätigung.
    again = await routes.self_register(flow.db, tournament, RegistrationCreate(accept_rules=True, accept_privacy=True),
                                       anna, None, via="onsite", followups=BackgroundTasks())
    assert again["idempotent_replay"] is True and sent == ["approved"]

    flow.act_as(await flow.add_user(name="Ben"))
    response = await flow.client.post(f"/api/tournaments/{tournament['id']}/register",
                                      json={"accept_rules": True, "accept_privacy": True})
    assert response.status_code == 200, response.text
    assert sent == ["approved", "approved"]


@pytest.mark.asyncio
async def test_a_failed_bracket_rebuild_is_tried_once_more(flow, monkeypatch):
    """#1859: Scheitert der Neubau der Vorschau nach einer Anmeldung, versucht der Server es sofort noch einmal - sonst
    stünde der Baum bis zur nächsten Anmeldung oder zum Check-in-Ende ohne die Person da."""
    from routes import tournament_registration_routes as routes

    real = routes._refresh_tournament_previews_after_registration
    calls = []

    async def flaky(db, tournament, actor_id):
        calls.append(tournament["id"])
        if len(calls) == 1:
            raise RuntimeError("kurz weg")
        return await real(db, tournament, actor_id)

    monkeypatch.setattr(routes, "_refresh_tournament_previews_after_registration", flaky)
    tournament = await flow.create_tournament(max_participants=8)
    anna = await flow.add_user(name="Anna")

    reply = await routes.self_register(flow.db, tournament, RegistrationCreate(accept_rules=True, accept_privacy=True),
                                       anna, None, via="onsite")

    assert reply["status"] == "approved"
    assert calls == [tournament["id"], tournament["id"]]
    queue = routes._registration_queue(tournament["id"])
    assert queue.refreshed == queue.requested == 1, "der zweite Versuch zählt als aufgefrischt"


def test_the_registration_wait_is_configurable_and_bounded():
    from routes.tournament_common import registration_wait_seconds

    assert registration_wait_seconds({}) == 20.0
    assert registration_wait_seconds({"REGISTRATION_LOCK_WAIT_SECONDS": "30"}) == 30.0
    assert registration_wait_seconds({"REGISTRATION_LOCK_WAIT_SECONDS": "0"}) == 2.0
    assert registration_wait_seconds({"REGISTRATION_LOCK_WAIT_SECONDS": "999"}) == 60.0
    assert registration_wait_seconds({"REGISTRATION_LOCK_WAIT_SECONDS": "viel"}) == 20.0
    assert registration_wait_seconds({"REGISTRATION_LOCK_WAIT_SECONDS": "nan"}) == 20.0


async def sign_off(flow, tournament: dict, reg: dict, who: dict):
    flow.act_as(who)
    return await flow.client.delete(f"/api/tournaments/{tournament['id']}/registrations/{reg['id']}")


@pytest.mark.asyncio
async def test_eight_signing_off_at_once_do_not_wait_for_eight_bracket_rebuilds(flow, monkeypatch):
    """#1871: Abmelden baute den Vorschau-Baum noch in der Turnier-Sperre - jede Abmeldung und die nächste Anmeldung am
    Einlass warteten so lange. Jetzt wie beim Anmelden (#1859): in der Sperre nur Abmeldung und Nachrücken, der Baum
    danach, einmal für alle bis dahin."""
    from routes import tournament_registration_routes as routes

    _, _, get_current_user, _ = load_application()
    import server

    seen: list[int] = []
    count_preview_refreshes(monkeypatch, routes, seen)
    tournament = await flow.create_tournament(max_participants=8)
    people = [await flow.add_user(name=f"Gast {index}") for index in range(8)]
    by_id = {who["id"]: who for who in people}
    registrations = [await flow.register(tournament, who) for who in people]

    async def header_user(request: Request) -> dict:
        return by_id[request.headers["x-test-user"]]

    server.app.dependency_overrides[get_current_user] = header_user
    loop = asyncio.get_running_loop()

    started = loop.time()
    responses = await asyncio.gather(*(
        flow.client.delete(f"/api/tournaments/{tournament['id']}/registrations/{reg['id']}",
                           headers={"x-test-user": reg["user_id"]})
        for reg in registrations
    ))
    elapsed = loop.time() - started

    assert [response.status_code for response in responses] == [200] * 8, [r.text for r in responses if r.status_code != 200]
    assert await statuses(flow, tournament) == []
    assert seen and seen[-1] == 0, f"der letzte Neubau kennt alle Abmeldungen: {seen}"
    assert len(seen) <= 3, f"ein Neubau für alle statt einer je Abmeldung: {seen}"
    assert elapsed < 6 * SLOW_SECONDS, f"8 Abmeldungen brauchten {elapsed:.2f} s"


@pytest.mark.asyncio
async def test_a_failed_rebuild_after_signing_off_is_tried_once_more_and_never_costs_the_sign_off(flow, monkeypatch, caplog):
    """#1871: wie bei der Anmeldung - scheitert der Neubau, gleich noch einmal; scheitert auch der, steht es im Log,
    die Abmeldung gilt trotzdem, die Warteliste ist exakt nachgerückt und bekommt genau eine Nachricht."""
    import logging

    from routes import tournament_registration_routes as routes

    calls, sent = [], []

    async def broken(db, tournament, actor_id):
        calls.append(tournament["id"])
        raise RuntimeError("Baum kaputt")

    async def notify(db, tid, registration, status, *, previous=None, **kwargs):
        sent.append((registration["user_id"], status, previous))

    monkeypatch.setattr(routes, "_refresh_tournament_previews_after_registration", broken)
    monkeypatch.setattr(routes, "_notify_registration", notify)
    tournament = await flow.create_tournament(max_participants=1)
    anna, ben = await flow.add_user(name="Anna"), await flow.add_user(name="Ben")
    anna_reg = await flow.register(tournament, anna)
    await flow.register(tournament, ben, status="waitlist")

    with caplog.at_level(logging.ERROR, logger="tls.tournament_registration"):
        response = await sign_off(flow, tournament, anna_reg, anna)

    assert response.status_code == 200, response.text
    assert response.json()["auto_bracket_update"] is None
    assert calls == [tournament["id"], tournament["id"]], "ein zweiter Versuch"
    assert any(record.exc_info for record in caplog.records), "der gescheiterte Neubau steht samt Fehler im Log"
    assert await statuses(flow, tournament) == ["approved"], "die Warteliste ist nachgerückt"
    assert sent == [(ben["id"], "approved", "waitlist")], f"genau eine Nachricht nachgerückt: {sent}"
