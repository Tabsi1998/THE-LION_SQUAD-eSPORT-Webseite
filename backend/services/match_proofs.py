"""Nachweise zu einem Spiel (#1157, #1158, #2360): Fotos und Video-Links zu Meldung, Vorfall, Protest, Stellungnahme und MOSS.

Ein Nachweis ist persönlich (Gesichter, Bildschirme, Wohnzimmer). Deshalb:

- Sehen dürfen ihn nur die Spieler dieses Spiels (bei Teams jedes Mitglied) und die Leitung dieses Turniers - global oder
  mit Ergebnis- bzw. Protest-Recht für genau dieses Spiel. Nie öffentlich, nicht in Galerie oder Suche. Ein Nachweis mit dem
  Bezug ``moss`` (Anti-Cheat, Regelwerk § 9a) geht nur an die Person, die ihn hochgeladen hat, an Captain und Vertreter
  ihrer Seite und an die Leitung, die an dem Spiel nicht beteiligt ist - nicht an die übrigen Spieler der eigenen Seite
  und nie an die Gegenseite.
- Ein Bild wird nur über ``GET /api/matches/{id}/proof-photos/{foto}`` nach dieser Prüfung ausgeliefert, nie über eine
  öffentliche Upload-Adresse. Wer nicht darf, bekommt 404 (wie bei Chat-Anhängen - sonst ließe sich prüfen, ob es
  ein Foto gibt).
- Beim Hochladen wird das Bild geprüft und neu gespeichert (derselbe Weg wie jeder Bild-Upload,
  ``services.image_upload._encode_image_bytes``): nur PNG, JPG oder WebP, Größe und Pixel begrenzt, Drehung übernommen,
  EXIF mit GPS-Ort und Kamera fällt dabei weg.
- Bildprüfung wie im Chat (#415): bis das Ergebnis da ist, sieht das Foto nur, wer es hochgeladen hat.
- Ein Video ist ein eigener Eintrag mit einem Link (nur ``https``): Er wird nie eingebettet und nie vom Server abgerufen.
- Aufbewahrung (``services/match_proof_retention.purge``): Turniere 30 Tage nach dem Hochladen - außer das Spiel ist dann noch in Klärung. Liga-Staffeln
  bis Season-Ende plus ``evidence_keep_days``, länger bei offenem Vorfall oder Verfahren; MOSS nur bis das Verfahren beendet
  und die Einspruchsfrist vorbei ist. Nie verwendete Fotos verschwinden nach 24 Stunden. Alles geht mit dem Turnier und
  mit dem Konto (Kontolöschung).

Zwei Wege: Der alte (ein Foto je Meldung oder Problem) lädt hoch (``pending``, sichtbar nur für den Absender) und hängt das
Foto beim Abschicken an (``attached``). Der neue (``add_proof``) kennt den Bezug schon und hängt sofort an - beliebig viele je
Bezug (docs/LIGA.md, „D.5/E.2-Vertrag“; ``services/match_proof_refs`` sagt, ob der Bezug noch offen ist).
"""
from __future__ import annotations

import logging
import pathlib
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from urllib.parse import urlsplit

from fastapi import HTTPException, UploadFile

from models import new_id, now_utc
from services import match_proof_refs as refs
from storage import PROOF_DIR, ensure_directory

logger = logging.getLogger("tls.match_proofs")

PENDING_TTL = timedelta(hours=24)
RETENTION_DAYS = 30
VISIBLE_SCAN_STATES = {"safe", "failed"}
# Ein MOSS-Nachweis, den seine Seite zurückgezogen hat: bleibt für die Leitung, bis die Aufbewahrung ihn löscht.
REMOVED = "removed"
KEPT_STATUSES = ("attached", REMOVED)
LINK_MAX_LENGTH = 500
REF_ID_MAX_LENGTH = 120
# Je Seite und Bezug - genug für „mehrere Screenshots aus verschiedenen Runden“ (Regelwerk § 9.7), zu wenig zum Zumüllen.
MAX_PER_REF = 10
LINK_FORBIDDEN = set("<>\"'\\^`{|}")


def proof_path(key: str | None) -> pathlib.Path | None:
    if not key or "/" in key or "\\" in key or ".." in key or key.startswith("."):
        return None
    return PROOF_DIR / key


def proof_url(match_id: str, photo_id: str) -> str:
    return f"/api/matches/{match_id}/proof-photos/{photo_id}"


def public_proof(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "url": proof_url(doc.get("match_id") or "", doc["id"]),
        "width": doc.get("width"),
        "height": doc.get("height"),
        # Bildprüfung (#415): „pending“ und „review“ sieht nur, wer es hochgeladen hat.
        "scan_state": doc.get("scan_state") or "safe",
    }


def is_link(doc: dict) -> bool:
    return doc.get("type") == "link"


def clean_link(value) -> str:
    """Ein Video-Link: nur ``https``, begrenzt lang, ohne Zugangsdaten - die Domain ist frei. Der Server ruft ihn nie ab."""
    text = str(value or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Bitte einen Link angeben.")
    if len(text) > LINK_MAX_LENGTH:
        raise HTTPException(status_code=422, detail=f"Der Link ist zu lang (höchstens {LINK_MAX_LENGTH} Zeichen).")
    if any(char.isspace() or not char.isprintable() or char in LINK_FORBIDDEN for char in text):
        raise HTTPException(status_code=422, detail="Der Link enthält Zeichen, die in einer Adresse nicht vorkommen.")
    try:
        parts = urlsplit(text)
        # ``port`` wirft bei einer Angabe, die keine Portnummer ist.
        host, user, port_ok = parts.hostname, parts.username or parts.password, parts.port != 0
    except ValueError:
        raise HTTPException(status_code=422, detail="Das ist kein gültiger Link.")
    if not port_ok:
        raise HTTPException(status_code=422, detail="Das ist kein gültiger Link.")
    if parts.scheme.lower() != "https":
        raise HTTPException(status_code=422, detail="Nur Links mit https:// sind erlaubt.")
    if user or "@" in parts.netloc:
        raise HTTPException(status_code=422, detail="Ein Link mit Zugangsdaten ist nicht erlaubt.")
    if not host or "." not in host.strip("."):
        raise HTTPException(status_code=422, detail="Das ist kein gültiger Link.")
    return "https://" + text[len("https://"):]


async def _store_image(db, match: dict, owner: dict, registration_id: str | None, file: UploadFile, *,
                       status: str, context: dict | None) -> dict:
    from services.image_upload import MAX_BYTES, MAX_IMAGE_UPLOAD_MB, _encode_image_bytes, _read_upload_limited

    data = await _read_upload_limited(file, MAX_BYTES, MAX_IMAGE_UPLOAD_MB)
    suffix = pathlib.Path(file.filename or "").suffix.lower()
    encoded = _encode_image_bytes(data, file.content_type or "", suffix, file.filename or "foto")
    key = f"{uuid.uuid4().hex}{encoded['ext']}"
    path = PROOF_DIR / key
    try:
        ensure_directory(PROOF_DIR)
        path.write_bytes(encoded["data"])
    except OSError as exc:
        logger.error("[proofs] could not write %s: %s", key, type(exc).__name__)
        raise HTTPException(status_code=500, detail="Upload-Speicher ist nicht beschreibbar.")
    now = now_utc().isoformat()
    doc = {
        "id": new_id(),
        "match_id": match["id"],
        "tournament_id": match.get("tournament_id"),
        "owner_id": owner["id"],
        "registration_id": registration_id,
        "storage_key": key,
        "mime": encoded["content_type"],
        "size": len(encoded["data"]),
        "width": encoded["width"],
        "height": encoded["height"],
        "status": status,
        "context": context,
        # Von Anfang an „in Prüfung“: Der neue Weg hängt sofort an - ohne den Stand sähe die Gegenseite das Bild, bis die
        # Bildprüfung ihn setzt, und für immer, falls sie sich gar nicht anstoßen lässt.
        "scan_state": "pending",
        "created_at": now,
        "updated_at": now,
    }
    await db.match_proof_photos.insert_one(dict(doc))
    from services import media_scan

    try:
        scan = await media_scan.enqueue(db, kind="proof", ref_id=doc["id"], owner_id=owner["id"], path=path,
                                        context={"type": "proof", "match_id": match["id"]})
        doc["scan_state"] = "safe" if scan.get("state") == "failed" else (scan.get("state") or "pending")
    except Exception as exc:  # noqa: BLE001 - der Upload gilt; der Sammler holt die Prüfung nach
        logger.warning("[proofs] Bildprüfung für %s nicht angestoßen: %s", doc["id"], type(exc).__name__)
        doc["scan_state"] = "pending"
    return doc


async def store_proof(db, match: dict, owner: dict, registration_id: str | None, file: UploadFile) -> dict:
    """Ein Foto prüfen, neu speichern (ohne EXIF) und als „pending“ ablegen."""
    return public_proof(await _store_image(db, match, owner, registration_id, file, status="pending", context=None))


async def claim_proof(db, photo_id: str | None, *, owner_id: str, match_id: str, kind: str) -> dict | None:
    """Das eigene, noch nicht verwendete Foto dieses Spiels der Meldung oder dem Problem zuordnen."""
    if not photo_id:
        return None
    query = {"id": photo_id, "owner_id": owner_id, "match_id": match_id, "status": "pending"}
    doc = await db.match_proof_photos.find_one(query, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=400, detail="Das Foto gibt es nicht mehr oder es ist schon verwendet - bitte neu wählen.")
    updated = await db.match_proof_photos.update_one(query, {"$set": {
        "status": "attached", "context": {"kind": kind}, "updated_at": now_utc().isoformat()}})
    if not updated.modified_count:
        raise HTTPException(status_code=409, detail="Das Foto wurde gleichzeitig verwendet.")
    return public_proof({**doc, "status": "attached"})


async def visible_proofs(db, photo_ids: list[str]) -> dict[str, dict]:
    """Die Fotos, die es noch gibt und die durch die Bildprüfung sind - für Karten der Gegenseite und der Leitung."""
    ids = [photo_id for photo_id in dict.fromkeys(photo_ids) if photo_id]
    if not ids:
        return {}
    rows = await db.match_proof_photos.find({"id": {"$in": ids}, "status": "attached"}, {"_id": 0}).to_list(len(ids))
    return {row["id"]: public_proof(row) for row in rows
            if (row.get("scan_state") or "safe") in VISIBLE_SCAN_STATES and not is_link(row)}


# ---------------------------------------------------------------- Wer sieht was

@dataclass(frozen=True)
class Viewer:
    user_id: str | None = None
    sides: frozenset = frozenset()    # Anmeldungen dieses Spiels, zu deren Spielern die Person gehört
    acting: frozenset = frozenset()   # … für die sie handeln darf (Captain, Vertreter, wer angemeldet hat)
    lead: bool = False                # Leitung mit Ergebnis- oder Protest-Recht für dieses Spiel - und nicht befangen


async def viewer_for(db, match: dict, user: dict | None) -> Viewer:
    """Als wer diese Person auf die Nachweise des Spiels schaut. Wer zu einer Seite gehört (befangen, #2203), ist hier nie
    „Leitung“, auch mit Liga-Recht: Sie sieht und handelt wie ein Mitglied ihrer Seite - sonst könnte sie Fristen und
    Seitenregeln umgehen und sähe MOSS der Gegenseite. Turniere ohne Liga kennen keine Befangenheit."""
    if not user or not user.get("id"):
        return Viewer()
    from services.match_audience import may_act, player_ids, registrations_for_match, teams_by_id
    from services.tournament_permissions import has_match_result_permission

    registrations = await registrations_for_match(db, match)
    teams = await teams_by_id(db, registrations)
    sides, acting = set(), set()
    for registration in registrations:
        team = teams.get(registration.get("team_id") or "")
        if user["id"] in player_ids(registration, team):
            sides.add(registration["id"])
        if registration.get("user_id") == user["id"] or may_act(registration, team, user["id"]):
            acting.add(registration["id"])
    lead = await has_match_result_permission(user, match, capability=("results", "disputes"))
    if lead:
        from services.league_permissions import conflict_of_interest

        lead = await conflict_of_interest(db, user, match) is None
    return Viewer(user_id=user["id"], sides=frozenset(sides), acting=frozenset(acting), lead=lead)


def is_removed(doc: dict) -> bool:
    """Von der Seite zurückgezogen, aber aufbewahrt - das gibt es nur bei MOSS (``remove_proof``)."""
    return doc.get("status") == REMOVED


def can_see_doc(doc: dict, viewer: Viewer) -> bool:
    state = doc.get("scan_state") or "safe"
    if not viewer.user_id or state == "blocked":
        return False
    if is_removed(doc):
        # Auch wer ihn hochgeladen hat, sieht ihn nicht mehr - nur die Leitung, bis die Aufbewahrung ihn löscht.
        return viewer.lead and state in VISIBLE_SCAN_STATES
    if viewer.user_id == doc.get("owner_id"):
        return True
    if state not in VISIBLE_SCAN_STATES or doc.get("status") != "attached":
        return False
    if refs.kind_of(doc) == "moss":
        # Nur wer hochgeladen hat (oben), wer für diese Seite handeln darf (Captain, Vertreter) und die nicht befangene
        # Leitung - die übrigen Spieler der eigenen Seite nicht: Die Datei zeigt den PC einer einzelnen Person.
        return bool(doc.get("registration_id")) and doc["registration_id"] in viewer.acting or viewer.lead
    return bool(viewer.sides) or viewer.lead


async def can_see(db, doc: dict, user: dict | None) -> bool:
    """Nur Spieler dieses Spiels und die Leitung dieses Turniers - bis zur Bildprüfung nur der Absender, MOSS nie die Gegenseite."""
    if not user or (doc.get("scan_state") or "safe") == "blocked":
        return False
    if user.get("id") == doc.get("owner_id") and not is_removed(doc):
        return True
    match = await db.matches_v2.find_one({"id": doc.get("match_id")}, {"_id": 0})
    if not match:
        return False
    return can_see_doc(doc, await viewer_for(db, match, user))


# ---------------------------------------------------------------- Mehrere Nachweise je Bezug (#2360)

def clean_ref(kind, ref_id) -> tuple[str, str]:
    kind = str(kind or "").strip()
    if kind not in refs.KINDS:
        raise HTTPException(status_code=422, detail="Unbekannter Bezug für den Nachweis.")
    ref_id = "" if kind == "report" else str(ref_id or "").strip()
    if len(ref_id) > REF_ID_MAX_LENGTH:
        raise HTTPException(status_code=422, detail="Unbekannter Bezug für den Nachweis.")
    return kind, ref_id


async def _settings(db, match: dict) -> tuple[dict | None, dict | None]:
    """Die Staffel und ihre Season - beides ``None`` bei einem Turnier ohne Liga."""
    from services.league_scope import is_league_staffel

    tournament = await db.tournaments.find_one(
        {"id": match.get("tournament_id")}, {"_id": 0, "id": 1, "league_context": 1, "appeal_hours": 1, "evidence_keep_days": 1})
    if not is_league_staffel(tournament):
        return None, None
    season = await db.league_seasons.find_one({"id": tournament["league_context"].get("season_id")}, {"_id": 0})
    return tournament, season


def setting(tournament: dict | None, season: dict | None, key: str) -> int:
    """Der Wert der Staffel, sonst der Season, sonst die Vorgabe (docs/LIGA.md, „Season-Felder“)."""
    from services.league_presets import PRESETS

    for source in (tournament, season):
        value = (source or {}).get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            return value
    return PRESETS[key]


async def resolve_ref(db, match: dict, kind: str, ref_id: str) -> refs.Ref:
    """Der Bezug am Spiel. Mehrere Nachweise je Bezug gibt es nur in einer Liga-Staffel - Turniere bleiben beim einen Foto je
    Meldung (``/proof-photos``), dort antworten Auflisten, Hinzufügen und Entfernen mit 404."""
    tournament, season = await _settings(db, match)
    if tournament is None:
        raise HTTPException(status_code=404, detail="Nachweise nicht gefunden")
    return refs.resolve(match, kind, ref_id, appeal_hours=setting(tournament, season, "appeal_hours"))


def _own_side(kind: str, viewer: Viewer, ref: refs.Ref) -> str | None:
    """Für welche Seite die Person hier hinzufügt - ``None``: für keine (höchstens als Leitung)."""
    if kind == "moss":
        # Die MOSS-Datei lädt der Spieler selbst hoch (§ 9a.3), nicht nur Captain und Vertreter.
        return next(iter(sorted(viewer.acting or viewer.sides)), None)
    if kind == "protest":
        return ref.side if ref.side in viewer.acting else next(iter(sorted(viewer.acting)), None)
    if kind == "statement":
        return next((side for side in sorted(viewer.acting) if side != ref.side), next(iter(sorted(viewer.acting)), None))
    return next(iter(sorted(viewer.acting)), None)


def add_refusal(kind: str, viewer: Viewer, ref: refs.Ref, now: datetime) -> tuple[int, str] | None:
    """Warum diese Person zu diesem Bezug nichts hinzufügen darf - ``None``: sie darf."""
    side = _own_side(kind, viewer, ref)
    if side is None and not viewer.lead:
        return 403, "Nachweise fügen nur die beiden Seiten dieses Spiels hinzu."
    if not ref.found:
        return 404, "Den Vorfall oder das Verfahren zu diesem Nachweis gibt es nicht."
    if not ref.open:
        return 409, "Hier lässt sich nichts mehr hinzufügen - die Sache ist abgeschlossen."
    if side is None:
        return None
    if kind == "protest" and ref.side and side != ref.side:
        return 403, "Nachweise zum Protest reicht die Seite nach, die ihn eingelegt hat."
    if kind == "statement" and ref.side and side == ref.side:
        return 403, "Nachweise zur Stellungnahme fügt die Gegenseite hinzu."
    deadline = ref.evidence_until if kind == "protest" else ref.statement_until if kind == "statement" else None
    if deadline and now > deadline:
        return 409, "Die Frist zum Nachreichen ist vorbei."
    return None


def proof_view(doc: dict, viewer: Viewer, ref: refs.Ref, *, can_change: bool) -> dict:
    """``can_change``: Darf diese Person zu diesem Bezug gerade hinzufügen? Nur dann darf sie Eigenes auch entfernen."""
    context = doc.get("context") or {}
    own = viewer.user_id == doc.get("owner_id")
    view = {
        "id": doc["id"],
        "type": "link" if is_link(doc) else "image",
        "kind": refs.kind_of(doc),
        "ref_id": context.get("ref_id") or "",
        "side": doc.get("registration_id"),
        "own": own,
        "own_side": bool(doc.get("registration_id")) and doc["registration_id"] in viewer.sides,
        "created_at": doc.get("created_at"),
        # Altbestand (ohne ``ref_id``) hängt an einer Meldung oder einem Problem und bleibt dort.
        "can_remove": own and can_change and "ref_id" in context and not is_removed(doc),
    }
    if is_removed(doc):
        view = {**view, "removed": True, "removed_at": doc.get("removed_at")}
    if is_link(doc):
        return {**view, "link": doc.get("link")}
    return {**view, **public_proof(doc)}


async def _rows_of(db, match_id: str, kind: str, ref_id: str) -> list[dict]:
    rows = await db.match_proof_photos.find({"match_id": match_id, "status": {"$in": list(KEPT_STATUSES)}}, {"_id": 0}).to_list(1000)
    return sorted((row for row in rows if refs.kind_of(row) == kind and ((row.get("context") or {}).get("ref_id") or "") == ref_id),
                  key=lambda row: str(row.get("created_at") or ""))


async def list_proofs(db, match: dict, user: dict, kind, ref_id) -> dict:
    """Die Nachweise eines Bezugs, soweit diese Person sie sehen darf. Wer zu keiner Seite gehört und nicht leitet: 404."""
    kind, ref_id = clean_ref(kind, ref_id)
    viewer = await viewer_for(db, match, user)
    ref = await resolve_ref(db, match, kind, ref_id)
    if not (viewer.sides or viewer.acting or viewer.lead) or not ref.found:
        raise HTTPException(status_code=404, detail="Nachweise nicht gefunden")
    rows = [row for row in await _rows_of(db, match["id"], kind, ref_id) if can_see_doc(row, viewer)]
    can_add = add_refusal(kind, viewer, ref, now_utc()) is None
    return {
        "items": [proof_view(row, viewer, ref, can_change=can_add) for row in rows],
        "open": ref.open,
        "can_add": can_add,
        "limit": MAX_PER_REF,
        "link_max_length": LINK_MAX_LENGTH,
    }


async def _audit(db, action: str, match: dict, actor_id: str, doc: dict, **extra) -> None:
    # Nie die Adresse eines Links: das Protokoll bleibt länger als der Nachweis.
    await db.audit_logs.insert_one({
        "id": new_id(), "action": action, "target_id": match.get("tournament_id") or match.get("id"), "actor_id": actor_id,
        "data": {"match_id": match.get("id"), "proof_id": doc["id"], "type": "link" if is_link(doc) else "image",
                 "kind": refs.kind_of(doc), "ref_id": (doc.get("context") or {}).get("ref_id") or "", **extra},
        "created_at": now_utc().isoformat(),
    })


async def check_add(db, match: dict, user: dict, kind, ref_id) -> tuple[str, str, Viewer, refs.Ref]:
    """Darf diese Person zu diesem Bezug hinzufügen? Sonst die passende Absage (vor Rate-Limit und Upload)."""
    kind, ref_id = clean_ref(kind, ref_id)
    viewer = await viewer_for(db, match, user)
    ref = await resolve_ref(db, match, kind, ref_id)
    refusal = add_refusal(kind, viewer, ref, now_utc())
    if refusal:
        raise HTTPException(status_code=refusal[0], detail=refusal[1])
    return kind, ref_id, viewer, ref


async def add_proof(db, match: dict, user: dict, checked: tuple, *, file: UploadFile | None = None, link: str | None = None) -> dict:
    """Ein Bild oder einen Video-Link an den Bezug hängen - sofort ``attached``. ``checked`` kommt aus ``check_add``."""
    kind, ref_id, viewer, ref = checked
    has_link = bool(str(link or "").strip())
    if (file is None) == (not has_link):
        raise HTTPException(status_code=422, detail="Bitte entweder ein Bild oder einen Link angeben.")
    url = clean_link(link) if has_link else None
    side = _own_side(kind, viewer, ref)
    mine = [row for row in await _rows_of(db, match["id"], kind, ref_id)
            if not is_removed(row) and (row.get("registration_id") == side if side else row.get("owner_id") == user["id"])]
    if len(mine) >= MAX_PER_REF:
        raise HTTPException(status_code=409, detail=f"Mehr als {MAX_PER_REF} Nachweise je Seite gehen hier nicht.")
    context = {"kind": kind, "ref_id": ref_id}
    if url:
        now = now_utc().isoformat()
        doc = {"id": new_id(), "type": "link", "link": url, "match_id": match["id"], "tournament_id": match.get("tournament_id"),
               "owner_id": user["id"], "registration_id": side, "status": "attached", "context": context,
               "created_at": now, "updated_at": now}
        await db.match_proof_photos.insert_one(dict(doc))
    else:
        doc = await _store_image(db, match, user, side, file, status="attached", context=context)
    await _audit(db, "match.proof.add", match, user["id"], doc)
    return proof_view(doc, viewer, ref, can_change=True)


async def remove_proof(db, match: dict, user: dict, proof_id: str) -> dict:
    """Den eigenen Nachweis wieder entfernen - nur über den neuen Weg angehängte und nur, solange diese Person zu dem Bezug
    auch hinzufügen dürfte (offen, eigene Seite, Frist nicht vorbei): Sonst ließe sich ein Beleg nach der Frist noch
    zurückziehen, wenn die Gegenseite schon darauf geantwortet hat. Ein MOSS-Nachweis wird dabei nicht gelöscht, nur als
    entfernt markiert: Die Seite sieht ihn nicht mehr, die Leitung behält ihn, bis die Aufbewahrung ihn löscht - sonst
    könnte ein Spieler eine belastende Datei aus dem laufenden Verfahren nehmen."""
    doc = await db.match_proof_photos.find_one({"id": proof_id, "match_id": match["id"], "owner_id": user["id"]}, {"_id": 0})
    context = (doc or {}).get("context") or {}
    if not doc or doc.get("status") != "attached" or "ref_id" not in context:
        raise HTTPException(status_code=404, detail="Nachweis nicht gefunden")
    kind = refs.kind_of(doc) or ""
    ref = await resolve_ref(db, match, kind, context.get("ref_id") or "")
    if not ref.found:
        raise HTTPException(status_code=404, detail="Nachweis nicht gefunden")
    if not ref.open:
        raise HTTPException(status_code=409, detail="Der Nachweis lässt sich nicht mehr entfernen - die Sache ist abgeschlossen.")
    if add_refusal(kind, await viewer_for(db, match, user), ref, now_utc()) is not None:
        raise HTTPException(status_code=409, detail="Der Nachweis lässt sich nicht mehr entfernen - die Frist dafür ist vorbei.")
    kept = kind == "moss"
    if kept:
        now = now_utc().isoformat()
        await db.match_proof_photos.update_one({"id": doc["id"], "status": "attached"}, {"$set": {
            "status": REMOVED, "removed_at": now, "removed_by": user["id"], "updated_at": now}})
    else:
        await delete_rows(db, [doc])
    await _audit(db, "match.proof.remove", match, user["id"], doc, kept=kept)
    return {"ok": True, "kept_for_lead": kept}


# ---------------------------------------------------------------- Löschen

def _remove_files(doc: dict) -> None:
    from services.image_variants import VARIANT_WIDTHS, variant_path

    path = proof_path(doc.get("storage_key"))
    if path is None:
        return
    path.unlink(missing_ok=True)
    for width in VARIANT_WIDTHS:
        variant_path(path, width).unlink(missing_ok=True)


async def delete_rows(db, rows: list[dict]) -> int:
    for row in rows:
        _remove_files(row)
    if rows:
        await db.match_proof_photos.delete_many({"id": {"$in": [row["id"] for row in rows]}})
    return len(rows)


async def delete_for_tournament(db, tournament_id: str) -> int:
    """Turnier gelöscht: seine Nachweise gleich mit."""
    return await delete_rows(db, await db.match_proof_photos.find({"tournament_id": tournament_id}, {"_id": 0}).to_list(None))


async def delete_for_user(db, user_id: str) -> int:
    """Kontolöschung: die eigenen Nachweise und ihre Dateien weg."""
    return await delete_rows(db, await db.match_proof_photos.find({"owner_id": user_id}, {"_id": 0}).to_list(None))
