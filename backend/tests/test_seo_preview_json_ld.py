import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routes.seo_render_routes import render_preview_html


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
    assert "<\\/script>" in match.group(1)
    assert json.loads(match.group(1))["name"] == "</script>"
