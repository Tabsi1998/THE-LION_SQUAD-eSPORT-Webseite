"""Wer war wann im Team, wer hat für eine Anmeldung gespielt (#2337) - die Regeln ohne Datenbank."""
import pathlib
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.achievement_participation import Participation, TeamTimeline, lineup_of, parse_time  # noqa: E402


def at(day: int) -> datetime:
    return datetime(2026, 9, day, 18, 0, tzinfo=timezone.utc)


def duel(match_id: str, first: str, second: str, day: int, **extra) -> dict:
    return {"id": match_id, "tournament_id": "t1", "status": "completed", "completed_at": at(day).isoformat(),
            "slots": [{"slot": 1, "registration_id": first}, {"slot": 2, "registration_id": second}],
            "results": [{"registration_id": first, "rank": 1}, {"registration_id": second, "rank": 2}], **extra}


def test_heute_mitglied_zaehlt_ab_dem_beitritt():
    timeline = TeamTimeline()
    timeline.joined["T"] = at(10)
    assert not timeline.member_at("T", at(9)) and timeline.member_at("T", at(10)) and timeline.member_at("T", at(20))
    timeline.joined["alt"] = None
    assert timeline.member_at("alt", at(1)), "ohne Beitrittsdatum schon immer dabei"
    assert timeline.member_at("T", None), "ohne Zeitpunkt gilt der heutige Stand"
    assert not timeline.member_at("fremd", at(10)) and not timeline.knows("fremd")


def test_ausgetreten_bleibt_fuer_die_zeit_davor_mitglied():
    timeline = TeamTimeline()
    timeline.events["T"] = [(at(15), "leave")]
    assert timeline.knows("T")
    assert timeline.member_at("T", at(10)), "vor dem Austritt"
    assert not timeline.member_at("T", at(16)), "nach dem Austritt"
    assert not timeline.member_at("T", None), "ohne Zeitpunkt zählt nur, wer heute dabei ist"


def test_beitritt_austritt_wiedereintritt():
    timeline = TeamTimeline()
    timeline.events["T"] = [(at(5), "join"), (at(10), "leave"), (at(20), "join"), (at(25), "leave")]
    assert not timeline.member_at("T", at(4)), "vor dem ersten Beitritt"
    assert timeline.member_at("T", at(7))
    assert not timeline.member_at("T", at(15)), "zwischen Austritt und Wiedereintritt"
    assert timeline.member_at("T", at(22))
    assert not timeline.member_at("T", at(26))
    # Wieder dabei und geblieben: der heutige Stand kennt nur den letzten Beitritt, das Protokoll die Zeit davor.
    timeline.events["T"] = [(at(5), "join"), (at(10), "leave"), (at(20), "join")]
    timeline.joined["T"] = at(20)
    assert timeline.member_at("T", at(7)) and not timeline.member_at("T", at(15)) and timeline.member_at("T", at(21))


def test_aufgeloestes_team_zaehlt_bis_zur_aufloesung():
    timeline = TeamTimeline()
    timeline.closed["T"] = (at(5), at(20))
    assert timeline.member_at("T", at(10)) and not timeline.member_at("T", at(4)) and not timeline.member_at("T", at(21))


def test_teilnehmerliste_am_spiel_und_an_den_maps():
    match = {"lineups": {"r1": ["a", "b"]}, "games": [{"lineups": {"r1": ["c"], "r2": ["x"]}}, {"lineups": {}}, "kaputt"]}
    assert lineup_of(match, "r1") == {"a", "b", "c"} and lineup_of(match, "r2") == {"x"} and lineup_of(match, "r3") == set()
    assert lineup_of({}, "r1") == set()


def participation(user_id: str, registrations: list[dict], matches: list[dict], timeline: TeamTimeline | None = None, squads=None) -> Participation:
    tournaments = {"t1": {"id": "t1", "status": "results_published", "format": "single_elim"}}
    return Participation(user_id, {reg["id"]: reg for reg in registrations}, tournaments, matches, timeline or TeamTimeline(), squads or {})


def test_reihenfolge_teilnehmerliste_vor_aufstellung_vor_kader_vor_mitgliedschaft():
    timeline = TeamTimeline()
    timeline.joined["T"] = None
    team = {"id": "rt", "tournament_id": "t1", "team_id": "T", "user_id": "lead", "status": "approved"}
    plain = duel("m1", "rt", "rx", 10)
    assert participation("me", [team], [plain], timeline).played, "ohne Liste: Mitglied zum Zeitpunkt des Spiels"
    # Aufstellung an der Anmeldung schlägt die Mitgliedschaft.
    lined_up = {**team, "lineup": ["other"]}
    assert not participation("me", [lined_up], [plain], timeline).played
    # Teilnehmerliste am Spiel schlägt die Aufstellung.
    listed = duel("m1", "rt", "rx", 10, lineups={"rt": ["me"]})
    assert participation("me", [lined_up], [listed], timeline).played
    # Co-Team ohne Liste: sein Kader, nicht das ganze Hauptteam.
    squad = {**team, "squad_id": "S"}
    assert not participation("me", [squad], [plain], timeline, {"S": {"other"}}).played
    assert participation("me", [squad], [plain], timeline, {"S": {"me"}}).played


def squad_participation(squads: dict, squad_timeline: TeamTimeline | None = None, team_since=None) -> Participation:
    """Ein Co-Team „S“ des Teams „T“ mit zwei Spielen ohne Teilnehmerliste: am 10. und am 20."""
    timeline = TeamTimeline()
    timeline.joined["T"] = team_since
    squad = {"id": "rt", "tournament_id": "t1", "team_id": "T", "squad_id": "S", "user_id": None, "status": "approved"}
    tournaments = {"t1": {"id": "t1", "status": "live", "format": "league", "league_context": {"league_id": "l"}}}
    matches = [duel("frueh", "rt", "rx", 10), duel("spaet", "rt", "rx", 20)]
    return Participation("me", {"rt": squad}, tournaments, matches, timeline, squads, squad_timeline)


def played_ids(found: Participation) -> list[str]:
    return [row.match["id"] for row in found.played]


def test_kaderwechsel_im_co_team_wer_gespielt_hat_behaelt_seine_spiele():
    """Review M4: Nach dem Transfer steht die Person nicht mehr im heutigen Kader - das frühe Spiel bleibt ihr trotzdem."""
    gone = TeamTimeline()
    gone.events["S"] = [(at(15), "leave")]
    assert played_ids(squad_participation({"S": {"other"}}, gone)) == ["frueh"]
    # Ohne jede Spur im Kader: nicht gespielt - auch als Mitglied des Hauptteams nicht.
    assert played_ids(squad_participation({"S": {"other"}})) == []


def test_kaderwechsel_im_co_team_wer_neu_dazukommt_bekommt_keine_alten_spiele():
    joined = TeamTimeline()
    joined.events["S"] = [(at(15), "join")]
    joined.joined["S"] = at(15)
    assert played_ids(squad_participation({"S": {"me"}}, joined)) == ["spaet"]
    # Die Aufnahme steht nicht im Protokoll (das Co-Team spielte da noch in keiner Staffel): frühestens seit dem Beitritt
    # zum Hauptteam.
    assert played_ids(squad_participation({"S": {"me"}}, team_since=at(15))) == ["spaet"]
    assert played_ids(squad_participation({"S": {"me"}})) == ["frueh", "spaet"], "schon immer im Team und im Kader"
    # Raus und wieder rein: die Lücke dazwischen zählt nicht.
    back = TeamTimeline()
    back.events["S"] = [(at(5), "join"), (at(8), "leave"), (at(15), "join")]
    back.joined["S"] = at(15)
    assert played_ids(squad_participation({"S": {"me"}}, back)) == ["spaet"]


def test_team_ohne_spuren_zaehlt_fuer_die_anmeldende_person():
    team = {"id": "rt", "tournament_id": "t1", "team_id": "weg", "user_id": "me", "status": "approved"}
    assert participation("me", [team], [duel("m1", "rt", "rx", 10)]).played
    assert not participation("other", [team], [duel("m1", "rt", "rx", 10)]).played


def test_spiel_aus_sicht_der_person():
    solo = {"id": "r1", "tournament_id": "t1", "user_id": "me", "status": "approved"}
    won, lost = duel("m1", "r1", "rx", 10), duel("m2", "rx", "r1", 11)
    bye = {"id": "m0", "tournament_id": "t1", "status": "completed", "completed_at": at(9).isoformat(),
           "slots": [{"slot": 1, "registration_id": "r1"}, {"slot": 2, "registration_id": None, "status": "bye"}],
           "results": [{"registration_id": "r1", "rank": 1}]}
    walkover = duel("m3", "rx", "r1", 12, status="forfeit", forfeit_registration_id="r1")
    walkover["results"][1]["forfeit"] = True
    mine = participation("me", [solo], [bye, won, lost, walkover])
    assert [row.match["id"] for row in mine.played] == ["m1", "m2"], "kein Freilos, kein Spiel ohne Antreten"
    assert [(row.won, row.lost, row.no_show) for row in mine.rows] == [(True, False, False), (False, True, False), (False, True, True)]
    assert mine.rows[0].opponents == {"rx"} and mine.rows[0].when == at(10)
    assert mine.match_progress() == {"matches_played": 2, "matches_won": 1, "match_streak_max": 1}
    assert mine.played_registration_ids == {"r1"} and [reg["id"] for reg in mine.entries()] == ["r1"]


def test_teilnahme_braucht_ein_echtes_spiel_einen_gueltigen_status_und_ein_turnier_das_stattfand():
    reg = {"id": "r1", "tournament_id": "t1", "user_id": "me", "status": "approved"}
    match = duel("m1", "r1", "rx", 10)
    assert not participation("me", [reg], []).entries(), "nur angemeldet"
    for status in ("rejected", "waitlist", "pending", "no_show"):
        assert not participation("me", [{**reg, "status": status}], [match]).entries(), status
    # Review M5: Wer gespielt hat, hat teilgenommen - auch nach Austritt oder Disqualifikation. Bis zum Ende dabei war er nicht.
    for status in ("withdrawn", "disqualified"):
        left = participation("me", [{**reg, "status": status}], [match])
        assert [row["id"] for row in left.entries()] == ["r1"] and not left.entries(still_in=True), status
        assert left.tournaments_played() == 1 and not left.finished_entries(), status
        assert not participation("me", [{**reg, "status": status}], []).entries(), "ohne Spiel keine Teilnahme"
    assert participation("me", [{**reg, "status": "checked_in"}], [match]).entries()
    cancelled = participation("me", [reg], [match])
    cancelled.tournaments["t1"]["status"] = "cancelled"
    assert not cancelled.entries(), "abgesagte Turniere zählen nicht"


def test_zeit_lesen():
    assert parse_time("2026-09-01T18:00:00Z") == datetime(2026, 9, 1, 18, 0, tzinfo=timezone.utc)
    assert parse_time("2026-09-01T18:00:00") == datetime(2026, 9, 1, 18, 0, tzinfo=timezone.utc)
    assert parse_time(datetime(2026, 9, 1, 18, 0)) == datetime(2026, 9, 1, 18, 0, tzinfo=timezone.utc)
    assert parse_time(None) is None and parse_time("kaputt") is None
