"""Gelernte Schreibweisen aus Ergebnis-Bildern (#2012).

Ändert der Vorstand im Ergebnis-Blatt einen aus dem Bild gelesenen Namen auf einen Teilnehmer der Saison (oder ein
gelesenes Team auf ein Team), merkt sich die Website beim Übernehmen die gelesene Schreibweise. Beim nächsten Bild
zählt sie wie der Name selbst (``result_image_match``) - eindeutig, also grün.

- **Nur eindeutig:** nutzbar, nicht schon der Name, kein anderer Tag einer Spielkennung, ähnlich genug für eine
  Verlesung (``result_image_match.learnable``) - und kein anderer Teilnehmer bzw. kein anderes bekanntes Team passt
  mindestens so gut. Eine Schreibweise, die selbst ein bekanntes Team ist, wird nie umgelernt.
- **Wo:** Namen am Teilnehmer (``read_aliases``: ``{name, at}``, höchstens ``MAX_NAMES``), Teams an der Saison
  (``read_team_aliases``: ``{read, team, at}``, höchstens ``MAX_TEAMS``). Andere Saisons derselben Spur nutzen sie über
  den Kader der Spur mit. Sichtbar und entfernbar beim Teilnehmer bzw. bei der Saison (``PATCH`` mit der Liste, die
  bleiben soll); jedes Lernen steht im Protokoll des Speicherns (``learned``), jedes Entfernen in dem der Änderung.
- Nur der Vorstand lernt (wie Aliase, #1743); Captains schicken die Lesung mit, sie wird nicht verwendet.
"""
from __future__ import annotations

from models import now_utc
from services import series_identity
from services.result_image_match import LEARN_SIMILARITY, learnable, own_names, similarity

MAX_NAMES = 20
MAX_TEAMS = 200


def _clean(value) -> str:
    return " ".join(str(value or "").split())[:120]


def _learned(row: dict) -> list[str]:
    return [item["name"] for item in row.get("read_aliases") or [] if isinstance(item, dict) and item.get("name")]


def name_spellings(entries: list[tuple[str, str]], participants: list[dict]) -> tuple[list[dict], list[dict]]:
    """Was zu lernen und was zu vergessen ist: ``entries`` sind (Teilnehmer, gelesener Name). Liefert zwei Listen
    ``{participant_id, name}``: zu lernen - nur eindeutige, jede Schreibweise je Teilnehmer einmal - und zu vergessen:
    war die Lesung bei einem anderen Teilnehmer gelernt, hat der Vorstand ihr jetzt widersprochen (Prüfer zu #2012) -
    sie macht den anderen nie wieder grün. Ein echter Name eines anderen wird nie vergessen."""
    by_id = {row["id"]: row for row in participants if row.get("id")}
    out, forget, seen = [], [], set()
    for pid, raw in entries:
        person, read = by_id.get(pid), _clean(raw)
        if not person or not read:
            continue
        keys = set(series_identity.name_keys(read))
        dropped: dict[str, set[str]] = {}
        for row in participants:
            if row.get("id") in (None, pid):
                continue
            for name in _learned(row):
                if keys & set(series_identity.name_keys(name)) and name not in dropped.get(row["id"], set()):
                    dropped.setdefault(row["id"], set()).add(name)
                    if {"participant_id": row["id"], "name": name} not in forget:
                        forget.append({"participant_id": row["id"], "name": name})
        own = [name for name in own_names(person) if name]
        if not learnable(read, person.get("name") or "") or any(
                keys & set(series_identity.name_keys(name)) for name in own):
            continue
        score = max(similarity(read, name) for name in own)
        rival = max((similarity(read, name) for row in participants if row.get("id") != pid
                     for name in own_names(row) if name and name not in dropped.get(row.get("id"), set())),
                    default=0.0)
        key = (pid, series_identity.normalize_name(read))
        if rival >= score or key in seen:
            continue
        seen.add(key)
        out.append({"participant_id": pid, "name": read})
    return out, forget


def team_spellings(entries: list[tuple[str, str]], known: list[str],
                   learned: list[dict]) -> tuple[list[dict], list[dict]]:
    """Was zu lernen und was zu vergessen ist: ``entries`` sind (Team im Blatt, gelesenes Team), ``known`` die Teams der
    Saison, ``learned`` die schon gelernten. Liefert zwei Listen ``{read, team}``: zu lernen - nur eindeutige - und zu
    vergessen: war die Lesung einem anderen Team zugeordnet, gilt das nicht mehr (Prüfer zu #2012)."""
    teams = {series_identity.normalize_name(team): team for team in known if series_identity.normalize_name(team)}
    done: dict[str, list[dict]] = {}
    for item in learned:
        if isinstance(item, dict) and series_identity.normalize_name(item.get("read")):
            done.setdefault(series_identity.normalize_name(item.get("read")), []).append(item)
    out, forget = [], []
    for team, raw in entries:
        team_key, read = series_identity.normalize_name(team), _clean(raw)
        read_key = series_identity.normalize_name(read)
        if team_key not in teams or not read_key or read_key in teams:
            continue
        before = done.get(read_key, [])
        if any(series_identity.normalize_name(item.get("team")) == team_key for item in before):
            continue  # schon so gelernt
        for item in before:
            forget.append({"read": item.get("read"), "team": item.get("team")})
        done[read_key] = []
        score = similarity(read, teams[team_key])
        rival = max((similarity(read, other) for key, other in teams.items() if key != team_key), default=0.0)
        if score < LEARN_SIMILARITY or rival >= score:
            continue
        done[read_key] = [{"read": read, "team": teams[team_key]}]
        out.append({"read": read, "team": teams[team_key]})
    return out, forget


async def learn(db, series_id: str, names: list[dict], teams: list[dict], forget_names: list[dict] | None = None,
                forget_teams: list[dict] | None = None) -> None:
    """Gelerntes speichern und Widersprochenes vergessen - unter der Sperre der Saison aufrufen (beim Übernehmen des
    Blatts)."""
    now = now_utc().isoformat()
    for item in forget_names or []:
        await db.reference_participants.update_one(
            {"id": item["participant_id"], "series_id": series_id}, {"$pull": {"read_aliases": {"name": item["name"]}}})
    for item in forget_teams or []:
        await db.reference_series.update_one(
            {"id": series_id}, {"$pull": {"read_team_aliases": {"read": item["read"], "team": item["team"]}}})
    for item in names:
        await db.reference_participants.update_one(
            {"id": item["participant_id"], "series_id": series_id},
            {"$push": {"read_aliases": {"$each": [{"name": item["name"], "at": now}], "$slice": -MAX_NAMES}}})
    if teams:
        await db.reference_series.update_one({"id": series_id}, {"$push": {"read_team_aliases": {
            "$each": [{**item, "at": now} for item in teams], "$slice": -MAX_TEAMS}}})


def keep(current: list, wanted: list[str], field: str) -> list[dict]:
    """Entfernen (``PATCH``): von den gespeicherten Einträgen bleiben die, deren ``field`` in ``wanted`` steht - neue
    kommen so nie hinzu."""
    keys = {series_identity.normalize_name(value) for value in wanted or []}
    return [item for item in current or [] if isinstance(item, dict)
            and series_identity.normalize_name(item.get(field)) in keys]
