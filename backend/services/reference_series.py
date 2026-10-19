"""Externe Serien (#1741): Punkteschema-Vorlagen und das Neurechnen der gespeicherten Stände.

Eine **Spur** (``reference_lineages``, etwa „Lion Racing F1“) ist die Klammer, darunter je Saison und Stufe eine
**Serie** (``reference_series``) mit Kalender (``reference_rounds``), Teilnehmern, Ergebnisblättern je Termin und den
daraus gerechneten Ständen (``reference_standings``). Serien sind keine Turniere: keine Anmeldungen, Matches, Erfolge
oder Saisonpunkte, und keine Sammlung wird mit dem Turnierbereich geteilt.

- **Vorlagen** liegen als Daten in den Einstellungen (``settings``, ``id = points_schemes``) und werden beim Anlegen
  einer Serie kopiert - eine spätere Änderung der Vorlage ändert keine bestehende Serie (Entscheidung 4).
- **Neu gerechnet** wird beim Schreiben: nach einer Regeländerung (und später nach jedem veröffentlichten Ergebnis)
  rechnet ``recompute_standings`` alle Stände der Serie aus Kalender, veröffentlichten Blättern und Teilnehmern -
  öffentliche Seiten lesen nur den gespeicherten Stand.
"""
from __future__ import annotations

from models import new_id, now_utc
from services.scoring_rules import normalize_rules
from services.series_standings import compute_standings

POINTS_SCHEMES_ID = "points_schemes"
SERIES_KINDS = ("series", "racing", "team_league")

# Vorlagen, die die Migration anlegt (nur, was fehlt - eine bearbeitete Vorlage bleibt). Werte, die der Verein selbst
# festlegt, kommen über die Verwaltung dazu; im Code stehen nur allgemein bekannte Schlüssel.
POINTS_SCHEME_TEMPLATES: tuple[dict, ...] = (
    {
        "id": "organizer",
        "name": "Punkte laut Veranstalter",
        "description": "Die Punkte je Runde stehen in der Ergebnisliste des Veranstalters und werden übernommen.",
        "kinds": list(SERIES_KINDS),
        "rules": {"points_mode": "organizer", "points_by_place": []},
    },
    {
        "id": "formula_1",
        "name": "Formel 1 (25-18-15-12-10-8-6-4-2-1)",
        "description": "Punkte für die ersten zehn, Vorrang nach Plätzen, Teamwertung mit allen Fahrern.",
        "kinds": ["racing", "series"],
        "rules": {"points_mode": "scheme", "points_by_place": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
                  "tiebreakers": ["countback", "latest_result"],
                  "team_scoring": {"enabled": True, "counting_drivers": None, "guests_count": True}},
    },
    {
        "id": "team_league_3_1_0",
        "name": "Team-Liga (Sieg 3, Unentschieden 1, Niederlage 0)",
        "description": "Tabelle nach Punkten, dann Differenz und erzielten Punkten.",
        "kinds": ["team_league"],
        "rules": {"points_mode": "organizer", "points_by_place": [],
                  "match_points": {"win": 3, "draw": 1, "loss": 0},
                  "table_tiebreakers": ["score_diff", "score_for"]},
    },
)


async def points_schemes(db) -> list[dict]:
    """Die Vorlagen aus den Einstellungen, in gespeicherter Reihenfolge."""
    doc = await db.settings.find_one({"id": POINTS_SCHEMES_ID}, {"_id": 0}) or {}
    return [scheme for scheme in doc.get("schemes") or [] if isinstance(scheme, dict) and scheme.get("id")]


async def complete_schemes(db) -> list[dict]:
    """Die Vorlagen mit vollständigen Regeln (Standards ergänzt) - so muss das Formular keine eigenen Standards kennen.
    Eine Vorlage, deren Regeln nicht (mehr) gelten, kommt unverändert, statt die Seite scheitern zu lassen."""
    out = []
    for scheme in await points_schemes(db):
        try:
            rules = normalize_rules(scheme.get("rules") or {})
        except ValueError:
            rules = scheme.get("rules") or {}
        out.append({**scheme, "rules": rules})
    return out


async def add_missing_templates(db) -> int:
    """Legt fehlende Vorlagen an, ohne vorhandene anzufassen. Liefert die Zahl der neuen."""
    present = {scheme["id"] for scheme in await points_schemes(db)}
    missing = [dict(template) for template in POINTS_SCHEME_TEMPLATES if template["id"] not in present]
    if missing:
        await db.settings.update_one(
            {"id": POINTS_SCHEMES_ID},
            {"$push": {"schemes": {"$each": missing}}, "$setOnInsert": {"id": POINTS_SCHEMES_ID}},
            upsert=True,
        )
    return len(missing)


async def recompute_standings(db, series: dict) -> int:
    """Alle Stände einer Serie neu: aus dem Kalender (ohne archivierte Termine), den veröffentlichten Ergebnisblättern
    und den Teilnehmern. Bestehende Stände werden ersetzt, überholte entfernt. Liefert die Zahl der Stände."""
    sid = series["id"]
    rounds = await db.reference_rounds.find({"series_id": sid, "archived_at": None}, {"_id": 0}).to_list(None)
    sheets = {row["round_id"]: row async for row in db.reference_round_results.find(
        {"series_id": sid, "status": "published"}, {"_id": 0})}
    participants = await db.reference_participants.find({"series_id": sid}, {"_id": 0}).to_list(None)
    snapshots = compute_standings(rules=series.get("rules") or {}, rounds=rounds, sheets=sheets,
                                  participants=participants, own_teams=[series.get("team_name") or ""])
    computed_at = now_utc().isoformat()
    kept = []
    for snapshot in snapshots:
        key = {"series_id": sid, "round_id": snapshot["round_id"], "scope": snapshot["scope"]}
        await db.reference_standings.update_one(key, {
            "$set": {"round_seq": snapshot["round_seq"], "rows": snapshot["rows"],
                     "rules_version": series.get("rules_version") or 1, "computed_at": computed_at},
            "$setOnInsert": {"id": new_id()},
        }, upsert=True)
        kept.append((snapshot["round_id"], snapshot["scope"]))
    async for stale in db.reference_standings.find({"series_id": sid}, {"_id": 0, "id": 1, "round_id": 1, "scope": 1}):
        if (stale.get("round_id"), stale.get("scope")) not in kept:
            await db.reference_standings.delete_one({"id": stale["id"]})
    return len(snapshots)
