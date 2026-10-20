"""Externe Serien - Zuordnung (#1743): Teilnehmer je Serie, Aliase über alle Serien, Vorschläge über Spiel-IDs, Gäste.

Alles hier ist Verwaltung im Bereich Redaktion („content“): Aliase und Verknüpfungen sieht sonst niemand.

- **Teilnehmer** stehen je Serie mit dem Namen wie beim Veranstalter. Neu angelegt sind sie „offen“ - außer ein
  bestätigter Alias (gleicher Name, gleiches Spiel) ordnet sie sofort zu.
- **Unbekannte Namen** sind die offenen Teilnehmer, je mit Vorschlägen samt Begründung (``services/series_identity``).
- **Zuordnen** (Mitglied, Gast oder Extern) entscheidet einmal: für Mitglied und Gast wird der Alias gespeichert (Quelle,
  bestätigt von, am), damit derselbe Name in jeder Serie von selbst erkannt wird - offene Teilnehmer mit diesem Namen
  werden gleich mit zugeordnet. „Extern“ speichert keinen Alias über Fremde und nimmt einen falschen Alias zurück.
- Gäste zählen fürs Team, nie für den Verein (``is_club_member`` nur bei Mitgliedern); danach wird neu gerechnet.
- Anlegen, Bearbeiten und Zuordnen laufen unter der Sperre der Saison (``reference_series.series_locked``, #1744);
  mitgezogene andere Saisons rechnen danach je unter ihrer eigenen Sperre neu (``recompute_locked``).

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
from services.series_participants import (
    apply_alias, build_index, clean, club_profiles, follower_series, move_followers, new_participant, open_series,
    profile_name, series_game_id,
)

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


UNUSABLE_NAME = "Der Name braucht mindestens einen Buchstaben oder eine Ziffer (ohne Clan-Tag)."


def _usable(name: str) -> str:
    """Leer oder ohne Buchstaben und Ziffern („!!!“, nur Emoji, nur „[TLS]“) lässt sich nie wiedererkennen."""
    if not name:
        raise HTTPException(422, "Name fehlt.")
    if not series_identity.is_usable_name(name):
        raise HTTPException(422, UNUSABLE_NAME)
    return name


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


# ---------------------------------------------------------------- Lesen
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
    profiles = {pid: profile_name(row) for pid, row in (await club_profiles(db)).items()}
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
@reference_series.series_locked
async def create_participant(series_id: str, body: ReferenceParticipantCreate,
                             me: dict = Depends(require_area("content"))):
    db = get_db()
    series = await _series(db, series_id)
    fields = body.model_dump()
    _usable(clean(fields["name"]))
    index = await build_index(db, series, [fields["name"]], with_ids=False)
    doc = await new_participant(db, series, index, fields, me)
    if doc["link_status"] == "decided":
        await reference_series.recompute_standings(db, series)
    return doc


@router.post("/admin/series/{series_id}/participants/batch")
@reference_series.series_locked
async def create_participants(series_id: str, body: ParticipantBatch, me: dict = Depends(require_area("content"))):
    """Mehrere Namen auf einmal. Wer in der Serie schon steht (gleicher Schlüssel), wird übersprungen."""
    db = get_db()
    series = await _series(db, series_id)
    present = {row.get("name_normalized") async for row in db.reference_participants.find(
        {"series_id": series_id}, {"_id": 0, "name_normalized": 1})}
    names, rejected = [], []
    for raw in body.names:
        name = clean(raw)[:120]
        if name and not series_identity.is_usable_name(name):
            rejected.append(name)
            continue
        key = series_identity.normalize_name(name)
        if key and key not in present:
            present.add(key)
            names.append(name)
    index = await build_index(db, series, names, with_ids=False)
    created = [await new_participant(db, series, index, {"name": name}, me) for name in names]
    if any(row["link_status"] == "decided" for row in created):
        await reference_series.recompute_standings(db, series)
    return {"created": created, "skipped": len(body.names) - len(created), "rejected": rejected}


@router.patch("/admin/series/{series_id}/participants/{participant_id}")
@reference_series.series_locked
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
        updates["name"] = _usable(clean(updates["name"]))
        updates["name_normalized"] = series_identity.normalize_name(updates["name"])
    for key in PARTICIPANT_NULLABLE & set(updates):
        updates[key] = clean(updates[key]) or None
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


async def _link_for(db, body: ParticipantAssign, participant: dict) -> dict:
    if body.link == "member":
        profile = await db.club_member_profiles.find_one({"id": body.profile_id or "", "is_active": {"$ne": False}},
                                                         {"_id": 0, "id": 1})
        if not profile:
            raise HTTPException(404, "Vereinsprofil nicht gefunden.")
        return {"link": "member", "profile_id": profile["id"], "guest_name": None, "is_club_member": True}
    if body.link == "guest":
        return {"link": "guest", "profile_id": None, "guest_name": clean(body.guest_name)[:120] or participant["name"],
                "is_club_member": False}
    return {"link": "external", "profile_id": None, "guest_name": None, "is_club_member": False}


@router.post("/admin/series/{series_id}/participants/{participant_id}/assign")
async def assign_participant(series_id: str, participant_id: str, body: ParticipantAssign,
                             me: dict = Depends(require_area("content"))):
    """Einmal bestätigen: Mitglied (mit Profil), Gast oder Extern. Mitglied und Gast speichern den Alias.

    Unter der Sperre dieser Saison (#1744) ändert sich nur diese Saison. Zieht der Alias andere Saisons mit, geschieht
    das erst danach - je Saison unter ihrer eigenen Sperre, Änderung und Neurechnen zusammen, nie zwei Sperren
    ineinander. Ist eine andere Saison gerade besetzt, bleibt diese Zuordnung gültig; die andere merkt sich den
    Nachtrag und zieht ihn beim nächsten Vorgang dort nach (``other_series.pending``, ``notice``, Protokoll)."""
    db = get_db()
    async with reference_series.series_write(db, series_id):
        done = await _assign(db, series_id, participant_id, body, me)
    updated, pending, moved = await reference_series.follow_alias_elsewhere(db, done["others"], done["followup"])
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "reference_series.participant_assign", "actor_id": me["id"],
        "target_id": participant_id,
        "data": {**done["audit"], "also_assigned_in": updated, "pending_series": pending,
                 "followers": [*done["followers"], *moved]},
        "created_at": now_utc().isoformat(),
    })
    out = await _participant(db, series_id, participant_id)
    out["other_series"] = {"updated": updated, "pending": pending}
    if pending:
        word = "Saison wird" if len(pending) == 1 else "Saisons werden"
        out["notice"] = (f"{len(pending)} weitere {word} gerade bearbeitet und beim nächsten Speichern dort "
                         "nachgezogen.")
    return out


async def _assign(db, series_id: str, participant_id: str, body: ParticipantAssign, me: dict) -> dict:
    """Das Zuordnen in dieser Saison, samt Neurechnen - nur unter ihrer Sperre aufrufen. Ändert keine andere Saison;
    liefert, welche anderen Saisons der Alias mitzieht (``others``), den Nachtrag dafür (``followup``), die hier
    gefolgten Teilnehmer und die Angaben fürs Protokoll."""
    series = await _series(db, series_id)
    participant = await _participant(db, series_id, participant_id)
    game_id = await series_game_id(db, series)
    link = await _link_for(db, body, participant)
    me_ref = {"id": me["id"]}

    alias_id, previous_alias, others, followers, followed = None, None, set(), [], None
    # Kam die Zuordnung über einen Alias, wird genau dieser korrigiert (Quelle gemerkt in ``alias_id``).
    via = (await db.reference_aliases.find_one({"id": participant["alias_id"]}, {"_id": 0})
           if participant.get("link_source") == "alias" and participant.get("alias_id") else None)
    if body.link == "external":
        # Über Fremde wird kein Alias gespeichert; ein falscher Alias für diesen Namen wird zurückgenommen.
        key = {"name_normalized": series_identity.normalize_name(participant["name"]), "game_id": game_id}
        previous_alias = via or await db.reference_aliases.find_one(key, {"_id": 0})
        if previous_alias:
            followed = previous_alias["id"]
            await db.reference_aliases.delete_one({"id": followed})
            followers = await move_followers(db, followed, link, me_ref, participant_id, [series_id])
            others = await follower_series(db, followed, participant_id)
        source = "manual"
    else:
        if not series_identity.is_usable_name(participant["name"]):
            raise HTTPException(422, UNUSABLE_NAME + " Bitte erst den Namen korrigieren.")
        index = await build_index(db, series, [participant["name"]])
        suggested = {(item["target"], item["profile_id"]) for item in
                     series_identity.suggest(index, participant["name"], participant.get("start_number"))
                     if item["strong"]}
        source = "suggestion" if (("member", link["profile_id"]) if link["link"] == "member"
                                  else ("guest", None)) in suggested else "manual"
        alias, previous_alias = await _save_alias(db, name=participant["name"], game_id=game_id, link=link,
                                                  source=source, me=me, existing=via)
        alias_id = followed = alias["id"]
        followers = await move_followers(db, alias_id, link, me_ref, participant_id, [series_id])
        followers += await apply_alias(db, alias, me_ref, participant_id, [series_id])
        others = (await follower_series(db, alias_id, participant_id)) | (
            await open_series(db, alias, participant_id))

    now = now_utc().isoformat()
    await db.reference_participants.update_one({"id": participant_id}, {"$set": {
        **link, "link_status": "decided", "link_source": source, "alias_id": alias_id,
        "decided_at": now, "decided_by": me["id"], "updated_at": now, "updated_by": me["id"]}})
    replaced = ({key: previous_alias.get(key) for key in ("id", "target", "profile_id", "confirmed_at")}
                if previous_alias else None)
    await reference_series.recompute_standings(db, series)
    others.discard(series_id)
    return {
        "others": sorted(others) if followed else [],
        "followup": {"alias_id": followed, "skip_id": participant_id, "requested_by": me["id"]},
        "followers": followers,
        "audit": {"series_id": series_id, "link": link["link"], "profile_id": link["profile_id"],
                  "previous_link": participant.get("link"), "previous_status": participant.get("link_status"),
                  "previous_profile_id": participant.get("profile_id"), "alias_id": alias_id,
                  "replaced_alias": replaced},
    }
