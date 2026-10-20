"""Externe Serien - Ergebnisse eintragen (#1744): Vorschau, Übernehmen mit Version (409), Revision, Protokoll und
Freigabe durch den Vorstand.

Alle Endpunkte liegen unter ``/api/reference-series/admin/series/{series_id}/rounds/{round_id}/results`` und gelten für
den Vorstand (Bereich Redaktion) und gültige Captains dieser Saison (``require_series_editor``, #1749). Der Termin muss
zur Serie aus dem Pfad gehören (sonst 404). Der Text-Parser zum Einfügen einer Liste liegt in der Oberfläche (P5b) - der
Server nimmt nur strukturierte Zeilen. Kurzfassung des Vertrags: ``docs/entwicklung/serien-ergebnisse.md``.

**GET …/results** - Ausgangsstand zum Eintragen::

    {round, series: {id, kind, team_name, rules, publish_mode}, access: {role, can_publish, valid_until?},
     version, sheet | null, target: "sheet" | "pending_draft",
     participants: [{id, name, start_number, default_team, kind, is_club_member*, link_status*}]}

``version`` ist 0, solange es kein Blatt gibt. ``sheet`` enthält ``rows``, ``matches``, ``official_totals``,
``official_team_totals``, ``official_table``, ``note``, ``status`` („draft“/„published“), ``version`` und
``pending_draft`` (Entwurf neben dem veröffentlichten Blatt oder ``null``). ``target`` sagt, wohin Übernehmen schreibt.
Captains bekommen keine ``*_by``-Kennungen.

**Captains** sehen nur, wer bekannt ist und wer neu - keine Zuordnung, keinen Alias, keine Vereinsmitgliedschaft
(Aliase und Verknüpfungen liest nur die Verwaltung, #1743). Mit ``*`` markierte Felder bekommt nur der Vorstand.

**POST …/results/preview** - ändert nichts. Body (``ResultSheetInput``)::

    {rows: [{participant_id? | name?, start_number?, place?, team?, points?, points_source: "scheme"|"organizer"|
             "manual", marks: ["dnf"|"dns"|"dsq"|"fastest_lap"|"pole"], penalty_points: 0, official_total?, note?}],
     matches: [{home, away, home_score, away_score, maps: [{name, home_score, away_score}],
                lineup: [{participant_id? | name?, start_number?}]}],
     official_team_totals: {"<Team>": Zahl}, official_table: [{team, rank?, played?, won?, drawn?, lost?,
                                                                score_for?, score_against?, score_diff?, points?}],
     note?}

Antwort::

    {round, access, version, sheet_status, has_pending_draft, target, can_save, errors: [Problem], warnings: [Problem],
     rows: [{index, participant_id, match, name, is_new, is_club_member*, place, team, marks, points, points_source,
             scored: {points, base, bonus, penalty, source, participated}}],
     matches, unknown_names: [{participant_id, name, start_number, team, rows, matches, auto_assigned*, alias*,
                               suggestions*}],
     club_members*: [{participant_id, name, profile_name}],
     standings: {round_seq, scopes: {drivers|teams|table: [Zeile mit rank, rank_change, points, computed_points,
                                                          official_points, deviation, … name, is_new,
                                                          is_club_member*]}} | null,
     final: {top_n, participant_ids, entered, left} | null, latest: {round_id, round_seq, scopes} | null}

``Problem`` ist ``{code, message, rows: [Index der Zeile], match?, places?, scope?}``. ``match`` sagt, wie eine Zeile
gefunden wurde: ``id``, ``name``, ``name_untagged``, ``start_number`` oder ``new``. Neue Namen haben in der Vorschau
die Kennung ``neu:<Schlüssel>``. ``standings`` ist der Zwischenstand nach diesem Termin, als wäre das Blatt
veröffentlicht; ``rank_change`` vergleicht mit dem Termin davor. ``latest`` kommt nur, wenn danach schon Termine
gewertet sind.

**PUT …/results** - übernehmen. Body: wie die Vorschau plus ``status`` („draft“ | „published“) und
``expected_version`` (Pflicht; 0 für ein neues Blatt). Antwort::

    {target, version, sheet, created_participants: [{id, name, link*, link_status*}], recomputed, warnings}

- **Nacheinander:** Speichern, Freigeben und Verwerfen laufen - wie alle Kalender-Änderungen der Saison - unter der
  Sperre je Saison (``reference_series.series_write``, ``services/mutation_lock.py``): Versionsprüfung, Schreiben,
  Termin-Status, Aufräumen und Neurechnen ohne fremdes Schreiben dazwischen. Ist die Sperre zu lange besetzt: 409 mit
  der Bitte, es gleich noch einmal zu versuchen.
- **409**, wenn ``expected_version`` nicht mehr stimmt (veralteter Stand der Seite; geschrieben wird zusätzlich atomar
  bedingt). **422** mit ``{message, errors, warnings}``, wenn die Prüfung Fehler hat. **403**, wenn
  ``status: "published"`` ohne Recht zum Veröffentlichen (``access.result_status``).
- Jede Änderung legt den alten Stand als Revision ab (``reference_round_result_revisions``), schreibt ins
  Adminprotokoll (``reference_result.save``) und rechnet die Stände neu, wenn das Blatt veröffentlicht ist oder war.
  Veröffentlichen setzt den Termin auf „gewertet“ (der Status davor bleibt in ``scored_from``), Zurücknehmen stellt ihn
  wieder her.
- **Entwurf daneben:** Ist das Blatt veröffentlicht und die Person darf nicht veröffentlichen (``access.edit_target``
  = ``EDIT_PENDING_DRAFT``), wird die Änderung als ``pending_draft`` neben dem Blatt gespeichert
  (``reference_result.pending_draft``) - das veröffentlichte Blatt bleibt sichtbar und zählt weiter.
- Unbekannte Namen werden als offene Teilnehmer angelegt (Dialog „Unbekannte Namen“, #1743); ein bestätigter Alias
  ordnet sie gleich zu. Entfernt werden sie nur unter der Sperre und nur, solange sie offen sind (keine Zuordnung,
  kein Alias - beides steht im Löschfilter, falls der Vorstand dazwischen zuordnet) und in keinem Blatt der Saison
  stehen (``series_participants.remove_unused_new``).

**POST …/results/approve** und **POST …/results/discard** (nur Vorstand), Body ``{expected_version}``: Freigeben
veröffentlicht den Entwurf daneben (ohne einen solchen das Blatt im Entwurf) samt Revision, Protokoll
(``reference_result.approve``) und Neurechnen; Verwerfen entfernt den Entwurf daneben (``reference_result.discard``),
das veröffentlichte Blatt bleibt. Teilnehmer, die nur Entwürfe dieses Blatts neu angelegt haben
(``pending_draft.created_participant_ids``) und die noch offen und in keinem Blatt der Saison stehen, gehen mit
(``removed_participants``) - beim Verwerfen und ebenso beim Freigeben (dann nur, wer aus ersetzten Entwürfen übrig
ist). Ohne etwas freizugeben oder zu verwerfen: 409.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from database import get_db
from match_rules import RESULT_MAX_SCORE
from models import ReferencePointsSource, ReferenceResultMark, ReferenceResultStatus, new_id, now_utc
from services import reference_series, series_identity, series_results
from services.dolibarr_policy import club_today
from services.reference_series_access import EDIT_PENDING_DRAFT, SeriesAccess, require_series_editor
from services.scoring_rules import normalize_rules, result_points, validate_sheet
from services.series_participants import build_index, new_participant, remove_unused_new
from services.series_standings import compute_standings

router = APIRouter(prefix="/api/reference-series", tags=["reference-series"])

BASE = "/admin/series/{series_id}/rounds/{round_id}/results"
MAX_ROWS = 500
MAX_MATCHES = 50
MAX_MAPS = 15
MAX_LINEUP = 40
MAX_TABLE = 100
TOTAL_LIMIT = 100_000
STALE = "Das Ergebnis wurde inzwischen geändert – bitte neu laden."
BROKEN_RULES = "Die Regeln der Serie lassen sich nicht anwenden – bitte in der Saison prüfen."
BROKEN_SHEETS = "Die Ergebnisse der Serie lassen sich so nicht werten – bitte die veröffentlichten Blätter prüfen."
ROUND_FIELDS = ("id", "order", "code", "title", "venue", "club_day", "starts_at", "status", "kind", "counts",
                "opponent")
PARTICIPANT_FIELDS = ("id", "name", "start_number", "default_team", "kind", "is_club_member", "link_status")
# Captains: nur, wer in der Saison steht - Zuordnung, Alias und Vereinsmitgliedschaft liest nur die Verwaltung (#1743).
CAPTAIN_PARTICIPANT_FIELDS = ("id", "name", "start_number", "default_team", "kind")


# ---------------------------------------------------------------- Vertrag
class ResultParticipantRef(BaseModel):
    """Wer gemeint ist: ``participant_id`` (Teilnehmer dieser Saison) oder ``name`` wie beim Veranstalter, dazu
    optional ``start_number`` - sie entscheidet, wenn der Name nicht (eindeutig) passt."""
    participant_id: Optional[str] = Field(default=None, max_length=80)
    name: Optional[str] = Field(default=None, max_length=120)
    start_number: Optional[str] = Field(default=None, max_length=10)


class ResultEntryRow(ResultParticipantRef):
    """Eine Zeile: Platz, Team in diesem Rennen, Punkte (zählen bei „Punkte nach Schlüssel“ nur mit ``points_source``
    „manual“ oder „organizer“), Marken, Strafpunkte und der offizielle Gesamtstand nach der Runde (optional)."""
    place: Optional[int] = Field(default=None, ge=1, le=1000)
    team: Optional[str] = Field(default=None, max_length=120)
    points: Optional[float] = Field(default=None, ge=-10000, le=10000, allow_inf_nan=False)
    points_source: ReferencePointsSource = "scheme"
    marks: List[ReferenceResultMark] = Field(default_factory=list, max_length=5)
    penalty_points: float = Field(default=0, ge=0, le=10000, allow_inf_nan=False)
    official_total: Optional[float] = Field(default=None, ge=-TOTAL_LIMIT, le=TOTAL_LIMIT, allow_inf_nan=False)
    note: Optional[str] = Field(default=None, max_length=300)


class ResultMapEntry(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    home_score: float = Field(ge=0, le=RESULT_MAX_SCORE, allow_inf_nan=False)
    away_score: float = Field(ge=0, le=RESULT_MAX_SCORE, allow_inf_nan=False)


class ResultMatchEntry(BaseModel):
    """Team-Liga: das eigene Spiel mit Ergebnis, Maps und Aufstellung (wer gespielt hat)."""
    home: str = Field(min_length=1, max_length=120)
    away: str = Field(min_length=1, max_length=120)
    home_score: float = Field(ge=0, le=RESULT_MAX_SCORE, allow_inf_nan=False)
    away_score: float = Field(ge=0, le=RESULT_MAX_SCORE, allow_inf_nan=False)
    maps: List[ResultMapEntry] = Field(default_factory=list, max_length=MAX_MAPS)
    lineup: List[ResultParticipantRef] = Field(default_factory=list, max_length=MAX_LINEUP)


class ResultTableEntry(BaseModel):
    """Zeile der Tabelle laut Veranstalter nach diesem Spieltag (Entscheidung 3) - der offizielle Wert."""
    team: str = Field(min_length=1, max_length=120)
    rank: Optional[int] = Field(default=None, ge=1, le=1000)
    played: Optional[int] = Field(default=None, ge=0, le=1000)
    won: Optional[int] = Field(default=None, ge=0, le=1000)
    drawn: Optional[int] = Field(default=None, ge=0, le=1000)
    lost: Optional[int] = Field(default=None, ge=0, le=1000)
    score_for: Optional[float] = Field(default=None, ge=0, le=RESULT_MAX_SCORE, allow_inf_nan=False)
    score_against: Optional[float] = Field(default=None, ge=0, le=RESULT_MAX_SCORE, allow_inf_nan=False)
    score_diff: Optional[float] = Field(default=None, ge=-RESULT_MAX_SCORE, le=RESULT_MAX_SCORE, allow_inf_nan=False)
    points: Optional[float] = Field(default=None, ge=-TOTAL_LIMIT, le=TOTAL_LIMIT, allow_inf_nan=False)


class ResultSheetInput(BaseModel):
    """Ein Ergebnisblatt zum Prüfen (Vorschau)."""
    rows: List[ResultEntryRow] = Field(default_factory=list, max_length=MAX_ROWS)
    matches: List[ResultMatchEntry] = Field(default_factory=list, max_length=MAX_MATCHES)
    official_team_totals: Dict[str, float] = Field(default_factory=dict)
    official_table: List[ResultTableEntry] = Field(default_factory=list, max_length=MAX_TABLE)
    note: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("official_team_totals")
    @classmethod
    def _team_totals(cls, value: dict) -> dict:
        if len(value) > MAX_TABLE:
            raise ValueError(f"Höchstens {MAX_TABLE} Teams.")
        for team, total in value.items():
            if len(team) > 120:
                raise ValueError("Teamname höchstens 120 Zeichen.")
            if not math.isfinite(total) or abs(total) > TOTAL_LIMIT:
                raise ValueError("Teamwerte als endliche Zahl.")
        return value


class ResultSave(ResultSheetInput):
    """Übernehmen: ``expected_version`` ist der Stand, den die Seite kennt (0 ohne Blatt)."""
    status: ReferenceResultStatus = "draft"
    expected_version: int = Field(ge=0)


class ResultDecision(BaseModel):
    expected_version: int = Field(ge=0)


# ---------------------------------------------------------------- Hilfen
def _rules(series: dict) -> dict:
    try:
        return normalize_rules(series.get("rules") or {})
    except ValueError:
        raise HTTPException(422, BROKEN_RULES) from None


async def _sheet(db, series_id: str, round_id: str) -> dict | None:
    return await db.reference_round_results.find_one({"series_id": series_id, "round_id": round_id}, {"_id": 0})


def _version(sheet: dict | None) -> int:
    return int((sheet or {}).get("version") or 0)


def _require_version(sheet: dict | None, expected: int) -> None:
    if _version(sheet) != expected:
        raise HTTPException(409, STALE)


def _version_query(expected: int):
    return expected if expected else {"$in": [0, None]}


async def _update_if_current(db, sheet_id: str, expected: int, update: dict) -> dict | None:
    """Ändert das Blatt nur, wenn es noch die erwartete Version hat - atomar, und zählt die Version hoch. Liefert genau
    das Blatt, das dieses Update geschrieben hat (Stand davor plus Änderung, nicht neu gelesen: ein schnelles zweites
    Schreiben dazwischen würde sonst als das eigene gelten), oder ``None``, wenn jemand schneller war."""
    before = await db.reference_round_results.find_one_and_update(
        {"id": sheet_id, "version": _version_query(expected)}, {**update, "$inc": {"version": 1}},
        projection={"_id": 0}, return_document=ReturnDocument.BEFORE)
    if before is None:
        return None
    return {**before, **update.get("$set", {}), "version": _version(before) + 1}


def _round_view(round_doc: dict) -> dict:
    return {key: round_doc.get(key) for key in ROUND_FIELDS}


def _without_ids(doc: dict) -> dict:
    return {key: value for key, value in doc.items() if not key.endswith("_by")}


def _sheet_view(sheet: dict | None, access: SeriesAccess) -> dict | None:
    """Das Blatt für die Verwaltung; Captains ohne ``*_by``-Kennungen (wie ``SeriesAccess.series_view``)."""
    if not sheet:
        return None
    view = {key: value for key, value in sheet.items() if key != "_id"}
    if access.is_board:
        return view
    view = _without_ids(view)
    if view.get("pending_draft"):
        view["pending_draft"] = _without_ids(view["pending_draft"])
    return view


def _stamp(access: SeriesAccess) -> dict:
    return {"updated_at": now_utc().isoformat(), "updated_by": access.user["id"]}


async def _participants(db, series_id: str) -> list[dict]:
    return await db.reference_participants.find({"series_id": series_id}, {"_id": 0}).to_list(None)


async def _kind(db, series: dict) -> str | None:
    lineage = await db.reference_lineages.find_one({"id": series.get("lineage_id")}, {"_id": 0, "kind": 1}) or {}
    return lineage.get("kind")


async def _prepare(db, access: SeriesAccess, round_doc: dict, body: ResultSheetInput):
    """Zuordnen und prüfen. Liefert Regeln, Teilnehmer der Serie und die ``Resolution`` mit Fehlern und Warnungen."""
    rules = _rules(access.series)
    participants = await _participants(db, access.series_id)
    resolution = series_results.resolve(body.model_dump(), participants, rules)
    series_results.check(resolution, rules, round_doc, club_today(), access.series.get("team_name"))
    if not resolution.errors:
        # Zur Sicherheit wie beim Rechnen - die Prüfung oben fängt dieselben Fälle schon mit Zeilenangabe ab.
        try:
            validate_sheet(resolution.content(), round_doc["id"])
        except ValueError:
            resolution.errors.append({"code": "invalid_sheet", "message": "Das Blatt lässt sich so nicht werten.",
                                      "rows": []})
    return rules, participants, resolution


def _refuse(resolution: series_results.Resolution) -> None:
    if resolution.errors:
        raise HTTPException(422, {"message": "Das Blatt hat Fehler.", "errors": resolution.errors,
                                  "warnings": resolution.warnings})


# ---------------------------------------------------------------- Vorschau
async def _snapshots(db, series: dict, rules: dict, round_doc: dict, content: dict, people: list[dict]) -> list[dict]:
    """Alle Stände der Serie, als wäre ``content`` das veröffentlichte Blatt dieses Termins - wie
    ``reference_series.recompute_standings``, aber ohne zu speichern."""
    sid = series["id"]
    rounds = await db.reference_rounds.find({"series_id": sid, "archived_at": None}, {"_id": 0}).to_list(None)
    rounds = [{**item, "status": "scored"} if item["id"] == round_doc["id"] else item for item in rounds]
    sheets = {row["round_id"]: row async for row in db.reference_round_results.find(
        {"series_id": sid, "status": "published"}, {"_id": 0})}
    sheets[round_doc["id"]] = content
    try:
        return compute_standings(rules=rules, rounds=rounds, sheets=sheets, participants=people,
                                 own_teams=[series.get("team_name") or ""])
    except ValueError:
        raise HTTPException(422, BROKEN_SHEETS) from None


def _scopes(snapshots: list[dict], names: dict[str, str], club: set[str] | None) -> dict:
    """Stände mit Namen; ``is_club_member`` nur, wenn ``club`` gesetzt ist (Vorstand)."""
    out = {}
    for snapshot in snapshots:
        rows = []
        for row in snapshot["rows"]:
            pid = row.get("participant_id")
            extra = {"name": names.get(pid, ""), "is_new": series_results.is_new(pid)} if pid else {}
            if pid and club is not None:
                extra["is_club_member"] = pid in club
            rows.append({**row, **extra})
        out[snapshot["scope"]] = rows
    return out


async def _standings(db, series: dict, rules: dict, round_doc: dict, resolution, participants: list[dict],
                     club: set[str] | None) -> tuple[dict | None, dict | None, dict | None, list[dict]]:
    """Zwischenstand nach diesem Termin, Finalgrenze, neuester Stand (wenn danach schon gewertet) und Abweichungen
    zum offiziellen Wert."""
    people = participants + [{"id": person["participant_id"], "name": person["name"], "default_team": person["team"],
                              "link": "external"} for person in resolution.new_people.values()]
    names = {person["id"]: person.get("name") or "" for person in people}
    snapshots = await _snapshots(db, series, rules, round_doc, resolution.content(), people)
    mine = [index for index, item in enumerate(snapshots) if item["round_id"] == round_doc["id"]]
    if not mine:
        return None, None, None, []
    here = [snapshots[index] for index in mine]
    standings = {"round_seq": here[0]["round_seq"], "scopes": _scopes(here, names, club)}
    previous = next((item["rows"] for item in reversed(snapshots[: mine[0]]) if item["scope"] == "drivers"), None)
    drivers = standings["scopes"].get("drivers")
    final = series_results.final_line(drivers, previous, rules["final_top_n"]) if drivers is not None else None
    last_round = snapshots[-1]["round_id"]
    latest = None
    if last_round != round_doc["id"]:
        tail = [item for item in snapshots if item["round_id"] == last_round]
        latest = {"round_id": last_round, "round_seq": tail[0]["round_seq"], "scopes": _scopes(tail, names, club)}
    warnings = []
    for scope, rows in standings["scopes"].items():
        warnings.extend(series_results.official_warnings(rows, names, scope=scope))
    return standings, final, latest, warnings


async def _profile_names(db, profile_ids) -> dict[str, str]:
    wanted = sorted({pid for pid in profile_ids if pid})
    if not wanted:
        return {}
    rows = await db.club_member_profiles.find({"id": {"$in": wanted}},
                                              {"_id": 0, "id": 1, "display_name": 1, "gamertag": 1}).to_list(None)
    return {row["id"]: row.get("display_name") or row.get("gamertag") or "Mitglied" for row in rows}


async def _unknown_names(db, access: SeriesAccess, resolution) -> tuple[list[dict], list[dict]]:
    """Neue Namen. Der Vorstand bekommt Vorschläge, das Alias-Ziel und ``auto_assigned`` dazu, dazu die Namen, die ein
    bestätigter Alias gleich einem Mitglied zuordnet. Captains nur die Namen - Aliase liest nur die Verwaltung."""
    people = list(resolution.new_people.values())
    fields = ("participant_id", "name", "start_number", "team", "rows", "matches")
    if not access.is_board:
        return [{key: person[key] for key in fields} for person in people], []
    if not people:
        return [], []
    index = await build_index(db, access.series, [person["name"] for person in people])
    out, members = [], []
    for person in people:
        alias = series_identity.exact_alias(index, person["name"])
        out.append({
            **{key: person[key] for key in fields}, "auto_assigned": bool(alias),
            "alias": ({"target": alias.get("target"), "profile_id": alias.get("profile_id"),
                       "label": index.profiles.get(alias.get("profile_id")) or alias.get("guest_name")}
                      if alias else None),
            "suggestions": series_identity.suggest(index, person["name"], person["start_number"]),
        })
        if alias and alias.get("target") == "member":
            members.append({"participant_id": person["participant_id"], "name": person["name"],
                            "profile_name": index.profiles.get(alias.get("profile_id"))})
    return out, members


@router.post(BASE + "/preview")
async def preview_results(series_id: str, round_id: str, body: ResultSheetInput,
                          access: SeriesAccess = Depends(require_series_editor)):
    """Prüft das Blatt und rechnet den neuen Zwischenstand - speichert nichts."""
    db = get_db()
    round_doc = await access.round(round_id)
    existing = await _sheet(db, series_id, round_id)
    rules, participants, resolution = await _prepare(db, access, round_doc, body)
    unknown, auto_members = await _unknown_names(db, access, resolution)
    club = club_members = None
    if access.is_board:
        # Erkannte Vereinsmitglieder - Verknüpfungen und Aliase liest nur die Verwaltung (#1743).
        by_id = {person["id"]: person for person in participants}
        club_ids = {row["participant_id"] for row in resolution.rows if row["participant_id"] in by_id
                    and series_identity.counts_for_club(by_id[row["participant_id"]])}
        for match in resolution.matches:
            club_ids.update(pid for pid in match["lineup"]
                            if pid in by_id and series_identity.counts_for_club(by_id[pid]))
        profiles = await _profile_names(db, [by_id[pid].get("profile_id") for pid in club_ids])
        club_members = [{"participant_id": pid, "name": by_id[pid].get("name"),
                         "profile_name": profiles.get(by_id[pid].get("profile_id"))}
                        for pid in sorted(club_ids, key=lambda pid: str(by_id[pid].get("name") or "").casefold())]
        club_members.extend(auto_members)
        club = club_ids | {member["participant_id"] for member in auto_members}

    standings = final = latest = None
    if not resolution.errors:
        standings, final, latest, official = await _standings(db, access.series, rules, round_doc, resolution,
                                                              participants, club)
        resolution.warnings.extend(official)
    rows = []
    for row in resolution.rows:
        rows.append({
            **{key: row[key] for key in ("index", "participant_id", "match", "name", "place", "team", "marks",
                                         "points", "points_source")},
            "is_new": series_results.is_new(row["participant_id"]),
            **({"is_club_member": row["participant_id"] in club} if club is not None else {}),
            "scored": result_points(row, rules) if row["participant_id"] else None,
        })
    out = {
        "round": _round_view(round_doc), "access": access.summary(), "version": _version(existing),
        "sheet_status": (existing or {}).get("status"),
        "has_pending_draft": bool((existing or {}).get("pending_draft")),
        "target": access.edit_target(existing), "can_save": not resolution.errors,
        "errors": resolution.errors, "warnings": resolution.warnings, "rows": rows, "matches": resolution.matches,
        "unknown_names": unknown, "standings": standings, "final": final, "latest": latest,
    }
    if club_members is not None:
        out["club_members"] = club_members
    return out


# ---------------------------------------------------------------- Lesen
@router.get(BASE)
async def get_results(series_id: str, round_id: str, access: SeriesAccess = Depends(require_series_editor)):
    """Termin, Blatt (mit Entwurf daneben), Stand der Version und die Teilnehmer zur Auswahl."""
    db = get_db()
    round_doc = await access.round(round_id)
    existing = await _sheet(db, series_id, round_id)
    participants = sorted(await _participants(db, series_id),
                          key=lambda row: (str(row.get("name") or "").casefold(), str(row.get("id"))))
    return {
        "round": _round_view(round_doc),
        "series": {"id": access.series_id, "kind": await _kind(db, access.series),
                   "team_name": access.series.get("team_name"), "rules": _rules(access.series),
                   "publish_mode": access.series.get("publish_mode")},
        "access": access.summary(), "version": _version(existing), "sheet": _sheet_view(existing, access),
        "target": access.edit_target(existing),
        "participants": [{key: row.get(key) for key in (
            PARTICIPANT_FIELDS if access.is_board else CAPTAIN_PARTICIPANT_FIELDS)} for row in participants],
    }


# ---------------------------------------------------------------- Speichern
def _content(source: dict) -> dict:
    return {key: source.get(key) for key in series_results.CONTENT_FIELDS}


async def _revision(db, sheet: dict, *, kind: str, reason: str, access: SeriesAccess) -> str:
    """Der abgelöste Stand: das Blatt selbst (``kind`` „sheet“) oder der Entwurf daneben („pending_draft“)."""
    source = sheet if kind == "sheet" else sheet.get("pending_draft") or {}
    revision = {
        "id": new_id(), "result_id": sheet["id"], "series_id": sheet["series_id"], "round_id": sheet["round_id"],
        "kind": kind, "reason": reason, "version": _version(sheet),
        "status": sheet.get("status") if kind == "sheet" else "draft", "content": _content(source),
        "author_id": source.get("updated_by") or source.get("created_by"),
        "replaced_at": now_utc().isoformat(), "replaced_by": access.user["id"],
    }
    await db.reference_round_result_revisions.insert_one(dict(revision))
    return revision["id"]


async def _log(db, action: str, access: SeriesAccess, sheet: dict, data: dict) -> None:
    await db.audit_logs.insert_one({
        "id": new_id(), "action": action, "actor_id": access.user["id"], "target_id": sheet["id"],
        "data": {"series_id": sheet["series_id"], "round_id": sheet["round_id"], "role": access.role, **data},
        "created_at": now_utc().isoformat(),
    })


def _counts(content: dict) -> dict:
    return {"rows": len(content.get("rows") or []), "matches": len(content.get("matches") or []),
            "official_table": len(content.get("official_table") or [])}


async def _sync_round(db, access: SeriesAccess, round_id: str, published: bool) -> None:
    """Termin-Status nach dem Blatt: veröffentlicht heißt „gewertet“ - der Status davor bleibt in ``scored_from``;
    Zurücknehmen stellt ihn wieder her. Läuft unter der Sperre der Saison (``series_write``) wie Absagen, Verschieben
    und Archivieren - gelesen und gesetzt wird also ohne Schreiben dazwischen. Ändert sich der Status, bekommt der
    Kalender einen neuen Stand (``calendar_version``), damit offene Seiten neu laden."""
    current = await db.reference_rounds.find_one({"id": round_id, "series_id": access.series_id}, {"_id": 0})
    if not current:
        return
    status = current.get("status")
    if published and status != "scored":
        update = {"status": "scored", "scored_from": status or "planned"}
    elif not published and status == "scored":
        update = {"status": current.get("scored_from") or "planned", "scored_from": None}
    else:
        return
    await db.reference_rounds.update_one({"id": round_id, "series_id": access.series_id},
                                         {"$set": {**update, **_stamp(access)}})
    await db.reference_series.update_one({"id": access.series_id}, {"$inc": {"calendar_version": 1}})


async def _recompute(db, access: SeriesAccess) -> None:
    """Stände aus dem Stand der Datenbank (mit den aktuellen Regeln der Saison) - unter der Sperre einmal: währenddessen
    schreibt niemand ein Blatt oder einen Termin dieser Saison."""
    series = await db.reference_series.find_one({"id": access.series_id}, {"_id": 0}) or access.series
    await reference_series.recompute_standings(db, series)


async def _create_people(db, access: SeriesAccess, resolution) -> dict[str, dict]:
    """Neue Namen als offene Teilnehmer (mit bestätigtem Alias gleich zugeordnet). Schlüssel → Teilnehmer."""
    people = list(resolution.new_people.values())
    if not people:
        return {}
    index = await build_index(db, access.series, [person["name"] for person in people], with_ids=False)
    created = {}
    for person in people:
        created[person["key"]] = await new_participant(db, access.series, index, {
            "name": person["name"], "start_number": person["start_number"], "default_team": person["team"]},
            access.user)
    return created


async def _write_sheet(db, access: SeriesAccess, round_doc: dict, existing: dict | None, content: dict, status: str,
                       expected: int) -> dict | None:
    """Das Blatt selbst schreiben - atomar bedingt: neu nur, wenn es noch keins gibt, sonst nur mit der erwarteten
    Version. ``None`` heißt: jemand war schneller (unter der Sperre nur, wenn jemand ohne sie schreibt)."""
    stamp = _stamp(access)
    fields = {**content, "status": status, **stamp}
    if status == "published" and (existing or {}).get("status") != "published":
        fields.update({"published_at": stamp["updated_at"], "published_by": access.user["id"]})
    if existing is None:
        doc = {"id": new_id(), "series_id": access.series_id, "version": 1, "pending_draft": None,
               "published_at": None, "published_by": None, "created_at": stamp["updated_at"],
               "created_by": access.user["id"], **fields}
        # Genau ein Blatt je Termin (eindeutiger Index auf ``round_id``): gleichzeitig legt nur einer an.
        try:
            written = await db.reference_round_results.update_one(
                {"round_id": round_doc["id"]}, {"$setOnInsert": doc}, upsert=True)
        except DuplicateKeyError:
            return None
        if written.upserted_id is None:
            return None
        return {**doc, "round_id": round_doc["id"]}
    return await _update_if_current(db, existing["id"], expected, {"$set": fields})


async def _write_pending(db, access: SeriesAccess, existing: dict, content: dict, expected: int,
                         created_ids: list[str]) -> dict | None:
    """Entwurf daneben. ``created_participant_ids`` merkt, wen Entwürfe dieses Blatts neu angelegt haben - auch über
    ersetzte Entwürfe hinweg -, damit Verwerfen und Freigeben sie wieder entfernen können."""
    earlier = (existing.get("pending_draft") or {}).get("created_participant_ids") or []
    draft = {**content, "created_at": now_utc().isoformat(), "created_by": access.user["id"],
             "based_on_version": expected, "created_participant_ids": list(dict.fromkeys([*earlier, *created_ids]))}
    return await _update_if_current(db, existing["id"], expected, {"$set": {"pending_draft": draft}})


@router.put(BASE)
async def save_results(series_id: str, round_id: str, body: ResultSave,
                       access: SeriesAccess = Depends(require_series_editor)):
    """Übernehmen: aufs Blatt oder - veröffentlichtes Blatt, ohne Recht zum Veröffentlichen - als Entwurf daneben.
    Alles ab der Versionsprüfung läuft unter der Sperre der Saison (``reference_series.series_write``)."""
    db = get_db()
    await access.round(round_id)
    status = access.result_status(body.status)
    async with reference_series.series_write(db, series_id):
        round_doc = await access.round(round_id)  # neu gelesen: inzwischen abgesagt oder archiviert?
        existing = await _sheet(db, series_id, round_id)
        _require_version(existing, body.expected_version)
        target = access.edit_target(existing)
        _, _, resolution = await _prepare(db, access, round_doc, body)
        _refuse(resolution)

        created = await _create_people(db, access, resolution)
        own = [doc["id"] for doc in created.values()]
        content = series_results.replace_new_ids(resolution.content(),
                                                 {key: doc["id"] for key, doc in created.items()})
        if target == EDIT_PENDING_DRAFT:
            saved = await _write_pending(db, access, existing, content, body.expected_version, own)
        else:
            saved = await _write_sheet(db, access, round_doc, existing, content, status, body.expected_version)
        if saved is None:
            # Jemand ohne Sperre war schneller: die eben angelegten, noch offenen und unverwendeten Teilnehmer gehen.
            await remove_unused_new(db, series_id, own)
            raise HTTPException(409, STALE)

        revision_id = None
        if target == EDIT_PENDING_DRAFT:
            if existing.get("pending_draft"):
                revision_id = await _revision(db, existing, kind="pending_draft", reason="replace", access=access)
        elif existing:
            revision_id = await _revision(db, existing, kind="sheet", reason="save", access=access)
        was_published = (existing or {}).get("status") == "published"
        await _log(db, "reference_result.pending_draft" if target == EDIT_PENDING_DRAFT else "reference_result.save",
                   access, saved, {
                       "version": saved["version"], "previous_version": _version(existing),
                       "status": "draft" if target == EDIT_PENDING_DRAFT else status,
                       "previous_status": (existing or {}).get("status"), "revision_id": revision_id,
                       **_counts(content), "created_participants": own})
        recomputed = False
        if target != EDIT_PENDING_DRAFT:
            now_published = saved.get("status") == "published"
            await _sync_round(db, access, round_id, now_published)
            if was_published or now_published:
                await _recompute(db, access)
                recomputed = True
    return {
        "target": target, "version": saved["version"], "sheet": _sheet_view(saved, access), "recomputed": recomputed,
        "created_participants": [{key: doc.get(key) for key in (
            ("id", "name", "link", "link_status") if access.is_board else ("id", "name"))} for doc in created.values()],
        "warnings": resolution.warnings,
    }


# ---------------------------------------------------------------- Freigabe
async def _approval_errors(db, access: SeriesAccess, round_doc: dict, content: dict) -> list[dict]:
    errors = []
    if round_doc.get("archived_at") or round_doc.get("status") == "cancelled":
        errors.append({"code": "round_closed", "message": "Der Termin ist abgesagt oder archiviert.", "rows": []})
    wanted = {row.get("participant_id") for row in content.get("rows") or []}
    wanted |= {pid for match in content.get("matches") or [] for pid in match.get("lineup") or []}
    wanted.discard(None)
    known = {row["id"] async for row in db.reference_participants.find(
        {"series_id": access.series_id, "id": {"$in": sorted(wanted)}}, {"_id": 0, "id": 1})}
    if wanted - known:
        errors.append({"code": "unknown_participant", "rows": [],
                       "message": "Im Entwurf steht ein Teilnehmer, den es in der Saison nicht mehr gibt."})
    try:
        validate_sheet(content, round_doc["id"])
    except ValueError:
        errors.append({"code": "invalid_sheet", "message": "Das Blatt lässt sich so nicht werten.", "rows": []})
    return errors


@router.post(BASE + "/approve")
async def approve_results(series_id: str, round_id: str, body: ResultDecision,
                          access: SeriesAccess = Depends(require_series_editor)):
    """Vorstand: den Entwurf daneben veröffentlichen - ohne einen solchen das Blatt im Entwurf. Unter der Sperre der
    Saison."""
    access.require_board()
    db = get_db()
    await access.round(round_id)
    async with reference_series.series_write(db, series_id):
        round_doc = await access.round(round_id)
        existing = await _sheet(db, series_id, round_id)
        if existing is None:
            raise HTTPException(409, "Für diesen Termin gibt es noch kein Ergebnis.")
        _require_version(existing, body.expected_version)
        pending = existing.get("pending_draft")
        if not pending and existing.get("status") == "published":
            raise HTTPException(409, "Es gibt keinen Entwurf zur Freigabe.")
        source = pending or existing
        content = _content(source)
        errors = await _approval_errors(db, access, round_doc, content)
        if errors:
            raise HTTPException(422, {"message": "Der Entwurf hat Fehler.", "errors": errors, "warnings": []})
        stamp = _stamp(access)
        drafted_by = source.get("created_by") if pending else source.get("updated_by")
        saved = await _update_if_current(db, existing["id"], body.expected_version, {"$set": {
            **content, "status": "published", "pending_draft": None, **stamp, "published_at": stamp["updated_at"],
            "published_by": access.user["id"], "approved_at": stamp["updated_at"], "approved_by": access.user["id"],
            "drafted_by": drafted_by}})
        if saved is None:
            raise HTTPException(409, STALE)
        revision_id = await _revision(db, existing, kind="sheet", reason="approve", access=access)
        # Wen nur ersetzte Entwürfe angelegt haben, geht wie beim Verwerfen - wer im freigegebenen Blatt steht, bleibt.
        removed = await remove_unused_new(db, series_id, (pending or {}).get("created_participant_ids"))
        await _log(db, "reference_result.approve", access, saved, {
            "version": saved["version"], "previous_version": _version(existing),
            "previous_status": existing.get("status"), "from": "pending_draft" if pending else "draft",
            "drafted_by": drafted_by, "revision_id": revision_id, **_counts(content),
            "removed_participants": [{"id": row["id"], "name": row.get("name")} for row in removed]})
        await _sync_round(db, access, round_id, True)
        await _recompute(db, access)
    return {"version": saved["version"], "sheet": _sheet_view(saved, access), "recomputed": True,
            "removed_participants": [row["id"] for row in removed]}


@router.post(BASE + "/discard")
async def discard_pending_draft(series_id: str, round_id: str, body: ResultDecision,
                                access: SeriesAccess = Depends(require_series_editor)):
    """Vorstand: den Entwurf neben dem veröffentlichten Blatt verwerfen; das Blatt bleibt, wie es ist. Teilnehmer, die
    nur Entwürfe dieses Blatts neu angelegt haben und die noch offen und sonst nirgends verwendet sind, gehen mit. Unter
    der Sperre der Saison."""
    access.require_board()
    db = get_db()
    await access.round(round_id)
    async with reference_series.series_write(db, series_id):
        existing = await _sheet(db, series_id, round_id)
        if not (existing or {}).get("pending_draft"):
            raise HTTPException(409, "Es gibt keinen Entwurf zum Verwerfen.")
        _require_version(existing, body.expected_version)
        saved = await _update_if_current(db, existing["id"], body.expected_version,
                                         {"$set": {"pending_draft": None}})
        if saved is None:
            raise HTTPException(409, STALE)
        revision_id = await _revision(db, existing, kind="pending_draft", reason="discard", access=access)
        removed = await remove_unused_new(db, series_id, existing["pending_draft"].get("created_participant_ids"))
        await _log(db, "reference_result.discard", access, saved, {
            "version": saved["version"], "previous_version": _version(existing),
            "drafted_by": existing["pending_draft"].get("created_by"), "revision_id": revision_id,
            "removed_participants": [{"id": row["id"], "name": row.get("name")} for row in removed]})
    return {"version": saved["version"], "sheet": _sheet_view(saved, access),
            "removed_participants": [row["id"] for row in removed]}
