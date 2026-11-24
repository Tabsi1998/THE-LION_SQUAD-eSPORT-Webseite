"""Der Endstand einer Playoff- bzw. Relegations-Staffel (#2404, docs/LIGA.md „F.6 … Abschluss, Meister, Platz 3“).

Kein zweiter Abschluss: ``league_final.close`` friert auch diese Staffeln ein. Hier steht nur, was bei ihnen statt der Tabelle im
Endstand steht - gerechnet aus dem K.-o.-Baum des Turnierkerns, ohne ihn zu ändern.

- **Playoffs** (``playoff_rows``): 1 Sieger, 2 Finalist, 3 Sieger des Spiels um Platz 3 bzw. beide Halbfinal-Verlierer geteilt (Nr. 210),
  4 Verlierer des Spiels um Platz 3, dann je Runde geteilt (5 für die Viertelfinal-Verlierer usw.). Wer nach „beide nicht erschienen“
  ausgeschieden ist (Nr. 217), steht in seiner Runde; im Finale bleibt der Titel dann unvergeben (kein Platz 1 und 2).
- **Relegation** (``relegation_rows``): je Paarung zwei Zeilen mit Ergebnis, ohne Platz, dazu ``outcome`` je Co-Team - der Sieger aus
  der unteren Liga N ``up``, der Verlierer aus der oberen ``down``, alle anderen ``stay`` (Nr. 213).

Blatt-Modul: nur ``league_scope`` und die Datenbank.
"""
from __future__ import annotations

from models import REGISTRATION_LIMIT
from services.league_scope import PLAYOFF, RELEGATION, staffel_kind

DECIDED = frozenset({"completed", "forfeit"})
GONE = frozenset({"withdrawn", "disqualified"})
UP, DOWN, STAY = "up", "down", "stay"
OUTCOME_LABELS = {UP: "steigt auf", DOWN: "steigt ab", STAY: "bleibt"}
ROUND_NAMES = {0: "Finale", 1: "Halbfinale", 2: "Viertelfinale", 3: "Achtelfinale"}
THIRD_PLACE = "Spiel um Platz 3"


def is_bronze(match: dict) -> bool:
    return str(match.get("section") or "").strip().upper() in ("BRONZE", "BR")


def _round(match: dict) -> int:
    try:
        return int(match.get("round") or 0)
    except (TypeError, ValueError):
        return 0


def winner_of(match: dict | None) -> str | None:
    """Die eine Anmeldung auf Platz 1 eines entschiedenen Spiels - sonst ``None`` (offen, abgesagt, beide ausgeschieden)."""
    if not match or str(match.get("status") or "") not in DECIDED:
        return None
    firsts = [row.get("registration_id") for row in match.get("results") or [] if row.get("registration_id") and int(row.get("rank") or 0) == 1]
    return firsts[0] if len(firsts) == 1 else None


def sides_of(match: dict) -> list[str]:
    """Wer in diesem Spiel stand: die besetzten Plätze, dazu wer dort nach „beide nicht erschienen“ ausschied und wessen Platz ein
    Austritt oder eine Disqualifikation geleert hat (der Platz ist dann ein Freilos mit Merker)."""
    out = [slot["registration_id"] for slot in match.get("slots") or [] if slot.get("registration_id")]
    out += [str(item) for item in match.get("double_forfeit_sides") or [] if item]
    out += [(slot.get("source_result") or {}).get("removed_registration_id") for slot in match.get("slots") or []
            if (slot.get("source_result") or {}).get("removed_registration_id")]
    return list(dict.fromkeys(item for item in out if item))


def played(match: dict) -> bool:
    """Ein wirklich gespieltes oder gewertetes Duell - ein Freilos und ein kampfloses Weiterkommen nach einem Austritt zählen nicht."""
    if match.get("is_preview") or str(match.get("status") or "") not in DECIDED:
        return False
    return (match.get("result_meta") or {}).get("source") != "auto_bye"


def round_name(number: int, total: int) -> str:
    return ROUND_NAMES.get(total - number, f"Runde {number}")


def playoff_rows(matches: list[dict], registrations: list[dict]) -> list[dict]:
    """Die Plätze der Playoffs aus dem Baum - jede Anmeldung der Staffel eine Zeile, die beste zuerst."""
    live = [match for match in matches if not match.get("is_preview")]
    main = [match for match in live if not is_bronze(match)]
    bronze = next((match for match in live if is_bronze(match)), None)
    total = max((_round(match) for match in main), default=0)
    bronze_winner = winner_of(bronze)
    bronze_sides = sides_of(bronze) if bronze else []
    rows = []
    for registration in registrations:
        key = registration.get("id")
        if not key:
            continue
        own = sorted((match for match in main if key in sides_of(match)), key=_round)
        last = own[-1] if own else None
        reached = _round(last) if last else 1
        won_last = bool(last) and winner_of(last) == key
        wins = len([match for match in own if winner_of(match) == key and played(match)])
        games = len([match for match in [*own, *([bronze] if bronze and key in bronze_sides else [])] if played(match)])
        if last is None:
            rank = 2 ** max(total - 1, 0) + 1 if total else 0
        elif reached == total and won_last:
            rank = 1
        elif reached == total:
            # Im Finale gewertet verloren: Platz 2. Beide nicht erschienen: der Titel bleibt unvergeben, kein Platz 1 und 2.
            rank = 2 if winner_of(last) else 0
        elif reached == total - 1 and bronze_winner and key in bronze_sides:
            rank = 3 if bronze_winner == key else 4
        else:
            rank = 2 ** (total - reached) + 1
        row = {"registration_id": key, "team_id": registration.get("team_id"), "squad_id": registration.get("squad_id"),
               "display_name": registration.get("display_name") or registration.get("team_name") or "Team", "rank": rank,
               "seed": registration.get("seed"), "reached": round_name(reached, total) if total else None, "reached_round": reached,
               "played": games, "won": wins,
               "from_staffel": (registration.get("postseason") or {}).get("from_staffel"),
               "from_rank": (registration.get("postseason") or {}).get("rank")}
        if registration.get("status") in GONE:
            row["exit"] = {"kind": registration["status"]}
        rows.append(row)
    rows.sort(key=lambda row: (row["rank"] or 10**6, int(row.get("seed") or 10**6)))
    return rows


def relegation_rows(matches: list[dict], registrations: list[dict]) -> tuple[list[dict], dict[str, str]]:
    """Die Zeilen der Relegation (je Paarung zwei, ohne Platz) und ``outcome`` je Co-Team."""
    by_id = {row["id"]: row for row in registrations if row.get("id")}
    by_pair: dict[int, list[dict]] = {}
    for registration in registrations:
        pair = (registration.get("postseason") or {}).get("pair")
        if pair:
            by_pair.setdefault(int(pair), []).append(registration)
    duels = {}
    for match in matches:
        if match.get("is_preview"):
            continue
        for key in sides_of(match):
            pair = ((by_id.get(key) or {}).get("postseason") or {}).get("pair")
            if pair:
                duels[int(pair)] = match
    rows, outcome = [], {}
    for pair in sorted(by_pair):
        match = duels.get(pair)
        winner = winner_of(match)
        sides = sorted(by_pair[pair], key=lambda row: 0 if (row.get("postseason") or {}).get("side") == "upper" else 1)
        lower_won = bool(winner) and ((by_id.get(winner) or {}).get("postseason") or {}).get("side") == "lower"
        for registration in sides:
            side = (registration.get("postseason") or {}).get("side")
            moved = (UP if side == "lower" else DOWN) if lower_won else STAY
            outcome[registration.get("squad_id") or registration["id"]] = moved
            score = next((row.get("score") for row in (match or {}).get("results") or [] if row.get("registration_id") == registration["id"]), None)
            rows.append({"registration_id": registration["id"], "team_id": registration.get("team_id"), "squad_id": registration.get("squad_id"),
                         "display_name": registration.get("display_name") or "Team", "rank": 0, "pair": pair, "side": side,
                         "result": ("won" if winner == registration["id"] else "lost") if winner else "none", "score": score,
                         "outcome": moved, "outcome_label": OUTCOME_LABELS[moved],
                         "from_staffel": (registration.get("postseason") or {}).get("from_staffel"),
                         "from_rank": (registration.get("postseason") or {}).get("rank"),
                         **({"exit": {"kind": registration["status"]}} if registration.get("status") in GONE else {})})
    return rows, outcome


def final_match_id(matches: list[dict]) -> str | None:
    main = [match for match in matches if not match.get("is_preview") and not is_bronze(match)]
    total = max((_round(match) for match in main), default=0)
    finals = [match for match in main if _round(match) == total]
    return finals[0].get("id") if len(finals) == 1 else None


async def load(db, tournament: dict) -> tuple[list[dict], list[dict]]:
    tid = tournament["id"]
    matches = await db.matches_v2.find({"tournament_id": tid, "is_preview": {"$ne": True}}, {"_id": 0}).to_list(2000)
    registrations = await db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0}).to_list(REGISTRATION_LIMIT)
    return matches, registrations


async def rows_of(db, tournament: dict) -> dict:
    """Was der Endstand dieser Staffel trägt: ``rows``, bei der Relegation ``outcome``, bei Playoffs das Finale."""
    matches, registrations = await load(db, tournament)
    kind = staffel_kind(tournament)
    if kind == RELEGATION:
        rows, outcome = relegation_rows(matches, registrations)
        return {"kind": kind, "rows": rows, "outcome": outcome}
    if kind == PLAYOFF:
        return {"kind": kind, "rows": playoff_rows(matches, registrations), "final_match_id": final_match_id(matches)}
    return {"kind": None, "rows": []}
