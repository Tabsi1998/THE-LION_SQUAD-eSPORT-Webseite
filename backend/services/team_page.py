"""Team-Seite (#1191): wofür das Team angemeldet ist, wie die letzten Spiele ausgingen, und der Einladungs-Link.

Termine und Ergebnisse kommen aus den Team-Anmeldungen (``tournament_registrations`` mit ``team_id``) und dem
Turnierbaum (``matches_v2``) - kein zweites Register. Wer nicht im Team ist, sieht nur Turniere, die er auch sonst
sehen darf (öffentlich, nicht im Entwurf; „nur Mitglieder“ nur als Vereinsmitglied).

Der Einladungs-Link ist die Adresse der Team-Seite mit einem Schlüssel (``?einladung=…``). Er liegt in einer eigenen
Sammlung ``team_invite_links`` - nicht am Team, damit ihn kein normales Mitglied über die Team-Daten mitliest. Neu
erzeugen ersetzt den Schlüssel, der alte gilt sofort nicht mehr. Der Join-Code bleibt als Rückfall.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timezone

from models import new_id, now_utc
from services.competition_read import load_competition_read_model, load_registration_matches
from services.round_labels import round_label, rounds_by_section, stage_kind
from services.team_colors import effective_color
from services.visibility import user_can_see

INVITE_PARAM = "einladung"
ACTIVE_REGISTRATION_STATUSES = ("pending", "approved", "checked_in", "waitlist")
CLOSED_TOURNAMENT_STATUSES = {"completed", "results_published", "archived", "cancelled"}
DONE_MATCH_STATUSES = {"completed", "forfeit"}
REGISTRATION_LABELS = {
    "pending": "Angemeldet – wartet auf Freigabe",
    "approved": "Angemeldet",
    "checked_in": "Eingecheckt",
    "waitlist": "Warteliste",
}
TOURNAMENT_FIELDS = {"_id": 0, "id": 1, "slug": 1, "title": 1, "start_date": 1, "end_date": 1, "status": 1, "visibility": 1,
                     "is_public": 1, "game_id": 1, "game_name": 1, "event_id": 1, "format": 1, "banner_url": 1, "team_size": 1}


def _parse_dt(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _iso(value) -> str | None:
    parsed = _parse_dt(value)
    return parsed.isoformat() if parsed else (str(value) if value else None)


async def tournament_visible(viewer: dict | None, tournament: dict | None, *, insider: bool) -> bool:
    """Darf diese Person das Turnier auf der Team-Seite sehen? Das Team selbst sieht alle eigenen Anmeldungen."""
    if not tournament or tournament.get("status") == "draft":
        return False
    if insider:
        return True
    if tournament.get("is_public") is False:
        return False
    return await user_can_see(viewer, tournament.get("visibility") or "public")


async def _team_registrations(db, team_id: str) -> list[dict]:
    return await db.tournament_registrations.find({"team_id": team_id}, {"_id": 0, "identity_key": 0}).to_list(500)


async def _tournaments(db, ids) -> dict[str, dict]:
    wanted = sorted({tid for tid in ids if tid})
    if not wanted:
        return {}
    rows = await db.tournaments.find({"id": {"$in": wanted}}, TOURNAMENT_FIELDS).to_list(len(wanted))
    return {row["id"]: row for row in rows}


async def _event_names(db, ids) -> dict[str, str]:
    wanted = sorted({eid for eid in ids if eid})
    if not wanted:
        return {}
    rows = await db.events.find({"id": {"$in": wanted}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(wanted))
    return {row["id"]: row.get("name") or "" for row in rows}


async def _game_names(db, ids) -> dict[str, dict]:
    wanted = sorted({gid for gid in ids if gid})
    if not wanted:
        return {}
    rows = await db.games.find({"id": {"$in": wanted}}, {"_id": 0, "id": 1, "name": 1, "short_name": 1}).to_list(len(wanted))
    return {row["id"]: row for row in rows}


def _tournament_card(tournament: dict, games: dict[str, dict], events: dict[str, str]) -> dict:
    game = games.get(tournament.get("game_id")) or {}
    return {
        "id": tournament.get("id"),
        "slug": tournament.get("slug"),
        "title": tournament.get("title") or "Turnier",
        "start_date": _iso(tournament.get("start_date")),
        "status": tournament.get("status"),
        "game_name": tournament.get("game_name") or game.get("name"),
        "event_name": events.get(tournament.get("event_id")) or None,
        "banner_url": tournament.get("banner_url"),
    }


def _slot_ids(match: dict) -> list[str]:
    slots = sorted(match.get("slots") or [], key=lambda slot: int(slot.get("position") or 999))
    return [slot.get("registration_id") for slot in slots if slot.get("registration_id")]


def _match_line(match: dict, own_ids: set[str], names: dict[str, str]) -> dict | None:
    """Ein fertiges Spiel aus Sicht des Teams: Ergebnis, Gegner und Sieg oder Niederlage."""
    participants = _slot_ids(match)
    results = {row.get("registration_id"): row for row in match.get("results") or [] if row.get("registration_id")}
    own = next((rid for rid in participants if rid in own_ids), None) or next((rid for rid in results if rid in own_ids), None)
    if not own or not results:
        return None
    mine = results.get(own) or {}
    others = [rid for rid in participants if rid != own] or [rid for rid in results if rid != own]
    if len(participants) <= 2 and match.get("match_type", "duel") != "ffa":
        opponent = others[0] if others else None
        theirs = results.get(opponent) or {}
        outcome = mine.get("outcome")
        if outcome == "winner":
            result = "win"
        elif outcome == "draw" or (theirs.get("outcome") == "draw"):
            result = "draw"
        elif outcome in {"loser", "forfeit", "dnf"} or theirs.get("outcome") == "winner":
            result = "loss"
        else:
            result = None
        own_score, other_score = mine.get("score"), theirs.get("score")
        score = f"{own_score}:{other_score}" if own_score is not None and other_score is not None else None
        return {
            "kind": "duel",
            "outcome": result,
            "score": score,
            "own_score": own_score,
            "opponent_score": other_score,
            "opponent": names.get(opponent) or ("Freilos" if not opponent else "Gegner"),
            "forfeit": bool(mine.get("forfeit") or theirs.get("forfeit") or match.get("status") == "forfeit"),
        }
    rank = mine.get("rank")
    return {
        "kind": "heat",
        "outcome": "win" if rank == 1 else "placed",
        "rank": rank,
        "field": len(participants) or len(results),
        "score": None,
        "opponent": None,
    }


async def main_game(db, team: dict, registrations: list[dict], tournaments: dict[str, dict]) -> dict | None:
    """Das Spiel, das das Team am meisten spielt (#1347): aus Turnier-Anmeldungen und Squads, bei Gleichstand das
    zuletzt gespielte. Für die Spiel-Plakette im Kopf und die Farbe, wenn das Team keine eigene gewählt hat."""
    counts: dict[str, int] = {}
    latest: dict[str, str] = {}
    for reg in registrations:
        tournament = tournaments.get(reg.get("tournament_id")) or {}
        game_id = tournament.get("game_id")
        if not game_id or tournament.get("status") == "draft":
            continue
        counts[game_id] = counts.get(game_id, 0) + 1
        latest[game_id] = max(latest.get(game_id, ""), str(tournament.get("start_date") or ""))
    for squad in await db.team_squads.find({"team_id": team["id"], "status": {"$ne": "archived"}}, {"_id": 0, "game_id": 1}).to_list(50):
        if squad.get("game_id"):
            counts[squad["game_id"]] = counts.get(squad["game_id"], 0) + 1
    if not counts:
        return None
    best = max(counts, key=lambda gid: (counts[gid], latest.get(gid, ""), gid))
    game = await db.games.find_one({"id": best}, {"_id": 0, "id": 1, "name": 1, "short_name": 1})
    return game or None


async def team_overview(db, team: dict, viewer: dict | None, *, insider: bool, recent_limit: int = 5) -> dict:
    """Der Kopf (Farbe, Spiel), „Angemeldet für“ und „Letzte Spiele“ der Team-Seite."""
    registrations = await _team_registrations(db, team["id"])
    tournaments = await _tournaments(db, (reg.get("tournament_id") for reg in registrations))
    game = await main_game(db, team, registrations, tournaments)
    header = {**effective_color(team, (game or {}).get("id")), "game": game}
    visible = {tid: row for tid, row in tournaments.items() if await tournament_visible(viewer, row, insider=insider)}
    games = await _game_names(db, (row.get("game_id") for row in visible.values()))
    events = await _event_names(db, (row.get("event_id") for row in visible.values()))

    upcoming = []
    for reg in registrations:
        tournament = visible.get(reg.get("tournament_id"))
        if not tournament or tournament.get("status") in CLOSED_TOURNAMENT_STATUSES:
            continue
        if reg.get("status") not in ACTIVE_REGISTRATION_STATUSES:
            continue
        upcoming.append({
            "registration_id": reg.get("id"),
            "status": reg.get("status"),
            "status_label": REGISTRATION_LABELS.get(reg.get("status"), "Angemeldet"),
            "tournament": _tournament_card(tournament, games, events),
        })
    upcoming.sort(key=lambda row: (_parse_dt(row["tournament"].get("start_date")) or datetime.max.replace(tzinfo=timezone.utc)))

    own_ids = {reg["id"] for reg in registrations if reg.get("id") and reg.get("tournament_id") in visible}
    matches = [m for m in await load_registration_matches(db, own_ids) if m.get("status") in DONE_MATCH_STATUSES and m.get("results")]
    matches = [m for m in matches if m.get("tournament_id") in visible]
    matches.sort(key=lambda m: str(m.get("scheduled_at") or m.get("updated_at") or ""), reverse=True)
    chosen = matches[:recent_limit]
    names: dict[str, str] = {}
    other_ids = sorted({rid for m in chosen for rid in _slot_ids(m) if rid not in own_ids})
    if other_ids:
        for row in await db.tournament_registrations.find({"id": {"$in": other_ids}}, {"_id": 0, "id": 1, "display_name": 1, "ingame_name": 1, "team_name": 1}).to_list(len(other_ids)):
            names[row["id"]] = row.get("display_name") or row.get("ingame_name") or row.get("team_name") or "Gegner"
    labels: dict[str, str] = {}
    for tid in sorted({m.get("tournament_id") for m in chosen}):
        model = await load_competition_read_model(db, tid)
        snapshot = model.structure_snapshot()
        stage_types = {stage.get("id"): stage.get("stage_type") for stage in snapshot.get("stages") or []}
        max_rounds = rounds_by_section(snapshot.get("matches") or [])
        for match in chosen:
            if match.get("tournament_id") != tid:
                continue
            kind = stage_kind(stage_types.get(match.get("stage_id")), (visible.get(tid) or {}).get("format"), match.get("match_type"))
            labels[match["id"]] = round_label(match, max_rounds=max_rounds, kind=kind)
    recent = []
    for match in chosen:
        line = _match_line(match, own_ids, names)
        if not line:
            continue
        tournament = visible.get(match.get("tournament_id")) or {}
        recent.append({
            "match_id": match.get("id"),
            "round_label": labels.get(match.get("id")) or "Runde",
            "date": _iso(match.get("scheduled_at") or match.get("updated_at")),
            "tournament": {"id": tournament.get("id"), "slug": tournament.get("slug"), "title": tournament.get("title") or "Turnier"},
            **line,
        })
    return {"header": header, "upcoming": upcoming, "recent": recent}


# ------------------------------------------------------------------ Einladungs-Link

def new_invite_token() -> str:
    return secrets.token_urlsafe(12)


async def invite_row(db, team_id: str) -> dict | None:
    return await db.team_invite_links.find_one({"team_id": team_id}, {"_id": 0})


async def ensure_invite(db, team_id: str, actor_id: str | None) -> dict:
    row = await invite_row(db, team_id)
    if row:
        return row
    return await renew_invite(db, team_id, actor_id)


async def renew_invite(db, team_id: str, actor_id: str | None) -> dict:
    """Ein neuer Schlüssel - der alte gilt ab sofort nicht mehr."""
    row = {"id": new_id(), "team_id": team_id, "token": new_invite_token(), "created_by": actor_id, "created_at": now_utc().isoformat()}
    await db.team_invite_links.delete_many({"team_id": team_id})
    await db.team_invite_links.insert_one(dict(row))
    return row


async def invite_valid(db, team_id: str, token: str | None) -> bool:
    if not token:
        return False
    row = await invite_row(db, team_id)
    return bool(row and row.get("token") and secrets.compare_digest(str(row["token"]), str(token)))


def invite_path(team_id: str, token: str) -> str:
    return f"/teams/{team_id}?{INVITE_PARAM}={token}"
