"""Runs the real application against an in-memory MongoDB.

The gap this closes: everything that needs two people and stored data was
tested by nobody. The operator cannot play both sides of a result report in the
live system, and the unit tests replace the database with hand-written fakes -
which is how a fake that did not behave like MongoDB let real bugs through.

Here the routes, the dependencies and the database semantics are the real ones.
Only the storage engine is swapped for an in-memory one, so these tests need no
service, no container and no credentials, and run the same way on a laptop and
in CI.

What that does not cover: this is mongomock, not MongoDB. It behaves the same
for the operations the tournament code uses - documents, ``$set``, ``$push``,
``distinct``, upserts - but it is not the place to verify index behaviour,
transactions or aggregation pipelines.
"""
from __future__ import annotations

import contextlib
import os
import uuid

from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient


STAFF_ROLE = "superadmin"

# Was die Anwendung beim Import verlangt. Diese Werte gelten ausschließlich
# während des Imports und werden danach wieder entfernt: ein Test, der prüft,
# dass beim Lesen einer .env keine Geheimnisse in die Shell auslaufen, bekäme
# sonst diese hier zu sehen und schlüge fehl - zu Recht.
IMPORT_ENV = {
    "APP_ENV": "test",
    "JWT_SECRET": "flow-tests-secret-with-at-least-32-characters",
    "FRONTEND_URL": "http://localhost:3000",
    "CORS_ORIGINS": "http://localhost:3000",
    "MONGO_URL": "mongodb://127.0.0.1:27017",
    "DB_NAME": "tls_flow_tests",
    "DISABLE_SCHEDULER": "true",
    "SETTINGS_ENCRYPTION_KEY": "NQBHeGtQg5HYMo1HzvJtSQPN7X8YpJrZDvw-XMz0Bm8=",
    # Die Host-Prüfung der App bleibt aktiv - der Testhost wird angemeldet,
    # statt die Prüfung abzuschalten, damit sie mitgeprüft wird.
    "TRUSTED_HOSTS": "testserver",
}

_application = None


@contextlib.contextmanager
def _borrowed_environment(values: dict):
    """Lend the process these settings and take them back afterwards."""
    previous = dict(os.environ)
    os.environ.update(values)
    try:
        yield
    finally:
        os.environ.clear()
        os.environ.update(previous)


def load_application():
    """Import the application once, leaving no trace in the environment."""
    global _application
    if _application is None:
        with _borrowed_environment(IMPORT_ENV):
            import database
            import server
            from auth import get_current_user, get_optional_user

            _application = (database, server, get_current_user, get_optional_user)
    return _application


def new_id() -> str:
    return str(uuid.uuid4())


class Flow:
    """One test's application, database and current user."""

    def __init__(self, client: AsyncClient, db):
        self.client = client
        self.db = db
        self.user: dict | None = None

    # ------------------------------------------------ Wer gerade handelt
    async def add_user(self, *, role: str = "user", name: str | None = None) -> dict:
        """Create a user the way the routes expect to find one."""
        user = {
            "id": new_id(),
            "username": name or f"spieler-{new_id()[:8]}",
            "display_name": name or "Testspieler",
            "email": f"{new_id()[:8]}@example.test",
            "role": role,
            "is_active": True,
            # Der Adminbereich verlangt bestätigte Zwei-Faktor-Anmeldung.
            "mfa_enabled": True,
            "auth_mfa_verified": True,
            "privacy_policy_version": "2026-08-26",
        }
        await self.db.users.insert_one(dict(user))
        return user

    async def add_staff(self, name: str = "Turnierleitung") -> dict:
        return await self.add_user(role=STAFF_ROLE, name=name)

    def act_as(self, user: dict | None) -> None:
        self.user = user

    # ------------------------------------------------ Abkürzungen
    async def get(self, url, **kwargs):
        return await self.client.get(url, **kwargs)

    async def post(self, url, **kwargs):
        return await self.client.post(url, **kwargs)

    async def put(self, url, **kwargs):
        return await self.client.put(url, **kwargs)

    async def patch(self, url, **kwargs):
        return await self.client.patch(url, **kwargs)

    # ------------------------------------------------ Turnieraufbau
    async def create_tournament(self, **overrides) -> dict:
        """A tournament in the state the routes create it in.

        Written directly rather than through the create endpoint: that endpoint
        pulls in games, seasons and slugs, none of which these flows are about.
        """
        from services.competition_versions import new_competition_version_fields

        tournament = {
            "id": new_id(),
            "slug": f"turnier-{new_id()[:8]}",
            "title": "Testturnier",
            "format": "single_elim",
            "status": "registration_open",
            "visibility": "public",
            "max_participants": 4,
            "seeding_mode": "manual",
            "best_of": 1,
            "match_duration_minutes": 30,
            "team_mode": "solo",
            "result_entry_mode": "player_confirmed",
            **new_competition_version_fields(overrides.get("format") or "single_elim"),
            **overrides,
        }
        await self.db.tournaments.insert_one(dict(tournament))
        return tournament

    async def register(self, tournament: dict, user: dict, *, seed: int | None = None,
                       status: str = "approved") -> dict:
        registration = {
            "id": new_id(),
            "tournament_id": tournament["id"],
            "user_id": user["id"],
            "display_name": user.get("display_name"),
            "status": status,
            "seed": seed,
        }
        await self.db.tournament_registrations.insert_one(dict(registration))
        return registration

    async def with_participants(self, count: int, **tournament_fields) -> tuple[dict, list[dict], list[dict]]:
        """A tournament plus ``count`` approved participants, seeded 1..n."""
        tournament = await self.create_tournament(max_participants=count, **tournament_fields)
        users, registrations = [], []
        for index in range(1, count + 1):
            user = await self.add_user(name=f"Spieler {index}")
            users.append(user)
            registrations.append(await self.register(tournament, user, seed=index))
        return tournament, users, registrations

    async def start(self, tournament: dict) -> dict:
        """Put the tournament into the state that accepts results.

        The bracket is drawn while registration is open and results are only
        accepted once it runs - so a flow that plays matches has to cross that
        line, exactly as a real tournament does.
        """
        await self.db.tournaments.update_one(
            {"id": tournament["id"]}, {"$set": {"status": "live"}})
        tournament["status"] = "live"
        return tournament

    # ------------------------------------------------ Lesen
    async def matches(self, tournament: dict) -> list[dict]:
        return await self.db.matches_v2.find(
            {"tournament_id": tournament["id"]}, {"_id": 0}).to_list(500)

    async def match_for(self, tournament: dict, *registration_ids: str,
                        after_round: int = 0) -> dict | None:
        """The match those participants share, optionally in a later round."""
        wanted = set(registration_ids)
        for match in sorted(await self.matches(tournament), key=lambda m: m.get("round") or 0):
            if int(match.get("round") or 0) <= after_round:
                continue
            filled = {slot.get("registration_id") for slot in match.get("slots") or []}
            if wanted <= filled:
                return match
        return None

    async def reload(self, match: dict) -> dict:
        return await self.db.matches_v2.find_one({"id": match["id"]}, {"_id": 0})

    def registration_of(self, match: dict, index: int = 0) -> str | None:
        filled = [slot.get("registration_id") for slot in match.get("slots") or []
                  if slot.get("registration_id")]
        return filled[index] if index < len(filled) else None


def make_flow():
    """Build one isolated application, database and client.

    Returns the flow and a shutdown callable; the fixture owns the lifetime.
    """
    database, server, get_current_user, get_optional_user = load_application()

    db = AsyncMongoMockClient()["tls_flow_tests"]
    previous_db = database._db
    database._db = db

    transport = ASGITransport(app=server.app)
    client = AsyncClient(transport=transport, base_url="http://testserver")
    flow = Flow(client, db)

    async def current_user() -> dict:
        if flow.user is None:
            from fastapi import HTTPException
            raise HTTPException(status_code=401, detail="Nicht angemeldet")
        return flow.user

    async def optional_user() -> dict | None:
        return flow.user

    server.app.dependency_overrides[get_current_user] = current_user
    server.app.dependency_overrides[get_optional_user] = optional_user

    async def shutdown():
        await client.aclose()
        server.app.dependency_overrides.pop(get_current_user, None)
        server.app.dependency_overrides.pop(get_optional_user, None)
        database._db = previous_db

    return flow, shutdown
