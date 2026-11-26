"""Startrechte für die nächste Season (#1627, docs/LIGA.md „F.2a“): Einstellung, Frist, Zustände und die Nachrückerregel - ohne Datenbank."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_start_right_rules as rights  # noqa: E402
from services import league_successor  # noqa: E402

NOW = datetime(2026, 12, 1, 12, 0, tzinfo=timezone.utc)
START = (NOW + timedelta(days=30)).isoformat()
SEASON = {"id": "s2", "status": "draft", "start_date": START, "start_rights": {"mode": "accept", "accept_days": 14}}


def application(**start_right) -> dict:
    return {"id": "a1", "status": "accepted", "carry_over": {"division_level": 1, **({"start_right": start_right} if start_right else {})}}


# ---------------------------------------------------------------- Einstellung

def test_defaults_fill_what_is_missing_and_wrong_values_are_refused():
    assert rights.normalize({}) == {"mode": "accept", "accept_days": 14, "successor": "next", "remind_hours": 48, "announce": True, "rest_days": 3}
    assert rights.normalize({"mode": "auto", "accept_days": 3, "successor": "lead", "remind_hours": 0, "announce": False, "rest_days": 5}) == {
        "mode": "auto", "accept_days": 3, "successor": "lead", "remind_hours": 0, "announce": False, "rest_days": 5}
    for wrong in ({"mode": "invite"}, {"accept_days": 0}, {"accept_days": 61}, {"accept_days": True}, {"successor": "lot"},
                  {"remind_hours": -1}, {"announce": "ja"}, {"unknown": 1}):
        with pytest.raises(rights.StartRightProblem):
            rights.normalize(wrong)


def test_a_season_without_the_field_has_no_start_rights():
    assert rights.stored({"id": "s1"}) is None and rights.stored({"start_rights": "an"}) is None
    assert not rights.needs_accept({"id": "s1"})
    assert not rights.needs_accept({"start_rights": {"mode": "auto"}})
    assert rights.needs_accept(SEASON)
    # Ein von Hand verbogener Wert fällt auf die Vorgabe zurück, statt etwas zu sperren.
    assert rights.stored({"start_rights": {"mode": "accept", "accept_days": 900}})["accept_days"] == 14


def test_the_settings_and_the_ledger_follow_the_contract_for_the_next_season():
    # Die Einstellung geht in die Folge-Season mit (Nr. 161), der Stand der Nachrichten gehört zur alten Season.
    assert rights.FIELD not in league_successor.NOT_COPIED
    assert {rights.NOTICES, rights.NOTICES_OPEN} <= league_successor.NOT_COPIED


# ---------------------------------------------------------------- Frist und Zustände

def test_the_deadline_counts_from_the_offer_and_ends_with_the_season_start_at_the_latest():
    offered = application(status="offered", offered_at=NOW.isoformat())
    assert rights.accept_until(offered, SEASON) == NOW + timedelta(days=14)
    soon = {**SEASON, "start_date": (NOW + timedelta(days=5)).isoformat()}
    assert rights.accept_until(offered, soon) == NOW + timedelta(days=5)
    # Der gemerkte Start gilt (Nr. 253): Rückt das Datum später in die Zukunft, geht die Frist nicht wieder auf.
    kept = {**soon, "started_at": (NOW + timedelta(days=2)).isoformat(), "start_date": (NOW + timedelta(days=90)).isoformat()}
    assert rights.accept_until(offered, kept) == NOW + timedelta(days=2)
    # Eine geänderte Zahl gilt sofort: Die Frist steht nicht am Antrag.
    assert rights.accept_until(offered, {**SEASON, "start_rights": {"mode": "accept", "accept_days": 3}}) == NOW + timedelta(days=3)
    assert rights.accept_until(application(), SEASON) is None


def test_the_states_stay_apart():
    offered = application(status="offered", offered_at=NOW.isoformat())
    assert rights.state(offered, SEASON, NOW) == "offered"
    # Die Frist gilt schon, bevor der Job den Antrag anfasst.
    assert rights.state(offered, SEASON, NOW + timedelta(days=14)) == "expired"
    accepted = application(status="accepted", offered_at=NOW.isoformat(), accepted_at=NOW.isoformat())
    assert rights.state(accepted, SEASON, NOW + timedelta(days=20)) == "accepted"
    # Teilnahme ist erst die Zuteilung zu einer Staffel - nicht die Zusage.
    assert rights.state({**accepted, "assignment": {"tournament_id": "t"}}, SEASON, NOW) == "participating"
    assert rights.state({**application(status="declined"), "status": "withdrawn"}, SEASON, NOW) == "declined"
    assert rights.state({**application(status="expired"), "status": "rejected"}, SEASON, NOW) == "expired"
    revoked = {"id": "a", "status": "rejected", "carry_over": {"revoked_at": NOW.isoformat()}}
    assert rights.state(revoked, SEASON, NOW) == "revoked"
    # Modus „auto“: automatisch dabei heißt bestätigt, ohne Zusage - und abgemeldet bleibt abgemeldet.
    auto = {**SEASON, "start_rights": {"mode": "auto"}}
    assert rights.state(application(), auto, NOW) == "confirmed"
    assert rights.state({**application(), "status": "withdrawn"}, auto, NOW) == "declined"
    # Von der Leitung abgelehnt oder auf die Warteliste gesetzt ist weder „verfallen“ noch „abgemeldet“.
    assert rights.state({**offered, "status": "rejected"}, SEASON, NOW) == "rejected"
    assert rights.state({**application(), "status": "rejected"}, auto, NOW) == "rejected"
    assert rights.state({**accepted, "status": "waitlist"}, SEASON, NOW) == "waitlist"
    # Kein übernommener Antrag: kein Startrecht.
    assert rights.state({"id": "x", "status": "accepted"}, SEASON, NOW) is None


# ---------------------------------------------------------------- Nachrückerregel

def right(key: str, from_level: int, level: int, rank: int, *, staffel: str = "A", points: int = 0, played: int = 3, diff: int = 0, **extra) -> dict:
    return {"application_id": key, "squad_id": f"s-{key}", "from_level": from_level, "from_staffel": staffel, "division_level": level,
            "rank": rank, "points": points, "played": played, "score_diff": diff, **extra}


# Liga 1 (vier Teams, einer steigt ab) und Liga 2 (vier Teams, einer steigt auf): wer nach dem Endstand wohin geht.
WORLD = [right("l1p1", 1, 1, 1), right("l1p2", 1, 1, 2), right("l1p3", 1, 1, 3), right("l1p4", 1, 2, 4),
         right("l2p1", 2, 1, 1), right("l2p2", 2, 2, 2), right("l2p3", 2, 2, 3), right("l2p4", 2, 2, 4)]


def without(*keys: str) -> list[dict]:
    return [row for row in WORLD if row["application_id"] not in keys]


def test_a_declined_promotion_goes_to_the_best_team_that_did_not_move_up():
    found = rights.candidates({"application_id": "l2p1", "division_level": 1, "from_level": 2}, without("l2p1"), [1, 2])
    assert found["group"] == "non_promoted" and found["pick"] == "l2p2" and found["tied"] == []


def test_a_free_place_of_a_team_that_stayed_goes_to_the_best_relegated_team():
    found = rights.candidates({"application_id": "l1p2", "division_level": 1, "from_level": 1}, without("l1p2"), [1, 2])
    assert found["group"] == "relegated" and found["pick"] == "l1p4"
    # Auch der Platz eines Absteigers von oben (kam aus Liga 1 nach Liga 2): Dort bleibt der beste Absteiger - gibt es keinen, der beste von unten.
    lower = rights.candidates({"application_id": "l1p4", "division_level": 2, "from_level": 1}, without("l1p4"), [1, 2])
    assert lower["group"] is None and lower["pick"] is None


def test_without_a_team_in_the_first_group_the_other_group_is_asked():
    # Aufstieg abgelehnt, aber niemand aus Liga 2 ist mehr da: Der Absteiger aus Liga 1 bleibt.
    found = rights.candidates({"application_id": "l2p1", "division_level": 1, "from_level": 2}, without("l2p1", "l2p2", "l2p3", "l2p4"), [1, 2])
    assert found["group"] == "relegated" and found["pick"] == "l1p4"
    # Ein Platz eines Teams, das blieb, ohne Absteiger: der beste Nicht-Aufsteiger von unten.
    found = rights.candidates({"application_id": "l1p2", "division_level": 1, "from_level": 1}, without("l1p2", "l1p4"), [1, 2])
    assert found["group"] == "non_promoted" and found["pick"] == "l2p2"


def test_who_passed_moves_already_or_is_the_freed_team_is_not_asked():
    rows = [{**row, "passed": ["l2p1"]} if row["application_id"] == "l2p2" else row for row in without("l2p1")]
    assert rights.candidates({"application_id": "l2p1", "division_level": 1, "from_level": 2}, rows, [1, 2])["pick"] == "l2p3"
    rows = [{**row, "fills": True} if row["application_id"] == "l2p2" else row for row in without("l2p1")]
    assert rights.candidates({"application_id": "l2p1", "division_level": 1, "from_level": 2}, rows, [1, 2])["pick"] == "l2p3"
    assert rights.candidates({"application_id": "l2p1", "division_level": 1, "from_level": 2}, WORLD, [1, 2])["pick"] == "l2p2"


def test_between_staffeln_points_per_game_decide_and_a_tie_is_left_to_the_lead():
    # Zwei Staffeln unten, verschieden groß: je Staffel der Bestplatzierte, dazwischen Punkte je Spiel - nie die rohen Punkte.
    rows = [right("a2", 2, 2, 2, staffel="A", points=6, played=3), right("a3", 2, 2, 3, staffel="A", points=3, played=3),
            right("b2", 2, 2, 2, staffel="B", points=8, played=5)]
    place = {"application_id": "gone", "division_level": 1, "from_level": 2}
    found = rights.candidates(place, rows, [1, 2])
    assert found["pick"] == "a2" and found["candidates"] == ["a2", "b2"]
    # Gleich nach Punkten und Map-Differenz je Spiel: kein Los (Nr. 156) - niemand rückt automatisch nach.
    tie = [right("a2", 2, 2, 2, staffel="A", points=6, played=3, diff=3), right("b2", 2, 2, 2, staffel="B", points=10, played=5, diff=5)]
    found = rights.candidates(place, tie, [1, 2])
    assert found["pick"] is None and sorted(found["tied"]) == ["a2", "b2"]


def test_an_archived_level_is_skipped():
    # Aktiv sind Liga 1 und 3: „die Liga darunter“ ist Liga 3.
    rows = [right("l3p2", 3, 3, 2), right("l3p3", 3, 3, 3)]
    found = rights.candidates({"application_id": "gone", "division_level": 1, "from_level": 3}, rows, [1, 3])
    assert found["pick"] == "l3p2"


# ---------------------------------------------------------------- Nachbesserung 26.11.: Pause, Start erreicht, Kandidaten, Erinnerung

def test_who_is_overdue_never_moves_up():
    # Nur wer zugesagt hat oder dessen eigene Frist noch läuft, kommt in Frage (Entscheidung 26.11., C).
    rows = [{**row, "overdue": True} if row["application_id"] == "l2p2" else row for row in without("l2p1")]
    found = rights.candidates({"application_id": "l2p1", "division_level": 1, "from_level": 2}, rows, [1, 2])
    assert found["pick"] == "l2p3" and "l2p2" not in found["candidates"]
    silent = [{**row, "overdue": True} for row in without("l2p1")]
    assert rights.candidates({"application_id": "l2p1", "division_level": 1, "from_level": 2}, silent, [1, 2]) == {
        "group": None, "candidates": [], "pick": None, "tied": []}


def test_a_shared_place_inside_one_staffel_is_a_tie_for_the_lead():
    # Platz 2 bis 4 punkt- und differenzgleich (Platz 1, 2, 2, 2): Niemand rückt von selbst nach - kein Los (Nr. 156).
    rows = [right("l2p2", 2, 2, 2, points=3, played=3), right("l2p3", 2, 2, 2, points=3, played=3), right("l2p4", 2, 2, 2, points=3, played=3)]
    found = rights.candidates({"application_id": "l2p1", "division_level": 1, "from_level": 2}, rows, [1, 2])
    assert found["pick"] is None and sorted(found["tied"]) == ["l2p2", "l2p3", "l2p4"] and sorted(found["candidates"]) == ["l2p2", "l2p3", "l2p4"]
    # Der geteilte Platz zählt auch dann, wenn eine andere Staffel einen klar schlechteren Kandidaten hat.
    other = [*rows, right("b2", 2, 2, 2, staffel="B", points=1, played=3)]
    found = rights.candidates({"application_id": "l2p1", "division_level": 1, "from_level": 2}, other, [1, 2])
    assert found["pick"] is None and sorted(found["tied"]) == ["l2p2", "l2p3", "l2p4"]
    # Liegt der geteilte Platz hinter dem Besten, stört er nicht.
    clear = [right("l2p2", 2, 2, 2, points=6, played=3), right("l2p3", 2, 2, 3, points=3, played=3), right("l2p4", 2, 2, 3, points=3, played=3)]
    assert rights.candidates({"application_id": "l2p1", "division_level": 1, "from_level": 2}, clear, [1, 2])["pick"] == "l2p2"


def test_the_deadline_rests_during_a_pause_and_is_longer_by_its_length_afterwards():
    offered = application(status="offered", offered_at=NOW.isoformat())
    day = timedelta(days=1)
    pause = lambda start, end=None: {"from": (NOW + start).isoformat(), "to": (NOW + end).isoformat() if end is not None else None}  # noqa: E731
    # Abgeschlossene Pause von drei Tagen mitten in der Frist: drei Tage länger.
    done = {**SEASON, "start_right_pauses": [pause(2 * day, 5 * day)]}
    assert rights.accept_until(offered, done) == NOW + 17 * day
    assert not rights.resting(offered, done)
    # Offene Pause: Die Frist steht still - nichts ist überfällig, wie lange sie auch dauert.
    running = {**SEASON, "start_right_pauses": [pause(2 * day)]}
    assert rights.accept_until(offered, running) is None and rights.resting(offered, running)
    assert not rights.overdue(offered, running, NOW + 400 * day)
    assert rights.state(offered, running, NOW + 400 * day) == "offered"
    # Eine Pause vor der Vergabe zählt nicht, eine nach dem Fristende auch nicht - und zwei Pausen zählen beide.
    assert rights.accept_until(offered, {**SEASON, "start_right_pauses": [pause(-9 * day, -2 * day)]}) == NOW + 14 * day
    assert rights.accept_until(offered, {**SEASON, "start_right_pauses": [pause(15 * day, 20 * day)]}) == NOW + 14 * day
    assert rights.overdue(offered, {**SEASON, "start_right_pauses": [pause(15 * day)]}, NOW + 16 * day)
    assert rights.accept_until(offered, {**SEASON, "start_right_pauses": [pause(1 * day, 2 * day), pause(4 * day, 6 * day)]}) == NOW + 17 * day
    # Begann die Pause vor der Vergabe und endete danach, zählt nur der Teil ab der Vergabe.
    assert rights.accept_until(offered, {**SEASON, "start_right_pauses": [pause(-3 * day, 2 * day)]}) == NOW + 16 * day
    # Der Start der Season bleibt die äußerste Grenze.
    assert rights.accept_until(offered, {**SEASON, "start_right_pauses": [pause(1 * day, 25 * day)]}) == NOW + 30 * day


def test_once_the_start_date_is_reached_nothing_expires_by_itself_and_the_lead_decides():
    offered = application(status="offered", offered_at=NOW.isoformat())
    # Auch im Entwurf gilt das Startdatum (Entscheidung 26.11., B).
    reached = {**SEASON, "start_date": (NOW + timedelta(days=5)).isoformat()}
    later = NOW + timedelta(days=6)
    assert rights.start_reached(reached, later) and not rights.start_reached(reached, NOW)
    assert rights.overdue(offered, reached, later)
    # Nicht „verfallen“: Das Startrecht bleibt offen, bis die Leitung entscheidet - das Team kann nicht mehr selbst zusagen.
    assert rights.state(offered, reached, later) == "offered"
    seen = rights.view(offered, reached, can_act=True, now=later)
    assert seen["waits_for_lead"] is True and seen["can_accept"] is False
    # Vor dem Start bleibt es beim Verfall nach der Frist.
    assert rights.state(offered, SEASON, NOW + timedelta(days=15)) == "expired"
    assert rights.view(offered, SEASON, can_act=True, now=NOW)["waits_for_lead"] is False


def test_the_reminder_never_comes_in_the_first_half_of_the_deadline():
    offered = application(status="offered", offered_at=NOW.isoformat())
    # 48 Stunden vor Fristende - bei 14 Tagen Frist also am zwölften Tag.
    assert rights.remind_at(offered, SEASON, {"remind_hours": 48}) == NOW + timedelta(days=12)
    # Frist ein Tag, Erinnerung 48 Stunden: gekappt auf die Hälfte der Frist statt sofort nach der Vergabe.
    short = {**SEASON, "start_rights": {"mode": "accept", "accept_days": 1}}
    assert rights.remind_at(offered, short, {"remind_hours": 48}) == NOW + timedelta(hours=12)
    assert rights.remind_at(offered, SEASON, {"remind_hours": 0}) is None
    assert rights.remind_at(application(), SEASON, {"remind_hours": 48}) is None


def test_after_switching_to_automatic_a_successor_may_still_decline_until_the_start():
    auto = {**SEASON, "start_rights": {"mode": "auto"}}
    fills = {"for_application_id": "x", "back": {"division_level": 2, "division_label": "Liga 2"}}
    by_mode = {"id": "a1", "status": "accepted", "carry_over": {"division_level": 1, "fills": fills, "start_right": {
        "status": "accepted", "offered_at": NOW.isoformat(), "accepted_via": "mode"}}}
    assert rights.may_pass(by_mode, auto, NOW)
    assert not rights.may_pass(by_mode, auto, NOW + timedelta(days=31))
    # Wer selbst zugesagt hat, hat den Platz angenommen - da gibt es nichts mehr abzulehnen.
    by_team = {**by_mode, "carry_over": {**by_mode["carry_over"], "start_right": {**by_mode["carry_over"]["start_right"], "accepted_via": "team"}}}
    assert not rights.may_pass(by_team, auto, NOW)


def test_back_from_the_waitlist_the_deadline_starts_again():
    waiting = {**application(status="offered", offered_at=(NOW - timedelta(days=30)).isoformat(), reminded_at=NOW.isoformat()), "status": "waitlist"}
    fields = rights.reoffer_fields(waiting, NOW.isoformat(), SEASON)
    assert fields == {"carry_over.start_right": {"status": "offered", "offered_at": NOW.isoformat()}}
    # Schon zugesagt oder ohne Startrecht: nichts zu tun.
    assert rights.reoffer_fields({**application(status="accepted", offered_at=NOW.isoformat()), "status": "waitlist"}, NOW.isoformat(), SEASON) == {}
    assert rights.reoffer_fields({"id": "x", "status": "waitlist"}, NOW.isoformat(), SEASON) == {}


# ---------------------------------------------------------------- Nachbesserung 26.11. (N1): die eigene Frist ruht, solange ein Nachrück-Angebot offen ist

TEN = {**SEASON, "start_rights": {"mode": "accept", "accept_days": 10}}
DAY = timedelta(days=1)


def offer_to_move_up(own: dict | None, at: datetime) -> dict:
    return {"for_application_id": "x", "at": at.isoformat(), "back": {"division_level": 2, "division_label": "Liga 2", **({"start_right": own} if own else {})}}


def test_silence_on_an_offer_to_move_up_leaves_the_rest_of_the_own_deadline_at_least_three_days():
    # Frist zehn Tage. Am Tag 9 rückt das Team nach, am Tag 12 ist das Angebot vorbei: Die eigene Frist ruhte drei Tage - es bliebe
    # ein Tag, mindestens aber drei (``rest_days``).
    own = {"status": "offered", "offered_at": NOW.isoformat(), "reminded_at": NOW.isoformat()}
    back = rights.restored_right(offer_to_move_up(own, NOW + 9 * DAY), TEN, NOW + 12 * DAY, None, declined=False)
    assert back["status"] == "offered" and back["offered_at"] == NOW.isoformat() and "reminded_at" not in back
    assert back["rests"] == [{"from": (NOW + 9 * DAY).isoformat(), "to": (NOW + 12 * DAY).isoformat()}]
    assert rights.accept_until(application(**back), TEN) == NOW + 15 * DAY
    assert not rights.overdue(application(**back), TEN, NOW + 12 * DAY)
    # Bleibt mehr als die Mindestfrist, gilt der Rest: Angebot von Tag 2 bis Tag 5, die Frist endet am Tag 13 statt am Tag 10.
    early = rights.restored_right(offer_to_move_up(own, NOW + 2 * DAY), TEN, NOW + 5 * DAY, None, declined=False)
    assert rights.accept_until(application(**early), TEN) == NOW + 13 * DAY
    # Nie über das Startdatum der Season hinaus.
    soon = {**TEN, "start_date": (NOW + 14 * DAY).isoformat()}
    assert rights.accept_until(application(**back), soon) == NOW + 14 * DAY
    # Die Mindestfrist ist einstellbar (Vorgabe 3 Tage).
    week = {**TEN, "start_rights": {"mode": "accept", "accept_days": 10, "rest_days": 7}}
    longer = rights.restored_right(offer_to_move_up(own, NOW + 9 * DAY), week, NOW + 12 * DAY, None, declined=False)
    assert rights.accept_until(application(**longer), week) == NOW + 19 * DAY
    # Ruhte in derselben Zeit auch die Pause der Season, zählt die Zeit nur einmal.
    paused = {**TEN, "start_right_pauses": [{"from": (NOW + 2 * DAY).isoformat(), "to": (NOW + 5 * DAY).isoformat()}]}
    assert rights.accept_until(application(**early), paused) == NOW + 13 * DAY


def test_declining_the_offer_to_move_up_is_the_acceptance_for_the_own_division():
    own = {"status": "offered", "offered_at": NOW.isoformat()}
    back = rights.restored_right(offer_to_move_up(own, NOW + 9 * DAY), TEN, NOW + 12 * DAY, "captain", declined=True)
    assert back["status"] == "accepted" and back["accepted_via"] == "team" and back["accepted_by"] == "captain"
    assert back["accepted_at"] == (NOW + 12 * DAY).isoformat()
    # Wer schon zugesagt hatte, behält seine Zusage; ohne eigenes Startrecht (Modus „automatisch“) gibt es keines.
    kept = {"status": "accepted", "offered_at": NOW.isoformat(), "accepted_at": NOW.isoformat(), "accepted_via": "team"}
    assert rights.restored_right(offer_to_move_up(kept, NOW + 9 * DAY), TEN, NOW + 12 * DAY, None, declined=False) == kept
    assert rights.restored_right(offer_to_move_up(None, NOW + 9 * DAY), TEN, NOW + 12 * DAY, None, declined=False) is None
    # Braucht die Season inzwischen keine Zusage mehr, gilt das frühere Startrecht wie alle anderen als zugesagt.
    auto = {**SEASON, "start_rights": {"mode": "auto"}}
    switched = rights.restored_right(offer_to_move_up(own, NOW + 9 * DAY), auto, NOW + 12 * DAY, None, declined=False)
    assert switched["status"] == "accepted" and switched["accepted_via"] == "mode"


def test_the_minimum_rest_is_a_setting_with_three_days_as_default():
    assert rights.normalize({})["rest_days"] == 3 and rights.normalize({"rest_days": 0})["rest_days"] == 0
    with pytest.raises(rights.StartRightProblem):
        rights.normalize({"rest_days": 31})
    assert rights.stored({"start_rights": {"mode": "accept"}})["rest_days"] == 3


def test_the_own_team_reads_whether_its_own_right_is_still_open_behind_the_offer():
    own = {"status": "offered", "offered_at": NOW.isoformat()}
    moved = {"id": "a1", "status": "accepted", "carry_over": {"division_level": 1, "fills": offer_to_move_up(own, NOW + DAY),
                                                              "start_right": {"status": "offered", "offered_at": (NOW + DAY).isoformat()}}}
    assert rights.view(moved, TEN, can_act=True, now=NOW + DAY)["fills"] == {"from_label": "Liga 2", "own_open": True, "rest_days": 3}
    kept = {**moved, "carry_over": {**moved["carry_over"], "fills": offer_to_move_up({**own, "status": "accepted"}, NOW + DAY)}}
    assert rights.view(kept, TEN, can_act=True, now=NOW + DAY)["fills"] == {"from_label": "Liga 2", "own_open": False, "rest_days": 3}


def test_assigning_during_a_pause_says_that_the_deadline_rests():
    offered = application(status="offered", offered_at=NOW.isoformat())
    running = {**SEASON, "start_right_pauses": [{"from": (NOW + DAY).isoformat(), "to": None}]}
    text = rights.assign_problem({**offered, "display_name": "Rudel Eins"}, running)
    assert "die Frist ruht" in text and "Frist bis" not in text
    assert "Frist bis" in rights.assign_problem({**offered, "display_name": "Rudel Eins"}, SEASON)


def test_back_from_the_waitlist_in_automatic_mode_nothing_waits_for_an_acceptance():
    waiting = {**application(status="offered", offered_at=NOW.isoformat()), "status": "waitlist", "display_name": "Rudel Eins"}
    auto = {**SEASON, "start_rights": {"mode": "auto"}}
    fields = rights.reoffer_fields(waiting, NOW.isoformat(), auto)
    assert fields["carry_over.start_right"]["status"] == "accepted" and fields["carry_over.start_right"]["accepted_via"] == "mode"
    assert rights.waitlist_problem(waiting, auto) is None
    assert rights.waitlist_problem(waiting, SEASON) and rights.reoffer_fields(waiting, NOW.isoformat(), SEASON) == {
        "carry_over.start_right": {"status": "offered", "offered_at": NOW.isoformat()}}


# ---------------------------------------------------------------- Dritte Nachbesserung (P2): Auch die Mindest-Restfrist ruht in einer Pause

FAR = {**TEN, "start_date": (NOW + 90 * DAY).isoformat()}


def test_a_pause_also_rests_the_minimum_rest_after_an_offer_to_move_up():
    # Angebot Tag 9 bis 29, eigene Frist danach am Tag 30 vorbei - Boden: drei Tage nach dem Rückfall, also Tag 32.
    own = {"status": "offered", "offered_at": NOW.isoformat()}
    back = application(**rights.restored_right(offer_to_move_up(own, NOW + 9 * DAY), TEN, NOW + 29 * DAY, None, declined=False))
    span = lambda start, end=None: {"from": (NOW + start * DAY).isoformat(), "to": (NOW + end * DAY).isoformat() if end is not None else None}  # noqa: E731
    assert rights.accept_until(back, FAR) == NOW + 32 * DAY
    # Pause Tag 31 bis 40: Die Frist ruht neun Tage - Tag 41, nicht Tag 32.
    assert rights.accept_until(back, {**FAR, "start_right_pauses": [span(31, 40)]}) == NOW + 41 * DAY
    # Eine offene Pause ab Tag 31 ruht: kein Ende, nichts überfällig.
    running = {**FAR, "start_right_pauses": [span(31)]}
    assert rights.accept_until(back, running) is None and rights.resting(back, running)
    assert not rights.overdue(back, running, NOW + 60 * DAY) and rights.state(back, running, NOW + 60 * DAY) == "offered"
    # Eine Pause erst nach dem Boden ändert nichts; eine, die schon beim Rückfall läuft, zählt ab dem Rückfall.
    assert rights.accept_until(back, {**FAR, "start_right_pauses": [span(33, 40)]}) == NOW + 32 * DAY
    assert rights.accept_until(back, {**FAR, "start_right_pauses": [span(25, 35)]}) == NOW + 38 * DAY
    # Das Startdatum bleibt die äußerste Grenze.
    assert rights.accept_until(back, {**TEN, "start_right_pauses": [span(31, 40)], "start_date": (NOW + 35 * DAY).isoformat()}) == NOW + 35 * DAY


def test_the_reminder_after_a_fall_back_waits_for_half_of_the_rest():
    # Restfrist ein Tag, Erinnerung 48 Stunden: nicht sofort nach dem Rückfall - die Nachricht dazu nennt die Frist schon.
    one = {**FAR, "start_rights": {"mode": "accept", "accept_days": 10, "rest_days": 1}}
    own = {"status": "offered", "offered_at": NOW.isoformat()}
    back = application(**rights.restored_right(offer_to_move_up(own, NOW + 9 * DAY), one, NOW + 12 * DAY, None, declined=False))
    assert rights.accept_until(back, one) == NOW + 13 * DAY
    assert rights.remind_at(back, one, {"remind_hours": 48}) == NOW + 12 * DAY + timedelta(hours=12)
