"""Saison-Gewinne (#641): das Türchen mit Gewinn. Mitmachen ist ein eigener Klick und lässt sich zurückziehen;
gezogen wird per Zufall mit Protokoll; wer gewinnt, erfährt es privat und findet den Gewinn unter „Meine Gewinne“ -
öffentlich wird nie ein Name. Nachziehen gibt es nur für einen verfallenen Gewinn."""
import pathlib
import random
import sys
from datetime import datetime, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import achievement_counters as counters  # noqa: E402
from services import advent_calendar as advent  # noqa: E402
from services import season_raffles as raffles  # noqa: E402
from services import seasons  # noqa: E402

REAL_TO_VIENNA = seasons.to_vienna
VIENNA = seasons.VIENNA
PRIZE = {"label": "TLS-Hoodie", "value": "Größe nach Wahl", "winners": 2}


def vienna(year, month, day, hour=12, minute=0, second=0) -> datetime:
    return datetime(year, month, day, hour, minute, second, tzinfo=VIENNA)


def set_clock(monkeypatch, moment: datetime):
    monkeypatch.setattr(seasons, "to_vienna", lambda now=None: REAL_TO_VIENNA(now if now is not None else moment))
    for module in (counters, advent, raffles):
        monkeypatch.setattr(module, "now_utc", lambda: moment.astimezone(timezone.utc))


@pytest_asyncio.fixture
async def flow(monkeypatch):
    instance, shutdown = make_flow()
    # Ein Zufall mit fester Saat: die Ziehung bleibt eine Ziehung, der Test weiß trotzdem, wer gewinnt.
    monkeypatch.setattr(raffles, "_rng", random.Random(20261212))
    try:
        yield instance
    finally:
        await shutdown()


async def save(flow, staff, day, year=2026, expect=200, **fields):
    flow.act_as(staff)
    res = await flow.put(f"/api/seasonal/advent/admin/{year}/{day}", json={"kind": "prize", "title": f"Gewinn {day}", "body": "Mach mit!", "prize": PRIZE, **fields})
    assert res.status_code == expect, res.text
    return res.json()


async def opened(flow, user, day):
    flow.act_as(user)
    res = await flow.post(f"/api/seasonal/advent/{day}/open")
    assert res.status_code == 200, res.text
    return res


async def people(flow, names):
    users = [await flow.add_user(name=name) for name in names]
    for user in users:
        await opened(flow, user, 12)
        assert (await flow.post("/api/seasonal/advent/12/enter")).status_code == 200
    return users


# ------------------------------------------------------------------ Pflege

@pytest.mark.asyncio
async def test_der_gewinn_wird_geprueft_und_der_schluss_liegt_im_kalender(flow):
    staff = await flow.add_staff("Vorstand")
    wrong = [
        ({"prize": None}, "Der Gewinn braucht einen Namen (zum Beispiel „TLS-Hoodie“)."),
        ({"prize": {"label": "  "}}, "Der Gewinn braucht einen Namen (zum Beispiel „TLS-Hoodie“)."),
        ({"prize": {"label": "Hoodie", "winners": 21}}, "Es können 1 bis 20 Personen gewinnen."),
        ({"prize": {"label": "Hoodie", "audience": "freunde"}}, "Mitmachen können alle mit Konto oder nur Vereinsmitglieder."),
        ({"prize": {"label": "Hoodie", "closes_at": "bald"}}, "Den Teilnahmeschluss verstehe ich nicht."),
        ({"prize": {"label": "Hoodie", "closes_at": "2026-12-12T06:30:00+01:00"}}, "Der Teilnahmeschluss muss mindestens eine Stunde nach dem Öffnen des Türchens liegen."),
        ({"prize": {"label": "Hoodie", "closes_at": "2027-01-07T00:00:00+01:00"}}, "Der Teilnahmeschluss liegt nach dem Ende des Kalenders."),
    ]
    for fields, message in wrong:
        res = await save(flow, staff, 12, expect=400, **fields)
        assert res["detail"] == message, (fields, res)
    assert await flow.db.advent_doors.count_documents({}) == 0 and await flow.db.season_raffles.count_documents({}) == 0

    door = await save(flow, staff, 12)
    raffle = await flow.db.season_raffles.find_one({"id": door["raffle_id"]}, {"_id": 0})
    assert door["kind"] == "prize" and door["prize"]["closes_at"] == "2027-01-06T23:59:59+01:00", "ohne Angabe: bis zum Ende des Kalenders"
    assert raffle["source_key"] == "advent:2026:12" and raffle["title"] == "Adventkalender 2026" and raffle["source_label"] == "Türchen 12"
    assert raffle["status"] == "open" and raffle["winners"] == 2 and raffle["audience"] == "all" and raffle["staff_may_enter"] is False and raffle["draws"] == []

    # Noch einmal speichern ändert dieselbe Verlosung; ein eigener Schluss wird auf Wiener Zeit gebracht.
    again = await save(flow, staff, 12, prize={**PRIZE, "winners": 1, "closes_at": "2026-12-12T22:59:00Z", "audience": "members"})
    assert again["raffle_id"] == door["raffle_id"] and await flow.db.season_raffles.count_documents({}) == 1
    assert again["prize"] == {"prize_label": "TLS-Hoodie", "prize_value": "Größe nach Wahl", "winners": 1, "audience": "members", "closes_at": "2026-12-12T23:59:00+01:00", "staff_may_enter": False}
    view = (await flow.get("/api/seasonal/advent/admin/2026")).json()
    state = next(item for item in view["doors"] if item["day"] == 12)["raffle"]
    assert state["status"] == "open" and state["entries"] == 0 and state["can_draw"] is True and state["needs_close_early"] is True and state["protocol"] == []
    assert next(item for item in view["doors"] if item["day"] == 11)["raffle"] is None


# ------------------------------------------------------------------ Mitmachen

@pytest.mark.asyncio
async def test_mitmachen_ist_ein_eigener_klick_und_laesst_sich_zurueckziehen(flow, monkeypatch):
    staff = await flow.add_staff("Vorstand")
    paula = await flow.add_user(name="Paula")
    await save(flow, staff, 12)
    await save(flow, staff, 11, kind="text", title="Nur Text", body="Hallo")
    set_clock(monkeypatch, vienna(2026, 12, 12, 10))

    flow.act_as(None)
    guest = (await flow.post("/api/seasonal/advent/12/open")).json()["content"]
    assert guest["kind"] == "prize" and guest["prize"]["can_enter"] is False and guest["prize"]["hint"] == "Melde dich an, um mitzumachen."
    assert (await flow.post("/api/seasonal/advent/12/enter")).status_code == 401

    flow.act_as(paula)
    early = await flow.post("/api/seasonal/advent/12/enter")
    assert early.status_code == 409 and early.json()["detail"] == "Öffne zuerst das Türchen."
    prize = (await opened(flow, paula, 12)).json()["content"]["prize"]
    assert prize["label"] == "TLS-Hoodie" and prize["value"] == "Größe nach Wahl" and prize["winners"] == 2 and prize["status"] == "open"
    assert prize["entries"] == 0 and prize["entered"] is False and prize["can_enter"] is True and prize["can_withdraw"] is False and prize["won"] is False and prize["hint"] is None
    assert prize["terms"] == [
        "Mitmachen kann, wer ein Konto hat. Vorstand und Verwaltung machen nicht mit.",
        "Die Teilnahme ist kostenlos und bis 6.1.2027, 23:59 Uhr möglich. Bis dahin kannst du sie auch zurückziehen.",
        "Gezogen wird per Zufall; jede Person hat ein Los. Es gewinnen 2 Personen.",
        "Wer gewinnt, bekommt eine Nachricht auf der Plattform und findet den Gewinn unter „Meine Gewinne“. Namen werden nicht veröffentlicht.",
        "Der Gewinn wird beim Verein abgeholt; eine Auszahlung in bar gibt es nicht.",
    ]
    # Öffnen allein ist keine Teilnahme.
    assert await flow.db.season_raffle_entries.count_documents({}) == 0

    joined = (await flow.post("/api/seasonal/advent/12/enter")).json()
    assert joined["day"] == 12 and joined["prize"]["entered"] is True and joined["prize"]["entries"] == 1 and joined["prize"]["can_enter"] is False
    assert joined["prize"]["can_withdraw"] is True and joined["prize"]["hint"] == "Du bist dabei. Viel Glück!"
    assert (await flow.post("/api/seasonal/advent/12/enter")).json()["prize"]["entries"] == 1
    entry = await flow.db.season_raffle_entries.find_one({"user_id": paula["id"]}, {"_id": 0})
    assert set(entry) == {"id", "raffle_id", "user_id", "entered_at"}
    listing = next(door for door in (await flow.get("/api/seasonal/advent")).json()["doors"] if door["day"] == 12)
    assert listing["content"]["prize"]["entered"] is True

    left = (await flow.delete("/api/seasonal/advent/12/enter")).json()
    assert left["prize"]["entered"] is False and left["prize"]["entries"] == 0 and left["prize"]["can_enter"] is True
    assert await flow.db.season_raffle_entries.count_documents({}) == 0

    # Kein Gewinn im Türchen, kein Türchen, noch nicht offen.
    await opened(flow, paula, 11)
    assert (await flow.post("/api/seasonal/advent/11/enter")).status_code == 404
    assert (await flow.post("/api/seasonal/advent/13/enter")).status_code == 409
    assert (await flow.post("/api/seasonal/advent/25/enter")).status_code == 404

    # Nach dem Teilnahmeschluss: weder hinein noch hinaus.
    await flow.post("/api/seasonal/advent/12/enter")
    await save(flow, staff, 12, prize={**PRIZE, "closes_at": "2026-12-12T20:00:00+01:00"})
    set_clock(monkeypatch, vienna(2026, 12, 12, 20, 0, 1))
    flow.act_as(paula)
    late = await flow.delete("/api/seasonal/advent/12/enter")
    assert late.status_code == 409 and late.json()["detail"] == "Die Teilnahme ist vorbei – zurückziehen geht nicht mehr."
    kai = await flow.add_user(name="Kai")
    closed = (await opened(flow, kai, 12)).json()["content"]["prize"]
    assert closed["status"] == "closed" and closed["can_enter"] is False and closed["hint"] == "Die Teilnahme ist vorbei – gezogen wird in Kürze."
    res = await flow.post("/api/seasonal/advent/12/enter")
    assert res.status_code == 409 and res.json()["detail"] == "Die Teilnahme an dieser Verlosung ist vorbei."


@pytest.mark.asyncio
async def test_wer_mitmachen_darf(flow, monkeypatch):
    staff = await flow.add_staff("Vorstand")
    guest_member = await flow.add_user(name="Gast")
    member = await flow.add_user(name="Mitglied")
    member["is_club_member"] = True
    by_record = await flow.add_user(name="Akte")
    await flow.db.memberships.insert_one({"user_id": by_record["id"], "member_status": "active"})
    await save(flow, staff, 12, prize={**PRIZE, "audience": "members"})
    set_clock(monkeypatch, vienna(2026, 12, 12, 10))

    prize = (await opened(flow, guest_member, 12)).json()["content"]["prize"]
    assert prize["can_enter"] is False and prize["hint"] == "Diese Verlosung ist für Vereinsmitglieder." and prize["audience"] == "members"
    assert prize["terms"][0] == "Mitmachen können Vereinsmitglieder mit Konto. Vorstand und Verwaltung machen nicht mit."
    res = await flow.post("/api/seasonal/advent/12/enter")
    assert res.status_code == 403 and res.json()["detail"] == "Diese Verlosung ist für Vereinsmitglieder."
    for person in (member, by_record):
        await opened(flow, person, 12)
        assert (await flow.post("/api/seasonal/advent/12/enter")).json()["prize"]["entered"] is True

    # Wer die Verlosung betreut, macht nicht mit - außer sie gibt es frei.
    staff["is_club_member"] = True
    await opened(flow, staff, 12)
    res = await flow.post("/api/seasonal/advent/12/enter")
    assert res.status_code == 403 and res.json()["detail"] == "Vorstand und Verwaltung machen bei dieser Verlosung nicht mit."
    await save(flow, staff, 12, prize={**PRIZE, "audience": "members", "staff_may_enter": True})
    joined = (await flow.post("/api/seasonal/advent/12/enter")).json()["prize"]
    assert joined["entered"] is True and joined["entries"] == 3 and joined["terms"][0] == "Mitmachen können Vereinsmitglieder mit Konto."

    banned = await flow.add_user(name="Gesperrt")
    banned["is_club_member"], banned["is_banned"] = True, True
    await opened(flow, banned, 12)
    res = await flow.post("/api/seasonal/advent/12/enter")
    assert res.status_code == 403 and res.json()["detail"] == "Mit diesem Konto kannst du nicht mitmachen."


# ------------------------------------------------------------------ Ziehen

@pytest.mark.asyncio
async def test_ziehung_mit_protokoll_gewinner_privat_und_nie_ein_name_nach_aussen(flow, monkeypatch):
    staff = await flow.add_staff("Vorstand")
    await save(flow, staff, 12, prize={**PRIZE, "closes_at": "2026-12-13T20:00:00+01:00"})
    set_clock(monkeypatch, vienna(2026, 12, 12, 10))
    users = await people(flow, ["Anna", "Bernd", "Clara", "David", "Eva"])
    # Eva löscht ihr Konto, David wird gesperrt - beide haben ein Los, gewinnen können sie nicht mehr.
    await flow.db.users.update_one({"id": users[4]["id"]}, {"$set": {"anonymized_at": "2026-12-12T11:00:00+00:00", "is_active": False, "display_name": "Gelöschter User"}})
    await flow.db.users.update_one({"id": users[3]["id"]}, {"$set": {"is_banned": True}})

    for who, status in ((None, 401), (users[0], 403)):
        flow.act_as(who)
        assert (await flow.post("/api/seasonal/advent/admin/2026/12/draw", json={})).status_code == status
        assert (await flow.post("/api/seasonal/advent/admin/2026/12/redraw", json={"pickup_id": "egal"})).status_code == status

    flow.act_as(staff)
    early = await flow.post("/api/seasonal/advent/admin/2026/12/draw", json={})
    assert early.status_code == 409 and early.json()["detail"] == "Die Teilnahme läuft noch bis 13.12. um 20:00 Uhr. Früher ziehen geht nur mit „Teilnahme jetzt beenden“."
    assert (await flow.post("/api/seasonal/advent/admin/2026/11/draw", json={})).status_code == 404
    assert (await flow.post("/api/seasonal/advent/admin/2026/13/draw", json={})).status_code == 409
    assert await flow.db.prize_pickups.count_documents({}) == 0

    set_clock(monkeypatch, vienna(2026, 12, 13, 20, 0, 1))
    state = (await flow.post("/api/seasonal/advent/admin/2026/12/draw", json={})).json()
    assert state["status"] == "drawn" and state["can_draw"] is False and state["entries"] == 5 and len(state["protocol"]) == 1
    record = state["protocol"][0]
    assert record["kind"] == "draw" and record["entries"] == 5 and record["eligible"] == 3 and record["closed_early"] is False
    assert record["drawn_by"] == "Vorstand" and record["drawn_at"] == "2026-12-13T19:00:01+00:00" and record["method"] == "Zufallsziehung, jede Person ein Los"
    winners = [winner["user_id"] for winner in record["winners"]]
    assert len(winners) == 2 == len(set(winners)) and set(winners) <= {user["id"] for user in users[:3]}
    assert all(winner["pickup_status"] == "pending" and winner["can_redraw"] is False and winner["name"] in ("Anna", "Bernd", "Clara") for winner in record["winners"])

    # Der Gewinn nimmt denselben Weg wie ein Turnierpreis.
    pickups = [row async for row in flow.db.prize_pickups.find({}, {"_id": 0})]
    assert sorted(row["user_id"] for row in pickups) == sorted(winners)
    for row in pickups:
        assert row["source_type"] == "season" and row["season_key"] == "advent_calendar" and row["season_year"] == 2026 and row["season_source_label"] == "Türchen 12"
        assert row["tournament_title"] == "Adventkalender 2026" and row["prize_label"] == "TLS-Hoodie" and row["prize_value"] == "Größe nach Wahl"
        assert row["status"] == "pending" and row["place_label"] == "Verlosung" and row["source_url"] == "/advent" and row["pickup_deadline"].startswith("2027-03-13")
    # Nur wer gewonnen hat, bekommt eine Nachricht - privat.
    notes = [row async for row in flow.db.notifications.find({}, {"_id": 0})]
    assert sorted(row["user_id"] for row in notes) == sorted(winners)
    assert all(row["title"] == "Du hast gewonnen!" and row["url"] == "/me/prizes" and row["kind"] == "prize_pending" and "TLS-Hoodie" in row["body"] for row in notes)

    loser = next(user for user in users[:3] if user["id"] not in winners)
    winner = next(user for user in users[:3] if user["id"] in winners)
    flow.act_as(loser)
    res = await flow.get("/api/seasonal/advent")
    seen = next(door for door in res.json()["doors"] if door["day"] == 12)["content"]["prize"]
    assert seen["status"] == "drawn" and seen["won"] is False and seen["can_enter"] is False and seen["can_withdraw"] is False
    assert seen["hint"] == "Die Verlosung ist gezogen. Wer gewonnen hat, wurde benachrichtigt."
    for name in ("Anna", "Bernd", "Clara", "David", "Eva", *[user["id"] for user in users if user["id"] != loser["id"]]):
        assert name not in res.text or name == loser["display_name"], name
    assert (await flow.get("/api/prizes/me")).json() == []
    flow.act_as(winner)
    seen = next(door for door in (await flow.get("/api/seasonal/advent")).json()["doors"] if door["day"] == 12)["content"]["prize"]
    assert seen["won"] is True and seen["hint"] == "Du hast gewonnen – schau unter „Meine Gewinne“."
    mine = (await flow.get("/api/prizes/me")).json()
    assert len(mine) == 1 and mine[0]["prize_label"] == "TLS-Hoodie" and mine[0]["source_type"] == "season"
    flow.act_as(None)
    res = await flow.get("/api/seasonal/advent?opened=12")
    assert next(door for door in res.json()["doors"] if door["day"] == 12)["content"]["prize"]["status"] == "drawn"
    assert all(user["id"] not in res.text and user["display_name"] not in res.text for user in users)

    flow.act_as(staff)
    twice = await flow.post("/api/seasonal/advent/admin/2026/12/draw", json={"close_early": True})
    assert twice.status_code == 409 and twice.json()["detail"] == "Diese Verlosung ist schon gezogen."
    assert await flow.db.prize_pickups.count_documents({}) == 2
    assert [row["source_type"] for row in (await flow.get("/api/prizes", params={"source_type": "season"})).json()] == ["season", "season"]
    assert (await flow.get("/api/prizes", params={"source_type": "fastlap"})).json() == []
    audit = await flow.db.audit_logs.find_one({"action": "advent.raffle.draw"}, {"_id": 0})
    assert audit["details"] == {"day": 12, "entries": 5, "eligible": 3, "winners": 2, "closed_early": False} and audit["actor_id"] == staff["id"]

    # Nach der Ziehung steht der Gewinn fest; der Text drumherum lässt sich weiter pflegen.
    changed = await save(flow, staff, 12, expect=409, prize={**PRIZE, "label": "Tasse", "closes_at": "2026-12-13T20:00:00+01:00"})
    assert changed["detail"] == "Die Verlosung ist schon gezogen – der Gewinn lässt sich nicht mehr ändern."
    record = (await flow.db.season_raffles.find_one({}, {"_id": 0}))
    same = await save(flow, staff, 12, title="Gezogen!", prize={**PRIZE, "closes_at": record["closes_at"]})
    assert same["title"] == "Gezogen!" and (await flow.db.season_raffles.find_one({}, {"_id": 0}))["status"] == "drawn"
    for call in (flow.delete("/api/seasonal/advent/admin/2026/12"), flow.put("/api/seasonal/advent/admin/2026/12", json={"kind": "text", "title": "x", "body": "y"})):
        res = await call
        assert res.status_code == 409 and res.json()["detail"] == "Die Verlosung ist schon gezogen – dieses Türchen bleibt, wie es ist."


@pytest.mark.asyncio
async def test_frueher_ziehen_weniger_lose_als_gewinne_und_niemand_dabei(flow, monkeypatch):
    staff = await flow.add_staff("Vorstand")
    await save(flow, staff, 12, prize={**PRIZE, "winners": 5})
    set_clock(monkeypatch, vienna(2026, 12, 12, 10))

    flow.act_as(staff)
    empty = await flow.post("/api/seasonal/advent/admin/2026/12/draw", json={"close_early": True})
    assert empty.status_code == 409 and empty.json()["detail"] == "Niemand kann gewinnen: es hat niemand mitgemacht, der teilnehmen darf."
    raffle = await flow.db.season_raffles.find_one({}, {"_id": 0})
    assert raffle["status"] == "open" and raffle["draws"] == [] and raffle["closes_at"] == "2027-01-06T23:59:59+01:00", "die Verlosung bleibt offen"

    users = await people(flow, ["Anna", "Bernd"])
    flow.act_as(staff)
    state = (await flow.post("/api/seasonal/advent/admin/2026/12/draw", json={"close_early": True})).json()
    record = state["protocol"][0]
    assert record["closed_early"] is True and record["entries"] == 2 and record["eligible"] == 2
    assert sorted(winner["user_id"] for winner in record["winners"]) == sorted(user["id"] for user in users), "fünf Gewinne, zwei Lose: beide gewinnen"
    assert state["closes_at"] == "2026-12-12T10:00:00+01:00" and state["status"] == "drawn"
    # Mit dem frühen Ziehen ist die Teilnahme zu Ende.
    late = await flow.add_user(name="Spät")
    await opened(flow, late, 12)
    assert (await flow.post("/api/seasonal/advent/12/enter")).status_code == 409


@pytest.mark.asyncio
async def test_nachziehen_nur_fuer_einen_verfallenen_gewinn(flow, monkeypatch):
    staff = await flow.add_staff("Vorstand")
    await save(flow, staff, 12, prize={**PRIZE, "winners": 1})
    set_clock(monkeypatch, vienna(2026, 12, 12, 10))
    users = await people(flow, ["Anna", "Bernd"])
    flow.act_as(staff)
    assert (await flow.post("/api/seasonal/advent/admin/2026/12/redraw", json={"pickup_id": "noch-nichts"})).json()["detail"] == "Nachziehen geht erst nach der Ziehung."
    first = (await flow.post("/api/seasonal/advent/admin/2026/12/draw", json={"close_early": True})).json()["protocol"][0]["winners"][0]

    res = await flow.post("/api/seasonal/advent/admin/2026/12/redraw", json={"pickup_id": first["pickup_id"]})
    assert res.status_code == 409 and res.json()["detail"] == "Nachziehen geht nur, wenn der Gewinn verfallen ist (Gewinne → Status „Verfallen“)."
    assert (await flow.post("/api/seasonal/advent/admin/2026/12/redraw", json={"pickup_id": "fremd"})).status_code == 404
    assert (await flow.put(f"/api/prizes/{first['pickup_id']}", json={"status": "expired"})).status_code == 200
    state = (await flow.get("/api/seasonal/advent/admin/2026")).json()["doors"][11]["raffle"]
    assert state["protocol"][0]["winners"][0]["pickup_status"] == "expired" and state["protocol"][0]["winners"][0]["can_redraw"] is True

    state = (await flow.post("/api/seasonal/advent/admin/2026/12/redraw", json={"pickup_id": first["pickup_id"]})).json()
    assert [record["kind"] for record in state["protocol"]] == ["draw", "redraw"]
    second = state["protocol"][1]
    assert second["replaces"] == first["pickup_id"] and second["eligible"] == 1 and second["method"] == "Zufallsziehung unter allen, die noch nicht gewonnen haben"
    assert second["winners"][0]["user_id"] == next(user["id"] for user in users if user["id"] != first["user_id"])
    assert state["protocol"][0]["winners"][0]["replaced"] is True and state["protocol"][0]["winners"][0]["can_redraw"] is False
    assert await flow.db.notifications.count_documents({"user_id": second["winners"][0]["user_id"], "title": "Du hast gewonnen!"}) == 1

    again = await flow.post("/api/seasonal/advent/admin/2026/12/redraw", json={"pickup_id": first["pickup_id"]})
    assert again.status_code == 409 and again.json()["detail"] == "Für diesen Gewinn wurde schon nachgezogen."
    await flow.put(f"/api/prizes/{second['winners'][0]['pickup_id']}", json={"status": "expired"})
    nobody = await flow.post("/api/seasonal/advent/admin/2026/12/redraw", json={"pickup_id": second["winners"][0]["pickup_id"]})
    assert nobody.status_code == 409 and nobody.json()["detail"] == "Es ist niemand mehr da, der noch nicht gewonnen hat."
    assert [row["action"] async for row in flow.db.audit_logs.find({"action": {"$regex": "^advent.raffle"}}, {"_id": 0})] == ["advent.raffle.draw", "advent.raffle.redraw"]


# ------------------------------------------------------------------ Umwidmen, Kopieren, Datenschutz

@pytest.mark.asyncio
async def test_ein_tuerchen_mit_teilnehmern_laesst_sich_nicht_umwidmen(flow, monkeypatch):
    staff = await flow.add_staff("Vorstand")
    await save(flow, staff, 12)
    await save(flow, staff, 13)
    set_clock(monkeypatch, vienna(2026, 12, 13, 10))
    await people(flow, ["Anna"])

    flow.act_as(staff)
    message = "An dieser Verlosung nimmt schon eine Person teil – das Türchen lässt sich nicht mehr umwidmen oder löschen."
    for call in (flow.delete("/api/seasonal/advent/admin/2026/12"), flow.put("/api/seasonal/advent/admin/2026/12", json={"kind": "text", "title": "x", "body": "y"})):
        res = await call
        assert res.status_code == 409 and res.json()["detail"] == message
    assert (await flow.db.advent_doors.find_one({"day": 12}, {"_id": 0}))["kind"] == "prize"

    # Ohne Teilnehmer geht beides - die Verlosung verschwindet mit.
    changed = (await flow.put("/api/seasonal/advent/admin/2026/13", json={"kind": "text", "title": "Doch Text", "body": "y"})).json()
    assert changed["kind"] == "text" and changed["raffle_id"] is None and changed["prize"] is None
    assert [row["source_key"] async for row in flow.db.season_raffles.find({}, {"_id": 0})] == ["advent:2026:12"]
    await save(flow, staff, 14)
    deleted = await flow.delete("/api/seasonal/advent/admin/2026/14")
    assert deleted.json() == {"ok": True}
    assert await flow.db.season_raffles.count_documents({}) == 1


@pytest.mark.asyncio
async def test_kopieren_nimmt_den_gewinn_nur_als_vorschlag_mit(flow, monkeypatch):
    staff = await flow.add_staff("Vorstand")
    await save(flow, staff, 12, prize={**PRIZE, "closes_at": "2026-12-20T20:00:00+01:00", "audience": "members"})
    copied = (await flow.post("/api/seasonal/advent/admin/2027/copy", json={"source_year": 2026})).json()
    assert copied["copied"] == [12] and copied["reconfirm"] == [12]
    item = next(item for item in (await flow.get("/api/seasonal/advent/admin/2027")).json()["doors"] if item["day"] == 12)
    assert item["door"]["raffle_id"] is None and item["raffle"] is None
    assert item["door"]["prize"] == {"prize_label": "TLS-Hoodie", "prize_value": "Größe nach Wahl", "winners": 2, "audience": "members", "staff_may_enter": False}
    assert item["problem"] == "Der Gewinn ist für dieses Jahr noch nicht bestätigt – bitte Teilnahmeschluss prüfen und speichern."
    assert await flow.db.season_raffles.count_documents({}) == 1

    # Bis zur Bestätigung zeigt das Türchen nur den Text - niemand kann bei etwas mitmachen, das es nicht gibt.
    set_clock(monkeypatch, vienna(2027, 12, 12, 10))
    user = await flow.add_user(name="Paula")
    content = (await opened(flow, user, 12)).json()["content"]
    assert content["kind"] == "text" and "prize" not in content
    assert (await flow.post("/api/seasonal/advent/12/enter")).status_code == 404
    saved = await save(flow, staff, 12, year=2027, prize={"label": "TLS-Hoodie", "winners": 2, "audience": "members"})
    assert saved["raffle_id"] and saved["copied_from"] is None and saved["prize"]["closes_at"] == "2028-01-06T23:59:59+01:00"
    assert await flow.db.season_raffles.count_documents({}) == 2


@pytest.mark.asyncio
async def test_auskunft_nennt_die_teilnahme_und_konto_loeschen_zieht_sie_zurueck(flow, monkeypatch):
    staff = await flow.add_staff("Vorstand")
    await save(flow, staff, 12, prize={**PRIZE, "winners": 1})
    set_clock(monkeypatch, vienna(2026, 12, 12, 10))
    anna, bernd = await people(flow, ["Anna", "Bernd"])

    flow.act_as(anna)
    export = (await flow.get("/api/dsgvo/export-my-data")).json()
    assert [(row["user_id"], row["raffle_id"]) for row in export["raffle_entries"]] == [(anna["id"], (await flow.db.season_raffles.find_one({}))["id"])]
    assert (await flow.post("/api/dsgvo/anonymize-me")).status_code == 200
    assert [row["user_id"] async for row in flow.db.season_raffle_entries.find({}, {"_id": 0})] == [bernd["id"]]

    flow.act_as(staff)
    record = (await flow.post("/api/seasonal/advent/admin/2026/12/draw", json={"close_early": True})).json()["protocol"][0]
    assert record["entries"] == 1 and [winner["user_id"] for winner in record["winners"]] == [bernd["id"]]
    assert "Bei Verlosungen" in next(b for sec in (await flow.get("/api/settings/public/legal/privacy")).json()["sections"] for b in sec["blocks"] if b.get("testid") == "privacy-raffles")["text"]
