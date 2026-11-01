"""Teams für Ansichten, die zurückblicken (#2128, TM8): alte Turniere, Tabellen, Bilanzen.

Ein aufgelöstes Team steht nicht mehr in ``teams``, sondern bis zum Ende der Frist in ``dissolved_teams``
(``services/team_dissolve.py``) - alle Prüfungen und Listen, die ``teams`` lesen, kennen es also nicht mehr. Wer aber ein
altes Ergebnis zeigt, braucht weiter einen Namen statt einer Lücke: dafür dieser Baustein. Er liefert nur, was die Anzeige
braucht (Kennung, Name, Kürzel, Logo, öffentlich?) und ``dissolved``, nie Mitglieder oder Rollen."""
from __future__ import annotations

HISTORY_FIELDS = {"_id": 0, "id": 1, "name": 1, "tag": 1, "logo_url": 1, "is_public": 1}


async def dissolved_views(db, team_ids) -> dict[str, dict]:
    """Die aufgelösten Teams zu diesen Kennungen - auch nach Ablauf der Frist bleiben Name und Kürzel."""
    wanted = sorted({team_id for team_id in team_ids if team_id})
    if not wanted:
        return {}
    rows = await db.dissolved_teams.find({"id": {"$in": wanted}}, HISTORY_FIELDS).to_list(len(wanted))
    return {row["id"]: {**row, "dissolved": True} for row in rows}


async def teams_by_id(db, team_ids, projection: dict | None = None) -> dict[str, dict]:
    """Bestehende Teams wie aus ``teams`` gelesen, dazu die aufgelösten als knappe Anzeige."""
    wanted = sorted({team_id for team_id in team_ids if team_id})
    if not wanted:
        return {}
    found = {row["id"]: row for row in await db.teams.find({"id": {"$in": wanted}}, projection or {"_id": 0}).to_list(len(wanted))}
    found.update(await dissolved_views(db, [team_id for team_id in wanted if team_id not in found]))
    return found


async def team_by_id(db, team_id: str | None, projection: dict | None = None) -> dict | None:
    return (await teams_by_id(db, [team_id], projection)).get(team_id)
