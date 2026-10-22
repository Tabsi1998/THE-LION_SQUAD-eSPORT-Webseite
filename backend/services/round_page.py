"""Ergebnistabelle je Runde und Lauf (#1950): eine Runde der Rennliga als eigene Seite mit einem Reiter je Lauf.

Gerechnet wird hier nichts Neues - alles kommt aus dem Gespeicherten: Kalender (Runde, Lauf, Status), die
veröffentlichten Ergebnisblätter der Läufe (Platz, Startnummer, Startplatz, Zeit, Abstand, Strafsekunden, Marken,
schnellste Runde, Fahrer des Tages) und die Punkte je Lauf aus dem letzten Fahrerstand (``reference_standings``).

- **Runde** (``number``): die Nummer aus ``race_weekend.annotate`` - Termine mit gleichem Kürzel bilden mit Läufen eine
  Runde, sonst ist jeder Termin seine eigene. Dazu die vorige und nächste Runde für die Pfeile im Kopf.
- **Läufe** (``sessions``): je Lauf ein Schlüssel für die Adresse (``key``, etwa ``qualifying``, ``sprint``,
  ``rennen``), welche Spalten etwas zeigen (``columns`` - leere Spalten fallen weg) und die Zeilen in der Reihenfolge
  des Veranstalters. Das **Hauptrennen** (``main``) ist der Reiter, den die Seite ohne Angabe zeigt: das letzte Rennen
  der Runde, sonst der letzte Lauf, der kein Qualifying ist.
- **Namen** nach den Regeln der Serienseite (``people``): ein ausgeblendeter Name kommt nicht mit, dann auch keine
  Startnummer. Wer außerhalb der Tabelle mit Namen stehen darf (Zusammenfassung), sagt ``club_drivers`` - wie bei der
  Rennliga nur öffentlich sichtbare Vereinsmitglieder.
- **Teamfarbe** je Team aus der Saison (``team_colors``, einstellbar in der Verwaltung); ohne Farbe bleibt es neutral.
- **Hervorgehoben** (``own``): Vereinsmitglieder und Fahrer eigener Teams (#1926, auch in anderer Schreibweise).
- **Zusammenfassung** (``summary``): Sieger und schnellste Runde des Hauptrennens, Pole aus dem Haupt-Qualifying (mit
  Zeit; nur ohne Quali-Ergebnis die Pole-Marke im Rennen, nie aus einem Lauf mit umgekehrter Aufstellung,
  #1960) und Fahrer des Tages - je als Kennung der Zeile. Je Lauf der beste öffentliche Vereinsfahrer (``best_club``).
- **Sonderregeln** (#1960): je Lauf ``grid_source`` und ``reverse_top`` (umgekehrte Aufstellung: keine Pole-Marke,
  vorn steht Startplatz 1) sowie ``no_score_reason`` und ``no_score_note`` (Termin ohne Wertung - keine Punkte).
- **Original** (``original``): Platz für das Original-Bild des Veranstalters (#1933) - bis dahin immer ``None``.
"""
from __future__ import annotations

from services.own_teams import Matcher, own_teams
from services.race_weekend import SESSION_REVERSES, is_main_qualifying, pole_holder, round_plan, session_kind

OUT_MARKS = ("dns", "dsq", "dnf")
STATUS_ORDER = {"finished": 0, "dnf": 1, "dsq": 2, "dns": 3}
UMLAUTS = {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"}
HEAD_FIELDS = ("code", "title", "venue", "country_code")
COLUMN_FIELDS = ("start_number", "grid", "time", "gap", "penalty_seconds", "points")


def clean(value) -> str:
    return " ".join(str(value or "").split())


def _number(value):
    return int(value) if isinstance(value, float) and value.is_integer() else value


def session_key(label) -> str:
    """Schlüssel eines Laufs für die Adresse: „Qualifying“ → ``qualifying``, „Lauf 1“ → ``lauf-1``, ohne Lauf
    ``rennen``. Nur Buchstaben und Ziffern, ohne regulären Ausdruck."""
    text = clean(label).casefold() or "rennen"
    out, dash = [], False
    for char in text:
        char = UMLAUTS.get(char, char)
        if char.isascii() and char.isalnum():
            out.append(char)
            dash = False
        elif out and not dash:
            out.append("-")
            dash = True
    return "".join(out).strip("-") or "rennen"


def color_key(team) -> str:
    return clean(team).casefold()


def clean_hex(value) -> str | None:
    """Eine Farbe als ``#rrggbb`` (klein geschrieben) - sonst ``None``."""
    text = clean(value).lower()
    if len(text) == 7 and text[0] == "#" and all(char in "0123456789abcdef" for char in text[1:]):
        return text
    return None


def team_color_map(series: dict) -> dict[str, str]:
    """Teamfarben der Saison nach Schlüssel (ohne Groß/klein und doppelte Leerzeichen)."""
    out = {}
    for team, color in (series.get("team_colors") or {}).items():
        hexed = clean_hex(color)
        if color_key(team) and hexed:
            out[color_key(team)] = hexed
    return out


def status_of(marks: set) -> str:
    return next((mark for mark in OUT_MARKS if mark in marks), "finished")


def place_of(row: dict) -> int | None:
    try:
        place = int(row.get("place"))
    except (TypeError, ValueError):
        return None
    return place if place >= 1 else None


def main_session(sessions: list[dict]) -> dict | None:
    """Das Hauptrennen einer Runde: das letzte Rennen, sonst der letzte Lauf, der kein Qualifying ist, sonst der letzte
    Lauf - ein abgesagter nur, wenn alle abgesagt sind."""
    for kinds in (("race",), ("race", "sprint"), ("race", "sprint", "qualifying")):
        found = [item for item in sessions if item["kind"] in kinds and item["state"] != "cancelled"]
        if found:
            return found[-1]
    return sessions[-1] if sessions else None


def public_club_keys(people: dict) -> list[str]:
    """Wer außerhalb der Tabelle mit Namen stehen darf: Vereinsmitglied, Profil aktiv, Name nicht ausgeblendet."""
    return [key for key, person in people.items()
            if person.get("club_member") and person.get("profile_slug") and not person.get("name_hidden")]


class _Context:
    """Was jede Zeile braucht: Personen, Standard-Teams, Teamfarben, eigene Teams und je Fahrer und Lauf das Ergebnis
    aus dem gespeicherten Stand (``results``: Punkte, dazu Startplatz und Pole, wie sie aus dem Qualifying bzw. der
    umgekehrten Wertung kommen, wo das Blatt sie leer lässt)."""

    def __init__(self, series: dict, people: dict, participants: dict, results: dict):
        self.people = people
        self.participants = participants
        self.results = results
        self.weekend = series.get("weekend")  # #1960: Startplatz-Quelle je Lauf (umgekehrte Aufstellung)
        self.colors = team_color_map(series)
        self.matcher = Matcher(own_teams(series))

    def team(self, row: dict, others: list[str]) -> str | None:
        # Was im Feld steht (#1960): ein leeres Team heißt kein Team - kein Rückfall aufs Standard-Team.
        team = clean(row.get("team"))
        if not team:
            return None
        return self.matcher.canonical(team, others) if self.matcher else team

    def row(self, row: dict, round_id: str, sheet: dict, others: list[str], counts: bool) -> dict:
        pid = row.get("participant_id")
        person = self.people.get(pid) or {"name": None, "name_hidden": True, "club_member": False,
                                          "profile_slug": None}
        stored = self.results.get((pid, round_id)) or {}
        marks = {str(mark) for mark in (stored["marks"] if "marks" in stored else row.get("marks")) or []}
        status = status_of(marks)
        place = place_of(row)
        team = self.team(row, others)
        grid = next((value for value in (row.get("grid"), stored.get("grid")) if isinstance(value, int)), None)
        fastest = sheet.get("fastest_lap") or {}
        own = bool(person.get("club_member")) or bool(team and self.matcher and self.matcher.is_own(team, others))
        penalty = row.get("penalty_seconds")
        return {
            "key": pid, "place": place, "status": status,
            "name": None if person.get("name_hidden") else person.get("name"),
            "name_hidden": bool(person.get("name_hidden")), "club_member": bool(person.get("club_member")),
            "profile_slug": person.get("profile_slug"), "own": own,
            # Wie in der Tabelle der Serienseite: ein ausgeblendeter Name kommt ohne Startnummer.
            "start_number": None if person.get("name_hidden") else (clean(row.get("start_number")) or None),
            "team": team, "team_color": self.colors.get(color_key(team)) if team else None,
            "grid": grid,
            "gained": grid - place if grid and place and status == "finished" else None,
            "time": clean(row.get("time")) or None, "gap": clean(row.get("gap")) or None,
            "penalty_seconds": _number(penalty) if isinstance(penalty, (int, float)) and penalty > 0 else None,
            "points": _number(stored["points"]) if counts and stored.get("points") is not None else None,
            "marks": sorted(marks),
            "fastest_lap": fastest.get("participant_id") == pid or "fastest_lap" in marks,
            "fastest_lap_time": (clean(fastest.get("time")) or None) if fastest.get("participant_id") == pid else None,
            "driver_of_the_day": bool(pid) and sheet.get("driver_of_the_day") == pid,
        }


def _sorted_rows(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda row: (row["place"] is None, row["place"] or 0, STATUS_ORDER[row["status"]]))


def best_club(rows: list[dict], public: set) -> str | None:
    """Der beste öffentliche Vereinsfahrer eines Laufs: im Ziel vor Ausfall, nie ein Nichtstart."""
    entries = [row for row in rows if row["key"] in public and row["status"] != "dns"]
    entries.sort(key=lambda row: (row["status"] != "finished", row["place"] is None, row["place"] or 0))
    return entries[0]["key"] if entries else None


def session_view(item: dict, sheet: dict | None, ctx: _Context, public: set, key: str,
                 config: dict | None = None) -> dict:
    """Ein Lauf mit seinen Zeilen und den Spalten, die etwas zeigen. ``config``: die Vorgabe des Laufs (#1930) - mit
    umgekehrter Aufstellung aus einem Lauf (#1960) hat er keine Pole: wer vorn steht, hat Startplatz 1."""
    counts = item.get("counts", True) is not False
    grid_source = (config or {}).get("grid")
    reversed_grid = grid_source in SESSION_REVERSES
    raw = [row for row in (sheet or {}).get("rows") or [] if row.get("participant_id")]
    others = [clean(row.get("team")) for row in raw if clean(row.get("team"))]
    rows = _sorted_rows([ctx.row(row, item["id"], sheet or {}, others, counts) for row in raw])
    if reversed_grid:
        rows = [{**row, "marks": [mark for mark in row["marks"] if mark != "pole"]} for row in rows]
    columns = [field for field in COLUMN_FIELDS if any(row.get(field) not in (None, "") for row in rows)]
    kind = item.get("session_kind") or session_kind(item.get("session"))
    pole = None
    if rows and kind == "qualifying" and is_main_qualifying(item.get("session")):
        holder = pole_holder(raw)
        found = next((row for row in rows if row["key"] == holder), None)
        if found:
            pole = {"key": holder, "time": found["time"]}
    return {
        "id": item["id"], "key": key, "session": item.get("session"), "label": clean(item.get("session")) or "Rennen",
        "kind": kind, "state": item.get("state"), "club_day": item.get("club_day"), "time": item.get("time"),
        "counts": counts, "has_result": bool(rows), "columns": columns, "rows": rows,
        "pole": pole, "best_club": best_club(rows, public),
        # #1960: Termin ohne Wertung mit Grund und die Quelle des Startplatzes (umgekehrt: nur die ersten N).
        "no_score_reason": item.get("no_score_reason"), "no_score_note": item.get("no_score_note"),
        "grid_source": grid_source, "reverse_top": (config or {}).get("reverse_top") if reversed_grid else None,
        "originals": [],  # #1933: Original-Bilder des Veranstalters - setzt die Route (``reference_originals``)
    }


def _head(rounds: list[dict], number: int, total: int) -> dict:
    place = next((item for item in rounds if any(item.get(field) for field in ("venue", "title", "country_code"))),
                 rounds[0])
    states = [item.get("state") for item in rounds if item.get("state") != "cancelled"]
    return {"number": number, "total": total, "code": rounds[0].get("code"), "title": place.get("title"),
            "venue": place.get("venue"), "country_code": place.get("country_code"),
            "club_day": rounds[0].get("club_day"), "kind": rounds[0].get("kind"),
            "cancelled": not states, "scored": bool(states) and all(state == "scored" for state in states)}


def _neighbour(groups: dict, number: int | None) -> dict | None:
    if number is None or number not in groups:
        return None
    rounds = groups[number]
    place = next((item for item in rounds if any(item.get(field) for field in ("venue", "title", "country_code"))),
                 rounds[0])
    return {"number": number, "code": rounds[0].get("code"), **{field: place.get(field) for field in HEAD_FIELDS[1:]}}


def group_rounds(rounds: list[dict]) -> dict[int, list[dict]]:
    """Die Termine des Kalenders (ohne archivierte, in Kalender-Reihenfolge) je Runde."""
    groups: dict[int, list[dict]] = {}
    for item in rounds:
        if item.get("weekend"):
            groups.setdefault(int(item["weekend"]), []).append(item)
    return groups


def summary(sessions: list[dict], main: dict | None) -> dict:
    """Sieger, Pole (mit Zeit), schnellste Runde (mit Zeit) und Fahrer des Tages - je Kennung und Lauf."""
    out = {"winner": None, "pole": None, "fastest_lap": None, "driver_of_the_day": None}
    if main:
        winner = next((row for row in main["rows"] if row["place"] == 1 and row["status"] == "finished"), None)
        if winner:
            out["winner"] = {"key": winner["key"], "session": main["key"], "grid": winner["grid"]}
        fastest = next((row for row in main["rows"] if row["fastest_lap"]), None)
        if fastest:
            out["fastest_lap"] = {"key": fastest["key"], "session": main["key"], "time": fastest["fastest_lap_time"]}
    quali = next((item for item in sessions if item["pole"]), None)
    if quali:
        out["pole"] = {**quali["pole"], "session": quali["key"]}
    elif main and not any(item["kind"] == "qualifying" and item["has_result"] for item in sessions) \
            and main.get("grid_source") not in SESSION_REVERSES:
        # Nur eine Runde ohne Ergebnis eines Qualifyings nimmt die Pole-Marke des Rennens (Bestand #1927) - nie ein
        # Lauf mit umgekehrter Aufstellung (#1960).
        marked = next((row for row in main["rows"] if "pole" in row["marks"]), None)
        if marked:
            out["pole"] = {"key": marked["key"], "session": main["key"], "time": None}
    ordered = [main, *[item for item in sessions if item is not main]] if main else sessions
    for item in ordered:
        day = next((row for row in item["rows"] if row["driver_of_the_day"]), None)
        if day:
            out["driver_of_the_day"] = {"key": day["key"], "session": item["key"]}
            break
    return out


def round_view(rounds: list[dict], number: int, sheets: dict, ctx: _Context, people: dict) -> dict | None:
    """Die Runde ``number`` aus dem annotierten Kalender - ``None``, wenn es sie nicht gibt."""
    groups = group_rounds(rounds)
    if number not in groups:
        return None
    numbers = sorted(groups)
    index = numbers.index(number)
    public = set(public_club_keys(people))
    plan = round_plan(rounds, ctx.weekend)
    used: dict[str, int] = {}
    sessions = []
    for item in groups[number]:
        key = session_key(item.get("session"))
        used[key] = used.get(key, 0) + 1
        sessions.append(session_view(item, sheets.get(item["id"]), ctx, public,
                                     key if used[key] == 1 else f"{key}-{used[key]}",
                                     (plan.get(item["id"]) or {}).get("config")))
    main = main_session(sessions)
    return {
        "round": _head(groups[number], number, len(numbers)),
        "previous": _neighbour(groups, numbers[index - 1] if index > 0 else None),
        "next": _neighbour(groups, numbers[index + 1] if index + 1 < len(numbers) else None),
        "sessions": sessions,
        "main": main["key"] if main else None,
        "summary": summary(sessions, main),
        "club_drivers": sorted(public),
    }


async def load_round(db, series: dict, rounds: list[dict], number: int, people: dict) -> dict | None:
    """Liest Blätter, Standard-Teams und die Punkte je Lauf für eine Runde und baut ``round_view``."""
    sid = series["id"]
    ids = [item["id"] for item in group_rounds(rounds).get(number, [])]
    if not ids:
        return None
    sheets = {item["round_id"]: item async for item in db.reference_round_results.find(
        {"series_id": sid, "round_id": {"$in": ids}, "status": "published"},
        {"_id": 0, "round_id": 1, "rows": 1, "fastest_lap": 1, "driver_of_the_day": 1})}
    participants = {item["id"]: item async for item in db.reference_participants.find(
        {"series_id": sid}, {"_id": 0, "id": 1, "default_team": 1})}
    latest = await db.reference_standings.find_one(
        {"series_id": sid, "scope": "drivers"}, {"_id": 0, "rows.participant_id": 1, "rows.results": 1},
        sort=[("round_seq", -1)]) or {}
    results = {(row.get("participant_id"), result["round_id"]): result
               for row in latest.get("rows") or [] for result in row.get("results") or []
               if result.get("round_id") in ids}
    ctx = _Context(series, people, participants, results)
    return round_view(rounds, number, sheets, ctx, people)
