"""FAQ (#2448, vorher Hilfe #2295): Teilen-Karte für /faq und je Anleitung, Sitemap, Titel/Kurztext gleich wie im
Frontend - und alte /hilfe-Links zeigen dieselbe Karte mit der neuen kanonischen Adresse."""
import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routes import seo_render_routes
from routes.seo_render_routes import resolve_meta
from services import help_topics

FRONTEND_TOPICS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "hilfe" / "themen"
FRONTEND_INDEX = Path(__file__).resolve().parents[2] / "frontend" / "src" / "hilfe" / "index.js"


class _Settings:
    async def find_one(self, *args, **kwargs):
        return {"id": "branding", "domain": "lionsquad.at", "club_name": "THE LION SQUAD"}


class _Db:
    settings = _Settings()


REQUEST = SimpleNamespace(headers={}, url=SimpleNamespace(scheme="https", netloc="lionsquad.at"))


def _meta(path, monkeypatch):
    monkeypatch.setattr(seo_render_routes, "get_db", _Db)
    return asyncio.run(resolve_meta(path, REQUEST))


def test_titles_match_frontend_topics():
    files = sorted(FRONTEND_TOPICS.glob("*.json"))
    assert files, "frontend/src/hilfe/themen fehlt"
    frontend = {}
    for file in files:
        data = json.loads(file.read_text(encoding="utf-8"))
        frontend[data["slug"]] = (data["titel"], data["kurz"])
    assert frontend == help_topics.HELP_TOPICS
    assert f'"{help_topics.HELP_DESCRIPTION}"' in FRONTEND_INDEX.read_text(encoding="utf-8")


@pytest.mark.parametrize("path", ["/faq", "/hilfe", "/FAQ", "/Hilfe/"])
def test_faq_overview_has_own_card(monkeypatch, path):
    meta = _meta(path, monkeypatch)
    assert meta["title"].startswith("FAQ · ")
    assert meta["description"] == help_topics.HELP_DESCRIPTION
    assert meta["canonical"] == "https://lionsquad.at/faq"
    assert meta["robots"] == "index, follow"


@pytest.mark.parametrize("path", ["/faq/liga-captains", "/hilfe/liga-captains", "/hilfe/Liga-Captains", "/FAQ/LIGA-CAPTAINS", "/Hilfe/Liga-captains"])
def test_faq_topic_card_with_breadcrumb(monkeypatch, path):
    meta = _meta(path, monkeypatch)
    assert meta["title"].startswith("Liga für Captains · FAQ · ")
    assert meta["description"] == help_topics.HELP_TOPICS["liga-captains"][1]
    assert meta["canonical"] == "https://lionsquad.at/faq/liga-captains"
    assert [crumb["name"] for crumb in meta["breadcrumbs"]] == ["Startseite", "FAQ", "Liga für Captains"]


def test_help_meta_itself_ignores_case():
    """Auch ohne Vorarbeit des Aufrufers (Review F5): help_meta findet das Thema in jeder Schreibweise."""
    base = {"site_name": "THE LION SQUAD", "title": "x", "description": "y"}
    meta = seo_render_routes.help_meta("Liga-CAPTAINS", 2, base, "https://lionsquad.at")
    assert meta["canonical"] == "https://lionsquad.at/faq/liga-captains"


@pytest.mark.parametrize("path", ["/faq/gibt-es-nicht", "/faq/turniere/zu-tief", "/hilfe/gibt-es-nicht"])
def test_unknown_help_topic_is_404(monkeypatch, path):
    with pytest.raises(HTTPException) as exc:
        _meta(path, monkeypatch)
    assert exc.value.status_code == 404


def test_sitemap_lists_faq_pages_and_no_old_ones():
    from routes import setup_routes

    for path in ["/faq", "/faq/konto-und-profil", "/faq/team-und-co-team", "/faq/liga-captains", "/faq/turniere"]:
        assert path in setup_routes.STATIC_SITEMAP_PATHS
    assert not [path for path in setup_routes.STATIC_SITEMAP_PATHS if path.startswith("/hilfe")]


def test_nginx_redirects_old_help_links_permanently():
    """/hilfe und /hilfe/<thema> leiten mit 301 auf /faq um - Suche (?q=) bleibt, der Anker (#schritt) bleibt im Browser.
    Groß- und Kleinschreibung egal (~*, Review F5): /Hilfe aus einer alten Mail führt genauso hin."""
    conf = (Path(__file__).resolve().parents[2] / "frontend" / "nginx.conf").read_text(encoding="utf-8")
    assert "location ~* ^/hilfe/?$ { return 301 /faq$is_args$args; }" in conf
    assert r"location ~* ^/hilfe/([^/?#\r\n]+)/?$ { return 301 /faq/$1$is_args$args; }" in conf
