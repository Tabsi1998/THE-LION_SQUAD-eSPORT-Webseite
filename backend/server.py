"""THE LION SQUAD eSports - FastAPI main entry."""
from dotenv import load_dotenv
from pathlib import Path
ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

import os
import logging
from urllib.parse import urlparse
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from database import get_db, init_indexes, close_client
from seed import seed_admin, seed_demo_data
from badges import seed_badges
from routes.auth_routes import router as auth_router
from routes.user_routes import router as user_router
from routes.team_routes import router as team_router
from routes.game_routes import router as game_router
from routes.event_routes import router as event_router
from routes.tournament_routes import router as tournament_router
from routes.match_routes import router as match_router
from routes.f1_routes import router as f1_router
from routes.station_routes import router as station_router
from routes.news_routes import router as news_router
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
from routes.penalty_routes import router as penalty_router, admin_router as penalty_admin_router
from routes.membership_routes import router as membership_router
from routes.document_routes import router as document_router
from routes.home_routes import router as home_router
from routes.prize_routes import router as prize_router
from routes.setup_routes import router as setup_router, sitemap_router
from routes.contact_board_routes import contact_router, board_router
from routes.extras_routes import (
    settings_router, season_router, widget_router, dsgvo_router, pdf_router, audit_router,
)
from services.change_events import change_event_stream, publish_api_change


logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("tls-arena")


def validate_runtime_env():
    if not is_production:
        return
    jwt_secret = os.environ.get("JWT_SECRET", "")
    if len(jwt_secret) < 32:
        raise RuntimeError("JWT_SECRET must be set to at least 32 characters in production.")
    if not os.environ.get("ADMIN_PASSWORD"):
        raise RuntimeError("ADMIN_PASSWORD must be set in production.")
    if not os.environ.get("FRONTEND_URL"):
        raise RuntimeError("FRONTEND_URL must be set in production.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_runtime_env()
    logger.info("[THE LION SQUAD] Initializing indexes...")
    await init_indexes()
    # One-time wipe for the new club platform launch (set TLS_RESET=true once, then unset)
    if os.environ.get("TLS_RESET", "").lower() == "true":
        from database import get_db
        db = get_db()
        # Preserve nothing — clean slate. Admin will be re-seeded right after.
        for coll in [
            "users", "teams", "team_members", "games", "events", "tournaments",
            "tournament_registrations", "matches", "f1_challenges", "f1_tracks",
            "f1_lap_times", "stations", "news_posts", "sponsors", "partners", "seasons",
            "tournament_groups", "memberships", "member_benefits", "user_socials",
            "gallery_albums", "gallery_photos", "documents", "season_points",
            "audit_logs", "email_logs", "notifications", "password_reset_tokens",
            "login_attempts", "user_achievements", "achievements", "achievement_groups",
            "mail_jobs", "media_uploads", "prize_pickups", "club_member_profiles",
        ]:
            try:
                await db[coll].delete_many({})
                logger.info(f"[TLS RESET] Cleared collection: {coll}")
            except Exception as e:
                logger.warning(f"[TLS RESET] {coll}: {e}")
    logger.info("[THE LION SQUAD] Seeding admin...")
    await seed_admin()
    logger.info("[THE LION SQUAD] Seeding badge catalog...")
    await seed_badges()
    logger.info("[THE LION SQUAD] Seeding CMS pages + email templates...")
    await seed_default_pages()
    await seed_email_templates()
    await seed_default_nav()
    if os.environ.get("SEED_DEMO", "false").lower() == "true":
        logger.info("[THE LION SQUAD] Seeding demo data...")
        await seed_demo_data()
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


app = FastAPI(title="THE LION SQUAD eSports", version="1.0.0", lifespan=lifespan)

# CORS: credentials require explicit trusted origins. Open wildcard CORS can be
# enabled only for short-lived local debugging via ALLOW_INSECURE_CORS=true.
app_env = os.environ.get("APP_ENV", os.environ.get("ENVIRONMENT", "development")).lower()
is_production = app_env in {"prod", "production"}
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
app.include_router(team_router)
app.include_router(game_router)
app.include_router(event_router)
app.include_router(tournament_router)
app.include_router(match_router)
app.include_router(f1_router)
app.include_router(station_router)
app.include_router(news_router)
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
app.include_router(membership_router)
app.include_router(document_router)
app.include_router(home_router)
app.include_router(prize_router)
app.include_router(setup_router)
app.include_router(sitemap_router)
app.include_router(contact_router)
app.include_router(board_router)
app.include_router(penalty_router)
app.include_router(penalty_admin_router)

# Static uploads: only public image files are served directly. Documents are
# streamed through visibility-aware /api/documents/{id}/download.
import pathlib
upload_dir = pathlib.Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
upload_dir.mkdir(parents=True, exist_ok=True)
public_upload_dir = upload_dir / "public"
public_upload_dir.mkdir(parents=True, exist_ok=True)
PUBLIC_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


@app.get("/api/static/uploads/{filename}")
async def public_upload(filename: str):
    if "/" in filename or "\\" in filename or ".." in filename or filename.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid filename")
    if pathlib.Path(filename).suffix.lower() not in PUBLIC_IMAGE_EXTS:
        raise HTTPException(status_code=404, detail="File not found")
    for base in (public_upload_dir, upload_dir):
        path = base / filename
        if path.exists() and path.is_file():
            return FileResponse(path)
    raise HTTPException(status_code=404, detail="File not found")


@app.get("/uploads/{filename}")
async def legacy_public_upload(filename: str):
    return await public_upload(filename)


UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
CSRF_EXEMPT_PATHS = {
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/refresh",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
}


@app.middleware("http")
async def csrf_protection(request, call_next):
    path = request.url.path
    has_auth_cookie = bool(request.cookies.get("access_token") or request.cookies.get("refresh_token"))
    if (
        request.method.upper() in UNSAFE_METHODS
        and path.startswith("/api/")
        and path not in CSRF_EXEMPT_PATHS
        and has_auth_cookie
    ):
        cookie_token = request.cookies.get("csrf_token")
        header_token = request.headers.get("x-csrf-token")
        if not cookie_token or not header_token or cookie_token != header_token:
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF token missing or invalid"},
            )
    return await call_next(request)


# Security headers middleware
@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
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
async def changes_stream(request: Request):
    return StreamingResponse(
        change_event_stream(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
