"""Gleichstände einer Liga-Staffel, die einen Entscheid brauchen (Nr. 156, F.1/F.2, #2262): Meister-Gleichstand in der obersten Liga und
Gleichstände an einer Zonengrenze. Blatt-Modul: Abschluss (``league_final``) und Tabelle (``league_table``) rechnen mit denselben
Funktionen, ohne sich gegenseitig zu importieren. Nur ``league_zones`` (selbst ein Blatt) und die Datenbank."""
from __future__ import annotations

from services import league_zones

# Wie entschieden wurde (F.1, Nr. 156) - Abschluss und Staffel-Seite zeigen dieselben Wörter.
METHODS = {"playoff": "Entscheidungsspiel", "lot": "Los", "lead": "Entscheid der Leitung"}


def leaders(rows: list[dict]) -> list[dict]:
    """Die Teams auf dem besten Platz unter denen, die noch in der Wertung stehen. Ausgeschiedene zählen nicht mit - auch wenn sie
    rechnerisch vorn stehen (Regel ``half``: Das ausgetretene Team behält seine Punkte, Meister wird es nicht)."""
    active = [row for row in rows if not row.get("exit") and int(row.get("rank") or 0) > 0]
    if not active:
        return []
    best = min(int(row["rank"]) for row in active)
    return [row for row in active if int(row["rank"]) == best]


def champion_ties(rows: list[dict]) -> list[dict]:
    """Echter Gleichstand um den Meistertitel (Nr. 156) - unter den Teams, die noch in der Wertung stehen."""
    first = leaders(rows)
    if len(first) < 2:
        return []
    return [{"rank": int(first[0]["rank"]), "registration_ids": [row["registration_id"] for row in first],
             "names": [row.get("display_name") or "Team" for row in first], "points": first[0].get("points")}]


async def top_division_id(db, season_id: str | None) -> str | None:
    """Die oberste Liga N der Season (kleinste Stufe) - nur dort ist Platz 1 der Meister."""
    rows = await db.league_divisions.find({"season_id": season_id}, {"_id": 0, "id": 1, "level": 1, "status": 1}).to_list(50)
    rows = [row for row in rows if (row.get("status") or "active") == "active"] or rows
    return min(rows, key=lambda row: (row.get("level") if isinstance(row.get("level"), int) else 99, row["id"]))["id"] if rows else None


def classify_ties(rows: list[dict], *, decisive: bool, zones: dict | None) -> list[dict]:
    """Die Gleichstände, die vor dem Abschluss einen Entscheid brauchen (Nr. 156, F.2): der Meister-Gleichstand (nur in der obersten Liga,
    ``kind: champion``) und Gleichstände an einer Zonengrenze (``kind: zone``), die nicht schon im Meister-Gleichstand stehen. Abschluss
    und Staffel-Seite (#2262) rechnen mit derselben Funktion."""
    champion = [{**tie, "kind": "champion"} for tie in champion_ties(rows)] if decisive else []
    taken = {tie["rank"] for tie in champion}
    zone_ties = [tie for tie in league_zones.boundary_ties(rows, zones) if tie["rank"] not in taken] if zones else []
    return [*champion, *zone_ties]


def division_levels(divisions) -> list[int]:
    """Die Stufen der aktiven Ligen einer Season - daraus rechnen die Zonen (``league_zones.effective``)."""
    return sorted({row["level"] for row in divisions if isinstance(row.get("level"), int) and row.get("status") != "archived"})


async def tie_context(db, tournament: dict) -> tuple[bool, dict | None]:
    """Für eine einzelne Staffel: Ist ihre Liga die oberste (Meister) und welche Zonen gelten? - wie ``season_overview`` je Staffel."""
    context = (tournament or {}).get("league_context") or {}
    season_id = context.get("season_id")
    if not season_id:
        return False, None
    divisions = await db.league_divisions.find({"season_id": season_id}, {"_id": 0}).to_list(50)
    division = next((row for row in divisions if row.get("id") == context.get("division_id")), None)
    if not division:
        return False, None
    top = await top_division_id(db, season_id)
    return division["id"] == top, league_zones.effective(division, division_levels(divisions))
