"""Was eine Spielseite zeigt, wenn man das Turnier nicht leitet.

Ein Spiel-Datensatz trägt auch Internes: Notizen der Turnierleitung, Begründungen ihrer Entscheidungen, wer ein
Ergebnis eingetragen hat, Einsprüche mit Begründung, die einzelnen Meldungen der Spieler und Konto-Kennungen. Das
sieht nur, wer das Turnier leitet. Alle anderen bekommen die öffentlichen Felder; wer selbst gemeldet oder
widersprochen hat, sieht dazu seine eigene Meldung und seinen eigenen Einspruch. Wie viele Meldungen und Einsprüche
es gibt, bleibt sichtbar.

Dieselbe Sicht gilt überall, wo Spiele ohne Turnier-Recht gelesen werden: Spielseite, Turnierbaum und die
Spieleliste eines Turniers. Turnierphasen verlieren dort ebenfalls, wer sie angelegt hat.
"""
from __future__ import annotations

# Nur für die Turnierleitung - oben im Datensatz, in `result_meta` und in jeder Ergebniszeile. Ein Ergebnis, das noch
# 10 Sekunden für „Rückgängig“ bereitliegt (`pending_result`, #1156), sieht niemand sonst - sonst wäre es vor der
# Zeit auf der Matchseite und am TV; ebenso der Grund einer Korrektur.
INTERNAL_KEYS = frozenset({"admin_note", "admin_decision_note", "admin_decision_at", "pending_result",
                           # Der Sperr-Schlüssel des Lauf-Umbaus (#1550) - Technik, kein Inhalt.
                           "rebuild_token",
                           # „Nicht erschienen“ im Lauf (#1823): wer markiert ist, ist öffentlich - die Begründung nicht.
                           "no_show_notes",
                           # Liga (#1650): der Doppel-Einsatz-Index besteht aus Konto-Kennungen.
                           "lineup_user_ids",
                           # Teilnehmerliste (#2204): Konto-Kennungen und der interne Fall bei der Leitung.
                           "lineups", "lineup_overdue_at",
                           # Liga-Termine (#2194): Anträge und Historie mit Gründen und Konten, die Fälle der Leitung -
                           # Beteiligte bekommen sie mit Namen im Block ``schedule_block`` der Matchseite.
                           "reschedule_requests", "schedule_history", "result_reminded_at", "result_overdue_at",
                           # Liga-Check-in (#1652, D.2): wer wann für welche Seite eingecheckt hat - mit Namen im Block
                           # ``checkin`` der Matchseite für Beteiligte und Leitung.
                           "flow",
                           # Vorfälle (#1619, D.5): Beschreibung, Stand, Entscheidung und Konto-Kennungen - Beteiligte und Leitung
                           # bekommen sie im Block ``league`` der Matchseite, öffentlich bleibt nur der Stand je Map (``map_state``).
                           "incidents", "incident_due_at"})
INTERNAL_META_KEYS = frozenset({"note", "correction_reason", "hold_id"})
INTERNAL_RESULT_KEYS = frozenset({"user_id", "note"})
# Liga (#1650): öffentlich je Map nur der Schnappschuss, Sieger und Punkte - Aufstellungen (Konto-Kennungen) bekommen
# die Beteiligten mit Namen über den Block ``league`` der Matchseite. Gleich wie die Staffel-API (league_page).
PUBLIC_GAME_FIELDS = ("position", "mode", "mode_label", "map_id", "map_name", "map_image_url", "winner_registration_id",
                      "scores",
                      # Zusatzfelder je Map (C.3, #1617), nur wenn gesetzt. Der Nachweis (``proof_id``) bleibt privat.
                      "status", "replay_reason", "decision", "host_registration_id",
                      # Symbol des Modus (#2266), Schnappschuss wie ``mode_label``.
                      "mode_icon_url")


def public_games(games: list | None) -> list:
    """Die Maps eines Spiels ohne Aufstellungen."""
    return [{key: game.get(key) for key in PUBLIC_GAME_FIELDS if key in game}
            for game in games or [] if isinstance(game, dict)]


def _public_keys(value: dict, internal: frozenset) -> dict:
    # Wer etwas getan hat (`*_by`), sind Konto-Kennungen - die gehören nicht auf eine öffentliche Seite.
    return {key: item for key, item in value.items() if key not in internal and not key.endswith("_by")}


# Liga-Verfahren (#1619, E.2, Nr. 133/137): Einträge in ``disputes[]`` mit ``id`` und ``kind``. Im Spiel-Datensatz stehen sie für
# alle außer der nicht befangenen Leitung gekürzt - was eine Seite sehen darf, liefert die Matchseite im Block
# ``league.procedures``. Die eigene Meldung behält, was alte Leser (App) brauchen: Grund, Text, Entscheidung.
PROCEDURE_KINDS = frozenset({"objection", "protest", "appeal"})
PROCEDURE_PUBLIC_KEYS = ("at", "id", "kind", "state")
PROCEDURE_OWN_HIDDEN = frozenset({"moss_requests", "assignee", "resolved_by", "withdrawn_by", "statement", "additions", "target_at",
                                  "escalate_at", "reminded_at", "escalated_at", "against", "notified_immediately"})


def is_procedure_row(row) -> bool:
    return isinstance(row, dict) and row.get("kind") in PROCEDURE_KINDS and bool(row.get("id"))


def public_dispute_row(row: dict, viewer_id: str | None) -> dict:
    """Ein Eintrag aus ``disputes[]`` für alle ohne Leitungs-Sicht: die eigene Meldung, sonst nur, dass es eine gibt."""
    own = bool(viewer_id) and row.get("user_id") == viewer_id
    if is_procedure_row(row):
        if own:
            return {key: value for key, value in row.items() if key not in PROCEDURE_OWN_HIDDEN}
        return {key: row.get(key) for key in PROCEDURE_PUBLIC_KEYS}
    return row if own else {"at": row.get("at")}


def without_procedure_details(match: dict | None, viewer_id: str | None) -> dict | None:
    """Das Spiel wie geliefert, nur die Liga-Verfahren gekürzt - für Antworten, die sonst den ganzen Datensatz zeigen (Leitung
    ohne Recht „Proteste“ oder „Ergebnisse“, Beteiligte mit Liga-Recht, Antworten auf eigene Aktionen der Seiten)."""
    if not isinstance(match, dict) or not isinstance(match.get("disputes"), list):
        return match
    return {**match, "disputes": [public_dispute_row(row, viewer_id) if is_procedure_row(row) else row
                                  for row in match["disputes"] if isinstance(row, dict)]}


def public_match_view(match: dict | None, viewer_id: str | None = None) -> dict | None:
    """Der Spiel-Datensatz ohne Internes. `viewer_id`: wer schaut - seine eigene Meldung und sein Einspruch bleiben."""
    if not isinstance(match, dict):
        return match
    out = _public_keys(match, INTERNAL_KEYS)
    if isinstance(match.get("result_meta"), dict):
        out["result_meta"] = _public_keys(match["result_meta"], INTERNAL_META_KEYS)
    if isinstance(match.get("results"), list):
        out["results"] = [_public_keys(row, INTERNAL_RESULT_KEYS) if isinstance(row, dict) else row for row in match["results"]]
    if "games" in match:
        out["games"] = public_games(match.get("games"))
    if "reports" in match:
        out["reports"] = [
            ({**row, **({"games": public_games(row["games"])} if "games" in row else {})}
             if viewer_id and row.get("user_id") == viewer_id
             else {"registration_id": row.get("registration_id"), "at": row.get("at")})
            for row in match.get("reports") or [] if isinstance(row, dict)
        ]
    if "disputes" in match:
        out["disputes"] = [public_dispute_row(row, viewer_id) for row in match.get("disputes") or [] if isinstance(row, dict)]
    return out


def public_stage_view(stage: dict | None) -> dict | None:
    """Eine Turnierphase ohne Konto-Kennungen (`*_by`) und ohne den internen Anlege-Schlüssel."""
    if not isinstance(stage, dict):
        return stage
    return {key: value for key, value in stage.items() if key != "creation_key" and not key.endswith("_by")}


def public_tournament_view(tournament: dict | None) -> dict | None:
    """Das Turnier auf der Spielseite: ohne die interne Abrechnung (`billing`) und ohne den Umbau-Vorschlag der
    Turnierleitung (`heat_rebuild_plan`, #1550) - wie die öffentliche Turnierseite. Ebenso ohne die Felder der Liga-Leitung
    (`point_deductions`, `table_decisions`, siehe ``league_table.LEAD_ONLY_FIELDS``): Die Tabelle rechnet der Server."""
    if not isinstance(tournament, dict):
        return tournament
    return {key: value for key, value in tournament.items() if key not in PUBLIC_HIDDEN_TOURNAMENT_FIELDS}


# Muss ``league_table.LEAD_ONLY_FIELDS`` enthalten (Test); hier als Wert, damit dieses Modul ohne Import-Kreis bleibt.
PUBLIC_HIDDEN_TOURNAMENT_FIELDS = frozenset({"billing", "heat_rebuild_plan", "heat_rebuild_dismissed", "participant_removal_plan",
                                             "point_deductions", "table_decisions"})
