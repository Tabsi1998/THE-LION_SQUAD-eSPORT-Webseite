"""Vorgaben für Season-Felder, deren Einstellung erst mit einem späteren Paket kommt (docs/LIGA.md, „D.5/E.2-Vertrag“).

Blatt-Modul ohne weitere Importe: Der Regeltext (``league_rule_vars``) und die Aufbewahrung der Nachweise (``match_proofs``)
lesen dieselben Vorgaben, ohne einander zu importieren. D.5 (Vorfälle), E.2 (Proteste) und E.3 (Strafen) tragen ihre neuen
Felder hier ein. Ohne Feld an Staffel und Season gilt der Wert von hier.
"""
from __future__ import annotations

PRESETS = {"protest_hours": 48, "appeal_hours": 48, "evidence_keep_days": 30, "map_break_after": 2, "map_break_minutes": 5,
           # D.5 Vorfälle (#1619): Antwortzeit der Gegenseite in Minuten, Rehosts und technische Pausen je Team und Map, Serie bei
           # einer Map „in Klärung“.
           "incident_answer_minutes": 10, "incident_quota_per_map": 1, "clarification_mode": "continue"}

# D.5 Vorfälle (#1619): die Season-Felder der Gruppe ``incidents`` (``league_service.SYNC_GROUPS``) - an Season und Staffel gleich benannt.
INCIDENT_FIELDS = ("map_break_after", "map_break_minutes", "incident_answer_minutes", "incident_quota_per_map", "clarification_mode")
CLARIFICATION_MODES = ("continue", "pause_series")

# E.2 (#1619): Stellungnahme, Zielfrist der Leitung, MOSS-Datei, Gründe zum Antippen und das angefochtene Ergebnis in der Tabelle.
PRESETS.update({
    "statement_hours": 48,
    "protest_target_hours": 72,
    "protest_escalate_hours": 24,
    "moss_upload_hours": 24,
    "contested_result_mode": "counts",
    "protest_reasons": [
        {"key": "wrong_result", "label": "Falsches Ergebnis", "ask_notified": False},
        {"key": "rule_violation", "label": "Regelverstoß", "ask_notified": False},
        {"key": "equipment", "label": "Ausrüstung", "ask_notified": True},
        {"key": "lobby", "label": "Lobby und Einstellungen", "ask_notified": True},
        {"key": "player", "label": "Spielberechtigung eines Spielers", "ask_notified": True},
        {"key": "cheating", "label": "Cheat-Verdacht", "ask_notified": False},
        {"key": "technical", "label": "Technik", "ask_notified": False},
        {"key": "other", "label": "Sonstiges", "ask_notified": False},
    ],
})
