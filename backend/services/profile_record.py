"""Profil (#1193): der Weg durch ein Turnier und die Bilanz gegen Gegner, die man öfter trifft.

Weg: je Referenz (Turnier) die Runden mit Ergebnis und Gegner bzw. Platz je Durchgang oder Bilanz je Gruppe, dazu der
Endplatz - aus dem Turnierbaum (``tournament_path``), so wie die Ergebnisse veröffentlicht sind.

Bilanz: die fünf häufigsten Gegner (mindestens zwei Spiele) mit Siegen, Unentschieden und Niederlagen - aus allen
gewerteten 1-gegen-1- bzw. Team-gegen-Team-Spielen. Bei Team-Turnieren zählt die Bilanz gegen Teams.

Sichtbarkeit: Im eigenen Profil steht alles (auch Turniere nur für Mitglieder, alle Gegner mit Namen). Im
öffentlichen Profil nur bei öffentlichem Profil, nur öffentliche Turniere und nur Gegner mit öffentlichem Profil
bzw. öffentliche Teams - wer privat ist, fehlt in der Bilanz ganz und steht im Weg ohne Namen.
"""
from __future__ import annotations

from collections import defaultdict

from services.competition_read import load_registration_matches
from services.profile_references import (
    REFERENCE_REGISTRATION_STATUSES,
    RESULT_TOURNAMENT_STATUSES,
    _team_ids_for_user,
    _tournament_rank_for_user,
    _visible_tournament,
)
from services.tournament_path import DONE, _outcome, _slots, path_kind, tournament_path

RECORD_LIMIT = 5
RECORD_MIN_GAMES = 2


async def owner_by_username(db, username: str) -> dict | None:
    user = await db.users.find_one({"username": username}, {"_id": 0, "id": 1, "username": 1, "display_name": 1, "privacy_public_profile": 1,
                                                          "is_active": 1, "is_banned": 1})
    if not user or user.get("is_active") is False or user.get("is_banned"):
        return None
    return user


def is_self(viewer: dict | None, owner: dict, view_as: str | None = None) -> bool:
    """„So sehen dich andere“ (#1149) gilt auch hier: dann sieht man sich wie ein Fremder."""
    return bool(viewer and viewer.get("id") == owner.get("id") and view_as != "public")


async def _own_registrations(db, owner: dict, tournament_ids: list[str] | None = None) -> list[dict]:
    team_ids = await _team_ids_for_user(owner["id"])
    query: dict = {"status": {"$in": sorted(REFERENCE_REGISTRATION_STATUSES)},
                   "$or": [{"user_id": owner["id"], "team_id": {"$in": [None, ""]}}, *([{"team_id": {"$in": team_ids}}] if team_ids else [])]}
    if tournament_ids is not None:
        query["tournament_id"] = {"$in": tournament_ids}
    return await db.tournament_registrations.find(query, {"_id": 0}).to_list(2000)


async def path_for(db, owner: dict, tournament_ref: str, *, public: bool) -> dict | None:
    """Der Weg durch ein Turnier - None, wenn es ihn nicht gibt oder er nicht gezeigt werden darf."""
    if public and not owner.get("privacy_public_profile"):
        return None
    tournament = await db.tournaments.find_one({"$or": [{"id": tournament_ref}, {"slug": tournament_ref}]}, {"_id": 0})
    if not tournament or tournament.get("status") not in RESULT_TOURNAMENT_STATUSES:
        return None
    if public and not await _visible_tournament(tournament):
        return None
    regs = await _own_registrations(db, owner, [tournament["id"]])
    if not regs:
        return None
    steps = await tournament_path(db, tournament, {reg["id"] for reg in regs}, public=public)
    rank, participant_count = await _tournament_rank_for_user(tournament["id"], owner["id"], await _team_ids_for_user(owner["id"]))
    team_reg = next((reg for reg in regs if reg.get("team_id")), None)
    team = await db.teams.find_one({"id": team_reg["team_id"]}, {"_id": 0, "name": 1, "is_public": 1}) if team_reg else None
    team_name = (team or {}).get("name") if team and not (public and team.get("is_public") is False) else None
    share = None
    if not public:
        from services import result_share
        payload = await result_share.share_payload(db, tournament["id"], owner["username"])
        if payload:
            share = {"shareable": True, "path": payload["path"], "image_paths": payload["image_paths"],
                     "headline": result_share.headline(payload), "share_text": result_share.share_text(payload)}
    return {
        "tournament": {"id": tournament["id"], "slug": tournament.get("slug") or tournament["id"], "title": tournament.get("title") or "Turnier"},
        "kind": path_kind(steps),
        "steps": [{"kind": s["kind"], "label": s["label"], "result": s["result"], "outcome": s["outcome"], "opponent": s.get("opponent")} for s in steps],
        "final": {"rank": rank, "participant_count": participant_count},
        "team_name": team_name,
        "date": tournament.get("start_date"),
        "share": share,
    }


async def record_for(db, owner: dict, *, public: bool) -> list[dict]:
    """Die Bilanz gegen die häufigsten Gegner (Personen bzw. Teams)."""
    if public and not owner.get("privacy_public_profile"):
        return []
    regs = await _own_registrations(db, owner)
    tournaments = {t["id"]: t for t in await db.tournaments.find({"id": {"$in": sorted({r["tournament_id"] for r in regs})}, "status": {"$in": sorted(RESULT_TOURNAMENT_STATUSES)}},
                                                                 {"_id": 0}).to_list(2000)}
    if public:
        tournaments = {tid: t for tid, t in tournaments.items() if await _visible_tournament(t)}
    own = {reg["id"] for reg in regs if reg["tournament_id"] in tournaments}
    if not own:
        return []
    duels = []
    for match in await load_registration_matches(db, own):
        if match.get("tournament_id") not in tournaments or match.get("status") not in DONE or not match.get("results"):
            continue
        participants = _slots(match)
        if len(participants) != 2 or match.get("match_type") == "ffa":
            continue
        mine = next((rid for rid in participants if rid in own), None)
        theirs = next((rid for rid in participants if rid not in own), None)
        if mine and theirs:
            duels.append((match, mine, theirs))
    opponent_regs = {r["id"]: r for r in await db.tournament_registrations.find({"id": {"$in": sorted({d[2] for d in duels})}},
                                                                             {"_id": 0, "id": 1, "user_id": 1, "team_id": 1, "display_name": 1}).to_list(5000)}
    tally: dict[str, dict] = defaultdict(lambda: {"wins": 0, "losses": 0, "draws": 0, "games": 0})
    for match, mine, theirs in duels:
        reg = opponent_regs.get(theirs) or {}
        key = f"team:{reg['team_id']}" if reg.get("team_id") else (f"user:{reg['user_id']}" if reg.get("user_id") else None)
        if not key or key == f"user:{owner['id']}":
            continue
        results = {row.get("registration_id"): row for row in match.get("results") or []}
        outcome = _outcome(results.get(mine) or {}, results.get(theirs))
        row = tally[key]
        row["games"] += 1
        row[{"win": "wins", "loss": "losses", "draw": "draws"}[outcome]] += 1
    if not tally:
        return []
    user_ids = sorted(k[5:] for k in tally if k.startswith("user:"))
    team_ids = sorted(k[5:] for k in tally if k.startswith("team:"))
    users = {u["id"]: u for u in await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1, "privacy_public_profile": 1,
                                                                             "is_active": 1, "is_banned": 1}).to_list(len(user_ids) or 1)}
    teams = {t["id"]: t for t in await db.teams.find({"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "is_public": 1}).to_list(len(team_ids) or 1)}
    out = []
    for key, row in tally.items():
        if row["games"] < RECORD_MIN_GAMES:
            continue
        kind, ident = key.split(":", 1)
        if kind == "user":
            user = users.get(ident)
            if not user:
                continue
            visible = bool(user.get("privacy_public_profile")) and user.get("is_active") is not False and not user.get("is_banned")
            if public and not visible:
                continue
            out.append({"key": key, "kind": "user", "name": user.get("display_name") or user.get("username") or "Spieler",
                        "username": user.get("username") if visible else None, **row})
        else:
            team = teams.get(ident)
            if not team or (public and team.get("is_public") is False):
                continue
            out.append({"key": key, "kind": "team", "name": team.get("name") or "Team", "tag": team.get("tag"),
                        "team_id": team["id"] if team.get("is_public") is not False else None, **row})
    out.sort(key=lambda r: (-r["games"], -r["wins"], r["name"].lower()))
    return out[:RECORD_LIMIT]
