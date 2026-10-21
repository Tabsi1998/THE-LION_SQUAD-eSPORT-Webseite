"""Externe Serien - öffentliche Seiten (#1745 bis #1748): Serienseite, Rennliga, Team-Liga und der schlanke Endpunkt
für „Heute im Einsatz“ und „Läuft gerade“, dazu „Serien und Ligen“ der Übersicht (#1878). Öffentliche Pfade unter
``/api/reference-series/public/…``, damit
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

**Runde mit Läufen (#1930):** Jeder Termin trägt seinen Lauf (``session``, ``session_kind``) und seine Runde
(``weekend``). Bei der Rennliga zählt der Fortschritt in Runden (alle zählenden Läufe einer Runde gewertet), der nächste
Termin nennt seinen Lauf, und „Läuft gerade“ bringt dazu die Läufe der Runde (``next.sessions``).
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Request

from auth import get_optional_user
from database import get_db
from routes.reference_round_routes import PUBLIC_FIELDS, _calendar, visible_series
from services import map_pools, race_weekend, reference_running_cache, series_partners
from services.dolibarr_policy import club_today
from services.own_teams import Matcher, own_teams
from services.rate_limit import enforce_rate_limit
from services.reference_calendar import calendar_view, vienna_clock
from services.scoring_rules import normalize_rules
from services.series_racing import racing_block
from services.series_standings import RACE_DETAILS
from services.team_league_page import team_league_view
from services.visibility import user_can_see

router = APIRouter(prefix="/api/reference-series", tags=["reference-series"])

LINEAGE_FIELDS = ("title", "slug", "kind", "label", "organizer", "game_name", "external_url", "tier_order")
SERIES_FIELDS = ("season", "tier", "title", "season_slug", "status", "default_weekday", "default_time",
                 "external_url", "official_table_url", "rules_version", "season_result", "weekend")
RULE_FIELDS = ("points_mode", "points_by_place", "bonuses", "dnf_points", "dns_points", "dsq_points", "count_mode",
               "count_n", "activity_points", "final_top_n", "tiebreakers")
ROW_FIELDS = ("rank", "points", "computed_points", "official_points", "deviation", "activity_points", "tiebreak",
              "wins", "podiums", "rounds_played")
# Noch offen ist jede Wertungsrunde, die nicht gewertet ist (auch „Ergebnis folgt“); kommend sind nur diese:
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
            # Rennergebnis (#1927): Startnummer, Startplatz, Zeit, Abstand, schnellste Runde, Fahrer des Tages.
            **{key: item[key] for key in RACE_DETAILS if item.get(key) not in (None, "")},
        } for item in row.get("results") or []],
    }


def _public_round(item: dict) -> dict:
    return {key: item.get(key) for key in PUBLIC_FIELDS}


def _units(rounds: list[dict], by_weekend: bool) -> list[list[dict]]:
    """Die Wertungsrunden (ohne Finale und Termine außerhalb der Wertung): je Termin - bei der Rennliga je
    Runde mit allen zählenden Läufen (#1930)."""
    regular = [item for item in rounds if item.get("kind") != "final" and item.get("counts", True) is not False]
    if not by_weekend:
        return [[item] for item in regular]
    units: dict = {}
    for item in regular:
        units.setdefault(item.get("weekend") or item["id"], []).append(item)
    return list(units.values())


def _unit_scored(unit: list[dict]) -> bool:
    return all(item["state"] == "scored" for item in unit if item["state"] != "cancelled")


def _counts(rounds: list[dict], by_weekend: bool) -> dict:
    """Wertungsrunden gesamt, gewertet und abgesagt (eine Runde ist abgesagt, wenn alle ihre Läufe es sind)."""
    units = _units(rounds, by_weekend)
    live = [unit for unit in units if any(item["state"] != "cancelled" for item in unit)]
    scored = sum(1 for unit in live if _unit_scored(unit))
    return {"total": len(live), "scored": scored, "cancelled": len(units) - len(live)}


def _progress(rounds: list[dict], by_weekend: bool = False) -> dict:
    """Fortschritt der Wertungsrunden (ohne Finale und Runden außerhalb der Wertung), dazu der nächste Termin."""
    counts = _counts(rounds, by_weekend)
    upcoming = next((item for item in rounds if item["state"] in UPCOMING_STATES), None)
    return {**counts, "remaining": counts["total"] - counts["scored"],
            "next": _public_round(upcoming) if upcoming else None}


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


RUNNING_LIMIT = 12


def _running_progress(rounds: list[dict], by_weekend: bool = False) -> dict:
    """Wertungsrunden wie ``_progress``: ohne Finale, ohne Runden außerhalb der Wertung, ohne abgesagte."""
    counts = _counts(rounds, by_weekend)
    return {"total": counts["total"], "scored": counts["scored"]}


NEXT_FIELDS = ("code", "title", "club_day", "state", "country_code", "session")


def _running_next(rounds: list[dict], by_weekend: bool = False) -> dict | None:
    """Der nächste offene Termin mit seinem Lauf - bei der Rennliga dazu alle Läufe seiner Runde (#1930), wenn es
    mehrere sind (Lauf, Tag, Uhrzeit, Status)."""
    item = next((item for item in rounds if item["state"] in UPCOMING_STATES), None)
    if not item:
        return None
    out = {**{key: item.get(key) for key in NEXT_FIELDS}, "time": vienna_clock(item.get("starts_at"))}
    sessions = [other for other in rounds if by_weekend and item.get("weekend")
                and other.get("weekend") == item.get("weekend")]
    if len(sessions) > 1:
        out["sessions"] = [{"session": other.get("session"), "club_day": other.get("club_day"),
                            "time": vienna_clock(other.get("starts_at")), "state": other["state"],
                            "next": other.get("id") == item.get("id")} for other in sessions]
    return out


def _club_place(lineage: dict, series: dict, snapshots: dict, club_ids: set) -> dict | None:
    """Platz des Vereins im letzten gespeicherten Stand: bei der Team-Liga der beste Platz eines eigenen Teams in der
    Tabelle (#1926: alle eigenen Teams, auch in anderer Schreibweise), sonst der beste Platz eines Vereinsmitglieds in
    der Gesamtwertung. Ohne Stand oder ohne Eintrag ``None``."""
    if lineage.get("kind") == "team_league":
        rows = (snapshots.get((series["id"], "table")) or {}).get("rows") or []
        own = Matcher(own_teams(series))
        others = [row.get("team") for row in rows]
        ranks = [row["rank"] for row in rows if row.get("rank") and own.is_own(row.get("team"), others)]
        return {"rank": min(ranks), "of": len(rows)} if ranks else None
    rows = (snapshots.get((series["id"], "drivers")) or {}).get("rows") or []
    ranks = [row["rank"] for row in rows if row.get("rank") and row.get("participant_id") in club_ids]
    return {"rank": min(ranks), "of": len(rows)} if ranks else None


async def _club_participant_ids(db, series_ids: list[str]) -> set:
    """Teilnehmer, die die Serienseite als Vereinsmitglied zeigt: Verknüpfung „member“, Name nicht ausgeblendet,
    Profil aktiv - zwei Abfragen für alle Serien zusammen."""
    candidates = [item async for item in db.reference_participants.find(
        {"series_id": {"$in": series_ids}, "is_club_member": True, "link": "member", "name_hidden": {"$ne": True}},
        {"_id": 0, "id": 1, "profile_id": 1})]
    profile_ids = list({item["profile_id"] for item in candidates if item.get("profile_id")})
    active = {item["id"] async for item in db.club_member_profiles.find(
        {"id": {"$in": profile_ids}, "is_active": {"$ne": False}}, {"_id": 0, "id": 1})} if profile_ids else set()
    return {item["id"] for item in candidates if item.get("profile_id") in active}


@router.get("/public/running")
async def public_running(request: Request, user: dict | None = Depends(get_optional_user)):
    """Für die Übersicht „Erfolge und Referenzen“: laufende Saisons (Status „aktiv“, Spur und Serie nicht archiviert,
    für ``user`` sichtbar) mit Fortschritt, nächstem Termin und dem Platz des Vereins - wenige Felder, kein Name.
    Höchstens ``RUNNING_LIMIT`` Saisons (heute zuerst), Runden, Stände und Teilnehmer nur für diese,
    in gesammelten Abfragen (je Sammlung eine), nie je Saison; je Adresse begrenzt. Steht heute (Wiener Tag) ein Termin an, kommt die
    Saison zuerst und trägt ``today``."""
    await enforce_rate_limit(request, "reference-running", 60, 60)
    today = club_today()
    # Startseiten-Last (#1753): die Antwort hängt nur am Tag und an den Stufen, die ``user`` sieht - gemerkt wird sie
    # je Tag und Stufe kurz (services/reference_running_cache.py), die Verwaltung leert sie bei jedem Schreiben.
    key = (today, *[await user_can_see(user, level) for level in VISIBILITY_LEVELS])
    cached = reference_running_cache.get(key)
    if cached is not None:
        return cached
    body = await _running(user, today)
    reference_running_cache.put(key, body)
    return body


VISIBILITY_LEVELS = ("community", "members", "internal")


async def _running(user: dict | None, today: str) -> dict:
    db = get_db()
    seen: dict = {}

    async def visible(value) -> bool:
        if value not in seen:
            seen[value] = await user_can_see(user, value)
        return seen[value]

    # Erst nur die schlanken Serien- und Spur-Daten, sichtbar filtern und auf RUNNING_LIMIT kürzen - Runden, Stände
    # und Teilnehmer werden danach nur für diese Serien geladen, damit die Last mit der Zahl der Serien nicht wächst.
    all_series = await db.reference_series.find({"status": "active"}, {
        "_id": 0, "id": 1, "lineage_id": 1, "visibility": 1, "season": 1, "tier": 1, "title": 1, "season_slug": 1,
        "team_name": 1, "own_teams": 1, "order_index": 1, "weekend": 1, "partner_ids": 1, "partner_roles": 1}
    ).to_list(None)
    lineages = {item["id"]: item async for item in db.reference_lineages.find(
        {"id": {"$in": list({s["lineage_id"] for s in all_series})}},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "kind": 1, "label": 1, "game_id": 1, "game_name": 1,
         "visibility": 1, "is_archived": 1, "partner_ids": 1, "partner_roles": 1})}
    visible_pairs = []
    for series in all_series:
        lineage = lineages.get(series.get("lineage_id"))
        if (lineage and not lineage.get("is_archived") and await visible(lineage.get("visibility"))
                and await visible(series.get("visibility"))):
            visible_pairs.append((lineage, series))
    if not visible_pairs:
        return {"today": today, "items": []}
    # Der nächste offene Termin je Serie in EINER Abfrage: nicht abgesagt, nicht gewertet, nicht archiviert, ab heute.
    next_day = {item["_id"]: item["day"] async for item in db.reference_rounds.aggregate([
        {"$match": {"series_id": {"$in": [series["id"] for _, series in visible_pairs]},
                    "club_day": {"$gte": today}, "status": {"$nin": ["cancelled", "scored"]},
                    "archived_at": None}},
        {"$group": {"_id": "$series_id", "day": {"$min": "$club_day"}}}])}
    # Heute zuerst (der nächste Termin ist dann heute), dann nach nächstem Termin, ohne Termin ans Ende.
    visible_pairs.sort(key=lambda pair: (next_day.get(pair[1]["id"]) or "9999", pair[1].get("order_index") or 0,
                                         str(pair[0].get("title") or "")))
    shown = visible_pairs[:RUNNING_LIMIT]
    ids = [series["id"] for _, series in shown]
    rounds_by: dict = {sid: [] for sid in ids}
    async for item in db.reference_rounds.find({"series_id": {"$in": ids}}, {"_id": 0}):
        rounds_by[item["series_id"]].append(item)
    published: dict = {sid: [] for sid in ids}
    async for item in db.reference_round_results.find(
            {"series_id": {"$in": ids}, "status": "published"}, {"_id": 0, "series_id": 1, "round_id": 1}):
        published[item["series_id"]].append(item["round_id"])
    snapshots: dict = {}
    async for snap in db.reference_standings.find(
            {"series_id": {"$in": ids}, "scope": {"$in": ["drivers", "table"]}},
            {"_id": 0, "series_id": 1, "scope": 1, "round_seq": 1, "rows.rank": 1, "rows.participant_id": 1,
             "rows.team": 1}):
        key = (snap["series_id"], snap["scope"])
        if key not in snapshots or (snap.get("round_seq") or 0) > (snapshots[key].get("round_seq") or 0):
            snapshots[key] = snap
    club_ids = await _club_participant_ids(db, ids)
    # Wie viele Vereinsmitglieder je Saison gemeldet sind (#1753, „Heute im Einsatz“ auf der Startseite): nur die Zahl.
    club_count: dict = {}
    if club_ids:
        async for item in db.reference_participants.find(
                {"id": {"$in": list(club_ids)}, "series_id": {"$in": ids}}, {"_id": 0, "series_id": 1}):
            club_count[item["series_id"]] = club_count.get(item["series_id"], 0) + 1
    game_ids = list({lineage["game_id"] for lineage, _ in shown if lineage.get("game_id")})
    games = {item["id"]: item async for item in db.games.find(
        {"id": {"$in": game_ids}}, {"_id": 0, "id": 1, "name": 1, "short_name": 1, "logo_url": 1})} if game_ids else {}

    # #1934: veranstaltende Partner (nur aktive) für das kleine Abzeichen - eine Abfrage für alle.
    organizers = await series_partners.organizers_many(db, shown)
    items = []
    for (lineage, series), hosts in zip(shown, organizers):
        rounds = race_weekend.annotate(calendar_view(rounds_by[series["id"]], published[series["id"]], today)["rounds"],
                                       series.get("weekend"))
        racing = lineage.get("kind") == "racing"
        game = games.get(lineage.get("game_id")) or {}
        items.append({
            "lineage": {"title": lineage.get("title"), "slug": lineage.get("slug"), "kind": lineage.get("kind"),
                        "label": lineage.get("label"), "game_name": lineage.get("game_name") or game.get("name")},
            "game": {key: game.get(key) for key in ("name", "short_name", "logo_url")} if game else None,
            "series": {key: series.get(key) for key in ("season", "tier", "title", "season_slug")},
            "progress": _running_progress(rounds, racing),
            "next": _running_next(rounds, racing),
            "today": any(item["state"] == "today" for item in rounds),
            "club": _club_place(lineage, series, snapshots, club_ids),
            "club_count": club_count.get(series["id"], 0),
            "organizers": hosts,
            "_order": (series.get("order_index") or 0),
        })
    items.sort(key=lambda item: (not item["today"], (item["next"] or {}).get("club_day") or "9999", item["_order"],
                                 str(item["lineage"]["title"] or "")))
    for item in items:
        item.pop("_order")
    return {"today": today, "items": items[:RUNNING_LIMIT]}


# Reihenfolge der Stufen der Spur und Ergebnis der Saison (#1898): Liga-Weg und Vitrine nutzen sie vor der Ableitung.
LINEAGE_LIST_FIELDS = ("title", "slug", "kind", "label", "organizer", "game_name", "tier_order")
PATH_SEASON_FIELDS = ("season", "tier", "title", "season_slug", "status", "season_result")


def _natural(value) -> tuple:
    """Sortierschlüssel, der Zahlen als Zahlen liest: „Saison 2“ vor „Saison 10“."""
    return tuple((0, int(part), "") if part.isdigit() else (1, 0, part.casefold())
                 for part in re.split(r"(\d+)", str(value or "")) if part)


async def _latest_snapshots(db, series_ids: list[str]) -> dict:
    """Je Serie und Wertung (Fahrer/Gesamt bzw. Tabelle) der jüngste gespeicherte Stand - eine Abfrage für alle."""
    out: dict = {}
    async for snap in db.reference_standings.aggregate([
            {"$match": {"series_id": {"$in": series_ids}, "scope": {"$in": ["drivers", "table"]}}},
            {"$sort": {"round_seq": -1}},
            {"$group": {"_id": {"series_id": "$series_id", "scope": "$scope"}, "rows": {"$first": "$rows"}}}]):
        rows = [{key: row.get(key) for key in ("rank", "participant_id", "team")} for row in snap.get("rows") or []]
        out[(snap["_id"]["series_id"], snap["_id"]["scope"])] = {"rows": rows}
    return out


@router.get("/public/lineages")
async def public_lineages(request: Request, user: dict | None = Depends(get_optional_user)):
    """Für „Serien und Ligen“ auf der Übersicht (#1878): je Spur ihre Saisons als Liga-Weg - Saison, Stufe, Status,
    unser Platz (wie bei „Läuft gerade“) und die Referenzen, die zu der Saison gehören. Nur sichtbare, nicht
    archivierte Spuren und Saisons (wie ``visible_seasons``), aber für alle Spuren zusammen: jede Sammlung wird einmal
    gelesen, nie je Spur oder Saison. Kein Name kommt mit, auch nicht der des eigenen Teams."""
    await enforce_rate_limit(request, "reference-lineages", 60, 60)
    db = get_db()
    seen: dict = {}

    async def visible(value) -> bool:
        if value not in seen:
            seen[value] = await user_can_see(user, value)
        return seen[value]

    lineages = [item async for item in db.reference_lineages.find(
        {"is_archived": {"$ne": True}},
        {"_id": 0, "id": 1, "game_id": 1, "visibility": 1, "order_index": 1, "partner_ids": 1, "partner_roles": 1,
         **{key: 1 for key in LINEAGE_LIST_FIELDS}})]
    lineages = [item for item in lineages if await visible(item.get("visibility"))]
    seasons_by: dict = {item["id"]: [] for item in lineages}
    if seasons_by:
        async for series in db.reference_series.find(
                {"lineage_id": {"$in": list(seasons_by)}, "status": {"$ne": "archived"}},
                {"_id": 0, "id": 1, "lineage_id": 1, "visibility": 1, "team_name": 1, "own_teams": 1,
                 "reference_id": 1, "partner_ids": 1, "partner_roles": 1,
                 "order_index": 1, **{key: 1 for key in PATH_SEASON_FIELDS}}):
            if await visible(series.get("visibility")):
                seasons_by[series["lineage_id"]].append(series)
    shown = [(lineage, seasons_by[lineage["id"]]) for lineage in lineages if seasons_by[lineage["id"]]]
    if not shown:
        return {"items": []}
    ids = [series["id"] for _, seasons in shown for series in seasons]
    snapshots = await _latest_snapshots(db, ids)
    club_ids = await _club_participant_ids(db, ids)
    # Referenzen der Saisons: an der Referenz (``series_id``) oder an der Serie (``reference_id``) - nur sichtbare.
    owner_of = {series["reference_id"]: series["id"] for _, seasons in shown for series in seasons
                if series.get("reference_id")}
    references_by: dict = {sid: [] for sid in ids}
    async for item in db.references.find(
            {"is_active": {"$ne": False}, "$or": [{"series_id": {"$in": ids}}, {"id": {"$in": list(owner_of)}}]},
            {"_id": 0, "id": 1, "series_id": 1, "visibility": 1}):
        owner = item.get("series_id") if item.get("series_id") in references_by else owner_of.get(item["id"])
        if owner and await visible(item.get("visibility")) and item["id"] not in references_by[owner]:
            references_by[owner].append(item["id"])
    game_ids = list({lineage["game_id"] for lineage, _ in shown if lineage.get("game_id")})
    games = {item["id"]: item async for item in db.games.find(
        {"id": {"$in": game_ids}}, {"_id": 0, "id": 1, "name": 1, "short_name": 1, "logo_url": 1})} if game_ids else {}

    shown.sort(key=lambda pair: (pair[0].get("order_index") or 0, str(pair[0].get("title") or "").casefold()))
    # #1934: veranstaltende Partner je Spur und je Saison (geerbt und eigene) - eine Abfrage für alle.
    pairs = [(lineage, None) for lineage, _ in shown] + [(lineage, s) for lineage, seasons in shown for s in seasons]
    hosts = dict(zip([(lineage["id"], (s or {}).get("id")) for lineage, s in pairs],
                     await series_partners.organizers_many(db, pairs)))
    items = []
    for lineage, seasons in shown:
        seasons.sort(key=lambda item: (_natural(item.get("season")), item.get("order_index") or 0,
                                       _natural(item.get("tier"))))
        game = games.get(lineage.get("game_id")) or {}
        items.append({
            "lineage": {**{key: lineage.get(key) for key in LINEAGE_LIST_FIELDS},
                        "game_name": lineage.get("game_name") or game.get("name"),
                        "organizers": hosts[(lineage["id"], None)]},
            "game": {key: game.get(key) for key in ("name", "short_name", "logo_url")} if game else None,
            "seasons": [{**{key: series.get(key) for key in PATH_SEASON_FIELDS},
                         "organizers": hosts[(lineage["id"], series["id"])],
                         "club": _club_place(lineage, series, snapshots, club_ids),
                         "reference_ids": references_by[series["id"]]} for series in seasons],
        })
    return {"items": items}


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
    return {
        "lineage": lineage_out,
        "series": {key: series.get(key) for key in SERIES_FIELDS},
        # #1934: „Veranstaltet von“ und Mitwirkende - nur aktive Partner.
        "partners": await series_partners.for_series_page(db, lineage, series),
        "rules": _rules(series),
        "today": calendar["today"],
        "progress": _progress(rounds, by_weekend=lineage.get("kind") == "racing"),
        "rounds": [_public_round(item) for item in rounds],
        "standings": None if not latest else {
            "round_id": latest.get("round_id"), "round_seq": latest.get("round_seq"),
            "computed_at": latest.get("computed_at"),
            "rows": [_standing_row(row, people) for row in latest.get("rows") or []],
        },
        "final": await _final(db, sid, rounds, people),
        # Team-Liga (#1747): Tabelle, Spielplan, Aufstellung und Liga-Weg - bei anderen Arten ``None``.
        "team_league": await team_league_view(db, user, lineage, series, [_public_round(item) for item in rounds]),
        # Rennliga (#1746): Saisons, Teamwertung, Team je Rennen und Vereinsteams - bei anderen Arten ``None``.
        "racing": await racing_block(db, user, lineage, series, people, latest),
        # Map-Pool der Saison (#1616) als Snapshot - ``None`` ohne Pool oder ohne Spiel der Spur.
        "map_pool": await map_pools.series_pool(db, lineage, series),
    }
