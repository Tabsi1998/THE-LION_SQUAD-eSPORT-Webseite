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
