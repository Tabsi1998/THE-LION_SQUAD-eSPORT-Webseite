"""Saisontabelle des Veranstalters einlesen (#1928): vergangene Runden einer Saison in einem Schritt nachtragen - je
Runde ein Ergebnis-Entwurf, nie veröffentlicht. Nur der Vorstand (Bereich Redaktion), nicht für die Team-Liga.

Alle Pfade unter ``/api/reference-series/admin/series/{series_id}/season-table``. Den Text liest die Oberfläche
(``frontend/src/lib/resultPaste.js``, ``parseSeasonTablePaste``); der Server nimmt die Tabelle strukturiert::

    {columns: [{label, round_id?}],      # je Runden-Spalte; round_id: Kennung, "" = nicht übernehmen, fehlt = selbst
     rows: [{name, team?, cells: ["25", "OUT", "--", …], total?, rank?}],
     team_column: false, points: "scheme" | "organizer",
     decisions: [{column, row, choice: "place" | "organizer", place?, bonus_keys?, marks?}]}

- ``POST …/preview`` - **schreibt nichts**. Je Spalte ``round`` (Termin und wie er gefunden wurde: ``how``), ``state``
  (``new``, ``changed``, ``same``, ``unclear``, ``error``, ``empty``, ``skip``, ``unmatched``), ``target``,
  ``expected_version``, ``sheet``, ``cells`` (je gefüllter Zelle Platz bzw. gelb mit Vorschlägen), ``unclear``,
  ``changes`` (Abweichungen zum vorhandenen Blatt bzw. Entwurf daneben), ``errors`` und ``warnings``. Dazu ``rounds``
  (Termine zur Wahl), ``totals`` (Abgleich je Zeile mit „Gesamt“ samt Gründen) und ``unknown_names``.
- ``POST …/apply`` - dieselbe Tabelle plus ``items: [{column, round_id, expected_version}]``: übernimmt genau die
  gewählten Spalten als Entwurf. Je Spalte ``status``: ``saved``, ``same``, ``unclear`` (gelbe Zellen offen - nichts
  geschrieben), ``conflict`` (Termin oder Blatt haben sich seit der Vorschau geändert) oder ``error``.

**Regeln:** wie bei der Partner-Plattform (#1964) - ein neues Blatt ist ein Entwurf, ein vorhandener Entwurf wird nur
mit der Version aus der Vorschau ersetzt (Revision bleibt), neben einem veröffentlichten Blatt entsteht ein Entwurf
daneben. Was die Tabelle nicht kennt (Notiz, Zeiten, Startplatz, Runden eines Turniertags), bleibt aus dem vorhandenen
Blatt; Punkte, Platz, Marken, Sonderboni und Team kommen aus der Tabelle und zählen als Abweichung. Unbekannte Namen
werden offene Teilnehmer (Dialog „Unbekannte Namen“, #1743). Geschrieben wird unter der Sperre der Saison.
"""
from __future__ import annotations

from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError, field_validator

from database import get_db
from models import new_id, now_utc
from routes import reference_result_routes as results
from services import partner_import, race_weekend, reference_running_cache, reference_series, season_table
from services import series_results
from services.own_teams import own_teams
from services.reference_series_access import SeriesAccess, require_series_editor
from services.scoring_rules import MAX_CUSTOM_BONUSES

router = APIRouter(prefix="/api/reference-series", tags=["reference-series"],
                   dependencies=[Depends(reference_running_cache.reset_after_write)])

BASE = "/admin/series/{series_id}/season-table"
TEAM_LEAGUE = ("Eine Saisontabelle mit Punkten je Runde gibt es für Fahrer- und Spielerwertungen - die Team-Liga "
               "trägt Spiele ein.")
CHANGED = "Seit der Vorschau hat sich etwas geändert – bitte die Vorschau neu laden."
UNCLEAR = "In dieser Runde sind noch gelbe Zellen offen - bitte zuerst klären."
BROKEN = "Die Ergebnisse der Serie lassen sich so nicht werten – bitte die veröffentlichten Blätter prüfen."
SELECTABLE = ("new", "changed")
# Platz, Punkte (wie sie zählen, ``season_table.with_totals``), Marken, Sonderboni und Team kommen aus der Tabelle -
# und zählen als Abweichung.
SEASON_COMPARED = ("place", "points_total", "marks", "bonus_keys", "team")
# Was die Tabelle nicht kennt, bleibt aus dem vorhandenen Blatt.
SEASON_KEPT = ("note", "start_number", "grid", "time", "gap", "penalty_seconds", "day_rounds", "day_points",
               "partner_id")
ROUND_FIELDS = ("id", "code", "title", "venue", "session", "club_day", "status", "country_code")


# ---------------------------------------------------------------- Vertrag
class SeasonColumn(BaseModel):
    label: str = Field(default="", max_length=80)
    round_id: Optional[str] = Field(default=None, max_length=80)


class SeasonRow(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    team: Optional[str] = Field(default=None, max_length=120)
    cells: List[str] = Field(default_factory=list, max_length=season_table.MAX_COLUMNS)
    total: Optional[float] = Field(default=None, ge=-results.TOTAL_LIMIT, le=results.TOTAL_LIMIT,
                                   allow_inf_nan=False)
    rank: Optional[int] = Field(default=None, ge=1, le=1000)

    @field_validator("cells")
    @classmethod
    def _cells(cls, value):
        if any(len(cell) > season_table.MAX_CELL for cell in value):
            raise ValueError(f"Zelle höchstens {season_table.MAX_CELL} Zeichen.")
        return value


class SeasonDecision(BaseModel):
    column: int = Field(ge=0, lt=season_table.MAX_COLUMNS)
    row: int = Field(ge=0, lt=season_table.MAX_ROWS)
    choice: Literal["place", "organizer"]
    place: Optional[int] = Field(default=None, ge=1, le=1000)
    bonus_keys: List[str] = Field(default_factory=list, max_length=MAX_CUSTOM_BONUSES)
    marks: List[Literal["fastest_lap", "pole"]] = Field(default_factory=list, max_length=2)


class SeasonTableInput(BaseModel):
    columns: List[SeasonColumn] = Field(min_length=1, max_length=season_table.MAX_COLUMNS)
    rows: List[SeasonRow] = Field(min_length=1, max_length=season_table.MAX_ROWS)
    team_column: bool = False
    points: Literal["scheme", "organizer"] = "scheme"
    decisions: List[SeasonDecision] = Field(default_factory=list,
                                            max_length=season_table.MAX_ROWS * season_table.MAX_COLUMNS)


class SeasonApplyItem(BaseModel):
    column: int = Field(ge=0, lt=season_table.MAX_COLUMNS)
    round_id: str = Field(min_length=1, max_length=80)
    expected_version: int = Field(default=0, ge=0)


class SeasonApplyBody(SeasonTableInput):
    items: List[SeasonApplyItem] = Field(min_length=1, max_length=season_table.MAX_COLUMNS)


# ---------------------------------------------------------------- Hilfen
async def _require_kind(db, access: SeriesAccess) -> None:
    access.require_board()
    if await results._kind(db, access.series) == "team_league":
        raise HTTPException(409, TEAM_LEAGUE)


def _round_view(round_doc: dict | None, positions: dict[str, int]) -> dict | None:
    if not round_doc:
        return None
    return {**{key: round_doc.get(key) for key in ROUND_FIELDS}, "position": positions.get(round_doc["id"]),
            "session_kind": race_weekend.session_kind(round_doc.get("session"))}


def _positions(rounds: list[dict], weekend: dict | None) -> dict[str, int]:
    return {item["id"]: group["number"] for group in race_weekend.weekend_groups(rounds, weekend)
            for item in group["rounds"]}


def _sheet_summary(existing: dict | None) -> dict | None:
    if not existing:
        return None
    return {"status": existing.get("status"), "version": results._version(existing),
            "has_pending_draft": bool(existing.get("pending_draft"))}


def _decisions(body: SeasonTableInput) -> dict[int, dict[int, dict]]:
    out: dict[int, dict[int, dict]] = {}
    for item in body.decisions:
        out.setdefault(item.column, {})[item.row] = item.model_dump()
    return out


def _quiet(resolution, placeless: list[int]) -> None:
    """Meldungen, die hier gewollt sind, fallen weg: „Platz fehlt“ bei Zeilen ohne Platz mit Absicht (Ausfall, 0 Punkte,
    Punkte laut Veranstalter), „Punkte von Hand“ bei „Punkte laut Veranstalter übernehmen“ und „Team gibt es noch
    nicht“ - die Teams kommen aus der Tabelle selbst und sind in allen Runden gleich geschrieben."""
    quiet = set(placeless)
    resolution.warnings[:] = [item for item in resolution.warnings
                              if not (item["code"] == "place_missing" and set(item["rows"]) <= quiet)
                              and item["code"] not in ("points_manual", "team_unknown")]


def _names(participants: list[dict], resolution) -> dict[str, str]:
    names = {person["id"]: person.get("name") or "" for person in participants}
    names.update({row["participant_id"]: row["name"] for row in resolution.rows if row["participant_id"]})
    return names


class _Column:
    """Eine Spalte nach dem Zuordnen und Prüfen - mit dem Blatt, das Übernehmen schreiben würde."""

    def __init__(self, index: int, label: str, how):
        self.index, self.label, self.how = index, label, how
        self.round = self.existing = self.rules = self.built = self.resolution = self.content = None
        self.state, self.changes, self.errors, self.warnings = "skip", [], [], []

    def view(self, positions: dict[str, int]) -> dict:
        built = self.built or {}
        rows = (self.content or {}).get("rows") or []
        return {"index": self.index, "label": self.label, "how": self.how, "round": _round_view(self.round, positions),
                "state": self.state, "target": results.draft_target(self.existing) if self.round else None,
                "expected_version": results._version(self.existing), "sheet": _sheet_summary(self.existing),
                "cells": built.get("cells") or [], "unclear": built.get("unclear") or 0,
                "counts": {"rows": len(rows), "places": sum(1 for row in rows if row.get("place"))},
                "changes": self.changes, "errors": self.errors, "warnings": self.warnings}


async def _column(db, access: SeriesAccess, index: int, label: str, match: dict, round_doc: dict | None,
                  body: SeasonTableInput, teams: list, decisions: dict) -> _Column:
    item = _Column(index, label, match["how"])
    if round_doc is None:
        item.state = "skip" if match["how"] == "skip" else "unmatched"
        return item
    item.round = round_doc
    item.rules = await results._round_rules(db, access.series, round_doc)
    names = [row.name for row in body.rows]
    cells = [row.cells[index] if index < len(row.cells) else "" for row in body.rows]
    item.built = season_table.build_column(cells, item.rules, names=names, teams=teams,
                                           organizer=body.points == "organizer", decisions=decisions.get(index))
    item.existing = await results._sheet(db, access.series_id, round_doc["id"])
    if item.built["errors"]:
        item.state, item.errors = "error", item.built["errors"]
        return item
    if not item.built["rows"]:
        item.state = "empty"
        return item
    try:
        entry = results.ResultSheetInput(rows=item.built["rows"])
    except ValidationError:
        item.state = "error"
        item.errors = [{"code": "invalid_column", "message": "Diese Spalte lässt sich so nicht eintragen.", "rows": []}]
        return item
    _, participants, resolution = await results._prepare(db, access, round_doc, entry)
    _quiet(resolution, item.built["placeless"])
    item.resolution, item.errors, item.warnings = resolution, resolution.errors, resolution.warnings
    if resolution.errors:
        item.state = "error"
        return item
    base = results.draft_base(item.existing)
    item.content = partner_import.carry_over(resolution.content(), base, kept=SEASON_KEPT, keep_marks=False)
    diff = partner_import.sheet_diff(season_table.with_totals(base, item.rules),
                                     season_table.with_totals(item.content, item.rules),
                                     _names(participants, resolution), SEASON_COMPARED)
    item.changes = diff["changes"]
    item.state = "unclear" if item.built["unclear"] else diff["state"]
    return item


async def _read(db, access: SeriesAccess, body: SeasonTableInput) -> tuple[list[_Column], list[dict], list[dict]]:
    """Alle Spalten zuordnen und prüfen - ohne zu schreiben. Liefert Spalten, Termine und Teilnehmer."""
    rounds = await db.reference_rounds.find({"series_id": access.series_id}, {"_id": 0}).to_list(None)
    participants = await results._participants(db, access.series_id)
    weekend = access.series.get("weekend")
    matches = season_table.match_columns([column.label for column in body.columns],
                                         [column.round_id for column in body.columns], rounds, weekend)
    by_id = {item["id"]: item for item in rounds}
    names = [row.name for row in body.rows]
    teams = ([row.team for row in body.rows] if body.team_column
             else series_results.default_teams(names, participants))
    decisions = _decisions(body)
    columns = [await _column(db, access, index, column.label, matches[index], by_id.get(matches[index]["round_id"]),
                             body, teams, decisions)
               for index, column in enumerate(body.columns)]
    return columns, rounds, participants


def _row_pids(columns: list[_Column], count: int) -> list:
    """Teilnehmer je Zeile der Tabelle (``neu:…`` für neue Namen) - aus der ersten Spalte, in der die Zeile steht."""
    pids: list = [None] * count
    for item in columns:
        if not item.resolution:
            continue
        for position, row in enumerate(item.resolution.rows):
            table_row = item.built["row_of"][position]
            if pids[table_row] is None and row["participant_id"]:
                pids[table_row] = row["participant_id"]
    return pids


async def _totals(db, access: SeriesAccess, body: SeasonTableInput, columns: list[_Column], rounds: list[dict],
                  participants: list[dict]) -> tuple[list[dict] | None, str | None]:
    """Abgleich je Zeile: Summe der Zellen, „Gesamt“ und Platz laut Tabelle gegen den Stand nach allen Runden, als
    wären die Entwürfe veröffentlicht - mit den Gründen jeder Abweichung."""
    used = [item for item in columns if item.content is not None]
    mapped = {item.round["id"]: item for item in used}
    people = list(participants)
    seen = {person["id"] for person in people}
    for item in used:
        for person in item.resolution.new_people.values():
            if person["participant_id"] not in seen:
                seen.add(person["participant_id"])
                people.append({"id": person["participant_id"], "name": person["name"],
                               "default_team": person["team"], "link": "external"})
    sheets = {row["round_id"]: row async for row in db.reference_round_results.find(
        {"series_id": access.series_id, "status": "published"}, {"_id": 0})}
    sheets.update({rid: item.content for rid, item in mapped.items()})
    active = [{**rnd, "status": "scored"} if rnd["id"] in mapped else rnd
              for rnd in rounds if not rnd.get("archived_at")]
    series = access.series
    try:
        snapshots = race_weekend.standings(rules=series.get("rules") or {}, rounds=active, sheets=sheets,
                                           participants=people, own_teams=own_teams(series),
                                           weekend=series.get("weekend"), adjustments=series.get("adjustments"))
    except ValueError:
        return None, BROKEN
    drivers = [item for item in snapshots if item["scope"] == "drivers"]
    standing = {row["participant_id"]: row for row in (drivers[-1]["rows"] if drivers else [])}
    pids = _row_pids(columns, len(body.rows))
    names = {person["id"]: person.get("name") or "" for person in people}
    from_column = any(row.rank is not None for row in body.rows)
    ranks = season_table.table_ranks([row.rank for row in body.rows], [row.total for row in body.rows])
    taken = [item.content is not None for item in columns]
    out = []
    for index, row in enumerate(body.rows):
        values = []
        for position in range(len(columns)):
            cell = season_table.read_cell(row.cells[position] if position < len(row.cells) else "")
            values.append(cell["value"] if cell["kind"] == "points" else None)
        pid = pids[index]
        mine = standing.get(pid) if pid else None
        cell_sum, computed, parts = season_table.total_parts(values, taken, mine, set(mapped))
        explained = season_table.explain_total(row.total, computed, parts)
        rank = (mine or {}).get("rank")
        out.append({"row": index, "name": row.name, "participant_id": pid, "known_as": names.get(pid) or None,
                    "is_new": series_results.is_new(pid), "table_total": series_results.number(row.total),
                    "cell_sum": cell_sum, "computed": computed, "table_rank": ranks[index], "rank": rank,
                    "rank_differs": season_table.rank_differs(ranks[index], rank, ranks, from_column), **explained})
    return out, None


async def _unknown(db, access: SeriesAccess, columns: list[_Column]) -> list[dict]:
    seen, out = set(), []
    for item in columns:
        if not item.resolution or item.resolution.errors:
            continue
        found, _ = await results._unknown_names(db, access, item.resolution)
        for person in found:
            if person["participant_id"] in seen:
                continue
            seen.add(person["participant_id"])
            out.append({key: value for key, value in person.items() if key not in ("rows", "matches")})
    return out


# ---------------------------------------------------------------- Vorschau
@router.post(BASE + "/preview")
async def preview_season_table(series_id: str, body: SeasonTableInput,
                               access: SeriesAccess = Depends(require_series_editor)):
    """Was Übernehmen je Spalte täte, samt Abgleich mit „Gesamt“ - speichert nichts."""
    db = get_db()
    await _require_kind(db, access)
    columns, rounds, participants = await _read(db, access, body)
    totals, totals_error = await _totals(db, access, body, columns, rounds, participants)
    positions = _positions(rounds, access.series.get("weekend"))
    views = [item.view(positions) for item in columns]
    return {
        "columns": views, "rounds": [_round_view(item, positions) for item in season_table.round_choices(rounds)],
        "totals": totals, "totals_error": totals_error, "unknown_names": await _unknown(db, access, columns),
        "summary": {"rows": len(body.rows), "columns": len(columns),
                    "mapped": sum(1 for item in columns if item.round),
                    "unclear": sum(item["unclear"] for item in views),
                    "errors": sum(1 for item in views if item["state"] == "error")},
        "selectable": [item["index"] for item in views if item["state"] in SELECTABLE],
    }


# ---------------------------------------------------------------- Übernehmen
async def _apply_column(db, access: SeriesAccess, body: SeasonApplyBody, wish: SeasonApplyItem, match: dict,
                        round_doc: dict | None, teams: list, decisions: dict) -> dict:
    out = {"column": wish.column, "round_id": wish.round_id, "status": "same"}
    if round_doc is None or round_doc["id"] != wish.round_id:
        return {**out, "status": "conflict", "message": CHANGED}
    label = body.columns[wish.column].label
    item = await _column(db, access, wish.column, label, match, round_doc, body, teams, decisions)
    if item.state == "error":
        problem = (item.errors or [{"message": "Fehler in der Spalte."}])[0]["message"]
        return {**out, "status": "error", "message": problem, "errors": item.errors}
    if item.state == "unclear":
        return {**out, "status": "unclear", "message": UNCLEAR}
    if item.state in ("empty", "skip", "unmatched"):
        return {**out, "status": "same"}
    if results._version(item.existing) != wish.expected_version:
        return {**out, "status": "conflict", "message": CHANGED}
    if item.state == "same":
        return out
    written = await results.write_draft(db, access, round_doc, item.existing, item.resolution, item.content,
                                        wish.expected_version, {"source": "season_table", "column": label})
    return {**out, **written, "message": CHANGED} if written["status"] == "conflict" else {**out, **written}


@router.post(BASE + "/apply")
async def apply_season_table(series_id: str, body: SeasonApplyBody,
                             access: SeriesAccess = Depends(require_series_editor)):
    """Die gewählten Spalten als Entwurf übernehmen - je Runde nacheinander unter der Sperre der Saison (ein neuer Name
    der ersten Runde ist in der nächsten schon Teilnehmer)."""
    db = get_db()
    await _require_kind(db, access)
    wishes = sorted({item.column: item for item in body.items if item.column < len(body.columns)}.values(),
                    key=lambda item: item.column)
    if not wishes:
        raise HTTPException(422, "Bitte mindestens eine Spalte der Tabelle wählen.")
    out = []
    async with reference_series.series_write(db, series_id):
        access.series = await db.reference_series.find_one({"id": series_id}, {"_id": 0}) or access.series
        rounds = await db.reference_rounds.find({"series_id": series_id}, {"_id": 0}).to_list(None)
        participants = await results._participants(db, series_id)
        matches = season_table.match_columns([column.label for column in body.columns],
                                             [column.round_id for column in body.columns], rounds,
                                             access.series.get("weekend"))
        by_id = {item["id"]: item for item in rounds}
        names = [row.name for row in body.rows]
        teams = ([row.team for row in body.rows] if body.team_column
                 else series_results.default_teams(names, participants))
        decisions = _decisions(body)
        for wish in wishes:
            match = matches[wish.column]
            out.append(await _apply_column(db, access, body, wish, match, by_id.get(match["round_id"]), teams,
                                           decisions))
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "reference_season_table.import", "actor_id": access.user["id"],
            "target_id": series_id, "created_at": now_utc().isoformat(),
            "data": {"rows": len(body.rows), "points": body.points,
                     "items": [{key: item.get(key) for key in ("column", "round_id", "status", "target")}
                               for item in out]}})
    created = [person for item in out for person in item.get("created_participants") or []]
    return {"items": out, "created_participants": created, "open_unknown": bool(created)}
