"""THE LION SQUAD eSports - FastAPI main entry."""
from dotenv import load_dotenv
from pathlib import Path
ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

import os
import logging
from urllib.parse import urlparse
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from contextlib import asynccontextmanager

from database import get_db, init_indexes, close_client
from badges import seed_badges
from routes.auth_routes import router as auth_router
from routes.user_routes import router as user_router
from routes.team_routes import router as team_router
from routes.team_level_routes import router as team_level_router
from routes.message_routes import router as message_router
from routes.friend_routes import router as friend_router
from routes.game_routes import router as game_router
from routes.game_server_routes import router as game_server_router
from routes.access_link_routes import router as access_link_router
from routes.event_routes import router as event_router
from routes.tournament_routes import router as tournament_router
from routes.match_routes import router as match_router
from routes.match_v2_routes import router as match_v2_router
from routes.f1_routes import router as f1_router
from routes.station_routes import router as station_router
from routes.news_routes import router as news_router
from routes.mobile_routes import router as mobile_router
from routes.admin_routes import router as admin_router
from routes.upload_routes import router as upload_router
from routes.badge_routes import router as badge_router, admin_router as achievement_admin_router
from routes.phase_c_routes import router as phase_c_router
from routes.phase_ef_routes import (
    streams_router, admin_streams_router,
    pages_router, admin_pages_router, admin_emailt_router, admin_discord_router,
    seed_default_pages, seed_email_templates,
)
from routes.phase_fg_routes import (
    media_router, admin_media_router, nav_router, admin_nav_router, seo_router, seo_meta_router,
    seed_default_nav,
)
from routes.seo_render_routes import router as seo_render_router
from routes.penalty_routes import router as penalty_router, admin_router as penalty_admin_router
from routes.notification_routes import router as notification_router
from routes.membership_routes import router as membership_router
from routes.document_routes import router as document_router
from routes.home_routes import router as home_router
from routes.prize_routes import router as prize_router
from routes.setup_routes import router as setup_router, sitemap_router
from routes.contact_board_routes import contact_router, board_router
from routes.search_routes import router as search_router
from routes.extras_routes import (
    settings_router, season_router, widget_router, dsgvo_router, pdf_router, audit_router,
)
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
from storage import PUBLIC_UPLOAD_DIR, UPLOAD_DIR, ensure_storage_directories


logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("tls-arena")

app_env = resolve_app_environment()
is_production = app_env == "production"


def validate_runtime_env():
    return validate_runtime_environment()


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_runtime_env()
    ensure_storage_directories()
    logger.info("[THE LION SQUAD] Initializing indexes...")
    await init_indexes()
    logger.info("[THE LION SQUAD] Seeding badge catalog...")
    await seed_badges()
    logger.info("[THE LION SQUAD] Seeding CMS pages + email templates...")
    await seed_default_pages()
    await seed_email_templates()
    await seed_default_nav()
    # Phase 8: start background scheduler (mail queue + reminders + prize expiry)
    if os.environ.get("DISABLE_SCHEDULER", "").lower() != "true":
        try:
            from services.scheduler import start_scheduler
            start_scheduler()
        except Exception as exc:
            logger.warning(f"[scheduler] failed to start: {exc}")
    logger.info("[THE LION SQUAD] Startup complete.")
    yield
    try:
        from services.scheduler import stop_scheduler
        stop_scheduler()
    except Exception:
        pass
    await close_client()


app = FastAPI(
    title="THE LION SQUAD eSports",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None if is_production else "/docs",
    redoc_url=None if is_production else "/redoc",
    openapi_url=None if is_production else "/openapi.json",
)
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
app.include_router(user_router)
app.include_router(team_level_router)
app.include_router(team_router)
app.include_router(message_router)
app.include_router(friend_router)
app.include_router(game_router)
app.include_router(game_server_router)
app.include_router(access_link_router)
app.include_router(event_router)
app.include_router(tournament_router)
app.include_router(match_router)
app.include_router(match_v2_router)
app.include_router(f1_router)
app.include_router(station_router)
app.include_router(news_router)
app.include_router(mobile_router)
app.include_router(admin_router)
app.include_router(settings_router)
app.include_router(season_router)
app.include_router(widget_router)
app.include_router(dsgvo_router)
app.include_router(pdf_router)
app.include_router(audit_router)
app.include_router(upload_router)
app.include_router(badge_router)
app.include_router(achievement_admin_router)
app.include_router(phase_c_router)
app.include_router(streams_router)
app.include_router(admin_streams_router)
app.include_router(pages_router)
app.include_router(admin_pages_router)
app.include_router(admin_emailt_router)
app.include_router(admin_discord_router)
app.include_router(media_router)
app.include_router(admin_media_router)
app.include_router(nav_router)
app.include_router(admin_nav_router)
app.include_router(seo_router)
app.include_router(seo_meta_router)
app.include_router(seo_render_router)
app.include_router(membership_router)
app.include_router(document_router)
app.include_router(home_router)
app.include_router(prize_router)
app.include_router(setup_router)
app.include_router(sitemap_router)
app.include_router(contact_router)
app.include_router(board_router)
app.include_router(search_router)
app.include_router(penalty_router)
app.include_router(penalty_admin_router)
app.include_router(notification_router)

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
async def public_upload(filename: str, request: Request):
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
    raise HTTPException(status_code=404, detail="File not found")


@app.get("/uploads/{filename}")
async def legacy_public_upload(filename: str, request: Request):
    return await public_upload(filename, request)


CSRF_EXEMPT_PATHS = {
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/mobile/login",
    "/api/auth/mobile/register",
    "/api/auth/mobile/refresh",
    "/api/auth/mobile/logout",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
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
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


@app.middleware("http")
async def api_change_notifications(request, call_next):
    response = await call_next(request)
    if (
        request.method.upper() in UNSAFE_METHODS
        and request.url.path.startswith("/api/")
        and response.status_code < 400
    ):
        await publish_api_change(request.method, request.url.path, response.status_code)
    return response


@app.get("/api/")
async def root():
    return {"name": "THE LION SQUAD eSports", "version": "1.0.0", "status": "running"}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/changes/stream")
async def changes_stream(request: Request, user: dict | None = Depends(get_optional_user)):
    return StreamingResponse(
        change_event_stream(request, visibility_scope_for_user(user)),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
