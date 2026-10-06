"""Ostereiersuche (#646, #757): je Seite nur deren Eier mit einem Schlüssel je Person; ein Fund zählt nur angemeldet,
einmal je Ei, nicht schneller als alle drei Sekunden und nur während der Suche; der volle Korb kommt in die
Verlosung, die Schnellsten bekommen eigene Preise; Hinweise erst nach einem Tag; jedes Jahr eine andere Verteilung;
„Erstes Ei“ und „Eierkönig“."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import badges  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import achievement_counters as counters  # noqa: E402
from services import easter_hunt as easter  # noqa: E402
from services import season_raffles as raffles  # noqa: E402
from services import seasons  # noqa: E402

REAL_TO_VIENNA = seasons.to_vienna
VIENNA = seasons.VIENNA


def vienna(year, month, day, hour=12, minute=0, second=0) -> datetime:
    return datetime(year, month, day, hour, minute, second, tzinfo=VIENNA)


class Clock:
    """Eine verstellbare Uhr für Saison, Funde, Signale und Gewinne."""

    def __init__(self, monkeypatch, moment: datetime):
        self.moment = moment
        monkeypatch.setattr(seasons, "to_vienna", lambda now=None: REAL_TO_VIENNA(now if now is not None else self.moment))
        for module in (counters, easter, raffles):
            monkeypatch.setattr(module, "now_utc", lambda: self.moment.astimezone(timezone.utc))

    def set(self, moment: datetime) -> None:
        self.moment = moment

    def tick(self, seconds: float) -> None:
        self.moment = self.moment + timedelta(seconds=seconds)


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


PRIZES = [
    {"kind": "raffle_all", "label": "TLS-Hoodie", "value": "50 €", "winners": 1},
    {"kind": "fastest_1", "label": "Gaming-Maus"},
    {"kind": "fastest_2", "label": "Mauspad"},
]


async def setup_hunt(flow, staff, year=2027, web=3, app=1, status="live", prizes=PRIZES):
    """Ein Jahr mit wenigen Eiern: der Vorschlag, übernommen, dann freigegeben."""
    flow.act_as(staff)
    res = await flow.post(f"/api/seasonal/easter/admin/{year}/propose", json={"web": web, "app": app})
    assert res.status_code == 200, res.text
    eggs = res.json()["eggs"]
    res = await flow.put(f"/api/seasonal/easter/admin/{year}/eggs", json={"eggs": eggs})
    assert res.status_code == 200, res.text
    res = await flow.put(f"/api/seasonal/easter/admin/{year}", json={"status": status, "prizes": prizes})
    assert res.status_code == 200, res.text
    return eggs


async def tokens_for(flow, egg, user):
    flow.act_as(user)
    res = await flow.get("/api/seasonal/easter/eggs", params={"route": egg["route"], "channel": egg["channel"]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["active"] is True
    return {row["egg_no"]: row for row in body["eggs"]}


async def find(flow, egg, user, clock=None):
    if clock:
        clock.tick(4)
    token = (await tokens_for(flow, egg, user))[egg["egg_no"]]["token"]
    flow.act_as(user)
    return await flow.post("/api/seasonal/easter/find", json={"token": token})


# ------------------------------------------------------------------ Verteilung

def test_vorschlag_je_jahr_fest_jedes_jahr_anders_und_hoechstens_zwei_je_seite():
    first = easter.propose(2027)
    assert first == easter.propose(2027)
    assert first != easter.propose(2028)
    assert [egg["egg_no"] for egg in first] == list(range(1, 13))
    assert sum(egg["channel"] == "web" for egg in first) == 8 and sum(egg["channel"] == "app" for egg in first) == 4
    for egg in first:
        assert egg["route"] in (easter.WEB_ROUTES if egg["channel"] == "web" else easter.APP_ROUTES)
        assert egg["spot"]["kind"] in easter.SPOT_KINDS[egg["channel"]]
        assert egg["hint"].startswith("Schau")
    per_route = {}
    for egg in first:
        per_route[egg["route"]] = per_route.get(egg["route"], 0) + 1
    assert max(per_route.values()) <= 2
    assert len({egg["pattern"] for egg in first}) == 12


def test_suchzeitraum_karfreitag_bis_ostermontag():
    start, end = easter.window(2027)
    assert start.isoformat() == "2027-03-26T00:00:00+01:00"
    assert end.date().isoformat() == "2027-03-29" and end.hour == 23


# ------------------------------------------------------------------ Eier je Seite

@pytest.mark.asyncio
async def test_eier_nur_waehrend_der_suche_und_nur_die_der_seite(flow, monkeypatch):
    clock = Clock(monkeypatch, vienna(2027, 3, 20))
    staff = await flow.add_staff("Redaktion")
    eggs = await setup_hunt(flow, staff)
    web_egg = next(egg for egg in eggs if egg["channel"] == "web")
    flow.act_as(None)
    res = await flow.get("/api/seasonal/easter/eggs", params={"route": web_egg["route"], "channel": "web"})
    assert res.json() == {"active": False, "eggs": []}, "vor Karfreitag liegt nichts"

    clock.set(vienna(2027, 3, 26, 9))
    res = await flow.get("/api/seasonal/easter/eggs", params={"route": web_egg["route"] + "/", "channel": "web"})
    body = res.json()
    assert body["active"] and body["guest"] is True and body["total"] == 4
    expected = sorted(egg["egg_no"] for egg in eggs if egg["route"] == web_egg["route"] and egg["channel"] == "web")
    assert [row["egg_no"] for row in body["eggs"]] == expected, "nur die Eier dieser Seite"
    assert all(set(row) == {"egg_no", "spot", "pattern", "token", "found"} for row in body["eggs"]), "kein Hinweis, keine Route, kein Geheimnis"

    # Gäste sehen Eier, finden aber nichts.
    res = await flow.post("/api/seasonal/easter/find", json={"token": body["eggs"][0]["token"]})
    assert res.status_code == 401

    # Ein Entwurf liefert nichts, und eine abgeschaltete Saison auch nicht.
    flow.act_as(staff)
    await flow.put("/api/seasonal/easter/admin/2027", json={"status": "draft"})
    flow.act_as(None)
    assert (await flow.get("/api/seasonal/easter/eggs", params={"route": web_egg["route"]})).json()["active"] is False


@pytest.mark.asyncio
async def test_vorschau_zeigt_die_eier_der_seite_auch_im_entwurf_aber_ohne_schluessel(flow, monkeypatch):
    clock = Clock(monkeypatch, vienna(2027, 3, 10))
    staff = await flow.add_staff("Redaktion")
    eggs = await setup_hunt(flow, staff, status="draft")
    web_egg = next(egg for egg in eggs if egg["channel"] == "web")
    flow.act_as(None)
    params = {"route": web_egg["route"], "channel": "web"}
    assert (await flow.get("/api/seasonal/easter/eggs", params=params)).json()["active"] is False, "ohne Vorschau: Entwurf, vor Karfreitag"

    # Das Token aus dem Admin (Vorschau 60 Sekunden), auch mit simulierter Zeit am Karsamstag.
    for at_time in (None, vienna(2027, 3, 27, 11)):
        token = seasons.preview_token(easter.SEASON, at_time=at_time)
        body = (await flow.get("/api/seasonal/easter/eggs", params={**params, "preview": token})).json()
        assert body["preview"] is True and body["active"] is True and body["year"] == 2027
        expected = sorted(egg["egg_no"] for egg in eggs if egg["route"] == web_egg["route"] and egg["channel"] == "web")
        assert [row["egg_no"] for row in body["eggs"]] == expected, "nur die Eier dieser Seite"
        assert all(row["token"] == "" and row["hint"] for row in body["eggs"]), "Hinweis zum Prüfen, aber kein Schlüssel"

    # Ein Token einer anderen Saison oder ein gefälschtes zählt nicht.
    other = seasons.preview_token("easter")
    assert (await flow.get("/api/seasonal/easter/eggs", params={**params, "preview": other})).json()["active"] is False
    assert (await flow.get("/api/seasonal/easter/eggs", params={**params, "preview": "easter_hunt.1.2.x"})).json()["active"] is False
    # Nach Ostermontag zeigt die Vorschau das nächste Jahr.
    clock.set(vienna(2027, 4, 2))
    assert easter.preview_year() == 2028

    # Das Token für die Verwaltung (Redaktion oder Verein): Karsamstag mittags, nur mit Rechten.
    flow.act_as(staff)
    res = await flow.post("/api/seasonal/easter/admin/2027/preview")
    assert res.status_code == 200, res.text
    assert res.json()["at"].startswith("2027-03-27T12:00") and seasons.read_preview_token(res.json()["token"])[0] == easter.SEASON
    bad = await flow.post("/api/seasonal/easter/admin/1999/preview")
    assert bad.status_code == 400 and "Jahr" in bad.json()["detail"], "ein unmögliches Jahr ist ein klarer Fehler, kein Absturz"
    flow.act_as(None)
    assert (await flow.post("/api/seasonal/easter/admin/2027/preview")).status_code == 401


# ------------------------------------------------------------------ Fund

@pytest.mark.asyncio
async def test_fund_einmal_nicht_zu_schnell_nur_mit_eigenem_frischem_schluessel(flow, monkeypatch):
    clock = Clock(monkeypatch, vienna(2027, 3, 26, 10))
    staff = await flow.add_staff("Redaktion")
    paula = await flow.add_user(name="Paula")
    kai = await flow.add_user(name="Kai")
    eggs = await setup_hunt(flow, staff, web=3, app=0)
    first, second, third = eggs

    res = await find(flow, first, paula)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["found"] == 1 and body["total"] == 3 and body["first"] is True and body["already"] is False
    assert body["egg"]["egg_no"] == first["egg_no"]

    res = await find(flow, first, paula)
    assert res.status_code == 200 and res.json()["already"] is True and res.json()["found"] == 1, "derselbe Fund zählt einmal"

    res = await find(flow, second, paula)
    assert res.status_code == 429, "nicht schneller als alle drei Sekunden"
    res = await find(flow, second, paula, clock)
    assert res.status_code == 200 and res.json()["found"] == 2

    # Ein fremder Schlüssel gilt nicht.
    clock.tick(4)
    foreign = (await tokens_for(flow, third, kai))[third["egg_no"]]["token"]
    flow.act_as(paula)
    assert (await flow.post("/api/seasonal/easter/find", json={"token": foreign})).status_code == 403
    # Ein alter Schlüssel verfällt nach 15 Minuten.
    old = (await tokens_for(flow, third, paula))[third["egg_no"]]["token"]
    clock.tick(16 * 60)
    flow.act_as(paula)
    assert (await flow.post("/api/seasonal/easter/find", json={"token": old})).status_code == 410
    # Ein veränderter Schlüssel ist keiner.
    egg_no, expires, signature = old.split(".")
    assert (await flow.post("/api/seasonal/easter/find", json={"token": f"{egg_no}.{expires}.{'0' * 32}"})).status_code == 403
    assert (await flow.post("/api/seasonal/easter/find", json={"token": "1.2.kaputt-und-zu-kurz"})).status_code == 400

    # Nach Ostermontag zählt nichts mehr.
    fresh = (await tokens_for(flow, third, paula))[third["egg_no"]]["token"]
    clock.set(vienna(2027, 3, 30, 0, 5))
    flow.act_as(paula)
    assert (await flow.post("/api/seasonal/easter/find", json={"token": fresh})).status_code == 409


# ------------------------------------------------------------------ Korb, Platz, Verlosung, Erfolge

@pytest.mark.asyncio
async def test_voller_korb_platz_verlosung_fundstuecke_und_eierkoenig(flow, monkeypatch):
    clock = Clock(monkeypatch, vienna(2027, 3, 26, 8))
    staff = await flow.add_staff("Redaktion")
    paula = await flow.add_user(name="Paula")
    kai = await flow.add_user(name="Kai")
    await flow.db.users.update_many({"id": {"$in": [paula["id"], kai["id"]]}}, {"$set": {"privacy_public_profile": True}})
    await flow.db.users.update_one({"id": kai["id"]}, {"$set": {"privacy_achievements_public": False}})
    eggs = await setup_hunt(flow, staff, web=2, app=1)

    for egg in eggs:
        res = await find(flow, egg, paula, clock)
        assert res.status_code == 200, res.text
    last = res.json()
    assert last["found"] == 3 and last["completed_now"] is True and last["rank"] == 1
    clock.tick(3600)
    for egg in eggs:
        res = await find(flow, egg, kai, clock)
    assert res.json()["rank"] == 2

    # Beide sind in der Verlosung, ohne extra Klick.
    raffle = await raffles.for_source(flow.db, easter.raffle_key(2027))
    assert raffle and await raffles.entry_count(flow.db, raffle["id"]) == 2

    # Die Schnellsten zeigen nur, wer Profil und Erfolge öffentlich hat - der Platz zählt unter allen.
    flow.act_as(None)
    page = (await flow.get("/api/seasonal/easter/page")).json()
    assert page["phase"] == "running" and page["completed"] == 2 and page["egg_count"] == 3
    assert [(row["rank"], row["display_name"]) for row in page["fastest"]] == [(1, "Paula")]
    assert page["me"] is None and any("Verlosung" in line for line in page["terms"])

    # Fundstücke und Erfolge: „Erstes Ei“ (geheim) und „Eierkönig“ (legendär).
    signals = await flow.db[counters.SIGNALS].find_one({"user_id": paula["id"], "name": "easter_egg"}) or {}
    assert int(signals.get("count") or 0) == 3
    earned = {row["tier_code"] async for row in flow.db.user_achievements.find({"user_id": paula["id"]}, {"_id": 0, "tier_code": 1})}
    assert {"first_egg_1", "egg_king_1"} <= earned, earned


@pytest.mark.asyncio
async def test_hinweise_erst_nach_einem_tag_und_nur_fuer_fehlende(flow, monkeypatch):
    clock = Clock(monkeypatch, vienna(2027, 3, 26, 9))
    staff = await flow.add_staff("Redaktion")
    paula = await flow.add_user(name="Paula")
    eggs = await setup_hunt(flow, staff, web=3, app=0)
    await find(flow, eggs[0], paula, clock)
    flow.act_as(paula)
    mine = (await flow.get("/api/seasonal/easter/me")).json()
    assert mine["found"] == 1 and mine["missing"] == 2 and mine["hints_open"] is False and mine["hints"] == []
    assert mine["eggs"][0]["egg_no"] == eggs[0]["egg_no"] and mine["eggs"][0]["pattern"] == eggs[0]["pattern"]

    clock.set(vienna(2027, 3, 27, 9))
    mine = (await flow.get("/api/seasonal/easter/me")).json()
    assert mine["hints_open"] is True
    assert [row["hint"] for row in mine["hints"]] == [eggs[1]["hint"], eggs[2]["hint"]]


@pytest.mark.asyncio
async def test_auswertung_erst_nach_ostermontag_verlosung_und_die_schnellsten(flow, monkeypatch):
    clock = Clock(monkeypatch, vienna(2027, 3, 26, 8))
    staff = await flow.add_staff("Redaktion")
    people = [await flow.add_user(name=name) for name in ("Paula", "Kai", "Mia", "Ben")]
    eggs = await setup_hunt(flow, staff, web=2, app=0)
    for person in people:
        clock.tick(600)
        for egg in eggs:
            assert (await find(flow, egg, person, clock)).status_code == 200

    flow.act_as(staff)
    res = await flow.post("/api/seasonal/easter/admin/2027/draw")
    assert res.status_code == 409, "erst nach Ostermontag"

    clock.set(vienna(2027, 3, 30, 9))
    res = await flow.post("/api/seasonal/easter/admin/2027/draw")
    assert res.status_code == 200, res.text
    view = res.json()
    assert view["status"] == "drawn" and view["phase"] == "drawn"
    assert [(row["name"], row["kind"]) for row in view["fastest_awarded"]] == [("Paula", "fastest_1"), ("Kai", "fastest_2")]
    assert view["raffle"]["status"] == "drawn" and len(view["raffle"]["protocol"][0]["winners"]) == 1
    pickups = await flow.db.prize_pickups.find({"season_key": "easter_hunt"}, {"_id": 0}).to_list(10)
    assert {p["prize_label"] for p in pickups} >= {"Gaming-Maus", "Mauspad", "TLS-Hoodie"}
    notes = await flow.db.notifications.count_documents({"kind": "prize_pending"})
    assert notes == 3
    assert (await flow.post("/api/seasonal/easter/admin/2027/draw")).status_code == 409

    # Nach der Auswertung steht die Seite auf „ausgewertet“ - ohne Gewinnernamen.
    flow.act_as(None)
    page = (await flow.get("/api/seasonal/easter/page")).json()
    assert page["phase"] == "drawn"
    assert "Kai" not in str({k: v for k, v in page.items() if k != "fastest"})


@pytest.mark.asyncio
async def test_verstecke_bleiben_nach_dem_ersten_fund_und_pflege_braucht_rechte(flow, monkeypatch):
    clock = Clock(monkeypatch, vienna(2027, 3, 26, 9))
    staff = await flow.add_staff("Redaktion")
    paula = await flow.add_user(name="Paula")
    eggs = await setup_hunt(flow, staff, web=2, app=0)
    flow.act_as(paula)
    assert (await flow.get("/api/seasonal/easter/admin/2027")).status_code == 403
    assert (await flow.put("/api/seasonal/easter/admin/2027/eggs", json={"eggs": eggs})).status_code == 403
    await find(flow, eggs[0], paula, clock)
    flow.act_as(staff)
    res = await flow.put("/api/seasonal/easter/admin/2027/eggs", json={"eggs": eggs})
    assert res.status_code == 409
    view = (await flow.get("/api/seasonal/easter/admin/2027")).json()
    assert view["started"] == 1 and view["completed"] == 0
    assert {row["egg_no"]: row["found"] for row in view["eggs"]} == {1: 1, 2: 0}
    csv_text = (await flow.get("/api/seasonal/easter/admin/2027/participants.csv")).text
    assert "Paula" in csv_text and "Gefunden" in csv_text


@pytest.mark.asyncio
async def test_pruefung_der_verstecke_und_preise(flow, monkeypatch):
    Clock(monkeypatch, vienna(2027, 2, 1))
    staff = await flow.add_staff("Redaktion")
    flow.act_as(staff)
    bad_route = [{"channel": "web", "route": "/admin", "spot": {"kind": "card", "index": 0, "place": "top-left"}}]
    assert (await flow.put("/api/seasonal/easter/admin/2027/eggs", json={"eggs": bad_route})).status_code == 400
    twice = [{"channel": "web", "route": "/news", "spot": {"kind": "card", "index": 1, "place": "top-left"}}] * 2
    res = await flow.put("/api/seasonal/easter/admin/2027/eggs", json={"eggs": twice})
    assert res.status_code == 400 and "derselben Stelle" in res.json()["detail"]
    assert (await flow.put("/api/seasonal/easter/admin/2027", json={"status": "live"})).status_code == 400, "ohne Eier keine Freigabe"
    res = await flow.put("/api/seasonal/easter/admin/2027", json={"prizes": [{"kind": "fastest_1", "label": ""}]})
    assert res.status_code == 400
    # Ohne Preis „Verlosung“ gibt es keine Verlosung.
    one = [{"channel": "app", "route": "app:Dashboard", "spot": {"kind": "card", "index": 0, "place": "top-right"}, "hint": "Gleich auf Home."}]
    assert (await flow.put("/api/seasonal/easter/admin/2027/eggs", json={"eggs": one})).status_code == 200
    view = (await flow.put("/api/seasonal/easter/admin/2027", json={"status": "live", "prizes": []})).json()
    assert view["status"] == "live" and view["raffle"] is None and view["eggs"][0]["hint"] == "Gleich auf Home."


@pytest.mark.asyncio
async def test_seite_ohne_suche_nennt_den_naechsten_start(flow, monkeypatch):
    Clock(monkeypatch, vienna(2026, 10, 3))
    flow.act_as(None)
    page = (await flow.get("/api/seasonal/easter/page")).json()
    assert page == {"phase": "none", "next_start": "2027-03-26T00:00:00+01:00"}


@pytest.mark.asyncio
async def test_vorschau_ohne_angelegtes_jahr_legt_platzhalter_auf_jede_seite(flow, monkeypatch):
    """#964: Die Vorschau zeigt die Suche auch, bevor die Verwaltung ein Jahr angelegt hat - drei Platzhalter je Seite,
    mit hohen Nummern und dem Hinweis, wo das Jahr angelegt wird. Sobald es Eier gibt, liegen nur noch die echten da."""
    Clock(monkeypatch, vienna(2026, 10, 6, 9))
    flow.act_as(None)
    saturday = vienna(2027, 3, 27, 12)
    token = seasons.preview_token(easter.SEASON, at_time=saturday)
    home = (await flow.get("/api/seasonal/easter/eggs", params={"route": "/", "channel": "web", "preview": token})).json()
    assert home["active"] is True and home["preview"] is True and home["placeholder"] is True and home["year"] == 2027
    assert [egg["egg_no"] for egg in home["eggs"]] == [101, 102, 103] and home["total"] == easter.PLACEHOLDER_TOTAL
    assert all(egg["token"] == "" and "Platzhalter" in egg["hint"] and egg["spot"]["kind"] in easter.SPOT_KINDS["web"] for egg in home["eggs"])
    # Dieselbe Seite, dieselben Verstecke - eine andere Seite eigene.
    again = (await flow.get("/api/seasonal/easter/eggs", params={"route": "/", "channel": "web", "preview": token})).json()
    assert again["eggs"] == home["eggs"]
    news = (await flow.get("/api/seasonal/easter/eggs", params={"route": "/news", "channel": "web", "preview": token})).json()
    assert news["placeholder"] is True and [egg["spot"] for egg in news["eggs"]] != [egg["spot"] for egg in home["eggs"]]
    # Ohne Token bleibt es dabei: im Oktober keine Eier.
    assert (await flow.get("/api/seasonal/easter/eggs", params={"route": "/", "channel": "web"})).json()["active"] is False

    # Mit angelegtem Jahr (auch im Entwurf): nur die echten Eier; eine Seite ohne Ei bleibt in der Vorschau leer.
    staff = await flow.add_staff("Redaktion")
    eggs = await setup_hunt(flow, staff, status="draft")
    flow.act_as(None)
    web_egg = next(egg for egg in eggs if egg["channel"] == "web")
    real = (await flow.get("/api/seasonal/easter/eggs", params={"route": web_egg["route"], "channel": "web", "preview": token})).json()
    assert real["placeholder"] is False and all(egg["egg_no"] < 100 for egg in real["eggs"]) and real["total"] == len(eggs)
    unused = next(route for route in easter.WEB_ROUTES if route not in {egg["route"] for egg in eggs})
    empty = (await flow.get("/api/seasonal/easter/eggs", params={"route": unused, "channel": "web", "preview": token})).json()
    assert empty["active"] is True and empty["placeholder"] is False and empty["eggs"] == []

