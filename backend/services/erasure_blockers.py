"""Was das eigene Löschen des Kontos aufhält (#2113, L-C5).

Wer ein Team als Kapitän führt, Co-Kapitän ist oder in einem Co-Team Captain bzw. Vertreter ist, löscht sein Konto
nicht einfach weg: sonst stünde „Gelöschter Benutzer“ als Kapitän da, und die Co-Leitung säße fest. Stattdessen nennt
die Seite (und die Meldung des Servers, die auch die App zeigt) je Rolle den Weg - Leitung übergeben, Team auflösen,
Team verlassen oder die Rolle abgeben. Danach geht das Löschen wie bisher.

Die Prüfung gilt nur für das eigene Löschen (``/api/dsgvo/anonymize-me``). Die Löschung durch den Verein (Superadmin,
Vereinsverwaltung) bleibt unverändert - sie muss eine Löschpflicht auch dann erfüllen können, wenn die Person nicht
mehr erreichbar ist."""
from __future__ import annotations

ROLE_LABELS = {
    "leader": "Kapitän",
    "co_leader": "Co-Kapitän",
    "captain": "Captain",
    "vice_captain": "Vertreter",
}

WAYS = {
    "leader": "Übergib die Leitung auf der Teamseite unter „Mitglieder verwalten“ („Zum Kapitän machen“) oder löse "
              "das Team unter „Bearbeiten“ auf.",
    "co_leader": "Verlasse das Team auf der Teamseite („Team verlassen“) oder bitte den Kapitän, dich auf Spieler zu "
                 "stellen.",
    "captain": "Gib die Rolle unter Teams → Deine Teams mit „Rolle abgeben“ ab.",
    "vice_captain": "Gib die Rolle unter Teams → Deine Teams mit „Rolle abgeben“ ab.",
}
# Wohin der Knopf auf der Seite „Meine Daten“ führt - je Rolle dorthin, wo der Weg steht.
LINKS = {"leader": "/teams/{team_id}", "co_leader": "/teams/{team_id}", "captain": "/teams",
         "vice_captain": "/teams"}

LEAD = "Bevor du dein Konto löschst, gib deine Rollen in Teams ab – sonst stünde ein gelöschtes Konto an der Spitze."


def _team_label(team: dict | None) -> str:
    team = team or {}
    name = team.get("name") or "Team"
    return f"[{team['tag']}] {name}" if team.get("tag") else name


async def team_roles(db, user_id: str) -> list[dict]:
    """Die Rollen, die das Löschen aufhalten - je Rolle Team, Co-Team, Rolle und der Weg in einem Satz."""
    rows: list[dict] = []
    teams = await db.teams.find(
        {"$or": [{"leader_id": user_id}, {"co_leader_ids": user_id}]},
        {"_id": 0, "id": 1, "name": 1, "tag": 1, "leader_id": 1},
    ).sort("name", 1).to_list(200)
    for team in teams:
        role = "leader" if team.get("leader_id") == user_id else "co_leader"
        rows.append({"team_id": team["id"], "team": _team_label(team), "squad_id": None, "squad": None,
                     "role": role, "role_label": ROLE_LABELS[role], "way": WAYS[role],
                     "link": LINKS[role].format(team_id=team["id"])})
    squads = await db.team_squads.find(
        {"status": {"$ne": "archived"}, "$or": [{"captain_id": user_id}, {"vice_captain_id": user_id}]},
        {"_id": 0, "id": 1, "name": 1, "team_id": 1, "captain_id": 1, "vice_captain_id": 1},
    ).sort("name", 1).to_list(200)
    if squads:
        owners = {row["id"]: row for row in await db.teams.find(
            {"id": {"$in": sorted({squad.get("team_id") for squad in squads if squad.get("team_id")})}},
            {"_id": 0, "id": 1, "name": 1, "tag": 1},
        ).to_list(200)}
        for squad in squads:
            for field, role in (("captain_id", "captain"), ("vice_captain_id", "vice_captain")):
                if squad.get(field) != user_id:
                    continue
                rows.append({"team_id": squad.get("team_id"), "team": _team_label(owners.get(squad.get("team_id"))),
                             "squad_id": squad["id"], "squad": squad.get("name") or "Co-Team",
                             "role": role, "role_label": ROLE_LABELS[role], "way": WAYS[role],
                             "link": LINKS[role].format(team_id=squad.get("team_id") or "")})
    return rows


async def blockers(db, user_id: str, role: str | None) -> list[dict]:
    """Was das eigene Löschen aufhält: Team-Rollen und der letzte Superadmin (#2125) - danach vergäbe niemand mehr Rollen."""
    from services.permissions import usable_superadmins

    rows = await team_roles(db, user_id)
    if role == "superadmin" and not await usable_superadmins(db, without=user_id):
        rows.append({"team_id": None, "team": "der Website", "squad_id": None, "squad": None, "role": "superadmin",
                     "role_label": "der letzte Superadmin", "way": "Ernenne unter Admin → Alle Benutzer zuerst eine zweite Person zum Superadmin.",
                     "link": "/admin/users"})
    return rows


async def way_out(db) -> str:
    """Der Schlusssatz (#2113): Der Löschanspruch darf nicht an einer Team-Rolle hängen bleiben - etwa wenn sich ein
    Team in einer laufenden Liga nicht auflösen lässt. Die Adresse kommt aus den Rechtsdaten (Einstellungen)."""
    from services.site_texts import legal_context

    legal, _flags = await legal_context(db)
    email = legal.get("privacy_contact_email") or legal.get("contact_email")
    where = f"schreib an {email}" if email else "melde dich über das Kontaktformular"
    return f"Kommst du so nicht weiter, {where} – der Verein löscht dein Konto dann."


def message(rows: list[dict], closing: str | None = None) -> str | None:
    """Ein Satz für die Meldung des Servers - mit jeder Rolle, ihrem Weg und dem Schlusssatz; ``None`` ohne Rollen."""
    if not rows:
        return None
    parts = []
    for row in rows:
        where = f"im Co-Team {row['squad']} von {row['team']}" if row.get("squad") else f"bei {row['team']}"
        parts.append(f"Du bist {row['role_label']} {where}: {row['way']}")
    lead = [LEAD] if any(row["role"] != "superadmin" for row in rows) else []
    return " ".join([*lead, *parts, *([closing] if closing else [])])
