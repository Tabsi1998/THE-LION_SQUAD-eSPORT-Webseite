"""THE LION SQUAD eSports - FastAPI main entry."""
from dotenv import load_dotenv
from pathlib import Path
ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

import math
import os
import logging
import time
from urllib.parse import urlparse
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse, Response, StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from contextlib import asynccontextmanager

from database import get_db, init_indexes, close_client
from badges import seed_badges
from services.bootstrap import ensure_wiring
from routes.auth_routes import router as auth_router
from routes.passkey_routes import router as passkey_router
from routes.user_routes import router as user_router
from routes.award_routes import router as award_router
from routes.honour_routes import router as honour_router
from routes.team_routes import router as team_router
from routes.team_page_routes import router as team_page_router
from routes.team_day_routes import router as team_day_router
from routes.feedback_routes import router as feedback_router, admin_router as feedback_admin_router
from routes.helper_call_routes import router as helper_call_router
from routes.share_routes import router as share_router
from routes.year_review_routes import admin_router as year_review_admin_router, router as year_review_router
from routes.profile_record_routes import router as profile_record_router
from routes.team_level_routes import router as team_level_router
from routes.message_routes import router as message_router
from routes.chat_routes import router as chat_router
from routes.friend_routes import router as friend_router
from routes.moderation_routes import router as moderation_router
from routes.game_routes import router as game_router
from routes.game_map_routes import router as game_map_router
from routes.map_pool_routes import router as map_pool_router
from routes.game_server_routes import router as game_server_router
from routes.access_link_routes import router as access_link_router
from routes.admin_picker_routes import router as admin_picker_router
from routes.tv_routes import router as tv_router
from routes.event_routes import router as event_router
from routes.event_lead_routes import router as event_lead_router
from routes.event_recap_routes import is_private_path as is_private_friends_path, router as event_recap_router
from routes.tournament_routes import router as tournament_router
# Hallen- und Aufruf-Tafel mit Event-Schlüssel (#1822) - nutzt den Turnierbaum aus den Turnier-Routen.
from routes.event_display_routes import router as event_display_router
from routes.match_routes import router as match_router
from routes.f1_routes import router as f1_router
from routes.event_program_routes import router as event_program_router
from routes.station_routes import router as station_router
from routes.news_routes import router as news_router
from routes.reference_series_routes import router as reference_series_router
from routes.reference_round_routes import router as reference_round_router
from routes.reference_participant_routes import router as reference_participant_router
from routes.reference_result_routes import router as reference_result_router
from routes.reference_result_image_routes import router as reference_result_image_router
from routes.reference_original_routes import router as reference_original_router
from routes.reference_staff_routes import router as reference_staff_router
from routes.reference_season_close_routes import router as reference_season_close_router
from routes.reference_bundle_routes import router as reference_bundle_router
from routes.reference_adjustment_routes import router as reference_adjustment_router
from routes.reference_series_public_routes import router as reference_series_public_router
from routes.reference_round_page_routes import router as reference_round_page_router
from routes.reference_partner_routes import router as reference_partner_router
from routes.reference_season_table_routes import router as reference_season_table_router
from routes.mobile_routes import router as mobile_router
from routes.admin_routes import router as admin_router
from routes.ops_routes import router as ops_router
from routes.dolibarr_routes import admin_router as dolibarr_admin_router, member_router as dolibarr_member_router, public_router as dolibarr_public_router
from routes.admission_routes import router as admission_router
from routes.invoice_routes import router as invoice_router
from routes.member_card_routes import router as member_card_router
from routes.finance_routes import router as finance_router
from routes.shop_admin_routes import router as shop_admin_router
from routes.shop_design_routes import router as shop_design_router
from routes.shop_product_routes import router as shop_product_router
from routes.shop_gamertag_routes import router as shop_gamertag_router
from routes.shop_print_file_routes import router as shop_print_file_router
from routes.platform_link_routes import router as platform_link_router
from routes.discord_bot_routes import router as discord_bot_router
from routes.discord_forward_routes import router as discord_forward_router
from routes.discord_guild_routes import router as discord_guild_router
from routes.discord_design_routes import router as discord_design_router
from routes.upload_routes import router as upload_router
from routes.chat_attachment_routes import router as chat_attachment_router
from routes.match_proof_routes import router as match_proof_router
from routes.gallery_submission_routes import router as gallery_submission_router
from routes.sticker_routes import router as sticker_router
from routes.badge_routes import router as badge_router, admin_router as achievement_admin_router
from routes.phase_c_routes import router as phase_c_router
from routes.membership_invitation_routes import router as membership_invitation_router
from routes.phase_ef_routes import (
    streams_router, admin_streams_router,
    admin_emailt_router, admin_discord_router,
    seed_email_templates,
)
from routes.phase_fg_routes import (
    media_router, admin_media_router, nav_router, admin_nav_router, seo_router, seo_meta_router,
    seed_default_nav,
)
from routes.seo_render_routes import router as seo_render_router
from routes.penalty_routes import router as penalty_router, admin_router as penalty_admin_router
from routes.membership_routes import router as membership_router
from routes.jersey_number_routes import router as jersey_number_router
from routes.document_routes import router as document_router, account_router as account_document_router
from routes.home_routes import router as home_router
from routes.calendar_routes import router as calendar_router
from routes.seasons_routes import router as seasons_router
from routes.advent_routes import router as advent_router
from routes.easter_routes import router as easter_router
from routes.achievement_signal_routes import router as achievement_signal_router
from services import discord_embeds
from routes.prize_routes import router as prize_router
from routes.setup_routes import router as setup_router, sitemap_router
from routes.contact_board_routes import contact_router, board_router
from routes.spam_guard_routes import router as spam_guard_router
from routes.sponsoring_routes import router as sponsoring_router
from routes.search_routes import router as search_router
from routes.settings_routes import settings_router
from routes.season_routes import season_router
from routes.widget_routes import widget_router
from routes.dsgvo_routes import dsgvo_router
from routes.export_routes import pdf_router
from routes.audit_routes import audit_router
from services.image_variants import resolve_variant as resolve_image_variant
from services import ops_monitor, share_image_cache, svg_logo
from services.change_events import (
    change_event_stream,
    publish_api_change,
    visibility_scope_for_user,
)
from auth import get_optional_user
from services.csrf import (
    UNSAFE_METHODS,
    csrf_rejection_detail,
    normalize_origin,
)
from runtime_config import (
    resolve_app_environment,
    trusted_http_hosts,
    validate_runtime_environment,
)
from services.log_safe import SecretPathFilter
from services import shop_designs
from services import shop_gamertag
from services.body_limits import BodySizeLimit
from storage import PUBLIC_UPLOAD_DIR, UPLOAD_DIR, ensure_storage_directories


logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("tls-arena")
# Der persönliche Kalender-Link (#1189) trägt sein Token im Pfad - im Zugriffsprotokoll steht es nur gekürzt.
logging.getLogger("uvicorn.access").addFilter(SecretPathFilter())

app_env = resolve_app_environment()
is_production = app_env == "production"


def validate_runtime_env():
    return validate_runtime_environment()


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_runtime_env()
    ensure_wiring()  # Anmeldungen beim Import (#1420), siehe services/bootstrap.py
    ensure_storage_directories()
    logger.info("[THE LION SQUAD] Initializing indexes...")
    await init_indexes()
    from services.migrations import run_pending_migrations
    applied_migrations = await run_pending_migrations(get_db())
    for migration in applied_migrations:
        logger.info("[migration] Applied %s: %s", migration["version"], migration["name"])
    logger.info("[THE LION SQUAD] Seeding badge catalog...")
    await seed_badges()
    logger.info("[THE LION SQUAD] Seeding CMS pages + email templates...")
    await seed_email_templates()
    await seed_default_nav()
    # Phase 8: start background scheduler (mail queue + reminders + prize expiry)
    if os.environ.get("DISABLE_SCHEDULER", "").lower() != "true":
        try:
            from services.scheduler import start_scheduler
            start_scheduler()
        except Exception as exc:
            logger.warning(f"[scheduler] failed to start: {exc}")
    # Discord-Bot (#302): läuft im Backend, sobald Token und Schalter im Admin gesetzt sind. Job-Auswahl und
    # Versandsperre (#1609) prüft start_if_enabled selbst.
    if os.environ.get("DISABLE_SCHEDULER", "").lower() != "true":
        try:
            from services.discord_bot import bot as discord_bot
            await discord_bot.start_if_enabled()
        except Exception as exc:
            logger.warning(f"[discord-bot] failed to start: {exc}")
    logger.info("[THE LION SQUAD] Startup complete.")
    yield
    try:
        from services.discord_bot import bot as discord_bot
        await discord_bot.stop()
    except Exception:
        logger.warning("[shutdown] Discord-Bot nicht sauber gestoppt", exc_info=True)
    try:
        from services.scheduler import stop_scheduler
        stop_scheduler()
    except Exception:
        logger.warning("[shutdown] Planer nicht sauber gestoppt", exc_info=True)
    await close_client()


app = FastAPI(
    title="THE LION SQUAD eSports",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None if is_production else "/docs",
    redoc_url=None if is_production else "/redoc",
    openapi_url=None if is_production else "/openapi.json",
)


def _json_safe(value):
    """Nicht-endliche Zahlen (NaN, Infinity) gibt es in JSON nicht - in der Fehlerantwort stehen sie als Text."""
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


@app.exception_handler(RequestValidationError)
async def request_validation_error(_request: Request, exc: RequestValidationError):
    """Wie FastAPIs eigene Antwort (422 mit ``detail``), auch wenn die Anfrage NaN oder Infinity enthält (#1035):
    solche Werte stehen in der Antwort als Text."""
    return JSONResponse(status_code=422, content={"detail": _json_safe(jsonable_encoder(exc.errors()))})


# Logos als SVG (#1952): ein SVG nur in Logo-Feldern, die PNG-Fassung eines SVG-Logos bleibt beim Speichern das SVG.
app.add_middleware(svg_logo.SvgFieldGate)
# Druckdateien (#1708): das Limit greift am Eingang, bevor FastAPI das Formular in eine Zwischendatei liest.
# Motiv als Paar (#2084): zwei Dateien je Anfrage, je Datei dieselbe Grenze.
app.add_middleware(BodySizeLimit, limits={"/api/admin/shop/designs/upload": shop_designs.upload_body_limit,
                                          "/api/admin/shop/designs/upload-pair": shop_designs.pair_body_limit,
                                          "/api/admin/shop/designs/pair-check": shop_designs.pair_body_limit})
# Gamertag-Druckdatei (#1711): Vorschau, Testdatei und Regeln nehmen nur kleine Anfragen an.
app.add_middleware(BodySizeLimit, limits=shop_gamertag.body_limits())

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=list(trusted_http_hosts()),
    www_redirect=False,
)

# CORS: credentials require explicit trusted origins. Open wildcard CORS can be
# enabled only for short-lived local debugging via ALLOW_INSECURE_CORS=true.
cors_origins_env = os.environ.get("CORS_ORIGINS", "").strip()
allow_insecure_cors = os.environ.get("ALLOW_INSECURE_CORS", "").lower() == "true"
if cors_origins_env == "*" and not allow_insecure_cors:
    if is_production:
        raise RuntimeError("CORS_ORIGINS='*' is not allowed in production.")
    logger.warning("[security] Ignoring wildcard CORS_ORIGINS. Set ALLOW_INSECURE_CORS=true for local debugging.")
    cors_origins_env = ""
explicit_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip() and o.strip() != "*"]
frontend_url = os.environ.get("FRONTEND_URL", "").strip()
if frontend_url and frontend_url not in explicit_origins:
    explicit_origins.append(frontend_url)
for origin in list(explicit_origins):
    parsed = urlparse(origin)
    host = (parsed.hostname or "").lower()
    scheme = parsed.scheme or "https"
    if not host or host in {"localhost", "127.0.0.1"}:
        continue
    variants = [host[4:]] if host.startswith("www.") else [f"www.{host}"]
    for variant in variants:
        candidate = f"{scheme}://{variant}"
        if parsed.port:
            candidate += f":{parsed.port}"
        if candidate not in explicit_origins:
            explicit_origins.append(candidate)
if not explicit_origins and not allow_insecure_cors:
    explicit_origins.extend(["http://localhost:3000", "http://127.0.0.1:3000"])
trusted_browser_origins = frozenset(
    origin for value in explicit_origins if (origin := normalize_origin(value))
)

if explicit_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=explicit_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    if is_production:
        raise RuntimeError("CORS_ORIGINS must be explicit in production.")
    logger.warning("[security] ALLOW_INSECURE_CORS=true - accepting any origin with credentials.")
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=".*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


# Include all routers
app.include_router(auth_router)
app.include_router(passkey_router)
app.include_router(user_router)
app.include_router(award_router)
app.include_router(honour_router)
app.include_router(team_level_router)
app.include_router(team_router)
app.include_router(team_page_router)
app.include_router(team_day_router)
app.include_router(feedback_router)
app.include_router(feedback_admin_router)
app.include_router(helper_call_router)
app.include_router(share_router)
app.include_router(year_review_router)
app.include_router(year_review_admin_router)
app.include_router(profile_record_router)
app.include_router(message_router)
app.include_router(chat_router)
app.include_router(friend_router)
app.include_router(moderation_router)
app.include_router(game_router)
app.include_router(game_map_router)  # Map-Bibliothek je Spiel (#1616)
app.include_router(map_pool_router)  # Map-Pools je Wettbewerb (#1616)
app.include_router(game_server_router)
app.include_router(access_link_router)
app.include_router(admin_picker_router)
app.include_router(tv_router)
app.include_router(event_router)
app.include_router(event_lead_router)
app.include_router(event_display_router)
app.include_router(event_recap_router)
app.include_router(tournament_router)
app.include_router(event_program_router)
app.include_router(match_router)
app.include_router(f1_router)
app.include_router(station_router)
app.include_router(news_router)
app.include_router(reference_series_router)
# Externe Serien (#1741): je Paket ein eigener Router (Kalender, Zuordnung, Eintragen, Rechte, öffentlich).
app.include_router(reference_round_router)
app.include_router(reference_participant_router)
app.include_router(reference_result_router)
app.include_router(reference_result_image_router)  # Ergebnis-Bild auslesen (#1756)
app.include_router(reference_original_router)  # Original-Bilder des Veranstalters je Termin (#1933)
app.include_router(reference_staff_router)
app.include_router(reference_season_close_router)  # Saison abschließen (#1750)
app.include_router(reference_bundle_router)  # Referenzen bündeln (#1751)
app.include_router(reference_adjustment_router)  # Anpassungen ±Punkte je Saison (#1960)
app.include_router(reference_series_public_router)
app.include_router(reference_round_page_router)  # Ergebnistabelle je Runde, Statistik, Teamfarben (#1950)
app.include_router(reference_partner_router)  # Partner-Plattform anbinden: Turniertage als Entwurf holen (#1964)
app.include_router(reference_season_table_router)  # Saisontabelle einlesen: Runden als Entwurf nachtragen (#1928)
app.include_router(mobile_router)
app.include_router(admin_router)
app.include_router(ops_router)
app.include_router(dolibarr_admin_router)
app.include_router(dolibarr_public_router)
app.include_router(dolibarr_member_router)
app.include_router(admission_router)
app.include_router(invoice_router)
app.include_router(member_card_router)
app.include_router(finance_router)
app.include_router(shop_admin_router)  # Shop (#1704): nur Finanzen
app.include_router(shop_design_router)  # Designs und Druckdateien (#1708): nur Finanzen
app.include_router(shop_product_router)  # Produktverwaltung und Katalogabgleich (#1707, #1709): nur Finanzen
app.include_router(shop_gamertag_router)  # Gamertag-Druckdatei (#1711): nur Finanzen
app.include_router(shop_print_file_router)  # Druckdateien für Printful (#1708): bewusst öffentlich, Regel 3
app.include_router(platform_link_router)
app.include_router(discord_bot_router)
app.include_router(discord_guild_router)
app.include_router(discord_forward_router)
app.include_router(discord_design_router)
app.include_router(settings_router)
app.include_router(season_router)
app.include_router(widget_router)
app.include_router(dsgvo_router)
app.include_router(pdf_router)
app.include_router(audit_router)
app.include_router(upload_router)
app.include_router(chat_attachment_router)
app.include_router(match_proof_router)
app.include_router(gallery_submission_router)
app.include_router(sticker_router)
app.include_router(badge_router)
app.include_router(achievement_admin_router)
app.include_router(phase_c_router)
app.include_router(membership_invitation_router)
app.include_router(streams_router)
app.include_router(admin_streams_router)
app.include_router(admin_emailt_router)
app.include_router(admin_discord_router)
app.include_router(media_router)
app.include_router(admin_media_router)
app.include_router(nav_router)
app.include_router(admin_nav_router)
app.include_router(seo_router)
app.include_router(seo_meta_router)
app.include_router(seo_render_router)
app.include_router(jersey_number_router)  # vor membership_router: /api/membership/me/jersey-number (#2034)
app.include_router(membership_router)
app.include_router(document_router)
app.include_router(account_document_router)
app.include_router(home_router)
app.include_router(calendar_router)
app.include_router(seasons_router)
app.include_router(advent_router)
app.include_router(easter_router)
app.include_router(achievement_signal_router)
app.include_router(prize_router)
app.include_router(setup_router)
app.include_router(sitemap_router)
app.include_router(contact_router)
app.include_router(spam_guard_router)  # Spamschutz öffentlicher Formulare (#2067)
app.include_router(board_router)
app.include_router(sponsoring_router)
app.include_router(search_router)
app.include_router(penalty_router)
app.include_router(penalty_admin_router)

# Static uploads: only public media files are served directly. Documents are
# streamed through visibility-aware /api/documents/{id}/download.
from services.media_formats import PUBLIC_MEDIA_EXTS, PUBLIC_MEDIA_TYPES, VIDEO_MEDIA_EXTS
upload_dir = UPLOAD_DIR
public_upload_dir = PUBLIC_UPLOAD_DIR


def _iter_file_range(path: Path, start: int, end: int):
    with path.open("rb") as handle:
        handle.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = handle.read(min(1024 * 1024, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


@app.get("/api/static/uploads/{filename}")
async def public_upload(filename: str, request: Request, w: int | None = None):
    if "/" in filename or "\\" in filename or ".." in filename or filename.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid filename")
    suffix = Path(filename).suffix.lower()
    if suffix not in PUBLIC_MEDIA_EXTS:
        raise HTTPException(status_code=404, detail="File not found")
    for base in (public_upload_dir, upload_dir):
        path = base / filename
        if path.exists() and path.is_file():
            media_type = PUBLIC_MEDIA_TYPES.get(suffix) or "application/octet-stream"
            headers = {"Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff"}
            if suffix == ".svg":
                # Logos als SVG (#1952): wird die Datei direkt geöffnet, läuft darin nichts - nur Zeichnen und Stil.
                headers.update(svg_logo.SERVE_HEADERS)
            # Eine Rasterkachel ist rund 400 Pixel breit und bekam bisher das
            # gespeicherte Bild mit bis zu 4096 Pixeln. Die kleinere Fassung
            # entsteht beim ersten Abruf und liegt danach auf der Platte - so
            # wirkt das auch für alles, was längst hochgeladen ist.
            if w is not None:
                variant = resolve_image_variant(path, w)
                if variant is not None:
                    return FileResponse(variant, media_type="image/webp", headers=headers)
            range_header = request.headers.get("range", "")
            if suffix in VIDEO_MEDIA_EXTS and range_header.startswith("bytes="):
                size = path.stat().st_size
                raw_range = range_header.removeprefix("bytes=").split(",", 1)[0].strip()
                start_raw, _, end_raw = raw_range.partition("-")
                try:
                    start = int(start_raw) if start_raw else 0
                    end = int(end_raw) if end_raw else size - 1
                except ValueError:
                    raise HTTPException(status_code=416, detail="Invalid range")
                start = max(0, start)
                end = min(size - 1, end)
                if start > end or start >= size:
                    raise HTTPException(status_code=416, detail="Invalid range")
                headers.update({
                    "Content-Range": f"bytes {start}-{end}/{size}",
                    "Content-Length": str(end - start + 1),
                    "Content-Type": media_type,
                })
                return StreamingResponse(_iter_file_range(path, start, end), status_code=206, media_type=media_type, headers=headers)
            return FileResponse(path, media_type=media_type, headers=headers)
    # Bildprüfung (#415): liegt das Bild in der Quarantäne (Prüfung nötig oder entfernt), sagt es ein Platzhalter
    # statt 404 - ohne Cache, damit ein freigegebenes Bild sofort wieder erscheint (nginx: X-TLS-Placeholder).
    from services.media_scan import placeholder_for
    placeholder = await placeholder_for(get_db(), f"/api/static/uploads/{filename}")
    if placeholder:
        return Response(placeholder, media_type="image/png",
                        headers={"Cache-Control": "no-store", "X-TLS-Placeholder": "1", "X-Content-Type-Options": "nosniff"})
    raise HTTPException(status_code=404, detail="File not found")


@app.get("/uploads/{filename}")
async def legacy_public_upload(filename: str, request: Request, w: int | None = None):
    return await public_upload(filename, request, w=w)


CSRF_EXEMPT_PATHS = {
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/mobile/login",
    "/api/auth/mobile/register",
    "/api/auth/mobile/refresh",
    "/api/auth/mobile/logout",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/auth/passkeys/login/options",
    "/api/auth/passkeys/login/verify",
}


@app.middleware("http")
async def csrf_protection(request, call_next):
    rejection = csrf_rejection_detail(
        request,
        trusted_browser_origins,
        CSRF_EXEMPT_PATHS,
    )
    if rejection:
        return JSONResponse(status_code=403, content={"detail": rejection})
    return await call_next(request)


# Security headers middleware
@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    # Strengere Regel einer Route bleibt stehen: Adressen mit Schlüssel im Pfad (Kalender-Link #1189, Druckdateien
    # #1708) sagen „no-referrer“, sonst ginge der Schlüssel als Referer weiter.
    if "referrer-policy" not in response.headers:
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    # Sticker-Bilder des Startpakets ändern sich nie und stehen in jedem Chat
    # dutzendfach - die dürfen im Browser und in der App zwischengespeichert werden. Die Jahreszeiten-
    # Abfrage (#632) setzt ihre Cache-Regel selbst: eine Minute öffentlich, Vorschau ohne Cache. „Discord jetzt“ (#854)
    # steht im Footer jeder Seite und ist für alle gleich (nur Zahlen) - eine Minute öffentlich.
    if request.url.path.startswith("/api/") and not request.url.path.startswith(("/api/stickers/files/", "/api/seasonal/", "/api/home/discord")):
        if response.status_code == 200 and share_image_cache.is_public_share_image(request.url.path):
            # Teilen-Bilder (#1412): öffentlich und für alle gleich - fünf Minuten zwischenspeicherbar. Genau diese
            # Pfade und nur bei Erfolg; alles andere bleibt no-store, auch das private Bild des Jahresrückblicks.
            response.headers["Cache-Control"] = share_image_cache.CACHE_CONTROL
        elif request.url.path.startswith("/api/calendar") and response.headers.get("Cache-Control"):
            # Kalender (#1190, Codex-Prüfung #1460): die Route entscheidet selbst - öffentliche Liste, Feed und Dateien
            # kurz zwischenspeicherbar, alles Persönliche „private, no-store“. Ohne eigene Regel (Fehler) gilt no-store.
            pass
        elif request.url.path == "/api/mobile/app-version" and response.status_code == 200 and response.headers.get("Cache-Control"):
            # Update-Prüfung der App (#1002): ohne Anmeldung und für alle gleich - die Route erlaubt fünf Minuten
            # öffentlich. Fehler und 429 bleiben no-store.
            pass
        elif response.headers.get("Cache-Control") == "private, no-store" or is_private_friends_path(request.url.path):
            # Persönliche Antworten (Rückblick mit „Du warst dabei“, Freunde beim Event, #1187/#1188) sagen zusätzlich
            # „private“ - strenger als das bloße no-store, deshalb bleibt es stehen. Die Freunde-Pfade bekommen es immer,
            # auch bei einer Absage vor dem Handler (401 ohne Konto, Codex-Prüfung #1500).
            response.headers["Cache-Control"] = "private, no-store"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        else:
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
    return response


@app.middleware("http")
async def raster_logos_for_apps(request, call_next):
    """Logos als SVG (#1952): Die App kann noch kein SVG. Nur sie (``svg_logo.client_is_app``) und nur bei GET bekommt
    in JSON-Antworten die PNG-Fassung eines hochgeladenen SVG; Antworten auf Änderungen und alle anderen Abrufer
    bekommen die gespeicherte Adresse. Die PNG-Fassung liegt immer neben dem SVG (``<name>.png``)."""
    response = await call_next(request)
    path = request.url.path
    if (request.method != "GET" or not path.startswith("/api/") or path.startswith("/api/static/")
            or not svg_logo.client_is_app(request.headers)
            or not response.headers.get("content-type", "").startswith("application/json")):
        return response
    body = b"".join([chunk async for chunk in response.body_iterator])
    changed = svg_logo.raster_urls_in_bytes(body)
    rebuilt = Response(content=changed, status_code=response.status_code, background=response.background)
    rebuilt.raw_headers = [(key, value) for key, value in response.raw_headers if key.lower() != b"content-length"]
    rebuilt.headers["content-length"] = str(len(changed))
    return rebuilt


@app.middleware("http")
async def api_change_notifications(request, call_next):
    response = await call_next(request)
    if (
        request.method.upper() in UNSAFE_METHODS
        and request.url.path.startswith("/api/")
        and response.status_code < 400
    ):
        # Die Meldung nennt das Turnier (#1801) - nachgeschlagen meist aus dem Zwischenspeicher in change_events.
        await publish_api_change(request.method, request.url.path, response.status_code)
        # Live-Einbettungen (#569): Events, Turniere und Saisons ändern „Nächste Events“ und die Rangliste.
        path = request.url.path
        if path.startswith(("/api/events", "/api/tournaments", "/api/admin/events", "/api/admin/tournaments", "/api/f1")):
            discord_embeds.request_refresh("events")
        if path.startswith(("/api/seasons", "/api/tournaments", "/api/f1", "/api/matches")):
            discord_embeds.request_refresh("ranking")
    return response


# Betriebssicht (#233): unbehandelte Ausnahmen und 5xx-Antworten werden zu
# Fehlergruppen, Anfragen über der Schwelle zu Einträgen unter "Tempo". Die
# Aufzeichnung darf nie die Antwort verhindern - die Ausnahme wird nach dem
# Festhalten unverändert weitergereicht.
@app.middleware("http")
async def ops_monitoring(request, call_next):
    path = request.url.path
    if not path.startswith("/api/") or not ops_monitor.should_watch(path):
        return await call_next(request)
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as exc:
        await ops_monitor.record_exception(app, request, exc)
        raise
    duration_ms = (time.perf_counter() - started) * 1000
    if response.status_code >= 500:
        await ops_monitor.record_http_error(app, request, response.status_code)
    if duration_ms >= ops_monitor.SLOW_REQUEST_MS:
        await ops_monitor.record_slow_request(app, request, duration_ms, response.status_code)
    return response


@app.get("/api/")
async def root():
    return {"name": "THE LION SQUAD eSports", "version": "1.0.0", "status": "running"}


@app.get("/api/health")
async def health():
    return await readiness()


@app.get("/api/health/live")
async def liveness():
    return {"status": "ok", "service": "api"}


@app.get("/api/health/ready")
async def readiness():
    checks = {"database": False, "storage": False, "scheduler": False}
    try:
        checks["database"] = (await get_db().command("ping")).get("ok") == 1
    except Exception as exc:
        logger.warning("[health] database readiness failed: %s", exc)
    try:
        checks["storage"] = PUBLIC_UPLOAD_DIR.exists() and os.access(PUBLIC_UPLOAD_DIR, os.W_OK)
    except OSError:
        checks["storage"] = False
    scheduler_disabled = os.environ.get("DISABLE_SCHEDULER", "").lower() == "true"
    if scheduler_disabled:
        checks["scheduler"] = True
    else:
        try:
            from services.scheduler_state import get_scheduler_status
            checks["scheduler"] = bool(get_scheduler_status().get("running"))
        except Exception:
            checks["scheduler"] = False
    ready = all(checks.values())
    payload = {"status": "ok" if ready else "degraded", "checks": checks}
    return JSONResponse(payload, status_code=200 if ready else 503)


@app.get("/api/changes/stream")
async def changes_stream(request: Request, user: dict | None = Depends(get_optional_user)):
    return StreamingResponse(
        change_event_stream(request, visibility_scope_for_user(user), (user or {}).get("id")),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
