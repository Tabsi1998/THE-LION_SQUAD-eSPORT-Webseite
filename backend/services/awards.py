"""Auszeichnungen (#230): Gewinnerbanner und Trophäen je Turnier - für Spieler und Teams.

Entscheidungen des Betreibers vom 23.09. (Block 18): Die Vergabe speichert **Daten** (Platz,
Bilanz, Teilnehmer, Turnier, Saison), kein Bild - das Banner entsteht beim Ansehen aus den Daten,
in Web und App gleich. Für Platz 1 bis 3 kann der Verein je Turnier ein gestaltetes Bild
hochladen (``tournaments.award_images``); sonst gilt die feste Vorlage. Eine Korrektur der
Ergebnisse (erneut veröffentlichen) rechnet alles neu: je Anmeldung gibt es genau einen Eintrag,
der überschrieben wird. Spieler und Teams sind getrennt: ein Team-Turnier trägt ``team_id``, ein
Einzelturnier ``user_id``.
"""
from __future__ import annotations

from models import new_id, now_utc
from services.competition_read import load_competition_read_model, observe_structure_read
from services.competition_standings import placements_for_structure, registration_match_summary, standings_for_structure
from services.season_service import _active_season
from services.visibility import user_can_see

TROPHY_RANKS = (1, 2, 3)
AWARD_STATUSES = {"results_published", "archived"}
REGISTRATION_STATUSES = {"approved", "checked_in"}
IMAGE_SLOTS = ("1", "2", "3")


# ---------------------------------------------------------------- reine Logik

def award_kind(rank) -> str:
    return "trophy" if rank in TROPHY_RANKS else "banner"


def rank_label(rank) -> str:
    if rank in TROPHY_RANKS:
        return f"{rank}. Platz"
    return f"{rank}. Platz" if isinstance(rank, int) and rank > 0 else "Teilnahme"


def record_line(matches: dict | None) -> str:
    """„3 Siege · 1 Niederlage“ - oder leer, wenn nichts gespielt wurde."""
    matches = matches or {}
    played, won = int(matches.get("played") or 0), int(matches.get("won") or 0)
    if not played:
        return ""
    lost = max(0, played - won)
    parts = [f"{won} {'Sieg' if won == 1 else 'Siege'}", f"{lost} {'Niederlage' if lost == 1 else 'Niederlagen'}"]
    return " · ".join(parts)


def clean_award_images(value) -> dict:
    """Nur die Plätze 1 bis 3, nur Adressen als Text; leer heißt kein Bild."""
    if not isinstance(value, dict):
        return {}
    cleaned = {}
    for slot in IMAGE_SLOTS:
        url = value.get(slot) if slot in value else value.get(int(slot))
        url = str(url or "").strip()
        if url:
            cleaned[slot] = url[:500]
    return cleaned


def _rank_from_registration(registration: dict) -> int | None:
    for key in ("final_position", "rank", "placement"):
        try:
            value = int(registration.get(key) or 0)
        except (TypeError, ValueError):
            value = 0
        if value > 0:
            return value
    return None


def award_view(doc: dict, tournament_images: dict | None = None) -> dict:
    """Was Web und App bekommen - ohne Anmelde- oder Datenbank-Kennungen."""
    rank = doc.get("rank")
    images = tournament_images if tournament_images is not None else (doc.get("tournament") or {}).get("award_images") or {}
    return {
        "id": doc["id"],
        "kind": award_kind(rank),
        "rank": rank,
        "rank_label": rank_label(rank),
        "participants": int(doc.get("participants") or 0),
        "matches": {"played": int((doc.get("matches") or {}).get("played") or 0), "won": int((doc.get("matches") or {}).get("won") or 0)},
        "record": record_line(doc.get("matches")),
        "tournament": {k: (doc.get("tournament") or {}).get(k) for k in ("id", "slug", "title", "start_date")},
        "game": doc.get("game") or None,
        "season": doc.get("season") or None,
        "team": doc.get("team") or None,
        "image_url": (images or {}).get(str(rank)) if rank in TROPHY_RANKS else None,
        "date": (doc.get("tournament") or {}).get("start_date"),
        "updated_at": doc.get("updated_at"),
    }


# ---------------------------------------------------------------- Vergabe

async def record_tournament_awards(db, tournament_id: str) -> int:
    """Beim Veröffentlichen der Ergebnisse: je Anmeldung ein Eintrag, alte werden überschrieben."""
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0})
    if not tournament:
        return 0
    regs = await db.tournament_registrations.find(
        {"tournament_id": tournament_id, "status": {"$in": list(REGISTRATION_STATUSES)}}, {"_id": 0},
    ).to_list(1000)
    if not regs:
        await db.tournament_awards.delete_many({"tournament_id": tournament_id})
        return 0
    read_model = await load_competition_read_model(db, tournament_id)
    snapshot = read_model.structure_snapshot()
    observe_structure_read(snapshot, surface="awards")
    matches = snapshot.get("matches") or []
    placements = {}
    for rank, placement in placements_for_structure(snapshot, regs).items():
        if placement.get("registration_id"):
            placements[placement["registration_id"]] = rank
    if not placements and matches:
        groups = []
        if tournament.get("format") == "groups":
            groups = await db.tournament_groups.find({"tournament_id": tournament_id}, {"_id": 0}).to_list(100)
        rows = standings_for_structure(tournament, snapshot, regs, groups=groups)
        if tournament.get("format") == "groups":
            rows = [row for group in rows for row in group.get("standings") or []]
        for row in rows:
            if row.get("registration_id") and row.get("rank"):
                placements.setdefault(row["registration_id"], int(row["rank"]))

    game = None
    if tournament.get("game_id"):
        game = await db.games.find_one({"id": tournament["game_id"]}, {"_id": 0, "id": 1, "name": 1, "logo_url": 1, "cover_url": 1})
    season = await _active_season(db)
    season_view = {"id": season["id"], "name": season.get("name") or "Saison"} if season else None
    team_ids = [reg["team_id"] for reg in regs if reg.get("team_id")]
    teams = {row["id"]: row for row in await db.teams.find({"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "logo_url": 1}).to_list(500)} if team_ids else {}
    now = now_utc().isoformat()
    kept: list[str] = []
    for reg in regs:
        rank = _rank_from_registration(reg) or placements.get(reg.get("id"))
        summary = registration_match_summary(matches, {reg.get("id")})
        team = teams.get(reg.get("team_id"))
        doc = {
            "tournament_id": tournament_id, "registration_id": reg.get("id"),
            "user_id": reg.get("user_id"), "team_id": reg.get("team_id"),
            "rank": rank, "kind": award_kind(rank), "participants": len(regs),
            "matches": {"played": summary["matches_played"], "won": summary["matches_won"]},
            "tournament": {k: tournament.get(k) for k in ("id", "slug", "title", "start_date", "visibility", "is_public", "status")},
            "game": game, "season": season_view,
            "team": {"id": team["id"], "name": team.get("name"), "tag": team.get("tag"), "logo_url": team.get("logo_url")} if team else None,
            "updated_at": now,
        }
        existing = await db.tournament_awards.find_one({"tournament_id": tournament_id, "registration_id": reg.get("id")}, {"_id": 0, "id": 1})
        award_id = existing["id"] if existing else new_id()
        await db.tournament_awards.update_one(
            {"tournament_id": tournament_id, "registration_id": reg.get("id")},
            {"$set": doc, "$setOnInsert": {"id": award_id, "created_at": now}}, upsert=True,
        )
        kept.append(award_id)
    await db.tournament_awards.delete_many({"tournament_id": tournament_id, "id": {"$nin": kept}})
    return len(kept)


async def rebuild_all_awards(db) -> dict:
    """Für Turniere mit veröffentlichten Ergebnissen nachtragen - einmalig nach der Einführung, sonst bei Bedarf."""
    ids = [row["id"] async for row in db.tournaments.find({"status": {"$in": list(AWARD_STATUSES)}}, {"_id": 0, "id": 1})]
    total = 0
    for tournament_id in ids:
        total += await record_tournament_awards(db, tournament_id)
    return {"tournaments": len(ids), "awards": total}


async def needs_backfill(db) -> bool:
    """Wahr, solange es Turniere mit Ergebnissen, aber noch keine einzige Auszeichnung gibt."""
    if await db.tournament_awards.count_documents({}, limit=1):
        return False
    return bool(await db.tournaments.count_documents({"status": {"$in": list(AWARD_STATUSES)}}, limit=1))


async def backfill_awards(db) -> dict | None:
    """Der Job nach der Einführung: alte Turniere von selbst nachtragen - kein Handgriff für den Betreiber."""
    if not await needs_backfill(db):
        return None
    return await rebuild_all_awards(db)


# ---------------------------------------------------------------- Lesen

async def _visible(doc: dict) -> bool:
    tournament = doc.get("tournament") or {}
    if tournament.get("status") == "draft" or tournament.get("is_public") is False:
        return False
    return await user_can_see(None, tournament.get("visibility") or "public")


async def _views(db, docs: list[dict], public_only: bool) -> list[dict]:
    tournament_ids = list({doc["tournament_id"] for doc in docs})
    images = {row["id"]: row.get("award_images") or {} for row in await db.tournaments.find({"id": {"$in": tournament_ids}}, {"_id": 0, "id": 1, "award_images": 1}).to_list(500)} if tournament_ids else {}
    out = []
    for doc in docs:
        if public_only and not await _visible(doc):
            continue
        out.append(award_view(doc, images.get(doc["tournament_id"], {})))
    out.sort(key=lambda row: (row.get("date") or "", row["id"]), reverse=True)
    return out


async def awards_for_user(db, user_id: str, public_only: bool = True) -> list[dict]:
    """Eigene Einzelturniere und die Turniere der eigenen Teams."""
    team_ids = [row["team_id"] for row in await db.team_members.find({"user_id": user_id}, {"_id": 0, "team_id": 1}).to_list(200) if row.get("team_id")]
    query = {"$or": [{"user_id": user_id}] + ([{"team_id": {"$in": team_ids}}] if team_ids else [])}
    docs = await db.tournament_awards.find(query, {"_id": 0}).to_list(500)
    return await _views(db, docs, public_only)


async def awards_for_team(db, team_id: str, public_only: bool = True) -> list[dict]:
    docs = await db.tournament_awards.find({"team_id": team_id}, {"_id": 0}).to_list(500)
    return await _views(db, docs, public_only)


async def featured_award(db, awards: list[dict], award_id: str | None) -> dict | None:
    return next((award for award in awards if award["id"] == award_id), None) if award_id else None


async def feature_award_for_user(db, user_id: str, award_id: str | None) -> dict | None:
    """Als Profilbanner wählen - nur eine eigene Auszeichnung; None löscht die Wahl."""
    if award_id:
        awards = await awards_for_user(db, user_id, public_only=False)
        chosen = next((award for award in awards if award["id"] == award_id), None)
        if not chosen:
            return None
        await db.users.update_one({"id": user_id}, {"$set": {"featured_award_id": award_id}})
        return chosen
    await db.users.update_one({"id": user_id}, {"$unset": {"featured_award_id": ""}})
    return None


async def feature_award_for_team(db, team_id: str, award_id: str | None) -> dict | None:
    """Teambanner wählen - nur eine Auszeichnung dieses Teams; None löscht die Wahl."""
    if award_id:
        awards = await awards_for_team(db, team_id, public_only=False)
        chosen = next((award for award in awards if award["id"] == award_id), None)
        if not chosen:
            return None
        await db.teams.update_one({"id": team_id}, {"$set": {"featured_award_id": award_id}})
        return chosen
    await db.teams.update_one({"id": team_id}, {"$unset": {"featured_award_id": ""}})
    return None
