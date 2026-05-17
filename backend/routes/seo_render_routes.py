"""Server-rendered SEO/share previews for public SPA routes."""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from html import escape
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse

from database import get_db
from services.visibility import user_can_see

router = APIRouter(prefix="/api/seo", tags=["seo"])

STAFF_HIDDEN_STATUSES = {"draft", "archived", "cancelled"}
MARKDOWN_RE = re.compile(r"(!?\[[^\]]*\]\([^)]+\)|[`*_>#~-]+|\r?\n+)")
HTML_RE = re.compile(r"<[^>]+>")
DEFAULT_SHARE_IMAGE = "/assets/brand/tls-wordmark.png"


@router.get("/preview")
async def seo_preview(path: str, request: Request):
    meta = await resolve_meta(path, request)
    html = render_preview_html(meta)
    return HTMLResponse(
        content=html,
        headers={
            "Cache-Control": "public, max-age=300",
            "X-Robots-Tag": "index, follow",
        },
    )


@router.get("/meta")
async def seo_meta(path: str, request: Request):
    meta = await resolve_meta(path, request)
    return JSONResponse(meta)


async def resolve_meta(raw_path: str, request: Request) -> dict:
    path = normalize_path(raw_path)
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    origin = public_origin(request, branding)
    canonical = f"{origin}{path}"
    site_name = branding.get("club_name") or "THE LION SQUAD"
    default_description = (
        branding.get("site_description")
        or "THE LION SQUAD - eSPORTS: Turniere, News, Events und Community."
    )
    default_image = absolute_url(
        branding.get("logo_url") or branding.get("mascot_url") or DEFAULT_SHARE_IMAGE,
        origin,
    )
    default_logo = absolute_url(
        branding.get("logo_url") or branding.get("mascot_url") or "/assets/brand/tls-favicon.png",
        origin,
    )

    meta = {
        "title": branding.get("site_title") or "THE LION SQUAD - eSPORTS",
        "description": default_description,
        "image": default_image,
        "logo": default_logo,
        "url": canonical,
        "canonical": canonical,
        "site_name": site_name,
        "type": "website",
        "locale": "de_AT",
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

    static = static_page_meta(first, meta)
    if static:
        if first == "membership" and len(parts) > 1:
            specific = static_page_meta("/".join(parts[:2]), meta)
            if specific:
                return specific
            raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
        if first == "membership":
            raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
        return static
    raise HTTPException(404, "SEO-Vorschau nicht gefunden.")


async def news_meta(db, slug: str, base: dict, origin: str) -> dict:
    post = await db.news_posts.find_one({"$or": [{"slug": slug}, {"id": slug}]}, {"_id": 0})
    if not post or not post.get("published", True) or not is_public_visibility(post) or not is_published_now(post):
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    description = clean_text(post.get("excerpt") or post.get("content") or post.get("title"))
    image = absolute_url(post.get("banner_url") or base["image"], origin)
    meta = {
        **base,
        "title": f"{post.get('title')} · {base['site_name']}",
        "description": description,
        "image": image,
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
    return meta


async def event_meta(db, slug: str, base: dict, origin: str) -> dict:
    event = await db.events.find_one({"$or": [{"slug": slug}, {"id": slug}]}, {"_id": 0})
    if not event or event.get("status") == "draft" or not is_public_visibility(event):
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    description = clean_text(event.get("description") or event.get("program") or event.get("name"))
    image = absolute_url(event.get("banner_url") or base["image"], origin)
    place = event.get("location") or "THE LION SQUAD"
    meta = {
        **base,
        "title": f"{event.get('name')} · {base['site_name']}",
        "description": description,
        "image": image,
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
    return meta


async def tournament_meta(db, slug: str, suffix: str, base: dict, origin: str) -> dict:
    tournament = await db.tournaments.find_one({"$or": [{"slug": slug}, {"id": slug}]}, {"_id": 0})
    if (
        not tournament
        or tournament.get("status") == "draft"
        or tournament.get("is_public") is False
        or not await user_can_see(None, tournament.get("visibility") or "public")
    ):
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    suffix_label = {"bracket": "Turnierbaum", "matches": "Spielplan", "standings": "Rangliste"}.get(suffix)
    title = tournament.get("title") or "Turnier"
    description = clean_text(tournament.get("description") or tournament.get("rules") or title)
    image = absolute_url(tournament.get("banner_url") or base["image"], origin)
    meta = {
        **base,
        "title": f"{title}{' · ' + suffix_label if suffix_label else ''} · {base['site_name']}",
        "description": description,
        "image": image,
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
        "location": {"@type": "Place", "name": tournament.get("location") or "Online / Event"},
        "organizer": {"@type": "Organization", "name": base["site_name"], "url": origin},
        "url": meta["canonical"],
    }
    return meta


async def fastlap_meta(db, slug: str, base: dict, origin: str) -> dict:
    challenge = await db.f1_challenges.find_one({"$or": [{"slug": slug}, {"id": slug}]}, {"_id": 0})
    if not challenge or challenge.get("status") == "draft" or not is_public_visibility(challenge):
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    description = clean_text(challenge.get("description") or challenge.get("rules") or challenge.get("title"))
    image = absolute_url(challenge.get("banner_url") or base["image"], origin)
    meta = {
        **base,
        "title": f"{challenge.get('title')} · {base['site_name']}",
        "description": description,
        "image": image,
        "type": "website",
    }
    meta["json_ld"] = webpage_json_ld(meta)
    return meta


async def season_meta(db, slug: str, base: dict, origin: str) -> dict:
    season = await db.seasons.find_one({"$or": [{"slug": slug}, {"id": slug}]}, {"_id": 0})
    if not season or season.get("status") == "draft":
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    description = clean_text(season.get("description") or season.get("name"))
    image = absolute_url(season.get("banner_url") or base["image"], origin)
    meta = {
        **base,
        "title": f"{season.get('name')} · {base['site_name']}",
        "description": description,
        "image": image,
        "type": "website",
    }
    meta["json_ld"] = webpage_json_ld(meta)
    return meta


async def gallery_meta(db, slug: str, base: dict, origin: str) -> dict:
    album = await db.gallery_albums.find_one({"$or": [{"slug": slug}, {"id": slug}]}, {"_id": 0})
    if not album or not album.get("published", True) or not is_public_visibility(album):
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    photo = await db.gallery_photos.find_one({"album_id": album.get("id")}, {"_id": 0}, sort=[("order_index", 1)])
    image = absolute_url(album.get("cover_url") or (photo or {}).get("thumbnail_url") or (photo or {}).get("image_url") or base["image"], origin)
    meta = {
        **base,
        "title": f"{album.get('title')} · Galerie · {base['site_name']}",
        "description": clean_text(album.get("description") or "Fotos und Eindrücke von THE LION SQUAD."),
        "image": image,
        "type": "website",
    }
    meta["json_ld"] = webpage_json_ld(meta)
    return meta


async def team_meta(db, team_id: str, base: dict, origin: str) -> dict:
    team = await db.teams.find_one({"id": team_id, "is_public": {"$ne": False}}, {"_id": 0})
    if not team:
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    title = team.get("name") or team.get("tag") or "Team"
    image = absolute_url(team.get("logo_url") or base["image"], origin)
    meta = {
        **base,
        "title": f"{title} · Team · {base['site_name']}",
        "description": clean_text(team.get("description") or f"Teamprofil von {title}."),
        "image": image,
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
    return meta


async def member_profile_meta(db, slug: str, base: dict, origin: str) -> dict:
    profile = await db.club_member_profiles.find_one({"slug": slug, "is_active": {"$ne": False}}, {"_id": 0})
    if not profile:
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    image = absolute_url(profile.get("avatar_url") or profile.get("banner_url") or base["image"], origin)
    meta = {
        **base,
        "title": f"{profile.get('display_name') or profile.get('gamertag')} · {base['site_name']}",
        "description": clean_text(profile.get("bio") or "Vereinsmitglied bei THE LION SQUAD eSports."),
        "image": image,
        "type": "profile",
    }
    meta["json_ld"] = webpage_json_ld(meta)
    return meta


async def user_profile_meta(db, username: str, base: dict, origin: str) -> dict:
    user = await db.users.find_one({"username": username, "privacy_public_profile": True, "is_active": True, "is_banned": {"$ne": True}}, {"_id": 0, "password_hash": 0, "email": 0})
    if not user:
        raise HTTPException(404, "SEO-Vorschau nicht gefunden.")
    label = user.get("display_name") or user.get("username")
    image = absolute_url(user.get("avatar_url") or user.get("banner_url") or base["image"], origin)
    meta = {
        **base,
        "title": f"{label} · Community · {base['site_name']}",
        "description": clean_text(user.get("bio") or f"Community-Profil von {label}."),
        "image": image,
        "type": "profile",
    }
    meta["json_ld"] = webpage_json_ld(meta)
    return meta


def static_page_meta(slug: str, base: dict) -> dict | None:
    labels = {
        "news": ("News", "Aktuelle News, Ergebnisse, Ankündigungen und Community-Updates von THE LION SQUAD eSports aus Tirol."),
        "events": ("Events", "Events, Vereinsabende, LANs, Messen und öffentliche Termine von THE LION SQUAD eSports im Überblick."),
        "tournaments": ("Turniere", "Turniere, Brackets, Spielpläne und Ranglisten von THE LION SQUAD."),
        "fastlap": ("Fast Lap", "Fast-Lap-Challenges, Leaderboards und Racing-Events."),
        "f1": ("F1 Fast Lap", "Formel-1-Fast-Lap-Challenges, aktuelle Strecken und Bestenlisten von THE LION SQUAD eSports."),
        "references": ("Referenzen", "Externe Turniere, Ligen, Platzierungen und Erfolge des Vereins."),
        "teams": ("Teams", "Teams, Squads und Community-Gruppen von THE LION SQUAD."),
        "players": ("Community-Spieler", "Öffentliche Spielerprofile, Community-Mitglieder und aktive eSports-Profile von THE LION SQUAD."),
        "members": ("Vereinsmitglieder", "Öffentliche Profile der Vereinsmitglieder von THE LION SQUAD."),
        "membership": ("Mitgliedschaft", "Mitglied werden bei THE LION SQUAD: Informationen zu Verein, Community, Vorteilen und Ablauf."),
        "membership/join": ("Mitglied werden", "Alle Informationen zur Mitgliedschaft bei THE LION SQUAD, zum Beitritt und zur Community im Verein."),
        "membership/apply": ("Mitgliedschaft beantragen", "Online Mitgliedschaft bei THE LION SQUAD beantragen und Teil der eSports-Community werden."),
        "community": ("Community", "Community, Mitglieder und Teams rund um THE LION SQUAD."),
        "servers": ("Server", "Öffentliche und geschützte Community-Gameserver von THE LION SQUAD."),
        "sponsors": ("Sponsoren", "Partner, Hauptsponsoren und Unterstützer von THE LION SQUAD eSports und unserer Events."),
        "partners": ("Partner", "Partnernetzwerk, Kooperationen und gemeinsame Projekte von THE LION SQUAD eSports aus Tirol."),
        "gallery": ("Galerie", "Fotos und Eindrücke von Events und Community-Abenden."),
        "galerie": ("Galerie", "Fotos und Eindrücke von Events und Community-Abenden."),
        "about": ("Verein", "Wer wir sind, wofür wir stehen und was THE LION SQUAD ausmacht."),
        "board": ("Vorstand", "Vorstand und Ansprechpartner von THE LION SQUAD."),
        "values": ("Werte & Ziele", "Werte, Ziele und Vereinsphilosophie von THE LION SQUAD."),
        "contact": ("Kontakt", "Kontakt zu THE LION SQUAD für Anfragen, Kooperationen und Sponsoring."),
        "privacy": ("Datenschutz", "Datenschutzerklärung von THE LION SQUAD eSports mit Informationen zu Cookies, Diensten und Rechten."),
        "imprint": ("Impressum", "Impressum, Vereinsangaben, Kontaktinformationen und rechtliche Hinweise von THE LION SQUAD eSports."),
    }
    item = labels.get(slug)
    if not item:
        return None
    title, description = item
    meta = {**base, "title": f"{title} · {base['site_name']}", "description": description}
    meta["json_ld"] = webpage_json_ld(meta)
    return meta


def json_ld_script_content(data: dict) -> str:
    return (
        json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        .replace("</", "<\\/")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def render_preview_html(meta: dict) -> str:
    title = escape(meta["title"])
    description = escape(meta["description"])
    image = escape(meta["image"])
    url = escape(meta["url"])
    canonical = escape(meta["canonical"])
    site_name = escape(meta["site_name"])
    type_ = escape(meta.get("type") or "website")
    locale = escape(meta.get("locale") or "de_AT")
    json_ld = json_ld_script_content(meta.get("json_ld") or webpage_json_ld(meta))
    optional = []
    if meta.get("published_time"):
        optional.append(f'<meta property="article:published_time" content="{escape(str(meta["published_time"]))}" />')
    if meta.get("modified_time"):
        optional.append(f'<meta property="article:modified_time" content="{escape(str(meta["modified_time"]))}" />')
    if meta.get("google_site_verification"):
        optional.append(f'<meta name="google-site-verification" content="{escape(str(meta["google_site_verification"]))}" />')
    if meta.get("msvalidate_01"):
        optional.append(f'<meta name="msvalidate.01" content="{escape(str(meta["msvalidate_01"]))}" />')
    return f"""<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <link rel="canonical" href="{canonical}" />
    <meta name="description" content="{description}" />
    <meta property="og:type" content="{type_}" />
    <meta property="og:locale" content="{locale}" />
    <meta property="og:site_name" content="{site_name}" />
    <meta property="og:title" content="{title}" />
    <meta property="og:description" content="{description}" />
    <meta property="og:url" content="{url}" />
    <meta property="og:image" content="{image}" />
    <meta property="og:image:secure_url" content="{image}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
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


def clean_text(value: str | None, max_len: int = 180) -> str:
    text = HTML_RE.sub(" ", str(value or ""))
    text = MARKDOWN_RE.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return "THE LION SQUAD - eSPORTS"
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


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
