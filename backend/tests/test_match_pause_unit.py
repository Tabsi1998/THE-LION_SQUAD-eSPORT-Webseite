"""Turnierpause und Spielzeit-Uhr (#1167): reine Rechnung - Pausendauer je Spiel und „über der Zeit“ ohne Pause."""
from datetime import datetime, timedelta, timezone

from services.match_pause import clock_pause_fields, with_clock_pause
from services.match_timing import overlap_seconds, pause_seconds, timing

START = datetime(2026, 10, 31, 16, 0, tzinfo=timezone.utc)


def running(minutes_ago_start=0, **extra):
    return {"id": "m1", "status": "in_progress", "station_id": "s1",
            "started_at": (START + timedelta(minutes=minutes_ago_start)).isoformat(), **extra}


def test_the_running_pause_counts_from_its_start_or_from_the_match_start():
    now = START + timedelta(minutes=30)
    paused_at = (START + timedelta(minutes=25)).isoformat()
    assert overlap_seconds(running(), paused_at, now) == 300
    # Erst in der Pause gestartet: nur ab dem eigenen Start.
    assert overlap_seconds(running(28), paused_at, now) == 120
    assert overlap_seconds(running(), None, now) == 0


def test_pause_seconds_adds_earlier_pauses_and_only_counts_running_matches():
    now = START + timedelta(minutes=30)
    tournament = {"paused_at": (START + timedelta(minutes=25)).isoformat()}
    assert pause_seconds(running(paused_seconds=60), tournament, now) == 360
    assert pause_seconds(running(paused_seconds=60), {}, now) == 60
    assert pause_seconds({**running(paused_seconds=60), "status": "completed"}, tournament, now) == 60
    assert pause_seconds(running(paused_seconds="kaputt"), {}, now) == 0


def test_the_clock_fields_carry_the_pause_only_for_running_matches():
    tournament = {"paused_at": "2026-10-31T16:25:00+00:00"}
    assert clock_pause_fields(running(paused_seconds=90), tournament) == {"paused_at": "2026-10-31T16:25:00+00:00", "paused_seconds": 90}
    assert clock_pause_fields({"status": "pending"}, tournament) == {"paused_at": None, "paused_seconds": 0}
    rows = with_clock_pause([running(), {"id": "m2", "status": "pending"}], tournament)
    assert rows[0]["paused_at"] == "2026-10-31T16:25:00+00:00" and "paused_at" not in rows[1]


def test_timing_leaves_the_pause_out_of_running_and_overdue():
    """20 Minuten Dauer (Spiel), 25 Minuten seit dem Start, davon 5 Minuten Pause: läuft 20, nicht über der Zeit."""
    match = running(duration_minutes=20, paused_seconds=300)
    out = timing(match, {}, START + timedelta(minutes=25))
    assert out["running_minutes"] == 20 and out["overdue_minutes"] is None and out["missing"] is False
    # Die laufende Pause zählt genauso: nach 10 Minuten Pause ist noch nichts fällig.
    paused = {"paused_at": (START + timedelta(minutes=15)).isoformat()}
    out = timing(running(duration_minutes=20), paused, START + timedelta(minutes=40))
    assert out["running_minutes"] == 15 and out["missing"] is False
    # Ohne Pause wie bisher.
    out = timing(running(duration_minutes=20), {}, START + timedelta(minutes=30))
    assert out["running_minutes"] == 30 and out["overdue_minutes"] == 10 and out["missing"] is True


def test_every_new_start_resets_the_pause():
    """Wächter (#1167): Wer ``started_at`` neu setzt (Check-in-Start, Start mit Meldung, Start an der Station), schreibt
    ``FRESH_CLOCK`` mit - sonst zöge die Uhr nach einem Reset eine alte Pause ab."""
    import pathlib

    root = pathlib.Path(__file__).resolve().parent.parent
    starts = []
    for rel in ("services/match_flow.py", "routes/station_routes.py"):
        lines = (root / rel).read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            if '{"$set": {"started_at": now_iso' in line or 'match_updates["started_at"] = now_iso' in line:
                window = "\n".join(lines[index:index + 3])
                starts.append((rel, index + 1, "FRESH_CLOCK" in window))
    assert len(starts) == 3, starts
    assert [row for row in starts if not row[2]] == []


def test_a_pairing_reset_drops_the_old_pause():
    from services.match_v2_results import _pairing_reset_fields

    fields = _pairing_reset_fields({"paused_seconds": 300, "pause_settled_for": "2026-10-31T16:00:00+00:00"}, "now")
    assert fields["started_at"] is None and fields["paused_seconds"] == 0 and fields["pause_settled_for"] is None
