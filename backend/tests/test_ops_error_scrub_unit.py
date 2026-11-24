"""Fehler-Sammler (#1657): was vor dem Speichern übrig bleibt - Fehlerart, Code-Stellen ohne Werte, Pfad ohne Kennungen,
Version. Namen, E-Mail-Adressen, Tokens, IP-Adressen und Inhalte kommen nie in die Datenbank."""
from services.ops_error_scrub import (
    CLIENT_FRAME_LIMIT,
    clean_client_error_type,
    clean_error_type,
    clean_version,
    client_frames,
    client_route,
    server_frames,
    server_route_fallback,
)

NAME = "Max Mustermann"
MAIL = "max.mustermann@example.test"
TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl"
IP = "203.0.113.42"


def _leaks(text: str) -> list[str]:
    return [part for part in (NAME, "Mustermann", MAIL, TOKEN, IP, "geheim") if part in text]


def test_a_browser_stack_keeps_only_the_code_places():
    stack = (
        f"TypeError: Kein Zugriff für {NAME} ({MAIL}) von {IP}\n"
        f"    at renderTeam (https://lionsquad.at/assets/TeamPage-AbC12_x9.js?token={TOKEN}:12:345)\n"
        "    at https://lionsquad.at/assets/index-Zz99yy88.js:1:20\n"
        f"Bearer {TOKEN}\n"
        "loadTeams@https://lionsquad.at/assets/api-QwErTy12.js:7:9\n"
        "    at <anonymous>\n"
    )
    frames = client_frames(stack)
    assert frames.splitlines() == [
        "renderTeam (TeamPage.js:12:345)",
        "index.js:1:20",
        "loadTeams (api.js:7:9)",
    ]
    assert _leaks(frames) == []


def test_a_message_that_looks_like_a_frame_still_loses_its_values():
    # Auch eine Meldung mit „:1:2“ am Ende bringt keinen Namen mit - vom Ort bleibt nur der Dateiname.
    frames = client_frames(f"Error: {NAME} sagt ({MAIL}:1:2)")
    assert _leaks(frames) == []


def test_the_react_component_stack_keeps_component_names():
    frames = client_frames("\n    at TeamCard (https://x.test/assets/TeamCard-12345678.js:3:4)\n    in Suspense\n")
    assert frames.splitlines() == ["TeamCard (TeamCard.js:3:4)", "in Suspense"]


def test_the_frame_list_is_bounded():
    stack = "\n".join(f"at f{i} (https://x.test/a.js:{i}:1)" for i in range(500))
    assert len(client_frames(stack).splitlines()) == 40


def test_a_server_traceback_has_no_message_and_no_values():
    def handler(user_name, mail):
        raise ValueError(f"Konto {user_name} mit {mail} und Token {TOKEN} von {IP}")

    try:
        handler(NAME, MAIL)
    except ValueError as exc:
        frames = server_frames(exc)
    assert _leaks(frames) == []
    assert "tests/test_ops_error_scrub_unit.py:" in frames
    assert frames.splitlines()[-1].endswith(" in handler")


def test_the_error_type_is_a_code_name_only():
    assert clean_error_type("TypeError") == "TypeError"
    assert clean_error_type("HTTP 500") == "HTTP 500"
    assert "@" not in clean_error_type(MAIL)
    assert clean_error_type("") == "Error"
    assert len(clean_error_type("X" * 500)) == 80


def test_a_client_error_type_is_one_identifier_or_just_error():
    """Website und App schicken die Fehlerart selbst - nur ein Bezeichner bleibt, sonst „Error“ (kein freier Text)."""
    assert clean_client_error_type("TypeError") == "TypeError"
    assert clean_client_error_type("DOMException.AbortError") == "DOMException.AbortError"
    assert clean_client_error_type("Max Mustermann wohnt in Wien 1010") == "Error"
    assert clean_client_error_type(MAIL) == "Error"
    assert clean_client_error_type("X" * 61) == "Error"
    assert clean_client_error_type("") == "Error"
    assert clean_client_error_type({"name": "Max"}) == "Error"


def test_a_client_stack_keeps_at_most_15_places():
    stack = "\n".join(f"at f{i} (https://x.test/a.js:{i}:1)" for i in range(100))
    assert len(client_frames(stack, limit=CLIENT_FRAME_LIMIT).splitlines()) == 15


def test_paths_lose_query_ids_and_slugs():
    assert client_route(f"/u/maxmustermann?email={MAIL}#top") == "/u/:slug"
    assert client_route("/teams/8f3a2b1c9d0e") == "/teams/:slug"
    assert client_route("/tournaments/cod-cup-2026/bracket") == "/tournaments/:slug/bracket"
    assert client_route("/admin/users/maxmustermann") == "/admin/users/:param"
    assert client_route(f"/irgendwo/{IP}") == "/irgendwo/:id"
    assert client_route("/news/:slug") == "/news/:slug"
    assert client_route("") == "/"
    assert client_route("/" + "a/" * 200).startswith("/a/")
    assert len(client_route("/" + "a/" * 200)) <= 120


def test_unknown_server_paths_mask_every_segment_with_digits():
    assert server_route_fallback(f"/api/unbekannt/{IP}/x") == "/api/unbekannt/{id}/x"
    assert server_route_fallback("/api/unbekannt/0123456789abcdef") == "/api/unbekannt/{id}"


def test_the_version_is_short_and_plain():
    assert clean_version("2.3.1+build.7") == "2.3.1+build.7"
    assert "@" not in clean_version(MAIL)
    assert len(clean_version("9" * 200)) == 40
