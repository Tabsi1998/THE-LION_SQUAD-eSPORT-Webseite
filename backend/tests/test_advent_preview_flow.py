"""Adventkalender in der Vorschau (#963): „Vorschau 60 Sekunden“ simuliert außerhalb der Saison den 12. Dezember zu
Mittag, der Einstieg steht auch ohne angelegte Türchen da, der Kalender zeigt dann Platzhalter - und nichts davon wird
gezählt: kein Öffnen, kein Quiz, keine Teilnahme. Ein fremdes Token ändert nichts."""
import pathlib
import sys
from datetime import datetime, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import advent_calendar as advent  # noqa: E402
from services import seasons  # noqa: E402

REAL_TO_VIENNA = seasons.to_vienna
VIENNA = seasons.VIENNA
QUIZ = {"question": "Wie viele Kerzen hat der Adventkranz?", "answers": ["Drei", "Vier", "Fünf"], "correct": 1, "explanation": "Eine je Adventsonntag."}


def vienna(year, month, day, hour=12, minute=0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=VIENNA)


def set_clock(monkeypatch, moment: datetime):
    monkeypatch.setattr(seasons, "to_vienna", lambda now=None: REAL_TO_VIENNA(now if now is not None else moment))
    monkeypatch.setattr(advent, "now_utc", lambda: moment.astimezone(timezone.utc))


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def preview_token(flow, admin, at=None) -> dict:
    flow.act_as(admin)
    res = await flow.post("/api/settings/seasons/advent_calendar/preview", json={"at": at} if at else {})
    assert res.status_code == 200, res.text
    return res.json()


def test_die_vorgabe_zeit_liegt_mitten_in_der_saison(monkeypatch):
    set_clock(monkeypatch, vienna(2026, 10, 6, 9))
    assert seasons.preview_default_at("advent_calendar").isoformat() == "2026-12-12T12:00:00+01:00"
    assert seasons.preview_default_at("easter_hunt").isoformat() == "2027-03-27T12:00:00+01:00", "Karsamstag 2027"
    # Mitten im Advent gilt die echte Zeit; die Deko-Saisons brauchen keine Vorgabe.
    set_clock(monkeypatch, vienna(2026, 12, 20, 9))
    assert seasons.preview_default_at("advent_calendar") is None
    assert seasons.preview_default_at("advent") is None and seasons.preview_default_at("snow") is None


@pytest.mark.asyncio
async def test_die_vorschau_zeigt_den_kalender_im_oktober_mit_platzhaltern_und_zaehlt_nichts(flow, monkeypatch):
    admin = await flow.add_user(role="superadmin", name="admin")
    set_clock(monkeypatch, vienna(2026, 10, 6, 9))
    token = await preview_token(flow, admin)
    assert token["at"] == "2026-12-12T12:00:00+01:00"

    # Der Einstieg neben dem Logo steht in der Vorschau auch ohne Türchen - Türchen 12 ist offen.
    flow.act_as(None)
    active = (await flow.get("/api/seasonal/active", params={"preview": token["token"]})).json()
    calendar_season = next(season for season in active["seasons"] if season["key"] == "advent_calendar")
    assert active["preview"] is True and calendar_season["data"]["ready"] is True and calendar_season["data"]["today_door"] == 12

    # Der Kalender: 24 Platzhalter, zwölf offen, zwölf zu - wie ein Gast, nichts gespeichert.
    view = (await flow.get("/api/seasonal/advent", params={"preview": token["token"]})).json()
    assert view["active"] is True and view["preview"] is True and view["placeholder"] is True and view["year"] == 2026
    assert view["newest_door"] == 12 and view["signed_in"] is False and view["opened"] == 0
    assert [door["state"] for door in view["doors"]] == ["available"] * 12 + ["locked"] * 12

    opened = await flow.post("/api/seasonal/advent/5/open", params={"preview": token["token"]})
    assert opened.status_code == 200, opened.text
    assert opened.json()["preview"] is True and opened.json()["counted"] is False and opened.json()["content"]["title"] == "Türchen 5"
    assert opened.json()["content"]["fallback"] is True
    locked = await flow.post("/api/seasonal/advent/20/open", params={"preview": token["token"]})
    assert locked.status_code == 409 and locked.json()["detail"] == "Dieses Türchen öffnet sich am 20. Dezember um 6 Uhr."
    assert await flow.db[advent.OPENINGS].count_documents({}) == 0 and await flow.db[advent.VIEWS].count_documents({}) == 0

    # Was die Seite als offen nennt, kommt mit Inhalt zurück - auch das zählt nicht.
    again = (await flow.get("/api/seasonal/advent", params={"preview": token["token"], "opened": "5,7"})).json()
    assert [door["state"] for door in again["doors"][:8]] == ["available"] * 4 + ["opened", "available", "opened", "available"]
    assert again["doors"][4]["content"]["title"] == "Türchen 5" and again["opened"] == 2

    # Ohne Token: Oktober, kein Kalender. Ein Token einer anderen Saison zählt nicht.
    assert (await flow.get("/api/seasonal/advent")).json()["active"] is False
    other = seasons.preview_token("snow")
    assert (await flow.get("/api/seasonal/advent", params={"preview": other})).json()["active"] is False


@pytest.mark.asyncio
async def test_angelegte_tuerchen_und_das_quiz_in_der_vorschau_und_keine_teilnahme(flow, monkeypatch):
    admin = await flow.add_user(role="superadmin", name="admin")
    staff = await flow.add_staff("Redaktion")
    set_clock(monkeypatch, vienna(2026, 10, 6, 9))
    flow.act_as(staff)
    assert (await flow.put("/api/seasonal/advent/admin/2026/3", json={"kind": "quiz", "title": "Kranz-Quiz", "body": "", "quiz": QUIZ})).status_code == 200
    assert (await flow.put("/api/seasonal/advent/admin/2026/4", json={"kind": "text", "title": "Vierter", "body": "Geheimer Text"})).status_code == 200
    token = (await preview_token(flow, admin))["token"]

    paula = await flow.add_user(role="player", name="paula")
    flow.act_as(paula)
    view = (await flow.get("/api/seasonal/advent", params={"preview": token, "opened": "3,4"})).json()
    assert view["placeholder"] is False and view["signed_in"] is False, "in der Vorschau schaut auch ein Konto wie ein Gast"
    assert view["doors"][2]["content"]["quiz"]["done"] is False and view["doors"][3]["content"]["body"] == "Geheimer Text"
    answered = await flow.post("/api/seasonal/advent/3/quiz", params={"preview": token}, json={"answer": 1})
    assert answered.status_code == 200 and answered.json()["correct"] is True and answered.json()["preview"] is True
    no_quiz = await flow.post("/api/seasonal/advent/4/quiz", params={"preview": token}, json={"answer": 0})
    assert no_quiz.status_code == 404
    entered = await flow.post("/api/seasonal/advent/4/enter", params={"preview": token})
    assert entered.status_code == 409 and "Vorschau" in entered.json()["detail"]
    assert await flow.db[advent.OPENINGS].count_documents({}) == 0, "nichts gezählt, auch nicht für das Konto"

    # Eine gewählte Zeit gilt: am 2. Dezember zu Mittag sind nur zwei Türchen offen.
    chosen = await preview_token(flow, admin, at="2026-12-02T12:00")
    assert chosen["at"] == "2026-12-02T12:00:00+01:00"
    flow.act_as(None)
    early = (await flow.get("/api/seasonal/advent", params={"preview": chosen["token"]})).json()
    assert early["newest_door"] == 2 and [door["state"] for door in early["doors"][:3]] == ["available", "available", "locked"]
