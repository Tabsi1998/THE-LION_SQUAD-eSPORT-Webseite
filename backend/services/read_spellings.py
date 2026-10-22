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


def name_spellings(entries: list[tuple[str, str]], participants: list[dict]) -> list[dict]:
    """Was zu lernen ist: ``entries`` sind (Teilnehmer, gelesener Name). Liefert ``{participant_id, name}`` - nur
    eindeutige, jede Schreibweise je Teilnehmer einmal."""
    by_id = {row["id"]: row for row in participants if row.get("id")}
    out, seen = [], set()
    for pid, raw in entries:
        person, read = by_id.get(pid), _clean(raw)
        if not person or not read:
            continue
        own = [name for name in own_names(person) if name]
        if not learnable(read, person.get("name") or "") or any(
                set(series_identity.name_keys(read)) & set(series_identity.name_keys(name)) for name in own):
            continue
        score = max(similarity(read, name) for name in own)
        rival = max((similarity(read, name) for row in participants if row.get("id") != pid
                     for name in own_names(row) if name), default=0.0)
        key = (pid, series_identity.normalize_name(read))
        if rival >= score or key in seen:
            continue
        seen.add(key)
        out.append({"participant_id": pid, "name": read})
    return out


def team_spellings(entries: list[tuple[str, str]], known: list[str], learned: list[dict]) -> list[dict]:
    """Was zu lernen ist: ``entries`` sind (Team im Blatt, gelesenes Team), ``known`` die Teams der Saison, ``learned``
    die schon gelernten. Liefert ``{read, team}`` - nur eindeutige."""
    teams = {series_identity.normalize_name(team): team for team in known if series_identity.normalize_name(team)}
    done = {series_identity.normalize_name(item.get("read")) for item in learned if isinstance(item, dict)}
    out = []
    for team, raw in entries:
        team_key, read = series_identity.normalize_name(team), _clean(raw)
        read_key = series_identity.normalize_name(read)
        if team_key not in teams or not read_key or read_key in teams or read_key in done:
            continue
        score = similarity(read, teams[team_key])
        rival = max((similarity(read, other) for key, other in teams.items() if key != team_key), default=0.0)
        if score < LEARN_SIMILARITY or rival >= score:
            continue
        done.add(read_key)
        out.append({"read": read, "team": teams[team_key]})
    return out


async def learn(db, series_id: str, names: list[dict], teams: list[dict]) -> None:
    """Gelerntes speichern - unter der Sperre der Saison aufrufen (beim Übernehmen des Blatts)."""
    now = now_utc().isoformat()
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
