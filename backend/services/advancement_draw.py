"""Gegner der nächsten Runde mischen (#1548): die Auslosungs-Gruppen und das echte Los.

Einstellung je Turnier bzw. Phase (``advancement_mode``, #1590), vier Modi:

- ``fixed`` - **Fester Baum** (Vorgabe): die Zuordnung steht im Schema.
- ``draw_round`` - **Auslosung nach der Runde**: sind alle Quellspiele der Gruppe entschieden, kommen alle Weiterkommer
  in einen Topf und werden gleichmäßig auf die Folgespiele verteilt. Keine Sperre gegen Wiedersehen.
- ``draw_show`` - **Show-Auslosung**: wie ``draw_round``, aber gelost wird erst, wenn die Turnierleitung „Jetzt auslosen“
  tippt (``draw_ready`` an den Folgespielen; Erinnerung und automatisches Los: services/draw_show).
- ``instant`` - **Sofort zufällig**: jeder Weiterkommer kommt sofort auf einen zufälligen freien Platz der Zielgruppe
  (gleiche Phase und Gruppe, Sieger- und Verlierer-Weg landen ohnehin in getrennten Gruppen). Ein Zielspiel ist
  spielbereit, sobald es voll ist.

Der alte Schalter ``randomize_advancement_rounds`` wird übernommen (aus → ``fixed``, an → ``draw_round``) und bleibt
als Spiegel stehen (``sync_advancement_fields``), damit ältere Leser weiter stimmen.

**Auslosungs-Gruppe** (``settings.draw_group`` am Folgespiel, z. B. ``WB:2``): die Spiele einer Sektion und Runde, in
die andere Spiele weiterleiten. Der Name gilt je Phase - zwei gemischte K.-o.-Phasen haben beide ein ``WB:2``; eine
Auslosung gehört immer zu genau einer Phase (``stage_id`` und Gruppe), mit eigenem Topf und eigenem Protokoll.
Im Doppel-K.-o. ist das Loser Bracket eine eigene Sektion - gemischt wird dort nur zwischen Spielen derselben
Loser-Runde. Eine Gruppe mit nur einem Spiel gibt es nicht: laufen nur zwei Spiele in eines
zusammen (Finale, Grand Final, Spiel um Platz 3), ändert Mischen nichts, das Spiel bleibt beim festen Baum. Der Platz
selbst trägt ``source.draw`` (Gruppe und Klartext „Runde 1“), damit Web, TV und App „Platz aus Runde 1“ zeigen.

Schema und Graph bleiben unverändert (``slot.source``, ``advancement``): der Topf sind genau die Weiterleitungen in die
Spiele der Gruppe. Die Auslosung selbst (Schreiben der Plätze) steht in ``services/match_v2_results``; sie läuft, wenn
**alle** Quellspiele der Gruppe entschieden sind. Wer plant, liest die Abhängigkeit über ``prerequisite_ids``.

Zufallsquelle ist ``secrets.SystemRandom`` - nicht vorhersagbar, ohne Startwert.
"""
from __future__ import annotations

import secrets
from collections import defaultdict
from typing import Any, Iterable

DRAW_RNG = secrets.SystemRandom()
SETTING_KEY = "randomize_advancement_rounds"
MODE_KEY = "advancement_mode"
MODES = ("fixed", "draw_round", "draw_show", "instant")
MIXED_MODES = frozenset({"draw_round", "draw_show", "instant"})
# Show-Auslosung (#1590): nach so vielen Minuten erinnert der Server die Turnierleitung, nach noch einmal so vielen
# lost er selbst (services/draw_show).
SHOW_MINUTES_KEY = "draw_show_minutes"
DEFAULT_SHOW_MINUTES = 10


def normalize_mode(value: Any) -> str | None:
    """Ein gültiger Modus - oder ``None`` (leer, unbekannt)."""
    return value if isinstance(value, str) and value in MODES else None


def _mode_of_settings(settings: dict | None) -> str | None:
    """Der Modus eines Dokuments (Turnier, Phase oder Spiel-Einstellungen): das neue Feld, sonst der alte Schalter
    (``True`` → ``draw_round``, ``False`` → ``fixed``), sonst leer."""
    settings = settings or {}
    mode = normalize_mode(settings.get(MODE_KEY))
    if mode:
        return mode
    legacy = settings.get(SETTING_KEY)
    if isinstance(legacy, bool):
        return "draw_round" if legacy else "fixed"
    return None


def advancement_mode_of(tournament: dict | None, stage_settings: dict | None) -> str:
    """Phase vor Turnier: ein Modus an der Phase gilt, leer erbt vom Turnier (Vorgabe: fester Baum)."""
    return _mode_of_settings(stage_settings) or _mode_of_settings(tournament) or "fixed"


def advancement_shuffle_enabled(tournament: dict | None, stage_settings: dict | None) -> bool:
    """Wird gemischt (irgendein Modus außer dem festen Baum)? Dann bekommen die Folgerunden ihre Gruppen."""
    return advancement_mode_of(tournament, stage_settings) in MIXED_MODES


def match_mode(match: dict | None) -> str:
    """Der Modus, mit dem ein Spiel gebaut wurde (``settings.advancement_mode``; ältere Bäume: der Schalter)."""
    return _mode_of_settings((match or {}).get("settings")) or "fixed"


def show_minutes_of(tournament: dict | None, stage_settings: dict | None) -> int:
    """Minuten bis zur Erinnerung bei der Show-Auslosung: Phase vor Turnier, Vorgabe 10; 0 oder Unsinn gilt nicht."""
    for source in (stage_settings or {}, tournament or {}):
        try:
            value = int(source.get(SHOW_MINUTES_KEY) or 0)
        except (TypeError, ValueError):
            value = 0
        if value > 0:
            return value
    return DEFAULT_SHOW_MINUTES


def sync_advancement_fields(doc: dict, *, stage: bool = False) -> dict:
    """Neues Feld und alter Schalter zusammenhalten - beim Anlegen und Ändern von Turnier und Phase. Das neue Feld
    hat Vorrang; fehlt es, wird der alte Schalter übernommen. An der Phase (``stage``) bleibt leer leer (erbt)."""
    mode = normalize_mode(doc.get(MODE_KEY))
    if not mode:
        legacy = doc.get(SETTING_KEY)
        if isinstance(legacy, bool):
            mode = "draw_round" if legacy else "fixed"
        elif stage:
            doc[MODE_KEY] = None
            doc[SETTING_KEY] = None
            return doc
        else:
            mode = "fixed"
    doc[MODE_KEY] = mode
    doc[SETTING_KEY] = mode in MIXED_MODES
    return doc


def draw_group_of(match: dict | None) -> str | None:
    value = ((match or {}).get("settings") or {}).get("draw_group")
    return str(value) if value else None


# ``stage_id`` nicht angegeben: alle Phasen (nur für Listen, die ohnehin nur eine Phase enthalten).
ANY_STAGE: Any = object()


def group_targets(matches: Iterable[dict], group: str, stage_id: Any = ANY_STAGE) -> list[dict]:
    """Die Folgespiele einer Gruppe in einer Phase (auch abgesagte - wer schreibt, lässt die selbst weg)."""
    return [match for match in matches if draw_group_of(match) == group
            and (stage_id is ANY_STAGE or match.get("stage_id") == stage_id)]


def group_sources(matches: Iterable[dict], group: str, stage_id: Any = ANY_STAGE) -> list[dict]:
    """Die Quellspiele einer Gruppe: alle Spiele, die in eines ihrer Folgespiele weiterleiten."""
    rows = list(matches)
    target_ids = {match.get("id") for match in group_targets(rows, group, stage_id)}
    return [
        match for match in rows
        if match.get("id") not in target_ids
        and any(entry.get("to_match_id") in target_ids for entry in match.get("advancement") or [])
    ]


def _is_open_draw_slot(slot: dict) -> bool:
    """Ein Platz der Gruppe, der noch auf sein Los wartet: Lauf-Quelle, offen, niemand drauf."""
    return ((slot.get("source") or {}).get("type") == "rank" and slot.get("status") == "pending"
            and not slot.get("registration_id") and not slot.get("source_result"))


def instant_prerequisites(targets: list[dict], sources: list[dict]) -> dict[str, set[str]]:
    """Die Prognose-Regel für „sofort zufällig“ (#1590), nachvollziehbar und ohne Zufall: die Zielspiele in
    Schlüssel-Reihenfolge (``order``, Kürzel) füllen ihre freien Plätze mit den Weiterleitungen der noch offenen
    Quellspiele in Schlüssel-Reihenfolge (Runde, ``order``, Kürzel) - das erste Zielspiel bekommt die ersten, das
    zweite die nächsten. Schon besetzte Plätze und entschiedene Quellen zählen nicht mehr mit. Eine Prognose, keine
    Festlegung: das echte Los entscheidet. Rückgabe: je Zielspiel die Quellspiele, auf die es laut Prognose wartet."""
    target_ids = {target.get("id") for target in targets}
    pending: list[str] = []
    for source in sorted(sources, key=lambda row: (row.get("round") or 0, row.get("order") or 0, str(row.get("match_key") or ""))):
        if str(source.get("status") or "") in {"completed", "forfeit", "cancelled"}:
            continue
        for entry in source.get("advancement") or []:
            if entry.get("to_match_id") in target_ids:
                pending.append(source["id"])
    needs: dict[str, set[str]] = {}
    position = 0
    for target in sorted(targets, key=lambda row: (row.get("order") or 0, str(row.get("match_key") or ""))):
        free = sum(1 for slot in target.get("slots") or [] if _is_open_draw_slot(slot))
        needs[target["id"]] = set(pending[position:position + free])
        position += free
    return needs


def prerequisite_ids(match: dict, matches: Iterable[dict]) -> set[str]:
    """Auf welche Spiele dieses Spiel wartet - für Planer und Matchplan (#1552).

    Fester Baum: die Spiele, die direkt hierher weiterleiten. Auslosung nach der Runde und Show: **alle** Quellspiele
    der Gruppe, denn erst wenn die ganze Runde fertig ist, steht fest, wer hier spielt. Sofort zufällig: die
    Prognose-Regel ``instant_prerequisites``."""
    rows = list(matches)
    group = draw_group_of(match)
    if group:
        stage_id = match.get("stage_id")
        sources = [row for row in group_sources(rows, group, stage_id) if row.get("id")]
        if match_mode(match) == "instant":
            targets = [row for row in group_targets(rows, group, stage_id) if row.get("status") != "cancelled"]
            return instant_prerequisites(targets, sources).get(match.get("id") or "", set())
        return {row["id"] for row in sources}
    return {
        row["id"] for row in rows
        if row.get("id") and row.get("id") != match.get("id")
        and any(entry.get("to_match_id") == match.get("id") for entry in row.get("advancement") or [])
    }


def _round_label(sources: list[dict]) -> str:
    names: list[str] = []
    for source in sorted(sources, key=lambda row: (row.get("round") or 0, row.get("order") or 0)):
        name = str(source.get("round_name") or f"Runde {source.get('round') or ''}").strip()
        if name and name not in names:
            names.append(name)
    return " / ".join(names) or "Vorrunde"


def mark_draw_groups(docs: list[dict]) -> None:
    """Beim Bau (gemischt): die Gruppen festlegen und ihre Plätze kennzeichnen. Siehe Modulbeschreibung."""
    fed_by: dict[str, set[str]] = defaultdict(set)
    fed_slots: dict[str, set[int]] = defaultdict(set)
    for doc in docs:
        for entry in doc.get("advancement") or []:
            fed_by[entry.get("to_match_id")].add(doc["id"])
            fed_slots[entry.get("to_match_id")].add(int(entry.get("to_slot") or 0))
    buckets: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for doc in docs:
        if doc["id"] in fed_by:
            buckets[(str(doc.get("section") or "MAIN"), int(doc.get("round") or 0))].append(doc)
    by_id = {doc["id"]: doc for doc in docs}
    for (section, round_no), targets in buckets.items():
        if len(targets) < 2:
            continue
        group = f"{section}:{round_no}"
        sources = [by_id[source_id] for target in targets for source_id in fed_by[target["id"]] if source_id in by_id]
        label = _round_label(list({source["id"]: source for source in sources}.values()))
        for target in targets:
            target.setdefault("settings", {})["draw_group"] = group
            for slot in target.get("slots") or []:
                source = slot.get("source") or {}
                if source.get("type") == "rank" and int(slot.get("slot") or 0) in fed_slots[target["id"]]:
                    slot["source"] = {**source, "draw": {"group": group, "label": label}}


def _is_player(entry: Any) -> bool:
    return isinstance(entry, dict) and bool(entry.get("registration_id"))


def assign_balanced(entries: list[Any], targets: list[tuple[str, list[int]]], rng=None) -> list[tuple[str, int, Any]]:
    """Das Los: Spieler gemischt und reihum auf die Folgespiele verteilt (Unterschied höchstens 1, solange Platz ist),
    die Plätze im Spiel ebenfalls gemischt; was übrig bleibt, sind Freilose (``entries`` ohne Spieler).

    ``targets``: je Folgespiel seine Plätze im Topf. Rückgabe: (Spiel, Platz, Eintrag) für jeden Platz."""
    rng = rng or DRAW_RNG
    players = [entry for entry in entries if _is_player(entry)]
    byes = [entry for entry in entries if not _is_player(entry)]
    rng.shuffle(players)
    rng.shuffle(byes)
    order = list(range(len(targets)))
    rng.shuffle(order)
    capacity = [len(slots) for _match_id, slots in targets]
    given: list[list[Any]] = [[] for _ in targets]
    remaining = list(players)
    while remaining:
        progressed = False
        for index in order:
            if not remaining:
                break
            if len(given[index]) < capacity[index]:
                given[index].append(remaining.pop())
                progressed = True
        if not progressed:
            break
    placed: list[tuple[str, int, Any]] = []
    for index, (match_id, slots) in enumerate(targets):
        positions = list(slots)
        rng.shuffle(positions)
        for position_index, slot_no in enumerate(positions):
            if position_index < len(given[index]):
                placed.append((match_id, slot_no, given[index][position_index]))
            else:
                placed.append((match_id, slot_no, byes.pop() if byes else None))
    return placed


def shuffle_league_rounds(first_leg: list[list[tuple[int, int]]], rng=None) -> list[list[tuple[int, int]]]:
    """Liga (#1548): die Kreismethode bleibt, gelost werden nur die Reihenfolge der Spieltage und das Heimrecht."""
    rng = rng or DRAW_RNG
    rounds = [[(home, away) if rng.random() < 0.5 else (away, home) for home, away in pairs] for pairs in first_leg]
    rng.shuffle(rounds)
    return rounds
