"""Server-rendered SEO/share previews for public SPA routes."""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from html import escape
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from database import get_db
from services.slug_utils import find_by_slug_or_history
from services.visibility import user_can_see

router = APIRouter(prefix="/api/seo", tags=["seo"])

STAFF_HIDDEN_STATUSES = {"draft", "archived", "cancelled"}
MARKDOWN_RE = re.compile(r"(!?\[[^\]]*\]\([^)]+\)|[`*_>#~-]+|\r?\n+)")
HTML_RE = re.compile(r"<[^>]+>")
DEFAULT_SHARE_IMAGE = "/assets/brand/tls-wordmark.png"
DEFAULT_SITE_DESCRIPTION = (
    "THE LION SQUAD eSports ist ein Gaming und eSports Verein aus Tirol mit "
    "Community, Turnieren, Fast-Lap-Challenges, Events, Mitgliedschaft und Vereinsleben."
)
MONTHS_DE = [
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember",
]


def effective_favicon_url(branding: dict) -> str:
    custom = branding.get("favicon_url") or branding.get("favicon_light_url") or branding.get("favicon_dark_url")
    if custom:
        return custom
    return ""


def effective_favicon_urls(branding: dict) -> dict:
    fallback = effective_favicon_url(branding)
    return {
        "light": branding.get("favicon_light_url") or fallback,
        "dark": branding.get("favicon_dark_url") or fallback,
        "default": fallback,
    }


def effective_logo_url(branding: dict) -> str:
    return (
        branding.get("logo_url")
        or branding.get("logo_light_url")
        or branding.get("logo_dark_url")
        or branding.get("mascot_url")
        or DEFAULT_SHARE_IMAGE
    )


def effective_share_image_url(branding: dict) -> str:
    return (
        branding.get("share_banner_url")
        or branding.get("logo_url")
        or branding.get("logo_light_url")
        or branding.get("logo_dark_url")
        or branding.get("mascot_url")
        or DEFAULT_SHARE_IMAGE
    )


@router.get("/preview")
async def seo_preview(path: str, request: Request):
    redirect_url = await resolve_slug_redirect(path, request)
    if redirect_url:
        return RedirectResponse(url=redirect_url, status_code=301)
    meta = await resolve_meta(path, request)
    html = render_preview_html(meta)
    robots = meta.get("robots") or "index, follow"
    return HTMLResponse(
        content=html,
        headers={
            "Cache-Control": "public, max-age=300",
            "X-Robots-Tag": robots,
        },
    )


@router.get("/meta")
async def seo_meta(path: str, request: Request):
    redirect_url = await resolve_slug_redirect(path, request)
    if redirect_url:
        return JSONResponse({"redirect": redirect_url, "canonical": redirect_url})
    meta = await resolve_meta(path, request)
    return JSONResponse(meta)


async def resolve_slug_redirect(raw_path: str, request: Request) -> str | None:
    path = normalize_path(raw_path)
    parts = [part for part in path.strip("/").split("/") if part]
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    origin = public_origin(request, branding)

    if len(parts) == 1:
        first = parts[0].lower()
        if first == "f1":
            return f"{origin}/fastlap"
        if first == "gallery":
            return f"{origin}/galerie"
        return None

    if len(parts) < 2:
        return None

    first = parts[0].lower()
    slug = unquote(parts[1])
    suffix = "/" + "/".join(parts[2:]) if len(parts) > 2 else ""

    if first == "seasons" and slug == "current":
        season = await db.seasons.find_one({"status": "active", "slug": {"$exists": True}}, {"_id": 0}, sort=[("start_date", -1)])
        if not season:
            season = await db.seasons.find_one({"status": {"$ne": "draft"}, "slug": {"$exists": True}}, {"_id": 0}, sort=[("start_date", -1)])
        if season and season.get("slug"):
            return f"{origin}/seasons/{season['slug']}"

    route_map = {
        "news": (db.news_posts, "/news"),
        "events": (db.events, "/events"),
        "tournaments": (db.tournaments, "/tournaments"),
        "fastlap": (db.f1_challenges, "/fastlap"),
        "f1": (db.f1_challenges, "/fastlap"),
        "seasons": (db.seasons, "/seasons"),
        "gallery": (db.gallery_albums, "/galerie"),
        "galerie": (db.gallery_albums, "/galerie"),
        "members": (db.club_member_profiles, "/members"),
    }
    item = route_map.get(first)
    if not item:
        return None

    collection, public_prefix = item
    doc, _ = await find_by_slug_or_history(collection, slug, {"_id": 0})
    current_slug = doc.get("slug") if doc else None
    if not current_slug:
        return None
    canonical_prefix_redirect = first in {"f1", "gallery"}
    if current_slug == slug and not canonical_prefix_redirect:
        return None
    if not await is_redirectable_public_doc(first, doc):
        return None

    if first in {"news", "events", "fastlap", "f1", "seasons", "gallery", "galerie", "members"}:
        suffix = ""
    return f"{origin}{public_prefix}/{current_slug}{suffix}"


async def is_redirectable_public_doc(route: str, doc: dict) -> bool:
    if route == "news":
        return bool(doc.get("published", True) and is_public_visibility(doc) and is_published_now(doc))
    if route == "events":
        return bool(doc.get("status") != "draft" and is_public_visibility(doc))
    if route == "tournaments":
        return bool(
            doc.get("status") != "draft"
            and doc.get("is_public") is not False
            and await user_can_see(None, doc.get("visibility") or "public")
        )
    if route in {"fastlap", "f1"}:
        return bool(doc.get("status") != "draft" and is_public_visibility(doc))
    if route == "seasons":
        return bool(doc.get("status") != "draft")
    if route in {"gallery", "galerie"}:
        return bool(doc.get("published", True) and is_public_visibility(doc))
    if route == "members":
        return bool(doc.get("is_active") is not False)
    return True


async def resolve_meta(raw_path: str, request: Request) -> dict:
    path = normalize_path(raw_path)
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    origin = public_origin(request, branding)
    canonical = f"{origin}{path}"
    site_name = branding.get("club_name") or "THE LION SQUAD"
    default_description = branding.get("site_description") or DEFAULT_SITE_DESCRIPTION
    default_image = absolute_url(effective_share_image_url(branding), origin)
    default_logo = absolute_url(effective_logo_url(branding), origin)
    favicon_value = effective_favicon_url(branding)
    favicon = absolute_url(favicon_value, origin) if favicon_value else ""
    favicon_urls = effective_favicon_urls(branding)

    meta = {
        "title": branding.get("site_title") or "THE LION SQUAD - eSPORTS",
        "description": default_description,
        "image": default_image,
        "logo": default_logo,
        "favicon": favicon,
        "favicon_light": absolute_url(favicon_urls["light"], origin) if favicon_urls.get("light") else "",
        "favicon_dark": absolute_url(favicon_urls["dark"], origin) if favicon_urls.get("dark") else "",
        "url": canonical,
        "canonical": canonical,
        "site_name": site_name,
        "type": "website",
        "locale": "de_AT",
        "robots": "index, follow",
        "google_site_verification": branding.get("google_site_verification") or "",
        "msvalidate_01": branding.get("msvalidate_01") or "",
        "json_ld": website_json_ld(origin, site_name, default_description, default_image, default_logo, branding),
    }

    parts = [part for part in path.strip("/").split("/") if part]
    if not parts:
        return meta

    first = parts[0].lower()
    slug = unquote(parts[1]) if len(parts) > 1 else ""

    if first == "news" and slug:
        return await news_meta(db, slug, meta, origin)
    if first == "events" and slug:
        return await event_meta(db, slug, meta, origin)
    if first == "tournaments" and slug:
        suffix = parts[2].lower() if len(parts) > 2 else ""
        return await tournament_meta(db, slug, suffix, meta, origin)
    if first == "fastlap" and slug:
        return await fastlap_meta(db, slug, meta, origin)
    if first == "seasons" and slug:
        return await season_meta(db, slug, meta, origin)
    if first in {"gallery", "galerie"} and slug:
        return await gallery_meta(db, slug, meta, origin)
    if first == "teams" and slug:
        return await team_meta(db, slug, meta, origin)
    if first == "members" and slug:
        return await member_profile_meta(db, slug, meta, origin)
    if first in {"u", "players"} and slug:
        return await user_profile_meta(db, slug, meta, origin)
    if first == "references" and slug:
        return await reference_meta(db, slug, meta, origin)

    static = static_page_meta(first, meta)
    if static:
        if first == "membership" and len(parts) > 1:
            specific = static_page_meta("/".join(parts[:2]), meta)
            if specific:
                return add_breadcrumbs(specific, origin, [("Mitgliedschaft", "/membership")], specific.get("breadcrumb_label"))
            raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
        if first == "membership":
            raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
        return add_breadcrumbs(static, origin, current_label=static.get("breadcrumb_label"))
    raise HTTPException(404, "SEO-Vorschau nicht gefunden.")


async def news_meta(db, slug: str, base: dict, origin: str) -> dict:
    post, _ = await find_by_slug_or_history(db.news_posts, slug, {"_id": 0})
    if not post or not post.get("published", True) or not is_public_visibility(post) or not is_published_now(post):
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    description = seo_description(
        post.get("excerpt") or post.get("content") or post.get("title"),
        prefix=post.get("category") or "News",
        details=[format_date_label(post.get("published_at") or post.get("created_at"))],
    )
    image = absolute_url(post.get("banner_url") or base["image"], origin)
    canonical = f"{origin}/news/{post.get('slug') or slug}"
    meta = {
        **base,
        "title": f"{post.get('title')} · {base['site_name']}",
        "description": description,
        "image": image,
        "url": canonical,
        "canonical": canonical,
        "type": "article",
        "published_time": post.get("published_at") or post.get("created_at"),
        "modified_time": post.get("updated_at"),
    }
    meta["json_ld"] = {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "headline": post.get("title"),
        "description": description,
        "image": [image],
        "datePublished": post.get("published_at") or post.get("created_at"),
        "dateModified": post.get("updated_at") or post.get("published_at") or post.get("created_at"),
        "author": {"@type": "Organization", "name": base["site_name"]},
        "publisher": {"@type": "Organization", "name": base["site_name"], "logo": {"@type": "ImageObject", "url": base.get("logo") or base["image"]}},
        "mainEntityOfPage": meta["canonical"],
    }
    return add_breadcrumbs(meta, origin, [("News", "/news")], post.get("title"))


async def event_meta(db, slug: str, base: dict, origin: str) -> dict:
    event, _ = await find_by_slug_or_history(db.events, slug, {"_id": 0})
    if not event or event.get("status") == "draft" or not is_public_visibility(event):
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    description = seo_description(
        event.get("description") or event.get("program") or event.get("name"),
        prefix="Gaming Event",
        details=[event.get("location"), format_date_label(event.get("start_date"))],
    )
    image = absolute_url(event.get("banner_url") or base["image"], origin)
    place = event.get("location") or "THE LION SQUAD"
    canonical = f"{origin}/events/{event.get('slug') or slug}"
    meta = {
        **base,
        "title": f"{event.get('name')} · {base['site_name']}",
        "description": description,
        "image": image,
        "url": canonical,
        "canonical": canonical,
        "type": "event",
    }
    meta["json_ld"] = {
        "@context": "https://schema.org",
        "@type": "Event",
        "name": event.get("name"),
        "description": description,
        "image": [image],
        "startDate": event.get("start_date"),
        "endDate": event.get("end_date"),
        "eventStatus": "https://schema.org/EventScheduled",
        "eventAttendanceMode": "https://schema.org/MixedEventAttendanceMode" if event.get("is_hybrid") else ("https://schema.org/OnlineEventAttendanceMode" if event.get("is_online") else "https://schema.org/OfflineEventAttendanceMode"),
        "location": {"@type": "Place", "name": place, "address": clean_text(", ".join(filter(None, [event.get("address"), event.get("postal_code"), event.get("city"), event.get("country")])) or place)},
        "organizer": {"@type": "Organization", "name": event.get("organizer_name") or base["site_name"], "url": event.get("organizer_url") or origin},
        "url": meta["canonical"],
    }
    return add_breadcrumbs(meta, origin, [("Events", "/events")], event.get("name"))


async def tournament_meta(db, slug: str, suffix: str, base: dict, origin: str) -> dict:
    tournament, _ = await find_by_slug_or_history(db.tournaments, slug, {"_id": 0})
    if (
        not tournament
        or tournament.get("status") == "draft"
        or tournament.get("is_public") is False
        or not await user_can_see(None, tournament.get("visibility") or "public")
    ):
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    suffix_label = {"bracket": "Turnierbaum", "matches": "Spielplan", "standings": "Rangliste"}.get(suffix)
    title = tournament.get("title") or "Turnier"
    description = seo_description(
        tournament.get("description") or tournament.get("rules") or title,
        prefix="eSports Turnier",
        details=[
            tournament_game_label(tournament),
            format_date_label(tournament.get("start_date")),
            participant_label(tournament),
        ],
    )
    image = absolute_url(tournament.get("banner_url") or base["image"], origin)
    current_slug = tournament.get("slug") or slug
    suffix_path = f"/{suffix}" if suffix else ""
    canonical = f"{origin}/tournaments/{current_slug}{suffix_path}"
    meta = {
        **base,
        "title": f"{title}{' · ' + suffix_label if suffix_label else ''} · {base['site_name']}",
        "description": description,
        "image": image,
        "url": canonical,
        "canonical": canonical,
        "type": "website",
    }
    meta["json_ld"] = {
        "@context": "https://schema.org",
        "@type": "SportsEvent",
        "name": title,
        "description": description,
        "image": [image],
        "startDate": tournament.get("start_date"),
        "endDate": tournament.get("end_date"),
        "sport": tournament_game_label(tournament) or "eSports",
        "location": {"@type": "Place", "name": tournament.get("location") or "Online / Event"},
        "organizer": {"@type": "Organization", "name": base["site_name"], "url": origin},
        "url": meta["canonical"],
    }
    parents = [("Turniere", "/tournaments")]
    if suffix_label:
        parents.append((title, f"/tournaments/{current_slug}"))
    return add_breadcrumbs(meta, origin, parents, suffix_label or title)


async def fastlap_meta(db, slug: str, base: dict, origin: str) -> dict:
    challenge, _ = await find_by_slug_or_history(db.f1_challenges, slug, {"_id": 0})
    if not challenge or challenge.get("status") == "draft" or not is_public_visibility(challenge):
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    description = seo_description(
        challenge.get("description") or challenge.get("rules") or challenge.get("title"),
        prefix="F1 Fast-Lap-Challenge",
        details=[
            challenge.get("platform"),
            format_date_label(challenge.get("start_date")),
            track_label(challenge),
        ],
    )
    image = absolute_url(challenge.get("banner_url") or base["image"], origin)
    canonical = f"{origin}/fastlap/{challenge.get('slug') or slug}"
    meta = {
        **base,
        "title": f"{challenge.get('title')} · {base['site_name']}",
        "description": description,
        "image": image,
        "url": canonical,
        "canonical": canonical,
        "type": "website",
    }
    meta["json_ld"] = {
        "@context": "https://schema.org",
        "@type": "SportsEvent",
        "name": challenge.get("title"),
        "description": description,
        "image": [image],
        "startDate": challenge.get("start_date"),
        "endDate": challenge.get("end_date"),
        "sport": "eSports Racing",
        "location": {"@type": "VirtualLocation", "url": meta["canonical"]},
        "organizer": {"@type": "Organization", "name": base["site_name"], "url": origin},
        "url": meta["canonical"],
    }
    return add_breadcrumbs(meta, origin, [("Fast Lap", "/fastlap")], challenge.get("title"))


async def season_meta(db, slug: str, base: dict, origin: str) -> dict:
    season, _ = await find_by_slug_or_history(db.seasons, slug, {"_id": 0})
    if not season or season.get("status") == "draft":
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    description = seo_description(
        season.get("description") or season.get("name"),
        prefix="Jahreswertung",
        details=[season.get("year") or season.get("season_year")],
    )
    image = absolute_url(season.get("banner_url") or base["image"], origin)
    canonical = f"{origin}/seasons/{season.get('slug') or slug}"
    meta = {
        **base,
        "title": f"{season.get('name')} · {base['site_name']}",
        "description": description,
        "image": image,
        "url": canonical,
        "canonical": canonical,
        "type": "website",
    }
    meta["json_ld"] = webpage_json_ld(meta)
    return add_breadcrumbs(meta, origin, [("Jahreswertung", "/seasons")], season.get("name"))


async def gallery_meta(db, slug: str, base: dict, origin: str) -> dict:
    album, _ = await find_by_slug_or_history(db.gallery_albums, slug, {"_id": 0})
    if not album or not album.get("published", True) or not is_public_visibility(album):
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    photo = await db.gallery_photos.find_one({"album_id": album.get("id")}, {"_id": 0}, sort=[("order_index", 1)])
    photo_count = album.get("photo_count")
    image = absolute_url(album.get("cover_url") or (photo or {}).get("thumbnail_url") or (photo or {}).get("image_url") or base["image"], origin)
    canonical = f"{origin}/galerie/{album.get('slug') or slug}"
    meta = {
        **base,
        "title": f"{album.get('title')} · Galerie · {base['site_name']}",
        "description": seo_description(
            album.get("description") or "Fotos und Eindrücke von THE LION SQUAD.",
            prefix="Galerie",
            details=[f"{photo_count} Fotos" if isinstance(photo_count, int) and photo_count > 0 else None],
        ),
        "image": image,
        "url": canonical,
        "canonical": canonical,
        "type": "website",
    }
    meta["json_ld"] = webpage_json_ld(meta)
    return add_breadcrumbs(meta, origin, [("Galerie", "/galerie")], album.get("title"))


async def team_meta(db, team_id: str, base: dict, origin: str) -> dict:
    team = await db.teams.find_one({"id": team_id, "is_public": {"$ne": False}}, {"_id": 0})
    if not team:
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    title = team.get("name") or team.get("tag") or "Team"
    image = absolute_url(team.get("logo_url") or base["image"], origin)
    canonical = f"{origin}/teams/{team.get('id') or team_id}"
    member_count = team.get("member_count")
    meta = {
        **base,
        "title": f"{title} · Team · {base['site_name']}",
        "description": seo_description(
            team.get("description") or f"Teamprofil von {title}.",
            prefix="Teamprofil",
            details=[team.get("tag"), f"{member_count} Mitglieder" if isinstance(member_count, int) and member_count > 0 else None],
        ),
        "image": image,
        "url": canonical,
        "canonical": canonical,
        "type": "profile",
    }
    meta["json_ld"] = {
        "@context": "https://schema.org",
        "@type": "SportsTeam",
        "name": title,
        "description": meta["description"],
        "url": meta["canonical"],
        "image": image,
        "memberOf": {"@type": "Organization", "name": base["site_name"], "url": origin},
    }
    return add_breadcrumbs(meta, origin, [("Teams", "/teams")], title)


async def member_profile_meta(db, slug: str, base: dict, origin: str) -> dict:
    profile, _ = await find_by_slug_or_history(db.club_member_profiles, slug, {"_id": 0})
    if not profile or profile.get("is_active") is False:
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    image = absolute_url(profile.get("photo_url") or profile.get("cover_url") or profile.get("avatar_url") or profile.get("banner_url") or base["image"], origin)
    canonical = f"{origin}/members/{profile.get('slug') or slug}"
    label = profile.get("display_name") or profile.get("gamertag") or "Vereinsmitglied"
    meta = {
        **base,
        "title": f"{label} · {base['site_name']}",
        "description": seo_description(
            profile.get("bio") or f"{label} ist Vereinsmitglied bei THE LION SQUAD eSports.",
            prefix="Vereinsmitglied",
            details=[profile.get("role_title"), profile.get("gamertag")],
        ),
        "image": image,
        "url": canonical,
        "canonical": canonical,
        "type": "profile",
    }
    meta["json_ld"] = webpage_json_ld(meta)
    return add_breadcrumbs(meta, origin, [("Vereinsmitglieder", "/members")], label)


async def user_profile_meta(db, username: str, base: dict, origin: str) -> dict:
    user = await db.users.find_one({"username": username, "privacy_public_profile": True, "is_active": True, "is_banned": {"$ne": True}}, {"_id": 0, "password_hash": 0, "email": 0})
    if not user:
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    label = user.get("display_name") or user.get("username")
    image = absolute_url(user.get("avatar_url") or user.get("banner_url") or base["image"], origin)
    canonical = f"{origin}/u/{user.get('username') or username}"
    meta = {
        **base,
        "title": f"{label} · Community · {base['site_name']}",
        "description": seo_description(
            user.get("bio") or f"Community-Profil von {label}.",
            prefix="Community-Profil",
            details=[user.get("main_platform"), ", ".join(user.get("favorite_games") or [])],
        ),
        "image": image,
        "type": "profile",
    }
    meta["url"] = canonical
    meta["canonical"] = canonical
    meta["robots"] = "noindex, follow"
    meta["json_ld"] = webpage_json_ld(meta)
    return add_breadcrumbs(meta, origin, [("Community-Spieler", "/players")], label)


async def reference_meta(db, rid: str, base: dict, origin: str) -> dict:
    item = await db.references.find_one(
        {"id": rid, "is_active": {"$ne": False}, "$or": [{"visibility": "public"}, {"visibility": {"$exists": False}}, {"visibility": None}]},
        {"_id": 0},
    )
    if not item:
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    title = reference_title(item)
    game = reference_game_label(item)
    description = seo_description(
        item.get("description") or item.get("highlights") or title,
        prefix="eSports Referenz",
        details=[
            game,
            placement_label(item),
            format_date_label(item.get("start_date")),
        ],
    )
    game_data = item.get("game") if isinstance(item.get("game"), dict) else {}
    image = absolute_url(game_data.get("logo_url") or base["image"], origin)
    canonical = f"{origin}/references/{item.get('id') or rid}"
    meta = {
        **base,
        "title": f"{title} · Referenz · {base['site_name']}",
        "description": description,
        "image": image,
        "url": canonical,
        "canonical": canonical,
        "type": "article",
    }
    meta["json_ld"] = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": title,
        "description": description,
        "image": [image],
        "url": canonical,
        "publisher": {"@type": "Organization", "name": base["site_name"], "url": origin},
        "about": game,
    }
    return add_breadcrumbs(meta, origin, [("Referenzen", "/references")], title)


def static_page_meta(slug: str, base: dict) -> dict | None:
    labels = {
        "esports": ("eSports", "Alle eSports-Aktivitaeten von THE LION SQUAD: Turniere, Fast-Lap-Challenges, Jahreswertung, Live-Brackets und Leaderboards."),
        "news": ("News", "Aktuelle News, Ergebnisse, Ankündigungen, Events und Turnier-Updates von THE LION SQUAD eSports aus Tirol."),
        "events": ("Events", "Gaming Events, Vereinsabende, LAN-Partys, Messen und öffentliche Termine von THE LION SQUAD eSports in Tirol."),
        "tournaments": ("eSports Turniere", "Aktuelle eSports Turniere von THE LION SQUAD: Anmeldung, Check-in, Brackets, Spielpläne und Ranglisten für Gaming Events in Tirol."),
        "fastlap": ("F1 Fast Lap Challenges", "F1 und Racing Fast-Lap-Challenges von THE LION SQUAD mit Live-Leaderboards, Strecken, Zeiten und Championship-Wertung."),
        "f1": ("F1 Fast Lap Challenges", "Formel-1-Fast-Lap-Challenges, aktuelle Strecken, Bestenlisten und Racing Events von THE LION SQUAD eSports."),
        "references": ("Referenzen", "Externe Turniere, Ligen, Platzierungen, Podien und Erfolge von THE LION SQUAD eSports."),
        "teams": ("Teams & Clans", "Teams, Squads und Clans der THE LION SQUAD Gaming Community: Profile, Mitglieder, Join-Codes und eSports Organisation."),
        "players": ("Community-Spieler", "Öffentliche Spielerprofile, Community-Mitglieder und aktive eSports-Profile von THE LION SQUAD."),
        "members": ("Vereinsmitglieder", "Offizielle Vereinsmitglieder von THE LION SQUAD eSports: Gaming Profile, Rollen, Teams und Community aus Tirol."),
        "membership": ("Mitgliedschaft", "Mitglied werden bei THE LION SQUAD: eSports Verein, Gaming Community, Mitgliederbereich, Events, Turniere und Vorteile in Tirol."),
        "membership/join": ("Mitglied werden", "Mitglied werden bei THE LION SQUAD: eSports Verein, Gaming Community, Mitgliederbereich, Events, Turniere und Vorteile in Tirol."),
        "membership/apply": ("Mitgliedschaft beantragen", "Online Mitgliedschaft bei THE LION SQUAD eSports beantragen und Teil der Gaming Community in Tirol werden."),
        "community": ("Gaming Community", "Community, Teams, Spielerprofile und Vereinsmitglieder von THE LION SQUAD eSports aus Tirol."),
        "servers": ("Community Server", "Öffentliche und geschützte Community-Gameserver von THE LION SQUAD für Gaming, Training und Vereinsmitglieder."),
        "sponsors": ("Sponsoren", "Sponsoren, Hauptsponsoren und Unterstützer von THE LION SQUAD eSports, Turnieren, Events und Vereinsarbeit in Tirol."),
        "partners": ("Partner", "Partner, Vereine, Veranstalter und Communitys im Netzwerk von THE LION SQUAD eSports aus Tirol."),
        "gallery": ("Galerie", "Fotos und Eindrücke von THE LION SQUAD eSports: Turniere, LAN-Partys, Events und Gaming Community in Tirol."),
        "galerie": ("Galerie", "Fotos und Eindrücke von THE LION SQUAD eSports: Turniere, LAN-Partys, Events und Gaming Community in Tirol."),
        "about": ("eSports Verein in Tirol", "THE LION SQUAD ist ein österreichischer eSports und Gaming Verein aus Tirol mit Community, Events, Turnieren und echtem Zusammenhalt."),
        "board": ("Vorstand", "Vorstand, Ansprechpartner und Vereinsverantwortliche von THE LION SQUAD eSports in Tirol."),
        "values": ("Werte & Ziele", "Fairplay, Zusammenhalt, Gaming-Kultur und Vereinsziele von THE LION SQUAD eSports."),
        "contact": ("Kontakt", "Kontakt zu THE LION SQUAD eSports für Mitgliedschaft, Turniere, Events, Sponsoring, Kooperationen und Gaming-Anfragen in Tirol."),
        "privacy": ("Datenschutz", "Datenschutzerklärung von THE LION SQUAD eSports mit Informationen zu Cookies, Diensten und Rechten."),
        "imprint": ("Impressum", "Impressum, Vereinsangaben, Kontaktinformationen und rechtliche Hinweise von THE LION SQUAD eSports."),
    }
    item = labels.get(slug)
    if not item:
        return None
    title, description = item
    breadcrumb_label = "Verein" if slug == "about" else title
    meta = {**base, "title": f"{title} · {base['site_name']}", "description": description, "breadcrumb_label": breadcrumb_label}
    if slug in {"membership/apply", "players", "privacy", "imprint"}:
        meta["robots"] = "noindex, follow"
    meta["json_ld"] = webpage_json_ld(meta)
    if slug in {"about", "membership", "membership/join", "contact"}:
        meta["json_ld"] = json_ld_graph(meta["json_ld"], organization_json_ld(base))
    return meta


def json_ld_script_content(data: dict) -> str:
    return (
        json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        .replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("</", "<\\/")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def render_preview_html(meta: dict) -> str:
    title = escape(str(meta["title"]), quote=True)
    description = escape(str(meta["description"]), quote=True)
    image = escape(str(meta["image"]), quote=True)
    favicon = escape(str(meta.get("favicon") or ""), quote=True)
    favicon_light = escape(str(meta.get("favicon_light") or ""), quote=True)
    favicon_dark = escape(str(meta.get("favicon_dark") or ""), quote=True)
    favicon_parts = []
    if favicon_light and favicon_light != favicon:
        favicon_parts.append(f'<link rel="icon" href="{favicon_light}" media="(prefers-color-scheme: light)" />')
    if favicon_dark and favicon_dark != favicon_light:
        favicon_parts.append(f'<link rel="icon" href="{favicon_dark}" media="(prefers-color-scheme: dark)" />')
    if favicon:
        favicon_parts.append(f'<link rel="icon" href="{favicon}" />')
        favicon_parts.append(f'<link rel="apple-touch-icon" href="{favicon}" />')
    favicon_links = "\n    ".join(favicon_parts)
    url = escape(str(meta["url"]), quote=True)
    canonical = escape(str(meta["canonical"]), quote=True)
    site_name = escape(str(meta["site_name"]), quote=True)
    type_ = escape(str(meta.get("type") or "website"), quote=True)
    locale = escape(str(meta.get("locale") or "de_AT"), quote=True)
    robots = escape(str(meta.get("robots") or "index, follow"), quote=True)
    json_ld = json_ld_script_content(meta.get("json_ld") or webpage_json_ld(meta))
    optional = []
    image_type = image_mime_type(meta.get("image"))
    if image_type:
        optional.append(f'<meta property="og:image:type" content="{escape(image_type, quote=True)}" />')
    if meta.get("published_time"):
        optional.append(f'<meta property="article:published_time" content="{escape(str(meta["published_time"]), quote=True)}" />')
    if meta.get("modified_time"):
        optional.append(f'<meta property="article:modified_time" content="{escape(str(meta["modified_time"]), quote=True)}" />')
    if meta.get("google_site_verification"):
        optional.append(f'<meta name="google-site-verification" content="{escape(str(meta["google_site_verification"]), quote=True)}" />')
    if meta.get("msvalidate_01"):
        optional.append(f'<meta name="msvalidate.01" content="{escape(str(meta["msvalidate_01"]), quote=True)}" />')
    return f"""<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    {favicon_links}
    <link rel="canonical" href="{canonical}" />
    <meta name="description" content="{description}" />
    <meta name="robots" content="{robots}" />
    <meta property="og:type" content="{type_}" />
    <meta property="og:locale" content="{locale}" />
    <meta property="og:site_name" content="{site_name}" />
    <meta property="og:title" content="{title}" />
    <meta property="og:description" content="{description}" />
    <meta property="og:url" content="{url}" />
    <meta property="og:image" content="{image}" />
    <meta property="og:image:secure_url" content="{image}" />
    <meta property="og:image:alt" content="{title}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="{title}" />
    <meta name="twitter:description" content="{description}" />
    <meta name="twitter:image" content="{image}" />
    <meta name="twitter:image:alt" content="{title}" />
    {"".join(optional)}
    <script type="application/ld+json">{json_ld}</script>
  </head>
  <body>
    <main>
      <h1>{title}</h1>
      <p>{description}</p>
      <p><a href="{canonical}">Seite öffnen</a></p>
    </main>
  </body>
</html>"""


def normalize_path(raw_path: str) -> str:
    parsed = urlparse(raw_path or "/")
    path = parsed.path or "/"
    if not path.startswith("/"):
        path = "/" + path
    return path.rstrip("/") or "/"


def public_origin(request: Request, branding: dict) -> str:
    configured = (branding.get("domain") or os.environ.get("PUBLIC_URL") or os.environ.get("FRONTEND_URL") or "").strip().rstrip("/")
    if configured:
        return configured if configured.startswith(("http://", "https://")) else f"https://{configured}"
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}".rstrip("/")


def absolute_url(value: str | None, origin: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        raw = "/assets/brand/tls-mascot.png"
    if raw.startswith(("http://", "https://")):
        return raw
    if raw.startswith("uploads/"):
        raw = f"/api/static/{raw}"
    elif raw.startswith("static/uploads/"):
        raw = f"/api/{raw}"
    elif raw.startswith("api/static/"):
        raw = f"/{raw}"
    elif not raw.startswith("/"):
        raw = f"/{raw}"
    return f"{origin}{raw}"


def image_mime_type(value: str | None) -> str:
    ext = os.path.splitext(urlparse(str(value or "")).path.lower())[1]
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(ext, "")


def clean_text(value: str | None, max_len: int = 180) -> str:
    text = HTML_RE.sub(" ", str(value or ""))
    text = MARKDOWN_RE.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return "THE LION SQUAD - eSPORTS"
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def seo_description(value: str | None, prefix: str | None = None, details: list[object] | None = None, max_len: int = 180) -> str:
    main = clean_text(value, max_len=max_len)
    detail_text = " · ".join(unique_text_parts(details or []))
    prefix_text = clean_optional_text(prefix, max_len=80)
    lead = " · ".join(part for part in [prefix_text, detail_text] if part)
    if not lead:
        return main
    candidate = f"{lead}: {main}" if main else lead
    if len(candidate) <= max_len:
        return candidate
    if main and len(lead) + 2 < max_len:
        return clean_text(candidate, max_len=max_len)
    return clean_text(main, max_len=max_len)


def unique_text_parts(values: list[object]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = clean_optional_text(value, max_len=80)
        if not text or text in {"0", "None"}:
            continue
        key = text.lower()
        if key not in seen:
            seen.add(key)
            out.append(text)
    return out


def clean_optional_text(value: object, max_len: int = 180) -> str:
    text = HTML_RE.sub(" ", str(value or ""))
    text = MARKDOWN_RE.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return ""
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def parse_dt(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def format_date_label(value) -> str:
    dt = parse_dt(value)
    if not dt:
        return ""
    local = dt.astimezone()
    return f"{local.day}. {MONTHS_DE[local.month - 1]} {local.year}"


def tournament_game_label(tournament: dict) -> str:
    game = tournament.get("game_name") or tournament.get("game_title") or tournament.get("game")
    if isinstance(game, dict):
        return game.get("name") or game.get("title") or ""
    return str(game or "").strip()


def participant_label(item: dict) -> str:
    value = item.get("participant_count") or item.get("registration_count") or item.get("registrations_count")
    if isinstance(value, int) and value > 0:
        return f"{value} Teilnehmer"
    max_players = item.get("max_participants") or item.get("max_players")
    if isinstance(max_players, int) and max_players > 0:
        return f"bis {max_players} Teilnehmer"
    return ""


def track_label(challenge: dict) -> str:
    count = challenge.get("track_count")
    if isinstance(count, int) and count > 0:
        return f"{count} Strecken"
    tracks = challenge.get("tracks")
    if isinstance(tracks, list) and tracks:
        return f"{len(tracks)} Strecken"
    return ""


def reference_title(item: dict) -> str:
    raw = clean_optional_text(item.get("title"), max_len=120)
    if not raw:
        return "Referenz"
    while raw.startswith("[") and "]" in raw:
        raw = raw.split("]", 1)[1].strip()
    parts = [part.strip() for part in raw.split("|") if part.strip()]
    if len(parts) >= 3:
        return " | ".join(parts[2:])
    return raw


def reference_game_label(item: dict) -> str:
    game = item.get("game")
    if isinstance(game, dict):
        return game.get("display_name") or game.get("name") or game.get("short_name") or ""
    return item.get("game_name") or item.get("game_id") or ""


def placement_label(item: dict) -> str:
    placement = item.get("placement")
    if isinstance(placement, int) and placement > 0:
        return f"Platz {placement}"
    if isinstance(placement, str) and placement.strip():
        return f"Platz {placement.strip()}"
    medal = item.get("medal")
    if medal:
        return str(medal).capitalize()
    return ""


def is_public_visibility(item: dict) -> bool:
    return (item.get("visibility") or "public") == "public"


def is_published_now(item: dict) -> bool:
    value = item.get("published_at")
    if not value:
        return True
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return True
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc) <= datetime.now(timezone.utc)


def website_json_ld(origin: str, name: str, description: str, image: str, logo: str | None = None, branding: dict | None = None) -> dict:
    branding = branding or {}
    same_as = [
        branding.get("discord_invite_url"),
        branding.get("whatsapp_channel_url"),
        branding.get("facebook_url"),
        branding.get("instagram_url"),
        branding.get("tiktok_url"),
        branding.get("youtube_url"),
    ]
    twitch = branding.get("twitch_channel")
    if twitch:
        same_as.append(twitch if str(twitch).startswith(("http://", "https://")) else f"https://www.twitch.tv/{str(twitch).lstrip('@')}")
    for social in branding.get("social_links") or []:
        if isinstance(social, dict) and social.get("enabled") is not False:
            same_as.append(social.get("url"))
    data = {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": name,
        "url": origin,
        "description": description,
        "image": image,
        "publisher": {
            "@type": "Organization",
            "name": name,
            "url": origin,
            "logo": {"@type": "ImageObject", "url": logo or image},
        },
        "potentialAction": {
            "@type": "SearchAction",
            "target": f"{origin}/news?q={{search_term_string}}",
            "query-input": "required name=search_term_string",
        },
    }
    cleaned = list(dict.fromkeys([url for url in same_as if url]))
    if cleaned:
        data["sameAs"] = cleaned
    return data


def organization_json_ld(meta: dict) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "SportsOrganization",
        "name": meta.get("site_name"),
        "url": origin_from_meta(meta),
        "logo": {"@type": "ImageObject", "url": meta.get("logo") or meta.get("image")},
        "image": meta.get("image"),
        "description": DEFAULT_SITE_DESCRIPTION,
        "sport": ["eSports", "Gaming"],
        "areaServed": {"@type": "AdministrativeArea", "name": "Tirol"},
    }


def image_object_json_ld(meta: dict) -> dict | None:
    image = meta.get("image")
    if not image:
        return None
    return {
        "@context": "https://schema.org",
        "@type": "ImageObject",
        "url": image,
        "contentUrl": image,
        "caption": title_without_site(meta),
        "representativeOfPage": True,
    }


def origin_from_meta(meta: dict) -> str:
    url = str(meta.get("canonical") or meta.get("url") or "").strip()
    if url.startswith(("http://", "https://")):
        return "/".join(url.split("/", 3)[:3])
    return url


def add_breadcrumbs(meta: dict, origin: str, parents: list[tuple[str, str]] | None = None, current_label: str | None = None) -> dict:
    trail: list[tuple[str, str]] = [("Startseite", origin)]
    for label, href in parents or []:
        if label and href:
            url = breadcrumb_url(origin, href)
            if trail[-1][1] != url:
                trail.append((label, url))

    current_url = meta.get("canonical") or meta.get("url")
    if current_url and trail[-1][1] != current_url:
        trail.append(((current_label or title_without_site(meta)).strip() or "Seite", current_url))

    if len(trail) <= 1:
        return meta

    breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": index,
                "name": label,
                "item": url,
            }
            for index, (label, url) in enumerate(trail, start=1)
        ],
    }
    meta["breadcrumbs"] = [{"name": label, "url": url} for label, url in trail]
    image_object = image_object_json_ld(meta)
    meta["json_ld"] = json_ld_graph(
        meta.get("json_ld") or webpage_json_ld(meta),
        breadcrumb,
        image_object,
    )
    return meta


def breadcrumb_url(origin: str, href: str) -> str:
    raw = str(href or "").strip()
    if raw.startswith(("http://", "https://")):
        return raw.rstrip("/") or raw
    if not raw.startswith("/"):
        raw = f"/{raw}"
    if raw == "/":
        return origin
    return f"{origin}{raw.rstrip('/')}"


def title_without_site(meta: dict) -> str:
    title = str(meta.get("title") or "").strip()
    if not title:
        return "Seite"
    return title.rsplit(" · ", 1)[0].strip() or title


def json_ld_graph(*items: dict) -> dict:
    nodes = []
    for item in items:
        nodes.extend(json_ld_nodes(item))
    return {
        "@context": "https://schema.org",
        "@graph": nodes,
    }


def json_ld_nodes(data: dict | None) -> list[dict]:
    if not data:
        return []
    if isinstance(data.get("@graph"), list):
        raw_nodes = data.get("@graph") or []
    else:
        raw_nodes = [data]
    nodes = []
    for node in raw_nodes:
        if not isinstance(node, dict):
            continue
        clean = dict(node)
        clean.pop("@context", None)
        nodes.append(clean)
    return nodes


def webpage_json_ld(meta: dict) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": meta.get("title"),
        "description": meta.get("description"),
        "url": meta.get("canonical"),
        "image": meta.get("image"),
        "isPartOf": {"@type": "WebSite", "name": meta.get("site_name")},
    }
