"""Liga-Abzeichen (#1638): was das Wappen braucht - ein Blatt-Modul ohne Abhängigkeiten.

Profil, Teamseite, Historie (``league_current``, ``league_history``, ``team_page``) und das Saisonfinale am TV bzw. die
Discord-Meldungen (``league_finale``, #2561) nehmen es von hier. ``league_current.badge`` bleibt als Name erhalten.
"""
from __future__ import annotations


def badge(division: dict | None, *, champion: bool = False) -> dict | None:
    """Was das Liga-Abzeichen braucht: ``{level, nickname, champion}`` - ``None`` ohne Liga N."""
    level = (division or {}).get("level")
    if not isinstance(level, int) or level < 1:
        return None
    nickname = " ".join(str((division or {}).get("nickname") or "").split()) or None
    return {"level": level, "nickname": nickname, "champion": bool(champion)}
