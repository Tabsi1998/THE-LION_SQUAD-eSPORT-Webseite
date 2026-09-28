"""Erfolge II (#611): die Stufenleiter Holz → Eisen → Bronze → Silber → Gold → Platin → Diamant, dazu
Legendär (rot, eine Stufe) und Geheim (versteckt bis zur Freischaltung), die elf Kategorien und die
Helfer, mit denen der alte Katalog (Level 1–5) und der neue (Material + Rang) dieselbe Sprache sprechen.

``level`` bleibt in der API als Zahl 1–5 für alte Clients (App 1.0.x): Holz, Eisen und Bronze zeigen
sich dort als Bronze, Diamant als Platin. Neue Clients lesen ``material`` und ``rank``.
"""
from __future__ import annotations

# Reihenfolge = Leiter. legacy_level: was ein alter Client sieht. discord: Farbe als Zahl für Einbettungen.
MATERIALS: dict[str, dict] = {
    "wood": {"rank": 1, "name": "Holz", "points": 5, "color": "#A0703C", "legacy_level": 1},
    "iron": {"rank": 2, "name": "Eisen", "points": 10, "color": "#9AA0A6", "legacy_level": 1},
    "bronze": {"rank": 3, "name": "Bronze", "points": 20, "color": "#CD7F32", "legacy_level": 1},
    "silver": {"rank": 4, "name": "Silber", "points": 35, "color": "#C0C0C0", "legacy_level": 2},
    "gold": {"rank": 5, "name": "Gold", "points": 60, "color": "#FFD700", "legacy_level": 3},
    "platinum": {"rank": 6, "name": "Platin", "points": 100, "color": "#29B6E8", "legacy_level": 4},
    "diamond": {"rank": 7, "name": "Diamant", "points": 160, "color": "#B9F2FF", "legacy_level": 4},
    "legendary": {"rank": 8, "name": "Legendär", "points": 250, "color": "#FF3B30", "legacy_level": 5},
    "hidden": {"rank": 9, "name": "Geheim", "points": 40, "color": "#A855F7", "legacy_level": 5},
}
MATERIAL_ORDER = list(MATERIALS)
LADDER_MATERIALS = [m for m in MATERIAL_ORDER if MATERIALS[m]["rank"] <= 7]
# Leitern: 7 Stufen für Zähler, 5 für wenige sinnvolle Schritte, 3 für seltene Dinge, 1 für Einmaliges.
LADDERS: dict[int, list[str]] = {
    7: ["wood", "iron", "bronze", "silver", "gold", "platinum", "diamond"],
    5: ["bronze", "silver", "gold", "platinum", "diamond"],
    3: ["silver", "gold", "diamond"],
    1: ["bronze"],
}
LEGACY_LEVEL_TO_MATERIAL = {1: "bronze", 2: "silver", 3: "gold", 4: "platinum"}

# Kategorien in der Reihenfolge der Seite. member_only: nur Vereinsmitglieder sehen und bekommen sie.
CATEGORIES: dict[str, dict] = {
    "match": {"label": "Spielen", "order": 1, "icon": "swords", "accent": "#29B6E8"},
    "tournament": {"label": "Turnier", "order": 2, "icon": "trophy", "accent": "#FFD700"},
    "fastlap": {"label": "Fast Lap", "order": 3, "icon": "flag", "accent": "#A855F7"},
    "season": {"label": "Saison", "order": 4, "icon": "calendar-days", "accent": "#29B6E8"},
    "team": {"label": "Team", "order": 5, "icon": "users", "accent": "#00FF88"},
    "community": {"label": "Community", "order": 6, "icon": "messages-square", "accent": "#29B6E8"},
    "creator": {"label": "Streaming & Creator", "order": 7, "icon": "radio", "accent": "#9146FF"},
    "profile": {"label": "Profil & Konto", "order": 8, "icon": "user-round", "accent": "#00FF88"},
    "club": {"label": "Verein", "order": 9, "icon": "crown", "accent": "#FFD700", "member_only": True},
    "special": {"label": "Besonders", "order": 10, "icon": "sparkles", "accent": "#FF3B30"},
    "hidden": {"label": "Geheim", "order": 11, "icon": "eye-off", "accent": "#A855F7", "hidden": True},
    "negative": {"label": "Negativ", "order": 12, "icon": "alert-triangle", "accent": "#FF3B30", "negative": True},
}
# Alte Kategorienamen aus dem Katalog v4 → neue.
LEGACY_CATEGORY_MAP = {"content": "creator", "progression": "profile"}


def material_for_legacy(level, group: dict | None = None) -> str:
    """Material für ein altes Level 1–5: 5 ist Legendär, bei Negativ-Gruppen Geheim."""
    level = int(level or 1)
    if level >= 5:
        return "hidden" if group and group.get("is_negative") else "legendary"
    return LEGACY_LEVEL_TO_MATERIAL.get(level, "bronze")


def legacy_level(material: str | None) -> int:
    return int(MATERIALS.get(material or "", {}).get("legacy_level", 1))


def material_rank(material: str | None) -> int:
    return int(MATERIALS.get(material or "", {}).get("rank", 0))


def material_name(material: str | None) -> str:
    return str(MATERIALS.get(material or "", {}).get("name", "?"))


def material_color(material: str | None) -> str:
    return str(MATERIALS.get(material or "", {}).get("color", "#CD7F32"))


def material_color_int(material: str | None) -> int:
    return int(material_color(material).lstrip("#"), 16)


def material_points(material: str | None) -> int:
    return int(MATERIALS.get(material or "", {}).get("points", 10))


def category_v2(category: str | None) -> str:
    key = str(category or "").strip()
    return LEGACY_CATEGORY_MAP.get(key, key) if key in CATEGORIES or key in LEGACY_CATEGORY_MAP else (key or "special")


def tier(code: str, group_code: str, material: str, name: str, description: str, *, condition_key: str | None = None,
         progress_target: int | None = None, points: int | None = None, icon: str | None = None, art: str | None = None,
         how_to: str | None = None, manual_only: bool = False, member_only: bool = False) -> dict:
    """Eine Stufe im Katalog v2: Material statt Level, Punkte aus der Materialtabelle, wenn nicht gesetzt."""
    if material not in MATERIALS:
        raise ValueError(f"Unbekanntes Material: {material}")
    return annotate_tier({
        "code": code, "group_code": group_code, "material": material, "name": name, "description": description,
        "condition_key": condition_key, "progress_target": progress_target,
        "points": material_points(material) if points is None else int(points),
        "icon": icon, "art": art or icon, "how_to": how_to or description,
        "manual_only": manual_only, "member_only": member_only,
    })


def annotate_tier(tier_doc: dict, group: dict | None = None) -> dict:
    """Material, Rang, Namen, Farbe und das alte Level an eine Stufe hängen - alt wie neu."""
    explicit = tier_doc.get("material") in MATERIALS
    material = tier_doc["material"] if explicit else material_for_legacy(tier_doc.get("level"), group)
    out = dict(tier_doc)
    out.update({
        "material": material,
        "rank": material_rank(material),
        "material_name": material_name(material),
        "material_color": material_color(material),
        # Neue Stufen leiten das alte Level vom Material ab; alte behalten ihres (1–5).
        "level": legacy_level(material) if explicit else int(tier_doc.get("level") or 1),
    })
    out.setdefault("art", out.get("icon"))
    out.setdefault("how_to", out.get("description") or "")
    return out


def annotate_group(group: dict) -> dict:
    out = dict(group)
    out["category"] = category_v2(out.get("category"))
    out.setdefault("hidden", out["category"] == "hidden")
    out.setdefault("how_to", "")
    return out


def ladder_targets(targets: list, ladder: int | None = None) -> list[tuple[str, object]]:
    """Ziele auf die Leiter legen: [(Material, Ziel), …] - sieben Ziele = Holz bis Diamant."""
    size = ladder or len(targets)
    if size not in LADDERS or len(targets) != size:
        raise ValueError(f"Leiter {size} passt nicht zu {len(targets)} Zielen")
    return list(zip(LADDERS[size], targets))
