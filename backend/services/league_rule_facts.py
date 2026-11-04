"""Bausteine des Regelwerks aus den Einstellungen der Season (docs/LIGA.md, „Regelwerk aus den Einstellungen“, #2269): Modi,
Spielformat, Tabelle und Wertung, Termine, Spielberechtigung. Jeder Baustein liefert seine Daten strukturiert im Klartext (``data``,
so wird eingefroren) und macht erst beim Darstellen Markdown daraus - Web (``markdown``, mit Symbolen) und PDF/Vergleich (``text``).
Jeder Wert aus der Verwaltung geht durch ``markdown_text.text_cell``: nie ein Link, nie fett, nie eine Tabellenspalte.

Kein Wert eines Titels steht hier; die Sätze beschreiben nur, was die Einstellung bedeutet. Blatt-Modul für ``league_rule_blocks``
(das die Bausteine registriert) und ``league_rule_vars`` (die Variablen lesen dieselben Daten).
"""
from __future__ import annotations

from datetime import date

from models import normalize_rule, rule_time_limit_seconds
from services import game_maps, league_platform, map_pools, mode_icons
from services.league_schedule import DEFAULTS as SCHEDULE_DEFAULTS, ScheduleProblem, normalize as normalize_schedule
from services.markdown_text import text_cell
from services.scoring_rules import normalize_rules

MARKDOWN, TEXT = "markdown", "text"
# Symbol eines Modus (#2266): ein Markdown-Bild mit genau diesem Text vor dem Namen, nur in ``markdown``. Das Web zeigt es klein (rules.css).
ICON_ALT = "Modus-Symbol"
NO_MODES = "*Für diese Season sind noch keine Modi festgelegt.*"
NOT_SET = "–"
WEEKDAYS = ("Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag")
MAP_REPEAT_WORDS = {
    "other_mode": "Dieselbe Map darf in einer Serie nur in einem anderen Modus noch einmal gespielt werden.",
    "never": "Jede Map wird in einer Serie höchstens einmal gespielt.",
    "always": "Maps dürfen sich in einer Serie wiederholen.",
}
MAP_REPEAT_SHORT = {"other_mode": "nur in einem anderen Modus", "never": "jede Map nur einmal", "always": "frei"}
TIEBREAKER_WORDS = {"head_to_head": "direkter Vergleich", "score_diff": "Map-Differenz", "score_for": "gewonnene Maps",
                    "wins": "mehr Siege", "lead_decision": "Entscheid der Liga-Leitung"}
CRITERION_WORDS = {"points": "Punkte", "score_diff": "Map-Differenz", "score_for": "gewonnene Maps"}
ENTRY_POLICY_WORDS = {"all": "alle Konten", "members": "nur Vereinsmitglieder"}
LINEUP_WORDS = {"series": "Teilnehmerliste je Spiel", "per_map": "Aufstellung je Map"}

_cell = text_cell


# ---------------------------------------------------------------- gemeinsame Helfer

def icon_markdown(url: str | None, variant: str) -> str:
    """Das Symbol als Markdown vor dem Namen - nur in ``markdown`` und nur Raster-Bilder aus dem eigenen Upload (keine SVG im Regelwerk)."""
    found = mode_icons.raster_icon(url) if variant == MARKDOWN else None
    return f"![{ICON_ALT}]({found}) " if found else ""


def duration(seconds) -> str:
    """Sekunden lesbar: volle Minuten als „10 Min.“, sonst „1:30 Min.“ bzw. „0:45 Min.“."""
    total = int(seconds or 0)
    minutes, rest = divmod(total, 60)
    return f"{minutes} Min." if not rest else f"{minutes}:{rest:02d} Min."


def number(value) -> str:
    """Eine Zahl, wie Menschen sie lesen: 250 statt 250.0, 12,5 statt 12.5."""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).replace(".", ",")


def day_label(value) -> str:
    """Ein Wiener Kalendertag ``JJJJ-MM-TT`` als „TT.MM.JJJJ“ - alles andere unverändert."""
    text = str(value or "")
    try:
        parsed = date.fromisoformat(text[:10])
    except ValueError:
        return text
    return f"{parsed.day:02d}.{parsed.month:02d}.{parsed.year}"


def hours(value) -> str:
    count = int(value or 0)
    return f"{count} Stunde" if count == 1 else f"{count} Stunden"


def days(value) -> str:
    count = int(value or 0)
    return f"{count} Tag" if count == 1 else f"{count} Tage"


def players(value) -> str:
    count = int(value or 0)
    return f"{count} Spieler"


def maps_to_win(best_of) -> int:
    return int(best_of or 1) // 2 + 1


def period_label(period: dict) -> str:
    """„Weihnachtspause 21.12.2026–03.01.2027“ - ohne Namen nur die Tage."""
    label = " ".join(str(period.get("label") or "").split())
    span = f"{day_label(period.get('start_date'))}–{day_label(period.get('end_date'))}"
    return f"{label} {span}" if label else span


async def game_of(db, league: dict) -> dict | None:
    if not league.get("game_id"):
        return None
    return await db.games.find_one({"id": league["game_id"]}, {"_id": 0})


async def divisions_of(db, season: dict) -> list[dict]:
    return await db.league_divisions.find({"season_id": season["id"], "status": "active"}, {"_id": 0}).sort("level", 1).to_list(50)


def _division_label(division: dict) -> str:
    from services.league_service import division_label

    return division_label(division)


def _mode_docs(game: dict | None) -> dict[str, dict]:
    modes = (game or {}).get("match_modes")
    return {mode["mode"]: mode for mode in modes if isinstance(mode, dict) and mode.get("mode")} if isinstance(modes, list) else {}


# ---------------------------------------------------------------- Modi der Season

def rule_sentence(rule: dict | None) -> str:
    """Die Ergebnisregel in Klartext: Ziel, Rundenlimit, Verlängerung, Remis - alles ausdrücklich, nichts still."""
    if not rule or not rule.get("kind"):
        return "keine Ergebnisregel hinterlegt"
    kind = rule.get("kind")
    if kind == "score":
        head = f"Punkte bis zum Ziel {number(rule.get('target'))}"
    elif kind == "rounds":
        head = f"{number(rule.get('target'))} gewonnene Runden"
        if rule.get("round_limit"):
            head += f", höchstens {number(rule.get('round_limit'))} Runden"
    else:
        head = "Der höhere Endstand gewinnt"
    overtime = "Verlängerung bei Gleichstand" if rule.get("overtime") else "keine Verlängerung"
    draw = "Remis möglich" if rule.get("draw_allowed") else "kein Remis"
    return " · ".join((head, overtime, draw))


def time_sentence(rule: dict | None) -> str:
    """„10 Min. je Map · 1:30 Min. je Runde“ - ohne Zeiten ein Strich."""
    parts = []
    if (rule or {}).get("time_limit_seconds"):
        parts.append(f"{duration(rule['time_limit_seconds'])} je Map")
    if (rule or {}).get("round_time_seconds"):
        parts.append(f"{duration(rule['round_time_seconds'])} je Runde")
    return " · ".join(parts) or NOT_SET


def _season_rule(season: dict, game: dict | None, key: str) -> dict | None:
    """Die Regel eines Modus: die Kopie der Season (C.3), bei älteren Seasons ohne Kopie die des Spiels - mit Zeiten in Sekunden."""
    held = season.get("result_rules")
    if isinstance(held, dict):
        rule = held.get(key)
    else:
        rule = (_mode_docs(game).get(key) or {}).get("result_rule")
    if not isinstance(rule, dict) or not rule.get("kind"):
        return None
    rule = dict(normalize_rule(rule))
    seconds = rule_time_limit_seconds(rule)
    return {"kind": rule.get("kind"), "target": rule.get("target"), "round_limit": rule.get("round_limit"),
            "time_limit_seconds": seconds, "round_time_seconds": rule.get("round_time_seconds") or None,
            "overtime": bool(rule.get("overtime")), "draw_allowed": bool(rule.get("draw_allowed"))}


def season_mode_keys(season: dict, game: dict | None, pool: dict | None) -> list[str]:
    """Die Modi der Season: die des geltenden Pools (in seiner Reihenfolge), dann die der Modusfolge; ohne beides alle nicht
    archivierten Modi des Spiels."""
    keys: list[str] = []
    for group in (pool or {}).get("modes") or []:
        if group.get("mode") and group["mode"] not in keys:
            keys.append(group["mode"])
    for key in season.get("game_mode_order") or []:
        if key and key not in keys:
            keys.append(key)
    if not keys:
        keys = [key for key, doc in _mode_docs(game).items() if doc.get("status") != "archived"]
    return keys


def modes_data(season: dict, game: dict | None, pool: dict | None) -> dict:
    """Die Daten des Bausteins: je Modus Name (heutiger Name des Spiels), Symbol, Spieler je Seite, Beschreibung und Regel."""
    docs = _mode_docs(game)
    pool_labels = {group.get("mode"): group.get("label") for group in (pool or {}).get("modes") or []}
    rows = []
    for key in season_mode_keys(season, game, pool):
        doc = docs.get(key) or {}
        row = {"mode": key, "label": doc.get("label") or pool_labels.get(key) or key,
               "players_per_side": doc.get("players_per_side") or None,
               "description": " ".join(str(doc.get("description") or "").split()),
               "rule": _season_rule(season, game, key)}
        if doc.get("icon_url"):
            row["icon_url"] = doc["icon_url"]
        rows.append(row)
    return {"rows": rows}


def render_modes(data: dict, variant: str = MARKDOWN) -> str:
    """Tabelle Modus · Ergebnisregel · Zeit · Spieler je Seite; die Beschreibung als Zeile darunter, wenn es eine gibt."""
    rows = data.get("rows") or []
    if not rows:
        return NO_MODES
    lines = ["| Modus | Ergebnisregel | Zeit | Spieler je Seite |", "| --- | --- | --- | --- |"]
    for row in rows:
        lines.append(f"| {icon_markdown(row.get('icon_url'), variant)}{_cell(row.get('label'))} | {_cell(rule_sentence(row.get('rule')))} "
                     f"| {_cell(time_sentence(row.get('rule')))} | {players(row['players_per_side']) if row.get('players_per_side') else NOT_SET} |")
    notes = [f"- {_cell(row.get('label'))}: {_cell(row['description'])}" for row in rows if row.get("description")]
    return "\n".join(lines + ([""] + notes if notes else []))


async def build_modes(db, league: dict, season: dict) -> dict:
    game = await game_of(db, league)
    pool = map_pools.valid_for(await map_pools.current(db, "league_season", season["id"]), league.get("game_id"))
    data = modes_data(season, game, pool)
    return {"source": {"modes": [row["mode"] for row in data["rows"]], "map_pool_id": (pool or {}).get("id")}, "data": data}


def modes_images(data: dict) -> list[str]:
    urls: list[str] = []
    for row in data.get("rows") or []:
        url = mode_icons.raster_icon(row.get("icon_url"))
        if url and url not in urls:
            urls.append(url)
    return urls


# ---------------------------------------------------------------- Spielformat

FORMAT_KEYS = ("best_of", "team_size", "min_squad_size")


def _effective(season: dict, division: dict | None) -> dict:
    from services.league_service import effective_settings

    return effective_settings(season, division)


def format_data(season: dict, divisions: list[dict]) -> dict:
    base = _effective(season, None)
    data = {"best_of": int(base.get("best_of") or 1), "maps_to_win": maps_to_win(base.get("best_of")),
            "team_size": int(base.get("team_size") or 1), "min_squad_size": base.get("min_squad_size"),
            "max_squad_size": season.get("max_squad_size") or None, "map_repeat": base.get("map_repeat") or "other_mode",
            "lineup_mode": season.get("lineup_mode") or "per_map", "lineup_min_players": season.get("lineup_min_players") or None,
            "divisions": []}
    for division in divisions:
        merged = _effective(season, division)
        if any(merged.get(key) != base.get(key) for key in FORMAT_KEYS):
            data["divisions"].append({"label": _division_label(division), **{key: merged.get(key) for key in FORMAT_KEYS}})
    return data


def render_format(data: dict, variant: str = MARKDOWN) -> str:
    lines = [f"- Serie: Best of {data.get('best_of')} – gewonnen hat, wer {data.get('maps_to_win')} Maps gewinnt.",
             f"- Teamgröße: {players(data.get('team_size'))} je Map."]
    if data.get("max_squad_size"):
        lines.append(f"- Kader: mindestens {data.get('min_squad_size') or 1}, höchstens {data['max_squad_size']} Spieler.")
    else:
        lines.append(f"- Kader: mindestens {players(data.get('min_squad_size') or 1)}.")
    lines.append(f"- Map-Wiederholung: {MAP_REPEAT_WORDS.get(data.get('map_repeat'), MAP_REPEAT_WORDS['other_mode'])}")
    if data.get("lineup_mode") == "series":
        lines.append(f"- Teilnehmerliste: einmal je Spiel, mindestens {players(data.get('lineup_min_players') or 1)}.")
    else:
        lines.append("- Aufstellung: je Map.")
    for row in data.get("divisions") or []:
        parts = [f"Best of {row.get('best_of')}", f"Teamgröße {row.get('team_size')}", f"Mindestkader {row.get('min_squad_size')}"]
        lines.append(f"- Abweichend in {_cell(row.get('label'))}: {', '.join(parts)}.")
    return "\n".join(lines)


async def build_format(db, league: dict, season: dict) -> dict:
    data = format_data(season, await divisions_of(db, season))
    return {"source": {key: data.get(key) for key in ("best_of", "team_size", "min_squad_size", "max_squad_size", "map_repeat")}, "data": data}


# ---------------------------------------------------------------- Tabelle und Wertung

TABLE_KEYS = ("points", "allow_draws", "tiebreakers", "head_to_head", "forfeit_score", "exit_rule")


def _table_rules(raw) -> dict:
    rules = normalize_rules(raw if isinstance(raw, dict) else {})
    return {"points": {key: rules["match_points"].get(key) for key in ("win", "draw", "loss")}, "allow_draws": bool(rules.get("allow_draws")),
            "tiebreakers": list(rules.get("table_tiebreakers") or []), "head_to_head": list(rules.get("head_to_head_criteria") or []),
            "forfeit_score": rules.get("forfeit_score") or "recorded", "exit_rule": rules.get("exit_rule") or "half"}


def table_data(season: dict, divisions: list[dict]) -> dict:
    base = _table_rules(season.get("scoring_rules"))
    data = {**base, "divisions": []}
    for division in divisions:
        own = (division.get("overrides") or {}).get("scoring_rules")
        if isinstance(own, dict):
            merged = _table_rules(own)
            if any(merged.get(key) != base.get(key) for key in TABLE_KEYS):
                data["divisions"].append({"label": _division_label(division), **merged})
    return data


def tiebreakers_sentence(rules: dict) -> str:
    """„direkter Vergleich (Punkte, Map-Differenz, gewonnene Maps), Map-Differenz, gewonnene Maps, Entscheid der Liga-Leitung“."""
    words = []
    for key in rules.get("tiebreakers") or []:
        word = TIEBREAKER_WORDS.get(key, key)
        if key == "head_to_head":
            word += " (" + ", ".join(CRITERION_WORDS.get(item, item) for item in rules.get("head_to_head") or []) + ")"
        words.append(word)
    return ", ".join(words) or "Teams teilen sich den Platz"


def forfeit_sentence(rules: dict) -> str:
    if rules.get("forfeit_score") == "best_of":
        return "Der Sieger bekommt so viele Maps, wie zum Sieg der Serie nötig sind, der andere 0."
    return "Gewertet wird, was die Liga-Leitung einträgt."


def exit_sentence(rules: dict) -> str:
    if rules.get("exit_rule") == "all_for_opponents":
        return ("Tritt ein Team aus oder wird es disqualifiziert, zählt jedes seiner Spiele - auch die gespielten - als kampflos für den "
                "Gegner; das Team steht am Tabellenende.")
    return ("Scheidet ein Team vor der Hälfte seiner Spiele aus, werden seine Spiele annulliert; danach werden die offenen Spiele kampflos "
            "verloren gewertet und der Platz richtet sich nach den Punkten.")


def _table_lines(rules: dict) -> list[str]:
    points = rules.get("points") or {}
    if rules.get("allow_draws"):
        scored = f"Sieg {number(points.get('win'))}, Remis {number(points.get('draw'))}, Niederlage {number(points.get('loss'))} Punkte"
        draws = "Eine Serie darf unentschieden enden."
    else:
        scored = f"Sieg {number(points.get('win'))}, Niederlage {number(points.get('loss'))} Punkte"
        draws = "Jede Serie hat einen Sieger - ein Remis gibt es nicht."
    return [f"- Punkte: {scored}.", f"- Remis: {draws}",
            f"- Bei Punktgleichheit entscheidet der Reihe nach: {tiebreakers_sentence(rules)}.",
            f"- Kampflos (Default-Win): {forfeit_sentence(rules)}",
            "- Beide nicht erschienen: Beide Teams verlieren - Niederlagenpunkte, keine Maps.",
            f"- Ausscheiden: {exit_sentence(rules)}"]


def render_table(data: dict, variant: str = MARKDOWN) -> str:
    lines = _table_lines(data)
    for row in data.get("divisions") or []:
        lines += ["", f"**Abweichend in {_cell(row.get('label'))}**", "", *_table_lines(row)]
    return "\n".join(lines)


async def build_table(db, league: dict, season: dict) -> dict:
    data = table_data(season, await divisions_of(db, season))
    return {"source": {key: data.get(key) for key in TABLE_KEYS}, "data": data}


# ---------------------------------------------------------------- Termine

def schedule_rules_of(season: dict) -> dict | None:
    """Die Terminregeln (D.1) der Season - ``None`` ohne das Feld; ein von Hand verbogener Wert zählt wie die Vorgaben."""
    raw = season.get("schedule_rules")
    if not isinstance(raw, dict):
        return None
    try:
        return normalize_schedule({key: value for key, value in raw.items() if key in SCHEDULE_DEFAULTS})
    except ScheduleProblem:
        return dict(SCHEDULE_DEFAULTS)


def schedule_data(season: dict) -> dict:
    from services.league_service import week_days

    weeks = week_days(season)
    first, last = (weeks[0][0], weeks[-1][1]) if weeks else (None, None)
    return {
        "weeks_total": int(season.get("weeks_total") or 0),
        "start_day": first.isoformat() if first else None, "end_day": last.isoformat() if last else None,
        "matchday_days": int(season.get("matchday_days") or 7),
        "weekday_from": first.weekday() if first else None, "weekday_to": weeks[0][1].weekday() if weeks else None,
        "default_weekday": season.get("default_match_weekday") if season.get("default_match_weekday") is not None else 6,
        "default_time": str(season.get("default_match_time") or "20:00"),
        "blocked_periods": [{"label": " ".join(str(row.get("label") or "").split()), "start_date": row.get("start_date"), "end_date": row.get("end_date")}
                            for row in season.get("blocked_periods") or [] if isinstance(row, dict)],
        "response_hours": season.get("match_schedule_response_hours") or None,
        "rules": schedule_rules_of(season),
    }


def default_slot(data: dict) -> str:
    """„Sonntag, 20:00 Uhr“."""
    return f"{WEEKDAYS[int(data.get('default_weekday') or 0) % 7]}, {data.get('default_time') or '20:00'} Uhr"


def week_sentence(data: dict) -> str:
    """„7 Tage, Dienstag bis Montag“ bzw. „3 Tage“."""
    count = int(data.get("matchday_days") or 7)
    if data.get("weekday_from") is not None and data.get("weekday_to") is not None and count == 7:
        return f"{days(count)}, {WEEKDAYS[data['weekday_from']]} bis {WEEKDAYS[data['weekday_to']]}"
    return days(count)


def render_schedule(data: dict, variant: str = MARKDOWN) -> str:
    lines = []
    if data.get("start_day") and data.get("end_day"):
        lines.append(f"- Season: {data.get('weeks_total')} Spielwochen vom {day_label(data['start_day'])} bis {day_label(data['end_day'])}.")
    else:
        lines.append(f"- Season: {data.get('weeks_total')} Spielwochen.")
    lines.append(f"- Spielwoche: {week_sentence(data)}.")
    lines.append(f"- Standardtermin: {default_slot(data)} - gilt, wenn sich die Teams nicht anders einigen.")
    periods = data.get("blocked_periods") or []
    lines.append("- Sperrzeiten: " + (", ".join(_cell(period_label(row)) for row in periods) if periods else "keine") + ".")
    if data.get("response_hours"):
        lines.append(f"- Antwortfrist auf Terminvorschläge: {hours(data['response_hours'])}.")
    rules = data.get("rules")
    if rules:
        if rules.get("home_rule"):
            lines.append(f"- 72-h-Regel: Ein unbeantworteter Terminvorschlag des Heimteams gilt nach {hours(rules.get('home_rule_hours'))}.")
        else:
            lines.append("- 72-h-Regel: aus - ohne Einigung gilt der Standardtermin.")
        if int(rules.get("reschedule_max") or 0) > 0:
            where = "in derselben Spielwoche" if rules.get("reschedule_same_week") else "auch in einer anderen Spielwoche"
            lines.append(f"- Verschiebung: höchstens {rules['reschedule_max']} je Spiel durch die Teams, Antrag spätestens "
                         f"{hours(rules.get('reschedule_notice_hours'))} vor dem Termin, der neue Termin {where}. Alles darüber entscheidet die Liga-Leitung.")
        else:
            lines.append("- Verschiebung: nur durch die Liga-Leitung.")
        lines.append(f"- Ergebnis: Erinnerung {hours(rules.get('result_reminder_hours'))} nach dem Termin ohne Meldung, überfällig nach "
                     f"{hours(rules.get('result_overdue_hours'))}.")
    else:
        lines.append("- Verschiebung: Termine laufen über Terminvorschläge, Verschiebungen entscheidet die Liga-Leitung.")
    return "\n".join(lines)


async def build_schedule(db, league: dict, season: dict) -> dict:
    data = schedule_data(season)
    return {"source": {key: data.get(key) for key in ("start_day", "end_day", "default_weekday", "default_time", "response_hours")}, "data": data}


# ---------------------------------------------------------------- Spielberechtigung

async def id_field_labels(db, league: dict) -> list[str]:
    """Die Spiel-ID-Felder, die die Season verlangt - über die effektive ID-Quelle des Spiels (#2249)."""
    from services import league_roster

    game = await league_roster._game(db, league.get("game_id"))
    return [str(item.get("label") or item.get("key") or "") for item in league_roster.required_fields(game) if item.get("label") or item.get("key")]


async def platform_data(db, season: dict) -> dict | None:
    """Die Plattform je Season (#2270) im Klartext: Feld, erlaubte Plattformen, Crossplay, Eingabegerät und die Abweichungen je Liga N -
    ``None`` ohne jede Angabe."""
    block = await league_platform.season_block(db, season)
    if not block:
        return None
    rows = [{"label": row.get("label"), **row.get("values", {})} for row in block.get("divisions") or [] if row.get("differs")]
    return {"field": block.get("field_label"), **block.get("values", {}), "divisions": rows}


def _platform_extras(row: dict) -> str:
    """„ · Crossplay aus · Eingabegerät: Controller“ - nur, was festgelegt ist."""
    parts = []
    if row.get("crossplay"):
        parts.append(f"Crossplay {_cell(row['crossplay'])}")
    if row.get("input_device"):
        parts.append(f"Eingabegerät: {_cell(row['input_device'])}")
    return "".join(f" · {part}" for part in parts)


def eligibility_data(season: dict, id_fields: list[str], platform: dict | None = None) -> dict:
    from services.league_eligibility import rules_view

    rules = rules_view(season)
    return {
        "min_age": rules.get("min_age") or 0,
        "one_team_per_season": bool(rules.get("one_team_per_season")),
        "new_player_wait_days": rules.get("new_player_wait_days") or 0,
        "roster_deadline": rules.get("roster_deadline") or None,
        "transfer_windows": [{"label": " ".join(str(row.get("label") or "").split()), "start_date": row.get("start_date"), "end_date": row.get("end_date")}
                             for row in rules.get("transfer_windows") or [] if isinstance(row, dict)],
        "entry_policy": season.get("entry_policy") or "all",
        "unique_game_ids": bool(rules.get("unique_game_ids")),
        "id_fields": list(id_fields),
        # Plattform je Season (#2270, ``platform_data``): ``None`` ohne jede Angabe, dann keine Zeile.
        "platform": platform or None,
    }


def render_eligibility(data: dict, variant: str = MARKDOWN) -> str:
    lines = [f"- Zulassung: {ENTRY_POLICY_WORDS.get(data.get('entry_policy'), ENTRY_POLICY_WORDS['all'])}."]
    if data.get("min_age"):
        lines.append(f"- Mindestalter: {data['min_age']} Jahre am Prüftag, laut Geburtsdatum im Profil.")
    else:
        lines.append("- Mindestalter: keine Vorgabe.")
    fields = data.get("id_fields") or []
    if fields:
        unique = " Jede Spiel-ID gilt nur einmal je Season." if data.get("unique_game_ids") else ""
        lines.append(f"- Spiel-IDs: Jeder Spieler hinterlegt im Profil {', '.join(_cell(name) for name in fields)}.{unique}")
    else:
        lines.append("- Spiel-IDs: Für dieses Spiel ist keine Spiel-ID vorgeschrieben.")
    platform = data.get("platform")
    if platform:
        # Plattform je Season (#2270): erlaubte Plattformen (mit dem Feld, in dem sie steht), Crossplay und Eingabegerät, je Liga N die Abweichung.
        field = f" (Feld „{_cell(platform['field'])}“)" if platform.get("field") else ""
        lines.append(f"- Plattform: {_cell(platform.get('platforms') or league_platform.EVERY_PLATFORM)}{field}{_platform_extras(platform)}.")
        for row in platform.get("divisions") or []:
            lines.append(f"- Abweichend in {_cell(row.get('label'))}: {_cell(row.get('platforms') or league_platform.EVERY_PLATFORM)}{_platform_extras(row)}.")
    if data.get("one_team_per_season"):
        lines.append("- Ein Co-Team je Season: Eine Person steht in dieser Season nur in einem Co-Team; ein Wechsel geht nur als Transfer.")
    if data.get("new_player_wait_days"):
        lines.append(f"- Wartezeit: Neuzugänge nach dem Ende von Spieltag 1 warten {days(data['new_player_wait_days'])} ab der Aufnahme, "
                     "nach einem Transfer immer.")
    else:
        lines.append("- Wartezeit: keine - Neuzugänge spielen sofort.")
    if data.get("roster_deadline"):
        lines.append(f"- Stichtag für den Kader: {day_label(data['roster_deadline'])} - danach warten Neue auf die Freigabe der Liga-Leitung.")
    if data.get("one_team_per_season"):
        windows = data.get("transfer_windows") or []
        if windows:
            lines.append("- Transferfenster: " + ", ".join(_cell(period_label(row)) for row in windows) + ".")
        else:
            lines.append("- Transfers: In dieser Season gibt es keine Transferfenster.")
    return "\n".join(lines)


async def build_eligibility(db, league: dict, season: dict) -> dict:
    data = eligibility_data(season, await id_field_labels(db, league), platform=await platform_data(db, season))
    return {"source": {key: data.get(key) for key in ("min_age", "new_player_wait_days", "roster_deadline", "entry_policy", "id_fields", "platform")},
            "data": data}


# ---------------------------------------------------------------- Modi des Spiels (für Variablen und Auswahllisten)

def game_mode_labels(game: dict | None) -> dict[str, str]:
    return {row["mode"]: row["label"] for row in game_maps.game_modes(game)}
