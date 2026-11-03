"""Map-Pools je Wettbewerb mit Snapshot (#1616).

Ein Wettbewerb wählt je Modus seines Spiels Maps aus der Bibliothek (``services/game_maps.py``): ein Turnier
(``tournament``), eine Phase (``stage``, überschreibt das Turnier) oder die Saison einer Referenzen-Serie
(``reference_series``, Spiel der Spur). Ohne Pool gibt es keine Maps - kein künstlicher leerer Pool.

**Snapshot und Versionen.** Jedes Speichern legt in ``map_pools`` eine neue, unveränderliche Version an: Modus mit
Namen und je Map Kennung, Slug, Name und Bild *von damals*. Umbenennen, neues Bild oder Archivieren in der Bibliothek
ändert keine gespeicherte Version; erst ein neues Speichern übernimmt den neuen Stand (die Verwaltung sieht vorher,
welche Maps sich geändert haben, ``outdated_map_ids``). Entfernen ist ebenfalls eine Version (``cleared``) - die
Geschichte bleibt lesbar. Gilt immer die neueste Version.

**Herkunft und Kette** (``effective_pool``): Spiel mit festgehaltener Version (``match.map_pool_id``, setzt das Veto
#1618 beim Start) → eigener Pool der Phase → Pool des Turniers → keiner. Eine neue Version gilt so nur für Spiele, die
noch keine festhalten. Ein Pool eines anderen Spiels (die Turnier-Edition wurde gewechselt) gilt nicht mehr
(``stale``), ein festgehaltener bleibt.

**Prüfung beim Speichern.** Nur Modi des Spiels, nur aktive Maps dieses Spiels, jede Map nur in Modi, für die sie
freigegeben ist, jede einmal je Modus. Fremde Kennungen (anderes Spiel, unbekannt) lehnt der Server ab - gleiche Namen
in zwei Spielen sind kein gemeinsamer Pool. ``allowed`` ist dieselbe Regel für die Wahl im Veto (#1618).

Der Lesevertrag ``view`` ist für Website, App und TV gleich: ``{id, version, origin, game_id, saved_at, modes: [{mode,
label, maps: [{map_id, slug, name, image_url}]}]}``; die Verwaltung bekommt dazu ``saved_by`` und ``note``.
"""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from models import GAME_MODES_MAX, new_id, now_utc
from services import game_maps, game_modes
from services.game_maps import MapProblem

# ``league_season``: Pool einer Liga-Season (docs/LIGA.md) - Vorlage; die Staffel bekommt beim Anlegen eine Kopie
# als eigene Version im Scope ``tournament`` (``copy_version``), ``effective_pool`` bleibt unverändert.
# ``game_default``: Standard-Pool eines Spiels (#2129, SP3) - nur eine Vorlage. Die Knöpfe „Vorgabe des Spiels“ laden ihn in
# den Editor, gespeichert wird dann wie immer ein eigener Snapshot; nichts liest ihn beim Spielen oder Melden.
SCOPES = ("tournament", "stage", "reference_series", "league_season", game_maps.DEFAULT_POOL_SCOPE)
# Grenze der Auswahl „Übernehmen von“ im Turnier-Pool.
SOURCES_MAX = 20
# Grenze je Modus gegen unkontrollierte Datenmengen - keine feste Kartenzahl.
POOL_MAPS_MAX = 50
NO_MODE_LABEL = "Alle Maps"
ADMIN_FIELDS = ("saved_by", "note")


class MapPoolGroup(BaseModel):
    mode: Optional[str] = Field(default=None, max_length=40)
    map_ids: List[str] = Field(default_factory=list, max_length=POOL_MAPS_MAX)


class MapPoolSave(BaseModel):
    """Ein neuer Stand: je Modus die Maps in ihrer Reihenfolge. ``expected_version`` schützt vor gleichzeitigem
    Überschreiben (409) - 0 heißt „bisher kein Pool“."""
    modes: List[MapPoolGroup] = Field(min_length=1, max_length=GAME_MODES_MAX)
    note: Optional[str] = Field(default=None, max_length=300)
    expected_version: Optional[int] = Field(default=None, ge=0)


# ---------------------------------------------------------------- Lesen

async def latest(db, scope: str, scope_id: str) -> dict | None:
    """Die neueste Version (auch eine entfernte) - für die nächste Versionsnummer."""
    return await db.map_pools.find_one({"scope": scope, "scope_id": scope_id}, {"_id": 0}, sort=[("version", -1)])


async def current(db, scope: str, scope_id: str) -> dict | None:
    """Der geltende Pool: die neueste Version, wenn sie nicht „entfernt“ ist."""
    doc = await latest(db, scope, scope_id)
    return doc if doc and not doc.get("cleared") else None


async def version_by_id(db, pool_id: str | None, origin: str | None = None) -> dict | None:
    """Eine bestimmte Version - die, die ein Spiel festhält."""
    if not pool_id:
        return None
    doc = await db.map_pools.find_one({"id": pool_id}, {"_id": 0})
    return view(doc, origin or (doc or {}).get("scope")) if doc and not doc.get("cleared") else None


def view(doc: dict | None, origin: str | None = None, *, admin: bool = False) -> dict | None:
    """Der Lesevertrag (siehe Modulkopf) - ``None`` ohne Pool. ``origin``: woher der Pool für diesen Leser kommt."""
    return saved_view(doc, origin, admin=admin) if doc else None


def saved_view(doc: dict, origin: str | None = None, *, admin: bool = False) -> dict:
    """Der Lesevertrag einer vorhandenen Version."""
    out = {
        "id": doc.get("id"), "version": doc.get("version"), "origin": origin or doc.get("scope"),
        "game_id": doc.get("game_id"), "saved_at": doc.get("created_at"),
        "modes": [{"mode": group.get("mode"), "label": group.get("label"),
                   "maps": [{key: item.get(key) for key in ("map_id", "slug", "name", "image_url")}
                            for item in group.get("maps") or []]}
                  for group in doc.get("modes") or []],
    }
    if admin:
        out.update({"saved_by": doc.get("created_by"), "note": doc.get("note")})
    return out


def allowed(pool: dict | None, mode: str | None, map_id: str | None) -> bool:
    """Darf ``map_id`` in ``mode`` gewählt werden? Nur, was der Pool für genau diesen Modus freigibt (Veto #1618)."""
    if not pool or not map_id:
        return False
    for group in pool.get("modes") or []:
        if group.get("mode") == mode:
            return any(item.get("map_id") == map_id for item in group.get("maps") or [])
    return False


def valid_for(doc: dict | None, game_id: str | None) -> dict | None:
    """Ein Pool gilt nur für das Spiel, für das er gewählt wurde."""
    return doc if doc and game_id and doc.get("game_id") == game_id else None


async def outdated_map_ids(db, doc: dict | None) -> list[str]:
    """Maps des Pools, die sich in der Bibliothek seither geändert haben (Name, Bild, archiviert, Modus entzogen,
    gelöscht) - die Verwaltung bietet dann an, den Pool neu zu speichern."""
    if not doc:
        return []
    ids = {item.get("map_id") for group in doc.get("modes") or [] for item in group.get("maps") or []}
    rows = {row["id"]: row for row in await db.game_maps.find({"id": {"$in": sorted(i for i in ids if i)}},
                                                              {"_id": 0}).to_list(None)}
    out: list[str] = []
    for group in doc.get("modes") or []:
        for item in group.get("maps") or []:
            row = rows.get(item.get("map_id"))
            # Inaktiv (#2207) ändert am Snapshot nichts - nur archiviert, gelöscht, umbenannt, neues Bild, Modus entzogen.
            changed = (not row or game_maps.status_of(row) == game_maps.ARCHIVED or row.get("name") != item.get("name")
                       or row.get("image_url") != item.get("image_url")
                       or (group.get("mode") is not None and group.get("mode") not in (row.get("modes") or [])))
            if changed and item.get("map_id") not in out:
                out.append(item.get("map_id"))
    return out


async def admin_entry(db, doc: dict | None, game_id: str | None, origin: str) -> dict | None:
    """Ein Pool für die Verwaltung: Lesevertrag plus ``stale`` (anderes Spiel) und ``outdated_map_ids``."""
    if not doc:
        return None
    return {**saved_view(doc, origin, admin=True), "stale": doc.get("game_id") != game_id,
            "outdated_map_ids": await outdated_map_ids(db, doc)}


async def library(db, game: dict | None) -> list[dict]:
    """Was zur Wahl steht: die aktiven und inaktiven Maps des Spiels in ihrer Reihenfolge, je mit ``status``. Inaktive bietet
    der Editor nur an, wo der gespeicherte Pool sie schon hat (#2207)."""
    if not game:
        return []
    return [{**{key: row.get(key) for key in ("id", "slug", "name", "image_url", "modes", "order")},
             "aliases": row.get("aliases") or [], "status": game_maps.status_of(row)}
            for row in await game_maps.maps_of(db, game["id"], usable_only=True)]


def game_summary(game: dict | None) -> dict | None:
    if not game:
        return None
    # ``status`` je Modus (#2206): die Verwaltung bietet inaktive und archivierte nur an, wo sie schon gesetzt sind.
    return {"id": game["id"], "name": game.get("name"), "slug": game.get("slug"), "modes": game_modes.entries(game)}


async def default_pool(db, game: dict | None) -> dict | None:
    """Der Standard-Pool des Spiels für den Knopf „Vorgabe des Spiels“ - ``None``: dann lädt er alle aktiven Maps."""
    if not game:
        return None
    return view(await current(db, game_maps.DEFAULT_POOL_SCOPE, game["id"]), game_maps.DEFAULT_POOL_SCOPE)


async def tournament_sources(db, tournament: dict) -> list[dict]:
    """„Übernehmen von“ im Turnier-Pool (#2129, SP3): die geltenden Pools anderer Turniere und Liga-Seasons mit demselben
    Spiel, neueste zuerst. Staffeln fehlen - sie sind Kopien ihrer Season. ``tournament``/``season`` stehen für die
    Sichtbarkeitsprüfung der Route dabei und gehören nicht nach außen."""
    game_id = tournament.get("game_id")
    if not game_id:
        return []
    newest: dict[tuple, dict] = {}
    async for doc in db.map_pools.find({"game_id": game_id, "scope": {"$in": ["tournament", "league_season"]}}, {"_id": 0}):
        key = (doc.get("scope"), doc.get("scope_id"))
        if key not in newest or (doc.get("version") or 0) > (newest[key].get("version") or 0):
            newest[key] = doc
    rows = sorted((doc for doc in newest.values() if not doc.get("cleared") and doc.get("scope_id") != tournament.get("id")),
                  key=lambda doc: str(doc.get("created_at") or ""), reverse=True)
    tournaments = {row["id"]: row for row in await db.tournaments.find(
        {"id": {"$in": [doc["scope_id"] for doc in rows if doc["scope"] == "tournament"]}}, {"_id": 0}).to_list(None)}
    seasons = {row["id"]: row for row in await db.league_seasons.find(
        {"id": {"$in": [doc["scope_id"] for doc in rows if doc["scope"] == "league_season"]}},
        {"_id": 0, "id": 1, "name": 1, "league_id": 1}).to_list(None)}
    out: list[dict] = []
    for doc in rows:
        if doc["scope"] == "tournament":
            source = tournaments.get(doc["scope_id"])
            if not source or source.get("league_context"):
                continue
            out.append({"key": f"tournament:{source['id']}", "label": f"Turnier: {source.get('title') or 'ohne Titel'}",
                        "pool": view(doc, "tournament"), "tournament": source})
        elif seasons.get(doc["scope_id"]):
            season = seasons[doc["scope_id"]]
            out.append({"key": f"season:{season['id']}", "label": f"Liga-Season: {season.get('name') or 'ohne Namen'}",
                        "pool": view(doc, "league_season"), "season": season})
    return out


# ---------------------------------------------------------------- Schreiben

def _kept_modes(previous: dict | None, game: dict) -> set:
    """Die Modi der geltenden Version desselben Wettbewerbs - ein inaktiver Modus darin hält das neue Speichern nicht auf
    (#2206)."""
    if not previous or previous.get("cleared") or previous.get("game_id") != game.get("id"):
        return set()
    return {group.get("mode") for group in previous.get("modes") or [] if group.get("mode")}


def _kept_maps(previous: dict | None, game: dict) -> set:
    """Paare (Modus, Map) der geltenden Version - eine inaktive Map darin bleibt im selben Modus erlaubt (#2207)."""
    if not previous or previous.get("cleared") or previous.get("game_id") != game.get("id"):
        return set()
    return {(group.get("mode"), item.get("map_id")) for group in previous.get("modes") or [] for item in group.get("maps") or []}


async def _snapshot_groups(db, game: dict, body: MapPoolSave, kept: set | None = None,
                           kept_maps: set | None = None) -> list[dict]:
    modes = {mode["mode"]: mode["label"] for mode in game_maps.game_modes(game)}
    game_name = game.get("name") or "dieses Spiel"
    seen_modes: set = set()
    wanted_ids = sorted({map_id for group in body.modes for map_id in group.map_ids if map_id})
    rows = {row["id"]: row for row in await db.game_maps.find({"id": {"$in": wanted_ids}}, {"_id": 0}).to_list(None)}
    groups: list[dict] = []
    for group in body.modes:
        mode = (group.mode or "").strip() or None
        if mode is None and modes:
            raise MapProblem(f"{game_name} hat Modi - bitte je Modus wählen.")
        if mode is not None and mode not in modes:
            raise MapProblem(f"Unbekannter Modus für {game_name}: {mode}.")
        # Inaktiv oder archiviert (#2206): kommt in keinen neuen Pool - leer gelassen stört er nicht.
        problem = game_modes.choice_problem(game, [mode], kept or ()) if group.map_ids else None
        if problem:
            raise MapProblem(problem)
        if mode in seen_modes:
            raise MapProblem(f"Der Modus {modes.get(mode, mode) if mode else NO_MODE_LABEL} steht zweimal im Pool.")
        seen_modes.add(mode)
        label = modes.get(mode) if mode else NO_MODE_LABEL
        maps: list[dict] = []
        for map_id in group.map_ids:
            row = rows.get(map_id)
            if not row or row.get("game_id") != game["id"]:
                raise MapProblem(f"Eine der gewählten Maps gehört nicht zu {game_name}.")
            status = game_maps.status_of(row)
            if status == game_maps.ARCHIVED:
                raise MapProblem(f"Die Map „{row.get('name')}“ ist archiviert und kommt in keinen neuen Pool.")
            if status == game_maps.INACTIVE and (mode, map_id) not in (kept_maps or set()):
                raise MapProblem(f"Die Map „{row.get('name')}“ ist inaktiv und kommt in {label} nicht neu dazu. "
                                 "Unter Spiele → Maps lässt sie sich wieder aktivieren.")
            if mode is not None and mode not in (row.get("modes") or []):
                raise MapProblem(f"Die Map „{row.get('name')}“ ist für {label} nicht freigegeben.")
            if any(item["map_id"] == map_id for item in maps):
                raise MapProblem(f"Die Map „{row.get('name')}“ steht in {label} zweimal.")
            maps.append({"map_id": row["id"], "slug": row.get("slug"), "name": row.get("name"),
                         "image_url": row.get("image_url")})
        if maps:
            groups.append({"mode": mode, "label": label, "maps": maps})
    if not groups:
        raise MapProblem("Bitte mindestens eine Map wählen - oder den Pool entfernen.")
    return groups


CHANGED_MEANWHILE = "Der Map-Pool wurde inzwischen geändert - bitte neu laden."


async def _write(db, *, previous: dict | None, scope: str, scope_id: str, game_id: str | None, user: dict,
                 groups: list[dict], cleared: bool, note: str | None, tournament_id: str | None) -> dict:
    """Die nächste Version nach ``previous`` - dem Stand, den der Aufrufer gelesen und geprüft hat. Der eindeutige
    Index (scope, scope_id, version) in database.py macht das Einfügen zum atomaren Vergleich: Hat inzwischen jemand
    anderes diese Nummer geschrieben, scheitert es mit DuplicateKeyError - das wird 409, nie 500 und nie ein stilles
    Überschreiben."""
    doc = {
        "id": new_id(), "scope": scope, "scope_id": scope_id, "tournament_id": tournament_id, "game_id": game_id,
        "version": int((previous or {}).get("version") or 0) + 1, "cleared": cleared, "modes": groups,
        "note": " ".join(str(note or "").split()) or None,
        "created_at": now_utc().isoformat(), "created_by": user["id"],
    }
    try:
        await db.map_pools.insert_one(dict(doc))
    except DuplicateKeyError:
        raise MapProblem(CHANGED_MEANWHILE, 409) from None
    return doc


def _current_version(previous: dict | None) -> int:
    """Die Version des geltenden Pools aus der neuesten Version - 0 ohne Pool oder nach dem Entfernen."""
    return int(previous.get("version") or 0) if previous and not previous.get("cleared") else 0


async def save(db, *, scope: str, scope_id: str, game: dict | None, body: MapPoolSave, user: dict,
               tournament_id: str | None = None) -> dict:
    """Eine neue Version speichern - ``MapProblem`` (422/409), wenn etwas nicht passt. Geprüft und weitergezählt wird
    an demselben gelesenen Stand; gleichzeitige Speicherungen fängt ``_write`` ab."""
    if not game:
        raise MapProblem("Ohne Spiel gibt es keinen Map-Pool - erst ein Spiel wählen.")
    previous = await latest(db, scope, scope_id)
    if body.expected_version is not None and _current_version(previous) != body.expected_version:
        raise MapProblem(CHANGED_MEANWHILE, 409)
    groups = await _snapshot_groups(db, game, body, _kept_modes(previous, game), _kept_maps(previous, game))
    return await _write(db, previous=previous, scope=scope, scope_id=scope_id, game_id=game["id"], user=user,
                        groups=groups, cleared=False, note=body.note, tournament_id=tournament_id)


async def copy_version(db, source: dict, *, scope: str, scope_id: str, user: dict,
                       tournament_id: str | None = None, note: str | None = None) -> dict:
    """Eine vorhandene Version als neue Version eines anderen Wettbewerbs - mit genau denselben Maps samt Namen und
    Bildern von damals (Snapshot), ohne neue Prüfung gegen die Bibliothek. Für die Liga: Season → Staffel."""
    previous = await latest(db, scope, scope_id)
    groups = [{"mode": group.get("mode"), "label": group.get("label"),
               "maps": [dict(item) for item in group.get("maps") or []]} for group in source.get("modes") or []]
    return await _write(db, previous=previous, scope=scope, scope_id=scope_id, game_id=source.get("game_id"),
                        user=user, groups=groups, cleared=False, note=note, tournament_id=tournament_id)


async def clear(db, *, scope: str, scope_id: str, user: dict, tournament_id: str | None = None) -> dict | None:
    """Den Pool entfernen - als eigene Version, die alte bleibt lesbar. Ohne Pool passiert nichts. Gleichzeitig mit
    einer anderen Änderung: ``MapProblem`` 409."""
    previous = await latest(db, scope, scope_id)
    if not _current_version(previous):
        return None
    return await _write(db, previous=previous, scope=scope, scope_id=scope_id, game_id=(previous or {}).get("game_id"),
                        user=user, groups=[], cleared=True, note=None, tournament_id=tournament_id)


# ---------------------------------------------------------------- Versionen vergleichen, Map herausnehmen (#2207)

async def versions(db, scope: str, scope_id: str) -> list[dict]:
    """Alle Versionen eines Wettbewerbs, neueste zuerst - für Auswahl und Vergleich in der Verwaltung."""
    rows = await db.map_pools.find({"scope": scope, "scope_id": scope_id}, {"_id": 0}).sort("version", -1).to_list(500)
    return [{"id": row.get("id"), "version": row.get("version"), "saved_at": row.get("created_at"),
             "saved_by": row.get("created_by"), "note": row.get("note"), "cleared": bool(row.get("cleared")),
             "maps": sum(len(group.get("maps") or []) for group in row.get("modes") or [])}
            for row in rows]


def _group_maps(doc: dict | None) -> dict:
    """Je Modus (Kennung) Name des Modus und die Maps als ``{map_id: name}`` in ihrer Reihenfolge."""
    out: dict = {}
    for group in ((doc or {}).get("modes") or []) if doc and not doc.get("cleared") else []:
        out[group.get("mode")] = {"label": group.get("label"),
                                  "maps": {item.get("map_id"): item.get("name") for item in group.get("maps") or []}}
    return out


def compare(base: dict | None, target: dict | None) -> dict:
    """Zwei Versionen gegenübergestellt: je Modus hinzu, weg und wie viele blieben. Die Reihenfolge innerhalb eines Modus zählt
    nicht. Ein entfernter Pool (``cleared``) zählt als leer."""
    old, new = _group_maps(base), _group_maps(target)
    order = list(dict.fromkeys([*new, *old]))
    rows = []
    for mode in order:
        before, after = (old.get(mode) or {}).get("maps") or {}, (new.get(mode) or {}).get("maps") or {}
        added = [{"map_id": key, "name": name} for key, name in after.items() if key not in before]
        removed = [{"map_id": key, "name": name} for key, name in before.items() if key not in after]
        kept = sum(1 for key in after if key in before)
        status = "added" if not before else "removed" if not after else "changed" if added or removed else "same"
        label = (new.get(mode) or old.get(mode) or {}).get("label") or (NO_MODE_LABEL if mode is None else mode)
        rows.append({"mode": mode, "label": label, "added": added, "removed": removed, "kept": kept, "status": status})

    def head(doc: dict | None) -> dict | None:
        return {"id": doc.get("id"), "version": doc.get("version"), "saved_at": doc.get("created_at"),
                "cleared": bool(doc.get("cleared"))} if doc else None

    return {"base": head(base), "target": head(target), "modes": rows, "same": all(row["status"] == "same" for row in rows)}


async def without_map(db, *, scope: str, scope_id: str, map_id: str, mode: str | None, user: dict, note: str | None,
                      expected_version: int | None = None, tournament_id: str | None = None) -> tuple[dict, dict]:
    """Eine neue Version ohne ``map_id`` (in ``mode`` oder, ohne Modus, in allen) - der Snapshot der übrigen Maps bleibt wie er
    war, ohne neue Prüfung gegen die Bibliothek. Gibt (alte, neue) Version zurück. 404 ohne Pool oder ohne die Map, 422 wenn der
    Pool leer würde, 409 bei gleichzeitigem Speichern."""
    previous = await latest(db, scope, scope_id)
    if not _current_version(previous):
        raise MapProblem("Es gibt keinen Map-Pool.", 404)
    if expected_version is not None and _current_version(previous) != expected_version:
        raise MapProblem(CHANGED_MEANWHILE, 409)
    groups, found = [], False
    for group in previous.get("modes") or []:
        maps = [dict(item) for item in group.get("maps") or []]
        if mode is None or group.get("mode") == mode:
            kept = [item for item in maps if item.get("map_id") != map_id]
            found = found or len(kept) != len(maps)
            maps = kept
        if maps:
            groups.append({"mode": group.get("mode"), "label": group.get("label"), "maps": maps})
    if not found:
        raise MapProblem("Diese Map steht nicht im Map-Pool." if mode is None else "Diese Map steht in diesem Modus nicht im Map-Pool.", 404)
    if not groups:
        raise MapProblem("Ohne diese Map wäre der Pool leer - bitte den Pool entfernen oder zuerst andere Maps aufnehmen.")
    doc = await _write(db, previous=previous, scope=scope, scope_id=scope_id, game_id=previous.get("game_id"), user=user,
                       groups=groups, cleared=False, note=note, tournament_id=tournament_id)
    return previous, doc


# ---------------------------------------------------------------- Turnier und Phase

async def _stage_pools(db, tournament_id: str) -> dict[str, dict]:
    """Je Phase die neueste Version (auch entfernte), in einer Abfrage."""
    out: dict[str, dict] = {}
    async for doc in db.map_pools.find({"scope": "stage", "tournament_id": tournament_id}, {"_id": 0}):
        if doc["scope_id"] not in out or doc["version"] > out[doc["scope_id"]]["version"]:
            out[doc["scope_id"]] = doc
    return {key: doc for key, doc in out.items() if not doc.get("cleared")}


async def effective_pool(db, tournament: dict, *, stage: dict | None = None, match: dict | None = None) -> dict | None:
    """Der Pool, der für dieses Spiel gilt, mit Herkunft (``match``, ``stage``, ``tournament``) - sonst ``None``."""
    held = await version_by_id(db, (match or {}).get("map_pool_id"), "match")
    if held:
        return held
    game_id = (tournament or {}).get("game_id")
    if stage and stage.get("id"):
        own = valid_for(await current(db, "stage", stage["id"]), game_id)
        if own and own.get("tournament_id") == tournament.get("id"):
            return view(own, "stage")
    return view(valid_for(await current(db, "tournament", tournament["id"]), game_id), "tournament")


async def tournament_overview(db, tournament: dict, *, admin: bool = False) -> dict:
    """Turnier und Phasen mit ihren Pools. Öffentlich: je Phase der geltende Pool samt Herkunft, nur Phasen mit Pool.
    Verwaltung: die eigenen Pools (auch veraltete), dazu Spiel, Bibliothek und die Phasen."""
    game_id = tournament.get("game_id")
    own = await current(db, "tournament", tournament["id"])
    stage_docs = await _stage_pools(db, tournament["id"])
    stages = await db.tournament_stages.find({"tournament_id": tournament["id"]},
                                             {"_id": 0, "id": 1, "name": 1, "number": 1}).sort("number", 1).to_list(200)
    if admin:
        game = await db.games.find_one({"id": game_id}, {"_id": 0}) if game_id else None
        rows = [{**_stage_head(stage), "pool": await admin_entry(db, stage_docs.get(stage["id"]), game_id, "stage")}
                for stage in stages]
        return {"game": game_summary(game), "library": await library(db, game), "default_pool": await default_pool(db, game),
                "tournament": await admin_entry(db, own, game_id, "tournament"), "stages": rows}
    base = view(valid_for(own, game_id), "tournament")
    rows = []
    for stage in stages:
        pool = view(valid_for(stage_docs.get(stage["id"]), game_id), "stage") or base
        if pool:
            rows.append({**_stage_head(stage), "pool": pool})
    return {"game_id": game_id, "tournament": base, "stages": rows}


def _stage_head(stage: dict) -> dict:
    return {"stage_id": stage["id"], "name": stage.get("name"), "number": stage.get("number")}


# ---------------------------------------------------------------- Saison einer Referenzen-Serie

async def series_pool(db, lineage: dict | None, series: dict) -> dict | None:
    """Der Pool der Saison für die Serienseite - nur für das Spiel der Spur."""
    doc = valid_for(await current(db, "reference_series", series["id"]), (lineage or {}).get("game_id"))
    return view(doc, "reference_series")


async def previous_series_pool(db, lineage: dict, series: dict) -> dict | None:
    """Zum Übernehmen: der Pool der jüngsten anderen Saison derselben Spur mit Pool für dasselbe Spiel, dazu
    ``source_season`` (Saison und Stufe) für die Beschriftung."""
    others = await db.reference_series.find(
        {"lineage_id": lineage["id"], "id": {"$ne": series["id"]}},
        {"_id": 0, "id": 1, "season": 1, "tier": 1, "season_slug": 1, "created_at": 1}).to_list(None)
    newest_first = sorted(others, key=lambda row: (str(row.get("season_slug") or ""), str(row.get("created_at") or "")),
                          reverse=True)
    for other in newest_first:
        pool = await series_pool(db, lineage, other)
        if pool:
            label = " · ".join(str(part) for part in (other.get("season"), other.get("tier")) if part)
            return {**pool, "source_season": label}
    return None


async def map_lookup(db, scope: str, scope_id: str) -> dict[str, dict]:
    """Je Map-Kennung der Snapshot aus den Versionen dieses Wettbewerbs (neuere gewinnen) - damit ein gespeichertes
    Ergebnis mit ``map_id`` Name und Bild von damals zeigt, auch wenn die Map später aus dem Pool fällt."""
    out: dict[str, dict] = {}
    rows = await db.map_pools.find({"scope": scope, "scope_id": scope_id},
                                   {"_id": 0, "version": 1, "modes": 1}).to_list(None)
    for doc in sorted(rows, key=lambda row: row.get("version") or 0):
        for group in doc.get("modes") or []:
            for item in group.get("maps") or []:
                if item.get("map_id"):
                    out[item["map_id"]] = {key: item.get(key) for key in ("map_id", "slug", "name", "image_url")}
    return out
