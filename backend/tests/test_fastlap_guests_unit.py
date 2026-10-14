"""Gäste ohne Konto in der einen Rangfunktion (#1585).

- Ohne ``include_guests`` bleibt alles wie bisher: Zeiten ohne Konto kommen nicht in die Wertung. Gewinne,
  Saisonpunkte, Erfolge, Profil und Rückblick rufen ``rank_laps`` so - Gäste können dort gar nicht auftauchen.
- Mit ``include_guests`` (Tabelle, TV, Urkunde) reiht die Funktion Gäste wie Konten ein: wirksame Zeit, bei
  Gleichstand die früher gefahrene vorn. Jeder Gast zählt für sich - zwei Gäste ohne Konto werden nie zusammengelegt.
"""
from services.fastlap_standings import participant_id, rank_laps


def lap(lap_id, *, user=None, guest=None, ms=80000, at="2026-10-31T10:00:00+00:00", **extra):
    return {"id": lap_id, "user_id": user, "guest_id": guest, "time_ms": ms, "created_at": at, **extra}


def test_without_the_switch_guests_stay_out():
    ranked = rank_laps([lap("a", guest="g1", ms=70000), lap("b", user="u1", ms=80000)])
    assert [row["user_id"] for row in ranked] == ["u1"]
    assert ranked[0]["rank"] == 1


def test_with_the_switch_guests_are_ranked_like_accounts():
    ranked = rank_laps([lap("a", guest="g1", ms=70000), lap("b", user="u1", ms=80000)], include_guests=True)
    assert [row["participant_id"] for row in ranked] == ["guest-g1", "u1"]
    assert [row["rank"] for row in ranked] == [1, 2]
    guest, account = ranked
    assert guest["is_guest"] is True and guest["user_id"] is None and guest["guest_id"] == "g1"
    assert account["is_guest"] is False and account["participant_id"] == "u1"


def test_two_guests_are_never_merged():
    ranked = rank_laps([
        lap("a", guest="g1", ms=81000),
        lap("b", guest="g2", ms=82000),
        lap("c", guest="g1", ms=83000, is_invalid=True),
    ], include_guests=True)
    assert [(row["participant_id"], row["attempts"]) for row in ranked] == [("guest-g1", 2), ("guest-g2", 1)]


def test_a_tie_between_guest_and_account_goes_to_who_drove_it_first():
    ranked = rank_laps([
        lap("a", user="u1", ms=80000, at="2026-10-31T10:05:00+00:00"),
        lap("b", guest="g1", ms=80000, at="2026-10-31T10:01:00+00:00"),
    ], include_guests=True)
    assert [row["participant_id"] for row in ranked] == ["guest-g1", "u1"]


def test_guests_have_no_reference_scope():
    ranked = rank_laps([lap("a", guest="g1", score_scope="club_reference")], "club_reference", include_guests=True)
    assert ranked == []


def test_participant_id():
    assert participant_id({"user_id": "u1"}) == "u1"
    assert participant_id({"user_id": None, "guest_id": "g1"}) == "guest-g1"
    assert participant_id({}) is None
