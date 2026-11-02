"""Regelwerk der Liga (docs/LIGA.md, #1646): Fassungen liga-weit oder je Season, Zustimmung je Fassung, was am Spiel gilt.

``league_rules`` hält je Fassung eine Zeile. Der Entwurf (je Geltungsbereich höchstens einer) wird beim Veröffentlichen in einem
Schritt zur unveränderlichen Fassung; jedes Schreiben filtert auf ``status: "draft"``. Die Bausteine werden dabei eingefroren.
Text, Anker und Vergleich stehen in ``league_rules_text``, die Bausteine in ``league_rule_blocks``.

Rechte der Verwaltung prüft die Route (``require_rules_editor``). Sichtbarkeit: dieselbe Regel wie die Ligaseite
(``league_service.visible_season``); was unsichtbar ist, antwortet wie „gibt es nicht“. Eine fehlende Zustimmung blockiert nichts.
"""
from __future__ import annotations

import asyncio
import logging
import re

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services import league_look
from services import league_rule_blocks as blocks
from services import league_rules_text as text
from services import league_service as leagues
from services.dolibarr_policy import club_today
from services.league_rules_store import LEAGUE, PUBLISHED, SEASON, STAFFEL_POINTER
from services.league_scope import ONLY_LEAGUE
from services.league_service import LeagueProblem
from services.match_audience import responsible_ids, teams_by_id

logger = logging.getLogger("tls.league_rules")

SCOPES = (LEAGUE, SEASON)
DRAFT = "draft"
ACTIVE_REGISTRATIONS = ("approved", "checked_in", "pending")
REASON_MIN = 5
REASON_MAX = 500
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CHANGED_MEANWHILE = "Der Entwurf wurde inzwischen geändert - bitte neu laden."
PUBLIC_FIELDS = ("id", "scope", "version", "title", "valid_from", "published_at", "change_reason", "requires_consent", "blocks_used")


# ---------------------------------------------------------------- Lesen

def _today() -> str:
    return club_today()


async def _published(db, scope: str, scope_id: str) -> list[dict]:
    """Die Fassungen eines Geltungsbereichs, älteste zuerst."""
    return await db.league_rules.find({"scope": scope, "scope_id": scope_id, "status": PUBLISHED},
                                      {"_id": 0}).sort("version", 1).to_list(None)


def _current(rows: list[dict]) -> dict | None:
    """Die gültige Fassung: die höchste Nummer, deren Tag gekommen ist."""
    today = _today()
    valid = [row for row in rows if str(row.get("valid_from") or "") <= today]
    return valid[-1] if valid else None


def _upcoming(rows: list[dict]) -> dict | None:
    today = _today()
    return next((row for row in rows if str(row.get("valid_from") or "") > today), None)


async def _chain(db, league: dict, season: dict | None) -> dict:
    """Alles, was auf einer Seite gilt und vergleichbar ist. Auf einer Season: die eigenen Fassungen und die der Liga bis zur
    ersten eigenen gültigen - danach betrifft die Liga diese Season nicht mehr."""
    league_rows = await _published(db, LEAGUE, league["id"])
    if not season:
        return {"rows": league_rows, "current": _current(league_rows), "upcoming": _upcoming(league_rows)}
    own = await _published(db, SEASON, season["id"])
    today = _today()
    first_own = next((row for row in own if str(row.get("valid_from") or "") <= today), None)
    if first_own:
        inherited = [row for row in league_rows if str(row.get("published_at") or "") < str(first_own.get("published_at") or "")]
    else:
        inherited = league_rows
    rows = sorted(inherited + own, key=lambda row: str(row.get("published_at") or ""))
    current = _current(own) or _current(inherited)
    upcoming = _upcoming(own) or (None if first_own else _upcoming(inherited))
    return {"rows": rows, "current": current, "upcoming": upcoming}


def _frozen_values(version: dict, season: dict | None) -> dict[str, str]:
    frozen = (version.get("frozen") or {}).get((season or {}).get("id") or "") or {}
    return {key: row.get("markdown") or "" for key, row in frozen.items()}


def _sections(version: dict, season: dict | None) -> list[dict]:
    """Die Abschnitte einer Fassung auf dieser Seite - mit den eingefrorenen Bausteinen."""
    values = _frozen_values(version, season)
    missing = blocks.NOT_FROZEN_HINT if season else blocks.NO_SEASON_HINT
    return text.sections_of(version.get("body_md"), version.get("annexes"),
                            fill=lambda body: text.fill_blocks(body, values, missing=missing))


def _label(version: dict) -> str:
    return f"Version {version.get('version')}" + (" (Liga)" if version.get("scope") == LEAGUE else "")


def _head(version: dict, current: dict | None) -> dict:
    return {**{key: version.get(key) for key in PUBLIC_FIELDS}, "label": _label(version),
            "is_current": bool(current and current.get("id") == version.get("id"))}


def page_path(league: dict, season: dict | None) -> str:
    return f"/liga/{league['slug']}/{season['slug']}/regeln" if season else f"/liga/{league['slug']}/regeln"


def api_path(league: dict, season: dict | None) -> str:
    return f"/api/league-rules/seasons/{league['slug']}/{season['slug']}" if season else f"/api/league-rules/leagues/{league['slug']}"


async def _compared(previous: dict | None, season: dict | None, sections: list[dict]) -> dict:
    """Der Vergleich zur vorigen Fassung - bei langen Texten spürbar, darum nicht im Ablauf der übrigen Anfragen."""
    return await asyncio.to_thread(text.compare, _sections(previous, season) if previous else None, sections)


def _previous(chain: list[dict], version: dict) -> dict | None:
    index = next((position for position, row in enumerate(chain) if row["id"] == version["id"]), 0)
    return chain[index - 1] if index > 0 else None


# ---------------------------------------------------------------- Öffentliche Seite

async def _visible_league(db, league_slug: str, user: dict | None) -> dict:
    """Die Seite der Liga ist sichtbar, sobald die Person eine ihrer Seasons sehen darf."""
    league = await db.leagues.find_one({"slug": league_slug, "status": "active"}, {"_id": 0})
    if league:
        seasons = await db.league_seasons.find({"league_id": league["id"], "visibility": {"$ne": "off"},
                                                "status": {"$ne": "archived"}}, {"_id": 0}).to_list(200)
        for season in seasons:
            if await leagues.can_see_season(user, season):
                return league
    raise LeagueProblem("Liga nicht gefunden.", 404)


async def visible_scope(db, league_slug: str, season_slug: str | None, user: dict | None) -> tuple[dict, dict | None]:
    """Liga und Season der Adresse - sonst 404 wie „gibt es nicht“."""
    if season_slug is None:
        return await _visible_league(db, league_slug, user), None
    return await leagues.visible_season(db, league_slug, season_slug, user)


def _find(rows: list[dict], version_id: str | None) -> dict:
    version = next((row for row in rows if row["id"] == version_id), None)
    if not version:
        raise LeagueProblem("Diese Fassung gibt es hier nicht.", 404)
    return version


async def page_view(db, league: dict, season: dict | None, user: dict | None, *, version_id: str | None = None) -> dict:
    chain = await _chain(db, league, season)
    current = chain["current"]
    version = _find(chain["rows"], version_id) if version_id else current
    out = {
        "league": leagues.public_league(league),
        "season": {key: season.get(key) for key in ("id", "name", "slug", "number", "status")} if season else None,
        "look": league_look.effective(league, season or {}),
        "public": season.get("visibility") == "public" if season else await _any_public_season(db, league),
        "versions": [_head(row, current) for row in reversed(chain["rows"])],
        "upcoming": _head(chain["upcoming"], current) if chain["upcoming"] else None,
        "seasons": [] if season else await _season_links(db, league, user),
        "consent": await consent_view(db, league, season, chain, user) if season and user else None,
    }
    if not version:
        fallback = (season or {}).get("rules_text") or None
        return {**out, "source": "fallback" if fallback else "none", "version": None, "fallback_text": fallback,
                "sections": [], "changes": {"base": None, "new": [], "changed": [], "removed": []}}
    sections = _sections(version, season)
    previous = _previous(chain["rows"], version)
    result = await _compared(previous, season, sections)
    return {
        **out, "source": "rules", "fallback_text": None,
        "version": {**_head(version, current), "pdf_url": f"{api_path(league, season)}/versions/{version['id']}/pdf"},
        "sections": [{**row, "mark": result["marks"].get(row["anchor"])} for row in sections],
        "changes": {"base": _head(previous, current) if previous else None,
                    **{key: result[key] for key in ("new", "changed", "removed")}},
    }


async def _any_public_season(db, league: dict) -> bool:
    return bool(await db.league_seasons.find_one({"league_id": league["id"], "visibility": "public",
                                                  "status": {"$ne": "archived"}}, {"_id": 1}))


async def _season_links(db, league: dict, user: dict | None) -> list[dict]:
    rows = await db.league_seasons.find({"league_id": league["id"], "visibility": {"$ne": "off"}, "status": {"$ne": "archived"}},
                                        {"_id": 0}).sort("number", -1).to_list(200)
    return [{"name": row.get("name"), "slug": row.get("slug"), "url": page_path(league, row)} for row in rows
            if await leagues.can_see_season(user, row)]


async def compare_view(db, league: dict, season: dict | None, base_id: str | None, target_id: str | None) -> dict:
    """Wort für Wort zwischen zwei Fassungen dieser Seite."""
    chain = await _chain(db, league, season)
    base, target = _find(chain["rows"], base_id), _find(chain["rows"], target_id)
    return {"base": _head(base, chain["current"]), "target": _head(target, chain["current"]),
            "sections": await asyncio.to_thread(text.diff_view, _sections(base, season), _sections(target, season))}


async def pdf_document(db, league: dict, season: dict | None, version_id: str, *, marks: bool = True) -> dict:
    """Alles, was das PDF einer Fassung braucht - nur aus der Fassung, kein zweiter Inhalt."""
    chain = await _chain(db, league, season)
    version = _find(chain["rows"], version_id)
    sections = _sections(version, season)
    previous = _previous(chain["rows"], version)
    result = await _compared(previous, season, sections)
    return {
        "title": version.get("title") or "Regelwerk",
        "context": " · ".join(str(part) for part in (league.get("name"), (season or {}).get("name")) if part),
        "version": version.get("version"), "label": _label(version), "valid_from": version.get("valid_from"),
        "published_at": version.get("published_at"), "change_reason": version.get("change_reason"),
        "sections": [{**row, "mark": result["marks"].get(row["anchor"]) if marks else None} for row in sections],
        "removed": result["removed"] if marks else [],
        "base_label": _label(previous) if previous and marks else None,
        "filename": "_".join(str(part) for part in ("regelwerk", league.get("slug"), (season or {}).get("slug"),
                                                    f"v{version.get('version')}") if part),
    }


async def summary(db, league_id: str, season_id: str, user: dict | None) -> dict | None:
    """Was die Ligaseite statt des Aufklappblocks zeigt - ``None``: es gibt kein Regelwerk, der Regeltext bleibt."""
    league = await db.leagues.find_one({"id": league_id}, {"_id": 0})
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not league or not season:
        return None
    chain = await _chain(db, league, season)
    current = chain["current"]
    if not current:
        return None
    consent = await consent_view(db, league, season, chain, user) if user else None
    return {"source": "rules", "version": current.get("version"), "label": _label(current),
            "valid_from": current.get("valid_from"), "title": current.get("title"), "url": page_path(league, season),
            "pdf_url": f"{api_path(league, season)}/versions/{current['id']}/pdf",
            "consent_open": bool(consent and any(not row["agreed"] for row in consent["squads"]))}


# ---------------------------------------------------------------- Verwaltung: Lesen

async def resolve_scope(db, scope: str, scope_id: str) -> tuple[dict, dict | None]:
    """Liga und (bei einer Season) Season eines Geltungsbereichs der Verwaltung."""
    if scope == LEAGUE:
        return await leagues.get_league(db, scope_id), None
    if scope == SEASON:
        season = await leagues.get_season(db, scope_id)
        return await leagues.get_league(db, season["league_id"]), season
    raise LeagueProblem("Unbekannter Geltungsbereich.", 404)


async def draft_of(db, scope: str, scope_id: str) -> dict | None:
    return await db.league_rules.find_one({"scope": scope, "scope_id": scope_id, "status": DRAFT}, {"_id": 0})


async def _seasons_to_freeze(db, league: dict, season: dict | None) -> list[dict]:
    if season:
        return [season]
    return await db.league_seasons.find({"league_id": league["id"], "status": {"$ne": "archived"}},
                                        {"_id": 0}).sort("number", 1).to_list(200)


async def _inheriting_seasons(db, league: dict) -> list[dict]:
    """Seasons, für die die Fassungen der Liga noch gelten: keine eigene gültige."""
    out = []
    for row in await _seasons_to_freeze(db, league, None):
        if not _current(await _published(db, SEASON, row["id"])):
            out.append(row)
    return out


async def data_changes(db, league: dict, season: dict | None, version: dict | None) -> dict | None:
    """Vorschlag „Daten geändert“: Bausteine der letzten Fassung gegen den heutigen Stand der Quellen. Veröffentlicht nichts."""
    keys = (version or {}).get("blocks_used") or []
    if not keys:
        return None
    seasons = [season] if season else await _inheriting_seasons(db, league)
    rows: list[dict] = []
    for row in seasons:
        frozen = _frozen_values(version, row)
        for key, now in (await blocks.resolve(db, keys, league, row)).items():
            before = frozen.get(key)
            if before == now["markdown"]:
                continue
            rows.append({"block": key, "label": now["label"], "season_id": row["id"], "season_name": row.get("name"),
                         "status": "missing" if before is None else "changed", "before": before or "", "after": now["markdown"],
                         "ops": text.word_ops(before or "", now["markdown"])})
    return {"version_id": version["id"], "version": version.get("version"), "label": _label(version), "rows": rows} if rows else None


async def _names(db, user_ids: set[str]) -> dict[str, str]:
    rows = await db.users.find({"id": {"$in": sorted(user_ids)}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(None)
    return {row["id"]: row.get("display_name") or row.get("username") or "" for row in rows}


async def admin_view(db, scope: str, scope_id: str) -> dict:
    league, season = await resolve_scope(db, scope, scope_id)
    own = await _published(db, scope, scope_id)
    chain = await _chain(db, league, season)
    current = chain["current"]
    inherited = current if season and current and current.get("scope") == LEAGUE else None
    latest = own[-1] if own else inherited
    consent_state = await admin_consents(db, league, season, chain) if season else None
    return {
        "scope": scope, "scope_id": scope_id,
        "league": {key: league.get(key) for key in ("id", "name", "slug")},
        "season": {key: season.get(key) for key in ("id", "name", "slug", "visibility", "status")} if season else None,
        "draft": await draft_of(db, scope, scope_id),
        "versions": [{**_head(row, current), "published_by": row.get("published_by")} for row in reversed(own)],
        "inherited": _head(inherited, current) if inherited else None,
        "current": _head(current, current) if current else None,
        "blocks": blocks.catalog(),
        "data_changes": await data_changes(db, league, season, latest),
        "consents": consent_state,
        "public_url": page_path(league, season),
        "today": _today(),
    }


# ---------------------------------------------------------------- Verwaltung: Schreiben

def _annexes(raw: list[dict] | None) -> list[dict]:
    """Die Anlagen mit ihrem Buchstaben aus der Reihenfolge."""
    return [{"key": chr(ord("A") + index), "title": str(row.get("title") or "").strip(), "body_md": str(row.get("body_md") or "")}
            for index, row in enumerate(raw or [])]


async def save_draft(db, scope: str, scope_id: str, body: dict, user: dict) -> dict:
    league, season = await resolve_scope(db, scope, scope_id)
    now = now_utc().isoformat()
    fields = {"title": str(body.get("title") or "").strip(), "body_md": str(body.get("body_md") or ""),
              "annexes": _annexes(body.get("annexes")), "updated_at": now, "updated_by": user["id"]}
    existing = await draft_of(db, scope, scope_id)
    if existing is None:
        if body.get("revision"):  # der gelesene Entwurf ist inzwischen veröffentlicht oder verworfen
            raise LeagueProblem(CHANGED_MEANWHILE, 409)
        doc = {"id": new_id(), "scope": scope, "scope_id": scope_id, "league_id": league["id"],
               "season_id": (season or {}).get("id"), "status": DRAFT, "version": None, "revision": 1, **fields,
               "created_at": now, "created_by": user["id"]}
        try:
            await db.league_rules.insert_one(dict(doc))
        except DuplicateKeyError:
            raise LeagueProblem(CHANGED_MEANWHILE, 409) from None
        return doc
    if body.get("revision") != existing.get("revision"):
        raise LeagueProblem(CHANGED_MEANWHILE, 409)
    saved = await db.league_rules.find_one_and_update(
        {"id": existing["id"], "status": DRAFT, "revision": existing["revision"]},
        {"$set": fields, "$inc": {"revision": 1}}, return_document=ReturnDocument.AFTER)
    if not saved:
        raise LeagueProblem(CHANGED_MEANWHILE, 409)
    saved.pop("_id", None)
    return saved


async def draft_from_version(db, scope: str, scope_id: str, version_id: str | None, user: dict) -> dict:
    """Entwurf aus einer vorhandenen Fassung: auch der Weg vom Vorschlag „Daten geändert“ zur neuen Version. Die Bausteine bleiben
    Marken im Text und nehmen beim Veröffentlichen den dann gültigen Stand."""
    league, season = await resolve_scope(db, scope, scope_id)
    if await draft_of(db, scope, scope_id):
        raise LeagueProblem("Es gibt schon einen Entwurf - erst bearbeiten oder verwerfen.", 409)
    chain = await _chain(db, league, season)
    own = await _published(db, scope, scope_id)
    source = (_find(chain["rows"], version_id) if version_id else (own[-1] if own else chain["current"]))
    if not source:
        raise LeagueProblem("Es gibt noch keine Fassung, aus der sich ein Entwurf vorbereiten ließe.", 404)
    return await save_draft(db, scope, scope_id, {"title": source.get("title"), "body_md": source.get("body_md"),
                                                  "annexes": source.get("annexes")}, user)


async def discard_draft(db, scope: str, scope_id: str) -> dict:
    await resolve_scope(db, scope, scope_id)
    doc = await db.league_rules.find_one_and_delete({"scope": scope, "scope_id": scope_id, "status": DRAFT}, projection={"_id": 0})
    if not doc:
        raise LeagueProblem("Es gibt keinen Entwurf.", 404)
    return doc


async def preview(db, scope: str, scope_id: str, body: dict) -> dict:
    """Die Seite, wie sie heute würde: mit den Bausteinen von heute, gegen die letzte Fassung. Speichert nichts."""
    league, season = await resolve_scope(db, scope, scope_id)
    annexes = _annexes(body.get("annexes"))
    keys = text.block_keys(body.get("body_md"), *[row["body_md"] for row in annexes])
    values = {key: row["markdown"] for key, row in (await blocks.resolve(db, keys, league, season)).items()} if season else {}
    missing = blocks.NOT_FROZEN_HINT if season else blocks.NO_SEASON_HINT
    sections = text.sections_of(body.get("body_md"), annexes, fill=lambda value: text.fill_blocks(value, values, missing=missing))
    chain = await _chain(db, league, season)
    previous = chain["rows"][-1] if chain["rows"] else None
    result = await _compared(previous, season, sections)
    return {"sections": [{**row, "mark": result["marks"].get(row["anchor"])} for row in sections],
            "changes": {"base": _head(previous, chain["current"]) if previous else None,
                        **{key: result[key] for key in ("new", "changed", "removed")}},
            "blocks_used": [key for key in keys if key in blocks.BLOCKS], "unknown_blocks": blocks.unknown(keys)}


def _check_publish(draft: dict, body: dict, predecessor: dict | None) -> tuple[str, str, list[str]]:
    reason = " ".join(str(body.get("change_reason") or "").split())
    if not REASON_MIN <= len(reason) <= REASON_MAX:
        raise LeagueProblem(f"Bitte einen Änderungsgrund mit {REASON_MIN} bis {REASON_MAX} Zeichen angeben.")
    valid_from = str(body.get("valid_from") or "").strip()
    if not DAY.match(valid_from):
        raise LeagueProblem("Bitte den Tag angeben, ab dem die Fassung gilt.")
    if valid_from < _today():
        raise LeagueProblem("„Gültig ab“ darf nicht in der Vergangenheit liegen - sonst wäre nicht mehr nachweisbar, was galt.")
    if predecessor and valid_from < str(predecessor.get("valid_from") or ""):
        raise LeagueProblem(f"„Gültig ab“ darf nicht vor dem Beginn von Version {predecessor.get('version')} liegen.")
    annexes = draft.get("annexes") or []
    if not str(draft.get("body_md") or "").strip() and not any(str(row.get("body_md") or "").strip() for row in annexes):
        raise LeagueProblem("Ein leeres Regelwerk lässt sich nicht veröffentlichen.")
    keys = text.block_keys(draft.get("body_md"), *[row.get("body_md") for row in annexes])
    wrong = blocks.unknown(keys)
    if wrong:
        raise LeagueProblem("Unbekannter Baustein im Text: " + ", ".join(wrong) + ".")
    return reason, valid_from, keys


async def publish(db, scope: str, scope_id: str, body: dict, user: dict) -> dict:
    """Macht den Entwurf zur Fassung, in einem Schritt: Hat ihn inzwischen jemand geändert oder veröffentlicht, passt der Filter
    nicht mehr (409); dieselbe Nummer verhindert der eindeutige Index."""
    league, season = await resolve_scope(db, scope, scope_id)
    draft = await draft_of(db, scope, scope_id)
    if not draft or draft.get("revision") != body.get("revision"):
        raise LeagueProblem(CHANGED_MEANWHILE, 409)
    own = await _published(db, scope, scope_id)
    predecessor = own[-1] if own else None
    reason, valid_from, keys = _check_publish(draft, body, predecessor)
    frozen: dict[str, dict] = {}
    if keys:
        for row in await _seasons_to_freeze(db, league, season):
            frozen[row["id"]] = await blocks.resolve(db, keys, league, row)
    now = now_utc().isoformat()
    try:
        doc = await db.league_rules.find_one_and_update(
            {"id": draft["id"], "status": DRAFT, "revision": draft["revision"]},
            {"$set": {"status": PUBLISHED, "version": int((predecessor or {}).get("version") or 0) + 1, "frozen": frozen,
                      "blocks_used": keys, "valid_from": valid_from, "change_reason": reason,
                      "requires_consent": bool(body.get("requires_consent")), "published_at": now, "published_by": user["id"],
                      "updated_at": now}},
            return_document=ReturnDocument.AFTER)
    except DuplicateKeyError:
        raise LeagueProblem(CHANGED_MEANWHILE, 409) from None
    if not doc:
        raise LeagueProblem(CHANGED_MEANWHILE, 409)
    doc.pop("_id", None)
    doc.pop("_id", None)
    await _point_staffeln(db, league, season)
    return doc


async def _point_staffeln(db, league: dict, season: dict | None) -> None:
    """Die Staffeln zeigen ab jetzt auf die Regelseite - sofort, auch gesperrte (wie der Regeltext beim Übertragen)."""
    rows = await _seasons_to_freeze(db, league, season)
    ids = [row["id"] for row in rows]
    if ids:
        await db.tournaments.update_many({"league_context.season_id": {"$in": ids}, **ONLY_LEAGUE},
                                         {"$set": {"rules": STAFFEL_POINTER, "updated_at": now_utc().isoformat()}})


# ---------------------------------------------------------------- Zustimmung

def _demand(chain: dict) -> dict | None:
    """Die Fassung, der zugestimmt sein muss: die letzte gültige mit ``requires_consent`` im Geltungsbereich der gültigen Fassung."""
    current = chain["current"]
    if not current:
        return None
    rows = [row for row in chain["rows"] if row.get("scope") == current.get("scope") and row.get("scope_id") == current.get("scope_id")
            and (row.get("version") or 0) <= (current.get("version") or 0) and row.get("requires_consent")]
    return rows[-1] if rows else None


def _covers(demand: dict, chain: dict) -> list[str]:
    """Zustimmungen zu diesen Fassungen decken die Forderung: die geforderte und jede neuere."""
    return [row["id"] for row in chain["rows"] if row.get("scope") == demand.get("scope") and row.get("scope_id") == demand.get("scope_id")
            and (row.get("version") or 0) >= (demand.get("version") or 0)]


async def _season_registrations(db, season_id: str) -> list[dict]:
    tournaments = await db.tournaments.find({"league_context.season_id": season_id, **ONLY_LEAGUE},
                                            {"_id": 0, "id": 1}).to_list(200)
    if not tournaments:
        return []
    return await db.tournament_registrations.find(
        {"tournament_id": {"$in": [row["id"] for row in tournaments]}, "squad_id": {"$exists": True, "$ne": None},
         "status": {"$in": list(ACTIVE_REGISTRATIONS)}},
        {"_id": 0, "id": 1, "tournament_id": 1, "team_id": 1, "squad_id": 1, "squad_name": 1, "display_name": 1, "user_id": 1}).to_list(500)


async def _agreed(db, season_id: str, version_ids: list[str]) -> dict[str, dict]:
    rows = await db.league_rule_consents.find({"season_id": season_id, "rule_version_id": {"$in": version_ids}},
                                              {"_id": 0}).sort("created_at", 1).to_list(None)
    return {row["squad_id"]: row for row in rows}


async def consent_view(db, league: dict, season: dict | None, chain: dict, user: dict | None) -> dict | None:
    """Der Kapitäns-Hinweis: was die Person für ihre Co-Teams dieser Season zustimmen kann - ``None``, wenn nichts gefordert ist
    oder sie für keines verantwortlich ist."""
    demand = _demand(chain)
    if not demand or not season or not user:
        return None
    registrations = await _season_registrations(db, season["id"])
    teams = await teams_by_id(db, registrations)
    mine = [reg for reg in registrations if user["id"] in responsible_ids(reg, teams.get(reg.get("team_id") or ""))]
    if not mine:
        return None
    agreed = await _agreed(db, season["id"], _covers(demand, chain))
    return {
        "version_id": chain["current"]["id"], "version": chain["current"].get("version"), "label": _label(chain["current"]),
        "demanded_label": _label(demand),
        "squads": [{"squad_id": reg["squad_id"], "squad_name": reg.get("squad_name") or reg.get("display_name"),
                    "agreed": reg["squad_id"] in agreed, "agreed_at": (agreed.get(reg["squad_id"]) or {}).get("created_at")}
                   for reg in mine],
    }


async def admin_consents(db, league: dict, season: dict, chain: dict) -> dict | None:
    """Stand je Co-Team für die Leitung."""
    demand = _demand(chain)
    if not demand:
        return None
    agreed = await _agreed(db, season["id"], _covers(demand, chain))
    names = await _names(db, {row["user_id"] for row in agreed.values() if row.get("user_id")})
    rows = []
    for reg in await _season_registrations(db, season["id"]):
        row = agreed.get(reg["squad_id"])
        rows.append({"squad_id": reg["squad_id"], "squad_name": reg.get("squad_name"), "team_name": reg.get("display_name"),
                     "agreed": bool(row), "agreed_at": (row or {}).get("created_at"),
                     "agreed_by": names.get((row or {}).get("user_id") or "")})
    rows.sort(key=lambda row: (row["agreed"], str(row["team_name"] or "").casefold()))
    return {"version_id": demand["id"], "label": _label(demand), "rows": rows}


async def give_consent(db, version_id: str, season_id: str, squad_id: str, user: dict) -> dict:
    """Zustimmung eines Co-Teams zur gültigen Fassung. Mehrfach folgenlos (eindeutiger Index)."""
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    league = await db.leagues.find_one({"id": (season or {}).get("league_id"), "status": "active"}, {"_id": 0}) if season else None
    if not league or season.get("status") == "archived" or not await leagues.can_see_season(user, season):
        raise LeagueProblem("Season nicht gefunden.", 404)
    chain = await _chain(db, league, season)
    version = _find(chain["rows"], version_id)
    if not chain["current"] or chain["current"]["id"] != version["id"]:
        raise LeagueProblem("Das ist nicht die gültige Fassung - bitte neu laden.", 409)
    registration = next((row for row in await _season_registrations(db, season_id) if row["squad_id"] == squad_id), None)
    if not registration:
        raise LeagueProblem("Dieses Co-Team spielt nicht in der Season.", 404)
    team = (await teams_by_id(db, [registration])).get(registration.get("team_id") or "")
    if user["id"] not in responsible_ids(registration, team):
        raise LeagueProblem("Zustimmen dürfen Captain und Vertreter des Co-Teams.", 403)
    key = {"rule_version_id": version["id"], "season_id": season_id, "squad_id": squad_id, "user_id": user["id"]}
    existing = await db.league_rule_consents.find_one(key, {"_id": 0})
    if existing:
        return {**existing, "replay": True}
    doc = {"id": new_id(), **key, "version": version.get("version"), "league_id": league["id"],
           "team_id": registration.get("team_id"), "created_at": now_utc().isoformat()}
    try:
        await db.league_rule_consents.insert_one(dict(doc))
    except DuplicateKeyError:
        return {**doc, "replay": True}
    return {**doc, "replay": False}


async def own_consent_tasks(db, user: dict, registrations: list[dict]) -> list[dict]:
    """Aufgabe „Regeln zustimmen“ für die Verantwortlichen - nur, wenn sie die Season auch sehen. Der Stand kommt jedes Mal frisch."""
    squad_rows = [row for row in registrations if row.get("squad_id")]
    if not squad_rows:
        return []
    tournaments = await db.tournaments.find({"id": {"$in": sorted({row["tournament_id"] for row in squad_rows})}, **ONLY_LEAGUE},
                                            {"_id": 0, "id": 1, "league_context": 1}).to_list(None)
    season_of = {row["id"]: row["league_context"].get("season_id") for row in tournaments}
    tasks: list[dict] = []
    for season_id in sorted({value for value in season_of.values() if value}):
        season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
        if not season or season.get("status") in ("archived", "completed") or not await leagues.can_see_season(user, season):
            continue
        league = await db.leagues.find_one({"id": season.get("league_id"), "status": "active"}, {"_id": 0})
        if not league:
            continue
        consent = await consent_view(db, league, season, await _chain(db, league, season), user)
        for row in (consent or {}).get("squads") or []:
            if not row["agreed"]:
                tasks.append({"task": "rules_consent", "season_id": season_id, "squad_id": row["squad_id"],
                              "squad_name": row["squad_name"], "version_label": consent["label"],
                              "title": f"{league.get('name')} {season.get('name')}", "rules_url": page_path(league, season)})
    return tasks


# ---------------------------------------------------------------- Das Spiel merkt sich die Fassung

async def match_stamp(db, match: dict) -> dict:
    """Das Feld fürs Festschreiben eines Ergebnisses: die gültige Fassung einer Staffel - leer bei anderen Formaten, ohne Regelwerk und
    wenn das Spiel schon eine festhält (eine Korrektur ändert nicht, was galt). Darf ein Ergebnis nie aufhalten."""
    if match.get("rule_version_id") or not match.get("tournament_id"):
        return {}
    try:
        tournament = await db.tournaments.find_one({"id": match["tournament_id"], **ONLY_LEAGUE}, {"_id": 0, "league_context": 1})
        context = (tournament or {}).get("league_context") or {}
        season = await db.league_seasons.find_one({"id": context.get("season_id")}, {"_id": 0}) if context else None
        league = await db.leagues.find_one({"id": (season or {}).get("league_id")}, {"_id": 0}) if season else None
        if not league:
            return {}
        current = (await _chain(db, league, season))["current"]
        return {"rule_version_id": current["id"]} if current else {}
    except Exception:  # noqa: BLE001 - das Ergebnis geht vor, der fehlende Vermerk steht im Protokoll
        logger.exception("Regelversion für ein Spiel nicht ermittelt")
        return {}


# ---------------------------------------------------------------- Suche

async def search_results(db, pattern: str, user: dict | None, limit: int) -> list[dict]:
    """Treffer der Website-Suche: gültige Fassungen, deren Seite die Person sehen darf. Alte Fassungen und Entwürfe nie."""
    rows = await db.league_rules.find(
        {"status": PUBLISHED, "$or": [{key: {"$regex": pattern, "$options": "i"}} for key in ("title", "body_md", "annexes.body_md")]},
        {"_id": 0, "frozen": 0}).sort("published_at", -1).to_list(limit * 5)
    out: list[dict] = []
    for row in rows:
        current = _current(await _published(db, row["scope"], row["scope_id"]))
        if not current or current["id"] != row["id"]:
            continue
        league = await db.leagues.find_one({"id": row.get("league_id"), "status": "active"}, {"_id": 0})
        season = await db.league_seasons.find_one({"id": row.get("season_id")}, {"_id": 0}) if row.get("season_id") else None
        if not league:
            continue
        try:
            await visible_scope(db, league["slug"], (season or {}).get("slug"), user)
        except LeagueProblem:
            continue
        name = " ".join(str(part) for part in (league.get("name"), (season or {}).get("name")) if part)
        out.append({"title": f"Regeln {name}", "url": page_path(league, season), "subtitle": _label(row), "date": row.get("published_at")})
        if len(out) >= limit:
            break
    return out
