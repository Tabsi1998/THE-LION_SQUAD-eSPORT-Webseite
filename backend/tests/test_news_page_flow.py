"""News-Seite und Startseite (#1249, #1342, #1343, #1266): Kategorien mit Anzahl je Besucher, der Aufmacher,
der Sieger für die Text-Karte und der Anmelde-Stand verknüpfter Turniere und Events."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def news(flow, slug, *, category="club", visibility="public", published=True, days_ago=1, **fields):
    doc = {
        "id": f"n-{slug}", "slug": slug, "title": slug.title(), "content": "Text", "category": category,
        "visibility": visibility, "published": published,
        "published_at": (now_utc() - timedelta(days=days_ago)).isoformat(), "created_at": now_utc().isoformat(),
        **fields,
    }
    await flow.db.news_posts.insert_one(dict(doc))
    return doc


async def member(flow, name):
    user = await flow.add_user(name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"is_club_member": True}})
    await flow.db.memberships.insert_one({"id": f"m-{name}", "user_id": user["id"], "member_status": "active", "membership_type": "ordinary"})
    user["is_club_member"] = True
    return user


def counts(body):
    return {row["k"]: row["count"] for row in body["in_use"]}


# ---------------------------------------------------------------- #1249 Kategorien mit Anzahl

@pytest.mark.asyncio
async def test_news_meta_counts_only_categories_with_visible_articles_per_viewer(flow):
    await news(flow, "turnier-a", category="tournaments")
    await news(flow, "turnier-b", category="tournaments")
    await news(flow, "community", category="community", visibility="community")
    await news(flow, "intern", category="members", visibility="members")
    await news(flow, "entwurf", category="sponsors", published=False)
    await news(flow, "morgen", category="recap", days_ago=-1)

    flow.act_as(None)
    body = (await flow.get("/api/news-meta")).json()
    assert counts(body) == {"tournaments": 2}, "ein Gast zählt weder Community-, Mitglieder- noch Entwurfs-Artikel"
    assert [row["l"] for row in body["in_use"]] == ["Turniere"]
    assert len(body["categories"]) == 10, "die Verwaltung braucht weiter alle Kategorien zur Auswahl"

    flow.act_as(await flow.add_user(name="spielerin"))
    assert counts((await flow.get("/api/news-meta")).json()) == {"tournaments": 2, "community": 1}

    flow.act_as(await member(flow, "mitglied"))
    assert counts((await flow.get("/api/news-meta")).json()) == {"tournaments": 2, "community": 1, "members": 1}


@pytest.mark.asyncio
async def test_news_meta_keeps_the_fixed_order_and_names_unknown_categories(flow):
    await news(flow, "video", category="video")
    await news(flow, "verein", category="club")
    await news(flow, "turnier", category="tournaments")

    flow.act_as(None)
    rows = (await flow.get("/api/news-meta")).json()["in_use"]
    assert [(row["k"], row["l"], row["count"]) for row in rows] == [
        ("club", "Verein", 1), ("tournaments", "Turniere", 1), ("video", "Video", 1),
    ]


# ---------------------------------------------------------------- #1343 Sieger für die Text-Karte

async def finished_tournament(flow, winner_name, *, public_profile=True, **fields):
    tournament = await flow.create_tournament(**{"status": "results_published", "title": "Kart-Cup", **fields})
    winner = await flow.add_user(name=winner_name)
    await flow.db.users.update_one({"id": winner["id"]}, {"$set": {"privacy_public_profile": public_profile}})
    second = await flow.add_user(name="Zweiter")
    reg_winner = await flow.register(tournament, winner)
    reg_second = await flow.register(tournament, second)
    await flow.db.tournament_awards.insert_many([
        {"id": "a1-" + tournament["id"], "tournament_id": tournament["id"], "registration_id": reg_winner["id"], "user_id": winner["id"], "rank": 1},
        {"id": "a2-" + tournament["id"], "tournament_id": tournament["id"], "registration_id": reg_second["id"], "user_id": second["id"], "rank": 2},
    ])
    return tournament


@pytest.mark.asyncio
async def test_result_news_carry_the_winner_in_list_and_on_home(flow):
    cup = await finished_tournament(flow, "NeonFalke")
    await news(flow, "ergebnis", category="recap", linked_tournament_ids=[cup["id"]])
    await news(flow, "ankuendigung", category="tournaments", days_ago=2)

    flow.act_as(None)
    listed = {row["slug"]: row for row in (await flow.get("/api/news?compact=true")).json()}
    assert listed["ergebnis"]["result"] == {"winner": "NeonFalke", "tournament": "Kart-Cup"}
    assert listed["ankuendigung"].get("result") is None
    assert "linked_tournament_ids" not in listed["ergebnis"], "die kompakte Liste bleibt schlank"

    home = {row["slug"]: row for row in (await flow.get("/api/home/state")).json()["news"]}
    assert home["ergebnis"]["result"]["winner"] == "NeonFalke"


@pytest.mark.asyncio
async def test_winner_name_follows_the_profile_settings(flow):
    privat = await finished_tournament(flow, "Privat", public_profile=False)
    team_cup = await flow.create_tournament(status="results_published", title="Team-Cup", team_mode="team")
    await flow.db.teams.insert_many([{"id": "team-offen", "name": "Lions"}, {"id": "team-zu", "name": "Geheim", "is_public": False}])
    await flow.db.tournament_registrations.insert_many([
        {"id": "r-offen", "tournament_id": team_cup["id"], "team_id": "team-offen", "display_name": "Lions", "status": "approved"},
    ])
    closed_cup = await flow.create_tournament(status="results_published", title="Zu-Cup", team_mode="team")
    await flow.db.tournament_registrations.insert_one({"id": "r-zu", "tournament_id": closed_cup["id"], "team_id": "team-zu", "display_name": "Geheim", "status": "approved"})
    await flow.db.tournament_awards.insert_many([
        {"id": "a-offen", "tournament_id": team_cup["id"], "registration_id": "r-offen", "team_id": "team-offen", "rank": 1},
        {"id": "a-zu", "tournament_id": closed_cup["id"], "registration_id": "r-zu", "team_id": "team-zu", "rank": 1},
    ])
    await news(flow, "privat", linked_tournament_ids=[privat["id"]])
    await news(flow, "team", linked_tournament_ids=[team_cup["id"]])
    await news(flow, "team-zu", linked_tournament_ids=[closed_cup["id"]])

    flow.act_as(None)
    listed = {row["slug"]: row for row in (await flow.get("/api/news?compact=true")).json()}
    assert listed["privat"].get("result") is None, "ohne öffentliches Profil keine Sieger-Karte"
    assert listed["team"]["result"]["winner"] == "Lions"
    assert listed["team-zu"].get("result") is None
    home = {row["slug"]: row for row in (await flow.get("/api/home/state")).json()["news"]}
    assert home["privat"].get("result") is None


@pytest.mark.asyncio
async def test_no_winner_before_results_or_for_hidden_tournaments(flow):
    running = await finished_tournament(flow, "Frueh", status="live")
    hidden = await finished_tournament(flow, "Versteckt", is_public=False)
    members = await finished_tournament(flow, "Intern", visibility="members")
    await news(flow, "laeuft", linked_tournament_ids=[running["id"]])
    await news(flow, "versteckt", linked_tournament_ids=[hidden["id"]])
    await news(flow, "mitglieder", linked_tournament_ids=[members["id"]])

    flow.act_as(None)
    listed = {row["slug"]: row for row in (await flow.get("/api/news?compact=true")).json()}
    assert all(row.get("result") is None for row in listed.values())


# ---------------------------------------------------------------- #1342 derselbe Aufmacher

@pytest.mark.asyncio
async def test_home_lead_is_the_pinned_news_like_on_the_news_page(flow):
    await news(flow, "alt-angepinnt", pinned=True, days_ago=30)
    for day in range(1, 10):
        await news(flow, f"neu-{day}", days_ago=day)

    flow.act_as(None)
    state = (await flow.get("/api/home/state")).json()
    assert [n["slug"] for n in state["featured_news"]] == ["alt-angepinnt"], "auch wenn neun neuere News folgen"
    assert "alt-angepinnt" in [n["slug"] for n in state["news"]]
    listed = (await flow.get("/api/news?compact=true")).json()
    assert listed[0]["slug"] == "alt-angepinnt", "die News-Seite stellt dieselbe News nach vorne"


@pytest.mark.asyncio
async def test_home_lead_without_pinned_news_is_the_newest(flow):
    await news(flow, "gestern", days_ago=1)
    await news(flow, "vorgestern", days_ago=2)
    flow.act_as(None)
    assert [n["slug"] for n in (await flow.get("/api/home/state")).json()["featured_news"]] == ["gestern"]


# ---------------------------------------------------------------- #1266 Weg zur Anmeldung

def soon(days):
    return (now_utc() + timedelta(days=days)).isoformat()


async def linked_signups(flow, post_slug):
    body = (await flow.get(f"/api/news/{post_slug}")).json()
    return {t["slug"]: t["signup"] for t in body.get("linked_tournaments") or []} | {e["slug"]: e["signup"] for e in body.get("linked_events") or []}


@pytest.mark.asyncio
async def test_linked_tournaments_carry_their_signup_state(flow):
    offen = await flow.create_tournament(slug="offen", start_date=soon(7), max_participants=8)
    voll = await flow.create_tournament(slug="voll", start_date=soon(7), max_participants=2)
    laeuft = await flow.create_tournament(slug="laeuft", status="live", start_date=soon(-1))
    fertig = await flow.create_tournament(slug="fertig", status="results_published", start_date=soon(-5))
    bald = await flow.create_tournament(slug="bald", status="scheduled", start_date=soon(20), registration_open_from=soon(3))
    for tournament, count in ((offen, 3), (voll, 2)):
        for index in range(count):
            await flow.register(tournament, await flow.add_user(name=f"{tournament['slug']}-{index}"))
    await flow.register(offen, await flow.add_user(name="wartet"), status="pending")
    await news(flow, "ankuendigung", linked_tournament_ids=[t["id"] for t in (offen, voll, laeuft, fertig, bald)])

    flow.act_as(None)
    signups = await linked_signups(flow, "ankuendigung")
    assert signups["offen"]["state"] == "open"
    assert (signups["offen"]["taken"], signups["offen"]["max"], signups["offen"]["spots_left"]) == (3, 8, 5)
    assert signups["offen"]["start_date"] == offen["start_date"]
    assert signups["voll"]["state"] == "full"
    assert signups["voll"]["spots_left"] == 0
    assert signups["laeuft"]["state"] == "live"
    assert signups["fertig"]["state"] == "results"
    assert signups["bald"]["state"] == "soon"
    assert signups["bald"]["opens_at"] == bald["registration_open_from"]


@pytest.mark.asyncio
async def test_linked_events_carry_their_signup_state(flow):
    start = soon(14)
    await flow.db.events.insert_many([
        {"id": "e-offen", "slug": "lan", "name": "LAN", "status": "registration_open", "visibility": "public", "start_date": start, "has_registration": True, "max_participants": 3},
        {"id": "e-voll", "slug": "voll", "name": "Voll", "status": "registration_open", "visibility": "public", "start_date": start, "has_registration": True, "max_participants": 1},
        {"id": "e-ohne", "slug": "ohne", "name": "Ohne Anmeldung", "status": "scheduled", "visibility": "public", "start_date": start},
    ])
    await flow.db.event_registrations.insert_many([
        {"id": "r1", "event_id": "e-offen", "user_id": "u1", "status": "registered"},
        {"id": "r2", "event_id": "e-voll", "user_id": "u2", "status": "registered"},
    ])
    await news(flow, "lan-news", linked_event_ids=["e-offen", "e-voll", "e-ohne"])

    flow.act_as(None)
    signups = await linked_signups(flow, "lan-news")
    assert signups["lan"]["state"] == "open"
    assert (signups["lan"]["taken"], signups["lan"]["max"], signups["lan"]["spots_left"]) == (1, 3, 2)
    assert signups["voll"]["state"] == "full"
    assert signups["ohne"]["state"] == "none"


# ---------------------------------------------------------------- Abfragen wachsen nicht mit der Liste

QUERY_METHODS = {"find", "find_one", "aggregate", "count_documents", "distinct"}


class CountingCollection:
    def __init__(self, collection, counter):
        self._collection = collection
        self._counter = counter

    def __getattr__(self, name):
        attr = getattr(self._collection, name)
        if name in QUERY_METHODS:
            def counted(*args, **kwargs):
                self._counter[self._collection.name] = self._counter.get(self._collection.name, 0) + 1
                return attr(*args, **kwargs)
            return counted
        return attr


class CountingDb:
    def __init__(self, db):
        self._db = db
        self.counter: dict[str, int] = {}

    def __getattr__(self, name):
        return CountingCollection(getattr(self._db, name), self.counter)

    def __getitem__(self, name):
        return CountingCollection(self._db[name], self.counter)


async def queries_for(flow, url):
    import database
    counting = CountingDb(flow.db)
    previous = database._db
    database._db = counting
    try:
        response = await flow.get(url)
        assert response.status_code == 200
    finally:
        database._db = previous
    return counting.counter


async def news_with_links(flow, slug, count):
    tournaments = [await flow.create_tournament(slug=f"{slug}-t{i}", start_date=soon(7)) for i in range(count)]
    for tournament in tournaments:
        await flow.register(tournament, await flow.add_user(name=f"{tournament['slug']}-spieler"))
    events = [{"id": f"{slug}-e{i}", "slug": f"{slug}-e{i}", "name": f"Event {i}", "status": "registration_open", "visibility": "public",
               "start_date": soon(14), "has_registration": True, "max_participants": 10} for i in range(count)]
    await flow.db.events.insert_many([dict(e) for e in events])
    await flow.db.event_registrations.insert_many([{"id": f"r-{e['id']}", "event_id": e["id"], "user_id": "u", "status": "registered"} for e in events])
    await news(flow, slug, linked_tournament_ids=[t["id"] for t in tournaments], linked_event_ids=[e["id"] for e in events])


@pytest.mark.asyncio
async def test_linked_signups_cost_the_same_queries_for_two_or_eight_links(flow):
    await news_with_links(flow, "wenig", 2)
    await news_with_links(flow, "viel", 8)
    flow.act_as(await member(flow, "leserin"))
    few = await queries_for(flow, "/api/news/wenig")
    many = await queries_for(flow, "/api/news/viel")
    assert many == few, f"Abfragen je Sammlung dürfen nicht mit den Verknüpfungen wachsen: {few} gegen {many}"
    assert many.get("tournament_registrations") == 1 and many.get("event_registrations") == 1


@pytest.mark.asyncio
async def test_result_winners_cost_the_same_queries_for_two_or_eight_news(flow):
    for index in range(8):
        cup = await finished_tournament(flow, f"Sieger{index}", visibility="members" if index % 2 else "public")
        await news(flow, f"ergebnis-{index}", linked_tournament_ids=[cup["id"]], category="recap" if index < 2 else "club")
    # Ohne Mitgliedschaft schlägt die Sichtbarkeit „Nur Mitglieder“ in der Datenbank nach - einmal, nicht je Turnier.
    flow.act_as(await flow.add_user(name="leser"))
    few = await queries_for(flow, "/api/news?compact=true&category=recap")
    many = await queries_for(flow, "/api/news?compact=true")
    assert many == few, f"Abfragen je Sammlung dürfen nicht mit der Liste wachsen: {few} gegen {many}"
