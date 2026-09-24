"""Inventar der Upload-Dateien (#537): welche Dateien liegen unter UPLOAD_DIR, wer in der Datenbank
verweist darauf, was ist verwaist. Nur lesend - gelöscht wird nichts, das entscheidet der Betreiber.

Der Verweis-Scan geht über **alle** Sammlungen und alle Zeichenketten darin (auch verschachtelt, auch
Markdown-Bilder in Texten): jede Adresse unter `/api/static/uploads/` und jeder nackte Dateiname, der
auf der Platte liegt, zählt als Verweis. So braucht das Inventar keine Feldliste, die veraltet.

Zustände je Datei:
- `referenced`  – mindestens ein Verweis außerhalb der Medienverwaltung (Profil, News, Galerie, …)
- `registered`  – nur in der Medienverwaltung (`media_uploads`) bekannt, sonst unbenutzt
- `variant`     – Vorschaubild (`public/variants/<name>-<breite>.webp`) zu einer Datei, die es gibt
- `orphan`      – kein Verweis, nicht registriert, kein Vorschaubild
- `stray_variant` – Vorschaubild ohne Original
"""
from __future__ import annotations

import pathlib
import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

VARIANT_DIR = "variants"
VARIANT_RE = re.compile(r"^(?P<stem>.+)-(?P<width>\d{3,4})\.webp$")
TEXT_IMAGE_RE = re.compile(r"!\[[^\]\n]*\]\((?P<md>[^)\s]+)\)|<img\b[^>]*\bsrc=[\"'](?P<html>[^\"']+)[\"']", re.IGNORECASE)
URL_IN_TEXT_RE = re.compile(r"[^\s\"'()<>\[\]]*uploads/[^\s\"'()<>\[\]]+")
SCAN_LIMIT = 50000   # je Sammlung; darüber wird die Sammlung als „nur teilweise“ vermerkt
AREA_LABELS = {
    "public": "öffentliche Medien (public)",
    "variants": "Vorschaubilder (public/variants)",
    "documents": "Vereinsdokumente (privat)",
    "chat": "Chat-Anhänge (privat)",
    "app-releases": "App-Versionen",
    "quarantine": "Quarantäne der Bildprüfung",
    "legacy": "Altlast: direkt unter uploads/ (vor der Trennung public/privat)",
    "other": "sonstige Unterordner",
}
ORIGIN_LABELS = {
    "users": "Profile (Avatar, Banner)", "club_member_profiles": "Vereinsprofile", "news_posts": "News", "events": "Events",
    "tournaments": "Turniere", "f1_challenges": "Fast Lap", "f1_tracks": "Strecken", "seasons": "Jahreswertung", "teams": "Teams",
    "sponsors": "Sponsoren", "partners": "Partner", "gallery_albums": "Galerie-Alben", "gallery_photos": "Galerie-Fotos",
    "games": "Spiele", "member_benefits": "Mitgliedervorteile", "settings": "Einstellungen (Marke)", "documents": "Vereinsdokumente",
    "chat_attachments": "Chat-Anhänge", "app_releases": "App-Versionen", "references": "Referenzen", "media_uploads": "Medienverwaltung",
    "achievements": "Auszeichnungen", "awards": "Auszeichnungen", "stickers": "Sticker",
}


def upload_filename(value: str) -> str | None:
    """Der Dateiname aus einer Upload-Adresse (`/api/static/uploads/x.webp`, `/uploads/x.webp`, absolut) - oder None."""
    raw = str(value or "").strip()
    if not raw or "uploads/" not in raw:
        return None
    if raw.startswith(("http://", "https://")):
        raw = urlparse(raw).path or raw
    path = raw.split("?", 1)[0].split("#", 1)[0]
    marker = path.rfind("uploads/")
    rest = path[marker + len("uploads/"):]
    name = pathlib.PurePosixPath(rest).name
    return name or None


def area_of(relative: pathlib.PurePosixPath) -> str:
    parts = relative.parts
    if len(parts) == 1:
        return "legacy"
    if parts[0] == "public":
        return "variants" if len(parts) >= 3 and parts[1] == VARIANT_DIR else "public"
    if parts[0] in ("documents", "chat", "app-releases", "quarantine"):
        return parts[0]
    return "other"


def list_files(upload_dir: pathlib.Path) -> list[dict]:
    files = []
    for path in sorted(p for p in upload_dir.rglob("*") if p.is_file()):
        relative = pathlib.PurePosixPath(path.relative_to(upload_dir).as_posix())
        stat = path.stat()
        files.append({
            "path": str(relative), "name": path.name, "area": area_of(relative), "size": stat.st_size,
            "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(timespec="seconds"),
        })
    return files


def _strings(value: Any, trail: str = ""):
    """Alle Zeichenketten eines Dokuments mit ihrem Feldpfad."""
    if isinstance(value, str):
        yield trail, value
    elif isinstance(value, dict):
        for key, inner in value.items():
            if key == "_id":
                continue
            yield from _strings(inner, f"{trail}.{key}" if trail else str(key))
    elif isinstance(value, (list, tuple)):
        for index, inner in enumerate(value):
            yield from _strings(inner, f"{trail}[{index}]")


def references_in(document: dict, known_names: set[str]) -> list[tuple[str, str]]:
    """(Feldpfad, Dateiname) für jeden Verweis in einem Dokument."""
    found = []
    for field, text in _strings(document):
        if "uploads/" in text:
            # Eine Adresse allein oder Adressen in einem Text (Markdown-Bild, <img>, nackte Adresse): nie der ganze Text.
            candidates = [match.group("md") or match.group("html") or "" for match in TEXT_IMAGE_RE.finditer(text)]
            candidates += URL_IN_TEXT_RE.findall(text)
            names = {upload_filename(candidate) for candidate in candidates} - {None}
            found.extend((field, name) for name in sorted(names))
        elif len(text) <= 260 and "/" not in text and text in known_names:
            found.append((field, text))
    return found


async def collect_references(db, known_names: set[str]) -> tuple[dict[str, list[dict]], list[str]]:
    """Dateiname → Verweise über alle Sammlungen. Liefert auch, welche Sammlungen nur teilweise gelesen wurden."""
    refs: dict[str, list[dict]] = defaultdict(list)
    partial: list[str] = []
    for collection in sorted(await db.list_collection_names()):
        if collection.startswith("system."):
            continue
        count = 0
        async for document in db[collection].find({}, {"_id": 0}):
            count += 1
            if count > SCAN_LIMIT:
                partial.append(collection)
                break
            ident = document.get("id") or document.get("slug") or document.get("username") or ""
            for field, name in references_in(document, known_names):
                refs[name].append({"collection": collection, "field": field, "id": str(ident)[:60]})
    return refs, partial


async def inventory(db, upload_dir: pathlib.Path, *, sample: int = 40) -> dict:
    files = list_files(upload_dir)
    names = {row["name"] for row in files}
    refs, partial = await collect_references(db, names)
    stems = {}
    for row in files:
        if row["area"] != "variants":
            stems.setdefault(pathlib.PurePosixPath(row["name"]).stem, row["name"])
    for row in files:
        own = refs.get(row["name"], [])
        outside = [ref for ref in own if ref["collection"] != "media_uploads"]
        registered = any(ref["collection"] == "media_uploads" for ref in own)
        variant = VARIANT_RE.match(row["name"]) if row["area"] == "variants" else None
        if variant:
            base = stems.get(variant.group("stem"))
            row["variant_of"] = base
            row["state"] = "variant" if base else "stray_variant"
        elif outside:
            row["state"] = "referenced"
        elif registered:
            row["state"] = "registered"
        else:
            row["state"] = "orphan"
        row["referenced_by"] = sorted({ref["collection"] for ref in outside})
        row["registered"] = registered
    missing = sorted(name for name in refs if name not in names)
    by_state: dict[str, dict] = defaultdict(lambda: {"count": 0, "bytes": 0})
    by_area: dict[str, dict] = defaultdict(lambda: {"count": 0, "bytes": 0})
    by_origin: dict[str, dict] = defaultdict(lambda: {"count": 0, "bytes": 0})
    for row in files:
        by_state[row["state"]]["count"] += 1
        by_state[row["state"]]["bytes"] += row["size"]
        by_area[row["area"]]["count"] += 1
        by_area[row["area"]]["bytes"] += row["size"]
        for collection in row["referenced_by"]:
            by_origin[collection]["count"] += 1
            by_origin[collection]["bytes"] += row["size"]
    orphans = sorted((row for row in files if row["state"] in ("orphan", "stray_variant")), key=lambda row: -row["size"])
    registered_only = sorted((row for row in files if row["state"] == "registered"), key=lambda row: -row["size"])
    return {
        "upload_dir": str(upload_dir),
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total": {"count": len(files), "bytes": sum(row["size"] for row in files)},
        "by_state": dict(by_state), "by_area": dict(by_area), "by_origin": dict(by_origin),
        "orphans": orphans[:sample], "orphan_count": len(orphans), "orphan_bytes": sum(row["size"] for row in orphans),
        "registered_only": registered_only[:sample], "registered_only_count": len(registered_only),
        "missing": [{"name": name, "referenced_by": sorted({ref["collection"] for ref in refs[name]})} for name in missing[:sample]],
        "missing_count": len(missing),
        "partial_collections": partial,
        "files": files,
    }


def human(num: float) -> str:
    for unit in ("B", "kB", "MB", "GB"):
        if abs(num) < 1024 or unit == "GB":
            return f"{num:,.1f} {unit}".replace(",", ".")
        num /= 1024
    return f"{num:.1f} GB"


def render_markdown(report: dict) -> str:
    lines = [f"# Upload-Inventar ({report['generated_at'][:10]})", "",
             f"Ordner `{report['upload_dir']}` · {report['total']['count']} Dateien · {human(report['total']['bytes'])}. Nur gelesen, nichts geändert.", ""]
    lines += ["## Nach Zustand", "", "| Zustand | Dateien | Größe |", "| --- | --- | --- |"]
    labels = {"referenced": "verwendet (Verweis in der Datenbank)", "registered": "nur in der Medienverwaltung", "variant": "Vorschaubild zu einer vorhandenen Datei",
              "orphan": "verwaist (kein Verweis, nicht registriert)", "stray_variant": "Vorschaubild ohne Original"}
    for state in ("referenced", "registered", "variant", "orphan", "stray_variant"):
        entry = report["by_state"].get(state)
        if entry:
            lines.append(f"| {labels[state]} | {entry['count']} | {human(entry['bytes'])} |")
    lines += ["", "## Nach Ablageort", "", "| Ort | Dateien | Größe |", "| --- | --- | --- |"]
    for area, entry in sorted(report["by_area"].items(), key=lambda item: -item[1]["bytes"]):
        lines.append(f"| {AREA_LABELS.get(area, area)} | {entry['count']} | {human(entry['bytes'])} |")
    lines += ["", "## Nach Herkunft (wer verweist)", "", "| Herkunft | Dateien | Größe |", "| --- | --- | --- |"]
    for origin, entry in sorted(report["by_origin"].items(), key=lambda item: -item[1]["count"]):
        lines.append(f"| {ORIGIN_LABELS.get(origin, origin)} (`{origin}`) | {entry['count']} | {human(entry['bytes'])} |")
    lines += ["", f"## Verwaist: {report['orphan_count']} Dateien, {human(report['orphan_bytes'])}", ""]
    if report["orphans"]:
        lines += ["| Datei | Ort | Größe | geändert |", "| --- | --- | --- | --- |"]
        for row in report["orphans"]:
            lines.append(f"| `{row['path']}` | {AREA_LABELS.get(row['area'], row['area'])} | {human(row['size'])} | {row['modified_at'][:10]} |")
        if report["orphan_count"] > len(report["orphans"]):
            lines.append(f"| … | {report['orphan_count'] - len(report['orphans'])} weitere | | |")
    else:
        lines.append("Keine.")
    lines += ["", f"## Nur in der Medienverwaltung: {report['registered_only_count']} Dateien", ""]
    if report["registered_only"]:
        lines += ["| Datei | Größe |", "| --- | --- |"] + [f"| `{row['path']}` | {human(row['size'])} |" for row in report["registered_only"]]
    else:
        lines.append("Keine.")
    lines += ["", f"## Verweise auf fehlende Dateien: {report['missing_count']}", ""]
    if report["missing"]:
        lines += ["| Datei | verweist |", "| --- | --- |"] + [f"| `{row['name']}` | {', '.join(row['referenced_by'])} |" for row in report["missing"]]
    else:
        lines.append("Keine.")
    if report["partial_collections"]:
        lines += ["", f"Hinweis: {', '.join(report['partial_collections'])} wurden nur bis {SCAN_LIMIT} Einträge gelesen."]
    lines += ["", "## Vorschlag", "",
              "- **Verwaist**: nach Freigabe des Betreibers löschen (vorher Backup). Vorschaubilder ohne Original mit dazu.",
              "- **Nur in der Medienverwaltung**: bleiben – sie sind im Medien-Browser sichtbar und dort löschbar.",
              "- **Altlast direkt unter uploads/**: verwendete Dateien in `public/` verschieben und die Verweise anpassen, verwaiste löschen.",
              "- **Verweise auf fehlende Dateien**: im Admin das Bild neu setzen oder den Verweis leeren (Medien → Prüfung)."]
    return "\n".join(lines) + "\n"
