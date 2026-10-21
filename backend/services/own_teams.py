"""Eigene Teams einer Saison (#1926): ein Verein fährt in einer Rennliga oft mit mehreren Teams.

- **Liste** (``own_teams``): je Team der Name wie beim Veranstalter und weitere Schreibweisen (``aliases``). Eine Saison
  von früher hat nur das Feld ``team_name`` - es gilt dann als einziges eigenes Team (die Migration schreibt es in die
  Liste). ``team_name`` bleibt beim Speichern das erste Team, damit ältere Leser weiter funktionieren. Doppelt ist nur
  ein wörtlich gleicher Name (ohne Groß/klein und doppelte Leerzeichen): „A-B“ und „AB“ bleiben zwei Teams.
- **Zuordnung** (``Matcher``): Name oder ausdrücklicher Alias eines eigenen Teams gelten immer. Eine andere Schreibweise
  mit demselben Schlüssel (``series_identity.normalize_name``: ohne Akzente, Groß/klein, Leer- und Satzzeichen - etwa
  „TLS DarkFriday“ für „TLS-DarkFriday“) zählt nur, wenn sie zu genau einem eigenen Team passt und im selben Blatt
  (``others``) kein zweites, wörtlich anderes Team mit diesem Schlüssel steht. Sonst bleibt sie ein eigenes, fremdes
  Team - nie still zusammengelegt; die Prüfung des Ergebnisblatts nennt den Fall (``spelling_conflicts``).
"""
from __future__ import annotations

from services.series_identity import normalize_name

MAX_TEAMS = 20
MAX_ALIASES = 10


def _clean(value) -> str:
    return " ".join(str(value or "").split())[:120]


def _literal(value) -> str:
    """Ein Name wörtlich, nur ohne Groß/klein und doppelte Leerzeichen."""
    return _clean(value).casefold()


def clean_teams(raw) -> list[dict]:
    """Liste aufräumen: leere und wörtlich doppelte Namen fallen weg, Aliase ohne Doppel und ohne den Namen."""
    out: list[dict] = []
    seen: set[str] = set()
    for item in raw or []:
        entry = item if isinstance(item, dict) else {"name": item}
        name = _clean(entry.get("name"))
        literal = _literal(name)
        if not normalize_name(name) or literal in seen:
            continue
        seen.add(literal)
        aliases, known = [], {literal}
        for alias in entry.get("aliases") or []:
            text = _clean(alias)
            if normalize_name(text) and _literal(text) not in known:
                known.add(_literal(text))
                aliases.append(text)
        out.append({"name": name, "aliases": aliases[:MAX_ALIASES]})
    return out[:MAX_TEAMS]


def team_conflicts(raw) -> list[str]:
    """Widersprüche in der Liste, die beim Speichern abgelehnt werden (422): eine Schreibweise, die der Name eines
    anderen eigenen Teams ist, oder dieselbe Schreibweise bei zwei Teams - sonst wäre still unklar, wohin ein Ergebnis
    gehört."""
    teams = clean_teams(raw)
    names = {_literal(team["name"]): team["name"] for team in teams}
    owner: dict[str, str] = {}
    out = []
    for team in teams:
        for alias in team["aliases"]:
            literal = _literal(alias)
            other = names.get(literal)
            if other and other != team["name"]:
                out.append(f"Die Schreibweise „{alias}“ von „{team['name']}“ ist der Name des eigenen Teams „{other}“.")
            elif literal in owner and owner[literal] != team["name"]:
                out.append(f"Die Schreibweise „{alias}“ steht bei „{owner[literal]}“ und „{team['name']}“.")
            else:
                owner.setdefault(literal, team["name"])
    return out


def own_teams(series: dict | None) -> list[dict]:
    """Die eigenen Teams der Saison: die Liste, sonst das alte Feld ``team_name`` als einziges Team."""
    series = series or {}
    if series.get("own_teams"):
        return clean_teams(series["own_teams"])
    return clean_teams([series.get("team_name")])


def own_team_names(series: dict | None) -> list[str]:
    return [team["name"] for team in own_teams(series)]


class Matcher:
    """Ordnet Teamnamen den eigenen Teams zu: wörtlich über Name und Alias, über den Schlüssel nur eindeutig."""

    def __init__(self, teams):
        self.names: list[str] = []
        self._exact: dict[str, str] = {}
        self._by_key: dict[str, list[str]] = {}
        cleaned = clean_teams(teams)
        # Erst alle Namen, dann die Schreibweisen: der genaue Name eines eigenen Teams geht immer vor dem Alias eines
        # anderen (beim Speichern lehnt ``team_conflicts`` so eine Liste ohnehin ab).
        for team in cleaned:
            self.names.append(team["name"])
            self._exact.setdefault(_literal(team["name"]), team["name"])
        for team in cleaned:
            for text in (team["name"], *team["aliases"]):
                self._exact.setdefault(_literal(text), team["name"])
                owners = self._by_key.setdefault(normalize_name(text), [])
                if team["name"] not in owners:
                    owners.append(team["name"])

    def resolve(self, name, others=()) -> str | None:
        """Das eigene Team zu ``name`` - oder ``None``. ``others``: die übrigen Teamnamen desselben Blatts."""
        if not name:
            return None
        literal = _literal(name)
        if literal in self._exact:
            return self._exact[literal]
        key = normalize_name(name)
        owners = self._by_key.get(key) or []
        if len(owners) != 1:
            return None
        if any(_literal(other) != literal and normalize_name(other) == key for other in others or () if other):
            return None
        return owners[0]

    def canonical(self, name, others=()):
        """Der Name des eigenen Teams, zu dem ``name`` gehört - sonst ``name`` unverändert."""
        return self.resolve(name, others) or name

    def is_own(self, name, others=()) -> bool:
        return self.resolve(name, others) is not None

    def spelling_conflicts(self, names) -> list[dict]:
        """Schreibweisen im Blatt, die wie ein eigenes Team aussehen, aber nicht zugeordnet werden: ``{name, teams}`` -
        ``teams`` sind die eigenen Teams bzw. die wörtlich anderen Namen mit demselben Schlüssel."""
        listed = list(dict.fromkeys(_clean(name) for name in names if _clean(name)))
        out = []
        for name in listed:
            literal = _literal(name)
            if literal in self._exact:
                continue
            key = normalize_name(name)
            owners = self._by_key.get(key) or []
            if not owners or self.resolve(name, listed) is not None:
                continue
            rivals = [other for other in listed if _literal(other) != literal and normalize_name(other) == key]
            out.append({"name": name, "teams": list(dict.fromkeys([*rivals, *owners]))})
        return out

    def __bool__(self) -> bool:
        return bool(self.names)
