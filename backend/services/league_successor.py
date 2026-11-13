"""Neue Season aus der Vorgänger-Season (F.2, #1627, docs/LIGA.md „F.2 Neue Season aus dem Vorgänger“; Entscheidungen Nr. 158–161).

- **Nur aus einer abgeschlossenen Season** (F.1): Jede Staffel, die zählt, hat einen geltenden Endstand.
- **Übernommen als Entwurf** (Nr. 161): alle Einstellungen der Season (ohne Zeitraum und Termine), Liga N mit Beinamen, Abweichungen,
  Zonen und Gewinnen, die geltende Map-Pool-Version, die Sperrliste. Ein eigenes Regelwerk der Season kommt als Entwurf einer neuen
  Fassung zur Freigabe; gilt das der Liga, gilt es weiter. Die neue Season bleibt ``off`` und ``draft``, bis die Leitung sie veröffentlicht.
- **Teams** (Nr. 159, 160): Auf- und Abstieg ergeben sich aus dem Endstand (``league_zones``), ohne Bestätigung. Jedes Co-Team, das
  weiterspielen kann, steht als angenommener Antrag (``league_applications``, ``carry_over``) in seiner neuen Liga N - es belegt einen
  Startplatz, bis die Leitung es einer Staffel zuteilt. Wer nicht will, meldet sich bis zum Start der Season ab; der Platz ist dann frei
  für Warteliste und Anmeldungen (B.4). Ausgeschiedene und Disqualifizierte fallen heraus.
- **Der Vorgänger bleibt unverändert**: Hier wird nur gelesen. Die neue Season trägt ``predecessor_id`` (eindeutig): Ein zweites Anlegen,
  auch ein Doppelklick, findet die vorhandene und ergänzt höchstens, was beim ersten Mal nicht fertig wurde.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime

from pymongo.errors import DuplicateKeyError

from models import REGISTRATION_LIMIT, new_id, now_utc
from services import league_final, league_zones, loadout_bans, map_pools, squad_registration
from services import league_service as leagues
from services.league_final_read import active_final, is_closed
from services.league_scope import ONLY_LEAGUE
from services.log_safe import log_safe
from services.mutation_lock import MutationLockBusy, league_season_resource, mutation_lock

logger = logging.getLogger("tls.league_successor")

CAPABILITY = "manage"
LOCK_WAIT_SECONDS = 10.0
# Nicht übernommen: Kennung und Zählung, Zeitraum und Termine (Nr. 161: neu setzen), Stand und Sichtbarkeit (Entwurf, „off“) und was der
# Abschluss an die Season schrieb. Alles andere an der Season ist Einstellung und geht als Entwurf mit.
NOT_COPIED = frozenset({
    "_id", "id", "league_id", "number", "name", "slug", "status", "visibility", "created_at", "created_by", "updated_at",
    "start_date", "blocked_periods", "registration_deadline", "application_opens_at", "application_closes_at", "transfer_windows",
    "roster_deadline", "final_closed_at", "predecessor_id", "predecessor", "successor_ready",
})
DATES_TO_SET = ("Beginn der ersten Spielwoche", "Sperrzeiten", "Anmeldefenster und Meldeschluss", "Transferfenster", "Stichtag des Kaders")
COPIED_GROUPS = (
    "Spielbetrieb: Best of, Teamgröße, Modi je Map, Ergebnisregeln, Veto, Vorfälle und Pausen",
    "Tabelle: Punkte, Gleichstand, Ausscheiden",
    "Anmeldung und Kader: Spielberechtigung, Plattform, Plätze, Warteliste, Zulassung",
    "Termin-, Check-in- und Erinnerungsregeln, Fristen für Proteste und Einsprüche",
    "Gestaltung und Gewinne",
)
REASONS = {"withdrawn": "Ausgetreten", "disqualified": "Disqualifiziert", "dissolved": "Aufgelöst"}
MOVEMENT_TEXT = {"up": "Aufstieg", "down": "Abstieg", "stay": "bleibt"}

NOT_CLOSED = "Die Season ist noch nicht abgeschlossen. Erst alle Staffeln im Reiter „Abschluss“ abschließen."
NO_STAFFELN = "Diese Season hat keine Staffel mit Endstand - aus ihr lässt sich keine neue Season anlegen."
BUSY = "Die neue Season wird gerade angelegt. Bitte gleich noch einmal."
NO_DIVISION = "Die Season hat keine aktive Liga N."
REPLAY_REOPENED = ("{name} ist angelegt, aber noch nicht fertig - und die Vorgänger-Season ist inzwischen nicht mehr abgeschlossen ({problem}) "
                   "Erst wieder abschließen, dann noch einmal „Neue Season aus …“.")
NOT_SUCCESSOR = "Diese Season ist nicht aus einer Vorgänger-Season entstanden."
STARTED = "Die Season hat schon begonnen. Neu berechnen geht nur vor dem Start - jetzt bitte von Hand im Eingang."
STAMP_CHANGED = "Der Endstand hat sich inzwischen geändert - bitte die Vorschau neu laden."
REVOKED_REASON = "Übernahme zurückgenommen: Nach dem korrigierten Endstand ist das Co-Team nicht mehr in der neuen Season."


class SuccessorProblem(ValueError):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


# ---------------------------------------------------------------- Plan: wer wohin geht

def target_level(levels: list[int], level, move: int) -> int:
    """Die Liga N der neuen Season: erst das Ziel rechnen (eine Stufe höher, tiefer oder gleich), dann auf die nächste aktive Liga N
    abbilden. Liegen zwei gleich nah, entscheidet die Richtung der Bewegung (ohne Bewegung die tiefere) - so verschiebt eine archivierte
    Liga N niemanden um zwei Stufen."""
    if not isinstance(level, int):
        return levels[-1]
    # Mit Bewegung: die nächste aktive Liga N echt in Bewegungsrichtung - auch über mehrere archivierte hinweg (aktiv [1, 4]: aus 1 nach 4).
    ahead = [item for item in levels if (item > level if move > 0 else item < level)] if move else []
    if ahead:
        return min(ahead) if move > 0 else max(ahead)
    # Am Rand (keine aktive Liga N mehr in dieser Richtung) und ohne Bewegung: die nächste zur Zielstufe.
    wanted = level + move
    if wanted in levels:
        return wanted
    toward_top = move < 0
    return min(levels, key=lambda item: (abs(item - wanted), (item > wanted) if toward_top else (item < wanted)))


def _zone_map(final: dict, division: dict | None, levels: list[int]) -> dict[str, str | None]:
    """Die Zonen des Endstands: festgehalten beim Abschluss (F.2) - sonst nach der heutigen Einstellung der Liga N (Abschluss von vor F.2)."""
    rows = final.get("rows") or []
    if rows and all("zone" in row for row in rows):
        return {row.get("registration_id"): row.get("zone") for row in rows}
    zones = final.get("zones") if isinstance(final.get("zones"), dict) and final.get("zones") else league_zones.effective(division, levels)
    return league_zones.assign(rows, zones)


async def plan(db, season: dict) -> dict:
    """Die Vorschau: ob es geht (``problems``), die aktiven Liga N mit ihren Teams nach Auf- und Abstieg (``divisions``) und wer
    herausfällt (``dropped``). Liest nur."""
    from services.league_service import division_label

    staffeln = await league_final.season_staffeln(db, season["id"])
    counted = [row for row in staffeln if is_closed(row) or row.get("status") not in league_final.IGNORED_STAFFEL_STATUSES]
    problems: list[str] = []
    if not counted:
        problems.append(NO_STAFFELN)
    elif not all(is_closed(row) for row in counted):
        open_count = len([row for row in counted if not is_closed(row)])
        problems.append(f"{NOT_CLOSED} Offen: {open_count} {'Staffel' if open_count == 1 else 'Staffeln'}.")
    divisions = await db.league_divisions.find({"season_id": season["id"]}, {"_id": 0}).sort("level", 1).to_list(50)
    active = [row for row in divisions if row.get("status") != "archived" and isinstance(row.get("level"), int)]
    if not active:
        problems.append(NO_DIVISION)
    levels = [row["level"] for row in active]
    by_id = {row["id"]: row for row in divisions}
    carried: list[dict] = []
    dropped: list[dict] = []
    seen: set[str] = set()
    finals: list[str] = []
    tournaments = await db.tournaments.find({"id": {"$in": [row["id"] for row in counted if is_closed(row)]}, **ONLY_LEAGUE},
                                            {"_id": 0, "id": 1, "title": 1, "league_context": 1}).to_list(500)
    tournaments.sort(key=lambda row: ((by_id.get(row["league_context"].get("division_id")) or {}).get("level") or 99,
                                      str(row["league_context"].get("staffel") or "")))
    for tournament in tournaments if levels else []:
        final = await active_final(db, tournament["id"])
        if not final:
            continue
        finals.append(str(final.get("id")))
        context = tournament["league_context"]
        division = by_id.get(context.get("division_id")) or {}
        from_label = division_label(division) if division.get("level") is not None else "Liga"
        zones = _zone_map(final, division, levels)
        registrations = {row["id"]: row for row in await db.tournament_registrations.find(
            {"tournament_id": tournament["id"]}, {"_id": 0}).to_list(REGISTRATION_LIMIT)}
        squads = {row["id"]: row for row in await db.team_squads.find(
            {"id": {"$in": sorted({row.get("squad_id") for row in registrations.values() if row.get("squad_id")})}}, {"_id": 0}).to_list(500)}
        team_ids = sorted({row.get("team_id") for row in squads.values() if row.get("team_id")})
        teams = {row["id"]: row for row in await db.teams.find({"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)}
        for row in league_zones.ordered(final.get("rows") or []):
            registration = registrations.get(row.get("registration_id")) or {}
            zone = zones.get(row.get("registration_id"))
            entry = {"registration_id": row.get("registration_id"), "squad_id": registration.get("squad_id"),
                     "display_name": row.get("display_name") or registration.get("display_name") or "Team",
                     "from_level": division.get("level"), "from_label": from_label, "from_staffel": context.get("staffel"),
                     "rank": row.get("rank"), "zone": zone, "zone_label": league_zones.LABELS.get(zone or "")}
            exit_kind = (row.get("exit") or {}).get("kind") if isinstance(row.get("exit"), dict) else None
            squad = squads.get(registration.get("squad_id") or "")
            if exit_kind or zone == league_zones.OUT:
                dropped.append({**entry, "reason": REASONS.get(exit_kind or "", "Ausgeschieden")})
            elif not registration.get("squad_id"):
                dropped.append({**entry, "reason": "Ohne Co-Team - kein Startplatz für die neue Season"})
            elif not squad or squad.get("status") == "archived" or squad.get("team_id") not in teams:
                dropped.append({**entry, "reason": "Das Co-Team gibt es nicht mehr"})
            elif squad["id"] in seen:
                continue
            else:
                seen.add(squad["id"])
                level = division.get("level")
                there = target_level(levels, level, league_zones.MOVES.get(zone, 0))
                team = teams[squad["team_id"]]
                carried.append({**entry, "squad_id": squad["id"], "team_id": team["id"], "team_name": team.get("name"),
                                "squad_name": squad.get("name"), "display_name": squad_registration.display_name(team, squad),
                                "target_level": there,
                                "movement": "up" if isinstance(level, int) and there < level else "down" if isinstance(level, int) and there > level else "stay"})
    # Umzug innerhalb der Season (in Staffel A ausgetreten, in Staffel B aktiv): Das Co-Team steht nur einmal da, bei den Übernommenen.
    dropped = [row for row in dropped if not row.get("squad_id") or row["squad_id"] not in seen]
    out_divisions = []
    for division in active:
        zones = league_zones.effective(division, levels)
        teams_here = [row for row in carried if row["target_level"] == division["level"]]
        teams_here.sort(key=lambda row: (row["from_level"] or 0, str(row.get("from_staffel") or ""), int(row.get("rank") or 0)))
        out_divisions.append({"level": division["level"], "label": division_label(division), "zones": zones,
                              "zones_label": league_zones.summary(zones), "teams": teams_here})
    # Die Fassung des Endstands, aus der gerechnet wurde (Nachrichten nach „Übernahme neu berechnen“ tragen sie im Schlüssel).
    stamp = hashlib.sha1("|".join(sorted(finals)).encode("utf-8")).hexdigest()[:12] if finals else ""
    return {"problems": problems, "divisions": out_divisions, "dropped": dropped, "carried": len(carried), "stamp": stamp}


# ---------------------------------------------------------------- Vorschau

async def _rules_source(db, league: dict, season: dict) -> dict:
    """Was mit dem Regelwerk geschieht: eine eigene Fassung der Season wird Entwurf der neuen, eine der Liga gilt weiter."""
    from services import league_rules

    current = await league_rules.current_version(db, league, season)
    if not current:
        return {"kind": "none", "label": None, "version_id": None}
    label = league_rules._label(current)
    if current.get("scope") == league_rules.SEASON:
        return {"kind": "draft", "label": label, "version_id": current["id"]}
    return {"kind": "league", "label": label, "version_id": current["id"]}


async def existing(db, season: dict) -> dict | None:
    return await db.league_seasons.find_one({"predecessor_id": season["id"]}, {"_id": 0, "id": 1, "name": 1, "number": 1, "status": 1})


async def preview(db, season: dict) -> dict:
    league = await leagues.get_league(db, season["league_id"])
    found = await plan(db, season)
    pool = map_pools.valid_for(await map_pools.current(db, "league_season", season["id"]), league.get("game_id"))
    bans = loadout_bans.valid_for(await loadout_bans.current(db, loadout_bans.SEASON, season["id"]), league.get("game_id"))
    newest = await db.league_seasons.find_one({"league_id": league["id"]}, {"_id": 0, "number": 1}, sort=[("number", -1)])
    suggestion = {"number": int((newest or {}).get("number") or 0) + 1}
    suggestion["name"] = f"Season {suggestion['number']}"
    successor = await existing(db, season)
    return {
        "season": {"id": season["id"], "name": season.get("name"), "number": season.get("number"), "status": season.get("status")},
        "can_create": not found["problems"] and not successor,
        "problems": found["problems"],
        "successor": successor,
        "suggested": suggestion,
        "copied": list(COPIED_GROUPS),
        "dates_to_set": list(DATES_TO_SET),
        "map_pool": {"version": pool.get("version")} if pool else None,
        "loadout_bans": {"version": bans.get("version")} if bans else None,
        "rules": await _rules_source(db, league, season),
        "divisions": found["divisions"],
        "dropped": found["dropped"],
        "carried": found["carried"],
        "relegation_note": "Relegationsplätze sind vorbereitet: Sie stehen farbig in der Tabelle, die Teams bleiben vorerst in ihrer Liga.",
    }


# ---------------------------------------------------------------- Anlegen

def _start(value) -> datetime:
    moment = leagues._aware(value)
    if moment is None:
        raise SuccessorProblem("Bitte den Beginn der ersten Spielwoche der neuen Season angeben.")
    return moment


async def create(db, season: dict, body: dict, actor: dict) -> dict:
    """Legt die neue Season an - oder findet die schon angelegte (``replay``) und ergänzt, was beim ersten Mal nicht fertig wurde.
    Hält die Sperre der Vorgänger-Season: Zwei Klicks kurz hintereinander legen eine Season an, nie zwei."""
    try:
        async with mutation_lock(db, league_season_resource(season["id"]), wait_seconds=LOCK_WAIT_SECONDS):
            return await _create(db, season, body, actor)
    except MutationLockBusy:
        raise SuccessorProblem(BUSY, 409) from None


async def _create(db, season: dict, body: dict, actor: dict) -> dict:
    league = await leagues.get_league(db, season["league_id"])
    found = await existing(db, season)
    if found:
        doc = await db.league_seasons.find_one({"id": found["id"]}, {"_id": 0})
        if not doc.get("successor_ready"):
            checked = await plan(db, season)
            if checked["problems"]:
                # Brach das Anlegen ab und wurde der Vorgänger inzwischen wieder geöffnet: nichts halb fertig als „fertig“ markieren.
                raise SuccessorProblem(REPLAY_REOPENED.format(name=doc.get("name") or "Die neue Season", problem=checked["problems"][0]), 409)
            report = await _complete(db, league, season, doc, actor, checked=checked)
            return {"season": doc, "replay": True, **report}
        return {"season": doc, "replay": True, "carried": 0, "notified": 0}
    if not body.get("confirm"):
        raise SuccessorProblem("Bitte das Anlegen bestätigen.")
    start = _start(body.get("start_date"))
    checked = await plan(db, season)
    if checked["problems"]:
        raise SuccessorProblem(checked["problems"][0], 409)
    copied = {key: value for key, value in season.items() if key not in NOT_COPIED and not key.endswith("_at")}

    async def take_over(doc: dict) -> None:
        # Die Vorgaben der neuen Season sind die des Vorgängers - die Kennung bleibt, Zeitraum und Stand sind neu (Nr. 161).
        doc.update(copied)
        doc.update({"predecessor_id": season["id"], "status": "draft", "visibility": "off",
                    "predecessor": {"id": season["id"], "name": season.get("name"), "number": season.get("number"), "slug": season.get("slug")}})

    request = {"start_date": start.isoformat(), "visibility": "off", "status": "draft"}
    if str(body.get("name") or "").strip():
        request["name"] = str(body["name"]).strip()[:80]
    try:
        doc = await leagues.create_season(db, league, request, actor, before_write=take_over)
    except DuplicateKeyError:
        raise SuccessorProblem("Diese Season gibt es schon.", 409) from None
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "league.season.successor", "actor_id": actor.get("id"), "target_id": doc["id"],
        "data": {"league_id": league["id"], "predecessor_id": season["id"], "number": doc["number"]}, "created_at": now_utc().isoformat()})
    report = await _complete(db, league, season, doc, actor, checked=checked)
    return {"season": doc, "replay": False, **report}


async def _complete(db, league: dict, season: dict, doc: dict, actor: dict, *, checked: dict | None = None) -> dict:
    """Die Schritte nach der Season selbst - jeder findet, was schon da ist, und legt nichts doppelt an. Erst danach ist die neue Season
    ``successor_ready``."""
    divisions = await _copy_divisions(db, season, doc, actor)
    await _copy_versions(db, season, doc, actor)
    await _rules_draft(db, league, season, doc, actor)
    checked = checked or await plan(db, season)
    carried = await _carry_teams(db, league, season, doc, actor, checked, divisions) if not checked["problems"] else []
    # Auch beim Wiederholen: jeder übernommene Antrag ohne Merker bekommt seine Nachricht (der erste Lauf kann davor abgebrochen sein).
    waiting = await db.league_applications.find({"season_id": doc["id"], "carry_over": {"$exists": True}, "carry_over.notified_at": {"$exists": False},
                                                 "status": "accepted"}, {"_id": 0}).to_list(500)
    notified = await _tell_captains(db, league, doc, waiting)
    await db.league_seasons.update_one({"id": doc["id"]}, {"$set": {"successor_ready": True}})
    doc["successor_ready"] = True
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "league.season.successor.teams", "actor_id": actor.get("id"), "target_id": doc["id"],
        "data": {"predecessor_id": season["id"], "carried": len(carried), "dropped": len(checked["dropped"]),
                 "divisions": len(divisions)}, "created_at": now_utc().isoformat()})
    return {"carried": len(carried), "notified": notified}


async def _copy_divisions(db, season: dict, doc: dict, actor: dict) -> dict[int, dict]:
    """Die aktiven Liga N mit Beinamen, Abweichungen, Zonen und Gewinnen - je Stufe einmal."""
    have = {row["level"]: row for row in await db.league_divisions.find({"season_id": doc["id"]}, {"_id": 0}).to_list(50)}
    rows = await db.league_divisions.find({"season_id": season["id"], "status": {"$ne": "archived"}}, {"_id": 0}).sort("level", 1).to_list(50)
    now = now_utc().isoformat()
    for row in rows:
        if row.get("level") in have:
            continue
        copy = {key: value for key, value in row.items() if key not in ("_id", "id", "season_id", "created_at", "created_by", "updated_at")}
        copy.update({"id": new_id(), "season_id": doc["id"], "league_id": doc["league_id"], "status": "active",
                     "created_at": now, "created_by": actor.get("id"), "updated_at": now})
        try:
            await db.league_divisions.insert_one(dict(copy))
            have[copy["level"]] = copy
        except DuplicateKeyError:
            have[copy["level"]] = await db.league_divisions.find_one({"season_id": doc["id"], "level": copy["level"]}, {"_id": 0})
    return have


async def _copy_versions(db, season: dict, doc: dict, actor: dict) -> None:
    """Map-Pool und Sperrliste: die geltende Version als erste der neuen Season - mit denselben Maps und Einträgen von damals."""
    pool = await map_pools.current(db, "league_season", season["id"])
    if pool and not await map_pools.latest(db, "league_season", doc["id"]):
        await map_pools.copy_version(db, pool, scope="league_season", scope_id=doc["id"], user=actor,
                                     note=f"Übernommen aus {season.get('name') or 'der Vorgänger-Season'}")
    bans = await loadout_bans.current(db, loadout_bans.SEASON, season["id"])
    if bans and not await loadout_bans.latest(db, loadout_bans.SEASON, doc["id"]):
        await loadout_bans.copy_version(db, bans, scope=loadout_bans.SEASON, scope_id=doc["id"], user=actor)


async def _rules_draft(db, league: dict, season: dict, doc: dict, actor: dict) -> dict | None:
    """Ein eigenes Regelwerk der Vorgänger-Season wird Entwurf einer neuen Fassung (Nr. 161) - mit Hinweis, woher es kommt. Die Teams
    stimmen der freigegebenen Fassung neu zu, bevor sie spielen (Nr. 160, Sperre beim Check-in aus D.2)."""
    from services import league_rules

    source = await _rules_source(db, league, season)
    if source["kind"] != "draft" or await league_rules.draft_of(db, league_rules.SEASON, doc["id"]):
        return None
    version = await db.league_rules.find_one({"id": source["version_id"]}, {"_id": 0})
    if not version:
        return None
    draft = await league_rules.save_draft(db, league_rules.SEASON, doc["id"],
                                          {"title": version.get("title"), "body_md": version.get("body_md"), "annexes": version.get("annexes")},
                                          actor, carried=set(league_rules._upload_files(version.get("body_md"), version.get("annexes"))))
    carried_from = {"season_id": season["id"], "season_name": season.get("name"), "version_id": version["id"], "label": source["label"]}
    await db.league_rules.update_one({"id": draft["id"], "status": league_rules.DRAFT}, {"$set": {"carried_from": carried_from}})
    return {**draft, "carried_from": carried_from}


async def _carry_teams(db, league: dict, season: dict, doc: dict, actor: dict, checked: dict, divisions: dict[int, dict]) -> list[dict]:
    """Je Co-Team ein angenommener Antrag in seiner neuen Liga N - ohne Staffel, bis die Leitung zuteilt. Ein Co-Team, das in der neuen
    Season schon einen Antrag hat (auch einen zurückgezogenen), bleibt, wie es ist."""
    from services.league_applications import ACCEPTED

    now = now_utc().isoformat()
    out = []
    for division in checked["divisions"]:
        target = divisions.get(division["level"]) or {}
        for team in division["teams"]:
            if await db.league_applications.find_one({"season_id": doc["id"], "squad_id": team["squad_id"]}, {"_id": 1}):
                continue
            carry = {"from_season_id": season["id"], "from_season_name": season.get("name"), "from_level": team["from_level"],
                     "from_label": team["from_label"], "from_staffel": team.get("from_staffel"), "rank": team.get("rank"),
                     "zone": team.get("zone"), "movement": team["movement"], "division_id": target.get("id"),
                     "division_level": division["level"], "division_label": division["label"]}
            row = {
                "id": new_id(), "league_id": league["id"], "season_id": doc["id"], "team_id": team["team_id"], "squad_id": team["squad_id"],
                "team_name": team.get("team_name"), "squad_name": team.get("squad_name"), "display_name": team["display_name"],
                "status": ACCEPTED, "active_key": f"{doc['id']}:{team['squad_id']}", "applied_by": None, "submitted_at": now,
                "decided_by": actor.get("id"), "decided_at": now, "decision_reason": None, "carry_over": carry,
                "history": [{"status": ACCEPTED, "by": actor.get("id"), "at": now, "carry_over": True}],
                "created_at": now, "updated_at": now,
            }
            try:
                await db.league_applications.insert_one(dict(row))
            except DuplicateKeyError:
                continue
            out.append(row)
    return out


def withdraw_until(season: dict) -> str | None:
    """Abmelden geht bis zum Start der Season (Nr. 160)."""
    return season.get("start_date")


async def _tell_captains(db, league: dict, season: dict, rows: list[dict], *, kind: str = "new", stamp: str = "") -> int:
    """„Ihr seid in Liga N der neuen Season, abmelden bis …“ an Captain und Vertreter - je Season, Co-Team und Person einmal, nach
    „Übernahme neu berechnen“ einmal je Fassung des Endstands (``stamp``). Danach steht ``carry_over.notified_at`` am Antrag."""
    from services.league_applications import _responsible
    from services.league_mail import send_league_mail
    from services.user_notifications import create_user_notification
    from services.matchday_schedule import LOCAL_TZ

    until = leagues._aware(withdraw_until(season))
    day = until.astimezone(LOCAL_TZ).strftime("%d.%m.%Y, %H:%M Uhr") if until else ""
    title = " ".join(part for part in (league.get("name"), season.get("name")) if part)
    # Solange die Season „Aus“ ist, gibt es keine Ligaseite - dann nur der Weg unter Teams.
    where = "unter Teams beim Co-Team" if (season.get("visibility") or "off") == "off" else "unter Teams beim Co-Team oder auf der Ligaseite"
    sent = 0
    for row in rows:
        try:
            squad = await db.team_squads.find_one({"id": row["squad_id"]}, {"_id": 0}) or {"id": row["squad_id"], "team_id": row["team_id"]}
            carry = row["carry_over"]
            way = {"up": f" - Aufstieg aus {carry['from_label']}", "down": f" - Abstieg aus {carry['from_label']}"}.get(carry["movement"], "")
            if kind == "revoked":
                headline = "Neue Season: Übernahme zurückgenommen"
                text = (f"Die Liga-Leitung hat den Endstand von {carry.get('from_season_name') or 'der Vorgänger-Season'} korrigiert. "
                        f"{row['display_name']} ist danach nicht mehr in {title}. Fragen beantwortet die Liga-Leitung.")
            else:
                headline = "Neue Season: neue Liga" if kind == "moved" else "Neue Season: ihr seid dabei"
                lead = (f"Die Liga-Leitung hat den Endstand von {carry.get('from_season_name') or 'der Vorgänger-Season'} korrigiert. "
                        if kind == "moved" else "")
                text = (f"{lead}{row['display_name']} ist in {carry['division_label']} der neuen Season {title}{way}. Ihr seid automatisch dabei. "
                        f"Wer nicht mitspielen will, meldet sich bis zum Start ({day}) ab: {where}.")
            for user_id in sorted(await _responsible(db, squad)):
                key = f"league-successor:{season['id']}:{row['squad_id']}:{user_id}" + (f":{stamp}:{kind}" if stamp else "")
                if await create_user_notification(user_id, headline, text, url="/teams", kind="tournament_registration",
                                                  meta={"reason": "league_successor", "application_id": row["id"], "dedupe_key": key}):
                    sent += 1
                await send_league_mail(db, user_id, headline, text, "/teams", f"{key}:mail")
            await db.league_applications.update_one({"id": row["id"]}, {"$set": {"carry_over.notified_at": now_utc().isoformat()}})
        except Exception:  # noqa: BLE001 - die Season steht, eine Nachricht hält sie nicht auf
            logger.warning("[liga] Nachricht zur neuen Season nicht verschickt: %s", log_safe(row.get("id")), exc_info=True)
    return sent


# ---------------------------------------------------------------- Übernahme neu berechnen (Entscheidung Nr. 162)

CARRY_KEYS = ("from_label", "from_level", "from_staffel", "rank", "zone", "movement", "division_level")


def started(season: dict, now: datetime | None = None) -> bool:
    """Hat die neue Season begonnen? Im Entwurf nie, sonst ab ihrem ersten Tag."""
    if (season.get("status") or "draft") == "draft":
        return False
    start = leagues._aware(season.get("start_date"))
    return bool(start and (now or now_utc()) >= start)


def _carry_of(season: dict, team: dict, division: dict | None, label: str) -> dict:
    return {"from_season_id": season["id"], "from_season_name": season.get("name"), "from_level": team["from_level"],
            "from_label": team["from_label"], "from_staffel": team.get("from_staffel"), "rank": team.get("rank"),
            "zone": team.get("zone"), "movement": team["movement"], "division_id": (division or {}).get("id"),
            "division_level": team["target_level"], "division_label": label}


async def _recompute_plan(db, season: dict) -> dict:
    """Was „Übernahme neu berechnen“ in der neuen Season ``season`` täte - liest nur."""
    from services.league_applications import ACCEPTED
    from services.league_service import division_label

    if not season.get("predecessor_id"):
        raise SuccessorProblem(NOT_SUCCESSOR, 404)
    predecessor = await leagues.get_season(db, season["predecessor_id"])
    checked = await plan(db, predecessor)
    problems = list(checked["problems"])
    if started(season):
        problems.insert(0, STARTED)
    divisions = {row["level"]: row for row in await db.league_divisions.find({"season_id": season["id"]}, {"_id": 0}).to_list(50)}
    target = {}
    for division in checked["divisions"]:
        for team in division["teams"]:
            own = divisions.get(team["target_level"])
            target[team["squad_id"]] = (team, own, division_label(own) if own else division["label"])
    rows = await db.league_applications.find({"season_id": season["id"]}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    carried = {row["squad_id"]: row for row in rows if row.get("carry_over")}
    others = {row["squad_id"]: row for row in rows if not row.get("carry_over") and row.get("active_key")}
    changes, manual = [], []
    unchanged = 0
    for squad_id, row in carried.items():
        wanted = target.get(squad_id)
        carry = row["carry_over"]
        name = row.get("display_name") or "Team"
        if carry.get("revoked_at"):
            if wanted and squad_id not in others:
                changes.append({"kind": "reactivated", "application_id": row["id"], "squad_id": squad_id, "display_name": name,
                                "to_label": wanted[2], "carry_over": _carry_of(predecessor, wanted[0], wanted[1], wanted[2])})
            else:
                unchanged += 1
            continue
        free = row["status"] == ACCEPTED and not row.get("assignment")
        new = _carry_of(predecessor, wanted[0], wanted[1], wanted[2]) if wanted else None
        if not free:
            if not wanted or new["division_level"] != carry.get("division_level"):
                why = "zugeteilt" if row.get("assignment") else {"withdrawn": "abgemeldet"}.get(row["status"], "nicht mehr angenommen")
                manual.append({"application_id": row["id"], "display_name": name, "status": row["status"], "why": why,
                               "from_label": carry.get("division_label"), "to_label": wanted[2] if wanted else None})
            else:
                unchanged += 1
            continue
        if not wanted:
            changes.append({"kind": "revoked", "application_id": row["id"], "squad_id": squad_id, "display_name": name,
                            "from_label": carry.get("division_label")})
        elif any(new.get(key) != carry.get(key) for key in CARRY_KEYS) or new["division_id"] != carry.get("division_id"):
            moved = new["division_level"] != carry.get("division_level")
            changes.append({"kind": "moved" if moved else "updated", "application_id": row["id"], "squad_id": squad_id, "display_name": name,
                            "from_label": carry.get("division_label"), "to_label": wanted[2], "carry_over": new})
        else:
            unchanged += 1
    for squad_id, (team, own, label) in target.items():
        if squad_id in carried:
            continue
        if squad_id in others:
            manual.append({"application_id": others[squad_id]["id"], "display_name": team["display_name"], "status": others[squad_id]["status"],
                           "why": "selbst angemeldet", "from_label": None, "to_label": label})
            continue
        changes.append({"kind": "added", "squad_id": squad_id, "display_name": team["display_name"], "to_label": label,
                        "team": team, "carry_over": _carry_of(predecessor, team, own, label)})
    return {"predecessor": predecessor, "problems": problems, "stamp": checked["stamp"], "changes": changes, "manual": manual,
            "unchanged": unchanged}


def _public_change(change: dict) -> dict:
    return {key: change.get(key) for key in ("kind", "application_id", "squad_id", "display_name", "from_label", "to_label")}


async def recompute_view(db, season: dict) -> dict:
    found = await _recompute_plan(db, season)
    return {"can_run": not found["problems"], "problems": found["problems"], "stamp": found["stamp"],
            "predecessor": {"id": found["predecessor"]["id"], "name": found["predecessor"].get("name")},
            "changes": [_public_change(row) for row in found["changes"]], "manual": found["manual"], "unchanged": found["unchanged"]}


async def recompute(db, season: dict, body: dict, actor: dict) -> dict:
    """Übernahme neu berechnen (Nr. 162): nur offene übernommene Anträge (angenommen, ohne Staffel) folgen dem korrigierten Endstand;
    fehlende Teams kommen dazu, wer nicht mehr dabei ist, wird „zurückgenommen“ (nichts wird gelöscht). Zugeteilte und abgemeldete
    bleiben und stehen unter ``manual``. Wiederholt ändert es nichts mehr."""
    if not body.get("confirm"):
        raise SuccessorProblem("Bitte das Neuberechnen bestätigen.")
    try:
        async with mutation_lock(db, league_season_resource(season["id"]), wait_seconds=LOCK_WAIT_SECONDS):
            fresh = await leagues.get_season(db, season["id"])
            found = await _recompute_plan(db, fresh)
            if found["problems"]:
                raise SuccessorProblem(found["problems"][0], 409)
            if body.get("stamp") != found["stamp"]:
                raise SuccessorProblem(STAMP_CHANGED, 409)
            done = await _apply_recompute(db, fresh, found, actor)
    except MutationLockBusy:
        raise SuccessorProblem(BUSY, 409) from None
    league = await leagues.get_league(db, fresh["league_id"])
    notified = 0
    for kind in ("moved", "added", "reactivated", "revoked"):
        rows = [row for change, row in done if change["kind"] == kind]
        notified += await _tell_captains(db, league, fresh, rows, kind="moved" if kind in ("moved", "reactivated") else kind,
                                         stamp=found["stamp"]) if rows else 0
    counts = {kind: len([1 for change, _row in done if change["kind"] == kind]) for kind in ("moved", "updated", "added", "reactivated", "revoked")}
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "league.season.successor.recompute", "actor_id": actor.get("id"), "target_id": fresh["id"],
        "data": {"predecessor_id": fresh["predecessor_id"], "stamp": found["stamp"], **counts, "manual": len(found["manual"])},
        "created_at": now_utc().isoformat()})
    return {"changed": len(done), **counts, "manual": found["manual"], "notified": notified, "stamp": found["stamp"]}


async def _apply_recompute(db, season: dict, found: dict, actor: dict) -> list[tuple[dict, dict]]:
    from services.league_applications import ACCEPTED, REJECTED

    now = now_utc().isoformat()
    who = actor.get("id")
    done = []
    for change in found["changes"]:
        kind = change["kind"]
        if kind == "added":
            team = change["team"]
            row = {
                "id": new_id(), "league_id": season["league_id"], "season_id": season["id"], "team_id": team["team_id"], "squad_id": team["squad_id"],
                "team_name": team.get("team_name"), "squad_name": team.get("squad_name"), "display_name": team["display_name"],
                "status": ACCEPTED, "active_key": f"{season['id']}:{team['squad_id']}", "applied_by": None, "submitted_at": now,
                "decided_by": who, "decided_at": now, "decision_reason": None, "carry_over": change["carry_over"],
                "history": [{"status": ACCEPTED, "by": who, "at": now, "carry_over": True, "recomputed": True}], "created_at": now, "updated_at": now,
            }
            try:
                await db.league_applications.insert_one(dict(row))
            except DuplicateKeyError:
                continue
            done.append((change, row))
            continue
        query = {"id": change["application_id"]}
        if kind == "revoked":
            query.update({"status": ACCEPTED, "assignment": {"$exists": False}})
            update = {"$set": {"status": REJECTED, "decision_reason": REVOKED_REASON, "decided_by": who, "decided_at": now, "updated_at": now,
                               "carry_over.revoked_at": now, "carry_over.revoked_by": who},
                      "$unset": {"active_key": ""},
                      "$push": {"history": {"status": REJECTED, "by": who, "at": now, "reason": REVOKED_REASON, "carry_over": True, "recomputed": True}}}
        elif kind == "reactivated":
            query.update({"status": REJECTED, "carry_over.revoked_at": {"$exists": True}})
            carry = dict(change["carry_over"])
            update = {"$set": {"status": ACCEPTED, "active_key": f"{season['id']}:{change['squad_id']}", "decision_reason": None, "decided_by": who,
                               "decided_at": now, "updated_at": now, "carry_over": carry},
                      "$push": {"history": {"status": ACCEPTED, "by": who, "at": now, "carry_over": True, "recomputed": True}}}
        else:
            query.update({"status": ACCEPTED, "assignment": {"$exists": False}})
            update = {"$set": {**{f"carry_over.{key}": value for key, value in change["carry_over"].items()}, "updated_at": now}}
        try:
            result = await db.league_applications.update_one(query, update)
        except DuplicateKeyError:
            continue
        if result.modified_count:
            done.append((change, await db.league_applications.find_one({"id": change["application_id"]}, {"_id": 0})))
    return done
