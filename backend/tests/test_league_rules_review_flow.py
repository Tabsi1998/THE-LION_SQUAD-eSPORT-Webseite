"""Regelwerk aus den Einstellungen, Prüfung Codex (#2269): alte Fassungen ohne Variablen-Metadaten bleiben Wort für Wort, wie sie waren;
Liga-, Season- und Spielname stehen an der Fassung fest. Erfundene Inhalte."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_rules_world import make_world, publish, season_page  # noqa: E402
from league_start_world import ok  # noqa: E402
from services import league_rules  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def body_of(page: dict) -> str:
    return "\n".join(row["body_md"] for row in page["sections"])


# ---------------------------------------------------------------- Alte Fassungen ohne Variablen-Metadaten bleiben, wie sie sind

@pytest.mark.asyncio
async def test_an_old_version_without_variable_metadata_keeps_its_text_in_web_pdf_and_history(flow):
    w = await make_world(flow)
    version = await publish(flow, w, body="# A\nAlt", annexes=[])
    # Eine Fassung von vor #2269: kein ``vars_used``, kein ``frozen_vars`` - und zufällig steht „{{best_of}}“ im Text.
    await flow.db.league_rules.update_one({"id": version["id"]}, {"$set": {"body_md": "# A\nBest of {{best_of}} bleibt stehen."},
                                                                   "$unset": {"vars_used": "", "frozen_vars": ""}})
    newer = await publish(flow, w, body="# A\nNeu", annexes=[])
    flow.act_as(None)
    old_page = ok(await flow.get(f"{season_page(w)}?version={version['id']}"))
    assert "Best of {{best_of}} bleibt stehen." in body_of(old_page), "nichts wird rückwirkend ersetzt"
    assert "festgehalten" not in body_of(old_page)
    stored = await flow.db.league_rules.find_one({"id": version["id"]}, {"_id": 0})
    league = await flow.db.leagues.find_one({"id": w["league"]["id"]}, {"_id": 0})
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})
    pdf = league_rules._pdf_document(league, season, stored, None, True)
    assert "Best of {{best_of}} bleibt stehen." in "\n".join(row["body_md"] for row in pdf["sections"])
    compare = ok(await flow.get(f"{season_page(w)}/compare?base={version['id']}&target={newer['id']}"))
    assert "{{best_of}}" in "".join(op["text"] for op in compare["sections"][0]["ops"] if op["op"] == "del")


# ---------------------------------------------------------------- Namen stehen an der Fassung fest

@pytest.mark.asyncio
async def test_renaming_league_and_season_leaves_old_versions_pdf_and_history_unchanged(flow):
    w = await make_world(flow)
    version = await publish(flow, w)
    assert version["frozen_names"]["league"] == "Regel-Liga" and version["frozen_names"]["game"] == "Regel-Shooter"
    assert version["frozen_names"]["seasons"][w["season"]["id"]] == w["season"]["name"]
    await flow.db.leagues.update_one({"id": w["league"]["id"]}, {"$set": {"name": "Neue Liga"}})
    await flow.db.league_seasons.update_one({"id": w["season"]["id"]}, {"$set": {"name": "Umbenannte Season"}})
    flow.act_as(None)
    page = ok(await flow.get(f"{season_page(w)}?version={version['id']}"))
    assert page["version"]["names"] == {"league": "Regel-Liga", "season": w["season"]["name"]}
    assert page["league"]["name"] == "Neue Liga", "die Seite selbst zeigt den heutigen Namen"
    league = await flow.db.leagues.find_one({"id": w["league"]["id"]}, {"_id": 0})
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})
    stored = await flow.db.league_rules.find_one({"id": version["id"]}, {"_id": 0})
    assert league_rules._pdf_document(league, season, stored, None, True)["context"] == f"Regel-Liga · {w['season']['name']}"
    pdf = await flow.get(f"{season_page(w)}/versions/{version['id']}/pdf")
    assert pdf.status_code == 200
    # Eine Fassung von vor #2269 ohne eingefrorene Namen nimmt die heutigen.
    await flow.db.league_rules.update_one({"id": version["id"]}, {"$unset": {"frozen_names": ""}})
    stored = await flow.db.league_rules.find_one({"id": version["id"]}, {"_id": 0})
    assert league_rules._pdf_document(league, season, stored, None, True)["context"] == "Neue Liga · Umbenannte Season"
    page = ok(await flow.get(f"{season_page(w)}?version={version['id']}"))
    assert page["version"]["names"] == {"league": "Neue Liga", "season": "Umbenannte Season"}
