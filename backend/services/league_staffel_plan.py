"""Staffelzahl und Los auf mehrere Staffeln einer Liga N (#1623, #1627, docs/LIGA.md „B.4 Los auf mehrere Staffeln“).

Blatt-Modul ohne Datenbank und ohne Importe aus dem Projekt außer ``league_rounds``: das Los (``league_draw``), die Platzprüfung der
Folge-Season (``league_successor``) und später die Playoff-Staffeln (#2404) rechnen hier dasselbe.

- **Staffelzahl** (``suggest``): Die größte Staffel ist das Kleinere aus der Einstellung „Teams je Staffel höchstens“ und dem, was die
  aktiven Wochen hergeben (``league_rounds.max_teams_for``). Daraus die Zahl der Staffeln und ihre Größen - Unterschied höchstens 1.
- **Los** (``draw``): Die Reihenfolge kommt aus dem Seed - je Co-Team der SHA-256 aus Seed und Kennung, sortiert. Kein Zufallsgenerator,
  kein Zustand: gleiche Eingabe und gleicher Seed ergeben auf jedem Rechner dasselbe. Verteilt wird in dieser Reihenfolge reihum auf die
  Staffel mit den meisten freien Plätzen; Hauptteams mit mehreren Co-Teams zuerst, damit Geschwister sicher getrennt stehen.
- **Was nicht geht, wird gesagt** (``DrawProblem``): zu wenige Plätze, mehr Geschwister als Staffeln. Nichts wird still gelockert.
"""
from __future__ import annotations

import hashlib
import json

from services.league_rounds import max_teams_for

# Die Fassung der Rechnung: Ändert sich die Verteilung bei gleicher Eingabe, zählt sie hoch - ein altes Los bleibt damit erkennbar.
POLICY = 1
MIN_TEAMS = 2
SEARCH_LIMIT = 50_000

NO_ENTRIES = "Es gibt kein angenommenes Co-Team ohne Staffel – nichts auszulosen."
NO_STAFFELN = "Diese Liga hat noch keine Staffel, in die gelost werden kann."
NO_SEATS = "{teams} Co-Teams, aber nur {free} freie Plätze in {count}. Bitte eine weitere Staffel anlegen oder die Staffelgröße erhöhen."
TOO_MANY_SIBLINGS = ("Ein Hauptteam hat mehr Co-Teams als Staffeln, in denen noch keines von ihm steht. Zwei Co-Teams eines Hauptteams "
                     "spielen in dieser Season nicht in derselben Staffel.")
NO_SOLUTION = "Mit der Regel für Co-Teams eines Hauptteams lässt sich keine ausgeglichene Verteilung finden. Bitte von Hand zuteilen."
SWAP_UNKNOWN = "Dieses Co-Team steht nicht im Los."
SWAP_SAME = "Beide Co-Teams stehen in derselben Staffel – da gibt es nichts zu tauschen."
SWAP_SIBLING = "Nach dem Tausch stünden zwei Co-Teams eines Hauptteams in derselben Staffel."


class DrawProblem(ValueError):
    def __init__(self, message: str, status: int = 409, team_ids: list[str] | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.team_ids = team_ids or []


# ---------------------------------------------------------------- Staffelzahl

def balanced_sizes(teams: int, count: int) -> list[int]:
    """``teams`` auf ``count`` Staffeln, Unterschied höchstens 1, die größeren zuerst."""
    teams, count = max(int(teams or 0), 0), max(int(count or 0), 0)
    if not count:
        return []
    base, extra = divmod(teams, count)
    return [base + (1 if index < extra else 0) for index in range(count)]


def _words(sizes: list[int]) -> str:
    parts = [str(size) for size in sizes]
    return parts[0] if len(parts) == 1 else f"{', '.join(parts[:-1])} und {parts[-1]}"


def _staffeln(count: int) -> str:
    return "1 Staffel" if count == 1 else f"{count} Staffeln"


def suggest(teams: int, *, max_size: int | None, active_weeks: int | None, legs: int | None, have: int = 0,
            have_word: str = "Es gibt") -> dict:
    """Wie viele Staffeln ``teams`` Co-Teams brauchen und wie groß sie werden. ``have``: Staffeln, die es schon gibt - dann sagt
    ``fits``, ob sie reichen, und ``sizes`` verteilt auf alle vorhandenen. ``have_word``: wie der Satz die vorhandenen Staffeln
    nennt („Es gibt“, in der Vorschau der Folge-Season „Bisher gab es“)."""
    teams, have = max(int(teams or 0), 0), max(int(have or 0), 0)
    by_setting = max(int(max_size or 0), 0)
    by_weeks = max_teams_for(int(active_weeks or 0), int(legs or 1))
    cap = min(by_setting, by_weeks) if by_setting else by_weeks
    out = {"teams": teams, "cap": cap, "cap_setting": by_setting or None, "cap_weeks": by_weeks,
           "cap_by": "weeks" if by_weeks < by_setting or not by_setting else "setting", "have": have, "needed": 0, "sizes": [], "fits": True, "text": ""}
    if not teams:
        return out
    if cap < MIN_TEAMS:
        return {**out, "fits": False,
                "text": f"Mit {int(active_weeks or 0)} aktiven Wochen passt keine Staffel in den Kalender. Bitte mehr Wochen einplanen."}
    needed = -(-teams // cap)
    count = max(needed, have)
    sizes = balanced_sizes(teams, count)
    limit = f"höchstens {cap} je Staffel" + (f" (mehr lassen {int(active_weeks or 0)} aktive Wochen nicht zu)" if out["cap_by"] == "weeks" else "")
    out.update({"needed": needed, "sizes": sizes})
    if teams < MIN_TEAMS:
        return {**out, "fits": False, "text": f"Nur 1 Co-Team – für eine Staffel braucht es mindestens {MIN_TEAMS}."}
    text = f"{teams} Co-Teams, {limit}: {_staffeln(count)} mit {_words(sizes)} Teams."
    if have and have < needed:
        missing = needed - have
        return {**out, "fits": False,
                "text": f"{text} {have_word} {_staffeln(have)} – es {'fehlt' if missing == 1 else 'fehlen'} {missing}."}
    return {**out, "text": text}


# ---------------------------------------------------------------- Los

def _entries(entries: list[dict]) -> list[dict]:
    return sorted(({"key": str(row["key"]), "team_id": str(row.get("team_id") or row["key"])} for row in entries), key=lambda row: row["key"])


def _groups(staffeln: list[dict]) -> list[dict]:
    rows = [{"id": str(row["id"]), "staffel": str(row.get("staffel") or ""), "capacity": max(int(row.get("capacity") or 0), 0),
             "team_ids": sorted({str(team) for team in row.get("team_ids") or []}),
             "seats": int(row["seats"]) if row.get("seats") is not None else len(row.get("team_ids") or [])} for row in staffeln]
    return sorted(rows, key=lambda row: (row["staffel"], row["id"]))


def input_hash(entries: list[dict], staffeln: list[dict], *, siblings_allowed: bool) -> str:
    """Der Fingerabdruck der Eingabe: wer gelost wird, welche Staffeln es gibt und wer dort schon steht. Ändert sich etwas davon, gilt
    ein gespeichertes Los nicht mehr."""
    payload = {"policy": POLICY, "siblings": bool(siblings_allowed), "entries": [[row["key"], row["team_id"]] for row in _entries(entries)],
               "staffeln": [[row["id"], row["capacity"], row["seats"], row["team_ids"]] for row in _groups(staffeln)]}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]


def draw_order(entries: list[dict], seed: str) -> list[str]:
    """Die Los-Reihenfolge: je Co-Team der SHA-256 aus Seed und Kennung, aufsteigend."""
    return [row["key"] for row in sorted(_entries(entries), key=lambda row: hashlib.sha256(f"{seed}:{row['key']}".encode("utf-8")).hexdigest())]


def _slots(groups: list[dict], teams: int) -> dict[str, int]:
    """Freie Plätze je Staffel für ``teams`` neue Co-Teams: immer die kleinste Staffel zuerst - so gleicht das Los auch aus, was schon steht."""
    size = {row["id"]: row["seats"] for row in groups}
    slots = {row["id"]: 0 for row in groups}
    for _ in range(teams):
        free = [row for row in groups if size[row["id"]] < row["capacity"]]
        if not free:
            total = sum(max(row["capacity"] - row["seats"], 0) for row in groups)
            raise DrawProblem(NO_SEATS.format(teams=teams, free=total, count=_staffeln(len(groups))))
        target = min(free, key=lambda row: size[row["id"]])
        size[target["id"]] += 1
        slots[target["id"]] += 1
    return slots


def draw(entries: list[dict], staffeln: list[dict], seed: str, *, siblings_allowed: bool = False) -> dict:
    """Verteilt die Co-Teams. ``entries``: ``{key, team_id}``; ``staffeln``: ``{id, staffel, capacity, team_ids, seats?}`` -
    ``team_ids`` sind die Hauptteams, die dort schon stehen oder standen (mit ``siblings_allowed`` die Co-Teams), ``seats`` die belegten
    Plätze (ohne Angabe ihre Zahl).
    Antwort: ``placements`` (Kennung → Staffel), ``order`` (Los-Reihenfolge), ``sizes`` (Größe je Staffel danach)."""
    rows, groups = _entries(entries), _groups(staffeln)
    if not rows:
        raise DrawProblem(NO_ENTRIES)
    if not groups:
        raise DrawProblem(NO_STAFFELN)
    order = draw_order(rows, seed)
    position = {key: index for index, key in enumerate(order)}
    slots = _slots(groups, len(rows))
    # Mit erlaubten Geschwistern zählt jedes Co-Team für sich: ``team_ids`` der Staffeln sind dann Co-Team-Kennungen (wer dort schon stand).
    blocked = {row["id"]: set(row["team_ids"]) for row in groups}
    by_team: dict[str, list[str]] = {}
    for row in sorted(rows, key=lambda row: position[row["key"]]):
        by_team.setdefault(row["key"] if siblings_allowed else row["team_id"], []).append(row["key"])
    team_of = {row["key"]: (row["key"] if siblings_allowed else row["team_id"]) for row in rows}
    crowded = sorted(team for team, keys in by_team.items()
                     if len(keys) > len([row for row in groups if slots[row["id"]] and team not in blocked[row["id"]]]))
    if crowded:
        raise DrawProblem(TOO_MANY_SIBLINGS, team_ids=crowded)
    # Hauptteams mit den meisten Co-Teams zuerst (sie haben die wenigste Wahl), darin und danach in Los-Reihenfolge.
    queue = [key for _team, keys in sorted(by_team.items(), key=lambda item: (-len(item[1]), position[item[1][0]])) for key in keys]
    placements: dict[str, str] = {}
    budget = [SEARCH_LIMIT]

    def place(index: int) -> bool:
        if index == len(queue):
            return True
        budget[0] -= 1
        if budget[0] < 0:
            return False
        key = queue[index]
        team = team_of[key]
        for target in sorted((row for row in groups if slots[row["id"]] and team not in blocked[row["id"]]),
                             key=lambda row: -slots[row["id"]]):
            slots[target["id"]] -= 1
            blocked[target["id"]].add(team)
            placements[key] = target["id"]
            if place(index + 1):
                return True
            slots[target["id"]] += 1
            blocked[target["id"]].discard(team)
            del placements[key]
        return False

    if not place(0):
        raise DrawProblem(NO_SOLUTION)
    sizes = {row["id"]: row["seats"] + len([key for key, target in placements.items() if target == row["id"]]) for row in groups}
    return {"placements": {key: placements[key] for key in order}, "order": order, "sizes": sizes}


def swap(entries: list[dict], staffeln: list[dict], placements: dict[str, str], key_a: str, key_b: str, *,
         siblings_allowed: bool = False) -> dict[str, str]:
    """Tauscht zwei geloste Co-Teams zwischen ihren Staffeln - die Größen bleiben, die Geschwister-Regel wird neu geprüft."""
    rows, groups = _entries(entries), _groups(staffeln)
    team_of = {row["key"]: (row["key"] if siblings_allowed else row["team_id"]) for row in rows}
    if key_a not in placements or key_b not in placements or key_a not in team_of or key_b not in team_of:
        raise DrawProblem(SWAP_UNKNOWN, 404)
    if placements[key_a] == placements[key_b]:
        raise DrawProblem(SWAP_SAME, 422)
    out = {**placements, key_a: placements[key_b], key_b: placements[key_a]}
    seated = {row["id"]: set(row["team_ids"]) for row in groups}
    for key in (key_a, key_b):
        others = {team_of[other] for other, target in out.items() if target == out[key] and other != key and other in team_of}
        if team_of[key] in others or team_of[key] in seated.get(out[key], set()):
            raise DrawProblem(SWAP_SIBLING, 422, team_ids=[team_of[key]])
    return out
