"""Externe Serien - öffentliche Seiten (#1745 bis #1748): Serienseite, Rennliga, Team-Liga und der schlanke Endpunkt
für „Heute im Einsatz“ und „Läuft gerade“. Öffentliche Pfade unter ``/api/reference-series/public/…``, damit
eine Spur-Adresse nie mit ``/admin`` zusammenfällt; Sichtbarkeit der Serie gilt auch für Termine und Tabellen.

Die Datei samt Anmeldung in ``server.py`` steht schon seit dem Datenmodell (#1741), damit die Pakete einander nicht in
dieselben Zeilen schreiben. Modelle, Indexe und Datenschutz-Einordnung liegen in ``models.py``, ``database.py`` und
``services/personal_data.py``.

**Seite Turnierserie (#1745):** ``GET /api/reference-series/public/<spur>/<saison>`` liefert Kopf, Regeln
(Punkteschlüssel, was zählt, Vorrang, Finalgrenze), Rundenfortschritt, die Gesamtwertung und das Finale als eigene
Runde. Gerechnet wird hier nichts: die Tabelle ist der gespeicherte Stand nach der letzten gewerteten Runde
(``reference_standings``), das Finale das veröffentlichte Ergebnisblatt seiner Runde. Namen kommen beim Lesen dazu
(Entscheidung 2): fremde Namen nur als Text in der Tabelle - ohne Link und ohne Profil; ein ausgeblendeter Name kommt
gar nicht erst mit. Nur Vereinsmitglieder tragen den Link zu ihrem Vereinsprofil. Die Seite ist ``noindex``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from auth import get_optional_user
from database import get_db
from routes.reference_round_routes import PUBLIC_FIELDS, _calendar, visible_series
from services.scoring_rules import normalize_rules
from services.series_racing import racing_block
from services.team_league_page import team_league_view

router = APIRouter(prefix="/api/reference-series", tags=["reference-series"])

LINEAGE_FIELDS = ("title", "slug", "kind", "label", "organizer", "game_name", "external_url")
SERIES_FIELDS = ("season", "tier", "title", "season_slug", "status", "default_weekday", "default_time",
                 "external_url", "official_table_url", "rules_version")
RULE_FIELDS = ("points_mode", "points_by_place", "bonuses", "dnf_points", "dns_points", "dsq_points", "count_mode",
               "count_n", "activity_points", "final_top_n", "tiebreakers")
ROW_FIELDS = ("rank", "points", "computed_points", "official_points", "deviation", "activity_points", "tiebreak",
              "wins", "podiums", "rounds_played")
# Noch offen: geplant, heute, verschoben - und „Ergebnis folgt“ (vorbei, aber noch nicht gewertet).
OPEN_STATES = ("planned", "today", "postponed", "missing")
UPCOMING_STATES = ("planned", "today", "postponed")
# Von einer Person geht nur das hinaus, was die Tabelle zeigt - keine Startnummer, kein Team, keine Kennungen.
HIDDEN_PERSON = {"name": None, "name_hidden": True, "club_member": False, "profile_slug": None}


def _rules(series: dict) -> dict:
    try:
        rules = normalize_rules(series.get("rules") or {})
    except ValueError:
        rules = normalize_rules({})
    return {key: rules[key] for key in RULE_FIELDS}


async def _people(db, series_id: str) -> dict:
    """Teilnehmer der Serie mit dem, was öffentlich gezeigt wird: Name (außer ausgeblendet), Vereinsmitglied ja/nein
    und nur bei Mitgliedern der Link zum Vereinsprofil."""
    participants = await db.reference_participants.find(
        {"series_id": series_id},
        {"_id": 0, "id": 1, "name": 1, "name_hidden": 1, "is_club_member": 1, "link": 1, "profile_id": 1},
    ).to_list(None)
    member_profiles = [item["profile_id"] for item in participants
                       if item.get("is_club_member") and item.get("link") == "member" and item.get("profile_id")]
    slugs = {}
    if member_profiles:
        async for profile in db.club_member_profiles.find(
                {"id": {"$in": member_profiles}, "is_active": {"$ne": False}}, {"_id": 0, "id": 1, "slug": 1}):
            if profile.get("slug"):
                slugs[profile["id"]] = profile["slug"]
    out = {}
    for item in participants:
        member = bool(item.get("is_club_member")) and item.get("link") == "member"
        if item.get("name_hidden"):
            out[item["id"]] = {**HIDDEN_PERSON, "club_member": member}
            continue
        out[item["id"]] = {
            "name": item.get("name"), "name_hidden": False, "club_member": member,
            "profile_slug": slugs.get(item.get("profile_id")) if member else None,
        }
    return out


def _standing_row(row: dict, people: dict) -> dict:
    counted = set(row.get("counted_round_ids") or [])
    dropped = set(row.get("dropped_round_ids") or [])
    change = row.get("rank_change")
    rank = row.get("rank")
    return {
        "key": row.get("participant_id"),
        **(people.get(row.get("participant_id")) or HIDDEN_PERSON),
        **{field: row.get(field) for field in ROW_FIELDS},
        "previous_rank": None if change is None or rank is None else rank + change,
        "results": [{
            "round_id": item.get("round_id"), "place": item.get("place"), "points": item.get("points"),
            "marks": item.get("marks") or [], "counted": item.get("round_id") in counted,
            "dropped": item.get("round_id") in dropped,
        } for item in row.get("results") or []],
    }


def _public_round(item: dict) -> dict:
    return {key: item.get(key) for key in PUBLIC_FIELDS}


def _progress(rounds: list[dict]) -> dict:
    """Fortschritt der Wertungsrunden (ohne Finale und Runden außerhalb der Wertung), dazu der nächste Termin."""
    regular = [item for item in rounds if item.get("kind") != "final" and item.get("counts", True) is not False]
    live = [item for item in regular if item["state"] != "cancelled"]
    upcoming = next((item for item in rounds if item["state"] in UPCOMING_STATES), None)
    return {
        "total": len(live), "scored": sum(1 for item in live if item["state"] == "scored"),
        "cancelled": len(regular) - len(live),
        "remaining": sum(1 for item in live if item["state"] in OPEN_STATES),
        "next": _public_round(upcoming) if upcoming else None,
    }


async def _final(db, series_id: str, rounds: list[dict], people: dict) -> dict | None:
    """Das Finale als eigene Runde: Termin und, sobald veröffentlicht, die Endplatzierung aus seinem Ergebnisblatt."""
    final = next((item for item in rounds if item.get("kind") == "final"), None)
    if not final:
        return None
    sheet = await db.reference_round_results.find_one(
        {"series_id": series_id, "round_id": final["id"], "status": "published"}, {"_id": 0, "rows": 1}) or {}
    rows = [row for row in sheet.get("rows") or [] if row.get("participant_id")]
    rows.sort(key=lambda row: (row.get("place") is None, row.get("place") or 0))
    return {
        "round": _public_round(final),
        "rows": [{"key": row["participant_id"], **(people.get(row["participant_id"]) or HIDDEN_PERSON),
                  "place": row.get("place"), "points": row.get("points"), "marks": row.get("marks") or []}
                 for row in rows],
    }


@router.get("/public/{lineage_slug}/{season_slug}")
async def public_series(lineage_slug: str, season_slug: str, user: dict | None = Depends(get_optional_user)):
    """Die Serienseite: liest nur Gespeichertes (Kalender, letzter Stand, Ergebnisblatt des Finales)."""
    db = get_db()
    lineage, series = await visible_series(db, user, lineage_slug, season_slug)
    sid = series["id"]
    calendar = await _calendar(db, sid)
    rounds = calendar["rounds"]
    people = await _people(db, sid)
    latest = await db.reference_standings.find_one(
        {"series_id": sid, "scope": "drivers"},
        {"_id": 0, "round_id": 1, "round_seq": 1, "rows": 1, "computed_at": 1}, sort=[("round_seq", -1)])
    lineage_out = {key: lineage.get(key) for key in LINEAGE_FIELDS}
    if not lineage_out.get("game_name") and lineage.get("game_id"):
        game = await db.games.find_one({"id": lineage["game_id"]}, {"_id": 0, "name": 1}) or {}
        lineage_out["game_name"] = game.get("name")
    out = {
        "lineage": lineage_out,
        "series": {key: series.get(key) for key in SERIES_FIELDS},
        "rules": _rules(series),
        "today": calendar["today"],
        "progress": _progress(rounds),
        "rounds": [_public_round(item) for item in rounds],
        "standings": None if not latest else {
            "round_id": latest.get("round_id"), "round_seq": latest.get("round_seq"),
            "computed_at": latest.get("computed_at"),
            "rows": [_standing_row(row, people) for row in latest.get("rows") or []],
        },
        "final": await _final(db, sid, rounds, people),
        # Team-Liga (#1747): Tabelle, Spielplan, Aufstellung und Liga-Weg - bei anderen Arten ``None``.
        "team_league": await team_league_view(db, user, lineage, series, [_public_round(item) for item in rounds]),
    }
    if lineage.get("kind") == "racing":
        out["racing"] = await racing_block(db, user, lineage, series, people, latest)
    return out
