"""Regelwerk der Liga (docs/LIGA.md, #1646): Entwurf, Veröffentlichen, Unveränderlichkeit, Erben, Einfrieren, Vergleich,
Vorschlag bei Datenänderung, Rechte, Sichtbarkeit und Rückfall auf ``rules_text``. Erfundene Inhalte."""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_rules_world import (  # noqa: E402
    ADMIN_LEAGUES, BODY, in_days, league_page, league_scope, make_world, publish, save_pool, season_page, season_scope, today,
)
from league_start_world import ok  # noqa: E402
from services import league_rules  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def section(page: dict, anchor: str) -> dict:
    return next(row for row in page["sections"] if row["anchor"] == anchor)


# ---------------------------------------------------------------- Entwurf und Veröffentlichen

@pytest.mark.asyncio
async def test_a_draft_stays_hidden_until_it_is_published(flow):
    w = await make_world(flow)
    target = season_scope(w)
    draft = ok(await flow.put(f"{target}/draft", json={"title": "Regelwerk", "body_md": "# Eins\nEntwurfstext", "annexes": []}))
    assert draft["status"] == "draft" and draft["version"] is None and draft["revision"] == 1
    flow.act_as(None)
    page = ok(await flow.get(season_page(w)))
    assert page["source"] == "fallback", "der Regeltext der Season gilt weiter"
    assert "Entwurfstext" not in str(page)


@pytest.mark.asyncio
async def test_publishing_freezes_the_draft_with_number_author_and_reason(flow):
    w = await make_world(flow)
    version = await publish(flow, w, reason="Erste Fassung")
    assert version["status"] == "published" and version["version"] == 1
    assert version["change_reason"] == "Erste Fassung" and version["valid_from"] == today()
    assert version["published_by"] == w["lead"]["id"]
    assert ok(await flow.get(season_scope(w)))["draft"] is None
    second = await publish(flow, w, body="# Fairplay\nZweite Fassung", reason="Zweite Fassung")
    assert second["version"] == 2
    flow.act_as(None)
    page = ok(await flow.get(season_page(w)))
    assert page["source"] == "rules" and page["version"]["version"] == 2
    assert [row["version"] for row in page["versions"]] == [2, 1]


@pytest.mark.asyncio
async def test_a_published_version_cannot_be_changed_by_any_route(flow):
    w = await make_world(flow)
    version = await publish(flow, w)
    before = await flow.db.league_rules.find_one({"id": version["id"]}, {"_id": 0})
    target = season_scope(w)
    # Der alte Stand des Entwurfs lässt sich nicht noch einmal veröffentlichen ...
    again = await flow.post(f"{target}/publish", json={
        "revision": version["revision"], "valid_from": today(), "change_reason": "Nochmal veröffentlichen"})
    assert again.status_code == 409
    # ... nichts zum Verwerfen, und ein neuer Entwurf ist eine neue Zeile.
    assert (await flow.delete(f"{target}/draft")).status_code == 404
    draft = ok(await flow.put(f"{target}/draft", json={"title": "Geändert", "body_md": "# Neu\nNeu", "annexes": []}))
    assert draft["id"] != version["id"]
    assert await flow.db.league_rules.find_one({"id": version["id"]}, {"_id": 0}) == before


@pytest.mark.asyncio
async def test_saving_with_an_old_revision_is_refused(flow):
    w = await make_world(flow)
    target = season_scope(w)
    first = ok(await flow.put(f"{target}/draft", json={"title": "A", "body_md": "# A\nA", "annexes": []}))
    ok(await flow.put(f"{target}/draft", json={"title": "B", "body_md": "# B\nB", "annexes": [], "revision": first["revision"]}))
    stale = await flow.put(f"{target}/draft", json={"title": "C", "body_md": "# C\nC", "annexes": [], "revision": first["revision"]})
    assert stale.status_code == 409
    assert "inzwischen" in stale.json()["detail"]


@pytest.mark.asyncio
async def test_two_publications_at_once_give_one_version_and_one_conflict(flow):
    w = await make_world(flow)
    target = season_scope(w)
    draft = ok(await flow.put(f"{target}/draft", json={"title": "A", "body_md": "# A\nA", "annexes": []}))
    body = {"revision": draft["revision"], "valid_from": today(), "change_reason": "Gleichzeitig"}
    answers = await asyncio.gather(flow.post(f"{target}/publish", json=body), flow.post(f"{target}/publish", json=body))
    assert sorted(answer.status_code for answer in answers) == [200, 409]
    assert await flow.db.league_rules.count_documents({"status": "published"}) == 1


@pytest.mark.asyncio
async def test_the_index_refuses_a_second_version_with_the_same_number(flow):
    if not flow.real_mongo:
        pytest.skip("Indizes gibt es nur auf echtem MongoDB")
    from pymongo.errors import DuplicateKeyError

    w = await make_world(flow)
    version = await publish(flow, w)
    twin = {key: value for key, value in version.items() if key != "id"}
    with pytest.raises(DuplicateKeyError):
        await flow.db.league_rules.insert_one({**twin, "id": "zwilling"})
    await flow.put(f"{season_scope(w)}/draft", json={"title": "A", "body_md": "# A\nA", "annexes": []})
    with pytest.raises(DuplicateKeyError):
        await flow.db.league_rules.insert_one({"id": "zweiter", "scope": version["scope"], "scope_id": version["scope_id"],
                                               "status": "draft", "version": None})


@pytest.mark.asyncio
async def test_publishing_refuses_what_makes_no_sense(flow):
    w = await make_world(flow)
    target = season_scope(w)
    draft = ok(await flow.put(f"{target}/draft", json={"title": "A", "body_md": "[[baustein:waffenliste]]", "annexes": []}))
    body = {"revision": draft["revision"], "valid_from": today(), "change_reason": "Ein Grund"}
    unknown = await flow.post(f"{target}/publish", json=body)
    assert unknown.status_code == 422 and "waffenliste" in unknown.json()["detail"]
    draft = ok(await flow.put(f"{target}/draft", json={"title": "A", "body_md": "  ", "annexes": [], "revision": draft["revision"]}))
    body["revision"] = draft["revision"]
    assert (await flow.post(f"{target}/publish", json=body)).status_code == 422
    draft = ok(await flow.put(f"{target}/draft", json={"title": "A", "body_md": "# A\nA", "annexes": [], "revision": draft["revision"]}))
    body["revision"] = draft["revision"]
    assert (await flow.post(f"{target}/publish", json={**body, "valid_from": in_days(-1)})).status_code == 422
    assert (await flow.post(f"{target}/publish", json={**body, "valid_from": "morgen"})).status_code == 422
    assert (await flow.post(f"{target}/publish", json={**body, "change_reason": "kurz"})).status_code == 422
    assert await flow.db.league_rules.count_documents({"status": "published"}) == 0


@pytest.mark.asyncio
async def test_protocol_names_the_step_without_the_text(flow):
    w = await make_world(flow)
    version = await publish(flow, w, body="# Geheim\nVolltext der Regeln")
    rows = await flow.db.audit_logs.find({"action": {"$regex": "^league.rules"}}, {"_id": 0}).to_list(None)
    assert {"league.rules.draft", "league.rules.publish"} <= {row["action"] for row in rows}
    assert "Volltext" not in str(rows)
    published = next(row for row in rows if row["action"] == "league.rules.publish")
    assert published["target_id"] == version["id"] and published["data"]["version"] == 1


# ---------------------------------------------------------------- Gültig ab und Erben

@pytest.mark.asyncio
async def test_a_version_counts_from_its_day_on(flow, monkeypatch):
    w = await make_world(flow)
    await publish(flow, w, body="# A\nAlt")
    await publish(flow, w, body="# A\nKünftig", valid_from=in_days(7))
    flow.act_as(None)
    page = ok(await flow.get(season_page(w)))
    assert page["version"]["version"] == 1 and page["upcoming"]["version"] == 2
    later = in_days(7)
    monkeypatch.setattr(league_rules, "club_today", lambda: later)
    page = ok(await flow.get(season_page(w)))
    assert page["version"]["version"] == 2 and page["upcoming"] is None


@pytest.mark.asyncio
async def test_a_new_version_cannot_start_before_its_predecessor(flow):
    w = await make_world(flow)
    await publish(flow, w, body="# A\nKünftig", valid_from=in_days(7))
    target = season_scope(w)
    draft = ok(await flow.put(f"{target}/draft", json={"title": "A", "body_md": "# A\nFrüher", "annexes": []}))
    early = await flow.post(f"{target}/publish", json={"revision": draft["revision"], "valid_from": today(), "change_reason": "Zu früh"})
    assert early.status_code == 422 and "Version 1" in early.json()["detail"]


@pytest.mark.asyncio
async def test_a_season_inherits_the_league_until_it_has_its_own(flow):
    w = await make_world(flow)
    league_version = await publish(flow, w, scope=league_scope(w), body="# Liga\nGilt für alle")
    flow.act_as(None)
    inherited = ok(await flow.get(season_page(w)))
    assert inherited["source"] == "rules" and inherited["version"]["id"] == league_version["id"]
    assert inherited["version"]["scope"] == "league"
    await publish(flow, w, body="# Season\nNur hier")
    flow.act_as(None)
    own = ok(await flow.get(season_page(w)))
    assert own["version"]["scope"] == "league_season" and section(own, "season")
    assert {row["id"] for row in own["versions"]} >= {league_version["id"]}, "die Liga-Fassung bleibt vergleichbar"
    assert own["changes"]["base"]["id"] == league_version["id"]
    assert ok(await flow.get(league_page(w)))["version"]["id"] == league_version["id"]


@pytest.mark.asyncio
async def test_an_old_version_stays_readable_and_a_foreign_one_is_not_found(flow):
    w = await make_world(flow)
    first = await publish(flow, w, body="# A\nErste Fassung")
    await publish(flow, w, body="# A\nZweite Fassung")
    flow.act_as(None)
    old = ok(await flow.get(season_page(w), params={"version": first["id"]}))
    assert old["version"]["version"] == 1 and old["version"]["is_current"] is False
    assert "Erste Fassung" in section(old, "a")["body_md"]
    assert (await flow.get(season_page(w), params={"version": "unbekannt"})).status_code == 404
    flow.act_as(w["lead"])
    other = ok(await flow.post(f"{ADMIN_LEAGUES}/{w['league']['id']}/seasons", json={"visibility": "public",
                                                                                     "start_date": f"{in_days(40)}T00:00:00"}))
    flow.act_as(None)
    foreign = await flow.get(f"/api/league-rules/seasons/{w['league']['slug']}/{other['slug']}", params={"version": first["id"]})
    assert foreign.status_code == 404, "eine Fassung einer anderen Season gehört nicht auf diese Seite"


# ---------------------------------------------------------------- Bausteine und Einfrieren

@pytest.mark.asyncio
async def test_blocks_are_frozen_and_later_data_does_not_change_the_version(flow):
    w = await make_world(flow)
    version = await publish(flow, w)
    assert version["blocks_used"] == ["map_pool", "mode_order"]
    flow.act_as(None)
    page = ok(await flow.get(season_page(w)))
    maps = section(page, "maps")["body_md"]
    assert "Hafenkante" in maps and "Nebelwerk" in maps and "Turmblick" not in maps
    assert "| Modus | Maps |" in maps
    assert "Map 1: Stellung" in section(page, "modi")["body_md"]
    await save_pool(flow, w, {"stellung": ["Turmblick"], "suchen": ["Nebelwerk"]})
    flow.act_as(None)
    again = ok(await flow.get(season_page(w)))
    assert "Hafenkante" in section(again, "maps")["body_md"] and "Turmblick" not in section(again, "maps")["body_md"]


@pytest.mark.asyncio
async def test_blocks_of_a_league_version_are_frozen_per_season(flow):
    w = await make_world(flow)
    await publish(flow, w, scope=league_scope(w))
    flow.act_as(None)
    season = ok(await flow.get(season_page(w)))
    assert "Hafenkante" in section(season, "maps")["body_md"]
    league = ok(await flow.get(league_page(w)))
    assert "Hafenkante" not in section(league, "maps")["body_md"]
    assert "je Season" in section(league, "maps")["body_md"]
    flow.act_as(w["lead"])
    later = ok(await flow.post(f"{ADMIN_LEAGUES}/{w['league']['id']}/seasons", json={"visibility": "public",
                                                                                     "start_date": f"{in_days(40)}T00:00:00"}))
    flow.act_as(None)
    fresh = ok(await flow.get(f"/api/league-rules/seasons/{w['league']['slug']}/{later['slug']}"))
    assert "noch nicht festgehalten" in section(fresh, "maps")["body_md"]


@pytest.mark.asyncio
async def test_preview_uses_the_current_data_and_names_unknown_blocks(flow):
    w = await make_world(flow)
    target = season_scope(w)
    preview = ok(await flow.post(f"{target}/preview", json={
        "title": "A", "body_md": "# Maps\n[[baustein:map_pool]]\n\n[[baustein:gibtsnicht]]", "annexes": []}))
    assert "Hafenkante" in preview["sections"][0]["body_md"]
    assert preview["unknown_blocks"] == ["gibtsnicht"]
    assert await flow.db.league_rules.count_documents({}) == 0, "die Vorschau speichert nichts"


# ---------------------------------------------------------------- Vergleich und Markierung

@pytest.mark.asyncio
async def test_the_page_marks_changes_against_the_previous_version(flow):
    w = await make_world(flow)
    await publish(flow, w, body="# Bleibt\nGleich\n\n# Anders\nAlter Wortlaut\n\n# Weg\nFällt ganz weg hier")
    await publish(flow, w, body="# Bleibt\nGleich\n\n# Anders\nNeuer Wortlaut\n\n# Dazu\nKomplett neu an dieser Stelle")
    flow.act_as(None)
    page = ok(await flow.get(season_page(w)))
    assert section(page, "anders")["mark"] == "changed" and section(page, "dazu")["mark"] == "new"
    assert section(page, "bleibt")["mark"] is None
    assert page["changes"]["base"]["version"] == 1
    assert [row["anchor"] for row in page["changes"]["changed"]] == ["anders"]
    assert [row["title"] for row in page["changes"]["removed"]] == ["Weg"]


@pytest.mark.asyncio
async def test_the_first_version_has_no_marks(flow):
    w = await make_world(flow)
    await publish(flow, w, body="# Eins\nText")
    flow.act_as(None)
    page = ok(await flow.get(season_page(w)))
    assert page["changes"]["base"] is None and section(page, "eins")["mark"] is None


@pytest.mark.asyncio
async def test_a_changed_map_pool_marks_the_section_of_the_block(flow):
    w = await make_world(flow)
    await publish(flow, w)
    await save_pool(flow, w, {"stellung": ["Turmblick"], "suchen": ["Nebelwerk"]})
    await publish(flow, w)
    flow.act_as(None)
    page = ok(await flow.get(season_page(w)))
    assert section(page, "maps")["mark"] == "changed" and section(page, "modi")["mark"] is None


@pytest.mark.asyncio
async def test_word_comparison_works_against_every_old_version_and_shows_removed_text(flow):
    w = await make_world(flow)
    first = await publish(flow, w, body="# A\nEine Runde dauert zwanzig Minuten.\n\n# Weg\nDieser Abschnitt verschwindet komplett")
    second = await publish(flow, w, body="# A\nEine Runde dauert zwanzig Minuten.")
    third = await publish(flow, w, body="# A\nEine Runde dauert dreißig Minuten.")
    flow.act_as(None)
    answer = ok(await flow.get(f"{season_page(w)}/compare", params={"base": first["id"], "target": third["id"]}))
    rows = {row["anchor"]: row for row in answer["sections"]}
    assert answer["base"]["version"] == 1 and answer["target"]["version"] == 3
    assert {"op": "del", "text": "zwanzig"} in rows["a"]["ops"] and {"op": "ins", "text": "dreißig"} in rows["a"]["ops"]
    assert rows["weg"]["status"] == "removed" and "verschwindet" in rows["weg"]["ops"][0]["text"]
    same = ok(await flow.get(f"{season_page(w)}/compare", params={"base": second["id"], "target": second["id"]}))
    assert {row["status"] for row in same["sections"]} == {"same"}
    assert (await flow.get(f"{season_page(w)}/compare", params={"base": "fremd", "target": third["id"]})).status_code == 404


# ---------------------------------------------------------------- Änderung an den Daten

@pytest.mark.asyncio
async def test_changed_data_suggests_a_new_version_but_publishes_nothing(flow):
    w = await make_world(flow)
    version = await publish(flow, w)
    assert ok(await flow.get(season_scope(w)))["data_changes"] is None
    await save_pool(flow, w, {"stellung": ["Turmblick"], "suchen": ["Nebelwerk"]})
    changes = ok(await flow.get(season_scope(w)))["data_changes"]
    assert changes["version_id"] == version["id"]
    row = changes["rows"][0]
    assert row["block"] == "map_pool" and "Hafenkante" in row["before"] and "Turmblick" in row["after"]
    assert {"op": "ins", "text": "Turmblick"} in row["ops"]
    assert await flow.db.league_rules.count_documents({"status": "published"}) == 1

    prepared = ok(await flow.post(f"{season_scope(w)}/draft/from-version", json={}))
    assert prepared["status"] == "draft" and prepared["body_md"] == BODY
    assert (await flow.post(f"{season_scope(w)}/draft/from-version", json={})).status_code == 409
    newer = await publish(flow, w, body=prepared["body_md"], reason="Neuer Map-Pool")
    assert newer["version"] == 2 and "Turmblick" in newer["frozen"][w["season"]["id"]]["map_pool"]["markdown"]
    assert ok(await flow.get(season_scope(w)))["data_changes"] is None


@pytest.mark.asyncio
async def test_a_version_without_blocks_never_suggests_anything(flow):
    w = await make_world(flow)
    await publish(flow, w, body="# Ohne\nKeine Bausteine")
    await save_pool(flow, w, {"stellung": ["Turmblick"], "suchen": ["Nebelwerk"]})
    assert ok(await flow.get(season_scope(w)))["data_changes"] is None


@pytest.mark.asyncio
async def test_a_league_version_suggests_per_season_that_inherits_it(flow):
    w = await make_world(flow)
    await publish(flow, w, scope=league_scope(w))
    await save_pool(flow, w, {"stellung": ["Turmblick"], "suchen": ["Nebelwerk"]})
    rows = ok(await flow.get(league_scope(w)))["data_changes"]["rows"]
    assert [row["season_id"] for row in rows] == [w["season"]["id"]] and rows[0]["season_name"] == w["season"]["name"]
    inherited = ok(await flow.get(season_scope(w)))
    assert inherited["inherited"]["scope"] == "league" and inherited["data_changes"]["rows"]
    await publish(flow, w, body="# Eigen\nEigener Text")
    assert ok(await flow.get(league_scope(w)))["data_changes"] is None, "die Season hat jetzt ihr eigenes"


# ---------------------------------------------------------------- Rechte

@pytest.mark.asyncio
async def test_only_the_rules_editor_reaches_the_administration(flow):
    w = await make_world(flow)
    target = season_scope(w)
    calls = [("get", target, None), ("put", f"{target}/draft", {"title": "A", "body_md": "# A", "annexes": []}),
             ("delete", f"{target}/draft", None), ("post", f"{target}/draft/from-version", {}),
             ("post", f"{target}/preview", {"title": "A", "body_md": "# A", "annexes": []}),
             ("post", f"{target}/publish", {"revision": 1, "valid_from": today(), "change_reason": "Ein Grund"})]
    for user, code in ((None, 401), (w["captain"], 403)):
        flow.act_as(user)
        for method, url, body in calls:
            kwargs = {"json": body} if body is not None else {}
            answer = await getattr(flow, method)(url, **kwargs)
            assert answer.status_code == code, f"{method} {url}: {answer.status_code}"
    assert await flow.db.league_rules.count_documents({}) == 0


@pytest.mark.asyncio
async def test_an_unknown_scope_or_target_is_not_found(flow):
    w = await make_world(flow)
    assert (await flow.get(f"/api/admin/league-rules/turnier/{w['season']['id']}")).status_code == 404
    assert (await flow.get("/api/admin/league-rules/league_season/unbekannt")).status_code == 404
    assert (await flow.get("/api/admin/league-rules/league/unbekannt")).status_code == 404


# ---------------------------------------------------------------- Sichtbarkeit

@pytest.mark.parametrize("visibility,anon,member,staff", [
    ("off", 404, 404, 404), ("admins", 404, 404, 200), ("members", 404, 200, 200), ("public", 200, 200, 200)])
@pytest.mark.asyncio
async def test_rules_follow_the_visibility_of_the_season(flow, visibility, anon, member, staff):
    w = await make_world(flow, visibility=visibility)
    version = await publish(flow, w)
    membership = {**await flow.add_user(name="Vereinsmitglied"), "is_club_member": True}
    urls = [season_page(w), f"{season_page(w)}?version={version['id']}",
            f"{season_page(w)}/compare?base={version['id']}&target={version['id']}", f"{season_page(w)}/versions/{version['id']}/pdf"]
    for user, code in ((None, anon), (membership, member), (w["lead"], staff)):
        flow.act_as(user)
        for url in urls:
            answer = await flow.get(url)
            assert answer.status_code == code, f"{visibility} {url} als {(user or {}).get('display_name')}: {answer.status_code}"


@pytest.mark.asyncio
async def test_the_league_page_needs_one_visible_season(flow):
    w = await make_world(flow, visibility="off")
    await publish(flow, w, scope=league_scope(w))
    flow.act_as(None)
    assert (await flow.get(league_page(w))).status_code == 404
    flow.act_as(w["lead"])
    ok(await flow.patch(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}", json={"visibility": "public"}))
    flow.act_as(None)
    assert (await flow.get(league_page(w))).status_code == 200


@pytest.mark.asyncio
async def test_the_public_never_sees_the_author_or_the_draft(flow):
    w = await make_world(flow)
    version = await publish(flow, w)
    await flow.put(f"{season_scope(w)}/draft", json={"title": "Nicht öffentlich", "body_md": "# Entwurf\nStreng", "annexes": []})
    flow.act_as(None)
    text = str(ok(await flow.get(season_page(w))))
    assert w["lead"]["id"] not in text and "published_by" not in text and "created_by" not in text
    assert "Streng" not in text and "frozen" not in text
    assert version["id"] in text


# ---------------------------------------------------------------- Rückfall und Staffel

@pytest.mark.asyncio
async def test_without_rules_the_season_shows_its_rules_text(flow):
    w = await make_world(flow, rules_text="## Alt\nAlter Regeltext")
    flow.act_as(None)
    page = ok(await flow.get(season_page(w)))
    assert page["source"] == "fallback" and page["fallback_text"] == "## Alt\nAlter Regeltext"
    assert page["version"] is None and page["sections"] == []
    public = ok(await flow.get(f"/api/leagues/{w['league']['slug']}/{w['season']['slug']}"))
    assert public["rules"] is None and public["season"]["rules_text"] == "## Alt\nAlter Regeltext"


@pytest.mark.asyncio
async def test_a_season_without_any_text_says_so(flow):
    w = await make_world(flow, rules_text="")
    flow.act_as(None)
    page = ok(await flow.get(season_page(w)))
    assert page["source"] == "none" and page["fallback_text"] is None


@pytest.mark.asyncio
async def test_the_season_page_links_the_rules_with_version_and_pdf(flow):
    w = await make_world(flow)
    version = await publish(flow, w, reason="Fassung A")
    flow.act_as(None)
    rules = ok(await flow.get(f"/api/leagues/{w['league']['slug']}/{w['season']['slug']}"))["rules"]
    assert rules["version"] == 1 and rules["valid_from"] == today()
    assert rules["url"] == f"/liga/{w['league']['slug']}/{w['season']['slug']}/regeln"
    assert rules["pdf_url"].endswith(f"/versions/{version['id']}/pdf")


@pytest.mark.asyncio
async def test_a_staffel_points_to_the_rules_page_also_after_transferring(flow):
    w = await make_world(flow, rules_text="Alter Regeltext")
    staffel = await flow.db.tournaments.find_one({"id": w["tid"]}, {"_id": 0})
    assert staffel["rules"] == "Alter Regeltext"
    await publish(flow, w)
    staffel = await flow.db.tournaments.find_one({"id": w["tid"]}, {"_id": 0})
    assert "Regelseite" in staffel["rules"] and "Alter Regeltext" not in staffel["rules"]
    flow.act_as(w["lead"])
    ok(await flow.post(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}/sync"))
    staffel = await flow.db.tournaments.find_one({"id": w["tid"]}, {"_id": 0})
    assert "Regelseite" in staffel["rules"], "Übertragen schreibt nicht den alten Text zurück"


@pytest.mark.asyncio
async def test_a_new_staffel_starts_with_the_pointer_when_the_league_has_rules(flow):
    w = await make_world(flow, rules_text="Alter Regeltext")
    await publish(flow, w, scope=league_scope(w))
    flow.act_as(w["lead"])
    created = ok(await flow.post(f"{ADMIN_LEAGUES}/divisions/{w['division']['id']}/staffeln", json={}))
    staffel = await flow.db.tournaments.find_one({"id": created["tournament_id"]}, {"_id": 0})
    assert "Regelseite" in staffel["rules"]


@pytest.mark.asyncio
async def test_the_address_regeln_is_reserved_for_the_rules_page(flow):
    w = await make_world(flow)
    answer = await flow.patch(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}", json={"slug": "regeln"})
    assert answer.status_code == 422


@pytest.mark.asyncio
async def test_deleting_a_season_or_league_takes_its_rules_along(flow):
    w = await make_world(flow, teams=2)
    await publish(flow, w)
    await publish(flow, w, scope=league_scope(w))
    # Eine Staffel mit Co-Teams hält die Season - für den Test ohne.
    await flow.db.tournament_registrations.delete_many({"tournament_id": w["tid"]})
    await flow.db.tournaments.update_one({"id": w["tid"]}, {"$unset": {"league_squad_key": ""}})
    flow.act_as(w["lead"])
    deleted = await flow.client.request("DELETE", f"{ADMIN_LEAGUES}/{w['league']['id']}", json={"reason": "Testweise aufräumen"})
    assert deleted.status_code == 200, deleted.text
    assert await flow.db.league_rules.count_documents({}) == 0
