"""Gastteams in der Liga (#1665, Entscheidungen Nr. 284 und 286): ein Hauptteam, das als Gast mitspielt - kein Team des Vereins.

**Kein zweites System.** Ein Gastteam ist ein ganz normales Team mit Konten ohne Mitgliedschaft. Rechte und Datenbehandlung sind dieselben wie bei
jedem Konto ohne Mitgliedschaft (Nr. 286), es gibt keine Gast-Rolle. Zugelassen wird über die normale Freigabe der Anmeldung (B.4).
Hier steht nur das **Kennzeichen** am Hauptteam (``teams.guest_team``) und die Plakette, die daraus entsteht.

- **Nie aus der Mitgliedschaft abgeleitet:** Sonst wäre an der Plakette ablesbar, wer Mitglied ist. Das Kennzeichen setzt und bestätigt die
  Liga-Leitung (Zuständigkeit „Teams freigeben“ in einer Liga, in der das Team angemeldet ist, oder der Bereich Ligen).
- **Verein bzw. Schule liefert die Teamleitung** (Leitung und Co-Leitung des Hauptteams): Art, Name und - bei einer Schule - die Freigabe,
  den Namen zu zeigen. Ohne Freigabe steht nur „Gast“ (Schulteams sind oft minderjährig).
- **Öffentlich steht nur, was die Liga-Leitung gesehen hat:** Ändert die Teamleitung Art oder Name nach der Bestätigung, zeigt die Plakette
  bis zur neuen Bestätigung nur „Gast“ (``confirmed_kind``/``confirmed_name``). Die Freigabe des Schulnamens wirkt sofort, in beide Richtungen.
- **Plakette:** Web und App „Gast · Verein/Schule“ (``guest_badge`` mit ``label`` und ``org``), TV und Discord nur „Gast“ (``short``).
- **Ohne Feld wie heute:** Ein Team ohne ``guest_team`` bekommt nirgends ein Feld dazu.
- **Keine Personen am Feld:** Wer bestätigt oder geändert hat, steht nur im Protokoll (``audit_logs``) - die Kontolöschung muss am Team
  nichts herausnehmen, die Auskunft zeigt das Team samt Feld wie bisher.

Ohne Routen, ohne Web; die Routen stehen in ``routes/league_guest_routes.py``.
"""
from __future__ import annotations

from typing import Callable, Iterable

from models import now_utc

FIELD = "guest_team"
BADGE = "guest_badge"
LABEL = "Gast"
KINDS = ("club", "school")
KIND_LABELS = {"club": "Verein", "school": "Schule"}
NAME_MIN, NAME_MAX = 2, 80
PROJECTION = {"_id": 0, "id": 1, FIELD: 1}

NAME_REQUIRES_KIND = "Sag zuerst, ob ihr für einen Verein oder eine Schule spielt."
NAME_LENGTH = f"Der Name von Verein oder Schule braucht {NAME_MIN} bis {NAME_MAX} Zeichen."
NOT_TEAM_LEAD = "Verein oder Schule tragen Teamleitung und Co-Leitung ein."
NO_LEAGUE_TEAM = "Das Kennzeichen „Gast“ setzt die Liga-Leitung einer Liga, in der das Team angemeldet ist."


def clean_name(value) -> str:
    return " ".join(str(value or "").split())


def state_of(team: dict | None) -> dict:
    state = (team or {}).get(FIELD)
    return state if isinstance(state, dict) else {}


def is_confirmed(team: dict | None) -> bool:
    return bool(state_of(team).get("confirmed_at"))


def _given(state: dict) -> tuple[str | None, str]:
    kind = state.get("kind") if state.get("kind") in KINDS else None
    return kind, clean_name(state.get("name")) if kind else ""


def _seen(state: dict) -> bool:
    """Hat die Liga-Leitung Art und Name so bestätigt, wie sie jetzt stehen?"""
    kind, name = _given(state)
    return (state.get("confirmed_kind") or None, clean_name(state.get("confirmed_name"))) == (kind, name)


def public_org(team: dict | None) -> str | None:
    """Der Name, den die Plakette zeigt: bestätigt, unverändert seit der Bestätigung und bei einer Schule freigegeben."""
    state = state_of(team)
    kind, name = _given(state)
    if not state.get("confirmed_at") or not name or not _seen(state):
        return None
    if kind == "school" and not state.get("school_name_public"):
        return None
    return name


def badge(team: dict | None, *, short: bool = False) -> dict | None:
    """``{"label": "Gast", "org": …}`` für Web und App, ``{"label": "Gast"}`` für TV und Discord - ``None`` ohne bestätigtes Kennzeichen."""
    if not is_confirmed(team):
        return None
    return {"label": LABEL} if short else {"label": LABEL, "org": public_org(team)}


def pending(team: dict | None) -> bool:
    """Wartet eine Angabe der Teamleitung auf die Liga-Leitung? Neu angegeben oder seit der Bestätigung geändert."""
    state = state_of(team)
    kind, _name = _given(state)
    return bool(kind) and (not state.get("confirmed_at") or not _seen(state))


def details(team: dict | None) -> dict | None:
    """Was Teamleitung und Liga-Leitung sehen: alle Angaben, auch einen Schulnamen ohne Freigabe. ``None`` ohne Feld."""
    state = state_of(team)
    if not state:
        return None
    kind, name = _given(state)
    return {
        "confirmed": bool(state.get("confirmed_at")), "confirmed_at": state.get("confirmed_at"),
        "kind": kind, "kind_label": KIND_LABELS.get(kind or ""), "name": name or None,
        "school_name_public": bool(state.get("school_name_public")) if kind == "school" else False,
        "confirmed_kind": state.get("confirmed_kind") or None, "confirmed_name": clean_name(state.get("confirmed_name")) or None,
        "pending": pending(team), "updated_at": state.get("updated_at"), "badge": badge(team),
    }


def text_suffix(team: dict | None) -> str:
    """„ (Gast)“ hinter einem Namen in Texten für alle (Discord, Mail an Teams) - nie Verein oder Schule."""
    return f" ({LABEL})" if is_confirmed(team) else ""


# ---------------------------------------------------------------- Lesen in Mengen


async def teams_with_marks(db, team_ids: Iterable[str | None]) -> dict[str, dict]:
    """Die Teams mit Kennzeichen oder Angabe - eine Abfrage, nur Kennung und Feld."""
    wanted = sorted({team_id for team_id in team_ids or [] if team_id})
    if not wanted:
        return {}
    rows = await db.teams.find({"id": {"$in": wanted}, FIELD: {"$exists": True}}, PROJECTION).to_list(len(wanted))
    return {row["id"]: row for row in rows if row.get("id")}


async def badges_for(db, team_ids: Iterable[str | None], *, short: bool = False) -> dict[str, dict]:
    teams = await teams_with_marks(db, team_ids)
    return {team_id: mark for team_id, team in teams.items() if (mark := badge(team, short=short))}


def _team_id(item: dict) -> str | None:
    return item.get("team_id")


async def mark(db, items, *, team_of: Callable[[dict], str | None] = _team_id, short: bool = False) -> list[dict]:
    """Setzt ``guest_badge`` an jede Zeile, deren Hauptteam ein bestätigtes Gastteam ist - und nimmt es überall sonst weg (eine Zeile aus
    einem gespeicherten Stand trägt nie ein altes Kennzeichen weiter). Ohne Gastteam ändert sich an den Zeilen nichts."""
    rows = [item for item in items or [] if isinstance(item, dict)]
    found = await badges_for(db, [team_of(row) for row in rows], short=short) if rows else {}
    for row in rows:
        mark_of = found.get(team_of(row) or "")
        if mark_of:
            row[BADGE] = dict(mark_of)
        else:
            row.pop(BADGE, None)
    return rows


# ---------------------------------------------------------------- Schreiben


def org_fields(kind, name, school_name_public, *, before: dict | None = None) -> dict:
    """Die Angabe der Teamleitung, geprüft. ``kind`` ``None`` nimmt Art und Name weg. Wirft ``ValueError`` mit deutschem Text."""
    kind = kind if kind in KINDS else None
    name = clean_name(name)
    if name and not kind:
        raise ValueError(NAME_REQUIRES_KIND)
    if name and not NAME_MIN <= len(name) <= NAME_MAX:
        raise ValueError(NAME_LENGTH)
    state = dict(before or {})
    state.update({"kind": kind, "name": name or None, "school_name_public": bool(school_name_public) if kind == "school" else False,
                  "updated_at": now_utc().isoformat()})
    return state


def is_empty(state: dict) -> bool:
    """Kein Kennzeichen und keine Angabe: Das Feld fällt ganz weg - das Team ist wieder wie vor dem Feld."""
    return not state.get("confirmed_at") and not state.get("kind")


def confirmed_fields(state: dict, confirmed: bool) -> dict:
    """Bestätigen hält fest, welche Art und welchen Namen die Liga-Leitung gesehen hat; Zurücknehmen lässt die Angabe der Teamleitung stehen."""
    state = dict(state or {})
    if confirmed:
        kind, name = _given(state)
        state.update({"confirmed_at": now_utc().isoformat(), "confirmed_kind": kind, "confirmed_name": name or None})
    else:
        for key in ("confirmed_at", "confirmed_kind", "confirmed_name"):
            state.pop(key, None)
    return state


async def save(db, team_id: str, state: dict) -> None:
    if is_empty(state):
        await db.teams.update_one({"id": team_id}, {"$unset": {FIELD: ""}})
    else:
        await db.teams.update_one({"id": team_id}, {"$set": {FIELD: state}})


async def league_ids_of_team(db, team_id: str) -> set[str]:
    """Die Ligen, in denen das Team einen Antrag hat oder in einer Staffel steht - dort darf deren Leitung das Kennzeichen setzen."""
    leagues = {row.get("league_id") for row in await db.league_applications.find(
        {"team_id": team_id}, {"_id": 0, "league_id": 1}).to_list(500)}
    tournament_ids = sorted({row.get("tournament_id") for row in await db.tournament_registrations.find(
        {"team_id": team_id}, {"_id": 0, "tournament_id": 1}).to_list(2000) if row.get("tournament_id")})
    if tournament_ids:
        rows = await db.tournaments.find({"id": {"$in": tournament_ids}, "league_context.league_id": {"$exists": True}},
                                         {"_id": 0, "league_context": 1}).to_list(len(tournament_ids))
        leagues |= {(row.get("league_context") or {}).get("league_id") for row in rows}
    return {league_id for league_id in leagues if league_id}


async def may_confirm(db, user: dict | None, team_id: str) -> bool:
    """Bereich Ligen, oder „Teams freigeben“ in einer Liga des Teams (``league_ids_of_team``)."""
    from services.league_permissions import can, has_leagues_area

    if has_leagues_area(user):
        return True
    for league_id in sorted(await league_ids_of_team(db, team_id)):
        if await can(user, "applications", league_id, db=db):
            return True
    return False


async def season_context(db, team_id: str, season_id: str | None) -> str | None:
    """Die Season fürs Protokoll des Leitstands - nur eine, in der das Team einen Antrag hat."""
    if not season_id:
        return None
    found = await db.league_applications.find_one({"team_id": team_id, "season_id": season_id}, {"_id": 1})
    return season_id if found else None


async def tell_team(db, team: dict, confirmed: bool) -> None:
    """Teamleitung und Co-Leitung hören, dass die Liga-Leitung das Kennzeichen gesetzt oder zurückgenommen hat - Glocke und Mail."""
    import logging

    from services.league_mail import send_league_mail
    from services.log_safe import log_safe
    from services.user_notifications import create_user_notification

    name = team.get("name") or "Euer Team"
    if confirmed:
        org = public_org(team)
        headline = "Als Gastteam bestätigt"
        text = (f"Die Liga-Leitung hat {name} als Gastteam bestätigt. In den Ligen steht bei euch jetzt „{LABEL}"
                + (f" · {org}“." if org else "“.") + " Verein oder Schule pflegt ihr unter „Team bearbeiten“.")
    else:
        headline = "Kennzeichen „Gast“ zurückgenommen"
        text = f"Die Liga-Leitung hat das Kennzeichen „{LABEL}“ bei {name} zurückgenommen. In den Ligen steht ihr jetzt ohne Plakette."
    stamp = state_of(team).get("confirmed_at") or now_utc().isoformat()
    people = sorted({person for person in (team.get("leader_id"), *(team.get("co_leader_ids") or [])) if person})
    for user_id in people:
        key = f"league-guest-team:{team.get('id')}:{'confirm' if confirmed else 'revoke'}:{stamp}:{user_id}"
        try:
            await create_user_notification(user_id, headline, text, url=f"/teams/{team.get('id')}", kind="tournament_registration",
                                           meta={"reason": f"league_guest_team_{'confirmed' if confirmed else 'revoked'}",
                                                 "team_id": team.get("id"), "dedupe_key": key})
            await send_league_mail(db, user_id, headline, text, f"/teams/{team.get('id')}", f"{key}:mail")
        except Exception:  # noqa: BLE001 - das Kennzeichen ist schon gespeichert
            logging.getLogger("tls.league_guests").warning("[liga] Nachricht zum Gastteam nicht verschickt: %s", log_safe(team.get("id")),
                                                           exc_info=True)


def lead_hint(team: dict | None) -> str:
    """Satz für die Liga-Leitung bei einer neuen Anmeldung: Gastteam bestätigt oder Angabe der Teamleitung offen."""
    state = state_of(team)
    if not state:
        return ""
    kind, name = _given(state)
    what = f"{KIND_LABELS[kind]}{f' {name}' if name else ''}" if kind else ""
    if is_confirmed(team) and not pending(team):
        return f" Gastteam{f' ({what})' if what else ''}."
    if kind:
        return f" Die Teamleitung gibt an: Gastteam ({what}). Bestätige das Kennzeichen im Eingang."
    return " Gastteam."
