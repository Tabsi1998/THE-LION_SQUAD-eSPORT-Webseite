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
from services import game_maps, league_look, media_audit, uploads_inventory
from services.league_rules_cache import rules_cache
from services import league_rule_blocks as blocks
from services import markdown_text
from services import league_rules_text as text
from services import league_service as leagues
from services.dolibarr_policy import club_today
from services.league_rules_store import LEAGUE, PUBLISHED, SEASON, STAFFEL_POINTER
from services.league_scope import ONLY_LEAGUE
from services.league_service import LeagueProblem
from services.match_audience import responsible_ids, teams_by_id
from services.mutation_lock import MutationLockBusy, league_resource, league_season_resource, mutation_lock
from services.permissions import ADMIN_MEDIA_ROLES, is_confirmed_admin_role
from services.share_image_cache import fingerprint

logger = logging.getLogger("tls.league_rules")

SCOPES = (LEAGUE, SEASON)
DRAFT = "draft"
ACTIVE_REGISTRATIONS = ("approved", "checked_in", "pending")
# Grenzen je Fassung, mit allen Anlagen: Seite, Vergleich und PDF rechnen damit - für jede Person, die sie abruft.
TEXT_TOTAL_MAX = 400_000
SECTIONS_MAX = 400
REASON_MIN = 5
REASON_MAX = 500
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CHANGED_MEANWHILE = "Der Entwurf wurde inzwischen geändert - bitte neu laden."
SCOPE_BUSY = "An dieser Liga oder Season wird gerade etwas geändert - bitte gleich noch einmal."
PUBLIC_FIELDS = ("id", "scope", "version", "title", "valid_from", "published_at", "change_reason", "requires_consent", "blocks_used")
# Eine Adresse in den eigenen Upload - auch andere Seiten haben Ordner namens „uploads“, die gehen als Link.
OWN_UPLOAD_ADDRESS = re.compile(r"(?:^|/)api/(?:static/)?uploads/|^/?(?:static/)?uploads/")


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


def _in_force_order(row: dict) -> tuple[str, str]:
    """Die Reihenfolge, in der Fassungen gelten: nach „Gültig ab“, am selben Tag gilt die zuletzt veröffentlichte."""
    return str(row.get("valid_from") or ""), str(row.get("published_at") or "")


def _chain_of(league_rows: list[dict], own: list[dict] | None) -> dict:
    """Alles, was auf einer Seite gilt und vergleichbar ist. Auf einer Season (``own``): die eigenen Fassungen und die der Liga, die vor der
    ersten eigenen gelten - danach betrifft die Liga diese Season nicht mehr. Entscheidend ist, ab wann eine Fassung gilt, nicht wann sie
    veröffentlicht wurde: Eine eigene Fassung kann früh für später stehen, und die Season erbt bis dahin auch neuere der Liga."""
    if own is None:
        return {"rows": league_rows, "current": _current(league_rows), "upcoming": _upcoming(league_rows)}
    inherited = [row for row in league_rows if _in_force_order(row) < _in_force_order(own[0])] if own else league_rows
    rows = sorted(inherited + own, key=_in_force_order)
    return {"rows": rows, "current": _current(own) or _current(inherited), "upcoming": _upcoming(rows)}


async def _chain(db, league: dict, season: dict | None) -> dict:
    league_rows = await _published(db, LEAGUE, league["id"])
    return _chain_of(league_rows, await _published(db, SEASON, season["id"]) if season else None)


def _frozen_values(version: dict, season: dict | None, variant: str = "markdown", plain: bool = False) -> dict[str, str]:
    """Die eingefrorenen Bausteine - ``variant`` ``text``: die Fassung ohne Bilder (PDF, Wort-Vergleich, #2218), sonst ``markdown``.
    ``plain``: die geschützten Zeichen der Bausteinwerte als echte Zeichen - für den Wort-Vergleich, der Text und kein Markdown zeigt."""
    frozen = (version.get("frozen") or {}).get((season or {}).get("id") or "") or {}
    # Neu eingefroren: strukturiert im Klartext (``data``), erst hier Markdown; ältere Fassungen: das gespeicherte Markdown (#2218).
    values = {key: blocks.value(key, row, variant) for key, row in frozen.items()}
    return {key: markdown_text.plain(value) for key, value in values.items()} if plain else values


def _sections(version: dict, season: dict | None, variant: str = "markdown", plain: bool = False) -> list[dict]:
    """Die Abschnitte einer Fassung auf dieser Seite - mit den eingefrorenen Bausteinen."""
    values = _frozen_values(version, season, variant, plain)
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
    previous = _previous(chain["rows"], version)
    document = await rules_cache.get_or_make_json(
        ("page", version["id"], (previous or {}).get("id"), (season or {}).get("id")),
        lambda: _page_document(version, previous, season))
    sections, result = document["sections"], document["result"]
    return {
        **out, "source": "rules", "fallback_text": None,
        "version": {**_head(version, current), "pdf_url": f"{api_path(league, season)}/versions/{version['id']}/pdf"},
        "sections": _served(sections, result),
        "changes": {"base": _head(previous, current) if previous else None,
                    **{key: result[key] for key in ("new", "changed", "removed")}},
    }


def _served(sections: list[dict], result: dict) -> list[dict]:
    """Abschnitte für die API: Markierung dazu, ``body_md`` ohne Schutzzeichen - Namen mit Backslash-Escapes (Folge-Review #2218)."""
    return [{**row, "body_md": markdown_text.served(row["body_md"]), "mark": result["marks"].get(row["anchor"])} for row in sections]


def _page_document(version: dict, previous: dict | None, season: dict | None) -> dict:
    """Abschnitte und Vergleich einer Fassung - unveränderlich, darum einmal gerechnet."""
    sections = _sections(version, season)
    return {"sections": sections, "result": text.compare(_sections(previous, season) if previous else None, sections)}


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
    sections = await rules_cache.get_or_make_json(
        ("compare", base["id"], target["id"], (season or {}).get("id")),
        lambda: text.diff_view(_sections(base, season, blocks.TEXT, plain=True), _sections(target, season, blocks.TEXT, plain=True)))
    return {"base": _head(base, chain["current"]), "target": _head(target, chain["current"]), "sections": sections}


def _pdf_document(league: dict, season: dict | None, version: dict, previous: dict | None, marks: bool) -> dict:
    """Alles, was das PDF einer Fassung braucht - nur aus der Fassung, kein zweiter Inhalt. Bausteine in ihrer Fassung ohne Bilder (#2218)."""
    sections = _sections(version, season, blocks.TEXT)
    result = text.compare(_sections(previous, season, blocks.TEXT) if previous else None, sections)
    return {
        "title": version.get("title") or "Regelwerk",
        "context": " · ".join(str(part) for part in (league.get("name"), (season or {}).get("name")) if part),
        "version": version.get("version"), "label": _label(version), "valid_from": version.get("valid_from"),
        "published_at": version.get("published_at"), "change_reason": version.get("change_reason"),
        "sections": [{**row, "mark": result["marks"].get(row["anchor"]) if marks else None} for row in sections],
        "removed": result["removed"] if marks else [],
        "base_label": _label(previous) if previous and marks else None,
    }


async def pdf_file(db, league: dict, season: dict | None, version_id: str, *, marks: bool, branding: dict | None) -> tuple[bytes, str]:
    """Das PDF einer Fassung und sein Dateiname - einmal je Fassung und Markierung gebaut. Name von Liga und Season und die Marke stehen
    in der Datei, darum auch im Schlüssel; die Fassungen ändern sich nie."""
    chain = await _chain(db, league, season)
    version = _find(chain["rows"], version_id)
    previous = _previous(chain["rows"], version)
    looks = fingerprint([league.get("name"), (season or {}).get("name"), branding])
    key = ("pdf", version["id"], (previous or {}).get("id"), (season or {}).get("id"), marks, looks)

    def build() -> bytes:
        import pdf_service

        return pdf_service.pdf_league_rules(_pdf_document(league, season, version, previous, marks), branding)

    data = await rules_cache.get_or_make(key, build)
    name = "_".join(str(part) for part in ("regelwerk", league.get("slug"), (season or {}).get("slug"), f"v{version.get('version')}") if part)
    return data, name


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
        frozen_text = _frozen_values(version, row, blocks.TEXT, plain=True)
        for key, now in (await blocks.resolve(db, keys, league, row)).items():
            before = frozen.get(key)
            if before == blocks.value(key, now):
                continue
            # Geändert ist, was sich samt Bild änderte; markiert wird Wort für Wort im Klartext ohne Bilder (#2218) - auch ``before`` und
            # ``after`` sind Klartext, nie das Darstellungs-Zwischenformat mit Schutzzeichen.
            after = blocks.plain_value(key, now)
            rows.append({"block": key, "label": now["label"], "season_id": row["id"], "season_name": row.get("name"),
                         "status": "missing" if before is None else "changed", "before": frozen_text.get(key) or "", "after": after,
                         "ops": text.word_ops(frozen_text.get(key) or "", after)})
    return {"version_id": version["id"], "version": version.get("version"), "label": _label(version), "rows": rows} if rows else None


async def block_state(db, league: dict, season: dict, key: str) -> dict:
    """Für die Verwaltung einer Datenquelle (Sperrliste, #2218): Steht der Baustein in der letzten Fassung dieser Season, und zeigt sie noch
    den heutigen Stand? Nur ein Hinweis - eine neue Fassung bereitet die Leitung im Regelwerk vor."""
    own = await _published(db, SEASON, season["id"])
    current = (await _chain(db, league, season))["current"]
    latest = own[-1] if own else (current if current and current.get("scope") == LEAGUE else None)
    if not latest or key not in (latest.get("blocks_used") or []):
        return {"uses_block": False, "outdated": False, "version": None, "admin_url": None}
    changes = await data_changes(db, league, season, latest)
    outdated = any(row["block"] == key and row["season_id"] == season["id"] for row in (changes or {}).get("rows") or [])
    scope, scope_id = (SEASON, season["id"]) if latest.get("scope") == SEASON else (LEAGUE, league["id"])
    return {"uses_block": True, "outdated": outdated, "version": latest.get("version"),
            "admin_url": f"/admin/leagues/rules/{scope}/{scope_id}"}


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
    return [{"key": chr(ord("A") + index), "title": markdown_text.strip_protected(row.get("title")).strip(),
             "body_md": markdown_text.strip_protected(row.get("body_md"))} for index, row in enumerate(raw or [])]


def _check_size(body_md: str | None, annexes: list[dict] | None) -> None:
    total = len(str(body_md or "")) + sum(len(str(row.get("body_md") or "")) + len(str(row.get("title") or "")) for row in annexes or [])
    if total > TEXT_TOTAL_MAX:
        raise LeagueProblem(f"Das Regelwerk ist zu lang: höchstens {TEXT_TOTAL_MAX:,} Zeichen mit allen Anlagen.".replace(",", "."))
    if len(text.sections_of(body_md, annexes)) > SECTIONS_MAX:
        raise LeagueProblem(f"Das Regelwerk hat zu viele Abschnitte: höchstens {SECTIONS_MAX} Überschriften mit allen Anlagen.")


def _foreign_images(body_md: str | None, annexes: list[dict] | None) -> list[str]:
    """Bilder, die nicht aus dem eigenen Upload kommen: Eine fremde Adresse ließe jede Person beim Lesen bei Dritten anfragen."""
    addresses = text.image_addresses(body_md, *[row.get("body_md") for row in annexes or []])
    return [address for address in addresses if not game_maps.IMAGE_URL.fullmatch(address)]


def _upload_files(body_md: str | None, annexes: list[dict] | None) -> dict[str, str]:
    """Die Dateien aus dem Upload, die der Text nennt: Name → Adresse. Dieselbe Sicht wie die Verwendungssuche - dort zählt jede Adresse."""
    found: dict[str, str] = {}
    for value in (body_md, *[row.get("body_md") for row in annexes or []]):
        for address in media_audit.urls_in_text(value):
            name = uploads_inventory.upload_filename(address)
            if name:
                found.setdefault(name, address)
    return found


async def _unusable_files(db, body_md: str | None, annexes: list[dict] | None, user: dict | None, kept: set[str]) -> list[str]:
    """Adressen, die nicht in den Text dürfen. Jede Datei braucht ihren Eintrag in der Mediathek. Mit ``user`` zählt auch, wem sie gehört: Ohne
    Medienrolle nur eigene Bilder - außer sie stehen schon im Text (``kept``)."""
    files = _upload_files(body_md, annexes)
    if not files:
        return []
    names = sorted(files)
    rows = await db.media_uploads.find({"$or": [{"filename": {"$in": names}}, {"raster_filename": {"$in": names}}]},
                                       {"_id": 0, "filename": 1, "raster_filename": 1, "media_scope": 1, "owner_id": 1}).to_list(None)
    any_owner = user is None or is_confirmed_admin_role(user, ADMIN_MEDIA_ROLES)
    refused = []
    for name, address in files.items():
        entries = [row for row in rows if name in (row.get("filename"), row.get("raster_filename"))]
        if not entries:
            # Eine kleinere Fassung hat keinen eigenen Eintrag, zählt aber als ihr Original - im Text steht immer das Original.
            if OWN_UPLOAD_ADDRESS.search(address) or media_audit.VARIANT_NAME.match(name):
                refused.append(address)
        elif not any_owner and name not in kept and not any(
                row.get("media_scope") == "user" and str(row.get("owner_id")) == str(user["id"]) for row in entries):
            refused.append(address)
    return refused


async def _refused_images(db, body_md: str | None, annexes: list[dict] | None, user: dict | None, kept: set[str]) -> list[str]:
    foreign = _foreign_images(body_md, annexes)
    return foreign + [address for address in await _unusable_files(db, body_md, annexes, user, kept) if address not in foreign]


async def _check_images(db, body_md: str | None, annexes: list[dict] | None, user: dict | None = None, kept: set[str] | None = None) -> None:
    refused = await _refused_images(db, body_md, annexes, user, kept or set())
    if refused:
        raise LeagueProblem("Bilder im Regelwerk kommen nur aus dem eigenen Upload (PNG, JPG oder WebP): Bitte über „Hochladen“ oder die "
                            f"Mediathek wählen. Eine fremde Seite geht als Link. Nicht erlaubt: {refused[0][:80]}")


async def save_draft(db, scope: str, scope_id: str, body: dict, user: dict, *, carried: set[str] | None = None) -> dict:
    """``carried``: Dateien, die aus einer vorhandenen Fassung kommen - wie alles, was schon im gespeicherten Entwurf steht."""
    league, season = await resolve_scope(db, scope, scope_id)
    _check_size(body.get("body_md"), body.get("annexes"))
    existing = await draft_of(db, scope, scope_id)
    # Ohne Entwurf heißt eine Revision: Der gelesene ist inzwischen veröffentlicht oder verworfen.
    if body.get("revision") != existing.get("revision") if existing else body.get("revision"):
        raise LeagueProblem(CHANGED_MEANWHILE, 409)
    kept = set(carried or ()) | set(_upload_files((existing or {}).get("body_md"), (existing or {}).get("annexes")))
    await _check_images(db, body.get("body_md"), body.get("annexes"), user, kept)
    now = now_utc().isoformat()
    # Ein eingegebenes Schutzzeichen (Zwischenformat der Bausteine, #2218) wird nicht gespeichert.
    fields = {"title": markdown_text.strip_protected(body.get("title")).strip(), "body_md": markdown_text.strip_protected(body.get("body_md")),
              "annexes": _annexes(body.get("annexes")), "updated_at": now, "updated_by": user["id"]}
    if existing is None:
        doc = {"id": new_id(), "scope": scope, "scope_id": scope_id, "league_id": league["id"],
               "season_id": (season or {}).get("id"), "status": DRAFT, "version": None, "revision": 1, **fields,
               "created_at": now, "created_by": user["id"]}
        try:
            await db.league_rules.insert_one(dict(doc))
        except DuplicateKeyError:
            raise LeagueProblem(CHANGED_MEANWHILE, 409) from None
        return doc
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
    return await save_draft(db, scope, scope_id, {"title": source.get("title"), "body_md": source.get("body_md"), "annexes": source.get("annexes")},
                            user, carried=set(_upload_files(source.get("body_md"), source.get("annexes"))))


async def discard_draft(db, scope: str, scope_id: str) -> dict:
    await resolve_scope(db, scope, scope_id)
    doc = await db.league_rules.find_one_and_delete({"scope": scope, "scope_id": scope_id, "status": DRAFT}, projection={"_id": 0})
    if not doc:
        raise LeagueProblem("Es gibt keinen Entwurf.", 404)
    return doc


async def preview(db, scope: str, scope_id: str, body: dict, user: dict) -> dict:
    """Die Seite, wie sie heute würde: mit den Bausteinen von heute, gegen die letzte Fassung. Speichert nichts. Nennt dieselben Bilder, die das
    Speichern ablehnt."""
    league, season = await resolve_scope(db, scope, scope_id)
    annexes = _annexes(body.get("annexes"))
    draft = await draft_of(db, scope, scope_id) or {}
    _check_size(body.get("body_md"), annexes)
    keys = text.block_keys(body.get("body_md"), *[row["body_md"] for row in annexes])
    values = {key: blocks.value(key, row) for key, row in (await blocks.resolve(db, keys, league, season)).items()} if season else {}
    missing = blocks.NOT_FROZEN_HINT if season else blocks.NO_SEASON_HINT
    sections = text.sections_of(body.get("body_md"), annexes, fill=lambda value: text.fill_blocks(value, values, missing=missing))
    chain = await _chain(db, league, season)
    previous = chain["rows"][-1] if chain["rows"] else None
    result = await _compared(previous, season, sections)
    return {"sections": _served(sections, result),
            "changes": {"base": _head(previous, chain["current"]) if previous else None,
                        **{key: result[key] for key in ("new", "changed", "removed")}},
            "blocks_used": [key for key in keys if key in blocks.BLOCKS], "unknown_blocks": blocks.unknown(keys),
            "foreign_images": await _refused_images(db, body.get("body_md"), annexes, user, set(_upload_files(draft.get("body_md"), draft.get("annexes"))))}


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
    _check_size(draft.get("body_md"), annexes)
    if not str(draft.get("body_md") or "").strip() and not any(str(row.get("body_md") or "").strip() for row in annexes):
        raise LeagueProblem("Ein leeres Regelwerk lässt sich nicht veröffentlichen.")
    keys = text.block_keys(draft.get("body_md"), *[row.get("body_md") for row in annexes])
    wrong = blocks.unknown(keys)
    if wrong:
        raise LeagueProblem("Unbekannter Baustein im Text: " + ", ".join(wrong) + ".")
    return reason, valid_from, keys


async def publish(db, scope: str, scope_id: str, body: dict, user: dict) -> dict:
    """Veröffentlichen hält die Sperre von Season oder Liga: Löschen und Veröffentlichen laufen nacheinander, nie durcheinander."""
    resource = league_resource(scope_id) if scope == LEAGUE else league_season_resource(scope_id)
    try:
        async with mutation_lock(db, resource):
            return await _publish(db, scope, scope_id, body, user)
    except MutationLockBusy:
        raise LeagueProblem(SCOPE_BUSY, 409) from None


async def _publish(db, scope: str, scope_id: str, body: dict, user: dict) -> dict:
    """Macht den Entwurf zur Fassung, in einem Schritt: Hat ihn inzwischen jemand geändert oder veröffentlicht, passt der Filter
    nicht mehr (409); dieselbe Nummer verhindert der eindeutige Index."""
    league, season = await resolve_scope(db, scope, scope_id)
    draft = await draft_of(db, scope, scope_id)
    if not draft or draft.get("revision") != body.get("revision"):
        raise LeagueProblem(CHANGED_MEANWHILE, 409)
    own = await _published(db, scope, scope_id)
    predecessor = own[-1] if own else None
    reason, valid_from, keys = _check_publish(draft, body, predecessor)
    await _check_images(db, draft.get("body_md"), draft.get("annexes"))  # nur der Eintrag: Wer was hineingestellt hat, zählte beim Speichern
    frozen: dict[str, dict] = {}
    if keys:
        for row in await _seasons_to_freeze(db, league, season):
            frozen[row["id"]] = await blocks.resolve(db, keys, league, row)
    now = now_utc().isoformat()
    try:
        doc = await db.league_rules.find_one_and_update(
            {"id": draft["id"], "status": DRAFT, "revision": draft["revision"]},
            {"$set": {"status": PUBLISHED, "version": int((predecessor or {}).get("version") or 0) + 1, "frozen": frozen,
                      # Bilder der eingefrorenen Bausteine (#2218): Die Mediathek dreht und löscht sie nicht, solange die Fassung steht.
                      "frozen_images": blocks.frozen_images(frozen),
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


async def sides_consent(db, tournament: dict | None, registrations: list[dict]) -> dict[str, dict | None]:
    """Regelwerks-Sperre für Check-in und Start (D.2, #1652; Obmann 03.11.): je Anmeldung einer Staffel der Stand der Zustimmung ihres
    Co-Teams - ``None``, wenn nichts gefordert ist (kein Regelwerk, keine Fassung mit ``requires_consent``, kein Co-Team); sonst
    ``{open, version_id, label, rules_url}``. ``open``: Die Seite muss erst zustimmen."""
    out: dict[str, dict | None] = {reg["id"]: None for reg in registrations if reg.get("id")}
    context = (tournament or {}).get("league_context") or {}
    if not context.get("season_id") or not any(reg.get("squad_id") for reg in registrations):
        return out
    season = await db.league_seasons.find_one({"id": context["season_id"]}, {"_id": 0})
    league = await db.leagues.find_one({"id": (season or {}).get("league_id")}, {"_id": 0}) if season else None
    if not league:
        return out
    chain = await _chain(db, league, season)
    demand = _demand(chain)
    if not demand:
        return out
    agreed = await _agreed(db, season["id"], _covers(demand, chain))
    current = chain["current"]
    for reg in registrations:
        if reg.get("id") and reg.get("squad_id"):
            out[reg["id"]] = {"open": reg["squad_id"] not in agreed, "version_id": current["id"], "label": _label(current),
                              "rules_url": page_path(league, season)}
    return out


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
    """Zustimmen hält die Sperre der Season: Eine Zustimmung hält die Season fest, das Löschen sieht sie oder sie kommt danach nicht mehr."""
    try:
        async with mutation_lock(db, league_season_resource(season_id)):
            return await _give_consent(db, version_id, season_id, squad_id, user)
    except MutationLockBusy:
        raise LeagueProblem(SCOPE_BUSY, 409) from None


async def _give_consent(db, version_id: str, season_id: str, squad_id: str, user: dict) -> dict:
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
    return await record_consent(db, league["id"], version, season_id, squad_id, registration.get("team_id"), user["id"])


async def record_consent(db, league_id: str, version: dict, season_id: str, squad_id: str, team_id: str | None, user_id: str) -> dict:
    """Eine Zustimmung festhalten. Mehrfach folgenlos (eindeutiger Index). Aufrufer halten die Sperre der Season."""
    key = {"rule_version_id": version["id"], "season_id": season_id, "squad_id": squad_id, "user_id": user_id}
    existing = await db.league_rule_consents.find_one(key, {"_id": 0})
    if existing:
        return {**existing, "replay": True}
    doc = {"id": new_id(), **key, "version": version.get("version"), "league_id": league_id,
           "team_id": team_id, "created_at": now_utc().isoformat()}
    try:
        await db.league_rule_consents.insert_one(dict(doc))
    except DuplicateKeyError:
        return {**doc, "replay": True}
    return {**doc, "replay": False}


async def rules_state(db, league: dict, season: dict) -> dict:
    """``{current, upcoming}`` für die Prüfung vor der Veröffentlichung (#2207): die heute gültige Fassung und die nächste."""
    chain = await _chain(db, league, season)
    return {"current": chain["current"], "upcoming": chain["upcoming"]}


async def current_version(db, league: dict, season: dict) -> dict | None:
    """Die Fassung, die heute für diese Season gilt - eigene, sonst die der Liga. ``None``: Es gibt keine, auch wenn ein Regeltext da ist."""
    return (await _chain(db, league, season))["current"]


def version_view(league: dict, season: dict, version: dict) -> dict:
    """Was die Anmeldung über eine Fassung zeigt: Titel, Stand und die Wege zu Text und PDF."""
    return {"version_id": version["id"], "version": version.get("version"), "label": _label(version), "title": version.get("title"),
            "valid_from": version.get("valid_from"), "url": page_path(league, season),
            "pdf_url": f"{api_path(league, season)}/versions/{version['id']}/pdf"}


async def _by_id(collection, ids, query: dict | None = None, projection: dict | None = None) -> dict[str, dict]:
    rows = await collection.find({"id": {"$in": sorted(ids)}, **(query or {})}, projection or {"_id": 0}).to_list(None)
    return {row["id"]: row for row in rows}


async def own_consent_tasks(db, user: dict, registrations: list[dict]) -> list[dict]:
    """Aufgabe „Regeln zustimmen“ für die Verantwortlichen - nur, wenn sie die Season auch sehen. Läuft bei jedem Aufruf der Startseite,
    darum alles gesammelt: Die Zahl der Abfragen hängt nicht an der Zahl der Seasons, und der Text der Fassungen bleibt in der Datenbank."""
    squad_rows = [row for row in registrations if row.get("squad_id") and row.get("team_id")]
    if not squad_rows:
        return []
    tournaments = await _by_id(db.tournaments, {row["tournament_id"] for row in squad_rows}, ONLY_LEAGUE, {"_id": 0, "id": 1, "league_context": 1})
    season_of = {row["id"]: tournaments[row["tournament_id"]]["league_context"].get("season_id")
                 for row in squad_rows if row["tournament_id"] in tournaments}
    if not season_of:
        return []
    seasons = await _by_id(db.league_seasons, {value for value in season_of.values() if value}, {"status": {"$nin": ["archived", "completed"]}})
    # Was jemand sehen darf, hängt an Sichtbarkeit und Liga (Rechte je Liga, #2203) - je Paar einmal fragen.
    allowed: dict[tuple, bool] = {}
    for season in seasons.values():
        key = (season.get("visibility"), season.get("league_id"))
        if key not in allowed:
            allowed[key] = await leagues.can_see_season(user, season)
    seasons = {key: season for key, season in seasons.items() if allowed[(season.get("visibility"), season.get("league_id"))]}
    league_rows = await _by_id(db.leagues, {season.get("league_id") for season in seasons.values()}, {"status": "active"})
    seasons = {key: season for key, season in seasons.items() if season.get("league_id") in league_rows}
    if not seasons:
        return []

    versions = await db.league_rules.find(
        {"status": PUBLISHED, "$or": [{"scope": SEASON, "scope_id": {"$in": sorted(seasons)}}, {"scope": LEAGUE, "scope_id": {"$in": sorted(league_rows)}}]},
        {"_id": 0, "body_md": 0, "annexes": 0, "frozen": 0}).sort("version", 1).to_list(None)
    chains = {}
    for season_id, season in seasons.items():
        chains[season_id] = _chain_of([row for row in versions if row["scope"] == LEAGUE and row["scope_id"] == season.get("league_id")],
                                      [row for row in versions if row["scope"] == SEASON and row["scope_id"] == season_id])
    demands = {season_id: _demand(chain) for season_id, chain in chains.items()}
    mine = [row for row in squad_rows if demands.get(season_of.get(row["id"]))]
    if not mine:
        return []
    teams = await teams_by_id(db, mine)
    mine = [row for row in mine if user["id"] in responsible_ids(row, teams.get(row.get("team_id") or ""))]
    if not mine:
        return []
    agreed = {(row["season_id"], row["squad_id"], row["rule_version_id"]) for row in await db.league_rule_consents.find(
        {"season_id": {"$in": sorted(demands)}, "squad_id": {"$in": sorted({row["squad_id"] for row in mine})}},
        {"_id": 0, "season_id": 1, "squad_id": 1, "rule_version_id": 1}).to_list(None)}
    squads = await _by_id(db.team_squads, {row["squad_id"] for row in mine}, None, {"_id": 0, "id": 1, "name": 1})

    tasks: list[dict] = []
    for row in sorted(mine, key=lambda item: (season_of[item["id"]], item["squad_id"])):
        season_id = season_of[row["id"]]
        covers = _covers(demands[season_id], chains[season_id])
        if any((season_id, row["squad_id"], version_id) in agreed for version_id in covers):
            continue
        season, league = seasons[season_id], league_rows[seasons[season_id]["league_id"]]
        tasks.append({"task": "rules_consent", "season_id": season_id, "squad_id": row["squad_id"],
                      "squad_name": (squads.get(row["squad_id"]) or {}).get("name") or row.get("squad_name"),
                      "version_label": _label(chains[season_id]["current"]),
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
