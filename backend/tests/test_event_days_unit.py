"""Mehrtägige Events (#884): die Tage werden geprüft, der Zeitraum abgeleitet, „läuft gerade“ gilt nur innerhalb der
Tageszeiten, und die Texte sind die, die Website, App, Discord und Mail gleich zeigen. Wiener Zeit, auch über die
Zeitumstellung am 25.10.2026."""
from datetime import datetime, timezone

import pytest

from services import event_days
from services.public_phase import derive_public_phase

WEEKEND = [
    {"date": "2026-10-16", "start": "18:00", "end": "23:00", "door": "17:00", "title": "Warm-up"},
    {"date": "2026-10-17", "start": "10:00", "end": "22:00", "location_key": "ort-1"},
    {"date": "2026-10-18", "start": "10:00", "end": "16:00", "title": "Finaltag"},
]


def utc(text: str) -> datetime:
    return datetime.fromisoformat(text).astimezone(timezone.utc)


def test_tage_werden_geordnet_und_in_utc_gerechnet():
    days = event_days.normalize_days(list(reversed(WEEKEND)), location_keys={"ort-1"})
    assert [day["date"] for day in days] == ["2026-10-16", "2026-10-17", "2026-10-18"]
    # Sommerzeit: 18:00 Wien = 16:00 UTC.
    assert days[0]["start_at"] == "2026-10-16T16:00:00+00:00"
    assert days[0]["door_at"] == "2026-10-16T15:00:00+00:00"
    assert days[0]["title"] == "Warm-up"
    assert days[1]["location_key"] == "ort-1" and days[1]["door"] is None
    rng = event_days.derived_range(days)
    assert rng == {"start_date": "2026-10-16T16:00:00+00:00", "end_date": "2026-10-18T14:00:00+00:00", "door_time": "2026-10-16T15:00:00+00:00"}


def test_ende_nach_mitternacht_und_zeitumstellung():
    days = event_days.normalize_days([
        {"date": "2026-10-24", "start": "20:00", "end": "02:00"},
        {"date": "2026-10-25", "start": "10:00", "end": "16:00"},
    ])
    # Sa 20:00 – So 02:00 (noch Sommerzeit): Ende am nächsten Tag.
    assert days[0]["end_at"] == "2026-10-25T00:00:00+00:00"
    # So 25.10. ist Winterzeit: 10:00 Wien = 09:00 UTC.
    assert days[1]["start_at"] == "2026-10-25T09:00:00+00:00"
    view = event_days.schedule_view({"days": days}, now=utc("2026-10-25T00:30:00+00:00"))
    assert view["days"][0]["ends_next_day"] is True
    assert view["days"][1]["ends_next_day"] is False


@pytest.mark.parametrize("raw, message", [
    ([WEEKEND[0]], "mindestens zwei"),
    ([{**WEEKEND[0], "date": "2026-02-30"}, WEEKEND[1]], "Datum gibt es nicht"),
    ([{**WEEKEND[0], "start": "25:00"}, WEEKEND[1]], "Beginn"),
    ([{**WEEKEND[0], "end": "18:00"}, WEEKEND[1]], "gleich"),
    ([{**WEEKEND[0], "door": "19:00"}, WEEKEND[1]], "Einlass liegt nach dem Beginn"),
    ([WEEKEND[0], {**WEEKEND[0]}], "Jeder Tag kommt nur einmal vor"),
    ([{"date": "2026-10-16", "start": "18:00", "end": "02:00"}, {"date": "2026-10-17", "start": "01:00", "end": "10:00"}], "beginnt, bevor"),
    ([WEEKEND[0], {**WEEKEND[1], "location_key": "gibt-es-nicht"}], "Standort"),
    (WEEKEND * 5, "Höchstens 14"),
])
def test_fehler_sind_saetze_fuer_das_formular(raw, message):
    with pytest.raises(ValueError, match=message):
        event_days.normalize_days(raw, location_keys={"ort-1"})


def event():
    return {"status": "live", "days": event_days.normalize_days(WEEKEND, location_keys={"ort-1"}), "locations": [{"key": "ort-1", "name": "Vereinsheim"}],
            **event_days.derived_range(event_days.normalize_days(WEEKEND, location_keys={"ort-1"}))}


def test_laeuft_nur_innerhalb_der_tageszeiten():
    ev = event()
    # Freitag 20:00 Wien: Tag 1 läuft.
    phase = derive_public_phase(ev, "event", now=utc("2026-10-16T18:00:00+00:00"))
    assert phase["state"] == "live" and phase["label"] == "Tag 1/3 läuft" and phase["day_index"] == 1
    assert phase["target_at"] == "2026-10-16T21:00:00+00:00"
    # Nacht auf Samstag 02:00 Wien: Pause, Tag 2 beginnt um 10:00 - nicht „läuft“.
    phase = derive_public_phase(ev, "event", now=utc("2026-10-17T00:00:00+00:00"))
    assert phase["state"] == "day_break" and phase["label"] == "Tag 2/3" and phase["countdown_kind"] == "starts"
    assert phase["target_at"] == "2026-10-17T08:00:00+00:00"
    # Nach dem Finaltag: beendet.
    assert derive_public_phase(ev, "event", now=utc("2026-10-18T15:00:00+00:00"))["state"] == "completed"
    # Vor dem ersten Tag: wie bisher angekündigt, Ziel ist der Einlass.
    before = derive_public_phase({**ev, "status": "scheduled"}, "event", now=utc("2026-10-10T10:00:00+00:00"))
    assert before["state"] == "announced" and before["target_at"] == "2026-10-16T15:00:00+00:00"


def test_texte_fuer_alle_kanaele():
    ev = event()
    assert event_days.summary_text(ev) == "3 Tage · Fr 16.10. – So 18.10."
    assert event_days.lines(ev) == [
        "Fr 16.10. · 18:00–23:00 · Einlass 17:00 · Warm-up",
        "Sa 17.10. · 10:00–22:00 · Vereinsheim",
        "So 18.10. · 10:00–16:00 · Finaltag",
    ]
    assert event_days.now_text(ev, utc("2026-10-10T10:00:00+00:00")) == "Beginnt am Fr 16.10. um 18:00"
    assert event_days.now_text(ev, utc("2026-10-16T06:00:00+00:00")) == "Beginnt heute um 18:00"
    assert event_days.now_text(ev, utc("2026-10-16T18:00:00+00:00")) == "Heute 18:00–23:00"
    assert event_days.now_text(ev, utc("2026-10-17T00:00:00+00:00")) == "Tag 2 beginnt heute um 10:00"
    # 21:30 UTC ist 23:30 Wien - der Tag 1 ist vorbei, Tag 2 beginnt morgen.
    assert event_days.now_text(ev, utc("2026-10-16T21:30:00+00:00")) == "Tag 2 beginnt morgen um 10:00"
    assert event_days.now_text(ev, utc("2026-10-19T10:00:00+00:00")) == "Beendet"
    view = event_days.schedule_view(ev, now=utc("2026-10-17T00:00:00+00:00"))
    assert view["count"] == 3 and view["now"] == {"state": "break", "day_index": 2, "text": "Tag 2 beginnt heute um 10:00"}
    assert [day["state"] for day in view["days"]] == ["past", "next", "upcoming"]
    assert view["days"][1]["location_name"] == "Vereinsheim"
    assert view["next_at"] == "2026-10-17T08:00:00+00:00"


def test_tag_eines_turniers_und_eintaegige_events_bleiben_unberuehrt():
    ev = event()
    assert event_days.day_of(ev, "2026-10-17T12:00:00+00:00")["index"] == 2
    # Vor dem Einlass des Tages zählt das Datum.
    assert event_days.day_of(ev, "2026-10-18T05:00:00+00:00")["label"] == "So 18.10."
    assert event_days.day_of(ev, "2026-10-20T12:00:00+00:00") is None
    single = {"status": "live", "start_date": "2026-10-16T16:00:00+00:00", "end_date": "2026-10-16T21:00:00+00:00"}
    assert event_days.schedule_view(single) is None
    assert event_days.position(single) is None
    assert derive_public_phase(single, "event", now=utc("2026-10-16T18:00:00+00:00"))["state"] == "live"
    assert event_days.overlaps(single, utc("2026-10-16T00:00:00+00:00"), utc("2026-10-17T00:00:00+00:00")) is None
    assert event_days.overlaps(ev, utc("2026-10-17T00:00:00+00:00"), utc("2026-10-18T00:00:00+00:00")) is True


def test_discord_und_mail_nennen_die_tage():
    from services.discord_announcements import event_message
    from services.notification_preferences import _event_when

    ev = {**event(), "name": "LAN-Wochenende", "slug": "lan", "location": "Vereinsheim"}
    fields = {field["name"]: field["value"] for field in event_message(ev)["fields"]}
    assert fields["Wann"] == "3 Tage · Fr 16.10. – So 18.10."
    assert fields["Tage"].split("\n") == event_days.lines(ev)
    assert _event_when(ev) == "3 Tage · Fr 16.10. – So 18.10. – " + "; ".join(event_days.lines(ev))
    # Eintägig wie bisher: nur „Wann“ mit dem Beginn.
    single = {"name": "Stammtisch", "start_date": "2026-10-16T16:00:00+00:00"}
    assert "Tage" not in {field["name"] for field in event_message(single)["fields"]}
    assert _event_when(single).startswith("16.10.2026")
