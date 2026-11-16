"""FAQ (#2448, vorher Hilfe #2295): Titel und Kurztext je Anleitung für die Teilen-Karte (Discord, WhatsApp) und die
Sitemap. Die FAQ liegt unter /faq; die alten Adressen /hilfe und /hilfe/<thema> leiten weiter (frontend/nginx.conf).

Die Anleitungen selbst stehen im Frontend (frontend/src/hilfe/themen/<slug>.json). Hier stehen nur Titel und Kurztext,
weil der Server die Vorschau ohne JavaScript baut. tests/test_help_topics.py prüft, dass beide gleich lauten.
"""
from __future__ import annotations

HELP_TITLE = "FAQ"
HELP_PATH = "/faq"
HELP_DESCRIPTION = "Häufige Fragen und kurze Anleitungen mit Bildern: Konto und Profil, Teams, Liga, Turniere und mehr."

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
    """Übersicht und alle Anleitungen, für die Sitemap - nur die neuen Adressen."""
    return [HELP_PATH, *(f"{HELP_PATH}/{slug}" for slug in HELP_TOPICS)]
