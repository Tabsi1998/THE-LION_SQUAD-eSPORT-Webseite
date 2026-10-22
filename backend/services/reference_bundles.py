"""Referenzen bündeln (#1751): bestehende Referenzen, die noch zu keiner Saison gehören, als Spur mit Saisons.

**Gruppe** (``reference_key``): gleicher Veranstalter (Freitext, sonst der erste Partner), gleiches Spiel (Kennung, sonst
Name), gleicher Modus (2vs2, 4vs4 … aus Format oder Titel) und gleiche Bezeichnung - der Titel ohne Modus, Saison,
Jahreszahlen und die Liga-Stufe der Referenz. Vorgeschlagen wird eine Gruppe ab zwei Referenzen oder wenn es die Spur
schon gibt (``lineage_key`` rechnet ihren Schlüssel genauso).

**Saison** je Referenz: das Feld „Saison“, sonst „Season 3“/„Saison 3“/„Split 2“ aus dem Titel, sonst das Jahr aus dem
Datum, zuletzt eine Jahreszahl im Titel. Die Stufe ist das Feld „Liga“ (etwa „Division 2“). Eine vorhandene Saison der
Spur mit gleicher Saison und Stufe wird gewählt, sonst entsteht eine neue - leer, nur mit dem, was die Referenzen
haben: Status, Sichtbarkeit und eigene Teams. Ergebnisse werden nie erfunden; der Platz im Liga-Weg der Vorschau ist der
beste Platz der Referenzen.

**Sichtbarkeit** (#1970): nie offener. Eine neue Saison ist so streng wie ihre strengste Referenz, eine neue Spur so
offen wie die offenste. Ist eine vorhandene Saison bzw. Spur strenger, wird die Referenz beim Bestätigen so streng
(``season_close.tighten_references``) - die Vorschau sagt es als Hinweis.

**Hinweise** aus den Altdaten: fehlendes Datum, doppelte Referenzen in einer Saison, widersprüchliche Platzierung,
eine Referenz strenger als ihre Saison, eine Saison, die schon eine Referenz hat.
"""
from __future__ import annotations

import re
from collections import Counter

from services import season_close
from services.series_identity import normalize_name

VISIBILITY_ORDER = season_close.VISIBILITY_ORDER
VISIBILITY_LABELS = {"public": "öffentlich", "community": "Community", "members": "Mitglieder", "internal": "intern"}
# Modus: „4vs4“, „4 vs 4“, „4v4“, „4vs. 4“ - auf zusammengefasstem Leerraum, je höchstens ein Leerzeichen.
MODE_RE = re.compile(r"(?<![0-9])([0-9]{1,2}) ?v(?:s)?\.? ?([0-9]{1,2})(?![0-9])", re.IGNORECASE)
SEASON_RE = re.compile(r"(?<![a-z])(season|saison|staffel|split) ?#?([0-9]{1,3})(?![0-9])")
SHORT_SEASON_RE = re.compile(r"(?<![a-z0-9])s([0-9]{1,2})(?![a-z0-9])")
YEAR_RE = re.compile(r"(?<![0-9])((?:19|20)[0-9]{2})(?![0-9])")
SEASON_WORDS = {"season": "Season", "saison": "Saison", "staffel": "Staffel", "split": "Split"}
SEPARATORS = str.maketrans({char: " " for char in "-–—:|·/#()[]{},.;!?_+&\"'"})
NO_SEASON = "Ohne Saison"
SEASON_MAX = 60
OWN_TEAMS_MAX = 20
OPEN_STATUSES = ("planned", "active", "completed")


def text(value) -> str:
    return " ".join(str(value or "").split())


# ---------------------------------------------------------------- Merkmale einer Referenz
def mode_of(*values) -> str | None:
    for value in values:
        found = MODE_RE.search(text(value))
        if found:
            return f"{int(found.group(1))}vs{int(found.group(2))}"
    return None


def _day(ref: dict) -> str:
    for key in ("start_date", "end_date"):
        value = str(ref.get(key) or "")[:10]
        if len(value) == 10 and value[:4].isdigit():
            return value
    return ""


def season_of(ref: dict) -> str | None:
    """Saison einer Referenz: Feld, sonst Saison aus dem Titel, sonst Jahr aus Datum, sonst Jahreszahl im Titel."""
    own = text(ref.get("season"))
    if own:
        return own[:SEASON_MAX]
    title = text(ref.get("title")).casefold()
    found = SEASON_RE.search(title)
    if found:
        return f"{SEASON_WORDS[found.group(1)]} {int(found.group(2))}"
    found = SHORT_SEASON_RE.search(title)
    if found:
        return f"Season {int(found.group(1))}"
    if _day(ref):
        return _day(ref)[:4]
    found = YEAR_RE.search(title)
    return found.group(1) if found else None


def _drop(token: str, league: set[str]) -> bool:
    low = token.casefold()
    return (low in SEASON_WORDS or low.isdigit() or low in league
            or (low[:1] == "s" and low[1:].isdigit() and len(low) > 1))


def label_tokens(title, league=None) -> list[str]:
    """Die Bezeichnung aus einem Titel: ohne Modus, Saison, Zahlen und die Wörter der Liga-Stufe."""
    cleaned = MODE_RE.sub(" ", text(title)).translate(SEPARATORS)
    league_words = {word.casefold() for word in text(league).translate(SEPARATORS).split()}
    return [token for token in cleaned.split() if not _drop(token, league_words)]


def organizer_key(doc: dict, roles: dict | None = None) -> str:
    name = normalize_name(doc.get("organizer"))
    if name:
        return name
    ids = [pid for pid in doc.get("partner_ids") or [] if pid]
    hosts = sorted(pid for pid in ids if (roles or {}).get(pid) == "organizer") or sorted(ids)
    return f"partner:{hosts[0]}" if hosts else ""


def game_key(doc: dict) -> str:
    if doc.get("game_id"):
        return f"id:{doc['game_id']}"
    name = normalize_name(doc.get("game_name"))
    return f"name:{name}" if name else ""


def _key(organizer: str, game: str, mode: str | None, label: list[str]) -> str | None:
    stem = normalize_name(" ".join(label))
    if not stem:
        return None
    return "|".join((organizer, game, mode or "", stem))


def reference_key(ref: dict) -> str | None:
    return _key(organizer_key(ref), game_key(ref), mode_of(ref.get("format"), ref.get("title")),
                label_tokens(ref.get("title"), ref.get("league")))


def lineage_key(lineage: dict) -> str | None:
    return _key(organizer_key(lineage, lineage.get("partner_roles")), game_key(lineage),
                mode_of(lineage.get("label"), lineage.get("title")), label_tokens(lineage.get("title")))


# ---------------------------------------------------------------- Sichtbarkeit und Platz
def strictest(*levels) -> str:
    return season_close.stricter(*levels)


def loosest(*levels) -> str:
    known = [level if level in VISIBILITY_ORDER else "public" for level in levels] or ["public"]
    return min(known, key=VISIBILITY_ORDER.index)


def _rank(level) -> int:
    return VISIBILITY_ORDER.index(level) if level in VISIBILITY_ORDER else 0


def best_place(refs: list[dict]) -> dict | None:
    """Bester Platz der Referenzen (``season_close.reference_summary``) als ``{rank, of}`` - sonst ``None``."""
    places = [summary for ref in refs if (summary := season_close.reference_summary(ref)) and summary["placement"]]
    if not places:
        return None
    best = min(places, key=lambda item: item["placement"])
    return {"rank": best["placement"], "of": best.get("of")}


def _placements(ref: dict) -> set[int]:
    summary = season_close.reference_summary(ref) or {}
    return {summary["placement"]} if summary.get("placement") else set()


def _kind(refs: list[dict]) -> str:
    """Art einer neuen Spur - in der Vorschau änderbar: Liga mit Teams → Team-Liga, Rennen → Rennliga, sonst Serie."""
    words = " ".join(text(ref.get("title")) for ref in refs).casefold()
    if any(word in words for word in ("racing", "rennliga", "grand prix", "f1")):
        return "racing"
    team = any(entry.get("kind") != "solo" for ref in refs for entry in ref.get("entries") or [] if isinstance(entry, dict))
    leaguish = any(ref.get("league") for ref in refs) or any(word in words for word in ("liga", "league"))
    return "team_league" if team and leaguish else "series"


def _own_teams(refs: list[dict]) -> list[str]:
    names: list[str] = []
    for ref in refs:
        for entry in ref.get("entries") or []:
            name = text((entry or {}).get("team_name")) if isinstance(entry, dict) and entry.get("kind") != "solo" else ""
            if name and normalize_name(name) not in {normalize_name(item) for item in names}:
                names.append(name[:120])
    return names[:OWN_TEAMS_MAX]


def _status(refs: list[dict]) -> str:
    statuses = {ref.get("status") for ref in refs}
    if "active" in statuses:
        return "active"
    if statuses == {"planned"}:
        return "planned"
    return "completed"


# ---------------------------------------------------------------- Vorschlag
def _hint(code: str, refs: list[dict], message: str, season_key: str | None = None) -> dict:
    return {"code": code, "reference_ids": [ref["id"] for ref in refs], "season_key": season_key, "text": message}


def _titles(refs: list[dict]) -> str:
    return " und ".join(f"„{text(ref.get('title'))}“" for ref in refs)


def _sort_key(ref: dict) -> tuple:
    return (_day(ref) or "9999", text(ref.get("title")).casefold(), ref["id"])


def _lineage_view(refs: list[dict], lineage: dict | None) -> dict:
    if lineage:
        return {"id": lineage["id"], "title": lineage.get("title"), "slug": lineage.get("slug"),
                "kind": lineage.get("kind"), "organizer": lineage.get("organizer"), "label": lineage.get("label"),
                "game_id": lineage.get("game_id"), "game_name": lineage.get("game_name"),
                "partner_ids": lineage.get("partner_ids") or [], "visibility": lineage.get("visibility") or "public",
                "tier_order": lineage.get("tier_order")}
    first = refs[0]
    organizers = Counter(text(ref.get("organizer")) for ref in refs if text(ref.get("organizer")))
    common = set(first.get("partner_ids") or [])
    for ref in refs[1:]:
        common &= set(ref.get("partner_ids") or [])
    return {"id": None, "title": " ".join(label_tokens(first.get("title"), first.get("league")))[:160],
            "slug": None, "kind": _kind(refs), "organizer": organizers.most_common(1)[0][0] if organizers else None,
            "label": mode_of(first.get("format"), first.get("title")),
            "game_id": next((ref["game_id"] for ref in refs if ref.get("game_id")), None),
            "game_name": next((text(ref["game_name"]) for ref in refs if text(ref.get("game_name"))), None),
            "partner_ids": [pid for pid in first.get("partner_ids") or [] if pid in common],
            "visibility": loosest(*(ref.get("visibility") for ref in refs)), "tier_order": None}


async def _season_references(db, series_ids: list[str]) -> dict[str, list[dict]]:
    """Referenzen, die schon zu den Saisons gehören (``series_id`` an der Referenz oder ``reference_id`` der Saison)."""
    if not series_ids:
        return {}
    owners = {row["reference_id"]: row["id"] async for row in db.reference_series.find(
        {"id": {"$in": series_ids}, "reference_id": {"$nin": [None, ""]}}, {"_id": 0, "id": 1, "reference_id": 1})}
    out: dict[str, list[dict]] = {}
    async for ref in db.references.find({"$or": [{"series_id": {"$in": series_ids}}, {"id": {"$in": list(owners)}}]},
                                        {"_id": 0}):
        owner = ref.get("series_id") if ref.get("series_id") in series_ids else owners.get(ref["id"])
        out.setdefault(owner, []).append(ref)
    return out


async def plan_group(db, key: str, refs: list[dict], lineage: dict | None) -> dict:
    """Vorschau einer Gruppe: Spur (vorhanden oder neu), je Saison vorhanden oder neu, Liga-Weg und Hinweise."""
    refs = sorted(refs, key=_sort_key)
    view = _lineage_view(refs, lineage)
    existing = []
    if lineage:
        existing = [item async for item in db.reference_series.find(
            {"lineage_id": lineage["id"], "status": {"$ne": "archived"}}, {"_id": 0})]
    by_key = {(normalize_name(item.get("season")), normalize_name(item.get("tier"))): item for item in existing}
    linked = await _season_references(db, [item["id"] for item in existing])
    buckets: dict[tuple, dict] = {}
    for ref in refs:
        season = season_of(ref) or NO_SEASON
        tier = text(ref.get("league"))[:SEASON_MAX] or None
        bucket = buckets.setdefault((normalize_name(season), normalize_name(tier)),
                                    {"season": season, "tier": tier, "refs": []})
        bucket["refs"].append(ref)

    seasons, hints = [], []
    for ref in refs:
        if not _day(ref):
            hints.append(_hint("missing_date", [ref], f"„{text(ref.get('title'))}“ hat kein Datum - die Saison kommt "
                                                      f"aus {'dem Feld bzw. Titel' if season_of(ref) else 'keiner Angabe'}."))
    for bucket_key, bucket in buckets.items():
        items = bucket["refs"]
        season_key = "|".join(bucket_key)
        found = by_key.get(bucket_key)
        if found:
            visibility = found.get("visibility") or "public"
            status = found.get("status")
        else:
            visibility = strictest(*(ref.get("visibility") for ref in items))
            status = _status(items)
        required = strictest(view["visibility"], visibility)
        for ref in items:
            own = ref.get("visibility") or "public"
            if _rank(own) < _rank(required):
                hints.append(_hint("tightened", [ref], f"„{text(ref.get('title'))}“ wird {VISIBILITY_LABELS[required]} "
                                                       f"- Saison bzw. Spur sind strenger.", season_key))
            elif _rank(own) > _rank(required):
                hints.append(_hint("stricter_than_season", [ref], f"„{text(ref.get('title'))}“ ist strenger als die "
                                                                  f"Saison ({VISIBILITY_LABELS.get(own, own)}) - sie "
                                                                  "bleibt so.", season_key))
        if len(items) > 1:
            hints.append(_hint("duplicate", items, f"{_titles(items)} fallen in dieselbe Saison.", season_key))
        before = linked.get(found["id"], []) if found else []
        if before:
            hints.append(_hint("season_has_reference", items, f"Die Saison hat schon eine Referenz: "
                                                              f"{_titles(before)}.", season_key))
        places = set().union(*(_placements(ref) for ref in items + before)) if items + before else set()
        if len(places) > 1:
            hints.append(_hint("placement_conflict", items + before,
                               f"{' gegen '.join(f'Platz {place}' for place in sorted(places))} in einer Saison: "
                               f"{_titles(items + before)}.", season_key))
        seasons.append({
            "key": season_key, "id": found["id"] if found else None, "season": found.get("season") if found else
            bucket["season"], "tier": found.get("tier") if found else bucket["tier"],
            "season_slug": found.get("season_slug") if found else None, "status": status,
            "season_result": found.get("season_result") if found else None, "visibility": visibility,
            "reference_ids": [ref["id"] for ref in items], "own_teams": [] if found else _own_teams(items),
            "club": best_place(items + before), "first_day": min((_day(ref) for ref in items if _day(ref)), default=""),
        })
    seasons.sort(key=lambda item: (item["first_day"] or "9999", item["season"].casefold(), item["tier"] or ""))
    return {"key": key, "lineage": view, "seasons": seasons,
            "references": [{"id": ref["id"], "title": ref.get("title"), "start_date": ref.get("start_date"),
                            "season": season_of(ref), "league": ref.get("league"),
                            "visibility": ref.get("visibility") or "public",
                            "placement": (best_place([ref]) or {}).get("rank")} for ref in refs],
            "hints": hints}


async def _open_references(db) -> list[dict]:
    """Referenzen ohne Saison: kein ``series_id`` und keine Saison vermerkt sie als ihre Referenz."""
    owned = {row["reference_id"] async for row in db.reference_series.find(
        {"reference_id": {"$nin": [None, ""]}}, {"_id": 0, "reference_id": 1})}
    refs = [ref async for ref in db.references.find(
        {"is_active": {"$ne": False}, "series_id": {"$in": [None, ""]}}, {"_id": 0})]
    return [ref for ref in refs if ref["id"] not in owned]


async def _groups(db) -> tuple[dict[str, list[dict]], dict[str, dict], int]:
    refs = await _open_references(db)
    lineages: dict[str, dict] = {}
    async for lineage in db.reference_lineages.find({"is_archived": {"$ne": True}}, {"_id": 0}):
        key = lineage_key(lineage)
        if key and key not in lineages:
            lineages[key] = lineage
    groups: dict[str, list[dict]] = {}
    for ref in refs:
        key = reference_key(ref)
        if key:
            groups.setdefault(key, []).append(ref)
    return groups, lineages, len(refs)


async def proposals(db) -> dict:
    groups, lineages, unlinked = await _groups(db)
    out = []
    for key, refs in groups.items():
        if len(refs) < 2 and key not in lineages:
            continue
        out.append(await plan_group(db, key, refs, lineages.get(key)))
    out.sort(key=lambda group: (-len(group["references"]), str(group["lineage"]["title"] or "").casefold()))
    return {"groups": out, "unlinked": unlinked}


async def group_for(db, key: str, reference_ids: list[str]) -> dict | None:
    """Die Gruppe neu gerechnet, nur mit den gewählten Referenzen - ``None``, wenn eine davon nicht (mehr) offen in
    dieser Gruppe ist (etwa schon gebündelt)."""
    groups, lineages, _ = await _groups(db)
    refs = {ref["id"]: ref for ref in groups.get(key) or []}
    if not reference_ids or any(rid not in refs for rid in reference_ids):
        return None
    return await plan_group(db, key, [refs[rid] for rid in reference_ids], lineages.get(key))
