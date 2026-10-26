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
- **Abgebrochen** (``NO_PLACEMENT_STATUSES``, Status „cancelled“ seit #1960): dieselben Einträge, aber ohne Platz;
  die Saison bleibt beim Abschluss abgebrochen (wird nicht „abgeschlossen“).

**Bestätigen** (``close``): Hat die Saison schon ihre Referenz (``reference_id``), wird genau diese aktualisiert -
sonst die gewählte, die schon zur Saison gehört (``series_id``), sonst entsteht eine neue. So steht jede Saison
höchstens einmal in der Vitrine. Ohne Endstand (etwa eine Team-Liga ohne Tabelle) gibt es keinen Abschluss. Beim
Aktualisieren kommen nur Platz und Feldgröße aus der Saison, die sie wirklich hat (``merge_entries``); Titel, Texte,
Bezeichnungen, von Hand eingetragene Namen und Profile bleiben, Spieler aus der Saison folgen ihr
(``season_close_origin`` merkt sich die Herkunft). Die Referenz wird nie offener als Saison und Spur - auch nicht, wenn
diese später strenger werden (``tighten_references``, #1970). Die Bezeichnung
eines Eintrags (etwa „Tabelle“) ist nur eine Vorgabe und lässt sich in der Referenz umbenennen. Punkte für die
Jahreswertung entstehen dabei nie - nur Abzeichen.
"""
from __future__ import annotations

from fastapi import HTTPException

from models import ReferenceCreate, new_id, now_utc
from services import series_kinds
from services.own_teams import Matcher, own_teams
from services.series_identity import normalize_name

# Status, mit denen eine Saison keine Platzierung bekommt: „cancelled“ (abgebrochen, #1960).
NO_PLACEMENT_STATUSES = frozenset({"cancelled"})
CANCELLED_LABEL = "Saison abgebrochen"
# Vorgaben für die Bezeichnung eines Eintrags je Wertung - in der Referenz umbenennbar, beim erneuten Abschluss bleibt
# eine eigene Bezeichnung stehen.
LABELS = {"table": "Tabelle", "teams": "Teamwertung", "final": "Finale"}
# Die Bezeichnung der Einzelwertung („Fahrerwertung“, „Gesamtwertung“) kommt aus dem Art-Profil (#2024).
VISIBILITY_ORDER = ("public", "community", "members", "internal")
NOT_OF_SEASON = "Diese Referenz gehört nicht zu dieser Saison - bitte eine Referenz der Saison wählen oder neu anlegen."
NO_STANDING = ("Noch kein Endstand - erst Ergebnisse eintragen oder die Tabelle des Veranstalters einfügen, dann "
               "die Saison abschließen.")
REFERENCE_CHANGED = "Die Referenz wurde gerade geändert - bitte die Seite neu laden und noch einmal abschließen."


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
        if not ranks:
            # Ohne Tabelle bzw. Teamwertung kein leerer Team-Eintrag: die Team-Liga hat dann noch keinen Endstand
            # (der Abschluss sperrt), bei der Rennliga stehen die Fahrer als Einzelwertung da.
            continue
        entries.append(_entry("team", key=f"team:{normalize_name(team['name'])}", team_name=team["name"],
                              members=_members(members_of.get(team["name"], []), club),
                              placement=min(ranks), label=LABELS[scope], team_count=len(rows), source=scope))

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
                               placement=row.get("rank"), label=series_kinds.word(kind, "standings_label"),
                               participant_count=len(drivers) or None, source="drivers"))
    seen = set()
    for entry in sorted(solo, key=lambda item: (item["placement"] is None, item["placement"] or 0)):
        if entry["key"] not in seen:  # eine Person mit zwei Schreibweisen steht nur einmal da
            seen.add(entry["key"])
            entries.append(entry)

    if series.get("status") in NO_PLACEMENT_STATUSES:
        for entry in entries:
            entry.update({"placement": None, "placement_label": CANCELLED_LABEL, "cancelled": True})
    return entries


async def _dates(db, series_id: str) -> tuple[str | None, str | None]:
    days = sorted([item["club_day"] async for item in db.reference_rounds.find(
        {"series_id": series_id, "archived_at": None, "status": {"$ne": "cancelled"},
         "club_day": {"$nin": [None, ""]}}, {"_id": 0, "club_day": 1})])
    return (days[0], days[-1]) if days else (None, None)


def _visibility(*levels) -> str:
    known = [level for level in levels if level in VISIBILITY_ORDER]
    return max(known, key=VISIBILITY_ORDER.index) if known else "public"


def stricter(*levels) -> str:
    """Die strengste der Sichtbarkeiten - eine Referenz ist nie offener als ihre Saison und deren Spur."""
    return _visibility(*levels)


async def season_visibility(db, series_id: str | None) -> str | None:
    """Wie streng eine Referenz der Saison mindestens sein muss: die strengere Sichtbarkeit von Saison und Spur."""
    if not series_id:
        return None
    series = await db.reference_series.find_one({"id": series_id}, {"_id": 0, "lineage_id": 1, "visibility": 1})
    if not series:
        return None
    lineage = await db.reference_lineages.find_one({"id": series.get("lineage_id")}, {"_id": 0, "visibility": 1}) or {}
    return _visibility(lineage.get("visibility"), series.get("visibility"))


async def linked_series_ids(db, reference_id: str | None, *series_ids: str | None) -> list[str]:
    """Alle Saisons, mit denen eine Referenz verknüpft ist (#1970): ``series_ids`` (ihr ``series_id``, alt und neu) und
    jede Saison, deren ``reference_id`` auf sie zeigt."""
    ids = [sid for sid in series_ids if sid]
    if reference_id:
        ids += [item["id"] async for item in db.reference_series.find({"reference_id": reference_id},
                                                                      {"_id": 0, "id": 1})]
    return list(dict.fromkeys(ids))


async def required_visibility(db, series_ids) -> str | None:
    """Wie streng eine Referenz dieser Saisons mindestens sein muss - die strengste über alle (``None`` ohne Saison)."""
    levels = [level for sid in series_ids if (level := await season_visibility(db, sid))]
    return stricter(*levels) if levels else None


def _looser_than(required: str) -> dict:
    """Offener als gefordert: jede Stufe davor - auch fehlende oder unbekannte Werte zählen als öffentlich."""
    return {"$nin": list(VISIBILITY_ORDER[VISIBILITY_ORDER.index(required):])}


async def settle_reference(db, reference_id: str) -> str | None:
    """Nach dem Speichern einer Referenz (#1970): gilt inzwischen eine strengere Saison - etwa weil sie gleichzeitig
    verknüpft wurde -, wird die Referenz sofort so streng. Liefert die neue Sichtbarkeit, wenn angepasst wurde."""
    ref = await db.references.find_one({"id": reference_id}, {"_id": 0, "id": 1, "series_id": 1})
    if ref is None:
        return None
    required = await required_visibility(db, await linked_series_ids(db, reference_id, ref.get("series_id")))
    if not required:
        return None
    written = await db.references.update_one({"id": reference_id, "visibility": _looser_than(required)},
                                             {"$set": {"visibility": required, "updated_at": now_utc().isoformat()}})
    return required if written.modified_count else None


async def tighten_references(db, series_id: str) -> tuple[str | None, list[str]]:
    """Verknüpfte Referenzen einer Saison mindestens so streng wie Saison und Spur machen (#1970) - gleich, wenn eine
    davon strenger gestellt oder eine Referenz verknüpft wird, nicht erst beim nächsten Speichern. Verknüpft ist eine
    Referenz über ``series_id`` an ihr oder ``reference_id`` an der Saison. Nur strenger, nie offener: wer lockert,
    öffnet keine Referenz. Unter der Sperre der Saison aufrufen (``reference_series.series_write``). Liefert die
    geforderte Sichtbarkeit und die angepassten Referenzen."""
    series = await db.reference_series.find_one({"id": series_id}, {"_id": 0, "id": 1, "reference_id": 1})
    required = await season_visibility(db, series_id)
    if not series or not required:
        return required, []
    linked: list[dict] = [{"series_id": series_id}]
    if series.get("reference_id"):
        linked.append({"id": series["reference_id"]})
    looser = {"$or": linked, "visibility": _looser_than(required)}
    ids = [item["id"] async for item in db.references.find(looser, {"_id": 0, "id": 1})]
    if ids:
        # Bedingt geschrieben: was seither schon strenger gestellt wurde, bleibt so. ``updated_at`` steigt, damit ein
        # offenes Formular nicht still die alte Sichtbarkeit zurückschreibt (``expected_updated_at``).
        await db.references.update_many({**looser, "id": {"$in": ids}},
                                        {"$set": {"visibility": required, "updated_at": now_utc().isoformat()}})
    return required, ids


async def proposed_reference(db, series: dict, lineage: dict) -> dict:
    """Die Kopfdaten einer neuen Referenz aus Spur und Saison."""
    start, end = await _dates(db, series["id"])
    return {
        "title": _text(series.get("title")) or _text(lineage.get("title")),
        "organizer": lineage.get("organizer") or None, "league": series.get("tier") or None,
        "season": series.get("season") or None, "format": lineage.get("label") or None,
        "game_id": lineage.get("game_id") or None, "game_name": lineage.get("game_name") or None,
        # #1934: Partner der Spur und eigene der Saison.
        "partner_ids": list(dict.fromkeys([*(lineage.get("partner_ids") or []), *(series.get("partner_ids") or [])])),
        "start_date": start, "end_date": end,
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


def _origin(entry: dict, *, created: bool, team, label, profiles, dropped=()) -> dict:
    """Herkunft eines Eintrags (``season_close_origin``): von der Saison angelegt?, der stabile Schlüssel aus dem
    Vorschlag (eigenes Team bzw. Person, nicht der Name im Eintrag), was die Saison zuletzt als Teamnamen und
    Bezeichnung hineingeschrieben hat, welche Profile aus ihr kamen und welche jemand davon von Hand entfernt hat."""
    return {"created": created, "key": entry["key"], "team": team, "label": label, "profiles": list(profiles),
            "dropped": list(dropped)}


def new_entries(proposed: list[dict]) -> tuple[list[dict], dict]:
    """Einträge einer neuen Referenz samt Herkunft: alle stammen aus der Saison."""
    docs, origin = [], {}
    for entry in proposed:
        doc = {**_entry_doc(entry), "id": new_id()}
        docs.append(doc)
        origin[doc["id"]] = _origin(entry, created=True, team=doc["team_name"], label=doc["placement_label"],
                                    profiles=doc["member_profile_ids"])
    return docs, origin


def _has_hand_data(entry: dict, known: dict) -> bool:
    """Steckt in einem Eintrag etwas von Hand? Alles außer Platz, „von N“ und den Spielern aus der Saison: externe
    Namen, die andere Zahl, eine andere Bezeichnung oder ein anderer Teamname als die Saison geschrieben hat, eigene
    Profile."""
    if not known.get("created"):
        return True
    solo = entry.get("kind") == "solo"
    if entry.get("lineup") or entry.get("team_count" if solo else "participant_count"):
        return True
    if (entry.get("placement_label") or None) != (known.get("label") or None):
        return True
    if not solo and (entry.get("team_name") or None) != (known.get("team") or None):
        return True
    return bool(set(entry.get("member_profile_ids") or []) - set(known.get("profiles") or []))


def _find(entry: dict, free: list[dict], origin: dict, matcher: Matcher | None) -> dict | None:
    """Der bestehende Eintrag zum Vorschlag: zuerst über den stabilen Schlüssel des letzten Abschlusses, dann - wenn das
    eigene Team in der Saison umbenannt wurde - über den alten Namen, der jetzt Schreibweise ist, zuletzt über Name bzw.
    Person. Ein von Hand umbenannter Eintrag bleibt so derselbe."""
    for item in free:
        if (origin.get(item["id"]) or {}).get("key") == entry["key"]:
            return item
    if entry["kind"] == "team" and matcher:
        for item in free:
            if item.get("kind") == "solo":
                continue
            names = (item.get("team_name"), (origin.get(item["id"]) or {}).get("team"))
            if any(name and matcher.resolve(name) == entry["team_name"] for name in names):
                return item
    return next((item for item in free if _match_key(item) == entry["key"]), None)


def merge_entries(existing: list[dict], proposed: list[dict], origin: dict | None = None,
                  matcher: Matcher | None = None) -> tuple[list[dict], dict]:
    """Einträge der bestehenden Referenz mit dem Vorschlag zusammenführen. ``origin`` (an der Referenz als
    ``season_close_origin``, siehe ``_origin``) merkt sich die Herkunft je Eintrag; ``matcher`` kennt die eigenen Teams
    samt Schreibweisen.

    - Zuordnung über den stabilen Schlüssel (``_find``) - nie über einen von Hand geänderten Namen allein.
    - Aus der Saison kommen nur Platz und „von N“ (ein Team nur „von N Teams“, ein Einzel nur „von N“ - die andere Zahl
      bleibt; eine abgebrochene Saison nimmt den Platz weg) und die Saison-Spieler. Teamname und Bezeichnung folgen der
      Saison nur, solange sie niemand geändert hat; eine eigene Bezeichnung, externe Namen und von Hand ergänzte
      Profile bleiben, von Hand entfernte Saison-Spieler bleiben draußen.
    - Spieler aus der Saison folgen ihr: wer jetzt ausgeblendet, Gast oder nicht mehr dabei ist, geht.
    - Neue Einträge kommen dazu. Ein Eintrag, den die Saison angelegt hat und nicht mehr kennt, geht nur ohne
      Handdaten; mit Handdaten bleibt er, nur ohne die Spieler aus der Saison. Von Hand angelegte bleiben, wie sie sind.
    Liefert die Einträge und die neue Herkunft."""
    origin = origin or {}
    out: list[dict] = []
    for entry in existing:
        if isinstance(entry, dict):
            out.append({**entry, "id": entry.get("id") or new_id()})
    fresh: dict = {}
    for entry in proposed:
        target = _find(entry, [item for item in out if item["id"] not in fresh], origin, matcher)
        if target is None:
            doc = {**_entry_doc(entry), "id": new_id()}
            out.append(doc)
            fresh[doc["id"]] = _origin(entry, created=True, team=doc["team_name"], label=doc["placement_label"],
                                       profiles=doc["member_profile_ids"])
            continue
        known = origin.get(target["id"]) or {}
        created = bool(known.get("created"))
        from_season = set(known.get("profiles") or [])
        current = list(target.get("member_profile_ids") or [])
        dropped = set(known.get("dropped") or []) | (from_season - set(current))  # von Hand entfernt
        hand = [pid for pid in current if pid not in from_season]
        wanted = entry["member_profile_ids"]
        target["member_profile_ids"] = ([pid for pid in current if pid in hand or pid in wanted]
                                        + [pid for pid in wanted if pid not in current and pid not in dropped])
        if entry.get("cancelled"):
            target["placement"] = None
        elif entry["placement"] is not None:
            target["placement"] = entry["placement"]
        field = "participant_count" if entry["kind"] == "solo" else "team_count"
        if entry[field] is not None:
            target[field] = entry[field]
        team, label = known.get("team"), known.get("label")
        if created and entry["kind"] == "team" and (target.get("team_name") or None) == (team or None):
            target["team_name"] = team = entry["team_name"]
        untouched = created and (target.get("placement_label") or None) == (label or None)
        if untouched or not target.get("placement_label"):
            target["placement_label"] = label = entry["placement_label"]
        fresh[target["id"]] = _origin(entry, created=created, team=team, label=label,
                                      profiles=[pid for pid in wanted if pid not in hand and pid not in dropped],
                                      dropped=[pid for pid in wanted if pid in dropped])
    kept = []
    for item in out:
        known = origin.get(item["id"])
        if item["id"] not in fresh and known:
            if known.get("created") and not _has_hand_data(item, known):
                continue  # aus der Saison, unverändert, und die Saison kennt ihn nicht mehr
            season = set(known.get("profiles") or [])
            item["member_profile_ids"] = [pid for pid in item.get("member_profile_ids") or [] if pid not in season]
        kept.append(item)
    return kept, fresh


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
    if not entries:
        raise HTTPException(422, NO_STANDING)
    now = now_utc().isoformat()
    fields = await proposed_reference(db, series, lineage)
    if target is None:
        docs, origin = new_entries(entries)
        doc = ReferenceCreate(**fields, status="completed", series_id=series["id"], entries=docs).model_dump()
        await freeze(db, doc)
        doc.update({"id": new_id(), "created_at": now, "updated_at": now, "season_close_origin": origin})
        await db.references.insert_one(doc)
        reference_id, created = doc["id"], True
    else:
        merged, origin = merge_entries(target.get("entries") or [], entries, target.get("season_close_origin"),
                                       Matcher(own_teams(series)))
        updates = {"entries": merged, "series_id": series["id"], "status": "completed", "updated_at": now,
                   "season_close_origin": origin,
                   # Nie offener als Saison und Spur - sonst stünde eine Mitglieder-Saison öffentlich da.
                   "visibility": stricter(target.get("visibility"), fields["visibility"]),
                   **{key: fields[key] for key in FILL_FIELDS if fields.get(key) and not target.get(key)}}
        await freeze(db, updates, target)
        # Nur, wenn die Referenz seit dem Lesen niemand geändert hat - sonst 409, statt fremde Änderungen zu
        # überschreiben.
        written = await db.references.update_one({"id": target["id"], "updated_at": target.get("updated_at")},
                                                 {"$set": updates})
        if written.matched_count == 0:
            raise HTTPException(409, REFERENCE_CHANGED)
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
