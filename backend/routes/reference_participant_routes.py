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
- **Nachträglich bearbeiten** (#1929): Name, Startnummer und Team ändern (Protokoll, Neurechnen), mehrere auf einmal als
  Gast oder Extern (``bulk-assign``: eine Sperre, einmal neu rechnen, andere Saisons danach je einmal), zwei
  Schreibweisen zusammenführen (``merge``: Ergebnisse samt Entwürfen wandern mit) und Teilnehmer ohne Ergebnis
  entfernen. Alles nur für den Vorstand (Bereich Redaktion) - ein Captain ordnet nie zu (#1749).
- **Kader** (#1931): ``batch`` mit ``team`` legt neue Namen gleich mit diesem Team an (``default_team``) und ordnet
  schon vorhandene dem Team zu (``assigned``). Der Kader eines eigenen Teams sind die Teilnehmer mit diesem Team;
  herausnehmen heißt Team leeren (``PATCH`` mit ``default_team: null``).

Modelle, Indexe und Datenschutz-Einordnung liegen seit dem Datenmodell (#1741) in ``models.py``, ``database.py`` und
``services/personal_data.py``; Kontolöschung und Auskunft in ``account_erasure`` und ``dsgvo_routes``."""
from __future__ import annotations

from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_area
from database import get_db
from models import ReferenceParticipantCreate, ReferenceParticipantUpdate, new_id, now_utc
from services import reference_calendar, reference_running_cache, reference_series, series_identity, series_results
from services.series_participants import (
    apply_alias, build_index, clean, club_profiles, content_participant_ids, follower_series, move_followers,
    new_participant, open_series, profile_name, series_game_id, sheet_participant_ids, swap_participant,
)

# Jeder schreibende Aufruf leert den Cache der laufenden Saisons (#1753, Startseite).
router = APIRouter(prefix="/api/reference-series", tags=["reference-series"],
                   dependencies=[Depends(reference_running_cache.reset_after_write)])

MAX_BATCH = 200
# Diese Felder ändert nur das Zuordnen - so bleibt jede Verknüpfung bestätigt und im Protokoll.
LINK_FIELDS = {"link", "profile_id", "guest_name", "is_club_member"}
PARTICIPANT_NULLABLE = {"start_number", "default_team", "current_team"}  # current_team: #1960


class ParticipantBatch(BaseModel):
    """Mehrere Namen auf einmal (einer je Eintrag), etwa aus einer Starterliste. Doppelte werden übersprungen - mit
    ``team`` (Kader, #1931) aber diesem Team zugeordnet."""
    names: List[str] = Field(min_length=1, max_length=MAX_BATCH)
    team: Optional[str] = Field(default=None, max_length=120)


class ParticipantAssign(BaseModel):
    link: Literal["member", "guest", "external"]
    profile_id: Optional[str] = None
    guest_name: Optional[str] = Field(default=None, max_length=120)


class ParticipantBulkAssign(BaseModel):
    """Sammelaktion (#1929): mehrere Teilnehmer der Saison als Gast oder Extern - Mitglied geht nur einzeln (Profil)."""
    participant_ids: List[str] = Field(min_length=1, max_length=MAX_BATCH)
    link: Literal["guest", "external"]


class ParticipantMerge(BaseModel):
    """Zusammenführen (#1929): ``duplicate_id`` geht im Teilnehmer aus dem Pfad auf."""
    duplicate_id: str = Field(min_length=1, max_length=80)


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


async def _log(db, action: str, me: dict, target_id: str, data: dict) -> None:
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": me["id"], "target_id": target_id,
                                    "data": data, "created_at": now_utc().isoformat()})


async def _round_labels(db, series_id: str) -> dict[str, str]:
    """Kürzel je Termin (sonst „Termin N“) für Meldungen - wie im Kalender gezählt."""
    rounds = await db.reference_rounds.find({"series_id": series_id}, {"_id": 0}).to_list(None)
    active = [item for item in reference_calendar.ordered_rounds(rounds) if not item.get("archived_at")]
    return {item["id"]: reference_calendar.round_label(item, position) for position, item in enumerate(active, start=1)}


def _pending_notice(pending: list[str]) -> str:
    word = "Saison wird" if len(pending) == 1 else "Saisons werden"
    return f"{len(pending)} weitere {word} gerade bearbeitet und beim nächsten Speichern dort nachgezogen."


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
    # Zur Wahl beim Bearbeiten (#1929): aktive Vereinsprofile, nur Name und Kennung. ``in_results``: steht in einem
    # Ergebnis (auch im Entwurf) - entfernen geht dann nur über Zusammenführen.
    choices = sorted(({"id": pid, "name": name} for pid, name in profiles.items()),
                     key=lambda item: (item["name"].casefold(), item["id"]))
    used: set[str] = set()
    async for sheet in db.reference_round_results.find({"series_id": series_id}, {"_id": 0}):
        used |= sheet_participant_ids(sheet)
    listed = [{**_with_profile(row, profiles), "in_results": row["id"] in used} for row in _sorted(rows)]
    return {"participants": listed, "counts": _counts(rows), "profiles": choices}


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
    """Mehrere Namen auf einmal. Wer in der Serie schon steht (gleicher Schlüssel), wird übersprungen - mit ``team``
    (Kader, #1931) diesem Team zugeordnet; neue Namen bekommen das Team gleich mit."""
    db = get_db()
    series = await _series(db, series_id)
    team = clean(body.team)[:120] or None
    present = {row.get("name_normalized"): row async for row in db.reference_participants.find(
        {"series_id": series_id}, {"_id": 0, "id": 1, "name": 1, "name_normalized": 1, "default_team": 1})}
    names, rejected, known = [], [], []
    for raw in body.names:
        name = clean(raw)[:120]
        if name and not series_identity.is_usable_name(name):
            rejected.append(name)
            continue
        key = series_identity.normalize_name(name)
        if key and key not in present:
            present[key] = {}
            names.append(name)
        elif key and present[key].get("id") and present[key] not in known:
            known.append(present[key])
    index = await build_index(db, series, names, with_ids=False)
    created = [await new_participant(db, series, index, {"name": name, "default_team": team}, me) for name in names]
    assigned = [row for row in known if team and row.get("default_team") != team]
    for row in assigned:
        await db.reference_participants.update_one({"id": row["id"], "series_id": series_id}, {"$set": {
            "default_team": team, "updated_at": now_utc().isoformat(), "updated_by": me["id"]}})
    if assigned:
        await _log(db, "reference_participant.roster", me, series_id, {
            "team": team, "participant_ids": [row["id"] for row in assigned]})
    if assigned or any(row["link_status"] == "decided" for row in created):
        await reference_series.recompute_standings(db, series)
    return {"created": created, "skipped": len(body.names) - len(created) - len(assigned), "rejected": rejected,
            "assigned": [{"id": row["id"], "name": row.get("name"), "default_team": team} for row in assigned]}


@router.patch("/admin/series/{series_id}/participants/{participant_id}")
@reference_series.series_locked
async def update_participant(series_id: str, participant_id: str, body: ReferenceParticipantUpdate,
                             me: dict = Depends(require_area("content"))):
    """Name, Startnummer, Team, Art und Ausblenden. Die Verknüpfung ändert nur das Zuordnen.

    Jede Änderung kommt ins Protokoll (``reference_series.participant_update``, alter und neuer Wert), danach wird neu
    gerechnet - das Team zählt in der Teamwertung, der Name beim Gleichstand (#1929). Ein Name, den es in der Saison
    schon gibt, ist ein Fall fürs Zusammenführen (409)."""
    db = get_db()
    series = await _series(db, series_id)
    before = await _participant(db, series_id, participant_id)
    raw = body.model_dump(exclude_unset=True)
    updates = {key: value for key, value in raw.items()
               if key not in LINK_FIELDS and (value is not None or key in PARTICIPANT_NULLABLE)}
    if "name" in updates:
        updates["name"] = _usable(clean(updates["name"]))
        updates["name_normalized"] = series_identity.normalize_name(updates["name"])
        if updates["name_normalized"] != before.get("name_normalized") and await db.reference_participants.find_one(
                {"series_id": series_id, "name_normalized": updates["name_normalized"], "id": {"$ne": participant_id}},
                {"_id": 0, "id": 1}):
            raise HTTPException(409, f"„{updates['name']}“ steht schon in dieser Saison. Führ die beiden zusammen, "
                                     "statt umzubenennen.")
    for key in PARTICIPANT_NULLABLE & set(updates):
        updates[key] = clean(updates[key]) or None
    changes = {key: [before.get(key), value] for key, value in updates.items()
               if key != "name_normalized" and before.get(key) != value}
    if not changes:
        return before
    written = {key: updates[key] for key in changes}
    if "name" in changes:
        written["name_normalized"] = updates["name_normalized"]
    await db.reference_participants.update_one({"id": participant_id}, {"$set": {
        **written, "updated_at": now_utc().isoformat(), "updated_by": me["id"]}})
    await _log(db, "reference_series.participant_update", me, participant_id,
               {"series_id": series_id, "changes": changes})
    await reference_series.recompute_standings(db, series)
    return await _participant(db, series_id, participant_id)


# ---------------------------------------------------------------- Zusammenführen und Entfernen
MERGE_TAKES = ("start_number", "default_team", "current_team")
LINK_STATE = (*sorted(LINK_FIELDS), "link_status", "link_source", "alias_id", "decided_at", "decided_by")


async def _merge_revision(db, sheet: dict, kind: str, me: dict) -> str:
    """Der Stand vor dem Zusammenführen als Revision - wie beim Speichern (``reference_result_routes._revision``):
    das Blatt selbst (``kind`` „sheet“) oder der Entwurf daneben („pending_draft“), Grund „merge“."""
    source = sheet if kind == "sheet" else sheet.get("pending_draft") or {}
    revision = {
        "id": new_id(), "result_id": sheet["id"], "series_id": sheet["series_id"], "round_id": sheet["round_id"],
        "kind": kind, "reason": "merge", "version": int(sheet.get("version") or 0),
        "status": sheet.get("status") if kind == "sheet" else "draft",
        "content": {key: source.get(key) for key in series_results.CONTENT_FIELDS},
        "author_id": source.get("updated_by") or source.get("created_by"),
        "replaced_at": now_utc().isoformat(), "replaced_by": me["id"],
    }
    await db.reference_round_result_revisions.insert_one(dict(revision))
    return revision["id"]


@router.post("/admin/series/{series_id}/participants/{participant_id}/merge")
async def merge_participant(series_id: str, participant_id: str, body: ParticipantMerge,
                            me: dict = Depends(require_area("content"))):
    """Zwei Schreibweisen derselben Person zusammenführen (#1929): ``duplicate_id`` geht in diesem Teilnehmer auf.

    Seine Ergebnisse wandern mit - im Blatt, im Entwurf daneben und in Blättern, die noch Entwurf sind; jedes geänderte
    Blatt bekommt eine Revision mit dem alten Stand (Grund „merge“) und eine neue Version (offene Seiten zum Eintragen
    laden dann neu). Danach wird neu gerechnet. Der behaltene Teilnehmer behält Name und Zuordnung; fehlende
    Startnummer, fehlendes Team und fehlendes aktuelles Team von Hand (#1960) kommen vom anderen, ein ausgeblendeter
    Name bleibt ausgeblendet, und ist er selbst
    noch offen, übernimmt er die Zuordnung des anderen. Nennt ein Ergebnis beide, wird nichts zusammengeführt (409).

    **Aliase:** Die Aliase des anderen Namens ziehen zum behaltenen um (``extra_alias_ids``) und zeigen danach auf
    seine Zuordnung - ist er extern, werden sie zurückgenommen. Andere Saisons ziehen wie beim Zuordnen erst nach der
    eigenen Sperre nach (``follow_aliases_elsewhere``), je Saison unter ihrer eigenen."""
    if body.duplicate_id == participant_id:
        raise HTTPException(422, "Ein Teilnehmer lässt sich nicht mit sich selbst zusammenführen.")
    db = get_db()
    async with reference_series.series_write(db, series_id):
        done = await _merge(db, series_id, participant_id, body.duplicate_id, me)
    updated, pending, moved = await reference_series.follow_aliases_elsewhere(db, done["plan"])
    await _log(db, "reference_series.participant_merge", me, participant_id, {
        **done["audit"], "also_assigned_in": updated, "pending_series": pending,
        "followers": [*done["audit"]["followers"], *moved]})
    out = await _participant(db, series_id, participant_id)
    out["other_series"] = {"updated": updated, "pending": pending}
    if pending:
        out["notice"] = _pending_notice(pending)
    return out


async def _merge(db, series_id: str, participant_id: str, duplicate_id: str, me: dict) -> dict:
    """Das Zusammenführen in dieser Saison, samt Neurechnen - nur unter ihrer Sperre aufrufen. Liefert den Plan für
    andere Saisons und die Angaben fürs Protokoll."""
    series = await _series(db, series_id)
    kept = await _participant(db, series_id, participant_id)
    duplicate = await _participant(db, series_id, duplicate_id)
    old, new = duplicate["id"], kept["id"]
    sheets = await db.reference_round_results.find({"series_id": series_id}, {"_id": 0}).to_list(None)
    labels = await _round_labels(db, series_id)
    for sheet in sheets:
        if any({old, new} <= content_participant_ids(source) for source in (sheet, sheet.get("pending_draft") or {})):
            where = labels.get(sheet.get("round_id")) or "einem archivierten Termin"
            raise HTTPException(409, f"„{kept['name']}“ und „{duplicate['name']}“ stehen beide im Ergebnis von "
                                     f"{where}. Erst dort eine der beiden Zeilen entfernen, dann zusammenführen.")

    moved, revisions = [], []
    for sheet in sheets:
        pending = sheet.get("pending_draft")
        in_sheet = old in content_participant_ids(sheet)
        in_pending = bool(pending) and (old in content_participant_ids(pending)
                                        or old in (pending.get("created_participant_ids") or []))
        if not (in_sheet or in_pending):
            continue
        if in_sheet:
            revisions.append(await _merge_revision(db, sheet, "sheet", me))
        if in_pending:
            revisions.append(await _merge_revision(db, sheet, "pending_draft", me))
        update = swap_participant({key: sheet[key] for key in ("rows", "matches", "official_totals") if key in sheet},
                                  old, new)
        if pending:
            update["pending_draft"] = swap_participant(pending, old, new)
        named = old in sheet_participant_ids(sheet)
        await db.reference_round_results.update_one(
            {"id": sheet["id"]}, {"$set": update, **({"$inc": {"version": 1}} if named else {})})
        if named:
            moved.append(sheet["round_id"])

    game_id = await series_game_id(db, series)
    duplicate_aliases = await _aliases_of(db, duplicate, game_id)
    fill = {key: duplicate.get(key) for key in MERGE_TAKES if not kept.get(key) and duplicate.get(key)}
    if duplicate.get("name_hidden") and not kept.get("name_hidden"):
        fill["name_hidden"] = True
    adopted = kept.get("link_status") == "open" and duplicate.get("link_status") == "decided"
    if adopted:
        fill.update({key: duplicate.get(key) for key in LINK_STATE})
    await db.reference_participants.update_one({"id": new}, {"$set": {
        **fill, "updated_at": now_utc().isoformat(), "updated_by": me["id"]}})
    await db.reference_participants.delete_one({"id": old, "series_id": series_id})

    # Die Aliase der anderen Schreibweise gehören jetzt zum behaltenen und folgen seiner Zuordnung.
    final = await _participant(db, series_id, new)
    moving = [alias for alias in duplicate_aliases if alias["id"] != final.get("alias_id")]
    if final.get("link_status") == "decided":
        link = {key: final.get(key) for key in LINK_FIELDS}
        kept_ids, plan, followers = await _align_aliases(db, series_id, new, moving, link, me)
    else:
        kept_ids, plan, followers = [alias["id"] for alias in moving], {}, []
    extra = [alias_id for alias_id in dict.fromkeys([*(final.get("extra_alias_ids") or []), *kept_ids])
             if alias_id != final.get("alias_id")]
    await db.reference_participants.update_one({"id": new}, {"$set": {"extra_alias_ids": extra}})
    await reference_series.recompute_standings(db, series)
    return {"plan": plan, "audit": {
        "series_id": series_id, "name": kept["name"], "duplicate_id": old, "duplicate_name": duplicate["name"],
        "duplicate_link": duplicate.get("link"), "duplicate_status": duplicate.get("link_status"),
        "duplicate_profile_id": duplicate.get("profile_id"), "round_ids": moved, "revision_ids": revisions,
        "taken_over": sorted(fill), "adopted_link": adopted, "aliases": [alias["id"] for alias in moving],
        "aliases_withdrawn": final.get("link") == "external" and final.get("link_status") == "decided",
        "followers": followers}}


@router.delete("/admin/series/{series_id}/participants/{participant_id}")
@reference_series.series_locked
async def delete_participant(series_id: str, participant_id: str, me: dict = Depends(require_area("content"))):
    """Einen Teilnehmer ohne Ergebnis entfernen (#1929), etwa einen Tippfehler aus der Starterliste. Steht er in einem
    Ergebnis - auch in einem Entwurf -, geht das nur über Zusammenführen (409). Ein Alias bleibt: er gilt über alle
    Saisons und wird nur über „Extern“ zurückgenommen."""
    db = get_db()
    await _series(db, series_id)
    row = await _participant(db, series_id, participant_id)
    async for sheet in db.reference_round_results.find({"series_id": series_id}, {"_id": 0}):
        if participant_id in sheet_participant_ids(sheet):
            where = (await _round_labels(db, series_id)).get(sheet.get("round_id")) or "einem archivierten Termin"
            raise HTTPException(409, f"„{row['name']}“ steht im Ergebnis von {where}. Entfernen geht nur über "
                                     "Zusammenführen.")
    await db.reference_participants.delete_one({"id": participant_id, "series_id": series_id})
    await _log(db, "reference_series.participant_delete", me, participant_id, {
        "series_id": series_id, "name": row["name"], "start_number": row.get("start_number"),
        "default_team": row.get("default_team"), "link": row.get("link"), "link_status": row.get("link_status"),
        "profile_id": row.get("profile_id")})
    return {"removed": participant_id}


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


async def _aliases_of(db, participant: dict, game_id: str | None) -> list[dict]:
    """Alle Aliase, die zu diesem Teilnehmer gehören (#1929): der seiner Zuordnung (``alias_id``), der seines Namens und
    weitere aus Zusammenführen oder einem früheren Namen (``extra_alias_ids``). Jeder nur einmal."""
    ids = [alias_id for alias_id in [participant.get("alias_id"), *(participant.get("extra_alias_ids") or [])]
           if alias_id]
    found = {row["id"]: row for row in await db.reference_aliases.find({"id": {"$in": ids}}, {"_id": 0}).to_list(None)}
    by_name = await db.reference_aliases.find_one(
        {"name_normalized": series_identity.normalize_name(participant.get("name") or ""), "game_id": game_id},
        {"_id": 0})
    if by_name:
        found.setdefault(by_name["id"], by_name)
    return list(found.values())


async def _align_aliases(db, series_id: str, participant_id: str, aliases: list[dict], link: dict,
                         me: dict) -> tuple[list[str], dict[str, list[dict]], list[str]]:
    """Weitere Aliase eines Teilnehmers (zusammengeführte Schreibweise, früherer Name) an seine Zuordnung angleichen -
    unter der Sperre der Saison aufrufen. Extern nimmt sie zurück; Mitglied und Gast lassen sie auf dieselbe Person
    zeigen. In dieser Saison folgen die Teilnehmer gleich; andere Saisons liefert der Plan für
    ``reference_series.follow_aliases_elsewhere``. Liefert (bleibende Alias-Kennungen, Plan, gefolgte Teilnehmer)."""
    me_ref = {"id": me["id"]}
    kept_ids, plan, followers = [], {}, []
    for alias in aliases:
        if link["link"] == "external":
            await db.reference_aliases.delete_one({"id": alias["id"]})
            followers += await move_followers(db, alias["id"], link, me_ref, participant_id, [series_id])
            others = await follower_series(db, alias["id"], participant_id)
        else:
            now = now_utc().isoformat()
            await db.reference_aliases.update_one({"id": alias["id"]}, {"$set": {
                "target": "member" if link["link"] == "member" else "guest", "profile_id": link["profile_id"],
                "guest_name": link["guest_name"], "confirmed_by": me["id"], "confirmed_at": now, "updated_at": now}})
            fresh = await db.reference_aliases.find_one({"id": alias["id"]}, {"_id": 0})
            followers += await move_followers(db, alias["id"], link, me_ref, participant_id, [series_id])
            followers += await apply_alias(db, fresh, me_ref, participant_id, [series_id])
            others = (await follower_series(db, alias["id"], participant_id)) | (
                await open_series(db, fresh, participant_id))
            kept_ids.append(alias["id"])
        others.discard(series_id)
        for other in sorted(others):
            plan.setdefault(other, []).append(
                {"alias_id": alias["id"], "skip_id": participant_id, "requested_by": me["id"]})
    return kept_ids, plan, followers


def _join_plans(*plans: dict[str, list[dict]]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for plan in plans:
        for series_id, followups in plan.items():
            out.setdefault(series_id, []).extend(followups)
    return out


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
    updated, pending, moved = await reference_series.follow_aliases_elsewhere(db, done["plan"])
    await _log(db, "reference_series.participant_assign", me, participant_id, {
        **done["audit"], "also_assigned_in": updated, "pending_series": pending,
        "followers": [*done["followers"], *moved]})
    out = await _participant(db, series_id, participant_id)
    out["other_series"] = {"updated": updated, "pending": pending}
    if pending:
        out["notice"] = _pending_notice(pending)
    return out


@router.post("/admin/series/{series_id}/participants/bulk-assign")
async def bulk_assign_participants(series_id: str, body: ParticipantBulkAssign,
                                   me: dict = Depends(require_area("content"))):
    """Sammelaktion (#1929): mehrere Teilnehmer der Saison auf einmal als Gast oder Extern - je Teilnehmer wie das
    Zuordnen (Gast speichert den Alias, Extern nimmt ihn zurück), aber gesammelt: alle unter EINER Sperre dieser Saison,
    danach einmal neu rechnen. Andere Saisons, die über einen Alias daran hängen, ziehen erst danach nach - je Saison
    einmal unter ihrer eigenen Sperre (``follow_aliases_elsewhere``), nie zwei Sperren ineinander; eine besetzte
    merkt sich die Nachträge. Wer schon so zugeordnet ist, bleibt unverändert. Gehört ein Teilnehmer nicht zur Saison
    (404) oder taugt ein Name nicht für einen Alias (422), wird keiner geändert. Ein Protokolleintrag für alle."""
    db = get_db()
    wanted = list(dict.fromkeys(body.participant_ids))
    request = ParticipantAssign(link=body.link)
    async with reference_series.series_write(db, series_id):
        series = await _series(db, series_id)
        found = {row["id"]: row for row in await db.reference_participants.find(
            {"series_id": series_id, "id": {"$in": wanted}}, {"_id": 0}).to_list(None)}
        if len(found) != len(wanted):
            raise HTTPException(404, "Teilnehmer nicht gefunden.")
        todo = [found[pid] for pid in wanted
                if not (found[pid].get("link_status") == "decided" and found[pid].get("link") == body.link)]
        unusable = [row["name"] for row in todo if not series_identity.is_usable_name(row["name"])]
        if body.link == "guest" and unusable:
            raise HTTPException(422, f"{UNUSABLE_NAME} Bitte erst den Namen korrigieren: {', '.join(unusable)}")
        plan: dict[str, list[dict]] = {}
        items = []
        for row in todo:
            done = await _assign(db, series_id, row["id"], request, me, recompute=False)
            plan = _join_plans(plan, done["plan"])
            audit = done["audit"]
            items.append({"participant_id": row["id"], "name": row["name"], "previous_link": row.get("link"),
                          "previous_status": row.get("link_status"), "previous_profile_id": row.get("profile_id"),
                          "alias_id": audit["alias_id"], "replaced_alias": audit["replaced_alias"],
                          "followers": done["followers"]})
        if todo:
            await reference_series.recompute_standings(db, series)
    updated, pending, moved = await reference_series.follow_aliases_elsewhere(db, plan)
    changed = [row["id"] for row in todo]
    if changed:
        await _log(db, "reference_series.participant_bulk_assign", me, series_id, {
            "series_id": series_id, "link": body.link, "items": items, "also_assigned_in": updated,
            "pending_series": pending, "followers_elsewhere": moved})
    done_ids = set(changed)
    out = {"changed": changed, "unchanged": [pid for pid in wanted if pid not in done_ids],
           "other_series": {"updated": updated, "pending": pending}}
    if pending:
        out["notice"] = _pending_notice(pending)
    return out


async def _assign(db, series_id: str, participant_id: str, body: ParticipantAssign, me: dict, *,
                  recompute: bool = True) -> dict:
    """Das Zuordnen in dieser Saison, samt Neurechnen - nur unter ihrer Sperre aufrufen. Ändert keine andere Saison;
    liefert, welche anderen Saisons die Aliase mitziehen, samt Nachträgen (``plan`` je Saison für
    ``follow_aliases_elsewhere``), die hier gefolgten Teilnehmer und die Angaben fürs Protokoll. Eine Sammelaktion
    rechnet selbst einmal am Ende (``recompute=False``).

    Hat der Teilnehmer weitere Aliase (zusammengeführte Schreibweise, früherer Name - ``_aliases_of``), folgen sie der
    neuen Zuordnung: „Extern“ nimmt alle zurück, Mitglied und Gast lassen alle auf dieselbe Person zeigen (#1929)."""
    series = await _series(db, series_id)
    participant = await _participant(db, series_id, participant_id)
    game_id = await series_game_id(db, series)
    link = await _link_for(db, body, participant)
    me_ref = {"id": me["id"]}
    own_aliases = await _aliases_of(db, participant, game_id)

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

    extras = [alias for alias in own_aliases if alias["id"] != followed]
    extra_ids, extra_plan, extra_followers = await _align_aliases(db, series_id, participant_id, extras, link, me)
    followers += extra_followers

    now = now_utc().isoformat()
    await db.reference_participants.update_one({"id": participant_id}, {"$set": {
        **link, "link_status": "decided", "link_source": source, "alias_id": alias_id, "extra_alias_ids": extra_ids,
        "decided_at": now, "decided_by": me["id"], "updated_at": now, "updated_by": me["id"]}})
    replaced = ({key: previous_alias.get(key) for key in ("id", "target", "profile_id", "confirmed_at")}
                if previous_alias else None)
    if recompute:
        await reference_series.recompute_standings(db, series)
    others.discard(series_id)
    followup = {"alias_id": followed, "skip_id": participant_id, "requested_by": me["id"]}
    own_plan = {other: [followup] for other in sorted(others)} if followed else {}
    return {
        "plan": _join_plans(own_plan, extra_plan),
        "followers": followers,
        "audit": {"series_id": series_id, "link": link["link"], "profile_id": link["profile_id"],
                  "previous_link": participant.get("link"), "previous_status": participant.get("link_status"),
                  "previous_profile_id": participant.get("profile_id"), "alias_id": alias_id,
                  "replaced_alias": replaced, "further_aliases": [alias["id"] for alias in extras]},
    }
