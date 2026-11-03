"""Zeiten mit Sekunden, Zeit je Runde, freie Einstellungen und Regeltext je Modus (#2271, docs/LIGA.md C.1 und C.3). Erfundene Namen
und Werte - kein Titel steht im Code.

- Das Zeitlimit wird in Sekunden gespeichert; ein Zeitlimit in Minuten (Altbestand) wird beim Lesen umgerechnet, ohne Migration.
- Einstellungen: Bezeichnung, Wert, Einheit und Gruppe, Reihenfolge wie geschickt, jeder Schlüssel einmal.
- Die Season übernimmt Einstellungen und Regeltext mit der Ergebnisregel als Kopie und darf abweichen.
- Baustein ``mode_settings`` im Regelwerk: Web mit Symbol, PDF ohne.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import GameModeResultRule, normalize_rule, now_utc  # noqa: E402
from pdf_service import pdf_rules_inline  # noqa: E402
from services.dolibarr_policy import club_today  # noqa: E402
from services import league_result_rules, league_rule_blocks, markdown_text, media_audit  # noqa: E402

ADMIN = "/api/admin/leagues"
SETTINGS = [
    {"label": "Uhr der Ladung", "value": 45, "unit": "seconds", "group": "Lobby"},
    {"label": "Rückblende", "value": False, "unit": "toggle", "group": "Spieler"},
    {"label": "Grenze", "value": 250, "unit": "points"},
]
GAME = {"name": "Regel Shooter", "slug": "regel-shooter", "match_modes": [
    {"mode": "suche", "label": "Suche", "result_rule": {"kind": "rounds", "target": 6, "round_limit": 11, "time_limit_seconds": 90,
                                                        "round_time_seconds": 105},
     "settings": SETTINGS, "rules_text": "Die Uhr läuft nur, solange keine Seite die Zone hält."},
    {"mode": "frei", "label": "Frei"},
]}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow):
    admin = await flow.add_staff()
    flow.act_as(admin)
    game = await flow.post("/api/games", json=GAME)
    assert game.status_code == 200, game.text
    league = (await flow.post(ADMIN, json={"name": "Regel-Liga", "game_id": game.json()["id"]})).json()
    season = await flow.post(f"{ADMIN}/{league['id']}/seasons", json={"start_date": "2026-11-10T00:00:00"})
    assert season.status_code == 200, season.text
    return game.json(), league, season.json()


# ---------------------------------------------------------------- Zeiten


def test_the_time_limit_is_kept_in_seconds_and_old_minutes_are_converted():
    assert GameModeResultRule.model_validate({"kind": "score", "target": 200, "time_limit_seconds": 90}).model_dump() == {
        "kind": "score", "target": 200, "time_limit_seconds": 90, "draw_allowed": False, "overtime": False}
    old = GameModeResultRule.model_validate({"kind": "score", "target": 200, "time_limit_minutes": 2}).model_dump()
    assert old["time_limit_seconds"] == 120 and "time_limit_minutes" not in old
    assert normalize_rule({"kind": "highest", "time_limit_minutes": 5}) == {"kind": "highest", "time_limit_seconds": 300}
    with pytest.raises(ValueError):
        GameModeResultRule.model_validate({"kind": "highest", "round_time_seconds": 0})


def test_the_check_reads_old_minutes_and_new_seconds_alike():
    """Mit Zeitlimit darf eine Map vor dem Ziel enden - gleich, ob das Zeitlimit in Minuten (Altbestand) oder Sekunden steht."""
    for rule in ({"kind": "score", "target": 250, "time_limit_minutes": 10}, {"kind": "score", "target": 250, "time_limit_seconds": 90}):
        league_result_rules.check_map(rule, {"a": 120, "b": 80}, "a", "b", label="Map 1", names={}, required=True)
    with pytest.raises(league_result_rules.RuleProblem):
        league_result_rules.check_map({"kind": "score", "target": 250}, {"a": 120, "b": 80}, "a", "b", label="Map 1", names={}, required=True)


@pytest.mark.asyncio
async def test_an_old_game_with_minutes_is_read_in_seconds(flow):
    flow.act_as(await flow.add_staff())
    now = now_utc().isoformat()
    old = [{"mode": "stellung", "label": "Stellung", "result_rule": {"kind": "score", "target": 200, "time_limit_minutes": 10}}]
    await flow.db.games.insert_one({"id": "alt", "name": "Altspiel", "slug": "altspiel", "kind": "standalone", "match_modes": old,
                                    "created_at": now, "updated_at": now})

    listed = next(row for row in (await flow.get("/api/games")).json() if row["id"] == "alt")

    assert listed["match_modes"][0]["result_rule"] == {"kind": "score", "target": 200, "time_limit_seconds": 600}
    stored = await flow.db.games.find_one({"id": "alt"}, {"_id": 0})
    assert stored["match_modes"] == old, "keine Migration: gespeichert bleibt es, wie es war"


# ---------------------------------------------------------------- Einstellungen am Modus


@pytest.mark.asyncio
async def test_settings_and_rules_text_are_saved_in_order_with_keys(flow):
    game, _league, _season = await setup(flow)

    stored = (await flow.db.games.find_one({"id": game["id"]}, {"_id": 0}))["match_modes"]

    assert [row["label"] for row in stored[0]["settings"]] == ["Uhr der Ladung", "Rückblende", "Grenze"]
    assert stored[0]["settings"][0] == {"key": "uhr_der_ladung", "label": "Uhr der Ladung", "value": 45, "unit": "seconds", "group": "Lobby"}
    assert stored[0]["settings"][2] == {"key": "grenze", "label": "Grenze", "value": 250, "unit": "points"}
    assert stored[0]["rules_text"].startswith("Die Uhr läuft")
    assert stored[0]["result_rule"]["round_time_seconds"] == 105 and stored[0]["result_rule"]["time_limit_seconds"] == 90
    assert "settings" not in stored[1] and "rules_text" not in stored[1], "leer wird nicht geschrieben"


@pytest.mark.asyncio
@pytest.mark.parametrize(("setting", "message"), [
    ({"label": "An", "value": "ja", "unit": "toggle"}, "an oder aus"),
    ({"label": "Zeit", "value": 1.5, "unit": "seconds"}, "Sekunden als ganze Zahl"),
    ({"label": "Grenze", "value": "viel", "unit": "points"}, "eine Zahl"),
    ({"label": "Text", "value": "x" * 121}, "höchstens 120"),
    ({"label": "Leer", "value": "  "}, "einen Wert"),
])
async def test_a_setting_that_does_not_fit_is_refused_in_german(flow, setting, message):
    flow.act_as(await flow.add_staff())

    response = await flow.post("/api/games", json={"name": "Probe", "match_modes": [{"label": "A", "settings": [setting]}]})

    assert response.status_code == 422
    assert message in str(response.json()["detail"])


@pytest.mark.asyncio
async def test_two_settings_with_the_same_name_get_their_own_keys(flow):
    flow.act_as(await flow.add_staff())
    created = await flow.post("/api/games", json={"name": "Probe", "match_modes": [{"label": "A", "settings": [
        {"label": "Zeit", "value": 30, "unit": "seconds", "group": "Lobby"}, {"label": "Zeit", "value": 60, "unit": "seconds", "group": "Zone"}]}]})

    assert created.status_code == 200, created.text
    assert [row["key"] for row in created.json()["match_modes"][0]["settings"]] == ["zeit", "zeit_2"]


@pytest.mark.asyncio
async def test_too_many_settings_are_refused(flow):
    flow.act_as(await flow.add_staff())
    many = [{"label": f"E{index}", "value": "x"} for index in range(41)]

    response = await flow.post("/api/games", json={"name": "Probe", "match_modes": [{"label": "A", "settings": many}]})

    assert response.status_code == 422
    assert "Höchstens 40 Einstellungen" in str(response.json()["detail"])


# ---------------------------------------------------------------- Season


@pytest.mark.asyncio
async def test_the_season_copies_settings_and_may_deviate(flow):
    game, _league, season = await setup(flow)
    url = f"{ADMIN}/seasons/{season['id']}/result-rules"
    assert season["mode_settings"]["suche"]["settings"][0]["value"] == 45
    assert "frei" not in season["mode_settings"]

    overview = {row["mode"]: row for row in (await flow.get(url)).json()["rules"]}
    assert overview["suche"]["settings_differ"] is False

    changed = [{**SETTINGS[0], "key": "uhr_der_ladung", "value": 40}, *SETTINGS[1:]]
    saved = await flow.put(url, json={"scores_required": True, "rules": season["result_rules"],
                                      "settings": {"suche": {"settings": changed, "rules_text": "Eigene Season-Regel."}}})
    assert saved.status_code == 200, saved.text
    rows = {row["mode"]: row for row in saved.json()["rules"]}
    assert rows["suche"]["settings_differ"] is True
    assert rows["suche"]["season_settings"]["settings"][0]["value"] == 40
    assert rows["suche"]["game_settings"]["settings"][0]["value"] == 45, "das Spiel bleibt"
    log = await flow.db.audit_logs.find_one({"action": "league.season.result_rules"}, {"_id": 0})
    assert log["data"]["settings_modes"] == ["suche"], "Protokoll nennt den Modus, nicht die Werte"

    # Ohne ``settings`` im Aufruf bleibt die Kopie, wie sie ist (ältere Aufrufer).
    again = await flow.put(url, json={"scores_required": True, "rules": season["result_rules"]})
    assert again.status_code == 200
    stored = await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})
    assert stored["mode_settings"]["suche"]["settings"][0]["value"] == 40

    # „Vom Spiel übernehmen“: dieselben Werte wie das Spiel - keine Abweichung mehr.
    adopted = await flow.put(url, json={"scores_required": True, "rules": season["result_rules"],
                                        "settings": {"suche": overview["suche"]["game_settings"]}})
    assert {row["mode"]: row for row in adopted.json()["rules"]}["suche"]["settings_differ"] is False

    bad = await flow.put(url, json={"scores_required": True, "rules": {}, "settings": {"suche": {"settings": [{"label": "", "value": 1}]}}})
    assert bad.status_code == 422
    assert bad.json()["detail"].startswith("Modus „Suche“:")
    unknown = await flow.put(url, json={"scores_required": True, "rules": {}, "settings": {"fremd": None}})
    assert unknown.status_code == 422


@pytest.mark.asyncio
async def test_the_staffel_carries_the_settings(flow):
    _game, _league, season = await setup(flow)
    division = (await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json={})).json()

    created = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()

    staffel = await flow.db.tournaments.find_one({"id": created["tournament_id"]}, {"_id": 0})
    assert staffel["mode_settings"] == season["mode_settings"]


# ---------------------------------------------------------------- Regelwerk


@pytest.mark.asyncio
async def test_the_block_shows_times_settings_and_rule_with_icon_on_the_web_only(flow):
    game, league, season = await setup(flow)
    icon = "/api/static/uploads/suche.png"
    await flow.db.games.update_one({"id": game["id"]}, {"$set": {"match_modes.0.icon_url": icon}})
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"mode_settings.suche.settings.2.label": "Grenze | **fett** [x](y)"}})
    stored_league = await flow.db.leagues.find_one({"id": league["id"]}, {"_id": 0})
    stored_season = await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})

    block = (await league_rule_blocks.resolve(flow.db, ["mode_settings"], stored_league, stored_season))["mode_settings"]
    markdown = league_rule_blocks.value("mode_settings", block, "markdown")
    text = league_rule_blocks.value("mode_settings", block, "text")

    assert f"![Modus-Symbol]({icon}) **Suche**" in markdown
    assert "- Zeitlimit je Map: 1:30 Min." in markdown and "- Zeit je Runde: 1:45 Min." in markdown
    assert "| Lobby | Uhr der Ladung | 0:45 Min. |" in markdown
    assert "| Spieler | Rückblende | aus |" in markdown
    row = next(line for line in markdown.splitlines() if "Grenze" in line)
    assert "**fett**" not in row and "[x](y)" not in row and row.count("|") == 4, "Namen werden harmlos: keine Spalte, kein Fettdruck, kein Link"
    assert markdown_text.plain(row) == "| – | Grenze / **fett** [x](y) | 250 Punkte |", "als Text bleibt der Name, wie er ist"
    assert "> Die Uhr läuft nur, solange keine Seite die Zone hält." in markdown
    assert "Frei" not in markdown, "ein Modus ohne Angaben fehlt"
    # Die Fassung ohne Bilder (PDF, Vergleich) hat kein Symbol, sonst dasselbe.
    assert "Modus-Symbol" not in text and text.startswith("**Suche**")
    assert text == markdown.replace(f"![Modus-Symbol]({icon}) ", "")
    assert pdf_rules_inline(text.splitlines()[0]) == "<b>Suche</b>"
    assert block["source"] == {"modes": ["suche"]}
    # Eingefroren werden Daten im Klartext - kein Markdown, kein Schutzzeichen (Folge-Review #2218).
    assert "markdown" not in block and block["data"]["rows"][0]["icon_url"] == icon
    assert all(ord(char) < 0xE000 or ord(char) > 0xF8FF for char in str(block["data"]))
    assert league_rule_blocks.BLOCKS["mode_settings"].images(block["data"]) == [icon]


def test_the_block_data_is_plain_text_without_protection_marks():
    """Die Daten des Bausteins sind Klartext (ohne Schutzzeichen) - die Darstellung schützt erst beim Rendern."""
    season = {"mode_settings": {"a": {"settings": [{"key": "x", "label": "**x** [y](z)", "value": "1 | 2"}]}}, "result_rules": {}}
    game = {"match_modes": [{"mode": "a", "label": "A*", "icon_url": "/api/static/uploads/a.png"}]}

    data = league_rule_blocks.mode_settings_data(game, season)

    assert data == {"rows": [{"mode": "a", "label": "A*", "time_limit_seconds": None, "round_time_seconds": None,
                              "settings": [{"key": "x", "label": "**x** [y](z)", "value": "1 | 2", "unit": None, "group": None}],
                              "rules_text": [], "icon_url": "/api/static/uploads/a.png"}]}
    assert all(ord(char) < 0xE000 or ord(char) > 0xF8FF for char in str(data))
    assert league_rule_blocks.render_mode_settings({"rows": []}, "markdown") == league_rule_blocks.NO_SETTINGS


@pytest.mark.asyncio
async def test_map_pool_and_mode_order_blocks_show_the_icon(flow):
    game, league, season = await setup(flow)
    icon = "/api/static/uploads/suche.png"
    await flow.db.games.update_one({"id": game["id"]}, {"$set": {"match_modes.0.icon_url": icon}})
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"game_mode_order": ["suche", "frei"]}})
    await flow.db.map_pools.insert_one({"id": "p1", "scope": "league_season", "scope_id": season["id"], "game_id": game["id"], "version": 1,
                                        "modes": [{"mode": "suche", "label": "Suche", "icon_url": icon, "maps": [{"map_id": "m", "name": "Hafen"}]}]})
    stored_league = await flow.db.leagues.find_one({"id": league["id"]}, {"_id": 0})
    stored_season = await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})

    blocks = await league_rule_blocks.resolve(flow.db, ["map_pool", "mode_order"], stored_league, stored_season)
    show = lambda key, variant: league_rule_blocks.plain_value(key, blocks[key], variant)  # noqa: E731

    assert f"| ![Modus-Symbol]({icon}) Suche | Hafen |" in show("map_pool", "markdown")
    assert "| Suche | Hafen |" in show("map_pool", "text")
    assert f"- Map 1: ![Modus-Symbol]({icon}) Suche" in show("mode_order", "markdown")
    assert "- Map 1: Suche" in show("mode_order", "text")
    assert "- Map 2: Frei" in show("mode_order", "markdown"), "ohne Symbol nur der Name"
    assert blocks["mode_order"]["data"]["icons"] == [icon, ""]
    assert league_rule_blocks.BLOCKS["map_pool"].images(blocks["map_pool"]["data"]) == [icon]
    assert league_rule_blocks._icon("/api/static/uploads/logo.svg", "markdown") == "", "das Regelwerk zeigt nur Raster-Bilder"


@pytest.mark.asyncio
async def test_a_published_version_freezes_the_icon_in_the_media_library(flow):
    """Ein veröffentlichtes Regelwerk mit Symbol im Baustein hält die Datei fest (#2266, über ``frozen_images`` aus C.4)."""
    game, league, season = await setup(flow)
    icon = "/api/static/uploads/symbol-regel.png"
    await flow.db.games.update_one({"id": game["id"]}, {"$set": {"match_modes.0.icon_url": icon}})
    url = f"/api/admin/league-rules/league_season/{season['id']}"
    draft = await flow.put(f"{url}/draft", json={"title": "Regeln", "body_md": "# Modi\n[[baustein:mode_settings]]", "annexes": []})
    assert draft.status_code == 200, draft.text
    published = await flow.post(f"{url}/publish", json={"revision": draft.json()["revision"], "valid_from": club_today(),
                                                        "change_reason": "Erste Fassung", "requires_consent": False})
    assert published.status_code == 200, published.text

    places = {(collection, field) async for collection, document, field, _name, _text in media_audit.iter_usages(flow.db, {"symbol-regel.png"})
              if media_audit.is_frozen(collection, document, field)}
    assert ("league_rules", "frozen_images") in places
    assert await media_audit.frozen_usages(flow.db, "symbol-regel.png")
    # Die Vorschau der Verwaltung zeigt den Baustein mit Symbol (Web).
    preview = await flow.post(f"{url}/preview", json={"title": "Regeln", "body_md": "# Modi\n[[baustein:mode_settings]]", "annexes": []})
    assert preview.status_code == 200, preview.text
    assert f"![Modus-Symbol]({icon}) **Suche**" in str(preview.json()["sections"])

# ---------------------------------------------------------------- Zeichen des Zwischenformats (Prüfung Codex)

PROTECTED = "\ue000\ue005\ue00f"


@pytest.mark.asyncio
async def test_protected_marks_are_removed_when_saving_a_mode(flow):
    flow.act_as(await flow.add_staff())
    created = await flow.post("/api/games", json={"name": "Probe", "match_modes": [{"label": "A", "rules_text": f"Regel{PROTECTED} gilt",
        "settings": [{"label": f"Uhr{PROTECTED}", "value": f"kurz{PROTECTED}", "group": f"Lob{PROTECTED}by"}]}]})

    assert created.status_code == 200, created.text
    stored = (await flow.db.games.find_one({"id": created.json()["id"]}, {"_id": 0}))["match_modes"][0]
    assert stored["settings"][0] == {"key": "uhr", "label": "Uhr", "value": "kurz", "group": "Lobby"}
    assert stored["rules_text"] == "Regel gilt"


@pytest.mark.asyncio
async def test_protected_marks_are_removed_when_saving_season_settings(flow):
    _game, _league, season = await setup(flow)
    url = f"{ADMIN}/seasons/{season['id']}/result-rules"

    saved = await flow.put(url, json={"scores_required": True, "rules": season["result_rules"], "settings": {"suche": {
        "settings": [{"key": "uhr", "label": f"Uhr{PROTECTED}", "value": f"x{PROTECTED}", "group": f"G{PROTECTED}"}],
        "rules_text": f"Text{PROTECTED}"}}})

    assert saved.status_code == 200, saved.text
    stored = (await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0}))["mode_settings"]["suche"]
    assert stored == {"settings": [{"key": "uhr", "label": "Uhr", "value": "x", "group": "G"}], "rules_text": "Text"}


@pytest.mark.asyncio
async def test_old_data_with_protected_marks_is_cleaned_when_read(flow):
    game, league, season = await setup(flow)
    dirty = {"settings": [{"key": "uhr", "label": f"Uhr{PROTECTED}", "value": f"x{PROTECTED}", "group": f"G{PROTECTED}"}], "rules_text": f"T{PROTECTED}"}
    await flow.db.games.update_one({"id": game["id"]}, {"$set": {"match_modes.0.settings": dirty["settings"], "match_modes.0.rules_text": dirty["rules_text"]}})
    await flow.db.league_seasons.update_one({"id": season["id"]}, {"$set": {"mode_settings.suche": dirty}})

    listed = next(row for row in (await flow.get("/api/games")).json() if row["id"] == game["id"])
    overview = {row["mode"]: row for row in (await flow.get(f"{ADMIN}/seasons/{season['id']}/result-rules")).json()["rules"]}
    stored_league = await flow.db.leagues.find_one({"id": league["id"]}, {"_id": 0})
    stored_season = await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})
    block = (await league_rule_blocks.resolve(flow.db, ["mode_settings"], stored_league, stored_season))["mode_settings"]

    clean = {"settings": [{"key": "uhr", "label": "Uhr", "value": "x", "group": "G"}], "rules_text": "T"}
    assert listed["match_modes"][0]["settings"] == clean["settings"] and listed["match_modes"][0]["rules_text"] == "T"
    assert overview["suche"]["season_settings"] == clean and overview["suche"]["game_settings"] == clean
    for text in (str(listed), str(overview), str(block["data"])):
        assert not any("\ue000" <= char <= "\ue00f" for char in text)