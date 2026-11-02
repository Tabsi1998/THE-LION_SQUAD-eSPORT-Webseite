"""Regelwerk der Liga (docs/LIGA.md, #1646): Recht ist die Zuständigkeit ``rules`` der Liga, zu der das Objekt gehört - nie eine Liga aus der Eingabe. Der
Bereich Turnierleitung gibt hier nichts. Die ganze Matrix steht in ``test_league_rights_matrix_flow.py``, hier die Fälle mit fremder Liga und die Inhalte. Erfundene
Namen."""
import io
import pathlib
import sys

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_rules_world import ADMIN, ADMIN_LEAGUES, GAME, league_scope, make_world, publish, save_pool, season_scope, today  # noqa: E402
from league_start_world import ok, season_body  # noqa: E402
from models import now_utc  # noqa: E402
from routes import phase_fg_routes, upload_routes  # noqa: E402
from services import media_scan  # noqa: E402

DRAFT = {"title": "A", "body_md": "# A\nText", "annexes": []}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def staff(flow, league_id: str, capabilities: list[str], **fields) -> dict:
    user = await flow.add_user(name=f"Zuständig {new_id()[:6]}")
    user.update(fields)
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": league_id, "user_id": user["id"], "capabilities": capabilities,
                                           "created_at": now_utc().isoformat(), "created_by": "test"})
    return user


async def two_leagues(flow) -> dict:
    """Zwei Ligen mit je einer Season, die fremde mit einer veröffentlichten Fassung und einem Entwurf."""
    w = await make_world(flow)
    flow.act_as(w["lead"])
    game = await flow.db.games.find_one({"slug": GAME["slug"]}, {"_id": 0})
    other_league = ok(await flow.post(ADMIN_LEAGUES, json={"name": "Andere Liga", "slug": "andere-liga", "game_id": game["id"]}))
    other_season = ok(await flow.post(f"{ADMIN_LEAGUES}/{other_league['id']}/seasons", json=season_body(visibility="public")))
    other = {"lead": w["lead"], "league": other_league, "season": other_season}
    w["other"] = other
    w["other_version"] = await publish(flow, other, body="# A\nFremd", annexes=[])
    w["other_draft"] = ok(await flow.put(f"{season_scope(other)}/draft", json={"title": "Fremd", "body_md": "# Fremd\nEntwurf", "annexes": []}))
    return w


def calls(target: str, revision: int = 1) -> list[tuple[str, str, dict | None]]:
    return [("GET", target, None), ("PUT", f"{target}/draft", {**DRAFT, "revision": revision}), ("POST", f"{target}/draft/from-version", {}),
            ("DELETE", f"{target}/draft", None), ("POST", f"{target}/preview", DRAFT),
            ("POST", f"{target}/publish", {"revision": revision, "valid_from": today(), "change_reason": "Ein Grund"})]


async def request(flow, method: str, url: str, body):
    return await flow.client.request(method, url, **({"json": body} if body is not None else {}))


@pytest.mark.asyncio
async def test_rules_of_one_league_reach_nothing_of_another_via_season_or_league_id(flow):
    w = await two_leagues(flow)
    flow.act_as(await staff(flow, w["league"]["id"], ["rules"]))
    before = await flow.db.league_rules.find({}, {"_id": 0}).to_list(None)
    for target in (season_scope(w["other"]), league_scope(w["other"])):
        for method, url, body in calls(target):
            answer = await request(flow, method, url, body)
            assert answer.status_code == 403, f"{method} {url}: {answer.status_code}"
            assert "Fremd" not in answer.text
    assert await flow.db.league_rules.find({}, {"_id": 0}).to_list(None) == before


@pytest.mark.asyncio
async def test_rules_of_the_own_league_work_in_season_and_league(flow):
    w = await two_leagues(flow)
    flow.act_as(await staff(flow, w["league"]["id"], ["rules"]))
    for target in (season_scope(w), league_scope(w)):
        draft = ok(await flow.put(f"{target}/draft", json=DRAFT))
        ok(await flow.post(f"{target}/preview", json=DRAFT))
        version = ok(await flow.post(f"{target}/publish", json={"revision": draft["revision"], "valid_from": today(), "change_reason": "Ein Grund"}))
        assert version["league_id"] == w["league"]["id"] and version["status"] == "published"


@pytest.mark.asyncio
async def test_a_foreign_version_id_in_the_own_scope_is_not_found(flow):
    """IDOR über die Fassung: Der Geltungsbereich ist der eigene, die Kennung gehört einer anderen Liga. Es kommt nichts von ihr in den Entwurf."""
    w = await two_leagues(flow)
    flow.act_as(await staff(flow, w["league"]["id"], ["rules"]))
    answer = await flow.post(f"{season_scope(w)}/draft/from-version", json={"version_id": w["other_version"]["id"]})
    assert answer.status_code == 404
    assert await flow.db.league_rules.count_documents({"scope_id": w["season"]["id"]}) == 0


@pytest.mark.asyncio
async def test_a_league_id_in_the_input_changes_nothing(flow):
    """Maßgeblich ist die gespeicherte Season, auch wenn die Eingabe eine andere Liga nennt."""
    w = await two_leagues(flow)
    flow.act_as(await staff(flow, w["league"]["id"], ["rules"]))
    draft = ok(await flow.put(f"{season_scope(w)}/draft", json={**DRAFT, "league_id": w["other"]["league"]["id"], "scope_id": w["other"]["season"]["id"]}))
    assert draft["league_id"] == w["league"]["id"] and draft["scope_id"] == w["season"]["id"]
    flow.act_as(await staff(flow, w["other"]["league"]["id"], ["rules"]))
    refused = await flow.put(f"{season_scope(w)}/draft", json={**DRAFT, "league_id": w["other"]["league"]["id"], "revision": draft["revision"]})
    assert refused.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("capability", ["manage", "season", "applications", "roster", "matches", "results", "disputes", "sanctions"])
async def test_another_duty_of_the_same_league_is_not_enough(flow, capability):
    w = await make_world(flow)
    flow.act_as(await staff(flow, w["league"]["id"], [capability]))
    for target in (season_scope(w), league_scope(w)):
        for method, url, body in calls(target):
            answer = await request(flow, method, url, body)
            assert answer.status_code == 403, f"{capability} {method} {url}: {answer.status_code}"


@pytest.mark.asyncio
async def test_duties_only_count_with_the_second_factor(flow):
    w = await make_world(flow)
    flow.act_as(await staff(flow, w["league"]["id"], ["rules"], auth_mfa_verified=False))
    answer = await flow.get(season_scope(w))
    assert answer.status_code == 403 and "Zwei-Faktor" in answer.json()["detail"]


@pytest.mark.asyncio
@pytest.mark.parametrize("fields", [{"role": "tournament_admin"}, {"areas": ["tournaments"]}, {"role": "moderator"}], ids=["Rolle", "Freigabe", "Moderation"])
async def test_the_tournament_area_gives_nothing_here(flow, fields):
    w = await make_world(flow)
    person = await flow.add_user(name="Turnierleitung", role=fields.get("role", "user"))
    person.update(fields)
    flow.act_as(person)
    for target in (season_scope(w), league_scope(w)):
        for method, url, body in calls(target):
            answer = await request(flow, method, url, body)
            assert answer.status_code == 403, f"{fields} {method} {url}: {answer.status_code}"


@pytest.mark.asyncio
async def test_consents_and_the_data_hint_come_with_the_same_right(flow):
    w = await make_world(flow)
    await publish(flow, w, requires_consent=True)
    await save_pool(flow, w, {"stellung": ["Turmblick"], "suchen": ["Nebelwerk"]})
    flow.act_as(await staff(flow, w["league"]["id"], ["rules"]))
    view = ok(await flow.get(season_scope(w)))
    assert view["consents"]["rows"] and view["data_changes"]["rows"]
    flow.act_as(await staff(flow, w["league"]["id"], ["season"]))
    assert (await flow.get(season_scope(w))).status_code == 403


@pytest.mark.asyncio
async def test_unknown_things_answer_only_the_area_with_not_found(flow):
    w = await make_world(flow)
    area = await flow.add_user(name="Ligaleitung")
    area["areas"] = ["leagues"]
    flow.act_as(area)
    assert (await flow.get(f"{ADMIN}/turnier/{w['season']['id']}")).status_code == 404
    assert (await flow.get(f"{ADMIN}/league_season/unbekannt")).status_code == 404
    flow.act_as(await staff(flow, w["league"]["id"], ["rules"]))
    assert (await flow.get(f"{ADMIN}/turnier/{w['season']['id']}")).status_code == 403
    assert (await flow.get(f"{ADMIN}/league_season/unbekannt")).status_code == 403
    assert (await flow.get(f"{ADMIN}/league/unbekannt")).status_code == 403


@pytest.mark.asyncio
async def test_a_duty_puts_its_own_image_into_the_rules_without_admin_media(flow, tmp_path, monkeypatch):
    """Die Admin-Medien gehen über die Rolle, Zuständigkeiten öffnen sie nicht. Das eigene Bild reicht fürs Regelwerk."""
    for module in (upload_routes, phase_fg_routes):
        monkeypatch.setattr(module, "PUBLIC_UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(phase_fg_routes, "UPLOAD_DIR", tmp_path)  # die Mediathek schaut zuerst, ob es diesen Ordner gibt
    monkeypatch.setattr(media_scan, "auto_process", False)
    w = await make_world(flow)
    flow.act_as(await staff(flow, w["league"]["id"], ["rules"]))
    picture = io.BytesIO()
    Image.new("RGB", (40, 40), (20, 90, 160)).save(picture, format="PNG")
    files = {"file": ("plan.png", picture.getvalue(), "image/png")}
    assert (await flow.post("/api/uploads/image?media_scope=admin", files=files)).status_code == 403
    url = ok(await flow.post("/api/uploads/image", files=files))["url"]
    draft = ok(await flow.put(f"{season_scope(w)}/draft", json={**DRAFT, "body_md": f"# A\n![Plan]({url})"}))
    assert url in draft["body_md"]
    listed = ok(await flow.get("/api/media?type=images"))
    assert url in [row["url"] for row in listed]


@pytest.mark.asyncio
async def test_a_revoked_duty_stops_at_once(flow):
    w = await make_world(flow)
    person = await staff(flow, w["league"]["id"], ["rules"])
    flow.act_as(person)
    ok(await flow.get(season_scope(w)))
    await flow.db.league_staff.delete_many({"user_id": person["id"]})
    assert (await flow.get(season_scope(w))).status_code == 403
