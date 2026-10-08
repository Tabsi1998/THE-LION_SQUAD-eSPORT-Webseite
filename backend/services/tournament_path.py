"""Dein Weg durch ein Turnier (#1193, #1194): Viertelfinale 2:0, Halbfinale 2:1, Finale 1:2 - aus dem Turnierbaum.

Je Spiel ein Schritt in Alltagsworten (``round_labels``): im K.-o. Ergebnis und Gegner, bei Durchgängen der Platz in
der Runde, bei Gruppen und Liga die Bilanz je Gruppe (Siege, Unentschieden, Niederlagen) als ein Schritt. Gezählt wird
nur, was gewertet ist (fertig oder kampflos) - laufende Spiele stehen nicht im Weg.

Sichtbarkeit: Im eigenen Profil steht jeder Gegner da. Im öffentlichen Profil und auf dem Teilen-Bild nur Gegner mit
öffentlichem Profil bzw. öffentliche Teams - sonst bleibt der Name weg, das Ergebnis bleibt.
"""
from __future__ import annotations

from services.competition_read import load_competition_read_model
from services.round_labels import round_label, rounds_by_section, section_kind, stage_kind

DONE = {"completed", "forfeit"}


def _slots(match: dict) -> list[str]:
    slots = sorted(match.get("slots") or [], key=lambda slot: int(slot.get("position") or 999))
    ids = [slot.get("registration_id") for slot in slots if slot.get("registration_id")]
    for row in match.get("results") or []:
        if row.get("registration_id") and row["registration_id"] not in ids:
            ids.append(row["registration_id"])
    return ids


def _outcome(mine: dict, theirs: dict | None) -> str:
    """Sieg, Niederlage oder Unentschieden - der Turnierbaum schreibt ein Unentschieden als zwei Plätze 1."""
    theirs = theirs or {}
    my_rank, their_rank = mine.get("rank"), theirs.get("rank")
    if my_rank is not None and my_rank == their_rank:
        return "draw"
    if mine.get("outcome") == "draw" or theirs.get("outcome") == "draw":
        return "draw"
    if mine.get("outcome") == "winner" and theirs.get("outcome") != "winner":
        return "win"
    if theirs.get("outcome") == "winner" or mine.get("outcome") in {"loser", "forfeit", "dnf"}:
        return "loss"
    if my_rank is not None and their_rank is not None:
        return "win" if my_rank < their_rank else "loss"
    return "loss"


def group_label(match: dict, stage: dict | None) -> str:
    section = str(match.get("section") or "")
    if section.lower().startswith("group_"):
        return f"Gruppe {section[6:].upper()}"
    if stage and stage.get("name"):
        return str(stage["name"])
    return "Liga"


def table_result(step: dict) -> str:
    wins, draws, losses = step.get("wins", 0), step.get("draws", 0), step.get("losses", 0)
    parts = [f"{wins} {'Sieg' if wins == 1 else 'Siege'}"]
    if draws:
        parts.append(f"{draws} Unentschieden")
    parts.append(f"{losses} {'Niederlage' if losses == 1 else 'Niederlagen'}")
    return ", ".join(parts)


def chip_text(step: dict) -> str:
    """Kurz für Schildchen und Teilen-Bild: „Viertelfinale 2:0“, „Finale: Platz 1“, „Gruppe A: 3 Siege, 1 Niederlage“."""
    if step.get("kind") == "heat":
        return f"{step['label']}: Platz {step['rank']}" if step.get("rank") else str(step.get("label"))
    if step.get("kind") == "table":
        return f"{step['label']}: {step['result']}"
    return f"{step['label']} {step['result']}".strip()


async def visible_names(db, registration_ids: list[str], *, public: bool) -> dict[str, str | None]:
    """Namen der Gegner - öffentlich nur mit öffentlichem Profil bzw. öffentlichem Team."""
    ids = sorted({rid for rid in registration_ids if rid})
    if not ids:
        return {}
    regs = await db.tournament_registrations.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "display_name": 1, "ingame_name": 1, "team_name": 1, "user_id": 1, "team_id": 1}).to_list(len(ids))
    names: dict[str, str | None] = {}
    public_users: set[str] = set()
    public_teams: set[str] = set()
    if public:
        user_ids = sorted({reg["user_id"] for reg in regs if reg.get("user_id") and not reg.get("team_id")})
        team_ids = sorted({reg["team_id"] for reg in regs if reg.get("team_id")})
        if user_ids:
            public_users = {u["id"] for u in await db.users.find(
                {"id": {"$in": user_ids}, "privacy_public_profile": True, "is_active": {"$ne": False}, "is_banned": {"$ne": True}}, {"_id": 0, "id": 1}).to_list(len(user_ids))}
        if team_ids:
            public_teams = {t["id"] for t in await db.teams.find({"id": {"$in": team_ids}, "is_public": {"$ne": False}}, {"_id": 0, "id": 1}).to_list(len(team_ids))}
    for reg in regs:
        name = reg.get("display_name") or reg.get("ingame_name") or reg.get("team_name") or None
        if public:
            allowed = (reg.get("team_id") in public_teams) if reg.get("team_id") else (reg.get("user_id") in public_users)
            name = name if allowed else None
        names[reg["id"]] = name
    return names


async def tournament_path(db, tournament: dict, registration_ids: set[str] | list[str], *, public: bool) -> list[dict]:
    """Die Schritte des Wegs in der Reihenfolge des Turniers."""
    own = {rid for rid in registration_ids if rid}
    if not own:
        return []
    model = await load_competition_read_model(db, tournament["id"])
    snapshot = model.structure_snapshot()
    matches = snapshot.get("matches") or []
    stages = {stage.get("id"): stage for stage in snapshot.get("stages") or []}
    max_rounds = rounds_by_section(matches)
    mine = [m for m in matches if m.get("status") in DONE and m.get("results") and own & set(_slots(m))]
    names = await visible_names(db, [rid for m in mine for rid in _slots(m) if rid not in own], public=public)
    steps: list[dict] = []
    tables: dict[tuple, dict] = {}
    for match in mine:
        stage = stages.get(match.get("stage_id"))
        kind = stage_kind((stage or {}).get("stage_type"), tournament.get("format"), match.get("match_type"))
        participants = _slots(match)
        me = next(rid for rid in participants if rid in own)
        results = {row.get("registration_id"): row for row in match.get("results") or []}
        mine_result = results.get(me) or {}
        others = [rid for rid in participants if rid != me]
        if kind == "table" and section_kind(match.get("section")) in {"group", "main"} and len(participants) <= 2:
            key = (match.get("stage_id"), match.get("section"))
            if key not in tables:
                tables[key] = {"kind": "table", "label": group_label(match, stage), "wins": 0, "draws": 0, "losses": 0, "games": 0}
                steps.append(tables[key])
            outcome = _outcome(mine_result, results.get(others[0]) if others else None)
            tables[key]["games"] += 1
            tables[key][{"win": "wins", "draw": "draws", "loss": "losses"}[outcome]] += 1
            continue
        if kind == "heats" or len(participants) > 2 or match.get("match_type") == "ffa":
            rank = mine_result.get("rank")
            steps.append({
                "kind": "heat", "label": round_label(match, max_rounds=max_rounds, kind="heats"), "rank": rank, "field": len(participants),
                "result": f"Platz {rank} von {len(participants)}" if rank else "gewertet", "outcome": "win" if rank == 1 else "placed",
                "opponent": None,
            })
            continue
        opponent = others[0] if others else None
        theirs = results.get(opponent) or {}
        own_score, other_score = mine_result.get("score"), theirs.get("score")
        forfeit = bool(match.get("status") == "forfeit" or mine_result.get("forfeit") or theirs.get("forfeit"))
        score = f"{own_score}:{other_score}" if own_score is not None and other_score is not None else ("kampflos" if forfeit else "")
        steps.append({
            "kind": "duel", "label": round_label(match, max_rounds=max_rounds, kind=kind), "result": score,
            "outcome": _outcome(mine_result, theirs), "opponent": names.get(opponent) if opponent else "Freilos",
            "forfeit": forfeit,
        })
    for step in steps:
        if step["kind"] == "table":
            step["result"] = table_result(step)
            step["outcome"] = "win" if step["wins"] > step["losses"] else ("loss" if step["losses"] > step["wins"] else "draw")
            step.setdefault("opponent", None)
    return steps


def path_kind(steps: list[dict]) -> str:
    kinds = {step.get("kind") for step in steps}
    if kinds == {"heat"}:
        return "heats"
    if kinds == {"table"}:
        return "table"
    return "knockout" if kinds else "none"
