"""Was im Mitgliederbereich offen ist (#1257): eine Antwort für die Sprungleiste im Mitgliederbereich und die Kacheln auf
/verein und im Tab „Verein“ der App. Je Mitglied: unbeantwortete Versammlungen plus offene Abstimmungen, freie Plätze bei
Helferdiensten, interne News der letzten zwei Wochen, die die Person sehen darf, und die Vereinsdokumente ohne persönliche
Schreiben (#1255). Fällt Dolibarr aus, stehen dort Nullen - die Seite scheitert nie daran."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member, pin_club_clock  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import dolibarr_client, dolibarr_identity  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch):
    instance = FakeDolibarr()
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    dolibarr_identity.reset_cache()
    # Die Termine der Testdaten sind fest - also steht auch die Uhr des Vereins fest (25.09.2026).
    pin_club_clock(monkeypatch)
    return instance


async def connect(flow):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": "live", "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1, "type_map": {"2": "ordinary"},
    }}, upsert=True)


def seed_club(fake: FakeDolibarr) -> None:
    fake.add(member(12), email="mira@example.test")
    fake.add(member(13), email="ole@example.test")
    fake.add_meeting(7, invited=[(12, True), (13, True)])
    fake.add_meeting(8, kind="board", title="Vorstandssitzung Oktober", day="2026-10-01", format="virtual", invited=[(99, True)])
    fake.add_meeting(9, title="Generalversammlung 2025", day="2025-10-20", invited=[(12, True)])  # vorbei - zählt nicht
    fake.add_ballot(3, 7)  # angekündigt; Stimmrechte aus der Einladung
    fake.add_event(5, label="Sommerfest 2026", day="2026-10-10", shifts=[
        {"id": 51, "label": "Aufbau", "day": "2026-10-10", "start": "14:00", "end": "16:00", "capacity": 2},
        {"id": 52, "label": "Bar", "day": "2026-10-10", "start": "15:00", "end": "20:00", "capacity": 4},
    ])
    fake.statutes_public = False  # die Fassungen der Statuten zählen sonst als Vereinsdokumente mit
    fake.publish(21, title="Protokoll Generalversammlung", audience="members", date="2020-03-02T18:00:00+00:00")  # alt - nicht neu
    fake.publish(22, title="Beitragsbestätigung Mira", kind="letter", audience="person", member_id=12)


async def seed_website(flow) -> None:
    now = now_utc()
    posts = [
        ("n-neu", "members", now - timedelta(days=3)),       # zählt
        ("n-alt", "members", now - timedelta(days=30)),      # zu alt
        ("n-offen", "public", now - timedelta(days=1)),      # öffentlich - keine interne News
        ("n-vorstand", "internal", now - timedelta(days=2)), # nur für die Vereinsverwaltung
        ("n-geplant", "members", now + timedelta(days=2)),   # noch nicht erschienen
    ]
    for post_id, visibility, moment in posts:
        await flow.db.news_posts.insert_one({"id": post_id, "title": post_id, "slug": post_id, "published": True, "visibility": visibility,
                                             "published_at": moment.isoformat(), "created_at": moment.isoformat()})
    await flow.db.news_posts.insert_one({"id": "n-entwurf", "title": "Entwurf", "slug": "entwurf", "published": False, "visibility": "members",
                                         "created_at": now.isoformat()})
    for doc_id, visibility in (("d-statuten", "members"), ("d-kasse", "internal")):
        await flow.db.documents.insert_one({"id": doc_id, "title": doc_id, "visibility": visibility, "category": "other", "created_at": now.isoformat()})


async def bind(flow, code: str) -> None:
    response = await flow.post("/api/membership/me/identity", json={"code": code})
    assert response.status_code == 200 and response.json()["status"] == "bound", response.text


@pytest.mark.asyncio
async def test_summary_counts_what_is_open_for_each_member(flow, fake):
    await connect(flow)
    seed_club(fake)
    await seed_website(flow)
    mira = await flow.add_user(role="player", name="mira")
    mira["is_club_member"] = True
    flow.act_as(mira)

    # Ohne Weg zur Akte: nur, was die Website selbst weiß - interne News und ihre Vereinsdokumente.
    summary = (await flow.get("/api/membership/area-summary")).json()
    assert summary == {"meetings_open": 0, "ballots_open": 0, "next_meeting": None, "helping_free": 0, "helping_mine": 0,
                       "news_new": 1, "documents": 1, "documents_new": 1}

    fake.invite("ALL", 12, capabilities=("documents", "meetings", "votes", "events"))
    await bind(flow, "ALL")
    summary = (await flow.get("/api/membership/area-summary")).json()
    assert summary["meetings_open"] == 1 and summary["ballots_open"] == 0, "angekündigte Abstimmung ist noch nicht offen"
    nxt = summary["next_meeting"]
    assert nxt["id"] == 7 and nxt["title"] == "Generalversammlung 2026" and nxt["day"] == "2026-10-24" and nxt["time"] == "18:00"
    assert nxt["response"] == "" and nxt["can_respond"] is True and nxt["kind_label"] == "Generalversammlung"
    assert summary["helping_free"] == 6 and summary["helping_mine"] == 0
    # Die Vereinsdokumente: das der Website und das Protokoll aus der Akte - die eigene Beitragsbestätigung nicht.
    assert summary["documents"] == 2 and summary["documents_new"] == 1, "das Protokoll ist alt"
    club = (await flow.get("/api/documents", params={"scope": "club"})).json()
    assert {doc["title"] for doc in club} == {"d-statuten", "Protokoll Generalversammlung"}
    mixed = (await flow.get("/api/documents")).json()
    assert "Beitragsbestätigung Mira" in {doc["title"] for doc in mixed}, "ohne scope wie bisher (ältere App-Versionen)"

    # Zusage in der Karte: danach ist nichts mehr offen; eine offene Abstimmung zählt mit.
    assert (await flow.put("/api/membership/me/meetings/7/response", json={"response": "yes"})).status_code == 200
    fake.set_ballot_status(3, "open")
    summary = (await flow.get("/api/membership/area-summary")).json()
    assert summary["meetings_open"] == 1 and summary["ballots_open"] == 1
    assert summary["next_meeting"]["response"] == "yes" and summary["next_meeting"]["response_label"] == "zugesagt"

    # Einen Dienst übernommen: frei zählt, was die Person noch übernehmen kann - der eigene Dienst nicht mehr.
    assert (await flow.put("/api/membership/me/events/5/shifts/52")).status_code == 200
    summary = (await flow.get("/api/membership/area-summary")).json()
    assert summary["helping_free"] == 2 and summary["helping_mine"] == 1


@pytest.mark.asyncio
async def test_summary_is_for_members_and_survives_a_dolibarr_outage(flow, fake):
    await connect(flow)
    seed_club(fake)
    await seed_website(flow)

    guest = await flow.add_user(role="player", name="gast")
    flow.act_as(guest)
    assert (await flow.get("/api/membership/area-summary")).status_code == 403

    # Die Vereinsverwaltung sieht auch die interne News und das interne Dokument.
    board = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(board)
    summary = (await flow.get("/api/membership/area-summary")).json()
    assert summary["news_new"] == 2 and summary["documents"] == 2

    mira = await flow.add_user(role="player", name="mira")
    mira["is_club_member"] = True
    flow.act_as(mira)
    fake.invite("ALL", 12, capabilities=("documents", "meetings", "votes", "events"))
    await bind(flow, "ALL")
    dolibarr_identity.reset_cache()
    fake.fail_with = 503
    summary = (await flow.get("/api/membership/area-summary"))
    assert summary.status_code == 200
    data = summary.json()
    assert data["meetings_open"] == 0 and data["next_meeting"] is None and data["helping_free"] == 0
    assert data["news_new"] == 1 and data["documents"] == 1, "was die Website selbst weiß, bleibt"
