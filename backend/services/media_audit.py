"""Audit and normalize stored image references."""
from __future__ import annotations

import os
import pathlib
import re
from urllib.parse import urlparse

from database import get_db
from models import now_utc
from services import uploads_inventory
from services.media_formats import PUBLIC_MEDIA_EXTS, bare_upload_url


UPLOAD_DIR = pathlib.Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
PUBLIC_UPLOAD_DIR = UPLOAD_DIR / "public"
LOCAL_PREFIX = "/api/static/uploads/"
ADMIN_OWNER_ROLES = {"admin", "moderator", "tournament_admin", "club_admin", "superadmin"}
MEDIA_SCOPES = {"user", "admin", "sponsor", "branding", "gallery"}

TARGETS: list[tuple[str, list[str]]] = [
    ("settings", ["logo_url", "logo_light_url", "logo_dark_url", "share_banner_url", "mascot_url", "qr_logo_url", "favicon_url", "favicon_light_url", "favicon_dark_url", "avatar_url"]),
    ("users", ["avatar_url", "banner_url"]),
    ("teams", ["logo_url", "banner_url"]),
    ("sponsors", ["logo_url", "banner_url"]),
    ("partners", ["logo_url", "banner_url"]),
    ("news_posts", ["banner_url", "cover_url"]),
    ("events", ["banner_url", "cover_url"]),
    ("games", ["cover_url", "logo_url"]),
    ("tournaments", ["banner_url", "cover_url"]),
    ("f1_challenges", ["banner_url", "cover_url"]),
    ("f1_tracks", ["image_url"]),
    ("game_maps", ["image_url"]),
    ("seasons", ["banner_url"]),
    ("gallery_albums", ["cover_url"]),
    ("gallery_photos", ["image_url", "thumbnail_url", "video_url"]),
    ("member_benefits", ["image_url"]),
    ("club_member_profiles", ["photo_url", "cover_url"]),
    # Logo je Spur und Saison (#2014): bleibt verwendet, solange eine Spur oder Saison es trägt - auch archivierte.
    ("reference_lineages", ["logo_url"]),
    ("reference_series", ["logo_url"]),
    # Gestaltung der Liga (#2107): Emblem und Banner je Liga und Season.
    ("leagues", ["emblem_url", "banner_url"]),
    ("league_seasons", ["emblem_url", "banner_url"]),
]

TEXT_TARGETS: list[tuple[str, list[str]]] = [
    ("news_posts", ["content"]),
    ("events", ["description", "program"]),
    ("tournaments", ["description"]),
    ("f1_challenges", ["description"]),
    ("club_member_profiles", ["bio"]),
]

MESSAGE_COLLECTIONS = ("direct_messages", "team_chat_messages", "tournament_chat_messages", "match_chat_messages")

# Weitere Stellen, an denen eine hochgeladene Datei verwendet sein kann (#1039): verschachtelte Felder und Texte, die
# die Prüfung oben nicht reparieren kann. Die Kontolöschung behält eine Datei, solange sie hier oder oben steht.
# Gewinnerbilder: die Plätze aus ``services.awards.IMAGE_SLOTS``.
USAGE_TARGETS: list[tuple[str, list[str]]] = [
    ("tournaments", ["award_images.1", "award_images.2", "award_images.3"]),
    ("partners", ["tools.image_url"]),
    ("settings", ["club_photo.url", "timeline.image_url"]),
    ("advent_doors", ["media_url", "sticker.url"]),
    ("stickers", ["url"]),
    # Eine Nachricht speichert ihren Sticker aufgelöst (``services.stickers``): Alte Chats zeigen das Bild weiter, auch
    # wenn der Sticker längst gelöscht ist (#2122). Solange so eine Nachricht steht, ist die Datei verwendet.
    *((collection, ["sticker.url"]) for collection in MESSAGE_COLLECTIONS),
    ("gallery_photos", ["original_url"]),
    ("game_servers", ["server_icon_url"]),
    # Map-Pools (#1616): der Snapshot zeigt das Bild von damals, auch wenn die Map inzwischen ein neues hat.
    ("map_pools", ["modes.maps.image_url"]),
    # Frühere Bilder einer Map: ein gespeichertes Spiel der Team-Liga zeigt das Bild von damals. Ein Bild im
    # Ergebnisblatt kommt immer aus einem Pool-Snapshot oder der Bibliothek - darum zählen diese beiden, die Blätter
    # selbst muss die Mediathek nicht durchsuchen. Eine Map aus einem Spiel lässt sich nicht löschen (``in_results``).
    ("game_maps", ["image_history"]),
    # Gewinnbilder der Liga (#2107) je Season und Liga N.
    ("league_seasons", ["prizes.image_url"]),
    ("league_divisions", ["prizes.image_url"]),
    # Bilder aus der Mitgliederverwaltung je Hintergrund (``services.sponsor_images``).
    *((collection, [f"dolibarr_images.{kind}.{variant}.url" for kind in ("logo", "banner") for variant in ("dark", "light")])
      for collection in ("sponsors", "partners")),
]

USAGE_TEXT_TARGETS: list[tuple[str, list[str]]] = [
    ("tournaments", ["rules", "prize_pool"]),
]

# Lesbare Namen der Verwendungsstellen für die Mediathek (#1471): „Sammlung · Feld“, Sonderfälle ganz.
COLLECTION_LABELS = {
    "settings": "Einstellungen", "users": "Profil", "teams": "Team", "sponsors": "Sponsor", "partners": "Partner",
    "news_posts": "News", "events": "Event", "games": "Spiel", "tournaments": "Turnier",
    "f1_challenges": "Fast Lap", "f1_tracks": "Strecke", "seasons": "Jahreswertung",
    "gallery_albums": "Galerie-Album", "gallery_photos": "Galerie-Foto", "member_benefits": "Mitgliedervorteil",
    "club_member_profiles": "Vereinsprofil", "advent_doors": "Adventkalender", "stickers": "Sticker",
    "game_servers": "Spielserver", "game_maps": "Map", "map_pools": "Map-Pool",
    "reference_lineages": "Spur", "reference_series": "Saison",
    "leagues": "Liga", "league_seasons": "Liga-Season", "league_divisions": "Liga N",
    "direct_messages": "Direktnachricht", "team_chat_messages": "Team-Chat", "tournament_chat_messages": "Turnier-Chat",
    "match_chat_messages": "Match-Chat",
}
FIELD_LABELS = {
    "logo_url": "Logo", "logo_light_url": "Logo hell", "logo_dark_url": "Logo dunkel",
    "share_banner_url": "Bild beim Teilen", "mascot_url": "Maskottchen", "qr_logo_url": "Logo im QR-Code",
    "favicon_url": "Favicon", "favicon_light_url": "Favicon hell", "favicon_dark_url": "Favicon dunkel",
    "avatar_url": "Profilbild", "banner_url": "Banner", "cover_url": "Titelbild", "image_url": "Bild",
    "thumbnail_url": "Vorschaubild", "video_url": "Video", "photo_url": "Foto", "content": "Text",
    "description": "Beschreibung", "program": "Programm", "bio": "Über mich", "rules": "Regeln", "prize_pool": "Preise",
    **{f"award_images.{place}": f"Gewinnerbild Platz {place}" for place in ("1", "2", "3")},
    "tools.image_url": "Bild eines Werkzeugs", "media_url": "Bild oder Video", "url": "Bild", "sticker.url": "Sticker",
    "original_url": "Original", "server_icon_url": "Server-Symbol", "modes.maps.image_url": "Bild einer Map",
    "image_history": "früheres Bild", "emblem_url": "Emblem", "prizes.image_url": "Bild eines Gewinns",
    **{f"dolibarr_images.{kind}.{variant}.url":
       f"{kind.capitalize()} aus der Mitgliederverwaltung ({'dunkler' if variant == 'dark' else 'heller'} Hintergrund)"
       for kind in ("logo", "banner") for variant in ("dark", "light")},
}
PLACE_LABELS = {
    ("settings", "avatar_url"): "Discord · Bild des Bots",
    ("settings", "club_photo.url"): "Über uns · Vereinsfoto",
    ("settings", "timeline.image_url"): "Über uns · Bild in der Chronik",
}
# Verwaltung und Protokolle: Ein Eintrag hier sagt nur, dass es die Datei gibt oder gab - gezeigt wird sie dadurch nicht.
NOT_A_USAGE = {"media_uploads", "media_scans", "upload_events", "audit_logs", "pending_file_cleanups"}
# Wo neben der Adresse auch die Maße stehen: gedreht tauschen sie mit (#2122).
SIZE_FIELDS = {
    ("gallery_photos", "image_url"): ("width", "height"),
    ("stickers", "url"): ("width", "height"),
    "sticker.url": ("sticker.width", "sticker.height"),
}
# Bis zu so vielen Dateien sucht die Verwendungssuche gezielt nach den Namen, darüber liest sie alle Adressen einmal.
BATCH = 100
VARIANT_NAME = re.compile(r"^(?P<stem>.+)-(?P<width>\d{3,4})\.webp$")
LABEL_FIELDS = ("id", "slug", "name", "title", "display_name", "source")

SCOPE_TARGETS: list[tuple[str, list[str], str]] = [
    ("users", ["avatar_url", "banner_url"], "user"),
    ("settings", ["logo_url", "logo_light_url", "logo_dark_url", "share_banner_url", "mascot_url", "qr_logo_url", "favicon_url", "favicon_light_url", "favicon_dark_url", "avatar_url"], "branding"),
    ("sponsors", ["logo_url"], "sponsor"),
    ("gallery_albums", ["cover_url"], "gallery"),
    ("gallery_photos", ["image_url", "thumbnail_url", "video_url"], "gallery"),
    ("teams", ["logo_url", "banner_url"], "admin"),
    ("partners", ["logo_url"], "admin"),
    ("news_posts", ["banner_url", "cover_url"], "admin"),
    ("events", ["banner_url", "cover_url"], "admin"),
    ("games", ["cover_url", "logo_url"], "admin"),
    ("tournaments", ["banner_url", "cover_url"], "admin"),
    ("f1_challenges", ["banner_url", "cover_url"], "admin"),
    ("f1_tracks", ["image_url"], "admin"),
    ("game_maps", ["image_url"], "admin"),
    ("seasons", ["banner_url"], "admin"),
    ("member_benefits", ["image_url"], "admin"),
    ("club_member_profiles", ["photo_url", "cover_url"], "admin"),
    ("reference_lineages", ["logo_url"], "branding"),
    ("reference_series", ["logo_url"], "branding"),
    ("leagues", ["emblem_url"], "branding"),
    ("league_seasons", ["emblem_url"], "branding"),
]

TEXT_IMAGE_RE = re.compile(
    r"!\[[^\]\n]*\]\((?P<md>[^)\s]+)\)|<img\b[^>]*\bsrc=[\"'](?P<html>[^\"']+)[\"']",
    re.IGNORECASE,
)


def _upload_path(value: str) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw.startswith("http://") or raw.startswith("https://"):
        raw = urlparse(raw).path or raw
    normalized = raw.lstrip("/")
    if normalized.startswith("api/static/uploads/"):
        return "/" + normalized
    if normalized.startswith("static/uploads/"):
        return "/api/" + normalized
    if normalized.startswith("uploads/"):
        return "/api/static/" + normalized
    return None


def _filename_from_upload_path(path: str) -> str | None:
    filename = pathlib.PurePosixPath(path.split("#", 1)[0].split("?", 1)[0]).name
    if not filename or filename.startswith(".") or "/" in filename or "\\" in filename:
        return None
    if pathlib.Path(filename).suffix.lower() not in PUBLIC_MEDIA_EXTS:
        return None
    return filename


def _file_exists(filename: str) -> bool:
    return any((base / filename).is_file() for base in (PUBLIC_UPLOAD_DIR, UPLOAD_DIR))


def _iter_text_image_urls(value: str) -> list[str]:
    urls: list[str] = []
    for match in TEXT_IMAGE_RE.finditer(str(value or "")):
        url = match.group("md") or match.group("html")
        if url and url not in urls:
            urls.append(url)
    return urls


def usage_places() -> list[tuple[str, list[str], bool]]:
    """Alle Stellen, an denen eine hochgeladene Datei verwendet sein kann: (Sammlung, Feldpfade, Text?).

    Eine Liste für Kontolöschung, Mediathek und Bild-Migration (#1471)."""
    places = [(collection, fields, False) for collection, fields in TARGETS + USAGE_TARGETS]
    return places + [(collection, fields, True) for collection, fields in TEXT_TARGETS + USAGE_TEXT_TARGETS]


def place_label(collection: str, field: str) -> str:
    """Der lesbare Name einer Verwendungsstelle, z. B. „Turnier · Gewinnerbild Platz 1“."""
    if (collection, field) in PLACE_LABELS:
        return PLACE_LABELS[(collection, field)]
    return f"{COLLECTION_LABELS.get(collection, collection)} · {FIELD_LABELS.get(field, field)}"


def usage_label(collection: str, document: dict) -> str | None:
    """Wovon die Rede ist: der Titel des Eintrags. Eine Nachricht nennt nur, dass es eine ist - nie Kennung oder Inhalt."""
    if collection in MESSAGE_COLLECTIONS:
        return "Nachricht im Chat"
    return document.get("title") or document.get("name") or document.get("display_name") or document.get("id") or document.get("slug")


def stamp_for(collection: str, stamp: dict | None) -> dict | None:
    """Eine Nachricht bekommt kein neues ``updated_at`` - sie wäre sonst „bearbeitet“, ohne dass jemand schrieb."""
    return None if collection in MESSAGE_COLLECTIONS else stamp


def canonical_name(value, candidates: dict[str, str]) -> str | None:
    """Der Dateiname hinter einer Adresse - ohne Query und Fragment, auch absolut; eine kleinere Fassung
    (``variants/<name>-400.webp``) zählt als ihr Original, die PNG-Fassung neben einem SVG-Logo als das SVG (#1952).
    ``candidates``: Stamm → Dateiname."""
    return _canonical_of(uploads_inventory.upload_filename(str(value or "")), candidates)


def _canonical_of(name: str | None, candidates: dict[str, str]) -> str | None:
    if not name or name in candidates.values():
        return name
    variant = VARIANT_NAME.match(name)
    if variant and variant.group("stem") in candidates:
        return candidates[variant.group("stem")]
    path = pathlib.PurePosixPath(name)
    twin = candidates.get(path.stem)
    if path.suffix.lower() == ".png" and twin and twin.lower().endswith(".svg"):
        return twin
    return name


def values_at(document, path: str) -> list:
    """Alle Werte unter einem Feldpfad mit Punkten - auch durch Listen hindurch (``tools.image_url``)."""
    current = [document]
    for key in path.split("."):
        found = []
        for item in current:
            for entry in (item if isinstance(item, list) else [item]):
                if isinstance(entry, dict) and key in entry:
                    found.append(entry[key])
        current = found
    flat = []
    for item in current:
        flat.extend(item if isinstance(item, list) else [item])
    return flat


def replace_values(value, keys: list[str], change):
    """``value`` mit jedem Wert unter dem Pfad ``keys`` durch ``change(wert)`` ersetzt - auch durch Listen hindurch."""
    if isinstance(value, list):
        return [replace_values(item, keys, change) for item in value]
    if not keys:
        return change(value)
    if isinstance(value, dict) and keys[0] in value:
        return {**value, keys[0]: replace_values(value[keys[0]], keys[1:], change)}
    return value


def urls_in_text(text) -> list[str]:
    """Upload-Adressen in einem Text: Markdown-Bilder, ``<img>`` und nackte Adressen."""
    if not isinstance(text, str) or "uploads/" not in text:
        return []
    urls = [match.group("md") or match.group("html") or "" for match in TEXT_IMAGE_RE.finditer(text)]
    return urls + uploads_inventory.URL_IN_TEXT_RE.findall(text)


async def iter_usages(db, names: set[str]):
    """Jede Verwendung einer der Dateien als ``(Sammlung, Dokument, Feldpfad, Dateiname, Text?)``.

    Je Sammlung eine Abfrage für alle Dateien: Bis ``BATCH`` Dateien sucht sie nach den Namen, darüber liest sie jede
    Upload-Adresse einmal (Mediathek). Gezählt wird der Dateiname hinter der Adresse (``canonical_name``). Das Dokument
    enthält nur die Feldpfade und ``LABEL_FIELDS``."""
    if not names:
        return
    candidates = {pathlib.PurePosixPath(name).stem: name for name in sorted(names)}
    pattern = "|".join(re.escape(stem) for stem in sorted(candidates)) if len(names) <= BATCH else "uploads/"
    grouped: dict[str, list[tuple[str, bool]]] = {}
    for collection, fields, text in usage_places():
        grouped.setdefault(collection, []).extend((field, text) for field in fields)
    for collection, fields in grouped.items():
        query = {"$or": [{field: {"$regex": pattern}} for field, _text in fields]}
        projection = {"_id": 1, **{key: 1 for key in LABEL_FIELDS}, **{field: 1 for field, _text in fields}}
        async for document in getattr(db, collection).find(query, projection):
            for field, text in fields:
                # Steht die PNG-Fassung selbst in der Anfrage, zählt die Adresse für sie, nicht für das SVG daneben.
                found = {raw if raw in names else _canonical_of(raw, candidates)
                         for value in values_at(document, field)
                         for url in (urls_in_text(value) if text else [value])
                         for raw in [uploads_inventory.upload_filename(str(url or ""))]}
                for name in sorted(found & names):
                    yield collection, document, field, name, text


async def rewrite_field(collection, row_id, path: str, change, extra: dict | None = None) -> bool:
    """Ändert die Werte unter einem Feldpfad einer Zeile (``replace_values``). Liest dafür das ganze Feld der obersten
    Ebene neu - die Treffer von ``iter_usages`` enthalten nur die Feldpfade. Liefert, ob sich etwas geändert hat."""
    top, *rest = path.split(".")
    row = await collection.find_one({"_id": row_id}, {top: 1})
    if not row or top not in row:
        return False
    value = replace_values(row[top], rest, change)
    if value == row[top]:
        return False
    await collection.update_one({"_id": row_id}, {"$set": {top: value, **(extra or {})}})
    return True


def versioned_url(url: str, version: int) -> str:
    """Die Adresse mit ``?v=``: bleibt die Datei dieselbe, ändert sich der Inhalt, holt jeder Browser sie neu."""
    base, _, fragment = str(url).partition("#")
    path, _, query = base.partition("?")
    kept = [part for part in query.split("&") if part and not part.startswith("v=")]
    return f"{path}?{'&'.join([*kept, f'v={version}'])}" + (f"#{fragment}" if fragment else "")


async def _rewrite_usages(db, filename: str, change, stamp: dict | None) -> list[tuple]:
    """Jede Verwendung der Datei mit ``change(adresse)`` umschreiben, auch Adressen in Texten. Liefert die Treffer."""
    candidates = {pathlib.PurePosixPath(filename).stem: filename}

    def in_field(value):
        return change(value) if canonical_name(value, candidates) == filename else value

    def in_text(text):
        if not isinstance(text, str):
            return text
        return uploads_inventory.URL_IN_TEXT_RE.sub(lambda match: in_field(match.group(0)), text)

    hits = [hit async for hit in iter_usages(db, {filename})]
    for collection, doc, field, _name, text in hits:
        await rewrite_field(getattr(db, collection), doc["_id"], field, in_text if text else in_field, stamp_for(collection, stamp))
    return hits


async def stamp_version(db, filename: str, version: int, size: tuple[int, int], stamp: dict | None = None) -> int:
    """Nach dem Drehen (#2122): Jede Stelle, die das Bild zeigt, bekommt die neue Version an die Adresse und dort, wo die
    Maße mitstehen, die neuen Maße. Liefert, wie viele Stellen es sind."""
    hits = await _rewrite_usages(db, filename, lambda url: versioned_url(url, version), stamp)
    for collection, doc, field, _name, _text in hits:
        keys = SIZE_FIELDS.get(field if field == "sticker.url" else (collection, field))
        if keys:
            await getattr(db, collection).update_one({"_id": doc["_id"]}, {"$set": dict(zip(keys, size))})
    return len(hits)


async def repoint_usages(db, filename: str, target_url: str, stamp: dict | None = None) -> int:
    """Jede Stelle, die ``filename`` zeigt, zeigt danach auf ``target_url`` (Duplikat ersetzen, #2122). Wer die
    PNG-Fassung eines SVG-Logos zeigt - Mail, PDF, Teilen-Karte -, bekommt wieder eine PNG-Fassung."""
    bare_target = bare_upload_url(target_url)
    both_svg = filename.lower().endswith(".svg") and bare_target.lower().endswith(".svg")

    def to_target(url):
        wants_png = both_svg and str(uploads_inventory.upload_filename(str(url)) or "").lower().endswith(".png")
        return f"{bare_target[:-4]}.png" if wants_png else target_url

    return len(await _rewrite_usages(db, filename, to_target, stamp))


async def still_referenced(db, names: set[str]) -> set[str]:
    """Das Netz unter den bekannten Stellen (``usage_places``): Bevor die Mediathek in Masse löscht, liest sie alle
    Sammlungen einmal durch (#2122). Steht eine Datei in einem Feld, das noch niemand eingetragen hat, bleibt sie."""
    if not names:
        return set()
    stems = {pathlib.PurePosixPath(name).stem: name for name in names}
    png_twins = {f"{stem}.png" for stem, name in stems.items() if name.lower().endswith(".svg")}
    # Vollständig: Davon hängt ab, ob eine Datei gelöscht wird. Dafür bleiben Verwaltung und Protokolle ungelesen.
    references, _partial = await uploads_inventory.collect_references(db, set(names) | png_twins, complete=True, skip=NOT_A_USAGE)
    found: set[str] = set()
    for name in references:
        target = _canonical_of(name, stems)
        if target in names:
            found.add(target)
    return found


async def audit_image_references(repair: bool = False, clear_missing: bool = False) -> dict:
    db = get_db()
    summary = {
        "scanned": 0,
        "text_scanned": 0,
        "local_ok": 0,
        "legacy_local": 0,
        "normalized": 0,
        "text_normalized": 0,
        "cleared_missing": 0,
        "external": 0,
        "missing_file": 0,
        "invalid_local": 0,
        "other": 0,
    }
    examples: dict[str, list[dict]] = {
        "legacy_local": [],
        "external": [],
        "missing_file": [],
        "invalid_local": [],
        "other": [],
    }

    def add_example(kind: str, item: dict) -> None:
        if len(examples[kind]) < 20:
            examples[kind].append(item)

    for coll_name, fields in TARGETS:
        collection = db[coll_name]
        async for doc in collection.find({}):
            updates: dict[str, str] = {}
            for field in fields:
                value = doc.get(field)
                if not value:
                    continue
                summary["scanned"] += 1
                value = str(value).strip()
                item = {
                    "collection": coll_name,
                    "id": doc.get("id") or str(doc.get("_id")),
                    "field": field,
                    "value": value,
                }
                upload_path = _upload_path(value)
                if value.startswith("http://") or value.startswith("https://"):
                    if upload_path:
                        filename = _filename_from_upload_path(upload_path)
                        if filename and _file_exists(filename):
                            summary["legacy_local"] += 1
                            add_example("legacy_local", {**item, "normalized": upload_path})
                            if repair:
                                updates[field] = upload_path
                            continue
                    summary["external"] += 1
                    add_example("external", item)
                    continue
                if upload_path:
                    filename = _filename_from_upload_path(upload_path)
                    if not filename:
                        summary["invalid_local"] += 1
                        add_example("invalid_local", item)
                        continue
                    if not _file_exists(filename):
                        summary["missing_file"] += 1
                        add_example("missing_file", {**item, "normalized": upload_path})
                        if clear_missing:
                            updates[field] = None
                        continue
                    if value != upload_path:
                        summary["legacy_local"] += 1
                        add_example("legacy_local", {**item, "normalized": upload_path})
                        if repair:
                            updates[field] = upload_path
                    else:
                        summary["local_ok"] += 1
                    continue
                summary["other"] += 1
                add_example("other", item)
            if updates:
                updates["updated_at"] = now_utc().isoformat()
                query = {"id": doc["id"]} if doc.get("id") else {"_id": doc["_id"]}
                await collection.update_one(query, {"$set": updates})
                changed_fields = [k for k in updates.keys() if k != "updated_at"]
                summary["cleared_missing"] += sum(1 for k in changed_fields if updates.get(k) is None)
                summary["normalized"] += sum(1 for k in changed_fields if updates.get(k) is not None)

    for coll_name, fields in TEXT_TARGETS:
        collection = db[coll_name]
        async for doc in collection.find({}):
            updates: dict[str, str] = {}
            for field in fields:
                text = doc.get(field)
                if not isinstance(text, str) or not text:
                    continue
                next_text = text
                for value in _iter_text_image_urls(text):
                    summary["text_scanned"] += 1
                    item = {
                        "collection": coll_name,
                        "id": doc.get("id") or doc.get("slug") or str(doc.get("_id")),
                        "field": field,
                        "value": value,
                    }
                    upload_path = _upload_path(value)
                    if value.startswith("http://") or value.startswith("https://"):
                        if upload_path:
                            filename = _filename_from_upload_path(upload_path)
                            if filename and _file_exists(filename):
                                summary["legacy_local"] += 1
                                add_example("legacy_local", {**item, "normalized": upload_path})
                                if repair:
                                    next_text = next_text.replace(value, upload_path)
                                continue
                        summary["external"] += 1
                        add_example("external", item)
                        continue
                    if upload_path:
                        filename = _filename_from_upload_path(upload_path)
                        if not filename:
                            summary["invalid_local"] += 1
                            add_example("invalid_local", item)
                            continue
                        if not _file_exists(filename):
                            summary["missing_file"] += 1
                            add_example("missing_file", {**item, "normalized": upload_path})
                            continue
                        if value != upload_path:
                            summary["legacy_local"] += 1
                            add_example("legacy_local", {**item, "normalized": upload_path})
                            if repair:
                                next_text = next_text.replace(value, upload_path)
                        else:
                            summary["local_ok"] += 1
                        continue
                    summary["other"] += 1
                    add_example("other", item)
                if next_text != text:
                    updates[field] = next_text
            if updates:
                updates["updated_at"] = now_utc().isoformat()
                query = {"id": doc["id"]} if doc.get("id") else ({"slug": doc["slug"]} if doc.get("slug") else {"_id": doc["_id"]})
                await collection.update_one(query, {"$set": updates})
                summary["text_normalized"] += len(updates) - 1

    return {"ok": True, "repair": repair, "clear_missing": clear_missing, "summary": summary, "examples": examples}


async def _infer_scope_from_references(filename: str) -> tuple[str | None, dict | None]:
    db = get_db()
    suffix_re = f"{re.escape(filename)}$"
    for coll_name, fields, scope in SCOPE_TARGETS:
        collection = db[coll_name]
        for field in fields:
            doc = await collection.find_one({field: {"$regex": suffix_re}}, {"_id": 0, "id": 1, field: 1})
            if doc:
                return scope, {
                    "collection": coll_name,
                    "id": doc.get("id"),
                    "field": field,
                    "scope": scope,
                }
    for coll_name, fields in TEXT_TARGETS:
        collection = db[coll_name]
        for field in fields:
            doc = await collection.find_one({field: {"$regex": re.escape(filename)}}, {"_id": 0, "id": 1, "slug": 1})
            if doc:
                return "admin", {
                    "collection": coll_name,
                    "id": doc.get("id") or doc.get("slug"),
                    "field": field,
                    "scope": "admin",
                }
    return None, None


async def audit_media_scopes(repair: bool = False) -> dict:
    """Classify legacy media metadata into user/admin/CMS scopes.

    This only changes metadata in media_uploads. Files and image references are
    left untouched.
    """
    db = get_db()
    summary = {
        "scanned": 0,
        "already_scoped": 0,
        "updated": 0,
        "unresolved": 0,
        "user": 0,
        "admin": 0,
        "sponsor": 0,
        "branding": 0,
        "gallery": 0,
    }
    examples: dict[str, list[dict]] = {
        "updated": [],
        "unresolved": [],
        "already_scoped": [],
    }

    def add_example(kind: str, item: dict) -> None:
        if len(examples[kind]) < 20:
            examples[kind].append(item)

    async for media in db.media_uploads.find({}, {"_id": 0}):
        summary["scanned"] += 1
        filename = media.get("filename")
        current_scope = str(media.get("media_scope") or "").strip().lower()
        if current_scope in MEDIA_SCOPES:
            summary["already_scoped"] += 1
            summary[current_scope] += 1
            add_example("already_scoped", {"filename": filename, "scope": current_scope})
            continue
        if not filename:
            summary["unresolved"] += 1
            add_example("unresolved", {"id": media.get("id"), "reason": "filename fehlt"})
            continue
        inferred_scope, source = await _infer_scope_from_references(filename)
        if not inferred_scope:
            inferred_scope = "admin" if media.get("owner_role") in ADMIN_OWNER_ROLES else "user"
            source = {"reason": "Fallback über Besitzerrolle", "scope": inferred_scope}
        summary[inferred_scope] += 1
        item = {"filename": filename, "scope": inferred_scope, "source": source}
        if repair:
            await db.media_uploads.update_one(
                {"filename": filename},
                {"$set": {"media_scope": inferred_scope, "updated_at": now_utc().isoformat()}},
            )
            summary["updated"] += 1
            add_example("updated", item)
        else:
            add_example("unresolved", item)

    return {"ok": True, "repair": repair, "summary": summary, "examples": examples}
