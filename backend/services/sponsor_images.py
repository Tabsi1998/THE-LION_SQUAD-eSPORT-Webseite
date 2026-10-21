"""Logo und Banner der Partner aus dem Vereinsmodul (#880, ab Vereine 1.9.0).

Das Modul liefert je Geschäftspartner bis zu vier Bilder: Logo und Banner, je für hellen und dunklen Hintergrund
(``GET /vereine/partners``, Datei über ``…/partners/{id}/images/{kind}/{variant}`` mit der Prüfsumme als ETag). Der
Abgleich der Sponsoren (``dolibarr_sponsors.refresh``) legt die Bilder unter den Uploads ab - geladen wird nur, was
eine neue Prüfsumme hat, und gespeichert nur, was zur Prüfsumme passt. Am Eintrag steht ``dolibarr_images``:
``{"logo": {"dark": {...}, "light": {...}}, "banner": {...}}``.

Welches Bild wo erscheint, hängt am Hintergrund (Entscheidung des Betreibers vom 03.10.2026, 2A):
- dunkel (Website, App, TV): Dolibarr dunkel → Dolibarr hell → das auf der Website hochgeladene Bild;
- hell (Mails, PDFs): Dolibarr hell → Upload → Dolibarr dunkel - ein Logo für dunklen Grund ist oft weiß und wäre
  auf weißem Papier unsichtbar.
"""
from __future__ import annotations

import hashlib
import logging

from storage import UPLOAD_DIR

logger = logging.getLogger("tls.sponsor_images")

MIN_VERSION = (1, 9, 0)
PREFIX = "dolibarr-partner-"
KINDS = ("logo", "banner")
VARIANTS = ("dark", "light")
TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
MAX_BYTES = 8 * 1024 * 1024
SURFACES = {"dark": ("dark", "light", "upload"), "light": ("light", "upload", "dark")}
UPLOAD_FIELDS = {"logo": "logo_url", "banner": "banner_url"}


def pick(doc: dict, kind: str, surface: str = "dark") -> tuple[str | None, str]:
    """Das Bild für einen Hintergrund und woher es kommt: ``("/api/static/uploads/…", "dolibarr-dark")``."""
    images = ((doc.get("dolibarr_images") or {}).get(kind) or {}) if isinstance(doc.get("dolibarr_images"), dict) else {}
    for step in SURFACES.get(surface, SURFACES["dark"]):
        if step == "upload":
            upload = doc.get(UPLOAD_FIELDS[kind])
            if upload:
                return upload, "upload"
        elif isinstance(images.get(step), dict) and images[step].get("url"):
            return images[step]["url"], f"dolibarr-{step}"
    return None, ""


def apply(doc: dict, surface: str = "dark") -> dict:
    """Ein Eintrag mit dem wirksamen Logo in ``logo_url`` und, wenn es einen gibt, dem Banner in ``banner_url`` - ohne
    die Rohdaten aus Dolibarr. Ohne Bilder aus Dolibarr bleibt die Sicht genau wie vorher."""
    view = {key: value for key, value in doc.items() if key not in ("dolibarr_images", "banner_url")}
    logo, source = pick(doc, "logo", surface)
    banner, _ = pick(doc, "banner", surface)
    view["logo_url"] = logo
    if banner:
        view["banner_url"] = banner
    if source.startswith("dolibarr-"):
        view["logo_source"] = source
    return view


def admin_summary(doc: dict) -> dict:
    """Für die Verwaltung: welche Fassungen aus Dolibarr da sind und was die Website zeigt."""
    images = doc.get("dolibarr_images") if isinstance(doc.get("dolibarr_images"), dict) else {}
    return {
        kind: {"variants": sorted((images.get(kind) or {}).keys()), "shown": pick(doc, kind, "dark")[1] or None}
        for kind in KINDS
    }


def _name_of(entry: dict | None) -> str:
    url = str((entry or {}).get("url") or "")
    return url.rsplit("/", 1)[-1] if url.startswith("/api/static/uploads/") else ""


def _stored(entry: dict | None) -> bool:
    name = _name_of(entry)
    return bool(name) and name.startswith(PREFIX) and (UPLOAD_DIR / name).is_file()


def _remove(entry: dict | None) -> None:
    """Nur eigene Dateien (Präfix) unter den Uploads - nie ein hochgeladenes Logo."""
    name = _name_of(entry)
    if name.startswith(PREFIX):
        try:
            (UPLOAD_DIR / name).unlink(missing_ok=True)
        except OSError as exc:
            logger.warning("[sponsor-images] %s nicht gelöscht: %s", name, type(exc).__name__)


async def _fetch(client, partner_id: int, kind: str, variant: str, wanted: dict) -> dict | None:
    """Ein Bild holen und ablegen - nur, wenn Art, Größe und Prüfsumme stimmen."""
    from services.dolibarr_client import DolibarrError

    try:
        answer = await client.partner_image(partner_id, kind, variant)
    except DolibarrError as exc:
        logger.warning("[sponsor-images] Partner %s %s/%s: %s", partner_id, kind, variant, exc.kind)
        return None
    content = answer.get("content") or b""
    content_type = str((answer.get("headers") or {}).get("Content-Type") or wanted.get("content_type") or "").split(";")[0].strip().lower()
    sha = str(wanted.get("sha256") or "")
    extension = TYPES.get(content_type)
    if answer.get("status") != 200 or not content or not extension or len(content) > MAX_BYTES or hashlib.sha256(content).hexdigest() != sha:
        logger.warning("[sponsor-images] Partner %s %s/%s abgewiesen (Status %s, Art %s, Prüfsumme passt: %s)", partner_id, kind, variant,
                       answer.get("status"), content_type or "?", hashlib.sha256(content).hexdigest() == sha)
        return None
    name = f"{PREFIX}{int(partner_id)}-{kind}-{variant}-{sha[:12]}.{extension}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    (UPLOAD_DIR / name).write_bytes(content)
    return {"url": f"/api/static/uploads/{name}", "sha256": sha, "content_type": content_type,
            "width": wanted.get("width"), "height": wanted.get("height"), "updated_at": wanted.get("updated_at")}


async def sync(db, client) -> dict:
    """Bilder der Partner abgleichen - für jeden Sponsor und Partner der Website, der aus Dolibarr kommt.

    Unveränderte Prüfsumme: kein Abruf. Neue Prüfsumme: holen, prüfen, die alte Datei weg. In Dolibarr entfernt: Feld
    und Datei weg. Scheitert ein Abruf, bleibt die bisherige Fassung stehen."""
    partners = await client.partners()
    by_id = {int(row["id"]): row for row in partners if isinstance(row, dict) and str(row.get("id") or "").isdigit()}
    counts = {"partners": len(by_id), "fetched": 0, "kept": 0, "removed": 0, "failed": 0}
    fetched: dict[tuple, dict] = {}
    for collection in (db.sponsors, db.partners):
        async for doc in collection.find({"dolibarr_id": {"$exists": True}}, {"_id": 0, "id": 1, "dolibarr_id": 1, "dolibarr_images": 1}):
            try:
                partner_id = int(doc.get("dolibarr_id"))
            except (TypeError, ValueError):
                continue
            partner = by_id.get(partner_id) or {}
            wanted = {(row.get("kind"), row.get("variant")): row for row in partner.get("images") or []
                      if isinstance(row, dict) and row.get("kind") in KINDS and row.get("variant") in VARIANTS and row.get("sha256")}
            current = doc.get("dolibarr_images") if isinstance(doc.get("dolibarr_images"), dict) else {}
            updated: dict = {}
            for kind in KINDS:
                for variant in VARIANTS:
                    have = (current.get(kind) or {}).get(variant)
                    want = wanted.get((kind, variant))
                    if not want:
                        if have:
                            _remove(have)
                            counts["removed"] += 1
                        continue
                    if have and have.get("sha256") == want["sha256"] and _stored(have):
                        updated.setdefault(kind, {})[variant] = have
                        counts["kept"] += 1
                        continue
                    key = (partner_id, kind, variant, want["sha256"])
                    stored = fetched.get(key)
                    if stored is None:
                        stored = await _fetch(client, partner_id, kind, variant, want)
                        if stored:
                            fetched[key] = stored
                            counts["fetched"] += 1
                    if stored:
                        updated.setdefault(kind, {})[variant] = stored
                        if have and _name_of(have) != _name_of(stored):
                            _remove(have)
                    else:
                        counts["failed"] += 1
                        if have:
                            updated.setdefault(kind, {})[variant] = have
            if updated != current:
                change = {"$set": {"dolibarr_images": updated}} if updated else {"$unset": {"dolibarr_images": ""}}
                await collection.update_one({"id": doc["id"]}, change)
    return counts
