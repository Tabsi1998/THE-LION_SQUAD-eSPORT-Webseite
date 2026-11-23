"""Turnier-Tabellen von früher bleiben, wie sie sind (#1559): „Jeder gegen jeden“, Gruppen und das Schweizer System
ohne die neuen Einstellungen rechnen wie auf main vor #1559. Die Liga-Staffel hält ``test_league_table_regression_unit``
fest; diese Datei tut dasselbe für die drei Turnierformate - als feste Werte, erzeugt mit dem Stand von main.

Die Spiele entstehen aus einer kleinen Zahlenfolge ohne Zufallsmodul, damit sie auf jedem Rechner dieselben sind.
Nur erfundene Namen.
"""
import itertools
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.competition_standings import standings_for_structure  # noqa: E402

TEAMS = ("adler", "biber", "dachs", "elster", "falke", "gams", "habicht", "iltis")
GROUP_A, GROUP_B = TEAMS[:4], TEAMS[4:]
GROUPS = [{"id": "ga", "group_key": "A", "participant_ids": list(GROUP_A)},
          {"id": "gb", "group_key": "B", "participant_ids": list(GROUP_B)}]
SEEDS = (1, 2, 3, 4)
FIELDS = ("registration_id", "rank", "points", "played", "won", "drawn", "lost", "buchholz", "score_for", "score_against")


def sequence(seed):
    """Eine feste Zahlenfolge (linearer Kongruenzgenerator) - auf jedem Rechner und in jeder Python-Version gleich."""
    state = seed * 2654435761 % 2147483647 or 1
    while True:
        state = state * 48271 % 2147483647
        yield state


def played(seed, pairs):
    """Spiele für die Paare: Siege, Unentschieden, kampflose Wertungen, ein offenes Spiel - und ein ausgetretenes Team."""
    numbers = sequence(seed)
    matches = []
    for index, (home, away) in enumerate(pairs):
        roll = next(numbers) % 100
        loser_score = next(numbers) % 2
        level = next(numbers) % 9 == 0
        winner, loser = (home, away) if roll % 2 == 0 else (away, home)
        match = {"id": f"s{seed}-{index}", "round": index // 4 + 1, "order": index % 4 + 1, "status": "completed",
                 "source": {"engine": "stage"},
                 "slots": [{"position": 1, "registration_id": home}, {"position": 2, "registration_id": away}]}
        if roll >= 97:
            match.update({"status": "scheduled", "results": []})
        elif roll >= 88:
            match.update({"status": "forfeit", "results": [
                {"registration_id": winner, "rank": 1, "outcome": "winner", "score": 1},
                {"registration_id": loser, "rank": 2, "outcome": "forfeit", "forfeit": True, "score": None}]})
        elif level:
            match["results"] = [
                {"registration_id": home, "rank": 1, "outcome": "draw", "score": 1},
                {"registration_id": away, "rank": 1, "outcome": "draw", "score": 1}]
        else:
            match["results"] = [
                {"registration_id": winner, "rank": 1, "outcome": "winner", "score": 2},
                {"registration_id": loser, "rank": 2, "outcome": "placed", "score": loser_score}]
        matches.append(match)
    gone = TEAMS[next(numbers) % len(TEAMS)] if seed % 2 else None
    registrations = [{"id": team, "display_name": team.title(), "status": "withdrawn" if team == gone else "approved"}
                     for team in TEAMS]
    return matches, registrations


def swiss_pairs(seed):
    """Vier Runden mit je vier Spielen, jede Runde anders gemischt."""
    numbers = sequence(seed + 1000)
    pairs = []
    for _round in range(4):
        keyed = sorted((next(numbers), team) for team in TEAMS)
        order = [team for _number, team in keyed]
        pairs.extend((order[index], order[index + 1]) for index in range(0, len(order), 2))
    return pairs


def cells(rows):
    return [[row.get(field) for field in FIELDS] for row in rows]


def table(kind, seed, **extra):
    everyone = list(itertools.combinations(TEAMS, 2))
    if kind == "jeder":
        matches, registrations = played(seed, everyone)
        return cells(standings_for_structure({"id": "t", "format": "round_robin", **extra}, {"matches": matches}, registrations))
    if kind == "gruppen":
        matches, registrations = played(seed, [pair for pair in everyone if (pair[0] in GROUP_A) == (pair[1] in GROUP_A)])
        for match in matches:
            in_a = match["slots"][0]["registration_id"] in GROUP_A
            match.update({"section": "group_A" if in_a else "group_B", "group_id": "ga" if in_a else "gb"})
        tables = standings_for_structure({"id": "t", "format": "groups", **extra}, {"matches": matches}, registrations,
                                         groups=GROUPS)
        return [cells(entry["standings"]) for entry in tables]
    matches, registrations = played(seed, swiss_pairs(seed))
    return cells(standings_for_structure({"id": "t", "format": "swiss", **extra}, {"matches": matches}, registrations))


KINDS = ("gruppen", "jeder", "schweizer")

# Erzeugt mit dem Stand von main vor #1559 (python backend/tests/test_tournament_table_regression_unit.py).
EXPECTED: dict = {'gruppen-1': [[['dachs', 1, 9, 3, 3, 0, 0, None, 6, 3], ['biber', 2, 6, 3, 2, 0, 1, None, 5, 3], ['adler', 3, 3, 3, 1, 0, 2, None, 4, 5],
                ['elster', 4, 0, 3, 0, 0, 3, None, 2, 6]],
               [['habicht', 1, 9, 3, 3, 0, 0, None, 6, 3], ['gams', 2, 6, 3, 2, 0, 1, None, 3, 2], ['falke', 3, 3, 3, 1, 0, 2, None, 3, 3],
                ['iltis', 4, 0, 3, 0, 0, 3, None, 1, 5]]],
 'gruppen-2': [[['biber', 1, 6, 3, 2, 0, 1, None, 5, 2], ['adler', 2, 4, 3, 1, 1, 1, None, 4, 4], ['dachs', 3, 4, 3, 1, 1, 1, None, 3, 4],
                ['elster', 4, 3, 3, 1, 0, 2, None, 3, 5]],
               [['gams', 1, 9, 3, 3, 0, 0, None, 6, 3], ['falke', 2, 3, 3, 1, 0, 2, None, 4, 4], ['iltis', 3, 3, 3, 1, 0, 2, None, 3, 4],
                ['habicht', 4, 3, 3, 1, 0, 2, None, 3, 5]]],
 'gruppen-3': [[['biber', 1, 6, 3, 2, 0, 1, None, 5, 3], ['dachs', 2, 4, 2, 1, 1, 0, None, 3, 2], ['adler', 3, 3, 2, 1, 0, 1, None, 3, 3],
                ['elster', 4, 1, 3, 0, 1, 2, None, 2, 5]],
               [['habicht', 1, 9, 3, 3, 0, 0, None, 6, 1], ['gams', 2, 4, 3, 1, 1, 1, None, 3, 4], ['falke', 3, 3, 3, 1, 0, 2, None, 3, 5],
                ['iltis', 4, 1, 3, 0, 1, 2, None, 3, 5]]],
 'gruppen-4': [[['adler', 1, 6, 3, 2, 0, 1, None, 5, 4], ['elster', 1, 6, 3, 2, 0, 1, None, 5, 4], ['biber', 3, 3, 3, 1, 0, 2, None, 4, 4],
                ['dachs', 4, 3, 3, 1, 0, 2, None, 3, 5]],
               [['iltis', 1, 9, 3, 3, 0, 0, None, 6, 1], ['falke', 2, 3, 3, 1, 0, 2, None, 4, 4], ['habicht', 3, 3, 3, 1, 0, 2, None, 2, 4],
                ['gams', 4, 3, 3, 1, 0, 2, None, 2, 5]]],
 'jeder-1': [['falke', 1, 16, 7, 5, 1, 1, None, 10, 6], ['iltis', 2, 15, 7, 5, 0, 2, None, 11, 6], ['biber', 3, 15, 7, 5, 0, 2, None, 11, 7],
             ['dachs', 4, 10, 7, 3, 1, 3, None, 9, 9], ['habicht', 4, 10, 7, 3, 1, 3, None, 8, 8], ['adler', 6, 9, 7, 3, 0, 4, None, 9, 9],
             ['elster', 7, 6, 7, 2, 0, 5, None, 6, 10], ['gams', 8, 1, 7, 0, 1, 6, None, 3, 12]],
 'jeder-2': [['adler', 1, 13, 7, 4, 1, 2, None, 11, 7], ['elster', 2, 12, 7, 4, 0, 3, None, 10, 8], ['habicht', 3, 11, 7, 3, 2, 2, None, 9, 7],
             ['dachs', 4, 10, 7, 3, 1, 3, None, 9, 9], ['gams', 5, 10, 7, 3, 1, 3, None, 8, 10], ['biber', 6, 9, 6, 3, 0, 3, None, 8, 8],
             ['falke', 7, 9, 7, 3, 0, 4, None, 7, 9], ['iltis', 8, 4, 6, 1, 1, 4, None, 6, 10]],
 'jeder-3': [['biber', 1, 13, 7, 4, 1, 2, None, 9, 8], ['dachs', 2, 12, 6, 4, 0, 2, None, 8, 5], ['falke', 3, 12, 7, 4, 0, 3, None, 9, 7],
             ['gams', 4, 10, 7, 3, 1, 3, None, 7, 8], ['iltis', 5, 9, 7, 3, 0, 4, None, 7, 9], ['habicht', 6, 8, 7, 2, 2, 3, None, 9, 9],
             ['adler', 7, 7, 6, 2, 1, 3, None, 8, 8], ['elster', 8, 7, 7, 2, 1, 4, None, 6, 9]],
 'jeder-4': [['dachs', 1, 15, 7, 5, 0, 2, None, 10, 5], ['elster', 2, 13, 7, 4, 1, 2, None, 10, 8], ['habicht', 2, 13, 7, 4, 1, 2, None, 9, 7],
             ['iltis', 4, 12, 7, 4, 0, 3, None, 8, 7], ['falke', 5, 10, 7, 3, 1, 3, None, 7, 8], ['adler', 6, 9, 7, 3, 0, 4, None, 10, 10],
             ['gams', 7, 7, 7, 2, 1, 4, None, 7, 9], ['biber', 8, 3, 7, 1, 0, 6, None, 5, 12]],
 'schweizer-1': [['iltis', 1, 3, 4, 3, 0, 1, 9.5, None, None], ['biber', 2, 3, 4, 3, 0, 1, 8, None, None],
                 ['adler', 3, 3, 4, 3, 0, 1, 4.5, None, None], ['elster', 4, 2.5, 4, 2, 1, 1, 7.0, None, None],
                 ['gams', 5, 1.5, 4, 1, 1, 2, 9.0, None, None], ['dachs', 6, 1, 4, 1, 0, 3, 10, None, None],
                 ['falke', 7, 1, 4, 1, 0, 3, 8.0, None, None], ['habicht', 7, 1, 4, 1, 0, 3, 8, None, None]],
 'schweizer-2': [['biber', 1, 4, 4, 4, 0, 0, 5.5, None, None], ['iltis', 2, 3, 3, 3, 0, 0, 4.5, None, None],
                 ['adler', 3, 2, 4, 2, 0, 2, 9, None, None], ['gams', 4, 1.5, 4, 1, 1, 2, 9.5, None, None],
                 ['elster', 5, 1.5, 4, 1, 1, 2, 4.5, None, None], ['dachs', 6, 1, 4, 1, 0, 3, 9.5, None, None],
                 ['falke', 7, 1, 3, 1, 0, 2, 7.0, None, None], ['habicht', 8, 1, 4, 1, 0, 3, 6.5, None, None]],
 'schweizer-3': [['adler', 1, 3, 4, 3, 0, 1, 7.5, None, None], ['elster', 2, 2.5, 4, 2, 1, 1, 6.0, None, None],
                 ['falke', 2, 2.5, 4, 2, 1, 1, 6.0, None, None], ['gams', 4, 2.0, 4, 1, 2, 1, 9.5, None, None],
                 ['biber', 5, 2, 4, 2, 0, 2, 7.5, None, None], ['dachs', 6, 2, 3, 2, 0, 1, 7.0, None, None],
                 ['habicht', 7, 1, 3, 1, 0, 2, 5.5, None, None], ['iltis', 8, 0, 4, 0, 0, 4, 8.0, None, None]],
 'schweizer-4': [['falke', 1, 4, 4, 4, 0, 0, 4, None, None], ['biber', 2, 3, 4, 3, 0, 1, 8, None, None], ['adler', 3, 3, 4, 3, 0, 1, 6, None, None],
                 ['elster', 4, 2, 4, 2, 0, 2, 8, None, None], ['iltis', 5, 1, 4, 1, 0, 3, 11, None, None], ['gams', 6, 1, 4, 1, 0, 3, 10, None, None],
                 ['habicht', 6, 1, 4, 1, 0, 3, 10, None, None], ['dachs', 8, 1, 4, 1, 0, 3, 7, None, None]]}


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("seed", SEEDS)
def test_tournament_tables_are_what_they_were_before(seed, kind):
    assert table(kind, seed) == EXPECTED[f"{kind}-{seed}"]


if __name__ == "__main__":
    import pprint

    pprint.pprint({f"{kind}-{seed}": table(kind, seed) for kind in KINDS for seed in SEEDS}, width=150, compact=True)
