"""Passwort zurücksetzen (#1031): ein Link gilt genau einmal, nur kurz und nur, solange er der neueste ist.

Geprüft über die echten Routen gegen die Datenbank im Speicher. Erfundene Konten, keine echten Personen."""
import asyncio
import functools
import pathlib
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import InterleavedReads, make_flow, new_id  # noqa: E402

from auth import hash_token  # noqa: E402

NEW_PASSWORD = "neues-testpasswort-eins"
OTHER_PASSWORD = "anderes-testpasswort-zwei"


class DbWith:
    """Die Datenbank der Flow-Tests - nur bei einer Sammlung ist eine Methode ausgetauscht."""

    def __init__(self, db, collection: str, **methods):
        self._db = db
        self._collection = collection
        self._methods = methods

    def __getattr__(self, name):
        target = getattr(self._db, name)
        return _CollectionWith(target, self._methods) if name == self._collection else target

    def __getitem__(self, name):
        return self.__getattr__(name)


class _CollectionWith:
    def __init__(self, collection, methods: dict):
        self._collection = collection
        self._methods = methods

    def __getattr__(self, name):
        if name in self._methods:
            return functools.partial(self._methods[name], self._collection)
        return getattr(self._collection, name)


@pytest_asyncio.fixture
async def flow(monkeypatch):
    # Formular-Token und Zähler des Spamschutzes (#2067) brauchen das Server-Geheimnis.
    monkeypatch.setenv("JWT_SECRET", "spam-guard-aware-tests-secret-with-32-characters")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def sent_links(monkeypatch):
    """Statt einer Mail: der Link landet in dieser Liste."""
    import routes.auth_routes as auth_routes

    links = []

    async def fake_send(template, to, **kwargs):
        links.append(kwargs.get("reset_url", ""))
        return {"ok": True}

    monkeypatch.setattr(auth_routes, "send_template", fake_send)
    return links


def token_of(link: str) -> str:
    return link.split("token=", 1)[1].split("&", 1)[0]


async def account(flow) -> dict:
    user = await flow.add_user(name=f"loewe-{new_id()[:6]}")
    email = f"{user['username']}@example.com"
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"email": email}})
    flow.act_as(None)
    return {**user, "email": email}


async def request_link(flow, user: dict, links: list) -> str:
    response = await flow.post("/api/auth/forgot-password", json={"email": user["email"]})
    assert response.status_code == 200
    return token_of(links[-1])


async def reset(flow, token: str, password: str = NEW_PASSWORD):
    return await flow.post("/api/auth/reset-password", json={"token": token, "new_password": password})


@pytest.mark.asyncio
async def test_link_is_stored_only_as_a_hash(flow, sent_links):
    user = await account(flow)
    token = await request_link(flow, user, sent_links)

    rows = await flow.db.password_reset_tokens.find({"user_id": user["id"]}).to_list(10)
    assert len(rows) == 1
    assert rows[0]["token_hash"] == hash_token(token)
    assert token not in {str(value) for value in rows[0].values()}
    expires = rows[0]["expires_at"].replace(tzinfo=timezone.utc)
    assert expires <= datetime.now(timezone.utc) + timedelta(hours=1), "kurzlebig: höchstens eine Stunde"


@pytest.mark.asyncio
async def test_link_sets_the_password_exactly_once(flow, sent_links):
    user = await account(flow)
    token = await request_link(flow, user, sent_links)

    first = await reset(flow, token)
    second = await reset(flow, token, OTHER_PASSWORD)

    assert first.status_code == 200
    assert second.status_code == 400


@pytest.mark.asyncio
async def test_two_simultaneous_resets_with_one_link_only_one_wins(flow, sent_links, monkeypatch):
    import routes.auth_routes as auth_routes

    user = await account(flow)
    token = await request_link(flow, user, sent_links)
    gate = InterleavedReads(flow.db, "password_reset_tokens")
    monkeypatch.setattr(auth_routes, "get_db", lambda: gate)

    responses = await asyncio.gather(reset(flow, token), reset(flow, token, OTHER_PASSWORD))

    assert sorted(response.status_code for response in responses) == [200, 400]


@pytest.mark.asyncio
async def test_a_link_that_expires_during_the_request_sets_no_password(flow, sent_links, monkeypatch):
    import routes.auth_routes as auth_routes

    user = await account(flow)
    token = await request_link(flow, user, sent_links)

    async def read_then_expire(collection, *args, **kwargs):
        document = await collection.find_one(*args, **kwargs)
        if document:
            await collection.update_one(
                {"id": document["id"]}, {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)}},
            )
        return document

    expiring = DbWith(flow.db, "password_reset_tokens", find_one=read_then_expire)
    monkeypatch.setattr(auth_routes, "get_db", lambda: expiring)

    assert (await reset(flow, token)).status_code == 400
    assert "password_hash" not in await flow.db.users.find_one({"id": user["id"]})


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["raises", "matches_nothing"])
async def test_a_link_stays_usable_when_setting_the_password_fails(flow, sent_links, monkeypatch, failure):
    import routes.auth_routes as auth_routes

    user = await account(flow)
    token = await request_link(flow, user, sent_links)

    async def failing_update(collection, *args, **kwargs):
        if failure == "raises":
            raise RuntimeError("Datenbank kurz nicht erreichbar")
        return SimpleNamespace(matched_count=0, modified_count=0)

    monkeypatch.setattr(auth_routes, "get_db", lambda: DbWith(flow.db, "users", update_one=failing_update))
    try:
        broken = await reset(flow, token)
    except RuntimeError:
        broken = None
    assert broken is None or broken.status_code >= 400

    monkeypatch.setattr(auth_routes, "get_db", lambda: flow.db)
    assert (await reset(flow, token)).status_code == 200


@pytest.mark.asyncio
async def test_a_newer_link_replaces_the_older_one(flow, sent_links):
    user = await account(flow)
    older = await request_link(flow, user, sent_links)
    newer = await request_link(flow, user, sent_links)

    assert (await reset(flow, older)).status_code == 400
    assert (await reset(flow, newer)).status_code == 200


@pytest.mark.asyncio
async def test_a_successful_reset_also_retires_an_open_invitation(flow, sent_links):
    user = await account(flow)
    invite = "einladung-" + new_id()
    await flow.db.password_reset_tokens.insert_one({
        "id": new_id(), "token_hash": hash_token(invite), "user_id": user["id"], "purpose": "admin_invite",
        "used": False, "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    })
    token = await request_link(flow, user, sent_links)

    assert (await reset(flow, token)).status_code == 200
    late = await flow.post("/api/auth/reset-password", json={
        "token": invite, "new_password": OTHER_PASSWORD, "accept_privacy": True, "accept_terms": True,
    })
    assert late.status_code == 400


@pytest.mark.asyncio
async def test_an_expired_link_is_rejected(flow, sent_links):
    user = await account(flow)
    token = await request_link(flow, user, sent_links)
    await flow.db.password_reset_tokens.update_many(
        {"user_id": user["id"]}, {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)}},
    )

    assert (await reset(flow, token)).status_code == 400


@pytest.mark.asyncio
async def test_a_reset_ends_every_existing_session(flow, sent_links):
    user = await account(flow)
    for collection in (flow.db.auth_sessions, flow.db.refresh_tokens):
        await collection.insert_one({"id": new_id(), "user_id": user["id"], "family_id": new_id(), "revoked": False})
    token = await request_link(flow, user, sent_links)

    assert (await reset(flow, token)).status_code == 200

    assert await flow.db.auth_sessions.count_documents({"user_id": user["id"], "revoked": {"$ne": True}}) == 0
    assert await flow.db.refresh_tokens.count_documents({"user_id": user["id"], "revoked": {"$ne": True}}) == 0


@pytest.mark.asyncio
async def test_unknown_address_gets_the_same_answer_and_no_mail(flow, sent_links):
    user = await account(flow)

    known = await flow.post("/api/auth/forgot-password", json={"email": user["email"]})
    unknown = await flow.post("/api/auth/forgot-password", json={"email": "niemand@example.com"})

    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()
    assert len(sent_links) == 1


def test_nginx_keeps_one_time_links_out_of_the_access_log():
    nginx = (pathlib.Path(__file__).resolve().parents[2] / "frontend" / "nginx.conf").read_text(encoding="utf-8")
    start = nginx.index("map $request_uri $tls_loggable_request")
    block = nginx[start:nginx.index("}", start)]
    assert '"~*[?&]token=" 0;' in block and "default 1;" in block
    server = nginx[nginx.index("server {"):]
    assert "access_log /var/log/nginx/access.log main if=$tls_loggable_request;" in server
