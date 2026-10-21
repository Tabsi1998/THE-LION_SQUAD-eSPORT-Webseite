"""Eigene Teams einer Saison (#1926): ein Verein fährt in einer Rennliga oft mit mehreren Teams.

- **Liste** (``own_teams``): je Team der Name wie beim Veranstalter und weitere Schreibweisen (``aliases``). Eine Saison
  von früher hat nur das Feld ``team_name`` - es gilt dann als einziges eigenes Team (die Migration schreibt es in die
  Liste). ``team_name`` bleibt beim Speichern das erste Team, damit ältere Leser weiter funktionieren.
- **Zuordnung** (``Matcher``): ein Team aus einem Ergebnis gehört zu einem eigenen Team, wenn sein Schlüssel
  (``series_identity.normalize_name``: ohne Akzente, Groß/klein, Leer- und Satzzeichen) zum Namen oder zu einem Alias
  passt - „TLS-DarkFriday“, „TLS DarkFriday“ und „tls_darkfriday“ sind dasselbe Team. Fremde Teams bleiben wie
  geschrieben.
"""
from __future__ import annotations

from services.series_identity import normalize_name

MAX_TEAMS = 20
MAX_ALIASES = 10


def _clean(value) -> str:
    return " ".join(str(value or "").split())[:120]


def clean_teams(raw) -> list[dict]:
    """Liste aufräumen: leere und doppelte Namen (nach Schlüssel) fallen weg, Aliase ohne Doppel und ohne den Namen."""
    out: list[dict] = []
    seen: set[str] = set()
    for item in raw or []:
        entry = item if isinstance(item, dict) else {"name": item}
        name = _clean(entry.get("name"))
        key = normalize_name(name)
        if not key or key in seen:
            continue
        seen.add(key)
        aliases, keys = [], {key}
        for alias in entry.get("aliases") or []:
            text = _clean(alias)
            alias_key = normalize_name(text)
            if alias_key and alias_key not in keys:
                keys.add(alias_key)
                aliases.append(text)
        out.append({"name": name, "aliases": aliases[:MAX_ALIASES]})
    return out[:MAX_TEAMS]


def own_teams(series: dict | None) -> list[dict]:
    """Die eigenen Teams der Saison: die Liste, sonst das alte Feld ``team_name`` als einziges Team."""
    series = series or {}
    if series.get("own_teams"):
        return clean_teams(series["own_teams"])
    return clean_teams([series.get("team_name")])


def own_team_names(series: dict | None) -> list[str]:
    return [team["name"] for team in own_teams(series)]


class Matcher:
    """Ordnet Teamnamen den eigenen Teams zu (Name oder Alias, nach Schlüssel)."""

    def __init__(self, teams):
        self.names: list[str] = []
        self._by_key: dict[str, str] = {}
        for team in clean_teams(teams):
            self.names.append(team["name"])
            for text in (team["name"], *team["aliases"]):
                self._by_key.setdefault(normalize_name(text), team["name"])

    def canonical(self, name):
        """Der Name des eigenen Teams, zu dem ``name`` gehört - sonst ``name`` unverändert."""
        if not name:
            return name
        return self._by_key.get(normalize_name(name), name)

    def is_own(self, name) -> bool:
        return bool(name) and normalize_name(name) in self._by_key

    def __bool__(self) -> bool:
        return bool(self.names)
