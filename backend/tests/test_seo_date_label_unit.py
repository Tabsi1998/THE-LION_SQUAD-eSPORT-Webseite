"""Vorschau für Crawler und Teilen (#1307, Review-Befund 2): das Datum in der einen Form, in Wiener Zeit und mit „Jänner“.

Bisher rechnete ``format_date_label`` in der Zone des Servers (UTC) und schrieb „Januar“ - ein Event um 00:30 in Wien
stand am Vortag.
"""
from routes.seo_render_routes import format_date_label


def test_wiener_tag_und_jaenner():
    # 23:30 UTC am 1. Jänner ist in Wien schon der 2. Jänner, 00:30.
    assert format_date_label("2027-01-01T23:30:00Z") == "Sa 2. Jänner 2027"
    assert format_date_label("2026-05-23T16:00:00Z") == "Sa 23. Mai"
    assert format_date_label(None) == ""
