"""Erfolge II, Katalog B (#613): Fast Lap, Saison, Team - 26 Gruppen mit 136 Stufen als Daten der Stufenleiter v2.

Gleiches Muster wie Katalog A: je Gruppe ein Bedingungsschlüssel (Zähler aus services/achievement_counters.py oder
aus dem alten Block), Ziele je Stufe, Symbol, Abzeichen-Motiv (E8) und „So schaffst du es“ (E9); Stufenname =
Gruppenname plus römische Zahl. Alte Gruppen, die hier aufgehen, stehen in ``REPLACED`` (Abbildung für die
Migration), Gruppen mit gleichem Code und neuer Leiter in ``REDEFINED``.
"""
from __future__ import annotations

from .catalog_a import _group

# Alte Gruppe → neue Gruppe (E1-Migration: Vergaben werden über die Zähler der neuen Gruppe neu ausgewertet).
REPLACED: dict[str, str] = {
    "fastlap_volume": "laps_valid",
    "fastlap_elite": "laps_valid",
    "pole_position_collector": "pole",
    "track_master": "tracks",
    "season_consistency": "seasons_active",
    "team_loyalty": "team_tenure",
    "platform_chat": "team_chat",
    "sub_target_breaker": "sub_target",
}
# Gleicher Code wie im alten Katalog, neue Leiter und Bedingung: die alte Definition weicht.
REDEFINED = ("season_points", "season_climber", "team_founder", "championship_top")


def _b(*args, **kwargs):
    return _group(*args, catalog="B", **kwargs)


FASTLAP = [
    _b("laps_valid", "Rundenzähler", "fastlap", "Sammle gültige Fast-Lap-Runden.", "Reich Rundenzeiten bei Fast-Lap-Challenges ein; jede gültige Runde zählt.",
       "flag", "checkered-flag", "fastlap_valid_count", [10, 50, 150, 500, 1000, 2500, 5000], "{n} gültige Runden.", sort_order=310),
    _b("pole", "Pole Position", "fastlap", "Halte die Bestzeit auf einer Strecke.", "Fahr auf einer Strecke die schnellste gültige Zeit aller - jede Strecke zählt einmal.",
       "trophy", "pole", "pole_count", [1, 3, 7, 15, 30, 60, 100], "{n} Pole Positions.", sort_order=311),
    _b("tracks", "Streckenkenner", "fastlap", "Fahr auf vielen verschiedenen Strecken.", "Jede Strecke mit einer gültigen Runde zählt einmal.",
       "map", "track", "distinct_tracks", [3, 7, 15, 25, 40, 60, 100], "{n} verschiedene Strecken.", sort_order=312),
    _b("pb_improvements", "Immer schneller", "fastlap", "Verbessere deine eigene Bestzeit.", "Jede gültige Runde, die schneller ist als deine bisherige Bestzeit auf der Strecke, zählt.",
       "trending-down", "stopwatch", "pb_improvements", [5, 25, 75, 200, 500, 1000, 2500], "{n} eigene Bestzeiten verbessert.", sort_order=313),
    _b("sub_target", "Zielzeit geknackt", "fastlap", "Unterbiete die Zielzeit einer Strecke.", "Strecken mit Zielzeit: jede gültige Runde unter der Zielzeit zählt.",
       "target", "target", "sub_target_laps", [1, 5, 15, 40, 100], "{n} Runden unter der Zielzeit.", sort_order=314),
    _b("championship_top", "Meisterschafts-Top", "fastlap", "Lande in der Championship einer Challenge unter den ersten Drei.", "Platz 1 bis 3 in der Gesamtwertung einer abgeschlossenen Fast-Lap-Challenge.",
       "crown", "podium-flag", "championship_top3", [1, 3, 7, 15, 30], "{n}-mal in den Top 3 einer Championship.", sort_order=315),
    _b("grand_prix", "Grand-Prix-Fahrer", "fastlap", "Fahr Grand-Prix-Turniere.", "Melde dich zu Turnieren im Format Grand Prix an; jede Anmeldung zählt.",
       "car", "helmet", "grand_prix_entries", [1, 5, 15, 40, 100], "{n} Grand-Prix-Anmeldungen.", sort_order=316),
    _b("lap_record", "Streckenrekord", "fastlap", "Halte Streckenrekorde.", "Deine Bestzeit ist die schnellste gültige Zeit auf der Strecke - so viele Strecken hältst du gerade.",
       "medal", "record", "track_records_held", [1, 3, 7, 15, 30], "{n} Streckenrekorde gehalten.", sort_order=317),
    _b("consistency", "Konstanz", "fastlap", "Fahr gleichmäßig schnell.", "Auf einer Strecke zehn gültige Runden binnen einem Prozent deiner Bestzeit - jede Strecke zählt einmal.",
       "activity", "metronome", "consistent_sessions", [1, 5, 15, 40, 100], "{n}-mal konstant gefahren.", sort_order=318),
]

SEASON = [
    _b("seasons_active", "Saisonstammgast", "season", "Sei in vielen Saisons dabei.", "Eine Turnieranmeldung in einer Saison reicht - jede Saison zählt einmal.",
       "calendar-check", "calendar-star", "seasons_active", [1, 2, 4, 6, 10, 15, 25], "{n} Saisons aktiv.", sort_order=410),
    _b("season_points", "Saisonpunkte", "season", "Sammle Saisonpunkte über alle Saisons.", "Punkte aus Turnieren, Fast-Lap-Challenges und Events zählen zusammen.",
       "star", "points", "season_points_total", [25, 100, 250, 500, 1000, 2500, 5000], "{n} Saisonpunkte gesammelt.", sort_order=411),
    _b("season_top10", "Saisonspitze", "season", "Beende Saisons unter den besten Zehn.", "Platz 1 bis 10 in der Rangliste einer abgeschlossenen Saison.",
       "list-ordered", "top-ten", "season_top10_finishes", [1, 3, 7, 15, 30], "{n}-mal in den Top 10 einer Saison.", sort_order=412),
    _b("season_champion", "Saisonmeister", "season", "Gewinne Saisons.", "Platz 1 in der Rangliste einer abgeschlossenen Saison.",
       "crown", "champion", "season_wins", [1, 2, 4, 7, 12], "{n} Saisons gewonnen.", sort_order=413),
    _b("season_climber", "Aufsteiger", "season", "Kämpf dich in einer Saison nach oben.", "Mindestens zehn Plätze in der Rangliste einer Saison gutmachen - der Stand wird täglich festgehalten.",
       "trending-up", "ladder-up", "season_climbs_10", [1, 3, 7, 15, 30], "{n}-mal um zehn Plätze aufgestiegen.", sort_order=414),
    _b("season_complete", "Volle Saison", "season", "Spiel eine Saison komplett.", "In einer abgeschlossenen Saison bei jedem Turnier und jeder Challenge dabei gewesen.",
       "calendar-range", "full-calendar", "seasons_fully_played", [1, 3, 7, 15, 30], "{n} Saisons komplett gespielt.", sort_order=415),
    _b("season_opener", "Saisonstart", "season", "Sei beim ersten Turnier einer Saison dabei.", "Anmeldung zum ersten Turnier einer Saison - jede Saison zählt einmal.",
       "play", "starting-lights", "season_openers_played", [1, 5, 15], "{n} Saisonstarts gespielt.", sort_order=416),
]

TEAM = [
    _b("team_founder", "Gründer", "team", "Gründe Teams.", "Ein Team anlegen oder leiten - jedes Team zählt einmal.",
       "users", "banner", "teams_founded", [1, 3, 5], "{n} Teams gegründet.", sort_order=510),
    _b("team_tenure", "Teamtreue", "team", "Bleib deinem Team lange treu.", "Die längste Zeit in ein und demselben Team zählt, in Tagen.",
       "shield", "shield-heart", "team_days_max", [7, 30, 90, 180, 365, 730, 1500], "{n} im selben Team.", sort_order=511, unit=" Tage"),
    _b("team_wins", "Teamsieger", "team", "Gewinne Matches mit deinem Team.", "Ein Match, das dein Team gewinnt, während du dabei bist, zählt.",
       "trophy", "team-trophy", "team_match_wins", [1, 10, 40, 100, 250, 600, 1500], "{n} Team-Matches gewonnen.", sort_order=512),
    _b("team_tournaments", "Teamturniere", "team", "Spiel Turniere im Team.", "Jedes Turnier, zu dem dein Team angemeldet ist, zählt einmal.",
       "ticket", "team-ticket", "team_tournaments_played", [1, 5, 15, 40, 100], "{n} Teamturniere.", sort_order=513),
    _b("team_level", "Team-Level", "team", "Bring dein Team auf ein hohes Level.", "Das höchste Level eines deiner Teams zählt.",
       "bar-chart-3", "level-bars", "team_level_max", [5, 10, 20, 30, 50], "Team-Level {n} erreicht.", sort_order=514),
    _b("team_captain", "Kapitän", "team", "Führ dein Team lange.", "Tage als Leitung eines Teams - das längste zählt.",
       "crown", "captain-band", "captain_days", [30, 180, 365, 730, 1500], "{n} als Kapitän.", sort_order=515, unit=" Tage"),
    _b("team_size", "Vollbesetzung", "team", "Bau ein großes Team auf.", "So viele Mitglieder hat dein größtes Team.",
       "users-round", "roster", "team_size_max", [3, 5, 10], "{n} Mitglieder im Team.", sort_order=516),
    _b("team_chat", "Teamgeist", "team", "Schreib im Team-Chat.", "Nachrichten im Team-Chat zählen.",
       "message-circle", "team-chat", "team_chat_messages_sent", [10, 50, 150, 500, 1500], "{n} Nachrichten im Team-Chat.", sort_order=517),
    _b("team_identity", "Teamauftritt", "team", "Gib deinem Team ein Gesicht.", "Logo, Banner und Beschreibung deines Teams sind ausgefüllt.",
       "image", "emblem", "team_profile_complete", [1], "Teamprofil vollständig.", sort_order=518),
    _b("team_recruiter", "Rekrutierer", "team", "Hol neue Leute ins Team.", "Einladungen, die angenommen werden, zählen.",
       "user-plus", "handshake-team", "team_invites_accepted", [1, 3, 7, 15, 30], "{n} Einladungen angenommen.", sort_order=519),
]

GROUPS_B: list[dict] = [group for group, _tiers in FASTLAP + SEASON + TEAM]
TIERS_B: list[dict] = [t for _group, tiers in FASTLAP + SEASON + TEAM for t in tiers]
