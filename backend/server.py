"""TLS ARENA - FastAPI main entry."""
from dotenv import load_dotenv
from pathlib import Path
ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

import os
import logging
from fastapi import FastAPI
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
    admin_media_router, nav_router, admin_nav_router, seo_router, seo_meta_router,
    seed_default_nav,
)
from routes.membership_routes import router as membership_router
from routes.document_routes import router as document_router
from routes.home_routes import router as home_router
from routes.prize_routes import router as prize_router
from routes.setup_routes import router as setup_router, sitemap_router
from routes.contact_board_routes import contact_router, board_router
from routes.extras_routes import (
    settings_router, season_router, widget_router, dsgvo_router, pdf_router, audit_router,
)


logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("tls-arena")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("[TLS ARENA] Initializing indexes...")
    await init_indexes()
    # One-time wipe for the new club platform launch (set TLS_RESET=true once, then unset)
    if os.environ.get("TLS_RESET", "").lower() == "true":
        from database import get_db
        db = get_db()
        # Preserve nothing — clean slate. Admin will be re-seeded right after.
        for coll in [
            "users", "teams", "team_members", "games", "events", "tournaments",
            "tournament_registrations", "matches", "f1_challenges", "f1_tracks",
            "f1_lap_times", "stations", "news_posts", "sponsors", "seasons",
            "tournament_groups", "memberships", "member_benefits", "user_socials",
            "gallery_albums", "gallery_photos", "documents", "season_points",
            "audit_logs", "email_logs", "notifications", "password_reset_tokens",
            "login_attempts", "user_achievements", "achievements", "achievement_groups",
            "mail_jobs", "prize_pickups",
        ]:
            try:
                await db[coll].delete_many({})
                logger.info(f"[TLS RESET] Cleared collection: {coll}")
            except Exception as e:
                logger.warning(f"[TLS RESET] {coll}: {e}")
    logger.info("[TLS ARENA] Seeding admin...")
    await seed_admin()
    logger.info("[TLS ARENA] Seeding badge catalog...")
    await seed_badges()
    logger.info("[TLS ARENA] Seeding CMS pages + email templates...")
    await seed_default_pages()
    await seed_email_templates()
    await seed_default_nav()
    if os.environ.get("SEED_DEMO", "false").lower() == "true":
        logger.info("[TLS ARENA] Seeding demo data...")
        await seed_demo_data()
    # Phase 8: start background scheduler (mail queue + reminders + prize expiry)
    if os.environ.get("DISABLE_SCHEDULER", "").lower() != "true":
        try:
            from services.scheduler import start_scheduler
            start_scheduler()
        except Exception as exc:
            logger.warning(f"[scheduler] failed to start: {exc}")
    logger.info("[TLS ARENA] Startup complete.")
    yield
    try:
        from services.scheduler import stop_scheduler
        stop_scheduler()
    except Exception:
        pass
    await close_client()


app = FastAPI(title="TLS ARENA - THE LION SQUAD eSports", version="1.0.0", lifespan=lifespan)

# CORS - use regex to allow any origin WITH credentials (browsers reject '*' + credentials).
# Still honour an explicit FRONTEND_URL / CORS_ORIGINS list if provided (comma-separated).
cors_origins_env = os.environ.get("CORS_ORIGINS", "*").strip()
explicit_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip() and o.strip() != "*"]
frontend_url = os.environ.get("FRONTEND_URL", "").strip()
if frontend_url and frontend_url not in explicit_origins:
    explicit_origins.append(frontend_url)

if explicit_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=explicit_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    # No explicit origins - open to any but still support credentials via regex
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

# Static uploads (serve user-uploaded images through /api prefix to survive ingress)
from fastapi.staticfiles import StaticFiles
import pathlib
upload_dir = pathlib.Path("/app/backend/uploads")
upload_dir.mkdir(parents=True, exist_ok=True)
app.mount("/api/static/uploads", StaticFiles(directory=str(upload_dir)), name="uploads")


# Security headers middleware
@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


@app.get("/api/")
async def root():
    return {"name": "TLS ARENA", "version": "1.0.0", "status": "running"}


@app.get("/api/health")
async def health():
    return {"status": "ok"}
