"""Die Regel „quittiert, bis es wieder auftritt“ (#2447) und die Upload-Routen der langsamen Anfragen - ohne Datenbank."""
from services import ops_acks, ops_alerts, ops_monitor


def test_an_ack_holds_until_the_problem_occurs_again():
    keys = ("received_at", "created_at")
    assert not ops_acks.ack_valid({"received_at": "2026-11-16T10:00:00+00:00"}, keys), "nie quittiert"
    assert ops_acks.ack_valid({"received_at": "2026-11-16T10:00:00Z", "acknowledged_at": "2026-11-16T10:00:00+00:00"}, keys), "gleiche Zeit, andere Schreibweise"
    assert ops_acks.ack_valid({"received_at": "2026-11-16T09:00:00+00:00", "acknowledged_at": "2026-11-16T10:00:00+00:00"}, keys)
    assert not ops_acks.ack_valid({"received_at": "2026-11-16T10:00:01+00:00", "acknowledged_at": "2026-11-16T10:00:00+00:00"}, keys), "danach wieder aufgetreten"
    assert ops_acks.ack_valid({"created_at": "2026-11-16T09:00:00", "acknowledged_at": "2026-11-16T10:00:00+00:00"}, keys), "ohne Zone gilt UTC, zweiter Zeitschlüssel"


def test_every_ackable_source_says_what_the_same_problem_is():
    for source, spec in ops_acks.SPECS.items():
        assert spec.collection and spec.problem and spec.time_keys and spec.label, source
    assert set(ops_acks.ACKABLE_SOURCES) == {"server", "checks", "alerts", "client", "email", "mail_queue", "uploads", "sync", "bot"}
    assert "audit" not in ops_acks.ACKABLE_SOURCES, "Adminaktionen sind kein Problem"


def test_sync_ack_ends_with_a_green_run_or_another_error():
    error = {"kind": "unauthorized", "text": "401", "at": "2026-11-16T10:00:00+00:00"}
    ack = {"at": "2026-11-16T10:05:00+00:00", "kind": "unauthorized", "text": "401"}
    assert ops_acks.sync_open({"last_error": error})
    assert not ops_acks.sync_open({"last_error": error, "ack": ack})
    assert ops_acks.sync_open({"last_error": {**error, "text": "500"}, "ack": ack})
    assert ops_acks.sync_open({"last_error": error, "ack": ack, "last_ok_at": "2026-11-16T10:06:00+00:00"})
    assert not ops_acks.sync_open({"last_error": None, "ack": ack})


def test_closed_check_states_say_how_they_ended():
    assert ops_acks.episode_resolution({"open": True}) is None
    assert ops_acks.episode_resolution({"closed_at": "t", "closed_by_status": "ok"}) == ("t", "behoben")
    assert ops_acks.episode_resolution({"closed_at": "t", "closed_by_status": "warn"}) == ("t", "abgelöst")
    assert ops_acks.episode_resolution({"closed_at": "t"}) == ("t", "beendet")


def test_upload_routes_match_exactly_or_by_prefix():
    patterns = ops_monitor.DEFAULT_UPLOAD_ROUTES
    assert ops_monitor.is_upload({"route": "/api/admin/app-releases"}, patterns)
    assert ops_monitor.is_upload({"route": "/api/uploads/image"}, patterns)
    assert ops_monitor.is_upload({"route": "/api/teams", "upload": True}, patterns), "selbst erkannt"
    assert not ops_monitor.is_upload({"route": "/api/admin/app-releases/{release_id}"}, patterns)
    assert not ops_monitor.is_upload({"route": "/api/teams"}, patterns)


def test_upload_route_settings_are_checked():
    assert ops_alerts.merge_settings({})["upload_routes"] == list(ops_monitor.DEFAULT_UPLOAD_ROUTES)
    assert ops_alerts.merge_settings({"upload_routes": []})["upload_routes"] == [], "leer gespeichert heißt leer, nicht Vorgabe"
    assert ops_alerts._clean_upload_routes("/api/a\n\n /api/b/* \n/api/a") == ["/api/a", "/api/b/*"]
    for bad in ("api/a", "/api/a b", "/api/*/x", "/x"):
        try:
            ops_alerts._clean_upload_routes([bad])
        except ValueError:
            continue
        raise AssertionError(bad)
