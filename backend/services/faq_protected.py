"""FAQ (#2448): Fragen, die nicht jeder sehen darf - und wer was sieht.

Öffentliche Fragen und Anleitungen stehen im Frontend (frontend/src/hilfe/fragen.json, themen/*.json) und dürfen dort
nur ``sichtbar_fuer: "alle"`` tragen. Alles andere steht nur hier und geht erst nach der Prüfung am Server hinaus
(``GET /api/faq``): Mitglieder-Fragen an Vereinsmitglieder, Fragen der Turnierleitung an alle, die eine Turnierleitung
öffnen dürfen. Dieselben Felder wie im Frontend: ``id``, ``frage``, ``antwort``, ``bereich``, ``rollen``,
``sichtbar_fuer``, optional ``haeufig`` und ``link`` (``to``, ``label``).

Stufen „turnierleitung“ und „turnierleitung_verwaltung“ (Review #2448, F2): Die Leitungsansicht eines Turniers
(``routes/tournament_lead_routes.py``) öffnen auch Helfer mit aktivem Einsatz und die Liga-Leitung. Sie sehen die
Fragen zu Check-in, Aufruf und Ergebnissen. Fragen, deren Weg über die Verwaltung führt, sehen nur Personen mit dem
Bereich Turnierleitung.

Stufe „helfer“ (Fabian 16.11., #2448 Paket 3): Fragen zu „Mein Dienst“ und zur Nachricht beim Eintragen sehen
Mitglieder und alle mit einem aktiven Helfer-Einsatz in einem Turnier - auch ohne Mitgliedschaft. Ein beendeter Einsatz
zählt nicht.

Achtung, das Repository ist öffentlich: Diese Datei liest jeder auf GitHub. Hier steht nur Bedienung, nichts
Vertrauliches (keine Zugänge, keine internen Abläufe, keine Namen). Die Prüfung am Server regelt nur, wem die Seite
eine Frage zeigt - geheim ist sie dadurch nicht.
"""
from __future__ import annotations

import copy

from database import get_db
from services import league_permissions
from services.permissions import can_use_area, needs_mfa
from services.tournament_permissions import READ_STAFF_ROLES, RESULT_STAFF_ROLES
from services.visibility import sees_member_content

# Stufen der Sichtbarkeit, von offen nach eng. „alle“ liefert das Frontend selbst aus.
VISIBILITIES = ("alle", "angemeldet", "mitglied", "helfer", "turnierleitung", "turnierleitung_verwaltung")
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
    {
        "id": "mitgliedsnummer",
        "frage": "Wo finde ich Mitgliedsnummer und Mitgliedskarte?",
        "antwort": "Unter Meine Mitgliedschaft. Oben steht deine Nummer, darunter die Karte mit Prüfcode. Ob die Nummer öffentlich steht, entscheidest nur du.",
        "bereich": "verein-mitgliedschaft",
        "rollen": ["mitglied"],
        "sichtbar_fuer": "mitglied",
        "link": {"to": "/members/membership", "label": "Zu Meine Mitgliedschaft"},
    },
    {
        "id": "mitgliederverzeichnis",
        "frage": "Wie komme ich ins Mitgliederverzeichnis?",
        "antwort": "Unter Meine Mitgliedschaft schaltest du Im Mitgliederverzeichnis zeigen ein. Gamertag, Spiele und Plattformen trägst du dort selbst ein.",
        "bereich": "verein-mitgliedschaft",
        "rollen": ["mitglied"],
        "sichtbar_fuer": "mitglied",
        "link": {"to": "/members/membership", "label": "Zu Meine Mitgliedschaft"},
    },
    {
        "id": "austritt",
        "frage": "Wie trete ich aus dem Verein aus?",
        "antwort": "Unter Meine Mitgliedschaft tippst du auf Austritt erklären, auf Wunsch mit Wunschtermin. Wann die Mitgliedschaft endet, ergibt sich aus der Regel des Vereins. Zurücknehmen geht nur, solange der Austritt nicht fest eingetragen ist.",
        "bereich": "verein-mitgliedschaft",
        "rollen": ["mitglied"],
        "sichtbar_fuer": "mitglied",
        "link": {"to": "/members/membership", "label": "Zu Meine Mitgliedschaft"},
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
    {
        "id": "helferdienst-stand",
        "frage": "Was heißt angefragt, bestätigt und geleistet?",
        "antwort": "Ich helfe ist eine Anfrage. Bestätigt der Vorstand, steht bestätigt dabei. Gezählt wird, was der Verein danach als geleistet bestätigt.",
        "bereich": "helferdienste",
        "rollen": ["mitglied"],
        "sichtbar_fuer": "mitglied",
        "link": {"to": "/members/helfen", "label": "Zu den Helferdiensten"},
    },
    {
        "id": "mein-dienst",
        "frage": "Wo sehe ich meine Einsätze bei Turnieren?",
        "antwort": "Oben rechts im Menü unter Mein Dienst. Bei Deine Einsätze steht jedes Turnier, bei dem du hilfst, mit deiner Rolle.",
        "bereich": "helferdienste",
        "rollen": ["mitglied"],
        "sichtbar_fuer": "helfer",
    },
    {
        "id": "helfer-nachricht",
        "frage": "Woher weiß ich, dass ich als Helfer eingetragen bin?",
        "antwort": "Trägt dich die Turnierleitung ein, kommt eine Nachricht in die Glocke. Sie nennt deine Rolle und was du darfst. Ein Tipp führt zu Mein Dienst.",
        "bereich": "helferdienste",
        "rollen": ["mitglied"],
        "sichtbar_fuer": "helfer",
    },
    # Turnierleitung - nur mit dem Bereich Turnierleitung.
    {
        "id": "leitung-ansicht",
        "frage": "Wie öffne ich die Turnierleitung eines Turniers?",
        "antwort": "Die Ansicht liegt unter der Adresse des Turniers mit /leitung am Ende. In der Verwaltung führt beim Turnier unter Teilnehmer der Knopf Zum Check-in hin.",
        "bereich": "turnierleitung",
        "rollen": ["turnierleitung"],
        "sichtbar_fuer": "turnierleitung_verwaltung",
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
        "sichtbar_fuer": "turnierleitung_verwaltung",
        "link": {"to": "/admin/events", "label": "Zu den Events in der Verwaltung"},
    },
    {
        "id": "leitung-cockpit",
        "frage": "Was zeigt das Cockpit?",
        "antwort": "Links stehen die Probleme, Dringendes zuerst. Rechts stehen die Stationen mit dem, was läuft und als Nächstes kommt. Ein Tipp auf ein Problem führt zum Fall.",
        "bereich": "turnierleitung",
        "rollen": ["turnierleitung"],
        "sichtbar_fuer": "turnierleitung",
    },
    {
        "id": "leitung-aufmerksamkeit",
        "frage": "Was landet in Braucht Aufmerksamkeit?",
        "antwort": "Streitfälle, nicht erschienene Spieler, defekte Stationen sowie fehlende oder abweichende Ergebnisse. Erledigtes verschwindet von selbst. Bei neuen Fällen kommt eine Benachrichtigung.",
        "bereich": "turnierleitung",
        "rollen": ["turnierleitung"],
        "sichtbar_fuer": "turnierleitung",
    },
    {
        "id": "leitung-alle-aufrufen",
        "frage": "Kann ich alle freien Stationen auf einmal aufrufen?",
        "antwort": "Ja. Im Reiter Stationen tippst du auf Alle freien Stationen aufrufen und bestätigst. Gestartet wird dabei nichts.",
        "bereich": "turnierleitung",
        "rollen": ["turnierleitung"],
        "sichtbar_fuer": "turnierleitung",
    },
    {
        "id": "leitung-abschluss",
        "frage": "Wie hole ich den Abschluss eines Turniers nach?",
        "antwort": "In der Verwaltung tippst du beim Turnier unter Werkzeuge auf Abschluss nachholen. Das prüft Auszeichnungen, Erfolge, Jahreswertung und Gewinne und vergibt, was fehlt.",
        "bereich": "turnierleitung",
        "rollen": ["turnierleitung"],
        "sichtbar_fuer": "turnierleitung_verwaltung",
        "link": {"to": "/admin/tournaments", "label": "Zu den Turnieren in der Verwaltung"},
    },
)


NO_ACCESS = {"angemeldet": False, "mitglied": False, "helfer": False, "turnierleitung": False, "turnierleitung_verwaltung": False}


async def _helps_in_a_tournament(user: dict) -> bool:
    """Ein aktiver Helfer-Einsatz mit einer Rolle, die die Leitungsansicht öffnet (wie ``tournament_lead_routes``)."""
    if not user.get("id"):
        return False
    row = await get_db().tournament_staff_assignments.find_one(
        {"user_id": user["id"], "is_active": {"$ne": False}, "role": {"$in": sorted(READ_STAFF_ROLES | RESULT_STAFF_ROLES)}},
        {"_id": 1},
    )
    return row is not None


async def _has_helper_assignment(user: dict) -> bool:
    """Irgendein aktiver Helfer-Einsatz in einem Turnier, gleich mit welcher Rolle (Stufe „helfer“)."""
    if not user.get("id"):
        return False
    row = await get_db().tournament_staff_assignments.find_one({"user_id": user["id"], "is_active": {"$ne": False}}, {"_id": 1})
    return row is not None


async def _leads_a_league(user: dict) -> bool:
    """Liga-Leitung wie der Einstieg der Liga-Verwaltung (``require_any_league``): Bereich Ligen oder eine Zuständigkeit,
    beides nur mit bestätigter Zwei-Faktor-Anmeldung."""
    if league_permissions.has_leagues_area(user):
        return True
    return not needs_mfa(user) and bool(await league_permissions.staffed_league_ids(get_db(), user))


async def viewer_access(user: dict | None) -> dict[str, bool]:
    """Was die Person einer Anfrage sehen darf. Mitglied wie bei allen Mitglieder-Inhalten (``sees_member_content``).
    Turnierleitung (Verwaltung) wie ``require_area("tournaments")`` samt Zwei-Faktor; die Stufe „turnierleitung“ hat
    zusätzlich, wer die Leitungsansicht eines Turniers öffnen darf - aktiver Helfer-Einsatz oder Liga-Leitung. „helfer“:
    Mitglied oder irgendein aktiver Helfer-Einsatz."""
    if not user:
        return dict(NO_ACCESS)
    area = await can_use_area(user, "tournaments")
    member = await sees_member_content(user)
    return {
        "angemeldet": True,
        "mitglied": member,
        "helfer": member or await _has_helper_assignment(user),
        "turnierleitung": area or await _helps_in_a_tournament(user) or await _leads_a_league(user),
        "turnierleitung_verwaltung": area,
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
