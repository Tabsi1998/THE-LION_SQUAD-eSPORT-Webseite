"""Aufbewahrung der Nachweise (#1157, #2360): was der stündliche Job ``proof_photo_retention`` löscht.

- Nie verwendete Fotos: 24 Stunden nach dem Hochladen.
- Turniere ohne Liga: 30 Tage nach dem Hochladen - außer das Spiel ist dann noch in Klärung.
- Liga-Staffeln: bis Season-Ende plus ``evidence_keep_days``, länger, solange am Spiel ein Vorfall oder Verfahren offen ist
  oder eine Einspruchsfrist läuft. MOSS (Anti-Cheat) nur, bis das Verfahren beendet und die Einspruchsfrist vorbei ist -
  an einem Vorfall mindestens, bis das Ergebnis des Spiels feststeht und die Protestfrist abgelaufen ist (``moss_due``).
- Alles, dessen Spiel es nicht mehr gibt.
- Strafen (E.3, Nr. 31, 136): Ein Nachweis an einer Strafe bleibt, solange sie läuft, ein Einspruch offen ist oder die
  Einspruchsfrist läuft (``keep_until``, gesetzt von ``league_sanction_bans``) - auch ein MOSS-Nachweis.
- Kontolöschung (``delete_for_user``): alles sofort - außer MOSS in einem laufenden Vorfall oder Verfahren, der pseudonym
  für die Leitung bleibt, bis seine Frist um ist.

Gelesen wird in Seiten nach ``id`` ohne feste Obergrenze: Hinter vielen Nachweisen, die noch gehalten werden (offenes
Verfahren, Spiel in Klärung), bliebe sonst alles Spätere dauerhaft ungeprüft.

Eigenes Modul, weil es den Kalender der Season braucht (``league_service``) - ``match_proofs`` bleibt davon frei, sonst
schlösse sich ein Import-Kreis über ``tournament_purge``. Die Regeln stehen in docs/LIGA.md („D.5/E.2-Vertrag“, Aufbewahrung).
"""
from __future__ import annotations

import logging
import pathlib
from datetime import datetime, timedelta

from models import now_utc
from services import match_proof_refs as refs
from services import match_proofs, media_scan
from services.league_scope import ONLY_LEAGUE, is_league_staffel
from services.league_calendar import season_end_at
from services.match_disputes import decided_at
from services.matchday_schedule import response_deadline
from storage import QUARANTINE_DIR

logger = logging.getLogger("tls.match_proofs")

PAGE = 500
# So lange darf ein Bild „in Prüfung“ stehen, bevor der Job nachsieht, ob überhaupt eine Prüfung für es ansteht.
RESCAN_AFTER = timedelta(hours=1)
# Die Staffel mit ihrem Kalender: Die Protestfrist ruht in Sperrzeiten (``response_deadline``).
STAFFEL_FIELDS = {"_id": 0, "creation_key": 0, "billing": 0}
MATCH_FIELDS = {"_id": 0, "id": 1, "status": 1, "disputes": 1, "incidents": 1, "completed_at": 1, "result_meta": 1,
                "admin_decision_at": 1, "updated_at": 1}


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
    """Wann die Season zu Ende ist (``league_calendar.season_end_at``): der Abschluss durch die Leitung, bis dahin das Ende des
    letzten Tages der letzten Spielwoche. ``None``: nicht bestimmbar."""
    return season_end_at(season)


def protest_window(match: dict, tournament: dict | None, season: dict | None,
                   fallback: datetime | None = None) -> tuple[bool, datetime | None]:
    """Bis wann zu diesem Spiel noch ein Protest kommen kann: ``(wartet, Ende)``. ``wartet``: Das Ergebnis steht noch nicht
    fest, die Frist hat also nicht einmal begonnen. Sonst das Ende - Feststehen des Ergebnisses plus ``protest_hours``, in
    Sperrzeiten ruhend. Trägt ein entschiedenes Spiel keinen Zeitpunkt der Entscheidung (Altdaten, Korrektur von Hand),
    zählt ``fallback``: der letzte bekannte Zeitpunkt. ``None``: Es kommt keiner mehr in Frage (Spiel abgesagt) oder es
    gibt gar keinen Zeitpunkt."""
    status = str(match.get("status") or "")
    if status in refs.CLOSED_STATUSES:
        return False, None
    if status not in refs.DECIDED_STATUSES:
        return True, None
    decided = decided_at(match) or fallback
    if decided is None:
        return False, None
    hours = match_proofs.setting(tournament, season, "protest_hours")
    return False, response_deadline(tournament, decided, hours) or decided + timedelta(hours=hours)


def moss_due(row: dict, match: dict, tournament: dict | None, season: dict | None, current: datetime) -> bool:
    """Darf dieser MOSS-Nachweis jetzt gelöscht werden? Erst wenn sein Bezug beendet und die Einspruchsfrist vorbei ist. Hängt
    er an einem Vorfall, kann aus dem noch ein Protest werden - der ist erst nach der Bestätigung des Ergebnisses möglich
    und läuft dann ``protest_hours``: So lange bleibt der Nachweis mindestens. Obergrenze, falls das Ergebnis nie feststeht:
    Season-Ende plus ``evidence_keep_days``."""
    appeal_hours = match_proofs.setting(tournament, season, "appeal_hours")
    ref = refs.resolve(match, "moss", (row.get("context") or {}).get("ref_id") or "", appeal_hours=appeal_hours)
    if ref.found and ref.open:
        return False
    uploaded = refs.parse(row.get("created_at")) or current
    # Ohne auffindbaren Bezug oder ohne Zeitpunkt seines Endes zählt die Einspruchsfrist ab dem Hochladen.
    until = ref.hold_until or uploaded + timedelta(hours=appeal_hours)
    if ref.incident:
        # Ohne Zeitpunkt der Entscheidung: die letzte Änderung am Spiel, sonst das Ende des Vorfalls, sonst das Hochladen.
        known = [moment for moment in (refs.parse(match.get("updated_at")), ref.ended_at) if moment]
        waiting, window = protest_window(match, tournament, season, fallback=max(known) if known else uploaded)
        if waiting:
            # Wird das Spiel nie entschieden, bleibt der Nachweis nicht für immer: spätestens wie jeder andere Nachweis der
            # Staffel - Season-Ende plus ``evidence_keep_days``. Ohne bestimmbares Season-Ende wartet er weiter.
            end = season_end(season)
            cap = end + timedelta(days=match_proofs.setting(tournament, season, "evidence_keep_days")) if end else None
            return bool(cap) and current >= max(cap, until)
        until = max(until, window) if window else until
    return current >= until


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
            matches = await _matches_of(db, rows, MATCH_FIELDS)
            for row in rows:
                match = matches.get(row.get("match_id"))
                if match is None:
                    continue  # ohne Spiel: räumt ``purge`` als verwaist ab
                tournament = staffeln[row["tournament_id"]]
                season = season_of(tournament)
                if refs.kind_of(row) == "moss":
                    if moss_due(row, match, tournament, season, current):
                        expired.append(row)
                elif not refs.match_hold(match, current, appeal_hours=match_proofs.setting(tournament, season, "appeal_hours")):
                    expired.append(row)
    return expired


async def delete_for_user(db, user_id: str, *, now=None) -> int:
    """Kontolöschung: die eigenen Nachweise und ihre Dateien sofort weg - mit einer Ausnahme (Entscheidung Fabian 11.11.,
    DSGVO Art. 17 Abs. 3 lit. e): Ein MOSS-Nachweis, der in einem laufenden Vorfall oder Verfahren noch gebraucht wird,
    bleibt, bis dessen Frist um ist (``moss_due``) - sonst könnte ein Spieler die Prüfung durch Löschen des Kontos beenden.
    Er wird dabei von der Person gelöst (kein ``owner_id`` mehr) und verborgen (``removed``): Nur die nicht befangene
    Leitung sieht ihn noch, danach löscht ihn ``purge`` wie jeden MOSS-Nachweis. Ohne laufendes Verfahren: sofort weg.
    Die Einträge der Bildprüfung (``media_scans``) gehen denselben Weg: gelöscht mit dem Nachweis, sonst ohne Person."""
    current = now or now_utc()
    rows = await db.match_proof_photos.find({"owner_id": user_id}, {"_id": 0}).to_list(None)
    moss = [row for row in rows if refs.kind_of(row) == "moss" and row.get("status") in match_proofs.KEPT_STATUSES]
    matches = await _matches_of(db, moss, {**MATCH_FIELDS, "tournament_id": 1})
    held: list[dict] = []
    for row in moss:
        match = matches.get(row.get("match_id"))
        tournament = await db.tournaments.find_one({"id": (match or {}).get("tournament_id")}, STAFFEL_FIELDS) if match else None
        if not is_league_staffel(tournament):
            continue
        season = await db.league_seasons.find_one({"id": tournament["league_context"].get("season_id")}, {"_id": 0})
        if not moss_due(row, match, tournament, season, current):
            held.append(row)
    stamp = current.isoformat()
    for row in held:
        await db.match_proof_photos.update_one({"id": row["id"]}, {"$set": {
            "owner_id": None, "owner_erased": True, "status": match_proofs.REMOVED, "removed_by": None,
            "removed_at": row.get("removed_at") or stamp, "updated_at": stamp}})
        await match_proofs.audit_proof(db, "match.proof.erasure_hold", matches[row["match_id"]], None, row)
    held_ids = {row["id"] for row in held}
    gone = [row for row in rows if row["id"] not in held_ids]
    # Die Bildprüfung führt je Bild einen Eintrag mit der Kennung des Kontos: Er geht mit dem Nachweis - bleibt der Nachweis,
    # verliert auch der Eintrag den Bezug zur Person.
    if held_ids:
        await db.media_scans.update_many({"kind": "proof", "ref_id": {"$in": sorted(held_ids)}}, {"$set": {"owner_id": None}})
    await _delete_scans(db, [row["id"] for row in gone])
    return await match_proofs.delete_rows(db, gone)


async def _delete_scans(db, proof_ids: list[str]) -> None:
    """Die Einträge der Bildprüfung zu diesen Nachweisen löschen - samt einem Original, das in der Quarantäne liegt."""
    if not proof_ids:
        return
    query = {"kind": "proof", "ref_id": {"$in": proof_ids}}
    async for scan in db.media_scans.find(query, {"_id": 0, "quarantine_key": 1}):
        key = pathlib.PurePosixPath(str(scan.get("quarantine_key") or "").replace("\\", "/")).name
        if key:
            (QUARANTINE_DIR / key).unlink(missing_ok=True)
    await db.media_scans.delete_many(query)


async def rescan_stuck(db, *, now=None) -> int:
    """Bilder, die länger als eine Stunde „in Prüfung“ stehen, ohne dass eine Prüfung für sie ansteht, neu einreihen.

    Ein Bild wird mit ``scan_state: "pending"`` gespeichert und danach bei der Bildprüfung eingereiht. Scheitert das Einreihen
    (Datenbank kurz weg, Prüfdienst nicht eingerichtet), gibt es keinen Eintrag in ``media_scans`` - der Sammler der Bildprüfung
    findet das Bild dann nie, es bliebe für Gegenseite und Leitung dauerhaft unsichtbar. Steht ein Eintrag an, kümmert sich
    der Sammler; hier wird nichts doppelt eingereiht."""
    current = now or now_utc()
    queued = 0
    async for rows in _pages(db, {"scan_state": "pending", "created_at": {"$lt": (current - RESCAN_AFTER).isoformat()}}):
        ids = [row["id"] for row in rows]
        waiting = set(await db.media_scans.distinct("ref_id", {"kind": "proof", "ref_id": {"$in": ids}, "state": "pending"}))
        for row in rows:
            path = match_proofs.proof_path(row.get("storage_key"))
            if row["id"] in waiting or path is None or not path.is_file():
                continue
            try:
                await media_scan.enqueue(db, kind="proof", ref_id=row["id"], owner_id=row.get("owner_id"), path=path,
                                         context={"type": "proof", "match_id": row.get("match_id")})
                queued += 1
            except Exception as exc:  # noqa: BLE001 - beim nächsten Lauf wieder; ein Bild hält die übrigen nicht auf
                logger.warning("[proofs] Bildprüfung ließ sich nicht neu anstoßen: %s", type(exc).__name__)
    return queued


async def purge(db, *, now=None) -> int:
    """Aufräumen: nie verwendete Fotos nach 24 Stunden, Turniere 30 Tage nach dem Hochladen, Liga-Staffeln nach ihrer Regel
    (``_expired_league``) und alles, dessen Spiel es nicht mehr gibt."""
    from services import league_sanction_bans as league_sanctions

    current = now or now_utc()
    # Strafen (E.3): erst die Sperrfristen der Nachweise an Strafen nachziehen, dann aufräumen.
    await league_sanctions.refresh_proof_holds(db, current)
    stale = [row async for rows in _pages(db, {"status": "pending", "created_at": {"$lt": (current - match_proofs.PENDING_TTL).isoformat()}})
             for row in rows]
    staffeln = {row["id"]: row for row in await db.tournaments.find(ONLY_LEAGUE, STAFFEL_FIELDS).to_list(None)}
    expired = [*await _expired_tournament(db, current, sorted(staffeln)), *await _expired_league(db, current, staffeln)]
    kept = {"status": {"$in": list(match_proofs.KEPT_STATUSES)}}
    attached_ids = await db.match_proof_photos.distinct("match_id", kept)
    known = set(await db.matches_v2.distinct("id", {"id": {"$in": attached_ids}})) if attached_ids else set()
    orphans = [row async for rows in _pages(db, {**kept, "match_id": {"$nin": sorted(known)}}) for row in rows] if attached_ids else []
    seen: set[str] = set()
    orphan_ids = {row["id"] for row in orphans}
    rows = []
    for row in [*stale, *expired, *orphans]:
        # Ein verwaister Nachweis (Spiel gelöscht) geht immer; sonst hält ihn eine laufende Strafe.
        if row["id"] not in seen and (row["id"] in orphan_ids or not league_sanctions.held(row, current)):
            seen.add(row["id"])
            rows.append(row)
    return await match_proofs.delete_rows(db, rows)
