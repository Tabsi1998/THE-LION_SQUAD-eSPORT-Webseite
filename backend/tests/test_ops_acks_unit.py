"""Die Regel „quittiert, bis es wieder auftritt“ (#2447) und die Upload-Routen der langsamen Anfragen - ohne Datenbank."""
from services import ops_acks, ops_alerts, ops_upload_routes


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


def test_upload_routes_match_exactly_or_by_prefix_and_only_for_writes():
    patterns = ops_upload_routes.DEFAULT_UPLOAD_ROUTES
    assert ops_upload_routes.is_upload({"route": "/api/admin/app-releases", "method": "POST"}, patterns)
    assert ops_upload_routes.is_upload({"route": "/api/uploads/image", "method": "POST"}, patterns)
    assert ops_upload_routes.is_upload({"route": "/api/teams", "method": "GET", "upload": True}, patterns), "selbst erkannt"
    assert not ops_upload_routes.is_upload({"route": "/api/admin/app-releases/{release_id}", "method": "POST"}, patterns)
    assert not ops_upload_routes.is_upload({"route": "/api/teams", "method": "POST"}, patterns)
    # Review #2447 (N5): ohne Methode nur POST/PUT - ein langsames GET derselben Route bleibt langsam.
    assert not ops_upload_routes.is_upload({"route": "/api/admin/app-releases", "method": "GET"}, patterns)
    assert ops_upload_routes.is_upload({"route": "/api/x", "method": "PATCH"}, ["PATCH /api/x"])
    assert not ops_upload_routes.is_upload({"route": "/api/x", "method": "POST"}, ["PATCH /api/x"])


def test_upload_route_settings_are_checked():
    clean = ops_upload_routes.clean_upload_routes
    assert ops_alerts.merge_settings({})["upload_routes"] == list(ops_upload_routes.DEFAULT_UPLOAD_ROUTES)
    assert ops_alerts.merge_settings({"upload_routes": []})["upload_routes"] == [], "leer gespeichert heißt leer, nicht Vorgabe"
    assert clean("/api/a\n\n /api/b/* \n/api/a\npatch   /api/c") == ["/api/a", "/api/b/*", "PATCH /api/c"]
    for bad in ("api/a", "/api/a b", "/api/*/x", "/x", "/api/*", "/api/admin/*", "GET /api/*", "/api/"):
        try:
            clean([bad])
        except ValueError:
            continue
        raise AssertionError(bad)


def test_upload_route_list_stops_early():
    """Höchstens 40 Zeilen - der 41. Eintrag bricht ab, ohne die übrigen Tausend erst anzusehen."""
    clean = ops_upload_routes.clean_upload_routes
    assert len(clean([f"/api/r{n}" for n in range(40)])) == 40

    class Endless:
        seen = 0

        def __iter__(self):
            while True:
                Endless.seen += 1
                yield f"/api/r{Endless.seen}"

    try:
        clean(Endless())
    except ValueError as exc:
        assert "40" in str(exc)
    else:
        raise AssertionError("keine Grenze")
    assert Endless.seen == 41


def test_the_open_rule_in_the_database_equals_the_python_rule():
    """Review #2447 (N6): ``open_filter`` (Mongo) und ``ack_valid`` (Python) sagen dasselbe."""
    import mongomock

    spec = ops_acks.SPECS["client"]
    rows = [
        {"id": "never", "received_at": "2026-11-16T10:00:00+00:00"},
        {"id": "acked", "received_at": "2026-11-16T10:00:00+00:00", "acknowledged_at": "2026-11-16T11:00:00+00:00"},
        {"id": "again", "received_at": "2026-11-16T12:00:00+00:00", "acknowledged_at": "2026-11-16T11:00:00+00:00"},
        {"id": "fallback", "created_at": "2026-11-16T12:00:00+00:00", "acknowledged_at": "2026-11-16T11:00:00+00:00"},
    ]
    collection = mongomock.MongoClient().db.rows
    collection.insert_many([dict(row) for row in rows])
    in_mongo = sorted(row["id"] for row in collection.find(ops_acks.open_filter(spec)))
    in_python = sorted(row["id"] for row in rows if not ops_acks.ack_valid(row, spec.time_keys))
    assert in_mongo == in_python == ["again", "fallback", "never"]
