"""Regelwerk der Liga (docs/LIGA.md, #1646): Öffentliche Rechenlast bleibt begrenzt - Größe je Fassung, gedeckelter Vergleich, Speicher je
unveränderlicher Fassung, Bremse für PDF und Vergleich. Erfundene Inhalte."""
import asyncio
import pathlib
import re
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_rules_world import make_bare_world, publish, season_page, season_scope  # noqa: E402
from league_start_world import ok  # noqa: E402
from routes import league_rules_routes  # noqa: E402
from services import league_rules, league_rules_cache, league_rules_text as text  # noqa: E402

NGINX = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "nginx.conf"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    league_rules_cache.rules_cache.clear()
    try:
        yield instance
    finally:
        await shutdown()


# ---------------------------------------------------------------- Größe je Fassung

@pytest.mark.asyncio
async def test_a_version_has_a_total_size_limit_across_text_and_annexes(flow):
    w = await make_bare_world(flow)
    part = "a" * (league_rules.TEXT_TOTAL_MAX // 3 + 10)
    answer = await flow.put(f"{season_scope(w)}/draft", json={"title": "A", "body_md": part, "annexes": [
        {"title": "B", "body_md": part}, {"title": "C", "body_md": part}]})
    assert answer.status_code == 422 and "lang" in answer.json()["detail"]
    fine = await flow.put(f"{season_scope(w)}/draft", json={"title": "A", "body_md": part, "annexes": [{"title": "B", "body_md": part}]})
    assert fine.status_code == 200, fine.text


@pytest.mark.asyncio
async def test_a_version_has_a_limit_of_sections(flow):
    w = await make_bare_world(flow)
    body = "\n".join(f"# Abschnitt {index}" for index in range(league_rules.SECTIONS_MAX + 1))
    answer = await flow.put(f"{season_scope(w)}/draft", json={"title": "A", "body_md": body, "annexes": []})
    assert answer.status_code == 422 and "Abschnitte" in answer.json()["detail"]


# ---------------------------------------------------------------- Vergleich gedeckelt

def long_sections(prefix: str, sections: int, words: int) -> list[dict]:
    body = "\n\n".join(f"# Teil {index}\n" + " ".join(f"{prefix}{index}x{word}" for word in range(words)) for index in range(sections))
    return text.sections_of(body)


def test_a_small_comparison_stays_word_by_word():
    rows = text.diff_view(text.sections_of("# A\nEin altes Wort"), text.sections_of("# A\nEin neues Wort"))
    assert rows[0].get("coarse") is None
    assert {"op": "del", "text": "altes"} in rows[0]["ops"]


def test_a_huge_comparison_falls_back_to_whole_sections(monkeypatch):
    calls = []
    monkeypatch.setattr(text, "word_ops", lambda *args: calls.append(args) or [])
    per_section = text.DIFF_WORDS_MAX // 4
    rows = text.diff_view(long_sections("alt", 5, per_section), long_sections("neu", 5, per_section))
    assert calls == [], "kein Vergleich Wort für Wort"
    changed = [row for row in rows if row["status"] == "changed"]
    assert len(changed) == 5 and all(row["coarse"] is True for row in changed)
    assert [row["op"] for row in changed[0]["ops"]] == ["del", "ins"]
    assert changed[0]["ops"][0]["text"].startswith("alt0x0") and changed[0]["ops"][1]["text"].startswith("neu0x0")


def test_a_rewritten_text_does_not_pair_everything_with_everything(monkeypatch):
    calls = []
    real = text._same_words
    monkeypatch.setattr(text, "_same_words", lambda left, right: calls.append(1) or real(left, right))
    size = int(text.RENAME_PAIRS_MAX ** 0.5) + 5
    base = text.sections_of("\n\n".join(f"# Alt {index}\nalt{index} text" for index in range(size)))
    target = text.sections_of("\n\n".join(f"# Neu {index}\nneu{index} text" for index in range(size)))
    result = text.compare(base, target)
    assert calls == []
    assert len(result["new"]) == size and len(result["removed"]) == size


# ---------------------------------------------------------------- Speicher

def test_the_cache_is_bounded_by_entries_and_bytes_and_drops_the_oldest():
    async def run():
        cache = league_rules_cache.VersionCache(max_entries=2, max_bytes=100)
        await cache.get_or_make(("a",), lambda: b"1" * 10)
        await cache.get_or_make(("b",), lambda: b"2" * 10)
        await cache.get_or_make(("a",), lambda: b"x")  # kommt aus dem Speicher und wird damit die jüngste
        await cache.get_or_make(("c",), lambda: b"3" * 10)
        assert await cache.get_or_make(("a",), lambda: b"neu") == b"1" * 10
        assert await cache.get_or_make(("b",), lambda: b"neu") == b"neu"
        huge = await cache.get_or_make(("riesig",), lambda: b"9" * 500)
        assert len(huge) == 500 and ("riesig",) not in cache
        await cache.get_or_make(("d",), lambda: b"4" * 90)
        await cache.get_or_make(("e",), lambda: b"5" * 90)
        assert cache.bytes <= 100 and len(cache) <= 2

    asyncio.run(run())


def test_the_cache_makes_a_file_only_once_in_a_burst():
    calls = []

    def make():
        calls.append(1)
        return b"pdf"

    async def run():
        cache = league_rules_cache.VersionCache()
        answers = await asyncio.gather(*[cache.get_or_make(("pdf",), make) for _ in range(8)])
        assert answers == [b"pdf"] * 8

    asyncio.run(run())
    assert calls == [1]


def test_a_failed_make_is_not_remembered():
    async def run():
        cache = league_rules_cache.VersionCache()

        def broken():
            raise ValueError("kaputt")

        with pytest.raises(ValueError):
            await cache.get_or_make(("a",), broken)
        assert await cache.get_or_make(("a",), lambda: b"gut") == b"gut"

    asyncio.run(run())


@pytest.mark.asyncio
async def test_a_pdf_is_built_once_per_version_and_marks(flow, monkeypatch):
    import pdf_service

    calls = []
    real = pdf_service.pdf_league_rules
    monkeypatch.setattr(pdf_service, "pdf_league_rules", lambda *args, **kwargs: calls.append(1) or real(*args, **kwargs))
    w = await make_bare_world(flow, visibility="public")
    version = await publish(flow, w, body="# A\nText", annexes=[])
    flow.act_as(None)
    url = f"{season_page(w)}/versions/{version['id']}/pdf"
    first = await flow.get(url)
    second = await flow.get(url)
    assert first.status_code == second.status_code == 200 and first.content == second.content
    assert len(calls) == 1
    assert (await flow.get(url, params={"marks": 0})).status_code == 200
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_the_cache_does_not_outrun_the_visibility(flow):
    w = await make_bare_world(flow, visibility="public")
    version = await publish(flow, w, body="# A\nText", annexes=[])
    flow.act_as(None)
    url = f"{season_page(w)}/versions/{version['id']}/pdf"
    assert (await flow.get(url)).status_code == 200
    await flow.db.league_seasons.update_one({"id": w["season"]["id"]}, {"$set": {"visibility": "off"}})
    assert (await flow.get(url)).status_code == 404


@pytest.mark.asyncio
async def test_a_renamed_league_keeps_the_pdf_of_a_published_version(flow, monkeypatch):
    """Die Namen von Liga und Season stehen an der Fassung fest (#2269, Prüfung Codex): Eine Umbenennung ändert weder die Datei noch
    ihren Schlüssel - nur eine Fassung ohne eingefrorene Namen (von vor #2269) nimmt die heutigen."""
    import pdf_service

    calls = []
    real = pdf_service.pdf_league_rules
    monkeypatch.setattr(pdf_service, "pdf_league_rules", lambda *args, **kwargs: calls.append(1) or real(*args, **kwargs))
    w = await make_bare_world(flow, visibility="public")
    version = await publish(flow, w, body="# A\nText", annexes=[])
    flow.act_as(None)
    url = f"{season_page(w)}/versions/{version['id']}/pdf"
    assert (await flow.get(url)).status_code == 200
    await flow.db.leagues.update_one({"id": w["league"]["id"]}, {"$set": {"name": "Anderer Name"}})
    assert (await flow.get(url)).status_code == 200
    assert len(calls) == 1, "dieselbe Fassung, dieselbe Datei"
    await flow.db.league_rules.update_one({"id": version["id"]}, {"$unset": {"frozen_names": ""}})
    assert (await flow.get(url)).status_code == 200
    assert len(calls) == 2, "ohne eingefrorene Namen zählt der heutige Name"


@pytest.mark.asyncio
async def test_comparison_and_marks_are_remembered_the_preview_is_not(flow, monkeypatch):
    diffs, compares = [], []
    real_diff, real_compare = text.diff_view, text.compare
    monkeypatch.setattr(text, "diff_view", lambda *args: diffs.append(1) or real_diff(*args))
    monkeypatch.setattr(text, "compare", lambda *args: compares.append(1) or real_compare(*args))
    w = await make_bare_world(flow, visibility="public")
    first = await publish(flow, w, body="# A\nAlt", annexes=[])
    second = await publish(flow, w, body="# A\nNeu", annexes=[])
    flow.act_as(None)
    params = {"base": first["id"], "target": second["id"]}
    a = ok(await flow.get(f"{season_page(w)}/compare", params=params))
    b = ok(await flow.get(f"{season_page(w)}/compare", params=params))
    assert a == b and len(diffs) == 1
    compares.clear()
    ok(await flow.get(season_page(w)))
    ok(await flow.get(season_page(w)))
    assert len(compares) == 1

    flow.act_as(w["lead"])
    compares.clear()
    body = {"title": "A", "body_md": "# A\nEntwurf", "annexes": []}
    ok(await flow.post(f"{season_scope(w)}/preview", json=body))
    ok(await flow.post(f"{season_scope(w)}/preview", json=body))
    assert len(compares) == 2, "die Vorschau rechnet jedes Mal neu"


# ---------------------------------------------------------------- Bremse

@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["pdf", "compare"])
async def test_pdf_and_comparison_are_limited_per_visitor(flow, monkeypatch, kind):
    monkeypatch.setattr(league_rules_routes, "HEAVY_LIMIT", 2)
    w = await make_bare_world(flow, visibility="public")
    version = await publish(flow, w, body="# A\nText", annexes=[])
    flow.act_as(None)
    url = f"{season_page(w)}/versions/{version['id']}/pdf" if kind == "pdf" else f"{season_page(w)}/compare?base={version['id']}&target={version['id']}"
    codes = [(await flow.get(url)).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    assert (await flow.get(season_page(w))).status_code == 200, "die Seite selbst bleibt erreichbar"


def test_nginx_brakes_bursts_on_pdf_and_comparison():
    conf = NGINX.read_text(encoding="utf-8")
    assert "zone=tls_rules_heavy:" in conf
    block = re.search(r"location ~ \^/api/league-rules/[^\n]*\{(.*?)\n    \}", conf, re.S)
    assert block, "eigener Block für PDF und Vergleich"
    head = conf[block.start():conf.index("{", block.start())]
    assert "compare" in head and "pdf" in head
    body = block.group(1)
    assert re.search(r"limit_req zone=tls_rules_heavy burst=\d+ nodelay;", body)
    assert "limit_req_status 429;" in body and "proxy_pass http://backend:8001;" in body
    for header in ("X-Content-Type-Options", "X-Frame-Options", "Content-Security-Policy", 'Cache-Control "no-store"'):
        assert header in body, header
