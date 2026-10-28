"""Folgenschwere Turnier-Aktionen absichern (#2120).

Was Spiele samt Ergebnissen löscht oder einen festen Turnierbaum umwirft (Zurücksetzen, Struktur anwenden, Gruppen
generieren, eine Phase neu bauen, eine Schweizer Runde zurücknehmen, eine Anmeldung entfernen), prüft der Server hier
- nicht nur die Oberfläche:

- **Nach dem Ende** (Beendet, Ergebnisse veröffentlicht, Archiviert) bleibt der Baum, wie er gespielt wurde: daran
  hängen Platzierungen, Jahreswertung, Pokale und Gewinne.
- **Echte Spiele** (kein Vorschau-Spiel) ersetzt keine Vorschau, und gelöscht werden sie nur mit ``force`` - die
  Antwort davor nennt die Zahl der Spiele und wie viele davon begonnen oder gewertet sind, damit die Rückfrage sie
  nennen kann.
- **Ab dem Ende des Check-ins** steht der Baum: Format, Teilnahme, Teamgröße und Spiel ändern sich dann nicht mehr.

Die Liga-Staffel hat ihre eigenen, strengeren Sperren in ``services/staffel_guard.py``; hier stehen die für alle
Turniere.
"""
from __future__ import annotations

from services.match_v2_results import _draw_started
from services.staffel_guard import PRE_START_STATUSES, same_value

# Nach dem Ende: der Baum ist Geschichte.
FINISHED_STATUSES = frozenset({"completed", "results_published", "archived"})

# Felder, die ab dem Ende des Check-ins feststehen (TA9) - mit der Bezeichnung im Formular.
STRUCTURE_FIELDS: dict[str, str] = {
    "format": "Turnierstruktur",
    "team_mode": "Teilnahme",
    "team_size": "Spieler pro Team",
    "game_id": "Spiel",
}
# Was den Vorschau-Baum verändert, solange er noch Vorschau ist.
PREVIEW_FIELDS = ("format", "team_mode", "team_size")

FINISHED_REFUSED = ("Das Turnier ist vorbei – der Turnierbaum bleibt, wie er gespielt wurde. Platzierungen, "
                    "Jahreswertung, Pokale und Gewinne hängen daran.")
PREVIEW_OVER_REAL_REFUSED = ("Der Turnierbaum steht schon fest ({impact}). Eine Vorschau ersetzt keine echten Spiele "
                             "– wer neu aufbauen will, setzt den Turnierbaum erst zurück.")
STRUCTURE_FIXED_REFUSED = ("{label}: Der Turnierbaum steht seit dem Ende des Check-ins fest – das lässt sich jetzt "
                           "nicht mehr ändern.")


def match_can_be_rebuilt(match: dict) -> bool:
    """Darf ein Spiel beim Neubau einfach verschwinden? Vorschau, noch nicht begonnen oder ein Freilos."""
    status = match.get("status") or "pending"
    if match.get("is_preview") or status in {"pending", "ready", "scheduled", "cancelled"}:
        return True
    if status == "completed" and (match.get("result_meta") or {}).get("source") == "auto_bye":
        return True
    return False


# Freilos im Baum und im Schweizer System: entschieden, aber nie gespielt.
BYE_SOURCES = frozenset({"auto_bye", "swiss_bye"})


def match_begun(match: dict) -> bool:
    """Hat ein Spiel begonnen - aufgerufen, gestartet, gemeldet oder gewertet? Ein Freilos zählt nicht."""
    if match.get("is_preview"):
        return False
    if match.get("status") == "completed" and (match.get("result_meta") or {}).get("source") in BYE_SOURCES:
        return False
    return _draw_started(match)


def match_impact(matches: list[dict]) -> dict:
    """Wie viele echte Spiele, und wie viele davon begonnen oder gewertet sind (auch aufgerufen oder mit einem
    Ergebnis, das noch im Rückgängig-Fenster steht)."""
    real = [match for match in matches if not match.get("is_preview")]
    played = [match for match in real if not match_can_be_rebuilt(match) or match_begun(match)]
    return {"match_count": len(real), "played_count": len(played)}


def impact_text(impact: dict) -> str:
    """„12 Spiele, davon 3 begonnen oder gewertet“ - für Meldungen und Rückfragen."""
    count = int(impact.get("match_count") or 0)
    played = int(impact.get("played_count") or 0)
    games = "1 Spiel" if count == 1 else f"{count} Spiele"
    if not played:
        return f"{games}, keines davon begonnen"
    return f"{games}, davon {played} begonnen oder gewertet"


def confirm_detail(code: str, message: str, impact: dict) -> dict:
    """Die 409-Antwort vor einer Löschung: Text und Zahlen für die Rückfrage, ``force=true`` bestätigt."""
    return {"code": code, "message": message, **impact}


def finished_problem(tournament: dict) -> str | None:
    return FINISHED_REFUSED if tournament.get("status") in FINISHED_STATUSES else None


async def tournament_matches(db, query: dict) -> list[dict]:
    return await db.matches_v2.find(query, {"_id": 0}).to_list(5000)


async def structure_fixed(db, tournament: dict) -> bool:
    """Steht der Turnierbaum? Nach dem Ende des Check-ins, nach dem Start - oder sobald es echte Spiele gibt
    (Gruppen generiert, Schweizer Runde erzeugt)."""
    if tournament.get("check_in_closed_at") or tournament.get("status") not in PRE_START_STATUSES:
        return True
    return bool(await db.matches_v2.count_documents(
        {"tournament_id": tournament["id"], "is_preview": {"$ne": True}}))


def _team_settings(doc: dict) -> tuple:
    """Teilnahme und Teamgröße, wie der Server sie speichert: Einzelspieler heißt immer Größe 1."""
    mode = doc.get("team_mode") or "solo"
    if mode == "solo":
        return ("solo", 1)
    try:
        return (mode, int(doc.get("team_size") or 2))
    except (TypeError, ValueError):
        return (mode, doc.get("team_size"))


def changed_fields(updates: dict, existing: dict, fields) -> list[str]:
    """Welche der Felder ``updates`` wirklich ändert - Teilnahme und Teamgröße so verglichen, wie sie gespeichert
    werden (ein mitgeschicktes ``team_size: 1`` bei Einzelspielern ändert nichts)."""
    changed = []
    team_before = _team_settings(existing)
    team_after = _team_settings({**existing, **{key: updates[key] for key in ("team_mode", "team_size") if key in updates}})
    for key in fields:
        if key not in updates:
            continue
        if key == "team_mode":
            if team_after[0] != team_before[0]:
                changed.append(key)
        elif key == "team_size":
            if team_after[1] != team_before[1] and team_after[0] == team_before[0]:
                changed.append(key)
        elif not same_value(key, updates[key], existing.get(key)):
            changed.append(key)
    return changed


async def structure_update_problem(db, updates: dict, existing: dict) -> str | None:
    """Format, Teilnahme, Teamgröße und Spiel nach dem Ende des Check-ins (TA9) - die erste Änderung als Meldung."""
    changed = changed_fields(updates, existing, STRUCTURE_FIELDS)
    if not changed or not await structure_fixed(db, existing):
        return None
    return STRUCTURE_FIXED_REFUSED.format(label=STRUCTURE_FIELDS[changed[0]])


async def fixed_match_count(db, tid: str, registration_id: str) -> int:
    """In wie vielen festen (nicht Vorschau-)Spielen eine Anmeldung steht."""
    return await db.matches_v2.count_documents({
        "tournament_id": tid, "slots.registration_id": registration_id, "is_preview": {"$ne": True},
    })


def registration_removal_refused(tournament: dict) -> str:
    """Warum eine Anmeldung im festen Baum nicht einfach verschwinden darf - und was stattdessen geht (TA13)."""
    status = tournament.get("status")
    if status in FINISHED_STATUSES or status == "cancelled":
        return ("Die Anmeldung steht in Spielen dieses Turniers – nach dem Ende bleibt die Teilnehmerliste, wie "
                "gespielt wurde.")
    if status in {"live", "paused"}:
        return ("Die Anmeldung steht im festen Turnierbaum – entfernen würde Baum, Tabelle und Platzierungen "
                "verfälschen. Bitte „Austritt eintragen“ oder „Disqualifizieren“ nutzen.")
    if not tournament.get("check_in_closed_at"):
        # Vor dem Check-in-Ende gibt es feste Spiele nur nach „Gruppen generieren“ oder einer Schweizer Runde.
        return ("Die Anmeldung steht schon in festen Spielen (etwa generierte Gruppen oder eine Schweizer Runde). "
                "Die Turnierleitung kann die Spiele neu generieren bzw. die Runde zurücknehmen – danach geht Entfernen.")
    return ("Die Anmeldung steht im festen Turnierbaum. Bitte „Nicht erschienen“ setzen und mit „Ersetzt "
            "Nicht-Erschienen“ einen Ersatz eintragen.")


SELF_UNREGISTER_FIXED = ("Du stehst schon in festen Spielen dieses Turniers – abmelden geht nur noch über die "
                         "Turnierleitung.")
