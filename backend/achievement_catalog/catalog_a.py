"""Erfolge II, Katalog A (#612): Spielen und Turnier - 40 Gruppen mit 206 Stufen als Daten der Stufenleiter v2.

Jede Gruppe hat einen Bedingungsschlüssel (Zähler aus services/achievement_counters.py oder aus dem alten
Block), Ziele je Stufe von links nach rechts, ein Symbol (Lucide-Name), ein Abzeichen-Motiv für E8 und eine
Zeile „So schaffst du es“ für „Als Nächstes“ (E9). Stufenname = Gruppenname plus römische Zahl; das Material
steht im Abzeichen. Alte Gruppen, die hier aufgehen, stehen in ``REPLACED`` (Abbildung für die Migration) und
``REDEFINED`` (gleicher Code, neue Leiter).
"""
from __future__ import annotations

from .materials import CATEGORIES, LADDERS, tier

ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"]

# Alte Gruppe → neue Gruppe: Vergaben werden über die Zähler der neuen Gruppe neu ausgewertet (E1-Migration).
REPLACED: dict[str, str] = {
    "match_master": "matches_played",
    "grind_legend": "matches_played",
    "victory_count": "matches_won",
    "format_master": "formats_played",
    "marathoner": "full_distance",
    "clutch_master": "clutch",
    "tournament_veteran": "tournaments_registered",
    "tournament_champion": "tournaments_won",
    "podium_collector": "podium",
    "multitalent": "distinct_games",
}
# Gleicher Code wie im alten Katalog, aber neue Leiter und Bedingung: die alte Definition weicht.
REDEFINED = ("win_streak", "fairplay", "early_bird_match", "night_owl_match", "checkin_streak", "registration_speed")


# Einzahl beim Ziel 1: „1 Tag“, „1 Jahr“ statt „1 Tage“, „1 Jahre“ (#864).
SINGULAR_UNITS = {" Tage": " Tag", " Jahre": " Jahr"}


def _group(code: str, name: str, category: str, description: str, how_to: str, icon: str, art: str, key: str | None, targets: list[int],
           step: str, *, sort_order: int, unit: str = "", staff_only: bool = False, catalog: str = "A",
           steps: list[str] | None = None, materials: list[str] | None = None, manual: bool = False) -> tuple[dict, list[dict]]:
    """Eine Gruppe samt Stufen. ``step`` ist der Satz je Stufe mit ``{n}`` für das Ziel **samt** ``unit`` („{n} im Vorstand.“
    wird „90 Tage im Vorstand.“ - die Einheit gehört nicht noch einmal in den Satz, #864); ``steps`` ersetzt ihn durch einen
    eigenen Satz je Stufe, ``materials`` die Leiter (z. B. eine einzelne Silber-Stufe). ``manual`` heißt: nur von Hand
    vergeben, kein Bedingungsschlüssel. Katalog B–D nutzen denselben Helfer."""
    materials = list(materials or LADDERS[len(targets)])
    group = {
        "code": code, "name": name, "category": category, "icon": icon, "art": art,
        "accent_color": CATEGORIES[category]["accent"], "description": description, "how_to": how_to,
        "condition_key": None if manual else key, "public": True, "is_special": False, "is_negative": False, "sort_order": sort_order,
        "staff_only": staff_only, "catalog": catalog, "manual_only": manual,
    }
    tiers = []
    for index, (material, target) in enumerate(zip(materials, targets)):
        shown = SINGULAR_UNITS.get(unit, unit) if target == 1 else unit
        text = steps[index] if steps else step.format(n=f"{target}{shown}")
        tiers.append(tier(f"{code}_{index + 1}", code, material, f"{name} {ROMAN[index]}", text, condition_key=None if manual else key,
                          progress_target=target, icon=icon, art=art, how_to=how_to, manual_only=manual))
    return group, tiers


MATCH = [
    _group("matches_played", "Spielmacher", "match", "Sammle gespielte Matches - Turnier für Turnier.", "Spiel Matches in Turnieren; jedes abgeschlossene Match zählt.",
           "swords", "crossed-swords", "matches_played", [5, 25, 75, 200, 500, 1000, 2500], "{n} Matches gespielt.", sort_order=110),
    _group("matches_won", "Sieger", "match", "Gewinne Matches gegen echte Gegner.", "Gewinn Matches - Forfeits des Gegners zählen mit.",
           "trophy", "laurel", "matches_won", [1, 10, 40, 100, 250, 600, 1500], "{n} Matches gewonnen.", sort_order=111),
    _group("win_streak", "Siegesserie", "match", "Gewinne Matches in Folge - die längste Serie zählt.", "Verlier nicht: jede Serie ohne Niederlage zählt, die längste bleibt.",
           "flame", "flame", "match_streak_max", [3, 5, 8, 12, 16, 20, 30], "{n} Siege in Folge.", sort_order=112),
    _group("win_rate", "Effizienz", "match", "Halte eine hohe Siegquote - ab 30 Matches.", "Ab 30 gespielten Matches zählt deine Siegquote in Prozent.",
           "percent", "gauge", "win_rate_qualified", [55, 60, 65, 70, 75], "{n} Siegquote bei mindestens 30 Matches.", sort_order=113, unit=" %"),
    _group("comeback", "Comeback", "match", "Dreh Serien, in denen du schon zurücklagst.", "Gewinn ein Bo3 oder Bo5 nach 0:1 oder 0:2 - die Karten müssen dafür eingetragen sein.",
           "undo-2", "phoenix", "comebacks", [1, 5, 15, 40, 100], "{n} Comebacks.", sort_order=114),
    _group("clean_sheet", "Zu Null", "match", "Gewinne Serien, ohne eine Karte abzugeben.", "Gewinn ein Match, bei dem der Gegner keine Karte holt.",
           "shield-check", "shield", "clean_sheets", [1, 10, 30, 75, 150], "{n} Siege zu Null.", sort_order=115),
    _group("maps_played", "Kartenkenner", "match", "Spiel auf vielen verschiedenen Karten.", "Zählt jede Karte einmal - nur bei Spielen mit Kartenliste.",
           "map", "map", "distinct_maps", [5, 15, 30, 60, 100], "{n} verschiedene Karten gespielt.", sort_order=116),
    _group("formats_played", "Formatvielfalt", "match", "Spiel in vielen Turnierformaten.", "Melde dich in verschiedenen Formaten an - Einzel, Team, Liga, Cup.",
           "layout-grid", "grid", "distinct_formats", [2, 3, 4, 6, 8], "{n} verschiedene Formate gespielt.", sort_order=117),
    _group("full_distance", "Marathoner", "match", "Spiel Serien über die volle Distanz.", "Ein Bo3 mit 2:1 oder ein Bo5 mit 3:2 - Sieg oder Niederlage, die Distanz zählt.",
           "timer", "hourglass", "full_distance_series", [1, 5, 15, 40, 100], "{n} Serien über die volle Distanz.", sort_order=118),
    _group("clutch", "Clutch", "match", "Gewinne die letzte Karte einer vollen Serie.", "Gewinn ein Bo3 mit 2:1 oder ein Bo5 mit 3:2 - die Entscheidung gehört dir.",
           "sparkles", "bolt", "deciders_won", [1, 5, 15, 40, 100], "{n} Entscheidungskarten gewonnen.", sort_order=119),
    _group("early_bird_match", "Frühaufsteher", "match", "Spiel Matches vor 9 Uhr.", "Ein Match, das vor 9 Uhr (Wien) endet, zählt.",
           "sunrise", "sunrise", "matches_before_9", [5, 25, 100], "{n} Matches vor 9 Uhr.", sort_order=120),
    _group("night_owl_match", "Nachteule", "match", "Spiel Matches nach 23 Uhr.", "Ein Match, das ab 23 Uhr (Wien) endet, zählt.",
           "moon", "owl", "matches_after_23", [5, 25, 100], "{n} Matches nach 23 Uhr.", sort_order=121),
    _group("weekend_warrior", "Wochenend-Krieger", "match", "Spiel an Samstagen und Sonntagen.", "Jedes Match am Wochenende (Wien) zählt.",
           "calendar-days", "calendar", "weekend_matches", [10, 50, 150, 400, 1000], "{n} Matches am Wochenende.", sort_order=122),
    _group("punctual", "Pünktlich", "match", "Sei vor dem Start bereit - und dein Gegner auch.", "Beide Seiten vor dem angesetzten Start eingecheckt, kein Forfeit.",
           "alarm-clock", "clock", "matches_ready_on_time", [5, 25, 75, 200, 500], "{n} pünktliche Matches.", sort_order=123),
    _group("result_reporter", "Ergebnis-Melder", "match", "Trag Ergebnisse ein, die Bestand haben.", "Melde das Ergebnis deines Matches; zählt, wenn das Match damit abgeschlossen wird.",
           "clipboard-check", "clipboard", "results_reported_accepted", [5, 25, 75, 200, 500], "{n} Ergebnisse gemeldet.", sort_order=124),
    _group("dispute_free", "Ohne Streit", "match", "Spiel Matches in Folge ohne Dispute.", "Die längste Folge abgeschlossener Matches ohne Dispute zählt.",
           "handshake", "handshake", "dispute_free_streak", [25, 100, 250, 500, 1000], "{n} Matches in Folge ohne Dispute.", sort_order=125),
    _group("rivalry", "Rivalen", "match", "Triff denselben Gegner immer wieder.", "Zählt, wie oft du gegen ein und dieselbe Person oder dasselbe Team gespielt hast.",
           "users", "crossed-flags", "same_opponent_max", [3, 10, 25, 50, 100], "{n} Matches gegen denselben Gegner.", sort_order=126),
    _group("giant_slayer", "Riesentöter", "match", "Schlag besser gesetzte Gegner.", "Gewinn gegen einen Gegner mit besserer Setznummer.",
           "mountain", "giant", "upsets", [1, 5, 15, 40, 100], "{n} Siege gegen besser Gesetzte.", sort_order=127),
    _group("fairplay", "Fair Play", "match", "Bekomm GG-Lob von deinen Gegnern.", "Nach dem Match kann dir der Gegner ein GG geben - jedes zählt.",
           "heart-handshake", "heart", "commendations_received", [1, 3, 7, 15, 30, 60, 100], "{n}-mal GG bekommen.", sort_order=128),
    _group("gg_giver", "Guter Verlierer", "match", "Gib deinen Gegnern GG-Lob.", "Nach dem Match ein GG geben - auch nach einer Niederlage.",
           "thumbs-up", "thumbs-up", "commendations_given", [5, 25, 75, 200, 500], "{n}-mal GG gegeben.", sort_order=129),
]

TOURNAMENT = [
    _group("tournaments_registered", "Turnierveteran", "tournament", "Melde dich zu Turnieren an.", "Jede Anmeldung zu einem Turnier zählt.",
           "ticket", "ticket", "tournaments_registered", [1, 5, 15, 40, 100, 200, 500], "{n} Turnieranmeldungen.", sort_order=210),
    _group("tournaments_completed", "Durchzieher", "tournament", "Spiel Turniere bis zum Ende, ohne aufzugeben.", "Ein abgeschlossenes Turnier ohne eigenes Forfeit zählt.",
           "flag-triangle-right", "finish-flag", "tournaments_completed_no_forfeit", [1, 5, 15, 40, 100, 200, 400], "{n} Turniere durchgezogen.", sort_order=211),
    _group("tournaments_won", "Champion", "tournament", "Gewinne Turniere.", "Platz 1 in einem Turnier - egal in welchem Spiel.",
           "crown", "crown", "tournaments_won", [1, 3, 7, 15, 30, 60, 100], "{n} Turniere gewonnen.", sort_order=212),
    _group("podium", "Podest", "tournament", "Lande unter den ersten Drei.", "Platz 1, 2 oder 3 in einem Turnier zählt.",
           "medal", "podium", "podium_finishes", [1, 5, 15, 30, 60, 120, 250], "{n} Podestplätze.", sort_order=213),
    _group("finals", "Finalist", "tournament", "Erreich Finals.", "Platz 1 oder 2 heißt: du warst im Finale.",
           "star", "star", "finals_played", [1, 5, 15, 40, 100], "{n} Finals gespielt.", sort_order=214),
    _group("top8", "Top 8", "tournament", "Erreich die besten Acht.", "Platz 1 bis 8 in einem Turnier zählt.",
           "list-ordered", "eight", "top8_finishes", [1, 10, 30, 75, 200], "{n}-mal in den Top 8.", sort_order=215),
    _group("distinct_games", "Multitalent", "tournament", "Spiel Turniere in vielen Spielen.", "Melde dich in verschiedenen Spielen an - jedes Spiel zählt einmal.",
           "gamepad-2", "gamepad", "distinct_games_registered", [2, 3, 5, 8, 10, 15, 20], "{n} verschiedene Spiele.", sort_order=216),
    _group("checkin_streak", "Immer eingecheckt", "tournament", "Check in Folge ein.", "Turnier für Turnier eingecheckt - die längste Folge zählt.",
           "check-check", "checkmark", "checkin_streak", [3, 10, 25, 50, 100], "{n} Turniere in Folge eingecheckt.", sort_order=217),
    _group("checkin_first", "Erster im Haus", "tournament", "Sei die erste Person, die eincheckt.", "Vor allen anderen einchecken - je Turnier einmal.",
           "door-open", "door", "first_checkins", [1, 5, 15, 40, 100], "{n}-mal als Erste:r eingecheckt.", sort_order=218),
    _group("registration_speed", "Schnell dabei", "tournament", "Melde dich binnen zehn Minuten nach Öffnung an.", "Anmeldung binnen zehn Minuten, nachdem sie geöffnet wurde.",
           "zap", "lightning", "fast_registrations", [1, 5, 15, 40, 100], "{n} schnelle Anmeldungen.", sort_order=219),
    _group("lower_bracket_run", "Lower-Bracket-Lauf", "tournament", "Kämpf dich aus dem Lower Bracket in die Top 4.", "Im Double Elimination über das Lower Bracket unter die ersten Vier.",
           "trending-up", "ladder", "lower_bracket_top4", [1, 3, 7, 15, 30], "{n} Lower-Bracket-Läufe in die Top 4.", sort_order=220),
    _group("undefeated", "Ungeschlagen", "tournament", "Gewinne Turniere ohne eine Niederlage.", "Turniersieg, ohne ein Match zu verlieren.",
           "shield", "shield-star", "tournaments_won_undefeated", [1, 3, 7, 15, 30], "{n} Turniere ungeschlagen gewonnen.", sort_order=221),
    _group("group_winner", "Gruppensieger", "tournament", "Gewinne Gruppenphasen.", "Platz 1 in deiner Gruppe einer Gruppenphase.",
           "layout-list", "group", "group_stage_firsts", [1, 5, 15, 40, 100], "{n} Gruppen gewonnen.", sort_order=222),
    _group("featured_match", "Im Rampenlicht", "tournament", "Spiel auf einem Turnier-Stream.", "Ein Match in einem Turnier mit Stream zählt.",
           "radio", "spotlight", "streamed_matches", [1, 5, 20], "{n} Matches im Rampenlicht.", sort_order=223),
    _group("tournament_staff", "Turnierleitung", "tournament", "Leite Turniere bis zum Ende.", "Als Turnierleitung ein Turnier abschließen.",
           "clipboard-list", "whistle", "tournaments_staffed_completed", [1, 5, 15, 40, 100], "{n} Turniere geleitet.", sort_order=224, staff_only=True),
    _group("referee", "Schiedsrichter", "tournament", "Entscheide Dispute.", "Als Turnierleitung ein disputiertes Match mit einem Ergebnis abschließen.",
           "gavel", "gavel", "disputes_resolved_as_staff", [1, 10, 30, 75, 200], "{n} Dispute entschieden.", sort_order=225, staff_only=True),
    _group("tournament_chat", "Turnier-Plauderer", "tournament", "Schreib im Turnier-Chat.", "Nachrichten im Turnier-Chat zählen.",
           "message-circle", "speech-bubble", "tournament_chat_messages_sent", [10, 50, 150, 500, 1500], "{n} Nachrichten im Turnier-Chat.", sort_order=226),
    _group("prize_winner", "Preisträger", "tournament", "Hol dir Preise.", "Ein vergebener Preis aus einem Turnier zählt.",
           "gift", "gift", "prizes_received", [1, 3, 7, 15, 30], "{n} Preise erhalten.", sort_order=227),
    _group("top_seed", "Topgesetzt", "tournament", "Geh als Nummer eins ins Turnier.", "Setznummer 1 in einem Turnier - je Turnier einmal.",
           "hash", "number-one", "seed_one_count", [1, 5, 15], "{n}-mal topgesetzt.", sort_order=228),
    _group("bracket_reset", "Bracket Reset", "tournament", "Gewinne das Grand Final aus dem Lower Bracket mit Reset.", "Aus dem Lower Bracket ins Grand Final, Reset erzwingen und gewinnen.",
           "rotate-ccw", "reset", "bracket_resets_won", [1], "{n} Bracket Reset gewonnen.", sort_order=229),
]

GROUPS_A: list[dict] = [group for group, _tiers in MATCH + TOURNAMENT]
TIERS_A: list[dict] = [t for _group, tiers in MATCH + TOURNAMENT for t in tiers]
