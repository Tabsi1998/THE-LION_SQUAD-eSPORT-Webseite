"""Hilfe-Bereich (#2295): Teilen-Karte für /hilfe und je Thema, Sitemap, und Titel/Kurztext gleich wie im Frontend."""
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


def test_help_overview_has_own_card(monkeypatch):
    meta = _meta("/hilfe", monkeypatch)
    assert meta["title"].startswith("Hilfe · ")
    assert meta["description"] == help_topics.HELP_DESCRIPTION
    assert meta["canonical"] == "https://lionsquad.at/hilfe"
    assert meta["robots"] == "index, follow"


def test_help_topic_card_with_breadcrumb(monkeypatch):
    meta = _meta("/hilfe/liga-captains", monkeypatch)
    assert meta["title"].startswith("Liga für Captains · Hilfe · ")
    assert meta["description"] == help_topics.HELP_TOPICS["liga-captains"][1]
    assert meta["canonical"] == "https://lionsquad.at/hilfe/liga-captains"
    assert [crumb["name"] for crumb in meta["breadcrumbs"]] == ["Startseite", "Hilfe", "Liga für Captains"]


@pytest.mark.parametrize("path", ["/hilfe/gibt-es-nicht", "/hilfe/turniere/zu-tief"])
def test_unknown_help_topic_is_404(monkeypatch, path):
    with pytest.raises(HTTPException) as exc:
        _meta(path, monkeypatch)
    assert exc.value.status_code == 404


def test_sitemap_lists_help_pages():
    from routes import setup_routes

    for path in ["/hilfe", "/hilfe/konto-und-profil", "/hilfe/team-und-co-team", "/hilfe/liga-captains", "/hilfe/turniere"]:
        assert path in setup_routes.STATIC_SITEMAP_PATHS
