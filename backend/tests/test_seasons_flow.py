"""Jahreszeiten (#632): Ostern, Adventsonntage und Fasching aus Formeln, Phasen an den Rändern in
Europe/Vienna (auch am Tag der Zeitumstellung), die Silvester-Rampe wie in der Tabelle, Admin-Schalter
mit Erzwingen und Protokoll, die öffentliche Abfrage gecacht und ohne Anmeldung, die Vorschau nur für
den, der das Token hat, und der persönliche Schalter am Konto."""
import pathlib
import sys
from datetime import date, datetime, timedelta, timezone

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
    # Faschingsdienstag (#643): 47 Tage vor Ostern - 2028 der Schalttag, 2030 erst im März.
    assert [seasons.carnival_tuesday(y) for y in (2027, 2028, 2029, 2030)] == [
        date(2027, 2, 9), date(2028, 2, 29), date(2029, 2, 13), date(2030, 3, 5)]
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


# ------------------------------------------------------------------ Die Uhr im Test

def test_saison_uhr_steht_im_test_auf_einem_ruhigen_tag(season_clock):
    """Ohne Zeitangabe gilt im Test ein fester, ruhiger Tag (conftest.py) - die Suite hängt nicht am Datum des Laufs.
    Eine mitgegebene Zeit gilt wie immer."""
    assert season_clock == at(2026, 9, 15, 12)
    assert seasons.to_vienna(None) == season_clock and seasons.to_vienna() == season_clock
    assert seasons.active(None, {})["now"] == "2026-09-15T12:00:00+02:00"
    running = [s["key"] for s in seasons.active(None, {})["seasons"]]
    assert all(seasons.runs_all_year(key) for key in running), f"ein Tag ohne Saison mit Termin - nur was das ganze Jahr läuft: {running}"
    assert running == ["weather"]
    assert seasons.to_vienna(datetime(2026, 10, 31, 20, 0)) == at(2026, 10, 31, 20)
    assert seasons.to_vienna(datetime(2026, 12, 31, 23, 0, tzinfo=timezone.utc)) == at(2027, 1, 1, 0)
    assert "halloween" in {s["key"] for s in seasons.active(at(2026, 10, 31, 20), {})["seasons"]}


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
    # Ein Tag, nicht mehr: von 00:00 bis 23:59 Wiener Zeit, in jedem Jahr am berechneten Dienstag.
    for day in (date(2028, 2, 29), date(2029, 2, 13), date(2030, 3, 5)):
        assert "carnival" in keys(seasons.active(at(day.year, day.month, day.day, 0, 1), {}))
        assert "carnival" in keys(seasons.active(at(day.year, day.month, day.day, 23, 58), {}))
        before = day - timedelta(days=1)
        assert "carnival" not in keys(seasons.active(at(before.year, before.month, before.day, 23, 58), {}))
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
    # Erzwungenes Silvester (etwa für eine Vereinsfeier): Raketen wie am späten 31. Abend, ohne Countdown und Gruß.
    party = keys(seasons.active(at(2026, 6, 1, 12), {"seasons": {"new_year": {"mode": "force_on"}}}))["new_year"]
    assert party["phase"] == "evening_31" and 20 <= len(party["data"]["salvos"]) <= 40 and party["data"]["new_year"] == 2027
    assert party["data"]["show_start"] == "2027-01-01T00:00:00+01:00" and "salvo_seconds" not in party["data"]
    view = seasons.admin_view(forced, at(2026, 9, 29, 12))
    by_key = {s["key"]: s for s in view["seasons"]}
    assert by_key["snow"]["active_now"] and by_key["snow"]["forced"] and by_key["halloween"]["next_start"] == "2026-10-25T00:00:00+02:00"
    assert by_key["club_birthday"]["needs_founded_on"] is True
    assert [row["key"] for row in view["calendar"]][:2] == ["carnival", "easter"]


def test_wetter_laeuft_das_ganze_jahr_in_web_und_app_und_nicht_im_kalender():
    """Die Saison „Wetter“ (#673): das ganze Jahr aktiv und ohne Lücke zu Silvester, seit #771 in Web und App, kein
    Termin im Kalender, ausschaltbar wie jede andere."""
    for moment in (at(2026, 1, 1, 0, 0, 0), at(2026, 7, 14, 16), at(2026, 10, 31, 20), at(2026, 12, 31, 23, 59, 59), at(2027, 1, 1, 0, 0, 0)):
        weather = keys(seasons.active(moment, {}))["weather"]
        assert weather["phase"] == "wetter" and weather["forced"] is False and weather["channels"] == ["web", "app"], moment
    assert "weather" in keys(seasons.active(at(2026, 12, 31, 23, 59, 59, 500000), {})), "auch die letzte Sekunde des Jahres"
    assert "weather" not in keys(seasons.active(at(2026, 7, 14, 16), {"seasons": {"weather": {"enabled": False}}}))
    assert "weather" not in keys(seasons.active(at(2026, 7, 14, 16), {"seasons": {"weather": {"mode": "force_off"}}}))
    assert "weather" not in keys(seasons.active(at(2026, 7, 14, 16), {"enabled": False}))
    # Neben einer anderen Saison läuft es weiter - Halloween im Regen.
    assert {"weather", "halloween"} <= set(keys(seasons.active(at(2026, 10, 31, 20), {})))
    # Gespeicherte Kanäle, die eine Saison nicht bedienen kann, zählen nicht.
    merged = seasons.merge_settings({"seasons": {"weather": {"channels": ["app", "web", "tv"]}, "halloween": {"channels": ["app"]}}})["seasons"]
    assert merged["weather"]["channels"] == ["web", "app"] and merged["halloween"]["channels"] == ["app"]
    assert seasons.supported_channels("weather") == ("web", "app") and seasons.supported_channels("snow") == ("web", "app")
    assert all(row["key"] != "weather" for row in seasons.calendar(2026))
    by_key = {s["key"]: s for s in seasons.admin_view({}, at(2026, 7, 14, 16))["seasons"]}
    assert by_key["weather"]["always"] is True and by_key["weather"]["active_now"] is True and by_key["weather"]["supported_channels"] == ["web", "app"]
    assert by_key["halloween"]["always"] is False and by_key["halloween"]["supported_channels"] == ["web", "app"]


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
async def test_um_mitternacht_zu_silvester_kein_zwischenspeicher(flow, monkeypatch):
    """Countdown und Show rechnen mit `now` (#741): von 23:45 bis 00:44 wird die Abfrage nicht gecacht und hat keinen
    ETag - eine Minute alter Zwischenspeicher wäre eine Minute falscher Countdown. Davor und danach wie immer."""
    real = seasons.to_vienna
    flow.act_as(None)
    for moment, live in ((at(2026, 12, 31, 20, 0), False), (at(2026, 12, 31, 23, 50), True), (at(2026, 12, 31, 23, 59, 30), True),
                         (at(2027, 1, 1, 0, 5), True), (at(2027, 1, 1, 0, 40), True), (at(2027, 1, 1, 10, 0), False)):
        monkeypatch.setattr(seasons, "to_vienna", lambda now=None, moment=moment: real(now if now is not None else moment))
        res = await flow.get("/api/seasonal/active")
        assert res.status_code == 200
        assert any(season["key"] == "new_year" for season in res.json()["seasons"]), moment
        if live:
            assert res.headers["cache-control"] == "no-store" and not res.headers.get("etag"), moment
        else:
            assert res.headers["cache-control"] == "public, max-age=60" and res.headers.get("etag"), moment


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


def test_der_18_geburtstag_beginnt_um_mitternacht_in_wien(monkeypatch):
    """Der Server läuft in UTC: um 00:30 in Wien ist dort noch der Vortag. Wer heute 18 wird, ist es trotzdem schon -
    die Altersprüfung rechnet mit der Saison-Uhr (Wien), nicht mit dem Tag des Servers. (Ende Oktober gilt schon die
    Winterzeit: Mitternacht in Wien ist 23 Uhr UTC.)"""
    real = seasons.to_vienna
    half_past_midnight = datetime(2026, 10, 30, 23, 30, tzinfo=timezone.utc)
    monkeypatch.setattr(seasons, "to_vienna", lambda now=None: real(now if now is not None else half_past_midnight))
    assert seasons.to_vienna(None).date() == date(2026, 10, 31) and half_past_midnight.date() == date(2026, 10, 30)
    assert seasons.adult_from_birth_date("2008-10-31") is True
    assert seasons.adult_from_birth_date("2008-11-01") is False
    an_hour_earlier = datetime(2026, 10, 30, 22, 30, tzinfo=timezone.utc)
    monkeypatch.setattr(seasons, "to_vienna", lambda now=None: real(now if now is not None else an_hour_earlier))
    assert seasons.adult_from_birth_date("2008-10-31") is False
    # Ein mitgegebener Tag gilt wie bisher.
    assert seasons.adult_from_birth_date("2008-10-31", date(2026, 10, 31)) is True


@pytest.mark.asyncio
async def test_schreck_freigabe_nur_ab_18_mit_geburtsdatum(flow):
    """Jumpscares (#680): der Server entscheidet - ohne Anmeldung, ohne Geburtsdatum oder unter 18 nie."""
    assert seasons.adult_from_birth_date("2000-01-01", date(2026, 10, 30)) is True
    assert seasons.adult_from_birth_date("2008-10-31", date(2026, 10, 30)) is False, "einen Tag vor dem 18. Geburtstag"
    assert seasons.adult_from_birth_date("2008-10-30", date(2026, 10, 30)) is True, "am 18. Geburtstag"
    assert seasons.adult_from_birth_date(None) is False and seasons.adult_from_birth_date("kaputt") is False
    flow.act_as(None)
    res = await flow.get("/api/seasonal/me")
    assert res.status_code == 200 and res.json() == {"scares_allowed": False}
    assert res.headers.get("cache-control") == "private, no-store"
    user = await flow.add_user(name="Erwachsen")
    flow.act_as(user)
    assert (await flow.get("/api/seasonal/me")).json() == {"scares_allowed": False}, "ohne Geburtsdatum nichts"
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"birth_date": "2000-05-05"}})
    assert (await flow.get("/api/seasonal/me")).json() == {"scares_allowed": True}
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"birth_date": "2012-05-05"}})
    assert (await flow.get("/api/seasonal/me")).json() == {"scares_allowed": False}


def test_spaeter_dazugekommene_kanaele_sind_bei_alten_speicherstaenden_an():
    """Wer das Wetter vor #771 gespeichert hat, hat dort nur „web“ stehen - die App ist dann trotzdem an. Wer danach
    speichert, legt mit ``channels_known`` fest, was zur Auswahl stand: die App bleibt dann aus, wenn sie aus ist."""
    old = seasons.merge_settings({"seasons": {"weather": {"channels": ["web"], "intensity": "full"}}})["seasons"]["weather"]
    assert old["channels"] == ["web", "app"] and old["intensity"] == "full"
    off = seasons.merge_settings({"seasons": {"weather": {"channels": ["web"], "channels_known": ["web", "app"]}}})["seasons"]["weather"]
    assert off["channels"] == ["web"]
    nowhere = seasons.merge_settings({"seasons": {"weather": {"channels": [], "channels_known": ["web", "app"]}}})["seasons"]["weather"]
    assert nowhere["channels"] == []
    # Ohne ``added_channels`` bleibt alles wie gespeichert - auch ohne ``channels_known``.
    assert seasons.merge_settings({"seasons": {"snow": {"channels": ["web"]}}})["seasons"]["snow"]["channels"] == ["web"]


@pytest.mark.asyncio
async def test_wetter_in_der_app_ein_und_aus(flow):
    """Das Wetter gibt es seit #771 auch in der App: der Kanal lässt sich speichern, und ein Speichern merkt sich, was zur
    Auswahl stand - eine App, die jemand ausschaltet, bleibt aus."""
    admin = await flow.add_user(role="club_admin", name="Vorstand")
    flow.act_as(admin)
    res = await flow.put("/api/settings/seasons", json={"seasons": {"weather": {"channels": ["web", "app"], "intensity": "full"}}})
    assert res.status_code == 200, res.text
    weather = next(s for s in res.json()["seasons"] if s["key"] == "weather")
    assert weather["channels"] == ["web", "app"] and weather["intensity"] == "full" and weather["always"] is True
    assert all(row["key"] != "weather" for row in res.json()["calendar"])
    res = await flow.put("/api/settings/seasons", json={"seasons": {"weather": {"channels": ["web"]}}})
    assert next(s for s in res.json()["seasons"] if s["key"] == "weather")["channels"] == ["web"]
    stored = await flow.db.settings.find_one({"id": seasons.SETTINGS_ID}, {"_id": 0})
    assert stored["seasons"]["weather"]["channels_known"] == ["web", "app"]
    res = await flow.put("/api/settings/seasons", json={"seasons": {"weather": {"channels": ["web", "app"]}}})
    flow.act_as(None)
    public = (await flow.get("/api/seasonal/active")).json()
    assert next(s for s in public["seasons"] if s["key"] == "weather")["channels"] == ["web", "app"]
    assert all(row["key"] != "weather" for row in (await flow.get("/api/seasonal/calendar?year=2027")).json()["items"])
    # Ausgeschaltet verschwindet es aus der öffentlichen Antwort - wie jede andere Saison.
    flow.act_as(admin)
    await flow.put("/api/settings/seasons", json={"seasons": {"weather": {"enabled": False}}})
    flow.act_as(None)
    assert all(s["key"] != "weather" for s in (await flow.get("/api/seasonal/active")).json()["seasons"])


def test_preview_without_a_time_plays_a_compressed_new_year_show():
    """Rückmeldung des Betreibers (02.10.2026): die Vorschau zeigte „Show“ ohne eine einzige Rakete. Jetzt eine Probe-Show
    in einer Minute - Raketen sofort, Mitternacht nach 15 Sekunden, die drei großen Salven im Abstand von 12 Sekunden."""
    now = at(2026, 10, 2, 20, 30, 10)
    demo = keys(seasons.active(now, {}, preview_key="new_year"))["new_year"]
    data = demo["data"]
    assert demo["phase"] == "countdown" and demo["forced"] is True and data["demo"] is True
    assert data["show_start"] == "2026-10-02T20:30:25+02:00" and data["salvo_seconds"] == [0, 12, 24] and data["new_year"] == 2027
    seconds_into_hour = 30 * 60 + 10
    assert data["salvos"][0] == seconds_into_hour + 1 and data["salvos"][-1] <= seconds_into_hour + 60
    assert len(data["salvos"]) == len(seasons.NEW_YEAR_DEMO_ROCKETS_S)
    # Mit gewählter Zeit im echten Fenster bleibt alles echt: Rampe des Servers, Mitternacht zur echten Zeit.
    real = keys(seasons.active(at(2026, 12, 31, 23, 59, 30), {}, preview_key="new_year"))["new_year"]
    assert real["phase"] == "countdown" and "demo" not in real["data"] and real["data"]["show_start"] == "2027-01-01T00:00:00+01:00"
