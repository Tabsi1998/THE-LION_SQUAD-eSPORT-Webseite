"""CSV-Ausfuhren schreiben das amtliche Datum (#1307, Review-Befund 1): „14.03.2026 18:05“ in Wiener Zeit - sortierbar, mit
Jahr, nie „heute“ oder ein Wochentag. Die Anzeige (Mails, Meldungen) bleibt bei „Sa 14. März · 18:05“."""
from services import event_lead, moderation_standing


def test_teilnehmerliste_angemeldet_am_ist_amtlich():
    assert event_lead._vienna_text("2026-03-14T17:05:00+00:00") == "14.03.2026 18:05"
    assert event_lead._vienna_text("2026-12-31T23:30:00Z") == "01.01.2027 00:30"
    assert event_lead._vienna_text(None) == ""


def test_moderation_csv_ist_amtlich_die_meldung_nicht():
    rows = [{
        "user": {"username": "probe", "display_name": "Probe"}, "strikes": 2, "active_strikes": 1, "sanctions": 1,
        "active": {"label": "Chat-Sperre", "chat_blocked_until": "2026-12-31T23:30:00Z"},
        "open_appeal": False, "last_event_at": "2026-03-14T17:05:00Z",
    }]
    line = moderation_standing.export_csv(rows).splitlines()[1]
    assert line == "probe;Probe;2;1;1;Chat-Sperre;01.01.2027 00:30;nein;14.03.2026 18:05"
    # Die Meldung an die Person liest man - dort die eine Form.
    assert moderation_standing._fmt("2026-03-14T17:05:00Z").startswith("Sa 14. März")
