"""Erfolge II, Katalog D (#615): Verein, Besonders, Geheim - 33 Gruppen als Daten der Stufenleiter v2.

Verein (nur Mitglieder, mit dem XP-Bonus aus E7), Besonders (Legendär, je eine Stufe), Geheim (versteckt bis zur
Freischaltung, 40 Punkte). Die sieben Negativ-Gruppen bleiben unverändert im alten Block. Zwölf Gruppen aus #615
fehlen hier bewusst, weil es ihre Daten (noch) nicht gibt: Versammlungen, Helferdienste, Helferstunden, LAN-Crew,
Mitgliederstimme und Förderer liegen nur live in Dolibarr; Pünktlicher Beitrag braucht das Zahldatum (der
Rechnungs-Zwischenspeicher kennt nur Status und Fälligkeit); Papierkram braucht ein Öffnen-Protokoll; Vorstandsarbeit
ein Datum je Besetzung; Mitglieder werben braucht Einladungslinks; Eierkönig die Eiersuche (Jahreszeiten III);
Sprinter den Zeitpunkt, an dem das Profil vollständig wurde. Sie stehen als Nachtrag im Issue.
"""
from __future__ import annotations

from .catalog_a import _group

REPLACED: dict[str, str] = {}
# Gleicher Code wie im alten Katalog, neue Leiter beziehungsweise neue Form (Hand-Gruppen behalten ihre Höhe).
REDEFINED = ("membership_tenure", "ehrenloewe", "gamers_heaven", "lan_founder", "beta_tester", "streamer_verified", "sponsor_friend")


def _d(*args, **kwargs):
    return _group(*args, catalog="D", **kwargs)


def _special(code, name, description, how_to, icon, art, key, *, sort_order, target=1, manual=False, step="Erreicht."):
    """Besonders: eine legendäre Stufe - von Hand oder mit einem Zähler und Ziel."""
    return _d(code, name, "special", description, how_to, icon, art, None if manual else key, [target], step, sort_order=sort_order, materials=["legendary"], manual=manual)


def _hidden(code, name, description, how_to, icon, art, key, *, sort_order, target=1, step="Gefunden."):
    """Geheim: eine versteckte Stufe, erst nach der Freischaltung mit Namen zu sehen."""
    return _d(code, name, "hidden", description, how_to, icon, art, key, [target], step, sort_order=sort_order, materials=["hidden"])


CLUB = [
    _d("membership_tenure", "Vereinsmitglied", "club", "Bleib dem Verein treu.", "Tage als aktives Mitglied - die Zeit läuft von selbst.",
       "crown", "membership-card", "membership_days", [1, 180, 365, 730, 1095, 1825, 3650], "{n} Tage Mitglied.", sort_order=910, unit=" Tage"),
    _d("member_card", "Mitgliedskarte", "club", "Hol dir deine Mitgliedskarte aufs Handy.", "Karte in die Wallet oder in die LionsAPP legen.",
       "id-card", "member-card", "member_card_added", [1], "Mitgliedskarte hinzugefügt.", sort_order=911),
    _d("club_events", "Vereinsleben", "club", "Sei bei vereinsinternen Events dabei.", "Zu internen Events anmelden und einchecken - jedes zählt einmal.",
       "users", "club-house", "club_events_attended", [1, 5, 15, 30, 60], "{n} interne Events besucht.", sort_order=912),
    _d("volunteer", "Ehrenamt", "club", "Pack im Verein mit an.", "Wird vom Vorstand vergeben, wenn du dich ehrenamtlich einbringst.",
       "heart-handshake", "volunteer", None, [1, 3, 7, 15, 30], "{n}-mal ehrenamtlich dabei.", sort_order=913, manual=True),
    _d("founding_member", "Gründungsmitglied", "club", "Von Anfang an dabei.", "Mitglied seit dem Gründungsjahr des Vereins - das lässt sich nicht nachholen.",
       "flag", "founding-flag", "member_since_founding_year", [1], "Seit dem Gründungsjahr dabei.", sort_order=914, materials=["gold"]),
]

SPECIAL = [
    _special("ehrenloewe", "Ehrenlöwe", "Die höchste Ehrung des Vereins.", "Wird vom Vorstand verliehen.", "crown", "honor-lion", None, sort_order=1010, manual=True, step="Ehrenlöwe des Vereins."),
    _special("gamers_heaven", "Gamers Heaven", "Live beim Gamers Heaven dabei gewesen.", "Wird nach dem Event von der Vereinsleitung vergeben.", "rocket", "gamers-heaven", None, sort_order=1011, manual=True, step="Beim Gamers Heaven dabei."),
    _special("lan_founder", "LAN-Gründer", "Bei der ersten LAN mit dabei.", "Wird von der Vereinsleitung vergeben.", "server", "lan-founder", None, sort_order=1012, manual=True, step="Bei der ersten LAN dabei."),
    _special("beta_tester", "Beta-Tester", "Die Plattform vor dem Start getestet.", "Wird von der Vereinsleitung vergeben.", "flask-conical", "beta", None, sort_order=1013, manual=True, step="Plattform vor dem Start getestet."),
    _special("streamer_verified", "Verifizierter Streamer", "Vom Verein bestätigter Kanal.", "Wird von der Vereinsleitung vergeben.", "badge-check", "verified-stream", None, sort_order=1014, manual=True, step="Kanal bestätigt."),
    _special("sponsor_friend", "Sponsorenfreund", "Hat dem Verein einen Sponsor gebracht.", "Wird von der Vereinsleitung vergeben.", "handshake", "sponsor", None, sort_order=1015, manual=True, step="Sponsor vermittelt."),
    _special("hall_of_fame", "Hall of Fame", "Ein Name, der bleibt.", "Wird von der Vereinsleitung verliehen.", "landmark", "hall-of-fame", None, sort_order=1016, manual=True, step="In der Hall of Fame."),
    _special("season_mvp", "Saison-MVP", "Die Spielerin oder der Spieler der Saison.", "Wird je Saison von der Vereinsleitung gewählt.", "star", "mvp", None, sort_order=1017, manual=True, step="MVP einer Saison."),
    _special("pioneer", "Pionier", "Eines der ersten hundert Konten.", "Nur die ersten hundert Konten der Plattform - lässt sich nicht nachholen.", "compass", "pioneer", "pioneer_account", sort_order=1018, step="Unter den ersten hundert."),
    _special("grand_slam", "Grand Slam", "Drei Spiele in einer Saison gewonnen.", "Turniere in drei verschiedenen Spielen in ein und derselben Saison gewinnen.", "trophy", "grand-slam", "distinct_game_wins_one_season", sort_order=1019, target=3, step="Drei Spiele in einer Saison gewonnen."),
    _special("iron_lion", "Eiserner Löwe", "365 Tage in Folge angemeldet.", "Ein Jahr lang jeden Tag vorbeischauen.", "shield", "iron-lion", "login_streak_max", sort_order=1020, target=365, step="365 Tage in Folge angemeldet."),
    _special("completionist", "Hundert Prozent", "Alle sichtbaren Erfolge freigeschaltet.", "Jede messbare Stufe, die du sehen kannst, ist erreicht.", "check-circle-2", "hundred", "all_visible_achievements", sort_order=1021, step="Alle sichtbaren Erfolge freigeschaltet."),
    _special("new_year", "Silvester dabei", "Um Mitternacht zu Silvester online gewesen.", "Am 31.12. um Mitternacht auf der Seite oder in der App sein.", "party-popper", "fireworks", "online_at_new_year", sort_order=1022, step="Silvester um Mitternacht dabei."),
    _special("advent_all", "Alle Türchen", "Alle 24 Türchen des Adventkalenders geöffnet.", "Jeden Tag im Advent das Türchen öffnen.", "calendar-heart", "advent", "advent_doors_opened", sort_order=1023, target=24, step="Alle 24 Türchen geöffnet."),
    _special("halloween", "Gruselnacht", "Am 31. Oktober abends den Kürbis angeklickt.", "Am 31.10. ab 18 Uhr den Kürbis oder die Laterne anklicken.", "ghost", "pumpkin-night", "halloween_pumpkin", sort_order=1024, step="Gruselnacht erlebt."),
]

HIDDEN = [
    _hidden("konami", "Konami", "Die alte Tastenfolge.", "Hoch, hoch, runter, runter, links, rechts, links, rechts, B, A - auf der Website.", "gamepad-2", "konami", "konami_found", sort_order=1110),
    _hidden("lost", "Verlaufen", "Auf der 404-Seite den Löwen gefunden.", "Auf einer Seite, die es nicht gibt, den Löwen anklicken.", "map-pin-off", "lost", "lost_404", sort_order=1111),
    _hidden("witching_hour", "Geisterstunde", "Ein Match zwischen Mitternacht und Viertel nach beendet.", "Zwischen 00:00 und 00:15 ein Match abschließen.", "moon-star", "witching-hour", "witching_hour_matches", sort_order=1112),
    _hidden("lucky_seven", "Glückliche Sieben", "Sieben Siege an einem Siebten.", "An einem 7. des Monats sieben Matches gewinnen.", "clover", "seven", "lucky_seven_days", sort_order=1113),
    _hidden("palindrome", "Spiegelbild", "Eine Rundenzeit, die sich von hinten liest wie von vorn.", "Zum Beispiel 1:23.321 auf einer Fast-Lap-Strecke.", "flip-horizontal", "palindrome", "palindrome_laps", sort_order=1114),
    _hidden("echo", "Echo", "Dreimal hintereinander dasselbe Ergebnis.", "Drei Matches in Folge mit demselben Stand beenden.", "repeat", "echo", "echo_results", sort_order=1115),
    _hidden("night_shift", "Nachtschicht", "Fünf Matches in einer Nacht.", "Nach 22 Uhr fünf Matches in derselben Nacht abschließen.", "moon", "night-shift", "night_shift_nights", sort_order=1116),
    _hidden("explorer", "Entdecker", "Jede öffentliche Seite einmal besucht.", "Alle Bereiche der Website einmal öffnen.", "compass", "explorer", "explorer_done", sort_order=1117),
    _hidden("lion_tamer", "Löwenbändiger", "Das Logo zwanzigmal angeklickt.", "Das Logo oben links - zwanzigmal.", "hand", "lion-tamer", "logo_clicks", sort_order=1118, target=20),
    _hidden("full_moon", "Vollmond", "Bei Vollmond ein Match gewonnen.", "Ein Match gewinnen, während der Mond voll ist (die Phase wird berechnet).", "circle", "full-moon", "full_moon_wins", sort_order=1119),
    _hidden("leap_day", "Zeitreisender", "Am 29. Februar angemeldet gewesen.", "An einem Schalttag vorbeischauen.", "calendar-clock", "leap-day", "leap_day_logins", sort_order=1120),
    _hidden("snow_king", "Schneekönig", "Fünfzig Schneeflocken gefangen.", "Im Winter fünfzig Schneeflocken anklicken.", "snowflake", "snow-king", "snowflakes_clicked", sort_order=1121, target=50),
    _hidden("first_egg", "Erstes Ei", "Das erste Osterei der Saison gefunden.", "Zu Ostern ein Ei entdecken.", "egg", "first-egg", "easter_eggs_found", sort_order=1122),
]

for _club_group, _club_tiers in CLUB:
    _club_group["member_only"] = True
    for _tier in _club_tiers:
        _tier["member_only"] = True

GROUPS_D: list[dict] = [group for group, _tiers in CLUB + SPECIAL + HIDDEN]
TIERS_D: list[dict] = [t for _group, tiers in CLUB + SPECIAL + HIDDEN for t in tiers]
CONDITION_KEYS_D: tuple[str, ...] = tuple(sorted({group["condition_key"] for group in GROUPS_D if group["condition_key"]}))
