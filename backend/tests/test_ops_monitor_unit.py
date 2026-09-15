"""Betriebssicht (#233): was ein Fehler zur Gruppe macht und was nie gespeichert wird."""
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route

from services.ops_monitor import error_fingerprint, route_template, scrub_text, top_frame


def test_tokens_and_addresses_never_reach_the_record():
    raw = "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig bei person@example.test ?token=geheim&x=1"
    safe = scrub_text(raw)
    assert "Bearer [redacted]" in safe
    assert "[redacted-email]" in safe
    assert "geheim" not in safe
    assert "person@example.test" not in safe


def test_the_message_is_cut_to_the_limit():
    assert len(scrub_text("x" * 5000, limit=500)) == 500


def test_same_error_on_same_route_shares_one_fingerprint():
    first = error_fingerprint("KeyError", "/api/teams/{team_id}", "get", "team_routes.py:42")
    second = error_fingerprint("KeyError", "/api/teams/{team_id}", "GET", "team_routes.py:42")
    other_route = error_fingerprint("KeyError", "/api/news/{slug}", "GET", "team_routes.py:42")
    other_line = error_fingerprint("KeyError", "/api/teams/{team_id}", "GET", "team_routes.py:99")
    assert first == second
    assert first != other_route
    assert first != other_line
    assert len(first) == 16


def test_the_route_template_replaces_the_id_with_its_placeholder():
    async def team(request):
        return PlainTextResponse("ok")

    app = Starlette(routes=[Route("/api/teams/{team_id}", team), Route("/api/teams", team)])
    scope = {"type": "http", "method": "GET", "path": "/api/teams/3f9a1b2c4d5e", "root_path": "", "headers": []}
    assert route_template(app, scope) == "/api/teams/{team_id}"
    scope["path"] = "/api/teams"
    assert route_template(app, scope) == "/api/teams"


def test_an_unknown_path_gets_its_ids_masked():
    scope = {"type": "http", "method": "GET", "path": "/api/unbekannt/0123456789abcdef/x", "root_path": "", "headers": []}
    assert route_template(Starlette(routes=[]), scope) == "/api/unbekannt/{id}/x"


def test_a_group_with_one_member_is_recorded_as_that_member():
    from services.ops_monitor import format_stack, unwrap_exception

    try:
        raise ValueError("innen")
    except ValueError as inner:
        group = ExceptionGroup("Hülle", [inner])
    assert type(unwrap_exception(group)).__name__ == "ValueError"
    assert format_stack(unwrap_exception(group)).rstrip().endswith("ValueError: innen")


def test_a_long_stack_keeps_its_end_where_the_message_is():
    from services.ops_monitor import STACK_LIMIT, format_stack

    def tief(n):
        if n == 0:
            raise KeyError("ganz unten")
        return tief(n - 1)

    try:
        tief(400)
    except KeyError as exc:
        text = format_stack(exc)
    assert len(text) <= STACK_LIMIT
    assert text.rstrip().endswith("KeyError: 'ganz unten'")


def test_the_top_frame_points_into_our_code():
    def eigene_funktion():
        raise ValueError("kaputt")

    try:
        eigene_funktion()
    except ValueError as exc:
        frame = top_frame(exc)
    assert frame.startswith("test_ops_monitor_unit.py:")
