"""Saison abschließen (#1750): aus dem gespeicherten Endstand einer Saison wird eine Referenz - einmal.

**Vorschlag** (``proposal``): gerechnet wird nichts Neues, alles kommt aus dem gespeicherten Stand der letzten
gewerteten Runde (``reference_standings``) und den veröffentlichten Ergebnisblättern.

- **Team** (``kind: team``) je eigenem Team der Saison (#1926): bei der Team-Liga der Platz aus der Tabelle - sie ist
  die des Veranstalters, sobald ein Blatt sie trägt, sonst der eigene Stand -, sonst aus der Teamwertung, jeweils
  „von N Teams“. Spieler: wer bei der Team-Liga in einer Aufstellung eines Spiels dieses Teams stand, sonst die Fahrer,
  die für das Team gefahren sind (Team der Zeile, sonst Standard-Team). Der Kader (#1931) kommt dazu, wenn es ihn gibt.
- **Einzelwertung** (``kind: solo``) je Vereinsmitglied in der Fahrer- bzw. Gesamtwertung, „von N“. Steht die Person
  im veröffentlichten Finale, gilt der Platz im Finale.
- Nur Vereinsmitglieder (Verknüpfung „member“, Profil aktiv, Name nicht ausgeblendet) - Gäste zählen nicht in die
  Vereinsstatistik und stehen in keiner Referenz.
- **Abgebrochen** (``NO_PLACEMENT_STATUSES``, Status kommt mit #1960): dieselben Einträge, aber ohne Platz.

**Bestätigen** (``close``): Hat die Saison schon ihre Referenz (``reference_id``), wird genau diese aktualisiert -
sonst die gewählte, die schon zur Saison gehört (``series_id``), sonst entsteht eine neue. So steht jede Saison
höchstens einmal in der Vitrine. Beim Aktualisieren kommen nur Platz und Feldgröße aus der Saison; Titel, Texte,
Bezeichnungen und von Hand eingetragene Namen bleiben. Die Bezeichnung eines Eintrags (etwa „Tabelle“) ist nur eine
Vorgabe und lässt sich in der Referenz umbenennen. Punkte für die Jahreswertung entstehen dabei nie - nur Abzeichen.
"""
from __future__ import annotations

from fastapi import HTTPException

from models import ReferenceCreate, new_id, now_utc
from services.own_teams import Matcher, own_teams
from services.series_identity import normalize_name

# Status, mit denen eine Saison keine Platzierung bekommt. „cancelled“ (abgebrochen) kommt mit #1960 - bis dahin gibt
# es ihn nur in der Datenbank, der Abschluss behandelt ihn schon richtig.
NO_PLACEMENT_STATUSES = frozenset({"cancelled"})
CANCELLED_LABEL = "Saison abgebrochen"
# Vorgaben für die Bezeichnung eines Eintrags je Wertung - in der Referenz umbenennbar, beim erneuten Abschluss bleibt
# eine eigene Bezeichnung stehen.
LABELS = {"table": "Tabelle", "teams": "Teamwertung", "final": "Finale"}
DRIVER_LABELS = {"racing": "Fahrerwertung"}
DRIVER_LABEL = "Gesamtwertung"
VISIBILITY_ORDER = ("public", "community", "members", "internal")
NOT_OF_SEASON = "Diese Referenz gehört nicht zu dieser Saison - bitte eine Referenz der Saison wählen oder neu anlegen."


def _text(value) -> str:
    return " ".join(str(value or "").split())


async def _latest(db, series_id: str, scope: str) -> list[dict]:
    snapshot = await db.reference_standings.find_one(
        {"series_id": series_id, "scope": scope}, {"_id": 0, "rows": 1}, sort=[("round_seq", -1)])
    return [row for row in (snapshot or {}).get("rows") or [] if isinstance(row, dict)]


async def _club_members(db, series_id: str) -> dict[str, dict]:
    """Teilnehmer, die als Vereinsmitglied in eine Referenz dürfen: Kennung → ``{profile_id, name}``."""
    candidates = [item async for item in db.reference_participants.find(
        {"series_id": series_id, "link": "member", "is_club_member": True, "name_hidden": {"$ne": True},
         "profile_id": {"$nin": [None, ""]}},
        {"_id": 0, "id": 1, "profile_id": 1, "default_team": 1})]
    profiles = {item["id"]: item async for item in db.club_member_profiles.find(
        {"id": {"$in": list({item["profile_id"] for item in candidates})}, "is_active": {"$ne": False}},
        {"_id": 0, "id": 1, "gamertag": 1, "display_name": 1})} if candidates else {}
    out = {}
    for item in candidates:
        profile = profiles.get(item["profile_id"])
        if profile:
            out[item["id"]] = {"profile_id": profile["id"], "default_team": item.get("default_team"),
                               "name": profile.get("gamertag") or profile.get("display_name") or "Mitglied"}
    return out


def _members(ids: list[str], club: dict[str, dict]) -> list[dict]:
    seen, out = set(), []
    for pid in ids:
        member = club.get(pid)
        if member and member["profile_id"] not in seen:
            seen.add(member["profile_id"])
            out.append({"profile_id": member["profile_id"], "name": member["name"]})
    return out


async def _lineup_ids(db, series_id: str, matcher: Matcher) -> dict[str, list[str]]:
    """Team-Liga: je eigenem Team, wer in einer Aufstellung stand - in der Reihenfolge des ersten Einsatzes."""
    out: dict[str, list[str]] = {}
    sheets = await db.reference_round_results.find(
        {"series_id": series_id, "status": "published"}, {"_id": 0, "matches": 1}).to_list(None)
    for sheet in sheets:
        matches = sheet.get("matches") or []
        others = [match.get(side) for match in matches for side in ("home", "away")]
        for match in matches:
            for side in ("home", "away"):
                team = matcher.resolve(match.get(side), others)
                if team:
                    out.setdefault(team, []).extend(match.get("lineup") or [])
    return out


def _driver_team_ids(rows: list[dict], club: dict[str, dict], matcher: Matcher) -> dict[str, list[str]]:
    """Rennliga: je eigenem Team die Vereinsfahrer, die dafür gefahren sind (Team der Zeile, sonst Standard-Team)."""
    defaults = [member.get("default_team") for member in club.values() if member.get("default_team")]
    out: dict[str, list[str]] = {}
    for row in rows:
        pid = row.get("participant_id")
        member = club.get(pid)
        if not member:
            continue
        names = [item.get("team") or member.get("default_team") for item in row.get("results") or []]
        names = names or [member.get("default_team")]
        for name in names:
            team = matcher.resolve(name, defaults)
            if team and pid not in out.setdefault(team, []):
                out[team].append(pid)
    return out


async def _final_places(db, series_id: str) -> tuple[dict[str, int], int]:
    """Plätze im veröffentlichten Finale (eigene Runde, nicht archiviert) und die Größe des Finalfelds."""
    final = await db.reference_rounds.find_one(
        {"series_id": series_id, "kind": "final", "archived_at": None}, {"_id": 0, "id": 1})
    if not final:
        return {}, 0
    sheet = await db.reference_round_results.find_one(
        {"series_id": series_id, "round_id": final["id"], "status": "published"}, {"_id": 0, "rows": 1}) or {}
    rows = [row for row in sheet.get("rows") or [] if row.get("participant_id")]
    return {row["participant_id"]: row["place"] for row in rows if row.get("place")}, len(rows)


def _entry(kind: str, *, key: str, team_name=None, members=(), placement=None, label=None, team_count=None,
           participant_count=None, source: str) -> dict:
    return {"key": key, "kind": kind, "team_name": team_name,
            "member_profile_ids": [member["profile_id"] for member in members], "members": list(members),
            "placement": placement, "placement_label": label, "team_count": team_count,
            "participant_count": participant_count, "source": source}


async def proposed_entries(db, series: dict, lineage: dict) -> list[dict]:
    sid, kind = series["id"], lineage.get("kind")
    club = await _club_members(db, sid)
    teams = own_teams(series)
    matcher = Matcher(teams)
    drivers = await _latest(db, sid, "drivers") if kind != "team_league" else []
    entries: list[dict] = []

    scope = "table" if kind == "team_league" else "teams"
    rows = await _latest(db, sid, scope)
    others = [row.get("team") for row in rows]
    if kind == "team_league":
        members_of = await _lineup_ids(db, sid, matcher)
    else:
        members_of = _driver_team_ids(drivers, club, matcher)
    for team in teams:
        ranks = [row["rank"] for row in rows
                 if row.get("rank") and matcher.resolve(row.get("team"), others) == team["name"]]
        if not ranks and kind != "team_league":
            continue  # ohne Teamwertung stehen die Fahrer als Einzelwertung da - kein leerer Team-Eintrag
        entries.append(_entry("team", key=f"team:{normalize_name(team['name'])}", team_name=team["name"],
                              members=_members(members_of.get(team["name"], []), club),
                              placement=min(ranks) if ranks else None, label=LABELS[scope],
                              team_count=len(rows) or None, source=scope))

    final_places, final_size = await _final_places(db, sid)
    solo = []
    for row in drivers:
        pid = row.get("participant_id")
        if pid not in club:
            continue
        member = _members([pid], club)
        if pid in final_places:
            solo.append(_entry("solo", key=f"solo:{club[pid]['profile_id']}", members=member,
                               placement=final_places[pid], label=LABELS["final"], participant_count=final_size,
                               source="final"))
        else:
            solo.append(_entry("solo", key=f"solo:{club[pid]['profile_id']}", members=member,
                               placement=row.get("rank"), label=DRIVER_LABELS.get(kind, DRIVER_LABEL),
                               participant_count=len(drivers) or None, source="drivers"))
    seen = set()
    for entry in sorted(solo, key=lambda item: (item["placement"] is None, item["placement"] or 0)):
        if entry["key"] not in seen:  # eine Person mit zwei Schreibweisen steht nur einmal da
            seen.add(entry["key"])
            entries.append(entry)

    if series.get("status") in NO_PLACEMENT_STATUSES:
        for entry in entries:
            entry["placement"] = None
            entry["placement_label"] = CANCELLED_LABEL
    return entries


async def _dates(db, series_id: str) -> tuple[str | None, str | None]:
    days = sorted([item["club_day"] async for item in db.reference_rounds.find(
        {"series_id": series_id, "archived_at": None, "status": {"$ne": "cancelled"},
         "club_day": {"$nin": [None, ""]}}, {"_id": 0, "club_day": 1})])
    return (days[0], days[-1]) if days else (None, None)


def _visibility(*levels) -> str:
    known = [level for level in levels if level in VISIBILITY_ORDER]
    return max(known, key=VISIBILITY_ORDER.index) if known else "public"


async def proposed_reference(db, series: dict, lineage: dict) -> dict:
    """Die Kopfdaten einer neuen Referenz aus Spur und Saison."""
    start, end = await _dates(db, series["id"])
    return {
        "title": _text(series.get("title")) or _text(lineage.get("title")),
        "organizer": lineage.get("organizer") or None, "league": series.get("tier") or None,
        "season": series.get("season") or None, "format": lineage.get("label") or None,
        "game_id": lineage.get("game_id") or None, "game_name": lineage.get("game_name") or None,
        "partner_ids": list(lineage.get("partner_ids") or []), "start_date": start, "end_date": end,
        "external_url": series.get("external_url") or lineage.get("external_url") or None,
        "result_url": series.get("official_table_url") or None,
        "visibility": _visibility(lineage.get("visibility"), series.get("visibility")),
    }


def _placement(entry: dict) -> int | None:
    try:
        value = int(entry.get("placement") or 0)
    except (TypeError, ValueError):
        return None
    return value if value >= 1 else None


def reference_summary(reference: dict | None) -> dict | None:
    """„Referenz: Platz 6 von 8“ - der beste Eintrag der Referenz; ohne Platz nur Titel und Kennung."""
    if not reference:
        return None
    entries = [entry for entry in reference.get("entries") or [] if isinstance(entry, dict)]
    placed = [entry for entry in entries if _placement(entry)]
    best = min(placed, key=_placement) if placed else (entries[0] if entries else {})
    return {"id": reference["id"], "title": reference.get("title"), "placement": _placement(best),
            "of": best.get("team_count") or best.get("participant_count"), "label": best.get("placement_label"),
            "team": best.get("kind") != "solo" if best else False}


async def candidates(db, series: dict) -> tuple[dict | None, list[dict]]:
    """Die Referenz der Saison (``reference_id``) und alle Referenzen, die zur Saison gehören (``series_id``) - die
    der Saison zuerst, sonst die neueste zuerst."""
    current = None
    if series.get("reference_id"):
        current = await db.references.find_one({"id": series["reference_id"]}, {"_id": 0})
    linked = await db.references.find({"series_id": series["id"]}, {"_id": 0}).to_list(None)
    linked.sort(key=lambda item: str(item.get("start_date") or item.get("created_at") or ""), reverse=True)
    rows = ([current] if current else []) + [item for item in linked if not current or item["id"] != current["id"]]
    return current, rows


async def proposal(db, series: dict, lineage: dict) -> dict:
    current, rows = await candidates(db, series)
    open_rounds = await db.reference_rounds.count_documents({
        "series_id": series["id"], "archived_at": None, "counts": {"$ne": False},
        "status": {"$nin": ["scored", "cancelled"]}})
    return {
        "cancelled": series.get("status") in NO_PLACEMENT_STATUSES,
        "open_rounds": open_rounds,
        "entries": await proposed_entries(db, series, lineage),
        "reference": await proposed_reference(db, series, lineage),
        "current": reference_summary(current),
        "candidates": [{"id": item["id"], "title": item.get("title"), "season": item.get("season"),
                        "start_date": item.get("start_date"), "placement": item.get("placement")} for item in rows],
        # Vorgewählt: die Referenz der Saison, sonst die einzige bzw. neueste, die schon zur Saison gehört.
        "target_id": rows[0]["id"] if rows else None,
    }


def _entry_doc(entry: dict) -> dict:
    return {key: entry.get(key) for key in ("kind", "team_name", "member_profile_ids", "placement",
                                            "placement_label", "participant_count", "team_count")}


def _match_key(entry: dict) -> str | None:
    if entry.get("kind") == "solo":
        ids = entry.get("member_profile_ids") or []
        return f"solo:{ids[0]}" if len(ids) == 1 else None
    name = normalize_name(entry.get("team_name"))
    return f"team:{name}" if name else None


def merge_entries(existing: list[dict], proposed: list[dict]) -> list[dict]:
    """Einträge der bestehenden Referenz mit dem Vorschlag zusammenführen: gleicher Eintrag (Team nach Name, Einzel nach
    Person) bekommt Platz und Feldgröße aus der Saison und die Vereinsspieler dazu; eine eigene Bezeichnung und von
    Hand eingetragene Namen bleiben. Neue Einträge kommen dazu, übrige bleiben, wie sie sind."""
    out = [dict(entry) for entry in existing if isinstance(entry, dict)]
    index = {_match_key(entry): position for position, entry in enumerate(out) if _match_key(entry)}
    for entry in proposed:
        position = index.get(entry["key"])
        if position is None:
            out.append(_entry_doc(entry))
            continue
        target = out[position]
        ids = list(dict.fromkeys([*(target.get("member_profile_ids") or []), *entry["member_profile_ids"]]))
        target.update({"placement": entry["placement"], "participant_count": entry["participant_count"],
                       "team_count": entry["team_count"], "member_profile_ids": ids,
                       "placement_label": target.get("placement_label") or entry["placement_label"]})
    return out


FILL_FIELDS = ("organizer", "league", "season", "format", "game_id", "game_name", "start_date", "end_date",
               "external_url", "result_url")


async def close(db, series: dict, lineage: dict, reference_id: str | None, me: dict, freeze) -> dict:
    """Bestätigen: Referenz anlegen oder aktualisieren, die Saison vermerkt sie und gilt als abgeschlossen. ``freeze``
    normalisiert die Einträge wie das Referenz-Formular (``news_routes._freeze_reference_members``)."""
    current, rows = await candidates(db, series)
    if current:
        target = current  # die Referenz der Saison - nie eine zweite daneben
    elif reference_id:
        target = next((item for item in rows if item["id"] == reference_id), None)
        if target is None:
            raise HTTPException(422, NOT_OF_SEASON)
    else:
        target = None
    entries = await proposed_entries(db, series, lineage)
    now = now_utc().isoformat()
    if target is None:
        fields = await proposed_reference(db, series, lineage)
        doc = ReferenceCreate(**fields, status="completed", series_id=series["id"],
                              entries=[_entry_doc(entry) for entry in entries]).model_dump()
        await freeze(db, doc)
        doc.update({"id": new_id(), "created_at": now, "updated_at": now})
        await db.references.insert_one(doc)
        reference_id, created = doc["id"], True
    else:
        fields = await proposed_reference(db, series, lineage)
        updates = {"entries": merge_entries(target.get("entries") or [], entries), "series_id": series["id"],
                   "status": "completed", "updated_at": now,
                   **{key: fields[key] for key in FILL_FIELDS if fields.get(key) and not target.get(key)}}
        await freeze(db, updates, target)
        await db.references.update_one({"id": target["id"]}, {"$set": updates})
        reference_id, created = target["id"], False

    series_updates = {"reference_id": reference_id, "closed_at": now, "closed_by": me["id"], "updated_at": now,
                      "updated_by": me["id"]}
    if series.get("status") in ("planned", "active"):
        series_updates["status"] = "completed"
    await db.reference_series.update_one({"id": series["id"]}, {"$set": series_updates})
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "reference_series.close", "actor_id": me["id"], "target_id": series["id"],
        "data": {"reference_id": reference_id, "created": created,
                 "entries": [{key: entry.get(key) for key in ("kind", "placement", "team_count", "participant_count")}
                             for entry in entries]},
        "created_at": now,
    })
    await _request_badges(db, entries)
    return {"reference_id": reference_id, "created": created}


async def _request_badges(db, entries: list[dict]) -> None:
    """Abzeichen („Podest extern“, „Dauerbrenner“) für die Spieler der Referenz neu auswerten - ohne Punkte für die
    Jahreswertung."""
    profile_ids = list({pid for entry in entries for pid in entry.get("member_profile_ids") or []})
    if not profile_ids:
        return
    user_ids = [item["user_id"] async for item in db.club_member_profiles.find(
        {"id": {"$in": profile_ids}, "user_id": {"$nin": [None, ""]}}, {"_id": 0, "user_id": 1})]
    if user_ids:
        from services.achievement_queue import request_evaluation

        await request_evaluation(user_ids, "references", sources=["club"])
