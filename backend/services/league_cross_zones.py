"""Auf- und Abstieg über die Staffeln einer Liga N hinweg (#1627, Entscheidungen 23.11. und Nr. 227-229; docs/LIGA.md „F.2 … Zielregel je Zone“).

Die Zonen einer Liga N zählen je Staffel (``league_zones``). Hat eine Liga N mehrere Staffeln, kann die Season zusätzlich Plätze über alle
Staffeln hinweg vergeben: ``zones.promote_best`` - die N besten Teams auf dem ersten Platz nach den festen Aufsteigern und den
Relegationsplätzen („die zwei besten Zweiten“) -, ``zones.relegate_worst`` spiegelbildlich unten. **Ohne die Felder gilt nichts davon.**

- **Vergleich** (``league_cross_rank``): Punkte je Spiel, dann Map-Differenz je Spiel. Danach entscheidet die Leitung - kein Los (Nr. 156).
- **Erst wenn alle Staffeln abgeschlossen sind**, steht die Zone fest: Vorher trägt keine Tabelle sie. Gerechnet wird beim Lesen aus den
  geltenden Endständen, nichts wird in einen Endstand zurückgeschrieben - ein Wiederöffnen nimmt die Zone von selbst wieder weg.
- **Aus dem gespeicherten Stand** (Nr. 228): Die Regel und die Zonen je Staffel kommen aus ``final.zones`` der abgeschlossenen Staffeln,
  nie aus der heutigen Einstellung der Liga N - eine spätere Änderung ändert keine abgeschlossene Season. Nur für noch offene Staffeln
  (Vorschau im Cockpit, Sperrgrund beim letzten Abschluss) gilt die heutige Einstellung; ab dem ersten Abschluss sind die beiden Felder
  gesperrt (``league_service.update_division``), darum sagen beide dasselbe.
- **Gleichstand an der Grenze** sperrt den Abschluss der letzten Staffel (``league_final.blockers``, ``zone_cross_tie``) und, falls zwei
  Staffeln gleichzeitig schlossen, das Anlegen der neuen Season. Der Entscheid steht an der Liga N (``league_divisions.zone_decisions``)
  und gilt genau für den Gleichstand, zu dem er getroffen wurde (Nr. 229): dieselbe Gruppe **und** dieselben Punkte und dieselbe
  Map-Differenz je Spiel. Ändert sich eines davon, ist er hinfällig.

Blatt-Modul: nur ``league_zones``, ``league_cross_rank``, ``league_scope`` und die Datenbank - ``league_final_read`` (Tabellen-Route)
und ``league_final`` lesen hier, ohne dass ein Import-Kreis entsteht. Die Live-Tabelle offener Staffeln reicht der Aufrufer herein. Der
Entscheid der Leitung (mit Sperre, Befangenheit und Protokoll) steht in ``league_cross_decisions``.
"""
from __future__ import annotations

from services import league_cross_rank, league_zones
from services.league_scope import ONLY_LEAGUE

PROMOTE, RELEGATE = league_zones.PROMOTE_BEST, league_zones.RELEGATE_WORST
KINDS = (PROMOTE, RELEGATE)
ZONE_OF = {PROMOTE: league_zones.PROMOTION, RELEGATE: league_zones.RELEGATION}
SIDE_LABEL = {PROMOTE: "Aufstieg über den Vergleich der Staffeln", RELEGATE: "Abstieg über den Vergleich der Staffeln"}
# Wie die Leitung entscheidet: Entscheidungsspiel oder eigener Entscheid - ein Los gibt es beim Auf- und Abstieg nicht (Nr. 156).
METHODS = {"playoff": "Entscheidungsspiel", "lead": "Entscheid der Leitung"}
IGNORED_STATUSES = frozenset({"cancelled", "archived", "draft"})
REASON_MIN = 5

NO_RULE = "In dieser Liga gibt es keine Plätze über Staffeln hinweg."
NO_TIE = "Hier gibt es gerade keinen Gleichstand zu entscheiden."
NO_DECISION = "Hier gibt es keinen Entscheid, der sich zurücknehmen ließe."
METHOD_NEEDED = "Bitte angeben, wie entschieden wurde: Entscheidungsspiel oder Entscheid der Leitung. Ein Los gibt es beim Auf- und Abstieg nicht."
REASON_NEEDED = f"Bitte einen Grund angeben (mindestens {REASON_MIN} Zeichen) – er steht im Protokoll und in der Vorschau der neuen Season."
PICK_EXACT = "Bitte genau {count} aus dem Gleichstand wählen: {names}."
BUSY = "An dieser Season wird gerade etwas geändert. Bitte gleich noch einmal versuchen."
NO_DIVISION = "Diese Liga gibt es nicht."
TIE_LABEL = "Gleichstand zwischen den Staffeln"
TIE_TEXT = ("Über die Staffeln hinweg stehen Teams nach Punkten je Spiel und Map-Differenz je Spiel gleich, aber nur ein Teil bekommt den "
            "Platz. Vor dem Abschluss der letzten Staffel braucht es einen begründeten Entscheid (Entscheidungsspiel oder Leitung, kein Los) "
            "– im Reiter „Abschluss“ unter „Plätze über Staffeln hinweg“.")
SUCCESSOR_TIE = ("{label}: Gleichstand zwischen den Staffeln ({names}). Bitte zuerst im Reiter „Abschluss“ unter „Plätze über Staffeln "
                 "hinweg“ entscheiden.")


def is_closed(tournament: dict | None) -> bool:
    """Wie ``league_final_read.is_closed`` - hier noch einmal, damit dieses Blatt jenes nicht importiert (das liest hier)."""
    return isinstance((tournament or {}).get("final_table"), dict)


class CrossProblem(ValueError):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


def has_rule(zones: dict | None) -> bool:
    return isinstance(zones, dict) and any(zones.get(kind) for kind in KINDS)


# ---------------------------------------------------------------- Rechnung (ohne Datenbank)

def _values(row: dict) -> list[str]:
    """Die Vergleichswerte einer Zeile als Text, ohne Rundung: „2“ und „2/3“ - daran hängt ein Entscheid (Nr. 229)."""
    return [str(value) for value in league_cross_rank.per_game(row)]


def _valid(decision: dict | None, tied_ids: list[str], needed: int, values: list[str]) -> bool:
    """Gilt der Entscheid noch? Nur für genau diese Gruppe Gleicher mit genau diesen Punkten und dieser Map-Differenz je Spiel, und
    mit genau so vielen Gewählten, wie noch Plätze offen sind."""
    if not isinstance(decision, dict):
        return False
    chosen = list(decision.get("registration_ids") or [])
    return (sorted(decision.get("tied") or []) == sorted(tied_ids) and list(decision.get("values") or []) == list(values)
            and len(set(chosen)) == len(chosen) == needed and set(chosen) <= set(tied_ids) and decision.get("method") in METHODS)


def evaluate(zones: dict | None, tables: list[dict], decisions: dict | None = None) -> dict:
    """Wer über die Staffeln hinweg auf- bzw. absteigt. ``zones``: die Regel (wie viele Plätze). ``tables``: je Staffel
    ``{tournament_id, staffel, rows, zones?}`` - trägt eine Tabelle eigene ``zones`` (der Stand ihres Abschlusses), bestimmen die ihren
    Kandidaten. Antwort: ``zones`` (Anmeldung → Zone, nur für die Gewählten), ``ties`` (offene Gleichstände an der Grenze, mit den
    Werten, an die ein Entscheid gebunden wird) und ``sides`` (je Regel die Kandidaten in der Reihenfolge des Vergleichs, mit Schnitt je
    Spiel, gewählt oder nicht, und dem geltenden Entscheid)."""
    out: dict = {"zones": {}, "ties": [], "sides": []}
    for kind in KINDS:
        count = int((zones or {}).get(kind) or 0)
        if not count:
            continue
        origin: dict[str, dict] = {}
        rows = []
        for table in tables:
            own = table.get("zones") if isinstance(table.get("zones"), dict) and table.get("zones") else zones
            row = league_zones.cross_candidates(table.get("rows") or [], {**own, kind: own.get(kind) or count})[kind]
            if row and row.get("registration_id"):
                origin[row["registration_id"]] = table
                rows.append(row)
        found = league_cross_rank.pick(rows, count, worst=kind == RELEGATE)
        chosen = [row["registration_id"] for row in found["chosen"]]
        tied = [row["registration_id"] for row in found["tied"]]
        values = _values(found["tied"][0]) if found["tied"] else []
        decision = (decisions or {}).get(kind)
        applied = decision if tied and _valid(decision, tied, found["open"], values) else None
        if applied:
            chosen += [key for key in tied if key in set(applied["registration_ids"])]
        names = {row["registration_id"]: row.get("display_name") or "Team" for row in rows}
        tie = None
        if tied and not applied:
            tie = {"kind": kind, "open": found["open"], "registration_ids": tied, "names": [names[key] for key in tied],
                   "staffeln": [origin[key].get("staffel") for key in tied], "values": values}
            out["ties"].append(tie)
        for key in chosen:
            out["zones"][key] = ZONE_OF[kind]
        order = found["order"] if kind == PROMOTE else list(reversed(found["order"]))
        out["sides"].append({
            "kind": kind, "label": SIDE_LABEL[kind], "count": count, "zone": ZONE_OF[kind],
            "candidates": [{
                "registration_id": item["row"]["registration_id"], "display_name": names[item["row"]["registration_id"]],
                "tournament_id": origin[item["row"]["registration_id"]].get("tournament_id"),
                "staffel": origin[item["row"]["registration_id"]].get("staffel"), "rank": item["row"].get("rank"),
                "played": item["row"].get("played"), "points": item["row"].get("points"), "score_diff": item["row"].get("score_diff"),
                "points_per_game": round(item["points_per_game"], 3), "map_diff_per_game": round(item["map_diff_per_game"], 3),
                "chosen": item["row"]["registration_id"] in chosen, "tied": item["row"]["registration_id"] in tied and not applied,
                # Im entschiedenen Gleichstand, aber nicht gewählt: Das Team bleibt, wo es ist.
                "passed": bool(applied) and item["row"]["registration_id"] in tied and item["row"]["registration_id"] not in chosen,
            } for item in order],
            "tie": tie,
            "decision": ({"registration_ids": list(applied["registration_ids"]), "names": [names[key] for key in applied["registration_ids"]],
                          "tied": sorted(applied.get("tied") or []), "method": applied.get("method"),
                          "method_label": METHODS.get(applied.get("method") or ""), "reason": applied.get("reason"),
                          "decided_at": applied.get("at")} if applied else None),
        })
    return out


def apply(rows: list[dict], chosen: dict[str, str]) -> list[dict]:
    """Schreibt die Zone der Gewählten an ihre Zeilen (``zone_cross`` sagt, dass sie aus dem Vergleich der Staffeln kommt)."""
    for row in rows:
        zone = chosen.get(row.get("registration_id") or "")
        if zone:
            row["zone"] = zone
            row["zone_cross"] = True
    return rows


def stored_rule(finals: list[dict]) -> dict | None:
    """Die Regel aus dem gespeicherten Stand (Nr. 228): die Zonen des ersten Endstands, der welche trägt - ``finals`` in der Reihenfolge
    der Staffeln. ``None``, wenn noch keine Staffel abgeschlossen ist (oder der Endstand von vor F.2 stammt)."""
    return next((final["zones"] for final in finals if isinstance(final.get("zones"), dict) and final.get("zones")), None)


# ---------------------------------------------------------------- Lesen

async def staffeln_of(db, division_id: str) -> list[dict]:
    """Die regulären Staffeln der Liga N, die zählen (wie beim Abschluss: Entwurf, abgesagt und archiviert nicht) - nach Buchstabe.
    Playoff- und Relegations-Staffeln (#2404, ``league_context.kind``) gehören nicht dazu."""
    rows = await db.tournaments.find({"league_context.division_id": division_id, **ONLY_LEAGUE},
                                     {"_id": 0, "id": 1, "title": 1, "status": 1, "final_table": 1, "league_context": 1}).to_list(100)
    rows = [row for row in rows if not (row.get("league_context") or {}).get("kind")
            and (is_closed(row) or row.get("status") not in IGNORED_STATUSES)]
    return sorted(rows, key=lambda row: str(row["league_context"].get("staffel") or ""))


async def resolve(db, division_id: str | None, *, live: dict[str, list[dict]] | None = None) -> dict | None:
    """Die Auswertung einer Liga N - ``None``, wenn sie keine Plätze über Staffeln hinweg vergibt.
    Abgeschlossene Staffeln zählen mit ihrem Endstand **und dessen Zonen** (Nr. 228); ``live``: Tabellen offener Staffeln (Turnier →
    Zeilen), für die die heutige Einstellung gilt. ``complete``: Jede Staffel hat eine Tabelle - ohne ``live`` heißt das: alle
    abgeschlossen, und nur dann steht die Zone fest. ``closed``: wirklich alle abgeschlossen."""
    if not division_id:
        return None
    staffeln = await staffeln_of(db, division_id)
    done = [row["id"] for row in staffeln if is_closed(row)]
    finals = {row["tournament_id"]: row for row in await db.league_final_tables.find(
        {"tournament_id": {"$in": done}, "active": True}, {"_id": 0, "tournament_id": 1, "rows": 1, "zones": 1}).to_list(len(done) + 1)} if done else {}
    rule = stored_rule([finals[key] for key in done if key in finals])
    division = await db.league_divisions.find_one(
        {"id": division_id}, {"_id": 0, "id": 1, "season_id": 1, "level": 1, "nickname": 1, "zones": 1, "zone_decisions": 1})
    if not division:
        return None
    today = None
    if rule is None or any(not is_closed(row) for row in staffeln):
        # Für offene Staffeln (und solange keine abgeschlossen ist) die heutige Einstellung - die Felder sind ab dem ersten Abschluss gesperrt.
        today = league_zones.effective(division, await league_zones.season_levels(db, division.get("season_id")))
    rule = rule if rule is not None else today
    if not has_rule(rule):
        return None
    tables, complete = [], bool(staffeln)
    for staffel in staffeln:
        if is_closed(staffel):
            final = finals.get(staffel["id"]) or {}
            rows, own = final.get("rows") or [], final.get("zones") or rule
        elif live is not None and staffel["id"] in live:
            rows, own = live[staffel["id"]], today
        else:
            complete = False
            continue
        tables.append({"tournament_id": staffel["id"], "staffel": staffel["league_context"].get("staffel"), "rows": rows, "zones": own})
    found = evaluate(rule, tables, division.get("zone_decisions")) if complete else {"zones": {}, "ties": [], "sides": []}
    return {"division": division, "rule": rule, "complete": complete, "closed": bool(staffeln) and all(is_closed(row) for row in staffeln),
            "staffeln": staffeln, **found}


async def overlay(db, final: dict | None, rows: list[dict], cache: dict | None = None) -> list[dict]:
    """Die Zeilen eines Endstands mit der Zone aus dem Vergleich der Staffeln - nur wenn alle Staffeln der Liga N abgeschlossen sind.
    Ob es die Regel gibt, sagt der Endstand selbst (``final.zones``, Nr. 228): Ohne sie kostet das keine Abfrage. ``cache``: je Liga N
    einmal rechnen (Listen über viele Endstände)."""
    division_id = (final or {}).get("division_id")
    if not division_id or not has_rule((final or {}).get("zones")):
        return rows
    if cache is not None and division_id in cache:
        found = cache[division_id]
    else:
        found = await resolve(db, division_id)
        if cache is not None:
            cache[division_id] = found
    if found and found["complete"]:
        apply(rows, found["zones"])
    return rows


async def overlay_finals(db, finals: list[dict]) -> None:
    """Viele Endstände auf einmal (Season-Historie): gerechnet wird nur für Liga N, deren Endstand die Regel trägt, je Liga N einmal -
    die Zahl der Abfragen wächst nicht mit der Zahl der Seasons."""
    cache: dict = {}
    for final in finals:
        await overlay(db, final, final.get("rows") or [], cache)


def view(found: dict, label: str, own: set[str]) -> dict:
    """Eine Liga N im Cockpit: je Regel die Kandidaten, der offene Gleichstand, der Entscheid. ``final``: alle Staffeln sind
    abgeschlossen - sonst ist es der Stand von jetzt. ``own_team``: Die Person gehört zu einem Team des Gleichstands - des offenen
    oder des entschiedenen; dann entscheidet und widerruft eine andere Person."""
    def involved(side: dict) -> set[str]:
        return set((side["tie"] or {}).get("registration_ids") or (side["decision"] or {}).get("tied") or [])

    return {"division_id": found["division"]["id"], "label": label, "final": found["closed"],
            "sides": [{**side, "own_team": bool(own & involved(side))} for side in found["sides"]]}
