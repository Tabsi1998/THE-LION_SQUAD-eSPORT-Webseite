"""Sponsoren und Partner aus Dolibarr (#405): Kategorie „Sponsor“ mit Unterkategorien als Stufe,
„Partner“ mit Unterkategorien als Art; der Schalter liest sofort nach, übernimmt Handeinträge mit
demselben Namen (Logo bleibt), sperrt die Dolibarr-Felder im Admin, lässt Website-Felder frei; wer
aus der Kategorie fällt, wird zum ehemaligen Unterstützer; ein Ausfall lässt den Stand stehen;
öffentlich kommen nie Kontaktdaten oder Notizen heraus."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import daily_center, dolibarr_client, dolibarr_sponsors  # noqa: E402
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
    return instance


async def connect(flow, mode="live"):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": mode, "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY), "instance": "verein", "entity": 1,
    }}, upsert=True)


def seed_categories(fake):
    sponsor = fake.add_category("Sponsor")
    gold = fake.add_category("Gold", parent=int(sponsor["id"]))
    main = fake.add_category("Hauptsponsor", parent=int(sponsor["id"]))
    partner = fake.add_category("Partner")
    verein = fake.add_category("Verein", parent=int(partner["id"]))
    fake.add_category("Lieferanten", kind="supplier")
    return {"sponsor": int(sponsor["id"]), "gold": int(gold["id"]), "main": int(main["id"]), "partner": int(partner["id"]), "verein": int(verein["id"])}


def test_plan_maps_tiers_kinds_dates_and_closed_companies():
    fake = FakeDolibarr()
    ids = seed_categories(fake)
    alpha = fake.add_thirdparty("Alpha Energy", "office@alpha.test", url="https://alpha.test", phone="+43 1 234",
                                array_options={"options_sponsor_start": "2024-01-01", "options_sponsor_end": "2026-12-31 00:00:00"})
    beta = fake.add_thirdparty("Beta GmbH", status="0")
    gamma = fake.add_thirdparty("Gamma Verein", url="https://gamma.test")
    rows = {
        ids["sponsor"]: [{**alpha, "id": str(alpha["id"])}, {**beta, "id": str(beta["id"])}],
        ids["gold"]: [{**alpha, "id": str(alpha["id"])}],
        ids["partner"]: [{**gamma, "id": str(gamma["id"])}],
        ids["verein"]: [{**gamma, "id": str(gamma["id"])}],
    }
    planned = dolibarr_sponsors.plan(fake.categories, rows, dolibarr_sponsors.normalize_settings({}))
    assert planned["categories"] == {"sponsor": {"label": "Sponsor", "found": True, "sub": ["Gold", "Hauptsponsor"]},
                                     "partner": {"label": "Partner", "found": True, "sub": ["Verein"]}}
    assert planned["sponsors"][alpha["id"]] == {
        "dolibarr_id": alpha["id"], "name": "Alpha Energy", "kind": "sponsor", "link": "https://alpha.test", "email": "office@alpha.test", "phone": "+43 1 234",
        "closed": False, "tier": "gold", "partner_kind": None, "contract_start": "2024-01-01", "contract_end": "2026-12-31",
    }
    assert planned["sponsors"][beta["id"]]["closed"] is True and planned["sponsors"][beta["id"]]["tier"] is None
    assert planned["partners"][gamma["id"]]["partner_kind"] == "Verein" and planned["partners"][gamma["id"]]["link"] == "https://gamma.test"
    # Unbekannte Kategorienamen: nichts gefunden, nichts geplant - und Unix-Sekunden als Datum.
    empty = dolibarr_sponsors.plan(fake.categories, rows, dolibarr_sponsors.normalize_settings({"sponsor_category": "Gönner", "partner_category": "Freunde"}))
    assert empty["sponsors"] == {} and empty["categories"]["sponsor"] == {"label": "Gönner", "found": False, "sub": []}
    assert dolibarr_sponsors.company_from_row({"id": "7", "name": "X", "array_options": {"options_sponsor_end": "1767139200"}}, kind="sponsor", sub_label=None)["contract_end"] == "2025-12-31"


@pytest.mark.asyncio
async def test_switch_reads_dolibarr_into_the_lists_locks_its_fields_and_keeps_website_fields(flow, fake):
    await connect(flow)
    ids = seed_categories(fake)
    alpha = fake.add_thirdparty("Alpha Energy", "office@alpha.test", url="https://alpha.test", array_options={"options_sponsor_start": "2024-01-01", "options_sponsor_end": "2026-12-31"})
    beta = fake.add_thirdparty("Beta GmbH")
    delta = fake.add_thirdparty("Delta Bank", array_options={"options_sponsor_end": "2025-06-30"})
    gamma = fake.add_thirdparty("Gamma Verein", url="https://gamma.test")
    fake.categorize(alpha["id"], ids["sponsor"], ids["gold"])
    fake.categorize(beta["id"], ids["sponsor"])
    fake.categorize(delta["id"], ids["sponsor"])
    fake.categorize(gamma["id"], ids["partner"], ids["verein"])
    # Von Hand gepflegt, mit Logo: wird übernommen statt verdoppelt.
    await flow.db.sponsors.insert_one({"id": "s-alpha", "name": "alpha energy", "tier": "silver", "logo_url": "/uploads/alpha.png", "description": "Handtext", "is_active": True, "internal_notes": "geheim"})
    await flow.db.sponsors.insert_one({"id": "s-delta", "name": "Delta Bank", "tier": "bronze", "logo_url": "/uploads/delta.png", "is_active": True})

    admin = await flow.add_user(role="club_admin")
    flow.act_as(admin)
    view = (await flow.get("/api/admin/dolibarr/sponsors")).json()
    assert view["from_dolibarr"] is False and view["connected"] is True and view["counts"] == {"sponsors": 0, "partners": 0}
    assert view["sponsor_category"] == "Sponsor" and view["partner_category"] == "Partner"

    switched = await flow.patch("/api/admin/dolibarr/sponsors", json={"from_dolibarr": True})
    assert switched.status_code == 200, switched.text
    result = switched.json()["result"]
    assert result["ok"] is True and result["sponsors"] == {"created": 1, "updated": 2, "gone": 0, "total": 3} and result["partners"]["created"] == 1
    assert switched.json()["view"]["categories"]["sponsor"]["sub"] == ["Gold", "Hauptsponsor"]
    assert await flow.db.audit_logs.count_documents({"action": "dolibarr.sponsor_source"}) == 1

    sponsors = {s["name"]: s for s in (await flow.get("/api/sponsors/admin")).json()}
    assert set(sponsors) == {"Alpha Energy", "Beta GmbH", "Delta Bank"}, "kein Duplikat für den Handeintrag"
    assert sponsors["Alpha Energy"]["id"] == "s-alpha" and sponsors["Alpha Energy"]["logo_url"] == "/uploads/alpha.png" and sponsors["Alpha Energy"]["description"] == "Handtext"
    assert sponsors["Alpha Energy"]["tier"] == "gold" and sponsors["Alpha Energy"]["source"] == "dolibarr" and sponsors["Alpha Energy"]["link"] == "https://alpha.test"
    assert sponsors["Alpha Energy"]["contract_start"] == "2024-01-01" and sponsors["Alpha Energy"]["contract_end"] == "2026-12-31" and sponsors["Alpha Energy"]["contact_email"] == "office@alpha.test"
    assert sponsors["Beta GmbH"]["tier"] == "bronze" and sponsors["Beta GmbH"]["show_on_footer"] is False
    assert sponsors["Delta Bank"]["effective_status"] == "expired"
    partners = (await flow.get("/api/partners/admin")).json()
    assert [(p["name"], p["kind"], p["link"], p["source"]) for p in partners] == [("Gamma Verein", "Verein", "https://gamma.test", "dolibarr")]

    # Öffentlich: nur was öffentlich ist - keine Kontaktdaten, Notizen oder Dolibarr-Verweise; Beta hat kein Logo,
    # steht aber in der Liste (die Seite filtert nach Logo); Delta ist abgelaufen und deshalb bei den Ehemaligen.
    public = (await flow.get("/api/sponsors")).json()
    assert [s["name"] for s in public] == ["Alpha Energy", "Beta GmbH"]
    assert public[0]["since_year"] == 2024 and not ({"contact_email", "internal_notes", "dolibarr_id", "contract_end"} & set(public[0]))
    former = (await flow.get("/api/sponsors/former")).json()
    assert [(s["name"], s["until_year"]) for s in former] == [("Delta Bank", 2025)]
    assert "contact_email" not in (await flow.get("/api/partners")).json()[0]

    # Gesperrt, solange der Schalter an ist: Name, Stufe, Laufzeit, Kontakt - Beschreibung und Platzierung bleiben Handpflege.
    saved = await flow.patch("/api/sponsors/s-alpha", json={"name": "Umbenannt", "tier": "main", "contract_end": "2030-01-01", "description": "Neu", "show_on_home": True})
    assert saved.status_code == 200 and saved.json()["name"] == "Alpha Energy" and saved.json()["tier"] == "gold" and saved.json()["contract_end"] == "2026-12-31"
    assert saved.json()["description"] == "Neu" and saved.json()["show_on_home"] is True
    partner_id = partners[0]["id"]
    saved = await flow.patch(f"/api/partners/{partner_id}", json={"name": "Anders", "kind": "Messe", "description": "Freunde"})
    assert saved.json()["name"] == "Gamma Verein" and saved.json()["kind"] == "Verein" and saved.json()["description"] == "Freunde"

    # Zweiter Lauf: Beta fällt aus der Kategorie - Sponsoring endet heute, der Eintrag bleibt.
    fake.thirdparty_categories[beta["id"]] = set()
    again = await flow.post("/api/admin/dolibarr/sponsors/refresh")
    assert again.status_code == 200 and again.json()["sponsors"] == {"created": 0, "updated": 2, "gone": 1, "total": 2}
    today = datetime.now(timezone.utc).date().isoformat()
    beta_doc = await flow.db.sponsors.find_one({"dolibarr_id": beta["id"]}, {"_id": 0})
    assert beta_doc["contract_end"] == today and beta_doc.get("dolibarr_gone_at")
    assert await flow.db.sponsors.count_documents({}) == 3

    # Ausfall: der Stand bleibt, der Fehler steht daneben.
    fetched_at = again.json()["fetched_at"]
    fake.fail_with = 503
    outage = await flow.post("/api/admin/dolibarr/sponsors/refresh")
    assert outage.json()["ok"] is False and outage.json()["view"]["error"] == "unavailable" and outage.json()["view"]["fetched_at"] == fetched_at
    assert await flow.db.sponsors.count_documents({"source": "dolibarr"}) == 3
    fake.fail_with = None

    # Schalter aus: alles bleibt stehen und ist wieder von Hand pflegbar; Nachlesen ist dann kein Weg.
    assert (await flow.patch("/api/admin/dolibarr/sponsors", json={"from_dolibarr": False})).status_code == 200
    assert (await flow.patch("/api/sponsors/s-alpha", json={"name": "Umbenannt"})).json()["name"] == "Umbenannt"
    assert (await flow.post("/api/admin/dolibarr/sponsors/refresh")).status_code == 409
    assert (await flow.patch("/api/admin/dolibarr/sponsors", json={"sponsor_category": "  "})).status_code == 422

    # Nur Redaktion und System sehen den Block; ohne Anbindung lässt sich der Schalter nicht setzen.
    flow.act_as(await flow.add_user(role="player"))
    assert (await flow.get("/api/admin/dolibarr/sponsors")).status_code == 403
    flow.act_as(admin)
    await connect(flow, mode="off")
    assert (await flow.patch("/api/admin/dolibarr/sponsors", json={"from_dolibarr": True})).status_code == 409


@pytest.mark.asyncio
async def test_daily_center_counts_sponsorships_ending_within_thirty_days(flow):
    now = datetime.now(timezone.utc)
    soon = (now + timedelta(days=10)).date().isoformat()
    later = (now + timedelta(days=40)).date().isoformat()
    await flow.db.sponsors.insert_many([
        {"id": "a", "name": "A", "contract_end": soon, "is_active": True, "contract_status": "active"},
        {"id": "b", "name": "B", "contract_end": later, "is_active": True, "contract_status": "active"},
        {"id": "c", "name": "C", "contract_end": soon, "is_active": True, "contract_status": "paused"},
        {"id": "d", "name": "D", "contract_end": soon, "is_active": False},
        {"id": "e", "name": "E", "contract_end": (now - timedelta(days=1)).date().isoformat(), "is_active": True},
    ])
    counts = await daily_center.task_counts(flow.db, now)
    assert counts["sponsors_expiring"] == 1
