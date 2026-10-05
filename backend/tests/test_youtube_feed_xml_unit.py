"""Der YouTube-Feed ist fremdes XML (#931): Entitäten und externe Verweise werden abgelehnt, bevor sie aufgelöst
werden - als lesbarer Fehler des Feeds, nicht als Absturz."""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import youtube_feed  # noqa: E402

ATOM = 'xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom"'
ENTRY = "<entry><yt:videoId>abc123DEF45</yt:videoId><title>{title}</title></entry>"


def test_a_plain_feed_still_parses():
    rows = youtube_feed.parse_feed(f"<feed {ATOM}>{ENTRY.format(title='Finale')}</feed>")
    assert [(row["video_id"], row["title"]) for row in rows] == [("abc123DEF45", "Finale")]


@pytest.mark.parametrize("doctype", [
    '<!DOCTYPE feed [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>',
    '<!DOCTYPE feed [<!ENTITY b SYSTEM "file:///etc/hostname">]>',
])
def test_entities_and_external_references_are_refused(doctype):
    with pytest.raises(youtube_feed.YoutubeError) as raised:
        youtube_feed.parse_feed(f'<?xml version="1.0"?>{doctype}<feed {ATOM}>{ENTRY.format(title="&b;")}</feed>')
    assert raised.value.kind == "feed_failed"
    assert "nicht erlaubt" in raised.value.text


def test_broken_xml_keeps_its_own_message():
    with pytest.raises(youtube_feed.YoutubeError) as raised:
        youtube_feed.parse_feed("<feed><entry></feed>")
    assert raised.value.kind == "feed_failed" and "kein gültiges XML" in raised.value.text
