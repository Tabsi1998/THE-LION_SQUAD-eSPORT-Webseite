"""Tote API-Routen bleiben weg (#933) - und ihr Ersatz bleibt da.

Belegt vor dem Entfernen: kein Aufruf aus Website, App (alle veröffentlichten Stände), Skripten oder Doku. Was noch
einen Verbraucher hat oder eine Entscheidung braucht (z. B. /api/matches/upcoming für alte App-Stände, AMP, Socials,
Strukturplanung), steht bewusst nicht in dieser Liste.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import load_application  # noqa: E402

REMOVED = {
    "GET /api/seasons/v2/leaderboard",
    "GET /api/seasons/v2/me",
    "POST /api/seasons/v2/award",
    "DELETE /api/seasons/v2/entry/{entry_id}",
    "GET /api/admin/audit-logs",
    "GET /api/matches/operations",
    "POST /api/documents/{doc_id}/track-download",
    "POST /api/game-servers/{server_id}/touch",
    "POST /api/uploads/video",
    "GET /api/notifications/me",
    "GET /api/notifications/me/unread-count",
    "POST /api/notifications/{nid}/read",
    "POST /api/notifications/read-all",
    "DELETE /api/notifications/read",
    "DELETE /api/notifications/{nid}",
}

STILL_THERE = {
    # Was Website und App stattdessen nutzen.
    "GET /api/admin/notifications",
    "POST /api/admin/notifications/{nid}/read",
    "POST /api/admin/notifications/read-all",
    "GET /api/mobile/notifications",
    "POST /api/uploads/media",
    "GET /api/documents/{doc_id}/download",
    "GET /api/mobile/dashboard",
    "GET /api/seasons/{slug_or_id}/standings",
    # Bewusst behalten (siehe Docstring).
    "GET /api/matches/upcoming",
}


def collect(routes, found: set[str]) -> None:
    """Eingebundene Router bleiben Hüllen (wie in scripts/route-inventory.py) - ihnen folgen."""
    for route in routes or []:
        original = getattr(route, "original_router", None)
        if original is not None:
            collect(getattr(original, "routes", []), found)
            continue
        nested = getattr(route, "routes", None)
        if nested and not getattr(route, "methods", None):
            collect(nested, found)
            continue
        for method in getattr(route, "methods", None) or ():
            if method not in {"HEAD", "OPTIONS"}:
                found.add(f"{method} {route.path}")


def route_table() -> set[str]:
    found: set[str] = set()
    collect(load_application()[1].app.routes, found)
    assert len(found) > 500, "die Routentabelle ist unvollständig gelesen"
    return found


def test_dead_routes_are_gone_and_their_replacements_stay():
    table = route_table()
    assert sorted(REMOVED & table) == []
    assert sorted(STILL_THERE - table) == []
