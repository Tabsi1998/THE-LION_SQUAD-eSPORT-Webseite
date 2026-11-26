"""Wächter: Jeder Leser der Staffeln einer Season ist eingeordnet (#2404, docs/LIGA.md „F.6 … Abschluss, Meister, Platz 3“, H6).

Seit es Playoff- und Relegations-Staffeln gibt (``league_context.kind``), ist nicht mehr jede Staffel einer Season eine Tabelle und
nicht mehr jeder Endstand ein Tabellen-Endstand. Jede Datei, die über ``league_context.season_id`` / ``division_id`` oder über
``league_final_tables`` liest, steht darum hier mit der Zahl ihrer Abfragen und ihrer Einordnung:

- ``regular``: nur reguläre Staffeln bzw. Tabellen-Endstände (``"league_context.kind": None`` / ``"kind": None`` oder ein Filter danach),
- ``all``: bewusst alle Arten (Spielbetrieb, Leitstand, Fristen, Sperren, Regeln, Sichtbarkeit),
- ``mixed``: beides, je Abfrage im Code begründet.

Kommt eine Abfrage dazu oder eine neue Datei, wird dieser Test rot: erst entscheiden, ob Playoffs und Relegation mitzählen, dann die
Zahl hier nachziehen. So zählt ein Playoff-Endstand nie versehentlich als weitere Staffel in Gesamtwertung, Historie oder Folge-Season.
"""
import pathlib
import re

BACKEND = pathlib.Path(__file__).resolve().parents[1]
PATTERN = re.compile(r'"league_context\.(?:season_id|division_id)"|league_final_tables\.(?:find|find_one|count_documents|aggregate|distinct)\(')

ALL, REGULAR, MIXED = "all", "regular", "mixed"
READERS = {
    "services/daily_center.py": (1, ALL, "Aufgaben des Tages: jede Staffel"),
    "services/league_applications.py": (4, REGULAR, "Zuteilen und Anträge: nie in Playoffs oder Relegation"),
    "services/league_cross_zones.py": (2, REGULAR, "Plätze über Staffeln hinweg: filtert ``kind`` nach dem Lesen"),
    "services/league_desk.py": (2, ALL, "Leitstand: jede Staffel"),
    "services/league_discord.py": (2, MIXED, "Spieltags-Meldung mit Tabelle nur regulär; der Meister aus den Playoffs für die Abschluss-Meldung"),
    "services/league_draw.py": (1, REGULAR, "Los auf Staffeln: filtert ``kind`` nach dem Lesen"),
    "services/league_eligibility.py": (2, ALL, "Spielberechtigung gilt der Season"),
    "services/league_final.py": (6, MIXED, "Abschluss zählt alle Arten; Tabelle, Zonen, Vergleich und der Meister ohne Playoffs (Nr. 251) nur regulär"),
    "services/league_final_read.py": (1, ALL, "die geltende Fassung genau dieser Staffel"),
    "services/league_finale.py": (4, MIXED, "Auf- und Absteiger nur aus Tabellen, dazu die Wirkung der Relegation; der TV-Schritt an jeder Staffel"),
    "services/league_games.py": (1, REGULAR, "Doppel-Einsatz: nur unter Staffeln derselben Art"),
    "services/league_history.py": (1, REGULAR, "Season-Historie: eine Zeile je Tabellen-Endstand"),
    "services/league_incidents.py": (1, ALL, "Vorfälle: jede Staffel"),
    "services/league_late_entry.py": (1, REGULAR, "Nachmeldung nur in regulären Staffeln"),
    "services/league_moments.py": (1, ALL, "Saisonende-Moment: Einsatz zählt in jeder Staffel der Season, auch Playoffs und Relegation"),
    "services/league_overall.py": (3, MIXED, "Punkte nur aus Tabellen-Endständen; offene Staffeln zählen alle Arten"),
    "services/league_pool_check.py": (1, ALL, "Map-Pool: jede Staffel"),
    "services/league_postseason.py": (5, MIXED, "liest reguläre Endstände und findet die eigenen Staffeln"),
    "services/league_rank_banner.py": (1, REGULAR, "Platz und Bilanz aus der regulären Staffel"),
    "services/league_readiness.py": (2, REGULAR, "Liga N mit Staffel"),
    "services/league_rewards.py": (2, REGULAR, "Zusammenstellung gilt dem Tabellenplatz"),
    "services/league_roster.py": (1, ALL, "Kader gilt der Season"),
    "services/league_rules.py": (2, ALL, "Regelwerk an jeder Staffel"),
    "services/league_sanctions.py": (2, ALL, "Strafen: jede Staffel"),
    "services/league_schedule.py": (2, ALL, "Termine: jede Staffel"),
    "services/league_service.py": (12, MIXED, "Verwaltung; die Ligaseite trennt Staffeln und ``postseason``; ob die Season läuft (Nr. 254), sagen nur reguläre Staffeln"),
    # Startrechte (#1627, F.2a): Seit wann der Endstand des Vorgängers nicht mehr steht - auch eine wieder geöffnete Playoff- oder
    # Relegations-Staffel hält die Fristen an.
    "services/league_start_rights.py": (2, ALL, "Pausenbeginn: jüngstes Wiederöffnen einer offenen Staffel, jede Art"),
    "services/league_veto.py": (2, REGULAR, "Vorlage der Season geht nur an reguläre Staffeln"),
    "services/league_veto_fit.py": (2, REGULAR, "Passt die Vorlage: reguläre Staffeln der Liga N"),
    "services/league_veto_sweep.py": (1, ALL, "wartende Vetos: jede Staffel"),
    "services/match_flow.py": (1, ALL, "Spielbetrieb: jede Staffel"),
    "services/profile_references.py": (1, REGULAR, "Platz aus dem Tabellen-Endstand"),
    "services/squad_registration.py": (1, REGULAR, "ein Co-Team je Season in einer regulären Staffel"),
    "routes/league_checkin_routes.py": (2, ALL, "Check-in-Regeln gelten auch in Playoffs"),
    "routes/league_loadout_routes.py": (1, ALL, "Sperrliste: jede Staffel"),
    "routes/league_postseason_routes.py": (1, ALL, "findet die Playoff-Staffel der Season"),
    "routes/league_protest_routes.py": (3, ALL, "Proteste gelten auch in Playoffs"),
    "routes/league_reminder_routes.py": (2, ALL, "Erinnerungen gelten auch in Playoffs"),
    "routes/league_result_rule_routes.py": (1, ALL, "Ergebnisregeln: Zahl der Staffeln"),
    "routes/league_routes.py": (2, ALL, "Verwaltung und die Staffel der Ligaseite"),
    "routes/league_schedule_routes.py": (2, ALL, "Terminregeln gelten auch in Playoffs"),
    "routes/league_veto_routes.py": (1, ALL, "Zahl der Staffeln"),
    "routes/setup_routes.py": (2, ALL, "Sitemap: sichtbare Staffeln"),
}


def scan() -> dict[str, int]:
    found = {}
    for folder in ("services", "routes"):
        for path in sorted((BACKEND / folder).glob("*.py")):
            count = len(PATTERN.findall(path.read_text(encoding="utf-8")))
            if count:
                found[f"{folder}/{path.name}"] = count
    return found


def test_every_reader_of_a_seasons_staffeln_is_classified():
    found = scan()
    unknown = sorted(set(found) - set(READERS))
    assert not unknown, (f"Neue Leser der Staffeln einer Season: {unknown}. Bitte in READERS einordnen - zählen Playoffs und "
                         "Relegation (league_context.kind) dort mit oder nicht?")
    changed = {name: (READERS[name][0], count) for name, count in found.items() if READERS[name][0] != count}
    assert not changed, (f"Zahl der Abfragen geändert (erwartet, gefunden): {changed}. Bitte prüfen, ob die neue Abfrage Playoffs und "
                         "Relegation mitzählen soll, und READERS nachziehen.")
    gone = sorted(set(READERS) - set(found))
    assert not gone, f"Diese Dateien lesen nicht mehr über die Season: {gone}. Bitte aus READERS nehmen."


def test_every_classification_is_known_and_explained():
    for name, (count, kind, note) in READERS.items():
        assert kind in (ALL, REGULAR, MIXED), name
        assert count > 0 and len(note) > 10, name


def test_regular_readers_really_filter_by_kind():
    """Wer ``regular`` trägt, nennt die Staffel-Art auch im Code - sonst wäre die Einordnung nur behauptet."""
    for name, (_count, kind, _note) in READERS.items():
        if kind != REGULAR:
            continue
        text = (BACKEND / name).read_text(encoding="utf-8")
        assert '"league_context.kind"' in text or '"kind": None' in text or '.get("kind")' in text, name
