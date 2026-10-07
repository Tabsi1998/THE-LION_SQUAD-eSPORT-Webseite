"""Was eine Spielseite zeigt, wenn man das Turnier nicht leitet.

Ein Spiel-Datensatz trägt auch Internes: Notizen der Turnierleitung, Begründungen ihrer Entscheidungen, wer ein
Ergebnis eingetragen hat, Einsprüche mit Begründung, die einzelnen Meldungen der Spieler und Konto-Kennungen. Das
sieht nur, wer das Turnier leitet. Alle anderen bekommen die öffentlichen Felder; wer selbst gemeldet oder
widersprochen hat, sieht dazu seine eigene Meldung und seinen eigenen Einspruch. Wie viele Meldungen und Einsprüche
es gibt, bleibt sichtbar.
"""
from __future__ import annotations

# Nur für die Turnierleitung - oben im Datensatz, in `result_meta` und in jeder Ergebniszeile.
INTERNAL_KEYS = frozenset({"admin_note", "admin_decision_note", "admin_decision_at"})
INTERNAL_META_KEYS = frozenset({"note"})
INTERNAL_RESULT_KEYS = frozenset({"user_id", "note"})


def _public_keys(value: dict, internal: frozenset) -> dict:
    # Wer etwas getan hat (`*_by`), sind Konto-Kennungen - die gehören nicht auf eine öffentliche Seite.
    return {key: item for key, item in value.items() if key not in internal and not key.endswith("_by")}


def public_match_view(match: dict | None, viewer_id: str | None = None) -> dict | None:
    """Der Spiel-Datensatz ohne Internes. `viewer_id`: wer schaut - seine eigene Meldung und sein Einspruch bleiben."""
    if not isinstance(match, dict):
        return match
    out = _public_keys(match, INTERNAL_KEYS)
    if isinstance(match.get("result_meta"), dict):
        out["result_meta"] = _public_keys(match["result_meta"], INTERNAL_META_KEYS)
    if isinstance(match.get("results"), list):
        out["results"] = [_public_keys(row, INTERNAL_RESULT_KEYS) if isinstance(row, dict) else row for row in match["results"]]
    if "reports" in match:
        out["reports"] = [
            row if viewer_id and row.get("user_id") == viewer_id else {"registration_id": row.get("registration_id"), "at": row.get("at")}
            for row in match.get("reports") or [] if isinstance(row, dict)
        ]
    if "disputes" in match:
        out["disputes"] = [
            row if viewer_id and row.get("user_id") == viewer_id else {"at": row.get("at")}
            for row in match.get("disputes") or [] if isinstance(row, dict)
        ]
    return out


def public_tournament_view(tournament: dict | None) -> dict | None:
    """Das Turnier auf der Spielseite: ohne die interne Abrechnung (`billing`) - wie die öffentliche Turnierseite."""
    if not isinstance(tournament, dict):
        return tournament
    return {key: value for key, value in tournament.items() if key != "billing"}
