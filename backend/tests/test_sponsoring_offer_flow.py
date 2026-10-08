"""Sponsor werden (#1254): ohne gepflegte Inhalte nichts (die kleine Karte bleibt); die Redaktion pflegt Einleitung,
Zahlen, Stufen und Leistungen; gezählte Zahlen kommen von der Website selbst; die Mappe ist ein echtes PDF für alle."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from routes import sponsoring_routes  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(sponsoring_routes, "PRIVATE_DOC_DIR", tmp_path / "docs")
    instance, shutdown = make_flow()
    instance.docs = tmp_path / "docs"
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_without_content_the_page_keeps_the_small_card(flow):
    offer = (await flow.get("/api/sponsoring/offer")).json()
    assert offer == {"available": False, "intro": "", "numbers": [], "tiers": ["gold", "silver", "bronze"], "benefits": [], "pdf_url": ""}


@pytest.mark.asyncio
async def test_content_editors_save_tiers_benefits_and_numbers_counted_by_the_site(flow):
    now = now_utc()
    await flow.db.memberships.insert_many([{"id": f"m{i}", "user_id": f"u{i}", "member_status": "active"} for i in range(3)] + [{"id": "m9", "user_id": "u9", "member_status": "former"}])
    await flow.db.events.insert_many([
        {"id": "e1", "status": "completed", "visibility": "public", "start_date": (now - timedelta(days=40)).isoformat()},
        {"id": "e2", "status": "completed", "visibility": "public", "start_date": (now - timedelta(days=500)).isoformat()},
        {"id": "e3", "status": "completed", "visibility": "members", "start_date": (now - timedelta(days=10)).isoformat()},
        {"id": "e4", "status": "announced", "visibility": "public", "start_date": (now + timedelta(days=30)).isoformat()},
    ])
    await flow.db.discord_guilds.insert_one({"guild_id": "g1", "role": "main", "enabled": True, "name": "Lions", "member_count": 214})

    editor = await flow.add_user(role="club_admin", name="redaktion")
    flow.act_as(editor)
    saved = await flow.put("/api/sponsoring/offer/admin", json={
        "intro": " Mit eurer Hilfe bleiben Startgelder niedrig. ",
        "numbers": [{"value": "2.400", "label": "Besuche im Monat"}],
        "auto_numbers": ["discord", "members", "events_year", "unbekannt"],
        "tiers": ["bronze", "gold", "silver", "diamant"],
        "benefits": [{"label": "Logo auf TV und Beamer", "tiers": ["gold", "platinum"]}, {"label": "Logo im Laufband", "tiers": ["gold", "silver", "bronze"]}, {"label": " ", "tiers": ["gold"]}],
    })
    assert saved.status_code == 200, saved.text
    admin = saved.json()
    assert admin["tiers"] == ["gold", "silver", "bronze"] and admin["auto_numbers"] == ["members", "discord", "events_year"]
    assert admin["counted"] == {"members": 3, "discord": 214, "events_year": 1, "tournaments_year": 0}

    flow.act_as(None)
    offer = (await flow.get("/api/sponsoring/offer")).json()
    assert offer["available"] is True and offer["intro"] == "Mit eurer Hilfe bleiben Startgelder niedrig."
    assert offer["benefits"] == [{"label": "Logo auf TV und Beamer", "tiers": ["gold"]}, {"label": "Logo im Laufband", "tiers": ["gold", "silver", "bronze"]}]
    assert [(row["value"], row["label"]) for row in offer["numbers"]] == [("2.400", "Besuche im Monat"), ("3", "Mitglieder"), ("214", "im Discord"), ("1", "Events im letzten Jahr")]

    # Nur die Redaktion darf schreiben.
    flow.act_as(await flow.add_user(role="player"))
    reply = await flow.put("/api/sponsoring/offer/admin", json={"intro": "x"})
    assert reply.status_code == 403
    assert (await flow.get("/api/sponsoring/offer/admin")).status_code == 403


@pytest.mark.asyncio
async def test_the_sponsoring_pdf_is_a_real_pdf_for_everyone(flow):
    editor = await flow.add_user(role="club_admin", name="redaktion")
    flow.act_as(editor)
    reply = await flow.post("/api/sponsoring/offer/pdf", files={"file": ("mappe.pdf", b"kein pdf", "application/pdf")})
    assert reply.status_code == 400
    uploaded = await flow.post("/api/sponsoring/offer/pdf", files={"file": ("Mappe 2026.pdf", b"%PDF-1.7 mappe", "application/pdf")})
    assert uploaded.status_code == 200, uploaded.text
    first_key = uploaded.json()["pdf_key"]
    assert uploaded.json()["pdf_name"] == "Mappe 2026.pdf" and (flow.docs / first_key).exists()

    flow.act_as(None)
    assert (await flow.get("/api/sponsoring/offer")).json()["pdf_url"] == "/api/sponsoring/offer/pdf"
    pdf = await flow.get("/api/sponsoring/offer/pdf")
    assert pdf.status_code == 200 and pdf.content == b"%PDF-1.7 mappe" and pdf.headers["content-type"] == "application/pdf"
    assert pdf.headers["x-content-type-options"] == "nosniff" and pdf.headers["content-disposition"].startswith("inline")

    # Eine neue Mappe ersetzt die alte, Löschen nimmt sie weg.
    flow.act_as(editor)
    replaced = (await flow.post("/api/sponsoring/offer/pdf", files={"file": ("neu.pdf", b"%PDF-1.7 neu", "application/pdf")})).json()
    assert not (flow.docs / first_key).exists() and (flow.docs / replaced["pdf_key"]).exists()
    reply = await flow.delete("/api/sponsoring/offer/pdf")
    assert reply.json()["pdf_key"] == ""
    flow.act_as(None)
    assert (await flow.get("/api/sponsoring/offer/pdf")).status_code == 404
