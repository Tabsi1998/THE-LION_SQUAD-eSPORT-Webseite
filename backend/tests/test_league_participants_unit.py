"""Teilnehmerart einer Liga (#1629, P1): Co-Teams oder Spieler - ohne Datenbank.

Ohne Feld ist jede Liga eine Team-Liga (Bestand vor #1629). Solo prüft das Spiel (``supports_solo``), legt 1 gegen 1 als Vorgabe über eine
neue Season und sperrt, was es für Spieler erst später gibt (Selbstanmeldung, Spielbetrieb).
"""
import asyncio
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_applications, league_participants as lp, staffel_guard  # noqa: E402

SOLO = {"participant_kind": "solo"}


def test_a_league_without_the_field_is_a_team_league():
    assert lp.kind_of(None) == lp.TEAM
    assert lp.kind_of({}) == lp.TEAM
    assert lp.kind_of({"participant_kind": "duo"}) == lp.TEAM
    assert lp.kind_of(SOLO) == lp.SOLO and lp.is_solo(SOLO)


def test_solo_needs_a_game_with_single_players_team_leagues_never_ask():
    assert lp.game_allows({"supports_solo": False}, lp.TEAM)
    assert not lp.game_allows({"supports_solo": False}, lp.SOLO)
    # Ohne Feld wie im Spiel-Modell (``supports_solo: bool = True``).
    assert lp.game_allows({}, lp.SOLO)
    assert lp.game_problem({"name": "Probe Duell", "supports_solo": False}, lp.SOLO).startswith("Probe Duell ist nicht für Einzelspieler")
    assert lp.game_problem({"supports_solo": False}, lp.TEAM) is None


def test_solo_season_defaults_and_their_limits():
    assert lp.season_defaults({}) == {}
    assert lp.season_defaults(SOLO) == {"team_size": 1, "min_squad_size": 1, "max_squad_size": 1, "lineup_min_players": 1}
    assert lp.season_problem(SOLO, {"team_size": 1, "min_squad_size": 1, "max_staffel_size": 12, "min_age": 16}) is None
    assert lp.season_problem(SOLO, {"team_size": 2}) == lp.TEAM_SIZE_SOLO
    assert lp.season_problem(SOLO, {"team_size": 1, "min_squad_size": 3}) == lp.SQUAD_SIZE_SOLO
    # Seit P2 gibt es das Anmeldefenster auch in der Solo-Liga (Anmeldung als Spieler).
    assert lp.season_problem(SOLO, {"application_opens_at": "2026-11-01T10:00:00Z"}) is None
    # Gegenprobe: eine Team-Liga prüft hier nichts.
    assert lp.season_problem({}, {"team_size": 5, "min_squad_size": 6, "application_opens_at": "2026-11-01T10:00:00Z"}) is None


def test_a_solo_staffel_is_a_solo_tournament_with_league_context():
    assert lp.is_solo_staffel({"league_context": {"season_id": "s"}, "team_mode": "solo"})
    assert not lp.is_solo_staffel({"league_context": {"season_id": "s"}, "team_mode": "team"})
    assert not lp.is_solo_staffel({"team_mode": "solo"})
    assert lp.person_entry("u1") == "user:u1" and lp.person_entry(None) is None


def test_a_solo_staffel_stays_in_draft_until_the_match_flow_exists():
    solo = {"league_context": {"season_id": "s"}, "team_mode": "solo"}
    team = {"league_context": {"season_id": "s"}, "team_mode": "team"}
    for status in ("live", "paused", "completed", "results_published"):
        assert staffel_guard.staffel_status_problem(solo, status) == lp.OPERATIONS_FOLLOW
        assert staffel_guard.staffel_status_problem(team, status) is None
    assert staffel_guard.staffel_status_problem(solo, "draft") is None
    assert staffel_guard.staffel_status_problem(solo, "cancelled") is None


def test_a_solo_season_without_window_has_no_self_registration_like_a_team_season():
    # Seit P2 (#1629) gelten dieselben Gründe wie bei Team-Ligen - ohne Fenster keine Selbstanmeldung.
    season = {"id": "s"}

    assert asyncio.run(league_applications.season_problems(None, SOLO, season)) == [league_applications.NO_WINDOW]
    assert asyncio.run(league_applications.season_problems(None, {}, season)) == [league_applications.NO_WINDOW]


def test_a_person_application_is_told_apart_from_a_team_application():
    assert lp.is_person_application({"user_id": "u1", "squad_id": None})
    assert lp.is_person_application({"user_id": None, "squad_id": None}), "nach der Kontolöschung bleibt es ein Antrag einer Person"
    assert not lp.is_person_application({"squad_id": "q1", "team_id": "t1"})
    assert lp.application_entry({"user_id": "u1", "squad_id": None}) == "user:u1"
    assert lp.application_entry({"squad_id": "q1"}) == "q1"
    assert lp.application_entry({"user_id": None, "squad_id": None}) is None
