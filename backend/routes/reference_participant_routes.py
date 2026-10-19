"""Externe Serien - Zuordnung (#1743): Teilnehmer je Serie, Aliase über alle Serien, Vorschläge über Spiel-IDs, Gäste.

Alles hier ist Verwaltung im Bereich Redaktion („content“): Aliase und Verknüpfungen sieht sonst niemand.

- **Teilnehmer** stehen je Serie mit dem Namen wie beim Veranstalter. Neu angelegt sind sie „offen“ - außer ein
  bestätigter Alias (gleicher Name, gleiches Spiel) ordnet sie sofort zu.
- **Unbekannte Namen** sind die offenen Teilnehmer, je mit Vorschlägen samt Begründung (``services/series_identity``).
- **Zuordnen** (Mitglied, Gast oder Extern) entscheidet einmal: für Mitglied und Gast wird der Alias gespeichert (Quelle,
  bestätigt von, am), damit derselbe Name in jeder Serie von selbst erkannt wird - offene Teilnehmer mit diesem Namen
  werden gleich mit zugeordnet. „Extern“ speichert keinen Alias über Fremde und nimmt einen falschen Alias zurück.
- Gäste zählen fürs Team, nie für den Verein (``is_club_member`` nur bei Mitgliedern); danach wird neu gerechnet.

Modelle, Indexe und Datenschutz-Einordnung liegen seit dem Datenmodell (#1741) in ``models.py``, ``database.py`` und
``services/personal_data.py``; Kontolöschung und Auskunft in ``account_erasure`` und ``dsgvo_routes``."""
from __future__ import annotations

from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_area
from database import get_db
from models import ReferenceParticipantCreate, ReferenceParticipantUpdate, new_id, now_utc
from services import reference_series, series_identity

router = APIRouter(prefix="/api/reference-series", tags=["reference-series"])

MAX_BATCH = 200
# Diese Felder ändert nur das Zuordnen - so bleibt jede Verknüpfung bestätigt und im Protokoll.
LINK_FIELDS = {"link", "profile_id", "guest_name", "is_club_member"}
PARTICIPANT_NULLABLE = {"start_number", "default_team"}


class ParticipantBatch(BaseModel):
    """Mehrere Namen auf einmal (einer je Eintrag), etwa aus einer Starterliste. Doppelte werden übersprungen."""
    names: List[str] = Field(min_length=1, max_length=MAX_BATCH)


class ParticipantAssign(BaseModel):
    link: Literal["member", "guest", "external"]
    profile_id: Optional[str] = None
    guest_name: Optional[str] = Field(default=None, max_length=120)


def _clean(value) -> str:
    return " ".join(str(value or "").split())


async def _series(db, series_id: str) -> dict:
    found = await db.reference_series.find_one({"id": series_id}, {"_id": 0})
    if not found:
        raise HTTPException(404, "Serie nicht gefunden.")
    return found


async def _participant(db, series_id: str, participant_id: str) -> dict:
    """Der Teilnehmer muss zur Serie aus dem Pfad gehören."""
    found = await db.reference_participants.find_one({"id": participant_id, "series_id": series_id}, {"_id": 0})
    if not found:
        raise HTTPException(404, "Teilnehmer nicht gefunden.")
    return found


async def _game_id(db, series: dict) -> str | None:
    lineage = await db.reference_lineages.find_one({"id": series.get("lineage_id")}, {"_id": 0, "game_id": 1}) or {}
    return lineage.get("game_id")


# ---------------------------------------------------------------- Index für Vorschläge
async def _profiles(db) -> dict[str, dict]:
    rows = await db.club_member_profiles.find(
        {"is_active": {"$ne": False}},
        {"_id": 0, "id": 1, "user_id": 1, "display_name": 1, "gamertag": 1},
    ).to_list(None)
    return {row["id"]: row for row in rows if row.get("id")}


def _profile_name(row: dict) -> str:
    return row.get("display_name") or row.get("gamertag") or "Mitglied"


async def _game_slugs(db, game_id: str | None) -> tuple[list[str], dict[str, str]]:
    """Slugs des Spiels (samt Grundspiel einer Edition) und die Bezeichnungen seiner Spieler-ID-Felder."""
    if not game_id:
        return [], {}
    game = await db.games.find_one({"id": game_id}, {"_id": 0}) or {}
    games = [game]
    if game.get("parent_game_id"):
        games.append(await db.games.find_one({"id": game["parent_game_id"]}, {"_id": 0}) or {})
    labels: dict[str, str] = {}
    for item in games:
        for spec in item.get("player_id_fields") or []:
            if isinstance(spec, dict) and spec.get("key"):
                labels.setdefault(spec["key"], spec.get("label") or spec["key"])
    return [item["slug"] for item in games if item.get("slug")], labels


async def _account_ids(db, profiles: dict[str, dict], game_id: str | None) -> list[dict]:
    """Kennungen aus den Konten mit Vereinsprofil: je Spiel (Reiter „Gaming“) und die Plattform-Kennungen. Ohne Spiel
    der Spur zählen die Kennungen aller Spiele."""
    profile_of = {row["user_id"]: pid for pid, row in profiles.items() if row.get("user_id")}
    if not profile_of:
        return []
    slugs, labels = await _game_slugs(db, game_id)
    fields = {"_id": 0, "id": 1, "game_ids": 1, **{key: 1 for key, _ in series_identity.PLATFORM_IDS}}
    out = []
    async for user in db.users.find({"id": {"$in": list(profile_of)}}, fields):
        pid = profile_of.get(user.get("id"))
        for key, label in series_identity.PLATFORM_IDS:
            if isinstance(user.get(key), str) and user[key].strip():
                out.append({"profile_id": pid, "value": user[key], "label": label})
        per_game = user.get("game_ids") or {}
        chosen = [per_game.get(slug) for slug in slugs] if game_id else list(per_game.values())
        for values in chosen:
            if not isinstance(values, dict):
                continue
            for key, value in values.items():
                if isinstance(value, str) and value.strip():
                    out.append({"profile_id": pid, "value": value, "label": labels.get(key) or "Spiel-ID"})
    return out


async def _start_numbers(db, series: dict) -> list[dict]:
    """Startnummern verknüpfter Mitglieder aus den anderen Saisons derselben Spur - nur als Hinweis."""
    others = await db.reference_series.find(
        {"lineage_id": series.get("lineage_id"), "id": {"$ne": series["id"]}}, {"_id": 0, "id": 1, "season": 1},
    ).to_list(None)
    season_of = {row["id"]: row.get("season") for row in others}
    if not season_of:
        return []
    rows = await db.reference_participants.find(
        {"series_id": {"$in": list(season_of)}, "link": "member", "profile_id": {"$ne": None},
         "start_number": {"$nin": [None, ""]}},
        {"_id": 0, "series_id": 1, "profile_id": 1, "start_number": 1},
    ).to_list(None)
    return [{"profile_id": row["profile_id"], "start_number": row["start_number"],
             "season": season_of.get(row["series_id"])} for row in rows]


async def _aliases(db, names: list[str]) -> list[dict]:
    keys = sorted({key for name in names for key in series_identity.name_keys(name)})
    if not keys:
        return []
    return await db.reference_aliases.find({"name_normalized": {"$in": keys}}, {"_id": 0}).to_list(None)


async def build_index(db, series: dict, names: list[str], *, with_ids: bool = True) -> series_identity.IdentityIndex:
    """Index für die Namen ``names``. ``with_ids=False`` reicht fürs bloße Wiedererkennen über Aliase."""
    profiles = await _profiles(db)
    game_id = await _game_id(db, series)
    profile_names = [{"profile_id": pid, "value": value} for pid, row in profiles.items()
                     for value in dict.fromkeys(filter(None, (row.get("display_name"), row.get("gamertag"))))]
    return series_identity.IdentityIndex(
        profiles={pid: _profile_name(row) for pid, row in profiles.items()},
        aliases=await _aliases(db, names),
        game_ids=await _account_ids(db, profiles, game_id) if with_ids else [],
        start_numbers=await _start_numbers(db, series) if with_ids else [],
        game_id=game_id,
        profile_names=profile_names,
    )


# ---------------------------------------------------------------- Lesen
def _link_fields(alias: dict) -> dict:
    member = alias.get("target") == "member"
    return {"link": "member" if member else "guest", "profile_id": alias.get("profile_id") if member else None,
            "guest_name": None if member else alias.get("guest_name"), "is_club_member": member}


async def _new_participant(db, series: dict, index: series_identity.IdentityIndex, fields: dict, me: dict) -> dict:
    now = now_utc().isoformat()
    name = _clean(fields["name"])
    doc = {
        "id": new_id(), "series_id": series["id"], "name": name,
        "name_normalized": series_identity.normalize_name(name),
        "start_number": _clean(fields.get("start_number")) or None,
        "default_team": _clean(fields.get("default_team")) or None,
        "kind": fields.get("kind") or "person", "name_hidden": bool(fields.get("name_hidden")),
        "link": "external", "profile_id": None, "guest_name": None, "is_club_member": False,
        "link_status": "open", "link_source": None, "alias_id": None, "decided_at": None, "decided_by": None,
        "created_at": now, "created_by": me["id"], "updated_at": now, "updated_by": me["id"],
    }
    alias = series_identity.exact_alias(index, name)
    if alias:
        doc.update({**_link_fields(alias), "link_status": "decided", "link_source": "alias", "alias_id": alias.get("id"),
                    "decided_at": now, "decided_by": me["id"]})
    await db.reference_participants.insert_one(dict(doc))
    return doc


def _with_profile(row: dict, profiles: dict[str, str]) -> dict:
    return {**row, "profile_name": profiles.get(row.get("profile_id")) if row.get("profile_id") else None}


def _sorted(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda row: (str(row.get("name") or "").casefold(), row.get("id")))


def _counts(rows: list[dict]) -> dict:
    counts = {"member": 0, "guest": 0, "external": 0, "open": 0, "club": 0}
    for row in rows:
        state = "open" if row.get("link_status") == "open" else (row.get("link") or "external")
        counts[state] = counts.get(state, 0) + 1
        counts["club"] += int(series_identity.counts_for_club(row))
    return counts


@router.get("/admin/series/{series_id}/participants")
async def list_participants(series_id: str, me: dict = Depends(require_area("content"))):
    db = get_db()
    await _series(db, series_id)
    rows = await db.reference_participants.find({"series_id": series_id}, {"_id": 0}).to_list(None)
    profiles = {pid: _profile_name(row) for pid, row in (await _profiles(db)).items()}
    return {"participants": [_with_profile(row, profiles) for row in _sorted(rows)], "counts": _counts(rows)}


@router.get("/admin/series/{series_id}/unknown-names")
async def unknown_names(series_id: str, me: dict = Depends(require_area("content"))):
    """Die offenen Teilnehmer mit Vorschlägen samt Begründung, dazu die Profile zur Auswahl (nur Name und Kennung)."""
    db = get_db()
    series = await _series(db, series_id)
    rows = _sorted(await db.reference_participants.find(
        {"series_id": series_id, "link_status": "open"}, {"_id": 0}).to_list(None))
    index = await build_index(db, series, [row["name"] for row in rows])
    items = [{"participant": row, "suggestions": series_identity.suggest(index, row["name"], row.get("start_number"))}
             for row in rows]
    profiles = sorted(({"id": pid, "name": name} for pid, name in index.profiles.items()),
                      key=lambda item: item["name"].casefold())
    return {"items": items, "profiles": profiles}


# ---------------------------------------------------------------- Anlegen und Bearbeiten
@router.post("/admin/series/{series_id}/participants")
async def create_participant(series_id: str, body: ReferenceParticipantCreate,
                             me: dict = Depends(require_area("content"))):
    db = get_db()
    series = await _series(db, series_id)
    fields = body.model_dump()
    if not _clean(fields["name"]):
        raise HTTPException(422, "Name fehlt.")
    index = await build_index(db, series, [fields["name"]], with_ids=False)
    doc = await _new_participant(db, series, index, fields, me)
    if doc["link_status"] == "decided":
        await reference_series.recompute_standings(db, series)
    return doc


@router.post("/admin/series/{series_id}/participants/batch")
async def create_participants(series_id: str, body: ParticipantBatch, me: dict = Depends(require_area("content"))):
    """Mehrere Namen auf einmal. Wer in der Serie schon steht (gleicher Schlüssel), wird übersprungen."""
    db = get_db()
    series = await _series(db, series_id)
    present = {row.get("name_normalized") async for row in db.reference_participants.find(
        {"series_id": series_id}, {"_id": 0, "name_normalized": 1})}
    names = []
    for raw in body.names:
        name = _clean(raw)[:120]
        key = series_identity.normalize_name(name)
        if key and key not in present:
            present.add(key)
            names.append(name)
    index = await build_index(db, series, names, with_ids=False)
    created = [await _new_participant(db, series, index, {"name": name}, me) for name in names]
    if any(row["link_status"] == "decided" for row in created):
        await reference_series.recompute_standings(db, series)
    return {"created": created, "skipped": len(body.names) - len(created)}


@router.patch("/admin/series/{series_id}/participants/{participant_id}")
async def update_participant(series_id: str, participant_id: str, body: ReferenceParticipantUpdate,
                             me: dict = Depends(require_area("content"))):
    """Name, Startnummer, Team, Art und Ausblenden. Die Verknüpfung ändert nur das Zuordnen."""
    db = get_db()
    await _series(db, series_id)
    await _participant(db, series_id, participant_id)
    raw = body.model_dump(exclude_unset=True)
    updates = {key: value for key, value in raw.items()
               if key not in LINK_FIELDS and (value is not None or key in PARTICIPANT_NULLABLE)}
    if "name" in updates:
        updates["name"] = _clean(updates["name"])
        if not updates["name"]:
            raise HTTPException(422, "Name fehlt.")
        updates["name_normalized"] = series_identity.normalize_name(updates["name"])
    for key in PARTICIPANT_NULLABLE & set(updates):
        updates[key] = _clean(updates[key]) or None
    await db.reference_participants.update_one({"id": participant_id}, {"$set": {
        **updates, "updated_at": now_utc().isoformat(), "updated_by": me["id"]}})
    return await _participant(db, series_id, participant_id)


# ---------------------------------------------------------------- Zuordnen
async def _save_alias(db, *, name: str, game_id: str | None, link: dict, source: str, me: dict,
                      existing: dict | None = None) -> tuple[dict, dict | None]:
    """Ein Alias je Schlüssel und Spiel. Eine Korrektur überschreibt den alten Stand (das Protokoll hält ihn fest);
    ``existing`` ist der Alias, über den der Teilnehmer zugeordnet war - er wird korrigiert, statt einen zweiten
    (etwa spielgebundenen) daneben anzulegen."""
    now = now_utc().isoformat()
    key = ({"id": existing["id"]} if existing
           else {"name_normalized": series_identity.normalize_name(name), "game_id": game_id})
    previous = existing or await db.reference_aliases.find_one(key, {"_id": 0})
    await db.reference_aliases.update_one(key, {
        "$set": {"name": name, "target": "member" if link["link"] == "member" else "guest",
                 "profile_id": link["profile_id"], "guest_name": link["guest_name"], "source": source,
                 "confirmed_by": me["id"], "confirmed_at": now, "updated_at": now},
        "$setOnInsert": {"id": new_id(), "created_at": now},
    }, upsert=True)
    return await db.reference_aliases.find_one(key, {"_id": 0}), previous


async def _move_followers(db, alias_id: str, link: dict, me: dict, skip_id: str) -> tuple[list[str], list[str]]:
    """Wer über diesen Alias von selbst zugeordnet wurde (``link_source`` „alias“), folgt seiner Korrektur; einzeln
    bestätigte Zuordnungen bleiben. Bei „Extern“ ist der Alias weg - die Teilnehmer werden extern und behalten die
    Spur, dass ein Alias zurückgenommen wurde. Liefert Teilnehmer und Serien."""
    rows = await db.reference_participants.find(
        {"alias_id": alias_id, "link_source": "alias", "id": {"$ne": skip_id}}, {"_id": 0, "id": 1, "series_id": 1},
    ).to_list(None)
    if not rows:
        return [], []
    now = now_utc().isoformat()
    withdrawn = link["link"] == "external"
    await db.reference_participants.update_many({"id": {"$in": [row["id"] for row in rows]}}, {"$set": {
        **link, "link_status": "decided", "link_source": "alias_withdrawn" if withdrawn else "alias",
        "alias_id": None if withdrawn else alias_id, "decided_at": now, "decided_by": me["id"],
        "updated_at": now, "updated_by": me["id"]}})
    return sorted(row["id"] for row in rows), sorted({row["series_id"] for row in rows})


async def _apply_alias_elsewhere(db, alias: dict, me: dict, skip_id: str) -> list[str]:
    """Offene Teilnehmer mit demselben Namen - in dieser und in anderen Serien desselben Spiels - gleich zuordnen.
    Liefert die Serien, deren Stände neu zu rechnen sind."""
    query = {"name_normalized": alias["name_normalized"], "link_status": "open", "id": {"$ne": skip_id}}
    rows = await db.reference_participants.find(query, {"_id": 0, "id": 1, "series_id": 1}).to_list(None)
    if not rows:
        return []
    allowed = {row["series_id"] for row in rows}
    if alias.get("game_id"):
        lineages = [row["id"] async for row in db.reference_lineages.find({"game_id": alias["game_id"]}, {"_id": 0, "id": 1})]
        allowed = {row["id"] async for row in db.reference_series.find(
            {"id": {"$in": sorted(allowed)}, "lineage_id": {"$in": lineages}}, {"_id": 0, "id": 1})}
    ids = [row["id"] for row in rows if row["series_id"] in allowed]
    if not ids:
        return []
    now = now_utc().isoformat()
    await db.reference_participants.update_many({"id": {"$in": ids}}, {"$set": {
        **_link_fields(alias), "link_status": "decided", "link_source": "alias", "alias_id": alias["id"],
        "decided_at": now, "decided_by": me["id"], "updated_at": now, "updated_by": me["id"]}})
    return sorted({row["series_id"] for row in rows if row["id"] in ids})


async def _link_for(db, body: ParticipantAssign, participant: dict) -> dict:
    if body.link == "member":
        profile = await db.club_member_profiles.find_one({"id": body.profile_id or "", "is_active": {"$ne": False}},
                                                         {"_id": 0, "id": 1})
        if not profile:
            raise HTTPException(404, "Vereinsprofil nicht gefunden.")
        return {"link": "member", "profile_id": profile["id"], "guest_name": None, "is_club_member": True}
    if body.link == "guest":
        return {"link": "guest", "profile_id": None, "guest_name": _clean(body.guest_name)[:120] or participant["name"],
                "is_club_member": False}
    return {"link": "external", "profile_id": None, "guest_name": None, "is_club_member": False}


@router.post("/admin/series/{series_id}/participants/{participant_id}/assign")
async def assign_participant(series_id: str, participant_id: str, body: ParticipantAssign,
                             me: dict = Depends(require_area("content"))):
    """Einmal bestätigen: Mitglied (mit Profil), Gast oder Extern. Mitglied und Gast speichern den Alias."""
    db = get_db()
    series = await _series(db, series_id)
    participant = await _participant(db, series_id, participant_id)
    game_id = await _game_id(db, series)
    link = await _link_for(db, body, participant)

    alias_id, previous_alias, others, followers = None, None, [], []
    # Kam die Zuordnung über einen Alias, wird genau dieser korrigiert (Quelle gemerkt in ``alias_id``).
    via = (await db.reference_aliases.find_one({"id": participant["alias_id"]}, {"_id": 0})
           if participant.get("link_source") == "alias" and participant.get("alias_id") else None)
    if body.link == "external":
        # Über Fremde wird kein Alias gespeichert; ein falscher Alias für diesen Namen wird zurückgenommen.
        key = {"name_normalized": series_identity.normalize_name(participant["name"]), "game_id": game_id}
        previous_alias = via or await db.reference_aliases.find_one(key, {"_id": 0})
        if previous_alias:
            await db.reference_aliases.delete_one({"id": previous_alias["id"]})
            followers, moved = await _move_followers(db, previous_alias["id"], link, me, participant_id)
            others = [sid for sid in moved if sid != series_id]
        source = "manual"
    else:
        index = await build_index(db, series, [participant["name"]])
        suggested = {(item["target"], item["profile_id"]) for item in
                     series_identity.suggest(index, participant["name"], participant.get("start_number"))
                     if item["strong"]}
        source = "suggestion" if (("member", link["profile_id"]) if link["link"] == "member"
                                  else ("guest", None)) in suggested else "manual"
        alias, previous_alias = await _save_alias(db, name=participant["name"], game_id=game_id, link=link,
                                                  source=source, me=me, existing=via)
        alias_id = alias["id"]
        followers, moved = await _move_followers(db, alias_id, link, me, participant_id)
        opened = await _apply_alias_elsewhere(db, alias, me, participant_id)
        others = [sid for sid in dict.fromkeys([*moved, *opened]) if sid != series_id]

    now = now_utc().isoformat()
    await db.reference_participants.update_one({"id": participant_id}, {"$set": {
        **link, "link_status": "decided", "link_source": source, "alias_id": alias_id,
        "decided_at": now, "decided_by": me["id"], "updated_at": now, "updated_by": me["id"]}})
    replaced = ({key: previous_alias.get(key) for key in ("id", "target", "profile_id", "confirmed_at")}
                if previous_alias else None)
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "reference_series.participant_assign", "actor_id": me["id"],
        "target_id": participant_id,
        "data": {"series_id": series_id, "link": link["link"], "profile_id": link["profile_id"],
                 "previous_link": participant.get("link"), "previous_status": participant.get("link_status"),
                 "previous_profile_id": participant.get("profile_id"), "alias_id": alias_id,
                 "replaced_alias": replaced, "also_assigned_in": others,
                 "followers": followers},
        "created_at": now,
    })
    for sid in dict.fromkeys([series_id, *others]):
        await reference_series.recompute_standings(db, series if sid == series_id else await _series(db, sid))
    return await _participant(db, series_id, participant_id)
