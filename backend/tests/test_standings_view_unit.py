"""Rangliste, Ergebnis-PDF und Urkunden stimmig (#2121): wer in der Rangliste steht, was „N“ und „Runde“ zählen und
welche Spalten das PDF je Format hat. Alle Namen sind erfunden."""

from pdf_service import _pdf_standings_tables, pdf_standings
from routes.export_routes import _tournament_certificate_metrics
from services.competition_snapshot import adapt_stage_matches, build_structure_snapshot
from services.competition_standings import public_standings, stage_standings, standing_registrations


def _duel(match_id, round_number, winner, loser, *, status="completed", section="main"):
    results = [
        {"registration_id": winner, "rank": 1, "outcome": "winner", "score": 2},
        {"registration_id": loser, "rank": 2, "outcome": "loser", "score": 1},
    ] if status == "completed" else []
    return {
        "id": match_id,
        "tournament_id": "t1",
        "stage_id": "s1",
        "stage_number": 1,
        "section": section,
        "round": round_number,
        "slots": [
            {"slot": 1, "registration_id": winner, "status": "filled", "source": {"type": "seed", "seed": 1}},
            {"slot": 2, "registration_id": loser, "status": "filled", "source": {"type": "seed", "seed": 2}},
        ],
        "results": results,
        "advancement": [],
        "status": status,
    }


REGS = [
    {"id": "r1", "display_name": "Nordlicht", "status": "checked_in"},
    {"id": "r2", "display_name": "Steinbock", "status": "approved"},
    {"id": "r3", "display_name": "Wolkenfuchs", "status": "approved"},
    {"id": "r4", "display_name": "Kieselkatze", "status": "approved"},
]


def test_a_knockout_loss_counts_as_a_loss_and_the_round_is_the_furthest_one():
    matches = adapt_stage_matches([
        _duel("a", 1, "r1", "r2"),
        _duel("b", 1, "r3", "r4"),
        _duel("f", 2, "r1", "r3"),
    ])

    rows = {row["registration_id"]: row for row in stage_standings(matches, REGS)}

    assert (rows["r1"]["won"], rows["r1"]["lost"], rows["r1"]["furthest_round"]) == (2, 0, 2)
    assert (rows["r3"]["won"], rows["r3"]["lost"], rows["r3"]["furthest_round"]) == (1, 1, 2)
    assert (rows["r2"]["won"], rows["r2"]["lost"]) == (0, 1)


def test_only_accepted_registrations_and_players_with_games_stand_in_the_table():
    matches = adapt_stage_matches([_duel("a", 1, "r1", "r5")])
    regs = [
        *REGS[:2],
        {"id": "r5", "display_name": "Ausgeschieden", "status": "disqualified"},
        {"id": "r6", "display_name": "Warteliste", "status": "waitlist"},
        {"id": "r7", "display_name": "Offen", "status": "pending"},
        {"id": "r8", "display_name": "Abgelehnt", "status": "rejected"},
        {"id": "r9", "display_name": "Nicht da", "status": "no_show"},
        {"id": "r10", "display_name": "Abgemeldet", "status": "withdrawn"},
    ]

    kept = {reg["id"] for reg in standing_registrations(regs, matches)}

    assert kept == {"r1", "r2", "r5"}


def test_knockout_without_any_result_has_no_places_yet():
    snapshot = build_structure_snapshot("t1", stage_matches=[_duel("a", 1, "r1", "r2", status="scheduled")])

    assert public_standings({"format": "single_elim"}, snapshot, REGS) == []
    assert public_standings({"format": "ffa"}, snapshot, REGS) == []


def test_a_league_without_results_still_lists_every_accepted_player():
    snapshot = build_structure_snapshot("t1", stage_matches=[])
    regs = [*REGS, {"id": "r6", "display_name": "Warteliste", "status": "waitlist"}]

    rows = public_standings({"format": "league"}, snapshot, regs)

    assert {row["registration_id"] for row in rows} == {"r1", "r2", "r3", "r4"}


def test_the_knockout_pdf_counts_rounds_not_points_and_names_teams():
    rows = [
        {"rank": 1, "display_name": "Nordlicht", "won": 2, "lost": 0, "points": 0, "furthest_round": 2},
        {"rank": 2, "display_name": "Wolkenfuchs", "won": 1, "lost": 1, "points": 0, "furthest_round": 2},
    ]

    [solo] = _pdf_standings_tables({"format": "single_elim", "team_mode": "solo"}, rows)
    [team] = _pdf_standings_tables({"format": "double_elim", "team_mode": "team"}, rows)

    assert solo["headers"] == ["Platz", "Name", "Siege", "Niederlagen", "Runde"]
    assert solo["rows"][1] == ["2", "Wolkenfuchs", "1", "1", "2"]
    assert team["headers"][1] == "Team"


def test_the_league_pdf_has_draws_difference_and_points():
    rows = [
        {"rank": 1, "display_name": "Nordlicht", "played": 3, "won": 2, "drawn": 1, "lost": 0, "score_diff": 4, "points": 7},
        {"rank": 2, "display_name": "Steinbock", "played": 3, "won": 0, "drawn": 1, "lost": 2, "score_diff": -4, "points": 1},
    ]

    [table] = _pdf_standings_tables({"format": "league"}, rows)

    assert table["headers"] == ["Platz", "Name", "Sp", "S", "U", "N", "Diff", "Pkt"]
    assert table["rows"][0][-2:] == ["+4", "7"]
    assert table["rows"][1][-2] == "-4"


def test_the_swiss_pdf_has_buchholz():
    rows = [{"rank": 1, "display_name": "Nordlicht", "played": 3, "won": 2, "drawn": 1, "lost": 0, "buchholz": 4.5, "points": 2.5}]

    [table] = _pdf_standings_tables({"format": "swiss"}, rows)

    assert table["headers"] == ["Platz", "Name", "Sp", "S", "U", "N", "BHZ", "Pkt"]
    assert table["rows"][0][-2:] == ["4,5", "2,5"]


def test_the_ffa_pdf_has_average_place_and_points():
    rows = [{"rank": 1, "display_name": "Nordlicht", "played": 3, "won": 2, "lost": 1, "avg_rank": 1.33, "points": 28, "furthest_round": 2}]

    [table] = _pdf_standings_tables({"format": "ffa"}, rows)

    assert table["headers"] == ["Platz", "Name", "Sp", "Siege", "Ø Platz", "Punkte"]
    assert table["rows"][0][2:] == ["3", "2", "1,33", "28"]


def test_the_group_pdf_has_one_table_per_group_instead_of_dashes():
    rows = [
        {"group": {"id": "g1", "group_key": "a"}, "standings": [
            {"rank": 1, "display_name": "Nordlicht", "played": 1, "won": 1, "drawn": 0, "lost": 0, "score_diff": 1, "points": 3},
        ]},
        {"group": {"id": "g2", "group_key": "b", "name": "Gruppe Süd"}, "standings": [
            {"rank": 1, "display_name": "Steinbock", "played": 1, "won": 1, "drawn": 0, "lost": 0, "score_diff": 2, "points": 3},
        ]},
    ]

    tables = _pdf_standings_tables({"format": "groups"}, rows)

    assert [table["title"] for table in tables] == ["Gruppe A", "Gruppe Süd"]
    assert tables[0]["rows"] == [["1", "Nordlicht", "1", "1", "0", "0", "+1", "3"]]
    assert pdf_standings({"title": "Herbstpokal", "format": "groups"}, rows).startswith(b"%PDF-")


def test_the_fast_lap_championship_keeps_its_points():
    rows = [{"rank": 1, "display_name": "Nordlicht", "won": 2, "lost": 1, "points": 43}]

    [table] = _pdf_standings_tables({"title": "Fast Lap · Championship"}, rows)

    assert table["headers"] == ["Platz", "Name", "Siege", "Niederlagen", "Punkte"]
    assert table["rows"][0][2:] == ["2", "1", "43"]


def test_certificates_show_the_round_in_a_knockout_and_points_in_a_table():
    knockout = {"rank": 2, "won": 1, "lost": 1, "points": 0, "furthest_round": 2}
    league = {"rank": 1, "won": 2, "lost": 0, "points": 6, "score_diff": 3}

    assert _tournament_certificate_metrics(knockout, {"format": "single_elim"}) == [
        {"label": "Siege", "value": 1}, {"label": "Niederlagen", "value": 1}, {"label": "Runde", "value": 2}]
    assert _tournament_certificate_metrics(league, {"format": "league"})[-1] == {"label": "Punkte", "value": 6}
