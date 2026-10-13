"""Level wie in einem MMO (#617): eine Kurve für alles, Level 1–60, Titel je fünf Level, Prestige-Sterne.

Löwen-Rang (#1452): Die Titel sind 12 Ränge zu je fünf Level (Rang 12 = 55–60), jeder mit eigenem Rahmen. Der
Rang-Name ist zugleich der Titel - Abzeichen, XP-Balken, Profil, App und Mails zeigen überall denselben Namen.

XP von Level n−1 auf n: ``round(60 · n^1,5 / 10) · 10``. Level 60 braucht 683.150 XP; Level 30 rund 123.000,
eine aktive Person schafft etwa 60.000 im Jahr. Nach 60 ist Prestige freiwillig: Level zurück auf 1, ein
Stern, die Kurve wird je Stern um ein Viertel länger, Erfolge und Punkte bleiben.

Die alte Quadratkurve (``n² · 100``) lebt hier weiter, weil die Team-Level sie benutzen und unverändert
bleiben sollen - aber nur noch an einer Stelle.
"""
from __future__ import annotations

MAX_LEVEL = 60
MAX_PRESTIGE = 5
MEMBER_BONUS = 0.10
PRESTIGE_FACTOR = 1.25
RANK_SIZE = 5
RANK_NAMES = (
    "Jungtier", "Fährte", "Rudel", "Jäger", "Silbermähne", "Goldmähne",
    "Löwenhaupt", "Brüller", "Schwingen", "Obsidian", "Sonnenlöwe", "Löwenkönig",
)
# Ab welchem Level ein Titel gilt: Rang 1 ab 1, danach alle fünf Level (5, 10, … 55).
TITLES = [(max(1, index * RANK_SIZE), name) for index, name in enumerate(RANK_NAMES)]


def xp_step(level: int, prestige: int = 0) -> int:
    """XP von Level ``level−1`` auf ``level`` (Level 1 ist geschenkt)."""
    if level <= 1:
        return 0
    base = round(60 * level ** 1.5 / 10) * 10
    return int(round(base * prestige_multiplier(prestige) / 10) * 10)


def prestige_multiplier(prestige: int) -> float:
    return PRESTIGE_FACTOR ** max(0, min(int(prestige or 0), MAX_PRESTIGE))


def xp_for_level(level: int, prestige: int = 0) -> int:
    """Gesamt-XP, die Level ``level`` braucht."""
    level = max(1, min(int(level), MAX_LEVEL))
    return sum(xp_step(n, prestige) for n in range(2, level + 1))


def level_for_xp(xp: int, prestige: int = 0) -> int:
    xp = max(0, int(xp or 0))
    level = 1
    total = 0
    while level < MAX_LEVEL:
        step = xp_step(level + 1, prestige)
        if xp < total + step:
            break
        total += step
        level += 1
    return level


def title_for_level(level: int) -> str:
    title = TITLES[0][1]
    for threshold, name in TITLES:
        if level >= threshold:
            title = name
    return title


def next_title_at(level: int) -> int | None:
    for threshold, _name in TITLES:
        if threshold > level:
            return threshold
    return None


def rank_for_level(level: int) -> int:
    """Rang 1–12: Level 1–4 sind Rang 1, danach je fünf Level ein Rang, Level 55–60 Rang 12."""
    level = max(1, min(int(level or 1), MAX_LEVEL))
    return min(len(RANK_NAMES), level // RANK_SIZE + 1)


def rank_view(level: int) -> dict:
    """Rang, Name, Spanne und ``step`` (Level innerhalb des Rangs, 0–4; im Rang 12 bis 5 bei Level 60)."""
    level = max(1, min(int(level or 1), MAX_LEVEL))
    rank = rank_for_level(level)
    rank_from = max(1, (rank - 1) * RANK_SIZE)
    rank_to = MAX_LEVEL if rank == len(RANK_NAMES) else rank * RANK_SIZE - 1
    return {"rank": rank, "rank_name": RANK_NAMES[rank - 1], "rank_from": rank_from, "rank_to": rank_to, "step": level - rank_from}


def level_view(xp: int, prestige: int = 0, *, member: bool = False) -> dict:
    """Alles, was Profil, Dashboard und App über das Level wissen wollen."""
    xp = max(0, int(xp or 0))
    prestige = max(0, min(int(prestige or 0), MAX_PRESTIGE))
    level = level_for_xp(xp, prestige)
    current_floor = xp_for_level(level, prestige)
    next_floor = xp_for_level(level + 1, prestige) if level < MAX_LEVEL else current_floor
    span = max(next_floor - current_floor, 1)
    progress = 100 if level >= MAX_LEVEL else round(((xp - current_floor) / span) * 100)
    return {
        "level": level,
        "xp": xp,
        "points": xp,  # alter Name für Clients, die noch „points“ lesen
        "current_level_points": current_floor,
        "next_level_points": next_floor,
        "current_level_xp": current_floor,
        "next_level_xp": next_floor,
        "progress": max(0, min(progress, 100)),
        "title": title_for_level(level),
        "next_title_at": next_title_at(level),
        "prestige": prestige,
        "max_level": MAX_LEVEL,
        "prestige_available": level >= MAX_LEVEL and prestige < MAX_PRESTIGE,
        "member_bonus": MEMBER_BONUS if member else 0,
        **rank_view(level),
    }


def legacy_square_curve(points: int) -> dict:
    """Die alte Kurve ``n² · 100`` - heute nur noch für Team-Level."""
    points = max(int(points or 0), 0)
    level = 1
    while points >= (level * level * 100):
        level += 1
    current_floor = (level - 1) * (level - 1) * 100
    next_floor = level * level * 100
    span = max(next_floor - current_floor, 1)
    progress = round(((points - current_floor) / span) * 100)
    return {
        "level": level,
        "points": points,
        "current_level_points": current_floor,
        "next_level_points": next_floor,
        "progress": max(0, min(progress, 100)),
    }
