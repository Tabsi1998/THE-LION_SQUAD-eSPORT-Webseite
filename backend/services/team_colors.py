"""Team-Farbe (#1347): acht ruhige Farben für den Wappen-Kopf der Team-Seite.

Kapitän und Co-Kapitän wählen beim Bearbeiten eine davon; ohne Wahl („auto“) nimmt der Kopf die Farbe des Spiels,
das das Team am meisten spielt - immer dieselbe Farbe je Spiel. Ohne Spiel bleibt es beim Vereins-Cyan. Gespeichert
wird nur der Schlüssel; Web und App kennen dieselben Werte (frontend/src/lib/teamColors.js,
mobile/src/lib/teamColors.ts - ein Test im Web hält alle drei gleich).
"""
from __future__ import annotations

TEAM_COLORS: dict[str, str] = {
    "cyan": "#1C8DB8",
    "blue": "#3159C9",
    "violet": "#6A47B8",
    "wine": "#9C3656",
    "orange": "#C06A2B",
    "ochre": "#A07A2C",
    "green": "#2E8A5A",
    "slate": "#56627A",
}
AUTO = "auto"
DEFAULT_COLOR = "cyan"


def clean_color(value) -> str:
    """Nur bekannte Schlüssel; leer heißt „auto“. Unbekanntes ist ein Fehler, kein stiller Rückfall."""
    key = str(value or "").strip().lower()
    if not key or key == AUTO:
        return AUTO
    if key not in TEAM_COLORS:
        raise ValueError("Unbekannte Team-Farbe – erlaubt sind: " + ", ".join(TEAM_COLORS))
    return key


def game_color(game_id: str | None) -> str | None:
    """Die feste Farbe eines Spiels: aus seiner Kennung abgeleitet, damit sie überall gleich ist."""
    if not game_id:
        return None
    keys = list(TEAM_COLORS)
    return keys[sum(ord(ch) for ch in str(game_id)) % len(keys)]


def effective_color(team: dict | None, game_id: str | None = None) -> dict:
    """Die Farbe, die der Kopf zeigt: gewählt, sonst die des Spiels, sonst Cyan."""
    chosen = str((team or {}).get("color") or "").strip().lower()
    if chosen in TEAM_COLORS:
        return {"color": chosen, "color_hex": TEAM_COLORS[chosen], "color_source": "team"}
    from_game = game_color(game_id)
    if from_game:
        return {"color": from_game, "color_hex": TEAM_COLORS[from_game], "color_source": "game"}
    return {"color": DEFAULT_COLOR, "color_hex": TEAM_COLORS[DEFAULT_COLOR], "color_source": "default"}
