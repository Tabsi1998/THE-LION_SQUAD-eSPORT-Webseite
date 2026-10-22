"""Übernahme von einer Partner-Plattform (#1964) - ohne Datenbank: welcher Termin zu einem Turnier gehört, was sich
gegenüber einem vorhandenen Blatt ändert und was der Verein dort von Hand ergänzt hat. Laden, Prüfen und Speichern
machen die Routen (``routes/reference_partner_routes.py``) mit denselben Bausteinen wie das Eintragen (#1744).

- **Termin** (``round_matches``): erst der Termin, der schon mit diesem Turnier verknüpft ist (``partner_ref``), dann
  ein nicht abgesagter, nicht archivierter Termin am selben Wiener Tag ohne Verknüpfung - jeder Termin höchstens einmal.
  Sonst wird ein neuer Termin angelegt. So erzeugt ein zweiter Abruf keine Doppelten.
- **Abweichungen** (``sheet_diff``): je Person Platz, Tagessumme, Runden, Partner und Marken; dazu wer neu dazukommt
  oder wegfällt und ob das Blatt Double Up ist. Ohne Blatt ist alles „neu“, ohne Abweichung „gleich“ - dann gibt es
  nichts zu übernehmen.
- **Von Hand ergänzt** (``carry_over``): Sonderboni, Notizen, Strafpunkte, Punkte von Hand, Marken außer „Ausgestiegen“
  (DSQ, DNS …) und der offizielle Gesamtstand kennt die Quelle nicht - sie bleiben aus dem vorhandenen Blatt erhalten
  und zählen nicht als Abweichung. „Ausgestiegen“ meldet die Quelle selbst.
- **Fingerabdruck** (``fingerprint``): kurzer Prüfwert des Turniertags. Übernehmen verlangt den Wert aus der Vorschau -
  haben sich die Daten beim Partner inzwischen geändert, wird nichts still übernommen.
"""
from __future__ import annotations

import hashlib
import json

COMPARED = ("place", "day_points", "day_rounds", "partner_id", "marks")
KEPT_ROW_FIELDS = ("bonus_keys", "note", "penalty_points", "points", "points_source")
SOURCE_MARKS = frozenset({"left"})  # Marken, die die Quelle selbst meldet - alle anderen setzt der Verein von Hand


def _ref(round_doc: dict) -> dict | None:
    ref = round_doc.get("partner_ref")
    return ref if isinstance(ref, dict) else None


def round_matches(days: list[dict], rounds: list[dict], platform_key: str) -> dict[str, dict]:
    """Je Turnier (``ref``) ``{"action": "linked" | "assign" | "new", "round": Termin | None}``."""
    active = sorted((item for item in rounds if not item.get("archived_at")),
                    key=lambda item: (item.get("order") or 0, str(item.get("id"))))
    linked = {}
    for item in active:
        ref = _ref(item)
        if ref and ref.get("platform") == platform_key and ref.get("ref"):
            linked.setdefault(str(ref["ref"]), item)
    used = {item["id"] for item in linked.values()}
    out = {}
    for day in days:
        ref = str(day["ref"])
        if ref in linked:
            out[ref] = {"action": "linked", "round": linked[ref]}
            continue
        match = next((item for item in active if day.get("club_day") and item.get("club_day") == day["club_day"]
                      and item.get("status") != "cancelled" and not _ref(item) and item["id"] not in used), None)
        if match is not None:
            used.add(match["id"])
            out[ref] = {"action": "assign", "round": match}
        else:
            out[ref] = {"action": "new", "round": None}
    return out


def _t_number(code) -> int | None:
    text = str(code or "").strip().upper()
    return int(text[1:]) if len(text) > 1 and text[0] == "T" and text[1:].isascii() and text[1:].isdigit() else None


def next_code(rounds: list[dict], taken: set[str] | None = None) -> str:
    """Kürzel für einen neuen Termin: „T<n>“ nach dem höchsten „T<Zahl>“ der Saison (archivierte zählen mit), ohne
    solche Kürzel nach der Zahl der Termine - nie eines, das es schon gibt."""
    numbers = [number for number in (_t_number(item.get("code")) for item in rounds) if number is not None]
    used = {str(item.get("code") or "").strip().upper() for item in rounds} | {code.upper() for code in taken or ()}
    number = max(numbers) + 1 if numbers else len(rounds) + 1
    while f"T{number}" in used:
        number += 1
    return f"T{number}"


def _value(row: dict, key: str):
    value = row.get(key)
    if key == "marks":
        return sorted(value or [])
    if key == "day_rounds":
        return list(value) if value else None
    return value


def sheet_diff(old: dict | None, new: dict, names: dict[str, str]) -> dict:
    """Abweichungen von ``old`` (vorhandenes Blatt bzw. Entwurf daneben) zu ``new``."""
    if old is None:
        return {"state": "new", "changes": []}
    before = {row.get("participant_id"): row for row in old.get("rows") or [] if row.get("participant_id")}
    after_ids = []
    changes = []
    for row in new.get("rows") or []:
        pid = row.get("participant_id")
        if not pid:
            continue
        after_ids.append(pid)
        name = names.get(pid, "")
        if pid not in before:
            changes.append({"participant_id": pid, "name": name, "kind": "added", "fields": {}})
            continue
        fields = {key: [_value(before[pid], key), _value(row, key)] for key in COMPARED
                  if _value(before[pid], key) != _value(row, key)}
        if fields:
            changes.append({"participant_id": pid, "name": name, "kind": "changed", "fields": fields})
    for pid in before:
        if pid not in after_ids:
            changes.append({"participant_id": pid, "name": names.get(pid, ""), "kind": "removed", "fields": {}})
    was, now = bool(old.get("double_up")), bool(new.get("double_up"))
    if was != now:
        changes.append({"participant_id": None, "name": "", "kind": "sheet", "fields": {"double_up": [was, now]}})
    return {"state": "changed" if changes else "same", "changes": changes}


def carry_over(new: dict, old: dict | None) -> dict:
    """``new`` mit dem, was der Verein im vorhandenen Blatt von Hand ergänzt hat - als neue Kopie."""
    if not old:
        return new
    before = {row.get("participant_id"): row for row in old.get("rows") or [] if row.get("participant_id")}
    rows = []
    for row in new.get("rows") or []:
        kept = before.get(row.get("participant_id")) or {}
        extra = {key: kept[key] for key in KEPT_ROW_FIELDS if kept.get(key) not in (None, [], "", 0)}
        if extra.get("points_source") == "scheme":
            extra.pop("points_source")
        # Marken: „Ausgestiegen“ meldet die Quelle, jede andere (DSQ, DNS …) hat der Verein gesetzt - sie bleibt.
        by_hand = {mark for mark in kept.get("marks") or [] if mark not in SOURCE_MARKS}
        marks = sorted({*(row.get("marks") or []), *by_hand})
        rows.append({**row, **extra, "marks": marks})
    out = {**new, "rows": rows}
    if not out.get("note") and old.get("note"):
        out["note"] = old["note"]
    # Offizieller Gesamtstand je Person (von Hand) - nur für, wer noch im Blatt steht; ein neuer Wert geht vor.
    present = {row.get("participant_id") for row in rows}
    totals = {pid: value for pid, value in (old.get("official_totals") or {}).items() if pid in present}
    out["official_totals"] = {**totals, **(new.get("official_totals") or {})}
    return out


def fingerprint(day: dict) -> str:
    text = json.dumps(day, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
