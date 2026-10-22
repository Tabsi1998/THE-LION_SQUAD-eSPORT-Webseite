"""Lese-Adapter „TFT-Dashboard“ einer Partner-Plattform (#1964) - ohne Netz und Datenbank.

Die öffentliche Seite des Partners lädt ihre Daten als JSON (mit dem Partner abgesprochen, nur lesend):

- ``/api/series`` - Serien bzw. Saisons (``series_list``),
- ``/api/series/{id}`` - eine Serie mit ihren Turnieren (``series_tournaments``),
- ``/api/tournaments/{id}`` - ein Turniertag mit Runden → Lobbys → Spielern, der Rangliste (``participants``) und bei
  Double Up den Teams (``tournament``).

Hier wird die Antwort auf das eingedampft, was das Ergebnisblatt einer Turnierserie (#1961) braucht - Zeilen genau wie
beim Eintragen (``ResultEntryRow``):

- **Name** als Riot-ID ``Name#TAG`` (Abgleich nach den Regeln aus #1961). Gäste des Partners (Kennung ``guest_…`` bzw.
  Tag „GUEST“) haben keine Riot-ID - sie stehen nur mit dem Namen da und laufen wie jeder neue Name durch „Unbekannte
  Namen“ (#1743).
- **Tagesplatz** aus der Reihenfolge des Veranstalters (er löst Gleichstände selbst auf), im Double Up der Platz des
  Teams für beide Partner (``partner``).
- **Runden** je Zeile ``{place, points, lobby}`` - Punkte so, wie die Quelle sie liefert. Bots (``is_filler``) sind nie
  eine Zeile, verschieben aber die Punkte der Menschen dahinter. Eine Runde ohne Eintrag ist ``None`` (nicht gespielt);
  wer ausgestiegen ist (``dropped_out``), trägt die Marke ``left``.
- **Tagessumme** (``day_points``) wie beim Veranstalter (GES P).

**Datenschutz:** Die Riot-Kennung (PUUID) dient nur hier, im Speicher, zum Zusammenführen der Runden einer Person und
der Teams - sie verlässt dieses Modul nie. Avatare, Rang, Liga-Punkte und Rohantworten werden nicht übernommen.

Unerwartete Antworten heben ``SourceFormatError`` mit fester Meldung - nie Text aus der Antwort.
"""
from __future__ import annotations

import math
from datetime import datetime
from zoneinfo import ZoneInfo

VIENNA = ZoneInfo("Europe/Vienna")
FORMAT_MESSAGE = "Die Partner-Plattform hat in unerwarteter Form geantwortet - die Anbindung muss geprüft werden."
MAX_REF_LENGTH = 12
MAX_ROUNDS = 20  # wie ``scoring_rules.MAX_DAY_ROUNDS``
MAX_NAME = 100
MAX_TITLE = 160
MAX_NUMBER = 1_000_000  # Kennungen, Zähler, Rundennummern - alles darüber ist unbrauchbar
MAX_POINTS = 1000  # Punkte je Runde (wie ``ResultDayRound``)
MAX_PLACE = 100  # Platz in einer Lobby
MAX_TOTAL = 10_000  # Tagessumme (wie ``ResultEntryRow.day_points``)
GUEST_PREFIX = "guest_"
GUEST_TAG = "GUEST"


class SourceFormatError(ValueError):
    """Die Antwort passt nicht zur erwarteten Form - Meldung immer ``FORMAT_MESSAGE``."""

    def __init__(self):
        super().__init__(FORMAT_MESSAGE)


# ---------------------------------------------------------------- Werte
def valid_ref(value) -> bool:
    """Kennung beim Partner: nur ASCII-Ziffern, höchstens zwölf - sie landet im Pfad der Abfrage."""
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return value >= 0 and len(str(value)) <= MAX_REF_LENGTH
    return isinstance(value, str) and 0 < len(value) <= MAX_REF_LENGTH and value.isascii() and value.isdigit()


def _clean(value, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _number(value, limit: float):
    """Eine Zahl der Antwort innerhalb von ±``limit`` - sonst ``None``. Nie eine Ausnahme: riesige Ganzzahlen
    (``OverflowError`` bei ``float``) und Text sind einfach unbrauchbar."""
    if value is None or isinstance(value, bool) or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(number) or abs(number) > limit:
        return None
    return int(number) if number.is_integer() else number


def _int(value, limit: int = MAX_NUMBER) -> int | None:
    number = _number(value, limit)
    return number if isinstance(number, int) else None


def _given(value, parsed):
    """Steht ein Wert in der Antwort, muss er brauchbar sein - sonst ist die Antwort in unerwarteter Form (nie still
    ein anderer Wert)."""
    if parsed is None and value is not None and value != "":
        raise SourceFormatError()
    return parsed


def _points(value):
    return _given(value, _number(value, MAX_POINTS))


def club_day(value) -> str | None:
    """Wiener Tag eines Zeitpunkts des Partners („2026-09-24T22:00:00.000Z“ → „2026-09-25“). Ein Zeitpunkt am Rand des
    Kalenders (Jahr 1 bzw. 9999 mit Zeitzone) hat keinen Tag."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        moment = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=VIENNA)
        return moment.astimezone(VIENNA).date().isoformat()
    except (ValueError, OverflowError):
        return None


def _is_guest(player: dict) -> bool:
    puuid = player.get("puuid")
    return (isinstance(puuid, str) and puuid.startswith(GUEST_PREFIX)) or \
        _clean(player.get("tag_line"), 20).upper() == GUEST_TAG


def riot_name(player: dict) -> str:
    """„Name#TAG“ wie die Riot-ID; Gäste und Spieler ohne brauchbaren Tag nur mit dem Namen."""
    name = _clean(player.get("game_name"), MAX_NAME)
    tag = _clean(player.get("tag_line"), 20)
    if not name or _is_guest(player) or not tag or not (tag.isascii() and tag.isalnum()) or len(tag) > 10:
        return name
    return f"{name}#{tag}"


def _person_key(player: dict) -> str:
    """Schlüssel nur im Speicher: die Kennung des Partners, sonst der Name."""
    puuid = player.get("puuid")
    if isinstance(puuid, str) and puuid.strip():
        return "k:" + puuid.strip()
    return "n:" + _clean(player.get("game_name"), MAX_NAME).casefold() + "#" + _clean(player.get("tag_line"), 20)


def _list(value) -> list:
    if value is None:
        return []
    if not isinstance(value, list):
        raise SourceFormatError()
    return value


def _dict(value) -> dict:
    if not isinstance(value, dict):
        raise SourceFormatError()
    return value


# ---------------------------------------------------------------- Serien und Turniere
def series_list(data) -> list[dict]:
    """``/api/series``: je Serie Kennung, Name, Saison und Zahl der Turniere."""
    out = []
    for item in _list(data):
        item = _dict(item)
        if not valid_ref(item.get("id")):
            continue
        out.append({"ref": str(item["id"]), "name": _clean(item.get("name"), MAX_TITLE),
                    "season": _clean(item.get("season"), 40) or None,
                    "tournaments": _int(item.get("tournament_count")) or 0})
    return out


def series_tournaments(data) -> list[dict]:
    """``/api/series/{id}``: die Turniere der Serie nach Tag - Wiener Tag, Double Up, fertig, Rundenzahl."""
    out = []
    for item in _list(_dict(data).get("tournaments")):
        item = _dict(item)
        if not valid_ref(item.get("id")):
            continue
        out.append({"ref": str(item["id"]), "name": _clean(item.get("name"), MAX_TITLE),
                    "club_day": club_day(item.get("date")), "double_up": item.get("type") == "double_up",
                    "finished": item.get("status") == "completed", "rounds": _int(item.get("rounds")) or 0})
    out.sort(key=lambda entry: (entry["club_day"] or "9999", int(entry["ref"])))
    return out


def _total(value):
    return _given(value, _number(value, MAX_TOTAL))


def _entry(player: dict, lobby: str) -> dict | None:
    item = {}
    place = _given(player.get("placement"), _int(player.get("placement"), MAX_PLACE))
    if place is not None and place < 0:
        raise SourceFormatError()
    if place:  # 0 heißt: kein Platz
        item["place"] = place
    points = _points(player.get("points"))
    if points is not None:
        item["points"] = points
    if not item:
        return None
    if lobby:
        item["lobby"] = lobby
    return item


def tournament(data) -> dict:
    """``/api/tournaments/{id}``: der Turniertag als Zeilen für das Ergebnisblatt (siehe Modul-Text)."""
    data = _dict(data)
    if not valid_ref(data.get("id")):
        raise SourceFormatError()
    double_up = data.get("type") == "double_up"
    rounds = _list(data.get("rounds"))
    participants = [_dict(item) for item in _list(data.get("participants"))]
    teams = [_dict(item) for item in _list(data.get("teams"))]

    by_person: dict[str, dict[int, dict]] = {}
    by_team: dict[str, dict[int, dict]] = {}
    count = lobbies = bots = 0
    for rnd in rounds:
        rnd = _dict(rnd)
        number = _int(rnd.get("round_number"))
        if number is None or not 1 <= number <= MAX_ROUNDS:
            raise SourceFormatError()
        count = max(count, number)
        for lobby in _list(rnd.get("lobbies")):
            lobby = _dict(lobby)
            lobbies += 1
            label = str(_int(lobby.get("lobby_number")) or "")
            for player in _list(lobby.get("players")):
                player = _dict(player)
                if player.get("is_filler"):
                    bots += 1
                    continue
                entry = _entry(player, label)
                if entry is None:
                    continue
                team = player.get("team_id")
                if double_up and team is not None:
                    by_team.setdefault(str(team), {})[number - 1] = entry
                else:
                    by_person.setdefault(_person_key(player), {})[number - 1] = entry

    def day_rounds(entries: dict[int, dict]) -> list[dict | None]:
        return [entries.get(index) for index in range(count)]

    people = {_person_key(person): person for person in participants}
    rows: list[dict] = []
    placed: set[str] = set()
    if double_up:
        for place, team in enumerate(teams, start=1):
            members = [people.get("k:" + str(team.get(key) or "").strip()) or {"game_name": team.get(name)}
                       for key, name in (("player1_puuid", "p1_name"), ("player2_puuid", "p2_name"))]
            names = [riot_name(member) for member in members]
            entries = day_rounds(by_team.get(str(team.get("id")), {}))
            total = _total(team.get("total_points"))
            for index, member in enumerate(members):
                if not names[index]:
                    continue
                placed.add(_person_key(member))
                row = {"name": names[index], "place": place, "day_rounds": list(entries),
                       "day_points": total if total is not None else _total(member.get("total_points")),
                       "marks": ["left"] if member.get("dropped_out") else []}
                if names[1 - index]:
                    row["partner"] = {"name": names[1 - index]}
                rows.append(row)
    place = len(teams)
    for person in participants:
        key = _person_key(person)
        name = riot_name(person)
        if key in placed or not name:
            continue
        place += 1
        rows.append({"name": name, "place": place, "day_rounds": day_rounds(by_person.get(key, {})),
                     "day_points": _total(person.get("total_points")),
                     "marks": ["left"] if person.get("dropped_out") else []})
    return {
        "ref": str(data["id"]), "name": _clean(data.get("name"), MAX_TITLE), "club_day": club_day(data.get("date")),
        "double_up": double_up, "finished": data.get("status") == "completed", "rounds": count,
        "lobbies": lobbies, "bots": bots, "guests": sum(1 for person in participants if _is_guest(person)),
        "rows": rows,
    }
