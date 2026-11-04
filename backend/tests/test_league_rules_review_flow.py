"""Regelwerk aus den Einstellungen, Prüfung Codex (#2269): Die Freigabe veröffentlicht nur die Datenbasis, die der Vorschlag gezeigt hat
(Fingerabdruck, sonst 409); alte Fassungen ohne Variablen-Metadaten bleiben Wort für Wort, wie sie waren; Liga-, Season- und Spielname
stehen an der Fassung fest; leere Variablen brauchen eine ausdrückliche Bestätigung. Erfundene Inhalte."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_rules_world import ADMIN_LEAGUES, make_world, publish, season_page, season_scope, today  # noqa: E402
from league_start_world import ok  # noqa: E402
from services import league_rules  # noqa: E402

BODY = "# § 1 Serie\nGespielt wird mit {{team_size}} Spielern je Map.\n\n# § 2 Modi\n[[baustein:modes]]"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def body_of(page: dict) -> str:
    return "\n".join(row["body_md"] for row in page["sections"])


async def rename_mode(flow, w: dict, label: str) -> None:
    flow.act_as(w["lead"])
    ok(await flow.patch(f"/api/games/{w['game']['id']}", json={"match_modes": [{"mode": "stellung", "label": label}, {"mode": "suchen", "label": "Suchen"}]}))


# ---------------------------------------------------------------- 1. Die Freigabe veröffentlicht nur die geprüfte Datenbasis

@pytest.mark.asyncio
async def test_the_release_refuses_when_a_setting_changed_since_the_proposal_was_fetched(flow):
    w = await make_world(flow)
    version = await publish(flow, w, body=BODY, annexes=[])
    await rename_mode(flow, w, "Hardpoint")
    proposal = ok(await flow.get(season_scope(w)))["proposal"]
    assert proposal["fingerprint"], "der Vorschlag nennt seine Datenbasis"
    # Zwischen Abruf und Freigabe ändert jemand eine Einstellung, die im Regelwerk steht - ohne die Sperre des Regelwerks.
    ok(await flow.patch(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}", json={"team_size": 5}))
    body = {"base_version_id": version["id"], "fingerprint": proposal["fingerprint"], "valid_from": today(), "change_reason": "Modus umbenannt"}
    refused = await flow.post(f"{season_scope(w)}/proposal/publish", json=body)
    assert refused.status_code == 409 and "inzwischen geändert" in refused.json()["detail"]
    assert await flow.db.league_rules.count_documents({"status": "published"}) == 1
    assert await flow.db.league_rules.count_documents({"status": "draft"}) == 0, "kein liegen gebliebener Entwurf"
    # Neu geprüft: der neue Fingerabdruck geht durch, und veröffentlicht wird genau dieser Stand.
    fresh = ok(await flow.get(season_scope(w)))["proposal"]
    assert fresh["fingerprint"] != proposal["fingerprint"]
    released = ok(await flow.post(f"{season_scope(w)}/proposal/publish", json={**body, "fingerprint": fresh["fingerprint"]}))
    assert released["version"] == 2 and released["frozen_vars"][w["season"]["id"]]["team_size"]["value"] == "5"
    assert "Hardpoint" in str(released["frozen"][w["season"]["id"]]["modes"]["data"])


@pytest.mark.asyncio
async def test_the_release_needs_the_fingerprint(flow):
    w = await make_world(flow)
    version = await publish(flow, w, body=BODY, annexes=[])
    await rename_mode(flow, w, "Hardpoint")
    without = await flow.post(f"{season_scope(w)}/proposal/publish", json={"base_version_id": version["id"], "valid_from": today(), "change_reason": "Grund genug"})
    assert without.status_code == 422
    assert await flow.db.league_rules.count_documents({"status": "published"}) == 1


# ---------------------------------------------------------------- 2. Alte Fassungen ohne Variablen-Metadaten bleiben, wie sie sind

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


# ---------------------------------------------------------------- 3. Namen stehen an der Fassung fest

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


# ---------------------------------------------------------------- 4. Leere Variablen nur mit Bestätigung

@pytest.mark.asyncio
async def test_empty_variables_need_an_explicit_confirmation_when_publishing(flow):
    w = await make_world(flow)
    text = "# A\nStartplätze: {{application.slots}}."
    flow.act_as(w["lead"])
    draft = ok(await flow.put(f"{season_scope(w)}/draft", json={"title": "R", "body_md": text, "annexes": []}))
    refused = await flow.post(f"{season_scope(w)}/publish", json={"revision": draft["revision"], "valid_from": today(), "change_reason": "Grund genug"})
    assert refused.status_code == 422
    detail = refused.json()["detail"]
    assert detail["code"] == "empty_vars" and detail["names"] == ["application.slots"] and "(nicht festgelegt)" in detail["message"]
    assert await flow.db.league_rules.count_documents({"status": "published"}) == 0
    released = ok(await flow.post(f"{season_scope(w)}/publish", json={
        "revision": draft["revision"], "valid_from": today(), "change_reason": "Grund genug", "confirm_empty": True}))
    assert released["frozen_vars"][w["season"]["id"]]["application.slots"]["value"] is None


@pytest.mark.asyncio
async def test_empty_variables_need_the_confirmation_in_the_release_too(flow):
    w = await make_world(flow)
    version = await publish(flow, w, body="# A\nStartplätze: {{application.slots}}.\n\n[[baustein:modes]]", annexes=[], confirm_empty=True)
    await rename_mode(flow, w, "Hardpoint")
    proposal = ok(await flow.get(season_scope(w)))["proposal"]
    assert proposal["empty_vars"] == ["application.slots"]
    body = {"base_version_id": version["id"], "fingerprint": proposal["fingerprint"], "valid_from": today(), "change_reason": "Modus umbenannt"}
    refused = await flow.post(f"{season_scope(w)}/proposal/publish", json=body)
    assert refused.status_code == 422 and refused.json()["detail"]["code"] == "empty_vars"
    assert await flow.db.league_rules.count_documents({"status": "published"}) == 1
    assert await flow.db.league_rules.count_documents({"status": "draft"}) == 0
    assert ok(await flow.post(f"{season_scope(w)}/proposal/publish", json={**body, "confirm_empty": True}))["version"] == 2
