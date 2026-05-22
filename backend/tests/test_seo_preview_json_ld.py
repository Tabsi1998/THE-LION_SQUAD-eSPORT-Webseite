import json
import re
import sys
import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import routes.seo_render_routes as seo_render_routes
from routes.seo_render_routes import render_preview_html, resolve_meta


def test_preview_json_ld_is_parseable_script_json():
    meta = {
        "title": 'Fast Lap "Sonntag" · THE LION SQUAD',
        "description": 'Fahre schneller als alle anderen & sichere dir den Sieg.',
        "image": "https://lionsquad.at/api/static/uploads/example.png",
        "url": "https://lionsquad.at/fastlap/example",
        "canonical": "https://lionsquad.at/fastlap/example",
        "site_name": "THE LION SQUAD - eSPORTS",
        "type": "website",
        "locale": "de_AT",
        "json_ld": {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "name": 'Fast Lap "Sonntag" · THE LION SQUAD',
            "description": "Fahre schneller als alle anderen.",
            "url": "https://lionsquad.at/fastlap/example",
        },
    }

    html = render_preview_html(meta)
    match = re.search(r'<script type="application/ld\+json">(.+?)</script>', html, re.S)

    assert match, html
    assert "&quot;" not in match.group(1)
    assert json.loads(match.group(1))["@type"] == "WebPage"


def test_preview_json_ld_escapes_script_end_marker():
    html = render_preview_html({
        "title": "SEO Test",
        "description": "JSON-LD safety test",
        "image": "https://lionsquad.at/og.png",
        "url": "https://lionsquad.at/test",
        "canonical": "https://lionsquad.at/test",
        "site_name": "THE LION SQUAD - eSPORTS",
        "json_ld": {"@context": "https://schema.org", "@type": "WebPage", "name": "</script>"},
    })

    match = re.search(r'<script type="application/ld\+json">(.+?)</script>', html, re.S)

    assert match
    assert "\\u003c/script\\u003e" in match.group(1)
    assert json.loads(match.group(1))["name"] == "</script>"


def test_preview_html_emits_robots_meta():
    html = render_preview_html({
        "title": "Profil",
        "description": "Noindex test",
        "image": "https://lionsquad.at/og.png",
        "url": "https://lionsquad.at/u/example",
        "canonical": "https://lionsquad.at/u/example",
        "site_name": "THE LION SQUAD - eSPORTS",
        "robots": "noindex, follow",
        "json_ld": {"@context": "https://schema.org", "@type": "WebPage", "name": "Profil"},
    })

    assert '<meta name="robots" content="noindex, follow" />' in html


def test_preview_html_omits_favicon_links_without_config():
    html = render_preview_html({
        "title": "Ohne Favicon",
        "description": "Kein Browser-Icon gesetzt",
        "image": "https://lionsquad.at/og.png",
        "url": "https://lionsquad.at/test",
        "canonical": "https://lionsquad.at/test",
        "site_name": "THE LION SQUAD - eSPORTS",
        "json_ld": {"@context": "https://schema.org", "@type": "WebPage", "name": "Ohne Favicon"},
    })

    assert 'rel="icon"' not in html
    assert 'rel="apple-touch-icon"' not in html


def test_preview_html_uses_configured_favicon_only():
    html = render_preview_html({
        "title": "Mit Favicon",
        "description": "Custom Browser-Icon gesetzt",
        "image": "https://lionsquad.at/og.png",
        "favicon": "https://lionsquad.at/api/static/uploads/favicon.png",
        "url": "https://lionsquad.at/test",
        "canonical": "https://lionsquad.at/test",
        "site_name": "THE LION SQUAD - eSPORTS",
        "json_ld": {"@context": "https://schema.org", "@type": "WebPage", "name": "Mit Favicon"},
    })

    assert '<link rel="icon" href="https://lionsquad.at/api/static/uploads/favicon.png" />' in html
    assert '<link rel="apple-touch-icon" href="https://lionsquad.at/api/static/uploads/favicon.png" />' in html


class _Settings:
    async def find_one(self, *args, **kwargs):
        return {
            "domain": "https://lionsquad.at",
            "club_name": "THE LION SQUAD",
            "logo_url": "/api/static/uploads/logo.png",
            "mascot_url": "/api/static/uploads/mascot.png",
        }


class _Db:
    settings = _Settings()


def test_seo_preview_unknown_path_returns_404(monkeypatch):
    monkeypatch.setattr(seo_render_routes, "get_db", lambda: _Db())
    request = SimpleNamespace(
        headers={},
        url=SimpleNamespace(scheme="https", netloc="lionsquad.at"),
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(resolve_meta("/elements/blockquote/", request))

    assert exc.value.status_code == 404


def test_seo_preview_known_static_path_still_resolves(monkeypatch):
    monkeypatch.setattr(seo_render_routes, "get_db", lambda: _Db())
    request = SimpleNamespace(
        headers={},
        url=SimpleNamespace(scheme="https", netloc="lionsquad.at"),
    )

    meta = asyncio.run(resolve_meta("/about", request))

    assert meta["canonical"] == "https://lionsquad.at/about"
    assert meta["favicon"] == ""
    assert meta["image"] == "https://lionsquad.at/api/static/uploads/logo.png"
    graph_types = {item["@type"] for item in meta["json_ld"]["@graph"]}
    assert graph_types == {"WebPage", "BreadcrumbList"}
    assert meta["breadcrumbs"] == [
        {"name": "Startseite", "url": "https://lionsquad.at"},
        {"name": "Verein", "url": "https://lionsquad.at/about"},
    ]


def test_seo_preview_legal_and_players_are_noindex(monkeypatch):
    monkeypatch.setattr(seo_render_routes, "get_db", lambda: _Db())
    request = SimpleNamespace(
        headers={},
        url=SimpleNamespace(scheme="https", netloc="lionsquad.at"),
    )

    privacy = asyncio.run(resolve_meta("/privacy", request))
    players = asyncio.run(resolve_meta("/players", request))

    assert privacy["robots"] == "noindex, follow"
    assert players["robots"] == "noindex, follow"
