"""Leitstand der Season (E.4, docs/LIGA.md „E.4 Leitstand“, Entscheidungen Nr. 152 und 153).

Ein Reiter je Season sammelt alles, was die Liga-Leitung dort noch tun muss - aus denselben Quellen wie „Mein Dienst“ und die
Reiter der Season, ohne eigene Regeln:

- überfällige, nie gemeldete Spiele (Nr. 28, ``league_schedule.overdue_rows``),
- fehlende Teilnehmerlisten nach der Frist (Nr. 47, ``lineup_overdue_at`` aus ``match_deadline_sweep``),
- abgelaufene Check-ins (D.2, ``match_flow.proposal_rows``) und Vorfälle (D.5, ``league_incidents.review_rows``),
- offene Verfahren (E.2, ``league_procedures.open_rows``),
- vorläufige Strafen und offene Einsprüche (E.3, ``league_sanctions.admin_rows``),
- Anmeldungen und Kaderanträge (B.4: Anträge, Transfers, Spiel-IDs zur Freigabe),
- offene Verschiebungen (D.1, ``league_schedule.pending_request``),
- das Regelwerk, falls es freigegeben werden muss (``league_rules.pending_release``).

Jede Gruppe sieht nur, wer die passende Zuständigkeit hat (B.1). Wer an einem Spiel oder einer Seite beteiligt ist, sieht den Fall
mit dem Hinweis, dass eine zweite Person entscheidet - entschieden wird an der verlinkten Stelle, dort prüft die Route selbst.

Dazu das Protokoll der Season (``audit_logs``, nur Liga- und Spielaktionen, ohne freien Text) und die Rundnachricht (Nr. 153):
Captains und Vertreter (Vorgabe) oder alle Spieler der Season, einer Liga N oder einer Staffel, über Glocke und Push, Mail wählbar.
"""
from __future__ import annotations

import logging
from datetime import datetime

from pymongo.errors import DuplicateKeyError

from models import now_utc
from services.league_permissions import (
    CAPABILITY_LABELS,
    CONFLICT_DETAIL,
    OWN_DECISION_DETAIL,
    SIDE_CONFLICT_DETAIL,
    belongs_to_side,
    capabilities_of,
    involved_match_ids,
    side_of,
)
from services.log_safe import log_safe

logger = logging.getLogger("tls.league_desk")

# Die Gruppen in fester Reihenfolge: was ein laufendes Spiel aufhält zuerst. Je Gruppe die Zuständigkeiten, von denen eine reicht.
GROUPS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("incidents", "Vorfälle", ("results", "disputes")),
    ("no_show", "Check-in abgelaufen", ("matches", "results")),
    ("overdue", "Überfällige Spiele", ("matches", "results")),
    ("lineups", "Fehlende Teilnehmerlisten", ("matches", "results")),
    ("procedures", "Verfahren", ("disputes",)),
    ("sanctions", "Strafen und Einsprüche", ("sanctions",)),
    ("applications", "Anmeldungen", ("applications",)),
    ("roster", "Kaderanträge", ("roster",)),
    ("reschedule", "Verschiebungen", ("matches",)),
    ("rules", "Regelwerk-Freigabe", ("rules",)),
)
GROUP_KEYS = tuple(key for key, _label, _caps in GROUPS)
# Die Rundnachricht schickt, wer die Liga verwaltet oder die Season konfiguriert (B.1 kennt keine eigene Zuständigkeit dafür).
BROADCAST_CAPABILITIES = ("manage", "season")
LIMIT = 200
CLOSED_MATCH = ("completed", "forfeit", "bye", "archived", "cancelled")
WAITING_APPLICATIONS = ("submitted", "in_review")


def _label(match: dict) -> str:
    return match.get("matchday_label") or match.get("round_name") or (
        f"Spieltag {match.get('matchday_number') or match.get('round')}" if match.get("matchday_number") or match.get("round") else "Spiel")


def responsible_label(capabilities: tuple[str, ...]) -> str:
    return " oder ".join(f"„{CAPABILITY_LABELS[key]}“" for key in capabilities)


def _item(kind: str, ref: str, *, title: str, text: str, url: str, action: str, due_at=None, since=None,
          assignee: dict | None = None, conflict: str | None = None, me_id: str | None = None, detail: dict | None = None,
          others_decide: bool = False) -> dict:
    """Eine Aufgabe. ``mine``: Die Person kann sie selbst erledigen - nicht befangen und nicht von jemand anderem übernommen;
    ``others_decide``: Hier entscheidet zuerst jemand anderes (Verschiebungen: die Gegenseite), die Leitung schaut nur hin."""
    assignee_id = (assignee or {}).get("user_id")
    return {
        "id": f"{kind}:{ref}", "kind": kind, "title": title, "text": text, "url": url, "action": action,
        "due_at": due_at or None, "since": since or None,
        "assignee": ({"name": assignee.get("name") or "Liga-Leitung", "own": assignee_id == me_id} if assignee else None),
        "conflict": bool(conflict), "conflict_text": conflict,
        "mine": not conflict and not others_decide and (not assignee_id or assignee_id == me_id),
        **({"detail": detail} if detail else {}),
    }


async def _staffeln(db, season_id: str) -> dict[str, dict]:
    rows = await db.tournaments.find({"league_context.season_id": season_id},
                                     {"_id": 0, "id": 1, "title": 1, "slug": 1, "status": 1, "league_context": 1}).to_list(500)
    return {row["id"]: row for row in rows}


async def _involved(db, user: dict, staffeln: dict[str, dict], match_ids_by_staffel: dict[str, list[str]]) -> set[str]:
    """Dieselbe Regel wie beim Entscheiden (``involved_match_ids``), je Staffel eine Abfrage."""
    out: set[str] = set()
    for tournament_id, match_ids in match_ids_by_staffel.items():
        if not match_ids or tournament_id not in staffeln:
            continue
        matches = await db.matches_v2.find({"id": {"$in": sorted(set(match_ids))}},
                                           {"_id": 0, "id": 1, "slots": 1, "games": 1, "lineups": 1, "participants": 1}).to_list(len(match_ids) + 1)
        out |= await involved_match_ids(db, user, staffeln[tournament_id], matches)
    return out


def _by_staffel(rows: list[dict]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for row in rows:
        out.setdefault(row["tournament_id"], []).append(row["match_id"])
    return out


# ---------------------------------------------------------------- Quellen


async def _overdue(db, me, season, staffeln) -> list[dict]:
    from services.league_schedule import overdue_rows

    rows = await overdue_rows(db, me, limit=LIMIT, season_id=season["id"])
    involved = await _involved(db, me, staffeln, _by_staffel(rows))
    return [_item("overdue", row["match_id"], title=f"{row.get('title') or 'Staffel'} · {row['label']}",
                  text="Nie gemeldet, der Termin ist vorbei. Ergebnis eintragen, kampflos werten oder neuen Termin setzen. Ohne Entscheidung "
                       "kein Saisonabschluss.",
                  url=row["url"], action="Spiel öffnen", since=row.get("overdue_since"), due_at=None,
                  conflict=CONFLICT_DETAIL if row["match_id"] in involved else None, me_id=me.get("id"),
                  detail={"scheduled_at": row.get("scheduled_at")}) for row in rows]


async def _lineups(db, me, season, staffeln) -> list[dict]:
    """Nr. 47: Die Frist zum Nachtragen ist um (``lineup_overdue_at``) und eine Seite fehlt noch - der Fall liegt bei der Leitung."""
    ids = sorted(tid for tid, row in staffeln.items() if row.get("status") not in ("archived", "cancelled"))
    if not ids:
        return []
    matches = await db.matches_v2.find(
        {"tournament_id": {"$in": ids}, "lineup_overdue_at": {"$nin": [None, ""]}, "lineups_missing.0": {"$exists": True},
         "is_preview": {"$ne": True}},
        {"_id": 0, "id": 1, "tournament_id": 1, "lineup_overdue_at": 1, "lineups_missing": 1, "round_name": 1, "matchday_label": 1,
         "matchday_number": 1, "round": 1}).sort("lineup_overdue_at", 1).to_list(LIMIT)
    rows = [{"match_id": row["id"], "tournament_id": row["tournament_id"]} for row in matches]
    involved = await _involved(db, me, staffeln, _by_staffel(rows))
    return [_item("lineups", match["id"], title=f"{staffeln[match['tournament_id']].get('title') or 'Staffel'} · {_label(match)}",
                  text=(f"{'Eine Seite hat' if len(match['lineups_missing']) == 1 else 'Beide Seiten haben'} die Teilnehmerliste nicht "
                        "nachgetragen. Das Ergebnis bleibt gültig – auf der Matchseite entscheiden und mit Grund eintragen."),
                  url=f"/matches/{match['id']}", action="Liste eintragen", since=match.get("lineup_overdue_at"),
                  conflict=CONFLICT_DETAIL if match["id"] in involved else None, me_id=me.get("id")) for match in matches]


async def _no_show(db, me, season, staffeln) -> list[dict]:
    from services.match_flow import proposal_rows

    rows = await proposal_rows(db, me, LIMIT, season_id=season["id"])
    involved = await _involved(db, me, staffeln, _by_staffel(rows))
    return [_item("no_show", row["match_id"], title=f"{row.get('title') or 'Staffel'} · {row['label']}",
                  text=(f"{' und '.join(row.get('missing') or []) or 'Eine Seite'} nicht eingecheckt. Kampflos werten, Seite nachtragen oder "
                        "verlängern – gewertet wird nichts von selbst."),
                  url=row.get("lead_url") or row["url"], action="Entscheiden", due_at=row.get("due_at"),
                  conflict=CONFLICT_DETAIL if row["match_id"] in involved else None, me_id=me.get("id")) for row in rows]


async def _incidents(db, me, season, staffeln) -> list[dict]:
    from services.league_incidents import review_rows

    rows = await review_rows(db, me, LIMIT, season_id=season["id"], include_involved=True)
    return [_item("incidents", row["match_id"], title=f"{row.get('title') or 'Staffel'} · {row['label']}",
                  text="", url=row["url"], action="Entscheiden" if row["code"] == "in_review" else "Spiel öffnen", since=row.get("since"),
                  conflict=CONFLICT_DETAIL if row.get("conflict") else None, me_id=me.get("id"),
                  detail={"code": row["code"], "position": row.get("position")}) for row in rows]


async def _procedures(db, me, season, staffeln) -> list[dict]:
    from services import league_procedures as procedures

    ids = sorted(staffeln)
    if not ids:
        return []
    matches = await db.matches_v2.find({"tournament_id": {"$in": ids}, "disputes.kind": {"$in": list(procedures.KINDS)}},
                                       {"_id": 0}).to_list(LIMIT * 5)
    open_matches = [match for match in matches if procedures.open_rows(match)]
    involved: set[str] = set()
    for tournament_id in sorted({match["tournament_id"] for match in open_matches}):
        involved |= await involved_match_ids(db, me, staffeln[tournament_id],
                                             [match for match in open_matches if match["tournament_id"] == tournament_id])
    assignee_ids = sorted({(row.get("assignee") or {}).get("user_id") for match in open_matches for row in procedures.open_rows(match)} - {None})
    names = {row["id"]: row.get("display_name") or row.get("username") or "Liga-Leitung" for row in await db.users.find(
        {"id": {"$in": assignee_ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(len(assignee_ids) + 1)} if assignee_ids else {}
    items = []
    for match in open_matches:
        for row in procedures.open_rows(match):
            assignee = row.get("assignee") or None
            conflict = (OWN_DECISION_DETAIL if procedures.decided_by(row) == me.get("id")
                        else CONFLICT_DETAIL if match["id"] in involved else None)
            statement = row.get("statement") or {}
            waiting = bool(statement.get("registration_id") and not statement.get("text") and statement.get("due_at"))
            due = row.get("target_at") or (statement.get("due_at") if waiting else None) or row.get("evidence_until")
            kind = procedures.KIND_LABELS[row["kind"]]
            text = (f"{kind} {'übernommen, Zielfrist läuft' if assignee else 'wartet darauf, dass jemand aus der Leitung ihn übernimmt'}."
                    if row["kind"] != procedures.OBJECTION else
                    f"Beanstandung {'übernommen' if assignee else 'offen'}: Das Spiel ruht, bis entschieden ist.")
            if waiting:
                text = f"{text} Die Stellungnahme der Gegenseite steht noch aus."
            items.append(_item(
                "procedures", row["id"], title=f"{staffeln[match['tournament_id']].get('title') or 'Staffel'} · {_label(match)}",
                text=text, url=f"/matches/{match['id']}#verfahren-{row['id']}", action="Zum Verfahren", due_at=due, since=row.get("at"),
                assignee=({"user_id": assignee.get("user_id"), "name": names.get(assignee.get("user_id"))} if assignee else None),
                conflict=conflict, me_id=me.get("id"), detail={"kind": row["kind"], "kind_label": kind}))
    return items


async def _sanctions(db, me, season, staffeln) -> list[dict]:
    from services import league_sanctions as sanctions

    docs = await db.competition_sanctions.find(
        {"season_id": season["id"], "revoked_at": None, "$or": [{"state": sanctions.PROVISIONAL}, {"appeal.state": sanctions.OPEN}]},
        {"_id": 0}).sort("created_at", 1).to_list(LIMIT)
    if not docs:
        return []
    rows = await sanctions.admin_rows(db, docs, me)
    items = []
    for row, doc in zip(rows, docs):
        target = row.get("squad_name") or "Co-Team"
        conflict = SIDE_CONFLICT_DETAIL if row.get("conflict") == "side" else CONFLICT_DETAIL if row.get("conflict") == "match" else None
        if (doc.get("appeal") or {}).get("state") == sanctions.OPEN:
            if row.get("own_decision"):
                conflict = OWN_DECISION_DETAIL
            items.append(_item("sanctions", f"{doc['id']}:appeal", title=f"Einspruch · {row['kind_label']} · {target}",
                               text="Gegen die Strafe liegt ein Einspruch vor. Es entscheidet, wer sie nicht verhängt oder bestätigt hat.",
                               url=f"/admin/leagues/seasons/{season['id']}#strafen", action="Einspruch entscheiden",
                               since=(doc.get("appeal") or {}).get("at"), conflict=conflict, me_id=me.get("id")))
        if doc.get("state") == sanctions.PROVISIONAL:
            items.append(_item("sanctions", f"{doc['id']}:provisional", title=f"Vorläufig · {row['kind_label']} · {target}",
                               text="Die Sperre gilt vorläufig. Bestätigen mit Zeitraum oder widerrufen.",
                               url=f"/admin/leagues/seasons/{season['id']}#strafen", action="Strafe prüfen", since=doc.get("created_at"),
                               conflict=conflict, me_id=me.get("id")))
    return items


async def _applications(db, me, season, staffeln) -> list[dict]:
    from services.match_audience import teams_by_id

    rows = await db.league_applications.find(
        {"season_id": season["id"], "$or": [{"status": {"$in": list(WAITING_APPLICATIONS)}},
                                            {"status": "accepted", "assignment": {"$in": [None, {}]}}]},
        {"_id": 0}).sort("created_at", 1).to_list(LIMIT)
    if not rows:
        return []
    teams = await teams_by_id(db, [side_of(row) for row in rows])
    start = season.get("start_date")
    out = []
    for row in rows:
        own = belongs_to_side(me, side_of(row), teams.get(row.get("team_id") or ""))
        accepted = row.get("status") == "accepted"
        out.append(_item(
            "applications", row["id"], title=row.get("display_name") or "Co-Team",
            text=("Angenommen, aber noch keiner Staffel zugeteilt." if accepted else
                  "Die Anmeldung wartet auf die Entscheidung: annehmen, auf die Warteliste setzen oder ablehnen."),
            url=f"/admin/leagues/seasons/{season['id']}#anmeldungen", action="Zuteilen" if accepted else "Entscheiden",
            due_at=start if start and str(start) > now_utc().isoformat() else None, since=row.get("created_at"),
            conflict=SIDE_CONFLICT_DETAIL if own else None, me_id=me.get("id")))
    return out


async def _roster(db, me, season, staffeln) -> list[dict]:
    """Kaderanträge (B.4): Transfers, über die die Leitung entscheidet, und Spiel-IDs, die sie nach dem Stichtag freigeben muss."""
    from services import league_roster, league_transfers

    out = []
    transfers = await db.league_transfers.find({"season_id": season["id"], "status": league_transfers.PENDING},
                                               {"_id": 0, "id": 1, "to_squad_id": 1, "requested_at": 1}).sort("requested_at", 1).to_list(LIMIT)
    squad_ids = sorted({row["to_squad_id"] for row in transfers if row.get("to_squad_id")})
    squads = {row["id"]: row.get("name") or "Co-Team" for row in await db.team_squads.find(
        {"id": {"$in": squad_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(squad_ids) + 1)} if squad_ids else {}
    for row in transfers:
        out.append(_item("roster", f"transfer:{row['id']}", title=f"Transfer ins Co-Team {squads.get(row.get('to_squad_id'), '')}".strip(),
                         text="Ein Wechsel im Transferfenster wartet auf die Genehmigung der Liga-Leitung.",
                         url=f"/admin/leagues/seasons/{season['id']}#kader", action="Entscheiden", since=row.get("requested_at"),
                         me_id=me.get("id")))
    # Spiel-IDs „nach dem Stichtag“ gibt es nur mit einem Eintrag ``late_squad_ids`` - ohne ihn bleibt die teure Kaderübersicht zu.
    if not await db.league_rosters.find_one({"season_id": season["id"], "late_squad_ids.0": {"$exists": True}}, {"_id": 1}):
        return out
    overview = await league_roster.season_overview(db, season)
    for squad in overview.get("squads") or []:
        late = [player for player in squad.get("players") or [] if player.get("state") == league_roster.LATE]
        if not late:
            continue
        count = len(late)
        out.append(_item("roster", f"ids:{squad.get('registration_id')}", title=squad.get("display_name") or "Co-Team",
                         text=(f"{'Eine Spiel-ID wartet' if count == 1 else f'{count} Spiel-IDs warten'} nach dem Stichtag auf die Freigabe."),
                         url=f"/admin/leagues/seasons/{season['id']}#kader", action="Freigeben", me_id=me.get("id")))
    return out


async def _reschedule(db, me, season, staffeln) -> list[dict]:
    from services.league_schedule import pending_request

    ids = sorted(staffeln)
    if not ids:
        return []
    matches = await db.matches_v2.find(
        {"tournament_id": {"$in": ids}, "reschedule_requests.status": "pending", "status": {"$nin": list(CLOSED_MATCH)}},
        {"_id": 0, "id": 1, "tournament_id": 1, "scheduled_at": 1, "reschedule_requests": 1, "round_name": 1, "matchday_label": 1,
         "matchday_number": 1, "round": 1}).sort("scheduled_at", 1).to_list(LIMIT)
    rows = [{"match_id": row["id"], "tournament_id": row["tournament_id"]} for row in matches]
    involved = await _involved(db, me, staffeln, _by_staffel(rows))
    out = []
    for match in matches:
        request = pending_request(match)
        if not request:
            continue
        out.append(_item("reschedule", request["id"], title=f"{staffeln[match['tournament_id']].get('title') or 'Staffel'} · {_label(match)}",
                         text="Eine Seite möchte verschieben. Zustimmen oder ablehnen muss die Gegenseite bis zum alten Termin – "
                              "die Leitung legt den Termin nur fest, wenn sich die Seiten nicht einigen.",
                         url=f"/matches/{match['id']}", action="Spiel öffnen", due_at=match.get("scheduled_at"),
                         since=request.get("requested_at"), conflict=CONFLICT_DETAIL if match["id"] in involved else None,
                         me_id=me.get("id"), others_decide=True, detail={"to_at": request.get("to_at")}))
    return out


async def _rules(db, me, season, staffeln) -> list[dict]:
    from services import league_rules

    if season.get("status") in ("completed", "archived"):
        return []
    league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0})
    if not league:
        return []
    pending = await league_rules.pending_release(db, league, season)
    if not pending:
        return []
    return [_item("rules", season["id"], title=f"Regelwerk {league.get('name') or ''} {season.get('name') or ''}".strip(), text="",
                  url=pending["admin_url"], action="Regelwerk öffnen", me_id=me.get("id"),
                  detail={"kind": pending["kind"], "count": pending.get("count"), "label": pending.get("label")})]


SOURCES = {
    "overdue": _overdue, "lineups": _lineups, "no_show": _no_show, "incidents": _incidents, "procedures": _procedures,
    "sanctions": _sanctions, "applications": _applications, "roster": _roster, "reschedule": _reschedule, "rules": _rules,
}


def _when(item: dict) -> str:
    return str(item.get("due_at") or item.get("since") or "9999")


async def season_desk(db, season: dict, me: dict) -> dict:
    """Alle offenen Aufgaben der Season, je Gruppe - nur die Gruppen, für die die Person zuständig ist."""
    capabilities = await capabilities_of(db, me, season.get("league_id"))
    staffeln = await _staffeln(db, season["id"])
    groups = []
    for key, label, wanted in GROUPS:
        if not capabilities & set(wanted):
            continue
        try:
            items = await SOURCES[key](db, me, season, staffeln)
        except Exception:  # noqa: BLE001 - eine Quelle, die klemmt, nimmt dem Leitstand nicht die anderen
            logger.warning("[league_desk] Quelle %s der Season %s nicht gelesen", key, log_safe(season.get("id")), exc_info=True)
            groups.append({"key": key, "label": label, "responsible": responsible_label(wanted), "items": [], "failed": True})
            continue
        items.sort(key=_when)
        groups.append({"key": key, "label": label, "responsible": responsible_label(wanted), "items": items, "failed": False})
    total = sum(len(group["items"]) for group in groups)
    mine = sum(1 for group in groups for item in group["items"] if item["mine"])
    return {
        "season": {"id": season["id"], "name": season.get("name"), "status": season.get("status")},
        "groups": groups, "total": total, "mine": mine,
        "can_broadcast": bool(capabilities & set(BROADCAST_CAPABILITIES)),
    }


async def open_count(db, season: dict, me: dict) -> int:
    """Für „Mein Dienst“: wie viele Aufgaben im Leitstand dieser Season auf die Person warten."""
    return (await season_desk(db, season, me))["mine"]


# ---------------------------------------------------------------- Protokoll

LOG_PAGE_SIZE = 25
LOG_GROUPS = {
    "league.application": "Anmeldung", "league.sanction": "Strafe", "league.rules": "Regelwerk", "league.season": "Season",
    "league.roster": "Kader", "league.transfer": "Transfer", "league.squad": "Co-Team", "league.staffel": "Staffel",
    "league.table": "Tabelle", "league.conflict": "Notausnahme bei Befangenheit", "league.broadcast": "Rundnachricht",
    "league.division": "Liga N", "match.procedure": "Verfahren", "match.reschedule": "Verschiebung", "match.incident": "Vorfall",
    "match.result": "Ergebnis", "match.lineup": "Teilnehmerliste", "match.no_show": "Nicht erschienen", "match.checkin": "Check-in",
    "match.schedule": "Termin", "match.veto": "Veto", "match.dispute": "Streitfall",
}
LOG_VERBS = {
    "create": "angelegt", "update": "geändert", "delete": "gelöscht", "accept": "angenommen", "reject": "abgelehnt",
    "decline": "abgelehnt", "withdraw": "zurückgezogen", "approve": "genehmigt", "assign": "übernommen", "decision": "entschieden",
    "decide": "entschieden", "confirm": "bestätigt", "revoke": "widerrufen", "appeal": "Einspruch eingelegt", "request": "beantragt",
    "publish": "veröffentlicht", "draft": "Entwurf gespeichert", "submit": "eingereicht", "overdue": "Frist abgelaufen",
    "override": "Notausnahme", "send": "verschickt", "issue": "verhängt", "waitlist": "auf die Warteliste gesetzt",
    "review": "in Prüfung", "amend": "nachgetragen", "status": "Stand geändert", "sync": "Vorgaben übertragen",
}


def log_label(action: str) -> str:
    """„Strafe · bestätigt“ aus ``league.sanction.confirm`` - nie ein Text aus den Daten."""
    parts = str(action or "").split(".")
    group = LOG_GROUPS.get(".".join(parts[:2]), "Liga")
    verb = LOG_VERBS.get(parts[-1]) if len(parts) > 2 else None
    return f"{group} · {verb}" if verb else group


AUDIENCE_LABELS = {"captains": "Captains und Vertreter", "players": "alle Spieler"}


def _log_detail(row: dict, staffeln: dict[str, dict]) -> dict:
    """Was je Eintrag angezeigt wird: Staffel und Spiel als Verweis, bei der Rundnachricht Kreis und Zahl - keine Gründe, Namen oder
    freien Texte aus ``data``."""
    data = row.get("data") or {}
    staffel = staffeln.get(row.get("target_id") or "") or staffeln.get(data.get("tournament_id") or "")
    out = {"staffel": (staffel or {}).get("title"), "match_id": data.get("match_id") if isinstance(data.get("match_id"), str) else None}
    if row.get("action") == "league.broadcast":
        out["broadcast"] = {"audience": AUDIENCE_LABELS.get(data.get("audience"), ""), "scope": data.get("scope_label") or "",
                            "recipients": int(data.get("recipients") or 0), "mail": bool(data.get("mail"))}
    return out


async def season_log(db, season: dict, page: int = 1) -> dict:
    """Das Protokoll der Season, neueste zuerst, seitenweise: Liga- und Spielaktionen der Season und ihrer Staffeln."""
    staffeln = await _staffeln(db, season["id"])
    targets = [season["id"], *sorted(staffeln)]
    query = {"action": {"$regex": "^(league|match)\\."},
             "$or": [{"target_id": {"$in": targets}}, {"data.season_id": season["id"]}]}
    total = await db.audit_logs.count_documents(query)
    pages = max(1, -(-total // LOG_PAGE_SIZE))
    page = min(max(1, int(page or 1)), pages)
    rows = await db.audit_logs.find(query, {"_id": 0, "id": 1, "action": 1, "actor_id": 1, "target_id": 1, "data": 1, "created_at": 1}) \
        .sort("created_at", -1).skip((page - 1) * LOG_PAGE_SIZE).limit(LOG_PAGE_SIZE).to_list(LOG_PAGE_SIZE)
    actor_ids = sorted({row["actor_id"] for row in rows if row.get("actor_id")})
    names = {row["id"]: row.get("display_name") or row.get("username") or "Mitglied" for row in await db.users.find(
        {"id": {"$in": actor_ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(len(actor_ids) + 1)} if actor_ids else {}
    return {
        "items": [{"id": row.get("id"), "action": row.get("action"), "label": log_label(row.get("action")), "at": row.get("created_at"),
                   "actor": names.get(row.get("actor_id") or "") if row.get("actor_id") else "Automatik",
                   **_log_detail(row, staffeln)} for row in rows],
        "page": page, "pages": pages, "total": total, "page_size": LOG_PAGE_SIZE,
    }


# ---------------------------------------------------------------- Rundnachricht (Nr. 153)

TITLE_MIN, TITLE_MAX = 3, 80
TEXT_MIN, TEXT_MAX = 10, 1000
AUDIENCES = ("captains", "players")
SCOPES = ("season", "division", "staffel")
ACTIVE_REGISTRATIONS = ("pending", "approved", "checked_in")
NOT_FOUND = "Diese Liga N oder Staffel gibt es in der Season nicht."


class BroadcastProblem(Exception):
    def __init__(self, detail: str, status_code: int = 422):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def clean_text(value, low: int, high: int, name: str) -> str:
    text = " ".join(str(value or "").split()) if name == "Betreff" else str(value or "").strip()
    if len(text) < low:
        raise BroadcastProblem(f"{name}: mindestens {low} Zeichen.")
    if len(text) > high:
        raise BroadcastProblem(f"{name}: höchstens {high} Zeichen.")
    return text


async def _scope(db, season: dict, scope: str, scope_id: str | None) -> tuple[list[dict], str]:
    """Die Staffeln des gewählten Kreises und sein Name."""
    if scope not in SCOPES:
        raise BroadcastProblem("Unbekannter Empfängerkreis.")
    from services.league_service import division_label

    staffeln = await db.tournaments.find({"league_context.season_id": season["id"], "status": {"$nin": ["archived", "cancelled"]}},
                                         {"_id": 0, "id": 1, "title": 1, "league_context": 1}).to_list(500)
    if scope == "season":
        return staffeln, "Ganze Season"
    if scope == "division":
        division = await db.league_divisions.find_one({"id": scope_id, "season_id": season["id"]}, {"_id": 0}) if scope_id else None
        if not division:
            raise BroadcastProblem(NOT_FOUND, 404)
        return [row for row in staffeln if row["league_context"].get("division_id") == division["id"]], division_label(division)
    staffel = next((row for row in staffeln if row["id"] == scope_id), None)
    if not staffel:
        raise BroadcastProblem(NOT_FOUND, 404)
    return [staffel], staffel.get("title") or "Staffel"


async def recipients(db, season: dict, *, audience: str, scope: str, scope_id: str | None, sender_id: str | None) -> tuple[list[str], str]:
    """Kennungen der Empfänger und der Name des Kreises. Captains und Vertreter (ohne beide die Hauptteam-Leitung, ``responsible_ids``)
    oder alle Spieler (``player_ids``) der Co-Teams in den Staffeln - ohne gesperrte Konten und ohne die Person, die schickt."""
    from services.match_audience import player_user_ids, responsible_user_ids, users_for

    if audience not in AUDIENCES:
        raise BroadcastProblem("Unbekannter Empfängerkreis.")
    staffeln, label = await _scope(db, season, scope, scope_id)
    ids = [row["id"] for row in staffeln]
    registrations = await db.tournament_registrations.find(
        {"tournament_id": {"$in": ids}, "status": {"$in": list(ACTIVE_REGISTRATIONS)}}, {"_id": 0}).to_list(None) if ids else []
    wanted = await (responsible_user_ids if audience == "captains" else player_user_ids)(db, registrations)
    people = await users_for(db, wanted - {sender_id}, {"_id": 0, "id": 1, "is_active": 1})
    return sorted(row["id"] for row in people if row.get("is_active") is not False), label


async def preview(db, season: dict, *, audience: str, scope: str, scope_id: str | None, sender_id: str | None) -> dict:
    ids, label = await recipients(db, season, audience=audience, scope=scope, scope_id=scope_id, sender_id=sender_id)
    return {"recipients": len(ids), "scope_label": label, "audience_label": AUDIENCE_LABELS[audience]}


def _claim_id(season_id: str, request_id: str) -> str:
    return f"league-broadcast:{season_id}:{request_id}"


STALE_SECONDS = 120
BATCH = 20


async def send(db, season: dict, me: dict, *, request_id: str, title, text, audience: str, scope: str, scope_id: str | None,
               mail: bool, now: datetime | None = None) -> tuple[dict, dict | None]:
    """Eine Rundnachricht anlegen - einmal je ``request_id``. Gibt die Antwort und den Auftrag für ``deliver`` zurück (``None``: nichts
    zu tun). Der Eintrag im Protokoll ist zugleich die Sperre (eindeutige Kennung) und trägt den Fortschritt.

    Ein zweiter Aufruf mit derselben Kennung (Doppelklick, neuer Versuch nach einem Fehler im Netz) schickt nichts Neues: Ist die
    Nachricht verschickt, kommt die erste Antwort. Steht sie noch auf „sending“ und hat sich seit ``STALE_SECONDS`` nichts mehr getan
    (der Versand ist abgebrochen), setzt er den Versand fort - Glocke und Mail sind je Person entdoppelt, niemand bekommt sie zweimal."""
    request_id = str(request_id or "").strip()
    if not 8 <= len(request_id) <= 80:
        raise BroadcastProblem("Die Anfrage ist unvollständig. Bitte die Seite neu laden.")
    title = clean_text(title, TITLE_MIN, TITLE_MAX, "Betreff")
    text = clean_text(text, TEXT_MIN, TEXT_MAX, "Nachricht")
    claim = _claim_id(season["id"], request_id)
    moment = now or now_utc()
    earlier = await db.audit_logs.find_one({"id": claim}, {"_id": 0, "data": 1})
    if earlier:
        return await _replay(db, season, me, claim, earlier.get("data") or {}, title, text, moment)
    ids, label = await recipients(db, season, audience=audience, scope=scope, scope_id=scope_id, sender_id=me.get("id"))
    if not ids:
        raise BroadcastProblem("In diesem Kreis gibt es niemanden, der die Nachricht bekommen kann.", 409)
    # Ohne Namen und ohne den Text: Kreis, Zahl, Mail ja/nein, Länge, Fortschritt - der Absender steht als ``actor_id`` dabei.
    data = {"season_id": season["id"], "request_id": request_id, "audience": audience, "scope": scope, "scope_id": scope_id,
            "scope_label": label, "recipients": len(ids), "mail": bool(mail), "length": len(text), "state": "sending",
            "processed": 0, "delivered": 0, "mailed": 0, "progress_at": moment.isoformat()}
    try:
        await db.audit_logs.insert_one({"id": claim, "action": "league.broadcast", "actor_id": me.get("id"), "target_id": season["id"],
                                        "data": data, "created_at": moment.isoformat()})
    except DuplicateKeyError:
        earlier = await db.audit_logs.find_one({"id": claim}, {"_id": 0, "data": 1}) or {}
        return {**_answer(earlier.get("data") or data), "replay": True}, None
    return {**_answer(data), "replay": False}, _job(season, me, claim, data, title, text)


def _job(season: dict, me: dict, claim: str, data: dict, title: str, text: str) -> dict:
    return {"season_id": season["id"], "claim": claim, "sender_id": me.get("id"), "title": title, "text": text,
            "audience": data["audience"], "scope": data["scope"], "scope_id": data.get("scope_id"), "mail": bool(data.get("mail"))}


async def _replay(db, season, me, claim, data, title, text, moment) -> tuple[dict, dict | None]:
    if data.get("state") != "sending":
        return {**_answer(data), "replay": True}, None
    last = data.get("progress_at")
    try:
        quiet = (moment - datetime.fromisoformat(str(last))).total_seconds() if last else STALE_SECONDS + 1
    except ValueError:
        quiet = STALE_SECONDS + 1
    if quiet < STALE_SECONDS:
        return {**_answer(data), "replay": True}, None
    # Nur ein Aufruf übernimmt den Rest: die Bedingung auf den gelesenen Stand des Fortschritts.
    taken = await db.audit_logs.update_one({"id": claim, "data.state": "sending", "data.progress_at": last},
                                           {"$set": {"data.progress_at": moment.isoformat()}})
    if not taken.modified_count:
        return {**_answer(data), "replay": True}, None
    return {**_answer(data), "replay": True, "resumed": True}, _job(season, me, claim, data, title, text)


async def _state(db, claim: str) -> dict:
    return _answer((await db.audit_logs.find_one({"id": claim}, {"_id": 0, "data": 1}) or {}).get("data") or {})


async def deliver(db, *, season_id: str, claim: str, sender_id: str | None, title: str, text: str, audience: str, scope: str,
                  scope_id: str | None, mail: bool) -> dict:
    """Der Versand: Glocke und Push je Person, Mail nach Wahl; je ``BATCH`` Personen steht der Fortschritt im Protokolleintrag."""
    from services.league_mail import send_league_mail
    from services.user_notifications import create_user_notification

    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0}) or {"id": season_id}
    try:
        ids, _label = await recipients(db, season, audience=audience, scope=scope, scope_id=scope_id, sender_id=sender_id)
    except BroadcastProblem:
        await db.audit_logs.update_one({"id": claim}, {"$set": {"data.state": "failed", "data.progress_at": now_utc().isoformat()}})
        return await _state(db, claim)
    league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "name": 1, "slug": 1}) or {}
    heading = f"{league.get('name') or 'Liga'} {season.get('name') or ''}".strip()
    path = f"/liga/{league.get('slug')}/{season.get('slug')}" if league.get("slug") and season.get("slug") else "/benachrichtigungen"
    counts = {"delivered": 0, "mailed": 0}

    async def progress(processed: int, **extra) -> None:
        await db.audit_logs.update_one({"id": claim}, {
            "$inc": {"data.delivered": counts["delivered"], "data.mailed": counts["mailed"]},
            "$set": {"data.processed": processed, "data.progress_at": now_utc().isoformat(), **extra}})
        counts.update(delivered=0, mailed=0)

    for index, user_id in enumerate(ids, start=1):
        key = f"{claim}:{user_id}"
        try:
            done = await create_user_notification(user_id, f"{heading}: {title}", text, url=path, kind="league_broadcast",
                                                  meta={"category": "tournament_updates", "season_id": season_id, "dedupe_key": key,
                                                        "reason": "league_broadcast"})
            counts["delivered"] += 1 if done else 0
        except Exception:  # noqa: BLE001 - eine Person, bei der es klemmt, hält die anderen nicht auf
            logger.warning("[league_desk] Rundnachricht %s nicht zugestellt", log_safe(claim), exc_info=True)
        if mail:
            await send_league_mail(db, user_id, f"{heading}: {title}", text, path, f"{key}:mail")
            counts["mailed"] += 1
        if index % BATCH == 0:
            await progress(index)
    await progress(len(ids), **{"data.state": "sent", "data.recipients": len(ids)})
    return await _state(db, claim)


async def status(db, season: dict, request_id: str) -> dict:
    """Der Stand einer Rundnachricht für den Dialog: ``sending`` mit Fortschritt, ``sent`` oder ``failed``."""
    row = await db.audit_logs.find_one({"id": _claim_id(season["id"], str(request_id or "").strip())}, {"_id": 0, "data": 1})
    if not row:
        raise BroadcastProblem("Diese Rundnachricht gibt es nicht.", 404)
    return _answer(row.get("data") or {})


def _answer(data: dict) -> dict:
    return {"recipients": int(data.get("recipients") or 0), "processed": int(data.get("processed") or 0),
            "delivered": int(data.get("delivered") or 0), "mailed": int(data.get("mailed") or 0),
            "mail": bool(data.get("mail")), "scope_label": data.get("scope_label") or "",
            "audience_label": AUDIENCE_LABELS.get(data.get("audience"), ""), "state": data.get("state") or "sent"}
