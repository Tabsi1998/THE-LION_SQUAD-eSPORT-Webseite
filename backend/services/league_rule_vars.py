"""Variablen im Regelwerk (docs/LIGA.md, „Regelwerk aus den Einstellungen“, #2269): ``{{best_of}}``, ``{{mode:stellung.target}}`` …
stehen mitten im Satz und werden wie Bausteine aus der gültigen Season aufgelöst, beim Veröffentlichen je Season eingefroren
(``{name: {label, value}}``, Klartext) und beim Darstellen als Bausteinwert eingesetzt (``markdown_text.text_cell``: nie Link, nie fett).

Ein unbekannter Name wird nie still leer: Die Vorschau nennt ihn, das Veröffentlichen lehnt ab. Ein bekannter Name ohne Wert (die
Season trägt das Feld nicht) steht als „(nicht festgelegt)“ da. Kein Wert eines Titels steht hier - nur die Wege zu den Daten.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable

from services import league_rule_facts as facts, map_pools
from services.league_presets import PRESETS
from services.markdown_text import plain as plain_text, text_cell
from services.matchday_schedule import LOCAL_TZ

TOKEN = re.compile(r"\{\{\s*([A-Za-z0-9_.:-]+)\s*\}\}")
MISSING_VALUE = "(nicht festgelegt)"
NO_SEASON_VALUE = "(je Season)"
NOT_FROZEN_VALUE = "(noch nicht festgehalten)"
MODE_PREFIX = "mode:"
YES, NO = "ja", "nein"


@dataclass
class Context:
    """Alles, was die Variablen lesen - einmal je Liga und Season aufgebaut."""

    league: dict
    season: dict | None
    game: dict | None
    pool: dict | None = None
    divisions: list[dict] = field(default_factory=list)
    id_fields: list[str] = field(default_factory=list)
    modes: dict = field(default_factory=dict)
    format: dict = field(default_factory=dict)
    table: dict = field(default_factory=dict)
    schedule: dict = field(default_factory=dict)
    eligibility: dict = field(default_factory=dict)
    # Veto (D.3, #1618): ``{enabled: false}`` ohne Veto - die Variablen sind dann „(nicht festgelegt)“.
    veto: dict = field(default_factory=dict)


async def context(db, league: dict, season: dict | None) -> Context:
    game = await facts.game_of(db, league)
    ctx = Context(league=league, season=season, game=game)
    if season:
        ctx.pool = map_pools.valid_for(await map_pools.current(db, "league_season", season["id"]), league.get("game_id"))
        ctx.divisions = await facts.divisions_of(db, season)
        ctx.id_fields = await facts.id_field_labels(db, league)
        ctx.modes = facts.modes_data(season, game, ctx.pool)
        ctx.format = facts.format_data(season, ctx.divisions)
        ctx.table = facts.table_data(season, ctx.divisions)
        ctx.schedule = facts.schedule_data(season)
        ctx.eligibility = facts.eligibility_data(season, ctx.id_fields, platform=await facts.platform_data(db, season))
        ctx.veto = facts.veto_data(season, game)
    return ctx


# ---------------------------------------------------------------- Werte

def _local(value) -> str | None:
    """Ein Zeitpunkt (ISO, UTC) als Wiener „TT.MM.JJJJ, HH:MM Uhr“."""
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    local = moment.astimezone(LOCAL_TZ)
    return f"{local.day:02d}.{local.month:02d}.{local.year}, {local.hour:02d}:{local.minute:02d} Uhr"


def _count(value) -> str | None:
    return facts.number(value) if value is not None else None


def _season(ctx: Context, key: str):
    return (ctx.season or {}).get(key)


def _rules(ctx: Context) -> dict | None:
    return ctx.schedule.get("rules") if ctx.schedule else None


MAP_POINTS_VALUE = "– (Punkte je gewonnene Map)"


def _fixed_points(key: str) -> Callable[[Context], str | None]:
    """Punkte je Sieg, Remis oder Niederlage - mit Punkten nach gewonnenen Maps (#2312) gibt es sie nicht. Dann ein eigener Wert, damit
    ein Text mit der Variable als geändert gilt und das Regelwerk eine neue Freigabe vorschlägt."""
    def value(ctx: Context) -> str | None:
        if not ctx.table:
            return None
        if ctx.table.get("points_mode") == "maps":
            return MAP_POINTS_VALUE
        return _count((ctx.table.get("points") or {}).get(key))
    return value


def _rule_hours(key: str) -> Callable[[Context], str | None]:
    return lambda ctx: facts.hours((_rules(ctx) or {}).get(key)) if _rules(ctx) else None


def _periods(rows) -> str:
    return ", ".join(facts.period_label(row) for row in rows or []) or "keine"


# Vorgaben für Season-Felder, deren Einstellung erst mit einem späteren Paket kommt (E.2 Proteste, E.3 Strafen, D.5 Vorfälle):
# ``PRESETS`` steht seit #2360 im Blatt-Modul ``services/league_presets`` (auch die Aufbewahrung der Nachweise liest sie).


def _preset(key: str, default, show: Callable) -> Callable[[Context], str | None]:
    """Der Wert der Season, ohne Feld die Vorgabe - ohne Season keiner (auf der Liga-Seite steht dann „(je Season)“)."""
    def resolve(ctx: Context) -> str | None:
        if not ctx.season:
            return None
        value = ctx.season.get(key)
        return show(default if value in (None, "") else value)
    return resolve


@dataclass(frozen=True)
class Variable:
    name: str
    label: str
    hint: str
    group: str
    resolve: Callable[[Context], str | None]
    # Gilt auch ohne Season (Seite der Liga): Name von Liga und Spiel.
    season_free: bool = False

    @property
    def token(self) -> str:
        return "{{" + self.name + "}}"


def _static() -> list[Variable]:
    return [
        Variable("league.name", "Name der Liga", "Wie die Liga heißt.", "Season", lambda ctx: ctx.league.get("name"), True),
        Variable("game.name", "Name des Spiels", "Das Spiel der Liga.", "Season", lambda ctx: (ctx.game or {}).get("name"), True),
        Variable("season.name", "Name der Season", "Etwa „Season 1“.", "Season", lambda ctx: _season(ctx, "name")),
        Variable("season.number", "Nummer der Season", "Die laufende Nummer.", "Season", lambda ctx: _count(_season(ctx, "number"))),
        Variable("season.start", "Erster Tag", "Erster Tag der ersten Spielwoche (TT.MM.JJJJ).", "Season",
                 lambda ctx: facts.day_label(ctx.schedule.get("start_day")) if ctx.schedule.get("start_day") else None),
        Variable("season.end", "Letzter Tag", "Letzter Tag der letzten Spielwoche.", "Season",
                 lambda ctx: facts.day_label(ctx.schedule.get("end_day")) if ctx.schedule.get("end_day") else None),
        Variable("season.weeks", "Spielwochen", "Zahl der Spielwochen samt Sperrwochen.", "Season", lambda ctx: _count(ctx.schedule.get("weeks_total"))),
        Variable("best_of", "Best of", "Länge der Serie, etwa 3.", "Serie und Kader", lambda ctx: _count(ctx.format.get("best_of"))),
        Variable("maps_to_win", "Maps zum Sieg", "Wie viele Maps eine Serie entscheiden (Best of 3: 2).", "Serie und Kader",
                 lambda ctx: _count(ctx.format.get("maps_to_win"))),
        Variable("team_size", "Teamgröße", "Spieler je Map.", "Serie und Kader", lambda ctx: _count(ctx.format.get("team_size"))),
        Variable("min_squad_size", "Mindestkader", "Kleinster erlaubter Kader.", "Serie und Kader", lambda ctx: _count(ctx.format.get("min_squad_size"))),
        Variable("max_squad_size", "Höchstkader", "Größter erlaubter Kader - ohne Grenze nicht festgelegt.", "Serie und Kader",
                 lambda ctx: _count(ctx.format.get("max_squad_size"))),
        Variable("map_repeat", "Map-Wiederholung", "„nur in einem anderen Modus“, „jede Map nur einmal“ oder „frei“.", "Serie und Kader",
                 lambda ctx: facts.MAP_REPEAT_SHORT.get(ctx.format.get("map_repeat")) if ctx.format else None),
        Variable("lineup_mode", "Aufstellung", "„Teilnehmerliste je Spiel“ oder „Aufstellung je Map“.", "Serie und Kader",
                 lambda ctx: facts.LINEUP_WORDS.get(ctx.format.get("lineup_mode")) if ctx.format else None),
        Variable("lineup_min_players", "Mindestzahl der Teilnehmerliste", "Nur bei Teilnehmerliste je Spiel.", "Serie und Kader",
                 lambda ctx: _count(ctx.format.get("lineup_min_players"))),
        Variable("result_confirm_hours", "Bestätigungsfrist", "Stunden, nach denen eine Meldung ohne Antwort gilt.", "Serie und Kader",
                 lambda ctx: facts.hours(_season(ctx, "result_confirm_hours")) if _season(ctx, "result_confirm_hours") else None),
        Variable("lineup_amend_hours", "Nachtragsfrist", "Stunden nach dem Ergebnis für die eigene Aufstellung.", "Serie und Kader",
                 lambda ctx: facts.hours(_season(ctx, "lineup_amend_hours")) if _season(ctx, "lineup_amend_hours") else None),
        # Veto (D.3, #1618): nur mit Veto in der Season - sonst „(nicht festgelegt)“.
        Variable("veto.step_seconds", "Zeit je Veto-Schritt", "Sekunden je Schritt im Map-Veto, danach wählt das System.", "Serie und Kader",
                 lambda ctx: f"{ctx.veto['step_seconds']} Sekunden" if ctx.veto.get("enabled") else None),
        Variable("veto.team_a", "Team A im Veto", "„das Heimteam laut Spielplan“ oder „per Los je Spiel“.", "Serie und Kader",
                 lambda ctx: facts.TEAM_A_SHORT.get(ctx.veto.get("team_a")) if ctx.veto.get("enabled") else None),
        # Vorgabe der Woche (#2326): nur mit einem solchen Schritt in der Vorlage - sonst „(nicht festgelegt)“.
        Variable("veto.presets", "Vorgaben der Woche im Veto", "Je Spielwoche die Map, die die Liga-Leitung vorgibt, etwa „Spielwoche 1: Hafen (Kontrolle)“.",
                 "Serie und Kader", lambda ctx: facts.veto_presets_text(ctx.season, ctx.game, ctx.pool) if ctx.season else None),
        Variable("schedule.matchday_days", "Tage je Spielwoche", "Länge der Spielwoche in Tagen.", "Termine", lambda ctx: _count(ctx.schedule.get("matchday_days"))),
        Variable("schedule.default_weekday", "Standardtag", "Wochentag des Standardtermins.", "Termine",
                 lambda ctx: facts.WEEKDAYS[int(ctx.schedule.get("default_weekday") or 0) % 7] if ctx.schedule else None),
        Variable("schedule.default_time", "Standardzeit", "Uhrzeit des Standardtermins.", "Termine", lambda ctx: ctx.schedule.get("default_time")),
        Variable("schedule.default_slot", "Standardtermin", "„Sonntag, 20:00 Uhr“.", "Termine", lambda ctx: facts.default_slot(ctx.schedule) if ctx.schedule else None),
        Variable("schedule.response_hours", "Antwortfrist", "Stunden für die Antwort auf einen Terminvorschlag.", "Termine",
                 lambda ctx: facts.hours(ctx.schedule.get("response_hours")) if ctx.schedule.get("response_hours") else None),
        Variable("schedule.blocked_periods", "Sperrzeiten", "Alle Sperrzeiten mit Namen und Tagen, sonst „keine“.", "Termine",
                 lambda ctx: _periods(ctx.schedule.get("blocked_periods")) if ctx.schedule else None),
        Variable("schedule.home_rule_hours", "72-h-Regel", "Frist, nach der ein unbeantworteter Heimvorschlag gilt.", "Termine", _rule_hours("home_rule_hours")),
        Variable("schedule.reschedule_max", "Verschiebungen je Spiel", "Wie oft die Teams ein Spiel verschieben dürfen.", "Termine",
                 lambda ctx: _count((_rules(ctx) or {}).get("reschedule_max")) if _rules(ctx) else None),
        Variable("schedule.reschedule_notice_hours", "Vorlauf für eine Verschiebung", "Antrag spätestens so viele Stunden vor dem Termin.", "Termine",
                 _rule_hours("reschedule_notice_hours")),
        Variable("schedule.result_reminder_hours", "Erinnerung ohne Ergebnis", "Stunden nach dem Termin bis zur Erinnerung.", "Termine",
                 _rule_hours("result_reminder_hours")),
        Variable("schedule.result_overdue_hours", "Überfällig nach", "Stunden nach dem Termin, bis das Spiel bei der Leitung liegt.", "Termine",
                 _rule_hours("result_overdue_hours")),
        Variable("table.points", "Punktevergabe", "Sieg/Remis/Niederlage oder je gewonnene Map.", "Tabelle",
                 lambda ctx: facts.points_sentence(ctx.table) if ctx.table else None),
        Variable("table.points_win", "Punkte je Sieg", "Bei Punkten nach gewonnenen Maps „– (Punkte je gewonnene Map)“.", "Tabelle", _fixed_points("win")),
        Variable("table.points_draw", "Punkte je Remis", "Bei Punkten nach gewonnenen Maps „– (Punkte je gewonnene Map)“.", "Tabelle", _fixed_points("draw")),
        Variable("table.points_loss", "Punkte je Niederlage", "Bei Punkten nach gewonnenen Maps „– (Punkte je gewonnene Map)“.", "Tabelle", _fixed_points("loss")),
        Variable("table.draws", "Remis", "„möglich“ oder „nicht möglich“.", "Tabelle",
                 lambda ctx: ("möglich" if ctx.table.get("allow_draws") else "nicht möglich") if ctx.table else None),
        Variable("table.tiebreakers", "Reihenfolge bei Punktgleichheit", "Die Kriterien in Worten.", "Tabelle",
                 lambda ctx: facts.tiebreakers_sentence(ctx.table) if ctx.table else None),
        Variable("table.head_to_head", "Direkter Vergleich", "Die Kriterien der Mini-Tabelle.", "Tabelle",
                 lambda ctx: ", ".join(facts.CRITERION_WORDS.get(item, item) for item in ctx.table.get("head_to_head") or []) if ctx.table else None),
        Variable("table.forfeit_score", "Wertung kampflos", "Wie ein Default-Win zählt.", "Tabelle", lambda ctx: facts.forfeit_sentence(ctx.table) if ctx.table else None),
        Variable("table.exit_rule", "Ausscheiden", "Was mit den Spielen eines ausgeschiedenen Teams geschieht.", "Tabelle",
                 lambda ctx: facts.exit_sentence(ctx.table) if ctx.table else None),
        Variable("eligibility.min_age", "Mindestalter", "„18 Jahre“ oder „keine Vorgabe“.", "Spielberechtigung",
                 lambda ctx: (f"{ctx.eligibility['min_age']} Jahre" if ctx.eligibility.get("min_age") else "keine Vorgabe") if ctx.eligibility else None),
        Variable("eligibility.wait_days", "Wartezeit", "„7 Tage“ oder „keine“.", "Spielberechtigung",
                 lambda ctx: (facts.days(ctx.eligibility["new_player_wait_days"]) if ctx.eligibility.get("new_player_wait_days") else "keine") if ctx.eligibility else None),
        Variable("eligibility.roster_deadline", "Stichtag", "Stichtag für neue Spieler (TT.MM.JJJJ).", "Spielberechtigung",
                 lambda ctx: facts.day_label(ctx.eligibility.get("roster_deadline")) if ctx.eligibility.get("roster_deadline") else None),
        Variable("eligibility.transfer_windows", "Transferfenster", "Alle Fenster mit Tagen, sonst „keine“.", "Spielberechtigung",
                 lambda ctx: _periods(ctx.eligibility.get("transfer_windows")) if ctx.eligibility else None),
        Variable("eligibility.entry_policy", "Zulassung", "„alle Konten“ oder „nur Vereinsmitglieder“.", "Spielberechtigung",
                 lambda ctx: facts.ENTRY_POLICY_WORDS.get(ctx.eligibility.get("entry_policy"), facts.ENTRY_POLICY_WORDS["all"]) if ctx.eligibility else None),
        Variable("eligibility.id_fields", "Spiel-IDs", "Die Felder, die jeder Spieler im Profil hinterlegt.", "Spielberechtigung",
                 lambda ctx: (", ".join(ctx.eligibility.get("id_fields") or []) or "keine") if ctx.eligibility else None),
        # Plattform je Season (#2270): nur, wenn die Season ein Plattform-Feld hat - sonst „(nicht festgelegt)“.
        Variable("eligibility.platform", "Plattformen", "„PC“, „PC und PlayStation“ oder „alle Plattformen“.", "Spielberechtigung",
                 lambda ctx: (ctx.eligibility.get("platform") or {}).get("platforms") if ctx.eligibility else None),
        Variable("eligibility.crossplay", "Crossplay", "„an“ oder „aus“.", "Spielberechtigung",
                 lambda ctx: (ctx.eligibility.get("platform") or {}).get("crossplay") if ctx.eligibility else None),
        Variable("eligibility.input_device", "Eingabegerät", "„Controller“, „Maus und Tastatur“ oder „Controller oder Maus und Tastatur“.",
                 "Spielberechtigung", lambda ctx: (ctx.eligibility.get("platform") or {}).get("input_device") if ctx.eligibility else None),
        Variable("application.opens", "Anmeldung ab", "Beginn des Anmeldefensters (Wiener Zeit).", "Anmeldung", lambda ctx: _local(_season(ctx, "application_opens_at"))),
        Variable("application.closes", "Anmeldung bis", "Ende des Anmeldefensters (Wiener Zeit).", "Anmeldung", lambda ctx: _local(_season(ctx, "application_closes_at"))),
        Variable("application.slots", "Startplätze", "Zahl der Startplätze der Season.", "Anmeldung", lambda ctx: _count(_season(ctx, "application_slots"))),
        # Anmeldungen automatisch annehmen (#2348): ein ganzer Satz ohne Punkt, ohne Anmeldefenster „(nicht festgelegt)“.
        Variable("application.acceptance", "Annahme der Anmeldung", "„Anmeldungen werden automatisch angenommen, solange ein Startplatz frei ist; … zurückstufen“ "
                 "oder „Die Liga-Leitung prüft jede Anmeldung“ - ein ganzer Satz ohne Punkt.", "Anmeldung",
                 lambda ctx: facts.AUTO_ACCEPT_WORDS[bool(ctx.eligibility["auto_accept"])] if ctx.eligibility.get("auto_accept") is not None else None),
        # Vorab angelegt: Die Season trägt diese Felder noch nicht, es gilt die Vorgabe. Die Einstellung kommt mit dem genannten Paket
        # und schreibt dasselbe Feld - Texte mit diesen Variablen passen sich dann von selbst an (docs/LIGA.md, B.2).
        Variable("protest.hours", "Protestfrist", "Frist für einen Protest ab der Ergebnisbestätigung (Vorgabe 48 Stunden, einstellbar mit E.2).",
                 "Proteste und Strafen", _preset("protest_hours", PRESETS["protest_hours"], facts.hours)),
        Variable("appeal.hours", "Einspruchsfrist", "Frist für einen Einspruch ab Bekanntgabe (Vorgabe 48 Stunden, einstellbar mit E.3).",
                 "Proteste und Strafen", _preset("appeal_hours", PRESETS["appeal_hours"], facts.hours)),
        Variable("evidence.keep_days", "Aufbewahrung der Beweise", "Tage nach Season-Ende (Vorgabe 30 Tage, einstellbar mit E.2).",
                 "Proteste und Strafen", _preset("evidence_keep_days", PRESETS["evidence_keep_days"], facts.days)),
        # E.2 (#1619): Stellungnahme, Zielfrist der Leitung und MOSS-Datei - einstellbar je Season (Reiter „Proteste“).
        Variable("statement.hours", "Frist für die Stellungnahme", "Frist der Gegenseite ab der Benachrichtigung (Vorgabe 48 Stunden).",
                 "Proteste und Strafen", _preset("statement_hours", PRESETS["statement_hours"], facts.hours)),
        Variable("protest.target_hours", "Zielfrist der Leitung", "Zielfrist für die Entscheidung, ab der Übernahme (Vorgabe 72 Stunden).",
                 "Proteste und Strafen", _preset("protest_target_hours", PRESETS["protest_target_hours"], facts.hours)),
        Variable("moss.upload_hours", "Frist für die MOSS-Datei", "Frist für eine angeforderte MOSS-Datei (Vorgabe 24 Stunden).",
                 "Proteste und Strafen", _preset("moss_upload_hours", PRESETS["moss_upload_hours"], facts.hours)),
        # Vorfälle (D.5, #1619): einstellbar im Reiter Spielbetrieb der Season, Abschnitt „Vorfälle und Pausen“.
        Variable("match.break_after_map", "Pause nach Map", "Nach welcher Map die Standardpause liegt (Vorgabe 2).",
                 "Matchablauf", _preset("map_break_after", PRESETS["map_break_after"], _count)),
        Variable("match.break_minutes", "Länge der Pause", "Standardpause zwischen den Maps (Vorgabe 5 Minuten).",
                 "Matchablauf", _preset("map_break_minutes", PRESETS["map_break_minutes"], lambda value: facts.duration(int(value) * 60))),
        Variable("incident.answer_minutes", "Antwortzeit bei einem Vorfall", "Minuten, in denen die Gegenseite auf einen gemeldeten Vorfall "
                 "antwortet (Vorgabe 10 Minuten); danach entscheidet die Liga-Leitung.",
                 "Matchablauf", _preset("incident_answer_minutes", PRESETS["incident_answer_minutes"], lambda value: facts.duration(int(value) * 60))),
    ]


STATIC: dict[str, Variable] = {row.name: row for row in _static()}

# Je Modus des Spiels: ``mode:<kennung>.<feld>``.
MODE_FIELDS: dict[str, tuple[str, str]] = {
    "name": ("Name", "Der heutige Name des Modus."),
    "rule": ("Ergebnisregel", "Die Regel in Klartext: Ziel, Runden, Verlängerung, Remis."),
    "target": ("Ziel", "Zielpunkte bzw. Rundensiege."),
    "round_limit": ("Rundenlimit", "Höchstzahl der Runden (nur bei Runden)."),
    "time_limit": ("Zeitlimit je Map", "„10 Min.“ oder „1:30 Min.“."),
    "round_time": ("Zeit je Runde", "„1:30 Min.“."),
    "players": ("Spieler je Seite", ""),
    "overtime": ("Verlängerung", "„ja“ oder „nein“."),
    "draw": ("Remis", "„ja“ oder „nein“."),
}


def _mode_row(ctx: Context, key: str) -> dict | None:
    """Der Modus mit seiner Regel - aus den Daten der Season, ohne Season aus dem Spiel."""
    for row in (ctx.modes or {}).get("rows") or []:
        if row.get("mode") == key:
            return row
    docs = {mode["mode"]: mode for mode in (ctx.game or {}).get("match_modes") or [] if isinstance(mode, dict) and mode.get("mode")}
    doc = docs.get(key)
    if not doc:
        return None
    return {"mode": key, "label": doc.get("label") or key, "players_per_side": doc.get("players_per_side") or None,
            "rule": facts._season_rule(ctx.season or {}, ctx.game, key)}


def _mode_value(row: dict, field_name: str) -> str | None:
    rule = row.get("rule") or {}
    if field_name == "name":
        return row.get("label")
    if field_name == "rule":
        return facts.rule_sentence(row.get("rule"))
    if field_name == "players":
        return _count(row.get("players_per_side"))
    if field_name == "target":
        return _count(rule.get("target"))
    if field_name == "round_limit":
        return _count(rule.get("round_limit"))
    if field_name == "time_limit":
        return facts.duration(rule["time_limit_seconds"]) if rule.get("time_limit_seconds") else None
    if field_name == "round_time":
        return facts.duration(rule["round_time_seconds"]) if rule.get("round_time_seconds") else None
    if field_name == "overtime":
        return (YES if rule.get("overtime") else NO) if rule else None
    if field_name == "draw":
        return (YES if rule.get("draw_allowed") else NO) if rule else None
    return None


def _split_mode(name: str) -> tuple[str, str] | None:
    if not name.startswith(MODE_PREFIX) or "." not in name:
        return None
    key, _dot, field_name = name[len(MODE_PREFIX):].rpartition(".")
    return (key, field_name) if key and field_name in MODE_FIELDS else None


# ---------------------------------------------------------------- Namen im Text

def var_names(*texts: str | None) -> list[str]:
    """Die Variablen im Text, in der Reihenfolge ihres ersten Auftretens (klein geschrieben)."""
    found: list[str] = []
    for value in texts:
        for match in TOKEN.finditer(str(value or "")):
            name = match.group(1).lower()
            if name not in found:
                found.append(name)
    return found


def is_known(name: str, game: dict | None) -> bool:
    if name in STATIC:
        return True
    parts = _split_mode(name)
    return bool(parts and parts[0] in facts.game_mode_labels(game))


def unknown(names: list[str], game: dict | None) -> list[str]:
    return [name for name in names if not is_known(name, game)]


def label_of(name: str, ctx: Context) -> str:
    if name in STATIC:
        return STATIC[name].label
    parts = _split_mode(name)
    if parts:
        row = _mode_row(ctx, parts[0])
        return f"{(row or {}).get('label') or parts[0]} · {MODE_FIELDS[parts[1]][0]}"
    return name


def value_of(name: str, ctx: Context) -> str | None:
    """Der Wert als Klartext - ``None`` ohne Wert. Ohne Season gibt es nur, was ohne Season gilt."""
    if name in STATIC:
        variable = STATIC[name]
        if ctx.season is None and not variable.season_free:
            return None
        value = variable.resolve(ctx)
        return " ".join(str(value).split()) if value not in (None, "") else None
    parts = _split_mode(name)
    if not parts:
        return None
    row = _mode_row(ctx, parts[0])
    value = _mode_value(row, parts[1]) if row else None
    return " ".join(str(value).split()) if value not in (None, "") else None


def resolvable(name: str, ctx: Context) -> bool:
    """Lässt sich der Name in diesem Zusammenhang auflösen? Auf der Seite der Liga nur, was ohne Season gilt."""
    if name in STATIC:
        return ctx.season is not None or STATIC[name].season_free
    return is_known(name, ctx.game)


def resolve(names: list[str], ctx: Context) -> dict[str, dict]:
    """Je bekannter, hier auflösbarer Variable ``{label, value}`` - so wird eingefroren. Unbekannte fehlen."""
    return {name: {"label": label_of(name, ctx), "value": value_of(name, ctx)} for name in names if resolvable(name, ctx)}


def empty(names: list[str], frozen: dict[str, dict]) -> list[str]:
    """Bekannte Variablen ohne Wert - sie stehen als „(nicht festgelegt)“ im Text."""
    return [name for name in names if name in frozen and frozen[name].get("value") is None]


def fill_vars(body: str | None, values: dict[str, dict] | None, *, missing: str, plain: bool = False, keep=()) -> str:
    """Setzt die Variablen ein: der Wert als Bausteinwert (geschützt), ohne Wert „(nicht festgelegt)“, ohne Eintrag ``missing``. Namen in
    ``keep`` (unbekannte, in der Vorschau) bleiben als Marke sichtbar stehen."""
    rows = values or {}
    kept = set(keep)

    def replace(match: re.Match) -> str:
        name = match.group(1).lower()
        if name in kept:
            return match.group(0)
        if name not in rows:
            return missing
        value = rows[name].get("value")
        if value is None:
            return MISSING_VALUE
        protected = text_cell(value)
        return plain_text(protected) if plain else protected

    return TOKEN.sub(replace, str(body or ""))


def catalog(ctx: Context) -> list[dict]:
    """Was die Verwaltung zum Einfügen anbietet: jede Variable mit ihrem heutigen Wert, die Modi des Spiels je Feld."""
    out = [{"name": row.name, "label": row.label, "hint": row.hint, "group": row.group, "token": row.token,
            "value": value_of(row.name, ctx)} for row in STATIC.values()]
    for key, label in facts.game_mode_labels(ctx.game).items():
        for field_name, (word, hint) in MODE_FIELDS.items():
            name = f"{MODE_PREFIX}{key}.{field_name}"
            out.append({"name": name, "label": f"{label} · {word}", "hint": hint, "group": "Modi", "token": "{{" + name + "}}",
                        "value": value_of(name, ctx)})
    return out
