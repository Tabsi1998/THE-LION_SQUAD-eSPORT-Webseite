"""Aufbewahrung der Nachweise (#1157, #2360): was der stündliche Job ``proof_photo_retention`` löscht.

- Nie verwendete Fotos: 24 Stunden nach dem Hochladen.
- Turniere ohne Liga: 30 Tage nach dem Hochladen - außer das Spiel ist dann noch in Klärung.
- Liga-Staffeln: bis Season-Ende plus ``evidence_keep_days``, länger, solange am Spiel ein Vorfall oder Verfahren offen ist
  oder eine Einspruchsfrist läuft. MOSS (Anti-Cheat) nur, bis das Verfahren beendet und die Einspruchsfrist vorbei ist.
- Alles, dessen Spiel es nicht mehr gibt.

Gelesen wird in Seiten nach ``id`` ohne feste Obergrenze: Hinter vielen Nachweisen, die noch gehalten werden (offenes
Verfahren, Spiel in Klärung), bliebe sonst alles Spätere dauerhaft ungeprüft.

Eigenes Modul, weil es den Kalender der Season braucht (``league_service``) - ``match_proofs`` bleibt davon frei, sonst
schlösse sich ein Import-Kreis über ``tournament_purge``. Die Regeln stehen in docs/LIGA.md („D.5/E.2-Vertrag“, Aufbewahrung).
"""
from __future__ import annotations

from datetime import datetime, time, timedelta, timezone

from models import now_utc
from services import match_proof_refs as refs
from services import match_proofs
from services.league_scope import ONLY_LEAGUE
from services.league_service import VIENNA, week_days

PAGE = 500


async def _pages(db, query: dict):
    """Alle Treffer in Seiten, aufsteigend nach ``id``. Der Aufrufer darf die Zeilen einer Seite danach löschen."""
    last = None
    while True:
        rows = await db.match_proof_photos.find(
            {**query, **({"id": {"$gt": last}} if last else {})}, {"_id": 0}).sort("id", 1).limit(PAGE).to_list(PAGE)
        if rows:
            yield rows
        if len(rows) < PAGE:
            return
        last = rows[-1]["id"]


async def _matches_of(db, rows: list[dict], fields: dict) -> dict[str, dict]:
    match_ids = list({row.get("match_id") for row in rows if row.get("match_id")})
    if not match_ids:
        return {}
    return {row["id"]: row for row in await db.matches_v2.find({"id": {"$in": match_ids}}, fields).to_list(len(match_ids) + 1)}


def season_end(season: dict | None) -> datetime | None:
    """Wann die Season zu Ende ist: der Abschluss durch die Leitung (``closed_at``, kommt mit F.1) - bis dahin das Ende des
    letzten Tages der letzten Spielwoche. ``None``: nicht bestimmbar."""
    if not season:
        return None
    closed = refs.parse(season.get("closed_at"))
    if closed:
        return closed
    weeks = week_days(season)
    if not weeks:
        return None
    return datetime.combine(weeks[-1][1] + timedelta(days=1), time.min, tzinfo=VIENNA).astimezone(timezone.utc)


async def _expired_tournament(db, current: datetime, league_ids: list[str]) -> list[dict]:
    """Turniere ohne Liga: 30 Tage nach dem Hochladen - außer das Spiel ist noch in Klärung."""
    query = {"status": "attached", "created_at": {"$lt": (current - timedelta(days=match_proofs.RETENTION_DAYS)).isoformat()},
             "tournament_id": {"$nin": league_ids}}
    expired = []
    async for old in _pages(db, query):
        matches = await _matches_of(db, old, {"_id": 0, "id": 1, "status": 1})
        expired += [row for row in old if (matches.get(row.get("match_id")) or {}).get("status") != "disputed"]
    return expired


async def _expired_league(db, current: datetime, staffeln: dict[str, dict]) -> list[dict]:
    """Liga-Staffeln: bis Season-Ende plus ``evidence_keep_days``, länger bei offenem Vorfall oder Verfahren. MOSS nur, bis das
    Verfahren beendet und die Einspruchsfrist vorbei ist."""
    if not staffeln:
        return []
    season_ids = sorted({(row.get("league_context") or {}).get("season_id") for row in staffeln.values()} - {None})
    seasons = {row["id"]: row for row in await db.league_seasons.find({"id": {"$in": season_ids}}, {"_id": 0}).to_list(len(season_ids) + 1)}

    def season_of(tournament: dict) -> dict | None:
        return seasons.get((tournament.get("league_context") or {}).get("season_id"))

    # Während der Season kommt nur MOSS in Frage - alles andere erst, wenn die Frist der Staffel um ist.
    due, undated = [], []
    for tournament_id, tournament in staffeln.items():
        end = season_end(season_of(tournament))
        if end is None:
            undated.append(tournament_id)
        elif current >= end + timedelta(days=match_proofs.setting(tournament, season_of(tournament), "evidence_keep_days")):
            due.append(tournament_id)
    # MOSS auch, wenn die Seite ihn zurückgezogen hat (``removed``): Er bleibt für die Leitung bis hierher.
    queries = [{"status": {"$in": list(match_proofs.KEPT_STATUSES)}, "tournament_id": {"$in": sorted(staffeln)}, "context.kind": "moss"}]
    if due:
        queries.append({"status": "attached", "tournament_id": {"$in": sorted(due)}})
    if undated:
        # Ohne bestimmbares Season-Ende (Season gelöscht oder ohne Kalender) bleibt es bei 30 Tagen ab dem Hochladen.
        queries.append({"status": "attached", "tournament_id": {"$in": sorted(undated)},
                        "created_at": {"$lt": (current - timedelta(days=match_proofs.RETENTION_DAYS)).isoformat()}})
    expired = []
    for query in queries:
        async for rows in _pages(db, query):
            matches = await _matches_of(db, rows, {"_id": 0, "id": 1, "status": 1, "disputes": 1, "incidents": 1})
            for row in rows:
                match = matches.get(row.get("match_id"))
                if match is None:
                    continue  # ohne Spiel: räumt ``purge`` als verwaist ab
                tournament = staffeln[row["tournament_id"]]
                appeal_hours = match_proofs.setting(tournament, season_of(tournament), "appeal_hours")
                if refs.kind_of(row) == "moss":
                    ref = refs.resolve(match, "moss", (row.get("context") or {}).get("ref_id") or "", appeal_hours=appeal_hours)
                    uploaded = refs.parse(row.get("created_at")) or current
                    # Ohne auffindbaren Bezug oder ohne Zeitpunkt seines Endes zählt die Einspruchsfrist ab dem Hochladen.
                    until = ref.hold_until or uploaded + timedelta(hours=appeal_hours)
                    if not (ref.found and ref.open) and current >= until:
                        expired.append(row)
                elif not refs.match_hold(match, current, appeal_hours=appeal_hours):
                    expired.append(row)
    return expired


async def purge(db, *, now=None) -> int:
    """Aufräumen: nie verwendete Fotos nach 24 Stunden, Turniere 30 Tage nach dem Hochladen, Liga-Staffeln nach ihrer Regel
    (``_expired_league``) und alles, dessen Spiel es nicht mehr gibt."""
    current = now or now_utc()
    stale = [row async for rows in _pages(db, {"status": "pending", "created_at": {"$lt": (current - match_proofs.PENDING_TTL).isoformat()}})
             for row in rows]
    staffeln = {row["id"]: row for row in await db.tournaments.find(
        ONLY_LEAGUE, {"_id": 0, "id": 1, "league_context": 1, "appeal_hours": 1, "evidence_keep_days": 1}).to_list(None)}
    expired = [*await _expired_tournament(db, current, sorted(staffeln)), *await _expired_league(db, current, staffeln)]
    kept = {"status": {"$in": list(match_proofs.KEPT_STATUSES)}}
    attached_ids = await db.match_proof_photos.distinct("match_id", kept)
    known = set(await db.matches_v2.distinct("id", {"id": {"$in": attached_ids}})) if attached_ids else set()
    orphans = [row async for rows in _pages(db, {**kept, "match_id": {"$nin": sorted(known)}}) for row in rows] if attached_ids else []
    seen: set[str] = set()
    rows = []
    for row in [*stale, *expired, *orphans]:
        if row["id"] not in seen:
            seen.add(row["id"])
            rows.append(row)
    return await match_proofs.delete_rows(db, rows)
