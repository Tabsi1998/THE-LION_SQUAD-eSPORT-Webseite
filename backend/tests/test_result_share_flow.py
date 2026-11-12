"""Ergebnis als Bild teilen (#1194): Hochformat 1080×1920 und breit 1200×630, die Teilen-Seite mit Vorschau und
der Knopf „Ergebnis teilen“ - nur, wenn Profil und Turnier öffentlich sind. Erfundene Daten, keine echten Personen."""
import io
import json
import pathlib
import sys

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from services import result_share  # noqa: E402
from services.tournament_path import _outcome, chip_text  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def public_user(flow, name, *, public=True):
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"privacy_public_profile": public}})
    return {**user, "privacy_public_profile": public}


async def duel(flow, tournament, own, other, own_score, other_score, *, round_no, section="WB", stage="stage-1"):
    await flow.db.matches_v2.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "stage_id": stage, "stage_number": 1, "round": round_no,
        "round_name": f"Runde {round_no}", "section": section, "match_type": "duel", "status": "completed",
        "slots": [{"slot": 1, "position": 1, "registration_id": own["id"]}, {"slot": 2, "position": 2, "registration_id": other["id"]}],
        "results": [
            {"registration_id": own["id"], "rank": 1 if own_score >= other_score else 2, "score": own_score},
            {"registration_id": other["id"], "rank": 1 if other_score >= own_score else 2, "score": other_score},
        ],
    })


async def heat(flow, tournament, ranking, *, round_no, stage="stage-1"):
    await flow.db.matches_v2.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "stage_id": stage, "stage_number": 1, "round": round_no,
        "round_name": f"Runde {round_no}", "section": "WB", "match_type": "ffa", "status": "completed",
        "slots": [{"slot": i, "position": i, "registration_id": reg["id"]} for i, reg in enumerate(ranking, start=1)],
        "results": [{"registration_id": reg["id"], "rank": i} for i, reg in enumerate(ranking, start=1)],
    })


async def finished_cup(flow, **overrides):
    fields = {"title": "FC 26 Herbst-Cup", "status": "results_published", "start_date": "2026-09-20T16:00:00+00:00", "game_name": "EA SPORTS FC 26"}
    return await flow.create_tournament(**{**fields, **overrides})


def png_size(content: bytes) -> tuple[int, int]:
    image = Image.open(io.BytesIO(content))
    assert image.format == "PNG"
    return image.size


@pytest.mark.asyncio
async def test_solo_result_has_both_images_page_data_and_link_preview(flow):
    me = await public_user(flow, "neonfalke")
    rival = await public_user(flow, "lunabyte")
    hidden = await public_user(flow, "schattenwolf", public=False)
    event = {"id": new_id(), "name": "LAN-Wochenende Herbst"}
    await flow.db.events.insert_one(dict(event))
    cup = await finished_cup(flow, event_id=event["id"])
    mine = await flow.register(cup, me)
    await flow.db.tournament_registrations.update_one({"id": mine["id"]}, {"$set": {"final_position": 2}})
    rival_reg = await flow.register(cup, rival)
    hidden_reg = await flow.register(cup, hidden)
    await flow.register(cup, await public_user(flow, "pixelotter"))
    await duel(flow, cup, mine, rival_reg, 2, 1, round_no=1)
    await duel(flow, cup, mine, hidden_reg, 1, 2, round_no=2)

    flow.act_as(None)
    res = await flow.get(f"/api/share/result/{cup['slug']}/neonfalke")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["headline"] == "Platz 2 im FC 26 Herbst-Cup"
    assert data["share_text"] == "Ich habe Platz 2 im FC 26 Herbst-Cup geholt – bei THE LION SQUAD."
    assert data["chips"] == ["Halbfinale 2:1", "Finale 1:2"]
    assert [step["outcome"] for step in data["steps"]] == ["win", "loss"]
    assert data["event_name"] == "LAN-Wochenende Herbst" and data["date"] == "20.09.2026"
    assert data["participant_count"] == 4 and data["participant_word"] == "Spieler" and data["team_name"] is None
    assert data["path"] == f"/tournaments/{cup['slug']}/ergebnis/neonfalke"
    # Gegner stehen nicht drauf - auch kein privates Profil über einen Umweg.
    assert "schattenwolf" not in json.dumps(data) and "lunabyte" not in json.dumps(data)
    # Über die Turnier-ID geht es auch (der Knopf kennt manchmal nur die).
    assert (await flow.get(f"/api/share/result/{cup['id']}/neonfalke")).json()["path"] == data["path"]

    story = await flow.get(data["image_paths"]["story"])
    assert story.status_code == 200 and story.headers["content-type"] == "image/png"
    assert png_size(story.content) == (1080, 1920)
    wide = await flow.get(data["image_paths"]["wide"])
    assert png_size(wide.content) == (1200, 630) and "ergebnis-" in wide.headers["content-disposition"]
    assert (await flow.get(f"/api/share/result/{cup['slug']}/neonfalke/quadrat.png")).status_code == 422

    meta = (await flow.get(f"/api/seo/meta?path={data['path']}")).json()
    assert meta["image"].endswith(data["image_paths"]["wide"])
    assert meta["canonical"].endswith(data["path"]) and meta["robots"] == "noindex, follow"
    assert "Platz 2 im FC 26 Herbst-Cup" in meta["title"] and "neonfalke" in meta["title"]
    html = (await flow.get(f"/api/seo/preview?path={data['path']}")).text
    assert data["image_paths"]["wide"] in html and 'property="og:image"' in html


@pytest.mark.asyncio
async def test_nothing_private_gets_an_image_and_the_button_says_why(flow):
    me = await public_user(flow, "neonfalke", public=False)
    other = await public_user(flow, "lunabyte")
    stranger = await public_user(flow, "zuschauer")
    cup = await finished_cup(flow)
    mine = await flow.register(cup, me)
    theirs = await flow.register(cup, other)
    await duel(flow, cup, mine, theirs, 3, 0, round_no=1)

    flow.act_as(None)
    # Privates Profil: weder Seite noch Bild noch Vorschau.
    assert (await flow.get(f"/api/share/result/{cup['slug']}/neonfalke")).status_code == 404
    assert (await flow.get(f"/api/share/result/{cup['slug']}/neonfalke/story.png")).status_code == 404
    assert (await flow.get(f"/api/seo/meta?path=/tournaments/{cup['slug']}/ergebnis/neonfalke")).status_code == 404

    flow.act_as(me)
    options = (await flow.get(f"/api/share/result-options/{cup['id']}")).json()
    assert options["shareable"] is False and options["reason"] == "private_profile" and "Privatsphäre" in options["text"]
    flow.act_as(stranger)
    assert (await flow.get(f"/api/share/result-options/{cup['id']}")).json()["reason"] == "not_participant"
    assert (await flow.get(f"/api/share/result/{cup['slug']}/zuschauer")).status_code == 404
    flow.act_as(other)
    options = (await flow.get(f"/api/share/result-options/{cup['slug']}")).json()
    assert options["shareable"] is True and options["path"] == f"/tournaments/{cup['slug']}/ergebnis/lunabyte"
    assert options["image_paths"]["story"].endswith("/lunabyte/story.png")

    # Noch ohne Ergebnis: kein Teilen, der Knopf sagt es.
    running = await flow.create_tournament(title="Mittwochs-Cup", status="live")
    await flow.register(running, other)
    assert (await flow.get(f"/api/share/result-options/{running['id']}")).json()["reason"] == "not_finished"
    assert (await flow.get(f"/api/share/result/{running['slug']}/lunabyte")).status_code == 404

    # Turnier nur für Mitglieder: kein öffentliches Bild.
    members_only = await finished_cup(flow, visibility="members")
    await flow.register(members_only, other)
    assert (await flow.get(f"/api/share/result-options/{members_only['id']}")).json()["reason"] == "not_public"
    flow.act_as(None)
    assert (await flow.get(f"/api/share/result/{members_only['slug']}/lunabyte/wide.png")).status_code == 404
    assert (await flow.get(f"/api/share/result-options/{cup['id']}")).status_code == 401


@pytest.mark.asyncio
async def test_team_result_shows_the_team_name_for_every_member_and_heat_places(flow):
    captain = await public_user(flow, "neonfalke")
    bench = await public_user(flow, "lunabyte")
    team = {"id": new_id(), "name": "Lions Rocket", "tag": "LRK", "leader_id": captain["id"], "member_ids": [captain["id"], bench["id"]], "is_public": True}
    await flow.db.teams.insert_one(dict(team))
    for user in (captain, bench):
        await flow.db.team_members.insert_one({"team_id": team["id"], "user_id": user["id"], "role": "member"})
    race = await finished_cup(flow, title="Rocket Rennen", team_mode="team", team_size=2, format="ffa")
    ours = {"id": new_id(), "tournament_id": race["id"], "team_id": team["id"], "user_id": captain["id"], "display_name": "[LRK] Lions Rocket",
            "status": "approved", "lineup": [captain["id"]], "final_position": 1}
    await flow.db.tournament_registrations.insert_one(dict(ours))
    others = []
    for name in ("Nordlicht", "Sturmvogel", "Eisbären"):
        reg = {"id": new_id(), "tournament_id": race["id"], "team_id": new_id(), "display_name": name, "status": "approved"}
        await flow.db.tournament_registrations.insert_one(dict(reg))
        others.append(reg)
    await heat(flow, race, [others[0], ours, others[1], others[2]], round_no=1)
    await heat(flow, race, [ours, others[0], others[1]], round_no=2)

    flow.act_as(None)
    # Auch wer nicht in der Aufstellung stand, teilt das Ergebnis seines Teams.
    data = (await flow.get(f"/api/share/result/{race['slug']}/lunabyte")).json()
    assert data["team_name"] == "Lions Rocket" and data["participant_word"] == "Teams" and data["rank"] == 1
    assert data["kind"] == "heats" and data["chips"] == ["Runde 1: Platz 2", "Finale: Platz 1"]
    assert data["share_text"] == "Lions Rocket hat Platz 1 im Rocket Rennen geholt – bei THE LION SQUAD."
    assert png_size((await flow.get(data["image_paths"]["story"])).content) == (1080, 1920)
    assert png_size((await flow.get(data["image_paths"]["wide"])).content) == (1200, 630)

    # Ein privates Team: das Ergebnis bleibt teilbar, aber ohne Teamnamen - dann steht die Person drauf.
    await flow.db.teams.update_one({"id": team["id"]}, {"$set": {"is_public": False}})
    data = (await flow.get(f"/api/share/result/{race['slug']}/neonfalke")).json()
    assert data["team_name"] is None and "Lions Rocket" not in json.dumps(data)
    assert data["share_text"].startswith("Ich habe Platz 1")


def test_images_stay_whole_with_long_names_no_rank_and_many_rounds():
    payload = {
        "tournament": {"id": "t", "slug": "t", "title": "Ein sehr langer Turniername, der in keine Zeile passt, egal wie groß das Bild ist"},
        "event_name": "Vereinsabend mit ganz besonders langem Namen", "date": "20.09.2026",
        "user": {"username": "neonfalke", "display_name": "Neonfalke mit einem außerordentlich langen Anzeigenamen"},
        "team_name": None, "rank": None, "participant_count": 64, "participant_word": "Spieler", "kind": "knockout",
        "steps": [], "chips": [f"Runde {n} 2:1" for n in range(1, 9)], "club_name": "THE LION SQUAD", "domain": "lionsquad.at",
    }
    assert png_size(result_share.render(payload, "story")) == (1080, 1920)
    assert png_size(result_share.render(payload, "wide")) == (1200, 630)
    assert result_share.headline(payload).startswith("Dabei beim ")
    assert png_size(result_share.render({**payload, "rank": 3, "team_name": "Lions Rocket"}, "story")) == (1080, 1920)


def test_draw_and_group_steps_read_like_the_table():
    # Der Turnierbaum schreibt ein Unentschieden als zwei Plätze 1.
    assert _outcome({"rank": 1, "score": 1}, {"rank": 1, "score": 1}) == "draw"
    assert _outcome({"rank": 1, "outcome": "winner"}, {"rank": 2}) == "win"
    assert _outcome({"rank": 2}, {"rank": 1}) == "loss"
    assert chip_text({"kind": "table", "label": "Gruppe A", "result": "2 Siege, 1 Unentschieden, 0 Niederlagen"}) == "Gruppe A: 2 Siege, 1 Unentschieden, 0 Niederlagen"
    assert chip_text({"kind": "heat", "label": "Finale", "rank": 1}) == "Finale: Platz 1"
    assert chip_text({"kind": "duel", "label": "Viertelfinale", "result": "kampflos"}) == "Viertelfinale kampflos"


@pytest.mark.asyncio
async def test_group_stage_counts_wins_draws_and_losses(flow):
    me = await public_user(flow, "neonfalke")
    league = await finished_cup(flow, title="Herbst-Liga", format="round_robin")
    mine = await flow.register(league, me)
    a, b, c = [await flow.register(league, await public_user(flow, name)) for name in ("lunabyte", "pixelotter", "sternfeuer")]
    await duel(flow, league, mine, a, 2, 0, round_no=1, section="round_robin")
    await duel(flow, league, mine, b, 1, 1, round_no=2, section="round_robin")
    await duel(flow, league, mine, c, 0, 3, round_no=3, section="round_robin")
    flow.act_as(None)
    data = (await flow.get(f"/api/share/result/{league['slug']}/neonfalke")).json()
    assert data["kind"] == "table"
    assert data["chips"] == ["Liga: 1 Sieg, 1 Unentschieden, 1 Niederlage"]


def warn_pixels(content: bytes) -> int:
    """Pixel im Farbton der Warnfarbe (#FF9F43) - auch halb durchsichtig auf dunklem Grund; Gold, Bronze und Cyan nicht."""
    return sum(1 for red, green, blue in Image.open(io.BytesIO(content)).convert("RGB").getdata()
               if red > 60 and 0.5 < green / red < 0.75 and 0.15 < blue / red < 0.4)


@pytest.mark.asyncio
async def test_a_contested_result_reads_in_clarification_and_the_decision_redraws(flow):
    """#2363: Ein angefochtenes Ergebnis (E.2, ``contested``) steht auf Karte und Vorschau „in Klärung“ wie auf der
    Ligaseite. Nach dem Entscheid ist die Karte wieder ohne Hinweis - der Zwischenspeicher zeichnet sofort neu."""
    me = await public_user(flow, "neonfalke")
    rival = await public_user(flow, "lunabyte")
    cup = await finished_cup(flow)
    mine = await flow.register(cup, me)
    rival_reg = await flow.register(cup, rival)
    await duel(flow, cup, mine, rival_reg, 2, 1, round_no=1)
    await duel(flow, cup, mine, rival_reg, 1, 2, round_no=2)
    final = await flow.db.matches_v2.find_one({"tournament_id": cup["id"], "round": 2}, {"_id": 0, "id": 1})
    flow.act_as(None)
    url = f"/api/share/result/{cup['slug']}/neonfalke"
    plain = (await flow.get(url)).json()
    assert plain["chips"] == ["Halbfinale 2:1", "Finale 1:2"] and all("contested" not in step for step in plain["steps"])
    plain_story = (await flow.get(plain["image_paths"]["story"])).content
    assert warn_pixels(plain_story) == 0

    await flow.db.matches_v2.update_one({"id": final["id"]}, {"$set": {"contested": True}})
    data = (await flow.get(url)).json()
    assert data["chips"] == ["Halbfinale 2:1", "Finale 1:2 · in Klärung"]
    assert [step.get("contested") for step in data["steps"]] == [None, True]
    story = (await flow.get(data["image_paths"]["story"])).content
    wide = (await flow.get(data["image_paths"]["wide"])).content
    assert story != plain_story and warn_pixels(story) > 200 and warn_pixels(wide) > 200
    assert png_size(story) == (1080, 1920) and png_size(wide) == (1200, 630)
    meta = (await flow.get(f"/api/seo/meta?path={data['path']}")).json()
    assert "Finale 1:2 · in Klärung" in meta["description"]

    # Entscheid: Das Ergebnis bleibt und gilt - die Karte ist sofort wieder die ohne Hinweis.
    await flow.db.matches_v2.update_one({"id": final["id"]}, {"$set": {"contested": False}})
    decided = (await flow.get(url)).json()
    assert decided["chips"] == plain["chips"] and decided["steps"] == plain["steps"]
    assert (await flow.get(decided["image_paths"]["story"])).content == plain_story


@pytest.mark.asyncio
async def test_a_contested_league_game_counts_on_the_table_step(flow):
    me = await public_user(flow, "neonfalke")
    league = await finished_cup(flow, title="Herbst-Liga", format="round_robin")
    mine = await flow.register(league, me)
    a, b = [await flow.register(league, await public_user(flow, name)) for name in ("lunabyte", "pixelotter")]
    await duel(flow, league, mine, a, 2, 0, round_no=1, section="round_robin")
    await duel(flow, league, mine, b, 0, 3, round_no=2, section="round_robin")
    await flow.db.matches_v2.update_many({"tournament_id": league["id"], "round": 2}, {"$set": {"contested": True}})
    flow.act_as(None)
    data = (await flow.get(f"/api/share/result/{league['slug']}/neonfalke")).json()
    assert data["chips"] == ["Liga: 1 Sieg, 1 Niederlage · 1 Spiel in Klärung"]
    assert data["steps"][0]["contested"] == 1 and data["steps"][0]["result"] == "1 Sieg, 1 Niederlage"


def test_rows_with_clarification_take_more_room_and_still_fit():
    rows = [{"label": f"Runde {n}", "result": "2:1", "kind": "duel"} for n in range(1, 6)]
    assert result_share._rows_that_fit(rows, 5 * 92) == rows
    assert result_share._rows_that_fit(rows, 5 * 92 - 1) == rows[2:], "eine Zeile weniger plus der Hinweis"
    contested = [*rows[:4], {**rows[4], "contested": True}]
    assert result_share._rows_that_fit(contested, 5 * 92) == contested[2:]
    assert result_share._rows_that_fit(contested, 5 * 92 + result_share.CLARIFICATION_ROW) == contested
    payload = {
        "tournament": {"id": "t", "slug": "t", "title": "Herbst-Liga"}, "event_name": None, "date": "20.09.2026",
        "user": {"username": "neonfalke", "display_name": "Neonfalke"}, "team_name": None, "rank": 2, "participant_count": 8,
        "participant_word": "Spieler", "kind": "knockout", "steps": contested, "chips": [f"Runde {n} 2:1" for n in range(1, 6)],
        "club_name": "THE LION SQUAD", "domain": "lionsquad.at",
    }
    assert warn_pixels(result_share.render(payload, "story")) > 200 and warn_pixels(result_share.render(payload, "wide")) > 200
    assert warn_pixels(result_share.render({**payload, "steps": rows}, "story")) == 0
    assert warn_pixels(result_share.render({**payload, "steps": rows}, "wide")) == 0
