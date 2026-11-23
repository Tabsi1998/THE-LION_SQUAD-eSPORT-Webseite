"""Wo eine News erscheint (#1532): Website und App, nur App oder nur Website - die Regel an einer Stelle.

Alte News ohne Feld gelten als beides (keine Migration). Wer fragt, sagt die Website über eine Kopfzeile; die App sendet
heute nichts und gilt deshalb ohne Kopfzeile als App.
"""
import pathlib
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import news_channels  # noqa: E402
from services.news_channels import (  # noqa: E402
    clean_channels, filter_channel, in_channel, notification_meta, only_channel, post_channels, request_channel,
)


def test_old_news_without_field_count_as_both():
    for post in ({}, {"channels": None}, {"channels": []}, {"channels": ["fax"]}, {"channels": "web"}):
        assert post_channels(post) == {"web", "app"}, post
        assert in_channel(post, "web") and in_channel(post, "app")
        assert only_channel(post) is None


def test_single_channel_news():
    app_only, web_only = {"channels": ["app"]}, {"channels": ["web"]}
    assert in_channel(app_only, "app") and not in_channel(app_only, "web")
    assert in_channel(web_only, "web") and not in_channel(web_only, "app")
    assert only_channel(app_only) == "app" and only_channel(web_only) == "web"
    assert only_channel({"channels": ["web", "app"]}) is None


def test_filter_channel_keeps_order_and_old_news():
    posts = [{"id": "beides", "channels": ["web", "app"]}, {"id": "app", "channels": ["app"]},
             {"id": "alt"}, {"id": "web", "channels": ["web"]}]
    assert [p["id"] for p in filter_channel(posts, "web")] == ["beides", "alt", "web"]
    assert [p["id"] for p in filter_channel(posts, "app")] == ["beides", "app", "alt"]


def test_clean_channels_for_saving():
    assert clean_channels(["app", "web", "app"]) == ["web", "app"], "feste Reihenfolge, nichts doppelt"
    assert clean_channels(["app"]) == ["app"]
    with pytest.raises(ValueError):
        clean_channels([])
    with pytest.raises(ValueError):
        clean_channels(["fax"])


def _request(value=None):
    headers = {} if value is None else {news_channels.CHANNEL_HEADER: value}
    return SimpleNamespace(headers=headers)


def test_request_channel_web_only_with_header():
    assert request_channel(_request("web")) == "web"
    assert request_channel(_request("WEB ")) == "web"
    # Die App sendet heute keine Kopfzeile - ohne Angabe zählt sie als App, auch mit unbekanntem Wert.
    assert request_channel(_request()) == "app"
    assert request_channel(_request("app")) == "app"
    assert request_channel(_request("fax")) == "app"
    assert request_channel(None) == "app"


def test_notification_meta_per_channel():
    # Nur App: App-Push und App-Postfach, keine Browser-Meldung und keine Discord-Nachricht (Links führen zur Website).
    assert notification_meta({"channels": ["app"]}) == {"only_channel": "app", "no_browser": True, "no_discord": True}
    # Nur Website: Glocke, Browser-Meldung und Discord, aber kein App-Push.
    assert notification_meta({"channels": ["web"]}) == {"only_channel": "web", "no_push": True}
    assert notification_meta({"channels": ["web", "app"]}) == {}
    assert notification_meta({}) == {}
