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


logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("tls-arena")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("[TLS ARENA] Initializing indexes...")
    await init_indexes()
    logger.info("[TLS ARENA] Seeding admin...")
    await seed_admin()
    if os.environ.get("SEED_DEMO", "true").lower() == "true":
        logger.info("[TLS ARENA] Seeding demo data...")
        await seed_demo_data()
    logger.info("[TLS ARENA] Startup complete.")
    yield
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


@app.get("/api/")
async def root():
    return {"name": "TLS ARENA", "version": "1.0.0", "status": "running"}


@app.get("/api/health")
async def health():
    return {"status": "ok"}
