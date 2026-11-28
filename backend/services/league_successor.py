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
from services import league_cross_zones, league_final, league_staffel_plan, league_zones, loadout_bans, map_pools, squad_registration
from services import league_participants, league_postseason, league_postseason_rules, league_start_right_rules
from services import league_service as leagues
from services.league_final_read import active_final, is_closed
from services.league_scope import ONLY_LEAGUE, RELEGATION, staffel_kind
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
    # Playoffs und Relegation (F.6, #2404): Die Einstellungen gehen mit (ohne ihre Termine, ``take_over``), das Ende gehört zur alten Season.
    "postseason_end",
    # Verlängerte Nachmeldung (#2422, Nr. 184): gilt nur dieser Season, die Frist selbst (``late_registration_days``) geht mit.
    "application_late_extension",
    # Der gemerkte Rückfallwert fürs Best of von Playoffs und Relegation (#2404, Nr. 255): Die neue Season beginnt wieder mit „wie in
    # der Season“ - an der Season und an jeder Liga N (``_copy_divisions``).
    league_postseason.KEPT,
    # Startrechte (#1627, F.2a): Die Einstellung ``start_rights`` geht mit - was die alte Season schon gemeldet hat, gehört zu ihr.
    league_start_right_rules.NOTICES, league_start_right_rules.NOTICES_OPEN, league_start_right_rules.PAUSES,
    # Abgesagt (#2607): gehört nur der abgesagten Season (eine Folge-Season aus ihr gibt es ohnehin nicht).
    "cancel_reason", "cancelled_by", "cancelled_predecessor_id", "status_before_cancel",
})
DATES_TO_SET = ("Beginn der ersten Spielwoche", "Sperrzeiten", "Anmeldefenster und Meldeschluss", "Transferfenster", "Stichtag des Kaders")
COPIED_GROUPS = (
    "Spielbetrieb: Best of, Teamgröße, Modi je Map, Ergebnisregeln, Veto, Vorfälle und Pausen",
    "Tabelle: Punkte, Gleichstand, Ausscheiden",
    "Anmeldung und Kader: Spielberechtigung, Plattform, Plätze, Warteliste, Zulassung",
    "Termin-, Check-in- und Erinnerungsregeln, Fristen für Proteste und Einsprüche",
    "Gestaltung und Gewinne",
    # F.4 (#2214): Zusammenstellung der Season, „Spieler mit Einsatz“ bzw. Kader und die eigenen Belohnungen je Liga N.
    "Belohnungen je Season und Liga N",
    # #1642, Nr. 236: Discord-Meldungen der Liga gehen samt „an“ und Kanal mit.
    "Discord-Meldungen der Liga: an/aus, Kanal, Wartezeit, Tabellenausschnitt",
)
REASONS = {"withdrawn": "Ausgetreten", "disqualified": "Disqualifiziert", "dissolved": "Aufgelöst"}
MOVEMENT_TEXT = {"up": "Aufstieg", "down": "Abstieg", "stay": "bleibt"}

NOT_CLOSED = "Die Season ist noch nicht abgeschlossen. Erst alle Staffeln im Reiter „Abschluss“ abschließen."
NO_STAFFELN = "Diese Season hat keine Staffel mit Endstand - aus ihr lässt sich keine neue Season anlegen."
NO_SUCCESSOR_CANCELLED = ("Diese Season ist abgesagt - aus ihr lässt sich keine neue Season anlegen. Lege die neue Season aus der Vorgänger-Season "
                          "an, dort gelten deren Startrechte weiter, oder lege eine neue Season in der Liga an.")
BUSY = "Die neue Season wird gerade angelegt. Bitte gleich noch einmal."
NO_DIVISION = "Die Season hat keine aktive Liga N."
REPLAY_REOPENED = ("{name} ist angelegt, aber noch nicht fertig - und die Vorgänger-Season ist inzwischen nicht mehr abgeschlossen ({problem}) "
                   "Erst wieder abschließen, dann noch einmal „Neue Season aus …“.")
NOT_SUCCESSOR = "Diese Season ist nicht aus einer Vorgänger-Season entstanden."
STARTED = "Die Season hat schon begonnen. Neu berechnen geht nur vor dem Start - jetzt bitte von Hand im Eingang."
STAMP_CHANGED = "Der Endstand hat sich inzwischen geändert - bitte die Vorschau neu laden."
REVOKED_REASON = "Übernahme zurückgenommen: Nach dem korrigierten Endstand ist das Co-Team nicht mehr in der neuen Season."
RELEGATION_OPEN = "Die Relegation ist noch nicht abgeschlossen."
RELEGATION_APPLIED = ("Relegation: Aus dem abgeschlossenen Ergebnis steigt der Sieger aus der unteren Liga auf und der Verlierer aus der "
                      "oberen ab; alle anderen Relegations-Teams bleiben.")
# Wirkung der Relegation auf die Stufe (Nr. 213): wie ``league_zones.MOVES`` - eine höher, eine tiefer, bleibt.
RELEGATION_MOVES = {"up": -1, "down": 1, "stay": 0}


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


def capacity(season: dict, division: dict, teams: int, staffeln_before: int) -> dict:
    """Platzprüfung einer Liga N der neuen Season (#1627): Passen die Teams, die nach Auf- und Abstieg dort ankommen, in so viele
    Staffeln, wie es bisher gab? Gerechnet mit der Staffelgröße der Liga N und den Wochen der Season (Sperrzeiten setzt die neue Season
    neu, darum ohne sie). Ein Hinweis, keine Sperre: Die Staffeln der neuen Season legt die Leitung an."""
    settings = leagues.effective_settings(season, division)
    found = league_staffel_plan.suggest(teams, max_size=settings.get("max_staffel_size"), active_weeks=season.get("weeks_total"),
                                        legs=season.get("round_robin_legs") or 1, have=staffeln_before, have_word="Bisher gab es")
    return {"teams": teams, "staffeln_before": staffeln_before, "cap": found["cap"], "cap_by": found["cap_by"], "needed": found["needed"],
            "sizes": found["sizes"], "fits": found["fits"], "text": found["text"]}


async def plan(db, season: dict) -> dict:
    """Die Vorschau: ob es geht (``problems``), die aktiven Liga N mit ihren Teams nach Auf- und Abstieg (``divisions``) und wer
    herausfällt (``dropped``). Liest nur."""
    from services.league_service import division_label

    staffeln = await league_final.season_staffeln(db, season["id"])
    counted = [row for row in staffeln if is_closed(row) or row.get("status") not in league_final.IGNORED_STAFFEL_STATUSES]
    problems: list[str] = []
    if season.get("status") == leagues.CANCELLED:
        # Abgesagt (#2607): Es gibt keinen Endstand. Die neue Season entsteht aus dem Vorgänger - dort gelten dessen Startrechte weiter.
        problems.append(NO_SUCCESSOR_CANCELLED)
    league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "participant_kind": 1})
    if league_participants.is_solo(league):
        # Solo-Liga (#1629): Übernahme je Person und Startrechte mit ``user:<id>`` kommen erst mit P4 - als erster Grund genannt.
        problems.append(league_participants.SUCCESSOR_FOLLOWS)
    if not counted:
        problems.append(NO_STAFFELN)
    elif not all(is_closed(row) for row in counted):
        open_count = len([row for row in counted if not is_closed(row)])
        problems.append(f"{NOT_CLOSED} Offen: {open_count} {'Staffel' if open_count == 1 else 'Staffeln'}.")
        # Relegation (F.6, #2404, Nr. 213): Die neue Season gibt es erst, wenn sie abgeschlossen ist - eigens gesagt.
        if any(staffel_kind(row) == RELEGATION and not is_closed(row) for row in counted):
            problems.append(RELEGATION_OPEN)
    # Playoffs oder Relegation eingeschaltet, aber noch nicht angelegt: Auch dann fehlt noch ein Ergebnis.
    problems += [row["text"] for row in await league_postseason.missing(db, season["id"])]
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
    closed_rows = await db.tournaments.find({"id": {"$in": [row["id"] for row in counted if is_closed(row)]}, **ONLY_LEAGUE},
                                            {"_id": 0, "id": 1, "title": 1, "league_context": 1}).to_list(500)
    # Nur reguläre Staffeln sind Tabellen (F.6, #2404): Der Playoff-Endstand ändert keine Liga N, die Relegation überlagert unten.
    tournaments = [row for row in closed_rows if not staffel_kind(row)]
    tournaments.sort(key=lambda row: ((by_id.get(row["league_context"].get("division_id")) or {}).get("level") or 99,
                                      str(row["league_context"].get("staffel") or "")))
    loaded = {row["id"]: await active_final(db, row["id"]) for row in tournaments} if levels else {}
    # Wirkung der Relegation (Nr. 213): je Co-Team ``up``, ``down`` oder ``stay`` aus dem abgeschlossenen Ergebnis.
    relegated: dict[str, str] = {}
    relegation_finals: list[str] = []
    for row in closed_rows if levels else []:
        if staffel_kind(row) != RELEGATION:
            continue
        final = await active_final(db, row["id"])
        if final:
            relegation_finals.append(str(final.get("id")))
            relegated.update({str(key): value for key, value in (final.get("outcome") or {}).items()})
    # Plätze über Staffeln hinweg (#1627): je Liga N aus allen ihren Endständen - nur wenn die Season ganz abgeschlossen ist. Ein
    # offener Gleichstand an der Grenze hält die neue Season auf, bis die Leitung entschieden hat.
    crossed: dict[str, str] = {}
    decided: list[str] = []
    if levels and not problems:
        for division in active:
            mine = [row for row in tournaments if row["league_context"].get("division_id") == division["id"] and loaded.get(row["id"])]
            # Aus dem gespeicherten Stand (Nr. 228): die Zonen, mit denen die Staffeln abgeschlossen wurden - nie die heutige Einstellung.
            rule = league_cross_zones.stored_rule([loaded[row["id"]] for row in mine])
            if not mine or not league_cross_zones.has_rule(rule):
                continue
            found = league_cross_zones.evaluate(rule, [{"tournament_id": row["id"], "staffel": row["league_context"].get("staffel"),
                                                        "rows": loaded[row["id"]].get("rows") or [], "zones": loaded[row["id"]].get("zones")}
                                                       for row in mine], division.get("zone_decisions"))
            crossed.update(found["zones"])
            decided += [str((division.get("zone_decisions") or {}).get(side["kind"], {}).get("id")) for side in found["sides"] if side["decision"]]
            problems += [league_cross_zones.SUCCESSOR_TIE.format(label=division_label(division), names=" – ".join(tie["names"]))
                         for tie in found["ties"]]
    for tournament in tournaments if levels else []:
        final = loaded.get(tournament["id"])
        if not final:
            continue
        finals.append(str(final.get("id")))
        context = tournament["league_context"]
        division = by_id.get(context.get("division_id")) or {}
        from_label = division_label(division) if division.get("level") is not None else "Liga"
        zones = {**_zone_map(final, division, levels), **{key: zone for key, zone in crossed.items()}}
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
                     # Für den Vergleich über Staffeln hinweg beim Nachrücken (#1627, F.2a): Punkte und Map-Differenz je Spiel.
                     "points": row.get("points"), "played": row.get("played"), "score_diff": row.get("score_diff"),
                     "from_level": division.get("level"), "from_label": from_label, "from_staffel": context.get("staffel"),
                     "rank": row.get("rank"), "zone": zone, "zone_label": league_zones.LABELS.get(zone or ""),
                     # Über den Vergleich der Staffeln (#1627): „bester Nächstplatzierter“ bzw. spiegelbildlich beim Abstieg.
                     **({"zone_cross": True} if row.get("registration_id") in crossed else {})}
            exit_kind = (row.get("exit") or {}).get("kind") if isinstance(row.get("exit"), dict) else None
            squad = squads.get(registration.get("squad_id") or "")
            level = division.get("level")
            # Die Relegation überlagert die Bewegung aus der Zone - vor Zielregel und Platzprüfung (F.6).
            outcome = relegated.get(registration.get("squad_id") or "")
            move = RELEGATION_MOVES[outcome] if outcome in RELEGATION_MOVES else league_zones.MOVES.get(zone, 0)
            there = target_level(levels, level, move)
            moving = {"target_level": there, **({"via": "relegation", "relegation": outcome} if outcome in RELEGATION_MOVES else {}),
                      "movement": "up" if isinstance(level, int) and there < level else "down" if isinstance(level, int) and there > level else "stay"}
            if exit_kind or zone == league_zones.OUT:
                dropped.append({**entry, "reason": REASONS.get(exit_kind or "", "Ausgeschieden")})
            elif not registration.get("squad_id"):
                dropped.append({**entry, "reason": "Ohne Co-Team - kein Startplatz für die neue Season"})
            elif not squad or squad.get("status") == "archived" or squad.get("team_id") not in teams:
                # Der Platz im Endstand bleibt (#1627, F.2a, ``placed_levels``): Ob es einen Startplatz gibt, hängt an der
                # Platzierung - nicht daran, ob es das Co-Team noch gibt.
                dropped.append({**entry, "reason": "Das Co-Team gibt es nicht mehr", **moving})
            elif squad["id"] in seen:
                continue
            else:
                seen.add(squad["id"])
                team = teams[squad["team_id"]]
                carried.append({**entry, "squad_id": squad["id"], "team_id": team["id"], "team_name": team.get("name"),
                                "squad_name": squad.get("name"), "display_name": squad_registration.display_name(team, squad), **moving})
    # Umzug innerhalb der Season (in Staffel A ausgetreten, in Staffel B aktiv): Das Co-Team steht nur einmal da, bei den Übernommenen.
    dropped = [row for row in dropped if not row.get("squad_id") or row["squad_id"] not in seen]
    out_divisions = []
    for division in active:
        zones = league_zones.effective(division, levels)
        teams_here = [row for row in carried if row["target_level"] == division["level"]]
        teams_here.sort(key=lambda row: (row["from_level"] or 0, str(row.get("from_staffel") or ""), int(row.get("rank") or 0)))
        before = len([row for row in tournaments if row["league_context"].get("division_id") == division["id"]])
        out_divisions.append({"level": division["level"], "label": division_label(division), "zones": zones,
                              "zones_label": league_zones.summary(zones), "teams": teams_here,
                              # Platzprüfung (#1627): Bei mehreren Staffeln je Liga N kommen mehr Teams an, als eine Staffel fasst.
                              "capacity": capacity(season, division, len(teams_here), before)})
    # Die Fassung des Endstands, aus der gerechnet wurde (Nachrichten nach „Übernahme neu berechnen“ tragen sie im Schlüssel).
    # Mit den Entscheiden über Staffeln hinweg (#1627): Ein neuer Entscheid ändert, wer wohin geht - „Übernahme neu berechnen“ merkt es.
    # Dazu die Fassungen der Relegation (F.6): Eine korrigierte Relegation ändert, wer wohin geht.
    stamp = hashlib.sha1("|".join(sorted(finals) + sorted(decided) + sorted(relegation_finals)).encode("utf-8")).hexdigest()[:12] if finals else ""
    return {"problems": problems, "divisions": out_divisions, "dropped": dropped, "carried": len(carried), "stamp": stamp,
            "relegation": bool(relegation_finals)}


def placed_levels(checked: dict) -> dict[str, int]:
    """In welcher Liga N der Folge-Season der Endstand jedes Co-Team sieht (``plan``) - auch eines, das es inzwischen nicht mehr gibt
    (``dropped`` mit ``target_level``). Daran hängt, ob ein frei gewordener Startplatz besteht (#1627, F.2a): an der Platzierung im
    Endstand, nicht am Co-Team. Ausgeschiedene und Disqualifizierte fehlen - sie haben keinen Platz."""
    out = {row["squad_id"]: row["target_level"] for row in checked["dropped"] if row.get("squad_id") and isinstance(row.get("target_level"), int)}
    out.update({team["squad_id"]: team["target_level"] for division in checked["divisions"] for team in division["teams"]})
    return out


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
        # Platzprüfung (#1627): je Liga N, die mit ihrer bisherigen Staffelzahl nicht auskommt, ein Satz - Hinweis statt stiller Überfüllung.
        "capacity_hints": [f"{row['label']}: {row['capacity']['text']}" for row in found["divisions"] if not row["capacity"]["fits"]],
        "dropped": found["dropped"],
        "carried": found["carried"],
        # Startrechte (#1627, F.2a): die Einstellung dieser Season als Vorgabe für die neue - ``settings: null`` heißt wie bisher.
        "start_rights": {"settings": league_start_right_rules.stored(season), "defaults": league_start_right_rules.defaults()},
        "relegation_note": RELEGATION_APPLIED if found.get("relegation") else
        "Relegationsplätze sind vorbereitet: Sie stehen farbig in der Tabelle, die Teams bleiben vorerst in ihrer Liga.",
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
    # Startrechte (#1627, F.2a): Die neue Season übernimmt die Einstellung des Vorgängers - oder nimmt sie aus dem Blatt entgegen.
    try:
        start_rights = league_start_right_rules.normalize(body["start_rights"]) if isinstance(body.get("start_rights"), dict) else None
    except league_start_right_rules.StartRightProblem as problem:
        raise SuccessorProblem(problem.detail) from None
    checked = await plan(db, season)
    if checked["problems"]:
        raise SuccessorProblem(checked["problems"][0], 409)
    copied = {key: value for key, value in season.items() if key not in NOT_COPIED and not key.endswith("_at")}

    async def take_over(doc: dict) -> None:
        # Die Vorgaben der neuen Season sind die des Vorgängers - die Kennung bleibt, Zeitraum und Stand sind neu (Nr. 161).
        doc.update(copied)
        if isinstance(doc.get(league_postseason_rules.FIELD), dict):
            # Playoffs und Relegation gehen als Einstellung mit - ihre Termine setzt die neue Season neu (Nr. 161).
            doc[league_postseason_rules.FIELD] = league_postseason_rules.without_dates(doc[league_postseason_rules.FIELD])
        doc.update({"predecessor_id": season["id"], "status": "draft", "visibility": "off",
                    "predecessor": {"id": season["id"], "name": season.get("name"), "number": season.get("number"), "slug": season.get("slug")}})
        if start_rights is not None:
            doc[league_start_right_rules.FIELD] = start_rights

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
        # Das Los der alten Season (#1623, ``draw``) und ihre Entscheide über Staffeln hinweg (#1627) gehören zu ihr und gehen nicht mit.
        copy = {key: value for key, value in row.items() if key not in ("_id", "id", "season_id", "created_at", "created_by", "updated_at", "draw", "zone_decisions", league_postseason.KEPT)}
        if isinstance(copy.get(league_postseason_rules.FIELD), dict):
            copy[league_postseason_rules.FIELD] = league_postseason_rules.without_dates(copy[league_postseason_rules.FIELD])
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
                     "division_level": division["level"], "division_label": division["label"],
                     **({"via": team["via"]} if team.get("via") else {}),
                     # Startrecht mit Zusage (#1627, F.2a): nur, wenn die neue Season es so einstellt - sonst wie bisher automatisch dabei.
                     **({"start_right": league_start_right_rules.offer()} if league_start_right_rules.needs_accept(doc) else {})}
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


async def _tell_captains(db, league: dict, season: dict, rows: list[dict], *, kind: str = "new", stamp: str = "",
                         gone: dict[str, str] | None = None) -> int:
    """„Ihr seid in Liga N der neuen Season, abmelden bis …“ an Captain und Vertreter - je Season, Co-Team und Person einmal, nach
    „Übernahme neu berechnen“ einmal je Fassung des Endstands (``stamp``). Danach steht ``carry_over.notified_at`` am Antrag.
    ``kind: "back"`` (#1627, F.2a): ein Nachrücker, dessen Platz nach dem korrigierten Endstand entfällt - ``gone`` nennt je Antrag
    die Liga N dieses Platzes."""
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
            how = " über die Relegation" if carry.get("via") == "relegation" else ""
            way = {"up": f" - Aufstieg{how} aus {carry['from_label']}", "down": f" - Abstieg{how} aus {carry['from_label']}"}.get(carry["movement"], "")
            offered = league_start_right_rules.accept_until(row, season) if (carry.get("start_right") or {}).get("status") == "offered" else None
            if kind == "revoked":
                headline = "Neue Season: Übernahme zurückgenommen"
                text = (f"Die Liga-Leitung hat den Endstand von {carry.get('from_season_name') or 'der Vorgänger-Season'} korrigiert. "
                        f"{row['display_name']} ist danach nicht mehr in {title}. Fragen beantwortet die Liga-Leitung.")
            elif kind == "back":
                # Wie jeder Rückfall eines Nachrückers (Nr. 260, Nr. 265): Die frühere Zusage gilt wieder, sonst die Restfrist.
                headline = "Neue Season: Nachrücken entfällt"
                right = carry.get("start_right") if isinstance(carry.get("start_right"), dict) else None
                if offered:
                    follow = (f"Eure Zusage dort ist noch offen: bitte bis {offered.astimezone(LOCAL_TZ).strftime('%d.%m.%Y, %H:%M Uhr')} "
                              f"zusagen: {where}. Ohne Zusage verfällt das Startrecht.")
                elif right:
                    follow = "Eure Zusage dort gilt weiter."
                else:
                    follow = f"Ihr seid automatisch dabei. Wer nicht mitspielen will, meldet sich bis zum Start ({day}) ab: {where}."
                text = (f"Die Liga-Leitung hat den Endstand von {carry.get('from_season_name') or 'der Vorgänger-Season'} korrigiert. "
                        f"Der Platz in {(gone or {}).get(row['id']) or 'der höheren Liga'} entfällt nach dem korrigierten Endstand. "
                        f"{row['display_name']} bleibt in {carry['division_label']} der neuen Season {title}. {follow}")
            elif offered:
                # Startrecht mit Zusage (#1627, F.2a): keine automatische Anmeldung - das Team sagt innerhalb der Frist zu.
                headline = "Neue Season: neue Liga" if kind == "moved" else "Neue Season: euer Startrecht"
                lead = (f"Die Liga-Leitung hat den Endstand von {carry.get('from_season_name') or 'der Vorgänger-Season'} korrigiert. "
                        if kind == "moved" else "")
                until = offered.astimezone(LOCAL_TZ).strftime("%d.%m.%Y, %H:%M Uhr")
                text = (f"{lead}{row['display_name']} hat ein Startrecht für {carry['division_label']} der neuen Season {title}{way}. "
                        f"Bitte bis {until} zusagen: {where}. Ohne Zusage verfällt das Startrecht. Es ist noch keine Anmeldung zu einer "
                        "Staffel und keine Zustimmung zum Regelwerk.")
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

CARRY_KEYS = ("from_label", "from_level", "from_staffel", "rank", "zone", "movement", "division_level", "via")
# Aufgegebene Anträge (#1627, F.2a): abgemeldet bzw. abgelehnt - auch verfallen; zurückgenommene tragen ``carry_over.revoked_at``.
GAVE_UP = ("withdrawn", "rejected")


def started(season: dict, now: datetime | None = None) -> bool:
    """Hat die neue Season begonnen? Im Entwurf nie, sonst ab ihrem ersten Tag - und einmal gestartet bleibt gestartet (#2404,
    Nr. 253, ``league_calendar.season_started``)."""
    from services import league_calendar

    return league_calendar.season_started(season, now or now_utc())


def _carry_of(season: dict, team: dict, division: dict | None, label: str) -> dict:
    return {"from_season_id": season["id"], "from_season_name": season.get("name"), "from_level": team["from_level"],
            "from_label": team["from_label"], "from_staffel": team.get("from_staffel"), "rank": team.get("rank"),
            "zone": team.get("zone"), "movement": team["movement"], "division_id": (division or {}).get("id"),
            "division_level": team["target_level"], "division_label": label, **({"via": team["via"]} if team.get("via") else {})}


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
    by_id = {row["id"]: row for row in rows}
    placed = placed_levels(checked)
    # Startrechte (#1627, F.2a) - nur mit der Einstellung der Season; ohne sie bleibt alles wie in Nr. 162. Ein aufgegebener Antrag
    # folgt dann seiner Platzierung, auch wenn es das Co-Team nicht mehr gibt (``dropped`` mit ``target_level``).
    rights_on = league_start_right_rules.stored(season) is not None
    labels = {division["level"]: division["label"] for division in checked["divisions"]}
    gone = {}
    for entry in checked["dropped"] if rights_on else []:
        if entry.get("squad_id") and isinstance(entry.get("target_level"), int):
            own = divisions.get(entry["target_level"])
            gone[entry["squad_id"]] = (entry, own, division_label(own) if own else labels.get(entry["target_level"], ""))
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
        # Ein Nachrücker (#1627, F.2a) steht mit Absicht in einer anderen Liga N: Sagt der Endstand für ihn dasselbe wie vor dem
        # Nachrücken, bleibt er, wo er ist - solange es den Platz noch gibt, auf den er nachgerückt war. Sieht der korrigierte
        # Endstand das abgemeldete Co-Team nicht mehr in dieser Liga N, geht der Nachrücker zurück (``moved``): Sonst stiege einer
        # zu viel auf.
        back = (carry.get("fills") or {}).get("back") if isinstance(carry.get("fills"), dict) else None
        if free and new and back and new["division_level"] == back.get("division_level"):
            if placed.get((by_id.get(carry["fills"].get("for_application_id")) or {}).get("squad_id")) == carry.get("division_level"):
                unchanged += 1
                continue
            # Rückfall wie bei jedem Nachrücker (Nr. 260, Nr. 265): frühere Zusage bzw. Restfrist statt einer neuen vollen Frist.
            changes.append({"kind": "moved", "application_id": row["id"], "squad_id": squad_id, "display_name": name,
                            "from_label": carry.get("division_label"), "to_label": wanted[2], "carry_over": new, "place_gone": True})
            continue
        if not free:
            # Aufgegeben (Entscheidung 26.11.): abgemeldet, verfallen oder von der Leitung abgelehnt - nicht zurückgenommen (oben) und
            # kein Nachrücker (dessen Antrag steht in der Liga des Platzes, auf den er nachgerückt war). Der Antrag folgt seiner
            # neuen Platzierung, in jeder Richtung; damit ist sein Platz dort frei, und es gilt die Nachrückerregel
            # (``released_places``). Er bleibt, was er ist: kein neues Angebot, keine Nachricht, kein Fall für „von Hand“.
            seen_at = (wanted or gone.get(squad_id)) if rights_on and row["status"] in GAVE_UP and not isinstance(carry.get("fills"), dict) else None
            if seen_at:
                place = _carry_of(predecessor, seen_at[0], seen_at[1], seen_at[2])
                if place["division_level"] != carry.get("division_level"):
                    changes.append({"kind": "place", "application_id": row["id"], "squad_id": squad_id, "display_name": name,
                                    "from_label": carry.get("division_label"), "to_label": seen_at[2], "carry_over": place,
                                    "status": row["status"]})
                else:
                    # Die Liga stimmt: Der Platz steht schon als frei oder vergeben da - auch wenn es das Co-Team nicht mehr gibt.
                    unchanged += 1
            elif not wanted or new["division_level"] != carry.get("division_level"):
                why = "zugeteilt" if row.get("assignment") else {"withdrawn": "abgemeldet"}.get(row["status"], "nicht mehr angenommen")
                fills = carry.get("fills") if isinstance(carry.get("fills"), dict) else None
                if row.get("assignment") and fills and placed.get((by_id.get(fills.get("for_application_id")) or {}).get("squad_id")) != carry.get("division_level"):
                    # Zugeteilter Nachrücker (#1627, F.2a), dessen Platz nach dem korrigierten Endstand entfallen ist: Die Leitung
                    # liest, warum er hier steht - er spielt in einer Liga N, für die es seinen Platz nicht mehr gibt.
                    why = "zugeteilt, der Nachrückplatz ist entfallen"
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
        rows = [row for change, row in done if change["kind"] == kind and not change.get("place_gone")]
        notified += await _tell_captains(db, league, fresh, rows, kind="moved" if kind in ("moved", "reactivated") else kind,
                                         stamp=found["stamp"]) if rows else 0
    # Nachrücker, deren Platz nach dem korrigierten Endstand entfällt (#1627, F.2a): eigene Nachricht mit dem Grund.
    back = [(change, row) for change, row in done if change.get("place_gone")]
    if back:
        notified += await _tell_captains(db, league, fresh, [row for _change, row in back], kind="back", stamp=found["stamp"],
                                         gone={row["id"]: change.get("from_label") for change, row in back})
    counts = {kind: len([1 for change, _row in done if change["kind"] == kind])
              for kind in ("moved", "updated", "added", "reactivated", "revoked", "place")}
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "league.season.successor.recompute", "actor_id": actor.get("id"), "target_id": fresh["id"],
        "data": {"predecessor_id": fresh["predecessor_id"], "stamp": found["stamp"], **counts, "manual": len(found["manual"])},
        "created_at": now_utc().isoformat()})
    return {"changed": len(done), **counts, "manual": found["manual"], "notified": notified, "stamp": found["stamp"],
            # Plätze, die wieder frei sind, weil ein Nachrücker zurückgenommen wurde (#1627, F.2a) - die Route lässt nachrücken.
            "released_places": sorted({key for change, _row in done for key in change.get("released") or []})}


async def _apply_recompute(db, season: dict, found: dict, actor: dict) -> list[tuple[dict, dict]]:
    from services.league_applications import ACCEPTED, REJECTED

    now = now_utc().isoformat()
    who = actor.get("id")
    done = []
    # Startrecht mit Zusage (#1627, F.2a): Wer neu dazukommt oder in eine andere Liga N wechselt, sagt (neu) zu - mit neuer Frist.
    fresh_right = {"start_right": league_start_right_rules.offer()} if league_start_right_rules.needs_accept(season) else {}
    for change in found["changes"]:
        kind = change["kind"]
        if kind == "added":
            team = change["team"]
            row = {
                "id": new_id(), "league_id": season["league_id"], "season_id": season["id"], "team_id": team["team_id"], "squad_id": team["squad_id"],
                "team_name": team.get("team_name"), "squad_name": team.get("squad_name"), "display_name": team["display_name"],
                "status": ACCEPTED, "active_key": f"{season['id']}:{team['squad_id']}", "applied_by": None, "submitted_at": now,
                "decided_by": who, "decided_at": now, "decision_reason": None, "carry_over": {**change["carry_over"], **fresh_right},
                "history": [{"status": ACCEPTED, "by": who, "at": now, "carry_over": True, "recomputed": True}], "created_at": now, "updated_at": now,
            }
            try:
                await db.league_applications.insert_one(dict(row))
            except DuplicateKeyError:
                continue
            done.append((change, row))
            continue
        query = {"id": change["application_id"]}
        if kind == "place":
            # Aufgegeben, und der korrigierte Endstand sieht das Co-Team in einer anderen Liga N: Der Antrag zeigt auf den Platz,
            # den es dort hätte. Wer auf seinem früheren Platz nachgerückt war, hält den neuen nicht (``filled_by`` fällt weg).
            query.update({"status": change["status"], "carry_over.revoked_at": {"$exists": False}})
            update = {"$set": {**{f"carry_over.{key}": value for key, value in change["carry_over"].items()}, "updated_at": now},
                      "$unset": {"carry_over.filled_by": ""},
                      "$push": {"history": {"status": change["status"], "by": who, "at": now, "carry_over": True, "recomputed": True}}}
        elif kind == "revoked":
            query.update({"status": ACCEPTED, "assignment": {"$exists": False}})
            update = {"$set": {"status": REJECTED, "decision_reason": REVOKED_REASON, "decided_by": who, "decided_at": now, "updated_at": now,
                               "carry_over.revoked_at": now, "carry_over.revoked_by": who},
                      # War es ein Nachrücker (#1627, F.2a), ist er es nicht mehr - sein Platz wird unten wieder frei.
                      "$unset": {"active_key": "", "carry_over.fills": ""},
                      "$push": {"history": {"status": REJECTED, "by": who, "at": now, "reason": REVOKED_REASON, "carry_over": True, "recomputed": True}}}
        elif kind == "reactivated":
            query.update({"status": REJECTED, "carry_over.revoked_at": {"$exists": True}})
            carry = {**change["carry_over"], **fresh_right}
            update = {"$set": {"status": ACCEPTED, "active_key": f"{season['id']}:{change['squad_id']}", "decision_reason": None, "decided_by": who,
                               "decided_at": now, "updated_at": now, "carry_over": carry},
                      "$push": {"history": {"status": ACCEPTED, "by": who, "at": now, "carry_over": True, "recomputed": True}}}
        else:
            query.update({"status": ACCEPTED, "assignment": {"$exists": False}})
            update = {"$set": {**{f"carry_over.{key}": value for key, value in change["carry_over"].items()}, "updated_at": now}}
            # Ein Nachrücker, für den der Endstand jetzt etwas anderes sagt als vor dem Nachrücken (sonst wäre er oben „unverändert“
            # geblieben): Er steht ab jetzt aus eigenem Recht dort, wo der Endstand ihn sieht - „Ablehnen“ führte sonst in die
            # falsche Liga. ``fills`` fällt weg, bei ``updated`` wie bei ``moved``.
            update["$unset"] = {"carry_over.fills": ""}
            if change.get("place_gone"):
                # Der Platz, auf den er nachgerückt war, entfällt: zurück auf das frühere Startrecht - Zusage bzw. Restfrist,
                # mindestens ``rest_days`` (``restored_right``, wie beim verstrichenen Nachrück-Angebot).
                before = await db.league_applications.find_one({"id": change["application_id"]}, {"_id": 0, "carry_over.fills": 1}) or {}
                own = league_start_right_rules.restored_right((before.get("carry_over") or {}).get("fills"), season, now_utc(), who, declined=False)
                if own is not None:
                    update["$set"]["carry_over.start_right"] = own
                else:
                    update["$unset"]["carry_over.start_right"] = ""
            elif kind == "moved":
                # Andere Liga N: Im Zusage-Modus gilt die alte Zusage nicht für die neue Liga.
                update["$set"].update({f"carry_over.{key}": value for key, value in fresh_right.items()})
        try:
            result = await db.league_applications.update_one(query, update)
        except DuplicateKeyError:
            continue
        if result.modified_count:
            if kind == "place":
                change["released"] = [change["application_id"]]
            if kind in ("revoked", "moved", "updated"):
                # War es ein Nachrücker (Entscheidung 26.11.) - zurückgenommen, in eine andere Liga N geschickt oder jetzt aus
                # eigenem Recht dort -, hält er den Platz nicht mehr, auf den er nachgerückt war: ``filled_by`` fällt weg. Ob es
                # diesen Platz nach dem korrigierten Endstand noch gibt und wer nachrückt, entscheidet ``fill_places``
                # (``league_start_rights``, die Route ruft es mit ``released_places`` auf).
                freed = await db.league_applications.find({"season_id": season["id"], "carry_over.filled_by.application_id": change["application_id"]},
                                                          {"_id": 0, "id": 1}).to_list(10)
                change["released"] = [row["id"] for row in freed]
                if freed:
                    await db.league_applications.update_many({"id": {"$in": change["released"]}}, {"$unset": {"carry_over.filled_by": ""}})
            done.append((change, await db.league_applications.find_one({"id": change["application_id"]}, {"_id": 0})))
    return done
