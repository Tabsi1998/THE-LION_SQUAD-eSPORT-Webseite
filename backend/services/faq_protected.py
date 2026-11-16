"""FAQ (#2448): Fragen, die nicht jeder sehen darf - und wer was sieht.

Öffentliche Fragen und Anleitungen stehen im Frontend (frontend/src/hilfe/fragen.json, themen/*.json) und dürfen dort
nur ``sichtbar_fuer: "alle"`` tragen. Alles andere steht nur hier und geht erst nach der Prüfung am Server hinaus
(``GET /api/faq``): Mitglieder-Fragen an Vereinsmitglieder, Fragen der Turnierleitung an Personen mit dem Bereich
Turnierleitung. Dieselben Felder wie im Frontend: ``id``, ``frage``, ``antwort``, ``bereich``, ``rollen``,
``sichtbar_fuer``, optional ``haeufig`` und ``link`` (``to``, ``label``).
"""
from __future__ import annotations

import copy

from services.permissions import can_use_area
from services.visibility import sees_member_content

# Stufen der Sichtbarkeit, von offen nach eng. „alle“ liefert das Frontend selbst aus.
VISIBILITIES = ("alle", "angemeldet", "mitglied", "turnierleitung")
ROLES = ("spieler", "captain", "mitglied", "turnierleitung")

PROTECTED_QUESTIONS: tuple[dict, ...] = (
    # Verein & Mitgliedschaft - nur für Mitglieder.
    {
        "id": "mitgliedsbeitrag",
        "frage": "Wo sehe ich meinen Mitgliedsbeitrag?",
        "antwort": "Unter Meine Mitgliedschaft steht die Karte Mitgliedsbeitrag. Sie zeigt den Stand aus der Mitgliederverwaltung.",
        "bereich": "verein-mitgliedschaft",
        "rollen": ["mitglied"],
        "sichtbar_fuer": "mitglied",
        "link": {"to": "/members/membership", "label": "Zu Meine Mitgliedschaft"},
    },
    {
        "id": "versammlung-zusagen",
        "frage": "Wie sage ich zu einer Versammlung zu?",
        "antwort": "Öffne Versammlungen & Abstimmungen. Tippe bei der Einladung auf Ich komme, Vielleicht oder Ich komme nicht.",
        "bereich": "verein-mitgliedschaft",
        "rollen": ["mitglied"],
        "sichtbar_fuer": "mitglied",
        "link": {"to": "/members/meetings", "label": "Zu den Versammlungen"},
    },
    {
        "id": "vereinsdokumente",
        "frage": "Wo finde ich Statuten und Protokolle?",
        "antwort": "Im Mitgliederbereich unter Vereinsdokumente. Dort stehen Statuten, Protokolle, Formulare und Leitlinien.",
        "bereich": "verein-mitgliedschaft",
        "rollen": ["mitglied"],
        "sichtbar_fuer": "mitglied",
        "link": {"to": "/members/documents", "label": "Zu den Vereinsdokumenten"},
    },
    # Helferdienste - nur für Mitglieder.
    {
        "id": "helferdienst-eintragen",
        "frage": "Wie trage ich mich für einen Helferdienst ein?",
        "antwort": "Öffne Helferdienste und tippe bei einer Schicht auf Ich helfe. Das ist eine Anfrage. Der Vorstand bestätigt sie.",
        "bereich": "helferdienste",
        "rollen": ["mitglied"],
        "sichtbar_fuer": "mitglied",
        "haeufig": True,
        "link": {"to": "/members/helfen", "label": "Zu den Helferdiensten"},
    },
    {
        "id": "helferdienst-absagen",
        "frage": "Kann ich einen Helferdienst wieder absagen?",
        "antwort": "Solange der Vorstand nicht bestätigt hat, tippst du auf Anfrage zurückziehen. Ist die Schicht bestätigt, sag bitte beim Vorstand ab.",
        "bereich": "helferdienste",
        "rollen": ["mitglied"],
        "sichtbar_fuer": "mitglied",
        "link": {"to": "/members/helfen", "label": "Zu den Helferdiensten"},
    },
    # Turnierleitung - nur mit dem Bereich Turnierleitung.
    {
        "id": "leitung-ansicht",
        "frage": "Wie öffne ich die Turnierleitung eines Turniers?",
        "antwort": "Die Ansicht liegt unter der Adresse des Turniers mit /leitung am Ende. In der Verwaltung führt beim Turnier unter Teilnehmer der Knopf Zum Check-in hin.",
        "bereich": "turnierleitung",
        "rollen": ["turnierleitung"],
        "sichtbar_fuer": "turnierleitung",
        "haeufig": True,
        "link": {"to": "/admin/tournaments", "label": "Zu den Turnieren in der Verwaltung"},
    },
    {
        "id": "leitung-check-in",
        "frage": "Wie checke ich Spieler vor Ort ein?",
        "antwort": "Öffne in der Turnierleitung den Reiter Check-in. Ein Tipp auf eine Person checkt sie ein.",
        "bereich": "turnierleitung",
        "rollen": ["turnierleitung"],
        "sichtbar_fuer": "turnierleitung",
    },
    {
        "id": "leitung-aufrufen",
        "frage": "Wie rufe ich ein Spiel an eine Station auf?",
        "antwort": "Im Reiter Stationen tippst du auf Aufrufen und dann auf Starten. Aufrufen schickt den Spielern die Meldung Du bist dran.",
        "bereich": "turnierleitung",
        "rollen": ["turnierleitung"],
        "sichtbar_fuer": "turnierleitung",
    },
    {
        "id": "leitung-ergebnis",
        "frage": "Wie trage ich ein Ergebnis ein oder korrigiere es?",
        "antwort": "Im Reiter Ergebnisse tippst du beim Spiel auf Eintragen oder Korrigieren. Der Filter Ergebnis fehlt zeigt, was noch offen ist.",
        "bereich": "turnierleitung",
        "rollen": ["turnierleitung"],
        "sichtbar_fuer": "turnierleitung",
    },
    {
        "id": "leitung-einlass",
        "frage": "Wo checke ich Gäste beim Event ein?",
        "antwort": "Auf der Seite Anmeldungen & Einlass des Events. In der Verwaltung führt bei Events der Knopf Anm. dorthin. Je Person tippst du auf Check-in.",
        "bereich": "turnierleitung",
        "rollen": ["turnierleitung"],
        "sichtbar_fuer": "turnierleitung",
        "link": {"to": "/admin/events", "label": "Zu den Events in der Verwaltung"},
    },
)


async def viewer_access(user: dict | None) -> dict[str, bool]:
    """Was die Person einer Anfrage sehen darf. Mitglied wie bei allen Mitglieder-Inhalten
    (``sees_member_content``), Turnierleitung wie ``require_area("tournaments")`` - samt Zwei-Faktor."""
    if not user:
        return {"angemeldet": False, "mitglied": False, "turnierleitung": False}
    return {
        "angemeldet": True,
        "mitglied": await sees_member_content(user),
        "turnierleitung": await can_use_area(user, "tournaments"),
    }


def allowed(visibility: str, access: dict[str, bool]) -> bool:
    """Eine unbekannte Stufe zählt als gesperrt - lieber zu wenig zeigen als zu viel."""
    if visibility == "alle":
        return True
    if visibility not in VISIBILITIES:
        return False
    return bool(access.get(visibility))


def visible_questions(access: dict[str, bool]) -> list[dict]:
    return [copy.deepcopy(question) for question in PROTECTED_QUESTIONS if allowed(question["sichtbar_fuer"], access)]
