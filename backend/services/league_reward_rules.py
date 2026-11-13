"""Belohnungen der Liga (F.4, #2214): die reinen Regeln - Arten, Plätze, Empfänger, was in einer Liga N gilt und die Sicht für die
Ligaseite. Blatt-Modul ohne schwere Importe: ``awards``, ``league_service`` und ``league_rewards`` lesen dieselbe Rechnung."""
from __future__ import annotations

KINDS = {"banner": "Banner", "emblem": "Emblem", "medal": "Medaille", "title": "Titel"}
RECIPIENTS = {"team": "Team", "players": "Spieler"}
PLAYER_BASIS = {"fielded": "Spieler mit Einsatz", "roster": "Ganzer Kader zum Abschluss"}
DEFAULT_BASIS = "fielded"
MODES = ("rank", "range", "all")
METALS = {1: "gold", 2: "silver", 3: "bronze"}


def place_label(places: dict | None) -> str:
    places = places or {}
    if places.get("mode") == "rank":
        return f"{places.get('rank')}. Platz"
    if places.get("mode") == "range":
        return f"Platz {places.get('from')}–{places.get('to')}"
    return "Alle Teilnehmer"


def recipients_label(recipients, basis: str = DEFAULT_BASIS) -> str:
    parts = []
    if "team" in (recipients or []):
        parts.append("Team")
    if "players" in (recipients or []):
        parts.append(PLAYER_BASIS.get(basis, PLAYER_BASIS[DEFAULT_BASIS]))
    return " und ".join(parts)


def fits(places: dict | None, rank, *, exited: bool = False) -> bool:
    """Gilt die Belohnung für diesen Platz? Ausgeschiedene und Disqualifizierte bekommen nichts, auch nicht „alle Teilnehmer“."""
    if exited:
        return False
    places = places or {}
    if places.get("mode") == "all":
        return True
    if not isinstance(rank, int) or isinstance(rank, bool) or rank < 1:
        return False
    if places.get("mode") == "rank":
        return rank == places.get("rank")
    if places.get("mode") == "range":
        return int(places.get("from") or 0) <= rank <= int(places.get("to") or 0)
    return False


def metal_of(places: dict | None, rank=None) -> str:
    """Die Farbe der Vorlage: Gold, Silber, Bronze für Platz 1 bis 3, sonst Lionsquad-Blau („lion“)."""
    places = places or {}
    if places.get("mode") == "rank":
        return METALS.get(places.get("rank"), "lion")
    if places.get("mode") == "range" and isinstance(rank, int):
        return METALS.get(rank, "lion")
    return "lion"


def effective(season: dict | None, division: dict | None) -> list[dict]:
    """Was in dieser Liga N gilt: die eigene Zusammenstellung, sonst die der Season."""
    own = (division or {}).get("rewards")
    if isinstance(own, list):
        return list(own)
    return list((season or {}).get("rewards") or [])


def basis_of(season: dict | None) -> str:
    value = (season or {}).get("reward_players")
    return value if value in PLAYER_BASIS else DEFAULT_BASIS


def public_item(item: dict, basis: str = DEFAULT_BASIS) -> dict:
    return {
        "id": item.get("id"), "kind": item.get("kind"), "kind_label": KINDS.get(item.get("kind") or "", "Belohnung"),
        "name": item.get("name"), "description": item.get("description") or "", "places": item.get("places") or {},
        "place_label": place_label(item.get("places")), "recipients": list(item.get("recipients") or []),
        "recipients_label": recipients_label(item.get("recipients"), basis), "image_url": item.get("image_url") or None,
        "prize": item.get("prize") or None, "metal": metal_of(item.get("places")),
    }


def public_view(season: dict | None, division: dict | None = None, *, own_only: bool = False) -> list[dict] | None:
    """Die Belohnungen für die Ligaseite. ``own_only``: nur eine eigene Zusammenstellung der Liga N, sonst ``None``."""
    basis = basis_of(season)
    if own_only:
        own = (division or {}).get("rewards")
        return [public_item(item, basis) for item in own] if isinstance(own, list) else None
    return [public_item(item, basis) for item in effective(season, division)]


def _order(places: dict | None) -> tuple:
    places = places or {}
    if places.get("mode") == "rank":
        return (0, int(places.get("rank") or 0))
    if places.get("mode") == "range":
        return (1, int(places.get("from") or 0))
    return (2, 0)
