"""Kennzeichen je Spiel einer Liga-Staffel für die Verwaltung (#2262, Paket B: Reiter „Spiele und Ergebnisse“ der Staffel-Seite).

Nur zum Anzeigen: Check-in, Veto, offene Vorfälle und offene Verfahren - jeweils dieselbe Rechnung wie Matchseite und Leitstand
(``checkin_rules.state``, ``league_incident_rules.open_incidents``, ``match_disputes.open_procedure_rows``). Nichts wird gespeichert,
der Stand entsteht beim Lesen. Bedient wird auf der Matchseite.
"""
from __future__ import annotations

from datetime import datetime

from services import checkin_rules
from services.league_incident_rules import open_incidents
from services.match_disputes import open_procedure_rows


def match_marks(match: dict, tournament: dict | None, *, now: datetime | None = None) -> dict:
    """``checkin``: der abgeleitete Stand (``none``, ``open``, ``closed``, ``veto``, ``ready`` …), ``checked_in``: Seiten mit gültigem
    Check-in, ``veto``: Stand des Vetos (``running``, ``paused``, ``done``, ``skipped``) oder ``None``, ``incidents`` und
    ``procedures``: Zahl der offenen Vorfälle bzw. Verfahren."""
    veto = ((match.get("flow") or {}).get("veto") or {}) if isinstance(match.get("flow"), dict) else {}
    return {
        "checkin": checkin_rules.state(match, tournament, now),
        "checked_in": len(checkin_rules.checkins(match)),
        "veto": (veto.get("status") if isinstance(veto, dict) else None) or None,
        "incidents": len(open_incidents(match)),
        "procedures": len(open_procedure_rows(match)),
    }
