"""Shared helpers for stable, human-readable URL slugs."""
from __future__ import annotations

import re
import unicodedata
from typing import Any


GERMAN_REPLACEMENTS = {
    "\u00df": "ss",
    "\u1e9e": "ss",
    "\u00e4": "ae",
    "\u00c4": "ae",
    "\u00f6": "oe",
    "\u00d6": "oe",
    "\u00fc": "ue",
    "\u00dc": "ue",
}


def slugify(value: Any, fallback: str = "seite", max_length: int = 90) -> str:
    text = str(value or "").strip()
    for source, target in GERMAN_REPLACEMENTS.items():
        text = text.replace(source, target)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    fallback_slug = re.sub(r"[^a-z0-9]+", "-", str(fallback or "seite").lower()).strip("-") or "seite"
    return (slug[:max_length].strip("-") or fallback_slug[:max_length].strip("-") or "seite")


def slug_source_for_update(raw: dict, existing: dict, name_field: str, fallback: str = "seite") -> Any | None:
    """Return the source text for an update slug, or None when it should stay unchanged.

    If a form submits the old slug together with a changed title/name, treat the
    slug as still auto-managed and regenerate it from the new title/name. If the
    submitted slug differs from the current slug, honor it as an explicit slug.
    """
    if "slug" in raw:
        submitted_slug = raw.get("slug")
        submitted_is_current = slugify(submitted_slug, fallback) == slugify(existing.get("slug"), fallback)
        if name_field in raw and submitted_is_current:
            return raw.get(name_field) or existing.get(name_field) or fallback
        return submitted_slug or raw.get(name_field) or existing.get(name_field) or fallback
    if name_field in raw:
        return raw.get(name_field) or fallback
    return None


def apply_slug_history(existing: dict, updates: dict, *, max_items: int = 25) -> None:
    """Remember the previous slug when an update changes it.

    The current slug is always kept out of the history, so reverting to an older
    slug does not create redirect loops.
    """
    new_slug = updates.get("slug")
    old_slug = existing.get("slug")
    if not new_slug or not old_slug or new_slug == old_slug:
        return

    history = []
    for item in existing.get("slug_history") or []:
        item = str(item or "").strip()
        if item and item not in {new_slug, old_slug} and item not in history:
            history.append(item)
    updates["slug_history"] = [old_slug, *history][:max_items]


def _candidate_with_suffix(base: str, suffix: int, max_length: int) -> str:
    suffix_text = f"-{suffix}"
    trimmed = base[: max_length - len(suffix_text)].rstrip("-")
    return f"{trimmed}{suffix_text}" if trimmed else f"seite{suffix_text}"


async def unique_slug(collection, source: Any, *, current_id: str | None = None, fallback: str = "seite", max_length: int = 90) -> str:
    base = slugify(source, fallback=fallback, max_length=max_length)
    candidate = base
    suffix = 2
    while True:
        query = {"slug": candidate}
        if current_id:
            query["id"] = {"$ne": current_id}
        if not await collection.find_one(query, {"_id": 1}):
            return candidate
        candidate = _candidate_with_suffix(base, suffix, max_length)
        suffix += 1


async def find_by_slug_or_history(collection, slug_or_id: str, projection: dict | None = None) -> tuple[dict | None, bool]:
    doc = await collection.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, projection)
    if doc:
        return doc, False
    doc = await collection.find_one({"slug_history": slug_or_id}, projection)
    return doc, bool(doc)
