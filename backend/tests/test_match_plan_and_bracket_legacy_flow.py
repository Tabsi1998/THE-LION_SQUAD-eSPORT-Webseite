"""Turnierbaum und Spielplanung: die noch gültigen Fälle der alten Live-Tests (#2395), jetzt durch die echten Routen.

Vertrag:
- Den Turnierbaum eines öffentlichen Turniers sehen Gäste über die Kennung und über den Slug gleich; ein unbekanntes
  Turnier ist 404.
- Der Turnierbaum-TV ohne Anzeige-Schlüssel ist nur für die Turnierleitung: Gäste 401, Spielende 403.
- Termin und Dauer eines Spiels setzt die Turnierleitung; ein offenes Spiel gilt danach als „geplant“, dieselbe Planung
  noch einmal ändert nichts, und mitgeschickte Ergebnisfelder bleiben wirkungslos - das Ergebnis hat seinen eigenen Weg.
  Ein unbekanntes Spiel ist 404, Gäste 401, Spielende 403.
Erfundene Personen und Turniere.

Ersetzt:
- test_iter3_achievements_bracket.py::TestPublicBracket::test_public_bracket_by_id_and_slug
- test_iter3_achievements_bracket.py::TestPublicBracket::test_public_bracket_unknown_id_404
- test_iter3_achievements_bracket.py::TestPublicBracket::test_bracket_display_forbidden_for_plain_player
- test_iter3_achievements_bracket.py::TestPublicBracket::test_bracket_display_for_admin
- test_iter5_taxonomy_premium.py::TestBracketDisplay::test_bracket_display_returns_matches
- test_iter5_taxonomy_premium.py::TestBracketDisplay::test_public_bracket_by_slug
- test_iter6_google_gallery.py::TestBracket::test_bracket_loads
- test_iter7_fixes.py::TestBracketDisplay::test_bracket_display_ok
- test_live_preview_validation.py::TestPublicEndpoints::test_unknown_tournament_404
- test_phase1_unified_match.py::TestUnifiedMatchWritePath::test_unified_patch_schedule
- test_phase1_unified_match.py::TestUnifiedMatchWritePath::test_unified_patch_unknown_match_404
- test_phase1_unified_match.py::TestUnifiedMatchWritePath::test_unified_write_requires_auth
- test_phase1_unified_match.py::TestUnifiedV2Path (beide Fälle)
- test_phase1_v2_unified_seeded.py::TestUnifiedV2Branch::test_v2_schedule_patch_via_unified_route
- test_phase1_v2_unified_seeded.py::TestUnifiedV2Branch::test_v2_idempotent_replay
- test_phase1_v2_unified_seeded.py::TestUnifiedV2Branch::test_v2_result_fields_stripped
- test_phase1_v2_unified_seeded.py::TestUnifiedV2Branch::test_v2_get_match_via_unified_route
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

WHEN = "2026-12-05T19:00:00+00:00"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    # Wie database.py beim Start: eine Sperre je Ressource.
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


async def drawn(flow):
    """Ein öffentliches Turnier mit vier Spielenden und gezogenem Baum (drei Spiele)."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, _registrations = await flow.with_participants(4, result_entry_mode="staff_only")
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    matches = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))
    assert len(matches) == 3
    return staff, tournament, users, matches


def match_ids(payload: dict) -> set[str]:
    return {row["id"] for row in payload.get("matches_v2") or []}


@pytest.mark.asyncio
async def test_guests_open_the_bracket_by_id_and_by_slug_and_unknown_tournaments_are_404(flow):
    _staff, tournament, _users, matches = await drawn(flow)
    flow.act_as(None)

    by_id = await flow.get(f"/api/tournaments/{tournament['id']}/bracket")
    by_slug = await flow.get(f"/api/tournaments/{tournament['slug']}/bracket")
    assert by_id.status_code == 200 and by_slug.status_code == 200, (by_id.text[:200], by_slug.text[:200])
    assert match_ids(by_id.json()) == match_ids(by_slug.json()) == {row["id"] for row in matches}

    assert (await flow.get("/api/tournaments/gibt-es-nicht/bracket")).status_code == 404
    assert (await flow.get("/api/tournaments/gibt-es-nicht")).status_code == 404


@pytest.mark.asyncio
async def test_the_tv_board_without_a_key_is_only_for_the_tournament_lead(flow):
    staff, tournament, users, matches = await drawn(flow)
    url = f"/api/tournaments/{tournament['id']}/bracket/display"

    flow.act_as(None)
    assert (await flow.get(url)).status_code == 401
    flow.act_as(users[0])
    assert (await flow.get(url)).status_code == 403, "Mitspielen macht niemanden zur Turnierleitung"
    flow.act_as(staff)
    board = await flow.get(url)
    assert board.status_code == 200, board.text[:300]
    assert board.json()["tournament"]["id"] == tournament["id"] and match_ids(board.json()) == {row["id"] for row in matches}


@pytest.mark.asyncio
async def test_planning_a_match_schedules_it_once_and_never_touches_the_result(flow):
    staff, _tournament, users, matches = await drawn(flow)
    match = matches[0]
    url = f"/api/matches/{match['id']}"
    plan = {"scheduled_at": WHEN, "duration_minutes": 25}
    assert match["status"] in {"pending", "ready"}

    flow.act_as(None)
    assert (await flow.patch(url, json=plan)).status_code == 401
    flow.act_as(users[0])
    assert (await flow.patch(url, json=plan)).status_code == 403
    flow.act_as(staff)
    assert (await flow.patch("/api/matches/gibt-es-nicht", json=plan)).status_code == 404

    planned = await flow.patch(url, json=plan)
    assert planned.status_code == 200, planned.text[:300]
    body = planned.json()
    assert body["status"] == "scheduled" and body["duration_minutes"] == 25 and body["idempotent_replay"] is False
    assert str(body["scheduled_at"]).startswith("2026-12-05T19:00")
    again = await flow.patch(url, json=plan)
    assert again.status_code == 200 and again.json()["idempotent_replay"] is True

    sneaky = await flow.patch(url, json={"duration_minutes": 30, "score_a": 99, "score_b": 98, "winner_id": users[0]["id"]})
    assert sneaky.status_code == 200, sneaky.text[:300]
    stored = await flow.reload(match)
    assert stored["duration_minutes"] == 30 and stored["status"] == "scheduled"
    assert not stored.get("results") and not stored.get("winner_id") and "score_a" not in stored
    shown = await flow.get(url)
    assert shown.status_code == 200 and shown.json()["id"] == match["id"]
