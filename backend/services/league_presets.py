"""Vorgaben für Season-Felder, deren Einstellung erst mit einem späteren Paket kommt (docs/LIGA.md, „D.5/E.2-Vertrag“).

Blatt-Modul ohne weitere Importe: Der Regeltext (``league_rule_vars``) und die Aufbewahrung der Nachweise (``match_proofs``)
lesen dieselben Vorgaben, ohne einander zu importieren. D.5 (Vorfälle), E.2 (Proteste) und E.3 (Strafen) tragen ihre neuen
Felder hier ein. Ohne Feld an Staffel und Season gilt der Wert von hier.
"""
from __future__ import annotations

PRESETS = {"protest_hours": 48, "appeal_hours": 48, "evidence_keep_days": 30, "map_break_after": 2, "map_break_minutes": 5}
