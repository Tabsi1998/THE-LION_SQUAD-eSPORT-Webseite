"""Externe Namen den Mitgliedern zuordnen (#1743).

In fremden Ergebnislisten stehen Namen, wie der Veranstalter sie führt. Der Vorstand (Bereich Redaktion) ordnet einen
neuen Namen **einmal** zu - einem Vereinsprofil, einem Gast oder „extern“ -, danach erkennt die Website ihn über den
gespeicherten **Alias** (``reference_aliases``, mit Quelle und wer wann bestätigt hat) in jeder weiteren Serie selbst.

- **Vergleichbar** macht ``normalize_name``: Groß/Klein, Leerzeichen, Satz- und Sonderzeichen, Akzente und Breiten
  zählen nicht. Clan-Tags in Klammern („[TLS] Name“, „Name (TLS)“) sind optional - ein Treffer ohne Tag sagt es dazu.
- **Vorschläge** kommen nur bei *gleichem* Schlüssel, nie bei bloß ähnlichen Namen. Reihenfolge der Gründe: bestätigter
  Alias, Spiel-ID im Konto (Reiter „Gaming“ - je Spiel und die Plattform-Kennungen), Name im Profil; die Startnummer
  aus einer früheren Saison derselben Spur ist nur ein Hinweis und wird nie von selbst übernommen.
- **Gast** zählt fürs Team (die Teamwertung entscheidet über ``guests_count``), aber nie in Vereinsstatistik, „Unsere
  Leute“ oder Profilen: dafür zählt nur ``counts_for_club``.
- **Datenschutz:** Aliase und Verknüpfungen liest nur die Verwaltung. Vorschläge zeigen nie die Spiel-ID selbst, nur
  welche Art von Kennung gepasst hat. Kontolöschung und Auskunft regeln ``account_erasure`` und ``dsgvo_routes``.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

VIENNA = ZoneInfo("Europe/Vienna")
# Clan-Tags am Anfang oder Ende eines Namens: [TLS], (TLS), {TLS}, <TLS> - auch mehrere hintereinander.
_LEADING_TAGS = re.compile(r"^\s*(?:[\[({<][^\])}>]{1,12}[\])}>]\s*)+")
_TRAILING_TAGS = re.compile(r"(?:\s*[\[({<][^\])}>]{1,12}[\])}>])+\s*$")
# Plattform-Kennungen im Konto (Reiter „Gaming“), die für jedes Spiel gelten.
PLATFORM_IDS = (
    ("ea_id", "EA-ID"), ("psn_id", "PSN"), ("xbox_id", "Xbox"), ("steam_id", "Steam"), ("epic_id", "Epic"),
    ("riot_id", "Riot-ID"), ("battlenet_id", "Battle.net"),
)
BASIS_ORDER = ("alias", "game_id", "profile_name", "start_number")
STRONG = {"alias", "game_id"}


def normalize_name(value) -> str:
    """Schlüssel eines Namens: Unicode vereinheitlicht, ohne Akzente, klein, nur Buchstaben und Ziffern."""
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char)).casefold()
    return "".join(char for char in text if char.isalnum())


def strip_clan_tags(value) -> str:
    """Der Name ohne Clan-Tags am Anfang und Ende. Bliebe nichts übrig, kommt der Name unverändert zurück."""
    text = str(value or "")
    stripped = _TRAILING_TAGS.sub("", _LEADING_TAGS.sub("", text)).strip()
    return stripped if normalize_name(stripped) else text


def name_keys(value) -> tuple[str, ...]:
    """Voller Schlüssel und - wenn anders - der ohne Clan-Tag."""
    keys = [normalize_name(value), normalize_name(strip_clan_tags(value))]
    return tuple(key for key in dict.fromkeys(keys) if key)


def vienna_date(value) -> str:
    """Wiener Tag eines gespeicherten Zeitpunkts als TT.MM.JJJJ (leer, wenn er fehlt)."""
    try:
        moment = datetime.fromisoformat(str(value))
    except ValueError:
        return ""
    return moment.astimezone(VIENNA).strftime("%d.%m.%Y")


def counts_for_club(participant: dict) -> bool:
    """Zählt der Teilnehmer in Vereinsstatistik, „Unsere Leute“ und Profil? Nur ein verknüpftes Mitglied - ein Gast
    zählt fürs Team, nie für den Verein."""
    return participant.get("link") == "member" and bool(participant.get("profile_id"))


def club_participants(participants: list[dict]) -> list[dict]:
    return [person for person in participants if counts_for_club(person)]


@dataclass
class IdentityIndex:
    """Alles, was ein Vorschlag braucht - einmal je Anfrage geladen, damit viele Namen keine Abfrage je Name kosten.

    - ``profiles``: Vereinsprofil-Kennung → Anzeigename (nur diese Profile werden vorgeschlagen)
    - ``aliases``: gespeicherte Aliase (``name_normalized``, ``target``, ``profile_id``, ``guest_name``, ``game_id``,
      ``confirmed_at``)
    - ``game_ids``: Kennungen aus Konten mit Profil (``profile_id``, ``value``, ``label``)
    - ``start_numbers``: frühere Startnummern der Spur (``profile_id``, ``start_number``, ``season``)
    - ``game_id``: Spiel der Spur; ein Alias eines anderen Spiels wird nur vorgeschlagen, nie selbst übernommen
    """
    profiles: dict[str, str]
    aliases: list[dict] = field(default_factory=list)
    game_ids: list[dict] = field(default_factory=list)
    start_numbers: list[dict] = field(default_factory=list)
    game_id: str | None = None
    profile_names: list[dict] | None = None  # Namen im Profil (Anzeigename, Gamertag); ohne Angabe: ``profiles``

    def __post_init__(self):
        if self.profile_names is None:
            self.profile_names = [{"profile_id": pid, "value": name} for pid, name in self.profiles.items()]


def _hit(keys: tuple[str, ...], value) -> str | None:
    """``full``, wenn der volle Schlüssel gleich ist, ``untagged``, wenn erst ohne Clan-Tag, sonst ``None``."""
    theirs = name_keys(value)
    if not keys or not theirs:
        return None
    if keys[0] == theirs[0]:
        return "full"
    return "untagged" if set(keys) & set(theirs) else None


def _alias_hit(keys: tuple[str, ...], alias: dict) -> str | None:
    stored = alias.get("name_normalized") or ""
    if keys and stored == keys[0]:
        return "full"
    return "untagged" if stored and stored in keys else None


def exact_alias(index: IdentityIndex, name) -> dict | None:
    """Der Alias, der einen neuen Namen von selbst zuordnet: voller Schlüssel und dasselbe Spiel (oder für alle
    Spiele gespeichert). Ein Treffer erst ohne Clan-Tag oder aus einem anderen Spiel bleibt ein Vorschlag."""
    keys = name_keys(name)
    for alias in index.aliases:
        if _alias_hit(keys, alias) == "full" and alias.get("game_id") in (index.game_id, None):
            if alias.get("target") == "guest" or alias.get("profile_id") in index.profiles:
                return alias
    return None


def suggest(index: IdentityIndex, name, start_number: str | None = None) -> list[dict]:
    """Vorschläge für einen Namen, der stärkste zuerst; je Ziel (Profil oder Gast) ein Eintrag mit allen Gründen."""
    keys = name_keys(name)
    found: dict[tuple, dict] = {}

    def add(target: str, profile_id: str | None, guest_name: str | None, basis: str, reason: str) -> None:
        if target == "member" and profile_id not in index.profiles:
            return
        key = (target, profile_id if target == "member" else normalize_name(guest_name))
        label = index.profiles.get(profile_id) if target == "member" else guest_name
        item = found.setdefault(key, {"target": target, "profile_id": profile_id if target == "member" else None,
                                      "guest_name": guest_name if target == "guest" else None, "label": label,
                                      "_reasons": []})
        item["_reasons"].append((BASIS_ORDER.index(basis), basis, reason))

    for alias in index.aliases:
        hit = _alias_hit(keys, alias)
        if not hit:
            continue
        day = vienna_date(alias.get("confirmed_at"))
        reason = f"Alias bestätigt am {day}" if day else "Alias bestätigt"
        if alias.get("game_id") not in (index.game_id, None):
            reason += " (anderes Spiel)"
        add(alias.get("target") or "member", alias.get("profile_id"), alias.get("guest_name"), "alias",
            reason + (" – ohne Clan-Tag" if hit == "untagged" else ""))
    for entry in index.game_ids:
        hit = _hit(keys, entry.get("value"))
        if hit:
            add("member", entry.get("profile_id"), None, "game_id",
                f"Spiel-ID passt ({entry.get('label')})" + (" – ohne Clan-Tag" if hit == "untagged" else ""))
    for entry in index.profile_names:
        hit = _hit(keys, entry.get("value"))
        if hit:
            add("member", entry.get("profile_id"), None, "profile_name",
                "Name im Profil passt" + (" – ohne Clan-Tag" if hit == "untagged" else ""))
    number = str(start_number or "").strip()
    if number:
        for entry in index.start_numbers:
            if str(entry.get("start_number") or "").strip() == number:
                season = entry.get("season")
                add("member", entry.get("profile_id"), None, "start_number",
                    f"Gleiche Startnummer {number}" + (f" wie in {season}" if season else ""))

    out = []
    for item in found.values():
        reasons = sorted(dict.fromkeys(item.pop("_reasons")))
        best = reasons[0][1]
        out.append({**item, "basis": best, "strong": best in STRONG,
                    "reason": " · ".join(dict.fromkeys(reason for _, _, reason in reasons))})
    out.sort(key=lambda item: (BASIS_ORDER.index(item["basis"]), str(item["label"] or "").casefold()))
    return out
