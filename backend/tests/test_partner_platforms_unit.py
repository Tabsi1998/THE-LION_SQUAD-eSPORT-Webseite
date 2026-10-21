"""Partner-Plattformen (#1964): feste Positivliste der Adressen (kein freies Ziel), Abruf mit Zeit- und Größenlimit,
Zwischenspeicher und festen Meldungen. Kein Abruf ins Internet - alles über ``httpx.MockTransport``."""
import asyncio
import json
import pathlib
import sys

import httpx
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import partner_platforms  # noqa: E402

FIXTURES = pathlib.Path(__file__).resolve().parent / "fixtures" / "tft_dashboard"
BASE = "https://tft.pineapps.at"


@pytest.fixture(autouse=True)
def _isolated(monkeypatch):
    partner_platforms.clear_cache()
    monkeypatch.setattr(partner_platforms, "_transport", None)
    yield
    partner_platforms.clear_cache()


def _mock(monkeypatch, handler):
    calls = []

    def wrapped(request):
        calls.append(str(request.url))
        return handler(request)

    monkeypatch.setattr(partner_platforms, "_transport", httpx.MockTransport(wrapped))
    return calls


def _fixture(name):
    return (FIXTURES / name).read_bytes()


@pytest.mark.parametrize("value, expected", [
    ("https://tft.pineapps.at", BASE), ("https://tft.pineapps.at/", BASE), (" https://TFT.pineapps.at ", BASE),
    ("http://tft.pineapps.at", None), ("https://tft.pineapps.at.example.com", None),
    ("https://tft.pineapps.at@example.com", None), ("https://example.com", None), ("https://localhost", None),
    ("https://127.0.0.1", None), ("https://tft.pineapps.at/api/../admin", None), ("https://tft.pineapps.at:8443", None),
    ("", None), (None, None),
])
def test_only_addresses_of_the_fixed_list_are_allowed(value, expected):
    assert partner_platforms.allowed_base_url("tft_dashboard", value) == expected


def test_an_unknown_platform_has_no_address_and_the_choices_name_the_list():
    assert partner_platforms.allowed_base_url("anderes", BASE) is None
    assert partner_platforms.choices() == [{"key": "tft_dashboard", "label": "TFT-Dashboard", "provider": "PineApps",
                                            "base_urls": [BASE]}]


def test_a_tournament_is_fetched_from_the_allowed_address_and_kept_for_a_while(monkeypatch):
    calls = _mock(monkeypatch, lambda request: httpx.Response(200, content=_fixture("tournament_901.json")))
    first = asyncio.run(partner_platforms.tournament("tft_dashboard", BASE, "901"))
    second = asyncio.run(partner_platforms.tournament("tft_dashboard", BASE, "901"))
    assert calls == [f"{BASE}/api/tournaments/901"]
    assert first == second and first["rows"][0]["name"] == "Ada Ausgedacht#AAA"
    assert "puuid" not in json.dumps(first)


def test_series_and_their_tournaments_come_from_the_series_addresses(monkeypatch):
    def handler(request):
        return httpx.Response(200, content=_fixture("series.json" if request.url.path == "/api/series"
                                                    else "series_7.json"))

    calls = _mock(monkeypatch, handler)
    listed = asyncio.run(partner_platforms.series_list("tft_dashboard", BASE))
    days = asyncio.run(partner_platforms.series_tournaments("tft_dashboard", BASE, "7"))
    assert [item["ref"] for item in listed] == ["7", "6"]
    assert [item["ref"] for item in days] == ["901", "902", "903"]
    assert calls == [f"{BASE}/api/series", f"{BASE}/api/series/7"]


@pytest.mark.parametrize("base, ref", [("https://example.com", "7"), (BASE, "7/../../admin"), (BASE, "")])
def test_nothing_is_fetched_for_a_foreign_address_or_an_unusable_reference(monkeypatch, base, ref):
    calls = _mock(monkeypatch, lambda request: httpx.Response(200, content=b"{}"))
    with pytest.raises(partner_platforms.SourceError) as caught:
        asyncio.run(partner_platforms.series_tournaments("tft_dashboard", base, ref))
    assert calls == [] and str(caught.value) == partner_platforms.NOT_ALLOWED


def _raise_timeout(request):
    raise httpx.ReadTimeout("zu langsam", request=request)


def _raise_connect(request):
    raise httpx.ConnectError("weg", request=request)


@pytest.mark.parametrize("handler, message", [
    (_raise_timeout, partner_platforms.TIMEOUT_MESSAGE),
    (_raise_connect, partner_platforms.UNREACHABLE_MESSAGE),
    (lambda request: httpx.Response(503, content=b"Wartung"), partner_platforms.STATUS_MESSAGE),
    (lambda request: httpx.Response(302, headers={"location": "http://127.0.0.1/"}), partner_platforms.STATUS_MESSAGE),
    (lambda request: httpx.Response(200, content=b"<html>kein JSON</html>"), partner_platforms.FORMAT_MESSAGE),
    (lambda request: httpx.Response(200, content=b'{"id": "kaputt"}'), partner_platforms.FORMAT_MESSAGE),
])
def test_a_failing_source_raises_a_fixed_message_and_is_not_kept(monkeypatch, handler, message):
    calls = _mock(monkeypatch, handler)
    for _ in range(2):
        with pytest.raises(partner_platforms.SourceError) as caught:
            asyncio.run(partner_platforms.tournament("tft_dashboard", BASE, "901"))
        assert str(caught.value) == message
    assert len(calls) == 2  # ein Fehler bleibt nicht im Zwischenspeicher


HUGE = "9" * 400
UNUSABLE = {
    "riesige Punkte": ('{"id":1,"rounds":[{"round_number":1,"lobbies":[{"lobby_number":1,"players":[{"puuid":"a",'
                       '"game_name":"A","tag_line":"EUW","placement":1,"points":%s}]}]}],"participants":[{"puuid":"a",'
                       '"game_name":"A","tag_line":"EUW"}]}' % HUGE).encode(),
    "riesiger Platz": ('{"id":1,"rounds":[{"round_number":1,"lobbies":[{"lobby_number":1,"players":[{"puuid":"a",'
                       '"game_name":"A","placement":%s,"points":8}]}]}],"participants":[]}' % HUGE).encode(),
    "riesige Rundennummer": ('{"id":1,"rounds":[{"round_number":%s}]}' % HUGE).encode(),
    "riesige Tagessumme": ('{"id":1,"rounds":[],"participants":[{"puuid":"a","game_name":"A","total_points":%s}]}'
                           % HUGE).encode(),
    "tief verschachtelt": b"[" * 100000 + b"]" * 100000,
    "kein Text": b"\xff\xfe Unsinn",
}


@pytest.mark.parametrize("label", list(UNUSABLE))
def test_unusable_numbers_or_structures_are_a_format_error_never_a_crash(monkeypatch, label):
    """Prüfer zu #1964: riesige Zahlen (OverflowError) und tief verschachteltes JSON (RecursionError) dürfen den Abruf
    nicht mit 500 abbrechen - sie sind eine Antwort in unerwarteter Form (502 in der Route)."""
    _mock(monkeypatch, lambda request: httpx.Response(200, content=UNUSABLE[label]))
    with pytest.raises(partner_platforms.SourceError) as caught:
        asyncio.run(partner_platforms.tournament("tft_dashboard", BASE, "1"))
    assert str(caught.value) == partner_platforms.FORMAT_MESSAGE


@pytest.mark.parametrize("date", ["0001-01-01T00:00:00+14:00", "9999-12-31T23:59:59-00:00"])
def test_a_date_at_the_edge_of_the_calendar_has_no_day_instead_of_a_crash(monkeypatch, date):
    body = json.dumps({"id": 1, "date": date, "rounds": []}).encode()
    _mock(monkeypatch, lambda request: httpx.Response(200, content=body))
    assert asyncio.run(partner_platforms.tournament("tft_dashboard", BASE, "1"))["club_day"] is None


def test_an_answer_over_the_size_limit_is_refused(monkeypatch):
    monkeypatch.setattr(partner_platforms, "MAX_BYTES", 1000)
    _mock(monkeypatch, lambda request: httpx.Response(200, content=_fixture("tournament_901.json")))
    with pytest.raises(partner_platforms.SourceError) as caught:
        asyncio.run(partner_platforms.tournament("tft_dashboard", BASE, "901"))
    assert str(caught.value) == partner_platforms.SIZE_MESSAGE


def test_an_answer_that_takes_too_long_in_total_is_cut_off(monkeypatch):
    monkeypatch.setattr(partner_platforms, "TOTAL_SECONDS", 0.05)

    class Slow(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            await asyncio.sleep(1)
            return httpx.Response(200, content=b"[]")

    monkeypatch.setattr(partner_platforms, "_transport", Slow())
    with pytest.raises(partner_platforms.SourceError) as caught:
        asyncio.run(partner_platforms.series_list("tft_dashboard", BASE))
    assert str(caught.value) == partner_platforms.TIMEOUT_MESSAGE


def test_the_cache_ends_after_its_time(monkeypatch):
    calls = _mock(monkeypatch, lambda request: httpx.Response(200, content=_fixture("series.json")))
    clock = [1000.0]
    monkeypatch.setattr(partner_platforms, "_now", lambda: clock[0])
    asyncio.run(partner_platforms.series_list("tft_dashboard", BASE))
    clock[0] += partner_platforms.CACHE_SECONDS + 1
    asyncio.run(partner_platforms.series_list("tft_dashboard", BASE))
    assert len(calls) == 2
