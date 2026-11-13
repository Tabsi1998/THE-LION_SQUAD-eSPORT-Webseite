"""Bausteine und Variablen aus den Einstellungen (docs/LIGA.md, #2269) - reine Darstellung ohne Datenbank: jeder Baustein in Web- und
PDF-Fassung, Namen aus der Verwaltung als Text (nie Link, nie fett, nie Spalte), Variablen mit Wert, ohne Wert und unbekannt.
Erfundene Spiele und Werte."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_rule_blocks as blocks  # noqa: E402
from services import league_rule_facts as facts  # noqa: E402
from services import league_rule_vars as variables  # noqa: E402
from services.markdown_text import plain, served  # noqa: E402

ICON = "/api/static/uploads/stellung.png"
GAME = {"id": "g1", "name": "Probe-Shooter", "match_modes": [
    {"mode": "stellung", "label": "Stellung **fett** [x](y)", "icon_url": ICON, "players_per_side": 4, "description": "Zone halten | zählen",
     "result_rule": {"kind": "score", "target": 250, "time_limit_seconds": 600, "overtime": True}},
    {"mode": "suchen", "label": "Suchen", "players_per_side": 4,
     "result_rule": {"kind": "rounds", "target": 6, "round_limit": 11, "round_time_seconds": 90, "time_limit_minutes": 10}},
    {"mode": "frei", "label": "Frei", "status": "archived"},
]}
POOL = {"id": "p1", "modes": [{"mode": "suchen", "label": "Suchen (alt)", "maps": [{"name": "Hafen"}]}]}
SEASON = {"id": "s1", "name": "Season 1", "number": 1, "league_id": "l1", "start_date": "2026-11-09T23:00:00+00:00", "weeks_total": 10,
          "matchday_days": 7, "default_match_weekday": 6, "default_match_time": "20:00", "best_of": 3, "team_size": 4, "min_squad_size": 4,
          "max_squad_size": 50, "map_repeat": "other_mode", "lineup_mode": "series", "lineup_min_players": 3, "game_mode_order": ["stellung", "suchen", "stellung"],
          "blocked_periods": [{"start_date": "2026-12-21", "end_date": "2027-01-03", "label": "Weihnachts|pause"}],
          "match_schedule_response_hours": 72, "result_confirm_hours": 48, "lineup_amend_hours": 48,
          "schedule_rules": {"home_rule": True, "home_rule_hours": 72, "reschedule_notice_hours": 24, "reschedule_max": 2, "reschedule_same_week": True,
                             "result_reminder_hours": 24, "result_overdue_hours": 48},
          "scoring_rules": {"match_points": {"win": 3, "draw": 0, "loss": 0}, "table_tiebreakers": ["head_to_head", "score_diff", "score_for", "lead_decision"],
                            "head_to_head_criteria": ["points", "score_diff", "score_for"], "allow_draws": False, "forfeit_score": "best_of",
                            "exit_rule": "all_for_opponents"},
          "min_age": 18, "one_team_per_season": True, "new_player_wait_days": 7, "unique_game_ids": True, "roster_deadline": "2026-11-06",
          "transfer_windows": [{"start_date": "2026-12-01", "end_date": "2026-12-07", "label": "Winterfenster"}], "entry_policy": "members",
          "application_opens_at": "2026-10-31T23:00:00+00:00", "application_closes_at": "2026-11-06T22:59:00+00:00", "application_slots": 16,
          "result_rules": {"stellung": {"kind": "score", "target": 300, "time_limit_seconds": 600, "overtime": True},
                           "suchen": {"kind": "rounds", "target": 6, "round_limit": 11, "round_time_seconds": 90, "time_limit_minutes": 10}}}
DIVISIONS = [{"id": "d1", "level": 1, "nickname": "Elite", "overrides": {"best_of": 5, "scoring_rules": {"match_points": {"win": 3, "draw": 1, "loss": 0}, "allow_draws": True}}},
             {"id": "d2", "level": 2, "overrides": {}}]


def no_protected(text: str) -> bool:
    return not any("" <= char <= "" for char in text)


# ---------------------------------------------------------------- Modi

def test_modes_come_from_pool_and_order_with_the_current_name_and_the_season_rule():
    data = facts.modes_data(SEASON, GAME, POOL)
    assert [row["mode"] for row in data["rows"]] == ["suchen", "stellung"], "Pool zuerst, dann die Modusfolge; archivierte nicht"
    stellung = data["rows"][1]
    assert stellung["label"] == "Stellung **fett** [x](y)" and stellung["icon_url"] == ICON and stellung["players_per_side"] == 4
    assert stellung["rule"] == {"kind": "score", "target": 300, "round_limit": None, "time_limit_seconds": 600, "round_time_seconds": None,
                                "overtime": True, "draw_allowed": False}, "die Kopie der Season, nicht die des Spiels"
    assert data["rows"][0]["rule"]["time_limit_seconds"] == 600, "Minuten aus dem Altbestand werden Sekunden"
    assert data["rows"][0]["label"] == "Suchen", "der heutige Name des Spiels, nicht der des Pools"


def test_without_pool_and_order_all_active_modes_of_the_game():
    data = facts.modes_data({**SEASON, "game_mode_order": []}, GAME, None)
    assert [row["mode"] for row in data["rows"]] == ["stellung", "suchen"]
    assert facts.render_modes({"rows": []}) == facts.NO_MODES


def test_the_rule_in_plain_words():
    assert facts.rule_sentence({"kind": "score", "target": 250, "overtime": True}) == "Punkte bis zum Ziel 250 · Verlängerung bei Gleichstand · kein Remis"
    assert facts.rule_sentence({"kind": "rounds", "target": 6, "round_limit": 11, "draw_allowed": True}) == "6 gewonnene Runden, höchstens 11 Runden · keine Verlängerung · Remis möglich"
    assert facts.rule_sentence({"kind": "highest"}) == "Der höhere Endstand gewinnt · keine Verlängerung · kein Remis"
    assert facts.rule_sentence(None) == "keine Ergebnisregel hinterlegt"
    assert facts.time_sentence({"time_limit_seconds": 600, "round_time_seconds": 90}) == "10 Min. je Map · 1:30 Min. je Runde"
    assert facts.time_sentence({}) == "–"


def test_modes_table_web_with_icon_pdf_without_and_names_as_text():
    data = facts.modes_data(SEASON, GAME, POOL)
    web = facts.render_modes(data, "markdown")
    text = facts.render_modes(data, "text")
    assert "| Modus | Ergebnisregel | Zeit | Spieler je Seite |" in web
    assert f"| ![Modus-Symbol]({ICON}) " in web and "![Modus-Symbol]" not in text
    assert "| Punkte bis zum Ziel 300 · Verlängerung bei Gleichstand · kein Remis | 10 Min. je Map | 4 Spieler |" in plain(web)
    assert "6 gewonnene Runden, höchstens 11 Runden" in plain(text)
    # Der Name und die Beschreibung sind Text: Sternchen und Klammern geschützt, der senkrechte Strich wird „/“.
    assert "**fett**" not in web and "\\*\\*fett\\*\\*" in served(web) and "Zone halten / zählen" in plain(web)
    assert blocks.BLOCKS["modes"].images(data) == [ICON]
    assert blocks.value("modes", {"data": data}, "text") == text, "über das Register wie jeder Baustein"


# ---------------------------------------------------------------- Spielformat, Tabelle

def test_format_lists_series_team_squad_repeat_and_division_overrides():
    data = facts.format_data(SEASON, DIVISIONS)
    assert data["maps_to_win"] == 2 and data["divisions"] == [{"label": "Liga 1 · Elite", "best_of": 5, "team_size": 4, "min_squad_size": 4}]
    out = facts.render_format(data)
    assert "- Serie: Best of 3 – gewonnen hat, wer 2 Maps gewinnt." in out
    assert "- Teamgröße: 4 Spieler je Map." in out and "- Kader: mindestens 4, höchstens 50 Spieler." in out
    assert "nur in einem anderen Modus" in out and "- Teilnehmerliste: einmal je Spiel, mindestens 3 Spieler." in out
    assert "- Abweichend in Liga 1 · Elite: Best of 5, Teamgröße 4, Mindestkader 4." in plain(out)
    older = facts.render_format(facts.format_data({**SEASON, "max_squad_size": None, "lineup_mode": None, "map_repeat": "never"}, []))
    assert "- Kader: mindestens 4 Spieler." in older and "- Aufstellung: je Map." in older and "höchstens einmal" in older


def test_table_block_speaks_e1_and_the_old_defaults():
    data = facts.table_data(SEASON, DIVISIONS)
    out = facts.render_table(data)
    assert "- Punkte: Sieg 3, Niederlage 0 Punkte." in out and "ein Remis gibt es nicht" in out
    assert ("- Bei Punktgleichheit entscheidet der Reihe nach: direkter Vergleich (Punkte, Map-Differenz, gewonnene Maps), Map-Differenz, "
            "gewonnene Maps, Entscheid der Liga-Leitung.") in out
    assert "wie zum Sieg der Serie nötig sind, der andere 0." in out and "Best of 3" not in out, "kein festes Beispiel in einer BO5-Liga"
    assert "Beide nicht erschienen" in out and "steht am Tabellenende" in out
    # Liga N (#2318): Die ältere Abweichung trägt Remis erlaubt - es zählen nur ihre Punkte, und Remis-Punkte ohne Remis ändern nichts.
    assert "Abweichend" not in out and "Remis 1" not in out
    own = [{"id": "d1", "level": 1, "nickname": "Elite", "overrides": {"scoring_rules": {"match_points": {"win": 2, "draw": 0, "loss": 0}, "allow_draws": True}}}]
    divided = facts.table_data(SEASON, own)
    assert divided["divisions"][0]["points"]["win"] == 2 and divided["divisions"][0]["allow_draws"] is False
    assert divided["divisions"][0]["tiebreakers"] == SEASON["scoring_rules"]["table_tiebreakers"]
    assert "**Abweichend in Liga 1 · Elite**" in plain(facts.render_table(divided)) and "- Punkte: Sieg 2, Niederlage 0 Punkte." in facts.render_table(divided)
    maps_divided = facts.table_data(MAPS_SEASON, own)
    assert maps_divided["divisions"] == [], "mit Map-Punkten gibt es keine eigenen Punkte einer Liga N"
    old =facts.render_table(facts.table_data({"scoring_rules": {"match_points": {"win": 3, "draw": 1, "loss": 0}}}, []))
    assert "Sieg 3, Remis 1, Niederlage 0" in old and "Map-Differenz, gewonnene Maps." in old
    assert "Gewertet wird, was die Liga-Leitung einträgt." in old and "annulliert" in old


MAPS_SEASON = {**SEASON, "scoring_rules": {**SEASON["scoring_rules"], "match_points_mode": "maps", "forfeit_score": "recorded",
                                           "table_tiebreakers": ["wins", "head_to_head", "score_diff", "lead_decision"]}}


def test_table_block_speaks_map_points_and_marks_the_change():
    """#2312: Punkte nach gewonnenen Maps - der Satz zur Punktvergabe stimmt, kampflos immer wie 3:0, und der Wechsel ändert den Baustein
    (so schlägt das Regelwerk eine neue Freigabe vor). Eingefrorene Fassungen ohne ``points_mode`` lesen sich wie bisher."""
    data = facts.table_data(MAPS_SEASON, [])
    assert data["points_mode"] == "maps"
    out = facts.render_table(data)
    assert "- Punkte: je gewonnene Map ein Punkt (3:2 ergibt 3 und 2 Punkte, 3:0 ergibt 3 und 0)." in out
    assert "Sieg 3" not in out
    assert "- Bei Punktgleichheit entscheidet der Reihe nach: mehr Siege, direkter Vergleich (Punkte, Map-Differenz, gewonnene Maps), " \
           "Map-Differenz, Entscheid der Liga-Leitung." in out
    assert "wie zum Sieg der Serie nötig sind, der andere 0." in out, "kampflos wie 3:0, auch bei „wie eingetragen“"
    assert "Beide Teams verlieren - keine Punkte, keine Maps." in out
    before = facts.table_data(SEASON, [])
    assert before["points_mode"] == "result"
    assert blocks.value("table", {"data": before}) != blocks.value("table", {"data": data})
    frozen = {key: value for key, value in before.items() if key != "points_mode"}
    assert blocks.value("table", {"data": frozen}) == blocks.value("table", {"data": before}), "ältere Fassung bleibt gleich"
    ctx = context()
    ctx.table = data
    assert variables.value_of("table.points", ctx) == "je gewonnene Map ein Punkt (3:2 ergibt 3 und 2 Punkte, 3:0 ergibt 3 und 0)"
    assert variables.value_of("table.points", context()) == "Sieg 3, Niederlage 0 Punkte"
    # Punkte je Sieg/Remis/Niederlage gibt es mit Map-Punkten nicht - ein eigener Wert, damit ein Text damit als geändert gilt.
    for name in ("table.points_win", "table.points_draw", "table.points_loss"):
        assert variables.value_of(name, ctx) == "– (Punkte je gewonnene Map)", name
    assert variables.value_of("table.points_win", context()) == "3"


# ---------------------------------------------------------------- Termine, Spielberechtigung

def test_schedule_block_with_and_without_d1_rules():
    data = facts.schedule_data(SEASON)
    assert data["start_day"] == "2026-11-10" and data["end_day"] == "2027-01-18" and data["weekday_from"] == 1 and data["weekday_to"] == 0
    out = facts.render_schedule(data)
    assert "- Season: 10 Spielwochen vom 10.11.2026 bis 18.01.2027." in out
    assert "- Spielwoche: 7 Tage, Dienstag bis Montag." in out and "- Standardtermin: Sonntag, 20:00 Uhr" in out
    assert "Weihnachts/pause 21.12.2026–03.01.2027" in plain(out), "der Strich im Namen wird „/“"
    assert "- Antwortfrist auf Terminvorschläge: 72 Stunden." in out
    assert "gilt nach 72 Stunden" in out and "höchstens 2 je Spiel" in out and "24 Stunden vor dem Termin" in out and "überfällig nach 48 Stunden" in out
    plain_out = facts.render_schedule(facts.schedule_data({**SEASON, "schedule_rules": None, "blocked_periods": [], "match_schedule_response_hours": None}))
    assert "- Sperrzeiten: keine." in plain_out and "Antwortfrist" not in plain_out
    assert "Verschiebungen entscheidet die Liga-Leitung" in plain_out and "72-h-Regel" not in plain_out


def test_schedule_block_names_the_result_reminder_only_when_it_is_on():
    """E.5 (#1647, N9): Ist „Ergebnis fehlt“ für die Season aus, nennt der Regeltext keine Erinnerung - nur „überfällig“."""
    on = facts.render_schedule(facts.schedule_data(SEASON))
    assert "- Ergebnis: Erinnerung 24 Stunden nach dem Termin ohne Meldung, überfällig nach 48 Stunden." in on
    off = facts.render_schedule(facts.schedule_data({**SEASON, "reminder_rules": {"result_missing": False}}))
    assert "Erinnerung" not in off and "- Ergebnis: ohne Meldung überfällig nach 48 Stunden." in off


PLATFORM = {"field": "Platt|form", "platforms": "PC und PlayStation", "crossplay": "aus", "input_device": "Controller",
            "divisions": [{"label": "Liga 2", "platforms": "PC", "crossplay": None, "input_device": None}]}


def test_eligibility_block_lists_b3_with_id_fields_and_the_platform():
    data = facts.eligibility_data(SEASON, ["Activision-ID", "PSN|ID"])
    assert data["platform"] is None
    out = facts.render_eligibility(data)
    assert "- Zulassung: nur Vereinsmitglieder." in out and "- Mindestalter: 18 Jahre" in out
    assert "Activision-ID, PSN/ID" in plain(out) and "Jede Spiel-ID gilt nur einmal je Season." in out
    assert "- Ein Co-Team je Season" in out and "warten 7 Tage" in out and "- Stichtag für den Kader: 06.11.2026" in out
    assert "- Transferfenster: Winterfenster 01.12.2026–07.12.2026." in out
    assert "Plattform" not in out
    loose = facts.render_eligibility(facts.eligibility_data({"min_age": 0, "one_team_per_season": False}, []))
    assert "- Mindestalter: keine Vorgabe." in loose and "keine Spiel-ID vorgeschrieben" in loose and "- Wartezeit: keine" in loose
    assert "Transfer" not in loose
    # Plattform je Season (#2270): Feld, erlaubte Plattformen, Crossplay, Eingabegerät und die Abweichungen je Liga N - Namen als Text.
    with_platform = facts.render_eligibility(facts.eligibility_data(SEASON, ["ID"], platform=PLATFORM))
    assert "- Plattform: PC und PlayStation (Feld „Platt/form“) · Crossplay aus · Eingabegerät: Controller." in plain(with_platform)
    assert "- Abweichend in Liga 2: PC." in plain(with_platform)
    every = facts.render_eligibility(facts.eligibility_data(SEASON, [], platform={"field": "Plattform", "platforms": "alle Plattformen",
                                                                                   "crossplay": None, "input_device": None, "divisions": []}))
    assert "- Plattform: alle Plattformen (Feld „Plattform“)." in plain(every)


def test_eligibility_block_names_how_applications_are_accepted():
    """#2348: je nach Einstellung „automatisch angenommen“ oder „die Liga-Leitung prüft“ - ohne Anmeldefenster und in älteren Fassungen keine Zeile."""
    auto = facts.render_eligibility(facts.eligibility_data({**SEASON, "application_auto_accept": True}, []))
    assert "- Annahme: Anmeldungen werden automatisch angenommen, solange ein Startplatz frei ist; sind alle vergeben oder wartet schon jemand, " \
           "kommen sie auf die Warteliste; die Liga-Leitung kann nachträglich mit Grund ablehnen oder auf die Warteliste zurückstufen." in auto
    by_lead = facts.render_eligibility(facts.eligibility_data(SEASON, []))
    assert "- Annahme: Die Liga-Leitung prüft jede Anmeldung." in by_lead
    no_window = facts.eligibility_data({**SEASON, "application_opens_at": None, "application_closes_at": None, "application_auto_accept": True}, [])
    assert no_window["auto_accept"] is None and "Annahme" not in facts.render_eligibility(no_window)
    frozen = {key: value for key, value in facts.eligibility_data(SEASON, []).items() if key != "auto_accept"}
    assert "Annahme" not in blocks.value("eligibility", {"data": frozen}), "eine früher eingefrorene Fassung bleibt, wie sie war"
    ctx = context()
    assert variables.value_of("application.acceptance", ctx) == "Die Liga-Leitung prüft jede Anmeldung"
    ctx.eligibility = facts.eligibility_data({**SEASON, "application_auto_accept": True}, [])
    assert variables.value_of("application.acceptance", ctx) == facts.AUTO_ACCEPT_WORDS[True]
    assert "wartet schon jemand" in facts.AUTO_ACCEPT_WORDS[True] and "mit Grund" in facts.AUTO_ACCEPT_WORDS[True]
    ctx.eligibility = no_window
    assert variables.value_of("application.acceptance", ctx) is None


def test_every_block_render_is_free_of_protected_marks_in_data_and_api_text():
    pool_data = facts.modes_data(SEASON, GAME, POOL)
    for key, data in (("modes", pool_data), ("format", facts.format_data(SEASON, DIVISIONS)), ("table", facts.table_data(SEASON, DIVISIONS)),
                      ("schedule", facts.schedule_data(SEASON)), ("eligibility", facts.eligibility_data(SEASON, ["ID"]))):
        assert no_protected(str(data)), key
        assert no_protected(served(blocks.value(key, {"data": data}, "markdown"))), key
        assert no_protected(blocks.plain_value(key, {"data": data})), key


# ---------------------------------------------------------------- Variablen

def context() -> variables.Context:
    ctx = variables.Context(league={"id": "l1", "name": "Regel-Liga"}, season=SEASON, game=GAME, pool=POOL, divisions=DIVISIONS, id_fields=["Activision-ID"])
    ctx.modes = facts.modes_data(SEASON, GAME, POOL)
    ctx.format = facts.format_data(SEASON, DIVISIONS)
    ctx.table = facts.table_data(SEASON, DIVISIONS)
    ctx.schedule = facts.schedule_data(SEASON)
    ctx.eligibility = facts.eligibility_data(SEASON, ctx.id_fields, platform=PLATFORM)
    return ctx


def test_variable_names_in_the_text_and_the_values():
    assert variables.var_names("Best of {{best_of}}, {{ Best_Of }} und {{mode:stellung.target}}", "{{table.points_win}}") == [
        "best_of", "mode:stellung.target", "table.points_win"]
    ctx = context()
    expected = {"league.name": "Regel-Liga", "game.name": "Probe-Shooter", "season.name": "Season 1", "season.number": "1",
                "season.start": "10.11.2026", "season.end": "18.01.2027", "season.weeks": "10", "best_of": "3", "maps_to_win": "2",
                "team_size": "4", "min_squad_size": "4", "max_squad_size": "50", "map_repeat": "nur in einem anderen Modus",
                "lineup_mode": "Teilnehmerliste je Spiel", "lineup_min_players": "3", "result_confirm_hours": "48 Stunden",
                "lineup_amend_hours": "48 Stunden", "schedule.matchday_days": "7", "schedule.default_weekday": "Sonntag",
                "schedule.default_time": "20:00", "schedule.default_slot": "Sonntag, 20:00 Uhr", "schedule.response_hours": "72 Stunden",
                "schedule.blocked_periods": "Weihnachts|pause 21.12.2026–03.01.2027", "schedule.home_rule_hours": "72 Stunden",
                "schedule.reschedule_max": "2", "schedule.reschedule_notice_hours": "24 Stunden", "schedule.result_reminder_hours": "24 Stunden",
                "schedule.result_overdue_hours": "48 Stunden", "table.points_win": "3", "table.points_draw": "0", "table.points_loss": "0",
                "table.draws": "nicht möglich", "table.head_to_head": "Punkte, Map-Differenz, gewonnene Maps",
                "eligibility.min_age": "18 Jahre", "eligibility.wait_days": "7 Tage", "eligibility.roster_deadline": "06.11.2026",
                "eligibility.transfer_windows": "Winterfenster 01.12.2026–07.12.2026", "eligibility.entry_policy": "nur Vereinsmitglieder",
                "eligibility.id_fields": "Activision-ID", "eligibility.platform": "PC und PlayStation", "eligibility.crossplay": "aus",
                "eligibility.input_device": "Controller", "application.opens": "01.11.2026, 00:00 Uhr", "application.closes": "06.11.2026, 23:59 Uhr",
                "application.slots": "16", "mode:stellung.name": "Stellung **fett** [x](y)", "mode:stellung.target": "300",
                "mode:stellung.time_limit": "10 Min.", "mode:stellung.overtime": "ja", "mode:stellung.draw": "nein", "mode:stellung.players": "4",
                "mode:suchen.round_limit": "11", "mode:suchen.round_time": "1:30 Min.",
                "mode:suchen.rule": "6 gewonnene Runden, höchstens 11 Runden · keine Verlängerung · kein Remis"}
    for name, value in expected.items():
        assert variables.value_of(name, ctx) == value, name
    assert variables.value_of("table.tiebreakers", ctx).startswith("direkter Vergleich (Punkte")
    assert variables.value_of("mode:frei.rule", ctx) == "keine Ergebnisregel hinterlegt", "auch ein archivierter Modus des Spiels"
    assert variables.value_of("mode:frei.target", ctx) is None and variables.value_of("mode:frei.overtime", ctx) is None
    names = {row["name"] for row in variables.catalog(ctx)}
    assert set(expected) <= names and "mode:frei.name" in names
    assert all(row["token"] == "{{" + row["name"] + "}}" and row["group"] for row in variables.catalog(ctx))


def test_unknown_empty_and_season_free_variables():
    ctx = context()
    assert variables.unknown(["best_of", "gibtsnicht", "mode:stellung.target", "mode:stellung.farbe", "mode:gibtsnicht.name"], GAME) == [
        "gibtsnicht", "mode:stellung.farbe", "mode:gibtsnicht.name"]
    bare = variables.Context(league=ctx.league, season={**SEASON, "max_squad_size": None, "schedule_rules": None, "application_slots": None}, game=GAME)
    bare.format = facts.format_data(bare.season, [])
    bare.schedule = facts.schedule_data(bare.season)
    frozen = variables.resolve(["max_squad_size", "schedule.reschedule_max", "application.slots", "best_of"], bare)
    assert variables.empty(list(frozen), frozen) == ["max_squad_size", "schedule.reschedule_max", "application.slots"]
    assert variables.fill_vars("Kader bis {{max_squad_size}}, Best of {{best_of}}", frozen, missing="(je Season)") == (
        "Kader bis (nicht festgelegt), Best of 3")
    # Ohne Season (Seite der Liga) gibt es nur, was ohne Season gilt - der Rest bleibt mit Hinweis stehen, nie leer.
    league_only = variables.Context(league=ctx.league, season=None, game=GAME)
    frozen = variables.resolve(["league.name", "game.name", "best_of", "mode:stellung.name", "mode:stellung.target"], league_only)
    assert set(frozen) == {"league.name", "game.name", "mode:stellung.name", "mode:stellung.target"}
    assert frozen["mode:stellung.target"]["value"] == "250", "ohne Season die Regel des Spiels"
    assert variables.fill_vars("{{league.name}}: Best of {{best_of}}", frozen, missing=variables.NO_SEASON_VALUE) == "Regel-Liga: Best of (je Season)"


def test_preset_variables_use_the_default_until_the_season_carries_the_field():
    """Vorab angelegt (E.2, E.3, D.5): ohne Season-Feld die Vorgabe, mit Feld dessen Wert, ohne Season nichts - kein „(nicht festgelegt)“."""
    ctx = context()
    assert {name: variables.value_of(name, ctx) for name in (
        "protest.hours", "appeal.hours", "evidence.keep_days", "match.break_after_map", "match.break_minutes")} == {
        "protest.hours": "48 Stunden", "appeal.hours": "48 Stunden", "evidence.keep_days": "30 Tage",
        "match.break_after_map": "2", "match.break_minutes": "5 Min."}
    later = variables.Context(league=ctx.league, season={**SEASON, "protest_hours": 72, "appeal_hours": 24, "evidence_keep_days": 60,
                                                         "map_break_after": 3, "map_break_minutes": 10}, game=GAME)
    assert {name: variables.value_of(name, later) for name in (
        "protest.hours", "appeal.hours", "evidence.keep_days", "match.break_after_map", "match.break_minutes")} == {
        "protest.hours": "72 Stunden", "appeal.hours": "24 Stunden", "evidence.keep_days": "60 Tage",
        "match.break_after_map": "3", "match.break_minutes": "10 Min."}, "jede Variable liest ihr eigenes Feld"
    league_only = variables.Context(league=ctx.league, season=None, game=GAME)
    assert variables.value_of("protest.hours", league_only) is None, "auf der Seite der Liga „(je Season)“"
    frozen = variables.resolve(["protest.hours", "match.break_minutes"], ctx)
    assert variables.empty(list(frozen), frozen) == [], "eine Vorgabe ist kein leerer Wert"
    assert variables.unknown(["protest.hours", "appeal.hours", "evidence.keep_days", "match.break_after_map", "match.break_minutes"], GAME) == []


def test_a_value_is_set_as_text_never_as_markdown():
    frozen = variables.resolve(["mode:stellung.name"], context())
    filled = variables.fill_vars("Modus {{mode:stellung.name}} gilt", frozen, missing="?")
    assert "**" not in filled and "[x](y)" not in filled, "geschützt: kein Fett, kein Link"
    assert served(filled) == "Modus Stellung \\*\\*fett\\*\\* \\[x\\]\\(y\\) gilt"
    assert variables.fill_vars("{{mode:stellung.name}}", frozen, missing="?", plain=True) == "Stellung **fett** [x](y)"
    assert no_protected(str(frozen)), "eingefroren wird Klartext"
