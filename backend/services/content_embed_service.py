"""Resolve CMS content shortcodes like [[fastlap:slug]] into public cards."""
from __future__ import annotations

import re
from typing import Any

from services.visibility import user_can_see
from services.public_phase import derive_public_phase


EMBED_RE = re.compile(r"\[\[\s*(event|events|turnier|turniere|tournament|tournaments|fastlap|fast-lap|f1)\s*:\s*([^\]\s]+)\s*\]\]", re.IGNORECASE)


def normalize_embed_kind(kind: str) -> str:
    k = (kind or "").strip().lower()
    if k in {"event", "events"}:
        return "event"
    if k in {"turnier", "turniere", "tournament", "tournaments"}:
        return "tournament"
    if k in {"fastlap", "fast-lap", "f1"}:
        return "fastlap"
    return k


def extract_content_refs(text: str | None) -> list[dict[str, str]]:
    refs: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for match in EMBED_RE.finditer(text or ""):
        kind = normalize_embed_kind(match.group(1))
        ref = match.group(2).strip()
        key = (kind, ref)
        if kind and ref and key not in seen:
            seen.add(key)
            refs.append({"token": match.group(0), "kind": kind, "ref": ref})
    return refs


async def _can_show_embed(kind: str, doc: dict[str, Any], user: dict | None) -> bool:
    if kind in {"event", "tournament", "fastlap"} and doc.get("status") == "draft":
        return False
    if kind == "tournament" and doc.get("is_public") is False:
        return False
    return await user_can_see(user, doc.get("visibility") or "public")


async def resolve_content_embeds(db: Any, text: str | None, user: dict | None = None) -> list[dict[str, Any]]:
    refs = extract_content_refs(text)
    if not refs:
        return []

    by_kind: dict[str, list[str]] = {"event": [], "tournament": [], "fastlap": []}
    for ref in refs:
        by_kind.setdefault(ref["kind"], []).append(ref["ref"])

    resolved: dict[tuple[str, str], dict[str, Any]] = {}

    if by_kind.get("event"):
        docs = await db.events.find(
            {"$or": [{"id": {"$in": by_kind["event"]}}, {"slug": {"$in": by_kind["event"]}}]},
            {"_id": 0, "id": 1, "slug": 1, "name": 1, "description": 1, "start_date": 1, "end_date": 1, "door_time": 1, "registration_opens_at": 1, "registration_closes_at": 1, "has_registration": 1, "registration_url": 1, "status": 1, "banner_url": 1, "location": 1, "visibility": 1},
        ).to_list(100)
        for doc in docs:
            if await _can_show_embed("event", doc, user):
                doc["public_phase"] = derive_public_phase(doc, "event")
                resolved[("event", doc.get("id"))] = doc
                resolved[("event", doc.get("slug"))] = doc

    if by_kind.get("tournament"):
        docs = await db.tournaments.find(
            {"$or": [{"id": {"$in": by_kind["tournament"]}}, {"slug": {"$in": by_kind["tournament"]}}]},
            {"_id": 0, "id": 1, "slug": 1, "title": 1, "description": 1, "start_date": 1, "end_date": 1, "registration_enabled": 1, "registration_open_from": 1, "registration_open_until": 1, "check_in_from": 1, "check_in_until": 1, "is_invite_only": 1, "status": 1, "banner_url": 1, "game_id": 1, "visibility": 1, "is_public": 1},
        ).to_list(100)
        for doc in docs:
            if await _can_show_embed("tournament", doc, user):
                doc["public_phase"] = derive_public_phase(doc, "tournament")
                resolved[("tournament", doc.get("id"))] = doc
                resolved[("tournament", doc.get("slug"))] = doc

    if by_kind.get("fastlap"):
        docs = await db.f1_challenges.find(
            {"$or": [{"id": {"$in": by_kind["fastlap"]}}, {"slug": {"$in": by_kind["fastlap"]}}]},
            {"_id": 0, "id": 1, "slug": 1, "title": 1, "description": 1, "start_date": 1, "end_date": 1, "registration_enabled": 1, "online_registration_enabled": 1, "registration_open_from": 1, "registration_open_until": 1, "is_invite_only": 1, "status": 1, "banner_url": 1, "is_championship": 1, "visibility": 1},
        ).to_list(100)
        for doc in docs:
            if await _can_show_embed("fastlap", doc, user):
                doc["public_phase"] = derive_public_phase(doc, "f1")
                resolved[("fastlap", doc.get("id"))] = doc
                resolved[("fastlap", doc.get("slug"))] = doc

    embeds: list[dict[str, Any]] = []
    for ref in refs:
        item = resolved.get((ref["kind"], ref["ref"]))
        if item:
            embeds.append({**ref, "item": item})
    return embeds
