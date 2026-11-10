"""Was als Spiel zählt (#2337): Spielmacher, Sieger und Siegesserie über kanonische Spiele.

Ein Freilos ist kein Spiel und reißt keine Serie; ein kampflos gewertetes Spiel zählt für den Sieger als Spiel und
Sieg, wer nicht erschienen ist, bekommt nichts. Die Regel selbst steht in ``services.match_winner``."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.competition_snapshot import adapt_stage_matches  # noqa: E402
from services.competition_standings import registration_badge_match_progress  # noqa: E402


def duel(match_id: str, winner: str, loser: str, when: str, **extra) -> dict:
    return {
        "id": match_id, "tournament_id": "t1", "stage_id": "s1", "round": 1, "advancement": [], "status": "completed",
        "slots": [{"slot": 1, "registration_id": winner, "status": "filled"}, {"slot": 2, "registration_id": loser, "status": "filled"}],
        "results": [{"registration_id": winner, "rank": 1}, {"registration_id": loser, "rank": 2}],
        "completed_at": when, "updated_at": when, **extra,
    }


def bye(match_id: str, registration: str, when: str) -> dict:
    return {
        "id": match_id, "tournament_id": "t1", "stage_id": "s1", "round": 1, "advancement": [], "status": "completed",
        "slots": [{"slot": 1, "registration_id": registration, "status": "filled"}, {"slot": 2, "registration_id": None, "status": "bye"}],
        "results": [{"registration_id": registration, "rank": 1}], "result_meta": {"source": "auto_bye"},
        "completed_at": when, "updated_at": when,
    }


def test_freilos_ist_kein_spiel_und_reisst_die_serie_nicht():
    stage = adapt_stage_matches([
        duel("a", "r1", "r2", "2026-10-01T10:00:00+00:00"),
        bye("b", "r1", "2026-10-02T10:00:00+00:00"),
        duel("c", "r1", "r2", "2026-10-03T10:00:00+00:00"),
    ])
    assert registration_badge_match_progress(stage, {"r1"}) == {"matches_played": 2, "matches_won": 2, "match_streak_max": 2}


def test_nur_freilose_sind_gar_nichts():
    stage = adapt_stage_matches([bye("a", "r1", "2026-10-01T10:00:00+00:00"), bye("b", "r1", "2026-10-02T10:00:00+00:00")])
    assert registration_badge_match_progress(stage, {"r1"}) == {"matches_played": 0, "matches_won": 0, "match_streak_max": 0}


def test_kampflos_zaehlt_fuer_den_sieger_als_spiel_und_sieg():
    walkover = duel("w", "r1", "r2", "2026-10-02T10:00:00+00:00", status="forfeit", forfeit_registration_id="r2")
    walkover["results"][1]["forfeit"] = True
    stage = adapt_stage_matches([
        duel("a", "r2", "r3", "2026-10-01T10:00:00+00:00"),
        walkover,
        duel("c", "r2", "r3", "2026-10-03T10:00:00+00:00"),
    ])
    assert registration_badge_match_progress(stage, {"r1"}) == {"matches_played": 1, "matches_won": 1, "match_streak_max": 1}
    # Wer nicht erschienen ist, bekommt kein Spiel - die Serie davor und danach hängt trotzdem nicht zusammen.
    assert registration_badge_match_progress(stage, {"r2"}) == {"matches_played": 2, "matches_won": 2, "match_streak_max": 1}


def test_laufende_und_abgesagte_spiele_zaehlen_nicht():
    stage = adapt_stage_matches([
        duel("a", "r1", "r2", "2026-10-01T10:00:00+00:00", status="cancelled"),
        duel("b", "r1", "r2", "2026-10-02T10:00:00+00:00", status="disputed"),
        duel("c", "r1", "r2", "2026-10-03T10:00:00+00:00"),
    ])
    assert registration_badge_match_progress(stage, {"r1"}) == {"matches_played": 1, "matches_won": 1, "match_streak_max": 1}
