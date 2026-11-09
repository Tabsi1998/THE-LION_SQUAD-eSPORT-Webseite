"""Hilfe-Bereich (#2295): Titel und Kurztext je Thema für die Teilen-Karte (Discord, WhatsApp) und die Sitemap.

Die Anleitungen selbst stehen im Frontend (frontend/src/hilfe/themen/<slug>.json). Hier stehen nur Titel und Kurztext,
weil der Server die Vorschau ohne JavaScript baut. tests/test_help_topics.py prüft, dass beide gleich lauten.
"""
from __future__ import annotations

HELP_TITLE = "Hilfe"
HELP_DESCRIPTION = "Kurze Anleitungen mit Bildern für Spieler und Captains: Konto und Profil, Team und Co-Team, Liga, Turniere."

HELP_TOPICS: dict[str, tuple[str, str]] = {
    "konto-und-profil": (
        "Konto und Profil",
        "Konto anlegen, Profil einrichten, Geburtsdatum, Plattform und Spiel-IDs wie die Activision-ID eintragen.",
    ),
    "team-und-co-team": (
        "Team und Co-Team",
        "Team erstellen, Leute einladen oder beitreten, ein Co-Team für ein Spiel anlegen und Captain und Vertreter festlegen.",
    ),
    "liga-captains": (
        "Liga für Captains",
        "Co-Team zur Liga anmelden, offene Punkte nachtragen, Termin ausmachen, einchecken, Ergebnis melden und bestätigen.",
    ),
    "turniere": (
        "Turniere",
        "Zum Turnier anmelden, einchecken, Ergebnis melden und den Turnierbaum lesen.",
    ),
}


def help_paths() -> list[str]:
    """Übersicht und alle Themen, für die Sitemap."""
    return ["/hilfe", *(f"/hilfe/{slug}" for slug in HELP_TOPICS)]
