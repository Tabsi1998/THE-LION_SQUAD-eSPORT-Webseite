"""Jahreszeiten (#632): Ostern, Adventsonntage und Fasching aus Formeln, Phasen an den Rändern in
Europe/Vienna (auch am Tag der Zeitumstellung), die Silvester-Rampe wie in der Tabelle, Admin-Schalter
mit Erzwingen und Protokoll, die öffentliche Abfrage gecacht und ohne Anmeldung, die Vorschau nur für
den, der das Token hat, und der persönliche Schalter am Konto."""
import pathlib
import sys
from datetime import date, datetime, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import seasons  # noqa: E402

V = seasons.VIENNA


def at(*args):
    return datetime(*args, tzinfo=V)


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


# ------------------------------------------------------------------ Formeln

def test_ostern_advent_fasching_aus_formeln():
    assert [seasons.easter_sunday(y) for y in (2026, 2027, 2028, 2029, 2030)] == [
        date(2026, 4, 5), date(2027, 3, 28), date(2028, 4, 16), date(2029, 4, 1), date(2030, 4, 21)]
    assert [seasons.first_advent(y) for y in (2026, 2027, 2028, 2029)] == [date(2026, 11, 29), date(2027, 11, 28), date(2028, 12, 3), date(2029, 12, 2)]
    # Fällt der 24.12. auf einen Sonntag (2028), ist er selbst der 4. Advent.
    assert seasons.fourth_advent(2028) == date(2028, 12, 24)
    assert seasons.carnival_tuesday(2027) == date(2027, 2, 9)
    assert seasons.carnival_tuesday(2028) == date(2028, 2, 29)
    assert seasons.palm_sunday(2027) == date(2027, 3, 21)
    assert seasons.good_friday(2027) == date(2027, 3, 26)
    assert seasons.easter_monday(2027) == date(2027, 3, 29)


def test_kerzen_je_adventsonntag():
    assert seasons.candles_lit(date(2026, 11, 28)) == 0
    assert seasons.candles_lit(date(2026, 11, 29)) == 1
    assert seasons.candles_lit(date(2026, 12, 5)) == 1
    assert seasons.candles_lit(date(2026, 12, 6)) == 2
    assert seasons.candles_lit(date(2026, 12, 20)) == 4
    assert seasons.candles_lit(date(2026, 12, 26)) == 4


# ------------------------------------------------------------------ Phasen an den Rändern

def keys(payload):
    return {s["key"]: s for s in payload["seasons"]}


def test_halloween_fenster_auch_am_tag_der_zeitumstellung():
    # 25.10.2026 ist der Tag, an dem die Sommerzeit endet - das Fenster beginnt trotzdem um Mitternacht.
    assert "halloween" not in keys(seasons.active(at(2026, 10, 24, 23, 59, 59), {}))
    assert keys(seasons.active(at(2026, 10, 25, 0, 0, 1), {}))["halloween"]["phase"] == "deko"
    assert keys(seasons.active(at(2026, 10, 25, 2, 30), {}))["halloween"]["data"]["night"] is True
    assert keys(seasons.active(at(2026, 10, 31, 12, 0), {}))["halloween"]["data"]["night"] is False
    assert keys(seasons.active(at(2026, 11, 1, 23, 59, 59), {}))["halloween"]["starts_at"] == "2026-10-25T00:00:00+02:00"
    assert "halloween" not in keys(seasons.active(at(2026, 11, 2, 0, 0, 0), {}))
    # Eine Zeit in UTC wird nach Wien umgerechnet: 23:30 UTC am 24.10. ist schon der 25.10. in Wien.
    assert "halloween" in keys(seasons.active(datetime(2026, 10, 24, 23, 30, tzinfo=timezone.utc), {}))


def test_advent_schnee_weihnachten_und_dreikoenig():
    first = keys(seasons.active(at(2026, 11, 29, 8), {}))
    assert first["advent"]["data"]["candles"] == 1 and first["snow"]["phase"] == "schnee"
    assert first["advent"]["data"]["days_to_christmas"] == 25
    assert "christmas" not in first and "advent_calendar" not in first
    dec24 = keys(seasons.active(at(2026, 12, 24, 18), {}))
    assert dec24["christmas"]["phase"] == "gruss" and dec24["advent"]["data"]["candles"] == 4
    assert dec24["advent_calendar"]["data"]["today_door"] == 24
    assert dec24["christmas"]["texts"]["greeting"] == "Frohe Weihnachten wünscht THE LION SQUAD"
    dec27 = keys(seasons.active(at(2026, 12, 27, 12), {}))
    assert "advent" not in dec27 and "christmas" not in dec27 and dec27["snow"]["data"]["snowcap_stage"] == 3
    jan6 = keys(seasons.active(at(2027, 1, 6, 12), {}))
    assert jan6["christmas"]["phase"] == "abschied" and jan6["snow"]["phase"] == "schnee" and jan6["advent_calendar"]["data"]["catch_up"] is True
    assert "snow" not in keys(seasons.active(at(2027, 1, 7, 0, 0, 1), {}))
    assert keys(seasons.active(at(2026, 12, 6, 9), {}))["nikolaus"]["phase"] == "stiefel"
    assert keys(seasons.active(at(2026, 12, 3, 9), {}))["advent_calendar"]["data"]["today_door"] == 3


def test_silvester_rampe_wie_in_der_tabelle():
    def rate(when):
        state = keys(seasons.active(when, {})).get("new_year")
        return state["data"]["rate_per_hour"] if state else None

    assert rate(at(2026, 12, 29, 12)) is None, "untertags nichts"
    assert rate(at(2026, 12, 29, 19)) == {"min": 1, "max": 2}
    assert rate(at(2026, 12, 30, 19)) == {"min": 3, "max": 6}
    assert rate(at(2026, 12, 30, 22, 30)) == {"min": 5, "max": 6}
    assert rate(at(2026, 12, 31, 17, 59)) is None
    assert rate(at(2026, 12, 31, 18)) == {"min": 6, "max": 10}
    assert rate(at(2026, 12, 31, 22)) == {"min": 12, "max": 20}
    assert rate(at(2026, 12, 31, 23, 30)) == {"min": 20, "max": 40}
    assert keys(seasons.active(at(2026, 12, 31, 23, 50), {}))["new_year"]["phase"] == "pre_countdown"
    countdown = keys(seasons.active(at(2026, 12, 31, 23, 59, 10), {}))["new_year"]
    assert countdown["phase"] == "countdown" and countdown["data"]["show_start"] == "2027-01-01T00:00:00+01:00"
    show = keys(seasons.active(at(2027, 1, 1, 0, 5), {}))["new_year"]
    assert show["phase"] == "show" and show["data"]["rate_per_hour"]["min"] >= 720
    fade = keys(seasons.active(at(2027, 1, 1, 0, 30), {}))["new_year"]
    assert fade["phase"] == "fade" and 12 <= fade["data"]["rate_per_hour"]["max"] < 60
    greeting = keys(seasons.active(at(2027, 1, 1, 12), {}))["new_year"]
    assert greeting["phase"] == "greeting" and greeting["data"]["rate_per_hour"] == {"min": 0, "max": 0}
    assert greeting["texts"]["greeting"].startswith("Frohes neues Jahr")
    assert rate(at(2027, 1, 1, 20)) == {"min": 1, "max": 1}
    assert "new_year" not in keys(seasons.active(at(2027, 1, 2, 0, 0, 1), {}))
    # Dieselbe Stunde, derselbe Plan - eine andere Stunde ein anderer.
    a = seasons.new_year_salvos(at(2026, 12, 31, 22, 5))
    b = seasons.new_year_salvos(at(2026, 12, 31, 22, 40))
    assert a == b and 12 <= len(a) <= 20 and all(0 <= s < 3600 for s in a)
    assert seasons.new_year_salvos(at(2026, 12, 31, 21, 5)) != a


def test_ostern_fasching_und_vereinsgeburtstag():
    assert keys(seasons.active(at(2027, 2, 9, 10), {}))["carnival"]["phase"] == "deko"
    assert "carnival" not in keys(seasons.active(at(2027, 2, 10, 10), {}))
    palm = keys(seasons.active(at(2027, 3, 21, 10), {}))
    assert palm["easter"]["phase"] == "deko" and "easter_hunt" not in palm
    friday = keys(seasons.active(at(2027, 3, 26, 10), {}))
    assert friday["easter"]["data"]["quiet"] is True and friday["easter_hunt"]["phase"] == "suche"
    monday = keys(seasons.active(at(2027, 3, 29, 23), {}))
    assert monday["easter"]["data"]["quiet"] is False and "easter_hunt" in monday
    assert "easter" not in keys(seasons.active(at(2027, 3, 30, 0, 0, 1), {}))
    # Vereinsgeburtstag nur mit Gründungsdatum; der Text nennt die Jahre.
    assert "club_birthday" not in keys(seasons.active(at(2027, 5, 12, 10), {}, None))
    birthday = keys(seasons.active(at(2027, 5, 12, 10), {}, "2019-05-12"))["club_birthday"]
    assert birthday["data"]["years"] == 8 and birthday["texts"]["greeting"] == "8 Jahre THE LION SQUAD – danke, dass ihr dabei seid"
    assert seasons.windows_for("club_birthday", 2027, date(2024, 2, 29))[0]["start"].date() == date(2027, 2, 28)


def test_schalter_erzwingen_und_kanaele():
    off = {"seasons": {"halloween": {"enabled": False}}}
    assert "halloween" not in keys(seasons.active(at(2026, 10, 31, 20), off))
    assert "halloween" not in keys(seasons.active(at(2026, 10, 31, 20), {"enabled": False}))
    forced = {"seasons": {"snow": {"mode": "force_on", "until": "2026-09-30T23:59", "intensity": "full", "channels": ["web"]}}}
    snow = keys(seasons.active(at(2026, 9, 29, 12), forced))["snow"]
    assert snow["forced"] is True and snow["intensity"] == "full" and snow["channels"] == ["web"] and snow["phase"] == "schnee"
    assert "snow" not in keys(seasons.active(at(2026, 10, 1, 12), forced)), "abgelaufen = wieder automatisch"
    muted = {"seasons": {"snow": {"mode": "force_off", "until": "2026-12-05T00:00"}}}
    assert "snow" not in keys(seasons.active(at(2026, 12, 1, 12), muted))
    assert "snow" in keys(seasons.active(at(2026, 12, 6, 12), muted))
    # Erzwungenes Silvester zeigt die Show, damit die Vorschau etwas zu sehen hat.
    assert keys(seasons.active(at(2026, 6, 1, 12), {"seasons": {"new_year": {"mode": "force_on"}}}))["new_year"]["phase"] == "show"
    view = seasons.admin_view(forced, at(2026, 9, 29, 12))
    by_key = {s["key"]: s for s in view["seasons"]}
    assert by_key["snow"]["active_now"] and by_key["snow"]["forced"] and by_key["halloween"]["next_start"] == "2026-10-25T00:00:00+02:00"
    assert by_key["club_birthday"]["needs_founded_on"] is True
    assert [row["key"] for row in view["calendar"]][:2] == ["carnival", "easter"]


def test_vorschau_token_nur_gueltig_und_kurz():
    token = seasons.preview_token("halloween", at(2026, 6, 1, 12), at_time=at(2026, 10, 31, 20))
    assert seasons.read_preview_token(token, at(2026, 6, 1, 12, 0, 30)) == ("halloween", at(2026, 10, 31, 20))
    assert seasons.read_preview_token(token, at(2026, 6, 1, 12, 1, 1)) is None, "nach 60 Sekunden vorbei"
    assert seasons.read_preview_token(token[:-1] + ("0" if token[-1] != "0" else "1"), at(2026, 6, 1, 12)) is None
    assert seasons.read_preview_token("halloween.9999999999..abc", at(2026, 6, 1, 12)) is None
    assert seasons.read_preview_token(None) is None


# ------------------------------------------------------------------ Routen

@pytest.mark.asyncio
async def test_oeffentliche_abfrage_ohne_anmeldung_gecacht(flow):
    flow.act_as(None)
    res = await flow.get("/api/seasonal/active")
    assert res.status_code == 200
    body = res.json()
    assert body["timezone"] == "Europe/Vienna" and body["enabled"] is True and isinstance(body["seasons"], list)
    assert res.headers["cache-control"] == "public, max-age=60" and res.headers.get("etag")
    again = await flow.get("/api/seasonal/active", headers={"If-None-Match": res.headers["etag"]})
    assert again.status_code == 304
    for season in body["seasons"]:
        assert set(season) == {"key", "label", "phase", "intensity", "channels", "texts", "starts_at", "ends_at", "forced", "data"}
    cal = await flow.get("/api/seasonal/calendar?year=2027")
    assert cal.status_code == 200 and cal.json()["year"] == 2027
    assert {row["key"] for row in cal.json()["items"]} >= {"halloween", "advent", "new_year", "easter", "carnival"}
    assert "club_birthday" not in {row["key"] for row in cal.json()["items"]}, "ohne Gründungsdatum kein Geburtstag"


@pytest.mark.asyncio
async def test_admin_schaltet_und_protokolliert(flow):
    admin = await flow.add_user(role="club_admin", name="Vorstand")
    flow.act_as(None)
    assert (await flow.get("/api/settings/seasons")).status_code == 401
    flow.act_as(admin)
    view = (await flow.get("/api/settings/seasons")).json()
    assert view["enabled"] is True and len(view["seasons"]) == len(seasons.SEASONS)
    res = await flow.put("/api/settings/seasons", json={"seasons": {"halloween": {"mode": "force_on", "intensity": "full", "texts": {"greeting": "  Buh!  "}}}})
    assert res.status_code == 200
    halloween = next(s for s in res.json()["seasons"] if s["key"] == "halloween")
    assert halloween["mode"] == "force_on" and halloween["active_now"] and halloween["forced"] and halloween["texts"]["greeting"] == "Buh!"
    stored = await flow.db.settings.find_one({"id": "seasons"})
    assert stored["seasons"]["halloween"]["intensity"] == "full"
    logs = await flow.db.audit_logs.find({"action": "settings.seasons.update"}).to_list(10)
    assert len(logs) == 1 and logs[0]["data"]["changed_fields"] == ["seasons.halloween"] and logs[0]["actor_id"] == admin["id"]
    # Öffentlich sichtbar - erzwungen, ohne Cache-Unterschied für andere.
    flow.act_as(None)
    public = (await flow.get("/api/seasonal/active")).json()
    assert [s["key"] for s in public["seasons"] if s["forced"]] == ["halloween"]
    flow.act_as(admin)
    # Leerer Text fällt auf die Vorgabe zurück; unbekannte Saison und unbekannter Text werden abgewiesen.
    res = await flow.put("/api/settings/seasons", json={"seasons": {"halloween": {"texts": {"greeting": ""}}}})
    assert next(s for s in res.json()["seasons"] if s["key"] == "halloween")["texts"]["greeting"] == "Happy Halloween von THE LION SQUAD"
    assert (await flow.put("/api/settings/seasons", json={"seasons": {"sommer": {"enabled": True}}})).status_code == 400
    assert (await flow.put("/api/settings/seasons", json={"seasons": {"snow": {"texts": {"greeting": "x"}}}})).status_code == 400
    assert (await flow.put("/api/settings/seasons", json={"seasons": {"snow": {"until": "morgen"}}})).status_code == 400
    assert (await flow.put("/api/settings/seasons", json={"seasons": {"snow": {"intensity": "laut"}}})).status_code == 422
    # Hauptschalter aus: die öffentliche Antwort ist leer, der Stand bleibt gespeichert.
    res = await flow.put("/api/settings/seasons", json={"enabled": False})
    assert res.json()["enabled"] is False
    flow.act_as(None)
    assert (await flow.get("/api/seasonal/active")).json()["seasons"] == []
    # Drei echte Änderungen (Halloween, Text zurück auf Vorgabe, Hauptschalter) - dieselbe Einstellung
    # noch einmal schreiben legt keinen weiteren Protokolleintrag an.
    flow.act_as(admin)
    await flow.put("/api/settings/seasons", json={"enabled": False})
    assert len(await flow.db.audit_logs.find({"action": "settings.seasons.update"}).to_list(10)) == 3


@pytest.mark.asyncio
async def test_vorschau_nur_mit_token_und_zeit(flow):
    admin = await flow.add_user(role="club_admin", name="Vorstand")
    flow.act_as(admin)
    assert (await flow.post("/api/settings/seasons/sommer/preview", json={})).status_code == 404
    assert (await flow.post("/api/settings/seasons/new_year/preview", json={"at": "irgendwann"})).status_code == 400
    res = await flow.post("/api/settings/seasons/new_year/preview", json={"at": "2026-12-31T23:59:30"})
    assert res.status_code == 200 and res.json()["seconds"] == 60
    token = res.json()["token"]
    flow.act_as(None)
    preview = await flow.get(f"/api/seasonal/active?preview={token}")
    assert preview.status_code == 200 and preview.headers["cache-control"] == "no-store"
    assert preview.json()["preview"] is True
    assert [(s["key"], s["phase"], s["forced"]) for s in preview.json()["seasons"]] == [("new_year", "countdown", True)]
    # Ein kaputtes Token: die normale Antwort, gecacht.
    normal = await flow.get("/api/seasonal/active?preview=kaputt")
    assert normal.json()["preview"] is False and normal.headers["cache-control"] == "public, max-age=60"


@pytest.mark.asyncio
async def test_persoenlicher_schalter_am_konto(flow):
    user = await flow.add_user(name="Spielerin")
    flow.act_as(user)
    res = await flow.patch("/api/users/me", json={"seasonal_decorations": "subtle"})
    assert res.status_code == 200 and res.json()["seasonal_decorations"] == "subtle"
    assert (await flow.patch("/api/users/me", json={"seasonal_decorations": "laut"})).status_code == 422
    stored = await flow.db.users.find_one({"id": user["id"]})
    assert stored["seasonal_decorations"] == "subtle"
