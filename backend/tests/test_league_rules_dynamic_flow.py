"""Regelwerk aus den Einstellungen (docs/LIGA.md, #2269): Bausteine und Variablen werden beim Veröffentlichen eingefroren, eine Änderung
der Einstellungen ändert die Fassung nie still, die Verwaltung zeigt „Regelwerk muss freigegeben werden“ mit Vorschlag und Unterschieden,
die Leitung gibt frei und wählt die Zustimmungspflicht, unbekannte Variablen halten das Veröffentlichen auf, Namen bleiben Text, und
Regelwerk samt Zustimmungsstand steht auf Liga-Übersicht, Team-Seite und Matchseite. Erfundene Inhalte."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import GAME_ID, world  # noqa: E402
from league_rules_world import ADMIN_LEAGUES, PUBLIC, league_page, league_scope, make_world, publish, season_page, season_scope, today  # noqa: E402
from league_start_world import ok  # noqa: E402

BODY = ("# § 1 Serie\nGespielt wird Best of {{best_of}} mit {{team_size}} Spielern je Map.\n\n# § 2 Modi\n[[baustein:modes]]\n\n"
        "## Spielformat\n[[baustein:format]]\n\n# § 3 Tabelle\n[[baustein:table]]\n\n# § 4 Termine\n[[baustein:schedule]]\n\n"
        "# § 5 Spielberechtigung\n[[baustein:eligibility]]\n\nZiel in {{mode:stellung.name}}: {{ mode:stellung.target }} Punkte.")
RULE = {"kind": "score", "target": 250, "time_limit_seconds": 600, "overtime": True}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def body_of(page: dict) -> str:
    return "\n".join(row["body_md"] for row in page["sections"])


def no_protected(text: str) -> bool:
    return not any("" <= char <= "" for char in text)


async def set_rule(flow, w: dict, rule: dict) -> None:
    flow.act_as(w["lead"])
    ok(await flow.put(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}/result-rules", json={"scores_required": True, "rules": {"stellung": rule}}))


async def rename_mode(flow, w: dict, label: str) -> None:
    flow.act_as(w["lead"])
    ok(await flow.patch(f"/api/games/{w['game']['id']}", json={"match_modes": [{"mode": "stellung", "label": label}, {"mode": "suchen", "label": "Suchen"}]}))


# ---------------------------------------------------------------- Einfrieren und Ablauf bei Änderungen

@pytest.mark.asyncio
async def test_publishing_freezes_blocks_and_variables_and_a_changed_setting_never_changes_the_version(flow):
    w = await make_world(flow)
    await set_rule(flow, w, RULE)
    version = await publish(flow, w, body=BODY, annexes=[])
    sid = w["season"]["id"]
    assert version["blocks_used"] == ["modes", "format", "table", "schedule", "eligibility"]
    assert version["vars_used"] == ["best_of", "team_size", "mode:stellung.name", "mode:stellung.target"]
    assert version["frozen_vars"][sid]["best_of"] == {"label": "Best of", "value": "3"}
    assert version["frozen_vars"][sid]["mode:stellung.target"]["value"] == "250"
    assert version["frozen"][sid]["modes"]["data"]["rows"][0]["rule"]["target"] == 250
    assert no_protected(str(version)), "eingefroren wird Klartext"

    flow.act_as(None)
    page = ok(await flow.get(season_page(w)))
    text = body_of(page)
    assert "Gespielt wird Best of 3 mit 4 Spielern je Map." in text and "Ziel in Stellung: 250 Punkte." in text
    assert "Punkte bis zum Ziel 250 · Verlängerung bei Gleichstand · kein Remis" in text and "10 Min. je Map" in text
    assert "- Serie: Best of 3 – gewonnen hat, wer 2 Maps gewinnt." in text and "- Standardtermin:" in text and "- Zulassung:" in text
    pdf = await flow.get(f"{season_page(w)}/versions/{version['id']}/pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"].startswith("application/pdf")
    flow.act_as(w["lead"])
    assert ok(await flow.get(season_scope(w)))["data_changes"] is None

    # Einstellungen ändern: Modus umbenennen, Ziel ändern, Teamgröße ändern - die Fassung bleibt, die Verwaltung schlägt vor.
    await rename_mode(flow, w, "Hardpoint")
    await set_rule(flow, w, {**RULE, "target": 300})
    ok(await flow.patch(f"{ADMIN_LEAGUES}/seasons/{sid}", json={"team_size": 5}))
    flow.act_as(None)
    assert body_of(ok(await flow.get(season_page(w)))) == text, "nichts ändert sich still"
    flow.act_as(w["lead"])
    view = ok(await flow.get(season_scope(w)))
    rows = {(row["kind"], row["block"]): row for row in view["data_changes"]["rows"]}
    assert ("block", "modes") in rows and ("variable", "team_size") in rows
    assert rows[("variable", "mode:stellung.name")]["before"] == "Stellung" and rows[("variable", "mode:stellung.name")]["after"] == "Hardpoint"
    assert rows[("variable", "mode:stellung.target")]["ops"] == [{"op": "del", "text": "250"}, {"op": "ins", "text": "300"}]
    assert rows[("variable", "team_size")]["label"] == "{{team_size}} · Teamgröße"
    assert ("block", "format") in rows, "die Teamgröße steht auch im Baustein"
    proposal = view["proposal"]
    assert proposal["base"]["id"] == version["id"] and proposal["unknown_vars"] == []
    assert "Best of 3 mit 5 Spielern" in body_of(proposal) and "Ziel in Hardpoint: 300 Punkte." in body_of(proposal)
    assert {row["anchor"] for row in proposal["changes"]["changed"]} >= {"1-serie", "2-modi"}
    assert next(row for row in proposal["sections"] if row["anchor"] == "1-serie")["mark"] == "changed"
    duty = ok(await flow.get("/api/users/me/duty"))["rules_pending"]
    assert duty == [{"league_id": w["league"]["id"], "league_name": "Regel-Liga", "season_id": sid, "season_name": w["season"]["name"],
                     "kind": "changed", "count": len(view["data_changes"]["rows"]), "label": "Version 1",
                     "admin_url": f"/admin/leagues/rules/league_season/{sid}"}]
    assert await flow.db.league_rules.count_documents({"status": "published"}) == 1

    # Freigeben mit Zustimmungspflicht: neue Fassung mit den Werten von heute, die alte unverändert, die Captains müssen zustimmen.
    released = ok(await flow.post(f"{season_scope(w)}/proposal/publish", json={
        "base_version_id": version["id"], "fingerprint": proposal["fingerprint"], "valid_from": today(),
        "change_reason": "Modus umbenannt, Ziel und Teamgröße geändert", "requires_consent": True}))
    assert released["version"] == 2 and released["requires_consent"] and released["body_md"] == BODY
    assert released["frozen_vars"][sid]["team_size"]["value"] == "5" and released["frozen_vars"][sid]["mode:stellung.name"]["value"] == "Hardpoint"
    audit = await flow.db.audit_logs.find_one({"action": "league.rules.publish", "target_id": released["id"]}, {"_id": 0})
    assert audit["data"]["proposal"] is True and audit["data"]["variables"] == version["vars_used"]
    view = ok(await flow.get(season_scope(w)))
    assert view["data_changes"] is None and view["proposal"] is None and view["draft"] is None
    assert ok(await flow.get("/api/users/me/duty"))["rules_pending"] == []
    flow.act_as(None)
    newer = ok(await flow.get(season_page(w)))
    assert "Best of 3 mit 5 Spielern" in body_of(newer) and "Ziel in Hardpoint: 300 Punkte." in body_of(newer)
    assert "Punkte bis zum Ziel 300" in body_of(newer)
    assert next(row for row in newer["sections"] if row["anchor"] == "1-serie")["mark"] == "changed"
    assert body_of(ok(await flow.get(f"{season_page(w)}?version={version['id']}"))) == text, "die alte Fassung bleibt lesbar wie damals"
    flow.act_as(w["captain"])
    actions = ok(await flow.get("/api/mobile/dashboard"))["me"]["actions"]
    task = next(row for row in actions if row["type"] == "rules_consent")
    assert "Version 2" in task["detail"]
    hint = ok(await flow.get(season_page(w)))["consent"]
    assert hint["version"] == 2 and hint["squads"][0]["agreed"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("used", [False, True])
async def test_a_preset_variable_only_asks_for_a_release_when_the_version_uses_it(flow, used):
    """Vorab angelegte Variablen (E.2, E.3, D.5): Eine Fassung ohne sie bleibt ruhig, wenn das Season-Feld später kommt; nutzt sie die
    Variable, meldet die Verwaltung „Regelwerk muss freigegeben werden“ mit altem und neuem Wert."""
    w = await make_world(flow)
    await set_rule(flow, w, RULE)
    body = BODY + ("\n\n# § 6 Proteste\nFrist {{protest.hours}}, Pause {{match.break_minutes}} nach Map {{match.break_after_map}}." if used else "")
    version = await publish(flow, w, body=body, annexes=[])
    sid = w["season"]["id"]
    if used:
        assert version["frozen_vars"][sid]["protest.hours"]["value"] == "48 Stunden", "eingefroren mit der Vorgabe"
    flow.act_as(w["lead"])
    assert ok(await flow.get(season_scope(w)))["data_changes"] is None

    # Das spätere Paket schreibt das Season-Feld.
    await flow.db.league_seasons.update_one({"id": sid}, {"$set": {"protest_hours": 72, "map_break_minutes": 10}})

    view = ok(await flow.get(season_scope(w)))
    if not used:
        assert view["data_changes"] is None and view["proposal"] is None
        assert ok(await flow.get("/api/users/me/duty"))["rules_pending"] == []
        return
    rows = {row["block"]: row for row in view["data_changes"]["rows"] if row["kind"] == "variable"}
    assert set(rows) == {"protest.hours", "match.break_minutes"}
    assert (rows["protest.hours"]["before"], rows["protest.hours"]["after"]) == ("48 Stunden", "72 Stunden")
    assert (rows["match.break_minutes"]["before"], rows["match.break_minutes"]["after"]) == ("5 Min.", "10 Min.")
    assert "Frist 72 Stunden, Pause 10 Min. nach Map 2." in body_of(view["proposal"])
    assert ok(await flow.get("/api/users/me/duty"))["rules_pending"][0]["kind"] == "changed"


@pytest.mark.asyncio
async def test_a_draft_blocks_the_proposal_and_an_old_base_is_refused(flow):
    w = await make_world(flow)
    version = await publish(flow, w, body=BODY, annexes=[], confirm_empty=True)
    await rename_mode(flow, w, "Hardpoint")
    wrong = await flow.post(f"{season_scope(w)}/proposal/publish", json={"base_version_id": "nicht-da", "fingerprint": "egal", "valid_from": today(), "change_reason": "Grund genug"})
    assert wrong.status_code == 409 and "Grundlage" in wrong.json()["detail"]
    ok(await flow.put(f"{season_scope(w)}/draft", json={"title": "Regelwerk", "body_md": "# Neu\nText", "annexes": []}))
    view = ok(await flow.get(season_scope(w)))
    assert view["proposal"] is None and view["data_changes"]["rows"], "mit Entwurf nur der Hinweis, kein Vorschlag"
    blocked = await flow.post(f"{season_scope(w)}/proposal/publish", json={"base_version_id": version["id"], "fingerprint": "egal", "valid_from": today(), "change_reason": "Grund genug"})
    assert blocked.status_code == 409 and "Entwurf" in blocked.json()["detail"]
    assert await flow.db.league_rules.count_documents({"status": "published"}) == 1
    duty = ok(await flow.get("/api/users/me/duty"))["rules_pending"]
    assert duty and duty[0]["kind"] == "changed"
    ok(await flow.delete(f"{season_scope(w)}/draft"))
    await rename_mode(flow, w, "Stellung")
    assert ok(await flow.get("/api/users/me/duty"))["rules_pending"] == [], "zurückbenannt: nichts offen"
    ok(await flow.put(f"{season_scope(w)}/draft", json={"title": "Regelwerk", "body_md": "# Neu\nText", "annexes": []}))
    assert ok(await flow.get("/api/users/me/duty"))["rules_pending"][0]["kind"] == "draft"


@pytest.mark.asyncio
async def test_the_captain_has_no_duty_and_the_lead_only_for_own_leagues(flow):
    w = await make_world(flow)
    await publish(flow, w, body=BODY, annexes=[], confirm_empty=True)
    await rename_mode(flow, w, "Hardpoint")
    flow.act_as(w["captain"])
    assert ok(await flow.get("/api/users/me/duty"))["rules_pending"] == []


# ---------------------------------------------------------------- Unbekannt und leer

@pytest.mark.asyncio
async def test_unknown_variables_are_named_in_the_preview_and_block_publishing(flow):
    w = await make_world(flow)
    text = "# A\nBest of {{best_of}}, {{gibtsnicht}} und {{mode:stellung.farbe}} und {{mode:gibtsnicht.name}}."
    flow.act_as(w["lead"])
    preview = ok(await flow.post(f"{season_scope(w)}/preview", json={"title": "R", "body_md": text, "annexes": []}))
    assert preview["unknown_vars"] == ["gibtsnicht", "mode:stellung.farbe", "mode:gibtsnicht.name"] and preview["vars_used"] == ["best_of"]
    assert "Best of 3, {{gibtsnicht}}" in preview["sections"][0]["body_md"], "unbekannt bleibt sichtbar stehen"
    draft = ok(await flow.put(f"{season_scope(w)}/draft", json={"title": "R", "body_md": text, "annexes": []}))
    refused = await flow.post(f"{season_scope(w)}/publish", json={"revision": draft["revision"], "valid_from": today(), "change_reason": "Grund genug"})
    assert refused.status_code == 422
    assert refused.json()["detail"] == "Unbekannte Variable im Text: {{gibtsnicht}}, {{mode:stellung.farbe}}, {{mode:gibtsnicht.name}}."
    assert await flow.db.league_rules.count_documents({"status": "published"}) == 0


@pytest.mark.asyncio
async def test_a_known_variable_without_a_value_is_never_silently_empty(flow):
    w = await make_world(flow)
    text = "# A\nStartplätze: {{application.slots}}."
    flow.act_as(w["lead"])
    preview = ok(await flow.post(f"{season_scope(w)}/preview", json={"title": "R", "body_md": text, "annexes": []}))
    assert preview["empty_vars"] == ["application.slots"] and preview["unknown_vars"] == []
    assert "Startplätze: (nicht festgelegt)." in preview["sections"][0]["body_md"]
    # Veröffentlichen nur mit ausdrücklicher Bestätigung (Entscheidung Fabian; die Absage prüft test_league_rules_review_flow).
    version = await publish(flow, w, body=text, annexes=[], confirm_empty=True)
    assert version["frozen_vars"][w["season"]["id"]]["application.slots"]["value"] is None
    flow.act_as(None)
    assert "Startplätze: (nicht festgelegt)." in body_of(ok(await flow.get(season_page(w))))


@pytest.mark.asyncio
async def test_a_league_version_has_league_values_on_its_page_and_season_values_on_the_season(flow):
    w = await make_world(flow)
    version = await publish(flow, w, scope=league_scope(w), body="# A\n{{league.name}} spielt Best of {{best_of}} in {{game.name}}.", annexes=[])
    assert version["frozen_vars"][""]["league.name"]["value"] == "Regel-Liga" and "best_of" not in version["frozen_vars"][""]
    assert version["frozen_vars"][w["season"]["id"]]["best_of"]["value"] == "3"
    flow.act_as(None)
    assert "Regel-Liga spielt Best of (je Season) in Regel-Shooter." in body_of(ok(await flow.get(league_page(w))))
    assert "Regel-Liga spielt Best of 3 in Regel-Shooter." in body_of(ok(await flow.get(season_page(w))))
    flow.act_as(w["lead"])
    names = {row["name"]: row for row in ok(await flow.get(league_scope(w)))["variables"]}
    assert names["league.name"]["value"] == "Regel-Liga" and names["best_of"]["value"] is None, "ohne Season kein Wert"
    season_names = {row["name"]: row for row in ok(await flow.get(season_scope(w)))["variables"]}
    assert season_names["best_of"]["value"] == "3" and season_names["mode:stellung.name"]["value"] == "Stellung"
    assert season_names["mode:stellung.name"]["group"] == "Modi" and season_names["best_of"]["token"] == "{{best_of}}"


# ---------------------------------------------------------------- Namen bleiben Text

@pytest.mark.asyncio
async def test_names_from_the_settings_are_text_in_every_answer(flow):
    w = await make_world(flow)
    await rename_mode(flow, w, "Stellung **fett** [x](y) | z")
    version = await publish(flow, w, body="# A\nModus {{mode:stellung.name}}.\n\n[[baustein:modes]]", annexes=[])
    assert no_protected(str(version))
    flow.act_as(None)
    page = ok(await flow.get(season_page(w)))
    text = body_of(page)
    assert "Modus Stellung \\*\\*fett\\*\\* \\[x\\]\\(y\\) / z." in text and no_protected(str(page))
    assert "| Stellung \\*\\*fett\\*\\* \\[x\\]\\(y\\) / z |" in text
    await rename_mode(flow, w, "Stellung")
    second = await publish(flow, w, body="# A\nModus {{mode:stellung.name}}.\n\n[[baustein:modes]]", annexes=[])
    compare = ok(await flow.get(f"{season_page(w)}/compare?base={version['id']}&target={second['id']}"))
    removed = "".join(op["text"] for op in compare["sections"][0]["ops"] if op["op"] == "del")
    assert "**fett** [x](y) / z" in removed and "\\*" not in removed and no_protected(str(compare)), "der Vergleich zeigt Klartext"
    flow.act_as(w["lead"])
    assert no_protected(str(ok(await flow.get(season_scope(w)))))


# ---------------------------------------------------------------- Auffindbar: Liga-Übersicht, Team-Seite, Matchseite

@pytest.mark.asyncio
async def test_the_league_index_links_the_rules_only_with_a_valid_version(flow):
    w = await make_world(flow)
    flow.act_as(None)
    assert ok(await flow.get("/api/leagues"))["leagues"][0]["seasons"][0]["rules_url"] is None
    await publish(flow, w)
    flow.act_as(None)
    assert ok(await flow.get("/api/leagues"))["leagues"][0]["seasons"][0]["rules_url"] == f"/liga/{w['league']['slug']}/{w['season']['slug']}/regeln"


@pytest.mark.asyncio
async def test_the_team_page_carries_the_rules_and_the_own_consent_state(flow):
    w = await make_world(flow)
    squad = w["squads"][0]
    flow.act_as(w["captain"])
    assert ok(await flow.get(f"/api/teams/{squad['team_id']}/squads/{squad['id']}/eligibility"))["seasons"][0]["rules_doc"] is None
    version = await publish(flow, w, requires_consent=True)
    flow.act_as(w["captain"])
    doc = ok(await flow.get(f"/api/teams/{squad['team_id']}/squads/{squad['id']}/eligibility"))["seasons"][0]["rules_doc"]
    assert doc["version_id"] == version["id"] and doc["url"].endswith("/regeln") and doc["pdf_url"].endswith("/pdf")
    assert doc["consent"] == {"required": True, "agreed": False, "agreed_at": None, "demanded_label": "Version 1"}
    ok(await flow.post(f"{PUBLIC}/consents", json={"version_id": version["id"], "season_id": w["season"]["id"], "squad_id": squad["id"]}))
    doc = ok(await flow.get(f"/api/teams/{squad['team_id']}/squads/{squad['id']}/eligibility"))["seasons"][0]["rules_doc"]
    assert doc["consent"]["agreed"] is True and doc["consent"]["agreed_at"]
    other = w["squads"][1]
    flow.act_as(w["other_captain"])
    assert ok(await flow.get(f"/api/teams/{other['team_id']}/squads/{other['id']}/eligibility"))["seasons"][0]["rules_doc"]["consent"]["agreed"] is False
    await publish(flow, w, body="# B\nOhne Zustimmung", requires_consent=False)
    flow.act_as(w["other_captain"])
    doc = ok(await flow.get(f"/api/teams/{other['team_id']}/squads/{other['id']}/eligibility"))["seasons"][0]["rules_doc"]
    assert doc["version"] == 2 and doc["consent"]["required"] is True, "die Forderung von Version 1 bleibt, bis zugestimmt ist"


@pytest.mark.asyncio
async def test_the_match_page_carries_the_rules_with_the_own_consent_state(flow):
    await flow.db.games.insert_one({"id": GAME_ID, "slug": "probe-shooter", "name": "Probe Shooter"})
    w = await world(flow)
    await flow.db.leagues.insert_one({"id": "liga", "name": "Testliga", "slug": "testliga", "game_id": GAME_ID, "status": "active"})
    await flow.db.league_seasons.insert_one({"id": w["season_id"], "league_id": "liga", "name": "Season 1", "slug": "season-1", "number": 1,
                                             "status": "active", "visibility": "public"})
    w.update(lead=w["staff"], league={"id": "liga", "slug": "testliga"}, season={"id": w["season_id"], "slug": "season-1", "name": "Season 1"})
    flow.act_as(w["users"]["Kapitaen"])
    assert ok(await flow.get(f"/api/matches/{w['match']['id']}/page"))["league"]["rules"] is None
    version = await publish(flow, w, body="# Fairplay\nFair spielen.", annexes=[], requires_consent=True)
    flow.act_as(w["users"]["Kapitaen"])
    rules = ok(await flow.get(f"/api/matches/{w['match']['id']}/page"))["league"]["rules"]
    assert rules["version_id"] == version["id"] and rules["url"] == "/liga/testliga/season-1/regeln"
    assert rules["consent"] == {"required": True, "agreed": False, "agreed_at": None, "demanded_label": "Version 1"}
    flow.act_as(w["users"]["Fremd"])
    guest = ok(await flow.get(f"/api/matches/{w['match']['id']}/page"))["league"]["rules"]
    assert guest["version_id"] == version["id"] and guest["consent"] is None, "Unbeteiligte sehen keinen Zustimmungsstand"
    flow.act_as(w["users"]["Kapitaen"])
    ok(await flow.post(f"{PUBLIC}/consents", json={"version_id": version["id"], "season_id": w["season_id"], "squad_id": w["squad_a"]["id"]}))
    assert ok(await flow.get(f"/api/matches/{w['match']['id']}/page"))["league"]["rules"]["consent"]["agreed"] is True
