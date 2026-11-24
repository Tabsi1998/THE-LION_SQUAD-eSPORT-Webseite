"""Playoff- und Relegations-Staffeln aus dem Endstand (#2404, docs/LIGA.md „F.6 Playoffs und Relegation“; Entscheidungen Nr. 203-232).

Kein zweites System: Die Playoffs einer Liga N und die Relegation zweier benachbarter Liga N sind **eigene Staffel-Turniere** mit
``league_context.kind`` - angelegt über denselben Weg wie jede Staffel (``league_service.create_staffel``), gebaut mit dem K.-o.-Baum
des Turnierkerns (``custom_bracket.build_matches_v2_from_schema``), abgeschlossen mit ``league_final``.

- **Quelle ist der Endstand** (F.1): Setzliste und Paarungen lesen nur geltende Fassungen aus ``league_final_tables``, nie eine laufende
  Tabelle. Wie viele je Staffel kommen, sagt der Endstand selbst (``final.postseason``, Nr. 228).
- **Setzliste** (``postseason_seeding``): über Kreuz, verglichen mit ``league_cross_rank.ranked``. Gelost wird nur beim Anlegen, als
  letzter Schritt unter gleich stehenden Staffelsiegern (Nr. 225) - die Vorschau lost nie.
- **Unter der Season-Sperre** (Nr. 232): Anlegen und „Setzliste neu berechnen“ halten ``league_season_resource`` - dieselbe Sperre wie
  der Abschluss. Zwei Klicks legen eine Staffel an, nie zwei; dazu hält der eindeutige Index ``league_staffel`` je Liga N höchstens
  eine ``PO`` und eine ``REL``.
- **Relegation** (Nr. 212, 222): die Relegationsplätze unten der oberen Liga N gegen die oben der unteren, das obere Team hat
  Heimrecht. Sie liegt automatisch hinter dem Ende der Playoffs der unteren Liga N.

Einstellungen: ``league_postseason_rules``. Was im Endstand dieser Staffeln steht: ``league_postseason_final``.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from models import REGISTRATION_LIMIT, new_id, now_utc
from services import league_cross_zones, league_permissions, league_zones, map_pools
from services import league_postseason_final as finals_mod
from services import league_postseason_rules as rules
from services import league_veto_rules as veto_rules
from services import postseason_seeding as seeding
from services.advancement_draw import DRAW_RNG
from services.league_final_read import is_closed
from services.league_scope import KIND_LABELS, ONLY_LEAGUE, PLAYOFF, RELEGATION, STAFFEL_CODES, staffel_kind
from services.log_safe import log_safe
from services.mutation_lock import MutationLockBusy, league_season_resource, mutation_lock
from services.station_runtime import free_stations_of_deleted_matches

logger = logging.getLogger("tls.league_postseason")

CAPABILITY = "season"
LOCK_WAIT_SECONDS = 10.0
REASON_MIN, REASON_MAX = 5, 500
VIA = "league_postseason"
VETO_FIELD = "veto_by_best_of"
ACTIVE = ("approved", "checked_in")

BUSY = "In dieser Season wird gerade eine Staffel abgeschlossen oder angelegt. Bitte erneut versuchen."
CONFIRM = "Bitte das Anlegen bestätigen."
STAMP_CHANGED = "Der Endstand hat sich inzwischen geändert - bitte die Vorschau neu laden."
NOT_ENABLED = {PLAYOFF: "In dieser Liga sind keine Playoffs eingeschaltet.", RELEGATION: "Für diese Liga ist keine Relegation eingeschaltet."}
NO_DIVISION = "Diese Liga gibt es nicht."
NO_LOWER = "Unter dieser Liga gibt es keine weitere Liga - eine Relegation braucht zwei benachbarte Ligen."
NO_STAFFELN = "{label} hat noch keine reguläre Staffel."
REGULAR_OPEN = "Erst alle regulären Staffeln von {label} abschließen ({closed} von {total} abgeschlossen)."
NO_SNAPSHOT = ("Die Staffeln von {label} wurden abgeschlossen, bevor die Playoffs eingeschaltet waren. Bitte wieder öffnen und neu "
               "abschließen - der Endstand hält fest, wer in die Playoffs kommt.")
TOO_FEW = ("Für Playoffs braucht es mindestens zwei qualifizierte Teams - in {label} {verb} es {count}. Diese Liga spielt darum keine "
           "Playoffs; für den Abschluss der Season zählt sie als „ohne Playoffs“.")
TOO_FEW_HINT = ("In {label} kommen mit {per} {per_word} je Staffel und {count} {staffel_word} weniger als zwei Teams zusammen. Dort gibt es "
                "keine Playoffs - der Meister kommt aus der Tabelle, die Season wartet nicht darauf.")
START_LOCKED = ("Seit dem Season-Start stehen Best of, Spiel um Platz 3 und Heimrecht der Playoffs fest ({label}). Das gilt auch nach "
                "einem Wiederöffnen.")
NO_RETRY = "Dieses Spiel wurde nicht neu angesetzt."
OUT_FINAL = "Beide sind schon ausgeschieden - das lässt sich nicht zurücknehmen."
LOCKED = ("In {label} ist schon eine Staffel abgeschlossen. Playoffs an/aus, Plätze je Staffel und Relegation an/aus lassen sich dann "
          "nicht mehr ändern - erst alle Staffeln dieser Liga wieder öffnen.")
CHAMPION_LOCKED = ("In der obersten Liga ist schon eine Staffel abgeschlossen. „Meister aus“ lässt sich dann nicht mehr ändern - erst "
                   "alle Staffeln dieser Liga wieder öffnen.")
CHAMPION_NEEDS_PLAYOFFS = "Meister aus Playoffs braucht Playoffs in der obersten Liga."
NO_RELEGATION_PLACES = ("Relegation zwischen {upper} und {lower}: In {upper} ist kein Relegationsplatz unten eingestellt oder in {lower} "
                        "keiner oben. Bitte zuerst die Zonen im Reiter „Ligen und Staffeln“ setzen.")
PLAYED = "In dieser Staffel ist schon ein Spiel gespielt. Die Setzliste lässt sich dann nicht mehr neu berechnen."
CLOSED = "Diese Staffel ist abgeschlossen."
NOT_POSTSEASON = "Das gibt es nur in einer Playoff- oder Relegations-Staffel."
REASON_NEEDED = f"Bitte einen Grund angeben (mindestens {REASON_MIN} Zeichen) - er steht im Protokoll."
OWN_TEAM = "Du gehörst zu einem Team dieser Liga. Anlegen und neu setzen muss eine andere Person."
OWN_TEAM_SUPERADMIN = ("Du gehörst zu einem Team dieser Liga. Als Superadmin geht es nur als Notausnahme, mit einem Grund von "
                       "mindestens fünf Zeichen.")
REOPEN_BLOCKED = ("In {label} ist schon ein Spiel gespielt. In dieser Season ist das Wiederöffnen einer regulären Staffel dann gesperrt "
                  "(Einstellung „Wiederöffnen nach dem Start der Playoffs“).")
VETO_NOTE = "Veto für Best of {best_of}: {problem}"
STALE_NOTE = ("Der Endstand hat sich seit dem Anlegen geändert. Die Staffel spielt mit ihrer Setzliste weiter - nur „Setzliste neu "
              "berechnen“ ändert sie, und das geht nur vor dem ersten gespielten Spiel.")


class PostseasonProblem(rules.PostseasonProblem):
    """Eine Anfrage, die nicht passt - mit deutscher Meldung und HTTP-Status."""


def _reason(value) -> str:
    text = " ".join(str(value or "").split())
    if len(text) < REASON_MIN:
        raise PostseasonProblem(REASON_NEEDED)
    return text[:REASON_MAX]


def _label(division: dict) -> str:
    from services.league_service import division_label

    return division_label(division) if division.get("level") is not None else "Liga"


def _best_of(season: dict, division: dict | None) -> int:
    from services.league_service import effective_settings

    return int(effective_settings(season, division).get("best_of") or 1)


def settings_of(season: dict, division: dict | None) -> dict:
    """Was in dieser Liga N gilt - Vorlage der Season, Abweichung der Liga N, Vorgabe Best of der Liga N."""
    return rules.effective(season, division, _best_of(season, division))


async def _divisions(db, season_id: str) -> list[dict]:
    rows = await db.league_divisions.find({"season_id": season_id}, {"_id": 0}).sort("level", 1).to_list(50)
    return [row for row in rows if row.get("status") != "archived" and isinstance(row.get("level"), int)]


def _lower(divisions: list[dict], division: dict) -> dict | None:
    below = [row for row in divisions if row["level"] > division["level"]]
    return min(below, key=lambda row: row["level"]) if below else None


async def _stored(db, division_id: str, kind: str) -> dict | None:
    """Das Staffel-Turnier dieser Art, wie es in der Datenbank steht - auch ein unfertiges."""
    return await db.tournaments.find_one({"league_context.division_id": division_id, "league_context.staffel": STAFFEL_CODES[kind],
                                          "league_context.kind": kind, **ONLY_LEAGUE}, {"_id": 0})


async def _existing(db, division_id: str, kind: str) -> dict | None:
    """Die angelegte Playoff- bzw. Relegations-Staffel. Eine Staffel **ohne Phase** ist nicht angelegt, sondern unfertig (der Prozess
    endete mitten im Bau): Sie zählt nirgends als vorhanden, das nächste Anlegen räumt sie weg und baut neu."""
    row = await _stored(db, division_id, kind)
    if row and not await db.tournament_stages.find_one({"tournament_id": row["id"]}, {"_id": 1}):
        return None
    return row


async def _finals(db, staffeln: list[dict]) -> dict[str, dict]:
    done = [row["id"] for row in staffeln if is_closed(row)]
    if not done:
        return {}
    rows = await db.league_final_tables.find({"tournament_id": {"$in": done}, "active": True}, {"_id": 0}).to_list(len(done) + 1)
    return {row["tournament_id"]: row for row in rows}


# ---------------------------------------------------------------- Kennzeichen in der Tabelle, Sperrgrund an der Grenze

async def places_for(db, tournament: dict | None) -> int:
    """Wie viele Teams dieser regulären Staffel in die Playoffs kommen - 0 ohne Playoffs. Ohne Einstellung kostet das zwei kleine
    Abfragen (Season und Liga N, je nur das Feld ``postseason``)."""
    context = (tournament or {}).get("league_context") or {}
    if not context.get("season_id") or context.get("kind"):
        return 0
    season = await db.league_seasons.find_one({"id": context["season_id"]}, {"_id": 0, rules.FIELD: 1, "best_of": 1})
    if not rules.any_enabled(season) and not await _division_has(db, context.get("division_id")):
        return 0
    division = await db.league_divisions.find_one({"id": context.get("division_id")}, {"_id": 0, rules.FIELD: 1}) if context.get("division_id") else None
    found = rules.effective(season, division)
    return int(found["playoffs"]["per_staffel"] or 0) if found["playoffs"]["enabled"] else 0


async def _division_has(db, division_id: str | None) -> bool:
    if not division_id:
        return False
    return bool(await db.league_divisions.find_one({"id": division_id, rules.FIELD: {"$type": "object"}}, {"_id": 1}))


async def mark_rows(db, tournament: dict | None, rows: list[dict]) -> list[dict]:
    """Die laufende Tabelle einer regulären Staffel bekommt das Kennzeichen „Playoff-Platz“ - andere Turniere bleiben, wie sie sind."""
    places = await places_for(db, tournament)
    return seeding.mark(rows, places) if places else rows


async def close_snapshot(db, season: dict, division: dict) -> dict | None:
    """Was der Endstand einer regulären Staffel festhält (Nr. 228): Plätze je Staffel und „Meister aus“ - ``None``, wenn nichts davon gilt."""
    found = settings_of(season, division)
    out = {}
    if found["playoffs"]["enabled"]:
        out["per_staffel"] = int(found["playoffs"]["per_staffel"])
    if found["champion_source"] == rules.PLAYOFFS:
        # Nur, wenn die oberste Liga N wirklich Playoffs spielen kann - sonst bleibt der Meister bei der Tabelle (``champion_from_playoffs``).
        divisions = await _divisions(db, season["id"])
        if await champion_from_playoffs(db, season, divisions[0] if divisions else None):
            out["champion_source"] = rules.PLAYOFFS
    return out or None


async def playoffs_feasible(db, season: dict | None, division: dict | None) -> bool:
    """Kommen in dieser Liga N überhaupt zwei Playoff-Teams zusammen (Plätze je Staffel mal reguläre Staffeln)? Sonst spielt sie keine
    Playoffs - für Abschluss und Meister gilt sie als „ohne Playoffs“. Aus den Einstellungen und der Zahl der Staffeln, damit es schon
    beim Abschluss der ersten Staffel feststeht."""
    if not season or not division or not division.get("id"):
        return False
    settings = settings_of(season, division)
    if not settings["playoffs"]["enabled"]:
        return False
    staffeln = await league_cross_zones.staffeln_of(db, division["id"])
    return int(settings["playoffs"].get("per_staffel") or 0) * len(staffeln) >= 2


async def champion_from_playoffs(db, season: dict | None, top_division: dict | None = None) -> bool:
    """Kommt der Meister aus den Playoffs? Nur, wenn die Season das sagt **und** die oberste Liga N Playoffs spielen kann - mit weniger
    als zwei Playoff-Teams bleibt es beim Meister aus der Tabelle (sonst gäbe es keinen)."""
    if rules.stored(season)["champion_source"] != rules.PLAYOFFS:
        return False
    return await playoffs_feasible(db, season, top_division)


def season_started(season: dict | None, now=None) -> bool:
    """Hat die Season begonnen? Im Entwurf nie, sonst ab dem Beginn der ersten Spielwoche."""
    if not season or (season.get("status") or "draft") == "draft":
        return False
    from services.league_calendar import aware

    start = aware(season.get("start_date"))
    return bool(start and (now or now_utc()) >= start)


# ---------------------------------------------------------------- Plan: Setzliste und Paarungen

async def _gone(db, staffeln: list[dict], existing: dict | None) -> set[str]:
    """Wer seit dem Abschluss ausgeschieden ist: in der regulären Staffel oder schon in der Playoff-Staffel (über die Herkunft)."""
    out: set[str] = set()
    ids = [row["id"] for row in staffeln]
    if ids:
        async for row in db.tournament_registrations.find({"tournament_id": {"$in": ids}, "status": {"$in": sorted(finals_mod.GONE)}},
                                                          {"_id": 0, "id": 1}):
            out.add(row["id"])
    if existing:
        async for row in db.tournament_registrations.find({"tournament_id": existing["id"], "status": {"$in": sorted(finals_mod.GONE)}},
                                                          {"_id": 0, "postseason.from_registration_id": 1}):
            origin = (row.get("postseason") or {}).get("from_registration_id")
            if origin:
                out.add(origin)
        # Wer schon einmal beim Neuberechnen herausfiel, bleibt draußen: Die Anmeldung von damals gibt es nicht mehr (``reseed`` baut
        # die Staffel neu) - der Schnappschuss merkt es sich.
        out |= {str(item) for item in (existing.get(rules.FIELD) or {}).get("gone") or [] if item}
    return out


def _blocker(code: str, label: str, text: str) -> dict:
    return {"code": code, "label": label, "text": text}


async def _regular_frame(db, division: dict) -> dict:
    staffeln = await league_cross_zones.staffeln_of(db, division["id"])
    finals = await _finals(db, staffeln)
    closed = [row for row in staffeln if is_closed(row) and row["id"] in finals]
    label = _label(division)
    blockers = []
    if not staffeln:
        blockers.append(_blocker("no_staffeln", "Keine reguläre Staffel", NO_STAFFELN.format(label=label)))
    elif len(closed) < len(staffeln):
        blockers.append(_blocker("regular_open", "Reguläre Staffeln noch offen",
                                 REGULAR_OPEN.format(label=label, closed=len(closed), total=len(staffeln))))
    tables = [{"tournament_id": row["id"], "staffel": row["league_context"].get("staffel"), "title": row.get("title"),
               "rows": finals[row["id"]].get("rows") or [], "final": finals[row["id"]]} for row in staffeln if row["id"] in finals]
    return {"staffeln": staffeln, "finals": finals, "closed": closed, "tables": tables, "blockers": blockers, "label": label}


def _lot(previous: list[dict] | None, counter: list[int]):
    """Das Los unter Gleichen (Nr. 225): Steht dieselbe Gruppe schon im Schnappschuss, gilt ihre Reihenfolge weiter - sonst wird gelost
    und gezählt."""
    def lot(group: list[dict]) -> list[dict]:
        by_id = {row["registration_id"]: row for row in group}
        for draw in previous or []:
            if sorted(draw.get("registration_ids") or []) == sorted(by_id) and sorted(draw.get("order") or []) == sorted(by_id):
                return [by_id[key] for key in draw["order"]]
        ordered = list(group)
        DRAW_RNG.shuffle(ordered)
        counter[0] += 1
        return ordered
    return lot


async def playoff_plan(db, season: dict, division: dict, *, lot=None, existing: dict | None = None) -> dict:
    """Die Setzliste einer Liga N aus ihren Endständen - liest nur. ``blockers``: was dem Anlegen entgegensteht."""
    frame = await _regular_frame(db, division)
    blockers = list(frame["blockers"])
    per = 0
    if not blockers:
        snapshots = {int(((table["final"].get(rules.FIELD) or {}).get("per_staffel")) or 0) for table in frame["tables"]}
        if len(snapshots) != 1 or 0 in snapshots:
            blockers.append(_blocker("no_snapshot", "Endstand ohne Playoff-Plätze", NO_SNAPSHOT.format(label=frame["label"])))
        else:
            per = snapshots.pop()
    gone = await _gone(db, frame["staffeln"], existing) if not blockers else set()
    found = seeding.seed(frame["tables"], per, gone=gone, lot=lot) if not blockers else {"seeds": [], "order": [], "open_lot": [], "draws": [], "swaps": 0}
    if not blockers and len(found["seeds"]) < 2:
        count = len(found["seeds"])
        blockers.append(_blocker("too_few", "Zu wenige Teams", TOO_FEW.format(label=frame["label"], count=count, verb="ist" if count == 1 else "sind")))
    stamp = seeding.stamp([table["final"]["id"] for table in frame["tables"]], per, *sorted(gone)) if not frame["blockers"] else ""
    return {**found, "per_staffel": per, "blockers": blockers, "stamp": stamp, "frame": frame, "gone": sorted(gone)}


async def relegation_plan(db, season: dict, upper: dict, lower: dict | None, *, lot=None) -> dict:
    """Die Paarungen der Relegation zwischen ``upper`` und der Liga N darunter - liest nur."""
    if not lower:
        return {"pairs": [], "blockers": [_blocker("no_lower", "Keine Liga darunter", NO_LOWER)], "stamp": "", "open_lot": [], "draws": [],
                "frames": None}
    top, bottom = await _regular_frame(db, upper), await _regular_frame(db, lower)
    blockers = [*top["blockers"], *bottom["blockers"]]
    found = {"pairs": [], "problem": None, "open_lot": [], "draws": []}
    if not blockers:
        found = seeding.relegation_pairs(top["tables"], bottom["tables"], lot=lot, upper_label=top["label"], lower_label=bottom["label"])
        if found["problem"]:
            blockers.append(_blocker("not_matching", "Relegation geht nicht auf", found["problem"]))
    stamp = seeding.stamp([table["final"]["id"] for table in [*top["tables"], *bottom["tables"]]], "rel") if not blockers or found.get("problem") else ""
    return {"pairs": found["pairs"], "open_lot": found["open_lot"], "draws": found["draws"], "blockers": blockers, "stamp": stamp,
            "frames": (top, bottom)}


# ---------------------------------------------------------------- Kalender (Nr. 208, 222)

def _playoff_weeks(season: dict, settings: dict, count: int) -> dict:
    total = seeding.rounds(count) if count >= 2 else 0
    return rules.weeks(season, rules.start_of(settings["playoffs"], season), total)


async def _team_estimate(db, division: dict, settings: dict) -> int:
    """Wie viele Teams die Playoffs dieser Liga N voraussichtlich haben: Plätze je Staffel mal reguläre Staffeln (mindestens eine)."""
    staffeln = await league_cross_zones.staffeln_of(db, division["id"])
    return int(settings["playoffs"].get("per_staffel") or 0) * max(len(staffeln), 1)


async def playoff_end_day(db, season: dict, division: dict, *, count: int | None = None) -> date | None:
    """Der letzte Tag der Playoffs dieser Liga N - aus der angelegten Staffel, sonst gerechnet. ``None`` ohne Playoffs."""
    settings = settings_of(season, division)
    if not settings["playoffs"]["enabled"]:
        return None
    existing = await _existing(db, division["id"], PLAYOFF)
    if existing and existing.get("end_date"):
        return rules.local_day(existing["end_date"])
    if not existing and division["id"] in await too_few_hints(db, season, [division]):
        # Keine zwei Playoff-Teams: Diese Liga N spielt keine Playoffs - also wartet auch die Relegation auf keine.
        return None
    teams = count if count is not None else await _team_estimate(db, division, settings)
    end = _playoff_weeks(season, settings, max(teams, 2))["end_day"]
    return date.fromisoformat(end) if end else None


async def relegation_week(db, season: dict, upper: dict, lower: dict | None) -> dict:
    """Die Woche der Relegation (Nr. 222, 246): frühestens der eingestellte Tag, **immer hinter den Playoffs beider Ligen** - der
    oberen und der unteren. So spielt kein Team in einer Woche zweimal, auch wenn die untere Liga keine Playoffs hat. Ohne Playoffs in
    beiden beginnt sie nach der regulären Season."""
    settings = settings_of(season, upper)
    wanted = rules.start_of({"start_date": settings["relegation"].get("start_date")}, season)
    ends = [(await playoff_end_day(db, season, division), division) for division in (upper, lower) if division]
    after = [(day, division) for day, division in ends if day]
    behind = max((day for day, _division in after), default=None)
    start = wanted
    moved = False
    if behind and (start is None or start <= behind):
        start, moved = behind + timedelta(days=1), bool(settings["relegation"].get("start_date"))
    found = rules.weeks(season, start, 1)
    return {**found, "after_playoffs_of": " und ".join(_label(division) for _day, division in after) or None, "moved": moved}


async def refresh_season_end(db, season_id: str | None) -> str | None:
    """Das Ende der Season einschließlich Playoffs und Relegation an der Season (V1): Sperren und Nachweise enden nicht vor den
    Playoffs. Ohne eingeschaltete Playoffs und Relegation fällt das Feld weg."""
    if not season_id:
        return None
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        return None
    divisions = await _divisions(db, season_id)
    last: date | None = None
    for division in divisions:
        settings = settings_of(season, division)
        ends = [await playoff_end_day(db, season, division)]
        if settings["relegation"]["enabled"]:
            existing = await _existing(db, division["id"], RELEGATION)
            if existing and existing.get("end_date"):
                ends.append(rules.local_day(existing["end_date"]))
            else:
                week = await relegation_week(db, season, division, _lower(divisions, division))
                ends.append(date.fromisoformat(week["end_day"]) if week["end_day"] else None)
        for day in ends:
            if day and (last is None or day > last):
                last = day
    value = rules.day_end_iso(last) if last else None
    if value != season.get(rules.END_FIELD):
        await db.league_seasons.update_one({"id": season_id}, {"$set": {rules.END_FIELD: value}} if value else {"$unset": {rules.END_FIELD: ""}})
    return value


# ---------------------------------------------------------------- Einstellungen speichern

async def _closed_divisions(db, season_id: str) -> set[str]:
    """Die Liga N, in denen schon eine reguläre Staffel abgeschlossen ist (Nr. 228)."""
    rows = await db.tournaments.find({"league_context.season_id": season_id, "final_table": {"$type": "object"}, **ONLY_LEAGUE},
                                     {"_id": 0, "league_context": 1}).to_list(500)
    return {row["league_context"].get("division_id") for row in rows if not row["league_context"].get("kind")}


def _play_key(found: dict) -> tuple:
    """Was ab dem Season-Start feststeht (Nr. 249): Best of (auch je Runde), Spiel um Platz 3 und Heimrecht der Playoffs."""
    playoffs = found["playoffs"]
    return (int(playoffs.get("best_of") or 0), tuple((int(row["round"]), int(row["best_of"])) for row in playoffs.get("best_of_rounds") or []),
            bool(playoffs.get("third_place")), playoffs.get("home"))


async def too_few_hints(db, season: dict, divisions: list[dict]) -> dict[str, str]:
    """Je Liga N mit eingeschalteten Playoffs, in der keine zwei Teams zusammenkommen: der Satz dazu. Eine Liga N ohne Staffel bekommt
    keinen - dort steht noch nicht fest, wie viele es werden."""
    out = {}
    for division in divisions:
        settings = settings_of(season, division)
        if not settings["playoffs"]["enabled"]:
            continue
        count = len(await league_cross_zones.staffeln_of(db, division["id"]))
        per = int(settings["playoffs"].get("per_staffel") or 0)
        if count and per * count < 2:
            out[division["id"]] = TOO_FEW_HINT.format(label=_label(division), per=per, per_word="Platz" if per == 1 else "Plätzen",
                                                       count=count, staffel_word="Staffel" if count == 1 else "Staffeln")
    return out


async def _check_settings(db, season: dict, divisions: list[dict], before: dict[str, dict]) -> list[str]:
    """Die Prüfungen über Liga N hinweg: Sperre ab dem ersten Abschluss (Nr. 228), Sperre ab dem Season-Start (Nr. 249), „Meister aus
    Playoffs“ braucht Playoffs oben, Relegation braucht Plätze auf beiden Seiten. Gibt Hinweise zurück, die das Speichern nicht
    aufhalten (zu wenige Playoff-Teams)."""
    closed = await _closed_divisions(db, season["id"])
    levels = [row["level"] for row in divisions]
    after = {row["id"]: settings_of(season, row) for row in divisions}
    for division in divisions:
        if division["id"] in closed and rules.sport_key(after[division["id"]]) != rules.sport_key(before[division["id"]]):
            raise PostseasonProblem(LOCKED.format(label=_label(division)), 409)
    if season_started(season):
        # Ohne Blick auf an/aus (Nr. 249): Die Werte stehen auch im Zustand „aus“ fest. Wer die Playoffs nach dem Start aus- und
        # wieder einschaltet oder erst einschaltet, bekommt die Werte vom Start - bzw. die Vorgaben, wenn es vorher keine gab.
        for division in divisions:
            if _play_key(before[division["id"]]) != _play_key(after[division["id"]]):
                raise PostseasonProblem(START_LOCKED.format(label=_label(division)))
    top = divisions[0] if divisions else None
    source = rules.stored(season)["champion_source"]
    if top and source != before[top["id"]]["champion_source"] and top["id"] in closed:
        raise PostseasonProblem(CHAMPION_LOCKED, 409)
    if source == rules.PLAYOFFS and not (top and after[top["id"]]["playoffs"]["enabled"]):
        raise PostseasonProblem(CHAMPION_NEEDS_PLAYOFFS)
    for division in divisions:
        if not after[division["id"]]["relegation"]["enabled"]:
            continue
        lower = _lower(divisions, division)
        if not lower:
            # Die unterste Liga N (F.2, keine Relegation nach unten): Eine Vorlage der Season mit Relegation gilt für sie einfach nicht.
            continue
        down = league_zones.effective(division, levels).get("playoff_relegate") or 0
        up = league_zones.effective(lower, levels).get("playoff_promote") or 0
        if not down or not up:
            raise PostseasonProblem(NO_RELEGATION_PLACES.format(upper=_label(division), lower=_label(lower)))
        upper_count = len(await league_cross_zones.staffeln_of(db, division["id"]))
        lower_count = len(await league_cross_zones.staffeln_of(db, lower["id"]))
        if upper_count and lower_count and down * upper_count != up * lower_count:
            raise PostseasonProblem(seeding.ADD_UP.format(
                upper=down * upper_count, upper_word="Team" if down * upper_count == 1 else "Teams", upper_label=_label(division),
                lower=up * lower_count, lower_word="Team" if up * lower_count == 1 else "Teams", lower_label=_label(lower)))
    return list((await too_few_hints(db, season, divisions)).values())


async def _audit(db, action: str, season_id: str, actor: dict, **data) -> None:
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": actor.get("id"), "target_id": season_id,
                                    "data": data, "created_at": now_utc().isoformat()})


async def save_season(db, season: dict, body: dict, actor: dict) -> dict:
    """Die Vorlage der Season speichern - unter der Season-Sperre, mit allen Prüfungen."""
    try:
        async with mutation_lock(db, league_season_resource(season["id"]), wait_seconds=LOCK_WAIT_SECONDS):
            fresh = await db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})
            divisions = await _divisions(db, fresh["id"])
            before = {row["id"]: settings_of(fresh, row) for row in divisions}
            cleaned = rules.clean_season(body, fresh)
            warnings = await _check_settings(db, {**fresh, rules.FIELD: cleaned}, divisions, before)
            await db.league_seasons.update_one({"id": fresh["id"]}, {"$set": {rules.FIELD: cleaned, "updated_at": now_utc().isoformat()}})
    except MutationLockBusy:
        raise PostseasonProblem(BUSY, 409) from None
    await refresh_season_end(db, season["id"])
    await _audit(db, "league.postseason.settings", season["id"], actor, scope="season", settings=cleaned)
    return {"settings": cleaned, "warnings": warnings}


async def save_division(db, division: dict, body: dict, actor: dict) -> dict | None:
    """Die Abweichung einer Liga N speichern - ein leerer Körper heißt „wie die Season“."""
    from services.league_service import effective_settings

    try:
        async with mutation_lock(db, league_season_resource(division["season_id"]), wait_seconds=LOCK_WAIT_SECONDS):
            season = await db.league_seasons.find_one({"id": division["season_id"]}, {"_id": 0})
            divisions = await _divisions(db, season["id"])
            before = {row["id"]: settings_of(season, row) for row in divisions}
            fresh = next((row for row in divisions if row["id"] == division["id"]), None)
            if not fresh:
                raise PostseasonProblem(NO_DIVISION, 404)
            cleaned = rules.clean_division(body, season, staffel_size=effective_settings(season, fresh).get("max_staffel_size"))
            changed = [({**row, rules.FIELD: cleaned} if cleaned else {key: value for key, value in row.items() if key != rules.FIELD})
                       if row["id"] == fresh["id"] else row for row in divisions]
            warnings = await _check_settings(db, season, changed, before)
            await db.league_divisions.update_one({"id": fresh["id"]}, {"$set": {rules.FIELD: cleaned, "updated_at": now_utc().isoformat()}}
                                                 if cleaned else {"$unset": {rules.FIELD: ""}, "$set": {"updated_at": now_utc().isoformat()}})
    except MutationLockBusy:
        raise PostseasonProblem(BUSY, 409) from None
    await refresh_season_end(db, division["season_id"])
    await _audit(db, "league.postseason.settings", division["season_id"], actor, scope="division", division_id=division["id"], settings=cleaned)
    return {"settings": cleaned, "warnings": warnings}


# ---------------------------------------------------------------- Befangenheit

async def _own_team(db, user: dict | None, staffeln: list[dict]) -> bool:
    """Gehört die Person zu einem Team dieser Staffeln (Befangenheit wie beim Abschluss, B.1)? Hier noch einmal statt aus
    ``league_final`` - das liest dieses Modul, nicht umgekehrt (kein Import-Kreis)."""
    ids = [row["id"] for row in staffeln if row.get("id")]
    if not user or not ids:
        return False
    registrations = await db.tournament_registrations.find({"tournament_id": {"$in": ids}}, {"_id": 0}).to_list(REGISTRATION_LIMIT)
    teams = await league_permissions.teams_by_id(db, registrations)
    return any(row.get("id") and league_permissions.belongs_to_side(user, row, teams.get(row.get("team_id") or "")) for row in registrations)


async def _conflict_override(db, user: dict, staffeln: list[dict], conflict_reason) -> str | None:
    """403, wenn die Person zu einem Team dieser Liga N gehört - der Superadmin nur als Notausnahme mit Grund."""
    conflict = ({"kind": league_permissions.CONFLICT_INVOLVED, "override": league_permissions.is_superadmin(user)}
                if await _own_team(db, user, staffeln) else None)
    return league_permissions.override_reason(conflict, conflict_reason, detail=OWN_TEAM, superadmin_detail=OWN_TEAM_SUPERADMIN)


# ---------------------------------------------------------------- Staffel bauen

def _stage(tournament: dict, kind: str, actor: dict, *, schema: str | None = None) -> dict:
    now = now_utc().isoformat()
    settings = {"match_size": 2, "min_players": 2, "qualifiers_per_match": 1, "score_type": "points", "calculation": "points"}
    if schema:
        settings["schema"] = schema
    return {"id": new_id(), "tournament_id": tournament["id"], "name": KIND_LABELS[kind], "number": 1,
            "stage_type": "custom_bracket" if schema else "single_elimination", "match_type": "duel", "settings": settings,
            "status": "ready", "created_at": now, "updated_at": now, "created_by": actor.get("id")}


def _registration(tournament: dict, source: dict, seed: int, origin: dict, actor: dict) -> dict:
    """Die Anmeldung eines Co-Teams in der Playoff- bzw. Relegations-Staffel: Setzplatz und Herkunft, **ohne** ``league_squad_key`` -
    das Co-Team spielt ja schon in seiner regulären Staffel (H1). Kader, Spiel-IDs und Sperren hängen an der Season und gelten weiter."""
    now = now_utc().isoformat()
    tid = tournament["id"]
    name = source.get("display_name") or source.get("team_name") or "Team"
    who = f"squad:{source['squad_id']}" if source.get("squad_id") else f"reg:{source['id']}"
    return {
        "id": new_id(), "tournament_id": tid, "user_id": None, "team_id": source.get("team_id"), "squad_id": source.get("squad_id"),
        "squad_name": source.get("squad_name"), "status": "approved", "display_name": name, "ingame_name": source.get("ingame_name") or name,
        "player_ids": {}, "accepted_rules": bool(source.get("accepted_rules")), "accepted_privacy": bool(source.get("accepted_privacy")),
        "seed": seed, "registration_type": "team", "registered_via": VIA, "registered_by": actor.get("id"), "source": "staff_add",
        "is_guest": False, "identity_key": f"{tid}:team:{source.get('team_id')}:{who}",
        "postseason": origin, "created_by": actor.get("id"), "created_at": now, "updated_at": now,
    }


async def _sources(db, registration_ids: list[str]) -> dict[str, dict]:
    rows = await db.tournament_registrations.find({"id": {"$in": registration_ids}}, {"_id": 0}).to_list(REGISTRATION_LIMIT)
    return {row["id"]: row for row in rows}


async def _veto(db, tournament: dict, best_ofs: list[int], home: str) -> tuple[dict, list[str]]:
    """Die Veto-Vorlagen der Staffel (Nr. 207, 209): je vorkommendem Best of eine eigene, ohne „Vorgabe der Woche“. Passt die Vorlage
    der Season zum Best of und hat sie keine Vorgabe, bleibt sie; sonst schlägt das System eine vor (``league_veto_rules.propose``).
    Gibt die Felder fürs Turnier zurück und Hinweise, wo eine Vorlage nicht passt - still übersprungen wird kein Veto."""
    from services import league_games

    base = veto_rules.rules_of(tournament)
    if not base:
        return {}, []
    pool = await map_pools.effective_pool(db, tournament)
    by, notes = _veto_templates(base, pool, league_games.effective_mode_order(tournament, pool), league_games.map_repeat_of(tournament), best_ofs, home)
    main = by.get(str(int(tournament.get("best_of") or 1))) or next(iter(by.values()))
    return {"veto_rules": dict(main), VETO_FIELD: by}, notes


def _veto_templates(base: dict, pool: dict | None, order: list, repeat: str, best_ofs: list[int], home: str) -> tuple[dict, list[str]]:
    """Je Best of die Vorlage und - wo keine passt - der Hinweis. Rein gerechnet: dieselbe Rechnung für die Vorschau und fürs Anlegen."""
    team_a = veto_rules.HOME if home == rules.BETTER_SEED else veto_rules.DRAW
    by, notes = {}, []
    for best_of in sorted(set(best_ofs)):
        own = {**base, "team_a": team_a}
        if veto_rules.preset_steps(base["steps"]) or veto_rules.fits_problem(own, pool=pool, best_of=best_of, order=order, repeat=repeat):
            own = {**own, "steps": veto_rules.propose(order=order, pool=pool, best_of=best_of)}
        problem = veto_rules.fits_problem(own, pool=pool, best_of=best_of, order=order, repeat=repeat) if own["steps"] else "Es ließ sich keine Vorlage vorschlagen."
        if problem:
            notes.append(VETO_NOTE.format(best_of=best_of, problem=problem))
        by[str(best_of)] = {"enabled": True, "team_a": team_a, "step_seconds": int(base["step_seconds"]), "steps": own["steps"]}
    return by, notes


async def veto_preview(db, season: dict, division: dict, best_ofs: list[int], home: str) -> list[str]:
    """Die Veto-Hinweise schon in der Vorschau (Nr. 200, 207): Passt für ein Best of keine Vorlage, steht es dort, bevor die Staffel
    angelegt ist - ein still übersprungenes Veto darf es in den Playoffs nicht geben. Ohne Veto in der Season: nichts."""
    from services import league_games, league_service

    league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0}) or {}
    pseudo = {**league_service.staffel_fields(league, season, division), "league_context": {"season_id": season["id"], "division_id": division["id"]}}
    base = veto_rules.rules_of(pseudo)
    if not base:
        return []
    pool = map_pools.valid_for(await map_pools.current(db, "league_season", season["id"]), league.get("game_id"))
    _by, notes = _veto_templates(base, pool, league_games.effective_mode_order(pseudo, pool), league_games.map_repeat_of(pseudo), best_ofs, home)
    return notes


async def _write_matches(db, tournament: dict, stage: dict, registrations: list[dict], actor: dict, *, mark) -> list[dict]:
    """Der Baum aus dem Turnierkern, dazu je Spiel, was die Liga braucht (``mark(spiel)``) - danach Struktur-Schnappschuss, Los-Protokoll
    und Termine wie bei jedem Turnier."""
    from services.competition_versions import persist_competition_versions
    from services.custom_bracket import build_matches_v2_from_schema
    from services.draw_records import record_build_draws
    from services.matchday_schedule import persist_matchday_schedule

    matches = build_matches_v2_from_schema(tournament, stage, registrations, preview=False)
    for match in matches:
        mark(match)
    await db.tournament_stages.insert_one(dict(stage))
    if matches:
        await db.matches_v2.insert_many([dict(match) for match in matches])
    await persist_competition_versions(db, tournament, "graph")
    await record_build_draws(db, matches, actor_id=actor.get("id"))
    try:
        await persist_matchday_schedule(db, tournament)
    except Exception:  # noqa: BLE001 - der Standardtermin kommt sonst mit dem nächsten Lauf des Planers
        logger.warning("[liga] Termine der Staffel %s nicht vorbelegt", log_safe(tournament.get("id")), exc_info=True)
    return matches


def _playoff_fields(season: dict, settings: dict, count: int) -> tuple[dict, dict]:
    calendar = _playoff_weeks(season, settings, count)
    playoffs = settings["playoffs"]
    return {
        "best_of": int(playoffs["best_of"]), "bronze_match": bool(playoffs["third_place"]), "seeding_mode": "manual",
        "max_participants": count, "round_robin_legs": 1,
        "start_date": rules.day_start_iso(calendar["start_day"]), "end_date": rules.day_end_iso(calendar["end_day"]),
        "matchday_blocked_weeks": calendar["blocked"], "matchday_weeks_total": len(calendar["rounds"]) + len(calendar["blocked"]),
    }, calendar


def _mark_playoff(settings: dict, total: int, seeds: dict[str, int]):
    playoffs = settings["playoffs"]

    def mark(match: dict) -> None:
        number = int(match.get("round") or 1)
        bronze = finals_mod.is_bronze(match)
        match["round_name"] = finals_mod.THIRD_PLACE if bronze else rules.round_label(number, total)
        best_of = rules.best_of_for(playoffs, total if bronze else number)
        if best_of != int(playoffs["best_of"]):
            match["best_of"] = best_of
        # Die Art steht an jedem Spiel (Matchseite: „beide nicht erschienen“ im K.-o.); Heim und Setzplätze nur bei „besser Gesetzter“.
        match["postseason"] = {"kind": PLAYOFF, **({"home": rules.BETTER_SEED, "seeds": dict(seeds)} if playoffs["home"] == rules.BETTER_SEED else {})}
    return mark


async def _build_playoffs(db, season: dict, division: dict, settings: dict, plan: dict, actor: dict, *, tournament: dict | None,
                          draw_count: int) -> dict:
    from services import league_service

    count = len(plan["seeds"])
    total = seeding.rounds(count)
    fields, _calendar = _playoff_fields(season, settings, count)
    if tournament is None:
        tournament = await league_service.create_staffel(db, division, None, actor, postseason={
            "kind": PLAYOFF, "code": STAFFEL_CODES[PLAYOFF], "label": KIND_LABELS[PLAYOFF], "format": rules.SINGLE_ELIM,
            "status": "live", "fields": fields, "context": {"kind": PLAYOFF}})
    else:
        await db.tournaments.update_one({"id": tournament["id"]}, {"$set": dict(fields)})
        tournament = {**tournament, **fields}
    sources = await _sources(db, [row["registration_id"] for row in plan["seeds"]])
    registrations, seeds_by_id, snapshot = [], {}, []
    for row in plan["seeds"]:
        origin = {"from_tournament_id": row["tournament_id"], "from_registration_id": row["registration_id"], "from_staffel": row.get("staffel"),
                  "rank": row.get("rank")}
        registration = _registration(tournament, sources.get(row["registration_id"]) or {"id": row["registration_id"], "display_name": row["display_name"]},
                                     row["seed"], origin, actor)
        registrations.append(registration)
        seeds_by_id[registration["id"]] = row["seed"]
        snapshot.append({**{key: row.get(key) for key in ("seed", "display_name", "staffel", "rank", "tie", "points_per_game", "map_diff_per_game")},
                         "registration_id": registration["id"], "squad_id": registration.get("squad_id"), "from_tournament_id": row["tournament_id"],
                         "from_staffel": row.get("staffel"), "from_registration_id": row["registration_id"]})
    await db.tournament_registrations.insert_many([dict(row) for row in registrations])
    best_ofs = [rules.best_of_for(settings["playoffs"], number) for number in range(1, total + 1)]
    veto, notes = await _veto(db, tournament, best_ofs, settings["playoffs"]["home"])
    frame = plan["frame"]
    previous = (tournament.get(rules.FIELD) or {}) if isinstance(tournament.get(rules.FIELD), dict) else {}
    now = now_utc().isoformat()
    record = {
        "stamp": plan["stamp"], "per_staffel": plan["per_staffel"],
        "sources": [{"tournament_id": table["tournament_id"], "final_table_id": table["final"]["id"], "version": table["final"].get("version")}
                    for table in frame["tables"]],
        "seeds": snapshot, "staffel_order": plan["order"],
        # Wer seit dem Abschluss ausgeschieden ist und darum fehlt (Nr. 217) - bleibt über jedes weitere Neuberechnen draußen.
        "gone": list(plan["gone"]),
        "draws": [{**draw, "at": now, "by": actor.get("id")} for draw in plan["draws"]],
        "draw_count": int(previous.get("draw_count") or 0) + draw_count, "swaps": plan["swaps"], "settings": settings,
        "veto_notes": notes, "created_at": previous.get("created_at") or now, "created_by": previous.get("created_by") or actor.get("id"),
    }
    await db.tournaments.update_one({"id": tournament["id"]}, {"$set": {rules.FIELD: record, **veto, "updated_at": now}})
    tournament = {**tournament, rules.FIELD: record, **veto}
    await _write_matches(db, tournament, _stage(tournament, PLAYOFF, actor), registrations, actor, mark=_mark_playoff(settings, total, seeds_by_id))
    return tournament


async def _build_relegation(db, season: dict, upper: dict, lower: dict, settings: dict, plan: dict, actor: dict, draw_count: int) -> dict:
    from services import league_service

    week = await relegation_week(db, season, upper, lower)
    pairs = plan["pairs"]
    fields = {"best_of": int(settings["relegation"]["best_of"]), "bronze_match": False, "seeding_mode": "manual", "max_participants": len(pairs) * 2,
              "round_robin_legs": 1, "start_date": rules.day_start_iso(week["start_day"]),
              "end_date": rules.day_end_iso(week["end_day"]), "matchday_blocked_weeks": week["blocked"],
              "matchday_weeks_total": len(week["rounds"]) + len(week["blocked"])}
    tournament = await league_service.create_staffel(db, upper, None, actor, postseason={
        "kind": RELEGATION, "code": STAFFEL_CODES[RELEGATION], "label": KIND_LABELS[RELEGATION], "format": rules.SINGLE_ELIM,
        "status": "live", "fields": fields, "context": {"kind": RELEGATION, "lower_division_id": lower["id"]}})
    sources = await _sources(db, [side["registration_id"] for pair in pairs for side in (pair["upper"], pair["lower"])])
    registrations, snapshot, lines = [], [], ["[REL]"]
    for index, pair in enumerate(pairs, start=1):
        entry = {}
        for side, seed in (("upper", index * 2 - 1), ("lower", index * 2)):
            row = pair[side]
            origin = {"from_tournament_id": row["tournament_id"], "from_registration_id": row["registration_id"], "from_staffel": row.get("staffel"),
                      "rank": row.get("rank"), "pair": index, "side": side}
            registration = _registration(tournament, sources.get(row["registration_id"]) or {"id": row["registration_id"], "display_name": row["display_name"]},
                                         seed, origin, actor)
            registrations.append(registration)
            entry[side] = {**{key: row.get(key) for key in ("display_name", "staffel", "rank", "tie")}, "registration_id": registration["id"],
                           "squad_id": registration.get("squad_id"), "from_registration_id": row["registration_id"],
                           "from_tournament_id": row["tournament_id"]}
        snapshot.append({"pair": index, **entry})
        # Unabhängige Duelle: Setzplatz 1 jedes Duells ist das Team der oberen Liga N - es steht oben und hat Heimrecht (Nr. 212).
        lines.append(f"{chr(ord('A') + (index - 1) % 26)}{'' if index <= 26 else index}=[{index * 2 - 1},{index * 2}]")
    await db.tournament_registrations.insert_many([dict(row) for row in registrations])
    veto, notes = await _veto(db, tournament, [int(settings["relegation"]["best_of"])], rules.BETTER_SEED)
    top, bottom = plan["frames"]
    now = now_utc().isoformat()
    record = {"stamp": plan["stamp"], "pairs": snapshot, "draws": [{**draw, "at": now, "by": actor.get("id")} for draw in plan["draws"]],
              "draw_count": draw_count, "settings": settings, "veto_notes": notes, "lower_division_id": lower["id"],
              "sources": [{"tournament_id": table["tournament_id"], "final_table_id": table["final"]["id"], "version": table["final"].get("version")}
                          for table in [*top["tables"], *bottom["tables"]]],
              "week": {key: week.get(key) for key in ("start_day", "end_day", "after_playoffs_of")}, "created_at": now, "created_by": actor.get("id")}
    await db.tournaments.update_one({"id": tournament["id"]}, {"$set": {rules.FIELD: record, **veto, "updated_at": now}})
    tournament = {**tournament, rules.FIELD: record, **veto}

    def mark(match: dict) -> None:
        match["round_name"] = KIND_LABELS[RELEGATION]
        match["postseason"] = {"kind": RELEGATION}

    await _write_matches(db, tournament, _stage(tournament, RELEGATION, actor, schema="\n".join(lines)), registrations, actor, mark=mark)
    return tournament


# ---------------------------------------------------------------- Anlegen und neu setzen

async def create(db, season: dict, kind: str, body: dict, actor: dict) -> dict:
    """Legt die Playoff- bzw. Relegations-Staffel einer Liga N an - oder findet die schon angelegte (``replay``). Hält die Season-Sperre
    (Nr. 232): Zwei Klicks kurz hintereinander legen eine Staffel an, nie zwei."""
    if kind not in (PLAYOFF, RELEGATION):
        raise PostseasonProblem(NOT_POSTSEASON, 404)
    try:
        async with mutation_lock(db, league_season_resource(season["id"]), wait_seconds=LOCK_WAIT_SECONDS):
            result = await _create(db, season["id"], kind, body, actor)
    except MutationLockBusy:
        raise PostseasonProblem(BUSY, 409) from None
    if not result["replay"]:
        tournament = result["tournament"]
        if result["override"]:
            await league_permissions.record_override(db, actor, action="postseason_create", target_id=tournament["id"], reason=result["override"])
        await _audit(db, "league.postseason.create", season["id"], actor, kind=kind, tournament_id=tournament["id"],
                     division_id=tournament["league_context"].get("division_id"), stamp=tournament[rules.FIELD]["stamp"],
                     teams=len(tournament[rules.FIELD].get("seeds") or []) or len(tournament[rules.FIELD].get("pairs") or []) * 2,
                     draws=len(tournament[rules.FIELD].get("draws") or []), **({"conflict_override": result["override"]} if result["override"] else {}))
        await refresh_season_end(db, season["id"])
    return {"tournament": result["tournament"], "replay": result["replay"]}


async def _create(db, season_id: str, kind: str, body: dict, actor: dict) -> dict:
    from services.league_service import LeagueProblem

    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    divisions = await _divisions(db, season_id)
    division = next((row for row in divisions if row["id"] == body.get("division_id")), None)
    if not division:
        raise PostseasonProblem(NO_DIVISION, 404)
    existing = await _existing(db, division["id"], kind)
    if existing:
        return {"tournament": existing, "replay": True, "override": None}
    if not body.get("confirm"):
        raise PostseasonProblem(CONFIRM)
    # Unfertig aus einem früheren Versuch (Prozessende mitten im Bau): wegräumen und neu bauen - nie als „schon angelegt“ behandeln.
    await _discard(db, division["id"], kind)
    settings = settings_of(season, division)
    if not settings["playoffs" if kind == PLAYOFF else "relegation"]["enabled"]:
        raise PostseasonProblem(NOT_ENABLED[kind], 409)
    counter = [0]
    if kind == PLAYOFF:
        plan = await playoff_plan(db, season, division, lot=_lot(None, counter))
        involved = plan["frame"]["staffeln"]
    else:
        lower = _lower(divisions, division)
        plan = await relegation_plan(db, season, division, lower, lot=_lot(None, counter))
        involved = [*plan["frames"][0]["staffeln"], *plan["frames"][1]["staffeln"]] if plan["frames"] else []
    override = await _conflict_override(db, actor, involved, body.get("conflict_reason"))
    if plan["blockers"]:
        raise PostseasonProblem(plan["blockers"][0]["text"], 409)
    if body.get("stamp") != plan["stamp"]:
        raise PostseasonProblem(STAMP_CHANGED, 409)
    try:
        if kind == PLAYOFF:
            tournament = await _build_playoffs(db, season, division, settings, plan, actor, tournament=None, draw_count=counter[0])
        else:
            tournament = await _build_relegation(db, season, division, _lower(divisions, division), settings, plan, actor, counter[0])
    except BaseException as failure:
        # Nichts halb Angelegtes: Bricht der Bau ab (Sperre des Map-Pools, Absturz mitten im Schreiben), verschwindet die Staffel wieder -
        # sonst fände der nächste Klick eine Playoff-Staffel ohne Baum. Unter der Season-Sperre gab es vorher keine.
        await _discard(db, division["id"], kind)
        if isinstance(failure, LeagueProblem):
            raise PostseasonProblem(failure.message, failure.status) from None
        raise
    return {"tournament": tournament, "replay": False, "override": override}


async def _discard(db, division_id: str, kind: str) -> None:
    """Die gerade angelegte, unfertige Staffel wieder entfernen - ein Fehler dabei steht im Log und überdeckt den ersten nicht."""
    from services import league_service

    try:
        half = await _stored(db, division_id, kind)
        if half:
            await league_service._purge_staffel(db, half["id"])
    except Exception:  # noqa: BLE001 - der eigentliche Fehler geht an den Aufrufer
        logger.exception("[liga] Unfertige Staffel in Liga %s nicht entfernt", log_safe(division_id))


async def any_played(db, tournament_id: str) -> bool:
    matches = await db.matches_v2.find({"tournament_id": tournament_id, "is_preview": {"$ne": True}},
                                       {"_id": 0, "status": 1, "result_meta": 1, "started_at": 1, "reports": 1, "pending_result": 1}).to_list(2000)
    from services.tournament_guard import match_can_be_rebuilt

    return any(not match_can_be_rebuilt(match) or match.get("started_at") or match.get("reports") or isinstance(match.get("pending_result"), dict)
               for match in matches)


async def reseed_refusal(db, tournament: dict) -> str | None:
    if staffel_kind(tournament) != PLAYOFF:
        return NOT_POSTSEASON
    if is_closed(tournament):
        return CLOSED
    return PLAYED if await any_played(db, tournament["id"]) else None


async def reseed(db, tournament: dict, body: dict, actor: dict) -> dict:
    """„Setzliste neu berechnen“: aus dem geltenden Endstand, nur solange kein Playoff-Spiel gespielt ist - nach einer Korrektur oder
    wenn ein Team ausgeschieden ist (der Nächste derselben Staffel rückt nach, Nr. 217). Mit Grund; neu gelost wird nur, wenn nicht
    mehr dieselben Staffelsieger gleich stehen (Nr. 225). Der Aufrufer hält die Schreibsperre des Turniers."""
    if not body.get("confirm"):
        raise PostseasonProblem("Bitte das Neuberechnen bestätigen.")
    reason = _reason(body.get("reason"))
    season_id = tournament["league_context"].get("season_id")
    try:
        async with mutation_lock(db, league_season_resource(season_id), wait_seconds=LOCK_WAIT_SECONDS):
            fresh = await db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
            refusal = await reseed_refusal(db, fresh)
            if refusal:
                raise PostseasonProblem(refusal, 404 if refusal == NOT_POSTSEASON else 409)
            season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
            division = await db.league_divisions.find_one({"id": fresh["league_context"].get("division_id")}, {"_id": 0})
            counter = [0]
            previous = fresh.get(rules.FIELD) or {}
            # Die Herkunft der gelosten Gruppe steht im Schnappschuss mit den Kennungen der regulären Anmeldungen.
            plan = await playoff_plan(db, season, division, lot=_lot(previous.get("draws"), counter), existing=fresh)
            override = await _conflict_override(db, actor, plan["frame"]["staffeln"], body.get("conflict_reason"))
            if plan["blockers"]:
                raise PostseasonProblem(plan["blockers"][0]["text"], 409)
            if body.get("stamp") != plan["stamp"]:
                raise PostseasonProblem(STAMP_CHANGED, 409)
            tid = fresh["id"]
            match_ids = await db.matches_v2.distinct("id", {"tournament_id": tid})
            if match_ids:
                await db.match_reports_v2.delete_many({"match_id": {"$in": match_ids}})
            await db.matches_v2.delete_many({"tournament_id": tid})
            await free_stations_of_deleted_matches(db, match_ids)
            await db.tournament_stages.delete_many({"tournament_id": tid})
            await db.tournament_registrations.delete_many({"tournament_id": tid})
            rebuilt = await _build_playoffs(db, season, division, settings_of(season, division), plan, actor, tournament=fresh, draw_count=counter[0])
    except MutationLockBusy:
        raise PostseasonProblem(BUSY, 409) from None
    if override:
        await league_permissions.record_override(db, actor, action="postseason_reseed", target_id=tournament["id"], reason=override)
    await _audit(db, "league.postseason.reseed", season_id, actor, tournament_id=tournament["id"], reason=reason, stamp=rebuilt[rules.FIELD]["stamp"],
                 teams=len(rebuilt[rules.FIELD]["seeds"]), redrawn=counter[0], **({"conflict_override": override} if override else {}))
    await refresh_season_end(db, season_id)
    return {"tournament": rebuilt, "redrawn": counter[0]}


# ---------------------------------------------------------------- Abschluss der Season, Wiederöffnen

async def missing(db, season_id: str | None) -> list[dict]:
    """Eingeschaltet, aber noch nicht angelegt: Solange bleibt die Season „läuft“ und die neue Season wartet (Nr. 213)."""
    if not season_id:
        return []
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        return []
    divisions = await _divisions(db, season_id)
    if not rules.any_enabled(season) and not any(isinstance(row.get(rules.FIELD), dict) for row in divisions):
        return []
    out = []
    played_in = {row["id"]: bool(await league_cross_zones.staffeln_of(db, row["id"])) for row in divisions}
    for division in divisions:
        settings = settings_of(season, division)
        # Eine Liga N ohne reguläre Staffel spielt nichts aus - sie hält die Season nicht offen. Ebenso eine, in der keine zwei
        # Playoff-Teams zusammenkommen (nach den Einstellungen oder - wenn Teams ausgeschieden sind - nach dem Endstand): Sie gilt für
        # den Abschluss als „ohne Playoffs“.
        if (settings["playoffs"]["enabled"] and played_in[division["id"]] and not await _existing(db, division["id"], PLAYOFF)
                and await playoffs_feasible(db, season, division) and not await _too_few_by_final(db, season, division)):
            out.append({"kind": PLAYOFF, "division_id": division["id"], "label": _label(division),
                        "text": f"Die Playoffs von {_label(division)} sind noch nicht angelegt."})
        lower = _lower(divisions, division)
        if (settings["relegation"]["enabled"] and lower and played_in[division["id"]] and played_in[lower["id"]]
                and not await _existing(db, division["id"], RELEGATION)):
            out.append({"kind": RELEGATION, "division_id": division["id"], "label": _label(division),
                        "text": f"Die Relegation zwischen {_label(division)} und {_label(lower)} ist noch nicht angelegt."})
    return out


async def _too_few_by_final(db, season: dict, division: dict) -> bool:
    """Alle regulären Staffeln sind abgeschlossen und der Endstand ergibt weniger als zwei Playoff-Teams."""
    plan = await playoff_plan(db, season, division)
    return any(row["code"] == "too_few" for row in plan["blockers"])


async def reopen_refusal(db, tournament: dict) -> str | None:
    """Darf diese **reguläre** Staffel wieder geöffnet werden, obwohl ihre Playoffs oder die Relegation schon laufen? Die Einstellung
    ``reopen_guard`` der Season sagt es (Vorgabe ``hint``: ja)."""
    context = (tournament or {}).get("league_context") or {}
    if context.get("kind") or not context.get("season_id"):
        return None
    season = await db.league_seasons.find_one({"id": context["season_id"]}, {"_id": 0, rules.FIELD: 1})
    if rules.stored(season)["reopen_guard"] != rules.BLOCK:
        return None
    rows = await db.tournaments.find(
        {"league_context.season_id": context["season_id"], "league_context.kind": {"$in": [PLAYOFF, RELEGATION]},
         "$or": [{"league_context.division_id": context.get("division_id")}, {"league_context.lower_division_id": context.get("division_id")}],
         "status": {"$nin": ["cancelled", "archived"]}}, {"_id": 0, "id": 1, "league_context": 1}).to_list(10)
    for row in rows:
        if await any_played(db, row["id"]):
            return REOPEN_BLOCKED.format(label=KIND_LABELS[row["league_context"]["kind"]])
    return None


# ---------------------------------------------------------------- Cockpit

def _seed_view(row: dict) -> dict:
    return {key: row.get(key) for key in ("seed", "display_name", "staffel", "rank", "tie", "points_per_game", "map_diff_per_game")}


def _pairings(seeds: list[dict]) -> list[dict]:
    by_seed = {row["seed"]: _seed_view(row) for row in seeds}
    return [{"order": pair["order"], "a": by_seed.get(pair["a"]), "b": by_seed.get(pair["b"])} for pair in seeding.first_round(len(seeds))]


def _rounds_view(settings: dict, calendar: dict, total: int) -> list[dict]:
    return [{"round": row["round"], "label": rules.round_label(row["round"], total), "best_of": rules.best_of_for(settings["playoffs"], row["round"]),
             "start_day": row["start_day"], "end_day": row["end_day"]} for row in calendar["rounds"]]


async def _staffel_view(db, tournament: dict) -> dict:
    matches = await db.matches_v2.find({"tournament_id": tournament["id"], "is_preview": {"$ne": True}},
                                       {"_id": 0, "status": 1, "slots.registration_id": 1, "result_meta": 1}).to_list(2000)
    duels = [match for match in matches if len([slot for slot in match.get("slots") or [] if slot.get("registration_id")]) == 2]
    return {"tournament_id": tournament["id"], "slug": tournament.get("slug"), "title": tournament.get("title"), "status": tournament.get("status"),
            "closed": is_closed(tournament), "start_date": tournament.get("start_date"), "end_date": tournament.get("end_date"),
            "matches": {"total": len(duels), "decided": len([match for match in duels if str(match.get("status") or "") in finals_mod.DECIDED])},
            "draw_count": int((tournament.get(rules.FIELD) or {}).get("draw_count") or 0),
            "veto_notes": list((tournament.get(rules.FIELD) or {}).get("veto_notes") or [])}


async def _playoff_view(db, season: dict, division: dict, settings: dict, user: dict, can_act: bool) -> dict:
    existing = await _existing(db, division["id"], PLAYOFF)
    plan = await playoff_plan(db, season, division, existing=existing)
    count = len(plan["seeds"]) or await _team_estimate(db, division, settings)
    total = seeding.rounds(max(count, 2))
    calendar = _playoff_weeks(season, settings, max(count, 2))
    own_team = await _own_team(db, user, plan["frame"]["staffeln"])
    superadmin = league_permissions.is_superadmin(user)
    out = {"enabled": True, "blockers": plan["blockers"], "stamp": plan["stamp"], "per_staffel": plan["per_staffel"] or settings["playoffs"]["per_staffel"],
           "seeds": [_seed_view(row) for row in plan["seeds"]], "pairings": _pairings(plan["seeds"]), "byes": seeding.byes(len(plan["seeds"])),
           "open_lot": plan["open_lot"], "swaps": plan["swaps"], "rounds": _rounds_view(settings, calendar, total),
           "start_day": calendar["start_day"], "end_day": calendar["end_day"], "estimated": not plan["seeds"], "own_team": own_team,
           "staffel": None, "stale": False, "can_reseed": False, "reseed_refusal": None,
           # Vor dem Anlegen gerechnet, danach aus dem Schnappschuss der Staffel (``staffel.veto_notes``).
           "veto_notes": [] if existing else await veto_preview(
               db, season, division, [rules.best_of_for(settings["playoffs"], number) for number in range(1, total + 1)], settings["playoffs"]["home"]),
           "can_create": can_act and not existing and not plan["blockers"] and (not own_team or superadmin)}
    if existing:
        record = existing.get(rules.FIELD) or {}
        out["staffel"] = await _staffel_view(db, existing)
        out["state"] = "closed" if is_closed(existing) else "created"
        out["seeds"] = [_seed_view(row) for row in record.get("seeds") or []]
        out["pairings"] = _pairings(record.get("seeds") or [])
        out["byes"] = seeding.byes(len(record.get("seeds") or []))
        # Angelegt heißt gelost (Nr. 225): Die Setzliste des Schnappschusses gilt, offen ist nichts mehr.
        out["open_lot"] = []
        out["stale"] = bool(plan["stamp"]) and plan["stamp"] != record.get("stamp")
        out["stale_note"] = STALE_NOTE if out["stale"] else None
        refusal = await reseed_refusal(db, existing)
        out["reseed_refusal"] = refusal
        out["can_reseed"] = can_act and not refusal and not plan["blockers"] and (not own_team or superadmin)
        out["next_seeds"] = [_seed_view(row) for row in plan["seeds"]] if out["stale"] else []
    else:
        out["state"] = "waiting" if plan["blockers"] else "ready"
    return out


async def _relegation_view(db, season: dict, divisions: list[dict], division: dict, settings: dict, user: dict, can_act: bool) -> dict | None:
    lower = _lower(divisions, division)
    if not lower:
        return None
    existing = await _existing(db, division["id"], RELEGATION)
    plan = await relegation_plan(db, season, division, lower)
    week = await relegation_week(db, season, division, lower)
    involved = [*plan["frames"][0]["staffeln"], *plan["frames"][1]["staffeln"]] if plan["frames"] else []
    own_team = await _own_team(db, user, involved)
    superadmin = league_permissions.is_superadmin(user)
    out = {"enabled": True, "lower_division_id": lower["id"], "lower_label": _label(lower), "blockers": plan["blockers"], "stamp": plan["stamp"],
           "pairs": [{"upper": _seed_view(pair["upper"]), "lower": _seed_view(pair["lower"])} for pair in plan["pairs"]],
           "open_lot": plan["open_lot"], "best_of": settings["relegation"]["best_of"], "start_day": week["start_day"], "end_day": week["end_day"],
           "after_playoffs_of": week["after_playoffs_of"], "moved": week["moved"], "own_team": own_team, "staffel": None, "stale": False,
           "veto_notes": [] if existing else await veto_preview(db, season, division, [int(settings["relegation"]["best_of"])], rules.BETTER_SEED),
           "can_create": can_act and not existing and not plan["blockers"] and (not own_team or superadmin)}
    if existing:
        record = existing.get(rules.FIELD) or {}
        out["staffel"] = await _staffel_view(db, existing)
        out["state"] = "closed" if is_closed(existing) else "created"
        out["pairs"] = [{"upper": _seed_view(pair["upper"]), "lower": _seed_view(pair["lower"])} for pair in record.get("pairs") or []]
        out["open_lot"] = []
        out["stale"] = bool(plan["stamp"]) and plan["stamp"] != record.get("stamp")
        out["stale_note"] = STALE_NOTE if out["stale"] else None
        out["start_day"] = (record.get("week") or {}).get("start_day") or out["start_day"]
        out["end_day"] = (record.get("week") or {}).get("end_day") or out["end_day"]
    else:
        out["state"] = "waiting" if plan["blockers"] else "ready"
    return out


async def overview(db, season: dict, user: dict) -> dict:
    """Das Cockpit: die Vorlage der Season, je Liga N was gilt, Vorschau der Setzung, Stand der Staffeln und was noch fehlt."""
    capabilities = await league_permissions.capabilities_of(db, user, season.get("league_id"))
    can_act = CAPABILITY in capabilities
    divisions = await _divisions(db, season["id"])
    closed = await _closed_divisions(db, season["id"])
    levels = [row["level"] for row in divisions]
    hints = await too_few_hints(db, season, divisions)
    rows = []
    for division in divisions:
        settings = settings_of(season, division)
        lower = _lower(divisions, division)
        zones = league_zones.effective(division, levels)
        rows.append({
            "division_id": division["id"], "level": division["level"], "label": _label(division), "settings": settings,
            "own_settings": division.get(rules.FIELD) if isinstance(division.get(rules.FIELD), dict) else None,
            "locked": division["id"] in closed, "top": division["id"] == divisions[0]["id"], "has_lower": bool(lower),
            "lower_label": _label(lower) if lower else None,
            "zones": {"playoff_relegate": zones.get("playoff_relegate") or 0,
                      "lower_playoff_promote": (league_zones.effective(lower, levels).get("playoff_promote") or 0) if lower else 0},
            "playoffs": ({**await _playoff_view(db, season, division, settings, user, can_act), "too_few_hint": hints.get(division["id"])}
                         if settings["playoffs"]["enabled"] else None),
            "relegation": (await _relegation_view(db, season, divisions, division, settings, user, can_act)
                           if settings["relegation"]["enabled"] else None),
        })
    return {
        "season": {"id": season["id"], "name": season.get("name"), "best_of": season.get("best_of"),
                   "regular_end_day": (rules.regular_end_day(season).isoformat() if rules.regular_end_day(season) else None)},
        "settings": rules.stored(season), "configured": rules.any_enabled(season), "can_act": can_act,
        # Ab dem Season-Start stehen Best of, Spiel um Platz 3 und Heimrecht der Playoffs fest (Nr. 249) - die Felder sind dann gesperrt.
        "started": season_started(season),
        "superadmin": league_permissions.is_superadmin(user),
        "responsible": f"„{league_permissions.CAPABILITY_LABELS[CAPABILITY]}“",
        "options": {"best_of": list(rules.BEST_OF), "per_staffel": [rules.PER_STAFFEL_MIN, rules.PER_STAFFEL_MAX], "round_max": rules.ROUND_MAX,
                    "home": rules.HOME_LABELS, "champion_source": rules.CHAMPION_LABELS, "reopen_guard": rules.REOPEN_LABELS},
        "missing": await missing(db, season["id"]),
        "divisions": rows,
    }


# ---------------------------------------------------------------- Beide nicht erschienen (Nr. 217, H5)

RETRY, OUT = "retry", "out"


async def double_no_show(db, tournament: dict, match: dict, note: str, actor: dict) -> dict:
    """„Beide nicht erschienen“ in einer Playoff- oder Relegations-Staffel: Die Tabellen-Wertung (beide Rang 2) gibt es im K.-o. nicht -
    dort käme niemand weiter. Beim ersten Mal wird einmal neu angesetzt (``no_show_retry``, das Spiel bleibt offen, die Leitung legt
    den Termin). Beim zweiten Mal scheiden beide aus: Ihre Plätze werden Freilose, die Freilos-Kette des Turnierkerns
    (``resolve_walkovers``) lässt den nächsten Gegner kampflos weiterkommen; im Finale bleibt der Titel unvergeben.
    Der Aufrufer hält die Schreibsperre des Turniers und hat das Spiel geprüft (``league_table.check_double_no_show``)."""
    from services.match_v2_results import resolve_walkovers

    now = now_utc().isoformat()
    sides = [slot["registration_id"] for slot in match.get("slots") or [] if slot.get("registration_id")]
    season_id = (tournament.get("league_context") or {}).get("season_id")
    if not isinstance(match.get("no_show_retry"), dict):
        # Schon das erste Mal zählt als „nicht erschienen“ (Nr. 245) - je Seite, wie in der regulären Saison; die Route trägt es ein.
        retry = {"at": now, "by": actor.get("id"), "previous_at": match.get("scheduled_at"), "note": note, "registration_ids": sides,
                 "counted": True}
        await db.matches_v2.update_one({"id": match["id"]}, {"$set": {"no_show_retry": retry, "updated_at": now}})
        await _audit(db, "league.postseason.no_show", season_id, actor, step=RETRY, tournament_id=tournament["id"], match_id=match["id"],
                     registration_ids=sides)
        return {"step": RETRY, "sides": sides}
    stage_matches = await db.matches_v2.find({"tournament_id": tournament["id"], "stage_id": match.get("stage_id")}, {"_id": 0}).to_list(3000)
    by_id = {row["id"]: row for row in stage_matches}
    own = by_id[match["id"]]
    for slot in own.get("slots") or []:
        if slot.get("registration_id"):
            slot.update({"registration_id": None, "user_id": None, "status": "bye",
                         "source_result": {"skipped": True, "reason": "double_no_show", "confirmed_at": now}})
    marks = {"double_forfeit": True, "double_forfeit_sides": sides, "admin_decision_note": note, "admin_decision_by": actor.get("id"),
             "admin_decision_at": now, "pending_result": None}
    own.update(marks)
    target_sets: dict[str, dict] = {own["id"]: {"slots": own["slots"], **marks, "updated_at": now}}
    resolve_walkovers([own["id"]], by_id, target_sets, now)
    for match_id, change in target_sets.items():
        await db.matches_v2.update_one({"id": match_id}, {"$set": change})
    await _audit(db, "league.postseason.no_show", season_id, actor, step=OUT, tournament_id=tournament["id"], match_id=match["id"],
                 registration_ids=sides, changed=len(target_sets))
    return {"step": OUT, "sides": sides}


async def undo_no_show(db, tournament: dict, match: dict, reason: str, actor: dict) -> list[str]:
    """Die Neuansetzung nach dem ersten „beide nicht erschienen“ zurücknehmen (Nr. 245) - mit Grund, wie in der regulären Saison. Das
    Spiel steht danach, als wäre nichts gewesen; die Einträge „nicht erschienen“ nimmt die Route zurück. Sind beide schon ausgeschieden,
    geht das nicht mehr: Der Baum ist weitergelaufen. Gibt die beiden Seiten zurück."""
    if match.get("double_forfeit_sides"):
        raise PostseasonProblem(OUT_FINAL, 409)
    retry = match.get("no_show_retry")
    if not isinstance(retry, dict):
        raise PostseasonProblem(NO_RETRY, 409)
    sides = [str(item) for item in retry.get("registration_ids") or [] if item] or [
        slot["registration_id"] for slot in match.get("slots") or [] if slot.get("registration_id")]
    now = now_utc().isoformat()
    await db.matches_v2.update_one({"id": match["id"]}, {"$unset": {"no_show_retry": ""}, "$set": {"updated_at": now}})
    await _audit(db, "league.postseason.no_show", (tournament.get("league_context") or {}).get("season_id"), actor, step="undo",
                 tournament_id=tournament["id"], match_id=match["id"], registration_ids=sides, reason=reason)
    return sides
